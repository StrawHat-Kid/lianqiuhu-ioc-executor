const dotenv = require('dotenv');

function readConfig(env = process.env) {
  const required = ['MQTT_URL', 'MQTT_USERNAME', 'MQTT_PASSWORD', 'MQTT_TOPIC'];
  for (const name of required) {
    if (!env[name] || !String(env[name]).trim()) {
      throw new Error(`missing required environment variable: ${name}`);
    }
  }

  let url;
  try {
    url = new URL(env.MQTT_URL);
  } catch {
    throw new Error('MQTT_URL must be a valid mqtts:// URL');
  }
  if (url.protocol !== 'mqtts:') {
    throw new Error('MQTT_URL must use the mqtts:// protocol');
  }
  if (String(env.MQTT_QOS) !== '0') {
    throw new Error('MQTT_QOS must be 0 in the first phase');
  }
  if (String(env.MQTT_RETAIN).toLowerCase() !== 'false') {
    throw new Error('MQTT_RETAIN must be false in the first phase');
  }

  const port = Number(env.PORT || 8008);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port');
  }

  return {
    port,
    mqttUrl: env.MQTT_URL,
    mqttUsername: env.MQTT_USERNAME,
    mqttPassword: env.MQTT_PASSWORD,
    mqttTopic: env.MQTT_TOPIC,
    mqttQos: 0,
    mqttRetain: false
  };
}

function loadConfig() {
  dotenv.config();
  return readConfig();
}

function sanitizeMqttUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '[invalid MQTT URL]';
  }
}

module.exports = { loadConfig, readConfig, sanitizeMqttUrl };
