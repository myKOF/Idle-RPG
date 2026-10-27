'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine');
const plain = x => JSON.parse(JSON.stringify(x));
function setup(level = 480) {
  const e = createEngine({ seed: 27 }).boot(null), c = e.ctx;
  c.G.player.level = 1000;
  c.G.player.reincarnations = 10;
  c.G.tower.highest = 150;
  c.G.player.gold = 1e20;
  c.G.player.skillMastery = { level, xp: 0 };
  return { e, c, p: c.G.player };
}
test('免費第一階不占點；熟練度每級1點，技能升1級同時扣金幣及1點', () => {
  const { e, c, p } = setup(1);
  assert.deepEqual(plain(e.panel('skills').skills2.points), { total: 1, spent: 0, available: 1 });
  const gold = p.gold = 1e8, cost = c.skills2UpgradeCost('thrust', 0, 1);
  assert.equal(e.cmd('skill2.learn', { group: 'thrust', tier: 0 }).result, null);
  assert.equal(c.skills2Levels('thrust')[0], 2);
  assert.equal(p.gold, gold - cost);
  assert.deepEqual(plain(e.panel('skills').skills2.points), { total: 1, spent: 1, available: 0 });
  const before = plain(p.skills2), afterGold = p.gold;
  assert.match(e.cmd('skill2.learn', { group: 'thrust', tier: 1 }).result, /技能點不足/);
  assert.deepEqual(plain(p.skills2), before);
  assert.equal(p.gold, afterGold);
  c.gainSkillMasteryXp(c.skillMasteryXpForLevel(1));
  assert.equal(e.panel('skills').skills2.points.available, 1);
  assert.equal(p.skillPoints, undefined);
});
test('金幣不足或門檻不符不花點；一鍵滿級在點數用盡時停止且不超扣', () => {
  const { e, c, p } = setup(3);
  p.gold = 0;
  assert.match(e.cmd('skill2.learn', { group: 'thrust', tier: 0 }).result, /金幣不足/);
  assert.equal(c.skills2PointView().available, 3);
  p.gold = 1e8;
  const gold = p.gold;
  const costs = [1, 2, 3].reduce((sum, lv) => sum + c.skills2UpgradeCost('thrust', 0, lv), 0);
  assert.equal(e.cmd('skill2.max', { group: 'thrust', tier: 0 }).result, true);
  assert.equal(c.skills2Levels('thrust')[0], 4);
  assert.equal(p.gold, gold - costs);
  assert.equal(c.skills2PointView().available, 0);
  assert.match(e.cmd('skill2.max', { group: 'thrust', tier: 0 }).result.err, /技能點不足/);
});
test('暫鎖普通階／失效終極仍占點；其他階升降不覆蓋原始投資，重讀不重複發點', () => {
  const { e, c, p } = setup(100);
  p.skills2 = { levels: { thrust: [2, 1, 5, 0, 0, 0, 0] }, ult: { thrust: { pick: 0, lv: 3 } } };
  p.level = 1; p.reincarnations = 0;
  assert.equal(c.skills2Levels('thrust')[2], 0);
  assert.deepEqual(plain(c.skills2PointView()), { total: 100, spent: 10, available: 90 });
  assert.equal(c.skills2Learn('thrust', 0), null);
  assert.equal(p.skills2.levels.thrust[2], 5);
  assert.equal(c.skills2PointView().available, 89);
  assert.equal(c.skills2Downgrade('thrust', 0), null);
  assert.equal(p.skills2.levels.thrust[2], 5);
  const reloaded = createEngine({ seed: 27 }).boot(JSON.parse(e.saveJson()));
  assert.deepEqual(plain(reloaded.panel('skills').skills2.points), { total: 100, spent: 10, available: 90 });
});
test('終極首選／升級／批次都花點，重選返還舊點再花1點，失敗原子保留', () => {
  const { e, c, p } = setup(74);
  p.skills2 = { levels: { thrust: Array(7).fill(10) }, ult: {} };
  assert.equal(c.skills2PointView().available, 5);
  assert.equal(e.cmd('skill2.ultPick', { group: 'thrust', opt: 0 }).result, null);
  assert.equal(c.skills2PointView().available, 4);
  assert.equal(e.cmd('skill2.learn', { group: 'thrust', tier: 7 }).result, null);
  assert.equal(e.cmd('skill2.max', { group: 'thrust', tier: 7 }).result, true);
  assert.equal(p.skills2.ult.thrust.lv, 5);
  assert.equal(c.skills2PointView().available, 0);
  assert.match(e.cmd('skill2.learn', { group: 'thrust', tier: 7 }).result, /技能點不足/);
  const args = { group: 'thrust', opt: 1, fromOpt: 0, fromLv: 5, cost: c.skills2UltCost('thrust', 1, 0) };
  const before = plain(p.skills2); p.gold = 0;
  assert.match(e.cmd('skill2.ultSwitch', args).result, /金幣不足/);
  assert.deepEqual(plain(p.skills2), before);
  p.gold = 1e8;
  assert.equal(e.cmd('skill2.ultSwitch', args).result, null);
  assert.equal(c.skills2PointView().available, 4);
  assert.equal(e.cmd('skill2.delete', { group: 'thrust', tier: 7 }).result, true);
  assert.equal(c.skills2PointView().available, 5);
});
test('超支舊檔保留投資，降級與GM開門不直接提供新點數；重置精確返點', () => {
  const { e, c, p } = setup(1);
  p.skills2 = { levels: { thrust: Array(7).fill(10) }, ult: { thrust: { pick: 0, lv: 10 } } };
  c.GM_TEST.skillUnlock = true;
  assert.deepEqual(plain(c.skills2PointView()), { total: 1, spent: 79, available: 0 });
  const gold = p.gold;
  assert.equal(e.cmd('skill2.downgrade', { group: 'thrust', tier: 6 }).result, null);
  assert.equal(c.skills2PointView().spent, 78);
  assert.match(e.cmd('skill2.learn', { group: 'thrust', tier: 6 }).result, /技能點不足/);
  assert.equal(e.cmd('skill2.delete', { group: 'thrust', tier: 0 }).result, true);
  assert.deepEqual(plain(c.skills2PointView()), { total: 1, spent: 0, available: 1 });
  assert.equal(p.gold, gold);
});

