/**
 * =============================================================================
 * Chaimera Broker Gateway — TradingView Normalizer
 * =============================================================================
 *
 * Transforms raw TradingView WebSocket messages into canonical Chaimera
 * QuoteTick data and handles protocol-level concerns (heartbeats, errors).
 *
 * This normalizer is the "glue" between:
 *   - TradingViewParser (frame decoding)
 *   - QuoteTick schema (canonical output)
 *   - RedisPublisher (downstream delivery)
 *
 * Supported TradingView Message Types:
 *   - `qsd`  — Quote Stream Data (realtime price/volume updates)
 *   - `quote_completed` — Subscription confirmation
 *   - `protocol_error`  — Server-side error
 *   - `critical_error`  — Fatal error, connection should be dropped
 *   - Heartbeats        — Numeric payloads that must be echoed back
 *
 * Usage:
 *   const normalizer = new TradingViewNormalizer(publisher, sendFn);
 *   // Pass as the onMessage callback to WSListener:
 *   onMessage: (data, brokerId) => normalizer.handleRawFrame(data, brokerId)
 */

import { TradingViewParser, type TVParsedMessage, type TVQuoteData } from './TradingViewParser';
import { createQuoteTick } from '../normalizer/schemas/QuoteTick';
import { RedisPublisher } from '../publisher/RedisPublisher';
import { logger } from '../utils/logger';

import type WebSocket from 'ws';

