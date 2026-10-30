const dotenv = require('dotenv');
const { parseTokenMap } = require('./exhibition-auth');

const HALL_ENV_PREFIX = 'HC_HALL_';
const RUISI_SEND_PATH = '/agent/send';

const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';

function hallEnvPrefix(exhibitionId) {
  return HALL_ENV_PREFIX + exhibitionId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function readHallEntry(env, exhibitionId, allowLegacyFallback) {
  const prefix = hallEnvPrefix(exhibitionId);
  const resolve = (suffix, legacyName) => {
    const scoped = env[`${prefix}_${suffix}`];
    if (nonEmpty(scoped)) return scoped.trim();
    if (allowLegacyFallback && legacyName && nonEmpty(env[legacyName])) return env[legacyName].trim();
    return '';
  };

  const agent = resolve('AGENT', 'AGENT');
  if (!agent) throw new Error(`missing required environment variable: ${prefix}_AGENT`);

  const ingressHost = resolve('INGRESS_HOST', 'INGRESS_HOST');
  if (!ingressHost) throw new Error(`missing required environment variable: ${prefix}_INGRESS_HOST`);
  if (/[\s/:]/.test(ingressHost)) {
    throw new Error(`${prefix}_INGRESS_HOST must be a hostname or IP address without protocol or path`);
  }

  const rawPort = resolve('INGRESS_PORT', 'INGRESS_PORT');
  if (!rawPort) throw new Error(`missing required environment variable: ${prefix}_INGRESS_PORT`);
  const ingressPort = Number(rawPort);
  if (!Number.isInteger(ingressPort) || ingressPort < 1 || ingressPort > 65535) {
    throw new Error(`${prefix}_INGRESS_PORT must be a valid TCP port`);
  }

  const ingressToken = resolve('INGRESS_TOKEN', 'INGRESS_TOKEN');
  if (!ingressToken) throw new Error(`missing required environment variable: ${prefix}_INGRESS_TOKEN`);

  const to = resolve('TO', null) || null;

  return Object.freeze({
    exhibitionId,
    agent,
    ingressHost,
    ingressPort,
    ingressToken,
    to,
    ingressUrl: `http://${ingressHost}:${ingressPort}${RUISI_SEND_PATH}`
  });
}

function assertNoHallConflicts(halls) {
  const seenPrefixes = new Map();
  for (const exhibitionId of halls.keys()) {
    const prefix = hallEnvPrefix(exhibitionId);
    if (seenPrefixes.has(prefix)) {
      throw new Error(`HC_TOKEN_MAP contains exhibition ids that share the same environment prefix ${prefix}: ${seenPrefixes.get(prefix)} and ${exhibitionId}`);
    }
    seenPrefixes.set(prefix, exhibitionId);
  }

  const seenAgents = new Map();
  const seenTargets = new Map();
  for (const hall of halls.values()) {
    if (seenAgents.has(hall.agent)) {
      throw new Error(`HC hall config conflict: AGENT is shared by ${seenAgents.get(hall.agent)} and ${hall.exhibitionId}`);
    }
    seenAgents.set(hall.agent, hall.exhibitionId);

    const target = `${hall.ingressHost}:${hall.ingressPort}`;
    if (seenTargets.has(target)) {
      throw new Error(`HC hall config conflict: ingress target ${target} is shared by ${seenTargets.get(target)} and ${hall.exhibitionId}`);
    }
    seenTargets.set(target, hall.exhibitionId);
  }
}

function readExhibitionHalls(env, exhibitionTokens) {
  const hallIds = [...new Set(exhibitionTokens.values())];
  // 旧版单展厅 AGENT/INGRESS_* 只允许在仅映射一个展厅时作为兼容回退，
  // 多展厅模式下绝不跨展厅回退。
  const allowLegacyFallback = hallIds.length === 1;

  const halls = new Map();
  for (const exhibitionId of hallIds) {
    halls.set(exhibitionId, readHallEntry(env, exhibitionId, allowLegacyFallback));
  }
  assertNoHallConflicts(halls);
  return halls;
}

function findSharedRecipients(halls) {
  const groups = new Map();
  for (const hall of halls.values()) {
    if (!hall.to) continue;
    if (!groups.has(hall.to)) groups.set(hall.to, []);
    groups.get(hall.to).push(hall.exhibitionId);
  }
  return [...groups.entries()]
    .filter(([, exhibitionIds]) => exhibitionIds.length > 1)
    .map(([recipient, exhibitionIds]) => ({ recipient, exhibitionIds }));
}

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
  const ruisiCallbackTimeoutMs = Number(env.RUISI_CALLBACK_TIMEOUT_MS || 5000);
  if (!Number.isInteger(ruisiCallbackTimeoutMs) || ruisiCallbackTimeoutMs < 1) {
    throw new Error('RUISI_CALLBACK_TIMEOUT_MS must be a positive integer');
  }
  const configuredScale = Number(env.HC_NARRATION_DURATION_SCALE || 1);
  const narrationDurationScale = Number.isFinite(configuredScale) && configuredScale > 0 ? configuredScale : 1;
  // 鉴权配置无效时必须让启动失败，不能退化成无鉴权模式。
  const exhibitionTokens = parseTokenMap(env.HC_TOKEN_MAP);
  const exhibitionHalls = readExhibitionHalls(env, exhibitionTokens);

  return {
    port,
    mqttUrl: env.MQTT_URL,
    mqttUsername: env.MQTT_USERNAME,
    mqttPassword: env.MQTT_PASSWORD,
    mqttTopic: env.MQTT_TOPIC,
    mqttQos: 0,
    mqttRetain: false,
    ruisiCallbackTimeoutMs,
    narrationDurationScale,
    exhibitionTokens,
    exhibitionHalls
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

module.exports = {
  loadConfig,
  readConfig,
  readExhibitionHalls,
  findSharedRecipients,
  hallEnvPrefix,
  sanitizeMqttUrl,
  RUISI_SEND_PATH
};
