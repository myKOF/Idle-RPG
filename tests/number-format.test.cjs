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

test('fmt 簡寫固定顯示三位有效數字，不足補 0', () => {
  const context = loadUtilContext();

  assert.equal(context.fmt(999), '999');
  assert.equal(context.fmt(1000), '1.00k');
  assert.equal(context.fmt(1234), '1.23k');
  assert.equal(context.fmt(12000), '12.0k');
  assert.equal(context.fmt(12500), '12.5k');
  assert.equal(context.fmt(253000), '253k');
  assert.equal(context.fmt(999999), '999k');
  assert.equal(context.fmt(-1234), '-1.23k');
});

test('fmt 支援 Q 以上的新簡寫單位序列', () => {
  const context = loadUtilContext();

  assert.equal(context.fmt(1e15), '1.00Q');
  assert.equal(context.fmt(1e18), '1.00Qi');
  assert.equal(context.fmt(1e21), '1.00Sx');
  assert.equal(context.fmt(1e24), '1.00Sp');
  assert.equal(context.fmt(1e27), '1.00O');
  assert.equal(context.fmt(1e30), '1.00N');
  assert.equal(context.fmt(1e33), '1.00D');
  assert.equal(context.fmt(1e36), '1.00Ud');
});
