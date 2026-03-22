/**
 * =============================================================================
 * Chaimera Broker Gateway — TradingView Protocol Helpers
 * =============================================================================
 *
 * Helper functions for constructing TradingView protocol messages.
 * Used by the entrypoint and external scripts (like inject-token).
 */

import { TradingViewParser } from './TradingViewParser';

/**
 * Builds the TradingView protocol subscription messages.
 *
 * TradingView requires a specific sequence of messages to start receiving
 * quote data. All messages must be wrapped in the ~m~ framing protocol.
 *
 * The standard flow is:
 *   1. set_auth_token  — Authenticate (use "unauthorized_user_token" for public data)
 *   2. quote_create_session — Create a quote session
 *   3. quote_set_fields — Specify which fields to receive
 *   4. quote_add_symbols — Subscribe to specific symbols
 *
 * @param sessionId - Unique quote session ID
 * @param symbols - Array of symbols in "EXCHANGE:TICKER" format
 * @param authToken - Auth token (default: "unauthorized_user_token" for public data)
 * @returns Array of pre-framed subscription strings ready to send
 */
export function buildTVSubscriptions(
    sessionId: string,
    symbols: string[],
    authToken: string = 'unauthorized_user_token'
): string[] {
    const parser = new TradingViewParser();

    const messages: unknown[] = [
        // 1. Authenticate
        { m: 'set_auth_token', p: [authToken] },

        // 2. Create quote session
        { m: 'quote_create_session', p: [sessionId] },

        // 3. Request all useful fields
        {
            m: 'quote_set_fields',
            p: [
                sessionId,
                // Price fields
                'lp', 'lp_time', 'prev_close_price', 'ch', 'chp',
                // Volume & session
                'volume', 'high_price', 'low_price', 'open_price',
                // Top of book
                'bid', 'ask', 'bid_size', 'ask_size',
                // Metadata
                'type', 'update_mode', 'exchange', 'description',
                'short_name', 'original_name', 'currency_code',
                'pricescale', 'minmov',
            ],
        },

        // 4. Subscribe to symbols (single packet for efficiency)
        {
            m: 'quote_add_symbols',
            p: [sessionId, ...symbols],
        },
    ];

    // Encode each message in ~m~ framing
    return messages.map((msg) => parser.encode(msg));
}

/**
 * Generates a unique TradingView quote session ID.
 * Format matches their convention: qs_[random_alphanumeric]
 */
export function generateSessionId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'qs_';
    for (let i = 0; i < 12; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
