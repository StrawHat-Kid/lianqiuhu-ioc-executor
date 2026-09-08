const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { HC_INTRO_DELAY_MS } = require('../src/hc-return-timing');
const {
  DYNAMIC_QA_ACTION_DEFINITIONS, WORK_ORDER_DATA
} = require('../src/dynamic-qa/dynamic-qa-definitions');
const {
  DYNAMIC_QA_ACTIONS, normalizeDynamicQaLanguage, validateDynamicQaCommand, createDynamicQaHandler
} = require('../src/dynamic-qa/dynamic-qa-handler');
const { buildDynamicQaAnswer } = require('../src/dynamic-qa/dynamic-qa-answer-builder');
const { getHcBusinessDate } = require('../src/hc-business-date');
const {
  PARK_BASE_OVERVIEW, PARK_REALTIME_NARRATION, SECURITY_REALTIME_NARRATION, ENERGY_REALTIME_NARRATION
} = require('../src/narration/narration-definitions');

function logger() { return { info() {}, warn() {}, error() {} }; }
function fixedHcBusinessDate() { return { year: 2026, month: 9, day: 8 }; }
function publisher() {
  const calls = [];
  return { calls, isConnected: () => true, publish: async (message) => calls.push(message) };
}
function callbackClient() {
  const calls = [];
  return { calls, sendAgentMessage: async (context, options) => { calls.push({ context, options }); return { ok: true, status: 200 }; } };
}
function commandExecutor() {
  const calls = [];
  return {
    calls,
    publishFrontendCommands: async (commands, meta) => {
      calls.push({ commands, meta });
      return { ok: true, status: 200 };
    }
  };
}
function controlledWait() {
  const calls = [];
  const pending = [];
  return {
    calls,
    wait: (ms) => new Promise((resolve) => { calls.push(ms); pending.push(resolve); }),
    releaseNext: () => {
      const resolve = pending.shift();
      assert.ok(resolve, 'expected a pending dynamic QA wait');
      resolve();
    }
  };
}
async function eventually(predicate) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(predicate(), 'expected asynchronous operation to complete');
}
function envelope(action, params, context = {}) {
  return {
    context: { agent: 'dynamic-agent', reply_to: 'dynamic-user@example.com', groupchat: false, callback: 'http://127.0.0.1:29876/agent/send', ...context },
    commands: [{ action, params }]
  };
}
async function post(body, dependencies = {}) {
  const activePublisher = dependencies.publisher || publisher();
  const activeCallback = dependencies.callbackClient || callbackClient();
  const app = createApp({
    publisher: activePublisher, logger: logger(), mqttTopic: 'test/topic', callbackClient: activeCallback,
    dynamicQaWait: dependencies.dynamicQaWait || (async () => {}),
    dynamicQaGetBusinessDate: dependencies.getBusinessDate || fixedHcBusinessDate
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/commands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json(), publisher: activePublisher, callbackClient: activeCallback };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
function validatedAnswer(action, params) {
  const validated = validateDynamicQaCommand({ action, params });
  assert.equal(validated.error, undefined);
  return buildDynamicQaAnswer(validated.value, { getBusinessDate: fixedHcBusinessDate });
}
function normalizedContext() {
  return { agent: 'dynamic-agent', replyTo: 'dynamic-user@example.com', groupchat: false, callback: 'http://127.0.0.1:29876/agent/send' };
}

test('dynamic QA formal action set contains exactly the ten structured actions', () => {
  assert.deepEqual([...DYNAMIC_QA_ACTIONS].sort(), [
    '查询单日新增用能', '查询处理中工单', '查询已关闭工单', '查询年度等效节能', '查询待处理工单',
    '查询工单处理情况', '查询节能达成率', '查询累计用气量', '查询累计用水量', '查询累计用电量'
  ].sort());
  assert.equal(DYNAMIC_QA_ACTION_DEFINITIONS['查询用能管理'], undefined);
  assert.equal(DYNAMIC_QA_ACTION_DEFINITIONS['查询工单处理统计'], undefined);
});

test('dynamic QA language is required and normalized only from params.language', () => {
  assert.equal(normalizeDynamicQaLanguage('zh'), 'zh-CN');
  assert.equal(normalizeDynamicQaLanguage('zh-CN'), 'zh-CN');
  assert.equal(normalizeDynamicQaLanguage('en'), 'en-US');
  assert.equal(normalizeDynamicQaLanguage('en-US'), 'en-US');
  assert.throws(() => normalizeDynamicQaLanguage('fr-FR'), /language/);
  assert.match(validateDynamicQaCommand({ action: '查询累计用电量', params: { day: 7 } }).error, /language/);
});

test('HC business date derives calendar fields from Asia/Shanghai instead of the server default time zone', () => {
  assert.deepEqual(getHcBusinessDate(new Date('2026-09-07T16:30:00.000Z')), { year: 2026, month: 9, day: 8 });
});

test('energy actions return the formal day values and reference averages without natural-language parsing', () => {
  const cases = [
    ['查询累计用气量', { day: 7, language: 'zh-CN' }, '本月第7日累计用气量为5418.9立方米。'],
    ['查询累计用气量', { language: 'zh-CN' }, '本月累计用气量的参考平均值为12,396.30立方米。'],
    ['查询累计用水量', { day: 6, language: 'zh-CN' }, '本月第6日累计用水量为16612.1立方米。'],
    ['查询累计用电量', { day: 7, language: 'zh-CN' }, '本月第7日累计用电量为13.97吉瓦时。'],
    ['查询累计用电量', { day: 7, language: 'en-US' }, 'The electricity consumption on day 7 was 13.97 gigawatt-hours.'],
    ['查询累计用电量', { language: 'zh-CN' }, '本月累计用电量的参考平均值为32.26吉瓦时。'],
    ['查询节能达成率', { day: 8, language: 'zh-CN' }, '本月第8日节能达成率为98.7%。'],
    ['查询节能达成率', { language: 'zh-CN' }, '本月节能达成率的参考平均值为97.44%。']
  ];
  for (const [action, params, expected] of cases) assert.equal(validatedAnswer(action, params), expected);
});

test('fixed energy actions keep annual and single-day-incremental answers in both languages', () => {
  assert.equal(validatedAnswer('查询年度等效节能', { language: 'zh-CN' }), '年度等效节能为15.9%。');
  assert.equal(validatedAnswer('查询年度等效节能', { language: 'en-US' }), 'Annual equivalent energy saving is 15.9%.');
  assert.equal(validatedAnswer('查询单日新增用能', { language: 'zh-CN' }), '当前仅提供本月累计用气量、累计用水量和累计用电量，不提供单日新增用量。');
  assert.equal(validatedAnswer('查询单日新增用能', { language: 'en-US' }), 'Only month-to-date cumulative gas, water, and electricity consumption is available. Single-day incremental consumption is not provided.');
});

test('work-order actions return September, November, and reference values without month text parsing', () => {
  const cases = [
    ['查询处理中工单', { month: 9, language: 'zh-CN' }, '9月处理中工单有5312单。'],
    ['查询处理中工单', { language: 'zh-CN' }, '月度处理中工单的参考平均值为5,576.25单。'],
    ['查询待处理工单', { month: 9, language: 'zh-CN' }, '9月待处理工单有278单。'],
    ['查询待处理工单', { language: 'zh-CN' }, '月度待处理工单的参考平均值为329.83单。'],
    ['查询已关闭工单', { month: 9, language: 'en-US' }, 'There were 145 service tickets closed in September.'],
    ['查询已关闭工单', { month: 8, language: 'zh-CN' }, '8月已关闭工单有194单。'],
    ['查询已关闭工单', { language: 'zh-CN' }, '月度已关闭工单的参考平均值为165.83单。'],
    ['查询工单处理情况', { month: 9, language: 'zh-CN' }, '9月工单处理情况为：处理中5312单、待处理278单、已关闭145单。'],
    ['查询工单处理情况', { language: 'en-US' }, 'The reference monthly averages are 5,576.25 processing service tickets, 329.83 pending service tickets, and 165.83 closed service tickets.']
  ];
  for (const [action, params, expected] of cases) assert.equal(validatedAnswer(action, params), expected);
  assert.equal(WORK_ORDER_DATA[9].closed, 145);
  assert.equal(WORK_ORDER_DATA[11].closed, 165);
});

test('future daily energy queries return the same simulated values as last-year reference data in Chinese and English', () => {
  const cases = [
    ['查询累计用气量', { day: 20, language: 'zh-CN' }, '您查询的日期尚未到达，当前暂无该日期的本月累计用气数据。作为参考，去年同期9月20日的累计用气量为15498.1立方米。'],
    ['查询累计用水量', { day: 20, language: 'zh-CN' }, '您查询的日期尚未到达，当前暂无该日期的本月累计用水数据。作为参考，去年同期9月20日的累计用水量为55431.1立方米。'],
    ['查询累计用电量', { day: 20, language: 'zh-CN' }, '您查询的日期尚未到达，当前暂无该日期的本月累计用电数据。作为参考，去年同期9月20日的累计用电量为40.18吉瓦时。'],
    ['查询节能达成率', { day: 20, language: 'zh-CN' }, '您查询的日期尚未到达，当前暂无该日期的本月节能达成率数据。作为参考，去年同期9月20日的节能达成率为97.6%。'],
    ['查询累计用气量', { day: 20, language: 'en-US' }, 'The date you asked about has not yet arrived, so current-period cumulative gas consumption data for that date is not yet available. For reference, the cumulative gas consumption for the same period last year, on September 20, was 15498.1 cubic meters.'],
    ['查询累计用水量', { day: 20, language: 'en-US' }, 'The date you asked about has not yet arrived, so current-period cumulative water consumption data for that date is not yet available. For reference, the cumulative water consumption for the same period last year, on September 20, was 55431.1 cubic meters.'],
    ['查询累计用电量', { day: 20, language: 'en-US' }, 'The date you asked about has not yet arrived, so current-period cumulative electricity consumption data for that date is not yet available. For reference, the cumulative electricity consumption for the same period last year, on September 20, was 40.18 gigawatt-hours.'],
    ['查询节能达成率', { day: 20, language: 'en-US' }, 'The date you asked about has not yet arrived, so the current-period energy-saving achievement rate for that date is not yet available. For reference, the energy-saving achievement rate for the same period last year, on September 20, was 97.6 percent.']
  ];
  for (const [action, params, expected] of cases) assert.equal(validatedAnswer(action, params), expected);
});

test('past and current daily energy queries keep the current-period wording', () => {
  assert.equal(validatedAnswer('查询累计用电量', { day: 7, language: 'zh-CN' }), '本月第7日累计用电量为13.97吉瓦时。');
  assert.equal(validatedAnswer('查询累计用电量', { day: 8, language: 'zh-CN' }), '本月第8日累计用电量为16.05吉瓦时。');
});

test('future monthly work-order queries return last-year reference data in Chinese and English', () => {
  const cases = [
    ['查询处理中工单', { month: 10, language: 'zh-CN' }, '您查询的月份尚未到达，当前暂无该月份的工单统计数据。作为参考，去年同期10月处理中工单有4890单。'],
    ['查询待处理工单', { month: 10, language: 'zh-CN' }, '您查询的月份尚未到达，当前暂无该月份的工单统计数据。作为参考，去年同期10月待处理工单有195单。'],
    ['查询已关闭工单', { month: 10, language: 'zh-CN' }, '您查询的月份尚未到达，当前暂无该月份的工单统计数据。作为参考，去年同期10月已关闭工单有112单。'],
    ['查询工单处理情况', { month: 10, language: 'zh-CN' }, '您查询的月份尚未到达，当前暂无该月份的工单统计数据。作为参考，去年同期10月工单处理情况为：处理中4890单、待处理195单、已关闭112单。'],
    ['查询处理中工单', { month: 10, language: 'en-US' }, 'The month you asked about has not yet arrived, so service-ticket statistics for that month are not yet available. For reference, there were 4890 processing service tickets in October during the same period last year.'],
    ['查询待处理工单', { month: 10, language: 'en-US' }, 'The month you asked about has not yet arrived, so service-ticket statistics for that month are not yet available. For reference, there were 195 pending service tickets in October during the same period last year.'],
    ['查询已关闭工单', { month: 10, language: 'en-US' }, 'The month you asked about has not yet arrived, so service-ticket statistics for that month are not yet available. For reference, there were 112 closed service tickets in October during the same period last year.'],
    ['查询工单处理情况', { month: 10, language: 'en-US' }, 'The month you asked about has not yet arrived, so service-ticket statistics for that month are not yet available. For reference, during the same period last year in October, there were 4890 processing service tickets, 195 pending service tickets, and 112 closed service tickets.']
  ];
  for (const [action, params, expected] of cases) assert.equal(validatedAnswer(action, params), expected);
});

test('past and current work-order months keep the current-period wording', () => {
  assert.equal(validatedAnswer('查询待处理工单', { month: 8, language: 'zh-CN' }), '8月待处理工单有326单。');
  assert.equal(validatedAnswer('查询待处理工单', { month: 9, language: 'zh-CN' }), '9月待处理工单有278单。');
});

test('day is optional but must be an integer from 1 through 31 for daily energy actions', () => {
  for (const day of [0, 32, 7.5, '7']) {
    assert.match(validateDynamicQaCommand({ action: '查询累计用电量', params: { day, language: 'zh-CN' } }).error, /day/);
  }
  assert.equal(validateDynamicQaCommand({ action: '查询累计用电量', params: { language: 'zh-CN' } }).error, undefined);
});

test('month is optional but must be an integer from 1 through 12 for work-order actions', () => {
  for (const month of [0, 13, 9.5, '9']) {
    assert.match(validateDynamicQaCommand({ action: '查询待处理工单', params: { month, language: 'zh-CN' } }).error, /month/);
  }
  assert.equal(validateDynamicQaCommand({ action: '查询待处理工单', params: { language: 'zh-CN' } }).error, undefined);
});

test('new protocol rejects question, businessDate, and unused day or month parameters', () => {
  const invalidCommands = [
    { action: '查询累计用电量', params: { question: '今天累计用电量是多少？', language: 'zh-CN' } },
    { action: '查询累计用电量', params: { businessDate: '2026-09-07', language: 'zh-CN' } },
    { action: '查询年度等效节能', params: { day: 7, language: 'zh-CN' } },
    { action: '查询单日新增用能', params: { month: 9, language: 'zh-CN' } },
    { action: '查询处理中工单', params: { day: 7, language: 'zh-CN' } }
  ];
  for (const command of invalidCommands) assert.match(validateDynamicQaCommand(command).error, /only supports/);
});

test('validated dynamic QA commands retain only action metadata, language, and the declared temporal parameter', () => {
  assert.deepEqual(validateDynamicQaCommand({
    action: '查询累计用电量', params: { day: 7, language: 'zh' }
  }).value, {
    action: '查询累计用电量', kind: 'energy', metric: 'electricity', status: undefined, language: 'zh-CN', day: 7
  });
  assert.deepEqual(validateDynamicQaCommand({
    action: '查询待处理工单', params: { language: 'en' }
  }).value, {
    action: '查询待处理工单', kind: 'workOrder', metric: undefined, status: 'pending', language: 'en-US', month: undefined
  });
});

test('fixed actions accept language only and do not require a date dimension', () => {
  for (const action of ['查询年度等效节能', '查询单日新增用能']) {
    assert.equal(validateDynamicQaCommand({ action, params: { language: 'zh-CN' } }).error, undefined);
  }
});

test('Chinese electricity HTTP ingress publishes exactly two IOC commands and callbacks the structured answer', async () => {
  const result = await post(envelope('查询累计用电量', { day: 7, language: 'zh-CN' }));
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.publisher.calls[0]), [
    { action: 'executeCapability', params: { capability: 'global.language', command: 'set', language: 'zh-CN' } },
    { action: '主题切换', params: { '主题名称': '综合态势' } }
  ]);
  assert.equal(result.publisher.calls.length, 1);
  assert.equal(result.callbackClient.calls[0].options.body, '本月第7日累计用电量为13.97吉瓦时。');
});

