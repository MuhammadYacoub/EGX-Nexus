/**
 * =============================================================================
 * Chaimera Broker Gateway — Redis Stream Publisher
 * =============================================================================
 *
 * Publishes normalized L2Tick data to Redis Streams for downstream
 * Layer 1 consumers. Also publishes lifecycle events to Pub/Sub channels.
 *
 * Redis Streams are used instead of Pub/Sub for market data because:
 *   1. Durability — messages persist even if no consumer is connected
 *   2. Consumer groups — multiple Layer 1 instances can share the load
 *   3. Replay — consumers can re-read historical ticks from a stream
 *   4. Backpressure — MAXLEN caps prevent unbounded memory growth
 *
 * Usage:
 *   import { RedisPublisher } from '../publisher/RedisPublisher';
 *
 *   const publisher = new RedisPublisher();
 *   await publisher.publishL2Tick(tick);
 *   await publisher.publishLifecycleEvent('TOKEN_EXPIRING');
 */

import { getRedisClient } from '../redis/RedisClient';
import { redisStreams, redisChannels, type LifecycleEvent } from '../config/redis';
import { config } from '../config';
import { type L2Tick, serializeL2Tick } from '../normalizer/schemas/L2Tick';
import { type QuoteTick, serializeQuoteTick } from '../normalizer/schemas/QuoteTick';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'RedisPublisher' });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Maximum number of entries to keep per Redis Stream.
 * Uses approximate trimming (~) for performance — Redis may keep
 * slightly more entries than this limit.
 *
 * At 10 ticks/second, 100k entries ≈ ~2.7 hours of history per symbol.
 */
const STREAM_MAXLEN = 100_000;

// ---------------------------------------------------------------------------
// Publisher Class
// ---------------------------------------------------------------------------

export class RedisPublisher {
    private readonly brokerId: string;

    /** Running count of published ticks (for periodic logging) */
    private tickCount: number = 0;

    /** Timestamp of last stats log */
    private lastStatsLogAt: number = Date.now();

    /** Stats logging interval (ms) — log throughput every 60 seconds */
    private readonly statsIntervalMs: number = 60_000;

    constructor(brokerId?: string) {
        this.brokerId = brokerId || config.brokerId;
    }

    // -------------------------------------------------------------------------
    // Market Data Publishing (Redis Streams)
    // -------------------------------------------------------------------------

    /**
     * Publishes a normalized L2 tick to the appropriate Redis Stream.
     *
     * Stream key: `chaimera:stream:l2:{brokerId}:{SYMBOL}`
     *
     * The stream is capped at STREAM_MAXLEN entries using approximate
     * trimming to bound memory usage. Redis auto-generates the entry ID
     * (timestamp-sequence format) for ordering.
     *
     * @param tick - The normalized L2Tick to publish
     */
    async publishL2Tick(tick: L2Tick): Promise<void> {
        const redis = getRedisClient();
        const streamKey = redisStreams.l2Tick(tick.symbol, this.brokerId);
        const fields = serializeL2Tick(tick);

        try {
            // XADD with approximate MAXLEN trimming
            // '*' = auto-generate ID (Redis uses <timestamp>-<sequence>)
            // '~' = approximate trimming (faster than exact)
            const args: (string | number)[] = [streamKey, 'MAXLEN', '~', STREAM_MAXLEN, '*'];

            // Flatten the fields Record into alternating key-value args
            for (const [key, value] of Object.entries(fields)) {
                args.push(key, value);
            }

            await redis.xadd(...(args as [string, ...Array<string | number>]));

            // Track throughput
            this.tickCount++;
            this.maybeLogStats();
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(
                { symbol: tick.symbol, streamKey, error: err.message },
                'Failed to publish L2 tick to Redis Stream'
            );
            // Don't throw — we don't want a single publish failure to crash the listener.
            // The tick is lost, but the stream continues. This is a deliberate trade-off:
            // market data is ephemeral, and a brief publish failure is preferable to a crash.
        }
    }

