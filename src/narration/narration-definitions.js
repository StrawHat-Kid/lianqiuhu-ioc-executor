const PARK_BASE_OVERVIEW_ACTION = '讲解园区基础底数';
const PARK_REALTIME_NARRATION_ACTION = '讲解综合运行态势';
const SECURITY_REALTIME_NARRATION_ACTION = '讲解安防实时态势';
const ENERGY_REALTIME_NARRATION_ACTION = '讲解能源与能效实时态势';

const command = (action, params) => Object.freeze({ action, params: Object.freeze({ ...params }) });
const capability = (name, commandName) => command('executeCapability', { capability: name, command: commandName });
const presentationStep = (index) => command('executeOperation', {
  capability: 'situation.parkRealtimeNarration', operation: 'presentation', command: 'select', index
});
const securityPresentationStep = (index) => command('executeOperation', {
  capability: 'security.realtimeSituation', operation: 'presentation', command: 'select', index
});
const energyPresentationStep = (index) => command('executeOperation', {
  capability: 'energy.realtimeSituation', operation: 'presentation', command: 'select', index
});
const segment = (index, commands, zhText, zhDurationMs, enText, enDurationMs, { minimumIocHoldMs, postGapMs } = {}) => Object.freeze({
  index,
  commands: Object.freeze(commands),
  ...(minimumIocHoldMs === undefined ? {} : { minimumIocHoldMs }),
  ...(postGapMs === undefined ? {} : { postGapMs }),
  content: Object.freeze({
    'zh-CN': Object.freeze({ text: zhText, durationMs: zhDurationMs }),
    'en-US': Object.freeze({ text: enText, durationMs: enDurationMs })
  })
});

const PARK_BASE_OVERVIEW = Object.freeze({
  scenario: 'parkBaseOverview',
  action: PARK_BASE_OVERVIEW_ACTION,
  prepareCommands: Object.freeze([
    command('主题切换', { '主题名称': '综合态势' })
  ]),
  introDelayMs: 4000,
  startCommands: Object.freeze([
    capability('situation.parkOverviewNarration', 'start')
  ]),
  segments: Object.freeze([
    segment(
      1,
      [],
      '练秋湖园区占地面积为1.6平方公里（约2400亩），目前入驻员工3万多名，共建有8个组团共104栋建筑，其中包括1600多间智慧会议室及900多个专业实验室。',
      20000,
      'Lianqiuhu campus covers an area of 1.6 square kilometers (about 2,400 mu), housing over 30,000 employees across 104 buildings in 8 clusters, which include over 1,600 smart meeting rooms and 900 professional laboratories.',
      22000,
      // UE 路线完成只通过 onCameraToCustomPathEnd 通知前端，Node 当前没有该回程 ack。
      // 30 秒是无 ack 条件下高于原 20 秒语音估算的保守 HC 保持下限，且不受语音倍率影响。
      { minimumIocHoldMs: 30000 }
    )
  ]),
  // 功能1正常结束本来就是恢复园区总览，因此 complete/cancel 都使用 cancel。
  completeCommands: Object.freeze([capability('situation.parkOverviewNarration', 'cancel')]),
  cancelCommands: Object.freeze([capability('situation.parkOverviewNarration', 'cancel')])
});

