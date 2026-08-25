const LEVEL_LABELS = Object.freeze({ info: '信息', warn: '警告', error: '错误' });
const SENSITIVE_KEY_PATTERN = /(?:token|password|authorization|cookie)/i;

function formatBeijingTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}-${parts.minute}-${parts.second}`;
}

function sanitizeForLog(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '***已脱敏***';
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitizeForLog(item, name)]));
  }
  return value;
}

function createLogger(output = console) {
  function write(level, message, details = {}) {
    const safeDetails = sanitizeForLog(details);
    const requestPart = safeDetails.requestId ? ` [请求ID:${safeDetails.requestId}]` : '';
    const sessionPart = safeDetails.sessionId ? ` [会话ID:${safeDetails.sessionId}]` : '';
    const detailsPart = Object.keys(safeDetails).length > 0 ? ` ${JSON.stringify(safeDetails)}` : '';
    // 统一写 stdout，避免现场采集 stdout/stderr 时把“请求被拒绝”排到 HTTP 完成日志之后。
    const method = typeof output.log === 'function' ? 'log' : (level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log');
    output[method](`[${formatBeijingTimestamp()}] [${LEVEL_LABELS[level]}]${requestPart}${sessionPart} ${message}${detailsPart}`);
  }
  return {
    info: (message, details = {}) => write('info', message, details),
    warn: (message, details = {}) => write('warn', message, details),
    error: (message, details = {}) => write('error', message, details)
  };
}

module.exports = { createLogger, formatBeijingTimestamp, sanitizeForLog };
