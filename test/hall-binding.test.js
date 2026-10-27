const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHallBinder, isCallbackAllowed, parseCallbackAllowlist } = require('../src/hall-binding');
const { createExhibitionAuth } = require('../src/exhibition-auth');
const { createRuisiCallbackClient } = require('../src/ruisi-callback-client');
const { createApp } = require('../src/server');
const { readConfig } = require('../src/config');

const TOKEN_A = 'token-a-0123456789abcdef';
const TOKEN_B = 'token-b-0123456789abcdef';
const TOKEN_C = 'token-c-0123456789abcdef';
const HALL_A = 'hall-a';
const HALL_B = 'hall-b';
const HALL_C = 'hall-c';
const CALLBACK_A = 'http://callback-a.example:9000/agent/send';
const CALLBACK_B = 'http://callback-b.example:9001/agent/send';
const CALLBACK_C = 'https://callback-c.example:9443/agent/send';
const NARRATION = [{ action: '讲解园区基础信息', params: { language: 'zh-CN' } }];

function logger() {
  return { info() {}, warn() {}, error() {} };
}

function buildHalls(overrides = {}) {
  return new Map([
    [HALL_A, {
      exhibitionId: HALL_A,
      agent: 'trusted-agent-a',
      callbackAllowlist: [CALLBACK_A],
      ingressToken: 'out-token-a',
      ...overrides[HALL_A]
    }],
    [HALL_B, {
      exhibitionId: HALL_B,
      agent: 'trusted-agent-b',
      callbackAllowlist: [CALLBACK_B],
      ingressToken: 'out-token-b',
      ...overrides[HALL_B]
    }],
    [HALL_C, {
      exhibitionId: HALL_C,
      agent: 'trusted-agent-c',
      callbackAllowlist: [CALLBACK_C],
      ingressToken: 'out-token-c',
      ...overrides[HALL_C]
    }]
  ]);
}

function buildApp({ halls = buildHalls(), started = [] } = {}) {
  const publisher = { calls: [], isConnected: () => true, publish: async (message) => publisher.calls.push(message) };
  const manager = {
    startNarration(input) {
      started.push(input);
      return { ok: true, session: { id: `session-${started.length}` } };
    }
  };
  const app = createApp({
    publisher,
    logger: logger(),
    mqttTopic: 'test/topic',
    narrationManager: manager,
    exhibitionAuth: createExhibitionAuth({
      tokenMap: new Map([[TOKEN_A, HALL_A], [TOKEN_B, HALL_B], [TOKEN_C, HALL_C]]),
      logger: logger()
    }),
    hallBinder: createHallBinder({ halls, logger: logger() })
  });
  return { app, publisher, started };
}

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postCommands(app, body, token) {
  return withServer(app, async (baseUrl) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token !== undefined) headers['X-HC-Token'] = token;
    const response = await fetch(`${baseUrl}/api/commands`, {
      method: 'POST', headers, body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  });
}

function envelope(callback, agent = 'spoofed-agent') {
  return {
    context: { agent, reply_to: 'user@example.com', groupchat: false, callback },
    commands: NARRATION
  };
}

test('isCallbackAllowed matches scheme, host, port and path prefix only', () => {
  assert.equal(isCallbackAllowed(CALLBACK_A, [CALLBACK_A]), true);
  assert.equal(isCallbackAllowed('https://callback-a.example:9000/agent/send', [CALLBACK_A]), false);
  assert.equal(isCallbackAllowed('http://other.example:9000/agent/send', [CALLBACK_A]), false);
  assert.equal(isCallbackAllowed('http://callback-a.example:9001/agent/send', [CALLBACK_A]), false);
  assert.equal(isCallbackAllowed('http://callback-a.example:9000/agent/send/extra', [CALLBACK_A]), true);
  assert.equal(isCallbackAllowed('http://callback-a.example:9000/agent/send2', [CALLBACK_A]), false);
  assert.equal(isCallbackAllowed('http://callback-a.example:9000/other', [CALLBACK_A]), false);
  assert.equal(isCallbackAllowed('http://callback-a.example/agent/send', ['http://callback-a.example:80/agent/send']), true);
  assert.equal(isCallbackAllowed('http://callback-a.example:9000/agent/send', []), false);
  assert.equal(isCallbackAllowed('not-a-url', [CALLBACK_A]), false);
});