for (const mastery of [79, 480]) {
  test(`Lv.10重選Lv.1：熟練度${mastery}、零餘額返9點並保存，反覆重選不重複發點`, () => {
    const { e, c, p } = setup(mastery);
    p.skills2 = { levels: { thunderorb: Array(7).fill(10) }, ult: { thunderorb: { pick: 1, lv: 10 } } };
    if (mastery === 480) {
      for (const gid of Object.keys(c.SKILLS2).filter(gid => gid !== 'thunderorb')) {
        p.skills2.levels[gid] = Array(7).fill(10);
        p.skills2.ult[gid] = { pick: 0, lv: 10 };
      }
      p.skills2.levels.thrust[0] = 9;
    }
    const before = plain(c.skills2PointView()), investment = plain(p.skills2);
    assert.equal(before.available, 0);
    e.panel('skills'); e.panel('skills');
    assert.deepEqual(plain(p.skills2), investment, '面板不得寫入保留額度');
    const args = { group: 'thunderorb', opt: 2, fromOpt: 1, fromLv: 10, cost: c.skills2UltCost('thunderorb', 2, 0) };
    const gold = p.gold = args.cost + 1e12;
    assert.equal(e.cmd('skill2.ultSwitch', args).result, null);
    assert.equal(p.gold, gold - args.cost);
    assert.deepEqual(plain(p.skills2.ult.thunderorb), { pick: 2, lv: 1 });
    assert.deepEqual(plain(e.panel('skills').skills2.points), { total: before.spent, spent: before.spent - 9, available: 9 });
    assert.equal(p.skills2.legacyPointCredit || 0, before.spent - mastery);
    const after = plain(p.skills2), afterGold = p.gold;
    assert.match(e.cmd('skill2.ultSwitch', args).result, /已變更/);
    assert.deepEqual(plain(p.skills2), after);
    assert.equal(p.gold, afterGold);
    const reloaded = createEngine({ seed: 27 }).boot(JSON.parse(e.saveJson())), rc = reloaded.ctx;
    assert.deepEqual(plain(reloaded.panel('skills').skills2.points), plain(c.skills2PointView()));
    assert.equal(rc.G.player.skills2.legacyPointCredit, p.skills2.legacyPointCredit);
    assert.equal(reloaded.cmd('skill2.ultSwitch', { ...args, opt: 1, fromOpt: 2, fromLv: 1, cost: rc.skills2UltCost('thunderorb', 1, 0) }).result, null);
    assert.equal(rc.skills2PointView().available, 9, 'Lv.1換Lv.1餘額不變');
    assert.equal(reloaded.cmd('skill2.max', { group: 'thunderorb', tier: 7 }).result, true);
    assert.equal(rc.skills2PointView().available, 0, '返還點數可正常投入新技能');
    assert.equal(rc.G.player.skills2.ult.thunderorb.lv, 10);
    assert.match(reloaded.cmd('skill2.learn', { group: 'thrust', tier: 0 }).result, /技能點不足/);
    assert.equal(rc.G.player.skills2.legacyPointCredit, p.skills2.legacyPointCredit);
  });
}

test('超支重選的失敗請求不扣金幣、不發保留額度，也不更改投資', () => {
  const { e, c, p } = setup(1);
  p.skills2 = { levels: { thunderorb: Array(7).fill(10) }, ult: { thunderorb: { pick: 1, lv: 10 } } };
  const args = { group: 'thunderorb', opt: 2, fromOpt: 1, fromLv: 10, cost: c.skills2UltCost('thunderorb', 2, 0) };
  for (const reason of ['gold', 'unlock', 'quote']) {
    p.gold = reason === 'gold' ? args.cost - 1 : 1e12;
    p.skills2.levels.thunderorb[6] = reason === 'unlock' ? 9 : 10;
    const before = plain(p.skills2), gold = p.gold;
    assert.equal(typeof e.cmd('skill2.ultSwitch', { ...args, cost: args.cost + (reason === 'quote' ? 1 : 0) }).result, 'string');
    assert.deepEqual(plain(p.skills2), before);
    assert.equal(p.gold, gold);
    assert.equal(p.skills2.legacyPointCredit, undefined);
  }
});
