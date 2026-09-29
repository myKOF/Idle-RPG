/* 施放佇列共用邏輯（js/skills.js：pickAndCastSkill／beginSkillCast／tickSkillCast／tickSkillCds／resetSkillRT）。
   這一層只認裝載欄鍵：'sg:<群組id>'（新版技能，js/skills2.js）與 'potential:<id>'（潛力技能，js/potential.js），
   所以夾具用「假群組」：SKILLS2 給一個最小 def、castSkill2 換成只寫冷卻的替身，
   只驗冷卻獨立、就緒順序、施法硬直、最短間隔、被中斷後回到佇列這些共用行為，不牽涉任何技能本體的傷害。
   （2026-09-29 舊技能系統移除：舊 SKILLS 表夾具、範圍傷害不分攤、單體挑最近／3x3／all 命中、魔法屏障護盾閘門
   隨之刪除；戰場幾何與範圍挑選由 tests/battlefield.test.cjs 涵蓋，新版技能由各 skill2-*.test.cjs 涵蓋。） */
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
      loadout: []
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

/* 新版技能群組的替身：pickAndCastSkill 的 'sg:' 分支只問 SKILLS2[id]、skills2Castable／skills2ActsPassive／
   skills2CanReach／skills2ManaCost 與 castSkill2，這裡全部換成最小實作（skills2.js 不載入）。
   defs：{ 群組id: { castTime? } }；cds：{ 群組id: 施放後寫入的冷卻秒數 }（預設 0.4）；
   blocked：skills2Castable 回傳 false 的群組（模擬「條件不符」）。回傳施放紀錄陣列。 */
function stubSkills2(context, defs, opts) {
  const o = opts || {};
  const calls = [];
  context.SKILLS2 = defs;
  context.skills2Castable = (gid) => !(o.blocked && o.blocked.indexOf(gid) >= 0);
  context.skills2ActsPassive = () => false;
  context.skills2CanReach = () => true;
  context.skills2ManaCost = () => 0;
  context.castSkill2 = (player, target, gid) => {
    calls.push(gid);
    player.skillCds['sg:' + gid] = (o.cds && o.cds[gid] !== undefined) ? o.cds[gid] : 0.4;
    if (o.onCast) o.onCast(player, target, gid);
    return { killed: false, dmg: 0 };
  };
  return calls;
}

/* 潛力技能的替身：資料表 POTENTIAL_TALENTS 用真的，talents.js 的查詢與 castPotentialSkill 本體換掉，
   冷卻仍走真的 potentialActiveCd（吃冷卻縮減與最短間隔）。 */
function stubPotential(context) {
  const calls = [];
  context.potentialDef = (id) => context.POTENTIAL_TALENTS.find((t) => t.id === id) || null;
  context.potentialSkillActive = () => true;
  context.castPotentialSkill = (player, target, def, floatSel, loadoutKey) => {
    calls.push(loadoutKey);
    player.skillCds[loadoutKey] = context.potentialActiveCd(def);
    return { killed: false, dmg: 0 };
  };
  return calls;
}

test('different skills keep independent cooldowns while cast lock comes from config', () => {
  const context = loadGameContext();
  const sgCalls = stubSkills2(context, { alpha: {} }, { cds: { alpha: 8 } });
  const potCalls = stubPotential(context);
  context.G.player.loadout = ['sg:alpha', 'potential:velocityForce'];
  const player = playerEntity();

  const first = context.pickAndCastSkill(player, [{ hp: 1000 }], 'float-layer');
  assert.equal(first && typeof first, 'object');
  assert.equal(first.casting, true);
  assert.equal(first.castTime, context.SKILL_CAST_LOCK);
  assert.equal(player._skillCastRemaining, context.SKILL_CAST_LOCK);
  context.tickSkillCast(player, context.SKILL_CAST_LOCK);
  assert.deepEqual(sgCalls, ['alpha']);
  assert.equal(player.skillCds['sg:alpha'], 8);
  assert.equal(player.atkCd, 0, '技能施放不應增加普攻計時器');

  const second = context.pickAndCastSkill(player, [{ hp: 1000 }], 'float-layer');
  assert.equal(second && typeof second, 'object');
  assert.equal(second.casting, true);
  assert.equal(second.castTime, context.SKILL_CAST_LOCK);
  context.tickSkillCast(player, context.SKILL_CAST_LOCK);
  assert.deepEqual(potCalls, ['potential:velocityForce']);
  // 潛力技冷卻＝表定 60 秒吃 60% 冷卻縮減（stub 的 getStats.cdr）
  assertClose(player.skillCds['potential:velocityForce'], 60 * (1 - 0.6));
  assert.equal(player.skillCds['sg:alpha'], 8, '第二個技能的施放不得動到第一個技能的冷卻');
  assert.equal(player.skillGcd, undefined);
  assert.equal(player.atkCd, 0, '技能自身冷卻與普攻計時器應彼此獨立');
});

test('技能依冷卻歸零先後輪轉，前排短 CD 不會在首輪壟斷後排技能', () => {
  const context = loadGameContext();
  const ids = [];
  const defs = {};
  const cds = {};
  for (let i = 0; i < 16; i += 1) {
    const id = 'g' + i;
    ids.push(id);
    defs[id] = { castTime: 0 };
    cds[id] = i < 8 ? 0.4 : 30; // 前 8 個是短 CD、後 8 個是長 CD
  }
  const calls = stubSkills2(context, defs, { cds });
  context.G.player.loadout = ids.map((id) => 'sg:' + id);
  const player = playerEntity();
  const target = { hp: 1000 };

  for (let i = 0; i < ids.length; i += 1) {
    assert.ok(context.pickAndCastSkill(player, target, 'float-layer'));
    context.tickSkillCds(player, 0.4);
  }

  assert.deepEqual(calls, ids);
});

