const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { WORK_ORDER_DATA } = require('../src/dynamic-qa/dynamic-qa-definitions');
const {
  normalizeDynamicQaLanguage, parseBusinessDate, parseEnergyQuestion, parseWorkOrderQuestion,
  buildEnergyAnswer, buildWorkOrderAnswer
} = require('../src/dynamic-qa/dynamic-qa-parser');

function logger() { return { info() {}, warn() {}, error() {} }; }
function publisher() {
  const calls = [];
  return { calls, isConnected: () => true, publish: async (message) => calls.push(message) };
}
function callbackClient() {
  const calls = [];
  return { calls, sendAgentMessage: async (context, options) => { calls.push({ context, options }); return { ok: true, status: 200 }; } };
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
  const app = createApp({ publisher: activePublisher, logger: logger(), mqttTopic: 'test/topic', callbackClient: activeCallback });
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

test('dynamic QA language aliases normalize only from params.language', () => {
  assert.equal(normalizeDynamicQaLanguage('zh'), 'zh-CN');
  assert.equal(normalizeDynamicQaLanguage('zh-CN'), 'zh-CN');
  assert.equal(normalizeDynamicQaLanguage('en'), 'en-US');
  assert.equal(normalizeDynamicQaLanguage('en-US'), 'en-US');
  assert.throws(() => normalizeDynamicQaLanguage('fr-FR'), /language/);
});

test('energy parser answers explicit Chinese days and annual equivalent energy saving', () => {
  const cases = [
    ['本月第7日累计用电量是多少？', '本月第7日累计用电量为13.97吉瓦时。'],
    ['本月第16日累计用水量是多少？', '本月第16日累计用水量为44345.8立方米。'],
    ['本月第31日累计用气量是多少？', '本月第31日累计用气量为24037.4立方米。'],
    ['本月第11日节能达成率是多少？', '本月第11日节能达成率为99.4%。']
  ];
  for (const [question, expected] of cases) assert.equal(buildEnergyAnswer(parseEnergyQuestion(question, null), 'zh-CN'), expected);
  assert.equal(buildEnergyAnswer(parseEnergyQuestion('年度等效节能是多少？', null), 'zh-CN'), '年度等效节能为15.9%。');
});

test('energy relative dates use only a valid businessDate and otherwise use reference averages', () => {
  assert.deepEqual(parseBusinessDate('2026-09-07'), { year: 2026, month: 9, day: 7 });
  assert.equal(parseBusinessDate('2026-02-29'), null);
  assert.equal(buildEnergyAnswer(parseEnergyQuestion('今天累计用电量是多少？', parseBusinessDate('2026-09-07')), 'zh-CN'), '本月第7日累计用电量为13.97吉瓦时。');
  assert.equal(buildEnergyAnswer(parseEnergyQuestion('今天累计用电量是多少？', null), 'zh-CN'), '本月累计用电量的参考平均值为32.26吉瓦时。');
  assert.equal(buildEnergyAnswer(parseEnergyQuestion('今天累计用电量是多少？', parseBusinessDate('abc')), 'zh-CN'), '本月累计用电量的参考平均值为32.26吉瓦时。');
});

test('energy parser uses formal English answers and never turns cumulative data into a daily increment', () => {
  assert.equal(buildEnergyAnswer(parseEnergyQuestion('What was the gas consumption on day 7?', null), 'en-US'), 'The gas consumption on day 7 was 5418.9 cubic meters.');
  assert.equal(buildEnergyAnswer(parseEnergyQuestion("What is today's cumulative electricity consumption?", parseBusinessDate('2026-09-07')), 'en-US'), 'The month-to-date cumulative electricity consumption on day 7 is 13.97 gigawatt-hours.');
  assert.equal(buildEnergyAnswer(parseEnergyQuestion('What is the annual equivalent energy saving?', null), 'en-US'), 'Annual equivalent energy saving is 15.9%.');
  assert.equal(buildEnergyAnswer(parseEnergyQuestion('How much electricity was consumed during today alone?', parseBusinessDate('2026-09-07')), 'en-US'), 'Only month-to-date cumulative gas, water, and electricity consumption is available. Single-day incremental consumption is not provided.');
  assert.equal(buildEnergyAnswer(parseEnergyQuestion('今天一天用了多少电？', parseBusinessDate('2026-09-07')), 'zh-CN'), '当前仅提供本月累计用气量、累计用水量和累计用电量，不提供单日新增用量。');
});

test('work-order parser answers Chinese explicit months and overview', () => {
  const cases = [
    ['9月处理中工单有多少？', '9月处理中工单有5312单。'],
    ['9月待处理工单有多少？', '9月待处理工单有278单。'],
    ['9月已关闭工单有多少？', '9月已关闭工单有145单。'],
    ['9月工单处理情况如何？', '9月工单处理情况为：处理中5312单、待处理278单、已关闭145单。']
  ];
  for (const [question, expected] of cases) assert.equal(buildWorkOrderAnswer(parseWorkOrderQuestion(question, null), 'zh-CN'), expected);
});

test('work-order source data keeps September and November closed-ticket values distinct', () => {
  assert.equal(WORK_ORDER_DATA[9].closed, 145);
  assert.equal(WORK_ORDER_DATA[11].closed, 165);
});

test('work-order relative months use businessDate or reference averages and support English', () => {
  const businessDate = parseBusinessDate('2026-09-07');
  assert.equal(buildWorkOrderAnswer(parseWorkOrderQuestion('本月处理中工单有多少？', businessDate), 'zh-CN'), '9月处理中工单有5312单。');
  assert.equal(buildWorkOrderAnswer(parseWorkOrderQuestion('本月处理中工单有多少？', null), 'zh-CN'), '月度处理中工单的参考平均值为5,576.25单。');
  assert.equal(buildWorkOrderAnswer(parseWorkOrderQuestion('How many service tickets were processing in September?', null), 'en-US'), 'There were 5312 service tickets processing in September.');
  assert.equal(buildWorkOrderAnswer(parseWorkOrderQuestion('How many service tickets are pending this month?', businessDate), 'en-US'), 'There were 278 service tickets pending in September.');
  assert.equal(buildWorkOrderAnswer(parseWorkOrderQuestion('How many service tickets were closed in September?', null), 'en-US'), 'There were 145 service tickets closed in September.');
  assert.equal(buildWorkOrderAnswer(parseWorkOrderQuestion('What is the service-ticket processing status for this month?', businessDate), 'en-US'), 'There were 5312 processing service tickets, 278 pending service tickets, and 145 closed service tickets in September.');
  assert.equal(buildWorkOrderAnswer(parseWorkOrderQuestion('11月已关闭工单有多少？', null), 'zh-CN'), '11月已关闭工单有165单。');
  assert.equal(buildWorkOrderAnswer(parseWorkOrderQuestion('How many service tickets were closed in November?', null), 'en-US'), 'There were 165 service tickets closed in November.');
  assert.equal(buildWorkOrderAnswer(parseWorkOrderQuestion('What is the service-ticket processing status for this month?', null), 'en-US'), 'The reference monthly averages are 5,576.25 processing service tickets, 329.83 pending service tickets, and 165.83 closed service tickets.');
});

test('dynamic parser rejects invalid explicit days, months, and unsupported questions', () => {
  assert.match(parseEnergyQuestion('第0日累计用电量是多少？', null).error, /day/);
  assert.match(parseEnergyQuestion('第32日累计用电量是多少？', null).error, /day/);
  assert.match(parseWorkOrderQuestion('0月处理中工单有多少？', null).error, /month/);
  assert.match(parseWorkOrderQuestion('13月处理中工单有多少？', null).error, /month/);
  assert.match(parseEnergyQuestion('今天天气怎么样？', null).error, /unsupported/);
  assert.match(parseWorkOrderQuestion('园区天气如何？', null).error, /unsupported/);
});

test('energy action ingress publishes exactly language then comprehensive-situation and callbacks the Chinese answer', async () => {
  const result = await post(envelope('查询用能管理', {
    question: '今天累计用电量是多少？', language: 'zh-CN', businessDate: '2026-09-07'
  }));
  assert.deepEqual(result, {
    status: 200, body: { ok: true, message: 'dynamic QA completed' },
    publisher: result.publisher, callbackClient: result.callbackClient
  });
  assert.deepEqual(JSON.parse(result.publisher.calls[0]), [
    { action: 'executeCapability', params: { capability: 'global.language', command: 'set', language: 'zh-CN' } },
    { action: '主题切换', params: { '主题名称': '综合态势' } }
  ]);
  assert.equal(result.publisher.calls.length, 1);
  assert.equal(result.callbackClient.calls[0].options.body, '本月第7日累计用电量为13.97吉瓦时。');
});

test('English work-order action ingress emits only en-US language and comprehensive-situation before its callback', async () => {
  const result = await post(envelope('查询工单处理统计', {
    question: 'How many service tickets are pending this month?', language: 'en', businessDate: '2026-09-07'
  }));
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.publisher.calls[0]), [
    { action: 'executeCapability', params: { capability: 'global.language', command: 'set', language: 'en-US' } },
    { action: '主题切换', params: { '主题名称': '综合态势' } }
  ]);
  assert.equal(result.callbackClient.calls[0].options.body, 'There were 278 service tickets pending in September.');
});

