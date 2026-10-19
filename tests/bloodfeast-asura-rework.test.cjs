'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine');

function setup(pick = null, level = 10) {
  const c = createEngine({ seed: 1019 }).boot(null).ctx;
  c.G.player.level = 1000; c.G.tower.highest = 100;
  c.G.player.skills2 = { levels: { bloodrage: Array(7).fill(10) }, ult: {} };
  c.G.player.skills2.levels.bloodrage[6] = level;
  if (pick !== null) c.G.player.skills2.ult.bloodrage = { pick, lv: 10 };
  c.G.player.loadout = ['sg:bloodrage']; c.clearSkills2LevelsCache(); c.markStatsDirty();
  const p = c.FIELD.player, st = c.getStats(); p.hp = st.hp; p.mp = 1e9;
  const home = c.bfPlayerPos();
  const enemy = (offset = 20) => ({ name: '狂怒測試怪', hp: 1e14, maxHp: 1e14, level: 1,
    def: 0, mdef: 0, dodge: 0, resist: {}, ctrlRes: 0, effects: {}, buffs: {}, dots: [],
    pos: { x: home.x + offset, y: home.y } });
  const e = enemy(), near = enemy(25);
  const ctx = { pEnt: p, getEnemies: () => [e, near], floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
  return { c, p, st, e, near, ctx };
}
function fireAsura(c, ctx) {
  c.sgTickAsuraFist(ctx, 0);
  c.GT = c.SKILL2_RT.asuraFist;
  c.sgTickAsuraFist(ctx, .1);
  return c.sgUlt('bloodrage', 'asuraFist');
}
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`); }

test('狂血盛宴依當前失血比例增傷、每級+0.1%，最多100層，治療降層且過期失效', () => {
  for (const [lv, halfLostFactor] of [[1, 1.55], [10, 2]]) {
    const { c, p, st, e } = setup(null, lv);
    assert.equal(c.SKILLS2.bloodrage.tiers[6].fx.maxStacks, 100);
    assert.equal(c.SKILLS2.bloodrage.tiers[6].fx.count, undefined);
    c.castSkill2(p, [e], 'bloodrage', 'mv-float');
    const base = c.skill2RageDamageMultiplier(p);
    p.hp = st.hp / 2;
    close(c.skill2RageDamageMultiplier(p), base * halfLostFactor);
    c.healPlayer(p, st.hp / 2, st, { noShield: true });
    close(c.skill2RageDamageMultiplier(p), base);
    p.hp = 0;
    close(c.skill2RageDamageMultiplier(p), base * (lv === 1 ? 2.1 : 3));
    p.hp = -st.hp;
    close(c.skill2RageDamageMultiplier(p), base * (lv === 1 ? 2.1 : 3), '超出最大生命的負值不越過100層');
    // 配置上限必須實際接入，而不是只在說明顯示。
    c.SKILLS2.bloodrage.tiers[6].fx.maxStacks = 5; p.hp = st.hp / 2;
    close(c.skill2RageDamageMultiplier(p), base * (lv === 1 ? 1.055 : 1.1));
    c.GT = c.SKILL2_RT.rage.until;
    assert.equal(c.skill2RageDamageMultiplier(p), 1);
  }
});

test('狂血盛宴保留無上限擊殺延長與狂熱者，失血與額外目標分開', () => {
  const { c, p, st, e, near } = setup();
  c.castSkill2(p, [e, near], 'bloodrage', 'mv-float');
  const start = c.SKILL2_RT.rage.until;
  for (let i = 0; i < 20; i++) c.sgRageOnKill();
  close(c.SKILL2_RT.rage.until, start + 10);
  close(p.buffs.sgBloodrage.until, c.SKILL2_RT.rage.until);
  const original = c.getStats;
  c.getStats = () => Object.assign({}, original(), { comboHits: 999 });
  assert.deepEqual(Array.from(c.skill2RageBasicAttackTargets(e, [e, near])), [e]);
  assert.equal(c.skill2BloodfeastVfx(e).area, null);
  p.hp = st.hp / 2;
  const plain = c.skill2RageDamageMultiplier(p);
  c.sgLegendTick = () => ({ rageZealotPct: 50 });
  assert.ok(c.skill2RageDamageMultiplier(p) > plain, '傳奇仍放大每層係數');
  c.G.player.skills2.ult.bloodrage = { pick: 0, lv: 10 };
  assert.deepEqual(Array.from(c.skill2RageBasicAttackTargets(e, [e, near])), [e, near]);
  assert.ok(c.skill2BloodfeastVfx(e).area.r > 0, '殺神降臨原本的範圍仍保留');
});

test('霸王拳依週期給100%連擊觸發率，不要求狂怒，保留次數與小數機率', () => {
  for (const tower of [false, true]) {
  const { c, p, ctx } = setup(2);
  if (tower) { c.G.tower.active = true; c.TOWER = { player: p }; c.FIELD.player = { hp: 1, buffs: {} }; }
  c.Math.random = () => .99;
  assert.equal(c.skill2RageActive(), false);
  assert.equal(c.rollComboHits({ comboHits: 2 }), 0);
  const u = fireAsura(c, ctx);
  assert.equal(c.skill2ComboTriggerChance(c.COMBO_HITS_COEF.trigger), 100);
  assert.equal(c.skills2AllDamageUpPct(p), c.sgUltVal(u, 'pct'));
  assert.equal(c.rollComboHits({ comboHits: 2 }), 2);
  assert.equal(c.rollComboHits({ comboHits: 2.5 }), 2, '不保證不足一次的小數追加');
  c.Math.random = () => 0;
  assert.equal(c.rollComboHits({ comboHits: 2.5 }), 3);
  assert.equal(c.rollComboHits({ comboHits: 0 }), 0, '不憑空創造連擊數');
  }
});

test('霸王拳擊殺延長同一狀態，重新發動不截短延長時間，到期／卸下／換場重置一起失效', () => {
  const { c, p, ctx } = setup(2); fireAsura(c, ctx);
  const until = p.buffs.sgAsuraFist.until;
  c.GT += .5; c.sgRageOnKill();
  close(p.buffs.sgAsuraFist.until, until + .1);
  assert.equal(c.skill2ComboTriggerChance(0), 100);
  p.buffs.sgAsuraFist.until = c.GT + 30;
  const extended = p.buffs.sgAsuraFist.until;
  c.GT = c.SKILL2_RT.asuraFist; c.sgTickAsuraFist(ctx, .1);
  assert.equal(p.buffs.sgAsuraFist.until, extended);
  c.GT = extended; c.sgRageOnKill();
  assert.equal(c.skill2ComboTriggerChance(0), 0);
  assert.equal(c.skills2AllDamageUpPct(p), 0);
  assert.equal(p.buffs.sgAsuraFist.until, extended, '到期後擊殺不能重新啟用');
  c.GT = c.SKILL2_RT.asuraFist; c.sgTickAsuraFist(ctx, .1);
  c.G.player.loadout = []; c.sgTickAsuraFist(ctx, .1);
  assert.equal(c.skill2ComboTriggerChance(0), 0); assert.equal(c.skills2AllDamageUpPct(p), 0);
  c.G.player.loadout = ['sg:bloodrage']; fireAsura(c, ctx);
  c.resetSkill2RT();
  assert.equal(c.skill2ComboTriggerChance(0), 0); assert.equal(c.skills2AllDamageUpPct(p), 0);
});

test('霸王拳狀態換表後，傷害、連擊、擊殺延時與持續特效讀同一狀態角色', () => {
  const { c, p, ctx, e } = setup(2);
  c.STATUS.asuraTest = Object.assign({}, c.STATUS.sgAsuraFist, { key: 'asuraTestKey' });
  c.SKILLS2.bloodrage.ult[2].status.self = [{ id: 'asuraTest' }]; c.sgStatusSlotsReset();
  const u = fireAsura(c, ctx), buff = p.buffs.asuraTestKey, until = buff.until;
  assert.equal(c.statusActive(p, 'asuraTest'), true);
  assert.equal(c.skill2ComboTriggerChance(0), 100);
  assert.equal(c.skills2AllDamageUpPct(p), c.sgUltVal(u, 'pct'));
  assert.ok(c.skill2BloodfeastVfx(e));
  c.sgRageOnKill(); close(p.buffs.asuraTestKey.until, until + .1);
  assert.equal(c.STATUS.asuraTest.vfx.aura, 'aura-bloodrage');
  c.resetSkill2RT(); assert.equal(c.statusActive(p, 'asuraTest'), false);
});

test('霸王拳原生普攻確實追加兩擊，逐段傷害／飄字與原命中特效同步', () => {
  const { c, p, e, ctx } = setup(2), floats = [], events = [];
  const st = Object.assign({}, c.getStats(), { comboHits: 2, critRate: 0, elemAtk: {}, elemDmgPct: {}, passives: {} });
  c.getStats = () => st; c.Math.random = () => .99;
  c.floatEnemyEvent = (...args) => floats.push(args); c.playCombatVfx = spec => events.push(spec);
  c.doPlayerAttack(p, e, 'mv-float', 0);
  assert.equal(floats.filter(args => args[4] > 0).length, 1);
  fireAsura(c, ctx); floats.length = 0; events.length = 0;
  const before = e.hp;
  const res = c.doPlayerAttack(p, e, 'mv-float', 0, { feastVfx: c.skill2BloodfeastVfx(e) });
  const damageFloats = floats.filter(args => args[4] > 0);
  assert.equal(damageFloats.length, 3);
  assert.equal(before - e.hp, res.dmg);
  assert.equal(damageFloats.reduce((sum, args) => sum + args[4], 0), res.dmg);
  assert.equal(events.filter(spec => spec.variant === 'bloodfeast-hit').length, 3);
  assert.ok(events.filter(spec => spec.variant === 'bloodfeast-hit').every(spec => !spec.area));
});
