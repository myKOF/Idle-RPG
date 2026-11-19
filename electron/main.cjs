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
     --demo           demo 版（Steam 封測）：js/game-edition.js 改回應 'demo'，倍率與開放範圍見 js/data.js「Demo 版」；
                      存檔另放 %APPDATA%/idle-rpg-demo、Steam 用 steam-config.json 的 demoAppId。只限從原始碼執行；
                      demo 打包版由 electron/edition.json 決定（tools/desktop/build_desktop.cjs --edition=demo 寫入）
     --internal       內測模式：改由 app://localhost 伺服，GM 與內測工具照網頁內測服的規則開放；
                      存檔另放 %APPDATA%/idle-rpg-internal、不接 Steam。只限從原始碼執行，
                      打包版忽略此參數（玩家不能用啟動選項打開 GM）。啟動桌面版(內測).bat 用的就是它
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
var screen = electron.screen;
var protocol = electron.protocol;
var session = electron.session;
var shell = electron.shell;
var Menu = electron.Menu;
var ipcMain = electron.ipcMain;
var AppProtocol = require('./app-protocol.cjs');
var SaveFiles = require('./save-files.cjs');
var WindowActivity = require('./window-activity.cjs');

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
  internal: !!argValue('internal') && !app.isPackaged,
  demo: !!argValue('demo') && !app.isPackaged,
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
/* ---- 遊戲版本（full／demo）----
   打包版只看 electron/edition.json（demo 打包時由打包工具寫入；正式版沒有這個檔）；
   從原始碼執行時看 --demo。版本決定頁面讀到的 GAME_EDITION、存檔資料夾與 Steam AppID。 */
function readEditionFile() {
  try {
    var e = JSON.parse(fs.readFileSync(path.join(__dirname, 'edition.json'), 'utf8')).edition;
    return e === 'demo' ? 'demo' : 'full';
  } catch (err) { return null; }
}
var EDITION = readEditionFile() || (OPTS.demo ? 'demo' : 'full');

var USER_DATA_DIR_NAME = 'idle-rpg';
var INTERNAL_USER_DATA_DIR_NAME = 'idle-rpg-internal';   // 內測模式：GM 改過的存檔不能混進正式存檔與 Steam Cloud
if (OPTS.smoke) {
  app.setPath('userData', path.join(OPTS.smoke, 'userData'));
} else if (OPTS.profile) {
  // 另一份隔離的資料夾：單一實例鎖以 userData 為準，所以能和正在玩的那個視窗並存
  app.setPath('userData', OPTS.profile);
} else {
  // demo 存檔與正式版分開（倍率不同的進度不該帶進正式版）；內測再各自分開
  var dirName = OPTS.internal ? INTERNAL_USER_DATA_DIR_NAME : USER_DATA_DIR_NAME;
  if (EDITION === 'demo') dirName = OPTS.internal ? 'idle-rpg-demo-internal' : 'idle-rpg-demo';
  app.setPath('userData', path.join(app.getPath('appData'), dirName));
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

if (argValue('internal') && app.isPackaged) log('[desktop] 打包版忽略 --internal');
if (argValue('demo') && app.isPackaged) log('[desktop] 打包版忽略 --demo（版本由 electron/edition.json 決定）');

/* ---- 開機前必須完成的設定 ---- */
var DISPLAY_PREFS_FILE = path.join(app.getPath('userData'), 'display-settings.json');
var DISPLAY_MODES = ['borderless', 'fullscreen', 'windowed'];
var displayPrefs = { mode: 'borderless', vsync: true };
try {
  var savedDisplay = JSON.parse(fs.readFileSync(DISPLAY_PREFS_FILE, 'utf8'));
  if (DISPLAY_MODES.indexOf(savedDisplay.mode) >= 0) displayPrefs.mode = savedDisplay.mode;
  displayPrefs.vsync = savedDisplay.vsync !== false;
} catch (e) { /* 設定檔不存在或無法讀取時沿用預設 */ }
var activeVsync = displayPrefs.vsync;
function saveDisplayPrefs(next) {
  if (next.mode === displayPrefs.mode && next.vsync === displayPrefs.vsync) return;
  fs.mkdirSync(path.dirname(DISPLAY_PREFS_FILE), { recursive: true });
  fs.writeFileSync(DISPLAY_PREFS_FILE + '.tmp', JSON.stringify(next));
  fs.renameSync(DISPLAY_PREFS_FILE + '.tmp', DISPLAY_PREFS_FILE);
  displayPrefs = next;
}

/* in-process-gpu 預設關閉（2026-11-17 實測）：單獨開它時，視窗在螢幕上是一片淡青色空白，
   頁面其實正常在跑（capturePage 截得到畫面）——合成結果送不上螢幕。
   Steam Overlay（Shift+Tab）需要它，steamworks.js 的建議是搭配 disable-direct-composition
   一起開；任務 D 接 Overlay 時兩個一起實測，通過才改成預設。 */
if (OPTS.inProcessGpu) {
  app.commandLine.appendSwitch('in-process-gpu');
}
/* GPU VSync 可由玩家關閉，Chromium 的畫面排程仍保留節流。 */
if (!activeVsync) app.commandLine.appendSwitch('disable-gpu-vsync', 'gpu');

protocol.registerSchemesAsPrivileged([{
  scheme: AppProtocol.SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true }
}]);

