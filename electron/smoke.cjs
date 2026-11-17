'use strict';
/* ============ 桌面版冒煙測試（npm run desktop:smoke）============
   在隔離的 userData（<outDir>/userData）開一次遊戲，結果寫進 <outDir>/smoke-report.json 與 smoke.png。

   流程：等開始選單 → 有「繼續」就按繼續，沒有就按「新遊戲」→ 等 Worker 開機與揭幕
        → 收集環境檢查與截圖 → 走一次正常關窗（觸發關窗存檔）。
   連跑兩次（不清 userData）時，第二次的 continueVisible 為 true 就代表第一次關窗存檔有落地。

   兩種模式：
   - 預設背景模式：視窗從不顯示（關掉背景節流，頁面照常畫格），不打擾正在用電腦的人
   - --smoke-onscreen：顯示視窗，加做螢幕實拍（空白畫面偵測）與全螢幕往返；
     會短暫置頂並切換全螢幕，跑之前要先跟使用者說

   這是給人跟 AI 自測用的開機檢查，不是遊戲測試：只回答「桌面外殼有沒有把遊戲跑起來、
   GM 工具有沒有外露、關窗會不會存檔」。 */

var fs = require('fs');
var path = require('path');

var CHECK_SCRIPT = [
  '(async function(){',
  '  var r = {};',
  '  r.href = location.href;',
  '  r.origin = location.origin;',
  "  r.apexHost = typeof window.ApexHost === 'object' && !!window.ApexHost && window.ApexHost.isDesktop === true;",
  "  r.isInternalServer = typeof isInternalServer === 'function' ? isInternalServer() : 'missing';",
  "  r.isGMHost = typeof isGMHost === 'function' ? isGMHost() : 'missing';",
  "  r.pixi = typeof PIXI !== 'undefined' ? (PIXI.VERSION || true) : false;",
  "  var ws = typeof WorkerBridge !== 'undefined' ? WorkerBridge.status() : null;",
  '  r.worker = ws && { booted: ws.booted, alive: ws.alive, ticks: ws.ticks, errors: ws.errors, persists: ws.persists, persistErrors: ws.persistErrors, lastError: ws.lastError };',
  "  r.battleRenderer = typeof BattleRenderer !== 'undefined' ? BattleRenderer.status() : null;",
  '  r.canvases = document.querySelectorAll("canvas").length;',
  '  r.fullscreen = !!document.fullscreenElement;',
  '  r.viewport = [innerWidth, innerHeight, devicePixelRatio];',
  '  r.title = document.title;',
  '  r.visibility = document.visibilityState;',
  // 設定頁「開啟存檔資料夾」：ApexHost.openSaveFolder 存在時 ui.js 會顯示（不實際按，會開檔案總管）
  "  r.openSaveFolderButton = (function(){ var b = document.getElementById('btn-open-save-folder'); return b ? !b.hidden : 'missing'; })();",
  "  r.saveDirIsDesktop = typeof _saveDir !== 'undefined' && !!_saveDir && _saveDir.isDesktop === true;",
  '  r.bodyClass = document.body.className;',
  "  r.loadingVisible = (function(){ var el = document.getElementById('loading-screen'); return !!el && !el.classList.contains('is-hidden'); })();",
  '  r.idb = await new Promise(function(res){ try { var q = indexedDB.open("__desktop_smoke__", 1); q.onsuccess = function(){ q.result.close(); res(true); }; q.onerror = function(){ res(false); }; } catch (e) { res("throw: " + e.message); } });',
  "  r.locks = !!(navigator.locks && navigator.locks.request);",
  "  try { var f = await fetch('vfx/shipped-assets.json', { cache: 'no-store' }); r.fetchStatus = f.status; } catch (e) { r.fetchStatus = 'throw: ' + e.message; }",
  // 影片串流要靠 206；序章影片在新遊戲才播，冒煙測試會跳過，所以直接驗協議
  "  try { var v = await fetch('opening_animation/shots-01-05-replay.mp4?v=6', { headers: { Range: 'bytes=0-99' } }); r.videoRange = v.status + ' ' + v.headers.get('content-range') + ' ' + (await v.arrayBuffer()).byteLength; } catch (e) { r.videoRange = 'throw: ' + e.message; }",
  '  return r;',
  '})()'
].join('\n');

