'use strict';
/* 封魔塔魔王祭壇（js/battle-arena.js）與野外 ⇄ 魔王戰的轉場（js/battle-renderer.js）。
   好不好看要人眼看；這裡守的是「壞了不會報錯、只會安靜地不見或越長越多」的部分：
   畫法有沒有拋例外、進出場有沒有洩漏節點、標題卡會不會收掉、轉場會不會卡在全黑、
   以及轉場長度有沒有跟模擬層的「登場」對齊。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function fakeContext() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') return () => gradient;
      if (key === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set(t, key, value) { t[key] = value; return true; }
  });
}

function fakePixi() {
  let alive = 0;
  const point = () => ({ x: 1, y: 1, set(a, b) { this.x = a; this.y = b === undefined ? a : b; } });
  class Container {
    constructor() { alive++; this.children = []; this.parent = null; this.visible = true; this.x = 0; this.y = 0; this.alpha = 1; this.scale = point(); this.rotation = 0; this.skew = { x: 0 }; }
    addChild(c) { if (c.parent) c.parent.removeChild(c); this.children.push(c); c.parent = this; return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return c; }
    destroy(o) {
      if (this.destroyed) return;
      alive--; this.destroyed = true;
      if (o && o.children) this.children.slice().forEach((c) => c.destroy(o));
      if (this.parent) this.parent.removeChild(this);
    }
  }
  class Sprite extends Container { constructor(tex) { super(); this.texture = tex; this.anchor = point(); this.tint = 0xffffff; } }
  class Text extends Container { constructor(o) { super(); this.text = o.text; this.style = o.style; this.anchor = point(); } }
  class Graphics extends Container { rect() { return this; } fill() { return this; } }
  class Texture { constructor(o) { this.o = o; } }
  class CanvasSource { constructor(o) { this.o = o; } }
  return { PIXI: { Container, Sprite, Text, Graphics, Texture, CanvasSource }, alive: () => alive, Container };
}

function loadArena(search) {
  const warnings = [];
  const ctx = {
    console: { warn: (...a) => warnings.push(a.join(' ')), log() {}, info() {} },
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext() }) },
    location: { search: search || '' },
    Math, Map
  };
  vm.createContext(ctx);
  vm.runInContext(read('js/decor-sculpt.js'), ctx);
  vm.runInContext(read('js/battle-decor.js'), ctx);
  vm.runInContext(read('js/battle-arena.js'), ctx);
  return { BossArena: ctx.BossArena, BattleDecor: ctx.BattleDecor, warnings };
}

function makeArena(BossArena, P) {
  const layers = { base: new P.Container(), glow: new P.Container(), prop: new P.Container(), ambient: new P.Container(), title: new P.Container() };
  const arena = BossArena.create({
    PIXI: P.PIXI, groundScale: 0.5,
    planeBase: layers.base, planeGlow: layers.glow, propLayer: layers.prop,
    ambientLayer: layers.ambient, titleLayer: layers.title
  });
  return { arena, layers };
}

test('ARENA-1 三座塔的貼圖都畫得出來，畫法不拋例外', () => {
  const { BossArena, warnings } = loadArena();
  const P = fakePixi();
  for (const tier of ['trial', 'hell', 'purgatory']) {
    const { arena } = makeArena(BossArena, P);
    assert.ok(arena.enter({ cx: 0, cy: 0, tier, W: 800, H: 800, title: 'BOSS', subtitle: 'x' }));
    assert.ok(arena.floorTexture(), tier + ' 要有地板貼圖');
    arena.exit();
  }
  assert.deepEqual(warnings, [], '畫法不得失敗：' + warnings.join(' / '));
});

test('ARENA-2 三座塔各一套配色；塔別由 BOSS 旗標決定', () => {
  const { BossArena } = loadArena();
  const glows = ['trial', 'hell', 'purgatory'].map((k) => BossArena.TIERS[k].glow);
  assert.equal(new Set(glows).size, 3);
  assert.equal(BossArena.tierOf({}), 'trial');
  assert.equal(BossArena.tierOf({ hell: true }), 'hell');
  assert.equal(BossArena.tierOf({ hell: true, purgatory: true }), 'purgatory');
});

test('ARENA-3 進出場不洩漏節點；連續進場（連挑）會先清掉上一座', () => {
  const { BossArena } = loadArena();
  const P = fakePixi();
  const { arena, layers } = makeArena(BossArena, P);
  arena.enter({ cx: 0, cy: 0, tier: 'trial', W: 800, H: 800, title: 'BOSS' });   // 第一次進場會建貼圖快取，之後才比節點數
  arena.exit();
  const baseline = P.alive();
  arena.enter({ cx: 100, cy: 50, tier: 'trial', W: 800, H: 800, title: 'BOSS' });
  const once = P.alive();
  assert.ok(once > baseline + 20, '祭壇要有一整圈擺件與粒子');
  assert.ok(layers.prop.children.length >= 15, '圓場邊緣一圈擺件（魔門、火盆、尖刺、燭台）');
  arena.enter({ cx: 300, cy: 50, tier: 'hell', W: 800, H: 800, title: 'BOSS2' });
  assert.equal(P.alive(), once, '再次進場不得疊出第二座');
  arena.exit();
  assert.equal(P.alive(), baseline, '離場要全部收乾淨');
  for (const l of Object.values(layers)) assert.equal(l.children.length, 0);
  assert.equal(arena.active(), false);
  assert.equal(arena.floorTexture(), null);
});

test('ARENA-4 標題卡播完自己收掉；狂暴時法陣更亮、心跳光暈更重', () => {
  const { BossArena } = loadArena();
  const P = fakePixi();
  const { arena, layers } = makeArena(BossArena, P);
  arena.enter({ cx: 0, cy: 0, tier: 'purgatory', W: 800, H: 800, title: '冰霜女皇', subtitle: '封魔塔 第 22 層' });
  assert.equal(layers.title.children.length, 1);
  const view = (enraged) => ({ W: 800, H: 800, dt: 1 / 30, enraged, playerX: 0, playerScreenY: 0 });
  for (let i = 0; i < 30 * 4; i++) arena.update(view(false));
  assert.equal(layers.title.children.length, 0, '標題卡約 2.7 秒後收掉');
  assert.equal(arena.stats().title, false);
  const edge = layers.ambient.children[0];
  const glow = layers.glow.children.find((c) => c.blendMode === 'add' && c.width > 300);
  let calmEdge = 0, calmGlow = 0, hotEdge = 0, hotGlow = 0;
  for (let i = 0; i < 60; i++) { arena.update(view(false)); calmEdge = Math.max(calmEdge, edge.alpha); calmGlow = Math.max(calmGlow, glow.alpha); }
  for (let i = 0; i < 90; i++) arena.update(view(true));   // 先讓狂暴的閃光退掉
  for (let i = 0; i < 60; i++) { arena.update(view(true)); hotEdge = Math.max(hotEdge, edge.alpha); hotGlow = Math.max(hotGlow, glow.alpha); }
  assert.ok(hotEdge > calmEdge * 1.5, '狂暴心跳光暈更重');
  assert.ok(hotGlow > calmGlow, '狂暴法陣更亮');
});

test('ARENA-5 ?arena=0 關閉；載入順序 battle-decor → battle-arena → battle-renderer', () => {
  const { BossArena } = loadArena('?arena=0');
  const P = fakePixi();
  const { arena } = makeArena(BossArena, P);
  assert.equal(arena.enabled, false);
  assert.equal(arena.enter({ cx: 0, cy: 0, tier: 'trial', W: 800, H: 800 }), false);
  assert.ok(read('index.html').indexOf('js/battle-decor.js?v=') < read('index.html').indexOf('js/battle-arena.js?v='));
  assert.ok(read('index.html').indexOf('js/battle-arena.js?v=') < read('index.html').indexOf('js/battle-renderer.js?v='));
});

/* ---- 轉場 ---- */
function extractFunction(src, name) {
  const head = src.indexOf('function ' + name + '(');
  assert.notEqual(head, -1, '找不到函式 ' + name);
  let i = src.indexOf('{', head), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(head, i + 1);
  }
  throw new Error(name + ' 大括號沒有配對');
}

