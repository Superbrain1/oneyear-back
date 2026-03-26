const express = require('express');
const { z } = require('zod');
const { getPool } = require('../db/mysql');
const { getRedis } = require('../db/redis');
const { generateInviteCode, hashCode } = require('../utils/inviteCode');

const router = express.Router();

const createCircleSchema = z.object({
  name: z.string().min(2).max(20),
  ownerId: z.number().int().positive()
});

const inviteSchema = z.object({
  userId: z.number().int().positive(),
  ttlMinutes: z.number().int().min(1).max(30)
});

const joinSchema = z.object({
  userId: z.number().int().positive(),
  code: z.string().min(8).max(8)
});

router.get('/', async (_req, res) => {
  const pool = getPool();
  const [rows] = await pool.execute('SELECT id, name, type, owner_id AS ownerId, created_at AS createdAt FROM circles ORDER BY id ASC');
  return res.json(rows);
});

router.post('/', async (req, res) => {
  const parsed = createCircleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '参数校验失败', errors: parsed.error.issues });
  }

  const { name, ownerId } = parsed.data;
  const pool = getPool();

  const [result] = await pool.execute('INSERT INTO circles (name, type, owner_id) VALUES (?, "custom", ?)', [name, ownerId]);
  const circleId = result.insertId;
  await pool.execute('INSERT INTO circle_members (circle_id, user_id, role) VALUES (?, ?, "owner")', [circleId, ownerId]);

  return res.status(201).json({ id: circleId, name, type: 'custom', ownerId });
});

router.post('/:id/invite', async (req, res) => {
  const circleId = Number(req.params.id);
  const parsed = inviteSchema.safeParse(req.body);
  if (!Number.isInteger(circleId) || circleId <= 0) {
    return res.status(400).json({ message: '圈子 ID 无效' });
  }
  if (!parsed.success) {
    return res.status(400).json({ message: '参数校验失败', errors: parsed.error.issues });
  }

  const { userId, ttlMinutes } = parsed.data;
  const pool = getPool();
  const redis = getRedis();

  const [memberRows] = await pool.execute(
    'SELECT role FROM circle_members WHERE circle_id = ? AND user_id = ? LIMIT 1',
    [circleId, userId]
  );

  if (memberRows.length === 0 || memberRows[0].role !== 'owner') {
    return res.status(403).json({ message: '仅圈主可生成邀请码' });
  }

  const rateKey = `rate:invite_gen:${userId}:${circleId}`;
  const current = Number((await redis.get(rateKey)) || 0);
  if (current >= 3) {
    return res.status(429).json({ message: '生成过于频繁，请稍后再试' });
  }
  await redis.multi().incr(rateKey).expire(rateKey, 60).exec();

  const code = generateInviteCode(8);
  const inviteKey = `invite:${code}`;
  const ttlSeconds = ttlMinutes * 60;
  const payload = JSON.stringify({ circleId, creatorId: userId, createdAt: Date.now() });
  await redis.set(inviteKey, payload, 'EX', ttlSeconds);

  await pool.execute(
    'INSERT INTO invite_audit (code_hash, circle_id, action, user_id, ip) VALUES (?, ?, "generate", ?, ?)',
    [hashCode(code), circleId, userId, req.ip]
  );

  return res.status(201).json({ code, ttlMinutes });
});

router.post('/join', async (req, res) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '参数校验失败', errors: parsed.error.issues });
  }

  const { userId, code } = parsed.data;
  const pool = getPool();
  const redis = getRedis();

  const rateKey = `rate:invite_use:${req.ip}`;
  const current = Number((await redis.get(rateKey)) || 0);
  if (current >= 10) {
    return res.status(429).json({ message: '请求过于频繁，请稍后再试' });
  }
  await redis.multi().incr(rateKey).expire(rateKey, 60).exec();

  const inviteKey = `invite:${code}`;
  const payload = await redis.get(inviteKey);
  if (!payload) {
    return res.status(410).json({ message: '邀请码无效或已过期' });
  }

  const { circleId } = JSON.parse(payload);

  const [exists] = await pool.execute(
    'SELECT id FROM circle_members WHERE circle_id = ? AND user_id = ? LIMIT 1',
    [circleId, userId]
  );

  if (exists.length > 0) {
    return res.status(409).json({ message: '你已在该圈子内' });
  }

  await pool.execute('INSERT INTO circle_members (circle_id, user_id, role) VALUES (?, ?, "member")', [circleId, userId]);
  await redis.del(inviteKey);

  await pool.execute(
    'INSERT INTO invite_audit (code_hash, circle_id, action, user_id, ip) VALUES (?, ?, "use", ?, ?)',
    [hashCode(code), circleId, userId, req.ip]
  );

  return res.status(201).json({ message: '加入圈子成功', circleId });
});

module.exports = router;
