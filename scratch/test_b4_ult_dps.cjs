'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_FILE = path.join(__dirname, 'b4_ult_dps_results.json');

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

const B4_TARGETS = [
  // 反擊基礎與超神
  { gid: 'counter', groupName: '反擊', isBase: true, id: 'base_counter', name: '基礎反擊 (1~7階滿級)', specialAffixes: ['blockRate', 'atkPct'], mechanism: '被動受擊反擊 / 格擋反殺', note: '未點超神進化' },
  { gid: 'counter', groupName: '反擊', isBase: false, id: 'holyBody', name: '神聖之體', opt: 0, specialAffixes: ['blockRate', 'aoeDmg'], mechanism: '計次神聖光彈 / 範圍AOE', note: '每10次反擊發射光彈對8m敵人造成800%神聖傷害' },
  { gid: 'counter', groupName: '反擊', isBase: false, id: 'indomitable', name: '不屈鬥魂', opt: 1, specialAffixes: ['hpPct', 'atkPct'], mechanism: '死亡地系爆發 / 鎖血復活', note: '死亡時30m範圍4000%地系傷害，倒地5s後滿血站起' },
  { gid: 'counter', groupName: '反擊', isBase: false, id: 'warGodBody', name: '戰神體', opt: 2, specialAffixes: ['hpPct', 'atkPct'], mechanism: '失血反擊加成 / 越殘越痛', note: '近2s內損失的生命%一併附加到反擊傷害' },

  // 嗜血狂怒基礎與超神
  { gid: 'bloodrage', groupName: '嗜血狂怒', isBase: true, id: 'base_bloodrage', name: '基礎嗜血狂怒 (1~7階滿級)', specialAffixes: ['aspd', 'atkPct'], mechanism: '主動攻速爆發 / 自傷增傷', note: '未點超神進化' },
  { gid: 'bloodrage', groupName: '嗜血狂怒', isBase: false, id: 'slayerAdvent', name: '殺神降臨', opt: 0, specialAffixes: ['aspd', 'aoeDmg'], mechanism: '狂怒普攻翻倍 / 8m群體重擊', note: '狂怒期間普攻傷害+200%且對目標周圍8m全體造成傷害' },
  { gid: 'bloodrage', groupName: '嗜血狂怒', isBase: false, id: 'warGodRoll', name: '戰神屠錄', opt: 1, specialAffixes: ['atkPct', 'critDmg'], mechanism: '禁護盾 / 擊殺無限疊傷', note: '狂怒期間無法獲得護盾，每擊殺疊+4%全傷(最高200層=+800%)持續到死' },
  { gid: 'bloodrage', groupName: '嗜血狂怒', isBase: false, id: 'asuraFist', name: '阿修羅霸王拳', opt: 2, specialAffixes: ['atkPct', 'critDmg'], mechanism: '週期性超狂爆發 / 全傷+1000%', note: '每10秒造成的所有傷害+1000%，持續2秒' }
];

function buildEquipment(ctx, itemDef) {
  const eq = {};
  const slots = ctx.SLOT_LIST;
  const gid = itemDef.gid;
  const isCounter = gid === 'counter';
  const isBloodrage = gid === 'bloodrage';
  const specialAffixes = itemDef.specialAffixes || ['atkPct', 'critDmg'];

  slots.forEach(slot => {
    let affixes = [];
    if (specialAffixes.length >= 2) {
      affixes.push({ key: specialAffixes[0], roll: 100 });
      affixes.push({ key: specialAffixes[1], roll: 100 });
    }

    const pool = ['atkPct', 'atkFlat', 'critRate', 'critDmg', 'cdr', 'pPen', 'hit', 'aoeDmg', 'blockRate', 'hpPct'];
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

    if (isCounter) {
      if (slot === 'weapon') {
        item.weaponType = 'sword1h';
      } else if (slot === 'weapon2') {
        item.weaponType = 'shield';
      }
    } else if (isBloodrage) {
      if (slot === 'weapon') {
        item.weaponType = 'greatsword2h';
      }
    } else {
      if (slot === 'weapon') item.weaponType = 'sword';
    }

    eq[slot] = item;
  });

  return eq;
}

