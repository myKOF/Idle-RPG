/* 戰場座標（js/battlefield.js）
   2026-08-12 改造：格子 → 連續座標。我方永遠在原點，敵人帶 pos={x,y}，
   每個 tick 朝我方逼近，走到接觸距離才停、才打得到人。

   這裡鎖住的是「規則」而不是某組數字：距離怎麼算、誰會被選成目標、
   打不打得到、範圍技涵蓋誰、逼近會不會收斂。常數一律從 context 讀，
   參數調整不該讓這些測試誤報。 */
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

function at(x, y, extra) {
  return Object.assign({ hp: 100, maxHp: 100, pos: { x, y } }, extra || {});
}

/* ---- 距離 ---- */

test('距離＝到原點的直線距離扣掉體型；越近數字越小', () => {
  const c = loadBattlefield();
  const near = at(100, 0);
  const far = at(300, 0);
  assert.equal(c.bfEntityDistance(near), 100 - c.BF_BODY_RADIUS);
  assert.equal(c.bfEntityDistance(far), 300 - c.BF_BODY_RADIUS);
  assert.ok(c.bfEntityDistance(near) < c.bfEntityDistance(far));
  // 方向不影響距離：四面八方等距的敵人一樣近
  const d = c.bfEntityDistance(at(0, 100));
  assert.equal(Math.round(d), Math.round(c.bfEntityDistance(at(100, 0))));
  assert.equal(Math.round(c.bfEntityDistance(at(70.71, 70.71))), Math.round(d));
});

test('BOSS 體型較大，同樣的中心距離下牠比較近（邊緣先碰到我方）', () => {
  const c = loadBattlefield();
  const mob = at(200, 0);
  const boss = at(200, 0, { isBoss: true });
  assert.ok(c.BF_BOSS_RADIUS > c.BF_BODY_RADIUS);
  assert.ok(c.bfEntityDistance(boss) < c.bfEntityDistance(mob));
});

test('沒有座標的實體視為最遠，不會插隊搶走普攻目標', () => {
  const c = loadBattlefield();
  const ghost = { hp: 100, maxHp: 100 };          // 例如高塔 BOSS，走另一條路徑
  const real = at(400, 0);
  assert.equal(c.bfEntityDistance(ghost), Infinity);
  assert.equal(c.bfPickPrimary([ghost, real], null), real);
});

/* ---- 攻擊距離（座標制新增；改造前完全不存在）---- */

test('走到近戰距離內才打得到；遠處的敵人打不到人', () => {
  const c = loadBattlefield();
  const close = at(c.BF_MELEE_RANGE + c.BF_BODY_RADIUS - 5, 0);
  const away = at(c.BF_MELEE_RANGE + c.BF_BODY_RADIUS + 60, 0);
  assert.equal(c.bfInAttackRange(close), true);
  assert.equal(c.bfInAttackRange(away), false);
  assert.equal(c.bfPlayerCanReach(close), true);
  assert.equal(c.bfPlayerCanReach(away), false);
});

test('魔法系敵人是遠程：同樣的距離，物理打不到、魔法打得到', () => {
  const c = loadBattlefield();
  const d = (c.BF_MELEE_RANGE + c.BF_RANGED_RANGE) / 2 + c.BF_BODY_RADIUS;
  assert.ok(c.BF_RANGED_RANGE > c.BF_MELEE_RANGE);
  assert.equal(c.bfInAttackRange(at(d, 0)), false);
  assert.equal(c.bfInAttackRange(at(d, 0, { magic: true })), true);
});

test('沒有座標時不擋攻擊（高塔沿用舊行為）', () => {
  const c = loadBattlefield();
  assert.equal(c.bfInAttackRange({ hp: 100 }), true);
  assert.equal(c.bfPlayerCanReach({ hp: 100 }), true);
});

/* ---- 生成與容量 ---- */

