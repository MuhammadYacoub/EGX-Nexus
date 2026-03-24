export function calculateVolumeProfile(candles) {
  if (!candles || candles.length < 10) {
    return { vwap: 0, volumeTrend: 'neutral', signal: 'neutral' };
  }

  let cumVolume = 0;
  let cumTypicalVolume = 0;

  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = c.volume || 0;
    cumTypicalVolume += typicalPrice * vol;
    cumVolume += vol;
  }

  const vwap = cumVolume > 0 ? cumTypicalVolume / cumVolume : 0;

  const currentPrice = candles[candles.length - 1].close;

  const recent5 = candles.slice(-5);
  const prev5 = candles.slice(-10, -5);

  const sumRecentVol = recent5.reduce((sum, c) => sum + (c.volume || 0), 0);
  const sumPrevVol = prev5.reduce((sum, c) => sum + (c.volume || 0), 0);

  let volumeTrend = 'neutral';
  if (sumRecentVol > sumPrevVol) volumeTrend = 'increasing';
  else if (sumRecentVol < sumPrevVol) volumeTrend = 'decreasing';

  let signal = 'neutral';
  if (currentPrice > vwap && volumeTrend === 'increasing') {
    signal = 'accumulation';
  } else if (currentPrice < vwap && volumeTrend === 'increasing') {
    signal = 'distribution';
  }

  return { vwap, volumeTrend, signal };
}
