'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine');
const plain = (value) => JSON.parse(JSON.stringify(value));

function prepared() {
  const engine = createEngine({ seed: 9 }).boot(null);
  const c = engine.ctx;
  c.G.player.level = 1000;
  c.G.player.reincarnations = 10;
  c.G.player.gold = 1e20;
  c.G.player.skills2 = {
    levels: { frostnova: Array(7).fill(10), thrust: Array(7).fill(10) },
    ult: { frostnova: { pick: 0, lv: 10 }, thrust: { pick: 1, lv: 3 } }
  };
  return engine;
}

for (let tier = 0; tier < 7; tier++) {
  test(`Worker 重置第 ${tier + 1} 階：清除後續普通階及超神，不影響其他群組與金幣`, () => {
    const e = prepared(), c = e.ctx;
    const gold = c.G.player.gold;
    const other = plain(c.G.player.skills2.ult.thrust);
    c.UI.dirty.skills = false;
    c.UI.dirty.header = false;
    c._statsCache = { stale: true };
    assert.ok(c.skills2Ult('frostnova'));
    assert.deepEqual(plain(e.cmd('skill2.delete', { group: 'frostnova', tier })), { ok: true, result: true });
    const expected = Array.from({ length: 7 }, (_, i) => i < tier ? 10 : (i === 0 ? 1 : 0));
    assert.deepEqual(plain(c.G.player.skills2.levels.frostnova), expected);
    assert.equal(c.G.player.skills2.ult.frostnova, undefined);
    assert.equal(c.skills2Ult('frostnova'), null);
    assert.equal(c.skills2PanelView().ult.frostnova, undefined);
    assert.deepEqual(plain(c.G.player.skills2.ult.thrust), other);
    assert.deepEqual(plain(c.G.player.skills2.levels.thrust), Array(7).fill(10));
    assert.equal(c.G.player.gold, gold);
    assert.equal(c._statsCache, null);
    assert.equal(c.UI.dirty.skills, true);
    assert.equal(c.UI.dirty.header, true);
    // 重新練滿普通階也不能讓明確重置掉的超神自行恢復。
    c.G.player.skills2.levels.frostnova = Array(7).fill(10);
    assert.equal(c.skills2Ult('frostnova'), null);
  });
}

test('舊重置殘留：保底階級再次重置可清除超神，重複執行仍一致', () => {
  const e = prepared(), c = e.ctx;
  c.G.player.skills2.levels.frostnova = [1, 0, 0, 0, 0, 0, 0];
  for (let n = 0; n < 2; n++) {
    assert.equal(e.cmd('skill2.delete', { group: 'frostnova', tier: 0 }).result, true);
    assert.deepEqual(plain(c.G.player.skills2.levels.frostnova), [1, 0, 0, 0, 0, 0, 0]);
    assert.equal(c.skills2PanelView().ult.frostnova, undefined);
  }
});

test('直接重置超神只清除選擇與等級；無效群組／階級不更動資料', () => {
  const e = prepared(), c = e.ctx;
  const before = plain(c.G.player.skills2);
  assert.ok(e.cmd('skill2.delete', { group: 'missing', tier: 0 }).result.err);
  assert.equal(e.cmd('skill2.delete', { group: 'frostnova', tier: 8 }).ok, false);
  assert.deepEqual(plain(c.G.player.skills2), before);
  assert.equal(e.cmd('skill2.delete', { group: 'frostnova', tier: c.SG_ULT_SLOT }).result, true);
  assert.deepEqual(plain(c.G.player.skills2.levels.frostnova), before.levels.frostnova);
  assert.equal(c.G.player.skills2.ult.frostnova, undefined);
  assert.deepEqual(plain(c.G.player.skills2.ult.thrust), before.ult.thrust);
});

test('一般降級保留超神投資、暫時失效，升回滿級恢復原選擇與等級', () => {
  const e = prepared(), c = e.ctx;
  assert.equal(c.skills2Downgrade('frostnova', 6), null);
  assert.equal(c.skills2Ult('frostnova'), null);
  assert.deepEqual(plain(c.skills2PanelView().ult.frostnova), { pick: 0, lv: 10 });
  assert.equal(c.skills2Learn('frostnova', 6), null);
  assert.equal(c.skills2Ult('frostnova').lv, 10);
});
