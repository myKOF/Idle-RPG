'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine');

function setup(ultPick = 2) {
  const c = createEngine({ seed: 1019 }).boot(null).ctx;
  c.G.player.level = 650; c.G.tower.highest = 74;
  c.G.player.skills2 = { levels: { counter: Array(7).fill(10) }, ult: {} };
  if (ultPick !== null) c.G.player.skills2.ult.counter = { pick: ultPick, lv: 10 };
  c.G.player.loadout = ['sg:counter']; c.clearSkills2LevelsCache(); c.markStatsDirty();
  const p = c.FIELD.player; p.hp = c.getStats().hp; p.mp = 1e9;
  const home = c.bfPlayerPos();
  const e = { name: '反擊測試怪', hp: 1e12, maxHp: 1e12, level: 1, atk: 100,
    def: 0, mdef: 0, hit: 100, dodge: 0, resist: {}, ctrlRes: 0,
    effects: {}, buffs: {}, dots: [], pos: { x: home.x + 20, y: home.y } };
  c.combatFieldEnemies = () => [e];
  c.chance = pct => pct > 0;
  return { c, p, e };
}

function fixedLife(c, p) {
  const st = Object.assign({}, c.getStats(), { hp: 10000 });
  c.getStats = () => st; p.hp = st.hp;
  c.Math.random = () => .5;
  c.sgWarGodBodyState(p);
  return st;
}
function incoming(c, p, e, atk, extra = {}) {
  return c.resolveHit(e, p, { atk, hit: 1e9, critRate: 0, level: 1 },
    Object.assign({ isPlayer: true, maxHp: 10000, def: 0, mdef: 0 }, extra));
}

test('戰神體原生結算：生命 10% 加護盾 50% 為 60%，自傷另計、回復不抵銷、等級成長', () => {
  for (const lv of [1, 10]) {
    const { c, p, e } = setup(); fixedLife(c, p);
    c.G.player.skills2.ult.counter.lv = lv;
    p.shield = 5000; p.shieldMax = 5000;
    const hit = incoming(c, p, e, 2500);
    assert.equal(hit.absorbed, 2500); assert.equal(hit.hpDamage, 0);
    c.applyEnemyHpDamage(p, 1000);
    assert.equal(c.sgCounterRT().warBody.collected, 60);
    p.hp += 1000; c.grantShield(p, 2500, c.getStats());
    assert.equal(c.sgCounterRT().warBody.collected, 60, '治療及補盾都不倒扣');
    c.GT = 2.999; assert.equal(c.sgWarGodBodyPct(), 0);
    c.GT = 3;
    assert.ok(Math.abs(c.sgWarGodBodyPct() - (lv === 1 ? 72.6 : 132)) < 1e-8);
    c.GT = 5.999;
    assert.ok(Math.abs(c.sgWarGodBodyPct() - (lv === 1 ? 72.6 : 132)) < 1e-8);
    c.GT = 6;
    assert.ok(Math.abs(c.sgWarGodBodyPct() - (lv === 1 ? 6.6 : 12)) < 1e-8, '下一段替換加成');
  }
});

test('戰神體原生結算：完全破盾仍使用受擊前上限，HP與盾同一擊各記一次', () => {
  const { c, p, e } = setup(); fixedLife(c, p);
  p.shield = 2500; p.shieldMax = 5000;
  const hit = incoming(c, p, e, 3500);
  assert.equal(hit.absorbed, 2500); assert.equal(hit.hpDamage, 1000);
  assert.equal(p.shield, 0); assert.equal(p.shieldMax, 0);
  assert.equal(c.sgCounterRT().warBody.collected, 60);
  const missed = incoming(c, p, e, 500, { absDodge: 100 });
  assert.equal(missed.miss, true); assert.equal(c.sgCounterRT().warBody.collected, 60);
  // 受擊通知負責反擊；法力不足時不反擊，也不能因此遺漏或重複記錄損失。
  p.mp = 0;
  c.skills2OnPlayerDamaged(e, p, hit.hpDamage, hit.blocked, hit, 'pv-float');
  assert.equal(c.sgCounterRT().warBody.collected, 60);
  c.applyStatus(p, 'invuln', { dur: 2 });
  const invuln = incoming(c, p, e, 500, { invuln: true });
  assert.equal(invuln.invuln, true); assert.equal(c.sgCounterRT().warBody.collected, 60);
  c.skills2ManaShieldResult = () => ({ damage: 500, mana: 500 });
  incoming(c, p, e, 500);
  assert.equal(c.sgCounterRT().warBody.collected, 60, '純法力承擔不算生命／護盾損失');
  c.GT = .5; c.sgWarGodBodyState(p);
  assert.equal(p.hp, 8900, '無敵仍保留固定自傷');
  assert.equal(c.sgCounterRT().warBody.collected, 61);
  c.grantShield(p, 2000, c.getStats()); p.buffs.shield = { val: 2000, until: .5 };
  c.tickShieldExpiry(p);
  assert.equal(p.shield, 0); assert.equal(c.sgCounterRT().warBody.collected, 61, '自然到期不算受傷損失');
});

