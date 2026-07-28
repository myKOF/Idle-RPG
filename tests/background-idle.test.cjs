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

/* 遊戲規則（使用者定案）：分頁在背景＝仍在線上掛機，只有整個遊戲被關掉才算離線。
   所以隱藏分頁必須持續即時模擬，離線結算只在開機時發生。

   技術上唯一要處理的是瀏覽器對背景分頁計時器的降頻：計時器晚回來時 elapsed 會很大，
   舊碼直接截成 10 秒，等於把降頻期間的時間送掉。改為記成欠帳，分次補完。 */
function loadWorkerContext(initialNow = 100000, perfStepMs = 0) {
  const clock = { now: initialNow, perf: 0 };
  const context = {
    console,
    location: { search: '' },
    performance: { now: () => (clock.perf += perfStepMs) },
    importScripts() {},
    self: { postMessage() {} },
    setInterval() { return 1; },
    clearInterval() {},
    Date: { now: () => clock.now },
    // protocol.js 與模擬層在此harness 不載入（importScripts 為空實作），補上被引用到的常數
    PERSIST_KINDS: { SHUTDOWN: 'shutdown', AUTO: 'auto', FOLDER: 'folder' }
  };
  vm.createContext(context);
  vm.runInContext(workerSrc, context, { filename: 'js/worker/sim.worker.js' });
  /* loop() 有 try/catch，錯誤會被 reportError 吃掉變成「測試通過但什麼都沒跑」。
     這裡改成往外丟，讓測試看得到真正的失敗。 */
  context.reportError = (where, err) => { throw err; };
  // 每次 emit 會呼叫的模擬層鉤子；本 harness 不載入模擬層，一律空實作
  context.updateShownRes = () => {};
  context.maintainGemShop = () => {};
  context.checkForgeUnlockNotice = () => {};
  context.emitTick = () => {};
  context.requestPersist = () => {};
  return { context, clock };
}

function driveLoop(context, clock, { advanceMs, times = 1 }) {
  const steps = [];
  context.simStep = (dt) => steps.push(dt);
  for (let i = 0; i < times; i++) {
    clock.now += advanceMs;
    context.loop();
  }
  return steps.reduce((a, b) => a + b, 0);
}

test('隱藏分頁仍持續模擬——背景就是在線掛機', () => {
  const { context, clock } = loadWorkerContext();
  context._booted = true;
  context._lastTickAt = clock.now;
  context.requestPersist = () => {};

  context.onVisibility({ hidden: true, at: clock.now });
  const stepped = driveLoop(context, clock, { advanceMs: 1000, times: 5 });

  assert.ok(Math.abs(stepped - 5) < 1e-6, `隱藏期間應照常推進 5 秒，實際 ${stepped}`);
  assert.doesNotMatch(workerSrc, /backgroundSuspended|BG_SUSPEND_AFTER_MS/,
    '背景休眠機制應已完全移除');
});

test('背景降頻造成的長 elapsed 不得被截斷，一律記成欠帳', () => {
  const { context, clock } = loadWorkerContext();
  context._booted = true;
  context._lastTickAt = clock.now;
  context.requestPersist = () => {};

  // 模擬計時器被降頻到 60 秒才回來一次
  const stepped = driveLoop(context, clock, { advanceMs: 60000, times: 1 });

  assert.ok(Math.abs(stepped + context._catchupDebt - 60) < 1e-6,
    `已模擬 ${stepped} 秒 + 欠帳 ${context._catchupDebt} 秒必須等於經過的 60 秒，不得憑空消失`);
});

test('CPU 預算用完時把剩餘欠帳留到下一次 loop，不在單次呼叫裡跑完', () => {
  // 每次讀時鐘前進 1ms：預算 30ms → 單次 loop 約補 30 步（3 秒遊戲時間）
  const { context, clock } = loadWorkerContext(100000, 1);
  context._booted = true;
  context._lastTickAt = clock.now;
  context.requestPersist = () => {};

  const first = driveLoop(context, clock, { advanceMs: 60000, times: 1 });
  assert.ok(first < 60, `單次 loop 不應把 60 秒一次跑完（實際 ${first} 秒）`);
  assert.ok(context._catchupDebt > 0, '剩餘時間應留在欠帳裡');

  const before = context._catchupDebt;
  driveLoop(context, clock, { advanceMs: 100, times: 1 });
  assert.ok(context._catchupDebt < before, '後續 loop 應繼續消化欠帳');
});

