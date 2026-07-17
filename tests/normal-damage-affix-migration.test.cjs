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
    name: '測試裝備',
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

test('一次性遷移將既有普通敵人傷害詞條降低為 1/10，且不重複處理', () => {
  const context = loadSaveContext();
  const state = context.newGameState();
  const locations = [];
  const first = equipment(context, 26174.1);
  state.equipmentSets[0][context.SLOT_LIST[0]] = first;
  state.equipment = state.equipmentSets[0];
  locations.push(first);
  const secondSetItem = equipment(context, 1000);
  state.equipmentSets[1][context.SLOT_LIST[0]] = secondSetItem;
  locations.push(secondSetItem);
  const containers = [
    state.inventory,
    state.factory.conveyor,
    state.factory.synthBuffer,
    state.newForge.queue
  ];
  [2000, 3000, 4000, 5000].forEach((value, i) => {
    const item = equipment(context, value);
    locations.push(item);
    if (i === 3) {
      state.newForge.furnaces[0].lines[0].belt.push({ kind: 'salv', item });
    } else {
      containers[i].push(item);
    }
  });
  const forgeItem = equipment(context, 6000);
  state.forge.slots[0] = forgeItem;
  locations.push(forgeItem);

  const migrated = context.migrateSave(state);
  assert.equal(migrated.normalDmgAffixScaleV1, true);
  locations.forEach((item) => {
    const normal = item.affixes.find((affix) => affix.key === 'normalDmg');
    const elite = item.affixes.find((affix) => affix.key === 'eliteDmg');
    assert.equal(normal.val, Math.round(normal.val * 10) / 10, '遷移後仍維持一位小數');
    assert.equal(elite.val, 456, '菁英詞條不可被遷移');
  });
  assert.equal(first.affixes[0].val, 2617.4);
  assert.equal(secondSetItem.affixes[0].val, 100);

  context.migrateSave(state);
  assert.equal(first.affixes[0].val, 2617.4, '第二次讀檔不可再次除以 10');
  assert.equal(state.forge.slots[0].affixes[0].val, 600);
});
