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
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js'].forEach((f) => {
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
  // 暴擊 a=0.5：101% → x=1.01：0.5*ln(1.01) ≈ 0.004975
  approx(c.comboHitsFor(101), 0.004975, 0.0001, '暴擊 101%');
});

test('comboHitsFor：暴擊率% 直接代入（÷100），1380% ≈ 1.31、5000% ≈ 1.96', () => {
  const c = loadFormula();
  approx(c.comboHitsFor(1380), 0.5 * Math.log(13.8), 0.001, '暴擊 1380%');
  approx(c.comboHitsFor(5000), 0.5 * Math.log(50), 0.001, '暴擊 5000%');
  assert.ok(c.comboHitsFor(300) > c.comboHitsFor(200));
});

test('comboHitsTotal：攻速（門檻 5 次/秒、a=0.65）與冷卻縮減（門檻 60%、a=0.8）各自溢出，三者相加', () => {
  const c = loadFormula();
  assert.equal(c.comboHitsTotal(100, 5, 60), 0, '三項都在門檻上＝0');
  approx(c.comboHitsTotal(100, 6.5, 60), 0.65 * Math.log(1.3), 1e-9, '只有攻速溢出');
  approx(c.comboHitsTotal(100, 5, 90), 0.8 * Math.log(1.5), 1e-9, '只有冷卻縮減溢出');
  approx(c.comboHitsTotal(200, 10, 120),
    0.5 * Math.log(2) + 0.65 * Math.log(2) + 0.8 * Math.log(2), 1e-9, '三項相加');
});

test('COMBO_HITS_COEF：預設值（觸發率 25%、暴擊 0.5、攻速 0.65、冷卻縮減 0.8）', () => {
  const c = loadFormula();
  const k = c.COMBO_HITS_COEF;
  assert.deepEqual([k.trigger, k.crit, k.aspd, k.cdr], [25, 0.5, 0.65, 0.8]);
});

test('rollComboHits：先過觸發率，整數固定追加、小數依機率', () => {
  // random→0 ⇒ chance(任意>0)=true ⇒ 觸發且小數必追加
  const cHit = loadFormula(() => 0);
  assert.equal(cHit.rollComboHits({ comboHits: 2.57 }), 3); // 2 + 命中 1
  assert.equal(cHit.rollComboHits({ comboHits: 3 }), 3);    // 純整數，chance(0)=false 不追加
  // random→0.999 ⇒ 觸發率 25% 沒過 ⇒ 0
  const cMiss = loadFormula(() => 0.999);
  assert.equal(cMiss.rollComboHits({ comboHits: 2.57 }), 0);
  // 觸發率調成 100%：random→0.999 時整數部分仍固定追加、小數不追加
  cMiss.COMBO_HITS_COEF.trigger = 100;
  assert.equal(cMiss.rollComboHits({ comboHits: 2.57 }), 2);
  // 觸發率 0：永遠不追加
  cHit.COMBO_HITS_COEF.trigger = 0;
  assert.equal(cHit.rollComboHits({ comboHits: 5 }), 0);
});

test('rollComboHits：0 或無效輸入回傳 0', () => {
  const c = loadFormula(() => 0);
  assert.equal(c.rollComboHits({ comboHits: 0 }), 0);
  assert.equal(c.rollComboHits({}), 0);
  assert.equal(c.rollComboHits(null), 0);
});

test('computeStats 派生 st.comboHits（原始碼接線）', () => {
  const formula = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  assert.match(formula, /st\.comboHits = comboHitsTotal\(st\.critRate, /);
  assert.match(formula, /function comboHitsFor\(critRate\)/);
  assert.match(formula, /function rollComboHits\(st\)/);
});

test('combat.js 普攻追加連擊段（僅主攻擊、遞迴 depth）', () => {
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  // 新版技能【狂化連殺】（2026-08-14）：擲骰帶入 skill2ComboBonus 加成，未啟用時原樣走 st
  assert.match(combat, /skill2ComboBonus/);
  assert.match(combat, /rollComboHits\(comboBonus > 0 \? \{ comboHits: \(st\.comboHits \|\| 0\) \+ comboBonus \} : st\)/);
  // 僅 depth 0 觸發，且遞迴時帶入更深 depth 避免再觸連擊
  assert.match(combat, /!depth[\s\S]*?rollComboHits\(/);
});

test('data.js 連擊數常數與面板列', () => {
  const data = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
  assert.match(data, /COMBO_HITS_COEF = \{/);
  assert.match(data, /連擊數/);
  assert.match(data, /暴擊率、攻速、冷卻縮減三項屬性達到一定程度後，超出的部分會增加連擊數。每次攻擊命中時有機會追加這麼多次攻擊。持續傷害不受影響。/);
  assert.doesNotMatch(data, /整數部分固定追加|2\.57＝固定|中毒／詛咒/);
});
