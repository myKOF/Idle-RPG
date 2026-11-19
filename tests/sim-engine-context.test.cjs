/* 模擬引擎的 vm context 建法（scripts/sim/engine.js 的 DONT_CONTEXTIFY 說明）。

   引擎改用 DONT_CONTEXTIFY 建 context 之後，遊戲讀全域變數不再經過攔截器，
   headless 模擬快了約 10 倍。這支測試守的是「只有變快，沒有變別的」：
   同一個 seed、同一段時間，新舊兩種 context 的最終存檔雜湊必須逐位相同。
   哪天有人在替身（Math／Date／importScripts…）上動了手腳而兩邊沒對齊，這裡會紅燈。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const { createEngine } = require(path.join(ROOT, 'scripts/sim/engine.js'));
const { stateHash } = require(path.join(ROOT, 'scripts/sim/hash.js'));

const HAS_DONT_CONTEXTIFY = !!(vm.constants && vm.constants.DONT_CONTEXTIFY);

test('新舊兩種 context 跑同一個 seed，最終存檔雜湊相同', { skip: !HAS_DONT_CONTEXTIFY && '這版 Node 沒有 DONT_CONTEXTIFY，兩邊本來就是同一種' }, () => {
  const run = (contextify) => {
    const e = createEngine({ seed: 20261120, contextify });
    e.boot(null);
    /* 幾道玩家操作也一起比：指令走的是 runCommand，替身若有差異常在這裡現形 */
    e.stepSeconds(120);
    e.cmd('stage.setAutoAdvance', { on: true });
    e.stepSeconds(600);
    return stateHash(e.saveJson());
  };
  assert.equal(run(false), run(true));
});

test('新 context 仍然隔離：遊戲讀不到 Node 的 require／process，宿主替身照常生效', () => {
  const e = createEngine({ seed: 1 });
  e.boot(null);
  assert.equal(vm.runInContext('typeof require', e.ctx), 'undefined');
  assert.equal(vm.runInContext('typeof process', e.ctx), 'undefined');
  /* 虛擬時鐘與種子化亂數：Date.now 由引擎推進、Math.random 由 seed 決定 */
  const t0 = vm.runInContext('Date.now()', e.ctx);
  e.stepSeconds(10);
  assert.equal(vm.runInContext('Date.now()', e.ctx) - t0, 10000);
  const r1 = vm.runInContext('Math.random()', createEngine({ seed: 7 }).ctx);
  const r2 = vm.runInContext('Math.random()', createEngine({ seed: 7 }).ctx);
  assert.equal(r1, r2, '同一個 seed 的第一個亂數必須相同');
});
