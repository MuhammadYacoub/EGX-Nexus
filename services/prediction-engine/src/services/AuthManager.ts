/**
 * =============================================================================
 * Chaimera — Auth Manager Daemon (Passive Interception + Resilience)
 * =============================================================================
 *
 * Passively captures the high-privilege trading token by opening the Thndr
 * web dashboard in a persistent Playwright browser profile. Does NOT attempt
 * any automated login (Thndr uses Apple SSO + Mobile 2FA).
 *
 * Resilience features:
 *  - Watches `state/reauth_signal.json` for on-demand re-capture requests
 *    from DirectSocketGateway.
 *  - Targets `v1/portfolio` and `v1/market-depth` requests specifically
 *    for high-privilege token capture.
 *  - Graceful SIGTERM/SIGINT shutdown of Playwright context.
 */

import { chromium, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'ThndrAuthDaemon' });

declare const document: any;
declare const localStorage: any;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const userDataDir = path.resolve(__dirname, '../../profiles/web');
const STATE_DIR = path.resolve(__dirname, '../../state');
const TRADING_TOKEN_FILE = path.join(STATE_DIR, 'trading_token.json');
const SESSION_FILE = path.join(STATE_DIR, 'user_session.json');
const REAUTH_SIGNAL_FILE = path.join(STATE_DIR, 'reauth_signal.json');
const TARGET_URL = 'https://web.thndr.app/account-access';
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 Hours

// High-privilege API endpoints whose Bearer tokens we specifically target
const HIGH_PRIVILEGE_PATHS = ['v1/portfolio', 'v1/market-depth'];

// ---------------------------------------------------------------------------
// Telegram Alert Helpers
// ---------------------------------------------------------------------------

async function sendTelegramAlert(message: string) {
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

async function sendTelegramPhoto(photoPath: string, caption?: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId || !fs.existsSync(photoPath)) return;

    try {
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('photo', fs.createReadStream(photoPath));
        if (caption) form.append('caption', caption);

        const url = `https://api.telegram.org/bot${token}/sendPhoto`;
        const axios = require('axios');
        await axios.post(url, form, {
            headers: form.getHeaders(),
        });
        log.info('📸 Telegram photo sent successfully');
    } catch (e: any) {
        log.error('Failed to send Telegram photo:', e.message);
    }
}

// ---------------------------------------------------------------------------
// Auth Cycle Logic
// ---------------------------------------------------------------------------

async function runAuthCycle() {
    let context: BrowserContext | null = null;
    let capturedToken = false;

    log.info(`🔄 Running Passive Capture on: ${TARGET_URL}`);

    try {
        if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
        if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

        context = await chromium.launchPersistentContext(userDataDir, {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
        });

        const page = context.pages()[0] || await context.newPage();
        page.setDefaultTimeout(60000);

        // 1. Targeted Interceptor — capture Bearer tokens specifically from
        //    high-privilege API requests (v1/portfolio, v1/market-depth)
        page.on('request', (req) => {
            if (capturedToken) return;
            const reqUrl = req.url();
            const headers = req.headers();
            const auth = headers['authorization'] || headers['Authorization'];

            if (!auth || !/^Bearer\s+eyJ/i.test(auth)) return;

            // Check if this request targets a high-privilege endpoint
            const isHighPrivilege = HIGH_PRIVILEGE_PATHS.some(p => reqUrl.includes(p));

            if (isHighPrivilege && auth.length > 1200) {
                capturedToken = true;
                const token = auth.replace(/^Bearer\s+/i, '').trim();
                fs.writeFileSync(TRADING_TOKEN_FILE, JSON.stringify({ tradingToken: token }, null, 2));
                log.info({ url: reqUrl }, '🐉 CHAIMERA: High-Privilege Token Captured from targeted endpoint!');
            }
        });

        // 2. Navigation
        log.info('👉 Navigating...');
        const response = await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000); // Wait for potential redirects/lazy content

        // 3. Expiration / OTP Guard — Passive Only (no auto-login)
        const currentUrl = page.url();
        const content = await page.evaluate(() => document.body.innerText);

        if (
            currentUrl === 'https://web.thndr.app/' ||
            currentUrl.includes('/login') ||
            (currentUrl.includes('/account-access') && content.includes('Access Your Account')) ||
            response?.status() === 401 ||
            content.includes('Enter the code') ||
            content.includes('OTP')
        ) {
            log.warn(`🚨 SESSION EXPIRED: Stuck on ${currentUrl}`);
            const otpPath = path.join(STATE_DIR, 'otp_screen.png');
            await page.screenshot({ path: otpPath });
            await sendTelegramPhoto(otpPath, `🚨 Chaimera Auth: Session expired at ${currentUrl}`);
            await sendTelegramAlert('🚨 Session Expired: Manual Apple SSO Login Required. Please update the browser profile.');
            return;
        }

        // 4. Capture Firebase Token from LocalStorage
        try {
            const firebaseTokenStr = await page.evaluate(() => localStorage.getItem('firebase_token'));
            if (firebaseTokenStr) {
                const parsed = JSON.parse(firebaseTokenStr);
                if (parsed.token) {
                    const sessionData = {
                        firebaseToken: parsed.token,
                        updatedAt: new Date().toISOString()
                    };
                    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2));
                    log.info('🔥 Firebase token captured from localStorage and saved to user_session.json');
                }
            }
        } catch (e) {
            log.warn('Failed to extract firebaseToken from localStorage');
        }

        // 5. Wait for targeted Bearer token (30s passive wait)
        log.info('⏳ Waiting for passive token fire...');
        for (let i = 0; i < 30; i++) {
            if (capturedToken) break;
            await page.waitForTimeout(1000);
        }

        // 6. If no token captured yet, explicitly trigger high-privilege API calls
        if (!capturedToken) {
            log.info('🎯 No token captured passively — triggering targeted API calls...');

            const pageContent = await page.evaluate(() => document.body.innerText);
            if (pageContent.includes('محفظة') || pageContent.includes('Portfolio') || pageContent.includes('Account')) {
                log.info('✅ Dashboard is active — forcing v1/portfolio and v1/market-depth fetches...');

                // Trigger both high-privilege endpoints to force token exposure
                await page.evaluate(() => {
                    fetch('https://api.thndr.app/v1/portfolio').catch(() => {});
                    fetch('https://api.thndr.app/v1/market-depth?market=EGX').catch(() => {});
                });

                // Wait for the interceptor to catch the token
                for (let i = 0; i < 15; i++) {
                    if (capturedToken) break;
                    await page.waitForTimeout(1000);
                }
            }

            if (!capturedToken) {
                const failPath = path.resolve(STATE_DIR, 'passive_fail.png');
                await page.screenshot({ path: failPath });
                log.warn(`⚠️ No high-privilege token captured after targeted fetch. [Screenshot: ${failPath}]`);
                log.error(`❌ Failed to capture token. Final URL: ${page.url()}`);
                await sendTelegramPhoto(failPath, `❌ Failed to capture trading token. Final URL: ${page.url()}`);
            }
        }

    } catch (error) {
        log.error({ error: error instanceof Error ? error.message : String(error) }, '❌ Passive capture failed');
    } finally {
        if (context) await context.close();
        log.info('🛑 Refresh cycle complete.');
    }
}

