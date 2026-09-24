const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction, groundDecls, fakePixi } = require('./helpers/battle-scene.cjs');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');

/* ============================================================
   戰鬥畫面的輕微透視（js/battle-renderer.js 的 PERSPECTIVE_TOP_SCALE，2026-09-22）

   斜俯視是平行投影，遠近的地磚一樣大。使用者比對示意圖量出上下兩塊地磚寬差 5%、高差 18%，
   看過三種強度的並排比較後選「畫面上緣 ×0.82」。作法是後製：場景照平行投影畫進離屏貼圖，
   再用 PerspectiveMesh 做一次單應變換貼到畫面（見 battle-renderer 的「輕微透視」一節）。
   會讓它「安靜地畫錯」的：
     ① 變形公式錯——中心（角色）跟著移動或縮放、水平線變斜、上緣縮放不是設定值。
     ② 離屏範圍不夠——畫布角落取樣到貼圖外面，露出一塊空白（原型第一版就發生過）。
     ③ 開關兩條路徑的場景結構錯——場景同時掛在 stage 上又畫進貼圖（畫兩次），或都沒有。
   ============================================================ */

const TOP = Number(/var PERSPECTIVE_TOP_SCALE = ([0-9.]+);/.exec(renderer)[1]);

function loadLayout() {
  const c = { Math };
  vm.createContext(c);
  vm.runInContext(extractFunction(renderer, 'perspectiveLayout'), c);
  return c.perspectiveLayout;
}
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, msg + '：' + a + ' ≠ ' + b);

test('PERSP-1 上緣縮放是使用者選定的 0.82；排在 tickWorld 之後、Application render 之前', () => {
  assert.equal(TOP, 0.82);
  const pri = Number(/var PERSPECTIVE_RENDER_PRIORITY = (-?[0-9]+);/.exec(renderer)[1]);
  assert.ok(pri < 0 && pri > -25, 'NORMAL（0）之後、LOW（−25）之前：' + pri);
  assert.match(renderer, /app\.ticker\.add\(renderPerspectiveScene, null, PERSPECTIVE_RENDER_PRIORITY\)/);
});

test('PERSP-2 變形公式：中心不動且縮放為 1、水平線保持水平、上緣橫向縮放＝設定值、橫向縮放往下遞增', () => {
  const layout = loadLayout();
  for (const [W, H] of [[670, 731], [670, 1860], [1400, 500]]) {
    const L = layout(W, H, TOP);
    const c = L.project(W / 2, H / 2);
    near(c.x, W / 2, 1e-9, '中心 x'); near(c.y, H / 2, 1e-9, '中心 y');
    /* 中心附近的局部縮放＝1（角色不變形） */
    const dx = L.project(W / 2 + 1, H / 2).x - W / 2, dy = L.project(W / 2, H / 2 + 1).y - H / 2;
    near(dx, 1, 1e-3, '中心橫向縮放'); near(dy, 1, 1e-3, '中心縱向縮放');
    /* 水平線保持水平：同一列的點投影後 y 相同 */
    for (const y of [0, H / 3, H]) near(L.project(0, y).y, L.project(W, y).y, 1e-9, '第 ' + y + ' 列要水平');
    /* 平行投影畫面上緣那一列（t = −cy）的橫向縮放＝設定值 */
    const a = L.project(0, 0), b = L.project(W, 0);
    near((b.x - a.x) / W, TOP, 1e-9, '上緣橫向縮放');
    /* 越往下越大（近大遠小） */
    const s = (y) => (L.project(W, y).x - L.project(0, y).x) / W;
    assert.ok(s(0) < s(H / 2) && s(H / 2) < s(H), '橫向縮放要往下遞增');
  }
});

