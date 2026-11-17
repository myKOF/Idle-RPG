'use strict';
/* ============ 桌面版打包（Steam 任務 B）：npm run desktop:pack ============
   1. 依 tools/desktop/ship-rules.cjs 從 git 追蹤的檔案挑出出貨清單
   2. 以硬連結（失敗才複製）放進暫存目錄 build/desktop/app/，另寫一份精簡的 package.json
   3. electron-builder 打成 dist/win-unpacked/（x64、免安裝資料夾：SteamPipe 上傳的就是它）
   4. 輸出 dist/ship-report.json：出貨檔數與大小、各目錄大小、每條排除規則排掉了什麼

   參數：
     --stage-only   只做到第 2 步（檢查清單用，不呼叫 electron-builder）

   ---- 為什麼 asar: false ----
   SteamPipe 以 1 MB 區塊比對新舊版本。asar 是一個巨大的單檔，裡面任何檔案變長或變短，
   後面所有區塊都會位移，一次小更新可能讓玩家重新下載整包；散檔則只會傳有變動的檔案。
   asar 也不提供保護（任何人都能解開），所以沒有理由用它。

   ---- 為什麼要暫存目錄 ----
   electron-builder 的 files 只吃 glob，表達不了「git 追蹤 ∩ 白名單 − 排除」；
   而且專案根目錄的 package.json 帶著 devDependencies 與開發腳本，不該出現在玩家的資料夾裡。 */

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var Rules = require('./ship-rules.cjs');

var REPO = path.resolve(__dirname, '..', '..');
var STAGE = path.join(REPO, 'build', 'desktop', 'app');
var OUT = path.join(REPO, 'dist');
var ROOT_PKG = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));

/* 玩家看得到的名稱。exe 檔名刻意用 ASCII：Steam 的啟動選項、防毒白名單、命令列都比較不會出事。
   上市前請確認正式名稱（見 docs/steam/STEAM_RELEASE_PLAN.md 任務 B 的待確認事項）。 */
var PRODUCT_NAME = '神力之巔：放置暗黑';
var EXECUTABLE_NAME = 'IdleRPG';
var APP_ID = 'com.idlerpg.desktop';

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
    productName: PRODUCT_NAME,
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
    win: { target: [{ target: 'dir', arch: ['x64'] }] }
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
  console.log('暫存：' + list.ship.length + ' 個檔案（硬連結 ' + st.linked + '、複製 ' + st.copied + '）→ ' + path.relative(REPO, STAGE));
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
      seconds: Math.round((Date.now() - t0) / 1000)
    });
    fs.writeFileSync(reportFile, JSON.stringify(r, null, 2));
    console.log('✅ 完成：' + r.output + '\\' + r.executable + '（資料夾 ' + r.outputMB + ' MB，遊戲檔 ' + r.shippedMB + ' MB，排除 ' + r.excludedMB + ' MB）');
    console.log('   報告：' + path.relative(REPO, reportFile));
  });
}

if (require.main === module) {
  main().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
}

module.exports = { collect: collect, builderConfig: builderConfig };
