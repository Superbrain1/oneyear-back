const Redis = require('ioredis');
const env = require('../config/env');

let redis;

function createRedisClient() {
  redis = new Redis({
    host: env.redis.host,
    port: env.redis.port,
    db: env.redis.db,
    password: env.redis.password || undefined,
    maxRetriesPerRequest: 5,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 2000);
      return delay;
    }
  });

  redis.on('connect', () => {
    console.log('[redis] connected');
  });

  redis.on('error', (err) => {
    console.error(`[redis] error: ${err.message}`);
  });

  return redis;
}

function getRedis() {
  if (!redis) {
    throw new Error('Redis client is not initialized');
  }
  return redis;
}

module.exports = {
  createRedisClient,
  getRedis
};
