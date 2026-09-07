const { ENERGY_METRICS, ANNUAL_EQUIVALENT_ENERGY_SAVING, WORK_ORDER_DATA, WORK_ORDER_REFERENCE, MONTH_NAMES } = require('./dynamic-qa-definitions');

const CHINESE_MONTHS = Object.freeze({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 });
const MONTH_BY_NAME = Object.freeze(Object.fromEntries(MONTH_NAMES.map((name, index) => [name.toLowerCase(), index + 1])));

function normalizeDynamicQaLanguage(value) {
  if (value === 'zh' || value === 'zh-CN') return 'zh-CN';
  if (value === 'en' || value === 'en-US') return 'en-US';
  throw new Error('dynamic QA language must be one of zh, zh-CN, en, en-US');
}

function parseBusinessDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return null;
  return { year, month, day };
}

function singleMatch(question, candidates, unsupportedMessage) {
  const matches = candidates.filter((candidate) => candidate.pattern.test(question)).map((candidate) => candidate.value);
  const unique = [...new Set(matches)];
  if (unique.length !== 1) return { error: unsupportedMessage };
  return { value: unique[0] };
}

function findExplicitDay(question) {
  const match = question.match(/(?:\d{1,2}月\s*)?(?:本月\s*)?第?\s*(\d{1,2})\s*(?:日|号)/i) || question.match(/\b(?:on\s+)?day\s+(\d{1,2})\b/i);
  if (!match) return null;
  const day = Number(match[1]);
  return day >= 1 && day <= 31 ? { value: day } : { error: 'dynamic QA day must be between 1 and 31' };
}

function hasRelativeDay(question) {
  return /(今天|今日|当天|现在|\btoday\b|\bnow\b)/i.test(question);
}

function findExplicitMonth(question) {
  const numeric = question.match(/\b(\d{1,2})\s*月/) || question.match(/\bmonth\s+(\d{1,2})\b/i);
  if (numeric) {
    const month = Number(numeric[1]);
    return month >= 1 && month <= 12 ? { value: month } : { error: 'dynamic QA month must be between 1 and 12' };
  }
  const chinese = question.match(/(十二|十一|十|一|二|三|四|五|六|七|八|九)月/);
  if (chinese) return { value: CHINESE_MONTHS[chinese[1]] };
  const matches = Object.entries(MONTH_BY_NAME).filter(([name]) => new RegExp(`\\b${name}\\b`, 'i').test(question));
  return matches.length === 0 ? null : { value: matches[0][1] };
}

function hasRelativeMonth(question) {
  return /(本月|这个月|当前月份|\bthis\s+month\b|\bcurrent\s+month\b)/i.test(question);
}

function parseEnergyQuestion(question, businessDate) {
  if (/(年度等效节能|annual\s+equivalent\s+energy\s+saving)/i.test(question)) {
    return { kind: 'annualEquivalentEnergySaving', answer: ANNUAL_EQUIVALENT_ENERGY_SAVING };
  }
  const metric = singleMatch(question, [
    { value: 'gas', pattern: /(用气|气量|燃气|用了多少气|\bgas\b)/i },
    { value: 'water', pattern: /(用水|水量|用了多少水|\bwater\b)/i },
    { value: 'electricity', pattern: /(用电|电量|用了多少电|\belectricity\b)/i },
    { value: 'achievementRate', pattern: /(节能达成率|energy-saving\s+achievement\s+rate)/i }
  ], 'dynamic energy question has an unsupported or ambiguous metric');
  if (metric.error) return metric;
  if (metric.value !== 'achievementRate' && /(一天|单日|当天新增|today\s+alone|during\s+today\s+alone|single-day\s+incremental)/i.test(question)) {
    return { kind: 'singleDayIncremental' };
  }
  const explicitDay = findExplicitDay(question);
  if (explicitDay?.error) return explicitDay;
  const average = /(平均值|\baverage\b)/i.test(question);
  if (average) return { kind: 'energy', metric: metric.value, day: null, relativeDay: false };
  if (explicitDay) return { kind: 'energy', metric: metric.value, day: explicitDay.value, relativeDay: false };
  if (hasRelativeDay(question) && businessDate) return { kind: 'energy', metric: metric.value, day: businessDate.day, relativeDay: true };
  return { kind: 'energy', metric: metric.value, day: null, relativeDay: false };
}

