const http = require('node:http');
const dotenv = require('dotenv');
const { createLogger } = require('../src/logger');

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function logInfo(logger, message, details) {
  if (typeof logger.info === 'function') logger.info(message, details);
  else logger.log?.(message);
}

function readMockIngressConfig(env = process.env) {
  const host = env.INGRESS_HOST || '127.0.0.1';
  const port = Number(env.INGRESS_PORT || 29876);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('INGRESS_PORT must be a valid TCP port');
  }
  return { host, port, ingressToken: env.INGRESS_TOKEN || '' };
}

function createMockIngress({ ingressToken = '', logger = console } = {}) {
  const authEnabled = nonEmpty(ingressToken);
  return http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/agent/send') return res.writeHead(404).end();
    if (authEnabled && req.headers['x-auth-token'] !== ingressToken) {
      logger.warn?.('[Mock RUISI Ingress] 鉴权失败');
      return res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"ok":false,"error":"unauthorized"}');
    }
    let payload = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { payload += chunk; });
    req.on('end', () => {
      try {
        logInfo(logger, '[Mock RUISI Ingress] 收到执行器回程消息', { payload: JSON.parse(payload) });
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"ok":false,"error":"invalid JSON"}');
      }
    });
  });
}

function startMockIngress(config = readMockIngressConfig(), logger = console) {
  const server = createMockIngress({ ingressToken: config.ingressToken, logger });
  server.listen(config.port, config.host, () => {
    logInfo(logger, '[Mock RUISI Ingress] 监听成功', { ingressHost: config.host, ingressPort: config.port, path: '/agent/send' });
    logInfo(logger, nonEmpty(config.ingressToken) ? '[Mock RUISI Ingress] 鉴权：已启用' : '[Mock RUISI Ingress] 鉴权：未启用');
  });
  return server;
}

if (require.main === module) {
  dotenv.config();
  const server = startMockIngress(undefined, createLogger());
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
}

module.exports = { readMockIngressConfig, createMockIngress, startMockIngress };
