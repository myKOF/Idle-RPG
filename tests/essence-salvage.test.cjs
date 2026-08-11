const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadFormulaContext() {
  const context = { console, Math, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function loadSaveContext() {
  const context = {
    console, Math, Date,
    window: {},
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
      key() { return null; },
      length: 0
    }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/player.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('附魔精華拆解基礎機率依裝備品質表計算', () => {
  const context = loadFormulaContext();
  // CSV: config/CSV/game_parameters.csv:195（普通至神鑄創世）。
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7, 8].map(context.essenceSalvageChanceForRarity),
    [5, 7.5, 10, 15, 20, 25, 30, 100, 100]
  );
});

test('T7 精粹透鏡每個提供 140% 附魔精華加成，且不再被掉寶率減半', () => {
  const context = loadFormulaContext();
  assert.equal(context.PART_TYPES.extractLens.base, 20);
  assert.equal(context.PART_TYPES.extractLens.perLevel, 20);
  assert.equal(context.partValueForLevel('extractLens', 7), 140);
  assert.equal(context.effectivePartEffectValue('extractLens', 140), 140);
  assert.equal(context.effectivePartEffectValue('extractLens', 1400), 1400);
  assert.equal(context.PART_TYPES.essenceCoil, undefined);
  assert.equal(context.PART_TYPES.gemSieve, undefined);
  assert.equal(context.PART_TYPES.gemPurifier, undefined);
  assert.equal(context.PART_TYPES.bookScavenger, undefined);
  assert.equal(context.PART_TYPES.duplicator, undefined);
  assert.equal(context.PART_TYPES.prospector, undefined);
  assert.equal(context.PART_TYPES.luckCore, undefined);
  assert.equal(context.PART_TYPES.rerollModule, undefined);
  assert.equal(context.PART_TYPES.luckHeart.name, '幸運之心');
  assert.equal(context.PART_TYPES.knowledgeCore.name, '知識核心');
});

test('傳奇裝備配 1400% 精粹透鏡加成時，拆解精華為 375% 件數判定', () => {
  const context = loadFormulaContext();
  const calls = [];
  context.chance = (pct) => {
    calls.push(pct);
    return pct === 75;
  };
  context.itemEnchants = () => [];
  const result = context.salvageResult({ rarity: 5, level: 100, affixes: [] }, 0, 1400);

  // CSV: config/CSV/game_parameters.csv:195 傳說 25%；:308 精粹透鏡每階 +20%。
  // 25% × (1 + 1400/100) = 375%：必得 3 顆，另以 75% 判定第 4 顆。
  assert.equal(calls[0], 75);
  assert.equal(result.essence, 4);
});

test('基礎分解結果不直接附帶零件寶石產出', () => {
  const context = loadFormulaContext();
  const result = context.salvageResult({ rarity: 5, level: 100, affixes: [] }, 0, 0);
  assert.equal(result.gem, undefined);
  assert.equal(result.extracted, undefined);

  const factory = fs.readFileSync(path.join(root, 'js/factory.js'), 'utf8');
  assert.doesNotMatch(factory, /extractChanceNow|gemSieve|res\.extracted/);
});

test('舊存檔中的淘汰零件會移除已裝備項目並返還碎片', () => {
  const context = loadSaveContext();
  const state = context.newGameState();
  state.player.scrap = 10;
  state.factory.parts = [
    { id: 'sieve', key: 'gemSieve', tier: 3 },
    { id: 'purifier', key: 'gemPurifier', tier: 2 },
    { id: 'coil', key: 'essenceCoil', tier: 1 },
    { id: 'book', key: 'bookScavenger', tier: 2 },
    { id: 'dup', key: 'duplicator', tier: 2 },
    { id: 'prospector', key: 'prospector', tier: 2 },
    { id: 'core', key: 'luckCore', tier: 2 },
    { id: 'reroll', key: 'rerollModule', tier: 2 },
    { id: 'old-luck', key: 'fortuneChip', tier: 3 },
    { id: 'old-knowledge', key: 'archivist', tier: 4 },
    { id: 'lens', key: 'extractLens', tier: 1 }
  ];
  state.factory.partLevels.fortuneChip = 2;
  state.factory.partLevels.archivist = 2;
  state.factory.partLevels.luckCore = 4;
  state.factory.installed = { salvage: ['sieve', 'old-luck', 'lens', 'purifier'], synth: ['coil', 'core', 'reroll'] };

  const migrated = context.migrateSave(state);
  // 未載入 newforge 適配層時，save migration 仍保留有效的舊槽位；淘汰零件只會被移除。
  assert.deepEqual(Array.from(migrated.factory.parts, (part) => part.key), ['luckHeart', 'knowledgeCore', 'extractLens']);
  assert.equal(migrated.factory.partLevels.extractLens, 1);
  assert.equal(migrated.factory.partLevels.luckHeart, 3, '幸運晶片舊等級應遷移為幸運之心');
  assert.equal(migrated.factory.partLevels.knowledgeCore, 4, '知識回收器舊等級應遷移為知識核心');
  assert.equal(migrated.factory.partLevels.fortuneChip, undefined);
  assert.equal(migrated.factory.partLevels.archivist, undefined);
  assert.equal(migrated.factory.partLevels.luckCore, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.factory.installed)), { salvage: ['old-luck', 'lens'], synth: [] });
  assert.equal(migrated.player.scrap, 42);
});

test('野外敵人不再直接掉落附魔精華', () => {
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  assert.doesNotMatch(combat, /FIELD_ESSENCE_DROP_PCT/);
  assert.doesNotMatch(combat, /G\.player\.essence\s*\+=\s*amt/);
});
