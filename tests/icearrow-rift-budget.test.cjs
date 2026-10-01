'use strict';
/* ============================================================
   icearrow-rift-budget.test.cjs — 寒冰箭超神【無限冰裂】的三個症狀

   2026-10-01 使用者回報：①常發不出冰箭（有施放動作、敵人照死）②畫面外常有冰箭飛來卻不朝敵人
   ③放幾次之後 FPS 掉到 15。根因與量測見 docs/AI_TASKS.md 同日條目，這裡釘住修法：

     B  追擊冰箭的搜敵圈（文檔：「在 30 米內來回穿梭追擊」）以我方為圓心，而不是箭自己；
        圈內沒有活敵就收掉場域（原本直線飛出畫面、空轉 6 秒）。風刃共用同一支 chase 步，行為不變。
     C  追擊場域同時存活數量有硬上限；低於上限時行為與沒有上限完全相同。
     A  （傳輸層，另見 worker-shim.test.cjs／ui-containment-and-visual-flush.test.cjs）
        佇列滿了先丟持續刷新，一次性事件（發射、命中）優先保留。

   最後一組用遊戲自己的無畫面引擎（scripts/sim/engine.js）跑真的戰鬥，並照 sim.worker.js loop()
   每個模擬步清一次緊急視覺佇列，驗證「每次施放的發射事件都送得出去、場域數不超過上限」。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const M = 10;   // 1 米 = 10 個系統距離單位（bfMeterPx）；skill2-ice 的 const M 不會掛到 vm 上下文

/* 取 skill2-ice.test.cjs 檔頭的測試輔助（loadContext／enemy／stubHits／run…），與
   icearrow-vfx-integration.test.cjs 同一個作法，不另外複製一份。 */
function simulation() {
  const file = path.join(__dirname, 'skill2-ice.test.cjs');
  const src = fs.readFileSync(file, 'utf8');
  const h = { require: createRequire(file), __dirname, console };
  vm.createContext(h);
  vm.runInContext(src.slice(0, src.indexOf('test(')) + '\nthis.c=loadContext();', h);
  return h;
}

/* 一個只開了寒冰箭第 7 階的場景：我方在原點，沒有任何敵人。 */
function scene() {
  const h = simulation(), c = h.c;
  h.setLevels(c, 'icearrow', [1, 1, 1, 1, 1, 1, 1]);
  h.equip(c, 'icearrow');
  const p = h.playerEnt();
  p.pos = { x: 0, y: 0 };
  c.FIELD.player = p;
  const specs = h.stubVfx(c);
  h.stubHits(c);
  return { h, c, p, specs, fx: c.SKILLS2.icearrow.tiers[6].fx, M: M };
}

function spawnArrow(s, from, angle) {
  s.c.sgSpawnIcearrowHoming(s.p, s.c.getStats(), s.fx, null, 100, null, 'mv-float',
    { from, moveAngle: angle || 0 });
  const grounds = s.c.SKILL2_RT.grounds;
  return grounds[grounds.length - 1];
}
const arrows = (s) => s.c.SKILL2_RT.grounds.filter((f) => f.kind === 'icearrow');

/* ---------------- B：搜敵圈以我方為圓心 ---------------- */

test('RIFT-CHASE-1 追蹤冰箭的落點從「我方 30 米內」挑，而不是「箭自己 30 米內」', () => {
  const s = scene();
  // 箭已經順著貫穿方向飛到我方右側 29 米外；敵人在我方左側 25 米＝離箭 54 米
  const f = spawnArrow(s, { x: 29 * s.M, y: 0 }, 0);
  const prey = s.h.enemy(1e9, -25 * s.M, 0, 'prey');
  assert.equal(f.chaseAnchor, 'player');
  const dest = s.c.sgGroundChaseDest(f, [prey]);
  assert.ok(dest, '我方 30 米內的敵人要成為候選（原本離箭超過 30 米就被排除，箭永遠飛不回來）');
  assert.deepEqual({ x: dest.x, y: dest.y }, { x: prey.pos.x, y: prey.pos.y });
});

