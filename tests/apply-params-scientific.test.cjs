'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

test('所有具名數值錨點皆捕獲完整科學記號，且不吞掉後方運算', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(root, 'tools/apply_params.cjs'), 'utf8');
  const context = { edits: [], P: () => '3e-8', esc: s => s };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('const NUMBER_SOURCE'), source.indexOf('/* ---- 已移除：inline')), context);
  for (const value of ['1.0000000000000001E-5', '-2.5e+3', '.25E-2', '8E3', '0.001', '42']) {
    for (const helper of ['scalarValue', 'scalarOrList', 'objField', 'objFieldML', 'objFieldMLValue']) {
      context.edits.length = 0;
      const scalar = helper.startsWith('scalar');
      if (scalar) context[helper]('data', 'VALUE', '3e-8', 'row', 0);
      else context[helper]('data', 'OBJECT', 'value', '3e-8', 'row', 0);
      const text = scalar ? 'var VALUE = ' + value + ' * 2;' : 'var OBJECT = { value: ' + value + ' * 2 };';
      const edit = context.edits[0];
      const match = edit.re.exec(text);
      assert.equal(match[edit.grp], value, helper + ': ' + value);
    }
  }
});

test('科學記號完整替換且重複套用不殘留指數（隔離副本）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'params-scientific-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tools'));
    fs.cpSync(path.join(root, 'config/CSV'), path.join(tmp, 'config/CSV'), { recursive: true });
    fs.cpSync(path.join(root, 'js'), path.join(tmp, 'js'), { recursive: true });
    fs.copyFileSync(path.join(root, 'tools/apply_params.cjs'), path.join(tmp, 'tools/apply_params.cjs'));
    const target = path.join(tmp, 'js/data.js');
    const run = (...args) => execFileSync(process.execPath, ['tools/apply_params.cjs', ...args], { cwd: tmp, encoding: 'utf8' });
    for (const value of ['1.0000000000000001E-5', '-2.5e+3', '.25E-2', '8E3']) {
      fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace(/(agiCritRate:\s*)[^,\n]+/, '$1' + value));
      run('--write');
      execFileSync(process.execPath, ['--check', target]);
      const before = fs.readFileSync(target);
      assert.match(run(), /將變更 0、錨點問題 0/);
      run('--write');
      assert.deepEqual(fs.readFileSync(target), before, '第二次套用不應改寫相同數值');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
