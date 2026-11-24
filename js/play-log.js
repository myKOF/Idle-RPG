'use strict';
/* ============ 真人遊玩記錄（遊戲端）============

   目的：把「你自己實際怎麼玩」一邊玩一邊記到硬碟，拿來跟縮時模擬的策略對照、改策略。
   落地由桌面外殼負責（electron/play-log.cjs），格式與用法見 docs/PLAY_LOG.md。

   ---- 什麼時候啟用 ----
   只有桌面版的 window.ApexHost.playLog.status() 回 enabled:true 時——也就是
   「啟動桌面版(內測).bat」（--internal，原始碼執行）。網頁版沒有 ApexHost，
   一般桌面版與打包版回 enabled:false，本檔整個不做事。

   ---- 和 js/recorder.js 的差別 ----
   recorder 是為「完全重播」：要 ?seed=N、擋存檔、手動匯出。這裡是「觀察」：
   照常存檔、照常亂數、自動落地，不追求重現同一場，所以可以錄你真正在玩的那一局。

   ---- 記什麼（一行一筆 JSON，k 是種類）----
     session  啟用時一筆：協議版本、遊戲版本旗標
     boot     Worker 開機：離線結算摘要
     cmd      每個玩家操作：指令名、參數、成功與否／失敗原因。
              js/bridge.js 的 send() 是所有玩家操作唯一的出口，鉤子掛在那裡才不會漏。
     log      遊戲日誌（升級、推關、被擊倒、強化、BOSS、資源不足……）。
              逐筆戰鬥訊息（命中、受擊、擊殺、施法、戰利品、逐件分解）量太大
              （48 小時約 140 萬筆），不逐筆記，改成計數併進下一筆 snap。
     snap     每 60 遊戲秒一筆：tick 視圖（等級、經驗、金幣、場景、關卡、生命……）
              ＋這段期間的計數（擊殺、受擊、戰利品、分解）＋各技能施放次數
     save     每 15 分鐘（現實時間）留一份存檔副本，給模擬器從同一個狀態起跑對照
     persist  手動存檔／重新開局等非自動的落地（只記種類，不複製）

   每筆都帶 t（現實時間毫秒）與 gt（遊戲時間秒，取自最近一則 tick）。 */

