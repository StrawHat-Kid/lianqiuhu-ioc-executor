const dotenv = require('dotenv');
const { parseTokenMap } = require('./exhibition-auth');

const HALL_ENV_PREFIX = 'HC_HALL_';
const RUISI_SEND_PATH = '/agent/send';
const LEGACY_HALL_ENV = Object.freeze({
  agent: 'AGENT',
  ingressHost: 'INGRESS_HOST',
  ingressPort: 'INGRESS_PORT',
  ingressToken: 'INGRESS_TOKEN'
});

const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';

function hallEnvPrefix(exhibitionId) {
  return HALL_ENV_PREFIX + exhibitionId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function parseIngressPort(raw, label) {
  const ingressPort = Number(raw);
  if (!Number.isInteger(ingressPort) || ingressPort < 1 || ingressPort > 65535) {
    throw new Error(`${label} must be a valid TCP port`);
  }
  return ingressPort;
}

function assertHostShape(host, label) {
  if (/[\s/:]/.test(host)) {
    throw new Error(`${label} must be a hostname or IP address without protocol or path`);
  }
  return host;
}

function buildHall({ exhibitionId, mode, agent, ingressHost, ingressPort, ingressToken, to }) {
  return Object.freeze({
    exhibitionId,
    mode,
    agent: agent || null,
    ingressHost,
    ingressPort,
    ingressToken,
    to: to || null,
    ingressUrl: `http://${ingressHost}:${ingressPort}${RUISI_SEND_PATH}`
  });
}

/**
 * 解析单个展厅的回程配置。
 *
 * 回程配置只服务于 RUISI 回传（Narration / 动态问答），不得成为普通 IOC 指令
 * 发布的前置条件。因此这里不再抛错终止启动，而是返回结构化结果：
 * - 展厅级 HC_HALL_<ID>_* 完整：isolated 模式，Agent/Host/Port/Token 均由服务端固定；
 * - 展厅级缺失、但存在旧版全局 INGRESS_*：legacy 模式，沿用旧版已验证的回程方式，
 *   Agent 缺省取请求 context.agent；
 * - 都没有：该展厅回程禁用，普通指令仍可正常发布。
 */
function readHallEntry(env, exhibitionId, { allowGlobalAgent = false } = {}) {
  const prefix = hallEnvPrefix(exhibitionId);
  const scoped = (suffix) => (nonEmpty(env[`${prefix}_${suffix}`]) ? env[`${prefix}_${suffix}`].trim() : '');
  const global = (name) => (nonEmpty(env[name]) ? env[name].trim() : '');
  const required = ['AGENT', 'INGRESS_HOST', 'INGRESS_PORT', 'INGRESS_TOKEN'];
  const hasScoped = required.concat('TO').some((suffix) => scoped(suffix) !== '');

  try {
    if (hasScoped) {
      const missing = required.filter((suffix) => scoped(suffix) === '');
      if (missing.length > 0) {
        return { ok: false, error: `missing required environment variable: ${prefix}_${missing[0]}` };
      }
      return {
        ok: true,
        hall: buildHall({
          exhibitionId,
          mode: 'isolated',
          agent: scoped('AGENT'),
          ingressHost: assertHostShape(scoped('INGRESS_HOST'), `${prefix}_INGRESS_HOST`),
          ingressPort: parseIngressPort(scoped('INGRESS_PORT'), `${prefix}_INGRESS_PORT`),
          ingressToken: scoped('INGRESS_TOKEN'),
          to: scoped('TO')
        })
      };
    }

    const legacyHost = global(LEGACY_HALL_ENV.ingressHost);
    const legacyPort = global(LEGACY_HALL_ENV.ingressPort);
    const legacyToken = global(LEGACY_HALL_ENV.ingressToken);
    if (!legacyHost || !legacyPort || !legacyToken) {
      return {
        ok: false,
        error: `missing required environment variable: ${prefix}_INGRESS_HOST`
      };
    }

    const legacyAgent = allowGlobalAgent ? global(LEGACY_HALL_ENV.agent) : '';
    return {
      ok: true,
      hall: buildHall({
        exhibitionId,
        mode: 'legacy',
        agent: legacyAgent,
        ingressHost: assertHostShape(legacyHost, LEGACY_HALL_ENV.ingressHost),
        ingressPort: parseIngressPort(legacyPort, LEGACY_HALL_ENV.ingressPort),
        ingressToken: legacyToken,
        to: ''
      })
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function collectHallWarnings(halls) {
  const warnings = [];

  const seenPrefixes = new Map();
  for (const exhibitionId of halls.keys()) {
    const prefix = hallEnvPrefix(exhibitionId);
    if (seenPrefixes.has(prefix)) {
      warnings.push({
        code: 'duplicate-env-prefix',
        exhibitionIds: [seenPrefixes.get(prefix), exhibitionId],
        message: `展厅 ${seenPrefixes.get(prefix)} 与 ${exhibitionId} 共享环境变量前缀 ${prefix}，请调整 exhibitionId`
      });
      continue;
    }
    seenPrefixes.set(prefix, exhibitionId);
  }

  const isolatedAgents = new Map();
  const isolatedTargets = new Map();
  for (const hall of halls.values()) {
    if (hall.mode !== 'isolated') continue;
    if (isolatedAgents.has(hall.agent)) {
      warnings.push({
        code: 'shared-agent',
        exhibitionIds: [isolatedAgents.get(hall.agent), hall.exhibitionId],
        message: `展厅 ${isolatedAgents.get(hall.agent)} 与 ${hall.exhibitionId} 共用同一回程 AGENT，回程身份可能混淆`
      });
    } else {
      isolatedAgents.set(hall.agent, hall.exhibitionId);
    }

    const target = `${hall.ingressHost}:${hall.ingressPort}`;
    if (isolatedTargets.has(target)) {
      warnings.push({
        code: 'shared-ingress-target',
        exhibitionIds: [isolatedTargets.get(target), hall.exhibitionId],
        message: `展厅 ${isolatedTargets.get(target)} 与 ${hall.exhibitionId} 共用回程入口 ${target}，仅能依靠 AGENT 区分展厅`
      });
    } else {
      isolatedTargets.set(target, hall.exhibitionId);
    }
  }

  return warnings;
}

function readExhibitionHalls(env, exhibitionTokens) {
  const hallIds = [...new Set(exhibitionTokens.values())];
  // 旧版全局 AGENT 只在仅映射一个展厅时使用；多展厅时 Agent 必须由展厅级配置
  // 或请求 context.agent 提供，避免把 A 展厅身份套用到 B。
  const allowGlobalAgent = hallIds.length === 1;

  const halls = new Map();
  const issues = [];
  for (const exhibitionId of hallIds) {
    const entry = readHallEntry(env, exhibitionId, { allowGlobalAgent });
    if (entry.ok) halls.set(exhibitionId, entry.hall);
    else issues.push({ exhibitionId, error: entry.error });
  }
  return { halls, issues, warnings: collectHallWarnings(halls) };
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
  // 回程配置不完整只降级回程能力，不能让执行器无法启动：普通 IOC 指令不依赖回程。
  const { halls, issues, warnings } = readExhibitionHalls(env, exhibitionTokens);

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
    exhibitionHalls: halls,
    exhibitionHallIssues: issues,
    exhibitionHallWarnings: warnings
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
