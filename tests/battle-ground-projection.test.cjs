const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction, groundYScale, groundDecls, buildSceneTree, scaleToWorld, drawOrder } = require('./helpers/battle-scene.cjs');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
const K = groundYScale(renderer);

/* ============================================================
   戰鬥畫面的斜俯視投影（2.5D，js/battle-renderer.js 的 GROUND_Y_SCALE，2026-09-22）

   需求：地面縱向壓縮（最初 0.7，使用者看過並排比較後改 0.5），貼地的圓呈 1 : 壓縮比 的橢圓；角色等直立的東西不壓縮；
   只改表現，模擬層的座標、距離、技能範圍不動。

   作法是兩種座標並存（見 battle-renderer 檔頭「斜俯視投影」）：
     直立空間  world 的直屬層，座標是投影後的畫面位置——角色、血條、飄字
     地面平面  scale.y = GROUND_Y_SCALE 的容器，子層用世界座標——目前所有特效層
   會讓它「安靜地畫錯」的有三件事，各釘一條：
     ① 特效層沒有被投影 —— 範圍技落在世界座標，敵人畫在投影後的位置，縱向差幾萬像素，整個飛出畫面。
     ② 直立層被壓扁 —— 角色與飄字變矮，也就是需求第 4 條反過來。
     ③ 特效錨點（posOf／footOf／playerMuzzle）的座標系弄錯 —— 爆點、彈道起點離開角色身體。
   ============================================================ */

test('PROJ-1 壓縮比是 0.5（使用者選定）；地板在世界平面裡轉 45°（菱形），再由同一個壓縮比投影', () => {
  /* 只壓縮不轉，正方形地磚只會變成扁長方形，看起來像平鋪的長方形地磚（2026-09-22 使用者實機回報「似乎還沒調整」）。
     壓縮必須在轉之後：寫在 tileScale 上是先壓再轉，會得到歪的平行四邊形。 */
  assert.equal(K, 0.5);
  const S = buildSceneTree(renderer);
  const g = S.groundTile;
  assert.deepEqual(scaleToWorld(g, S.app.stage), { x: 1, y: K }, '地板的總縮放要與特效層同一個投影');
  assert.deepEqual([g.tileScale.x, g.tileScale.y], [1, 1], '投影交給容器，貼圖本身不縮放');
  assert.ok(Math.abs(g.tileRotation - Math.PI / 4) < 1e-12, '地磚在世界平面裡轉 45°：' + g.tileRotation);
});

test('PROJ-8 地板的 TilingSprite 在本地空間是正方形且蓋滿畫布（Pixi v8 寬高不同時 tileRotation 會被拉歪）', () => {
  /* 2026-09-22 實測：926×3023 的地板轉 45° 後變成一組細密、一組稀疏的陡斜線；改成正方形就是正的菱形。 */
  /* 開了輕微透視時，地板要蓋滿的是離屏貼圖涵蓋的範圍（比畫布大），不是畫布 */
  const topScale = Number(/var PERSPECTIVE_TOP_SCALE = ([0-9.]+);/.exec(renderer)[1]);
  for (const persp of [false, true]) {
    for (const [W, H] of [[670, 731], [670, 1860], [1400, 500]]) {
      const g = { width: 0, height: 0, x: 0, y: 0 };
      const c = { Math, S: { layers: {}, groundTile: g, W, H } };
      vm.createContext(c);
      vm.runInContext(groundDecls(renderer) + ['screenToGroundY', 'perspectiveLayout', 'syncPerspective', 'sceneDrawRect',
        'syncVignette', 'layoutScene'].map((n) => extractFunction(renderer, n)).join(';'), c);
      if (persp) c.S.persp = { layout: c.perspectiveLayout(W, H, topScale) };
      c.layoutScene();
      const R = c.sceneDrawRect();
      const tag = (persp ? '透視 ' : '') + W + '×' + H;
      if (!persp) assert.deepEqual([R.x, R.y, R.width, R.height], [0, 0, W, H], '沒開透視＝畫布');
      assert.equal(g.width, g.height, tag + '：本地寬高必須相同');
      /* 蓋滿：左上角在範圍外、右下角超過範圍（縱向要乘回投影比例才是畫面像素） */
      assert.ok(g.x <= R.x && g.y * K <= R.y, tag + '：左上角要在範圍外');
      assert.ok(g.x + g.width >= R.x + R.width && (g.y + g.height) * K >= R.y + R.height, tag + '：要蓋滿範圍');
    }
  }
});

