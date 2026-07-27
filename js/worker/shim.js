'use strict';
/* ============ Worker 環境墊片 ============
   在 importScripts 模擬層之前載入。

   模擬層那 17 支檔案原本假設自己活在瀏覽器主執行緒，會用到 window、document、
   UI.dirty、blog / flog、window.recordLoot*。本檔提供最小替身，讓它們**不必修改**
   就能在 Worker 內執行——這是整個遷移能低風險進行的關鍵：模擬層不動，
   116 支既有測試就不會失效。

   墊片同時記錄每個替身被呼叫的次數（SHIM_DIAG）。這不是除錯輸出，而是 P3 的工作清單：
   模擬層對 UI／DOM 的相依有多少、在哪裡，看這組數字就知道。數字歸零代表清乾淨了。 */

/* 模擬層有 73 處 window.xxx 存在性檢查與 3 處 window.xxx = 賦值，先讓 window 指向自己 */
self.window = self;

/* ---- 診斷計數 ---- */
var SHIM_DIAG = { dom: {}, ui: {}, storage: {} };

function _diag(bucket, key) {
  bucket[key] = (bucket[key] || 0) + 1;
}

function shimDiagSnapshot() {
  return { dom: SHIM_DIAG.dom, ui: SHIM_DIAG.ui, storage: SHIM_DIAG.storage };
}

function shimDiagReset() {
  SHIM_DIAG = { dom: {}, ui: {}, storage: {} };
}

/* ---- 事件佇列 ----
   協議規定日誌一律合批進 tick.events，禁止一則一次 postMessage。
   超過上限就丟棄最舊的並計數，避免掛機一整天把記憶體吃光。 */
var SHIM_EVENT_CAP = 400;
var _shimEvents = [];
var _shimEventsDropped = 0;

function shimPushEvent(kind, data) {
  if (_shimEvents.length >= SHIM_EVENT_CAP) {
    _shimEvents.shift();
    _shimEventsDropped++;
  }
  data = data || {};
  data.kind = kind;
  _shimEvents.push(data);
}

function shimDrainEvents() {
  var out = _shimEvents;
  _shimEvents = [];
  if (_shimEventsDropped > 0) {
    out.push({ kind: 'notice', key: 'events_dropped', text: '事件佇列溢出，丟棄 ' + _shimEventsDropped + ' 則' });
    _shimEventsDropped = 0;
  }
  return out;
}

/* ---- UI.dirty 替身 ----
   模擬層現有 158 處 UI.dirty.xxx = true 標記，直接當作髒區訊號沿用，不另建一套。 */
var UI = { dirty: {}, tab: null, sel: null };
self.UI = UI;

function shimDrainDirty() {
  var keys = [];
  for (var k in UI.dirty) {
    if (UI.dirty[k]) { keys.push(k); UI.dirty[k] = false; }
  }
  return keys;
}

/* ---- 日誌替身（原本定義在 ui.js）---- */
function blog(msg, cls, cat) {
  _diag(SHIM_DIAG.ui, 'blog');
  shimPushEvent('log', { msg: msg, cls: cls, cat: cat });
}

function flog(msg, cls) {
  _diag(SHIM_DIAG.ui, 'flog');
  shimPushEvent('flog', { msg: msg, cls: cls });
}

function addLog(boxId, msg, cls, cap) {
  _diag(SHIM_DIAG.ui, 'addLog');
  shimPushEvent('log', { msg: msg, cls: cls, box: boxId, cap: cap });
}

function floatText(target, text, cls) {
  _diag(SHIM_DIAG.ui, 'floatText');
  shimPushEvent('float', { target: target, text: text, cls: cls });
}

/* ---- 其餘 ui.js 函式替身 ----
   模擬層對 UI 的呼叫共 10 個函式，上面 4 個有語意可轉成事件，
   以下 6 個是純畫面操作，在 Worker 內只記錄不作用，P3 必須從模擬層移除。 */
function showTowerResultModal(result) {
  _diag(SHIM_DIAG.ui, 'showTowerResultModal');
  shimPushEvent('notice', { key: 'towerResult', data: result, modal: true });
}

function showOfflineSummary(summary) {
  _diag(SHIM_DIAG.ui, 'showOfflineSummary');
  shimPushEvent('notice', { key: 'offlineSummary', data: summary, modal: true });
}

