'use strict';
/* 戰場地形障礙（js/battle-terrain.js ＋ js/battlefield.js 的接線，2026-10-22）。
   規則：底座寬 ≥ 12 米的擺件是障礙；走路被擋就沿邊滑開；隔著障礙不能近戰普攻；技能不受影響。
   這裡守的是「壞了不報錯、只會卡死或看得到擋不到」的部分：
   模擬層與顯示層是不是同一份位置清單、擺件目錄有沒有跟 battle-decor 脫節、被擋住會不會卡死。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function loadTerrain() {
  const ctx = { Math };
  vm.createContext(ctx);
  vm.runInContext(read('js/battle-terrain.js'), ctx);
  return ctx.BattleTerrain;
}

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

function loadDecor() {
  const ctx = {
    console: { warn() {}, log() {}, info() {} },
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext() }) },
    location: { search: '' }, Math, Map
  };
  vm.createContext(ctx);
  for (const f of ['js/decor-sculpt.js', 'js/decor-nature.js']) vm.runInContext(read(f), ctx);
  ctx.DecorNature.registerImages(Object.fromEntries(Object.keys(ctx.DecorNature.spriteFiles).map((k) => [k, { width: 128, height: 192 }])));
  vm.runInContext(read('js/battle-terrain.js'), ctx);
  vm.runInContext(read('js/battle-decor.js'), ctx);
  return ctx;
}

/* 找一個有障礙的區塊：回傳 { seed, cx, cy, item } */
function findSolid(BT, kit, deep, wantType) {
  const band = deep ? 1 : 0;
  const seed = BT.sceneSeed(kit, deep, band);
  for (let cy = 0; cy < 30; cy++) for (let cx = 0; cx < 30; cx++) {
    for (const it of BT.layoutChunk(kit, deep, seed, cx, cy)) {
      if (it.solid && (!wantType || it.type === wantType)) return { seed, cx, cy, item: it };
    }
  }
  throw new Error('找不到障礙 ' + kit + ' ' + wantType);
}

const dist = (ax, ay, bx, by) => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));

test('TERRAIN-1 擺件目錄與 battle-decor 的 KITS／LANDMARKS 一致（抄本不能脫節）', () => {
  const { BattleDecor } = loadDecor();
  const BT = loadTerrain();
  const L = BattleDecor._internals.LANDMARKS;
  // 兩個 vm 環境的陣列原型不同，deepStrictEqual 會誤報；轉成 JSON 再比
  const same = (a, b, what) => assert.equal(JSON.stringify(a.map((p) => p.slice(0, 4))), JSON.stringify(b.map((p) => p.slice(0, 4))), what);
  for (const kit of Object.keys(BattleDecor.KITS).filter((k) => k)) {
    const cat = BT.CATALOG[kit];
    assert.ok(cat, '目錄缺 ' + kit);
    same(BattleDecor.KITS[kit].props, cat.s, kit + ' 地表擺件');
    same(BattleDecor.KITS[kit].deepProps, cat.d, kit + ' 地下擺件');
    same(L[kit].surface, cat.ls, kit + ' 地表地標');
    same(L[kit].deep, cat.ld, kit + ' 地下地標');
  }
});

test('TERRAIN-2 同一區塊每次擺得一樣；換地圖或階段帶就不一樣', () => {
  const BT = loadTerrain();
  const seed = BT.sceneSeed('lava_mountain', false, 0);
  const a = JSON.stringify(BT.layoutChunk('lava_mountain', false, seed, 3, -2));
  assert.equal(JSON.stringify(BT.layoutChunk('lava_mountain', false, seed, 3, -2)), a);
  assert.notEqual(JSON.stringify(BT.layoutChunk('lava_mountain', false, BT.sceneSeed('lava_mountain', false, 2), 3, -2)), a);
  assert.notEqual(JSON.stringify(BT.layoutChunk('desert', false, BT.sceneSeed('desert', false, 0), 3, -2)), a);
});

