
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws');
import * as fs from 'fs';
import * as path from 'path';
import { disconnectRedis } from '../redis/RedisClient';
import { RedisPublisher } from '../publisher/RedisPublisher';
import { ThndrDecoder } from '../utils/ThndrDecoder';
import { AutoSniper } from './AutoSniper';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'DirectSocketGateway' });

// Target symbols to ensure real-time deltas for
const TARGET_SYMBOLS: string[] = (process.env.SYMBOLS || 'COMI,FWRY,EFIH,TMGH,HRHO,CIRA,EKHOA,HELI,ORAS,ABUK')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

/**
 * DirectSocketGateway — Zero-browser WebSocket client for Firebase RTDB.
 *
 * Connects directly to the Firebase Realtime Database WebSocket endpoint,
 * authenticates using the stored firebase_token, and listens for market feed
 * data frames. No Playwright, no Chromium, ~15MB RAM.
 */
export class DirectSocketGateway {
    private ws: any = null;
    private readonly decoder = new ThndrDecoder();
    private readonly publisher = new RedisPublisher('thndr');
    private readonly sniper = new AutoSniper();

    private isRunning = false;
    private requestCounter = 0; // Firebase request IDs
    private keepAliveInterval: NodeJS.Timeout | null = null;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private reconnectAttempts = 0;

    private symbolToUuid = new Map<string, string>();

    // ── WS-Level Ping/Pong Heartbeat ─────────────────────────────────
    private readonly PING_INTERVAL_MS = 30_000;   // Send ws.ping() every 30s
    private readonly PONG_TIMEOUT_MS = 10_000;     // Terminate if no pong within 10s
    private pingInterval: NodeJS.Timeout | null = null;
    private pongTimeout: NodeJS.Timeout | null = null;

    // ── Watchdog Timer (Silent Drop Detection) ───────────────────────
    private readonly WATCHDOG_INTERVAL_MS = 15_000; // Check every 15s
    private readonly WATCHDOG_TIMEOUT_MS = 60_000;  // Trigger if no message for 60s
    private watchdogInterval: NodeJS.Timeout | null = null;
    private lastMessageTime: number = 0;

    // Frame reassembly buffer (Firebase splits large payloads across multiple WS frames)
    private frameBuffer: string = '';
    private isBuffering = false;
    private bufferChunkCount = 0;

    private readonly SESSION_FILE = path.resolve(process.cwd(), 'state/user_session.json');
    private readonly REAUTH_SIGNAL_FILE = path.resolve(process.cwd(), 'state/reauth_signal.json');
    private readonly SYMBOLS_FILE = path.resolve(__dirname, '../../symbols.json');
    private readonly WS_URL = 'wss://s-gke-euw1-nssi2-7.europe-west1.firebasedatabase.app/.ws?v=5&ns=thndrx-realtime-db';
    private readonly KEEP_ALIVE_MS = 45_000;
    private readonly MAX_RECONNECT_DELAY_MS = 60_000;

    private firebaseToken: string = '';
    private sessionWatcher: fs.FSWatcher | null = null;
    private hotReloadDebounce: NodeJS.Timeout | null = null;
    private tokenWaitInterval: NodeJS.Timeout | null = null;
    private isWaitingForToken = false;

    constructor() {
        this.loadSymbolsDictionary();
    }

    private loadSymbolsDictionary(): void {
        try {
            if (fs.existsSync(this.SYMBOLS_FILE)) {
                const dict: Record<string, { symbol: string; name: string }> = JSON.parse(
                    fs.readFileSync(this.SYMBOLS_FILE, 'utf-8')
                );
                for (const [uuid, entry] of Object.entries(dict)) {
                    this.symbolToUuid.set(entry.symbol.toUpperCase(), uuid);
                }
                log.info({ mapped: this.symbolToUuid.size, targets: TARGET_SYMBOLS.length }, '🎯 Symbols dictionary loaded for explicit subscriptions');
            } else {
                log.warn('⚠️ symbols.json not found — individual leaf subscriptions will fail');
            }
        } catch (e) {
            log.error('Failed to load symbols dictionary');
        }
    }

