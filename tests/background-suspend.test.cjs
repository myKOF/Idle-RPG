const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const mainSrc = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
const bridgeSrc = fs.readFileSync(path.join(root, 'js/bridge.js'), 'utf8');
const workerSrc = fs.readFileSync(path.join(root, 'js/worker/sim.worker.js'), 'utf8');
const uiSrc = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const autoreloadSrc = fs.readFileSync(path.join(root, 'js/param_autoreload.js'), 'utf8');

function loadWorkerContext(initialNow = 100000) {
  const clock = { now: initialNow };
  const context = {
    console,
    location: { search: '' },
    performance: { now: () => 0 },
    importScripts() {},
    self: { postMessage() {} },
    setInterval() { return 1; },
    clearInterval() {},
    Date: { now: () => clock.now }
  };
  vm.createContext(context);
  vm.runInContext(workerSrc, context, { filename: 'js/worker/sim.worker.js' });
  return { context, clock };
}

test('背景分頁逾時後 Worker loop 直接休眠、不進行模擬', () => {
  const { context, clock } = loadWorkerContext();
  const steps = [];
  context.simStep = (dt) => steps.push(dt);
  context._booted = true;
  context._hiddenAt = clock.now - 61000;
  context._lastTickAt = clock.now - 100;

  context.loop();

  assert.deepEqual(steps, []);
  assert.equal(context._lastTickAt, clock.now);

  context._hiddenAt = clock.now - 59000;
  context._lastTickAt = clock.now - 100;
  context.loop();
  assert.ok(steps.length > 0, '隱藏未滿 60 秒仍應推進模擬');
});

test('Worker backgroundSuspended 依隱藏時長與迷你視窗判定', () => {
  const { context, clock } = loadWorkerContext();
  // 前景：不休眠
  assert.equal(context.backgroundSuspended(), false);
  // 剛隱藏（60 秒內）：維持即時模擬
  context._hiddenAt = clock.now;
  assert.equal(context.backgroundSuspended(), false);
  // 隱藏逾 60 秒：休眠
  context._hiddenAt = clock.now - 61000;
  assert.equal(context.backgroundSuspended(), true);

  // PiP 是主執行緒狀態，必須由 bridge 隨 visibility 傳入，且 Worker 判定時豁免休眠。
  const visibilityPayloads = bridgeSrc.match(/post\(MSG_IN\.VISIBILITY,[^)]+\)/g) || [];
  assert.ok(visibilityPayloads.some((payload) => /pip|mini/i.test(payload)),
    'P5 缺口：bridge 尚未把迷你監控視窗（PiP）狀態傳給 Worker');
  assert.match(context.backgroundSuspended.toString(), /pip|mini/i,
    'P5 缺口：Worker backgroundSuspended 尚未豁免迷你監控視窗（PiP）');
});

test('回到前景時以離線收益結算並鎖定 savedAt 基準', () => {
  const { context, clock } = loadWorkerContext(10000);
  const actions = [];
  context.PERSIST_KINDS = { SHUTDOWN: 'shutdown', AUTO: 'auto' };
  context.requestPersist = (kind) => actions.push(['persist', kind]);
  context.applyOfflineProgress = () => {
    actions.push(['offline', clock.now]);
    return { seconds: 61, gold: 123 };
  };
  context.shimPushEvent = (kind, payload) => actions.push(['event', kind, payload]);

  context.onVisibility({ hidden: true, at: clock.now });
  assert.equal(context._hiddenAt, 10000);
  assert.deepEqual(actions, [['persist', 'shutdown']]);

  clock.now += 61000;
  context.onVisibility({ hidden: false, at: clock.now });

  assert.equal(context._hiddenAt, 0);
  assert.equal(context._lastTickAt, clock.now, '回前景須重設 tick 基準，避免再補一次隱藏時間');
  assert.deepEqual(JSON.parse(JSON.stringify(actions)), [
    ['persist', 'shutdown'],
    ['offline', 71000],
    ['event', 'notice', { key: 'offlineSummary', data: { seconds: 61, gold: 123 } }],
    ['persist', 'auto']
  ]);
});

test('背景分頁跳過純視覺與輪詢工作', () => {
  assert.match(uiSrc, /function floatText\(elId, text, cls, damageValue, ent, battleSnapshot\) \{\s*if \(uiRenderingSuspended\(\)\) return;/);
  assert.match(uiSrc, /function renderStatsPanel\(\) \{\s*if \(uiRenderingSuspended\(\)\) return;/);
  assert.match(mainSrc, /function checkForUpdates\(\) \{\s*if \(typeof document !== 'undefined' && document\.hidden\) return;/);
  assert.match(autoreloadSrc, /function poll\(\) \{\s*if \(document\.hidden\) return;/);
  assert.match(uiSrc, /WorkerBridge\.on\('workerDead', handleWorkerDead\)/);
  assert.match(uiSrc, /WorkerBridge\.on\('workerRecovered', hideWorkerDeadNotice\)/);
  assert.match(uiSrc, /id = 'worker-dead-notice'[\s\S]*location\.reload\(\)/);
  assert.doesNotMatch(uiSrc, /UI_WORKER_HEARTBEAT_TIMEOUT_MS|function checkWorkerHealth\(/);
});
