const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { createCommandExecutor } = require('../src/command-executor');
const { createRuisiCallbackClient } = require('../src/ruisi-callback-client');
const { createNarrationSessionManager, sleep, getEffectiveSegmentDurationMs } = require('../src/narration/narration-session-manager');
const {
  PARK_BASE_OVERVIEW, PARK_BASE_OVERVIEW_ACTION,
  PARK_REALTIME_NARRATION, PARK_REALTIME_NARRATION_ACTION,
  SECURITY_REALTIME_NARRATION, SECURITY_REALTIME_NARRATION_ACTION,
  ENERGY_REALTIME_NARRATION, ENERGY_REALTIME_NARRATION_ACTION,
  validateNarrationCommand
} = require('../src/narration/narration-definitions');

const zhText = '练秋湖园区占地面积为1.6平方公里（约2400亩），目前入驻员工3万多名，共建有8个组团共104栋建筑，其中包括1600多间智慧会议室及900多个专业实验室。';
const enText = 'Lianqiuhu campus covers an area of 1.6 square kilometers (about 2,400 mu), housing over 30,000 employees across 104 buildings in 8 clusters, which include over 1,600 smart meeting rooms and 900 professional laboratories.';
const realtimeZhTexts = [
  '在大屏运行态势中：车位使用上，D至G组团车位接近饱和（使用率约95%），A至C组团使用率较低（约40%），分布极不均衡；',
  '设备报修集中在D组团10件和G组团9件；',
  '本月耗能以D1-实验楼53兆瓦时和G3-研发楼44.8兆瓦时最高；',
  '系统健康度整体优良，消防最高达99%，空调因能效衰减相对偏低，为92%。',
  'AI运营结论：近期D至G组团高密度人流带动了车位和能耗走高。建议在高峰期引导车辆向A至C区潮汐分流，并将非实时高功率作业调整至夜间，以平衡电网负荷。'
];
const realtimeEnTexts = [
  'On the operational dashboard: Parking occupancy shows Groups D-G are near saturation (~95%) while A-C are free (~40%).',
  'Repairs are concentrated in Group D (10 cases) and G (9 cases).',
  'Energy usage is topped by D1-Experimental Building (53 MWh) and G3-R&D Building (44.8 MWh).',
  'System health is stable, led by fire safety at 99%, while AC is lower at 92% due to efficiency degradation.',
  'AI Operational Conclusion: High-density crowd flows in Groups D-G have driven up parking and energy use. We recommend implementing tidal guidance to divert traffic to Groups A-C, and shifting non-real-time high-power tasks to nighttime to balance grid load.'
];
const securityZhTexts = [
  '在大屏安防实时态势中：告警处置已实现AI自动处理率76%、告警降噪率92%，零噪音过滤环境干扰；',
  '视觉行为中，车辆违停累计12件，居于首位；',
  '周界压力集中在C区，告警量达23件；',
  '巡更任务体现人机协同，机器人B队以76%的达成率，高效补位了人工B队22%的空缺。',
  'AI决策结论：当前安防强闭环运行。系统已监测并上报B11-2F一号10千伏配电室发生的人员未戴安全帽操作违规，画面已自动上报，请立即核实处置。'
];
const securityEnTexts = [
  'On the real-time security dashboard: Alarm disposition features a 76% AI automatic processing rate and 92% noise reduction to filter interference.',
  'Visual behavior is led by illegal vehicle parking (12 cases).',
  'Perimeter pressure peaks in Area C with 23 alarms.',
  'Patrol completion shows man-machine synergy, with Robot Patrol Team B (76%) successfully covering Human Team B\'s low rate (22%).',
  'AI Decision: Security is running in a sensitive closed loop. An unhelmeted operator violation has been detected in Building B11-2F, No. 1 10KV power distribution room; please physical verify immediately.'
];
const energyZhTexts = [
  '练秋湖园区高峰期日用电量约200万度（2 GWh），光伏月发电约30万度（300 MWh）。在大屏能效指标中：能源供给实时绿电占比达35%（其中光伏25%即812千瓦，储能放电10%即325千瓦），市政供电占65%（2113千瓦）；',
  '用电负荷在10:00达到3050千瓦，略超昨日（2950千瓦）；',
  '能耗强度中，F11区域最突出，E10为34 W/m²；',
  '绿色指数中，供电安全（98）和绿电占比（95）领先，但设备能效（75）偏低。',
  'AI决策结论：光储协同使整体碳排放强度环比昨日下降8%。主要异常为B栋暖通无效能耗及2号冷机能效衰减，系统已自动生成维保工单闭环处置。'
];
const energyEnTexts = [
  'Lianqiuhu campus consumes 2 million kWh (2 GWh) of electricity daily during peak periods, with monthly solar generation reaching 300,000 kWh (300 MWh). On the energy dashboard: Real-time supply features 35% green power (25% solar/812 kW, 10% storage/325 kW) and 65% municipal power (2,113 kW).',
  'Load trend shows 3,050 kW at 10:00, slightly above yesterday\'s 2,950 kW.',
  'Load monitoring peaks at Building F11 , with E10 at 34 W/m².',
  'Green index scores are high for safety (98) and solar ratio (95), but low for equipment efficiency (75).',
  'AI Decision: Solar-storage synergy reduced carbon emissions by 8% compared to yesterday. Building B\'s HVAC inefficiency and chiller #2\'s efficiency degradation are the main issues; maintenance orders have been automatically dispatched.'
];
const ENERGY_FORBIDDEN_COMMANDS = /energy\.(thirdPartyAgent|photovoltaicMonitoring|aiEnergyAssistant|energyFlow|aiAlgorithm)|workOrder|maintenance/;

function logger() { return { info() {}, warn() {}, error() {} }; }
function context(callback = 'http://127.0.0.1:29876/agent/send', suffix = '') {
  return { agent: `agent${suffix}`, replyTo: `user${suffix}@example.com`, groupchat: false, callback };
}
function commandExecutor(results = []) {
  const calls = [];
  return {
    calls,
    publishFrontendCommands: async (commands, meta) => {
      calls.push({ commands, meta });
      return results.shift() || { ok: true, status: 200 };
    }
  };
}
function callbackClient(results = []) {
  const calls = [];
  return {
    calls,
    sendAgentMessage: async (sessionContext, options) => {
      calls.push({ sessionContext, options });
      return results.shift() || { ok: true, status: 200 };
    }
  };
}
function manualWait({ autoResolveIntroDelay = true } = {}) {
  const calls = [];
  return {
    calls,
    wait: (ms, signal) => {
      if (autoResolveIntroDelay && ms === 4000) return Promise.resolve();
      return new Promise((resolve, reject) => {
      const item = { ms, resolve, reject };
      calls.push(item);
      if (signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
    }
  };
}
async function eventually(predicate) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('condition was not reached');
}
async function startHttpServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/agent/send`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
async function unavailableLocalUrl() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}/agent/send`;
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(JSON.parse(body)));
    req.on('error', reject);
  });
}

