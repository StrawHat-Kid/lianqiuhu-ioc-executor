function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateCommands(body) {
  if (!Array.isArray(body)) return 'request body must be an array';
  if (body.length === 0) return 'request body must not be empty';

  for (let index = 0; index < body.length; index += 1) {
    const command = body[index];
    if (!isPlainObject(command)) return `command at index ${index} must be a plain object`;
    if (typeof command.action !== 'string' || command.action.trim() === '') {
      return `command at index ${index} must include a non-empty string action`;
    }
    if (Object.prototype.hasOwnProperty.call(command, 'params') && !isPlainObject(command.params)) {
      return `command at index ${index} params must be a plain object`;
    }
  }
  return null;
}

const FRONTEND_ACTIONS = new Set([
  '主题切换', '环境气象效果', '环境季节效果', '环境时间效果', 'executeCapability', 'executeOperation'
]);

const FRONTEND_THEME_NAMES = new Set([
  '综合态势', '综合安防', '便捷通行', '资产管理', '设施管理', '能源管理', '办公会议', '网络体验'
]);

const FRONTEND_WEATHER_VALUES = new Set(['晴', '小雨', '中雨', '大雨', '小雪', '中雪', '大雪', '雾', '晴间多云', '阴天', '扬沙', '霾']);
const FRONTEND_SEASON_VALUES = new Set(['春季', '夏季', '秋季', '冬季']);
const FRONTEND_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

// 与前端 dispatcher 的 action 入口保持一致。业务 capability/operation 的深层生命周期仍由前端既有 Registry 校验。
function validateFrontendCommands(body) {
  for (let index = 0; index < body.length; index += 1) {
    const command = body[index];
    if (!FRONTEND_ACTIONS.has(command.action)) return `frontend command at index ${index} has unsupported action`;
    if (!Object.prototype.hasOwnProperty.call(command, 'params')) return `frontend command at index ${index} params is required`;
    const { params } = command;
    if (command.action === '主题切换') {
      if (typeof params['主题名称'] !== 'string' || !FRONTEND_THEME_NAMES.has(params['主题名称'])) {
        return `frontend command at index ${index} has unsupported theme`;
      }
    }
    if (command.action === '环境气象效果' &&
      (typeof params['天气'] !== 'string' || !FRONTEND_WEATHER_VALUES.has(params['天气']))) {
      return `frontend command at index ${index} has unsupported weather`;
    }
    if (command.action === '环境季节效果' &&
      (typeof params['季节'] !== 'string' || !FRONTEND_SEASON_VALUES.has(params['季节']))) {
      return `frontend command at index ${index} has unsupported season`;
    }
    if (command.action === '环境时间效果' &&
      (typeof params['时间'] !== 'string' || !FRONTEND_TIME_PATTERN.test(params['时间']))) {
      return `frontend command at index ${index} has invalid time`;
    }
    if (command.action === 'executeCapability' &&
      (typeof params.capability !== 'string' || typeof params.command !== 'string')) {
      return `frontend command at index ${index} executeCapability requires string capability and command`;
    }
    if (command.action === 'executeOperation' &&
      (typeof params.capability !== 'string' || typeof params.operation !== 'string' || typeof params.command !== 'string')) {
      return `frontend command at index ${index} executeOperation requires string capability, operation and command`;
    }
  }
  return null;
}

module.exports = { isPlainObject, validateCommands, validateFrontendCommands };
