'use strict';
/* ============ Electron 主行程：桌面版外殼 ============
   計畫與決策見 docs/steam/STEAM_RELEASE_PLAN.md（任務 A）。

   這支只負責「把網頁版原封不動跑在桌面視窗裡」，遊戲程式不知道自己在 Electron：
   - 檔案經 app://game 伺服（electron/app-protocol.cjs），不走 file://
   - 全螢幕由外殼切換原生視窗，並同步遊戲的 HTML 全螢幕與頂欄按鈕狀態
   - 關窗前呼叫遊戲既有的 WorkerBridge.saveAutoNow() 把進度落地，再真正關閉
   - 雙開由 requestSingleInstanceLock 擋下（取代網頁版 tablock.js 的多分頁鎖的角色；
     tablock 照樣運作，只是同一個 origin 永遠只會有一個視窗）

   啟動參數（npm run desktop -- <參數>）：
     --dev            允許 F12 開發者工具、F5 重新整理
     --url=<網址>     改載本機內測服（只接受 localhost／127.0.0.1），GM 與內測工具隨之開放
     --windowed       開機不進全螢幕
     --in-process-gpu 開啟 in-process-gpu（Steam Overlay 需要；單獨開會讓畫面空白，見下方說明）
     --profile=<資料夾> 改用另一份 userData（可與正在玩的視窗並存，除錯用）
     --steam-appid=<編號> 以指定 AppID 接 Steam（開發測試用 480）；正式值寫在 electron/steam-config.json
     --no-steam-overlay 接 Steam 但不開 Overlay（畫面異常時的退路）
     --smoke=<資料夾> 冒煙測試：隔離的 userData、開機後截圖並輸出檢查結果，然後關閉。
                      預設在背景跑（視窗不顯示），不打擾正在用電腦的人
     --smoke-onscreen 冒煙測試改為顯示視窗，加做螢幕實拍（空白畫面偵測）與全螢幕往返；
                      會短暫置頂並切換全螢幕，跑之前先跟使用者說 */

/* 冒煙測試在背景跑，主行程出錯時不能彈出 Electron 的錯誤對話框（會蓋在使用者正在用的畫面上）：
   改成印到 stderr、以結束碼 1 退出。必須放在所有 require 之前——2026-11-17 打包版漏了
   save-files.cjs，require 失敗的對話框連跳兩次。正式模式維持 Electron 預設（對話框讓玩家看得到）。 */
if (process.argv.some(function (a) { return a.indexOf('--smoke') === 0; })) {
  process.on('uncaughtException', function (e) {
    try { process.stderr.write('[smoke] 主行程例外：' + (e && e.stack || e) + '\n'); } catch (x) {}
    process.exit(1);
  });
}

var path = require('path');
var fs = require('fs');
var stream = require('stream');
var electron = require('electron');
var app = electron.app;
var BrowserWindow = electron.BrowserWindow;
var protocol = electron.protocol;
var session = electron.session;
var shell = electron.shell;
var Menu = electron.Menu;
var ipcMain = electron.ipcMain;
var AppProtocol = require('./app-protocol.cjs');
var SaveFiles = require('./save-files.cjs');

/* ---- 啟動參數 ---- */
function argValue(name) {
  var prefix = '--' + name + '=';
  for (var i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--' + name) return true;
    if (process.argv[i].indexOf(prefix) === 0) return process.argv[i].slice(prefix.length);
  }
  return null;
}
var OPTS = {
  dev: !!argValue('dev'),
  url: typeof argValue('url') === 'string' ? argValue('url') : null,
  windowed: !!argValue('windowed'),
  inProcessGpu: !!argValue('in-process-gpu'),
  smoke: typeof argValue('smoke') === 'string' ? path.resolve(argValue('smoke')) : null,
  smokeOnScreen: !!argValue('smoke-onscreen'),
  profile: typeof argValue('profile') === 'string' ? path.resolve(argValue('profile')) : null,
  steamAppId: typeof argValue('steam-appid') === 'string' ? Number(argValue('steam-appid')) : 0,
  steamOverlay: !argValue('no-steam-overlay')
};

