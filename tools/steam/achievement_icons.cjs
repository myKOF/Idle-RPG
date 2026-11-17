'use strict';
/* ============ Steamworks 後台的成就圖示：npm.cmd run steam:icons ============
   Steam 規格：每條成就兩張 64×64 JPG——已達成（彩色）與未達成（灰階）。
   來源是遊戲內的 images/achievements/<icon>.png（128×128、透明背景），這裡：
     透明部分疊上深色底 → 縮成 64×64 → 已達成存彩色、未達成轉灰階並壓暗。
   輸出 dist/steam-achievement-icons/ACH_###.jpg 與 ACH_###_locked.jpg，
   檔名與 API 名稱相同（tools/desktop/steam_achievements.cjs 的清單、electron/steam.cjs 的規則）。

   用 Electron 跑（nativeImage 才能讀寫圖檔，Node 本身沒有影像處理）：
     electron tools/steam/achievement_icons.cjs
   不開任何視窗。 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var electron = require('electron');
var Steam = require('../../electron/steam.cjs');

var REPO = path.resolve(__dirname, '..', '..');
var OUT = path.join(REPO, 'dist', 'steam-achievement-icons');
var SIZE = 64;
var BG = { r: 24, g: 20, b: 18 };   // 接近遊戲成就頁的深色底；Steam 會把圖放在自己的深色介面上

function loadAchievements() {
  var ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(REPO, 'js', 'achievement_data.js'), 'utf8'), ctx);
  return vm.runInContext('ACHIEVEMENTS', ctx);
}

/* BGRA 位元組：疊底色（去掉透明）；locked 時轉灰階並壓暗到 55% */
function flatten(bmp, locked) {
  var out = Buffer.alloc(bmp.length);
  for (var i = 0; i < bmp.length; i += 4) {
    var a = bmp[i + 3] / 255;
    var b = bmp[i] * a + BG.b * (1 - a);
    var g = bmp[i + 1] * a + BG.g * (1 - a);
    var r = bmp[i + 2] * a + BG.r * (1 - a);
    if (locked) {
      var y = (0.114 * b + 0.587 * g + 0.299 * r) * 0.55;
      b = g = r = y;
    }
    out[i] = Math.round(b); out[i + 1] = Math.round(g); out[i + 2] = Math.round(r); out[i + 3] = 255;
  }
  return out;
}

function main() {
  var list = loadAchievements();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  var missing = [];
  list.forEach(function (a) {
    var src = path.join(REPO, 'images', 'achievements', a.icon + '.png');
    var img = electron.nativeImage.createFromPath(src);
    if (img.isEmpty()) { missing.push(a.id + '（' + a.icon + '）'); return; }
    var small = img.resize({ width: SIZE, height: SIZE, quality: 'best' });
    var bmp = small.toBitmap();
    var name = Steam.apiNameFor(a.id);
    [false, true].forEach(function (locked) {
      var flat = electron.nativeImage.createFromBitmap(flatten(bmp, locked), { width: SIZE, height: SIZE });
      fs.writeFileSync(path.join(OUT, name + (locked ? '_locked' : '') + '.jpg'), flat.toJPEG(92));
    });
  });
  console.log('成就圖示 ' + (list.length - missing.length) + ' 條 × 2 張 → ' + path.relative(REPO, OUT));
  if (missing.length) {
    console.error('❌ 找不到圖檔：' + missing.join('、'));
    process.exitCode = 1;
  }
}

electron.app.whenReady().then(function () {
  try { main(); } catch (e) { console.error(e && e.stack || e); process.exitCode = 1; }
  electron.app.quit();
});