test('生成站位落在生成半徑上，且彼此不重疊', () => {
  const c = loadBattlefield();
  const list = [];
  for (let i = 0; i < 8; i++) list.push({ hp: 1 });
  const placed = c.bfPlaceEnemies(list);
  assert.equal(placed.length, 8);
  placed.forEach((e) => {
    const d = Math.sqrt(e.pos.x * e.pos.x + e.pos.y * e.pos.y);
    assert.ok(Math.abs(d - c.BF_SPAWN_DIST) <= c.BF_SPAWN_DIST * 0.1,
      '生成距離 ' + Math.round(d) + ' 應落在 BF_SPAWN_DIST 附近');
  });
});

test('補波時把既有敵人算進容量，超過上限的不會生出來', () => {
  const c = loadBattlefield();
  const cap = c.bfCellCount();
  const standing = [];
  for (let i = 0; i < cap; i++) standing.push(at(300, i));
  assert.equal(c.bfFreeCellCount(standing), 0);
  const more = [{ hp: 1 }, { hp: 1 }];
  assert.equal(c.bfPlaceEnemies(more, standing).length, 0, '滿場時不得再生');
  assert.equal(c.bfPlaceEnemies(more, standing.slice(0, cap - 1)).length, 1, '只剩一個名額就只生一隻');
});

/* ---- 逼近與推擠 ---- */

test('每個 tick 朝我方逼近，走到接觸距離就停住不再前進', () => {
  const c = loadBattlefield();
  const e = at(400, 0);
  const stop = c.BF_CONTACT_DIST + c.BF_BODY_RADIUS;
  for (let i = 0; i < 200; i++) c.bfTickApproach([e], 0.1);
  const d = Math.sqrt(e.pos.x * e.pos.x + e.pos.y * e.pos.y);
  assert.ok(Math.abs(d - stop) < 1, '應該停在接觸距離 ' + stop + '，實際 ' + d.toFixed(1));
  // 停住之後不會再往前（不會穿過我方）
  c.bfTickApproach([e], 0.1);
  assert.ok(Math.sqrt(e.pos.x * e.pos.x + e.pos.y * e.pos.y) >= stop - 0.5);
});

test('逼近速度符合 BF_ENEMY_SPEED', () => {
  const c = loadBattlefield();
  const e = at(400, 0);
  c.bfTickApproach([e], 1);
  assert.equal(Math.round(e.pos.x), 400 - c.BF_ENEMY_SPEED);
});

test('進場中的敵人不參與逼近（還沒進畫面）', () => {
  const c = loadBattlefield();
  const e = at(400, 0, { _enterCd: 0.3 });
  c.bfTickApproach([e], 1);
  assert.equal(e.pos.x, 400);
});

test('同伴互相推開，不會疊在同一點', () => {
  const c = loadBattlefield();
  const a = at(100, 0);
  const b = at(102, 0);
  for (let i = 0; i < 40; i++) c.bfTickApproach([a, b], 0.05);
  const dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y;
  const gap = Math.sqrt(dx * dx + dy * dy);
  assert.ok(gap >= c.BF_BODY_RADIUS * 2 - 1, '兩隻應被推開到體型不重疊，實際間距 ' + gap.toFixed(1));
});

/* ---- 選敵 ---- */

test('普攻選最近的敵人；鎖定後直到目標死亡才換', () => {
  const c = loadBattlefield();
  const near = at(80, 0);
  const far = at(300, 0);
  assert.equal(c.bfPickPrimary([near, far], null), near);
  // 鎖定遠的那隻：只要還活著就不換
  assert.equal(c.bfPickPrimary([near, far], far), far);
  far.hp = 0;
  assert.equal(c.bfPickPrimary([near, far], far), near);
});

test('同距離時隨機挑一個（不是永遠挑同一隻）', () => {
  const c = loadBattlefield();
  const a = at(100, 0), b = at(-100, 0);
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(c.bfPickPrimary([a, b], null));
  assert.equal(seen.size, 2, '同距離應該兩隻都有機會被選到');
});

