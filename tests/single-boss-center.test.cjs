const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadBattlefield() {
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  for (const file of ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  context.Math.random = () => 0;
  return context;
}

function enemy(extra) {
  return Object.assign({ hp: 100, maxHp: 100 }, extra || {});
}

test('single outdoor boss is placed at the battlefield center', () => {
  const c = loadBattlefield();
  const boss = enemy({ isBoss: true });
  const normal = enemy();

  const placed = c.bfPlaceEnemies([normal, boss]);

  assert.equal(placed.length, 2);
  assert.equal(boss.cell.col, 2);
  assert.equal(boss.cell.row, 2);
  assert.equal(boss.cell.w, 2);
  assert.equal(boss.cell.h, 2);
  const occupied = new Set(c.bfEntityCells(boss).map((cell) => cell.col + ',' + cell.row));
  for (const cell of c.bfEntityCells(normal)) {
    assert.equal(occupied.has(cell.col + ',' + cell.row), false);
  }
});

test('multiple bosses do not use the single-boss center exception', () => {
  const c = loadBattlefield();
  const first = enemy({ isBoss: true });
  const second = enemy({ isBoss: true });

  c.bfPlaceEnemies([first, second]);

  assert.ok(first.cell.col !== 2 || first.cell.row !== 2,
    '多名 BOSS 不套用單一 BOSS 的中央位置');
});
