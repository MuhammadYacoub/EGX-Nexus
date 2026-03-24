import { MACD } from 'technicalindicators';

export function calculateMACD(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (!candles || candles.length < slowPeriod + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0, trend: 'neutral' };
  }

  const values = candles.map(c => c.close);
  const macdResults = MACD.calculate({
    values,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });

  if (!macdResults.length) return { macd: 0, signal: 0, histogram: 0, trend: 'neutral' };

  const lastResult = macdResults.at(-1);
  const trend = lastResult.histogram > 0 ? 'bullish' : lastResult.histogram < 0 ? 'bearish' : 'neutral';

  return {
    macd: lastResult.MACD || 0,
    signal: lastResult.signal || 0,
    histogram: lastResult.histogram || 0,
    trend
  };
}
