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

  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js'].forEach((file) => {
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

test('skill global cooldown prevents casting another skill for a fixed 0.4 seconds', () => {
  const context = loadGameContext();
  const player = playerEntity();

  const first = context.pickAndCastSkill(player, null, 'float-layer');
  assert.equal(first && typeof first, 'object');
  assert.equal(player.skillGcd, 0.4);
  assert.equal(player.skillCds.timeWarp, 8);
  assert.equal(player.atkCd, 0, '技能施放不應增加普攻計時器');

  const blocked = context.pickAndCastSkill(player, null, 'float-layer');
  assert.equal(blocked, null);
  assert.equal(player.skillCds.treasureSense || 0, 0);

  context.tickSkillCds(player, 0.39);
  assert.ok(player.skillGcd > 0);
  assert.equal(context.pickAndCastSkill(player, null, 'float-layer'), null);

  context.tickSkillCds(player, 0.01);
  assert.equal(player.skillGcd, 0);
  const second = context.pickAndCastSkill(player, null, 'float-layer');
  assert.equal(second && typeof second, 'object');
  assert.equal(player.skillGcd, 0.4);
  assert.equal(player.skillCds.treasureSense, 12);
  assert.equal(player.atkCd, 0, '技能 GCD 與普攻計時器應彼此獨立');
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
  context.castSkill = (player, target, id) => {
    calls.push(id);
    player.skillCds[id] = context.skillCdFor(context.skillDef(id));
    player.skillGcd = 0.4;
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

test('多敵人技能傷害依範圍傷害與敵人數量分攤', () => {
  const context = loadGameContext();
  assert.equal(context.skillDamageShare(10000, 100, 4), 5000);
  assert.equal(context.skillDamageShare(10000, 50, 2), 7500);
  assert.equal(context.skillDamageShare(10000, 100, 1), 10000);
});

/* 新版戰鬥：技能一律要指定範圍，未填＝單體。
   單體技只打一個目標，且目標挑法與普攻相同（最近優先），不再對全場平攤傷害。 */
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
function targetingEnemy(col, row, extra) {
  const e = {
    hp: 10000, maxHp: 10000, def: 0, mdef: 0, dodge: 0, resist: {},
    ctrlRes: 0, elite: false, isBoss: false, buffs: {}, dots: [], effects: {}, shield: 0,
    cell: { col, row, w: 1, h: 1 }
  };
  return Object.assign(e, extra || {});
}
function targetingPlayer() {
  return { hp: 1000, mp: 1000, atkCd: 0, skillCds: {}, skillGcd: 0, buffs: {}, dots: [], effects: {} };
}

test('未指定傷害範圍的技能只打一個目標，且挑最近的敵人', () => {
  const context = skillTargetingContext();
  const far = targetingEnemy(4, 1);
  const near = targetingEnemy(1, 2);
  const enemies = [far, near]; // 陣列順序刻意放反：確認依距離挑目標，不是取第一隻

  const result = context.castSkill(targetingPlayer(), enemies, 'powerSlash', 1, 'float-layer');
  assert.equal(result.killed, false);
  assert.equal(far.hp, 10000, '較遠的敵人不該被單體技打到');
  assert.ok(near.hp < 10000, '最近的敵人才是單體技的目標');
});

test('傷害範圍 3x3 的技能命中方框內全部敵人，BOSS 佔多格仍只算一次', () => {
  const context = skillTargetingContext();
  context.SKILLS.powerSlash.shape = '3x3';
  const a = targetingEnemy(1, 2);
  const b = targetingEnemy(2, 3);
  const boss = targetingEnemy(2, 1, { isBoss: true, cell: { col: 2, row: 1, w: 2, h: 2 } });
  const outside = targetingEnemy(4, 4);
  const enemies = [a, b, boss, outside];

  context.castSkill(targetingPlayer(), enemies, 'powerSlash', 1, 'float-layer');

  assert.ok(a.hp < 10000);
  assert.ok(b.hp < 10000);
  assert.ok(boss.hp < 10000);
  assert.equal(outside.hp, 10000, '方框外的敵人不該被打到');
  // 三名目標平攤：每名受到的傷害相同，且 BOSS 沒有因為佔 4 格而被打 4 次
  assert.equal(Math.round(10000 - a.hp), Math.round(10000 - boss.hp));
});

test('傷害範圍 all 的技能命中場上全部敵人', () => {
  const context = skillTargetingContext();
  context.SKILLS.powerSlash.shape = 'all';
  const enemies = [targetingEnemy(1, 2), targetingEnemy(4, 1), targetingEnemy(3, 4)];

  context.castSkill(targetingPlayer(), enemies, 'powerSlash', 1, 'float-layer');

  enemies.forEach((e) => assert.ok(e.hp < 10000));
  assert.equal(enemies[0].hp, enemies[1].hp);
  assert.equal(enemies[1].hp, enemies[2].hp);
});

test('護盾技能依目前護盾做額外乘法加成', () => {
  const context = loadGameContext();
  context.G.player.skills = { manaBarrier: 80 };
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
  const player = playerEntity();
  player.shield = 10;
  player.shieldMax = 1000;

  context.castSkill(player, null, 'manaBarrier', 80, 'float-layer');

  assertClose(player.shield, 60.2);
  assertClose(player.shieldMax, 60.2);

  context.castSkill(player, null, 'manaBarrier', 80, 'float-layer');

  assertClose(player.shield, 60.2);
  assertClose(player.shieldMax, 60.2);
});
