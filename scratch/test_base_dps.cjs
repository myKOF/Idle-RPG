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

const BASE_SKILLS = [
  { gid: 'thrust', groupName: '突刺', name: '基礎突刺 (1~7階滿級)', specialAffixes: ['atkPct', 'critDmg'], note: '未點超神進化' },
  { gid: 'cleave', groupName: '迴旋斬', name: '基礎迴旋斬 (1~7階滿級)', specialAffixes: ['aoeDmg', 'atkPct'], note: '未點超神進化' },
  { gid: 'knife', groupName: '飛刀', name: '基礎飛刀 (1~7階滿級)', specialAffixes: ['critRate', 'aoeDmg'], note: '未點超神進化' },
  { gid: 'gale', groupName: '疾風斬', name: '基礎疾風斬 (1~7階滿級)', specialAffixes: ['aspd', 'critRate'], note: '未點超神進化' },
  { gid: 'bloodblade', groupName: '血刃斬', name: '基礎血刃斬 (1~7階滿級)', specialAffixes: ['elemDmgPoison', 'atkPct'], note: '未點超神進化' },
  { gid: 'dualdance', groupName: '雙刀亂舞', name: '基礎雙刀亂舞 (1~7階滿級)', specialAffixes: ['atkPct', 'critDmg'], note: '未點超神進化' }
];

function buildEquipment(ctx, itemDef) {
  const eq = {};
  const slots = ctx.SLOT_LIST;
  const specialAffixes = itemDef.specialAffixes || ['atkPct', 'critDmg'];

  slots.forEach(slot => {
    let affixes = [];
    if (specialAffixes.length >= 2) {
      affixes.push({ key: specialAffixes[0], roll: 100 });
      affixes.push({ key: specialAffixes[1], roll: 100 });
    }

    const pool = ['atkPct', 'atkFlat', 'critRate', 'critDmg', 'cdr', 'pPen', 'hit', 'aoeDmg'];
    for (let k of pool) {
      if (affixes.length >= 5) break;
      if (!affixes.some(a => a.key === k)) {
        affixes.push({ key: k, roll: 100 });
      }
    }

    const item = {
      id: 'eq_' + slot,
      kind: 'equip',
      slot: slot,
      rarity: 5,
      level: 100,
      name: '100級傳奇裝備',
      affixes: affixes,
      upgrade: 40,
      sockets: []
    };

    if (slot === 'weapon') item.weaponType = 'sword';
    eq[slot] = item;
  });

  return eq;
}

