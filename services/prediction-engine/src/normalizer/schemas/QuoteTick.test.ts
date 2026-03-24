import { createQuoteTick, serializeQuoteTick } from './QuoteTick';

describe('serializeQuoteTick', () => {
    const mockTickParams = {
        brokerId: 'test-broker',
        symbol: 'BTCUSDT',
        exchange: 'BINANCE',
        timestamp: 1625097600000,
        lastPrice: 35000.5,
        prevClosePrice: 34500.0,
        change: 500.5,
        changePercent: 1.45,
        bid: 35000.0,
        ask: 35001.0,
        bidSize: 0.5,
        askSize: 0.8,
        high: 36000.0,
        low: 34000.0,
        open: 34800.0,
        volume: 1200.5,
        assetType: 'crypto',
        currency: 'USDT',
        description: 'Bitcoin / TetherUS',
        updateMode: 'streaming',
    };

    it('should correctly serialize a full QuoteTick object', () => {
        const tick = createQuoteTick(mockTickParams);
        const serialized = serializeQuoteTick(tick);

        expect(serialized).toEqual({
            data: JSON.stringify(tick),
            symbol: 'BTCUSDT',
            broker: 'test-broker',
            type: 'quote',
            ts: '1625097600000',
        });
    });

    it('should correctly serialize a QuoteTick object with minimum required fields', () => {
        const minTickParams = {
            brokerId: 'test-broker',
            symbol: 'AAPL',
            exchange: 'NASDAQ',
            timestamp: 1625097600000,
        };
        const tick = createQuoteTick(minTickParams);
        const serialized = serializeQuoteTick(tick);

        expect(serialized).toEqual({
            data: JSON.stringify(tick),
            symbol: 'AAPL',
            broker: 'test-broker',
            type: 'quote',
            ts: '1625097600000',
        });
    });

    it('should contain all required fields in the output', () => {
        const tick = createQuoteTick(mockTickParams);
        const serialized = serializeQuoteTick(tick);

        expect(serialized).toHaveProperty('data');
        expect(serialized).toHaveProperty('symbol');
        expect(serialized).toHaveProperty('broker');
        expect(serialized).toHaveProperty('type');
        expect(serialized).toHaveProperty('ts');
    });

    it('should have the data field as a valid JSON string of the tick object', () => {
        const tick = createQuoteTick(mockTickParams);
        const serialized = serializeQuoteTick(tick);

        const parsedData = JSON.parse(serialized.data);
        expect(parsedData).toEqual(JSON.parse(JSON.stringify(tick)));
    });
});
