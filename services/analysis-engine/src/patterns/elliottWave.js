export function detectElliottWave(candles) {
  if (!candles || candles.length < 50) {
    return {
      currentWave: 'unknown',
      waveType: 'unknown',
      trend: 'sideways',
      confidence: 0,
      note: 'Simplified Elliott Wave — indicative only'
    };
  }

  // 1. Find swing highs and lows using a 5-candle lookback
  const swings = [];
  for (let i = 5; i < candles.length - 5; i++) {
    const isHigh = candles.slice(i - 5, i + 6).every(c => c.high <= candles[i].high);
    const isLow = candles.slice(i - 5, i + 6).every(c => c.low >= candles[i].low);

    if (isHigh) {
      swings.push({ type: 'high', index: i, val: candles[i].high });
    } else if (isLow) {
      swings.push({ type: 'low', index: i, val: candles[i].low });
    }
  }

  if (swings.length < 3) {
    return {
      currentWave: 'unknown',
      waveType: 'unknown',
      trend: 'sideways',
      confidence: 0,
      note: 'Simplified Elliott Wave — indicative only'
    };
  }

  const lastSwings = swings.slice(-5);
  let waveType = 'unknown';
  let currentWave = 'unknown';
  let trend = 'sideways';

  // Simplified basic impulse/corrective detection
  const isUpwardImpulse = lastSwings.length >= 3 &&
                          lastSwings[0].type === 'low' &&
                          lastSwings.every((s, i) => i < 2 || (s.type === 'high' ? s.val > lastSwings[i - 2].val : s.val > lastSwings[i - 2].val));

  const isDownwardImpulse = lastSwings.length >= 3 &&
                            lastSwings[0].type === 'high' &&
                            lastSwings.every((s, i) => i < 2 || (s.type === 'low' ? s.val < lastSwings[i - 2].val : s.val < lastSwings[i - 2].val));

  if (isUpwardImpulse) {
    trend = 'up';
    waveType = 'impulse';
    currentWave = lastSwings.length === 3 ? '3' : lastSwings.length === 5 ? '5' : 'unknown';
  } else if (isDownwardImpulse) {
    trend = 'down';
    waveType = 'impulse';
    currentWave = lastSwings.length === 3 ? '3' : lastSwings.length === 5 ? '5' : 'unknown';
  } else if (lastSwings.length >= 3) {
    waveType = 'corrective';
    currentWave = lastSwings.length === 3 ? 'C' : 'unknown';
  }

  return {
    currentWave,
    waveType,
    trend,
    confidence: currentWave !== 'unknown' ? 60 : 20,
    note: 'Simplified Elliott Wave — indicative only'
  };
}