function clearTowerFloatLayers() { _diag(SHIM_DIAG.ui, 'clearTowerFloatLayers'); }
function renderSaveList() { _diag(SHIM_DIAG.ui, 'renderSaveList'); }
function refreshSaveFolderFilesV2() { _diag(SHIM_DIAG.ui, 'refreshSaveFolderFilesV2'); }

/* potential.js 呼叫 ui.js 的文字產生函式，屬於相依方向顛倒（模擬層要 UI 幫忙產字串）。
   P3 應把它搬進模擬層或改由主執行緒渲染時再產生。 */
function describePotentialSkill() {
  _diag(SHIM_DIAG.ui, 'describePotentialSkill');
  return '';
}

/* ---- 掉落統計替身（combat.js 有 11 處 window.recordLootX）---- */
function _lootRecorder(name) {
  return function () {
    _diag(SHIM_DIAG.ui, name);
    shimPushEvent('loot', { fn: name, args: Array.prototype.slice.call(arguments) });
  };
}
self.recordLootBattle = _lootRecorder('recordLootBattle');
self.recordLootGold = _lootRecorder('recordLootGold');
self.recordLootKill = _lootRecorder('recordLootKill');
self.recordLootDeath = _lootRecorder('recordLootDeath');
self.recordLootDrop = _lootRecorder('recordLootDrop');
self.recordLootEquip = _lootRecorder('recordLootEquip');
self.recordLootGem = _lootRecorder('recordLootGem');
self.recordLootMat = _lootRecorder('recordLootMat');

/* ---- DOM 替身 ----
   模擬層只剩 4 處碰 DOM（util.js 的 $id、combat.js 的 flushRunSummary、
   save.js 的匯出下載連結）。給最小替身讓它們不炸，同時計數供 P3 清除。 */
function _stubElement() {
  var el = {
    style: {}, innerHTML: '', textContent: '', firstChild: null, value: '',
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    setAttribute: function () {}, getAttribute: function () { return null; },
    appendChild: function () {}, insertBefore: function () {}, removeChild: function () {},
    remove: function () {}, addEventListener: function () {}, removeEventListener: function () {},
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    click: function () {}
  };
  return el;
}

self.document = {
  hidden: false,
  readyState: 'complete',
  body: _stubElement(),
  getElementById: function () { _diag(SHIM_DIAG.dom, 'getElementById'); return null; },
  querySelector: function () { _diag(SHIM_DIAG.dom, 'querySelector'); return null; },
  querySelectorAll: function () { _diag(SHIM_DIAG.dom, 'querySelectorAll'); return []; },
  createElement: function () { _diag(SHIM_DIAG.dom, 'createElement'); return _stubElement(); },
  addEventListener: function () { _diag(SHIM_DIAG.dom, 'addEventListener'); },
  removeEventListener: function () { _diag(SHIM_DIAG.dom, 'removeEventListener'); }
};

/* ---- localStorage 替身（僅 P1 有效，P2 必須移除）----
   Worker 沒有 localStorage。save.js 有 53 處呼叫，P2 會把儲存 I/O 全部改走
   persist / saveResult 訊息交給主執行緒。

   在那之前先給一個記憶體版替身，讓 P1 空跑不會因為 ReferenceError 中斷。
   ⚠️ 這個替身寫進去的東西不會落地。P2 完成後**必須刪掉**本區塊，
   並確認 SHIM_DIAG.storage 全為 0，否則代表還有存檔路徑偷走記憶體版。 */
var _memStore = {};
self.localStorage = {
  getItem: function (k) { _diag(SHIM_DIAG.storage, 'getItem'); return Object.prototype.hasOwnProperty.call(_memStore, k) ? _memStore[k] : null; },
  setItem: function (k, v) { _diag(SHIM_DIAG.storage, 'setItem'); _memStore[k] = String(v); },
  removeItem: function (k) { _diag(SHIM_DIAG.storage, 'removeItem'); delete _memStore[k]; },
  key: function (i) { _diag(SHIM_DIAG.storage, 'key'); return Object.keys(_memStore)[i] || null; },
  clear: function () { _diag(SHIM_DIAG.storage, 'clear'); _memStore = {}; }
};
Object.defineProperty(self.localStorage, 'length', {
  get: function () { return Object.keys(_memStore).length; }
});
