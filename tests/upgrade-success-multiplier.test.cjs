const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext(files) {
  const context = {
    console,
    Math: Object.create(Math),
    UI: { dirty: {}, sel: null },
    document: { addEventListener() {}, getElementById() { return null; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, key() { return null; }, length: 0 },
    location: { hostname: '127.0.0.1', reload() {} },
    setTimeout() {},
    clearTimeout() {},
    Date,
    JSON,
  };
  context.window = context;
  context.flog = () => {};
  context.blog = () => {};
  vm.createContext(context);
  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

const LOGIC_FILES = [
  'js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js'
];

test('強化基礎成功率：+5 內 100%，之後每級 -6 百分點，下限 10%', () => {
  const c = loadContext(LOGIC_FILES);
  assert.equal(c.upgradeSuccessBase(1), 100);
  assert.equal(c.upgradeSuccessBase(5), 100);
  assert.equal(c.upgradeSuccessBase(6), 94);
  assert.equal(c.upgradeSuccessBase(10), 70);
  assert.equal(c.upgradeSuccessBase(20), 10);
  assert.equal(c.upgradeSuccessBase(100), 10);
});

test('強化成功率屬性與基礎成功率相乘，並夾在 100% 內', () => {
  const c = loadContext(LOGIC_FILES);
  // upgradeSuccessChance 只讀 it.upgrade 與 getStats().enhanceSuccess
  const withStat = (pct) => {
    c.getStats = () => ({ enhanceSuccess: pct });
    return (upg) => c.upgradeSuccessChance({ upgrade: upg - 1 });
  };
  // 目標 +100 的基礎是下限 10%；目標 +10 的基礎是 70%
  assert.equal(withStat(0)(100), 10);
  assert.equal(withStat(100)(100), 20);
  assert.equal(withStat(100)(10), 100); // 70% × 2 = 140% → 夾 100%
  assert.ok(Math.abs(withStat(50)(10) - 100) < 1e-9); // 70% × 1.5 = 105% → 夾 100%
  assert.ok(Math.abs(withStat(30)(10) - 91) < 1e-9); // 70% × 1.3 = 91%
  assert.equal(withStat(900)(100), 100); // 下限 10% 需 +900% 才必過
  assert.equal(withStat(0)(3), 100); // 免費段不受影響
});
