const { getPool } = require('./mysql');

async function initSchema() {
  const pool = getPool();

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(120) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

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

  console.log('[mysql] schema initialized');
}

module.exports = {
  initSchema
};
