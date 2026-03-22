import cron from 'node-cron';
import mysql from 'mysql2/promise';
import yahooFinance from 'yahoo-finance2';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// List of some popular EGX tickers available on Yahoo Finance (typically ending in .CA)
const EGX_TICKERS = [
  'COMI.CA',  // Commercial International Bank
  'FWRY.CA',  // Fawry
  'HRHO.CA',  // EFG Hermes
  'EAST.CA',  // Eastern Company
  'SWDY.CA',  // Elsewedy Electric
  'TMGH.CA',  // Talaat Moustafa Group
  'ABUK.CA',  // Abu Qir Fertilizers
  'ISPH.CA',  // Ibnsina Pharma
  'ORHD.CA',  // Orascom Development Egypt
  'EKHO.CA'   // Egypt Kuwait Holding
];

// Helper to pause execution to avoid aggressive rate limiting
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createDbConnection() {
  const connectionUrl = process.env.MYSQL_URL;
  if (!connectionUrl) {
    throw new Error("MYSQL_URL environment variable is not set.");
  }
  // Remove 'mysql://' protocol as mysql2 sometimes expects direct parameters or slightly different uri formats
  // We'll rely on the standard mysql2 parsing
  return await mysql.createConnection(connectionUrl);
}

async function harvestDataForTicker(ticker, db) {
  try {
    console.log(`[HARVESTER] Fetching historical OHLCV data for: ${ticker}`);

    // Fetch last 7 days of daily data just to be safe with updates
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 7);

    const queryOptions = {
      period1: startDate,
      period2: endDate,
      interval: '1d'
    };

    const results = await yahooFinance.historical(ticker, queryOptions);

    if (!results || results.length === 0) {
      console.log(`[HARVESTER] No data found for ${ticker} in the requested period.`);
      return;
    }

    const query = `
      INSERT INTO stock_prices (symbol, date, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      open = VALUES(open),
      high = VALUES(high),
      low = VALUES(low),
      close = VALUES(close),
      volume = VALUES(volume)
    `;

    for (const row of results) {
      // row.date is usually a Date object or string
      const dateStr = row.date.toISOString().split('T')[0];
      await db.execute(query, [
        ticker,
        dateStr,
        row.open,
        row.high,
        row.low,
        row.close,
        row.volume
      ]);
    }

    console.log(`[HARVESTER] Successfully updated ${results.length} rows for ${ticker}.`);
  } catch (error) {
    console.error(`[HARVESTER] Error processing ${ticker}:`, error.message);
  }
}

async function runHarvestingJob() {
  console.log('[HARVESTER] Starting daily harvesting job...');
  let db;
  try {
    db = await createDbConnection();
    console.log('[HARVESTER] Connected to MySQL database.');

    for (const ticker of EGX_TICKERS) {
      await harvestDataForTicker(ticker, db);
      // Wait 3 seconds between requests to respect Yahoo Finance limits
      await delay(3000);
    }
    console.log('[HARVESTER] Daily harvesting job completed successfully.');
  } catch (error) {
    console.error('[HARVESTER] Fatal error during harvesting job:', error);
  } finally {
    if (db) {
      await db.end();
      console.log('[HARVESTER] Database connection closed.');
    }
  }
}

// -------------------------------------------------------------
// Initialization & Cron Setup
// -------------------------------------------------------------

// Schedule the cron job to run every day at 7:00 PM (19:00) Cairo time
cron.schedule('0 19 * * *', () => {
  runHarvestingJob();
}, {
  scheduled: true,
  timezone: "Africa/Cairo"
});

console.log('[HARVESTER] Service initialized. Cron scheduled for 19:00 Cairo time daily.');

// Optional: Run once on startup if you want immediate hydration
// setTimeout(runHarvestingJob, 5000);

// Basic HTTP server for Docker health checks
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const PORT = process.env.PORT || 3005;
server.listen(PORT, () => {
  console.log(`[HARVESTER] Healthcheck server listening on port ${PORT}`);
});