    // ─── Lifecycle ───────────────────────────────────────────────────

    public async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;

        log.info('🚀 Starting Direct Socket Gateway (v1 — No Browser)...');

        this.firebaseToken = this.extractToken();
        log.info('🔑 Firebase token extracted (length=%d, exp=%s)',
            this.firebaseToken.length,
            this.decodeTokenExpiry(this.firebaseToken)
        );

        this.connect();
        this.watchSessionFile();

        // Keep process alive
        await new Promise(() => { });
    }

    // ─── Hot-Reload: Watch user_session.json ─────────────────────────

    private watchSessionFile(): void {
        if (!fs.existsSync(this.SESSION_FILE)) {
            log.warn('⚠️ Session file not found — hot-reload watcher not started');
            return;
        }

        log.info('👁️ Watching %s for hot-reload...', this.SESSION_FILE);

        this.sessionWatcher = fs.watch(this.SESSION_FILE, (eventType) => {
            if (eventType !== 'change') return;

            // Debounce — file writes can trigger multiple events
            if (this.hotReloadDebounce) clearTimeout(this.hotReloadDebounce);
            this.hotReloadDebounce = setTimeout(() => {
                this.handleSessionFileChange();
            }, 2000);
        });

        this.sessionWatcher.on('error', (err) => {
            log.error({ error: err.message }, '❌ Session file watcher error');
        });
    }

    private handleSessionFileChange(): void {
        log.info('[Gateway] 🔄 Token file updated! Hot-reloading...');

        // If we're in token-wait mode (expired token), immediately try to reconnect
        if (this.isWaitingForToken) {
            log.info('[Gateway] 🎯 Token file changed during token-wait — checking immediately...');
            try {
                const candidate = this.extractToken();
                if (candidate !== this.firebaseToken) {
                    log.info('[Gateway] 🔑 Fresh token detected — reconnecting now!');
                    this.firebaseToken = candidate;
                    this.isWaitingForToken = false;
                    this.reconnectAttempts = 0;
                    if (this.tokenWaitInterval) {
                        clearInterval(this.tokenWaitInterval);
                        this.tokenWaitInterval = null;
                    }
                    this.connect();
                }
            } catch (err: any) {
                log.error({ error: err.message }, '[Gateway] ❌ Could not read new token');
            }
            return;
        }

        try {
            const newToken = this.extractToken();

            if (newToken === this.firebaseToken) {
                log.info('[Gateway] Token unchanged — skipping reconnect');
                return;
            }

            log.info('[Gateway] 🔑 New token detected (length=%d, exp=%s)',
                newToken.length,
                this.decodeTokenExpiry(newToken)
            );

            this.firebaseToken = newToken;

            // Also refresh the AutoSniper's bearer token
            this.sniper.reloadToken();

            // Close current connection — reconnect logic will pick up the new token
            if (this.ws) {
                log.info('[Gateway] Closing WebSocket for reconnect with new token...');
                this.ws.close();
                // onClose handler will trigger scheduleReconnect → which re-reads the token
            }
        } catch (err: any) {
            log.error({ error: err.message }, '[Gateway] ❌ Hot-reload failed — keeping current token');
        }
    }

    public async shutdown(): Promise<void> {
        log.info('🛑 Shutting down Direct Socket Gateway...');
        this.isRunning = false;

        if (this.sessionWatcher) { this.sessionWatcher.close(); this.sessionWatcher = null; }
        if (this.hotReloadDebounce) { clearTimeout(this.hotReloadDebounce); this.hotReloadDebounce = null; }
        if (this.tokenWaitInterval) { clearInterval(this.tokenWaitInterval); this.tokenWaitInterval = null; }
        if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.stopPingPong();
        this.stopWatchdog();

        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
            this.ws = null;
        }

        await disconnectRedis();
        log.info('🛑 Direct Socket Gateway stopped.');
    }

    // ─── Token Extraction ────────────────────────────────────────────

    private extractToken(): string {
        if (!fs.existsSync(this.SESSION_FILE)) {
            throw new Error(`Session file not found: ${this.SESSION_FILE}`);
        }

        const session = JSON.parse(fs.readFileSync(this.SESSION_FILE, 'utf-8'));

        // Support Case A: Custom top-level firebaseToken format
        if (session.firebaseToken) {
            log.info('🔑 Found firebaseToken at top level of user_session.json');
            return session.firebaseToken;
        }

        // Walk origins[].localStorage[] looking for firebase_token
        for (const origin of session.origins ?? []) {
            for (const entry of origin.localStorage ?? []) {
                if (entry.name === 'firebase_token') {
                    // The value is a stringified JSON: {"token":"eyJ...", "exp":...}
                    const parsed = JSON.parse(entry.value);
                    if (!parsed.token) {
                        throw new Error('firebase_token entry found but "token" field is missing');
                    }
                    return parsed.token;
                }
            }
        }

        throw new Error('firebase_token not found in user_session.json localStorage or top-level');
    }

    private decodeTokenExpiry(jwt: string): string {
        try {
            const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString());
            const exp = new Date(payload.exp * 1000);
            return exp.toISOString();
        } catch {
            return 'unknown';
        }
    }

    // ─── WebSocket Connection ────────────────────────────────────────

    private connect(): void {
        if (!this.isRunning) return;

        log.info('🔌 Connecting to Firebase RTDB → %s', this.WS_URL);
        this.requestCounter = 0;

        this.ws = new WebSocket(this.WS_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Origin': 'https://x.thndr.app',
            },
        });

        this.ws.on('open', () => this.onOpen());
        this.ws.on('message', (data: any) => this.onMessage(data));
        this.ws.on('close', (code: number, reason: Buffer) => this.onClose(code, reason));
        this.ws.on('error', (err: Error) => this.onError(err));
        this.ws.on('pong', () => this.onPong());
    }

    // ─── Event Handlers ──────────────────────────────────────────────

    private onOpen(): void {
        log.info('🔌 WebSocket CONNECTED');
        this.reconnectAttempts = 0;

        // Step 1 ONLY: Send Client Handshake — wait for server ACK before auth
        this.sendFrame({
            t: 'c',
            d: { t: 'h', d: { ts: Date.now(), v: '5' } },
        });
        log.info('🤝 Handshake sent (waiting for server hello...)');
    }

    /**
     * Step 2: Authenticate with Firebase token.
     * Called only after server responds with handshake ACK.
     */
    private sendAuth(): void {
        this.sendFrame({
            t: 'd',
            d: { r: this.nextRequestId(), a: 'auth', b: { cred: this.firebaseToken } },
        });
        log.info('🔑 Auth frame sent (waiting for server ok...)');
    }

    /**
     * Step 3: Subscribe to market feed.
     * Called only after auth is acknowledged.
     * 
     * Refactored: Sends the root subscription AND explicit leaf subscriptions
     * for target assets to prevent data starvation/throttling.
     */
    private sendSubscribe(): void {
        // 1. Root subscription for the general snapshot and global updates
        this.sendFrame({
            t: 'd',
            d: { r: this.nextRequestId(), a: 'q', b: { p: '/marketFeed', h: '' } },
        });
        log.info('👂 Root subscription to /marketFeed sent');

        // 2. Explicit individual leaf subscriptions for each target symbol
        // This forces Firebase RTDB to stream deltas for these paths regardless of general throttling.
        let subCount = 0;
        for (const symbol of TARGET_SYMBOLS) {
            const uuid = this.symbolToUuid.get(symbol);
            if (!uuid) {
                log.warn({ symbol }, '⚠️ Could not resolve target symbol to UUID — skipping leaf subscription');
                continue;
            }

            this.sendFrame({
                t: 'd',
                d: { r: this.nextRequestId(), a: 'q', b: { p: `/marketFeed/${uuid}`, h: '' } },
            });
            subCount++;
        }

        log.info({ count: subCount }, '🎯 Explicit individual leaf subscriptions sent');

        // Now that the full handshake is complete, start all timers
        this.startKeepAlive();
        this.startPingPong();
        this.startWatchdog();
    }

    private onMessage(raw: any): void {
        // ── Watchdog: Reset last-message timestamp on ANY data ────
        this.lastMessageTime = Date.now();

        const text = raw.toString();

        // ── Frame Reassembly ─────────────────────────────────────
        // Firebase splits large payloads (snapshots) across multiple
        // WebSocket frames. Detect, buffer, and reassemble them.

        if (this.isBuffering) {
            // We're mid-stream — append this chunk to the buffer
            this.frameBuffer += text;
            this.bufferChunkCount++;

            // Try to parse the accumulated buffer
            try {
                const assembled = JSON.parse(this.frameBuffer);
                // Success! We have the complete message
                const totalSize = this.frameBuffer.length;
                const chunks = this.bufferChunkCount;
                this.resetBuffer();
                log.info({ totalSize, chunks }, '🧩 Reassembled fragmented message');
                this.processCompleteMessage(assembled);
            } catch {
                // Still incomplete — keep buffering
                if (this.bufferChunkCount % 10 === 0) {
                    log.debug({ chunks: this.bufferChunkCount, bufferSize: this.frameBuffer.length }, '🧩 Still buffering...');
                }
            }
            return;
        }

        // ── Single-frame messages ────────────────────────────────
        try {
            const parsed = JSON.parse(text);
            this.processCompleteMessage(parsed);
        } catch {
            // JSON.parse failed on a standalone frame → start of a fragmented message
            if (text.length > 0) {
                this.isBuffering = true;
                this.frameBuffer = text;
                this.bufferChunkCount = 1;
                log.info({ size: text.length, snippet: text.substring(0, 200) }, '🧩 Fragmented message detected — buffering started');
            }
        }
    }

    /**
     * Process a fully-parsed JSON message from Firebase.
     */
    private processCompleteMessage(parsed: any): void {
        // ── Control frames (t: "c") ──────────────────────────
        if (parsed.t === 'c') {
            const inner = parsed.d;

            // Server Hello / Handshake ACK → trigger auth
            if (inner?.t === 'h') {
                log.info({ serverInfo: inner.d }, '🏗️  Server Hello received');
                this.sendAuth();
                return;
            }

            log.info({ ctrl: inner }, '🏗️  Control frame');
            return;
        }

        // ── Data frames (t: "d") ─────────────────────────────
        if (parsed.t === 'd') {
            const d = parsed.d;

            // Response to a numbered request (auth ACK, subscribe ACK, etc.)
            if (d?.r) {
                if (d.b?.s === 'ok') {
                    log.info('✅ Server ACK (r=%d): ok', d.r);
                    // Auth ACK (r=1) → trigger subscribe
                    if (d.r === 1) {
                        this.sendSubscribe();
                    }
                    return;
                }
                if (d.b?.s === 'invalid_token' || d.b?.s === 'expired_token') {
                    log.error('❌ AUTH FAILED — token %s. Closing connection and waiting for fresh token...', d.b.s);
                    this.handleExpiredToken();
                    return;
                }
                // Generic numbered response
                log.info({ r: d.r, status: d.b?.s }, '📝 Server response');
                return;
            }

            // Unsolicited data push (market feed)
            if (d?.b) {
                const path = d.b.p;
                const data = d.b.d;

                // Full snapshot (path === "marketFeed") → decode for symbol map, then flush all to Redis
                if (path === 'marketFeed' && data && typeof data === 'object') {
                    // First, let decoder build the symbol map
                    this.decoder.decode(JSON.stringify(parsed));

                    // Then, flush every asset as an individual QuoteTick to Redis
                    let flushed = 0;
                    for (const [assetId, assetData] of Object.entries(data)) {
                        const syntheticFrame = JSON.stringify({
                            t: 'd',
                            d: { b: { p: `marketFeed/${assetId}`, d: assetData } },
                        });
                        const tick = this.decoder.decode(syntheticFrame);
                        if (tick) {
                            this.publisher.publishQuoteTick(tick).catch(err =>
                                log.error({ error: err }, 'Redis publish failed')
                            );
                            this.sniper.onTick(tick);
                            flushed++;
                        }
                    }
                    log.info({ flushed, total: Object.keys(data).length }, '🚀 Flushed snapshot items to Redis');
                    return;
                }

                // Individual delta update (path === "marketFeed/{UUID}")
                const tick = this.decoder.decode(JSON.stringify(parsed));
                if (tick) {
                    this.publisher.publishQuoteTick(tick).catch(err =>
                        log.error({ error: err }, 'Redis publish failed')
                    );
                    this.sniper.onTick(tick);
                    log.info({ symbol: tick.symbol, price: tick.lastPrice }, '🚀 Tick');
                }
            }
        }
    }

    private resetBuffer(): void {
        this.frameBuffer = '';
        this.isBuffering = false;
        this.bufferChunkCount = 0;
    }

    private onClose(code: number, reason: Buffer): void {
        log.warn({ code, reason: reason.toString() }, '🔌 WebSocket CLOSED');
        this.cleanup();
        this.scheduleReconnect();
    }

    private onError(err: Error): void {
        log.error({ error: err.message }, '💥 WebSocket ERROR');
        // onClose will fire after this, triggering reconnect
    }

    // ─── Keep-Alive (Firebase Protocol Level) ────────────────────────

    private startKeepAlive(): void {
        if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);

        this.keepAliveInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.sendFrame({ t: 'c', d: { t: 'p', d: {} } });
                log.debug('💓 Keep-alive ping (Firebase)');
            }
        }, this.KEEP_ALIVE_MS);
    }

    // ─── WS-Level Ping/Pong Heartbeat ────────────────────────────────

    private startPingPong(): void {
        this.stopPingPong();

        this.pingInterval = setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

            this.ws.ping();
            log.debug('💓 WS ping sent');

            // Start pong deadline — if no pong arrives in time, connection is dead
            this.pongTimeout = setTimeout(() => {
                log.error(
                    { timeoutMs: this.PONG_TIMEOUT_MS },
                    '💀 Pong timeout — connection is dead, terminating socket'
                );
                this.ws?.terminate();
            }, this.PONG_TIMEOUT_MS);
        }, this.PING_INTERVAL_MS);

        log.info(
            { pingIntervalMs: this.PING_INTERVAL_MS, pongTimeoutMs: this.PONG_TIMEOUT_MS },
            '💓 WS-level ping/pong heartbeat started'
        );
    }

    private onPong(): void {
        // Pong received — clear the deadline timer
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
        }
        log.debug('💓 WS pong received');
    }

    private stopPingPong(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
        }
    }

    // ─── Watchdog Timer (Silent Drop Detection) ──────────────────────

    private startWatchdog(): void {
        this.stopWatchdog();
        this.lastMessageTime = Date.now();

        this.watchdogInterval = setInterval(() => {
            if (!this.isRunning || !this.ws) return;

            const silenceMs = Date.now() - this.lastMessageTime;
            log.debug({ silenceMs, thresholdMs: this.WATCHDOG_TIMEOUT_MS }, '🐕 Watchdog check');

            if (silenceMs > this.WATCHDOG_TIMEOUT_MS) {
                log.warn(
                    { silenceMs, thresholdMs: this.WATCHDOG_TIMEOUT_MS },
                    '🚨 Watchdog triggered — no messages for %dms, terminating socket for reconnect',
                    silenceMs
                );

                // If silence is 2x the threshold, data is truly stale — signal AuthManager
                if (silenceMs > this.WATCHDOG_TIMEOUT_MS * 2) {
                    this.signalReauth('stale_data_watchdog');
                }

                // Force-terminate — onClose will fire and trigger scheduleReconnect()
                this.ws?.terminate();
            }
        }, this.WATCHDOG_INTERVAL_MS);

        log.info(
            { intervalMs: this.WATCHDOG_INTERVAL_MS, timeoutMs: this.WATCHDOG_TIMEOUT_MS },
            '🐕 Watchdog timer started'
        );
    }

    private stopWatchdog(): void {
        if (this.watchdogInterval) {
            clearInterval(this.watchdogInterval);
            this.watchdogInterval = null;
        }
    }

    // ─── Reauth Signal (Notify AuthManager) ────────────────────────────

    private signalReauth(reason: string): void {
        try {
            const signal = {
                requestedAt: new Date().toISOString(),
                reason,
            };
            fs.writeFileSync(this.REAUTH_SIGNAL_FILE, JSON.stringify(signal, null, 2));
            log.info({ reason }, '📡 Reauth signal written to %s', this.REAUTH_SIGNAL_FILE);
        } catch (err: any) {
            log.error({ error: err.message }, '❌ Failed to write reauth signal file');
        }
    }

    // ─── Expired Token Recovery ──────────────────────────────────────

    private handleExpiredToken(): void {
        if (this.isWaitingForToken) return; // Already waiting
        this.isWaitingForToken = true;

        // 1. Signal AuthManager to run a passive re-capture cycle
        this.signalReauth('expired_token');

        // 2. Gracefully close the current dead connection
        this.stopPingPong();
        this.stopWatchdog();
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
            this.ws = null;
        }
        this.cleanup();

        // 3. Cancel any pending reconnect (we'll handle it ourselves)
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        const staleToken = this.firebaseToken;
        log.info('⏳ Entering token-wait mode. Polling user_session.json every 15s for a fresh token...');

        // 4. Poll for a new token every 15 seconds
        this.tokenWaitInterval = setInterval(() => {
            try {
                const candidate = this.extractToken();
                if (candidate === staleToken) {
                    log.debug('⏳ Token unchanged — still waiting...');
                    return; // Same token, keep waiting
                }

                // New token found!
                log.info('🔑 Fresh token detected (length=%d, exp=%s) — reconnecting!',
                    candidate.length,
                    this.decodeTokenExpiry(candidate)
                );
                this.firebaseToken = candidate;
                this.isWaitingForToken = false;
                this.reconnectAttempts = 0; // Reset backoff

                if (this.tokenWaitInterval) {
                    clearInterval(this.tokenWaitInterval);
                    this.tokenWaitInterval = null;
                }

                this.connect();
            } catch (err: any) {
                log.debug({ error: err.message }, '⏳ Token file not ready yet...');
            }
        }, 15_000);
    }

    // ─── Reconnection ────────────────────────────────────────────────

    private scheduleReconnect(): void {
        if (!this.isRunning) return;

        this.reconnectAttempts++;
        const delay = Math.min(
            1000 * Math.pow(2, this.reconnectAttempts - 1),
            this.MAX_RECONNECT_DELAY_MS,
        );

        log.info({ attempt: this.reconnectAttempts, delayMs: delay }, '🔄 Reconnecting in...');

        this.reconnectTimeout = setTimeout(() => {
            // Re-read token on reconnect in case session was refreshed
            try {
                this.firebaseToken = this.extractToken();
                log.info('🔑 Token re-loaded for reconnect');
            } catch (e: any) {
                log.error({ error: e.message }, 'Failed to re-load token, using cached');
            }
            this.connect();
        }, delay);
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    private sendFrame(obj: any): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }

    private nextRequestId(): number {
        return ++this.requestCounter;
    }

    private cleanup(): void {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
        this.stopPingPong();
        this.stopWatchdog();
        this.resetBuffer();
    }
}

// ─── Standalone Entry Point ──────────────────────────────────────────
if (require.main === module) {
    const gateway = new DirectSocketGateway();

    const graceful = async () => {
        await gateway.shutdown();
        process.exit(0);
    };

    process.on('SIGINT', graceful);
    process.on('SIGTERM', graceful);

    gateway.start().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
