const { validateFrontendCommands } = require('./validation');
const { isHcSemanticRequest, validateHcSemanticCommands, translateHcCommands } = require('./hc-semantic');

function createCommandExecutor({ publisher, logger, mqttTopic }) {
  async function publishFrontendCommands(commands, { semanticRequest = false, source = 'commands', requestId, sessionId } = {}) {
    const frontendValidationError = validateFrontendCommands(commands);
    if (frontendValidationError) return { ok: false, status: 400, error: frontendValidationError };
    if (!publisher.isConnected()) {
      logger.warn('[MQTT] IOC指令发布被拒绝：MQTT当前未连接', {
        requestId, sessionId, commandCount: commands.length, semanticRequest, mqttTopic, source, commands
      });
      return { ok: false, status: 503, error: 'mqtt unavailable' };
    }
    try {
      logger.info('[MQTT] 准备发布IOC指令', {
        requestId, sessionId, mqttTopic, commandCount: commands.length, semanticRequest, source, commands
      });
      await publisher.publish(JSON.stringify(commands));
      logger.info('[MQTT] IOC指令发布成功', {
        requestId, sessionId, mqttTopic, commandCount: commands.length, semanticRequest, source
      });
      return { ok: true, status: 200, message: 'commands published' };
    } catch (error) {
      logger.error('[MQTT] IOC指令发布失败', {
        requestId, sessionId, commandCount: commands.length, semanticRequest, mqttTopic, source, error: error.message
      });
      return { ok: false, status: 500, error: 'mqtt publish failed' };
    }
  }

  async function executeCommandRequest(receivedCommands, { requestId } = {}) {
    const semanticRequest = isHcSemanticRequest(receivedCommands);
    const semanticError = semanticRequest ? validateHcSemanticCommands(receivedCommands) : null;
    if (semanticError) return { ok: false, status: 400, error: semanticError };
    const commands = semanticRequest ? translateHcCommands(receivedCommands) : receivedCommands;
    logger.info(semanticRequest ? '[语义转换] HC中文语义指令转换完成' : '[指令解析] 普通IOC指令无需语义转换', {
      requestId, receivedCommandCount: receivedCommands.length, normalizedCommandCount: commands.length,
      semanticRequest, mqttTopic, receivedCommands, frontendCommands: commands
    });
    return publishFrontendCommands(commands, { semanticRequest, requestId });
  }

  return { executeCommandRequest, publishFrontendCommands };
}

module.exports = { createCommandExecutor };
