const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math), UI: { dirty: {} }, blog() {} };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('菁英裝備與材料掉落率均在一般基礎上乘以菁英掉落倍率（ELITE_DROP_MULT=1.5）', () => {
  const context = loadContext();
  /* 依 AI_RULES.md 9.1 例外，測試刻意釘住目前數值：參數一動這裡就會紅，
     這是預期行為——確認新值是有意調整後，把期望值一併更新。
     2026-07-17：使用者確認以程式值 1.3 為準。
     2026-08-10：平衡調整為 1.5（使用者確認）。 */
  assert.equal(context.ELITE_DROP_MULT, 1.5);
  context.G = {
    stage: { current: 10, zone: 'test' },
    player: { books: {}, ancientEssence: 0, dust: 0, essence: 0 },
    factory: { parts: [], installed: { salvage: [], synth: [] } }
  };
  context.FIELD = { player: {} };
  context.getStats = () => ({ loot: 0 });
  context.buffVal = () => 0;
  context.ZONE_STAGE_DROP_TABLE.test = [{
    min: 1, max: 10,
    equipmentRates: [10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    materials: { gemRates: [5, 1, 0.5, 0, 0], bookRate: 4, ancientEssenceRate: 0, dustRate: 0, partRate: 0.5 }
  }];
  context.currentZoneDef = () => ({ rewardMult: 1 });
  context.rollDropCount = (rate) => { context._dropRates.push(rate); return 0; };
  context.chance = (rate) => { context._chanceRates.push(rate); return false; };
  context.pushConveyor = () => {};
  context.trimFactoryParts = () => {};

  const run = (elite) => {
    context._dropRates = [];
    context._chanceRates = [];
    context.rollFieldDrops({ level: 10, elite });
    return { drops: context._dropRates.slice(), chances: context._chanceRates.slice() };
  };
  const normal = run(false);
  const elite = run(true);
  const m = context.ELITE_DROP_MULT;

  assert.deepEqual(elite.drops.slice(0, 1), [10 * m]);
  assert.deepEqual(elite.drops.slice(1, 4), [5 * m, 1 * m, 0.5 * m]);
  assert.deepEqual(normal.drops.slice(0, 1), [10]);
  assert.deepEqual(normal.drops.slice(1, 4), [5, 1, 0.5]);
  // 野外零件掉落已移除，材料抽樣只保留附魔書率（partRate 不再進入掉落流程）。
  assert.deepEqual(elite.drops.slice(4), [4 * m]);
  assert.deepEqual(normal.drops.slice(4), [4]);
  assert.deepEqual(elite.chances, []);
  assert.deepEqual(normal.chances, []);
});
