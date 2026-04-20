const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { getPool } = require('../db/mysql');

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
      `SELECT
        id,
        username,
        email,
        role,
        city,
        bio,
        level,
        exp,
        avatar_url AS avatarUrl,
        banner_url AS bannerUrl
      FROM users
      WHERE id = ?
      LIMIT 1`,
      [payload.userId]
    );
    return rows[0] || null;
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

module.exports = {
  parseBearerToken,
  getAuthUser,
  requireAuth
};
