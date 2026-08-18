const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createApp } = require('../src/server');
const { createMqttPublisher } = require('../src/mqtt-client');
const { readConfig, sanitizeMqttUrl } = require('../src/config');
const { validateFrontendCommands } = require('../src/validation');
const { HC_BUSINESS_REGISTRY, HC_COMMAND_REGISTRY } = require('../src/hc-command-registry');

function createPublisher({ connected = true, publishError = null } = {}) {
  const calls = [];
  return {
    calls,
    isConnected: () => connected,
    publish: async (message) => {
      calls.push(message);
      if (publishError) throw publishError;
    }
  };
}

function createLogger() {
  return { info() {}, warn() {}, error() {} };
}

async function request(publisher, method, path, body, { rawBody = false } = {}) {
  const app = createApp({ publisher, logger: createLogger(), mqttTopic: 'lianqiuhu/ioc/demo/commands' });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : rawBody ? body : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const validCommand = { action: '主题切换', params: { '主题名称': '综合安防' } };
const validEnv = {
  PORT: '8008',
  MQTT_URL: 'mqtts://broker.example:8883',
  MQTT_USERNAME: 'executor',
  MQTT_PASSWORD: 'secret',
  MQTT_TOPIC: 'lianqiuhu/ioc/demo/commands',
  MQTT_QOS: '0',
  MQTT_RETAIN: 'false'
};

test('GET /health returns service status', async () => {
  const response = await request(createPublisher(), 'GET', '/health');
  assert.deepEqual(response, { status: 200, body: { ok: true, mqttConnected: true, status: 'ready' } });
});

test('GET /health reports disconnected MQTT', async () => {
  const response = await request(createPublisher({ connected: false }), 'GET', '/health');
  assert.equal(response.body.mqttConnected, false);
  assert.equal(response.body.status, 'mqtt_unavailable');
});

test('non-array body returns 400', async () => assert.equal((await request(createPublisher(), 'POST', '/api/commands', {})).status, 400));
test('empty array returns 400', async () => assert.equal((await request(createPublisher(), 'POST', '/api/commands', [])).status, 400));
test('non-object array item returns 400', async () => assert.equal((await request(createPublisher(), 'POST', '/api/commands', ['x'])).status, 400));
test('missing action returns 400', async () => assert.equal((await request(createPublisher(), 'POST', '/api/commands', [{}])).status, 400));
test('empty action returns 400', async () => assert.equal((await request(createPublisher(), 'POST', '/api/commands', [{ action: ' ' }])).status, 400));
test('non-object params returns 400', async () => assert.equal((await request(createPublisher(), 'POST', '/api/commands', [{ action: 'a', params: [] }])).status, 400));

test('invalid JSON returns 400 without publishing', async () => {
  const publisher = createPublisher();
  const response = await request(publisher, 'POST', '/api/commands', '[{"action":', { rawBody: true });
  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error, 'invalid JSON request body');
  assert.equal(publisher.calls.length, 0);
});

test('frontend command is published unchanged for compatible direct callers', async () => {
  const publisher = createPublisher();
  const commands = [{ action: '主题切换', params: { '主题名称': '综合安防' } }];
  assert.equal((await request(publisher, 'POST', '/api/commands', commands)).status, 200);
  assert.equal(publisher.calls[0], JSON.stringify(commands));
});

test('valid request calls MQTT publish', async () => {
  const publisher = createPublisher();
  await request(publisher, 'POST', '/api/commands', [validCommand]);
  assert.equal(publisher.calls.length, 1);
});

test('published compatible frontend content is direct serialization of original array', async () => {
  const publisher = createPublisher();
  const commands = [{ action: 'executeCapability', params: { capability: 'situation.parkRealTimeOperation', command: 'start' } }];
  await request(publisher, 'POST', '/api/commands', commands);
  assert.equal(publisher.calls[0], JSON.stringify(commands));
});