test('park base overview zh narration publishes start, callbacks fixed text, waits, then cleans up', async () => {
  const executor = commandExecutor();
  const callback = callbackClient();
  const clock = manualWait();
  const manager = createNarrationSessionManager({ commandExecutor: executor, callbackClient: callback, logger: logger(), wait: clock.wait });
  const started = await manager.startNarration({ definition: PARK_BASE_OVERVIEW, context: context(), language: 'zh-CN' });
  await eventually(() => clock.calls.length === 1);
  assert.equal(started.session.state, 'running');
  assert.equal(executor.calls.length, 2);
  assert.deepEqual(executor.calls[0].commands, PARK_BASE_OVERVIEW.prepareCommands);
  assert.deepEqual(executor.calls[1].commands, PARK_BASE_OVERVIEW.startCommands);
  assert.equal(callback.calls[0].options.body, zhText);
  assert.equal(clock.calls[0].ms, 30000);
  clock.calls[0].resolve();
  await started.session.runPromise;
  assert.deepEqual(executor.calls[2].commands, PARK_BASE_OVERVIEW.completeCommands);
  assert.equal(started.session.state, 'completed');
});

test('English narration and language normalization use the frozen English answer', async () => {
  const parsed = validateNarrationCommand({ action: PARK_BASE_OVERVIEW_ACTION, params: { language: 'en' } });
  assert.equal(parsed.language, 'en-US');
  assert.equal(validateNarrationCommand({ action: PARK_BASE_OVERVIEW_ACTION, params: {} }).language, 'zh-CN');
  assert.match(validateNarrationCommand({ action: PARK_BASE_OVERVIEW_ACTION, params: { language: 'fr' } }).error, /language/);

  const executor = commandExecutor();
  const callback = callbackClient();
  const manager = createNarrationSessionManager({ commandExecutor: executor, callbackClient: callback, logger: logger(), wait: async () => {} });
  const started = await manager.startNarration({ definition: PARK_BASE_OVERVIEW, context: context(), language: parsed.language });
  await started.session.runPromise;
  assert.equal(callback.calls[0].options.body, enText);
  assert.equal(PARK_BASE_OVERVIEW.segments[0].content['en-US'].durationMs, 22000);
});

test('park base overview keeps the UE roam floor independent of speech scale, while longer speech still wins', async () => {
  const segment = PARK_BASE_OVERVIEW.segments[0];
  assert.equal(segment.minimumIocHoldMs, 30000);
  assert.equal(getEffectiveSegmentDurationMs(segment.content['zh-CN'], segment, 1), 30000);
  assert.equal(getEffectiveSegmentDurationMs(segment.content['zh-CN'], segment, 0.1), 30000);
  assert.equal(getEffectiveSegmentDurationMs(segment.content['zh-CN'], segment, 2), 40000);

  for (const [scale, expectedMs] of [[1, 30000], [0.1, 30000], [2, 40000]]) {
    const executor = commandExecutor();
    const callback = callbackClient();
    const clock = manualWait();
    const manager = createNarrationSessionManager({
      commandExecutor: executor, callbackClient: callback, logger: logger(), durationScale: scale, wait: clock.wait
    });
    const started = manager.startNarration({ definition: PARK_BASE_OVERVIEW, context: context(), language: 'zh-CN' });
    await eventually(() => clock.calls.length === 1);
    assert.equal(clock.calls[0].ms, expectedMs);
    assert.equal(executor.calls.length, 2, 'cancel must not publish before the effective hold completes');
    clock.calls[0].resolve();
    await started.session.runPromise;
    assert.deepEqual(executor.calls.at(-1).commands, PARK_BASE_OVERVIEW.completeCommands);
  }
});

test('park base overview abort bypasses the IOC hold floor and immediately publishes cancel', async () => {
  const executor = commandExecutor();
  const clock = manualWait();
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: callbackClient(), logger: logger(), durationScale: 0.1, wait: clock.wait
  });
  const started = manager.startNarration({ definition: PARK_BASE_OVERVIEW, context: context(), language: 'zh-CN' });
  await eventually(() => clock.calls.length === 1);
  assert.equal(clock.calls[0].ms, 30000);
  await manager.cancelActiveNarration('test abort');
  assert.deepEqual(executor.calls.at(-1).commands, PARK_BASE_OVERVIEW.cancelCommands);
  assert.equal(started.session.state, 'completed');
});

test('callback failure or timeout result does not block duration wait and cleanup', async () => {
  for (const callbackResult of [
    { ok: false, status: 500, error: 'RUISI callback failed with status 500' },
    { ok: false, status: null, error: 'RUISI callback timeout after 5ms' }
  ]) {
    const executor = commandExecutor();
    const clock = manualWait();
    const manager = createNarrationSessionManager({
      commandExecutor: executor, callbackClient: callbackClient([callbackResult]), logger: logger(), wait: clock.wait
    });
    const started = await manager.startNarration({ definition: PARK_BASE_OVERVIEW, context: context(), language: 'zh-CN' });
    await eventually(() => clock.calls.length === 1);
    clock.calls[0].resolve();
    await started.session.runPromise;
    assert.equal(executor.calls.length, 3);
    assert.deepEqual(executor.calls[2].commands, PARK_BASE_OVERVIEW.completeCommands);
  }
});

test('narration without callback-ready context does not publish IOC holding commands', async () => {
  const executor = commandExecutor();
  const manager = createNarrationSessionManager({ commandExecutor: executor, callbackClient: callbackClient(), logger: logger() });
  const result = await manager.startNarration({
    definition: PARK_BASE_OVERVIEW, context: { agent: 'agent', replyTo: 'user@example.com', groupchat: false }, language: 'zh-CN'
  });
  assert.deepEqual(result, { ok: false, error: 'narration callback unavailable: missing context.callback' });
  assert.equal(executor.calls.length, 0);
});

test('new narration preempts old one and old cleanup cannot release or cancel the new session', async () => {
  const executor = commandExecutor();
  const callback = callbackClient();
  const clock = manualWait();
  const manager = createNarrationSessionManager({ commandExecutor: executor, callbackClient: callback, logger: logger(), wait: clock.wait });
  const first = await manager.startNarration({ definition: PARK_BASE_OVERVIEW, context: context(undefined, 'A'), language: 'zh-CN' });
  await eventually(() => clock.calls.length === 1);
  const second = await manager.startNarration({ definition: PARK_BASE_OVERVIEW, context: context(undefined, 'B'), language: 'en-US' });
  await eventually(() => clock.calls.length === 2);
  assert.equal(first.session.state, 'completed');
  assert.equal(manager.getActiveSession().id, second.session.id);
  assert.equal(callback.calls[0].sessionContext.replyTo, 'userA@example.com');
  assert.equal(callback.calls[1].sessionContext.replyTo, 'userB@example.com');
  assert.deepEqual(executor.calls.map((call) => call.meta.source), [
    'narration:parkBaseOverview:prepare', 'narration:parkBaseOverview:start', 'narration:parkBaseOverview:cancel',
    'narration:parkBaseOverview:prepare', 'narration:parkBaseOverview:start'
  ]);
  clock.calls[0].resolve();
  assert.equal(manager.getActiveSession().id, second.session.id);
  clock.calls[1].resolve();
  await second.session.runPromise;
  assert.deepEqual(executor.calls.map((call) => call.meta.source), [
    'narration:parkBaseOverview:prepare', 'narration:parkBaseOverview:start', 'narration:parkBaseOverview:cancel',
    'narration:parkBaseOverview:prepare', 'narration:parkBaseOverview:start', 'narration:parkBaseOverview:complete'
  ]);
});