test('PERSP-3 離屏範圍夠大：畫布上每一點反推回去都落在離屏貼圖裡（角落不會露白）', () => {
  const layout = loadLayout();
  for (const [W, H] of [[670, 731], [670, 1860], [1400, 500], [300, 900]]) {
    const L = layout(W, H, TOP);
    /* 反推：t' = y' − cy → t = t' / (1 + β·t')，w = 1 − β·t，x = cx + (x' − cx)·w */
    const inv = (xs, ys) => {
      const tp = ys - L.cy, t = tp / (1 + L.beta * tp), w = 1 - L.beta * t;
      return { x: L.cx + (xs - L.cx) * w, y: L.cy + t };
    };
    for (let i = 0; i <= 10; i++) {
      for (let j = 0; j <= 10; j++) {
        const p = inv(W * i / 10, H * j / 10);
        assert.ok(p.x >= L.x0 && p.x <= L.x0 + L.width && p.y >= L.y0 && p.y <= L.y0 + L.height,
          W + '×' + H + ' 畫布點 (' + (W * i / 10) + ',' + (H * j / 10) + ') 反推到 (' + p.x.toFixed(1) + ',' + p.y.toFixed(1) +
          ')，超出離屏範圍 x[' + L.x0 + ',' + (L.x0 + L.width) + '] y[' + L.y0 + ',' + (L.y0 + L.height) + ']');
        /* 反推要真的是 project 的反函數 */
        const back = L.project(p.x, p.y);
        near(back.x, W * i / 10, 1e-6, '反推 x'); near(back.y, H * j / 10, 1e-6, '反推 y');
      }
    }
    /* 網格四角＝離屏範圍四角的投影 */
    const want = [[L.x0, L.y0], [L.x0 + L.width, L.y0], [L.x0 + L.width, L.y0 + L.height], [L.x0, L.y0 + L.height]];
    want.forEach(([x, y], k) => { const q = L.project(x, y); near(L.corners[k].x, q.x, 1e-9, '角 ' + k); near(L.corners[k].y, q.y, 1e-9, '角 ' + k); });
  }
});

function loadSync(topScaleSrc) {
  const { Container } = fakePixi;
  const stage = new Container();
  const sceneRoot = new Container();
  const overlay = new Container();
  stage.addChild(sceneRoot); stage.addChild(overlay);
  const c = {
    Math, Number, isFinite, PIXI: fakePixi,
    S: { app: { stage, renderer: { resolution: 2 } }, sceneRoot, W: 670, H: 731, persp: null, vignette: null },
    vignetteTexture: () => ({ id: 'flat-vignette' })
  };
  vm.createContext(c);
  let src = renderer;
  if (topScaleSrc) src = src.replace(/var PERSPECTIVE_TOP_SCALE = [0-9.]+;/, 'var PERSPECTIVE_TOP_SCALE = ' + topScaleSrc + ';');
  const decl = (name) => /^ *var PERSPECTIVE_[A-Z_]+ = [^;\n]+;/gm;
  vm.runInContext(src.match(decl()).join('\n') + '\n' + ['perspectiveDisabledByQuery', 'perspectiveTopScale', 'perspectiveLayout',
    'syncPerspective'].map((n) => extractFunction(src, n)).join(';'), c);
  return { c, stage, sceneRoot, overlay };
}

test('PERSP-4 開著：場景不掛 stage（只畫進貼圖）、網格在 overlay 底下、貼圖開 MSAA 且跟著解析度；尺寸變了就重建', () => {
  const { c, stage, sceneRoot, overlay } = loadSync();
  c.syncPerspective();
  const P = c.S.persp;
  assert.ok(P && P.mesh && P.rt, '要建出貼圖與網格');
  assert.equal(sceneRoot.parent, null, '場景不能同時掛在 stage 上（會畫兩次）');
  assert.deepEqual(stage.children.map((n) => n === P.mesh ? 'mesh' : n === overlay ? 'overlay' : '?'), ['mesh', 'overlay']);
  assert.equal(P.rt.antialias, true, '場景原本畫在開了 MSAA 的畫布上');
  assert.equal(P.rt.resolution, 2);
  assert.deepEqual([sceneRoot.x, sceneRoot.y], [-P.layout.x0, -P.layout.y0], '貼圖 (0,0) 對應離屏範圍左上角');
  assert.equal(P.mesh.corners.length, 8);
  const firstRt = P.rt;
  c.syncPerspective();
  assert.equal(c.S.persp.rt, firstRt, '尺寸沒變不重建');
  c.S.W = 900; c.syncPerspective();
  assert.notEqual(c.S.persp.rt, firstRt, '尺寸變了要重建');
  assert.ok(firstRt.destroyed, '舊貼圖要釋放');
  assert.equal(stage.children.filter((n) => n instanceof fakePixi.PerspectiveMesh).length, 1, '網格只能有一個');
});

test('PERSP-5 關掉（PERSPECTIVE_TOP_SCALE = 1）：場景直接掛回 stage 最底層、位置歸零，不建貼圖', () => {
  const { c, stage, sceneRoot, overlay } = loadSync('1');
  c.syncPerspective();
  assert.equal(c.S.persp, null);
  assert.deepEqual(stage.children, [sceneRoot, overlay]);
  assert.deepEqual([sceneRoot.x, sceneRoot.y], [0, 0]);
});

