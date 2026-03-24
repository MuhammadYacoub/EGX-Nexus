import { BollingerBands } from 'technicalindicators';

export function calculateBollingerBands(candles, period = 20, stdDev = 2) {
  if (!candles || candles.length < period) {
    return { upper: 0, middle: 0, lower: 0, bandwidth: 0, percentB: 0, signal: 'normal' };
  }

  const values = candles.map(c => c.close);
  const bbResults = BollingerBands.calculate({ values, period, stdDev });

  if (!bbResults.length) return { upper: 0, middle: 0, lower: 0, bandwidth: 0, percentB: 0, signal: 'normal' };

  const lastResult = bbResults.at(-1);
  const currentPrice = values.at(-1);

  const upper = lastResult.upper;
  const middle = lastResult.middle;
  const lower = lastResult.lower;

  const bandwidth = middle !== 0 ? (upper - lower) / middle : 0;
  const percentB = (upper - lower) !== 0 ? (currentPrice - lower) / (upper - lower) : 0;

  let signal = 'normal';
  if (bandwidth < 0.1) signal = 'squeeze';
  else if (currentPrice > upper) signal = 'breakout_up';
  else if (currentPrice < lower) signal = 'breakout_down';

  return { upper, middle, lower, bandwidth, percentB, signal };
}
