const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setupTestEnv() {
  const ctx = {
    window: {},
    console: console,
    Math: Math,
    Date: Date,
    Number: Number,
    String: String,
    Array: Array,
    Object: Object,
    GT: 100,
    G: {
      stage: { current: 185, best: 200, zone: 1, kills: 0 },
      player: { hp: 10000, maxHp: 10000, atk: 5000, matk: 8000, def: 2000, mdef: 2000, crit: 50, critDmg: 200 }
    },
    FIELD: { mapComplete: false, _waveClearPending: false },
    RUN_STATS: { runCount: 1, maxStage: 185, skills: {} },
    UI: { dirty: {} },
    fmt: function(n) { return typeof n === 'number' ? Math.round(n).toString() : String(n); },
    blog: function() {},
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
    bfPos: function(e) { return { x: e.x || 0, y: e.y || 0 }; },
    bfMeterPx: function(m) { return m * 20; },
    bfDistancePx: function() { return 10; },
    bfLiveList: function(list) { return (list || []).filter(function(e) { return e && e.hp > 0; }); }
  };
  ctx.self = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);

  const statusCode = fs.readFileSync(path.join(__dirname, '../js/status.js'), 'utf8');
  vm.runInContext(statusCode, ctx);

  const combatCode = fs.readFileSync(path.join(__dirname, '../js/combat.js'), 'utf8');
  vm.runInContext(combatCode, ctx);

  const skills2Code = fs.readFileSync(path.join(__dirname, '../js/skills2.js'), 'utf8');
  vm.runInContext(skills2Code, ctx);

  return ctx;
}

test('DoT tick correctly attributes damage to source skill in RUN_STATS', () => {
  const env = setupTestEnv();
  const enemy = {
    name: '木樁怪',
    hp: 100000,
    maxHp: 100000,
    dots: []
  };

  // 泥沼術劇毒 DoT
  env.applyStatus(enemy, 'sgMirePoison', {
    dps: 500,
    dur: 4,
    interval: 0.5,
    source: { sourceKey: 'skill2:mire', sourceName: '泥沼術', sourceLevel: 70 }
  });

  assert.equal(enemy.dots.length, 1);
  assert.equal(enemy.dots[0].sourceName, '泥沼術');
  assert.equal(enemy.dots[0].sourceKey, 'skill2:mire');
  assert.equal(enemy.dots[0].sourceLevel, 70);

  // 推進 1 秒 (結算 2 跳 = 500 傷害)
  env.GT = 101;
  env.tickStatuses(enemy, 1);

  assert.ok(env.RUN_STATS.skills['skill2:mire']);
  assert.equal(env.RUN_STATS.skills['skill2:mire'].damage, 500);
  assert.equal(env.RUN_STATS.skills['skill2:mire'].name, '泥沼術');
  assert.equal(env.RUN_STATS.skills['skill2:mire'].level, 70);
});

test('Automatic source resolution for DoT sid when source context is omitted', () => {
  const env = setupTestEnv();
  const enemy = {
    name: '木樁怪',
    hp: 100000,
    maxHp: 100000,
    dots: []
  };

  // 直接 applyDot 不傳 sourceCtx，依賴 resolveDotSource
  env.applyDot(enemy, 400, 3, '熔岩灼燒', 'sgMireLava', 0.4);
  assert.equal(enemy.dots.length, 1);

  env.GT = 101;
  env.tickStatuses(enemy, 1);

  assert.ok(env.RUN_STATS.skills['skill2:mire']);
  assert.ok(env.RUN_STATS.skills['skill2:mire'].damage > 0);
  assert.equal(env.RUN_STATS.skills['skill2:mire'].name, '泥沼術');
});

test('Firehunt orbit field has hitElem fire', () => {
  const env = setupTestEnv();
  const pEnt = { x: 100, y: 100, buffs: {}, effects: {} };
  const target = { x: 150, y: 100, hp: 5000, maxHp: 5000, effects: {}, buffs: {} };
  
  env.G.player.skills2 = { levels: { firehunt: [10, 10, 10, 10, 10, 10, 10] } };
  env.SKILL2_RT.orbits = [];

  env.castSkill2(pEnt, [target], 'firehunt', 'mv-float');

  assert.ok(env.SKILL2_RT.orbits.length > 0);
  const orbit = env.SKILL2_RT.orbits[0];
  assert.equal(orbit.hitElem, 'fire');
});

test('generateSummaryHtml renders all equipped skills including DoT/support skills', () => {
  const env = setupTestEnv();

  env.RUN_STATS.skills = {
    'skill2:frostnova': { name: '冰霜新星', level: 70, count: 153000, damage: 171000000000 },
    'skill2:firehunt': { name: '火狩', level: 70, count: 14100, damage: 66000000000 },
    'skill2:mire': { name: '泥沼術', level: 70, count: 2000, damage: 8500000000 }
  };

  const html = env.generateSummaryHtml(true);
  assert.ok(html.includes('泥沼術(70級)'));
  assert.ok(html.includes('冰霜新星(70級)'));
  assert.ok(html.includes('火狩(70級)'));
  assert.ok(html.includes('目前戰鬥（即時統計）'));
});

test('run stats keep skill casts separate from multi-hit damage events', () => {
  const env = setupTestEnv();

  env.recordRunSkillCast('飛刀', 'skill2:knife', 70);
  env.recordRunDamage('飛刀', 100, 'skill2:knife', 70);
  env.recordRunDamage('飛刀', 120, 'skill2:knife', 70);
  env.recordRunDamage('飛刀', 80, 'skill2:knife', 70);

  const stat = env.RUN_STATS.skills['skill2:knife'];
  assert.equal(stat.casts, 1);
  assert.equal(stat.hits, 3);
  assert.equal(stat.count, 3, '保留 count 欄位供舊資料與舊呼叫端相容');

  const html = env.generateSummaryHtml(true);
  assert.ok(html.includes('1次施放，3次命中/傷害事件'));
});

test('新版技能群組入口 records one cast independently of later damage ticks', () => {
  const env = setupTestEnv();
  env.G.player.skills2 = { levels: { firehunt: [10, 10, 10, 10, 10, 10, 10] } };
  const pEnt = { x: 100, y: 100, hp: 10000, mp: 10000, buffs: {}, effects: {}, skillCds: {} };
  const target = { x: 150, y: 100, hp: 100000, maxHp: 100000, effects: {}, buffs: {}, dots: [] };

  assert.ok(env.castSkill2(pEnt, [target], 'firehunt', 'mv-float'));
  assert.equal(env.RUN_STATS.skills['skill2:firehunt'].casts, 1);
});
