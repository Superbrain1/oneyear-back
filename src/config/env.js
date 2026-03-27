const dotenv = require('dotenv');

dotenv.config();

function required(name, fallback) {
  const value = process.env[name] || fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  mysql: {
    host: required('DB_HOST', '127.0.0.1'),
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER', 'root'),
    password: process.env.DB_PASSWORD || '',
    database: required('DB_NAME', 'oneyear'),
    connectionLimit: Number(process.env.DB_POOL_LIMIT || 10)
  },
  redis: {
    host: required('REDIS_HOST', '127.0.0.1'),
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || '',
    db: Number(process.env.REDIS_DB || 0)
  },
  jwtSecret: required('JWT_SECRET', 'replace_me_in_production'),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  masterAdmin: {
    username: process.env.MASTER_ADMIN_USERNAME || '',
    email: process.env.MASTER_ADMIN_EMAIL || '',
    password: process.env.MASTER_ADMIN_PASSWORD || ''
  }
};

module.exports = env;
