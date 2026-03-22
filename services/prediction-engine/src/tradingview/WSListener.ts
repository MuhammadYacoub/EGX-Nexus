/**
 * =============================================================================
 * Chaimera Broker Gateway — WebSocket Listener (Core)
 * =============================================================================
 *
 * The heart of Phase 1. This class:
 *   1. Reads broker credentials (token, WSS URL) from Redis
 *   2. Establishes a WebSocket Secure connection to the broker
 *   3. Handles ping/pong keep-alive to detect dead connections
 *   4. Routes incoming raw messages to the normalizer/publisher
 *   5. Reconnects with exponential backoff on disconnection
 *   6. Listens for TOKEN_REFRESHED events to hot-swap credentials
 *
 * Architecture:
 *   ┌──────────────┐    ┌─────────────┐    ┌───────────────┐    ┌───────────┐
 *   │ Broker WSS   │───▶│ WSListener  │───▶│ Normalizer*   │───▶│ Publisher │
 *   │ Backend      │    │ (this file) │    │ (pluggable)   │    │ (Redis)   │
 *   └──────────────┘    └─────────────┘    └───────────────┘    └───────────┘
 *
 *   * Normalizer is called via a callback to keep WSListener broker-agnostic.
 *     The actual normalization logic is injected from the entrypoint.
 *
 * Usage:
 *   const listener = new WSListener({
 *     onMessage: (raw) => { normalize and publish },
 *   });
 *   await listener.start();
 *   // ... later, on shutdown:
 *   await listener.stop();
 */

import WebSocket from 'ws';
import { TokenStore, type BrokerCredentials } from '../redis/TokenStore';
import { SignalBus } from '../redis/SignalBus';
import { LifecycleEvents } from '../config/redis';
import { config } from '../config';
import { retryWithBackoff, type RetryOptions } from '../utils/retry';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'WSListener' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration options for the WSListener */
export interface WSListenerOptions {
    /**
     * Callback invoked for every raw message received from the WebSocket.
     * The listener is broker-agnostic — it passes raw data to this callback
     * for normalization and publishing.
     *
     * @param data - Raw message data (string or Buffer)
     * @param brokerId - The broker this message came from
     */
    onMessage: (data: WebSocket.Data, brokerId: string) => void;

    /**
     * Optional: Messages to send immediately after WebSocket connection is
     * established (e.g., subscription commands, auth frames).
     * Each entry is a raw string or object that will be JSON.stringify'd.
     *
     * These are constructed from the `ws_metadata` Redis key.
     */
    subscriptionMessages?: Array<string | Record<string, unknown>>;

    /**
     * Optional: Custom headers to include in the WebSocket upgrade request.
     * Some brokers require Origin, Referer, or custom headers.
     */
    customHeaders?: Record<string, string>;

    /** Optional: Override the broker ID (defaults to config.brokerId) */
    brokerId?: string;
}

/** Internal state of the listener */
type ListenerState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopped';

// ---------------------------------------------------------------------------
// WSListener Class
// ---------------------------------------------------------------------------

export class WSListener {
    // --- Configuration ---
    private readonly brokerId: string;
    private readonly onMessage: WSListenerOptions['onMessage'];
    private readonly subscriptionMessages: WSListenerOptions['subscriptionMessages'];
    private readonly customHeaders: WSListenerOptions['customHeaders'];

    // --- Dependencies ---
    private readonly tokenStore: TokenStore;
    private readonly signalBus: SignalBus;

    // --- Connection State ---
    private ws: WebSocket | null = null;
    private state: ListenerState = 'idle';
    private reconnectAttempt: number = 0;
    private isConnecting: boolean = false; // Semaphore to prevent race conditions

    // --- Keep-Alive ---
    private pingInterval: ReturnType<typeof setInterval> | null = null;
    private pongTimeout: ReturnType<typeof setTimeout> | null = null;
    private lastPongAt: number = 0;

    // --- Shutdown ---
    private abortController: AbortController = new AbortController();

    // --- Metrics ---
    private messageCount: number = 0;
    private connectionStartedAt: number = 0;

