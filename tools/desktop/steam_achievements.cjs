'use strict';
/* ============ 產生 Steamworks 後台的成就清單：node tools/desktop/steam_achievements.cjs ============
   輸出 dist/steam-achievements.csv（UTF-8 BOM，Excel 直接開）：API 名稱、顯示名稱、說明、圖示路徑。
   到 Steamworks 後台 → Stats & Achievements 逐條建立時照抄 API 名稱（ACH_###，與 electron/steam.cjs 同規則）。

   圖示：Steam 要求 64×64 的 JPG，已達成與未達成（灰階）各一張；遊戲內的圖在 images/achievements/<icon>.png，
   上傳前需要轉檔（任務 E 處理）。 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var Steam = require('../../electron/steam.cjs');

var REPO = path.resolve(__dirname, '..', '..');

function loadAchievements() {
  var ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(REPO, 'js', 'achievement_data.js'), 'utf8'), ctx);
  return vm.runInContext('ACHIEVEMENTS', ctx);
}

function csvCell(v) {
  var s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function main() {
  var list = loadAchievements();
  var rows = [['API 名稱', '遊戲編號', '顯示名稱', '說明', '圖示']];
  list.forEach(function (a) {
    rows.push([Steam.apiNameFor(a.id), a.id, a.name, a.desc, 'images/achievements/' + a.icon + '.png']);
  });
  var out = path.join(REPO, 'dist', 'steam-achievements.csv');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, String.fromCharCode(0xFEFF) + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n');
  console.log('成就 ' + list.length + ' 條 → ' + path.relative(REPO, out));
}

main();
