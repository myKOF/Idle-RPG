'use strict';
/* ============================================================
   worker-catchup-silent.test.cjs — 補進度（快轉）期間的視覺靜默（2026-10-13）

   使用者回報：遊戲放背景約 20 分鐘再切回來，大量特效在瞬間快速播放、FPS 掉到十幾、約 10 秒後恢復。
   原因：Worker 回前景後補累積的欠帳，每一步照常產生特效／動作／傷害數字事件，擠在同一瞬間播出，
   而那些事件早已過期。使用者定案：過去沒播的特效就不要播，切回來的前幾秒開始播即可。
   做法：欠帳 >4 秒且單步便宜（真的在快轉）就不產生 vfx／act／float 事件，補到 ≤2 秒才恢復；
   模擬與傷害完全照常。單步很貴時（模擬本身比現實慢）不靜默。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { createEngine } = require(path.join(path.resolve(__dirname, '..'), 'scripts/sim/engine'));

function setup() {
  const eng = createEngine({ seed: 20261013 }).boot(null);
  const gm = (l) => eng.cmd('gm.exec', { line: l });
  ['level 700', 'MP_lock', 'maxstats', 'sglv chainlightning max', 'sgult chainlightning 1', 'god 1'].forEach(gm);
  eng.state().player.loadout = ['sg:chainlightning'];
  gm('spawn 12 small 1000000');
  const run = (e) => vm.runInContext(e, eng.ctx);
  return { eng, run };
}
/* 數一段時間內 shim 實際收下的視覺事件（事件被取走才算，靜默時根本不會進佇列）。 */
function countVisual(run, eng, fn) {
  const before = run('shimSilentDropped()');
  let n = 0;
  const orig = eng.ctx.shimDrainEvents, origU = eng.ctx.shimDrainUrgentVisualEvents;
  const tally = (ev) => { for (const e of ev) if (e && (e.kind === 'vfx' || e.kind === 'act' || e.kind === 'float')) n++; return ev; };
  eng.ctx.shimDrainEvents = function () { return tally(orig.apply(this, arguments)); };
  eng.ctx.shimDrainUrgentVisualEvents = function () { return tally(origU.apply(this, arguments)); };
  fn();
  eng.ctx.shimDrainEvents = orig; eng.ctx.shimDrainUrgentVisualEvents = origU;
  return { visual: n, dropped: run('shimSilentDropped()') - before };
}
const hp = (run) => run('FIELD.monsters.map(function(m){return m.hp}).join(",")');

test('CU-1 欠帳 60 秒的快轉：視覺事件只剩最後約 2 秒的量，其餘被略過', () => {
  const a = setup();
  a.run('_catchupDebt = 60; _lastTickAt = Date.now()');
  const fast = countVisual(a.run, a.eng, () => a.eng.ctx.loop());
  assert.ok(fast.dropped > 100, '應有大量事件被略過，dropped=' + fast.dropped);
  // 對照：同樣情境正常跑 2 秒會產生多少視覺事件
  const b = setup();
  const normal = countVisual(b.run, b.eng, () => b.eng.step(Math.round(1 / b.eng.dt) * 2));
  assert.ok(normal.visual > 20, '對照組要有事件才有意義，visual=' + normal.visual);
  assert.ok(fast.visual < normal.visual * 3, '快轉 60 秒的視覺事件 ' + fast.visual + ' 應與正常 2 秒（' + normal.visual + '）同量級');
  assert.equal(a.run('_catchupSilent'), false, '補完後要恢復');
});

test('CU-2 傷害照算：開啟靜默與完全關閉靜默，同樣快轉 60 秒後敵人血量逐位元一致', () => {
  const a = setup(), b = setup();
  a.run('_catchupDebt = 60; _lastTickAt = Date.now()');
  b.run('_catchupDebt = 60; _lastTickAt = Date.now(); CATCHUP_SILENT_ENTER_SEC = 1e9');
  a.eng.ctx.loop();
  b.eng.ctx.loop();
  assert.ok(a.run('shimSilentDropped()') > 100 && b.run('shimSilentDropped()') === 0, '兩組的靜默狀態要不同才算對照');
  assert.equal(hp(a.run), hp(b.run));
});

test('CU-3 欠帳小（≤4 秒）時不靜默：行為與沒有這個功能相同', () => {
  const a = setup();
  a.run('_catchupDebt = 3; _lastTickAt = Date.now()');
  const r = countVisual(a.run, a.eng, () => a.eng.ctx.loop());
  assert.equal(r.dropped, 0);
});

test('CU-4 單步很貴（模擬本身比現實慢）時不靜默：慢動作比黑畫面好', () => {
  const a = setup();
  a.run('_catchupDebt = 60; _lastTickAt = Date.now(); _stepMsEma = 80; CATCHUP_EXPENSIVE_STEP_MS = 25');
  // 讓 EMA 維持高值：把 simStep 前後的計時換成固定步長 80ms 的假時鐘
  a.run('var __t = 0; _phNow = function () { __t += 40; return __t; };');
  const r = countVisual(a.run, a.eng, () => a.eng.ctx.loop());
  assert.equal(r.dropped, 0, '貴步不得靜默，dropped=' + r.dropped);
});

test('CU-5 靜默只影響 vfx／act／float，日誌等其他事件照送', () => {
  const a = setup();
  a.eng.ctx.shimDrainEvents(); a.eng.ctx.shimDrainUrgentVisualEvents();
  a.run('shimSetCatchupSilent(true)');
  a.eng.ctx.shimPushEvent('log', { text: 'x' });
  a.eng.ctx.shimPushEvent('vfx', { fxKind: 'impact' });
  a.eng.ctx.shimPushEvent('float', { cls: 'a' });
  a.eng.ctx.shimPushEvent('act', {});
  const out = a.eng.ctx.shimDrainEvents();
  assert.equal(JSON.stringify(out.map((e) => e.kind)), '["log"]');
  a.run('shimSetCatchupSilent(false)');
});
