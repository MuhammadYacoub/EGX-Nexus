export const config = Object.freeze({
  port: parseInt(process.env.PORT || '3002', 10),
  redis: {
    url: process.env.REDIS_URL || null,
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  analysis: {
    minCandles: 50,
    version: '1.0.0',
  }
});