/* Steam（任務 D）：必須在 app ready 之前初始化——Overlay 要加的 GPU 參數只在 ready 前有效。
   任何失敗都只是「Steam 功能關閉」，遊戲照常啟動。
   內測模式一律不接：GM 能直接解鎖成就，會解到真正的 Steam 帳號上。 */
var Steam = require('./steam.cjs').create({
  cliAppId: OPTS.internal ? 0 : OPTS.steamAppId,
  configAppId: OPTS.internal ? 0 : require('./steam.cjs').readConfig(__dirname)[EDITION === 'demo' ? 'demoAppId' : 'appId'],
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
    if (win.miniMonitor) win.miniMonitor.restore();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(onReady);
}

var mainWindow = null;
var GAME_ROOT = app.getAppPath();
var APP_HOST = OPTS.internal ? AppProtocol.INTERNAL_HOST : AppProtocol.HOST;

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

/* 版本旗標：js/game-edition.js 永遠寫 'full'，demo 版在這裡改寫回應——遊戲程式只有一份 */
var EDITION_FILE = path.join(GAME_ROOT, 'js', 'game-edition.js');
var EDITION_SCRIPT = [
  "'use strict';",
  '/* 由桌面外殼產生（electron/main.cjs），原檔見 js/game-edition.js */',
  'var GAME_EDITION = ' + JSON.stringify(EDITION) + ';',
  ''
].join('\n');

function serveFileImpl(request) {
  var file = AppProtocol.resolveRequestPath(GAME_ROOT, request.url, APP_HOST);
  if (file && EDITION !== 'full' && path.resolve(file) === EDITION_FILE) {
    return Promise.resolve(new Response(EDITION_SCRIPT, { status: 200, headers: { 'Content-Type': AppProtocol.mimeFor(file), 'Cache-Control': 'no-cache' } }));
  }
  var notFound = function () {
    log('[app] 404', request.url);
    if (OPTS.smoke && requestStats.notFound.length < 200) requestStats.notFound.push(request.url);
    return new Response('Not Found', { status: 404 });
  };
  if (!file) return Promise.resolve(notFound());
  return fs.promises.stat(file).then(function (st) {
    if (!st.isFile()) return notFound();
    // 打包版的 .png 可能是 WebP 內容（tools/desktop/webp_images.py）：看檔頭回報正確的 MIME
    if (!AppProtocol.needsSniff(file) || st.size < 12) return { st: st, mime: AppProtocol.mimeFor(file) };
    return fs.promises.open(file, 'r').then(function (fh) {
      var head = Buffer.alloc(12);
      return fh.read(head, 0, 12, 0).then(function () {
        return { st: st, mime: AppProtocol.sniffImageMime(head) || AppProtocol.mimeFor(file) };
      }).finally(function () { return fh.close(); });
    });
  }).then(function (info) {
    if (!info.st) return info;   // notFound() 的 Response
    var st = info.st;
    var headers = {
      'Content-Type': info.mime,
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
  return AppProtocol.originFor(APP_HOST) + '/index.html';
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
var FULLSCREEN_OFF = 'document.fullscreenElement ? document.exitFullscreen().then(function(){return true;},function(){return false;}) : true';

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
  var mode = OPTS.windowed || OPTS.smoke ? 'windowed' : displayPrefs.mode;
  var lastFullscreenMode = OPTS.smoke || displayPrefs.mode === 'fullscreen' ? 'fullscreen' : 'borderless';
  var navigating = false, applyingMode = false, pendingWindowSize = null;
  var displayQueue = Promise.resolve();
  var win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 640,
    minHeight: 360,
    fullscreen: mode !== 'windowed',
    show: false,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    // 視窗與工作列圖示：打包版的 exe 本身已帶圖示；從原始碼執行（electron.exe）時靠這一行（tools/desktop/make_app_icon.py 產生）
    icon: path.join(__dirname, 'icons', 'app.ico'),
    // 視窗標題跟隨頁面 <title>（String 表 48），不在外殼另寫一份
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // 由下面的 HTML 全螢幕事件統一切換原生視窗。
      disableHtmlFullscreenWindowResize: true,
      // 背景仍為在線掛機；繪圖由原生視窗活動狀態獨立降載。
      backgroundThrottling: false
    }
  });
  mainWindow = win;
  win.miniMonitor = require('./mini-window.cjs').create({
    owner: win, BrowserWindow: BrowserWindow, screen: screen, log: log,
    positionFile: path.join(app.getPath('userData'), 'mini-window-position.json')
  });
  win.activity = WindowActivity.bindWindowActivity(win, { alwaysActive: OPTS.smoke && !OPTS.smokeOnScreen });
  var url = startUrl();
  var wc = win.webContents;
  log('[desktop] 啟動', app.getVersion(), 'electron', process.versions.electron, '→', url, EDITION === 'demo' ? '（demo 版）' : '');

  function displayState() {
    return { mode: mode, vsync: displayPrefs.vsync, activeVsync: activeVsync };
  }
  function publishDisplayState() {
    if (!wc.isDestroyed()) wc.send('display:change', displayState());
    return displayState();
  }
  function resizeWindow() {
    if (!pendingWindowSize || mode !== 'windowed' || win.isDestroyed() || win.isFullScreen()) return;
    var monitor = screen.getDisplayMatching(win.getBounds());
    var size = win.getSize(), content = win.getContentSize();
    var width = Math.round(pendingWindowSize[0] / monitor.scaleFactor);
    var height = Math.round(pendingWindowSize[1] / monitor.scaleFactor);
    pendingWindowSize = null;
    win.setContentSize(Math.min(width, monitor.workArea.width - (size[0] - content[0])),
      Math.min(height, monitor.workArea.height - (size[1] - content[1])));
    var bounds = win.getBounds(), area = monitor.workArea;
    var x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width));
    var y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height));
    if (x !== bounds.x || y !== bounds.y) win.setPosition(x, y);
  }
  function setNativeFullscreen(enabled) {
    if (win.isFullScreen() === enabled) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var eventName = enabled ? 'enter-full-screen' : 'leave-full-screen';
      function transitioned() { finish(); }
      function finish(error) {
        clearTimeout(timeout);
        win.removeListener(eventName, transitioned);
        if (error) reject(error);
        else resolve();
      }
      var timeout = setTimeout(function () {
        finish(win.isDestroyed() || win.isFullScreen() !== enabled ? new Error('Native fullscreen transition timed out') : null);
      }, 3000);
      win.once(eventName, transitioned);
      try { win.setFullScreen(enabled); }
      catch (error) { finish(error); }
    });
  }
  function setMode(requested) {
    // 視窗切換依序執行，避免較早的全螢幕請求晚完成。
    var change = displayQueue.then(async function () {
      var next = typeof requested === 'function' ? requested() : requested;
      if (DISPLAY_MODES.indexOf(next) < 0) throw new Error('Unsupported display mode');
      if (win.isDestroyed()) throw new Error('Display window closed');
      applyingMode = true;
      try {
        if (next !== 'fullscreen' && mode === 'fullscreen') {
          if (await runInPage(win, FULLSCREEN_OFF, false) !== true) throw new Error('Could not leave HTML fullscreen');
        }
        if (next !== 'windowed') {
          if (process.platform === 'win32' && win.isMaximized() && !win.isFullScreen()) win.unmaximize();
          await setNativeFullscreen(true);
          mode = next === 'fullscreen' && await runInPage(win, FULLSCREEN_ON, true) !== true ? 'borderless' : next;
          lastFullscreenMode = mode;
        } else {
          await setNativeFullscreen(false);
          mode = next;
          resizeWindow();
        }
        saveDisplayPrefs({ mode: mode, vsync: displayPrefs.vsync });
        if (mode !== next) throw new Error('Could not enter HTML fullscreen');
        return displayState();
      } finally {
        applyingMode = false;
        publishDisplayState();
      }
    });
    displayQueue = change.catch(function () {});
    return change;
  }
  function reportDisplayError(error) { log('[desktop] 顯示設定：', error.message); }
  function toggleMode() {
    return setMode(function () { return mode === 'windowed' ? lastFullscreenMode : 'windowed'; });
  }
  win.displaySettings = {
    get: displayState,
    setMode: setMode,
    toggle: toggleMode,
    setResolution: function (width, height) {
      if (!Number.isInteger(width) || !Number.isInteger(height) ||
          width < 1280 || width > 3840 || height < 720 || height > 2160) throw new Error('Unsupported resolution');
      pendingWindowSize = [width, height];
      resizeWindow();
    },
    setVsync: function (value) {
      if (typeof value !== 'boolean') throw new Error('Invalid VSync setting');
      saveDisplayPrefs({ mode: displayPrefs.mode, vsync: value });
      return publishDisplayState();
    }
  };

  win.once('ready-to-show', function () {
    if (OPTS.smoke && !OPTS.smokeOnScreen) return;   // 背景冒煙測試：不顯示、不搶焦點
    win.show();
  });

  if (process.platform === 'win32') {
    win.on('maximize', function () {
      if (mode === 'windowed' && win.isMaximized()) setMode(lastFullscreenMode).catch(reportDisplayError);
    });
  }

  win.on('leave-full-screen', resizeWindow);
  win.on('leave-html-full-screen', function () {
    if (mode === 'fullscreen' && !navigating && !applyingMode) setMode('windowed').catch(reportDisplayError);
  });

  wc.on('did-start-navigation', function (details) {
    if (details.isMainFrame && !details.isSameDocument) {
      navigating = true;
      win.miniMonitor.restore();
    }
  });
  wc.on('did-finish-load', function () {
    navigating = false;
    if (mode === 'fullscreen') setMode(mode).catch(reportDisplayError);
  });

  wc.on('before-input-event', function (event, input) {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.key === 'Enter' && input.alt)) {
      event.preventDefault();
      if (!input.isAutoRepeat) toggleMode().catch(reportDisplayError);
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
    win.miniMonitor.dispose();
    flushSave(win).then(function () {
      closing.done = true;
      if (!win.isDestroyed()) win.destroy();
    });
  });
  win.on('closed', function () {
    win.miniMonitor.dispose();
    if (mainWindow === win) mainWindow = null;
  });

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

