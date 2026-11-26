const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGameContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('洗煉精華消耗符合神話、創世與神鑄創世規則', () => {
  const context = loadGameContext();
  // 基礎量 × 品質倍率（R6＝2、R7＝4、R9＝8；倍率另在 reroll-count-cost.test.cjs 驗）
  const m = (r) => context.rerollRarityMult(r);
  assert.equal(context.rerollCost({ rarity: 6, level: 50 }).essence, 9 * m(6));
  assert.equal(context.rerollCost({ rarity: 7, level: 50 }).essence, 14 * m(7));
  assert.equal(context.rerollCost({ rarity: 9, level: 50 }).essence, 20 * m(9));
});

test('其他品質洗煉精華消耗維持原本公式', () => {
  const context = loadGameContext();
  assert.equal(context.rerollCost({ rarity: 0, level: 50 }).essence, 1);
  assert.equal(context.rerollCost({ rarity: 5, level: 50 }).essence, 6);
});

test('洗煉精華消耗依裝備等級除數縮放並捨去小數，最終至少為1', () => {
  const context = loadGameContext();
  assert.equal(context.REROLL_ESSENCE_LEVEL_DIVISOR, 50);
  assert.equal(context.rerollCost({ rarity: 0, level: 49 }).essence, 1);
  assert.equal(context.rerollCost({ rarity: 0, level: 50 }).essence, 1);
  const m = (r) => context.rerollRarityMult(r);
  assert.equal(context.rerollCost({ rarity: 6, level: 75 }).essence, 13 * m(6));
  assert.equal(context.rerollCost({ rarity: 7, level: 100 }).essence, 28 * m(7));
  assert.equal(context.rerollCost({ rarity: 10, level: 50 }).essence, 27 * m(10));
});

test('低等裝備所有品質與洗煉次數皆不產生零資源需求', () => {
  const c = loadGameContext();
  for (let rarity = 0; rarity < c.RARITIES.length; rarity++) {
    for (const level of [1, 2, 10, 49, 50, 51]) {
      for (const rerollCount of [0, 5, 100, 9900]) {
        const cost = c.rerollCost({ rarity, level, rerollCount });
        for (const [resource, amount] of Object.entries(cost)) {
          assert.ok(Number.isInteger(amount) && amount >= 1, `${rarity}/${level}/${rerollCount}/${resource}: ${amount}`);
        }
      }
    }
  }
});

test('遺物折扣最後取整仍至少收1份精華，較高費用保留原捨去規則', () => {
  const c = loadGameContext();
  c.relicDiscount = (key, amount) => {
    assert.equal(key, 'rerollEssenceDiscount');
    return amount * 0.99;
  };
  assert.equal(c.rerollCost({ rarity: 0, level: 1 }).essence, 1, '等級縮放已經捨去為0');
  assert.equal(c.rerollCost({ rarity: 0, level: 50 }).essence, 1, '1份打折後小於1');
  assert.equal(c.rerollCost({ rarity: 0, level: 100 }).essence, 1, '2份打折後維持捨去');
  c.relicDiscount = () => 0;
  assert.equal(c.rerollCost({ rarity: 9, level: 300 }).essence, 1, '折扣不能免除必要資源');
  c.REROLL_COST_GOLD.coef = 0.001;
  assert.equal(c.rerollCost({ rarity: 0, level: 1 }).gold, 1, '金幣取整也有下限');
});
