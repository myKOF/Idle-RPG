/* BOSS 的站位（js/battlefield.js）

   2026-08-12 座標制改版前，戰場是格子，單獨出現的 BOSS 會被特別安排到棋盤正中央的
   2×2，其餘小怪再填周圍——那是格子時代才需要的特例（不搶佔正中間就會被切碎）。

   改成連續座標後這個特例消失了：所有敵人一律生在生成圓上、朝我方逼近，
   BOSS 與其他人的差別只剩「體型較大」，而體型會由逼近時的互斥推擠自動處理。
   這支測試改成鎖住座標制真正該成立的性質。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBattlefield() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function enemy(extra) {
  return Object.assign({ hp: 100, maxHp: 100 }, extra || {});
}

test('BOSS 與小怪一樣生在生成圓上（座標制沒有「正中央 2×2」的特例）', () => {
  const c = loadBattlefield();
  const boss = enemy({ isBoss: true });
  const normal = enemy();

  const placed = c.bfPlaceEnemies([normal, boss]);

  assert.equal(placed.length, 2);
  [boss, normal].forEach((e) => {
    assert.ok(e.pos && isFinite(e.pos.x), '每一隻都要拿到座標');
    const d = Math.sqrt(e.pos.x * e.pos.x + e.pos.y * e.pos.y);
    assert.ok(Math.abs(d - c.BF_SPAWN_DIST) <= c.BF_SPAWN_DIST * 0.1,
      '生成距離應落在 BF_SPAWN_DIST 附近，實際 ' + Math.round(d));
  });
});

test('BOSS 體型較大：停得比小怪遠，邊緣卻更早進入攻擊距離', () => {
  const c = loadBattlefield();
  const boss = enemy({ isBoss: true, pos: { x: 300, y: 0 } });
  const mob = enemy({ pos: { x: 300, y: 0 } });

  assert.ok(c.bfEntityRadius(boss) > c.bfEntityRadius(mob), 'BOSS 體型要比較大');
  assert.ok(c.bfStopDistance(boss) > c.bfStopDistance(mob), '體型大的停得遠一點');
  assert.ok(c.bfEntityDistance(boss) < c.bfEntityDistance(mob), '但邊緣距離較短＝更早碰到我方');
});

test('逼近之後 BOSS 不會與其他敵人重疊', () => {
  const c = loadBattlefield();
  const boss = enemy({ isBoss: true, pos: { x: 200, y: 0 } });
  const a = enemy({ pos: { x: 205, y: 5 } });
  const b = enemy({ pos: { x: 195, y: -5 } });
  const all = [boss, a, b];

  for (let i = 0; i < 120; i++) c.bfTickApproach(all, 0.05);

  [a, b].forEach((e, i) => {
    const dx = e.pos.x - boss.pos.x, dy = e.pos.y - boss.pos.y;
    const gap = Math.sqrt(dx * dx + dy * dy);
    assert.ok(gap >= c.bfEntityRadius(boss) + c.bfEntityRadius(e) - 1,
      '第 ' + i + ' 隻與 BOSS 重疊了（間距 ' + gap.toFixed(1) + '）');
  });
});
