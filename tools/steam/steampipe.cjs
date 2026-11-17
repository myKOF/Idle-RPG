'use strict';
/* ============ 上傳到 Steam（SteamPipe）：Steam 任務 E ============
   手冊見 docs/steam/STEAM_RELEASE_PLAN.md「任務 E：第一次上傳」。

     npm.cmd run steam:vdf       只驗證打包內容並產生 VDF（不需要 SDK、不登入、不上傳）
     npm.cmd run steam:preview   SteamCMD 預覽建置：完整跑一次但不上傳（要 SDK 與帳號）
     npm.cmd run steam:upload    正式上傳（要 SDK 與帳號）；上傳後到 Steamworks 網頁把建置設為上線

   參數（加在 npm.cmd run steam:xxx -- 後面）：
     --skip-pack          不重新打包，直接用現有的 dist/win-unpacked（仍會做內容檢查）
     --note=<文字>        附加在建置描述後面（顯示在後台 Builds 清單）
     --dry-appid=<編號>   只限 --vdf-only：用假的 AppID 演練產生 VDF（正式 AppID 還沒下來時用）

   流程（任何一步失敗就停，不會上傳半成品）：
     1. 建置檢查（tools/build_check.cjs）＋桌面版相關測試
     2. 打包（tools/desktop/build_desktop.cjs）＋對打包版跑背景冒煙測試（不顯示視窗）
     3. 內容檢查：exe 在、打包版裡的 AppID 與設定相同、沒有 steam_appid.txt
     4. 產生 VDF 到 build/steampipe/scripts/
     5. SteamCMD：+login <帳號> +run_app_build <VDF> +quit
        密碼與 Steam Guard 驗證碼由 SteamCMD 在這個終端機詢問；第一次驗證後會快取在這台電腦。 */

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var Vdf = require('./steampipe-vdf.cjs');

var REPO = path.resolve(__dirname, '..', '..');
var UNPACKED = path.join(REPO, 'dist', 'win-unpacked');
var OUT_DIR = path.join(REPO, 'build', 'steampipe');
var EXE_NAME = 'IdleRPG.exe';
var GATE_TESTS = ['tests/desktop-app-protocol.test.cjs', 'tests/desktop-ship-rules.test.cjs', 'tests/desktop-saves.test.cjs',
  'tests/desktop-steam.test.cjs', 'tests/save-schema.test.cjs', 'tests/steampipe.test.cjs', 'tests/start-menu.test.cjs',
  'tests/string-table.test.cjs'];

function arg(name) {
  var p = '--' + name + '=';
  for (var i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--' + name) return true;
    if (process.argv[i].indexOf(p) === 0) return process.argv[i].slice(p.length);
  }
  return null;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function step(title) { console.log('\n▶ ' + title); }
function fail(msg) { console.error('\n❌ ' + msg); process.exit(1); }

function run(cmd, args, opts) {
  var r = childProcess.spawnSync(cmd, args, Object.assign({ cwd: REPO, stdio: 'inherit', windowsHide: true }, opts || {}));
  if (r.error) fail('無法執行 ' + cmd + '：' + r.error.message);
  return r.status;
}

function git(args) {
  try { return childProcess.execFileSync('git', args, { cwd: REPO }).toString().trim(); } catch (e) { return ''; }
}

function findFiles(dir, name) {
  var hits = [];
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) {
      var p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase() === name) hits.push(p);
    });
  })(dir);
  return hits;
}

