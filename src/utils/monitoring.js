const http = require('http');
const https = require('https');
const { URL } = require('url');

const env = require('../config/env');

function normalizeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    name: 'UnknownError',
    message: typeof error === 'string' ? error : JSON.stringify(error),
    stack: ''
  };
}

function postJson(targetUrl, payload) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const body = Buffer.from(JSON.stringify(payload));
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || undefined,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(body.length)
        },
        timeout: 3000
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      }
    );

    req.on('timeout', () => req.destroy(new Error('monitoring webhook timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function reportBackendError(error, context = {}) {
  const normalizedError = normalizeError(error);
  const payload = {
    app: 'oneyear-back',
    env: env.nodeEnv,
    version: env.appVersion,
    commitSha: env.appCommitSha || null,
    occurredAt: new Date().toISOString(),
    error: normalizedError,
    context
  };

  console.error('[monitoring] backend error', payload);

  if (!env.monitoring.errorWebhook) {
    return;
  }

  try {
    await postJson(env.monitoring.errorWebhook, payload);
  } catch (reportError) {
    console.error('[monitoring] webhook report failed:', reportError.message);
  }
}

function buildRequestContext(req) {
  return {
    type: 'http_request',
    method: req.method,
    path: req.originalUrl || req.url,
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
    requestId: req.get('x-request-id') || '',
    userId: req.user?.id || null
  };
}

module.exports = {
  buildRequestContext,
  reportBackendError
};
