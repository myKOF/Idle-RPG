'use strict';
/* ============================================================
   vfx-preset-render-skew.test.cjs — 離線出圖的斜切

   2026-09-17 父子層級上線：父物件非等比縮放、子物件又旋轉時，Core 會送出 skewX。
   「瀏覽特效」的縮圖與 AI 看 preset 用的離線出圖（tools/vfx/preset-render.cjs）
   要照畫，否則縮圖上的形狀會與遊戲裡不同。

   斜切為 0 時與加入之前逐位元組相同——那一點在加入時另外以 300 組隨機變換比對過；
   這裡驗的是斜切本身有被畫出來。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const render = require('../tools/vfx/preset-render.cjs');
const raster = require('../tools/vfx/vfx-raster.cjs');
const thumbs = require('../tools/vfx/preset-thumbs.cjs');

/* 64×64 不透明白色方塊：在深色底上一定看得到，外框與面積都量得準 */
function whiteSquare() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-skew-'));
  const file = path.join(dir, 'sq.png');
  fs.writeFileSync(file, raster.encodePng(new Uint8Array(64 * 64 * 4).fill(255), 64, 64));
  return file;
}

function drawnShape(layers) {
  const shots = render.renderPreset({
    preset: { schemaVersion: 1, id: 'skew-test', duration: 1, loop: false, layers: layers },
    root: '', index: { byId: { 'sq.png': whiteSquare() } },
    frames: 1, size: 256, scale: 1, bg: 'dark', groundLike: false, seed: 1
  });
  const c = thumbs._internal.contentOf(shots[0]);
  return { width: c.x1 - c.x0 + 1, height: c.y1 - c.y0 + 1, area: c.count };
}

test('SKEW-1 父物件 S(2,1)、子物件轉 45 度：畫出來是平行四邊形，不是轉過的正方形', function () {
  const s = drawnShape([
    { id: 'n', type: 'empty', scale: { x: 2, y: 1 } },
    { id: 'sq', type: 'sprite', assetId: 'sq.png', parent: 'n', rotation: Math.PI / 4 }
  ]);
  /* S(2,1)·R(45°) 把 64×64 的正方形變成外框 181 × 90.5、面積 |det|×64² = 8192 的平行四邊形。
     忽略斜切、只套旋轉與縮放的話，會畫成邊長 101、轉 26.6 度的正方形：外框約 136 × 136。 */
  assert.ok(Math.abs(s.width - 181) <= 4, '寬 ' + s.width);
  assert.ok(Math.abs(s.height - 91) <= 4, '高 ' + s.height);
  assert.ok(Math.abs(s.area - 8192) < 400, '面積 ' + s.area);
});

test('SKEW-2 沒有斜切的圖層照舊：轉 45 度的正方形外框是 90.5 × 90.5', function () {
  const s = drawnShape([{ id: 'sq', type: 'sprite', assetId: 'sq.png', rotation: Math.PI / 4 }]);
  assert.ok(Math.abs(s.width - 91) <= 4 && Math.abs(s.height - 91) <= 4, s.width + ' × ' + s.height);
  assert.ok(Math.abs(s.area - 4096) < 300, '面積 ' + s.area);
});