test('English closed-ticket HTTP ingress publishes exactly two IOC commands and callbacks the structured answer', async () => {
  const result = await post(envelope('查询已关闭工单', { month: 9, language: 'en-US' }));
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.publisher.calls[0]), [
    { action: 'executeCapability', params: { capability: 'global.language', command: 'set', language: 'en-US' } },
    { action: '主题切换', params: { '主题名称': '综合态势' } }
  ]);
  assert.equal(result.callbackClient.calls[0].options.body, 'There were 145 service tickets closed in September.');
});

test('language aliases normalize the actual IOC command and callback answer', async () => {
  const result = await post(envelope('查询年度等效节能', { language: 'en' }));
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.publisher.calls[0])[0].params.language, 'en-US');
  assert.equal(result.callbackClient.calls[0].options.body, 'Annual equivalent energy saving is 15.9%.');
});

test('HTTP ingress returns reference averages when day or month is absent', async () => {
  const electricity = await post(envelope('查询累计用电量', { language: 'zh-CN' }));
  assert.equal(electricity.status, 200);
  assert.equal(electricity.callbackClient.calls[0].options.body, '本月累计用电量的参考平均值为32.26吉瓦时。');
  const pending = await post(envelope('查询待处理工单', { language: 'zh-CN' }));
  assert.equal(pending.status, 200);
  assert.equal(pending.callbackClient.calls[0].options.body, '月度待处理工单的参考平均值为329.83单。');
});