test('cancelActiveNarration is idempotent and aborts a real sleep immediately', async () => {
  const executor = commandExecutor();
  const manager = createNarrationSessionManager({ commandExecutor: executor, callbackClient: callbackClient(), logger: logger(), wait: sleep });
  const started = await manager.startNarration({
    definition: { ...PARK_BASE_OVERVIEW, introDelayMs: 0 }, context: context(), language: 'zh-CN'
  });
  await eventually(() => started.session.iocStarted);
  await Promise.all([manager.cancelActiveNarration('test'), manager.cancelActiveNarration('test')]);
  assert.equal(started.session.state, 'completed');
  assert.equal(executor.calls.filter((call) => call.meta.source.endsWith(':cancel')).length, 1);
  assert.equal(manager.getActiveSession(), null);
});

test('shutdown cancellation uses the same cleanup path and background exceptions stay handled', async () => {
  const executor = commandExecutor();
  const manager = createNarrationSessionManager({
    commandExecutor: executor,
    callbackClient: { sendAgentMessage: async () => { throw new Error('unexpected callback error'); } },
    logger: logger(), wait: async () => {}
  });
  const started = await manager.startNarration({ definition: PARK_BASE_OVERVIEW, context: context(), language: 'zh-CN' });
  await started.session.runPromise;
  assert.equal(started.session.state, 'completed');
  assert.equal(executor.calls.filter((call) => call.meta.source.endsWith(':cancel')).length, 1);

  const waiting = manualWait();
  const shutdownManager = createNarrationSessionManager({
    commandExecutor: commandExecutor(), callbackClient: callbackClient(), logger: logger(), wait: waiting.wait
  });
  const active = await shutdownManager.startNarration({ definition: PARK_BASE_OVERVIEW, context: context(), language: 'zh-CN' });
  await eventually(() => waiting.calls.length === 1);
  await shutdownManager.cancelActiveNarration('shutdown');
  assert.equal(active.session.cancelReason, 'shutdown');
  assert.equal(active.session.state, 'completed');
});

test('duration scale is applied only to definition duration and invalid scale is rejected by manager construction', async () => {
  const executor = commandExecutor();
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: callbackClient(), logger: logger(), durationScale: 1.2, wait: async () => {}
  });
  const started = await manager.startNarration({ definition: PARK_BASE_OVERVIEW, context: context(), language: 'zh-CN' });
  await started.session.runPromise;
  assert.equal(PARK_BASE_OVERVIEW.segments[0].content['zh-CN'].durationMs * 1.2, 24000);
  assert.throws(() => createNarrationSessionManager({ commandExecutor: executor, callbackClient: callbackClient(), logger: logger(), durationScale: 0 }), /scale/);
});

test('HTTP narration is accepted immediately and full mock callback E2E follows MQTT start/callback/cancel order', async () => {
  const callbackMessages = [];
  const ingress = await startHttpServer(async (req, res) => {
    callbackMessages.push(await readJson(req));
    res.writeHead(200).end();
  });
  const publisher = { calls: [], isConnected: () => true, publish: async (message) => publisher.calls.push(message) };
  const commandExecutorInstance = createCommandExecutor({ publisher, logger: logger(), mqttTopic: 'test/topic' });
  const clock = manualWait();
  const narrationManager = createNarrationSessionManager({
    commandExecutor: commandExecutorInstance, callbackClient: createRuisiCallbackClient(), logger: logger(), wait: clock.wait
  });
  const app = createApp({ publisher, logger: logger(), mqttTopic: 'test/topic', commandExecutor: commandExecutorInstance, narrationManager });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/commands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { agent: 'e2e-agent', reply_to: 'e2e-user@example.com', groupchat: false, callback: ingress.url },
        commands: [{ action: PARK_BASE_OVERVIEW_ACTION, params: { language: 'zh-CN' } }]
      })
    });
    const body = await response.json();
    assert.equal(response.status, 202);
    assert.equal(body.ok, true);
    await eventually(() => publisher.calls.length === 2 && callbackMessages.length === 1 && clock.calls.length === 1);
    assert.deepEqual(JSON.parse(publisher.calls[0]), PARK_BASE_OVERVIEW.prepareCommands);
    assert.deepEqual(JSON.parse(publisher.calls[1]), PARK_BASE_OVERVIEW.startCommands);
    assert.deepEqual(callbackMessages[0], { agent: 'e2e-agent', to: 'e2e-user@example.com', body: zhText, groupchat: false });
    assert.equal(publisher.calls.length, 2, 'HTTP returned before the narration duration elapsed');
    clock.calls[0].resolve();
    await eventually(() => publisher.calls.length === 3);
    assert.deepEqual(JSON.parse(publisher.calls[2]), PARK_BASE_OVERVIEW.completeCommands);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await ingress.close();
  }
});

