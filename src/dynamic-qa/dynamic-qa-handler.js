const { getCallbackContextError } = require('../ruisi-callback-client');
const { ENERGY_QUERY_ACTION, WORK_ORDER_QUERY_ACTION, dynamicQaPrepareCommands } = require('./dynamic-qa-definitions');
const {
  normalizeDynamicQaLanguage, parseBusinessDate, parseEnergyQuestion, parseWorkOrderQuestion,
  buildEnergyAnswer, buildWorkOrderAnswer
} = require('./dynamic-qa-parser');

const DYNAMIC_QA_ACTIONS = new Set([ENERGY_QUERY_ACTION, WORK_ORDER_QUERY_ACTION]);

function isDynamicQaRequest(commands) {
  return Array.isArray(commands) && commands.some((command) => DYNAMIC_QA_ACTIONS.has(command?.action));
}

function validateDynamicQaCommand(command) {
  if (!DYNAMIC_QA_ACTIONS.has(command?.action)) return { error: 'dynamic QA action is not registered' };
  const params = command.params;
  if (!params || typeof params !== 'object') return { error: 'dynamic QA params is required' };
  if (Object.keys(params).some((key) => !['question', 'language', 'businessDate'].includes(key))) {
    return { error: 'dynamic QA params only supports question, language, businessDate' };
  }
  if (typeof params.question !== 'string' || params.question.trim() === '') {
    return { error: 'dynamic QA question must be a non-empty string' };
  }
  if (typeof params.language !== 'string') return { error: 'dynamic QA language is required' };
  if (params.businessDate !== undefined && typeof params.businessDate !== 'string') {
    return { error: 'dynamic QA businessDate must be a string when provided' };
  }
  try {
    return { value: { action: command.action, question: params.question.trim(), language: normalizeDynamicQaLanguage(params.language), businessDate: params.businessDate } };
  } catch (error) {
    return { error: error.message };
  }
}

function createDynamicQaHandler({ commandExecutor, callbackClient, logger } = {}) {
  if (!commandExecutor || typeof commandExecutor.publishFrontendCommands !== 'function') throw new Error('dynamic QA command executor is required');
  if (!callbackClient || typeof callbackClient.sendAgentMessage !== 'function') throw new Error('dynamic QA callback client is required');
  const log = logger || { info() {}, warn() {}, error() {} };

  async function execute({ command, context, requestId }) {
    const callbackError = getCallbackContextError(context);
    if (callbackError) return { ok: false, status: 400, error: `dynamic QA callback unavailable: ${callbackError}` };
    const businessDate = parseBusinessDate(command.businessDate);
    const parsed = command.action === ENERGY_QUERY_ACTION
      ? parseEnergyQuestion(command.question, businessDate)
      : parseWorkOrderQuestion(command.question, businessDate);
    if (parsed.error) return { ok: false, status: 400, error: parsed.error };
    const answer = command.action === ENERGY_QUERY_ACTION
      ? buildEnergyAnswer(parsed, command.language)
      : buildWorkOrderAnswer(parsed, command.language);
    const iocCommands = dynamicQaPrepareCommands(command.language);
    log.info('[动态问答] 已生成答案并准备IOC动作', {
      requestId, action: command.action, language: command.language,
      businessDateState: businessDate ? '有效' : '缺失或无效', iocCommands
    });
    const publishResult = await commandExecutor.publishFrontendCommands(iocCommands, {
      source: `dynamic-qa:${command.action}`, requestId
    });
    if (!publishResult.ok) return publishResult;
    const callbackResult = await callbackClient.sendAgentMessage(context, {
      body: answer, requestId, scenario: `dynamic-qa:${command.action}`
    });
    if (!callbackResult.ok) return { ok: false, status: 502, error: callbackResult.error };
    return { ok: true, status: 200, message: 'dynamic QA completed', answer };
  }

  return { execute };
}

module.exports = { DYNAMIC_QA_ACTIONS, isDynamicQaRequest, validateDynamicQaCommand, createDynamicQaHandler };
