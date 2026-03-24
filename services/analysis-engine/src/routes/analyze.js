import { Router } from 'express';
import { analyzeSymbol } from '../engine/analyzeSymbol.js';
import { publishSignal } from '../redis/client.js';

export const analyzeRouter = Router();

analyzeRouter.post('/', async (req, res) => {
  try {
    const { symbol, candles } = req.body;

    if (!symbol || !candles) {
      return res.status(400).json({ error: 'Missing symbol or candles' });
    }

    const signal = await analyzeSymbol(symbol, candles);

    // Fire-and-forget Redis publish
    publishSignal(symbol, signal).catch(err => {
      console.warn('Redis publish failed for symbol:', symbol, err.message);
    });

    return res.status(200).json(signal);
  } catch (err) {
    if (err.message.includes('Minimum')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Analysis failed:', err.message);
    return res.status(500).json({ error: 'Analysis failed', details: err.message });
  }
});
