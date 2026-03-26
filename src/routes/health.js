const express = require('express');
const { getPool } = require('../db/mysql');
const { getRedis } = require('../db/redis');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    const redis = getRedis();
    await redis.ping();
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
