import Redis from 'ioredis';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { logger } from '../utils/logger';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const log = logger.child({ module: 'TimescaleWriter' });

// Configuration
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const PG_HOST = process.env.PG_HOST || 'localhost';
const PG_PORT = parseInt(process.env.PG_PORT || '5432');
const PG_USER = process.env.PG_USER || 'postgres';
const PG_PASSWORD = process.env.PG_PASSWORD || 'password';
const PG_DB = process.env.PG_DB || 'chaimera';

const CONSUMER_GROUP = 'timescale_writer_group';
const CONSUMER_NAME = `writer_${Math.random().toString(36).substring(7)}`;
const QUOTE_STREAM_PATTERN = 'chaimera:stream:quote:*';
const L2_STREAM_PATTERN = 'chaimera:stream:l2depth:*';
const FLUSH_INTERVAL_MS = 1000;
const DISCOVERY_INTERVAL_MS = 10000;
const MAX_BUFFER_SIZE = 50000;
const XACK_CHUNK_SIZE = 1000;

// Types
interface MarketTick {
    time: Date;
    broker: string;
    symbol: string;
    price: number | null;
    bid: number | null;
    ask: number | null;
    bid_size: number | null;
    ask_size: number | null;
    volume: number | null;
    raw_flags: any;
}

interface DepthSnapshot {
    time: Date;
    symbol: string;
    asset_id: string | null;
    l1_price: number | null;
    top_bid_price: number | null;
    top_bid_volume: number | null;
    top_ask_price: number | null;
    top_ask_volume: number | null;
    bid_levels: number;
    ask_levels: number;
    full_bids: any;
    full_asks: any;
}

interface BufferedTick {
    streamKey: string;
    messageId: string;
    data: MarketTick;
}

interface BufferedDepth {
    streamKey: string;
    messageId: string;
    data: DepthSnapshot;
}

// Redis Connections (separate clients to avoid XREADGROUP blocking starvation)
const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    retryStrategy: (times) => Math.min(times * 50, 2000),
});

const redisL2 = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    retryStrategy: (times) => Math.min(times * 50, 2000),
});

// Postgres Connection
const pool = new Pool({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: PG_DB,
});

// State
let knownQuoteStreams: Set<string> = new Set();
let knownL2Streams: Set<string> = new Set();
let tickBuffer: BufferedTick[] = [];
let depthBuffer: BufferedDepth[] = [];
let lastFlushTime = Date.now();

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function ensureConsumerGroup(streamKey: string, client: Redis = redis) {
    try {
        await client.xgroup('CREATE', streamKey, CONSUMER_GROUP, '$', 'MKSTREAM');
        log.info({ streamKey }, 'Created consumer group');
    } catch (err: any) {
        if (err.message.includes('BUSYGROUP')) {
            // Force reset the cursor to the latest message so we don't process stale data
            try {
                await client.xgroup('SETID', streamKey, CONSUMER_GROUP, '$');
                log.info({ streamKey }, 'Reset consumer group cursor to $');
            } catch (resetErr: any) {
                log.error({ streamKey, error: resetErr.message }, 'Failed to reset cursor');
            }
        } else {
            log.error({ streamKey, error: err.message }, '❌ Error creating consumer group');
        }
    }
}

async function discoverStreams() {
    // Discover quote streams
    let cursor = '0';
    const quoteKeys: string[] = [];
    do {
        const result = await redis.scan(cursor, 'MATCH', QUOTE_STREAM_PATTERN, 'COUNT', 100);
        cursor = result[0];
        quoteKeys.push(...result[1]);
    } while (cursor !== '0');

    for (const key of quoteKeys) {
        if (!knownQuoteStreams.has(key)) {
            await ensureConsumerGroup(key);
            knownQuoteStreams.add(key);
        }
    }

    // Discover L2 depth streams
    cursor = '0';
    const l2Keys: string[] = [];
    do {
        const result = await redis.scan(cursor, 'MATCH', L2_STREAM_PATTERN, 'COUNT', 100);
        cursor = result[0];
        l2Keys.push(...result[1]);
    } while (cursor !== '0');

    for (const key of l2Keys) {
        if (!knownL2Streams.has(key)) {
            await ensureConsumerGroup(key, redisL2);
            knownL2Streams.add(key);
        }
    }

    const totalStreams = knownQuoteStreams.size + knownL2Streams.size;
    if (totalStreams > 0) {
        log.info({
            quoteStreams: knownQuoteStreams.size,
            l2Streams: knownL2Streams.size
        }, 'Tracking streams');
    }
}

