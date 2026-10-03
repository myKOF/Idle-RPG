'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine');
const plain = (v) => JSON.parse(JSON.stringify(v));

function prepared() {
  const e = createEngine({ seed: 9 }).boot(null);
  const c = e.ctx;
  c.G.player.level = 1000;
  c.G.player.reincarnations = 10;
  c.G.player.gold = 1e12;
  c.G.player.skills2 = {
    levels: { frostnova: Array(7).fill(10), thrust: Array(7).fill(10) },
    ult: { frostnova: { pick: 1, lv: 10 }, thrust: { pick: 0, lv: 3 } }
  };
  return { e, c, args: { group: 'frostnova', opt: 2, fromOpt: 1, fromLv: 10, cost: c.skills2UltCost('frostnova', 2, 0) } };
}

test('Worker 切換只扣新技能首次費用、清除原等級，快照及屬性刷新', () => {
  const { e, c, args } = prepared();
  const before = plain(c.G.player.skills2), gold = c.G.player.gold;
  c._statsCache = { stale: true };
  c.UI.dirty.skills = c.UI.dirty.header = false;
  const ack = e.cmd('skill2.ultSwitch', args);
  assert.equal(ack.ok, true);
  assert.equal(ack.result, null);
  assert.equal(c.G.player.gold, gold - args.cost);
  assert.deepEqual(plain(c.G.player.skills2.ult.frostnova), { pick: 2, lv: 1 });
  assert.deepEqual(plain(c.skills2PanelView().ult.frostnova), { pick: 2, lv: 1 });
  assert.equal(c.skills2Ult('frostnova').id, 'iceKingDomain');
  assert.deepEqual(plain(c.G.player.skills2.levels), before.levels);
  assert.deepEqual(plain(c.G.player.skills2.ult.thrust), before.ult.thrust);
  assert.equal(c._statsCache, null);
  assert.equal(c.UI.dirty.skills, true);
  assert.equal(c.UI.dirty.header, true);
  const afterGold = c.G.player.gold;
  assert.match(e.cmd('skill2.ultSwitch', args).result, /已變更/);
  assert.equal(c.G.player.gold, afterGold);
  assert.deepEqual(plain(c.G.player.skills2.ult.frostnova), { pick: 2, lv: 1 });
});

for (const reason of ['金幣不足', '未解鎖', '原等級已變', '原選擇已變', '沒有原選擇', '報價已變', '相同選項', '非法選項', '未知群組']) {
  test(`Worker ${reason}拒絕切換，原資料及金幣不變`, () => {
    const { e, c, args } = prepared();
    if (reason === '金幣不足') c.G.player.gold = args.cost - 1;
    if (reason === '未解鎖') c.G.player.skills2.levels.frostnova[6] = 9;
    if (reason === '原等級已變') c.G.player.skills2.ult.frostnova.lv = 9;
    if (reason === '原選擇已變') c.G.player.skills2.ult.frostnova.pick = 0;
    if (reason === '沒有原選擇') delete c.G.player.skills2.ult.frostnova;
    if (reason === '報價已變') args.cost++;
    if (reason === '相同選項') args.opt = 1;
    if (reason === '非法選項') args.opt = 3;
    if (reason === '未知群組') args.group = 'missing';
    const before = plain(c.G.player.skills2), gold = c.G.player.gold;
    const ack = e.cmd('skill2.ultSwitch', args);
    assert.ok(ack.ok === false || typeof ack.result === 'string' || (ack.result && ack.result.err));
    assert.deepEqual(plain(c.G.player.skills2), before);
    assert.equal(c.G.player.gold, gold);
  });
}

test('餘額剛好可切換至 Lv.1；普通選擇仍拒絕覆蓋已有選擇', () => {
  const { e, c, args } = prepared();
  c.G.player.gold = args.cost;
  assert.match(e.cmd('skill2.ultPick', { group: args.group, opt: args.opt }).result, /已選擇/);
  assert.equal(e.cmd('skill2.ultSwitch', args).result, null);
  assert.equal(c.G.player.gold, 0);
  assert.deepEqual(plain(c.G.player.skills2.ult.frostnova), { pick: 2, lv: 1 });
});