test('欠帳上限與離線收益一致，背景掛機不比關掉遊戲更優待', () => {
  const { context, clock } = loadWorkerContext();
  context._booted = true;
  context._lastTickAt = clock.now;
  context.requestPersist = () => {};
  context.simStep = () => {};

  clock.now += 72 * 3600 * 1000; // 分頁被凍結三天
  context.loop();

  assert.equal(context.MAX_CATCHUP_DEBT_SEC, 24 * 3600);
  assert.ok(context._catchupDebt <= 24 * 3600,
    `欠帳不得超過 24 小時，實際 ${context._catchupDebt}`);
});

test('分頁隱藏只落地存檔，不再結算離線收益', () => {
  const { context, clock } = loadWorkerContext(10000);
  const actions = [];
  context.PERSIST_KINDS = { SHUTDOWN: 'shutdown', AUTO: 'auto' };
  context.requestPersist = (kind) => actions.push(['persist', kind]);
  context.applyOfflineProgress = () => { actions.push(['offline']); return { seconds: 61 }; };
  context._lastTickAt = clock.now;

  context.onVisibility({ hidden: true, at: clock.now });
  assert.deepEqual(actions, [['persist', 'shutdown']]);

  const lastTickBefore = context._lastTickAt;
  clock.now += 61000;
  context.onVisibility({ hidden: false, at: clock.now });

  assert.deepEqual(actions, [['persist', 'shutdown']], '回前景不得再跑一次離線結算');
  assert.equal(context._lastTickAt, lastTickBefore,
    '切回前景不得重設 _lastTickAt——那段正是玩家掛機的時間，重設等於丟掉');
});

test('離線結算只發生在開機（遊戲真的被關掉）', () => {
  assert.match(workerSrc, /function boot\(msg\)[\s\S]*?applyOfflineProgress\(\)/,
    'boot 仍應結算離線收益');
  const visibilityFn = workerSrc.slice(workerSrc.indexOf('function onVisibility'));
  const body = visibilityFn.slice(0, visibilityFn.indexOf('\n}'));
  assert.doesNotMatch(body, /applyOfflineProgress/,
    'onVisibility 不得再結算離線收益');
});

test('PiP 狀態不再隨 visibility 轉發（休眠機制移除後已無接收端）', () => {
  const payloads = bridgeSrc.match(/post\(MSG_IN\.VISIBILITY,[^)]+\)/g) || [];
  assert.ok(payloads.length > 0, 'bridge 仍應轉發分頁顯示狀態');
  assert.ok(payloads.every((p) => !/pip/i.test(p)), 'visibility 不應再帶 pip');
  assert.doesNotMatch(bridgeSrc, /miniMonitorActive/, 'bridge 不應再讀 ui.js 的 MINI');
});

test('背景分頁跳過純視覺與輪詢工作', () => {
  // 模擬照跑，但畫面沒人看——渲染與輪詢仍應省下來
  // 刻意不釘死參數列：這裡要驗的是「進函式就先檢查渲染是否暫停」，
  // 把簽章寫進斷言只會讓無關的 UI 改動誤擋（floatText 就多過一個 battleSnapshot 參數）
  assert.match(uiSrc, /function floatText\([^)]*\) \{\s*if \(uiRenderingSuspended\(\)\) return;/);
  assert.match(uiSrc, /function renderStatsPanel\([^)]*\) \{\s*if \(uiRenderingSuspended\(\)\) return;/);
  assert.match(mainSrc, /function checkForUpdates\(\) \{\s*if \(typeof document !== 'undefined' && document\.hidden\) return;/);
  assert.match(autoreloadSrc, /function poll\(\) \{\s*if \(document\.hidden\) return;/);
  assert.match(uiSrc, /WorkerBridge\.on\('workerDead', handleWorkerDead\)/);
  assert.match(uiSrc, /WorkerBridge\.on\('workerRecovered', hideWorkerDeadNotice\)/);
  assert.match(uiSrc, /id = 'worker-dead-notice'[\s\S]*location\.reload\(\)/);
  assert.doesNotMatch(uiSrc, /UI_WORKER_HEARTBEAT_TIMEOUT_MS|function checkWorkerHealth\(/);
});
