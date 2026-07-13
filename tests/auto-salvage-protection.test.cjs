const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGameContext() {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    setTimeout() {},
    clearTimeout() {},
    document: { addEventListener() {} },
    UI: { dirty: {} }
  };
  context.window = context;
  vm.createContext(context);

  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js', 'js/player.js', 'js/factory.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });

  return context;
}

function item(id, rarity, locked = false) {
  return {
    id,
    name: id,
    rarity,
    locked,
    sockets: [],
    affixes: [],
    level: 1,
    slot: 'weapon'
  };
}

function baseState(context) {
  context.getStats = () => ({ weight: 0, luck: 0 });
  context.itemScore = (it) => (it ? it.rarity * 100 + (it.level || 0) : 0);
  context.flog = () => {};
  context.blog = () => {};
  context.G = {
    player: { invUpgrades: 0 },
    equipment: {},
    inventory: [],
    factory: {
      filter: { actions: ['keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep'] },
      autoEquip: false,
      conveyor: [],
      synthBuffer: [],
      parts: [],
      installed: { salvage: [], synth: [] },
      stats: { salvaged: 0, extracted: 0 }
    }
  };
}

test('full inventory preserves incoming mythic by salvaging a lower unlocked item', () => {
  const context = loadGameContext();
  baseState(context);
  context.INVENTORY_CAP = 2;
  context.G.inventory = [
    item('locked-rare', 2, true),
    item('common', 0)
  ];
  const salvaged = [];
  context.doSalvage = (it) => {
    salvaged.push(it.id);
    return { scrap: 1 };
  };

  const added = context.addToInventory(item('mythic', 6));

  assert.equal(added, true);
  assert.deepEqual(salvaged, ['common']);
  assert.deepEqual(Array.from(context.G.inventory, (it) => it.id), ['locked-rare', 'mythic']);
});

test('輸送帶達到固定上限後直接丟棄新裝備', () => {
  const context = loadGameContext();
  baseState(context);
  context.CONVEYOR_CAP = 2;
  context.G.factory.conveyor = [
    item('mythic', 6),
    item('common', 0)
  ];
  const salvaged = [];
  context.doSalvage = (it) => {
    salvaged.push(it.id);
    return { scrap: 1 };
  };

  const pushed = context.pushConveyor(item('genesis', 7));

  assert.equal(pushed, false);
  assert.deepEqual(salvaged, []);
  assert.deepEqual(Array.from(context.G.factory.conveyor, (it) => it.id), ['mythic', 'common']);
});

test('關閉合成後不會再把掉落送進合成暫存區', () => {
  const context = loadGameContext();
  baseState(context);
  context.SYNTH_BUFFER_CAP = 2;
  context.G.factory.filter.actions[7] = 'synth';
  context.G.factory.conveyor = [item('genesis', 7)];
  context.G.factory.synthBuffer = [
    item('mythic', 6),
    item('common', 0)
  ];
  const salvaged = [];
  context.doSalvage = (it) => {
    salvaged.push(it.id);
    return { scrap: 1 };
  };

  context.processOneConveyorItem();

  assert.deepEqual(salvaged, []);
  assert.deepEqual(Array.from(context.G.factory.synthBuffer, (it) => it.id), ['mythic', 'common']);
  assert.deepEqual(Array.from(context.G.inventory, (it) => it.id), ['genesis']);
});

test('filter salvage automation preserves protected mythic equipment', () => {
  const context = loadGameContext();
  baseState(context);
  context.G.factory.filter.actions[6] = 'salvage';
  context.G.factory.conveyor = [item('mythic', 6)];
  const salvaged = [];
  context.doSalvage = (it) => {
    salvaged.push(it.id);
    return { scrap: 1 };
  };

  context.processOneConveyorItem();

  assert.deepEqual(salvaged, []);
  assert.deepEqual(Array.from(context.G.inventory, (it) => it.id), ['mythic']);
});