test('RIFT-CHASE-2 搜敵圈的邊界把敵人體型半徑算進去，與施放射程同一個語意', () => {
  const s = scene();
  const f = spawnArrow(s, { x: 0, y: 100 }, 0);
  const body = s.c.bfEntityRadius(s.h.enemy(1, 0, 0));
  const inside = s.h.enemy(1e9, 30 * s.M + body - 1, 0, 'inside');
  const outside = s.h.enemy(1e9, 30 * s.M + body + 1, 0, 'outside');
  assert.ok(s.c.sgChaseHasPrey(f, [inside]), '邊緣剛好咬到身體的敵人算在圈內');
  assert.ok(!s.c.sgChaseHasPrey(f, [outside]), '完全在圈外的不算');
});

test('RIFT-CHASE-3 風刃共用的追擊步不受影響：搜敵圈仍以場域自己為圓心', () => {
  const s = scene();
  s.c.sgSpawnGround(s.p, s.c.getStats(), 'windblade', {
    kind: 'windblade', from: { x: 29 * s.M, y: 0 }, moveAngle: 0, radius: 15, dmgVal: 1, hits: 60,
    gap: 0.1, speed: 585, chaseM: 30, contact: true
  });
  const f = s.c.SKILL2_RT.grounds[s.c.SKILL2_RT.grounds.length - 1];
  assert.equal(f.chaseAnchor, '');
  const prey = s.h.enemy(1e9, -25 * s.M, 0, 'prey');          // 離我方 25 米、離風刃 54 米
  assert.equal(s.c.sgGroundChaseDest(f, [prey]), null, '風刃的候選仍是自己 30 米內');
  assert.ok(s.c.sgChaseHasPrey(f, [prey]) === false);
});

/* ---------------- B：沒有東西可追就收掉 ---------------- */

test('RIFT-RETIRE-1 搜敵圈內沒有活敵：追擊場域在第一拍就收掉，不再送事件', () => {
  const s = scene();
  spawnArrow(s, { x: 300, y: 0 }, 0);
  assert.equal(arrows(s).length, 1);
  s.specs.length = 0;
  s.h.run(s.c, s.p, [], 0.3);
  assert.equal(arrows(s).length, 0, '沒有敵人＝沒有東西可追');
  assert.equal(s.specs.filter((e) => e.variant === 'ice-arrow-homing').length, 0, '收掉之後不再送逐拍事件');
});

test('RIFT-RETIRE-2 敵人全在 30 米圈外也一樣收掉；圈內有活敵就繼續飛', () => {
  const far = scene();
  spawnArrow(far, { x: 300, y: 0 }, 0);
  far.h.run(far.c, far.p, [far.h.enemy(1e9, 60 * far.M, 0, 'far')], 0.3);
  assert.equal(arrows(far).length, 0, '60 米外的敵人不在搜敵圈內');

  const near = scene();
  spawnArrow(near, { x: 300, y: 0 }, 0);
  near.h.run(near.c, near.p, [near.h.enemy(1e9, -20 * near.M, 0, 'near')], 1.0);
  assert.equal(arrows(near).length, 1, '圈內有活敵：箭繼續追');
});

test('RIFT-RETIRE-3 敵人被殺光的那一拍收掉：已經在飛的箭不會再空轉到壽命結束', () => {
  const s = scene();
  const prey = s.h.enemy(1e9, -20 * s.M, 0, 'prey');
  spawnArrow(s, { x: 300, y: 0 }, 0);
  s.h.run(s.c, s.p, [prey], 0.5);
  assert.equal(arrows(s).length, 1);
  prey.hp = 0;
  s.specs.length = 0;
  s.h.run(s.c, s.p, [prey], 0.2);
  assert.equal(arrows(s).length, 0);
  assert.equal(s.specs.filter((e) => e.variant === 'ice-arrow-homing').length, 0);
});

/* ---------------- C：數量上限 ---------------- */

test('RIFT-CAP-1 預設上限是 72（兩次滿支數施放），到頂後不再生成追擊場域', () => {
  const s = scene();
  assert.equal(s.c.SG_ICEARROW_HOMING_MAX_FIELDS, 72);
  for (let i = 0; i < 100; i++) spawnArrow(s, { x: 300, y: 0 }, 0);
  assert.equal(arrows(s).length, 72);
});

