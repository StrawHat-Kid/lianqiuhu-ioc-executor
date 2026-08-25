const { randomUUID } = require('node:crypto');
const express = require('express');
const { loadConfig, sanitizeMqttUrl } = require('./config');
const { createLogger } = require('./logger');
const { createMqttPublisher } = require('./mqtt-client');
const { validateCommands } = require('./validation');
const { normalizeCommandRequest } = require('./command-request');
const { createCommandExecutor } = require('./command-executor');
const { createRuisiCallbackClient } = require('./ruisi-callback-client');
const { createNarrationSessionManager } = require('./narration/narration-session-manager');
const { isNarrationRequest, validateNarrationCommand } = require('./narration/narration-definitions');

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

function rejectionReason(error, { bodyType, narration = false } = {}) {
  const value = String(error || '未知错误');
  if (value.includes('missing context.callback')) return 'context.callback缺失，无法建立RUISI回程通道';
  if (value.includes('missing context.agent')) return 'context.agent缺失，无法建立RUISI回程通道';
  if (value.includes('missing context.replyTo')) return 'context.reply_to缺失，无法建立RUISI回程通道';
  if (value.includes('missing context')) {
    return `讲解类指令必须携带context上下文，当前收到${bodyType || '未知模式'}`;
  }
  if (value.includes('language must be one of')) return `params.language不支持，${value}`;
  if (value.includes('narration request must contain')) return '讲解请求必须且只能包含一条讲解指令';
  if (value.includes('narration action is not registered')) return '未知讲解指令';
  if (value.includes('action is not registered')) return '未知HC指令';
  if (value.includes('envelope commands must be an array')) return 'commands必须是数组';
  if (value.includes('request body must be an array or context envelope')) return '请求体必须是旧数组或context + commands信封';
  if (value.includes('context callback')) return `context.callback校验失败：${value}`;
  if (value.includes('context agent')) return `context.agent校验失败：${value}`;
  if (value.includes('context reply_to')) return `context.reply_to校验失败：${value}`;
  if (narration) return `讲解指令校验失败：${value}`;
  return `指令校验失败：${value}`;
}

function createApp({ publisher, logger, mqttTopic, commandExecutor, narrationManager } = {}) {
  const executor = commandExecutor || createCommandExecutor({ publisher, logger, mqttTopic });
  const manager = narrationManager || createNarrationSessionManager({
    commandExecutor: executor, callbackClient: createRuisiCallbackClient({ logger }), logger
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

  function reject(res, { requestId, error, bodyType, narration = false, stage = '请求校验' }) {
    const reason = rejectionReason(error, { bodyType, narration });
    res.locals.rejectionReason = reason;
    logger.error(`[${stage}] 请求被拒绝：${reason}`, { requestId, bodyType, originalError: error });
    return res.status(400).json({ ok: false, error });
  }

  app.get('/health', (req, res) => {
    const mqttConnected = publisher.isConnected();
    res.status(200).json({ ok: true, mqttConnected, status: mqttConnected ? 'ready' : 'mqtt_unavailable' });
  });

  app.post('/api/commands', async (req, res) => {
    const bodyType = requestBodyType(req.body);
    logger.info('[RUISI/OSCA→执行器] 收到指令请求', {
      requestId: req.requestId, method: req.method, path: req.path, contentType: req.get('content-type') || '缺失'
    });
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
      const started = manager.startNarration({
        definition: narration.definition, context: request.context, language: narration.language, requestId: req.requestId
      });
      if (!started.ok) {
        return reject(res, { requestId: req.requestId, error: started.error, bodyType, narration: true, stage: 'Narration校验' });
      }
      logger.info('[Narration校验] 讲解会话准入成功', {
        requestId: req.requestId, sessionId: started.session.id, scenario: narration.definition.scenario
      });
      return res.status(202).json({ ok: true, message: 'narration accepted', sessionId: started.session.id });
    }

    logger.info('[指令解析] 识别为普通IOC指令，无需RUISI回程', { requestId: req.requestId });
    const result = await executor.executeCommandRequest(receivedCommands, { requestId: req.requestId });
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
  logger.info('[执行器] 正在启动练秋湖IOC执行器', {
    port: config.port, mqttEndpoint: sanitizeMqttUrl(config.mqttUrl), mqttTopic: config.mqttTopic,
    narrationDurationScale: config.narrationDurationScale, ruisiCallbackTimeoutMs: config.ruisiCallbackTimeoutMs,
    ingressAuthState: config.ingressToken ? '已配置' : '未配置'
  });
  const publisher = createMqttPublisher(config, logger);
  const commandExecutor = createCommandExecutor({ publisher, logger, mqttTopic: config.mqttTopic });
  const callbackClient = createRuisiCallbackClient({
    logger, authToken: config.ingressToken, timeoutMs: config.ruisiCallbackTimeoutMs
  });
  const narrationManager = createNarrationSessionManager({
    commandExecutor, callbackClient, logger, durationScale: config.narrationDurationScale
  });
  const app = createApp({ publisher, logger, mqttTopic: config.mqttTopic, commandExecutor, narrationManager });
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
