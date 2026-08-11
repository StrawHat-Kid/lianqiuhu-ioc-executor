const mqtt = require('mqtt');
const { sanitizeMqttUrl } = require('./config');

function createMqttPublisher(config, logger, mqttLibrary = mqtt) {
  const client = mqttLibrary.connect(config.mqttUrl, {
    username: config.mqttUsername,
    password: config.mqttPassword,
    reconnectPeriod: 1000,
    queueQoSZero: false
  });
  let connected = false;
  const endpoint = sanitizeMqttUrl(config.mqttUrl);

  client.on('connect', () => {
    connected = true;
    logger.info('mqtt connected', { mqttEndpoint: endpoint });
  });
  client.on('reconnect', () => logger.info('mqtt reconnecting', { mqttEndpoint: endpoint }));
  client.on('close', () => {
    connected = false;
    logger.warn('mqtt disconnected', { mqttEndpoint: endpoint });
  });
  client.on('error', (error) => logger.error('mqtt error', { mqttEndpoint: endpoint, error: error.message }));

  return {
    isConnected: () => connected && client.connected,
    publish(message) {
      return new Promise((resolve, reject) => {
        client.publish(config.mqttTopic, message, { qos: 0, retain: false }, (error) => {
          if (error) return reject(error);
          resolve();
        });
      });
    },
    close: () => client.end()
  };
}

module.exports = { createMqttPublisher };
