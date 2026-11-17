'use strict';
/* ============ 桌面版冒煙測試（npm run desktop:smoke）============
   在隔離的 userData（<outDir>/userData）開一次遊戲，結果寫進 <outDir>/smoke-report.json 與 smoke.png。

   流程：等開始選單 → 有「繼續」就按繼續，沒有就按「新遊戲」→ 等 Worker 開機與揭幕
        → 收集環境檢查與截圖 → 走一次正常關窗（觸發關窗存檔）。
   連跑兩次（不清 userData）時，第二次的 continueVisible 為 true 就代表第一次關窗存檔有落地。

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
  '  r.bodyClass = document.body.className;',
  "  r.loadingVisible = (function(){ var el = document.getElementById('loading-screen'); return !!el && !el.classList.contains('is-hidden'); })();",
  '  r.idb = await new Promise(function(res){ try { var q = indexedDB.open("__desktop_smoke__", 1); q.onsuccess = function(){ q.result.close(); res(true); }; q.onerror = function(){ res(false); }; } catch (e) { res("throw: " + e.message); } });',
  "  r.locks = !!(navigator.locks && navigator.locks.request);",
  "  try { var f = await fetch('params_version.txt', { cache: 'no-store' }); r.fetchStatus = f.status; } catch (e) { r.fetchStatus = 'throw: ' + e.message; }",
  // 影片串流要靠 206；序章影片在新遊戲才播，冒煙測試會跳過，所以直接驗協議
  "  try { var v = await fetch('images/intro-parchment/shot-01-03.mp4?v=1', { headers: { Range: 'bytes=0-99' } }); r.videoRange = v.status + ' ' + v.headers.get('content-range') + ' ' + (await v.arrayBuffer()).byteLength; } catch (e) { r.videoRange = 'throw: ' + e.message; }",
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
  function finish() {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outDir, 'smoke-report.json'), JSON.stringify(report, null, 2));
    step('report-written');
    if (!win.isDestroyed()) win.destroy();
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
      // F11 走的同一條路：代按網頁全螢幕，視窗要跟著進入，再按一次要能離開
      return ctx.toggleFullscreen(win).then(function () { return sleep(1500); }).then(function () {
        report.fullscreenOn = { page: null, window: win.isFullScreen() };
        return evalJs('!!document.fullscreenElement');
      }).then(function (pageFs) {
        report.fullscreenOn.page = pageFs;
        return ctx.toggleFullscreen(win);
      }).then(function () { return sleep(1500); }).then(function () {
        report.fullscreenOff = { window: win.isFullScreen() };
        step('fullscreen', { on: report.fullscreenOn, off: report.fullscreenOff });
        return ctx.flushSave(win);
      });
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
  });
}

module.exports = { run: run };
