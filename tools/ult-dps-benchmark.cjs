'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
// Based on scratch/run_all_69_ults_dps.cjs; isolated dated rerun, legacy files preserved.
const SOURCE_FILES = [];

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_JSON = path.join(ROOT, 'docs/skill-tests/20261026-ult-dps-results.json');
const BASE_SEED = 20261026;
const TEST_LEVEL = 100;
function seededMath(seed) {
  const math = Object.create(Math);
  let state = seed >>> 0;
  math.random = () => { state = (state + 0x6D2B79F5) >>> 0; let v = state; v = Math.imul(v ^ v >>> 15, v | 1); v ^= v + Math.imul(v ^ v >>> 7, v | 61); return ((v ^ v >>> 14) >>> 0) / 4294967296; };
  return math;
}

function createSimContext(seed = BASE_SEED) {
  const ctx = {
    Math: seededMath(seed), Object, Array, Number, String, RegExp, console,
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    location: { hostname: 'localhost' },
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    pushConveyor() {},
    rollFieldDrops() { return []; },
    gainXp() {},
    gainSkillMasteryXp() {},
    blog() {},
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

  if (!SOURCE_FILES.length) SOURCE_FILES.push(...files);
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

assert.equal(Object.keys(SKILLS2).length, 23);
for (const gid of Object.keys(SKILLS2)) assert.equal((affixesBySkill[gid] || []).length, 5, gid + ' legendary effects');
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

    // Identical affix keys and rolls on all 13 slots for every skill.
    affixes.push({ key: 'aoeDmg', roll: 100 });

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

function prepareSimulation(target, scenarioType, totalDuration = 150, warmupDuration = 30) {
  const seed = BASE_SEED + scenarioType;
  const ctx = createSimContext(seed);
  ctx.GM_TEST = { skillUnlock: true, hpLock: true, mpLock: true };
  // Kills must not level the benchmark player above the fixed same-level enemies.
  ctx.gainXp = () => {};
  ctx.gainSkillMasteryXp = () => {};
  const gid = target.gid;
  const optIdx = target.ultIndex;

  ctx.G = ctx.newGameState();
  ctx.G.player.level = TEST_LEVEL;
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
  ctx.G.stage.current = TEST_LEVEL;
  ctx.G.stage.zone = 'swamp';

  ctx.G.equipment = buildEquipment(ctx, target);
  ctx.G.player.equipment = ctx.G.equipment;

  const pStats = ctx.computeStats();
  const rawStats = { atk: pStats.atk, matk: pStats.matk, critRate: pStats.critRate, critDmg: pStats.critDmg };

  // 統一公平基準屬性
  pStats.blockRate = 50;
  pStats.blockDmgRed = 80;
  pStats.comboHits = 3;
  pStats.totalDmgPct = 1000;
  pStats.critRate = 100;
  pStats.critDmg = 5996;
  pStats.elemDmgPct = {};
  ctx.ELEMENTS.forEach(e => { pStats.elemDmgPct[e] = 0; pStats.elemDmgUp[e] = 1000; });
  pStats.atk = pStats.matk = 50000;
  pStats.pPen = pStats.mPen = 100;
  const maxEnemyDodge = Math.max(...[1, 2, 3].map(s => ctx.monsterStatsFor(TEST_LEVEL, s === 2, s === 3, 0).dodge));
  pStats.hit = 100 + maxEnemyDodge;
  // computeStats() returns a new object. Cache the normalized object actually used by combat.
  ctx.getStats = () => pStats;

  // 必帶該技能的 5 個傳奇效果
  pStats.legendaryEffects = {};
  pStats.legendaryEffectMults = {};
  const mult = target.isTwoHand || target.isDualTwoHand ? ctx.TWO_HAND_EFFECT_VALUE_MULT : 1;
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

  // Use the game's native locks, including incoming damage, self costs and trigger costs.
  // Huge initial resources alone do not prevent death or mana exhaustion after revival.
  ctx.FIELD.player.hp = pStats.hp;
  ctx.FIELD.player.mp = pStats.mp;
  const damageAudit = { playerHitAttempts: 0, playerHitMisses: 0, minHitChance: 100,
    fatalHits: 0, fatalDirect: 0, rejectedDeadHits: 0, rejectedDeadDirect: 0 };
  const nativeResolveHit = ctx.resolveHit;
  ctx.resolveHit = function(attacker, defender, attack, defense) {
    if (attack && attack.isPlayer && defender && !(defender.hp > 0)) {
      damageAudit.rejectedDeadHits++;
      return { dmg: 0, hpDamage: 0, crit: false, miss: false, blocked: false, killed: false,
        thorns: 0, heal: 0, shield: 0, absorbed: 0, manaShield: 0, procs: [] };
    }
    const outgoing = !!(attack && attack.isPlayer && defender && defender.maxHp > 0);
    if (outgoing) {
      const chance = Math.max(5, Math.min(100, Number(attack.hit) - (Number(defense.dodge) || 0)));
      damageAudit.minHitChance = Math.min(damageAudit.minHitChance, chance);
      assert.equal(chance, 100, 'Effective player hit chance below 100%');
      damageAudit.playerHitAttempts++;
    }
    const result = nativeResolveHit.apply(this, arguments);
    if (outgoing) {
      if (result.miss) damageAudit.playerHitMisses++;
      assert.equal(!!result.miss, false, 'Player attack missed under the 100% hit benchmark');
      if (result.killed) damageAudit.fatalHits++;
    }
    return result;
  };
  const nativeDirectDamage = ctx.applyEnemyHpDamage;
  ctx.applyEnemyHpDamage = function(target, amount) {
    const enemy = target && target.maxHp > 0;
    if (enemy && !(target.hp > 0)) { damageAudit.rejectedDeadDirect++; return 0; }
    const dealt = nativeDirectDamage.apply(this, arguments);
    if (enemy && dealt > 0 && target.hp <= 0) damageAudit.fatalDirect++;
    return dealt;
  };
  const resources = { hpLock: true, mpLock: true, deaths: 0, revivalTicks: 0,
    minHp: pStats.hp, minMp: pStats.mp };
  ctx.onPlayerFieldDeath = () => { resources.deaths++; throw new Error(target.ultId + ': player died with HP lock'); };
  function checkResources() {
    const p = ctx.FIELD.player;
    assert.ok(ctx.gmHpLockActive(p) && ctx.gmMpLockActive(p), 'Native resource locks disabled');
    assert.ok(p.hp > 0, target.ultId + ': nonpositive player HP');
    assert.equal(ctx.G.player.level, TEST_LEVEL, 'Player level changed during benchmark');
    if (p._sgRevival || ctx.FIELD.reviveCd > 0) resources.revivalTicks++;
    assert.equal(resources.revivalTicks, 0, target.ultId + ': revival interrupted benchmark');
    resources.minHp = Math.min(resources.minHp, p.hp);
    resources.minMp = Math.min(resources.minMp, p.mp);
  }

  // Preserve the reference harness controlled incoming attacks (up to six per tick,
  // no distance check); do not mix them with native enemy attack scheduling.
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

  assert.equal(ctx.skills2Levels(gid).join(','), '10,10,10,10,10,10,10');
  assert.ok(ctx.sgUlt(gid, target.ultId), 'Ultimate not active: ' + target.ultId);
  const damage = createDamageCollector(warmupDuration, totalDuration);
  const kills = { total: 0, sample: 0 };
  // Native onFieldKill calls this after its _rewarded / revive checks. Count actual
  // settled kills, not damage events, and count a legitimately revived enemy again.
  ctx.recordLootKill = () => {
    kills.total++;
    if (ctx.GT >= warmupDuration && ctx.GT < totalDuration) kills.sample++;
  };
  const casts = {};
  const sampleCasts = {};
  // One canonical accounting path includes direct, derived, legendary and DOT damage,
  // including overkill, without HP-delta rounding/clipping or double-counting explosions.
  ctx.recordRunDamage = (name, amount, key, level, subType) => damage.record(ctx.GT, name, amount, key, subType);
  ctx.recordRunSkillCast = (name, key) => {
    const id = key || name;
    casts[id] = (casts[id] || 0) + 1;
    if (ctx.GT >= warmupDuration && ctx.GT < totalDuration) sampleCasts[id] = (sampleCasts[id] || 0) + 1;
  };
  let waveCount = 0, enemySerial = 0;
  const waves = [];

  function spawnWave() {
    const isBoss = enemyKind === 'boss';
    const isElite = enemyKind === 'elite';
    const base = ctx.monsterStatsFor(TEST_LEVEL, isElite, isBoss, 0);
    assert.equal(base.level, TEST_LEVEL);
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
        id: 'm_' + (++enemySerial),
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
        _spawnAt: ctx.GT || 0,
        _stage: -1,
        _enterCd: 0,
        shield: 0,
        buffs: {},
        dots: []
      });
    }

    waveCount++;
    waves.push({ wave: waveCount, at: ctx.GT || 0, level: base.level, count: mobsPerWave,
      totalHp: newEnemies.reduce((sum, m) => sum + m.maxHp, 0), npcIds: newEnemies.map(m => m.npcId) });
    const placed = ctx.bfPlaceEnemies(newEnemies, ctx.FIELD.monsters);
    ctx.FIELD.monsters = ctx.FIELD.monsters.concat(placed);
    ctx.markFieldEnemyFloatTargets(ctx.FIELD.monsters);
    ctx.syncFieldPrimary();
    return base;
  }

  ctx.GT = 0;
  spawnWave();
  const dt = 0.05;
  assert.equal(totalDuration / dt, Math.round(totalDuration / dt));
  function tick(step) {
    ctx.GT = Number((step * dt).toFixed(8));
    ctx.fieldTick(dt);
    checkResources();

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
        checkResources();
        if (hitRes && !hitRes.miss) {
          // resolveHit already deducted HP and absorbed shields. Never subtract twice,
          // and never invent damage when the hit was fully absorbed or invulnerable.
          const dmg = hitRes.hpDamage || 0;
          if (typeof ctx.skills2OnPlayerDamaged === 'function') {
            ctx.skills2OnPlayerDamaged(m, p, dmg, hitRes.blocked, hitRes, 'pv-float');
          }
        }
      }
    }

    // 檢查戰場：只要場上無存活怪物，立即無縫補充新波次
    if (ctx.liveFieldEnemies().length === 0) {
      spawnWave();
    }
    checkResources();
  }

  return { ctx, pStats, rawStats, tick, damage, damageAudit, kills, casts, sampleCasts, resources, waves, dt, seed, totalDuration, warmupDuration,
    baseline: { atk: pStats.atk, matk: pStats.matk, pPen: pStats.pPen, mPen: pStats.mPen,
      critRate: pStats.critRate, critDmg: pStats.critDmg, totalDmgPct: pStats.totalDmgPct,
      elemDmgUp: { ...pStats.elemDmgUp }, blockRate: pStats.blockRate, blockDmgRed: pStats.blockDmgRed,
      comboHits: pStats.comboHits, hp: pStats.hp, mp: pStats.mp, aspd: pStats.aspd, hit: pStats.hit,
      maxEnemyDodge, aoeDmg: pStats.aoeDmg },
    legendaryMultiplier: mult };
}

