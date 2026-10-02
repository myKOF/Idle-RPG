const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setupTestEnv() {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    Math: Object.create(Math),
    Date,
    Number,
    String,
    Array,
    Object,
    document: {},
    GT: 100,
    G: {
      stage: { current: 190, best: 200, zone: 1, kills: 0 },
      player: {
        hp: 10000, maxHp: 10000, atk: 5000, matk: 8000, def: 2000, mdef: 2000, crit: 50, critDmg: 200,
        skills2: { levels: { waterball: [10, 10, 10, 10, 10, 10, 10] }, ult: { waterball: 'ragingTide' } }
      }
    },
    FIELD: { mapComplete: false, _waveClearPending: false },
    RUN_STATS: { runCount: 1, maxStage: 190, skills: {} },
    UI: { dirty: {} },
    fmt: function(n) {
      if (typeof n !== 'number') return String(n);
      if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
      return Math.round(n).toString();
    },
    chance: function() { return true; },
    globalDamageMultiplier: function() { return 1; },
    globalDamageMultiplierForEntity: function() { return 1; },
    isBossControlImmune: function() { return false; },
    isAttackFrequencyControlKey: function() { return false; },
    getStats: function() {
      return {
        atk: 5000, matk: 8000, def: 2000, mdef: 2000, crit: 50, critDmg: 200,
        skillDamage: 0, globalDmg: 0, earthDmg: 0, fireDmg: 0, iceDmg: 0, lightningDmg: 0,
        skillCooldown: 0, manaCostReduction: 0, castSpeed: 0,
        skillTriggers: {}
      };
    },
    enemyEventFloatTarget: function() { return 'tgt-1'; },
    playCombatVfx: function() {},
    floatEnemyEvent: function() {},
    applyEnemyHpDamage: function(ent, dmg) {
      const dealt = Math.min(ent.hp, Math.round(dmg));
      ent.hp -= dealt;
      return dealt;
    },
    logEnemyDirectDamage: function() {},
    bfPos: function(e) { return { x: (e && e.x) || 0, y: (e && e.y) || 0 }; },
    bfMeterPx: function(m) { return m * 20; },
    bfDistancePx: function() { return 10; },
    bfLiveList: function(list) { return (list || []).filter(function(e) { return e && e.hp > 0; }); }
  };
  context.window = context;
  context.self = context;
  vm.createContext(context);

  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills2.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });

  context.G = {
    stage: { current: 190, best: 200, zone: 1, kills: 0 },
    player: {
      hp: 10000, maxHp: 10000, atk: 5000, matk: 8000, def: 2000, mdef: 2000, crit: 50, critDmg: 200,
      skills2: { levels: { waterball: [10, 10, 10, 10, 10, 10, 10] }, ult: { waterball: 'ragingTide' } }
    }
  };
  context.GT = 100;
  context.RUN_STATS = { runCount: 1, maxStage: 190, skills: {} };

  return context;
}

test('傷害統計面板支援子傷害類型記錄與按技能主體區塊框起來', () => {
  const env = setupTestEnv();

  // 模擬水流彈造成不同類型的傷害
  env.recordRunSkillCast('水流彈', 'skill2:waterball', 70);
  env.recordRunDamage('水流彈', 35000000000, 'skill2:waterball', 70, '水流彈');
  env.recordRunDamage('水流彈', 20000000000, 'skill2:waterball', 70, '水龍捲');
  env.recordRunDamage('水流彈', 11900000000, 'skill2:waterball', 70, '巨型水龍捲');
  env.recordRunDamage('水流彈', 6360000000, 'skill2:waterball', 70, '寒霜狀態');

  // 普攻單一傷害
  env.recordRunDamage('普攻', 5880000000, '普攻', undefined, '普攻');

  const stat = env.RUN_STATS.skills['skill2:waterball'];
  assert.equal(stat.name, '水流彈');
  assert.equal(stat.level, 70);
  assert.equal(stat.casts, 1);
  assert.equal(stat.hits, 4);
  assert.equal(stat.damage, 73260000000);
  assert.ok(stat.subTypes);
  assert.equal(stat.subTypes['水流彈'].damage, 35000000000);
  assert.equal(stat.subTypes['水龍捲'].damage, 20000000000);
  assert.equal(stat.subTypes['巨型水龍捲'].damage, 11900000000);
  assert.equal(stat.subTypes['寒霜狀態'].damage, 6360000000);

  const html = env.generateSummaryHtml(true);

  // 1. 包含目前戰鬥即時統計標題
  assert.match(html, /目前戰鬥（即時統計）/);

  // 2. 包含技能主體區塊 summary-skill-block
  assert.match(html, /class="summary-skill-block"/);

  // 3. 水流彈主技能列包含總傷害與施放次數
  assert.match(html, /水流彈\(70級\)/);
  assert.match(html, /1次施放，4次命中\/傷害事件/);
  assert.match(html, /傷害 73\.2B/);

  // 4. 包含子類型群組 summary-sub-group 與詳細分項
  assert.match(html, /class="summary-sub-group"/);
  assert.match(html, /└ <\/span><span class="summary-sub-name">水流彈<\/span>：1次命中，傷害 35\.0B/);
  assert.match(html, /└ <\/span><span class="summary-sub-name">水龍捲<\/span>：1次命中，傷害 20\.0B/);
  assert.match(html, /└ <\/span><span class="summary-sub-name">巨型水龍捲<\/span>：1次命中，傷害 11\.9B/);
  assert.match(html, /└ <\/span><span class="summary-sub-name">寒霜狀態<\/span>：1次命中，傷害 6\.36B/);

  // 5. 普攻單一來源不會出現重複的子分項
  assert.match(html, /普攻/);
  assert.match(html, /傷害 5\.88B/);
});

