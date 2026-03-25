export function detectWyckoff(candles) {
  if (!candles || candles.length < 30) {
    return {
      phase: 'ranging',
      confidence: 0,
      description: 'بيانات غير كافية',
      keyLevels: { support: null, resistance: null }
    };
  }

  const periodCandles = candles.slice(-30);
  const closes = periodCandles.map(c => c.close);
  const highs = periodCandles.map(c => c.high);
  const lows = periodCandles.map(c => c.low);

  const currentPrice = closes.at(-1);
  const firstClose = closes[0];

  const minLow = Math.min(...lows);
  const maxHigh = Math.max(...highs);

  const keyLevels = { support: Math.min(...closes), resistance: Math.max(...closes) };

  // Volume trend logic
  const last10Volumes = periodCandles.slice(-10).map(c => c.volume);
  const first10Volumes = periodCandles.slice(0, 10).map(c => c.volume);
  const avgLast10Volume = last10Volumes.reduce((a, b) => a + b, 0) / 10;
  const avgFirst10Volume = first10Volumes.reduce((a, b) => a + b, 0) / 10;
  const volumeDeclining = avgLast10Volume < avgFirst10Volume;

  // Price range contracting logic
  const calcStdDev = (arr) => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / arr.length);
  };
  const stdDevLast10 = calcStdDev(closes.slice(-10));
  const stdDevFirst10 = calcStdDev(closes.slice(0, 10));
  const rangeContracting = stdDevLast10 < stdDevFirst10;

  // Moving average logic
  const isAboveMA = () => {
    const last5Closes = closes.slice(-5);
    for (let i = 0; i < 5; i++) {
      const idx = 25 + i; // index in 30-candle window
      const slice5 = closes.slice(idx - 4, idx + 1);
      const ma5 = slice5.reduce((a, b) => a + b, 0) / 5;
      if (closes[idx] <= ma5) return false;
    }
    return true;
  };

  const isBelowMA = () => {
    const last5Closes = closes.slice(-5);
    for (let i = 0; i < 5; i++) {
      const idx = 25 + i;
      const slice5 = closes.slice(idx - 4, idx + 1);
      const ma5 = slice5.reduce((a, b) => a + b, 0) / 5;
      if (closes[idx] >= ma5) return false;
    }
    return true;
  };

  // 1. Accumulation
  if (currentPrice <= minLow * 1.10 && volumeDeclining && rangeContracting) {
    let confidence = 60 + (rangeContracting ? 20 : 0) + (volumeDeclining ? 20 : 0);
    return {
      phase: 'accumulation',
      confidence,
      description: 'مرحلة تجميع — السعر يتحرك في نطاق ضيق مع تراجع في الحجم',
      keyLevels
    };
  }

  // 2. Distribution
  if (currentPrice >= maxHigh * 0.90 && volumeDeclining && rangeContracting) {
    let confidence = 60 + (rangeContracting ? 20 : 0) + (volumeDeclining ? 20 : 0);
    return {
      phase: 'distribution',
      confidence,
      description: 'مرحلة توزيع — السعر عند القمم مع تراجع في الحجم',
      keyLevels
    };
  }

  // 3. Markup
  if (isAboveMA() && currentPrice > firstClose) {
    const strongTrend = true; // since it matches the MA check
    let confidence = 50 + (strongTrend ? 30 : 0) + (!volumeDeclining ? 20 : 0);
    return {
      phase: 'markup',
      confidence,
      description: 'مرحلة صعود — السعر يحقق قمماً متصاعدة',
      keyLevels
    };
  }

  // 4. Markdown
  if (isBelowMA() && currentPrice < firstClose) {
    const strongTrend = true;
    let confidence = 50 + (strongTrend ? 30 : 0) + (!volumeDeclining ? 20 : 0);
    return {
      phase: 'markdown',
      confidence,
      description: 'مرحلة هبوط — السعر يحقق قيعاناً متراجعة',
      keyLevels
    };
  }

  // 5. Ranging (default)
  return {
    phase: 'ranging',
    confidence: 40,
    description: 'مرحلة تذبذب — السعر يتحرك بدون اتجاه واضح',
    keyLevels
  };
}