    /**
     * Publishes multiple ticks in a Redis pipeline for batch efficiency.
     * Used when processing snapshot updates that contain many price levels
     * that need to be published as individual symbol updates.
     */
    async publishL2TickBatch(ticks: L2Tick[]): Promise<void> {
        if (ticks.length === 0) return;

        const redis = getRedisClient();
        const pipeline = redis.pipeline();

        for (const tick of ticks) {
            const streamKey = redisStreams.l2Tick(tick.symbol, this.brokerId);
            const fields = serializeL2Tick(tick);

            const args: (string | number)[] = ['MAXLEN', '~', STREAM_MAXLEN, '*'];
            for (const [key, value] of Object.entries(fields)) {
                args.push(key, value);
            }

            pipeline.xadd(streamKey, ...(args as [string, ...Array<string | number>]));
        }

        try {
            await pipeline.exec();
            this.tickCount += ticks.length;
            this.maybeLogStats();
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(
                { batchSize: ticks.length, error: err.message },
                'Failed to publish L2 tick batch to Redis Streams'
            );
        }
    }

    /**
     * Publishes a normalized QuoteTick (Level 1) to the appropriate Redis Stream.
     *
     * Stream key: `chaimera:stream:quote:{brokerId}:{SYMBOL}`
     *
     * @param tick - The normalized QuoteTick to publish
     */
    async publishQuoteTick(tick: QuoteTick): Promise<void> {
        const redis = getRedisClient();
        const streamKey = redisStreams.quoteTick(tick.symbol, this.brokerId);
        const fields = serializeQuoteTick(tick);

        try {
            const args: (string | number)[] = [streamKey, 'MAXLEN', '~', STREAM_MAXLEN, '*'];

            for (const [key, value] of Object.entries(fields)) {
                args.push(key, value);
            }

            await redis.xadd(...(args as [string, ...Array<string | number>]));

            this.tickCount++;
            this.maybeLogStats();
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(
                { symbol: tick.symbol, streamKey, error: err.message },
                'Failed to publish QuoteTick to Redis Stream'
            );
        }
    }

    // -------------------------------------------------------------------------
    // Lifecycle Event Publishing (Pub/Sub)
    // -------------------------------------------------------------------------

    /**
     * Publishes a lifecycle event to the broker's Pub/Sub channel.
     * Used to signal token expiry, refresh, and other coordination events.
     *
     * @param event - One of the well-known LifecycleEvent constants
     * @param metadata - Optional JSON-serializable metadata
     */
    async publishLifecycleEvent(
        event: LifecycleEvent,
        metadata?: Record<string, unknown>
    ): Promise<void> {
        const redis = getRedisClient();
        const channel = redisChannels.lifecycle(this.brokerId);

        const payload = JSON.stringify({
            event,
            brokerId: this.brokerId,
            timestamp: Date.now(),
            ...metadata,
        });

        try {
            const subscriberCount = await redis.publish(channel, payload);
            log.info(
                { event, channel, subscribers: subscriberCount },
                'Published lifecycle event'
            );
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(
                { event, channel, error: err.message },
                'Failed to publish lifecycle event'
            );
        }
    }

    // -------------------------------------------------------------------------
    // Throughput Stats
    // -------------------------------------------------------------------------

    /**
     * Periodically logs tick throughput stats for observability.
     */
    private maybeLogStats(): void {
        const now = Date.now();
        const elapsed = now - this.lastStatsLogAt;

        if (elapsed >= this.statsIntervalMs) {
            const ticksPerSecond = (this.tickCount / (elapsed / 1000)).toFixed(2);
            log.info(
                {
                    totalTicks: this.tickCount,
                    ticksPerSecond,
                    intervalMs: elapsed,
                },
                'Publisher throughput stats'
            );
            this.tickCount = 0;
            this.lastStatsLogAt = now;
        }
    }
}
