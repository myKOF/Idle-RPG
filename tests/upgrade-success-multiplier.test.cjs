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

test('強化碎片費用：總量掛勾裝備品質（R0 約 1 兆、每高一階多 1 倍，R11 約 12 兆）', () => {
  const c = loadContext(LOGIC_FILES);
  const total = (rarity, level) => {
    let sum = 0;
    for (let lv = 0; lv < 100; lv++) sum += c.upgradeCost({ upgrade: lv, level, rarity }).scrap;
    return sum;
  };
  const r0 = total(0, 600), r11 = total(11, 600);
  assert.ok(r0 > 0.9e12 && r0 < 1.1e12, 'R0 約 1 兆，實際 ' + r0);
  assert.ok(Math.abs(r11 / r0 - 12) < 0.01, 'R11 是 R0 的 12 倍，實際 ' + (r11 / r0));
  for (let r = 1; r <= 11; r++) {
    assert.ok(Math.abs(total(r, 600) / r0 - (r + 1)) < 0.01, 'R' + r + ' 應是 R0 的 ' + (r + 1) + ' 倍');
  }
  // 只影響碎片，金幣不分品質
  assert.equal(c.upgradeCost({ upgrade: 5, level: 600, rarity: 0 }).gold, c.upgradeCost({ upgrade: 5, level: 600, rarity: 11 }).gold);
});
