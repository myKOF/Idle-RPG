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

test('PERSP-ORB 球心共享遠近倍率：左右上下、鏡頭平移與 FOV 改變仍保持圓形電弧輪廓', () => {
  const c = { Math, Object, isFinite, S: { layers: { world: { x: -100, y: 40 } } } };
  vm.createContext(c);
  for (const name of ['airScreenPose', 'projectedWarp', 'depthScaleOf', 'projectAirTransform', 'projectBillboardTransform'])
    vm.runInContext(extractFunction(renderer, name), c);
  let oldDistortion = 0;
  for (const top of [.6, TOP, 1]) for (const [x, y] of [[120, 100], [600, 100], [120, 600], [600, 600], [335, 365]]) {
    c.S.persp = { layout: loadLayout()(670, 731, top) };
    const centre = c.airScreenPose(x, y), radius = 30;
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8;
      const t = { x: x + Math.cos(a) * radius, y: y + Math.sin(a) * radius,
        sortY: y, scaleX: 2, scaleY: 2 };
      const out = c.projectBillboardTransform(t);
      near(Math.hypot(out.x - centre.x, out.y - centre.y), radius * centre.scale, 1e-8, '電弧距球心等距');
      near(out.scaleX, 2 * centre.scale, 1e-9, '每顆粒子共享球心倍率');
      near(out.scaleY, out.scaleX, 1e-9, '粒子本身等比');
      const old = c.projectAirTransform(t);
      oldDistortion = Math.max(oldDistortion, Math.abs(Math.hypot(old.x - centre.x, old.y - centre.y) - radius * centre.scale));
    }
  }
  assert.ok(oldDistortion > 5, '舊逐粒子投影確實會拉歪球形，測試必須涵蓋可見差異');
  c.S.persp = null;
  const off = c.projectBillboardTransform({ x: 160, y: 70, sortY: 50, scaleX: 1, scaleY: 1 });
  assert.equal(off.x, 60); assert.equal(off.y, 110); assert.equal(off.scaleX, 1);
});

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
      const t = { x: 300, y: y, rotation: rot, scaleX: sx, scaleY: sy, skewX: sk,
        perspective: false, cameraDepth: false };   // 兩個都關＝畫面上維持作者畫的矩陣（見 PERSP-11）
      const out = c.projectSceneTransform(t);
      const m = mat(out), want = mat(t);
      /* 網格在該點的局部線性部分（含斜切）：J = [[1/w, β(X−cx)/w²], [0, 1/w²]]。
         補償過的矩陣再經過它，要回到作者畫的那一個。 */
      const sh = L.beta * (t.x - L.cx) / (w * w);
      [m[0] / w + sh * m[1], m[1] / (w * w), m[2] / w + sh * m[3], m[3] / (w * w)].forEach((v, i) =>
        near(v, want[i], 1e-9, 'y=' + y + ' rot=' + rot + ' 矩陣第 ' + i + ' 項'));
      assert.equal(out.x, t.x, '位置不動：那一層仍要待在它該在的地方');
      assert.equal(out.y, t.y);
    }
    /* procedural 的 width／height 會蓋掉 scale，要照同一組比例補 */
    const tile = c.projectSceneTransform({ x: 0, y: y, rotation: 0, scaleX: 1, scaleY: 1,
      width: 256, height: 128, perspective: false, cameraDepth: false });
    near(tile.width / w, 256, 1e-9, 'width'); near(tile.height / (w * w), 128, 1e-9, 'height');
    /* 只關形變（預設仍受遠近影響）：畫面上是作者的矩陣再乘遠近倍率 1/w */
    const depth = c.projectSceneTransform({ x: 0, y: y, rotation: 0, scaleX: 1, scaleY: 1,
      width: 256, height: 128, perspective: false });
    near(depth.width / w, 256 / w, 1e-9, 'width 保留遠近'); near(depth.height / (w * w), 128 / w, 1e-9, 'height 保留遠近');
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