test('parseCallbackAllowlist rejects empty and non-http entries', () => {
  assert.throws(() => parseCallbackAllowlist('', 'ALLOW'), /at least one/);
  assert.throws(() => parseCallbackAllowlist(undefined, 'ALLOW'), /at least one/);
  assert.throws(() => parseCallbackAllowlist('file:///tmp/x', 'ALLOW'), /http/);
  assert.throws(() => parseCallbackAllowlist(`${CALLBACK_A},`, 'ALLOW'), /empty entry/);
  assert.deepEqual([...parseCallbackAllowlist(` ${CALLBACK_A} `, 'ALLOW')], [CALLBACK_A]);
});

test('binder replaces context.agent with the trusted hall agent and its ingress token', () => {
  const binder = createHallBinder({ halls: buildHalls(), logger: logger() });
  const result = binder.bind({
    exhibitionId: HALL_A,
    context: { agent: 'spoofed', replyTo: 'u', groupchat: false, callback: CALLBACK_A }
  });
  assert.equal(result.ok, true);
  assert.equal(result.context.agent, 'trusted-agent-a');
  assert.equal(result.context.ingressToken, 'out-token-a');
});

test('binder is fail-closed for missing context, missing callback, unknown hall and disallowed target', () => {
  const binder = createHallBinder({ halls: buildHalls(), logger: logger() });
  assert.deepEqual(
    binder.bind({ exhibitionId: HALL_A, context: null }),
    { ok: false, status: 400, error: 'missing context' }
  );
  assert.deepEqual(
    binder.bind({ exhibitionId: HALL_A, context: { agent: 'a', replyTo: 'u', callback: '' } }),
    { ok: false, status: 400, error: 'missing context.callback' }
  );
  assert.equal(binder.bind({ exhibitionId: 'other-hall', context: { callback: CALLBACK_A } }).status, 403);
  const crossHall = binder.bind({ exhibitionId: HALL_A, context: { callback: CALLBACK_B } });
  assert.deepEqual(crossHall, { ok: false, status: 403, error: 'callback target is not allowed for this exhibition' });
});

test('A/B tokens use their own agent and reject the other hall callback target', async () => {
  const started = [];
  const { app } = buildApp({ started });

  const acceptedA = await postCommands(app, envelope(CALLBACK_A), TOKEN_A);
  assert.equal(acceptedA.status, 202);
  assert.equal(started[0].context.agent, 'trusted-agent-a');
  assert.equal(started[0].context.ingressToken, 'out-token-a');

  const acceptedB = await postCommands(app, envelope(CALLBACK_B), TOKEN_B);
  assert.equal(acceptedB.status, 202);
  assert.equal(started[1].context.agent, 'trusted-agent-b');
  assert.equal(started[1].context.ingressToken, 'out-token-b');

  const crossA = await postCommands(app, envelope(CALLBACK_B), TOKEN_A);
  assert.equal(crossA.status, 403);
  assert.equal(crossA.body.error, 'callback target is not allowed for this exhibition');

  const crossB = await postCommands(app, envelope(CALLBACK_A), TOKEN_B);
  assert.equal(crossB.status, 403);

  assert.equal(started.length, 2);
});

