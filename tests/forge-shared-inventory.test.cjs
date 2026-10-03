/* 神鑄頁借用裝備頁的背包框（2026-10）。

   神鑄頁原本有自己的第二份背包格線，表頭、格子樣式、排序與篩選各走各的。
   改成同一個 #inv-section-box 在兩頁之間搬動；這裡守住「只有一份」與兩頁的差異點。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const ashen = fs.readFileSync(path.join(root, 'css/ashen-forge.css'), 'utf8');

function functionBody(name) {
  const start = uiSource.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const open = uiSource.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < uiSource.length; i++) {
    if (uiSource[i] === '{') depth++;
    if (uiSource[i] === '}' && --depth === 0) return uiSource.slice(start, i + 1);
  }
  assert.fail('unterminated function ' + name);
}

function forgeSection() {
  const start = html.indexOf('<section id="tab-forge"');
  const end = html.indexOf('</section>', start);
  assert.ok(start >= 0 && end > start, '找不到神鑄分頁');
  return html.slice(start, end);
}

test('SHINV-1 神鑄頁沒有第二份背包格線，只留借用插槽與寶石框', () => {
  const forge = forgeSection();
  assert.match(forge, /id="forge-inv-slot"/);
  assert.match(forge, /id="forge-gem-grid"/);
  assert.doesNotMatch(html, /forge-inventory-grid|forge-inv-count|id="forge-inv-box"/);
  assert.doesNotMatch(uiSource, /forge-inventory-grid|forge-inv-count|renderForgeInventoryCells/);
  // 背包框只有一個，而且仍然寫在裝備頁裡（開機時在裝備頁）
  assert.equal(html.split('id="inv-section-box"').length - 1, 1);
  const equipStart = html.indexOf('<section id="tab-equip"');
  const equipEnd = html.indexOf('</section>', equipStart);
  assert.ok(html.indexOf('id="inv-section-box"') > equipStart && html.indexOf('id="inv-section-box"') < equipEnd);
});

test('SHINV-2 裝備／寶石切換移到法陣面板頂端，不放在背包表頭', () => {
  const forge = forgeSection();
  const head = forge.slice(forge.indexOf('class="forge-head"'), forge.indexOf('id="forge-stage"'));
  assert.match(head, /id="forge-invtab-items"/);
  assert.match(head, /id="forge-invtab-gems"/);
});

function fakeNode(id) {
  const node = {
    id,
    parentNode: null,
    children: [],
    get nextSibling() {
      if (!this.parentNode) return null;
      const list = this.parentNode.children;
      return list[list.indexOf(this) + 1] || null;
    },
    insertBefore(child, ref) {
      if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
      const at = ref ? this.children.indexOf(ref) : -1;
      if (at >= 0) this.children.splice(at, 0, child);
      else this.children.push(child);
      child.parentNode = this;
      return child;
    },
    appendChild(child) { return this.insertBefore(child, null); }
  };
  return node;
}

test('SHINV-3 切到神鑄頁時背包框搬進插槽，離開後放回裝備頁原位', () => {
  const equipTab = fakeNode('tab-equip');
  const top = fakeNode('equip-top');
  const box = fakeNode('inv-section-box');
  const tail = fakeNode('equip-tail');
  equipTab.appendChild(top);
  equipTab.appendChild(box);
  equipTab.appendChild(tail);
  const slot = fakeNode('forge-inv-slot');
  const grid = { _invGridColumns: 14 };
  const nodes = { 'inv-section-box': box, 'forge-inv-slot': slot, 'inventory-grid': grid };
  const context = { UI: { dirty: {} }, $id: (id) => nodes[id] || null };
  vm.createContext(context);
  vm.runInContext('var _invBoxHome = null;\n' + functionBody('invalidateInventoryGridColumns') + '\n' + functionBody('mountInventoryBox'), context);

  context.mountInventoryBox(true);
  assert.equal(box.parentNode, slot);
  assert.deepEqual(equipTab.children.map((n) => n.id), ['equip-top', 'equip-tail']);
  assert.equal(grid._invGridColumns, 0, '換容器後欄數快取要作廢');
  assert.equal(context.UI.dirty.inv, true);

  context.UI.dirty.inv = false;
  context.mountInventoryBox(true);
  assert.equal(context.UI.dirty.inv, false, '已經在神鑄頁就不重搬、不重畫');

  context.mountInventoryBox(false);
  assert.deepEqual(equipTab.children.map((n) => n.id), ['equip-top', 'inv-section-box', 'equip-tail']);
  assert.deepEqual(slot.children, []);
});

test('SHINV-4 switchTab 每次都決定背包框掛在哪一頁', () => {
  assert.match(functionBody('switchTab'), /mountInventoryBox\(name === 'forge'\)/);
});

test('SHINV-5 神鑄頁的格子點擊是放入法陣、不可鑄造品質置灰，且不畫裝備詳情', () => {
  const body = functionBody('renderInventory');
  assert.match(body, /itemCellHTML\(it, 'forgeinv', dimClass, forgePendingKey\)/);
  assert.match(body, /isForgeableEquipmentRarity\(it\.rarity\)\) dimClass \+= ' forge-na'/);
  assert.match(body, /if \(inventoryForgeMode\(\)\) return;\s*if \(UI\.inventoryScrolling\) updateSelectionUI\(\);/);
  // 寶石神鑄時背包框藏起來，裝備神鑄才畫背包
  assert.match(functionBody('renderForge'), /if \(invTab !== 'gems'\) \{[\s\S]*?renderInventory\(\);/);
});

function fakeCell(classes, attrs) {
  const set = new Set(classes);
  return {
    classList: {
      add: (...n) => n.forEach((x) => set.add(x)),
      remove: (...n) => n.forEach((x) => set.delete(x)),
      contains: (x) => set.has(x)
    },
    getAttribute: (n) => attrs[n] || null,
    has: (x) => set.has(x)
  };
}

test('SHINV-6 裝備頁的選取不會把神鑄頁借用的背包格置灰', () => {
  const context = {
    UI: { tab: 'forge', sel: { source: 'equip-slot', slot: 'chest' } },
    slotTypeOf: (slot) => slot,
    isTwoHandItem: () => false,
    uiEquipTargetSlotFromSnapshot: () => 'chest',
    uiInventoryPanelSnapshot: () => null,
    uiEquipPanelSnapshot: () => null,
    equipViewEquipment: () => ({})
  };
  vm.createContext(context);
  const start = uiSource.indexOf('function equipSlotType');
  const end = uiSource.indexOf('function showFloatingText', start);
  vm.runInContext(uiSource.slice(start, end), context);
  const helmet = fakeCell(['item-cell', 'dimmed'], { 'data-slot': 'helmet', 'data-src': 'forgeinv' });
  context.findSelItem = () => null;
  context.document = { querySelectorAll: () => [helmet] };

  context.updateSelectionUI();
  assert.equal(helmet.has('dimmed'), false, '神鑄頁：舊的置灰要清掉、也不再加上');

  context.UI.tab = 'equip';
  context.updateSelectionUI();
  assert.equal(helmet.has('dimmed'), true, '裝備頁：不同部位照舊置灰');
});

test('SHINV-7 扁平背包樣式掛在背包框本身，搬到神鑄頁也帶著走', () => {
  assert.doesNotMatch(ashen, /#tab-equip\s+#inv-section-box|#tab-equip\s+#inventory-grid|#tab-equip\s+\.inv-head|#tab-equip\s+#btn-salvage-settings|#tab-equip\s+#inv-filter-btn/);
  assert.match(ashen, /#inventory-grid \.item-cell,\n#forge-gem-grid \.item-cell \{\n  border-width: 1px !important;/);
});