/* ---- userData 位置凍結 ----
   Steam Auto-Cloud 會指向這個資料夾，上市後就不能再搬。預設值取自 package.json 的 name，
   日後若改 productName 會讓它跟著換位置——所以這裡寫死，不讓它隨打包設定漂移。 */
var USER_DATA_DIR_NAME = 'idle-rpg';
if (OPTS.smoke) {
  app.setPath('userData', path.join(OPTS.smoke, 'userData'));
} else if (OPTS.profile) {
  // 另一份隔離的資料夾：單一實例鎖以 userData 為準，所以能和正在玩的那個視窗並存
  app.setPath('userData', OPTS.profile);
} else {
  app.setPath('userData', path.join(app.getPath('appData'), USER_DATA_DIR_NAME));
}

/* ---- 日誌：userData/logs/desktop.log（超過 1 MB 就從頭寫） ---- */
var LOG_FILE = path.join(app.getPath('userData'), 'logs', 'desktop.log');
function log() {
  var line = new Date().toISOString() + ' ' + Array.prototype.join.call(arguments, ' ') + '\n';
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    var size = 0;
    try { size = fs.statSync(LOG_FILE).size; } catch (e) {}
    if (size > 1024 * 1024) fs.writeFileSync(LOG_FILE, line); else fs.appendFileSync(LOG_FILE, line);
  } catch (e) {}
  if (OPTS.dev || OPTS.smoke) process.stdout.write(line);
}

/* ---- 開機前必須完成的設定 ---- */
/* in-process-gpu 預設關閉（2026-11-17 實測）：單獨開它時，視窗在螢幕上是一片淡青色空白，
   頁面其實正常在跑（capturePage 截得到畫面）——合成結果送不上螢幕。
   Steam Overlay（Shift+Tab）需要它，steamworks.js 的建議是搭配 disable-direct-composition
   一起開；任務 D 接 Overlay 時兩個一起實測，通過才改成預設。 */
if (OPTS.inProcessGpu) {
  app.commandLine.appendSwitch('in-process-gpu');
}
/* 刻意不加 disable-frame-rate-limit：主執行緒已知會被 rAF 塞滿而餓死計時器
   （見 docs 與 2026-10-06 調查），解除 vsync 上限只會更糟。 */

protocol.registerSchemesAsPrivileged([{
  scheme: AppProtocol.SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true }
}]);

/* Steam（任務 D）：必須在 app ready 之前初始化——Overlay 要加的 GPU 參數只在 ready 前有效。
   任何失敗都只是「Steam 功能關閉」，遊戲照常啟動。 */
var Steam = require('./steam.cjs').create({
  cliAppId: OPTS.steamAppId,
  configAppId: require('./steam.cjs').readConfig(__dirname).appId,
  isPackaged: app.isPackaged,
  dev: OPTS.dev,
  smoke: !!OPTS.smoke,
  overlay: OPTS.steamOverlay,
  log: log
});

if (Steam.shouldQuitForRestart()) {
  // 玩家直接點了資料夾裡的 exe：Steam 會用正確的方式重新啟動遊戲，這一份直接結束
  app.quit();
} else if (!OPTS.smoke && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', function () {
    var win = mainWindow;
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(onReady);
}

var mainWindow = null;
var GAME_ROOT = app.getAppPath();

/* 冒煙測試用的請求統計：數量、位元組、最慢的幾筆（開到 stat 完成為止的時間） */
var requestStats = { count: 0, bytes: 0, slow: [], notFound: [] };
global.__desktopRequestStats = requestStats;

/* ---- app:// 的檔案伺服 ---- */
function serveFile(request) {
  if (!OPTS.smoke) return serveFileImpl(request);
  var t0 = Date.now();
  return serveFileImpl(request).then(function (res) {
    var ms = Date.now() - t0;
    requestStats.count++;
    requestStats.bytes += Number(res.headers.get('content-length')) || 0;
    if (ms > 200) requestStats.slow.push(ms + 'ms ' + request.url);
    return res;
  });
}

