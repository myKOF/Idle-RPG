'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_JSON = path.join(__dirname, 'all_69_ults_dps_results.json');

function createSimContext() {
  const ctx = {
    Math, Object, Array, Number, String, RegExp, console,
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    location: { hostname: 'localhost' },
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    BF_COLS: 10,
    BF_ROWS: 10
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);

  const files = [
    'js/worker/protocol.js', 'js/worker/shim.js',
    'js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js',
    'js/runeword_data.js', 'js/formula.js',
    'js/battlefield.js', 'js/stats.js', 'js/item.js', 'js/legendary.js', 'js/runeword.js',
    'js/skills.js', 'js/skills2.js', 'js/talents.js', 'js/player.js', 'js/combat.js',
    'js/tower.js', 'js/save.js'
  ];

  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}

// 載入技能與傳奇資料
const baseCtx = createSimContext();
const SKILLS2 = baseCtx.SKILLS2;
const csv = fs.readFileSync(path.join(ROOT, 'config/CSV/Equipment_Affix.csv'), 'utf8');
const affixesBySkill = {};

csv.split('\n').forEach(line => {
  const parts = line.split(',');
  if (parts[0] === '傳奇特效') {
    const id = parts[1];
    const name = parts[2];
    const skill = parts[14];
    const wp = parts[15];
    if (skill) {
      if (!affixesBySkill[skill]) affixesBySkill[skill] = [];
      affixesBySkill[skill].push({ id, name, wp });
    }
  }
});

// 建立 69 個超神進化技能測試目標清單
const TARGETS = [];
for (const [gid, grp] of Object.entries(SKILLS2)) {
  const affs = affixesBySkill[gid] || [];
  const ults = grp.ult || [];
  const primaryWp = affs[0] ? affs[0].wp : 'sword1h';
  const isTwoHand = ['greatsword2h', 'staff2h', 'axe2h', 'magicSword2h'].includes(primaryWp);
  const hasShield = primaryWp === 'shield';

  ults.forEach((u, optIdx) => {
    const isDualTwoHand = (gid === 'dualdance' && u.id === 'asuraDance');
    TARGETS.push({
      gid,
      groupName: grp.name,
      elem: grp.elem || 'phys',
      dmgType: grp.dmgType || 'phys',
      ultIndex: optIdx,
      ultId: u.id,
      ultName: u.name,
      ultDesc: u.desc,
      affixes: affs,
      primaryWp,
      isTwoHand,
      hasShield,
      isDualTwoHand
    });
  });
}

function buildEquipment(ctx, target) {
  const eq = {};
  const slots = ctx.SLOT_LIST;
  const isDualTwoHand = target.isDualTwoHand;
  const isTwoHand = target.isTwoHand;
  const hasShield = target.hasShield;
  const primaryWp = target.primaryWp;

  slots.forEach(slot => {
    const isMainWeapon = slot === 'weapon';
    const isOffhand = slot === 'weapon2';

    const affixes = [
      { key: 'atkPct', roll: 100 },
      { key: 'critDmg', roll: 100 },
      { key: 'atkFlat', roll: 100 },
      { key: 'critRate', roll: 100 },
      { key: 'pPen', roll: 100 },
      { key: 'matkPct', roll: 100 },
      { key: 'matkFlat', roll: 100 },
      { key: 'mPen', roll: 100 }
    ];

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

    if (isDualTwoHand && (isMainWeapon || isOffhand)) {
      item.weaponType = 'greatsword2h';
    } else if (isTwoHand && isMainWeapon) {
      item.weaponType = primaryWp;
    } else if (hasShield && isOffhand) {
      item.weaponType = 'shield';
    } else if (isMainWeapon) {
      item.weaponType = primaryWp === 'shield' ? 'sword1h' : primaryWp;
    }

    eq[slot] = item;
  });

  return eq;
}

