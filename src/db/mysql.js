const mysql = require('mysql2/promise');
const env = require('../config/env');

let pool;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectMySQLWithRetry(maxRetry = 15) {
  let attempt = 0;

  while (attempt < maxRetry) {
    attempt += 1;
    try {
      const bootConn = await mysql.createConnection({
        host: env.mysql.host,
        port: env.mysql.port,
        user: env.mysql.user,
        password: env.mysql.password
      });

      await bootConn.execute(
        `CREATE DATABASE IF NOT EXISTS \`${env.mysql.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
      await bootConn.end();

      pool = mysql.createPool({
        host: env.mysql.host,
        port: env.mysql.port,
        user: env.mysql.user,
        password: env.mysql.password,
        database: env.mysql.database,
        waitForConnections: true,
        connectionLimit: env.mysql.connectionLimit,
        queueLimit: 0
      });

      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();
      console.log(`[mysql] connected on attempt ${attempt}`);
      return pool;
    } catch (error) {
      console.error(`[mysql] connect failed (attempt ${attempt}/${maxRetry}): ${error.message}`);
      if (attempt >= maxRetry) throw error;
      await sleep(2000);
    }
  }

  throw new Error('MySQL connection failed after retries');
}

function getPool() {
  if (!pool) {
    throw new Error('MySQL pool is not initialized');
  }
  return pool;
}

module.exports = {
  connectMySQLWithRetry,
  getPool
};