function createDamageCollector(warmup, end) {
  const collector = { total: 0, events: 0, allTimeTotal: 0, sources: {}, subTypes: {} };
  collector.record = (time, name, amount, key, subType) => {
    assert.ok(Number.isFinite(amount) && amount >= 0, 'Invalid damage: ' + amount);
    if (!(amount > 0)) return;
    collector.allTimeTotal += amount;
    if (!(time >= warmup && time < end)) return;
    collector.total += amount;
    collector.events++;
    const id = key || name;
    const source = collector.sources[id] || (collector.sources[id] = { name, damage: 0, events: 0 });
    source.damage += amount;
    source.events++;
    const sub = subType || name;
    const detail = collector.subTypes[sub] || (collector.subTypes[sub] = { damage: 0, events: 0 });
    detail.damage += amount;
    detail.events++;
  };
  return collector;
}

function runSimulation(target, scenarioType, totalDuration = 150, warmupDuration = 30) {
  const sim = prepareSimulation(target, scenarioType, totalDuration, warmupDuration);
  for (let step = 0; step < totalDuration / sim.dt; step++) sim.tick(step);
  const sampleDuration = totalDuration - warmupDuration;
  assert.ok(sampleDuration > 0);
  assert.ok(sim.damage.allTimeTotal > 0, target.ultId + ' never acted');
  return { scenarioType, scenarioName: ['','普通小怪 (20隻)','菁英怪 (5隻)','單體BOSS (1隻)'][scenarioType],
    sampleDuration, totalDuration, warmupDuration, steps: totalDuration / sim.dt, seed: sim.seed,
    totalDamage: sim.damage.total, avgDps: sim.damage.total / sampleDuration,
    playerLevel: sim.ctx.G.player.level, enemyLevel: TEST_LEVEL, kills: sim.kills,
    damageEvents: sim.damage.events, sources: sim.damage.sources, subTypes: sim.damage.subTypes,
    casts: sim.casts, sampleCasts: sim.sampleCasts,
    resources: sim.resources,
    damageAudit: sim.damageAudit,
    baseline: sim.baseline, equipmentStatsBeforeNormalization: sim.rawStats,
    legendaryEffects: target.affixes.map(a => a.id), legendaryMultiplier: sim.legendaryMultiplier,
    ultimateActive: !!sim.ctx.sgUlt(target.gid, target.ultId),
    finalPlayerHp: sim.ctx.FIELD.player.hp, finalPlayerMp: sim.ctx.FIELD.player.mp, waves: sim.waves };
}

