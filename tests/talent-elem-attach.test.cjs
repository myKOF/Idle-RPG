const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

/* 5/9 轉元素天賦附傷：攻擊時附加「當次傷害 × 天賦%」的元素傷害（resolveHit 元素附加段）。
   固定化隨機：chance 只在機率 ≥100% 時成立（命中必中、暴擊/元素特效依測試自行給 100），rnd 固定 1。 */

function loadFormulaContext() {
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.chance = (p) => p >= 100;
  context.rnd = () => 1;
  return context;
}

function hit(context, aCfg, dCfg) {
  const defender = { hp: 1e9, shield: 0, effects: {}, dots: [] };
  return context.resolveHit({}, defender, Object.assign({
    atk: 10000, dmgType: 'magic', level: 1, hit: 100
  }, aCfg), Object.assign({ dodge: 0, mdef: 0, mRes: 0, resist: {} }, dCfg));
}

test('天賦附傷 = 當次傷害 × 附傷%（1% 火、當次 10000 → 額外 100）', () => {
  const c = loadFormulaContext();
  assert.equal(hit(c, { elemDmgPct: { fire: 1 } }, {}).dmg, 10100);
});

test('附傷基底跟著當次傷害縮放：防禦減半 → 附傷同步減半', () => {
  const c = loadFormulaContext();
  // defReduction(68, Lv1) = 68 / (68 + 60 + 8) = 50% → 當次 5000、火附傷 50
  assert.equal(hit(c, { elemDmgPct: { fire: 1 } }, { mdef: 68 }).dmg, 5050);
});

test('暴擊放大附傷基底：暴擊 ×200% → 附傷同步 ×2', () => {
  const c = loadFormulaContext();
  const r = hit(c, { critRate: 100, critDmg: 200, elemDmgPct: { fire: 1 } }, {});
  assert.equal(r.crit, true);
  assert.equal(r.dmg, 20200);
});

test('六系並存各自結算：對應元素抗性獨立減免、暗影汲取回復', () => {
  const c = loadFormulaContext();
  const all = { fire: 1, ice: 1, lightning: 1, poison: 1, light: 1, dark: 1 };
  const r = hit(c, { elemDmgPct: all }, { resist: { fire: 50 } });
  const expectedFire = 100 * (1 - c.elementalResistanceReduction(50, 1));
  assert.equal(r.dmg, Math.round(10000 + expectedFire + 100 * 5));
  assert.equal(r.heal, 100 * 0.25);          // 暗影汲取元傷 25%
});

test('固定值元素攻擊（裝備附魔）與天賦附傷%疊加', () => {
  const c = loadFormulaContext();
  assert.equal(hit(c, { elemAtk: { fire: 200 }, elemDmgPct: { fire: 1 } }, {}).dmg, 10300);
});

/* ---- computeStats 派生 ---- */

function loadStatsContext() {
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/talents.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = {
    player: { level: 1, reincarnations: 2, skills: {}, talents: { levels: {}, potentialLevels: {} } },
    equipment: context.SLOT_LIST.reduce((eq, slot) => { eq[slot] = null; return eq; }, {})
  };
  return context;
}

test('computeStats 派生 elemDmgPct，天賦不再灌進固定值元素攻擊', () => {
  const c = loadStatsContext();
  c.G.player.talents.levels.t5_fire = 10; // 5 轉：10 級 × 1% = 10%
  c.G.player.talents.levels.t9_fire = 10; // 9 轉：10 級 × 2% = 20%（同元素相加）
  const st = c.computeStats();
  assert.equal(st.elemDmgPct.fire, 30);
  assert.equal(st.elemDmgPct.ice, 0);
  assert.equal(st.elemAtk.fire, 0); // 無裝備附魔 → 固定值附傷應為 0
});

test('元素核心改為乘算提高附傷%，未點的元素不再憑空附傷', () => {
  const c = loadStatsContext();
  c.G.player.talents.levels.t5_fire = 10; // 10%
  c.G.player.talents.potentialLevels.p5_elementCore = 5; // 5 級 × 2% = +10%
  const st = c.computeStats();
  assert.ok(Math.abs(st.elemDmgPct.fire - 11) < 1e-9); // 10% × 1.1
  assert.equal(st.elemDmgPct.ice, 0);
  assert.equal(st.elemAtk.ice, 0);
});

test('普攻與技能直接傷害段皆傳遞天賦附傷%（原始碼接線）', () => {
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  const skills = fs.readFileSync(path.join(root, 'js/skills.js'), 'utf8');
  assert.match(combat, /elemDmgPct:\s*st\.elemDmgPct/);
  assert.match(skills, /elemDmgPct:\s*st\.elemDmgPct/);
});