    constructor(options: WSListenerOptions) {
        this.brokerId = options.brokerId || config.brokerId;
        this.onMessage = options.onMessage;
        this.subscriptionMessages = options.subscriptionMessages;
        this.customHeaders = options.customHeaders;

        this.tokenStore = new TokenStore(this.brokerId);
        this.signalBus = new SignalBus(this.brokerId);
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Starts the WebSocket listener.
     *
     * Flow:
     *   1. Subscribe to lifecycle events (TOKEN_REFRESHED, etc.)
     *   2. Read credentials from Redis
     *   3. Establish WebSocket connection
     *   4. Start ping/pong keep-alive
     *   5. Enter message loop
     *
     * If credentials are not yet available (admin hasn't injected them),
     * the listener will wait and retry with backoff.
     */
    async start(): Promise<void> {
        if (this.state !== 'idle') {
            log.warn({ state: this.state }, 'WSListener.start() called in non-idle state, ignoring');
            return;
        }

        log.info({ brokerId: this.brokerId }, '🚀 Starting WebSocket Listener');

        // Subscribe to lifecycle events for token hot-swap
        await this.subscribeToLifecycleEvents();

        // Connect (with retry if credentials aren't available yet)
        await this.connectWithRetry();
    }

    /**
     * Gracefully stops the listener.
     *
     * Sequence:
     *   1. Signal abort to cancel any in-progress retries
     *   2. Stop ping/pong timers
     *   3. Close WebSocket with clean close code
     *   4. Unsubscribe from lifecycle events
     */
    async stop(): Promise<void> {
        log.info({ brokerId: this.brokerId }, '🛑 Stopping WebSocket Listener');
        this.state = 'stopped';

        // Cancel any pending retries
        this.abortController.abort();

        // Stop keep-alive
        this.stopPingPong();

        // Close WebSocket
        if (this.ws) {
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close(1000, 'Chaimera listener shutting down');
            }
            this.ws.removeAllListeners();
            this.ws = null;
        }

        // Unsubscribe from lifecycle
        await this.signalBus.unsubscribe();

        const uptime = this.connectionStartedAt
            ? ((Date.now() - this.connectionStartedAt) / 1000).toFixed(1)
            : '0';

        log.info(
            {
                brokerId: this.brokerId,
                totalMessages: this.messageCount,
                uptimeSeconds: uptime,
            },
            '✅ WebSocket Listener stopped'
        );
    }

    /** Returns current listener state for health checks */
    getState(): ListenerState {
        return this.state;
    }

    /** Returns true if the WebSocket is currently open and receiving data */
    isConnected(): boolean {
        return this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN;
    }

    /** Returns the current reconnection attempt number (0 when connected) */
    getReconnectAttempt(): number {
        return this.reconnectAttempt;
    }

    /**
     * Sends raw data through the active WebSocket connection.
     *
     * Used by protocol-level handlers (e.g., TradingView heartbeat echo)
     * that need to send data back without going through the subscription
     * message mechanism.
     *
     * @param data - Raw string to send (already framed if needed)
     */
    sendRaw(data: string): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            log.warn('sendRaw called but WebSocket is not open — dropping');
            return;
        }

