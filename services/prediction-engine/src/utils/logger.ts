/**
 * =============================================================================
 * Chaimera Broker Gateway — Structured Logger
 * =============================================================================
 *
 * Wraps Pino for structured JSON logging in production and pretty-printing
 * in development. All modules should import `logger` from here — never
 * use console.log directly.
 *
 * Usage:
 *   import { logger } from '../utils/logger';
 *   const log = logger.child({ module: 'WSListener' });
 *   log.info({ url: 'wss://...' }, 'Connected to broker');
 */

import pino from 'pino';
import { config } from '../config';

// ---------------------------------------------------------------------------
// Logger Factory
// ---------------------------------------------------------------------------

/**
 * Root logger instance. Create child loggers with `.child({ module: '...' })`
 * to add contextual metadata to every log line from that module.
 */
export const logger = pino({
    name: 'chaimera-broker-gateway',
    level: config.log.level,

    // Pretty-print in development, raw JSON in production
    ...(config.log.format === 'pretty'
        ? {
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:HH:MM:ss.l',
                    ignore: 'pid,hostname',
                },
            },
        }
        : {}),
});
