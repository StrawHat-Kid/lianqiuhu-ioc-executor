const { validateFrontendCommands } = require('./validation');
const {
  isHcSemanticRequest,
  isHcLanguageAugmentableFrontendRequest,
  validateHcSemanticCommands,
  translateHcCommands,
  getIgnoredHcLanguageWarnings,
  getRequestedHcLanguage,
  removeHcLanguageParams
} = require('./hc-semantic');
const { translateHcCommand } = require('./hc-command-registry');

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
    const languageAugmentableFrontendRequest = isHcLanguageAugmentableFrontendRequest(receivedCommands);
    const semanticError = semanticRequest ? validateHcSemanticCommands(receivedCommands) : null;
    if (semanticError) return { ok: false, status: 400, error: semanticError };
    const commands = semanticRequest
      ? translateHcCommands(receivedCommands)
      : languageAugmentableFrontendRequest ? removeHcLanguageParams(receivedCommands) : receivedCommands;
    if (semanticRequest || languageAugmentableFrontendRequest) {
      for (const warning of getIgnoredHcLanguageWarnings(receivedCommands)) {
        logger.warn('[语义转换] 忽略不支持的language参数，继续执行业务流程', {
          requestId, commandIndex: warning.index, action: warning.action, language: warning.language
        });
      }
    }
    logger.info(semanticRequest ? '[语义转换] HC中文语义指令转换完成' : '[指令解析] 普通IOC指令无需语义转换', {
      requestId, receivedCommandCount: receivedCommands.length, normalizedCommandCount: commands.length,
      semanticRequest, mqttTopic, receivedCommands, frontendCommands: commands
    });
    const language = semanticRequest || languageAugmentableFrontendRequest
      ? getRequestedHcLanguage(receivedCommands)
      : null;
    if (language) {
      // 语言必须单独发布并完成，不能污染完整 Scenario 的严格匹配业务数组。
      const languageCommands = translateHcCommand({ action: '切换语言', params: { language } });
      const languageResult = await publishFrontendCommands(languageCommands, {
        semanticRequest, source: 'hc-language', requestId
      });
      if (!languageResult.ok) return languageResult;
    }
    return publishFrontendCommands(commands, { semanticRequest, requestId });
  }

  return { executeCommandRequest, publishFrontendCommands };
}

module.exports = { createCommandExecutor };
