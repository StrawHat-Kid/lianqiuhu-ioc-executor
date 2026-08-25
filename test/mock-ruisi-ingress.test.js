const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createRuisiCallbackClient } = require('../src/ruisi-callback-client');
const { createNarrationSessionManager } = require('../src/narration/narration-session-manager');
const { PARK_BASE_OVERVIEW } = require('../src/narration/narration-definitions');
const { readMockIngressConfig, createMockIngress, startMockIngress } = require('../scripts/mock-ruisi-ingress');

function createLogger() {
  return { info() {}, warn() {}, error() {} };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/agent/send`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function callbackContext(callback) {
  return { agent: 'hc-test-agent', replyTo: 'hc-test-user@example.com', groupchat: false, callback };
}

test('mock ingress reads official host, port, and token configuration', () => {
  assert.deepEqual(readMockIngressConfig({
    INGRESS_HOST: '127.0.0.2', INGRESS_PORT: '31234', INGRESS_TOKEN: 'token-a'
  }), { host: '127.0.0.2', port: 31234, ingressToken: 'token-a' });
  assert.deepEqual(readMockIngressConfig({}), { host: '127.0.0.1', port: 29876, ingressToken: '' });
  assert.throws(() => readMockIngressConfig({ INGRESS_PORT: '0' }), /INGRESS_PORT/);
});

test('mock ingress accepts the matching INGRESS_TOKEN and rejects a different token', async () => {
  const ingress = await listen(createMockIngress({ ingressToken: 'token-a', logger: createLogger() }));
  try {
    const matching = await createRuisiCallbackClient({ authToken: 'token-a' })
      .sendAgentMessage(callbackContext(ingress.url), { body: 'matching token' });
    const different = await createRuisiCallbackClient({ authToken: 'token-b' })
      .sendAgentMessage(callbackContext(ingress.url), { body: 'different token' });
    assert.deepEqual(matching, { ok: true, status: 200 });
    assert.deepEqual(different, { ok: false, status: 401, error: 'RUISI callback failed with status 401' });
  } finally {
    await ingress.close();
  }
});

test('mock ingress allows no-token development mode and announces disabled auth', async () => {
  const messages = [];
  const logger = { log(message) { messages.push(message); }, warn() {} };
  const server = startMockIngress({ host: '127.0.0.1', port: 0, ingressToken: '' }, logger);
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const result = await createRuisiCallbackClient().sendAgentMessage(
      callbackContext(`http://127.0.0.1:${port}/agent/send`), { body: 'no token' }
    );
    assert.deepEqual(result, { ok: true, status: 200 });
    assert.ok(messages.includes('[Mock RUISI Ingress] 鉴权：未启用'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a real mock 401 still allows narration cleanup to run', async () => {
  const ingress = await listen(createMockIngress({ ingressToken: 'token-a', logger: createLogger() }));
  const calls = [];
  const commandExecutor = {
    async publishFrontendCommands(commands) {
      calls.push(commands);
      return { ok: true, status: 200 };
    }
  };
  const manager = createNarrationSessionManager({
    commandExecutor,
    callbackClient: createRuisiCallbackClient({ authToken: 'token-b' }),
    logger: createLogger(),
    wait: async () => {}
  });
  try {
    const started = manager.startNarration({
      definition: PARK_BASE_OVERVIEW,
      context: callbackContext(ingress.url),
      language: 'zh-CN'
    });
    assert.equal(started.ok, true);
    await started.session.runPromise;
    assert.deepEqual(calls, [
      PARK_BASE_OVERVIEW.prepareCommands,
      PARK_BASE_OVERVIEW.startCommands,
      PARK_BASE_OVERVIEW.completeCommands
    ]);
  } finally {
    await ingress.close();
  }
});

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.env') return [];
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(?:js|md|json|example)$/.test(entry.name) ? [file] : [];
  });
}

test('official source, tests, scripts, and docs contain no former token variable name', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const formerTokenVariable = ['RUISI', 'INGRESS', 'TOKEN'].join('_');
  for (const file of sourceFiles(projectRoot)) {
    assert.equal(fs.readFileSync(file, 'utf8').includes(formerTokenVariable), false, file);
  }
});