function buildAckGroups<T extends { streamKey: string; messageId: string }>(batch: T[]): Map<string, string[]> {
    const ackByStream = new Map<string, string[]>();
    for (const item of batch) {
        const ids = ackByStream.get(item.streamKey);
        if (ids) {
            ids.push(item.messageId);
        } else {
            ackByStream.set(item.streamKey, [item.messageId]);
        }
    }
    return ackByStream;
}

async function ackCommittedBatch(client: Redis, ackByStream: Map<string, string[]>, batchSize: number, kind: 'ticks' | 'depth') {
    let acked = 0;
    for (const [streamKey, ids] of ackByStream) {
        for (let i = 0; i < ids.length; i += XACK_CHUNK_SIZE) {
            const chunk = ids.slice(i, i + XACK_CHUNK_SIZE);
            const ackCount = await client.xack(streamKey, CONSUMER_GROUP, ...chunk);
            acked += Number(ackCount);
        }
    }

    if (acked !== batchSize) {
        log.warn({ expected: batchSize, acked, streams: ackByStream.size, kind }, 'Post-commit XACK mismatch; messages may remain pending for replay');
    } else {
        log.info({ acked, streams: ackByStream.size, kind }, 'Post-commit XACK complete');
    }
}

// -----------------------------------------------------------------------------
// Flush: L1 Ticks
// -----------------------------------------------------------------------------

async function flushTickBuffer() {
    if (tickBuffer.length === 0) return;

    const batch = tickBuffer;
    tickBuffer = [];

    const ackByStream = buildAckGroups(batch);
    const rows = batch.map(entry => entry.data);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insertQuery = `
            INSERT INTO market_ticks (time, broker, symbol, price, bid, ask, bid_size, ask_size, volume, raw_flags)
            SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::float8[], $9::float8[], $10::jsonb[])
        `;

        await client.query(insertQuery, [
            rows.map(t => t.time),
            rows.map(t => t.broker),
            rows.map(t => t.symbol),
            rows.map(t => t.price),
            rows.map(t => t.bid),
            rows.map(t => t.ask),
            rows.map(t => t.bid_size),
            rows.map(t => t.ask_size),
            rows.map(t => t.volume),
            rows.map(t => JSON.stringify(t.raw_flags)),
        ]);

        await client.query('COMMIT');

        await ackCommittedBatch(redis, ackByStream, batch.length, 'ticks');
        log.info({ count: batch.length }, '💾 Flushed ticks to market_ticks.');
    } catch (err: any) {
        await client.query('ROLLBACK');
        tickBuffer = [...batch, ...tickBuffer];
        log.error({ error: err.message, retained: tickBuffer.length }, '❌ Tick flush failed; ACK skipped after rollback and buffer retained');
    } finally {
        client.release();
    }
}

// -----------------------------------------------------------------------------
// Flush: L2 Depth Snapshots
// -----------------------------------------------------------------------------

async function flushDepthBuffer() {
    if (depthBuffer.length === 0) return;

    const batch = depthBuffer;
    depthBuffer = [];

    const ackByStream = buildAckGroups(batch);
    const rows = batch.map(entry => entry.data);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insertQuery = `
            INSERT INTO market_depth_snapshots
                (time, symbol, asset_id, l1_price, top_bid_price, top_bid_volume, top_ask_price, top_ask_volume, bid_levels, ask_levels, full_bids, full_asks)
            SELECT * FROM unnest(
                $1::timestamptz[], $2::text[], $3::text[], $4::float8[],
                $5::float8[], $6::float8[], $7::float8[], $8::float8[],
                $9::int[], $10::int[], $11::jsonb[], $12::jsonb[]
            )
        `;

        await client.query(insertQuery, [
            rows.map(d => d.time),
            rows.map(d => d.symbol),
            rows.map(d => d.asset_id),
            rows.map(d => d.l1_price),
            rows.map(d => d.top_bid_price),
            rows.map(d => d.top_bid_volume),
            rows.map(d => d.top_ask_price),
            rows.map(d => d.top_ask_volume),
            rows.map(d => d.bid_levels),
            rows.map(d => d.ask_levels),
            rows.map(d => JSON.stringify(d.full_bids)),
            rows.map(d => JSON.stringify(d.full_asks)),
        ]);

        await client.query('COMMIT');

        await ackCommittedBatch(redisL2, ackByStream, batch.length, 'depth');
        log.info({ count: batch.length }, '🎯 Flushed L2 depth snapshots.');
    } catch (err: any) {
        await client.query('ROLLBACK');
        depthBuffer = [...batch, ...depthBuffer];
        log.error({ error: err instanceof Error ? err.message : String(err), retained: depthBuffer.length }, '❌ Failed to insert L2 depth; ACK skipped after rollback and buffer retained');
    } finally {
        client.release();
    }
}

