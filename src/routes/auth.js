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

const loginSchema = z
  .object({
    account: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().min(1).max(120).optional(),
    password: z.string().trim().min(1).max(72)
  })
  .refine((data) => Boolean(data.account || data.email), {
    message: '账号不能为空',
    path: ['account']
  });

const googleAuthSchema = z.object({
  credential: z.string().min(20)
});

const updateProfileSchema = z
  .object({
    username: z.string().trim().min(2).max(50).optional(),
    email: z.string().email().optional(),
    password: z.string().trim().min(6).max(72).optional()
  })
  .refine((data) => Boolean(data.username || data.email || data.password), {
    message: '至少提交一项修改'
  });

const adminRoleSchema = z.object({
  role: z.enum(['user', 'admin'])
});

const adminUpdateUserSchema = z
  .object({
    username: z.string().trim().min(2).max(50).optional(),
    email: z.string().email().optional(),
    password: z.string().trim().min(6).max(72).optional()
  })
  .refine((data) => Boolean(data.username || data.email || data.password), {
    message: '至少提交一项修改'
  });

const googleClient = env.googleClientId ? new OAuth2Client(env.googleClientId) : null;

function makeToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, email: user.email, role: user.role || 'user' },
    env.jwtSecret,
    { expiresIn: '7d' }
  );
}

function parseBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return null;
  }
  return auth.slice(7);
}

async function getAuthUser(req) {
  const token = parseBearerToken(req);
  if (!token) {
    return null;
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, username, email, role FROM users WHERE id = ? LIMIT 1',
      [payload.userId]
    );
    if (rows.length === 0) {
      return null;
    }
    return rows[0];
  } catch (_error) {
    return null;
  }
}

async function requireAuth(req, res) {
  const user = await getAuthUser(req);
  if (!user) {
    res.status(401).json({ message: '未登录或登录已过期' });
    return null;
  }
  return user;
}

async function requireSuperAdmin(req, res) {
  const user = await requireAuth(req, res);
  if (!user) {
    return null;
  }
  if (user.role !== 'super_admin') {
    res.status(403).json({ message: '仅主管理员可执行该操作' });
    return null;
  }
  return user;
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

  return res.status(201).json({ id: result.insertId, username, email, role: 'user' });
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '密码或用户名/邮箱无效' });
  }

  const account = String(parsed.data.account || parsed.data.email || '').trim();
  const { password } = parsed.data;
  const pool = getPool();
  const [rows] = await pool.execute(
    'SELECT id, username, email, password_hash FROM users WHERE email = ? OR username = ? LIMIT 1',
    [account, account]
  );

  if (rows.length === 0) {
    return res.status(401).json({ message: '密码或用户名/邮箱无效' });
  }

  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ message: '密码或用户名/邮箱无效' });
  }

  const token = makeToken(user);

  return res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
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
      'SELECT id, username, email, role FROM users WHERE email = ? LIMIT 1',
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
        email: payload.email,
        role: 'user'
      };
      isNewUser = true;
    }

    const token = makeToken(user);
    return res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role || 'user' },
      isNewUser
    });
  } catch (error) {
    console.error('[auth/google] failed:', error.message);
    return res.status(401).json({ message: 'Google 登录失败' });
  }
});

router.get('/me', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }
  return res.json({ user: { id: user.id, username: user.username, email: user.email, role: user.role } });
});

router.put('/me', async (req, res) => {
  const authUser = await requireAuth(req, res);
  if (!authUser) {
    return;
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '参数校验失败' });
  }

  const { username, email, password } = parsed.data;
  const pool = getPool();

  if (username) {
    const [rows] = await pool.execute('SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1', [username, authUser.id]);
    if (rows.length > 0) {
      return res.status(409).json({ message: '用户名已存在' });
    }
  }

  if (email) {
    const [rows] = await pool.execute('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1', [email, authUser.id]);
    if (rows.length > 0) {
      return res.status(409).json({ message: '邮箱已存在' });
    }
  }

  const updates = [];
  const values = [];
  if (username) {
    updates.push('username = ?');
    values.push(username);
  }
  if (email) {
    updates.push('email = ?');
    values.push(email);
  }
  if (password) {
    const passwordHash = await bcrypt.hash(password, 12);
    updates.push('password_hash = ?');
    values.push(passwordHash);
  }

  values.push(authUser.id);
  await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

  const [rows] = await pool.execute('SELECT id, username, email, role FROM users WHERE id = ? LIMIT 1', [authUser.id]);
  const user = rows[0];
  const token = makeToken(user);
  return res.json({ token, user });
});

router.get('/admin/users', async (req, res) => {
  const admin = await requireSuperAdmin(req, res);
  if (!admin) {
    return;
  }
  const pool = getPool();
  const [rows] = await pool.execute(
    'SELECT id, username, email, role, created_at AS createdAt FROM users ORDER BY id ASC'
  );
  return res.json(rows);
});

router.patch('/admin/users/:id/role', async (req, res) => {
  const admin = await requireSuperAdmin(req, res);
  if (!admin) {
    return;
  }

  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ message: '用户ID无效' });
  }
  if (targetId === admin.id) {
    return res.status(400).json({ message: '不能修改自己的角色' });
  }

  const parsed = adminRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '参数校验失败' });
  }

  const pool = getPool();
  const [targetRows] = await pool.execute('SELECT id, role FROM users WHERE id = ? LIMIT 1', [targetId]);
  if (targetRows.length === 0) {
    return res.status(404).json({ message: '用户不存在' });
  }
  if (targetRows[0].role === 'super_admin') {
    return res.status(403).json({ message: '不能修改主管理员角色' });
  }

  await pool.execute('UPDATE users SET role = ? WHERE id = ?', [parsed.data.role, targetId]);
  return res.json({ message: '角色更新成功' });
});

router.put('/admin/users/:id', async (req, res) => {
  const admin = await requireSuperAdmin(req, res);
  if (!admin) {
    return;
  }

  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ message: '用户ID无效' });
  }

  const parsed = adminUpdateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '参数校验失败' });
  }

  const { username, email, password } = parsed.data;
  const pool = getPool();

  const [targetRows] = await pool.execute('SELECT id, role FROM users WHERE id = ? LIMIT 1', [targetId]);
  if (targetRows.length === 0) {
    return res.status(404).json({ message: '用户不存在' });
  }
  if (targetRows[0].role === 'super_admin' && targetId !== admin.id) {
    return res.status(403).json({ message: '不能修改主管理员信息' });
  }

  if (username) {
    const [rows] = await pool.execute('SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1', [username, targetId]);
    if (rows.length > 0) {
      return res.status(409).json({ message: '用户名已存在' });
    }
  }

  if (email) {
    const [rows] = await pool.execute('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1', [email, targetId]);
    if (rows.length > 0) {
      return res.status(409).json({ message: '邮箱已存在' });
    }
  }

  const updates = [];
  const values = [];
  if (username) {
    updates.push('username = ?');
    values.push(username);
  }
  if (email) {
    updates.push('email = ?');
    values.push(email);
  }
  if (password) {
    const passwordHash = await bcrypt.hash(password, 12);
    updates.push('password_hash = ?');
    values.push(passwordHash);
  }

  values.push(targetId);
  await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
  return res.json({ message: '用户信息更新成功' });
});

module.exports = router;
