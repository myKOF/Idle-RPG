'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_FILE = path.join(__dirname, 'all_ult_dps_results.json');

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

const ALL_ULT_SKILLS = [
  // 突刺
  { gid: 'thrust', groupName: '突刺', id: 'phantomOcta', name: '幻影八方陣', opt: 0, specialAffixes: ['evasion', 'aoeDmg'], mechanism: '範圍擴散 / 閃避生存', note: '命中擴散至周圍12m全體敵人+30%絕對閃避' },
  { gid: 'thrust', groupName: '突刺', id: 'shadowExecutioner', name: '暗影絕殺者', opt: 1, specialAffixes: ['aspd', 'pPen'], mechanism: '受傷加深 / 單體爆發', note: '突刺命中堆疊靈魂撕裂，最高+300%受傷' },
  { gid: 'thrust', groupName: '突刺', id: 'oneStrikeKill', name: '一擊必殺', opt: 2, specialAffixes: ['atkPct', 'critDmg'], mechanism: '直線重擊 / 小怪秒殺', note: '前方單一直線8倍爆發+直接斬殺普通怪' },

  // 迴旋斬
  { gid: 'cleave', groupName: '迴旋斬', id: 'voidShatter', name: '虛空碎裂斬', opt: 0, specialAffixes: ['aoeDmg', 'critDmg'], mechanism: '四方連續爆發', note: '迴身四方斬攻擊次數+3(共6段)+100%物理傷害' },
  { gid: 'cleave', groupName: '迴旋斬', id: 'windChaser', name: '逐風者', opt: 1, specialAffixes: ['elemDmgWind', 'dmgVsWind'], mechanism: '風系召喚 / 多段龍捲', note: '每擊生成龍捲風(8段每段200%風傷，4m半徑)' },
  { gid: 'cleave', groupName: '迴旋斬', id: 'stormGodSlash', name: '天霸風神斬', opt: 2, specialAffixes: ['aoeDmg', 'atkPct'], mechanism: '被動自動施放 / 零GCD', note: '範圍+30%，轉為被動技能每3秒自動施放' },

  // 飛刀
  { gid: 'knife', groupName: '飛刀', id: 'petalStorm', name: '暴雨梨花', opt: 0, specialAffixes: ['critRate', 'aoeDmg'], mechanism: '路徑貫穿 / 暴擊縮CD', note: '所有飛刀路徑貫穿40%傷害+100%暴擊縮短CD' },
  { gid: 'knife', groupName: '飛刀', id: 'deathReaper', name: '死亡收割者', opt: 1, specialAffixes: ['critRate', 'atkPct'], mechanism: '擊殺疊增傷 / 滾雪球', note: '擊殺堆疊死亡收割(每層+50%總傷害，最高20層=+1000%)' },
  { gid: 'knife', groupName: '飛刀', id: 'soulhunterBlade', name: '無限追魂刃', opt: 2, specialAffixes: ['critRate', 'aoeDmg'], mechanism: '全場鎖敵 / 無限彈射', note: '額外射出無限追魂刃(全場每個敵人各命中1次+100%傷害)' },

  // 疾風斬
  { gid: 'gale', groupName: '疾風斬', id: 'thunderFlash', name: '霹靂一閃', opt: 0, specialAffixes: ['aspd', 'critRate'], mechanism: '連擊數乘算 / 終結爆發', note: '最後一斬造成單段傷害×連擊數×10倍周圍6m爆發' },
  { gid: 'gale', groupName: '疾風斬', id: 'thunderGodSlash', name: '雷神斬', opt: 1, specialAffixes: ['elemDmgLightning', 'dmgVsLightning'], mechanism: '雷電落雷 / 範圍雷擊', note: '每次斬擊降下落雷(400%閃電傷害，8m範圍)' },
  { gid: 'gale', groupName: '疾風斬', id: 'chidori', name: '千鳥', opt: 2, specialAffixes: ['aoeDmg', 'atkPct'], mechanism: '月牙不均分 / 全額AOE', note: '月牙斬不再均分傷害，範圍內全員承受全額傷害+100%' },

  // 血刃斬
  { gid: 'bloodblade', groupName: '血刃斬', id: 'slayerDomain', name: '殺神領域', opt: 0, specialAffixes: ['atkPct', 'critDmg'], mechanism: '領域擊殺疊傷 / 續戰增傷', note: '永久24m領域，擊殺疊殺神(每層+4%全傷害，最高100層=+400%)' },
  { gid: 'bloodblade', groupName: '血刃斬', id: 'venomDomain', name: '萬毒血霧', opt: 1, specialAffixes: ['elemDmgPoison', 'dmgVsPoison'], mechanism: '劇毒領域 / 疊層DoT', note: '永久24m萬毒領域，每0.5秒200%毒傷，最高疊10層(2000%毒傷)' },
  { gid: 'bloodblade', groupName: '血刃斬', id: 'disintegrate', name: '崩解', opt: 2, specialAffixes: ['elemDmgPoison', 'atkPct'], mechanism: 'DoT立即引爆 / 屍爆連鎖', note: '流血與中毒立即結算全部持續傷害+6m範圍100%爆炸' },

  // 雙刀亂舞
  { gid: 'dualdance', groupName: '雙刀亂舞', id: 'doomDance', name: '毀滅之舞', opt: 0, specialAffixes: ['hpPct', 'atkPct'], mechanism: '損血增傷 / 超高倍率', note: '每次施放消耗5%生命，雙刀亂舞傷害+400%' },
  { gid: 'dualdance', groupName: '雙刀亂舞', id: 'flameKagura', name: '火之神樂', opt: 1, specialAffixes: ['elemDmgFire', 'dmgVsFire'], mechanism: '火焰附魔 / 疊層火DoT', note: '每次命中疊神樂灼焰(每0.5秒20%火傷，最高20層=400%火傷)' },
  { gid: 'dualdance', groupName: '雙刀亂舞', id: 'asuraDance', name: '修羅亂舞', opt: 2, specialAffixes: ['atkPct', 'critDmg'], isDualTwoHand: true, mechanism: '雙持雙手巨劍 / 詞條+40%', note: '副手可裝備第二把雙手巨劍，且雙手武器詞條效果+40%' }
];

