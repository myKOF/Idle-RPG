'use strict';
/* 戰場地形裝飾（js/battle-decor.js）。
   畫面好不好看要人眼看；這裡守的是「壞了不會報錯、只會安靜地不見或越長越多」的部分：
   畫法有沒有拋例外、區塊回收有沒有洩漏、同一塊地回來時長得一不一樣、地表／地下有沒有照階段帶切換。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('GROUND-LOAD-RACE 通用底圖晚到不覆蓋選定地貌，專用圖失敗仍能後備', async () => {
  const source=fs.readFileSync(path.join(root,'js/battle-renderer.js'),'utf8'),requests=[],applied=[];
  const ctx={S:{zoneKey:null},_groundTexCache:{},GROUND_ASSET_VERSION:'test',applyGroundTexture:tex=>applied.push(tex.id),PIXI:{Assets:{load:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject}))}}};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  function loadGroundTexture('),source.indexOf('  function applyGroundTexture(')),ctx);
  ctx.loadGroundTexture(null);ctx.S.zoneKey='desert';ctx.loadGroundTexture('desert');
  requests[1].resolve({id:'desert'});await new Promise(r=>setImmediate(r));
  requests[0].resolve({id:'default'});await new Promise(r=>setImmediate(r));
  assert.deepEqual(applied,['desert'],'遲到的通用底圖不能蓋掉荒漠顏色');
  ctx.S.zoneKey='Icefield';ctx.loadGroundTexture('Icefield');requests[2].reject(new Error('404'));
  await new Promise(r=>setImmediate(r));assert.deepEqual(applied,['desert','default'],'專用貼圖不存在時必須繼續後備');
});

test('DECOR-IMAGE-LOAD 完整素材載入去重、失敗重試只補缺圖，等比縮放保持底部腳點', async () => {
  const ctx={URL,console,location:{href:'https://game.test/tools/preview.html'}};vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root,'js/decor-nature.js'),'utf8'),ctx);
  const nature=ctx.DecorNature,calls=[],pending=[];
  const loader=url=>{calls.push(url);return new Promise((resolve,reject)=>pending.push({url,resolve,reject}));};
  const first=nature.loadImages('https://game.test/',loader),second=nature.loadImages('https://game.test/',loader);
  assert.equal(first,second);assert.equal(calls.length,20);
  for(const p of pending)if(p.url.includes('/willow.png'))p.reject(new Error('network'));else p.resolve({width:200,height:100});
  await assert.rejects(first,/network/);await Promise.resolve();
  await nature.loadImages('https://game.test/',url=>{calls.push(url);return Promise.resolve({width:100,height:200});});
  assert.equal(calls.length,21);assert.ok(calls.every(url=>url.startsWith('https://game.test/images/scene/')));
  await nature.loadImages('https://game.test/',()=>{throw new Error('已載入不應重新請求');});
  const draws=[],g=fakeContext();g.drawImage=(...args)=>draws.push(args);
  nature.drawBody(g,'willow',0,0,100,120,1,{});
  assert.equal(draws.length,1);assert.deepEqual(draws[0].slice(1),[-30,-120,60,120]);
});

/* 假的 Canvas 2D：所有方法都接受、什麼都不畫；漸層物件有 addColorStop。用來確認畫法本身不拋例外。 */
function fakeContext() {
  const gradient = { addColorStop() {} };
  const target = {};
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') return () => gradient;
      if (key === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set(t, key, value) { t[key] = value; return true; }
  });
}

function loadDecor(extra) {
  const warnings = [];
  const ctx = Object.assign({
    console: { warn: (...a) => warnings.push(a.join(' ')), log() {}, info() {} },
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext() }) },
    location: { search: '' },
    Math, Map
  }, extra || {});
  vm.createContext(ctx);
  // 載入順序同 index.html：浮雕繪圖（decor-sculpt）在前
  vm.runInContext(fs.readFileSync(path.join(root, 'js/decor-sculpt.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/decor-nature.js'), 'utf8'), ctx);
  ctx.DecorNature.registerImages(Object.fromEntries(Object.keys(ctx.DecorNature.spriteFiles).map(key=>[key,{width:128,height:192}])));
  vm.runInContext(fs.readFileSync(path.join(root, 'js/battle-decor.js'), 'utf8'), ctx);
  return { BattleDecor: ctx.BattleDecor, DecorSculpt: ctx.DecorSculpt, warnings, ctx };
}

