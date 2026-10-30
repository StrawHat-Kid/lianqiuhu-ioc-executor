const { randomUUID } = require('node:crypto');
const express = require('express');
const { loadConfig, sanitizeMqttUrl, findSharedRecipients } = require('./config');
const { createLogger } = require('./logger');
const { createMqttPublisher } = require('./mqtt-client');
const { validateCommands } = require('./validation');
const { normalizeCommandRequest } = require('./command-request');
const { createCommandExecutor } = require('./command-executor');
const { createRuisiCallbackClient } = require('./ruisi-callback-client');
const { createNarrationSessionManager } = require('./narration/narration-session-manager');
const { isNarrationRequest, validateNarrationCommand } = require('./narration/narration-definitions');
const { isDynamicQaRequest, validateDynamicQaCommand, createDynamicQaHandler } = require('./dynamic-qa/dynamic-qa-handler');
const { createExhibitionAuth } = require('./exhibition-auth');
const { createHallBinder } = require('./hall-binding');

function requestBodyType(body) {
  if (Array.isArray(body)) return '旧数组模式';
  if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'commands')) {
    return 'context + commands信封模式';
  }
  return '不支持的请求体模式';
}

function contextSummary(context) {
  return {
    agent: context?.agent || '缺失',
    reply_to: context?.replyTo || '缺失',
    groupchat: context?.groupchat === undefined ? '缺失' : context.groupchat,
    callback: context?.callback || '缺失',
    timestamp: context?.timestamp || '缺失'
  };
}

function rejectionReason(error, { bodyType, narration = false, dynamicQa = false } = {}) {
  const value = String(error || '未知错误');
  if (value.includes('callback target is not allowed')) return 'callback目标不属于当前展厅允许的回程范围';
  if (value.includes('exhibition callback configuration is missing')) return '展厅回程配置缺失，无法建立回程通道';
  if (value.includes('missing context.callback')) return 'context.callback缺失，无法建立RUISI回程通道';
  if (value.includes('missing context.agent')) return 'context.agent缺失，无法建立RUISI回程通道';
  if (value.includes('missing context.replyTo')) return 'context.reply_to缺失，无法建立RUISI回程通道';
  if (value.includes('missing context')) {
    if (dynamicQa) return `动态问答必须携带context上下文，当前收到${bodyType || '未知模式'}`;
    return `讲解类指令必须携带context上下文，当前收到${bodyType || '未知模式'}`;
  }
  if (value.includes('language must be one of')) return `params.language不支持，${value}`;
  if (value.includes('narration request must contain')) return '讲解请求必须且只能包含一条讲解指令';
  if (value.includes('narration exhibitionId is required')) return '讲解会话缺少展厅标识，无法确定目标展厅';
  if (value.includes('exhibitionId is required to publish')) return '发布IOC指令缺少展厅标识';
  if (value.includes('narration action is not registered')) return '未知讲解指令';
  if (value.includes('action is not registered')) return '未知HC指令';
  if (value.includes('envelope commands must be an array')) return 'commands必须是数组';
  if (value.includes('request body must be an array or context envelope')) return '请求体必须是旧数组或context + commands信封';
  if (value.includes('context callback')) return `context.callback校验失败：${value}`;
  if (value.includes('context agent')) return `context.agent校验失败：${value}`;
  if (value.includes('context reply_to')) return `context.reply_to校验失败：${value}`;
  if (dynamicQa) return `动态问答指令校验失败：${value}`;
  if (narration) return `讲解指令校验失败：${value}`;
  return `指令校验失败：${value}`;
}

