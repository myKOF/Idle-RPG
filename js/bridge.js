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
     主執行緒沒有自己的模擬迴圈（P5 起舊路徑已移除），
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
  var _visibilityBound = false;

  /* ---- 迷你監控視窗（PiP）----
     玩家開 PiP 是為了邊做別的事邊看戰鬥，這時分頁雖然隱藏但畫面確實在被觀看，
     所以不能休眠。判定狀態在 ui.js 的 MINI，Worker 看不到，必須由這裡轉發。

     ⚠️ PiP 可能在分頁已經隱藏之後才開啟或關閉，那時不會有 visibilitychange，
     所以除了隨 visibility 送，還要在 watchdog 裡輪詢變化並補送。
     3 秒的偵測間隔對 60 秒的休眠門檻綽綽有餘。 */
  var _pipLast = false;

  function miniMonitorActive() {
    return typeof MINI !== 'undefined' && MINI && !!(MINI.win || MINI.timer);
  }

  function postVisibility() {
    _pipLast = miniMonitorActive();
    return post(MSG_IN.VISIBILITY, {
      hidden: !!document.hidden, pip: _pipLast, at: Date.now()
    });
  }

  /* ---- 失效後自動重啟 ----
     這是掛機遊戲，玩家多半把分頁丟在背景。Worker 死掉時畫面看起來還在，但時間停了：
     不打怪、不掉東西、不存檔。若只顯示遮罩等玩家按重新載入，背景掛機那幾小時就整段作廢。

     所以偶發性失效一律自動重啟，玩家無感，最多損失一次自動存檔的間隔（15 秒）。

     但不能無限重啟：若崩潰是存檔資料本身造成的，就會變成掛掉→重啟→掛掉的迴圈，
     玩家看到的是「遊戲好像在跑但進度一直不動」，比直接報錯更難查。所以設連續上限，
     超過就停手、顯示遮罩讓玩家知道要處理存檔。

     連續計數只在「撐過 HEALTHY_UPTIME_MS 都沒事」時歸零——玩很久之後偶爾各壞一次，
     不該累積成放棄。 */
  var MAX_RESTARTS = 3;
  var HEALTHY_UPTIME_MS = 120000;
  var RESTART_DELAY_MS = 500;
  var _restartCount = 0;
  var _restartTimer = 0;
  var _bootOpts = null;

  /* 安全模式：跳過離線結算開機。玩家是從遮罩上主動選進來的，代表前面已經失敗過，
     這時再自動重啟只會蓋掉他想看的錯誤，所以安全模式下不自動重啟。 */
  function safeMode() {
    return typeof location !== 'undefined' && /[?&]safe=1(&|$)/.test(location.search);
  }

  /* Worker 沒了，等在 Promise 上的指令永遠不會有 ACK。不主動 reject 的話，
     UI 那邊的單飛鎖會一直卡著，重啟後對應的按鈕全部按不動。 */
  function rejectPendingCommands(reason) {
    var ids = Object.keys(_pending);
    for (var i = 0; i < ids.length; i++) {
      var p = _pending[ids[i]];
      delete _pending[ids[i]];
      try { p.reject(new Error('worker-restart: ' + reason)); } catch (e) {}
    }
    return ids.length;
  }

  function giveUp(reason) {
    stats.deadReason = reason;
    console.error('[bridge] Worker 已失去回應（' + reason + '）且自動重啟 ' + MAX_RESTARTS +
      ' 次仍失敗。模擬與自動存檔已停止，請重新載入頁面；' +
      '若重複發生，請用安全模式（網址加 &safe=1）開機並匯出存檔。');
    emit('workerDead', { reason: reason, at: Date.now(), restarts: _restartCount, gaveUp: true });
  }

  function restartWorker(reason) {
    if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = 0; }
    if (_worker) {
      _worker.onmessage = null;
      _worker.onerror = null;
      try { _worker.terminate(); } catch (e) {}
      _worker = null;
    }
    _started = false;
    stats.booted = false;
    stats.bootedAt = 0;
    _probeAt = 0;

    /* 重新從儲存讀出存檔，而不是沿用開機時那份：Worker 死掉前可能已經存過好幾次，
       用開機那份會把中間的進度全部丟掉。讀不到就退回開機那份。 */
    var fallback = _bootOpts || {};
    var relaunch = function (save, maxRunId) {
      if (!start({ save: save || fallback.save || null,
                   maxRunId: maxRunId || fallback.maxRunId || 1,
                   _isRestart: true })) {
        giveUp(reason + '（重啟時無法建立 Worker）');
      }
    };
    if (typeof SaveStorage !== 'undefined' && typeof SaveStorage.readBootSave === 'function') {
      try {
        SaveStorage.readBootSave(function (save) {
          relaunch(save, (typeof SaveStorage.maxRunId === 'function') ? SaveStorage.maxRunId() : 0);
        });
        return;
      } catch (e) {}
    }
    relaunch(null, 0);
  }

  function markWorkerDead(reason) {
    if (!stats.alive) return; // 只報一次
    stats.alive = false;
    stats.deadReason = reason;

    var dropped = rejectPendingCommands(reason);

    if (safeMode() || _restartCount >= MAX_RESTARTS) {
      giveUp(reason);
      return;
    }

    _restartCount++;
    console.warn('[bridge] Worker 失去回應（' + reason + '），自動重啟第 ' + _restartCount +
      '／' + MAX_RESTARTS + ' 次' + (dropped ? '，已取消 ' + dropped + ' 筆進行中的指令' : '') + '。');
    emit('workerRestarting', { reason: reason, at: Date.now(), attempt: _restartCount, max: MAX_RESTARTS });
    if (_restartTimer) clearTimeout(_restartTimer);
    _restartTimer = setTimeout(function () { _restartTimer = 0; restartWorker(reason); }, RESTART_DELAY_MS);
  }

  function watchdog() {
    if (!_worker || !stats.booted || !stats.alive) return;
    // PiP 在隱藏期間開關不會觸發 visibilitychange，這裡補送
    if (miniMonitorActive() !== _pipLast) postVisibility();
    /* 撐過這段時間就把連續失敗計數歸零。玩很久之後偶爾各壞一次，不該累積成放棄；
       真正的存檔問題會在開機後很快連續復發，撐不到這個門檻。 */
    if (_restartCount > 0 && stats.bootedAt && Date.now() - stats.bootedAt > HEALTHY_UPTIME_MS) {
      console.info('[bridge] Worker 已穩定運作 ' + Math.round(HEALTHY_UPTIME_MS / 1000) +
        ' 秒，重啟計數歸零。');
      _restartCount = 0;
    }
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
    var isRestart = !!opts._isRestart;
    if (!isRestart) { _bootOpts = { save: opts.save || null, maxRunId: opts.maxRunId || 1 }; }
    /* 重啟時先把 alive 拉回來，否則新 Worker 的第一則訊息會走進 onMessage 的
       誤判自我修復分支，對玩家喊「先前的失效判定為誤判」——這次不是誤判。 */
    if (isRestart) { stats.alive = true; stats.deadReason = null; }
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
    post(MSG_IN.BOOT, {
      save: opts.save || null, now: Date.now(),
      maxRunId: opts.maxRunId || 1, safeMode: safeMode()
    });

    // 初始狀態也要送：分頁若在隱藏狀態下被載入，visibilitychange 不會觸發，
    // Worker 會以為自己在前景而持續全速模擬（main.js 的 _hiddenAt 初始化同理）
    postVisibility();
    // 重啟時不重複註冊：監聽器掛在 document 上，不隨 Worker 消滅
    if (!_visibilityBound) {
      _visibilityBound = true;
      document.addEventListener('visibilitychange', function () {
        // 切回前景時重置靜默計時：隱藏期間沒有訊息是正常的，不能算進去
        if (!document.hidden) { _lastMessageAt = Date.now(); _probeAt = 0; }
        postVisibility();
      });
    }

    _watchdogTimer = setInterval(watchdog, STALL_CHECK_MS);
    if (isRestart) {
      console.info('[bridge] Worker 已重啟（第 ' + _restartCount + '／' + MAX_RESTARTS + ' 次）。');
      emit('workerRestarted', { at: Date.now(), attempt: _restartCount, max: MAX_RESTARTS });
    } else {
      console.info('[bridge] Worker 已啟動' + (opts.save ? '' : '（拋棄式狀態，不讀寫玩家存檔）') +
        (safeMode() ? '｜安全模式：略過離線結算' : '') +
        '。輸入 WorkerBridge.status() 查看狀態。');
    }
    return true;
  }

  function stop() {
    if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = 0; }
    if (_restartTimer) { clearTimeout(_restartTimer); _restartTimer = 0; }
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
      safeMode: safeMode(),
      restarts: _restartCount,
      maxRestarts: MAX_RESTARTS,
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

  /* P5 起 Worker 是唯一路徑，舊單執行緒路徑已移除。
     保留這支函式是因為 gm.js 等處還在問，恆真即可；日後可一併清掉。 */
  function enabled() {
    return true;
  }

  return {
    start: start, stop: stop, send: send, on: on, loadSave: loadSave,
    requestPanel: requestPanel, status: status, enabled: enabled, safeMode: safeMode
  };
})();

/* ---- 開機 ----
   Worker 是模擬與存檔的唯一權威：以玩家的真實存檔開機，並負責之後所有存檔寫入。
   主執行緒只把存檔讀出來交過去，自己不 migrate、不結算、不持有 G（見 main.js）。

   刻意先於 main.js 的 DOMContentLoaded 監聽器註冊：Worker 越早開機，
   面板越早抵達，initUI() 之後畫面空白的時間就越短。 */
(function () {
  window.addEventListener('DOMContentLoaded', function () {
    SaveStorage.readBootSave(function (save) {
      WorkerBridge.start({ save: save, maxRunId: SaveStorage.maxRunId() });
    });
  });
})();