/* 最小的假 PIXI：只要 Container／Sprite／Texture／CanvasSource／Rectangle。 */
function fakePixi() {
  let alive = 0;
  class Container {
    constructor() { this.children = []; this.parent = null; this.visible = true; this.x = 0; this.y = 0; }
    addChild(c) { if (c.parent) c.parent.removeChild(c); this.children.push(c); c.parent = this; return c; }
    addChildAt(c, i) { if (c.parent) c.parent.removeChild(c); this.children.splice(i, 0, c); c.parent = this; return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return c; }
  }
  const point = () => ({ x: 1, y: 1, set(a, b) { this.x = a; this.y = b === undefined ? a : b; } });
  class Sprite extends Container {
    /* 與真的 Pixi 一樣：anchor 是 getter，底層放在 _anchor——自訂屬性取名撞到它，anchor.set 就會消失（2026-10-04 實際發生過） */
    constructor(tex) { super(); alive++; this.texture = tex; this._anchor = point(); this.scale = point(); this.alpha = 1; this.tint = 0xffffff; this.rotation = 0; this.skew = { x: 0 }; }
    destroy() { alive--; this.destroyed = true; if (this.parent) this.parent.removeChild(this); }
  }
  Object.defineProperty(Sprite.prototype, 'anchor', { get() { return this._anchor; } });
  class Texture { constructor(o) { this.o = o; } destroy() {} }
  class CanvasSource { constructor(o) { this.o = o; } }
  class Rectangle { constructor(x, y, w, h) { Object.assign(this, { x, y, w, h }); } }
  return { PIXI: { Container, Sprite, Texture, CanvasSource, Rectangle }, alive: () => alive, Container };
}

/* 測試預設同步建圖（預算無限、不背景預建）；DECOR-9 另外驗分段建圖本身。 */
function makeDecor(BattleDecor, P, budget) {
  const layers = { decal: new P.Container(), light: new P.Container(), prop: new P.Container(), ambient: new P.Container() };
  const tints = [];
  const decor = BattleDecor.create({
    PIXI: P.PIXI, groundScale: 0.5,
    decalLayer: layers.decal, lightLayer: layers.light, propLayer: layers.prop, ambientLayer: layers.ambient,
    onTint: (t) => tints.push(t),
    buildBudgetMs: budget ? budget.build : Infinity, prebuildBudgetMs: budget ? budget.prebuild : 0
  });
  return { decor, layers, tints };
}

function view(camX, camY) {
  return { camX, camY, drawRect: { x: -120, y: -150, width: 1050, height: 1100 }, W: 813, H: 813, dt: 1 / 60, playerX: camX, playerScreenY: camY * 0.5 };
}

test('DECOR-1 每張地圖（ZONES）都有自己的地形組合，新增地圖時會被提醒', () => {
  const dataCtx = { console, Math };
  vm.createContext(dataCtx);
  for (const f of ['js/util.js', 'js/data.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), dataCtx);
  const zones = Object.keys(vm.runInContext('ZONES', dataCtx));
  const { BattleDecor } = loadDecor();
  assert.ok(zones.length >= 7);
  for (const z of zones) assert.ok(BattleDecor.KITS[z], '地圖 ' + z + ' 沒有地形組合（js/battle-decor.js 的 KITS）');
});

test('DECOR-2 所有地圖的地表與地下圖集都畫得出來，沒有任何畫法拋例外', () => {
  const { BattleDecor, warnings } = loadDecor();
  for (const key of Object.keys(BattleDecor.KITS)) {
    for (const deep of [false, true]) {
      const atlas = BattleDecor.buildAtlas(key, deep);
      assert.ok(atlas.specs.length > 10, key + (deep ? '（地下）' : '') + ' 圖集內容太少');
      assert.ok(atlas.canvas.height <= 4096, key + ' 圖集超過 4096 高');
      // 每個擺件與地面裝飾都有落在圖集裡、互不重疊
      const boxes = atlas.specs.map((s) => [s.px, s.py, s.px + s.pw, s.py + s.ph]);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const overlap = a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
          assert.ok(!overlap, key + ' 圖集有重疊：' + atlas.specs[i].key + ' / ' + atlas.specs[j].key);
        }
      }
    }
  }
  assert.deepEqual(warnings, [], '畫法拋了例外：' + warnings.join('\n'));
});

