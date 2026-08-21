'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_FILE = path.join(__dirname, 'all_ult_standardized_results.json');

function createSimContext() {
  const ctx = {
    Math, Object, Array, Number, String, RegExp, console,
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    location: { hostname: 'localhost' },
    BF_COLS: 10,
    BF_ROWS: 10
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

const ALL_SKILL_TARGETS = [
  // 1. 突刺
  { gid: 'thrust', groupName: '突刺', isBase: true, id: 'base_thrust', name: '基礎突刺 (1~7階滿級)', note: '未點超神進化' },
  { gid: 'thrust', groupName: '突刺', isBase: false, id: 'phantomOcta', name: '幻影八方陣', opt: 0, note: '命中12m全額擴散 + 30%絕對閃避' },
  { gid: 'thrust', groupName: '突刺', isBase: false, id: 'shadowExecutioner', name: '暗影絕殺者', opt: 1, note: '命中堆疊靈魂撕裂最高+300%受傷' },
  { gid: 'thrust', groupName: '突刺', isBase: false, id: 'oneStrikeKill', name: '一擊必殺', opt: 2, note: '前方單道8倍重擊 + 普通小怪直接處決秒殺' },

  // 2. 迴旋斬
  { gid: 'cleave', groupName: '迴旋斬', isBase: true, id: 'base_cleave', name: '基礎迴旋斬 (1~7階滿級)', note: '未點超神進化' },
  { gid: 'cleave', groupName: '迴旋斬', isBase: false, id: 'voidShatter', name: '虛空碎裂斬', opt: 0, note: '迴身四方斬次數+3 + 100%物理傷害' },
  { gid: 'cleave', groupName: '迴旋斬', isBase: false, id: 'windChaser', name: '逐風者', opt: 1, note: '每擊生成8段200%風傷龍捲風' },
  { gid: 'cleave', groupName: '迴旋斬', isBase: false, id: 'stormGodSlash', name: '天霸風神斬', opt: 2, note: '轉為被動每3秒自動施放 + 範圍擴大30%' },

  // 3. 飛刀
  { gid: 'knife', groupName: '飛刀', isBase: true, id: 'base_knife', name: '基礎飛刀 (1~7階滿級)', note: '未點超神進化' },
  { gid: 'knife', groupName: '飛刀', isBase: false, id: 'petalStorm', name: '暴雨梨花', opt: 0, note: '路徑貫穿40%傷害 + 暴擊頻繁縮短CD' },
  { gid: 'knife', groupName: '飛刀', isBase: false, id: 'deathReaper', name: '死亡收割者', opt: 1, note: '擊殺堆疊死亡收割(最高+1000%總傷)' },
  { gid: 'knife', groupName: '飛刀', isBase: false, id: 'soulhunterBlade', name: '無限追魂刃', opt: 2, note: '全場鎖敵無限追魂刃(每怪各吃1發+100%傷害)' },

  // 4. 疾風斬
  { gid: 'gale', groupName: '疾風斬', isBase: true, id: 'base_gale', name: '基礎疾風斬 (1~7階滿級)', note: '未點超神進化' },
  { gid: 'gale', groupName: '疾風斬', isBase: false, id: 'thunderFlash', name: '霹靂一閃', opt: 0, note: '終結斬單段×連擊數×10倍周圍6m爆發' },
  { gid: 'gale', groupName: '疾風斬', isBase: false, id: 'thunderGodSlash', name: '雷神斬', opt: 1, note: '每次斬擊降下400%閃電落雷' },
  { gid: 'gale', groupName: '疾風斬', isBase: false, id: 'chidori', name: '千鳥', opt: 2, note: '月牙斬不再均分傷害，全員全額傷害+100%' },

  // 5. 血刃斬
  { gid: 'bloodblade', groupName: '血刃斬', isBase: true, id: 'base_bloodblade', name: '基礎血刃斬 (1~7階滿級)', note: '未點超神進化' },
  { gid: 'bloodblade', groupName: '血刃斬', isBase: false, id: 'slayerDomain', name: '殺神領域', opt: 0, note: '永久24m殺神領域，擊殺疊層增傷(最高+400%)' },
  { gid: 'bloodblade', groupName: '血刃斬', isBase: false, id: 'venomDomain', name: '萬毒血霧', opt: 1, note: '永久24m萬毒血霧，每0.5s疊層劇毒(最高2000%毒傷)' },
  { gid: 'bloodblade', groupName: '血刃斬', isBase: false, id: 'disintegrate', name: '崩解', opt: 2, note: '流血中毒立即結算全部持續傷害 + 6m爆炸' },

  // 6. 雙刀亂舞
  { gid: 'dualdance', groupName: '雙刀亂舞', isBase: true, id: 'base_dualdance', name: '基礎雙刀亂舞 (1~7階滿級)', note: '未點超神進化' },
  { gid: 'dualdance', groupName: '雙刀亂舞', isBase: false, id: 'doomDance', name: '毀滅之舞', opt: 0, note: '損血5%換取雙刀亂舞傷害+400%' },
  { gid: 'dualdance', groupName: '雙刀亂舞', isBase: false, id: 'flameKagura', name: '火之神樂', opt: 1, note: '雙刀附加神樂灼焰每跳疊層火傷' },
  { gid: 'dualdance', groupName: '雙刀亂舞', isBase: false, id: 'asuraDance', name: '修羅亂舞', opt: 2, isDualTwoHand: true, note: '雙持雙手巨劍，雙手詞條+40%雙倍加成' },

  // 7. 反擊
  { gid: 'counter', groupName: '反擊', isBase: true, id: 'base_counter', name: '基礎反擊 (1~7階滿級)', hasShield: true, note: '未點超神進化' },
  { gid: 'counter', groupName: '反擊', isBase: false, id: 'holyBody', name: '神聖之體', opt: 0, hasShield: true, note: '每10次反擊射出8m神聖光彈(800%神聖傷害)' },
  { gid: 'counter', groupName: '反擊', isBase: false, id: 'indomitable', name: '不屈鬥魂', opt: 1, hasShield: true, note: '死亡30m範圍4000%地系爆發，倒地5s原地滿血復活' },
  { gid: 'counter', groupName: '反擊', isBase: false, id: 'warGodBody', name: '戰神體', opt: 2, hasShield: true, note: '近2s失血百分比完全疊加至反擊傷害' },

  // 8. 嗜血狂怒
  { gid: 'bloodrage', groupName: '嗜血狂怒', isBase: true, id: 'base_bloodrage', name: '基礎嗜血狂怒 (1~7階滿級)', isTwoHand: true, note: '未點超神進化' },
  { gid: 'bloodrage', groupName: '嗜血狂怒', isBase: false, id: 'slayerAdvent', name: '殺神降臨', opt: 0, isTwoHand: true, note: '狂怒普攻傷害+200%且擴散8m全體' },
  { gid: 'bloodrage', groupName: '嗜血狂怒', isBase: false, id: 'warGodRoll', name: '戰神屠錄', opt: 1, isTwoHand: true, note: '禁護盾但每擊殺+4%全傷(最高+800%持續至死)' },
  { gid: 'bloodrage', groupName: '嗜血狂怒', isBase: false, id: 'asuraFist', name: '阿修羅霸王拳', opt: 2, isTwoHand: true, note: '每10秒+1000%全傷害超狂爆發(持續2秒)' }
];

function buildStandardEquipment(ctx, target) {
  const eq = {};
  const slots = ctx.SLOT_LIST;
  const isDualTwoHand = !!target.isDualTwoHand;
  const isTwoHand = !!target.isTwoHand;
  const hasShield = !!target.hasShield;

  // 核心傷害詞條絕對一致（所有技能裝備詞條完全相同，不進行個別詞條替換）
  slots.forEach(slot => {
    const isMainWeapon = slot === 'weapon';
    const isOffhand = slot === 'weapon2';

    let affixes = [
      { key: 'atkPct', roll: 100 },
      { key: 'critDmg', roll: 100 },
      { key: 'atkFlat', roll: 100 },
      { key: 'critRate', roll: 100 },
      { key: 'pPen', roll: 100 }
    ];

    // 雙手武器在雙手槽位可容納第 6 條詞條（雙手補償）
    if ((isTwoHand && isMainWeapon) || (isDualTwoHand && (isMainWeapon || isOffhand))) {
      affixes.push({ key: 'aoeDmg', roll: 100 });
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

    if (isTwoHand && isMainWeapon) {
      item.weaponType = 'greatsword2h';
    } else if (isDualTwoHand && (isMainWeapon || isOffhand)) {
      item.weaponType = 'greatsword2h';
    } else if (hasShield && isOffhand) {
      item.weaponType = 'shield';
    } else if (isMainWeapon) {
      item.weaponType = 'sword1h';
    }

    eq[slot] = item;
  });

  return eq;
}

function runStandardSim(target, scenarioType) {
  const ctx = createSimContext();
  const gid = target.gid;
  const isBase = target.isBase;
  const optIdx = target.opt;

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

  ctx.G.equipment = buildStandardEquipment(ctx, target);
  ctx.G.player.equipment = ctx.G.equipment;

  const pStats = ctx.computeStats();

  // 依照使用者指示之公平基準屬性：
  // 格擋率 50%，格擋減傷 80%，連擊數 3，全屬性增傷害 +1000%
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
  // 怪物正常逼近與跑動：保留原生 bfTickApproach

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
        shield: 0,
        buffs: {},
        dots: []
      });
    }

    // 野外出怪方式：從外圍生成 (bfSpawnDist ~440px)，朝玩家跑動
    const placed = ctx.bfPlaceEnemies(newEnemies, ctx.FIELD.monsters);
    ctx.FIELD.monsters = ctx.FIELD.monsters.concat(placed);
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

    ctx.fieldTick(dt);
    ctx.GT += dt;

    // Trigger enemy attacks on player for counter / retaliation / thorns mechanisms
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
    target,
    scenarioType,
    scenarioName: scenarioType === 1 ? '小怪群戰 (200隻)' : scenarioType === 2 ? '菁英攻堅 (25隻)' : '單體BOSS (1隻)',
    clearedTime: Number(combatTime.toFixed(2)),
    totalKills: killsCount,
    expectedKills: totalEnemiesToKill,
    cleared: killsCount >= totalEnemiesToKill,
    totalDamage: Math.round(totalDamageDealt),
    avgDps: Math.round(avgDps),
    peakDps: Math.round(peakDps),
    atkStat: Math.round(pStats.atk),
    critDmgStat: pStats.critDmg,
    critRateStat: pStats.critRate
  };
}