var PlayLog = (function () {

  var host = (typeof window !== 'undefined' && window.ApexHost && window.ApexHost.playLog) || null;

  var SNAP_EVERY_GT = 60;              // 遊戲秒
  var SAVE_EVERY_MS = 15 * 60 * 1000;  // 現實時間
  var FLUSH_MS = 5000;
  var FLUSH_LINES = 2000;
  var MAX_PENDING_LINES = 20000;       // 啟用判定前的暫存上限（判定通常在開機前就完成）

  /* 逐筆戰鬥訊息：只計數。鍵是日誌的 cls（js/worker 送出的 log 事件欄位）。 */
  var COUNT_BY_CLS = {
    'log-enemy-damage': 'hitTaken',
    'log-player-attack': 'attack',
    'log-kill': 'kill',
    'log-enemy-skill': 'enemySkill'
  };
  var CAST_RE = /你施放【([^】]+?)(?:\s*Lv\d+)?】/;
  var SALVAGE_RE = /^⚒️ 分解 /;

  /* 'pending'：桌面外殼存在、還在等 status() 回覆，先暫存；'on'：記錄中；'off'：不做事。 */
  var _state = host ? 'pending' : 'off';
  var _buf = [];
  var _sent = Object.create(null);
  var _view = null;
  var _lastSnapGt = null;
  var _lastSaveAt = 0;
  var _saving = false;
  var _counts = {};
  var _casts = {};
  var _stats = { lines: 0, saves: 0, saveErrors: 0, dir: null };

  function active() { return _state !== 'off'; }

  function gtNow() { return _view && typeof _view.gt === 'number' ? Math.round(_view.gt * 10) / 10 : null; }

  function push(obj) {
    if (_state === 'off') return;
    obj.t = Date.now();
    if (obj.gt === undefined) obj.gt = gtNow();
    var line;
    try { line = JSON.stringify(obj); } catch (e) { line = JSON.stringify({ k: 'unserializable', of: obj.k, t: obj.t }); }
    _buf.push(line);
    if (_state === 'pending' && _buf.length > MAX_PENDING_LINES) _buf.shift();
    if (_state === 'on' && _buf.length >= FLUSH_LINES) flush();
  }

  function flush() {
    if (_state !== 'on' || !_buf.length) return;
    var batch = _buf;
    _buf = [];
    _stats.lines += batch.length;
    try { host.append(batch); } catch (e) { console.warn('[playlog] 寫入失敗：', e); }
  }

  function stripHtml(s) { return String(s == null ? '' : s).replace(/<[^>]+>/g, '').trim(); }

  function bump(map, key) { map[key] = (map[key] || 0) + 1; }

  /* ---- 由 js/bridge.js 的 send() 呼叫 ---- */
  function onSend(id, name, args) {
    if (_state === 'off') return;
    var copy;
    try { copy = args ? JSON.parse(JSON.stringify(args)) : {}; } catch (e) { copy = { __unserializable: true }; }
    _sent[id] = { name: name, args: copy };
  }

  function onAck(msg) {
    var rec = _sent[msg.id];
    if (!rec) return;
    delete _sent[msg.id];
    var line = { k: 'cmd', name: rec.name, args: rec.args, ok: !!msg.ok };
    if (!msg.ok) line.err = msg.error || null;
    push(line);
  }

  function onEvent(e) {
    if (!e) return;
    var kind = e.kind;
    if (kind === 'log' || kind === 'flog') {
      var counted = COUNT_BY_CLS[e.cls];
      if (counted) { bump(_counts, counted); return; }
      if (e.cat === 'loot') { bump(_counts, 'loot'); return; }
      var msg = stripHtml(e.msg);
      var cast = CAST_RE.exec(msg);
      if (cast) { bump(_casts, cast[1]); return; }
      if (kind === 'flog' && SALVAGE_RE.test(msg)) { bump(_counts, 'salvage'); return; }
      if (e.cat === 'combat' && /^DEBUG:/.test(msg)) return;
      push({ k: 'log', kind: kind, cat: e.cat || null, cls: e.cls || null, msg: msg });
    } else if (kind === 'notice') {
      push({ k: 'log', kind: kind, key: e.key || null, msg: stripHtml(e.text) });
    }
  }

  function snap() {
    var line = { k: 'snap', v: _view, counts: _counts, casts: _casts };
    _counts = {};
    _casts = {};
    push(line);
  }

  function onTick(msg) {
    if (_state === 'off') return;
    var view = msg && msg.view;
    if (view) _view = view;
    var ev = msg && msg.events;
    if (ev) for (var i = 0; i < ev.length; i++) onEvent(ev[i]);
    var gt = gtNow();
    if (gt === null) return;
    /* gt 倒退＝讀了別的存檔或重新開局，從那裡重新起算。 */
    if (_lastSnapGt === null || gt < _lastSnapGt || gt - _lastSnapGt >= SNAP_EVERY_GT) {
      _lastSnapGt = gt;
      snap();
    }
  }

  function onBooted(msg) {
    var off = msg && msg.offlineSummary;
    var s = null;
    try { s = off ? JSON.stringify(off) : null; } catch (e) { s = null; }
    push({ k: 'boot', protocol: msg && msg.protocolVersion, offline: s && s.length <= 8192 ? off : (s ? { bytes: s.length } : null) });
  }

  function onPersist(msg) {
    if (_state !== 'on' || !msg || !msg.payload) return;
    var meta = msg.payload.meta || {};
    var kind = msg.kind;
    var isAuto = typeof PERSIST_KINDS !== 'undefined' && (kind === PERSIST_KINDS.AUTO || kind === PERSIST_KINDS.FOLDER);
    if (!isAuto) push({ k: 'persist', kind: kind, level: meta.level, zone: meta.zone, stage: meta.stage });
    var now = Date.now();
    if (_saving || (_lastSaveAt && now - _lastSaveAt < SAVE_EVERY_MS)) return;
    if (typeof msg.payload.json !== 'string') return;
    _saving = true;
    _lastSaveAt = now;
    host.save(msg.payload.json, { level: meta.level }).then(function (file) {
      _stats.saves++;
      push({ k: 'save', file: file, kind: kind, level: meta.level, zone: meta.zone, stage: meta.stage });
    }, function (err) {
      _stats.saveErrors++;
      push({ k: 'saveError', error: err && err.message || String(err) });
    }).then(function () { _saving = false; });
  }

  function start(status) {
    _state = 'on';
    _stats.dir = status && status.dir || null;
    /* session 要排在暫存的那些行前面 */
    var pending = _buf;
    _buf = [];
    push({
      k: 'session',
      protocol: typeof WORKER_PROTOCOL_VERSION !== 'undefined' ? WORKER_PROTOCOL_VERSION : null,
      edition: typeof GAME_EDITION !== 'undefined' ? GAME_EDITION : null
    });
    _buf = _buf.concat(pending);
    flush();
    setInterval(flush, FLUSH_MS);
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('beforeunload', flush);
      window.addEventListener('pagehide', flush);
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });
    }
    console.info('[playlog] 遊玩記錄啟用：' + String(_stats.dir));
  }

  function stop() {
    _state = 'off';
    _buf = [];
    _sent = Object.create(null);
  }

  /* ---- 啟用 ----
     先同步訂閱（開機訊息可能比 status() 回覆早到），判定前的資料暫存在 _buf。 */
  if (_state === 'pending') {
    if (typeof WorkerBridge === 'undefined' || !WorkerBridge.on || typeof MSG_OUT === 'undefined') {
      console.warn('[playlog] WorkerBridge / MSG_OUT 尚未載入，js/play-log.js 必須排在 js/bridge.js 之後。');
      stop();
    } else {
      WorkerBridge.on(MSG_OUT.TICK, onTick);
      WorkerBridge.on(MSG_OUT.ACK, onAck);
      WorkerBridge.on(MSG_OUT.BOOTED, onBooted);
      WorkerBridge.on(MSG_OUT.PERSIST, onPersist);
      Promise.resolve().then(function () { return host.status(); }).then(function (s) {
        if (s && s.enabled) start(s); else stop();
      }, function () { stop(); });
    }
  }

  return {
    active: active,
    onSend: onSend,
    flush: flush,
    /* 給主控台用：PlayLog.stats() 看目前記到多少、存在哪 */
    stats: function () {
      return { state: _state, lines: _stats.lines + _buf.length, saves: _stats.saves, saveErrors: _stats.saveErrors, dir: _stats.dir };
    }
  };
})();