function serveFileImpl(request) {
  var file = AppProtocol.resolveRequestPath(GAME_ROOT, request.url);
  var notFound = function () {
    log('[app] 404', request.url);
    if (OPTS.smoke && requestStats.notFound.length < 200) requestStats.notFound.push(request.url);
    return new Response('Not Found', { status: 404 });
  };
  if (!file) return Promise.resolve(notFound());
  return fs.promises.stat(file).then(function (st) {
    if (!st.isFile()) return notFound();
    var headers = {
      'Content-Type': AppProtocol.mimeFor(file),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    };
    var range = AppProtocol.parseRange(request.headers.get('range'), st.size);
    if (range === false) {
      headers['Content-Range'] = 'bytes */' + st.size;
      return new Response(null, { status: 416, headers: headers });
    }
    var start = range ? range.start : 0;
    var end = range ? range.end : st.size - 1;
    headers['Content-Length'] = String(st.size === 0 ? 0 : end - start + 1);
    if (range) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + st.size;
    if (request.method === 'HEAD' || st.size === 0) {
      return new Response(null, { status: range ? 206 : 200, headers: headers });
    }
    var body = stream.Readable.toWeb(fs.createReadStream(file, { start: start, end: end }));
    return new Response(body, { status: range ? 206 : 200, headers: headers });
  }, notFound);
}

/* 只接受本機內測服；外部網址一律不載入（外殼不是瀏覽器）。 */
function devUrlAllowed(url) {
  try {
    var u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') &&
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]');
  } catch (e) { return false; }
}

function startUrl() {
  if (OPTS.url) {
    if (devUrlAllowed(OPTS.url)) return OPTS.url;
    log('[desktop] 拒絕 --url（只接受 localhost／127.0.0.1）：', OPTS.url);
  }
  return AppProtocol.ORIGIN + '/index.html';
}

function sameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch (e) { return false; }
}

/* ---- 權限：只放行遊戲用得到的，其餘（通知、定位、相機…）一律拒絕。
   Electron 預設是全部允許，不設處理器等於把權限交給任何載入的內容。 ---- */
var ALLOWED_PERMISSIONS = {
  'fullscreen': true,
  'keyboardLock': true,
  'pointerLock': true,
  'clipboard-sanitized-write': true,
  'fileSystem': true,          // 網頁版的存檔資料夾（showDirectoryPicker）；任務 C 會在桌面版隱藏該功能
  'window-management': true    // Document Picture-in-Picture 迷你視窗
};
function setupPermissions(ses) {
  ses.setPermissionRequestHandler(function (wc, permission, callback) {
    callback(!!ALLOWED_PERMISSIONS[permission]);
  });
  ses.setPermissionCheckHandler(function (wc, permission) {
    return !!ALLOWED_PERMISSIONS[permission];
  });
}

/* ---- 全螢幕：開機、快捷鍵與 Windows 最大化沿用遊戲的 HTML 全螢幕 ----
   requestFullscreen 需要使用者手勢，executeJavaScript 的 userGesture 參數就是為此存在。
   這樣遊戲內的全螢幕按鈕和鍵盤處理都與網頁版一致。 */
var FULLSCREEN_ON = 'document.fullscreenElement ? true : document.documentElement.requestFullscreen().then(function(){return true;},function(){return false;})';
var FULLSCREEN_TOGGLE = 'document.fullscreenElement ? document.exitFullscreen().then(function(){return false;},function(){return true;}) : (' + FULLSCREEN_ON + ')';

function runInPage(win, code, userGesture) {
  if (!win || win.isDestroyed()) return Promise.resolve(null);
  return win.webContents.executeJavaScript(code, !!userGesture).catch(function (e) {
    log('[desktop] executeJavaScript 失敗：', e && e.message);
    return null;
  });
}

/* ---- 關窗前存檔 ----
   遊戲每 15 秒自動存一次（js/worker/sim.worker.js AUTOSAVE_SEC），直接關窗最多掉 15 秒進度。
   saveAutoNow() 會等主執行緒真的寫完 IndexedDB 才 resolve，本身有 10 秒逾時；
   外殼再包一層 12 秒，頁面整個卡死（executeJavaScript 永不回來）也一定關得掉。 */
