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
  if (info.edition && info.edition !== 'full') parts.push(info.edition);
  if (info.commit) parts.push(info.commit + (info.dirty ? '+dirty' : ''));
  if (info.date) parts.push(info.date);
  if (info.note) parts.push(String(info.note).replace(/["\r\n]+/g, ' ').trim());
  return parts.join(' ').slice(0, 200);
}

/* 每個版本讀設定檔裡的哪幾個鍵。demo 在 Steam 上是另一個應用程式（Demo／Playtest），AppID 與 Depot 都不同。 */
var EDITION_KEYS = {
  full: { appId: 'appId', depotId: 'depotId', setLiveBranch: 'setLiveBranch' },
  demo: { appId: 'demoAppId', depotId: 'demoDepotId', setLiveBranch: 'demoSetLiveBranch' }
};

/* 設定解析：把三個來源合併並驗證。sources.edition：'full'（預設）或 'demo'。
   回傳 { edition, appId, depotId, setLiveBranch, fileExclusions, errors[] } */
function resolveConfig(sources) {
  var steam = sources.steamConfig || {};
  var pipe = sources.pipeConfig || {};
  var edition = sources.edition || 'full';
  var errors = [];
  var keys = EDITION_KEYS[edition];
  if (!keys) return { edition: edition, appId: 0, depotId: 0, setLiveBranch: '', fileExclusions: [], errors: ['版本只能是 full 或 demo：' + edition] };
  var appId = Math.floor(Number(steam[keys.appId]) || 0);
  if (!(appId > 0)) {
    errors.push('electron/steam-config.json 的 ' + keys.appId + ' 還是 0：先填 Steamworks 後台' + (edition === 'demo' ? ' Demo 應用程式' : '正式') + '的 AppID');
  }
  if (appId === 480) errors.push(keys.appId + ' 是 480（Valve 的測試遊戲 Spacewar），不能拿來上傳');
  // demo 傳到正式版的 AppID＝把封測版蓋掉正式版的建置，是最該擋的事故
  if (edition === 'demo' && appId > 0 && appId === Math.floor(Number(steam.appId) || 0)) {
    errors.push('demoAppId 和正式版 appId 相同（' + appId + '）：demo 必須是 Steamworks 上另一個應用程式');
  }
  var depotId = Math.floor(Number(pipe[keys.depotId]) || 0);
  if (!(depotId > 0) && appId > 0) depotId = appId + 1;
  if (edition === 'demo' && depotId > 0 && depotId === Math.floor(Number(pipe.depotId) || 0)) {
    errors.push('demoDepotId 和正式版 depotId 相同（' + depotId + '）');
  }
  var branch = String(pipe[keys.setLiveBranch] || '').trim();
  if (branch && /^(default|public)$/i.test(branch)) {
    errors.push('setLiveBranch 不能是預設分支——預設分支一律到 Steamworks 網頁手動 Set Build Live');
  }
  if (branch && !/^[A-Za-z0-9_-]{1,64}$/.test(branch)) errors.push('setLiveBranch 只能是英數、底線與減號：' + branch);
  var exclusions = Array.isArray(pipe.fileExclusions) ? pipe.fileExclusions.map(String) : [];
  if (exclusions.indexOf('steam_appid.txt') < 0) exclusions.push('steam_appid.txt');   // 一律排除，不靠設定記得
  return { edition: edition, appId: appId, depotId: depotId, setLiveBranch: branch, fileExclusions: exclusions, errors: errors };
}

/* 打包版的內容是不是這個版本：demo 版必須帶 electron/edition.json（{edition:'demo'}），正式版必須沒有。
   shipped：{ editionFile: 解析後的 edition.json 或 null, steamConfig: 打包版裡的 steam-config.json }。回傳錯誤清單。 */
function checkShippedEdition(cfg, shipped) {
  var errors = [];
  var keys = EDITION_KEYS[cfg.edition] || EDITION_KEYS.full;
  var ed = shipped.editionFile ? shipped.editionFile.edition : null;
  if (cfg.edition === 'demo' && ed !== 'demo') errors.push('打包版不是 demo（沒有 electron/edition.json）——用 --edition=demo 打包');
  if (cfg.edition !== 'demo' && ed) errors.push('打包版是 ' + ed + ' 版（帶了 electron/edition.json），不能傳到正式版');
  var shippedId = Number((shipped.steamConfig || {})[keys.appId]);
  if (!shipped.skipAppIdCheck && shippedId !== cfg.appId) {
    errors.push('打包版裡的 ' + keys.appId + ' 是 ' + shippedId + '，設定是 ' + cfg.appId + '——改了 electron/steam-config.json 之後要提交並重新打包');
  }
  return errors;
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

module.exports = { toVdf: toVdf, vdfValue: vdfValue, buildDescription: buildDescription, resolveConfig: resolveConfig,
  checkShippedEdition: checkShippedEdition, buildVdfs: buildVdfs };
