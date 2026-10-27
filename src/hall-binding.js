'use strict';

function parseCallbackAllowlist(raw, label) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`${label} must contain at least one allowed callback URL`);
  }
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

function effectivePort(url) {
  return url.port || (url.protocol === 'http:' ? '80' : '443');
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
    const prefix = allowedPath.endsWith('/') ? allowedPath : `${allowedPath}/`;
    if (target.pathname.startsWith(prefix)) return true;
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
    if (!isCallbackAllowed(context.callback, hall.callbackAllowlist)) {
      log.warn('[回程隔离] callback 目标不在展厅允许范围内，已拒绝', {
        requestId, exhibitionId, callbackHost: callbackHost(context.callback)
      });
      return { ok: false, status: 403, error: 'callback target is not allowed for this exhibition' };
    }
    if (context.agent && context.agent !== hall.agent) {
      log.warn('[回程隔离] 忽略请求中的 context.agent，使用展厅可信 Agent', { requestId, exhibitionId });
    }
    return {
      ok: true,
      context: Object.freeze({
        ...context,
        agent: hall.agent,
        ingressToken: hall.ingressToken || undefined
      })
    };
  }

  return { bind };
}

module.exports = {
  parseCallbackAllowlist,
  isCallbackAllowed,
  createHallBinder
};
