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
  const ttsStartupBufferMs = Number.isFinite(segment.ttsStartupBufferMs) && segment.ttsStartupBufferMs >= 0
    ? Math.round(segment.ttsStartupBufferMs)
    : 0;
  const minimumIocHoldMs = Number.isFinite(segment.minimumIocHoldMs) && segment.minimumIocHoldMs > 0
    ? Math.round(segment.minimumIocHoldMs)
    : 0;
  const postGapMs = Number.isFinite(segment.postGapMs) && segment.postGapMs >= 0
    ? Math.round(segment.postGapMs)
    : 0;
  const speechBudgetMs = ttsStartupBufferMs + scaledSpeechDurationMs;
  const iocHoldMs = Math.max(speechBudgetMs, minimumIocHoldMs);
  return {
    speechDurationMs: content.durationMs,
    durationScale,
    scaledSpeechDurationMs,
    ttsStartupBufferMs,
    speechBudgetMs,
    minimumIocHoldMs,
    postGapMs,
    iocHoldMs,
    effectiveHoldMs: iocHoldMs + postGapMs
  };
}

function getReturnGroups(definition) {
  const groups = definition.returnGroups;
  if (!Array.isArray(groups) || groups.length === 0) return definition.segments.map((segment) => [segment]);
  const byIndex = new Map(definition.segments.map((segment) => [segment.index, segment]));
  const usedIndexes = new Set();
  const resolved = groups.map((indexes) => {
    if (!Array.isArray(indexes) || indexes.length === 0) throw new Error('narration return group must contain segments');
    return indexes.map((index) => {
      if (!Number.isInteger(index) || usedIndexes.has(index) || !byIndex.has(index)) {
        throw new Error('narration return groups must reference each segment once');
      }
      usedIndexes.add(index);
      return byIndex.get(index);
    });
  });
  if (usedIndexes.size !== definition.segments.length) {
    throw new Error('narration return groups must cover every segment');
  }
  return resolved;
}

function getReturnGroupDurationDetails(segments, language, durationScale) {
  const details = segments.map((segment) => getSegmentDurationDetails(segment.content[language], segment, durationScale));
  const first = details[0];
  const last = details.at(-1);
  const scaledSpeechDurationMs = details.reduce((total, item) => total + item.scaledSpeechDurationMs, 0);
  const minimumIocHoldMs = Math.max(...details.map((item) => item.minimumIocHoldMs));
  const speechBudgetMs = first.ttsStartupBufferMs + scaledSpeechDurationMs;
  const iocHoldMs = Math.max(speechBudgetMs, minimumIocHoldMs);
  return {
    speechDurationMs: details.reduce((total, item) => total + item.speechDurationMs, 0),
    durationScale,
    scaledSpeechDurationMs,
    // 一个合并回程只会真正启动一次 TTS，因此只使用第一 step 的 buffer。
    ttsStartupBufferMs: first.ttsStartupBufferMs,
    speechBudgetMs,
    minimumIocHoldMs,
    // 仅保留组尾 step 与下一回程之间原本就存在的边界 gap。
    postGapMs: last.postGapMs,
    iocHoldMs,
    effectiveHoldMs: iocHoldMs + last.postGapMs,
    segmentDetails: details
  };
}

