/**
 * =============================================================================
 * Chaimera Broker Gateway — TradingView Frame Parser
 * =============================================================================
 *
 * TradingView uses a custom framing protocol over WebSockets, NOT raw JSON.
 * This parser handles the encoding/decoding of that protocol.
 *
 * Protocol Format:
 *   ~m~[LENGTH]~m~[PAYLOAD]
 *
 * Where:
 *   - [LENGTH] is the byte length of [PAYLOAD] as a decimal string
 *   - [PAYLOAD] is either a JSON string or a plain number (heartbeat)
 *
 * Batching:
 *   Multiple messages can be concatenated in a single WebSocket frame:
 *   ~m~52~m~{"m":"qsd","p":[...]}~m~3~m~123
 *
 * Heartbeat:
 *   When the payload is a plain number (e.g., ~m~3~m~123), it's a heartbeat.
 *   The client MUST echo back the exact same frame to keep the connection alive.
 *
 * Usage:
 *   import { TradingViewParser } from './TradingViewParser';
 *
 *   const parser = new TradingViewParser();
 *   const messages = parser.decode(rawWsFrame);
 *   const frame = parser.encode({ m: 'set_auth_token', p: ['token'] });
 */

import { logger } from '../utils/logger';

const log = logger.child({ module: 'TVParser' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Frame delimiter — prefix and suffix around the length field */
const FRAME_PREFIX = '~m~';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A parsed TradingView message extracted from the framing protocol.
 */
export interface TVParsedMessage {
    /** Whether this message is a heartbeat (echo-back required) */
    isHeartbeat: boolean;

    /** The raw string payload (before JSON parsing) */
    rawPayload: string;

    /**
     * The parsed JSON payload, or null if it's a heartbeat or parse failed.
     * For `qsd` messages this will be: { m: string, p: unknown[] }
     */
    json: TVMessage | null;
}

/**
 * The structure of a TradingView JSON message.
 * All messages share the `m` (method) and `p` (params) fields.
 */
export interface TVMessage {
    /** Message method/type: 'qsd', 'du', 'quote_completed', 'protocol_error', etc. */
    m: string;

    /** Parameters array — structure varies by message type */
    p: unknown[];
}

/**
 * Typed structure for a `qsd` (Quote Stream Data) message parameter.
 *
 * Sample:
 * {
 *   "n": "BINANCE:ETHFIUSDT",
 *   "s": "ok",
 *   "v": { "lp": 0.435, "volume": 4815640.9, "lp_time": 1770823393, ... }
 * }
 */
export interface TVQuoteData {
    /** Symbol name in EXCHANGE:TICKER format */
    n: string;

    /** Status: "ok" = data is valid */
    s: string;

    /** Values object containing the actual market data */
    v: TVQuoteValues;
}

/**
 * The `v` (values) object inside a `qsd` message.
 *
 * TradingView sends partial updates — not all fields are present in every
 * message. All fields are therefore optional.
 */
export interface TVQuoteValues {
    /** Last price (float) */
    lp?: number;

    /** Previous close price */
    prev_close_price?: number;

    /** Current session change (absolute) */
    ch?: number;

    /** Current session change (percentage) */
    chp?: number;

    /** Volume (can be fractional for crypto) */
    volume?: number;

    /** Bid price */
    bid?: number;

    /** Ask price */
    ask?: number;

    /** Bid size */
    bid_size?: number;

    /** Ask size */
    ask_size?: number;

    /** High price of the session */
    high_price?: number;

    /** Low price of the session */
    low_price?: number;

    /** Open price of the session */
    open_price?: number;

    /** Last price timestamp (EPOCH SECONDS — not milliseconds!) */
    lp_time?: number;

    /** Asset type: 'stock', 'crypto', 'forex', 'futures', 'spot', etc. */
    type?: string;

    /** Update mode: 'streaming', 'delayed', 'snapshot' */
    update_mode?: string;

    /** Short name / description */
    short_name?: string;

    /** Exchange name */
    exchange?: string;

    /** Original name as listed */
    original_name?: string;

    /** Description / full name */
    description?: string;

    /** Currency code */
    currency_code?: string;

    /** Price precision (decimal places) */
    pricescale?: number;

    /** Min movement */
    minmov?: number;

    /** Fractional flag */
    fractional?: boolean;

    /** Variable min tick */
    minmove2?: number;

    /** Catch-all for any other fields TV might send */
    [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Parser Class
// ---------------------------------------------------------------------------

export class TradingViewParser {
    // -------------------------------------------------------------------------
    // DECODE: Raw WS frame → Array of parsed messages
    // -------------------------------------------------------------------------

    /**
     * Decodes a raw WebSocket frame into an array of TradingView messages.
     *
     * A single WS frame can contain multiple batched messages:
     *   ~m~52~m~{...}~m~3~m~123~m~48~m~{...}
     *
     * @param raw - The raw WebSocket frame string
     * @returns Array of parsed messages (may contain heartbeats and JSON messages)
     */
    decode(raw: string): TVParsedMessage[] {
        const messages: TVParsedMessage[] = [];

        if (!raw || !raw.startsWith(FRAME_PREFIX)) {
            // Not a TradingView framed message — try raw JSON fallback
            return this.tryRawJsonFallback(raw);
        }

        let cursor = 0;

        while (cursor < raw.length) {
            // Expect ~m~ at cursor position
            if (!raw.startsWith(FRAME_PREFIX, cursor)) {
                // Malformed — skip ahead looking for next ~m~
                const nextFrame = raw.indexOf(FRAME_PREFIX, cursor);
                if (nextFrame === -1) break;
                cursor = nextFrame;
                continue;
            }

            // Advance past the opening ~m~
            cursor += FRAME_PREFIX.length;

            // Find the closing ~m~ that terminates the length field
            const lengthEnd = raw.indexOf(FRAME_PREFIX, cursor);
            if (lengthEnd === -1) {
                log.warn(
                    { cursor, raw: raw.substring(cursor, cursor + 50) },
                    'Malformed frame: missing closing ~m~ for length field'
                );
                break;
            }

            // Extract and parse the length
            const lengthStr = raw.substring(cursor, lengthEnd);
            const payloadLength = parseInt(lengthStr, 10);

            if (isNaN(payloadLength) || payloadLength < 0) {
                log.warn(
                    { lengthStr, cursor },
                    'Malformed frame: invalid length value'
                );
                cursor = lengthEnd + FRAME_PREFIX.length;
                continue;
            }

            // Advance cursor past the closing ~m~
            cursor = lengthEnd + FRAME_PREFIX.length;

            // Extract the payload using the declared length
            const payload = raw.substring(cursor, cursor + payloadLength);
            cursor += payloadLength;

            // Classify the message
            if (this.isHeartbeat(payload)) {
                messages.push({
                    isHeartbeat: true,
                    rawPayload: payload,
                    json: null,
                });
            } else {
                // Attempt JSON parse
                try {
                    const parsed = JSON.parse(payload) as TVMessage;

                    // Validate that it has the expected TV message structure
                    if (parsed && typeof parsed.m === 'string') {
                        messages.push({
                            isHeartbeat: false,
                            rawPayload: payload,
                            json: parsed,
                        });
                    } else {
                        messages.push({
                            isHeartbeat: false,
                            rawPayload: payload,
                            json: null,
                        });
                    }
                } catch {
                    log.debug(
                        { payload: payload.substring(0, 100) },
                        'Non-JSON, non-heartbeat payload in TV frame'
                    );
                    messages.push({
                        isHeartbeat: false,
                        rawPayload: payload,
                        json: null,
                    });
                }
            }
        }

        return messages;
    }

    // -------------------------------------------------------------------------
    // ENCODE: JSON payload → ~m~ framed string
    // -------------------------------------------------------------------------

    /**
     * Encodes a message into the TradingView ~m~ frame format.
     *
     * @param payload - A JSON-serializable object or a raw string
     * @returns The framed string: ~m~[LENGTH]~m~[PAYLOAD]
     */
    encode(payload: unknown): string {
        const payloadStr = typeof payload === 'string'
            ? payload
            : JSON.stringify(payload);

        return `${FRAME_PREFIX}${payloadStr.length}${FRAME_PREFIX}${payloadStr}`;
    }

    /**
     * Encodes multiple messages and concatenates them into a single frame.
     * Used for sending batched commands (auth + subscription in one send).
     */
    encodeBatch(payloads: unknown[]): string {
        return payloads.map((p) => this.encode(p)).join('');
    }

    // -------------------------------------------------------------------------
    // HEARTBEAT HANDLING
    // -------------------------------------------------------------------------

    /**
     * Checks if a payload string is a heartbeat.
     *
     * TradingView heartbeats are plain numeric strings (e.g., "123", "45678").
     * The client must echo them back in the same ~m~ framing.
     */
    isHeartbeat(payload: string): boolean {
        return payload.startsWith('~h~');
    }

    /**
     * Constructs the heartbeat echo response.
     * The protocol requires echoing the exact same heartbeat value.
     *
     * @param heartbeatValue - The numeric string received
     * @returns The framed heartbeat: ~m~[LENGTH]~m~[HEARTBEAT_VALUE]
     */
    buildHeartbeatResponse(heartbeatValue: string): string {
        return this.encode(heartbeatValue);
    }

    // -------------------------------------------------------------------------
    // HELPERS
    // -------------------------------------------------------------------------

    /**
     * Fallback for raw (non-framed) JSON messages.
     * Some TradingView connections may send raw JSON in certain states.
     */
    private tryRawJsonFallback(raw: string): TVParsedMessage[] {
        if (!raw) return [];

        try {
            const parsed = JSON.parse(raw) as TVMessage;
            if (parsed && typeof parsed.m === 'string') {
                return [{
                    isHeartbeat: false,
                    rawPayload: raw,
                    json: parsed,
                }];
            }
        } catch {
            // Not JSON either — ignore
        }

        return [];
    }
}
