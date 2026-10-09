const test = require('node:test');
const assert = require('node:assert/strict');
const { createNarrationSessionManager } = require('../src/narration/narration-session-manager');

function logger() { return { info() {}, warn() {}, error() {} }; }

function context(suffix) {
  return {
    agent: `agent-${suffix}`, replyTo: `user-${suffix}@example.com`, groupchat: false,
    callback: 'http://127.0.0.1:29876/agent/send'
  };
}

function commandExecutor() {
  const calls = [];
  return {
    calls,
    publishFrontendCommands: async (commands, meta) => {
      calls.push({ commands, meta });
      return { ok: true, status: 200 };
    }
  };
}

function callbackClient() {
  const calls = [];
  return {
    calls,
    sendAgentMessage: async (sessionContext, options) => {
      calls.push({ sessionContext, options });
      return { ok: true, status: 200 };
    }
  };
}

function manualWait() {
  const calls = [];
  return {
    calls,
    wait: (ms, signal) => new Promise((resolve, reject) => {
      const item = { ms, resolve, reject };
      calls.push(item);
      if (signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    })
  };
}

async function eventually(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('condition was not reached');
}

// 与生产 Narration 定义同构的最小定义：prepare -> start -> callback -> wait -> complete/cancel。
function definition(scenario, durationMs) {
  return {
    scenario,
    action: `启动${scenario}`,
    introDelayMs: 0,
    prepareCommands: [{ action: 'executeCapability', params: { capability: `test.${scenario}`, command: 'start' } }],
    startCommands: [{ action: 'executeCapability', params: { capability: `test.${scenario}`, command: 'start' } }],
    completeCommands: [{ action: 'executeCapability', params: { capability: `test.${scenario}`, command: 'cancel' } }],
    cancelCommands: [{ action: 'executeCapability', params: { capability: `test.${scenario}`, command: 'cancel' } }],
    segments: [{
      index: 1,
      commands: [],
      content: { 'zh-CN': { text: `${scenario} 文案`, durationMs } },
      ttsStartupBufferMs: 0,
      postGapMs: 0,
      minimumIocHoldMs: 0
    }]
  };
}

function waitForMs(clock, ms) {
  const item = clock.calls.find((call) => call.ms === ms);
  assert.ok(item, `expected a pending wait of ${ms}ms`);
  return item;
}

test('exhibition sessions run concurrently without cancelling each other', async () => {
  const executor = commandExecutor();
  const clock = manualWait();
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: callbackClient(), logger: logger(), wait: clock.wait
  });

  const first = manager.startNarration({
    exhibitionId: 'hall-a', definition: definition('scene-a', 1000), context: context('A'), language: 'zh-CN'
  });
  const second = manager.startNarration({
    exhibitionId: 'hall-b', definition: definition('scene-b', 2000), context: context('B'), language: 'zh-CN'
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  await eventually(() => clock.calls.length === 2);
  assert.equal(executor.calls.some((call) => call.meta.source.endsWith(':cancel')), false);
  assert.equal(manager.getActiveSession('hall-a').id, first.session.id);
  assert.equal(manager.getActiveSession('hall-b').id, second.session.id);

  // A 正常结束，不影响 B。
  waitForMs(clock, 1000).resolve();
  await first.session.runPromise;
  assert.equal(first.session.state, 'completed');
  assert.equal(manager.getActiveSession('hall-a'), null);
  assert.equal(manager.getActiveSession('hall-b').id, second.session.id);
  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:scene-b:cancel'), false);
  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:scene-b:complete'), false);

  // B 正常结束。
  waitForMs(clock, 2000).resolve();
  await second.session.runPromise;
  assert.equal(second.session.state, 'completed');
  assert.equal(manager.getActiveSession('hall-b'), null);

  for (const call of executor.calls) {
    const expectedHall = call.meta.sessionId === first.session.id ? 'hall-a' : 'hall-b';
    assert.equal(call.meta.exhibitionId, expectedHall);
    assert.equal(call.meta.sessionId === first.session.id || call.meta.sessionId === second.session.id, true);
  }
});

test('same-exhibition narration keeps preemption while another exhibition stays untouched', async () => {
  const executor = commandExecutor();
  const clock = manualWait();
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: callbackClient(), logger: logger(), wait: clock.wait
  });

  const a1 = manager.startNarration({
    exhibitionId: 'hall-a', definition: definition('scene-a1', 1000), context: context('A1'), language: 'zh-CN'
  });
  const b = manager.startNarration({
    exhibitionId: 'hall-b', definition: definition('scene-b', 2000), context: context('B'), language: 'zh-CN'
  });
  await eventually(() => clock.calls.length === 2);

  const a2 = manager.startNarration({
    exhibitionId: 'hall-a', definition: definition('scene-a2', 1500), context: context('A2'), language: 'zh-CN'
  });
  await eventually(() => executor.calls.some((call) => call.meta.source === 'narration:scene-a1:cancel'));

  assert.equal(a1.session.state, 'completed');
  assert.equal(manager.getActiveSession('hall-a').id, a2.session.id);
  // B 未受同展厅抢占影响。
  assert.equal(manager.getActiveSession('hall-b').id, b.session.id);
  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:scene-b:cancel'), false);

  const a1Cancel = executor.calls.find((call) => call.meta.source === 'narration:scene-a1:cancel');
  assert.equal(a1Cancel.meta.exhibitionId, 'hall-a');
  assert.equal(a1Cancel.meta.sessionId, a1.session.id);

  await eventually(() => clock.calls.some((call) => call.ms === 1500));
  waitForMs(clock, 1500).resolve();
  await a2.session.runPromise;
  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:scene-a2:complete'), true);

  waitForMs(clock, 2000).resolve();
  await b.session.runPromise;
  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:scene-b:complete'), true);
  assert.equal(executor.calls.some((call) => call.meta.source === 'narration:scene-b:cancel'), false);
});

