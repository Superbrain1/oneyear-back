const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
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

  const token = jwt.sign(
    { userId: user.id, username: user.username, email: user.email },
    env.jwtSecret,
    { expiresIn: '7d' }
  );

  return res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
});

module.exports = router;
