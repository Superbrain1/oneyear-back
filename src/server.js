const env = require('./config/env');
const app = require('./app');
const { connectMySQLWithRetry } = require('./db/mysql');
const { createRedisClient } = require('./db/redis');
const { initSchema } = require('./db/initSchema');

async function bootstrap() {
  try {
    await connectMySQLWithRetry();
    createRedisClient();
    await initSchema();

    const server = app.listen(env.port, () => {
      console.log(`[server] started on port ${env.port}`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[server] port ${env.port} already in use. Run: lsof -tiTCP:${env.port} -sTCP:LISTEN | xargs kill -9`);
      } else {
        console.error('[server] listen error:', err.message);
      }
      process.exit(1);
    });
  } catch (error) {
    console.error('[server] startup failed:', error);
    process.exit(1);
  }
}

bootstrap();
