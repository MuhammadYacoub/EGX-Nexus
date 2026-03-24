/**
 * =============================================================================
 * Chaimera Broker Gateway — Unified Configuration Loader
 * =============================================================================
 *
 * Single source of truth for all environment-driven configuration.
 * All values are typed, validated, and have sensible defaults.
 *
 * Usage:
 *   import { config } from '../config';
 *   console.log(config.redis.host);
 */

import * as dotenv from 'dotenv';

// Load .env file (if it exists in the current working directory)
dotenv.config();

// ---------------------------------------------------------------------------
// Helper: Read env var with type coercion and default
// ---------------------------------------------------------------------------

function envStr(key: string, fallback: string): string {
    return process.env[key]?.trim() || fallback;
}

function envInt(key: string, fallback: number): number {
    const raw = process.env[key]?.trim();
    if (!raw) return fallback;
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed)) {
        throw new Error(`[Config] Invalid integer for ${key}: "${raw}"`);
    }
    return parsed;
}

function envBool(key: string, fallback: boolean): boolean {
    const raw = process.env[key]?.trim()?.toLowerCase();
    if (!raw) return fallback;
    return raw === 'true' || raw === '1' || raw === 'yes';
}

// ---------------------------------------------------------------------------
// Configuration Interface
// ---------------------------------------------------------------------------

const VALID_MODES = ['listener', 'auth', 'thndr', 'writer', 'alerts', 'portfolio'] as const;
type ProcessMode = (typeof VALID_MODES)[number];

export interface AppConfig {
    /** Target broker identifier — used as namespace in all Redis keys */
    readonly brokerId: string;

    /** Which process mode to boot */
    readonly processMode: ProcessMode;

    readonly redis: {
        readonly host: string;
        readonly port: number;
        readonly password: string;
        readonly db: number;
        readonly keyPrefix: string;
    };

    readonly ws: {
        /** Max reconnection attempts before process exits */
        readonly maxReconnectAttempts: number;
        /** Base delay (ms) for exponential backoff */
        readonly reconnectBaseDelayMs: number;
        /** Maximum delay cap (ms) for exponential backoff */
        readonly reconnectMaxDelayMs: number;
        /** Interval (ms) between WebSocket ping frames */
        readonly pingIntervalMs: number;
        /** Timeout (ms) to wait for pong before declaring connection dead */
        readonly pongTimeoutMs: number;
    };

    readonly token: {
        /** How often (seconds) to poll Redis for token TTL */
        readonly checkIntervalS: number;
        /** TTL threshold (seconds) below which TOKEN_EXPIRING is published */
        readonly refreshThresholdS: number;
    };

    readonly auth: {
        /** TradingView username/email */
        readonly username: string;
        /** TradingView password */
        readonly password: string;
        /** Run browser in headless mode */
        readonly headless: boolean;
        /** Hours between automatic credential refreshes */
        readonly refreshHours: number;
    };

    readonly log: {
        readonly level: string;
        readonly format: 'json' | 'pretty';
    };
}

const VALID_LOG_FORMATS = ['json', 'pretty'] as const;
type LogFormat = (typeof VALID_LOG_FORMATS)[number];

// ---------------------------------------------------------------------------
// Build & Export Config
// ---------------------------------------------------------------------------

const processModeRaw = envStr('PROCESS_MODE', 'listener');
if (!(VALID_MODES as readonly string[]).includes(processModeRaw)) {
    throw new Error(
        `[Config] PROCESS_MODE must be one of [${VALID_MODES.join(', ')}], got: "${processModeRaw}"`
    );
}
const processMode = processModeRaw as ProcessMode;

export const config: AppConfig = Object.freeze({
    brokerId: envStr('BROKER_ID', 'default'),
    processMode,

    redis: Object.freeze({
        host: envStr('REDIS_HOST', '127.0.0.1'),
        port: envInt('REDIS_PORT', 6379),
        password: envStr('REDIS_PASSWORD', ''),
        db: envInt('REDIS_DB', 0),
        keyPrefix: envStr('REDIS_KEY_PREFIX', 'chaimera:'),
    }),

    ws: Object.freeze({
        maxReconnectAttempts: envInt('WS_MAX_RECONNECT_ATTEMPTS', 20),
        reconnectBaseDelayMs: envInt('WS_RECONNECT_BASE_DELAY_MS', 1000),
        reconnectMaxDelayMs: envInt('WS_RECONNECT_MAX_DELAY_MS', 60000),
        pingIntervalMs: envInt('WS_PING_INTERVAL_MS', 30000),
        pongTimeoutMs: envInt('WS_PONG_TIMEOUT_MS', 10000),
    }),

    token: Object.freeze({
        checkIntervalS: envInt('TOKEN_CHECK_INTERVAL_S', 30),
        refreshThresholdS: envInt('TOKEN_REFRESH_THRESHOLD_S', 120),
    }),

    auth: Object.freeze({
        username: envStr('TV_USERNAME', ''),
        password: envStr('TV_PASSWORD', ''),
        headless: envBool('HEADLESS_MODE', true),
        refreshHours: envInt('AUTH_REFRESH_HOURS', 12),
    }),

    log: Object.freeze({
        level: envStr('LOG_LEVEL', 'info'),
        format: (VALID_LOG_FORMATS as readonly string[]).includes(envStr('LOG_FORMAT', 'pretty'))
            ? (envStr('LOG_FORMAT', 'pretty') as LogFormat)
            : 'pretty',
    }),
});