function runSimulation(target, scenarioType, sampleDuration = 45.0) {
  const ctx = createSimContext();
  const gid = target.gid;
  const optIdx = target.ultIndex;

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
  ctx.G.stage.current = 300;
  ctx.G.stage.zone = 'swamp';

  ctx.G.equipment = buildEquipment(ctx, target);
  ctx.G.player.equipment = ctx.G.equipment;

  const pStats = ctx.computeStats();

  // 統一公平基準屬性
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

  // 確保物攻與魔攻、物理穿透與魔法穿透絕對對齊
  const maxAtk = Math.max(pStats.atk || 0, pStats.matk || 0, 50000);
  pStats.atk = maxAtk;
  pStats.matk = maxAtk;
  const maxPen = Math.max(pStats.pPen || 0, pStats.mPen || 0, 100);
  pStats.pPen = maxPen;
  pStats.mPen = maxPen;

  // 必帶該技能的 5 個傳奇效果
  pStats.legendaryEffects = {};
  pStats.legendaryEffectMults = {};
  const mult = target.isTwoHand || target.isDualTwoHand ? 2 : 1;
  target.affixes.forEach(aff => {
    pStats.legendaryEffects[aff.id] = true;
    pStats.legendaryEffectMults[aff.id] = mult;
  });

  ctx.bfResetPlayer();
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

  ctx.FIELD.player.hp = 1e15;
  ctx.FIELD.player.maxHp = 1e15;
  ctx.FIELD.player.mp = 1e15;
  ctx.FIELD.player.maxMp = 1e15;

  ctx.fieldMonsterAttack = function() { return false; };

  ctx.resetSkillRT();
  if (typeof ctx.resetSkill2RT === 'function') ctx.resetSkill2RT();

  let mobsPerWave = 1;
  let enemyKind = 'normal';
  if (scenarioType === 1) {
    mobsPerWave = 20;
    enemyKind = 'normal';
  } else if (scenarioType === 2) {
    mobsPerWave = 5;
    enemyKind = 'elite';
  } else if (scenarioType === 3) {
    mobsPerWave = 1;
    enemyKind = 'boss';
  }

  let totalDamageDealt = 0;
  ctx.trackDps = function(dmg) {
    if (dmg > 0) {
      totalDamageDealt += dmg;
      ctx.FIELD.dpsWindow.push([ctx.GT, dmg]);
    }
  };

  const origTickStatuses = ctx.tickStatuses;
  ctx.tickStatuses = function(ent, dt) {
    const oldHp = ent ? ent.hp : 0;
    const res = origTickStatuses ? origTickStatuses.apply(this, arguments) : false;
    if (ent && ent.maxHp > 0 && oldHp > ent.hp) {
      const dotDmg = oldHp - ent.hp;
      if (dotDmg > 0) ctx.trackDps(dotDmg);
    }
    return res;
  };

  function spawnWave() {
    const isBoss = enemyKind === 'boss';
    const isElite = enemyKind === 'elite';
    const s = 300;
    const base = ctx.monsterStatsFor(s, isElite, isBoss);
    const zn = ctx.ZONE_CONFIG_TABLE ? ctx.ZONE_CONFIG_TABLE['swamp'] : ctx.ZONES['swamp'];

    const newEnemies = [];
    for (let i = 0; i < mobsPerWave; i++) {
      const enemyTable = zn.enemyTable || [];
      const enemyPairs = enemyTable.map(entry => [ctx.NPC_CONFIG_TABLE && ctx.NPC_CONFIG_TABLE[entry.npcId], Number(entry.weight) || 0]).filter(p => p[0] && p[1] > 0);
      const mtype = enemyPairs.length ? ctx.wpick(enemyPairs) : ctx.pick(zn.pool);
      const npcHpMult = Number(mtype.hpMult) > 0 ? Number(mtype.hpMult) : 1;
      const npcAtkMult = Number(mtype.atkMult) > 0 ? Number(mtype.atkMult) : 1;
      const mAspd = base.aspd * zn.aspdMult * (Number(mtype.aspdMult) > 0 ? Number(mtype.aspdMult) : 1);

      newEnemies.push({
        id: 'm_0_' + i,
        name: mtype.name,
        emoji: mtype.emoji,
        npcId: mtype.id || null,
        appearance: mtype.appearance || mtype.emoji || '',
        level: base.level,
        maxHp: base.hp * zn.hpMult * npcHpMult,
        hp: base.hp * zn.hpMult * npcHpMult,
        atk: base.atk * zn.atkMult * npcAtkMult,
        def: 0,
        mdef: 0,
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
        _spawnAt: 0,
        _stage: -1,
        _enterCd: 0,
        shield: 0,
        buffs: {},
        dots: []
      });
    }

    const placed = ctx.bfPlaceEnemies(newEnemies, ctx.FIELD.monsters);
    ctx.FIELD.monsters = ctx.FIELD.monsters.concat(placed);
    ctx.markFieldEnemyFloatTargets(ctx.FIELD.monsters);
    ctx.syncFieldPrimary();
    return base;
  }

  const base = spawnWave();
  const dt = 0.05;
  let clearedAtTime = 0;
  const totalWaveHp = base.hp * mobsPerWave;

  ctx.GT = 0;

  while (ctx.GT < sampleDuration) {
    ctx.fieldTick(dt);
    ctx.GT += dt;

    // 定期攻擊玩家以觸發受擊/反擊/格擋機制
    const p = ctx.FIELD.player;
    const ms = ctx.FIELD.monsters;
    const attackBatch = Math.min(ms.length, 6);
    for (let i = 0; i < attackBatch; i++) {
      const m = ms[i];
      if (!m || m.hp <= 0) continue;
      m.atkCd = (m.atkCd || 0) - dt;
      if (m.atkCd <= 0) {
        m.atkCd = 1 / (m.aspd || 1);
        const mCfg = ctx.monsterAtkCfg(m);
        const pDefCfg = ctx.playerDefCfg(p);
        const hitRes = ctx.resolveHit(m, p, mCfg, pDefCfg);
        if (hitRes && !hitRes.miss) {
          const dmg = hitRes.dmg || 50000;
          p.hp = Math.max(1, p.hp - dmg);
          if (typeof ctx.skills2OnPlayerDamaged === 'function') {
            ctx.skills2OnPlayerDamaged(m, p, dmg, hitRes.blocked, hitRes, 'pv-float');
          }
        }
      }
    }

    // 剔除已死亡怪物
    let hasDead = false;
    for (let i = 0; i < ms.length; i++) {
      if (ms[i] && ms[i].hp <= 0) { hasDead = true; break; }
    }
    if (hasDead) {
      ctx.FIELD.monsters = ms.filter(e => e && e.hp > 0);
      ctx.markFieldEnemyFloatTargets(ctx.FIELD.monsters);
      ctx.syncFieldPrimary();
      if (ctx.FIELD.monsters.length === 0) {
        clearedAtTime = ctx.GT;
        break;
      }
    }
  }

  const dur = clearedAtTime > 0 ? clearedAtTime : ctx.GT;
  const avgDps = dur > 0 ? totalDamageDealt / dur : 0;
  const estimatedFullClearTime = clearedAtTime > 0
    ? clearedAtTime
    : (avgDps > 0 ? totalWaveHp / avgDps : 999999);

  return {
    scenarioType,
    scenarioName: scenarioType === 1 ? '普通小怪 (20隻)' : scenarioType === 2 ? '菁英怪 (5隻)' : '單體BOSS (1隻)',
    sampleDuration: Number(dur.toFixed(2)),
    totalDamage: Math.round(totalDamageDealt),
    avgDps: Math.round(avgDps),
    cleared: clearedAtTime > 0,
    clearedTime: Number(clearedAtTime.toFixed(2)),
    estimatedFullClearTime: Number(estimatedFullClearTime.toFixed(2))
  };
}

