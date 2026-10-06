'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createEngine } = require('../scripts/sim/engine');

function setup(gid, ultId, lv = 10) {
  const engine = createEngine({ seed: 9 }).boot(null), c = engine.ctx;
  c.G.player.level = 2000;
  c.G.player.skills2 = { levels: { [gid]: Array(7).fill(10) }, ult: {} };
  if (ultId) c.G.player.skills2.ult[gid] = { pick: c.SKILLS2[gid].ult.findIndex(u => u.id === ultId), lv };
  c.G.player.loadout = ['sg:' + gid];
  c.markStatsDirty(); c.initFieldPlayer();
  const p = c.FIELD.player;
  const timer = () => c.buildPanel('battle').skillTimers['sg:' + gid];
  return { engine, c, p, timer };
}

test('天霸風神斬取實際排程：開始前、施放後、跳過／暫停都不讀主動冷卻', () => {
  const { c, p, timer } = setup('cleave', 'stormGodSlash');
  const ctx = { pEnt: p, getEnemies: () => [] };
  const before = JSON.stringify(p.skillCds);
  assert.equal(timer().mode, 'periodic');
  assert.equal(timer().total, 3); assert.equal(timer().remaining, 3);
  assert.equal(JSON.stringify(p.skillCds), before, '投影不可改結算狀態');
  c.sgTickUltAutoCast(ctx, .05);
  c.GT += 1;
  p.skillCds['sg:cleave'] = 12;
  assert.equal(timer().remaining, 2); assert.equal(timer().total, 3);
  c.GT += 2;
  let casts = 0; c.castSkill2 = () => { casts++; return { dmg: 0 }; };
  c.sgTickUltAutoCast(ctx, .05);
  assert.equal(casts, 1); assert.equal(timer().remaining, 3);
  c.effectActive = () => true;
  c.GT += 3; c.sgTickUltAutoCast(ctx, .05);
  assert.equal(casts, 1); assert.equal(timer().remaining, 3);
  p.hp = 0;
  c.GT += .5; c.sgTickUltAutoCast(ctx, .5);
  assert.equal(timer().remaining, 3); assert.equal(timer().paused, true);
  p.hp = 1;
  assert.equal(timer().paused, false);
  c.SKILL2_RT.earthguardRevival = { endAt: c.GT + 5 };
  c.GT += .5; c.sgTickUltAutoCast(ctx, .5);
  assert.equal(timer().remaining, 3); assert.equal(timer().paused, true, '活著但倒地時也凍結');
});

test('天霸風神斬等級間隔與真實施放一致，主動CD仍維持原結算用途', () => {
  const { c, p, timer } = setup('cleave', 'stormGodSlash', 1);
  assert.equal(timer().total, 7.5);
  p.mp = 100000;
  const enemy = { hp: 1e12, maxHp: 1e12, x: 10, y: 0, buffs: {}, effects: {}, dots: [] };
  const ctx = { pEnt: p, getEnemies: () => [enemy] };
  c.sgTickUltAutoCast(ctx, .05);
  const mp = p.mp;
  c.GT += 7.5; c.sgTickUltAutoCast(ctx, .05);
  assert.ok(p.mp < mp, '自動施放仍照規則扣魔');
  assert.ok(p.skillCds['sg:cleave'] > 0, '原冷卻不被顯示投影覆寫');
  assert.equal(timer().remaining, 7.5);
});

test('天地共生觸發才冷卻，總長度不吃全域CDR；未觸發的逆轉乾坤不充能', () => {
  for (const ult of [null, 'fateReversal']) {
    const { c, p, timer } = setup('earthguard', ult);
    c.getStats = () => ({ hp: 1000, mp: 1000, cdr: 90 });
    assert.equal(timer().mode, 'passive');
    assert.equal(timer().total, 30); assert.equal(timer().remaining, 0);
    assert.equal(timer().cost, 0);
    for (let i = 0; i < 100; i++) { c.GT++; c.sgTickRebirthCharge(p); }
    assert.equal(timer().remaining, 0);
    if (ult) assert.equal(c.skills2RebirthAvailableCharges(p), 1);
    p.hp = 0; assert.equal(c.skills2TryRebirth(p), true);
    assert.equal(timer().remaining, 30);
    c.tickSkillCds(p, 15);
    assert.equal(timer().remaining / timer().total, .5);
    if (ult) {
      c.tickSkillCds(p, 15); c.sgTickRebirthCharge(p);
      assert.equal(timer().remaining, 30);
      assert.equal(c.skills2RebirthAvailableCharges(p), 1);
    }
  }
});

