const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

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

function equipment(context, normal, elite = 456) {
  return {
    kind: 'equip',
    name: 'test equipment',
    rarity: 5,
    level: 501,
    affixes: [
      { key: 'normalDmg', val: normal },
      { key: 'eliteDmg', val: elite }
    ],
    sockets: [],
    upgrade: 0,
    slot: context.SLOT_LIST[0]
  };
}

test('既有已套用 V1 降低的普通敵人傷害詞條只回復一次 10 倍', () => {
  const context = loadSaveContext();
  const state = context.newGameState();
  state.normalDmgAffixScaleV1 = true;
  const locations = [];
  const first = equipment(context, 26.9);
  state.equipmentSets[0][context.SLOT_LIST[0]] = first;
  state.equipment = state.equipmentSets[0];
  locations.push(first);
  const secondSetItem = equipment(context, 10);
  state.equipmentSets[1][context.SLOT_LIST[0]] = secondSetItem;
  locations.push(secondSetItem);
  const containers = [
    state.inventory,
    state.factory.conveyor,
    state.factory.synthBuffer,
    state.newForge.queue
  ];
  [20, 30, 40, 50].forEach((value, i) => {
    const item = equipment(context, value);
    locations.push(item);
    containers[i].push(item);
  });
  const forgeItem = equipment(context, 60);
  state.forge.slots[0] = forgeItem;
  locations.push(forgeItem);

  const migrated = context.migrateSave(state);
  assert.equal(migrated.normalDmgAffixScaleV2, true);
  locations.forEach((item) => {
    const normal = item.affixes.find((affix) => affix.key === 'normalDmg');
    const elite = item.affixes.find((affix) => affix.key === 'eliteDmg');
    assert.ok(normal.val >= 10);
    assert.equal(elite.val, 456);
  });
  assert.equal(first.affixes[0].val, 269);
  assert.equal(secondSetItem.affixes[0].val, 100);

  context.migrateSave(state);
  assert.equal(first.affixes[0].val, 269);
  assert.equal(state.forge.slots[0].affixes[0].val, 60);
});

test('新生成普通敵人傷害詞條與太古詞條使用恢復後的 10 倍數值', () => {
  const context = loadSaveContext();
  const def = context.AFFIX_POOL.normalDmg;
  assert.equal(def.base, 3);
  assert.equal(def.lv, 0.035);

  const base = (def.base + def.base * def.lv * (501 - 1)) * context.RARITIES[5].mult;
  assert.equal(context.getAffixLimits('normalDmg', 501, 5).max, Math.round(base * 1.2 * 10) / 10);
  assert.equal(context.ancientAffixValue('normalDmg', 501, 5), Math.round(base * 1.2 * 1.35 * 10) / 10);

  const ancientAt500 = context.ancientAffixValue('normalDmg', 500, 8) * 3;
  const eliteAt500 = context.ancientAffixValue('eliteDmg', 500, 8) * 3;
  assert.ok(ancientAt500 > 2600 && ancientAt500 < 2800);
  assert.ok(ancientAt500 > eliteAt500 && ancientAt500 < eliteAt500 * 1.35);
});

test('沒有舊遷移標記的低值非太古詞條也只修復一次，正常與太古值不重複放大', () => {
  const context = loadSaveContext();
  const state = context.newGameState();
  const low = equipment(context, 869, 456);
  low.rarity = 8;
  low.level = 499;
  low.upgrade = 40;
  const normalBase = (context.AFFIX_POOL.normalDmg.base +
    context.AFFIX_POOL.normalDmg.base * context.AFFIX_POOL.normalDmg.lv * (low.level - 1)) *
    context.RARITIES[low.rarity].mult;
  const valid = equipment(context, normalBase * 0.9, 456);
  valid.rarity = 8;
  valid.level = 499;
  const ancient = equipment(context, context.ancientAffixValue('normalDmg', 499, 8), 456);
  ancient.rarity = 8;
  ancient.level = 499;
  const overScaled = equipment(context, 8690, 456);
  overScaled.rarity = 8;
  overScaled.level = 499;
  state.equipmentSets[0][context.SLOT_LIST[0]] = low;
  state.equipmentSets[0][context.SLOT_LIST[1]] = valid;
  state.equipmentSets[0][context.SLOT_LIST[2]] = ancient;
  state.equipmentSets[0][context.SLOT_LIST[3]] = overScaled;
  state.equipment = state.equipmentSets[0];

  context.migrateSave(state);
  assert.equal(state.normalDmgAffixScaleV3, true);
  assert.equal(low.affixes[0].val, 869);
  assert.equal(valid.affixes[0].val, normalBase * 0.9);
  assert.equal(ancient.affixes[0].val, context.ancientAffixValue('normalDmg', 499, 8));
  assert.equal(overScaled.affixes[0].val, 869);

  context.migrateSave(state);
  assert.equal(low.affixes[0].val, 869);
  assert.equal(overScaled.affixes[0].val, 869);
});
