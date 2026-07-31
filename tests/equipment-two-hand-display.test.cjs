'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

function functionBody(name) {
  const start = ui.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const open = ui.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < ui.length; i++) {
    if (ui[i] === '{') depth++;
    if (ui[i] === '}' && --depth === 0) return ui.slice(start, i + 1);
  }
  assert.fail('unterminated function ' + name);
}

test('雙手武器在副手欄顯示同一把武器，但仍以視覺 duplicate 標記', () => {
  const twoHand = { id: 'greatsword-1', slot: 'weapon', weaponType: 'greatsword2h', rarity: 0 };
  const equipGrid = { innerHTML: '' };
  const context = {
    SLOT_LIST: ['weapon', 'weapon2'],
    SLOT_INFO: {
      weapon: { icon: 'icon_weapon.png', emoji: '⚔️' },
      weapon2: { icon: 'icon_weapon.png', emoji: '⚔️' }
    },
    GODFORGED_IDX: 8,
    RARITIES: [{ color: '#9aa5b1' }],
    uiEquipPanelSnapshot: () => ({ equipView: 0, equipActive: 0, sets: [{ weapon: twoHand, weapon2: null }] }),
    uiHeaderPanelSnapshot: () => ({ player: {} }),
    equipViewEquipment: (snapshot) => snapshot.sets[0],
    isTwoHandItem: (item) => !!item && item.weaponType === 'greatsword2h',
    ancientStarBadgeHTML: () => '',
    renderEquipSetTabs: () => {},
    renderDetail: () => {},
    $id: (id) => id === 'equip-grid' ? equipGrid : null
  };
  vm.createContext(context);
  vm.runInContext(functionBody('renderEquip'), context);
  context.renderEquip();

  const html = equipGrid.innerHTML;
  assert.equal((html.match(/data-id="greatsword-1"/g) || []).length, 2);
  assert.match(html, /class="eq-slot filled[^" ]* twohand-duplicate slot-weapon2"/);
  assert.match(html, /data-slot="weapon2"/);
  assert.doesNotMatch(html, /slot-weapon2[^>]*twohand-occupied/);
});

test('雙手武器副手 duplicate 使用淡紅提示樣式', () => {
  assert.match(css, /\.eq-slot\.twohand-duplicate\s*\{[\s\S]*border-color:\s*#f87171\s*!important/);
  assert.match(css, /\.eq-slot\.twohand-duplicate::after\s*\{[\s\S]*background:\s*rgba\(185,\s*28,\s*28,/);
});