function createApp({ publisher, logger, mqttTopic, commandExecutor, narrationManager, callbackClient, dynamicQaHandler, dynamicQaWait, dynamicQaGetBusinessDate, exhibitionAuth, hallBinder, hallStatus } = {}) {
  // 不允许存在默认无鉴权的生产构造路径。
  if (typeof exhibitionAuth !== 'function') {
    throw new Error('exhibition auth middleware is required');
  }
  const bindHall = typeof hallBinder === 'function'
    ? hallBinder
    : hallBinder && typeof hallBinder.bind === 'function'
      ? hallBinder.bind
      : ({ context }) => (context
        ? { ok: false, status: 403, error: 'exhibition callback configuration is missing' }
        : { ok: false, status: 400, error: 'missing context' });
  const executor = commandExecutor || createCommandExecutor({ publisher, logger, mqttTopic });
  const sharedCallbackClient = callbackClient || createRuisiCallbackClient({ logger });
  const manager = narrationManager || createNarrationSessionManager({
    commandExecutor: executor, callbackClient: sharedCallbackClient, logger
  });
  const qaHandler = dynamicQaHandler || createDynamicQaHandler({
    commandExecutor: executor, callbackClient: sharedCallbackClient, logger, wait: dynamicQaWait, getBusinessDate: dynamicQaGetBusinessDate
  });
  const app = express();
  app.use((req, res, next) => {
    req.requestId = `req-${randomUUID()}`;
    req.requestStartedAt = Date.now();
    res.on('finish', () => {
      const details = {
        requestId: req.requestId, method: req.method, path: req.path,
        status: res.statusCode, elapsedMs: Date.now() - req.requestStartedAt
      };
      if (res.locals.rejectionReason) details.reason = res.locals.rejectionReason;
      const method = res.statusCode >= 400 ? 'error' : 'info';
      logger[method]('[HTTP] 请求处理完成', details);
    });
    next();
  });
  app.use(express.json());

  function reject(res, { requestId, error, bodyType, narration = false, dynamicQa = false, stage = '请求校验', status = 400 }) {
    const reason = rejectionReason(error, { bodyType, narration, dynamicQa });
    res.locals.rejectionReason = reason;
    logger.error(`[${stage}] 请求被拒绝：${reason}`, { requestId, bodyType, originalError: error });
    return res.status(status).json({ ok: false, error });
  }

  app.get('/health', (req, res) => {
    const mqttConnected = publisher.isConnected();
    res.status(200).json({
      ok: true,
      mqttConnected,
      status: mqttConnected ? 'ready' : 'mqtt_unavailable',
      // 只暴露数量，不暴露展厅 ID/Agent/Token 等配置明细。
      hallBinding: hallStatus || undefined
    });
  });

  app.post('/api/commands', exhibitionAuth, async (req, res) => {
    const bodyType = requestBodyType(req.body);
    logger.info('[RUISI/OSCA→执行器] 收到指令请求', {
      requestId: req.requestId, method: req.method, path: req.path,
      contentType: req.get('content-type') || '缺失', exhibitionId: req.exhibitionId
    });
    if (req.body && !Array.isArray(req.body) && Object.prototype.hasOwnProperty.call(req.body, 'exhibitionId')) {
      // 展厅身份只由服务端 Token 映射决定，请求体字段仅记录并忽略。
      logger.warn('[鉴权] 忽略请求体中的exhibitionId，使用服务端Token映射', {
        requestId: req.requestId, bodyExhibitionId: String(req.body.exhibitionId), exhibitionId: req.exhibitionId
      });
    }
    logger.info('[RUISI/OSCA→执行器] 请求体类型', { requestId: req.requestId, bodyType });
    logger.info('[RUISI/OSCA→执行器] 请求体', { requestId: req.requestId, body: req.body });

    let request;
    try {
      request = normalizeCommandRequest(req.body);
    } catch (error) {
      return reject(res, { requestId: req.requestId, error: error.message, bodyType, stage: '请求规范化' });
    }
    logger.info('[上下文解析] context字段', { requestId: req.requestId, context: contextSummary(request.context) });
    logger.info('[指令解析] 指令数量', {
      requestId: req.requestId, receivedCommandCount: request.commands.length, normalizedCommandCount: request.commands.length
    });
    request.commands.forEach((command, index) => {
      logger.info('[指令解析] 指令明细', { requestId: req.requestId, index: index + 1, action: command?.action, params: command?.params });
    });

    const validationError = validateCommands(request.commands);
    if (validationError) return reject(res, { requestId: req.requestId, error: validationError, bodyType, stage: '指令格式校验' });

    const receivedCommands = request.commands;
    if (isNarrationRequest(receivedCommands)) {
      if (receivedCommands.length !== 1) {
        return reject(res, {
          requestId: req.requestId, error: 'narration request must contain exactly one narration command',
          bodyType, narration: true, stage: 'Narration校验'
        });
      }
      const narration = validateNarrationCommand(receivedCommands[0]);
      if (narration.error) {
        return reject(res, { requestId: req.requestId, error: narration.error, bodyType, narration: true, stage: 'Narration校验' });
      }
      logger.info('[语义转换] 指令识别为Narration讲解', {
        requestId: req.requestId, action: receivedCommands[0].action, scenario: narration.definition.scenario, language: narration.language
      });
      const binding = bindHall({ exhibitionId: req.exhibitionId, context: request.context, requestId: req.requestId });
      if (!binding.ok) {
        return reject(res, {
          requestId: req.requestId, error: binding.error, bodyType, narration: true,
          stage: '回程隔离校验', status: binding.status
        });
      }
      const started = manager.startNarration({
        definition: narration.definition, context: binding.context, language: narration.language,
        requestId: req.requestId, exhibitionId: req.exhibitionId
      });
      if (!started.ok) {
        return reject(res, { requestId: req.requestId, error: started.error, bodyType, narration: true, stage: 'Narration校验' });
      }
      logger.info('[Narration校验] 讲解会话准入成功', {
        requestId: req.requestId, sessionId: started.session.id, scenario: narration.definition.scenario
      });
      return res.status(202).json({ ok: true, message: 'narration accepted', sessionId: started.session.id });
    }

    if (isDynamicQaRequest(receivedCommands)) {
      if (receivedCommands.length !== 1) {
        return reject(res, {
          requestId: req.requestId, error: 'dynamic QA request must contain exactly one dynamic QA command',
          bodyType, dynamicQa: true, stage: '动态问答校验'
        });
      }
      const dynamicCommand = validateDynamicQaCommand(receivedCommands[0]);
      if (dynamicCommand.error) {
        return reject(res, { requestId: req.requestId, error: dynamicCommand.error, bodyType, dynamicQa: true, stage: '动态问答校验' });
      }
      logger.info('[语义转换] 指令识别为动态问答', {
        requestId: req.requestId, action: dynamicCommand.value.action, language: dynamicCommand.value.language
      });
      const binding = bindHall({ exhibitionId: req.exhibitionId, context: request.context, requestId: req.requestId });
      if (!binding.ok) {
        return reject(res, {
          requestId: req.requestId, error: binding.error, bodyType, dynamicQa: true,
          stage: '回程隔离校验', status: binding.status
        });
      }
      const result = await qaHandler.execute({
        command: dynamicCommand.value, context: binding.context, requestId: req.requestId, exhibitionId: req.exhibitionId
      });
      if (!result.ok) {
        return reject(res, {
          requestId: req.requestId, error: result.error, bodyType, dynamicQa: true,
          stage: '动态问答执行', status: result.status || 400
        });
      }
      return res.status(200).json({ ok: true, message: result.message });
    }

    logger.info('[指令解析] 识别为普通IOC指令，无需RUISI回程', { requestId: req.requestId });
    const result = await executor.executeCommandRequest(receivedCommands, {
      requestId: req.requestId, exhibitionId: req.exhibitionId
    });
    if (!result.ok) {
      const reason = rejectionReason(result.error, { bodyType });
      res.locals.rejectionReason = reason;
      logger.error(`[普通IOC指令] 请求被拒绝：${reason}`, { requestId: req.requestId, originalError: result.error, status: result.status });
    }
    return res.status(result.status).json(result.ok
      ? { ok: true, message: result.message }
      : { ok: false, error: result.error });
  });

  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && Object.prototype.hasOwnProperty.call(error, 'body')) {
      return reject(res, {
        requestId: req.requestId, error: 'invalid JSON request body', bodyType: '无效JSON', stage: '请求JSON解析'
      });
    }
    return next(error);
  });
  return app;
}