// -----------------------------------------------------------------------------
// Parsers
// -----------------------------------------------------------------------------

function parseQuoteMessage(streamKey: string, messageId: string, fields: string[]): MarketTick | null {
    const rawFields: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
        rawFields[fields[i]] = fields[i + 1];
    }

    let payload: any = {};
    if (rawFields['data']) {
        try {
            payload = JSON.parse(rawFields['data']);
        } catch (e) {
            log.error({ messageId, error: e }, 'Failed to parse values JSON');
            return null;
        }
    } else {
        payload = rawFields;
    }

    // Extract broker and symbol from stream key: chaimera:stream:quote:BROKER:SYMBOL
    const keyParts = streamKey.split(':');
    const broker = keyParts[3];
    const symbol = payload.symbol || rawFields['symbol'] || keyParts[4] || 'UNKNOWN';

    let time = new Date();
    if (payload.timestamp) {
        time = new Date(payload.timestamp);
    } else if (payload.lp_time) {
        time = new Date(payload.lp_time * 1000);
    } else if (rawFields['ts']) {
        time = new Date(parseInt(rawFields['ts']));
    }

    const lastPrice = payload.lastPrice ?? payload.lp ?? payload.price ?? null;
    const bid = payload.bid ?? null;
    const ask = payload.ask ?? null;
    const bidSize = payload.bidSize ?? payload.bid_size ?? null;
    const askSize = payload.askSize ?? payload.ask_size ?? null;
    const volume = payload.volume ?? null;

    return {
        time,
        broker,
        symbol,
        price: lastPrice !== null ? Number(lastPrice) : null,
        bid: bid !== null ? Number(bid) : null,
        ask: ask !== null ? Number(ask) : null,
        bid_size: bidSize !== null ? Number(bidSize) : null,
        ask_size: askSize !== null ? Number(askSize) : null,
        volume: volume !== null ? Number(volume) : null,
        raw_flags: payload,
    };
}

function parseDepthMessage(_streamKey: string, messageId: string, fields: string[]): DepthSnapshot | null {
    const rawFields: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
        rawFields[fields[i]] = fields[i + 1];
    }

    let payload: any = {};
    if (rawFields['data']) {
        try {
            payload = JSON.parse(rawFields['data']);
        } catch (e) {
            log.error({ messageId, error: e }, 'Failed to parse L2 data');
            return null;
        }
    }

    return {
        time: payload.time ? new Date(payload.time) : new Date(),
        symbol: payload.symbol || rawFields['symbol'] || 'UNKNOWN',
        asset_id: payload.asset_id || null,
        l1_price: payload.l1_price ?? null,
        top_bid_price: payload.top_bid_price ?? null,
        top_bid_volume: payload.top_bid_volume ?? null,
        top_ask_price: payload.top_ask_price ?? null,
        top_ask_volume: payload.top_ask_volume ?? null,
        bid_levels: payload.bid_levels ?? 0,
        ask_levels: payload.ask_levels ?? 0,
        full_bids: payload.full_bids || [],
        full_asks: payload.full_asks || [],
    };
}

// -----------------------------------------------------------------------------
// Stream Readers
// -----------------------------------------------------------------------------

