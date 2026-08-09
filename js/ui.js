'use strict';
/* ============ UI 渲染與互動 ============ */

var UI = {
  dirty: { header: true, battle: true, equip: true, inv: true, factory: true, newforge: true, forge: true, tower: true, gems: true, skills: true, talents: true },
  sel: null,           // { id, source: 'inv' | 'equip' } 或 { source: 'equip-slot', slot }
  tab: 'equip',
  saveNoticeId: null,
  tooltipAnchor: null,
  affixPoolSource: null,
  towerTimerRaf: 0,
  towerTimerAnchor: null,
  inventoryVisibleRows: 3,
  inventorySortIndex: 0,
  inventoryKeywordQuery: '',
  inventoryFilterCacheKey: null,
  inventoryFilterCacheItems: null,
  pendingItemTooltip: null,
  hoveredItemTooltip: null,
  inventoryScrolling: false,
  inventoryScrollTimer: null,
  inventoryDetailRefreshPending: false,
  equipFlashSlots: Object.create(null),
  equipFlashTimer: null,
  statsPanelOpen: false,
  battleLayoutDirty: true,
  zoneBarSignature: null,
  performanceEventsBound: false,
  lastInteractionAt: 0,
  lastBattleRenderAt: 0,
  stageHold: {
    startTimer: null,
    repeatTimer: null,
    suppressClick: false,
    suppressTimer: null,
    pointerId: null,
    active: false,
    startedAt: 0,
    startStage: 0,
    targetStage: null,
    delta: 0
  }
};

/*
 * P3 migration order.  Keep the coupled equipment/inventory pair together:
 * both panels also invalidate gems and header data.
 */
var UI_PANEL_MIGRATION_ORDER = [
  ['talents'],
  ['skills'],
  ['gems'],
  ['tower'],
  ['newforge'],
  ['forge'],
  ['equip', 'inv'],
  ['header']
];

/*
 * Only migrated panels belong here.  A visible tab keeps its panel slices
 * subscribed; switching tabs drops those subscriptions unless a pending
 * command still needs an authoritative response.
 */
var UI_PANEL_SUBSCRIPTIONS_BY_TAB = {
  equip: ['equip', 'inv', 'gems', 'header'],
  gems: ['gems', 'header'],
  skills: ['skills', 'talents', 'header'],
  talents: ['talents', 'header'],
  tower: ['tower', 'header'],
  newforge: ['newforge', 'factory', 'header'],
  forge: ['forge', 'inv', 'gems', 'header']
};
var UI_PERSISTENT_PANEL_SUBSCRIPTIONS = ['talents', 'header', 'battle']; // talent visibility + always-visible header/battle

/*
 * Worker-backed UI state.  Renderers migrate to viewState()/panelData() one
 * panel at a time; these caches deliberately have no G fallback.
 */
var UI_WORKER_STATE = {
  bridgeBound: false,
  view: null,
  viewSubscribed: false,
  panels: Object.create(null),
  panelSubscriptions: Object.create(null),
  panelRequests: Object.create(null),
  panelRequestSeq: Object.create(null),
  panelResponseSeq: Object.create(null),
  panelQueued: Object.create(null),
  panelVersions: Object.create(null)
};

/*
 * A command can own several keys (for example an item and a furnace).  The
 * whole entry is released after a successful ACK and every authoritative
 * panel response requested after that ACK; errors release it immediately.
 */
var UI_COMMAND_PENDING = {
  seq: 0,
  byKey: Object.create(null),
  byToken: Object.create(null)
};

var WORKER_RESTART_NOTICE_TIMER = 0;

/* Worker 訊息回呼不可同步建立整批戰鬥視覺 DOM，否則 pointer/keyboard 事件
   只能等整批浮字與特效處理完才有機會執行。視覺事件可延後一個 frame，且
   超過上限時只丟棄最舊的畫面事件；戰鬥數值仍以 Worker snapshot 為準。 */
var UI_WORKER_VISUAL_EVENT_QUEUE = [];
var UI_WORKER_VISUAL_FLUSH_HANDLE = 0;
var UI_WORKER_VISUAL_QUEUE_MAX = 160;
var UI_WORKER_VISUAL_FRAME_BUDGET = 6;

function hasOwnUiState(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function showWorkerDeadNotice(event) {
  if (typeof document === 'undefined' || $id('worker-dead-notice')) return;
  var overlay = document.createElement('div');
  overlay.id = 'worker-dead-notice';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;' +
    'justify-content:center;padding:24px;background:rgba(3,7,18,.88);';

  var card = document.createElement('div');
  card.style.cssText = 'width:min(520px,100%);padding:24px;border:1px solid #ef4444;border-radius:14px;' +
    'background:#111827;color:#f9fafb;box-shadow:0 20px 60px rgba(0,0,0,.55);text-align:center;';
  var title = document.createElement('h2');
  title.textContent = '⚠️ 遊戲模擬已停止';
  title.style.cssText = 'margin:0 0 12px;color:#fca5a5;';
  var desc = document.createElement('p');
  desc.style.cssText = 'margin:0 0 12px;line-height:1.65;';
  var restartCount = Number(event && event.restarts);
  if (!isFinite(restartCount) || restartCount < 0) {
    restartCount = typeof WorkerBridge.status === 'function'
      ? Number(WorkerBridge.status().restarts) || 0
      : 0;
  }
  desc.textContent = '已自動嘗試恢復 ' + restartCount + ' 次仍失敗，可能是存檔資料有問題。';
  var detail = document.createElement('pre');
  detail.textContent = event && event.reason ? String(event.reason) : 'Worker 已失去回應';
  detail.style.cssText = 'margin:0 0 18px;padding:10px;max-height:120px;overflow:auto;border-radius:8px;' +
    'background:#030712;color:#d1d5db;text-align:left;white-space:pre-wrap;';
  var reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'btn';
  reload.textContent = '重新載入';
  reload.addEventListener('click', function () { location.reload(); });

  var safeReload = document.createElement('button');
  safeReload.type = 'button';
  safeReload.className = 'btn';
  safeReload.textContent = '安全模式重新載入';
  safeReload.style.marginLeft = '8px';
  safeReload.addEventListener('click', function () {
    var next = new URL(location.href);
    next.searchParams.set('safe', '1');
    location.assign(next.toString());
  });

  card.appendChild(title);
  card.appendChild(desc);
  card.appendChild(detail);
  card.appendChild(reload);
  card.appendChild(safeReload);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  reload.focus();
}

function hideWorkerDeadNotice() {
  var overlay = $id('worker-dead-notice');
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
}

function hideWorkerRestartNotice() {
  if (WORKER_RESTART_NOTICE_TIMER) {
    clearTimeout(WORKER_RESTART_NOTICE_TIMER);
    WORKER_RESTART_NOTICE_TIMER = 0;
  }
  var notice = $id('worker-restart-notice');
  if (notice && notice.parentNode) notice.parentNode.removeChild(notice);
}

function showWorkerRestartNotice(text, recovered) {
  if (typeof document === 'undefined' || !document.body) return;
  if (WORKER_RESTART_NOTICE_TIMER) {
    clearTimeout(WORKER_RESTART_NOTICE_TIMER);
    WORKER_RESTART_NOTICE_TIMER = 0;
  }
  var notice = $id('worker-restart-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'worker-restart-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);' +
      'z-index:100001;padding:10px 18px;border-radius:999px;background:rgba(17,24,39,.94);' +
      'color:#f9fafb;box-shadow:0 6px 24px rgba(0,0,0,.3);pointer-events:none;transition:opacity .35s ease;';
    document.body.appendChild(notice);
  }
  notice.style.opacity = '1';
  notice.textContent = text;
  if (recovered) {
    WORKER_RESTART_NOTICE_TIMER = setTimeout(function () {
      notice.style.opacity = '0';
      WORKER_RESTART_NOTICE_TIMER = setTimeout(function () {
        if (notice.parentNode) notice.parentNode.removeChild(notice);
        WORKER_RESTART_NOTICE_TIMER = 0;
      }, 400);
    }, 2200);
  }
}

function handleWorkerRestarting(event) {
  var attempt = Number(event && event.attempt) || 1;
  var max = Number(event && event.max) || 3;
  hideWorkerDeadNotice();
  showWorkerRestartNotice('模擬中斷，正在自動恢復…（第 ' + attempt + '/' + max + ' 次）', false);
}

function resetUiWorkerPanelState() {
  UI_WORKER_STATE.panelRequests = Object.create(null);
  UI_WORKER_STATE.panelQueued = Object.create(null);
  UI_WORKER_STATE.panelRequestSeq = Object.create(null);
  UI_WORKER_STATE.panelResponseSeq = Object.create(null);
  UI_WORKER_STATE.panels = Object.create(null);
  UI_WORKER_STATE.panelVersions = Object.create(null);
  UI.inventoryFilterCacheKey = null;
  UI.inventoryFilterCacheItems = null;
  if (UI.inventoryRenderCache) {
    UI.inventoryRenderCache.filterKey = null;
    UI.inventoryRenderCache.startRow = null;
    UI.inventoryRenderCache.totalRows = null;
    UI.inventoryRenderCache.columns = null;
    UI.inventoryRenderCache.displayedLength = null;
    UI.inventoryRenderCache.detailKey = null;
  }
}

function handleWorkerRestarted(event) {
  resetUiWorkerPanelState();
  showWorkerRestartNotice('已自動恢復，進度回到最近一次自動存檔', true);
  refreshUiPanelSubscriptions();
}

function updateWorkerSafeModeMarker() {
  if (typeof document === 'undefined' || !document.body) return;
  var safe = typeof WorkerBridge.safeMode === 'function' && WorkerBridge.safeMode();
  var marker = $id('worker-safe-mode-marker');
  if (!safe) {
    if (marker && marker.parentNode) marker.parentNode.removeChild(marker);
    return;
  }
  if (!marker) {
    marker = document.createElement('div');
    marker.id = 'worker-safe-mode-marker';
    marker.setAttribute('role', 'status');
    marker.textContent = '安全模式';
    marker.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99999;padding:4px 9px;' +
      'border-radius:5px;background:#92400e;color:#fffbeb;font-size:12px;pointer-events:none;';
    document.body.appendChild(marker);
  }
}

function handleWorkerDead(event) {
  hideWorkerRestartNotice();
  showWorkerDeadNotice(event);
}

function validUiPanelKey(key) {
  if (typeof isPanelKey === 'function') return isPanelKey(key);
  if (typeof PANEL_KEYS === 'undefined') return false;
  return PANEL_KEYS.indexOf(key) >= 0;
}

function desiredUiPanelSubscriptions() {
  var desired = Object.create(null);
  function include(keys) {
    (keys || []).forEach(function (key) {
      if (validUiPanelKey(key)) desired[key] = true;
    });
  }

  include(UI_PERSISTENT_PANEL_SUBSCRIPTIONS);
  include(UI_PANEL_SUBSCRIPTIONS_BY_TAB[UI.tab]);
  if (UI.statsPanelOpen) include(['battle']);
  if (UI.questPanelOpen) include(['task']); // 任務總覽開著才訂閱 task 面板
  if (typeof UI_COMMAND_PENDING !== 'undefined' && UI_COMMAND_PENDING) {
    Object.keys(UI_COMMAND_PENDING.byToken).forEach(function (token) {
      include(Object.keys(UI_COMMAND_PENDING.byToken[token].waitPanels));
    });
  }
  return desired;
}

function refreshUiPanelSubscriptions() {
  var desired = desiredUiPanelSubscriptions();
  Object.keys(UI_WORKER_STATE.panelSubscriptions).forEach(function (key) {
    if (!desired[key]) delete UI_WORKER_STATE.panelSubscriptions[key];
  });
  Object.keys(desired).forEach(function (key) {
    UI_WORKER_STATE.panelSubscriptions[key] = true;
  });
}

function viewState() {
  UI_WORKER_STATE.viewSubscribed = true;
  return UI_WORKER_STATE.view;
}

function uiHeaderXpMax(player) {
  var view = viewState() || {};
  var xpMax = Number(view.xpMax);
  if (Number.isFinite(xpMax) && xpMax > 0) return xpMax;
  return xpForLevel(player && player.level);
}

/* ---- 主執行緒的遊戲時鐘 ----
   GT 的權威在 Worker，但畫面上所有「還剩幾秒」的顯示都要跟它比對：
   狀態圖示（effectActive／dots.until／buffs.until 都是絕對到期時刻）、技能冷卻、復活倒數。

   在此之前主執行緒的 GT **從開機到關機都是 0**（util.js 宣告後沒有任何一處更新），
   於是 `until > GT` 恆為真——暈眩、減速、中毒、增益圖示一旦出現就再也不會消失。

   tick 只有 5Hz，直接拿 view.gt 當時鐘會一格一格跳；所以在兩次 tick 之間用真實時間
   補間，倒數才是平順的碼錶。暫停時不推進（GT 在 Worker 那側也不會動）。
   補間只是估計值，每次 tick 抵達就重新對時，誤差不會累積。 */
var _uiGtBase = 0;
var _uiGtBaseAt = 0;

function uiNowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function uiSyncGameTime(view) {
  if (!view || typeof view.gt !== 'number' || !isFinite(view.gt)) return;
  _uiGtBase = view.gt;
  _uiGtBaseAt = uiNowMs();
}

/* 目前的遊戲時間（估計值）。沒有任何 tick 抵達過就回傳 0。 */
function uiGameTime() {
  if (!_uiGtBaseAt) return _uiGtBase;
  var view = UI_WORKER_STATE.view || {};
  if (view.paused) return _uiGtBase;
  return _uiGtBase + Math.max(0, uiNowMs() - _uiGtBaseAt) / 1000;
}

/* 讓共載的 effectActive／activeBuffKeys／entStatus 等函式看到現在的時間。
   它們直接讀全域 GT，所以每次重繪前對一次時就好，不必逐一改寫那些函式。 */
function uiApplyGameTime() {
  GT = uiGameTime();
  return GT;
}

/* 面板快照裡的「還剩幾秒」欄位（技能冷卻、復活倒數）是拍照當下的值。
   扣掉拍照到現在經過的時間才是真正的剩餘秒數，否則會卡住到下一次面板更新才跳。 */
function uiCountdownRemain(value, snapshotGt) {
  var v = Number(value) || 0;
  if (v <= 0) return 0;
  if (typeof snapshotGt !== 'number' || !isFinite(snapshotGt)) return v;
  return Math.max(0, v - Math.max(0, uiGameTime() - snapshotGt));
}

function mergeUiPanelParams(first, second) {
  var merged = {};
  var hasParams = false;
  [first, second].forEach(function (source) {
    if (!source || typeof source !== 'object') return;
    Object.keys(source).forEach(function (key) {
      if (key === 'detailIds') return;
      merged[key] = source[key];
      hasParams = true;
    });
  });
  var detailIds = [];
  var seenIds = Object.create(null);
  [first, second].forEach(function (source) {
    if (!source || !Array.isArray(source.detailIds)) return;
    source.detailIds.forEach(function (id) {
      id = String(id || '');
      if (!id || seenIds[id] || detailIds.length >= 200) return;
      seenIds[id] = true;
      detailIds.push(id);
    });
  });
  if (detailIds.length) {
    merged.detailIds = detailIds;
    hasParams = true;
  }
  if (merged.full === true) delete merged.detailIds;
  return hasParams ? merged : undefined;
}

function activeUiPanelParams(key) {
  if (key !== 'inv' || typeof document === 'undefined') return undefined;
  /* 兩個參數的適用範圍不同，守衛不能共用：

     `full` 是關鍵字篩選要的，而那個輸入框只在內測服顯示，所以它留在 isInternalServer() 內。

     `detailIds` 與環境無關——它是「選取中的背包物品要能被解析出來」的必要條件。背包格子
     只送 12 個欄位的投影，完整物品資料只存在於 details；面板一旦在不帶 detailIds 的情況下
     刷新，details 就被洗成 null，findSelItem() 回 null，detailAction() 第一行直接 return，
     裝備／分解／強化／鎖定四顆按鈕全部靜靜失效（點了完全沒反應，不是變灰）。

     兩者原本共用同一個 isInternalServer() 守衛，等於外部玩家永遠拿不到 detailIds——
     內測環境測不出來，因為在 localhost 上守衛恆真。 */
  if (isInternalServer()) {
    var input = $id('inv-keyword-filter');
    if (input && String(input.value || '').trim()) return { full: true };
  }
  if (UI.sel && UI.sel.source === 'inv' && UI.sel.id) {
    return { detailIds: [UI.sel.id] };
  }
  return undefined;
}

function requestPanelData(key, force, params) {
  if (typeof WorkerBridge.requestPanel !== 'function' ||
    !validUiPanelKey(key)) {
    return false;
  }
  var requestParams = mergeUiPanelParams(activeUiPanelParams(key), params);

  if (!force && hasOwnUiState(UI_WORKER_STATE.panels, key)) {
    return UI_WORKER_STATE.panelResponseSeq[key] || 1;
  }
  if (UI_WORKER_STATE.panelRequests[key]) {
    if (force) {
      UI_WORKER_STATE.panelQueued[key] =
        mergeUiPanelParams(UI_WORKER_STATE.panelQueued[key], requestParams) || {};
    }
    return force
      ? UI_WORKER_STATE.panelRequests[key] + 1
      : UI_WORKER_STATE.panelRequests[key];
  }

  var requestSeq = (UI_WORKER_STATE.panelRequestSeq[key] || 0) + 1;
  UI_WORKER_STATE.panelRequestSeq[key] = requestSeq;
  UI_WORKER_STATE.panelRequests[key] = requestSeq;
  if (!WorkerBridge.requestPanel(key, requestParams)) {
    delete UI_WORKER_STATE.panelRequests[key];
    return false;
  }
  return requestSeq;
}

function panelData(key) {
  if (!validUiPanelKey(key)) return null;
  // Subscription lifetime is derived from the visible tab and pending commands.
  if (!hasOwnUiState(UI_WORKER_STATE.panels, key)) {
    requestPanelData(key, false);
    return null;
  }
  return UI_WORKER_STATE.panels[key];
}

function peekUiPanelData(key) {
  if (!validUiPanelKey(key) || !hasOwnUiState(UI_WORKER_STATE.panels, key)) return null;
  return UI_WORKER_STATE.panels[key];
}

function applyUiSnapshot(snapshot) {
  if (!snapshot) return;
  if (snapshot.view) UI_WORKER_STATE.view = snapshot.view;
  uiSyncGameTime(snapshot.view);
}

function scheduleWorkerVisualEventFlush() {
  if (UI_WORKER_VISUAL_FLUSH_HANDLE || !UI_WORKER_VISUAL_EVENT_QUEUE.length) return;
  var flush = function () {
    UI_WORKER_VISUAL_FLUSH_HANDLE = 0;
    flushWorkerVisualEvents();
  };
  if (typeof requestAnimationFrame === 'function') {
    UI_WORKER_VISUAL_FLUSH_HANDLE = requestAnimationFrame(flush);
  } else if (typeof setTimeout === 'function') {
    UI_WORKER_VISUAL_FLUSH_HANDLE = setTimeout(flush, 0);
  }
}

function queueWorkerVisualEvent(event) {
  if (!event) return;
  if (UI_WORKER_VISUAL_EVENT_QUEUE.length >= UI_WORKER_VISUAL_QUEUE_MAX) {
    UI_WORKER_VISUAL_EVENT_QUEUE.shift();
  }
  UI_WORKER_VISUAL_EVENT_QUEUE.push(event);
  scheduleWorkerVisualEventFlush();
}

function flushWorkerVisualEvents() {
  if (typeof uiRenderingSuspended === 'function' && uiRenderingSuspended()) {
    for (var hiddenIndex = 0; hiddenIndex < UI_WORKER_VISUAL_EVENT_QUEUE.length; hiddenIndex++) {
      var hiddenEvent = UI_WORKER_VISUAL_EVENT_QUEUE[hiddenIndex];
      if (hiddenEvent && hiddenEvent.kind === 'float') {
        rememberBackgroundEnemyFloat(hiddenEvent.elId, hiddenEvent.text,
          hiddenEvent.cls, hiddenEvent.damageValue);
      }
    }
    UI_WORKER_VISUAL_EVENT_QUEUE.length = 0;
    return;
  }

  var processed = 0;
  while (UI_WORKER_VISUAL_EVENT_QUEUE.length && processed < UI_WORKER_VISUAL_FRAME_BUDGET) {
    var event = UI_WORKER_VISUAL_EVENT_QUEUE.shift();
    if (!event) continue;
    if (event.kind === 'float') {
      floatText(event.elId, event.text, event.cls, event.damageValue, null,
        uiBattlePanelSnapshot(), event.delayMs);
    } else if (event.kind === 'vfx') {
      if (typeof playCombatVfx === 'function') playCombatVfx(event);
    }
    processed++;
  }
  if (UI_WORKER_VISUAL_EVENT_QUEUE.length) scheduleWorkerVisualEventFlush();
}

function handleWorkerUiEvents(events) {
  (events || []).forEach(function (event) {
    if (!event) return;
    if (event.kind === 'flog') {
      addLog('newforge-log', event.msg, event.cls, 50);
      return;
    }
    if (event.kind === 'log') {
      if (event.box) {
        addLog(event.box, event.msg, event.cls, event.cap);
      } else {
        routeUiLog(event.msg, event.cls, event.cat, workerTowerActiveForLog());
      }
      return;
    }
    if (event.kind === 'float') {
      if (typeof uiRenderingSuspended === 'function' && uiRenderingSuspended()) {
        rememberBackgroundEnemyFloat(event.elId, event.text, event.cls, event.damageValue);
        return;
      }
      queueWorkerVisualEvent(event);
      return;
    }
    // 技能／增益特效（協議 v10）：實際畫法在 js/vfx.js，這裡只轉交
    if (event.kind === 'vfx') {
      queueWorkerVisualEvent(event);
      return;
    }
    if (event.kind === 'loot') {
      // Battle statistics are authoritative Worker state projected by
      // panel('battle'). Replaying recorder calls here would double-count.
      return;
    }
    if (event.kind !== 'notice') return;
    if (event.key === 'offlineSummary') {
      showOfflineSummary(event.data);
      return;
    }
    if (event.modal && event.text) {
      showConfirmDialog(event.text);
      return;
    }
    if (event.text) {
      blog(event.text, 'info', 'system');
      return;
    }
    if (event.key === 'towerResult') {
      UI.pendingTowerResult = event.data || null;
      requestPanelData('tower', true);
      requestPanelData('header', true);
    } else if (event.key === 'forgeUnlocked') {
      requestPanelData('forge', true);
      requestPanelData('header', true);
      showConfirmDialog('神鑄系統已開啟！\n\n將 6 件相同品質的裝備（傳說/神話/創世）放入六芒星法陣，即可鑄造下一品質的裝備。是否前往查看？', function () {
        switchTab('forge');
        UI.dirty.forge = true;
      }, { title: '🔯 神鑄系統', okText: '前往神鑄', cancelText: '稍後再說' });
    }
  });
}

function handleWorkerBootNotices(notices) {
  (notices || []).forEach(function (notice) {
    if (!notice) return;
    handleWorkerUiEvents([{
      kind: 'notice',
      key: notice.key,
      data: notice.data,
      text: notice.text,
      modal: notice.modal
    }]);
  });
}

function uiPendingKey(kind, id) {
  var prefix = String(kind || 'command');
  return (id === undefined || id === null || id === '')
    ? prefix
    : prefix + ':' + String(id);
}

function itemPendingKey(itemId) {
  return uiPendingKey('item', itemId);
}

function furnacePendingKey(furnaceId) {
  return uiPendingKey('furnace', furnaceId);
}

function nodePendingKey(nodeId) {
  return uiPendingKey('node', nodeId);
}

function isUiCommandPending(key, id) {
  var normalized = arguments.length > 1 ? uiPendingKey(key, id) : String(key);
  return !!UI_COMMAND_PENDING.byKey[normalized];
}

function syncUiPendingControls(key) {
  if (typeof document === 'undefined') return;
  var rawKey = String(key);
  var selectorKey = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(rawKey)
    : rawKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  var controls = document.querySelectorAll('[data-ui-pending-key="' + selectorKey + '"]');
  var pending = isUiCommandPending(key);
  for (var i = 0; i < controls.length; i++) {
    controls[i].disabled = pending;
  }
}

function bindUiPendingControl(control, key) {
  if (control && typeof control.setAttribute === 'function') {
    control.setAttribute('data-ui-pending-key', key);
  }
}

function normalizeUiPendingKeys(commandName, options) {
  var raw = options && options.keys;
  if (raw === undefined || raw === null) raw = [];
  if (!Array.isArray(raw)) raw = [raw];
  if (!raw.length) raw.push(uiPendingKey('command', commandName));

  var unique = [];
  var seen = Object.create(null);
  for (var i = 0; i < raw.length; i++) {
    var key = String(raw[i]);
    if (!key || seen[key]) continue;
    seen[key] = true;
    unique.push(key);
  }
  return unique;
}

function normalizeUiPendingPanels(commandName, options) {
  var raw = options && options.panels;
  if (raw === undefined || raw === null) {
    var spec = typeof commandSpec === 'function'
      ? commandSpec(commandName)
      : null;
    raw = spec && spec.dirty ? spec.dirty : [];
  }
  if (!Array.isArray(raw)) raw = [raw];

  var unique = [];
  var seen = Object.create(null);
  for (var i = 0; i < raw.length; i++) {
    var key = String(raw[i]);
    if (!validUiPanelKey(key) || seen[key]) continue;
    seen[key] = true;
    unique.push(key);
  }
  return unique;
}

function releaseUiPendingToken(token) {
  var entry = UI_COMMAND_PENDING.byToken[token];
  if (!entry) return false;

  delete UI_COMMAND_PENDING.byToken[token];
  for (var i = 0; i < entry.keys.length; i++) {
    var key = entry.keys[i];
    if (UI_COMMAND_PENDING.byKey[key] === entry) {
      delete UI_COMMAND_PENDING.byKey[key];
      syncUiPendingControls(key);
    }
  }
  refreshUiPanelSubscriptions();
  return true;
}

function releaseUiPendingByPanel(panelKey) {
  Object.keys(UI_COMMAND_PENDING.byToken).forEach(function (token) {
    var entry = UI_COMMAND_PENDING.byToken[token];
    if (!entry.acknowledged || !entry.waitPanels[panelKey]) return;
    var waitKeys = Object.keys(entry.waitPanels);
    var ready = waitKeys.every(function (key) {
      return (UI_WORKER_STATE.panelResponseSeq[key] || 0) >= entry.waitPanels[key];
    });
    if (ready) {
      releaseUiPendingToken(entry.token);
    }
  });
}

function acquireUiPending(commandName, options) {
  var keys = normalizeUiPendingKeys(commandName, options);
  for (var i = 0; i < keys.length; i++) {
    if (UI_COMMAND_PENDING.byKey[keys[i]]) {
      return { error: new Error('command pending: ' + keys[i]) };
    }
  }

  var token = 'ui-command-' + (++UI_COMMAND_PENDING.seq);
  var panels = normalizeUiPendingPanels(commandName, options);
  var entry = {
    token: token,
    keys: keys,
    acknowledged: false,
    waitPanels: Object.create(null)
  };

  for (var p = 0; p < panels.length; p++) {
    var panelKey = panels[p];
    entry.waitPanels[panelKey] = 0;
  }

  UI_COMMAND_PENDING.byToken[token] = entry;
  for (var k = 0; k < keys.length; k++) {
    UI_COMMAND_PENDING.byKey[keys[k]] = entry;
    syncUiPendingControls(keys[k]);
  }
  refreshUiPanelSubscriptions();

  return { entry: entry };
}

function sendUiCommand(commandName, args, options) {
  if (typeof WorkerBridge.send !== 'function') {
    return Promise.reject(new Error('worker UI state is not enabled'));
  }

  var acquired = acquireUiPending(commandName, options);
  if (acquired.error) return Promise.reject(acquired.error);

  var token = acquired.entry.token;
  var sent;
  try {
    sent = WorkerBridge.send(commandName, args || {});
  } catch (err) {
    releaseUiPendingToken(token);
    return Promise.reject(err);
  }

  return sent.then(function (result) {
    var entry = UI_COMMAND_PENDING.byToken[token];
    if (!entry) return result;
    var resultError = typeof uiCommandResultError === 'function'
      ? uiCommandResultError(result)
      : null;
    if (resultError || !Object.keys(entry.waitPanels).length) {
      releaseUiPendingToken(token);
      return result;
    }
    entry.acknowledged = true;
    Object.keys(entry.waitPanels).forEach(function (key) {
      entry.waitPanels[key] = requestPanelData(key, true);
    });
    return result;
  }, function (err) {
    releaseUiPendingToken(token);
    throw err;
  });
}

function bindWorkerUiState() {
  if (UI_WORKER_STATE.bridgeBound ||
    typeof WorkerBridge.on !== 'function' ||
    typeof MSG_OUT === 'undefined') {
    return false;
  }
  UI_WORKER_STATE.bridgeBound = true;

  WorkerBridge.on(MSG_OUT.BOOTED, function (msg) {
    applyUiSnapshot(msg.snapshot);
    updateWorkerSafeModeMarker();
    handleWorkerUiEvents(msg.events);
    handleWorkerBootNotices(msg.notices);
    /* initUI() 可能早於 IndexedDB 存檔讀取完成；那時 requestPanelData()
       還送不到 Worker，不能只等待下一次 dirty tick 才重新要求初始面板。 */
    if (typeof refreshUiPanelSubscriptions === 'function' &&
      typeof desiredUiPanelSubscriptions === 'function') {
      refreshUiPanelSubscriptions();
      var bootPanels = desiredUiPanelSubscriptions();
      Object.keys(bootPanels).forEach(function (key) {
        UI.dirty[key] = true;
        requestPanelData(key, false);
      });
    }
  });
  WorkerBridge.on(MSG_OUT.FULL, function (msg) {
    applyUiSnapshot(msg.snapshot);
  });
  WorkerBridge.on(MSG_OUT.TICK, function (msg) {
    if (msg.view) UI_WORKER_STATE.view = msg.view;
    uiSyncGameTime(msg.view); // 對時：讓畫面上的倒數與狀態到期判定有正確基準
    handleWorkerUiEvents(msg.events);
    if (UI_WORKER_STATE.viewSubscribed) {
      UI.dirty.header = true;
      UI.dirty.battle = true;
    }

    if (UI.tab === 'tower' && msg.view && msg.view.towerActive) {
      requestPanelData('tower', true);
    }

    var dirty = msg.dirty || [];
    for (var i = 0; i < dirty.length; i++) {
      var key = dirty[i];
      if (!validUiPanelKey(key) ||
        !UI_WORKER_STATE.panelSubscriptions[key]) {
        continue;
      }
      /* 背包的被動請求節流，見 inventoryPassiveRequestAllowed。
         擋下時連 dirty 都不標記：沒有新資料，標了只會讓 uiTick 拿舊快照白重畫一次。 */
      if (key === 'inv' && !inventoryPassiveRequestAllowed()) {
        _invReqPending = true;
        continue;
      }
      UI.dirty[key] = true;
      if (key === 'inv') noteInventoryPanelRequested();
      requestPanelData(key, true);
    }
  });
  WorkerBridge.on(MSG_OUT.PANEL, function (msg) {
    if (!validUiPanelKey(msg.name)) return;
    var previousPanel = UI_WORKER_STATE.panels[msg.name];
    var inventoryGridUnchanged = msg.name === 'inv' &&
      inventoryGridSnapshotEqual(previousPanel, msg.data);
    var responseSeq = UI_WORKER_STATE.panelRequests[msg.name] ||
      UI_WORKER_STATE.panelResponseSeq[msg.name] || 0;
    if (msg.name === 'skills' &&
      UI.optimisticSkillLoadout &&
      UI.optimisticSkillLoadout.acknowledged) {
      UI.optimisticSkillLoadout = null;
    }
    UI_WORKER_STATE.panels[msg.name] = msg.data;
    UI_WORKER_STATE.panelVersions[msg.name] =
      (UI_WORKER_STATE.panelVersions[msg.name] || 0) + 1;
    UI_WORKER_STATE.panelResponseSeq[msg.name] = responseSeq;
    delete UI_WORKER_STATE.panelRequests[msg.name];
    UI.dirty[msg.name] = true;
    // detailIds responses contain the same inventory cell summaries but add
    // one full item in `details`.  Rebuilding the whole grid here replaces
    // the cell under the mouse, which emits mouseout/mouseover again and can
    // start an endless tooltip request/repaint loop.
    if (inventoryGridUnchanged && UI.tab === 'equip') {
      UI.dirty.inv = false;
      // A hover-only detail response must not refresh selection classes.  The
      // selected pane needs a refresh only when its own full item arrived.
      if (UI.sel && UI.sel.source === 'inv' && UI.sel.id &&
        msg.data && msg.data.details && msg.data.details[UI.sel.id]) {
        if (UI.inventoryScrolling) UI.inventoryDetailRefreshPending = true;
        else renderDetail();
      }
    }
    /* 指令造成格線內容、數量或容量變更時，不能等下一輪 dirty tick 才
       重建背包；否則舊 item-cell 會暫留，且 pending 控制可能被重繪覆蓋。 */
    if (msg.name === 'inv' && UI.tab === 'equip' && !inventoryGridUnchanged) {
      renderInventory();
      UI.dirty.inv = false;
    } else if (msg.name === 'equip' && UI.tab === 'equip') {
      renderEquip();
      UI.dirty.equip = false;
    }
    releaseUiPendingByPanel(msg.name);
    if (UI_WORKER_STATE.panelQueued[msg.name]) {
      var queuedParams = UI_WORKER_STATE.panelQueued[msg.name];
      delete UI_WORKER_STATE.panelQueued[msg.name];
      requestPanelData(msg.name, true, queuedParams);
    }
    if (msg.name === 'talents') updateTalentTabVisibility();
    if (msg.name === 'inv' && UI.pendingItemTooltip) {
      var pendingTooltip = UI.pendingItemTooltip;
      var pendingTooltipItem = findItemById(pendingTooltip.id, true);
      var stillHoveringPending = UI.hoveredItemTooltip &&
        UI.hoveredItemTooltip.id === pendingTooltip.id &&
        UI.hoveredItemTooltip.anchor === pendingTooltip.anchor;
      if (pendingTooltipItem && pendingTooltip.anchor && stillHoveringPending &&
        document.documentElement.contains(pendingTooltip.anchor)) {
        showItemTooltip(pendingTooltipItem, pendingTooltip.anchor);
      }
      UI.pendingItemTooltip = null;
    }
    if (msg.name === 'tower' || msg.name === 'header') showPendingTowerResultModalIfReady();
    if (msg.name === 'battle' && UI.statsPanelOpen) renderStatsPanel();
    if (msg.name === 'task' && UI.questPanelOpen) renderQuestModal();
    if (msg.name === 'newforge') {
      updateForgeTabGlow();
      showForgeRebuildNotice();
      markNewForgeTabSeenIfNeeded();
    }
    if (msg.name === 'factory') syncFactoryInputs();
  });
  WorkerBridge.on('workerDead', handleWorkerDead);
  WorkerBridge.on('workerRestarting', handleWorkerRestarting);
  WorkerBridge.on('workerRestarted', handleWorkerRestarted);
  WorkerBridge.on('workerRecovered', hideWorkerDeadNotice);
  updateWorkerSafeModeMarker();
  refreshUiPanelSubscriptions();
  // newforge carries the one-time rebuild notice and tab badge.  Fetch it once
  // without keeping the large queue projection subscribed while another tab is open.
  requestPanelData('newforge', false);
  requestPanelData('forge', false);
  return true;
}

var STAGE_HOLD_START_MS = 300;
var STAGE_HOLD_REPEAT_MS = 50;
var INVENTORY_VISIBLE_ROWS_DEFAULT = 6;
var INVENTORY_VISIBLE_ROWS_MAX = 9;
var INVENTORY_GRID_ROW_HEIGHT = 58;
var INVENTORY_GRID_ROW_GAP = 6;

/* ---- 日誌 ---- */
var DETAIL_LOG_HISTORY = [];
var DETAIL_LOG_CAP = 500;
var NEWFORGE_LOG_HISTORY = [];
var PENDING_LOG_DOM = {};
var DETAIL_LOG_RENDER_DIRTY = false;
var NEWFORGE_DETAIL_LOG_RENDER_DIRTY = false;
window.newForgeLogPaused = false;

function detailLogCategoryLabel(cat) {
  return ({ combat: '戰鬥', boss: '高塔', factory: '裝備', loot: '掉落', system: '系統' })[cat] || '其他';
}

function renderDetailLog() {
  var box = $id('detail-log-content');
  if (!box) return;
  var filterEl = $id('detail-log-filter');
  var filter = filterEl ? filterEl.value : 'all';
  var rows = DETAIL_LOG_HISTORY.filter(function (entry) {
    if (filter === 'all') return entry.cat !== 'factory';
    return entry.cat === filter;
  });
  if (!rows.length) {
    box.innerHTML = '<div class="detail-log-empty">目前沒有符合條件的日誌</div>';
    return;
  }
  box.innerHTML = rows.map(function (entry) {
    var label = entry.cat ? '[' + detailLogCategoryLabel(entry.cat) + '] ' : '';
    return '<div class="detail-log-line ' + (entry.cls || '') + '">' +
      '<span class="detail-log-time">' + esc(entry.time) + '</span>' +
      '<span class="detail-log-category">' + esc(label) + '</span>' + entry.msg + '</div>';
  }).join('');
}

/* ---- 熔爐日誌統計狀態與函式 ---- */
var newForgeLogStartTime = null;
var newForgeLogStatsInterval = null;
var newForgeCumulativeStats = {
  logCount: 0,
  scrap: 0,
  essence: 0,
  magicScroll: 0,
  ancientEssence: 0,
  books: {},
  parts: {}
};

function accumulateNewForgeLog(msg) {
  newForgeCumulativeStats.logCount++;

  var scrapMatch = msg.match(/碎片x(\d+)/);
  if (scrapMatch) newForgeCumulativeStats.scrap += parseInt(scrapMatch[1], 10);

  var essenceMatch = msg.match(/附魔精華x(\d+)/);
  if (essenceMatch) newForgeCumulativeStats.essence += parseInt(essenceMatch[1], 10);

  var scrollMatch = msg.match(/卷軸x(\d+)/);
  if (scrollMatch) newForgeCumulativeStats.magicScroll += parseInt(scrollMatch[1], 10);

  var ancientMatch = msg.match(/太古精華x(\d+)/);
  if (ancientMatch) newForgeCumulativeStats.ancientEssence += parseInt(ancientMatch[1], 10);

  var bookRegex = /📖([^（）x、，\s\>]+)/g;
  var bookMatch;
  while ((bookMatch = bookRegex.exec(msg)) !== null) {
    var bookName = bookMatch[1];
    newForgeCumulativeStats.books[bookName] = (newForgeCumulativeStats.books[bookName] || 0) + 1;
  }

  var partRegex = /⛏️([^（）x、，\>]+)/g;
  var partMatch;
  while ((partMatch = partRegex.exec(msg)) !== null) {
    var partName = partMatch[1].trim();
    var foundKey = null;
    var nameKeys = Object.keys(PART_TYPES);
    for (var j = 0; j < nameKeys.length; j++) {
      var k = nameKeys[j];
      if (partName.indexOf(PART_TYPES[k].name) === 0) {
        foundKey = k;
        break;
      }
    }
    newForgeCumulativeStats.parts[partName] = {
      count: ((newForgeCumulativeStats.parts[partName] && newForgeCumulativeStats.parts[partName].count) || 0) + 1,
      key: foundKey
    };
  }
}

function resetNewForgeCumulativeStats() {
  newForgeCumulativeStats = {
    logCount: 0,
    scrap: 0,
    essence: 0,
    magicScroll: 0,
    ancientEssence: 0,
    books: {},
    parts: {}
  };
}

function getNewForgeLogStats() {
  var stats = {
    duration: 0,
    mats: {
      scrap: newForgeCumulativeStats.scrap,
      essence: newForgeCumulativeStats.essence,
      magicScroll: newForgeCumulativeStats.magicScroll,
      ancientEssence: newForgeCumulativeStats.ancientEssence,
      books: newForgeCumulativeStats.books,
      parts: newForgeCumulativeStats.parts
    }
  };

  if (newForgeLogStartTime && newForgeCumulativeStats.logCount > 0) {
    stats.duration = Math.floor((Date.now() - newForgeLogStartTime) / 1000);
  }
  return stats;
}

function getInstalledPartsStats() {
  var counts = {};
  var snapshot = uiNewForgePanelSnapshot();
  var nf = snapshot && snapshot.newForge;
  if (nf && nf.furnaces) {
    for (var i = 0; i < nf.furnaces.length; i++) {
      var fu = nf.furnaces[i];
      if (fu && fu.parts) {
        for (var j = 0; j < fu.parts.length; j++) {
          var p = fu.parts[j];
          if (p && p.key) {
            counts[p.key] = (counts[p.key] || 0) + 1;
          }
        }
      }
    }
  }
  return counts;
}

function formatDuration(sec) {
  if (sec <= 0) return '0 秒';
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  var str = '';
  if (h > 0) str += h + ' 小時 ';
  if (m > 0 || h > 0) str += m + ' 分 ';
  str += s + ' 秒';
  return str;
}

function renderNewForgeLogStats() {
  var container = $id('newforge-detail-log-stats');
  if (!container) return;

  var stats = getNewForgeLogStats();
  var partCounts = getInstalledPartsStats();

  var html = '';

  // 1. 統計時長
  html += '<div class="stats-sec">';
  html += '  <div class="stats-sec-title">⏳ 統計資訊</div>';
  html += '  <div class="stats-row">';
  html += '    <span>統計時長</span>';
  html += '    <span class="stats-value">' + formatDuration(stats.duration) + '</span>';
  html += '  </div>';
  html += '  <div class="stats-row">';
  html += '    <span>累計日誌筆數</span>';
  html += '    <span class="stats-value">' + newForgeCumulativeStats.logCount + ' 筆</span>';
  html += '  </div>';
  html += '</div>';

  // 2. 當前所有熔爐零件類型裝置數量
  html += '<div class="stats-sec">';
  html += '  <div class="stats-sec-title">🔧 熔爐零件配置 (所有總值)</div>';
  var partKeys = Object.keys(PART_TYPES).filter(function (k) { return PART_TYPES[k].node === 'salvage'; });
  var hasParts = false;
  for (var i = 0; i < partKeys.length; i++) {
    var k = partKeys[i];
    var pt = PART_TYPES[k];
    var count = partCounts[k] || 0;
    if (count > 0) {
      hasParts = true;
      html += '  <div class="stats-row">';
      html += '    <span style="display:flex; align-items:center; gap:4px;">' + partIconHTML(k) + esc(pt.name) + '</span>';
      html += '    <span class="stats-value">x ' + count + '</span>';
      html += '  </div>';
    }
  }
  if (!hasParts) {
    html += '  <div class="hint" style="text-align:center; padding: 8px 0; color: var(--dim)">當前所有熔爐均未安裝零件</div>';
  }
  html += '</div>';

  // 3. 各材料獲得數量
  html += '<div class="stats-sec">';
  html += '  <div class="stats-sec-title">📦 材料獲得統計</div>';
  html += '  <div class="stats-mats-grid">';

  html += '    <div class="stats-mat-card">';
  html += '      <span class="stats-mat-name"><img src="images/icon_scrap.png" class="res-icon" alt="">裝備碎片</span>';
  html += '      <span class="stats-mat-val">' + fmt(stats.mats.scrap) + '</span>';
  html += '    </div>';

  html += '    <div class="stats-mat-card">';
  html += '      <span class="stats-mat-name"><img src="images/icon_essence.png" class="res-icon" alt="">附魔精華</span>';
  html += '      <span class="stats-mat-val">' + fmt(stats.mats.essence) + '</span>';
  html += '    </div>';

  html += '    <div class="stats-mat-card">';
  html += '      <span class="stats-mat-name">📜 魔法卷軸</span>';
  html += '      <span class="stats-mat-val">' + fmt(stats.mats.magicScroll || 0) + '</span>';
  html += '    </div>';

  html += '    <div class="stats-mat-card">';
  html += '      <span class="stats-mat-name"><img src="images/icon_ancient_essence.png" class="res-icon" alt="">太古精華</span>';
  html += '      <span class="stats-mat-val">' + fmt(stats.mats.ancientEssence) + '</span>';
  html += '    </div>';

  html += '  </div>';

  var bookNames = Object.keys(stats.mats.books);
  var partNames = Object.keys(stats.mats.parts);

  if (bookNames.length > 0 || partNames.length > 0) {
    html += '  <div class="stats-sec-title" style="margin-top: 12px; font-size: 12px;">✨ 額外回收項目</div>';

    for (var b = 0; b < bookNames.length; b++) {
      var bn = bookNames[b];
      html += '  <div class="stats-row">';
      html += '    <span style="display:flex; align-items:center; gap:4px;"><img src="images/icon_books.png" class="res-icon" alt="" style="margin-right:2px; width:18px; height:18px;">附魔書：' + esc(bn) + '</span>';
      html += '    <span class="stats-value">x ' + stats.mats.books[bn] + '</span>';
      html += '  </div>';
    }

    for (var p = 0; p < partNames.length; p++) {
      var pn = partNames[p];
      var partData = stats.mats.parts[pn];
      var iconHtml = partData.key ? partIconHTML(partData.key) : '';
      html += '  <div class="stats-row">';
      html += '    <span style="display:flex; align-items:center; gap:4px;">' + iconHtml + '零件：' + esc(pn) + '</span>';
      html += '    <span class="stats-value">x ' + partData.count + '</span>';
      html += '  </div>';
    }
  }

  html += '</div>';

  container.innerHTML = html;
}

function renderNewForgeDetailLog() {
  var box = $id('newforge-detail-log-content');
  if (!box) return;
  var rows = NEWFORGE_LOG_HISTORY;
  if (!rows.length) {
    box.innerHTML = '<div class="detail-log-empty">目前沒有熔爐日誌</div>';
  } else {
    box.innerHTML = rows.map(function (entry) {
      return '<div class="detail-log-line ' + (entry.cls || '') + '">' +
        '<span class="detail-log-time">' + esc(entry.time) + '</span>' + entry.msg + '</div>';
    }).join('');
  }
  renderNewForgeLogStats();
}

function refreshNewForgeMainLog() {
  var box = $id('newforge-log');
  if (!box) return;
  clearPendingLogDom('newforge-log');
  box.innerHTML = '';
  var displayLogs = NEWFORGE_LOG_HISTORY.slice(0, 50);
  displayLogs.forEach(function (entry) {
    var div = document.createElement('div');
    div.className = 'log-line ' + (entry.cls || '');
    div.innerHTML = entry.msg;
    box.appendChild(div);
  });
}

function enqueueLogDom(elId, msg, cls, cat, cap) {
  var queue = PENDING_LOG_DOM[elId] || (PENDING_LOG_DOM[elId] = []);
  var limit = cap || 150;
  queue.push({ msg: msg, cls: cls || '', cat: cat || '', cap: limit });
  if (queue.length > limit) queue.splice(0, queue.length - limit);
}

function clearPendingLogDom(elId) {
  var queue = PENDING_LOG_DOM[elId];
  if (queue) queue.length = 0;
}

function setTextIfChanged(el, value) {
  if (!el) return;
  value = String(value);
  if (el.textContent !== value) el.textContent = value;
}

function setHtmlIfChanged(el, value) {
  if (!el) return;
  value = String(value);
  if (el.innerHTML !== value) el.innerHTML = value;
}

function setStyleIfChanged(el, prop, value) {
  if (!el || !el.style) return;
  value = String(value);
  if (el.style[prop] !== value) el.style[prop] = value;
}

function setCheckedIfChanged(el, value) {
  if (!el) return;
  value = !!value;
  if (el.checked !== value) el.checked = value;
}

function flushPendingLogDom() {
  Object.keys(PENDING_LOG_DOM).forEach(function (elId) {
    var queue = PENDING_LOG_DOM[elId];
    if (!queue || !queue.length) return;
    var box = $id(elId);
    if (!box) return;
    var fragment = document.createDocumentFragment();
    for (var i = queue.length - 1; i >= 0; i--) {
      var entry = queue[i];
      var div = document.createElement('div');
      div.className = 'log-line ' + entry.cls;
      if (entry.cat) div.setAttribute('data-cat', entry.cat);
      div.innerHTML = entry.msg;
      fragment.appendChild(div);
    }
    box.insertBefore(fragment, box.firstChild);
    var cap = queue[queue.length - 1].cap || 150;
    while (box.children.length > cap) box.removeChild(box.lastChild);
    queue.length = 0;
  });
}

function flushDirtyDetailLogs() {
  if (DETAIL_LOG_RENDER_DIRTY) {
    var detailModal = $id('detail-log-modal');
    if (detailModal && detailModal.style && detailModal.style.display !== 'none') renderDetailLog();
    DETAIL_LOG_RENDER_DIRTY = false;
  }
  if (NEWFORGE_DETAIL_LOG_RENDER_DIRTY) {
    var nfDetailModal = $id('newforge-detail-log-modal');
    if (nfDetailModal && nfDetailModal.style && nfDetailModal.style.display !== 'none') renderNewForgeDetailLog();
    NEWFORGE_DETAIL_LOG_RENDER_DIRTY = false;
  }
}

function addLog(elId, msg, cls, cap, cat) {
  // 戰鬥與高塔 BOSS 共用同一個日誌視窗；保留舊事件 box 名稱的相容轉送。
  if (elId === 'boss-log') elId = 'battle-log';
  if (elId === 'newforge-log') {
    var now = new Date();
    if (!newForgeLogStartTime) {
      newForgeLogStartTime = Date.now();
    }
    accumulateNewForgeLog(msg);
    NEWFORGE_LOG_HISTORY.unshift({
      msg: msg,
      cls: cls || '',
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });
    if (NEWFORGE_LOG_HISTORY.length > 250) NEWFORGE_LOG_HISTORY.pop();
    if (window.newForgeLogPaused) return;
  }

  var box = $id(elId);
  if (!box) return;
  enqueueLogDom(elId, msg, cls, cat, cap);
  if (elId === 'battle-log') {
    var now = new Date();
    DETAIL_LOG_HISTORY.unshift({
      msg: msg,
      cls: cls || '',
      cat: cat || 'system',
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });
    if (DETAIL_LOG_HISTORY.length > DETAIL_LOG_CAP) DETAIL_LOG_HISTORY.pop();
    DETAIL_LOG_RENDER_DIRTY = true;
  } else if (elId === 'newforge-log') {
    NEWFORGE_DETAIL_LOG_RENDER_DIRTY = true;
  }
}
function classifyUiLogCategory(msg, cat) {
  msg = String(msg || '');
  if (!cat) {
    if (msg.includes('高塔') || msg.includes('狂暴') || msg.includes('重擊') || msg.includes('撤出')) cat = 'boss';
    else if (msg.includes('📦 戰利品：') || msg.includes('敵人掉落')) cat = 'loot';
    else if (msg.includes('強化') || msg.includes('換裝') || msg.includes('資源不足') || msg.includes('背包已滿') || msg.includes('暫存區已滿')) cat = 'factory';
    else if (msg.includes('推進') || msg.includes('退回') || msg.includes('復活') || msg.includes('擊倒') || msg.includes('遭遇')) cat = 'combat';
    else cat = 'system';
  }
  return cat;
}

function workerTowerActiveForLog() {
  var view = UI_WORKER_STATE.view;
  if (view && typeof view.towerActive === 'boolean') return view.towerActive;
  var towerPanel = peekUiPanelData('tower');
  return !!(towerPanel && towerPanel.tower && towerPanel.tower.active);
}

function routeUiLog(msg, cls, cat, towerActive) {
  cat = classifyUiLogCategory(msg, cat);
  if (towerActive && (cat === 'combat' || cat === 'loot')) cat = 'boss';
  addLog('battle-log', msg, cls, 150, cat);
}

function blog(msg, cls, cat) {
  routeUiLog(msg, cls, cat, workerTowerActiveForLog());
}

// 舊生產線頁已併入熔爐頁：flog 統一寫入熔爐紀錄（與 nflog 同一面板）
function flog(msg, cls) { addLog('newforge-log', msg, cls, 50); }

/* ---- 漂浮傷害字 ----
   位置先隨機落點，再依實際文字寬度夾取在戰鬥面板（.combatant）可視範圍內：
   多人戰鬥的小卡片允許數字跨出頭像範圍，但不會超出面板 overflow 邊界被裁切。 */
function isEnemyHitFloat(elId, cls) {
  var isEnemyLayer = elId === 'tb-float' || (elId && elId.indexOf('mv-float') === 0);
  var tokens = (cls || '').split(/\s+/);
  return isEnemyLayer && (tokens.indexOf('dmg') >= 0 || tokens.indexOf('mdmg') >= 0 ||
    tokens.indexOf('crit') >= 0 || tokens.indexOf('skill') >= 0);
}

var FLOAT_TEXT_LIFETIME_MS = 2000;
var ENEMY_DAMAGE_FLOAT_WINDOW_MS = 4000;
var ENEMY_DAMAGE_FLOAT_MAX_HITS = 20;
var PLAYER_RECOVERY_FLOAT_MAX_HITS = 20;
var PENDING_ENEMY_FLOATS = [];
var BACKGROUND_LATEST_ENEMY_FLOAT = null;
var INSTANT_KILL_HP_ANIMATION_MS = 100;
/* 傷害數字使用初始隨機位置即可；碰撞避讓會同步讀取整層 DOM，戰鬥高峰
   會把點擊事件卡在 layout。保留函式供非傷害浮字與除錯使用，但正式熱路徑關閉。 */
var ENEMY_FLOAT_LAYOUT_ENABLED = false;
/* 碰撞避讓會為每個候選位置讀取一次 layout；戰鬥高峰時這個成本比建立
   一個浮字本身高很多。超過門檻後保留隨機位置，但不再為了排版量測整層 DOM。 */
var ENEMY_FLOAT_LAYOUT_LOAD_LIMIT = 24;

function rememberBackgroundEnemyFloat(elId, text, cls, damageValue) {
  if (!isEnemyHitFloat(elId, cls)) return;
  BACKGROUND_LATEST_ENEMY_FLOAT = {
    elId: elId, text: text, cls: cls, damageValue: damageValue
  };
}

function clearBackgroundEnemyFloats() {
  var floats = document.querySelectorAll ? document.querySelectorAll('.enemy-hit-float') : [];
  for (var i = 0; i < floats.length; i++) {
    if (floats[i].parentNode) floats[i].parentNode.removeChild(floats[i]);
  }
  // 背景期間不保留「等圖層建立」的歷史傷害，切回只顯示最新一筆。
  PENDING_ENEMY_FLOATS.length = 0;
}

function showBackgroundLatestEnemyFloat() {
  var item = BACKGROUND_LATEST_ENEMY_FLOAT;
  BACKGROUND_LATEST_ENEMY_FLOAT = null;
  if (!item) return;
  floatText(item.elId, item.text, item.cls, item.damageValue, null,
    typeof uiBattlePanelSnapshot === 'function' ? uiBattlePanelSnapshot() : undefined, 0);
}

function queuePendingEnemyFloat(elId, text, cls, damageValue, ent) {
  if (!elId || elId.indexOf('mv-float-') !== 0) return false;
  PENDING_ENEMY_FLOATS.push({ elId: elId, text: text, cls: cls, damageValue: damageValue, ent: ent || null });
  return true;
}

function animatePendingEnemyKill(ent, elId, cls, battleSnapshot) {
  var cardOverride = arguments[4];
  var target = ent;
  // Worker float events intentionally omit entity references; recover the
  // dead target from the latest battle snapshot before playing the bar tween.
  if (!target && battleSnapshot && battleSnapshot.field) {
    var field = battleSnapshot.field;
    var enemies = Array.isArray(field.monsters) ? field.monsters : (field.monster ? [field.monster] : []);
    var match = /^mv-float-(\d+)$/.exec(String(elId || ''));
    var index = match ? parseInt(match[1], 10) : -1;
    if (index >= 0 && enemies[index]) target = enemies[index];
  }
  if (!target || target.hp > 0 || !isEnemyHitFloat(elId, cls)) return;
  var layer = $id(elId);
  var card = cardOverride || (layer && layer.closest ? layer.closest('.enemy-card') : null);
  var fill = card && card.querySelector ? card.querySelector('.enemy-hp .hp-fill') : null;
  if (!fill || fill._pendingInstantKillPlayed) return;
  var now = Date.now();
  if (fill._instantKillAnimationAt && now - fill._instantKillAnimationAt < INSTANT_KILL_HP_ANIMATION_MS + 200) return;
  fill._instantKillAnimationAt = now;
  fill._pendingInstantKillPlayed = true;
  fill.style.transition = 'none';
  fill.style.width = '100%';
  void fill.offsetWidth;
  fill.style.transition = 'width ' + INSTANT_KILL_HP_ANIMATION_MS + 'ms linear';
  fill.style.width = '0%';
  setTimeout(function () {
    if (!fill) return;
    fill.style.transition = '';
    fill._pendingInstantKillPlayed = false;
  }, INSTANT_KILL_HP_ANIMATION_MS + 50);
}

function hasRecentEnemyDamageFloat(elId, floats, now) {
  if (!elId || typeof document === 'undefined' || !document.querySelectorAll) return false;
  floats = floats || document.querySelectorAll('.enemy-hit-float');
  now = now || Date.now();
  for (var i = 0; i < floats.length; i++) {
    var item = floats[i];
    if (item._enemyFloatTargetId !== elId) continue;
    if (!item._enemyFloatCreatedAt || now - item._enemyFloatCreatedAt <= 500) return true;
  }
  return false;
}

function flushPendingEnemyFloats(battleSnapshot) {
  if (!PENDING_ENEMY_FLOATS.length) return;
  var keep = [];
  for (var i = 0; i < PENDING_ENEMY_FLOATS.length; i++) {
    var item = PENDING_ENEMY_FLOATS[i];
    var layer = $id(item.elId);
    if (!layer || layer.offsetParent === null) {
      keep.push(item);
      continue;
    }
    animatePendingEnemyKill(item.ent, item.elId, item.cls, battleSnapshot);
    floatText(item.elId, item.text, item.cls, item.damageValue, item.ent, battleSnapshot);
  }
  PENDING_ENEMY_FLOATS = keep;
}

/* 低負載時保留每段傷害，方便觀察多段受擊；當同一層浮字累積到壓力門檻，
   自動啟用小幅合併，避免每個命中都觸發一次 DOM 掃描與碰撞排版。這是純
   視覺降載，Worker 仍然送出完整事件，戰鬥數值與時序不變。 */
var ENEMY_DAMAGE_FLOAT_MERGE_ENABLED = false;
var ENEMY_DAMAGE_FLOAT_AUTO_MERGE_THRESHOLD = 12;
var ENEMY_DAMAGE_FLOAT_AUTO_MERGE_LIMIT = 4;

function enemyDamageFloatMergeLimit(battleSnapshot) {
  if (!ENEMY_DAMAGE_FLOAT_MERGE_ENABLED) return 0; // 0 = 不合併，每段各自飄字
  var st = battleSnapshot && battleSnapshot.stats;
  var comboHits = st ? Number(st.comboHits) : 0;
  var aspd = st ? Number(st.aspd) : 0;
  if (!isFinite(comboHits) || !isFinite(aspd) || comboHits <= 0 || aspd <= 0) return 0;
  return Math.min(ENEMY_DAMAGE_FLOAT_MAX_HITS, Math.floor(comboHits * aspd * 2));
}

function enemyDamageFloatActiveCount(layer) {
  if (!layer || typeof layer.querySelectorAll !== 'function') return 0;
  return layer.querySelectorAll('.float-txt.enemy-hit-float').length;
}

function enemyDamageFloatMergeLimitForLayer(battleSnapshot, layer) {
  var configuredLimit = enemyDamageFloatMergeLimit(battleSnapshot);
  if (configuredLimit > 0) return configuredLimit;
  if (!ENEMY_DAMAGE_FLOAT_MERGE_ENABLED &&
      enemyDamageFloatActiveCount(layer) >= ENEMY_DAMAGE_FLOAT_AUTO_MERGE_THRESHOLD) {
    return ENEMY_DAMAGE_FLOAT_AUTO_MERGE_LIMIT;
  }
  return 0;
}

function enemyDamageFloatKey(cls) {
  var tokens = (cls || '').split(/\s+/);
  var source = tokens.indexOf('enemy-skill') >= 0 ? 'skill' :
    (tokens.indexOf('enemy-attack') >= 0 ? 'attack' : '');
  if (!source) return '';
  return source + ':' + (tokens.indexOf('crit') >= 0 ? 'crit' : 'normal');
}

/*
 * 將敵人傷害轉成唯一的視覺分類。
 * dmg／crit／enemy-attack／enemy-skill 仍保留給傷害合併邏輯判斷，
 * 但 CSS 只讀這四個分類，避免來源與暴擊規則彼此覆蓋。
 */
function enemyDamageFloatStyleClass(cls) {
  var tokens = (cls || '').split(/\s+/);
  var isCrit = tokens.indexOf('crit') >= 0;
  var isHighCrit = isCrit && tokens.indexOf('crit-high-roll') >= 0;
  if (tokens.indexOf('enemy-attack') >= 0) {
    return (isCrit ? 'enemy-hit-attack-crit' : 'enemy-hit-attack') + (isHighCrit ? ' enemy-hit-crit-high' : '');
  }
  if (tokens.indexOf('enemy-skill') >= 0) {
    return (isCrit ? 'enemy-hit-skill-crit' : 'enemy-hit-skill') + (isHighCrit ? ' enemy-hit-crit-high' : '');
  }
  return '';
}

/* 從 CSS 讀取各分類的消失時間，讓淡出動畫與 DOM 移除使用同一個設定。 */
function enemyDamageFloatLifetimeMs(sp) {
  var fallback = FLOAT_TEXT_LIFETIME_MS;
  if (!sp || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return fallback;
  var raw = window.getComputedStyle(sp).getPropertyValue('--enemy-hit-lifetime').trim();
  if (!raw) return fallback;
  /* getComputedStyle 可能回傳 calc(2s * 2)，先解析簡單的時間×倍數，避免高倍率暴擊被提早移除。 */
  var calcMatch = raw.match(/^calc\(\s*([0-9]+(?:\.[0-9]+)?)\s*(ms|s)\s*\*\s*([0-9]+(?:\.[0-9]+)?)\s*\)$/i);
  if (calcMatch) {
    var baseValue = Number(calcMatch[1]);
    var multiplier = Number(calcMatch[3]);
    if (isFinite(baseValue) && isFinite(multiplier) && baseValue > 0 && multiplier > 0) {
      return (calcMatch[2].toLowerCase() === 'ms' ? baseValue : baseValue * 1000) * multiplier;
    }
  }
  var value = parseFloat(raw);
  if (!isFinite(value) || value <= 0) return fallback;
  return /ms$/i.test(raw) ? value : value * 1000;
}

function enemyDamageFloatInfo(text, value) {
  if (typeof value !== 'number' || !isFinite(value) || value <= 0 || typeof fmt !== 'function') return null;
  var formatted = fmt(value);
  var numberAt = text.lastIndexOf(formatted);
  if (numberAt < 0) return null;
  return { prefix: text.slice(0, numberAt) };
}

function playerRecoveryFloatKey(elId, cls) {
  if (elId !== 'pv-float' && elId !== 'tp-float') return '';
  var tokens = (cls || '').split(/\s+/);
  if (tokens.indexOf('heal') >= 0) return 'hp';
  if (tokens.indexOf('mp') >= 0 || tokens.indexOf('mana') >= 0) return 'mp';
  return '';
}

function playerRecoveryFloatInfo(elId, cls, text, value) {
  var key = playerRecoveryFloatKey(elId, cls);
  if (!key || typeof value !== 'number' || !isFinite(value) || value <= 0 || typeof fmt !== 'function') return null;
  var formatted = fmt(value);
  var numberAt = text.lastIndexOf(formatted);
  if (numberAt < 0) return null;
  return { key: key, prefix: text.slice(0, numberAt) };
}

function scheduleFloatTextRemoval(sp, lifetimeMs) {
  if (sp._floatRemovalTimer) clearTimeout(sp._floatRemovalTimer);
  sp._floatRemovalTimer = setTimeout(function () {
    if (sp.parentNode) sp.parentNode.removeChild(sp);
  }, lifetimeMs || FLOAT_TEXT_LIFETIME_MS);
}

function clearFloatLayer(elId) {
  var layer = $id(elId);
  if (!layer) return;
  // 戰鬥切換、暫停或進入高塔時也不刪除正在播放的浮字；所有浮字都由
  // scheduleFloatTextRemoval 的自然淡出計時器清理，避免狀態切換造成瞬間消失。
  layer.removeAttribute('data-last-miss-at');
}

function clearTowerFloatLayers() {
  clearFloatLayer('tp-float');
  clearFloatLayer('tb-float');
}

/* 敵方傷害浮字優先找不與現有文字重疊的位置，真的沒有空間時才接受重疊。 */
function placeFloatAvoidingOverlap(sp, layer, selector, randomTop, randomRange, gridRows, gridStep, anchorLayer) {
  var lr = layer.getBoundingClientRect();
  if (!lr.width || !lr.height) return;

  var existingRects = [];
  var existingFloats = layer.querySelectorAll(selector);
  // 大量敵人同一 tick 同時命中時，逐個做 48 個候選點 × 全部既有文字的
  // layout 量測會阻塞主執行緒，讓 CSS 動畫在首次繪製前就跑完。高負載時
  // 仍建立每一個數字，只略過碰撞避讓，讓它們以隨機位置自然淡出。
  var combatant = layer.closest ? layer.closest('.enemy-combatant') : null;
  var totalEnemyFloats = combatant ? combatant.querySelectorAll('.enemy-hit-float').length : existingFloats.length;
  if (selector.indexOf('enemy-hit-float') >= 0 && totalEnemyFloats > ENEMY_FLOAT_LAYOUT_LOAD_LIMIT) return;
  for (var ei = 0; ei < existingFloats.length; ei++) {
    var existing = existingFloats[ei];
    if (existing === sp) continue;
    var opacity = parseFloat(window.getComputedStyle(existing).opacity);
    if (isFinite(opacity) && opacity <= 0.05) continue;
    var existingRect = existing.getBoundingClientRect();
    if (existingRect.width && existingRect.height) existingRects.push(existingRect);
  }

  var oldAnimation = sp.style.animation;
  var oldTransform = sp.style.transform;
  sp.style.animation = 'none';
  // enemyDamageFloatUp uses translate(-50%, ...). Include the horizontal
  // centering transform while measuring, otherwise long numbers are placed
  // half a text width too far to the right.
  sp.style.transform = 'translate(-50%, 0)';
  var anchorRect = anchorLayer && anchorLayer.getBoundingClientRect ? anchorLayer.getBoundingClientRect() : null;
  var anchor = anchorRect && anchorRect.width && anchorRect.height ? {
    left: ((anchorRect.left - lr.left) / lr.width) * 100,
    top: ((anchorRect.top - lr.top) / lr.height) * 100,
    width: (anchorRect.width / lr.width) * 100,
    height: (anchorRect.height / lr.height) * 100
  } : null;
  var initialLeft = anchor ? anchor.left + anchor.width * (0.2 + Math.random() * 0.6) : 8 + Math.random() * 84;
  var initialTop = anchor ? anchor.top + anchor.height * (0.2 + Math.random() * 0.6) : randomTop + Math.random() * randomRange;
  var candidates = [{
    left: Math.max(4, Math.min(96, initialLeft)),
    top: Math.max(8, Math.min(92, initialTop))
  }];
  gridRows = gridRows || 6;
  gridStep = gridStep || 10;
  if (anchor && anchorRect) {
    /* Damage numbers belong to a specific enemy slot.  The retained layer is
       shared by all enemies, so unrestricted overlap avoidance could choose a
       visually empty slot hundreds of pixels away from the actual target.
       Generate every fallback around the target center and let overlap
       avoidance pick the least crowded nearby position. */
    var anchorCenterLeft = (anchorRect.left + anchorRect.width * 0.5 - lr.left) / lr.width * 100;
    var anchorCenterTop = (anchorRect.top + anchorRect.height * 0.5 - lr.top) / lr.height * 100;
    var maxAnchorOffsetX = Math.max(24, anchorRect.width * 0.8) / lr.width * 100;
    var maxAnchorOffsetY = Math.max(20, anchorRect.height * 0.75) / lr.height * 100;
    var nearbyOffsets = [
      [0, 0], [-1, 0], [1, 0], [0, -1], [0, 1],
      [-2, 0], [2, 0], [-1, -1], [1, -1], [-1, 1], [1, 1],
      [-2, -1], [2, -1], [-2, 1], [2, 1], [0, -2], [0, 2],
      [-3, 0], [3, 0], [-2, -2], [2, -2], [-2, 2], [2, 2]
    ];
    for (var ni = 0; ni < nearbyOffsets.length; ni++) {
      var offset = nearbyOffsets[ni];
      candidates.push({
        left: Math.max(4, Math.min(96, anchorCenterLeft + offset[0] * maxAnchorOffsetX / 3)),
        top: Math.max(8, Math.min(92, anchorCenterTop + offset[1] * maxAnchorOffsetY / 3))
      });
    }
  } else {
    for (var ci = 0; ci < 48; ci++) {
      var col = ci % 8;
      var row = Math.floor(ci / 8) % gridRows;
      candidates.push({
        left: 10 + col * 11 + (row % 2 ? 3 : 0),
        top: Math.max(10, randomTop - 4) + row * gridStep
      });
    }
  }

  var best = null;
  var bestOverlap = Infinity;
  for (var pi = 0; pi < candidates.length; pi++) {
    var candidate = candidates[pi];
    sp.style.left = candidate.left + '%';
    sp.style.top = candidate.top + '%';
    sp.style.marginTop = '0px';
    var candidateRect = sp.getBoundingClientRect();
    var overlap = 0;
    for (var ri = 0; ri < existingRects.length; ri++) {
      var occupied = existingRects[ri];
      var horizontal = Math.max(0, Math.min(candidateRect.right, occupied.right + 4) -
        Math.max(candidateRect.left, occupied.left - 4));
      var vertical = Math.max(0, Math.min(candidateRect.bottom, occupied.bottom + 4) -
        Math.max(candidateRect.top, occupied.top - 4));
      overlap += horizontal * vertical;
    }
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      best = candidate;
    }
    if (overlap === 0) break;
  }
  if (best) {
    sp.style.left = best.left + '%';
    sp.style.top = best.top + '%';
    sp.style.marginTop = '0px';
    // 允許浮字跨出敵人卡片，但不要讓長數字超出整個戰鬥容器或視窗邊界。
    // 此時仍維持 translate(-50%, 0)，所以 getBoundingClientRect() 是實際顯示寬度。
    var clipNode = layer.closest ? layer.closest('#combat-area') : null;
    var clipRect = clipNode && clipNode.getBoundingClientRect ? clipNode.getBoundingClientRect() : null;
    if (clipRect && clipRect.width > 0) {
      var placedRect = sp.getBoundingClientRect();
      var shift = 0;
      if (placedRect.left < clipRect.left) shift = clipRect.left - placedRect.left;
      if (placedRect.right > clipRect.right) shift = clipRect.right - placedRect.right;
      if (shift) {
        var currentLeft = parseFloat(sp.style.left) || 0;
        sp.style.left = (currentLeft + shift / lr.width * 100) + '%';
      }
    }
  }
  sp.style.animation = oldAnimation;
  sp.style.transform = oldTransform;
}

function placeEnemyDamageFloat(sp, layer) {
  if (!ENEMY_FLOAT_LAYOUT_ENABLED) return;
  /* 新節點已先 append，計數包含自己；超過門檻時直接使用 floatText
     設定的初始位置，避免進入 48 個候選點 × 既有文字的同步 layout 迴圈。 */
  if (enemyDamageFloatActiveCount(layer) > ENEMY_FLOAT_LAYOUT_LOAD_LIMIT) return;
  placeFloatAvoidingOverlap(sp, layer, '.float-txt.enemy-hit-float', 28, 44, undefined, undefined, arguments[2]);
}

function placePlayerRecoveryFloat(sp, layer) {
  // 回復值只在玩家血條／魔力條附近飄動，不跑到頭像、名稱或狀態列。
  placeFloatAvoidingOverlap(sp, layer, '.float-txt', 48, 18, 3, 8);
}

function floatText(elId, text, cls, damageValue, ent, battleSnapshot, delayMs) {
  if (typeof uiRenderingSuspended === 'function' && uiRenderingSuspended()) {
    rememberBackgroundEnemyFloat(elId, text, cls, damageValue);
    return;
  }
  /* 顯示延遲（協議 v11）：讓數字對齊「打到人」那一刻——投射物要飛、多段技一段一段打，
     但模擬層是一瞬間把整段結算完的。純顯示時序，戰鬥結果早就定了。
     延遲期間敵人可能已死，但卡片還會留 FIELD_ENEMY_DEATH_CLEAR_DELAY（2.1 秒）才移除，
     遠長於這裡的延遲；真的來不及也只是走 queuePendingEnemyFloat 的既有路徑。 */
  if (delayMs > 0) {
    setTimeout(function () {
      floatText(elId, text, cls, damageValue, ent, battleSnapshot, 0);
    }, delayMs);
    return;
  }
  if (elId === 'tb-float' && text === 'MISS' && cls === 'miss') {
    elId = 'tp-float';
    text = '閃避!';
    cls = 'player-event dodge defend';
  }
  var enemyHitFloat = isEnemyHitFloat(elId, cls);
  var targetLayer = $id(elId);
  // 敵方傷害字從建立起就掛在敵方戰鬥容器的持久層，不再掛在會隨死亡
  // 卡片重建的 enemy-card 內。targetLayer 僅用來把數字定位在原目標附近。
  var useRetainedEnemyLayer = enemyHitFloat && elId && elId.indexOf('mv-float-') === 0;
  var layer = useRetainedEnemyLayer ? ($id('mv-float-retained') || targetLayer) : targetLayer;
  if (!layer || layer.offsetParent === null) {
    queuePendingEnemyFloat(elId, text, cls, damageValue, ent);
    return;
  } // 新敵人尚未完成畫面建立時，先保留傷害字
  if (elId === 'tb-float' && text === 'MISS' && cls && cls.indexOf('enemy-dodge') >= 0) {
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var lastMissAt = parseFloat(layer.getAttribute('data-last-miss-at') || '-9999');
    if (now - lastMissAt < 300) return;
    layer.setAttribute('data-last-miss-at', String(now));
  }
  // Each float has its own removal timer. Do not enforce a fixed node cap by
  // deleting an active number: rapid multi-hit attacks must remain visible.
  // 不因數量或 opacity 主動清理任何數字；每個節點只由自己的自然淡出
  // 計時器移除，避免大量死亡時一次掃描造成畫面與動畫不同步。
  if (enemyHitFloat) animatePendingEnemyKill(ent, elId, cls, battleSnapshot);
  var damageInfo = enemyHitFloat ? enemyDamageFloatInfo(text, damageValue) : null;
  var damageKey = damageInfo ? enemyDamageFloatKey(cls) : '';
  var recoveryInfo = playerRecoveryFloatInfo(elId, cls, text, damageValue);
  var recoveryKey = recoveryInfo ? recoveryInfo.key : '';
  if (damageKey) {
    var damageMergeLimit = enemyDamageFloatMergeLimitForLayer(battleSnapshot, layer);
    if (damageMergeLimit > 0) {
      var damageFloats = layer.querySelectorAll('.float-txt.enemy-hit-float');
      for (var di = damageFloats.length - 1; di >= 0; di--) {
        var existing = damageFloats[di];
        if (existing._enemyFloatTargetId !== elId || existing._damageFloatKey !== damageKey || existing._damageFloatHits >= damageMergeLimit) continue;
        existing._damageFloatTotal += damageValue;
        existing._damageFloatHits++;
        existing._enemyFloatCreatedAt = Date.now();
        existing.textContent = existing._damageFloatPrefix + fmt(existing._damageFloatTotal);
        scheduleFloatTextRemoval(existing, enemyDamageFloatLifetimeMs(existing));
        return;
      }
    }
  }
  if (recoveryKey) {
    var recoveryFloats = layer.querySelectorAll('.float-txt.player-recovery-float');
    for (var ri = recoveryFloats.length - 1; ri >= 0; ri--) {
      var recoveryExisting = recoveryFloats[ri];
      if (recoveryExisting._recoveryFloatKey !== recoveryKey || recoveryExisting._recoveryFloatHits >= PLAYER_RECOVERY_FLOAT_MAX_HITS) continue;
      recoveryExisting._recoveryFloatTotal += damageValue;
      recoveryExisting._recoveryFloatHits++;
      recoveryExisting.textContent = recoveryExisting._recoveryFloatPrefix + fmt(recoveryExisting._recoveryFloatTotal);
      scheduleFloatTextRemoval(recoveryExisting, FLOAT_TEXT_LIFETIME_MS);
      return;
    }
  }
  var sp = document.createElement('span');
  var enemyStyleClass = enemyHitFloat ? enemyDamageFloatStyleClass(cls) : '';
  sp.className = 'float-txt ' + (cls || '') + (enemyStyleClass ? ' ' + enemyStyleClass : '');
  if (enemyHitFloat) sp.className += ' enemy-hit-float';
  sp.textContent = text;
  var pct = enemyHitFloat ? 8 + Math.random() * 84 : 15 + Math.random() * 70;
  sp.style.left = pct + '%';
  if (enemyHitFloat) sp.style.top = (28 + Math.random() * 44) + '%';
  sp.style.marginTop = (enemyHitFloat ? (Math.random() * 24 - 12) : (Math.random() * 30 - 15)) + 'px';
  if (damageKey) {
    sp.className += ' damage-aggregate';
    sp._enemyFloatTargetId = elId;
    sp._damageFloatKey = damageKey;
    sp._damageFloatTotal = damageValue;
    sp._damageFloatHits = 1;
    sp._damageFloatPrefix = damageInfo.prefix;
    sp._enemyFloatCreatedAt = Date.now();
  }
  if (recoveryKey) {
    sp.className += ' player-recovery-float player-recovery-aggregate';
    sp._recoveryFloatKey = recoveryKey;
    sp._recoveryFloatTotal = damageValue;
    sp._recoveryFloatHits = 1;
    sp._recoveryFloatPrefix = recoveryInfo.prefix;
  }
  layer.appendChild(sp);
  if (enemyHitFloat) placeEnemyDamageFloat(sp, layer, targetLayer);
  if (recoveryKey) placePlayerRecoveryFloat(sp, layer);
  var panel = layer.closest('.combatant');
  // 敵方傷害浮字允許超出敵方框線；玩家事件與其他浮字仍維持在面板範圍內。
  if (panel && !enemyHitFloat) {
    var lr = layer.getBoundingClientRect();
    if (lr.width > 0) {
      var pr = panel.getBoundingClientRect();
      // overflow:hidden 以 padding box 裁切：面板可視範圍 = 邊框內側
      var clipLeft = pr.left + panel.clientLeft;
      var clipRight = clipLeft + panel.clientWidth;
      var w = sp.offsetWidth;
      var centerX = lr.left + lr.width * pct / 100;
      var minC = clipLeft + w / 2 + 1;
      var maxC = clipRight - w / 2 - 1;
      if (maxC < minC) { minC = maxC = (clipLeft + clipRight) / 2; } // 面板比字窄時置中
      var clamped = Math.min(maxC, Math.max(minC, centerX));
      if (Math.abs(clamped - centerX) > 0.5) {
        sp.style.left = ((clamped - lr.left) / lr.width * 100) + '%';
      }
    }
  }
  scheduleFloatTextRemoval(sp, enemyDamageFloatLifetimeMs(sp));
}

/* ---- 分頁 ---- */
function markTabDirty(name) {
  if (name === 'equip') {
    UI.dirty.equip = true;
    UI.dirty.inv = true;
  } else if (name === 'newforge') {
    UI.dirty.newforge = true;
    UI.dirty.factory = true;
  } else if (name === 'forge') UI.dirty.forge = true;
  else if (name === 'tower') UI.dirty.tower = true;
  else if (name === 'gems') UI.dirty.gems = true;
  else if (name === 'skills') UI.dirty.skills = true;
  else if (name === 'talents') UI.dirty.talents = true;
}

function switchTab(name) {
  if (name === 'talents') {
    var talentSnapshot = uiTalentPanelSnapshot();
    if (!talentSnapshot || talentViewReincarnations(talentSnapshot) < 1) name = 'equip';
  }
  UI.tab = name;
  syncVfxQualityForTab();
  refreshUiPanelSubscriptions();
  markTabDirty(name);
  // 分頁重新取得最新快照：背景分頁的 dirty 訊號可能已被 Worker 消費，
  // 若只標記 UI dirty，切回技能頁時會繼續顯示舊技能點／裝載欄數量。
  if (validUiPanelKey(name)) requestPanelData(name, true);
  var activeTabButton = document.querySelector('.tab-btn.active');
  var nextTabButton = document.querySelector('.tab-btn[data-tab="' + name + '"]');
  if (activeTabButton && activeTabButton !== nextTabButton) activeTabButton.classList.remove('active');
  if (nextTabButton) nextTabButton.classList.add('active');
  var activeTabSection = document.querySelector('.tab.active');
  var nextTabSection = document.getElementById('tab-' + name);
  if (activeTabSection && activeTabSection !== nextTabSection) activeTabSection.classList.remove('active');
  if (nextTabSection) nextTabSection.classList.add('active');
  if (name !== 'settings') UI.saveNoticeId = null;
  // 熔爐改版公告：玩家切到熔爐分頁後停止頁籤閃爍
  if (name === 'newforge') {
    markNewForgeTabSeenIfNeeded();
  }
  if (name === 'settings') {
    if (typeof scanManualMetadataV2 === 'function' && typeof _saveDir !== 'undefined' && _saveDir) {
      scanManualMetadataV2().then(function () {
        renderSaveList();
        refreshSaveFolderFilesV2();
      }).catch(function () {
        renderSaveList();
        refreshSaveFolderFilesV2();
      });
    } else {
      renderSaveList();
      refreshSaveFolderFilesV2();
    }
  }
  if (name === 'tower') UI._scrollTower = true;
}

/* ---- 熔爐改版公告：頁籤閃爍＋一次性彈窗（合併版遷移，migrateSave 設旗標） ---- */
function updateForgeTabGlow() {
  var btn = document.querySelector('.tab-btn[data-tab="newforge"]');
  if (!btn) return;
  var snapshot = peekUiPanelData('newforge');
  var nf = snapshot && snapshot.newForge;
  btn.classList.toggle('nf-glow', !!(nf && nf.tabSeen === false));
}
function showForgeRebuildNotice() {
  var snapshot = peekUiPanelData('newforge');
  var nf = snapshot && snapshot.newForge;
  if (!nf || nf.noticeShown !== false) return;
  var modal = $id('forge-rebuild-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  updateForgeTabGlow();
}

function markNewForgeTabSeenIfNeeded() {
  if (UI.tab !== 'newforge') return;
  var snapshot = uiNewForgePanelSnapshot();
  var nf = snapshot && snapshot.newForge;
  if (!nf || nf.tabSeen !== false || isUiCommandPending(nodePendingKey('newforge-tab'))) return;
  sendUiCommand('newforge.markTabSeen', {}, {
    keys: [nodePendingKey('newforge-tab')],
    panels: ['newforge']
  }).catch(function (error) {
    reportUiCommandFailure('熔爐頁籤已讀', error, ['newforge']);
  });
}

function updateTalentTabVisibility() {
  var btn = document.querySelector('.tab-btn[data-tab="talents"]');
  if (!btn) return;
  var snapshot = uiTalentPanelSnapshot();
  if (!snapshot) return;
  var unlocked = talentViewReincarnations(snapshot) >= 1;
  btn.style.display = unlocked ? '' : 'none';
  btn.setAttribute('aria-hidden', unlocked ? 'false' : 'true');
  if (!unlocked && UI.tab === 'talents') switchTab('equip');
}

/* ---- 存檔記錄列表（設定分頁） ---- */
function saveTimeStr(ts) {
  var t = new Date(ts);
  return t.getFullYear() + '/' + pad2(t.getMonth() + 1) + '/' + pad2(t.getDate()) + ' ' +
    pad2(t.getHours()) + ':' + pad2(t.getMinutes()) + ':' + pad2(t.getSeconds());
}

function saveFileSizeStr(size) {
  if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
  if (size >= 1024) return Math.round(size / 1024) + ' KB';
  return size + ' B';
}

function renderSaveFolderFilesV2(files) {
  var box = $id('save-folder-files');
  var listBox = $id('save-folder-files-list');
  if (!box || !listBox) return;
  box.hidden = false;
  if (!files || !files.length) {
    listBox.innerHTML = '<div class="hint">目前資料夾沒有檔案。</div>';
    return;
  }
  listBox.innerHTML = files.map(function (f) {
    return '<div class="save-folder-file-row"><span class="save-folder-file-name" title="' + esc(f.name) + '">' + esc(f.name) +
      '</span><span class="save-folder-file-size">' + saveFileSizeStr(f.size) + '</span><span class="save-folder-file-time">' + saveTimeStr(f.lastModified) + '</span></div>';
  }).join('');
}

function refreshSaveFolderFilesV2(files) {
  if (files !== undefined) {
    renderSaveFolderFilesV2(files);
    return Promise.resolve(files);
  }
  var box = $id('save-folder-files');
  if (!box) return Promise.resolve([]);
  if (typeof listSaveFolderFilesV2 !== 'function' || typeof _saveDir === 'undefined' || !_saveDir) {
    box.hidden = true;
    return Promise.resolve([]);
  }
  return listSaveFolderFilesV2().then(function (freshFiles) {
    renderSaveFolderFilesV2(freshFiles);
    return freshFiles;
  }).catch(function () {
    box.hidden = true;
    return [];
  });
}

function rescanSaveFolderView(showMessage) {
  var messageBox = $id('save-msg');
  if (typeof _saveDir === 'undefined' || !_saveDir) {
    if (showMessage) {
      var hint = '⚠️ 尚未連接存檔資料夾，請先按「選擇／更新存檔資料夾」授權。';
      if (messageBox) messageBox.textContent = hint;
      blog(hint, 'warn');
    }
    return Promise.resolve([]);
  }
  if (showMessage && messageBox) messageBox.textContent = '⏳ 重新掃描存檔資料夾…';
  var scan = typeof scanManualMetadataV2 === 'function'
    ? scanManualMetadataV2()
    : Promise.resolve();
  return Promise.resolve(scan).then(function () {
    renderSaveList();
    return refreshSaveFolderFilesV2();
  }).then(function (files) {
    if (showMessage) {
      var text = '✅ 已重新掃描「' + _saveDir.name + '」，目前共有 ' + files.length + ' 個檔案。';
      if (messageBox) messageBox.textContent = text;
      blog(text, 'good');
    }
    return files;
  }).catch(function (error) {
    if (showMessage) {
      var reason = error && error.message ? error.message : String(error || '無法讀取資料夾');
      var text = '⚠️ 重新掃描失敗：' + reason;
      if (messageBox) messageBox.textContent = text;
      blog(text, 'warn');
    }
    return [];
  });
}

function renderSaveList() {
  var box = $id('save-list');
  if (!box) return;
  var auto = autoSaveMetaV2();
  var curRun = auto && auto.runId || 1;
  var list = [auto].concat(saveIndex().slice().sort(function (a, b) { return b.savedAt - a.savedAt; }).slice(0, 10));
  box.innerHTML = list.map(function (r) {
    var cur = r.kind === 'auto' && r.runId === curRun;
    var newNotice = UI.saveNoticeId === r.id ? '<div class="save-new-notice">✅ 已新增存檔！</div>' : '';
    return '<div class="save-row' + (r.kind === 'auto' ? ' auto' : '') + '">' +
      '<div class="save-info">' +
      '<div class="save-name">' + saveRecName(r) + (cur ? ' <span class="save-cur">目前遊戲</span>' : '') + '</div>' +
      '<div class="save-file">' + esc(r.fname) + '　<span class="save-time">' + saveTimeStr(r.savedAt) + '</span></div>' +
      '<div class="save-meta">Lv.' + r.level + '｜' + (ZONES[r.zone] ? ZONES[r.zone].emoji + ZONES[r.zone].name : '') + ' 第 ' + r.stage + ' 階｜第 ' + (r.runId || 1) + ' 局</div>' +
      newNotice +
      '</div>' +
      '<div style="display:flex; gap:8px;">' +
      '<button class="btn sm" data-load-save="' + r.id + '">📥 讀取</button>' +
      '<button class="btn sm" style="color:var(--danger, #f87171); border-color:var(--danger, #f87171);" data-del-save="' + r.id + '">🗑️ 刪除</button>' +
      '</div>' +
      '</div>';
  }).join('');
}


/* ---- 頂部資源 / 屬性 ---- */
function applyReincarnationTitleClass(el, count) {
  if (!el) return;
  for (var i = 0; i <= REINCARNATION_MAX; i++) el.classList.remove('reinc-title-' + i);
  var c = Math.max(0, Math.min(Number(count) || 0, REINCARNATION_MAX));
  el.classList.add('reinc-title-' + c);
}

function headerViewGemCount(player, type, level) {
  var byType = player && player.gems && player.gems[type];
  return Math.max(0, Number(byType && byType[level]) || 0);
}

function headerViewTotalGems(player) {
  var total = 0;
  for (var type in GEM_TYPES) {
    for (var level = 1; level <= GEM_FORGE_MAX_LEVEL; level++) {
      total += headerViewGemCount(player, type, level);
    }
  }
  return total;
}

function renderHeader() {
  var headerSnapshot = uiHeaderPanelSnapshot();
  if (!headerSnapshot || !headerSnapshot.player || !headerSnapshot.stats) return;
  var p = headerSnapshot.player;
  var st = headerSnapshot.stats;
  updateTalentTabVisibility();
  function updateResourceTip(id, title, desc) {
    var valueEl = $id(id);
    if (!valueEl || !valueEl.parentNode) return;
    valueEl.parentNode.setAttribute('data-tt-title', title);
    valueEl.parentNode.setAttribute('data-tt-desc', desc);
    valueEl.parentNode.removeAttribute('title');
  }
  updateResourceTip('r-gold', '金幣', '目前持有：' + fmtFull(p.gold));
  updateResourceTip('r-scrap', '裝備碎片', '目前持有：' + fmtFull(p.scrap));
  updateResourceTip('r-essence', '附魔精華', '目前持有：' + fmtFull(p.essence));
  updateResourceTip('r-dust', '魔塵', '神鑄材料，可提升鑄造成功率。｜目前持有：' + fmtFull(p.dust || 0));
  updateResourceTip('r-magic-scroll', '魔法卷軸', '技能融合材料；拆解裝備與高塔通關時隨附魔精華獲得（數量為其 1/10）。｜目前持有：' + fmtFull(p.magicScroll || 0));
  updateResourceTip('r-ancient-essence', '太古精華', '太古機制改版：太古詞條於裝備產出時決定，洗煉不再消耗太古精華（此資源暫保留，用途待定）。｜目前持有：' + fmtFull(p.ancientEssence || 0));
  updateResourceTip('r-soul-origin', '魔魂本源', '用於本源覺醒的道具。｜目前持有：' + fmtFull(p.soulOrigin || 0));
  updateResourceTip('r-demon-seed', '魔種', '煉獄之塔 BOSS 額外掉落材料。煉獄之塔限定｜目前持有：' + fmtFull(p.demonSeed || 0));
  $id('r-gold').textContent = fmt(p.gold);
  $id('r-scrap').textContent = fmt(p.scrap);
  $id('r-essence').textContent = fmt(p.essence);
  if ($id('r-dust')) $id('r-dust').textContent = fmt(p.dust || 0);
  if ($id('r-magic-scroll')) $id('r-magic-scroll').textContent = fmt(p.magicScroll || 0);
  if ($id('r-ancient-essence')) $id('r-ancient-essence').textContent = fmt(p.ancientEssence || 0);
  if ($id('r-soul-origin')) $id('r-soul-origin').textContent = fmt(p.soulOrigin || 0);
  if ($id('r-demon-seed')) $id('r-demon-seed').textContent = fmt(p.demonSeed || 0);
  // 神鑄頁籤：達到開放等級才顯示
  var forgeTabBtn = document.querySelector('.tab-btn[data-tab="forge"]');
  var forgeSnapshot = peekUiPanelData('forge');
  var forgeUnlockedView = forgeSnapshot && forgeSnapshot.forge
    ? !!forgeSnapshot.forge.unlocked
    : (Number(p.level) >= FORGE_UNLOCK_LEVEL &&
      Number(p.reincarnations) >= FORGE_UNLOCK_REINCARNATION);
  if (forgeTabBtn) forgeTabBtn.style.display = forgeUnlockedView ? '' : 'none';
  var gemTip = [];
  for (var gt in GEM_TYPES) {
    var tn = 0;
    for (var lv = 1; lv <= GEM_FORGE_MAX_LEVEL; lv++) tn += headerViewGemCount(p, gt, lv);
    if (tn) gemTip.push(GEM_TYPES[gt].emoji + GEM_TYPES[gt].name + ' x' + tn);
  }
  var totalGems = headerViewTotalGems(p);
  $id('r-gems').textContent = fmt(totalGems);
  updateResourceTip('r-gems', '寶石', gemTip.join('、') || '尚無寶石');
  var bookTotal = 0, bookTip = [];
  for (var bk in p.books) {
    bookTotal += p.books[bk];
    if (p.books[bk]) bookTip.push(ENCHANTS[bk].name + ' x' + p.books[bk]);
  }
  $id('r-books').textContent = fmt(bookTotal);
  updateResourceTip('r-books', '附魔書', bookTip.join('、') || '尚無附魔書');

  // shownRes 由模擬層在資源首次取得時更新；渲染只讀快照。
  var shownRes = p.shownRes || {};
  var resVisMap = [
    { id: 'r-essence', val: p.essence || 0 },
    { id: 'r-dust', val: p.dust || 0 },
    { id: 'r-magic-scroll', val: p.magicScroll || 0 },
    { id: 'r-ancient-essence', val: p.ancientEssence || 0 },
    { id: 'r-soul-origin', val: p.soulOrigin || 0 },
    { id: 'r-demon-seed', val: p.demonSeed || 0 },
    { id: 'r-gems', val: totalGems },
    { id: 'r-books', val: bookTotal }
  ];
  resVisMap.forEach(function (item) {
    var el = $id(item.id);
    if (!el || !el.parentNode) return;
    el.parentNode.style.display = shownRes[item.id] ? '' : 'none';
  });

  refreshOpenResourceTooltip();

  $id('toggle-compare').checked = !!(headerSnapshot.settings && headerSnapshot.settings.compareEq);
  var autoEquipToggle = $id('toggle-autoequip');
  if (autoEquipToggle) autoEquipToggle.checked = !!headerSnapshot.autoEquip;
  $id('p-level').textContent = 'Lv.' + p.level;
  if ($id('pv-level')) $id('pv-level').textContent = 'Lv.' + p.level;
  if ($id('tp-level')) $id('tp-level').textContent = 'Lv.' + p.level;
  var reinc = clamp(Math.floor(Number(p.reincarnations) || 0), 0, REINCARNATION_MAX);
  var currentLevel = Math.max(0, Math.floor(Number(p.level) || 0));
  var canReincarnate = canReincarnateAt(currentLevel, reinc);
  var reincarnationControls = $id('reincarnation-controls');
  if (reincarnationControls) {
    reincarnationControls.classList.toggle('is-visible', reinc > 0 || canReincarnate);
  }
  var rank = reincarnationRankName(reinc);
  var classEl = $id('p-class');
  if (classEl) { classEl.textContent = rank; applyReincarnationTitleClass(classEl, reinc); }
  if ($id('p-reincarnation')) {
    $id('p-reincarnation').textContent = reinc >= 11
      ? '神階 ' + (reinc - 10) + '/10'
      : '轉生：' + reinc + '/10';
  }
  var pvName = $id('pv-name');
  var tpName = $id('tp-name');
  if (pvName) { pvName.textContent = rank + '（你）'; applyReincarnationTitleClass(pvName, reinc); }
  if (tpName) { tpName.textContent = rank + '（你）'; applyReincarnationTitleClass(tpName, reinc); }
  var reincBtn = $id('btn-reincarnate');
  if (reincBtn) {
    var isGodStage = reinc >= 10;
    reincBtn.classList.toggle('reincarnate-ready', canReincarnate);
    reincBtn.textContent = isGodStage ? '🔄 晉階' : '🔄 轉生';
    reincBtn.setAttribute('data-tip', reinc >= REINCARNATION_MAX
      ? '已達最高 神階 10/10'
      : (canReincarnate ? (isGodStage ? '目前可進行神階晉升' : '目前可進行轉生') : '等級達到 ' + REINCARNATION_LEVEL + ' 級可使用'));
    reincBtn.removeAttribute('title');
  }
  var need = uiHeaderXpMax(p);
  var isMaxedOut = (p.level >= MAX_LEVEL && reinc >= REINCARNATION_MAX);
  $id('xp-fill').style.width = isMaxedOut ? '100%' : (clamp(p.xp / need * 100, 0, 100) + '%');
  var xpBar = $id('xp-bar');
  xpBar.setAttribute('data-tt-title', '角色經驗');
  xpBar.setAttribute('data-tt-desc', isMaxedOut ? '已升至最高等級。' : ('當前經驗值：' + fmt(p.xp) + ' / 升級經驗值：' + fmt(need)));
  xpBar.removeAttribute('title');

  // 屬性面板顯示「檢視中」裝備套的預覽屬性（切頁即變，不需確定切換）；header 其他區塊維持穿著中數值
  renderAttrPanel(headerSnapshot.viewStats || st, headerSnapshot);

  // 更新側欄硬編碼的屬性
  if ($id('s-hp')) {
    $id('s-hp').textContent = fmt(st.hp);
    $id('s-atk').textContent = fmt(st.atk);
    $id('s-def').textContent = fmt(st.def);
    $id('s-aspd').textContent = fmt1(st.aspd);
    $id('s-crit').textContent = (st.critRate * 100).toFixed(1) + '%';
    $id('s-ls').textContent = (st.lifesteal * 100).toFixed(1) + '%';
    $id('s-hit').textContent = (st.hit * 100).toFixed(1) + '%';
    $id('s-loot').textContent = (st.loot * 100).toFixed(1) + '%';
  }

  var dpsEl = $id('s-dps');
  if (dpsEl) dpsEl.textContent = fmt(Number(headerSnapshot.dps) || 0);
}


/* ---- 側欄 50+ 屬性面板（分組摺疊） ---- */
var _attrPanelBuilt = false;
function renderAttrPanel(st, headerSnapshot) {
  var panel = $id('attr-panel');
  if (!panel) return;
  if (!_attrPanelBuilt) {
    // 首次建立骨架（前兩組預設展開）
    var h = '<div id="attr-preview-note" class="attr-preview-note" hidden></div>';
    STAT_GROUPS.forEach(function (g, gi) {
      h += '<details class="attr-group"' + (gi < 2 ? ' open' : '') + '><summary>' + esc(g.title) + '</summary>';
      g.rows.forEach(function (row, ri) {
        if (typeof statPanelRowIsAllLocked === 'function' && statPanelRowIsAllLocked(row)) return;
        var descStr = typeof row[2] === 'function' ? row[2](st) : row[2];
        var tip = descStr ? ' data-tt-title="' + esc(row[0].replace(/<[^>]+>/g, '')) + '" data-tt-desc="' + esc(descStr) + '"' : '';
        h += '<div class="stat-row"' + tip + '><span>' + row[0] + '</span><b data-attr="' + gi + '-' + ri + '"></b></div>';
      });
      h += '</details>';
    });
    h += '<div class="stat-divider"></div>' +
      '<div class="stat-row" data-tt-title="實時 DPS" data-tt-desc="近 10 秒的平均每秒傷害"><span>📈 實時 DPS</span><b id="s-dps">0</b></div>' +
      '<div id="active-buffs" class="active-buffs"></div>';
    panel.innerHTML = h;
    _attrPanelBuilt = true;
  }
  // 預覽提示：檢視非穿著中的裝備套時，標明面板為該套的預覽屬性
  var previewNote = $id('attr-preview-note');
  if (previewNote) {
    var equipView = headerSnapshot && typeof headerSnapshot.equipView === 'number'
      ? headerSnapshot.equipView
      : 0;
    var equipActive = headerSnapshot && typeof headerSnapshot.equipActive === 'number'
      ? headerSnapshot.equipActive
      : 0;
    var previewing = equipView !== equipActive;
    previewNote.hidden = !previewing;
    if (previewing) {
      var previewEquipSnapshot = peekUiPanelData('equip');
      previewNote.textContent = '👁 屬性預覽：' +
        (previewEquipSnapshot ? equipSetViewLabel(previewEquipSnapshot, equipView) : '檢視中裝備套') +
        '（尚未穿上，戰鬥仍用' +
        (previewEquipSnapshot ? equipSetViewLabel(previewEquipSnapshot, equipActive) : '穿著中那套') + '）';
    }
  }
  // 更新數值
  STAT_GROUPS.forEach(function (g, gi) {
    g.rows.forEach(function (row, ri) {
      var el = panel.querySelector('[data-attr="' + gi + '-' + ri + '"]');
      if (el) {
        el.innerHTML = row[1](st);
        if (typeof row[2] === 'function') {
          var p = el.parentElement;
          if (p) p.setAttribute('data-tt-desc', row[2](st));
        }
      }
    });
  });
  var activeBuffsEl = $id('active-buffs');
  if (activeBuffsEl) activeBuffsEl.innerHTML = activeBuffsHtml();
}

var BUFF_TIP_EMOJI = {
  atkUp: '⚔️',
  defUp: '🛡️',
  aspdUp: '⚡',
  evasionUp: '🌀',
  critDmgUp: '💥',
  blockUp: '🔰',
  thornsUp: '🌵',
  lootUp: '🎁',
  hot: '💚',
  penUp: '🗡️',
  atkDown: '⚔️',
  defDown: '🛡️',
  // 潛力技能增益
  velocitySurge: '⚡',
  lightningOverload: '🌩️',
  chronoCdr: '🕳️',
  sacredInvert: '✨',
  allDmgUp: '🌀',
  enemyAspdDown: '⏱️',
  invuln: '🛡️'
};

function currentCombatPlayerEntity() {
  var battle = peekUiPanelData('battle');
  var field = battle && battle.field;
  return field && field.player ? field.player : null;
}


function buffSignedValueHtml(val, colorVar) {
  var n = Number(val) || 0;
  var text = (n >= 0 ? '+' : '') + fmt1(n) + '%';
  if (!colorVar || colorVar === 'var(--good)') return '<span class="buff-val" style="color:var(--good)">' + text + '</span>';
  return '<span class="buff-val" style="color:' + colorVar + '">' + text + '</span>';
}

function buffRemainHtml(remain) {
  return '<span class="buff-remain">' + Math.max(0, Math.ceil(remain || 0)) + 's</span>';
}

function activeBuffsHtml() {
  var buffs = activePlayerBuffs(currentCombatPlayerEntity());
  var h = '<div class="active-buffs-title">目前技能增益</div>';
  if (!buffs.length) return h + '<div class="active-buffs-empty">無</div>';
  for (var i = 0; i < buffs.length; i++) {
    var b = buffs[i];
    var label = buffLabel(b.key);
    h += '<div class="active-buff-row"><span class="active-buff-main">' +
      (BUFF_TIP_EMOJI[b.key] || '💪') + ' ' + esc(label) + '</span><span class="active-buff-side">' +
      (b.noVal ? '' : buffSignedValueHtml(b.val) + ' ') + buffRemainHtml(b.remain) + '</span></div>';
  }
  return h;
}

function buffTooltipDesc() {
  var buffs = activePlayerBuffs(currentCombatPlayerEntity());
  if (!buffs.length) return '<span class="dim-text">目前沒有技能增益</span>';
  var rows = [];
  for (var i = 0; i < buffs.length; i++) {
    var b = buffs[i];
    rows.push('<div class="buff-tip-row"><span>' + (BUFF_TIP_EMOJI[b.key] || '💪') + ' ' +
      esc(buffLabel(b.key)) + '</span><span>' + (b.noVal ? '' : buffSignedValueHtml(b.val) + ' ') +
      buffRemainHtml(b.remain) + '</span></div>');
  }
  return rows.join('');
}

function currentCombatEnemyEntity(anchorEl) {
  var battle = peekUiPanelData('battle');
  var towerActive = !!(UI_WORKER_STATE.view && UI_WORKER_STATE.view.towerActive);
  var tower = battle && battle.tower;
  if (towerActive && tower && tower.boss) return tower.boss;
  var field = battle && battle.field;
  var enemies = field && Array.isArray(field.monsters) ? field.monsters.slice() :
    (field && field.monster ? [field.monster] : []);
  enemies = enemies.filter(function (enemy) { return enemy && enemy.hp > 0; });
  var idx = NaN;
  if (anchorEl && anchorEl.getAttribute) idx = parseInt(anchorEl.getAttribute('data-enemy-index'), 10);
  if (isNaN(idx) && anchorEl && anchorEl.closest) {
    var card = anchorEl.closest('.enemy-card');
    if (card && card.parentNode) {
      var cards = Array.prototype.slice.call(card.parentNode.querySelectorAll('.enemy-card'));
      idx = cards.indexOf(card);
    }
  }
  if (!isNaN(idx) && enemies[idx]) return enemies[idx];
  return enemies[0] || null;
}


function combatStatusRemain(until) {
  return Math.max(0, Math.ceil((until || 0) - GT));
}

function combatStatusRow(icon, label, valueHtml, remain) {
  return '<div class="buff-tip-row"><span>' + icon + ' ' + esc(label) + '</span><span>' +
    (valueHtml || '') + (remain ? ' ' + buffRemainHtml(remain) : '') + '</span></div>';
}

function enemyBuffTooltipDesc(anchorEl) {
  var ent = currentCombatEnemyEntity(anchorEl);
  if (!ent) return '<span class="dim-text">目前沒有狀態</span>';
  var rows = [];
  if (ent.effects && effectActive(ent, 'stun')) rows.push(combatStatusRow('😵', '暈眩', '', combatStatusRemain(ent.effects.stun)));
  if (ent.effects && effectActive(ent, 'slow')) rows.push(combatStatusRow('🐌', '減速', '', combatStatusRemain(ent.effects.slow)));
  if (poisonActive(ent)) rows.push(combatStatusRow('☠️', '中毒', '', combatStatusRemain(ent.poisonUntil)));
  if (ent.dots) {
    for (var i = 0; i < ent.dots.length; i++) {
      var dot = ent.dots[i];
      if (dot && dot.until > GT) rows.push(combatStatusRow('🩸', dot.name || '持續傷害', '', combatStatusRemain(dot.until)));
    }
  }
  var keys = activeBuffKeys(ent);
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    var buff = ent.buffs && ent.buffs[key];
    if (!buff || buff.until <= GT) continue;
    var down = key === 'atkDown' || key === 'defDown' || key === 'enemyAspdDown';
    rows.push(combatStatusRow(BUFF_TIP_EMOJI[key] || (down ? '📉' : '💪'), buffLabel(key) + (down ? '↓' : '↑'),
      buffSignedValueHtml(buff.val, down ? 'var(--danger)' : 'var(--good)'), combatStatusRemain(buff.until)));
  }
  return rows.length ? rows.join('') : '<span class="dim-text">目前沒有狀態</span>';
}

function zoneElementTagsList(z, maxCount) {
  var table = (typeof ZONE_ENEMY_TABLES !== 'undefined' && ZONE_ENEMY_TABLES[z]) || null;
  var pool = (typeof ZONES !== 'undefined' && ZONES[z] && ZONES[z].pool) || null;
  var weights = {};
  var totalWeight = 0;
  if (table && Array.isArray(table)) {
    table.forEach(function (e) {
      var npc = typeof NPC_CONFIG_TABLE !== 'undefined' ? NPC_CONFIG_TABLE[e.npcId] : null;
      if (npc && npc.attr) {
        var w = Number(e.weight) || 1;
        weights[npc.attr] = (weights[npc.attr] || 0) + w;
        totalWeight += w;
      }
    });
  } else if (pool && Array.isArray(pool)) {
    pool.forEach(function (m) {
      if (m.attr) {
        weights[m.attr] = (weights[m.attr] || 0) + 1;
        totalWeight += 1;
      }
    });
  }
  var sortedAttrs = Object.keys(weights).sort(function (a, b) {
    return weights[b] - weights[a];
  });
  if (sortedAttrs.length === 0) return [];
  var limit = typeof maxCount === 'number' ? maxCount : 3;
  return sortedAttrs.slice(0, limit).map(function (attr) {
    if (typeof ELEM_INFO === 'undefined' || !ELEM_INFO[attr]) return null;
    var info = ELEM_INFO[attr];
    var emoji = (attr === 'poison' ? '🟢' : (attr === 'dark' ? '🟣' : info.emoji));
    var shortName = info.short || info.name;
    var pct = totalWeight > 0 ? (weights[attr] / totalWeight * 100) : 0;
    var pctStrVal = typeof pctStr === 'function' ? pctStr(pct) : ((Math.round(pct * 10) / 10) + '%');
    return {
      attr: attr,
      emoji: emoji,
      shortName: shortName,
      pct: pct,
      pctStr: pctStrVal,
      label: emoji + ' ' + shortName + '屬性 (' + pctStrVal + ')'
    };
  }).filter(Boolean);
}

function renderSceneTabs() {
  var header = uiHeaderPanelSnapshot() || {};
  var stage = header.stage || {};
  var cur = stage.zone || 'desert';

  var zoneBox = $id('zone-tabs');
  if (!zoneBox) return;

  var activeRlm = activeRealm();

  var list = (header.player && header.player.reincarnations >= 11)
    ? (activeRlm === 'god' ? ['god_battlefield', 'god_chaos', 'god_sanctuary'] : ['desert', 'Icefield', 'swamp', 'undead_mountains'])
    : ['desert', 'Icefield', 'swamp', 'undead_mountains'];

  var html = list.map(function (z) {
    var zd = ZONES[z];
    if (!zd) return '';
    var locked = false;
    if (zd.reqReincarnation && Number(header.player && header.player.reincarnations) < zd.reqReincarnation) {
      locked = true;
    }
    if (zd.reqZone && !locked) {
      if (zoneBestOf(z) <= 1 && zoneClearedOf(zd.reqZone) < zd.reqStage) locked = true;
    }
    var elemTags = zoneElementTagsList(z);
    var elemText = elemTags.length > 0 ? ('主要敵人屬性：' + elemTags.map(function (t) { return t.label; }).join(' ')) : '';
    var ttDesc = z === 'Icefield' ? '敵人更強；經驗、金幣與材料掉落 ×2' :
      z === 'swamp' ? '敵人極強；經驗、金幣與材料掉落 ×3' :
        z === 'god_battlefield' ? '神界戰場；神級敵人，經驗與獎勵 ×2.5' :
          z === 'god_chaos' ? '神界混沌；極強虛空生物，經驗與獎勵 ×3.5' :
            z === 'god_sanctuary' ? '神界聖域；諸神降臨，經驗與獎勵 ×5.0' : '';

    if (elemText) {
      ttDesc = elemText + (ttDesc ? ('\n' + ttDesc) : '');
    }

    if (locked && zd.reqReincarnation) {
      ttDesc = '🔒 解鎖條件：需要 ' + zd.reqReincarnation + ' 轉' + (elemText ? ('\n' + elemText) : '');
    } else if (locked && zd.reqZone && ZONES[zd.reqZone]) {
      var lockTip = '🔒 解鎖條件：需通關【' + ZONES[zd.reqZone].name + '】第 ' + zd.reqStage + ' 階段';
      ttDesc = lockTip + (ttDesc ? ('\n' + ttDesc) : '');
    }

    var badgeText = locked
      ? '🔒'
      : '(' + fmt(zoneBestOf(z)) + ')';
    var cls = 'zone-btn' + (locked ? ' locked' : '') + (z === cur ? ' active' : '');
    var dis = locked ? ' style="opacity:0.5; cursor:default;"' : ' style="opacity:1; cursor:pointer;"';
    var ttAttr = ' data-tt-title="' + esc(zd.name) + '" data-tt-desc="' + esc(ttDesc) + '"';

    return '<button class="' + cls + '" data-zone="' + z + '"' + ttAttr + dis + '>' +
      zd.emoji + ' ' + esc(zd.name) + ' <span class="zone-best">' + badgeText + '</span></button>';
  }).join('');

  zoneBox.innerHTML = html;
}

/* ---- 戰鬥畫面 ---- */
function entStatus(ent) {
  if (!ent) return '';
  var s = [];
  if (effectActive(ent, 'stun')) s.push('😵暈眩');
  if (effectActive(ent, 'slow')) s.push('🐌減速');
  if (poisonActive(ent)) s.push('☠️中毒');
  if (ent.dots) {
    for (var i = 0; i < ent.dots.length; i++) {
      if (ent.dots[i].until > GT) s.push('🩸' + ent.dots[i].name);
    }
  }
  var bks = activeBuffKeys(ent);
  for (var b = 0; b < bks.length; b++) {
    var k = bks[b];
    if (k === 'atkDown' || k === 'defDown' || k === 'enemyAspdDown') s.push('📉' + buffLabel(k) + '↓');
    else s.push('💪' + buffLabel(k) + '↑');
  }
  return s.join(' ');
}
/* snapshotGt：這份戰鬥快照是什麼時候拍的（battle 面板的 gt）。
   技能冷卻存的是「還剩幾秒」，面板又只在髒區時才更新，所以必須扣掉拍照到現在的時間，
   否則 4 秒的冷卻會卡在 4.0 好幾秒然後突然可以放。 */
function renderMpSkill(pEnt, prefix, stats, snapshotGt) {
  if (!stats) return;
  var maxMp = Math.max(1, Number(stats.mp) || 1);
  var mpFill = $id(prefix + '-mp'), mpText = $id(prefix + '-mptext'), skillEl = $id(prefix + '-skill');
  setStyleIfChanged(mpFill, 'width', clamp(pEnt.mp / maxMp * 100, 0, 100) + '%');
  setTextIfChanged(mpText, fmt(Math.floor(pEnt.mp)) + ' / ' + fmt(maxMp));
  if (skillEl) {
    var headerSnapshot = uiHeaderPanelSnapshot();
    var lo = headerSnapshot && headerSnapshot.player && headerSnapshot.player.loadout || [];
    if (!lo.length) {
      setHtmlIfChanged(skillEl, '<div style="grid-column:1/-1;color:var(--dim);text-align:center;font-size:12px;margin-top:4px;">（未裝備）</div>');
      return;
    }

    var arr = [];
    var skillsSnapshot = uiSkillsPanelSnapshot();
    var talentSnapshot = uiTalentPanelSnapshot();
    for (var i = 0; i < lo.length; i++) {
      var entry = lo[i];
      var isPotE = typeof entry === 'string' && entry.indexOf('potential:') === 0;
      var sk = isPotE ? (typeof potentialDef === 'function' ? potentialDef(entry.slice(10)) : null) : skillViewDef(skillsSnapshot, entry);
      if (!sk) continue;
      var cd = uiCountdownRemain((pEnt.skillCds && pEnt.skillCds[entry]) || 0, snapshotGt);
      var lv = isPotE
        ? uiPotentialLevelFromSnapshot(talentSnapshot, sk.id)
        : skillViewLevel(skillsSnapshot, entry);
      arr.push({ sk: sk, lv: lv, cd: cd, cost: isPotE ? 0 : skillManaCost(sk, lv) });
    }

    arr.sort(function (a, b) {
      return a.cd - b.cd;
    });

    arr = arr.slice(0, 12);

    var h = '';
    for (var i = 0; i < arr.length; i++) {
      var it = arr[i];
      var txt = '';
      var cls = '';
      if (it.cd > 0) { txt = fmt1(Math.max(0, it.cd)) + 's'; cls = 'on-cd'; }
      else if (pEnt.mp < it.cost) { txt = '🚫'; cls = 'no-mp'; }
      else { txt = '✓'; cls = 'ready'; }
      h += '<div class="sk-run-item ' + cls + '">' + it.sk.emoji + ' <span>' + txt + '</span></div>';
    }
    setHtmlIfChanged(skillEl, h);
  }
}

// 場景最高階段（當前場景以即時值為準）
function zoneBestOf(z) {
  var header = peekUiPanelData('header') || {};
  var stage = header.stage || {};
  if (stage.zone === z) return stage.best || 1;
  var battle = peekUiPanelData('battle') || {};
  return (battle.zoneProgress && battle.zoneProgress[z] && battle.zoneProgress[z].best) || 1;
}

// 場景通關最高階段（用於解鎖條件判定：前圖 BOSS 必須被擊敗）
function zoneClearedOf(z) {
  var header = peekUiPanelData('header') || {};
  var stage = header.stage || {};
  var battle = peekUiPanelData('battle') || {};
  var zpList = battle.zoneProgressList || [];
  for (var i = 0; i < zpList.length; i++) {
    if (zpList[i].key === z) {
      if (typeof zpList[i].cleared === 'number') return zpList[i].cleared;
      return Math.max(0, (zpList[i].best || 1) - 1);
    }
  }
  var curZp = (battle.zoneProgress && battle.zoneProgress[z]) || {};
  var cleared = Math.floor(Number(curZp.cleared) || 0);
  if (stage.zone === z) {
    return Math.max(cleared, Math.max(1, Number(stage.best) || 1) - 1);
  }
  return Math.max(cleared, Math.max(1, Number(curZp.best) || 1) - 1);
}

function currentZoneBarSignature() {
  var header = peekUiPanelData('header') || {};
  var parts = [(header.stage && header.stage.zone) || 'desert'];
  Object.keys(ZONES).forEach(function (z) { parts.push(z + ':' + zoneBestOf(z) + ':' + zoneClearedOf(z)); });
  return parts.join('|');
}

function renderZoneBar() {
  var header = peekUiPanelData('header') || {};
  var cur = (header.stage && header.stage.zone) || 'desert';
  var curZd = ZONES[cur];
  if (curZd && curZd.realm && !UI.userSelectedRealm) {
    UI.activeRealm = curZd.realm;
  }
  var activeRlm = UI.activeRealm || (curZd && curZd.realm) || 'human';
  var isGodUnlocked = !!(header.player && Number(header.player.reincarnations) >= 11);

  var toggleBtn = $id('btn-realm-toggle');
  if (toggleBtn) {
    toggleBtn.style.display = isGodUnlocked ? 'inline-block' : 'none';
    if (isGodUnlocked) {
      if (activeRlm === 'god') {
        toggleBtn.textContent = '🌍 凡人界地圖';
        toggleBtn.setAttribute('data-tt-title', '切換至凡人界');
        toggleBtn.setAttribute('data-tt-desc', '切換為荒漠、冰原、沼澤地圖');
      } else {
        toggleBtn.textContent = '✨ 神界地圖';
        toggleBtn.setAttribute('data-tt-title', '切換至神界');
        toggleBtn.setAttribute('data-tt-desc', '切換為太古戰場、混沌界、永恒神域地圖');
      }
    }
  }

  var signature = currentZoneBarSignature() + '|' + activeRlm + '|' + isGodUnlocked;
  if (UI.zoneBarSignature === signature) return;
  UI.zoneBarSignature = signature;

  var zoneBox = $id('zone-bar');
  if (!zoneBox) return;

  var list = isGodUnlocked
    ? (activeRlm === 'god' ? ['god_battlefield', 'god_chaos', 'god_sanctuary'] : ['desert', 'Icefield', 'swamp', 'undead_mountains'])
    : ['desert', 'Icefield', 'swamp', 'undead_mountains'];

  var html = list.map(function (z) {
    var zd = ZONES[z];
    if (!zd) return '';
    var locked = false;
    if (zd.reqReincarnation && Number(header.player && header.player.reincarnations) < zd.reqReincarnation) {
      locked = true;
    }
    if (zd.reqZone && !locked) {
      if (zoneBestOf(z) <= 1 && zoneClearedOf(zd.reqZone) < zd.reqStage) locked = true;
    }
    var elemTags = zoneElementTagsList(z);
    var elemText = elemTags.length > 0 ? ('主要敵人屬性：' + elemTags.map(function (t) { return t.label; }).join(' ')) : '';
    var ttDesc = z === 'Icefield' ? '敵人更強；經驗、金幣與材料掉落 ×2' :
      z === 'swamp' ? '敵人極強；經驗、金幣與材料掉落 ×3' :
        z === 'god_battlefield' ? '神界戰場；神級敵人，經驗與獎勵 ×2.5' :
          z === 'god_chaos' ? '神界混沌；極強虛空生物，經驗與獎勵 ×3.5' :
            z === 'god_sanctuary' ? '神界聖域；諸神降臨，經驗與獎勵 ×5.0' : '';

    if (elemText) {
      ttDesc = elemText + (ttDesc ? ('\n' + ttDesc) : '');
    }

    if (locked && zd.reqReincarnation) {
      ttDesc = '🔒 解鎖條件：需要 ' + zd.reqReincarnation + ' 轉' + (elemText ? ('\n' + elemText) : '');
    } else if (locked && zd.reqZone && ZONES[zd.reqZone]) {
      var lockTip = '🔒 解鎖條件：需通關【' + ZONES[zd.reqZone].name + '】第 ' + zd.reqStage + ' 階段';
      ttDesc = lockTip + (ttDesc ? ('\n' + ttDesc) : '');
    }

    var badgeText = locked
      ? '🔒'
      : '(' + fmt(zoneBestOf(z)) + ')';
    var cls = 'zone-btn' + (locked ? ' locked' : '') + (z === cur ? ' active' : '');
    var dis = locked ? ' style="opacity:0.5; cursor:default;"' : ' style="opacity:1; cursor:pointer;"';
    var ttAttr = ' data-tt-title="' + esc(zd.name) + '" data-tt-desc="' + esc(ttDesc) + '"';

    return '<button class="' + cls + '" data-zone="' + z + '"' + ttAttr + dis + '>' +
      zd.emoji + ' ' + esc(zd.name) + ' <span class="zone-best">' + badgeText + '</span></button>';
  }).join('');

  zoneBox.innerHTML = html;
}

/* ---- 指令在途期間的樂觀顯示 ----
   refreshStageDisplay 每個 uiTick 都會跑，而它讀的是 header 面板快照——那份快照要等
   指令的面板回應回來才會更新。中間這段空窗如果照舊資料重畫，玩家會看到自己的操作被彈回去：
     ・關卡：放開連續後退鍵的瞬間先閃回舊關卡再跳到目標（實際看到 85 →110 → 85）
     ・自動推進：勾選後立刻被取消勾選，多試幾次才「成功」（其實是剛好撞上面板更新）
   有效期用 isUiCommandPending——那把鎖正好在「送出」到「新面板抵達」之間成立，
   面板一到就自動失效，不需要另外設逾時。 */
var _stagePendingStage = null;

function setStagePendingStage(stage) {
  _stagePendingStage = (typeof stage === 'number') ? stage : null;
  refreshStageDisplay();
}

function refreshStageDisplay(stageOverride) {
  var header = peekUiPanelData('header') || {};
  var stg = header.stage;
  if (!stg) return;
  var znd = uiCurrentZoneDef(header);
  var label = $id('stage-label');
  var best = $id('stage-best');
  var auto = $id('st-auto');
  if (_stagePendingStage !== null && !isUiCommandPending(nodePendingKey('stage'))) {
    _stagePendingStage = null; // 新資料已到，樂觀值退場
  }
  var displayStage = typeof stageOverride === 'number'
    ? stageOverride
    : (UI.stageHold.active && typeof UI.stageHold.targetStage === 'number'
      ? UI.stageHold.targetStage
      : (_stagePendingStage !== null ? _stagePendingStage : stg.current));
  setTextIfChanged(label, znd.emoji + ' 第 ' + displayStage + ' 階段');
  setTextIfChanged(best, '最高' + stg.best + '關');
  // 切換在途時不要用舊快照蓋掉勾選狀態
  if (!isUiCommandPending(nodePendingKey('stage-auto'))) setCheckedIfChanged(auto, stg.autoAdvance);
}

function refreshCombatPauseButton() {
  var btn = $id('btn-combat-pause');
  var detailBtn = $id('btn-detail-combat-pause');
  var paused = !!(UI_WORKER_STATE.view && UI_WORKER_STATE.view.paused);
  [btn, detailBtn].forEach(function (el) {
    if (!el) return;
    var pressed = paused ? 'true' : 'false';
    if (el.getAttribute('aria-pressed') === pressed) return;
    el.setAttribute('aria-pressed', pressed);
    setTextIfChanged(el, paused ? '▶ 繼續' : '⏸ 暫停');
    el.setAttribute('data-tt-title', '戰鬥控制');
    el.setAttribute('data-tt-desc', paused ? '繼續野外與高塔戰鬥' : '暫停野外與高塔戰鬥');
    el.classList.toggle('active', paused);
  });
}

function playerShieldMax(entity) {
  if (!entity) return 0;
  return Math.max(0, entity.shieldMax || 0);
}
function renderPlayerShieldBar(prefix, entity, stats) {
  var shieldBar = $id(prefix + '-shield');
  if (!shieldBar || !entity || !stats) return;
  var shield = Math.max(0, entity.shield || 0);
  var shieldMax = playerShieldMax(entity);
  if (shield > 0.5 && shieldMax > 0) {
    setStyleIfChanged(shieldBar, 'display', 'block');
    setStyleIfChanged(shieldBar, 'width', clamp(shield / shieldMax * 100, 0, 100) + '%');
  } else {
    setStyleIfChanged(shieldBar, 'display', 'none');
    setStyleIfChanged(shieldBar, 'width', '0%');
  }
}
function playerShieldText(entity) {
  var shield = entity ? Math.max(0, entity.shield || 0) : 0;
  return shield > 0.5 ? '<span style="color:var(--info)">+' + fmt(shield) + '</span>' : '';
}

// 多敵人時名稱維持單行，寬度不足就縮小字體，不使用省略號截斷。
/* 讀寫分三段，不要交錯。

   原本是逐隻怪「寫 fontSize → 讀 clientWidth/computedStyle/scrollWidth → 寫 fontSize」，
   每一次讀取都落在寫入之後，於是瀏覽器被迫把整份文件重新排版——次數等於敵人數量。
   而排版成本取決於整份文件多大，不是敵人多少：裝備頁與神鑄頁各掛著一份九百多格的
   背包格線時，實測換一波怪要 37～49 ms，全部卡在主執行緒上。

   改成「全部寫完 → 全部讀完 → 全部寫回」，一次換波只重排一次。 */
function fitEnemyNames(party) {
  if (!party) return;
  var names = party.querySelectorAll('.enemy-name');
  var ni;
  for (ni = 0; ni < names.length; ni++) names[ni].style.fontSize = '';
  var measured = [];
  for (ni = 0; ni < names.length; ni++) {
    var nameEl = names[ni];
    var card = nameEl.closest ? nameEl.closest('.enemy-card') : null;
    if (!card) continue;
    measured.push({
      el: nameEl,
      available: Math.max(1, card.clientWidth - 6),
      baseSize: parseFloat(window.getComputedStyle(nameEl).fontSize) || 10,
      naturalWidth: nameEl.scrollWidth
    });
  }
  for (ni = 0; ni < measured.length; ni++) {
    var m = measured[ni];
    if (m.naturalWidth > m.available) {
      m.el.style.fontSize = Math.max(6, m.baseSize * m.available / m.naturalWidth) + 'px';
    }
  }
}

/* ---- 敵人階級與站位（新版戰鬥）----
   階級只影響「顯示」：圖示、名稱顏色、血條顏色與外框；數值差異在模擬層決定。
   格位由 js/battlefield.js 在出怪時寫入 enemy.cell = { col, row, w, h }；
   主執行緒不重算站位，只照著擺——BF_COLS/BF_ROWS 由 data.js 提供（參數表可調）。 */
var ENEMY_RANK_ICONS = { normal: '', elite: '💀', boss: '👑' };

function enemyRankOf(enemy) {
  if (!enemy) return 'normal';
  if (enemy.isBoss) return 'boss';
  return enemy.elite ? 'elite' : 'normal';
}
function battlefieldCols() {
  return (typeof BF_COLS === 'number' && BF_COLS > 0) ? BF_COLS : 4;
}
function battlefieldRows() {
  return (typeof BF_ROWS === 'number' && BF_ROWS > 0) ? BF_ROWS : 4;
}
function enemyCellSignature(enemy) {
  var cell = enemy && enemy.cell;
  if (!cell) return '-';
  return cell.col + ',' + cell.row + ',' + (cell.w || 1) + ',' + (cell.h || 1);
}
/* 棋盤格線：每一格放一個空的虛線方框當底圖，讓玩家看得出敵人站在哪一格。
   純視覺，不參與命中判定；擺在敵人卡片之前，z-index 低於卡片與浮字。 */
function battlefieldGuideHtml() {
  var cols = battlefieldCols(), rows = battlefieldRows();
  var html = '';
  for (var r = 1; r <= rows; r++) {
    for (var c = 1; c <= cols; c++) {
      html += '<div class="bf-cell-guide" aria-hidden="true" style="grid-column:' + c + ';grid-row:' + r + '"></div>';
    }
  }
  return html;
}

/* 卡片的 grid 定位；沒有格位資訊（舊存檔的殘留敵人、高塔）時不寫 style，交由自動流排。 */
function enemyCellStyle(enemy) {
  var cell = enemy && enemy.cell;
  if (!cell || !(cell.col > 0) || !(cell.row > 0)) return '';
  return ' style="grid-column:' + cell.col + ' / span ' + (cell.w || 1) +
    ';grid-row:' + cell.row + ' / span ' + (cell.h || 1) + '"';
}

function enemyFloatLayerId(enemy, index) {
  var id = enemy && enemy.floatSel;
  return /^mv-float-\d+$/.test(id || '') ? id : 'mv-float-' + index;
}

function ensureRetainedEnemyFloatLayer(party) {
  var container = party.parentNode && typeof party.parentNode.appendChild === 'function' ? party.parentNode : party;
  var host = container.querySelector ? container.querySelector('.enemy-float-retained') : null;
  if (host && host.parentNode === party) container.appendChild(host);
  if (host) return host;
  host = document.createElement('div');
  host.className = 'float-layer enemy-float-retained';
  host.id = 'mv-float-retained';
  container.appendChild(host);
  return host;
}

/* 敵人卡片因死亡清除或站位變更而重建時，保留仍在播放的浮字節點。
   floatSel 是同一敵人的穩定識別，不能用目前陣列索引判斷是否同一張卡片。 */
function rebuildEnemyParty(party, html) {
  var oldLayers = {};
  var oldDeathStates = {};
  var container = party.parentNode && typeof party.parentNode.appendChild === 'function' ? party.parentNode : party;
  var retained = ensureRetainedEnemyFloatLayer(party);
  var oldCards = party.querySelectorAll ? party.querySelectorAll('.enemy-card') : [];
  for (var ci = 0; ci < oldCards.length; ci++) {
    var oldCard = oldCards[ci];
    var oldCardLayer = oldCard.querySelector ? oldCard.querySelector('.float-layer') : null;
    if (!oldCardLayer || !oldCardLayer.id || !oldCard.classList || !oldCard.classList.contains('is-dead')) continue;
    oldDeathStates[oldCardLayer.id] = { startedAt: oldCard._deathFadeStartedAt || Date.now() };
  }
  var layers = container.querySelectorAll
    ? container.querySelectorAll('.enemy-card .float-layer, .enemy-float-retained > .float-layer')
    : party.querySelectorAll('.enemy-card .float-layer, .enemy-float-retained > .float-layer');
  for (var i = 0; i < layers.length; i++) oldLayers[layers[i].id] = layers[i];
  party.innerHTML = html;
  retained = ensureRetainedEnemyFloatLayer(party);
  for (var deathId in oldDeathStates) {
    if (!Object.prototype.hasOwnProperty.call(oldDeathStates, deathId)) continue;
    var nextDeathLayer = party.querySelector('#' + deathId);
    var nextDeathCard = nextDeathLayer && nextDeathLayer.closest ? nextDeathLayer.closest('.enemy-card') : null;
    if (!nextDeathCard) continue;
    var deathState = oldDeathStates[deathId];
    nextDeathCard.classList.add('is-dead');
    nextDeathCard._deathFadeStartedAt = deathState.startedAt;
    var elapsed = Math.min(2000, Math.max(0, Date.now() - deathState.startedAt));
    var children = nextDeathCard.children || [];
    for (var childIndex = 0; childIndex < children.length; childIndex++) {
      if (children[childIndex].classList && children[childIndex].classList.contains('float-layer')) continue;
      children[childIndex].style.animationDelay = '-' + (elapsed / 1000) + 's';
    }
  }
  for (var id in oldLayers) {
    if (!Object.prototype.hasOwnProperty.call(oldLayers, id)) continue;
    var nextLayer = party.querySelector('#' + id);
    var oldLayer = oldLayers[id];
    if (nextLayer && nextLayer !== oldLayer) {
      while (oldLayer.firstChild) nextLayer.appendChild(oldLayer.firstChild);
      var lastMissAt = oldLayer.getAttribute('data-last-miss-at');
      if (lastMissAt !== null) nextLayer.setAttribute('data-last-miss-at', lastMissAt);
      // Remove the now-empty old layer; duplicate IDs make later float routing nondeterministic.
      if (oldLayer.parentNode) oldLayer.parentNode.removeChild(oldLayer);
    } else {
      // 敵人死亡倒數結束後，卡片會被移出 party；把它的整個浮字圖層
      // 留在持久層，否則 DOM 重建會連同仍在播放／延遲中的數字一起移除。
      retained.appendChild(oldLayer);
    }
  }
}

function renderBattle() {
  var headerSnapshot = uiHeaderPanelSnapshot() || {};
  var battleSnapshot = uiBattlePanelSnapshot() || {};
  var view = viewState() || {};
  var st = headerSnapshot.stats || { hp: view.hpMax || 1, mp: view.mpMax || 1 };
  renderZoneBar();
  refreshStageDisplay();
  refreshCombatPauseButton();
  renderQuestBar();

  var field = battleSnapshot.field || {};
  var p = field.player || {
    hp: view.hp || 0, maxHp: view.hpMax || 1,
    mp: view.mp || 0, maxMp: view.mpMax || 1,
    shield: view.shield || 0,
    effects: {}, buffs: {}, dots: [], skillCds: {}
  };
  if (p) {
    var php = clamp(p.hp / st.hp * 100, 0, 100);
    setStyleIfChanged($id('pv-hp'), 'width', php + '%');
    renderPlayerShieldBar('pv', p, st);
    setHtmlIfChanged($id('pv-hptext'), fmt(Math.max(0, p.hp)) + playerShieldText(p) + ' / ' + fmt(st.hp));
    // 倒數一律扣掉「快照拍照到現在」經過的時間，才會是逐幀前進的碼錶
    var reviveLeft = uiCountdownRemain(p.reviveCd, battleSnapshot.gt);
    setTextIfChanged($id('pv-status'), reviveLeft > 0 ? ('💀 復活中 ' + fmt1(reviveLeft) + 's') : entStatus(p));
    renderMpSkill(p, 'pv', st, battleSnapshot.gt);
  }
  // 與戰鬥引擎共用敵人集合，避免相容欄位仍有目標時畫面誤判為空。
  var enemies = Array.isArray(field.monsters) ? field.monsters.slice() : (field.monster ? [field.monster] : []);
  enemies = enemies.filter(function (enemy) {
    return enemy && (enemy.hp > 0 || (enemy._rewarded && Number(enemy._deathClearCd) > 0));
  });
  var party = $id('mv-party');
  if (!party) return;
  var scene = party.closest ? party.closest('.battle-scene') : null;
  // 新版戰鬥：敵方固定 4×4 棋盤，版面不再隨敵人數量變動——我方永遠靠左，棋盤永遠佔滿右側。
  if (scene) scene.classList.add('multi-enemy');
  if (scene) scene.classList.add('multi-enemy-layout');
  // 棋盤永遠存在（空場也是），所以格線與 grid 版型不隨敵人數量開關，避免波次之間閃動。
  party.className = 'enemy-party enemy-grid enemy-count-' + enemies.length;
  party.style.setProperty('--bf-cols', battlefieldCols());
  party.style.setProperty('--bf-rows', battlefieldRows());
  var guideHtml = battlefieldGuideHtml();
  if (!enemies.length) {
    if (party.getAttribute('data-enemy-signature') !== 'empty') {
      rebuildEnemyParty(party, guideHtml + '<div class="enemy-empty">' + (view.towerActive ? '（高塔戰鬥中…）' : '🔍 搜索敵人中…') + '</div>');
      party.setAttribute('data-enemy-signature', 'empty');
      if (typeof vfxInvalidateLayout === 'function') vfxInvalidateLayout();
    }
    flushPendingEnemyFloats(battleSnapshot);
    return;
  }
  // 站位也要納入簽章：敵人身分沒變但格位變了（例如新一波剛好同名同級）仍須重建 DOM。
  var enemySignature = enemies.map(function (enemy, index) {
    return enemyFloatLayerId(enemy, index) + ':' + enemy.name + ':' + enemy.level + ':' + enemyRankOf(enemy) + ':' + enemyCellSignature(enemy);
  }).join('|');
  var partyHtml = guideHtml;
  for (var ei = 0; ei < enemies.length; ei++) {
    var enemy = enemies[ei];
    var icon = (enemy.img && !enemy.imgFailed)
      ? '<img src="images/' + enemy.img + '" class="cb-icon monster" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline\';">' +
      '<span class="enemy-emoji-fallback" style="display:none;">' + (enemy.emoji || '👾') + '</span>'
      : '<span class="enemy-emoji-fallback">' + (enemy.emoji || '👾') + '</span>';
    var enemyHp = clamp(enemy.hp / enemy.maxHp * 100, 0, 100);
    var enemyShield = enemy.shield > 0.5 ? '<span class="enemy-shield">+' + fmt(Math.max(0, enemy.shield)) + '</span>' : '';
    var rank = enemyRankOf(enemy);                       // normal / elite / boss
    var rankIcon = ENEMY_RANK_ICONS[rank] || '';         // 小怪無圖示、菁英骷髏頭、BOSS 專屬圖標
    partyHtml += '<div class="enemy-card enemy-rank-' + rank + '"' + enemyCellStyle(enemy) + '>' +
      '<div class="float-layer" id="' + enemyFloatLayerId(enemy, ei) + '"></div>' +
      '<div class="cb-level">' + (rankIcon ? '<span class="enemy-rank-icon">' + rankIcon + '</span>' : '') + 'Lv.' + enemy.level + '</div>' + icon +
      '<div class="enemy-name">' + (enemy.attr && ELEM_INFO[enemy.attr] ? ELEM_INFO[enemy.attr].emoji : '') + enemy.name + '</div>' +
      '<div class="enemy-hp hp-bar"><div class="hp-fill monster" style="width:' + enemyHp + '%"></div><span class="hp-text">' + fmt(Math.max(0, enemy.hp)) + enemyShield + ' / ' + fmt(enemy.maxHp) + '</span></div>' +
      '<div class="enemy-status" data-enemy-buff-tip data-enemy-index="' + ei + '">' + entStatus(enemy) + '</div></div>';
  }
  // 只有換波、敵人數量或敵人身分變化時才重建 DOM；避免刪除尚未播完的傷害浮字。
  if (party.getAttribute('data-enemy-signature') !== enemySignature) {
    rebuildEnemyParty(party, partyHtml);
    party.setAttribute('data-enemy-signature', enemySignature);
    UI.battleLayoutDirty = true;
    if (typeof vfxInvalidateLayout === 'function') vfxInvalidateLayout();
  }
  if (UI.battleLayoutDirty) {
    fitEnemyNames(party);
    UI.battleLayoutDirty = false;
  }
  var cards = party.querySelectorAll('.enemy-card');
  var recentEnemyDamageFloats = document.querySelectorAll ? document.querySelectorAll('.enemy-hit-float') : [];
  var recentEnemyDamageAt = Date.now();
  for (var ci = 0; ci < cards.length && ci < enemies.length; ci++) {
    var card = cards[ci];
    var liveEnemy = enemies[ci];
    // 死亡卡片會保留到 deathClearCd 結束；淡出期間不要再用後續快照把
    // 血條／文字重設為 0，也不要重播致死血條動畫，避免畫面中途閃動。
    if (liveEnemy.hp <= 0 && card.classList.contains('is-dead')) continue;
    var fill = card.querySelector('.enemy-hp .hp-fill');
    var hpText = card.querySelector('.enemy-hp .hp-text');
    var status = card.querySelector('.enemy-status');
    var liveEnemyFloatId = enemyFloatLayerId(liveEnemy, ci);
    var instantKillFloat = liveEnemy.hp <= 0 && hasRecentEnemyDamageFloat(liveEnemyFloatId, recentEnemyDamageFloats, recentEnemyDamageAt);
    if (instantKillFloat) {
      animatePendingEnemyKill(liveEnemy, liveEnemyFloatId, 'dmg enemy-attack', battleSnapshot, card);
    } else {
      setStyleIfChanged(fill, 'width', clamp(liveEnemy.hp / liveEnemy.maxHp * 100, 0, 100) + '%');
    }
    setHtmlIfChanged(hpText, fmt(Math.max(0, liveEnemy.hp)) + (liveEnemy.shield > 0.5 ? '<span class="enemy-shield">+' + fmt(Math.max(0, liveEnemy.shield)) + '</span>' : '') + ' / ' + fmt(liveEnemy.maxHp));
    if (status) {
      if (status.getAttribute('data-enemy-index') !== String(ci)) status.setAttribute('data-enemy-index', String(ci));
      setHtmlIfChanged(status, entStatus(liveEnemy));
    }
    if (liveEnemy.hp > 0) card._deathFadeStartedAt = 0;
    else if (!card.classList.contains('is-dead')) card._deathFadeStartedAt = Date.now();
    // Worker 不會為死亡倒數的每個 tick 都送 Snapshot；只切一次 class，交由 CSS 連續淡出。
    // float-layer 不參與動畫，讓擊殺傷害字在敵人本體淡出期間完整播完。
    card.classList.toggle('is-dead', liveEnemy.hp <= 0);
  }
  flushPendingEnemyFloats(battleSnapshot);
}


function isInternalServer() {
  var loc = (typeof window !== 'undefined' && window.location) || (typeof location !== 'undefined' && location);
  if (!loc) return false;
  var host = loc.hostname || '';
  var proto = loc.protocol || '';
  if (proto === 'file:') return true;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === '[::1]') return true;
  if (/^192\.168\.\d+\.\d+$/.test(host) || /^10\.\d+\.\d+\.\d+$/.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.test')) return true;
  return false;
}

function itemMatchesKeyword(it, keyword) {
  if (!it || !keyword) return true;
  var kw = String(keyword).trim().toLowerCase();
  if (!kw) return true;

  // 1. 檢查裝備名稱
  if (it.name && it.name.toLowerCase().indexOf(kw) !== -1) return true;

  // 2. 檢查部位與武器類型
  if (it.slot && typeof SLOT_INFO !== 'undefined' && SLOT_INFO[it.slot]) {
    if (SLOT_INFO[it.slot].name && SLOT_INFO[it.slot].name.toLowerCase().indexOf(kw) !== -1) return true;
  }
  if (it.weaponType && typeof WEAPON_TYPES !== 'undefined' && WEAPON_TYPES[it.weaponType]) {
    if (WEAPON_TYPES[it.weaponType].name && WEAPON_TYPES[it.weaponType].name.toLowerCase().indexOf(kw) !== -1) return true;
  }

  // 3. 檢查詞條 (Affixes)
  if (Array.isArray(it.affixes)) {
    for (var i = 0; i < it.affixes.length; i++) {
      var a = it.affixes[i];
      if (!a) continue;
      if (typeof AFFIX_POOL !== 'undefined' && AFFIX_POOL[a.key]) {
        var def = AFFIX_POOL[a.key];
        if (def.name && def.name.toLowerCase().indexOf(kw) !== -1) return true;
      }
      if (a.key && a.key.toLowerCase().indexOf(kw) !== -1) return true;
    }
  }

  // 4. 檢查傳奇特效 (it.passive)
  if (it.passive) {
    if (typeof PASSIVE_POOL !== 'undefined' && PASSIVE_POOL[it.passive.key]) {
      var pDef = PASSIVE_POOL[it.passive.key];
      if (pDef.name && pDef.name.toLowerCase().indexOf(kw) !== -1) return true;
      if (pDef.desc && pDef.desc.toLowerCase().indexOf(kw) !== -1) return true;
    }
    if (typeof passiveLine === 'function') {
      var pText = passiveLine(it, it.passive);
      if (pText && pText.toLowerCase().indexOf(kw) !== -1) return true;
    }
    if (it.passive.key && it.passive.key.toLowerCase().indexOf(kw) !== -1) return true;
  }

  // 5. 檢查神鑄創世特效 (it.godPassives)
  if (Array.isArray(it.godPassives) && typeof GODFORGE_POOL !== 'undefined') {
    for (var j = 0; j < it.godPassives.length; j++) {
      var gp = it.godPassives[j];
      var gDef = GODFORGE_POOL[gp.key];
      if (gDef) {
        if (gDef.name && gDef.name.toLowerCase().indexOf(kw) !== -1) return true;
        if (gDef.desc && gDef.desc.toLowerCase().indexOf(kw) !== -1) return true;
      }
      if (gp.key && gp.key.toLowerCase().indexOf(kw) !== -1) return true;
    }
  }

  // 6. 檢查附魔 (it.enchants)
  var enchants = typeof itemEnchants === 'function' ? itemEnchants(it) : (it.enchants || []);
  if (Array.isArray(enchants)) {
    for (var k = 0; k < enchants.length; k++) {
      var en = enchants[k];
      if (!en) continue;
      if (typeof ENCHANTS !== 'undefined' && ENCHANTS[en.key]) {
        var eDef = ENCHANTS[en.key];
        if (eDef.name && eDef.name.toLowerCase().indexOf(kw) !== -1) return true;
      }
      if (typeof enchantLine === 'function') {
        var eText = enchantLine(it, en);
        if (eText && eText.toLowerCase().indexOf(kw) !== -1) return true;
      }
    }
  }

  return false;
}

var invKeywordDebounceTimer = null;

function updateInventoryKeywordFilter() {
  var box = $id('inventory-grid');
  if (!box) return;
  var kwInput = $id('inv-keyword-filter');
  var isInternal = isInternalServer();
  if (kwInput) {
    kwInput.style.display = isInternal ? 'inline-block' : 'none';
  }
  var filterKeyword = (kwInput && kwInput.style.display !== 'none') ? kwInput.value.trim() : '';
  var priorKeyword = UI.inventoryKeywordQuery || '';
  UI.inventoryKeywordQuery = filterKeyword;
  if (filterKeyword) {
    var fullSnapshot = peekUiPanelData('inv');
    if (!inventoryViewHasFullDetails(fullSnapshot)) {
      requestPanelData('inv', true, { full: true });
      return;
    }
  } else if (priorKeyword) {
    delete UI_WORKER_STATE.panelQueued.inv;
    requestPanelData('inv', true);
    return;
  }
  renderInventory();
}

function onKeywordFilterInput() {
  if (invKeywordDebounceTimer) clearTimeout(invKeywordDebounceTimer);
  invKeywordDebounceTimer = setTimeout(function () {
    updateInventoryKeywordFilter();
  }, 40);
}

/* ---- 裝備分頁 ---- */
function ancientStarBadgeHTML(it) {
  var count = getItemAncientCount(it);
  if (!count) return '';
  var shown = Math.min(7, count);
  var stars = '';
  for (var i = 0; i < shown; i++) stars += '<span class="ancient-star">✡</span>';
  var overlapClass = shown > 4 ? ' overlap' : '';
  return '<span class="ancient-star-badge' + overlapClass + '" aria-label="太古詞條 ' + count + ' 條">' + stars + '</span>';
}
function itemIconFile(it, info) {
  var weaponIcon = (typeof weaponIconForItem === 'function') ? weaponIconForItem(it) : null;
  return weaponIcon || (info && info.icon) || '';
}
function itemCellHTML(it, source, extraClass, pendingKey) {
  var r = RARITIES[it.rarity];
  var effClass = (it.rarity === 6) ? ' eff-mythic' : (it.rarity >= GODFORGED_IDX ? ' eff-godforged' : (it.rarity === 7 ? ' eff-genesis' : ''));
  var info = SLOT_INFO[it.slot];
  var iconFile = itemIconFile(it, info);
  var iconHtml = iconFile ? '<img src="images/' + iconFile + '" class="item-icon">' : '<span class="ic-emoji">' + info.emoji + '</span>';
  // data-eqslots：此「實例」可裝入的欄位（武器依類型而異），供選取比對用
  var eqSlots = (typeof equipSlotsForItem === 'function') ? equipSlotsForItem(it).join(',') : it.slot;
  return '<div class="item-cell' + effClass + (extraClass || '') + '" data-id="' + it.id + '" data-src="' + source + '" data-slot="' + it.slot + '" data-eqslots="' + eqSlots + '"' +
    (pendingKey ? pendingUiButtonAttributes(pendingKey) : '') + ' ' +
    'style="border-color:' + r.color + ';box-shadow:inset 0 0 12px ' + r.color + '33">' +
    iconHtml +
    ancientStarBadgeHTML(it) +
    (it.upgrade ? '<span class="ic-up">+' + it.upgrade + '</span>' : '') +
    (itemEnchants(it).length ? '<span class="ic-enc">' + (ENCHANTS[itemEnchants(it)[0].key] || {}).emoji +
      (itemEnchants(it).length > 1 ? '×' + itemEnchants(it).length : '') + '</span>' : '') +
    (it.locked ? '<span class="ic-lock">🔒</span>' : '') +
    (it.synthesized ? '<span class="ic-syn">✦</span>' : '') +
    '<span class="ic-lv">' + it.level + '</span>' +
    '</div>';
}

/* ---- 格線增量更新 ----
   背包格線原本每次都整份 `innerHTML` 重建。實測後期背包 934 格：
   字串組裝 2.6 ms、建立節點 39 ms，接著 applyInventoryVisibleRows 又付 106 ms
   （整份重建讓版面失效，之後第一次讀取就強制重排），單次 renderInventory 約 210 ms。
   戰鬥中每掉一件裝備就重建一次，玩家按鈕點下去剛好撞上，就是「半秒才有反應」，
   而且背包越滿越慢——100 格 12 ms、900 格 190 ms。

   改成逐格比對：把該格產生的 HTML 當成指紋掛在節點上，指紋沒變就完全不碰那個節點。
   掉一件裝備＝新增一格，其餘九百多格原封不動，版面也不會整份失效。

   ⚠️ 選取態（selected / dimmed / inventory-selection-match）**不可**寫進指紋——
   那三個 class 由 updateSelectionUI() 在每次渲染後統一重貼；寫進指紋的話，
   單純換個選取就會讓大量格子指紋改變而整份重建，等於白做。 */
var _itemCellFactory = null;

function itemCellNodeFromHtml(html) {
  if (!_itemCellFactory) _itemCellFactory = document.createElement('div');
  _itemCellFactory.innerHTML = html;
  var node = _itemCellFactory.firstElementChild;
  if (!node) return null;
  _itemCellFactory.removeChild(node);
  node._cellHtml = html;
  return node;
}

/* 測試替身的 DOM（tests/init-ui-smoke.test.cjs）沒有節點層級 API：
   偵測不到就退回整份寫入，行為與改動前完全一致。 */
function supportsIncrementalCells(box) {
  return !!box && box.firstElementChild !== undefined &&
    typeof box.insertBefore === 'function' &&
    typeof box.removeChild === 'function' &&
    typeof box.replaceChild === 'function' &&
    typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/* keys[i] 是第 i 格的識別（裝備用 item.id），htmls[i] 是它現在該長的樣子。
   兩個陣列等長，順序即畫面順序。 */
function syncItemGridCells(box, keys, htmls) {
  if (!box) return;
  if (!supportsIncrementalCells(box)) { box.innerHTML = htmls.join(''); return; }

  var existing = Object.create(null);
  var scan = box.firstElementChild;
  while (scan) {
    if (scan._cellKey && !existing[scan._cellKey]) existing[scan._cellKey] = scan;
    scan = scan.nextElementSibling;
  }

  var cursor = box.firstElementChild;
  for (var i = 0; i < keys.length; i++) {
    var node = existing[keys[i]];
    // 認領後就從表上劃掉：萬一同一個 id 出現兩次，第二次要另外建節點，
    // 而不是把第一次那顆搬過來（那會讓畫面少一格，比重複顯示更難察覺）。
    if (node) delete existing[keys[i]];
    if (node && node._cellHtml !== htmls[i]) {
      var replacement = itemCellNodeFromHtml(htmls[i]);
      if (replacement) {
        replacement._cellKey = keys[i];
        box.replaceChild(replacement, node);
        if (cursor === node) cursor = replacement;
        node = replacement;
      }
    }
    if (!node) {
      node = itemCellNodeFromHtml(htmls[i]);
      if (!node) continue;
      node._cellKey = keys[i];
    }
    // 位置對就往前走，位置不對就把它搬過來；搬動不影響 cursor 自己的位置。
    if (node === cursor) cursor = cursor.nextElementSibling;
    else box.insertBefore(node, cursor);
  }

  // 尾端剩下的都是這次不需要的（被移除的裝備、上一輪的提示文字、虛擬捲動墊片）
  while (cursor) {
    var next = cursor.nextElementSibling;
    box.removeChild(cursor);
    cursor = next;
  }
}

function renderEquip() {
  var equipSnapshot = uiEquipPanelSnapshot();
  var headerSnapshot = uiHeaderPanelSnapshot();
  if (!equipSnapshot || !headerSnapshot || !headerSnapshot.player) return;
  var box = $id('equip-grid');
  var h = '';
  var eq = equipViewEquipment(equipSnapshot);
  SLOT_LIST.forEach(function (slot) {
    var it = eq[slot];
    var info = SLOT_INFO[slot];
    // A two-handed weapon occupies the main-hand slot in the data model, but
    // the off-hand cell should still show the same weapon as a visual cue.
    var twoHandDuplicate = !it && slot === 'weapon2' &&
      typeof isTwoHandItem === 'function' && isTwoHandItem(eq.weapon);
    if (twoHandDuplicate) it = eq.weapon;
    if (it) {
      var r = RARITIES[it.rarity];
      var effClass = (it.rarity === 6) ? ' eff-mythic' : (it.rarity >= GODFORGED_IDX ? ' eff-godforged' : (it.rarity === 7 ? ' eff-genesis' : ''));
      var iconFile = itemIconFile(it, info);
      var iconHtml = iconFile ? '<img src="images/' + iconFile + '" class="eq-icon">' : '<div class="eq-emoji">' + info.emoji + '</div>';
      var flashHtml = equipFlashActive(slot) ? '<span class="equip-flash-overlay" aria-hidden="true"></span>' : '';
      h += '<div class="eq-slot filled' + effClass + (twoHandDuplicate ? ' twohand-duplicate' : '') + ' slot-' + slot + '" data-id="' + it.id + '" data-src="equip" data-slot="' + slot + '" style="border-color:' + r.color + '; box-shadow: inset 0 0 15px ' + r.color + '40">' +
        iconHtml + ancientStarBadgeHTML(it) + flashHtml + '</div>';
    } else {
      // 副手欄被主手雙手武器連帶佔用：加佔用標記（仍可點選，改裝副手會自動卸下雙手武器）
      var blocked2h = (typeof slotBlockedByTwoHand === 'function') && slotBlockedByTwoHand(eq, slot);
      var iconHtml = info.icon ? '<img src="images/' + info.icon + '" class="eq-icon dim">' : '<div class="eq-emoji dim">' + info.emoji + '</div>';
      h += '<div class="eq-slot empty slot-' + slot + (blocked2h ? ' twohand-occupied' : '') + '" data-slot="' + slot + '">' + iconHtml +
        (blocked2h ? '<span class="th-occupied-mark">⛓️</span>' : '') + '</div>';
    }
  });
  box.innerHTML = h;
  renderEquipSetTabs(equipSnapshot, headerSnapshot);
  renderDetail();
}

function equipFlashActive(slot) {
  var until = UI.equipFlashSlots && UI.equipFlashSlots[slot];
  if (!until) return false;
  if (until <= Date.now()) {
    delete UI.equipFlashSlots[slot];
    return false;
  }
  return true;
}

function triggerEquipFlash(slotKey, item) {
  if (!slotKey) return;
  var slots = [slotKey];
  if (slotKey === 'weapon' && typeof isTwoHandItem === 'function' && isTwoHandItem(item)) {
    slots.push('weapon2');
  }
  var until = Date.now() + 2000;
  slots.forEach(function (slot) { UI.equipFlashSlots[slot] = until; });
  UI.dirty.equip = true;
  if (UI.equipFlashTimer) clearTimeout(UI.equipFlashTimer);
  UI.equipFlashTimer = setTimeout(function () {
    Object.keys(UI.equipFlashSlots).forEach(function (slot) {
      if (UI.equipFlashSlots[slot] <= Date.now()) delete UI.equipFlashSlots[slot];
    });
    UI.equipFlashTimer = null;
    UI.dirty.equip = true;
  }, 2050);
}

// 裝備欄下方三套切頁＋確定切換
function renderEquipSetTabs(equipSnapshot, headerSnapshot) {
  var box = $id('equip-set-tabs');
  if (!box) return;
  equipSnapshot = equipSnapshot || uiEquipPanelSnapshot();
  headerSnapshot = headerSnapshot || uiHeaderPanelSnapshot();
  if (!equipSnapshot || !Array.isArray(equipSnapshot.sets)) { box.innerHTML = ''; return; }
  var active = equipSnapshot.equipActive || 0;
  var view = (typeof equipSnapshot.equipView === 'number') ? equipSnapshot.equipView : active;
  var playerLevel = headerSnapshot && headerSnapshot.player ? headerSnapshot.player.level : 0;
  var playerReincarnations = headerSnapshot && headerSnapshot.player ? headerSnapshot.player.reincarnations : 0;
  function unlocked(index) {
    return typeof equipmentSetUnlockedAtLevel === 'function'
      ? equipmentSetUnlockedAtLevel(index, playerLevel, playerReincarnations)
      : index < equipSnapshot.sets.length;
  }
  var h = '<div class="eqset-tabrow">';
  for (var i = 0; i < equipSnapshot.sets.length; i++) {
    if (!unlocked(i)) continue;
    var cls = 'eqset-tab' + (i === view ? ' viewing' : '') + (i === active ? ' active' : '');
    var defName = (typeof equipSetName === 'function') ? equipSetName(i) : ('第' + (i + 1) + '套');
    var custom = (Array.isArray(equipSnapshot.equipSetNames) && equipSnapshot.equipSetNames[i]) ? String(equipSnapshot.equipSetNames[i]).trim() : '';
    h += '<div class="eqset-tabwrap">' +
      '<div class="eqset-name"' + (custom ? '' : ' data-empty="1"') + '>' + esc(custom) + '</div>' +
      '<button class="' + cls + '" data-eqset="' + i + '">' + defName +
      (i === active ? '<span class="eqset-badge">使用中</span>' : '') + '</button>' +
      '<span class="eqset-rename" data-eqset-rename="' + i + '" title="為這套改名稱">✏️</span>' +
      '</div>';
  }
  h += '</div>';
  if (unlocked(view)) {
    var same = view === active;
    var viewLabel = equipSetViewLabel(equipSnapshot, view);
    h += '<button id="eqset-confirm" class="btn eqset-confirm"' + (same ? ' disabled' : '') + '>' +
      (same ? '目前使用中' : ('確定切換到「' + esc(viewLabel) + '」')) + '</button>';
  }
  box.innerHTML = h;
}

// 為某一套裝備改名稱（留空恢復預設「第X套」）；用遊戲通用彈窗（帶輸入框）
function renameEquipSet(idx) {
  var equipSnapshot = uiEquipPanelSnapshot();
  var headerSnapshot = uiHeaderPanelSnapshot();
  if (!equipSnapshot || !Array.isArray(equipSnapshot.sets)) return;
  idx = clamp(Math.floor(Number(idx) || 0), 0, equipSnapshot.sets.length - 1);
  if (typeof equipmentSetUnlockedAtLevel === 'function' &&
    !equipmentSetUnlockedAtLevel(
      idx,
      headerSnapshot && headerSnapshot.player ? headerSnapshot.player.level : 0,
      headerSnapshot && headerSnapshot.player ? headerSnapshot.player.reincarnations : 0
    )) return;
  var defName = (typeof equipSetName === 'function') ? equipSetName(idx) : ('第' + (idx + 1) + '套');
  var cur = (equipSnapshot.equipSetNames && equipSnapshot.equipSetNames[idx]) || '';
  showConfirmDialog('為「' + defName + '」設定自訂名稱（留空恢復預設）：', function (val) {
    var name = String(val == null ? '' : val).trim().slice(0, 12); // 上限 12 字
    sendUiCommand('player.renameEquipSet', { index: idx, name: name }, {
      keys: [nodePendingKey('equip-set:' + idx)],
      panels: ['equip']
    }).catch(function (error) {
      reportUiCommandFailure('裝備套改名', error, ['equip']);
    });
  }, {
    title: '裝備套改名', okText: '確定', cancelText: '取消',
    input: { value: cur, placeholder: '例：輸出套（留空恢復預設）', maxLength: 12 }
  });
}


function inventoryVisibleRows(totalRows, requestedRows) {
  var total = Math.max(INVENTORY_VISIBLE_ROWS_DEFAULT, Math.floor(Number(totalRows) || 0));
  var requested = Math.max(INVENTORY_VISIBLE_ROWS_DEFAULT, Math.floor(Number(requestedRows) || INVENTORY_VISIBLE_ROWS_DEFAULT));
  return Math.min(INVENTORY_VISIBLE_ROWS_MAX, total, requested);
}

/* 排數是**算**出來的，不是量出來的。

   原本逐格讀 offsetTop。這支剛好接在格線重建之後被呼叫，於是第一次讀取就強制整份文件
   重新版面計算，後面九百多次讀取再各自付一點錢——實測後期背包 934 格時單這一步 106 ms，
   佔整次 renderInventory 的一半。而它算出來的東西只是「有幾排」，用來夾住可視排數的
   CSS 變數而已。

   格子等高、沒有跨欄項目，所以 ceil(格數 ÷ 欄數) 與數 offsetTop 的相異值等價；
   欄數只需讀一次 grid-template-columns，不隨格數增加。 */
function inventoryGridRowCount(box) {
  if (!box) return 0;
  var cells = box.querySelectorAll('.item-cell');
  if (!cells.length) return 0;
  return Math.max(1, Math.ceil(cells.length / cachedInventoryGridColumnCount(box)));
}

/* ---- 欄數快取 ----
   inventoryGridColumnCount() 會讀 getComputedStyle，而這支剛好被排在「格線剛改完」之後，
   於是那一次讀取要付整份文件重排的錢。裝備頁與神鑄頁各掛一份九百多格的格線時，
   實測單這一次強制重排 43～61 ms——而它問的只是「一排幾格」。

   欄數只在容器寬度變動時才會變（視窗縮放、全螢幕切換、介面縮放），那些時機都會走到
   invalidateInventoryGridColumns()，所以快取不會過期。掉一件裝備不改變欄數。 */
function invalidateInventoryGridColumns() {
  var boxes = (typeof document !== 'undefined' && document.querySelectorAll)
    ? document.querySelectorAll('#inventory-grid, #forge-inventory-grid') : [];
  for (var i = 0; i < boxes.length; i++) boxes[i]._invGridColumns = 0;
}

function cachedInventoryGridColumnCount(box) {
  if (box._invGridColumns > 0) return box._invGridColumns;
  var columns = inventoryGridColumnCount(box);
  // 容器還沒有寬度時（分頁隱藏中）量到的是 1，不要把它記起來當成正解
  if (columns > 1) box._invGridColumns = columns;
  return columns;
}

function inventoryGridColumnCount(box) {
  if (!box) return 1;
  var computed = (typeof window !== 'undefined' && window.getComputedStyle)
    ? window.getComputedStyle(box) : null;
  var template = computed && computed.gridTemplateColumns;
  if (template && template !== 'none') {
    var columns = template.match(/\d+(?:\.\d+)?px/g);
    if (columns && columns.length) return columns.length;
  }
  var width = Number(box.clientWidth) || 0;
  var gap = computed ? (parseFloat(computed.columnGap) || INVENTORY_GRID_ROW_GAP) : INVENTORY_GRID_ROW_GAP;
  return Math.max(1, Math.floor((width + gap) / (58 + gap)));
}

function inventoryGridTotalRowCount(box) {
  if (!box) return 0;
  var stored = parseInt(box.getAttribute('data-inventory-total-rows') || '', 10);
  return isNaN(stored) ? inventoryGridRowCount(box) : stored;
}

function inventoryVirtualSpacerHTML(height) {
  if (!(height > 0)) return '';
  return '<div aria-hidden="true" style="grid-column: 1 / -1; height: ' + Math.ceil(height) + 'px; pointer-events: none;"></div>';
}

function applyInventoryVisibleRows(box) {
  if (!box) return;
  var totalRows = inventoryGridTotalRowCount(box);
  var rows = inventoryVisibleRows(totalRows, UI.inventoryVisibleRows);
  UI.inventoryVisibleRows = Math.max(INVENTORY_VISIBLE_ROWS_DEFAULT, Math.min(INVENTORY_VISIBLE_ROWS_MAX, UI.inventoryVisibleRows || INVENTORY_VISIBLE_ROWS_DEFAULT));
  box.style.setProperty('--inventory-visible-rows', rows);
  box.style.setProperty('--inventory-visible-height', (rows * INVENTORY_GRID_ROW_HEIGHT + (rows - 1) * INVENTORY_GRID_ROW_GAP) + 'px');
}

/* itemMatchesEquipSlot() 已移除：唯一的呼叫點是 renderInventory 內自己算 dimmed 的那段，
   而那段已交還給 updateSelectionUI（它用 DOM 版的 cellMatchesEquipSlot，讀 data-eqslots）。 */

function renderInventory() {
  var invSnapshot = uiInventoryPanelSnapshot();
  var headerSnapshot = uiHeaderPanelSnapshot();
  if (!invSnapshot || !headerSnapshot || !headerSnapshot.player) return;
  var cap = Number(invSnapshot.cap) || 0;
  var player = headerSnapshot.player;
  var btn = $id('inv-expand');
  var expandPending = typeof isUiCommandPending === 'function' &&
    isUiCommandPending(nodePendingKey('inv-expand'));
  if (btn) {
    if (cap >= INVENTORY_MAX) {
      btn.textContent = '➕ 已達上限 (' + INVENTORY_MAX + ')';
      btn.disabled = true;
    } else {
      btn.innerHTML = '➕ 擴充 (' + fmt(inventoryExpandCost(player.invUpgrades || 0)) + '<img src="images/icon_gold.png" class="res-icon">)';
      btn.disabled = expandPending;
    }
  }

  var box = $id('inventory-grid');
  $id('inv-count').textContent = invSnapshot.count + '/' + cap;

  var kwInput = $id('inv-keyword-filter');
  var isInternal = isInternalServer();
  if (kwInput) {
    kwInput.style.display = isInternal ? 'inline-block' : 'none';
  }
  var filterKeyword = (kwInput && isInternal && kwInput.style.display !== 'none') ? kwInput.value.trim() : '';

  var inventoryItems = inventoryViewItems(invSnapshot);
    // The inventory cap is 1000 cells; keeping the complete grid mounted is
    // both small enough for the UI and avoids virtual-window reordering when
    // the user drags the scrollbar to the bottom.
    var virtualize = false;
  if (!inventoryItems.length) {
    box.removeAttribute('data-inventory-total-rows');
    box.innerHTML = '<div class="hint" style="grid-column: 1 / -1; padding: 10px;">背包是空的。戰鬥掉落的裝備會先進入生產線輸送帶，「保留」的會送到這裡。</div>';
  } else {
    var ancientFilterSelect = $id('inv-ancient-filter');
    var filterAncient = ancientFilterSelect ? ancientFilterSelect.value : '';
    var filterSelect = $id('inv-rarity-filter');
    var filterRarity = filterSelect ? filterSelect.value : '';
    var filterCacheKey = virtualize
      ? [UI_WORKER_STATE.panelVersions.inv || 0, filterKeyword, filterAncient, filterRarity, UI.inventorySortIndex].join('\u001f')
      : null;
    var displayedItems = null;
    if (virtualize && UI.inventoryFilterCacheKey === filterCacheKey && UI.inventoryFilterCacheItems !== null) {
      displayedItems = UI.inventoryFilterCacheItems;
    } else {
      displayedItems = inventoryItems;
      if (filterAncient !== '' || filterRarity !== '') {
        displayedItems = inventoryItems.filter(function (it) {
          if (filterAncient !== '') {
            var aCount = getItemAncientCount(it);
            var reqCount = parseInt(filterAncient, 10);
            if (filterAncient === '7') {
              if (aCount < 7) return false;
            } else {
              if (aCount !== reqCount) return false;
            }
          }
          if (filterRarity !== '') {
            var rVal = parseInt(filterRarity, 10);
            if (it.rarity !== rVal) return false;
          }
          return true;
        });
      }
      if (virtualize) {
        UI.inventoryFilterCacheKey = filterCacheKey;
        UI.inventoryFilterCacheItems = displayedItems;
      }
    }
    if (!displayedItems.length) {
      box.removeAttribute('data-inventory-total-rows');
      box.innerHTML = '<div class="hint" style="grid-column: 1 / -1; padding: 10px;">沒有符合篩選條件的裝備。</div>';
    } else {
      if (virtualize && (!box.clientWidth || !box.offsetParent)) {
        applyInventoryVisibleRows(box);
        return;
      }
      /* 欄數、捲動位置與可視高度全都只有虛擬捲動才用得到，而它們**每一個都是版面讀取**：
         在寫入 DOM 的前後讀取會強制瀏覽器把整份文件重新排版一次。非虛擬路徑不需要這些
         數字，就不要付這筆錢——格線改成增量更新之後，捲動位置本來就不會被動到。 */
      var columns = 0, totalRows = 0, rows = 0, startRow = 0;
      if (virtualize) {
        columns = inventoryGridColumnCount(box);
        totalRows = Math.max(1, Math.ceil(displayedItems.length / columns));
        rows = inventoryVisibleRows(totalRows, UI.inventoryVisibleRows);
        var previousScrollTop = box.scrollTop;
        var maxScrollTop = Math.max(0, box.scrollHeight - box.clientHeight);
        var wasAtScrollEnd = previousScrollTop >= maxScrollTop - 1;
        if (totalRows > rows) {
          var rowHeight = INVENTORY_GRID_ROW_HEIGHT + INVENTORY_GRID_ROW_GAP;
          startRow = wasAtScrollEnd
            ? totalRows - rows
            : Math.min(Math.max(0, Math.floor(previousScrollTop / rowHeight)), totalRows - rows);
        }
      }
      var firstItem = virtualize ? startRow * columns : 0;
      var lastItem = virtualize ? Math.min(displayedItems.length, (startRow + rows) * columns) : displayedItems.length;

      /* 這裡刻意不再算 selected / dimmed：那三個 class 由 renderInventory 尾端的
         updateSelectionUI() 統一重貼（它是選取態的唯一權威，本來就會覆蓋這裡寫的值）。
         留在格子 HTML 裡會讓「換個選取」變成「整份格線指紋改變」，增量更新就失效了。 */
      var cellKeys = [];
      var cellsHtmlList = [];
      for (var ii = firstItem; ii < lastItem; ii++) {
        var it = displayedItems[ii];
        var dimClass = '';
        if (filterKeyword !== '') {
          var renderedItem = inventoryViewItem(invSnapshot, it.id, true);
          if (!renderedItem || !itemMatchesKeyword(renderedItem, filterKeyword)) {
            dimClass = ' item-cell-dimmed';
          }
        }
        cellKeys.push(it.id);
        cellsHtmlList.push(itemCellHTML(it, 'inv', dimClass, itemPendingKey(it.id)));
      }
      if (virtualize) box.setAttribute('data-inventory-total-rows', String(totalRows));
      else box.removeAttribute('data-inventory-total-rows');
      if (virtualize) {
        var virtualRowHeight = INVENTORY_GRID_ROW_HEIGHT + INVENTORY_GRID_ROW_GAP;
        var topHeight = startRow * virtualRowHeight - INVENTORY_GRID_ROW_GAP;
        var remainingRows = totalRows - startRow - rows;
        var bottomHeight = remainingRows * virtualRowHeight - (remainingRows > 0 ? INVENTORY_GRID_ROW_GAP : 0);
        box.innerHTML = inventoryVirtualSpacerHTML(topHeight) + cellsHtmlList.join('') +
          inventoryVirtualSpacerHTML(bottomHeight);
        box.scrollTop = wasAtScrollEnd ? box.scrollHeight : previousScrollTop;
      } else {
        syncItemGridCells(box, cellKeys, cellsHtmlList);
      }
    }
  }
  applyInventoryVisibleRows(box);
  if (UI.inventoryScrolling) updateSelectionUI();
  else renderDetail();
}

/* 僅搜尋背包與裝備欄。刻意不含神鑄法陣槽位：detailAction 的操作（裝備/強化/洗煉）
   以此為來源依據，若涵蓋法陣槽位，殘留的 UI.sel 會讓槽內裝備被再次穿上造成複製。 */
function findItemById(id, detailed) {
  if (!id) return null;
  var invSnapshot = peekUiPanelData('inv');
  var inventoryItem = inventoryViewItem(invSnapshot, id, !!detailed);
  if (inventoryItem) return inventoryItem;
  var equipSnapshot = peekUiPanelData('equip');
  var eq = equipViewEquipment(equipSnapshot);
  for (var s in eq) if (eq[s] && eq[s].id === id) return eq[s];
  return null;
}

function findSelItem() {
  if (!UI.sel) return null;
  return findItemById(UI.sel.id, UI.sel.source === 'inv');
}


function renderDetail() {
  hideAffixPool();
  var pane = $id('detail-pane');
  var it = findSelItem();
  var headerSnapshot = uiHeaderPanelSnapshot();
  var invSnapshot = uiInventoryPanelSnapshot();
  var gemsSnapshot = uiGemsPanelSnapshot();
  var player = headerSnapshot && headerSnapshot.player;
  if (UI.sel && UI.sel.source === 'inv' && UI.sel.id && (!invSnapshot || !invSnapshot.details || !invSnapshot.details[UI.sel.id])) {
    requestPanelData('inv', true, { detailIds: [UI.sel.id] });
  }
  updateSelectionUI();
  if (!it) {
    if (UI.sel && UI.sel.source === 'inv' && UI.sel.id) {
      requestPanelData('inv', true, { detailIds: [UI.sel.id] });
      pane.innerHTML = '<div class="hint">正在載入裝備詳情…</div>';
    } else {
      pane.innerHTML = '<div class="hint">點選裝備查看詳情</div>';
    }
    pane.classList.remove('has-detail');
    var actionBar = $id('equip-action-bar');
    if (actionBar) {
      // 保留按鈕列高度（min-height），避免選取/取消選取時背包區上下跳動
      actionBar.innerHTML = '';
      actionBar.style.display = 'flex';
    }
    var matPanelEmpty = $id('equip-material-panel');
    if (matPanelEmpty) matPanelEmpty.innerHTML = '';
    return;
  }
  var cost = upgradeCost(it);
  var h = itemDetailHTML(it, null, {
    gold: player && player.gold,
    essence: player && player.essence
  });
  var actionsHtml = '';
  var pendingKey = itemPendingKey(it.id);
  if (UI.sel.source === 'inv') {
    actionsHtml += '<button class="btn" data-act="equip"' + pendingUiButtonAttributes(pendingKey) + '>裝備</button>';
    actionsHtml += '<button class="btn warn" data-act="salvage"' + pendingUiButtonAttributes(pendingKey) + '>分解</button>';
    if (SYNTHESIS_ENABLED) actionsHtml += '<button class="btn" data-act="tosynth">送合成區</button>';
  } else {
    actionsHtml += '<button class="btn" data-act="unequip"' + pendingUiButtonAttributes(pendingKey) + '>卸下</button>';
  }
  var enoughUpGold = player && player.gold >= cost.gold;
  var enoughUpScrap = player && player.scrap >= cost.scrap;
  var upGoldHtml = '<span' + (enoughUpGold ? '' : ' style="color:#fca5a5"') + '><img src="images/icon_gold.png" class="res-icon"> ' + fmt(cost.gold) + '</span>';
  var upScrapHtml = '<span' + (enoughUpScrap ? '' : ' style="color:#fca5a5"') + '><img src="images/icon_scrap.png" class="res-icon"> ' + fmt(cost.scrap) + '</span>';
  var upTip = '需要：' + upGoldHtml + ' &nbsp;' + upScrapHtml;
  actionsHtml += '<button class="btn act-btn-tooltip" data-act="upgrade" data-tip="' + esc(upTip) + '"' +
    pendingUiButtonAttributes(pendingKey) + '>強化</button>';

  actionsHtml += '<button class="btn" data-act="lock"' + pendingUiButtonAttributes(pendingKey) + '>' + (it.locked ? '解鎖' : '鎖定') + '</button>';
  // 右側素材面板：可用寶石／附魔書改為小圖示，完整名稱、數值與持有量由滑鼠提示顯示
  var matHtml = '';
  if (it.sockets.indexOf(null) >= 0) {
    var gemIcons = [];
    for (var gt in GEM_TYPES) {
      var total = 0, hi = 0;
      for (var lv = GEM_FORGE_MAX_LEVEL; lv >= 1; lv--) {
        var n = gemsViewCount(gemsSnapshot, gt, lv);
        total += n;
        if (n && !hi) hi = lv;
      }
      if (!total) continue;
      var gdef = GEM_TYPES[gt];
      var gv = gdef.pct ? pctStr(gemStatValue(gt, hi)) : fmt(gemStatValue(gt, hi));
      gemIcons.push('<button class="equip-material-icon" data-gem-socket="' + gt + '" data-tip="' +
        esc(GEM_NAMES[hi] + gdef.name + ' ×' + gemsViewCount(gemsSnapshot, gt, hi) + '｜' + gdef.statName.replace('%', '') + ' +' + gv +
          '｜點擊鑲入空插槽（自動取最高等級）') + '">' + gdef.emoji + '</button>');
    }
    gemsViewFused(gemsSnapshot).forEach(function (fg) {
      gemIcons.push('<button class="equip-material-icon" data-gem-socket-fused="' + fg.id + '" data-tip="' +
        esc(fusedGemLabel(fg) + '｜雙屬性融合寶石，點擊鑲入空插槽') + '">🧬</button>');
    });
    matHtml += '<div class="equip-material-section">' +
      '<div class="equip-material-title">💎 可用寶石（點擊鑲嵌）</div>' +
      (gemIcons.length ? '<div class="equip-material-grid">' + gemIcons.join('') + '</div>'
        : '<div class="equip-material-empty">尚無寶石庫存</div>') +
      '</div>';
  }
  var itEns2 = itemEnchants(it);
  if (itEns2.length < enchantCapFor(it)) {
    var cat2 = enchantCatForType(it.slot);
    var bookIcons = [];
    for (var bk2 in ENCHANTS) {
      if (ENCHANTS[bk2].cat !== cat2) continue;
      var bn2 = player && player.books ? (player.books[bk2] || 0) : 0;
      if (!bn2) continue;
      var owned = itEns2.some(function (en2) { return en2.key === bk2; });
      bookIcons.push('<button class="equip-material-icon' + (owned ? ' dim-chip' : '') + '" data-book-enchant="' + bk2 + '" data-tip="' +
        esc(ENCHANTS[bk2].name + ' ×' + bn2 + '｜' + ENCHANTS[bk2].desc +
          '｜消耗 1 書＋<img src="images/icon_essence.png" class="res-icon" alt="精華"> ' + ENCHANT_ESSENCE_COST + ' 精華（庫存 ' + fmt(player ? player.essence : 0) + '）' +
          (owned ? '｜已附魔，僅可升級數值' : '')) + '">' + ENCHANTS[bk2].emoji + '</button>');
    }
    var catNames2 = { atk: '攻擊', def: '防禦', util: '功能' };
    matHtml += '<div class="equip-material-section">' +
      '<div class="equip-material-title">✨ 可用附魔書（點擊附魔）</div>' +
      '<div class="equip-material-subtitle">' + catNames2[cat2] + '類部位' +
      (bookIcons.length ? '' : '｜沒有可用的書（階段 8+ 掉落 / 高塔獎勵）') + '</div>' +
      (bookIcons.length ? '<div class="equip-material-grid">' + bookIcons.join('') + '</div>' : '') +
      '</div>';
  }
  pane.innerHTML = h;
  pane.classList.add('has-detail');
  var matPanel = $id('equip-material-panel');
  if (matPanel) matPanel.innerHTML = matHtml;
  var actionBar = $id('equip-action-bar');
  if (actionBar) {
    actionBar.innerHTML = actionsHtml;
    actionBar.style.display = 'flex';
  }
}

function equipSlotType(slot) {
  return (typeof slotTypeOf === 'function') ? slotTypeOf(slot) : slot;
}

function equipSlotMatches(itemSlot, equipSlot) {
  return !!itemSlot && !!equipSlot && equipSlotType(itemSlot) === equipSlotType(equipSlot);
}

// 物品格是否可裝入指定裝備欄：優先用 data-eqslots（實例可裝欄位，武器依類型而異），
// 無此屬性時退回部位種類比對
function cellMatchesEquipSlot(el, equipSlot) {
  var list = el.getAttribute('data-eqslots');
  if (list) return list.split(',').indexOf(equipSlot) >= 0;
  return equipSlotMatches(el.getAttribute('data-slot'), equipSlot);
}

function selectionSlotForItem(selItem) {
  if (UI.sel && (UI.sel.source === 'equip-slot' || UI.sel.source === 'equip')) {
    return UI.sel.slot || null;
  }
  if (selItem && UI.sel && UI.sel.source === 'inv') {
    var invSnapshot = uiInventoryPanelSnapshot();
    var equipSnapshot = uiEquipPanelSnapshot();
    return uiEquipTargetSlotFromSnapshot(selItem,
      (invSnapshot && invSnapshot.viewEquipment) || equipViewEquipment(equipSnapshot));
  }
  return null;
}

// An inventory panel detailIds response may contain only the item currently
// hovered, so the selected item's full object can be temporarily absent from
// `details`.  Grid highlighting only needs the summary (id/slot), not affixes.
function selectionItemForGrid(invSnapshot) {
  var item = findSelItem();
  if (item) return item;
  if (UI.sel && UI.sel.source === 'inv') {
    return inventoryViewItem(invSnapshot || uiInventoryPanelSnapshot(), UI.sel.id, false);
  }
  return null;
}

function selectionEquipSlotsForItem(selItem, selectedSlot) {
  if (!selectedSlot) return [];
  var slots = [selectedSlot];
  // 雙手武器實際只記在 weapon，但裝備欄會在 weapon2 顯示同一把武器的 duplicate。
  if (UI.sel && UI.sel.source === 'inv' && selectedSlot === 'weapon' &&
      typeof isTwoHandItem === 'function' && isTwoHandItem(selItem)) {
    slots.push('weapon2');
  }
  return slots;
}

// 同一件雙手武器會同時渲染在 weapon 與 weapon2；互點兩格時應轉移欄位選取，
// 只有再次點擊同一格才取消選取。
function selectFilledCell(cell) {
  var cid = cell.getAttribute('data-id');
  var cellSource = cell.getAttribute('data-src');
  var cellSlot = cell.getAttribute('data-slot');
  if (UI.sel && UI.sel.id === cid) {
    if (UI.sel.source === 'equip' && cellSource === 'equip' && UI.sel.slot !== cellSlot) {
      UI.sel.slot = cellSlot;
      UI.lastEquipSlot = cellSlot;
      return;
    }
    UI.sel = null;
    return;
  }
  UI.sel = { id: cid, source: cellSource };
  if (UI.sel.source === 'equip') {
    UI.lastEquipSlot = cellSlot;
    UI.sel.slot = cellSlot;
  }
}

function updateSelectionUI() {
  var selItem = selectionItemForGrid();
  var selectedSlot = selectionSlotForItem(selItem);
  var selectedEquipSlots = selectionEquipSlotsForItem(selItem, selectedSlot);
  var highlightInventoryBySlot = !!(UI.sel && (UI.sel.source === 'equip-slot' || UI.sel.source === 'equip'));
  var highlightEquipByInventory = !!(UI.sel && UI.sel.source === 'inv');

  document.querySelectorAll('.item-cell, .eq-slot').forEach(function (el) {
    el.classList.remove('selected', 'dimmed', 'inventory-selection-match');

    if (selectedSlot && selectedEquipSlots.indexOf(el.getAttribute('data-slot')) >= 0 && el.classList.contains('eq-slot')) {
      if (highlightEquipByInventory) {
        el.classList.add('inventory-selection-match');
      } else {
        el.classList.add('selected');
      }
    }

    if (!selItem) return;

    var elId = el.getAttribute('data-id');
    if (elId && elId === selItem.id && UI.sel && UI.sel.source === 'inv' && el.classList.contains('item-cell')) {
      el.classList.add('selected');
    } else if (el.classList.contains('item-cell') && UI.sel && UI.sel.source === 'inv') {
      var elSlot = el.getAttribute('data-slot');
      if (elSlot !== selItem.slot) {
        el.classList.add('dimmed');
      }
    }
  });

  if (!highlightInventoryBySlot || !selectedSlot) return;
  document.querySelectorAll('.item-cell').forEach(function (el) {
    if (!cellMatchesEquipSlot(el, selectedSlot)) {
      el.classList.add('dimmed');
    }
  });
}

function showFloatingText(btn, text, color) {
  var rect = btn.getBoundingClientRect();
  var el = document.createElement('div');
  el.textContent = text;
  el.style.position = 'fixed';
  el.style.left = (rect.left + rect.width / 2) + 'px';
  el.style.top = rect.top + 'px';
  el.style.transform = 'translate(-50%, -100%)';
  el.style.color = color;
  el.style.fontWeight = 'bold';
  el.style.textShadow = '0 0 4px #000';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '9999';
  el.style.transition = 'all 0.8s ease-out';
  document.body.appendChild(el);

  el.offsetHeight; // force reflow

  el.style.top = (rect.top - 40) + 'px';
  el.style.opacity = '0';

  setTimeout(function () {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 800);
}

/* ---- 生產線與合成 ---- */
function detailAction(act, actBtn) {
  var it = findSelItem();
  if (!it || act === 'tosynth') return;

  var headerSnapshot = uiHeaderPanelSnapshot();
  var player = headerSnapshot && headerSnapshot.player;
  if (player) {
    if (act === 'upgrade') {
      var upCost = typeof upgradeCost === 'function' ? upgradeCost(it) : null;
      if (upCost && ((player.gold || 0) < (upCost.gold || 0) || (player.scrap || 0) < (upCost.scrap || 0))) {
        if (actBtn) showFloatingText(actBtn, '材料不足', '#fca5a5');
        return;
      }
    } else if (act === 'reroll-affix') {
      var rrCost = typeof rerollCost === 'function' ? rerollCost(it) : null;
      if (rrCost && ((player.gold || 0) < (rrCost.gold || 0) || (player.essence || 0) < (rrCost.essence || 0))) {
        if (actBtn) showFloatingText(actBtn, '材料不足', '#fca5a5');
        return;
      }
    }
  }

  var commandName = null;
  var args = { itemId: it.id };
  var panels = ['inv', 'equip', 'header'];
  if (act === 'equip') {
    commandName = 'item.equip';
    var equipSnapshot = uiEquipPanelSnapshot();
    args.setIndex = equipSnapshot && typeof equipSnapshot.equipView === 'number' ? equipSnapshot.equipView : 0;
    // The Worker cannot see the main-thread selection state. Preserve the
    // slot the player selected (notably the right-hand ring) instead of
    // letting equipItem fall back to its default candidate order.
    var selectedEquipSlot = selectionSlotForItem(it);
    if (selectedEquipSlot) args.slotKey = selectedEquipSlot;
  } else if (act === 'unequip') {
    commandName = 'item.unequip';
    if (UI.sel && UI.sel.slot) args.slotKey = UI.sel.slot;
  } else if (act === 'salvage') {
    commandName = 'item.salvage';
    panels = ['inv', 'equip', 'header', 'gems'];
  } else if (act === 'upgrade') {
    commandName = 'item.upgrade';
  } else if (act === 'reroll-affix') {
    commandName = 'item.rerollAffix';
    args.affixKey = actBtn && actBtn.getAttribute('data-affix');
    if (!args.affixKey) return;
  } else if (act === 'lock') {
    commandName = 'item.setLock';
    args.locked = !it.locked;
    panels = ['inv', 'equip'];
  }
  if (!commandName) return;
  sendUiCommand(commandName, args, {
    keys: [itemPendingKey(it.id)],
    panels: panels
  }).then(function (result) {
    var resultError = typeof uiCommandResultError === 'function' ? uiCommandResultError(result) : null;
    if (resultError) {
      if (actBtn && (String(resultError).indexOf('資源不足') >= 0 || String(resultError).indexOf('不足') >= 0 || resultError === 'poor')) {
        showFloatingText(actBtn, '材料不足', '#fca5a5');
      } else {
        reportUiCommandFailure('裝備操作', resultError, panels);
      }
      return;
    }
    if (act === 'equip') {
      UI.sel = { id: it.id, source: 'equip', slot: args.slotKey || it.slot };
      triggerEquipFlash(args.slotKey || it.slot, it);
    }
    if (act === 'unequip') UI.sel = { id: it.id, source: 'inv' };
    if (act === 'salvage') UI.sel = null;
    if (act === 'upgrade' && actBtn) {
      var upgradeResult = result && hasOwnUiState(result, 'result') ? result.result : result;
      if (upgradeResult === 'ok') showFloatingText(actBtn, '升級成功', '#7dd3fc');
      else if (upgradeResult === 'fail') showFloatingText(actBtn, '升級失敗', '#fca5a5');
      else if (upgradeResult === 'poor') showFloatingText(actBtn, '材料不足', '#fca5a5');
    }
  }).catch(function (error) {
    if (actBtn && error && (String(error).indexOf('資源不足') >= 0 || String(error).indexOf('不足') >= 0)) {
      showFloatingText(actBtn, '材料不足', '#fca5a5');
    } else {
      reportUiCommandFailure('裝備操作', error, panels);
    }
  });
}
function salvageAllUnlocked(maxRarity, maxLevel, maxAncient) {
  var args = {};
  if (typeof maxRarity === 'number' && !isNaN(maxRarity)) args.maxRarity = maxRarity;
  if (typeof maxLevel === 'number' && !isNaN(maxLevel) && maxLevel > 0) args.maxLevel = maxLevel;
  if (typeof maxAncient === 'number' && !isNaN(maxAncient)) args.maxAncient = maxAncient;
  sendUiCommand('item.salvageBulk', args, {
    keys: [nodePendingKey('salvage-bulk')],
    panels: ['inv', 'equip', 'header', 'gems']
  }).then(function (result) {
    var resultError = typeof uiCommandResultError === 'function' ? uiCommandResultError(result) : null;
    if (resultError) {
      reportUiCommandFailure('批次分解', resultError, ['inv', 'equip', 'header', 'gems']);
      return;
    }
    UI.sel = null;
  }).catch(function (error) {
    reportUiCommandFailure('批次分解', error, ['inv', 'equip', 'header', 'gems']);
  });
}

/* ---- 生產線分頁 ---- */
/* 附魔書庫存＋強化節點（原生產線頁面板，已搬入熔爐分頁；renderNewForge 呼叫） */
function renderForgeExtras(factorySnapshot, headerSnapshot) {
  var f = factorySnapshot && factorySnapshot.factory;
  var player = headerSnapshot && headerSnapshot.player;
  if (!f || !player) return;
  var encBooks = $id('enc-books');
  if (encBooks) {
    var bookChips = [];
    for (var bk in player.books) {
      if (player.books[bk] > 0) bookChips.push('<span class="book-chip">' + ENCHANTS[bk].emoji + esc(ENCHANTS[bk].name) + ' x' + player.books[bk] + '</span>');
    }
    encBooks.innerHTML = bookChips.length ? bookChips.join('') : '<span class="hint">尚無附魔書（階段 8+ 掉落 / 高塔獎勵）</span>';
  }
  var encInfo = $id('enc-info');
  if (encInfo) encInfo.textContent = '精華庫存 ' + fmt(player.essence) + '（每次消耗 ' + ENCHANT_ESSENCE_COST + '）｜已附魔 ' + fmt(f.stats.enchanted) + ' 次';

}

function partIconHTML(key) {
  var iconMap = {
    scrapForge: ['icon_scrap.png'],
    goldSluice: ['icon_gold.png'],
    extractLens: ['icon_essence.png'],
    gemCollector: ['icon_gems.png'],
    ancientEssenceRate: ['icon_ancient_essence.png']
  };
  var icons = iconMap[key];
  if (!icons) return PART_TYPES[key] ? PART_TYPES[key].emoji : '';
  return icons.map(function (name) {
    return '<img src="images/' + name + '" class="part-material-icon" alt="">';
  }).join('');
}

// 將工廠設定同步到輸入元件（初始化 / 讀檔後）
// 舊生產線頁的篩選/合成節點已移除；自動穿裝控制位於裝備頁。
function syncFactoryInputs() {
  var factorySnapshot = uiFactoryPanelSnapshot();
  var f = factorySnapshot && factorySnapshot.factory;
  var autoEq = $id('toggle-autoequip');
  if (autoEq) autoEq.checked = !!(f && f.autoEquip);

}


/* ---- 熔爐分頁（正式版：品質勾選路由）----
   邏輯層 → js/newforge.js；資料表 → js/data.js。
   熔爐清單以整段 innerHTML 重建，僅在內容變動且未聚焦互動元件時覆寫；
   帶視覺由 nfUpdateBelts 定點更新，批次流動不擊穿快取。 */

// 品質勾選摘要（面板收合時顯示）：列出會拆解的品質（0 普通 ~ 7 創世；神鑄創世恆保留）
function nfQualitySummary(fu) {
  var salv = [];
  for (var r = 0; r < RARITIES.length; r++) {
    if (isGodforgedRarity(r)) continue;
    if (fu.qualities[r]) salv.push('<span style="color:' + RARITIES[r].color + '">' + RARITIES[r].name + '</span>');
  }
  return salv.length ? '分解：' + salv.join('、') + '（其餘保留）' : '未勾選任何品質（全部保留）';
}

// 品質勾選面板（圖2）：勾選＝該品質裝備自動入帶拆解；未勾＝保留
function nfQualityPanelHTML(fu) {
  var rows = '';
  for (var r = 0; r < RARITIES.length; r++) {
    if (isGodforgedRarity(r)) continue;
    rows += '<label class="nf-qual-row"><input type="checkbox" data-nf-fid="' + fu.id + '" data-nf-qual="' + r + '"' +
      pendingUiButtonAttributes(furnacePendingKey(fu.id)) +
      (fu.qualities[r] ? ' checked' : '') + '> <span style="color:' + RARITIES[r].color + '">' + RARITIES[r].name + '</span></label>';
  }
  return '<div class="nf-qual-panel">' + rows +
    '<div class="hint">勾選品質的裝備會自動進入傳送帶拆解；未勾選＝保留入包。上鎖與神鑄創世永遠保留。</div></div>';
}

// 傳送帶批次圖示（帶頭在左＝即將入爐；與原版輸送帶樣式一致，縮小尺寸多顯示件數）。
// 帶尾另有固定寬度的 +N 區（nf-belt-more，由 nfUpdateBelts 更新），版面不隨數字增減變動。
function nfBeltChipsHTML(fu) {
  var show = fu.belt.slice(0, NEW_FORGE_BELT_SHOW);
  var chips = show.map(function (it) {
    var r = RARITIES[it.rarity];
    return '<span class="conv-chip" style="border-color:' + r.color + ';color:' + r.color + '" data-tip="' +
      esc(rarityTag(it)) + '">' + SLOT_INFO[it.slot].emoji + '</span>';
  }).join('');
  return chips || '<span class="nf-belt-empty dim-text">（傳送帶空）</span>';
}

// 零件置入格列：已裝＝零件晶片（點擊卸下）、空格＝零件N（點擊開啟零件列表）、
// 下一格＝🔒解鎖（顯示金幣成本）、其餘＝🔒
function nfPartSlotsHTML(fu, nf, factory, player) {
  var cells = '';
  for (var s = 0; s < NEW_FORGE_PART_SLOTS_MAX; s++) {
    if (s < fu.partSlots) {
      var p = fu.parts[s]; // 裝配資料只保存 {key}；等級由 nf.partLevels 即時決定
      if (p && PART_TYPES[p.key]) {
        var partLevels = (nf && nf.partLevels) || (factory && factory.partLevels) || {};
        var currentLevel = Number(partLevels[p.key]) || 1;
        // 已裝＝正方形小圖示（全稱在 tooltip；點擊依格位索引卸下）
        cells += '<button class="nf-part-slot nf-part-filled nf-part-ico" data-nf-fid="' + fu.id + '" data-nf-partun="' + s + '"' +
          pendingUiButtonAttributes(furnacePendingKey(fu.id)) +
          ' data-tip="【點擊卸下】T' + currentLevel + ' ' + esc(partDesc({ key: p.key, level: currentLevel })) + '">' + partIconHTML(p.key) + '</button>';
      } else {
        cells += '<button class="nf-part-slot" data-nf-fid="' + fu.id + '" data-nf-partsopen="1"' +
          ' data-tip="【點擊選擇零件】開啟零件列表，可連續安裝">零件' + (s + 1) + '</button>';
      }
    } else if (s === fu.partSlots) {
      var reincarnations = Math.max(0, Math.floor(Number(player.reincarnations) || 0));
      var cost = newForgePartSlotCost(reincarnations, fu.partSlots, nf.furnaces.length);
      var ok = (player.gold || 0) >= cost;
      cells += '<button class="nf-part-slot nf-part-lock' + (ok ? '' : ' nf-part-poor') + '" data-nf-fid="' + fu.id + '" data-nf-unlockslot="1"' +
        pendingUiButtonAttributes(furnacePendingKey(fu.id)) +
        ' data-tip="解鎖第 ' + (s + 1) + ' 格零件格：金幣 ' + fmtFull(cost) + '">🔒 ' + fmt(cost) + '</button>';
    } else {
      cells += '<span class="nf-part-slot nf-part-lock">🔒</span>';
    }
  }
  return '<div class="nf-parts-row">' + cells + '</div>';
}

// 零件選擇列表（點擊零件格開啟；出現在該熔爐卡片下方）：
// 新制只選擇零件種類，裝配時直接使用全域目前等級，不再選擇或複製零件實體。
function nfPartsListHTML(fu, factory, nf) {
  var levels = (nf && nf.partLevels) || (factory && factory.partLevels) || {};
  var keys = Object.keys(PART_TYPES).filter(function (key) { return PART_TYPES[key].node === 'salvage'; });
  var chips = keys.map(function (key) {
    var level = levels[key] || 1;
    return '<span class="part-chip" style="cursor:pointer; border-color:var(--accent);" data-nf-fid="' + fu.id +
      '" data-nf-partinstall-key="' + key + '"' + pendingUiButtonAttributes(furnacePendingKey(fu.id)) +
      ' data-tip="【點擊裝配】T' + level + ' ' + esc(partDesc({ key: key, level: level })) + '；升級後已裝配效果同步刷新">' + partIconHTML(key) + esc(partName({ key: key, level: level })) + '</span>';
  }).join('');
  return '<div class="nf-parts-list"><div class="nf-parts-list-head">🔧 選擇零件（熔爐 #' + fu.id + '，' +
    fu.parts.length + '/' + fu.partSlots + '）<button class="btn sm" data-nf-fid="' + fu.id + '" data-nf-partsopen="1">收起</button></div>' +
    '<div class="chip-row">' + chips + '</div>' +
    '<div class="hint">選擇零件種類即可裝配；同類型可重複、連續點擊可一次裝滿。升級零件後，所有熔爐中同名零件效果會同步刷新。</div></div>';
}

function nfPartUpgradesHTML(factory, player, nf) {
  var levels = (nf && nf.partLevels) || (factory && factory.partLevels) || {};
  var keys = Object.keys(PART_TYPES);
  var rows = keys.map(function (key) {
    var pt = PART_TYPES[key];
    var level = levels[key] || 1;
    var cost = level < PART_MAX_TIER ? partUpgradeCost(level + 1) : null;
    var can = cost !== null && (player.gold || 0) >= cost;
    var button = level >= PART_MAX_TIER
      ? '<span class="nf-part-upgrade-max">Max</span>'
      : '<button class="btn sm nf-part-upgrade-button' + (can ? '' : ' nf-part-poor') + '" data-nf-partupgrade="' + key + '"' +
        pendingUiButtonAttributes(nodePendingKey('newforge-part-upgrade-' + key)) +
        ' data-tip="升級消耗金幣：' + fmtFull(cost) + '">升級</button>';
    return '<div class="nf-part-upgrade-card" data-tip="' + esc(partDesc({ key: key, level: level })) + '">' +
      '<div class="nf-part-upgrade-level">T' + level + '</div>' +
      '<div class="nf-part-upgrade-icon">' + partIconHTML(key) + '</div>' +
      '<div class="nf-part-upgrade-name">' + esc(pt.name) + '</div>' +
      '<div class="nf-part-upgrade-action">' + button + '</div></div>';
  }).join('');
  return '<div class="nf-part-upgrades"><div class="sec-title">🔧 零件升級</div>' +
    '<div class="hint">零件等級上限 T' + PART_MAX_TIER + '；升級費用公式為 a + b × c^升級後等級（例如 T5→T6 代入 6）。滑鼠移到圖示可查看效果，已裝配零件會立即同步新等級。</div>' +
    '<div class="nf-part-upgrade-grid">' + rows + '</div></div>';
}

// 熔爐卡片（圖1）：左側大圖＋右側傳送帶（拆解設定/啟用/摘要/帶視覺）＋零件格
function nfFurnaceHTML(fu, nf, factory, player) {
  var head = '<div class="node-title">' + NEW_FORGE_EMOJI + ' ' + esc(NEW_FORGE_NAME) +
    ' <span class="node-badge">#' + fu.id + '</span>' +
    '<button class="btn sm warn nf-remove" data-nf-remove="' + fu.id + '"' +
    pendingUiButtonAttributes(furnacePendingKey(fu.id)) + '>移除熔爐</button></div>';
  var open = UI.nfCfgOpen && UI.nfCfgOpen[fu.id];
  var beltRow = '<div class="nf-line-head">' +
    '<span class="nf-line-no">傳送帶</span>' +
    '<button class="btn sm" data-nf-fid="' + fu.id + '" data-nf-cfg="1">⚙ 拆解設定</button>' +
    '<label class="chk"><input type="checkbox" data-nf-fid="' + fu.id + '" data-nf-on="1"' +
    pendingUiButtonAttributes(furnacePendingKey(fu.id)) + (fu.enabled ? ' checked' : '') + '> 啟用</label>' +
    '</div>' +
    (open ? nfQualityPanelHTML(fu) : '<div class="nf-line-sum">' + nfQualitySummary(fu) + '</div>') +
    '<div class="nf-belt"><span class="nf-belt-mouth" data-tip="熔爐入口：帶頭裝備由此入爐拆解">' + NEW_FORGE_EMOJI + '</span>' +
    '<span class="nf-belt-items" data-nf-belt="' + fu.id + '"></span>' +
    '<span class="nf-belt-more" data-nf-more="' + fu.id + '"></span></div>' +
    nfPartSlotsHTML(fu, nf, factory, player) +
    (UI.nfPartsOpen && UI.nfPartsOpen[fu.id] ? nfPartsListHTML(fu, factory, nf) : '');
  return '<div class="panel node-card nf-furnace' + (fu.enabled ? '' : ' nf-line-off') + '">' + head +
    '<div class="nf-furnace-body">' +
    '<div class="nf-furnace-left"><img class="nf-furnace-img" src="' + NEW_FORGE_IMAGE + '" alt="' + esc(NEW_FORGE_NAME) + '">' +
    '<div class="nf-furnace-caption dim-text">' + esc(NEW_FORGE_DESC) + '</div></div>' +
    '<div class="nf-lines">' + beltRow + '</div>' +
    '</div></div>';
}

function renderNewForge() {
  var newForgeSnapshot = uiNewForgePanelSnapshot();
  var factorySnapshot = uiFactoryPanelSnapshot();
  var headerSnapshot = uiHeaderPanelSnapshot();
  var nf = newForgeSnapshot && newForgeSnapshot.newForge;
  var factory = factorySnapshot && factorySnapshot.factory;
  var player = headerSnapshot && headerSnapshot.player;
  if (!nf || !factory || !player) return;
  var qc = $id('nf-queue-count');
  if (qc) qc.textContent = fmtFull(nf.queueCount !== undefined ? nf.queueCount : (nf.queue ? nf.queue.length : 0)); // 佇列顯示完整數字，不用簡寫
  renderForgeExtras(factorySnapshot, headerSnapshot); // 附魔書庫存＋強化節點（搬入本頁的面板）
  var upgradeBox = $id('nf-part-upgrades');
  if (upgradeBox) setHtmlIfChanged(upgradeBox, nfPartUpgradesHTML(factory, player, nf));
  var cnt = $id('nf-count');
  if (cnt) {
    var allowed = newForgeMaxFurnaces(Math.max(0, Math.floor(Number(player.reincarnations) || 0)));
    cnt.textContent = nf.furnaces.length + '/' + allowed + ' 座（轉生+1 座，上限 ' + NEW_FORGE_MAX + '）｜已拆解 ' + fmt(nf.stats.salvaged) +
      '・保留 ' + fmt(nf.stats.kept);
  }
  var list = $id('nf-furnaces');
  if (list) {
    var html = nf.furnaces.map(function (fu) {
      return nfFurnaceHTML(fu, nf, factory, player);
    }).join('') ||
      '<div class="panel"><div class="hint">尚無熔爐——請於下方添加。</div></div>';
    if (UI._nfFurnacesHTML !== html) {
      // 焦點防衛：使用者正聚焦清單內的下拉/輸入框時延後整段重建（帶視覺另行定點更新）
      var ae = document.activeElement;
      var interacting = ae && list.contains(ae) && (ae.tagName === 'SELECT' || ae.tagName === 'INPUT');
      if (!interacting) {
        UI._nfFurnacesHTML = html;
        list.innerHTML = html;
      }
    }
    nfUpdateBelts(list, newForgeSnapshot);
  }
}

// 傳送帶批次定點更新（每輪執行；容器內無互動元件，覆寫不影響操作）
function nfUpdateBelts(list, snapshot) {
  var nodes = list.querySelectorAll('[data-nf-belt]');
  if (!nodes.length) return;
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    var fu = newForgeViewFurnace(snapshot, parseInt(node.getAttribute('data-nf-belt'), 10));
    if (!fu) continue;
    var html = nfBeltChipsHTML(fu);
    if (node._nfBeltHTML !== html) {
      node._nfBeltHTML = html;
      node.innerHTML = html;
    }
  }
  // 帶尾固定 +N 區：只換文字，空間恆定不變動版面。
  // +N＝該爐「專屬佇列」真實件數（各爐獨立，非共用計數；顯示封頂 +9999、tooltip 精確）。
  var mores = list.querySelectorAll('[data-nf-more]');
  for (var m = 0; m < mores.length; m++) {
    var moreNode = mores[m];
    var moreFu = newForgeViewFurnace(snapshot, parseInt(moreNode.getAttribute('data-nf-more'), 10));
    var wait = moreFu
      ? (moreFu.queueCount !== undefined ? moreFu.queueCount : (moreFu.queue ? moreFu.queue.length : 0))
      : 0;
    var text = wait > 0 ? '+' + (wait > 9999 ? '9999' : wait) : '';
    if (moreNode._nfMoreText !== text) {
      moreNode._nfMoreText = text;
      moreNode.textContent = text;
      if (wait > 0) moreNode.setAttribute('data-tip', '此熔爐專屬佇列：' + fmtFull(wait) + ' 件（自總佇列派發，等待進入傳送帶）');
      else moreNode.removeAttribute('data-tip');
    } else if (wait > 0) {
      moreNode.setAttribute('data-tip', '此熔爐專屬佇列：' + fmtFull(wait) + ' 件（自總佇列派發，等待進入傳送帶）');
    }
  }
}

// 熔爐分頁事件委派（initUI 呼叫一次；清單 innerHTML 重建不影響委派）
function bindNewForgeEvents() {
  var tab = $id('tab-newforge');
  if (!tab) return;
  var addButton = tab.querySelector('[data-nf-add]');
  if (addButton) addButton.setAttribute('data-ui-pending-key', nodePendingKey('newforge-add'));
  tab.addEventListener('change', function (e) {
    var el = e.target;
    if (!el || !el.getAttribute) return;
    var furnaceId = parseInt(el.getAttribute('data-nf-fid'), 10);
    var fu = newForgeViewFurnace(uiNewForgePanelSnapshot(), furnaceId);
    if (!fu) return;
    if (el.hasAttribute('data-nf-qual')) {
      var r = parseInt(el.getAttribute('data-nf-qual'), 10);
      {
        if (isUiCommandPending(furnacePendingKey(furnaceId))) {
          el.checked = !!fu.qualities[r];
          return;
        }
        sendUiCommand('newforge.setQuality', {
          furnaceId: furnaceId,
          rarity: r,
          on: !!el.checked
        }, {
          keys: [furnacePendingKey(furnaceId)],
          panels: ['newforge']
        }).catch(function (error) {
          reportUiCommandFailure('熔爐拆解設定', error, ['newforge']);
        });

      }
    } else if (el.hasAttribute('data-nf-on')) {
      {
        if (isUiCommandPending(furnacePendingKey(furnaceId))) {
          el.checked = !!fu.enabled;
          return;
        }
        sendUiCommand('newforge.setEnabled', {
          furnaceId: furnaceId,
          on: !!el.checked
        }, {
          keys: [furnacePendingKey(furnaceId)],
          panels: ['newforge']
        }).catch(function (error) {
          reportUiCommandFailure('熔爐啟用設定', error, ['newforge']);
        });

      }
    }
  });
  tab.addEventListener('click', function (e) {
    var upgrade = e.target && e.target.closest ? e.target.closest('[data-nf-partupgrade]') : null;
    if (upgrade) {
      var upgradeKey = upgrade.getAttribute('data-nf-partupgrade');
      if (isUiCommandPending(nodePendingKey('newforge-part-upgrade-' + upgradeKey))) return;
      sendUiCommand('newforge.upgradePart', { partKey: upgradeKey }, {
        keys: [nodePendingKey('newforge-part-upgrade-' + upgradeKey)],
        panels: ['newforge', 'factory', 'header']
      }).catch(function (error) {
        reportUiCommandFailure('零件升級', error, ['newforge', 'factory', 'header']);
      });
      return;
    }
    // 零件裝配晶片（span）：點擊依類型裝配目前全域等級，列表保持開啟可連續裝滿
    var chip = e.target && e.target.closest ? e.target.closest('[data-nf-partinstall-key]') : null;
    if (chip) {
      var chipFurnaceId = parseInt(chip.getAttribute('data-nf-fid'), 10);
      var cfu = newForgeViewFurnace(uiNewForgePanelSnapshot(), chipFurnaceId);
      if (cfu) {
        {
          if (isUiCommandPending(furnacePendingKey(chipFurnaceId))) return;
          sendUiCommand('newforge.installPart', {
            furnaceId: chipFurnaceId,
            partKey: chip.getAttribute('data-nf-partinstall-key')
          }, {
            keys: [furnacePendingKey(chipFurnaceId)],
            panels: ['newforge', 'factory']
          }).catch(function (error) {
            reportUiCommandFailure('熔爐安裝零件', error, ['newforge', 'factory']);
          });

        }
      }
      return;
    }
    var el = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!el) return;
    if (el.hasAttribute('data-nf-add')) {
      {
        sendUiCommand('newforge.addFurnace', {}, {
          keys: [nodePendingKey('newforge-add')],
          panels: ['newforge']
        }).catch(function (error) {
          reportUiCommandFailure('新增熔爐', error, ['newforge']);
        });

      }
      return;
    }
    if (el.hasAttribute('data-nf-remove')) {
      var rid = parseInt(el.getAttribute('data-nf-remove'), 10);
      {
        sendUiCommand('newforge.removeFurnace', { furnaceId: rid }, {
          keys: [furnacePendingKey(rid)],
          panels: ['newforge', 'inv']
        }).catch(function (error) {
          reportUiCommandFailure('移除熔爐', error, ['newforge', 'inv']);
        });

      }
      return;
    }
    var clickedFurnaceId = parseInt(el.getAttribute('data-nf-fid'), 10);
    var fu = newForgeViewFurnace(uiNewForgePanelSnapshot(), clickedFurnaceId);
    if (!fu) return;
    if (el.hasAttribute('data-nf-cfg')) {
      if (!UI.nfCfgOpen) UI.nfCfgOpen = {};
      UI.nfCfgOpen[fu.id] = !UI.nfCfgOpen[fu.id];
      UI.dirty.newforge = true;
      return;
    }
    if (el.hasAttribute('data-nf-unlockslot')) {
      {
        sendUiCommand('newforge.unlockPartSlot', { furnaceId: fu.id }, {
          keys: [furnacePendingKey(fu.id)],
          panels: ['newforge', 'header']
        }).catch(function (error) {
          reportUiCommandFailure('熔爐解鎖零件格', error, ['newforge', 'header']);
        });

      }
      return;
    }
    if (el.hasAttribute('data-nf-partsopen')) {
      if (!UI.nfPartsOpen) UI.nfPartsOpen = {};
      UI.nfPartsOpen[fu.id] = !UI.nfPartsOpen[fu.id];
      UI.dirty.newforge = true;
      return;
    }
    if (el.hasAttribute('data-nf-partun')) {
      var slotIndex = parseInt(el.getAttribute('data-nf-partun'), 10);
      {
        sendUiCommand('newforge.uninstallPart', {
          furnaceId: fu.id,
          slotIndex: slotIndex
        }, {
          keys: [furnacePendingKey(fu.id)],
          panels: ['newforge', 'factory']
        }).catch(function (error) {
          reportUiCommandFailure('熔爐卸下零件', error, ['newforge', 'factory']);
        });

      }
      return;
    }
  });
  // 點擊零件界面外任意處收起零件列表：零件列表本體與零件格列（開啟/卸下/解鎖）內的
  // 點擊不收起（保留連續安裝操作），其餘一律關閉所有已開啟的列表。
  document.addEventListener('click', function (e) {
    if (!UI.nfPartsOpen) return;
    var anyOpen = false;
    for (var k in UI.nfPartsOpen) if (UI.nfPartsOpen[k]) { anyOpen = true; break; }
    if (!anyOpen) return;
    var t = e.target;
    if (t && t.closest && (t.closest('.nf-parts-list') || t.closest('.nf-parts-row'))) return;
    UI.nfPartsOpen = {};
    UI.dirty.newforge = true;
  });
}

/* ---- 神鑄分頁 ----
   六芒星以 Hexagram.png 為底，槽位/魔塵符位以百分比座標絕對定位
  （座標對應法陣星角，順時針自頂點起）。邏輯層 → js/forge.js。 */
var FORGE_SLOT_POS = [
  { x: 50, y: 21 }, { x: 63, y: 36 }, { x: 63, y: 64 },
  { x: 50, y: 79 }, { x: 37, y: 64 }, { x: 37, y: 36 }
];
var FORGE_DUST_POS = [
  { x: 50, y: 7 }, { x: 70.5, y: 28.5 }, { x: 70.5, y: 71.5 },
  { x: 50, y: 93 }, { x: 29.5, y: 71.5 }, { x: 29.5, y: 28.5 }
];

function forgeInventoryTab(forge) {
  var c = forge && forge.crafting;
  if (c && c.mode === 'gem') return 'gems';
  if (c && c.mode === 'equip') return 'items';
  return UI.forgeInvTab || 'items';
}

/* 神鑄「自動放入」選單：依目前背包切頁列出可選素材。
   裝備頁＝三種品質（品質色字）；寶石頁＝所有持有的五～九階寶石（emoji 小圖示＋屬性）。
   持有不足 6 者半透明不可選；UI.forgeAutoPick 為選單中的暫選項。 */
function renderForgeAutoMenu(forge, inventorySnapshot, gemsSnapshot) {
  var menu = $id('forge-auto-menu');
  if (!menu) return;
  // 重建前記住素材清單卷軸位置：自動鑄造運行中觸發的同步重繪不可把清單刷回頂部
  var prevList = menu.querySelector('.fam-list');
  var prevScrollTop = prevList ? prevList.scrollTop : 0;
  if (!forge || !inventorySnapshot || !gemsSnapshot) return;
  var invTab = forgeInventoryTab(forge);
  menu.classList.toggle('fam-gem-mode', invTab === 'gems');
  var pick = UI.forgeAutoPick;
  var title = '';
  var rows = '';
  if (invTab === 'gems') {
    title = '💎 自動放入寶石（五～九階）';
    var gemOptions = [];
    for (var lv = GEM_FORGE_MAX_LEVEL - 1; lv >= GEM_MAX_LEVEL; lv--) {
      for (var t in GEM_TYPES) {
        var n = forgeViewGemCount(gemsSnapshot, t, lv);
        if (!n) continue;
        gemOptions.push({ type: t, level: lv, count: n, canForge: n >= FORGE_SLOTS });
      }
    }
    // 可直接放滿六個鑄造槽的寶石優先，接著依階級由高到低排列。
    gemOptions.sort(function (a, b) {
      return b.canForge - a.canForge || b.level - a.level || String(a.type).localeCompare(String(b.type));
    });
    for (var gi = 0; gi < gemOptions.length; gi++) {
      var gem = gemOptions[gi];
      var gd = GEM_TYPES[gem.type];
      var val = gd.pct ? pctStr(gemStatValue(gem.type, gem.level)) : fmt(gemStatValue(gem.type, gem.level));
      var gPicked = pick && pick.kind === 'gem' && pick.type === gem.type && pick.level === gem.level;
      var col = GEM_TIER_COLORS[gem.level] || '#f5c542';
      rows += '<div class="fam-opt' + (gem.canForge ? '' : ' fam-dim') + (gPicked ? ' picked' : '') + '"' +
        ' data-fam-gem="' + gem.type + ':' + gem.level + '"' +
        ' style="color:' + col + '">' +
        '<span>' + gd.emoji + '</span>' +
        '<span>' + esc(GEM_NAMES[gem.level] + gd.name) + '（' + esc(gd.statName.replace('%', '')) + ' +' + val + '）</span>' +
        '<span class="fam-cnt">×' + fmt(gem.count) + (gem.canForge ? '' : '｜不足6') + '</span></div>';
    }
  } else {
    title = '🎒 自動放入裝備（取未上鎖、評分最低 6 件）';
    for (var r = FORGE_MIN_RARITY; r < RARITIES.length; r++) {
      if (!isForgeableEquipmentRarity(r)) continue;
      var cnt = 0;
      var inventoryItems = inventorySnapshot.items || [];
      for (var i = 0; i < inventoryItems.length; i++) {
        var it = inventoryItems[i];
        if (it && it.rarity === r && !it.locked) cnt++;
      }
      var rok = cnt >= FORGE_SLOTS;
      var rPicked = pick && pick.kind === 'equip' && pick.rarity === r;
      rows += '<div class="fam-opt' + (rok ? '' : ' fam-dim') + (rPicked ? ' picked' : '') + '"' +
        ' data-fam-equip="' + r + '"' +
        ' style="color:' + RARITIES[r].color + '">' +
        '<span>' + esc(RARITIES[r].name) + '裝備</span>' +
        '<span class="fam-cnt">持有 ' + cnt + (rok ? '' : '｜不足6') + '</span></div>';
    }
  }
  var emptyText = invTab === 'gems'
    ? '沒有五階以上的寶石（十階已是最高，不可鑄造）'
    : '目前沒有可自動放入的裝備';
  menu.innerHTML = '<div class="fam-title">' + title + '</div>' +
    '<div class="fam-list">' + (rows || '<div class="fam-empty">' + emptyText + '</div>') + '</div>' +
    '<div class="fam-foot">' +
    '<button id="fam-confirm" class="btn sm"' + pendingUiButtonAttributes(nodePendingKey('forge')) +
    (pick ? '' : ' disabled') + '>確定</button>' +
    (forge.autoFill ? '<button id="fam-stop" class="btn sm warn"' +
      pendingUiButtonAttributes(nodePendingKey('forge')) + '>取消自動放入</button>' : '') +
    '<button id="fam-close" class="btn sm">關閉</button></div>';
  // 法陣區為 overflow:hidden：選單往上展開的最大高度以「按鈕底～法陣頂」為限，
  // 超出改由素材清單內卷軸承接，標題與操作列不隨清單移動。
  var stage = $id('forge-stage');
  if (stage && menu.parentElement) {
    var avail = menu.parentElement.getBoundingClientRect().bottom - stage.getBoundingClientRect().top - 10;
    var menuHeight = Math.max(160, Math.min(400, Math.floor(avail)));
    menu.style.maxHeight = menuHeight + 'px';
    // 寶石清單使用明確高度，確保 footer 不會被素材內容擠出選單。
    menu.style.height = invTab === 'gems' ? menuHeight + 'px' : '';
    var famList = menu.querySelector('.fam-list');
    if (famList && invTab === 'gems') {
      var famTitle = menu.querySelector('.fam-title');
      var famFoot = menu.querySelector('.fam-foot');
      var menuCss = window.getComputedStyle(menu);
      var titleCss = window.getComputedStyle(famTitle);
      var footCss = window.getComputedStyle(famFoot);
      var verticalPadding = (parseFloat(menuCss.paddingTop) || 0) + (parseFloat(menuCss.paddingBottom) || 0);
      var titleMargin = parseFloat(titleCss.marginBottom) || 0;
      var footMargin = parseFloat(footCss.marginTop) || 0;
      var measuredHeight = menu.clientHeight
        ? menu.clientHeight - verticalPadding - famTitle.offsetHeight - titleMargin - famFoot.offsetHeight - footMargin
        : menuHeight - 100;
      famList.style.flex = '0 0 auto';
      famList.style.height = Math.max(40, Math.floor(measuredHeight)) + 'px';
    } else if (famList) {
      famList.style.flex = '';
      famList.style.height = '';
    }
  }
  // 還原重建前的卷軸位置（clamp 交由瀏覽器處理，超出時自動停在最底）
  var newList = menu.querySelector('.fam-list');
  if (newList && prevScrollTop > 0) newList.scrollTop = prevScrollTop;
}

/* 點選素材時就地更新高亮與確定鈕，不重建選單（保留清單卷軸位置）。 */
function famApplyPickHighlight(menu) {
  var pick = UI.forgeAutoPick;
  var opts = menu.querySelectorAll('.fam-opt');
  for (var i = 0; i < opts.length; i++) {
    var el = opts[i];
    var isPicked = false;
    if (pick) {
      if (pick.kind === 'equip') {
        isPicked = el.getAttribute('data-fam-equip') === String(pick.rarity);
      } else {
        isPicked = el.getAttribute('data-fam-gem') === pick.type + ':' + pick.level;
      }
    }
    el.classList.toggle('picked', isPicked);
  }
  var confirmBtn = menu.querySelector('#fam-confirm');
  if (confirmBtn) confirmBtn.disabled = !pick;
}

function renderForgeProgress(forge, inventorySnapshot, gemsSnapshot) {
  var box = $id('forge-progress');
  if (!box) return;
  var c = forge && forge.crafting;
  var fill = $id('forge-progress-fill');
  if (!c) {
    box.style.display = 'none';
    if (fill) {
      fill.style.animationName = 'none';
      fill.style.transform = 'scaleX(0)';
      delete fill.dataset.forgeAnimation;
    }
    return;
  }
  var duration = Math.max(1, Number(c.durationMs) || 1);
  var elapsed = clamp(Date.now() - Number(c.startedAt), 0, duration);
  var remain = Math.max(0, duration - elapsed);
  box.style.display = '';
  $id('forge-progress-status').textContent = '鑄造中....';
  // 目前素材可再鑄造次數 = 剩餘庫存 ÷ 6 取整（內容無變化時不觸碰 DOM）
  var remainEl = $id('forge-progress-remain');
  if (remainEl) {
    var ri = forgeViewRemainInfo(forge, inventorySnapshot, gemsSnapshot);
    var remainText = ri ? ri.label + ' 可再鑄造 ' + fmt(Math.floor(ri.count / FORGE_SLOTS)) + ' 次' : '';
    if (remainEl.textContent !== remainText) remainEl.textContent = remainText;
  }
  $id('forge-progress-countdown').textContent = (remain / 1000).toFixed(1) + ' 秒';
  if (fill) {
    var animationKey = String(c.startedAt) + '/' + duration;
    if (fill.dataset.forgeAnimation !== animationKey) {
      // 自動鑄造換輪會沿用同一個 DOM；先強制結束上一輪，確保新輪次從正確進度重播。
      fill.style.animationName = 'none';
      void fill.offsetWidth;
      fill.dataset.forgeAnimation = animationKey;
      fill.style.animationName = 'forge-progress-fill';
      fill.style.animationDuration = duration + 'ms';
      fill.style.animationDelay = '-' + Math.min(elapsed, duration) + 'ms';
      fill.style.animationTimingFunction = 'linear';
      fill.style.animationFillMode = 'forwards';
      fill.style.animationPlayState = 'running';
    }
  }
}

function renderForge() {
  var hex = $id('forge-hex');
  if (!hex) return;
  var forgeSnapshot = uiForgePanelSnapshot();
  var inventorySnapshot = uiInventoryPanelSnapshot();
  var gemsSnapshot = uiGemsPanelSnapshot();
  var headerSnapshot = uiHeaderPanelSnapshot();
  var f = forgeViewState(forgeSnapshot);
  var player = headerSnapshot && headerSnapshot.player;
  if (!f || !inventorySnapshot || !gemsSnapshot || !player) return;
  var forgeBusy = !!f.crafting;
  var h = '';
  // 六個素材槽（裝備或寶石，二擇一模式）
  for (var i = 0; i < FORGE_SLOTS; i++) {
    var p = FORGE_SLOT_POS[i];
    var it = f.slots[i];
    var style = 'left:' + p.x + '%;top:' + p.y + '%;';
    if (it && it.kind === 'gem') {
      var gcol = GEM_TIER_COLORS[it.level] || '#f5c542';
      var gdefS = GEM_TYPES[it.type];
      var gvalS = gdefS.pct ? pctStr(gemStatValue(it.type, it.level)) : fmt(gemStatValue(it.type, it.level));
      h += '<div class="forge-slot filled" data-forge-slot="' + i + '" data-tip="' +
        esc(gemLabel(it.type, it.level) + '｜' + gdefS.statName.replace('%', '') + ' +' + gvalS + '｜點擊取回') + '" ' +
        pendingUiButtonAttributes(nodePendingKey('forge')) +
        ' style="' + style + 'border-color:' + gcol + ';box-shadow:0 0 14px ' + gcol + 'aa, inset 0 0 10px ' + gcol + '55">' +
        '<span class="ic-emoji">' + GEM_TYPES[it.type].emoji + '</span><span class="ic-lv">' + it.level + '</span></div>';
    } else if (it) {
      var r = RARITIES[it.rarity];
      var info = SLOT_INFO[it.slot];
      var iconFile = itemIconFile(it, info);
      var iconHtml = iconFile ? '<img src="images/' + iconFile + '" class="item-icon">' : '<span class="ic-emoji">' + info.emoji + '</span>';
      // 裝備槽不掛 data-tip：滑過改由 mouseover 委派顯示完整裝備詳情 tooltip
      h += '<div class="forge-slot filled" data-forge-slot="' + i + '" data-id="' + it.id + '" ' +
        pendingUiButtonAttributes(nodePendingKey('forge')) +
        ' style="' + style + 'border-color:' + r.color + ';box-shadow:0 0 14px ' + r.color + 'aa, inset 0 0 10px ' + r.color + '55">' +
        iconHtml + ancientStarBadgeHTML(it) + '<span class="ic-lv">' + it.level + '</span></div>';
    } else {
      h += '<div class="forge-slot empty" data-forge-slot="' + i + '" data-tip="點擊下方背包中的裝備（傳說/神話/創世）或寶石（五階以上）放入" style="' + style + '"></div>';
    }
  }
  // 六個魔塵符位（各自獨立：點哪格亮哪格）
  var dustN = forgeViewDustCount(f, player);
  var equipDustRate = FORGE_GEM_DUST_RATE;
  for (var dri = 0; dri < f.slots.length; dri++) {
    if (f.slots[dri] && f.slots[dri].kind !== 'gem') {
      equipDustRate = forgeDustRateFor(f.slots[dri].rarity);
      break;
    }
  }
  for (var di = 0; di < FORGE_SLOTS; di++) {
    var dp = FORGE_DUST_POS[di];
    var lit = !!f.dustSlots[di];
    h += '<div class="forge-dust' + (lit ? ' lit' : '') + '" data-forge-dust="' + di + '" data-tip="' +
      (lit ? '點擊取下魔塵' : '點擊放入魔塵（+' + equipDustRate + '% 成功率）') + '"' +
      pendingUiButtonAttributes(nodePendingKey('forge')) + ' style="left:' + dp.x + '%;top:' + dp.y + '%;">💫</div>';
  }
  // 中央產物（上次鑄造成功的裝備或寶石）
  if (f.result && f.result.kind === 'gem' && GEM_TYPES[f.result.type]) {
    var gc = GEM_TIER_COLORS[f.result.level] || '#f5c542';
    var gname = gemLabel(f.result.type, f.result.level);
    h += '<div class="forge-center" data-tip="上次鑄造產物：' + esc(gname) + '（已放入寶石庫存）" ' +
      'style="border-color:' + gc + ';box-shadow:0 0 25px ' + gc + 'cc, inset 0 0 14px ' + gc + '66">' +
      '<span class="ic-emoji" style="font-size:26px">' + GEM_TYPES[f.result.type].emoji + '</span>' +
      '<div class="forge-center-name" style="color:' + gc + '">' + esc(gname) + '</div></div>';
  } else if (f.result && RARITIES[f.result.rarity] && SLOT_INFO[f.result.slot]) {
    var rr = RARITIES[f.result.rarity];
    var rInfo = SLOT_INFO[f.result.slot];
    var rIcon = rInfo.icon ? '<img src="images/' + rInfo.icon + '" class="item-icon">' : '<span class="ic-emoji">' + rInfo.emoji + '</span>';
    h += '<div class="forge-center" data-tip="上次鑄造產物：' + esc(f.result.name) + '（Lv.' + f.result.level + '，已放入背包）" ' +
      'style="border-color:' + rr.color + ';box-shadow:0 0 25px ' + rr.color + 'cc, inset 0 0 14px ' + rr.color + '66">' + rIcon +
      '<div class="forge-center-name" style="color:' + rr.color + '">' + esc(f.result.name) + '</div></div>';
  } else {
    h += '<div class="forge-center empty" data-tip="鑄造成功的裝備/寶石會顯示在此"></div>';
  }
  hex.innerHTML = h;
  // 成功率與金幣消耗（依模式：裝備 / 寶石）
  var rate = forgeViewRateInfo(f, player);
  var rateEl = $id('forge-rate');
  if (rate) {
    rateEl.innerHTML = (rate.mode === 'gem' ? '💎 寶石' : '') + '鑄造成功率：<b style="color:#ffd700">' + fmt1(rate.base) + '%</b>' +
      (rate.dust > 0 ? ' <b style="color:#4ade80">+ ' + fmt1(rate.dust) + '%</b>' : '') +
      '　<span class="dim-text">金幣消耗：<img src="images/icon_gold.png" class="res-icon">' + fmt(rate.cost) + '｜失敗獲得魔塵 x1</span>';
  } else {
    rateEl.innerHTML = '<span class="dim-text">放入 6 件相同品質的裝備（傳說 55%｜神話 40%｜創世 25%）或 6 顆同種同階寶石（五階 45% ~ 九階 5%）</span>';
  }
  // 法陣紀錄
  $id('forge-log').innerHTML = f.log.map(function (l) {
    return '<div class="forge-log-line ' + l.cls + '">' + esc(l.msg) + '</div>';
  }).join('');
  // 自動魔塵與持有量
  var autoDustInput = $id('forge-autodust');
  var autoForgeInput = $id('forge-autoforge');
  autoDustInput.checked = !!f.autoDust;
  autoForgeInput.checked = !!f.autoForge;
  autoDustInput.parentElement.classList.toggle('is-active', autoDustInput.checked);
  autoForgeInput.parentElement.classList.toggle('is-active', autoForgeInput.checked);
  $id('forge-dust-own').textContent = '持有魔塵 ' + fmt(player.dust || 0) + ' 個｜已放置 ' + dustN + '/' + FORGE_SLOTS;
  renderForgeProgress(f, inventorySnapshot, gemsSnapshot);
  $id('forge-unload').disabled = forgeBusy;
  $id('forge-autodust').disabled = forgeBusy;
  var goBtn = $id('forge-go');
  if (goBtn) {
    if (forgeBusy || forgeViewItemCount(f) < FORGE_SLOTS) {
      goBtn.disabled = true;
      goBtn.style.background = '#4b5563';
      goBtn.style.color = '#d1d5db';
      goBtn.style.border = '1px solid #374151';
      goBtn.style.opacity = '1';
      goBtn.style.filter = 'none';
    } else {
      goBtn.disabled = false;
      goBtn.style.background = '';
      goBtn.style.color = '';
      goBtn.style.border = '';
      goBtn.style.opacity = '';
      goBtn.style.filter = '';
    }
  }
  // 自動放入按鈕狀態（已設定時亮起）與開啟中的選單同步刷新
  var afBtn = $id('forge-autofill');
  if (afBtn) {
    afBtn.disabled = forgeBusy;
    var afLabel = forgeViewAutoFillLabel(f);
    afBtn.classList.toggle('afk-on', !!afLabel);
    afBtn.setAttribute('data-tip', afLabel
      ? '自動放入中：' + afLabel + '（每次鑄造後自動補放 6 件，數量不足自動停止；點擊變更）'
      : '選擇素材後立即放入 6 件，之後每次鑄造自動補放同一素材');
  }
  var famMenuSync = $id('forge-auto-menu');
  if (forgeBusy && famMenuSync) {
    famMenuSync.style.display = 'none';
    UI.forgeAutoPick = null;
  } else if (famMenuSync && famMenuSync.style.display !== 'none') {
    renderForgeAutoMenu(f, inventorySnapshot, gemsSnapshot);
  }
  // 背包（裝備 / 寶石切頁；不符資格者以灰階顯示）
  var invTab = forgeInventoryTab(f);
  UI.forgeInvTab = invTab;
  var tabItemsBtn = $id('forge-invtab-items'), tabGemsBtn = $id('forge-invtab-gems');
  if (tabItemsBtn) tabItemsBtn.classList.toggle('active', invTab === 'items');
  if (tabGemsBtn) tabGemsBtn.classList.toggle('active', invTab === 'gems');
  if (tabItemsBtn) tabItemsBtn.disabled = forgeBusy;
  if (tabGemsBtn) tabGemsBtn.disabled = forgeBusy;
  var grid = $id('forge-inventory-grid');
  if (invTab === 'gems') {
    $id('forge-inv-count').textContent = fmt(forgeViewTotalGems(gemsSnapshot));
    var gh = '';
    for (var glv = GEM_FORGE_MAX_LEVEL; glv >= 1; glv--) {
      for (var gt2 in GEM_TYPES) {
        var gn = forgeViewGemCount(gemsSnapshot, gt2, glv);
        if (!gn) continue;
        var gok = glv >= GEM_MAX_LEVEL && glv < GEM_FORGE_MAX_LEVEL;
        var gcol2 = GEM_TIER_COLORS[glv] || '#f5c542';
        var gdef = GEM_TYPES[gt2];
        var gval = gdef.pct ? pctStr(gemStatValue(gt2, glv)) : fmt(gemStatValue(gt2, glv));
        gh += '<div class="item-cell forge-gem-cell' + (gok ? '' : ' forge-na') + '" data-forge-gem="' + gt2 + ':' + glv + '" ' +
          pendingUiButtonAttributes(nodePendingKey('forge')) +
          ' data-tip="' + esc(gemLabel(gt2, glv) + '｜' + gdef.statName.replace('%', '') + ' +' + gval + '｜持有 ' + gn + ' 顆' +
            (gok ? '（點擊放入法陣）' : (glv < GEM_MAX_LEVEL ? '（五階以上才可鑄造）' : '（十階已是最高階級）'))) + '" ' +
          'style="border-color:' + gcol2 + ';box-shadow:inset 0 0 12px ' + gcol2 + '33">' +
          '<span class="ic-emoji">' + gdef.emoji + '</span>' +
          '<span class="ic-lv">' + glv + '</span>' +
          '<span class="gem-cnt">x' + fmt(gn) + '</span></div>';
      }
    }
    grid.innerHTML = gh || '<div class="hint" style="grid-column: 1 / -1; padding: 10px;">尚無寶石。戰鬥掉落與寶石商店可取得寶石。</div>';
  } else {
    var inventoryItems = inventorySnapshot.items || [];
    $id('forge-inv-count').textContent = inventorySnapshot.count + '/' + inventorySnapshot.cap;
    if (!inventoryItems.length) {
      grid.innerHTML = '<div class="hint" style="grid-column: 1 / -1; padding: 10px;">背包是空的。戰鬥掉落的裝備會先進入生產線輸送帶，「保留」的會送到這裡。</div>';
    } else {
      /* 與背包頁同樣走增量更新：神鑄頁掛的是第二份完整背包格線（後期同樣九百多格），
         戰鬥掉落會讓 dirty.inv 一路推到這裡，整份重建一次就是一百多毫秒的凍結。 */
      var forgeCellKeys = [];
      var forgeCellHtmls = [];
      for (var fi = 0; fi < inventoryItems.length; fi++) {
        var it2 = inventoryItems[fi];
        var ok = isForgeableEquipmentRarity(it2.rarity);
        forgeCellKeys.push(it2.id);
        forgeCellHtmls.push(itemCellHTML(it2, 'forgeinv', ok ? '' : ' forge-na', nodePendingKey('forge')));
      }
      syncItemGridCells(grid, forgeCellKeys, forgeCellHtmls);
    }
  }
}

/* ---- 高塔分頁 ---- */
function renderTower() {
  var fightBox = $id('tower-fight');
  var listBox = $id('tower-list-wrap');
  var snapshot = uiTowerPanelSnapshot();
  var headerSnapshot = uiHeaderPanelSnapshot();
  if (!snapshot || !headerSnapshot) return;
  var towerState = snapshot.tower || {};
  var runtime = snapshot.runtime || {};
  var player = headerSnapshot.player || {};
  if (towerState.active) {
    fightBox.style.display = '';
    listBox.style.display = 'none';
    // 動態部分由 renderTowerFight 處理
  } else {
    fightBox.style.display = 'none';
    listBox.style.display = '';
    var h = '';
    var highest = Math.max(0, towerState.highest || 0);
    var maxShow = Math.min(TOWER_MAX_FLOOR, highest + 3);
    for (var fl = 1; fl <= maxShow; fl++) {
      var unlocked = fl <= highest + 1;
      var cleared = fl <= highest;
      var bd = BOSS_LIST[(fl - 1) % BOSS_LIST.length];
      var hell = isHellTowerFloor(fl);
      var purgatory = isPurgatoryTowerFloor(fl);
      var towerClass = purgatory ? 'purgatory' : (hell ? 'hell' : 'trial');
      if (fl === 1 || fl === TOWER_TRIAL_MAX_FLOOR + 1 || fl === TOWER_HELL_MAX_FLOOR + 1) {
        var sectionName = purgatory ? '煉獄之塔' : (hell ? '地獄之塔' : '試煉之塔');
        var sectionStart = purgatory ? TOWER_HELL_MAX_FLOOR + 1 : (hell ? TOWER_TRIAL_MAX_FLOOR + 1 : 1);
        var sectionEnd = purgatory ? TOWER_PURGATORY_MAX_FLOOR : (hell ? TOWER_HELL_MAX_FLOOR : TOWER_TRIAL_MAX_FLOOR);
        h += '<div class="tower-section-title ' + towerClass + '">🗼 ' +
          sectionName + '<span>第 ' + sectionStart + '～' + sectionEnd + ' 層</span></div>';
      }

      var bossIcon = (bd.img && !towerBossImageFailed(bd.img)) ? 'images/' + bd.img : null;
      var iconHtml = bossIcon
        ? '<img src="' + bossIcon + '" data-tower-boss-image="' + esc(bd.img) + '" data-tower-boss-fallback="' + esc(bd.emoji || '👾') + '" style="width:32px;height:32px;vertical-align:middle;border-radius:4px;box-shadow:0 0 5px #000;">'
        : '<span style="font-size:24px;vertical-align:middle;">' + (bd.emoji || '👾') + '</span>';

      var twCost = towerChallengeCost(fl);
      h += '<div class="tower-floor ' + towerClass + (cleared ? ' cleared' : '') + (unlocked ? '' : ' locked') + '" data-tower-tip="' + fl + '">' +
        '<span class="tf-emoji" style="margin-right:12px;">' + iconHtml + '</span>' +
        '<span class="tf-name' + (purgatory ? ' purgatory-boss' : '') + '" style="vertical-align:middle;">第 ' + fl + ' 層・' + bd.name + (cleared ? ' ✅' : '') + '</span>' +
        '<span class="tf-hint" style="margin-left:auto; margin-right:10px;">建議野外階段 ' + (4 + fl * 5) + '+｜挑戰費 <span style="color:' + ((player.gold || 0) >= twCost ? '#ffd700' : '#fca5a5') + '">💰' + fmt(twCost) + '</span></span>' +
        (unlocked
          ? '<button class="btn sm" data-tower-floor="' + fl + '"' + pendingUiButtonAttributes(nodePendingKey('tower')) + '>挑戰</button>' +
          '<button class="btn sm" data-tower-auto="' + fl + '"' + pendingUiButtonAttributes(nodePendingKey('tower')) + ' data-tip="連續挑戰此層（次數見上方設定）：金幣不足或次數用完自動停止並回到野外">🔁 連挑</button>'
          : '<span class="tf-lock">🔒</span>') +
        '</div>';
    }
    $id('tower-floors').innerHTML = h;
    var towerBossImages = $id('tower-floors').querySelectorAll('[data-tower-boss-image]');
    for (var ti = 0; ti < towerBossImages.length; ti++) {
      towerBossImages[ti].onerror = function () {
        var imageName = this.getAttribute('data-tower-boss-image');
        var fallbackEmoji = this.getAttribute('data-tower-boss-fallback') || '👾';
        markTowerBossImageFailed(imageName);
        var fallback = document.createElement('span');
        fallback.style.cssText = 'font-size:24px;vertical-align:middle;';
        fallback.textContent = fallbackEmoji;
        this.parentNode.replaceChild(fallback, this);
      };
    }
    // 上次結果
    var rbox = $id('tower-result');
    var r = runtime.result;
    if (r) {
      var rh = '<div class="tr-title ' + (r.win ? 'good' : 'bad') + '">' +
        (r.win ? '🏆 通關第 ' + r.floor + ' 層！' : '💀 第 ' + r.floor + ' 層挑戰失敗') + '</div>';
      if (r.win) {
        rh += '<div class="tr-sub">獲得獎勵：</div>' + r.rewards.map(function (x) { return '<div class="tr-line">' + x + '</div>'; }).join('');
      } else {
        rh += '<div class="tr-sub">戰鬥數據：DPS ' + fmt(r.myDps) + '（通關需求約 ' + fmt(r.needDps) + '）｜BOSS 剩餘血量 ' + r.bossHpPct + '%</div>';
        rh += '<div class="tr-sub">失敗分析：</div>' + r.analysis.map(function (x) { return '<div class="tr-line">📋 ' + esc(x) + '</div>'; }).join('');
      }
      rbox.innerHTML = rh;
      rbox.style.display = '';
    } else {
      rbox.style.display = 'none';
    }
    if (UI._scrollTower) {
      UI._scrollTower = false;
      setTimeout(function () {
        var el = document.querySelector('.tower-floor[data-tower-tip="' + (highest + 1) + '"]');
        if (el) el.scrollIntoView({ behavior: 'auto', block: 'center' });
      }, 10);
    }
  }
}

function towerTimerNow() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
}

function stopTowerTimerAnimation() {
  if (UI.towerTimerRaf) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(UI.towerTimerRaf);
    else clearTimeout(UI.towerTimerRaf);
    UI.towerTimerRaf = 0;
  }
  UI.towerTimerAnchor = null;
}

function scheduleTowerTimerFrame() {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(renderTowerTimerFrame);
  return setTimeout(renderTowerTimerFrame, 50);
}

function formatTowerTimerSeconds(seconds) {
  return Math.max(0, Number(seconds) || 0).toFixed(1);
}

function renderTowerTimerFrame() {
  var snapshot = uiTowerPanelSnapshot();
  var runtime = snapshot && snapshot.runtime;
  if (!towerViewActive(snapshot) || UI.tab !== 'tower' || !runtime || !runtime.boss) {
    stopTowerTimerAnimation();
    return;
  }
  var view = viewState();
  var paused = !!(view && view.paused);
  if (paused) UI.towerTimerAnchor = null;
  var anchor = UI.towerTimerAnchor;
  var remain = !paused && anchor
    ? Math.max(0, towerTimeLimitWithTalents(runtime.floor) - (anchor.elapsed + (towerTimerNow() - anchor.at) / 1000))
    : Math.max(0, towerTimeLimitWithTalents(runtime.floor) - runtime.elapsed);
  var timerEl = $id('tw-timer');
  if (timerEl) {
    timerEl.textContent = formatTowerTimerSeconds(remain) + 's';
    timerEl.classList.toggle('urgent', remain < 15);
  }
  if (paused) {
    UI.towerTimerRaf = 0;
    return;
  }
  UI.towerTimerRaf = scheduleTowerTimerFrame();
}

// 高塔戰鬥動態渲染（每 tick）；倒數文字另外以逐幀動畫更新
function renderTowerFight() {
  var snapshot = uiTowerPanelSnapshot();
  var headerSnapshot = uiHeaderPanelSnapshot();
  if (!towerViewActive(snapshot) || UI.tab !== 'tower' || !headerSnapshot) {
    stopTowerTimerAnimation();
    return;
  }
  var runtime = snapshot.runtime || {};
  var st = headerSnapshot.stats;
  var b = runtime.boss, p = runtime.player;
  if (!b || !p || !st) {
    stopTowerTimerAnimation();
    return;
  }
  var view = viewState();
  var paused = !!(view && view.paused);
  if (paused) {
    stopTowerTimerAnimation();
    renderTowerTimerFrame();
  } else {
    if (!UI.towerTimerAnchor || UI.towerTimerAnchor.elapsed !== runtime.elapsed) {
      UI.towerTimerAnchor = { elapsed: runtime.elapsed, at: towerTimerNow() };
    }
    if (!UI.towerTimerRaf) renderTowerTimerFrame();
  }
  $id('tw-enrage').style.display = runtime.enraged ? '' : 'none';
  // 連續挑戰進度（第 X/Y 場）
  var autoEl = $id('tw-auto-status');
  if (autoEl) {
    if (runtime.auto) {
      autoEl.style.display = '';
      autoEl.textContent = '🔁 連挑 第 ' + (runtime.auto.done + 1) + '/' + runtime.auto.total + ' 場（勝 ' + runtime.auto.wins + '）';
    } else {
      autoEl.style.display = 'none';
    }
  }
  if (b.img && !towerBossImageFailed(b.img)) {
    var bossImgSrc = 'images/' + b.img;
    var tbImg = $id('tb-emoji').querySelector('img');
    if (!tbImg) {
      $id('tb-emoji').innerHTML = '<img src="' + bossImgSrc + '" class="cb-icon boss" data-src="' + bossImgSrc + '">';
      tbImg = $id('tb-emoji').querySelector('img');
      if (tbImg) tbImg.onerror = function () {
        markTowerBossImageFailed(b.img);
        UI.dirty.tower = true;
      };
    } else {
      if (tbImg.getAttribute('data-src') !== bossImgSrc) {
        tbImg.setAttribute('data-src', bossImgSrc);
        tbImg.setAttribute('src', bossImgSrc);
        tbImg.onerror = function () {
          markTowerBossImageFailed(b.img);
          UI.dirty.tower = true;
        };
      }
      if (tbImg.className !== 'cb-icon boss') tbImg.className = 'cb-icon boss';
    }
  } else {
    $id('tb-emoji').innerHTML = '<span style="font-size:48px;">' + (b.emoji || '👾') + '</span>';
  }
  $id('tb-name').className = 'cb-name' + (b.purgatory ? ' purgatory-boss' : '');
  setHtmlIfChanged($id('tb-name'), b.name);
  if ($id('tb-level')) {
    $id('tb-level').className = 'cb-level' + (b.purgatory ? ' purgatory-boss' : '');
    setTextIfChanged($id('tb-level'), 'Lv.' + b.level);
  }
  setStyleIfChanged($id('tb-hp'), 'width', clamp(b.hp / b.maxHp * 100, 0, 100) + '%');
  var bSh = (b.shield > 0.5) ? '<span style="color:var(--info)">+' + fmt(Math.max(0, b.shield)) + '</span>' : '';
  setHtmlIfChanged($id('tb-hptext'), fmt(Math.max(0, b.hp)) + bSh + ' / ' + fmt(b.maxHp) + '（' + Math.round(b.hp / b.maxHp * 100) + '%）');
  setHtmlIfChanged($id('tb-status'), entStatus(b) + (b.attr && ELEM_INFO[b.attr] ? ' 屬性:' + ELEM_INFO[b.attr].emoji + (ELEM_INFO[b.attr].short || ELEM_INFO[b.attr].name) : (b.elem ? ' 屬性:' + ENCHANTS[b.elem].emoji : ''))); // 屬性語境用 short（聖非光）
  setStyleIfChanged($id('tp-hp'), 'width', clamp(p.hp / st.hp * 100, 0, 100) + '%');
  renderPlayerShieldBar('tp', p, st);
  setHtmlIfChanged($id('tp-hptext'), fmt(Math.max(0, p.hp)) + playerShieldText(p) + ' / ' + fmt(st.hp));
  setTextIfChanged($id('tp-status'), entStatus(p));
  renderMpSkill(p, 'tp', st, snapshot.gt);
  setTextIfChanged($id('tw-dps'), 'DPS ' + fmt(runtime.elapsed > 1 ? runtime.dmgDealt / runtime.elapsed : 0) +
    '（需求 ' + fmt(b.maxHp / towerTimeLimitWithTalents(runtime.floor)) + '）');
}

function uiRenderingSuspended() {
  return typeof document !== 'undefined' && document.hidden;
}

var UI_BATTLE_RENDER_IDLE_MS = 400;
var UI_INPUT_PROTECT_MS = 80;

function noteUiInteraction() {
  UI.lastInteractionAt = Date.now();
}

function shouldRenderBattle(now) {
  if (!UI.dirty.battle) return false;
  if (now - (UI.lastInteractionAt || 0) < UI_INPUT_PROTECT_MS) return false;
  var interval = UI.tab === 'tower' ? 200 : UI_BATTLE_RENDER_IDLE_MS;
  return now - (UI.lastBattleRenderAt || 0) >= interval;
}

function syncVfxQualityForTab() {
  if (typeof vfxSetQuality !== 'function') return;
  // 戰鬥中的特效仍保留基本命中效果，但不讓高塔 full tier 佔滿主執行緒。
  vfxSetQuality('reduced');
}

function markVisibleUiDirty() {
  Object.keys(UI.dirty).forEach(function (key) { UI.dirty[key] = true; });
  UI.battleLayoutDirty = true;
}

function handleVisibilityChange() {
  if (uiRenderingSuspended()) {
    // 背景分頁會暫停 CSS animation 與 timer；保留這些節點會讓過期的
    // 領域／光束／粒子在回到前景時一起恢復，形成特效堆積。
    if (typeof vfxSetEnabled === 'function') vfxSetEnabled(false);
    clearBackgroundEnemyFloats();
    return;
  }
  if (typeof vfxSetEnabled === 'function') vfxSetEnabled(true);
  clearBackgroundEnemyFloats();
  showBackgroundLatestEnemyFloat();
  markVisibleUiDirty();
  uiTick();
}

/* ---- 背包面板請求節流 ----
   掛機時掉落頻繁，Worker 幾乎每個 tick 都把 inv 標記為髒，主執行緒於是每秒向它索取 5 次
   背包面板。每一次的代價是一整條鏈：Worker 重建 427 件的投影（實測 122 KB）→ structured
   clone 跨執行緒 → 主執行緒比對格線 → renderInventory() 整份重建 DOM。實測 20 秒內重建
   60 次、累計 829 ms，佔全部渲染時間的 84%，其餘所有渲染函式加起來才 162 ms。

   節流放在**請求端**而不是重繪端：不要資料就不會有回應，上面四段成本一次全省。
   （前一版放在 uiTick 的重繪處，那時背包只由 dirty tick 驅動；現在面板回應會直接觸發
   重繪，放在重繪端會被整個繞過。）

   代價不只是 CPU：整份重建會把游標底下那一格換掉，於是 hover 掉、tooltip 閃、點擊有時
   沒中。所以指標停在格線上時要拉得更長——那時重建的代價最高，而玩家在看的是某一格的
   細節，不是清單有沒有新東西。

   ⚠️ 只節流「被動」請求，也就是 tick 回報髒區那條路徑。指令送出時自己要的那次請求絕對
   不能擋：sendUiCommand 會把該次請求的序號記進 waitPanels，等對應回應才放開單飛鎖。
   請求被吞掉，鎖永遠不會釋放，玩家的按鈕會全部失效——那是實際發生過的事故。

   被擋下的請求記在 _invReqPending，由 uiTick 補送。節流是延後，不是丟棄。 */
var INV_REQ_IDLE_MS = 1000;      // 純掛機時的最短請求間隔
var INV_REQ_HOVER_MS = 4000;     // 指標停在背包格線上時的最短間隔
var INV_REQ_INTERACT_MS = 800;   // 玩家操作後多久內完全不節流
var _invReqAt = 0;
var _invReqInteractAt = 0;
var _invReqPointerInGrid = false;
var _invReqPending = false;
var _invReqBound = false;

function bindInventoryRequestThrottle() {
  if (_invReqBound || typeof document === 'undefined') return;
  var box = $id('inventory-grid');
  if (!box) return;
  _invReqBound = true;
  // 頁面剛載入視同互動中：開機那幾百毫秒面板才陸續抵達，這段節流會讓玩家看到空背包
  _invReqInteractAt = Date.now();
  box.addEventListener('mouseenter', function () { _invReqPointerInGrid = true; });
  box.addEventListener('mouseleave', function () { _invReqPointerInGrid = false; });
  /* 捕獲階段收所有點擊與按鍵：不必逐一列舉哪些控制項會影響背包，
     漏列一個就會變成「某個按鈕按了要等一秒才有反應」這種很難查的問題。 */
  document.addEventListener('pointerdown', function () { _invReqInteractAt = Date.now(); }, true);
  document.addEventListener('keydown', function () { _invReqInteractAt = Date.now(); }, true);
}

function inventoryPassiveRequestAllowed() {
  bindInventoryRequestThrottle();
  var now = Date.now();
  if (now - _invReqInteractAt < INV_REQ_INTERACT_MS) return true;
  return now - _invReqAt >= (_invReqPointerInGrid ? INV_REQ_HOVER_MS : INV_REQ_IDLE_MS);
}

function noteInventoryPanelRequested() {
  _invReqAt = Date.now();
  _invReqPending = false;
}

function uiTick() {
  if (uiRenderingSuspended()) return;
  uiApplyGameTime(); // 先對時，之後這一輪所有到期判定與倒數都以同一個時間為準
  flushPendingLogDom();
  flushDirtyDetailLogs();
  /* 補送被節流擋下的背包面板請求。不補的話，掉落一旦停下來（暫停戰鬥、切場景），
     背包會一直停在最後一次請求時的內容。 */
  if (_invReqPending && inventoryPassiveRequestAllowed()) {
    /* 刻意不在這裡標記 UI.dirty.inv：資料還沒回來，標了只會讓同一輪 uiTick 立刻拿舊
       快照重畫一次，白花力氣。面板回應抵達時本來就會標記並直接重繪（見 MSG_OUT.PANEL）。 */
    noteInventoryPanelRequested();
    requestPanelData('inv', true);
  }
  var d = UI.dirty;
  // 分頁標題戰況（每秒更新一次即可）
  _titleTimer += 0.2;
  if (_titleTimer >= 1) { _titleTimer = 0; updateLiveTitle(); }
  if (d.header) { renderHeader(); d.header = false; }
  var now = Date.now();
  if (shouldRenderBattle(now)) {
    renderBattle(); // Keep combat visible, but yield briefly to equipment input.
    UI.lastBattleRenderAt = now;
    d.battle = false;
  }
  refreshBuffTooltip();
  var towerSnapshot = UI.tab === 'tower' ? uiTowerPanelSnapshot() : null;
  if (UI.tab === 'tower' && towerViewActive(towerSnapshot)) renderTowerFight();
  if (d.equip && UI.tab === 'equip') { renderEquip(); d.equip = false; }
  if (d.inv && UI.tab === 'equip') { renderInventory(); d.inv = false; }
  // 舊生產線頁已移除；零件庫/附魔書/強化統計變動（dirty.factory）一併驅動熔爐頁重繪
  if ((d.newforge || d.inv || d.factory) && UI.tab === 'newforge') { renderNewForge(); d.newforge = false; d.factory = false; d.inv = false; }
  if ((d.forge || d.inv || d.gems) && UI.tab === 'forge') {
    renderForge();
    d.forge = false;
    d.inv = false;
    d.gems = false;
  }
  var forgeSnapshot = UI.tab === 'forge' ? uiForgePanelSnapshot() : null;
  var forgeView = forgeViewState(forgeSnapshot);
  if (UI.tab === 'forge' && forgeView && forgeView.crafting) {
    renderForgeProgress(forgeView, uiInventoryPanelSnapshot(), uiGemsPanelSnapshot());
  }
  // 神鑄頁籤運行中小圖標：鑄造進行時旋轉顯示（不論目前所在分頁）
  var runInd = $id('forge-run-ind');
  if (runInd) {
    var indicatorSnapshot = forgeSnapshot ||
      peekUiPanelData('forge');
    var workerView = viewState();
    var forgeRunning = workerView
      ? !!workerView.forgeBusy
      : !!(indicatorSnapshot && indicatorSnapshot.forge && indicatorSnapshot.forge.crafting);
    if (forgeRunning !== (runInd.style.display !== 'none')) {
      runInd.style.display = forgeRunning ? '' : 'none';
    }
  }
  if (d.tower && UI.tab === 'tower') { renderTower(); d.tower = false; }
  if (d.gems && UI.tab === 'gems') { renderGems(); d.gems = false; }
  if (UI.tab === 'gems') updateShopCountdown(); // 商店重置倒數即時更新
  if (d.skills && UI.tab === 'skills') { renderSkills(); d.skills = false; }
  if (d.talents && UI.tab === 'talents') { renderTalents(); d.talents = false; }

  // 本地測試服承傷顯示實時更新
  var host = window.location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLocal) {
    updateDmgAbsorb();
  }
}

// 本地測試服：實時更新物理與魔法傷害、總承傷及明細提示 (Tooltip)
function updateDmgAbsorb() {
  var physEl = $id('r-phys-absorb');
  var magicEl = $id('r-magic-absorb');
  var physDmgEl = $id('r-phys-dmg');
  var magicDmgEl = $id('r-magic-dmg');
  if (!physEl || !magicEl) return;

  var headerSnapshot = uiHeaderPanelSnapshot() || {};
  var battleSnapshot = uiBattlePanelSnapshot() || {};
  var st = headerSnapshot.viewStats || headerSnapshot.stats || {};
  var pEnt = battleSnapshot.field && battleSnapshot.field.player;
  var isActive = true;
  var hp = (isActive && pEnt && typeof pEnt.hp === 'number') ? pEnt.hp : st.hp;
  var shield = (isActive && pEnt && typeof pEnt.shield === 'number') ? pEnt.shield : 0;

  // 輸出端物傷/魔傷計算（包含暴傷、總傷%、敵種加成與六系屬性平均加成）
  var critMult = (st.critDmg || 150) / 100;
  var totalDmgMult = 1 + (st.totalDmgPct || 0) / 100;
  var maxEnemyDmg = Math.max(st.normalDmg || 0, st.eliteDmg || 0, st.bossDmg || 0);
  var enemyDmgMult = 1 + maxEnemyDmg / 100;

  // 1. 第一種屬性加成：對屬性敵人傷害% (取全系最大值)
  var elemKeys = (typeof ELEMENTS !== 'undefined') ? ELEMENTS : ['fire', 'ice', 'lightning', 'poison', 'light', 'dark', 'earth'];
  var maxVsElem = 0;
  for (var i = 0; i < elemKeys.length; i++) {
    var k1 = elemKeys[i];
    var val1 = (st.dmgVsElem && typeof st.dmgVsElem[k1] === 'number')
      ? st.dmgVsElem[k1]
      : (Number(st['dmgVs' + k1.charAt(0).toUpperCase() + k1.slice(1)]) || 0);
    if (val1 > maxVsElem) maxVsElem = val1;
  }
  var vsElemMult = 1 + maxVsElem / 100;

  // 2. 第二種屬性加成：屬性傷害提升% (取全系最大值)
  var maxElemUp = 0;
  for (var j = 0; j < elemKeys.length; j++) {
    var k2 = elemKeys[j];
    var val2 = (st.elemDmgUp && typeof st.elemDmgUp[k2] === 'number')
      ? st.elemDmgUp[k2]
      : (Number(st['elemDmg' + k2.charAt(0).toUpperCase() + k2.slice(1)]) || 0);
    if (val2 > maxElemUp) maxElemUp = val2;
  }
  var elemUpMult = 1 + maxElemUp / 100;

  var physDmgVal = (st.atk || 0) * critMult * totalDmgMult * enemyDmgMult * vsElemMult * elemUpMult;
  var magicDmgVal = (st.matk || 0) * critMult * totalDmgMult * enemyDmgMult * vsElemMult * elemUpMult;

  if (physDmgEl) {
    physDmgEl.textContent = fmt(physDmgVal);
    var physDmgParent = physDmgEl.parentNode;
    if (physDmgParent) {
      physDmgParent.setAttribute('data-tt-title', '物理單次預期傷害 (物傷)');
      var physDmgDesc = '角色單次物理傷害輸出（綜合極限水準）。<br>' +
        '公式：基礎物攻 × 暴傷倍率 × 總傷% × 敵種加成% × 對屬性敵最大% × 屬性提升最大%<br><br>' +
        '<span style="color:#4ade80">基礎物理攻擊：</span>' + fmtFull(st.atk || 0) + '<br>' +
        '<span style="color:#ffd700">暴擊傷害倍率：</span>' + Math.round(st.critDmg || 150) + '%<br>' +
        '<span style="color:#ffd700">總傷害加成：</span>' + (st.totalDmgPct || 0) + '%<br>' +
        '<span style="color:#ffd700">敵種最大加成：</span>' + maxEnemyDmg + '%<br>' +
        '<span style="color:#ffd700">對屬性敵最大加成：</span>' + maxVsElem.toFixed(1) + '%<br>' +
        '<span style="color:#ffd700">屬性傷害最大提升：</span>' + maxElemUp.toFixed(1) + '%<br><br>' +
        '<span style="color:#ffd700">物理單次預期傷害：</span>' + fmtFull(physDmgVal);
      physDmgParent.setAttribute('data-tt-desc', physDmgDesc);
      physDmgParent.removeAttribute('title');
    }
  }
  if (magicDmgEl) {
    magicDmgEl.textContent = fmt(magicDmgVal);
    var magicDmgParent = magicDmgEl.parentNode;
    if (magicDmgParent) {
      magicDmgParent.setAttribute('data-tt-title', '魔法單次預期傷害 (魔傷)');
      var magicDmgDesc = '角色單次魔法傷害輸出（綜合極限水準）。<br>' +
        '公式：基礎魔攻 × 暴傷倍率 × 總傷% × 敵種加成% × 對屬性敵最大% × 屬性提升最大%<br><br>' +
        '<span style="color:#4ade80">基礎魔法攻擊：</span>' + fmtFull(st.matk || 0) + '<br>' +
        '<span style="color:#ffd700">暴擊傷害倍率：</span>' + Math.round(st.critDmg || 150) + '%<br>' +
        '<span style="color:#ffd700">總傷害加成：</span>' + (st.totalDmgPct || 0) + '%<br>' +
        '<span style="color:#ffd700">敵種最大加成：</span>' + maxEnemyDmg + '%<br>' +
        '<span style="color:#ffd700">對屬性敵最大加成：</span>' + maxVsElem.toFixed(1) + '%<br>' +
        '<span style="color:#ffd700">屬性傷害最大提升：</span>' + maxElemUp.toFixed(1) + '%<br><br>' +
        '<span style="color:#ffd700">魔法單次預期傷害：</span>' + fmtFull(magicDmgVal);
      magicDmgParent.setAttribute('data-tt-desc', magicDmgDesc);
      magicDmgParent.removeAttribute('title');
    }
  }

  var attackerLevel = st.level || 1;
  var defMul = 1 + (isActive && pEnt && typeof buffVal === 'function' ? buffVal(pEnt, 'defUp') : 0) / 100;

  // 各類減傷率
  var rPhysDef = defReduction((st.def * defMul) || 0, attackerLevel);
  var rMagicDef = defReduction((st.mdef * defMul) || 0, attackerLevel);
  var rPhysRes = physicalResistanceReduction(st.pRes || 0, attackerLevel);
  var rMagicRes = magicResistanceReduction(st.mRes || 0, attackerLevel);
  var dmgRedRaw = st.passives && st.passives.sanctuary ? st.passives.sanctuary : 0;
  var rSanctuary = dmgRedRaw ? (clamp(dmgRedRaw, 0, 50) / 100) : 0;
  var rGlobal = globalDamageReduction(st.globalDmgRed || 0);

  var rNormal = enemyTypeDamageReduction(st.normalDmgRed || 0, attackerLevel);
  var rElite = enemyTypeDamageReduction(st.eliteDmgRed || 0, attackerLevel);
  var rBoss = enemyTypeDamageReduction(st.bossDmgRed || 0, attackerLevel);
  var rTypeMax = Math.max(rNormal, rElite, rBoss);

  var typeMaxLabel = '';
  if (rTypeMax > 0) {
    if (rTypeMax === rBoss) typeMaxLabel = ' (BOSS傷害抗性)';
    else if (rTypeMax === rElite) typeMaxLabel = ' (菁英傷害抗性)';
    else typeMaxLabel = ' (普通敵人傷害抗性)';
  }

  // 元素抗性減傷（全部元素取平均；除數跟著元素數走，加屬性不必回頭改分母）
  var elems = elemKeys;
  var elemRedSum = 0;
  for (var i = 0; i < elems.length; i++) {
    var resVal = (st.resist && st.resist[elems[i]]) || 0;
    elemRedSum += typeof elementalResistanceReduction === 'function' ? elementalResistanceReduction(resVal, attackerLevel) : 0;
  }
  var rElemAvg = elems.length ? elemRedSum / elems.length : 0;

  // 剩餘比例 (1 - 減傷)
  var physMult = (1 - rPhysDef) * (1 - rPhysRes) * (1 - rSanctuary) * (1 - rGlobal) * (1 - rTypeMax) * (1 - rElemAvg);
  var magicMult = (1 - rMagicDef) * (1 - rMagicRes) * (1 - rSanctuary) * (1 - rGlobal) * (1 - rTypeMax) * (1 - rElemAvg);

  var physAbsorb = physMult > 0 ? (hp + shield) / physMult : Infinity;
  var magicAbsorb = magicMult > 0 ? (hp + shield) / magicMult : Infinity;

  // 更新 UI：只顯示簡寫
  physEl.textContent = physAbsorb === Infinity ? '∞' : fmt(physAbsorb);
  magicEl.textContent = magicAbsorb === Infinity ? '∞' : fmt(magicAbsorb);

  var formatRed = function (v, startDec) {
    var dec = startDec || 4;
    if (v >= 1) return '100%';
    if (v <= 0) return (0).toFixed(dec) + '%';
    var pct = v * 100;
    var s = pct.toFixed(dec);
    while (((parseFloat(s) >= 100 && v < 1) || /^99\.9+$/.test(s)) && dec < 15) {
      dec++;
      s = pct.toFixed(dec);
    }
    return s + '%';
  };

  // 更新 tooltip
  var physParent = physEl.parentNode;
  var magicParent = magicEl.parentNode;
  if (physParent) {
    physParent.setAttribute('data-tt-title', '物理總承傷');
    var physDesc = '角色能承受的一次性最大物理傷害值。<br>' +
      '公式：(血量+護盾)/(1-各類減傷)<br><br>' +
      '<span style="color:#4ade80">當前血量：</span>' + fmtFull(hp) + '<br>' +
      '<span style="color:#4ade80">當前護盾：</span>' + fmtFull(shield) + '<br>' +
      '<span style="color:#ffd700">物理防禦減傷：</span>' + formatRed(rPhysDef) + '<br>' +
      '<span style="color:#ffd700">物理抗性減傷：</span>' + formatRed(rPhysRes) + '<br>' +
      '<span style="color:#ffd700">聖佑被動減傷：</span>' + formatRed(rSanctuary, 2) + '<br>' +
      '<span style="color:#ffd700">全局減傷：</span>' + formatRed(rGlobal) + '<br>' +
      '<span style="color:#ffd700">元素抗性減傷：</span>' + formatRed(rElemAvg) + '<br>' +
      '<span style="color:#ffd700">敵種最大減傷：</span>' + formatRed(rTypeMax) + typeMaxLabel + '<br><br>' +
      '<span style="color:#ffd700">物理承傷總值：</span>' + (physAbsorb === Infinity ? '無窮大' : fmtFull(physAbsorb));
    physParent.setAttribute('data-tt-desc', physDesc);
    physParent.removeAttribute('title');
  }
  if (magicParent) {
    magicParent.setAttribute('data-tt-title', '魔法總承傷');
    var magicDesc = '角色能承受的一次性最大魔法傷害值。<br>' +
      '公式：(血量+護盾)/(1-各類減傷)<br><br>' +
      '<span style="color:#4ade80">當前血量：</span>' + fmtFull(hp) + '<br>' +
      '<span style="color:#4ade80">當前護盾：</span>' + fmtFull(shield) + '<br>' +
      '<span style="color:#ffd700">魔法防禦減傷：</span>' + formatRed(rMagicDef) + '<br>' +
      '<span style="color:#ffd700">魔法抗性減傷：</span>' + formatRed(rMagicRes) + '<br>' +
      '<span style="color:#ffd700">聖佑被動減傷：</span>' + formatRed(rSanctuary, 2) + '<br>' +
      '<span style="color:#ffd700">全局減傷：</span>' + formatRed(rGlobal) + '<br>' +
      '<span style="color:#ffd700">元素抗性減傷：</span>' + formatRed(rElemAvg) + '<br>' +
      '<span style="color:#ffd700">敵種最大減傷：</span>' + formatRed(rTypeMax) + typeMaxLabel + '<br><br>' +
      '<span style="color:#ffd700">魔法承傷總值：</span>' + (magicAbsorb === Infinity ? '無窮大' : fmtFull(magicAbsorb));
    magicParent.setAttribute('data-tt-desc', magicDesc);
    magicParent.removeAttribute('title');
  }
}


function uiBattlePanelSnapshot() {
  return panelData('battle');
}

function uiTalentPanelSnapshot() {
  return panelData('talents');
}

function uiHeaderPanelSnapshot() {
  return panelData('header');
}

function uiTowerPanelSnapshot() {
  return panelData('tower');
}

function uiNewForgePanelSnapshot() {
  return panelData('newforge');
}

function uiFactoryPanelSnapshot() {
  return panelData('factory');
}

/* Worker-only UI helpers.  These deliberately consume Snapshot data instead
 * of calling simulation queries whose implementations read the main-thread G.
 */
function uiReincarnationCount(headerSnapshot) {
  var header = headerSnapshot || uiHeaderPanelSnapshot();
  var player = header && header.player;
  var max = typeof REINCARNATION_MAX === 'number' ? REINCARNATION_MAX : 20;
  return clamp(Math.floor(Number(player && player.reincarnations) || 0), 0, max);
}

function uiCurrentZoneDef(headerSnapshot) {
  var header = headerSnapshot || uiHeaderPanelSnapshot();
  var zone = header && header.stage && header.stage.zone || 'desert';
  return ZONES[zone] || ZONES.desert || { name: zone, emoji: '' };
}

function uiPotentialLevelFromSnapshot(talentSnapshot, id, maxLv) {
  return talentViewPotentialLevel(talentSnapshot, id,
    maxLv === undefined ? skillViewPotentialMaxLevel(uiReincarnationCount()) : maxLv);
}

function uiProjectedItemScore(item) {
  if (!item) return 0;
  var score = 0;
  var multiplier = typeof upgradeMult === 'function' ? upgradeMult(item) : 1;
  (item.affixes || []).forEach(function (affix) {
    // 詞條值由強度值當場算（affixValue → js/formula.js §6）；formula.js 未載入時以 0 計
    var av = typeof affixValue === 'function' ? affixValue(item, affix) : 0;
    score += (SCORE_WEIGHTS[affix.key] || 1) * av * multiplier;
  });
  (item.sockets || []).forEach(function (socket) {
    if (!socket) return;
    if (socket.fused && Array.isArray(socket.fused.stats)) {
      socket.fused.stats.forEach(function (stat) {
        var gemDef = GEM_TYPES[stat.type];
        var sv = typeof fusedStatValue === 'function' ? fusedStatValue(stat) : (Number(stat.val) || 0);
        score += sv * (SCORE_WEIGHTS[gemDef && gemDef.stat] || 1);
      });
    } else if (GEM_TYPES[socket.type]) {
      var plainGem = GEM_TYPES[socket.type];
      score += gemStatValue(socket.type, socket.level) * (SCORE_WEIGHTS[plainGem.stat] || 1);
    }
  });
  if (item.passive) score *= 1.15;
  if (item.godPassives) score *= 1 + 0.15 * item.godPassives.length;
  var enchants = item.enchants || item.enchant ? (typeof itemEnchants === 'function' ? itemEnchants(item) : []) : [];
  enchants.forEach(function (enchant) {
    var def = ENCHANTS[enchant.key];
    var env = typeof enchantValue === 'function' ? enchantValue(item, enchant) : 0;
    if (def) score += (def.cat === 'atk' ? 1.2 : 2) * env;
  });
  return score;
}

function uiEquipTargetSlotFromSnapshot(item, equipment) {
  if (!item) return null;
  var candidates = typeof equipSlotsForItem === 'function'
    ? equipSlotsForItem(item).slice()
    : [item.slot];
  if (!candidates.length) return null;
  if (UI.lastEquipSlot && candidates.indexOf(UI.lastEquipSlot) >= 0) return UI.lastEquipSlot;
  var eq = equipment || {};
  for (var i = 0; i < candidates.length; i++) {
    if (!eq[candidates[i]]) return candidates[i];
  }
  var best = candidates[0];
  var bestScore = Infinity;
  candidates.forEach(function (slot) {
    var score = uiProjectedItemScore(eq[slot]);
    if (score < bestScore) { bestScore = score; best = slot; }
  });
  return best;
}

function uiForgePanelSnapshot() {
  return panelData('forge');
}

function uiInventoryPanelSnapshot() {
  return panelData('inv');
}

function uiEquipPanelSnapshot() {
  return panelData('equip');
}

function equipViewEquipment(snapshot) {
  if (!snapshot) return {};
  var view = typeof snapshot.equipView === 'number' ? snapshot.equipView : (snapshot.equipActive || 0);
  return Array.isArray(snapshot.sets) && snapshot.sets[view]
    ? snapshot.sets[view]
    : (snapshot.equipment || {});
}

function inventoryViewItems(snapshot) {
  return snapshot && Array.isArray(snapshot.items) ? snapshot.items : [];
}

// Compare only fields used by itemCellHTML.  Inventory detail responses keep
// these summaries unchanged, so the existing grid can remain mounted while
// the requested full item is added to `details`.
function inventoryGridSnapshotEqual(previous, next) {
  if (!previous || !next || Number(previous.count) !== Number(next.count) ||
    Number(previous.cap) !== Number(next.cap)) return false;
  var a = inventoryViewItems(previous);
  var b = inventoryViewItems(next);
  if (a.length !== b.length) return false;
  var fields = ['id', 'rarity', 'slot', 'level', 'upgrade', 'synthesized',
    'locked', 'name', 'weaponType', 'enchant', 'enchants', 'kind', 'ancientCount'];
  for (var i = 0; i < a.length; i++) {
    if (!a[i] || !b[i]) return false;
    for (var j = 0; j < fields.length; j++) {
      var field = fields[j];
      var av = a[i][field], bv = b[i][field];
      if (av === bv) continue;
      if (((av && typeof av === 'object') || (bv && typeof bv === 'object')) &&
        JSON.stringify(av) === JSON.stringify(bv)) continue;
      return false;
    }
  }
  return true;
}

function inventoryViewHasFullDetails(snapshot) {
  return !!(snapshot && snapshot.details &&
    Object.keys(snapshot.details).length >= Number(snapshot.count || 0));
}

function inventoryViewItem(snapshot, id, detailed) {
  if (!snapshot || !id) return null;
  if (snapshot.details && snapshot.details[id]) return snapshot.details[id];
  // Summary cells do not contain affixes.  Detailed callers (the item pane
  // and item tooltip) must wait for the requested detailIds response instead
  // of handing an incomplete item to itemDetailHTML.
  if (detailed) return null;
  var items = inventoryViewItems(snapshot);
  for (var i = 0; i < items.length; i++) if (items[i] && items[i].id === id) return items[i];
  return null;
}

function equipSetViewLabel(snapshot, index) {
  var custom = snapshot && Array.isArray(snapshot.equipSetNames) && snapshot.equipSetNames[index]
    ? String(snapshot.equipSetNames[index]).trim()
    : '';
  return custom || (typeof equipSetName === 'function' ? equipSetName(index) : ('第' + (index + 1) + '套'));
}

function uiGemsPanelSnapshot() {
  return panelData('gems');
}

function resolveGemsPanelSnapshot(snapshot) {
  return snapshot && snapshot.gems && typeof snapshot.gems === 'object'
    ? snapshot
    : uiGemsPanelSnapshot();
}

function gemsViewCount(snapshot, type, level) {
  var byType = snapshot && snapshot.gems && snapshot.gems[type];
  return Math.max(0, Number(byType && byType[level]) || 0);
}

function gemsViewFused(snapshot) {
  return snapshot && Array.isArray(snapshot.fusedGems) ? snapshot.fusedGems : [];
}

function gemsViewFindFused(snapshot, id) {
  var list = gemsViewFused(snapshot);
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].id === id) return list[i];
  }
  return null;
}

function gemsViewNormalizeFuseMaterial(snapshot, ref) {
  if (!ref) return null;
  if (ref.kind === 'plain') {
    var level = ref.lv || GEM_MAX_LEVEL;
    if (level < GEM_MAX_LEVEL || level > GEM_FORGE_MAX_LEVEL ||
      gemsViewCount(snapshot, ref.type, level) < 1) {
      return null;
    }
    return {
      stats: [{ type: ref.type, mult: Math.pow(2, level - GEM_MAX_LEVEL) }],
      fusions: 0,
      leaves: Math.pow(2, level - GEM_MAX_LEVEL),
      ref: ref
    };
  }
  var fused = gemsViewFindFused(snapshot, ref.id);
  if (!fused) return null;
  return {
    stats: fused.stats,
    fusions: fused.fusions || 0,
    leaves: fused.leaves || ((fused.fusions || 0) + 1),
    ref: ref
  };
}

function gemsViewShopRefreshCost(shop) {
  var resetNo = (Number(shop && shop.refreshCount) || 0) + 1;
  return Math.round(GEM_SHOP_REFRESH_BASE * Math.pow(resetNo, GEM_SHOP_REFRESH_EXPONENT));
}

function gemsViewShopCountdown(shop) {
  var hourStart = Number(shop && shop.hourStart) || Date.now();
  return Math.max(0, Math.ceil(
    (hourStart + GEM_SHOP_REFRESH_HOURS * 3600 * 1000 - Date.now()) / 1000
  ));
}

function forgeViewState(snapshot) {
  return snapshot && snapshot.forge;
}

function forgeViewSlots(forge) {
  return forge && Array.isArray(forge.slots) ? forge.slots : [];
}

function forgeViewItemCount(forge) {
  return forgeViewSlots(forge).filter(function (item) { return !!item; }).length;
}

function forgeViewMode(forge) {
  var slots = forgeViewSlots(forge);
  for (var i = 0; i < slots.length; i++) {
    if (slots[i]) return slots[i].kind === 'gem' ? 'gem' : 'equip';
  }
  return null;
}

function forgeViewDustCount(forge, player) {
  var slots = forge && Array.isArray(forge.dustSlots) ? forge.dustSlots : [];
  var placed = slots.filter(function (on) { return !!on; }).length;
  return Math.min(placed, Math.max(0, Number(player && player.dust) || 0));
}

function forgeViewGemCount(gemsSnapshot, type, level) {
  var byType = gemsSnapshot && gemsSnapshot.gems && gemsSnapshot.gems[type];
  return Math.max(0, Number(byType && byType[level]) || 0);
}

function forgeViewTotalGems(gemsSnapshot) {
  var total = 0;
  for (var type in GEM_TYPES) {
    for (var level = 1; level <= GEM_FORGE_MAX_LEVEL; level++) {
      total += forgeViewGemCount(gemsSnapshot, type, level);
    }
  }
  return total;
}

function forgeViewRateInfo(forge, player) {
  var mode = forgeViewMode(forge);
  if (!mode) return null;
  var slots = forgeViewSlots(forge);
  var first = slots.filter(function (item) { return !!item; })[0];
  if (!first) return null;
  var dustN = forgeViewDustCount(forge, player);
  if (mode === 'gem') {
    return {
      mode: 'gem',
      base: FORGE_GEM_BASE_RATE[first.level] || 0,
      dust: dustN * FORGE_GEM_DUST_RATE,
      total: forgeGemSuccessRateFor(first.level, dustN),
      cost: forgeGemCost(first.level)
    };
  }
  return {
    mode: 'equip',
    base: forgeBaseRateFor(first.rarity),
    dust: dustN * forgeDustRateFor(first.rarity),
    total: forgeSuccessRateFor(first.rarity, dustN),
    cost: forgeGoldCostFor(first.rarity)
  };
}

function forgeViewAutoFillLabel(forge) {
  var autoFill = forge && forge.autoFill;
  if (!autoFill) return null;
  if (autoFill.kind === 'gem') return gemLabel(autoFill.type, autoFill.level);
  return (RARITIES[autoFill.rarity] ? RARITIES[autoFill.rarity].name : '') + '裝備';
}

function forgeViewRemainInfo(forge, inventorySnapshot, gemsSnapshot) {
  var slots = forgeViewSlots(forge);
  var first = slots.filter(function (item) { return !!item; })[0];
  var spec = forge && forge.autoFill;
  if (!spec && first) {
    spec = first.kind === 'gem'
      ? { kind: 'gem', type: first.type, level: first.level }
      : { kind: 'equip', rarity: first.rarity };
  }
  if (!spec) return null;
  if (spec.kind === 'gem') {
    return {
      label: gemLabel(spec.type, spec.level),
      count: forgeViewGemCount(gemsSnapshot, spec.type, spec.level)
    };
  }
  var items = inventorySnapshot && inventorySnapshot.items || [];
  var count = items.filter(function (item) {
    return item && item.rarity === spec.rarity && !item.locked && item.kind !== 'gem';
  }).length;
  return {
    label: (RARITIES[spec.rarity] ? RARITIES[spec.rarity].name : '') + '裝備',
    count: count
  };
}

function newForgeViewFurnace(snapshot, furnaceId) {
  var furnaces = snapshot && snapshot.newForge && snapshot.newForge.furnaces;
  if (!Array.isArray(furnaces)) return null;
  for (var i = 0; i < furnaces.length; i++) {
    if (furnaces[i] && furnaces[i].id === furnaceId) return furnaces[i];
  }
  return null;
}

function towerViewActive(snapshot) {
  return !!(snapshot && snapshot.tower && snapshot.tower.active);
}

var UI_FAILED_BOSS_IMAGES = Object.create(null);

function towerBossImageFailed(imageName) {
  return !!(imageName && UI_FAILED_BOSS_IMAGES[imageName]);
}

function markTowerBossImageFailed(imageName) {
  if (imageName) UI_FAILED_BOSS_IMAGES[imageName] = true;
}

function talentViewReincarnations(snapshot) {
  return Math.max(0, Math.floor(Number(snapshot && snapshot.reincarnations) || 0));
}

function talentViewLevels(snapshot) {
  return snapshot && snapshot.talents && snapshot.talents.levels
    ? snapshot.talents.levels
    : {};
}

function talentViewPotentialLevels(snapshot) {
  return snapshot && snapshot.talents && snapshot.talents.potentialLevels
    ? snapshot.talents.potentialLevels
    : {};
}

function talentViewLevel(snapshot, id) {
  var value = talentViewLevels(snapshot)[id];
  return clamp(Math.floor(Number(value) || 0), 0, TALENT_MAX_LEVEL);
}

function talentViewPotentialLevel(snapshot, id, maxLv) {
  var value = talentViewPotentialLevels(snapshot)[id];
  return clamp(Math.floor(Number(value) || 0), 0, Math.max(0, maxLv || 0));
}

function talentViewUnlocked(snapshot, id) {
  var turn = talentTurn(id);
  return turn > 0 &&
    turn <= TALENT_IMPLEMENTED_REINCARNATIONS &&
    talentViewReincarnations(snapshot) >= turn;
}

function talentViewTreeLevelTotal(snapshot, turn) {
  return (TALENT_TREES[turn] || []).reduce(function (sum, def) {
    return sum + talentViewLevel(snapshot, def.id);
  }, 0);
}

function talentViewTreeComplete(snapshot, turn) {
  var tree = TALENT_TREES[turn] || [];
  // 與 talentTreeComplete（js/talents.js）同一判斷：有節點且全滿，不看節點數量。
  return tree.length > 0 && tree.every(function (def) {
    return talentViewLevel(snapshot, def.id) >= TALENT_MAX_LEVEL;
  });
}

function talentViewCompleteMultiplier(snapshot, turn) {
  return talentViewTreeComplete(snapshot, turn) ? 2 : 1;
}

function talentViewPotentialUnlockLimit(snapshot) {
  var count = 0;
  potentialUnlockTalentIds().forEach(function (id) {
    var def = talentDef(id);
    if (def) count += potentialCountForLevel(def, talentViewLevel(snapshot, id));
  });
  return clamp(count, 0, POTENTIAL_NODE_COUNT);
}

function talentViewPotentialUnlocked(snapshot, id) {
  var index = POTENTIAL_TALENTS.map(function (def) { return def.id; }).indexOf(id);
  return index >= 0 &&
    index < talentViewPotentialUnlockLimit(snapshot) &&
    !potentialTemporarilyDisabled(id);
}

function talentViewPotentialUnlockedCount(snapshot) {
  var limit = talentViewPotentialUnlockLimit(snapshot);
  return POTENTIAL_TALENTS.slice(0, limit).filter(function (def) {
    return !potentialTemporarilyDisabled(def.id);
  }).length;
}

function pendingUiButtonAttributes(key) {
  return ' data-ui-pending-key="' + esc(key) + '"' +
    (isUiCommandPending(key) ? ' disabled' : '');
}

function uiCommandResultError(result) {
  if (typeof result === 'string') return result || null;
  return result && result.err ? result.err : null;
}

function requestUiPanels(keys) {
  (keys || []).forEach(function (key) {
    requestPanelData(key, true);
  });
}

function reportUiCommandFailure(prefix, error, panels) {
  var restartMessage = error && error.message ? String(error.message) : String(error || '');
  if (restartMessage.indexOf('worker-restart:') === 0) return;
  var message = error && error.message ? error.message : String(error || '未知錯誤');
  blog('⚠️ ' + prefix + '：' + message, 'warn');
  requestUiPanels(panels);
}

function sendGemUiCommand(commandName, args, pendingRef, panels, onSuccess) {
  panels = panels || ['gems', 'header'];
  return sendUiCommand(commandName, args, {
    keys: nodePendingKey(pendingRef),
    panels: panels
  }).then(function (result) {
    var error = uiCommandResultError(result);
    if (error) {
      reportUiCommandFailure('寶石操作失敗', error, panels);
      return null;
    }
    if (onSuccess) onSuccess(result);
    return result;
  }, function (error) {
    reportUiCommandFailure('寶石操作失敗', error, panels);
    return null;
  });
}

function runTalentUiAction(commandName, id, legacyAction) {
  if (false) {
    var legacyError = legacyAction(id);
    if (legacyError) blog('⚠️ ' + legacyError, 'warn');
    renderTalents();
    return;
  }

  var panels = ['talents', 'header'];
  sendUiCommand(commandName, { id: id }, {
    keys: nodePendingKey('talent:' + id),
    panels: panels
  }).then(function (result) {
    var error = uiCommandResultError(result);
    if (error) reportUiCommandFailure('天賦操作失敗', error, panels);
  }, function (error) {
    reportUiCommandFailure('天賦操作失敗', error, panels);
  });
}


function talentNodeHTML(def, turn, snapshot) {
  var lv = snapshot ? talentViewLevel(snapshot, def.id) : 0;
  var unlocked = snapshot ? talentViewUnlocked(snapshot, def.id) : false;
  var disabled = !!def.disabled;
  var reincarnations = snapshot ? talentViewReincarnations(snapshot) : 0;
  var lockText = disabled ? (def.disabledReason || '目前暫不開放升級') : (reincarnations < turn ? '需 ' + turn + ' 轉' : '尚未開放');
  var locked = !unlocked || disabled;
  var aria = def.name + (disabled ? '（' + lockText + '）' : '');
  return '<button type="button" class="talent-icon' + (lv > 0 ? ' learned' : '') + (lv >= TALENT_MAX_LEVEL ? ' maxed' : '') + (locked ? ' locked' : '') + (disabled ? ' temporarily-disabled' : '') + '" data-talent-select="talent:' + def.id + '" data-talent-tip="' + def.id + '" aria-label="' + esc(aria) + '">' +
    '<span class="talent-icon-glyph">' + def.emoji + '</span>' +
    '<span class="talent-icon-level">Lv.' + lv + '/' + TALENT_MAX_LEVEL + '</span>' +
    (locked ? '<span class="talent-icon-lock">🔒 ' + lockText + '</span>' : '') +
    '</button>';
}

/* 潛力技能 V3：類型標籤與「當前等級效果」文字（供面板/提示/彈窗共用）。 */
function potentialTypeLabel(def) {
  return def && def.type === 'active' ? '主動' : (def && def.type === 'passiveTrigger' ? '被動觸發' : '被動');
}
// 潛力技能傷害類型標籤（雷霆過載＝魔法、必殺一擊＝物理）；無傷害型回空字串。
function potentialDmgLabel(def) {
  return def && def.dmgType ? '·' + (def.dmgType === 'magic' ? '魔法' : (def.dmgType === 'phys' ? '物理' : '真實')) : '';
}
/* 潛力技能描述（供共用的 describeSkill → 技能提示/升級面板呼叫）：
   比照一般技能 describeSkill——效果直接寫在說明內、當前數值內嵌；
   會隨升級變動的數值用 g()（藍），固定值用 s()（橘）。 */
function describePotentialSkill(def, lv) {
  if (!def) return '';
  lv = Math.max(1, lv || 1);
  var v = potentialSkillValue(def, lv);
  function g(x) { return '<span class="txt-grow">' + fmt1(x) + '</span>'; }      // 藍：升級會變動
  function s(x) { return '<span class="txt-static">' + x + '</span>'; }          // 橘：固定值
  switch (def.mech) {
    case 'aspd': {
      var headerSnapshot = uiHeaderPanelSnapshot();
      var stats = headerSnapshot && headerSnapshot.stats;
      var base = stats ? (stats.aspdBonusBase || 0) : 0;
      var total = base + v;
      var perSec = (typeof ASPD_BASE !== 'undefined' ? ASPD_BASE : 1) * (1 + total / 100); // 突破上限後的實際攻速（次/秒）
      return s(def.dur || 6) + ' 秒內突破 ' + s(5) + ' 次/秒攻速上限：攻速加成 +' + g(v) + '%，期間攻速總加成 ' + g(total) + '%（含玩家原始攻速，約 ' + g(perSec) + ' 次/秒）';
    }
    case 'chainLightning': {
      var atkPct = (def.atkBase || 0) + (def.atkPer || 0) * lv;
      return '凝聚過載雷霆轟落敵陣：造成 ' + g(atkPct) + '% 魔攻的' + s('魔法傷害') + '（' + s('電屬性佔 100%') + '），於敵群間彈跳 ' + s(def.bounces || 5) + ' 次、每跳皆為完整傷害，且 ' + s(def.dur || 8) + ' 秒內' + s('每 1 秒') + '持續轟擊一輪；期間雷電系整體傷害額外提高 ' + g(v) + '%（含此技能自身），雷電技能命中追加 ' + s(3) + '＋連擊數 次連鎖、每次 ' + s(10) + '% 該擊傷害';
    }
    case 'cdrUncap':
      return '所有技能的冷卻縮減額外提高 ' + g(v) + '%，可突破 ' + s(60) + '% 上限，持續 ' + s(def.dur || 3) + ' 秒';
    case 'invuln':
      return '展開無敵結界 ' + g(v) + ' 秒，期間免疫所有傷害與負面效果';
    case 'undyingGuard':
      return '受致命傷害時免除死亡並獲得 ' + s(1) + ' 秒無敵；觸發後冷卻 ' + g(Math.max(1, 90 - v)) + ' 秒（不受冷卻縮減影響）';
    case 'enemySlow':
      return '使敵人攻速降低 ' + g(v) + '%，持續 ' + s(def.dur || 8) + ' 秒';
    case 'crossCore':
      return '所有物理技能額外獲得 ' + g(v) + '% 魔法攻擊力、所有魔法技能額外獲得 ' + g(v) + '% 物理攻擊力';
    case 'omega':
      return '打出必殺一擊，造成 爆擊率% × ' + g(v) + '% 物攻 的' + s('物理傷害') + '（爆擊率愈高、傷害愈高）';
    case 'sacredInvert':
      return '生命與法力回復額外提高 ' + g(v) + '%，且溢出的回復量有 ' + g(v) + '% 轉為對敵造成真實傷害，持續 ' + s(def.dur || 6) + ' 秒';
    case 'timeStop':
      return '令所有敵人靜止行動（' + s('不可被免疫') + '，含 BOSS），期間你的所有傷害提高 ' + g(v) + '%，持續 ' + s(def.dur || 8) + ' 秒';
  }
  return esc(def.desc || '');
}

function potentialNodeHTML(def, index, talentSnapshot, headerSnapshot) {
  if (!def) return '';
  var usingSnapshot = !!talentSnapshot;
  var reincarnations = usingSnapshot
    ? skillViewReincarnations(headerSnapshot, talentSnapshot)
    : 0;
  var max = usingSnapshot
    ? skillViewPotentialMaxLevel(reincarnations)
    : 0;
  var lv = usingSnapshot
    ? talentViewPotentialLevel(talentSnapshot, def.id, max)
    : 0;
  var unlocked = usingSnapshot
    ? talentViewPotentialUnlocked(talentSnapshot, def.id)
    : false;
  var disabled = potentialTemporarilyDisabled(def.id);
  var cls = 'tree-cell potential-icon' + (lv > 0 ? ' learned' : '') + (!unlocked || disabled ? ' locked' : '') + (disabled ? ' temporarily-disabled' : '');
  var aria = def.name + (disabled ? '（' + (def.disabledReason || '目前暫不開放升級') + '）' : '');
  // 潛力技能沿用一般技能卡的互動（data-sk）：滑過＝showSkillTooltip、點擊＝openSkillModal，不另寫一套。
  return '<div class="' + cls + '" data-sk="potential:' + def.id + '" aria-label="' + esc(aria) + '">' +
    '<span class="tc-emoji">' + def.emoji + '</span>' +
    (lv > 0 ? '<span class="tc-lv' + (lv >= max ? ' max-lv' : '') + '">' + lv + '</span>' : (!unlocked ? '<span class="tc-lock">🔒</span>' : '')) +
    (disabled ? '<span class="tc-lock">🔒 暫不開放</span>' : '') +
    '</div>';
}

function talentEffectLabel(def, value) {
  if (def.stat === 'potentialUnlock') return fmt(value) + ' 個潛力節點';
  var elementTalentNames = {
    elemFire: '火焰', elemIce: '寒冰', elemLightning: '雷電',
    elemPoison: '劇毒', elemLight: '聖光', elemDark: '暗影', elemEarth: '大地'
  };
  // 天賦每級可能是小數（總傷害額外 0.5% 等），fmt 會捨去小數 → 一律保留至多 2 位小數
  if (elementTalentNames[def.stat]) return String(Math.round(value * 100) / 100) + '%' + elementTalentNames[def.stat] + '傷害';
  // 除潛力解鎖外，所有一般天賦效果皆為百分比。
  return String(Math.round(value * 100) / 100) + '%';
}

function talentEffectDescription(def, value) {
  // 潛力技能 V3 的效果文字由 potentialValueLine 產生（見潛力面板/提示/彈窗）；此處僅處理一般天賦與潛力解鎖節點。
  if (def.stat === 'potentialUnlock') return '升至 100 級才會解鎖新類型技能「潛力」' + fmt(def.unlocks || 0) + ' 個，並給予' + fmt(value) + '點技能點。';
  return esc(def.desc) + talentEffectLabel(def, value);
}

function talentDescriptionValue(def, level, turn, snapshot) {
  var lv = Math.max(1, Math.floor(Number(level) || 0));
  // 潛力解鎖天賦顯示的是技能點效果（解鎖數固定為 def.unlocks，寫在說明文字裡）
  if (def.stat === 'potentialUnlock') return talentLevelValue(def, lv);
  var multiplier = snapshot
    ? talentViewCompleteMultiplier(snapshot, turn)
    : 1;
  return talentLevelValue(def, lv) * multiplier;
}

function talentTreeLevelTotal(turn, snapshot) {
  if (snapshot) return talentViewTreeLevelTotal(snapshot, turn);
  return 0;
}

function openTalentModal(kind, id) {
  if (kind === 'potential') {
    UI.selTalent = null;
    openSkillModal('potential:' + id);
    return;
  }
  UI.selTalent = { kind: kind, id: id };
  hideTooltip();
  var overlay = $id('talent-modal');
  if (overlay) overlay.style.display = 'flex';
  renderTalentModal();
}

function closeTalentModal() {
  var overlay = $id('talent-modal');
  if (overlay) overlay.style.display = 'none';
  UI.selTalent = null;
}

/* ---- 離線收益確認彈窗（applyOfflineProgress → save.js 呼叫；收益已入帳，此處為確認展示） ---- */
function showOfflineSummary(sum) {
  var overlay = $id('offline-modal'), body = $id('offline-modal-body');
  if (!overlay || !body || !sum) return;
  var hrs = Math.floor(sum.seconds / 3600), mins = Math.floor((sum.seconds % 3600) / 60);
  var h = '<div class="talent-modal-head"><span class="talent-modal-icon">🌙</span><b>離線收益</b> ' +
    '<span class="dim-text">離線 ' + (hrs ? hrs + ' 小時 ' : '') + mins + ' 分鐘</span></div>';
  /* 怪物種類由參數表決定（formula.js §10 OFFLINE_ELITE），不能寫死「菁英怪」。
     舊的離線摘要沒有 elite 欄位，視為菁英以維持原本的顯示。 */
  var offKind = (sum.elite === false) ? '普通怪' : '菁英怪';
  h += '<div class="offline-sum-row">⚔️ 擊殺：Lv.' + fmt(sum.stage) + ' ' + esc(sum.zoneName || '') + offKind + ' ×' + fmt(sum.kills) + '</div>';
  h += '<div class="offline-sum-row">💡 經驗 +' + fmt(sum.xp) + '　💰 金幣 +' + fmt(sum.gold) + '</div>';
  var loot = [];
  for (var r = 0; r < RARITIES.length; r++) {
    if (sum.equips && sum.equips[r]) {
      loot.push('<span style="color:' + RARITIES[r].color + '">' + esc(RARITIES[r].name) + '裝備</span>×' + fmt(sum.equips[r]));
    }
  }
  if (sum.gems) {
    for (var glv = 1; glv <= 5; glv++) {
      if (sum.gems[glv]) loot.push('💎Lv.' + glv + ' 寶石×' + fmt(sum.gems[glv]));
    }
  }
  if (sum.books) loot.push('📖附魔書×' + fmt(sum.books));
  if (sum.essence) loot.push('<img src="images/icon_ancient_essence.png" class="res-icon" alt="太古精華">太古精華×' + fmt(sum.essence));
  if (sum.dust) loot.push('💫魔塵×' + fmt(sum.dust));
  if (sum.parts) loot.push('🔧自動機組零件×' + fmt(sum.parts));
  if (sum.scrap) loot.push('🔩碎片×' + fmt(sum.scrap) + '（輸送帶滿載折算）');
  h += '<div class="offline-sum-title">📦 掉落明細（裝備已送入輸送帶）</div>';
  h += '<div class="offline-sum-loot">' + (loot.length ? loot.join('　') : '（無掉落）') + '</div>';
  body.innerHTML = h;
  overlay.style.display = 'flex';
}

function closeOfflineSummary() {
  var overlay = $id('offline-modal');
  if (overlay) overlay.style.display = 'none';
}

function renderTalentModal() {
  var body = $id('talent-modal-body');
  var overlay = $id('talent-modal');
  if (!body || !overlay || overlay.style.display === 'none') return;
  var snapshot = arguments[0] || uiTalentPanelSnapshot();
  if (!snapshot) return;
  var sel = UI.selTalent;
  if (!sel) return;
  var def = talentDef(sel.id);
  if (!def) { closeTalentModal(); return; }
  var turn = talentTurn(sel.id);
  var lv = talentViewLevel(snapshot, sel.id);
  var maxLv = TALENT_MAX_LEVEL;
  var unlocked = talentViewUnlocked(snapshot, sel.id);
  var disabled = !!def.disabled;
  // 0 級尚未產生實際加成，但說明要先讓玩家看到升到 1 級後會得到的效果。
  var descriptionLv = Math.max(1, lv);
  var current = talentDescriptionValue(def, descriptionLv, turn, snapshot);
  var next = talentDescriptionValue(def, lv + 1, turn, snapshot);
  var points = snapshot.talentPoints || 0;
  var title = turn + ' 轉天賦';
  var upgradeAttr = 'data-talent-up="' + def.id + '"';
  var maxAttr = 'data-talent-max="' + def.id + '"';
  var downAttr = 'data-talent-down="' + def.id + '"';
  var deleteAttr = 'data-talent-delete="' + def.id + '"';
  var cost = (typeof talentUpgradeCost === 'function') ? talentUpgradeCost(def.id, lv + 1) : turn + 9;
  var maxed = lv >= maxLv;
  var pendingKey = nodePendingKey('talent:' + def.id);
  var pendingAttrs = pendingUiButtonAttributes(pendingKey);
  var disabledNotice = disabled ? '<div class="hint">🔒 目前暫不開放升級</div>' : '';
  var h = '<div class="talent-modal-head"><span class="talent-modal-icon">' + def.emoji + '</span><b>' + esc(def.name) + '</b> <span class="dim-text">Lv.' + lv + '/' + maxLv + '｜' + title + '</span>' +
    (maxed ? '<span class="talent-modal-complete">已滿級！</span>' : '') + '</div>';
  h += '<div class="talent-modal-desc"><b>' + talentEffectDescription(def, current) + '</b></div>' + disabledNotice;
  h += '<div class="talent-modal-copy' + (maxed ? ' talent-modal-copy-maxed' : '') + '">';
  if (!maxed && !disabled) {
    h += '<div>下一級：<b>' + talentEffectDescription(def, next) + '</b></div>';
    h += '<div>消耗天賦點：' + cost + '</div>';
  }
  if (talentViewCompleteMultiplier(snapshot, turn) > 1) h += '<div class="talent-modal-complete">該轉 8 個天賦已全滿，效果 ×2</div>';
  if (!unlocked) h += '<div class="hint">🔒 需要達到 ' + turn + ' 轉</div>';
  h += '</div><div class="talent-modal-points">轉生天賦點：' + fmtFull(points) + '</div>';
  h += '<div class="talent-modal-actions">';
  if (!disabled && unlocked && lv < maxLv) {
    h += '<button class="btn sm" ' + upgradeAttr + pendingAttrs + '>⬆️ 升級</button>';
    h += '<button class="btn sm" ' + maxAttr + pendingAttrs + '>⚡ 一鍵升滿</button>';
  } else { h += '<div></div><div></div>'; }
  if (lv > 0) h += '<button class="btn sm warn" ' + downAttr + pendingAttrs + '>⬇️ 降 1 級</button><button class="btn sm danger" ' + deleteAttr + pendingAttrs + '>清除</button>';
  else h += '<div></div><div></div>';
  h += '</div>';
  body.innerHTML = h;
}

function renderTalents() {
  var root = $id('talent-root');
  if (!root) return;
  var snapshot = uiTalentPanelSnapshot();
  uiHeaderPanelSnapshot();
  if (!snapshot) {
    root.innerHTML = '<div class="panel hint">正在載入天賦 Snapshot…</div>';
    return;
  }
  var rc = talentViewReincarnations(snapshot);
  var h = '<div class="panel talent-summary"><div class="sec-title">🌟 天賦系統</div>' +
    '<div class="hint">1 轉後開放；天賦使用轉生天賦點，升 1 級消耗＝該天賦轉數+9、Lv.51 起每級加倍（例：1 轉前 50 級每級 10 點、51 級起每級 20 點）。潛力是新的技能分類，與特殊、被動共用技能點，不另設潛力點。</div>' +
    '<div class="talent-point-line">轉生天賦點：<b>' + fmtFull(snapshot.talentPoints || 0) + '</b></div></div>';
  if (rc < 1) h += '<div class="panel talent-locked-banner">🔒 天賦系統將於完成 1 轉後開放。</div>';
  for (var turn = 1; turn <= REINCARNATION_MAX; turn++) {
    var tree = TALENT_TREES[turn];
    if (!tree) {
      h += '<div class="panel talent-tree-panel locked"><div class="sec-title">' + turn + ' 轉天賦</div><div class="talent-locked-banner">🔒 本版本尚未開放</div></div>';
      continue;
    }
    var treeTotal = talentTreeLevelTotal(turn, snapshot);
    var treeStatus = rc >= turn ? '已開啟' : '未開啟';
    var treeMax = TALENT_MAX_LEVEL * 8;
    var treeComplete = treeTotal >= treeMax;
    var treeCount = treeComplete ? '<span class="talent-tree-count">' + treeTotal + '/' + treeMax + '</span>' : treeTotal + '/' + treeMax;
    var treeNotice = treeComplete
      ? '<span class="talent-tree-complete">' + turn + '轉天賦全滿效果已加倍！</span>'
      : turn + '轉所有技能升至全滿時此列所有技能效果加倍';
    h += '<div class="panel talent-tree-panel"><div class="sec-title">' + turn + '轉天賦 <span class="dim-text">' + treeStatus + '　(' + treeCount + ')　' + treeNotice + '</span></div><div class="talent-grid">';
    h += tree.map(function (def) { return talentNodeHTML(def, turn, snapshot); }).join('') + '</div></div>';
  }
  // 潛力屬於技能分類，天賦頁只保留轉生天賦點摘要。
  root.innerHTML = h;
  renderTalentModal(snapshot);
}

/* ---- 技能分頁（技能樹 + 融合） ---- */
UI.selSkill = null;      // 目前選取的技能 id
UI.selTalent = null;     // { kind: 'talent'|'potential', id }
UI.fuseSlots = [];       // 融合素材槽（最多 4）
UI.optimisticSkillLoadout = null; // { values: [], acknowledged: bool }

function uiSkillsPanelSnapshot() {
  return panelData('skills');
}


function skillViewReincarnations(headerSnapshot, talentSnapshot) {
  if (talentSnapshot) return talentViewReincarnations(talentSnapshot);
  var player = headerSnapshot && headerSnapshot.player;
  return Math.max(0, Math.floor(Number(player && player.reincarnations) || 0));
}

function skillViewLevel(snapshot, id) {
  return Math.max(0, Math.floor(Number(snapshot && snapshot.skills && snapshot.skills[id]) || 0));
}

function skillViewDef(snapshot, id) {
  if (SKILLS[id]) return SKILLS[id];
  var fusions = snapshot && Array.isArray(snapshot.fusions) ? snapshot.fusions : [];
  for (var i = 0; i < fusions.length; i++) {
    if (fusions[i] && fusions[i].id === id) {
      return typeof resolveFusionRecord === 'function'
        ? resolveFusionRecord(fusions[i])
        : fusions[i];
    }
  }
  return null;
}

/* 2026-07-30 技能融合改造：全部技能（含融合技/被動）統一上限 10、轉生後 15，
   與模擬層 skillMaxLv 同步（融合技不再用記錄凍結的 maxLv）。 */
function skillViewMaxLevel(def, reincarnations) {
  var rc = Math.max(0, Math.floor(Number(reincarnations) || 0));
  if (typeof REINCARNATION_SKILL_MAX_LEVELS !== 'undefined' &&
    REINCARNATION_SKILL_MAX_LEVELS[rc] !== undefined) {
    return REINCARNATION_SKILL_MAX_LEVELS[rc];
  }
  return 10 + (rc > 0 ? 5 : 0);
}

function skillViewPotentialMaxLevel(reincarnations) {
  var rc = Math.max(0, Math.floor(Number(reincarnations) || 0));
  if (typeof REINCARNATION_SKILL_MAX_LEVELS !== 'undefined' &&
    REINCARNATION_SKILL_MAX_LEVELS[rc] !== undefined) {
    return REINCARNATION_SKILL_MAX_LEVELS[rc];
  }
  return 10 + (rc > 0 ? 5 : 0);
}

function skillViewUnlockReason(snapshot, headerSnapshot, id, def) {
  var level = skillViewLevel(snapshot, id);
  var playerLevel = Math.max(1, Math.floor(Number(
    headerSnapshot && headerSnapshot.player && headerSnapshot.player.level
  ) || 1));
  var unlockLevel = Math.max(0, Math.floor(Number(def && def.unlockLv) || 0));
  var unlocked = !!(snapshot && snapshot.unlocks && snapshot.unlocks[id]) ||
    level > 0 ||
    unlockLevel <= 0 ||
    playerLevel >= unlockLevel;
  return unlocked ? null : '需人物達到 Lv.' + unlockLevel + ' 才解鎖';
}

function skillViewCatSpentPoints(snapshot, cat) {
  var sum = 0;
  var levels = snapshot && snapshot.skills ? snapshot.skills : {};
  for (var id in levels) {
    var def = SKILLS[id];
    if (def && def.cat === cat) sum += Math.max(0, Math.floor(Number(levels[id]) || 0));
  }
  return sum;
}

function skillViewSpentPoints(skillsSnapshot, talentSnapshot, reincarnations) {
  var spent = 0;
  var levels = skillsSnapshot && skillsSnapshot.skills ? skillsSnapshot.skills : {};
  for (var id in levels) spent += Math.max(0, Math.floor(Number(levels[id]) || 0));
  var potentialMax = skillViewPotentialMaxLevel(reincarnations);
  POTENTIAL_TALENTS.forEach(function (def) {
    spent += talentViewPotentialLevel(talentSnapshot, def.id, potentialMax);
  });
  return spent;
}

function skillViewLoadoutSize(skillsSnapshot) {
  var cap = Number(skillsSnapshot && skillsSnapshot.loadoutSize);
  return Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : 0;
}

function skillViewLoadout(snapshot) {
  if (UI.optimisticSkillLoadout) {
    return UI.optimisticSkillLoadout.values;
  }
  return snapshot && Array.isArray(snapshot.loadout) ? snapshot.loadout : [];
}

/* 技能說明一律由模擬層的 describeSkill 產生，不得在此另寫簡化版。

   這裡曾經只回傳 `def.flavor || def.desc`，理由是「describeSkill 會回讀主執行緒的
   G.player.fusions」。那個顧慮只對**融合技**成立——`skillDef(id)` 僅在靜態 SKILLS
   表查不到時才讀 G，而主執行緒的 G 是 null，當時確實會拋 TypeError。
   但代價是**所有技能**的傷害數值、成長與附加效果全部消失，連「下一級」都顯示與本級
   一模一樣的字串。現在 describeSkill 收 fusions 參數（技能面板快照就有這欄），
   主執行緒可以直接呼叫，不必再退化。

   ⚠️ 回傳值是 HTML（含 txt-grow／txt-static 標記），呼叫端不得再 esc。 */
function skillViewDescription(id, def, level, skipFusionDetail, isPotential, fusions) {
  if (isPotential) return describePotentialSkill(def, level);

  var text = (typeof describeSkill === 'function')
    ? describeSkill(id, Math.max(1, level || 1), skipFusionDetail, fusions)
    : '';
  // 查不到定義時才退回風味文字，至少不要整格空白
  if (!text) text = esc((def && (def.flavor || def.desc)) || '');

  if (def && def.cat === 'fusion' && !SKILLS[id] && !skipFusionDetail) {
    var componentNames = (def.components || []).map(function (componentId) {
      return SKILLS[componentId] ? SKILLS[componentId].name : componentId;
    });
    if (componentNames.length) {
      text += '<div class="skt-components">（融合自：' +
        componentNames.map(esc).join(' ＋ ') + '）</div>';
    }
  }
  return text;
}


function runSkillUiAction(commandName, id, pendingRef, legacyAction, panels, onSuccess) {
  sendUiCommand(commandName, { id: id }, {
    keys: nodePendingKey(pendingRef),
    panels: panels
  }).then(function (result) {
    var error = uiCommandResultError(result);
    if (error) reportUiCommandFailure('技能操作失敗', error, panels);
    else if (onSuccess) onSuccess();
  }, function (error) {
    reportUiCommandFailure('技能操作失敗', error, panels);
  });
}


function skillCellHTML(id, skillsSnapshot, talentSnapshot, headerSnapshot) {
  var sk = skillViewDef(skillsSnapshot, id);
  if (!sk) return '';
  var reincarnations = skillViewReincarnations(headerSnapshot, talentSnapshot);
  var lv = skillViewLevel(skillsSnapshot, id);
  var lock = skillViewUnlockReason(skillsSnapshot, headerSnapshot, id, sk);
  var loadout = skillViewLoadout(skillsSnapshot);
  var inLoadout = loadout.indexOf(id) >= 0;
  var maxLv = skillViewMaxLevel(sk, reincarnations);
  var inFusion = (UI.fuseSlots || []).indexOf(id) >= 0;
  var usedInFusion = skillViewUsedInFusion(skillsSnapshot, id); // 已投入融合技（佔用中）
  var cls = 'tree-cell' + (lv > 0 ? ' learned' : '') + (lock ? ' locked' : '') +
    (UI.selSkill === id ? ' selected' : '') + (inLoadout ? ' equipped' : '') +
    (inFusion ? ' fusion-selected' : '') + (usedInFusion ? ' fused-locked' : '');
  return '<div class="' + cls + '" data-sk="' + id + '">' +
    '<span class="tc-emoji">' + sk.emoji + '</span>' +
    (lv > 0 ? '<span class="tc-lv' + (lv >= maxLv ? ' max-lv' : '') + '">' + lv + '</span>' : (lock ? '<span class="tc-lock">🔒</span>' : '')) +
    (inLoadout ? '<span class="tc-eq">⚔</span>' : '') +
    (usedInFusion ? '<span class="tc-fused" title="已投入融合技">⚗️</span>' : '') +
    '</div>';
}

/* 被融合佔用查詢：素材 id 出現在任一融合技 components 即為佔用（快照推導，無獨立欄位） */
function skillViewUsedInFusion(snapshot, id) {
  var fusions = snapshot && Array.isArray(snapshot.fusions) ? snapshot.fusions : [];
  for (var i = 0; i < fusions.length; i++) {
    var comps = fusions[i] && fusions[i].components;
    if (Array.isArray(comps) && comps.indexOf(id) >= 0) return fusions[i].id;
  }
  return null;
}


function renderSkills() {
  var treesBox = $id('skill-trees');
  if (!treesBox) return;
  var skillsSnapshot = uiSkillsPanelSnapshot();
  var talentSnapshot = uiTalentPanelSnapshot();
  var headerSnapshot = uiHeaderPanelSnapshot();
  if (!skillsSnapshot || !talentSnapshot || !headerSnapshot) {
    treesBox.innerHTML = '<div class="panel hint">正在載入技能 Snapshot…</div>';
    return;
  }
  var player = headerSnapshot.player || {};
  var reincarnations = skillViewReincarnations(headerSnapshot, talentSnapshot);
  var spentPoints = skillViewSpentPoints(skillsSnapshot, talentSnapshot, reincarnations);
  var availablePoints = Math.max(0, Math.floor(Number(skillsSnapshot.points) || 0));
  var totalPoints = Math.max(
    Math.floor(Number(skillsSnapshot.budget) || 0),
    availablePoints + spentPoints
  );
  $id('sp-count').textContent = availablePoints + '（共 ' + totalPoints + ' 點，已用 ' + spentPoints + '）';

  // 技能熟練度（2026-07-30）：等級＋經驗條（快照 mastery 由 Worker 投影）
  var mastery = skillsSnapshot.mastery || { level: 0, xp: 0, xpMax: 0, maxLevel: 1000 };
  var masteryLvEl = $id('mastery-level');
  if (masteryLvEl) {
    masteryLvEl.textContent = 'Lv.' + (mastery.level || 0) + '/' + (mastery.maxLevel || 1000) +
      '（打怪獲得技能經驗，每升 1 級 +1 技能點）';
  }
  var masteryFill = $id('mastery-bar-fill');
  var masteryText = $id('mastery-bar-text');
  if (masteryFill && masteryText) {
    var atMasteryCap = (mastery.level || 0) >= (mastery.maxLevel || 1000);
    var masteryPct = atMasteryCap ? 100 : (mastery.xpMax > 0 ? Math.min(100, mastery.xp / mastery.xpMax * 100) : 0);
    masteryFill.style.width = masteryPct.toFixed(1) + '%';
    masteryText.textContent = atMasteryCap ? '已滿級' : (fmt(mastery.xp) + ' / ' + fmt(mastery.xpMax));
  }

  // 裝載欄上限由 Worker 依參數表計算；存檔只保存已裝備技能，不保存欄位數。
  var loBox = $id('skill-loadout');
  var lo = skillViewLoadout(skillsSnapshot);
  var cap = skillViewLoadoutSize(skillsSnapshot);
  var loadoutPendingKey = nodePendingKey('skill-loadout');
  var loadoutPending = isUiCommandPending(loadoutPendingKey);
  $id('loadout-cap').textContent = lo.length + '/' + cap + ' 格' + (reincarnations >= 1 ? '（1 轉已解鎖全部上限）' : '（依參數表成長）');
  var lh = '';
  for (var i = 0; i < cap; i++) {
    var id0 = lo[i];
    var isPot0 = typeof id0 === 'string' && id0.indexOf('potential:') === 0;
    var d0 = id0 ? (isPot0 ? potentialDef(id0.slice(10)) : skillViewDef(skillsSnapshot, id0)) : null;
    if (d0) {
      var loadoutLevel = isPot0
        ? talentViewPotentialLevel(talentSnapshot, d0.id, skillViewPotentialMaxLevel(reincarnations))
        : skillViewLevel(skillsSnapshot, id0);
      lh += '<span class="loadout-slot filled" draggable="' + (loadoutPending ? 'false' : 'true') + '" data-index="' + i + '" data-skill-unequip="' + id0 + '" data-sk="' + id0 + '" data-ui-pending-key="' + loadoutPendingKey + '"' + (loadoutPending ? ' aria-disabled="true"' : '') + '>' +
        d0.emoji + ' ' + esc(d0.name) + ' Lv.' + loadoutLevel + '</span>';
    } else {
      lh += '<span class="loadout-slot" data-index="' + i + '">空欄位</span>';
    }
  }
  loBox.innerHTML = lh;

  // 融合技（置頂區）
  var fuList = $id('fusion-skill-list');
  var fusions = skillsSnapshot.fusions || [];
  fuList.innerHTML = fusions.length
    ? fusions.map(function (f) {
      return skillCellHTML(f.id, skillsSnapshot, talentSnapshot, headerSnapshot);
    }).join('')
    : '<span class="hint">尚無融合技 — 使用下方「技能融合」創造你的專屬奧義！</span>';

  // 技能樹（每系一棵，技能不受前置投入點數限制）
  var h = '';
  for (var cat in SKILL_CATS) {
    var cells = [];
    for (var id in SKILLS) {
      if (SKILLS[id].cat === cat) {
        cells.push(skillCellHTML(id, skillsSnapshot, talentSnapshot, headerSnapshot));
      }
    }
    var rows = '';
    for (var r = 0; r < cells.length; r += 6) {
      rows += '<div class="tree-row">' + cells.slice(r, r + 6).join('') + '</div>';
    }
    h += '<div class="tree-panel"><div class="tree-title">' + SKILL_CATS[cat].emoji + ' ' + SKILL_CATS[cat].name +
      ' <span class="dim-text">已投入 ' + skillViewCatSpentPoints(skillsSnapshot, cat) + ' 點</span></div>' + rows + '</div>';
  }
  if (reincarnations >= 3) {
    var potentialCells = POTENTIAL_TALENTS.map(function (def, index) {
      return potentialNodeHTML(def, index, talentSnapshot, headerSnapshot);
    });
    var potentialRows = '';
    for (var pr = 0; pr < potentialCells.length; pr += 6) {
      potentialRows += '<div class="tree-row">' + potentialCells.slice(pr, pr + 6).join('') + '</div>';
    }
    h += '<div class="tree-panel potential-skill-panel"><div class="tree-title">✨ 潛力 <span class="dim-text">技能分類；使用技能點與金幣　已解鎖 ' + talentViewPotentialUnlockedCount(talentSnapshot) + '/' + POTENTIAL_NODE_COUNT + '</span></div>' + potentialRows + '</div>';
  }
  treesBox.innerHTML = h;

  renderSkillModal(skillsSnapshot, talentSnapshot, headerSnapshot);
  renderFusionPanel(skillsSnapshot);
}

/* ---- 技能升級彈窗 ---- */
function potentialSkillId(ref) {
  if (typeof ref !== 'string' || ref.indexOf('potential:') !== 0) return null;
  return ref.slice('potential:'.length);
}

function openSkillModal(id) {
  UI.selSkill = id;
  UI.selTalent = null;
  hideTooltip();
  var overlay = $id('skill-modal');
  if (overlay) overlay.style.display = 'flex';
  renderSkillModal();
}
function closeSkillModal() {
  var overlay = $id('skill-modal');
  if (overlay) overlay.style.display = 'none';
  UI.selSkill = null;
}

/* 技能標籤：標題下方顯示技能類別與元素系別，文字來源沿用 SKILL_CATS／ELEM_INFO。 */
function skillTagsHTML(id, sk, lv, isPotential) {
  if (!sk) return '';
  var tags = [];
  var category = isPotential ? '潛力' : (SKILL_CATS[sk.cat] ? SKILL_CATS[sk.cat].name : '融合技');
  tags.push({ text: category, cls: 'skill-tag-category' });

  var rawTags = Array.isArray(sk.tags) ? sk.tags : (typeof sk.tags === 'string' ? sk.tags.split(';') : []);
  var elems = [];
  function addElem(elem) {
    if (elem && elems.indexOf(elem) < 0) elems.push(elem);
  }
  rawTags.forEach(function (tag) { addElem(String(tag).trim()); });
  elems.sort(function (a, b) {
    var ai = typeof ELEMENTS !== 'undefined' ? ELEMENTS.indexOf(a) : -1;
    var bi = typeof ELEMENTS !== 'undefined' ? ELEMENTS.indexOf(b) : -1;
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
  elems.forEach(function (elem) {
    if (typeof ELEM_INFO !== 'undefined' && ELEM_INFO[elem]) {
      // §3.5 技能詳情顯示元素圖示＋系別（emoji＋「X系」；light 語境統一稱「聖」）
      tags.push({
        text: ELEM_INFO[elem].emoji + (ELEM_INFO[elem].short || ELEM_INFO[elem].name) + '系',
        cls: 'skill-tag-element skill-tag-' + elem
      });
    } else if (elem) {
      tags.push({ text: elem, cls: 'skill-tag-element skill-tag-custom' });
    }
  });

  return '<div class="skill-tags">' + tags.map(function (tag) {
    return '<span class="skill-tag ' + tag.cls + '">' + esc(tag.text) + '</span>';
  }).join('') + '</div>';
}

function renderSkillModal() {
  var body = $id('skill-modal-body');
  var overlay = $id('skill-modal');
  if (!body || !overlay || overlay.style.display === 'none') return;
  var skillsSnapshot = arguments[0] || uiSkillsPanelSnapshot();
  var talentSnapshot = arguments[1] || uiTalentPanelSnapshot();
  var headerSnapshot = arguments[2] || uiHeaderPanelSnapshot();
  if (!skillsSnapshot || !talentSnapshot || !headerSnapshot) return;
  var ref = UI.selSkill;
  var potentialId = potentialSkillId(ref);
  var isPotential = potentialId !== null;
  var id = isPotential ? potentialId : ref;
  var sk = id ? (isPotential ? potentialDef(id) : skillViewDef(skillsSnapshot, id)) : null;
  if (!sk) { closeSkillModal(); return; }
  var reincarnations = skillViewReincarnations(headerSnapshot, talentSnapshot);
  var maxLv = isPotential
    ? skillViewPotentialMaxLevel(reincarnations)
    : skillViewMaxLevel(sk, reincarnations);
  var lv = isPotential
    ? talentViewPotentialLevel(talentSnapshot, id, maxLv)
    : skillViewLevel(skillsSnapshot, id);
  var lock = isPotential
    ? (potentialTemporarilyDisabled(id) ? '此潛力技能目前暫不開放升級' : (talentViewPotentialUnlocked(talentSnapshot, id) ? null : '潛力節點尚未解鎖'))
    : skillViewUnlockReason(skillsSnapshot, headerSnapshot, id, sk);
  // 裝載欄鍵：一般技能＝id、潛力技能＝'potential:<id>'；主動潛力技能與一般技能一樣可裝載施放。
  var loadoutRef = isPotential ? 'potential:' + id : id;
  var canEquip = isPotential
    ? (typeof potentialEquippable === 'function' && potentialEquippable(sk))
    : (sk.cat !== 'passive');
  var inLoadout = skillViewLoadout(skillsSnapshot).indexOf(loadoutRef) >= 0;
  var isFusion = !isPotential && sk.cat === 'fusion' && String(id).indexOf('fusion_') === 0;
  var description = function (level, skipFusion) {
    return skillViewDescription(id, sk, level, skipFusion, isPotential,
      skillsSnapshot && skillsSnapshot.fusions);
  };
  var pendingRef = isPotential ? 'potential:' + id : 'skill:' + id;
  var pendingAttrs = pendingUiButtonAttributes(nodePendingKey(pendingRef));
  var category = isPotential ? ('潛力·' + potentialTypeLabel(sk) + potentialDmgLabel(sk)) : (SKILL_CATS[sk.cat] ? SKILL_CATS[sk.cat].name : '融合技');
  var potentialMeta = isPotential
    ? (sk.type === 'active' ? '<span class="sk-meta">⏱️ ' + sk.cd + 's</span>'
      : (sk.type === 'passiveTrigger' ? '<span class="sk-meta">⏱️ 觸發冷卻 ' + sk.cd + 's</span>' : ''))
    : '';
  var h = '<div class="skd-head"><span class="skd-emoji">' + sk.emoji + '</span><b>' + esc(sk.name) + '</b> ' +
    '<span class="dim-text">Lv.' + lv + '/' + maxLv + '｜' + category + '</span>' +
    (isPotential ? potentialMeta : (sk.cat !== 'passive' ? '<span class="sk-meta">🔵 ' + skillManaCost(sk, Math.max(1, lv)) + ' MP　⏱️ ' + sk.cd + 's</span>' : '')) + '</div>';

  h += skillTagsHTML(id, sk, Math.max(1, lv), isPotential);
  h += '<div class="skill-modal-copy">';
  // 潛力與一般技能共用同一份描述（describeSkill）與版面。
  h += '<div class="sk-desc">' + description(Math.max(1, lv)) + '</div>';
  if (lv > 0 && lv < maxLv) h += '<div class="skd-next dim-text">下一級：' + description(lv + 1, true) + '</div>';
  if (sk.flavor && !isFusion) h += '<div class="sk-flavor">' + esc(sk.flavor) + '</div>';
  if (lock) h += '<div class="hint skill-unlock-hint">🔒 ' + esc(lock) + '</div>';
  h += '</div>';

  h += '<div class="skill-modal-points">技能點：' + Math.max(0, Math.floor(Number(skillsSnapshot.points) || 0)) + '</div>';
  h += '<div class="detail-actions skill-modal-actions">';
  if (lv < maxLv && !lock) {
    var cost = skillUpgradeCost(lv);
    var skillRef = isPotential ? 'potential:' + id : id;
    var insufficientGold = (Number(headerSnapshot.player && headerSnapshot.player.gold) || 0) < cost;
    h += '<button class="btn sm" data-skill-learn="' + skillRef + '" data-tip="花費 ' + fmt(cost) + ' 金幣"' + pendingAttrs + (insufficientGold ? ' disabled' : '') + '>' +
      (lv === 0 ? '📖 學習' : '⬆️ 升級') + '</button>';
    h += '<button class="btn sm" data-skill-max="' + skillRef + '" data-tip="自動消耗技能點與金幣，升到目前技能上限"' + pendingAttrs + '>⚡ 一鍵滿級</button>';
  } else if (lv >= maxLv) {
    h += '<div style="text-align:center; padding: 4px; color: var(--good); font-size: 12px;">已滿級</div>';
    h += '<div style="visibility: hidden;"></div>'; // 保留一鍵滿級欄位，讓後方按鈕位置固定
  } else {
    h += '<div style="visibility: hidden;"></div><div style="visibility: hidden;"></div>'; // 升級與一鍵滿級欄位
  }

  if (lv > 0) {
    h += '<button class="btn sm warn" data-skill-downgrade="' + (isPotential ? 'potential:' + id : id) + '" data-tip="退回 1 技能點（不退還金幣）"' + pendingAttrs + '>⬇️ 降級</button>';
  } else {
    h += '<div style="visibility: hidden;"></div>'; // empty grid cell
  }

  var usedInFusionModal = !isPotential && skillViewUsedInFusion(skillsSnapshot, id);
  if (usedInFusionModal && canEquip) {
    // 佔用中：不可裝備（刪除該融合技後釋放）
    h += '<button class="btn sm" disabled data-tip="已投入融合技，刪除該融合技後可再裝備">⚗️ 融合中</button>';
  } else if (canEquip && lv > 0) {
    h += inLoadout
      ? '<button class="btn sm warn" data-skill-unequip="' + loadoutRef + '"' + pendingAttrs + '>卸下</button>'
      : '<button class="btn sm" data-skill-equip="' + loadoutRef + '"' + pendingAttrs + '>⚔️ 裝備</button>';
  } else if (isPotential && !canEquip && lv > 0) {
    h += '<button class="btn sm" disabled data-tip="被動潛力技能學會即常駐生效">🌀 常駐</button>';
  } else if (isFusion && lv <= 0) {
    h += '<button class="btn sm" disabled data-tip="融合技需升級至 Lv.1 才可裝備">📖 未學習</button>';
  } else {
    h += '<div style="visibility: hidden;"></div>'; // empty grid cell
  }

  // 加入融合：已解鎖即可（不需學習）；被動/潛力/融合技與已佔用素材除外
  if (!isPotential && !isFusion && sk.cat !== 'passive' && !lock) {
    var inFuse = (UI.fuseSlots || []).indexOf(id) >= 0;
    if (usedInFusionModal) {
      h += '<button class="btn sm" disabled data-tip="一個技能只能投入一個融合技">⚗️ 已投入融合</button>';
    } else if (inFuse) {
      h += '<button class="btn sm" disabled>⚗️ 已加入</button>';
    } else {
      h += '<button class="btn sm" data-skill-fuse-add="' + id + '">⚗️ 加入融合</button>';
    }
  } else {
    h += '<div style="visibility: hidden;"></div>';
  }

  if (lv > 0) {
    var deleteRef = isPotential ? 'potential:' + id : id;
    h += '<button class="btn sm danger" data-skill-delete="' + deleteRef + '"' + pendingAttrs + '>🗑️ 刪除</button>';
  } else {
    h += '<div style="visibility: hidden;"></div>';
  }

  h += '</div>';
  body.innerHTML = h;
}

/* ---- 技能懸停提示 ---- */
function showSkillTooltip(ref, anchorEl) {
  var tip = $id('sk-tooltip');
  if (!tip) return;
  var skillsSnapshot = uiSkillsPanelSnapshot();
  var talentSnapshot = uiTalentPanelSnapshot();
  var headerSnapshot = uiHeaderPanelSnapshot();
  if (!skillsSnapshot || !talentSnapshot || !headerSnapshot) return;
  // 潛力技能沿用同一個技能提示元件（data-sk="potential:id"）。
  var potId = (typeof potentialSkillId === 'function') ? potentialSkillId(ref) : null;
  var isPotential = potId !== null;
  var id = isPotential ? potId : ref;
  var sk = isPotential ? potentialDef(id) : skillViewDef(skillsSnapshot, id);
  if (!sk) return;
  var reincarnations = skillViewReincarnations(headerSnapshot, talentSnapshot);
  var maxLv = isPotential
    ? skillViewPotentialMaxLevel(reincarnations)
    : skillViewMaxLevel(sk, reincarnations);
  var lv = isPotential
    ? talentViewPotentialLevel(talentSnapshot, id, maxLv)
    : skillViewLevel(skillsSnapshot, id);
  var lock = isPotential
    ? (potentialTemporarilyDisabled(id) ? '此潛力技能目前暫不開放升級'
      : (talentViewPotentialUnlocked(talentSnapshot, id) ? null : (reincarnations < 3 ? '潛力技能需在 3 轉後解鎖' : '潛力節點尚未解鎖')))
    : skillViewUnlockReason(skillsSnapshot, headerSnapshot, id, sk);
  var h = '<div class="skt-name">' + sk.emoji + ' ' + esc(sk.name) +
    ' <span class="dim-text">Lv.' + lv + '/' + maxLv + (isPotential ? '｜潛力·' + potentialTypeLabel(sk) + potentialDmgLabel(sk) : '') + '</span></div>';
  h += skillTagsHTML(id, sk, lv, isPotential);
  if (isPotential) {
    if (sk.type === 'active') h += '<div class="skt-meta">⏱️ ' + sk.cd + 's</div>';
    else if (sk.type === 'passiveTrigger') h += '<div class="skt-meta">⏱️ 觸發冷卻 ' + sk.cd + 's</div>';
  } else if (sk.cat !== 'passive') {
    h += '<div class="skt-meta">🔵 ' + skillManaCost(sk, Math.max(1, lv)) + ' MP　⏱️ ' + sk.cd + 's</div>';
  }
  h += '<div class="skt-desc">' + skillViewDescription(id, sk, Math.max(1, lv), false, isPotential,
    skillsSnapshot && skillsSnapshot.fusions) + '</div>';
  if (lock) h += '<div class="skt-lock skill-unlock-hint">🔒 ' + esc(lock) + '</div>';
  h += '<div class="skt-hint">點擊開啟升級面板</div>';
  tip.innerHTML = h;
  tip.style.display = 'block';
  // 定位：優先顯示在圖示右側，貼邊時翻到左側/上方
  var r = anchorEl.getBoundingClientRect();
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var x = r.right + 10, y = r.top;
  if (x + tw > window.innerWidth - 8) x = r.left - tw - 10;
  if (x < 8) x = 8;
  if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
  if (y < 8) y = 8;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function showTalentTooltip(ref, anchorEl) {
  var tip = $id('sk-tooltip');
  if (!tip || !anchorEl || typeof ref !== 'string') return;
  // 潛力技能改走一般技能提示（data-sk）；若仍有 potential: 參照進入，轉交共用提示。
  if (ref.indexOf('potential:') === 0) { showSkillTooltip(ref, anchorEl); return; }
  var def = talentDef(ref);
  if (!def) return;
  var snapshot = uiTalentPanelSnapshot();
  if (!snapshot) return;
  var id = ref;
  var lv = talentViewLevel(snapshot, id);
  var maxLv = TALENT_MAX_LEVEL;
  var turn = talentTurn(id);
  var displayLv = Math.max(1, lv);
  var title = turn + ' 轉天賦';
  var h = '<div class="skt-name">' + def.emoji + ' ' + esc(def.name) +
    ' <span class="dim-text">Lv.' + lv + '/' + maxLv + '｜' + title + '</span></div>';
  var current = talentDescriptionValue(def, displayLv, turn, snapshot);
  h += '<div class="skt-desc">' + talentEffectDescription(def, current) + '</div>';
  if (lv < maxLv) h += '<div class="skt-desc">下一級：' + talentEffectDescription(def, talentDescriptionValue(def, lv + 1, turn, snapshot)) + '</div>';
  if (!talentViewUnlocked(snapshot, id)) h += '<div class="skt-lock">🔒 需要達到 ' + turn + ' 轉</div>';
  h += '<div class="skt-hint">點擊開啟升級面板</div>';
  tip.innerHTML = h;
  tip.style.display = 'block';
  UI.tooltipAnchor = anchorEl;
  var r = anchorEl.getBoundingClientRect();
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var x = r.right + 10, y = r.top;
  if (x + tw > window.innerWidth - 8) x = r.left - tw - 10;
  if (x < 8) x = 8;
  if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
  if (y < 8) y = 8;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function showStatTooltip(title, desc, anchorEl) {
  var tip = $id('sk-tooltip');
  if (!tip) return;
  UI.tooltipAnchor = anchorEl;
  var h = '<div class="skt-name">' + title + '</div>';
  h += '<div class="skt-desc">' + desc + '</div>';
  tip.innerHTML = h;
  tip.style.display = 'block';
  var r = anchorEl.getBoundingClientRect();
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var placement = anchorEl.getAttribute('data-tip-placement');
  var x = r.right + 10, y = r.top;
  if (placement === 'stage-left') {
    x = r.left - tw - 10;
    y = r.bottom + 8;
    if (y + th > window.innerHeight - 8) y = r.top - th - 8;
  } else if (placement === 'stage-right') {
    x = r.right + 10;
    y = r.bottom + 8;
    if (y + th > window.innerHeight - 8) y = r.top - th - 8;
  } else if (x + tw > window.innerWidth - 8) {
    x = r.left - tw - 10;
  }
  if (x + tw > window.innerWidth - 8) x = window.innerWidth - tw - 8;
  if (x < 8) x = 8;
  if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
  if (y < 8) y = 8;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function showBuffTooltip(anchorEl) {
  var tip = $id('sk-tooltip');
  if (!tip || !anchorEl) return;
  UI.tooltipAnchor = anchorEl;
  tip.innerHTML = '<div class="skt-name">💪 目前技能增益</div>' +
    '<div class="skt-desc" style="text-align:left;">' + buffTooltipDesc() + '</div>';
  tip.style.display = 'block';
  var r = anchorEl.getBoundingClientRect();
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var x = r.right + 10, y = r.top;
  if (x + tw > window.innerWidth - 8) x = r.left - tw - 10;
  if (x < 8) x = 8;
  if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
  if (y < 8) y = 8;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function showEnemyBuffTooltip(anchorEl) {
  var tip = $id('sk-tooltip');
  if (!tip || !anchorEl) return;
  UI.tooltipAnchor = anchorEl;
  tip.innerHTML = '<div class="skt-name">💪 目前狀態詳情</div>' +
    '<div class="skt-desc" style="text-align:left;">' + enemyBuffTooltipDesc(anchorEl) + '</div>';
  tip.style.display = 'block';
  var r = anchorEl.getBoundingClientRect();
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var x = r.right + 10, y = r.top;
  if (x + tw > window.innerWidth - 8) x = r.left - tw - 10;
  if (x < 8) x = 8;
  if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
  if (y < 8) y = 8;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function refreshOpenResourceTooltip() {
  var tip = $id('sk-tooltip');
  var anchorEl = UI.tooltipAnchor;
  if (!tip || tip.style.display !== 'block' || !anchorEl || !anchorEl.classList ||
    !anchorEl.classList.contains('res') || !document.documentElement.contains(anchorEl)) return;
  showStatTooltip(anchorEl.getAttribute('data-tt-title') || '', anchorEl.getAttribute('data-tt-desc') || '', anchorEl);
}
function refreshBuffTooltip() {
  var tip = $id('sk-tooltip');
  var anchor = UI.tooltipAnchor;
  if (!tip || tip.style.display !== 'block' || !anchor || !document.documentElement.contains(anchor)) return;
  var descEl = tip.querySelector('.skt-desc');
  if (!descEl || !anchor.closest) return;
  if (anchor.closest('[data-buff-tip]')) descEl.innerHTML = buffTooltipDesc();
  else if (anchor.closest('[data-enemy-buff-tip]')) descEl.innerHTML = enemyBuffTooltipDesc(anchor);
}
function showItemTooltip(it, anchorEl, opts) {
  var tip = $id('sk-tooltip');
  if (!tip) return;
  var compareItem = null;
  var tc = $id('toggle-compare');
  if (tc && tc.checked) {
    var tooltipInvSnapshot = uiInventoryPanelSnapshot();
    var cmpEq = tooltipInvSnapshot && tooltipInvSnapshot.viewEquipment
      ? tooltipInvSnapshot.viewEquipment
      : {};
    var key = uiEquipTargetSlotFromSnapshot(it, cmpEq);
    compareItem = cmpEq[key];
  }

  var tooltipHeaderSnapshot = uiHeaderPanelSnapshot();
  var tooltipPlayer = tooltipHeaderSnapshot && tooltipHeaderSnapshot.player;
  var detailHtml = itemDetailHTML(it, null, {
    showAffixReroll: false,
    gold: tooltipPlayer && tooltipPlayer.gold,
    essence: tooltipPlayer && tooltipPlayer.essence
  });
  if (opts && opts.hint) {
    detailHtml += '<div class="skt-hint">' + opts.hint + '</div>';
  }

  var h = '';
  var mainCard = '<div class="equip-detail-card">' + detailHtml + '</div>';
  if (compareItem && compareItem.id !== it.id) {
    var compCard = '<div class="equip-detail-card">' + itemDetailHTML(compareItem, null, {
      isEquipped: true,
      showAffixReroll: false,
      gold: tooltipPlayer && tooltipPlayer.gold,
      essence: tooltipPlayer && tooltipPlayer.essence
    }) + '</div>';
    h = '<div class="equip-compare-container">' + mainCard + compCard + '</div>';
  } else {
    h = mainCard;
  }

  tip.innerHTML = h;
  tip.style.display = 'block';
  var r = anchorEl.getBoundingClientRect();
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var x = r.right + 10, y = r.top;
  if (x + tw > window.innerWidth - 8) x = r.left - tw - 10;
  if (x < 8) x = 8;
  if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
  if (y < 8) y = 8;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function showTowerTooltip(flStr, anchorEl) {
  var tip = $id('sk-tooltip');
  if (!tip) return;
  var fl = parseInt(flStr, 10);
  if (!fl) return;
  var hasSoul = isHellTowerFloor(fl) || isPurgatoryTowerFloor(fl);
  var bossStats = bossStatsFor(fl);
  var bossXp = bossStats.xp;
  var soulRate = hellSoulOriginDropChance(fl);
  var ancientEssenceRate = ancientEssenceDropChanceForBoss(fl);

  var dropTip = '<div class="skt-name" style="margin-bottom:6px;">【挑戰費用】</div>' +
    '<div class="skt-desc" style="text-align:left;">💰 ' + fmt(towerChallengeCost(fl)) +
    ' 金幣</div>' +
    '<div class="skt-name" style="margin:6px 0;">【可能掉落物】</div>' +
    '<div class="skt-desc" style="text-align:left;">' +
    '💰 金幣 x' + fmt(200 * fl) + ' <span style="color:var(--dim)">(首通雙倍)</span><br>' +
    '✨ 經驗 x' + fmt(bossXp) + ' <span style="color:var(--dim)">(基礎，另加經驗加成)</span><br>' +
    '🔮 附魔精華 x' + (3 + fl) + ' <span style="color:var(--dim)">(100%)</span><br>' +
    '📜 魔法卷軸 <span style="color:var(--dim)">(附魔精華的 1/10，機率式進位)</span><br>' +
    '💎 隨機寶石 x2 <span style="color:var(--dim)">(100%)</span><br>' +
    '📖 隨機附魔書 x2 <span style="color:var(--dim)">(100%)</span><br>' +
    '💫 魔塵 <span style="color:var(--dim)">(' + fmt1(bossDustRate(fl)) + '%，神鑄材料)</span>' +
    '<br><img src="images/icon_ancient_essence.png" class="res-icon" alt="太古精華"> 太古精華 <span style="color:var(--dim)">(' + fmt1(ancientEssenceRate) + '%)</span>' +
    (hasSoul ? '<br>🧿 魔魂本源 <span style="color:var(--dim)">(' + fmt1(soulRate) + '%，地獄/煉獄之塔限定)</span>' : '') +
    (isPurgatoryTowerFloor(fl) ? '<br>🌱 魔種 <span style="color:var(--dim)">(' + fmt1(demonSeedDropChanceForBoss(fl)) + '%，煉獄之塔限定)</span>' : '') + '<br>' +
    '🔩 機組零件 <span style="color:var(--dim)">(首通必掉 / 之後30%)</span>';

  var bossRates = dropRatesFor(BOSS_DROP_TABLE, fl);
  var equipStrs = [];
  for (var br = bossRates.length - 1; br >= 0; br--) {
    if (!bossRates[br]) continue;
    var rate = bossRates[br];
    var rateStr = '';
    if (rate >= 100) {
      rateStr = '必定' + Math.floor(rate / 100) + '件';
      var rem = rate % 100;
      if (rem > 0) rateStr += ' + ' + rem + '%再1件';
    } else {
      rateStr = '機率' + rate + '%';
    }
    equipStrs.push('⚔️ <span style="color:' + RARITIES[br].color + '; font-weight:bold;">' + RARITIES[br].name + '裝備</span> <span style="color:var(--dim)">(' + rateStr + ')</span>');
  }
  if (equipStrs.length) {
    dropTip += '<br>' + equipStrs.join('<br>');
  }

  dropTip += '</div>';
  tip.innerHTML = dropTip;
  tip.style.display = 'block';
  var r = anchorEl.getBoundingClientRect();
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var x = r.left + 20, y = r.bottom + 8;
  if (x + tw > window.innerWidth - 8) x = window.innerWidth - tw - 8;
  if (x < 8) x = 8;
  if (y + th > window.innerHeight - 8) y = r.top - th - 8;
  if (y < 8) y = 8;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function showEnemyTooltip(anchorEl) {
  var tip = $id('sk-tooltip');
  if (!tip) return;

  var isBossTip = (anchorEl.id === 'btn-boss-tip' || anchorEl.id === 'btn-tower-result-boss-tip');
  var workerView = viewState() || {};
  var headerSnapshot = uiHeaderPanelSnapshot() || {};
  var mayUseTower = isBossTip || !!workerView.towerActive;
  var towerSnapshot = mayUseTower ? uiTowerPanelSnapshot() : null;
  var towerRuntime = towerSnapshot && towerSnapshot.runtime;
  var towerActive = towerViewActive(towerSnapshot);
  var m = null;
  if (isBossTip) {
    m = towerRuntime && towerRuntime.boss;
  } else if (towerActive) {
    m = towerRuntime && towerRuntime.boss;
  } else {
    var battleSnapshot = uiBattlePanelSnapshot() || {};
    var field = battleSnapshot.field || {};
    m = field.monster || (Array.isArray(field.monsters) ? field.monsters[0] : null);
    /* if (false) {
      var s = 1;
      var elite = isEliteStage(s);
      var base = monsterStatsFor(s, elite);
      var zn = uiCurrentZoneDef(uiHeaderPanelSnapshot());
      var mtype = (zn && zn.pool && zn.pool.length) ? zn.pool[0] : { name: '未知怪物', emoji: '👾' };
      var mAspd = base.aspd * zn.aspdMult;
      m = {
        name: (elite ? '菁英・' : '') + mtype.name, emoji: mtype.emoji,
        level: base.level,
        maxHp: base.hp * zn.hpMult, hp: base.hp * zn.hpMult,
        atk: base.atk * zn.atkMult,
        def: base.def * zn.defMult, mdef: base.mdef * zn.defMult,
        magic: !!mtype.magic,
        aspd: mAspd, dodge: base.dodge, hit: base.hit,
        elite: elite, isBoss: false,
        gold: base.gold * zn.rewardMult, xp: base.xp * zn.rewardMult,
        ctrlRes: 0, elem: mtype.elem, attr: mtype.attr || null
      };
    }
    */
  }

  if (!m) return;

  var title = isBossTip ? (m.name || '高塔 BOSS') : '敵人情報';

  // 頂置區標籤：顯示敵人/地圖屬性標籤 (圖2)
  var zoneKey = (headerSnapshot.stage && headerSnapshot.stage.zone) || 'desert';
  var elemBadgeHtml = '';

  if (isBossTip) {
    var mAttr = m.attr || m.elem || null;
    if (mAttr && ELEM_INFO[mAttr]) {
      var info = ELEM_INFO[mAttr];
      var emoji = (mAttr === 'poison' ? '🟢' : (mAttr === 'dark' ? '🟣' : info.emoji));
      var shortName = info.short || info.name;
      elemBadgeHtml = '<span style="padding:1px 6px; font-size:12px; font-weight:normal; border-radius:4px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:var(--text);">' + emoji + ' ' + shortName + '屬性</span>';
    }
  } else {
    /* 以場景權重標籤作為唯一來源，保留目前敵人的屬性在第一個位置。
       舊邏輯先加入無百分比的 m.attr，再加入同屬性的加權標籤，會造成
       「暗屬性」與「暗屬性 (56.7%)」同時出現。 */
    var elemTags = zoneElementTagsList(zoneKey, Infinity);
    var currentAttr = m.attr || null;
    var tagList = [];
    elemTags.forEach(function (t) {
      if (t.attr === currentAttr) tagList.unshift(t);
      else tagList.push(t);
    });
    if (tagList.length > 0) {
      elemBadgeHtml = tagList.slice(0, 2).map(function (tag) {
        return '<span style="padding:1px 6px; font-size:12px; font-weight:normal; border-radius:4px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:var(--text); margin-left:4px;">' + tag.label + '</span>';
      }).join('');
    }
  }

  var dropTip = '<div class="skt-name" style="margin-bottom:6px; display:flex; align-items:center; justify-content:space-between;">' +
    '<span>【' + title + '】</span>' + (elemBadgeHtml ? '<div style="display:flex; align-items:center;">' + elemBadgeHtml + '</div>' : '') + '</div>' +
    '<div class="skt-desc" style="text-align:left;">' +
    (m.magic ? '🔮 魔法攻擊力：' : '⚔️ 物理攻擊力：') + fmt(m.atk) + '<br>' +
    '⚡ 攻擊速度：' + fmt1(m.aspd) + ' 次/秒<br>' +
    '🛡️ 物理防禦：' + fmt(m.def) + '<br>' +
    '🔮 魔法防禦：' + fmt(m.mdef || m.def * 0.75) + '<br>' +
    '❤️ 最大生命：' + fmt(m.maxHp) + '<br>' +
    '🎯 命中率：' + (m.hit || 100) + '%<br>' +
    '🌀 閃避率：' + (m.dodge || 0) + '%<br>' +
    '🧠 控制抵抗：' + (m.ctrlRes || 0) + '%';

  // BOSS 特殊技·元素審判：元素 BOSS 每次攻擊都額外附帶一段元素傷害。
  // 該段傷害先比照魔法傷害吃魔防／魔抗，最後再受玩家對應「屬性抗性」影響。
  var mElem = m.elem || null;
  var mElemAtk = (mElem && m.elemAtk && m.elemAtk[mElem]) ? m.elemAtk[mElem] : 0;
  if (mElemAtk > 0 && ELEM_INFO[mElem]) {
    dropTip += '<br>✨ 特殊技·元素審判：每次攻擊額外造成 ' + ELEM_INFO[mElem].emoji + ' ' +
      fmt(mElemAtk) + ' ' + ELEM_INFO[mElem].name + '元素傷害' +
      '<span style="color:var(--dim)">（先比照魔法傷害吃魔防／魔抗，再受你的「' + ELEM_INFO[mElem].name + '抗性」減免；蓄力重擊／狂暴倍率同樣生效）</span>';
  }
  dropTip += '</div>';

  if (isBossTip) {
    var floor = (towerRuntime && towerRuntime.floor) || 1;
    var rw = towerRewardFor(floor, false);
    var dustRate = bossDustRate(floor);
    var soulOriginRate = hellSoulOriginDropChance(floor);
    var ancientEssenceRate = ancientEssenceDropChanceForBoss(floor);

    var rewardLines = [];
    rewardLines.push('💰 金幣 x' + fmt(rw.gold));
    rewardLines.push('✨ 經驗 x' + fmt(m.xp));
    rewardLines.push('💎 寶石 等級 ' + rw.gemLevel + ' x2 顆');
    rewardLines.push('🔮 附魔精華 x' + rw.essence + '（另附魔書 x2）');
    rewardLines.push('📜 魔法卷軸（附魔精華的 1/10，機率式進位）');
    if (dustRate > 0) rewardLines.push('💫 魔塵 (' + fmt1(dustRate) + '%)');
    if (soulOriginRate > 0) rewardLines.push('🧿 魔魂本源 (' + fmt1(soulOriginRate) + '%)');
    if (ancientEssenceRate > 0) rewardLines.push('🧿 太古精華 (' + fmt1(ancientEssenceRate) + '%)');

    dropTip += '<div class="skt-name" style="margin:8px 0 6px;">【可能掉落】</div>' +
      '<div class="skt-desc" style="text-align:left;">' +
      rewardLines.join('<br>') + '</div>';
  } else {
    var zoneKey = (headerSnapshot.stage && headerSnapshot.stage.zone) || 'desert';
    var stage = (headerSnapshot.stage && headerSnapshot.stage.current) || 1;
    var zoneDrop = fieldMaterialConfigFor(zoneKey, stage);
    var rates = fieldDropRatesFor(stage, m.level, zoneKey);
    var equipStrs = [];
    for (var r = rates.length - 1; r >= 0; r--) {
      if (!rates[r]) continue;
      var rate = rates[r];
      var rateStr = rate + '%';
      equipStrs.push('⚔️ <span style="color:' + RARITIES[r].color + '; font-weight:bold;">' + RARITIES[r].name + '裝備</span> <span style="color:var(--dim)">(' + rateStr + ')</span>');
    }

    var dustLine = '';
    if (!towerActive) {
      var dustRate = Number(zoneDrop.dustRate || 0);
      if (dustRate > 0) dustLine = '💫 魔塵 <span style="color:var(--dim)">(' + fmt1(dustRate) + '%，神鑄材料)</span>';
    }

    if (equipStrs.length || dustLine) {
      dropTip += '<div class="skt-name" style="margin:8px 0 6px;">【可能掉落】</div>' +
        '<div class="skt-desc" style="text-align:left;">' +
        '💰 金幣 x' + fmt(m.gold) + ' <span style="color:var(--dim)">(基礎)</span><br>' +
        '✨ 經驗 x' + fmt(m.xp) + ' <span style="color:var(--dim)">(基礎)</span><br>' +
        (dustLine ? dustLine + (equipStrs.length ? '<br>' : '') : '') +
        equipStrs.join('<br>') + '</div>';
    }
  }

  tip.innerHTML = dropTip;
  tip.style.display = 'block';
  var rRect = anchorEl.getBoundingClientRect();
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var x = rRect.right + 10, y = rRect.top;
  if (x + tw > window.innerWidth - 8) x = rRect.left - tw - 10;
  if (x < 8) x = 8;
  if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
  if (y < 8) y = 8;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

function hideTooltip() {
  var tip = $id('sk-tooltip');
  if (tip) tip.style.display = 'none';
  UI.tooltipAnchor = null;
}

function hideAffixPool() {
  var overlay = $id('affix-pool-overlay');
  if (!overlay) return;
  overlay.style.display = 'none';
  overlay.innerHTML = '';
  UI.affixPoolSource = null;
}

function toggleAffixPool(anchorEl) {
  var overlay = $id('affix-pool-overlay');
  var source = anchorEl && anchorEl.nextElementSibling;
  if (!overlay || !source) return;
  if (UI.affixPoolSource === source && overlay.style.display !== 'none') {
    hideAffixPool();
    return;
  }
  overlay.innerHTML = source.innerHTML;
  overlay.style.display = 'block';
  UI.affixPoolSource = source;

  var r = anchorEl.getBoundingClientRect();
  var tw = overlay.offsetWidth, th = overlay.offsetHeight;
  var x = r.right - tw, y = r.bottom + 8;
  if (x < 8) x = r.left;
  if (x + tw > window.innerWidth - 8) x = window.innerWidth - tw - 8;
  if (y + th > window.innerHeight - 8) y = r.top - th - 8;
  if (y < 8) y = 8;
  overlay.style.left = x + 'px';
  overlay.style.top = y + 'px';
}

// 融合面板
function renderFusionPanel(skillsSnapshot) {
  var slotBox = $id('fusion-slots');
  if (!slotBox) return;
  skillsSnapshot = skillsSnapshot || uiSkillsPanelSnapshot();
  if (!skillsSnapshot) return;
  var h = '';
  for (var i = 0; i < 4; i++) {
    var id = UI.fuseSlots[i];
    var d = id ? SKILLS[id] : null;
    if (d) {
      var lv = skillViewLevel(skillsSnapshot, id);
      h += '<div class="tree-cell fusion-selected" data-fuse-remove="' + id + '" data-tip="點擊移出" style="margin:0 4px; cursor:pointer;">' +
        '<span class="tc-emoji">' + d.emoji + '</span>' +
        '<span class="tc-lv">' + lv + '</span>' +
        '</div>';
    } else {
      h += '<div class="tree-cell" style="margin:0 4px; border:2px dashed var(--border); background:transparent; opacity:0.5; color:var(--dim); font-size:11px; cursor:default;">素材 ' + (i + 1) + '</div>';
    }
  }
  slotBox.innerHTML = h;
  var info = $id('fusion-preview');
  var fuseBtn = $id('btn-fuse');
  var slotCount = UI.fuseSlots.length;
  if (slotCount >= 2) {
    // 花費與庫存（快照 scrolls 由 Worker 投影；fusionGoldCost/fusionScrollCost 主執行緒同樣載入 formula.js）
    var costGold = (typeof fusionGoldCost === 'function') ? fusionGoldCost(slotCount)
      : (skillsSnapshot.fusionCosts ? skillsSnapshot.fusionCosts.goldPerComp * slotCount : 0);
    var costScroll = (typeof fusionScrollCost === 'function') ? fusionScrollCost(slotCount)
      : (skillsSnapshot.fusionCosts ? skillsSnapshot.fusionCosts.scrollPerComp * slotCount : 0);
    var haveScroll = Math.max(0, Math.floor(Number(skillsSnapshot.scrolls) || 0));
    info.textContent = '花費：💰' + fmt(costGold) + ' 金幣＋📜' + costScroll + ' 張魔法卷軸（持有 ' + haveScroll + '）' +
      '｜融合以素材「滿級」數值隨機生成，產生後為未學習（升至 Lv.1 才可裝備）' +
      '｜素材投入期間無法裝備，刪除融合技後釋放｜變異機率 ' + fmt1(Math.min(100, FUSION_MUTATION_CHANCE)) + '%';
    if (fuseBtn) fuseBtn.disabled = haveScroll < costScroll;
  } else {
    info.textContent = '請從技能詳情按「⚗️ 加入融合」放入 2~4 個已解鎖的主動技能（不需學習；被動與潛力技能除外）。';
    if (fuseBtn) fuseBtn.disabled = false;
  }
}

/* ---- 寶石分頁 ---- */
function renderGems() {
  var box = $id('gem-table');
  if (!box) return;
  var gemsSnapshot = uiGemsPanelSnapshot();
  var headerSnapshot = uiHeaderPanelSnapshot();
  if (!gemsSnapshot || !headerSnapshot) return;
  var h = '<table class="gem-tbl"><tr><th>寶石</th><th>鑲嵌能力</th>';
  for (var lv = 1; lv <= GEM_FORGE_MAX_LEVEL; lv++) h += '<th>' + GEM_NAMES[lv] + '</th>';
  h += '</tr>';
  for (var t in GEM_TYPES) {
    var gt = GEM_TYPES[t];
    var v1 = gemStatValue(t, 1), vMax = gemStatValue(t, GEM_FORGE_MAX_LEVEL);
    h += '<tr><td class="gem-name">' + gt.emoji + ' ' + esc(gt.name) + '</td>' +
      '<td class="dim-text">' + esc(gt.statName.replace('%', '')) + '（L1 +' + (gt.pct ? pctStr(v1) : fmt(v1)) +
      ' ～ L' + GEM_FORGE_MAX_LEVEL + ' +' + (gt.pct ? pctStr(vMax) : fmt(vMax)) + '）</td>';
    for (var lv2 = 1; lv2 <= GEM_FORGE_MAX_LEVEL; lv2++) {
      var n = gemsViewCount(gemsSnapshot, t, lv2);
      h += '<td class="gem-cnt' + (n ? ' has' : '') + '">' + (n || '－') + '</td>';
    }
    h += '</tr>';
  }
  h += '</table>';
  box.innerHTML = h;
  fillGemTypeSelect($id('fuse-type'), true);
  fillGemTypeSelect($id('gconv-target'));
  fillGemTypeSelect($id('gdis-type'));
  renderFuseInfo(gemsSnapshot);
  renderGemConvert(gemsSnapshot);
  renderGemDismantle(gemsSnapshot);
  renderGemFusion(gemsSnapshot, headerSnapshot);
  renderGemShop(gemsSnapshot, headerSnapshot);
}

function gemAbilityText(type, lv) {
  var gt = GEM_TYPES[type];
  if (!gt) return '';
  var val = gemStatValue(type, lv);
  return gt.statName.replace(/%/g, '') + ' +' + (gt.pct ? pctStr(val) : fmt(val));
}

// 寶石種類下拉選單（18 種；只填一次，保留玩家選擇）
function fillGemTypeSelect(sel, includeAll) {
  if (!sel || sel.options.length) return;
  var h = '';
  if (includeAll) {
    h += '<option value="' + GEM_TYPE_ALL + '" style="color:#f5c542;font-weight:bold" selected>💎 全部類型寶石</option>';
  }
  for (var t in GEM_TYPES) {
    h += '<option value="' + t + '">' + GEM_TYPES[t].emoji + ' ' + esc(GEM_TYPES[t].name) + '（' + esc(GEM_TYPES[t].statName.replace('%', '')) + '）</option>';
  }
  sel.innerHTML = h;
}
/* ---- 寶石合成（3 顆同種同級 → 下一階） ---- */
function renderFuseInfo(gemsSnapshot) {
  var selT = $id('fuse-type'), selL = $id('fuse-level');
  var info = $id('fuse-info');
  if (!selT || !selL || !info) return;
  gemsSnapshot = resolveGemsPanelSnapshot(gemsSnapshot);
  if (!gemsSnapshot) return;
  var t = selT.value, lv = parseInt(selL.value, 10) || 1;
  if (t === GEM_TYPE_ALL) {
    var total = 0, available = 0;
    for (var allType in GEM_TYPES) {
      var allCount = gemsViewCount(gemsSnapshot, allType, lv);
      total += allCount;
      available += Math.floor(allCount / GEM_COMPOSE_INPUT_COUNT);
    }
    info.innerHTML = '「💎 全部類型寶石」' + GEM_NAMES[lv] + '庫存總計 ' + fmt(total) +
      ' 顆｜每次消耗同種類 ' + GEM_COMPOSE_INPUT_COUNT + ' 顆＋<img src="images/icon_gold.png" class="res-icon">' + fmt(FUSE_GOLD_COST[lv]) +
      ' → 1 顆下一階寶石｜目前可合成 ' + available + ' 次';
    return;
  }
  if (!GEM_TYPES[t]) return;
  var n = gemsViewCount(gemsSnapshot, t, lv);
  info.innerHTML = '「' + GEM_TYPES[t].emoji + esc(GEM_NAMES[lv] + GEM_TYPES[t].name) + '」庫存 ' + fmt(n) +
    ' 顆｜每次消耗 ' + GEM_COMPOSE_INPUT_COUNT + ' 顆＋<img src="images/icon_gold.png" class="res-icon">' + fmt(FUSE_GOLD_COST[lv]) +
    ' → 1 顆' + esc(GEM_NAMES[lv + 1] + GEM_TYPES[t].name) + '｜目前可合成 ' + Math.floor(n / GEM_COMPOSE_INPUT_COUNT) + ' 次';
}

/* ---- 寶石轉換（九宮格；UI.convertSlots = [{type,lv,n}]，轉換時才實際扣庫存） ---- */
function copyGemConvertSlots(slots) {
  return (slots || []).map(function (slot) {
    return { type: slot.type, lv: slot.lv, n: slot.n };
  });
}

function adjustGemConvertPool(slots, type, lv, available, single, stackLimit, slotLimit) {
  var next = copyGemConvertSlots(slots);
  var index = -1;
  for (var i = 0; i < next.length; i++) {
    if (next[i].type === type && next[i].lv === lv) {
      index = i;
      break;
    }
  }
  var placed = index >= 0 ? next[index].n : 0;
  var amount = Math.min(
    Math.max(0, Number(stackLimit) - placed),
    Math.max(0, Number(available) - placed)
  );
  if (single) amount = Math.min(1, amount);
  if (amount <= 0) return { ok: false, reason: 'limit', amount: 0, slots: next };
  if (index >= 0) {
    next[index].n += amount;
  } else {
    if (next.length >= Number(slotLimit)) {
      return { ok: false, reason: 'slots', amount: 0, slots: next };
    }
    next.push({ type: type, lv: lv, n: amount });
  }
  return { ok: true, amount: amount, slots: next };
}

function removeGemConvertSlot(slots, index, single) {
  var next = copyGemConvertSlots(slots);
  if (index < 0 || index >= next.length) {
    return { ok: false, reason: 'missing', amount: 0, slots: next };
  }
  var amount = single ? 1 : next[index].n;
  if (next[index].n <= amount) next.splice(index, 1);
  else next[index].n -= amount;
  return { ok: true, amount: amount, slots: next };
}

function renderGemConvert(gemsSnapshot) {
  var grid = $id('gconv-grid');
  if (!grid) return;
  gemsSnapshot = resolveGemsPanelSnapshot(gemsSnapshot);
  if (!gemsSnapshot) return;
  if (!UI.convertSlots) UI.convertSlots = [];
  var h = '';
  for (var i = 0; i < GEM_CONVERT_SLOTS; i++) {
    var s = UI.convertSlots[i];
    if (s) {
      h += '<div class="gconv-slot filled" data-gconv-slot="' + i + '" title="點擊取出">' +
        '<div class="gconv-emoji">' + GEM_TYPES[s.type].emoji + '</div>' +
        '<div class="gconv-label">' + esc(GEM_NAMES[s.lv] + GEM_TYPES[s.type].name) + '</div>' +
        '<div class="gconv-n">×' + s.n + '</div></div>';
    } else {
      h += '<div class="gconv-slot"></div>';
    }
  }
  grid.innerHTML = h;
  // 轉換結果預覽
  var targetSel = $id('gconv-target');
  var target = targetSel ? targetSel.value : null;
  var info = $id('gconv-info');
  if (info) {
    if (UI.convertSlots.length && target && GEM_TYPES[target]) {
      var byLv = {};
      UI.convertSlots.forEach(function (s2) { byLv[s2.lv] = (byLv[s2.lv] || 0) + s2.n; });
      var parts = Object.keys(byLv).sort().map(function (lv2) { return esc(GEM_NAMES[lv2]) + ' ×' + byLv[lv2]; });
      info.innerHTML = '轉換結果預覽：' + GEM_TYPES[target].emoji + esc(GEM_TYPES[target].name) + '（' + parts.join('、') + '）— 同階轉換、數量不變 <span style="color:#ef4444; margin-left: 8px;">Shift+左鍵：單顆放入／取下</span>';
    } else {
      info.innerHTML = '點下方庫存寶石放入九宮格，選擇目標種類後按「一鍵轉換」。 <span style="color:#ef4444; margin-left: 8px;">Shift+左鍵：單顆放入／取下</span>';
    }
  }
  // 庫存池（顯示尚可放入的數量）
  var pool = $id('gconv-pool');
  if (!pool) return;

  // 更新排序按鈕文字
  var btnGemSort = $id('btn-gem-sort');
  if (btnGemSort) {
    btnGemSort.textContent = (UI.gemSortType === 'level') ? '排序：等級優先' : '排序：類型優先';
  }

  var gemItems = [];
  for (var t in GEM_TYPES) {
    for (var lv = 1; lv <= GEM_FORGE_MAX_LEVEL; lv++) {
      var have = gemsViewCount(gemsSnapshot, t, lv);
      if (!have) continue;
      var placed = 0;
      for (var ci = 0; ci < UI.convertSlots.length; ci++) {
        if (UI.convertSlots[ci].type === t && UI.convertSlots[ci].lv === lv) placed = UI.convertSlots[ci].n;
      }
      var left = have - placed;
      gemItems.push({ type: t, lv: lv, left: left, have: have });
    }
  }

  // 寶石排序
  var gemTypesKeys = Object.keys(GEM_TYPES);
  gemItems.sort(function (a, b) {
    if (UI.gemSortType === 'level') {
      if (a.lv !== b.lv) return b.lv - a.lv;
      return gemTypesKeys.indexOf(a.type) - gemTypesKeys.indexOf(b.type);
    } else {
      var idxA = gemTypesKeys.indexOf(a.type);
      var idxB = gemTypesKeys.indexOf(b.type);
      if (idxA !== idxB) return idxA - idxB;
      return a.lv - b.lv;
    }
  });

  var chips = gemItems.map(function (item) {
    var t = item.type, lv = item.lv, left = item.left;
    var tip = esc(GEM_NAMES[lv] + GEM_TYPES[t].name + '｜' + gemAbilityText(t, lv) + '｜可放入 ' + left + ' 顆｜點擊放入九宮格');
    return '<span class="gem-chip gem-inventory-cell' + (left > 0 ? '' : ' dim') + '" data-gconv-pick="' + t + ':' + lv + '" data-tip="' + tip + '">' +
      '<span class="gem-chip-count">×' + left + '</span>' +
      '<span class="gem-chip-emoji">' + GEM_TYPES[t].emoji + '</span>' +
      '<span class="gem-chip-level">' + lv + '</span></span>';
  });

  pool.innerHTML = chips.length ? chips.join('') : '<span class="hint">沒有寶石庫存</span>';
}

/* ---- 寶石拆解 ---- */
function renderGemDismantle(gemsSnapshot) {
  var selT = $id('gdis-type'), selL = $id('gdis-level'), info = $id('gdis-info');
  if (!selT || !selL || !info) return;
  gemsSnapshot = resolveGemsPanelSnapshot(gemsSnapshot);
  if (!gemsSnapshot) return;
  var t = selT.value, lv = parseInt(selL.value, 10) || 2;
  if (GEM_TYPES[t]) {
    var n = gemsViewCount(gemsSnapshot, t, lv);
    info.innerHTML = '「' + GEM_TYPES[t].emoji + esc(GEM_NAMES[lv] + GEM_TYPES[t].name) + '」庫存 ' + fmt(n) +
      ' 顆｜每顆拆解 → <b>' + gemDismantleYield(lv) + '</b> 顆一級' + esc(GEM_TYPES[t].name) +
      '（合成成本 ' + gemL1Worth(lv) + ' 顆一級 × 70%）';
  }
  var fl = $id('gdis-fused');
  if (fl) {
    var chips = gemsViewFused(gemsSnapshot).map(function (fg) {
      var emojis = fg.stats.map(function (s) { return GEM_TYPES[s.type].emoji; }).join('');
      var yieldAmt = fusedGemDismantleYield(fg);
      var tip = esc(fusedGemLabel(fg)) + '｜融合 ' + (fg.fusions || 0) + ' 次｜拆解可得 ⛏️ ' + yieldAmt + ' 顆｜成本 ' + fusedGemL1Worth(fg) + ' 顆一級 × 70%';
      return '<span class="gem-chip fused-chip gem-inventory-cell" data-gdis-fused="' + fg.id + '" data-tip="' + tip + '">' +
        '<span class="gem-chip-count">×1</span>' +
        '<span class="gem-chip-emoji">' + emojis + '</span>' +
        '<span class="gem-chip-level" style="color:#f0abfc">融' + (fg.fusions || 0) + '</span></span>';
    });
    fl.innerHTML = chips.length ? chips.join('') : '<span class="hint">尚無融合寶石</span>';
  }
}
// 拆解結果訊息區（保留最近 3 筆，新訊息在最上）
function gdisShow(msg, warn) {
  var box = $id('gdis-result');
  if (!box) return;
  if (!UI.gdisMsgs) UI.gdisMsgs = [];
  UI.gdisMsgs.unshift({ t: msg, w: !!warn });
  if (UI.gdisMsgs.length > 3) UI.gdisMsgs.length = 3;
  box.innerHTML = UI.gdisMsgs.map(function (m) {
    return '<span class="gr-line' + (m.w ? ' warn' : '') + '">' + m.t + '</span>';
  }).join('');
}

function gfuseShow(msg, type) {
  var box = $id('gfuse-result');
  if (!box) return;
  if (!UI.gfuseMsgs) UI.gfuseMsgs = [];
  UI.gfuseMsgs.unshift({ t: msg, c: type });
  if (UI.gfuseMsgs.length > 3) UI.gfuseMsgs.length = 3;
  box.innerHTML = UI.gfuseMsgs.map(function (m) {
    var cls = m.c === 'yellow' ? ' yellow' : (m.c === 'warn' ? ' warn' : '');
    return '<span class="gr-line' + cls + '">' + m.t + '</span>';
  }).join('');
}
/* ---- 寶石融合 v2（雙屬性，5 階以上寶石均可） ---- */
function renderGemFusion(gemsSnapshot, headerSnapshot) {
  var fusionPanel = $id('gem-fusion-panel');
  // HTML 初始為隱藏；每次載入／重繪都重新依目前角色條件決定是否顯示。
  if (fusionPanel) fusionPanel.style.display = 'none';
  var slotBox = $id('gfuse-slots');
  if (!slotBox) return;
  gemsSnapshot = resolveGemsPanelSnapshot(gemsSnapshot);
  if (!gemsSnapshot) return;
  headerSnapshot = headerSnapshot || uiHeaderPanelSnapshot();
  var player = headerSnapshot && headerSnapshot.player;
  var fusionUnlocked = Number(player && player.level) >= GEM_FUSION_UNLOCK_LEVEL &&
    uiReincarnationCount(headerSnapshot) >= GEM_FUSION_UNLOCK_REINCARNATIONS;
  var fusionButton = $id('gfuse-btn');
  var clearButton = $id('gfuse-clear');
  if (!fusionUnlocked) {
    UI.gemFuseSlots = [null, null];
    return;
  }
  if (fusionPanel) fusionPanel.style.display = '';
  if (fusionButton) fusionButton.disabled = false;
  if (clearButton) clearButton.disabled = false;
  if (!UI.gemFuseSlots) UI.gemFuseSlots = [null, null];
  var h = '';
  for (var i = 0; i < 2; i++) {
    var ref = UI.gemFuseSlots[i];
    if (ref) {
      if (ref.kind === 'plain') {
        var t = ref.type, flv = ref.lv || GEM_MAX_LEVEL;
        var fcol = GEM_TIER_COLORS[flv] || '#ffd700';
        h += '<span class="gem-chip gem-inventory-cell" data-gfuse-remove="' + i + '" style="border-color:' + fcol + '" data-tip="' + esc(gemLabel(t, flv)) + '｜點擊移出">' +
          '<span class="gem-chip-count">×1</span>' +
          '<span class="gem-chip-emoji">' + GEM_TYPES[t].emoji + '</span>' +
          '<span class="gem-chip-level">' + flv + '</span></span>';
      } else {
        var fg = gemsViewFindFused(gemsSnapshot, ref.id);
        if (fg) {
          var emojis = fg.stats.map(function (s) { return GEM_TYPES[s.type].emoji; }).join('');
          h += '<span class="gem-chip fused-chip gem-inventory-cell" data-gfuse-remove="' + i + '" data-tip="' + esc(fusedGemLabel(fg)) + '｜點擊移出">' +
            '<span class="gem-chip-count">×1</span>' +
            '<span class="gem-chip-emoji">' + emojis + '</span>' +
            '<span class="gem-chip-level" style="color:#f0abfc">融' + (fg.fusions || 0) + '</span></span>';
        } else {
          h += '<span class="loadout-slot filled" data-gfuse-remove="' + i + '">（已消失）</span>';
        }
      }
    } else {
      h += '<span class="loadout-slot" style="display:inline-flex;align-items:center;height:48px;box-sizing:border-box;vertical-align:top;">素材 ' + (i + 1) + '（5階以上）</span>';
    }
  }
  slotBox.innerHTML = h;
  // 資訊列
  var info = $id('gfuse-info');
  var m1 = UI.gemFuseSlots[0]
    ? gemsViewNormalizeFuseMaterial(gemsSnapshot, UI.gemFuseSlots[0])
    : null;
  var m2 = UI.gemFuseSlots[1]
    ? gemsViewNormalizeFuseMaterial(gemsSnapshot, UI.gemFuseSlots[1])
    : null;
  if (m1 && m2) {
    var types = gemFuseTypesOk(m1, m2);
    if (types) {
      info.textContent = '成功率 ' + gemFuseRate(m1, m2) + '%｜融合後屬性：' +
        types.map(function (t) { return GEM_TYPES[t].statName.replace('%', ''); }).join('＋') +
        '｜失敗時較弱方降解為低階寶石';
    } else {
      info.textContent = '⚠️ 屬性不相容：融合後最多只能有 2 種屬性';
    }
  } else {
    info.textContent = '請放入 2 顆素材（5 階以上一般寶石或融合寶石；融合寶石無法用於神鑄）';
  }
  // 素材池（5 階以上一般寶石，高階神鑄寶石一併列出）
  var pool = $id('gfuse-pool');
  var chips = [];
  for (var flv = GEM_MAX_LEVEL; flv <= GEM_FORGE_MAX_LEVEL; flv++) {
    for (var t in GEM_TYPES) {
      var n = gemsViewCount(gemsSnapshot, t, flv);
      if (n > 0) {
        var fcol = GEM_TIER_COLORS[flv] || '#ffd700';
        chips.push('<span class="gem-chip gem-inventory-cell" data-gfuse-pick="plain:' + t + ':' + flv + '" style="border-color:' + fcol + '" ' +
          'data-tip="' + esc(gemLabel(t, flv) + '｜' + GEM_TYPES[t].statName.replace('%', '') + ' +' +
            (GEM_TYPES[t].pct ? pctStr(gemStatValue(t, flv)) : fmt(gemStatValue(t, flv))) + '｜點擊放入融合槽') + '">' +
          '<span class="gem-chip-count">×' + fmt(n) + '</span>' +
          '<span class="gem-chip-emoji">' + GEM_TYPES[t].emoji + '</span>' +
          '<span class="gem-chip-level">' + flv + '</span></span>');
      }
    }
  }
  gemsViewFused(gemsSnapshot).forEach(function (fg) {
    var emojis = fg.stats.map(function (s) { return GEM_TYPES[s.type].emoji; }).join('');
    chips.push('<span class="gem-chip fused-chip gem-inventory-cell" data-gfuse-pick="fused:' + fg.id + '" data-tip="' + esc(fusedGemLabel(fg)) + '｜已成功融合 ' + (fg.fusions || 0) + ' 次（下次成功率遞減）">' +
      '<span class="gem-chip-count">×1</span>' +
      '<span class="gem-chip-emoji">' + emojis + '</span>' +
      '<span class="gem-chip-level" style="color:#f0abfc">融' + (fg.fusions || 0) + '</span></span>');
  });
  pool.innerHTML = chips.length ? chips.join('') : '<span class="hint">沒有 5 階以上寶石 — 可透過寶石升階、寶石合成、商店或神鑄取得</span>';
}

/* ---- 寶石商店 ---- */
var GEM_TIER_COLORS = {
  1: '#9aa5b1', 2: '#4ade80', 3: '#38bdf8', 4: '#c084fc', 5: '#ffd700',
  // 6~10 階：神鑄寶石（僅能由神鑄法陣合成）
  6: '#fb923c', 7: '#f87171', 8: '#b8860b', 9: '#f5c542', 10: '#7df9ff'
};
function renderGemShop(gemsSnapshot, headerSnapshot) {
  var grid = $id('gem-shop-grid');
  if (!grid) return;
  gemsSnapshot = gemsSnapshot || uiGemsPanelSnapshot();
  headerSnapshot = headerSnapshot || uiHeaderPanelSnapshot();
  var s = gemsSnapshot && gemsSnapshot.shop;
  var player = headerSnapshot && headerSnapshot.player;
  if (!s || !player) return;
  var levelEl = $id('gem-shop-level');
  if (levelEl) levelEl.textContent = '商店 Lv.' + s.level;
  var shopPendingKey = nodePendingKey('gem-shop');
  var upgradeBtn = $id('shop-upgrade');
  if (upgradeBtn) {
    upgradeBtn.setAttribute('data-ui-pending-key', shopPendingKey);
    if (s.level >= GEM_SHOP_MAX_LEVEL) {
      upgradeBtn.textContent = '✅ 已滿級';
      upgradeBtn.disabled = true;
      upgradeBtn.removeAttribute('data-tip');
    } else {
      upgradeBtn.innerHTML = '⬆️ 升級（<img src="images/icon_gold.png" class="res-icon">' + fmt(gemShopUpgradeCost(s.level)) + '）';
      upgradeBtn.disabled = player.gold < gemShopUpgradeCost(s.level);
    }
  }
  var htmls = s.items.map(function (item, i) {
    var gt = GEM_TYPES[item.type];
    var c = GEM_TIER_COLORS[item.lv];
    return '<div class="shop-card' + (item.sold ? ' sold' : '') + '" style="border-color:' + c + '">' +
      '<div class="shop-emoji">' + gt.emoji + '</div>' +
      '<div class="shop-name" style="color:' + c + '">' + esc(GEM_NAMES[item.lv] + gt.name) + '</div>' +
      '<div class="shop-stat">' + esc(gt.statName.replace('%', '')) + ' +' +
      (gt.pct ? pctStr(gemStatValue(item.type, item.lv)) : fmt(gemStatValue(item.type, item.lv))) + '</div>' +
      (item.sold
        ? '<div class="shop-sold">已購買</div>'
        : '<button class="btn sm" data-shop-buy="' + i + '"' + pendingUiButtonAttributes(shopPendingKey) + '><img src="images/icon_gold.png" class="res-icon"> ' + fmt(gemShopPrice(item.lv)) + '</button>') +
      '</div>';
  });
  for (var i = htmls.length; i < 20; i++) {
    htmls.push('<div class="shop-card empty" style="border-color:transparent;background:transparent;"></div>');
  }
  grid.innerHTML = htmls.join('');
  var total = 0;
  s.items.forEach(function (it2) { if (!it2.sold) total += gemShopPrice(it2.lv); });
  var buyAllBtn = $id('shop-buy-all');
  if (buyAllBtn) buyAllBtn.setAttribute('data-ui-pending-key', shopPendingKey);
  if (buyAllBtn) buyAllBtn.innerHTML = '🛒 一鍵全購買（<img src="images/icon_gold.png" class="res-icon">' + fmt(total) + '）';
  var refBtn = $id('shop-refresh');
  if (refBtn) refBtn.setAttribute('data-ui-pending-key', shopPendingKey);
  if (refBtn) refBtn.innerHTML = '🔄 手動刷新（<img src="images/icon_gold.png" class="res-icon">' + fmt(gemsViewShopRefreshCost(s)) + '）';
  syncUiPendingControls(shopPendingKey);
  updateShopCountdown(gemsSnapshot);
}
function updateShopCountdown(gemsSnapshot) {
  var el = $id('shop-reset-cd');
  if (!el) return;
  gemsSnapshot = gemsSnapshot || uiGemsPanelSnapshot();
  var shop = gemsSnapshot && gemsSnapshot.shop;
  if (!shop) return;
  var sec = gemsViewShopCountdown(shop);
  var hh = Math.floor(sec / 3600);
  var mm = Math.floor((sec % 3600) / 60);
  var ss = sec % 60;
  el.textContent = '本週期已刷新 ' + shop.refreshCount + ' 次｜重置倒數 ' + hh + ':' + (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
}

/* ============ 迷你監控視窗（子母畫面 PiP） ============
   Chrome 會暫停被遮蔽視窗的繪製（工作列縮圖因此凍結），
   改用永遠置頂的 PiP 迷你視窗即時顯示戰況。               */
var MINI = { win: null, canvas: null, video: null, timer: null };

var MINI_CSS = 'body{margin:0;background:#0d1017;color:#d7deed;font-family:"Microsoft JhengHei",sans-serif;font-size:11px;padding:6px 8px;overflow:hidden}' +
  '.m-head{display:flex;justify-content:space-between;color:#f5b942;font-weight:bold;font-size:11.5px;margin-bottom:3px}' +
  '.m-name{font-size:11px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
  '.m-bar{position:relative;height:13px;background:#0a0d14;border:1px solid #2c3654;border-radius:7px;overflow:hidden;margin-top:2px}' +
  '.m-fill{height:100%;transition:width .3s}' +
  '.m-fill.hp{background:linear-gradient(90deg,#16a34a,#4ade80)}' +
  '.m-fill.mp{background:linear-gradient(90deg,#1d4ed8,#38bdf8)}' +
  '.m-fill.enemy{background:linear-gradient(90deg,#b91c1c,#f87171)}' +
  '.m-bar span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;text-shadow:0 1px 2px #000}' +
  '.m-vs{text-align:center;color:#7d89a6;font-size:9.5px;margin-top:3px}' +
  '.m-info{color:#38bdf8;font-size:10.5px;margin-top:3px;white-space:nowrap;overflow:hidden}' +
  '.m-log{color:#7d89a6;font-size:10px;margin-top:2px;line-height:1.45;max-height:30px;overflow:hidden}';

var MINI_HTML = '<div class="m-head"><span id="m-stage"></span><span id="m-lv"></span></div>' +
  '<div class="m-name" id="m-pname">🧝 冒險者</div>' +
  '<div class="m-bar"><div class="m-fill hp" id="m-php"></div><span id="m-ptext"></span></div>' +
  '<div class="m-bar"><div class="m-fill mp" id="m-pmp"></div><span id="m-mtext"></span></div>' +
  '<div class="m-vs" id="m-vs">⚔️ VS ⚔️</div>' +
  '<div class="m-name" id="m-ename"></div>' +
  '<div class="m-bar"><div class="m-fill enemy" id="m-ehp"></div><span id="m-etext"></span></div>' +
  '<div class="m-info" id="m-info"></div>' +
  '<div class="m-log" id="m-log"></div>';

// 蒐集目前戰況（野外 / 高塔通用）
function miniSnapshot() {
  var header = uiHeaderPanelSnapshot() || {};
  var battle = uiBattlePanelSnapshot() || {};
  var view = viewState() || {};
  var st = header.stats || { hp: view.hpMax || 1, mp: view.mpMax || 1 };
  var stage = header.stage || {};
  var field = battle.field || {};
  var tower = battle.tower || {};
  var p, enemy;
  var s = { stage: '', lv: 'Lv.' + (header.player && header.player.level || 1), pHp: 0, pHpText: '', pMp: 0, pMpText: '', eName: '', eHp: 0, eHpText: '', info: '', logs: [] };
  if (view.towerActive && tower.boss) {
    p = tower.player; enemy = tower.boss;
    s.stage = '🗼 高塔第 ' + (tower.floor || 0) + ' 層';
    s.info = '⏱️ 剩餘 ' + fmt1(Math.max(0, towerTimeLimitWithTalents(tower.floor) - (tower.elapsed || 0))) + 's' + (tower.enraged ? '　🔥狂暴中' : '');
  } else {
    p = field.player; enemy = field.monster || (Array.isArray(field.monsters) ? field.monsters[0] : null);
    var zone = ZONES[stage.zone] || {};
    s.stage = (zone.emoji || '') + (zone.name || '') + ' 第 ' + (stage.current || 0) + ' 階段';
    s.info = '📈 DPS ' + fmt(header.dps || 0) + '　<img src="images/icon_gold.png" class="res-icon">' + fmt(view.gold || 0);
  }
  if (p) {
    s.pHp = clamp(p.hp / st.hp * 100, 0, 100);
    s.pHpText = fmt(Math.max(0, p.hp)) + ' / ' + fmt(st.hp);
    s.pMp = clamp(p.mp / st.mp * 100, 0, 100);
    s.pMpText = fmt(Math.floor(p.mp)) + ' / ' + fmt(st.mp);
  }
  if (enemy) {
    s.eName = (enemy.emoji || '👾') + ' ' + (enemy.name || '') + ' Lv.' + enemy.level;
    s.eHp = clamp(enemy.hp / enemy.maxHp * 100, 0, 100);
    s.eHpText = fmt(Math.max(0, enemy.hp)) + ' / ' + fmt(enemy.maxHp);
  } else {
    s.eName = '⏳ 搜索敵人中…';
  }
  var lines = document.querySelectorAll('#battle-log .log-line');
  for (var i = 0; i < Math.min(2, lines.length); i++) s.logs.push(lines[i].textContent);
  return s;
}


function renderMiniWindow() {
  if (!MINI.win) return;
  try {
    var d = MINI.win.document;
    var s = miniSnapshot();
    d.getElementById('m-stage').textContent = s.stage;
    d.getElementById('m-lv').textContent = s.lv;
    d.getElementById('m-php').style.width = s.pHp + '%';
    d.getElementById('m-ptext').textContent = s.pHpText;
    d.getElementById('m-pmp').style.width = s.pMp + '%';
    d.getElementById('m-mtext').textContent = s.pMpText;
    d.getElementById('m-ename').textContent = s.eName;
    d.getElementById('m-ehp').style.width = s.eHp + '%';
    d.getElementById('m-etext').textContent = s.eHpText;
    d.getElementById('m-info').textContent = s.info;
    d.getElementById('m-log').innerHTML = s.logs.map(function (l) { return esc(l); }).join('<br>');
  } catch (e) { MINI.win = null; }
}

function openMiniWindow() {
  if (MINI.win) { blog('📺 迷你視窗已經開啟中', 'info'); return; }
  // 主方案：Document Picture-in-Picture（Chrome 116+）
  if (window.documentPictureInPicture && documentPictureInPicture.requestWindow) {
    // 防呆：若 3 秒內沒有任何結果（極少數環境會懸置），改走影片 PiP
    var settled = false;
    setTimeout(function () { if (!settled && !MINI.win) openVideoPip(); }, 3000);
    documentPictureInPicture.requestWindow({ width: 238, height: 210 }).then(function (pip) {
      settled = true;
      MINI.win = pip;
      var d = pip.document;
      var style = d.createElement('style');
      style.textContent = MINI_CSS;
      d.head.appendChild(style);
      d.title = '無限征途：戰況監控';
      d.body.innerHTML = MINI_HTML;
      pip.addEventListener('pagehide', function () { MINI.win = null; });
      // 在 PiP 視窗內建立計時器：不受主視窗背景節流影響，更新流暢
      pip.setInterval(renderMiniWindow, 300);
      renderMiniWindow();
      blog('📺 迷你監控視窗已開啟（永遠置頂，可拖曳/縮放）', 'good');
    }).catch(function () { settled = true; openVideoPip(); });
  } else {
    openVideoPip();
  }
}

/* ---- 分頁標題即時戰況（工作列懸停提示也會顯示） ---- */
var _titleTimer = 0;
function updateLiveTitle() {
  var header = uiHeaderPanelSnapshot() || {};
  var battle = uiBattlePanelSnapshot() || {};
  var view = viewState() || {};
  var st = header.stats || { hp: view.hpMax || 1 };
  var t;
  if (view.towerActive && battle.tower && battle.tower.boss) {
    var tower = battle.tower;
    t = '🗼' + tower.floor + '層 ' + Math.round(tower.boss.hp / tower.boss.maxHp * 100) + '%｜' +
      Math.ceil(Math.max(0, towerTimeLimitWithTalents(tower.floor) - (tower.elapsed || 0))) + 's';
  } else {
    var p = battle.field && battle.field.player;
    var hpPct = p ? Math.round(p.hp / st.hp * 100) : 100;
    var zone = ZONES[header.stage && header.stage.zone] || {};
    t = (zone.emoji || '') + '第' + (header.stage && header.stage.current || 0) + '階段 Lv.' +
      (header.player && header.player.level || 1) + ' ❤️' + hpPct + '%';
  }
  document.title = t + '｜無限征途';
}


// 後備方案：Canvas → 影片子母畫面（相容較舊瀏覽器）
function drawMiniCanvas() {
  var c = MINI.canvas, ctx = c.getContext('2d');
  var s = miniSnapshot();
  ctx.fillStyle = '#0d1017'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#f5b942'; ctx.font = 'bold 12px "Microsoft JhengHei"';
  ctx.fillText(s.stage, 8, 18);
  ctx.fillText(s.lv, c.width - 44, 18);
  function bar(y, pct, color, text) {
    ctx.fillStyle = '#0a0d14'; ctx.fillRect(8, y, c.width - 16, 14);
    ctx.fillStyle = color; ctx.fillRect(8, y, (c.width - 16) * pct / 100, 14);
    ctx.fillStyle = '#fff'; ctx.font = '9px "Microsoft JhengHei"';
    ctx.textAlign = 'center'; ctx.fillText(text, c.width / 2, y + 10); ctx.textAlign = 'left';
  }
  ctx.fillStyle = '#d7deed'; ctx.font = '11px "Microsoft JhengHei"';
  ctx.fillText('🧝 冒險者', 8, 36);
  bar(41, s.pHp, '#4ade80', s.pHpText);
  bar(58, s.pMp, '#38bdf8', s.pMpText);
  ctx.fillStyle = '#d7deed'; ctx.fillText(s.eName.slice(0, 18), 8, 92);
  bar(97, s.eHp, '#f87171', s.eHpText);
  ctx.fillStyle = '#38bdf8'; ctx.font = '10px "Microsoft JhengHei"';
  ctx.fillText(s.info, 8, 130);
  ctx.fillStyle = '#7d89a6'; ctx.font = '9.5px "Microsoft JhengHei"';
  for (var i = 0; i < s.logs.length; i++) ctx.fillText(s.logs[i].slice(0, 26), 8, 146 + i * 13);
}

function openVideoPip() {
  try {
    if (!MINI.canvas) {
      MINI.canvas = document.createElement('canvas');
      MINI.canvas.width = 238; MINI.canvas.height = 175;
      MINI.video = document.createElement('video');
      MINI.video.muted = true;
      MINI.video.playsInline = true;
      MINI.video.srcObject = MINI.canvas.captureStream(4);
      MINI.video.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;';
      document.body.appendChild(MINI.video);
      MINI.video.addEventListener('leavepictureinpicture', function () {
        if (MINI.timer) { clearInterval(MINI.timer); MINI.timer = null; }
      });
    }
    drawMiniCanvas();
    MINI.video.play().then(function () {
      return MINI.video.requestPictureInPicture();
    }).then(function () {
      if (MINI.timer) clearInterval(MINI.timer);
      MINI.timer = setInterval(drawMiniCanvas, 500);
      blog('📺 迷你監控視窗已開啟（影片模式）', 'good');
    }).catch(function (e) {
      blog('⚠️ 無法開啟迷你視窗：' + (e && e.message ? e.message : '瀏覽器不支援'), 'warn');
    });
  } catch (e2) {
    blog('⚠️ 此瀏覽器不支援子母畫面功能', 'warn');
  }
}

/* ---- 事件綁定 ---- */
function showConfirmDialog(message, onConfirm, options) {
  var modal = $id('confirm-modal');
  var msg = $id('confirm-message');
  var ok = $id('confirm-ok');
  var cancel = $id('confirm-cancel');
  var title = $id('confirm-title');
  options = options || {};

  if (!modal || !msg || !ok || !cancel) {
    blog('⚠️ 確認彈窗初始化失敗，操作已取消。', 'warn');
    return;
  }

  if (title) title.textContent = options.title || '操作確認';
  modal.className = 'modal-overlay confirm-modal' + (options.dialogClass ? ' ' + options.dialogClass : '');
  msg.textContent = message || '';
  if (options.title === '轉生成功' && uiReincarnationCount() === 1) {
    var talentUnlockNotice = document.createElement('div');
    talentUnlockNotice.className = 'confirm-highlight';
    talentUnlockNotice.textContent = '已解鎖天賦系統！';
    msg.appendChild(talentUnlockNotice);
  }
  ok.textContent = options.okText || '確定';
  cancel.textContent = options.cancelText || '取消';
  ok.className = 'btn' + (options.danger ? ' danger' : '');
  cancel.className = 'btn';

  // 可選文字輸入框（options.input）：改名等需要輸入的操作用；未指定則維持純是/否確認
  var input = $id('confirm-input');
  var useInput = !!(options.input && input);
  if (input) {
    if (useInput) {
      input.style.display = '';
      input.value = (options.input.value != null) ? String(options.input.value) : '';
      input.placeholder = options.input.placeholder || '';
      if (options.input.maxLength) input.maxLength = options.input.maxLength; else input.removeAttribute('maxlength');
    } else {
      input.style.display = 'none';
      input.value = '';
      input.onkeydown = null;
    }
  }
  modal.style.display = 'flex';
  if (useInput) setTimeout(function () { try { input.focus(); input.select(); } catch (e) { } }, 0);

  function close() {
    modal.style.display = 'none';
    ok.onclick = null;
    cancel.onclick = null;
    modal.onclick = null;
    if (input) input.onkeydown = null;
  }
  function doConfirm() {
    var val = useInput && input ? input.value : undefined;
    close();
    if (typeof onConfirm === 'function') onConfirm(val);
  }

  ok.onclick = doConfirm;
  cancel.onclick = close;
  modal.onclick = function (e) {
    if (e.target === modal) close();
  };
  if (useInput && input) {
    input.onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doConfirm(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
  }
}

function stageHoldNow() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function stageHoldStepCount(now, startedAt) {
  var elapsed = Math.max(0, now - startedAt - STAGE_HOLD_START_MS);
  return 1 + Math.floor(elapsed / STAGE_HOLD_REPEAT_MS);
}

function updateStageHoldPreview(now) {
  var header = uiHeaderPanelSnapshot() || {};
  var stage = header.stage;
  if (!UI.stageHold.active || !stage) return;
  var steps = stageHoldStepCount(now, UI.stageHold.startedAt);
  var targetStage = UI.stageHold.startStage + UI.stageHold.delta * steps;
  targetStage = Math.max(1, Math.min(stage.best || targetStage, targetStage));
  if (targetStage === UI.stageHold.targetStage) return;
  UI.stageHold.targetStage = targetStage;
  refreshStageDisplay(targetStage);
}


function tickStageHold() {
  if (!UI.stageHold.active) return;
  var now = stageHoldNow();
  updateStageHoldPreview(now);
  var stage = (uiHeaderPanelSnapshot() || {}).stage || {};
  var atBoundary = UI.stageHold.targetStage === 1 || UI.stageHold.targetStage === stage.best;
  if (atBoundary) {
    UI.stageHold.repeatTimer = null;
    return;
  }
  var steps = stageHoldStepCount(now, UI.stageHold.startedAt);
  var nextAt = UI.stageHold.startedAt + STAGE_HOLD_START_MS + steps * STAGE_HOLD_REPEAT_MS;
  var delay = Math.max(0, nextAt - stageHoldNow());
  UI.stageHold.repeatTimer = setTimeout(tickStageHold, delay);
}


function finishStageHold(btn) {
  clearTimeout(UI.stageHold.startTimer);
  clearTimeout(UI.stageHold.repeatTimer);
  UI.stageHold.startTimer = null;
  UI.stageHold.repeatTimer = null;
  var wasActive = UI.stageHold.active;
  var targetStage = UI.stageHold.targetStage;
  var pointerId = UI.stageHold.pointerId;
  UI.stageHold.active = false;
  UI.stageHold.startedAt = 0;
  UI.stageHold.startStage = 0;
  UI.stageHold.targetStage = null;
  UI.stageHold.delta = 0;
  UI.stageHold.pointerId = null;
  var currentStage = ((uiHeaderPanelSnapshot() || {}).stage || {}).current || 1;
  if (wasActive && typeof targetStage === 'number' && targetStage !== currentStage) {
    sendUiCommand('stage.go', { delta: targetStage - currentStage }, {
      keys: [nodePendingKey('stage')],
      panels: ['battle', 'header']
    }).catch(function (error) {
      setStagePendingStage(null);
      reportUiCommandFailure('階段切換失敗', error, ['battle', 'header']);
    });
    // 放手後畫面停在玩家選定的關卡，直到新的 header 面板回來（見 setStagePendingStage）
    setStagePendingStage(targetStage);
  } else if (wasActive) {
    refreshStageDisplay();
  }
  if (btn && pointerId !== null && btn.hasPointerCapture && btn.hasPointerCapture(pointerId)) {
    btn.releasePointerCapture(pointerId);
  }
  if (UI.stageHold.suppressClick) {
    clearTimeout(UI.stageHold.suppressTimer);
    UI.stageHold.suppressTimer = setTimeout(function () {
      UI.stageHold.suppressClick = false;
      UI.stageHold.suppressTimer = null;
    }, 120);
  }
}


function stepStageButton(delta) {
  // 上一次切換還沒回來就先忽略：連點會被 acquireUiPending 擋下而拋錯，擋在這裡比較安靜
  if (isUiCommandPending(nodePendingKey('stage'))) return;
  var stg = (uiHeaderPanelSnapshot() || {}).stage || {};
  var from = (_stagePendingStage !== null) ? _stagePendingStage : (stg.current || 1);
  sendUiCommand('stage.go', { delta: delta }, {
    keys: [nodePendingKey('stage')], panels: ['battle', 'header']
  }).catch(function (error) {
    setStagePendingStage(null);
    reportUiCommandFailure('切換關卡', error, ['battle', 'header']);
  });
  // 樂觀顯示（夾在 1~最高關，與模擬層 stageGo 的判定一致）
  setStagePendingStage(Math.max(1, Math.min(stg.best || from, from + delta)));
}

function bindStageHoldButton(id, delta) {
  var btn = $id(id);
  if (!btn) return;
  btn.addEventListener('click', function (e) {
    if (UI.stageHold.suppressClick) {
      e.preventDefault();
      return;
    }
    stepStageButton(delta);
  });
  btn.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    finishStageHold(btn);
    clearTimeout(UI.stageHold.suppressTimer);
    UI.stageHold.suppressTimer = null;
    UI.stageHold.suppressClick = false;
    UI.stageHold.pointerId = e.pointerId;
    UI.stageHold.startedAt = stageHoldNow();
    var currentStage = ((uiHeaderPanelSnapshot() || {}).stage || {}).current || 1;
    UI.stageHold.startStage = currentStage;
    UI.stageHold.targetStage = currentStage;
    UI.stageHold.delta = delta;
    if (btn.setPointerCapture) btn.setPointerCapture(e.pointerId);
    UI.stageHold.startTimer = setTimeout(function () {
      UI.stageHold.startTimer = null;
      UI.stageHold.active = true;
      UI.stageHold.suppressClick = true;
      tickStageHold();
    }, STAGE_HOLD_START_MS);
  });
  btn.addEventListener('pointerup', function () { finishStageHold(btn); });
  btn.addEventListener('pointercancel', function () { finishStageHold(btn); });
  btn.addEventListener('lostpointercapture', function () { finishStageHold(btn); });
}


function initUI() {
  bindWorkerUiState();
  updateTalentTabVisibility();
  if (!UI.performanceEventsBound) {
    window.addEventListener('resize', function () {
      UI.battleLayoutDirty = true;
      UI.dirty.battle = true;
      UI.dirty.inv = true;
      invalidateInventoryGridColumns();
      if (typeof vfxInvalidateLayout === 'function') vfxInvalidateLayout();
    });
    // 介面縮放（js/ui-scale.js）會改變格線容器寬度，欄數快取一樣得作廢
    document.addEventListener('fullscreenchange', invalidateInventoryGridColumns);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('pointerdown', noteUiInteraction, true);
    document.addEventListener('keydown', noteUiInteraction, true);
    UI.performanceEventsBound = true;
  }
  syncVfxQualityForTab();

  // 本地測試服承傷顯示初始化：顯示在全螢幕按鈕右側
  var host = window.location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLocal) {
    var fsBtn = $id('btn-fullscreen');
    if (fsBtn && !$id('r-phys-absorb')) {
      var wrap = document.createElement('span');
      wrap.id = 'test-only-dmg-wrap';
      wrap.style.marginLeft = '14px';
      wrap.style.display = 'inline-flex';
      wrap.style.gap = '10px';
      wrap.style.verticalAlign = 'middle';
      wrap.style.fontSize = '13px';
      wrap.style.fontWeight = 'bold';
      wrap.style.color = '#4ade80';
      wrap.innerHTML =
        '<span id="r-phys-dmg-span" style="cursor: pointer;">⚔️ 物傷: <b id="r-phys-dmg" style="color: #4ade80;">0</b></span>' +
        '<span id="r-magic-dmg-span" style="cursor: pointer;">🔮 魔傷: <b id="r-magic-dmg" style="color: #4ade80;">0</b></span>' +
        '<span id="r-phys-span" style="cursor: pointer;">🛡️ 物承: <b id="r-phys-absorb" style="color: #4ade80;">0</b></span>' +
        '<span id="r-magic-span" style="cursor: pointer;">🔮 魔承: <b id="r-magic-absorb" style="color: #4ade80;">0</b></span>';
      fsBtn.parentNode.insertBefore(wrap, fsBtn.nextSibling);
    }
  }
  // 分頁
  document.querySelectorAll('.tab-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      switchTab(b.getAttribute('data-tab'));
      UI.dirty.equip = true; UI.dirty.inv = true; UI.dirty.factory = true; UI.dirty.newforge = true; UI.dirty.forge = true; UI.dirty.tower = true; UI.dirty.gems = true; UI.dirty.skills = true; UI.dirty.talents = true;
    });
  });

  // 熔爐分頁事件（委派一次）＋改版公告頁籤閃爍狀態
  bindNewForgeEvents();
  updateForgeTabGlow();

  // 熔爐改版公告彈窗：確認後不再顯示（頁籤閃爍持續到玩家切到熔爐分頁）
  var forgeRebuildOk = $id('forge-rebuild-ok');
  if (forgeRebuildOk) {
    forgeRebuildOk.addEventListener('click', function () {
      var modal = $id('forge-rebuild-modal');
      if (modal) modal.style.display = 'none';
      sendUiCommand('newforge.markNoticeShown', {}, {
        keys: [nodePendingKey('newforge-notice')],
        panels: ['newforge']
      }).catch(function (error) {
        reportUiCommandFailure('熔爐公告已讀', error, ['newforge']);
      });
    });
  }

  // 轉生按鈕：先顯示效果確認，只有按下確認後才執行。
  var reincBtn = $id('btn-reincarnate');
  if (reincBtn) {
    reincBtn.addEventListener('click', function () {
      var header = uiHeaderPanelSnapshot() || {};
      var count = Math.max(0, Math.floor(Number(header.player && header.player.reincarnations) || 0));
      var level = header.player && header.player.level || 0;
      if (level < REINCARNATION_LEVEL || count >= REINCARNATION_MAX) {
        blog('⚠️ ' + (count >= REINCARNATION_MAX
          ? (count >= 10 ? '已達最高 神階 10/10' : '已達最高 ' + REINCARNATION_MAX + ' 轉')
          : '等級達到 ' + REINCARNATION_LEVEL + ' 級後才能' + (count >= 10 ? '晉階' : '轉生')), 'warn');
        return;
      }
      var nextCount = count + 1;
      var isGodAction = count >= 10;
      var actTitle = isGodAction ? '晉階' : '轉生';

      var curSkillMax = (typeof REINCARNATION_SKILL_MAX_LEVELS !== 'undefined' && REINCARNATION_SKILL_MAX_LEVELS[count] !== undefined)
        ? REINCARNATION_SKILL_MAX_LEVELS[count] : (20 + Math.min(10, count) * 10);
      var nextSkillMax = (typeof REINCARNATION_SKILL_MAX_LEVELS !== 'undefined' && REINCARNATION_SKILL_MAX_LEVELS[nextCount] !== undefined)
        ? REINCARNATION_SKILL_MAX_LEVELS[nextCount] : (20 + Math.min(10, nextCount) * 10);
      var skillAdd = Math.max(0, nextSkillMax - curSkillMax);

      var curFusionAdd = (typeof REINCARNATION_FUSION_MAX_LEVELS !== 'undefined' && REINCARNATION_FUSION_MAX_LEVELS[count] !== undefined)
        ? REINCARNATION_FUSION_MAX_LEVELS[count] : (count * 20);
      var nextFusionAdd = (typeof REINCARNATION_FUSION_MAX_LEVELS !== 'undefined' && REINCARNATION_FUSION_MAX_LEVELS[nextCount] !== undefined)
        ? REINCARNATION_FUSION_MAX_LEVELS[nextCount] : (nextCount * 20);
      var fusionAdd = Math.max(0, nextFusionAdd - curFusionAdd);

      var skillMsgParts = [];
      if (skillAdd > 0) skillMsgParts.push('一般技能上限 +' + skillAdd + ' 級');
      if (fusionAdd > 0) skillMsgParts.push('融合技能上限 +' + fusionAdd + ' 級');
      var skillLimitLine = skillMsgParts.length > 0 ? ('・' + skillMsgParts.join('，') + '。\n') : '';

      showConfirmDialog(
        actTitle + '效果：\n' +
        '・人物等級回到 1 級，經驗歸零。\n' +
        '・生命、法力及力量、敏捷、耐力、智力變為 ×' + reincarnationTotalMultiplier(nextCount) + '。\n' +
        '・不再獲得技能點，改獲得轉生天賦點。\n' +
        skillLimitLine +
        '・裝備、技能、資源與關卡進度保留。\n\n確定要進行' + actTitle + '嗎？',
        function () {
          sendUiCommand('player.reincarnate', {}, {
            keys: [nodePendingKey('reincarnate')],
            panels: ['header', 'equip', 'inv', 'skills', 'talents']
          }).then(function (result) {
            var error = uiCommandResultError(result);
            if (error) reportUiCommandFailure('轉生', error, ['header', 'equip', 'inv', 'skills', 'talents']);
          }).catch(function (error) {
            reportUiCommandFailure('轉生', error, ['header', 'equip', 'inv', 'skills', 'talents']);
          });
          return;
        },
        { title: actTitle + '確認', okText: '確定' + actTitle, dialogClass: 'reincarnation-confirm' }
      );
    });
  }

  // 技能：學習/升級/裝載/融合（事件委派）
  document.addEventListener('click', function (e) {
    var talentSelect = e.target.closest('[data-talent-select]');
    if (talentSelect) {
      var talentParts = talentSelect.getAttribute('data-talent-select').split(':');
      openTalentModal(talentParts[0], talentParts.slice(1).join(':'));
      return;
    }
    var talentModalClose = e.target.closest('[data-talent-modal-close]');
    if (talentModalClose) { closeTalentModal(); return; }
    var talentUp = e.target.closest('[data-talent-up]');
    if (talentUp) {
      runTalentUiAction('talent.upgrade', talentUp.getAttribute('data-talent-up'), talentUpgrade);
      return;
    }
    var talentMaxBtn = e.target.closest('[data-talent-max]');
    if (talentMaxBtn) {
      runTalentUiAction('talent.max', talentMaxBtn.getAttribute('data-talent-max'), talentMax);
      return;
    }
    var talentDown = e.target.closest('[data-talent-down]');
    if (talentDown) {
      runTalentUiAction('talent.downgrade', talentDown.getAttribute('data-talent-down'), talentDowngrade);
      return;
    }
    var talentDeleteBtn = e.target.closest('[data-talent-delete]');
    if (talentDeleteBtn) {
      runTalentUiAction('talent.delete', talentDeleteBtn.getAttribute('data-talent-delete'), talentDelete);
      return;
    }
    // 裝備三套切頁：改名按鈕須在切頁判斷之前處理（避免同時觸發切換檢視）
    var eqRename = e.target.closest('[data-eqset-rename]');
    if (eqRename) {
      if (typeof renameEquipSet === 'function') renameEquipSet(parseInt(eqRename.getAttribute('data-eqset-rename'), 10));
      return;
    }
    // 裝備三套切頁：點切頁只切換「檢視」，點「確定切換」才換穿
    var eqTab = e.target.closest('[data-eqset]');
    if (eqTab) {
      var equipViewIndex = parseInt(eqTab.getAttribute('data-eqset'), 10);
      sendUiCommand('player.setEquipView', { index: equipViewIndex }, {
        keys: [nodePendingKey('equip-view')],
        panels: ['equip', 'inv']
      }).catch(function (error) {
        reportUiCommandFailure('切換裝備預覽', error, ['equip', 'inv']);
      });
      return;
    }
    var eqConfirm = e.target.closest('#eqset-confirm');
    if (eqConfirm) {
      if (!eqConfirm.disabled) {
        var equipConfirmSnapshot = uiEquipPanelSnapshot();
        var equipConfirmIndex = equipConfirmSnapshot && typeof equipConfirmSnapshot.equipView === 'number'
          ? equipConfirmSnapshot.equipView
          : 0;
        sendUiCommand('player.switchEquipSet', { index: equipConfirmIndex }, {
          keys: [nodePendingKey('equip-set')],
          panels: ['equip', 'inv', 'header']
        }).catch(function (error) {
          reportUiCommandFailure('換穿裝備套', error, ['equip', 'inv', 'header']);
        });
      }
      return;
    }
    var mx = e.target.closest('[data-skill-max]');
    if (mx) {
      var maxRef = mx.getAttribute('data-skill-max');
      var maxPotentialId = potentialSkillId(maxRef);
      if (maxPotentialId !== null) {
        runSkillUiAction(
          'talent.potentialMax', maxPotentialId, maxRef, potentialMax,
          ['skills', 'talents', 'header']
        );
      } else {
        runSkillUiAction(
          'skill.maxUpgrade', maxRef, 'skill:' + maxRef, maxUpgradeSkill,
          ['skills', 'header']
        );
      }
      return;
    }
    var ln = e.target.closest('[data-skill-learn]');
    if (ln) {
      var learnRef = ln.getAttribute('data-skill-learn');
      var learnPotentialId = potentialSkillId(learnRef);
      if (learnPotentialId !== null) {
        runSkillUiAction(
          'talent.potentialUpgrade', learnPotentialId, learnRef, potentialUpgrade,
          ['skills', 'talents', 'header']
        );
      } else {
        runSkillUiAction(
          'skill.learn', learnRef, 'skill:' + learnRef, learnOrUpgradeSkill,
          ['skills', 'header']
        );
      }
      return;
    }
    var eq = e.target.closest('[data-skill-equip]');
    if (eq) {
      var equipRef = eq.getAttribute('data-skill-equip');
      runSkillUiAction(
        'skill.equipLoadout', equipRef,
        potentialSkillId(equipRef) !== null ? equipRef : 'skill:' + equipRef,
        equipSkillToLoadout, ['skills']
      );
      return;
    }
    var uq = e.target.closest('[data-skill-unequip]');
    if (uq) {
      var unequipRef = uq.getAttribute('data-skill-unequip');
      runSkillUiAction(
        'skill.unequipLoadout', unequipRef,
        potentialSkillId(unequipRef) !== null ? unequipRef : 'skill:' + unequipRef,
        unequipSkillFromLoadout, ['skills']
      );
      return;
    }
    // 點擊技能樹節點 → 開啟升級彈窗
    var cell = e.target.closest('[data-sk]');
    if (cell) {
      openSkillModal(cell.getAttribute('data-sk'));
      return;
    }
    // 敵人情報 Tooltip（手機點擊支援）
    var etip = e.target.closest('#btn-enemy-tip') || e.target.closest('#btn-boss-tip') || e.target.closest('#btn-tower-result-boss-tip');
    if (etip) {
      var tip = $id('sk-tooltip');
      if (tip && tip.style.display === 'block') hideTooltip();
      else showEnemyTooltip(etip);
      return;
    }
    var btip = e.target.closest('[data-buff-tip]');
    if (btip) {
      var btipEl = $id('sk-tooltip');
      if (btipEl && btipEl.style.display === 'block' && UI.tooltipAnchor === btip) hideTooltip();
      else showBuffTooltip(btip);
      return;
    }
    var ebtip = e.target.closest('[data-enemy-buff-tip]');
    if (ebtip) {
      var ebtipEl = $id('sk-tooltip');
      if (ebtipEl && ebtipEl.style.display === 'block' && UI.tooltipAnchor === ebtip) hideTooltip();
      else showEnemyBuffTooltip(ebtip);
      return;
    }
    // 降級
    var dg = e.target.closest('[data-skill-downgrade]');
    if (dg) {
      var downRef = dg.getAttribute('data-skill-downgrade');
      var downPotentialId = potentialSkillId(downRef);
      if (downPotentialId !== null) {
        runSkillUiAction(
          'talent.potentialDowngrade', downPotentialId, downRef, potentialDowngrade,
          ['skills', 'talents', 'header']
        );
      } else {
        runSkillUiAction(
          'skill.downgrade', downRef, 'skill:' + downRef, downgradeSkill,
          ['skills', 'header']
        );
      }
      return;
    }
    // 融合素材：加入 / 移出
    var fa = e.target.closest('[data-skill-fuse-add]');
    if (fa) {
      var fid = fa.getAttribute('data-skill-fuse-add');
      var faSnapshot = uiSkillsPanelSnapshot();
      if (UI.fuseSlots.indexOf(fid) >= 0) blog('⚠️ 此技能已在融合槽中', 'warn');
      else if (UI.fuseSlots.length >= 4) blog('⚠️ 融合槽已滿（最多 4 個）', 'warn');
      else if (faSnapshot && skillViewUsedInFusion(faSnapshot, fid)) blog('⚠️ 此技能已投入其他融合技', 'warn');
      else UI.fuseSlots.push(fid);
      renderSkills();
      return;
    }
    var fr = e.target.closest('[data-fuse-remove]');
    if (fr) {
      var rid = fr.getAttribute('data-fuse-remove');
      var ri2 = UI.fuseSlots.indexOf(rid);
      if (ri2 >= 0) UI.fuseSlots.splice(ri2, 1);
      renderSkills();
      return;
    }
    // 刪除/重置技能
    var fd = e.target.closest('[data-skill-delete]');
    if (fd) {
      var deleteRef = fd.getAttribute('data-skill-delete');
      var isPotential = deleteRef.indexOf('potential:') === 0;
      var actualId = isPotential ? deleteRef.slice('potential:'.length) : deleteRef;
      var skDefObj = isPotential
        ? potentialDef(actualId)
        : skillViewDef(uiSkillsPanelSnapshot(), actualId);
      if (skDefObj) {
        var isFusionSkill = !isPotential && skDefObj.cat === 'fusion';
        var confirmMsg = isFusionSkill
          ? '確定刪除此融合技？所有投入的技能點將全數歸還，全部素材技能將被釋放（可再次裝備或融合）。'
          : '確定重置技能「' + skDefObj.name + '」？等級將歸零，已投入的技能點將全額退還。';
        var confirmTitle = isFusionSkill ? '融合技刪除確認' : '技能重置確認';

        showConfirmDialog(confirmMsg, function () {
          if (isFusionSkill) {
            runSkillUiAction(
              'skill.deleteFusion', actualId, 'skill:' + actualId, deleteFusion,
              ['skills'], function () { UI.selSkill = null; }
            );
          } else if (isPotential) {
            runSkillUiAction(
              'talent.potentialDelete', actualId, deleteRef, potentialDelete,
              ['skills', 'talents', 'header'], function () { UI.selSkill = null; }
            );
          } else {
            runSkillUiAction(
              'skill.delete', actualId, 'skill:' + actualId, deleteSkill,
              ['skills'], function () { UI.selSkill = null; }
            );
          }
        }, { title: confirmTitle, danger: true });
      }
      return;
    }
  });

  // 屏蔽瀏覽器右鍵選單（輸入框除外，保留貼上存檔碼的能力）
  document.addEventListener('contextmenu', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
  });

  // 屏蔽遊戲畫面文字反白；輸入框、文字區與可編輯元素保留正常選取功能。
  document.addEventListener('selectstart', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();
  });

  // 神鑄寶石自動放入清單：捲動只作用於清單，不冒泡到主畫面。
  var forgeAutoMenuWheel = $id('forge-auto-menu');
  if (forgeAutoMenuWheel) {
    forgeAutoMenuWheel.addEventListener('wheel', function (e) {
      var list = e.target.closest('.fam-list');
      if (!list) return;
      if (list.scrollHeight > list.clientHeight) {
        list.scrollTop += e.deltaY;
        e.preventDefault();
      }
      e.stopPropagation();
    }, { passive: false });
  }

  // 背包框外向下滾輪：物品超過目前可視排數時逐排展開，最多 9 排；框內仍由自身捲軸處理。
  document.addEventListener('wheel', function (e) {
    if (UI.tab !== 'equip' || e.deltaY <= 0) return;
    var target = e.target;
    if (target && target.closest && target.closest('#inv-section-box')) return;
    var box = $id('inventory-grid');
    if (!box) return;
    if (!box.hasAttribute('data-inventory-total-rows')) return;
    var totalRows = inventoryGridTotalRowCount(box);
    var currentRows = inventoryVisibleRows(totalRows, UI.inventoryVisibleRows);
    if (totalRows <= currentRows || currentRows >= INVENTORY_VISIBLE_ROWS_MAX) return;
    UI.inventoryVisibleRows = Math.min(INVENTORY_VISIBLE_ROWS_MAX, currentRows + 1, totalRows);
    renderInventory();
  }, { passive: true });

  var inventoryGrid = $id('inventory-grid');
  if (inventoryGrid && !inventoryGrid.__virtualScrollBound) {
    inventoryGrid.__virtualScrollBound = true;
    inventoryGrid.addEventListener('scroll', function () {
      if (UI.tab !== 'equip') return;
      if (!inventoryGrid.hasAttribute('data-inventory-total-rows')) return;
      UI.inventoryScrolling = true;
      if (UI.inventoryScrollTimer) clearTimeout(UI.inventoryScrollTimer);
      UI.inventoryScrollTimer = setTimeout(function () {
        UI.inventoryScrollTimer = null;
        UI.inventoryScrolling = false;
        if (UI.inventoryDetailRefreshPending) {
          UI.inventoryDetailRefreshPending = false;
          renderDetail();
        }
      }, 120);
      UI.pendingItemTooltip = null;
      UI.hoveredItemTooltip = null;
      hideTooltip();
      if (inventoryGrid.__virtualScrollFrame) return;
      var schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (fn) { return setTimeout(fn, 0); };
      inventoryGrid.__virtualScrollFrame = schedule(function () {
        inventoryGrid.__virtualScrollFrame = 0;
        renderInventory();
      });
    }, { passive: true });
  }

  // 技能彈窗：右上 X / 點擊遮罩關閉
  var skModal = $id('skill-modal');
  if (skModal) {
    skModal.addEventListener('click', function (e) {
      if (e.target === skModal) closeSkillModal();
    });
    $id('skill-modal-close').addEventListener('click', closeSkillModal);
  }

  // 天賦彈窗：右上 X / 點擊遮罩關閉
  var talentModal = $id('talent-modal');
  if (talentModal) {
    talentModal.addEventListener('click', function (e) {
      if (e.target === talentModal) closeTalentModal();
    });
    $id('talent-modal-close').addEventListener('click', closeTalentModal);
  }

  // 離線收益彈窗：確認 / 右上 X / 點擊遮罩關閉
  var offlineModal = $id('offline-modal');
  if (offlineModal) {
    offlineModal.addEventListener('click', function (e) {
      if (e.target === offlineModal) closeOfflineSummary();
    });
    $id('offline-modal-close').addEventListener('click', closeOfflineSummary);
    $id('offline-modal-confirm').addEventListener('click', closeOfflineSummary);
  }

  // 技能拖曳排序
  var loBox = $id('skill-loadout');
  if (loBox) {
    loBox.addEventListener('dragstart', function (e) {
      var slot = e.target.closest('.loadout-slot.filled');
      if (!slot) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', slot.getAttribute('data-index'));
      e.dataTransfer.effectAllowed = 'move';
      slot.classList.add('dragging');
    });
    loBox.addEventListener('dragover', function (e) {
      e.preventDefault();
      var target = e.target.closest('.loadout-slot');
      if (target) target.classList.add('drag-over');
    });
    loBox.addEventListener('dragleave', function (e) {
      var target = e.target.closest('.loadout-slot');
      if (target) target.classList.remove('drag-over');
    });
    loBox.addEventListener('drop', function (e) {
      e.preventDefault();
      var target = e.target.closest('.loadout-slot');
      if (target) {
        target.classList.remove('drag-over');
        var fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        var toIndex = parseInt(target.getAttribute('data-index'), 10);
        if (!isNaN(fromIndex) && !isNaN(toIndex) && fromIndex !== toIndex) {
          {
            var pendingKey = nodePendingKey('skill-loadout');
            if (isUiCommandPending(pendingKey)) return;
            var skillsSnapshot = uiSkillsPanelSnapshot();
            var currentLoadout = skillViewLoadout(skillsSnapshot).slice();
            if (fromIndex < 0 || fromIndex >= currentLoadout.length) return;
            var moved = currentLoadout.splice(fromIndex, 1)[0];
            if (toIndex >= currentLoadout.length) currentLoadout.push(moved);
            else currentLoadout.splice(toIndex, 0, moved);

            UI.optimisticSkillLoadout = {
              values: currentLoadout,
              acknowledged: false
            };
            renderSkills();
            sendUiCommand('skill.reorderLoadout', {
              from: fromIndex,
              to: toIndex
            }, {
              keys: pendingKey,
              panels: []
            }).then(function (result) {
              var error = uiCommandResultError(result);
              if (error) {
                UI.optimisticSkillLoadout = null;
                reportUiCommandFailure('技能排序失敗', error, ['skills']);
                renderSkills();
                return;
              }
              if (UI.optimisticSkillLoadout) {
                UI.optimisticSkillLoadout.acknowledged = true;
              }
              requestPanelData('skills', true);
            }, function (error) {
              UI.optimisticSkillLoadout = null;
              reportUiCommandFailure('技能排序失敗', error, ['skills']);
              renderSkills();
            });
          }
        }
      }
    });
    loBox.addEventListener('dragend', function (e) {
      var slot = e.target.closest('.loadout-slot.filled');
      if (slot) slot.classList.remove('dragging');
      loBox.querySelectorAll('.drag-over').forEach(function (el) { el.classList.remove('drag-over'); });
    });
  }

  // 懸停提示（事件委派）
  document.addEventListener('mouseover', function (e) {
    var tipBtn = e.target.closest('[data-tip]');
    if (tipBtn) { showStatTooltip('', tipBtn.getAttribute('data-tip'), tipBtn); return; }
    var buffTipHover = e.target.closest('[data-buff-tip]');
    if (buffTipHover) { showBuffTooltip(buffTipHover); return; }
    var enemyBuffTipHover = e.target.closest('[data-enemy-buff-tip]');
    if (enemyBuffTipHover) { showEnemyBuffTooltip(enemyBuffTipHover); return; }
    var talentTipHover = e.target.closest('[data-talent-tip]');
    if (talentTipHover) { showTalentTooltip(talentTipHover.getAttribute('data-talent-tip'), talentTipHover); return; }

    // 神鑄法陣裝備槽：顯示完整裝備詳情（寶石槽走上方 data-tip 分支）
    var fSlotEl = e.target.closest('.forge-slot.filled[data-forge-slot]');
    if (fSlotEl) {
      var forgeTooltipSnapshot = uiForgePanelSnapshot();
      var forgeTooltipState = forgeViewState(forgeTooltipSnapshot);
      var fSlotIt = forgeViewSlots(forgeTooltipState)[parseInt(fSlotEl.getAttribute('data-forge-slot'), 10)];
      if (fSlotIt && fSlotIt.kind !== 'gem') {
        showItemTooltip(fSlotIt, fSlotEl, { hint: '點擊取回背包' });
        return;
      }
    }

    var eqCell = e.target.closest('.item-cell[data-id]') || e.target.closest('.eq-slot.filled[data-id]');
    if (eqCell) {
      if (UI.inventoryScrolling && eqCell.classList.contains('item-cell')) return;
      // mouseover bubbles through the cell's icon/labels; do not restart the
      // tooltip while moving between descendants of the same cell.
      if (e.relatedTarget && eqCell.contains && eqCell.contains(e.relatedTarget)) return;
      var tooltipId = eqCell.getAttribute('data-id');
      var needsInventoryDetail = eqCell.getAttribute('data-src') === 'inv';
      UI.hoveredItemTooltip = { id: tooltipId, anchor: eqCell };
      var it = findItemById(tooltipId, needsInventoryDetail);
      if (it) { showItemTooltip(it, eqCell); return; }
      if (needsInventoryDetail) {
        // Do not leave the previous item's card visible while the requested
        // inventory detail is being fetched for this anchor.
        hideTooltip();
        UI.pendingItemTooltip = { id: tooltipId, anchor: eqCell };
        requestPanelData('inv', true, { detailIds: [tooltipId] });
        return;
      }
    }

    var genericTip = e.target.closest('[data-tt-title]');
    if (genericTip) {
      showStatTooltip(genericTip.getAttribute('data-tt-title'), genericTip.getAttribute('data-tt-desc') || '', genericTip);
      return;
    }

    if (e.target.closest('button') || e.target.closest('.btn')) {
      hideTooltip();
      return;
    }
    var cell = e.target.closest('[data-sk]');
    if (cell) { showSkillTooltip(cell.getAttribute('data-sk'), cell); return; }
    var statRow = e.target.closest('.stat-row[data-tt-title]');
    if (statRow) { showStatTooltip(statRow.getAttribute('data-tt-title'), statRow.getAttribute('data-tt-desc'), statRow); return; }
    var tf = e.target.closest('[data-tower-tip]');
    if (tf) { showTowerTooltip(tf.getAttribute('data-tower-tip'), tf); return; }
    var etip = e.target.closest('#btn-enemy-tip') || e.target.closest('#btn-boss-tip') || e.target.closest('#btn-tower-result-boss-tip');
    if (etip) { showEnemyTooltip(etip); return; }
  });
  document.addEventListener('mouseout', function (e) {
    var outCell = e.target.closest('.item-cell[data-id]') || e.target.closest('.eq-slot.filled[data-id]');
    if (outCell) {
      if (UI.inventoryScrolling && outCell.classList.contains('item-cell')) return;
      // Leaving a child element (icon, level, badge) is not leaving the item
      // cell; keep its tooltip alive until the whole cell is exited.
      if (e.relatedTarget && outCell.contains && outCell.contains(e.relatedTarget)) return;
      if (UI.hoveredItemTooltip && UI.hoveredItemTooltip.anchor === outCell) {
        UI.hoveredItemTooltip = null;
      }
    }
    if (e.target.closest('[data-sk]') || e.target.closest('.stat-row[data-tt-title]') ||
      e.target.closest('[data-tt-title]') ||
      e.target.closest('[data-talent-tip]') ||
      e.target.closest('[data-tower-tip]') || e.target.closest('#btn-enemy-tip') ||
      e.target.closest('#btn-boss-tip') || e.target.closest('#btn-tower-result-boss-tip') ||
      e.target.closest('[data-tip]') || e.target.closest('[data-buff-tip]') ||
      e.target.closest('[data-enemy-buff-tip]') || e.target.closest('.item-cell[data-id]') ||
      e.target.closest('.eq-slot.filled[data-id]') ||
      e.target.closest('.forge-slot.filled[data-forge-slot]')) {
      hideTooltip();
    }
  });

  // 執行融合 / 清空
  var fuseBtn2 = $id('btn-fuse');
  if (fuseBtn2) {
    fuseBtn2.addEventListener('click', function () {
      var fusionIds = UI.fuseSlots.slice();
      var fusionKeys = fusionIds.map(function (id) {
        return nodePendingKey('skill:' + id);
      });
      sendUiCommand('skill.fuse', { ids: fusionIds }, {
        keys: fusionKeys,
        panels: ['skills']
      }).then(function (result) {
        var error = uiCommandResultError(result);
        if (error) reportUiCommandFailure('技能融合失敗', error, ['skills']);
        else UI.fuseSlots = [];
      }, function (error) {
        reportUiCommandFailure('技能融合失敗', error, ['skills']);
      });
    });
    $id('btn-fuse-clear').addEventListener('click', function () {
      UI.fuseSlots = [];
      renderFusionPanel();
    });
  }

  // 寶石合成（3 顆同種同級 → 同種下一階）
  var fuseBtn = $id('fuse-btn');
  if (fuseBtn) {
    fuseBtn.addEventListener('click', function () {
      var t = $id('fuse-type').value;
      var lv = parseInt($id('fuse-level').value, 10) || 1;

      sendGemUiCommand(
        'gem.compose',
        { type: t, level: lv },
        'gem-compose:' + t + ':' + lv,
        ['gems'],
        function () {
          blog('💎 寶石合成：' + (t === GEM_TYPE_ALL ? '全部類型寶石' : gemLabel(t, lv)) + ' ×' + GEM_COMPOSE_INPUT_COUNT + ' → ' +
            (t === GEM_TYPE_ALL ? GEM_NAMES[lv + 1] + '同類型寶石' : gemLabel(t, lv + 1)), 'info', 'factory');
        }
      );
      return;
    });
    $id('fuse-all-btn').addEventListener('click', function () {
      var t = $id('fuse-type').value;
      var lv = parseInt($id('fuse-level').value, 10) || 1;

      sendGemUiCommand(
        'gem.composeAll',
        { type: t, level: lv },
        'gem-compose:' + t + ':' + lv,
        ['gems', 'header']
      );
      return;
    });
    $id('fuse-level').addEventListener('change', renderFuseInfo);
    $id('fuse-type').addEventListener('change', renderFuseInfo);
  }

  // 寶石轉換（九宮格）
  var btnGemSort = $id('btn-gem-sort');
  if (btnGemSort) {
    btnGemSort.addEventListener('click', function () {
      UI.gemSortType = (UI.gemSortType === 'level') ? 'type' : 'level';
      renderGemConvert();
    });
  }
  var gconvPool = $id('gconv-pool');
  if (gconvPool) {
    gconvPool.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-gconv-pick]');
      if (!chip) return;
      var pk = chip.getAttribute('data-gconv-pick').split(':');
      var t = pk[0], lv = parseInt(pk[1], 10);
      if (!UI.convertSlots) UI.convertSlots = [];
      var gemsSnapshot = uiGemsPanelSnapshot();
      var adjusted = adjustGemConvertPool(
        UI.convertSlots,
        t,
        lv,
        gemsViewCount(gemsSnapshot, t, lv),
        e.shiftKey,
        GEM_CONVERT_STACK,
        GEM_CONVERT_SLOTS
      );
      if (!adjusted.ok) {
        if (adjusted.reason === 'slots') {
          blog('⚠️ 九宮格已滿（最多 ' + GEM_CONVERT_SLOTS + ' 種）', 'warn');
        } else {
          blog('⚠️ 該格已達上限（' + GEM_CONVERT_STACK + ' 顆）或庫存已放完', 'warn');
        }
        return;
      }
      UI.convertSlots = adjusted.slots;
      renderGemConvert(gemsSnapshot);
    });
    $id('gconv-grid').addEventListener('click', function (e) {
      var el = e.target.closest('[data-gconv-slot]');
      if (!el) return;
      var removed = removeGemConvertSlot(
        UI.convertSlots,
        parseInt(el.getAttribute('data-gconv-slot'), 10),
        e.shiftKey
      );
      if (!removed.ok) return;
      UI.convertSlots = removed.slots;
      renderGemConvert();
    });
    $id('gconv-btn').addEventListener('click', function () {
      var target = $id('gconv-target').value;
      var slots = (UI.convertSlots || []).slice();
      var resBox = $id('gconv-result');

      sendGemUiCommand(
        'gem.convert',
        { slots: slots, targetType: target },
        'gem-convert',
        ['gems'],
        function () {
          if (resBox) resBox.innerHTML = '<span class="gr-line">✅ 轉換成功</span>';
          blog('🔄 寶石轉換成功', 'good', 'factory');
          UI.convertSlots = [];
          renderGemConvert();
        }
      );
      return;
    });
    $id('gconv-clear').addEventListener('click', function () { UI.convertSlots = []; renderGemConvert(); });
    $id('gconv-target').addEventListener('change', renderGemConvert);
  }

  // 寶石拆解
  var gdisBtn = $id('gdis-btn');
  if (gdisBtn) {
    gdisBtn.addEventListener('click', function () {
      var t = $id('gdis-type').value;
      var lv = parseInt($id('gdis-level').value, 10) || 2;

      sendGemUiCommand(
        'gem.dismantle',
        { type: t, level: lv },
        'gem-dismantle:' + t + ':' + lv,
        ['gems', 'header'],
        function (result) {
          gdisShow('♻️ 分解 ' + gemLabel(t, lv) + ' → 返還 ' + gemLabel(t, 1) + ' ×' + result.n);
          blog('♻️ 分解 ' + gemLabel(t, lv) + ' → ' + gemLabel(t, 1) + ' ×' + result.n, 'info', 'factory');
        }
      );
      return;
    });
    $id('gdis-all-btn').addEventListener('click', function () {
      var t = $id('gdis-type').value;
      var lv = parseInt($id('gdis-level').value, 10) || 2;

      sendGemUiCommand(
        'gem.dismantleAll',
        { type: t, level: lv },
        'gem-dismantle:' + t + ':' + lv,
        ['gems', 'header'],
        function (result) {
          gdisShow('♻️ 全部分解 ' + gemLabel(t, lv) + ' ×' + result.count + ' → 返還 ' + gemLabel(t, 1) + ' ×' + result.gain);
        }
      );
      return;
    });
    $id('gdis-type').addEventListener('change', renderGemDismantle);
    $id('gdis-level').addEventListener('change', renderGemDismantle);
    $id('gdis-fused').addEventListener('click', function (e) {
      var el = e.target.closest('[data-gdis-fused]');
      if (!el) return;
      var fid = el.getAttribute('data-gdis-fused');
      var fg = gemsViewFindFused(uiGemsPanelSnapshot(), fid);
      if (!fg) return;
      showConfirmDialog('確定拆解「' + fusedGemLabel(fg) + '」？\n將獲得 ' + fusedGemDismantleYield(fg) + ' 顆 1 階寶石（依屬性均分），此操作無法復原。', function () {

        sendGemUiCommand(
          'gem.dismantleFused',
          { fusedId: fid },
          'gem-dismantle-fused:' + fid,
          ['gems', 'header'],
          function (result) {
            var got = result.got || [];
            var gotStr = got.map(function (g) { return gemLabel(g.type, 1) + ' ×' + g.n; }).join('、');
            gdisShow('♻️ 融合寶石分解 → 返還 ' + gotStr);
            blog('♻️ 融合寶石分解 → ' + gotStr, 'good', 'factory');
          }
        );
        return;
      }, { title: '寶石拆解確認', danger: true });
    });
  }

  // 寶石融合 v2（雙屬性）
  var gfuseBtn = $id('gfuse-btn');
  if (gfuseBtn) {
    gfuseBtn.addEventListener('click', function () {
      var header = uiHeaderPanelSnapshot();
      var player = header && header.player;
      if (Number(player && player.level) < GEM_FUSION_UNLOCK_LEVEL ||
        uiReincarnationCount(header) < GEM_FUSION_UNLOCK_REINCARNATIONS) {
        blog('⚠️ 寶石融合需達到 3 轉且角色 Lv.1 才開放', 'warn');
        return;
      }
      if (!UI.gemFuseSlots || !UI.gemFuseSlots[0] || !UI.gemFuseSlots[1]) {
        blog('⚠️ 請先放入 2 顆 5 階寶石素材', 'warn');
        return;
      }

      var refs = UI.gemFuseSlots.slice();
      sendGemUiCommand(
        'gem.fuse',
        { ref1: refs[0], ref2: refs[1] },
        'gem-fuse',
        ['gems'],
        function (result) {
          if (result.success) {
            gfuseShow('💠 寶石融合成功：獲得' + fusedGemLabel(result.result) + '（成功率 ' + result.rate + '%）', 'yellow');
            blog('💠 <span class="log-hl-good">寶石融合成功！</span>獲得 ' + fusedGemLabel(result.result) + '（成功率 ' + result.rate + '%）', 'good', 'factory');
          } else {
            gfuseShow('💥 寶石融合失敗（成功率 ' + result.rate + '%），較弱寶石降解為 ' +
              result.degraded.n + ' 顆' + gemLabel(result.degraded.type, result.degraded.lv), 'warn');
          }
          UI.gemFuseSlots = [null, null];
          renderGemFusion();
        }
      );
      return;
    });
    $id('gfuse-clear').addEventListener('click', function () {
      UI.gemFuseSlots = [null, null];
      renderGemFusion();
    });
  }

  // 寶石商店
  var shopBuyAll = $id('shop-buy-all');
  if (shopBuyAll) {
    shopBuyAll.addEventListener('click', function () {

      sendGemUiCommand(
        'gem.shopBuyAll',
        {},
        'gem-shop',
        ['gems', 'header'],
        function (result) {
          if (result.bought > 0) {
            blog('🛒 一次購買' + result.bought + ' 顆寶石，花費 <img src="images/icon_gold.png" class="res-icon">' + fmt(result.spent), 'good', 'factory');
          } else {
            blog('⚠️ 沒有可購買的寶石，或目前金幣不足', 'warn');
          }
        }
      );
      return;
    });
    $id('shop-refresh').addEventListener('click', function () {

      sendGemUiCommand(
        'gem.shopRefresh',
        {},
        'gem-shop',
        ['gems', 'header'],
        function () {
          blog('🔄 寶石商店已刷新', 'info', 'factory');
        }
      );
      return;
    });
    var upgradeBtn = $id('shop-upgrade');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', function () {

        sendGemUiCommand(
          'gem.shopUpgrade',
          {},
          'gem-shop',
          ['gems', 'header'],
          function () {
            blog('⬆️ 寶石商店已升級', 'good', 'factory');
          }
        );
        return;
      });
    }
  }

  // 日誌篩選
  var logFilter = $id('log-filter');
  if (logFilter) {
    function applyLogFilter(v) {
      var b = $id('battle-log');
      if (!b) return;
      b.style.display = 'block';
      b.className = 'log' + (v === 'all' ? '' : ' filter-' + v);
    }
    logFilter.addEventListener('change', function (e) { applyLogFilter(e.target.value); });
    applyLogFilter(logFilter.value || 'all');
  }

  // 迷你監控視窗
  var detailLogBtn = $id('btn-detail-log');
  var detailLogModal = $id('detail-log-modal');
  var detailLogClose = $id('detail-log-close');
  var detailLogFilter = $id('detail-log-filter');
  var detailLogClear = $id('detail-log-clear');
  function closeDetailLog() {
    if (!detailLogModal) return;
    detailLogModal.style.display = 'none';
    detailLogModal.setAttribute('aria-hidden', 'true');
  }
  if (detailLogBtn && detailLogModal) {
    detailLogBtn.addEventListener('click', function () {
      var mainFilter = $id('log-filter');
      if (detailLogFilter) detailLogFilter.value = mainFilter ? mainFilter.value : 'all';
      renderDetailLog();
      detailLogModal.style.display = 'flex';
      detailLogModal.setAttribute('aria-hidden', 'false');
    });
    if (detailLogClose) detailLogClose.addEventListener('click', closeDetailLog);
    detailLogModal.addEventListener('click', function (e) {
      if (e.target === detailLogModal) closeDetailLog();
    });
    if (detailLogFilter) detailLogFilter.addEventListener('change', renderDetailLog);
    if (detailLogClear) detailLogClear.addEventListener('click', function () {
      DETAIL_LOG_HISTORY.length = 0;
      renderDetailLog();
    });
  }

  // 熔爐詳細日誌視窗
  var nfDetailLogBtn = $id('btn-newforge-log-detail');
  var nfDetailLogModal = $id('newforge-detail-log-modal');
  var nfDetailLogClose = $id('newforge-detail-log-close');
  var nfDetailLogClear = $id('newforge-detail-log-clear');
  var nfDetailLogPause = $id('btn-newforge-log-pause');

  function closeNfDetailLog() {
    if (!nfDetailLogModal) return;
    nfDetailLogModal.style.display = 'none';
    nfDetailLogModal.setAttribute('aria-hidden', 'true');
    if (newForgeLogStatsInterval) {
      clearInterval(newForgeLogStatsInterval);
      newForgeLogStatsInterval = null;
    }
  }

  if (nfDetailLogBtn && nfDetailLogModal) {
    nfDetailLogBtn.addEventListener('click', function () {
      if (!newForgeLogStartTime && NEWFORGE_LOG_HISTORY.length > 0) {
        newForgeLogStartTime = Date.now();
      }
      renderNewForgeDetailLog();
      nfDetailLogModal.style.display = 'flex';
      nfDetailLogModal.setAttribute('aria-hidden', 'false');

      if (newForgeLogStatsInterval) clearInterval(newForgeLogStatsInterval);
      newForgeLogStatsInterval = setInterval(function () {
        renderNewForgeLogStats();
      }, 1000);
    });
    if (nfDetailLogClose) nfDetailLogClose.addEventListener('click', closeNfDetailLog);
    nfDetailLogModal.addEventListener('click', function (e) {
      if (e.target === nfDetailLogModal) closeNfDetailLog();
    });
    if (nfDetailLogClear) {
      nfDetailLogClear.addEventListener('click', function () {
        NEWFORGE_LOG_HISTORY.length = 0;
        clearPendingLogDom('newforge-log');
        newForgeLogStartTime = null;
        resetNewForgeCumulativeStats();
        var box = $id('newforge-log');
        if (box) box.innerHTML = '';
        renderNewForgeDetailLog();
      });
    }
    if (nfDetailLogPause) {
      nfDetailLogPause.addEventListener('click', function () {
        window.newForgeLogPaused = !window.newForgeLogPaused;
        if (window.newForgeLogPaused) {
          nfDetailLogPause.textContent = '▶ 恢復日誌更新';
          nfDetailLogPause.classList.remove('warn');
          nfDetailLogPause.classList.add('good');
        } else {
          nfDetailLogPause.textContent = '⏸ 暫停日誌更新';
          nfDetailLogPause.classList.remove('good');
          nfDetailLogPause.classList.add('warn');
          refreshNewForgeMainLog();
          renderNewForgeDetailLog();
        }
      });
    }
  }

  var pipBtn = $id('btn-pip');
  if (pipBtn) pipBtn.addEventListener('click', openMiniWindow);

  // 戰鬥場景與位面切換
  var zoneBarEl = $id('zone-bar');
  if (zoneBarEl) {
    zoneBarEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.zone-btn');
      if (btn && !btn.classList.contains('locked')) {
        var zKey = btn.getAttribute('data-zone');
        if (zKey) {
          sendUiCommand('stage.switchZone', { zoneKey: zKey }, {
            keys: [nodePendingKey('zone')],
            panels: ['battle', 'header']
          }).catch(function (error) {
            reportUiCommandFailure('位面切換失敗', error, ['battle', 'header']);
          });
          UI.zoneBarSignature = '';
          renderZoneBar();
        }
      }
    });
  }
  var realmToggleBtn = $id('btn-realm-toggle');
  if (realmToggleBtn) {
    realmToggleBtn.addEventListener('click', function () {
      UI.userSelectedRealm = true;
      var curZone = ((uiHeaderPanelSnapshot() || {}).stage || {}).zone || 'desert';
      var isGod = curZone === 'god_battlefield' || curZone === 'god_chaos' || curZone === 'god_sanctuary' || UI.activeRealm === 'god';
      if (isGod) {
        UI.activeRealm = 'human';
        sendUiCommand('stage.switchZone', { zoneKey: 'desert' }, {
          keys: [nodePendingKey('zone')], panels: ['battle', 'header']
        });
      } else {
        UI.activeRealm = 'god';
        sendUiCommand('stage.switchZone', { zoneKey: 'god_battlefield' }, {
          keys: [nodePendingKey('zone')], panels: ['battle', 'header']
        });
      }
      UI.zoneBarSignature = '';
      renderZoneBar();
    });
  }

  // 階段控制
  var handlePauseClick = function () {
    sendUiCommand('combat.togglePaused', {}, {
      keys: [nodePendingKey('combat-pause')], panels: ['battle']
    }).catch(function (error) {
      reportUiCommandFailure('戰鬥暫停切換失敗', error, ['battle']);
    });
  };
  var combatPauseBtn = $id('btn-combat-pause');
  if (combatPauseBtn) combatPauseBtn.addEventListener('click', handlePauseClick);
  var detailCombatPauseBtn = $id('btn-detail-combat-pause');
  if (detailCombatPauseBtn) detailCombatPauseBtn.addEventListener('click', handlePauseClick);
  bindStageHoldButton('st-prev', -1);
  bindStageHoldButton('st-next', 1);
  $id('st-max').addEventListener('click', function () {
    sendUiCommand('stage.goMax', {}, {
      keys: [nodePendingKey('stage')], panels: ['battle', 'header']
    }).catch(function (error) {
      reportUiCommandFailure('階段切換失敗', error, ['battle', 'header']);
    });
  });
  $id('st-auto').addEventListener('change', function () {
    /* panels 必須含 header：勾選狀態是由 header 面板的 stage.autoAdvance 畫的
       （refreshStageDisplay），只等 battle 回來的話 header 仍是舊值，
       下一個 uiTick 就會把玩家剛勾的框彈回去。 */
    sendUiCommand('stage.setAutoAdvance', { on: !!this.checked }, {
      keys: [nodePendingKey('stage-auto')], panels: ['battle', 'header']
    }).catch(function (error) {
      reportUiCommandFailure('自動前進設定失敗', error, ['battle', 'header']);
    });
  });

  // 裝備 / 背包點擊（事件委派）
  document.addEventListener('click', function (e) {
    var poolBtn = e.target.closest('[data-affix-pool-toggle]');
    if (poolBtn) {
      toggleAffixPool(poolBtn);
      return;
    }
    if (!e.target.closest('#affix-pool-overlay')) hideAffixPool();
    // 神鑄：法陣槽位（點擊取回）/ 魔塵符位（點擊放入或取下）
    var fslot = e.target.closest('[data-forge-slot]');
    if (fslot) {
      if (isUiCommandPending(nodePendingKey('forge'))) return;
      if (fslot.classList.contains('filled')) {
        var forgeSlotIndex = parseInt(fslot.getAttribute('data-forge-slot'), 10);

        sendUiCommand('forge.removeItem', { slotIndex: forgeSlotIndex }, {
          keys: [nodePendingKey('forge')],
          panels: ['forge', 'inv', 'gems']
        }).catch(function (error) {
          reportUiCommandFailure('神鑄取回素材', error, ['forge', 'inv', 'gems']);
        });
      }
      return;
    }
    var fdust = e.target.closest('[data-forge-dust]');
    if (fdust) {
      if (isUiCommandPending(nodePendingKey('forge'))) return;
      var forgeDustIndex = parseInt(fdust.getAttribute('data-forge-dust'), 10);

      sendUiCommand('forge.toggleDust', { index: forgeDustIndex }, {
        keys: [nodePendingKey('forge')],
        panels: ['forge']
      }).catch(function (error) {
        reportUiCommandFailure('神鑄魔塵', error, ['forge']);
      });
      return;
    }
    // 神鑄自動放入選單（選取 / 確定 / 取消 / 外點關閉）
    var famMenu = $id('forge-auto-menu');
    if (famMenu && famMenu.style.display !== 'none') {
      var famOptE = e.target.closest('[data-fam-equip]');
      if (famOptE) {
        UI.forgeAutoPick = { kind: 'equip', rarity: parseInt(famOptE.getAttribute('data-fam-equip'), 10) };
        famApplyPickHighlight(famMenu);   // 就地更新高亮，不重建選單、不動卷軸位置
        return;
      }
      var famOptG = e.target.closest('[data-fam-gem]');
      if (famOptG) {
        var famG = famOptG.getAttribute('data-fam-gem').split(':');
        UI.forgeAutoPick = { kind: 'gem', type: famG[0], level: parseInt(famG[1], 10) };
        famApplyPickHighlight(famMenu);
        return;
      }
      if (e.target.closest('#fam-confirm')) {
        if (isUiCommandPending(nodePendingKey('forge'))) return;
        if (UI.forgeAutoPick) {
          var autoPickArgs = UI.forgeAutoPick.kind === 'gem'
            ? {
              kind: 'gem',
              gemType: UI.forgeAutoPick.type,
              gemLevel: UI.forgeAutoPick.level
            }
            : { kind: 'equip', rarity: UI.forgeAutoPick.rarity };
          sendUiCommand('forge.setAutoFill', autoPickArgs, {
            keys: [nodePendingKey('forge')],
            panels: ['forge', 'inv', 'gems']
          }).catch(function (error) {
            reportUiCommandFailure('神鑄自動放入', error, ['forge', 'inv', 'gems']);
          });
          famMenu.style.display = 'none';
          UI.forgeAutoPick = null;
          UI.dirty.forge = true;
        }
        return;
      }
      if (e.target.closest('#fam-stop')) {
        if (isUiCommandPending(nodePendingKey('forge'))) return;
        sendUiCommand('forge.setAutoFill', { kind: 'clear' }, {
          keys: [nodePendingKey('forge')],
          panels: ['forge']
        }).catch(function (error) {
          reportUiCommandFailure('取消神鑄自動放入', error, ['forge']);
        });
        famMenu.style.display = 'none';
        UI.forgeAutoPick = null;
        UI.dirty.forge = true;
        return;
      }
      if (e.target.closest('#fam-close')) {
        famMenu.style.display = 'none';
        UI.forgeAutoPick = null;
        return;
      }
      if (e.target.closest('.forge-auto-wrap')) return;  // 點在選單其他區域不動作
      famMenu.style.display = 'none';                    // 外點關閉，後續處理照常進行
      UI.forgeAutoPick = null;
    }
    // 神鑄寶石頁：點擊寶石放入法陣
    var fgem = e.target.closest('[data-forge-gem]');
    if (fgem) {
      if (isUiCommandPending(nodePendingKey('forge'))) return;
      var gp = fgem.getAttribute('data-forge-gem').split(':');
      var forgeGemLevel = parseInt(gp[1], 10);

      sendUiCommand('forge.placeGem', { type: gp[0], level: forgeGemLevel }, {
        keys: [nodePendingKey('forge')],
        panels: ['forge', 'gems']
      }).catch(function (error) {
        reportUiCommandFailure('神鑄放入寶石', error, ['forge', 'gems']);
      });
      return;
    }
    var cell = e.target.closest('.item-cell, .eq-slot');
    if (cell) {
      // Clicking selects the item for the detail pane; do not keep the
      // pre-click hover card alive and compete with the next hover target.
      hideTooltip();
      UI.pendingItemTooltip = null;
      // 神鑄背包：點擊裝備直接放入法陣（成功後清除殘留選取，防止跨分頁誤操作）
      if (cell.getAttribute('data-src') === 'forgeinv') {
        if (isUiCommandPending(nodePendingKey('forge'))) return;
        var fid = cell.getAttribute('data-id');

        sendUiCommand('forge.placeItem', { itemId: fid }, {
          keys: [nodePendingKey('forge'), itemPendingKey(fid)],
          panels: ['forge', 'inv']
        }).catch(function (error) {
          reportUiCommandFailure('神鑄放入裝備', error, ['forge', 'inv']);
        });
        return;
      }
      if (cell.classList.contains('empty')) {
        var emptySlot = cell.getAttribute('data-slot');
        if (UI.sel && UI.sel.source === 'equip-slot' && UI.sel.slot === emptySlot) {
          UI.sel = null;
        } else {
          UI.sel = { source: 'equip-slot', slot: emptySlot };
        }
        UI.lastEquipSlot = emptySlot;
      } else {
        selectFilledCell(cell);
      }
      renderDetail();
      return;
    }
    var actBtn = e.target.closest('#detail-pane .btn, #equip-action-bar .btn');
    if (actBtn) { detailAction(actBtn.getAttribute('data-act'), actBtn); return; }
    // 寶石鑲嵌 / 取下
    var gs = e.target.closest('[data-gem-socket]');
    if (gs) {
      var sit = findSelItem();
      if (sit) {

        sendUiCommand('gem.socket', {
          itemId: sit.id,
          type: gs.getAttribute('data-gem-socket')
        }, {
          keys: [itemPendingKey(sit.id)],
          panels: ['inv', 'equip', 'gems', 'header']
        }).catch(function (error) {
          reportUiCommandFailure('鑲嵌寶石', error, ['inv', 'equip', 'gems', 'header']);
        });
        return;
      }
      return;
    }
    var sr = e.target.closest('[data-socket-remove]');
    if (sr) {
      var uit = findSelItem();
      if (uit) {
        sendUiCommand('gem.unsocket', {
          itemId: uit.id,
          index: parseInt(sr.getAttribute('data-socket-remove'), 10)
        }, {
          keys: [itemPendingKey(uit.id)],
          panels: ['inv', 'equip', 'gems', 'header']
        }).catch(function (error) {
          reportUiCommandFailure('取下寶石', error, ['inv', 'equip', 'gems', 'header']);
        });
        return;
      }
      return;
    }
    // 寶石融合 v2：素材放入 / 移出
    var gfp = e.target.closest('[data-gfuse-pick]');
    if (gfp) {
      var gfHeader = uiHeaderPanelSnapshot();
      var gfPlayer = gfHeader && gfHeader.player;
      if (Number(gfPlayer && gfPlayer.level) < GEM_FUSION_UNLOCK_LEVEL ||
        uiReincarnationCount(gfHeader) < GEM_FUSION_UNLOCK_REINCARNATIONS) {
        blog('⚠️ 寶石融合需達到 3 轉且角色 Lv.1 才開放', 'warn');
        return;
      }
      if (!UI.gemFuseSlots) UI.gemFuseSlots = [null, null];
      var pv = gfp.getAttribute('data-gfuse-pick').split(':');
      var pref = pv[0] === 'plain'
        ? { kind: 'plain', type: pv[1], lv: parseInt(pv[2], 10) || GEM_MAX_LEVEL }
        : { kind: 'fused', id: pv[1] };
      // 融合寶石不可重複放入；一般寶石同種同階需有足夠數量
      var dupFused = pref.kind === 'fused' && UI.gemFuseSlots.some(function (r) { return r && r.kind === 'fused' && r.id === pref.id; });
      if (dupFused) { blog('⚠️ 這顆融合寶石已在融合槽中', 'warn'); return; }
      var slotIdx = UI.gemFuseSlots[0] ? (UI.gemFuseSlots[1] ? -1 : 1) : 0;
      if (slotIdx < 0) { blog('⚠️ 融合槽已滿（點擊素材可移出）', 'warn'); return; }
      if (pref.kind === 'plain') {
        var sameCnt = UI.gemFuseSlots.filter(function (r) { return r && r.kind === 'plain' && r.type === pref.type && (r.lv || GEM_MAX_LEVEL) === pref.lv; }).length;
        if (gemsViewCount(uiGemsPanelSnapshot(), pref.type, pref.lv) < sameCnt + 1) {
          blog('⚠️ 此種同階寶石數量不足', 'warn');
          return;
        }
      }
      UI.gemFuseSlots[slotIdx] = pref;
      renderGemFusion();
      return;
    }
    var gfr = e.target.closest('[data-gfuse-remove]');
    if (gfr) {
      UI.gemFuseSlots[parseInt(gfr.getAttribute('data-gfuse-remove'), 10)] = null;
      renderGemFusion();
      return;
    }
    // 寶石商店：單顆購買
    var sb = e.target.closest('[data-shop-buy]');
    if (sb) {
      var shopIndex = parseInt(sb.getAttribute('data-shop-buy'), 10);

      sendGemUiCommand(
        'gem.shopBuy',
        { index: shopIndex },
        'gem-shop',
        ['gems', 'header']
      );
      return;
    }
    // 融合寶石鑲嵌
    var gsf = e.target.closest('[data-gem-socket-fused]');
    if (gsf) {
      var fsit = findSelItem();
      if (fsit) {

        sendUiCommand('gem.socketFused', {
          itemId: fsit.id,
          fusedId: gsf.getAttribute('data-gem-socket-fused')
        }, {
          keys: [itemPendingKey(fsit.id)],
          panels: ['inv', 'equip', 'gems', 'header']
        }).catch(function (error) {
          reportUiCommandFailure('鑲嵌融合寶石', error, ['inv', 'equip', 'gems', 'header']);
        });
        return;
      }
      return;
    }
    // 手動附魔 / 取下附魔
    var be = e.target.closest('[data-book-enchant]');
    if (be) {
      var eit = findSelItem();
      if (eit) {
        var bkey = be.getAttribute('data-book-enchant');

        sendUiCommand('item.enchant', { itemId: eit.id, bookKey: bkey }, {
          keys: [itemPendingKey(eit.id)],
          panels: ['inv', 'equip', 'header']
        }).catch(function (error) {
          reportUiCommandFailure('裝備附魔', error, ['inv', 'equip', 'header']);
        });
        return;
      }
      return;
    }
    var er = e.target.closest('[data-enchant-remove]');
    if (er) {
      var rit = findSelItem();
      if (rit) {
        var rIdx = parseInt(er.getAttribute('data-enchant-remove'), 10);

        sendUiCommand('item.removeEnchant', { itemId: rit.id, index: rIdx }, {
          keys: [itemPendingKey(rit.id)],
          panels: ['inv', 'equip']
        }).catch(function (error) {
          reportUiCommandFailure('取下附魔', error, ['inv', 'equip']);
        });
        return;
      }
      return;
    }
    var tf = e.target.closest('[data-tower-floor]');
    if (tf) {
      var towerFloor = parseInt(tf.getAttribute('data-tower-floor'), 10);
      sendUiCommand('tower.start', { floor: towerFloor }, {
        keys: [nodePendingKey('tower')],
        panels: ['tower', 'battle', 'header']
      }).catch(function (error) {
        reportUiCommandFailure('高塔挑戰', error, ['tower', 'header']);
      });
      switchTab('tower');
      return;
    }
    // 高塔連續挑戰（次數取自 #tw-auto-count 輸入框）
    var ta = e.target.closest('[data-tower-auto]');
    if (ta) {
      var taInput = $id('tw-auto-count');
      var autoFloor = parseInt(ta.getAttribute('data-tower-auto'), 10);
      var autoCount = taInput ? parseInt(taInput.value, 10) : 0;
      sendUiCommand('tower.startAuto', { floor: autoFloor, count: autoCount }, {
        keys: [nodePendingKey('tower')],
        panels: ['tower', 'battle', 'header']
      }).catch(function (error) {
        reportUiCommandFailure('高塔連挑', error, ['tower', 'header']);
      });
      switchTab('tower');
      return;
    }
  });

  var btnSalvageSettings = $id('btn-salvage-settings');
  var salvagePanel = $id('salvage-settings-panel');
  if (btnSalvageSettings && salvagePanel) {
    btnSalvageSettings.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpening = salvagePanel.style.display === 'none' || !salvagePanel.style.display;
      if (isOpening) {
        var salvageHeader = uiHeaderPanelSnapshot();
        var salvageSettings = salvageHeader && salvageHeader.player
          ? salvageHeader.player.salvageSettings
          : null;
        if (salvageSettings) {
          if (salvageSettings.maxRarity !== undefined && $id('salvage-rarity-select')) {
            $id('salvage-rarity-select').value = String(salvageSettings.maxRarity);
          }
          if (salvageSettings.maxAncient !== undefined && $id('salvage-ancient-select')) {
            $id('salvage-ancient-select').value = String(salvageSettings.maxAncient);
          }
          if ($id('salvage-level-input')) {
            $id('salvage-level-input').value = (salvageSettings.maxLevel !== null && salvageSettings.maxLevel !== undefined) ? salvageSettings.maxLevel : '';
          }
        }
        salvagePanel.style.display = 'flex';
      } else {
        salvagePanel.style.display = 'none';
      }
    });

    document.addEventListener('click', function (e) {
      if (!salvagePanel.contains(e.target) && e.target !== btnSalvageSettings) {
        salvagePanel.style.display = 'none';
      }
    });

    $id('btn-salvage-confirm').addEventListener('click', function (e) {
      e.stopPropagation();
      var rVal = parseInt($id('salvage-rarity-select').value, 10);
      var maxRarity = isNaN(rVal) ? -1 : rVal;
      var aVal = $id('salvage-ancient-select') ? parseInt($id('salvage-ancient-select').value, 10) : -1;
      var maxAncient = isNaN(aVal) ? -1 : aVal;
      var lvlInput = $id('salvage-level-input') ? $id('salvage-level-input').value.trim() : '';
      var maxLevel = lvlInput ? parseInt(lvlInput, 10) : null;
      if (isNaN(maxLevel) || maxLevel <= 0) maxLevel = null;

      // 記憶設定至存檔
      var salvageArgs = { maxRarity: maxRarity, maxAncient: maxAncient };
      if (maxLevel !== null) salvageArgs.maxLevel = maxLevel;
      sendUiCommand('factory.setSalvageSettings', salvageArgs, {
        keys: [nodePendingKey('salvage-settings')],
        panels: ['factory']
      }).catch(function (error) {
        reportUiCommandFailure('拆解設定', error, ['factory']);
      });

      var conds = [];
      if (maxLevel !== null) {
        conds.push('「' + maxLevel + ' 級及以下」');
      }
      if (maxRarity >= 0 && RARITIES[maxRarity]) {
        conds.push('「' + RARITIES[maxRarity].name + '及以下品質」');
      } else if (maxRarity < 0) {
        conds.push('「不限品質」');
      }
      if (maxAncient >= 0) {
        conds.push('「' + maxAncient + ' 太古及以下」');
      } else {
        conds.push('「不限太古」');
      }

      if (maxLevel === null && maxRarity < 0 && maxAncient < 0) {
        conds.push('「所有等級、品質與太古」');
      }

      var condText = conds.join(' 且 ');
      var isHighRisk = (maxRarity >= 5 || maxRarity < 0 || maxLevel === null || maxAncient < 0);

      if (isHighRisk) {
        showConfirmDialog('確定要分解符合 ' + condText + ' 的未鎖定裝備嗎？\n此操作無法復原。', function () {
          salvageAllUnlocked(maxRarity, maxLevel, maxAncient);
          salvagePanel.style.display = 'none';
        }, { title: '裝備拆解確認', danger: true });
      } else {
        salvageAllUnlocked(maxRarity, maxLevel, maxAncient);
        salvagePanel.style.display = 'none';
      }
    });
  }
  var invExpand = $id('inv-expand');
  bindUiPendingControl(invExpand, nodePendingKey('inv-expand'));
  if (invExpand) invExpand.addEventListener('click', function () {
    sendUiCommand('player.buyInvUpgrade', {}, {
      keys: [nodePendingKey('inv-expand')],
      panels: ['inv', 'header']
    }).catch(function (error) {
      reportUiCommandFailure('擴充背包', error, ['inv', 'header']);
    });
  });
  var INV_SORT_MODES = [
    { key: 'level', label: '🔄 排序 (等級)', desc: '等級' },
    { key: 'ancient', label: '✡️ 排序 (太古)', desc: '太古詞條數量' },
    { key: 'rarity', label: '💎 排序 (品質)', desc: '品質' }
  ];

  function sortInventory() {
    var workerSortIndex = (UI.inventorySortIndex + 1) % INV_SORT_MODES.length;
    sendUiCommand('player.setInvSort', { index: workerSortIndex }, {
      keys: [nodePendingKey('inv-sort')],
      panels: ['inv']
    }).then(function (result) {
      var resultError = typeof uiCommandResultError === 'function' ? uiCommandResultError(result) : null;
      if (resultError) {
        reportUiCommandFailure('背包排序', resultError, ['inv']);
        return;
      }
      UI.inventorySortIndex = workerSortIndex;
      var workerSortButton = $id('inv-sort');
      if (workerSortButton) workerSortButton.textContent = INV_SORT_MODES[workerSortIndex].label;
      blog('🎒 背包已依' + INV_SORT_MODES[workerSortIndex].desc + '排序完成。', 'info', 'system');
    }).catch(function (error) {
      reportUiCommandFailure('背包排序', error, ['inv']);
    });
  }

  var sortEl = $id('inv-sort');
  if (sortEl) {
    bindUiPendingControl(sortEl, nodePendingKey('inv-sort'));
    sortEl.addEventListener('click', sortInventory);
  }

  var ancientFilter = $id('inv-ancient-filter');
  if (ancientFilter) {
    ancientFilter.addEventListener('change', function () {
      renderInventory();
    });
  }

  var rarityFilter = $id('inv-rarity-filter');
  if (rarityFilter) {
    rarityFilter.addEventListener('change', function () {
      renderInventory();
    });
  }

  var keywordFilter = $id('inv-keyword-filter');
  if (keywordFilter) {
    var isComposing = false;
    keywordFilter.addEventListener('compositionstart', function () {
      isComposing = true;
    });
    keywordFilter.addEventListener('compositionend', function () {
      isComposing = false;
      onKeywordFilterInput();
    });
    keywordFilter.addEventListener('input', function () {
      if (!isComposing) onKeywordFilterInput();
    });
    keywordFilter.addEventListener('change', function () {
      updateInventoryKeywordFilter();
    });
  }
  $id('tw-flee').setAttribute('data-ui-pending-key', nodePendingKey('tower'));
  $id('tw-flee').addEventListener('click', function () {

    sendUiCommand('tower.flee', {}, {
      keys: [nodePendingKey('tower')],
      panels: ['tower']
    }).catch(function (error) {
      reportUiCommandFailure('高塔撤退', error, ['tower']);
    });
  });

  // 神鑄：鑄造 / 全卸下 / 自動使用魔塵
  var forgeGoBtn = $id('forge-go');
  if (forgeGoBtn) {
    [forgeGoBtn, $id('forge-unload'), $id('forge-cancel')].forEach(function (control) {
      if (control) control.setAttribute('data-ui-pending-key', nodePendingKey('forge'));
    });
    $id('forge-autodust').setAttribute('data-ui-pending-key', nodePendingKey('forge-autoDust'));
    $id('forge-autoforge').setAttribute('data-ui-pending-key', nodePendingKey('forge-autoForge'));
    forgeGoBtn.addEventListener('click', function () {

      sendUiCommand('forge.start', {}, {
        keys: [nodePendingKey('forge')],
        panels: ['forge', 'inv', 'gems']
      }).catch(function (error) {
        reportUiCommandFailure('開始神鑄', error, ['forge', 'inv', 'gems']);
      });
    });
    $id('forge-unload').addEventListener('click', function () {

      sendUiCommand('forge.unloadAll', {}, {
        keys: [nodePendingKey('forge')],
        panels: ['forge', 'inv', 'gems']
      }).catch(function (error) {
        reportUiCommandFailure('神鑄全部取回', error, ['forge', 'inv', 'gems']);
      });
    });
    // 自動放入：開關選單（點擊時依目前切頁重建內容）
    var afToggleBtn = $id('forge-autofill');
    if (afToggleBtn) {
      afToggleBtn.addEventListener('click', function (e) {
        var menu = $id('forge-auto-menu');
        if (!menu) return;
        if (menu.style.display === 'none') {
          UI.forgeAutoPick = null;
          menu.style.display = 'block';
          var forgeMenuSnapshot = uiForgePanelSnapshot();
          renderForgeAutoMenu(
            forgeViewState(forgeMenuSnapshot),
            uiInventoryPanelSnapshot(),
            uiGemsPanelSnapshot()
          );
        } else {
          menu.style.display = 'none';
          UI.forgeAutoPick = null;
        }
        e.stopPropagation();
      });
    }
    $id('forge-autodust').addEventListener('change', function () {
      {
        var autoDustOn = !!this.checked;
        var forgeAutoDustSnapshot = forgeViewState(uiForgePanelSnapshot());
        if (autoDustOn && forgeViewItemCount(forgeAutoDustSnapshot) > 0) {
          sendUiCommand('forge.autoFillDust', {}, {
            keys: [nodePendingKey('forge-dust-fill')],
            panels: ['forge']
          }).catch(function (error) {
            reportUiCommandFailure('神鑄自動補魔塵', error, ['forge']);
          });
        }
        sendUiCommand('forge.setAuto', { key: 'autoDust', on: autoDustOn }, {
          keys: [nodePendingKey('forge-autoDust')],
          panels: ['forge']
        }).catch(function (error) {
          reportUiCommandFailure('神鑄自動魔塵設定', error, ['forge']);
        });
      }
    });
    $id('forge-autoforge').addEventListener('change', function () {
      {
        sendUiCommand('forge.setAuto', { key: 'autoForge', on: !!this.checked }, {
          keys: [nodePendingKey('forge-autoForge')],
          panels: ['forge']
        }).catch(function (error) {
          reportUiCommandFailure('神鑄自動鑄造設定', error, ['forge']);
        });
      }
    });
    $id('forge-cancel').addEventListener('click', function () {
      {
        sendUiCommand('forge.cancel', {}, {
          keys: [nodePendingKey('forge')],
          panels: ['forge', 'inv', 'gems']
        }).catch(function (error) {
          reportUiCommandFailure('取消神鑄', error, ['forge', 'inv', 'gems']);
        });

      }
    });
    // 背包 / 寶石切頁
    $id('forge-invtab-items').addEventListener('click', function () {
      UI.forgeInvTab = 'items'; UI.dirty.forge = true;
    });
    $id('forge-invtab-gems').addEventListener('click', function () {
      UI.forgeInvTab = 'gems'; UI.dirty.forge = true;
    });
  }
  $id('toggle-compare').addEventListener('change', function () {

    sendUiCommand('settings.set', { key: 'compareEq', value: this.checked }, {
      keys: [nodePendingKey('compare-equip')],
      panels: ['header', 'inv', 'equip']
    }).catch(function (error) {
      reportUiCommandFailure('裝備比較設定', error, ['header', 'inv', 'equip']);
    });
    return;

  });
  var autoEquipToggle = $id('toggle-autoequip');
  if (autoEquipToggle) autoEquipToggle.addEventListener('change', function () {

    var autoEquipOn = this.checked;
    sendUiCommand('factory.setAutoEquip', { on: autoEquipOn }, {
      keys: [nodePendingKey('auto-equip')],
      panels: ['factory']
    }).catch(function (error) {
      reportUiCommandFailure('自動穿裝設定', error, ['factory']);
    });
    blog(autoEquipOn
      ? '🎽 已開啟自動穿裝：空的裝備部位會自動穿上裝備，已穿戴部位不再替換'
      : '🎽 已關閉自動穿裝', 'info');
    return;
  });
  // 頂欄網頁全螢幕切換；瀏覽器 F11 屬於瀏覽器層級，網頁無法代替 F11 退出
  function isBrowserFullscreen() {
    var screenObj = typeof screen !== 'undefined' ? screen : null;
    if (!screenObj || document.fullscreenElement) return false;
    var firefoxF11 = typeof window.fullScreen === 'boolean' && window.fullScreen;
    var sizeF11 = window.outerWidth >= screenObj.width && window.outerHeight >= screenObj.height;
    return !!(firefoxF11 || sizeF11);
  }
  var fsBtn = $id('btn-fullscreen');
  if (fsBtn) {
    function syncFullscreenButton() {
      var pageFullscreen = !!document.fullscreenElement;
      var browserFullscreen = !pageFullscreen && isBrowserFullscreen();
      fsBtn.classList.toggle('active', pageFullscreen || browserFullscreen);
      fsBtn.setAttribute('data-tip', pageFullscreen
        ? '離開網頁全螢幕（Esc）'
        : (browserFullscreen ? '目前為瀏覽器 F11 全螢幕，請按 F11 返回' : '進入網頁全螢幕'));
    }
    fsBtn.addEventListener('click', function () {
      if (document.fullscreenElement) {
        // 第二次按下：離開全螢幕恢復正常
        document.exitFullscreen().catch(function () { });
      } else if (isBrowserFullscreen()) {
        blog('⚠️ 目前是瀏覽器 F11 全螢幕，網頁無法代替瀏覽器退出，請再按 F11 返回', 'warn', 'system');
      } else {
        document.documentElement.requestFullscreen().catch(function () {
          blog('⚠️ 瀏覽器拒絕進入網頁全螢幕，請使用 F11', 'warn', 'system');
        });
      }
    });
    document.addEventListener('fullscreenchange', function () {
      syncFullscreenButton();
    });
    window.addEventListener('resize', syncFullscreenButton);
    syncFullscreenButton();
  }

  // 熔爐頁設定（舊生產線的篩選/合成節點已移除）

  // 設定分頁：存檔管理
  $id('btn-save').addEventListener('click', function () {
    var m = $id('save-msg');
    if (m) m.textContent = '⏳ 正在確認本地存檔資料夾…';
    ensureSaveFolderV2(function (err, folderRes) {
      if (err || !folderRes) {
        var reason = '⚠️ 未建立手動存檔：' + (err || '尚未選擇本地資料夾');
        if (m) m.textContent = reason;
        blog(reason, 'warn');
        return;
      }
      sendUiCommand('save.toFolder', { label: folderRes.dirName || '' }, {
        keys: [nodePendingKey('save-folder')],
        panels: []
      }).then(function (result) {
        var error = uiCommandResultError(result);
        if (error) throw new Error(error);
        var rec = result && result.result ? result.result : result;
        UI.saveNoticeId = rec && rec.id;
        var text = '✅ 手動存檔已寫入本地資料夾「' + folderRes.dirName + '」' +
          (rec && rec.fname ? '：' + rec.fname : '');
        if (m) m.textContent = text;
        blog(text, 'good');
        /* 指令 resolve 只代表 Worker 收下並發出了 persist，檔案還沒寫進磁碟。
           直接刷新會掃到還沒有新檔案的資料夾，玩家得自己再按一次「重新掃描」。 */
        WorkerBridge.whenWritesDrained(function (drainErr) {
          if (drainErr) blog('⚠️ 存檔落地確認逾時，下方清單可能不是最新的，可按「重新掃描」。', 'warn');
          renderSaveList();
          refreshSaveFolderFilesV2();
        });
      }).catch(function (e) {
        var detail = e && e.message ? e.message : String(e);
        var text = '⚠️ 手動存檔寫入失敗：' + detail;
        if (m) m.textContent = text;
        blog(text, 'bad');
      });
    });
  });
  $id('btn-folder').addEventListener('click', function () {
    var m = $id('save-msg');
    if (m) m.textContent = '⏳ 請選擇或更新存檔資料夾…';
    openSaveFolder(function (err, res) {
      var text = '';
      if (err) {
        text = '⚠️ ' + err;
      } else if (res && res.selected) {
        text = '✅ 已選定存檔資料夾「' + res.dirName + '」；目前共有 ' + ((res.files || []).length) + ' 個檔案。';
        refreshSaveFolderFilesV2(res.files || []);
      }
      if (text) {
        if (m) m.textContent = text;
        blog(text, err ? 'warn' : 'good');
      }
      renderSaveList();
    }, true);
  });
  var bannerFolderBtn = $id('btn-folder-banner');
  if (bannerFolderBtn) bannerFolderBtn.addEventListener('click', function () { $id('btn-folder').click(); });
  var btnFolderRefresh = $id('btn-folder-refresh');
  if (btnFolderRefresh) btnFolderRefresh.addEventListener('click', function () {
    rescanSaveFolderView(true);
  });
  window.addEventListener('focus', function () {
    if (UI.tab === 'settings') rescanSaveFolderView(false);
  });
  $id('btn-restart').addEventListener('click', function () {
    var restartAuto = autoSaveMetaV2();
    showConfirmDialog('確定要重新開局嗎？將開一個全新角色從頭重玩。\n目前進度已保留在「⚡ 即時自動存檔（第 ' + (restartAuto.runId || 1) + ' 局）」，所有存檔記錄都不會刪除，隨時可以讀回來。', function () {
      sendUiCommand('save.restart', {}, {
        keys: [nodePendingKey('save-restart')]
      }).catch(function (error) {
        reportUiCommandFailure('重新開局', error);
      });
    }, { title: '重新開局確認', okText: '重新開局', danger: true });
  });
  // 讀取/刪除本地存檔（每列右側按鈕，需二次確認）
  $id('save-list').addEventListener('click', function (e) {
    var loadBtn = e.target.closest('[data-load-save]');
    var delBtn = e.target.closest('[data-del-save]');
    if (!loadBtn && !delBtn) return;

    var id = loadBtn ? loadBtn.getAttribute('data-load-save')
      : delBtn.getAttribute('data-del-save');
    var rec = typeof findSaveRecordV2 === 'function' ? findSaveRecordV2(id) : null;
    if (!rec) return;

    if (loadBtn) {
      showConfirmDialog('確定要讀取「' + saveRecName(rec) + '」嗎？\n檔名：' + rec.fname + '\n時間：' + saveTimeStr(rec.savedAt) +
        '\n\n目前進度會先寫入本局的自動存檔，再切換為此存檔。', function () {
          Promise.resolve(loadSaveRecord(id)).then(function (err) {
            if (err) blog('⚠️ 讀取存檔失敗：' + err, 'bad');
          }).catch(function (e) {
            blog('⚠️ 讀取存檔失敗：' + (e && e.message ? e.message : e), 'bad');
          });
        }, { title: '讀取存檔確認', okText: '讀取存檔', danger: true });
    } else if (delBtn) {
      showConfirmDialog('確定要刪除「' + saveRecName(rec) + '」嗎？\n檔名：' + rec.fname + '\n時間：' + saveTimeStr(rec.savedAt) +
        '\n\n刪除後無法恢復，是否繼續？', function () {
          deleteSaveRecord(id);
          blog('🗑️ 存檔已刪除：' + rec.fname);
          renderSaveList();
        }, { title: '刪除存檔確認', okText: '刪除存檔', danger: true });
    }
  });
  renderSaveList();

  syncFactoryInputs();

  // 統計面板彈窗
  var btnSummary = $id('btn-summary');
  if (btnSummary) {
    btnSummary.addEventListener('click', function () {
      var modal = $id('summary-modal');
      if (modal) {
        renderStatsPanel();
        modal.style.display = 'flex';
        startStatsPanelTimer();
      }
    });
  }
  var summaryModal = $id('summary-modal');
  if (summaryModal) {
    summaryModal.addEventListener('click', function (e) {
      if (e.target === summaryModal) {
        summaryModal.style.display = 'none';
        stopStatsPanelTimer();
      }
    });
    var summaryClose = $id('summary-modal-close');
    if (summaryClose) {
      summaryClose.addEventListener('click', function () {
        summaryModal.style.display = 'none';
        stopStatsPanelTimer();
      });
    }
    var btnSummaryClear = $id('btn-summary-clear');
    if (btnSummaryClear) {
      btnSummaryClear.addEventListener('click', resetStatsFromUi);
    }
  }

  /* 任務快捷列與任務總覽彈窗 */
  var questBar = $id('quest-bar');
  if (questBar) {
    questBar.addEventListener('click', function (e) {
      var view = viewState() || {};
      // 可領取→領獎並觸發領取與飛行特效；否則開任務總覽
      if (view.taskIdx >= 0 && view.taskReady) questClaim(e ? e.target : questBar);
      else openQuestModal();
    });
  }
  var questModal = $id('quest-modal');
  if (questModal) {
    questModal.addEventListener('click', function (e) {
      if (e.target === questModal) { closeQuestModal(); return; }
      var claimBtn = e.target.closest('[data-quest-claim]');
      if (claimBtn) questClaim(claimBtn);
    });
    var questClose = $id('quest-modal-close');
    if (questClose) questClose.addEventListener('click', closeQuestModal);
  }
}


/* ---- 高塔結算彈窗 ---- */
function clearTowerResultCountdown() {
  if (UI.towerResultCountdownTimer) {
    clearInterval(UI.towerResultCountdownTimer);
    UI.towerResultCountdownTimer = null;
  }
}
function confirmTowerResultModal() {
  clearTowerResultCountdown();
  var modal = $id('tower-result-modal');
  var confirmBtn = $id('trm-confirm');
  var stopAutoBtn = $id('trm-stop-auto');
  if (confirmBtn) confirmBtn.disabled = false;
  if (stopAutoBtn) {
    stopAutoBtn.disabled = false;
    stopAutoBtn.style.display = 'none';
  }
  if (modal) modal.style.display = 'none';
  sendUiCommand('tower.confirmResult', {}, {
    keys: [nodePendingKey('tower')],
    panels: ['tower', 'battle', 'header']
  }).catch(function (error) {
    reportUiCommandFailure('高塔結算', error, ['tower', 'header']);
  });
}
function stopTowerAutoFromResultModal() {
  clearTowerResultCountdown();
  sendUiCommand('tower.stopAuto', {}, {
    keys: [nodePendingKey('tower')],
    panels: ['tower']
  }).catch(function (error) {
    reportUiCommandFailure('停止高塔連挑', error, ['tower']);
  });
  var confirmBtn = $id('trm-confirm');
  var stopAutoBtn = $id('trm-stop-auto');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = '確定';
  }
  if (stopAutoBtn) {
    stopAutoBtn.disabled = true;
    stopAutoBtn.style.display = 'none';
  }
}

function showPendingTowerResultModalIfReady() {
  if (!UI.pendingTowerResult) return;
  var towerSnapshot = uiTowerPanelSnapshot();
  var headerSnapshot = uiHeaderPanelSnapshot();
  var runtime = towerSnapshot && towerSnapshot.runtime;
  if (!runtime || !headerSnapshot || !headerSnapshot.stats) return;
  var result = UI.pendingTowerResult;
  UI.pendingTowerResult = null;
  showTowerResultModal(
    result,
    runtime.player,
    runtime.boss,
    runtime.dmgDealt || 0,
    runtime.bossDmgDealt || 0,
    result.autoCountdown
      ? { autoCountdown: true, countdown: TOWER_AUTO_RESULT_DELAY }
      : null
  );
}

function showTowerResultModal(r, p, b, myDmg, bDmg, options) {
  var modal = $id('tower-result-modal');
  var title = $id('trm-title');
  var confirmBtn = $id('trm-confirm');
  var stopAutoBtn = $id('trm-stop-auto');
  clearTowerResultCountdown();

  if (r.win) {
    title.innerHTML = '🏆 挑戰成功！通關第 ' + r.floor + ' 層';
    title.className = 'tr-title good';
  } else {
    title.innerHTML = '💀 挑戰失敗（第 ' + r.floor + ' 層）';
    title.className = 'tr-title bad';
  }

  var headerSnapshot = uiHeaderPanelSnapshot();
  var st = headerSnapshot && headerSnapshot.stats;
  if (!st) return;
  var pMax = st.hp;
  var pHp = p ? p.hp : 0;
  var bMax = b ? b.maxHp : 1;
  var bHp = b ? b.hp : 0;

  var pPct = Math.max(0, Math.round(pHp / pMax * 100));
  var bPct = Math.max(0, Math.round(bHp / bMax * 100));

  var hpStatsHtml =
    '<div style="display:flex; justify-content:space-between; margin-bottom: 4px;"><span>冒險者：</span><span>' + fmt(Math.max(0, pHp)) + ' / ' + fmt(pMax) + ' (' + pPct + '%)</span></div>' +
    '<div style="display:flex; justify-content:space-between;"><span>' + (b ? b.name : 'BOSS') + '：</span><span>' + fmt(Math.max(0, bHp)) + ' / ' + fmt(bMax) + ' (' + bPct + '%)</span></div>';
  $id('trm-hp-stats').innerHTML = hpStatsHtml;

  var dmgStatsHtml =
    '<div style="display:flex; justify-content:space-between; margin-bottom: 4px;"><span>我方造成：</span><span>' + fmt(myDmg) + '</span></div>' +
    '<div style="display:flex; justify-content:space-between;"><span>敵方造成：</span><span>' + fmt(bDmg) + '</span></div>';
  $id('trm-dmg-stats').innerHTML = dmgStatsHtml;

  if (r.win) {
    $id('trm-rewards').innerHTML = r.rewards.map(function (x) { return '<div style="margin-bottom:4px;">' + x + '</div>'; }).join('');
  } else {
    $id('trm-rewards').innerHTML = r.analysis.map(function (x) { return '<div style="margin-bottom:4px; color:#ffb366;">📋 ' + esc(x) + '</div>'; }).join('');
  }

  if (confirmBtn) {
    var countdown = options && options.autoCountdown ? Math.ceil(options.countdown || 3) : 0;
    confirmBtn.disabled = countdown > 0;
    confirmBtn.textContent = countdown > 0 ? '確定（' + countdown + '）' : '確定';
    if (stopAutoBtn) {
      var canStopAuto = countdown > 0 && r && r.autoContinue;
      stopAutoBtn.style.display = canStopAuto ? 'inline-block' : 'none';
      stopAutoBtn.disabled = !canStopAuto;
    }
    if (countdown > 0) {
      UI.towerResultCountdownTimer = setInterval(function () {
        countdown--;
        if (confirmBtn) confirmBtn.textContent = countdown > 0 ? '確定（' + countdown + '）' : '確定';
        if (countdown <= 0) {
          if (confirmBtn) confirmBtn.disabled = false;
          confirmTowerResultModal();
        }
      }, 1000);
    }
  }
  modal.style.display = 'flex';
}

if ($id('trm-confirm')) {
  $id('trm-confirm').onclick = confirmTowerResultModal;
}
if ($id('trm-stop-auto')) {
  $id('trm-stop-auto').onclick = stopTowerAutoFromResultModal;
}
/* ---- 統計面板：基本統計與掉落物統計（HTML 由 js/stats.js 產生） ---- */
var statsPanelTimer = null;
function clearStatsSummaryDom() {
  var list = $id('battle-summary-list');
  if (list) list.innerHTML = '';
}

function resetStatsFromUi() {

  return sendUiCommand('stats.reset', {}, {
    keys: [nodePendingKey('stats')],
    panels: ['battle']
  }).then(function (result) {
    var error = uiCommandResultError(result);
    if (error) {
      reportUiCommandFailure('統計清除失敗', error, ['battle']);
      return false;
    }
    clearStatsSummaryDom();
    // battle panel 回來時由 PANEL handler 以 Worker Snapshot 重繪。
    return true;
  }).catch(function (error) {
    reportUiCommandFailure('統計清除失敗', error, ['battle']);
    return false;
  });
}


function withWorkerBattleStats(render) {
  var battle = peekUiPanelData('battle');
  if (!battle || !battle.runStats || !battle.lootStats) {
    requestPanelData('battle', false);
    return false;
  }
  var previousRunStats = window.RUN_STATS;
  var previousLootStats = window.LOOT_STATS;
  window.RUN_STATS = battle.runStats;
  window.LOOT_STATS = battle.lootStats;
  try {
    render();
  } finally {
    window.RUN_STATS = previousRunStats;
    window.LOOT_STATS = previousLootStats;
  }
  return true;
}

function renderStatsPanel() {
  if (uiRenderingSuspended()) return; // 背景分頁不重建統計面板
  withWorkerBattleStats(function () {
    var basic = $id('stats-basic-card');
    var source = $id('stats-source-card');
    var loot = $id('stats-loot-card');
    if (basic && typeof statsBasicHtml === 'function') basic.innerHTML = statsBasicHtml();
    if (source && typeof statsSourceHtml === 'function') source.innerHTML = statsSourceHtml();
    if (loot && typeof statsLootHtml === 'function') loot.innerHTML = statsLootHtml();
    if (typeof renderCurrentSummary === 'function') renderCurrentSummary(); // 目前戰鬥傷害卡片同步刷新
  });
}

// 面板開啟期間每秒重繪，統計時間與掉落數量即時更新；關閉即停止，避免閒置耗損。
function startStatsPanelTimer() {
  stopStatsPanelTimer();
  UI.statsPanelOpen = true;
  refreshUiPanelSubscriptions();
  requestPanelData('battle', true);
  statsPanelTimer = setInterval(renderStatsPanel, 1000);
}
function stopStatsPanelTimer() {
  if (statsPanelTimer) { clearInterval(statsPanelTimer); statsPanelTimer = null; }
  if (UI.statsPanelOpen) {
    UI.statsPanelOpen = false;
    refreshUiPanelSubscriptions();
  }
}

/* ---- 任務快捷列與任務總覽（2026-08-05）----
   資料來源分兩層：
   - 快捷列：tick.view 的 taskIdx / taskProg / taskReady（5Hz 純量）＋共載 TASKS 表
     （js/data.js——名稱、目標數量、獎勵文字兩端讀同一張表，不隨 tick 傳送）。
   - 總覽彈窗：task 面板投影（每筆任務的進度與領取狀態），開著時每秒重新索取，
     生命週期比照統計面板（開/關成對處理訂閱）。
   點擊快捷列：可領取→送 task.claim 直接領獎；未達成→開任務總覽。 */
var questPanelTimer = null;

function renderQuestBar() {
  var bar = $id('quest-bar');
  if (!bar || typeof TASKS === 'undefined') return;
  var view = viewState() || {};
  if (typeof view.taskIdx !== 'number') return; // Worker 尚未回報（開機前）
  var sig = view.taskIdx + '|' + view.taskProg + '|' + (view.taskReady ? 1 : 0);
  if (UI.questBarSignature === sig) return;
  UI.questBarSignature = sig;

  bar.style.display = 'flex';
  var def = view.taskIdx >= 0 ? TASKS[view.taskIdx] : null;
  bar.classList.toggle('quest-ready', !!(def && view.taskReady));
  bar.classList.toggle('quest-alldone', !def);
  if (!def) {
    bar.innerHTML = '<span class="quest-dot"></span><span class="quest-name">任務已全部完成</span>';
    bar.setAttribute('data-tt-title', '任務');
    bar.setAttribute('data-tt-desc', '所有任務皆已完成，點擊開啟任務總覽');
    return;
  }
  bar.innerHTML = '<span class="quest-dot"></span>' +
    '<span class="quest-name">' + esc(def.name) + '</span>' +
    '<span class="quest-progress">（' + view.taskProg + ' / ' + def.count + '）</span>' +
    '<span class="quest-reward">' + esc(def.rewardLabel) + '</span>' +
    (view.taskReady ? '<span class="quest-state-doing">可領取！</span>' : '');
  bar.setAttribute('data-tt-title', '任務 ' + def.order + ' / ' + TASKS.length);
  bar.setAttribute('data-tt-desc', view.taskReady ? '任務已完成，點擊領取獎勵' : '點擊開啟任務總覽');
}

function spawnQuestRewardFlyFx(rewardType, sourceEl) {
  if (typeof document === 'undefined' || !sourceEl || typeof sourceEl.getBoundingClientRect !== 'function') return;
  
  // 1. 任務列/點擊目標閃光特效
  var flashTarget = sourceEl.closest ? (sourceEl.closest('.quest-row') || sourceEl.closest('#quest-bar') || sourceEl) : sourceEl;
  if (flashTarget && flashTarget.classList) {
    flashTarget.classList.remove('quest-claim-flash');
    void flashTarget.offsetWidth; // 強制重繪觸發動畫
    flashTarget.classList.add('quest-claim-flash');
    setTimeout(function () {
      if (flashTarget && flashTarget.classList) flashTarget.classList.remove('quest-claim-flash');
    }, 700);
  }

  // 2. 確定起點 (Start Box)
  var srcRect = sourceEl.getBoundingClientRect();
  var startX = srcRect.left + srcRect.width / 2;
  var startY = srcRect.top + srcRect.height / 2;

  // 3. 確定終點與 Icon 內容 (Target Box & Icon Content)
  var destEl = null;
  var iconHtml = '';
  switch (rewardType) {
    case 'gold':
      destEl = document.getElementById('r-gold') ? document.getElementById('r-gold').parentElement : null;
      iconHtml = '<img src="images/icon_gold.png" alt="gold">';
      break;
    case 'scrap':
      destEl = document.getElementById('r-scrap') ? document.getElementById('r-scrap').parentElement : null;
      iconHtml = '<img src="images/icon_scrap.png" alt="scrap">';
      break;
    case 'essence':
      destEl = document.getElementById('r-essence') ? document.getElementById('r-essence').parentElement : null;
      iconHtml = '<img src="images/icon_essence.png" alt="essence">';
      break;
    case 'gem':
      destEl = document.getElementById('r-gems') ? document.getElementById('r-gems').parentElement : null;
      iconHtml = '<img src="images/icon_gems.png" alt="gems">';
      break;
    case 'book':
      destEl = document.getElementById('r-books') ? document.getElementById('r-books').parentElement : null;
      iconHtml = '<img src="images/icon_books.png" alt="books">';
      break;
    case 'skillXp':
      destEl = document.querySelector('[data-tab="skills"]') || document.getElementById('r-gold');
      iconHtml = '<span class="fly-emoji">🧠</span>';
      break;
    case 'equip':
    default:
      destEl = document.getElementById('inv-section-box') || document.querySelector('[data-tab="equip"]');
      iconHtml = '<span class="fly-emoji">⚔️</span>';
      break;
  }

  var endX = window.innerWidth / 2;
  var endY = 30;
  if (destEl && typeof destEl.getBoundingClientRect === 'function') {
    var destRect = destEl.getBoundingClientRect();
    if (destRect.width > 0 && destRect.height > 0) {
      endX = destRect.left + destRect.width / 2;
      endY = destRect.top + destRect.height / 2;
    }
  }

  // 4. 動態創建飛行 Icon DOM
  var flyEl = document.createElement('div');
  flyEl.className = 'quest-fly-reward';
  flyEl.innerHTML = iconHtml;
  flyEl.style.left = startX + 'px';
  flyEl.style.top = startY + 'px';
  document.body.appendChild(flyEl);

  // 曲線控制點 (Control Point for Quadratic Bezier)
  var cpX = (startX + endX) / 2 + (Math.random() - 0.5) * 120;
  var cpY = Math.min(startY, endY) - 60 - Math.random() * 60;

  var startTime = null;
  var duration = 750; // 飛行時間 750ms

  function animateFly(timestamp) {
    if (!startTime) startTime = timestamp;
    var elapsed = timestamp - startTime;
    var t = Math.min(1, elapsed / duration);

    // 貝茲曲線計算：B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
    var invT = 1 - t;
    var curX = invT * invT * startX + 2 * invT * t * cpX + t * t * endX;
    var curY = invT * invT * startY + 2 * invT * t * cpY + t * t * endY;

    // 縮放效果（無旋轉）
    var scale = t < 0.2 ? (t / 0.2) * 1.3 : (1.3 - (t - 0.2) * 0.4);
    flyEl.style.left = curX + 'px';
    flyEl.style.top = curY + 'px';
    flyEl.style.transform = 'scale(' + scale + ')';

    // 生成長拖尾粒子 (Trail Particle)
    if (t < 0.95 && Math.random() < 0.75) {
      var p = document.createElement('div');
      p.className = 'fly-trail-particle';
      var pSize = Math.floor(Math.random() * 8) + 6;
      p.style.width = pSize + 'px';
      p.style.height = pSize + 'px';
      p.style.left = (curX + (Math.random() - 0.5) * 8) + 'px';
      p.style.top = (curY + (Math.random() - 0.5) * 8) + 'px';
      document.body.appendChild(p);
      setTimeout(function () {
        if (p && p.parentNode) p.parentNode.removeChild(p);
      }, 450);
    }

    if (t < 1) {
      requestAnimationFrame(animateFly);
    } else {
      // 飛行結束
      if (flyEl && flyEl.parentNode) flyEl.parentNode.removeChild(flyEl);
      // 到達目的地觸發脈衝彈跳
      if (destEl && destEl.classList) {
        destEl.classList.remove('res-hit-bump');
        void destEl.offsetWidth;
        destEl.classList.add('res-hit-bump');
        setTimeout(function () {
          if (destEl && destEl.classList) destEl.classList.remove('res-hit-bump');
        }, 400);
      }
    }
  }

  requestAnimationFrame(animateFly);
}

function questClaim(sourceEl) {
  var view = viewState() || {};
  var taskDef = (view.taskIdx >= 0 && typeof TASKS !== 'undefined') ? TASKS[view.taskIdx] : null;
  var rewardType = taskDef ? taskDef.rewardType : 'gold';

  sendUiCommand('task.claim', {}, { keys: ['quest-claim'], panels: ['task'] })
    .then(function (result) {
      if (result && result.err) { blog('⚠️ ' + result.err, 'warn', 'system'); return; }
      
      // 成功領取時觸發特效
      var triggerEl = sourceEl || document.getElementById('quest-bar');
      spawnQuestRewardFlyFx(rewardType, triggerEl);

      if (UI.questPanelOpen) {
        requestPanelData('task', true);
        renderQuestModal();
      }
    }, function (err) {
      reportUiCommandFailure('任務領取', err, ['task']);
    });
}

function openQuestModal() {
  var modal = $id('quest-modal');
  if (!modal) return;
  UI.questPanelOpen = true;
  refreshUiPanelSubscriptions();
  requestPanelData('task', true);
  renderQuestModal();
  modal.style.display = 'flex';
  // 預設捲到最下方，讓玩家直接看到進行中任務
  var qList = $id('quest-modal-list');
  if (qList) qList.scrollTop = qList.scrollHeight;
  // 開著期間每秒重新索取並重繪：狀態型進度（穿裝/鑲嵌/生命上限）沒有固定髒區訊號
  if (questPanelTimer) clearInterval(questPanelTimer);
  questPanelTimer = setInterval(function () {
    requestPanelData('task', true);
    renderQuestModal();
  }, 1000);
}

function closeQuestModal() {
  var modal = $id('quest-modal');
  if (modal) modal.style.display = 'none';
  if (questPanelTimer) { clearInterval(questPanelTimer); questPanelTimer = null; }
  if (UI.questPanelOpen) {
    UI.questPanelOpen = false;
    refreshUiPanelSubscriptions();
  }
}

function renderQuestModal() {
  var list = $id('quest-modal-list');
  if (!list || typeof TASKS === 'undefined') return;
  if (uiRenderingSuspended()) return; // 背景分頁不重建
  var snapshot = peekUiPanelData('task');
  var states = (snapshot && snapshot.tasks) || [];
  var html = '';
  for (var i = 0; i < TASKS.length; i++) {
    var def = TASKS[i];
    var st = states[i] || null;
    var claimed = !!(st && st.claimed);
    var current = !!(st && st.current);
    var ready = !!(st && st.ready);
    var prog = st ? st.prog : 0;
    var cls = claimed ? 'claimed' : (current ? 'current' : 'future');
    var rewardHtml;
    if (claimed) {
      rewardHtml = '已完成';
    } else {
      rewardHtml = esc(def.rewardLabel);
      if (current) {
        rewardHtml += ready
          ? '<button type="button" class="btn sm quest-claim-btn" data-quest-claim ' +
            pendingUiButtonAttributes('quest-claim') + '>領取</button>'
          : '<span class="quest-state-doing">（進行中）</span>';
      }
    }
    html += '<div class="quest-row ' + cls + '">' +
      '<span class="quest-col-name">' + esc(def.name) + '</span>' +
      '<span class="quest-col-prog">（' + prog + ' / ' + def.count + '）</span>' +
      '<span class="quest-col-reward">' + rewardHtml + '</span>' +
      '</div>';
  }
  setHtmlIfChanged(list, html);
}

// 開啟結算彈窗時，將目前尚未死亡結算的戰鬥統計更新到最上方。
function renderCurrentSummary() {
  var list = $id('battle-summary-list');
  if (!list) return;
  var old = list.querySelector('[data-summary-current]');
  if (old) old.remove();
  var html = typeof generateSummaryHtml === 'function' ? generateSummaryHtml(true) : '';
  if (!html) {
    var empty = document.createElement('div');
    empty.className = 'summary-card';
    empty.setAttribute('data-summary-current', 'true');
    empty.innerHTML = '<div class="summary-card-title">目前戰鬥（即時統計）</div><div class="summary-card-row">尚未產生傷害統計</div>';
    list.insertBefore(empty, list.firstChild);
    return;
  }
  var holder = document.createElement('div');
  holder.innerHTML = html;
  list.insertBefore(holder.firstChild, list.firstChild);
}