var FLUSH_SCRIPT = [
  '(function(){',
  '  try {',
  "    if (typeof WorkerBridge === 'undefined' || !WorkerBridge.status().booted) return 'skip';",
  "    return WorkerBridge.saveAutoNow().then(function(){ return 'ok'; }, function(e){ return 'error: ' + (e && e.message); });",
  "  } catch (e) { return 'error: ' + e.message; }",
  '})()'
].join('\n');
var FLUSH_TIMEOUT_MS = 12000;

function flushSave(win) {
  var t0 = Date.now();
  var timeout = new Promise(function (resolve) { setTimeout(function () { resolve('timeout'); }, FLUSH_TIMEOUT_MS); });
  return Promise.race([runInPage(win, FLUSH_SCRIPT, false), timeout]).then(function (result) {
    log('[desktop] 關窗存檔：', result, (Date.now() - t0) + 'ms');
    return result;
  });
}

function createWindow() {
  var wantFullscreen = !OPTS.windowed && !OPTS.smoke;
  var win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    fullscreen: wantFullscreen,
    show: false,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    // 視窗標題跟隨頁面 <title>（String 表 48），不在外殼另寫一份
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // 由下面的 HTML 全螢幕事件統一切換原生視窗。
      disableHtmlFullscreenWindowResize: true,
      // 背景冒煙測試的視窗從不顯示：不關節流的話頁面會被判成隱藏、畫格停止，Loading 永遠不揭幕
      backgroundThrottling: !(OPTS.smoke && !OPTS.smokeOnScreen)
    }
  });
  mainWindow = win;
  var url = startUrl();
  var wc = win.webContents;
  log('[desktop] 啟動', app.getVersion(), 'electron', process.versions.electron, '→', url);

  win.once('ready-to-show', function () {
    if (OPTS.smoke && !OPTS.smokeOnScreen) return;   // 背景冒煙測試：不顯示、不搶焦點
    win.show();
  });

  if (process.platform === 'win32') {
    win.on('maximize', function () {
      if (win.isMaximized() && !win.isFullScreen()) runInPage(win, FULLSCREEN_ON, true);
    });
  }

  win.on('enter-html-full-screen', function () {
    if (win.isFullScreen()) return;
    // 先回到原視窗，讓離開全螢幕時還原原本的尺寸與位置。
    if (process.platform === 'win32' && win.isMaximized()) win.unmaximize();
    win.setFullScreen(true);
  });
  win.on('leave-html-full-screen', function () {
    // 重新整理會清除頁面的全螢幕狀態。保留原生全螢幕，待新頁就緒再同步。
    if (!wantFullscreen) win.setFullScreen(false);
  });

  wc.on('did-start-navigation', function (details) {
    if (details.isMainFrame && !details.isSameDocument) wantFullscreen = win.isFullScreen() || wantFullscreen;
  });
  wc.on('did-finish-load', function () {
    if (!wantFullscreen) return;
    wantFullscreen = false;
    runInPage(win, FULLSCREEN_ON, true).then(function (entered) {
      if (entered !== true && !win.isDestroyed()) win.setFullScreen(false);
    });
  });

  wc.on('before-input-event', function (event, input) {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.key === 'Enter' && input.alt)) {
      event.preventDefault();
      runInPage(win, FULLSCREEN_TOGGLE, true);
      return;
    }
    if (OPTS.dev && input.key === 'F12') { event.preventDefault(); wc.toggleDevTools(); return; }
    if (OPTS.dev && input.key === 'F5') { event.preventDefault(); wc.reload(); }
  });

  // 外殼不是瀏覽器：不跳離遊戲、不開新視窗（Document PiP 不經過這裡）
  wc.on('will-navigate', function (event, target) {
    if (!sameOrigin(target, url)) { event.preventDefault(); log('[desktop] 擋下導覽：', target); }
  });
  wc.setWindowOpenHandler(function (details) {
    if (/^https?:\/\//.test(details.url) && !devUrlAllowed(details.url)) {
      shell.openExternal(details.url);
    }
    return { action: 'deny' };
  });
  wc.on('render-process-gone', function (event, details) {
    log('[desktop] 畫面行程結束：', details.reason, details.exitCode);
  });
  wc.on('unresponsive', function () { log('[desktop] 頁面無回應'); });
  wc.on('console-message', function (event) {
    // 只收錯誤，避免日誌被遊戲的除錯輸出淹沒
    var level = event.level;
    if (level === 'error' || level === 3) log('[page:error]', event.message, '(' + (event.sourceId || '') + ':' + (event.lineNumber || '') + ')');
  });

  var closing = { started: false, done: false };
  win.on('close', function (event) {
    if (closing.done) return;
    event.preventDefault();
    if (closing.started) return;
    closing.started = true;
    flushSave(win).then(function () {
      closing.done = true;
      if (!win.isDestroyed()) win.destroy();
    });
  });
  win.on('closed', function () { if (mainWindow === win) mainWindow = null; });

  win.loadURL(url);
  return win;
}

