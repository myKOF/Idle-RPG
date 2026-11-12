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
