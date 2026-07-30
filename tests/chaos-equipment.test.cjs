const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  for (const file of ['js/util.js', 'js/data.js', 'js/formula.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return context;
}

test('chaos field drop is restricted by the configured stage and zones', () => {
  const context = loadContext();

  assert.equal(context.CHAOS_FIELD_DROP_MIN_STAGE, 551);
  assert.equal(context.CHAOS_FIELD_DROP_PCT, 1);
  assert.equal(context.chaosFieldDropEligible('god_battlefield', 550), false);
  assert.equal(context.chaosFieldDropEligible('plains', 551), false);
  assert.equal(context.chaosFieldDropEligible('god_battlefield', 551), true);
  assert.equal(context.chaosFieldDropEligible('god_chaos', 700), true);
  assert.equal(context.chaosFieldDropEligible('god_sanctuary', 700), true);
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

  assert.match(csv, /5-野外裝備掉落,混沌裝備/);
  assert.match(csv, /6-神鑄,裝備神鑄混沌魔塵加成/);
  assert.match(csv, /6-神鑄,裝備神鑄混沌基礎成功率/);
  assert.match(csv, /6-神鑄,裝備神鑄混沌金幣/);
  assert.match(csv, /6-神鑄,裝備神鑄混沌時間\(秒\)/);
  assert.match(csv, /表-稀有度,混沌/);
  assert.match(csv, /表-稀有度,神鑄混沌/);
});
