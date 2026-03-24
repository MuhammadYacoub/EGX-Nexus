export function calculateVolumeProfile(candles) {
  if (!candles || candles.length < 10) {
    return { vwap: null, volumeTrend: 'neutral', signal: 'neutral' };
  }

  let cumulativeTotal = 0;
  let cumulativeVolume = 0;

  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeTotal += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
  }

  const vwap = cumulativeVolume > 0 ? cumulativeTotal / cumulativeVolume : null;

  const last5Candles = candles.slice(-5);
  const prev5Candles = candles.slice(-10, -5);

  const sumVolumeLast5 = last5Candles.reduce((sum, c) => sum + c.volume, 0);
  const sumVolumePrev5 = prev5Candles.reduce((sum, c) => sum + c.volume, 0);

  const volumeTrend = sumVolumeLast5 > sumVolumePrev5 ? 'increasing' : 'decreasing';

  const lastClose = candles.at(-1).close;
  let signal = 'neutral';

  if (vwap !== null && volumeTrend === 'increasing') {
    if (lastClose > vwap) {
      signal = 'accumulation';
    } else if (lastClose < vwap) {
      signal = 'distribution';
    }
  }

  return { vwap, volumeTrend, signal };
}
