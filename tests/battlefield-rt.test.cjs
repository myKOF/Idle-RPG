/* 新版戰鬥 P3：技能執行期機制的空間化
   領域改為「打在地上的一塊區域」、連鎖與濺射改為由近而遠擴散，
   不再對整個場上無差別生效或隨機挑對象。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadGameContext() {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {},
    clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
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
    player: { level: 1, reincarnations: 0, skills: {}, talents: { levels: {}, potentialLevels: {} }, loadout: [], fusions: [] },
    stage: { current: 1 },
    tower: { active: false }
  };
  context.getStats = () => ({
    cdr: 0, castSpeed: 0, hp: 1000, mp: 1000, atk: 100, matk: 100,
    aoeDmg: 0, critRate: 0, critDmg: 150, pPen: 0, mPen: 0, hit: 100, level: 1,
    passives: {}, lifesteal: 0, manaSteal: 0, shieldEff: 0, skillTriggers: {}
  });
  return context;
}

function enemy(col, row, extra) {
  return Object.assign({
    hp: 100000, maxHp: 100000, def: 0, mdef: 0, dodge: 0, resist: {}, ctrlRes: 0,
    elite: false, isBoss: false, buffs: {}, dots: [], effects: {}, shield: 0,
    cell: { col, row, w: 1, h: 1 }
  }, extra || {});
}

test('領域只打施放當下覆蓋到的格子，區域外的敵人不受影響', () => {
  const c = loadGameContext();
  c.resetSkillRT();
  const pEnt = { hp: 1000, mp: 1000, buffs: {}, dots: [], effects: {}, skillCds: {} };
  const inside = enemy(1, 2);
  const outside = enemy(4, 4);

  // 以 2×2 區域開一個領域：覆蓋 c1r2 附近，打不到 c4r4
  const sk = { name: '測試領域', emoji: '🌀', tags: [] };
  const fx = { dmgType: 'phys', stat: 'atk', field: { tickPct: 100, dur: 10, tickSec: 1 } };
  const out = { baseVal: 1000, areaCells: [{ col: 1, row: 1 }, { col: 2, row: 1 }, { col: 1, row: 2 }, { col: 2, row: 2 }] };
  c.skillRtOpenField(pEnt, sk, fx, 'testField', 1, c.getStats(), out);

  const entry = c.SKILL_RT.fields[0];
  assert.ok(entry.cellSet, '領域必須記住覆蓋的格子');
  entry.onTick({ pEnt, getEnemies: () => [inside, outside], floatSel: 'mv-float' });

  assert.ok(inside.hp < 100000, '站在領域裡的敵人要吃到跳傷');
  assert.equal(outside.hp, 100000, '領域外的敵人不該吃到跳傷');
});

test('沒有格位資訊時領域維持全場語意（高塔單體 BOSS 不受影響）', () => {
  const c = loadGameContext();
  c.resetSkillRT();
  const pEnt = { hp: 1000, mp: 1000, buffs: {}, dots: [], effects: {}, skillCds: {} };
  const boss = { hp: 100000, maxHp: 100000, def: 0, mdef: 0, dodge: 0, resist: {}, ctrlRes: 0, isBoss: true, buffs: {}, dots: [], effects: {}, shield: 0 };
  const sk = { name: '測試領域', emoji: '🌀', tags: [] };
  const fx = { dmgType: 'phys', stat: 'atk', field: { tickPct: 100, dur: 10, tickSec: 1 } };

  c.skillRtOpenField(pEnt, sk, fx, 'testField', 1, c.getStats(), { baseVal: 1000, areaCells: null });
  const entry = c.SKILL_RT.fields[0];
  assert.equal(entry.cellSet, null);
  entry.onTick({ pEnt, getEnemies: () => [boss], floatSel: 'tb-float' });
  assert.ok(boss.hp < 100000, '無格位資訊時仍照原本的全場語意結算');
});

test('領域的受傷增幅只加在站在領域裡的敵人身上', () => {
  const c = loadGameContext();
  c.resetSkillRT();
  const inside = enemy(1, 2);
  const outside = enemy(4, 4);
  c.SKILL_RT.fields.push({
    name: '增幅領域', until: c.GT + 10, tickSec: 1, nextAt: c.GT + 1,
    takenAmpPct: 100, ampKey: 'phys',
    cellSet: c.bfCellSet([{ col: 1, row: 2 }])
  });

  const ampInside = c.skillRtFieldAmpACfg({ atk: 100, dmgType: 'phys', isPlayer: true }, inside);
  const ampOutside = c.skillRtFieldAmpACfg({ atk: 100, dmgType: 'phys', isPlayer: true }, outside);
  assert.equal(ampInside.atk, 200);
  assert.equal(ampOutside.atk, 100);

  // 不帶目標的呼叫端維持原本的無條件增幅（相容既有呼叫）
  assert.equal(c.skillRtFieldAmpACfg({ atk: 100, dmgType: 'phys', isPlayer: true }).atk, 200);
});

test('DoT 濺射與印記轉移交給離死者最近的敵人，不再全場隨機', () => {
  const c = loadGameContext();
  c.resetSkillRT();
  const stats = {
    cdr: 0, castSpeed: 0, hp: 1000, mp: 1000, atk: 100, matk: 100,
    aoeDmg: 0, critRate: 0, critDmg: 150, pPen: 0, mPen: 0, hit: 100, level: 1,
    passives: {}, lifesteal: 0, manaSteal: 0, shieldEff: 0,
    skillTriggers: { dotSplashOnKill: 50 }
  };
  c.getStats = () => stats;

  const dead = enemy(1, 1, { hp: 0 });
  dead.dots = [{ dps: 100, until: c.GT + 5, name: '流血', dur: 5, ext: 0 }];
  const near = enemy(2, 1);   // 與死者相鄰
  const far = enemy(4, 4);    // 對角最遠

  for (let i = 0; i < 30; i++) {
    near.dots = []; far.dots = [];
    c.skillRtOnEnemyDeath(dead, [near, far]);
    assert.equal(near.dots.length, 1, '濺射應落在最近的敵人');
    assert.equal(far.dots.length, 0, '最遠的敵人不該吃到濺射');
  }
});

test('連鎖由近而遠擴散：第一跳打主目標，之後跳到最近的鄰居', () => {
  const c = loadGameContext();
  const a = enemy(1, 2);   // 主目標
  const b = enemy(2, 2);   // 與 a 相鄰
  const far = enemy(4, 4); // 最遠
  const order = c.bfChainOrder(a, [a, b, far], 3);
  assert.equal(order.length, 3);
  assert.equal(order[0], a, '第一跳打主目標');
  assert.equal(order[1], b, '第二跳跳到最近的鄰居');
  assert.equal(order[2], far);
});

test('連鎖的下一跳一定往外跳，不會停在原地', () => {
  const c = loadGameContext();
  const a = enemy(1, 2);
  const b = enemy(2, 2);
  assert.equal(c.bfChainNext(a, [a, b]), b, '有其他敵人時必須跳走');
  assert.equal(c.bfChainNext(a, [a]), a, '場上只剩自己時仍打自己（維持打滿次數）');
  assert.equal(c.bfChainNext(null, [b, a]), a, '沒有起點時從離我方最近的開始');
});

test('場上只有一個敵人時連鎖仍打滿次數（與改造前行為一致）', () => {
  const c = loadGameContext();
  const only = enemy(2, 2);
  const order = c.bfChainOrder(only, [only], 4);
  assert.equal(order.length, 4);
  order.forEach((e) => assert.equal(e, only));
});

test('連鎖／濺射的對象取自整個戰場，不受技能傷害範圍限制', () => {
  const c = loadGameContext();
  const a = enemy(1, 2);
  const b = enemy(3, 3);
  c.FIELD.monsters = [a, b];
  c.FIELD.monster = a;
  // 技能只打了 a（單體），但擴散類效果仍看得到 b
  const field = c.skillRtActiveEnemies([a]);
  assert.equal(field.length, 2);
  assert.ok(field.indexOf(b) >= 0);
});
