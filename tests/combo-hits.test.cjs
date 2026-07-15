const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

// 以可控 Math.random 載入公式層（fakeMath 繼承真 Math，只覆寫 random，不污染測試進程）
function loadFormula(randFn) {
  const fakeMath = Object.create(Math);
  if (randFn) fakeMath.random = randFn;
  const context = { console, Math: fakeMath, window: {} };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f });
  });
  return context;
}

function approx(actual, expected, eps, msg) {
  assert.ok(Math.abs(actual - expected) <= eps, (msg || '') + ` 期望≈${expected}，實得 ${actual}`);
}

test('comboHitsFor：暴擊率 ≤ 100% 時連擊數為 0', () => {
  const c = loadFormula();
  assert.equal(c.comboHitsFor(100), 0);   // 完全爆擊，尚無連擊
  assert.equal(c.comboHitsFor(80), 0);
  assert.equal(c.comboHitsFor(5), 0);
  assert.equal(c.comboHitsFor(0), 0);
});

test('comboHitsFor：恰 100% 為 0、超過即為正（閘門）', () => {
  const c = loadFormula();
  assert.equal(c.comboHitsFor(100), 0);                 // 完全爆擊，無連擊
  // 101% → x=1.01：0.875*ln(1.01)+0.01387*1.01+0.0861 ≈ 0.1088
  approx(c.comboHitsFor(101), 0.1088, 0.001, '暴擊 101%');
});

test('comboHitsFor：暴擊率% 直接代入（÷100），範例 1380% ≈ 2.57', () => {
  const c = loadFormula();
  // x=13.8：0.875*ln(13.8)+0.01387*13.8+0.0861 ≈ 2.574
  approx(c.comboHitsFor(1380), 2.574, 0.01, '連擊數 2.57 範例（暴擊 1380%）');
});

test('comboHitsFor：更高暴擊率單調成長（比值代入）', () => {
  const c = loadFormula();
  approx(c.comboHitsFor(200), 0.7203, 0.01, '暴擊 200% → x=2');
  approx(c.comboHitsFor(5000), 4.2026, 0.01, '暴擊 5000% → x=50');
  assert.ok(c.comboHitsFor(300) > c.comboHitsFor(200));
  assert.ok(c.comboHitsFor(5000) > c.comboHitsFor(1380));
});

test('rollComboHits：整數固定追加、小數依機率', () => {
  // random→0 ⇒ chance(任意>0)=true ⇒ 小數必追加
  const cHit = loadFormula(() => 0);
  assert.equal(cHit.rollComboHits({ comboHits: 2.57 }), 3); // 2 + 命中 1
  assert.equal(cHit.rollComboHits({ comboHits: 3 }), 3);    // 純整數，chance(0)=false 不追加
  // random→0.999 ⇒ chance(57)=false ⇒ 小數不追加
  const cMiss = loadFormula(() => 0.999);
  assert.equal(cMiss.rollComboHits({ comboHits: 2.57 }), 2);
});

test('rollComboHits：0 或無效輸入回傳 0', () => {
  const c = loadFormula(() => 0);
  assert.equal(c.rollComboHits({ comboHits: 0 }), 0);
  assert.equal(c.rollComboHits({}), 0);
  assert.equal(c.rollComboHits(null), 0);
});

test('computeStats 派生 st.comboHits（原始碼接線）', () => {
  const formula = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  assert.match(formula, /st\.comboHits = comboHitsFor\(st\.critRate\)/);
  assert.match(formula, /function comboHitsFor\(critRate\)/);
  assert.match(formula, /function rollComboHits\(st\)/);
});

test('combat.js 普攻追加連擊段（僅主攻擊、遞迴 depth）', () => {
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  assert.match(combat, /rollComboHits\(st\)/);
  // 僅 depth 0 觸發，且遞迴時帶入更深 depth 避免再觸連擊
  assert.match(combat, /!depth[\s\S]*?rollComboHits\(st\)/);
});

test('skills.js 技能直接傷害段外包連擊迴圈（持續傷害不受影響）', () => {
  const skills = fs.readFileSync(path.join(root, 'js/skills.js'), 'utf8');
  assert.match(skills, /var comboReps = rollComboHits\(st\)/);
  assert.match(skills, /for \(var rep = 0; rep <= comboReps/);
});

test('data.js 連擊數常數與面板列', () => {
  const data = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
  assert.match(data, /COMBO_HITS_COEF = \{/);
  assert.match(data, /連擊數/);
  assert.match(data, /暴擊率超過 100% 後衍生：普攻與技能的「直接傷害」會額外追加的攻擊次數。持續傷害不受影響。/);
  assert.doesNotMatch(data, /整數部分固定追加|2\.57＝固定|中毒／詛咒/);
});
