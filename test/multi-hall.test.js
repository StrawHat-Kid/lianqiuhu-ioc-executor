const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
const { readConfig } = require('../src/config');
const { createExhibitionAuth } = require('../src/exhibition-auth');
const { createHallBinder } = require('../src/hall-binding');
const { createCommandExecutor } = require('../src/command-executor');
const { createRuisiCallbackClient } = require('../src/ruisi-callback-client');
const { createNarrationSessionManager } = require('../src/narration/narration-session-manager');
const { createDynamicQaHandler } = require('../src/dynamic-qa/dynamic-qa-handler');
const { createApp } = require('../src/server');
const { PARK_BASE_OVERVIEW, PARK_BASE_OVERVIEW_ACTION } = require('../src/narration/narration-definitions');

const TOKEN_A = 'token-a-0123456789abcdef';
const TOKEN_B = 'token-b-0123456789abcdef';
const TOKEN_C = 'token-c-0123456789abcdef';
const HALL_A = 'HC-A7K9P2';
const HALL_B = 'HC-B4M8Q1';
const HALL_C = 'HC-C6N3R5';
const AGENT_A = 'rs-hc-a-agent';
const AGENT_B = 'rs-hc-b-agent';
const AGENT_C = 'rs-hc-c-agent';
const INGRESS_TOKEN_A = 'ingress-token-a';
const INGRESS_TOKEN_B = 'ingress-token-b';
const INGRESS_TOKEN_C = 'ingress-token-c';

function logger() {
  return { info() {}, warn() {}, error() {} };
}