function buildEquipment(ctx, itemDef) {
  const eq = {};
  const slots = ctx.SLOT_LIST;
  const useTwoHand = !!itemDef.isDualTwoHand;
  const specialAffixes = itemDef.specialAffixes || ['atkPct', 'critDmg'];

  slots.forEach(slot => {
    let affixes = [];
    if (specialAffixes.length >= 2) {
      affixes.push({ key: specialAffixes[0], roll: 100 });
      affixes.push({ key: specialAffixes[1], roll: 100 });
    }

    const pool = ['atkPct', 'atkFlat', 'critRate', 'critDmg', 'cdr', 'pPen', 'hit', 'aoeDmg'];
    for (let k of pool) {
      const maxAffixes = (useTwoHand && (slot === 'weapon' || slot === 'weapon2')) ? 6 : 5;
      if (affixes.length >= maxAffixes) break;
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

    if (useTwoHand && (slot === 'weapon' || slot === 'weapon2')) {
      item.weaponType = 'greatsword';
    } else if (slot === 'weapon') {
      item.weaponType = 'sword';
    }

    eq[slot] = item;
  });

  return eq;
}

function runSim(itemDef, scenarioType) {
  const ctx = createSimContext();
  const gid = itemDef.gid;
  const ultId = itemDef.id;
  const optIdx = itemDef.opt;

  ctx.G = ctx.newGameState();
  ctx.G.player.level = 100;
  ctx.G.player.reincarnations = 1;
  ctx.G.player.gold = 1000000000;
  ctx.G.player.skills2 = {
    levels: {
      [gid]: [10, 10, 10, 10, 10, 10, 10]
    },
    ult: {
      [gid]: { pick: optIdx, lv: 10 }
    }
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

  // Bypass monster attack and flocking calculations in pure player DPS benchmark
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

    // Prune dead monsters immediately
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
    ultId: itemDef.id,
    ultName: itemDef.name,
    mechanism: itemDef.mechanism,
    specialAffixes: itemDef.specialAffixes,
    note: itemDef.note,
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

function main() {
  console.log('Starting full DPS benchmark across all 18 Ult Skills × 3 Scenarios (54 tests)...');
  let results = [];
  if (fs.existsSync(RESULTS_FILE)) {
    try {
      results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    } catch (e) {}
  }

  for (const skill of ALL_ULT_SKILLS) {
    const existing = results.find(r => r.skill.id === skill.id);
    if (existing && existing.r1 && existing.r2 && existing.r3) {
      console.log(`[${skill.groupName} - ${skill.name}] (Cached)`);
      continue;
    }

    console.log(`Running benchmark for [${skill.groupName} - ${skill.name}]...`);
    const r1 = runSim(skill, 1);
    const r2 = runSim(skill, 2);
    const r3 = runSim(skill, 3);

    const idx = results.findIndex(r => r.skill.id === skill.id);
    const entry = { skill, r1, r2, r3 };
    if (idx >= 0) results[idx] = entry;
    else results.push(entry);

    console.log(`[${skill.groupName} - ${skill.name}]`);
    console.log(`  └─ S1(小怪 200隻/10波): DPS=${r1.dps.toLocaleString().padStart(12)} | 耗時=${r1.combatTime}s | 擊殺=${r1.killsCount}/200 | 峰值DPS=${r1.peakDps.toLocaleString()}`);
    console.log(`  └─ S2(菁英  25隻/5波):  DPS=${r2.dps.toLocaleString().padStart(12)} | 耗時=${r2.combatTime}s | 擊殺=${r2.killsCount}/25  | 峰值DPS=${r2.peakDps.toLocaleString()}`);
    console.log(`  └─ S3(BOSS   1隻):      DPS=${r3.dps.toLocaleString().padStart(12)} | 耗時=${r3.combatTime}s | 擊殺=${r3.killsCount}/1   | 峰值DPS=${r3.peakDps.toLocaleString()}`);

    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  }

  console.log('\nAll 54 tests completed successfully! Results written to ' + RESULTS_FILE);
}

if (require.main === module) {
  main();
}

module.exports = { ALL_ULT_SKILLS, runSim };