/* perspective: false 的圖層（2026-09-24 使用者要求的每層勾選）在場景層裡就地把透視抵銷掉。
   會讓它安靜地畫錯的：補償乘錯軸（橫向 w、縱向 w²，寫反了圖會變胖或變瘦）、
   對有旋轉的圖層直接乘在 scaleX／scaleY 上（圖會被轉歪）、把沒標的圖層也一起改到。 */
test('PERSP-6 perspective: false 就地抵銷：補償後再經過網格＝作者畫的矩陣，位置不動', () => {
  const L = loadLayout()(670, 731, TOP);
  const c = { Math, Object, VFXCore: require('../js/vfx-core.js'),
    S: { persp: { layout: L }, layers: { world: { x: 0, y: 0 } } } };
  vm.createContext(c);
  vm.runInContext(extractFunction(renderer, 'projectSceneTransform'), c);
  const mat = (t) => [Math.cos(t.rotation) * t.scaleX, Math.sin(t.rotation) * t.scaleX,
    -Math.sin(t.rotation - (t.skewX || 0)) * t.scaleY, Math.cos(t.rotation - (t.skewX || 0)) * t.scaleY];
  for (const y of [40, 365, 700]) {
    const w = 1 - L.beta * (y - L.cy);
    for (const [rot, sx, sy, sk] of [[0, 1, 1, 0], [0.7, 2, 0.5, 0], [-1.2, 0.8, 1.4, 0.3]]) {
      const t = { x: 300, y: y, rotation: rot, scaleX: sx, scaleY: sy, skewX: sk, perspective: false };
      const out = c.projectSceneTransform(t);
      const m = mat(out), want = mat(t);
      /* 網格在該點的局部縮放：橫向 1/w、縱向 1/w²。補償過的矩陣再經過它，要回到原本那一個 */
      [m[0] / w, m[1] / (w * w), m[2] / w, m[3] / (w * w)].forEach((v, i) =>
        near(v, want[i], 1e-9, 'y=' + y + ' rot=' + rot + ' 矩陣第 ' + i + ' 項'));
      assert.equal(out.x, t.x, '位置不動：那一層仍要待在它該在的地方');
      assert.equal(out.y, t.y);
    }
    /* procedural 的 width／height 會蓋掉 scale，要照同一組比例補 */
    const tile = c.projectSceneTransform({ x: 0, y: y, rotation: 0, scaleX: 1, scaleY: 1,
      width: 256, height: 128, perspective: false });
    near(tile.width / w, 256, 1e-9, 'width'); near(tile.height / (w * w), 128, 1e-9, 'height');
  }
});

test('PERSP-7 沒標的圖層、關掉透視、隱藏用的 transform 都原樣回傳（不配置也不算數）', () => {
  const L = loadLayout()(670, 731, TOP);
  const c = { Math, Object, VFXCore: require('../js/vfx-core.js'),
    S: { persp: { layout: L }, layers: { world: { x: 0, y: 0 } } } };
  vm.createContext(c);
  vm.runInContext(extractFunction(renderer, 'projectSceneTransform'), c);
  const on = { x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1, perspective: true };
  assert.equal(c.projectSceneTransform(on), on, '沒標的要原樣回傳，逐幀逐節點不能多配置物件');
  assert.equal(c.projectSceneTransform({ visible: false }).visible, false, '隱藏用的 transform 不得出錯');
  c.S.persp = null;                                   // ?persp=0：本來就沒有變形可抵銷
  const off = { x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1, perspective: false };
  assert.equal(c.projectSceneTransform(off), off);
});

test('PERSP-8 接線：場景的兩個後端都吃 projectSceneTransform，空中／billboard 各走自己那一套', () => {
  assert.match(renderer, /projectSceneTransform: projectSceneTransform/, 'boot 要把補償函式交出去');
  const runtime = fs.readFileSync(path.join(root, 'js/vfx-runtime.js'), 'utf8');
  const boot = runtime.slice(runtime.indexOf('fxBackend: VFXPixiBackend.createBackend'),
    runtime.indexOf('ctx: opts.ctx'));
  assert.equal((boot.match(/projectTransform: opts\.projectSceneTransform/g) || []).length, 2,
    'fx 與 zone 兩個後端都要接上');
  assert.match(boot, /projectTransform:opts\.projectAirTransform/, '空中層仍走自己的投影');
  assert.match(boot, /projectTransform:opts\.projectBillboardTransform/, 'billboard 層仍走自己的投影');
});
