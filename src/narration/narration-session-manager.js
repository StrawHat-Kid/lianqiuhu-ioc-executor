const { randomUUID } = require('node:crypto');
const { getCallbackContextError } = require('../ruisi-callback-client');

function abortError() {
  const error = new Error('narration wait aborted');
  error.name = 'AbortError';
  return error;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', cancelled);
      resolve();
    }
    function cancelled() {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancelled);
      reject(abortError());
    }
    signal?.addEventListener('abort', cancelled, { once: true });
  });
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function getEffectiveSegmentDurationMs(content, segment, durationScale) {
  return getSegmentDurationDetails(content, segment, durationScale).effectiveHoldMs;
}

function getSegmentDurationDetails(content, segment, durationScale) {
  const scaledSpeechDurationMs = Math.max(1, Math.round(content.durationMs * durationScale));
  const minimumIocHoldMs = Number.isFinite(segment.minimumIocHoldMs) && segment.minimumIocHoldMs > 0
    ? Math.round(segment.minimumIocHoldMs)
    : 0;
  const postGapMs = Number.isFinite(segment.postGapMs) && segment.postGapMs >= 0
    ? Math.round(segment.postGapMs)
    : 0;
  const iocHoldMs = Math.max(scaledSpeechDurationMs, minimumIocHoldMs);
  return {
    speechDurationMs: content.durationMs,
    durationScale,
    scaledSpeechDurationMs,
    minimumIocHoldMs,
    postGapMs,
    iocHoldMs,
    effectiveHoldMs: iocHoldMs + postGapMs
  };
}

