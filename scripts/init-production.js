const env = require('../src/config/env');
const { connectMySQLWithRetry, getPool } = require('../src/db/mysql');
const { createRedisClient, getRedis } = require('../src/db/redis');
const { initSchema } = require('../src/db/initSchema');

async function run() {
  console.log('[init] starting production bootstrap checks');
  console.log(`[init] nodeEnv=${env.nodeEnv} appVersion=${env.appVersion}`);

  if (env.jwtSecret === 'replace_me_in_production') {
    throw new Error('JWT_SECRET 仍为默认值，禁止用于正式环境');
  }

  if (!env.masterAdmin.username || !env.masterAdmin.email || !env.masterAdmin.password) {
    console.warn('[init] MASTER_ADMIN_* 未完整配置，初始化后将不会自动创建主管理员');
  }

  await connectMySQLWithRetry();
  createRedisClient();
  await getRedis().ping();
  await initSchema();

  const pool = getPool();
  const [summaryRows] = await pool.execute(
    `SELECT
      (SELECT COUNT(*) FROM users) AS userCount,
      (SELECT COUNT(*) FROM posts) AS postCount,
      (SELECT COUNT(*) FROM activities) AS activityCount,
      (SELECT COUNT(*) FROM marketplace_items) AS marketplaceCount`
  );

  console.log('[init] database summary:', summaryRows[0]);
  console.log('[init] monitoring:', {
    errorWebhookConfigured: Boolean(env.monitoring.errorWebhook),
    metricsTokenConfigured: Boolean(env.monitoring.metricsToken)
  });
  console.log('[init] completed');

  try {
    await getRedis().quit();
  } catch (_error) {
    // ignore shutdown noise
  }
  try {
    await pool.end();
  } catch (_error) {
    // ignore shutdown noise
  }
}

run().catch((error) => {
  console.error('[init] failed:', error.message);
  process.exit(1);
});
