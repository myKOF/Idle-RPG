const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    UI: { dirty: {} },
    G: { player: { gold: 0, gems: { ruby: { 1: 1000 }, opal: { 1: 0 } } } }
  };
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = { player: { gold: 0, gems: { ruby: { 1: 1000 }, opal: { 1: 0 } } } };
  return context;
}

test('寶石九宮格每格上限為 1000 顆', () => {
  const context = loadContext();
  assert.equal(context.GEM_CONVERT_STACK, 1000);
  assert.equal(context.convertGems([{ type: 'ruby', lv: 1, n: 1000 }], 'opal'), null);
  assert.equal(context.G.player.gems.ruby[1], 0);
  assert.equal(context.G.player.gems.opal[1], 500);
  assert.match(context.convertGems([{ type: 'ruby', lv: 1, n: 1001 }], 'opal'), /每格 1~1000 顆/);
});

test('同階跨種類湊組、各階分開計算，奇數餘數與金幣保留', () => {
  const c = loadContext();
  c.G.player.gold = 12345;
  c.G.player.gems = { ruby: { 1: 3, 2: 1, 10: 3 }, sapphire: { 1: 2, 2: 1 }, opal: { 1: 4 } };
  const slots = [{ type: 'ruby', lv: 1, n: 3 }, { type: 'sapphire', lv: 1, n: 2 }, { type: 'ruby', lv: 2, n: 1 }, { type: 'sapphire', lv: 2, n: 1 }, { type: 'ruby', lv: 10, n: 3 }];
  const before = JSON.stringify(slots);
  const plan = c.gemConvertPlan(slots);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.outputs)), { 1: 2, 2: 1, 10: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(plan.remaining)), [{ type: 'sapphire', lv: 1, n: 1 }, { type: 'ruby', lv: 10, n: 1 }]);
  assert.equal(c.convertGems(slots, 'opal'), null);
  assert.equal(JSON.stringify(slots), before);
  assert.equal(c.G.player.gems.ruby[1], 0);
  assert.equal(c.G.player.gems.sapphire[1], 1);
  assert.equal(c.G.player.gems.ruby[2], 0);
  assert.equal(c.G.player.gems.sapphire[2], 0);
  assert.equal(c.G.player.gems.ruby[10], 1);
  assert.equal(c.G.player.gems.opal[1], 6);
  assert.equal(c.G.player.gems.opal[2], 1);
  assert.equal(c.G.player.gems.opal[10], 1);
  assert.equal(c.G.player.gold, 12345);
});

test('不足同階兩顆、非法階級／數量／種類／目標、超額合計庫存均原子拒絕', () => {
  const c = loadContext();
  const invalid = [
    [{ type: 'ruby', lv: 1, n: 1 }],
    [{ type: 'ruby', lv: 1, n: 1 }, { type: 'ruby', lv: 2, n: 1 }],
    [{ type: 'ruby', lv: 1, n: 600 }, { type: 'ruby', lv: 1, n: 600 }],
    ...[0, 11, 1.5, NaN, '1'].map(lv => [{ type: 'ruby', lv, n: 2 }]),
    ...[0, -1, 1.5, NaN, Infinity, '2', 1001].map(n => [{ type: 'ruby', lv: 1, n }]),
    [{ type: '__proto__', lv: 1, n: 2 }], null, [], [null], Array(10).fill({ type: 'ruby', lv: 1, n: 2 })
  ];
  for (const slots of invalid) {
    const before = JSON.stringify(c.G);
    assert.equal(typeof c.convertGems(slots, 'opal'), 'string');
    assert.equal(JSON.stringify(c.G), before);
  }
  for (const target of ['__proto__', 'constructor', 'missing']) {
    const before = JSON.stringify(c.G);
    assert.equal(typeof c.convertGems([{ type: 'ruby', lv: 1, n: 2 }], target), 'string');
    assert.equal(JSON.stringify(c.G), before);
  }
});

test('重複合法槽按整體2換1且同目標種類不會增生；正式Worker命令亦依新比例', () => {
  const c = loadContext();
  assert.equal(c.convertGems([{ type: 'ruby', lv: 1, n: 3 }, { type: 'ruby', lv: 1, n: 2 }], 'ruby'), null);
  assert.equal(c.G.player.gems.ruby[1], 998); // 扣4加2，原庫存1000
  const { createEngine } = require('../scripts/sim/engine.js');
  const e = createEngine({ seed: 18 });
  e.boot();
  const g = e.state();
  g.player.gems.ruby = { 1: 3, 2: 1 };
  g.player.gems.sapphire = { 1: 2, 2: 1 };
  g.player.gems.opal = { 1: 0, 2: 0 };
  e.cmd('gem.convert', { slots: [{ type: 'ruby', lv: 1, n: 3 }, { type: 'sapphire', lv: 1, n: 2 }, { type: 'ruby', lv: 2, n: 1 }, { type: 'sapphire', lv: 2, n: 1 }], targetType: 'opal' });
  assert.equal(g.player.gems.opal[1], 2);
  assert.equal(g.player.gems.opal[2], 1);
  assert.equal(g.player.gems.sapphire[1], 1);
});
