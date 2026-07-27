'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const item = fs.readFileSync(path.join(root, 'js', 'item.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

function functionBody(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail('unterminated function ' + name);
}

test('getItemAncientCount 的唯一模擬層實作位於 item.js', () => {
  assert.match(item, /function getItemAncientCount\(it\)/);
  assert.doesNotMatch(ui, /function getItemAncientCount\(it\)/);
});

test('getItemAncientCount 優先讀投影 ancientCount，完整物件則計算太古詞綴', () => {
  const context = {};
  vm.runInNewContext(functionBody(item, 'getItemAncientCount'), context);

  assert.equal(context.getItemAncientCount({ ancientCount: 2.9, affixes: [] }), 2);
  assert.equal(context.getItemAncientCount({ ancientCount: -4, affixes: [] }), 0);
  assert.equal(context.getItemAncientCount({
    affixes: [{ ancient: true }, null, { ancient: false }, { ancient: true }]
  }), 2);
  assert.equal(context.getItemAncientCount(null), 0);
});
