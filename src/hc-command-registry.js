const command = (action, params) => Object.freeze({ action, params: Object.freeze({ ...params }) });
const capability = (name, commandName) => command('executeCapability', { capability: name, command: commandName });
const theme = (name) => command('主题切换', { '主题名称': name });

// 来源：当前前端 park-ai Scenario Registry 与 Business Command Registry。
// OSCA 只传本文件中的中文业务名称；capability、operation、固定参数均不得由 OSCA 覆盖。
const HC_BUSINESS_REGISTRY = Object.freeze([
  // parkOverview 仅作为产品定义的启动指令暴露；前端 cancel 生命周期不属于 HC 指令集。
  Object.freeze({ name: '园区总览', start: Object.freeze([
    theme('综合态势'), capability('situation.parkOverview', 'start')
  ]), cancel: null }),
  Object.freeze({ name: '园区实时运营情况', start: Object.freeze([
    theme('综合态势'), capability('situation.parkRealTimeOperation', 'start')
  ]), cancel: Object.freeze([capability('situation.parkRealTimeOperation', 'cancel')]) }),
  Object.freeze({ name: '未佩戴安全帽告警', start: Object.freeze([
    theme('综合安防'),
    capability('security.noHardHatAlert', 'start'),
    command('executeOperation', { capability: 'security.noHardHatAlert', operation: 'video', command: 'open' })
  ]), cancel: Object.freeze([capability('security.noHardHatAlert', 'cancel')]) }),
  // HC 第三方平台仅控制 iframe/Dialog，不属于 Narration，也不依赖 callback。
  Object.freeze({ name: '安防第三方AI', start: Object.freeze([
    theme('综合安防'), capability('security.thirdPartyAgent', 'start')
  ]), cancel: Object.freeze([capability('security.thirdPartyAgent', 'cancel')]) }),
  // fireAlarmFullFlow：短信 radius=100 为前端冻结参数。
  Object.freeze({ name: '火灾预警', start: Object.freeze([
    theme('综合安防'),
    capability('security.fireAlarmAlert', 'start'),
    command('executeOperation', { capability: 'security.fireAlarmAlert', operation: 'emergencyCall', command: 'call' }),
    command('executeOperation', { capability: 'security.fireAlarmAlert', operation: 'door', command: 'open' }),
    command('executeOperation', { capability: 'security.fireAlarmAlert', operation: 'door', command: 'close' }),
    command('executeOperation', { capability: 'security.fireAlarmAlert', operation: 'emergencyTeam', command: 'notify' }),
    command('executeOperation', { capability: 'security.fireAlarmAlert', operation: 'smsNotification', command: 'notify', radius: 100 })
  ]), cancel: Object.freeze([capability('security.fireAlarmAlert', 'cancel')]) }),
  Object.freeze({ name: '智慧考勤统计', start: Object.freeze([
    theme('便捷通行'), capability('access.smartAttendanceAlert', 'start')
  ]), cancel: Object.freeze([capability('access.smartAttendanceAlert', 'cancel')]) }),
  // assetInventoryFullFlow。
  Object.freeze({ name: '资产盘点', start: Object.freeze([
    theme('资产管理'),
    capability('asset.assetInventory', 'start'),
    command('executeOperation', { capability: 'asset.assetInventory', operation: 'trajectory', command: 'toggle' })
  ]), cancel: Object.freeze([capability('asset.assetInventory', 'cancel')]) }),
  Object.freeze({ name: '资产非法外出告警', start: Object.freeze([
    theme('资产管理'),
    capability('asset.illegalOutingAlert', 'start'),
    command('executeOperation', { capability: 'asset.illegalOutingAlert', operation: 'track', command: 'show' }),
    command('executeOperation', { capability: 'asset.illegalOutingAlert', operation: 'video', command: 'show' })
  ]), cancel: Object.freeze([capability('asset.illegalOutingAlert', 'cancel')]) }),
  // equipmentInspectionFullFlow。
  Object.freeze({ name: '设备巡检告警', start: Object.freeze([
    theme('设施管理'),
    capability('facility.equipmentInspectionAlert', 'start'),
    command('executeOperation', { capability: 'facility.equipmentInspectionAlert', operation: 'remoteDiagnosis', command: 'open' }),
    command('executeOperation', { capability: 'facility.equipmentInspectionAlert', operation: 'meeting', command: 'invite' })
  ]), cancel: Object.freeze([capability('facility.equipmentInspectionAlert', 'cancel')]) }),
  // aiEnergyAssistantFullFlow。
  Object.freeze({ name: 'AI节能助手', start: Object.freeze([
    theme('能源管理'),
    capability('energy.aiEnergyAssistant', 'start'),
    command('executeOperation', { capability: 'energy.aiEnergyAssistant', operation: 'deviceStatusSliders', command: 'demonstrate' })
  ]), cancel: Object.freeze([capability('energy.aiEnergyAssistant', 'cancel')]) }),
  Object.freeze({ name: 'AI算法', start: Object.freeze([
    theme('能源管理'), capability('energy.aiAlgorithm', 'start')
  ]), cancel: Object.freeze([capability('energy.aiAlgorithm', 'cancel')]) }),
  Object.freeze({ name: '能流分析', start: Object.freeze([
    theme('能源管理'), capability('energy.energyFlow', 'start')
  ]), cancel: Object.freeze([capability('energy.energyFlow', 'cancel')]) }),
  Object.freeze({ name: '光伏监测', start: Object.freeze([
    theme('能源管理'), capability('energy.photovoltaicMonitoring', 'start')
  ]), cancel: Object.freeze([capability('energy.photovoltaicMonitoring', 'cancel')]) }),
  Object.freeze({ name: '充电桩管理', start: Object.freeze([
    theme('能源管理'), capability('energy.chargingPileManagement', 'start')
  ]), cancel: Object.freeze([capability('energy.chargingPileManagement', 'cancel')]) }),
  Object.freeze({ name: '能耗第三方AI', start: Object.freeze([
    theme('能源管理'), capability('energy.thirdPartyAgent', 'start')
  ]), cancel: Object.freeze([capability('energy.thirdPartyAgent', 'cancel')]) }),
  Object.freeze({ name: 'VIP会议室', start: Object.freeze([
    theme('办公会议'),
    capability('office.harmonyMeetingRoom', 'start'),
    command('executeOperation', { capability: 'office.harmonyMeetingRoom', operation: 'meetingRoom', command: 'select', roomId: 'meeting-room1' })
  ]), cancel: Object.freeze([capability('office.harmonyMeetingRoom', 'cancel')]) }),
  Object.freeze({ name: 'Wi-Fi防偷拍检测', start: Object.freeze([
    theme('办公会议'),
    capability('office.wifiAntiSpyAlert', 'start'),
    command('executeOperation', { capability: 'office.wifiAntiSpyAlert', operation: 'workOrder', command: 'dispatch' })
  ]), cancel: Object.freeze([capability('office.wifiAntiSpyAlert', 'cancel')]) }),
  Object.freeze({ name: '办公网络', start: Object.freeze([
    theme('网络体验'), capability('network.officeNetwork', 'start')
  ]), cancel: Object.freeze([capability('network.officeNetwork', 'cancel')]) }),
  // vipCustomerNetworkFullFlow：VIP12-exception 为前端冻结参数。
  Object.freeze({ name: 'VIP客户网络异常', start: Object.freeze([
    theme('网络体验'),
    capability('network.vipCustomerNetworkAlert', 'start'),
    command('executeOperation', { capability: 'network.vipCustomerNetworkAlert', operation: 'disposal', command: 'execute', userId: 'VIP12-exception' })
  ]), cancel: Object.freeze([capability('network.vipCustomerNetworkAlert', 'cancel')]) }),
  Object.freeze({ name: '方案架构图', start: Object.freeze([
    capability('global.solutionArchitecture', 'start')
  ]), cancel: Object.freeze([capability('global.solutionArchitecture', 'cancel')]) })
]);