test('valid 启动园区实时运营情况 expands to its frozen frontend capability command', async () => {
  const publisher = createPublisher();
  const response = await request(publisher, 'POST', '/api/commands', [{
    action: '启动园区实时运营情况', params: { command: 'start' }
  }]);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(publisher.calls[0]), [{
    action: '主题切换', params: { '主题名称': '综合态势' }
  }, {
    action: 'executeCapability', params: { capability: 'situation.parkRealTimeOperation', command: 'start' }
  }]);
  assert.equal(validateFrontendCommands(JSON.parse(publisher.calls[0])), null);
  assert.equal(publisher.calls[0].includes('启动园区实时运营情况'), false);
});

test('valid 取消园区实时运营情况 expands to the real cancel lifecycle command', async () => {
  const publisher = createPublisher();
  const response = await request(publisher, 'POST', '/api/commands', [{
    action: '取消园区实时运营情况', params: { command: 'cancel' }
  }]);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(publisher.calls[0]), [{
    action: 'executeCapability', params: { capability: 'situation.parkRealTimeOperation', command: 'cancel' }
  }]);
});

test('AI节能助手 start uses the frozen full Scenario and cancel uses its parent lifecycle command', async () => {
  const publisher = createPublisher();
  for (const [action, command] of [['启动AI节能助手', 'start'], ['取消AI节能助手', 'cancel']]) {
    const response = await request(publisher, 'POST', '/api/commands', [{ action, params: { command } }]);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(publisher.calls.at(-1)), command === 'start' ? [
      { action: '主题切换', params: { '主题名称': '能源管理' } },
      { action: 'executeCapability', params: { capability: 'energy.aiEnergyAssistant', command: 'start' } },
      { action: 'executeOperation', params: { capability: 'energy.aiEnergyAssistant', operation: 'deviceStatusSliders', command: 'demonstrate' } }
    ] : [
      { action: 'executeCapability', params: { capability: 'energy.aiEnergyAssistant', command: 'cancel' } }
    ]);
  }
});

const frontendCommand = (action, params) => ({ action, params });
const frontendCapability = (capability, command) => frontendCommand('executeCapability', { capability, command });
const frontendTheme = (name) => frontendCommand('主题切换', { '主题名称': name });

