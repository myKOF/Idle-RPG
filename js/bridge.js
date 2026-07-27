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

  /* ---- 量測模式（P4 用，預設關閉）----
     網址帶 ?measure=1 時，Worker 與主執行緒兩側都會統計訊息規模與耗時。
     平常不啟用，因為算 payload 大小要多做一次序列化，會扭曲被量測的對象。 */
  var MEASURE = typeof location !== 'undefined' && /[?&]measure=1(&|$)/.test(location.search);
  var recvStats = Object.create(null);

  /* 量的是「收到訊息到分派完成」的主執行緒耗時。這是 Worker 架構真正要保護的東西：
     即使模擬在另一條執行緒，訊息處理仍發生在主執行緒上，過大的 payload 一樣會卡畫面。 */
  function recordRecv(type, msg, ms) {
    var s = recvStats[type];
    if (!s) s = recvStats[type] = { count: 0, bytes: 0, maxBytes: 0, ms: 0, maxMs: 0 };
    s.count++;
    s.ms += ms;
    if (ms > s.maxMs) s.maxMs = ms;
    try {
      var bytes = JSON.stringify(msg).length;
      s.bytes += bytes;
      if (bytes > s.maxBytes) s.maxBytes = bytes;
    } catch (e) {}
  }

  function recvSnapshot() {
    if (!MEASURE) return null;
    var out = Object.create(null);
    for (var type in recvStats) {
      var s = recvStats[type];
      out[type] = {
        count: s.count,
        avgBytes: Math.round(s.bytes / s.count),
        maxBytes: s.maxBytes,
        avgMs: +(s.ms / s.count).toFixed(3),
        maxMs: +s.maxMs.toFixed(3)
      };
    }
    return out;
  }

  var _worker = null;
  var _seq = 0;
  var _pending = {};      // cmd id -> { resolve, reject, name, at }
  var _handlers = {};     // type -> [fn]
  var _started = false;

  var stats = {
    booted: false,
    alive: true,
    deadReason: null,
    ticks: 0,
    events: 0,
    errors: 0,
    persists: 0,
    persistErrors: 0,
    lastView: null,
    lastDirty: [],
    lastDiag: null,
    lastMeasure: null,
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

  /* params 由各面板自行定義；目前只有 inv 使用（{ detailIds:[...] } 索取完整裝備資料）。
     不帶 params 時背包只回傳格子欄位的投影，不含詞條。 */
  function requestPanel(name, params) {
    return post(MSG_IN.PANEL, { name: name, params: params });
  }

  function onMessage(e) {
    _lastMessageAt = Date.now();
    _probeAt = 0; // 有回應就代表還活著，不必等 PONG
    if (!stats.alive) {
      // 誤判自我修復：Worker 若只是被長時間同步操作卡住（大量分解、巨型存檔序列化），
      // 解開後仍會回訊息。偵測門檻刻意保守，但寧可誤判後恢復，也不要漏報真正的死亡。
      stats.alive = true;
      stats.deadReason = null;
      console.info('[bridge] Worker 恢復回應，先前的失效判定為誤判。');
      emit('workerRecovered', { at: Date.now() });
    }
    if (!MEASURE) { dispatch(e.data || {}); return; }
    var t0 = performance.now();
    var msg = e.data || {};
    dispatch(msg);
    recordRecv(msg.type, msg, performance.now() - t0);
  }

  function dispatch(msg) {
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
        if (msg.measure) stats.lastMeasure = msg.measure;
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

  /* ---- 存活監測 ----
     worker 模式下主執行緒的舊迴圈是關閉的（見 main.js 的 WORKER_MODE），
     所以 Worker 一旦死掉，遊戲會靜靜凍結而且**停止存檔**——玩家不會看到任何錯誤，
     只會在下次開啟時發現進度回到十幾秒前。所以死亡必須被偵測並說出來。

     判定方式：一段時間沒收到任何訊息就送 PING，等不到 PONG 才算死。
     不直接用「沒有 tick」判定，因為背景分頁節流與 60 秒後的模擬休眠都會讓 tick 停止，
     那是正常行為；分頁隱藏期間一律不判定，切回前景時重置計時。 */
  var STALL_CHECK_MS = 3000;   // 監測間隔
  var STALL_AFTER_MS = 5000;   // 靜默多久才開始探測
  var PONG_TIMEOUT_MS = 4000;  // 探測後等 PONG 的上限
  var _lastMessageAt = 0;
  var _probeAt = 0;
  var _watchdogTimer = 0;

  function markWorkerDead(reason) {
    if (!stats.alive) return; // 只報一次
    stats.alive = false;
    stats.deadReason = reason;
    console.error('[bridge] Worker 已失去回應（' + reason + '）。' +
      '模擬與自動存檔已停止，請重新整理頁面；未存檔的進度最多會回到上一次自動存檔。');
    emit('workerDead', { reason: reason, at: Date.now() });
  }

  function watchdog() {
    if (!_worker || !stats.booted || !stats.alive) return;
    // 背景分頁：節流與模擬休眠都會讓訊息停止，不能當成死亡
    if (typeof document !== 'undefined' && document.hidden) { _lastMessageAt = Date.now(); return; }
    var now = Date.now();
    if (_probeAt) {
      if (now - _probeAt > PONG_TIMEOUT_MS) markWorkerDead('PING 逾時未回應');
      return;
    }
    if (now - _lastMessageAt > STALL_AFTER_MS) {
      _probeAt = now;
      post(MSG_IN.PING, { t: now });
    }
  }

  function start(opts) {
    if (_started) return true;
    opts = opts || {};
    try {
      // 量測模式要讓 Worker 那側也知道，透過 Worker URL 的 query 傳遞（免動協議）
      _worker = new Worker(MEASURE ? (WORKER_URL + '?measure=1') : WORKER_URL);
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
      // 開機前就出錯代表 Worker 根本沒起來（載入失敗、語法錯誤），直接判定失效
      if (!stats.booted) markWorkerDead('Worker 載入失敗：' + err.message);
    };

    _lastMessageAt = Date.now();
    post(MSG_IN.BOOT, { save: opts.save || null, now: Date.now(), maxRunId: opts.maxRunId || 1 });

    // 初始狀態也要送：分頁若在隱藏狀態下被載入，visibilitychange 不會觸發，
    // Worker 會以為自己在前景而持續全速模擬（main.js 的 _hiddenAt 初始化同理）
    post(MSG_IN.VISIBILITY, { hidden: !!document.hidden, at: Date.now() });
    document.addEventListener('visibilitychange', function () {
      // 切回前景時重置靜默計時：隱藏期間沒有訊息是正常的，不能算進去
      if (!document.hidden) { _lastMessageAt = Date.now(); _probeAt = 0; }
      post(MSG_IN.VISIBILITY, { hidden: !!document.hidden, at: Date.now() });
    });

    _watchdogTimer = setInterval(watchdog, STALL_CHECK_MS);
    console.info('[bridge] Worker 已啟動' + (opts.save ? '' : '（拋棄式狀態，不讀寫玩家存檔）') +
      '。輸入 WorkerBridge.status() 查看狀態。');
    return true;
  }

  function stop() {
    if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = 0; }
    if (_worker) { _worker.terminate(); _worker = null; }
    _started = false;
    stats.booted = false;
  }

  function status() {
    return {
      started: _started,
      booted: stats.booted,
      alive: stats.alive,
      deadReason: stats.deadReason,
      silentMs: _lastMessageAt ? (Date.now() - _lastMessageAt) : null,
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
      /* ?measure=1 才有值。worker 是送出端（structured clone 成本），
         main 是接收端（主執行緒分派耗時），兩者要分開看。 */
      measure: MEASURE ? { worker: stats.lastMeasure, main: recvSnapshot() } : null,
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
