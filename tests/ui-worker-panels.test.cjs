'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

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

test('寶石頁由 Worker panel 投影渲染並以 Command 修改狀態', () => {
  const renderGems = functionBody('renderGems');
  const renderShop = functionBody('renderGemShop');
  const countdown = functionBody('updateShopCountdown');

  assert.match(ui, /gems:\s*\['gems', 'header'\]/);
  assert.match(renderGems, /uiGemsPanelSnapshot\(\)/);
  assert.match(renderGems, /gemsViewCount\(gemsSnapshot,/);
  assert.doesNotMatch(renderShop, /\b(?:gemShop|rollGemShop|shopHourlyReset)\(/);
  assert.doesNotMatch(countdown, /\b(?:gemShop|shopHourlyReset)\(/);

  for (const command of [
    'gem.compose', 'gem.composeAll', 'gem.convert', 'gem.dismantle',
    'gem.dismantleAll', 'gem.dismantleFused', 'gem.fuse',
    'gem.shopBuy', 'gem.shopBuyAll', 'gem.shopRefresh', 'gem.shopUpgrade'
  ]) {
    assert.match(ui, new RegExp("sendGemUiCommand\\(\\s*'" + command.replace('.', '\\.') + "'"));
  }
});

test('裝備與背包頁由 Worker panel 投影渲染並以 Command 修改狀態', () => {
  const renderEquip = functionBody('renderEquip');
  const renderInventory = functionBody('renderInventory');
  const keywordFilter = functionBody('updateInventoryKeywordFilter');
  const detailAction = functionBody('detailAction');

  assert.match(ui, /equip:\s*\['equip', 'inv', 'gems', 'header'\]/);
  assert.match(renderEquip, /uiEquipPanelSnapshot\(\)/);
  assert.match(renderEquip, /equipViewEquipment\(equipSnapshot\)/);
  assert.doesNotMatch(renderEquip, /\bviewedEquipment\(/);
  assert.match(renderInventory, /uiInventoryPanelSnapshot\(\)/);
  assert.doesNotMatch(renderInventory, /\bG\.inventory\b/);

  assert.match(keywordFilter, /filterKeyword[\s\S]*requestPanelData\('inv', true, \{ full: true \}\)/);
  assert.match(ui, /WorkerBridge\.requestPanel\(key, requestParams\)/);
  assert.match(ui, /requestPanelData\('inv', true, \{ detailIds: \[/);

  for (const command of [
    'item.equip', 'item.unequip', 'item.setLock', 'item.salvage',
    'item.salvageBulk', 'item.upgrade', 'item.enchant',
    'item.removeEnchant', 'item.rerollAffix', 'gem.socket',
    'gem.socketFused', 'gem.unsocket', 'player.switchEquipSet',
    'player.setEquipView', 'player.renameEquipSet', 'player.buyInvUpgrade',
    'player.setInvSort', 'factory.setSalvageSettings'
  ]) {
    assert.match(
      ui,
      new RegExp("(?:sendUiCommand\\(\\s*|commandName\\s*=\\s*)'" + command.replace('.', '\\.') + "'")
    );
  }

  assert.match(detailAction, /if \(!it \|\| act === 'tosynth'\) return/);
  assert.match(ui, /sendUiCommand\('settings\.set', \{ key: 'compareEq'/);
  assert.match(ui, /sendUiCommand\('factory\.setAutoEquip'/);
  assert.match(ui, /var cell = e\.target\.closest\('\.item-cell, \.eq-slot'\);[\s\S]*?hideTooltip\(\);[\s\S]*?UI\.pendingItemTooltip = null;/);
  assert.match(ui, /var it = findItemById\(tooltipId, needsInventoryDetail\);[\s\S]*?if \(it\) \{ showItemTooltip\(it, eqCell\); return; \}/);
  assert.match(ui, /var inventoryGridUnchanged = msg\.name === 'inv'[\s\S]*?UI\.dirty\.inv = false[\s\S]*?renderDetail\(\);/);
  assert.match(ui, /var stillHoveringPending = UI\.hoveredItemTooltip[\s\S]*?stillHoveringPending/);
  assert.match(ui, /function selectionItemForGrid\(invSnapshot\)[\s\S]*?inventoryViewItem\(invSnapshot \|\| uiInventoryPanelSnapshot\(\), UI\.sel\.id, false\)/);
  assert.match(ui, /function updateSelectionUI\(\) \{\s*var selItem = selectionItemForGrid\(\);/);
  assert.match(ui, /if \(UI\.inventoryScrolling\) updateSelectionUI\(\);\s*else renderDetail\(\);/);
  assert.match(ui, /var wasAtScrollEnd = previousScrollTop >= maxScrollTop - 1[\s\S]*?startRow = wasAtScrollEnd[\s\S]*?box\.scrollTop = wasAtScrollEnd \? box\.scrollHeight/);
  assert.match(ui, /var virtualize = false;/);
});

test('頂欄只讀 Worker header Snapshot 的資源、屬性與 DPS', () => {
  const renderHeader = functionBody('renderHeader');
  const renderAttrPanel = functionBody('renderAttrPanel');

  assert.match(ui, /UI_PERSISTENT_PANEL_SUBSCRIPTIONS\s*=\s*\['talents', 'header', 'battle'\]/);
  assert.match(renderHeader, /uiHeaderPanelSnapshot\(\)/);
  assert.match(renderHeader, /headerSnapshot\.stats/);
  assert.match(renderHeader, /headerSnapshot\.viewStats \|\| st/);
  assert.match(renderHeader, /headerSnapshot\.dps/);
  assert.match(renderHeader, /headerSnapshot\.settings/);
  assert.match(renderHeader, /headerSnapshot\.autoEquip/);
  assert.match(renderHeader, /uiHeaderXpMax\(p\)/);
  assert.doesNotMatch(renderHeader, /\bgetStats\(/);
  assert.doesNotMatch(renderHeader, /\bgetViewStats\(/);
  assert.doesNotMatch(renderHeader, /\bcurrentDps\(/);
  assert.doesNotMatch(renderHeader, /\bG\./);

  assert.match(renderAttrPanel, /headerSnapshot\.equipView/);
  assert.match(renderAttrPanel, /headerSnapshot\.equipActive/);
  assert.doesNotMatch(renderAttrPanel, /\bG\.(?:equipView|equipActive)\b/);
});

test('Worker header uses the synchronized XP requirement after reincarnation', () => {
  const body = functionBody('uiHeaderXpMax');
  const context = {
    workerView: { xpMax: 35.8e9 },
    viewState: () => context.workerView,
    xpForLevel: (level) => level * 10
  };
  vm.createContext(context);
  vm.runInContext(body + '\nthis.uiHeaderXpMax = uiHeaderXpMax;', context);

  assert.equal(context.uiHeaderXpMax({ level: 564, reincarnations: 1 }), 35.8e9);

  context.workerView = {};
  assert.equal(context.uiHeaderXpMax({ level: 564 }), 5640);
});

test('背包只有摘要時，其他裝備 tooltip 會等待完整 detailIds', () => {
  const body = functionBody('inventoryViewItem');
  const context = { inventoryViewItems: (snapshot) => snapshot.items || [] };
  vm.createContext(context);
  vm.runInContext(body + '\nthis.inventoryViewItem = inventoryViewItem;', context);
  const summary = { id: 'other', slot: 'helmet', level: 10 };
  const detailed = { id: 'selected', slot: 'weapon', level: 20, affixes: [] };
  const snapshot = {
    items: [summary, detailed],
    details: { selected: detailed }
  };

  assert.equal(context.inventoryViewItem(snapshot, 'selected', true), detailed);
  assert.equal(context.inventoryViewItem(snapshot, 'other', true), null);
  assert.equal(context.inventoryViewItem(snapshot, 'other', false), summary);
});