const log = logger.child({ module: 'TVNormalizer' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Function signature for sending raw data back through the WebSocket.
 * The WSListener injects this so the normalizer can echo heartbeats
 * without directly depending on the WS connection.
 */
export type WSSendFunction = (data: string) => void;

/**
 * Stats tracked by the normalizer for observability.
 */
export interface TVNormalizerStats {
    totalFrames: number;
    totalMessages: number;
    heartbeatsEchoed: number;
    quoteTicksPublished: number;
    parseErrors: number;
    unknownMessageTypes: number;
}

// ---------------------------------------------------------------------------
// Normalizer Class
// ---------------------------------------------------------------------------

export class TradingViewNormalizer {
    private readonly parser: TradingViewParser;
    private readonly publisher: RedisPublisher;
    private readonly sendFn: WSSendFunction;

    /** Running stats for observability */
    private stats: TVNormalizerStats = {
        totalFrames: 0,
        totalMessages: 0,
        heartbeatsEchoed: 0,
        quoteTicksPublished: 0,
        parseErrors: 0,
        unknownMessageTypes: 0,
    };

    /** Timestamp of last stats log */
    private lastStatsLogAt: number = Date.now();

    /** Log stats every 60 seconds */
    private readonly statsIntervalMs: number = 60_000;

    constructor(publisher: RedisPublisher, sendFn: WSSendFunction) {
        this.parser = new TradingViewParser();
        this.publisher = publisher;
        this.sendFn = sendFn;
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Main entry point — handles a raw WebSocket frame from TradingView.
     *
     * This method:
     *   1. Decodes the ~m~ framing (potentially multiple batched messages)
     *   2. Routes each message by type
     *   3. Echoes heartbeats immediately
     *   4. Normalizes `qsd` messages into QuoteTick and publishes
     *
     * Designed to be passed directly as the `onMessage` callback to WSListener.
     */
    handleRawFrame(data: WebSocket.Data, brokerId: string): void {
        this.stats.totalFrames++;

        // Convert Buffer/ArrayBuffer to string
        const raw = typeof data === 'string' ? data : data.toString();
        if (!raw || raw.length === 0) return;

        // Decode the ~m~ framing — may yield multiple messages
        const messages = this.parser.decode(raw);

        for (const msg of messages) {
            this.stats.totalMessages++;
            this.routeMessage(msg, brokerId);
        }

        // Periodic stats logging
        this.maybeLogStats();
    }

    /**
     * Returns the current normalizer stats.
     */
    getStats(): TVNormalizerStats {
        return { ...this.stats };
    }

    /**
     * Resets all stats counters.
     */
    resetStats(): void {
        this.stats = {
            totalFrames: 0,
            totalMessages: 0,
            heartbeatsEchoed: 0,
            quoteTicksPublished: 0,
            parseErrors: 0,
            unknownMessageTypes: 0,
        };
    }

    // =========================================================================
    // MESSAGE ROUTING
    // =========================================================================

    /**
     * Routes a single parsed TradingView message to the appropriate handler.
     */
    private routeMessage(msg: TVParsedMessage, brokerId: string): void {
        // --- Heartbeat: echo it back immediately ---
        if (msg.isHeartbeat) {
            this.handleHeartbeat(msg.rawPayload);
            return;
        }

        // --- Non-JSON messages: log and skip ---
        if (!msg.json) {
            log.debug(
                { payload: msg.rawPayload.substring(0, 100) },
                'Non-JSON, non-heartbeat message — skipping'
            );
            return;
        }

        // --- Route by TradingView message method ---
        const method = msg.json.m;

        switch (method) {
            case 'qsd':
                this.handleQuoteStreamData(msg.json.p, brokerId);
                break;

            case 'quote_completed':
                log.info(
                    { params: msg.json.p },
                    '✅ TradingView quote subscription confirmed'
                );
                break;

            case 'quote_list_fields':
                log.debug(
                    { fieldCount: Array.isArray(msg.json.p) ? msg.json.p.length : 0 },
                    'Received quote field list'
                );
                break;

            case 'protocol_error':
                log.error(
                    { params: msg.json.p },
                    '❌ TradingView protocol error'
                );
                break;

            case 'critical_error':
                log.fatal(
                    { params: msg.json.p },
                    '💀 TradingView critical error — connection may be terminated'
                );
                break;

            case 'quote_error':
                log.warn(
                    { params: msg.json.p },
                    '⚠️ TradingView quote error (invalid symbol?)'
                );
                break;

            default:
                this.stats.unknownMessageTypes++;
                // Only log first few to avoid flooding
                if (this.stats.unknownMessageTypes <= 20) {
                    log.debug(
                        { method, paramCount: msg.json.p?.length },
                        'Unhandled TradingView message type'
                    );
                }
                break;
        }
    }

    // =========================================================================
    // HEARTBEAT HANDLER
    // =========================================================================

    /**
     * Echoes a heartbeat back to TradingView.
     *
     * TradingView sends periodic heartbeats as plain numeric strings
     * wrapped in ~m~ framing. The client MUST respond with the exact
     * same value or the connection will be dropped.
     *
     * Incoming:  ~m~3~m~123
     * Response:  ~m~3~m~123
     */
    private handleHeartbeat(heartbeatValue: string): void {
        const response = this.parser.buildHeartbeatResponse(heartbeatValue);

        try {
            this.sendFn(response);
            this.stats.heartbeatsEchoed++;
            log.debug({ value: heartbeatValue }, '[TradingView] Heartbeat echoed');
        } catch (error) {
            log.error(
                { error: (error as Error).message, value: heartbeatValue },
                'Failed to echo heartbeat'
            );
        }
    }

    // =========================================================================
    // QUOTE STREAM DATA (qsd) HANDLER
    // =========================================================================

    /**
     * Processes a `qsd` (Quote Stream Data) message.
     *
     * Message structure:
     *   p[0] = session string (e.g., "qs_multiplexer_watchlist_k7JwjRjxrGpE")
     *   p[1] = quote data object: { n: symbol, s: status, v: { lp, volume, ... } }
     */
    private handleQuoteStreamData(params: unknown[], brokerId: string): void {
        if (!params || params.length < 2) {
            log.warn({ params }, 'qsd message with insufficient parameters');
            this.stats.parseErrors++;
            return;
        }

        const quoteData = params[1] as TVQuoteData;

        // Validate structure
        if (!quoteData || !quoteData.n || !quoteData.v) {
            log.warn(
                { quoteData },
                'qsd message with missing n (symbol) or v (values)'
            );
            this.stats.parseErrors++;
            return;
        }

        // Check status — only process "ok" messages
        if (quoteData.s !== 'ok') {
            log.debug(
                { symbol: quoteData.n, status: quoteData.s },
                'qsd message with non-ok status — skipping'
            );
            return;
        }

        // Parse the symbol: "EXCHANGE:TICKER" → { exchange, symbol }
        const { exchange, ticker } = this.parseSymbol(quoteData.n);
        const values = quoteData.v;

        // Convert lp_time from epoch SECONDS to epoch MILLISECONDS
        const timestamp = values.lp_time
            ? values.lp_time * 1000
            : Date.now();

        // Build the canonical QuoteTick
        const tick = createQuoteTick({
            brokerId,
            symbol: ticker,
            exchange,
            timestamp,
            lastPrice: values.lp ?? null,
            prevClosePrice: values.prev_close_price ?? null,
            change: values.ch ?? null,
            changePercent: values.chp ?? null,
            bid: values.bid ?? null,
            ask: values.ask ?? null,
            bidSize: values.bid_size ?? null,
            askSize: values.ask_size ?? null,
            high: values.high_price ?? null,
            low: values.low_price ?? null,
            open: values.open_price ?? null,
            volume: values.volume ?? null,
            assetType: values.type ?? null,
            currency: values.currency_code ?? null,
            description: values.description ?? null,
            updateMode: values.update_mode ?? null,
        });

        // Publish to Redis Stream
        this.publisher.publishQuoteTick(tick).catch((err) => {
            log.error(
                { error: err.message, symbol: ticker },
                'Failed to publish QuoteTick'
            );
        });

        this.stats.quoteTicksPublished++;

        log.debug(
            {
                symbol: `${exchange}:${ticker}`,
                lastPrice: values.lp,
                volume: values.volume,
            },
            '📈 Quote tick normalized and published'
        );
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    /**
     * Parses a TradingView symbol string into exchange and ticker components.
     *
     * Input examples:
     *   "BINANCE:ETHFIUSDT"  → { exchange: "BINANCE", ticker: "ETHFIUSDT" }
     *   "NASDAQ:AAPL"        → { exchange: "NASDAQ", ticker: "AAPL" }
     *   "AAPL"               → { exchange: "UNKNOWN", ticker: "AAPL" }
     */
    private parseSymbol(raw: string): { exchange: string; ticker: string } {
        const colonIdx = raw.indexOf(':');

        if (colonIdx > 0) {
            return {
                exchange: raw.substring(0, colonIdx).toUpperCase(),
                ticker: raw.substring(colonIdx + 1).toUpperCase(),
            };
        }

        return {
            exchange: 'UNKNOWN',
            ticker: raw.toUpperCase(),
        };
    }

    /**
     * Logs normalizer throughput stats periodically.
     */
    private maybeLogStats(): void {
        const now = Date.now();
        const elapsed = now - this.lastStatsLogAt;

        if (elapsed >= this.statsIntervalMs) {
            log.info(
                {
                    ...this.stats,
                    intervalMs: elapsed,
                    ticksPerSecond: (this.stats.quoteTicksPublished / (elapsed / 1000)).toFixed(2),
                },
                '📊 TradingView normalizer stats'
            );
            this.resetStats();
            this.lastStatsLogAt = now;
        }
    }
}
