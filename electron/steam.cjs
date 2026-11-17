'use strict';
/* ============ Steamworks（主行程）：Steam 任務 D ============
   計畫見 docs/steam/STEAM_RELEASE_PLAN.md 任務 D。用 steamworks.js（napi 預編譯，不必自己編 C++）。

   ---- 一律容錯 ----
   沒裝 Steam、Steam 沒開、離線、AppID 沒設定、dll 載不起來……任何一種都只是「Steam 功能關閉」，
   遊戲照常可玩，存檔在本機（任務 C）。所有 Steam 呼叫都包在 try/catch 裡，失敗只寫日誌。

   ---- AppID 從哪來 ----
   正式值：electron/steam-config.json 的 appId（0 = 不接 Steam）。
   開發測試：--steam-appid=480（Valve 的測試遊戲 Spacewar）。不需要 steam_appid.txt：
   init(appId) 直接把 AppID 交給 Steam，也就不會有「上傳前忘了刪 steam_appid.txt」的風險。

   ---- 防止繞過 Steam 啟動 ----
   restartAppIfNecessary：玩家直接點資料夾裡的 exe 時，交給 Steam 重新啟動並關掉自己。
   只在「打包版、設定檔的正式 AppID、非開發／冒煙模式」時呼叫——開發時跑 480 不能被它踢掉。

   ---- 成就 ----
   遊戲成就編號 → Steam API 名稱一律是 ACH_ + 三位數編號（ACH_001…），見 apiNameFor。
   Steamworks 後台建立成就時照這個名稱填（清單由 tools/desktop/steam_achievements.cjs 產生）。 */

var fs = require('fs');
var path = require('path');

var ACH_NAME_RE = /^ACH_\d{3,4}$/;

function apiNameFor(id) {
  var n = Number(id);
  if (!(n > 0) || Math.floor(n) !== n) return null;
  return 'ACH_' + String(n).padStart(3, '0');
}

/* 開發時從 node_modules 載入；打包版沒有 node_modules，tools/desktop/build_desktop.cjs 會把
   Windows 需要的檔案（index.js、win64 的 .node 與 steam_api64.dll、授權）放在 electron/vendor/steamworks.js/。 */
function loadSteamworks() {
  try {
    return require('steamworks.js');
  } catch (e) {
    if (e && e.code !== 'MODULE_NOT_FOUND') throw e;
    return require('./vendor/steamworks.js');
  }
}

function readConfig(dir) {
  try {
    var cfg = JSON.parse(fs.readFileSync(path.join(dir, 'steam-config.json'), 'utf8'));
    var appId = Number(cfg.appId) || 0;
    return { appId: appId > 0 ? Math.floor(appId) : 0 };
  } catch (e) {
    return { appId: 0, error: e.message };
  }
}

/* 決定這次要用的 AppID 與是否要 restartAppIfNecessary（純函式，可測試） */
function resolveAppId(opts) {
  var cliAppId = Number(opts.cliAppId) || 0;
  if (cliAppId > 0) return { appId: Math.floor(cliAppId), source: 'cli', guardLaunch: false };
  var cfgAppId = Number(opts.configAppId) || 0;
  if (cfgAppId > 0) {
    return { appId: cfgAppId, source: 'config', guardLaunch: !!opts.isPackaged && !opts.dev && !opts.smoke };
  }
  return { appId: 0, source: 'none', guardLaunch: false };
}

/* 建立 Steam 狀態物件。loadLib 可注入（測試用假的 steamworks.js） */
function create(opts) {
  var log = opts.log || function () {};
  var state = { enabled: false, appId: 0, source: 'none', reason: null, overlay: false, restart: false };
  var client = null;
  var lib = null;

  var pick = resolveAppId(opts);
  state.appId = pick.appId;
  state.source = pick.source;
  if (!pick.appId) {
    state.reason = '未設定 AppID';
    return api();
  }

  try {
    lib = (opts.loadLib || loadSteamworks)();
  } catch (e) {
    state.reason = '載入 steamworks.js 失敗：' + (e && e.message);
    log('[steam]', state.reason);
    return api();
  }

  if (pick.guardLaunch) {
    try {
      if (lib.restartAppIfNecessary(pick.appId)) {
        state.restart = true;
        state.reason = '不是從 Steam 啟動，交給 Steam 重新啟動';
        log('[steam]', state.reason);
        return api();
      }
    } catch (e) {
      log('[steam] restartAppIfNecessary 失敗（繼續啟動）：', e && e.message);
    }
  }

  try {
    client = lib.init(pick.appId);
    state.enabled = true;
    log('[steam] 已連線，AppID', pick.appId, '(' + pick.source + ')');
  } catch (e) {
    state.reason = 'Steam 未連線：' + (e && e.message);
    log('[steam]', state.reason);
    return api();
  }

  /* Overlay（Shift+Tab）：會加上 in-process-gpu 與 disable-direct-composition，並每幀強制重繪。
     2026-11-17 實測只開 in-process-gpu 時畫面全白；這兩個參數要一起開，且必須在 app ready 前呼叫。
     --no-steam-overlay 可關掉（畫面異常時的退路）。 */
  if (opts.overlay !== false) {
    try {
      lib.electronEnableSteamOverlay();
      state.overlay = true;
    } catch (e) {
      log('[steam] Overlay 啟用失敗：', e && e.message);
    }
  }
  return api();

  function api() {
    return {
      status: function () {
        return { enabled: state.enabled, appId: state.appId, source: state.source, reason: state.reason, overlay: state.overlay };
      },
      shouldQuitForRestart: function () { return state.restart; },
      /* 成就：只接受 ACH_### 形式的名稱；已達成的不重送；整批送完只 store 一次 */
      activateAchievements: function (names) {
        var result = { enabled: state.enabled, activated: [], already: [], failed: [] };
        if (!state.enabled || !client) return result;
        var list = Array.isArray(names) ? names : [];
        var seen = {};
        list.forEach(function (name) {
          if (typeof name !== 'string' || !ACH_NAME_RE.test(name) || seen[name]) return;
          seen[name] = true;
          try {
            if (client.achievement.isActivated(name)) { result.already.push(name); return; }
            if (client.achievement.activate(name)) result.activated.push(name);
            else result.failed.push(name);   // 後台沒有這個成就名稱時 Steam 會回 false
          } catch (e) {
            result.failed.push(name);
          }
        });
        if (result.activated.length) {
          try { client.stats.store(); } catch (e) { log('[steam] stats.store 失敗：', e && e.message); }
          log('[steam] 解鎖成就', result.activated.join(','));
        }
        if (result.failed.length) log('[steam] 成就解鎖失敗（後台是否已建立？）', result.failed.join(','));
        return result;
      }
    };
  }
}

module.exports = { create: create, readConfig: readConfig, resolveAppId: resolveAppId, apiNameFor: apiNameFor };