test('PERSP-9 NPC 只吃遠近縮放：抵銷矩陣經過網格之後是等比縮放、零斜切、不變形', () => {
  /* 2026-09-29 使用者：場景中的 NPC 與牠的血條、文字不要被透視扭曲或仰斜，只要遠近縮放。
     NPC 必須留在場景層（前後遮擋），所以是就地抵銷——這條驗「抵銷 × 網格 ＝ 純等比縮放」。 */
  const L = loadLayout()(670, 731, TOP);
  const c = { Math, S: { persp: { layout: L }, layers: { world: { x: -400, y: -120 } } } };
  vm.createContext(c);
  vm.runInContext(extractFunction(renderer, 'sceneBillboardBasis') + extractFunction(renderer, 'applyEntityBillboard'), c);
  const makeEnt = (x, y) => ({
    root: { x, y },
    view: { destroyed: false, skew: { x: 0 }, scale: { x: 1, y: 1, set(a, b) { this.x = a; this.y = (b === undefined ? a : b); } } }
  });
  for (const [rx, ry] of [[0, 0], [600, -300], [-500, 250], [900, 400], [-200, -450]]) {
    const ent = makeEnt(rx, ry);
    c.applyEntityBillboard(ent);
    /* 抵銷矩陣（Pixi，rotation 0）：a = scaleX、b = 0、c = sin(skewX)·scaleY、d = cos(skewX)·scaleY */
    const sk = ent.view.skew.x, sy = ent.view.scale.y;
    const M = [ent.view.scale.x, 0, Math.sin(sk) * sy, Math.cos(sk) * sy];
    /* 網格在該點的局部線性部分：J = [[1/w, β(X−cx)/w²], [0, 1/w²]] */
    const X = rx + c.S.layers.world.x, Y = ry + c.S.layers.world.y;
    const w = 1 - L.beta * (Y - L.cy);
    const J = [1 / w, 0, L.beta * (X - L.cx) / (w * w), 1 / (w * w)];
    /* 乘起來（[a,b,c,d]：x' = a·x + c·y、y' = b·x + d·y） */
    const a = J[0] * M[0] + J[2] * M[1], b = J[1] * M[0] + J[3] * M[1];
    const cc = J[0] * M[2] + J[2] * M[3], d = J[1] * M[2] + J[3] * M[3];
    const s = 1 / w;
    near(a, s, 1e-9, '(' + rx + ',' + ry + ') 橫向縮放＝遠近倍率');
    near(d, s, 1e-9, '縱向縮放要與橫向相同（不被壓扁或拉長）');
    near(b, 0, 1e-9, '不可有縱向斜切');
    near(cc, 0, 1e-9, '不可有橫向斜切（那就是使用者說的「仰斜」）');
  }
  /* 沒開透視：單位矩陣，與加入透視前完全相同 */
  c.S.persp = null;
  const off = makeEnt(300, 200);
  c.applyEntityBillboard(off);
  assert.equal(off.view.skew.x, 0);
  assert.deepEqual([off.view.scale.x, off.view.scale.y], [1, 1]);
});

test('PERSP-10 接線：NPC 的視覺子節點掛在 view 上，每幀與出生時都抵銷；玩家不套（永遠在畫面中心）', () => {
  const enemy = renderer.slice(renderer.indexOf('function makeEnemy(data) {'), renderer.indexOf('function drawHpBar(ent) {'));
  assert.match(enemy, /var view = new PIXI\.Container\(\);\s*\n\s*root\.addChild\(view\);/, 'view 要掛在 root 底下');
  assert.equal((enemy.match(/root\.addChild\(/g) || []).length, 1, 'root 底下只有 view，視覺子節點都要進 view');
  assert.ok((enemy.match(/view\.addChild\(/g) || []).length >= 5, '本體、血條、名字、狀態都在 view 裡');
  assert.match(enemy, /applyEntityBillboard\(ent\);/, '出生那一幀就不能歪');
  const tick = renderer.slice(renderer.indexOf('function tickWorld('));
  assert.match(tick, /e\.root\.zIndex = e\.root\.y \+ \(e\.isBoss \? 1000 : 0\);\s*\n[^\n]*\n\s*applyEntityBillboard\(e\);/,
    '每幀在位置與鏡頭都算完之後抵銷');
  assert.doesNotMatch(tick, /applyEntityBillboard\(p\)/, '玩家永遠在畫面中心，中心點不需要抵銷');
});

test('PERSP-11 兩個旗標各管一件事：畫面透視＝形變，鏡頭遠近＝等比大小（四種組合都對）', () => {
  /* 2026-09-30 使用者要的第四個勾選：「受鏡頭遠近影響」。以角色中心橫線為基準等比縮放，
     不含任何扭曲或旋轉，與「受畫面透視影響」（傾斜與長寬差）分開。 */
  const L = loadLayout()(670, 731, TOP);
  const c = { Math, Object, VFXCore: require('../js/vfx-core.js'),
    S: { persp: { layout: L }, layers: { world: { x: 0, y: 0 } } } };
  vm.createContext(c);
  vm.runInContext(extractFunction(renderer, 'projectSceneTransform'), c);
  const lin = (t) => [Math.cos(t.rotation) * t.scaleX, Math.sin(t.rotation) * t.scaleX,
    -Math.sin(t.rotation - (t.skewX || 0)) * t.scaleY, Math.cos(t.rotation - (t.skewX || 0)) * t.scaleY];
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3]];
  for (const x of [120, 335, 600]) {
    for (const y of [40, 365, 700]) {
      const w = 1 - L.beta * (y - L.cy), s = 1 / w;
      /* 網格在該點的局部線性部分 */
      const J = [1 / w, 0, L.beta * (x - L.cx) / (w * w), 1 / (w * w)];
      for (const [rot, sx, sy, sk] of [[0, 1, 1, 0], [0.7, 2, 0.5, 0], [-1.2, 0.8, 1.4, 0.3]]) {
        const base = { x, y, rotation: rot, scaleX: sx, scaleY: sy, skewX: sk };
        const Lm = lin(base);
        const at = (flags) => mul(J, lin(c.projectSceneTransform(Object.assign({}, base, flags))));
        const want = (m) => (v, i) => near(v, m[i], 1e-9, JSON.stringify({ x, y, rot }) + ' 第 ' + i + ' 項');
        /* 都預設：原樣回傳（逐幀逐節點不能多配置物件） */
        const keep = Object.assign({}, base, { perspective: true, cameraDepth: true });
        assert.equal(c.projectSceneTransform(keep), keep);
        /* 關形變、留遠近：等比 s，沒有傾斜 */
        at({ perspective: false }).forEach(want(Lm.map((v) => v * s)));
        /* 兩個都關：畫面上就是作者畫的那個矩陣 */
        at({ perspective: false, cameraDepth: false }).forEach(want(Lm));
        /* 只關遠近：形變照舊，大小不隨遠近（把 s 抵掉） */
        at({ cameraDepth: false }).forEach(want(mul(J, Lm).map((v) => v * w)));
      }
      /* procedural 的 width／height 走同一組倍率 */
      const tile = c.projectSceneTransform({ x, y, rotation: 0, scaleX: 1, scaleY: 1,
        width: 256, height: 128, perspective: false });
      near(tile.width / w * w, 256, 1e-9, 'width 不再被額外縮放');
      near(tile.height, 128 * w, 1e-9, 'height 只留等比的那一份');
    }
  }
});