test('TERRAIN-3 顯示層的擺件就是清單上的擺件（看到的岩石＝擋路的岩石）', () => {
  const ctx = loadDecor();
  const BT = ctx.BattleTerrain;
  // 與 battle-decor.test.cjs 同款的最小假 PIXI
  class Container {
    constructor() { this.children = []; this.parent = null; this.visible = true; }
    addChild(c) { if (c.parent) c.parent.removeChild(c); this.children.push(c); c.parent = this; return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return c; }
    addChildAt(c) { return this.addChild(c); }
  }
  const point = () => ({ x: 1, y: 1, set(a, b) { this.x = a; this.y = b === undefined ? a : b; } });
  class Sprite extends Container {
    constructor(t) { super(); this.texture = t; this._anchor = point(); this.scale = point(); this.alpha = 1; this.tint = 0xffffff; this.rotation = 0; this.skew = { x: 0 }; }
    destroy() { this.destroyed = true; if (this.parent) this.parent.removeChild(this); }
  }
  Object.defineProperty(Sprite.prototype, 'anchor', { get() { return this._anchor; } });
  const PIXI = { Container, Sprite, Texture: class { destroy() {} }, CanvasSource: class {}, Rectangle: class {} };
  const layers = { decal: new Container(), light: new Container(), prop: new Container(), ambient: new Container() };
  const decor = ctx.BattleDecor.create({ PIXI, groundScale: 0.5, decalLayer: layers.decal, lightLayer: layers.light, propLayer: layers.prop, ambientLayer: layers.ambient, buildBudgetMs: Infinity, prebuildBudgetMs: 0, worker: false });
  decor.setScene('lava_mountain', 12);
  for (let i = 0; i < 3; i++) decor.update({ camX: 300, camY: 300, drawRect: { x: -120, y: -150, width: 1050, height: 1100 }, W: 813, H: 813, dt: 1 / 60, playerX: 300, playerScreenY: 150 });
  const seed = BT.sceneSeed('lava_mountain', true, 1);   // 第 12 階段＝第 2 帶＝地下
  const want = [];
  for (let cy = -3; cy < 6; cy++) for (let cx = -3; cx < 6; cx++) for (const it of BT.layoutChunk('lava_mountain', true, seed, cx, cy)) want.push(it.x + ',' + (it.y * 0.5));
  const drawn = layers.prop.children.filter((s) => s._decorW);
  assert.ok(drawn.length > 0, '畫面上沒有擺件');
  for (const s of drawn) assert.ok(want.includes(s.x + ',' + s.y), '畫面上的擺件不在清單裡：' + s.x + ',' + s.y);
});

test('TERRAIN-4 底座 ≥ 12 米才算障礙；地面坑洞與樹不算；石拱有兩條腿', () => {
  const BT = loadTerrain();
  assert.equal(BT.isSolid('lavaOutcrop', 125), true);
  assert.equal(BT.isSolid('lavaOutcrop', 110), false, '底座不到 12 米');
  assert.equal(BT.isSolid('lavaVent', 300), false, '地面坑洞永遠能走');
  assert.equal(BT.isSolid('mistTree', 280), false, '樹冠寬、底座小');
  assert.equal(BT.isSolid('grass', 500), false, '沒列底座的種類不擋');
  assert.equal(BT.footShapes('arch', 0, 0, 220, 1).length, 2);
  BT.setMinWidth(60);
  assert.equal(BT.isSolid('rock', 80), true, '門檻調低後小岩也算');
  BT.setMinWidth(0);
  assert.equal(BT.getMinWidth(), BT.DEFAULT_MIN_W, '無效值退回預設');
});

