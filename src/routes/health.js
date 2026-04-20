const express = require('express');
const { getPool } = require('../db/mysql');
const { getRedis } = require('../db/redis');
const env = require('../config/env');

const router = express.Router();

async function collectHealth() {
  const pool = getPool();
  const redis = getRedis();

  const mysqlStartedAt = Date.now();
  await pool.query('SELECT 1');
  const mysqlLatencyMs = Date.now() - mysqlStartedAt;

  const redisStartedAt = Date.now();
  await redis.ping();
  const redisLatencyMs = Date.now() - redisStartedAt;

  return {
    status: 'ok',
    app: {
      env: env.nodeEnv,
      version: env.appVersion,
      commitSha: env.appCommitSha || null,
      uptimeSeconds: Math.round(process.uptime())
    },
    services: {
      mysql: {
        status: 'ok',
        latencyMs: mysqlLatencyMs
      },
      redis: {
        status: 'ok',
        latencyMs: redisLatencyMs
      }
    },
    monitoring: {
      errorWebhookConfigured: Boolean(env.monitoring.errorWebhook),
      metricsTokenConfigured: Boolean(env.monitoring.metricsToken)
    },
    checkedAt: new Date().toISOString()
  };
}

router.get('/live', (_req, res) => {
  return res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    checkedAt: new Date().toISOString()
  });
});

router.get('/ready', async (_req, res) => {
  try {
    const health = await collectHealth();
    return res.json(health);
  } catch (err) {
    return res.status(500).json({
      status: 'error',
      message: err.message,
      checkedAt: new Date().toISOString()
    });
  }
});

router.get('/', async (_req, res) => {
  try {
    const health = await collectHealth();
    return res.json(health);
  } catch (err) {
    return res.status(500).json({
      status: 'error',
      message: err.message,
      checkedAt: new Date().toISOString()
    });
  }
});

module.exports = router;