test('PERSP-12 空中與 billboard 兩層：關掉鏡頭遠近就維持原尺寸，位置照樣投影', () => {
  const L = loadLayout()(670, 731, TOP);
  const c = { Math, Object, isFinite, Number,
    S: { persp: { layout: L }, layers: { world: { x: -100, y: -60 } } } };
  vm.createContext(c);
  vm.runInContext(['airScreenPose', 'projectedWarp', 'depthScaleOf', 'projectAirTransform', 'projectBillboardTransform']
    .map((n) => extractFunction(renderer, n)).join(';'), c);
  for (const fn of ['projectAirTransform', 'projectBillboardTransform']) {
    const base = { x: 200, y: 500, scaleX: 2, scaleY: 3, width: 40, height: 20 };
    const on = c[fn](Object.assign({}, base));
    const off = c[fn](Object.assign({}, base, { cameraDepth: false }));
    const s = on.scaleX / base.scaleX;
    const wantS = 1 / (1 - L.beta * (base.y + c.S.layers.world.y - L.cy));
    near(s, wantS, 1e-9, fn + '：勾著時就是版面算出來的遠近倍率');
    assert.ok(s > 1, fn + '：畫面下方要放大');
    assert.deepEqual([off.scaleX, off.scaleY, off.width, off.height], [2, 3, 40, 20], fn + '：關掉就維持原尺寸');
    assert.deepEqual([off.x, off.y], [on.x, on.y], fn + '：位置照樣投影到同一點');
  }
});

