const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = { console, Math };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('capValue：上限 0 代表無上限，僅保留下限 0', () => {
  const c = loadContext();
  assert.equal(c.capValue(150, 100), 100);   // 上限 100 → 夾到 100
  assert.equal(c.capValue(80, 100), 80);      // 未達上限 → 原值
  assert.equal(c.capValue(150, 0), 150);      // 上限 0 → 無上限
  assert.equal(c.capValue(999999, 0), 999999);
  assert.equal(c.capValue(-5, 0), 0);         // 仍保留下限 0
  assert.equal(c.capValue(-5, 50), 0);
  assert.equal(c.capValue(30, -1), 30);       // 負上限亦視為無上限
});

test('capText：上限 0 不顯示上限文字，>0 顯示上限值', () => {
  const c = loadContext();
  assert.equal(c.capText(100, '%'), '（上限：100%）');
  assert.equal(c.capText(50, '%', true), '（上限：+50%）');
  assert.equal(c.capText(100, ''), '（上限：100）');
  assert.equal(c.capText(0, '%'), '');
  assert.equal(c.capText(-3, '%'), '');
});

test('statFmt：上限 0 不做「達上限」金色標示；>0 達標才標示', () => {
  const c = loadContext();
  assert.doesNotMatch(c.statFmt(150, 0, '%'), /ffd700/);   // 無上限 → 不標金
  assert.match(c.statFmt(100, 100, '%'), /ffd700/);         // 達上限 → 標金
  assert.doesNotMatch(c.statFmt(80, 100, '%'), /ffd700/);   // 未達上限 → 不標金
});

test('globalDamageReduction：上限 0 代表無上限（減傷率趨近 100%）', () => {
  const c = loadContext();
  c.GLOBAL_DMG_RED_CAP = 50;
  assert.equal(c.globalDamageReduction(1e12), 0.5);        // 上限 50% → 夾到 0.5
  c.GLOBAL_DMG_RED_CAP = 0;
  assert.ok(c.globalDamageReduction(1e12) > 0.99);         // 上限 0 → 無上限，趨近 1
});

test('formula.js：抗性不再使用 STAT_CAPS 上限', () => {
  const formula = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  assert.doesNotMatch(formula, /clamp\([^)]*,\s*0,\s*STAT_CAPS\./);
  assert.doesNotMatch(formula, /Math\.min\([^)]*STAT_CAPS\./);
  assert.match(formula, /st\.critRate = capValue\(/);
  assert.doesNotMatch(formula, /STAT_CAPS\.(pRes|mRes|elemRes)/);
  assert.match(formula, /physicalResistanceReduction/);
  assert.match(formula, /magicResistanceReduction/);
  assert.match(formula, /elementalResistanceReduction/);
});
