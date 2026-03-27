const { getPool } = require('./mysql');
const bcrypt = require('bcryptjs');
const env = require('../config/env');

async function safeAlter(pool, sql) {
  try {
    await pool.execute(sql);
  } catch (error) {
    if (error && (error.code === 'ER_DUP_FIELDNAME' || error.code === 'ER_DUP_KEYNAME')) {
      return;
    }
    throw error;
  }
}

async function ensureMasterAdmin(pool) {
  const { username, email, password } = env.masterAdmin;
  if (!username || !email || !password) {
    return;
  }

  const [emailRows] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  const [usernameRows] = await pool.execute('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
  const passwordHash = await bcrypt.hash(password, 12);

  const emailUser = emailRows[0] || null;
  const usernameUser = usernameRows[0] || null;

  if (!emailUser && !usernameUser) {
    await pool.execute(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, "super_admin")',
      [username, email, passwordHash]
    );
    console.log('[mysql] master admin created');
    return;
  }

  if (emailUser) {
    await pool.execute(
      'UPDATE users SET role = "super_admin", password_hash = ? WHERE id = ?',
      [passwordHash, emailUser.id]
    );

    if (!usernameUser || usernameUser.id === emailUser.id) {
      await pool.execute('UPDATE users SET username = ? WHERE id = ?', [username, emailUser.id]);
    }

    console.log('[mysql] master admin ensured');
    return;
  }

  await pool.execute(
    'UPDATE users SET email = ?, role = "super_admin", password_hash = ? WHERE id = ?',
    [email, passwordHash, usernameUser.id]
  );
  console.log('[mysql] master admin ensured');
}

async function initSchema() {
  const pool = getPool();

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(120) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('user', 'admin', 'super_admin') NOT NULL DEFAULT 'user',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await safeAlter(
    pool,
    "ALTER TABLE users ADD COLUMN role ENUM('user', 'admin', 'super_admin') NOT NULL DEFAULT 'user' AFTER password_hash"
  );

  await safeAlter(
    pool,
    'ALTER TABLE users ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
  );

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS circles (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(60) NOT NULL,
      type ENUM('system', 'custom') NOT NULL DEFAULT 'custom',
      owner_id BIGINT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS circle_members (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      circle_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      role ENUM('owner', 'member') NOT NULL DEFAULT 'member',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_member (circle_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS invite_audit (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      code_hash VARCHAR(128) NOT NULL,
      circle_id BIGINT NOT NULL,
      action ENUM('generate', 'use') NOT NULL,
      user_id BIGINT NULL,
      ip VARCHAR(64) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const defaults = ['世界', '省', '市', '区'];
  for (const name of defaults) {
    await pool.execute(
      'INSERT INTO circles (name, type) SELECT ?, "system" WHERE NOT EXISTS (SELECT 1 FROM circles WHERE name = ? AND type = "system")',
      [name, name]
    );
  }

  await ensureMasterAdmin(pool);

  console.log('[mysql] schema initialized');
}

module.exports = {
  initSchema
};
