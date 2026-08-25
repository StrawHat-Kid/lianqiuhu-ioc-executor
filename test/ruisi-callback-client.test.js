const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCommandRequest } = require('../src/command-request');
const { createRuisiCallbackClient } = require('../src/ruisi-callback-client');

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/agent/send`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let value = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { value += chunk; });
    req.on('end', () => resolve(JSON.parse(value)));
    req.on('error', reject);
  });
}

function context(callback, overrides = {}) {
  return { agent: 'hc-demo-agent', replyTo: 'user@example.com', groupchat: true, callback, ...overrides };
}

function createCaptureLogger() {
  const entries = [];
  return {
    entries,
    info(message, details) { entries.push({ level: 'info', message, details }); },
    warn(message, details) { entries.push({ level: 'warn', message, details }); },
    error(message, details) { entries.push({ level: 'error', message, details }); }
  };
}

test('callback POST uses protocol body fields and context defaults', async () => {
  const requests = [];
  const server = await startServer(async (req, res) => {
    requests.push({ method: req.method, headers: req.headers, body: await readJson(req) });
    res.writeHead(200).end('{"ok":true}');
  });
  try {
    const client = createRuisiCallbackClient();
    const result = await client.sendAgentMessage(context(server.url), { body: 'HC callback test' });
    assert.deepEqual(result, { ok: true, status: 200 });
    assert.deepEqual(requests[0].body, {
      agent: 'hc-demo-agent', to: 'user@example.com', body: 'HC callback test', groupchat: true
    });
    assert.equal(requests[0].method, 'POST');
    assert.match(requests[0].headers['content-type'], /application\/json/);
  } finally {
    await server.close();
  }
});

test('callback supports explicit recipient and groupchat override', async () => {
  let body;
  const server = await startServer(async (req, res) => {
    body = await readJson(req);
    res.writeHead(200).end();
  });
  try {
    const result = await createRuisiCallbackClient().sendAgentMessage(context(server.url), {
      to: 'other@example.com', groupchat: false, body: '主动消息'
    });
    assert.equal(result.ok, true);
    assert.deepEqual(body, { agent: 'hc-demo-agent', to: 'other@example.com', body: '主动消息', groupchat: false });
  } finally {
    await server.close();
  }
});

test('configured token is sent and absent token does not create an empty header', async () => {
  const headers = [];
  const server = await startServer((req, res) => {
    headers.push(req.headers);
    res.writeHead(200).end();
  });
  try {
    await createRuisiCallbackClient({ authToken: 'test-token' }).sendAgentMessage(context(server.url), { body: 'one' });
    await createRuisiCallbackClient().sendAgentMessage(context(server.url), { body: 'two' });
    assert.equal(headers[0]['x-auth-token'], 'test-token');
    assert.equal(headers[1]['x-auth-token'], undefined);
  } finally {
    await server.close();
  }
});

test('callback现场日志记录回程元数据但不暴露token', async () => {
  const server = await startServer((req, res) => res.writeHead(200).end());
  const logger = createCaptureLogger();
  try {
    const result = await createRuisiCallbackClient({ logger, authToken: 'test-token' }).sendAgentMessage(context(server.url), {
      body: '现场回程正文', requestId: 'req-log', sessionId: 'session-log', scenario: 'parkBaseOverview', segmentIndex: 1, segmentCount: 5
    });
    assert.equal(result.ok, true);
    const preparing = logger.entries.find((entry) => entry.message.includes('准备发送消息'));
    const success = logger.entries.find((entry) => entry.message.includes('发送成功'));
    assert.equal(preparing.details.body, '现场回程正文');
    assert.equal(preparing.details.segment, '1/5');
    assert.equal(preparing.details.ingressAuthState, '已配置');
    assert.equal(preparing.details.xAuthState, '已携带');
    assert.equal(success.details.status, 200);
    assert.ok(Number.isInteger(success.details.elapsedMs));
    assert.equal(JSON.stringify(logger.entries).includes('test-token'), false);
  } finally {
    await server.close();
  }
});

for (const status of [401, 404, 503]) {
  test(`callback returns a handled failure for HTTP ${status}`, async () => {
    const server = await startServer((req, res) => res.writeHead(status).end());
    try {
      const result = await createRuisiCallbackClient().sendAgentMessage(context(server.url), { body: 'test' });
      assert.deepEqual(result, { ok: false, status, error: `RUISI callback failed with status ${status}` });
    } finally {
      await server.close();
    }
  });
}

test('network failures are returned instead of rejected', async () => {
  const client = createRuisiCallbackClient({ fetchImpl: async () => { throw new Error('connection refused'); } });
  const result = await client.sendAgentMessage(context('http://127.0.0.1:1/agent/send'), { body: 'test' });
  assert.deepEqual(result, { ok: false, status: null, error: 'RUISI callback network error' });
});

test('timeout failures are returned instead of rejected', async () => {
  const server = await startServer((req, res) => setTimeout(() => res.writeHead(200).end(), 100));
  try {
    const result = await createRuisiCallbackClient({ timeoutMs: 10 }).sendAgentMessage(context(server.url), { body: 'test' });
    assert.deepEqual(result, { ok: false, status: null, error: 'RUISI callback timeout after 10ms' });
  } finally {
    await server.close();
  }
});

test('missing callback and empty body are explicit non-throwing unavailable results', async () => {
  const client = createRuisiCallbackClient();
  assert.deepEqual(await client.sendAgentMessage(context(undefined), { body: 'test' }), {
    ok: false, status: null, error: 'callback unavailable: missing context.callback'
  });
  assert.deepEqual(await client.sendAgentMessage(context('http://127.0.0.1:1/agent/send'), { body: '  ' }), {
    ok: false, status: null, error: 'callback unavailable: body must be a non-empty string'
  });
});

test('separate normalized request contexts retain their own callback recipients', async () => {
  const recipients = [];
  const server = await startServer(async (req, res) => {
    recipients.push((await readJson(req)).to);
    res.writeHead(200).end();
  });
  try {
    const requestA = normalizeCommandRequest({
      context: { agent: 'agent-a', reply_to: 'userA@example.com', callback: server.url }, commands: []
    });
    const requestB = normalizeCommandRequest({
      context: { agent: 'agent-b', reply_to: 'userB@example.com', callback: server.url }, commands: []
    });
    const client = createRuisiCallbackClient();
    await client.sendAgentMessage(requestB.context, { body: 'B' });
    await client.sendAgentMessage(requestA.context, { body: 'A' });
    assert.deepEqual(recipients, ['userB@example.com', 'userA@example.com']);
    assert.equal(requestA.context.replyTo, 'userA@example.com');
  } finally {
    await server.close();
  }
});
