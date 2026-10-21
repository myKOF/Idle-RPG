'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');

function tooltip(sourceName, item, target, checked = true, equippedRarity = 5, config = {}) {
  const tip = { style: {}, offsetWidth: 560, offsetHeight: 300 };
  const cards = [];
  const eq = { ring: { id: 'ring-worn-1' }, ring2: { id: 'ring-worn-2' }, chest: { id: 'chest-worn' }, weapon: { id: 'weapon-worn' } };
  Object.values(eq).forEach(it => { it.rarity = equippedRarity; });
  if (config.mainHand) eq.weapon = config.mainHand;
  if (config.offHand) eq.weapon2 = config.offHand;
  const c = {
    UI: {}, window: { innerWidth: 1400, innerHeight: 900 },
    $id: id => id === 'sk-tooltip' ? tip : { checked },
    uiInventoryPanelSnapshot: () => ({ viewEquipment: eq }),
    uiHeaderPanelSnapshot: () => ({ player: { gold: 100, essence: 10 } }),
    uiEquipPanelSnapshot: () => ({ sets: [eq] }),
    equipViewEquipment: () => eq,
    uiAsuraDualWield: () => !!config.asura,
    isTwoHandItem: it => it && it.weaponType === 'axe2h',
    uiEquipTargetSlotFromSnapshot: () => target,
    itemDetailHTML(it, unused, opts) { cards.push({ id: it.id, equipped: !!opts.isEquipped }); return '<div>' + it.id + '</div>'; }
  };
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('function twoHandSharedBadgeHTML('), source.indexOf('function renderEquip(')), c);
  vm.runInContext(source.slice(source.indexOf('function showItemTooltip('), source.indexOf('function showTowerTooltip(')), c);
  c.showItemTooltip(item, { getAttribute: name => name === 'data-src' ? sourceName : name === 'data-slot' ? target : null, getBoundingClientRect: () => ({ left: 10, right: 60, top: 40 }) });
  return { tip, cards };
}

test('身上兩枚戒指及其他已穿裝備一律只顯示自身詳情', () => {
  for (const [id, target] of [['ring-worn-1', 'ring2'], ['ring-worn-2', 'ring'], ['chest-worn', 'ring']]) {
    const result = tooltip('equip', { id }, target);
    assert.deepEqual(result.cards, [{ id, equipped: false }]);
    assert.doesNotMatch(result.tip.innerHTML, /equip-compare-container/);
  }
});

test('背包戒指仍可與任一原目標戒指槽比較，一般裝備及武器同樣保留比較', () => {
  for (const [target, expected] of [['ring', 'ring-worn-1'], ['ring2', 'ring-worn-2'], ['chest', 'chest-worn'], ['weapon', 'weapon-worn']]) {
    const result = tooltip('inv', { id: 'candidate' }, target);
    assert.deepEqual(result.cards, [{ id: 'candidate', equipped: false }, { id: expected, equipped: true }]);
    assert.match(result.tip.innerHTML, /equip-compare-container/);
  }
});

test('神鑄頁背包格沿用比較，法陣槽及無來源提示不作裝備比較', () => {
  assert.equal(tooltip('forgeinv', { id: 'candidate' }, 'ring').cards.length, 2);
  for (const src of [null, 'forge', 'equip-slot']) {
    assert.equal(tooltip(src, { id: 'candidate' }, 'ring').cards.length, 1);
  }
});

test('關閉比較、空目標槽或相同裝備維持單卡', () => {
  assert.equal(tooltip('inv', { id: 'candidate' }, 'ring', false).cards.length, 1);
  assert.equal(tooltip('inv', { id: 'candidate' }, 'helmet').cards.length, 1);
  assert.equal(tooltip('inv', { id: 'ring-worn-1' }, 'ring').cards.length, 1);
});

test('混合品質比較各自保留神話框，單卡及其他高品質不誤用神話樣式', () => {
  const classes = result => Array.from(result.tip.innerHTML.matchAll(/class="(equip-detail-card[^"]*)"/g), m => m[1]);
  for (let rarity = 0; rarity <= 8; rarity++) {
    const item = { id: 'candidate', rarity };
    const expected = rarity === 6 ? 'equip-detail-card mythic-detail' : 'equip-detail-card';
    assert.deepEqual(classes(tooltip('equip', item, 'weapon')), [expected]);
    assert.deepEqual(classes(tooltip('inv', item, 'weapon', true, 6)), [expected, 'equip-detail-card mythic-detail']);
    assert.deepEqual(classes(tooltip('inv', item, 'weapon', true, 5)), [expected, 'equip-detail-card']);
  }
});

test('只有複製副手的tips使用共用標記，主手、背包與實裝副手不誤標', () => {
  const weapon = { id: 'twohand-axe', rarity: 6, weaponType: 'axe2h' };
  const render = (src, slot, extra = {}) => tooltip(src, weapon, slot, true, 6, { mainHand: weapon, ...extra }).tip.innerHTML;
  assert.match(render('equip', 'weapon2'), /class="equip-detail-card mythic-detail twohand-shared"/);
  assert.equal((render('equip', 'weapon2').match(/雙手共用/g) || []).length, 1);
  for (const html of [render('equip', 'weapon'), render('inv', 'weapon2'), render('forgeinv', 'weapon2'),
    render('equip', 'weapon2', { asura: true }), render('equip', 'weapon2', { offHand: { id: 'other' } }),
    render('equip', 'weapon2', { mainHand: { ...weapon, id: 'changed' } })]) {
    assert.doesNotMatch(html, /twohand-shared|雙手共用/);
  }
});
