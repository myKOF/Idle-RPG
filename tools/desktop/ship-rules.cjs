'use strict';
/* ============ 桌面版出貨清單規則（白名單）============
   計畫見 docs/steam/STEAM_RELEASE_PLAN.md 任務 B。

   出貨 = git 追蹤中的檔案 ∩ 下列執行期根目錄 − 排除規則。
   - 只看 git 追蹤的檔案：工作副本裡的暫存、模擬輸出、未提交的實驗品一律不會混進去。
   - 白名單以「目錄」為單位，而不是逐檔掃描引用：圖示、怪物圖、glb 外部貼圖大量用拼接或
     由資料表／模型檔內部引用，grep 原始碼證明不了「沒被用到」。沒把握的一律出貨。
   - 排除只放「百分之百確定執行期不讀」的東西，每一條都要寫原因。
     EXCLUDE_FILES 另有測試（tests/desktop-ship-rules.test.cjs）確認檔名沒出現在執行期程式裡，
     哪天有人開始用它，測試會擋下來，而不是玩家拿到缺檔的版本。

   新增執行期資源目錄時要更新 RUNTIME_ROOTS；放在根目錄外的資源不會出貨。 */

/* 執行期根目錄（結尾 / 表示整個目錄）與單檔 */
var RUNTIME_ROOTS = [
  'index.html',
  'tools/startup-diagnostics.js',   // index.html 直接載入（只在 localhost 啟用，但缺檔會讓 script 標籤報錯）
  'electron/',              // 主行程、協議、preload、冒煙測試（打包版也能自測）
  'js/',
  'css/',
  'fonts/',
  'images/',
  'audio/',
  'assets/',
  'vfx/'
];

/* 整個目錄排除（前綴比對） */
var EXCLUDE_DIRS = [
  { prefix: 'assets/characters/', reason: '3D 騎士製作流程的中間產物（.blend／.mhm／試作 glb）；執行期模型在 images/models/' },
  { prefix: 'vfx/layouts/', reason: 'VFX 編輯器的圖層排版，執行期只讀 vfx/presets/ 與 vfx/shipped-assets.json' }
];

/* 副檔名排除：原始檔、文件、腳本 */
var EXCLUDE_EXTS = {
  '.md': '說明文件（授權檔另行保留，見 KEEP_ALWAYS）',
  '.blend': 'Blender 原始檔',
  '.blend1': 'Blender 備份檔',
  '.mhm': 'MakeHuman 原始檔',
  '.psd': 'Photoshop 原始檔',
  '.kra': 'Krita 原始檔',
  '.xcf': 'GIMP 原始檔',
  '.xlsx': '配置表原始檔（執行期讀 js/*_data.js）',
  '.py': '腳本',
  '.bat': '腳本',
  '.ps1': '腳本',
  '.patch': '修補檔',
  '.log': '日誌'
};

/* 逐檔排除：確認過執行期不讀的大檔 */
var EXCLUDE_FILES = [
  // 序章以 js/intro-data.js 的播放路徑出貨，這裡列出只供編輯保存的成片。
  { path: 'images/intro-parchment/shot-01-02.mp4', reason: '序章剪輯舊版' },
  { path: 'images/intro-parchment/shot-01-extended.mp4', reason: '序章剪輯舊版' },
  { path: 'images/intro-parchment/shot-04-32.2s.mp4', reason: '序章剪輯舊版' },
  { path: 'images/intro-parchment/shots-01-02-34s.mp4', reason: '序章剪輯舊版' },
  { path: 'images/intro-parchment/shots-01-03-66s.mp4', reason: '序章剪輯舊版' },
  { path: 'images/intro-parchment/shots-01-03-67.5s.mp4', reason: '序章剪輯舊版' },
  { path: 'images/intro-parchment/shots-01-04-replay.mp4', reason: '前四鏡重播封存版' },
  { path: 'images/intro-parchment/shots-01-04-replay-sfx.mp3', reason: '前四鏡音效封存版' },
  { path: 'images/intro-parchment/shot-05-desert-finale-orbit.mp4', reason: '第五鏡獨立審片版' },
  { path: 'images/intro-parchment/manifest.json', reason: '剪輯紀錄，執行期不讀' }
];

/* 不論其他規則一律保留：授權條款。素材出貨，授權就要跟著出（OFL 字型的硬性要求）。 */
var KEEP_ALWAYS = /(^|\/)(LICENSE[^/]*|[^/]*_LICENSE[^/]*|OFL-[^/]*|NOTICE[^/]*)$/i;

function extOf(p) {
  var base = p.slice(p.lastIndexOf('/') + 1);
  var dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/* 單一檔案的判定：回傳 { ship: true } 或 { ship: false, reason } */
function classify(relPath) {
  var p = String(relPath).replace(/\\/g, '/');
  var inRoot = RUNTIME_ROOTS.some(function (r) {
    return r.charAt(r.length - 1) === '/' ? p.indexOf(r) === 0 : p === r;
  });
  if (!inRoot) return { ship: false, reason: '不在執行期根目錄' };
  // 點開頭的檔案與目錄（.gitignore、.gitkeep）不出貨；協議本來就拒絕伺服它們
  if (p.split('/').some(function (seg) { return seg.charAt(0) === '.'; })) return { ship: false, reason: '點開頭的路徑' };
  if (KEEP_ALWAYS.test(p)) return { ship: true };
  for (var i = 0; i < EXCLUDE_DIRS.length; i++) {
    if (p.indexOf(EXCLUDE_DIRS[i].prefix) === 0) return { ship: false, reason: EXCLUDE_DIRS[i].reason };
  }
  for (var j = 0; j < EXCLUDE_FILES.length; j++) {
    if (p === EXCLUDE_FILES[j].path) return { ship: false, reason: EXCLUDE_FILES[j].reason };
  }
  var ext = extOf(p);
  if (Object.prototype.hasOwnProperty.call(EXCLUDE_EXTS, ext)) return { ship: false, reason: EXCLUDE_EXTS[ext] };
  return { ship: true };
}

module.exports = {
  RUNTIME_ROOTS: RUNTIME_ROOTS,
  EXCLUDE_DIRS: EXCLUDE_DIRS,
  EXCLUDE_EXTS: EXCLUDE_EXTS,
  EXCLUDE_FILES: EXCLUDE_FILES,
  KEEP_ALWAYS: KEEP_ALWAYS,
  classify: classify
};
