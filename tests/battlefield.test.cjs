const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBattlefield(randomSeq) {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  if (randomSeq) {
    let i = 0;
    context.Math.random = () => randomSeq[i++ % randomSeq.length];
  }
  return context;
}

function enemy(col, row, extra) {
  return Object.assign({ hp: 100, maxHp: 100, cell: { col, row, w: 1, h: 1 } }, extra || {});
}

/* 棋盤大小（BF_COLS/BF_ROWS）是參數表可調值——使用者把它從 4×4 改成 10×10 之後，
   任何寫死 4 的期望值都會誤報成測試失敗。期望值一律由常數推導。 */
test('距離表與規格一致：距離 = BF_DIST_PER_COL×(行-1) + (中央列 ? 中央 : 外側)', () => {
  const c = loadBattlefield();
  for (let row = 1; row <= c.BF_ROWS; row++) {
    for (let col = 1; col <= c.BF_COLS; col++) {
      const base = c.bfIsCenterRow(row) ? c.BF_DIST_CENTER_ROW : c.BF_DIST_OUTER_ROW;
      assert.equal(c.bfCellDistance(col, row), c.BF_DIST_PER_COL * (col - 1) + base, `c${col} r${row}`);
    }
  }
  // 越靠右越遠、中央列比外側列近：這兩條才是規格本身
  assert.ok(c.bfCellDistance(2, 1) > c.bfCellDistance(1, 1), '越往右應該越遠');
  const centerRow = Math.ceil(c.BF_ROWS / 2);
  assert.ok(c.bfIsCenterRow(centerRow), '正中間那一列應該算中央列');
  assert.ok(c.bfCellDistance(1, centerRow) <= c.bfCellDistance(1, 1), '中央列應該不比外側列遠');
});

test('BOSS 佔 2×2，距離取所佔格中最近的一格', () => {
  const c = loadBattlefield();
  const boss = enemy(2, 1, { isBoss: true, cell: { col: 2, row: 1, w: 2, h: 2 } });
  const cells = c.bfEntityCells(boss);
  assert.equal(cells.length, 4);
  const nearest = Math.min.apply(null, cells.map((cell) => c.bfCellDistance(cell.col, cell.row)));
  assert.equal(c.bfEntityDistance(boss), nearest);
});

test('配格不重疊、不出界，BOSS 佔滿 2×2', () => {
  const c = loadBattlefield();
  for (let round = 0; round < 200; round++) {
    const list = [{ hp: 1, isBoss: true }, { hp: 1 }, { hp: 1 }, { hp: 1 }];
    const placed = c.bfPlaceEnemies(list);
    assert.equal(placed.length, 4);
    const used = {};
    placed.forEach((e) => {
      const cells = c.bfEntityCells(e);
      assert.equal(cells.length, e.isBoss ? 4 : 1);
      cells.forEach((cell) => {
        assert.ok(cell.col >= 1 && cell.col <= c.BF_COLS && cell.row >= 1 && cell.row <= c.BF_ROWS, '格位出界');
        const key = cell.col + ',' + cell.row;
        assert.ok(!used[key], '格位重疊：' + key);
        used[key] = true;
      });
    });
  }
});

test('棋盤塞滿時多餘的敵人不會配到格（由呼叫端捨棄）', () => {
  const c = loadBattlefield();
  const cap = c.bfCellCount();
  const list = [];
  for (let i = 0; i < cap + 4; i++) list.push({ hp: 1 });
  const placed = c.bfPlaceEnemies(list);
  assert.equal(placed.length, cap);
});

test('BOSS 放不下 2×2 時退回 1×1，不會整隻消失', () => {
  const c = loadBattlefield();
  // 3×3 棋盤只容得下一個 2×2（任何落點都會蓋住正中央），第二個 BOSS 必然放不下
  c.BF_COLS = 3;
  c.BF_ROWS = 3;
  const first = { hp: 1, isBoss: true };
  const second = { hp: 1, isBoss: true };
  const placed = c.bfPlaceEnemies([first, second]);
  assert.equal(placed.length, 2, '兩隻都要配到格');
  const sizes = [c.bfEntityCells(first).length, c.bfEntityCells(second).length].sort();
  assert.deepEqual(sizes, [1, 4], '一隻維持 2×2、另一隻退回 1×1');
});

test('普攻選最近的敵人；同距離時隨機挑一個', () => {
  const c = loadBattlefield();
  const near1 = enemy(1, 2);
  const near2 = enemy(1, 3);
  const far = enemy(4, 1);
  const picked = {};
  for (let i = 0; i < 300; i++) picked[c.bfPickPrimary([far, near1, near2], null) === near1 ? 'a' : 'b'] = true;
  assert.ok(picked.a && picked.b, '同距離的兩隻都要有機會被選到');
  for (let i = 0; i < 50; i++) {
    assert.notEqual(c.bfPickPrimary([far, near1, near2], null), far, '不該選到較遠的敵人');
  }
});

test('鎖定的目標只要還活著就不換，死亡後才重新選', () => {
  const c = loadBattlefield();
  const locked = enemy(4, 1);   // 刻意鎖最遠的那隻
  const nearer = enemy(1, 2);
  const pool = [nearer, locked];
  assert.equal(c.bfPickPrimary(pool, locked), locked, '鎖定中不該改打更近的敵人');
  locked.hp = 0;
  assert.equal(c.bfPickPrimary(pool, locked), nearer, '目標死亡後改打最近的敵人');
});

