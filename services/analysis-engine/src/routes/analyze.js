import { Router } from 'express';
import { analyzeSymbol } from '../engine/analyzeSymbol.js';
import { publishSignal } from '../redis/client.js';

export const analyzeRouter = Router();

analyzeRouter.post('/', async (req, res) => {
  try {
    const { symbol, candles } = req.body;

    if (!symbol || !candles) {
      return res.status(400).json({ error: 'symbol and candles are required' });
    }

    if (!Array.isArray(candles) || candles.length < 50) {
      return res.status(400).json({
        error: 'Minimum 50 candles required',
        provided: Array.isArray(candles) ? candles.length : 0
      });
    }

    const signal = await analyzeSymbol(symbol, candles);

    res.status(200).json(signal);

    // Fire and forget
    publishSignal(symbol, signal).catch(() => {});

  } catch (err) {
    res.status(500).json({ error: 'Analysis failed', details: err.message });
  }
});
