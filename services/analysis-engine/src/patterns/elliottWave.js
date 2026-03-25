export function detectElliottWave(candles) {
  if (!candles || candles.length < 50) {
    return { currentWave: 'unknown', waveType: 'unknown', trend: 'sideways', confidence: 0, note: 'Simplified Elliott Wave — indicative only' };
  }

  const pivots = [];

  // Step 1 - Find pivot points
  for (let i = 5; i < candles.length - 5; i++) {
    const window = candles.slice(i - 5, i + 6);

    const isSwingHigh = candles[i].high === Math.max(...window.map(c => c.high));
    const isSwingLow = candles[i].low === Math.min(...window.map(c => c.low));

    if (isSwingHigh) {
      pivots.push({ index: i, type: 'high', price: candles[i].high });
    } else if (isSwingLow) {
      pivots.push({ index: i, type: 'low', price: candles[i].low });
    }
  }

  if (pivots.length < 2) {
    return { currentWave: 'unknown', waveType: 'unknown', trend: 'sideways', confidence: 0, note: 'Simplified Elliott Wave — indicative only' };
  }

  // Step 2 - Collect alternating swings
  const swings = [pivots[0]];
  for (let i = 1; i < pivots.length; i++) {
    if (pivots[i].type !== swings[swings.length - 1].type) {
      swings.push(pivots[i]);
    }
  }

  if (swings.length < 3) {
    return { currentWave: 'unknown', waveType: 'unknown', trend: 'sideways', confidence: 0, note: 'Simplified Elliott Wave — indicative only' };
  }

  // Determine current wave context
  const recentSwings = swings.slice(-6); // look at last 6 alternating swings
  let waveType = 'unknown';
  let currentWave = 'unknown';
  let trend = 'sideways';
  let confidence = 50;

  // Simplistic impulse/corrective pattern matching
  if (recentSwings.length >= 6) {
      // Very basic structural check (assumes perfect alternating pattern from bottom)
      const p1 = recentSwings[recentSwings.length - 6];
      const p2 = recentSwings[recentSwings.length - 5];
      const p3 = recentSwings[recentSwings.length - 4];
      const p4 = recentSwings[recentSwings.length - 3];
      const p5 = recentSwings[recentSwings.length - 2];
      const p6 = recentSwings[recentSwings.length - 1];

      // Check for bullish impulse (1, 2, 3, 4, 5)
      if (p1.type === 'low' && p3.price > p1.price && p5.price > p3.price && p4.price > p2.price) {
          waveType = 'impulse';
          trend = 'up';
          currentWave = '5'; // We just completed 5 waves
          confidence = 70;
      }
      // Check for bearish impulse
      else if (p1.type === 'high' && p3.price < p1.price && p5.price < p3.price && p4.price < p2.price) {
          waveType = 'impulse';
          trend = 'down';
          currentWave = '5';
          confidence = 70;
      }
  } else if (recentSwings.length >= 4) {
      const p1 = recentSwings[recentSwings.length - 4];
      const p2 = recentSwings[recentSwings.length - 3];
      const p3 = recentSwings[recentSwings.length - 2];
      const p4 = recentSwings[recentSwings.length - 1];

      // Check for corrective A-B-C
      if (p1.type === 'high' && p3.price < p1.price && p4.price < p2.price) {
          waveType = 'corrective';
          trend = 'down';
          currentWave = 'C';
          confidence = 60;
      }
      else if (p1.type === 'low' && p3.price > p1.price && p4.price > p2.price) {
          waveType = 'corrective';
          trend = 'up';
          currentWave = 'C';
          confidence = 60;
      }
  }

  // Fallback for just 3 swings
  if (currentWave === 'unknown' && recentSwings.length >= 3) {
      const p1 = recentSwings[recentSwings.length - 3];
      const p2 = recentSwings[recentSwings.length - 2];
      const p3 = recentSwings[recentSwings.length - 1];

      if (p1.type === 'low' && p3.price > p1.price) {
          waveType = 'impulse';
          trend = 'up';
          currentWave = '3';
          confidence = 55;
      } else if (p1.type === 'high' && p3.price < p1.price) {
          waveType = 'impulse';
          trend = 'down';
          currentWave = '3';
          confidence = 55;
      }
  }

  return { currentWave, waveType, trend, confidence, note: 'Simplified Elliott Wave — indicative only' };
}