test('HTTP narration rejects unavailable callback and regular commands retain normal executor behavior', async () => {
  const publisher = { calls: [], isConnected: () => true, publish: async (message) => publisher.calls.push(message) };
  const app = createApp({ publisher, logger: logger(), mqttTopic: 'test/topic' });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const rejected = await fetch(`http://127.0.0.1:${server.address().port}/api/commands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: [{ action: PARK_BASE_OVERVIEW_ACTION, params: {} }] })
    });
    assert.equal(rejected.status, 400);
    assert.equal(publisher.calls.length, 0);
    const ordinary = await fetch(`http://127.0.0.1:${server.address().port}/api/commands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ action: '主题切换', params: { '主题名称': '综合安防' } }])
    });
    assert.equal(ordinary.status, 200);
    assert.equal(publisher.calls.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('real fetch ECONNREFUSED still returns HTTP 202, waits, and publishes narration cleanup', async () => {
  const callbackUrl = await unavailableLocalUrl();
  const publisher = { calls: [], isConnected: () => true, publish: async (message) => publisher.calls.push(message) };
  const executor = createCommandExecutor({ publisher, logger: logger(), mqttTopic: 'test/topic' });
  const clock = manualWait();
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: createRuisiCallbackClient({ timeoutMs: 100 }), logger: logger(), wait: clock.wait
  });
  const app = createApp({ publisher, logger: logger(), mqttTopic: 'test/topic', commandExecutor: executor, narrationManager: manager });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/commands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { agent: 'offline-agent', reply_to: 'offline-user@example.com', groupchat: false, callback: callbackUrl },
        commands: [{ action: PARK_BASE_OVERVIEW_ACTION, params: {} }]
      })
    });
    assert.equal(response.status, 202);
    await eventually(() => clock.calls.length === 1);
    assert.deepEqual(JSON.parse(publisher.calls[0]), PARK_BASE_OVERVIEW.prepareCommands);
    assert.deepEqual(JSON.parse(publisher.calls[1]), PARK_BASE_OVERVIEW.startCommands);
    clock.calls[0].resolve();
    await eventually(() => publisher.calls.length === 3);
    assert.deepEqual(JSON.parse(publisher.calls[2]), PARK_BASE_OVERVIEW.completeCommands);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a stuck old narration cannot hold a new HTTP request before 202 admission', async () => {
  const publisher = { calls: [], isConnected: () => true, publish: async (message) => publisher.calls.push(message) };
  const executor = createCommandExecutor({ publisher, logger: logger(), mqttTopic: 'test/topic' });
  let releaseFirstCallback;
  let callbackCalls = 0;
  const callback = {
    sendAgentMessage: async () => {
      callbackCalls += 1;
      if (callbackCalls === 1) return new Promise((resolve) => { releaseFirstCallback = resolve; });
      return { ok: true, status: 200 };
    }
  };
  const clock = manualWait();
  const manager = createNarrationSessionManager({ commandExecutor: executor, callbackClient: callback, logger: logger(), wait: clock.wait });
  const app = createApp({ publisher, logger: logger(), mqttTopic: 'test/topic', commandExecutor: executor, narrationManager: manager });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const post = () => fetch(`http://127.0.0.1:${server.address().port}/api/commands`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: { agent: 'agent', reply_to: 'user@example.com', groupchat: false, callback: 'http://127.0.0.1:29876/agent/send' },
      commands: [{ action: PARK_BASE_OVERVIEW_ACTION, params: {} }]
    })
  });
  try {
    assert.equal((await post()).status, 202);
    await eventually(() => typeof releaseFirstCallback === 'function');
    const second = await Promise.race([
      post(),
      new Promise((resolve, reject) => setTimeout(() => reject(new Error('second HTTP request was blocked')), 200))
    ]);
    assert.equal(second.status, 202);
    releaseFirstCallback({ ok: false, status: null, error: 'released test callback' });
    await eventually(() => clock.calls.length === 1);
    clock.calls[0].resolve();
    await manager.cancelActiveNarration('test cleanup');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('park realtime narration sends five Chinese segments in IOC step/callback/wait order and finishes without cancel', async () => {
  const executor = commandExecutor();
  const callback = callbackClient();
  const clock = manualWait();
  const manager = createNarrationSessionManager({ commandExecutor: executor, callbackClient: callback, logger: logger(), wait: clock.wait });
  const started = manager.startNarration({ definition: PARK_REALTIME_NARRATION, context: context(), language: 'zh-CN' });
  for (let index = 1; index <= 5; index += 1) {
    await eventually(() => clock.calls.length === index && callback.calls.length === index);
    assert.equal(callback.calls[index - 1].options.body, realtimeZhTexts[index - 1]);
    if (index === 1) {
      assert.deepEqual(executor.calls[0].commands, PARK_REALTIME_NARRATION.prepareCommands);
      assert.deepEqual(executor.calls[1].commands, PARK_REALTIME_NARRATION.startCommands);
      assert.equal(executor.calls.some((call) => call.meta.source.endsWith('segment-1')), false);
    } else {
      const stepCall = executor.calls.find((call) => call.meta.source.endsWith(`segment-${index}`));
      assert.deepEqual(stepCall.commands, PARK_REALTIME_NARRATION.segments[index - 1].commands);
    }
    clock.calls[index - 1].resolve();
  }
  await started.session.runPromise;
  assert.deepEqual(executor.calls.at(-1).commands, PARK_REALTIME_NARRATION.completeCommands);
  assert.equal(executor.calls.some((call) => call.meta.source.endsWith(':cancel')), false);
});

test('park realtime narration uses frozen English text, defaults language to Chinese, and scales every duration', async () => {
  assert.equal(validateNarrationCommand({ action: PARK_REALTIME_NARRATION_ACTION, params: {} }).language, 'zh-CN');
  const executor = commandExecutor();
  const callback = callbackClient();
  const durations = [];
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: callback, logger: logger(), durationScale: 0.1,
    wait: async (durationMs) => { durations.push(durationMs); }
  });
  const started = manager.startNarration({ definition: PARK_REALTIME_NARRATION, context: context(), language: 'en-US' });
  await started.session.runPromise;
  assert.deepEqual(callback.calls.map((call) => call.options.body), realtimeEnTexts);
  assert.deepEqual(durations, [4000, 6600, 5700, 6650, 6000, 3700]);
  assert.deepEqual(executor.calls.at(-1).commands, PARK_REALTIME_NARRATION.completeCommands);
});

test('segment callback failures continue to later steps and a segment-three preemption cancels without finish', async () => {
  const executor = commandExecutor();
  const callback = callbackClient([
    { ok: true, status: 200 }, { ok: false, status: 500, error: 'callback failed' },
    { ok: true, status: 200 }, { ok: true, status: 200 }, { ok: false, status: null, error: 'timeout' }
  ]);
  const manager = createNarrationSessionManager({ commandExecutor: executor, callbackClient: callback, logger: logger(), wait: async () => {} });
  const completed = manager.startNarration({ definition: PARK_REALTIME_NARRATION, context: context(), language: 'zh-CN' });
  await completed.session.runPromise;
  assert.equal(callback.calls.length, 5);
  assert.deepEqual(executor.calls.at(-1).commands, PARK_REALTIME_NARRATION.completeCommands);

  const preemptExecutor = commandExecutor();
  const preemptClock = manualWait();
  const preemptManager = createNarrationSessionManager({
    commandExecutor: preemptExecutor, callbackClient: callbackClient(), logger: logger(), wait: preemptClock.wait
  });
  const first = preemptManager.startNarration({ definition: PARK_REALTIME_NARRATION, context: context(undefined, 'A'), language: 'zh-CN' });
  for (let index = 1; index <= 3; index += 1) {
    await eventually(() => preemptClock.calls.length === index);
    if (index < 3) preemptClock.calls[index - 1].resolve();
  }
  const second = preemptManager.startNarration({ definition: PARK_BASE_OVERVIEW, context: context(undefined, 'B'), language: 'zh-CN' });
  await eventually(() => preemptExecutor.calls.some((call) => call.meta.source === 'narration:parkRealtimeNarration:cancel'));
  assert.equal(preemptExecutor.calls.some((call) => call.meta.source === 'narration:parkRealtimeNarration:segment-4'), false);
  assert.equal(preemptExecutor.calls.some((call) => call.meta.source === 'narration:parkRealtimeNarration:complete'), false);
  await eventually(() => preemptClock.calls.length === 4);
  await preemptManager.cancelActiveNarration('test');
  await Promise.all([first.session.runPromise, second.session.runPromise]);
});

test('HTTP mock E2E sends park realtime callbacks and MQTT select2-to-select5 before final finish', async () => {
  const messages = [];
  const ingress = await startHttpServer(async (req, res) => {
    messages.push(await readJson(req));
    res.writeHead(200).end();
  });
  const publisher = { calls: [], isConnected: () => true, publish: async (message) => publisher.calls.push(message) };
  const executor = createCommandExecutor({ publisher, logger: logger(), mqttTopic: 'test/topic' });
  const clock = manualWait();
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: createRuisiCallbackClient(), logger: logger(), wait: clock.wait
  });
  const app = createApp({ publisher, logger: logger(), mqttTopic: 'test/topic', commandExecutor: executor, narrationManager: manager });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/commands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        context: { agent: 'realtime-agent', reply_to: 'realtime-user@example.com', groupchat: false, callback: ingress.url },
        commands: [{ action: PARK_REALTIME_NARRATION_ACTION, params: { language: 'zh-CN' } }]
      })
    });
    assert.equal(response.status, 202);
    for (let index = 1; index <= 5; index += 1) {
      await eventually(() => messages.length === index && clock.calls.length === index);
      assert.equal(messages[index - 1].body, realtimeZhTexts[index - 1]);
      if (index > 1) {
        assert.deepEqual(JSON.parse(publisher.calls[index]), PARK_REALTIME_NARRATION.segments[index - 1].commands);
      }
      clock.calls[index - 1].resolve();
    }
    await eventually(() => publisher.calls.length === 7);
    assert.deepEqual(JSON.parse(publisher.calls[0]), PARK_REALTIME_NARRATION.prepareCommands);
    assert.deepEqual(JSON.parse(publisher.calls[1]), PARK_REALTIME_NARRATION.startCommands);
    assert.deepEqual(JSON.parse(publisher.calls[6]), PARK_REALTIME_NARRATION.completeCommands);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await ingress.close();
  }
});

