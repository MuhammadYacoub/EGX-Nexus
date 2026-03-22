import TelegramBot from 'node-telegram-bot-api';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { logger } from '../utils/logger';
import * as dotenv from 'dotenv';

dotenv.config();

const log = logger.child({ module: 'AlertManager' });

// ─── Interfaces ──────────────────────────────────────────────────────
interface AISignalPayload {
    symbol: string;
    action?: string;
    signal?: string;
    price?: number;
    entry_price?: number;
    stop_loss?: number;
    confidence?: number;
    risk_amount?: number;
    risk_pct?: number;
    wobi?: number;
    regime?: string;
    timestamp?: string;
    reasoning?: string;
}

// ─── Configuration ──────────────────────────────────────────────────
const POLL_INTERVAL_MS = 60 * 1000;           // Smart-money SQL poll
const COOLDOWN_MS = 30 * 60 * 1000;           // 30 min cooldown per symbol
const RATIO_THRESHOLD = 2.0;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const SIGNAL_STREAM = 'chaimera:stream:signals:ai';
const CONSUMER_GROUP = 'alert_manager_group';
const CONSUMER_NAME = `alert_${Math.random().toString(36).substring(7)}`;

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!botToken || !chatId) {
    log.error({ 
        botToken: !!botToken, 
        chatId: !!chatId,
        PG_HOST: !!process.env.PG_HOST,
        REDIS_HOST: !!process.env.REDIS_HOST 
    }, '❌ Missing critical environment variables');
    process.exit(1);
}

const bot = new TelegramBot(botToken, { polling: false });

const pool = new Pool({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'password',
    database: process.env.PG_DB || 'chaimera',
});

const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    retryStrategy: (times) => Math.min(times * 50, 2000),
});

// ─── Cooldown State ─────────────────────────────────────────────────
const cooldownMap = new Map<string, number>();
const aiCooldownMap = new Map<string, number>();
const AI_COOLDOWN_MS = 15 * 60 * 1000; // 15 mins for AI signals

function isWithinMarketHours(): boolean {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Cairo',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    });
    const parts = formatter.formatToParts(new Date());
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);

    // EGX session 10:15 to 13:30 Cairo Time
    const minutesSinceMidnight = hour * 60 + minute;
    const startMins = 10 * 60 + 15;
    const endMins = 13 * 60 + 30;

    return minutesSinceMidnight >= startMins && minutesSinceMidnight <= endMins;
}

// ═════════════════════════════════════════════════════════════════════
//  SECTION 1: AI Signal Consumer (Redis Stream)
// ═════════════════════════════════════════════════════════════════════

async function ensureSignalConsumerGroup() {
    try {
        await redis.xgroup('CREATE', SIGNAL_STREAM, CONSUMER_GROUP, '0', 'MKSTREAM');
        log.info('Created consumer group for AI signals stream');
    } catch (err: any) {
        if (!err.message.includes('BUSYGROUP')) {
            log.error({ error: err.message }, 'Error creating signal consumer group');
        }
        // BUSYGROUP = group already exists, that's fine
    }
}

