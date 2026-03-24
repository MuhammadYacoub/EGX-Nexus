import { createClient } from 'redis';
import { config } from '../config.js';

let redisClient = null;

export async function connectRedis() {
  try {
    const redisConfig = config.redis.url
      ? { url: config.redis.url }
      : { socket: { host: config.redis.host, port: config.redis.port } };

    redisClient = createClient(redisConfig);

    redisClient.on('error', (err) => {
      console.warn(`[Redis Warning] Connection error: ${err.message}`);
    });

    await redisClient.connect();
    console.log('[Redis] Connected successfully for analysis-engine publisher');
  } catch (err) {
    console.warn(`[Redis Warning] Failed to connect: ${err.message}`);
    // Never throw, never crash
  }
}

export async function publishSignal(symbol, signal) {
  if (!redisClient || !redisClient.isOpen) {
    console.warn(`[Redis Warning] Cannot publish signal for ${symbol}: Redis not connected`);
    return;
  }

  try {
    const channel = `egx:signals:analysis:${symbol}`;
    await redisClient.publish(channel, JSON.stringify(signal));
  } catch (err) {
    console.warn(`[Redis Warning] Failed to publish signal for ${symbol}: ${err.message}`);
    // Fire-and-forget: never throw
  }
}