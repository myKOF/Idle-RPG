const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFormulaContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = { player: { level: 1 } };
  return context;
}

test('技能裝載欄初始 2 格、每 20 級增加 1 格、最高 20 格', () => {
  const context = loadFormulaContext();
  const expected = new Map([
    [1, 2], [19, 2], [20, 3], [21, 3], [40, 4], [359, 19], [360, 20], [9999, 20]
  ]);
  expected.forEach((cap, level) => {
    context.G.player.level = level;
    assert.equal(context.loadoutSize(), cap, 'Lv.' + level + ' 裝載欄上限');
  });
});

test('技能裝載欄參數表與套用管線描述初始欄位加成公式', () => {
  const root = path.resolve(__dirname, '..');
  const csv = fs.readFileSync(path.join(root, 'config/CSV/game_parameters.csv'), 'utf8');
  const apply = fs.readFileSync(path.join(root, 'tools/apply_params.cjs'), 'utf8');
  assert.match(csv, /clamp\(⌊等級\/a⌋\s*\+\s*b,\s*b,\s*c\)/);
  assert.match(apply, /2 \+ Math\.floor\(G\.player\.level \/ /);
});
