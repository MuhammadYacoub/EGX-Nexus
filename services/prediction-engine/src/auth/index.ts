#!/usr/bin/env ts-node
/**
 * =============================================================================
 * Chaimera Broker Gateway — AuthManager Entrypoint
 * =============================================================================
 *
 * Boots the AuthScheduler which handles automated TradingView login
 * and credential refreshing.
 *
 * Usage:
 *   npm run auth
 *   # or
 *   npx ts-node src/auth/index.ts
 *
 * Environment Variables (see .env):
 *   TV_USERNAME       - TradingView username/email
 *   TV_PASSWORD       - TradingView password
 *   HEADLESS_MODE     - true/false (default: true)
 *   AUTH_REFRESH_HOURS - Hours between refreshes (default: 12)
 */

import { config } from '../config';
import { logger } from '../utils/logger';
import { AuthScheduler } from './Scheduler';

const log = logger.child({ module: 'AuthMain' });

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    log.info('============================================================');
    log.info('   Chaimera AuthManager — Automated TradingView Login');
    log.info(`   Broker:   ${config.brokerId}`);
    log.info(`   Headless: ${config.auth.headless}`);
    log.info(`   Refresh:  Every ${config.auth.refreshHours}h`);
    log.info('============================================================');

    // Validate config
    if (!config.auth.username || !config.auth.password) {
        log.error('❌ TV_USERNAME and TV_PASSWORD must be set in .env');
        process.exit(1);
    }

    const scheduler = new AuthScheduler();

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        log.info({ signal }, 'Received shutdown signal');
        await scheduler.stop();
        log.info('👋 AuthManager shutdown complete');
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Start the scheduler
    await scheduler.start();

    log.info('🟢 AuthManager is running. Press Ctrl+C to stop.');
}

main().catch((err) => {
    log.error({ error: (err as Error).message }, '💀 Fatal error in AuthManager');
    process.exit(1);
});
