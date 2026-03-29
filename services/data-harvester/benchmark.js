/**
 * This benchmark simulates the performance difference between sequential inserts and batch inserts.
 * Since a live database is not available in the sandbox, we use a mock that introduces artificial latency.
 */

async function benchmark() {
  const rowCount = 130; // Typical 6-month historical data has ~130 rows
  const mockLatencyMs = 2; // Simulate a fast database round-trip (2ms)

  // Mock DB object
  const db = {
    execute: async (query, params) => {
      await new Promise(resolve => setTimeout(resolve, mockLatencyMs));
      return [{}];
    },
    query: async (query, params) => {
      await new Promise(resolve => setTimeout(resolve, mockLatencyMs));
      return [{}];
    }
  };

  const symbol = 'AAPL';
  const result = Array.from({ length: rowCount }, (_, i) => ({
    date: new Date(Date.now() - i * 86400 * 1000),
    open: 100 + i,
    high: 110 + i,
    low: 90 + i,
    close: 105 + i,
    volume: 1000000 + i
  }));

  console.log(`--- Running benchmark for ${rowCount} rows (simulated latency: ${mockLatencyMs}ms) ---`);

  // 1. Sequential (Baseline)
  const startSeq = Date.now();
  for (const row of result) {
    await db.execute(
      `INSERT IGNORE INTO stock_prices (symbol, date, open, high, low, close, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [symbol, row.date.toISOString().slice(0, 10), row.open, row.high, row.low, row.close, row.volume]
    );
  }
  const endSeq = Date.now();
  const timeSeq = endSeq - startSeq;
  console.log(`Sequential: ${timeSeq}ms`);

  // 2. Batched (Optimized)
  const startBatch = Date.now();
  const values = result.map(row => [
    symbol,
    row.date.toISOString().slice(0, 10),
    row.open,
    row.high,
    row.low,
    row.close,
    row.volume
  ]);
  await db.query(
    `INSERT IGNORE INTO stock_prices (symbol, date, open, high, low, close, volume)
     VALUES ?`,
    [values]
  );
  const endBatch = Date.now();
  const timeBatch = endBatch - startBatch;
  console.log(`Batched: ${timeBatch}ms`);

  const improvement = ((timeSeq - timeBatch) / timeSeq * 100).toFixed(2);
  console.log(`--- Result: ${improvement}% faster ---`);
}

benchmark().catch(console.error);