test('傷害範圍設定字串解析：A*B ＝ 直向 A 格 × 橫向 B 格', () => {
  const c = loadBattlefield();
  // vm 內建立的物件與本測試不同 realm，deepEqual 會因原型不同而失敗——逐欄比對
  const shapeOf = (raw) => { const s = c.bfParseShape(raw); return s.kind + ':' + s.h + 'x' + s.w; };
  assert.equal(shapeOf(''), 'single:1x1');
  assert.equal(shapeOf(undefined), 'single:1x1');
  assert.equal(shapeOf('1x1'), 'single:1x1');
  assert.equal(shapeOf('2x2'), 'box:2x2');
  assert.equal(shapeOf('3*3'), 'box:3x3');
  assert.equal(shapeOf('1*3'), 'box:1x3', '直向1、橫向3＝往前貫穿的直線');
  assert.equal(shapeOf('3*1'), 'box:3x1', '直向3、橫向1＝擋在面前的橫牆');
  assert.equal(shapeOf('all'), 'all:0x0');
  assert.equal(shapeOf('全體'), 'all:0x0');
});

test('1*3 由左往右貫穿：打到同一直向位置的整排，不碰其他直向位置', () => {
  const c = loadBattlefield();
  const near = enemy(1, 2);
  const mid = enemy(2, 2);
  const farSameRow = enemy(3, 2);
  const otherRow = enemy(2, 3);
  const hit = c.bfAreaTargets(near, [near, mid, farSameRow, otherRow], '1*3');
  assert.ok(hit.indexOf(near) >= 0);
  assert.ok(hit.indexOf(mid) >= 0);
  assert.ok(hit.indexOf(farSameRow) >= 0);
  assert.ok(hit.indexOf(otherRow) < 0, '貫穿線不該打到別的直向位置');
});

test('3*1 是一道橫牆：打到同一橫向位置的整列', () => {
  const c = loadBattlefield();
  const a = enemy(1, 1);
  const b = enemy(1, 2);
  const cc = enemy(1, 3);
  const behind = enemy(2, 2);
  const hit = c.bfAreaTargets(b, [a, b, cc, behind], '3*1');
  assert.ok(hit.indexOf(a) >= 0);
  assert.ok(hit.indexOf(b) >= 0);
  assert.ok(hit.indexOf(cc) >= 0);
  assert.ok(hit.indexOf(behind) < 0, '橫牆不該打到後面那一行');
});

test('範圍展開：單體只回主目標，all 回全場', () => {
  const c = loadBattlefield();
  const a = enemy(1, 2), b = enemy(2, 2), dead = enemy(3, 3, { hp: 0 });
  const single = c.bfAreaTargets(a, [a, b], 'single');
  assert.equal(single.length, 1);
  assert.equal(single[0], a);
  const all = c.bfAreaTargets(a, [a, b, dead], 'all');
  assert.equal(all.length, 2, '死亡敵人不計入');
});

test('範圍展開：方框取命中最多的落點，佔多格的 BOSS 只算一次', () => {
  const c = loadBattlefield();
  const primary = enemy(1, 2);
  const near = enemy(2, 2);
  const boss = enemy(2, 3, { isBoss: true, cell: { col: 2, row: 3, w: 2, h: 2 } });
  const far = enemy(4, 1);
  const hit = c.bfAreaTargets(primary, [primary, near, boss, far], '3x3');
  assert.ok(hit.indexOf(primary) >= 0, '一定要蓋住主目標');
  assert.ok(hit.indexOf(far) < 0, '方框外的敵人不該被命中');
  assert.equal(hit.filter((e) => e === boss).length, 1, 'BOSS 佔多格仍只算命中 1 次');
});

test('未配格的敵人視為最遠，不會插隊搶走普攻目標', () => {
  const c = loadBattlefield();
  const noCell = { hp: 100, maxHp: 100 };
  const placed = enemy(4, 1);
  assert.equal(c.bfEntityDistance(noCell), Infinity);
  assert.equal(c.bfPickPrimary([noCell, placed], null), placed);
});

test('野外 BOSS 階段：每 50 階一次，且優先於菁英', () => {
  const c = loadBattlefield();
  assert.equal(c.isFieldBossStage(50), true);
  assert.equal(c.isFieldBossStage(100), true);
  assert.equal(c.isFieldBossStage(40), false);
  assert.equal(c.isFieldBossStage(0), false);
  // 第 50 階同時符合菁英規則，BOSS 數值必須蓋過菁英
  assert.equal(c.isEliteStage(50), true);
  const boss = c.monsterStatsFor(50, true, true);
  const elite = c.monsterStatsFor(50, true, false);
  assert.equal(boss.isBoss, true);
  assert.equal(boss.elite, false);
  assert.ok(boss.hp > elite.hp);
  assert.equal(boss.aspd, c.FIELD_BOSS_ASPD);
});

test('敵人數量不超過棋盤格數（三種敵種都一樣）', () => {
  const c = loadBattlefield();
  c.Math.random = Math.random;
  ['normal', 'elite', 'boss'].forEach((rank) => {
    for (let i = 0; i < 1500; i++) {
      const n = c.rollFieldEnemyCount(rank);
      assert.ok(n >= 1 && n <= c.bfCellCount(), rank + ' 抽到 ' + n + '，超出棋盤格數');
    }
  });
});
