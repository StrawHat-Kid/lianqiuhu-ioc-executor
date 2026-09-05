const command = (action, params) => Object.freeze({ action, params: Object.freeze({ ...params }) });
const capability = (name, commandName) => command('executeCapability', { capability: name, command: commandName });
const theme = (name) => command('主题切换', { '主题名称': name });
const operationCommand = (capabilityName, operation, commandName, extra = {}) =>
  command('executeOperation', { capability: capabilityName, operation, command: commandName, ...extra });

// 来源：当前前端 park-ai Scenario Registry 与 Business Command Registry。
// OSCA 只传本文件中的中文业务名称；capability、operation、固定参数均不得由 OSCA 覆盖。
const HC_BUSINESS_REGISTRY = Object.freeze([
  // 园区总览复用既有 Quick lifecycle；取消仅关闭该 Quick，不改 Narration。
  Object.freeze({ name: '园区总览', start: Object.freeze([
    theme('综合态势'), capability('situation.parkOverview', 'start')
  ]), cancel: Object.freeze([capability('situation.parkOverview', 'cancel')]) }),
  Object.freeze({ name: '园区实时运营情况', start: Object.freeze([
    theme('综合态势'), capability('situation.parkRealTimeOperation', 'start')
  ]), cancel: Object.freeze([capability('situation.parkRealTimeOperation', 'cancel')]) }),
  Object.freeze({ name: '未佩戴安全帽告警', start: Object.freeze([
    theme('综合安防'),
    capability('security.noHardHatAlert', 'start'),
    command('executeOperation', { capability: 'security.noHardHatAlert', operation: 'video', command: 'open' })
  ]), cancel: Object.freeze([capability('security.noHardHatAlert', 'cancel')]) }),
  // HC 第三方平台仅控制 iframe/Dialog，不属于 Narration，也不依赖 callback。
  Object.freeze({ name: '园区AI安防智能体', start: Object.freeze([
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
  Object.freeze({ name: '园区AI能耗智能体', start: Object.freeze([
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
  ,Object.freeze({ name: '场景旋转', start: Object.freeze([
    capability('global.sceneRotation', 'start')
  ]), cancel: Object.freeze([capability('global.sceneRotation', 'cancel')]) })
  ,Object.freeze({ name: '视频监控', start: Object.freeze([
    theme('综合安防'), capability('security.videoMonitoring', 'start'),
    operationCommand('security.videoMonitoring', 'camera', 'select', { cameraId: 'B14_HEAT_DIS_1_BALL_CAM1' }),
    operationCommand('security.videoMonitoring', 'camera', 'select', { cameraId: 'B14_TRANSF_1_BALL_CAM2' }),
    operationCommand('security.videoMonitoring', 'camera', 'select', { cameraId: 'B14_HEAT_DIS_1_GUN2_CAR' }),
    operationCommand('security.videoMonitoring', 'camera', 'select', { cameraId: 'B14_HEAT_DIS_1_GUN1_FACE' }),
    operationCommand('security.videoMonitoring', 'camera', 'select', { cameraId: 'B14_HEAT_DIS_1_PANO_CAM1' })
  ]), cancel: Object.freeze([capability('security.videoMonitoring', 'cancel')]) })
  ,Object.freeze({ name: 'AI机器人', start: Object.freeze([
    theme('综合安防'), capability('security.aiRobot', 'start'),
    operationCommand('security.aiRobot', 'patrolPoint', 'select', { pointId: 'inspection_point2' })
  ]), cancel: Object.freeze([capability('security.aiRobot', 'cancel')]) })
  ,Object.freeze({ name: '安防人员', start: Object.freeze([
    theme('综合安防'), capability('security.securityPersonnel', 'start'),
    operationCommand('security.securityPersonnel', 'landmarkPoint', 'select', { index: 0 }),
    operationCommand('security.securityPersonnel', 'landmarkPoint', 'select', { index: 1 })
  ]), cancel: Object.freeze([capability('security.securityPersonnel', 'cancel')]) })
  ,Object.freeze({ name: '安保岗亭', start: Object.freeze([
    theme('综合安防'), capability('security.securityBooth', 'start'),
    operationCommand('security.securityBooth', 'landmarkPoint', 'select', { index: 0 })
  ]), cancel: Object.freeze([capability('security.securityBooth', 'cancel')]) })
  ,Object.freeze({ name: '人员热力', start: Object.freeze([
    theme('综合安防'), capability('security.personnelHeatmap', 'start')
  ]), cancel: Object.freeze([capability('security.personnelHeatmap', 'cancel')]) })
  ,Object.freeze({ name: '光感周界告警', start: Object.freeze([
    theme('综合安防'), capability('security.lightPerimeterAlert', 'start')
  ]), cancel: Object.freeze([capability('security.lightPerimeterAlert', 'cancel')]) })
  ,Object.freeze({ name: '视频周界预警', start: Object.freeze([
    theme('综合安防'), capability('security.videoPerimeterAlert', 'start')
  ]), cancel: Object.freeze([capability('security.videoPerimeterAlert', 'cancel')]) })
  ,Object.freeze({ name: '鸿蒙人行闸机', start: Object.freeze([
    theme('便捷通行'), capability('access.harmonyPedestrianGate', 'start')
  ]), cancel: Object.freeze([capability('access.harmonyPedestrianGate', 'cancel')]) })
  ,Object.freeze({ name: '便捷通行安保岗亭', start: Object.freeze([
    theme('便捷通行'), capability('access.securityBooth', 'start'),
    operationCommand('access.securityBooth', 'landmarkPoint', 'select', { index: 0 })
  ]), cancel: Object.freeze([capability('access.securityBooth', 'cancel')]) })
  ,Object.freeze({ name: '班车信息', start: Object.freeze([
    theme('便捷通行'), capability('access.shuttleBusInfo', 'start'),
    operationCommand('access.shuttleBusInfo', 'landmarkPoint', 'select', { index: 1 })
  ]), cancel: Object.freeze([capability('access.shuttleBusInfo', 'cancel')]) })
  ,Object.freeze({ name: '车辆闸机', start: Object.freeze([
    theme('便捷通行'), capability('access.vehicleGate', 'start'),
    operationCommand('access.vehicleGate', 'landmarkPoint', 'select', { index: 0 })
  ]), cancel: Object.freeze([capability('access.vehicleGate', 'cancel')]) })
  ,Object.freeze({ name: '车位统计', start: Object.freeze([
    theme('便捷通行'), capability('access.parkingSpaceStatistics', 'start')
  ]), cancel: Object.freeze([capability('access.parkingSpaceStatistics', 'cancel')]) })
  ,Object.freeze({ name: '人员警示列表告警', start: Object.freeze([
    theme('便捷通行'), capability('access.personWarningAlert', 'start'),
    operationCommand('access.personWarningAlert', 'trajectory', 'show')
  ]), cancel: Object.freeze([capability('access.personWarningAlert', 'cancel')]) })
  ,Object.freeze({ name: '车辆警示列表告警', start: Object.freeze([
    theme('便捷通行'), capability('access.vehicleWarningAlert', 'start'),
    operationCommand('access.vehicleWarningAlert', 'trajectory', 'show')
  ]), cancel: Object.freeze([capability('access.vehicleWarningAlert', 'cancel')]) })
  ,Object.freeze({ name: '资产围栏', start: Object.freeze([
    theme('资产管理'), capability('asset.assetFence', 'start')
  ]), cancel: Object.freeze([capability('asset.assetFence', 'cancel')]) })
  ,Object.freeze({ name: '冷水机组', start: Object.freeze([
    theme('设施管理'), capability('facility.chiller', 'start'),
    operationCommand('facility.chiller', 'landmarkPoint', 'select', { index: 0 }),
    operationCommand('facility.chiller', 'landmarkPoint', 'select', { index: 1 }),
    operationCommand('facility.chiller', 'landmarkPoint', 'select', { index: 2 }),
    operationCommand('facility.chiller', 'landmarkPoint', 'select', { index: 3 }),
    operationCommand('facility.chiller', 'landmarkPoint', 'select', { index: 4 }),
    operationCommand('facility.chiller', 'landmarkPoint', 'select', { index: 5 }),
    operationCommand('facility.chiller', 'landmarkPoint', 'select', { index: 6 }),
    operationCommand('facility.chiller', 'landmarkPoint', 'select', { index: 7 }),
    operationCommand('facility.chiller', 'landmarkPoint', 'select', { index: 8 })
  ]), cancel: Object.freeze([capability('facility.chiller', 'cancel')]) })
  ,Object.freeze({ name: '设施维修人员', start: Object.freeze([
    theme('设施管理'), capability('facility.maintenanceStaff', 'start'),
    operationCommand('facility.maintenanceStaff', 'landmarkPoint', 'select', { index: 0 }),
    operationCommand('facility.maintenanceStaff', 'landmarkPoint', 'select', { index: 1 })
  ]), cancel: Object.freeze([capability('facility.maintenanceStaff', 'cancel')]) })
  ,Object.freeze({ name: 'AI预测性维护告警', start: Object.freeze([
    theme('设施管理'), capability('facility.aiPredictiveMaintenanceAlert', 'start'),
    operationCommand('facility.aiPredictiveMaintenanceAlert', 'smartDispatch', 'dispatch'),
    operationCommand('facility.aiPredictiveMaintenanceAlert', 'smartDispatch', 'advance'),
    operationCommand('facility.aiPredictiveMaintenanceAlert', 'smartDispatch', 'advance')
  ]), cancel: Object.freeze([capability('facility.aiPredictiveMaintenanceAlert', 'cancel')]) })
  ,Object.freeze({ name: '值班人员', start: Object.freeze([
    theme('能源管理'), capability('energy.dutyPersonnel', 'start'),
    operationCommand('energy.dutyPersonnel', 'landmarkPoint', 'select', { index: 0 }),
    operationCommand('energy.dutyPersonnel', 'landmarkPoint', 'select', { index: 1 }),
    operationCommand('energy.dutyPersonnel', 'landmarkPoint', 'select', { index: 2 })
  ]), cancel: Object.freeze([capability('energy.dutyPersonnel', 'cancel')]) })
  ,Object.freeze({ name: '能源维修人员', start: Object.freeze([
    theme('能源管理'), capability('energy.maintenanceStaff', 'start'),
    operationCommand('energy.maintenanceStaff', 'landmarkPoint', 'select', { index: 0 }),
    operationCommand('energy.maintenanceStaff', 'landmarkPoint', 'select', { index: 1 })
  ]), cancel: Object.freeze([capability('energy.maintenanceStaff', 'cancel')]) })
  ,Object.freeze({ name: '办公区', start: Object.freeze([
    theme('办公会议'), capability('office.officeArea', 'start'),
    operationCommand('office.officeArea', 'landmarkPoint', 'select', { index: 0 }),
    operationCommand('office.officeArea', 'landmarkPoint', 'select', { index: 1 })
  ]), cancel: Object.freeze([capability('office.officeArea', 'cancel')]) })
  ,Object.freeze({ name: '会议室异常占用', start: Object.freeze([
    theme('办公会议'), capability('office.meetingRoomSituation', 'start')
  ]), cancel: Object.freeze([capability('office.meetingRoomSituation', 'cancel')]) })
  ,Object.freeze({ name: '会议室智能空间运营报告', start: Object.freeze([
    theme('办公会议'), capability('office.csiMeetingRoomMonthlyReportAlert', 'start')
  ]), cancel: Object.freeze([capability('office.csiMeetingRoomMonthlyReportAlert', 'cancel')]) })
  ,Object.freeze({ name: '网络健康度', start: Object.freeze([
    theme('网络体验'), capability('network.health', 'start')
  ]), cancel: Object.freeze([capability('network.health', 'cancel')]) })
  ,Object.freeze({ name: 'AI Agent攻击处置报告', start: Object.freeze([
    theme('网络体验'), capability('network.aiAgentAttackAlert', 'start')
  ]), cancel: Object.freeze([capability('network.aiAgentAttackAlert', 'cancel')]) })
]);

const operation = (action, params) => Object.freeze({
  action,
  businessName: action,
  command: 'operation',
  commands: Object.freeze([command('executeOperation', params)])
});

// 事件卡片的人工二级按钮。这里仅做固定语义到前端 operation 的转换，不复制业务实现。
const HC_OPERATION_REGISTRY = Object.freeze([
  operation('查看未佩戴安全帽视频', { capability: 'security.noHardHatAlert', operation: 'video', command: 'open' }),
  operation('呼叫119', { capability: 'security.fireAlarmAlert', operation: 'emergencyCall', command: 'call' }),
  operation('一键开门', { capability: 'security.fireAlarmAlert', operation: 'door', command: 'open' }),
  operation('一键关门', { capability: 'security.fireAlarmAlert', operation: 'door', command: 'close' }),
  operation('通知应急小组', { capability: 'security.fireAlarmAlert', operation: 'emergencyTeam', command: 'notify' }),
  operation('短信通知员工', { capability: 'security.fireAlarmAlert', operation: 'smsNotification', command: 'notify', radius: 100 }),
  operation('查看资产非法外出轨迹', { capability: 'asset.illegalOutingAlert', operation: 'track', command: 'show' }),
  operation('查看资产非法外出视频', { capability: 'asset.illegalOutingAlert', operation: 'video', command: 'show' }),
  operation('查看资产盘点异常轨迹', { capability: 'asset.assetInventory', operation: 'trajectory', command: 'toggle' }),
  operation('远程诊断', { capability: 'facility.equipmentInspectionAlert', operation: 'remoteDiagnosis', command: 'open' }),
  operation('发送会议邀请', { capability: 'facility.equipmentInspectionAlert', operation: 'meeting', command: 'invite' }),
  operation('下发设备巡检工单', { capability: 'facility.equipmentInspectionAlert', operation: 'workOrder', command: 'dispatch' }),
  operation('选择VIP会议室', { capability: 'office.harmonyMeetingRoom', operation: 'meetingRoom', command: 'select', roomId: 'meeting-room1' }),
  operation('下发Wi-Fi防偷拍工单', { capability: 'office.wifiAntiSpyAlert', operation: 'workOrder', command: 'dispatch' }),
  operation('一键处置VIP客户网络异常', { capability: 'network.vipCustomerNetworkAlert', operation: 'disposal', command: 'execute', userId: 'VIP12-exception' }),
  operation('演示AI节能助手', { capability: 'energy.aiEnergyAssistant', operation: 'deviceStatusSliders', command: 'demonstrate' }),
  operation('处置会议室异常占用', { capability: 'office.meetingRoomSituation', operation: 'disposal', command: 'execute' })
]);

const HC_PARAMETERIZED_REGISTRY = Object.freeze({
  '切换语言': Object.freeze({
    businessName: '切换语言',
    command: 'set',
    validateParams: (params) => params && Object.keys(params).length === 1 &&
      ['zh-CN', 'en-US'].includes(params.language),
    translate: (params) => [command('executeCapability', {
      capability: 'global.language', command: 'set', language: params.language
    })]
  })
});

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

const HC_COMMAND_REGISTRY = Object.freeze({
  ...createCommandRegistry(HC_BUSINESS_REGISTRY),
  ...Object.fromEntries(HC_OPERATION_REGISTRY.map((definition) => [definition.action, definition])),
  '复位视角': Object.freeze({
    businessName: '复位视角',
    command: 'start',
    commands: Object.freeze([capability('global.cameraReset', 'start')])
  }),
  ...HC_PARAMETERIZED_REGISTRY
});
const cloneCommands = (commands) => commands.map((item) => ({ action: item.action, params: { ...item.params } }));

function getHcCommandDefinition(action) {
  return Object.prototype.hasOwnProperty.call(HC_COMMAND_REGISTRY, action) ? HC_COMMAND_REGISTRY[action] : null;
}

function translateHcCommand(commandValue) {
  const definition = getHcCommandDefinition(commandValue.action);
  if (!definition) throw new Error(`unregistered HC action: ${commandValue.action}`);
  if (typeof definition.translate === 'function') return definition.translate(commandValue.params);
  return cloneCommands(definition.commands);
}

module.exports = {
  HC_BUSINESS_REGISTRY,
  HC_OPERATION_REGISTRY,
  HC_COMMAND_REGISTRY,
  createCommandRegistry,
  getHcCommandDefinition,
  translateHcCommand
};