test('DECOR-3 同一個區塊離開再回來，擺件位置完全一樣（以區塊座標當種子）', () => {
  const { BattleDecor } = loadDecor();
  const P = fakePixi();
  const { decor, layers } = makeDecor(BattleDecor, P);
  decor.setScene('desert', 1);
  decor.update(view(0, 0));
  // 此處釘住地貌的放置；煙霧等局部演出的位置依動畫時間移動，另行驗證。
  const snap = () => layers.prop.children.filter(s => !s._decorLocal).map((s) => s.x.toFixed(2) + ',' + s.y.toFixed(2)).sort().join('|');
  const first = snap();
  assert.ok(layers.prop.children.length > 0, '鏡頭附近應該有擺件');
  decor.update(view(20000, 0));
  assert.notEqual(snap(), first, '走遠之後應該換成別的區塊');
  decor.update(view(0, 0));
  assert.equal(snap(), first);
});

test('DECOR-4 鏡頭一路往前走，場景裡的節點數有上限（看不到的區塊回收到物件池）', () => {
  const { BattleDecor } = loadDecor();
  const P = fakePixi();
  const { decor, layers } = makeDecor(BattleDecor, P);
  decor.setScene('swamp', 5);
  let maxNodes = 0;
  for (let x = 0; x < 200000; x += 37) {
    decor.update(view(x, Math.sin(x / 3000) * 2000));
    const n = layers.decal.children.length + layers.light.children.length + layers.prop.children.length;
    if (n > maxNodes) maxNodes = n;
  }
  assert.ok(maxNodes < 260, '同時在場的裝飾節點 ' + maxNodes + ' 個，太多了');
  // 物件池重用：總共建立過的精靈不會隨著走過的距離一直增加
  assert.ok(P.alive() < 400, '建立過的精靈 ' + P.alive() + ' 個，物件池沒有重用');
  const st = decor.stats();
  assert.ok(st.chunks > 0 && st.chunks < 40);
});

test('DECOR-MOTION 局部點綴有上限、風只動本體，暫停／隱藏凍結動畫且切圖完整回收', () => {
  for (const lite of [false,true]) {
    const {BattleDecor}=loadDecor({location:{search:lite?'?decor=lite':''}});
    const P=fakePixi(),{decor,layers}=makeDecor(BattleDecor,P);
    decor.setScene('swamp',1);decor.update(view(0,0));
    const local=()=>layers.prop.children.concat(layers.decal.children).filter(s=>s._decorLocal);
    const snapshot=()=>JSON.stringify(local().map(s=>[s.x,s.y,s.alpha,s.scale.x,s.scale.y]));
    assert.ok(decor.stats().localSources>0,'沼澤鏡頭應有局部源點');
    assert.ok(decor.stats().localParticles <= (lite?2:18));
    const bodies=layers.prop.children.filter(s=>s._natureSway);
    assert.ok(bodies.length>0,'種子樣本需含風吹植被');
    const feet=bodies.map(s=>[s.x,s.y]),skew=bodies.map(s=>s.skew.x),first=snapshot();
    for(let i=0;i<100;i++)decor.update(view(0,0));
    assert.notEqual(snapshot(),first,'煙團／漣漪應隨時間演出');
    assert.deepEqual(bodies.map(s=>[s.x,s.y]),feet,'風吹不搬動物件腳點');
    if(lite)assert.deepEqual(bodies.map(s=>s.skew.x),skew,'簡化模式省略枝葉擺動');
    else assert.notDeepEqual(bodies.map(s=>s.skew.x),skew,'枝葉應有輕微擺動');
    decor.setMotionEnabled(false);const paused=snapshot(),clock=decor.stats().motionTime;
    decor.update(view(0,0));assert.equal(snapshot(),paused);assert.equal(decor.stats().motionTime,clock);
    decor.setMotionEnabled(true);decor.setVisible(false);decor.update(view(0,0));
    assert.equal(decor.stats().motionTime,clock);assert.ok(local().every(s=>!s.visible));
    decor.setVisible(true);decor.update({...view(0,0),dt:0});assert.equal(snapshot(),paused,'遊戲dt=0同樣凍結');
    for(const key of Object.keys(BattleDecor.KITS).filter(Boolean))for(const current of [1,11]){
      decor.setScene(key,current);decor.update(view(0,0));
      assert.ok(decor.stats().localParticles <= (lite?2:18),key+' 局部粒子超限');
    }
    decor.destroy();assert.equal(P.alive(),0,'包含局部粒子的全部節點均釋放');
  }
});