// 该表独立于执行器 Registry：它锁定项目负责人给定的 17 个 OSCA 名称及前端冻结展开结果。
const expectedBusinessDefinitions = [
  ['园区实时运营情况', [frontendTheme('综合态势'), frontendCapability('situation.parkRealTimeOperation', 'start')], [frontendCapability('situation.parkRealTimeOperation', 'cancel')]],
  ['未佩戴安全帽告警', [frontendTheme('综合安防'), frontendCapability('security.noHardHatAlert', 'start'), frontendCommand('executeOperation', { capability: 'security.noHardHatAlert', operation: 'video', command: 'open' })], [frontendCapability('security.noHardHatAlert', 'cancel')]],
  ['火灾预警', [frontendTheme('综合安防'), frontendCapability('security.fireAlarmAlert', 'start'), frontendCommand('executeOperation', { capability: 'security.fireAlarmAlert', operation: 'emergencyCall', command: 'call' }), frontendCommand('executeOperation', { capability: 'security.fireAlarmAlert', operation: 'door', command: 'open' }), frontendCommand('executeOperation', { capability: 'security.fireAlarmAlert', operation: 'door', command: 'close' }), frontendCommand('executeOperation', { capability: 'security.fireAlarmAlert', operation: 'emergencyTeam', command: 'notify' }), frontendCommand('executeOperation', { capability: 'security.fireAlarmAlert', operation: 'smsNotification', command: 'notify', radius: 100 })], [frontendCapability('security.fireAlarmAlert', 'cancel')]],
  ['智慧考勤统计', [frontendTheme('便捷通行'), frontendCapability('access.smartAttendanceAlert', 'start')], [frontendCapability('access.smartAttendanceAlert', 'cancel')]],
  ['资产盘点', [frontendTheme('资产管理'), frontendCapability('asset.assetInventory', 'start'), frontendCommand('executeOperation', { capability: 'asset.assetInventory', operation: 'trajectory', command: 'toggle' })], [frontendCapability('asset.assetInventory', 'cancel')]],
  ['资产非法外出告警', [frontendTheme('资产管理'), frontendCapability('asset.illegalOutingAlert', 'start'), frontendCommand('executeOperation', { capability: 'asset.illegalOutingAlert', operation: 'track', command: 'show' }), frontendCommand('executeOperation', { capability: 'asset.illegalOutingAlert', operation: 'video', command: 'show' })], [frontendCapability('asset.illegalOutingAlert', 'cancel')]],
  ['设备巡检告警', [frontendTheme('设施管理'), frontendCapability('facility.equipmentInspectionAlert', 'start'), frontendCommand('executeOperation', { capability: 'facility.equipmentInspectionAlert', operation: 'remoteDiagnosis', command: 'open' }), frontendCommand('executeOperation', { capability: 'facility.equipmentInspectionAlert', operation: 'meeting', command: 'invite' })], [frontendCapability('facility.equipmentInspectionAlert', 'cancel')]],
  ['AI节能助手', [frontendTheme('能源管理'), frontendCapability('energy.aiEnergyAssistant', 'start'), frontendCommand('executeOperation', { capability: 'energy.aiEnergyAssistant', operation: 'deviceStatusSliders', command: 'demonstrate' })], [frontendCapability('energy.aiEnergyAssistant', 'cancel')]],
  ['AI算法', [frontendTheme('能源管理'), frontendCapability('energy.aiAlgorithm', 'start')], [frontendCapability('energy.aiAlgorithm', 'cancel')]],
  ['能流分析', [frontendTheme('能源管理'), frontendCapability('energy.energyFlow', 'start')], [frontendCapability('energy.energyFlow', 'cancel')]],
  ['光伏监测', [frontendTheme('能源管理'), frontendCapability('energy.photovoltaicMonitoring', 'start')], [frontendCapability('energy.photovoltaicMonitoring', 'cancel')]],
  ['充电桩管理', [frontendTheme('能源管理'), frontendCapability('energy.chargingPileManagement', 'start')], [frontendCapability('energy.chargingPileManagement', 'cancel')]],
  ['VIP会议室', [frontendTheme('办公会议'), frontendCapability('office.harmonyMeetingRoom', 'start'), frontendCommand('executeOperation', { capability: 'office.harmonyMeetingRoom', operation: 'meetingRoom', command: 'select', roomId: 'meeting-room1' })], [frontendCapability('office.harmonyMeetingRoom', 'cancel')]],
  ['Wi-Fi防偷拍检测', [frontendTheme('办公会议'), frontendCapability('office.wifiAntiSpyAlert', 'start'), frontendCommand('executeOperation', { capability: 'office.wifiAntiSpyAlert', operation: 'workOrder', command: 'dispatch' })], [frontendCapability('office.wifiAntiSpyAlert', 'cancel')]],
  ['办公网络', [frontendTheme('网络体验'), frontendCapability('network.officeNetwork', 'start')], [frontendCapability('network.officeNetwork', 'cancel')]],
  ['VIP客户网络异常', [frontendTheme('网络体验'), frontendCapability('network.vipCustomerNetworkAlert', 'start'), frontendCommand('executeOperation', { capability: 'network.vipCustomerNetworkAlert', operation: 'disposal', command: 'execute', userId: 'VIP12-exception' })], [frontendCapability('network.vipCustomerNetworkAlert', 'cancel')]],
  ['方案架构图', [frontendCapability('global.solutionArchitecture', 'start')], [frontendCapability('global.solutionArchitecture', 'cancel')]]
];