        this.ws.send(data, (err) => {
            if (err) {
                log.error(
                    { error: err.message },
                    'Failed to send raw data through WebSocket'
                );
            }
        });
    }

    // =========================================================================
    // CONNECTION MANAGEMENT
    // =========================================================================

    /**
     * Connects to the broker's WebSocket with retry logic.
     *
     * If credentials are not in Redis (admin hasn't injected them yet),
     * this will retry with exponential backoff until they appear or
     * max attempts are reached.
     */
    private async connectWithRetry(): Promise<void> {
        // Debounce: prevent multiple concurrent connection attempts
        if (this.isConnecting) {
            log.warn('Connection attempt already in progress — debouncing');
            return;
        }

        this.isConnecting = true;

        const retryOpts: RetryOptions = {
            maxAttempts: config.ws.maxReconnectAttempts,
            baseDelayMs: Math.max(1000, config.ws.reconnectBaseDelayMs), // Enforce min 1s
            maxDelayMs: config.ws.reconnectMaxDelayMs,
            abortSignal: this.abortController.signal,
            onRetry: (attempt, delayMs, error) => {
                this.reconnectAttempt = attempt;
                log.warn(
                    {
                        attempt,
                        maxAttempts: config.ws.maxReconnectAttempts,
                        delayMs: Math.round(delayMs),
                        error: error.message,
                    },
                    'WebSocket connection failed, retrying...'
                );
            },
        };

        try {
            this.state = 'connecting';

            await retryWithBackoff(async () => {
                // Step 1: Read credentials from Redis
                const creds = await this.tokenStore.getCredentials();
                if (!creds) {
                    throw new Error('No credentials found in Redis — has admin injected token/endpoint?');
                }

                // Step 2: Validate token TTL
                if (creds.tokenTtlSeconds === -2) {
                    throw new Error('Token key does not exist in Redis');
                }

                if (creds.tokenTtlSeconds > 0 && creds.tokenTtlSeconds < 30) {
                    throw new Error(
                        `Token TTL too low (${creds.tokenTtlSeconds}s) — waiting for refresh`
                    );
                }

                // Step 3: Establish WebSocket connection
                await this.connect(creds);
            }, retryOpts);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));

            if (err.message.includes('aborted')) {
                log.info('Connection retry aborted by shutdown signal');
                return;
            }

            log.fatal(
                { error: err.message, attempts: config.ws.maxReconnectAttempts },
                '💀 All reconnection attempts exhausted — listener giving up'
            );
            this.state = 'stopped';

            // Publish emergency signal for monitoring/alerting
            await this.signalBus.publish(LifecycleEvents.TOKEN_EXPIRED, {
                reason: 'reconnect_exhausted',
                lastError: err.message,
            });

            // Exit with non-zero code so container orchestrator (Docker/K8s) restarts us
            process.exit(1);
        } finally {
            this.isConnecting = false;
        }
    }

    /**
     * Establishes a single WebSocket connection to the broker.
     *
     * This method returns a Promise that resolves when the connection
     * is successfully opened, or rejects on failure/timeout.
     */
    private connect(creds: BrokerCredentials): Promise<void> {
        return new Promise((resolve, reject) => {
            log.info(
                { wsEndpoint: creds.wsEndpoint, tokenTtl: creds.tokenTtlSeconds },
                '🔌 Establishing WebSocket connection...'
            );

            // Build WebSocket headers
            // NOTE: We do NOT add Authorization: Bearer automatically.
            // TradingView uses protocol-level auth (set_auth_token message).
            // Brokers that need HTTP-level auth should pass it via customHeaders.
            const headers: Record<string, string> = {
                ...this.customHeaders,
            };

            // Inject cookies if available
            if (creds.cookies) {
                try {
                    const cookieObj = JSON.parse(creds.cookies);
                    if (typeof cookieObj === 'object' && cookieObj !== null) {
                        const cookieString = Object.entries(cookieObj)
                            .map(([k, v]) => `${k}=${v}`)
                            .join('; ');
                        headers['Cookie'] = cookieString;
                    } else if (typeof cookieObj === 'string') {
                        headers['Cookie'] = cookieObj;
                    }
                } catch {
                    log.warn('Failed to parse cookies from Redis — sending without cookies');
                }
            }

            // Create WebSocket connection
            // Capture in local variable for closure safety
            const socket = new WebSocket(creds.wsEndpoint, {
                headers,
                handshakeTimeout: 15_000,
                followRedirects: true,
                maxRedirects: 3,
            });

            this.ws = socket;

            // --- Event: Connection Opened ---
            socket.on('open', () => {
                // Verify this is still the active socket
                if (this.ws !== socket) return;

                this.state = 'connected';
                this.reconnectAttempt = 0;
                this.connectionStartedAt = Date.now();
                this.lastPongAt = Date.now();

                log.info(
                    { wsEndpoint: creds.wsEndpoint },
                    '✅ WebSocket connection established'
                );

                // Send subscription messages
                this.sendSubscriptions(socket, creds);

                // Start keep-alive ping/pong
                this.startPingPong();

                resolve();
            });

            // --- Event: Message Received ---
            socket.on('message', (data: WebSocket.Data) => {
                this.messageCount++;

                try {
                    this.onMessage(data, this.brokerId);
                } catch (handlerError) {
                    log.error(
                        { error: (handlerError as Error).message, messageNumber: this.messageCount },
                        'onMessage handler threw an error'
                    );
                }
            });

            // --- Event: Pong Received ---
            socket.on('pong', () => {
                this.lastPongAt = Date.now();
                log.trace('Pong received');
            });

            // --- Event: Connection Closed ---
            socket.on('close', (code: number, reason: Buffer) => {
                // Only handle if this is the active socket
                if (this.ws !== socket) return;

                const reasonStr = reason.toString('utf8') || 'unknown';
                log.warn(
                    { code, reason: reasonStr, state: this.state },
                    '🔌 WebSocket connection closed'
                );

                this.stopPingPong();

                if (this.state === 'stopped') return;

                if (code === 4001 || code === 4401 || code === 401 || code === 403) {
                    log.error(
                        { code },
                        '🔑 Connection closed due to authentication failure'
                    );
                    this.signalBus.publish(LifecycleEvents.TOKEN_EXPIRED, {
                        closeCode: code,
                        reason: reasonStr,
                    });
                }

                this.handleDisconnect();
            });

            // --- Event: Error ---
            socket.on('error', (error: Error) => {
                log.error({ error: error.message }, '❌ WebSocket error');

                if (this.state === 'connecting') {
                    reject(error);
                }
            });

            // --- Event: Unexpected Response ---
            socket.on('unexpected-response', (_req, res) => {
                const statusCode = res.statusCode || 0;
                log.error(
                    { statusCode, statusMessage: res.statusMessage },
                    '❌ WebSocket upgrade failed with HTTP error'
                );
                reject(new Error(`WebSocket upgrade failed: HTTP ${statusCode}`));
            });
        });
    }

    /**
     * Sends subscription messages after the WebSocket is opened.
     */
    private sendSubscriptions(socket: WebSocket, creds: BrokerCredentials): void {
        // STRICT CHECK: Cannot send if not OPEN
        if (socket.readyState !== WebSocket.OPEN) {
            log.warn(
                { readyState: socket.readyState },
                '⚠️ Cannot send subscriptions — socket not OPEN'
            );
            return;
        }

        const messages: Array<string | Record<string, unknown>> = [];

        if (this.subscriptionMessages) {
            messages.push(...this.subscriptionMessages);
        }

        if (creds.wsMetadata) {
            try {
                const metadata = JSON.parse(creds.wsMetadata);
                if (metadata.subscriptions && Array.isArray(metadata.subscriptions)) {
                    messages.push(...metadata.subscriptions);
                }
            } catch {
                log.warn('Failed to parse ws_metadata');
            }
        }

        for (const msg of messages) {
            const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);

            log.info({ payload: payload.substring(0, 200) }, '📤 Sending subscription message');

            // Safe send with error callback
            socket.send(payload, (err) => {
                if (err) {
                    log.error(
                        { error: err.message },
                        'Failed to send subscription message'
                    );
                }
            });
        }

        if (messages.length > 0) {
            log.info({ count: messages.length }, '📋 All subscription messages sent');
        }
    }

    // =========================================================================
    // KEEP-ALIVE (PING/PONG)
    // =========================================================================

    /**
     * Starts the WebSocket ping/pong keep-alive mechanism.
     *
     * Flow:
     *   1. Every `pingIntervalMs`, send a ping frame
     *   2. Start a pong timeout timer
     *   3. If pong is received, the `on('pong')` handler resets `lastPongAt`
     *   4. If pong is NOT received within `pongTimeoutMs`, declare connection dead
     *
     * This detects "zombie" connections where the TCP socket is open but the
     * remote end is no longer responding (common with NAT timeout, load balancer
     * idle timeout, or broker-side disconnect without FIN).
     */
    private startPingPong(): void {
        this.stopPingPong(); // Clear any existing timers

        // If ping interval is 0 or negative, ping/pong is disabled.
        // TradingView uses its own ~h~ heartbeat mechanism at the protocol level,
        // so WS-level pings are not needed.
        if (config.ws.pingIntervalMs <= 0) {
            log.debug('Ping/pong disabled (pingIntervalMs=0) — relying on protocol-level heartbeats');
            return;
        }

        this.pingInterval = setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                return;
            }

            // Send ping frame
            this.ws.ping();
            log.trace('Ping sent');

            // Set pong timeout — if no pong by deadline, connection is dead
            this.pongTimeout = setTimeout(() => {
                const silenceMs = Date.now() - this.lastPongAt;

                log.error(
                    { silenceMs, timeoutMs: config.ws.pongTimeoutMs },
                    '💀 Pong timeout — connection is dead, terminating'
                );

                // Force-kill the connection (triggers 'close' event → reconnect)
                this.ws?.terminate();
            }, config.ws.pongTimeoutMs);
        }, config.ws.pingIntervalMs);

        log.debug(
            { pingIntervalMs: config.ws.pingIntervalMs, pongTimeoutMs: config.ws.pongTimeoutMs },
            'Ping/pong keep-alive started'
        );
    }

    /**
     * Stops all keep-alive timers.
     */
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

    // =========================================================================
    // RECONNECTION
    // =========================================================================

    /**
     * Handles an unexpected disconnection by cleaning up and reconnecting.
     *
     * Called from the WebSocket `close` event handler (unless state is 'stopped').
     * Waits briefly before reconnecting to allow Redis to be updated with
     * a fresh token (in case the disconnect was auth-related).
     */
    private handleDisconnect(): void {
        if (this.state === 'stopped') return;

        this.state = 'reconnecting';
        this.ws?.removeAllListeners();
        this.ws = null;

        log.info('🔄 Scheduling reconnection...');

        // Reconnect with full retry logic (re-reads credentials from Redis)
        // Use a fresh AbortController in case the old one was aborted
        this.abortController = new AbortController();
        this.connectWithRetry().catch((err) => {
            log.fatal({ error: err.message }, 'Reconnection failed fatally');
        });
    }

    // =========================================================================
    // TOKEN LIFECYCLE
    // =========================================================================

    /**
     * Subscribes to Redis Pub/Sub lifecycle events for token hot-swap.
     *
     * When TOKEN_REFRESHED is received:
     *   - If the broker supports in-band re-auth → send auth frame
     *   - Otherwise → graceful reconnect (Make-Before-Break)
     */
    private async subscribeToLifecycleEvents(): Promise<void> {
        await this.signalBus.subscribe((event, payload) => {
            switch (event) {
                case LifecycleEvents.TOKEN_REFRESHED:
                    log.info(payload, '🔑 Token refreshed — initiating credential hot-swap');
                    this.handleTokenRefresh();
                    break;

                case LifecycleEvents.TOKEN_EXPIRED:
                    log.warn(payload, '⚠️ Token expired signal received');
                    // If we're already reconnecting, no action needed
                    if (this.state !== 'reconnecting') {
                        this.handleDisconnect();
                    }
                    break;

                case LifecycleEvents.TOKEN_MISSING:
                    log.error(payload, '🚨 Token missing from Redis');
                    break;

                default:
                    log.debug({ event }, 'Received unhandled lifecycle event');
            }
        });
    }

    /**
     * Handles a token refresh by performing a graceful reconnect.
     *
     * Phase 1 Strategy: Always do a full reconnect (Option B from architecture).
     * We don't yet know which brokers support in-band re-auth, so the safest
     * approach is to close and reopen with new credentials.
     *
     * Future Enhancement: Add an `authFrameBuilder` option to WSListenerOptions
     * that, if provided, sends an auth frame instead of reconnecting.
     */
    private async handleTokenRefresh(): Promise<void> {
        if (this.state === 'stopped') return;

        log.info('🔄 Performing graceful reconnect with new credentials');

        // Stop keep-alive on old connection
        this.stopPingPong();

        // Close old connection cleanly
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close(1000, 'Token refresh — reconnecting with new credentials');
        }

        // The 'close' event handler will trigger handleDisconnect() → connectWithRetry()
        // which will read the fresh token from Redis.
    }
}