test('security realtime narration sends five frozen Chinese segments in step/callback/wait order and never mixes no-hard-hat flows', async () => {
  const executor = commandExecutor();
  const callback = callbackClient();
  const clock = manualWait();
  const manager = createNarrationSessionManager({ commandExecutor: executor, callbackClient: callback, logger: logger(), wait: clock.wait });
  const started = manager.startNarration({ definition: SECURITY_REALTIME_NARRATION, context: context(), language: 'zh-CN' });

  for (let index = 1; index <= 5; index += 1) {
    await eventually(() => clock.calls.length === index && callback.calls.length === index);
    assert.equal(callback.calls[index - 1].options.body, securityZhTexts[index - 1]);
    if (index === 1) {
      assert.deepEqual(executor.calls[0].commands, SECURITY_REALTIME_NARRATION.prepareCommands);
      assert.deepEqual(executor.calls[1].commands, SECURITY_REALTIME_NARRATION.startCommands);
      assert.equal(executor.calls.some((call) => call.meta.source.endsWith('segment-1')), false);
    } else {
      const stepCall = executor.calls.find((call) => call.meta.source.endsWith(`segment-${index}`));
      assert.deepEqual(stepCall.commands, SECURITY_REALTIME_NARRATION.segments[index - 1].commands);
    }
    clock.calls[index - 1].resolve();
  }

  await started.session.runPromise;
  assert.deepEqual(executor.calls.at(-1).commands, SECURITY_REALTIME_NARRATION.completeCommands);
  assert.equal(executor.calls.some((call) => call.meta.source.endsWith(':cancel')), false);
  const emittedCommandText = JSON.stringify(executor.calls.map((call) => call.commands));
  assert.doesNotMatch(emittedCommandText, /security\.noHardHatAlert|noHardHatFullFlow|video\/open/);
});

test('security narration preserves frozen English text, defaults language to Chinese, and scales all five durations', async () => {
  assert.equal(validateNarrationCommand({ action: SECURITY_REALTIME_NARRATION_ACTION, params: {} }).language, 'zh-CN');
  assert.match(validateNarrationCommand({ action: SECURITY_REALTIME_NARRATION_ACTION, params: { language: 'fr' } }).error, /language/);
  const executor = commandExecutor();
  const callback = callbackClient();
  const durations = [];
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: callback, logger: logger(), durationScale: 0.1,
    wait: async (durationMs) => { durations.push(durationMs); }
  });
  const started = manager.startNarration({ definition: SECURITY_REALTIME_NARRATION, context: context(), language: 'en-US' });
  await started.session.runPromise;
  assert.deepEqual(callback.calls.map((call) => call.options.body), securityEnTexts);
  assert.deepEqual(durations, [4000, 6600, 5600, 7600, 6600, 3700]);
  assert.deepEqual(executor.calls.at(-1).commands, SECURITY_REALTIME_NARRATION.completeCommands);
});

test('security callback failures continue, while segment-three preemption sends security cancel without later steps or finish', async () => {
  const completedExecutor = commandExecutor();
  const completed = createNarrationSessionManager({
    commandExecutor: completedExecutor,
    callbackClient: callbackClient([
      { ok: true, status: 200 }, { ok: false, status: 500, error: 'callback failed' },
      { ok: true, status: 200 }, { ok: true, status: 200 }, { ok: false, status: null, error: 'timeout' }
    ]),
    logger: logger(), wait: async () => {}
  });
  const completedSession = completed.startNarration({ definition: SECURITY_REALTIME_NARRATION, context: context(), language: 'zh-CN' });
  await completedSession.session.runPromise;
  assert.deepEqual(completedExecutor.calls.at(-1).commands, SECURITY_REALTIME_NARRATION.completeCommands);

  const executor = commandExecutor();
  const clock = manualWait();
  const preemptCallback = callbackClient();
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: preemptCallback, logger: logger(), wait: clock.wait
  });
  const first = manager.startNarration({ definition: SECURITY_REALTIME_NARRATION, context: context(undefined, 'A'), language: 'zh-CN' });
  for (let index = 1; index <= 3; index += 1) {
    await eventually(() => clock.calls.length === index);
    if (index < 3) clock.calls[index - 1].resolve();
  }
  const second = manager.startNarration({ definition: PARK_BASE_OVERVIEW, context: context(undefined, 'B'), language: 'zh-CN' });
  await eventually(() => executor.calls.some((call) => call.meta.source === 'narration:securityRealtimeNarration:cancel'));
  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:securityRealtimeNarration:segment-4'), false);
  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:securityRealtimeNarration:segment-5'), false);
  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:securityRealtimeNarration:complete'), false);
  await eventually(() => clock.calls.length === 4);
  assert.deepEqual(preemptCallback.calls.slice(0, 3).map((call) => call.options.body), securityZhTexts.slice(0, 3));
  assert.ok(preemptCallback.calls.slice(0, 3).every((call) => call.sessionContext.replyTo === 'userA@example.com'));
  assert.equal(preemptCallback.calls[3].sessionContext.replyTo, 'userB@example.com');
  assert.equal(preemptCallback.calls[3].options.body, zhText);
  await manager.cancelActiveNarration('test');
  await Promise.all([first.session.runPromise, second.session.runPromise]);
});

test('security HTTP mock E2E returns 202 then publishes five steps, five callbacks, and finish without no-hard-hat commands', async () => {
  const messages = [];
  const ingress = await startHttpServer(async (req, res) => {
    messages.push(await readJson(req));
    res.writeHead(200).end();
  });
  const publisher = { calls: [], isConnected: () => true, publish: async (message) => publisher.calls.push(message) };
  const executor = createCommandExecutor({ publisher, logger: logger(), mqttTopic: 'test/topic' });
  const clock = manualWait();
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: createRuisiCallbackClient(), logger: logger(), wait: clock.wait
  });
  const app = createApp({ publisher, logger: logger(), mqttTopic: 'test/topic', commandExecutor: executor, narrationManager: manager });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/commands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        context: { agent: 'security-agent', reply_to: 'security-user@example.com', groupchat: false, callback: ingress.url },
        commands: [{ action: SECURITY_REALTIME_NARRATION_ACTION, params: { language: 'zh-CN' } }]
      })
    });
    assert.equal(response.status, 202);
    for (let index = 1; index <= 5; index += 1) {
      await eventually(() => messages.length === index && clock.calls.length === index);
      assert.equal(messages[index - 1].body, securityZhTexts[index - 1]);
      if (index > 1) assert.deepEqual(JSON.parse(publisher.calls[index]), SECURITY_REALTIME_NARRATION.segments[index - 1].commands);
      clock.calls[index - 1].resolve();
    }
    await eventually(() => publisher.calls.length === 7);
    assert.deepEqual(JSON.parse(publisher.calls[0]), SECURITY_REALTIME_NARRATION.prepareCommands);
    assert.deepEqual(JSON.parse(publisher.calls[1]), SECURITY_REALTIME_NARRATION.startCommands);
    assert.deepEqual(JSON.parse(publisher.calls[6]), SECURITY_REALTIME_NARRATION.completeCommands);
    assert.doesNotMatch(publisher.calls.join('\n'), /security\.noHardHatAlert|noHardHatFullFlow|video\/open/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await ingress.close();
  }
});

