const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext(files) {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {},
    clearTimeout() {},
    document: {
      addEventListener() {},
      getElementById() { return null; },
      querySelectorAll() { return []; }
    },
    UI: { dirty: {} },
    RUN_STATS: { skills: {} },
    blog() {},
    floatText() {},
    trackDps() {},
    recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('magicLightShield has a fixed 20-second internal cooldown', () => {
  const context = loadContext([
    'js/util.js',
    'js/data.js',
    'js/status.js',
    'js/formula.js',
    'js/battlefield.js',
    'js/combat.js',
    'js/skills.js',
    'js/legendary.js'
  ]);
  const stats = {
    hp: 1000,
    legendaryEffects: { magicLightShield: true },
    legendaryEffectMults: { magicLightShield: 2 },
    passives: {}
  };
  const player = { hp: 400, shield: 0, shieldMax: 0, buffs: {}, effects: {} };
  context.getStats = () => stats;
  context.resetLegendaryRT();
  context.GT = 0;

  assert.equal(context.PASSIVE_POOL.magicLightShield.fx.cooldownSec, 20);
  assert.equal(context.legendaryFx('magicLightShield').cooldownSec, 20,
    'cooldown must not scale with legendary effect multipliers');
  stats.legendaryEffectMults = undefined;

  context.legendaryApplyLowLifeShield(player, stats, 'pv-float');
  assert.equal(player.shield, 1000);

  context.GT = 1;
  player.hp = 600;
  context.legendaryTickLightShield(player, stats);
  player.hp = 400;
  player.shield = 0;
  context.GT = 19;
  context.legendaryTickLightShield(player, stats);
  context.legendaryApplyLowLifeShield(player, stats, 'pv-float');
  assert.equal(player.shield, 0, 'must not trigger while cooldown is active');

  context.GT = 20;
  context.legendaryApplyLowLifeShield(player, stats, 'pv-float');
  assert.equal(player.shield, 1000, 'must trigger again when cooldown ends');
});
