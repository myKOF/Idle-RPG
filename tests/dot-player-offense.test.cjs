const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {},
    clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = { player: {}, stage: { current: 1 } };
  context.GT = 0;
  return context;
}

/* 2026-10-25：玩家施放的持續傷害每一跳吃爆擊率／爆擊傷害、總傷害增幅與該狀態元素的屬性傷害提升%；
   連擊數不計，玩家自己身上的 DoT 不吃。 */
function setup(cfg) {
  const c = loadContext();
  const player = { name: 'P', maxHp: 1000, hp: 1000, effects: {}, buffs: {}, dots: [] };
  c.legendaryCurrentPlayer = () => player;
  c.playerAtkCfg = () => cfg;
  return { c, player };
}

test('DoT 吃總傷害增幅與元素增傷（中毒＝poison）', () => {
  const { c } = setup({ critRate: 0, critDmg: 150, totalDmgPct: 50, elemDmgUp: { poison: 100 } });
  const enemy = { name: '怪', maxHp: 1e6, hp: 1e6, effects: {}, buffs: {}, dots: [] };
  c.applyPoison(enemy, 100, 10);
  c.tickStatuses(enemy, 1);
  assert.equal(Math.round(1e6 - enemy.hp), 300, '100 × (1+100%) × (1+50%)');
});

test('DoT 逐跳擲爆擊：必爆吃爆傷，不爆不吃', () => {
  const crit = setup({ critRate: 100, critDmg: 200, totalDmgPct: 0, elemDmgUp: {} });
  const e1 = { name: '怪', maxHp: 1e6, hp: 1e6, effects: {}, buffs: {}, dots: [] };
  crit.c.applyPoison(e1, 100, 10);
  crit.c.tickStatuses(e1, 1);
  assert.equal(Math.round(1e6 - e1.hp), 200);

  const none = setup({ critRate: 0, critDmg: 200, totalDmgPct: 0, elemDmgUp: {} });
  const e2 = { name: '怪', maxHp: 1e6, hp: 1e6, effects: {}, buffs: {}, dots: [] };
  none.c.applyPoison(e2, 100, 10);
  none.c.tickStatuses(e2, 1);
  assert.equal(Math.round(1e6 - e2.hp), 100);
});

test('玩家自己身上的 DoT 不吃玩家輸出加成', () => {
  const { c, player } = setup({ critRate: 100, critDmg: 300, totalDmgPct: 100, elemDmgUp: { poison: 100 } });
  c.applyPoison(player, 100, 10);
  c.tickStatuses(player, 1);
  assert.equal(Math.round(1000 - player.hp), 100);
});
