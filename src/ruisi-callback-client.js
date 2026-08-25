const DEFAULT_TIMEOUT_MS = 5000;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function callbackHost(callback) {
  try {
    return new URL(callback).host;
  } catch {
    return '[invalid callback URL]';
  }
}

function unavailable(error) {
  return { ok: false, status: null, error: `callback unavailable: ${error}` };
}

function responseSummary(text) {
  if (!text) return '';
  return text.length > 2048 ? `${text.slice(0, 2048)}…[已截断]` : text;
}

function getCallbackContextError(context) {
  if (!context || typeof context !== 'object') return 'missing context';
  if (!isNonEmptyString(context.callback)) return 'missing context.callback';
  if (!isNonEmptyString(context.agent)) return 'missing context.agent';
  if (!isNonEmptyString(context.replyTo)) return 'missing context.replyTo';
  if (context.groupchat !== undefined && typeof context.groupchat !== 'boolean') return 'context.groupchat must be a boolean';
  try {
    const url = new URL(context.callback);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'context.callback must use http:// or https://';
  } catch {
    return 'context.callback must be a valid URL';
  }
  return null;
}

function getMessagePayload(context, options) {
  const contextError = getCallbackContextError(context);
  if (contextError) return { error: contextError };
  const to = options.to === undefined ? context.replyTo : options.to;
  if (!isNonEmptyString(to)) return { error: 'missing recipient' };
  if (!isNonEmptyString(options.body)) return { error: 'body must be a non-empty string' };
  const groupchat = options.groupchat === undefined
    ? (context.groupchat === undefined ? false : context.groupchat)
    : options.groupchat;
  if (typeof groupchat !== 'boolean') return { error: 'groupchat must be a boolean' };
  return {
    callback: context.callback,
    payload: { agent: context.agent, to, body: options.body, groupchat }
  };
}

function createRuisiCallbackClient({ logger, authToken, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('callback timeout must be a positive integer');
  const log = logger || { info() {}, warn() {}, error() {} };

  async function sendAgentMessage(context, options = {}) {
    const message = getMessagePayload(context, options);
    if (message.error) return unavailable(message.error);

    const controller = new AbortController();
    const abortFromSession = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', abortFromSession, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { 'Content-Type': 'application/json' };
    if (isNonEmptyString(authToken)) headers['X-Auth-Token'] = authToken;
    const host = callbackHost(message.callback);
    const logDetails = {
      requestId: options.requestId, sessionId: options.sessionId, scenario: options.scenario,
      callback: message.callback, callbackHost: host, agent: message.payload.agent, to: message.payload.to,
      groupchat: message.payload.groupchat, body: message.payload.body,
      segment: options.segmentIndex === undefined ? undefined : `${options.segmentIndex}/${options.segmentCount}`,
      timeoutMs, ingressAuthState: isNonEmptyString(authToken) ? '已配置' : '未配置',
      xAuthState: isNonEmptyString(authToken) ? '已携带' : '未携带'
    };
    const startedAt = Date.now();
    log.info('[执行器→RUISI回程] 准备发送消息', logDetails);
    try {
      const response = await fetchImpl(message.callback, {
        method: 'POST', headers, body: JSON.stringify(message.payload), signal: controller.signal
      });
      const elapsedMs = Date.now() - startedAt;
      if (response.ok) {
        log.info('[执行器→RUISI回程] 发送成功', { ...logDetails, status: response.status, elapsedMs });
        return { ok: true, status: response.status };
      }
      const responseText = responseSummary(await response.text());
      log.error('[执行器→RUISI回程] 发送失败', {
        ...logDetails, status: response.status, response: responseText, elapsedMs
      });
      return { ok: false, status: response.status, error: `RUISI callback failed with status ${response.status}` };
    } catch (error) {
      const aborted = options.signal?.aborted;
      const timedOut = error && error.name === 'AbortError';
      const detail = aborted ? 'aborted' : timedOut ? `timeout after ${timeoutMs}ms` : 'network error';
      if (!aborted) {
        log.error(timedOut ? '[执行器→RUISI回程] 回程超时' : '[执行器→RUISI回程] 网络异常', {
          ...logDetails, errorType: error?.name, error: error?.message || detail, elapsedMs: Date.now() - startedAt
        });
      }
      return { ok: false, status: null, error: `RUISI callback ${detail}` };
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortFromSession);
    }
  }

  return { sendAgentMessage };
}

module.exports = { DEFAULT_TIMEOUT_MS, createRuisiCallbackClient, getCallbackContextError };
