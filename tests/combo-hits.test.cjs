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
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js'].forEach((f) => {
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

test('comboHitsFor：溢出% = 暴擊率 − 100（以比例代入）；溢出 ≤ 100%（ln ≤ 0）時為 0', () => {
  const c = loadFormula();
  approx(c.comboHitsFor(250), 0.5 * Math.log(1.5), 1e-9, '暴擊 250% → 溢出 150% → 0.5·ln(1.5)≈0.203');
  assert.equal(c.comboHitsFor(200), 0, '溢出恰 100%，ln(1)=0');
  assert.equal(c.comboHitsFor(150), 0, '溢出 50%，ln 為負，夾到 0 不出現負連擊');
  assert.equal(c.comboHitsFor(101), 0);
});

test('comboHitsFor：更高暴擊率單調成長', () => {
  const c = loadFormula();
  approx(c.comboHitsFor(1100), 0.5 * Math.log(10), 1e-9, '暴擊 1100% → 溢出 1000% → 0.5·ln(10)');
  assert.ok(c.comboHitsFor(300) > c.comboHitsFor(250));
  assert.ok(c.comboHitsFor(5000) > c.comboHitsFor(1380));
});

test('comboHitsTotal：攻速（以攻速加成%計，門檻＝攻速到 5 次/秒的加成%、a=0.65）與冷卻縮減（門檻＝冷卻縮減上限 60%、a=0.8）各自溢出，三者相加', () => {
  const c = loadFormula();
  const AT = (5 / c.ASPD_BASE - 1) * 100;          // 攻速剛好 5 次/秒的攻速加成%（≈481.4）
  assert.equal(c.comboHitsTotal(100, AT, 60), 0, '三項都在門檻上＝0');
  // 攻速溢出% ＝ 攻速加成% − 門檻（百分點）：多 150 → 150%
  approx(c.comboHitsTotal(100, AT + 150, 60), 0.65 * Math.log(1.5), 1e-9, '只有攻速溢出');
  // 冷卻縮減溢出% ＝ 冷卻縮減 − 60：210% → 150%
  approx(c.comboHitsTotal(100, AT, 210), 0.8 * Math.log(1.5), 1e-9, '只有冷卻縮減溢出');
  approx(c.comboHitsTotal(250, AT + 150, 210),
    (0.5 + 0.65 + 0.8) * Math.log(1.5), 1e-9, '三項相加');
  assert.equal(c.comboHitsTotal(100, AT + 50, 90), 0, '溢出未達 100% 的項為 0');
  assert.equal(c.comboHitsTotal(100, 87.1, 60), 0, '攻速加成 87.1%（攻速約 1.6 次/秒）遠未到門檻');
});

test('comboHitsTotal：門檻跟著冷卻縮減上限（STAT_CAPS.cdr）；上限 0 時退回預設 60', () => {
  const c = loadFormula();
  const AT = (5 / c.ASPD_BASE - 1) * 100;
  c.STAT_CAPS.cdr = 80;
  approx(c.comboHitsTotal(100, AT, 230), 0.8 * Math.log(1.5), 1e-9, '上限 80 → 230 溢出 150%');
  c.STAT_CAPS.cdr = 0;
  approx(c.comboHitsTotal(100, AT, 210), 0.8 * Math.log(1.5), 1e-9, '無上限時用 cdrAt=60');
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
  assert.match(data, /每次攻擊命中時有25%機率造成額外攻擊次數/);
  assert.match(data, /暴擊率、攻擊速度、冷卻縮減溢出上限時將會轉為增加連擊數/);
  assert.doesNotMatch(data, /整數部分固定追加|2\.57＝固定|中毒／詛咒/);
});