var MENU_READY = "(function(){ var b = document.getElementById('start-menu-new'); var l = document.getElementById('loading-screen');" +
  " return !!b && b.offsetParent !== null && !!l && l.classList.contains('is-hidden'); })()";
var CONTINUE_VISIBLE = "(function(){ var b = document.getElementById('start-menu-continue'); return !!b && !b.hidden && b.offsetParent !== null; })()";
var CLICK_START = "(function(){ var c = document.getElementById('start-menu-continue');" +
  " if (c && !c.hidden && c.offsetParent !== null) { c.click(); return 'continue'; }" +
  " document.getElementById('start-menu-new').click(); return 'new'; })()";
var GAME_REVEALED = "typeof WorkerBridge !== 'undefined' && WorkerBridge.status().booted === true &&" +
  " !document.body.classList.contains('start-menu-pending') &&" +
  " document.getElementById('loading-screen').classList.contains('is-hidden') &&" +
  " !(window.IntroPlayer && IntroPlayer.isPlaying && IntroPlayer.isPlaying())";
// 新遊戲會播序章；冒煙測試不看演出，直接跳過
var SKIP_INTRO = "(function(){ if (window.IntroPlayer && IntroPlayer.isPlaying && IntroPlayer.isPlaying()) { IntroPlayer.abort('skip'); return true; } return false; })()";

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* 螢幕上實際看到的畫面（作業系統截的，不是 Chromium 內部的 capturePage）。
   2026-11-17 開 in-process-gpu 時頁面正常在跑、capturePage 也截得到遊戲，螢幕上卻是一片淡青色——
   只看 capturePage 的冒煙測試會當成通過。這裡用亮度標準差判斷畫面是不是單色。 */
function captureOnScreen(win, outFile) {
  var electron = require('electron');
  // 截「整個螢幕」再裁視窗範圍：單一視窗的擷取（types: window）在 in-process-gpu 下照樣截得到遊戲，
  // 抓不到「送不上螢幕」這種問題。截圖期間暫時置頂，避免被別的視窗蓋住。
  win.show();
  win.setAlwaysOnTop(true);
  win.moveTop();
  win.focus();
  var bounds = win.getBounds();
  var display = electron.screen.getDisplayMatching(bounds);
  var scale = display.scaleFactor || 1;
  return sleep(1000).then(function () {
    return electron.desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) }
    });
  }).then(function (sources) {
    win.setAlwaysOnTop(false);
    var src = sources.filter(function (s) { return String(s.display_id) === String(display.id); })[0] || sources[0];
    if (!src || src.thumbnail.isEmpty()) return { found: false };
    var crop = src.thumbnail.crop({
      x: Math.max(0, Math.round((bounds.x - display.bounds.x) * scale)),
      y: Math.max(0, Math.round((bounds.y - display.bounds.y) * scale)),
      width: Math.round(bounds.width * scale),
      height: Math.round(bounds.height * scale)
    }).resize({ width: 800 });
    fs.writeFileSync(outFile, crop.toPNG());
    var size = crop.getSize();
    var bmp = crop.toBitmap();   // BGRA
    var n = 0, sum = 0, sum2 = 0;
    // 只量內側：跳過上方 8% 的標題列與四周 5%（視窗陰影、邊緣會露出後面的視窗），每 7 個像素取一個
    for (var y = Math.floor(size.height * 0.08); y < Math.floor(size.height * 0.95); y += 7) {
      for (var x = Math.floor(size.width * 0.05); x < Math.floor(size.width * 0.95); x += 7) {
        var i = (y * size.width + x) * 4;
        var lum = 0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2];
        n++; sum += lum; sum2 += lum * lum;
      }
    }
    var mean = sum / n;
    var std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    return { found: true, meanLum: Math.round(mean), stdLum: Math.round(std * 10) / 10, blank: std < 6 };
  }).catch(function (e) { return { found: false, error: String(e && e.message || e) }; });
}