function createNarrationSessionManager({ commandExecutor, callbackClient, logger, durationScale = 1, wait = sleep } = {}) {
  if (!commandExecutor || typeof commandExecutor.publishFrontendCommands !== 'function') {
    throw new Error('narration command executor is required');
  }
  if (!callbackClient || typeof callbackClient.sendAgentMessage !== 'function') {
    throw new Error('narration callback client is required');
  }
  if (!Number.isFinite(durationScale) || durationScale <= 0) throw new Error('narration duration scale must be positive');
  let activeSession = null;

  function sessionDetails(session, extra = {}) {
    return { requestId: session.requestId, sessionId: session.id, scenario: session.scenario, ...extra };
  }

  async function publishTerminal(session, mode) {
    if (!session.iocStarted || session.terminalPublished) return session.terminalPromise || undefined;
    session.terminalPublished = true;
    session.terminalMode = mode;
    const commands = mode === 'complete' ? session.definition.completeCommands : session.definition.cancelCommands;
    logger.info('[讲解] 开始执行会话清理', sessionDetails(session, { mode }));
    session.terminalPromise = commandExecutor.publishFrontendCommands(commands, {
      source: `narration:${session.scenario}:${mode}`, requestId: session.requestId, sessionId: session.id
    }).then((result) => {
      if (!result.ok) logger.error('[讲解] 会话清理失败', sessionDetails(session, { stage: 'cleanup', error: result.error }));
      else logger.info('[讲解] 会话清理完成', sessionDetails(session, { mode }));
      return result;
    }).catch((error) => {
      logger.error('[讲解] 会话清理异常', sessionDetails(session, { stage: 'cleanup', error: error.message }));
      return { ok: false, error: 'narration cleanup failed' };
    });
    return session.terminalPromise;
  }

  function completeSession(session, mode) {
    session.state = 'completed';
    if (activeSession?.id === session.id) activeSession = null;
    logger.info(mode === 'complete' ? '[讲解] 会话正常完成' : '[讲解] 会话取消完成', sessionDetails(session, { mode }));
  }

  async function run(session) {
    let completedNormally = false;
    try {
      if (session.abortController.signal.aborted) return;
      session.state = 'running';
      logger.info('[讲解] 会话启动', sessionDetails(session, { language: session.language }));
      const prepareCommands = session.definition.prepareCommands || [];
      logger.info('[讲解] Narration prepareCommands 开始', sessionDetails(session, { commands: prepareCommands }));
      if (prepareCommands.length > 0) {
        const prepareResult = await commandExecutor.publishFrontendCommands(prepareCommands, {
          source: `narration:${session.scenario}:prepare`, requestId: session.requestId, sessionId: session.id
        });
        if (!prepareResult.ok) {
          logger.error('[讲解] Narration prepareCommands 失败', sessionDetails(session, { stage: 'ioc-prepare', error: prepareResult.error }));
          return;
        }
      }
      logger.info('[讲解] Narration prepareCommands 完成', sessionDetails(session));
      if (session.abortController.signal.aborted) return;
      const introDelayMs = Number.isFinite(session.definition.introDelayMs) && session.definition.introDelayMs >= 0
        ? Math.round(session.definition.introDelayMs)
        : 0;
      logger.info('[讲解] Narration introDelay 开始', sessionDetails(session, { introDelayMs }));
      if (introDelayMs > 0) await wait(introDelayMs, session.abortController.signal);
      logger.info('[讲解] Narration introDelay 完成', sessionDetails(session, { introDelayMs }));
      if (session.abortController.signal.aborted) return;
      const startResult = await commandExecutor.publishFrontendCommands(session.definition.startCommands, {
        source: `narration:${session.scenario}:start`, requestId: session.requestId, sessionId: session.id
      });
      if (!startResult.ok) {
        logger.error('[讲解] IOC起始指令发布失败', sessionDetails(session, { stage: 'ioc-start', error: startResult.error }));
        return;
      }
      session.iocStarted = true;
      logger.info('[讲解] IOC起始指令发布成功', sessionDetails(session));
      if (session.abortController.signal.aborted) return;

      for (const segment of session.definition.segments) {
        if (session.abortController.signal.aborted) return;
        const content = segment.content[session.language];
        const durationDetails = getSegmentDurationDetails(content, segment, durationScale);
        logger.info('[讲解] Narration segment开始', sessionDetails(session, {
          segment: `${segment.index}/${session.definition.segments.length}`,
          durationMs: durationDetails.speechDurationMs,
          scaledDurationMs: durationDetails.scaledSpeechDurationMs,
          postGapMs: durationDetails.postGapMs
        }));
        if (segment.commands.length > 0) {
          logger.info('[讲解] 准备切换IOC展示步骤', sessionDetails(session, {
            segment: `${segment.index}/${session.definition.segments.length}`, commands: segment.commands
          }));
          const stepResult = await commandExecutor.publishFrontendCommands(segment.commands, {
            source: `narration:${session.scenario}:segment-${segment.index}`,
            requestId: session.requestId, sessionId: session.id
          });
          if (!stepResult.ok) {
            logger.error('[讲解] IOC展示步骤切换失败', sessionDetails(session, {
              stage: 'ioc-step', index: segment.index, error: stepResult.error
            }));
            return;
          }
        }
        if (session.abortController.signal.aborted) return;
        const callbackResult = await callbackClient.sendAgentMessage(session.context, {
          body: content.text, signal: session.abortController.signal, requestId: session.requestId,
          sessionId: session.id, scenario: session.scenario, segmentIndex: segment.index,
          segmentCount: session.definition.segments.length
        });
        logger.info('[讲解] 播报段回程处理完成', sessionDetails(session, {
          segment: `${segment.index}/${session.definition.segments.length}`, ok: callbackResult.ok, status: callbackResult.status
        }));
        if (!callbackResult.ok && !session.abortController.signal.aborted) {
          logger.warn('[讲解] 回程失败但将继续既定流程', sessionDetails(session, {
            stage: 'callback', index: segment.index,
            status: callbackResult.status, error: callbackResult.error
          }));
        }
        if (session.abortController.signal.aborted) return;
        if (durationDetails.minimumIocHoldMs > 0) {
          logger.info('[讲解] IOC最小保持时间计算', sessionDetails(session, {
            segment: `${segment.index}/${session.definition.segments.length}`, ...durationDetails
          }));
        }
        const durationMs = durationDetails.effectiveHoldMs;
        logger.info('[讲解] 播报段等待开始', sessionDetails(session, {
          segment: `${segment.index}/${session.definition.segments.length}`,
          durationMs: durationDetails.speechDurationMs,
          scaledDurationMs: durationDetails.scaledSpeechDurationMs,
          postGapMs: durationDetails.postGapMs,
          effectiveHoldMs: durationMs
        }));
        await wait(durationMs, session.abortController.signal);
        logger.info('[讲解] Narration segment等待完成', sessionDetails(session, {
          segment: `${segment.index}/${session.definition.segments.length}`
        }));
      }
      completedNormally = true;
    } catch (error) {
      if (!isAbortError(error)) {
        logger.error('[讲解] 会话运行异常', sessionDetails(session, { stage: 'runtime', error: error.message }));
      }
    } finally {
      const mode = completedNormally && !session.abortController.signal.aborted ? 'complete' : 'cancel';
      await publishTerminal(session, mode);
      completeSession(session, mode);
    }
  }

  async function cancelSession(session, reason) {
    if (!session || session.state === 'completed') return false;
    if (!session.abortController.signal.aborted) {
      session.state = 'cancelling';
      session.cancelReason = reason;
      logger.info(reason === 'preempted' ? '[讲解] 会话被新讲解请求抢占' : '[讲解] 正在取消会话', sessionDetails(session, { reason }));
      session.abortController.abort();
    }
    await session.runPromise;
    return true;
  }

  function startNarration({ definition, context, language, requestId }) {
    const callbackError = getCallbackContextError(context);
    if (callbackError) return { ok: false, error: `narration callback unavailable: ${callbackError}` };
    const previousSession = activeSession;
    const session = {
      id: randomUUID(), requestId, scenario: definition.scenario, context, language,
      state: 'created', startedAt: new Date().toISOString(), abortController: new AbortController(),
      definition, iocStarted: false, terminalPublished: false, terminalPromise: null, runPromise: null
    };
    activeSession = session;
    logger.info('[讲解] 已接收讲解请求', sessionDetails(session, { action: definition.action, language: session.language }));
    session.runPromise = (async () => {
      if (previousSession) await cancelSession(previousSession, 'preempted');
      await run(session);
    })().catch((error) => {
      logger.error('[讲解] 后台任务异常', sessionDetails(session, { stage: 'background', error: error.message }));
      completeSession(session, 'cancel');
    });
    // The request must never await this lifecycle, but the task must always have an error observer.
    return { ok: true, session };
  }

  async function cancelActiveNarration(reason = 'cancelled') {
    return cancelSession(activeSession, reason);
  }

  return {
    startNarration, cancelActiveNarration,
    getActiveSession: () => activeSession,
    sleep
  };
}

module.exports = { createNarrationSessionManager, sleep, getEffectiveSegmentDurationMs, getSegmentDurationDetails };
