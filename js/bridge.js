'use strict';
/* ============ 主執行緒 ⇄ 模擬 Worker 橋接 ============
   負責建立 Worker、配對指令與回應、轉發分頁狀態，並把 Worker 送來的訊息
   分派給註冊的處理函式。

   ---- P1 階段行為（重要）----
   目前只在網址帶 ?worker=1 時啟動，且刻意以「全新遊戲狀態」開機：
     - 不讀取玩家既有存檔
     - 不寫入任何儲存（persist 一律回 ok 但不落地）
   所以此模式下 Worker 跑的是拋棄式狀態，與畫面上正在進行的遊戲互不影響，
   驗證期間玩家存檔零風險。真正的存檔接線在 P2。 */

var WorkerBridge = (function () {
  var WORKER_URL = 'js/worker/sim.worker.js';

  var _worker = null;
  var _seq = 0;
  var _pending = {};      // cmd id -> { resolve, reject, name, at }
  var _handlers = {};     // type -> [fn]
  var _started = false;

  var stats = {
    booted: false,
    ticks: 0,
    events: 0,
    errors: 0,
    persists: 0,
    persistErrors: 0,
    lastView: null,
    lastDirty: [],
    lastDiag: null,
    lastError: null,
    bootedAt: 0
  };

  function on(type, fn) {
    (_handlers[type] || (_handlers[type] = [])).push(fn);
  }

  function emit(type, msg) {
    var list = _handlers[type];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](msg); } catch (e) { console.error('[bridge] handler error:', type, e); }
    }
  }

  function post(type, payload) {
    if (!_worker) return false;
    payload = payload || {};
    payload.type = type;
    _worker.postMessage(payload);
    return true;
  }

  /* 送出指令，回傳 Promise。指令是非同步的：呼叫端不得在此之後立刻讀鏡像狀態
     並假設已生效，必須等 resolve 或等下一次 tick。 */
  function send(name, args) {
    return new Promise(function (resolve, reject) {
      if (!_worker) { reject(new Error('worker not started')); return; }
      var invalid = (typeof validateCommand === 'function') ? validateCommand(name, args) : null;
      if (invalid) { reject(new Error(invalid)); return; }
      var id = ++_seq;
      _pending[id] = { resolve: resolve, reject: reject, name: name, at: Date.now() };
      post(MSG_IN.CMD, { id: id, name: name, args: args || {} });
    });
  }

  function requestPanel(name) {
    return post(MSG_IN.PANEL, { name: name });
  }

  function onMessage(e) {
    var msg = e.data || {};
    switch (msg.type) {
      case MSG_OUT.BOOTED:
        stats.booted = true;
        stats.bootedAt = Date.now();
        if (msg.protocolVersion !== WORKER_PROTOCOL_VERSION) {
          console.error('[bridge] 協議版本不符：主執行緒 ' + WORKER_PROTOCOL_VERSION +
            '，Worker ' + msg.protocolVersion + '。請清除快取重新載入。');
        }
        break;
      case MSG_OUT.TICK:
        stats.ticks++;
        stats.lastView = msg.view;
        stats.lastDirty = msg.dirty || [];
        stats.lastDiag = msg.diag || null;
        stats.events += (msg.events || []).length;
        break;
      case MSG_OUT.ACK:
        var p = _pending[msg.id];
        if (p) {
          delete _pending[msg.id];
          if (msg.ok) p.resolve(msg.result);
          else p.reject(new Error(msg.error || ('command failed: ' + p.name)));
        }
        break;
      case MSG_OUT.PERSIST:
        stats.persists++;
        SaveStorage.persist(msg.kind, msg.payload.json, msg.payload.meta, function (err) {
          if (err) {
            stats.persistErrors++;
            stats.lastError = { where: 'persist:' + msg.kind, message: err.message || String(err) };
            console.error('[bridge] 存檔寫入失敗（' + msg.kind + '）:', err);
          }
          post(MSG_IN.SAVE_RESULT, { token: msg.token, ok: !err, error: err ? (err.message || String(err)) : undefined });
        });
        break;
      case MSG_OUT.ERROR:
        stats.errors++;
        stats.lastError = msg;
        console.error('[worker] ' + msg.where + ': ' + msg.message, msg.stack || '');
        break;
    }
    emit(msg.type, msg);
  }

  function start(opts) {
    if (_started) return true;
    opts = opts || {};
    try {
      _worker = new Worker(WORKER_URL);
    } catch (e) {
      console.error('[bridge] 無法建立 Worker（以 file:// 開啟時瀏覽器會封鎖，請用開發伺服器）：', e);
      return false;
    }
    _started = true;
    _worker.onmessage = onMessage;
    _worker.onerror = function (err) {
      stats.errors++;
      stats.lastError = { where: 'worker-onerror', message: err.message, stack: err.filename + ':' + err.lineno };
      console.error('[bridge] worker error:', err.message, err.filename + ':' + err.lineno);
    };

    post(MSG_IN.BOOT, { save: opts.save || null, now: Date.now(), maxRunId: opts.maxRunId || 1 });

    // 初始狀態也要送：分頁若在隱藏狀態下被載入，visibilitychange 不會觸發，
    // Worker 會以為自己在前景而持續全速模擬（main.js 的 _hiddenAt 初始化同理）
    post(MSG_IN.VISIBILITY, { hidden: !!document.hidden, at: Date.now() });
    document.addEventListener('visibilitychange', function () {
      post(MSG_IN.VISIBILITY, { hidden: !!document.hidden, at: Date.now() });
    });
    console.info('[bridge] Worker 已啟動' + (opts.save ? '' : '（拋棄式狀態，不讀寫玩家存檔）') +
      '。輸入 WorkerBridge.status() 查看狀態。');
    return true;
  }

  function stop() {
    if (_worker) { _worker.terminate(); _worker = null; }
    _started = false;
    stats.booted = false;
  }

  function status() {
    return {
      started: _started,
      booted: stats.booted,
      upTimeSec: stats.bootedAt ? Math.round((Date.now() - stats.bootedAt) / 1000) : 0,
      ticks: stats.ticks,
      events: stats.events,
      errors: stats.errors,
      persists: stats.persists,
      pendingCommands: Object.keys(_pending).length,
      persistErrors: stats.persistErrors,
      lastDirty: stats.lastDirty,
      lastView: stats.lastView,
      shimDiag: stats.lastDiag,
      lastError: stats.lastError
    };
  }

  /* 執行中讀檔：主執行緒讀出存檔內容後交 Worker 替換整份狀態，不需要 reload */
  function loadSave(save) {
    return post(MSG_IN.LOAD, { save: save });
  }

  function enabled() {
    return typeof location !== 'undefined' && /[?&]worker=1(&|$)/.test(location.search);
  }

  return {
    start: start, stop: stop, send: send, on: on, loadSave: loadSave,
    requestPanel: requestPanel, status: status, enabled: enabled
  };
})();

/* ---- ?worker=1 驗證模式 ----
   P2 起 Worker 成為模擬與存檔的權威：以玩家的真實存檔開機，並負責之後所有存檔寫入。
   為避免兩個權威同時寫入，main.js 在此模式下會關掉舊迴圈並設 _saveSuppressed。

   ⚠️ P3 之前 UI 尚未接上 Worker，所以此模式下畫面不會更新（等同凍結），這是預期中的
   中間狀態。要玩遊戲請拿掉網址參數走舊路徑。 */
(function () {
  if (!WorkerBridge.enabled()) return;
  window.addEventListener('DOMContentLoaded', function () {
    SaveStorage.readBootSave(function (save) {
      WorkerBridge.start({ save: save, maxRunId: SaveStorage.maxRunId() });
    });
  });
})();