test('TRANS-1 黑圈三段（收合＋全黑＋展開）約 2～3 秒，且與模擬層的登場、回野外的出怪延後對齊', () => {
  const renderer = read('js/battle-renderer.js');
  const m = /var IRIS_CLOSE_SEC = ([0-9.]+), IRIS_HOLD_SEC = ([0-9.]+), IRIS_OPEN_SEC = ([0-9.]+);/.exec(renderer);
  assert.ok(m, '找不到轉場常數');
  const total = Number(m[1]) + Number(m[2]) + Number(m[3]);
  assert.ok(total >= 2 && total <= 3, '使用者要求約 2～3 秒（實際 ' + total + '）');
  const tower = read('js/tower.js');
  const intro = Number(/var TOWER_INTRO_SEC = ([0-9.]+);/.exec(tower)[1]);
  const hold = Number(/var TOWER_EXIT_SPAWN_HOLD_SEC = ([0-9.]+);/.exec(tower)[1]);
  assert.ok(Math.abs(intro - total) < 1e-9, '登場長度＝整段轉場（黑圈展開完才開打）');
  assert.ok(Math.abs(hold - total) < 1e-9, '回野外的出怪延後＝整段轉場');
});

function loadScene() {
  const renderer = read('js/battle-renderer.js');
  const consts = /var IRIS_CLOSE_SEC = [^;]+;/.exec(renderer)[0];
  const calls = [];
  const style = { display: 'none', width: '0px', height: '0px' };
  const c = {
    Math, isFinite, String,
    S: { W: 400, H: 300, scene: { key: 'field', phase: '', t: 0 }, lastPanel: null, ready: true,
      iris: { root: { style }, hole: { style } }, floats: [], floatMerge: {}, lastPos: {}, entities: { 'mv-float-1': {} }, bossBar: null,
      decor: { setVisible: (v) => calls.push(['decor', v]) }, arena: null, arenaEnraged: false },
    documentHidden: () => false,
    clearAllFx: () => calls.push(['clearFx']),
    killFx() {}, destroyEntity: (id) => { calls.push(['destroy', id]); delete c.S.entities[id]; },
    enterArena: (tv) => calls.push(['enterArena', tv.monsters[0].name]),
    exitArena: () => calls.push(['exitArena']),
    reconcileBattle: (panel, field) => calls.push(['reconcile', field.towerView ? 'tower' : 'field'])
  };
  vm.createContext(c);
  vm.runInContext(consts + ['towerFieldView', 'sceneKeyOf', 'irisSet', 'beginSceneTransition', 'tickScene', 'applySceneSwitch', 'syncBattle']
    .map((n) => extractFunction(renderer, n)).join('\n'), c);
  return { c, calls, style };
}
const fieldPanel = () => ({ field: { monsters: [], playerPos: { x: 0, y: 0 } }, tower: { boss: null } });
const towerPanel = (spawnAt, name) => ({
  field: { monsters: [], playerPos: { x: 0, y: 0 } },
  tower: { floor: 3, boss: { name: name || 'B', _spawnAt: spawnAt, floatSel: 'tb-float', hp: 10, maxHp: 10, pos: { x: 260, y: 0 } }, player: { hp: 1 }, playerPos: { x: 0, y: 0 } }
});
function run(c, sec) { for (let t = 0; t < sec; t += 0.05) c.tickScene(0.05); }

