const express = require('express');
const { loadConfig, sanitizeMqttUrl } = require('./config');
const { createLogger } = require('./logger');
const { createMqttPublisher } = require('./mqtt-client');
const { validateCommands, validateFrontendCommands } = require('./validation');
const { isHcSemanticRequest, validateHcSemanticCommands, translateHcCommands } = require('./hc-semantic');

function createApp({ publisher, logger, mqttTopic }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.on('finish', () => logger.info('http request completed', {
      method: req.method, path: req.path, status: res.statusCode
    }));
    next();
  });

  app.get('/health', (req, res) => {
    const mqttConnected = publisher.isConnected();
    res.status(200).json({ ok: true, mqttConnected, status: mqttConnected ? 'ready' : 'mqtt_unavailable' });
  });

  app.post('/api/commands', async (req, res) => {
    const validationError = validateCommands(req.body);
    if (validationError) return res.status(400).json({ ok: false, error: validationError });
    const receivedCommands = req.body;
    const semanticRequest = isHcSemanticRequest(receivedCommands);
    const semanticError = semanticRequest ? validateHcSemanticCommands(receivedCommands) : null;
    if (semanticError) return res.status(400).json({ ok: false, error: semanticError });

    const commands = semanticRequest ? translateHcCommands(receivedCommands) : receivedCommands;
    const frontendValidationError = validateFrontendCommands(commands);
    if (frontendValidationError) return res.status(400).json({ ok: false, error: frontendValidationError });

    logger.info('commands received', {
      receivedCommandCount: receivedCommands.length, commandCount: commands.length, semanticRequest, mqttTopic
    });
    if (!publisher.isConnected()) {
      logger.warn('mqtt unavailable for publish', { commandCount: commands.length, semanticRequest, mqttTopic });
      return res.status(503).json({ ok: false, error: 'mqtt unavailable' });
    }
    const message = JSON.stringify(commands);
    try {
      await publisher.publish(message);
      logger.info('mqtt publish succeeded', { commandCount: commands.length, semanticRequest, mqttTopic });
      return res.status(200).json({ ok: true, message: 'commands published' });
    } catch (error) {
      logger.error('mqtt publish failed', { commandCount: commands.length, semanticRequest, mqttTopic, error: error.message });
      return res.status(500).json({ ok: false, error: 'mqtt publish failed' });
    }
  });

  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && Object.prototype.hasOwnProperty.call(error, 'body')) {
      return res.status(400).json({ ok: false, error: 'invalid JSON request body' });
    }
    return next(error);
  });
  return app;
}

function start() {
  const config = loadConfig();
  const logger = createLogger();
  logger.info('starting executor', { port: config.port, mqttEndpoint: sanitizeMqttUrl(config.mqttUrl), mqttTopic: config.mqttTopic });
  const publisher = createMqttPublisher(config, logger);
  const server = createApp({ publisher, logger, mqttTopic: config.mqttTopic }).listen(config.port, () => {
    logger.info('http server listening', { port: config.port });
  });
  return { server, publisher };
}

if (require.main === module) start();

module.exports = { createApp, start };
