import { BollingerBands } from 'technicalindicators';

export function calculateBollingerBands(candles) {
  const period = 20;
  const stdDev = 2;

  if (!candles || candles.length < period) {
    return {
      upper: null, middle: null, lower: null,
      bandwidth: null, percentB: null, signal: 'normal'
    };
  }

  const values = candles.map(c => c.close);
  const results = BollingerBands.calculate({ period, stdDev, values });

  if (!results || results.length === 0) {
    return {
      upper: null, middle: null, lower: null,
      bandwidth: null, percentB: null, signal: 'normal'
    };
  }

  const lastResult = results.at(-1);
  const currentClose = values.at(-1);

  const upper = lastResult.upper;
  const middle = lastResult.middle;
  const lower = lastResult.lower;

  const bandwidth = (upper - lower) / middle;
  const percentB = (currentClose - lower) / (upper - lower);

  let signal = 'normal';
  if (bandwidth < 0.1) {
    signal = 'squeeze';
  } else if (currentClose > upper) {
    signal = 'breakout_up';
  } else if (currentClose < lower) {
    signal = 'breakout_down';
  }

  return { upper, middle, lower, bandwidth, percentB, signal };
}