function main() {
  var mode = arg('upload') ? 'upload' : arg('preview') ? 'preview' : 'vdf';
  var dryAppId = Number(arg('dry-appid')) || 0;
  if (dryAppId && mode !== 'vdf') fail('--dry-appid 只能和 --vdf-only 一起用（假的 AppID 不能上傳）');

  /* ---- 設定 ---- */
  var steamConfig = readJson(path.join(REPO, 'electron', 'steam-config.json'), {});
  if (dryAppId) steamConfig = { appId: dryAppId };
  var pipeConfig = readJson(path.join(__dirname, 'steampipe.json'), {});
  var local = readJson(path.join(__dirname, 'steampipe.local.json'), {});
  var cfg = Vdf.resolveConfig({ steamConfig: steamConfig, pipeConfig: pipeConfig });
  if (cfg.errors.length) fail('設定有誤：\n  ' + cfg.errors.join('\n  '));
  var contentBuilder = process.env.STEAM_CONTENT_BUILDER || local.contentBuilderDir || '';
  var account = process.env.STEAM_BUILD_ACCOUNT || local.account || '';
  var steamcmd = contentBuilder ? path.join(contentBuilder, 'builder', 'steamcmd.exe') : '';
  if (mode !== 'vdf') {
    if (!steamcmd || !fs.existsSync(steamcmd)) {
      fail('找不到 SteamCMD：' + (steamcmd || '（未設定）') + '\n  請下載 Steamworks SDK，在 tools/steam/steampipe.local.json 填 contentBuilderDir（範本：steampipe.local.example.json）');
    }
    if (!account) fail('沒有設定上傳用的 Steam 帳號名稱：tools/steam/steampipe.local.json 的 account，或環境變數 STEAM_BUILD_ACCOUNT');
  }
  console.log('模式：' + { vdf: '只產生 VDF', preview: 'SteamCMD 預覽（不上傳）', upload: '正式上傳' }[mode] +
    '　AppID ' + cfg.appId + (dryAppId ? '（演練用）' : '') + '　Depot ' + cfg.depotId +
    (cfg.setLiveBranch && mode === 'upload' ? '　上傳後設為上線：' + cfg.setLiveBranch : ''));

  /* ---- 1～2. 檢查、測試、打包、冒煙 ---- */
  if (!arg('skip-pack')) {
    step('建置檢查');
    if (run(process.execPath, ['tools/build_check.cjs']) !== 0) fail('建置檢查失敗');
    step('桌面版相關測試');
    if (run(process.execPath, ['--test'].concat(GATE_TESTS)) !== 0) fail('測試失敗');
    step('打包');
    if (run(process.execPath, ['tools/desktop/build_desktop.cjs']) !== 0) fail('打包失敗');
    step('打包版冒煙測試（背景執行，不顯示視窗）');
    var smokeDir = path.join(REPO, 'tmp', 'steampipe-smoke');
    fs.rmSync(smokeDir, { recursive: true, force: true });
    if (run(path.join(UNPACKED, EXE_NAME), ['--smoke=' + smokeDir]) !== 0) {
      fail('打包版冒煙測試失敗，詳見 ' + path.relative(REPO, path.join(smokeDir, 'smoke-report.json')));
    }
  }

  /* ---- 3. 內容檢查 ---- */
  step('內容檢查');
  if (!fs.existsSync(path.join(UNPACKED, EXE_NAME))) fail('找不到 ' + path.relative(REPO, path.join(UNPACKED, EXE_NAME)) + '（先打包）');
  var shippedSteam = readJson(path.join(UNPACKED, 'resources', 'app', 'electron', 'steam-config.json'), {});
  if (!dryAppId && Number(shippedSteam.appId) !== cfg.appId) {
    fail('打包版裡的 AppID 是 ' + shippedSteam.appId + '，設定是 ' + cfg.appId + '——改了 electron/steam-config.json 之後要提交並重新打包');
  }
  var stray = findFiles(UNPACKED, 'steam_appid.txt');
  if (stray.length) fail('打包內容裡有 steam_appid.txt（不該存在）：\n  ' + stray.join('\n  '));
  var report = readJson(path.join(REPO, 'dist', 'ship-report.json'), {});
  console.log('  內容：' + path.relative(REPO, UNPACKED) + (report.outputMB ? '（' + report.outputMB + ' MB，' + report.builtAt + ' 打包）' : ''));

  /* ---- 4. VDF ---- */
  step('產生 VDF');
  var commit = git(['rev-parse', '--short', 'HEAD']);
  var dirty = git(['status', '--porcelain']) !== '';
  var desc = Vdf.buildDescription({
    version: readJson(path.join(REPO, 'package.json'), {}).version,
    commit: commit, dirty: dirty, date: new Date().toISOString().slice(0, 10), note: arg('note') || ''
  });
  if (dirty && mode === 'upload') console.warn('  ⚠️ 工作目錄有未提交的修改：建置描述會標 +dirty，之後追查不到確切的程式版本');
  var scripts = path.join(OUT_DIR, 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  var vdfs = Vdf.buildVdfs(cfg, { desc: desc, preview: mode !== 'upload', contentRoot: UNPACKED, buildOutput: path.join(OUT_DIR, 'output') });
  fs.mkdirSync(path.join(OUT_DIR, 'output'), { recursive: true });
  var appVdf = path.join(scripts, vdfs.appFile);
  fs.writeFileSync(appVdf, vdfs.appVdf);
  fs.writeFileSync(path.join(scripts, vdfs.depotFile), vdfs.depotVdf);
  console.log('  ' + path.relative(REPO, appVdf) + '\n  ' + path.relative(REPO, path.join(scripts, vdfs.depotFile)) + '\n  建置描述：' + desc);

  if (mode === 'vdf') {
    console.log('\n✅ VDF 已產生（沒有登入、沒有上傳）。');
    return;
  }

  /* ---- 5. SteamCMD ---- */
  step('SteamCMD（' + (mode === 'preview' ? '預覽，不會上傳' : '正式上傳') + '）');
  console.log('  若要求密碼或 Steam Guard 驗證碼，請直接在這個視窗輸入。');
  var code = run(steamcmd, ['+login', account, '+run_app_build', appVdf, '+quit'], { cwd: path.dirname(steamcmd) });
  if (code !== 0) fail('SteamCMD 結束碼 ' + code + '；日誌在 ' + path.relative(REPO, path.join(OUT_DIR, 'output')));
  if (mode === 'preview') {
    console.log('\n✅ 預覽完成（沒有上傳）。日誌在 ' + path.relative(REPO, path.join(OUT_DIR, 'output')));
  } else {
    console.log('\n✅ 上傳完成。到 Steamworks → 你的應用程式 → SteamPipe → Builds 找到「' + desc + '」，' +
      (cfg.setLiveBranch ? '已設為 ' + cfg.setLiveBranch + ' 分支上線；' : '') + '要發給玩家時在網頁上把它設為 default 分支上線。');
  }
}

main();
