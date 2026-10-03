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
    constructor(tex) { super(); alive++; this.texture = tex; this.anchor = point(); this.scale = point(); this.alpha = 1; this.tint = 0xffffff; this.rotation = 0; this.skew = { x: 0 }; }
    destroy() { alive--; this.destroyed = true; if (this.parent) this.parent.removeChild(this); }
  }
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
  const snap = () => layers.prop.children.map((s) => s.x.toFixed(2) + ',' + s.y.toFixed(2)).sort().join('|');
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

test('DECOR-11 裝飾美術全部執行期程序化產生：不載入任何圖檔（AI_RULES.md 第二原則：外部素材只參考、不直接使用）', () => {
  for (const f of ['js/decor-sculpt.js', 'js/battle-decor.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(src, /\.(png|jpe?g|webp|gif)['"?]/i, f + ' 不該引用圖檔');
    assert.doesNotMatch(src, /new Image\(|Assets\.load|fetch\(/, f + ' 不該在執行期載入外部資源');
    assert.doesNotMatch(src, /RPG ?Maker_MV|MyGame[\/]+Asset/i, f + ' 不該指向第三方素材庫');
  }
});
