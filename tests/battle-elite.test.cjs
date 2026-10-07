'use strict';
/* battle-elite.test.cjs — 菁英的畫面標記（js/battle-elite.js）。用一份假的 PIXI 驗：
   群組環、詞條圖示列、狀態光環、生命鏈結連線。畫得對不對靠實機，這裡驗「該畫的有畫、不該畫的沒畫、資料缺了不炸」。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

class Point { constructor() { this.x = 0; this.y = 0; } set(a, b) { this.x = a; this.y = b === undefined ? a : b; } }
class Container {
  constructor() { this.children = []; this.parent = null; this.x = 0; this.y = 0; this.alpha = 1; this.visible = true; this.scale = new Point(); this.scale.x = 1; this.scale.y = 1; }
  addChild(c) { this.children.push(c); c.parent = this; return c; }
  addChildAt(c, i) { this.children.splice(i, 0, c); c.parent = this; return c; }
  destroy() { this.destroyed = true; }
}
class Graphics extends Container {
  constructor() { super(); this.ops = []; }
  clear() { this.ops = []; return this; }
  ellipse() { this.ops.push('ellipse'); return this; }
  moveTo() { this.ops.push('moveTo'); return this; }
  lineTo() { this.ops.push('lineTo'); return this; }
  stroke(o) { this.ops.push('stroke:' + (o && o.color)); return this; }
  fill() { this.ops.push('fill'); return this; }
}
class Text extends Container {
  constructor(o) { super(); this.text = o && o.text; this.anchor = new Point(); }
}

function env() {
  const ctx = { console, PIXI: { Container, Graphics, Text }, module: { exports: {} } };
  vm.createContext(ctx);
  ['js/data.js', 'js/elite_data.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
  vm.runInContext(fs.readFileSync(path.join(root, 'js/battle-elite.js'), 'utf8'), ctx, { filename: 'js/battle-elite.js' });
  return ctx;
}
function ent(id, data) {
  return { id, data, state: 'idle', root: new Container(), view: new Container(), body: { scale: { x: 1, y: 1 } }, visScale: 1.28 };
}

test('BATTLE-ELITE-1 菁英：群組環、詞條圖示列；小兵：只有群組環；普通怪完全不碰', () => {
  const c = env();
  const layer = new Container();
  const be = vm.runInContext('BattleElite', c).create({ PIXI: c.PIXI, layer });
  const elite = ent('a', { elite: true, hp: 10, _gid: 3, affixes: ['meteor', 'lifelink'], _elColor: '#ff8a3d', _fx: [] });
  const minion = ent('b', { elite: false, hp: 10, _gid: 3 });
  const plain = ent('c', { elite: false, hp: 10 });
  be.update({ a: elite, b: minion, c: plain }, 0.016, 1000);
  assert.ok(elite.eliteDeco && elite.eliteDeco.badge, '菁英有詞條列');
  assert.equal(elite.eliteDeco.badge.text, c.ELITE_AFFIXES.meteor.emoji + c.ELITE_AFFIXES.lifelink.emoji);
  assert.ok(elite.eliteDeco.ring.ops.length > 0, '畫了群組環');
  assert.ok(minion.eliteDeco && !minion.eliteDeco.badge, '小兵沒有詞條列');
  assert.ok(minion.eliteDeco.ring.ops.length > 0, '小兵有群組環（看得出誰跟誰一夥）');
  assert.equal(plain.eliteDeco, undefined, '普通怪不裝飾');
  // 同一群同一個顏色
  const groupStroke = (e) => e.eliteDeco.ring.ops.filter((o) => o.indexOf('stroke:') === 0).pop();
  assert.equal(groupStroke(elite), groupStroke(minion), '同群環色相同（最後一圈是群組色）');
});

test('BATTLE-ELITE-2 狀態旗標：無敵／護盾／反射／狂暴各有圖示與光環，消失時光環關掉', () => {
  const c = env();
  const be = vm.runInContext('BattleElite', c).create({ PIXI: c.PIXI, layer: new Container() });
  const e = ent('a', { elite: true, hp: 10, _gid: 1, affixes: ['shield'], _fx: ['invuln', 'shield'] });
  be.update({ a: e }, 0.016, 1000);
  assert.equal(e.eliteDeco.state.text, '🔰🛡️');
  assert.equal(e.eliteDeco.stateRing.visible, true);
  e.data._fx = [];
  be.update({ a: e }, 0.016, 1100);
  assert.equal(e.eliteDeco.state.text, '');
  assert.equal(e.eliteDeco.stateRing.visible, false);
});

test('BATTLE-ELITE-3 生命鏈結：同群帶鏈結的活成員兩兩連線；死的不連；ELITE_GROUP.linkBeam=0 不畫', () => {
  const c = env();
  const BE = vm.runInContext('BattleElite', c);
  const layer = new Container();
  const be = BE.create({ PIXI: c.PIXI, layer });
  const link = layer.children[0];
  const mk = (id, gid, hp) => ent(id, { elite: true, hp, _gid: gid, affixes: ['lifelink'] });
  const set = { a: mk('a', 1, 5), b: mk('b', 1, 5), c: mk('c', 1, 5), d: mk('d', 2, 5) };
  be.update(set, 0.016, 1000);
  assert.equal(link.ops.filter((o) => o === 'moveTo').length, 3 * 2, '3 隻兩兩連線＝3 條，每條畫兩層');
  set.c.data.hp = 0;
  be.update(set, 0.016, 1100);
  assert.equal(link.ops.filter((o) => o === 'moveTo').length, 1 * 2, '死的不連');
  vm.runInContext('ELITE_GROUP.linkBeam = 0;', c);
  be.update(set, 0.016, 1200);
  assert.equal(link.ops.filter((o) => o === 'moveTo').length, 0);
});

test('BATTLE-ELITE-4 資料缺欄位不炸：沒有 _fx、沒有 affixes、死亡中、已移除', () => {
  const c = env();
  const be = vm.runInContext('BattleElite', c).create({ PIXI: c.PIXI, layer: new Container() });
  const weird = ent('w', { elite: true, hp: 0, _gid: 9 });
  const gone = ent('g', { elite: true, hp: 0, _gid: 9 });
  gone.state = 'gone';
  assert.doesNotThrow(() => be.update({ w: weird, g: gone, n: null }, 0.016, 5));
  assert.equal(gone.eliteDeco, undefined);
  weird.state = 'dying';
  assert.doesNotThrow(() => be.update({ w: weird }, 0.016, 50));
  assert.ok(weird.eliteDeco.ring.alpha < 0.5, '死亡中環變淡');
});

test('BATTLE-ELITE-5 巨像在建立時放大本體一次，不會每幀累乘', () => {
  const c = env();
  const be = vm.runInContext('BattleElite', c).create({ PIXI: c.PIXI, layer: new Container() });
  const e = ent('a', { elite: true, hp: 10, _gid: 1, affixes: ['giant'] });
  be.update({ a: e }, 0.016, 1);
  const k = c.ELITE_AFFIXES.giant.scale;
  assert.equal(e.body.scale.x, k);
  be.update({ a: e }, 0.016, 2);
  be.update({ a: e }, 0.016, 3);
  assert.equal(e.body.scale.x, k);
});