test('DECOR-5 每 10 個階段換一帶：單數帶地表、雙數帶地下，地下的地板會壓暗', () => {
  const { BattleDecor } = loadDecor();
  const P = fakePixi();
  const { decor, tints } = makeDecor(BattleDecor, P);
  decor.setScene('undead_mountains', 3);
  assert.equal(decor.stats().scene, 'undead_mountains');
  assert.equal(tints[tints.length - 1], BattleDecor.KITS.undead_mountains.tint);
  decor.setScene('undead_mountains', 14);
  assert.equal(decor.stats().scene, 'undead_mountains#deep');
  assert.equal(tints[tints.length - 1], BattleDecor.KITS.undead_mountains.deepTint);
  assert.notEqual(BattleDecor.KITS.undead_mountains.deepTint, 0xffffff);
  decor.setScene('undead_mountains', 21);
  assert.equal(decor.stats().scene, 'undead_mountains');
  // 不認得的地圖退回預設組合，不會整個不見
  decor.setScene('no_such_zone', 1);
  assert.equal(decor.stats().scene, '');
});

test('DECOR-6 高塔戰隱藏：setVisible(false) 會把三層與擺件都藏起來', () => {
  const { BattleDecor } = loadDecor();
  const P = fakePixi();
  const { decor, layers } = makeDecor(BattleDecor, P);
  decor.setScene('Icefield', 1);
  decor.update(view(0, 0));
  decor.setVisible(false);
  assert.equal(layers.decal.visible, false);
  assert.equal(layers.ambient.visible, false);
  assert.ok(layers.prop.children.length > 0);
  assert.ok(layers.prop.children.every((s) => s.visible === false));
  // 隱藏期間鏡頭移動產生的新區塊也要是藏著的
  decor.update(view(30000, 4000));
  assert.ok(layers.prop.children.length > 0);
  assert.ok(layers.prop.children.every((s) => s.visible === false), '隱藏期間新產生的擺件不該顯示');
  decor.setVisible(true);
  assert.ok(layers.prop.children.every((s) => s.visible === true));
});

test('DECOR-7 ?decor=0 整個關掉（A/B 對照用），不建立任何節點', () => {
  const { BattleDecor } = loadDecor({ location: { search: '?decor=0' } });
  const P = fakePixi();
  const { decor, layers } = makeDecor(BattleDecor, P);
  assert.equal(decor.enabled, false);
  decor.setScene('desert', 1);
  decor.update(view(0, 0));
  assert.equal(layers.prop.children.length + layers.decal.children.length + layers.ambient.children.length, 0);
});

test('DECOR-8 渲染器接線：地面平面在地板與暗角之間、天氣層在場景之上，擺件放進實體層', () => {
  const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
  const { buildSceneTree } = require('./helpers/battle-scene.cjs');
  const S = buildSceneTree(renderer);
  const L = S.layers;
  const bg = S.sceneRoot.children[0];
  const plane = bg.children.indexOf(L.decorPlane);
  assert.ok(plane > 0, '地面裝飾平面要在地板之後');
  assert.ok(plane < bg.children.indexOf(S.vignette), '地面裝飾平面要在暗角之前（暗角蓋在裝飾上面）');
  assert.equal(L.decorPlane.scale.y, Number(/var GROUND_Y_SCALE = ([0-9.]+);/.exec(renderer)[1]));
  const stage = S.app.stage.children;
  assert.ok(stage.indexOf(L.decorAmbient) > stage.indexOf(S.sceneRoot));
  assert.ok(stage.indexOf(L.decorAmbient) < stage.indexOf(L.airBack));
  assert.match(renderer, /propLayer: S\.layers\.entity/);
  /* 魔王戰期間藏起來；改由轉場全黑那一刻切（js/battle-renderer.js applySceneSwitch），不跟著 towerActive 立刻切 */
  assert.match(renderer, /if \(S\.decor\) S\.decor\.setVisible\(!tv\);/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.indexOf('js/battle-decor.js?v=') > 0 && html.indexOf('js/battle-decor.js?v=') < html.indexOf('js/battle-renderer.js?v='),
    'battle-decor.js 要在 battle-renderer.js 之前載入');
});

