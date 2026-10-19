'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine');

function setup(lv = 10) {
  const c = createEngine({ seed: 1019 }).boot(null).ctx;
  c.G.player.level = 1000;
  c.G.player.skills2 = { levels: { fireball: [10, 10, 10, 10, 10, lv, 0], firehunt: [10, 0, 0, 0, 0, 0, 0] }, ult: {} };
  c.G.player.loadout = ['sg:fireball', 'sg:firehunt']; c.clearSkills2LevelsCache(); c.markStatsDirty();
  // 固定單層值以驗證機制；不要求使用者的工作區數值調校與 HEAD 相同。
  c.SKILLS2.fireball.tiers[5].fx.pct = .25; c.SKILLS2.fireball.tiers[5].fx.pctPer = .025;
  const base = c.getStats();
  c.getStats = () => Object.assign({}, base, { legendaryEffects: { firehuntBlaze: 1 }, legendaryEffectMults: { firehuntBlaze: 1 } });
  const p = c.FIELD.player; p.hp = base.hp; p.mp = 1e9;
  const home = c.bfPlayerPos();
  const e = { name: '疊層測試怪', hp: 1e12, maxHp: 1e12, def: 0, mdef: 0, level: 1,
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0, pos: { x: home.x + 20, y: home.y } };
  c.sgApplyBurn(e, { dps: 1, dur: 1000, interval: .5 });
  const ctx = { pEnt: p, getEnemies: () => [e], floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
  return { c, p, e, ctx };
}
function burn(c, ctx, n = 1) {
  for (let i = 0; i < n; i++) { c.GT += .5; c.sgTickBurn(.5, ctx); }
}
function hunt(c, p, e, ctx) {
  c.castSkill2(p, [e], 'firehunt', 'mv-float');
  c.SKILL2_RT.orbits.find(f => f.gid === 'firehunt').until = 1000;
  c.sgTickFirehuntLegend(ctx, 0);
}
function close(a, b) { assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`); }

test('火焰增幅：各等級在49／50／51層與大量同拍都封頂，滿層刷新時間，到期重新起算', () => {
  for (const [lv, per] of [[1, .275], [10, .5]]) {
    const { c, p, ctx } = setup(lv);
    burn(c, ctx, 49); assert.equal(p.buffs.sgFireAmp.stacks, 49); close(c.skill2FireAmpPct(p), per * 49);
    burn(c, ctx); assert.equal(p.buffs.sgFireAmp.stacks, 50); close(c.skill2FireAmpPct(p), per * 50);
    const until = p.buffs.sgFireAmp.until;
    burn(c, ctx); assert.equal(p.buffs.sgFireAmp.stacks, 50); close(c.skill2FireAmpPct(p), per * 50);
    close(p.buffs.sgFireAmp.until, until + .5);
    c.sgTickBurn(100, ctx); assert.equal(p.buffs.sgFireAmp.stacks, 50); close(c.skill2FireAmpPct(p), per * 50);
    c.GT = p.buffs.sgFireAmp.until;
    assert.equal(c.skill2FireAmpPct(p), 0);
    burn(c, ctx); assert.equal(p.buffs.sgFireAmp.stacks, 1); close(c.skill2FireAmpPct(p), per);
  }
});

test('烈火狩與火焰增幅各自50層、合計火傷不重複，時間與額度互不占用', () => {
  const { c, p, e, ctx } = setup(); hunt(c, p, e, ctx);
  for (let i = 0; i < 60; i++) { burn(c, ctx); c.sgTickFirehuntLegend(ctx, .5); }
  assert.equal(p.buffs.sgFireAmp.stacks, 50); assert.equal(p.buffs.sgFirehuntAmp.stacks, 50);
  assert.equal(p.buffs.sgFireAmp.val, 25); assert.equal(p.buffs.sgFirehuntAmp.val, 100);
  assert.equal(c.skill2FireAmpPct(p), 125);
  close(c.legendaryElementDamageUp(c.getStats(), p).fire, 125);
  const entries = c.statusEntries(p);
  for (const sid of ['sgFireAmp', 'sgFirehuntAmp']) assert.equal(entries.find(s => s.sid === sid).stacks, 50);
  const fireUntil = p.buffs.sgFireAmp.until, huntUntil = p.buffs.sgFirehuntAmp.until;
  assert.ok(huntUntil < fireUntil);
  c.GT = huntUntil; assert.equal(c.skill2FireAmpPct(p), 25, '烈火狩先到期不清掉火焰增幅');
  assert.equal(c.statusEntries(p).some(s => s.sid === 'sgFirehuntAmp'), false);
  c.GT = fireUntil; assert.equal(c.skill2FireAmpPct(p), 0);
  burn(c, ctx); c.sgTickFirehuntLegend(ctx, .5);
  assert.equal(p.buffs.sgFireAmp.stacks, 1); assert.equal(p.buffs.sgFirehuntAmp.stacks, 1);
  close(c.skill2FireAmpPct(p), 2.5);
});

test('火焰增幅按狀態角色與表定上限疊加，範圍外不疊，烈火狩消失後不再續期', () => {
  const { c, p, e, ctx } = setup();
  c.STATUS.ampTest = Object.assign({}, c.STATUS.sgFireAmp, { key: 'ampTestKey' });
  c.SKILLS2.fireball.tiers[5].status.self = [{ id: 'ampTest' }]; c.sgStatusSlotsReset();
  c.SKILLS2.fireball.tiers[5].fx.maxStacks = 3;
  burn(c, ctx, 5); assert.equal(p.buffs.ampTestKey.stacks, 3); assert.equal(c.skill2FireAmpPct(p), 1.5);
  const until = p.buffs.ampTestKey.until;
  e.pos.x += 10000; burn(c, ctx);
  assert.equal(p.buffs.ampTestKey.until, until, '範圍外不疊層也不刷新時間');
  e.pos.x -= 10000;
  hunt(c, p, e, ctx); c.GT += .5; c.sgTickFirehuntLegend(ctx, .5);
  assert.equal(p.buffs.sgFirehuntAmp.stacks, 1);
  const huntUntil = p.buffs.sgFirehuntAmp.until;
  c.SKILL2_RT.orbits = []; c.GT += .5; c.sgTickFirehuntLegend(ctx, .5);
  assert.equal(p.buffs.sgFirehuntAmp.until, huntUntil);
});

test('滿層後第51次作用不增加真實火傷，狀態快照的50層與效果值相符', () => {
  const { c, p, e, ctx } = setup(); c.Math.random = () => .5; c.chance = pct => pct >= 100;
  function hit() { return c.resolveHit(p, e, c.sgAtkCfg(p, c.getStats(), 1000, e, 0, 'fireball'), c.monsterDefCfg(e)).dmg; }
  const base = hit(); burn(c, ctx, 50); const fifty = hit(); burn(c, ctx); const fiftyOne = hit();
  assert.equal(fifty, fiftyOne); assert.ok(Math.abs(fifty - base * 1.25) <= 2);
  const shown = c.statusEntries(p).find(s => s.sid === 'sgFireAmp');
  assert.equal(shown.stacks, 50); assert.equal(shown.val, 25);
});
