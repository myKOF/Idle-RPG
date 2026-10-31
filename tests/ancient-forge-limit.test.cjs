'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadRuneEnv } = require('./helpers/runeword-env.cjs');
const { createEngine } = require('../scripts/sim/engine.js');
const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
function setup(rarity = 6, natural = 0) {
  const c = loadRuneEnv();
  c.G.player.reincarnations = 5;
  c.G.player.gold = 1e12; c.G.player.dust = 1000; c.G.player.essence = 1000;
  c.forgeSetOperation('ancient');
  const it = c.makeEquipment(300, { rarity, slot: 'helmet', ancientCount: natural });
  c.G.inventory.push(it);
  c.chance = () => true;
  return { c, it };
}
function cast(c, it) {
  assert.equal(c.forgePlaceItem(it.id), null);
  assert.equal(c.doForge(), null);
}
function loadUiHelpers(c) {
  vm.runInContext(ui.slice(ui.indexOf('function ancientStarBadgeHTML('), ui.indexOf('function itemIconFile(')), c);
  vm.runInContext(ui.slice(ui.indexOf('function inventoryGridSnapshotEqual('), ui.indexOf('function inventoryViewHasFullDetails(')), c);
  c.inventoryViewItems = snapshot => snapshot.items;
  c.inventoryEnchantsEqual = () => true;
  c.inventoryRunesEqual = () => true;
}

for (const rarity of [6, 11, 7, 8, 9, 10]) {
  test('品質' + rarity + '：自然太古不占精鑄兩條額度，第三次入槽與偽造結算均零消耗', () => {
    const { c, it } = setup(rarity, 2);
    const naturalKeys = it.affixes.filter(a => a.ancient).map(a => a.key);
    cast(c, it); cast(c, it);
    assert.equal(c.getItemAncientCount(it), 4);
    assert.equal(it.ancientForgeCount, 2);
    assert.equal(c.divineForgeAncientOrders(it), '12');
    assert.ok(naturalKeys.every(key => !it.affixes.find(a => a.key === key).ancientForgeOrder));
    assert.ok(c.divineForgeAncientCandidates(it).length > 0);
    const before = JSON.stringify(c.G);
    assert.ok(c.forgePlaceItem(it.id));
    assert.equal(JSON.stringify(c.G), before);
    c.G.inventory.splice(c.G.inventory.indexOf(it), 1); c.G.forge.slots[0] = it;
    const forged = JSON.stringify(c.G);
    assert.ok(c.startForge()); assert.ok(c.doForge());
    assert.equal(JSON.stringify(c.G), forged);
  });
}

test('精鑄先後順序由成功時間決定，洗煉單條／全部與存讀不重置額度或分色', () => {
  const { c, it } = setup();
  c.pick = values => values[values.length - 1]; cast(c, it);
  c.pick = values => values[0]; cast(c, it);
  assert.equal(it.affixes[0].ancientForgeOrder, 2);
  assert.equal(it.affixes[it.affixes.length - 1].ancientForgeOrder, 1);
  const orders = it.affixes.map(a => a.ancientForgeOrder || 0);
  assert.equal(c.rerollSingleAffix(it, it.affixes[0].key), null);
  assert.deepEqual(it.affixes.map(a => a.ancientForgeOrder || 0), orders);
  assert.equal(c.rerollItemAffixes(it), null);
  assert.deepEqual(it.affixes.map(a => a.ancientForgeOrder || 0), orders);
  c.G = c.migrateSave(JSON.parse(JSON.stringify(c.G)));
  const loaded = c.G.inventory.find(a => a.id === it.id);
  assert.equal(loaded.ancientForgeCount, 2);
  assert.deepEqual(Array.from(loaded.affixes, a => a.ancientForgeOrder || 0), Array.from(orders));
  assert.ok(c.forgePlaceItem(loaded.id));
  loadUiHelpers(c);
  const html = c.itemDetailHTML(loaded, null, {});
  assert.match(html, /ancient-forged-first/); assert.match(html, /ancient-forged-second/);
  const badge = c.ancientStarBadgeHTML(loaded);
  assert.match(badge, /ancient-forged-first/); assert.match(badge, /ancient-forged-second/);
});

