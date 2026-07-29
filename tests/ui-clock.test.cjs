/* 主執行緒的遊戲時鐘。
   GT 的權威在 Worker，但畫面上每一個「還剩幾秒」都要跟它比對：
   狀態圖示（effects／dots／buffs 存的是絕對到期時刻）、技能冷卻、復活倒數。
   在這之前主執行緒的 GT 從開機到關機都是 0，於是 until > GT 恆為真——
   狀態圖示一旦出現就再也不會消失；冷卻則卡在面板拍照當下的值。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

// 只取時鐘那幾支純函式來跑，不必把整個 ui.js 拉起來
function loadClock(nowRef, viewRef) {
  // 這幾支在 ui.js 裡是連續的一段，整段取出來跑
  const from = ui.indexOf('function uiNowMs()');
  const lastAt = ui.indexOf('function uiCountdownRemain(value, snapshotGt)');
  assert.ok(from >= 0 && lastAt > from, '找不到時鐘那一段');
  const to = ui.indexOf('\n}', lastAt) + 2;
  const src = ui.slice(from, to);

  const context = {
    GT: 0,
    UI_WORKER_STATE: { view: viewRef },
    performance: { now: () => nowRef.t },
    Math, Number, isFinite,
    _uiGtBase: 0, _uiGtBaseAt: 0
  };
  vm.createContext(context);
  vm.runInContext('var _uiGtBase = 0, _uiGtBaseAt = 0;\n' + src, context);
  return context;
}

test('對時之後，遊戲時間會隨真實時間平順前進（不是每次 tick 才跳一格）', () => {
  const now = { t: 1000 };
  const view = { gt: 500, paused: false };
  const c = loadClock(now, view);

  c.uiSyncGameTime(view);
  assert.equal(c.uiGameTime(), 500);

  now.t = 1100;                       // 過了 0.1 秒，但還沒有新的 tick
  assert.ok(Math.abs(c.uiGameTime() - 500.1) < 1e-9, '兩次 tick 之間要用真實時間補間');
  now.t = 1350;
  assert.ok(Math.abs(c.uiGameTime() - 500.35) < 1e-9);

  // 新的 tick 抵達就重新對時，補間誤差不會累積
  view.gt = 500.4;
  now.t = 1400;
  c.uiSyncGameTime(view);
  assert.equal(c.uiGameTime(), 500.4);
});

test('暫停時遊戲時間不前進（Worker 那側的 GT 也不動）', () => {
  const now = { t: 1000 };
  const view = { gt: 200, paused: true };
  const c = loadClock(now, view);
  c.uiSyncGameTime(view);
  now.t = 5000;
  assert.equal(c.uiGameTime(), 200, '暫停中不該自己往前跑');
});

test('uiApplyGameTime 會把全域 GT 對到現在——狀態圖示才會過期', () => {
  const now = { t: 0 };
  const view = { gt: 42, paused: false };
  const c = loadClock(now, view);
  assert.equal(c.GT, 0);
  c.uiSyncGameTime(view);
  c.uiApplyGameTime();
  assert.equal(c.GT, 42);
});

test('倒數扣掉快照拍照到現在的時間', () => {
  const now = { t: 1000 };
  const view = { gt: 100, paused: false };
  const c = loadClock(now, view);
  c.uiSyncGameTime(view);

  // 快照在 gt=100 拍的，冷卻剩 4 秒
  assert.equal(c.uiCountdownRemain(4, 100), 4);
  now.t = 2500;                                   // 過了 1.5 秒
  assert.ok(Math.abs(c.uiCountdownRemain(4, 100) - 2.5) < 1e-9, '4 秒冷卻過了 1.5 秒應剩 2.5 秒');
  now.t = 6000;                                   // 過了 5 秒
  assert.equal(c.uiCountdownRemain(4, 100), 0, '不會變成負數');

  // 沒有快照時間就照原值顯示（相容尚未帶 gt 的來源）
  assert.equal(c.uiCountdownRemain(4, undefined), 4);
  assert.equal(c.uiCountdownRemain(0, 100), 0);
});

test('battle／tower 面板都帶上快照時間 gt', () => {
  const worker = fs.readFileSync(path.join(root, 'js/worker/sim.worker.js'), 'utf8');
  assert.match(worker, /case 'battle':[\s\S]*?return \{[\s\S]*?gt: GT,/);
  assert.match(worker, /case 'tower':[\s\S]*?return \{ gt: GT,/);
});

test('tick 與 full 兩條路徑都會對時，且每輪重繪前套用', () => {
  assert.match(ui, /MSG_OUT\.TICK, function \(msg\) \{[\s\S]*?uiSyncGameTime\(msg\.view\);/);
  assert.match(ui, /function applyUiSnapshot\(snapshot\)[\s\S]*?uiSyncGameTime\(snapshot\.view\);/);
  assert.match(ui, /function uiTick\(\) \{[\s\S]*?uiApplyGameTime\(\);/);
});
