/**
 * =============================================================================
 * Chaimera Broker Gateway — TradingView Playwright Authentication
 * =============================================================================
 *
 * Automates TradingView login using Playwright, extracts:
 *   1. `sessionid` cookie (required for WS upgrade)
 *   2. JWT `auth_token` (used in set_auth_token WS message)
 *
 * Strategy:
 *   - Launch Chromium → navigate to sign-in page
 *   - Handle cookie banners, fill email/password, submit
 *   - Detect CAPTCHA → warn (cannot auto-solve)
 *   - After login: extract sessionid from cookies
 *   - Extract auth_token via page JS evaluation + network interception
 *
 * All selectors use resilient Playwright locators (getByRole, getByText).
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { config } from '../config';
import { logger } from '../utils/logger';

// Browser globals used inside page.evaluate() callbacks — these run in
// Chromium's JS context, not Node.js, but TS needs declarations.
/* eslint-disable no-var */
declare var navigator: { webdriver: boolean };
declare var window: Record<string, unknown>;
declare var localStorage: { getItem(key: string): string | null };

const log = logger.child({ module: 'TVAuth' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TVCredentials {
    /** The sessionid cookie — most critical for WS auth */
    sessionid: string;
    /** JWT auth_token for set_auth_token WS message */
    authToken: string | null;
    /** Built WSS endpoint URL */
    wsEndpoint: string;
    /** Raw cookie string for WS headers */
    cookiesJson: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TV_SIGNIN_URL = 'https://www.tradingview.com/accounts/signin/';
const TV_HOME_URL = 'https://www.tradingview.com/';
const TV_CHART_URL_PREFIX = 'https://www.tradingview.com/chart/';

const LOGIN_TIMEOUT_MS = 60_000;
const POST_LOGIN_WAIT_MS = 5_000;
const CAPTCHA_WAIT_MS = 120_000; // 2 minutes for manual CAPTCHA solve

// ---------------------------------------------------------------------------
// Main Auth Class
// ---------------------------------------------------------------------------

export class TradingViewAuth {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;

    /**
     * Runs the full authentication flow and returns extracted credentials.
     */
    async authenticate(): Promise<TVCredentials> {
        log.info('🚀 Starting TradingView authentication...');

        const { username, password, headless } = config.auth;

        if (!username || !password) {
            throw new Error('TV_USERNAME and TV_PASSWORD must be set in .env');
        }

        try {
            // --- Step 1: Launch browser ---
            log.info({ headless }, '🌐 Launching Chromium');
            this.browser = await chromium.launch({
                headless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled',
                ],
            });

            this.context = await this.browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                viewport: { width: 1280, height: 720 },
                locale: 'en-US',
            });

            // Stealth: remove navigator.webdriver flag
            await this.context.addInitScript(() => {
                // This code runs in browser context — `navigator` is a browser global
                // eslint-disable-next-line no-undef
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
            });

            const page = await this.context.newPage();

            // --- Step 2: Navigate to sign-in ---
            log.info('📄 Navigating to TradingView sign-in page');
            await page.goto(TV_SIGNIN_URL, { waitUntil: 'domcontentloaded', timeout: LOGIN_TIMEOUT_MS });

            // --- Step 3: Handle cookie consent ---
            await this.dismissCookieBanner(page);

            // --- Step 4: Login ---
            await this.performLogin(page, username, password);

            // --- Step 5: Wait for post-login navigation ---
            await this.waitForLoginSuccess(page);

            // --- Step 6: Extract credentials ---
            const creds = await this.extractCredentials(page);

            log.info(
                {
                    sessionid: creds.sessionid.substring(0, 10) + '...',
                    hasToken: !!creds.authToken,
                },
                '✅ TradingView authentication successful'
            );

            return creds;

        } finally {
            await this.cleanup();
        }
    }

    // -----------------------------------------------------------------------
    // Step 3: Dismiss cookie consent / GDPR banners
    // -----------------------------------------------------------------------

    private async dismissCookieBanner(page: Page): Promise<void> {
        try {
            // TradingView uses various cookie consent patterns
            const acceptBtn = page.getByRole('button', { name: /accept|agree|got it|okay/i });
            await acceptBtn.click({ timeout: 3000 });
            log.info('🍪 Dismissed cookie consent banner');
        } catch {
            // No banner — that's fine
            log.debug('No cookie banner found (or already dismissed)');
        }
    }

    // -----------------------------------------------------------------------
    // Step 4: Fill login form and submit
    // -----------------------------------------------------------------------

    private async performLogin(page: Page, username: string, password: string): Promise<void> {
        log.info('🔐 Filling login form...');

        // TradingView sign-in page shows social login buttons first.
        // Must click the "Email" button to reveal username/password form.
        try {
            const emailBtn = page.locator('button:has-text("Email")').first();
            await emailBtn.click({ timeout: 10_000 });
            log.debug('Clicked Email button to reveal login form');
        } catch {
            log.debug('No Email button found — form may already be visible');
        }

        // Wait for form transition
        await page.waitForTimeout(1000);

        // Fill username — TradingView uses input#id_username
        const usernameInput = page.locator('#id_username, input[name="id_username"]').first();
        await usernameInput.waitFor({ state: 'visible', timeout: 10_000 });
        await usernameInput.fill(username);
        log.debug('Filled username');

        // Fill password — TradingView uses input#id_password
        const passwordInput = page.locator('#id_password, input[name="id_password"], input[type="password"]').first();
        await passwordInput.waitFor({ state: 'visible', timeout: 5_000 });
        await passwordInput.fill(password);
        log.debug('Filled password');

        // Check for CAPTCHA before submitting
        await this.checkForCaptcha(page);

        // Click sign-in button — use multiple fallback selectors
        const signInBtn = page.locator(
            'button[type="submit"]:has-text("Sign in"), ' +
            'button:has-text("Sign in"), ' +
            '[class*="submitButton"]'
        ).first();
        await signInBtn.waitFor({ state: 'visible', timeout: 10_000 });
        await signInBtn.click();
        log.info('📤 Submitted login form');
    }

    // -----------------------------------------------------------------------
    // CAPTCHA Detection
    // -----------------------------------------------------------------------

    private async checkForCaptcha(page: Page): Promise<void> {
        // Only detect VISIBLE, interactive CAPTCHA challenges.
        // TradingView always has an *invisible* reCAPTCHA v3 badge
        // (grecaptcha-badge) — that's a background score check, NOT
        // an interactive challenge, so we must ignore it.

        const captchaSelectors = [
            'iframe[src*="recaptcha/api2/anchor"]',   // reCAPTCHA v2 checkbox
            'iframe[src*="recaptcha/api2/bframe"]',   // reCAPTCHA v2 challenge popup
            'iframe[src*="hcaptcha"]',                 // hCaptcha
            '#captcha',
        ];

        for (const selector of captchaSelectors) {
            const el = page.locator(selector);
            const count = await el.count();

            for (let i = 0; i < count; i++) {
                const visible = await el.nth(i).isVisible().catch(() => false);
                if (!visible) continue;

                log.warn(
                    '⚠️ CAPTCHA DETECTED! Cannot auto-solve. ' +
                    'If running headless, restart with HEADLESS_MODE=false to solve manually.'
                );

                if (!config.auth.headless) {
                    log.info(`⏳ Waiting up to ${CAPTCHA_WAIT_MS / 1000}s for manual CAPTCHA solve...`);
                    await page.waitForSelector(selector, {
                        state: 'detached',
                        timeout: CAPTCHA_WAIT_MS,
                    }).catch(() => {
                        throw new Error('CAPTCHA timeout — user did not solve within time limit');
                    });
                    log.info('✅ CAPTCHA appears to be solved');
                } else {
                    throw new Error(
                        'CAPTCHA detected in headless mode. Run with HEADLESS_MODE=false to solve manually.'
                    );
                }
                return;
            }
        }
    }

    // -----------------------------------------------------------------------
    // Step 5: Wait for successful login
    // -----------------------------------------------------------------------

    private async waitForLoginSuccess(page: Page): Promise<void> {
        log.info('⏳ Waiting for login to complete...');

        try {
            // Wait for navigation away from sign-in page
            await page.waitForURL(
                (url) => {
                    const href = url.toString();
                    return (
                        href === TV_HOME_URL ||
                        href.startsWith(TV_CHART_URL_PREFIX) ||
                        href.startsWith('https://www.tradingview.com/#')
                    );
                },
                { timeout: LOGIN_TIMEOUT_MS }
            );
            log.info('🏠 Redirected to TradingView homepage/chart');
        } catch {
            // Check if we're still on login page with an error
            const errorMsg = page.locator('[class*="error"], [class*="alert"]').first();
            if (await errorMsg.isVisible().catch(() => false)) {
                const text = await errorMsg.textContent().catch(() => 'Unknown error');
                throw new Error(`Login failed: ${text}`);
            }

            // Maybe we're on a 2FA page or similar
            log.warn('Login redirect timed out — checking page state...');
            const currentUrl = page.url();
            log.warn({ url: currentUrl }, 'Current page URL');

            if (currentUrl.includes('signin')) {
                throw new Error('Login failed — still on sign-in page after timeout');
            }

            // Might be on an intermediate page — continue anyway
            log.warn('Proceeding despite uncertain login state');
        }

        // Extra wait for async requests to settle
        await page.waitForTimeout(POST_LOGIN_WAIT_MS);
    }

    // -----------------------------------------------------------------------
    // Step 6: Extract credentials
    // -----------------------------------------------------------------------

    private async extractCredentials(page: Page): Promise<TVCredentials> {
        log.info('🔑 Extracting credentials...');

        // --- Extract sessionid cookie ---
        const cookies = await this.context!.cookies('https://www.tradingview.com');
        const sessionCookie = cookies.find(c => c.name === 'sessionid');

        if (!sessionCookie) {
            throw new Error('sessionid cookie not found — login may have failed');
        }

        const sessionid = sessionCookie.value;
        log.info({ sessionid: sessionid.substring(0, 10) + '...' }, '🍪 Extracted sessionid cookie');

        // Build cookies JSON for Redis storage
        const cookieMap: Record<string, string> = {};
        for (const c of cookies) {
            cookieMap[c.name] = c.value;
        }
        const cookiesJson = JSON.stringify(cookieMap);

        // --- Extract auth_token ---
        let authToken: string | null = null;

        // Strategy 1: Evaluate page JS — TradingView often exposes auth info
        try {
            authToken = await page.evaluate(() => {
                // This code runs in browser context — window is a browser global
                // eslint-disable-next-line no-undef
                const win = window as unknown as Record<string, unknown>;
                const user = win['user'] as Record<string, unknown> | undefined;
                if (user?.auth_token && typeof user.auth_token === 'string') {
                    return user.auth_token;
                }

                // Check TradingView's internal data
                const tvData = win['TradingView'] as Record<string, unknown> | undefined;
                if (tvData) {
                    const innerUser = tvData['user'] as Record<string, unknown> | undefined;
                    if (innerUser?.auth_token && typeof innerUser.auth_token === 'string') {
                        return innerUser.auth_token;
                    }
                }

                return null;
            });

            if (authToken) {
                log.info({ tokenPrefix: authToken.substring(0, 20) + '...' }, '🔑 Extracted auth_token from page JS');
            }
        } catch (err) {
            log.debug({ error: (err as Error).message }, 'Page JS eval did not yield auth_token');
        }

        // Strategy 2: Check localStorage
        if (!authToken) {
            try {
                authToken = await page.evaluate(() => {
                    // This code runs in browser context
                    // eslint-disable-next-line no-undef
                    const keys = ['tv_auth_token', 'auth_token', 'token'];
                    for (const key of keys) {
                        const val = localStorage.getItem(key); // eslint-disable-line no-undef
                        if (val && val.startsWith('eyJ')) return val; // JWT prefix
                    }
                    return null;
                });

                if (authToken) {
                    log.info('🔑 Extracted auth_token from localStorage');
                }
            } catch (err) {
                log.debug({ error: (err as Error).message }, 'localStorage did not yield auth_token');
            }
        }

        // Strategy 3: Navigate to chart page and intercept WS messages
        if (!authToken) {
            try {
                authToken = await this.interceptTokenFromWS(page);
            } catch (err) {
                log.debug({ error: (err as Error).message }, 'WS interception did not yield auth_token');
            }
        }

        if (!authToken) {
            log.warn('⚠️ Could not extract auth_token — sessionid cookie alone will be used for WS auth');
        }

        // --- Build WS endpoint ---
        const wsEndpoint = buildWSEndpoint();

        return {
            sessionid,
            authToken,
            wsEndpoint,
            cookiesJson,
        };
    }

    // -----------------------------------------------------------------------
    // Token extraction via WS interception
    // -----------------------------------------------------------------------

    private async interceptTokenFromWS(page: Page): Promise<string | null> {
        log.info('🔍 Attempting to capture auth_token from WebSocket frames...');

        return new Promise<string | null>((resolve) => {
            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    resolve(null);
                }
            }, 15_000);

            // Listen for WS frames
            page.on('websocket', (ws) => {
                ws.on('framesent', (frame) => {
                    const payload = frame.payload;
                    if (typeof payload === 'string' && payload.includes('set_auth_token')) {
                        try {
                            // Parse ~m~ framing: ~m~LEN~m~JSON
                            const jsonMatch = payload.match(/\{.*"m"\s*:\s*"set_auth_token".*\}/);
                            if (jsonMatch) {
                                const msg = JSON.parse(jsonMatch[0]);
                                if (msg.p?.[0] && typeof msg.p[0] === 'string') {
                                    log.info('🔑 Captured auth_token from WebSocket frame');
                                    if (!resolved) {
                                        resolved = true;
                                        clearTimeout(timeout);
                                        resolve(msg.p[0]);
                                    }
                                }
                            }
                        } catch {
                            // Parse error — ignore
                        }
                    }
                });
            });

            // Navigate to chart page to trigger WS connection
            page.goto('https://www.tradingview.com/chart/', { waitUntil: 'domcontentloaded' })
                .catch(() => { /* ignore navigation errors */ });
        });
    }

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    private async cleanup(): Promise<void> {
        if (this.context) {
            await this.context.close().catch(() => { });
            this.context = null;
        }
        if (this.browser) {
            await this.browser.close().catch(() => { });
            this.browser = null;
        }
        log.debug('Browser resources cleaned up');
    }
}

// ---------------------------------------------------------------------------
// Helper: Build WS endpoint URL
// ---------------------------------------------------------------------------

function buildWSEndpoint(): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return `wss://data.tradingview.com/socket.io/websocket?from=chart&date=${date}&auth=sessionid`;
}