test('精鑄刻印附加詞條也計入額度與分色，重刻印不退回已用額度', () => {
  const { c, it } = setup();
  it.imprint = { kind: 'extraAffix', affix: { key: 'hpFlat', roll: 100, ancient: false } };
  c.pick = values => values[values.length - 1]; cast(c, it);
  assert.equal(it.imprint.kind, 'extraAncient');
  assert.equal(it.imprint.affix.ancientForgeOrder, 1);
  assert.equal(c.getItemAncientCount(it), 1);
  assert.match(c.itemDetailHTML(it, null, {}), /it-imprint ancient-forged-first/);
  c.pick = values => values[0]; cast(c, it);
  c.wpick = () => 'refund'; c.forgeApplyImprint(it, 0);
  assert.equal(c.divineForgeAncientOrders(it), '2');
  assert.equal(c.getItemAncientCount(it), 1);
  assert.ok(c.forgePlaceItem(it.id));
  loadUiHelpers(c);
  const badge = c.ancientStarBadgeHTML(it);
  assert.doesNotMatch(badge, /ancient-forged-first/); assert.match(badge, /ancient-forged-second/);
});

test('舊資料保留自然太古及原色，不推測來源；滿太古仍拒絕', () => {
  const { c, it } = setup(9, 3);
  loadUiHelpers(c);
  assert.equal(c.divineForgeAncientCount(it), 0);
  assert.equal(c.divineForgeAncientOrders(it), '');
  assert.doesNotMatch(c.itemDetailHTML(it, null, {}), /ancient-forged-(first|second)/);
  assert.doesNotMatch(c.ancientStarBadgeHTML(it), /ancient-forged-(first|second)/);
  assert.equal(c.divineForgeItemEligible(it, 'ancient'), true);
  it.affixes.forEach(a => { a.ancient = true; });
  assert.ok(c.forgePlaceItem(it.id));
});

test('正式Worker投影、存讀與UI更新保留精鑄兩色；超過七顆仍顯示兩色', () => {
  const e = createEngine({ seed: 8 }).boot(null), c = e.ctx;
  c.G.player.reincarnations = 5; c.G.player.gold = 1e12; c.G.player.dust = 100;
  c.runCommand('forge.setOperation', { mode: 'ancient' });
  const it = c.makeEquipment(300, { rarity: 10, slot: 'helmet', ancientCount: 6 });
  c.G.inventory.push(it); c.chance = () => true;
  for (let i = 0; i < 2; i++) {
    assert.equal(c.runCommand('forge.placeItem', { itemId: it.id }).result, null);
    assert.equal(c.runCommand('forge.start', {}).result, null);
    c.forgeTick(c.G.forge.crafting.startedAt + 3000);
  }
  const summary = c.inventoryCellView(it);
  assert.equal(summary.ancientCount, 8);
  assert.equal(summary.ancientForgeCount, 2);
  assert.equal(summary.ancientForgeOrders, '12');
  assert.equal(summary.affixes, undefined);
  assert.equal(c.divineForgeItemEligible(summary, 'ancient'), false);
  const loaded = createEngine({ seed: 8 }).boot(JSON.parse(e.saveJson())).ctx;
  assert.equal(loaded.G.inventory.find(x => x.id === it.id).ancientForgeCount, 2);
  loadUiHelpers(c);
  const badge = c.ancientStarBadgeHTML(summary);
  assert.equal((badge.match(/✡/g) || []).length, 7);
  assert.match(badge, /ancient-forged-first/); assert.match(badge, /ancient-forged-second/);
  const view = item => ({ count: 1, cap: 10, items: [item] });
  assert.equal(c.inventoryGridSnapshotEqual(view(summary), view({ ...summary })), true);
  assert.equal(c.inventoryGridSnapshotEqual(view(summary), view({ ...summary, ancientForgeOrders: '2' })), false);
  assert.equal(c.inventoryGridSnapshotEqual(view(summary), view({ ...summary, ancientForgeCount: 1 })), false);
});