test('TERRAIN-5 筆直朝目標走過去會沿邊滑開，不卡住、不進到障礙裡', () => {
  const BT = loadTerrain();
  const f = findSolid(BT, 'lava_mountain', false, 'lavaOutcrop');
  BT.setScene('lava_mountain', 1);
  const e = f.item.shapes[0];
  for (const dy of [0, 0.01, -0.01, 12, -12]) {
    // 從障礙正左方走到正右方，起點終點都在障礙外
    const pos = { x: e[0] - e[2] - 200, y: e[1] + dy }, goal = { x: e[0] + e[2] + 200, y: e[1] + dy };
    const state = { id: 0, side: 0 };
    let steps = 0;
    while (dist(goal.x, goal.y, pos.x, pos.y) > 4 && steps < 400) {
      const d = dist(goal.x, goal.y, pos.x, pos.y), s = Math.min(d, 9);
      pos.x += (goal.x - pos.x) / d * s; pos.y += (goal.y - pos.y) / d * s;
      BT.pushOut(pos, 18, goal.x, goal.y, state);
      const u = (pos.x - e[0]) / (e[2] + 18), v = (pos.y - e[1]) / (e[3] + 18);
      assert.ok(u * u + v * v >= 0.999, '走進障礙裡了');
      steps++;
    }
    assert.ok(steps < 400, '卡住了：dy=' + dy);
  }
});

test('TERRAIN-6 隔著障礙的連線算被擋；繞開的不算', () => {
  const BT = loadTerrain();
  const f = findSolid(BT, 'lava_mountain', false, 'lavaOutcrop');
  BT.setScene('lava_mountain', 1);
  const e = f.item.shapes[0];
  assert.equal(BT.segmentBlocked(e[0] - 300, e[1], e[0] + 300, e[1]), true);
  assert.equal(BT.segmentBlocked(e[0] - 300, e[1] - e[3] - 60, e[0] + 300, e[1] - e[3] - 60), false);
  assert.equal(BT.segmentBlocked(e[0] - 300, e[1], e[0] - 100, e[1]), false, '線段沒走到障礙');
});

/* ---- 與 battlefield.js 的接線 ---- */
function loadField(stage, tower) {
  const ctx = { console, Math: Object.create(Math) };
  vm.createContext(ctx);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battle-terrain.js', 'js/battlefield.js'].forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  // G 在 data.js 宣告但還是 null（正式流程由存檔建立）；這裡只給 battlefield.js 讀的場景與塔旗標
  ctx.__stage = stage; ctx.__tower = !!tower;
  vm.runInContext('G = { stage: __stage, tower: { active: __tower } };', ctx);
  return ctx;
}

test('TERRAIN-7 近戰普攻不能隔著障礙；移開後打得到；封魔塔與沒有 G 的環境不啟用', () => {
  const c = loadField({ zone: 'lava_mountain', current: 1 });
  const f = findSolid(c.BattleTerrain, 'lava_mountain', false, 'lavaOutcrop');
  const e = f.item.shapes[0];
  c.bfTerrainSync();
  c.bfResetPlayer();
  const me = c.bfPlayerPos();
  // 直接把兩人放在障礙兩側的圓心附近：距離在近戰範圍內，只留障礙擋線
  me.x = e[0] - 10; me.y = e[1];
  const foe = { hp: 10, maxHp: 10, pos: { x: e[0] + 10, y: e[1] }, atkRange: 40 };
  assert.equal(c.bfPlayerCanReach(foe), false, '隔著障礙不能近戰');
  foe.pos.x = me.x + 10; foe.pos.y = me.y + 10;
  foe.pos.x = e[0] - 80; foe.pos.y = e[1] - 200;   // 離開障礙
  me.x = foe.pos.x + 20; me.y = foe.pos.y;
  assert.equal(c.bfPlayerCanReach(foe), true, '沒擋線就打得到');
  // 封魔塔：地形不啟用
  const t = loadField({ zone: 'lava_mountain', current: 1 }, true);
  assert.equal(t.bfTerrainSync(), false);
  // 沒有 G 的測試環境：恆為沒有障礙
  const bare = { console, Math };
  vm.createContext(bare);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battle-terrain.js', 'js/battlefield.js'].forEach((x) => vm.runInContext(read(x), bare));
  assert.equal(bare.bfTerrainSync(), false);
});