function setupDisplayIpc() {
  ipcMain.handle('activity:get', function (event) {
    if (!trustedSender(event)) throw new Error('Untrusted activity sender');
    return mainWindow.activity.get();
  });
  ['get', 'setMode', 'toggle', 'setResolution', 'setVsync'].forEach(function (action) {
    ipcMain.handle('display:' + action, function (event, ...args) {
      if (!trustedSender(event)) throw new Error('Untrusted display settings sender');
      return mainWindow.displaySettings[action](...args);
    });
  });
}

function setupMiniIpc() {
  function mainSender(event) {
    return trustedSender(event) && event.senderFrame === mainWindow.webContents.mainFrame;
  }
  ipcMain.handle('mini:open', function (event, initial) {
    if (!mainSender(event)) throw new Error('Untrusted mini monitor sender');
    return mainWindow.miniMonitor.open(initial);
  });
  ipcMain.on('mini:update', function (event, snapshot) {
    if (mainSender(event)) mainWindow.miniMonitor.update(snapshot);
  });
  ipcMain.handle('mini:initial', function (event) {
    if (!mainWindow || !mainWindow.miniMonitor.accepts(event)) throw new Error('Untrusted mini monitor sender');
    return mainWindow.miniMonitor.initial();
  });
  ipcMain.handle('mini:ready', function (event) {
    if (!mainWindow || !mainWindow.miniMonitor.accepts(event)) throw new Error('Untrusted mini monitor sender');
    mainWindow.miniMonitor.ready();
  });
  ipcMain.on('mini:restore', function (event) {
    if (mainWindow && mainWindow.miniMonitor.accepts(event)) mainWindow.miniMonitor.restore();
  });
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
  setupDisplayIpc();
  setupMiniIpc();

  var win = createWindow();
  if (OPTS.smoke) {
    require('./smoke.cjs').run(win, {
      outDir: OPTS.smoke, log: log, flushSave: flushSave, onScreen: OPTS.smokeOnScreen, internal: OPTS.internal, edition: EDITION
    });
  }
}

app.on('window-all-closed', function () { app.quit(); });
