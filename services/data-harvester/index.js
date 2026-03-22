import express from 'express';
import cron from 'node-cron';
import yahooFinance from 'yahoo-finance2';
import mysql from 'mysql2/promise';
import { createClient } from 'redis';

const app = express();
app.use(express.json());

const db = await mysql.createPool({ uri: process.env.MYSQL_URL });
const redis = createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });
await redis.connect();

// Fetch & store OHLCV for one symbol
async function fetchHistory(symbol, period = '6mo') {
  const ticker = `${symbol}.CA`;
  const result = await yahooFinance.historical(ticker, { period1: new Date(Date.now() - 180*86400*1000) });
  if (!result?.length) return 0;
  for (const row of result) {
    await db.execute(
      `INSERT IGNORE INTO stock_prices (symbol, date, open, high, low, close, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [symbol, row.date.toISOString().slice(0,10), row.open, row.high, row.low, row.close, row.volume]
    );
  }
  await redis.set(`last_harvest:${symbol}`, Date.now(), { EX: 86400 });
  return result.length;
}

// Fetch all symbols from DB
async function fetchAll() {
  const [rows] = await db.execute('SELECT symbol FROM stocks');
  let total = 0;
  for (const { symbol } of rows) {
    try {
      const n = await fetchHistory(symbol);
      total += n;
      console.log(`✅ ${symbol}: ${n} rows`);
    } catch (e) {
      console.error(`❌ ${symbol}: ${e.message}`);
    }
  }
  console.log(`🏁 Done — total rows: ${total}`);
}

// Schedule: every day at 7:00 PM Cairo time (after EGX close)
cron.schedule('0 19 * * 0-4', fetchAll, { timezone: 'Africa/Cairo' });

// API endpoints
app.get('/health', (_, res) => res.json({ service: 'data-harvester', status: 'ok' }));
app.post('/harvest/:symbol', async (req, res) => {
  try {
    const n = await fetchHistory(req.params.symbol);
    res.json({ symbol: req.params.symbol, rows: n });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/harvest-all', async (_, res) => {
  fetchAll(); // run async
  res.json({ status: 'started' });
});

app.listen(3005, () => console.log('🌾 Data Harvester running on :3005'));