test('DoT 寒霜凍傷在實戰結算時自動歸屬至裝配的水流彈主技能並標記寒霜狀態', () => {
  const env = setupTestEnv();
  const enemy = {
    name: '木樁怪',
    hp: 1000000,
    maxHp: 1000000,
    dots: []
  };

  // 施加寒霜狀態 (slot.gid = waterball)
  env.sgApplySlot(enemy, 'waterball', '3', 'enemy', 1, {
    dps: 1000,
    dur: 5,
    interval: 0.5
  });

  assert.equal(enemy.dots.length, 1);
  assert.equal(enemy.dots[0].sourceName, '水流彈');
  assert.equal(enemy.dots[0].sourceKey, 'skill2:waterball');
  assert.equal(enemy.dots[0].subType, '寒霜狀態');

  // 推進 1 秒 (2 跳 = 1000 傷害)
  env.GT = 101;
  env.tickStatuses(enemy, 1);

  const waterStat = env.RUN_STATS.skills['skill2:waterball'];
  assert.ok(waterStat);
  assert.equal(waterStat.name, '水流彈');
  assert.equal(waterStat.damage, 1000);
  assert.ok(waterStat.subTypes['寒霜狀態']);
  assert.equal(waterStat.subTypes['寒霜狀態'].damage, 1000);
});

test('怒海狂濤與水龍捲在地面場域跳傷時精確標註水龍捲與巨型水龍捲', () => {
  const env = setupTestEnv();
  const enemy = {
    name: '木樁怪',
    hp: 1000000,
    maxHp: 1000000,
    effects: {},
    buffs: {}
  };

  const pEnt = { x: 0, y: 0, hp: 10000, buffs: {}, effects: {} };
  const st = env.getStats();

  // 1. 生成普通水龍捲
  env.sgSpawnGround(pEnt, st, 'waterball', {
    kind: 'tornado',
    tgt: enemy,
    floatSel: 'mv-float',
    radius: 100,
    dmgVal: 2000,
    hits: 1,
    gap: 0.35,
    subType: '水龍捲'
  });

  // 2. 生成巨型水龍捲 (怒海狂濤)
  env.sgSpawnGround(pEnt, st, 'waterball', {
    kind: 'tidetornado',
    tgt: enemy,
    floatSel: 'mv-float',
    radius: 200,
    dmgVal: 5000,
    hits: 1,
    gap: 0.25,
    subType: '巨型水龍捲'
  });

  assert.equal(env.SKILL2_RT.grounds.length, 2);

  // 推進並觸發地面傷害
  env.GT = 101;
  env.sgGroundTick(env.SKILL2_RT.grounds[0], [enemy], [enemy], { pEnt: pEnt });
  env.sgGroundTick(env.SKILL2_RT.grounds[1], [enemy], [enemy], { pEnt: pEnt });

  const stat = env.RUN_STATS.skills['skill2:waterball'];
  assert.ok(stat);
  assert.ok(stat.subTypes['水龍捲']);
  assert.ok(stat.subTypes['水龍捲'].damage > 0);
  assert.ok(stat.subTypes['巨型水龍捲']);
  assert.ok(stat.subTypes['巨型水龍捲'].damage > 0);
});
