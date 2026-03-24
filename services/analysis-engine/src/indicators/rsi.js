import { RSI } from 'technicalindicators';

export function calculateRSI(candles, period = 14) {
  if (!candles || candles.length < period + 1) {
    return { value: 0, signal: 'neutral' };
  }

  const values = candles.map(c => c.close);
  const rsiResults = RSI.calculate({ values, period });

  if (!rsiResults.length) return { value: 0, signal: 'neutral' };

  const value = rsiResults.at(-1);

  let signal = 'neutral';
  if (value < 30) signal = 'oversold';
  else if (value > 70) signal = 'overbought';

  return { value, signal };
}
