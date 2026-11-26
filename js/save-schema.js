'use strict';
/* ============ 存檔格式版本（saveSchema）與上市後的遷移登錄：Steam 任務 F ============
   計畫見 docs/steam/STEAM_RELEASE_PLAN.md 任務 F；規則見 ONE_TIME_MIGRATIONS.md「上市後的存檔遷移」。

   ---- 為什麼需要一個遞增的版本號 ----
   上市前的遷移用「每個遷移一個具名旗標」（taskInsertChestRelicV1…），那套照舊保留、照舊執行。
   但上市後有兩件事是具名旗標做不到的：
   1. 看出存檔「比遊戲新」：Steam 的測試分支、或兩台電腦裝著不同版本時，Steam Cloud 會把新版本寫的存檔
      帶到舊版本的遊戲。舊程式看不懂新旗標，只會靜靜忽略、照常載入，然後下一次自動存檔就把新進度覆寫掉。
      有了版本號，舊遊戲一看到 saveSchema 比自己大就拒絕載入（js/save_origin.js 的攔截畫面）。
   2. 順序明確：遷移依 to 由小到大執行，不再靠程式碼在 migrateSave 裡的擺放位置。

   ---- 版本規則 ----
   - SAVE_SCHEMA_VERSION：這個版本的遊戲寫出的存檔格式。上市基準為 1。
   - 沒有 saveSchema 的存檔（上市前的存檔）視為 0；跑完 migrateSave 既有的相容處理後標成目前版本。
   - 存檔結構有「不相容」的變更時：版本 +1，並在 SAVE_SCHEMA_MIGRATIONS 登錄一筆 { to: 新版本, ... }。
     只是「新增欄位、舊存檔補預設值就能用」的變更不需要升版——mergeDefaults 本來就會補。

   ---- 遷移在哪裡執行 ----
   migrateSave（js/save.js）的最後、所有既有相容處理與 mergeDefaults 之後。
   所以遷移函式看到的是「已補齊預設欄位的存檔」；判斷舊不舊靠版本號，不必在 mergeDefaults 前偷看欄位。
   mergeDefaults 只補缺、不刪欄位，舊結構的值在遷移函式裡仍然讀得到。

   本檔三種環境都會載入：主執行緒 <script>、Worker importScripts、Node vm 測試。 */

var SAVE_SCHEMA_VERSION = 3;

/* 上市後的遷移登錄，依 to 由小到大。每筆：
     { to: 2, name: 'xxxV1', date: 'YYYY-MM-DD', migrate: function (data) { ... } }
   migrate 直接修改 data；必須是純資料轉換（不讀 G、不碰 UI），丟出例外會讓這次讀檔失敗。
   範本與測試寫法見 tests/save-schema.test.cjs 的「遷移範本」。 */
var SAVE_SCHEMA_MIGRATIONS = [{
  to: 2, name: 'taskInsertSkillEvolutionV1', date: '2026-11-20',
  migrate: function (data) {
    if (!data.taskState || typeof data.taskState !== 'object') data.taskState = { idx: 0 };
    var idx = Math.max(0, Math.min(40, Math.floor(Number(data.taskState.idx) || 0)));
    // 依插入後索引逐一平移；尚未越過插入點者，接著完成該新任務。
    if (idx > 4) idx++;
    if (idx > 9) idx++;
    if (idx > 26) idx++;
    data.taskState.idx = idx;
  }
}, {
  to: 3, name: 'taskInsertChestUpgradeV1', date: '2026-11-26',
  migrate: function (data) {
    if (!data.taskState || typeof data.taskState !== 'object') data.taskState = { idx: 0 };
    var idx = Math.max(0, Math.min(43, Math.floor(Number(data.taskState.idx) || 0)));
    // 舊順序14前移至6；已越過新位置者略過前移項，避免重領其他已完成任務。
    if (idx > 5) idx++;
    if (idx > 14) idx--;
    // 新順序11、12與14：恰在插入點者接著做，已越過者略過。
    if (idx > 10) idx += 2;
    if (idx > 13) idx++;
    data.taskState.idx = idx;
  }
}];

function saveSchemaOf(data) {
  var v = data && data.saveSchema;
  return (typeof v === 'number' && v >= 0 && Math.floor(v) === v) ? v : 0;
}

/* 存檔是不是比這個版本的遊戲還新（不能載入，也絕不能被覆寫） */
function saveSchemaTooNew(data, version) {
  return saveSchemaOf(data) > (version === undefined ? SAVE_SCHEMA_VERSION : version);
}

/* 登錄表的自我檢查：回傳錯誤訊息陣列（空陣列＝正確）。測試會呼叫，正式執行時也會先檢查。 */
function saveSchemaRegistryErrors(list, version) {
  var errors = [];
  var prev = 1;
  var names = {};
  (list || []).forEach(function (m, i) {
    if (!m || typeof m.migrate !== 'function') errors.push('#' + i + ' 沒有 migrate 函式');
    if (!m || typeof m.to !== 'number' || Math.floor(m.to) !== m.to) { errors.push('#' + i + ' 的 to 不是整數'); return; }
    if (m.to !== prev + 1) errors.push('#' + i + ' 的 to 應為 ' + (prev + 1) + '（版本必須逐一遞增、不可跳號或重複），實際是 ' + m.to);
    prev = m.to;
    if (!m.name) errors.push('#' + i + ' 沒有 name');
    else if (names[m.name]) errors.push('名稱重複：' + m.name);
    names[m.name] = true;
  });
  if (prev !== version) errors.push('SAVE_SCHEMA_VERSION 是 ' + version + '，但登錄表最後一筆是 ' + prev + '（升版必須同時登錄遷移）');
  return errors;
}

/* 依序套用遷移：fromVersion 是讀檔「當下」的版本（必須在 mergeDefaults 之前取得——
   newGameState 帶著目前版本，補完預設值後舊存檔看起來就跟新的一樣）。
   回傳 { from, to, applied: [名稱...] }。
   存檔比遊戲新時不做任何事，也不把版本號往下改（呼叫端應該早就攔下，這裡只是保險）。 */
function applySaveSchemaMigrations(data, fromVersion, opts) {
  var version = (opts && opts.version !== undefined) ? opts.version : SAVE_SCHEMA_VERSION;
  var list = (opts && opts.migrations) || SAVE_SCHEMA_MIGRATIONS;
  var from = (typeof fromVersion === 'number' && fromVersion >= 0) ? Math.floor(fromVersion) : 0;
  var result = { from: from, to: from, applied: [] };
  if (from > version) return result;
  var errors = saveSchemaRegistryErrors(list, version);
  if (errors.length) throw new Error('存檔遷移登錄表錯誤：' + errors.join('；'));
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    if (m.to <= from) continue;
    m.migrate(data);
    result.applied.push(m.name);
  }
  data.saveSchema = version;
  result.to = version;
  return result;
}
