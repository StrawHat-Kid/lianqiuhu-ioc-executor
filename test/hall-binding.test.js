const test = require('node:test');
const assert = require('node:assert/strict');
const { createHallBinder, isTrustedCallback } = require('../src/hall-binding');
const { createExhibitionAuth } = require('../src/exhibition-auth');
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
const CALLBACK_C = 'http://callback-c.example:9002/agent/send';
const NARRATION = [{ action: '讲解园区基础信息', params: { language: 'zh-CN' } }];

function logger() {
  return { info() {}, warn() {}, error() {} };
}

function hall(exhibitionId, agent, callback, overrides = {}) {
  const url = new URL(callback);
  return {
    exhibitionId,
    agent,
    ingressHost: url.hostname,
    ingressPort: Number(url.port || 80),
    ingressToken: `out-token-${exhibitionId}`,
    to: null,
    ingressUrl: callback,
    ...overrides
  };
}

function buildHalls(overrides = {}) {
  return new Map([
    [HALL_A, hall(HALL_A, 'trusted-agent-a', CALLBACK_A, overrides[HALL_A])],
    [HALL_B, hall(HALL_B, 'trusted-agent-b', CALLBACK_B, overrides[HALL_B])],
    [HALL_C, hall(HALL_C, 'trusted-agent-c', CALLBACK_C, overrides[HALL_C])]
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

test('isTrustedCallback matches exactly http + configured host + port + /agent/send', () => {
  const target = hall(HALL_A, 'trusted-agent-a', CALLBACK_A);
  assert.equal(isTrustedCallback(CALLBACK_A, target), true);
  assert.equal(isTrustedCallback('https://callback-a.example:9000/agent/send', target), false);
  assert.equal(isTrustedCallback('http://other.example:9000/agent/send', target), false);
  assert.equal(isTrustedCallback('http://callback-a.example:9001/agent/send', target), false);
  assert.equal(isTrustedCallback('http://callback-a.example:9000/agent/send/extra', target), false);
  assert.equal(isTrustedCallback('http://callback-a.example:9000/other', target), false);
  assert.equal(isTrustedCallback('file:///tmp/x', target), false);
  assert.equal(isTrustedCallback('not-a-url', target), false);
  assert.equal(isTrustedCallback('', target), false);
  assert.equal(isTrustedCallback(CALLBACK_A, null), false);
  assert.equal(
    isTrustedCallback('http://callback-a.example/agent/send', hall(HALL_A, 'a', 'http://callback-a.example/agent/send')),
    true
  );
});

test('binder replaces context.agent, pins callback and applies the trusted ingress token', () => {
  const binder = createHallBinder({ halls: buildHalls(), logger: logger() });
  const result = binder.bind({
    exhibitionId: HALL_A,
    context: { agent: 'spoofed', replyTo: 'u', groupchat: false, callback: CALLBACK_A }
  });
  assert.equal(result.ok, true);
  assert.equal(result.context.agent, 'trusted-agent-a');
  assert.equal(result.context.callback, CALLBACK_A);
  assert.equal(result.context.ingressToken, 'out-token-hall-a');
  assert.equal(result.context.replyTo, 'u');
});

test('binder uses the configured TO recipient only when context.reply_to is missing', () => {
  const binder = createHallBinder({
    halls: buildHalls({ [HALL_A]: { to: 'fixed-recipient@example.net' } }),
    logger: logger()
  });
  const missingReplyTo = binder.bind({
    exhibitionId: HALL_A,
    context: { replyTo: '', callback: CALLBACK_A }
  });
  assert.equal(missingReplyTo.ok, true);
  assert.equal(missingReplyTo.context.replyTo, 'fixed-recipient@example.net');

  const explicitReplyTo = binder.bind({
    exhibitionId: HALL_A,
    context: { replyTo: 'user@example.com', callback: CALLBACK_A }
  });
  assert.equal(explicitReplyTo.context.replyTo, 'user@example.com');
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
  const pathTrick = binder.bind({ exhibitionId: HALL_A, context: { callback: `${CALLBACK_A}/extra` } });
  assert.equal(pathTrick.status, 403);
});

test('A/B tokens use their own agent, ingress token and reject the other hall callback target', async () => {
  const started = [];
  const { app } = buildApp({ started });

  const acceptedA = await postCommands(app, envelope(CALLBACK_A), TOKEN_A);
  assert.equal(acceptedA.status, 202);
  assert.equal(started[0].context.agent, 'trusted-agent-a');
  assert.equal(started[0].context.ingressToken, 'out-token-hall-a');
  assert.equal(started[0].context.callback, CALLBACK_A);

  const acceptedB = await postCommands(app, envelope(CALLBACK_B), TOKEN_B);
  assert.equal(acceptedB.status, 202);
  assert.equal(started[1].context.agent, 'trusted-agent-b');
  assert.equal(started[1].context.ingressToken, 'out-token-hall-b');
  assert.equal(started[1].context.callback, CALLBACK_B);

  const crossA = await postCommands(app, envelope(CALLBACK_B), TOKEN_A);
  assert.equal(crossA.status, 403);
  assert.equal(crossA.body.error, 'callback target is not allowed for this exhibition');

  const crossB = await postCommands(app, envelope(CALLBACK_A), TOKEN_B);
  assert.equal(crossB.status, 403);

  assert.equal(started.length, 2);
});

test('A/B/C tokens concurrently bind their own agent, ingress host/port and ingress token', async () => {
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
  assert.equal(byAgent.get('trusted-agent-a').ingressToken, 'out-token-hall-a');
  assert.equal(byAgent.get('trusted-agent-b').callback, CALLBACK_B);
  assert.equal(byAgent.get('trusted-agent-b').ingressToken, 'out-token-hall-b');
  assert.equal(byAgent.get('trusted-agent-c').callback, CALLBACK_C);
  assert.equal(byAgent.get('trusted-agent-c').ingressToken, 'out-token-hall-c');

  const crossHall = await postCommands(app, envelope(CALLBACK_C), TOKEN_B);
  assert.equal(crossHall.status, 403);
  assert.equal(started.length, 3);
});

test('body exhibitionId, context agent and callback cannot override token-derived identity', async () => {
  const started = [];
  const { app } = buildApp({ started });

  const spoofed = await postCommands(app, {
    exhibitionId: HALL_A,
    context: {
      exhibitionId: HALL_A,
      agent: 'spoofed-agent',
      reply_to: 'user@example.com',
      groupchat: false,
      callback: CALLBACK_B
    },
    commands: NARRATION
  }, TOKEN_B);

  // Token B wins; callback B is valid for B, body exhibitionId/agent are ignored.
  assert.equal(spoofed.status, 202);
  assert.equal(started[0].exhibitionId, HALL_B);
  assert.equal(started[0].context.agent, 'trusted-agent-b');
  assert.equal(started[0].context.callback, CALLBACK_B);
  assert.equal(started[0].context.ingressToken, 'out-token-hall-b');
});

const BASE_ENV = {
  MQTT_URL: 'mqtts://broker.example:8883',
  MQTT_USERNAME: 'executor',
  MQTT_PASSWORD: 'password',
  MQTT_TOPIC: 'test/topic',
  MQTT_QOS: '0',
  MQTT_RETAIN: 'false'
};

test('readConfig keeps starting when a mapped exhibition lacks ingress binding', () => {
  const base = {
    ...BASE_ENV,
    HC_TOKEN_MAP: `${TOKEN_A}:${HALL_A},${TOKEN_B}:${HALL_B},${TOKEN_C}:${HALL_C}`,
    HC_HALL_HALL_A_AGENT: 'trusted-agent-a',
    HC_HALL_HALL_A_INGRESS_HOST: 'callback-a.example',
    HC_HALL_HALL_A_INGRESS_PORT: '9000',
    HC_HALL_HALL_A_INGRESS_TOKEN: 'out-token-a',
    HC_HALL_HALL_B_AGENT: 'trusted-agent-b',
    HC_HALL_HALL_B_INGRESS_HOST: 'callback-b.example',
    HC_HALL_HALL_B_INGRESS_PORT: '9001',
    HC_HALL_HALL_B_INGRESS_TOKEN: 'out-token-b'
  };
  const partial = readConfig(base);
  assert.deepEqual([...partial.exhibitionHalls.keys()], [HALL_A, HALL_B]);
  assert.deepEqual(partial.exhibitionHallIssues, [
    { exhibitionId: HALL_C, error: 'missing required environment variable: HC_HALL_HALL_C_INGRESS_HOST' }
  ]);
  assert.equal(partial.exhibitionTokens.size, 3);

  const configured = readConfig({
    ...base,
    HC_HALL_HALL_C_AGENT: 'trusted-agent-c',
    HC_HALL_HALL_C_INGRESS_HOST: 'callback-c.example',
    HC_HALL_HALL_C_INGRESS_PORT: '9002',
    HC_HALL_HALL_C_INGRESS_TOKEN: 'out-token-c'
  });
  assert.deepEqual([...configured.exhibitionHalls.keys()], [HALL_A, HALL_B, HALL_C]);
  assert.equal(configured.exhibitionHalls.get(HALL_C).agent, 'trusted-agent-c');
  assert.equal(configured.exhibitionHalls.get(HALL_C).mode, 'isolated');
  assert.equal(configured.exhibitionHalls.get(HALL_C).ingressUrl, 'http://callback-c.example:9002/agent/send');
  assert.deepEqual(configured.exhibitionHallIssues, []);
});

test('readConfig reports shared agents and shared ingress targets without blocking startup', () => {
  const base = {
    ...BASE_ENV,
    HC_TOKEN_MAP: `${TOKEN_A}:${HALL_A},${TOKEN_B}:${HALL_B}`,
    HC_HALL_HALL_A_AGENT: 'shared-agent',
    HC_HALL_HALL_A_INGRESS_HOST: 'callback-a.example',
    HC_HALL_HALL_A_INGRESS_PORT: '9000',
    HC_HALL_HALL_A_INGRESS_TOKEN: 'out-token-a',
    HC_HALL_HALL_B_AGENT: 'shared-agent',
    HC_HALL_HALL_B_INGRESS_HOST: 'callback-b.example',
    HC_HALL_HALL_B_INGRESS_PORT: '9001',
    HC_HALL_HALL_B_INGRESS_TOKEN: 'out-token-b'
  };
  const sharedAgent = readConfig(base);
  assert.equal(sharedAgent.exhibitionHalls.size, 2);
  assert.ok(sharedAgent.exhibitionHallWarnings.some((item) => item.code === 'shared-agent'));

  const sharedTarget = readConfig({
    ...base,
    HC_HALL_HALL_B_AGENT: 'trusted-agent-b',
    HC_HALL_HALL_B_INGRESS_HOST: 'callback-a.example',
    HC_HALL_HALL_B_INGRESS_PORT: '9000'
  });
  assert.equal(sharedTarget.exhibitionHalls.size, 2);
  assert.ok(sharedTarget.exhibitionHallWarnings.some((item) => item.code === 'shared-ingress-target'));
});

test('legacy single-ingress env keeps ordinary commands and narration working', async () => {
  const legacy = readConfig({
    ...BASE_ENV,
    HC_TOKEN_MAP: `${TOKEN_A}:${HALL_A},${TOKEN_B}:${HALL_B}`,
    INGRESS_HOST: 'ruisi-ingress.example',
    INGRESS_PORT: '18080',
    INGRESS_TOKEN: 'legacy-ingress-token'
  });
  assert.deepEqual([...legacy.exhibitionHalls.keys()], [HALL_A, HALL_B]);
  assert.deepEqual(legacy.exhibitionHallIssues, []);
  assert.equal(legacy.exhibitionHalls.get(HALL_A).mode, 'legacy');
  assert.equal(legacy.exhibitionHalls.get(HALL_A).agent, null);

  const started = [];
  const { app, publisher } = buildApp({
    halls: legacy.exhibitionHalls,
    started
  });

  const ordinary = await postCommands(app, [{ action: '切换语言', params: { language: 'en-US' } }], TOKEN_A);
  assert.equal(ordinary.status, 200);
  assert.equal(publisher.calls.length, 1);
  assert.equal(JSON.parse(publisher.calls[0]).exhibitionId, HALL_A);

  const narration = await postCommands(app, envelope('http://ruisi-ingress.example:18080/agent/send', 'agent-a'), TOKEN_B);
  assert.equal(narration.status, 202);
  assert.equal(started[0].exhibitionId, HALL_B);
  assert.equal(started[0].context.agent, 'agent-a');
  assert.equal(started[0].context.ingressToken, 'legacy-ingress-token');

  const crossHall = await postCommands(app, envelope('http://other-ingress.example:18080/agent/send'), TOKEN_A);
  assert.equal(crossHall.status, 403);
});

test('ordinary commands publish even when the hall has no callback configuration', async () => {
  const unbound = readConfig({
    ...BASE_ENV,
    HC_TOKEN_MAP: `${TOKEN_A}:${HALL_A},${TOKEN_B}:${HALL_B}`
  });
  assert.deepEqual([...unbound.exhibitionHalls.keys()], []);
  assert.equal(unbound.exhibitionHallIssues.length, 2);

  const started = [];
  const { app, publisher } = buildApp({ halls: unbound.exhibitionHalls, started });
  const responses = await Promise.all([
    postCommands(app, [{ action: '切换语言', params: { language: 'zh-CN' } }], TOKEN_A),
    postCommands(app, [{ action: '切换语言', params: { language: 'en-US' } }], TOKEN_B)
  ]);
  assert.deepEqual(responses.map((item) => item.status), [200, 200]);
  const published = publisher.calls.map((call) => JSON.parse(call).exhibitionId);
  assert.deepEqual(published.sort(), [HALL_A, HALL_B].sort());

  const narration = await postCommands(app, envelope(CALLBACK_A), TOKEN_A);
  assert.equal(narration.status, 403);
  assert.equal(narration.body.error, 'exhibition callback configuration is missing');
  assert.equal(started.length, 0);
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

test('/health stays anonymous', async () => {
  const { app } = buildApp();
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
  });
});