test('future energy dynamic QA publishes IOC immediately and callbacks once after the shared opening delay', async () => {
  const executor = commandExecutor();
  const callback = callbackClient();
  const clock = controlledWait();
  const handler = createDynamicQaHandler({ commandExecutor: executor, callbackClient: callback, logger: logger(), wait: clock.wait, getBusinessDate: fixedHcBusinessDate });
  const command = validateDynamicQaCommand({ action: '查询累计用电量', params: { day: 20, language: 'zh-CN' } }).value;
  const execution = handler.execute({ command, context: normalizedContext(), requestId: 'energy-delay-test' });

  await eventually(() => executor.calls.length === 1 && clock.calls.length === 1);
  assert.deepEqual(executor.calls[0].commands, [
    { action: 'executeCapability', params: { capability: 'global.language', command: 'set', language: 'zh-CN' } },
    { action: '主题切换', params: { '主题名称': '综合态势' } }
  ]);
  assert.deepEqual(clock.calls, [HC_INTRO_DELAY_MS]);
  assert.equal(callback.calls.length, 0);
  clock.releaseNext();
  await execution;
  assert.equal(callback.calls.length, 1);
  assert.equal(callback.calls[0].options.body, '您查询的日期尚未到达，当前暂无该日期的本月累计用电数据。作为参考，去年同期9月20日的累计用电量为40.18吉瓦时。');
});