function sourceManifest() {
  return Object.fromEntries([...SOURCE_FILES, 'config/CSV/Equipment_Affix.csv', 'config/CSV/Skills2.csv',
    'config/Excel/Skills2.xlsx', 'tools/ult-dps-benchmark.cjs'].map(f =>
    [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex')]));
}

async function runBatch() {
  const results = new Array(TARGETS.length);
  let next = 0, completed = 0;
  const workers = [];
  try {
    await new Promise((resolve, reject) => {
      for (let i = 0; i < 4; i++) {
        const worker = new Worker(__filename, { workerData: 'ult-dps-worker' });
        workers.push(worker);
        worker.on('error', reject);
        worker.on('exit', code => { if (code !== 0 && completed < TARGETS.length) reject(new Error('Benchmark worker exited: ' + code)); });
        worker.on('message', ({ index, normalMob, elite, boss }) => {
          const target = TARGETS[index];
          results[index] = { target, normalMob, elite, boss };
          completed++;
          console.log('[' + completed + '/69] ' + target.groupName + '/' + target.ultName + ': ' +
            [normalMob, elite, boss].map(r => (r.avgDps / 1e6).toFixed(2) + 'M').join(' | '));
          if (completed === TARGETS.length) resolve();
          else if (next < TARGETS.length) worker.postMessage(next++);
        });
        if (next < TARGETS.length) worker.postMessage(next++);
      }
    });
  } finally { await Promise.all(workers.map(w => w.terminate())); }
  return results;
}

if (!isMainThread && workerData === 'ult-dps-worker') {
  parentPort.on('message', index => {
    const target = TARGETS[index];
    parentPort.postMessage({ index, normalMob: runSimulation(target, 1), elite: runSimulation(target, 2), boss: runSimulation(target, 3) });
  });
} else if (require.main === module) {
  (async () => {
  const startedAt = new Date().toISOString();
  const sources = sourceManifest();
  assert.equal(TARGETS.length, 69);
  const results = await runBatch();
  assert.deepEqual(sourceManifest(), sources, 'Input files changed during benchmark');
  const output = { metadata: { version: 'v10.0', effectiveHitChance: 100,
    damagePolicy: 'Full damage including overkill on the final killing hit only; reject all later hits, DOT and direct damage against an already-dead target. Revived targets may take damage again.',
    playerLevel: TEST_LEVEL, enemyLevel: TEST_LEVEL,
    hpLock: true, mpLock: true, startedAt, completedAt: new Date().toISOString(),
    timezone: 'Asia/Taipei', commit: execFileSync('git', ['rev-parse','HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    seed: BASE_SEED, workers: 4, dt: 0.05, totalDuration: 150, warmupDuration: 30, sampleDuration: 120,
    groups: 23, skills: 69, scenarios: 207, sources,
    inputNote: 'Runtime JS and CSV are the tested configuration. Uncommitted Skills2.xlsx is preserved and not applied.',
    incomingAttacks: 'Reference controlled model: native fieldMonsterAttack disabled; up to six live monsters attack per tick, no distance check; resolveHit uses native HP lock; no manual HP floor or fabricated damage; skills2OnPlayerDamaged receives actual hpDamage.',
    accounting: 'recordRunDamage only; direct + derived + legendary + DOT + basic; full overkill on a living target killing hit, zero subsequent dead-target damage; sample 30 <= GT < 150; DPS = total / 120.',
    playerResources: 'Initial HP/MP = normalized stats.hp/mp. Native GM_TEST.hpLock=true and mpLock=true prevent damage/self-cost deaths and mana-cost gating. Death or revival fails the run; every tick records minima. No artificial maxHp on player.',
    normalization: '13 level100 rarity5 +40 items, identical nine affixes roll100; atk=matk=50000, pPen=mPen=100, critRate=100, critDmg=5996, totalDmgPct=1000, each elemDmgUp=1000; stat cache fixed; GM skillUnlock.' }, results };
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2) + '\n');
  console.log('Saved ' + OUTPUT_JSON);
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { runSimulation, prepareSimulation, createSimContext, createDamageCollector, sourceManifest, buildEquipment, TARGETS };