test('連鎖由近而遠往外擴散，不會原地打同一隻', () => {
  const c = loadBattlefield();
  const a = at(60, 0), b = at(90, 0), d = at(400, 0);
  const order = c.bfChainOrder(a, [a, b, d], 3);
  assert.equal(order.length, 3);
  assert.equal(order[0], a, '第一跳打在起點身上');
  assert.equal(order[1], b, '第二跳跳到最近的鄰居');
  assert.equal(order[2], d);
});

/* ---- 範圍 ---- */

test('範圍設定值解析沿用既有寫法（資料表不必改）', () => {
  const c = loadBattlefield();
  assert.equal(c.bfParseShape('').kind, 'single');
  assert.equal(c.bfParseShape('single').kind, 'single');
  assert.equal(c.bfParseShape('all').kind, 'all');
  const box = c.bfParseShape('3*3');
  assert.equal(box.kind, 'box');
  assert.equal(box.n, 3);
  assert.equal(c.bfParseShape('1*3').n, 3);
  assert.equal(c.bfParseShape(2).n, 2);
});

test('n×n 換算成半徑：越大的範圍打到越遠的敵人', () => {
  const c = loadBattlefield();
  const r2 = c.bfShapeRadius(c.bfParseShape('2*2'));
  const r3 = c.bfShapeRadius(c.bfParseShape('3*3'));
  assert.ok(r3 > r2 && r2 > 0);
  assert.equal(r3, 3 * c.BF_UNIT / 2);
});

test('範圍以主目標為圓心展開：圈內的打到、圈外的打不到', () => {
  const c = loadBattlefield();
  const primary = at(200, 0);
  const inside = at(200 + c.BF_UNIT, 0);          // 距圓心一個身位，3*3（半徑1.5身位）打得到
  const outside = at(200 + c.BF_UNIT * 4, 0);
  const res = c.bfAreaPlacement(primary, [primary, inside, outside], '3*3');
  assert.ok(res.area && res.area.r > 0);
  assert.equal(res.area.x, 200);
  assert.ok(res.targets.indexOf(primary) >= 0);
  assert.ok(res.targets.indexOf(inside) >= 0, '圈內的敵人應該被打到');
  assert.equal(res.targets.indexOf(outside), -1, '圈外的敵人不該被打到');
});

test('單體不產生區域；全體打到所有存活敵人', () => {
  const c = loadBattlefield();
  const a = at(100, 0), b = at(500, 200), dead = at(150, 0, { hp: 0 });
  const single = c.bfAreaPlacement(a, [a, b], 'single');
  assert.equal(single.area, null);
  assert.deepEqual(single.targets.length, 1);
  const all = c.bfAreaPlacement(a, [a, b, dead], 'all');
  assert.equal(all.targets.length, 2, '死掉的不算');
});

test('領域記住的是圓，之後每跳重問誰站在裡面', () => {
  const c = loadBattlefield();
  const area = { x: 0, y: 0, r: 100 };
  const inside = at(50, 0);
  const outside = at(400, 0);
  assert.equal(c.bfEntityInArea(inside, area), true);
  assert.equal(c.bfEntityInArea(outside, area), false);
  // 走進來就算數（領域是打在地上的一塊區域）
  outside.pos.x = 60;
  assert.equal(c.bfEntityInArea(outside, area), true);
  assert.equal(c.bfEntityInArea(inside, null), true, 'area 為 null＝不設限');
});

/* ---- 投射物飛行時間 ---- */

test('投射物飛行時間隨距離增加，並夾在上下限之間', () => {
  const c = loadBattlefield();
  const near = c.bfTravelSeconds(at(60, 0));
  const mid = c.bfTravelSeconds(at(400, 0));
  assert.ok(near <= mid);
  assert.ok(near >= c.VFX_TRAVEL_MIN_SEC - 1e-9);
  assert.ok(mid <= c.VFX_TRAVEL_MAX_SEC + 1e-9);
  assert.ok(c.bfTravelSeconds(at(99999, 0)) <= c.VFX_TRAVEL_MAX_SEC + 1e-9);
});
