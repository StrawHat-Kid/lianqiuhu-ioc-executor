'use strict';

const RUISI_SEND_PATH = '/agent/send';

function effectivePort(url) {
  return url.port || (url.protocol === 'http:' ? '80' : '443');
}

function callbackHost(callback) {
  try {
    return new URL(callback).host;
  } catch {
    return '[invalid callback URL]';
  }
}

/**
 * 校验请求携带的 context.callback 是否就是该展厅可信的 RUISI 回程入口。
 * 只允许 http + 配置中的 host + 配置中的 port + 固定 /agent/send 路径。
 */
function isTrustedCallback(callback, hall) {
  if (typeof callback !== 'string' || callback.trim() === '') return false;
  if (!hall || typeof hall !== 'object') return false;
  let target;
  try {
    target = new URL(callback);
  } catch {
    return false;
  }
  if (target.protocol !== 'http:') return false;
  if ((target.hostname || '').toLowerCase() !== String(hall.ingressHost || '').toLowerCase()) return false;
  if (effectivePort(target) !== String(hall.ingressPort)) return false;
  return target.pathname === RUISI_SEND_PATH;
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

    if (!isTrustedCallback(context.callback, hall)) {
      log.warn('[回程隔离] callback 目标与该展厅可信 Ingress 配置不一致，已拒绝', {
        requestId,
        exhibitionId,
        callbackHost: callbackHost(context.callback),
        trustedIngressHost: hall.ingressHost,
        trustedIngressPort: hall.ingressPort
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
        replyTo: context.replyTo || hall.to || context.replyTo,
        // 实际回程目标始终使用服务端可信配置，请求中的 callback 只用于一致性校验。
        callback: hall.ingressUrl,
        ingressToken: hall.ingressToken
      })
    };
  }

  return { bind };
}

module.exports = {
  RUISI_SEND_PATH,
  isTrustedCallback,
  createHallBinder
};
