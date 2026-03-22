/**
 * =============================================================================
 * Chaimera — AutoSniper (L1 Radar & Continuous L2 Poller)
 * =============================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import Redis from 'ioredis';
import { logger } from '../utils/logger';
import type { QuoteTick } from '../normalizer/schemas/QuoteTick';

const log = logger.child({ module: 'AutoSniper' });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TARGET_SYMBOLS: string[] = (process.env.SYMBOLS || 'COMI,FWRY,EFIH,TMGH,HRHO,CIRA,EKHOA,HELI,ORAS,ABUK')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
const L2_API_BASE = 'https://prod.thndr.app/assets-service/market-depth';
const SESSION_FILE = path.resolve(__dirname, '../../state/user_session.json');
const SYMBOLS_FILE = path.resolve(__dirname, '../../symbols.json');

// Throttle for instant ticks (prevent spamming on fast trades)
const THROTTLE_MS = 3000;
// Background polling interval (fetch L2 every 15 seconds regardless of trades)
const POLL_INTERVAL_MS = 15000;
// Base backoff on HTTP 429 (doubles on consecutive 429s, caps at 60s)
const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 60000;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const L2_STREAM_MAXLEN = 10_000;

// ---------------------------------------------------------------------------
// AutoSniper
// ---------------------------------------------------------------------------

export class AutoSniper {
    private bearerToken: string | null = null;
    private symbolToUuid: Map<string, string> = new Map();
    private lastFetchTime: Map<string, number> = new Map();
    private lastBearerWarnTime = 0;
    private currentBackoffMs = 0;
    private redis: Redis;
    private pollIntervalTimer: NodeJS.Timeout | null = null;
    private latestPrices: Map<string, number | null> = new Map();

    // --- NEW: Queue Management ---
    private fetchQueue: Map<string, number | null> = new Map();
    private isProcessingQueue: boolean = false;
    private readonly INTER_FETCH_DELAY_MS = 1500;

    constructor() {
        this.redis = new Redis({
            host: REDIS_HOST,
            port: REDIS_PORT,
            retryStrategy: (times) => Math.min(times * 50, 2000),
        });
        this.loadBearerToken();
        this.buildSymbolToUuidMap();

        // Start the background continuous poller
        this.startBackgroundPoller();
    }

    private loadBearerToken(): void {
        try {
            if (fs.existsSync(SESSION_FILE)) {
                const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
                this.bearerToken = session.bearerToken || null;
                if (this.bearerToken) {
                    log.info('🔑 Bearer token loaded for L2 API');
                } else {
                    log.warn('⚠️ No bearerToken in session file — L2 sniper disabled');
                }
            }
        } catch (e) {
            log.error('Failed to load bearer token');
        }
    }

    private buildSymbolToUuidMap(): void {
        try {
            if (fs.existsSync(SYMBOLS_FILE)) {
                const dict: Record<string, { symbol: string; name: string }> = JSON.parse(
                    fs.readFileSync(SYMBOLS_FILE, 'utf-8')
                );
                for (const [uuid, entry] of Object.entries(dict)) {
                    this.symbolToUuid.set(entry.symbol.toUpperCase(), uuid);
                }
                log.info({ mapped: this.symbolToUuid.size, targets: TARGET_SYMBOLS }, '🎯 AutoSniper map initialized');
            } else {
                log.warn('⚠️ symbols.json not found — AutoSniper cannot map symbols to UUIDs');
            }
        } catch (e) {
            log.error('Failed to build symbol→UUID map');
        }
    }

    // --- NEW: Background Poller ---
    private startBackgroundPoller(): void {
        if (this.pollIntervalTimer) return;

        log.info(`⏳ Starting continuous L2 background poller (${POLL_INTERVAL_MS / 1000}s interval)`);

        this.pollIntervalTimer = setInterval(() => {
            this.pollAllTargets();
        }, POLL_INTERVAL_MS);
    }

    private pollAllTargets(): void {
        if (!this.bearerToken) return;

        for (const symbol of TARGET_SYMBOLS) {
            const now = Date.now();
            const lastFetch = this.lastFetchTime.get(symbol) || 0;

            // Enforcement of symbol-specific throttle
            if (now - lastFetch < THROTTLE_MS) continue;

            // Add to the centralized staggered queue
            const price = this.latestPrices.get(symbol) || null;
            this.addToQueue(symbol, price);
        }
    }

    /**
     * Called by DirectSocketGateway on every decoded tick.
     * Reacts instantly to trades.
     */
    public onTick(tick: QuoteTick): void {
        const symbol = tick.symbol.toUpperCase();
        if (!TARGET_SYMBOLS.includes(symbol)) return;

        if (!this.bearerToken) {
            const now = Date.now();
            if (now - this.lastBearerWarnTime > 60_000) {
                log.warn({ symbol }, '⚠️ AutoSniper: Bearer token is missing. Re-run auth manager.');
                this.lastBearerWarnTime = now;
            }
            return;
        }

        const now = Date.now();
        const lastFetch = this.lastFetchTime.get(symbol) || 0;

        if (now - lastFetch < THROTTLE_MS) return;

        // Update the latest prices map
        this.latestPrices.set(symbol, tick.lastPrice);

        // Add to the centralized staggered queue
        this.addToQueue(symbol, tick.lastPrice);
    }

    private addToQueue(symbol: string, l1Price: number | null): void {
        // Map allows deduplication (newer entries update the l1Price if still in queue)
        this.fetchQueue.set(symbol, l1Price);
        this.processQueue();
    }

    private async processQueue(): Promise<void> {
        if (this.isProcessingQueue || this.fetchQueue.size === 0) return;

        this.isProcessingQueue = true;

        try {
            while (this.fetchQueue.size > 0) {
                // Handle dynamic rate-limit backoffs (HTTP 429 mitigation)
                if (this.currentBackoffMs > 0) {
                    log.warn({ backoffMs: this.currentBackoffMs }, '⏳ Rate-limit backoff active, pausing queue worker');
                    await new Promise(resolve => setTimeout(resolve, this.currentBackoffMs));
                    // Decay the backoff
                    this.currentBackoffMs = Math.floor(this.currentBackoffMs / 2);
                    if (this.currentBackoffMs < BACKOFF_BASE_MS) this.currentBackoffMs = 0;
                    continue; // Re-evaluate loop
                }

                // Get next symbol from queue
                const entry = this.fetchQueue.entries().next().value;
                if (!entry) break;
                const [symbol, l1Price] = entry;
                this.fetchQueue.delete(symbol);

                const uuid = this.symbolToUuid.get(symbol);
                if (!uuid) continue;

                // Update last fetch time immediately to prevent racing with newer ticks
                this.lastFetchTime.set(symbol, Date.now());

                try {
                    await this.fetchL2(symbol, uuid, l1Price);
                } catch (err: any) {
                    if (err.message?.includes('429')) {
                        this.currentBackoffMs = Math.min(
                            (this.currentBackoffMs || BACKOFF_BASE_MS) * 2,
                            BACKOFF_MAX_MS,
                        );
                        log.warn({ symbol, backoffMs: this.currentBackoffMs }, '🛑 HTTP 429 — Activating backoff');
                        // Put the symbol back at the start of the queue
                        this.fetchQueue.set(symbol, l1Price);
                    } else {
                        log.error({ error: err.message, symbol }, '❌ L2 fetch failed');
                    }
                }

                // MANDATORY STAGGER: Enforce delay AFTER every fetch (success or 429)
                await new Promise(resolve => setTimeout(resolve, this.INTER_FETCH_DELAY_MS));
            }
        } finally {
            this.isProcessingQueue = false;
        }
    }

    private async fetchL2(symbol: string, uuid: string, l1Price: number | null): Promise<void> {
        const url = `${L2_API_BASE}/${uuid}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': this.bearerToken!,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
            },
        });

        if (!response.ok) throw new Error(`HTTP ${response.status} for ${symbol}`);

        const data: any = (await response.json()) as any;

        const topBid = data.bids_per_price?.[0] || {};
        const topAsk = data.asks_per_price?.[0] || {};

        const top_bid_price = topBid.order_price || topBid.price || null;
        const top_bid_volume = topBid.total_bids || topBid.volume || topBid.quantity || null;

        const top_ask_price = topAsk.order_price || topAsk.price || null;
        const top_ask_volume = topAsk.total_ask || topAsk.total_asks || topAsk.volume || topAsk.quantity || null;

        // Normalize Thndr JSONB keys → canonical {price, volume} format
        const normalizeLevels = (levels: any[]) =>
            (levels || []).map((lvl: any) => ({
                price: lvl.order_price ?? lvl.price ?? 0,
                volume: lvl.total_bids ?? lvl.total_ask ?? lvl.total_asks ?? lvl.volume ?? lvl.quantity ?? 0,
            }));

        log.info({
            symbol,
            trigger: l1Price !== null ? 'TRADE_TICK' : 'BACKGROUND_POLL',
            bidLevels: data.bids_per_price?.length || 0,
            askLevels: data.asks_per_price?.length || 0,
        }, '🎯 L2 DEPTH CAPTURED');

        const snapshot = {
            time: new Date().toISOString(),
            symbol,
            asset_id: uuid,
            l1_price: l1Price,
            top_bid_price,
            top_bid_volume,
            top_ask_price,
            top_ask_volume,
            bid_levels: data.bids_per_price?.length || 0,
            ask_levels: data.asks_per_price?.length || 0,
            full_bids: normalizeLevels(data.bids_per_price || []),
            full_asks: normalizeLevels(data.asks_per_price || []),
        };

        const streamKey = `chaimera:stream:l2depth:thndr:${symbol}`;
        await this.redis.xadd(
            streamKey, 'MAXLEN', '~', String(L2_STREAM_MAXLEN), '*',
            'data', JSON.stringify(snapshot),
            'symbol', symbol,
            'type', 'l2depth',
            'ts', String(Date.now())
        );
    }

    public reloadToken(): void {
        this.loadBearerToken();
    }
}