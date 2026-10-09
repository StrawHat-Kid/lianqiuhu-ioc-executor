const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { TOKEN_HEADER, parseTokenMap, resolveExhibitionId, createExhibitionAuth } = require('../src/exhibition-auth');

const TOKEN_A = 'test-token-a-0123456789abcdef';
const TOKEN_B = 'test-token-b-0123456789abcdef';
const HALL_A = 'hall-a';
const HALL_B = 'hall-b';
const MAP_RAW = `${TOKEN_A}:${HALL_A},${TOKEN_B}:${HALL_B}`;
const VALID_COMMANDS = [{ action: '主题切换', params: { '主题名称': '综合安防' } }];

function createLogger() {
  return { info() {}, warn() {}, error() {} };
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

function createPublisher() {
  const calls = [];
  return { calls, isConnected: () => true, publish: async (message) => calls.push(message) };
}

function buildApp({ activePublisher = createPublisher(), logger = createLogger(), tokenMap = parseTokenMap(MAP_RAW) } = {}) {
  const app = createApp({
    publisher: activePublisher, logger, mqttTopic: 'test/topic',
    exhibitionAuth: createExhibitionAuth({ tokenMap, logger })
  });
  return { app, publisher: activePublisher };
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

async function postCommands(app, body, headers = {}) {
  return withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  });
}

test('createApp refuses to build without exhibition auth middleware', () => {
  assert.throws(
    () => createApp({ publisher: createPublisher(), logger: createLogger(), mqttTopic: 'test/topic' }),
    /exhibition auth/
  );
});

test('parseTokenMap parses, trims, and supports multiple tokens per exhibition', () => {
  const map = parseTokenMap(` ${TOKEN_A} : ${HALL_A} , ${TOKEN_B}:${HALL_B} `);
  assert.deepEqual([...map.entries()], [[TOKEN_A, HALL_A], [TOKEN_B, HALL_B]]);

  const rotationMap = parseTokenMap(`${TOKEN_A}:${HALL_A},${TOKEN_B}:${HALL_A}`);
  assert.equal(rotationMap.size, 2);
  assert.deepEqual([...rotationMap.values()], [HALL_A, HALL_A]);
});

test('parseTokenMap rejects invalid configuration', () => {
  assert.throws(() => parseTokenMap(''), /HC_TOKEN_MAP/);
  assert.throws(() => parseTokenMap(undefined), /HC_TOKEN_MAP/);
  assert.throws(() => parseTokenMap('token-without-separator'), /format/);
  assert.throws(() => parseTokenMap(`${TOKEN_A}:`), /format/);
  assert.throws(() => parseTokenMap(`:${HALL_A}`), /format/);
  assert.throws(() => parseTokenMap('short:exhibition-a'), /invalid token/);
  assert.throws(() => parseTokenMap('bad token 0123456789abcdef:exhibition-a'), /invalid token/);
  assert.throws(() => parseTokenMap(`${TOKEN_A}:bad hall!`), /invalid exhibitionId/);
  assert.throws(() => parseTokenMap(`${TOKEN_A}:${HALL_A},${TOKEN_A}:${HALL_B}`), /duplicate token/);
  assert.throws(() => parseTokenMap(`${TOKEN_A}:${HALL_A},`), /empty entry/);
});

test('resolveExhibitionId matches exact configured tokens only', () => {
  const map = parseTokenMap(MAP_RAW);
  assert.equal(resolveExhibitionId(TOKEN_A, map), HALL_A);
  assert.equal(resolveExhibitionId(TOKEN_B, map), HALL_B);
  assert.equal(resolveExhibitionId(`  ${TOKEN_A}  `, map), HALL_A);
  assert.equal(resolveExhibitionId('unknown-token-0123456789abcdef', map), null);
  assert.equal(resolveExhibitionId(TOKEN_A.toUpperCase(), map), null);
  assert.equal(resolveExhibitionId('', map), null);
  assert.equal(resolveExhibitionId(undefined, map), null);
  assert.equal(resolveExhibitionId(42, map), null);
});

test('createExhibitionAuth refuses empty or missing token maps', () => {
  assert.throws(() => createExhibitionAuth({}), /token map/);
  assert.throws(() => createExhibitionAuth({ tokenMap: new Map() }), /token map/);
});

test('missing, malformed, and unknown tokens return 401 without publishing', async () => {
  const headerCases = [
    {},
    { [TOKEN_HEADER]: '' },
    { [TOKEN_HEADER]: 'short' },
    { [TOKEN_HEADER]: 'unknown-token-0123456789abcdef' }
  ];
  for (const headers of headerCases) {
    const { app, publisher } = buildApp();
    const result = await postCommands(app, VALID_COMMANDS, headers);
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { ok: false, error: 'unauthorized' });
    assert.equal(publisher.calls.length, 0);
  }
});

test('valid tokens pass through and publish the envelope for their own exhibition', async () => {
  const cases = [[TOKEN_A, HALL_A], [TOKEN_B, HALL_B]];
  for (const [token, expectedHall] of cases) {
    const { app, publisher } = buildApp();
    const result = await postCommands(app, VALID_COMMANDS, { [TOKEN_HEADER]: token });
    assert.equal(result.status, 200);
    assert.equal(publisher.calls.length, 1);
    assert.deepEqual(publisher.calls.map((message) => JSON.parse(message)), [
      { exhibitionId: expectedHall, commands: VALID_COMMANDS }
    ]);
  }
});

test('request body exhibitionId is ignored and logged without overriding the mapping', async () => {
  const logger = createCaptureLogger();
  const { app, publisher } = buildApp({ logger });
  const result = await postCommands(app, { commands: VALID_COMMANDS, exhibitionId: HALL_B }, { [TOKEN_HEADER]: TOKEN_A });
  assert.equal(result.status, 200);
  assert.equal(publisher.calls.length, 1);
  assert.equal(JSON.parse(publisher.calls[0]).exhibitionId, HALL_A);
  assert.ok(logger.entries.some((entry) => entry.message.includes('忽略请求体中的exhibitionId')));
});

test('auth failures never log the presented token', async () => {
  const logger = createCaptureLogger();
  const { app, publisher } = buildApp({ logger });
  const leakedToken = 'leaked-token-0123456789abcdef';
  const result = await postCommands(app, VALID_COMMANDS, { [TOKEN_HEADER]: leakedToken });
  assert.equal(result.status, 401);
  assert.equal(publisher.calls.length, 0);
  assert.equal(JSON.stringify(logger.entries).includes(leakedToken), false);
  assert.ok(logger.entries.some((entry) => entry.details?.reason === 'invalid_token'));
});

test('/health remains available without a token', async () => {
  const { app } = buildApp();
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
  });
});