test('不屈鬥魂致命觸發後才起算自身冷卻，反擊法力門檻仍含超神', () => {
  const { c, p, timer } = setup('counter', 'indomitable');
  assert.equal(timer().remaining, 0); assert.equal(timer().total, 60);
  assert.equal(timer().cost, 5000);
  p.hp = 0; assert.equal(c.skills2TryLastStand(p), true);
  assert.equal(timer().remaining, 60);
  c.tickSkillCds(p, 30); assert.equal(timer().remaining / timer().total, .5);
});

test('天穹崩裂受擊被動無冷卻無耗魔，降級使進化失效後恢復主動時鐘', () => {
  const { c, p, timer } = setup('windblade', 'skyCollapse');
  p.mp = 0; p.skillCds['sg:windblade'] = 8;
  assert.equal(timer().mode, 'passive'); assert.equal(timer().cost, 0);
  assert.equal(timer().remaining, 0); assert.equal(timer().total, 0);
  c.G.player.skills2.levels.windblade[6] = 9;
  assert.equal(timer().mode, 'active'); assert.equal(timer().remaining, 8);
});

test('23群組所有進化清查：附加節拍保留本體冷卻，主動總長度含縮地及全域倍率', () => {
  const { c, p } = setup('gale');
  c.getStats = () => ({ cdr: 50 });
  c.rwCooldownFactor = () => .5;
  assert.equal(c.skills2BattleTimers(p)['sg:gale'].total, .5);
  for (const gid of Object.keys(c.SKILLS2)) {
    for (const [pick, ult] of c.SKILLS2[gid].ult.entries()) {
      c.G.player.skills2 = { levels: { [gid]: Array(7).fill(10) }, ult: { [gid]: { pick, lv: 10 } } };
      c.G.player.loadout = ['sg:' + gid];
      const t = c.skills2BattleTimers(p)['sg:' + gid];
      const expected = gid === 'cleave' && ult.id === 'stormGodSlash' ? 'periodic'
        : c.skills2IsPassive(gid) || gid === 'windblade' && ult.id === 'skyCollapse' ? 'passive' : 'active';
      assert.equal(t.mode, expected, gid + '/' + ult.id);
      if (expected === 'active') assert.equal(t.total, c.skills2Cooldown(gid, c.skills2Levels(gid), p));
    }
  }
});

test('高塔投影用塔戰玩家：冷卻及充能不誤讀野外玩家', () => {
  const { c, p } = setup('earthguard', 'fateReversal');
  p.skillCds['sg:earthguard'] = 0;
  const tower = c.newPlayerEntity(c.getStats());
  tower.skillCds['sg:earthguard'] = 15;
  c.G.tower.active = true; c.TOWER.player = tower;
  const snap = c.buildPanel('battle');
  assert.equal(snap.skillTimers['sg:earthguard'].remaining, 15);
  assert.equal(snap.rebirthCharges, 0);
});

test('移除復活進化或降級後不顯示已失效效果留下的冷卻', () => {
  const counter = setup('counter', 'indomitable');
  counter.p.skillCds['sg:counter'] = 60;
  delete counter.c.G.player.skills2.ult.counter;
  assert.equal(counter.timer().remaining, 0); assert.equal(counter.timer().total, 0);
  const earth = setup('earthguard');
  earth.p.skillCds['sg:earthguard'] = 30;
  earth.c.G.player.skills2.levels.earthguard[6] = 0;
  assert.equal(earth.timer().remaining, 0); assert.equal(earth.timer().total, 0);
  assert.equal(earth.p.skillCds['sg:earthguard'], 30, '只改顯示，不改結算冷卻');
});

test('UI讀權威remaining並凍結暫停時鐘；缺欄舊快照沿用skillCds', () => {
  const source = fs.readFileSync(require.resolve('../js/ui.js'), 'utf8');
  const helper = /function uiBattleSkillTimer\([^]*?\n\}/.exec(source)[0];
  const c = vm.createContext({ uiCountdownRemain: (value, gt) => Math.max(0, value - (20 - gt)) });
  vm.runInContext(helper, c);
  const p = { skillCds: { 'sg:cleave': 12 } };
  const battle = { skillTimers: { 'sg:cleave': { mode: 'periodic', remaining: 3, total: 3, cost: 5000, paused: false } } };
  assert.equal(c.uiBattleSkillTimer('sg:cleave', p, 19, battle).remaining, 2);
  battle.skillTimers['sg:cleave'].paused = true;
  assert.equal(c.uiBattleSkillTimer('sg:cleave', p, 19, battle).remaining, 3);
  assert.equal(c.uiBattleSkillTimer('sg:cleave', p, 19, {}).remaining, 11);
});