test('TRANS-2 進塔：收合期間凍結舊畫面，全黑那一刻才換場景，展開後照常同步', () => {
  const { c, calls, style } = loadScene();
  c.syncBattle(towerPanel(5));
  assert.equal(c.S.scene.phase, 'closing');
  assert.equal(c.S.scene.key, 'field', '黑圈收起來之前還是野外');
  assert.equal(style.display, '');
  assert.ok(!calls.some((x) => x[0] === 'reconcile'), '收合中不 reconcile');
  run(c, 1.02);
  assert.equal(c.S.scene.phase, 'black');
  assert.equal(c.S.scene.key, 'tower:5');
  assert.equal(style.width, '0px', '全黑');
  assert.deepEqual(calls.filter((x) => x[0] !== 'destroy'), [['clearFx'], ['enterArena', 'B'], ['decor', false], ['reconcile', 'tower']]);
  assert.ok(calls.some((x) => x[0] === 'destroy' && x[1] === 'mv-float-1'), '野外的實體在黑幕中清掉');
  run(c, 1.5);
  assert.equal(c.S.scene.phase, '');
  assert.equal(style.display, 'none', '展開完遮罩收起來');
  calls.length = 0;
  c.syncBattle(towerPanel(5));
  assert.deepEqual(calls, [['reconcile', 'tower']]);
});

test('TRANS-3 出塔與連挑都會轉場；轉場中場景又變了（登場中撤退）會接著再轉一次', () => {
  const { c, calls } = loadScene();
  c.syncBattle(towerPanel(5)); run(c, 2.5);
  // 連挑：下一場 BOSS（生成時刻不同）→ 再轉一次、祭壇重擺
  calls.length = 0;
  c.syncBattle(towerPanel(9, 'B2'));
  assert.equal(c.S.scene.phase, 'closing');
  run(c, 1.1);
  assert.ok(calls.some((x) => x[0] === 'enterArena' && x[1] === 'B2'));
  // 黑幕中就撤退了：展開完發現場景不對，馬上再轉回野外
  c.syncBattle(fieldPanel());
  run(c, 1.5);
  assert.equal(c.S.scene.phase, 'closing', '展開完立刻再收合');
  run(c, 1.1);
  assert.equal(c.S.scene.key, 'field');
  assert.ok(calls.some((x) => x[0] === 'exitArena'));
  assert.ok(calls.some((x) => x[0] === 'decor' && x[1] === true), '回野外地形裝飾重新出現');
  run(c, 1.5);
  assert.equal(c.S.scene.phase, '');
});

test('TRANS-4 背景分頁不播轉場，直接換場景（不會卡在全黑）', () => {
  const { c, calls } = loadScene();
  c.documentHidden = () => true;
  c.syncBattle(towerPanel(5));
  assert.equal(c.S.scene.phase, '');
  assert.equal(c.S.scene.key, 'tower:5');
  assert.ok(calls.some((x) => x[0] === 'enterArena'));
});
