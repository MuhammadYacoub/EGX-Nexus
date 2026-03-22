/**
 * =============================================================================
 * Chaimera Broker Gateway — Level 2 Tick Schema
 * =============================================================================
 *
 * Defines the canonical data model for Level 2 (order book) tick data
 * across ALL brokers connected to Chaimera. This is the "lingua franca"
 * that Layer 1 consumers expect.
 *
 * Design Decisions:
 *   - `price` is a FLOAT (number) — represents monetary value with decimals
 *   - `quantity` is an INTEGER (number) — represents whole share/lot counts
 *   - `timestamp` is EPOCH MILLISECONDS (number) — avoids timezone hell,
 *      consistent across all sources, easy to sort and diff
 *   - All enums use string unions for readability in logs/debugging
 *
 * Note on Floating Point:
 *   For an MVP pipeline, JavaScript's native `number` (IEEE 754 double) is
 *   sufficient for price representation. If sub-cent precision or decimal
 *   exactness becomes critical (e.g., for order execution), migrate `price`
 *   to a string-encoded decimal or use a library like decimal.js.
 */

// ---------------------------------------------------------------------------
// Enums & Constants
// ---------------------------------------------------------------------------

/**
 * The side of the order book this entry belongs to.
 *   'bid' — Buy side (demand)
 *   'ask' — Sell side (supply)
 */
export type OrderSide = 'bid' | 'ask';

/**
 * The type of L2 update received from the broker.
 *   'snapshot' — Full order book state (typically sent once on subscription)
 *   'delta'    — Incremental update (add/modify/remove a price level)
 */
export type L2UpdateType = 'snapshot' | 'delta';

/**
 * For delta updates, the action to apply to the order book.
 *   'set'    — Add or update the quantity at this price level
 *   'delete' — Remove this price level entirely (quantity = 0)
 */
export type L2DeltaAction = 'set' | 'delete';

// ---------------------------------------------------------------------------
// Core Interfaces
// ---------------------------------------------------------------------------

/**
 * A single price level in the order book.
 *
 * Represents one row in the "depth" view:
 *   Bid: 150.25 x 500 shares
 *   Ask: 150.30 x 300 shares
 */
export interface L2PriceLevel {
    /** Price as a floating-point number (e.g., 150.25) */
    readonly price: number;

    /**
     * Quantity/volume as an integer (whole shares/lots).
     * For 'delete' actions, this will be 0.
     */
    readonly quantity: number;

    /** Number of orders at this price level (if provided by broker, else 0) */
    readonly orderCount: number;
}

/**
 * A normalized Level 2 tick — the canonical output of the normalizer.
 *
 * This is what gets published to Redis Streams for Layer 1 consumption.
 * Every field is mandatory to ensure downstream consumers can rely on
 * a consistent schema without null-checking.
 */
export interface L2Tick {
    // --- Identification ---

    /** Unique broker identifier (e.g., 'tickerchart', 'mubasher') */
    readonly brokerId: string;

    /** Market symbol in uppercase (e.g., 'AAPL', '2222.SR', 'CIB.CA') */
    readonly symbol: string;

    /** Exchange/market code (e.g., 'NASDAQ', 'TADAWUL', 'EGX') */
    readonly exchange: string;

    // --- Timing ---

    /**
     * Timestamp in EPOCH MILLISECONDS (e.g., 1707654321000).
     * This is the broker's server timestamp if available, otherwise
     * the time the message was received by the listener.
     */
    readonly timestamp: number;

    /**
     * Time the tick was received by the Chaimera listener (epoch ms).
     * Used to measure pipeline latency: processingLatency = receivedAt - timestamp
     */
    readonly receivedAt: number;

    // --- Order Book Data ---

    /** Type of update: full snapshot or incremental delta */
    readonly updateType: L2UpdateType;

    /** Bid (buy) price levels, ordered by price DESCENDING (best bid first) */
    readonly bids: readonly L2PriceLevel[];

    /** Ask (sell) price levels, ordered by price ASCENDING (best ask first) */
    readonly asks: readonly L2PriceLevel[];

    // --- Metadata ---

    /**
     * Sequence number from the broker (if provided).
     * Used to detect gaps in the data stream.
     * Set to 0 if the broker does not provide sequence numbers.
     */
    readonly sequence: number;
}

// ---------------------------------------------------------------------------
// Factory & Validation
// ---------------------------------------------------------------------------

/**
 * Creates an L2Tick with validation on critical fields.
 * This is the ONLY sanctioned way to construct an L2Tick —
 * using object literals directly is discouraged to ensure invariants hold.
 *
 * @throws {Error} if price is negative, quantity is negative, or timestamp is invalid
 */
export function createL2Tick(params: {
    brokerId: string;
    symbol: string;
    exchange: string;
    timestamp: number;
    updateType: L2UpdateType;
    bids: L2PriceLevel[];
    asks: L2PriceLevel[];
    sequence?: number;
}): L2Tick {
    // Validate timestamp is a positive epoch millisecond
    if (!Number.isFinite(params.timestamp) || params.timestamp <= 0) {
        throw new Error(`Invalid timestamp: ${params.timestamp} — must be positive epoch milliseconds`);
    }

    // Validate price levels
    const validateLevels = (levels: L2PriceLevel[], side: OrderSide): void => {
        for (const level of levels) {
            if (!Number.isFinite(level.price) || level.price < 0) {
                throw new Error(`Invalid ${side} price: ${level.price} — must be non-negative float`);
            }
            if (!Number.isInteger(level.quantity) || level.quantity < 0) {
                throw new Error(
                    `Invalid ${side} quantity: ${level.quantity} — must be non-negative integer`
                );
            }
        }
    };

    validateLevels(params.bids, 'bid');
    validateLevels(params.asks, 'ask');

    return Object.freeze({
        brokerId: params.brokerId,
        symbol: params.symbol.toUpperCase(),
        exchange: params.exchange.toUpperCase(),
        timestamp: params.timestamp,
        receivedAt: Date.now(),
        updateType: params.updateType,
        bids: Object.freeze([...params.bids]),
        asks: Object.freeze([...params.asks]),
        sequence: params.sequence ?? 0,
    });
}

// ---------------------------------------------------------------------------
// Serialization (for Redis Stream publishing)
// ---------------------------------------------------------------------------

/**
 * Serializes an L2Tick to a flat key-value map suitable for Redis XADD.
 *
 * Redis Streams store entries as field-value pairs (both strings).
 * We serialize the tick as a single JSON blob under the 'data' field
 * for simplicity. For higher throughput, individual fields could be
 * flattened, but JSON is fine for MVP.
 */
export function serializeL2Tick(tick: L2Tick): Record<string, string> {
    return {
        data: JSON.stringify(tick),
        symbol: tick.symbol,
        broker: tick.brokerId,
        type: tick.updateType,
        ts: tick.timestamp.toString(),
    };
}

/**
 * Deserializes a Redis Stream entry back into an L2Tick.
 */
export function deserializeL2Tick(fields: Record<string, string>): L2Tick {
    const raw = fields['data'];
    if (!raw) {
        throw new Error('Missing "data" field in Redis Stream entry');
    }
    return JSON.parse(raw) as L2Tick;
}
