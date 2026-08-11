const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = {
    console,
    Math: Object.create(Math),
    Date,
    UI: { dirty: {} },
    blog() {},
    document: { getElementById() { return null; } }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/stats.js', 'js/combat.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  return context;
}

function setupField(context) {
  context.G = {
    player: { gold: 0 },
    stage: { current: 270, best: 270, kills: 0, autoAdvance: false, zone: 'swamp' },
    factory: { parts: [], installed: { salvage: [], synth: [] } },
    tower: { active: false }
  };
  context.FIELD.player = { hp: 100 };
  context.FIELD.monsters = [];
  context.FIELD.monster = null;
  context.getStats = () => ({ hp: 100, goldBonus: 0, xpBonus: 0, moveSpeed: 0, passives: {} });
  context.healPlayer = () => {};
  context.gainXp = () => {};
}

function enemy(id) {
  return { id, name: 'test enemy', hp: 0, maxHp: 10, gold: 1, xp: 1, elite: true };
}

test('each unique field kill produces exactly one field drop roll and one kill record', () => {
  const context = loadContext();
  setupField(context);
  let dropRolls = 0;
  context.rollFieldDrops = () => { dropRolls++; return []; };

  for (let i = 0; i < 200; i++) {
    const m = enemy(i);
    context.FIELD.monsters = [m];
    context.FIELD.monster = m;
    context.onFieldKill(m);
  }

  assert.equal(dropRolls, 200);
  assert.equal(context.LOOT_STATS.kills, 200);
});

test('repeated kill notifications for one enemy do not duplicate drops or kills', () => {
  const context = loadContext();
  setupField(context);
  let dropRolls = 0;
  context.rollFieldDrops = () => { dropRolls++; return []; };
  const m = enemy('same-enemy');
  context.FIELD.monsters = [m];
  context.FIELD.monster = m;

  context.onFieldKill(m);
  context.onFieldKill(m);

  assert.equal(dropRolls, 1);
  assert.equal(context.LOOT_STATS.kills, 1);
});

test('the field kill handler contains one drop settlement call', () => {
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  const handler = combat.slice(combat.indexOf('function onFieldKill'), combat.indexOf('function onFieldDeaths'));
  assert.equal((handler.match(/rollFieldDrops\(m\)/g) || []).length, 1);
});

test('270級單一菁英在 958.4% 掉寶率下，一級寶石單次最多結算 5 顆', () => {
  const context = loadContext();
  context.G = {
    player: { gems: {}, books: {}, ancientEssence: 0, dust: 0, essence: 0, gold: 0 },
    stage: { current: 270, zone: 'swamp' },
    factory: { parts: [], conveyor: [], installed: { salvage: [], synth: [] } },
    tower: { active: false }
  };
  context.FIELD.player = { buffs: {} };
  context.getStats = () => ({ loot: 958.4, goldBonus: 0, xpBonus: 0, moveSpeed: 0, passives: {} });
  context.currentZoneDef = () => ({ rewardMult: 3 });
  context.Math.random = () => 0;
  context.ZONE_STAGE_DROP_TABLE.swamp = [{
    min: 1, max: 400,
    equipmentRates: Array(11).fill(0),
    materials: { gemRates: [10, 1, 0.5, 0.1, 0.1], bookRate: 0, ancientEssenceRate: 0, dustRate: 0, partRate: 0 }
  }];
  context.makeEquipment = () => ({});
  context.pushConveyor = () => {};
  context.addGem = () => {};
  context.randomGemType = () => 'ruby';
  context.gemLabel = () => '一級紅寶石';
  context.trimFactoryParts = () => {};

  context.rollFieldDrops({ level: 270, elite: true });

  assert.equal(context.LOOT_STATS.sources.field.dropRolls, 1);
  assert.equal(context.LOOT_STATS.sources.field.gems['ruby:1'], 5);
  assert.equal(context.LOOT_STATS.sources.field.gems['ruby:2'], 1);
  assert.equal(context.LOOT_STATS.sources.field.gems['ruby:3'], 1);
  assert.equal(context.LOOT_STATS.sources.field.gems['ruby:4'], 1);
  assert.equal(context.LOOT_STATS.sources.field.gems['ruby:5'], 1);
});
