
import { createQuoteTick, type QuoteTick } from '../normalizer/schemas/QuoteTick';
import { logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';

const log = logger.child({ module: 'ThndrDecoder' });

// Load asset dictionary (UUID → symbol/name) from symbols.json
const symbolsPath = path.resolve(__dirname, '../../symbols.json');
let assetDictionary: Record<string, { symbol: string, name: string }> = {};
try {
    if (fs.existsSync(symbolsPath)) {
        assetDictionary = JSON.parse(fs.readFileSync(symbolsPath, 'utf-8'));
        log.info({ count: Object.keys(assetDictionary).length }, '📚 Asset dictionary loaded from symbols.json');
    } else {
        log.warn('⚠️ symbols.json not found — UUIDs will not be resolved to symbols');
    }
} catch (e) {
    log.error('Failed to load symbols.json', e);
}

/**
 * Thndr/Firebase WebSocket Frame Structure
 */
interface FirebaseFrame {
    t: 'd'; // Data type
    d: {
        b: {
            p: string; // Path
            d: any;    // Data payload
        };
    };
}

export class ThndrDecoder {
    /**
     * Maps the proprietary hash ID to the canonical symbol.
     * e.g. "beb28..." -> "COMI"
     */
    private symbolMap = new Map<string, string>();

    /**
     * State cache to track the latest known values for each asset.
     * This allows us to merge delta updates (leaf nodes or partial objects)
     * into a complete state.
     */
    private assetState = new Map<string, any>();

    constructor() { }

    /**
     * Entry point to decode a raw WebSocket text frame.
     * Handles Firebase numeric prefixes (e.g., "42["..."]") if present.
     */
    public decode(raw: string): QuoteTick | null {
        try {
            // 1. Remove numeric prefix if present (Firebase formatting)
            const jsonPart = raw.replace(/^\d+/, '');
            if (!jsonPart.startsWith('[') && !jsonPart.startsWith('{')) {
                return null; // Heartbeat or non-json
            }

            const parsed = JSON.parse(jsonPart);
            let frame: FirebaseFrame | null = null;

            if (Array.isArray(parsed)) {
                frame = parsed.find((item: any) => item && item.t === 'd') as FirebaseFrame;
            } else if (typeof parsed === 'object') {
                frame = parsed as FirebaseFrame;
            }

            if (!frame || !frame.d || !frame.d.b) {
                return null;
            }

            const body = frame.d.b;
            const path = body.p;
            const data = body.d;

            // 2. Routing
            if (path === 'marketFeed' || path === '/') {
                this.handleSnapshot(data);
                return null;
            } else if (path.startsWith('marketFeed/')) {
                return this.handleUpdate(path, data);
            }

            return null;

        } catch (error) {
            return null;
        }
    }

    /**
     * Processes the initial snapshot to build the AssetID → Symbol map.
     */
    private handleSnapshot(data: any): void {
        if (!data || typeof data !== 'object') return;

        let count = 0;
        for (const [assetId, info] of Object.entries(data)) {
            const val = info as any;
            if (!val || typeof val !== 'object') continue;

            // Update symbol map
            const dictEntry = assetDictionary[assetId];
            const symbol = dictEntry?.symbol || val.symbol || val.S || val.ticker || `UNKNOWN_${assetId.substring(0, 8)}`;
            this.symbolMap.set(assetId, symbol);

            // Initialize state cache with snapshot
            this.assetState.set(assetId, { ...val });
            count++;
        }
        log.info({ count, mapSize: this.symbolMap.size }, '📸 Market Feed snapshot processed. Symbol map and state cache initialized.');
    }

    /**
     * Processes a delta update for a specific instrument.
     * 
     * Potential Path formats: 
     *   "marketFeed/UUID" (Object update)
     *   "marketFeed/UUID/field" (Leaf update)
     */
    private handleUpdate(path: string, data: any): QuoteTick | null {
        const parts = path.split('/');
        if (parts.length < 2) return null;

        const assetId = parts[1];
        const symbol = this.symbolMap.get(assetId) || assetDictionary[assetId]?.symbol || `UNKNOWN_${assetId.substring(0, 8)}`;

        // Retrieve existing state or initialize
        let state = this.assetState.get(assetId) || {};

        // 1. Handle state merging
        if (parts.length === 3) {
            // Leaf-node update: marketFeed/UUID/field
            const field = parts[2];
            state[field] = data;
        } else if (parts.length === 2) {
            // Object update: marketFeed/UUID
            if (data && typeof data === 'object') {
                state = { ...state, ...data };
            } else {
                // If it's a primitive update at the asset root, we treat it as an update to a default field (less common)
                // but based on Thndr/Firebase behavior, it's usually objects at this level.
                // However, for safety if it's not an object we skip merging.
                return null;
            }
        }

        // Save back to cache
        this.assetState.set(assetId, state);

        // 2. Build QuoteTick from merged state
        return createQuoteTick({
            brokerId: 'thndr',
            symbol: symbol,
            exchange: state.market || 'EGX',
            timestamp: Date.now(),
            lastPrice: this.parseNumber(state.last_trade_price ?? state.lp),
            bid: this.parseNumber(state.bid_price ?? state.bp),
            ask: this.parseNumber(state.ask_price ?? state.ap),
            bidSize: this.parseNumber(state.bid_volume ?? state.bv),
            askSize: this.parseNumber(state.ask_volume ?? state.av),
            volume: this.parseNumber(state.v ?? state.vol ?? state.tv ?? state.trade_volume),
            change: this.parseNumber(state.change ?? state.ch),
            changePercent: this.parseNumber(state.change_percent ?? state.cp),
        });
    }

    private parseNumber(val: any): number | null {
        if (val === undefined || val === null) return null;
        const num = Number(val);
        return isNaN(num) ? null : num;
    }
}
