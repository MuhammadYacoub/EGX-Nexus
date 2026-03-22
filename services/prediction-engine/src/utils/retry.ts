/**
 * =============================================================================
 * Chaimera Broker Gateway — Retry with Exponential Backoff & Jitter
 * =============================================================================
 *
 * Generic retry utility used by the WebSocket reconnect logic, Redis
 * reconnection, and any other operation that may transiently fail.
 *
 * Features:
 *   - Exponential backoff with configurable base and max delay
 *   - Random jitter to prevent thundering herd
 *   - Abort signal support for graceful shutdown mid-retry
 *   - Per-attempt callback for logging/metrics
 *
 * Usage:
 *   const result = await retryWithBackoff(
 *     () => connectToWebSocket(),
 *     { maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 30000 }
 *   );
 */

import { logger } from './logger';

const log = logger.child({ module: 'Retry' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetryOptions {
    /** Maximum number of attempts (including the first) */
    maxAttempts: number;
    /** Base delay in milliseconds for exponential backoff */
    baseDelayMs: number;
    /** Maximum delay cap in milliseconds */
    maxDelayMs: number;
    /** Optional: abort signal to cancel the retry loop (e.g., on SIGTERM) */
    abortSignal?: AbortSignal;
    /** Optional: called before each retry with the attempt number and delay */
    onRetry?: (attempt: number, delayMs: number, error: Error) => void;
}

export class MaxRetriesExceededError extends Error {
    public readonly attempts: number;
    public readonly lastError: Error;

    constructor(attempts: number, lastError: Error) {
        super(`Max retries exceeded after ${attempts} attempts: ${lastError.message}`);
        this.name = 'MaxRetriesExceededError';
        this.attempts = attempts;
        this.lastError = lastError;
    }
}

// ---------------------------------------------------------------------------
// Core Retry Function
// ---------------------------------------------------------------------------

/**
 * Executes `fn` with exponential backoff retries.
 *
 * Backoff formula: min(baseDelay * 2^attempt + jitter, maxDelay)
 * Jitter is a random value between 0 and baseDelay to prevent thundering herd.
 *
 * @throws {MaxRetriesExceededError} if all attempts are exhausted
 * @throws {Error} 'Retry aborted' if the abort signal fires
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: RetryOptions
): Promise<T> {
    const { maxAttempts, baseDelayMs, maxDelayMs, abortSignal, onRetry } = options;

    let lastError: Error = new Error('No attempts made');

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Check abort signal before each attempt
        if (abortSignal?.aborted) {
            throw new Error('Retry aborted by shutdown signal');
        }

        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // If this was the last attempt, don't wait — throw immediately
            if (attempt >= maxAttempts) {
                break;
            }

            // Calculate delay: exponential backoff with jitter
            const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
            const jitter = Math.random() * baseDelayMs;
            const delayMs = Math.min(exponentialDelay + jitter, maxDelayMs);

            // Notify caller before sleeping
            if (onRetry) {
                onRetry(attempt, delayMs, lastError);
            } else {
                log.warn(
                    { attempt, maxAttempts, delayMs: Math.round(delayMs), error: lastError.message },
                    'Retrying after failure'
                );
            }

            // Sleep with abort support
            await sleep(delayMs, abortSignal);
        }
    }

    throw new MaxRetriesExceededError(maxAttempts, lastError);
}

// ---------------------------------------------------------------------------
// Utility: Calculate Backoff Delay (for external use)
// ---------------------------------------------------------------------------

/**
 * Calculates the backoff delay for a given attempt number.
 * Useful when you need the delay value without the full retry wrapper
 * (e.g., for logging the next retry time).
 */
export function calculateBackoffDelay(
    attempt: number,
    baseDelayMs: number,
    maxDelayMs: number
): number {
    const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
    const jitter = Math.random() * baseDelayMs;
    return Math.min(exponentialDelay + jitter, maxDelayMs);
}

// ---------------------------------------------------------------------------
// Utility: Abortable Sleep
// ---------------------------------------------------------------------------

/**
 * Promise-based sleep that can be cancelled via AbortSignal.
 */
export function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (abortSignal?.aborted) {
            reject(new Error('Sleep aborted'));
            return;
        }

        const timer = setTimeout(resolve, ms);

        if (abortSignal) {
            const onAbort = () => {
                clearTimeout(timer);
                reject(new Error('Sleep aborted'));
            };
            abortSignal.addEventListener('abort', onAbort, { once: true });
        }
    });
}
