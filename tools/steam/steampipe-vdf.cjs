'use strict';
/* ============ SteamPipe 設定解析與 VDF 產生（純函式，可直接測試）：Steam 任務 E ============
   上傳流程與手冊見 docs/steam/STEAM_RELEASE_PLAN.md 任務 E；CLI 在 tools/steam/steampipe.cjs。

   ---- 為什麼 VDF 是產生的，不是手寫的範本 ----
   AppID、DepotID、內容資料夾的絕對路徑、建置描述（版本＋commit）每次都要對；手寫範本最常見的事故
   就是忘了改其中一個，把東西傳到錯的 Depot 或傳了舊資料夾。由設定檔產生，單一來源就不會分岔。

   ---- VDF 字串的跳脫 ----
   SteamCMD 讀 VDF 時不處理反斜線跳脫（Valve 官方範例就是 "..\content\" 這種寫法），
   所以 Windows 路徑照原樣寫入；值裡不允許出現雙引號與換行（路徑不可能有，描述文字會被清掉）。 */

var path = require('path');

function vdfValue(v) {
  var s = String(v);
  if (/["\r\n]/.test(s)) throw new Error('VDF 值不可含雙引號或換行：' + s.slice(0, 60));
  return '"' + s + '"';
}

/* 物件 → VDF 文字。值可為字串／數字、巢狀物件，或陣列（同一個鍵重複出現，例如多條 FileExclusion） */
function toVdf(rootKey, obj) {
  var lines = [];
  function emit(key, val, indent) {
    var pad = new Array(indent + 1).join('\t');
    if (Array.isArray(val)) { val.forEach(function (v) { emit(key, v, indent); }); return; }
    if (val && typeof val === 'object') {
      lines.push(pad + vdfValue(key));
      lines.push(pad + '{');
      Object.keys(val).forEach(function (k) { emit(k, val[k], indent + 1); });
      lines.push(pad + '}');
      return;
    }
    lines.push(pad + vdfValue(key) + '\t' + vdfValue(val));
  }
  emit(rootKey, obj, 0);
  return lines.join('\r\n') + '\r\n';
}

/* 建置描述：會顯示在 Steamworks 後台的 Builds 清單，用來分辨每一次上傳。 */
function buildDescription(info) {
  var parts = ['v' + (info.version || '0.0.0')];
  if (info.commit) parts.push(info.commit + (info.dirty ? '+dirty' : ''));
  if (info.date) parts.push(info.date);
  if (info.note) parts.push(String(info.note).replace(/["\r\n]+/g, ' ').trim());
  return parts.join(' ').slice(0, 200);
}

/* 設定解析：把三個來源合併並驗證。回傳 { appId, depotId, setLiveBranch, fileExclusions, errors[] } */
function resolveConfig(sources) {
  var steam = sources.steamConfig || {};
  var pipe = sources.pipeConfig || {};
  var errors = [];
  var appId = Math.floor(Number(steam.appId) || 0);
  if (!(appId > 0)) errors.push('electron/steam-config.json 的 appId 還是 0：先填 Steamworks 後台的正式 AppID');
  if (appId === 480) errors.push('appId 是 480（Valve 的測試遊戲 Spacewar），不能拿來上傳');
  var depotId = Math.floor(Number(pipe.depotId) || 0);
  if (!(depotId > 0) && appId > 0) depotId = appId + 1;
  var branch = String(pipe.setLiveBranch || '').trim();
  if (branch && /^(default|public)$/i.test(branch)) {
    errors.push('setLiveBranch 不能是預設分支——預設分支一律到 Steamworks 網頁手動 Set Build Live');
  }
  if (branch && !/^[A-Za-z0-9_-]{1,64}$/.test(branch)) errors.push('setLiveBranch 只能是英數、底線與減號：' + branch);
  var exclusions = Array.isArray(pipe.fileExclusions) ? pipe.fileExclusions.map(String) : [];
  if (exclusions.indexOf('steam_appid.txt') < 0) exclusions.push('steam_appid.txt');   // 一律排除，不靠設定記得
  return { appId: appId, depotId: depotId, setLiveBranch: branch, fileExclusions: exclusions, errors: errors };
}

/* 產生兩份 VDF 的內容。paths 一律傳絕對路徑（SteamCMD 會以 VDF 所在資料夾解析相對路徑，絕對路徑最不容易錯）。 */
function buildVdfs(cfg, opts) {
  var depotFile = 'depot_build_' + cfg.depotId + '.vdf';
  var app = {
    AppID: String(cfg.appId),
    Desc: opts.desc,
    Preview: opts.preview ? '1' : '0',
    ContentRoot: path.resolve(opts.contentRoot),
    BuildOutput: path.resolve(opts.buildOutput),
    Depots: {}
  };
  if (cfg.setLiveBranch && !opts.preview) app.SetLive = cfg.setLiveBranch;
  app.Depots[String(cfg.depotId)] = depotFile;
  var depot = {
    DepotID: String(cfg.depotId),
    FileMapping: { LocalPath: '*', DepotPath: '.', recursive: '1' },
    FileExclusion: cfg.fileExclusions
  };
  return {
    appFile: 'app_build_' + cfg.appId + '.vdf',
    appVdf: toVdf('AppBuild', app),
    depotFile: depotFile,
    depotVdf: toVdf('DepotBuild', depot)
  };
}

module.exports = { toVdf: toVdf, vdfValue: vdfValue, buildDescription: buildDescription, resolveConfig: resolveConfig, buildVdfs: buildVdfs };
