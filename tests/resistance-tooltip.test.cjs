const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function resistanceRow(context, label) {
  for (const group of context.STAT_GROUPS) {
    const row = group.rows.find((candidate) => candidate[0].includes(label));
    if (row) return row;
  }
  assert.fail(`找不到屬性列：${label}`);
}

test('抗性 tooltip 不顯示公式，並以黃字顯示目前總減傷至小數四位', () => {
  const context = loadContext();
  const st = {
    level: 10,
    pRes: 50,
    mRes: 60,
    resist: { fire: 70, ice: 0, lightning: 0, poison: 0, light: 0, dark: 0 }
  };
  const rows = ['物理抗性', '魔法抗性', '火焰抗性'].map((label) => resistanceRow(context, label));

  for (const row of rows) {
    const html = row[2](st);
    assert.match(html, /color:#ffd700/);
    assert.match(html, /目前總減傷：\d+\.\d{4}%/);
    assert.doesNotMatch(html, /抗性總合.*\^|敵人等級.*×/);
  }
});
