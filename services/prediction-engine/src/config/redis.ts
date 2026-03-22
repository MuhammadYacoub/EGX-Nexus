/**
 * =============================================================================
 * Chaimera Broker Gateway — Redis Key Namespace Definitions
 * =============================================================================
 *
 * Centralizes all Redis key patterns used across the gateway.
 * Every key is scoped by the broker ID to support multi-broker deployments.
 *
 * Pattern: {prefix}broker:{brokerId}:{purpose}
 *
 * Usage:
 *   import { redisKeys } from '../config/redis';
 *   const tokenKey = redisKeys.token('tickerchart');
 */

import { config } from './index';

// ---------------------------------------------------------------------------
// Redis Key Factory
// ---------------------------------------------------------------------------

/**
 * Generates fully-qualified Redis keys for a given broker.
 * All keys include the global prefix from config.
 */
export const redisKeys = {
    /** Bearer token string — SET with TTL */
    token: (brokerId: string = config.brokerId): string =>
        `${config.redis.keyPrefix}broker:${brokerId}:token`,

    /** Session cookies (JSON serialized) — SET with TTL */
    cookies: (brokerId: string = config.brokerId): string =>
        `${config.redis.keyPrefix}broker:${brokerId}:cookies`,

    /** Target wss:// endpoint URL — SET with TTL */
    wsEndpoint: (brokerId: string = config.brokerId): string =>
        `${config.redis.keyPrefix}broker:${brokerId}:ws_endpoint`,

    /** WebSocket metadata: subscription payloads, custom headers (JSON) */
    wsMetadata: (brokerId: string = config.brokerId): string =>
        `${config.redis.keyPrefix}broker:${brokerId}:ws_metadata`,

    /** OTP value injected externally — short-lived key */
    otpValue: (brokerId: string = config.brokerId): string =>
        `${config.redis.keyPrefix}broker:${brokerId}:otp_value`,
} as const;

// ---------------------------------------------------------------------------
// Redis Channel (Pub/Sub) Definitions
// ---------------------------------------------------------------------------

/**
 * Generates Pub/Sub channel names for broker lifecycle events.
 */
export const redisChannels = {
    /** Published when fresh auth credentials are available in Redis */
    authReady: (brokerId: string = config.brokerId): string =>
        `${config.redis.keyPrefix}broker:${brokerId}:auth_ready`,

    /** Published when OTP is needed from an external provider */
    otpRequest: (brokerId: string = config.brokerId): string =>
        `${config.redis.keyPrefix}broker:${brokerId}:otp_request`,

    /** Lifecycle events: TOKEN_EXPIRING, TOKEN_REFRESHED, TOKEN_EXPIRED */
    lifecycle: (brokerId: string = config.brokerId): string =>
        `${config.redis.keyPrefix}broker:${brokerId}:lifecycle`,
} as const;

// ---------------------------------------------------------------------------
// Redis Stream Key Definitions
// ---------------------------------------------------------------------------

/**
 * Generates Redis Stream keys for normalized market data output.
 */
export const redisStreams = {
    /** Level 2 order book tick stream, scoped by broker + symbol */
    l2Tick: (symbol: string, brokerId: string = config.brokerId): string =>
        `${config.redis.keyPrefix}stream:l2:${brokerId}:${symbol.toUpperCase()}`,

    /** Level 1 quote tick stream, scoped by broker + symbol */
    quoteTick: (symbol: string, brokerId: string = config.brokerId): string =>
        `${config.redis.keyPrefix}stream:quote:${brokerId}:${symbol.toUpperCase()}`,
} as const;

// ---------------------------------------------------------------------------
// Lifecycle Event Constants
// ---------------------------------------------------------------------------

/** Well-known lifecycle event payloads published to the lifecycle channel */
export const LifecycleEvents = {
    TOKEN_EXPIRING: 'TOKEN_EXPIRING',
    TOKEN_REFRESHED: 'TOKEN_REFRESHED',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    TOKEN_MISSING: 'TOKEN_MISSING',
    AUTH_FAILED: 'AUTH_FAILED',
} as const;

export type LifecycleEvent = typeof LifecycleEvents[keyof typeof LifecycleEvents];