test('cancelActiveNarration cancels and cleans up every exhibition', async () => {
  const executor = commandExecutor();
  const clock = manualWait();
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: callbackClient(), logger: logger(), wait: clock.wait
  });

  const a = manager.startNarration({
    exhibitionId: 'hall-a', definition: definition('scene-a', 1000), context: context('A'), language: 'zh-CN'
  });
  const b = manager.startNarration({
    exhibitionId: 'hall-b', definition: definition('scene-b', 2000), context: context('B'), language: 'zh-CN'
  });
  await eventually(() => clock.calls.length === 2);

  await manager.cancelActiveNarration('shutdown');

  assert.equal(a.session.state, 'completed');
  assert.equal(b.session.state, 'completed');
  assert.equal(a.session.cancelReason, 'shutdown');
  assert.equal(b.session.cancelReason, 'shutdown');
  assert.equal(manager.getActiveSession('hall-a'), null);
  assert.equal(manager.getActiveSession('hall-b'), null);

  const cancelCalls = executor.calls.filter((call) => call.meta.source.endsWith(':cancel'));
  assert.equal(cancelCalls.length, 2);
  assert.deepEqual(
    cancelCalls.map((call) => [call.meta.exhibitionId, call.meta.sessionId]).sort(),
    [['hall-a', a.session.id], ['hall-b', b.session.id]].sort()
  );
});

test('missing or blank exhibitionId is rejected before any publish or session state', async () => {
  const executor = commandExecutor();
  const manager = createNarrationSessionManager({
    commandExecutor: executor, callbackClient: callbackClient(), logger: logger(), wait: async () => {}
  });

  for (const exhibitionId of [undefined, null, '', '   ', 42]) {
    const result = manager.startNarration({
      exhibitionId, definition: definition('scene-x', 1000), context: context('X'), language: 'zh-CN'
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'narration exhibitionId is required');
  }
  assert.equal(executor.calls.length, 0);
  assert.equal(manager.getActiveSession('scene-x'), null);
});
