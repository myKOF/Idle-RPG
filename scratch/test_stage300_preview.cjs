'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function createSimContext() {
  const ctx = {
    Math, Object, Array, Number, String, RegExp, console,
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    location: { hostname: 'localhost' },
    BF_COLS: 10, BF_ROWS: 10
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

function testSim(scenarioType) {
  const ctx = createSimContext();
  ctx.G = ctx.newGameState();
  ctx.G.player.level = 300;
  ctx.G.player.reincarnations = 1;
  ctx.G.player.gold = 1e9;
  ctx.G.player.skills2 = {
    levels: { thrust: [10, 10, 10, 10, 10, 10, 10] },
    ult: { thrust: { pick: 0, lv: 10 } }
  };
  ctx.G.player.loadout = ['sg:thrust'];
  ctx.G.stage.current = 300;
  ctx.G.stage.zone = 'swamp';

  const eq = {};
  ctx.SLOT_LIST.forEach(slot => {
    eq[slot] = {
      id: 'eq_' + slot,
      kind: 'equip',
      slot: slot,
      rarity: 5,
      level: 300,
      name: '300級傳奇裝備',
      affixes: [
        { key: 'atkPct', roll: 100 },
        { key: 'critDmg', roll: 100 },
        { key: 'atkFlat', roll: 100 },
        { key: 'critRate', roll: 100 },
        { key: 'pPen', roll: 100 }
      ],
      upgrade: 40,
      sockets: []
    };
  });
  ctx.G.equipment = eq;
  ctx.G.player.equipment = eq;

  const pStats = ctx.computeStats();
  pStats.blockRate = 50;
  pStats.blockDmgRed = 80;
  pStats.comboHits = 3;
  pStats.totalDmgPct = (pStats.totalDmgPct || 0) + 1000;
  pStats.elemDmgPct = (pStats.elemDmgPct || 0) + 1000;
  if (ctx.ELEMENTS && pStats.elemDmgUp) {
    ctx.ELEMENTS.forEach(e => {
      pStats.elemDmgUp[e] = (pStats.elemDmgUp[e] || 0) + 1000;
    });
  }

  ctx.FIELD = {
    monsters: [],
    monster: null,
    player: ctx.newPlayerEntity(pStats),
    mapComplete: false,
    _gmArena: true,
    spawnCd: 0,
    reviveCd: 0,
    dpsWindow: []
  };

  ctx.FIELD.player.hp = 1e12;
  ctx.FIELD.player.maxHp = 1e12;
  ctx.FIELD.player.mp = 1e12;
  ctx.FIELD.player.maxMp = 1e12;

  ctx.fieldMonsterAttack = function() { return false; };
  ctx.resetSkillRT();
  if (typeof ctx.resetSkill2RT === 'function') ctx.resetSkill2RT();

  const mobsPerWave = scenarioType === 1 ? 20 : scenarioType === 2 ? 5 : 1;
  const enemyKind = scenarioType === 1 ? 'normal' : scenarioType === 2 ? 'elite' : 'boss';
  const isBoss = enemyKind === 'boss';
  const isElite = enemyKind === 'elite';
  const base = ctx.monsterStatsFor(300, isElite, isBoss);
  const zn = ctx.ZONE_CONFIG_TABLE ? ctx.ZONE_CONFIG_TABLE['swamp'] : ctx.ZONES['swamp'];

  const newEnemies = [];
  for (let i = 0; i < mobsPerWave; i++) {
    const enemyTable = zn.enemyTable || [];
    const enemyPairs = enemyTable.map(entry => [ctx.NPC_CONFIG_TABLE && ctx.NPC_CONFIG_TABLE[entry.npcId], Number(entry.weight) || 0]).filter(p => p[0] && p[1] > 0);
    const mtype = enemyPairs.length ? ctx.wpick(enemyPairs) : ctx.pick(zn.pool);
    const npcHpMult = Number(mtype.hpMult) > 0 ? Number(mtype.hpMult) : 1;
    const npcAtkMult = Number(mtype.atkMult) > 0 ? Number(mtype.atkMult) : 1;
    const npcDefMult = Number(mtype.defMult) > 0 ? Number(mtype.defMult) : 1;
    const mAspd = base.aspd * zn.aspdMult * (Number(mtype.aspdMult) > 0 ? Number(mtype.aspdMult) : 1);

    newEnemies.push({
      id: 'm_0_' + i,
      name: mtype.name,
      emoji: mtype.emoji,
      npcId: mtype.id || null,
      appearance: mtype.appearance || '',
      level: base.level,
      maxHp: base.hp * zn.hpMult * npcHpMult,
      hp: base.hp * zn.hpMult * npcHpMult,
      atk: base.atk * zn.atkMult * npcAtkMult,
      def: base.def * zn.defMult * npcDefMult,
      mdef: base.mdef * zn.defMult * npcDefMult,
      magic: !!mtype.magic,
      attr: mtype.attr || null,
      aspd: mAspd,
      dodge: base.dodge,
      hit: base.hit,
      elite: isElite,
      isBoss: isBoss,
      atkCd: 0,
      effects: {},
      ctrlRes: 0,
      _spawnAt: 0,
      _stage: -1,
      _enterCd: 0,
      shield: 0,
      buffs: {},
      dots: []
    });
  }

  const placed = ctx.bfPlaceEnemies(newEnemies, ctx.FIELD.monsters);
  ctx.FIELD.monsters = placed;
  ctx.syncFieldPrimary();

  let t = 0, dt = 0.05, totalDmg = 0;
  ctx.trackDps = function(dmg) { totalDmg += dmg; };
  const start = Date.now();
  while (t < 30) {
    ctx.fieldTick(dt);
    t += dt;
    ctx.FIELD.monsters = ctx.FIELD.monsters.filter(m => m && m.hp > 0);
    ctx.syncFieldPrimary();
    if (ctx.FIELD.monsters.length === 0) break;
  }
  const cost = Date.now() - start;
  console.log('Scenario ' + scenarioType + ' (' + enemyKind + '): CombatTime = ' + t.toFixed(2) + 's (Cost ' + cost + 'ms) | Total Dmg = ' + totalDmg.toLocaleString() + ' | DPS = ' + Math.round(totalDmg / t).toLocaleString());
}

testSim(1);
testSim(2);
testSim(3);