test('future work-order dynamic QA publishes IOC immediately and callbacks once after the shared opening delay', async () => {
  const executor = commandExecutor();
  const callback = callbackClient();
  const clock = controlledWait();
  const handler = createDynamicQaHandler({ commandExecutor: executor, callbackClient: callback, logger: logger(), wait: clock.wait, getBusinessDate: fixedHcBusinessDate });
  const command = validateDynamicQaCommand({ action: '查询待处理工单', params: { month: 10, language: 'en-US' } }).value;
  const execution = handler.execute({ command, context: normalizedContext(), requestId: 'work-order-delay-test' });

  await eventually(() => executor.calls.length === 1 && clock.calls.length === 1);
  assert.deepEqual(executor.calls[0].commands, [
    { action: 'executeCapability', params: { capability: 'global.language', command: 'set', language: 'en-US' } },
    { action: '主题切换', params: { '主题名称': '综合态势' } }
  ]);
  assert.deepEqual(clock.calls, [HC_INTRO_DELAY_MS]);
  assert.equal(callback.calls.length, 0);
  clock.releaseNext();
  await execution;
  assert.equal(callback.calls.length, 1);
  assert.equal(callback.calls[0].options.body, 'The month you asked about has not yet arrived, so service-ticket statistics for that month are not yet available. For reference, there were 195 pending service tickets in October during the same period last year.');
});

