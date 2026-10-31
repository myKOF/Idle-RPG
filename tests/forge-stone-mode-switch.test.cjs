'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine.js');
function setup() {
  const e = createEngine({ seed: 1029 }).boot(null), c = e.ctx;
  c.G.player.reincarnations = 5; c.G.player.gold = 1e12; c.G.player.dust = 1000;
  c.setCombatPaused(true);
  return { e, c };
}
function cmd(c, name, args = {}) {
  const result = c.runCommand('forge.' + name, args);
  assert.equal(result.ok, true, result.error);
  return result.result;
}
function prepare(c, mode, rarity) {
  cmd(c, 'setQuality', { rarity });
  cmd(c, 'setOperation', { mode });
  if (mode === 'gem') {
    const type = Object.keys(c.GEM_TYPES).find(c.isGemEnabled);
    c.addGem(type, 10, 1);
    assert.equal(cmd(c, 'placeGem', { type, level: 10 }), null);
  } else {
    const it = c.makeEquipment(100, { rarity, ancientCount: 0 }); c.G.inventory.push(it);
    assert.equal(cmd(c, 'placeItem', { itemId: it.id }), null);
  }
  assert.equal(cmd(c, 'setStones', { count: 50 }), null);
  assert.equal(c.G.forge.stonePreference, 50);
  assert.equal(cmd(c, 'setOperation', { mode: 'equip' }), null);
  assert.equal(cmd(c, 'setQuality', { rarity }), null);
  for (let i = 0; i < 12; i++) c.G.inventory.push(c.makeEquipment(100, { rarity }));
  assert.equal(cmd(c, 'autoFill'), null);
}
for (const mode of ['ancient', 'imprint', 'gem']) {
  for (const [rarity, max, output] of [[6, 13, 11], [7, 15, 8], [9, 17, 10]]) {
    test(mode + '投入50顆後切回品質' + rarity + '：顯示／實際／連續偏好同為' + max + '且可立即開始', () => {
      const { e, c } = setup(); prepare(c, mode, rarity);
      assert.equal(e.panel('forge').rate.stones, max);
      assert.equal(c.G.forge.stones, max);
      assert.equal(c.G.forge.stonePreference, max);
      const gold = c.G.player.gold, dust = c.G.player.dust, cost = c.forgeRateInfo().cost;
      assert.equal(cmd(c, 'setAuto', { on: true }), null);
      assert.ok(c.G.forge.crafting);
      e.stepSeconds(3);
      assert.ok(c.G.inventory.some(it => it.rarity === output));
      assert.equal(c.G.player.dust, dust - max);
      assert.equal(c.G.player.gold, gold - cost);
      assert.ok(c.G.forge.crafting);
      assert.equal(c.G.forge.stones, max);
      assert.equal(c.G.forge.stonePreference, max);
      assert.ok(!c.G.forge.log.some(entry => entry.cls === 'warn'));
    });
  }
}
test('既有已卡住的50顆選取，直接按開始按目前配方13顆修復，存讀也能恢復', () => {
  for (const reload of [false, true]) {
    let { e, c } = setup();
    for (let i = 0; i < 6; i++) c.G.inventory.push(c.makeEquipment(100, { rarity: 6 }));
    cmd(c, 'autoFill'); c.G.forge.stones = c.G.forge.stonePreference = 50;
    if (reload) { e = createEngine({ seed: 1029 }).boot(JSON.parse(e.saveJson())); c = e.ctx; }
    assert.equal(e.panel('forge').rate.stones, 13);
    const dust = c.G.player.dust;
    assert.equal(cmd(c, 'start'), null);
    assert.equal(c.G.forge.stones, 13); assert.equal(c.G.forge.stonePreference, 13);
    e.stepSeconds(3);
    assert.equal(c.G.player.dust, dust - 13);
    assert.equal(c.G.inventory.filter(it => it.rarity === 11).length, 1);
  }
});
test('配方上限同步不將庫存不足當成減量許可，連續及作業中資源不足仍保護原料', () => {
  const { e, c } = setup(); prepare(c, 'ancient', 6);
  c.G.player.dust = 12;
  const gold = c.G.player.gold;
  assert.ok(cmd(c, 'setAuto', { on: true }));
  assert.equal(c.G.forge.stonePreference, 13);
  assert.equal(c.G.forge.auto, false); assert.equal(c.G.forge.crafting, undefined);
  assert.equal(c.G.player.gold, gold); assert.equal(c.forgeItemCount(), 6);
  c.G.player.dust = 13; assert.equal(cmd(c, 'setAuto', { on: true }), null);
  c.G.player.dust = 12; e.stepSeconds(3);
  assert.equal(c.G.player.gold, gold); assert.equal(c.G.player.dust, 12);
  assert.equal(c.forgeItemCount(), 6); assert.equal(c.G.forge.auto, false);
});
