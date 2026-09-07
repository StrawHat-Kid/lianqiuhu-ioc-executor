const {
  ENERGY_METRICS, ANNUAL_EQUIVALENT_ENERGY_SAVING, WORK_ORDER_DATA, WORK_ORDER_REFERENCE, MONTH_NAMES
} = require('./dynamic-qa-definitions');

function buildEnergyAnswer({ metric: metricName, day }, language) {
  const metric = ENERGY_METRICS[metricName];
  if (!day) {
    if (language === 'zh-CN') return `本月${metric.zhName}的参考平均值为${metric.reference}${metric.zhUnit}。`;
    if (metricName === 'achievementRate') return `The reference average for the monthly energy-saving achievement rate is ${metric.reference} percent.`;
    return `The reference average for month-to-date cumulative ${metric.enName} is ${metric.reference} ${metric.enUnit}.`;
  }
  const value = metric.values[day - 1];
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

function buildWorkOrderAnswer({ status, month }, language) {
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
  if (language === 'zh-CN') {
    if (status === 'overview') return `${month}月工单处理情况为：处理中${rows.processing}单、待处理${rows.pending}单、已关闭${rows.closed}单。`;
    const names = { processing: '处理中', pending: '待处理', closed: '已关闭' };
    return `${month}月${names[status]}工单有${rows[status]}单。`;
  }
  if (status === 'overview') return `There were ${rows.processing} processing service tickets, ${rows.pending} pending service tickets, and ${rows.closed} closed service tickets in ${monthName}.`;
  return `There were ${rows[status]} service tickets ${status} in ${monthName}.`;
}

function buildDynamicQaAnswer(command) {
  switch (command.kind) {
    case 'energy': return buildEnergyAnswer(command, command.language);
    case 'annualEquivalentEnergySaving': return buildAnnualEquivalentEnergySavingAnswer(command.language);
    case 'singleDayIncremental': return buildSingleDayIncrementalAnswer(command.language);
    case 'workOrder': return buildWorkOrderAnswer(command, command.language);
    default: throw new Error('dynamic QA answer kind is not registered');
  }
}

module.exports = {
  buildEnergyAnswer, buildAnnualEquivalentEnergySavingAnswer, buildSingleDayIncrementalAnswer,
  buildWorkOrderAnswer, buildDynamicQaAnswer
};