function getReturnGroupWaitMs(definition, groupPosition, groupCount, language, fallbackDelayMs) {
  // Narration 2.0 当前只有两个回程：显式配置只定义第一回程到第二回程的间隔，
  // 不能影响 Step5 自身的正式时序。未配置时保持旧版按 step 元数据推导的等待。
  if (groupPosition !== 0 || groupCount < 2) return fallbackDelayMs;
  const configuredDelayMs = definition.returnGroupDelayMs?.[language];
  return Number.isFinite(configuredDelayMs) && configuredDelayMs >= 0
    ? Math.round(configuredDelayMs)
    : fallbackDelayMs;
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

      const returnGroups = getReturnGroups(session.definition);
      for (let groupPosition = 0; groupPosition < returnGroups.length; groupPosition += 1) {
        if (session.abortController.signal.aborted) return;
        const segments = returnGroups[groupPosition];
        const firstSegment = segments[0];
        const lastSegment = segments.at(-1);
        const content = segments.map((segment) => segment.content[session.language]);
        const durationDetails = getReturnGroupDurationDetails(segments, session.language, durationScale);
        logger.info('[讲解] Narration 回程开始', sessionDetails(session, {
          returnGroup: `${groupPosition + 1}/${returnGroups.length}`,
          segments: segments.map((segment) => segment.index),
          durationMs: durationDetails.speechDurationMs,
          scaledDurationMs: durationDetails.scaledSpeechDurationMs,
          ttsStartupBufferMs: durationDetails.ttsStartupBufferMs,
          postGapMs: durationDetails.postGapMs,
          minimumIocHoldMs: durationDetails.minimumIocHoldMs,
          effectiveHoldMs: durationDetails.effectiveHoldMs
        }));
        // 第一个回程由 startCommands 启动前端 Narration 专用 0/2/4/6 秒展示队列；
        // 组内 Step2-4 不再作为独立 MQTT/回程步骤执行。第二回程只执行 Step5 原有展示命令。
        const commands = groupPosition === 0 ? firstSegment.commands : lastSegment.commands;
        if (commands.length > 0) {
          logger.info('[讲解] 准备切换IOC展示步骤', sessionDetails(session, {
            returnGroup: `${groupPosition + 1}/${returnGroups.length}`,
            segments: segments.map((segment) => segment.index), commands
          }));
          const stepResult = await commandExecutor.publishFrontendCommands(commands, {
            source: `narration:${session.scenario}:segment-${lastSegment.index}`,
            requestId: session.requestId, sessionId: session.id
          });
          if (!stepResult.ok) {
            logger.error('[讲解] IOC展示步骤切换失败', sessionDetails(session, {
              stage: 'ioc-step', index: lastSegment.index, error: stepResult.error
            }));
            return;
          }
        }
        if (session.abortController.signal.aborted) return;
        const callbackResult = await callbackClient.sendAgentMessage(session.context, {
          body: content.map((item) => item.text).join(''), signal: session.abortController.signal, requestId: session.requestId,
          sessionId: session.id, scenario: session.scenario, segmentIndex: firstSegment.index,
          segmentCount: session.definition.segments.length
        });
        logger.info('[讲解] 播报段回程处理完成', sessionDetails(session, {
          returnGroup: `${groupPosition + 1}/${returnGroups.length}`,
          segments: segments.map((segment) => segment.index), ok: callbackResult.ok, status: callbackResult.status
        }));
        if (!callbackResult.ok && !session.abortController.signal.aborted) {
          logger.warn('[讲解] 回程失败但将继续既定流程', sessionDetails(session, {
            stage: 'callback', index: firstSegment.index,
            status: callbackResult.status, error: callbackResult.error
          }));
        }
        if (session.abortController.signal.aborted) return;
        if (durationDetails.minimumIocHoldMs > 0) {
          logger.info('[讲解] IOC最小保持时间计算', sessionDetails(session, {
            returnGroup: `${groupPosition + 1}/${returnGroups.length}`, ...durationDetails
          }));
        }
        const durationMs = getReturnGroupWaitMs(
          session.definition, groupPosition, returnGroups.length, session.language, durationDetails.effectiveHoldMs
        );
        logger.info('[讲解] 播报段等待开始', sessionDetails(session, {
          returnGroup: `${groupPosition + 1}/${returnGroups.length}`,
          segments: segments.map((segment) => segment.index),
          durationMs: durationDetails.speechDurationMs,
          scaledDurationMs: durationDetails.scaledSpeechDurationMs,
          ttsStartupBufferMs: durationDetails.ttsStartupBufferMs,
          postGapMs: durationDetails.postGapMs,
          minimumIocHoldMs: durationDetails.minimumIocHoldMs,
          effectiveHoldMs: durationDetails.effectiveHoldMs,
          returnGroupDelayMs: durationMs
        }));
        await wait(durationMs, session.abortController.signal);
        logger.info('[讲解] Narration 回程等待完成', sessionDetails(session, {
          returnGroup: `${groupPosition + 1}/${returnGroups.length}`,
          segments: segments.map((segment) => segment.index)
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

module.exports = {
  createNarrationSessionManager, sleep, getEffectiveSegmentDurationMs, getSegmentDurationDetails,
  getReturnGroups, getReturnGroupDurationDetails, getReturnGroupWaitMs
};
