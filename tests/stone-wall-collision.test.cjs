'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEliteEnv, makeElite, makeMinion, stepElite } = require('./helpers/elite-env.cjs');

function setup(deg = 90) {
  const c = loadEliteEnv();
  c.FIELD.player.hp = c.FIELD.player.maxHp = 1e12;
  const w = { x: 100, y: 0, a: deg * Math.PI / 180, len: 180, thick: 39, until: c.GT + 7 };
  c.ELITE_RT.walls.push(w);
  return { c, w };
}
function npc(c, x = 180, y = 0) {
  const m = makeElite(c, ['e_vitality'], { x, y, hp: 1e9 });
  m._alerted = true; m.atkRange = 0; m.magic = false;
  m._el.repoAt = Infinity;
  Object.keys(m._el.cd).forEach(k => { m._el.cd[k] = 1e9; });
  return m;
}

test('12朝向掃掠碰撞：玩家與大小NPC均不能高速穿牆，可從端點外繞過，到期立即通行', () => {
  for (let deg = 0; deg < 180; deg += 15) {
    const { c, w } = setup(deg), co = Math.cos(w.a), si = Math.sin(w.a);
    for (const pad of [undefined, 6, 24]) {
      const p = { x: w.x - si * 150, y: w.y + co * 150 };
      const ox = w.x + si * 150, oy = w.y - co * 150;
      assert.equal(c.eliteClampMove(ox, oy, p, pad), true, deg + '度不能跳過牆');
      assert.deepEqual(p, { x: ox, y: oy });
      const q = { x: w.x + co * 150 - si * 150, y: w.y + si * 150 + co * 150 };
      assert.equal(c.eliteClampMove(w.x + co * 150 + si * 150, w.y + si * 150 - co * 150, q, pad), false, '可繞過端點');
    }
    c.GT = w.until;
    const p = { x: w.x - si * 150, y: w.y + co * 150 };
    assert.equal(c.eliteClampMove(w.x + si * 150, w.y - co * 150, p), false);
    assert.equal(c.eliteWallBlocks(w.x + si * 150, w.y - co * 150, p.x, p.y), false);
  }
});

test('實際玩家與NPC追擊會繞牆，空場直線前進被擋且動畫停止；到期恢復直線', () => {
  const { c, w } = setup();
  const m = npc(c);
  assert.equal(c.bfTickPlayer([m], .1, m, c.FIELD.player), true);
  assert.ok(c.bfPlayerPos().y !== 0, '朝牆端繞行');
  Object.assign(c.bfPlayerPos(), { x: 0, y: 0 });
  assert.equal(c.bfTickPlayer([], 10, null, c.FIELD.player), false);
  assert.equal(c.bfPlayerPos().x, 0);
  c.bfTickApproach([m], .1);
  assert.ok(m.pos.y !== 0, 'NPC朝牆端繞行');
  assert.equal(c.eliteWallHit(w, 180, 0, m.pos.x, m.pos.y, 0), false, '實際路徑未穿牆');
  c.GT = w.until;
  c.bfTickApproach([m], 10);
  assert.ok(m.pos.x < 100, '消失後照常接近玩家');
});

test('NPC實際跑位與未警覺遊走都受岩壁阻擋', () => {
  const { c } = setup();
  const m = npc(c);
  m._rp = { ang: Math.PI, dist: 180, t0: c.GT };
  c.bfTickApproach([m], .1);
  assert.ok(m.pos.y !== 0, '跑位也朝牆端繞行');
  m._rp = null;
  Object.assign(m.pos, { x: 180, y: 0 });
  m._roam = { x: 180, y: 0, tx: 0, ty: 0, wait: 0 };
  c.bfTickRoam(m, 100);
  assert.equal(m.pos.x, 180, '遊走不能穿牆');
});

test('NPC互斥推擠不能把另一隻推進牆裡', () => {
  const { c, w } = setup();
  const a = npc(c, 145), b = makeMinion(c, 1, { x: 155, y: 0 });
  a._elLockUntil = b._elLockUntil = c.GT + 10;
  c.bfTickApproach([a, b], .001);
  for (const m of [a, b]) assert.equal(c.eliteWallHit(w, m.pos.x, m.pos.y, m.pos.x, m.pos.y, c.bfEntityRadius(m) * .6), false);
  assert.equal(a.pos.x, 145, '牆前NPC不被同伴擠入牆');
  assert.ok(b.pos.x > 155, '另一隻仍正常被推開');
});