global.__desktopSteam = function () { return Steam.status(); };

/* ---- 存檔 IPC（任務 C）；Steam IPC（任務 D）也掛在同一個 guard 底下 ----
   存檔資料夾固定為 userData/saves；Steam Auto-Cloud 同步這裡的 *.json。
   只回應主視窗的頁面，而且只在頁面停在 app://game（或 --url 指定的本機內測服）時；
   檔名白名單與原子寫入在 electron/save-files.cjs。 */
var SAVES_DIR = path.join(app.getPath('userData'), 'saves');
global.__desktopSavesDir = SAVES_DIR;

function trustedSender(event) {
  var wc = event.sender;
  if (!mainWindow || mainWindow.isDestroyed() || wc !== mainWindow.webContents) return false;
  var frameUrl = (event.senderFrame && event.senderFrame.url) || wc.getURL();
  return sameOrigin(frameUrl, startUrl());
}

function setupSaveIpc() {
  try {
    var removed = SaveFiles.cleanupTemp(SAVES_DIR);
    if (removed) log('[saves] 清掉中斷留下的暫存檔', removed, '個');
  } catch (e) { log('[saves] 無法建立存檔資料夾：', e && e.message); }

  function guard(fn) {
    return function (event) {
      if (!trustedSender(event)) throw new Error('拒絕：不是遊戲頁面');
      return fn.apply(null, Array.prototype.slice.call(arguments, 1));
    };
  }
  ipcMain.handle('saves:list', guard(function () { return SaveFiles.list(SAVES_DIR); }));
  ipcMain.handle('saves:read', guard(function (name) { return SaveFiles.read(SAVES_DIR, name); }));
  ipcMain.handle('saves:write', guard(function (name, data) {
    return SaveFiles.write(SAVES_DIR, name, data).catch(function (e) {
      log('[saves] 寫入失敗', name, e && e.message);
      throw e;
    });
  }));
  ipcMain.handle('saves:remove', guard(function (name) { return SaveFiles.remove(SAVES_DIR, name); }));
  ipcMain.handle('steam:status', guard(function () { return Steam.status(); }));
  ipcMain.handle('steam:activate-achievements', guard(function (names) { return Steam.activateAchievements(names); }));
  ipcMain.handle('saves:open-folder', guard(function () {
    fs.mkdirSync(SAVES_DIR, { recursive: true });
    return shell.openPath(SAVES_DIR).then(function (err) { if (err) throw new Error(err); return true; });
  }));
}

function onReady() {
  Menu.setApplicationMenu(null);
  protocol.handle(AppProtocol.SCHEME, serveFile);
  setupPermissions(session.defaultSession);

  ipcMain.on('apexhost:quit', function (event) {
    var win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();   // 走 close 事件，一樣會先存檔
  });
  setupSaveIpc();

  var win = createWindow();
  if (OPTS.smoke) {
    require('./smoke.cjs').run(win, {
      outDir: OPTS.smoke, log: log, flushSave: flushSave, onScreen: OPTS.smokeOnScreen
    });
  }
}

app.on('window-all-closed', function () { app.quit(); });
