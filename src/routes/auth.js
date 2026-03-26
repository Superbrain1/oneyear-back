const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { z } = require('zod');
const env = require('../config/env');
const { getPool } = require('../db/mysql');

const router = express.Router();

const registerSchema = z.object({
  username: z.string().min(2).max(50),
  email: z.string().email(),
  password: z.string().min(6).max(72)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(72)
});

const googleAuthSchema = z.object({
  credential: z.string().min(20)
});

const googleClient = env.googleClientId ? new OAuth2Client(env.googleClientId) : null;

function makeToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, email: user.email },
    env.jwtSecret,
    { expiresIn: '7d' }
  );
}

function normalizeUsername(input) {
  const base = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 18);
  return base || `user${Date.now().toString().slice(-6)}`;
}

async function ensureUniqueUsername(pool, candidate) {
  let username = normalizeUsername(candidate);

  for (let i = 0; i < 20; i += 1) {
    const [rows] = await pool.execute('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
    if (rows.length === 0) {
      return username;
    }
    username = `${normalizeUsername(candidate).slice(0, 14)}${Math.floor(Math.random() * 10000)}`;
  }

  return `user${Date.now().toString().slice(-8)}`;
}

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '参数校验失败', errors: parsed.error.issues });
  }

  const { username, email, password } = parsed.data;
  const pool = getPool();

  const [exists] = await pool.execute('SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1', [email, username]);
  if (exists.length > 0) {
    return res.status(409).json({ message: '邮箱或用户名已存在' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await pool.execute(
    'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
    [username, email, passwordHash]
  );

  return res.status(201).json({ id: result.insertId, username, email });
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '参数校验失败', errors: parsed.error.issues });
  }

  const { email, password } = parsed.data;
  const pool = getPool();
  const [rows] = await pool.execute('SELECT id, username, email, password_hash FROM users WHERE email = ? LIMIT 1', [email]);

  if (rows.length === 0) {
    return res.status(401).json({ message: '账号或密码错误' });
  }

  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ message: '账号或密码错误' });
  }

  const token = makeToken(user);

  return res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
});

router.post('/google', async (req, res) => {
  const parsed = googleAuthSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '参数校验失败', errors: parsed.error.issues });
  }

  if (!googleClient || !env.googleClientId) {
    return res.status(500).json({ message: 'Google 登录未配置' });
  }

  try {
    const { credential } = parsed.data;

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: env.googleClientId
    });
    const payload = ticket.getPayload();

    if (!payload?.email || payload.email_verified !== true) {
      return res.status(401).json({ message: 'Google 账号信息校验失败' });
    }

    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, username, email FROM users WHERE email = ? LIMIT 1',
      [payload.email]
    );

    let user = rows[0];
    let isNewUser = false;

    if (!user) {
      const candidate = payload.name || payload.given_name || payload.email.split('@')[0];
      const username = await ensureUniqueUsername(pool, candidate);
      const passwordHash = await bcrypt.hash(crypto.randomUUID(), 12);
      const [insertResult] = await pool.execute(
        'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
        [username, payload.email, passwordHash]
      );

      user = {
        id: insertResult.insertId,
        username,
        email: payload.email
      };
      isNewUser = true;
    }

    const token = makeToken(user);
    return res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email },
      isNewUser
    });
  } catch (error) {
    console.error('[auth/google] failed:', error.message);
    return res.status(401).json({ message: 'Google 登录失败' });
  }
});

module.exports = router;
