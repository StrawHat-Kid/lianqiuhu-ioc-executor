const { getCallbackContextError } = require('../ruisi-callback-client');
const { sleep } = require('../narration/narration-session-manager');
const { HC_INTRO_DELAY_MS } = require('../hc-return-timing');
const { DYNAMIC_QA_ACTION_DEFINITIONS, dynamicQaPrepareCommands } = require('./dynamic-qa-definitions');
const { buildDynamicQaAnswer } = require('./dynamic-qa-answer-builder');

const DYNAMIC_QA_ACTIONS = new Set(Object.keys(DYNAMIC_QA_ACTION_DEFINITIONS));

function normalizeDynamicQaLanguage(value) {
  if (value === 'zh' || value === 'zh-CN') return 'zh-CN';
  if (value === 'en' || value === 'en-US') return 'en-US';
  throw new Error('dynamic QA language must be one of zh, zh-CN, en, en-US');
}

function isDynamicQaRequest(commands) {
  return Array.isArray(commands) && commands.some((command) => DYNAMIC_QA_ACTIONS.has(command?.action));
}

function validateDynamicQaCommand(command) {
  const definition = DYNAMIC_QA_ACTION_DEFINITIONS[command?.action];
  if (!definition) return { error: 'dynamic QA action is not registered' };
  const params = command.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return { error: 'dynamic QA params is required' };
  const allowedParams = new Set(['language', ...(definition.parameter ? [definition.parameter] : [])]);
  if (Object.keys(params).some((key) => !allowedParams.has(key))) return { error: `dynamic QA params only supports ${[...allowedParams].join(', ')}` };
  if (typeof params.language !== 'string') return { error: 'dynamic QA language is required' };
  const temporalValue = definition.parameter ? params[definition.parameter] : undefined;
  if (temporalValue !== undefined) {
    const maximum = definition.parameter === 'day' ? 31 : 12;
    if (!Number.isInteger(temporalValue) || temporalValue < 1 || temporalValue > maximum) {
      return { error: `dynamic QA ${definition.parameter} must be an integer between 1 and ${maximum}` };
    }
  }
  try {
    return {
      value: {
        action: command.action, kind: definition.kind, metric: definition.metric, status: definition.status,
        language: normalizeDynamicQaLanguage(params.language), ...(definition.parameter ? { [definition.parameter]: temporalValue } : {})
      }
    };
  } catch (error) {
    return { error: error.message };
  }
}

function createDynamicQaHandler({ commandExecutor, callbackClient, logger, wait = sleep } = {}) {
  if (!commandExecutor || typeof commandExecutor.publishFrontendCommands !== 'function') throw new Error('dynamic QA command executor is required');
  if (!callbackClient || typeof callbackClient.sendAgentMessage !== 'function') throw new Error('dynamic QA callback client is required');
  if (typeof wait !== 'function') throw new Error('dynamic QA wait must be a function');
  const log = logger || { info() {}, warn() {}, error() {} };

  async function execute({ command, context, requestId }) {
    const callbackError = getCallbackContextError(context);
    if (callbackError) return { ok: false, status: 400, error: `dynamic QA callback unavailable: ${callbackError}` };
    const answer = buildDynamicQaAnswer(command);
    const iocCommands = dynamicQaPrepareCommands(command.language);
    log.info('[动态问答] 已生成答案并准备IOC动作', {
      requestId, action: command.action, language: command.language, iocCommands
    });
    const publishResult = await commandExecutor.publishFrontendCommands(iocCommands, {
      source: `dynamic-qa:${command.action}`, requestId
    });
    if (!publishResult.ok) return publishResult;
    log.info('[动态问答] IOC动作已下发，等待HC开场播报完成', {
      requestId, action: command.action, introDelayMs: HC_INTRO_DELAY_MS
    });
    await wait(HC_INTRO_DELAY_MS);
    const callbackResult = await callbackClient.sendAgentMessage(context, {
      body: answer, requestId, scenario: `dynamic-qa:${command.action}`
    });
    if (!callbackResult.ok) return { ok: false, status: 502, error: callbackResult.error };
    return { ok: true, status: 200, message: 'dynamic QA completed', answer };
  }

  return { execute };
}

module.exports = {
  DYNAMIC_QA_ACTIONS, normalizeDynamicQaLanguage, isDynamicQaRequest,
  validateDynamicQaCommand, createDynamicQaHandler
};