test('新版技能使用完整 sg 裝載鍵解除就緒佇列，固定關卡可跨波次重複施放', () => {
  const context = loadGameContext();
  context.G.player.loadout = ['sg:alpha', 'sg:beta'];
  const calls = stubSkills2(context, {
    alpha: { cost: 0, castTime: 0 },
    beta: { cost: 0, castTime: 0 }
  });

  const player = playerEntity();
  const target = { hp: 1000 };
  for (let i = 0; i < 4; i += 1) {
    assert.ok(context.pickAndCastSkill(player, [target], 'float-layer'));
    context.tickSkillCds(player, 0.4);
  }

  assert.deepEqual(calls, ['alpha', 'beta', 'alpha', 'beta']);
});

test('吟唱被戰鬥重置中斷後，技能會回到就緒佇列', () => {
  const context = loadGameContext();
  context.G.player.loadout = ['sg:alpha'];
  stubSkills2(context, { alpha: { cost: 0 } });

  const player = playerEntity();
  const target = { hp: 1000 };
  const first = context.pickAndCastSkill(player, [target], 'float-layer');
  assert.equal(first.casting, true);

  // 死亡／切場等戰鬥重置會清除尚未完成的吟唱；技能不能因此永久消失。
  context.resetSkillRT();
  const second = context.pickAndCastSkill(player, [target], 'float-layer');
  assert.equal(second.casting, true);
});

test('新版技能施法期間目標消失後，冷卻為零時仍會重新加入就緒佇列', () => {
  const context = loadGameContext();
  context.G.player.loadout = ['sg:knife'];
  const calls = stubSkills2(context, { knife: { cost: 0 } });
  // 施放時目標已全滅：本次施放失敗（回傳 null）、沒有寫入冷卻
  context.castSkill2 = (player, target, gid) => {
    if (!target.some((ent) => ent && ent.hp > 0)) return null;
    calls.push(gid);
    player.skillCds['sg:' + gid] = 1;
    return { killed: false, dmg: 0 };
  };

  const player = playerEntity();
  const firstTarget = { hp: 1000 };
  assert.ok(context.pickAndCastSkill(player, [firstTarget], 'float-layer'));
  firstTarget.hp = 0;
  const completed = context.tickSkillCast(player, context.SKILL_CAST_LOCK);
  assert.equal(completed.completed, true);
  assert.deepEqual(calls, []);

  const nextTarget = { hp: 1000 };
  context.tickSkillCds(player, 1);
  assert.ok(context.pickAndCastSkill(player, [nextTarget], 'float-layer'));
  context.tickSkillCast(player, context.SKILL_CAST_LOCK);
  assert.deepEqual(calls, ['knife']);
});

test('the same skill is still blocked by its own cooldown and receives the minimum interval', () => {
  const context = loadGameContext();
  context.G.player.loadout = ['sg:alpha'];
  stubSkills2(context, { alpha: {} }, { cds: { alpha: 8 } });
  const player = playerEntity();
  const target = [{ hp: 1000 }];

  const first = context.pickAndCastSkill(player, target, 'float-layer');
  assert.equal(first && first.casting, true);
  context.tickSkillCast(player, context.SKILL_CAST_LOCK);
  assert.equal(player.skillCds['sg:alpha'], 8);
  assert.equal(context.pickAndCastSkill(player, target, 'float-layer'), null);
  assert.equal(player.skillGcd, undefined);
  assert.equal(context.skillCooldownWithMinimum(0.1), context.SKILL_MIN_CAST_INTERVAL);
  assert.equal(context.potentialActiveCd({ cd: 0.1 }), context.SKILL_MIN_CAST_INTERVAL);
});

test('技能可用 castTime: 0 明確略過預設施法停頓', () => {
  const context = loadGameContext();
  context.G.player.loadout = ['sg:alpha'];
  stubSkills2(context, { alpha: { castTime: 0 } }, {
    onCast: (player, target) => { target[0].hp -= 1; }
  });
  const player = playerEntity();
  const target = [{ hp: 10000 }];

  const result = context.pickAndCastSkill(player, target, 'float-layer');
  assert.equal(result.casting, undefined);
  assert.equal(player._skillCastRemaining || 0, 0);
  assert.ok(target[0].hp < 10000);
});

test('就緒佇列會跳過條件不符的技能，不讓後面的技能等待掃描輪次', () => {
  const context = loadGameContext();
  context.G.player.loadout = ['sg:blocked', 'sg:ready'];
  const calls = stubSkills2(context, { blocked: {}, ready: { castTime: 0 } }, { blocked: ['blocked'] });
  const player = playerEntity();
  assert.ok(context.pickAndCastSkill(player, [{ hp: 1000 }], 'float-layer'));
  assert.deepEqual(calls, ['ready']);
  assert.equal(player._skillReadyQueued['sg:blocked'], true, '條件不符的技能仍應保留獨立監視');
});

test('明確 castTime 仍可為單一技能保留施法時間', () => {
  const context = loadGameContext();
  context.G.player.loadout = ['sg:alpha'];
  const calls = stubSkills2(context, { alpha: { castTime: 0.4 } }, {
    onCast: (player, target) => { target[0].hp -= 1; }
  });
  const player = playerEntity();
  const target = [{ hp: 10000 }];
  const started = context.pickAndCastSkill(player, target, 'float-layer');
  assert.equal(started.casting, true);
  assert.equal(player._skillCastRemaining, 0.4);
  assert.deepEqual(calls, [], '硬直期間技能尚未放出');
  context.tickSkillCast(player, 0.4);
  assert.deepEqual(calls, ['alpha']);
  assert.ok(target[0].hp < 10000);
});