const createCommandRegistry = (businessRegistry) => {
  const registry = Object.create(null);
  for (const definition of businessRegistry) {
    const semanticCommands = [['启动', 'start', definition.start]];
    if (definition.cancel !== null) semanticCommands.push(['取消', 'cancel', definition.cancel]);
    for (const [prefix, commandName, template] of semanticCommands) {
      const action = `${prefix}${definition.name}`;
      if (registry[action]) throw new Error(`duplicate HC action: ${action}`);
      if (!Array.isArray(template) || template.length === 0) throw new Error(`empty HC template: ${action}`);
      registry[action] = Object.freeze({ businessName: definition.name, command: commandName, commands: template });
    }
  }
  return Object.freeze(registry);
};

const HC_COMMAND_REGISTRY = createCommandRegistry(HC_BUSINESS_REGISTRY);
const cloneCommands = (commands) => commands.map((item) => ({ action: item.action, params: { ...item.params } }));

function getHcCommandDefinition(action) {
  return Object.prototype.hasOwnProperty.call(HC_COMMAND_REGISTRY, action) ? HC_COMMAND_REGISTRY[action] : null;
}

function translateHcCommand(commandValue) {
  const definition = getHcCommandDefinition(commandValue.action);
  if (!definition) throw new Error(`unregistered HC action: ${commandValue.action}`);
  return cloneCommands(definition.commands);
}

module.exports = { HC_BUSINESS_REGISTRY, HC_COMMAND_REGISTRY, createCommandRegistry, getHcCommandDefinition, translateHcCommand };