test('RIFT-CAP-2 低於上限時行為與沒有上限完全相同；別種場域不占名額', () => {
  const s = scene();
  for (let i = 0; i < 50; i++) spawnArrow(s, { x: 300, y: 0 }, 0);
  assert.equal(arrows(s).length, 50, '50 支都生成');
  // 80 個箭雨場域（kind icerain）就算讓全部場域數超過 72，也不算追擊箭的名額
  const t = scene();
  for (let i = 0; i < 80; i++) {
    t.c.sgSpawnGround(t.p, t.c.getStats(), 'icearrow', { kind: 'icerain', from: { x: 0, y: 0 }, radius: 10, dmgVal: 1, hits: 5, gap: 0.5 });
  }
  for (let i = 0; i < 10; i++) spawnArrow(t, { x: 300, y: 0 }, 0);
  assert.equal(arrows(t).length, 10);
});

test('RIFT-CAP-3 上限可以調：到頂的是這個變數，不是寫死在迴圈裡', () => {
  const s = scene();
  vm.runInContext('SG_ICEARROW_HOMING_MAX_FIELDS = 5', s.c);
  for (let i = 0; i < 20; i++) spawnArrow(s, { x: 300, y: 0 }, 0);
  assert.equal(arrows(s).length, 5);
});

/* ---------------- 整體：真的戰鬥＋Worker 每步清緊急佇列 ---------------- */

/* 12 隻打不死的敵人（用 applyEnemyHpDamage 把血量還原）＝無限冰裂最壞的情境：命中不斷回扣冷卻。
   Lv.800 才解鎖寒冰箭第 7 階與超神；sgult 第 2 個是【無限冰裂】。 */
function riftBattle(seconds) {
  const { createEngine } = require(path.join(root, 'scripts/sim/engine'));
  const eng = createEngine({ seed: 20261001 }).boot(null);
  const gm = (l) => eng.cmd('gm.exec', { line: l });
  ['level 800', 'sglv icearrow max', 'sgult icearrow 2', 'god 1', 'MP_lock'].forEach(gm);
  eng.state().player.loadout = ['sg:icearrow'];
  gm('spawn 12 small 1000000');
  const ctx = eng.ctx;
  const read = (e) => vm.runInContext(e, ctx);
  const origDamage = ctx.applyEnemyHpDamage;
  ctx.applyEnemyHpDamage = function (t) { const hp = t.hp; const r = origDamage.apply(this, arguments); t.hp = hp; return r; };

  let pushedPierce = 0, deliveredPierce = 0, casts = 0, peakFields = 0, pushedHoming = 0;
  const origPush = ctx.shimPushEvent;
  ctx.shimPushEvent = function (kind, data) {
    if (kind === 'vfx' && data && data.variant === 'ice-arrow-pierce') pushedPierce++;
    if (kind === 'vfx' && data && data.variant === 'ice-arrow-homing') pushedHoming++;
    return origPush.apply(this, arguments);
  };
  const origCast = ctx.sgCastIcearrow;
  ctx.sgCastIcearrow = function () { casts++; return origCast.apply(this, arguments); };
  // 複刻 sim.worker.js loop()：每個模擬步之後立刻清一次緊急視覺佇列（engine.step 自己是每兩步才清）
  const origStep = ctx.simStep;
  ctx.simStep = function (dt) {
    const r = origStep.call(this, dt);
    for (const e of ctx.shimDrainUrgentVisualEvents()) {
      if (e.kind === 'vfx' && e.variant === 'ice-arrow-pierce') deliveredPierce++;
    }
    peakFields = Math.max(peakFields, read("SKILL2_RT.grounds.filter(function(f){return f.kind==='icearrow';}).length"));
    return r;
  };
  eng.step(Math.round(seconds / eng.dt));
  return { casts, pushedPierce, deliveredPierce, pushedHoming, peakFields };
}

const battle = riftBattle(10);

test('RIFT-BATTLE-1 打不死的敵人下，追擊場域數永遠不超過上限（修正前 12 秒內漲到 1116）', () => {
  assert.ok(battle.casts >= 3, '情境要真的連續施放，實際 ' + battle.casts);
  assert.ok(battle.peakFields <= 72, '同時存活最多 ' + battle.peakFields);
  assert.ok(battle.peakFields >= 60, '上限有真的咬到（不是情境太輕）：' + battle.peakFields);
});

test('RIFT-BATTLE-2 每一次施放的貫穿箭發射事件都送得出 Worker（修正前 4 秒後整批被 80 件上限擠掉）', () => {
  assert.ok(battle.pushedPierce >= 36 * 3);
  assert.equal(battle.deliveredPierce, battle.pushedPierce, '發射事件全數送達');
});
