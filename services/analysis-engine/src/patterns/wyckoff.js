function getPivots(candles) {
  const highs = [];
  const lows = [];
  for (let i = 5; i < candles.length - 5; i++) {
    const isHigh = candles.slice(i - 5, i + 6).every((c, idx) => idx === 5 || c.high <= candles[i].high);
    const isLow = candles.slice(i - 5, i + 6).every((c, idx) => idx === 5 || c.low >= candles[i].low);
    if (isHigh) highs.push({ index: i, val: candles[i].high });
    if (isLow) lows.push({ index: i, val: candles[i].low });
  }
  return { highs, lows };
}

export function detectWyckoffPhase(candles) {
  if (!candles || candles.length < 30) {
    return { phase: 'ranging', confidence: 0, description: 'Not enough data', keyLevels: { support: 0, resistance: 0 } };
  }

  const last30 = candles.slice(-30);
  const low30 = Math.min(...last30.map(c => c.low));
  const high30 = Math.max(...last30.map(c => c.high));

  const currentPrice = candles[candles.length - 1].close;

  // Contracting range check
  const first10Range = Math.max(...last30.slice(0, 10).map(c => c.high)) - Math.min(...last30.slice(0, 10).map(c => c.low));
  const last10Range = Math.max(...last30.slice(-10).map(c => c.high)) - Math.min(...last30.slice(-10).map(c => c.low));
  const isContracting = last10Range < first10Range;

  // Declining volume check
  const first10Vol = last30.slice(0, 10).reduce((sum, c) => sum + c.volume, 0);
  const last10Vol = last30.slice(-10).reduce((sum, c) => sum + c.volume, 0);
  const isVolumeDeclining = last10Vol < first10Vol;

  const isNearLow = currentPrice <= low30 * 1.10;
  const isNearHigh = currentPrice >= high30 * 0.90;

  if (isContracting && isVolumeDeclining && isNearLow) {
    return {
      phase: 'accumulation',
      confidence: 80,
      description: 'نطاق سعري يضيق مع انخفاض في حجم التداول بالقرب من أدنى مستويات، يشير إلى مرحلة تجميع',
      keyLevels: { support: low30, resistance: high30 }
    };
  }

  if (isContracting && isVolumeDeclining && isNearHigh) {
    return {
      phase: 'distribution',
      confidence: 80,
      description: 'نطاق سعري يضيق مع انخفاض في حجم التداول بالقرب من أعلى مستويات، يشير إلى مرحلة تصريف',
      keyLevels: { support: low30, resistance: high30 }
    };
  }

  // Check pivots for Markup / Markdown
  const { highs, lows } = getPivots(candles);

  const recentHighs = highs.slice(-5);
  const recentLows = lows.slice(-5);

  const higherHighs = recentHighs.length > 1 && recentHighs.every((h, i, arr) => i === 0 || h.val >= arr[i - 1].val);
  const higherLows = recentLows.length > 1 && recentLows.every((l, i, arr) => i === 0 || l.val >= arr[i - 1].val);

  const lowerHighs = recentHighs.length > 1 && recentHighs.every((h, i, arr) => i === 0 || h.val <= arr[i - 1].val);
  const lowerLows = recentLows.length > 1 && recentLows.every((l, i, arr) => i === 0 || l.val <= arr[i - 1].val);

  if (higherHighs && higherLows) {
    return {
      phase: 'markup',
      confidence: 75,
      description: 'قمم وقيعان صاعدة تشير إلى اتجاه صاعد (مرحلة صعود)',
      keyLevels: { support: recentLows[recentLows.length - 1]?.val || low30, resistance: recentHighs[recentHighs.length - 1]?.val || high30 }
    };
  }

  if (lowerHighs && lowerLows) {
    return {
      phase: 'markdown',
      confidence: 75,
      description: 'قمم وقيعان هابطة تشير إلى اتجاه هابط (مرحلة هبوط)',
      keyLevels: { support: recentLows[recentLows.length - 1]?.val || low30, resistance: recentHighs[recentHighs.length - 1]?.val || high30 }
    };
  }

  return {
    phase: 'ranging',
    confidence: 50,
    description: 'حركة عرضية غير واضحة المعالم',
    keyLevels: { support: low30, resistance: high30 }
  };
}
