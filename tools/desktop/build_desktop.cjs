'use strict';
/* ============ 桌面版打包（Steam 任務 B）：npm run desktop:pack ============
   1. 依 tools/desktop/ship-rules.cjs 從 git 追蹤的檔案挑出出貨清單
   2. 以硬連結（失敗才複製）放進暫存目錄 build/desktop/app/，另寫一份精簡的 package.json
   3. electron-builder 打成 dist/win-unpacked/（x64、免安裝資料夾：SteamPipe 上傳的就是它）
   4. 輸出 dist/ship-report.json：出貨檔數與大小、各目錄大小、每條排除規則排掉了什麼

   參數：
     --stage-only   只做到第 2 步（檢查清單用，不呼叫 electron-builder）
     --edition=demo Steam 封測 demo：暫存區多寫一份 electron/edition.json（外殼據此把 GAME_EDITION 改成 'demo'），
                    輸出到 dist/demo/win-unpacked/，與正式版的 dist/win-unpacked/ 分開
     --lang=en      打包語言（預設 zh-TW）：應用程式名稱讀 String 表 2569 的對應語言欄（中文「神力之巔」、英文「Idle: Divine Apex」），
                    安裝程式介面跟著換語言；非預設語言輸出到 <輸出資料夾>/<語言>/
     --full-textures 不縮模型貼圖（預設會縮，見下方「為什麼縮模型貼圖」）
     --keep-png     PNG 不換成 WebP（預設會換，見下方「為什麼 PNG 換成 WebP」；需要 Python 與 Pillow）
     --keep-video   影片不重新編碼（預設會重壓序章影片，tools/desktop/reencode_video.cjs；需要 ffmpeg）
     --installer    另外打一份 Windows 安裝包（NSIS），給 Steam 以外的測試散佈用，輸出到 dist/installer/<版本>/。
                    安裝包版一律不接 Steam：不放 steamworks.js、打包版的 steam-config.json 的 AppID 全部歸 0。
                    （接了 Steam 的版本若不是從 Steam 啟動會交給 Steam 重開、自己結束，裝在 Steam 以外就打不開。）
                    與 Steam 上傳用的 dist/win-unpacked、dist/demo/win-unpacked 分開，不會互相覆蓋。

   ---- 為什麼 asar: false ----
   SteamPipe 以 1 MB 區塊比對新舊版本。asar 是一個巨大的單檔，裡面任何檔案變長或變短，
   後面所有區塊都會位移，一次小更新可能讓玩家重新下載整包；散檔則只會傳有變動的檔案。
   asar 也不提供保護（任何人都能解開），所以沒有理由用它。

   ---- 為什麼縮模型貼圖 ----
   專案裡的 .glb 帶 2048 貼圖（Meshy／Blender 流程的原檔，保留不動），但角色畫在 512／1024 的畫布上、畫面上只有幾百像素高。
   打包時由 tools/desktop/shrink_models.cjs（以 Electron 執行）把暫存區那一份縮到 1024、轉 JPEG：模型 367 → 111 MB，
   畫面對照 PSNR 50 dB 以上（2026-11-19）。原始檔不動；結果快取在 build/desktop/model-cache/。

   ---- 為什麼 PNG 換成 WebP ----
   PNG 是包體最大的一塊（約 309 MB）。tools/desktop/webp_images.py 把暫存區的 PNG 換成 WebP 內容、檔名不變
   （程式、配置表、Preset 都寫 .png；images/vfx/assets 還會被 VFX 編輯器整棵換新，改檔名不可行）：
   序列幀與 256 以下的小圖用無損（逐像素相同），其他用有損品質 90、透明度無損。309 → 83 MB（2026-11-19）。
   app:// 協議看檔頭回報 image/webp（electron/app-protocol.cjs sniffImageMime）。

   ---- 為什麼重新編碼序章影片 ----
   序章 mp4 是 1080p30、7 Mbps（96 MB）。tools/desktop/reencode_video.cjs 以 x264 CRF 24 重壓成約 46 MB
   （VMAF 91.8，暗部放大比對看不出差別），維持 H.264、解析度、幀率與總幀數。需要 ffmpeg。

   ---- 為什麼要暫存目錄 ----
   electron-builder 的 files 只吃 glob，表達不了「git 追蹤 ∩ 白名單 − 排除」；
   而且專案根目錄的 package.json 帶著 devDependencies 與開發腳本，不該出現在玩家的資料夾裡。 */

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var Rules = require('./ship-rules.cjs');

