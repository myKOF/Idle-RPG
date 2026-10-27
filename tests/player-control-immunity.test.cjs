'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEliteEnv, makeElite, stepElite } = require('./helpers/elite-env.cjs');

function setup(tower = false) {
  const c = loadEliteEnv();
  c.Math.random = () => 0.5;
  const st = { ...c.getStats(), hp: 1e12, mp: 1e9, atk: 100, matk: 100, aspd: 2,
    level: 1000, hpRegen: 0, mpRegen: 0, tenacity: 0, ctrlRes: 0, ccRed: 0,
    passives: {}, skillTriggers: {}, hit: 1e6, critRate: 0 };
  c.getStats = () => st;
  c.G.player.loadout = [];
  c.G.player.skills2 = { levels: {}, ult: {} };
  const p = c.newPlayerEntity(st);
  c.FIELD.player = p;
  const m = makeElite(c, ['e_quake'], { x: 30, y: 0, hp: 1e9 });
  m.affixes = [];
  m.atkCd = 1e9;
  c.FIELD._gmArena = true;
  c.FIELD.mapComplete = true;
  c.FIELD.spawnCd = Infinity;
  c.tickFieldEncounters = () => {};
  c.fieldMonsterAttack = () => false;
  c.G.tower.active = tower;
  c.TOWER.player = p;
  c.TOWER.boss = m;
  c.TOWER.floor = 1;
  c.TOWER.elapsed = 0;
  c.TOWER.dmgDealt = 0;
  c.TOWER.bossDmgDealt = 0;
  c.TOWER.specialCd = 1e9;
  c.TOWER.showingResult = false;
  c.TOWER.introCd = 0;
  c.towerTimeLimitWithTalents = () => 1e6;
  c.chance = pct => pct >= 100;
  const tick = (seconds) => {
    for (let i = 0; i < Math.round(seconds * 10); i++) {
      c.GT = Math.round((c.GT + 0.1) * 10) / 10;
      if (tower) c.towerTick(0.1); else c.fieldTick(0.1);
    }
  };
  return { c, p, m, st, tick };
}

function control(c, p) {
  for (const sid of ['stun', 'slow', 'sgFrozen', 'sgPetrify']) {
    assert.ok(c.applyStatus(p, sid, { dur: 30 }));
  }
  for (const key of ['aspdDown', 'attackSpeedDown']) c.applyBuff(p, key, 80, 30);
}

test('玩家保留控制狀態與顯示條目，但只有移動控制能生效；一般怪與BOSS原規則保留', () => {
  const { c, p, m } = setup();
  control(c, p);
  assert.equal(p.isPlayer, true);
  assert.equal(JSON.parse(JSON.stringify(p)).isPlayer, undefined, '身分不加入序列化快照');
  for (const sid of ['stun', 'slow', 'sgFrozen', 'sgPetrify']) {
    assert.equal(c.statusActive(p, sid), true, sid);
    assert.ok(c.statusEntries(p).some(e => e.sid === sid || e.id === sid), sid + ' 保留顯示條目');
  }
  assert.equal(c.ccActionLocked(p), false);
  assert.equal(c.playerActionControlBlocked(p, true), false);
  assert.equal(c.slowFactor(p), 1);
  assert.equal(c.ccLockOn(p, 'move'), true);
  c.applyStatus(m, 'stun', { dur: 2 });
  c.applyStatus(m, 'slow', { dur: 3 });
  assert.equal(c.ccActionLocked(m), true);
  assert.equal(c.slowFactor(m), 0.7);
  m.isBoss = true;
  c.cleanse(m);
  assert.equal(c.applyStatus(m, 'stun', { dur: 2 }), false);
  assert.equal(c.applyStatus(m, 'slow', { dur: 3 }), false);
});

