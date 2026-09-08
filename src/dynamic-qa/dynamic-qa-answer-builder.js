const {
  ENERGY_METRICS, ANNUAL_EQUIVALENT_ENERGY_SAVING, WORK_ORDER_DATA, WORK_ORDER_REFERENCE, MONTH_NAMES
} = require('./dynamic-qa-definitions');
const { getHcBusinessDate } = require('../hc-business-date');

function buildEnergyAnswer({ metric: metricName, day }, language, businessDate = getHcBusinessDate()) {
  const metric = ENERGY_METRICS[metricName];
  if (!day) {
    if (language === 'zh-CN') return `本月${metric.zhName}的参考平均值为${metric.reference}${metric.zhUnit}。`;
    if (metricName === 'achievementRate') return `The reference average for the monthly energy-saving achievement rate is ${metric.reference} percent.`;
    return `The reference average for month-to-date cumulative ${metric.enName} is ${metric.reference} ${metric.enUnit}.`;
  }
  const value = metric.values[day - 1];
  if (day > businessDate.day) {
    if (language === 'zh-CN') {
      return `您查询的日期尚未到达，当前暂无该日期的本月${metric.zhFutureDataName}数据。作为参考，去年同期${businessDate.month}月${day}日的${metric.zhName}为${value}${metric.zhUnit}。`;
    }
    if (metricName === 'achievementRate') {
      return `The date you asked about has not yet arrived, so the current-period energy-saving achievement rate for that date is not yet available. For reference, the energy-saving achievement rate for the same period last year, on ${MONTH_NAMES[businessDate.month - 1]} ${day}, was ${value} percent.`;
    }
    return `The date you asked about has not yet arrived, so current-period cumulative ${metric.enName} data for that date is not yet available. For reference, the cumulative ${metric.enName} for the same period last year, on ${MONTH_NAMES[businessDate.month - 1]} ${day}, was ${value} ${metric.enUnit}.`;
  }
  if (language === 'zh-CN') return `本月第${day}日${metric.zhName}为${value}${metric.zhUnit}。`;
  return `The ${metric.enName} on day ${day} was ${value}${metricName === 'achievementRate' ? ' %' : ` ${metric.enUnit}`}.`;
}

function buildAnnualEquivalentEnergySavingAnswer(language) {
  return language === 'zh-CN'
    ? `年度等效节能为${ANNUAL_EQUIVALENT_ENERGY_SAVING}%。`
    : `Annual equivalent energy saving is ${ANNUAL_EQUIVALENT_ENERGY_SAVING}%.`;
}

function buildSingleDayIncrementalAnswer(language) {
  return language === 'zh-CN'
    ? '当前仅提供本月累计用气量、累计用水量和累计用电量，不提供单日新增用量。'
    : 'Only month-to-date cumulative gas, water, and electricity consumption is available. Single-day incremental consumption is not provided.';
}

function buildWorkOrderAnswer({ status, month }, language, businessDate = getHcBusinessDate()) {
  const rows = month ? WORK_ORDER_DATA[month] : WORK_ORDER_REFERENCE;
  const monthName = month ? MONTH_NAMES[month - 1] : null;
  if (!month) {
    if (language === 'zh-CN') {
      if (status === 'overview') return `月度工单参考平均值为：处理中${rows.processing}单、待处理${rows.pending}单、已关闭${rows.closed}单。`;
      const names = { processing: '处理中', pending: '待处理', closed: '已关闭' };
      return `月度${names[status]}工单的参考平均值为${rows[status]}单。`;
    }
    if (status === 'overview') return `The reference monthly averages are ${rows.processing} processing service tickets, ${rows.pending} pending service tickets, and ${rows.closed} closed service tickets.`;
    return `The reference monthly average is ${rows[status]} ${status} service tickets.`;
  }
  if (month > businessDate.month) {
    if (language === 'zh-CN') {
      if (status === 'overview') return `您查询的月份尚未到达，当前暂无该月份的工单统计数据。作为参考，去年同期${month}月工单处理情况为：处理中${rows.processing}单、待处理${rows.pending}单、已关闭${rows.closed}单。`;
      const names = { processing: '处理中', pending: '待处理', closed: '已关闭' };
      return `您查询的月份尚未到达，当前暂无该月份的工单统计数据。作为参考，去年同期${month}月${names[status]}工单有${rows[status]}单。`;
    }
    if (status === 'overview') {
      return `The month you asked about has not yet arrived, so service-ticket statistics for that month are not yet available. For reference, during the same period last year in ${monthName}, there were ${rows.processing} processing service tickets, ${rows.pending} pending service tickets, and ${rows.closed} closed service tickets.`;
    }
    return `The month you asked about has not yet arrived, so service-ticket statistics for that month are not yet available. For reference, there were ${rows[status]} ${status} service tickets in ${monthName} during the same period last year.`;
  }
  if (language === 'zh-CN') {
    if (status === 'overview') return `${month}月工单处理情况为：处理中${rows.processing}单、待处理${rows.pending}单、已关闭${rows.closed}单。`;
    const names = { processing: '处理中', pending: '待处理', closed: '已关闭' };
    return `${month}月${names[status]}工单有${rows[status]}单。`;
  }
  if (status === 'overview') return `There were ${rows.processing} processing service tickets, ${rows.pending} pending service tickets, and ${rows.closed} closed service tickets in ${monthName}.`;
  return `There were ${rows[status]} service tickets ${status} in ${monthName}.`;
}

function buildDynamicQaAnswer(command, { getBusinessDate = getHcBusinessDate } = {}) {
  switch (command.kind) {
    case 'energy': return buildEnergyAnswer(command, command.language, getBusinessDate());
    case 'annualEquivalentEnergySaving': return buildAnnualEquivalentEnergySavingAnswer(command.language);
    case 'singleDayIncremental': return buildSingleDayIncrementalAnswer(command.language);
    case 'workOrder': return buildWorkOrderAnswer(command, command.language, getBusinessDate());
    default: throw new Error('dynamic QA answer kind is not registered');
  }
}

module.exports = {
  buildEnergyAnswer, buildAnnualEquivalentEnergySavingAnswer, buildSingleDayIncrementalAnswer,
  buildWorkOrderAnswer, buildDynamicQaAnswer
};
