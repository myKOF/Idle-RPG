const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const uiSource = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

function loadSelectionHelpers() {
  const context = {
    UI: { sel: null },
    slotTypeOf: (slot) => slot === 'weapon2' ? 'weapon' : slot,
    equipTargetSlot: () => 'weapon2'
  };
  vm.createContext(context);
  const start = uiSource.indexOf('function equipSlotType');
  const end = uiSource.indexOf('function showFloatingText', start);
  assert.ok(start >= 0, 'selection helpers should exist');
  assert.ok(end > start, 'selection helper block should be complete');
  vm.runInContext(uiSource.slice(start, end), context);
  return context;
}

function fakeElement(classes, attrs) {
  const classSet = new Set(classes);
  return {
    classList: {
      add: (...names) => names.forEach((name) => classSet.add(name)),
      remove: (...names) => names.forEach((name) => classSet.delete(name)),
      contains: (name) => classSet.has(name)
    },
    getAttribute: (name) => attrs[name] || null,
    hasClass: (name) => classSet.has(name)
  };
}

test('空裝備部位會保留部位選取，且武器副欄仍匹配背包武器', () => {
  const context = loadSelectionHelpers();

  context.UI.sel = { source: 'equip-slot', slot: 'weapon2' };
  assert.equal(context.selectionSlotForItem(null), 'weapon2');
  assert.equal(context.equipSlotMatches('weapon', 'weapon2'), true);
  assert.equal(context.equipSlotMatches('ring', 'weapon2'), false);
});

test('背包裝備選取仍以裝備目標部位作為裝備欄高亮部位', () => {
  const context = loadSelectionHelpers();
  context.UI.sel = { id: 'inventory-weapon', source: 'inv' };

  assert.equal(context.selectionSlotForItem({ slot: 'weapon' }), 'weapon2');
});

test('選取空部位時，同部位背包亮起、不同部位背包灰化', () => {
  const context = loadSelectionHelpers();
  const emptyChest = fakeElement(['eq-slot', 'empty'], { 'data-slot': 'chest' });
  const chestItem = fakeElement(['item-cell'], { 'data-slot': 'chest' });
  const helmetItem = fakeElement(['item-cell'], { 'data-slot': 'helmet' });
  context.UI.sel = { source: 'equip-slot', slot: 'chest' };
  context.findSelItem = () => null;
  context.document = {
    querySelectorAll: (selector) => selector === '.item-cell, .eq-slot'
      ? [emptyChest, chestItem, helmetItem]
      : [chestItem, helmetItem]
  };

  context.updateSelectionUI();

  assert.equal(emptyChest.hasClass('selected'), true);
  assert.equal(chestItem.hasClass('selected'), true);
  assert.equal(chestItem.hasClass('dimmed'), false);
  assert.equal(helmetItem.hasClass('selected'), false);
  assert.equal(helmetItem.hasClass('dimmed'), true);
});

test('空裝備格可點擊，且選取樣式套用於空格', () => {
  const ui = uiSource;
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

  assert.match(ui, /if \(cell\.classList\.contains\('empty'\)\) \{[\s\S]*var emptySlot = cell\.getAttribute\('data-slot'\)[\s\S]*UI\.sel = \{ source: 'equip-slot', slot: emptySlot \}/);
  assert.match(ui, /if \(selectedSlot && el\.classList\.contains\('eq-slot'\) && el\.getAttribute\('data-slot'\) === selectedSlot\)/);
  assert.match(css, /\.eq-slot\.empty\s*\{[\s\S]*cursor:\s*pointer/);
});