function formatAISignalMessage(payload: AISignalPayload): string {
    const action = payload.action ?? payload.signal;
    const signal = typeof action === 'string' ? action.toUpperCase() : 'UNKNOWN';
    const icon = signal === 'BUY' ? '🟢' : signal === 'SELL' ? '🔴' : '⚪';
    const label = signal === 'BUY' ? 'BUY ALERT' : signal === 'SELL' ? 'SELL ALERT' : 'SIGNAL';

    const symbol = payload.symbol || 'N/A';

    // Confidence as Percentage
    let confidence = 'N/A';
    if (payload.confidence != null) {
        const value = payload.confidence <= 1.0 ? payload.confidence * 100 : payload.confidence;
        confidence = `${value.toFixed(1)}%`;
    }

    // WOBI with 4 decimal places
    const wobi = payload.wobi != null ? payload.wobi.toFixed(4) : 'N/A';

    const regime = payload.regime || 'N/A';
    const timestamp = payload.timestamp || new Date().toISOString();

    // Prioritize price or entry_price
    const priceVal = payload.price ?? payload.entry_price;
    const price = priceVal != null ? priceVal.toFixed(2) : 'N/A';

    const stopLoss = payload.stop_loss != null ? payload.stop_loss.toFixed(2) : 'N/A';
    const riskAmt = payload.risk_amount != null ? payload.risk_amount.toFixed(2) : 'N/A';
    const riskPct = payload.risk_pct != null ? `${(payload.risk_pct * 100).toFixed(1)}%` : 'N/A';
    const reasoning = payload.reasoning || 'N/A';

    // Format time in a readable way
    let displayTime: string;
    try {
        const date = new Date(timestamp);
        displayTime = date.toLocaleString('en-GB', {
            timeZone: 'Africa/Cairo',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    } catch {
        displayTime = timestamp;
    }

    return `
${icon} *[${label}]*

*Symbol:* \`${symbol}\`
*Regime:* ${regime}
*Entry Price:* ${price}
*Stop Loss:* ${stopLoss}
*Confidence:* ${confidence}
*WOBI:* ${wobi}
*Risk:* EGP ${riskAmt} (${riskPct})
*Time:* ${displayTime}

*Reason:* ${reasoning}
    `.trim();
}

async function sendTelegramAlert(message: string, context: string) {
    try {
        await bot.sendMessage(chatId!, message, { parse_mode: 'Markdown' });
        log.info({ context }, '✅ Telegram alert sent');
    } catch (err) {
        log.error({ context, error: err instanceof Error ? err.message : String(err) },
            '❌ Failed to send Telegram alert');
    }
}

async function consumeAISignals() {
    try {
        // Fix ioredis typing by casting to any for the call, then typing the response
        const response = await (redis as any).xreadgroup(
            'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
            'BLOCK', 5000,
            'COUNT', 10,
            'STREAMS', SIGNAL_STREAM, '>'
        ) as [string, [string, string[]][]][] | null;

        if (!response) return;

        for (const [_streamKey, messages] of response) {
            for (const [messageId, fields] of messages) {
                try {
                    const rawFields: Record<string, string> = {};
                    for (let i = 0; i < fields.length; i += 2) {
                        rawFields[fields[i]] = fields[i + 1];
                    }

                    let payload: AISignalPayload;
                    if (rawFields['payload']) {
                        payload = JSON.parse(rawFields['payload']) as AISignalPayload;
                    } else {
                        // Fallback case: cast rawFields if they follow the interface
                        payload = rawFields as unknown as AISignalPayload;
                    }

                    if (!payload.symbol) {
                        log.warn({ messageId }, 'Missing symbol in signal payload — skipping');
                        await redis.xack(SIGNAL_STREAM, CONSUMER_GROUP, messageId);
                        continue;
                    }

                    log.info({
                        signal: payload.signal || payload.action,
                        symbol: payload.symbol,
                        confidence: payload.confidence,
                    }, '🧠 AI Signal received');

                    const action = payload.action ?? payload.signal ?? 'UNKNOWN';
                    const symbol = payload.symbol ?? 'UNKNOWN';
                    const cacheKey = `${symbol}:${action}`;
                    const now = Date.now();

                    if (!isWithinMarketHours()) {
                        log.debug({ symbol, action }, 'Ignored signal outside EGX market hours');
                        await redis.xack(SIGNAL_STREAM, CONSUMER_GROUP, messageId);
                        continue;
                    }

                    const lastAlert = aiCooldownMap.get(cacheKey) || 0;
                    if (now - lastAlert < AI_COOLDOWN_MS) {
                        log.debug({ symbol, action }, 'Ignored duplicate signal within 15m window');
                        await redis.xack(SIGNAL_STREAM, CONSUMER_GROUP, messageId);
                        continue;
                    }

                    aiCooldownMap.set(cacheKey, now);

                    const message = formatAISignalMessage(payload);
                    await sendTelegramAlert(message, `AI:${symbol}:${action}`);

                    // ACK the message
                    await redis.xack(SIGNAL_STREAM, CONSUMER_GROUP, messageId);

                } catch (parseErr) {
                    log.error({ messageId, error: parseErr instanceof Error ? parseErr.message : String(parseErr) },
                        'Error processing AI signal');
                    await redis.xack(SIGNAL_STREAM, CONSUMER_GROUP, messageId);
                }
            }
        }
    } catch (err) {
        log.error({ error: err instanceof Error ? err.message : String(err) },
            'Error consuming AI signals stream');
    }
}

// ═════════════════════════════════════════════════════════════════════
//  SECTION 2: Smart Money Detector (SQL Polling — original)
// ═════════════════════════════════════════════════════════════════════

async function checkSmartMoney() {
    log.debug('Checking for smart money accumulation signals...');
    try {
        const query = `
            SELECT 
                mds.symbol,
                mds.l1_price,
                mds.top_bid_volume,
                mds.top_ask_volume,
                ROUND((mds.top_bid_volume / NULLIF(mds.top_ask_volume, 0))::numeric, 2) as ratio,
                a.sector,
                a.pe_ratio
            FROM market_depth_snapshots mds
            JOIN assets a ON mds.asset_id = a.asset_id
            WHERE mds.time > NOW() - INTERVAL '5 minutes'
              AND mds.top_bid_volume IS NOT NULL
              AND mds.top_ask_volume IS NOT NULL
              AND (mds.top_bid_volume / NULLIF(mds.top_ask_volume, 0)) > $1
            ORDER BY mds.time DESC
        `;

        const { rows } = await pool.query(query, [RATIO_THRESHOLD]);

        const processedThisCycle = new Set<string>();

        for (const row of rows) {
            const sym = row.symbol;
            if (processedThisCycle.has(sym)) continue;
            processedThisCycle.add(sym);

            const lastAlert = cooldownMap.get(sym) || 0;
            const now = Date.now();

            if (now - lastAlert > COOLDOWN_MS) {
                const message = `
🚀 *SMART MONEY DETECTED!*
*Symbol:* ${sym}
*Price:* ${row.l1_price ?? 'N/A'}
*Buy/Sell Ratio:* ${row.ratio}
*Sector:* ${row.sector || 'N/A'}
*P/E:* ${row.pe_ratio || 'N/A'}
                `.trim();

                await sendTelegramAlert(message, `SmartMoney:${sym}`);
                cooldownMap.set(sym, now);
            }
        }
    } catch (err) {
        log.error({ error: err instanceof Error ? err.message : String(err) },
            '❌ Failed to check smart money signals');
    }
}

// ═════════════════════════════════════════════════════════════════════
//  MAIN
// ═════════════════════════════════════════════════════════════════════

async function start() {
    log.info('🤖 AlertManager starting...');
    log.info(`   Redis: ${REDIS_HOST}:${REDIS_PORT}`);
    log.info(`   Signal stream: ${SIGNAL_STREAM}`);
    log.info(`   Consumer: ${CONSUMER_GROUP}/${CONSUMER_NAME}`);

    // ── Set up Redis consumer group ─────────────────────────────────
    await ensureSignalConsumerGroup();

    // ── Start Smart Money SQL Poller ────────────────────────────────
    await checkSmartMoney();
    setInterval(checkSmartMoney, POLL_INTERVAL_MS);

    // ── Start AI Signal Stream Consumer (continuous loop) ───────────
    log.info('🔄 AI Signal consumer loop started');
    while (true) {
        try {
            await consumeAISignals();
        } catch (err) {
            log.error({ error: err instanceof Error ? err.message : String(err) },
                'AI signal consumer error — retrying in 2s');
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

start().catch(err => {
    log.error({ error: err instanceof Error ? err.message : String(err) }, '💀 AlertManager crashed');
    process.exit(1);
});