for (const tower of [false, true]) {
  test((tower ? '高塔' : '野外') + '：多重控制狀態不改變實際普攻次數、時序與冷卻', () => {
    const run = (controlled) => {
      const { c, p, m, tick } = setup(tower);
      const times = [];
      const attack = c.doPlayerAttack;
      c.doPlayerAttack = (...args) => { times.push(c.GT); return attack(...args); };
      if (controlled) control(c, p);
      tick(3);
      assert.ok(m.hp > 0);
      if (controlled) assert.equal(c.effectActive(p, 'stun'), true);
      return { times, atkCd: p.atkCd, visualDurations: c.vfx.filter(v => v.cat === 'basic').map(v => v.dur) };
    };
    const normal = run(false), controlled = run(true);
    assert.ok(normal.times.length >= 5);
    assert.ok(normal.visualDurations.length > 0);
    assert.ok(normal.visualDurations.every(d => d === 0.5), '演出時長使用實際普攻週期');
    assert.deepEqual(controlled, normal);
  });

  test((tower ? '高塔' : '野外') + '：暈眩中仍由正式就緒佇列施法並結算傷害、MP與CD', () => {
    const { c, p, m, tick } = setup(tower);
    c.G.player.skills2.levels.fireball = [1, 0, 0, 0, 0, 0, 0];
    c.G.player.loadout = ['sg:fireball'];
    control(c, p);
    const casts = [];
    const cast = c.castSkill2;
    c.castSkill2 = (...args) => {
      const result = cast(...args);
      if (result) casts.push({ id: args[2], dmg: result.dmg });
      return result;
    };
    const before = p.mp;
    const hpBefore = m.hp;
    tick(3);
    assert.ok(casts.some(x => x.id === 'fireball'));
    assert.ok(m.hp < hpBefore, '實際命中扣血');
    assert.ok(p.mp < before);
    assert.ok(p.skillCds['sg:fireball'] > 0);
    assert.equal(c.effectActive(p, 'stun'), true);
    assert.ok(m.hp > 0);
  });
}

test('玩家slow只減移速，複合減益與移速增益照常；到期恢復且不影響攻速增益', () => {
  const { c, p, m, st } = setup();
  m.pos.x = 1000;
  c.applyStatus(p, 'slow', { dur: 3 });
  c.applyStatus(p, 'sgWindSlow', { dur: 4, val: 20 });
  c.applyBuff(p, 'aspdUp', 50, 5);
  c.skill2PlayerMoveFactor = () => 1.5;
  const start = c.bfPlayerPos().x;
  c.bfTickPlayer([m], 0.1, m, p);
  assert.ok(Math.abs(c.bfPlayerPos().x - start - c.bfPlayerSpeed() * 0.1 * 0.7 * 0.8 * 1.5) < 1e-9);
  assert.equal(c.playerBasicAttackRate(p, st), 1.5);
  c.GT += 4.1;
  assert.equal(c.bfPlayerSpeedFactor(p), 1.5);
  assert.equal(c.playerBasicAttackRate(p, st), 1.5);
});

for (const [gid, ult, method] of [
  ['chainlightning', 'skyThunderArray', 'sgTickInfiniteLightning'],
  ['frostnova', 'infiniteNova', 'sgTickInfiniteNova'],
  ['cleave', 'stormGodSlash', 'sgTickUltAutoCast'],
  ['vacuumslash', 'voidAnnihilation', 'sgTickVoidAnnihilation']
]) test(ult + '：玩家帶控制狀態時仍到期施放並扣MP，死亡仍暫停', () => {
  const { c, p, m } = setup();
  c.G.player.level = 1000;
  c.G.player.reinc = 10;
  c.G.tower.highest = 999;
  c.G.player.skills2.levels[gid] = Array(7).fill(10);
  c.G.player.skills2.ult[gid] = { pick: c.sgUltIndexOfId(gid, ult), lv: 1 };
  c.G.player.loadout = ['sg:' + gid];
  c.clearSkills2LevelsCache();
  assert.ok(c.sgUlt(gid, ult), '使用正式解鎖條件');
  control(c, p);
  const ctx = { pEnt: p, getEnemies: () => [m], floatSel: 'mv-float' };
  const calls = [];
  const name = gid === 'vacuumslash' ? 'sgSpawnVoidFlights' : 'castSkill2';
  const original = c[name];
  c[name] = (...args) => { calls.push(args); return original(...args); };
  c[method](ctx, 0.1);
  c.GT += 10;
  const mp = p.mp;
  c[method](ctx, 0.1);
  assert.ok(calls.length > 0, '確實進入原生技能執行');
  assert.ok(p.mp < mp);
  assert.equal(c.effectActive(p, 'stun'), true);
  const count = calls.length;
  p.hp = 0;
  c.GT += 10;
  c[method](ctx, 0.1);
  assert.equal(calls.length, count, '死亡不觸發新施放');
});