console.log(`⚔️ 開始執行全部 ${TARGETS.length} 招超神進化技能 DPS 驗證測試...`);
const allResults = [];

TARGETS.forEach((target, idx) => {
  const affNames = target.affixes.map(a => a.name).join('、');
  process.stdout.write(`[${idx + 1}/${TARGETS.length}] ${target.groupName} - ${target.ultName} (${target.ultId}) [傳奇: ${affNames}] ... `);
  
  const mob = runSimulation(target, 1, 40.0);
  const elite = runSimulation(target, 2, 40.0);
  const boss = runSimulation(target, 3, 40.0);

  allResults.push({
    target: {
      gid: target.gid,
      groupName: target.groupName,
      elem: target.elem,
      dmgType: target.dmgType,
      ultIndex: target.ultIndex,
      ultId: target.ultId,
      ultName: target.ultName,
      ultDesc: target.ultDesc,
      affixes: target.affixes.map(a => ({ id: a.id, name: a.name })),
      primaryWp: target.primaryWp,
      isTwoHand: target.isTwoHand
    },
    normalMob: mob,
    elite: elite,
    boss: boss
  });

  console.log(`小怪: ${(mob.avgDps / 1e9).toFixed(2)}B | 菁英: ${(elite.avgDps / 1e9).toFixed(2)}B | BOSS: ${(boss.avgDps / 1e6).toFixed(2)}M`);
});

fs.writeFileSync(OUTPUT_JSON, JSON.stringify(allResults, null, 2), 'utf8');
console.log(`\n✅ 69 招超神進化技能全部測試完畢！結果已寫入: ${OUTPUT_JSON}`);