test('DECOR-9 圖集分段建造：換場景不會一次畫完卡住，畫好前不擺東西，另一個階段帶在背景預建、之後換帶立即就緒', () => {
  const { BattleDecor } = loadDecor();
  const P = fakePixi();
  // 預算 0：每次 update 只畫一張（至少一張），模擬實機的時間切片
  const { decor, layers, tints } = makeDecor(BattleDecor, P, { build: 0, prebuild: 0.0001 });
  decor.setScene('desert', 1);
  // 場景與地板色調在 setScene 當下就決定（不必等圖集）
  assert.equal(decor.stats().scene, 'desert');
  assert.equal(tints[tints.length - 1], BattleDecor.KITS.desert.tint);
  assert.equal(decor.stats().ready, false);
  decor.update(view(0, 0));
  assert.equal(decor.stats().ready, false, '一幀不該把整張圖集畫完');
  assert.equal(layers.prop.children.length, 0, '圖集還沒畫好之前不擺任何擺件');
  let frames = 1;
  while (!decor.stats().ready && frames < 500) { decor.update(view(0, 0)); frames++; }
  assert.ok(decor.stats().ready, '分段畫完之後要就緒');
  assert.ok(frames > 10, '應該分好幾幀畫完，實際 ' + frames + ' 幀');
  assert.ok(layers.prop.children.length > 0);
  // 就緒後背景預建地下版；畫完之後換到地下帶，當下就緒、不用再等
  let guard = 0;
  while (decor.stats().cached.indexOf('desert#deep') < 0 && guard < 800) { decor.update(view(0, 0)); guard++; }
  assert.ok(decor.stats().cached.indexOf('desert#deep') >= 0, '地下版應該在背景預建好');
  decor.setScene('desert', 12);
  assert.equal(decor.stats().scene, 'desert#deep');
  assert.equal(decor.stats().ready, true, '預建過的階段帶，換過去當下就緒');
  // 換到別張地圖：圖集要重畫，畫好前不顯示上一張地圖的擺件
  decor.setScene('swamp', 1);
  assert.equal(decor.stats().ready, false);
  assert.equal(layers.prop.children.length, 0);
});

test('DECOR-10 浮雕打光：光從左上，球體左上半比右下半亮；外輪廓描深色邊；切面與材質色階有色相偏移', () => {
  const { DecorSculpt } = loadDecor();
  const S = new DecorSculpt.Sculpt(40, 40, 1, null);
  const mat = { color: '#8a8a8a' };
  S.ellipsoid(20, 20, 14, 14, 0, mat, { rz: 14 });
  const out = S.render(null, { ao: 0, footAO: 0 });
  // 回傳的是圖元掃過的框，座標要扣掉框的左上角；框外視為透明
  const px = (x, y) => {
    const lx = x - out.x, ly = y - out.y;
    if (lx < 0 || ly < 0 || lx >= out.w || ly >= out.h) return [0, 0, 0, 0];
    const o = (ly * out.w + lx) * 4;
    return [out.data[o], out.data[o + 1], out.data[o + 2], out.data[o + 3]];
  };
  const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  assert.ok(lum(px(14, 14)) > lum(px(26, 26)) + 40, '左上要比右下亮');
  assert.equal(px(2, 2)[3], 0, '球外是透明的');
  assert.ok(px(20, 20)[3] === 255, '球內不透明');
  // 最外圈（描邊）比內側一點的同方向像素暗
  assert.ok(lum(px(6, 20)) < lum(px(9, 20)), '外輪廓要描深色邊');
  // 色階：暗部偏冷（藍多於紅）、亮部偏暖（紅多於藍）——灰色原色才看得出偏移
  const lut = DecorSculpt._internals.buildLut({ color: '#808080' });
  const dark = [lut[3 * 4], lut[3 * 4 + 1], lut[3 * 4 + 2]], light = [lut[60 * 3], lut[60 * 3 + 1], lut[60 * 3 + 2]];
  assert.ok(dark[2] >= dark[0], '暗部偏冷');
  assert.ok(light[0] >= light[2], '亮部偏暖');
});