test('energy realtime narration sends five frozen Chinese segments in step/callback/wait order and never mixes other energy businesses', async () => {
  const executor = commandExecutor();
  const callback = callbackClient();
  const clock = manualWait();
  const manager = createNarrationSessionManager({ commandExecutor: executor, callbackClient: callback, logger: logger(), wait: clock.wait });
  const started = manager.startNarration({ definition: ENERGY_REALTIME_NARRATION, context: context(), language: 'zh-CN' });

  for (let index = 1; index <= 5; index += 1) {
    await eventually(() => clock.calls.length === index && callback.calls.length === index);
    assert.equal(callback.calls[index - 1].options.body, energyZhTexts[index - 1]);
    if (index === 1) {
      assert.deepEqual(executor.calls[0].commands, ENERGY_REALTIME_NARRATION.prepareCommands);
      assert.deepEqual(executor.calls[1].commands, ENERGY_REALTIME_NARRATION.startCommands);
      assert.equal(executor.calls.some((call) => call.meta.source.endsWith('segment-1')), false);
    } else {
      const stepCall = executor.calls.find((call) => call.meta.source.endsWith(`segment-${index}`));
      assert.deepEqual(stepCall.commands, ENERGY_REALTIME_NARRATION.segments[index - 1].commands);
    }
    clock.calls[index - 1].resolve();
  }

  await started.session.runPromise;
  assert.deepEqual(executor.calls.at(-1).commands, ENERGY_REALTIME_NARRATION.completeCommands);
  assert.equal(executor.calls.some((call) => call.meta.source.endsWith(':cancel')), false);
  assert.doesNotMatch(JSON.stringify(executor.calls.map((call) => call.commands)), ENERGY_FORBIDDEN_COMMANDS);
});

test('energy narration preserves frozen English text, defaults language to Chinese, and scales all five durations', async () => {
  assert.equal(validateNarrationCommand({ action: ENERGY_REALTIME_NARRATION_ACTION, params: {} }).language, 'zh-CN');
  assert.match(validateNarrationCommand({ action: ENERGY_REALTIME_NARRATION_ACTION, params: { language: 'fr' } }).error, /language/);
  const executor = commandExecutor();
  const callback = callbackClient();
  const durations = [];
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: callback, logger: logger(), durationScale: 0.1,
    wait: async (durationMs) => { durations.push(durationMs); }
  });
  const started = manager.startNarration({ definition: ENERGY_REALTIME_NARRATION, context: context(), language: 'en-US' });
  await started.session.runPromise;
  assert.deepEqual(callback.calls.map((call) => call.options.body), energyEnTexts);
  assert.deepEqual(durations, [4000, 6150, 5900, 5700, 6000, 3700]);
  assert.deepEqual(executor.calls.at(-1).commands, ENERGY_REALTIME_NARRATION.completeCommands);
});

test('energy callback failures continue, while segment-three preemption sends energy cancel without later steps or finish', async () => {
  const completedExecutor = commandExecutor();
  const completed = createNarrationSessionManager({
    commandExecutor: completedExecutor,
    callbackClient: callbackClient([
      { ok: true, status: 200 }, { ok: false, status: 500, error: 'callback failed' },
      { ok: true, status: 200 }, { ok: true, status: 200 }, { ok: false, status: null, error: 'timeout' }
    ]),
    logger: logger(), wait: async () => {}
  });
  const completedSession = completed.startNarration({ definition: ENERGY_REALTIME_NARRATION, context: context(), language: 'zh-CN' });
  await completedSession.session.runPromise;
  assert.deepEqual(completedExecutor.calls.at(-1).commands, ENERGY_REALTIME_NARRATION.completeCommands);

  const executor = commandExecutor();
  const clock = manualWait();
  const preemptCallback = callbackClient();
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: preemptCallback, logger: logger(), wait: clock.wait
  });
  const first = manager.startNarration({ definition: ENERGY_REALTIME_NARRATION, context: context(undefined, 'A'), language: 'zh-CN' });
  for (let index = 1; index <= 3; index += 1) {
    await eventually(() => clock.calls.length === index);
    if (index < 3) clock.calls[index - 1].resolve();
  }
  const second = manager.startNarration({ definition: PARK_REALTIME_NARRATION, context: context(undefined, 'B'), language: 'zh-CN' });
  await eventually(() => executor.calls.some((call) => call.meta.source === 'narration:energyRealtimeNarration:cancel'));
  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:energyRealtimeNarration:segment-4'), false);
  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:energyRealtimeNarration:segment-5'), false);
  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:energyRealtimeNarration:complete'), false);
  await eventually(() => clock.calls.length === 4);
  assert.deepEqual(preemptCallback.calls.slice(0, 3).map((call) => call.options.body), energyZhTexts.slice(0, 3));
  assert.ok(preemptCallback.calls.slice(0, 3).every((call) => call.sessionContext.replyTo === 'userA@example.com'));
  assert.equal(preemptCallback.calls[3].sessionContext.replyTo, 'userB@example.com');
  assert.equal(preemptCallback.calls[3].options.body, realtimeZhTexts[0]);
  await manager.cancelActiveNarration('test');
  await Promise.all([first.session.runPromise, second.session.runPromise]);
});

test('energy HTTP mock E2E returns 202 then publishes five steps, five callbacks, and finish without extra energy commands', async () => {
  const messages = [];
  const ingress = await startHttpServer(async (req, res) => {
    messages.push(await readJson(req));
    res.writeHead(200).end();
  });
  const publisher = { calls: [], isConnected: () => true, publish: async (message) => publisher.calls.push(message) };
  const executor = createCommandExecutor({ publisher, logger: logger(), mqttTopic: 'test/topic' });
  const clock = manualWait();
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: createRuisiCallbackClient(), logger: logger(), wait: clock.wait
  });
  const app = createApp({ publisher, logger: logger(), mqttTopic: 'test/topic', commandExecutor: executor, narrationManager: manager });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/commands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        context: { agent: 'energy-agent', reply_to: 'energy-user@example.com', groupchat: false, callback: ingress.url },
        commands: [{ action: ENERGY_REALTIME_NARRATION_ACTION, params: { language: 'zh-CN' } }]
      })
    });
    assert.equal(response.status, 202);
    for (let index = 1; index <= 5; index += 1) {
      await eventually(() => messages.length === index && clock.calls.length === index);
      assert.equal(messages[index - 1].body, energyZhTexts[index - 1]);
      if (index > 1) assert.deepEqual(JSON.parse(publisher.calls[index]), ENERGY_REALTIME_NARRATION.segments[index - 1].commands);
      clock.calls[index - 1].resolve();
    }
    await eventually(() => publisher.calls.length === 7);
    assert.deepEqual(JSON.parse(publisher.calls[0]), ENERGY_REALTIME_NARRATION.prepareCommands);
    assert.deepEqual(JSON.parse(publisher.calls[1]), ENERGY_REALTIME_NARRATION.startCommands);
    assert.deepEqual(JSON.parse(publisher.calls[6]), ENERGY_REALTIME_NARRATION.completeCommands);
    assert.doesNotMatch(publisher.calls.join('\n'), ENERGY_FORBIDDEN_COMMANDS);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await ingress.close();
  }
});