const PARK_REALTIME_NARRATION = Object.freeze({
  scenario: 'parkRealtimeNarration',
  action: PARK_REALTIME_NARRATION_ACTION,
  prepareCommands: Object.freeze([
    command('主题切换', { '主题名称': '综合态势' })
  ]),
  introDelayMs: 4000,
  startCommands: Object.freeze([
    capability('situation.parkRealtimeNarration', 'start')
  ]),
  segments: Object.freeze([
    // 前端 start 已展示 step1，不能重复 select 1。
    segment(
      1,
      [],
      '在大屏运行态势中：车位使用上，D至G组团车位接近饱和（使用率约95%），A至C组团使用率较低（约40%），分布极不均衡；',
      14000,
      'On the operational dashboard: Parking occupancy shows Groups D-G are near saturation (~95%) while A-C are free (~40%).',
      11000,
      { postGapMs: 1500 }
    ),
    segment(
      2,
      [presentationStep(2)],
      '设备报修集中在D组团10件和G组团9件；',
      5000,
      'Repairs are concentrated in Group D (10 cases) and G (9 cases).',
      7000,
      { postGapMs: 1000 }
    ),
    segment(
      3,
      [presentationStep(3)],
      '本月耗能以D1-实验楼53兆瓦时和G3-研发楼44.8兆瓦时最高；',
      7500,
      'Energy usage is topped by D1-Experimental Building (53 MWh) and G3-R&D Building (44.8 MWh).',
      11500,
      { postGapMs: 1500 }
    ),
    segment(
      4,
      [presentationStep(4)],
      '系统健康度整体优良，消防最高达99%，空调因能效衰减相对偏低，为92%。',
      9500,
      'System health is stable, led by fire safety at 99%, while AC is lower at 92% due to efficiency degradation.',
      10000,
      { postGapMs: 1000 }
    ),
    segment(
      5,
      [presentationStep(5)],
      'AI运营结论：近期D至G组团高密度人流带动了车位和能耗走高。建议在高峰期引导车辆向A至C区潮汐分流，并将非实时高功率作业调整至夜间，以平衡电网负荷。',
      17000,
      'AI Operational Conclusion: High-density crowd flows in Groups D-G have driven up parking and energy use. We recommend implementing tidal guidance to divert traffic to Groups A-C, and shifting non-real-time high-power tasks to nighttime to balance grid load.',
      17000,
      { postGapMs: 2000 }
    )
  ]),
  completeCommands: Object.freeze([capability('situation.parkRealtimeNarration', 'finish')]),
  cancelCommands: Object.freeze([capability('situation.parkRealtimeNarration', 'cancel')])
});

const SECURITY_REALTIME_NARRATION = Object.freeze({
  scenario: 'securityRealtimeNarration',
  action: SECURITY_REALTIME_NARRATION_ACTION,
  prepareCommands: Object.freeze([
    command('主题切换', { '主题名称': '综合安防' })
  ]),
  introDelayMs: 4000,
  startCommands: Object.freeze([
    capability('security.realtimeSituation', 'start')
  ]),
  segments: Object.freeze([
    // 前端 start 已展示 step1，不能重复 select 1。
    segment(
      1,
      [],
      '在大屏安防实时态势中：告警处置已实现AI自动处理率76%、告警降噪率92%，零噪音过滤环境干扰；',
      12000,
      'On the real-time security dashboard: Alarm disposition features a 76% AI automatic processing rate and 92% noise reduction to filter interference.',
      11000,
      { postGapMs: 1500 }
    ),
    segment(
      2,
      [securityPresentationStep(2)],
      '视觉行为中，车辆违停累计12件，居于首位；',
      5000,
      'Visual behavior is led by illegal vehicle parking (12 cases).',
      6000,
      { postGapMs: 1000 }
    ),
    segment(
      3,
      [securityPresentationStep(3)],
      '周界压力集中在C区，告警量达23件；',
      5000,
      'Perimeter pressure peaks in Area C with 23 alarms.',
      6000,
      { postGapMs: 1000 }
    ),
    segment(
      4,
      [securityPresentationStep(4)],
      '巡更任务体现人机协同，机器人B队以76%的达成率，高效补位了人工B队22%的空缺。',
      10000,
      'Patrol completion shows man-machine synergy, with Robot Patrol Team B (76%) successfully covering Human Team B\'s low rate (22%).',
      11000,
      { postGapMs: 1500 }
    ),
    segment(
      5,
      [securityPresentationStep(5)],
      'AI决策结论：当前安防强闭环运行。系统已监测并上报B11-2F一号10千伏配电室发生的人员未戴安全帽操作违规，画面已自动上报，请立即核实处置。',
      16500,
      'AI Decision: Security is running in a sensitive closed loop. An unhelmeted operator violation has been detected in Building B11-2F, No. 1 10KV power distribution room; please physical verify immediately.',
      17000,
      { postGapMs: 2000 }
    )
  ]),
  completeCommands: Object.freeze([capability('security.realtimeSituation', 'finish')]),
  cancelCommands: Object.freeze([capability('security.realtimeSituation', 'cancel')])
});

