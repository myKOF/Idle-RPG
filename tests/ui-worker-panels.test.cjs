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
  /* ---- 虛擬捲動 ----
     舊斷言盯的是「寫死 virtualize = false」與那段把 box.scrollTop 寫回去的程式碼。
     後者正是「拖曳捲軸到底時視窗會跳」的成因（渲染與使用者的拖曳互搶捲動位置），
     虛擬捲動當初就是為了它被關掉的。現在改成：超過門檻才虛擬化、視窗由捲動位置推導、
     上下墊片撐出完整捲動高度，而且 **renderInventory 一行都不准寫 scrollTop**。
     最後這條是防止舊 bug 復活的關鍵，比原本的形狀斷言更嚴格。 */
  assert.match(ui, /var virtualize = inventoryItems\.length > INVENTORY_VIRTUAL_MIN_ITEMS;/);
  assert.match(ui, /startRow = Math\.min\(maxStartRow,[\s\S]*?Math\.floor\(top \/ rowHeight\) - INVENTORY_VIRTUAL_BUFFER_ROWS\)\);/);
  /* 版面讀取必須排在所有 DOM 寫入之前。渲染中途才讀捲動位置，等於在自己剛造成的
     髒版面上強制重排一次，而那筆成本隨文件大小成長——這是實際量到過的迴歸來源。 */
  const scrollReadAt = renderInventory.indexOf('gridBox.scrollTop');
  const firstWriteAt = Math.min.apply(null, ['innerHTML =', 'textContent =', 'style.display =']
    .map((token) => {
      const at = renderInventory.indexOf(token);
      return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    }));
  assert.ok(scrollReadAt >= 0, 'renderInventory 應在進入時就讀好捲動位置');
  assert.ok(scrollReadAt < firstWriteAt, 'renderInventory 必須在任何 DOM 寫入之前讀取捲動位置');
  assert.match(ui, /cellKeys\.unshift\('__inv-spacer-top'\);[\s\S]*?cellKeys\.push\('__inv-spacer-bottom'\);/);
  // 原始碼不得含控制字元（這條斷言是被真的踩到才加的：墊片鍵值曾誤植 NUL 位元組）
  var controlCharIndex = Array.prototype.findIndex.call(ui, function (ch) {
    var code = ch.charCodeAt(0);
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  });
  assert.equal(controlCharIndex, -1, 'js/ui.js 不得含控制字元，出現在位置 ' + controlCharIndex);
  assert.doesNotMatch(renderInventory, /box\.scrollTop\s*=/);
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