test('all four narration definitions preempt in the final base-to-realtime-to-security-to-energy-to-base cycle', async () => {
  const executor = commandExecutor();
  const clock = manualWait();
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: callbackClient(), logger: logger(), wait: clock.wait
  });
  const definitions = [
    PARK_BASE_OVERVIEW,
    PARK_REALTIME_NARRATION,
    SECURITY_REALTIME_NARRATION,
    ENERGY_REALTIME_NARRATION,
    PARK_BASE_OVERVIEW
  ];
  const sessions = [];
  let started = manager.startNarration({ definition: definitions[0], context: context(undefined, '0'), language: 'zh-CN' });
  sessions.push(started.session);
  await eventually(() => clock.calls.length === 1);

  for (let index = 1; index < definitions.length; index += 1) {
    const previous = sessions.at(-1);
    started = manager.startNarration({ definition: definitions[index], context: context(undefined, String(index)), language: 'zh-CN' });
    sessions.push(started.session);
    await eventually(() => executor.calls.some((call) => call.meta.source === `narration:${previous.scenario}:cancel`));
    await eventually(() => clock.calls.length === index + 1);
    assert.equal(executor.calls.some((call) => call.meta.source === `narration:${previous.scenario}:complete`), false);
  }

  await manager.cancelActiveNarration('test final preemption cycle');
  await Promise.all(sessions.map((session) => session.runPromise));
  assert.equal(manager.getActiveSession(), null);
  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:parkRealtimeNarration:segment-2'), false);
  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:securityRealtimeNarration:segment-2'), false);
  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:energyRealtimeNarration:segment-2'), false);
});

function testNarrationDefinition({ scenario = 'testNarration', prepareCommands, introDelayMs, segments }) {
  return {
    scenario,
    action: scenario,
    ...(prepareCommands === undefined ? {} : { prepareCommands }),
    ...(introDelayMs === undefined ? {} : { introDelayMs }),
    startCommands: [{ action: 'testStart', params: {} }],
    segments: segments || [{
      index: 1,
      commands: [],
      content: { 'zh-CN': { text: 'test segment', durationMs: 1000 } }
    }],
    completeCommands: [{ action: 'testFinish', params: {} }],
    cancelCommands: [{ action: 'testCancel', params: {} }]
  };
}

test('prepareCommands run before introDelay, which blocks startCommands and the first callback', async () => {
  const executor = commandExecutor();
  const callback = callbackClient();
  const clock = manualWait({ autoResolveIntroDelay: false });
  const definition = testNarrationDefinition({
    prepareCommands: [{ action: 'testPrepare', params: {} }], introDelayMs: 4000
  });
  const manager = createNarrationSessionManager({ commandExecutor: executor, callbackClient: callback, logger: logger(), wait: clock.wait });
  const started = manager.startNarration({ definition, context: context(), language: 'zh-CN' });

  await eventually(() => clock.calls.length === 1);
  assert.equal(clock.calls[0].ms, 4000);
  assert.deepEqual(executor.calls.map((call) => call.meta.source), ['narration:testNarration:prepare']);
  assert.equal(callback.calls.length, 0);

  clock.calls[0].resolve();
  await eventually(() => clock.calls.length === 2 && callback.calls.length === 1);
  assert.deepEqual(executor.calls.map((call) => call.meta.source), [
    'narration:testNarration:prepare', 'narration:testNarration:start'
  ]);
  clock.calls[1].resolve();
  await started.session.runPromise;
});

test('missing or zero introDelayMs remains compatible and does not add a wait', async () => {
  for (const introDelayMs of [undefined, 0]) {
    const executor = commandExecutor();
    const callback = callbackClient();
    const clock = manualWait({ autoResolveIntroDelay: false });
    const definition = testNarrationDefinition({ introDelayMs });
    const manager = createNarrationSessionManager({ commandExecutor: executor, callbackClient: callback, logger: logger(), wait: clock.wait });
    const started = manager.startNarration({ definition, context: context(), language: 'zh-CN' });
    await eventually(() => clock.calls.length === 1 && callback.calls.length === 1);
    assert.equal(clock.calls[0].ms, 1000);
    assert.deepEqual(executor.calls.map((call) => call.meta.source), ['narration:testNarration:start']);
    clock.calls[0].resolve();
    await started.session.runPromise;
  }
});

test('preemption during introDelay aborts the old session before start, callback, segment, or finish', async () => {
  const executor = commandExecutor();
  const callback = callbackClient();
  const clock = manualWait({ autoResolveIntroDelay: false });
  const definitionA = testNarrationDefinition({
    scenario: 'introA', prepareCommands: [{ action: 'prepareA', params: {} }], introDelayMs: 4000
  });
  const definitionB = testNarrationDefinition({
    scenario: 'introB', prepareCommands: [{ action: 'prepareB', params: {} }], introDelayMs: 4000
  });
  const manager = createNarrationSessionManager({ commandExecutor: executor, callbackClient: callback, logger: logger(), wait: clock.wait });
  const first = manager.startNarration({ definition: definitionA, context: context(undefined, 'A'), language: 'zh-CN' });
  await eventually(() => clock.calls.length === 1);
  const second = manager.startNarration({ definition: definitionB, context: context(undefined, 'B'), language: 'zh-CN' });
  await eventually(() => first.session.state === 'completed' && clock.calls.length === 2);

  assert.equal(executor.calls.some((call) => call.meta.source.startsWith('narration:introA:start')), false);
  assert.equal(executor.calls.some((call) => call.meta.source.startsWith('narration:introA:segment')), false);
  assert.equal(executor.calls.some((call) => call.meta.source.startsWith('narration:introA:complete')), false);
  assert.equal(executor.calls.some((call) => call.meta.source.startsWith('narration:introA:cancel')), false);
  assert.equal(callback.calls.length, 0);

  clock.calls[1].resolve();
  await eventually(() => clock.calls.length === 3 && callback.calls.length === 1);
  clock.calls[2].resolve();
  await second.session.runPromise;
  assert.equal(manager.getActiveSession(), null);
});

test('postGapMs is independent of duration scale and is applied before the next segment', async () => {
  const executor = commandExecutor();
  const callback = callbackClient();
  const clock = manualWait({ autoResolveIntroDelay: false });
  const definition = testNarrationDefinition({
    segments: [
      { index: 1, commands: [], postGapMs: 500, content: { 'zh-CN': { text: 'one', durationMs: 1000 } } },
      { index: 2, commands: [{ action: 'testStepTwo', params: {} }], content: { 'zh-CN': { text: 'two', durationMs: 1000 } } }
    ]
  });
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: callback, logger: logger(), durationScale: 0.1, wait: clock.wait
  });
  const started = manager.startNarration({ definition, context: context(), language: 'zh-CN' });
  await eventually(() => clock.calls.length === 1 && callback.calls.length === 1);
  assert.equal(clock.calls[0].ms, 600);
  assert.equal(executor.calls.some((call) => call.meta.source.endsWith('segment-2')), false);
  clock.calls[0].resolve();
  await eventually(() => clock.calls.length === 2 && callback.calls.length === 2);
  assert.equal(clock.calls[1].ms, 100);
  assert.equal(executor.calls.some((call) => call.meta.source.endsWith('segment-2')), true);
  clock.calls[1].resolve();
  await started.session.runPromise;
});

test('ttsStartupBufferMs defaults to zero for definitions that do not configure it', () => {
  const content = { durationMs: 1000 };
  assert.equal(getEffectiveSegmentDurationMs(content, {}, 1), 1000);
  assert.equal(getEffectiveSegmentDurationMs(content, { postGapMs: 500 }, 0.1), 600);
});

test('ttsStartupBufferMs is added to the segment wait budget and duration scale only affects speech duration', () => {
  const content = { durationMs: 10000 };
  const segment = { ttsStartupBufferMs: 4000, postGapMs: 1000 };
  assert.equal(getEffectiveSegmentDurationMs(content, segment, 1), 15000);
  assert.equal(getEffectiveSegmentDurationMs(content, segment, 0.1), 6000);
});

