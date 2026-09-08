const DYNAMIC_QA_ACTION_DEFINITIONS = Object.freeze({
  '查询累计用气量': Object.freeze({ kind: 'energy', metric: 'gas', parameter: 'day' }),
  '查询累计用水量': Object.freeze({ kind: 'energy', metric: 'water', parameter: 'day' }),
  '查询累计用电量': Object.freeze({ kind: 'energy', metric: 'electricity', parameter: 'day' }),
  '查询节能达成率': Object.freeze({ kind: 'energy', metric: 'achievementRate', parameter: 'day' }),
  '查询年度等效节能': Object.freeze({ kind: 'annualEquivalentEnergySaving' }),
  '查询单日新增用能': Object.freeze({ kind: 'singleDayIncremental' }),
  '查询处理中工单': Object.freeze({ kind: 'workOrder', status: 'processing', parameter: 'month' }),
  '查询待处理工单': Object.freeze({ kind: 'workOrder', status: 'pending', parameter: 'month' }),
  '查询已关闭工单': Object.freeze({ kind: 'workOrder', status: 'closed', parameter: 'month' }),
  '查询工单处理情况': Object.freeze({ kind: 'workOrder', status: 'overview', parameter: 'month' })
});

const ENERGY_METRICS = Object.freeze({
  gas: Object.freeze({
    values: Object.freeze([762.3, 1543.1, 2315.8, 3088.4, 3871.2, 4642.5, 5418.9, 6185.3, 6972.1, 7745.6, 8521.4, 9298.7, 10072.2, 10845.8, 11621.5, 12395.2, 13174.9, 13948.3, 14725.6, 15498.1, 16275.4, 17051.8, 17822.5, 18595.2, 19371.7, 20148.3, 20922.6, 21695.1, 22472.8, 23245.5, 24037.4]),
    reference: '12,396.30', zhName: '累计用气量', zhFutureDataName: '累计用气', enName: 'gas consumption', zhUnit: '立方米', enUnit: 'cubic meters'
  }),
  water: Object.freeze({
    values: Object.freeze([2741.5, 5510.2, 8295.6, 11062.3, 13845.8, 16612.1, 19385.4, 22152.7, 24930.2, 27698.9, 30481.5, 33245.3, 36018.6, 38792.1, 41561.4, 44345.8, 47112.5, 49885.2, 52658.7, 55431.1, 58205.6, 60981.3, 63755.8, 66522.4, 69295.1, 72068.5, 74842.2, 77615.6, 80388.3, 83162.9, 85942.6]),
    reference: '44,340.23', zhName: '累计用水量', zhFutureDataName: '累计用水', enName: 'water consumption', zhUnit: '立方米', enUnit: 'cubic meters'
  }),
  electricity: Object.freeze({
    values: Object.freeze([1.95, 3.82, 5.91, 8.03, 9.94, 11.82, 13.97, 16.05, 18.21, 20.08, 22.14, 24.25, 26.31, 28.46, 30.52, 32.41, 34.38, 36.24, 38.35, 40.18, 42.22, 44.15, 46.03, 48.17, 50.32, 52.48, 54.55, 56.61, 58.74, 60.85, 62.91]),
    reference: '32.26', zhName: '累计用电量', zhFutureDataName: '累计用电', enName: 'electricity consumption', zhUnit: '吉瓦时', enUnit: 'gigawatt-hours'
  }),
  achievementRate: Object.freeze({
    values: Object.freeze([96.5, 98.2, 95.8, 99.1, 97.4, 96.8, 95.5, 98.7, 97.9, 96.2, 99.4, 97.1, 95.9, 98.5, 97.3, 96.0, 99.2, 95.7, 98.4, 97.6, 96.9, 99.5, 98.1, 95.4, 97.8, 96.7, 98.9, 97.2, 95.6, 98.3, 99.0]),
    reference: '97.44', zhName: '节能达成率', zhFutureDataName: '节能达成率', enName: 'energy-saving achievement rate', zhUnit: '%', enUnit: 'percent'
  })
});

const ANNUAL_EQUIVALENT_ENERGY_SAVING = '15.9';

const WORK_ORDER_DATA = Object.freeze({
  1: Object.freeze({ processing: 5242, pending: 412, closed: 156 }),
  2: Object.freeze({ processing: 5689, pending: 385, closed: 120 }),
  3: Object.freeze({ processing: 5236, pending: 223, closed: 102 }),
  4: Object.freeze({ processing: 5963, pending: 345, closed: 230 }),
  5: Object.freeze({ processing: 5423, pending: 312, closed: 120 }),
  6: Object.freeze({ processing: 5810, pending: 285, closed: 178 }),
  7: Object.freeze({ processing: 6105, pending: 452, closed: 210 }),
  8: Object.freeze({ processing: 5745, pending: 326, closed: 194 }),
  9: Object.freeze({ processing: 5312, pending: 278, closed: 145 }),
  10: Object.freeze({ processing: 4890, pending: 195, closed: 112 }),
  11: Object.freeze({ processing: 5520, pending: 315, closed: 165 }),
  12: Object.freeze({ processing: 5980, pending: 430, closed: 258 })
});

const WORK_ORDER_REFERENCE = Object.freeze({ processing: '5,576.25', pending: '329.83', closed: '165.83' });
const MONTH_NAMES = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);

function languageCommand(language) {
  return { action: 'executeCapability', params: { capability: 'global.language', command: 'set', language } };
}

function dynamicQaPrepareCommands(language) {
  return [languageCommand(language), { action: '主题切换', params: { '主题名称': '综合态势' } }];
}

module.exports = {
  DYNAMIC_QA_ACTION_DEFINITIONS, ENERGY_METRICS, ANNUAL_EQUIVALENT_ENERGY_SAVING,
  WORK_ORDER_DATA, WORK_ORDER_REFERENCE, MONTH_NAMES, dynamicQaPrepareCommands
};
