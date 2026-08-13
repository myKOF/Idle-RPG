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
   非視覺事件超過上限時丟棄最舊的並計數，避免掛機一整天把記憶體吃光。
   前景傷害浮字例外：它們必須送到主執行緒自然淡出，不能因佇列壅塞而消失；
   背景則由 shimSetBackground() 降為只保留最新一筆。 */
var SHIM_EVENT_CAP = 400;
var _shimEvents = [];
var _shimEventsDropped = 0;
var _shimBackground = false;
var _shimLatestBackgroundFloat = null;

/* 背景分頁仍要持續模擬，但主執行緒可能被瀏覽器大幅降頻。
   傷害數字是純視覺事件，背景期間只保留最新一筆，避免 Worker 事件佇列
   與瀏覽器的跨執行緒訊息佇列跟著戰鬥速度無限成長。 */
function shimSetBackground(hidden) {
  hidden = !!hidden;
  if (hidden === _shimBackground) return;
  if (hidden) {
    var latest = _shimLatestBackgroundFloat;
    var kept = [];
    for (var i = 0; i < _shimEvents.length; i++) {
      var event = _shimEvents[i];
      if (event && event.kind === 'float') latest = event;
      else kept.push(event);
    }
    _shimEvents = kept;
    _shimLatestBackgroundFloat = latest;
    _shimBackground = true;
    return;
  }
  _shimBackground = false;
  if (_shimLatestBackgroundFloat) {
    _shimEvents.push(_shimLatestBackgroundFloat);
    _shimLatestBackgroundFloat = null;
  }
}

function shimPushEvent(kind, data) {
  data = data || {};
  data.kind = kind;
  if (kind === 'float' && _shimBackground) {
    _shimLatestBackgroundFloat = data;
    return;
  }
  if (kind !== 'float') {
    var nonFloatCount = 0;
    for (var i = 0; i < _shimEvents.length; i++) {
      if (_shimEvents[i] && _shimEvents[i].kind !== 'float') nonFloatCount++;
    }
    if (nonFloatCount >= SHIM_EVENT_CAP) {
      for (var di = 0; di < _shimEvents.length; di++) {
        if (_shimEvents[di] && _shimEvents[di].kind !== 'float') {
          _shimEvents.splice(di, 1);
          _shimEventsDropped++;
          break;
        }
      }
    }
  }
  _shimEvents.push(data);
}

function shimDrainEvents() {
  var out = _shimEvents;
  _shimEvents = [];
  if (!_shimBackground && _shimLatestBackgroundFloat) {
    out.push(_shimLatestBackgroundFloat);
    _shimLatestBackgroundFloat = null;
  }
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

/* 模擬層的 nflog（newforge.js:12）是直接呼叫 addLog('newforge-log', ...) 而不是 flog，
   若照原樣轉成 log 事件，熔爐日誌會依呼叫者不同落在兩種事件種類，UI 端得判斷兩次。
   統一歸到 flog。 */
function addLog(boxId, msg, cls, cap) {
  _diag(SHIM_DIAG.ui, 'addLog');
  if (boxId === 'newforge-log') { shimPushEvent('flog', { msg: msg, cls: cls }); return; }
  shimPushEvent('log', { msg: msg, cls: cls, box: boxId, cap: cap });
}

/* 戰鬥飄字。實際簽章是 floatText(elId, text, cls, damageValue, ent)。

   elId 已經是元素 id 字串——util.js 的 playerEventFloatTarget / enemyEventFloatTarget
   會先從 ent.floatSel 解析出來，而那兩支就在模擬層，Worker 內可正常執行。

   ⚠️ 刻意不傳 ent：主執行緒是用 activeEnemies.indexOf(item.ent) 做**物件識別比對**
   （ui.js 的 flushPendingEnemyFloats），而 structured clone 過來的是複本，
   indexOf 永遠不會相等，傳過去只會讓飄字被靜靜丟棄。識別資訊已經在 elId 裡
   （mv-float-N 對應敵人槽位），UI 端請改用 elId 判斷目標是否仍存在。 */
function floatText(elId, text, cls, damageValue, ent, battleSnapshot, delayMs) {
  _diag(SHIM_DIAG.ui, 'floatText');
  shimPushEvent('float', {
    elId: elId, text: text, cls: cls, damageValue: damageValue,
    // 顯示延遲（協議 v11）：讓數字對齊子彈命中與多段節奏，不影響任何戰鬥結算
    delayMs: (delayMs > 0) ? delayMs : 0
  });
}

/* 技能／增益特效（協議 v10）。模擬層送的是純資料（原型/顏色/目標圖層/格子），
   實際畫法在主執行緒的 js/vfx.js——Worker 這側不知道也不需要知道怎麼畫。 */
function playCombatVfx(spec) {
  _diag(SHIM_DIAG.ui, 'playCombatVfx');
  if (!spec) return;
  shimPushEvent('vfx', {
    fxKind: spec.fxKind, glyph: spec.glyph, color: spec.color,
    targets: spec.targets || [], cells: spec.cells || null,
    area: spec.area || null,
    dur: spec.dur, count: spec.count,
    // travelMs 必須一起送：傷害數字的延遲用的是這組數字，投射物動畫沒拿到就會用
    // 預設長度，變成「數字到了子彈還在飛」——與 v11 反過來的走鐘。
    travelMs: spec.travelMs || null,
    // v17 元素化特效欄位：屬性／分類／變體／基礎延遲（追加劍氣、天罰的錯開時刻）。
    // 少送任何一個，顯示層都會退回單色預設畫法——所以新增欄位務必同步列在這裡。
    elem: spec.elem || null, cat: spec.cat || null,
    variant: spec.variant || null,
    delayMs: (spec.delayMs > 0) ? spec.delayMs : 0
  });
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

/* ---- localStorage 攔截器（P2 起改為「會爆」的版本）----
   Worker 沒有 localStorage。P1 時這裡是記憶體替身，讓空跑不中斷；
   P2 已把儲存 I/O 全部改走 persist / saveResult 交給主執行緒
   （見 sim.worker.js 的 installStorageGuards），Worker 內不該再有任何一次呼叫。

   所以改成呼叫即拋錯：寧可在驗證期大聲失敗，也不要靜靜寫進一個不會落地的記憶體物件
   ——那種錯誤要等玩家存檔消失才會被發現。
   錯誤會被 loop / onmessage 的 try-catch 接住並回報 ERROR，不會讓 Worker 死掉。 */
function _storageTrap(op) {
  return function () {
    _diag(SHIM_DIAG.storage, op);
    throw new Error('Worker 內不得直接使用 localStorage.' + op +
      '（儲存 I/O 必須經由 persist 訊息交主執行緒；見 docs/WORKER_PROTOCOL.md 第 5 節）');
  };
}
self.localStorage = {
  getItem: _storageTrap('getItem'),
  setItem: _storageTrap('setItem'),
  removeItem: _storageTrap('removeItem'),
  key: _storageTrap('key'),
  clear: _storageTrap('clear')
};
Object.defineProperty(self.localStorage, 'length', {
  get: function () { _diag(SHIM_DIAG.storage, 'length'); return 0; }
});
