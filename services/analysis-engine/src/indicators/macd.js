import { MACD } from 'technicalindicators';

export function calculateMACD(candles) {
  const fastPeriod = 12;
  const slowPeriod = 26;
  const signalPeriod = 9;

  if (!candles || candles.length < slowPeriod + signalPeriod - 1) {
    return { macd: null, signal: null, histogram: null, trend: 'neutral' };
  }

  const values = candles.map(c => c.close);
  const results = MACD.calculate({
    values,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });

  if (!results || results.length === 0) {
    return { macd: null, signal: null, histogram: null, trend: 'neutral' };
  }

  const lastResult = results.at(-1);
  const { MACD: macd, signal, histogram } = lastResult;

  let trend = 'neutral';
  if (histogram !== undefined && histogram !== null) {
    trend = histogram > 0 ? 'bullish' : 'bearish';
  }

  return { macd, signal, histogram, trend };
}