test('TERRAIN-8 我方追著障礙另一側的敵人，繞過去之後打得到，過程不卡死不進障礙', () => {
  const c = loadField({ zone: 'lava_mountain', current: 1 });
  const f = findSolid(c.BattleTerrain, 'lava_mountain', false, 'lavaOutcrop');
  const e = f.item.shapes[0];
  c.bfTerrainSync();
  c.bfResetPlayer();
  const me = c.bfPlayerPos();
  me.x = e[0] - e[2] - 150; me.y = e[1];
  const foe = { hp: 10, maxHp: 10, pos: { x: e[0] + e[2] + 60, y: e[1] }, runSpeed: 0, atkRange: 40 };
  const enemies = [foe];
  let reached = false;
  for (let i = 0; i < 1200 && !reached; i++) {
    c.bfTickPlayer(enemies, 1 / 30, foe, null);
    const u = (me.x - e[0]) / (e[2] + 18), v = (me.y - e[1]) / (e[3] + 18);
    assert.ok(u * u + v * v >= 0.99, '我方走進障礙裡了');
    reached = c.bfPlayerCanReach(foe);
  }
  assert.ok(reached, '繞不過去，卡死了');
});

test('TERRAIN-9 敵人逼近我方時繞過障礙，不卡死', () => {
  const c = loadField({ zone: 'lava_mountain', current: 1 });
  const f = findSolid(c.BattleTerrain, 'lava_mountain', false, 'lavaOutcrop');
  const e = f.item.shapes[0];
  c.bfTerrainSync();
  c.bfResetPlayer();
  const me = c.bfPlayerPos();
  me.x = e[0] + e[2] + 150; me.y = e[1];
  const foe = { hp: 10, maxHp: 10, pos: { x: e[0] - e[2] - 150, y: e[1] }, runSpeed: 200, atkRange: 40, sightRange: 0 };
  let inRange = false;
  for (let i = 0; i < 1200 && !inRange; i++) {
    c.bfTickApproach([foe], 1 / 30);
    const u = (foe.pos.x - e[0]) / (e[2] + 20), v = (foe.pos.y - e[1]) / (e[3] + 20);
    assert.ok(u * u + v * v >= 0.99, '敵人走進障礙裡了');
    inRange = c.bfInAttackRange(foe);
  }
  assert.ok(inRange, '敵人繞不過去，卡死了');
});

test('TERRAIN-DIVINE-VARIETY 神界保留舊物件並以十種以上造景形成多樣區塊', () => {
  const BT=loadTerrain();
  const retained={god_battlefield:['godBlade','warCrown','sunRelic','chainShard'],god_chaos:['voidGyre','voidPrism','voidSpindle','voidLens'],god_sanctuary:['seraphWing','celestialHarp','haloDais','lightLotus']};
  for(const [zone,oldTypes] of Object.entries(retained).filter(([zone])=>zone!=='god_sanctuary'))for(const deep of [false,true]){
    const rows=deep?BT.CATALOG[zone].d:BT.CATALOG[zone].s;
    assert.ok(new Set(rows.map(p=>p[0])).size>=10);for(const type of oldTypes)assert.ok(rows.some(p=>p[0]===type));
    const types=new Set(),seed=BT.sceneSeed(zone,deep,deep?1:0);
    for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)for(const item of BT.layoutChunk(zone,deep,seed,x,y))types.add(item.type);
    assert.ok(types.size>=7,zone+' 附近九區塊必須有足夠不同造景，實際'+types.size);
  }
  assert.equal(BT.isSolid('emberCrater',300),false);assert.equal(BT.isSolid('riftAnchor',300),false);
  assert.equal(BT.isSolid('warRampart',235),true);assert.equal(BT.footShapes('celestialArch',0,0,236,1).length,2);
});

test('TERRAIN-SANCTUARY 聖域地表與深層均無隨機擺件、地標及隱形障礙', () => {
  const BT=loadTerrain();for(const list of Object.values(BT.CATALOG.god_sanctuary))assert.equal(list.length,0);
  for(const stage of [1,11]){BT.setScene('god_sanctuary',stage);const deep=stage===11,seed=BT.sceneSeed('god_sanctuary',deep,deep?1:0);
    for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)assert.equal(BT.layoutChunk('god_sanctuary',deep,seed,x,y).length,0);
    assert.equal(BT.segmentBlocked(-800,-600,900,700),false);
  }
});
