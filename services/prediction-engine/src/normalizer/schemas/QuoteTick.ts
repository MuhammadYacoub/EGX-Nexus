/**
 * =============================================================================
 * Chaimera Broker Gateway — Quote Tick Schema (Level 1)
 * =============================================================================
 *
 * Defines the canonical data model for Level 1 (quote/ticker) data —
 * last price, bid/ask, volume, change — as distinct from Level 2 order book.
 *
 * TradingView's `qsd` messages produce QuoteTick data, not L2 depth data.
 * This schema captures the "top of book" + aggregated trade info that most
 * data vendors provide.
 *
 * Design Decisions:
 *   - `lastPrice` is a FLOAT (number) — represents the most recent trade price
 *   - `volume` is a FLOAT (number) — crypto volumes can be fractional
 *   - `timestamp` is EPOCH MILLISECONDS — consistent with L2Tick
 *   - All quote fields are optional to support partial updates (deltas)
 */

// ---------------------------------------------------------------------------
// Core Interfaces
// ---------------------------------------------------------------------------

/**
 * A normalized Level 1 quote tick — the canonical output for quote streams.
 *
 * Published to Redis Streams for Layer 1 consumption alongside L2Tick data.
 * Mutual exclusivity: a message is EITHER an L2Tick OR a QuoteTick, never both.
 */
export interface QuoteTick {
    // --- Identification ---

    /** Unique broker identifier (e.g., 'tradingview', 'mubasher') */
    readonly brokerId: string;

    /** Market symbol in uppercase (e.g., 'ETHFIUSDT', 'AAPL') */
    readonly symbol: string;

    /** Exchange/market code (e.g., 'BINANCE', 'NASDAQ') */
    readonly exchange: string;

    // --- Timing ---

    /**
     * Timestamp in EPOCH MILLISECONDS of the last trade.
     * Sourced from the broker if available, otherwise Date.now().
     */
    readonly timestamp: number;

    /** Time the tick was received by the Chaimera listener (epoch ms) */
    readonly receivedAt: number;

    // --- Price Data ---

    /** Last traded price (float). Null if not in this update. */
    readonly lastPrice: number | null;

    /** Previous session close price (float) */
    readonly prevClosePrice: number | null;

    /** Session change (absolute: lastPrice - prevClose) */
    readonly change: number | null;

    /** Session change (percentage) */
    readonly changePercent: number | null;

    // --- Top of Book ---

    /** Best bid price */
    readonly bid: number | null;

    /** Best ask price */
    readonly ask: number | null;

    /** Best bid size */
    readonly bidSize: number | null;

    /** Best ask size */
    readonly askSize: number | null;

    /** Spread (ask - bid). Calculated if both are present. */
    readonly spread: number | null;

    // --- Session Stats ---

    /** Session high price */
    readonly high: number | null;

    /** Session low price */
    readonly low: number | null;

    /** Session open price */
    readonly open: number | null;

    /** Total session volume (float — crypto can be fractional) */
    readonly volume: number | null;

    // --- Metadata ---

    /** Asset type: 'stock', 'crypto', 'forex', 'futures', 'index' */
    readonly assetType: string | null;

    /** Currency code (e.g., 'USD', 'EUR') */
    readonly currency: string | null;

    /** Human-readable description / name */
    readonly description: string | null;

    /** Whether data is "streaming" (live) or "delayed" */
    readonly updateMode: string | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a QuoteTick with computed fields and normalization.
 *
 * This is the ONLY sanctioned way to construct a QuoteTick.
 * Unlike L2Tick, we DON'T validate price >= 0 because some instruments
 * can legitimately have negative values (oil futures, interest rates).
 */
export function createQuoteTick(params: {
    brokerId: string;
    symbol: string;
    exchange: string;
    timestamp: number;
    lastPrice?: number | null;
    prevClosePrice?: number | null;
    change?: number | null;
    changePercent?: number | null;
    bid?: number | null;
    ask?: number | null;
    bidSize?: number | null;
    askSize?: number | null;
    high?: number | null;
    low?: number | null;
    open?: number | null;
    volume?: number | null;
    assetType?: string | null;
    currency?: string | null;
    description?: string | null;
    updateMode?: string | null;
}): QuoteTick {
    // Calculate spread if both bid and ask are present
    const bid = params.bid ?? null;
    const ask = params.ask ?? null;
    const spread = (bid !== null && ask !== null) ? (ask - bid) : null;

    return Object.freeze({
        brokerId: params.brokerId,
        symbol: params.symbol.toUpperCase(),
        exchange: params.exchange.toUpperCase(),
        timestamp: params.timestamp,
        receivedAt: Date.now(),
        lastPrice: params.lastPrice ?? null,
        prevClosePrice: params.prevClosePrice ?? null,
        change: params.change ?? null,
        changePercent: params.changePercent ?? null,
        bid,
        ask,
        bidSize: params.bidSize ?? null,
        askSize: params.askSize ?? null,
        spread,
        high: params.high ?? null,
        low: params.low ?? null,
        open: params.open ?? null,
        volume: params.volume ?? null,
        assetType: params.assetType ?? null,
        currency: params.currency ?? null,
        description: params.description ?? null,
        updateMode: params.updateMode ?? null,
    });
}

// ---------------------------------------------------------------------------
// Serialization (for Redis Stream publishing)
// ---------------------------------------------------------------------------

/**
 * Serializes a QuoteTick to a flat key-value map suitable for Redis XADD.
 */
export function serializeQuoteTick(tick: QuoteTick): Record<string, string> {
    return {
        data: JSON.stringify(tick),
        symbol: tick.symbol,
        broker: tick.brokerId,
        type: 'quote',
        ts: tick.timestamp.toString(),
    };
}

/**
 * Deserializes a Redis Stream entry back into a QuoteTick.
 */
export function deserializeQuoteTick(fields: Record<string, string>): QuoteTick {
    const raw = fields['data'];
    if (!raw) {
        throw new Error('Missing "data" field in Redis Stream entry');
    }
    return JSON.parse(raw) as QuoteTick;
}