test('升牆將玩家、NPC及交角內角色推出所有牆外，之後能向外移動', () => {
  for (let deg = 0; deg < 180; deg += 15) {
    const { c, w } = setup(deg), m = npc(c, w.x, w.y);
    Object.assign(c.bfPlayerPos(), { x: w.x, y: w.y });
    c.ELITE_RT.walls.push({ x: w.x + Math.cos(w.a) * 90, y: w.y + Math.sin(w.a) * 90, a: w.a + Math.PI / 2, len: 180, thick: 39, until: w.until });
    m.pos.x = w.x + Math.cos(w.a) * 90; m.pos.y = w.y + Math.sin(w.a) * 90;
    c.eliteWallsPushOut();
    for (const [p, pad] of [[c.bfPlayerPos(), c.ELITE_PLAYER_BODY_R * .6], [m.pos, c.bfEntityRadius(m) * .6]]) {
      for (const wall of c.ELITE_RT.walls) assert.equal(c.eliteWallHit(wall, p.x, p.y, p.x, p.y, pad), false, deg + '度交角');
    }
    const p = c.bfPlayerPos(), ox = p.x, oy = p.y;
    p.x += -Math.sin(w.a) * 10; p.y += Math.cos(w.a) * 10;
    assert.equal(c.eliteClampMove(ox, oy, p), false, '可離開牆面');
  }
});

test('正式升牆流程也推出被牆壓到的NPC，事件尺寸與碰撞一致', () => {
  const c = loadEliteEnv(), caster = npc(c, 200), other = makeMinion(c, 1, { x: 0, y: 90 });
  const d = c.ELITE_AFFIXES.e_walls;
  c.eliteCastWalls(caster, d); stepElite(c, d.warn + .1);
  assert.ok(c.ELITE_RT.walls.length >= 2);
  for (const w of c.ELITE_RT.walls) {
    assert.deepEqual([w.len, w.thick], [180, 39]);
    assert.equal(c.eliteWallHit(w, other.pos.x, other.pos.y, other.pos.x, other.pos.y, c.bfEntityRadius(other) * .6), false);
    assert.deepEqual([w.vis.w, w.vis.h, w.vis.a], [w.len, w.thick, w.a]);
  }
});

test('NPC衝鋒每Tick及延遲終點不能穿牆；擊退、聚敵與玩家被推／拉也不穿牆', () => {
  const { c } = setup(), m = npc(c);
  m._elDash = { sx: 180, sy: 0, ex: 0, ey: 0, t: 0, dur: 1 };
  c.eliteDashStep(m, 1);
  assert.equal(m.pos.x, 180);
  assert.equal(m._elDash.ex, 180, '延遲終點已停在牆前');
  m._elDash = null;
  m._bfKnockback = { x: 180, y: 0, toX: 0, toY: 0, startAt: c.GT - 1, endAt: c.GT };
  c.bfTickKnockback(m);
  assert.equal(m.pos.x, 180); assert.equal(m._bfKnockback, undefined);
  assert.equal(c.bfPullEnemies([m], 500, 0).length, 0);
  assert.equal(c.bfPullEnemies([m], 500, 0, 500).length, 0);
  assert.equal(m.pos.x, 180);
  c.elitePushPlayer(-100, 0, 300);
  assert.equal(c.bfPlayerPos().x, 0);
  for (const dt of [.5, 2]) {
    c.ELITE_RT.pull = { owner: m, def: { v: {}, dmg: 1 }, tx: 200, ty: 0, speed: 1000 };
    c.elitePullTick(dt);
    assert.equal(c.bfPlayerPos().x, 0); assert.equal(c.ELITE_RT.pull, null);
  }
});

