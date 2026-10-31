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

/* 2026-10-31：持續傷害每一跳吃承受端的「減傷類」乘區（防禦、物魔抗、元素抗性、聖佑、敵種抗性），
   命中／閃避／格擋／浮動／爆擊不走；最大生命%的狀態與全局減傷之外的固定比例不受防禦影響。 */
function setup(atk, defCfg) {
  const c = loadContext();
  const player = { name: 'P', maxHp: undefined, hp: 1000, effects: {}, buffs: {}, dots: [] };
  delete player.maxHp;
  c.legendaryCurrentPlayer = () => player;
  c.playerAtkCfg = () => Object.assign({ critRate: 0, critDmg: 150, level: 10, totalDmgPct: 0, elemDmgUp: {} }, atk || {});
  if (defCfg) { c.playerDefCfg = () => defCfg; c.getStats = () => ({ level: 10 }); }
  return { c, player };
}
const mkEnemy = (extra) => Object.assign({ name: '怪', maxHp: 1e6, hp: 1e6, level: 10, effects: {}, buffs: {}, dots: [] }, extra);

test('敵人身上的無元素 DoT 吃物理防禦與物理抗性', () => {
  const { c } = setup();
  const enemy = mkEnemy({ def: 10000 });
  c.applyDot(enemy, 100, 10, '流血', 'bleed');
  c.tickStatuses(enemy, 1);
  const expect = 100 * (1 - c.defReduction(10000, 10));
  assert.ok(Math.abs((1e6 - enemy.hp) - expect) < 1e-6, `got ${1e6 - enemy.hp}, want ${expect}`);
  assert.ok(expect < 100 && expect > 50);
});

test('敵人身上的元素 DoT 走魔防，並吃對應元素抗性', () => {
  const { c } = setup();
  const enemy = mkEnemy({ def: 0, mdef: 0, resist: { poison: 100 } });
  c.applyPoison(enemy, 100, 10);
  c.tickStatuses(enemy, 1);
  const expect = 100 * c.elementalResistanceMultiplier({ poison: 100 }, 'poison', 10);
  assert.ok(Math.abs((1e6 - enemy.hp) - expect) < 1e-6, '只有元素抗性生效');
  assert.ok(expect < 100);
});

test('玩家的破甲與穿透會削弱敵人防禦對 DoT 的減傷', () => {
  const plain = setup();
  const e1 = mkEnemy({ def: 10000 });
  plain.c.applyDot(e1, 100, 10, '流血', 'bleed');
  plain.c.tickStatuses(e1, 1);
  const sunder = setup({ sunder: 100 });
  const e2 = mkEnemy({ def: 10000 });
  sunder.c.applyDot(e2, 100, 10, '流血', 'bleed');
  sunder.c.tickStatuses(e2, 1);
  assert.ok(Math.abs((1e6 - e2.hp) - 100) < 1e-6, '破甲 100% ＝ 防禦歸零');
  assert.ok((1e6 - e1.hp) < (1e6 - e2.hp));
});

test('最大生命%的狀態不吃防禦', () => {
  const { c } = setup();
  const enemy = mkEnemy({ def: 1e6, mdef: 1e6 });
  const sid = Object.keys(c.STATUS).find((k) => c.STATUS[k].effect === 'dot' && c.STATUS[k].dmgSource === 'maxHp');
  assert.ok(sid, '狀態表至少要有一個最大生命%的 DoT，否則這條測試失去意義');
  c.applyDot(enemy, 1000, 10, c.STATUS[sid].name, sid, 0);
  c.tickStatuses(enemy, 1);
  assert.ok(Math.abs((1e6 - enemy.hp) - 1000) < 1e-6);
});

test('玩家自傷流血吃自己的防禦，但不吃敵種抗性', () => {
  const { c, player } = setup({ level: 10 }, { def: 10000, mdef: 0, pRes: 0, normalDmgRed: 1e9 });
  c.applyDot(player, 100, 10, '鐵血裂傷', 'sgIronBleed', 0, undefined, { sourceKey: 'skill2:dualdance' });
  c.tickStatuses(player, 1);
  const expect = 100 * (1 - c.defReduction(10000, 10));
  assert.ok(Math.abs((1000 - player.hp) - expect) < 1e-6, `got ${1000 - player.hp}, want ${expect}`);
});

test('敵方施放的 DoT 打到玩家：吃防禦與依施放者敵種的敵種抗性', () => {
  const { c, player } = setup({}, { def: 10000, mdef: 0, pRes: 0, bossDmgRed: 4000, normalDmgRed: 0 });
  c.applyDot(player, 100, 10, '劇毒', 'bleed', undefined, undefined,
    { sourceKey: 'enemy', srcAtk: { level: 10, isBoss: true, isElite: false } });
  c.tickStatuses(player, 1);
  const expect = 100 * (1 - c.defReduction(10000, 10)) * (1 - c.enemyTypeDamageReduction(4000, 10));
  assert.ok(Math.abs((1000 - player.hp) - expect) < 1e-6, `got ${1000 - player.hp}, want ${expect}`);
});

test('聖佑（dmgRed）逐跳生效並夾上限', () => {
  const { c, player } = setup({}, { def: 0, mdef: 0, dmgRed: 999 });
  c.applyDot(player, 100, 10, '流血', 'bleed', undefined, undefined, { sourceKey: 'enemy' });
  c.tickStatuses(player, 1);
  const cap = c.GODFORGED_SANCTUARY_RED_CAP;
  assert.ok(Math.abs((1000 - player.hp) - 100 * (1 - cap / 100)) < 1e-6);
});