function runB4Sim(itemDef, scenarioType) {
  const ctx = createSimContext();
  const gid = itemDef.gid;
  const isBase = itemDef.isBase;
  const optIdx = itemDef.opt;

  ctx.G = ctx.newGameState();
  ctx.G.player.level = 100;
  ctx.G.player.reincarnations = 1;
  ctx.G.player.gold = 1000000000;
  ctx.G.player.skills2 = {
    levels: {
      [gid]: [10, 10, 10, 10, 10, 10, 10]
    },
    ult: isBase ? {} : {
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

  // Optimize performance
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
    const ringDist = (typeof ctx.bfContactDist === 'function') ? ctx.bfContactDist() * 1.5 : 80;

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
        atkCd: (i % 5) * 0.2,
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
  const maxSimTime = 120.0;
  let currentWave = 0;
  let nextWaveTime = 0;
  let clearedAtTime = 0;
  const totalEnemiesToKill = totalWaves * mobsPerWave;

  ctx.GT = 0;
  spawnWave(0);
  currentWave = 1;
  nextWaveTime = waveInterval;

  while (ctx.GT < maxSimTime) {
    if (currentWave < totalWaves && ctx.GT >= nextWaveTime) {
      spawnWave(currentWave);
      currentWave++;
      nextWaveTime += waveInterval;
    }

    // Step simulation tick
    ctx.fieldTick(dt);
    ctx.GT += dt;

    // Trigger enemy attacks on player for counter / thorns mechanisms
    const p = ctx.FIELD.player;
    const activeEnemies = ctx.FIELD.monsters.filter(m => m && m.hp > 0);
    const attackBatch = Math.min(activeEnemies.length, 6);
    for (let i = 0; i < attackBatch; i++) {
      const m = activeEnemies[i];
      m.atkCd = (m.atkCd || 0) - dt;
      if (m.atkCd <= 0) {
        m.atkCd = 1 / (m.aspd || 1);
        const mCfg = ctx.monsterAtkCfg(m);
        const pDefCfg = ctx.playerDefCfg(p);
        const hitRes = ctx.resolveHit(m, p, mCfg, pDefCfg);
        if (hitRes && !hitRes.miss) {
          const dmg = hitRes.dmg || 50;
          p.hp = Math.max(1, p.hp - dmg);
          if (typeof ctx.skills2OnPlayerDamaged === 'function') {
            ctx.skills2OnPlayerDamaged(m, p, dmg, hitRes.blocked, hitRes, 'pv-float');
          }
        }
      }
    }

    // Prune dead monsters immediately
    if (ctx.FIELD.monsters.some(e => e && e.hp <= 0)) {
      ctx.FIELD.monsters = ctx.FIELD.monsters.filter(e => e && e.hp > 0);
      ctx.markFieldEnemyFloatTargets(ctx.FIELD.monsters);
      ctx.syncFieldPrimary();
    }

    const liveEnemies = ctx.FIELD.monsters.filter(e => e && e.hp > 0);
    if (currentWave >= totalWaves && liveEnemies.length === 0) {
      clearedAtTime = ctx.GT;
      break;
    }
  }

  const combatTime = clearedAtTime || ctx.GT;
  const avgDps = combatTime > 0 ? totalDamageDealt / combatTime : 0;
  const liveAtEnd = ctx.FIELD.monsters.filter(e => e && e.hp > 0).length;
  const killsCount = (currentWave * mobsPerWave) - liveAtEnd;

  let peakDps = 0;
  const windowSec = 1.0;
  for (let t = 0; t <= combatTime - windowSec; t += 0.2) {
    const wDmg = damageHistory
      .filter(d => d.t >= t && d.t < t + windowSec)
      .reduce((sum, d) => sum + d.dmg, 0);
    if (wDmg > peakDps) peakDps = wDmg;
  }

  return {
    item: itemDef,
    scenarioType,
    scenarioName: scenarioType === 1 ? '小怪群戰 (200隻)' : scenarioType === 2 ? '菁英攻堅 (25隻)' : '單體BOSS (1隻)',
    clearedTime: Number(combatTime.toFixed(2)),
    totalKills: killsCount,
    expectedKills: totalEnemiesToKill,
    cleared: killsCount >= totalEnemiesToKill,
    totalDamage: Math.round(totalDamageDealt),
    avgDps: Math.round(avgDps),
    peakDps: Math.round(peakDps),
    atkStat: Math.round(pStats.atk)
  };
}

console.log('⚔️ 開始執行傳奇進化第四批（B4：反擊 & 嗜血狂怒）基準戰鬥模擬...\n');

const results = [];

for (let target of B4_TARGETS) {
  console.log(`▶ 測試目標：[${target.groupName}] ${target.name} (${target.mechanism})`);
  const r1 = runB4Sim(target, 1);
  const r2 = runB4Sim(target, 2);
  const r3 = runB4Sim(target, 3);

  console.log(`   - 小怪群戰: ${r1.clearedTime}s | DPS: ${r1.avgDps.toLocaleString()} | 峰值: ${r1.peakDps.toLocaleString()} | 擊殺: ${r1.totalKills}/${r1.expectedKills}`);
  console.log(`   - 菁英攻堅: ${r2.clearedTime}s | DPS: ${r2.avgDps.toLocaleString()} | 峰值: ${r2.peakDps.toLocaleString()} | 擊殺: ${r2.totalKills}/${r2.expectedKills}`);
  console.log(`   - 單體BOSS: ${r3.clearedTime}s | DPS: ${r3.avgDps.toLocaleString()} | 峰值: ${r3.peakDps.toLocaleString()} | 擊殺: ${r3.totalKills}/${r3.expectedKills}`);
  console.log('------------------------------------------------------------');

  results.push({
    target,
    mob: r1,
    elite: r2,
    boss: r3
  });
}

fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf8');
console.log(`\n✅ 模擬完成！結果已寫入: ${RESULTS_FILE}`);