console.log('⚔️ 開始執行全 8 大技能群組（24 招超神進化 + 8 招基礎）嚴格標準化 DPS 模擬測試...\n');

const results = [];

for (let target of ALL_SKILL_TARGETS) {
  console.log(`▶ 測試目標：[${target.groupName}] ${target.name}`);
  const r1 = runStandardSim(target, 1);
  const r2 = runStandardSim(target, 2);
  const r3 = runStandardSim(target, 3);

  console.log(`   - 小怪群戰: ${r1.clearedTime}s | DPS: ${r1.avgDps.toLocaleString()} | 擊殺: ${r1.totalKills}/${r1.expectedKills}`);
  console.log(`   - 菁英攻堅: ${r2.clearedTime}s | DPS: ${r2.avgDps.toLocaleString()} | 擊殺: ${r2.totalKills}/${r2.expectedKills}`);
  console.log(`   - 單體BOSS: ${r3.clearedTime}s | DPS: ${r3.avgDps.toLocaleString()} | 擊殺: ${r3.totalKills}/${r3.expectedKills}`);
  console.log('------------------------------------------------------------');

  results.push({
    target,
    mob: r1,
    elite: r2,
    boss: r3
  });
}

fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf8');
console.log(`\n✅ 全量 96 場標準化模擬完成！結果已寫入: ${RESULTS_FILE}`);