test('HTTP rejects invalid new parameters and retired actions without MQTT or callback', async () => {
  const cases = [
    envelope('查询累计用电量', { day: 0, language: 'zh-CN' }),
    envelope('查询待处理工单', { month: 13, language: 'zh-CN' }),
    envelope('查询累计用电量', { day: 7, language: 'fr-FR' }),
    envelope('查询累计用电量', { question: '今天累计用电量是多少？', language: 'zh-CN' }),
    envelope('查询用能管理', { question: '今天累计用电量是多少？', language: 'zh-CN', businessDate: '2026-09-07' }),
    envelope('查询工单处理统计', { question: '本月待处理工单有多少？', language: 'zh-CN' })
  ];
  for (const input of cases) {
    const result = await post(input);
    assert.equal(result.status, 400);
    assert.equal(result.publisher.calls.length, 0);
    assert.equal(result.callbackClient.calls.length, 0);
  }
});

test('dynamic QA requires the existing callback-ready context before publishing IOC commands', async () => {
  const result = await post({
    context: { agent: 'dynamic-agent', reply_to: 'dynamic-user@example.com' },
    commands: [{ action: '查询累计用电量', params: { day: 7, language: 'zh-CN' } }]
  });
  assert.equal(result.status, 400);
  assert.equal(result.publisher.calls.length, 0);
  assert.equal(result.callbackClient.calls.length, 0);
});

test('dynamic QA and all production Narrations share the HC opening delay', () => {
  assert.equal(HC_INTRO_DELAY_MS, 12000);
  for (const definition of [PARK_BASE_OVERVIEW, PARK_REALTIME_NARRATION, SECURITY_REALTIME_NARRATION, ENERGY_REALTIME_NARRATION]) {
    assert.equal(definition.introDelayMs, HC_INTRO_DELAY_MS);
  }
});

test('ordinary IOC action remains on its existing command path', async () => {
  const result = await post([{ action: '启动园区总览', params: {} }]);
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.publisher.calls[0]), [
    { action: '主题切换', params: { '主题名称': '综合态势' } },
    { action: 'executeCapability', params: { capability: 'situation.parkOverview', command: 'start' } }
  ]);
  assert.equal(result.callbackClient.calls.length, 0);
});
