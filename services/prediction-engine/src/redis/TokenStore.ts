/**
 * =============================================================================
 * Chaimera Broker Gateway — Token Store
 * =============================================================================
 *
 * Manages reading and writing broker authentication credentials in Redis.
 *
 * Phase 1 (Manual Injection):
 *   An admin manually writes the token and WS endpoint to Redis using
 *   the `scripts/inject-token.ts` CLI tool. This class reads those values.
 *
 * Phase 2+ (Auth Manager):
 *   The AuthManager will write tokens here after automated browser auth.
 *   The interface remains the same — consumers don't know who wrote the token.
 *
 * Usage:
 *   import { TokenStore } from '../redis/TokenStore';
 *
 *   const store = new TokenStore();
 *   const creds = await store.getCredentials();
 *   if (creds) {
 *     console.log(creds.token, creds.wsEndpoint);
 *   }
 */

import { getRedisClient } from './RedisClient';
import { redisKeys } from '../config/redis';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'TokenStore' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Complete set of broker credentials needed to establish a WebSocket connection.
 * Every field is read from a separate Redis key so they can be updated independently.
 */
export interface BrokerCredentials {
    /** The Bearer token or session token string */
    token: string;

    /** The wss:// endpoint URL to connect to */
    wsEndpoint: string;

    /** Optional: Session cookies as a JSON-serialized string */
    cookies: string | null;

    /** Optional: WebSocket metadata (subscription payloads, headers) as JSON string */
    wsMetadata: string | null;

    /** Remaining TTL of the token in seconds (-1 = no expiry, -2 = key missing) */
    tokenTtlSeconds: number;
}

// ---------------------------------------------------------------------------
// Token Store Class
// ---------------------------------------------------------------------------

export class TokenStore {
    private readonly brokerId: string;

    constructor(brokerId?: string) {
        this.brokerId = brokerId || '';  // empty = use default from config
    }

    // -------------------------------------------------------------------------
    // Read Operations
    // -------------------------------------------------------------------------

    /**
     * Retrieves the full set of broker credentials from Redis.
     *
     * Returns `null` if the mandatory fields (token, wsEndpoint) are missing.
     * This indicates that no admin has injected credentials yet, or they expired.
     *
     * Uses a Redis pipeline (MULTI) to fetch all keys in a single round-trip.
     */
    async getCredentials(): Promise<BrokerCredentials | null> {
        const redis = getRedisClient();

        const tokenKey = redisKeys.token(this.brokerId);
        const endpointKey = redisKeys.wsEndpoint(this.brokerId);
        const cookiesKey = redisKeys.cookies(this.brokerId);
        const metadataKey = redisKeys.wsMetadata(this.brokerId);

        // Pipeline: all commands sent in one network round-trip
        const pipeline = redis.pipeline();
        pipeline.get(tokenKey);
        pipeline.get(endpointKey);
        pipeline.get(cookiesKey);
        pipeline.get(metadataKey);
        pipeline.ttl(tokenKey);

        const results = await pipeline.exec();

        if (!results) {
            log.error('Redis pipeline returned null — connection issue');
            return null;
        }

        // Pipeline results: [ [error, value], [error, value], ... ]
        const [tokenResult, endpointResult, cookiesResult, metadataResult, ttlResult] = results;

        const token = tokenResult[1] as string | null;
        const wsEndpoint = endpointResult[1] as string | null;
        const cookies = cookiesResult[1] as string | null;
        const wsMetadata = metadataResult[1] as string | null;
        const tokenTtl = ttlResult[1] as number;

        // Validate mandatory fields
        if (!token) {
            log.warn({ key: tokenKey }, 'Token not found in Redis — has it been injected?');
            return null;
        }

        if (!wsEndpoint) {
            log.warn({ key: endpointKey }, 'WS endpoint not found in Redis — has it been injected?');
            return null;
        }

        log.debug(
            { brokerId: this.brokerId, tokenTtl, hasMetadata: !!wsMetadata },
            'Credentials loaded from Redis'
        );

        return {
            token,
            wsEndpoint,
            cookies,
            wsMetadata,
            tokenTtlSeconds: tokenTtl,
        };
    }

    /**
     * Checks only the token TTL without fetching the full credential set.
     * Used by the TokenWatcher for lightweight periodic checks.
     *
     * @returns TTL in seconds, -1 if no expiry set, -2 if key doesn't exist
     */
    async getTokenTtl(): Promise<number> {
        const redis = getRedisClient();
        const ttl = await redis.ttl(redisKeys.token(this.brokerId));
        return ttl;
    }

    /**
     * Quick existence check — does a valid token exist in Redis?
     */
    async hasValidToken(): Promise<boolean> {
        const redis = getRedisClient();
        const exists = await redis.exists(redisKeys.token(this.brokerId));
        return exists === 1;
    }

    // -------------------------------------------------------------------------
    // Write Operations (used by inject-token script & future AuthManager)
    // -------------------------------------------------------------------------

    /**
     * Stores broker credentials in Redis with an optional TTL.
     *
     * @param token - Bearer token string
     * @param wsEndpoint - WebSocket endpoint URL (wss://...)
     * @param options - Optional: cookies, metadata, TTL
     */
    async setCredentials(
        token: string,
        wsEndpoint: string,
        options: {
            cookies?: string;
            wsMetadata?: string;
            /** TTL in seconds. If omitted, keys persist until manually deleted. */
            ttlSeconds?: number;
        } = {}
    ): Promise<void> {
        const redis = getRedisClient();
        const { cookies, wsMetadata, ttlSeconds } = options;

        const pipeline = redis.pipeline();

        // SET token
        if (ttlSeconds && ttlSeconds > 0) {
            pipeline.set(redisKeys.token(this.brokerId), token, 'EX', ttlSeconds);
            pipeline.set(redisKeys.wsEndpoint(this.brokerId), wsEndpoint, 'EX', ttlSeconds);
        } else {
            pipeline.set(redisKeys.token(this.brokerId), token);
            pipeline.set(redisKeys.wsEndpoint(this.brokerId), wsEndpoint);
        }

        // Optional fields
        if (cookies) {
            if (ttlSeconds && ttlSeconds > 0) {
                pipeline.set(redisKeys.cookies(this.brokerId), cookies, 'EX', ttlSeconds);
            } else {
                pipeline.set(redisKeys.cookies(this.brokerId), cookies);
            }
        }

        if (wsMetadata) {
            if (ttlSeconds && ttlSeconds > 0) {
                pipeline.set(redisKeys.wsMetadata(this.brokerId), wsMetadata, 'EX', ttlSeconds);
            } else {
                pipeline.set(redisKeys.wsMetadata(this.brokerId), wsMetadata);
            }
        }

        await pipeline.exec();

        log.info(
            {
                brokerId: this.brokerId,
                ttlSeconds: ttlSeconds || 'none',
                hasMetadata: !!wsMetadata,
            },
            'Credentials stored in Redis'
        );
    }

    /**
     * Removes all credentials for this broker from Redis.
     * Used during testing or when invalidating a known-bad token.
     */
    async clearCredentials(): Promise<void> {
        const redis = getRedisClient();

        await redis.del(
            redisKeys.token(this.brokerId),
            redisKeys.wsEndpoint(this.brokerId),
            redisKeys.cookies(this.brokerId),
            redisKeys.wsMetadata(this.brokerId)
        );

        log.info({ brokerId: this.brokerId }, 'Credentials cleared from Redis');
    }
}