function start() {
  const config = loadConfig();
  const logger = createLogger();
  const exhibitionAuth = createExhibitionAuth({ tokenMap: config.exhibitionTokens, logger });
  const hallBinder = createHallBinder({ halls: config.exhibitionHalls, logger });
  const hallStatus = {
    bound: config.exhibitionHalls.size,
    isolated: [...config.exhibitionHalls.values()].filter((hall) => hall.mode === 'isolated').length,
    legacy: [...config.exhibitionHalls.values()].filter((hall) => hall.mode === 'legacy').length,
    callbackDisabled: config.exhibitionHallIssues.length
  };
  logger.info('[执行器] 正在启动练秋湖IOC执行器', {
    port: config.port, mqttEndpoint: sanitizeMqttUrl(config.mqttUrl), mqttTopic: config.mqttTopic,
    narrationDurationScale: config.narrationDurationScale, ruisiCallbackTimeoutMs: config.ruisiCallbackTimeoutMs,
    exhibitionAuthState: '已配置', exhibitionCount: config.exhibitionTokens.size,
    exhibitionHallCount: config.exhibitionHalls.size,
    exhibitionHalls: [...config.exhibitionHalls.values()].map((hall) => ({
      exhibitionId: hall.exhibitionId,
      mode: hall.mode,
      agent: hall.agent,
      ingressHost: hall.ingressHost,
      ingressPort: hall.ingressPort,
      to: hall.to || null
    }))
  });
  // 普通 IOC 指令不依赖回程配置：这里只降级回程业务（Narration / 动态问答），
  // 不能让缺失或冲突的回程配置阻断启动与 MQTT 指令发布。
  for (const issue of config.exhibitionHallIssues) {
    logger.warn('[执行器] 展厅回程未启用，普通指令仍正常发布，回程业务将返回403', issue);
  }
  for (const warning of config.exhibitionHallWarnings) {
    logger.warn('[执行器] 展厅回程配置告警', warning);
  }
  for (const shared of findSharedRecipients(config.exhibitionHalls)) {
    logger.warn('[执行器] 多个展厅共用同一回程接收方，请确认产品配置', shared);
  }
  const publisher = createMqttPublisher(config, logger);
  const commandExecutor = createCommandExecutor({ publisher, logger, mqttTopic: config.mqttTopic });
  const callbackClient = createRuisiCallbackClient({
    logger, timeoutMs: config.ruisiCallbackTimeoutMs
  });
  const narrationManager = createNarrationSessionManager({
    commandExecutor, callbackClient, logger, durationScale: config.narrationDurationScale
  });
  const app = createApp({
    publisher, logger, mqttTopic: config.mqttTopic, commandExecutor, narrationManager, callbackClient,
    exhibitionAuth, hallBinder, hallStatus
  });
  const server = app.listen(config.port, () => {
    logger.info('[执行器] HTTP服务监听成功', { port: config.port });
  });
  async function shutdown(reason = 'shutdown') {
    logger.info('[执行器] 正在关闭服务', { reason });
    await narrationManager.cancelActiveNarration(reason);
    await new Promise((resolve) => server.close(resolve));
    publisher.close();
  }
  return { server, publisher, narrationManager, shutdown };
}

if (require.main === module) {
  const running = start();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      running.shutdown(signal).catch((error) => {
        console.error(`执行器关闭失败：${error.message}`);
        process.exitCode = 1;
      });
    });
  }
}

module.exports = { createApp, start, requestBodyType, rejectionReason, contextSummary };