function run(win, ctx) {
  var outDir = ctx.outDir;
  var log = ctx.log;
  var wc = win.webContents;
  var report = { startedAt: new Date().toISOString(), pageErrors: [], steps: [] };
  fs.mkdirSync(outDir, { recursive: true });

  wc.on('console-message', function (event) {
    if (event.level === 'error' || event.level === 3) report.pageErrors.push(String(event.message).slice(0, 500));
  });

  var t0 = Date.now();
  function step(name, extra) {
    var s = { ms: Date.now() - t0, name: name };
    if (extra !== undefined) s.data = extra;
    report.steps.push(s);
    log('[smoke]', name, s.ms + 'ms', extra !== undefined ? JSON.stringify(extra).slice(0, 300) : '');
  }
  function evalJs(code) {
    return wc.executeJavaScript(code, true).catch(function (e) { return 'error: ' + (e && e.message); });
  }
  function waitFor(code, timeoutMs, onPoll) {
    var deadline = Date.now() + timeoutMs;
    var poll = function () {
      return evalJs(code).then(function (ok) {
        if (ok === true) return true;
        if (Date.now() > deadline) return false;
        return Promise.resolve(onPoll && onPoll()).then(function () { return sleep(500); }).then(poll);
      });
    };
    return poll();
  }
  /* 總結：任何一項不過就是失敗，結束碼 1（給打包流程與 AI 自測判讀） */
  function verdict() {
    var c = report.checks || {};
    var fails = [];
    if (report.fatal) fails.push('fatal');
    if (!c.worker || c.worker.booted !== true) fails.push('worker 未開機');
    if (c.loadingVisible !== false) fails.push('Loading 未揭開');
    if (c.isGMHost !== false || c.isInternalServer !== false) {
      // --url 載本機內測服時 GM 本來就該開，只有 app:// 時才算失敗
      if (String(c.origin) === 'app://game') fails.push('GM／內測工具外露');
    }
    if (report.screen && report.screen.skipped) { /* 背景模式不做螢幕實拍 */ }
    else if (!report.screen || !report.screen.found) fails.push('螢幕截圖失敗');
    else if (report.screen.blank) fails.push('螢幕上是空白畫面');
    if (String(c.origin) === 'app://game' && c.saveDirIsDesktop !== true) fails.push('存檔資料夾沒有接上 userData/saves');
    if (report.flush !== 'ok') fails.push('關窗存檔：' + report.flush);
    else if (String(c.origin) === 'app://game' && (report.saveFiles || []).indexOf('IC_autosave_app-game.json') < 0) {
      fails.push('存檔資料夾裡沒有自動存檔檔');
    }
    if (report.fullscreenOn && !(report.fullscreenOn.page && report.fullscreenOn.window)) fails.push('全螢幕無法進入');
    if (report.fullscreenOn && !report.fullscreenOn.coversDisplay) fails.push('全螢幕內容未覆蓋整個螢幕');
    if (report.fullscreenOff && (report.fullscreenOff.page || report.fullscreenOff.window)) fails.push('全螢幕無法離開');
    if (report.maximizeOn && !(report.maximizeOn.page && report.maximizeOn.window && report.maximizeOn.coversDisplay)) {
      fails.push('Windows 最大化未進入原生全螢幕');
    }
    if (report.maximizeOff && (report.maximizeOff.page || report.maximizeOff.window || !report.maximizeOff.restored)) {
      fails.push('離開全螢幕後未還原原視窗');
    }
    if (report.pageErrors.length) fails.push('頁面錯誤 ' + report.pageErrors.length + ' 筆');
    // 打包版少檔最直接的訊號：app:// 回了 404（開發模式下也應該是 0）
    if (report.notFound && report.notFound.length) fails.push('找不到檔案 ' + report.notFound.length + ' 個');
    return fails;
  }
  function finish() {
    report.finishedAt = new Date().toISOString();
    var stats = global.__desktopRequestStats;
    if (stats) report.notFound = stats.notFound.slice();
    // 任務 D：Steam 狀態（沒接 Steam 不算失敗，只記錄原因）
    try { report.steam = global.__desktopSteam ? global.__desktopSteam() : null; } catch (e) { report.steam = { error: String(e) }; }
    // 任務 C：存檔要落在 userData/saves（Steam Auto-Cloud 同步的資料夾）
    try {
      report.saveFiles = fs.readdirSync(global.__desktopSavesDir).sort();
    } catch (e) { report.saveFiles = []; }
    report.failures = verdict();
    report.ok = report.failures.length === 0;
    fs.writeFileSync(path.join(outDir, 'smoke-report.json'), JSON.stringify(report, null, 2));
    step('report-written', { ok: report.ok, failures: report.failures });
    if (!win.isDestroyed()) win.destroy();
    require('electron').app.exit(report.ok ? 0 : 1);
  }

  wc.once('did-finish-load', function () {
    var rs = global.__desktopRequestStats;
    step('did-finish-load', rs && { requests: rs.count, mb: Math.round(rs.bytes / 1048576 * 10) / 10, slow: rs.slow.slice(0, 10) });
    waitFor(MENU_READY, 90000).then(function (ok) {
      step('start-menu', { ready: ok });
      if (!ok) throw new Error('開始選單沒有出現');
      return evalJs(CONTINUE_VISIBLE);
    }).then(function (cont) {
      report.continueVisible = cont === true;
      return evalJs(CLICK_START);
    }).then(function (clicked) {
      step('clicked', clicked);
      return waitFor(GAME_REVEALED, 120000, function () { return evalJs(SKIP_INTRO); });
    }).then(function (ok) {
      step('game-revealed', { ok: ok });
      return sleep(Number(process.env.SMOKE_SETTLE_MS) || 6000);
    }).then(function () {
      return evalJs(CHECK_SCRIPT);
    }).then(function (checks) {
      report.checks = checks;
      step('checks', checks);
      return wc.capturePage();
    }).then(function (image) {
      fs.writeFileSync(path.join(outDir, 'smoke.png'), image.toPNG());
      step('screenshot');
      /* 背景模式（預設）到此為止：螢幕實拍要把視窗置頂、全螢幕往返會佔滿整個螢幕，
         都會打斷正在用電腦的人，只在 --smoke-onscreen 時做。 */
      if (!ctx.onScreen) {
        report.screen = { skipped: 'background' };
        return ctx.flushSave(win);
      }
      return captureOnScreen(win, path.join(outDir, 'smoke-screen.png')).then(onScreenChecks);
    }).then(function (flush) {
      report.flush = flush;
      finish();
    }).catch(function (e) {
      report.fatal = String(e && e.stack || e);
      log('[smoke] 失敗：', report.fatal);
      wc.capturePage().then(function (image) {
        fs.writeFileSync(path.join(outDir, 'smoke.png'), image.toPNG());
      }).catch(function () {}).then(finish);
    });

    async function onScreenChecks(screen) {
      report.screen = screen;
      step('on-screen', screen);
      pressF11();
      report.fullscreenOn = await readFullscreen();
      pressF11();
      report.fullscreenOff = await readFullscreen();
      step('fullscreen', { on: report.fullscreenOn, off: report.fullscreenOff });

      if (process.platform === 'win32') {
        var normalBounds = win.getBounds();
        win.focus();
        win.maximize();
        report.maximizeOn = await readFullscreen();
        pressF11();
        report.maximizeOff = await readFullscreen();
        report.maximizeOff.restored = !win.isMaximized() && sameBounds(win.getBounds(), normalBounds);
        step('maximize-fullscreen', { on: report.maximizeOn, off: report.maximizeOff });
      }
      return ctx.flushSave(win);
    }

    function sameBounds(actual, expected) {
      return Object.keys(expected).every(function (key) { return actual[key] === expected[key]; });
    }

    async function readFullscreen() {
      await sleep(1500);
      var page = await evalJs('!!document.fullscreenElement');
      var display = require('electron').screen.getDisplayMatching(win.getBounds()).bounds;
      return {
        page: page,
        window: win.isFullScreen(),
        coversDisplay: sameBounds(win.getContentBounds(), display)
      };
    }

    function pressF11() {
      win.focus();
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
    }
  });
}

module.exports = { run: run };
