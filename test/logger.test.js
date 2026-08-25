const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogger, formatBeijingTimestamp } = require('../src/logger');

test('现场日志使用北京时间中文格式，并脱敏敏感字段', () => {
  assert.equal(formatBeijingTimestamp(new Date('2026-08-25T03:35:05.281Z')), '2026-08-25 11-35-05');
  const lines = [];
  const logger = createLogger({ log: (line) => lines.push(line), warn: (line) => lines.push(line), error: (line) => lines.push(line) });
  logger.info('[执行器→RUISI回程] 准备发送消息', {
    requestId: 'req-test', sessionId: 'session-test', ingressAuthState: '已配置', authToken: 'must-not-appear'
  });
  assert.match(lines[0], /^\[\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\] \[信息\] \[请求ID:req-test\] \[会话ID:session-test\]/);
  assert.match(lines[0], /已配置/);
  assert.doesNotMatch(lines[0], /must-not-appear/);
});
