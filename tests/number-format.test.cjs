const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadUtilContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math), isNaN };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/util.js'), 'utf8'), context, { filename: 'js/util.js' });
  return context;
}

/* 單位一律用大寫單字母（使用者裁決 2026-07-28）。
   先前這兩條測試期望小寫 k 與 Q/Qi/Sx/Sp/O/N/D/Ud 的英文數詞縮寫，
   那套帶小寫第二字母，與「一律大寫」的裁決衝突，已改為以程式現況為準。 */

test('fmt 簡寫固定顯示三位有效數字，不足補 0', () => {
  const context = loadUtilContext();

  assert.equal(context.fmt(999), '999');
  assert.equal(context.fmt(1000), '1.00K');
  assert.equal(context.fmt(1234), '1.23K');
  assert.equal(context.fmt(12000), '12.0K');
  assert.equal(context.fmt(12500), '12.5K');
  assert.equal(context.fmt(253000), '253K');
  assert.equal(context.fmt(999999), '999K');
  assert.equal(context.fmt(-1234), '-1.23K');
});

test('fmt 大數字單位序列為單一大寫字母 K/M/B/T/P/E/Z/Y/R/Q', () => {
  const context = loadUtilContext();

  assert.equal(context.fmt(1e6), '1.00M');
  assert.equal(context.fmt(1e9), '1.00B');
  assert.equal(context.fmt(1e12), '1.00T');
  assert.equal(context.fmt(1e15), '1.00P');
  assert.equal(context.fmt(1e18), '1.00E');
  assert.equal(context.fmt(1e21), '1.00Z');
  assert.equal(context.fmt(1e24), '1.00Y');
  assert.equal(context.fmt(1e27), '1.00R');
  assert.equal(context.fmt(1e30), '1.00Q');
});

/* ⚠️ 已知限制：單位表到 Q（1e30）就沒了，更大的數字退化成「Q 的倍數」，
   三位有效數字的規則失效且位數無上限：
     1e33 → 999Q      1e36 → 1000000Q      1e39 → 999999999Q
   若遊戲數值會摸到 1e33 以上，這裡需要補單位或改記號（待裁決）。
   本測試鎖住現況，避免這個行為在無人察覺的情況下再改變。 */
test('fmt 超過 1e30 後退化為 Q 的倍數（已知限制）', () => {
  const context = loadUtilContext();

  assert.equal(context.fmt(1e33), '999Q');
  assert.equal(context.fmt(1e36), '1000000Q');
});
