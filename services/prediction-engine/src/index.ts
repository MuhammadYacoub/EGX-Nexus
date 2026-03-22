/**
 * =============================================================================
 * Chaimera Broker Gateway — Application Entrypoint
 * =============================================================================
 *
 * Boot sequence for the broker-gateway microservice.
 *
 * Phase 1: WSListener + TradingView Normalizer
 *   - Reads manually-injected credentials from Redis
 *   - Connects to broker WebSocket (TradingView WSS)
 *   - Decodes TradingView's ~m~ framing protocol
 *   - Normalizes qsd messages into canonical QuoteTick
 *   - Publishes to Redis Streams
 *   - Echoes heartbeats to keep the connection alive
 *
 * Phase 2+: Will add 'auth' mode to boot the Playwright AuthManager.
 *
 * Usage:
 *   PROCESS_MODE=listener npm run dev
 */

import { config } from './config';
import { WSListener } from './tradingview/WSListener';
import { RedisPublisher } from './publisher/RedisPublisher';
import { TradingViewNormalizer } from './tradingview/TradingViewNormalizer';
import { disconnectRedis } from './redis/RedisClient';
import { logger } from './utils/logger';

const log = logger.child({ module: 'Main' });

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

let listener: WSListener | null = null;

async function shutdown(signal: string): Promise<void> {
    log.info({ signal }, `Received ${signal} — initiating graceful shutdown`);

    if (listener) {
        await listener.stop();
    }

    await disconnectRedis();

    log.info('👋 Shutdown complete');
    process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Catch unhandled rejections (log them, don't crash silently)
process.on('unhandledRejection', (reason) => {
    log.error({ reason }, 'Unhandled Promise rejection');
});

process.on('uncaughtException', (error) => {
    log.fatal({ error: error.message, stack: error.stack }, 'Uncaught exception — exiting');
    process.exit(1);
});

// ---------------------------------------------------------------------------
// Main Boot Sequence
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    log.info('='.repeat(60));
    log.info(`   Chaimera Broker Gateway — v${require('../package.json').version}`);
    log.info(`   Mode: ${config.processMode.toUpperCase()}`);
    log.info(`   Broker: ${config.brokerId}`);
    log.info(`   Protocol: TradingView (~m~ framing)`);
    log.info(`   Redis: ${config.redis.host}:${config.redis.port}/${config.redis.db}`);
    log.info('='.repeat(60));

    if (config.processMode === 'auth') {
        log.error('Auth Manager mode is not yet implemented (Phase 2). Use PROCESS_MODE=listener.');
        process.exit(1);
    }

    // --- Phase 1: TradingView Listener Mode ---
    const publisher = new RedisPublisher();

    // We use a wrapper object so the normalizer always calls the latest
    // listener.sendRaw(), even though `listener` is assigned after the
    // normalizer is created.
    const normalizer = new TradingViewNormalizer(
        publisher,
        (data: string) => {
            if (listener) {
                listener.sendRaw(data);
            } else {
                log.warn('sendRaw called before listener is ready — dropping');
            }
        }
    );

    // Create a single WSListener with the normalizer bound via closure
    listener = new WSListener({
        onMessage: (data, brokerId) => normalizer.handleRawFrame(data, brokerId),
        brokerId: config.brokerId,
        customHeaders: {
            'Origin': 'https://www.tradingview.com',
        },
    });

    await listener.start();

    log.info('🟢 Broker Gateway is running. Waiting for TradingView market data...');
    log.info(
        {
            availableHelpers: ['buildTVSubscriptions()', 'generateSessionId()'],
        },
        '💡 TradingView subscription helpers available — configure symbols via ws_metadata in Redis'
    );
}

// --- Execute ---
main().catch((error) => {
    log.fatal({ error: error.message }, 'Fatal error during startup');
    process.exit(1);
});
