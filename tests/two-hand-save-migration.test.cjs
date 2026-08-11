const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext(files) {
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

const contextFiles = [
  'js/util.js',
  'js/data.js',
  'js/status.js', 'js/formula.js',
  'js/item.js',
  'js/newforge.js',
  'js/player.js',
  'js/save.js'
];

test('legacy save loading backfills affixes and sockets for two-handed weapons across equipment, all 3 sets, and furnace queues', () => {
  const c = loadContext(contextFiles);

  function createOldMythic2H(name, affCount, sockCount) {
    return {
      id: 'item_' + Math.random(),
      kind: 'equip',
      slot: 'weapon',
      rarity: 6, // mythic
      level: 100,
      name: name,
      upgrade: 0,
      affixes: Array.from({ length: affCount }, () => ({ key: 'atkPct', roll: 500 })),
      sockets: Array.from({ length: sockCount }, () => null),
      enchants: [{ key: 'fire', gemLv: 0 }, { key: 'ice', gemLv: 0 }]
    };
  }

  const rawSave = {
    version: 2,
    player: { level: 100, reincarnations: 1 },
    equipment: { weapon: createOldMythic2H('神話的巨劍', 6, 5) },
    equipmentSets: [
      { weapon: createOldMythic2H('神話的巨劍', 6, 5) },
      { weapon: createOldMythic2H('神話的戰斧', 5, 2) },
      { weapon: createOldMythic2H('神話的修行法杖', 6, 5) }
    ],
    inventory: [createOldMythic2H('神話的雙刃魔劍', 6, 5)],
    newForge: {
      queue: [createOldMythic2H('神話的斬龍大劍', 4, 3)],
      furnaces: [
        {
          id: 1,
          name: '1號爐',
          enabled: true,
          qualities: [true, true, true, true, true, true, true, true],
          queue: [createOldMythic2H('神話的滅世巨斧', 6, 5)],
          belt: []
        }
      ]
    }
  };

  const migrated = c.migrateSave(rawSave);

  // Mythic (rarity 6) base affixes = 6, 2H bonus = +1 -> 7 affixes target
  // Mythic (rarity 6) base sockets = 5, 2H mult = floor(5 * 1.75) = 8 sockets target
  const eqWpn = migrated.equipment.weapon;
  assert.equal(eqWpn.weaponType, 'greatsword2h');
  assert.equal(eqWpn.affixes.length, 7);
  assert.equal(eqWpn.sockets.length, 8);

  // Check all 3 equipment sets
  assert.equal(migrated.equipmentSets[0].weapon.affixes.length, 7);
  assert.equal(migrated.equipmentSets[0].weapon.sockets.length, 8);
  assert.equal(migrated.equipmentSets[1].weapon.affixes.length, 7);
  assert.equal(migrated.equipmentSets[1].weapon.sockets.length, 8);
  assert.equal(migrated.equipmentSets[2].weapon.affixes.length, 7);
  assert.equal(migrated.equipmentSets[2].weapon.sockets.length, 8);

  // Check inventory item
  assert.equal(migrated.inventory[0].affixes.length, 7);
  assert.equal(migrated.inventory[0].sockets.length, 8);

  // Check newForge queues
  assert.equal(migrated.newForge.queue[0].affixes.length, 7);
  assert.equal(migrated.newForge.queue[0].sockets.length, 8);
  assert.equal(migrated.newForge.furnaces[0].queue[0].affixes.length, 7);
  assert.equal(migrated.newForge.furnaces[0].queue[0].sockets.length, 8);

  // Verify mythic two-handed weapon enchant capacity allows a 3rd enchant
  assert.equal(c.enchantCapFor(eqWpn), 3);
});

test('two-handed weapon save migration is idempotent on repeated loads', () => {
  const c = loadContext(contextFiles);

  function createOldMythic2H(name) {
    return {
      id: 'item_test_1',
      kind: 'equip',
      slot: 'weapon',
      rarity: 6, // mythic
      level: 100,
      name: name,
      upgrade: 0,
      affixes: [{ key: 'atkPct', roll: 500 }],
      sockets: [null]
    };
  }

  const rawSave = {
    version: 2,
    player: { level: 100, reincarnations: 1 },
    equipment: { weapon: createOldMythic2H('神話的巨劍') }
  };

  const load1 = c.migrateSave(JSON.parse(JSON.stringify(rawSave)));
  const affCount1 = load1.equipment.weapon.affixes.length;
  const sockCount1 = load1.equipment.weapon.sockets.length;
  const keys1 = load1.equipment.weapon.affixes.map(a => a.key);

  const load2 = c.migrateSave(JSON.parse(JSON.stringify(load1)));
  const affCount2 = load2.equipment.weapon.affixes.length;
  const sockCount2 = load2.equipment.weapon.sockets.length;
  const keys2 = load2.equipment.weapon.affixes.map(a => a.key);

  assert.equal(affCount1, 7);
  assert.equal(sockCount1, 8);
  assert.equal(affCount2, 7);
  assert.equal(sockCount2, 8);
  assert.deepEqual(keys1, keys2);
});

test('old mythic two-handed weapons with 2 enchants filled can take a 3rd enchant', () => {
  const c = loadContext(contextFiles);
  c.G = c.newGameState();
  c.G.player.books['lightning'] = 5;
  c.G.player.essence = 1000;

  const item = {
    id: 'mythic_2h_1',
    kind: 'equip',
    slot: 'weapon',
    rarity: 6, // mythic
    level: 100,
    name: '神話的巨劍',
    weaponType: 'greatsword2h',
    affixes: [],
    sockets: [],
    enchants: [
      { key: 'fire', gemLv: 0 },
      { key: 'ice', gemLv: 0 }
    ]
  };

  assert.equal(c.enchantCapFor(item), 3);
  const err = c.manualEnchant(item, 'lightning');
  assert.equal(err, null);
  assert.equal(item.enchants.length, 3);
  assert.equal(item.enchants[2].key, 'lightning');
});