function parseWorkOrderQuestion(question, businessDate) {
  const overview = /(工单处理情况|工单情况|整体.*工单|service[- ]ticket\s+(?:processing\s+)?status|overall.*service[- ]ticket)/i.test(question);
  const status = overview ? { value: 'overview' } : singleMatch(question, [
    { value: 'processing', pattern: /处理中|\bprocessing\b/i },
    { value: 'pending', pattern: /待处理|\bpending\b/i },
    { value: 'closed', pattern: /已关闭|\bclosed\b/i }
  ], 'dynamic work-order question has an unsupported or ambiguous status');
  if (status.error) return status;
  const explicitMonth = findExplicitMonth(question);
  if (explicitMonth?.error) return explicitMonth;
  const average = /(平均值|\baverage\b)/i.test(question);
  if (average) return { kind: 'workOrder', status: status.value, month: null };
  if (explicitMonth) return { kind: 'workOrder', status: status.value, month: explicitMonth.value };
  if (hasRelativeMonth(question) && businessDate) return { kind: 'workOrder', status: status.value, month: businessDate.month };
  return { kind: 'workOrder', status: status.value, month: null };
}

function buildEnergyAnswer(parsed, language) {
  if (parsed.kind === 'annualEquivalentEnergySaving') {
    return language === 'zh-CN' ? '年度等效节能为15.9%。' : 'Annual equivalent energy saving is 15.9%.';
  }
  if (parsed.kind === 'singleDayIncremental') {
    return language === 'zh-CN'
      ? '当前仅提供本月累计用气量、累计用水量和累计用电量，不提供单日新增用量。'
      : 'Only month-to-date cumulative gas, water, and electricity consumption is available. Single-day incremental consumption is not provided.';
  }
  const metric = ENERGY_METRICS[parsed.metric];
  if (!parsed.day) {
    if (language === 'zh-CN') return `本月${metric.zhName}的参考平均值为${metric.reference}${metric.zhUnit}。`;
    if (parsed.metric === 'achievementRate') return `The reference average for the monthly energy-saving achievement rate is ${metric.reference} percent.`;
    return `The reference average for month-to-date cumulative ${metric.enName} is ${metric.reference} ${metric.enUnit}.`;
  }
  const value = metric.values[parsed.day - 1];
  if (language === 'zh-CN') return `本月第${parsed.day}日${metric.zhName}为${value}${metric.zhUnit}。`;
  if (parsed.relativeDay && parsed.metric !== 'achievementRate') {
    return `The month-to-date cumulative ${metric.enName} on day ${parsed.day} is ${value} ${metric.enUnit}.`;
  }
  return `The ${metric.enName} on day ${parsed.day} was ${value}${parsed.metric === 'achievementRate' ? ' %' : ` ${metric.enUnit}`}.`;
}

function buildWorkOrderAnswer(parsed, language) {
  const rows = parsed.month ? WORK_ORDER_DATA[parsed.month] : WORK_ORDER_REFERENCE;
  const monthName = parsed.month ? MONTH_NAMES[parsed.month - 1] : null;
  if (!parsed.month) {
    if (language === 'zh-CN') {
      if (parsed.status === 'overview') return `月度工单参考平均值为：处理中${rows.processing}单、待处理${rows.pending}单、已关闭${rows.closed}单。`;
      const names = { processing: '处理中', pending: '待处理', closed: '已关闭' };
      return `月度${names[parsed.status]}工单的参考平均值为${rows[parsed.status]}单。`;
    }
    if (parsed.status === 'overview') return `The reference monthly averages are ${rows.processing} processing service tickets, ${rows.pending} pending service tickets, and ${rows.closed} closed service tickets.`;
    return `The reference monthly average is ${rows[parsed.status]} ${parsed.status} service tickets.`;
  }
  if (language === 'zh-CN') {
    if (parsed.status === 'overview') return `${parsed.month}月工单处理情况为：处理中${rows.processing}单、待处理${rows.pending}单、已关闭${rows.closed}单。`;
    const names = { processing: '处理中', pending: '待处理', closed: '已关闭' };
    return `${parsed.month}月${names[parsed.status]}工单有${rows[parsed.status]}单。`;
  }
  if (parsed.status === 'overview') return `There were ${rows.processing} processing service tickets, ${rows.pending} pending service tickets, and ${rows.closed} closed service tickets in ${monthName}.`;
  return `There were ${rows[parsed.status]} service tickets ${parsed.status} in ${monthName}.`;
}

module.exports = {
  normalizeDynamicQaLanguage, parseBusinessDate, parseEnergyQuestion, parseWorkOrderQuestion,
  buildEnergyAnswer, buildWorkOrderAnswer, findExplicitDay, findExplicitMonth
};