test('PROJ-7 地板捲動：地面上固定一點看到的貼圖位置不隨鏡頭改變，跨過取餘數的邊界也不跳格', () => {
  /* tilePosition 取餘數是為了避開 float32 精度；週期若算錯（轉 45° 的正方形是邊長 × √2），
     每跨過一次邊界地板就會整片跳一下。這裡直接算「世界上固定一點落在貼圖的哪個座標」。 */
  const side = 128;
  const g = { texture: { width: side, height: side }, tilePosition: { x: 0, y: 0 } };
  const c = { Math, S: { groundTile: g } };
  vm.createContext(c);
  vm.runInContext(groundDecls(renderer) + extractFunction(renderer, 'screenToGroundY') + ';' +
    extractFunction(renderer, 'syncGroundScroll'), c);
  const rot = c.GROUND_TILE_ROTATION;
  const cos = Math.cos(-rot), sin = Math.sin(-rot);
  const P = { x: 37.5, y: -81.25 };                      // 世界上固定的一點
  const texAt = (cam) => {
    c.syncGroundScroll(cam, 0, 0);
    /* 地面平面本地座標（世界單位、只差一個常數）＝ P − cam；貼圖座標＝R(−θ)·(本地 − tilePosition)，再對邊長取餘數 */
    const lx = P.x - cam.x - g.tilePosition.x, ly = P.y - cam.y - g.tilePosition.y;
    const u = lx * cos - ly * sin, v = lx * sin + ly * cos;
    const m = (a) => ((a % side) + side) % side;
    return [m(u), m(v)];
  };
  const per = side * c.GROUND_TILE_PERIOD;
  const base = texAt({ x: 5, y: 7 });
  /* 大座標（一場下來幾十萬）與正好跨過週期邊界的前後兩點 */
  for (const cam of [{ x: 123456.7, y: -98765.4 }, { x: per - 1e-3, y: per - 1e-3 }, { x: per + 1e-3, y: per + 1e-3 },
                     { x: -3 * per + 0.5, y: 5 * per - 0.5 }]) {
    const t = texAt(cam);
    const d = (a, b) => Math.min(Math.abs(a - b), side - Math.abs(a - b));
    assert.ok(d(t[0], base[0]) < 1e-3 && d(t[1], base[1]) < 1e-3,
      '鏡頭在 ' + JSON.stringify(cam) + ' 時，同一個世界點落在貼圖 ' + t.map((n) => n.toFixed(3)) + '，應為 ' + base.map((n) => n.toFixed(3)));
  }
});

test('PROJ-2 特效層在地面平面（縱向 × GROUND_Y_SCALE、橫向不變）；角色、輪廓、飄字、HUD 不壓縮', () => {
  const S = buildSceneTree(renderer);
  const L = S.layers;
  for (const name of ['zone', 'presetZone', 'fx', 'presetFx']) {
    const s = scaleToWorld(L[name], L.world);
    assert.equal(s.x, 1, name + ' 橫向不可縮放');
    assert.ok(Math.abs(s.y - K) < 1e-12, name + ' 應在地面平面（縱向 ' + K + '），實際 ' + s.y);
  }
  for (const name of ['entity', 'outline', 'float', 'playerHud']) {
    const s = scaleToWorld(L[name], L.world);
    assert.deepEqual(s, { x: 1, y: 1 }, name + ' 是直立空間，不可被投影壓扁');
  }
});

test('PROJ-3 圖層繪製順序不變：地面特效 < 實體 < 特效 < 輪廓 < 飄字 < 玩家 HUD', () => {
  /* 包進地面平面容器之後，順序仍要和投影前一樣——輪廓壓在所有特效上面是它存在的理由。 */
  const S = buildSceneTree(renderer);
  const L = S.layers;
  const order = drawOrder(L.world);
  const at = (name) => { const i = order.indexOf(L[name]); assert.ok(i >= 0, name + ' 不在 world 底下'); return i; };
  const seq = [['zone', 'presetZone'], ['entity'], ['fx', 'presetFx'], ['outline'], ['float'], ['playerHud']];
  for (let i = 1; i < seq.length; i++) {
    for (const lo of seq[i - 1]) for (const hi of seq[i]) {
      assert.ok(at(hi) > at(lo), hi + ' 必須畫在 ' + lo + ' 之後');
    }
  }
});

/* 座標函式挖出來跑：玩家與一隻敵人站在投影後的位置（root 是直立空間座標）。 */
function loadAnchors() {
  const player = { wx: 1000, wy: 2000, facing: 1, root: { x: 1000, y: 2000 * K } };
  const enemy = { root: { x: 1100, y: 2100 * K }, hitHeight: 64 };
  const ctx = {
    Math,
    S: { player, entities: { 'mv-float-1': enemy }, lastPos: {} },
    nowMs: () => 0, LASTPOS_KEEP_MS: 3000, PLAYER_REACH: 52
  };
  vm.createContext(ctx);
  const names = ['groundToScreenY', 'screenToGroundY', 'screenToGround', 'playerPos',
    'footOf', 'screenFootOf', 'playerMuzzle', 'posOf', 'screenPosOf'];
  vm.runInContext('var GROUND_Y_SCALE = ' + K + ';' + names.map((n) => extractFunction(renderer, n)).join(';'), ctx);
  return ctx;
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg + '：' + a + ' ≠ ' + b);

