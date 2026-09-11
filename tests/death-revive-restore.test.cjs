const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

/* 「死亡重生後生命與法力都補滿」是一條跨模組的規則：
   野外死亡走 js/combat.js fieldTick 的 reviveCd 出口，高塔戰敗（死亡）回野外走
   js/tower.js finishTowerFight。兩條各自寫各自的回復，因此也要各自釘住。 */
function loadContext() {
  const logs = [];
  const context = {
    console,
    Math: Object.create(Math),
    UI: { dirty: {} },
    blog(message) { logs.push(message); },
    document: { getElementById() { return null; } }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js',
    'js/combat.js', 'js/tower.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.getStats = () => ({ hp: 5000, mp: 300, aspd: 1 });
  context.logs = logs;
  return context;
}

test('野外死亡復活：倒數結束時生命與法力都補滿', () => {
  const c = loadContext();
  c.tickSkillCds = () => {};   // 冷卻推進不是這條測試的主題
  c.G = { player: {}, stage: { current: 10, kills: 0 }, tower: { active: false } };
  c.FIELD.player = { hp: 0, mp: 0, skillCds: {}, buffs: {}, dots: [], effects: {} };
  c.FIELD.reviveCd = 0.05;

  c.fieldTick(0.1);

  assert.equal(c.FIELD.player.hp, 5000);
  assert.equal(c.FIELD.player.mp, 300, '復活要回滿法力，否則一站起來就放不出技能');
  assert.match(c.logs.join('\n'), /你已復活/);
});

test('高塔戰敗回野外：生命與法力都補滿（與野外死亡復活同一條規則）', () => {
  const c = loadContext();
  c.G = { player: {}, stage: { current: 10 }, tower: { active: true, highest: 1 } };
  c.FIELD.player = { hp: 1, mp: 7, skillCds: {}, buffs: {}, dots: [], effects: {} };
  c.TOWER.player = { hp: 0, mp: 0 };
  c.TOWER.boss = { hp: 100 };

  c.finishTowerFight();

  assert.equal(c.FIELD.player.hp, 5000);
  assert.equal(c.FIELD.player.mp, 300, '塔戰失敗＝死亡，回野外只回血不回魔會讓玩家一落地就沒法力');
  assert.equal(c.G.tower.active, false);
});
