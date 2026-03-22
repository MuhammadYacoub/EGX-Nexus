/**
 * =============================================================================
 * Chaimera Broker Gateway — Redis Client Singleton
 * =============================================================================
 *
 * Provides a managed ioredis connection with automatic reconnection,
 * structured logging, and graceful shutdown support.
 *
 * Architecture Note:
 *   We maintain TWO separate Redis connections:
 *   1. `client` — For GET/SET/XADD operations (data path)
 *   2. `subscriber` — For SUBSCRIBE/PSUBSCRIBE (Pub/Sub requires a dedicated connection)
 *
 *   ioredis enforces that a connection in subscriber mode cannot issue
 *   regular commands. This dual-connection pattern is standard practice.
 *
 * Usage:
 *   import { getRedisClient, getRedisSubscriber, disconnectRedis } from '../redis/RedisClient';
 *
 *   const redis = getRedisClient();
 *   await redis.set('key', 'value');
 *
 *   const sub = getRedisSubscriber();
 *   await sub.subscribe('channel');
 *   sub.on('message', (channel, message) => { ... });
 */

import Redis, { type RedisOptions } from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'RedisClient' });

// ---------------------------------------------------------------------------
// Connection Options (shared between both clients)
// ---------------------------------------------------------------------------

function buildRedisOptions(name: string): RedisOptions {
    return {
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password || undefined,
        db: config.redis.db,

        // Connection identification for Redis CLIENT LIST
        connectionName: `chaimera-gateway-${name}`,

        // Reconnection: ioredis handles this natively with exponential backoff
        retryStrategy(times: number): number | null {
            if (times > 50) {
                log.fatal({ times }, 'Redis reconnection attempts exhausted — shutting down');
                process.exit(1);
            }
            // Exponential backoff: 100ms, 200ms, 400ms ... capped at 30s
            const delay = Math.min(times * 100, 30_000);
            log.warn({ times, delayMs: delay }, 'Reconnecting to Redis...');
            return delay;
        },

        // Automatically re-subscribe to channels on reconnect (critical for Pub/Sub)
        autoResubscribe: true,

        // Reconnect on certain fatal errors
        reconnectOnError(err: Error): boolean | 1 | 2 {
            const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
            if (targetErrors.some((e) => err.message.includes(e))) {
                log.warn({ error: err.message }, 'Reconnecting due to recoverable Redis error');
                return true;
            }
            return false;
        },

        // Keep TCP connection alive
        keepAlive: 10_000,

        // Command timeout
        commandTimeout: 5_000,
    };
}

// ---------------------------------------------------------------------------
// Singleton Instances
// ---------------------------------------------------------------------------

let clientInstance: Redis | null = null;
let subscriberInstance: Redis | null = null;

/**
 * Returns the singleton Redis client for data operations (GET/SET/XADD etc.).
 * The connection is lazily created on first call.
 */
export function getRedisClient(): Redis {
    if (!clientInstance) {
        log.info(
            { host: config.redis.host, port: config.redis.port, db: config.redis.db },
            'Creating Redis data client'
        );

        clientInstance = new Redis(buildRedisOptions('data'));

        clientInstance.on('connect', () => {
            log.info('Redis data client connected');
        });

        clientInstance.on('error', (err) => {
            log.error({ error: err.message }, 'Redis data client error');
        });

        clientInstance.on('close', () => {
            log.warn('Redis data client connection closed');
        });
    }

    return clientInstance;
}

/**
 * Returns a dedicated Redis client for Pub/Sub subscriptions.
 * This connection CANNOT be used for regular commands once subscribed.
 */
export function getRedisSubscriber(): Redis {
    if (!subscriberInstance) {
        log.info(
            { host: config.redis.host, port: config.redis.port, db: config.redis.db },
            'Creating Redis subscriber client'
        );

        subscriberInstance = new Redis(buildRedisOptions('subscriber'));

        subscriberInstance.on('connect', () => {
            log.info('Redis subscriber client connected');
        });

        subscriberInstance.on('error', (err) => {
            log.error({ error: err.message }, 'Redis subscriber client error');
        });

        subscriberInstance.on('close', () => {
            log.warn('Redis subscriber client connection closed');
        });
    }

    return subscriberInstance;
}

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

/**
 * Gracefully disconnects both Redis clients.
 * Should be called during SIGTERM/SIGINT handling.
 */
export async function disconnectRedis(): Promise<void> {
    log.info('Disconnecting Redis clients...');

    const disconnections: Promise<void>[] = [];

    if (clientInstance) {
        disconnections.push(
            clientInstance
                .quit()
                .then(() => {
                    clientInstance = null;
                    log.info('Redis data client disconnected');
                })
                .catch((err) => {
                    log.error({ error: err.message }, 'Error disconnecting Redis data client');
                    clientInstance?.disconnect();
                    clientInstance = null;
                })
        );
    }

    if (subscriberInstance) {
        disconnections.push(
            subscriberInstance
                .quit()
                .then(() => {
                    subscriberInstance = null;
                    log.info('Redis subscriber client disconnected');
                })
                .catch((err) => {
                    log.error({ error: err.message }, 'Error disconnecting Redis subscriber client');
                    subscriberInstance?.disconnect();
                    subscriberInstance = null;
                })
        );
    }

    await Promise.all(disconnections);
}