test('A/B/C tokens concurrently bind their own agent, callback port and ingress token', async () => {
  const started = [];
  const { app } = buildApp({ started });

  const responses = await Promise.all([
    postCommands(app, envelope(CALLBACK_A), TOKEN_A),
    postCommands(app, envelope(CALLBACK_B), TOKEN_B),
    postCommands(app, envelope(CALLBACK_C), TOKEN_C)
  ]);
  assert.deepEqual(responses.map((item) => item.status), [202, 202, 202]);

  const byAgent = new Map(started.map((item) => [item.context.agent, item.context]));
  assert.equal(byAgent.get('trusted-agent-a').callback, CALLBACK_A);
  assert.equal(byAgent.get('trusted-agent-a').ingressToken, 'out-token-a');
  assert.equal(byAgent.get('trusted-agent-b').callback, CALLBACK_B);
  assert.equal(byAgent.get('trusted-agent-b').ingressToken, 'out-token-b');
  assert.equal(byAgent.get('trusted-agent-c').callback, CALLBACK_C);
  assert.equal(byAgent.get('trusted-agent-c').ingressToken, 'out-token-c');

  const crossHall = await postCommands(app, envelope(CALLBACK_C), TOKEN_B);
  assert.equal(crossHall.status, 403);
  assert.equal(started.length, 3);
});

test('readConfig fails closed when any mapped exhibition lacks hall binding', () => {
  const base = {
    MQTT_URL: 'mqtts://broker.example:8883',
    MQTT_USERNAME: 'executor',
    MQTT_PASSWORD: 'password',
    MQTT_TOPIC: 'test/topic',
    MQTT_QOS: '0',
    MQTT_RETAIN: 'false',
    HC_TOKEN_MAP: `${TOKEN_A}:${HALL_A},${TOKEN_B}:${HALL_B},${TOKEN_C}:${HALL_C}`,
    HC_HALL_HALL_A_AGENT: 'trusted-agent-a',
    HC_HALL_HALL_A_CALLBACK_ALLOWLIST: CALLBACK_A,
    HC_HALL_HALL_B_AGENT: 'trusted-agent-b',
    HC_HALL_HALL_B_CALLBACK_ALLOWLIST: CALLBACK_B
  };
  assert.throws(() => readConfig(base), /HC_HALL_HALL_C_AGENT/);

  const configured = readConfig({
    ...base,
    HC_HALL_HALL_C_AGENT: 'trusted-agent-c',
    HC_HALL_HALL_C_CALLBACK_ALLOWLIST: CALLBACK_C
  });
  assert.deepEqual([...configured.exhibitionHalls.keys()], [HALL_A, HALL_B, HALL_C]);
  assert.equal(configured.exhibitionHalls.get(HALL_C).agent, 'trusted-agent-c');
});

test('missing, invalid and unmapped tokens are rejected before callback binding', async () => {
  const started = [];
  const { app } = buildApp({ started });
  for (const token of [undefined, 'short', 'unknown-token-0123456789']) {
    const result = await postCommands(app, envelope(CALLBACK_A), token);
    assert.equal(result.status, 401);
  }
  assert.equal(started.length, 0);
});

test('normal MQTT commands remain unchanged and do not require callback binding', async () => {
  const { app, publisher } = buildApp();
  const result = await postCommands(app, [{ action: '主题切换', params: { '主题名称': '综合安防' } }], TOKEN_A);
  assert.equal(result.status, 200);
  assert.equal(publisher.calls.length, 1);
  assert.equal(JSON.parse(publisher.calls[0]).exhibitionId, HALL_A);
});

test('per-hall context token overrides the global callback credential', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ headers: req.headers, body: '' });
    req.on('data', () => {});
    req.on('end', () => res.writeHead(200).end());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const callback = `http://127.0.0.1:${server.address().port}/agent/send`;
  try {
    const client = createRuisiCallbackClient({ authToken: 'global-token', timeoutMs: 1000 });
    await client.sendAgentMessage(
      { agent: 'a', replyTo: 'u', groupchat: false, callback, ingressToken: 'hall-token' },
      { body: 'hello' }
    );
    await client.sendAgentMessage(
      { agent: 'a', replyTo: 'u', groupchat: false, callback },
      { body: 'hello' }
    );
    assert.equal(requests[0].headers['x-auth-token'], 'hall-token');
    assert.equal(requests[1].headers['x-auth-token'], 'global-token');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('/health stays anonymous', async () => {
  const { app } = buildApp();
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
  });
});