function runBaseSim(itemDef, scenarioType) {
  const ctx = createSimContext();
  const gid = itemDef.gid;

  ctx.G = ctx.newGameState();
  ctx.G.player.level = 100;
  ctx.G.player.reincarnations = 1;
  ctx.G.player.gold = 1000000000;
  ctx.G.player.skills2 = {
    levels: {
      [gid]: [10, 10, 10, 10, 10, 10, 10]
    },
    ult: {} // No Ult picked!
  };
  ctx.G.player.loadout = ['sg:' + gid];
  ctx.G.stage.current = 100;
  ctx.G.stage.zone = 'Icefield';

  ctx.G.equipment = buildEquipment(ctx, itemDef);
  ctx.G.player.equipment = ctx.G.equipment;

  const pStats = ctx.computeStats();
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

  ctx.fieldMonsterAttack = function() { return false; };
  ctx.bfTickApproach = function() { return []; };

  ctx.resetSkillRT();
  if (typeof ctx.resetSkill2RT === 'function') ctx.resetSkill2RT();

  let totalWaves = 1;
  let waveInterval = 2.0;
  let mobsPerWave = 1;
  let enemyKind = 'normal';

  if (scenarioType === 1) {
    totalWaves = 10;
    mobsPerWave = 20;
    enemyKind = 'normal';
  } else if (scenarioType === 2) {
    totalWaves = 5;
    mobsPerWave = 5;
    enemyKind = 'elite';
  } else if (scenarioType === 3) {
    totalWaves = 1;
    mobsPerWave = 1;
    enemyKind = 'boss';
  }

  let totalDamageDealt = 0;
  let damageHistory = [];

  ctx.trackDps = function(dmg) {
    if (dmg > 0) {
      totalDamageDealt += dmg;
      damageHistory.push({ t: ctx.GT, dmg: dmg });
      ctx.FIELD.dpsWindow.push([ctx.GT, dmg]);
    }
  };

  function spawnWave(waveIdx) {
    const isBoss = enemyKind === 'boss';
    const isElite = enemyKind === 'elite';
    const s = 100;
    const base = ctx.monsterStatsFor(s, isElite, isBoss);
    const zn = ctx.ZONE_CONFIG_TABLE ? ctx.ZONE_CONFIG_TABLE['Icefield'] : ctx.ZONES['Icefield'];
    const home = (typeof ctx.bfPlayerPos === 'function') ? ctx.bfPlayerPos() : { x: 0, y: 0 };
    const ringDist = (typeof ctx.bfContactDist === 'function') ? ctx.bfContactDist() * 2.5 : 120;

    const newEnemies = [];
    for (let i = 0; i < mobsPerWave; i++) {
      const enemyTable = zn.enemyTable || [];
      const enemyPairs = enemyTable.map(entry => [ctx.NPC_CONFIG_TABLE && ctx.NPC_CONFIG_TABLE[entry.npcId], Number(entry.weight) || 0]).filter(p => p[0] && p[1] > 0);
      const mtype = enemyPairs.length ? ctx.wpick(enemyPairs) : ctx.pick(zn.pool);
      const npcHpMult = Number(mtype.hpMult) > 0 ? Number(mtype.hpMult) : 1;
      const npcAtkMult = Number(mtype.atkMult) > 0 ? Number(mtype.atkMult) : 1;
      const npcDefMult = Number(mtype.defMult) > 0 ? Number(mtype.defMult) : 1;
      const mAspd = base.aspd * zn.aspdMult * (Number(mtype.aspdMult) > 0 ? Number(mtype.aspdMult) : 1);
      const ang = Math.PI * 2 * (i + waveIdx * 0.3) / mobsPerWave;

      newEnemies.push({
        id: 'm_' + waveIdx + '_' + i,
        name: mtype.name,
        emoji: mtype.emoji,
        npcId: mtype.id || null,
        appearance: mtype.appearance || mtype.emoji || '',
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
        gold: base.gold * zn.rewardMult,
        xp: base.xp * zn.rewardMult,
        atkCd: 1 / mAspd,
        effects: {},
        ctrlRes: 0,
        _spawnAt: ctx.GT,
        _stage: -1,
        _enterCd: 0,
        pos: { x: home.x + Math.cos(ang) * ringDist, y: home.y + Math.sin(ang) * ringDist },
        shield: 0,
        buffs: {},
        dots: []
      });
    }

    ctx.FIELD.monsters = ctx.FIELD.monsters.concat(newEnemies);
    ctx.markFieldEnemyFloatTargets(ctx.FIELD.monsters);
    ctx.syncFieldPrimary();
  }

  const dt = 0.05;
  const maxTime = 120.0;
  let currentWave = 0;
  let nextWaveTime = 0;
  let clearedTime = null;
  const totalEnemiesExpected = totalWaves * mobsPerWave;

  ctx.GT = 0;
  spawnWave(0);
  currentWave = 1;
  nextWaveTime = waveInterval;

  while (ctx.GT < maxTime) {
    if (currentWave < totalWaves && ctx.GT >= nextWaveTime) {
      spawnWave(currentWave);
      currentWave++;
      nextWaveTime += waveInterval;
    }

    ctx.fieldTick(dt);
    ctx.GT += dt;

    if (ctx.FIELD.monsters.some(e => e && e.hp <= 0)) {
      ctx.FIELD.monsters = ctx.FIELD.monsters.filter(e => e && e.hp > 0);
      ctx.markFieldEnemyFloatTargets(ctx.FIELD.monsters);
      ctx.syncFieldPrimary();
    }

    const liveEnemies = ctx.FIELD.monsters.filter(e => e && e.hp > 0);
    if (currentWave >= totalWaves && liveEnemies.length === 0) {
      clearedTime = ctx.GT;
      break;
    }
  }

  const combatTime = clearedTime || ctx.GT;
  const dps = combatTime > 0 ? totalDamageDealt / combatTime : 0;

  let peakDps = 0;
  const windowSec = 1.0;
  for (let t = 0; t <= combatTime - windowSec; t += 0.2) {
    const wDmg = damageHistory
      .filter(d => d.t >= t && d.t < t + windowSec)
      .reduce((sum, d) => sum + d.dmg, 0);
    if (wDmg > peakDps) peakDps = wDmg;
  }

  const liveAtEnd = ctx.FIELD.monsters.filter(e => e && e.hp > 0).length;
  const killsCount = (currentWave * mobsPerWave) - liveAtEnd;

  return {
    gid: itemDef.gid,
    groupName: itemDef.groupName,
    scenarioType,
    combatTime: Number(combatTime.toFixed(2)),
    cleared: clearedTime !== null,
    totalDamageDealt: Math.round(totalDamageDealt),
    dps: Math.round(dps),
    peakDps: Math.round(peakDps),
    killsCount,
    totalEnemies: totalEnemiesExpected,
    playerAtk: Math.round(pStats.atk)
  };
}

console.log('Running Base (No Ult) benchmarks for all 6 skill groups...');
const baseResults = {};

for (const skill of BASE_SKILLS) {
  const r1 = runBaseSim(skill, 1);
  const r2 = runBaseSim(skill, 2);
  const r3 = runBaseSim(skill, 3);
  baseResults[skill.gid] = { gid: skill.gid, groupName: skill.groupName, r1, r2, r3 };
  console.log(`[基礎 ${skill.groupName}]`);
  console.log(`  └─ S1(200小怪): DPS=${r1.dps.toLocaleString()} | 耗時=${r1.combatTime}s | 擊殺=${r1.killsCount}/200 | 峰值DPS=${r1.peakDps.toLocaleString()}`);
  console.log(`  └─ S2(25菁英):  DPS=${r2.dps.toLocaleString()} | 耗時=${r2.combatTime}s | 擊殺=${r2.killsCount}/25  | 峰值DPS=${r2.peakDps.toLocaleString()}`);
  console.log(`  └─ S3(BOSS):    DPS=${r3.dps.toLocaleString()} | 耗時=${r3.combatTime}s | 擊殺=${r3.killsCount}/1   | 峰值DPS=${r3.peakDps.toLocaleString()}`);
}

fs.writeFileSync(path.join(ROOT, 'scratch/base_skills_dps_results.json'), JSON.stringify(baseResults, null, 2));
console.log('Done! Saved to scratch/base_skills_dps_results.json');
