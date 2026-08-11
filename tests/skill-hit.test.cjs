const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

// 以可控 Math.random 載入公式層（fakeMath 繼承真 Math，只覆寫 random）
function loadFormula(randVal) {
  const fakeMath = Object.create(Math);
  fakeMath.random = () => randVal;
  const context = { console, Math: fakeMath, window: {} };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f });
  });
  return context;
}

function hitOnce(c, atkHit, defDodge) {
  const attacker = { hp: 1e9 };
  const defender = { hp: 1e9, maxHp: 1e9 };
  const aCfg = { atk: 100, dmgType: 'phys', level: 1, critRate: 0, hit: atkHit };
  const dCfg = { def: 0, level: 1, dodge: defDodge };
  return c.resolveHit(attacker, defender, aCfg, dCfg);
}

test('命中率遠高於敵方閃避時必中（clamp 上限 100）', () => {
  // random=0.99 → chance(100)=99<100 命中；chance(5)=99<5 未命中
  const c = loadFormula(0.99);
  const r = hitOnce(c, 2890, 870); // 玩家命中 2890% vs 敵閃避 870%
  assert.equal(r.miss, false, '命中 2890% 對閃避 870% 應必中');
});

test('固定 100% 命中對高閃避敵人幾乎必被閃避（clamp 下限 5）', () => {
  const c = loadFormula(0.99);
  const r = hitOnce(c, 100, 870); // 舊技能寫死 100% 命中 vs 敵閃避 870%
  assert.equal(r.miss, true, '命中 100% 對閃避 870% → 命中率夾到 5% → 未命中');
});

test('skills.js 技能命中改吃玩家命中率、保留 100 地板', () => {
  const skills = fs.readFileSync(path.join(root, 'js/skills.js'), 'utf8');
  assert.match(skills, /hit:\s*fx\.neverMiss\s*\?\s*999\s*:\s*Math\.max\(100,\s*st\.hit\)/);
});

test('玩家命中派生值包含基礎 100%', () => {
  const formula = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  const data = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
  /* 係數已移進 data.js 的具名物件：套用參數表的錨點改綁「物件名＋欄位名」，
     不再改寫 formula.js 算式裡的字面值（那種錨點會被任何一次重構無聲打斷）。
     斷言因此拆成兩段：算式形狀，以及基礎值仍然是 100。 */
  assert.match(formula, /st\.hit\s*=\s*DERIVED_COEF\.hitBase\s*\+\s*st\.agi\s*\*\s*PRIMARY_STAT_EFFECTS\.agiHit\s*\+\s*A\.hit/);
  assert.match(data, /hitBase:\s*100\b/);
});
