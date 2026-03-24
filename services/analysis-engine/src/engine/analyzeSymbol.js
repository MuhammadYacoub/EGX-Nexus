import { calculateRSI, calculateMACD, calculateBollingerBands, calculateVolumeProfile } from '../indicators/index.js';
import { detectWyckoffPhase, detectElliottWave } from '../patterns/index.js';
import { config } from '../config.js';

function roundDeep(obj) {
  if (typeof obj === 'number') return Math.round(obj * 10000) / 10000;
  if (Array.isArray(obj)) return obj.map(roundDeep);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, roundDeep(v)])
    );
  }
  return obj;
}

export async function analyzeSymbol(symbol, candles) {
  if (!candles || !Array.isArray(candles)) {
    throw new Error('Invalid candles data');
  }

  if (candles.length < config.analysis.minCandles) {
    throw new Error(`Minimum ${config.analysis.minCandles} candles required`);
  }

  const startTime = Date.now();

  const [rsi, macd, bollingerBands, volumeProfile] = await Promise.all([
    Promise.resolve(calculateRSI(candles, 14)),
    Promise.resolve(calculateMACD(candles, 12, 26, 9)),
    Promise.resolve(calculateBollingerBands(candles, 20, 2)),
    Promise.resolve(calculateVolumeProfile(candles))
  ]);

  const wyckoff = detectWyckoffPhase(candles);
  const elliottWave = detectElliottWave(candles);

  let score = 50;

  // RSI rules
  if (rsi.signal === 'oversold') score += 15;
  if (rsi.signal === 'overbought') score -= 15;

  // MACD rules
  if (macd.trend === 'bullish') score += 20;
  if (macd.trend === 'bearish') score -= 20;

  // Bollinger Bands rules
  if (bollingerBands.signal === 'breakout_up') score += 15;
  if (bollingerBands.signal === 'breakout_down') score -= 15;

  // Volume Profile rules
  if (volumeProfile.signal === 'accumulation') score += 20;
  if (volumeProfile.signal === 'distribution') score -= 20;

  // Wyckoff rules
  if (wyckoff.phase === 'markup' || wyckoff.phase === 'accumulation') score += 20;
  if (wyckoff.phase === 'markdown' || wyckoff.phase === 'distribution') score -= 20;

  // Elliott Wave rules
  if (elliottWave.trend === 'up' && (elliottWave.currentWave === '3' || elliottWave.currentWave === '5')) score += 10;
  if (elliottWave.trend === 'down' && (elliottWave.currentWave === '3' || elliottWave.currentWave === '5')) score -= 10;

  score = Math.max(0, Math.min(100, score));

  let action = 'HOLD';
  if (score >= 65) action = 'BUY';
  else if (score <= 35) action = 'SELL';

  const confidence = Math.abs(score - 50) * 2;

  const durationMs = Date.now() - startTime;
  console.log(`[Analysis] ${symbol} | Action: ${action} | Conf: ${confidence} | Duration: ${durationMs}ms`);

  const signal = {
    symbol,
    timestamp: new Date().toISOString(),
    action,
    confidence,
    score,
    indicators: {
      rsi,
      macd,
      bollingerBands,
      volumeProfile
    },
    patterns: {
      wyckoff,
      elliottWave
    },
    metadata: {
      candleCount: candles.length,
      analysisVersion: config.analysis.version
    }
  };

  return roundDeep(signal);
}