test('PERSP-13 場景擺件只吃遠近縮放：本體與掛在它上面的零件，經過網格之後是等比縮放、零斜切、相對位置不變', () => {
  /* 2026-10-03 使用者：戰鬥場景物件被透視往畫面中央上方扭曲，要改成只受遠近縮放、不受 FOV 影響。
     擺件（地形擺件、魔王祭壇的門／火盆）與敵人同樣是直立貼圖，用同一個抵銷基底；火焰、魔門的眼睛是零件，
     位置要經過同一個矩陣，否則各自被網格推到別處（火焰飄離碗口、眼睛離開門楣）。 */
  const L = loadLayout()(670, 731, TOP);
  const c = { Math, S: { persp: { layout: L }, layers: { world: { x: -400, y: -120 } } } };
  vm.createContext(c);
  vm.runInContext(extractFunction(renderer, 'sceneBillboardBasis'), c);
  const decor = fs.readFileSync(path.join(root, 'js/battle-decor.js'), 'utf8');
  vm.runInContext(extractFunction(decor, 'billboardSprite'), c);
  const mkSprite = (x, y) => ({ x, y, skew: { x: 0 }, scale: { x: 1, y: 1, set(a, b) { this.x = a; this.y = b; } } });
  /* 網格在螢幕上某一點的局部線性部分，與座標映射本身 */
  const mesh = (x, y) => {
    const X = x + c.S.layers.world.x, Y = y + c.S.layers.world.y, w = 1 - L.beta * (Y - L.cy);
    return [1 / w, 0, L.beta * (X - L.cx) / (w * w), 1 / (w * w)];
  };
  for (const [fx, fy, flip] of [[0, 0, 1], [600, -300, -1], [-500, 250, 1], [900, 400, -1], [-200, -450, 1]]) {
    const prop = mkSprite(fx, fy);
    c.billboardSprite(prop, c.sceneBillboardBasis, 0.7 * flip, 0.7);
    const sk = prop.skew.x, sy = prop.scale.y;
    const M = [prop.scale.x, 0, Math.sin(sk) * sy, Math.cos(sk) * sy];
    const J = mesh(fx, fy);
    const s = 1 / (1 - L.beta * (fy + c.S.layers.world.y - L.cy));   // 遠近倍率 1/w
    const a = J[0] * M[0] + J[2] * M[1], d = J[1] * M[2] + J[3] * M[3], cc = J[0] * M[2] + J[2] * M[3];
    near(a, 0.7 * flip * s, 1e-9, '(' + fx + ',' + fy + ') 橫向＝貼圖縮放 × 遠近倍率（翻面維持）');
    near(d, 0.7 * s, 1e-9, '縱向與橫向同倍率，不壓扁也不拉長');
    near(cc, 0, 1e-9, '不可有橫向斜切（往中央上方歪）');
    near(J[1] * M[0] + J[3] * M[1], 0, 1e-9, '不可有縱向斜切');
    /* 零件：位移相對錨點腳底，與本體同一個矩陣；沿本體的「上」軸往上 oy，網格之後仍在正上方 */
    const part = mkSprite(0, 0);
    c.billboardSprite(part, c.sceneBillboardBasis, 0.5, 0.5, prop, 12, -90);
    const b = c.sceneBillboardBasis(fx, fy);
    near(part.x, fx + 12 + b.shear * -90, 1e-9, '零件 x 經過同一個矩陣');
    near(part.y, fy + b.w * -90, 1e-9, '零件 y 經過同一個矩陣');
    near(part.skew.x, prop.skew.x, 1e-12, '零件與本體同傾角');
    /* 本體貼圖上對應腳底位移 (12, −90) 的那一點（除以本體縮放換成貼圖座標），抵銷後的位置要與零件重合 */
    const u = 12 / (0.7 * flip), v = -90 / 0.7;
    near(fx + M[0] * u + M[2] * v, part.x, 1e-6, '零件 x 與本體上同一點重合');
    near(fy + M[1] * u + M[3] * v, part.y, 1e-6, '零件 y 與本體上同一點重合');
  }
  /* 沒開透視：與加入前完全相同（零件位置＝錨點＋位移，沒有斜切） */
  c.S.persp = null;
  const prop = mkSprite(300, 200), part = mkSprite(0, 0);
  c.billboardSprite(prop, c.sceneBillboardBasis, 0.7, 0.7);
  c.billboardSprite(part, c.sceneBillboardBasis, 0.5, 0.5, prop, 12, -90);
  assert.deepEqual([prop.skew.x, prop.scale.x, prop.scale.y], [0, 0.7, 0.7]);
  assert.deepEqual([part.x, part.y, part.skew.x], [312, 110, 0]);
});

test('PERSP-14 接線：地形擺件與魔王祭壇都吃 opts.billboard；每幀在鏡頭算完後重算，火焰與眼睛掛在本體上', () => {
  assert.equal((renderer.match(/billboard: sceneBillboardBasis/g) || []).length, 2, 'initDecor 與 initArena 都要傳');
  const decor = fs.readFileSync(path.join(root, 'js/battle-decor.js'), 'utf8');
  const arena = fs.readFileSync(path.join(root, 'js/battle-arena.js'), 'utf8');
  assert.match(decor, /animateFlames\(dt\);\s*\n\s*billboardChunks\(\);/, '火焰縮放算完才抵銷');
  assert.match(decor, /fl\._bbParent = ps;/, '火焰跟著火盆走');
  assert.doesNotMatch(decor.slice(decor.indexOf('function animateFlames')), /f\.scale\.(x|y) =/, '火焰縮放不可繞過抵銷直接寫 sprite');
  assert.match(arena, /eye\._bbParent = gate\.s;/, '魔門的眼睛跟著門走');
  assert.match(arena, /fl\._bbParent = b\.s;/, '祭壇火焰跟著火盆走');
  assert.doesNotMatch(arena.slice(arena.indexOf('火焰閃爍')), /fl\.scale\.(x|y) =/, '祭壇火焰縮放不可繞過抵銷');
});
