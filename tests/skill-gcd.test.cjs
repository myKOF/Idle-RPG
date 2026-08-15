const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} !== ${expected}`);
}

function loadGameContext() {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {},
    clearTimeout() {},
    document: { addEventListener() {} },
    UI: { dirty: {} },
    GT: 0,
    RUN_STATS: { skills: {} },
    blog() {},
    floatText() {},
    trackDps() {},
    recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);

  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js', 'js/potential.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });

  context.G = {
    player: {
      level: 1,
      skills: { timeWarp: 1, treasureSense: 1 },
      loadout: ['timeWarp', 'treasureSense'],
      fusions: []
    },
    stage: { current: 1 }
  };
  context.getStats = () => ({
    cdr: 60,
    castSpeed: 50,
    hp: 1000,
    mp: 1000,
    atk: 100,
    matk: 100,
    aoeDmg: 0
  });

  return context;
}

function playerEntity() {
  return {
    hp: 1000,
    mp: 1000,
    shield: 0,
    atkCd: 0,
    skillCds: {},
    buffs: {},
    dots: [],
    effects: {}
  };
}

test('different skills keep independent cooldowns while cast lock comes from config', () => {
  const context = loadGameContext();
  const player = playerEntity();

  const first = context.pickAndCastSkill(player, null, 'float-layer');
  assert.equal(first && typeof first, 'object');
  assert.equal(first.casting, true);
  assert.equal(first.castTime, context.SKILL_CAST_LOCK);
  assert.equal(player._skillCastRemaining, context.SKILL_CAST_LOCK);
  context.tickSkillCast(player, context.SKILL_CAST_LOCK);
  assert.equal(player.skillCds.timeWarp, 8);
  assert.equal(player.atkCd, 0, '技能施放不應增加普攻計時器');

  const second = context.pickAndCastSkill(player, null, 'float-layer');
  assert.equal(second && typeof second, 'object');
  assert.equal(second.casting, true);
  assert.equal(second.castTime, context.SKILL_CAST_LOCK);
  context.tickSkillCast(player, context.SKILL_CAST_LOCK);
  assert.equal(player.skillCds.treasureSense, 12);
  assert.equal(player.skillGcd, undefined);
  assert.equal(player.atkCd, 0, '技能自身冷卻與普攻計時器應彼此獨立');
});

test('技能依冷卻歸零先後輪轉，前排短 CD 不會在首輪壟斷後排技能', () => {
  const context = loadGameContext();
  const ids = Object.keys(context.SKILLS)
    .filter((id) => context.SKILLS[id].fx && context.SKILLS[id].fx.dmgType)
    .slice(0, 16);
  const calls = [];
  context.G.player.skills = Object.fromEntries(ids.map((id) => [id, 1]));
  context.G.player.loadout = ids;
  context.getStats = () => ({
    cdr: 0, castSpeed: 0, hp: 1000, mp: 100000, atk: 100, matk: 100,
    aoeDmg: 0
  });
  ids.forEach((id) => { context.SKILLS[id].fx.castTime = 0; });
  context.castSkill = (player, target, id) => {
    calls.push(id);
    player.skillCds[id] = context.skillCdFor(context.skillDef(id));
    return {};
  };
  const player = playerEntity();
  const target = { hp: 1000 };

  for (let i = 0; i < ids.length; i += 1) {
    assert.ok(context.pickAndCastSkill(player, target, 'float-layer'));
    context.tickSkillCds(player, 0.4);
  }

  assert.deepEqual(calls, ids);
});

test('多敵人範圍技能每個目標承受完整傷害，不依目標數分攤', () => {
  const context = loadGameContext();
  assert.equal(context.skillDamagePerTarget(10000, 100, 4), 20000);
  assert.equal(context.skillDamagePerTarget(10000, 50, 2), 15000);
  assert.equal(context.skillDamagePerTarget(10000, 100, 1), 10000);
  assert.equal(context.skillDamageShare(10000, 100, 4), 20000, '舊函式名稱也不得恢復分攤');
});

/* 新版戰鬥：技能一律要指定範圍，未填＝單體。
   單體技只打一個目標，且目標挑法與普攻相同（最近優先）。 */
function skillTargetingContext() {
  const context = loadGameContext();
  context.Math.random = () => 0.5;
  context.G.player.skills = { powerSlash: 1 };
  context.G.player.loadout = ['powerSlash'];
  context.getStats = () => ({
    cdr: 0, castSpeed: 0, hp: 1000, mp: 1000, atk: 100, matk: 100,
    aoeDmg: 100, critRate: 0, critDmg: 150, pPen: 0, mPen: 0,
    passives: {}, lifesteal: 0, manaSteal: 0, shieldEff: 0
  });
  return context;
}
/* 座標制（2026-08-12）：敵人帶 pos={x,y}，我方在原點。 */
function targetingEnemy(x, y, extra) {
  const e = {
    hp: 10000, maxHp: 10000, def: 0, mdef: 0, dodge: 0, resist: {},
    ctrlRes: 0, elite: false, isBoss: false, buffs: {}, dots: [], effects: {}, shield: 0,
    pos: { x: x, y: y }
  };
  return Object.assign(e, extra || {});
}
function targetingPlayer() {
  return { hp: 1000, mp: 1000, atkCd: 0, skillCds: {}, skillGcd: 0, buffs: {}, dots: [], effects: {} };
}

test('未指定傷害範圍的技能只打一個目標，且挑最近的敵人', () => {
  const context = skillTargetingContext();
  const far = targetingEnemy(600, 0);
  const near = targetingEnemy(100, 0);
  const enemies = [far, near]; // 陣列順序刻意放反：確認依距離挑目標，不是取第一隻

  const result = context.castSkill(targetingPlayer(), enemies, 'powerSlash', 1, 'float-layer');
  assert.equal(result.killed, false);
  assert.equal(far.hp, 10000, '較遠的敵人不該被單體技打到');
  assert.ok(near.hp < 10000, '最近的敵人才是單體技的目標');
});

test('傷害範圍 3x3 的技能命中圈內全部敵人，體型較大的 BOSS 仍只算一次', () => {
  const context = skillTargetingContext();
  context.SKILLS.powerSlash.shape = '3x3';
  /* 3*3 換算成半徑 1.5 個身位（BF_UNIT×1.5＝90）：以主目標 a 為圓心，
     b 與 boss 在圈內，outside 在圈外。 */
  const a = targetingEnemy(100, 0);
  const b = targetingEnemy(150, 0);
  const boss = targetingEnemy(120, 40, { isBoss: true });
  const outside = targetingEnemy(600, 0);
  const enemies = [a, b, boss, outside];

  context.castSkill(targetingPlayer(), enemies, 'powerSlash', 1, 'float-layer');

  assert.ok(a.hp < 10000);
  assert.ok(b.hp < 10000);
  assert.ok(boss.hp < 10000);
  assert.equal(outside.hp, 10000, '圈外的敵人不該被打到');
  // 每名目標受到相同的完整範圍傷害，且 BOSS 沒有因為佔 4 格而被打 4 次
  assert.equal(Math.round(10000 - a.hp), Math.round(10000 - boss.hp));
});

test('傷害範圍 all 的技能命中場上全部敵人', () => {
  const context = skillTargetingContext();
  context.SKILLS.powerSlash.shape = 'all';
  const single = targetingEnemy(2, 2);
  context.castSkill(targetingPlayer(), [single], 'powerSlash', 1, 'float-layer');
  const singleDamage = 10000 - single.hp;
  const enemies = [targetingEnemy(1, 2), targetingEnemy(4, 1), targetingEnemy(3, 4)];

  context.castSkill(targetingPlayer(), enemies, 'powerSlash', 1, 'float-layer');

  enemies.forEach((e) => assert.ok(e.hp < 10000));
  assert.equal(enemies[0].hp, enemies[1].hp);
  assert.equal(enemies[1].hp, enemies[2].hp);
  assert.equal(Math.round(10000 - enemies[0].hp), Math.round(singleDamage * 2),
    '範圍傷害加成應套用在每個目標，不能因目標數量除分');
});

test('the same skill is still blocked by its own cooldown and receives the minimum interval', () => {
  const context = loadGameContext();
  context.G.player.loadout = ['timeWarp'];
  const player = playerEntity();

  const first = context.pickAndCastSkill(player, null, 'float-layer');
  assert.equal(first && first.casting, true);
  context.tickSkillCast(player, context.SKILL_CAST_LOCK);
  assert.equal(player.skillCds.timeWarp, 8);
  assert.equal(context.pickAndCastSkill(player, null, 'float-layer'), null);
  assert.equal(player.skillGcd, undefined);
  assert.equal(context.skillCooldownWithMinimum(0.1), context.SKILL_MIN_CAST_INTERVAL);
  assert.equal(context.potentialActiveCd({ cd: 0.1 }), context.SKILL_MIN_CAST_INTERVAL);
});

test('技能可用 castTime: 0 明確略過預設施法停頓', () => {
  const context = loadGameContext();
  context.G.player.skills = { powerSlash: 1 };
  context.G.player.loadout = ['powerSlash'];
  context.getStats = () => ({
    cdr: 0, castSpeed: 0, hp: 1000, mp: 1000, atk: 100, matk: 100,
    aoeDmg: 0, critRate: 0, critDmg: 150, pPen: 0, mPen: 0,
    passives: {}, lifesteal: 0, manaSteal: 0, shieldEff: 0
  });
  context.SKILLS.powerSlash.fx.castTime = 0;
  const player = playerEntity();
  const target = { hp: 10000, maxHp: 10000, def: 0, mdef: 0, dodge: 0, resist: {},
    ctrlRes: 0, elite: false, isBoss: false, buffs: {}, dots: [], effects: {}, shield: 0 };

  const result = context.pickAndCastSkill(player, target, 'float-layer');
  assert.equal(result.casting, undefined);
  assert.equal(player._skillCastRemaining || 0, 0);
  assert.ok(target.hp < 10000);
});

test('就緒佇列會跳過條件不符的技能，不讓後面的技能等待掃描輪次', () => {
  const context = loadGameContext();
  context.G.player.skills = { healWound: 1, powerSlash: 1 };
  context.G.player.loadout = ['healWound', 'powerSlash'];
  context.getStats = () => ({
    cdr: 0, castSpeed: 0, hp: 1000, mp: 1000, atk: 100, matk: 100,
    aoeDmg: 0, critRate: 0, critDmg: 150, pPen: 0, mPen: 0,
    passives: {}, lifesteal: 0, manaSteal: 0, shieldEff: 0
  });
  context.SKILLS.powerSlash.fx.castTime = 0;
  const calls = [];
  context.castSkill = (player, target, id) => {
    calls.push(id);
    player.skillCds[id] = context.skillCdFor(context.skillDef(id));
    return { killed: false, dmg: 0 };
  };
  const player = playerEntity();
  player.hp = 900; // healWound 的 hurt70 條件不成立
  assert.ok(context.pickAndCastSkill(player, { hp: 1000 }, 'float-layer'));
  assert.deepEqual(calls, ['powerSlash']);
  assert.equal(player._skillReadyQueued.healWound, true, '條件不符的技能仍應保留獨立監視');
});

test('明確 castTime 仍可為單一技能保留施法時間', () => {
  const context = loadGameContext();
  context.G.player.skills = { powerSlash: 1 };
  context.G.player.loadout = ['powerSlash'];
  context.SKILLS.powerSlash.fx.castTime = 0.4;
  context.castSkill = (player, target, id) => {
    player.skillCds[id] = context.skillCdFor(context.skillDef(id));
    target.hp -= 1;
    return { killed: false, dmg: 1 };
  };
  const player = playerEntity();
  const target = { hp: 10000, maxHp: 10000, def: 0, mdef: 0, resist: {},
    dodge: 0, ctrlRes: 0, elite: false, isBoss: false, buffs: {}, dots: [], effects: {}, shield: 0 };
  const started = context.pickAndCastSkill(player, target, 'float-layer');
  assert.equal(started.casting, true);
  assert.equal(player._skillCastRemaining, 0.4);
  context.tickSkillCast(player, 0.4);
  assert.ok(target.hp < 10000);
});

/* 2026-07-31：護盾技能改為「最大生命 × 技能護盾%」。
   舊式是「目前護盾基準 ×(1 + 技能護盾%)」，標示 34% 實得 134% 最大生命，約為標示的 4 倍。 */
test('魔法屏障在護盾剩 20% 以下即可提前施放', () => {
  const context = loadGameContext();
  const skill = context.skillDef('manaBarrier');
  const fx = context.effectiveFx('manaBarrier', skill, 1);
  const stats = context.getStats();
  const player = playerEntity();
  player.shield = 201;

  assert.equal(context.skillConditionOk(skill, fx, player, null, stats), false);
  player.shield = 200;
  assert.equal(context.skillConditionOk(skill, fx, player, null, stats), true);
  player.shield = 1;
  assert.equal(context.skillConditionOk(skill, fx, player, null, stats), true);
  player.shield = 0;
  assert.equal(context.skillConditionOk(skill, fx, player, null, stats), true);
});

test('護盾技能給予最大生命固定比例的護盾，不以目前護盾為基準乘算', () => {
  const context = loadGameContext();
  const lv = 80;
  context.G.player.skills = { manaBarrier: lv };
  context.G.player.loadout = ['manaBarrier'];
  context.getStats = () => ({
    cdr: 0,
    castSpeed: 0,
    hp: 1000,
    mp: 1000,
    shieldEff: 0,
    aoeDmg: 0,
    passives: {}
  });
  // 期望值由技能表推導，調整 manaBarrier 數值不該讓本測試變紅
  // 2026-08-11：護盾改為有持續時間的狀態，數值改由狀態引用取得（→ config/Excel/Status.xlsx）
  const shieldRef = context.skillStatusRefs(context.mergedSkillFx('manaBarrier'))
    .find((r) => context.statusRefEffect(r) === 'shield');
  const pct = context.statusRefAmount(shieldRef, lv);
  const expected = 1000 * pct / 100;

  const player = playerEntity();
  player.shield = 10;
  player.shieldMax = 1000;

  context.castSkill(player, null, 'manaBarrier', lv, 'float-layer');

  assertClose(player.shield, expected);
  assertClose(player.shieldMax, expected);

  // 重放不疊加：滿盾時再放維持同值
  context.castSkill(player, null, 'manaBarrier', lv, 'float-layer');

  assertClose(player.shield, expected);
  assertClose(player.shieldMax, expected);

  // 被打掉一部分後重放：補回同一比例，不會疊到更高
  player.shield = expected / 2;
  context.castSkill(player, null, 'manaBarrier', lv, 'float-layer');

  assertClose(player.shield, expected);
});
