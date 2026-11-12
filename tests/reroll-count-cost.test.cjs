const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function loadContext() {
  const context = {
    console, Math: Object.create(Math), UI: { dirty: {}, sel: null },
    document: { addEventListener() {}, getElementById() { return null; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, key() { return null; }, length: 0 },
    location: { hostname: '127.0.0.1', reload() {} }, setTimeout() {}, clearTimeout() {}, Date, JSON,
  };
  context.window = context;
  context.flog = () => {};
  context.blog = () => {};
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

// 神鑄創世（編號 9）基礎精華 20，等級 50 → 20 × 50 ÷ 50 ＝ 20
const base = (rerollCount) => ({ rarity: 9, level: 50, rerollCount });

test('洗煉次數加成：每次 +1%、小數捨去（精華 20：1 次仍 20、5 次 21）', () => {
  const c = loadContext();
  c.REROLL_RARITY_COST.from = 99;   // 這裡只驗次數加成，關掉品質倍率
  assert.equal(c.rerollCost(base(undefined)).essence, 20, '舊存檔沒有次數＝0 次');
  assert.equal(c.rerollCost(base(0)).essence, 20);
  assert.equal(c.rerollCost(base(1)).essence, 20, '20.2 捨去');
  assert.equal(c.rerollCost(base(4)).essence, 20, '20.8 捨去');
  assert.equal(c.rerollCost(base(5)).essence, 21);
  assert.equal(c.rerollCost(base(50)).essence, 30);
  assert.equal(c.rerollCost(base(100)).essence, 40);
});

test('洗煉次數加成：金幣同步增加，且兩者最高為原費用的 100 倍', () => {
  const c = loadContext();
  c.REROLL_RARITY_COST.from = 99;   // 這裡只驗次數加成，關掉品質倍率
  const g0 = c.rerollCost(base(0)).gold;
  assert.equal(c.rerollCost(base(5)).gold, Math.floor(g0 * 1.05));
  assert.equal(c.rerollCost(base(100)).gold, g0 * 2);
  assert.equal(c.rerollCost(base(9900)).gold, g0 * 100);
  assert.equal(c.rerollCost(base(9900)).essence, 2000);
  assert.equal(c.rerollCost(base(1000000)).gold, g0 * 100, '超過上限不再增加');
  assert.equal(c.rerollCost(base(1000000)).essence, 2000);
  // 壞值（負數、小數、非數字）視為合理次數
  assert.equal(c.rerollCost(base(-7)).essence, 20);
  assert.equal(c.rerollCost(base('x')).essence, 20);
  assert.equal(c.rerollCost(base(5.9)).essence, 21);
});

test('每件裝備各自記次數；整件與單詞條洗煉共用同一個計數', () => {
  const c = loadContext();
  c.G = { player: { gold: 1e15, essence: 1e9, ancientEssence: 0 } };
  c.getStats = () => ({ luck: 0, affixCap: 0 });
  c.markStatsDirty = () => {};
  c.rollAncientAffixCount = () => 0;
  const a = c.makeEquipment(200, { rarity: 6, level: 200, slot: 'ring' });
  const b = c.makeEquipment(200, { rarity: 6, level: 200, slot: 'ring' });
  assert.equal(a.rerollCount, 0, '新裝備從 0 開始');
  assert.equal(c.rerollItemAffixes(a), null);
  assert.equal(a.rerollCount, 1);
  assert.equal(c.rerollSingleAffix(a, a.affixes[0].key), null);
  assert.equal(a.rerollCount, 2, '單詞條洗煉與整件共用計數');
  assert.equal(b.rerollCount, 0, '別件不受影響');
  // 實際扣款＝洗煉前顯示的費用（以 a 目前 2 次計）
  a.rerollCount = 100;
  const cost = c.rerollCost(a);
  const g = c.G.player.gold, e = c.G.player.essence;
  assert.equal(c.rerollItemAffixes(a), null);
  assert.equal(g - c.G.player.gold, cost.gold);
  assert.equal(e - c.G.player.essence, cost.essence);
  assert.equal(a.rerollCount, 101);
  // 資源不足：不扣、不加次數
  c.G.player.gold = 0;
  assert.notEqual(c.rerollItemAffixes(a), null);
  assert.equal(a.rerollCount, 101);
});

test('洗煉品質倍率：R0～R5 不變，R6 起每高一階多 2 倍（R6＝2 倍…R11＝12 倍），金幣與精華同步', () => {
  const c = loadContext();
  c.REROLL_RARITY_EXTRA.mult = 1;   // R8 的 1.4 加價另有測試，這裡只驗品質階梯
  const want = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 2, 7: 4, 8: 6, 9: 8, 10: 10, 11: 12 };
  Object.keys(want).forEach((r) => assert.equal(c.rerollRarityMult(Number(r)), want[r], 'R' + r));
  // 神鑄創世（R9）基礎精華 20、等級 50：20 × 8 倍 = 160；次數加成接在倍率之後
  assert.equal(c.rerollCost({ rarity: 9, level: 50, rerollCount: 0 }).essence, 160);
  assert.equal(c.rerollCost({ rarity: 9, level: 50, rerollCount: 5 }).essence, Math.floor(160 * 1.05));
  // 金幣：同一個稀有度的金幣基礎值（用 R5 以下的倍率 1 對照，不寫死表上數字）
  const goldAtMult1 = (r, level) => {
    const saved = c.REROLL_RARITY_COST.from;
    c.REROLL_RARITY_COST.from = 99;   // 暫時關掉品質倍率，取原始金幣
    const g = c.rerollCost({ rarity: r, level, rerollCount: 0 }).gold;
    c.REROLL_RARITY_COST.from = saved;
    return g;
  };
  [6, 7, 9, 10, 11].forEach((r) => {
    assert.equal(c.rerollCost({ rarity: r, level: 300, rerollCount: 0 }).gold, goldAtMult1(r, 300) * want[r], 'R' + r + ' 金幣');
  });
  // R5（含）以下與舊算法完全一致：精華＝floor(基礎 × 等級 ÷ 50)
  assert.equal(c.rerollCost({ rarity: 5, level: 100, rerollCount: 0 }).essence, Math.floor(6 * 100 / 50));
  // 倍率與次數上限一起算：整體不超過「原費用 × 倍率 × 100」
  assert.equal(c.rerollCost({ rarity: 11, level: 50, rerollCount: 1e6 }).essence, 36 * 12 * 100);
});

test('R8（神鑄神話）再乘 1.4：金幣與精華同步，其他品質不受影響', () => {
  const c = loadContext();
  assert.equal(c.REROLL_RARITY_EXTRA.rarity, 8);
  assert.ok(Math.abs(c.rerollRarityMult(8) - 6 * 1.4) < 1e-9, 'R8 合計 6 × 1.4 ＝ 8.4 倍');
  [0, 5, 6, 7, 9, 10, 11].forEach((r) => assert.ok(Number.isInteger(c.rerollRarityMult(r)), 'R' + r + ' 不受 R8 加價影響'));
  // 關掉 R8 加價（mult=1）當對照：R8 的金幣與精華都是 1.4 倍，且為無條件捨去的整數
  const at = (level, count) => c.rerollCost({ rarity: 8, level, rerollCount: count });
  const withExtra = at(300, 0);
  c.REROLL_RARITY_EXTRA.mult = 1;
  const without = at(300, 0);
  assert.equal(withExtra.gold, Math.floor(without.gold * 1.4 + 1e-9));
  assert.equal(withExtra.essence, Math.floor(Math.floor(9 * 300 / 50) * 6 * 1.4 + 1e-9));
  assert.ok(Number.isInteger(withExtra.gold) && Number.isInteger(withExtra.essence));
});
