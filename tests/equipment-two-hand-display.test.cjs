'use strict';

const test = require('node:test');
const { readExpanded } = require('./helpers/str-expand.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ui = readExpanded(path.join(root, 'js', 'ui.js'));
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
    RARITIES: Array.from({ length: 12 }, (_, i) => ({ color: 'rarity-' + i })),
    uiEquipPanelSnapshot: () => ({ equipView: 0, equipActive: 0, sets: [{ weapon: twoHand, weapon2: null }] }),
    uiHeaderPanelSnapshot: () => ({ player: {} }),
    equipViewEquipment: (snapshot) => snapshot.sets[0],
    isTwoHandItem: (item) => !!item && item.weaponType === 'greatsword2h',
    itemIconFile: (item, info) => info.icon,
    equipFlashActive: (slot) => slot === 'weapon2',
    ancientStarBadgeHTML: () => '',
    renderEquipSetTabs: () => {},
    renderDetail: () => {},
    syncEquipmentSelectionMemory: () => {},
    $id: (id) => id === 'equip-grid' ? equipGrid : null,
    // 修羅亂舞（js/skills2.js）沒生效＝副手仍由主手的雙手武器佔用，本測試驗的就是那個狀態
    uiAsuraDualWield: () => false
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8').match(/^function divineForgeBaseRarity[^\n]+/m)[0], context);
  vm.runInContext(functionBody('itemRarityEffectClass') + '\n' + functionBody('twoHandSharedBadgeHTML') + '\n' + functionBody('renderEquip'), context);
  context.renderEquip();

  const html = equipGrid.innerHTML;
  assert.equal((html.match(/data-id="greatsword-1"/g) || []).length, 2);
  assert.match(html, /class="eq-slot filled[^" ]* twohand-duplicate slot-weapon2"/);
  assert.match(html, /data-slot="weapon2"/);
  assert.match(html, /data-slot="weapon2"[^>]*>[\s\S]*equip-flash-overlay/);
  assert.doesNotMatch(html, /slot-weapon2[^>]*twohand-occupied/);
  assert.equal((html.match(/雙手共用/g) || []).length, 1);
  assert.match(html, /slot-weapon2[\s\S]*twohand-shared-tag/);
  for (const [base, forged] of [[6, 11], [7, 8], [9, 10]]) {
    twoHand.rarity = base;
    context.renderEquip();
    const original = equipGrid.innerHTML;
    twoHand.rarity = forged;
    context.renderEquip();
    assert.equal(equipGrid.innerHTML, original, 'main/off-hand appearance must match base rarity ' + base);
  }
});

test('雙手武器裝備成功時，主手與副手都進入閃光狀態', () => {
  const context = {
    UI: { equipFlashSlots: Object.create(null), equipFlashTimer: null, dirty: { equip: false } },
    isTwoHandItem: (item) => !!item && item.weaponType === 'greatsword2h',
    setTimeout: () => 1,
    clearTimeout: () => {}
  };
  context.UI_GAME_TIMING = context;
  vm.createContext(context);
  vm.runInContext(functionBody('equipFlashActive') + '\n' + functionBody('triggerEquipFlash'), context);

  context.triggerEquipFlash('weapon', { weaponType: 'greatsword2h' });

  assert.ok(context.UI.equipFlashSlots.weapon > Date.now());
  assert.ok(context.UI.equipFlashSlots.weapon2 > Date.now());
  assert.equal(context.UI.dirty.equip, true);
});

test('神話裝備共用淡金色，複製副手使用銀藍底與清楚可見的共用標記', () => {
  assert.match(css, /\.eq-slot\.twohand-duplicate\s*\{[\s\S]*border-color:\s*#f87171\s*!important/);
  assert.match(css, /\.eq-slot\.twohand-duplicate::after\s*\{[\s\S]*background:\s*rgba\(185,\s*28,\s*28,/);
  assert.match(css, /\.eq-slot\.eff-mythic\.twohand-duplicate\s*\{\s*outline:\s*none/);
  assert.match(css, /\.eq-slot\.eff-genesis\.twohand-duplicate\s*\{[\s\S]*outline-color:\s*#a5f3fc/);
  assert.match(css, /\.eq-slot\.eff-godforged\.twohand-duplicate\s*\{[\s\S]*outline-color:\s*#f5d0fe/);
  assert.match(css, /--mythic-surface-tint:\s*linear-gradient\(rgba\(253,\s*230,\s*138,\s*0\.28\)/);
  assert.match(css, /\.eff-mythic\.twohand-duplicate::after\s*\{\s*background:\s*var\(--mythic-slot-surface\)/);
  assert.match(css, /\.eff-mythic\.twohand-duplicate,[\s\S]*?--mythic-surface-base:\s*linear-gradient\(to bottom, #46565b, #2e3b40 64%, #334145 100%\)/);
  assert.match(css, /\.eq-slot\.twohand-duplicate \.eq-icon\s*\{\s*opacity:\s*0\.72/);
  assert.match(css, /\.eff-genesis\.twohand-duplicate::after\s*\{[\s\S]*linear-gradient\(rgba\(165,\s*243,\s*252,\s*0\.25\)/);
  assert.match(css, /\.eff-godforged\.twohand-duplicate::after\s*\{[\s\S]*linear-gradient\(rgba\(245,\s*208,\s*254,\s*0\.25\)/);
  assert.match(css, /\.eq-slot\.selected\.eff-mythic\.twohand-duplicate,[\s\S]*outline:\s*3px\s+solid\s+#fff/);
  assert.match(css, /\.eq-slot \.equip-flash-overlay\s*\{[\s\S]*animation:\s*equipSlotFlash\s+2s/);
  assert.match(css, /@keyframes\s+equipSlotFlash\s*\{/);
});
