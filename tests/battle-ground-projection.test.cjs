const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction, groundYScale, buildSceneTree, scaleToWorld, drawOrder } = require('./helpers/battle-scene.cjs');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
const K = groundYScale(renderer);

/* ============================================================
   戰鬥畫面的斜俯視投影（2.5D，js/battle-renderer.js 的 GROUND_Y_SCALE，2026-09-22）

   需求：地面縱向壓縮成約 0.7，貼地的圓呈 1:0.7 的橢圓；角色等直立的東西不壓縮；
   只改表現，模擬層的座標、距離、技能範圍不動。

   作法是兩種座標並存（見 battle-renderer 檔頭「斜俯視投影」）：
     直立空間  world 的直屬層，座標是投影後的畫面位置——角色、血條、飄字
     地面平面  scale.y = GROUND_Y_SCALE 的容器，子層用世界座標——目前所有特效層
   會讓它「安靜地畫錯」的有三件事，各釘一條：
     ① 特效層沒有被投影 —— 範圍技落在世界座標，敵人畫在投影後的位置，縱向差幾萬像素，整個飛出畫面。
     ② 直立層被壓扁 —— 角色與飄字變矮，也就是需求第 4 條反過來。
     ③ 特效錨點（posOf／footOf／playerMuzzle）的座標系弄錯 —— 爆點、彈道起點離開角色身體。
   ============================================================ */

test('PROJ-1 壓縮比是 0.7，且地磚與特效層共用同一個值', () => {
  assert.equal(K, 0.7);
  const S = buildSceneTree(renderer);
  assert.equal(S.groundTile.tileScale.x, 1);
  assert.equal(S.groundTile.tileScale.y, K, '地磚縱向要與地面平面同一個壓縮比');
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