async function readQuoteStreams() {
    if (knownQuoteStreams.size === 0) return;

    const streams = Array.from(knownQuoteStreams);
    const ids = streams.map(() => '>');

    // @ts-ignore
    const response = await redis.xreadgroup(
        'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
        'BLOCK', 2000,
        'STREAMS', ...streams, ...ids
    );

    if (response) {
        for (const [streamKey, messages] of response as any) {
            for (const [messageId, fields] of messages) {
                try {
                    const tick = parseQuoteMessage(streamKey, messageId, fields);
                    if (tick) {
                        tickBuffer.push({ streamKey, messageId, data: tick });
                    }
                } catch (parseErr) {
                    log.error({ messageId, error: parseErr }, 'Error parsing quote');
                }
            }
        }
    }
}

async function readL2Streams() {
    if (knownL2Streams.size === 0) return;

    try {
        const streams = Array.from(knownL2Streams);
        const ids = streams.map(() => '>');

        log.debug({ count: streams.length }, '📡 Polling L2 streams...');

        // @ts-ignore — uses dedicated L2 Redis client to avoid blocking starvation
        const response = await redisL2.xreadgroup(
            'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
            'BLOCK', 500,
            'STREAMS', ...streams, ...ids
        );

        if (response && response.length > 0) {
            log.info({ count: response.length }, '📦 L2 xreadgroup returned data');
            for (const [streamKey, messages] of response as any) {
                for (const [messageId, fields] of messages) {
                    try {
                        const snapshot = parseDepthMessage(streamKey, messageId, fields);
                        if (snapshot) {
                            depthBuffer.push({ streamKey, messageId, data: snapshot });
                        }
                    } catch (parseErr) {
                        log.error({ messageId, error: parseErr }, 'Error parsing L2 depth');
                    }
                }
            }
        }
    } catch (err: any) {
        log.error({ error: err instanceof Error ? err.message : String(err) }, '❌ FATAL ERROR IN readL2Streams');
    }
}

// -----------------------------------------------------------------------------
// Main Loop
// -----------------------------------------------------------------------------

async function main() {
    log.info('🚀 Starting TimescaleWriter (L1 + L2)...');

    // Test Postgres Connection
    try {
        const client = await pool.connect();
        const res = await client.query('SELECT NOW()');
        log.info({ now: res.rows[0].now }, '✅ Connected to Postgres');
        client.release();
    } catch (err: any) {
        log.fatal({ error: err.message }, 'Fatal: Could not connect to Postgres');
        process.exit(1);
    }

    // Initial Discovery
    await discoverStreams();

    // Self-scheduling discovery (prevents interval overlap)
    async function scheduleDiscovery() {
        try {
            await discoverStreams();
        } catch (err: any) {
            log.error({ error: err.message }, 'Discovery error');
        } finally {
            setTimeout(scheduleDiscovery, DISCOVERY_INTERVAL_MS);
        }
    }
    setTimeout(scheduleDiscovery, DISCOVERY_INTERVAL_MS);

    // Main Consumer Loop
    while (true) {
        try {
            const tickBackpressure = tickBuffer.length >= MAX_BUFFER_SIZE;
            const depthBackpressure = depthBuffer.length >= MAX_BUFFER_SIZE;

            if (!tickBackpressure) {
                await readQuoteStreams();
            } else {
                log.warn({ bufferSize: tickBuffer.length, max: MAX_BUFFER_SIZE }, 'Tick buffer at capacity; pausing quote reads');
            }

            if (!depthBackpressure) {
                await readL2Streams();
            } else {
                log.warn({ bufferSize: depthBuffer.length, max: MAX_BUFFER_SIZE }, 'Depth buffer at capacity; pausing L2 reads');
            }

            const now = Date.now();
            const shouldPeriodicFlush = now - lastFlushTime >= FLUSH_INTERVAL_MS;

            if (tickBackpressure || shouldPeriodicFlush) {
                await flushTickBuffer();
            }

            if (depthBackpressure || shouldPeriodicFlush) {
                await flushDepthBuffer();
            }

            if (shouldPeriodicFlush) {
                lastFlushTime = now;
            }

            if (tickBackpressure || depthBackpressure) {
                await new Promise(r => setTimeout(r, 250));
                continue;
            }
        } catch (err: any) {
            log.error({ error: err.message }, 'Error in main loop');
            await new Promise(r => setTimeout(r, 1000));
        }
        await new Promise(r => setImmediate(r));
    }
}

main().catch(err => {
    log.fatal({ error: err }, 'Fatal error');
    process.exit(1);
});
