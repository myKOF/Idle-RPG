'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function createSimContext() {
  const ctx = {
    Math, Object, Array, Number, String, RegExp, console,
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    location: { hostname: 'localhost' }
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);

  const files = [
    'js/worker/protocol.js', 'js/worker/shim.js',
    'js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/stats.js',
    'js/item.js', 'js/skills.js', 'js/skills2.js', 'js/talents.js',
    'js/player.js', 'js/special_rules.js',
    'js/combat.js', 'js/legendary.js', 'js/potential.js', 'js/tower.js',
    'js/factory.js', 'js/newforge.js', 'js/forge.js', 'js/save.js',
    'js/tasks.js', 'js/gm_exec.js'
  ];

  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}

const ctx = createSimContext();
ctx.G = ctx.newGameState();
ctx.G.player.level = 100;
ctx.G.player.reincarnations = 1;
ctx.G.player.gold = 1000000000;
ctx.G.player.skills2 = {
  levels: {
    counter: [10, 10, 10, 10, 10, 10, 10]
  },
  ult: {
    counter: { pick: 0, lv: 10 }
  }
};
ctx.G.player.loadout = ['sg:counter'];
ctx.G.stage.current = 100;
ctx.G.stage.zone = 'Icefield';

// Fast basic weapon
ctx.G.equipment = {
  weapon: { id: 'eq_w', kind: 'equip', slot: 'weapon', rarity: 5, level: 100, upgrade: 40, weaponType: 'sword1h', affixes: [{ key: 'atkPct', roll: 100 }, { key: 'blockRate', roll: 100 }, { key: 'aoeDmg', roll: 100 }, { key: 'critDmg', roll: 100 }, { key: 'pPen', roll: 100 }] },
  weapon2: { id: 'eq_w2', kind: 'equip', slot: 'weapon2', rarity: 5, level: 100, upgrade: 40, weaponType: 'shield', affixes: [{ key: 'blockRate', roll: 100 }, { key: 'atkPct', roll: 100 }, { key: 'aoeDmg', roll: 100 }, { key: 'critDmg', roll: 100 }, { key: 'pPen', roll: 100 }] }
};
ctx.SLOT_LIST.forEach(s => {
  if (!ctx.G.equipment[s]) {
    ctx.G.equipment[s] = { id: 'eq_' + s, kind: 'equip', slot: s, rarity: 5, level: 100, upgrade: 40, affixes: [{ key: 'atkPct', roll: 100 }, { key: 'critDmg', roll: 100 }, { key: 'blockRate', roll: 100 }, { key: 'aoeDmg', roll: 100 }, { key: 'pPen', roll: 100 }] };
  }
});
ctx.G.player.equipment = ctx.G.equipment;

const pStats = ctx.computeStats();
console.log('Player ATK:', pStats.atk, 'BlockRate:', pStats.blockRate);

ctx.FIELD = {
  monsters: [],
  monster: null,
  player: ctx.newPlayerEntity(pStats),
  mapComplete: false,
  _gmArena: true,
  _waveClearPending: false,
  spawnCd: 0,
  reviveCd: 0,
  dpsWindow: []
};
ctx.FIELD.player.hp = 1e9;
ctx.FIELD.player.maxHp = 1e9;
ctx.FIELD.player.mp = 1e9;
ctx.FIELD.player.maxMp = 1e9;

let totalDmg = 0;
ctx.trackDps = (dmg) => { totalDmg += dmg; };

const zn = ctx.ZONE_CONFIG_TABLE ? ctx.ZONE_CONFIG_TABLE['Icefield'] : ctx.ZONES['Icefield'];
const base = ctx.monsterStatsFor(100, false, false);
for (let i = 0; i < 5; i++) {
  ctx.FIELD.monsters.push({
    id: 'm_' + i, name: '測試雪怪', maxHp: base.hp * zn.hpMult, hp: base.hp * zn.hpMult,
    atk: base.atk * zn.atkMult, def: base.def * zn.defMult, mdef: base.mdef * zn.defMult,
    aspd: 1.5, pos: { x: 30 + i * 10, y: 0 }, effects: {}, buffs: {}, dots: [], atkCd: 0
  });
}
ctx.markFieldEnemyFloatTargets(ctx.FIELD.monsters);
ctx.syncFieldPrimary();

console.log('Starting 10 ticks simulation...');
for (let t = 0; t < 20; t++) {
  ctx.fieldTick(0.05);
  ctx.GT += 0.05;
}
console.log('Simulation ran 20 ticks. Total Dmg:', totalDmg, 'Monster 0 HP:', ctx.FIELD.monsters[0] ? ctx.FIELD.monsters[0].hp : 'dead');
