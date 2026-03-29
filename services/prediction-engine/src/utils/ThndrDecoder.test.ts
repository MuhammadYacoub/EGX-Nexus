import { ThndrDecoder } from './ThndrDecoder';

describe('ThndrDecoder', () => {
    let decoder: ThndrDecoder;

    beforeEach(() => {
        decoder = new ThndrDecoder();
    });

    it('should correctly handle a full snapshot', () => {
        const snapshotFrame = JSON.stringify([{
            t: 'd',
            d: {
                b: {
                    p: 'marketFeed',
                    d: {
                        'asset1': {
                            S: 'COMI',
                            last_trade_price: 50.5,
                            market: 'EGX'
                        },
                        'asset2': {
                            symbol: 'FWRY',
                            lp: 5.2,
                            market: 'EGX'
                        }
                    }
                }
            }
        }]);

        decoder.decode(snapshotFrame);

        // After snapshot, an update should use the symbol from the map
        const updateFrame = JSON.stringify({
            t: 'd',
            d: {
                b: {
                    p: 'marketFeed/asset1/last_trade_price',
                    d: 51.0
                }
            }
        });

        const tick = decoder.decode(updateFrame);
        expect(tick).not.toBeNull();
        expect(tick?.symbol).toBe('COMI');
        expect(tick?.lastPrice).toBe(51.0);
    });

    it('should correctly merge leaf-node updates', () => {
        // Initial snapshot
        decoder.decode(JSON.stringify({
            t: 'd',
            d: {
                b: {
                    p: 'marketFeed',
                    d: {
                        'asset1': { ticker: 'BTSC', last_trade_price: 100 }
                    }
                }
            }
        }));

        // Leaf update for bid_price
        const bidUpdate = JSON.stringify({
            t: 'd',
            d: {
                b: {
                    p: 'marketFeed/asset1/bid_price',
                    d: 99.5
                }
            }
        });

        const tick = decoder.decode(bidUpdate);
        expect(tick?.lastPrice).toBe(100);
        expect(tick?.bid).toBe(99.5);
    });

    it('should correctly merge object updates', () => {
        // Initial snapshot
        decoder.decode(JSON.stringify({
            t: 'd',
            d: {
                b: {
                    p: 'marketFeed',
                    d: {
                        'asset1': { symbol: 'COMI', lp: 50 }
                    }
                }
            }
        }));

        // Object update
        const objectUpdate = JSON.stringify({
            t: 'd',
            d: {
                b: {
                    p: 'marketFeed/asset1',
                    d: {
                        lp: 51,
                        ap: 51.5
                    }
                }
            }
        });

        const tick = decoder.decode(objectUpdate);
        expect(tick?.lastPrice).toBe(51);
        expect(tick?.ask).toBe(51.5);
    });

    it('should handle numeric prefixes in frames', () => {
        const raw = '42[{"t":"d","d":{"b":{"p":"marketFeed/asset1/lp","d":10.5}}}]';

        // Pre-fill symbol map
        decoder.decode(JSON.stringify({
            t: 'd',
            d: { b: { p: 'marketFeed', d: { 'asset1': { S: 'TEST' } } } }
        }));

        const tick = decoder.decode(raw);
        expect(tick).not.toBeNull();
        expect(tick?.lastPrice).toBe(10.5);
        expect(tick?.symbol).toBe('TEST');
    });

    it('should return null for non-data frames', () => {
        expect(decoder.decode('3')).toBeNull();
        expect(decoder.decode('40')).toBeNull();
        expect(decoder.decode('invalid')).toBeNull();
    });
});
