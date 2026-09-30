'use strict';
/* ============================================================
   skill2-thunderorb-critical-generation.test.cjs — 臨界雷劫的世代規則

   使用者給 Codex 的規格（2026-09-30）：
     環體電球所觸發的靜止雷球持續 10 秒且緩慢向外移動；靜止雷球每次命中有機率再形成 1 個
     靜止雷球（不會移動）；**電球不可再生電球**；同一顆球 0.75 秒內只能再生 1 個。

   實作原本沒有守住「電球不可再生電球」：衍生球帶著和首代同一份命中回呼，可以無限世代繁殖。
   無畫面實測（32 隻打不死的敵人）：7 遊戲秒內累計 96 顆，只有 19 顆是首代，最深傳到第 9 代；
   雷球數大約每秒翻一倍，Worker 要 7.5 秒才推進 1 遊戲秒，所有 UI 指令排在它後面。

   這裡用遊戲自己的無畫面引擎跑真的戰鬥，逐顆標世代：
     第 1 代＝環體電球命中處生成的；第 2 代＝首代命中時再形成的；不該有第 3 代。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const { createEngine } = require(path.join(root, 'scripts/sim/engine'));

function run(seconds, opts) {
  opts = opts || {};
  const eng = createEngine({ seed: 20260930 }).boot(null);
  const gm = (l) => eng.cmd('gm.exec', { line: l });
  ['level 800', 'sglv thunderorb max', 'sgult thunderorb 1', 'god 1', 'MP_lock'].forEach(gm);
  eng.state().player.loadout = ['sg:thunderorb'];
  gm('spawn ' + (opts.enemies || 32) + ' small 1000000');
  const ctx = eng.ctx;
  const read = (e) => vm.runInContext(e, ctx);
  if (opts.cap !== undefined) vm.runInContext('SG_THUNDERORB_MAX_FIELDS = ' + opts.cap, ctx);

  // 標世代：正在跑 sgGroundTick 的場域＝父代；在它的回呼裡生成的＝父代 +1，沒有父代＝環體電球命中處的首代。
  let parent = null;
  const born = [];                                   // 每顆臨界雷球出生時的快照
  const origTick = ctx.sgGroundTick;
  ctx.sgGroundTick = function (f) { const prev = parent; parent = f; try { return origTick.apply(this, arguments); } finally { parent = prev; } };
  const origGround = ctx.sgSpawnGround;
  ctx.sgSpawnGround = function (pEnt, st, gid, cfg) {
    const r = origGround.apply(this, arguments);
    if (gid === 'thunderorb' && cfg.vfxTier === 6) {
      const f = ctx.SKILL2_RT.grounds[ctx.SKILL2_RT.grounds.length - 1];
      f.__gen = parent && parent.__gen ? parent.__gen + 1 : 1;
      born.push(f);
    }
    return r;
  };
  const peaks = [];
  for (let s = 1; s <= seconds; s++) {
    eng.step(Math.round(1 / eng.dt));
    peaks.push(read("SKILL2_RT.grounds.filter(function(f){return f.gid==='thunderorb'&&f.kind==='orb'&&f.vfxTier===6;}).length"));
  }
  const byGen = {};
  born.forEach((f) => { byGen[f.__gen] = (byGen[f.__gen] || 0) + 1; });
  return { born, byGen, peaks, read, ult: read("sgUlt('thunderorb','criticalThunderbolt')"), ultSec: read("sgUltVal(sgUlt('thunderorb','criticalThunderbolt'),'sec')") };
}

const main = run(12);

test('GEN-1 只有兩代：首代（環體電球命中處）與首代命中時再形成的一代；不該有第 3 代', () => {
  const gens = Object.keys(main.byGen).map(Number);
  assert.ok((main.byGen[1] || 0) > 0, '要有首代');
  assert.ok((main.byGen[2] || 0) > 0, '首代命中要能再形成 1 個（機制沒被關掉），實際 ' + JSON.stringify(main.byGen));
  assert.equal(Math.max(...gens), 2, '最深只能到第 2 代，實際 ' + JSON.stringify(main.byGen));
});

test('GEN-2 衍生球（第 2 代）沒有再生回呼、原地不動、壽命等於超神秒數、傷害與首代一致', () => {
  const firsts = main.born.filter((f) => f.__gen === 1);
  const children = main.born.filter((f) => f.__gen === 2);
  assert.ok(children.length > 0);
  children.forEach((f) => {
    assert.ok(!f.onHit, '衍生球不可掛再生回呼（電球不可再生電球）');
    assert.equal(f.speed, 0, '衍生球不移動');
    assert.equal(f.dest, null);
    assert.ok(Math.abs(f.expiresAt - f.bornAt - main.ultSec) < 1e-9, '壽命＝超神的持續秒數');
  });
  firsts.forEach((f) => {
    assert.equal(typeof f.onHit, 'function', '首代掛著再生回呼');
    assert.ok(f.speed > 0, '首代緩慢向外移動');
    assert.ok(Math.abs(f.expiresAt - f.bornAt - main.ultSec) < 1e-9);
  });
  assert.equal(children[0].dmgVal, firsts[0].dmgVal, '衍生球傷害與首代相同');
});

test('GEN-3 世代規則本身就讓數量有界：完全不設數量上限，32 隻打不死的敵人下仍低於 96', () => {
  const noCap = run(30, { cap: 1e9 });
  const peak = Math.max(...noCap.peaks);
  assert.ok(peak < 96, '沒有上限時 30 秒內最多 ' + peak + ' 顆');
  assert.ok(Math.max(...Object.keys(noCap.byGen).map(Number)) <= 2);
});

test('GEN-4 敵人少的時候同樣只有兩代（規則不依賴敵人數）', () => {
  const few = run(12, { enemies: 3 });
  assert.ok(Math.max(...Object.keys(few.byGen).map(Number)) <= 2, JSON.stringify(few.byGen));
});

test('GEN-5 實作接線：衍生球以 derived 旗標建立，且只有非衍生的臨界球才掛再生回呼', () => {
  const src = fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8');
  const start = src.indexOf('function sgSpawnStationaryThunderOrb(');
  const body = src.slice(start, src.indexOf('function sgThunderorbBurstHook(', start));
  assert.match(body, /function sgSpawnStationaryThunderOrb\(pEnt, st, floatSel, cfg, pos, lifeSec, outward, derived\)/);
  assert.match(body, /onHit: \(critical && !derived\) \? function/);
  assert.match(body, /sgSpawnStationaryThunderOrb\(f\.pEnt, f\.st, f\.floatSel, cfg, spawnPos, critical\.lifeSec, false, true\);/);
});
