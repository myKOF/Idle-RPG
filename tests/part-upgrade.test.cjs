const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext(files) {
  const context = {
    console,
    Math: Object.create(Math),
    UI: { dirty: {}, sel: null },
    document: { addEventListener() {}, getElementById() { return null; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, key() { return null; }, length: 0 },
    location: { hostname: '127.0.0.1', reload() {} },
    setTimeout() {},
    clearTimeout() {},
    Date,
    JSON,
  };
  context.window = context;
  context.flog = () => {};
  context.blog = () => {};
  vm.createContext(context);
  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

const LOGIC_FILES = [
  'js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/item.js',
  'js/player.js', 'js/factory.js', 'js/newforge.js'
];

test('新遊戲所有零件從 T1 開始，效果使用 base + perLevel', () => {
  const c = loadContext(LOGIC_FILES);
  const state = c.newGameState();
  Object.keys(c.PART_TYPES).forEach((key) => {
    assert.equal(state.factory.partLevels[key], 1);
    assert.equal(c.partValueForLevel(key, 1), c.PART_TYPES[key].base);
    assert.equal(
      c.partValueForLevel(key, 10),
      Math.round((c.PART_TYPES[key].base + c.PART_TYPES[key].perLevel * 9) * 100) / 100
    );
  });
  assert.equal(c.PART_MAX_TIER, 10);
});

test('零件升級費用用升級後目標等級計算，且滿級停止', () => {
  const c = loadContext(LOGIC_FILES);
  const expectedCost = (level) => c.PART_UPGRADE_COST_A +
    c.PART_UPGRADE_COST_B * Math.pow(c.PART_UPGRADE_COST_C, level);
  assert.equal(c.partUpgradeCost(2), expectedCost(2));
  assert.equal(c.partUpgradeCost(6), expectedCost(6));

  const state = c.newGameState();
  c.G = state;
  const targetCost = c.partUpgradeCost(2);
  state.player.gold = targetCost + 100;
  assert.equal(c.newForgeUpgradePart('scrapForge'), null);
  assert.equal(state.factory.partLevels.scrapForge, 2);
  assert.equal(state.player.gold, 100);

  state.factory.partLevels.scrapForge = c.PART_MAX_TIER;
  assert.match(String(c.newForgeUpgradePart('scrapForge')), /上限/);
  assert.equal(state.player.gold, 100);
});

test('已裝配零件升級後，所有熔爐同種類效果立即同步', () => {
  const c = loadContext(LOGIC_FILES);
  const state = c.newGameState();
  c.G = state;
  const first = state.newForge.furnaces[0];
  assert.equal(c.addNewForgeFurnace(), null);
  const second = state.newForge.furnaces[1];
  assert.equal(c.newForgeInstallPart(first.id, 'scrapForge'), null);
  assert.equal(c.newForgeInstallPart(second.id, 'scrapForge'), null);
  assert.equal(c.newForgePartBonus(first, 'scrapForge'), 20);
  assert.equal(c.newForgePartBonus(second, 'scrapForge'), 20);

  state.player.gold = c.partUpgradeCost(2);
  assert.equal(c.newForgeUpgradePart('scrapForge'), null);
  // 熔爐只保存 key；升級後加成直接讀全域等級，因此所有熔爐立即生效。
  assert.equal(c.newForgePartBonus(first, 'scrapForge'), 40);
  assert.equal(c.newForgePartBonus(second, 'scrapForge'), 40);
  assert.equal(first.parts[0].key, 'scrapForge');
  assert.equal(Object.keys(first.parts[0]).length, 1);
  assert.equal(Object.keys(second.parts[0]).length, 1);
});

test('載入舊存檔時，熔爐零件快照會正規化為只保存 key', () => {
  const c = loadContext(LOGIC_FILES.concat(['js/save.js']));
  const state = c.newGameState();
  c.G = state;
  state.factory.partLevels.extractLens = 2;
  state.newForge.furnaces[0].parts = [{ key: 'extractLens', tier: 1 }];

  c.migrateSave(state);

  assert.equal(state.newForge.furnaces[0].parts[0].key, 'extractLens');
  assert.equal(Object.keys(state.newForge.furnaces[0].parts[0]).length, 1);
  assert.equal(c.newForgePartBonus(state.newForge.furnaces[0], 'extractLens'), 40);
});

test('野外、離線與高塔流程不再包含零件掉落或隨機階級', () => {
  ['js/status.js', 'js/combat.js', 'js/save.js', 'js/tower.js'].forEach((file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /fieldPartTierFor|partRate|partChance/);
  });
  const zoneCsv = fs.readFileSync(path.join(root, 'config/CSV/Zone_Stage_Drops.csv'), 'utf8');
  assert.doesNotMatch(zoneCsv, /工坊零件掉落率/);
});