test('牆擋住漩渦位移時，技能傷害仍在原到達時間結算一次', () => {
  const { c } = setup(), m = npc(c), p = c.FIELD.player;
  let hits = 0;
  c.resolveHit = () => { hits++; return { dmg: 1, crit: false, miss: false, blocked: false, killed: false }; };
  c.ELITE_RT.pull = { owner: m, def: { v: {}, dmg: 1 }, tx: 200, ty: 0, speed: 100 };
  for (let i = 0; i < 3; i++) { c.elitePullTick(.5); assert.equal(hits, 0); }
  assert.ok(c.bfPlayerPos().x < 70, '仍留在牆前');
  c.elitePullTick(.5);
  assert.equal(hits, 1, '原本兩秒到達的技能照常命中');
  assert.equal(c.ELITE_RT.pull, null);
  c.elitePullTick(.5); assert.equal(hits, 1);
});

test('玩家與NPC會繞過單牆、平行牆與U型牆，全部12朝向均能接近並恢復近戰普攻', () => {
  for (const shape of ['single', 'parallel', 'U']) for (let deg = 0; deg < 180; deg += 15) for (const who of ['player', 'npc']) {
    const c = loadEliteEnv(), a = deg * Math.PI / 180;
    const rotate = (x, y) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
    c.ELITE_RT.walls = (shape === 'single' ? [{ x: 90, y: 0, a: Math.PI / 2 }] :
      [{ x: 0, y: 90, a: 0 }, { x: 0, y: -90, a: 0 }].concat(shape === 'U' ? [{ x: 90, y: 0, a: Math.PI / 2 }] : []))
      .map(w => ({ ...rotate(w.x, w.y), a: w.a + a, len: 180, thick: 39, until: c.GT + 60 }));
    const end = rotate(shape === 'parallel' ? 0 : 180, shape === 'parallel' ? 180 : 0), m = npc(c, end.x, end.y);
    const p = who === 'player' ? c.bfPlayerPos() : m.pos, pad = who === 'player' ? c.ELITE_PLAYER_BODY_R * .6 : c.bfEntityRadius(m) * .6;
    let reached = false;
    for (let i = 0; i < 300; i++) {
      c.GT += .1;
      const ox = p.x, oy = p.y;
      if (who === 'player') c.bfTickPlayer([m], .1, m, c.FIELD.player);
      else c.bfTickApproach([m], .1);
      for (const w of c.ELITE_RT.walls) assert.equal(c.eliteWallHit(w, ox, oy, p.x, p.y, pad), false, [shape, deg, who, i].join('/'));
      reached = who === 'player' ? c.bfPlayerCanReach(m) : c.bfInAttackRange(m);
      if (reached) break;
    }
    assert.ok(reached, [shape, deg, who, JSON.stringify(p)].join('/'));
  }
});

test('尋路共用快取與硬上限：最多6面牆／25節點、每Tick最多2次建立，直線清楚時不建路網', () => {
  const { c } = setup();
  const goal = { x: 180, y: 0 };
  for (let i = 0; i < 100; i++) c.eliteWallWaypoint({ x: 0, y: i % 5 }, goal, 12);
  const nav = c.ELITE_RT.wallNav;
  assert.equal(nav.meshes.length, 1, '100隻同體型NPC共用一份');
  assert.equal(nav.builds, 1);
  assert.equal(nav.routePlans, 16, '同Tick最多16個角色選路');
  c.GT += .1;
  for (const radius of [16, 20, 24, 28, 32]) c.eliteWallWaypoint({ x: 0, y: 0 }, goal, radius);
  assert.equal(nav.builds, 2, '同Tick冷啟硬上限');
  assert.equal(nav.meshes.length, 3);
  for (let i = 0; i < 5; i++) c.ELITE_RT.walls.push({ x: 100 + i * 300, y: 0, a: Math.PI / 2, len: 180, thick: 39, until: c.GT + 60 });
  c.GT += .1;
  c.eliteWallWaypoint({ x: 0, y: 0 }, goal, 12);
  assert.ok(c.ELITE_RT.wallNav.meshes[0].points.length <= 25);
  for (let i = 0; i < 32; i++) c.ELITE_RT.walls.push({ x: 3000 + i * 300, y: 0, a: Math.PI / 2, len: 180, thick: 39, until: c.GT + 60 });
  assert.equal(c.eliteWallWaypoint({ x: 0, y: 0 }, goal, 12), null, '異常超過6面活動牆只阻擋、不搜尋');
  assert.equal(c.ELITE_RT.wallNav.meshes.length, 0, '大量牆群不建路網');
  c.ELITE_RT.wallNav = null;
  assert.equal(c.eliteWallWaypoint({ x: 0, y: 300 }, { x: 50, y: 300 }, 12).x, 50);
  assert.equal(c.ELITE_RT.wallNav, null, '直線清楚不搜尋');
  c.eliteReset();
  assert.equal(c.ELITE_RT.wallNav, null, '換場清快取');
});