test('all 17 HC businesses and 34 semantic actions expand to their frozen frontend arrays', async () => {
  assert.equal(HC_BUSINESS_REGISTRY.length, 17);
  assert.equal(Object.keys(HC_COMMAND_REGISTRY).length, 34);
  for (const [name, expectedStart, expectedCancel] of expectedBusinessDefinitions) {
    for (const [prefix, command, expected] of [['启动', 'start', expectedStart], ['取消', 'cancel', expectedCancel]]) {
      const action = `${prefix}${name}`;
      const publisher = createPublisher();
      const response = await request(publisher, 'POST', '/api/commands', [{ action, params: { command } }]);
      assert.equal(response.status, 200, action);
      const expanded = JSON.parse(publisher.calls[0]);
      assert.deepEqual(expanded, expected, action);
      assert.equal(validateFrontendCommands(expanded), null, action);
      assert.equal(publisher.calls[0].includes(action), false, action);
    }
  }
});

test('HC Registry is complete, paired, exact, and contains only valid frontend expansions', () => {
  const actions = Object.keys(HC_COMMAND_REGISTRY);
  assert.equal(new Set(actions).size, 34);
  for (const business of HC_BUSINESS_REGISTRY) {
    const start = HC_COMMAND_REGISTRY[`启动${business.name}`];
    const cancel = HC_COMMAND_REGISTRY[`取消${business.name}`];
    assert.equal(start.businessName, business.name);
    assert.equal(start.command, 'start');
    assert.equal(cancel.businessName, business.name);
    assert.equal(cancel.command, 'cancel');
    for (const definition of [start, cancel]) {
      assert.ok(definition.commands.length > 0);
      assert.equal(validateFrontendCommands(definition.commands), null);
      for (const item of definition.commands) {
        assert.ok(item.action);
        assert.ok(item.params);
        assert.equal(item.action.includes(definition.businessName), false);
      }
    }
  }
});

test('all 34 semantic actions reject missing, mismatched, illegal, and uppercase commands', async () => {
  for (const [action, definition] of Object.entries(HC_COMMAND_REGISTRY)) {
    const invalidParams = [
      {},
      { command: definition.command === 'start' ? 'cancel' : 'start' },
      { command: 'stop' },
      { command: definition.command.toUpperCase() }
    ];
    for (const params of invalidParams) {
      const publisher = createPublisher();
      const response = await request(publisher, 'POST', '/api/commands', [{ action, params }]);
      assert.equal(response.status, 400, `${action} ${JSON.stringify(params)}`);
      assert.equal(publisher.calls.length, 0, action);
    }
  }
});

test('HC action and command must match exactly', async () => {
  for (const body of [
    [{ action: '启动园区实时运营情况', params: { command: 'cancel' } }],
    [{ action: '取消园区实时运营情况', params: { command: 'start' } }],
    [{ action: '启动园区实时运营情况', params: { command: 'START' } }],
    [{ action: '启动园区实时运营情况', params: { command: 'stop' } }],
    [{ action: '启动园区实时运营情况', params: {} }]
  ]) {
    const publisher = createPublisher();
    const response = await request(publisher, 'POST', '/api/commands', body);
    assert.equal(response.status, 400);
    assert.equal(publisher.calls.length, 0);
  }
});

test('unregistered and legacy unprefixed HC actions are rejected', async () => {
  for (const action of ['启动未知业务', '取消未知业务', ...HC_BUSINESS_REGISTRY.map((item) => item.name)]) {
    const publisher = createPublisher();
    const response = await request(publisher, 'POST', '/api/commands', [{ action, params: { command: 'start' } }]);
    assert.equal(response.status, 400);
    assert.equal(publisher.calls.length, 0);
  }
});

test('MQTT publisher passes connection and publish options to MQTT.js', async () => {
  const client = new EventEmitter();
  client.connected = false;
  let connectUrl;
  let connectOptions;
  let publishCall;
  client.publish = (topic, message, options, callback) => {
    publishCall = { topic, message, options };
    callback();
  };
  client.end = () => {
    client.connected = false;
    client.emit('close');
  };
  const publisher = createMqttPublisher({
    mqttUrl: validEnv.MQTT_URL, mqttUsername: validEnv.MQTT_USERNAME, mqttPassword: validEnv.MQTT_PASSWORD,
    mqttTopic: validEnv.MQTT_TOPIC
  }, createLogger(), { connect: (url, options) => {
    connectUrl = url;
    connectOptions = options;
    return client;
  } });
  assert.equal(connectUrl, validEnv.MQTT_URL);
  assert.equal(connectOptions.username, validEnv.MQTT_USERNAME);
  assert.equal(connectOptions.password, validEnv.MQTT_PASSWORD);
  assert.equal(connectOptions.reconnectPeriod, 1000);
  assert.equal(connectOptions.queueQoSZero, false);
  client.connected = true;
  client.emit('connect');
  assert.equal(publisher.isConnected(), true);
  await publisher.publish('[]');
  assert.deepEqual(publishCall, {
    topic: validEnv.MQTT_TOPIC, message: '[]', options: { qos: 0, retain: false }
  });
  publisher.close();
  assert.equal(publisher.isConnected(), false);
});

