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
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
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
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/player.js', 'js/save.js'].forEach((file) => {
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
  assert.equal(context.PART_TYPES.extractLens.perTier, 20);
  assert.equal(context.effectivePartEffectValue('extractLens', 140), 140);
  assert.equal(context.effectivePartEffectValue('extractLens', 1400), 1400);
  assert.equal(context.PART_TYPES.essenceCoil, undefined);
  assert.equal(context.PART_TYPES.gemSieve, undefined);
  assert.equal(context.PART_TYPES.gemPurifier, undefined);
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

test('裝備分解不再觸發精粹提取或產出寶石', () => {
  const context = loadFormulaContext();
  const result = context.salvageResult({ rarity: 5, level: 100, affixes: [] }, 0, 0);
  assert.equal(result.gem, undefined);
  assert.equal(result.extracted, undefined);

  const factory = fs.readFileSync(path.join(root, 'js/factory.js'), 'utf8');
  assert.doesNotMatch(factory, /extractChanceNow|gemSieve|recordLootGem|res\.extracted/);
});

test('舊存檔中的淘汰零件會移除已裝備項目並返還碎片', () => {
  const context = loadSaveContext();
  const state = context.newGameState();
  state.player.scrap = 10;
  state.factory.parts = [
    { id: 'sieve', key: 'gemSieve', tier: 3 },
    { id: 'purifier', key: 'gemPurifier', tier: 2 },
    { id: 'coil', key: 'essenceCoil', tier: 1 },
    { id: 'lens', key: 'extractLens', tier: 1 }
  ];
  state.factory.installed = { salvage: ['sieve', 'lens', 'purifier'], synth: ['coil'] };

  const migrated = context.migrateSave(state);
  assert.deepEqual(Array.from(migrated.factory.parts, (part) => part.key), ['extractLens']);
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.factory.installed)), { salvage: ['lens'], synth: [] });
  assert.equal(migrated.player.scrap, 22);
});

test('野外敵人不再直接掉落附魔精華', () => {
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  assert.doesNotMatch(combat, /FIELD_ESSENCE_DROP_PCT/);
  assert.doesNotMatch(combat, /G\.player\.essence\s*\+=\s*amt/);
});