test('ttsStartupBufferMs does not delay the current segment callback', async () => {
  const executor = commandExecutor();
  const callback = callbackClient();
  const clock = manualWait({ autoResolveIntroDelay: false });
  const definition = testNarrationDefinition({
    segments: [
      {
        index: 1, commands: [{ action: 'testStepOne', params: {} }], ttsStartupBufferMs: 4000, postGapMs: 1000,
        content: { 'zh-CN': { text: 'one', durationMs: 10000 } }
      },
      {
        index: 2, commands: [{ action: 'testStepTwo', params: {} }],
        content: { 'zh-CN': { text: 'two', durationMs: 1000 } }
      }
    ]
  });
  const manager = createNarrationSessionManager({ commandExecutor: executor, callbackClient: callback, logger: logger(), wait: clock.wait });
  const started = manager.startNarration({ definition, context: context(), language: 'zh-CN' });

  await eventually(() => clock.calls.length === 1 && callback.calls.length === 1);
  assert.deepEqual(executor.calls.map((call) => call.meta.source), [
    'narration:testNarration:start', 'narration:testNarration:segment-1'
  ]);
  assert.equal(clock.calls[0].ms, 15000);
  assert.equal(executor.calls.some((call) => call.meta.source.endsWith('segment-2')), false);

  clock.calls[0].resolve();
  await eventually(() => clock.calls.length === 2 && callback.calls.length === 2);
  clock.calls[1].resolve();
  await started.session.runPromise;
});

test('preemption during a ttsStartupBufferMs wait prevents later steps, callbacks, and finish', async () => {
  const executor = commandExecutor();
  const callback = callbackClient();
  const clock = manualWait({ autoResolveIntroDelay: false });
  const definitionA = testNarrationDefinition({
    scenario: 'bufferA',
    segments: [
      { index: 1, commands: [], ttsStartupBufferMs: 4000, content: { 'zh-CN': { text: 'one', durationMs: 1000 } } },
      { index: 2, commands: [{ action: 'bufferAStepTwo', params: {} }], content: { 'zh-CN': { text: 'two', durationMs: 1000 } } }
    ]
  });
  const definitionB = testNarrationDefinition({ scenario: 'bufferB' });
  const manager = createNarrationSessionManager({ commandExecutor: executor, callbackClient: callback, logger: logger(), wait: clock.wait });
  const first = manager.startNarration({ definition: definitionA, context: context(undefined, 'A'), language: 'zh-CN' });

  await eventually(() => clock.calls.length === 1 && callback.calls.length === 1);
  assert.equal(clock.calls[0].ms, 5000);
  const second = manager.startNarration({ definition: definitionB, context: context(undefined, 'B'), language: 'zh-CN' });
  await eventually(() => first.session.state === 'completed' && clock.calls.length === 2 && callback.calls.length === 2);

  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:bufferA:segment-2'), false);
  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:bufferA:complete'), false);
  assert.equal(callback.calls.some((call) => call.options.scenario === 'bufferA' && call.options.segmentIndex === 2), false);

  clock.calls[1].resolve();
  await second.session.runPromise;
  assert.equal(manager.getActiveSession(), null);
});

test('minimumIocHoldMs compares the startup-plus-speech budget before adding postGapMs', () => {
  assert.equal(
    getEffectiveSegmentDurationMs({ durationMs: 20000 }, { ttsStartupBufferMs: 4000, minimumIocHoldMs: 30000, postGapMs: 0 }, 1),
    30000
  );
  assert.equal(
    getEffectiveSegmentDurationMs({ durationMs: 30000 }, { ttsStartupBufferMs: 4000, minimumIocHoldMs: 30000, postGapMs: 0 }, 1),
    34000
  );
});

test('minimumIocHoldMs remains unscaled and postGapMs is added after the protected hold', async () => {
  for (const postGapMs of [0, 500]) {
    const executor = commandExecutor();
    const clock = manualWait({ autoResolveIntroDelay: false });
    const definition = testNarrationDefinition({
      introDelayMs: 4000,
      segments: [{
        index: 1, commands: [], minimumIocHoldMs: 30000, postGapMs,
        content: { 'zh-CN': { text: 'protected', durationMs: 1000 } }
      }]
    });
    const manager = createNarrationSessionManager({
      commandExecutor: executor, callbackClient: callbackClient(), logger: logger(), durationScale: 0.1, wait: clock.wait
    });
    const started = manager.startNarration({ definition, context: context(), language: 'zh-CN' });
    await eventually(() => clock.calls.length === 1);
    assert.equal(clock.calls[0].ms, 4000);
    clock.calls[0].resolve();
    await eventually(() => clock.calls.length === 2);
    assert.equal(clock.calls[1].ms, 30000 + postGapMs);
    clock.calls[1].resolve();
    await started.session.runPromise;
  }
});

test('all production narration definitions freeze the calibrated durations, startup buffers, post gaps, prepare commands, and intros', () => {
  const definitions = [
    [PARK_REALTIME_NARRATION, '综合态势', [14000, 5000, 7500, 9500, 17000], [11000, 7000, 11500, 10000, 17000], [4000, 4000, 4000, 4000, 0], [1500, 1000, 1500, 1000, 2000]],
    [SECURITY_REALTIME_NARRATION, '综合安防', [12000, 5000, 5000, 10000, 16500], [11000, 6000, 6000, 11000, 17000], [4000, 4000, 6000, 4000, 0], [1500, 1000, 1000, 1500, 2000]],
    [ENERGY_REALTIME_NARRATION, '能源管理', [27000, 7000, 7000, 8500, 16000], [31500, 9000, 7000, 10000, 17000], [0, 4000, 4000, 4000, 0], [3000, 1000, 1000, 1000, 2000]]
  ];
  for (const [definition, theme, zhDurations, enDurations, startupBuffers, postGaps] of definitions) {
    assert.equal(definition.introDelayMs, 4000);
    assert.deepEqual(definition.prepareCommands, [{ action: '主题切换', params: { '主题名称': theme } }]);
    assert.equal(definition.startCommands.some((item) => item.action === '主题切换'), false);
    assert.deepEqual(definition.segments.map((item) => item.content['zh-CN'].durationMs), zhDurations);
    assert.deepEqual(definition.segments.map((item) => item.content['en-US'].durationMs), enDurations);
    assert.deepEqual(definition.segments.map((item) => item.ttsStartupBufferMs), startupBuffers);
    assert.deepEqual(definition.segments.map((item) => item.postGapMs), postGaps);
    assert.deepEqual(
      definition.segments.flatMap((item) => [item.postGapMs, item.postGapMs]),
      postGaps.flatMap((postGapMs) => [postGapMs, postGapMs])
    );
  }
  assert.equal(PARK_BASE_OVERVIEW.introDelayMs, 4000);
  assert.equal(PARK_BASE_OVERVIEW.segments[0].content['zh-CN'].durationMs, 20000);
  assert.equal(PARK_BASE_OVERVIEW.segments[0].content['en-US'].durationMs, 22000);
  assert.equal(PARK_BASE_OVERVIEW.segments[0].ttsStartupBufferMs || 0, 0);
  assert.equal(PARK_BASE_OVERVIEW.segments[0].postGapMs || 0, 0);
  assert.equal(PARK_BASE_OVERVIEW.segments[0].minimumIocHoldMs, 30000);
});