test('MQTT publisher rejects when MQTT.js publish callback reports an error', async () => {
  const client = new EventEmitter();
  client.connected = true;
  client.publish = (topic, message, options, callback) => callback(new Error('publish failed'));
  const publisher = createMqttPublisher({
    mqttUrl: validEnv.MQTT_URL, mqttUsername: validEnv.MQTT_USERNAME, mqttPassword: validEnv.MQTT_PASSWORD,
    mqttTopic: validEnv.MQTT_TOPIC
  }, createLogger(), { connect: () => client });
  client.emit('connect');
  await assert.rejects(publisher.publish('[]'), /publish failed/);
});

test('unavailable MQTT returns 503 without publishing', async () => {
  const publisher = createPublisher({ connected: false });
  const response = await request(publisher, 'POST', '/api/commands', [validCommand]);
  assert.equal(response.status, 503);
  assert.equal(publisher.calls.length, 0);
});

test('MQTT publish callback failure is returned as 500', async () => {
  const response = await request(createPublisher({ publishError: new Error('broker error') }), 'POST', '/api/commands', [validCommand]);
  assert.equal(response.status, 500);
  assert.equal(response.body.ok, false);
});

test('successful MQTT publish returns 200', async () => {
  const response = await request(createPublisher(), 'POST', '/api/commands', [validCommand]);
  assert.deepEqual(response, { status: 200, body: { ok: true, message: 'commands published' } });
});

test('multiple commands are published once as one array', async () => {
  const publisher = createPublisher();
  const commands = [validCommand, { action: '主题切换', params: { '主题名称': '能源管理' } }];
  await request(publisher, 'POST', '/api/commands', commands);
  assert.deepEqual(publisher.calls, [JSON.stringify(commands)]);
});

test('readConfig accepts a valid first-phase configuration', () => {
  assert.deepEqual(readConfig(validEnv), {
    port: 8008, mqttUrl: validEnv.MQTT_URL, mqttUsername: validEnv.MQTT_USERNAME,
    mqttPassword: validEnv.MQTT_PASSWORD, mqttTopic: validEnv.MQTT_TOPIC,
    mqttQos: 0, mqttRetain: false
  });
});

test('readConfig rejects a non-mqtts URL', () => {
  assert.throws(() => readConfig({ ...validEnv, MQTT_URL: 'mqtt://broker.example:1883' }), /mqtts/);
});

test('readConfig rejects a QoS other than 0', () => {
  assert.throws(() => readConfig({ ...validEnv, MQTT_QOS: '1' }), /MQTT_QOS/);
});

test('readConfig rejects retain other than false', () => {
  assert.throws(() => readConfig({ ...validEnv, MQTT_RETAIN: 'true' }), /MQTT_RETAIN/);
});

test('readConfig rejects an invalid port', () => {
  assert.throws(() => readConfig({ ...validEnv, PORT: '70000' }), /PORT/);
});

test('sanitizeMqttUrl removes MQTT credentials', () => {
  const sanitized = sanitizeMqttUrl('mqtts://sensitive-user:sensitive-password@broker.example:8883');
  assert.equal(sanitized, 'mqtts://broker.example:8883');
  assert.equal(sanitized.includes('sensitive-user'), false);
  assert.equal(sanitized.includes('sensitive-password'), false);
});
