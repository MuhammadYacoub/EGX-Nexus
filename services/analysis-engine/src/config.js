export const config = Object.freeze({
  port: parseInt(process.env.PORT || '3002'),
  redis: {
    url: process.env.REDIS_URL || null,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
  analysis: {
    minCandles: 50,
    version: '1.0.0',
  }
});