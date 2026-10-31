const dotenv = require('dotenv');
const { parseTokenMap } = require('./exhibition-auth');
const { RUISI_SEND_PATH, parseCallbackAllowlist } = require('./hall-binding');

const HALL_ENV_PREFIX = 'HC_HALL_';
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

function buildHall({ exhibitionId, mode, agent, ingressHost, ingressPort, ingressToken, to, callbackAllowlist }) {
  const hasIngress = Boolean(ingressHost && ingressPort);
  return Object.freeze({
    exhibitionId,
    mode,
    agent: agent || null,
    ingressHost: hasIngress ? ingressHost : null,
    ingressPort: hasIngress ? ingressPort : null,
    ingressToken: ingressToken || null,
    to: to || null,
    callbackAllowlist: callbackAllowlist || Object.freeze([]),
    // 仅作为“可信回程候选”与兜底目标；真正发送时优先使用 RUISI 传入的 context.callback。
    ingressUrl: hasIngress ? `http://${ingressHost}:${ingressPort}${RUISI_SEND_PATH}` : null
  });
}

/**
 * 解析单个展厅的回程配置。
 *
 * 回程配置只服务于 RUISI 回传（Narration / 动态问答），不得成为普通 IOC 指令
 * 发布的前置条件。这里返回结构化结果而不是抛错：
 * - isolated：展厅级 INGRESS_HOST/PORT 完整（可叠加 CALLBACK_ALLOWLIST）；
 * - legacy：展厅级缺失时回退旧版全局 INGRESS_*，Agent 缺省取请求 context.agent；
 * - allowlist：沿用 9811796 已验收的 HC_HALL_*_CALLBACK_ALLOWLIST 协议（支持 https）；
 * - unverified：没有任何可信回程配置，回程被拒绝（普通 IOC 指令不受影响）。
 */
function readHallEntry(env, exhibitionId, { allowGlobalAgent = false } = {}) {
  const prefix = hallEnvPrefix(exhibitionId);
  const scoped = (suffix) => (nonEmpty(env[`${prefix}_${suffix}`]) ? env[`${prefix}_${suffix}`].trim() : '');
  const global = (name) => (nonEmpty(env[name]) ? env[name].trim() : '');

  try {
    const scopedAgent = scoped('AGENT');
    const scopedHost = scoped('INGRESS_HOST');
    const scopedPort = scoped('INGRESS_PORT');
    const scopedToken = scoped('INGRESS_TOKEN');
    const scopedTo = scoped('TO');
    const callbackAllowlist = parseCallbackAllowlist(
      scoped('CALLBACK_ALLOWLIST') || scoped('CALLBACK_ALLOW_LIST'),
      `${prefix}_CALLBACK_ALLOWLIST`
    );

    // 展厅级与旧版全局按字段回退，避免升级时只补了部分变量就整厅回程不可用。
    const globalHost = global(LEGACY_HALL_ENV.ingressHost);
    const globalPort = global(LEGACY_HALL_ENV.ingressPort);
    const globalToken = global(LEGACY_HALL_ENV.ingressToken);
    const ingressHost = scopedHost || globalHost;
    const ingressPort = scopedPort || globalPort;
    // 回程 Token 只允许来自本展厅，或“同一 Ingress 目标”的全局 Token。
    // 多展厅下不得把全局 Token 用于另一个展厅独有的 Ingress，避免跨展厅凭据串用。
    const usesGlobalTarget = Boolean(
      globalHost && globalPort
      && ingressHost === globalHost
      && String(ingressPort) === String(globalPort)
    );
    const canUseGlobalToken = allowGlobalAgent || usesGlobalTarget;
    const ingressToken = scopedToken || (canUseGlobalToken ? globalToken : '');
    const globalAgent = allowGlobalAgent ? global(LEGACY_HALL_ENV.agent) : '';
    const agent = scopedAgent || globalAgent;

    let mode = 'unverified';
    if (scopedHost && scopedPort) mode = 'isolated';
    else if (ingressHost && ingressPort) mode = 'legacy';
    else if (callbackAllowlist.length > 0) mode = 'allowlist';

    const hasIngress = Boolean(ingressHost && ingressPort);
    return {
      ok: true,
      hall: buildHall({
        exhibitionId,
        mode,
        agent,
        ingressHost: hasIngress ? assertHostShape(ingressHost, scopedHost ? `${prefix}_INGRESS_HOST` : LEGACY_HALL_ENV.ingressHost) : null,
        ingressPort: hasIngress ? parseIngressPort(ingressPort, scopedPort ? `${prefix}_INGRESS_PORT` : LEGACY_HALL_ENV.ingressPort) : null,
        ingressToken,
        to: scopedTo,
        callbackAllowlist
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

  const agents = new Map();
  const targets = new Map();
  for (const hall of halls.values()) {
    if (hall.agent) {
      if (agents.has(hall.agent)) {
        warnings.push({
          code: 'shared-agent',
          exhibitionIds: [agents.get(hall.agent), hall.exhibitionId],
          message: `展厅 ${agents.get(hall.agent)} 与 ${hall.exhibitionId} 共用同一回程 AGENT，回程身份可能混淆`
        });
      } else {
        agents.set(hall.agent, hall.exhibitionId);
      }
    }

    if (hall.mode === 'unverified') {
      warnings.push({
        code: 'callback-unverified',
        exhibitionIds: [hall.exhibitionId],
        message: `展厅 ${hall.exhibitionId} 未配置可信回程目标，回程业务将返回 403；请配置 CALLBACK_ALLOWLIST 或 INGRESS_HOST/PORT`
      });
      continue;
    }

    if (!hall.ingressHost) continue;
    const target = `${hall.ingressHost}:${hall.ingressPort}`;
    if (targets.has(target)) {
      warnings.push({
        code: 'shared-ingress-target',
        exhibitionIds: [targets.get(target), hall.exhibitionId],
        message: `展厅 ${targets.get(target)} 与 ${hall.exhibitionId} 共用回程入口 ${target}，仅能依靠 AGENT 区分展厅`
      });
    } else {
      targets.set(target, hall.exhibitionId);
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
  // 回程配置不完整只降级回程可信度，不能让执行器无法启动：普通 IOC 指令不依赖回程。
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
  readHallEntry,
  findSharedRecipients,
  hallEnvPrefix,
  sanitizeMqttUrl,
  RUISI_SEND_PATH
};