test('work-order ingress uses businessDate month nine for the complete Chinese overview', async () => {
  const result = await post(envelope('查询工单处理统计', {
    question: '本月工单处理情况如何？', language: 'zh-CN', businessDate: '2026-09-07'
  }));
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.publisher.calls[0]), [
    { action: 'executeCapability', params: { capability: 'global.language', command: 'set', language: 'zh-CN' } },
    { action: '主题切换', params: { '主题名称': '综合态势' } }
  ]);
  assert.equal(result.callbackClient.calls[0].options.body, '9月工单处理情况为：处理中5312单、待处理278单、已关闭145单。');
});

test('work-order ingress returns the strict English September closed-ticket answer', async () => {
  const result = await post(envelope('查询工单处理统计', {
    question: 'How many service tickets were closed in September?', language: 'en-US'
  }));
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.publisher.calls[0]), [
    { action: 'executeCapability', params: { capability: 'global.language', command: 'set', language: 'en-US' } },
    { action: '主题切换', params: { '主题名称': '综合态势' } }
  ]);
  assert.equal(result.callbackClient.calls[0].options.body, 'There were 145 service tickets closed in September.');
});

test('invalid businessDate is not treated as a server date and falls back to the specified reference average', async () => {
  const result = await post(envelope('查询用能管理', {
    question: '今天累计用电量是多少？', language: 'zh-CN', businessDate: 'abc'
  }));
  assert.equal(result.status, 200);
  assert.equal(result.callbackClient.calls[0].options.body, '本月累计用电量的参考平均值为32.26吉瓦时。');
});

test('dynamic QA ingress rejects malformed and unsupported input without publishing or callback', async () => {
  const cases = [
    envelope('查询用能管理', { language: 'zh-CN' }),
    envelope('查询用能管理', { question: '', language: 'zh-CN' }),
    envelope('查询用能管理', { question: '今天累计用电量是多少？' }),
    envelope('查询用能管理', { question: '今天累计用电量是多少？', language: 'fr-FR' }),
    envelope('查询用能管理', { question: '今天天气怎么样？', language: 'zh-CN' }),
    envelope('查询工单处理统计', { question: '13月处理中工单有多少？', language: 'zh-CN' })
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
    commands: [{ action: '查询工单处理统计', params: { question: '9月处理中工单有多少？', language: 'zh-CN' } }]
  });
  assert.equal(result.status, 400);
  assert.equal(result.publisher.calls.length, 0);
  assert.equal(result.callbackClient.calls.length, 0);
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
