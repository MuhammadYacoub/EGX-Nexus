import { createClient } from 'redis';
import { config } from '../config.js';

let redisClient = null;

export async function connectRedis() {
  const options = config.redis.url
    ? { url: config.redis.url }
    : { socket: { host: config.redis.host, port: config.redis.port } };

  redisClient = createClient(options);

  redisClient.on('error', (err) => {
    // Suppress constant error spew if connection is refused in background
    if (err.code !== 'ECONNREFUSED') {
        console.error('Redis client error:', err.message);
    }
  });

  try {
    // Avoid blocking indefinitely if Redis is entirely unavailable in dev
    const connectPromise = redisClient.connect();
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Redis connection timeout")), 2000));
    await Promise.race([connectPromise, timeoutPromise]);
    console.log('✅ Connected to Redis');
  } catch (err) {
    console.error('Failed to connect to Redis:', err.message);
    // Do not crash, log and continue as per constraints
  }
  return true; // Return to ensure promise resolution
}

export async function publishSignal(symbol, signal) {
  if (!redisClient || !redisClient.isReady) {
    console.warn('Redis client not ready, skipping publish for symbol:', symbol);
    return;
  }

  const channel = `egx:signals:analysis:${symbol}`;
  try {
    await redisClient.publish(channel, JSON.stringify(signal));
  } catch (err) {
    console.warn('Redis publish failed for symbol:', symbol, err.message);
  }
}

export { redisClient };