test('200隻NPC分批取得路徑，快取不週期性同時失效，也不讓後排角色飢餓', () => {
  const { c } = setup(), goal = { x: 180, y: 0 }, actors = Array.from({ length: 200 }, () => ({ x: 0, y: 0 }));
  for (let tick = 0; tick < 15; tick++) {
    c.GT += .1;
    for (const p of actors) c.eliteWallWaypoint(p, goal, 12);
    assert.ok(c.ELITE_RT.wallNav.routePlans <= 16);
  }
  assert.ok(actors.every(p => c.ELITE_RT.wallNav.routes.has(p)), '全部都能取得路徑');
  c.GT += 1;
  for (const p of actors) assert.ok(c.eliteWallWaypoint(p, goal, 12));
  assert.equal(c.ELITE_RT.wallNav.routePlans, 0, '牆／目標沒變就沿用成功路徑');
});

test('BOSS領域拉扯、衝近及普通衝鋒的延遲完成都不能穿牆', () => {
  for (const kind of ['near', 'dash', 'domain']) {
    const { c } = setup(), m = npc(c);
    if (kind === 'near') c.bskNear({ m }, 30, () => {});
    else if (kind === 'dash') {
      const d = Object.values(c.ELITE_AFFIXES).find(d => d.arch === 'dash');
      c.eliteCastDash(m, d);
    } else c.bskDomain({ m }, { dur: 1, r: 500, pull: 2000 });
    stepElite(c, 3);
    assert.ok(m.pos.x > 100, kind + ' NPC留在牆另一側');
    assert.equal(c.bfPlayerPos().x, 0, kind + ' 玩家不被拉穿牆');
  }
});

test('牆只阻擋雙方近戰普攻；遠程普攻、玩家飛行子彈／範圍技能與NPC範圍傷害照常', () => {
  const { c, w } = setup(), m = npc(c, 45);
  w.x = 25;
  assert.equal(c.bfPlayerCanReach(m), false);
  assert.equal(c.bfInAttackRange(m), false);
  let attacks = 0;
  c.doMonsterAttack = () => { attacks++; };
  c.fieldMonsterAttack(m, c.FIELD.player);
  assert.equal(attacks, 0, '近戰普攻不起手');
  m.atkRange = 300;
  c.fieldMonsterAttack(m, c.FIELD.player);
  assert.equal(attacks, 1, '遠程普攻照常');
  assert.ok(c.bfLineTargets(0, 300, [m], 30).includes(m));
  assert.ok(c.bfEnemiesInArea({ x: 0, y: 0, r: 300 }, [m]).includes(m));
  const p = c.FIELD.player, hit = [];
  p.mp = 1e9;
  c.G.player.level = 1000; c.G.player.reinc = 100;
  c.resolveHit = (attacker, defender) => { hit.push(defender); return { dmg: 100, crit: false, miss: false, blocked: false, killed: false }; };
  c.chance = () => false;
  c.G.player.skills2.levels.fireball = [1, 0, 0, 0, 0, 0, 0];
  const shot = c.castSkill2(p, [m], 'fireball', 'mv-float');
  assert.ok(shot, '隔牆火球可施放');
  assert.equal(hit.length, 0, '先飛行');
  c.GT += 1;
  c.tickSkill2(1, { pEnt: p, getEnemies: () => [m], floatSel: 'mv-float', onDeaths() {}, onDamage() {} });
  assert.ok(hit.includes(m), '飛行子彈穿牆命中');
  hit.length = 0;
  c.G.player.skills2.levels.firepillar = [1, 0, 0, 0, 0, 0, 0];
  assert.ok(c.castSkill2(p, [m], 'firepillar', 'mv-float'), '隔牆範圍技能可施放');
  c.GT += 1;
  c.tickSkill2(1, { pEnt: p, getEnemies: () => [m], floatSel: 'mv-float', onDeaths() {}, onDamage() {} });
  assert.ok(hit.includes(m), '玩家範圍技能穿牆命中');
  hit.length = 0;
  c.bskDomain({ m, d: { name: '隔牆領域' }, v: {}, hitCount: 0, bossMul: 1 }, { dur: 1, r: 300, pct: 10 });
  stepElite(c, 1);
  assert.ok(hit.includes(p), 'NPC範圍技能穿牆命中');
  assert.equal(c.ELITE_RT.errors, 0);
});

