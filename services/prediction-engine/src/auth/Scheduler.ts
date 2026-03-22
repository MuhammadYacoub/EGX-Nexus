/**
 * =============================================================================
 * Chaimera Broker Gateway — Auth Scheduler
 * =============================================================================
 *
 * Manages the automated credential refresh lifecycle:
 *   1. Check if valid token exists on startup → run auth immediately if not
 *   2. Schedule periodic refresh every AUTH_REFRESH_HOURS
 *   3. On success: persist to Redis + publish TOKEN_REFRESHED
 *   4. Graceful shutdown on SIGINT/SIGTERM
 */

import { TradingViewAuth, type TVCredentials } from './TradingViewAuth';
import { TokenStore } from '../redis/TokenStore';
import { SignalBus } from '../redis/SignalBus';
import { LifecycleEvents } from '../config/redis';
import { config } from '../config';
import { logger } from '../utils/logger';
import { disconnectRedis } from '../redis/RedisClient';

const log = logger.child({ module: 'AuthScheduler' });

// ---------------------------------------------------------------------------
// Scheduler Class
// ---------------------------------------------------------------------------

export class AuthScheduler {
    private readonly auth = new TradingViewAuth();
    private readonly tokenStore = new TokenStore(config.brokerId);
    private readonly signalBus = new SignalBus(config.brokerId);
    private refreshTimer: NodeJS.Timeout | null = null;
    private isRunning = false;

    /**
     * Starts the scheduler:
     *   - Run immediately if no valid token exists
     *   - Schedule periodic refresh
     */
    async start(): Promise<void> {
        this.isRunning = true;
        const intervalHours = config.auth.refreshHours;
        const intervalMs = intervalHours * 60 * 60 * 1000;

        log.info(
            { refreshHours: intervalHours },
            '🚀 AuthScheduler starting'
        );

        // Check if a valid token already exists
        const hasToken = await this.tokenStore.hasValidToken();

        if (!hasToken) {
            log.info('🔑 No valid token in Redis — running auth immediately');
            await this.runAuth();
        } else {
            const ttl = await this.tokenStore.getTokenTtl();
            log.info(
                { ttlSeconds: ttl },
                '✅ Valid token found in Redis — scheduling next refresh'
            );
        }

        // Schedule periodic refresh
        this.refreshTimer = setInterval(async () => {
            if (!this.isRunning) return;
            log.info('⏰ Scheduled auth refresh triggered');
            await this.runAuth();
        }, intervalMs);

        log.info(
            { nextRefreshIn: `${intervalHours}h` },
            '📅 Periodic refresh scheduled'
        );
    }

    /**
     * Execute a single auth cycle: login → extract → persist → signal
     */
    async runAuth(): Promise<TVCredentials | null> {
        try {
            log.info('🔄 Starting auth cycle...');

            // Step 1: Authenticate via Playwright
            const creds = await this.auth.authenticate();

            // Step 2: Persist credentials to Redis
            const ttlSeconds = config.auth.refreshHours * 60 * 60;

            await this.tokenStore.setCredentials(
                creds.authToken || creds.sessionid, // Use authToken if available, fall back to sessionid
                creds.wsEndpoint,
                {
                    cookies: creds.cookiesJson,
                    ttlSeconds,
                }
            );

            log.info(
                {
                    sessionid: creds.sessionid.substring(0, 10) + '...',
                    hasAuthToken: !!creds.authToken,
                    ttlHours: config.auth.refreshHours,
                },
                '💾 Credentials persisted to Redis'
            );

            // Step 3: Publish TOKEN_REFRESHED so WSListener reconnects
            await this.signalBus.publish(LifecycleEvents.TOKEN_REFRESHED, {
                source: 'auth_manager',
                hasAuthToken: !!creds.authToken,
                timestamp: Date.now(),
            });

            log.info('📡 TOKEN_REFRESHED signal published');

            return creds;

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(
                { error: err.message, stack: err.stack },
                '❌ Auth cycle failed'
            );
            return null;
        }
    }

    /**
     * Graceful shutdown
     */
    async stop(): Promise<void> {
        this.isRunning = false;

        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }

        await disconnectRedis();
        log.info('🛑 AuthScheduler stopped');
    }
}
