const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeElement() {
  return {
    innerHTML: '',
    textContent: '',
    options: [],
    children: [],
    insertBefore() {},
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    getAttribute() { return null; }
  };
}

function loadGameContext() {
  const root = path.resolve(__dirname, '..');
  const elements = new Map();
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const context = {
    console,
    UI: { dirty: {} },
    document: {
      getElementById,
      querySelectorAll() { return []; },
      addEventListener() {},
      createElement() { return makeElement(); }
    }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js', 'js/factory.js', 'js/ui.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return { context, elements };
}

function makePart(id, key, tier) {
  const defs = {
    speedGear: { name: '加速齒輪', perTier: 25 },
    scrapForge: { name: '碎片熔煉爐', perTier: 20 }
  };
  const def = defs[key];
  return {
    id,
    kind: 'part',
    key,
    tier,
    name: 'T' + tier + ' ' + def.name,
    val: def.perTier * tier
  };
}

test('分解槽可安裝 10 格並支援 T7 零件', () => {
  const { context } = loadGameContext();
  context.G = {
    player: { level: 1, scrap: 0 },
    factory: { parts: [], installed: { salvage: [], synth: [] } }
  };
  assert.equal(context.PART_MAX_TIER, 7);
  assert.equal(context.slotsForNode('salvage'), 10);
  assert.equal(context.PART_KEEP_PER_KEY, 10);
  assert.equal(context.makePart(7, 'salvage').tier, 7);
});

test('熔爐零件列表每種類只顯示一行，安裝取最高階級與數值（合併版 UI）', () => {
  const { context } = loadGameContext();
  const parts = [
    makePart('gear5', 'speedGear', 5),
    makePart('gear7', 'speedGear', 7),
    makePart('gear6', 'speedGear', 6),
    makePart('forge7', 'scrapForge', 7)
  ];
  context.G = {
    player: { level: 1, scrap: 0 },
    factory: { parts, installed: { salvage: [], synth: [] } }
  };

  // 舊分解槽零件列表已移除；同一「每種類一行、取最高階」行為改由熔爐卡片零件列表提供
  const fu = { id: 1, parts: [], partSlots: 3 };
  const html = context.nfPartsListHTML(fu);
  assert.match(html, /data-nf-partinstall-key="speedGear"/);
  assert.match(html, /T7 加速齒輪/, '應顯示最高階零件名稱');
  assert.equal((html.match(/data-nf-partinstall-key="speedGear"/g) || []).length, 1, '每種類只一行');
  assert.match(html, /data-nf-partinstall-key="scrapForge"/);
});

test('分解槽材料相關零件使用右上角同款材料圖示，非材料零件保留原圖示', () => {
  const { context } = loadGameContext();
  assert.match(context.partIconHTML('scrapForge'), /images\/icon_scrap\.png/);
  assert.match(context.partIconHTML('ancientEssenceRate'), /images\/icon_ancient_essence\.png/);
  assert.match(context.partIconHTML('duplicator'), /images\/icon_scrap\.png/);
  assert.match(context.partIconHTML('duplicator'), /images\/icon_gold\.png/);
  assert.equal(context.partIconHTML('speedGear'), '⚙️');
});

test('分解槽逐格解鎖公式保留（舊介面已移除，零件格改於各熔爐解鎖）', () => {
  const { context } = loadGameContext();
  context.G = {
    player: { level: 1, gold: 10000, scrap: 0 },
    factory: { parts: [], installed: { salvage: [], synth: [] }, salvageSlots: 10 }
  };
  assert.equal(context.SALVAGE_SLOT_MAX, 20);
  assert.equal(context.salvageSlotUnlockCost(10), 590490000);
  assert.equal(context.salvageSlotUnlockCost(19), 11622614670000);
  assert.equal(context.salvageSlotUnlockCost(20), 0);
  context.G.player.gold = 590490000;
  assert.equal(context.expandSalvageSlot(), null);
  assert.equal(context.G.factory.salvageSlots, 11);
  assert.equal(context.G.player.gold, 0);
  // 舊分解槽 UI（renderInstalledParts / data-salvage-expand）已隨合併移除
  const ui = fs.readFileSync(path.join(__dirname, '..', 'js/ui.js'), 'utf8');
  assert.ok(!/data-salvage-expand/.test(ui));
});

test('擴充分解槽沒有冷卻，成功後立即更新槽位與金幣狀態', () => {
  const { context } = loadGameContext();
  context.G = {
    player: { level: 1, gold: 590490000, scrap: 0 },
    factory: { parts: [], installed: { salvage: [], synth: [] }, salvageSlots: 10 }
  };
  assert.equal(context.expandSalvageSlot(), null);
  assert.equal(context.G.factory.salvageSlots, 11);
  assert.equal(context.G.player.gold, 0);
  assert.equal(context.salvageSlotUnlockCost(context.G.factory.salvageSlots), 1771470000);
});
