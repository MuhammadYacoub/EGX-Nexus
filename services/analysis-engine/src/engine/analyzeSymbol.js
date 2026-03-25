import { calculateRSI, calculateMACD, calculateBollingerBands, calculateVolumeProfile } from '../indicators/index.js';
import { detectWyckoff, detectElliottWave } from '../patterns/index.js';
import { config } from '../config.js';

function roundDeep(obj) {
  if (typeof obj === 'number') return Math.round(obj * 10000) / 10000;
  if (Array.isArray(obj)) return obj.map(roundDeep);
  if (obj && typeof obj === 'object')
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, roundDeep(v)]));
  return obj;
}

export async function analyzeSymbol(symbol, candles) {
  const startTime = Date.now();

  if (!Array.isArray(candles) || candles.length < config.analysis.minCandles) {
    throw new Error(`Minimum ${config.analysis.minCandles} candles required`);
  }

  const [rsi, macd, bb, volume] = await Promise.all([
    Promise.resolve(calculateRSI(candles)),
    Promise.resolve(calculateMACD(candles)),
    Promise.resolve(calculateBollingerBands(candles)),
    Promise.resolve(calculateVolumeProfile(candles)),
  ]);

  const wyckoff = detectWyckoff(candles);
  const elliott = detectElliottWave(candles);

  let score = 50;

  // RSI
  if (rsi.signal === 'oversold') score += 15;
  if (rsi.signal === 'overbought') score -= 15;

  // MACD
  if (macd.trend === 'bullish') score += 20;
  if (macd.trend === 'bearish') score -= 20;

  // Bollinger Bands
  if (bb.signal === 'breakout_up') score += 15;
  if (bb.signal === 'breakout_down') score -= 15;
  // squeeze -> 0

  // Volume Profile
  if (volume.signal === 'accumulation') score += 20;
  if (volume.signal === 'distribution') score -= 20;

  // Wyckoff
  if (wyckoff.phase === 'markup') score += 15;
  if (wyckoff.phase === 'accumulation') score += 10;
  if (wyckoff.phase === 'markdown') score -= 15;
  if (wyckoff.phase === 'distribution') score -= 10;

  // Elliott
  if (elliott.currentWave === '3' || elliott.currentWave === '5') {
    if (elliott.trend === 'up') score += 10;
  }
  if (elliott.currentWave === 'A' || elliott.currentWave === 'C') {
    if (elliott.trend === 'down') score -= 10;
  }

  score = Math.max(0, Math.min(100, score));

  let action = 'HOLD';
  if (score >= 65) action = 'BUY';
  if (score <= 35) action = 'SELL';

  // Confidence
  let confSum = 0;
  let confCount = 0;

  if (wyckoff.confidence !== undefined) { confSum += wyckoff.confidence; confCount++; }
  if (elliott.confidence !== undefined) { confSum += elliott.confidence; confCount++; }

  // Indicators fixed confidence if valid
  if (rsi.value !== null) { confSum += 70; confCount++; }
  if (macd.macd !== null) { confSum += 70; confCount++; }
  if (bb.middle !== null) { confSum += 70; confCount++; }
  if (volume.vwap !== null) { confSum += 70; confCount++; }

  const confidence = confCount > 0 ? confSum / confCount : 0;

  const duration = Date.now() - startTime;
  console.log(`[analysis-engine] ${symbol} → ${action} | score:${score} | confidence:${confidence} | candles:${candles.length} | duration:${duration}ms`);

  const signal = {
    symbol,
    timestamp: new Date().toISOString(),
    action,
    confidence,
    score,
    indicators: { rsi, macd, bollingerBands: bb, volumeProfile: volume },
    patterns: { wyckoff, elliottWave: elliott },
    metadata: { candleCount: candles.length, analysisVersion: config.analysis.version }
  };

  return roundDeep(signal);
}
