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
  /* 棋盤大小是參數表可調值（使用者已從 4×4 改成 10×10），置中座標必須由格數推導，
     寫死 2 只在 4×4 成立。BOSS 佔格同樣讀 BF_BOSS_W/H。 */
  assert.equal(boss.cell.col, c.bfCenteredOrigin(c.bfCols(), c.BF_BOSS_W));
  assert.equal(boss.cell.row, c.bfCenteredOrigin(c.bfRows(), c.BF_BOSS_H));
  assert.equal(boss.cell.w, c.BF_BOSS_W);
  assert.equal(boss.cell.h, c.BF_BOSS_H);
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