const ENERGY_REALTIME_NARRATION = Object.freeze({
  scenario: 'energyRealtimeNarration',
  action: ENERGY_REALTIME_NARRATION_ACTION,
  prepareCommands: Object.freeze([
    command('主题切换', { '主题名称': '能源管理' })
  ]),
  introDelayMs: 4000,
  startCommands: Object.freeze([
    capability('energy.realtimeSituation', 'start')
  ]),
  segments: Object.freeze([
    // 前端 start 已展示 step1，不能重复 select 1。
    segment(
      1,
      [],
      '练秋湖园区高峰期日用电量约200万度（2 GWh），光伏月发电约30万度（300 MWh）。在大屏能效指标中：能源供给实时绿电占比达35%（其中光伏25%即812千瓦，储能放电10%即325千瓦），市政供电占65%（2113千瓦）；',
      27000,
      'Lianqiuhu campus consumes 2 million kWh (2 GWh) of electricity daily during peak periods, with monthly solar generation reaching 300,000 kWh (300 MWh). On the energy dashboard: Real-time supply features 35% green power (25% solar/812 kW, 10% storage/325 kW) and 65% municipal power (2,113 kW).',
      31500,
      { postGapMs: 3000 }
    ),
    segment(
      2,
      [energyPresentationStep(2)],
      '用电负荷在10:00达到3050千瓦，略超昨日（2950千瓦）；',
      7000,
      'Load trend shows 3,050 kW at 10:00, slightly above yesterday\'s 2,950 kW.',
      9000,
      { postGapMs: 1000 }
    ),
    segment(
      3,
      [energyPresentationStep(3)],
      '能耗强度中，F11区域最突出，E10为34 W/m²；',
      7000,
      'Load monitoring peaks at Building F11 , with E10 at 34 W/m².',
      7000,
      { postGapMs: 1000 }
    ),
    segment(
      4,
      [energyPresentationStep(4)],
      '绿色指数中，供电安全（98）和绿电占比（95）领先，但设备能效（75）偏低。',
      8500,
      'Green index scores are high for safety (98) and solar ratio (95), but low for equipment efficiency (75).',
      10000,
      { postGapMs: 1000 }
    ),
    segment(
      5,
      [energyPresentationStep(5)],
      'AI决策结论：光储协同使整体碳排放强度环比昨日下降8%。主要异常为B栋暖通无效能耗及2号冷机能效衰减，系统已自动生成维保工单闭环处置。',
      16000,
      'AI Decision: Solar-storage synergy reduced carbon emissions by 8% compared to yesterday. Building B\'s HVAC inefficiency and chiller #2\'s efficiency degradation are the main issues; maintenance orders have been automatically dispatched.',
      17000,
      { postGapMs: 2000 }
    )
  ]),
  completeCommands: Object.freeze([capability('energy.realtimeSituation', 'finish')]),
  cancelCommands: Object.freeze([capability('energy.realtimeSituation', 'cancel')])
});

const NARRATION_DEFINITIONS = Object.freeze({
  [PARK_BASE_OVERVIEW_ACTION]: PARK_BASE_OVERVIEW,
  [PARK_REALTIME_NARRATION_ACTION]: PARK_REALTIME_NARRATION,
  [SECURITY_REALTIME_NARRATION_ACTION]: SECURITY_REALTIME_NARRATION,
  [ENERGY_REALTIME_NARRATION_ACTION]: ENERGY_REALTIME_NARRATION
});

function getNarrationDefinition(action) {
  return Object.prototype.hasOwnProperty.call(NARRATION_DEFINITIONS, action) ? NARRATION_DEFINITIONS[action] : null;
}

function normalizeNarrationLanguage(value) {
  if (value === undefined) return 'zh-CN';
  if (value === 'zh' || value === 'zh-CN') return 'zh-CN';
  if (value === 'en' || value === 'en-US') return 'en-US';
  throw new Error('narration language must be one of zh, zh-CN, en, en-US');
}

function validateNarrationCommand(commandValue) {
  const definition = getNarrationDefinition(commandValue.action);
  if (!definition) return { error: 'narration action is not registered' };
  const params = commandValue.params === undefined ? {} : commandValue.params;
  if (Object.keys(params).some((key) => key !== 'language')) return { error: 'narration params only supports language' };
  try {
    return { definition, language: normalizeNarrationLanguage(params.language) };
  } catch (error) {
    return { error: error.message };
  }
}

function isNarrationRequest(commands) {
  return Array.isArray(commands) && commands.some((item) => getNarrationDefinition(item?.action) !== null);
}

module.exports = {
  PARK_BASE_OVERVIEW_ACTION, PARK_BASE_OVERVIEW,
  PARK_REALTIME_NARRATION_ACTION, PARK_REALTIME_NARRATION,
  SECURITY_REALTIME_NARRATION_ACTION, SECURITY_REALTIME_NARRATION,
  ENERGY_REALTIME_NARRATION_ACTION, ENERGY_REALTIME_NARRATION,
  NARRATION_DEFINITIONS, getNarrationDefinition, normalizeNarrationLanguage,
  validateNarrationCommand, isNarrationRequest
};
