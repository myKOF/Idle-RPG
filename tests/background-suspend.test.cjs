const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const mainSrc = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
const uiSrc = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const autoreloadSrc = fs.readFileSync(path.join(root, 'js/param_autoreload.js'), 'utf8');

test('背景分頁逾時後 gameTick 直接休眠、不進行模擬', () => {
  assert.match(mainSrc, /var BG_SUSPEND_AFTER_MS = 60000;/);
  assert.match(mainSrc, /function backgroundSimSuspended\(\)/);
  assert.match(mainSrc, /function gameTick\(\) \{\s*if \(backgroundSimSuspended\(\)\) \{ _lastTickAt = Date\.now\(\); return; \}/);
});

test('backgroundSimSuspended 依隱藏時長與迷你視窗判定', () => {
  const snippet = mainSrc.match(/var BG_SUSPEND_AFTER_MS[\s\S]*?function backgroundSimSuspended\(\) \{[\s\S]*?\n\}/);
  assert.ok(snippet, '找不到背景休眠判定程式段');
  const ctx = { document: { hidden: false }, Date };
  vm.createContext(ctx);
  vm.runInContext(snippet[0], ctx);
  // 前景：不休眠
  assert.equal(vm.runInContext('backgroundSimSuspended()', ctx), false);
  // 剛隱藏（60 秒內）：維持即時模擬
  ctx.document.hidden = true;
  vm.runInContext('_hiddenAt = Date.now();', ctx);
  assert.equal(vm.runInContext('backgroundSimSuspended()', ctx), false);
  // 隱藏逾 60 秒：休眠
  vm.runInContext('_hiddenAt = Date.now() - 61000;', ctx);
  assert.equal(vm.runInContext('backgroundSimSuspended()', ctx), true);
  // 迷你監控視窗（PiP）開啟：不休眠
  vm.runInContext('MINI = { win: {}, timer: null };', ctx);
  assert.equal(vm.runInContext('backgroundSimSuspended()', ctx), false);
});

test('回到前景時以離線收益結算並鎖定 savedAt 基準', () => {
  const listener = mainSrc.match(/document\.addEventListener\('visibilitychange', function \(\) \{[\s\S]*?\n\}\);/);
  assert.ok(listener, '找不到 main.js 的 visibilitychange 監聽');
  // 隱藏當下記錄基準並存檔
  assert.match(listener[0], /_hiddenAt = Date\.now\(\);\s*saveGame\(\);/);
  // 回頁時：依隱藏時長判定（事件觸發時 document.hidden 已是 false，不可用 backgroundSimSuspended），
  // 再結算 + 存檔，並重設 _lastTickAt 防止額外補進
  assert.match(listener[0], /var settle = _hiddenAt > 0 && \(Date\.now\(\) - _hiddenAt\) >= BG_SUSPEND_AFTER_MS;/);
  assert.match(listener[0], /_lastTickAt = Date\.now\(\);/);
  assert.match(listener[0], /if \(settle\) \{\s*applyOfflineProgress\(\);[\s\S]*?saveGame\(\);/);
  // 讀檔結算後也立即鎖定基準
  assert.match(mainSrc, /applyOfflineProgress\(\);\s*saveGame\(\); \/\/ 結算後立即鎖定 savedAt 基準/);
});

test('背景分頁跳過純視覺與輪詢工作', () => {
  assert.match(uiSrc, /function floatText\(elId, text, cls, damageValue, ent\) \{\s*if \(uiRenderingSuspended\(\)\) return;/);
  assert.match(uiSrc, /function renderStatsPanel\(\) \{\s*if \(uiRenderingSuspended\(\)\) return;/);
  assert.match(mainSrc, /function checkForUpdates\(\) \{\s*if \(typeof document !== 'undefined' && document\.hidden\) return;/);
  assert.match(autoreloadSrc, /function poll\(\) \{\s*if \(document\.hidden\) return;/);
  assert.match(uiSrc, /function checkWorkerHealth\(\)[\s\S]*document\.hidden[\s\S]*UI_WORKER_HEARTBEAT_TIMEOUT_MS/);
  assert.match(uiSrc, /WorkerBridge\.on\(MSG_OUT\.ERROR,[\s\S]*handleWorkerDead\(msg\)/);
  assert.match(uiSrc, /id = 'worker-dead-notice'[\s\S]*location\.reload\(\)/);
});