var REPO = path.resolve(__dirname, '..', '..');
var STAGE = path.join(REPO, 'build', 'desktop', 'app');
var EDITION = (process.argv.filter(function (a) { return a.indexOf('--edition=') === 0; })[0] || '--edition=full').slice(10);
if (EDITION !== 'full' && EDITION !== 'demo') { console.error('❌ --edition 只能是 full 或 demo：' + EDITION); process.exit(1); }
var INSTALLER = process.argv.indexOf('--installer') >= 0;
var OUT = INSTALLER ? path.join(REPO, 'dist', 'installer', EDITION)
  : (EDITION === 'demo' ? path.join(REPO, 'dist', 'demo') : path.join(REPO, 'dist'));
var ROOT_PKG = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));

/* 打包語言（--lang=zh-TW 預設｜en｜zh-CN）：決定應用程式名稱與安裝程式語言。非預設語言另放一層資料夾，不蓋掉預設版。 */
var LANGS = {
  'zh-TW': { column: '繁體中文', nsisLanguage: '1028', installerLanguages: ['zh_TW'] },
  'zh-CN': { column: '簡體中文', nsisLanguage: '2052', installerLanguages: ['zh_CN'] },
  en: { column: '英文', nsisLanguage: '1033', installerLanguages: ['en_US'] }
};
var LANG = (process.argv.filter(function (a) { return a.indexOf('--lang=') === 0; })[0] || '--lang=zh-TW').slice(7);
if (!LANGS[LANG]) { console.error('❌ --lang 只能是 ' + Object.keys(LANGS).join('／') + '：' + LANG); process.exit(1); }
if (LANG !== 'zh-TW') OUT = path.join(OUT, LANG);

/* 玩家看得到的名稱＝遊戲正式名稱，唯一來源是 String 表 2569（AI_RULES 8.11）：
   繁體中文「神力之巔」、英文「Idle: Divine Apex」，依打包語言取欄位；簡體中文空白時退回繁體中文（與遊戲內 STR() 相同）。
   exe 檔名刻意用 ASCII：Steam 的啟動選項、防毒白名單、命令列都比較不會出事。 */