test('DECOR-11 場景只引用自製素材，小物件程序繪製、大型物件使用完整AI圖', () => {
  for (const f of ['js/decor-sculpt.js', 'js/decor-nature.js', 'js/battle-decor.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(src, /RPG ?Maker_MV|MyGame[\/]+Asset/i, f + ' 不該指向第三方素材庫');
  }
  const {ctx}=loadDecor();
  for(const file of Object.values(ctx.DecorNature.spriteFiles)){
    const png=fs.readFileSync(path.join(root,'images/scene',file+'.png'));
    assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png[25],6,'RGBA素材保留alpha');
    assert.ok(png.readUInt32BE(16)<=512&&png.readUInt32BE(20)<=512,'正式素材有尺寸上限');
  }
});

test('DECOR-NATURE-1 每張地圖的直立物件都有獨立接觸區，苔沼接入蕨葉、倒木、根系與落葉', () => {
  const { BattleDecor } = loadDecor();
  for (const zone of Object.keys(BattleDecor.KITS).filter(Boolean)) {
    for (const deep of [false, true]) {
      const plan = BattleDecor._internals.planAtlas(zone, deep);
      const props = plan.specs.filter(s => s.kind === 'prop');
      assert.equal(plan.specs.filter(s => s.kind === 'contact').length, props.length);
      for (const p of props) {
        const foot = plan.specs.find(s => s.key === 'foot_' + p.key);
        assert.equal(foot.propW, p.w);
        assert.equal(foot.natureStyle.moss, zone === 'swamp');
        assert.equal(foot.natureStyle.snow, zone === 'Icefield');
        assert.ok(foot.w > p.w && foot.h > p.w * .5, '接觸區必須容納漸隱留白');
        if (p.type === 'rock') assert.equal(p.nature, true, '各地圖岩石都走新版風化畫法');
      }
      assert.ok(plan.specs.some(s => s.type === 'litter'), '每張地圖都要有地貌碎屑');
      if (zone === 'swamp') {
        for (const type of ['fern', 'log', 'roots', 'puddle']) assert.ok(plan.specs.some(s => s.type === type && s.nature), type);
      }
    }
  }
});

test('DECOR-NATURE-2 地面接觸區與本體同腳點、倍率與翻面，透視抵銷只作用於本體；回收重返仍配對', () => {
  const { BattleDecor } = loadDecor();
  const P = fakePixi(), layers = { decal: new P.Container(), light: new P.Container(), prop: new P.Container() };
  const decor = BattleDecor.create({ PIXI: P.PIXI, groundScale: .5, decalLayer: layers.decal, lightLayer: layers.light, propLayer: layers.prop,
    billboard: () => ({w: .83, shear: .17, skew: Math.atan2(.17,.83), k: Math.hypot(.17,.83)}), buildBudgetMs: Infinity, prebuildBudgetMs: 0 });
  for (const [zone, stage] of [['swamp',1],['desert',1],['swamp',1],['Icefield',11],['swamp',1]]) {
    decor.setScene(zone, stage);
    for (const x of [0,20000,0]) {
      decor.update(view(x,0));
      for (const p of layers.prop.children.filter(s => s._decorGround)) {
        const floor = p._decorGround;
        assert.equal(floor.parent, layers.decal, '接觸區必須在地面層');
        assert.equal(floor.x, p.x);
        assert.equal(floor.y * .5, p.y);
        assert.equal(floor.scale.x, p._bbX);
        assert.equal(floor.scale.y, p._bbY);
        assert.equal(floor.skew.x,0,'地面不可套 billboard 斜切');
        assert.ok(Math.abs(p.scale.y-p._bbY*Math.hypot(.17,.83))<1e-10);
        assert.equal(floor.anchor.x,.5);
        assert.equal(floor.anchor.y,.5);
      }
    }
  }
  const p = layers.prop.children.find(s=>s._decorGround);
  assert.ok(p);
  const v=view(0,0);v.playerX=p.x;v.playerScreenY=p.y-1;
  decor.update(v);
  assert.ok(p.alpha<1,'遮住玩家時本體仍淡出');
  assert.equal(p._decorGround.alpha,1,'地面接觸區不隨物件遮擋而闪爍');
  decor.setVisible(false);
  assert.equal(layers.decal.visible,false);
  assert.ok(layers.prop.children.every(s=>!s.visible));
  decor.setVisible(true);
  assert.equal(layers.decal.visible,true);
  decor.destroy();
  assert.equal(layers.decal.children.length,0);
  assert.equal(layers.prop.children.length,0);
  assert.equal(P.alive(),0);
});

