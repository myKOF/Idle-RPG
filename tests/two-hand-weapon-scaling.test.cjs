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

function item(over) {
  return Object.assign({
    kind: 'equip',
    slot: 'weapon',
    weaponType: 'sword1h',
    rarity: 5,
    level: 100,
    upgrade: 0,
    affixes: [],
    sockets: [],
    enchants: []
  }, over || {});
}

test('two-handed weapon affix values use the 1.8x multiplier', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js']);
  const oneHand = item();
  const twoHand = item({ weaponType: 'axe2h' });
  const affix = { key: 'atkPct', roll: 500 };

  assert.equal(c.affixValue(oneHand, affix),
    c.affixValueFromStrength('atkPct', 100, 5, 500, false));
  assert.equal(c.affixValue(twoHand, affix),
    c.affixValueFromStrength('atkPct', 100, 5, 500, false, c.TWO_HAND_AFFIX_VALUE_MULT));
  assert.equal(c.getAffixLimits('atkPct', 100, 5, twoHand).max,
    c.affixValueFromStrength('atkPct', 100, 5, c.STRENGTH_ROLL_MAX, false,
      c.TWO_HAND_AFFIX_VALUE_MULT));
});

test('two-handed weapon passive and godforged values use the 2x multiplier', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js']);
  const oneHand = item();
  const twoHand = item({ weaponType: 'greatsword2h' });

  assert.equal(c.passiveValue(oneHand, { key: 'sunder' }), 10);
  assert.equal(c.passiveValue(twoHand, { key: 'sunder' }), 20);
  assert.equal(c.godPassiveValue({ key: 'godMight', roll: 500 }, oneHand), 18);
  assert.equal(c.godPassiveValue({ key: 'godMight', roll: 500 }, twoHand), 36);
});

test('two-handed legendary effect numeric values are doubled without changing timing/count fields', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js', 'js/legendary.js']);
  c.getStats = () => ({ legendaryEffectMults: { mountainSunderer: 2 } });

  const fx = c.legendaryFx('mountainSunderer');
  assert.equal(fx.controlDurationMult, 4);
  assert.equal(fx.controlledTargetDamagePct, 600);

  c.getStats = () => ({ legendaryEffectMults: {} });
  assert.equal(c.legendaryFx('mountainSunderer').controlledTargetDamagePct, 300);
});

test('computeStats records the two-handed multiplier for legendary effects and godforged values', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js', 'js/player.js']);
  c.G = c.newGameState();
  const baseline = c.computeStats();
  c.G.equipment.weapon = item({
    weaponType: 'axe2h',
    passive: { key: 'mountainSunderer' },
    godPassives: [{ key: 'godMight', roll: 0 }]
  });

  const st = c.computeStats();
  assert.equal(st.legendaryEffectMults.mountainSunderer, c.TWO_HAND_EFFECT_VALUE_MULT);
  const godMight = c.godPassiveValue({ key: 'godMight', roll: 0 }, c.G.equipment.weapon);
  assert.equal(st.atk, Math.round(baseline.atk * (1 + godMight / 100)));
});