var GAME_NAME_STR_ID = 2569;
function gameNameFromStringTable(lang) {
  var csvParse = require('../string-table/apply_strings.cjs').csvParse;
  var rows = csvParse(fs.readFileSync(path.join(REPO, 'config', 'CSV', 'String.csv'), 'utf8'));
  var header = rows[0];
  var row = rows.filter(function (r) { return Number(r[0]) === GAME_NAME_STR_ID; })[0];
  if (!row) throw new Error('String 表找不到 ' + GAME_NAME_STR_ID + '（遊戲正式名稱）');
  var zh = row[header.indexOf('繁體中文')];
  var name = row[header.indexOf(LANGS[lang].column)] || (lang === 'zh-CN' ? zh : '');
  if (!name) throw new Error('String 表 ' + GAME_NAME_STR_ID + ' 的「' + LANGS[lang].column + '」是空的，不能打包 ' + lang + ' 版');
  return name;
}
var PRODUCT_NAME = gameNameFromStringTable(LANG);
function fileSafeName(name) { return String(name).replace(/[<>:"\/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim(); }
var EXECUTABLE_NAME = 'IdleRPG';
var APP_ID = 'com.idlerpg.desktop';
/* 應用程式圖示（exe、捷徑、工作列、安裝包）：由 tools/desktop/make_app_icon.py 從 logo 的劍產生 */
var APP_ICON = path.join(REPO, 'electron', 'icons', 'app.ico');

function mb(n) { return Math.round(n / 1048576 * 10) / 10; }

function trackedFiles() {
  var out = childProcess.execFileSync('git', ['ls-files', '-z'], { cwd: REPO, maxBuffer: 1 << 28 });
  return out.toString('utf8').split('\0').filter(Boolean);
}

/* 出貨清單：{ ship: [{ path, size }], excluded: { 原因: { count, bytes, samples } }, missing: [] } */
function collect() {
  var ship = [];
  var excluded = {};
  var missing = [];
  trackedFiles().forEach(function (rel) {
    var verdict = Rules.classify(rel);
    var full = path.join(REPO, rel);
    var st;
    try { st = fs.statSync(full); } catch (e) { if (verdict.ship) missing.push(rel); return; }
    if (!st.isFile()) return;
    if (verdict.ship) { ship.push({ path: rel, size: st.size }); return; }
    var bucket = excluded[verdict.reason] || (excluded[verdict.reason] = { count: 0, bytes: 0, samples: [] });
    bucket.count++;
    bucket.bytes += st.size;
    if (bucket.samples.length < 5) bucket.samples.push(rel);
  });
  return { ship: ship, excluded: excluded, missing: missing };
}

function rmrf(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

/* steamworks.js（任務 D）：只放 Windows x64 需要的檔案到 electron/vendor/steamworks.js/。
   不走 electron-builder 的 node_modules 收集：它會去追 steamworks.js 宣告的 @types/node 相依，
   而且會把 linux／mac 的原生檔一起帶上。electron/steam.cjs 找不到 node_modules 時改讀這裡。 */
var STEAMWORKS_FILES = ['index.js', 'package.json', 'LICENSE', 'dist/win64/steamworksjs.win32-x64-msvc.node', 'dist/win64/steam_api64.dll'];
function stageSteamworks() {
  var src = path.join(REPO, 'node_modules', 'steamworks.js');
  var dst = path.join(STAGE, 'electron', 'vendor', 'steamworks.js');
  STEAMWORKS_FILES.forEach(function (rel) {
    var from = path.join(src, rel);
    if (!fs.existsSync(from)) throw new Error('找不到 ' + from + '（先 npm install）');
    var to = path.join(dst, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  });
}

function stage(list) {
  rmrf(STAGE);
  fs.mkdirSync(STAGE, { recursive: true });
  var linked = 0, copied = 0;
  list.ship.forEach(function (f) {
    var src = path.join(REPO, f.path);
    var dst = path.join(STAGE, f.path);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try { fs.linkSync(src, dst); linked++; } catch (e) { fs.copyFileSync(src, dst); copied++; }
  });
  stageSteamworks();
  // 玩家資料夾裡的 package.json：只留 Electron 需要的欄位
  fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify({
    name: ROOT_PKG.name,
    productName: PRODUCT_NAME,
    version: ROOT_PKG.version,
    private: true,
    main: ROOT_PKG.main
  }, null, 2) + '\n');
  return { linked: linked, copied: copied };
}

/* 縮模型貼圖：在 Electron 裡跑 tools/desktop/shrink_models.cjs（nativeImage 不需要額外套件）。
   回傳 { 相對路徑: 新大小 }，用來更新出貨清單的大小統計。 */
var MODEL_CACHE = path.join(REPO, 'build', 'desktop', 'model-cache');
function shrinkModels() {
  var reportFile = path.join(REPO, 'build', 'desktop', 'shrink-models-report.json');
  var r = childProcess.spawnSync(path.join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe'),
    [path.join(__dirname, 'shrink_models.cjs'), STAGE, MODEL_CACHE, reportFile],
    { cwd: REPO, stdio: 'inherit', windowsHide: true, timeout: 15 * 60 * 1000 });
  if (r.error || r.status !== 0) throw new Error('縮模型貼圖失敗（' + (r.error ? r.error.message : '結束碼 ' + r.status) + '）；要出原尺寸可加 --full-textures');
  var report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  var sizes = {};
  report.files.forEach(function (f) { sizes[f.file] = f.after; });
  return { sizes: sizes, beforeMB: mb(report.beforeBytes), afterMB: mb(report.afterBytes) };
}

/* PNG 換成 WebP 內容（檔名不變）：tools/desktop/webp_images.py（Pillow）。回傳 { 相對路徑: 新大小 }。 */
var WEBP_CACHE = path.join(REPO, 'build', 'desktop', 'webp-cache');
function webpImages() {
  var reportFile = path.join(REPO, 'build', 'desktop', 'webp-images-report.json');
  var r = childProcess.spawnSync(process.env.PYTHON || 'python', ['-I', path.join(__dirname, 'webp_images.py'), STAGE, WEBP_CACHE, reportFile],
    { cwd: REPO, stdio: 'inherit', windowsHide: true, timeout: 30 * 60 * 1000, env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
  if (r.error || r.status !== 0) {
    throw new Error('PNG 換 WebP 失敗（' + (r.error ? r.error.message : '結束碼 ' + r.status) + '）。需要 Python 與 Pillow（pip install pillow），' +
      '或加 --keep-png 出原本的 PNG');
  }
  var report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  var sizes = {};
  report.files.forEach(function (f) { sizes[f.file] = f.after; });
  return { sizes: sizes, beforeMB: mb(report.beforeBytes), afterMB: mb(report.afterBytes), converted: report.converted };
}

/* 重新編碼影片（序章）：tools/desktop/reencode_video.cjs（ffmpeg）。回傳 { 相對路徑: 新大小 }。 */
var VIDEO_CACHE = path.join(REPO, 'build', 'desktop', 'video-cache');
function reencodeVideos() {
  var reportFile = path.join(REPO, 'build', 'desktop', 'reencode-video-report.json');
  var r = childProcess.spawnSync(process.execPath, [path.join(__dirname, 'reencode_video.cjs'), STAGE, VIDEO_CACHE, reportFile],
    { cwd: REPO, stdio: 'inherit', windowsHide: true, timeout: 30 * 60 * 1000 });
  if (r.error || r.status !== 0) {
    throw new Error('影片重新編碼失敗（' + (r.error ? r.error.message : '結束碼 ' + r.status) + '）。需要 ffmpeg（winget install Gyan.FFmpeg），或加 --keep-video 出原檔');
  }
  var report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  var sizes = {};
  report.files.forEach(function (f) { sizes[f.file] = f.after; });
  return { sizes: sizes, beforeMB: mb(report.beforeBytes), afterMB: mb(report.afterBytes) };
}

/* 安裝包版不接 Steam：拿掉 steamworks.js，暫存區的 steam-config.json 換成 AppID 全 0 的新檔。
   暫存區的檔案是原始碼的硬連結，直接寫會改到原始碼——一定要先 unlink 再寫。 */
function detachSteam() {
  rmrf(path.join(STAGE, 'electron', 'vendor', 'steamworks.js'));
  var cfg = path.join(STAGE, 'electron', 'steam-config.json');
  fs.unlinkSync(cfg);
  fs.writeFileSync(cfg, JSON.stringify({
    '說明': '安裝包版（Steam 以外散佈的測試版）：不接 Steam。由 tools/desktop/build_desktop.cjs --installer 產生。',
    appId: 0,
    demoAppId: 0
  }, null, 2) + '\n');
}

/* 安裝包設定：以 builderConfig 為底。appId 依版本分開，否則 demo 與正式版的安裝包會被 Windows 當成同一個程式而互相覆蓋。
   安裝到使用者資料夾（免系統管理員）；解除安裝不刪存檔（存檔在 %APPDATA%，見 electron/main.cjs）。 */
function installerConfig() {
  var c = builderConfig();
  c.appId = APP_ID + (EDITION === 'demo' ? '.demo' : '');
  c.win = { target: [{ target: 'nsis', arch: ['x64'] }], icon: APP_ICON };
  c.nsis = {
    installerIcon: APP_ICON,
    uninstallerIcon: APP_ICON,
    installerHeaderIcon: APP_ICON,
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    // 捷徑是檔案：英文名的「:」等 Windows 檔名不允許的字元要拿掉（Idle: Divine Apex → Idle Divine Apex）；標題與解除安裝清單保留原名
    shortcutName: fileSafeName(c.productName),
    uninstallDisplayName: c.productName,
    deleteAppDataOnUninstall: false,
    differentialPackage: false,
    installerLanguages: LANGS[LANG].installerLanguages,
    language: LANGS[LANG].nsisLanguage,
    // 檔名用 ASCII：瀏覽器下載、雲端硬碟、命令列都比較不會出事
    artifactName: EXECUTABLE_NAME + (EDITION === 'demo' ? '-Demo' : '') + '-Setup-${version}.${ext}'
  };
  return c;
}

function dirSize(dir) {
  var total = 0;
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) {
      var p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else total += fs.statSync(p).size;
    });
  })(dir);
  return total;
}

function summarize(list, extra) {
  var byDir = {};
  var total = 0;
  list.ship.forEach(function (f) {
    var parts = f.path.split('/');
    var key = parts.length > 2 ? parts[0] + '/' + parts[1] : parts[0];
    byDir[key] = (byDir[key] || 0) + f.size;
    total += f.size;
  });
  var excluded = {};
  var excludedBytes = 0;
  Object.keys(list.excluded).sort(function (a, b) { return list.excluded[b].bytes - list.excluded[a].bytes; }).forEach(function (k) {
    var b = list.excluded[k];
    excludedBytes += b.bytes;
    excluded[k] = { count: b.count, mb: mb(b.bytes), samples: b.samples };
  });
  var report = {
    builtAt: new Date().toISOString(),
    version: ROOT_PKG.version,
    electron: ROOT_PKG.devDependencies.electron,
    shippedFiles: list.ship.length,
    shippedMB: mb(total),
    excludedMB: mb(excludedBytes),
    shippedByDirMB: {},
    excluded: excluded,
    missingTracked: list.missing
  };
  Object.keys(byDir).sort(function (a, b) { return byDir[b] - byDir[a]; }).forEach(function (k) { report.shippedByDirMB[k] = mb(byDir[k]); });
  Object.keys(extra || {}).forEach(function (k) { report[k] = extra[k]; });
  return report;
}

function builderConfig() {
  return {
    appId: APP_ID,
    productName: EDITION === 'demo' ? PRODUCT_NAME + ' Demo' : PRODUCT_NAME,
    executableName: EXECUTABLE_NAME,
    copyright: '',
    asar: false,
    electronVersion: ROOT_PKG.devDependencies.electron,
    // 直接用 node_modules 裡已下載的 Electron，不再另外下載一份
    electronDist: path.join(REPO, 'node_modules', 'electron', 'dist'),
    // Chromium 語系檔：只留繁中與英文（其餘約 40 MB 玩家用不到）
    electronLanguages: ['zh-TW', 'en-US'],
    npmRebuild: false,
    buildDependenciesFromSource: false,
    directories: { output: OUT },
    files: ['**/*'],
    win: { target: [{ target: 'dir', arch: ['x64'] }], icon: APP_ICON }
  };
}

/* 出貨只看 git 追蹤的檔案，所以「新增了但還沒 add」的執行期檔案會被靜靜漏掉——
   2026-11-17 打包版就是這樣少了 electron/save-files.cjs，一啟動就崩潰。打包前先擋下來。 */
function untrackedRuntimeFiles() {
  var out = childProcess.execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: REPO, maxBuffer: 1 << 26 });
  return out.toString('utf8').split('\0').filter(Boolean).filter(function (p) { return Rules.classify(p).ship; });
}