// ---------------------------------------------------------------------------
// Reauth Signal Watcher
// ---------------------------------------------------------------------------

let signalWatcher: fs.FSWatcher | null = null;
let signalDebounce: NodeJS.Timeout | null = null;

function watchReauthSignal(): void {
    // Ensure directories exist
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

    // Create the signal file if it doesn't exist (so we can watch it)
    if (!fs.existsSync(REAUTH_SIGNAL_FILE)) {
        fs.writeFileSync(REAUTH_SIGNAL_FILE, JSON.stringify({ requestedAt: null, reason: 'init' }, null, 2));
    }

    log.info('👁️ Watching %s for reauth signals...', REAUTH_SIGNAL_FILE);

    signalWatcher = fs.watch(REAUTH_SIGNAL_FILE, (eventType) => {
        if (eventType !== 'change') return;

        // Debounce — file writes can trigger multiple events
        if (signalDebounce) clearTimeout(signalDebounce);
        signalDebounce = setTimeout(() => {
            try {
                const raw = fs.readFileSync(REAUTH_SIGNAL_FILE, 'utf-8');
                const signal = JSON.parse(raw);
                log.info({ reason: signal.reason, requestedAt: signal.requestedAt },
                    '📡 Reauth signal received — triggering immediate auth cycle!');
                runAuthCycle();
            } catch (err: any) {
                log.error({ error: err.message }, '❌ Failed to read reauth signal file');
            }
        }, 2000);
    });

    signalWatcher.on('error', (err) => {
        log.error({ error: err.message }, '❌ Reauth signal watcher error');
    });
}

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

let refreshInterval: NodeJS.Timeout | null = null;

function gracefulShutdown(signal: string): void {
    log.info({ signal }, `Received ${signal} — initiating graceful shutdown`);

    // 1. Stop the refresh interval
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }

    // 2. Stop the reauth signal watcher
    if (signalWatcher) {
        signalWatcher.close();
        signalWatcher = null;
    }

    if (signalDebounce) {
        clearTimeout(signalDebounce);
        signalDebounce = null;
    }

    log.info('👋 Auth Manager shutdown complete.');
    process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

log.info('🚀 Auth Manager (Passive Mode) Init');

// Register graceful shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch unhandled rejections
process.on('unhandledRejection', (reason) => {
    log.error({ reason }, 'Unhandled Promise rejection');
});

// Start watching for reauth signals from DirectSocketGateway
watchReauthSignal();

// Run initial auth cycle and schedule periodic refreshes
runAuthCycle();
refreshInterval = setInterval(runAuthCycle, REFRESH_INTERVAL_MS);