test('DECOR-NATURE-3 主頁、圖集 Worker 與開發工具載入同版原創畫法與 Decor', () => {
  const read = f => fs.readFileSync(path.join(root,f),'utf8');
  const html=read('index.html'), worker=read('js/worker/decor-atlas.worker.js'), tool=read('tools/decor-preview.html');
  for (const file of ['decor-nature','battle-decor']) {
    const token=html.match(new RegExp('js/'+file+'\\.js\\?v=([^"\\s]+)'))[1];
    assert.ok(worker.includes('../'+file+'.js?v='+token), file+' Worker 快取不同步');
    assert.ok(tool.includes('../js/'+file+'.js?v='+token),file+' 預覽工具快取不同步');
  }
  assert.ok(html.indexOf('js/decor-nature.js?v=')<html.indexOf('js/battle-decor.js?v='));
  assert.ok(worker.indexOf('../decor-nature.js?v=')<worker.indexOf('../battle-decor.js?v='));
});

test('DECOR-BB 透視抵銷（opts.billboard）：擺件與火焰被抵銷後 Pixi 的 anchor 仍完好，切地圖重用物件池也不拋例外', () => {
  /* 2026-10-04 實際事故：火焰掛在火盆上的屬性取名 _anchor，撞到 Pixi Sprite 內部的 _anchor（anchor 的底層），
     下次從物件池取出火焰做 anchor.set 就拋例外，tickWorld 死掉、整個戰鬥畫面凍住（切回去過的地圖最容易踩到）。 */
  const { BattleDecor } = loadDecor();
  const P = fakePixi();
  const layers = { decal: new P.Container(), light: new P.Container(), prop: new P.Container(), ambient: new P.Container() };
  const shear = 0.2, w = 0.9;
  const decor = BattleDecor.create({
    PIXI: P.PIXI, groundScale: 0.5,
    decalLayer: layers.decal, lightLayer: layers.light, propLayer: layers.prop, ambientLayer: layers.ambient,
    billboard: () => ({ w, shear, skew: Math.atan2(shear, w), k: Math.hypot(shear, w) }),
    buildBudgetMs: Infinity, prebuildBudgetMs: 0
  });
  let flames = 0, props = 0;
  for (const [zone, stage] of [['desert', 1], ['swamp', 5], ['desert', 1], ['Icefield', 11], ['desert', 1], ['undead_mountains', 21], ['desert', 1]]) {
    decor.setScene(zone, stage);
    for (let x = 0; x < 30000; x += 53) {
      decor.update(view(x, Math.sin(x / 2000) * 1500));
      for (const s of layers.prop.children) {
        assert.equal(typeof s.anchor.set, 'function', zone + '：擺件的 anchor 被蓋掉了（自訂屬性撞到 Pixi 內部欄位）');
        assert.ok(s.anchor.x !== undefined, 'anchor 要是點座標');
        if (s._bbParent) flames++; else props++;
      }
    }
  }
  assert.ok(props > 50, '要真的跑到擺件');
  assert.ok(flames > 0, '要真的跑到火焰（火盆在某些地圖才有），不然測不到零件');
  /* 抵銷真的有套上：本體 skew／縮放乘上 k，火焰位置經過同一個矩陣 */
  const prop = layers.prop.children.find((s) => s._bbParent === undefined && s._bbX !== undefined);
  assert.ok(Math.abs(prop.skew.x - Math.atan2(shear, w)) < 1e-12);
  assert.ok(Math.abs(prop.scale.y - prop._bbY * Math.hypot(shear, w)) < 1e-12);
  const flame = layers.prop.children.find((s) => s._bbParent);
  if (flame) {
    assert.ok(Math.abs(flame.x - (flame._bbParent.x + shear * flame._bbOffY)) < 1e-9, '火焰 x 跟著火盆的矩陣');
    assert.ok(Math.abs(flame.y - (flame._bbParent.y + w * flame._bbOffY)) < 1e-9, '火焰 y 跟著火盆的矩陣');
  }
});