function main() {
  var stageOnly = process.argv.indexOf('--stage-only') >= 0;
  var t0 = Date.now();
  var untracked = untrackedRuntimeFiles();
  if (untracked.length) {
    console.error('❌ 下列執行期檔案還沒加入 git，打包會漏掉它們（先 git add／commit 再打包）：\n  ' + untracked.join('\n  '));
    process.exit(1);
  }
  var list = collect();
  if (list.missing.length) {
    console.error('❌ git 追蹤中但工作副本裡不存在的出貨檔（刪了沒提交？）：\n  ' + list.missing.join('\n  '));
    process.exit(1);
  }
  var st = stage(list);
  if (EDITION === 'demo') {
    // 新檔（不是硬連結），只存在暫存區；原始碼裡沒有這個檔，從原始碼執行時一律是正式版（除非 --demo）
    fs.writeFileSync(path.join(STAGE, 'electron', 'edition.json'), JSON.stringify({ edition: 'demo' }, null, 2) + '\n');
    console.log('版本：demo（electron/edition.json）');
  }
  if (INSTALLER) {
    detachSteam();
    console.log('安裝包版：不接 Steam（已移除 steamworks.js、AppID 歸 0）');
  }
  console.log('暫存：' + list.ship.length + ' 個檔案（硬連結 ' + st.linked + '、複製 ' + st.copied + '）→ ' + path.relative(REPO, STAGE));
  var modelTextures = null;
  if (!stageOnly && process.argv.indexOf('--full-textures') < 0) {
    var shrunk = shrinkModels();
    list.ship.forEach(function (f) { if (shrunk.sizes[f.path] != null) f.size = shrunk.sizes[f.path]; });
    modelTextures = { beforeMB: shrunk.beforeMB, afterMB: shrunk.afterMB };
  }
  var pngToWebp = null;
  if (!stageOnly && process.argv.indexOf('--keep-png') < 0) {
    var webp = webpImages();
    list.ship.forEach(function (f) { if (webp.sizes[f.path] != null) f.size = webp.sizes[f.path]; });
    pngToWebp = { beforeMB: webp.beforeMB, afterMB: webp.afterMB, converted: webp.converted };
  }
  var videos = null;
  if (!stageOnly && process.argv.indexOf('--keep-video') < 0) {
    var vid = reencodeVideos();
    list.ship.forEach(function (f) { if (vid.sizes[f.path] != null) f.size = vid.sizes[f.path]; });
    videos = { beforeMB: vid.beforeMB, afterMB: vid.afterMB };
  }
  fs.mkdirSync(OUT, { recursive: true });
  var reportFile = path.join(OUT, 'ship-report.json');
  if (stageOnly) {
    var r0 = summarize(list, { stageOnly: true });
    fs.writeFileSync(reportFile, JSON.stringify(r0, null, 2));
    console.log('出貨 ' + r0.shippedMB + ' MB，排除 ' + r0.excludedMB + ' MB；報告：' + path.relative(REPO, reportFile));
    return Promise.resolve();
  }
  var builder = require('electron-builder');
  rmrf(path.join(OUT, 'win-unpacked'));
  return builder.build({
    projectDir: STAGE,
    targets: builder.Platform.WINDOWS.createTarget('dir', builder.Arch.x64),
    config: builderConfig(),
    publish: 'never'
  }).then(function () {
    var unpacked = path.join(OUT, 'win-unpacked');
    // electronDist 原樣複製進來的 Electron 示範程式；有 resources/app 時永遠用不到
    rmrf(path.join(unpacked, 'resources', 'default_app.asar'));
    var r = summarize(list, {
      output: path.relative(REPO, unpacked),
      executable: EXECUTABLE_NAME + '.exe',
      outputMB: mb(dirSize(unpacked)),
      modelTextures: modelTextures || 'full（--full-textures）',
      pngToWebp: pngToWebp || 'png（--keep-png）',
      videos: videos || 'original（--keep-video）',
      seconds: Math.round((Date.now() - t0) / 1000)
    });
    fs.writeFileSync(reportFile, JSON.stringify(r, null, 2));
    console.log('✅ 完成：' + r.output + '\\' + r.executable + '（資料夾 ' + r.outputMB + ' MB，遊戲檔 ' + r.shippedMB + ' MB，排除 ' + r.excludedMB + ' MB）');
    console.log('   報告：' + path.relative(REPO, reportFile));
    if (!INSTALLER) return null;
    console.log('製作安裝包（NSIS，約數分鐘）…');
    return builder.build({
      projectDir: STAGE,
      prepackaged: unpacked,
      targets: builder.Platform.WINDOWS.createTarget('nsis', builder.Arch.x64),
      config: installerConfig(),
      publish: 'never'
    }).then(function (files) {
      var setup = (files || []).filter(function (f) { return /\.exe$/i.test(f); })[0];
      if (!setup) throw new Error('electron-builder 沒有產生安裝檔：' + JSON.stringify(files));
      r.installer = path.relative(REPO, setup);
      r.installerMB = mb(fs.statSync(setup).size);
      r.seconds = Math.round((Date.now() - t0) / 1000);
      fs.writeFileSync(reportFile, JSON.stringify(r, null, 2));
      console.log('✅ 安裝包：' + r.installer + '（' + r.installerMB + ' MB）');
    });
  });
}

if (require.main === module) {
  main().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
}

module.exports = { collect: collect, builderConfig: builderConfig, installerConfig: installerConfig, fileSafeName: fileSafeName, GAME_NAME_STR_ID: GAME_NAME_STR_ID };
