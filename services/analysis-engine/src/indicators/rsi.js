import { RSI } from 'technicalindicators';

export function calculateRSI(candles) {
  const period = 14;

  if (!candles || candles.length < period + 1) {
    return { value: null, signal: 'neutral' };
  }

  const values = candles.map(c => c.close);
  const results = RSI.calculate({ values, period });

  if (!results || results.length === 0) {
    return { value: null, signal: 'neutral' };
  }

  const value = results.at(-1);

  let signal = 'neutral';
  if (value < 30) {
    signal = 'oversold';
  } else if (value > 70) {
    signal = 'overbought';
  }

  return { value, signal };
}