async function mockIngress() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { text += chunk; });
    req.on('end', () => {
      requests.push({ headers: req.headers, body: JSON.parse(text || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    requests,
    host: '127.0.0.1',
    port: server.address().port,
    url: `http://127.0.0.1:${server.address().port}/agent/send`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function buildEnv(ingressA, ingressB, ingressC, overrides = {}) {
  return {
    PORT: '18001',
    MQTT_URL: 'mqtts://broker.example:8883',
    MQTT_USERNAME: 'executor',
    MQTT_PASSWORD: 'password',
    MQTT_TOPIC: 'lianqiuhu/ioc/test/commands',
    MQTT_QOS: '0',
    MQTT_RETAIN: 'false',
    HC_TOKEN_MAP: `${TOKEN_A}:${HALL_A},${TOKEN_B}:${HALL_B},${TOKEN_C}:${HALL_C}`,
    HC_HALL_HC_A7K9P2_AGENT: AGENT_A,
    HC_HALL_HC_A7K9P2_INGRESS_HOST: ingressA.host,
    HC_HALL_HC_A7K9P2_INGRESS_PORT: String(ingressA.port),
    HC_HALL_HC_A7K9P2_INGRESS_TOKEN: INGRESS_TOKEN_A,
    HC_HALL_HC_B4M8Q1_AGENT: AGENT_B,
    HC_HALL_HC_B4M8Q1_INGRESS_HOST: ingressB.host,
    HC_HALL_HC_B4M8Q1_INGRESS_PORT: String(ingressB.port),
    HC_HALL_HC_B4M8Q1_INGRESS_TOKEN: INGRESS_TOKEN_B,
    HC_HALL_HC_C6N3R5_AGENT: AGENT_C,
    HC_HALL_HC_C6N3R5_INGRESS_HOST: ingressC.host,
    HC_HALL_HC_C6N3R5_INGRESS_PORT: String(ingressC.port),
    HC_HALL_HC_C6N3R5_INGRESS_TOKEN: INGRESS_TOKEN_C,
    ...overrides
  };
}

function buildApp(config) {
  const publisher = { calls: [], isConnected: () => true, publish: async (message) => publisher.calls.push(message) };
  const commandExecutor = createCommandExecutor({ publisher, logger: logger(), mqttTopic: config.mqttTopic });
  const callbackClient = createRuisiCallbackClient({ logger: logger(), timeoutMs: 2000 });
  const narrationManager = createNarrationSessionManager({
    commandExecutor,
    callbackClient,
    logger: logger(),
    wait: async () => {}
  });
  const dynamicQaHandler = createDynamicQaHandler({
    commandExecutor,
    callbackClient,
    logger: logger(),
    wait: async () => {},
    getBusinessDate: () => ({ year: 2026, month: 9, day: 8 })
  });
  const app = createApp({
    publisher,
    logger: logger(),
    mqttTopic: config.mqttTopic,
    commandExecutor,
    narrationManager,
    callbackClient,
    dynamicQaHandler,
    exhibitionAuth: createExhibitionAuth({ tokenMap: config.exhibitionTokens, logger: logger() }),
    hallBinder: createHallBinder({ halls: config.exhibitionHalls, logger: logger() })
  });
  return { app, publisher };
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

async function post(app, body, token) {
  return withServer(app, async (baseUrl) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token !== undefined) headers['X-HC-Token'] = token;
    const response = await fetch(`${baseUrl}/api/commands`, {
      method: 'POST', headers, body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  });
}

async function waitFor(predicate, timeoutMs = 4000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function narrationEnvelope(callback, agent = 'spoofed-agent') {
  return {
    context: { agent, reply_to: 'user@example.com', groupchat: false, callback },
    commands: [{ action: PARK_BASE_OVERVIEW_ACTION, params: { language: 'zh-CN' } }]
  };
}

test('A/B/C tokens map to their own trusted agent, ingress target and ingress token', async () => {
  const ingressA = await mockIngress();
  const ingressB = await mockIngress();
  const ingressC = await mockIngress();
  const config = readConfig(buildEnv(ingressA, ingressB, ingressC));
  const { app } = buildApp(config);

  try {
    const responses = await Promise.all([
      post(app, narrationEnvelope(ingressA.url), TOKEN_A),
      post(app, narrationEnvelope(ingressB.url), TOKEN_B),
      post(app, narrationEnvelope(ingressC.url), TOKEN_C)
    ]);
    assert.deepEqual(responses.map((item) => item.status), [202, 202, 202]);

    await waitFor(() => ingressA.requests.length === 1
      && ingressB.requests.length === 1
      && ingressC.requests.length === 1);

    assert.deepEqual(
      [ingressA, ingressB, ingressC].map((ingress) => ({
        agent: ingress.requests[0].body.agent,
        token: ingress.requests[0].headers['x-auth-token'],
        to: ingress.requests[0].body.to
      })),
      [
        { agent: AGENT_A, token: INGRESS_TOKEN_A, to: 'user@example.com' },
        { agent: AGENT_B, token: INGRESS_TOKEN_B, to: 'user@example.com' },
        { agent: AGENT_C, token: INGRESS_TOKEN_C, to: 'user@example.com' }
      ]
    );
  } finally {
    await ingressA.close();
    await ingressB.close();
    await ingressC.close();
  }
});

test('A request never uses B ingress config and cross-hall callback is rejected', async () => {
  const ingressA = await mockIngress();
  const ingressB = await mockIngress();
  const ingressC = await mockIngress();
  const config = readConfig(buildEnv(ingressA, ingressB, ingressC));
  const { app } = buildApp(config);

  try {
    const cross = await post(app, narrationEnvelope(ingressB.url), TOKEN_A);
    assert.equal(cross.status, 403);
    assert.equal(cross.body.error, 'callback target is not allowed for this exhibition');

    const accepted = await post(app, narrationEnvelope(ingressA.url), TOKEN_A);
    assert.equal(accepted.status, 202);
    await waitFor(() => ingressA.requests.length === 1);

    assert.equal(ingressB.requests.length, 0);
    assert.equal(ingressC.requests.length, 0);
    assert.equal(ingressA.requests[0].body.agent, AGENT_A);
  } finally {
    await ingressA.close();
    await ingressB.close();
    await ingressC.close();
  }
});

test('body exhibitionId and spoofed agent cannot override token-derived hall config', async () => {
  const ingressA = await mockIngress();
  const ingressB = await mockIngress();
  const ingressC = await mockIngress();
  const config = readConfig(buildEnv(ingressA, ingressB, ingressC));
  const { app, publisher } = buildApp(config);

  try {
    const response = await post(app, {
      exhibitionId: HALL_A,
      context: {
        exhibitionId: HALL_A,
        agent: 'spoofed-agent',
        reply_to: 'user@example.com',
        groupchat: false,
        callback: ingressB.url
      },
      commands: [{ action: '主题切换', params: { '主题名称': '综合安防' } }]
    }, TOKEN_B);

    assert.equal(response.status, 200);
    assert.equal(JSON.parse(publisher.calls[0]).exhibitionId, HALL_B);
    assert.equal(ingressA.requests.length, 0);
  } finally {
    await ingressA.close();
    await ingressB.close();
    await ingressC.close();
  }
});

test('missing per-hall config fails closed instead of falling back to another hall', async () => {
  const ingressA = await mockIngress();
  const ingressB = await mockIngress();
  const ingressC = await mockIngress();
  try {
    assert.throws(
      () => readConfig(buildEnv(ingressA, ingressB, ingressC, { HC_HALL_HC_C6N3R5_INGRESS_PORT: '' })),
      /HC_HALL_HC_C6N3R5_INGRESS_PORT/
    );
    assert.throws(
      () => readConfig(buildEnv(ingressA, ingressB, ingressC, { HC_HALL_HC_C6N3R5_INGRESS_TOKEN: '' })),
      /HC_HALL_HC_C6N3R5_INGRESS_TOKEN/
    );
    assert.throws(
      () => readConfig(buildEnv(ingressA, ingressB, ingressC, { HC_HALL_HC_C6N3R5_AGENT: '' })),
      /HC_HALL_HC_C6N3R5_AGENT/
    );
  } finally {
    await ingressA.close();
    await ingressB.close();
    await ingressC.close();
  }
});

test('narration and dynamic QA return traffic stay isolated per exhibition', async () => {
  const ingressA = await mockIngress();
  const ingressB = await mockIngress();
  const ingressC = await mockIngress();
  const config = readConfig(buildEnv(ingressA, ingressB, ingressC));
  const { app } = buildApp(config);

  try {
    const narration = await Promise.all([
      post(app, narrationEnvelope(ingressA.url), TOKEN_A),
      post(app, narrationEnvelope(ingressB.url), TOKEN_B)
    ]);
    assert.deepEqual(narration.map((item) => item.status), [202, 202]);
    await waitFor(() => ingressA.requests.length === 1 && ingressB.requests.length === 1);

    const dynamicQa = await Promise.all([
      post(app, {
        context: { agent: 'unused', reply_to: 'qa-user@example.com', groupchat: false, callback: ingressA.url },
        commands: [{ action: '查询累计用电量', params: { day: 7, language: 'zh-CN' } }]
      }, TOKEN_A),
      post(app, {
        context: { agent: 'unused', reply_to: 'qa-user@example.com', groupchat: false, callback: ingressB.url },
        commands: [{ action: '查询累计用电量', params: { day: 7, language: 'zh-CN' } }]
      }, TOKEN_B)
    ]);
    assert.deepEqual(dynamicQa.map((item) => item.status), [200, 200]);
    await waitFor(() => ingressA.requests.length === 2 && ingressB.requests.length === 2);

    assert.deepEqual(
      ingressA.requests.map((item) => [item.body.agent, item.headers['x-auth-token']]),
      [[AGENT_A, INGRESS_TOKEN_A], [AGENT_A, INGRESS_TOKEN_A]]
    );
    assert.deepEqual(
      ingressB.requests.map((item) => [item.body.agent, item.headers['x-auth-token']]),
      [[AGENT_B, INGRESS_TOKEN_B], [AGENT_B, INGRESS_TOKEN_B]]
    );
    assert.equal(ingressC.requests.length, 0);
    assert.equal(PARK_BASE_OVERVIEW.scenario, 'parkBaseOverview');
  } finally {
    await ingressA.close();
    await ingressB.close();
    await ingressC.close();
  }
});

test('ordinary MQTT publishing remains unchanged for each exhibition', async () => {
  const ingressA = await mockIngress();
  const ingressB = await mockIngress();
  const ingressC = await mockIngress();
  const config = readConfig(buildEnv(ingressA, ingressB, ingressC));
  const { app, publisher } = buildApp(config);

  try {
    await post(app, [{ action: '主题切换', params: { '主题名称': '综合安防' } }], TOKEN_A);
    await post(app, [{ action: '主题切换', params: { '主题名称': '能源管理' } }], TOKEN_C);

    assert.deepEqual(publisher.calls.map((message) => JSON.parse(message).exhibitionId), [HALL_A, HALL_C]);
    assert.deepEqual(publisher.calls.map((message) => JSON.parse(message).commands[0].params['主题名称']), ['综合安防', '能源管理']);
    assert.equal(ingressA.requests.length, 0);
    assert.equal(ingressB.requests.length, 0);
    assert.equal(ingressC.requests.length, 0);
  } finally {
    await ingressA.close();
    await ingressB.close();
    await ingressC.close();
  }
});
