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
    logger.info('[MQTT] 连接成功', { mqttEndpoint: endpoint });
  });
  client.on('reconnect', () => logger.info('[MQTT] 正在重连', { mqttEndpoint: endpoint }));
  client.on('close', () => {
    connected = false;
    logger.warn('[MQTT] 连接已断开', { mqttEndpoint: endpoint });
  });
  client.on('error', (error) => logger.error('[MQTT] 连接异常', { mqttEndpoint: endpoint, error: error.message }));

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
