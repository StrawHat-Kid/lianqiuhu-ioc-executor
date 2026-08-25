const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCommandRequest } = require('../src/command-request');
const { createApp } = require('../src/server');

function createPublisher() {
  const calls = [];
  return { calls, isConnected: () => true, publish: async (message) => calls.push(message) };
}

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

async function postCommands(body, { logger = createLogger(), narrationManager } = {}) {
  const publisher = createPublisher();
  const app = createApp({ publisher, logger, mqttTopic: 'test/topic', narrationManager });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/commands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { response, body: await response.json(), publisher, logger };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('legacy command arrays normalize without copying or context', () => {
  const commands = [{ action: '启动园区总览', params: {} }];
  const normalized = normalizeCommandRequest(commands);
  assert.equal(normalized.context, null);
  assert.equal(normalized.commands, commands);
});

test('context envelope normalizes camelCase fields, defaults groupchat, and preserves timestamp', () => {
  const envelope = {
    context: {
      agent: 'hc-demo-agent', reply_to: 'user@example.com', callback: 'http://127.0.0.1:29876/agent/send',
      timestamp: '2026-08-24T16:00:00Z'
    },
    commands: [{ action: '启动园区总览', params: {} }]
  };
  const normalized = normalizeCommandRequest(envelope);
  assert.deepEqual(normalized.context, {
    agent: 'hc-demo-agent', replyTo: 'user@example.com', groupchat: false,
    callback: 'http://127.0.0.1:29876/agent/send', timestamp: '2026-08-24T16:00:00Z'
  });
  assert.notEqual(normalized.context, envelope.context);
  assert.equal(Object.isFrozen(normalized.context), true);
  assert.equal(normalized.commands, envelope.commands);
});

test('envelope validation rejects malformed commands and context fields', () => {
  assert.throws(() => normalizeCommandRequest({ commands: {} }), /commands must be an array/);
  assert.throws(() => normalizeCommandRequest({ context: { groupchat: 'false' }, commands: [] }), /groupchat/);
  assert.throws(() => normalizeCommandRequest({ context: { callback: 'file:///tmp/x' }, commands: [] }), /http/);
  assert.throws(() => normalizeCommandRequest({ context: { reply_to: '' }, commands: [] }), /reply_to/);
});

test('legacy HTTP array continues through the existing semantic translator and MQTT publish chain', async () => {
  const result = await postCommands([{ action: '启动园区总览', params: {} }]);
  assert.equal(result.response.status, 200);
  assert.deepEqual(JSON.parse(result.publisher.calls[0]), [
    { action: '主题切换', params: { '主题名称': '综合态势' } },
    { action: 'executeCapability', params: { capability: 'situation.parkOverview', command: 'start' } }
  ]);
});

test('context envelope executes commands through the same translator and does not publish context', async () => {
  const result = await postCommands({
    context: { agent: 'hc-test-agent', reply_to: 'hc-test-user@example.com', callback: 'http://127.0.0.1:29876/agent/send' },
    commands: [{ action: '启动园区总览', params: {} }]
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.publisher.calls.length, 1);
  assert.equal(result.publisher.calls[0].includes('hc-test-agent'), false);
  assert.equal(result.publisher.calls[0].includes('callback'), false);
});

test('third-party AI actions have identical legacy and envelope MQTT output without callback', async () => {
  const cases = [
    ['启动安防第三方AI', [
      { action: '主题切换', params: { '主题名称': '综合安防' } },
      { action: 'executeCapability', params: { capability: 'security.thirdPartyAgent', command: 'start' } }
    ]],
    ['取消安防第三方AI', [
      { action: 'executeCapability', params: { capability: 'security.thirdPartyAgent', command: 'cancel' } }
    ]],
    ['启动能耗第三方AI', [
      { action: '主题切换', params: { '主题名称': '能源管理' } },
      { action: 'executeCapability', params: { capability: 'energy.thirdPartyAgent', command: 'start' } }
    ]],
    ['取消能耗第三方AI', [
      { action: 'executeCapability', params: { capability: 'energy.thirdPartyAgent', command: 'cancel' } }
    ]]
  ];
  for (const [action, expected] of cases) {
    const legacy = await postCommands([{ action, params: {} }]);
    const envelope = await postCommands({
      context: { agent: 'unused-agent', reply_to: 'unused@example.com', callback: 'http://127.0.0.1:29876/agent/send' },
      commands: [{ action, params: {} }]
    });
    assert.equal(legacy.response.status, 200, action);
    assert.equal(envelope.response.status, 200, action);
    assert.deepEqual(JSON.parse(legacy.publisher.calls[0]), expected, action);
    assert.equal(envelope.publisher.calls[0], legacy.publisher.calls[0], action);
    assert.doesNotMatch(envelope.publisher.calls[0], /unused-agent|callback/);
  }
});

test('HTTP rejects envelope commands that are not arrays', async () => {
  const result = await postCommands({ context: {}, commands: {} });
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /commands must be an array/);
  assert.equal(result.publisher.calls.length, 0);
});

test('Narration旧数组400会记录请求体、请求ID和缺少context原因', async () => {
  const logger = createCaptureLogger();
  const result = await postCommands([{ action: '讲解园区基础底数', params: { language: 'zh-CN' } }], { logger });
  assert.equal(result.response.status, 400);
  const rejected = logger.entries.find((entry) => entry.message.includes('请求被拒绝'));
  assert.match(rejected.message, /必须携带context上下文/);
  assert.equal(rejected.details.bodyType, '旧数组模式');
  assert.match(rejected.details.requestId, /^req-/);
  assert.ok(logger.entries.some((entry) => entry.message.includes('请求体') && Array.isArray(entry.details.body)));
});

test('Narration信封缺callback会明确记录context.callback缺失', async () => {
  const logger = createCaptureLogger();
  const result = await postCommands({
    context: { agent: 'test-agent', reply_to: 'test-user', groupchat: false },
    commands: [{ action: '讲解园区基础底数', params: { language: 'zh-CN' } }]
  }, { logger });
  assert.equal(result.response.status, 400);
  assert.ok(logger.entries.some((entry) => entry.message.includes('context.callback缺失')));
  const contextEntry = logger.entries.find((entry) => entry.message.includes('context字段'));
  assert.equal(contextEntry.details.context.callback, '缺失');
});

test('完整Narration信封返回202并把requestId传入会话准入', async () => {
  const logger = createCaptureLogger();
  const calls = [];
  const narrationManager = {
    startNarration(input) {
      calls.push(input);
      return { ok: true, session: { id: 'session-log-test' } };
    }
  };
  const result = await postCommands({
    context: { agent: 'test-agent', reply_to: 'test-user', groupchat: false, callback: 'http://127.0.0.1:29876/agent/send' },
    commands: [{ action: '讲解园区基础底数', params: { language: 'zh-CN' } }]
  }, { logger, narrationManager });
  assert.equal(result.response.status, 202);
  assert.match(calls[0].requestId, /^req-/);
  assert.ok(logger.entries.some((entry) => entry.message.includes('准入成功') && entry.details.sessionId === 'session-log-test'));
});

test('普通第三方AI旧数组200会记录无需RUISI回程', async () => {
  const logger = createCaptureLogger();
  const result = await postCommands([{ action: '启动安防第三方AI', params: {} }], { logger });
  assert.equal(result.response.status, 200);
  assert.ok(logger.entries.some((entry) => entry.message.includes('无需RUISI回程')));
});