test('舊配置的持續重施也使用玩家控制特例', () => {
  const { c, p, m } = setup();
  c.G.player.level = 1000;
  c.G.player.reinc = 10;
  c.G.tower.highest = 999;
  c.G.player.skills2.levels.chainlightning = Array(7).fill(10);
  c.G.player.skills2.ult.chainlightning = { pick: c.sgUltIndexOfId('chainlightning', 'skyThunderArray'), lv: 1 };
  c.G.player.loadout = ['sg:chainlightning'];
  c.SKILLS2.chainlightning.ult.find(u => u.id === 'skyThunderArray').fx = { sec: 2, gap: 1 };
  c.clearSkills2LevelsCache();
  c.SKILL2_RT.ultRepeat.chainlightning = { until: c.GT + 3, nextAt: c.GT, gap: 1 };
  control(c, p);
  let casts = 0;
  const original = c.castSkill2;
  c.castSkill2 = (...args) => { casts++; return original(...args); };
  c.sgTickUltRepeat({ pEnt: p, getEnemies: () => [m], floatSel: 'mv-float' }, 0.1);
  assert.equal(casts, 1);
  assert.equal(c.effectActive(p, 'stun'), true);
});

test('真實敵人命中仍施加暈眩、slow及浮字，但不控制玩家出手', () => {
  const { c, p, m } = setup();
  const result = c.eliteHitPlayer(m, { mult: 1, sure: true, stun: 2, slow: 3, label: 'control test' });
  assert.ok(result && !result.miss && !result.invuln);
  assert.equal(c.effectActive(p, 'stun'), true);
  assert.equal(c.effectActive(p, 'slow'), true);
  assert.ok(c.floats.some(f => f.text === c.STR(533)));
  assert.equal(c.ccActionLocked(p), false);
  assert.equal(c.slowFactor(p), 1);
  assert.equal(c.bfPlayerSpeedFactor(p), 0.7);
});

test('拉扯、擊退與築牆仍控制位置或近戰可及性，不新增出手封鎖', () => {
  const { c, p, m } = setup();
  m.pos.x = 300;
  control(c, p);
  c.eliteCastPull(m, c.ELITE_AFFIXES.e_vortex);
  stepElite(c, 0.8);
  assert.equal(c.elitePlayerLocked(), true);
  const before = c.bfPlayerPos().x;
  assert.equal(c.bfTickPlayer([m], 0.1, m, p), false);
  c.elitePullTick(0.1);
  assert.ok(c.bfPlayerPos().x > before);
  assert.equal(c.playerActionControlBlocked(p), false);
  c.ELITE_RT.pull = null;
  c.bfPlayerPos().x = 50;
  c.elitePushPlayer(0, 0, 95);
  assert.equal(c.bfPlayerPos().x, 145);
  c.bfPlayerPos().x = 0;
  m.pos.x = 50;
  assert.equal(c.bfPlayerCanReach(m), true);
  c.ELITE_RT.walls.push({ x: 25, y: 0, a: Math.PI / 2, len: 90, thick: 16, until: c.GT + 7 });
  assert.equal(c.bfPlayerCanReach(m), false);
  assert.equal(c.playerActionControlBlocked(p), false);
});

test('控制免疫不繞過死亡／復甦與技能本身的施法時間', () => {
  const { c, p, m } = setup();
  control(c, p);
  p.hp = 0;
  assert.equal(c.skills2AutoCastBlocked(p), true);
  p.hp = 100;
  c.SKILL2_RT.earthguardRevival = { pEnt: p, endAt: c.GT + 5 };
  assert.equal(c.playerActionControlBlocked(p, true), true);
  assert.equal(c.skills2AutoCastBlocked(p), true);
  c.SKILL2_RT.earthguardRevival = null;
  c.G.player.skills2.levels.fireball = [1, 0, 0, 0, 0, 0, 0];
  c.G.player.loadout = ['sg:fireball'];
  assert.ok(c.pickAndCastSkill(p, [m], 'mv-float').casting);
  assert.equal(c.bfTickPlayer([], 0.1, null, p), false);
  assert.equal(c.skillCastInProgress(p), true);
});
