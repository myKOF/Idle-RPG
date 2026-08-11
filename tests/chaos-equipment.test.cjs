const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  for (const file of ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return context;
}

test('混沌裝備是地圖掉落表中的 R9，不再使用特殊掉落常數', () => {
  const context = loadContext();

  assert.equal(context.fieldDropRatesFor(550, 1, 'god_battlefield')[9], 0);
  assert.equal(context.fieldDropRatesFor(551, 1, 'god_battlefield')[9], 1);
  assert.equal(context.fieldDropRatesFor(551, 1, 'god_chaos')[9], 1);
  assert.equal(context.fieldDropRatesFor(601, 1, 'god_sanctuary')[9], 1);
  assert.equal(typeof context.CHAOS_FIELD_DROP_PCT, 'undefined');
});

test('chaos equipment forge uses 20% base and 3% per dust', () => {
  const context = loadContext();

  assert.equal(context.forgeBaseRateFor(context.CHAOS_IDX), 20);
  assert.equal(context.forgeSuccessRateFor(context.CHAOS_IDX, 0), 20);
  assert.equal(context.forgeSuccessRateFor(context.CHAOS_IDX, 1), 23);
  assert.equal(context.forgeSuccessRateFor(context.CHAOS_IDX, 6), 38);
  assert.equal(context.FORGE_FAIL_CONSUME, 3);
  assert.equal(context.isForgeableEquipmentRarity(context.CHAOS_IDX), true);
  assert.equal(context.isGodforgedRarity(context.CHAOS_GODFORGED_IDX), true);
});

test('chaos forge parameters are present in the CSV source of truth', () => {
  const csv = fs.readFileSync(path.resolve(__dirname, '..', 'config/CSV/game_parameters.csv'), 'utf8');

  assert.doesNotMatch(csv, /5-野外裝備掉落,混沌裝備/);
  assert.match(csv, /6-神鑄,裝備神鑄混沌魔塵加成/);
  assert.match(csv, /6-神鑄,裝備神鑄混沌基礎成功率/);
  assert.match(csv, /6-神鑄,裝備神鑄混沌金幣/);
  assert.match(csv, /6-神鑄,裝備神鑄混沌時間\(秒\)/);
  assert.match(csv, /表-稀有度,混沌/);
  assert.match(csv, /表-稀有度,神鑄混沌/);
});