test('正式Worker模擬共用阻擋及繞牆，面板傳回真實位置且沒有尋路快取欄位', () => {
  const engine = require('../scripts/sim/engine').createEngine({ seed: 20261022 }).boot(null), c = engine.ctx;
  const zn = c.currentZoneDef(), m = c.makeFieldEnemy(c.NPC_CONFIG_TABLE.desert_2, c.monsterStatsFor(1, false, false), zn, 1, { enterCd: 0 });
  m.pos = { x: 180, y: 0 }; m._alerted = true; m.atkRange = 0; m.magic = false;
  c.FIELD.monsters = [m]; c.FIELD.monster = m; c.bfResetPlayer();
  c.ELITE_RT.walls.push({ x: 90, y: 0, a: Math.PI / 2, len: 180, thick: 39, until: c.GT + 60 });
  c.bfTickApproach([m], .1);
  assert.ok(m.pos.y !== 0, '正式Worker也繞向牆端');
  assert.equal(c.bfInAttackRange(m), false);
  const panel = c.buildPanel('battle');
  assert.deepEqual([panel.field.monsters[0].pos.x, panel.field.monsters[0].pos.y], [m.pos.x, m.pos.y]);
  assert.doesNotMatch(JSON.stringify(panel), /wallNav|wallGoal|meshes/);
  assert.equal(engine.outbox().filter(msg => msg.type === c.MSG_OUT.ERROR).length, 0);
});

test('每次隨機2～3面、最多兩次施放：預警先占名額，合計4／5／6面，消失才釋放', () => {
  for (const counts of [[2, 2], [2, 3], [3, 3]]) {
    const c = loadEliteEnv(), a = npc(c, 200), b = npc(c, -200), third = npc(c, 300), d = c.ELITE_AFFIXES.e_walls;
    assert.deepEqual(Array.from(d.n), [2, 3], '原配置保持隨機範圍');
    for (const [i, m] of [a, b].entries()) {
      c.Math.random = () => counts[i] === 2 ? 0 : .999999;
      assert.equal(c.eliteCastWalls(m, d), true);
    }
    assert.equal(c.ELITE_RT.walls.length, 0, '兩次都尚在預警');
    assert.equal(c.eliteCanCast(third, d), false, '預警期間即拒絕第三次');
    const vis = c.ELITE_RT.vis.length, jobs = c.ELITE_RT.jobs.length;
    assert.equal(c.eliteCastWalls(third, d), false, '直接呼叫也不能超限');
    assert.equal(c.ELITE_RT.vis.length, vis); assert.equal(c.ELITE_RT.jobs.length, jobs);
    stepElite(c, d.warn + .1);
    assert.equal(c.ELITE_RT.walls.length, counts[0] + counts[1]);
    const grouped = new Map();
    for (const w of c.ELITE_RT.walls) grouped.set(w.castId, (grouped.get(w.castId) || 0) + 1);
    assert.deepEqual([...grouped.values()], counts, '各次施放保留自己的隨機面數');
    assert.equal(c.eliteCanCast(third, d), false, '已升起的兩次仍占滿');
    stepElite(c, d.life + .2);
    assert.equal(c.ELITE_RT.walls.length, 0); assert.equal(c.eliteWallCastCount(), 0);
    assert.equal(c.eliteCanCast(third, d), true);
    assert.equal(c.eliteCastWalls(third, d), true, '消失後可再次施放');
    c.eliteReset();
    assert.equal(c.ELITE_RT.wallCasts.length, 0); assert.equal(c.ELITE_RT.jobs.length, 0);
  }
});
