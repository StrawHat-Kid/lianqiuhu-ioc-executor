'use strict';

const RUISI_SEND_PATH = '/agent/send';

function effectivePort(url) {
  return url.port || (url.protocol === 'http:' ? '80' : '443');
}

/**
 * 解析 9811796 已验证的回程白名单：逗号分隔的绝对 http(s) URL。
 * 允许为空（回程配置降级），但任一条目非法都视为配置错误。
 */
function parseCallbackAllowlist(raw, label) {
  if (typeof raw !== 'string' || raw.trim() === '') return Object.freeze([]);
  const entries = [];
  for (const part of raw.split(',')) {
    const value = part.trim();
    if (!value) throw new Error(`${label} contains an empty entry`);
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${label} entry must be an absolute http(s) URL`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`${label} entry must use http:// or https://`);
    }
    entries.push(url.toString());
  }
  return Object.freeze(entries);
}

function isCallbackAllowed(callback, allowlist) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return false;
  let target;
  try {
    target = new URL(callback);
  } catch {
    return false;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;

  const targetPort = effectivePort(target);
  for (const entry of allowlist) {
    let allowed;
    try {
      allowed = new URL(entry);
    } catch {
      continue;
    }
    if (target.protocol !== allowed.protocol) continue;
    if (target.hostname.toLowerCase() !== allowed.hostname.toLowerCase()) continue;
    if (targetPort !== effectivePort(allowed)) continue;

    const allowedPath = allowed.pathname || '/';
    if (target.pathname === allowedPath) return true;
    // 只有显式以 / 结尾的白名单条目才按目录前缀放行，避免 /agent/send 放行
    // /agent/send/xxx 这类相似路径绕过。
    if (allowedPath.endsWith('/') && target.pathname.startsWith(allowedPath)) return true;
  }
  return false;
}

function callbackHost(callback) {
  try {
    return new URL(callback).host;
  } catch {
    return '[invalid callback URL]';
  }
}

/**
 * 展厅级 INGRESS_HOST/PORT 的可信匹配：scheme 允许 http 或 https（产品实际回调
 * 可能是 https），host 与有效端口必须一致，路径必须是 /agent/send。
 */
function isTrustedCallback(callback, hall) {
  if (typeof callback !== 'string' || callback.trim() === '') return false;
  if (!hall || typeof hall !== 'object') return false;
  if (!hall.ingressHost || !hall.ingressPort) return false;
  let target;
  try {
    target = new URL(callback);
  } catch {
    return false;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  if ((target.hostname || '').toLowerCase() !== String(hall.ingressHost).toLowerCase()) return false;
  if (effectivePort(target) !== String(hall.ingressPort)) return false;
  return target.pathname === RUISI_SEND_PATH;
}

/**
 * 选择真正的回程目标：
 * - 配置了 CALLBACK_ALLOWLIST：必须在白名单内，命中后按 RUISI 原始 callback 发送；
 * - 配置了 INGRESS_HOST/PORT：必须与该可信入口一致，命中后仍按原始 callback 发送；
 * - 两者都没有：视为未配置可信回程，拒绝回程。
 * 任何情况下都不改写 RUISI 传入的路径/协议，避免改变已验证的回程协议。
 */
function resolveCallback(callback, hall) {
  const allowlist = hall.callbackAllowlist || [];
  if (allowlist.length > 0) {
    if (isCallbackAllowed(callback, allowlist)) return { ok: true, callback };
    return { ok: false, error: 'callback target is not allowed for this exhibition' };
  }
  if (hall.ingressUrl) {
    if (isTrustedCallback(callback, hall)) return { ok: true, callback };
    return { ok: false, error: 'callback target is not allowed for this exhibition' };
  }
  return { ok: false, error: 'exhibition callback configuration is missing' };
}

function createHallBinder({ halls, logger } = {}) {
  if (!(halls instanceof Map)) throw new Error('exhibition halls must be a Map');
  const log = logger || { info() {}, warn() {}, error() {} };

  function bind({ exhibitionId, context, requestId } = {}) {
    if (!context) return { ok: false, status: 400, error: 'missing context' };
    if (typeof context.callback !== 'string' || context.callback.trim() === '') {
      return { ok: false, status: 400, error: 'missing context.callback' };
    }

    const hall = halls.get(exhibitionId);
    if (!hall) return { ok: false, status: 403, error: 'exhibition callback configuration is missing' };

    const resolved = resolveCallback(context.callback, hall);
    if (!resolved.ok) {
      log.warn('[回程隔离] callback 目标不属于该展厅可信回程范围，已拒绝', {
        requestId,
        exhibitionId,
        callbackHost: callbackHost(context.callback),
        trustedIngressHost: hall.ingressHost,
        trustedIngressPort: hall.ingressPort,
        callbackAllowlist: hall.callbackAllowlist
      });
      return { ok: false, status: 403, error: resolved.error };
    }
    if (hall.agent && context.agent && context.agent !== hall.agent) {
      log.warn('[回程隔离] 忽略请求中的 context.agent，使用展厅可信 Agent', { requestId, exhibitionId });
    }
    // 展厅级 AGENT 未配置（旧版全局回程模式）时沿用请求 Agent，与已验证的旧版行为一致。
    const agent = hall.agent || context.agent;
    if (typeof agent !== 'string' || agent.trim() === '') {
      log.warn('[回程隔离] 展厅缺少可信 Agent 且请求未提供 context.agent，已拒绝', { requestId, exhibitionId });
      return { ok: false, status: 400, error: 'missing context.agent' };
    }

    return {
      ok: true,
      context: Object.freeze({
        ...context,
        agent,
        replyTo: context.replyTo || hall.to || context.replyTo,
        // 直接使用 RUISI 传入的回程地址，避免改写已验证的协议、主机或路径。
        callback: resolved.callback,
        ingressToken: hall.ingressToken || undefined
      })
    };
  }

  return { bind };
}

module.exports = {
  RUISI_SEND_PATH,
  parseCallbackAllowlist,
  isCallbackAllowed,
  isTrustedCallback,
  resolveCallback,
  createHallBinder
};
