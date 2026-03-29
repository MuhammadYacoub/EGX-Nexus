
import { chromium, Browser, Page, CDPSession, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { disconnectRedis } from '../redis/RedisClient';
import { RedisPublisher } from '../publisher/RedisPublisher';
import { ThndrDecoder } from '../utils/ThndrDecoder';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'ThndrGateway' });

// Declare DOM globals for Playwright evaluation contexts
declare const document: any;
declare const window: any;
declare const localStorage: any;

export class ThndrGateway {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private cdp: CDPSession | null = null;

    private readonly decoder = new ThndrDecoder();
    private readonly publisher = new RedisPublisher();

    private isRunning = false;
    private lastDataTime = Date.now();
    private watchdogInterval: NodeJS.Timeout | null = null;
    private isRateLimited = false;
    private rateLimitCooldownUntil = 0;

    private readonly PROFILE_DIR = path.resolve(__dirname, '../../profiles/x');
    private readonly DEBUG_SCREENSHOT_PATH = path.resolve(__dirname, '../../debug_error.png');
    private readonly TARGET_URL = 'https://x.thndr.app/security/EGX/COMI';
    private readonly WATCHDOG_TIMEOUT_MS = 45000;
    private readonly COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

    constructor() { }

    private async sendTelegramAlert(message: string) {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (!token || !chatId) return;

        try {
            const url = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(message)}`;
            await fetch(url);
        } catch (e) {
            log.error('Failed to send Telegram alert:', e);
        }
    }

    public async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;

        log.info('🚀 Starting Thndr Gateway (v6 - Dual Profile Strategy)...');

        try {
            await this.initBrowser();

            log.info('🛡️ CDP attached, proceeding to navigation...');

            await this.navigate();
            this.startWatchdog();

            // Keep process alive
            await new Promise(() => { });
        } catch (error) {
            log.error({ error }, 'Fatal error in gateway');
            await this.captureState('fatal_error');
            await this.shutdown();
            process.exit(1);
        }
    }

    private async initBrowser(): Promise<void> {
        log.info('🌐 Initializing Browser (Isolated Profile: profiles/x)...');

        if (!fs.existsSync(this.PROFILE_DIR)) {
            fs.mkdirSync(this.PROFILE_DIR, { recursive: true });
        }

        this.context = await chromium.launchPersistentContext(this.PROFILE_DIR, {
            headless: true,
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ignoreHTTPSErrors: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ]
        });

        this.page = this.context.pages()[0] || await this.context.newPage();
        this.browser = this.context.browser();

        // Critical Fix: Attach CDP *BEFORE* any initialization to capture everything
        await this.setupCDP();

        // 🟢 Mock Visibility API to force "Always Visible"
        await this.page.addInitScript(() => {
            Object.defineProperty(document, 'visibilityState', {
                get: () => 'visible',
                configurable: true
            });
            Object.defineProperty(document, 'hidden', {
                get: () => false,
                configurable: true
            });
        });

        // 🔊 Forward Browser Console Logs to Node.js Stdout
        this.page.on('console', msg => {
            const type = msg.type();
            const text = msg.text();
            // Suppress expected noise from blocked resources
            if (text.includes('ERR_FAILED') || text.includes('preloaded using link preload')) return;
            if (type === 'error') {
                log.error({ browserLog: text }, '🛑 Browser Error');
            } else if (type === 'warning') {
                log.warn({ browserLog: text }, '⚠️ Browser Warning');
            } else {
                if (text.includes('firebase') || text.includes('socket') || text.includes('auth')) {
                    log.info({ browserLog: text }, '🌐 Browser Log');
                }
            }
        });
    }

    private async setupCDP(): Promise<void> {
        if (!this.page) return;

        // 🛡️ Resource Blocking (Stealth Mode) — reduce request footprint
        await this.page.route('**/*', route => {
            const type = route.request().resourceType();
            if (['image', 'font', 'stylesheet', 'media'].includes(type)) {
                return route.abort();
            }
            return route.continue();
        });
        log.info('🛡️ Resource blocking active (images, fonts, CSS, media)');

        log.info('🔌 Connecting to CDP (Chrome DevTools Protocol)...');
        this.cdp = await this.context!.newCDPSession(this.page);

        this.cdp.on('Network.webSocketFrameReceived', (params: any) => {
            this.handleWebSocketFrame(params);
        });

        this.cdp.on('Network.webSocketFrameSent', () => {
            this.lastDataTime = Date.now();
        });

        // 🥶 Rate-Limit Detection via HTTP responses
        this.cdp.on('Network.responseReceived', (params: any) => {
            const status = params.response?.status;
            if (status === 429) {
                if (!this.isRateLimited) {
                    this.isRateLimited = true;
                    this.rateLimitCooldownUntil = Date.now() + this.COOLDOWN_MS;
                    log.warn('🥶 Rate Limit Detected (429). Initiating 5-minute Cool-Down.');
                }
            }
        });

        await this.cdp.send('Network.enable');

        log.info('✅ CDP Interceptor attached & ready');
    }

    private async navigate(): Promise<void> {
        if (!this.page) return;
        log.info(`👉 Navigating to ${this.TARGET_URL}...`);
        try {
            await this.page.goto(this.TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (e: any) {
            if (e.name === 'TimeoutError') {
                log.warn('⏳ Navigation timed out (load heavy), but continuing to listeners...');
            } else {
                log.error({ error: e.message }, 'Navigation error, but continuing listeners...');
                await this.captureState('nav_error');
            }
        }

        try {
            // Verbal Debugging
            const title = await this.page.title();
            const url = this.page.url();
            log.info({ title, url }, '📄 Page Loaded');

            // Session check
            if (url.includes('login') || title.toLowerCase().includes('login')) {
                log.fatal('❌ Session Expired: Please update x profile manually.');
                await this.sendTelegramAlert('🚨 Session Expired: Please update x profile manually.');
                await this.captureState('session_expired');
                await this.shutdown();
                process.exit(1);
            } else {
                // 🖱️ Simulate User Interaction to Wake Up App
                await this.page.click('body', { force: true });
                await this.page.evaluate(() => window.focus());
                log.info('🖱️ Simulated User Interaction (Wake up call)');
            }

            // 🕵️ Session / Token Verification
            // Check if Firebase Auth token exists in LocalStorage
            const hasAuth = await this.page.evaluate(() => {
                const keys = Object.keys(localStorage);
                return keys.some(k => k.startsWith('firebase:authUser'));
            });

            if (hasAuth) {
                log.info('✅ Auth Token Found in Page (LocalStorage verified)');
            } else {
                log.fatal('❌ Auth Token MISSING in Page! Session Injection Failed.');
                await this.captureState('missing_token');
            }

        } catch (e) {
            log.warn('Error during post-navigation checks/interaction (ignoring)');
        }
    }

    private handleWebSocketFrame(params: any): void {
        const payload = params.response?.payloadData;
        if (!payload) return;

        // 1. Proof of Life: Reset watchdog on ANY data
        this.lastDataTime = Date.now();

        // 2. X-Ray Logging (Verbose)
        if (payload.length < 1000) {
            log.info({ payload }, '📨 Raw Data Arrived');
        } else {
            log.info({ size: payload.length }, '📦 Big Snapshot Arrived (Potential Dictionary)');
        }

        // 3. Attempt Decode
        try {
            const tick = this.decoder.decode(payload);

            if (tick) {
                this.publisher.publishQuoteTick(tick).catch(err =>
                    log.error({ error: err }, 'Redis publish failed')
                );
                // Log every successful tick during debug phase
                log.info({ symbol: tick.symbol, price: tick.lastPrice }, '🚀 Market Tick Decoded!');
            }
        } catch (err) {
            log.warn({ error: err }, '⚠️ Decoder crashed on frame');
        }
    }

    private startWatchdog(): void {
        this.watchdogInterval = setInterval(async () => {
            if (!this.isRunning) return;

            const now = Date.now();

            // 🥶 Cool-Down Guard: If rate-limited, wait it out
            if (this.isRateLimited) {
                const remaining = this.rateLimitCooldownUntil - now;
                if (remaining > 0) {
                    const remainingSec = Math.round(remaining / 1000);
                    if (remainingSec % 30 === 0) { // Log every ~30s
                        log.info({ remainingSec }, '🧊 Cool-Down active. Waiting...');
                    }
                    return; // Skip this tick entirely
                }
                // Cool-down expired — attempt gentle recovery
                log.info('🌡️ Cool-Down expired. Attempting gentle recovery...');
                this.isRateLimited = false;
                this.lastDataTime = now; // Reset watchdog baseline

                try {
                    await this.page?.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
                    const title = await this.page?.title();
                    const url = this.page?.url();
                    log.info({ title, url }, '♻️ Page reloaded after cool-down');
                } catch (error) {
                    log.error({ error }, 'Failed to reload after cool-down');
                }
                return;
            }

            // Normal watchdog logic
            const silence = now - this.lastDataTime;

            if (silence > this.WATCHDOG_TIMEOUT_MS) {
                log.warn({ silenceMs: silence }, '🚨 No traffic detected.');
                this.lastDataTime = now;

                await this.captureState('debug_silence');

                try {
                    await this.page?.reload({ waitUntil: 'domcontentloaded' });
                    const title = await this.page?.title();
                    const url = this.page?.url();
                    log.info({ title, url }, '♻️ Page reloaded');
                } catch (error) {
                    log.error({ error }, 'Failed to reload page');
                }
            }
        }, 10000); // Check every 10s instead of 5s to reduce overhead
    }

    private async captureState(reason: string): Promise<void> {
        if (!this.page) return;
        try {
            await this.page.screenshot({ path: this.DEBUG_SCREENSHOT_PATH });
            log.info({ path: this.DEBUG_SCREENSHOT_PATH, reason }, '📸 Debug screenshot captured');
        } catch (err) {
            log.error({ error: err }, 'Failed to capture screenshot');
        }
    }

    public async shutdown(): Promise<void> {
        this.isRunning = false;
        if (this.watchdogInterval) clearInterval(this.watchdogInterval);
        if (this.context) await this.context.close();
        if (this.browser) await this.browser.close();
        await disconnectRedis();
        log.info('🛑 Thndr Gateway stopped');
    }
}

if (require.main === module) {
    const gateway = new ThndrGateway();
    gateway.start().catch(err => {
        console.error(err);
        process.exit(1);
    });
}