test('戰神體原生反擊：後三秒每次反擊共用加成，飄字等於實際傷害且使用既有斬擊事件', () => {
  const { c, p, e } = setup(); const st = fixedLife(c, p), floats = [], vfx = [];
  c.floatEnemyEvent = (...args) => floats.push(args);
  c.playCombatVfx = spec => vfx.push(spec);
  const baseline = c.sgCounterStrike(p, st, e, 100, 'mv-float', { dmg: 0 }, 0, {});
  c.sgWarGodBodyOnDamaged(1000, p, 2500, 5000);
  for (const at of [3, 4, 5.999]) {
    c.GT = at; const cfg = c.sgCounterLegendCfg([e]);
    assert.equal(cfg.warGodPct, 132);
    const before = e.hp;
    const result = c.sgCounterStrike(p, st, e, 100, 'mv-float', { dmg: 0 }, 200, cfg);
    assert.ok(Math.abs(result.dmg - baseline.dmg * 2.32) <= 2);
    assert.equal(before - e.hp, result.dmg);
    assert.equal(floats.at(-1)[4], result.dmg);
    assert.equal(floats.at(-1)[5], 200);
    assert.ok(vfx.some(spec => spec.variant === 'counter-riposte' && spec.delayMs === 200));
  }
});

test('無敵時所有反擊進化都不觸發普攻反擊、招架或追加效果，無敵到期恢復', () => {
  for (const ultPick of [null, 0, 1, 2]) {
    const { c, p, e } = setup(ultPick);
    const mp = p.mp, hp = e.hp, shield = p.shield || 0;
    c.applyStatus(p, 'invuln', { dur: 2 });
    // 即使延後送達的受擊通知沒有 invuln 旗標，也以當前狀態阻擋。
    const hit = { miss: false, invuln: false, killed: false, absorbed: 100 };
    c.skills2OnPlayerDamaged(e, p, 100, true, hit, 'pv-float');
    c.sgCounterOnPlayerDamaged(e, p, 100, true, hit, 'pv-float');
    assert.equal(e.hp, hp); assert.equal(p.mp, mp); assert.equal(p.shield || 0, shield);
    assert.equal(c.sgCounterRT().hits, 0);
    assert.equal(c.SKILL2_RT.projectiles.length, 0);
    c.GT = 2;
    p._sgRevival = true;
    c.skills2OnPlayerDamaged(e, p, 100, true, hit, 'pv-float');
    assert.equal(e.hp, hp); assert.equal(p.mp, mp, '復甦無敵同樣不觸發反擊');
    p._sgRevival = false;
    c.skills2OnPlayerDamaged(e, p, 100, true, hit, 'pv-float');
    assert.ok(e.hp < hp, '到期後能再正常反擊');
    assert.ok(p.mp < mp); assert.ok(c.sgCounterRT().hits > 0);
  }
});

test('無敵命中的結果即使延後到狀態消失後送達，仍不建立反擊', () => {
  const { c, p, e } = setup();
  const mp = p.mp, hp = e.hp;
  c.sgCounterOnPlayerDamaged(e, p, 100, true, { invuln: true, absorbed: 100 }, 'pv-float');
  assert.equal(e.hp, hp); assert.equal(p.mp, mp); assert.equal(c.sgCounterRT().hits, 0);
});
