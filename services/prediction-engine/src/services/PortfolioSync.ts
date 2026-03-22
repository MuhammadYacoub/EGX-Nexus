
import * as fs from 'fs';
import * as path from 'path';
import Redis from 'ioredis';
import { logger } from '../utils/logger';
import * as dotenv from 'dotenv';

dotenv.config();

const log = logger.child({ module: 'PortfolioSync' });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORTFOLIO_API_URL = 'https://prod.thndr.app/market-service/accounts/wallet-and-portfolio?market=egypt';
const POLL_INTERVAL_MS = 120000; // 2 minutes
const TRADING_TOKEN_FILE = path.resolve(__dirname, '../../state/trading_token.json');
const SYMBOLS_FILE = path.resolve(__dirname, '../../symbols.json');

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');

// ---------------------------------------------------------------------------
// PortfolioSync
// ---------------------------------------------------------------------------

export class PortfolioSync {
    private bearerToken: string | null = null;
    private assetIdToSymbol: Map<string, string> = new Map();
    private redis: Redis;
    private timer: NodeJS.Timeout | null = null;

    constructor() {
        this.redis = new Redis({
            host: REDIS_HOST,
            port: REDIS_PORT,
            retryStrategy: (times) => Math.min(times * 50, 2000),
        });

        this.loadBearerToken();
        this.loadSymbolDictionary();
    }

    private loadBearerToken(): void {
        try {
            if (fs.existsSync(TRADING_TOKEN_FILE)) {
                const stats = fs.statSync(TRADING_TOKEN_FILE);
                const ageMinutes = (Date.now() - stats.mtime.getTime()) / (1000 * 60);

                if (ageMinutes > 15) {
                    log.warn({ ageMinutes: ageMinutes.toFixed(1) }, '⚠️ Trading token is older than 15 minutes! Might be expired.');
                }

                const data = JSON.parse(fs.readFileSync(TRADING_TOKEN_FILE, 'utf-8'));
                const rawToken = data.tradingToken || '';
                
                // Bulletproof Sanitization
                let cleanToken = rawToken.replace(/^["']|["']$/g, '').trim();
                if (cleanToken.toLowerCase().startsWith('bearer ')) {
                    cleanToken = cleanToken.substring(7).trim();
                }

                this.bearerToken = cleanToken || null;
                
                if (this.bearerToken) {
                    log.info({ 
                        tokenPrefix: this.bearerToken.substring(0, 15) + '...',
                        tokenLength: this.bearerToken.length,
                        ageMinutes: ageMinutes.toFixed(1)
                    }, '🔑 Privileged trading token loaded');
                } else {
                    log.warn('⚠️ tradingToken is empty in token file');
                }
            } else {
                log.warn({ path: TRADING_TOKEN_FILE }, '⚠️ Trading token file not found — Waiting for Auth Manager interception');
            }
        } catch (e: any) {
            log.error({ error: e.message }, '❌ Failed to load trading token from file');
        }
    }

    private loadSymbolDictionary(): void {
        try {
            if (fs.existsSync(SYMBOLS_FILE)) {
                const dict: Record<string, { symbol: string; name: string }> = JSON.parse(
                    fs.readFileSync(SYMBOLS_FILE, 'utf-8')
                );
                for (const [uuid, entry] of Object.entries(dict)) {
                    this.assetIdToSymbol.set(uuid, entry.symbol.toUpperCase());
                }
                log.info({ count: this.assetIdToSymbol.size }, '📚 Symbol dictionary loaded for portfolio mapping');
            } else {
                log.warn('⚠️ symbols.json not found — Portfolio sync will only use UUIDs');
            }
        } catch (e: any) {
            log.error('Failed to load symbol dictionary', e);
        }
    }

    public async start(): Promise<void> {
        if (this.timer) return;
        
        log.info(`🚀 Starting PortfolioSync (interval: ${POLL_INTERVAL_MS / 1000}s)`);
        
        // Immediate sync
        await this.sync();

        this.timer = setInterval(() => {
            this.sync();
        }, POLL_INTERVAL_MS);
    }

    public async sync(): Promise<void> {
        // Always try to reload the freshest token before fetching
        this.loadBearerToken();

        if (!this.bearerToken) {
            log.warn('⏭️ Skipping portfolio sync: No valid bearer token available');
            return;
        }

        try {
            log.info('🔄 Polling Thndr Portfolio API...');
            const response = await fetch(PORTFOLIO_API_URL, {
                headers: {
                    'Authorization': `Bearer ${this.bearerToken}`,
                    'Accept': 'application/json',
                    'User-Agent': 'Chaimera/1.0'
                }
            });

            if (!response.ok) {
                const text = await response.text();
                log.error({ status: response.status, body: text.substring(0, 100) }, '❌ Portfolio API fetch failed');
                
                // If 403, it might mean the session file is stale but hasn't been updated yet
                if (response.status === 403) {
                    log.error('🔐 403 Forbidden: Token might be expired. Waiting for Auth Manager refresh.');
                }
                return;
            }

            const data = await response.json() as any;
            
            // Extract capital (Buying Power)
            log.debug({ data }, 'Raw Portfolio Data');

            const capital = data.purchase_power || 0;
            const positions = data.portfolio?.positions || [];

            const activeSymbols: string[] = [];

            for (const pos of positions) {
                const symbol = pos.symbol;
                const quantity = pos.qty || 0;

                if (quantity > 0 && symbol) {
                    activeSymbols.push(symbol.toUpperCase());
                }
            }

            // --- Update Redis ---
            await this.redis.set('chaimera:state:capital', String(capital));
            
            // Update Portfolio Set
            await this.redis.del('chaimera:state:portfolio');
            if (activeSymbols.length > 0) {
                await this.redis.sadd('chaimera:state:portfolio', ...activeSymbols);
            }

            log.info({ 
                capital, 
                holdingCount: activeSymbols.length,
                symbols: activeSymbols 
            }, '✅ Portfolio synced to Redis');

        } catch (error: any) {
            log.error({ error: error.message }, '❌ Exception during portfolio sync');
        }
    }

    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.redis.disconnect();
    }
}

// ---------------------------------------------------------------------------
// Standalone Execution
// ---------------------------------------------------------------------------
if (require.main === module) {
    const syncer = new PortfolioSync();
    syncer.start();

    const graceful = () => {
        log.info('🛑 Stopping PortfolioSync...');
        syncer.stop();
        process.exit(0);
    };

    process.on('SIGINT', graceful);
    process.on('SIGTERM', graceful);
}