test('PROJ-4 特效錨點回傳地面平面座標：經過容器投影後正好落在畫面上的身體位置', () => {
  const c = loadAnchors();
  /* 腳底：地面平面座標就是世界座標 */
  near(c.footOf('pv-float').y, 2000, '玩家腳底＝世界 y');
  near(c.footOf('mv-float-1').y, 2100, '敵人腳底＝世界 y');
  /* 身體中心：直立空間在腳底上方固定像素（角色圖不壓縮，所以這個高度不隨投影改變） */
  near(c.screenPosOf('pv-float').y, 2000 * K - 46, '玩家胸口在腳底上方 46 畫面像素');
  near(c.screenPosOf('mv-float-1').y, 2100 * K - 64 * 0.55, '敵人受擊點在腳底上方 hitHeight×0.55');
  /* 核心性質：posOf 丟進地面平面、被 scale.y 投影之後，必須等於畫面上的那個點 */
  for (const id of ['pv-float', 'mv-float-1', 'mv-float-999']) {
    near(c.groundToScreenY(c.posOf(id).y), c.screenPosOf(id).y, id + ' 的 posOf 投影後要與 screenPosOf 重合');
    near(c.groundToScreenY(c.footOf(id).y), c.screenFootOf(id).y, id + ' 的 footOf 投影後要與 screenFootOf 重合');
    assert.equal(c.posOf(id).x, c.screenPosOf(id).x, '橫向不投影');
  }
  /* 投射物起點：胸口在腳底上方 52 畫面像素 */
  near(c.groundToScreenY(c.playerMuzzle().y), 2000 * K - 52, '彈道起點投影後在玩家胸口');
});

test('PROJ-5 目標已不在時的退路：落在角色面前一個身位，而不是投影前的世界座標', () => {
  const c = loadAnchors();
  const p = c.screenPosOf('mv-float-999');
  assert.equal(p.x, 1000 + 52 + 14);
  near(p.y, 2000 * K - 24, '面前一個身位、略高於腳底（畫面座標）');
});

/* 從 marker 開始挖出一整個 { ... } 區塊（大括號配對）。 */
function extractBlock(src, marker) {
  const head = src.indexOf(marker);
  assert.notEqual(head, -1, '找不到 ' + marker);
  let i = src.indexOf('{', head), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(head, i + 1);
  }
  throw new Error(marker + ' 的大括號沒有配對');
}

test('PROJ-6 敵人進場淡入：從 0 漸進到 1，進場結束時剛好完全不透明，進場很短也不跳格', () => {
  /* 斜俯視把縱向壓縮之後，模擬層 440 的生成距離在畫面上下方只剩 440 × 壓縮比（0.5 時 220px），
     比畫布半高還短——不淡入就是在畫面裡憑空冒出來。 */
  const tick = extractBlock(renderer, "if (e.state === 'entering') {");
  const fade = Number(/var ENEMY_FADE_IN_SEC = ([0-9.]+);/.exec(renderer)[1]);
  for (const enterDur of [0.45, 0.1]) {
    const c = { Math, ENEMY_FADE_IN_SEC: fade, dt: 1 / 60, e: { state: 'entering', enterT: 0, enterDur, root: { alpha: 1 } } };
    vm.createContext(c);
    const alphas = [];
    for (let f = 0; f < 60 && c.e.state === 'entering'; f++) { vm.runInContext(tick, c); alphas.push(c.e.root.alpha); }
    assert.equal(c.e.state, 'idle', '進場要結束');
    assert.ok(alphas[0] < 0.2, '第一幀幾乎透明（enterDur ' + enterDur + '）：' + alphas[0]);
    for (let i = 1; i < alphas.length; i++) assert.ok(alphas[i] >= alphas[i - 1], '淡入不可倒退');
    assert.equal(alphas[alphas.length - 1], 1, '進場結束時完全不透明');
    /* 最後一步的跳幅不能比一幀的正常增量大太多（進場比淡入時間短時要跟著縮短） */
    const lastStep = alphas[alphas.length - 1] - alphas[alphas.length - 2];
    assert.ok(lastStep <= (1 / 60) / Math.min(fade, enterDur) + 1e-9, '結尾不可一口氣跳到 1：' + lastStep);
  }
});
