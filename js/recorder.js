'use strict';
/* ============ 真人操作錄製器 ============

   目的只有一個：把「真人實際怎麼玩」變成可以拿去跟 AI 策略比對的資料。

   在這支之前，「AI 跑起來跟真人有落差」是一句沒有辦法證偽的話——因為只有 AI 那條
   曲線有數字，真人那條沒有。錄下來之後，兩條曲線可以逐點相減，落差才變成
   「Lv.40 之前 AI 快 1.8 倍、之後反而慢」這種可以追下去的東西。

   ---- 錄什麼 ----

     1. 起始存檔    重播必須從同一個狀態開始，否則後面全部不可比
     2. 指令軌跡    {gt, name, args}，gt 是指令**實際執行**當下的遊戲時鐘
     3. 實測樣本    每隔幾個 tick 的 buildView()，這是真人那條曲線的原始資料

   ---- 為什麼 gt 拿得到精確值（這是整支檔案的關鍵）----

   指令是非同步的：主執行緒 post 出去，Worker 不知道在第幾步才處理到。所以主執行緒
   自己蓋的時間戳一定是糊的，糊掉的軌跡重播出來會跟原本那一場完全不同——亂數序列
   只要錯開一步，之後每一次掉落都不一樣。

   但 js/worker/sim.worker.js:1415 有這一行：

       if (r.ok) emitTick(); // 指令有結果就立刻推一次，不必等下個 tick

   Worker 的 onmessage 是同步的，ACK 與這則 tick 之間**不可能插進任何東西**（沒有
   await、沒有計時器能搶進來）。所以「ACK 之後收到的第一則 tick」，它的 view.gt 就是
   那道指令執行當下的遊戲時鐘，精確到步。

   這也是為什麼本檔不需要動 Worker、不需要動協議——精確的時間已經在訊息流裡了。

   ---- 前提：必須開決定論模式 ----

   沒有 ?seed=N 就沒有種子化亂數（見 js/worker/sim.worker.js 的 installTestSeed），
   錄下來的軌跡重播時會走一條完全不同的亂數序列，比對毫無意義。所以缺 seed 時本檔
   拒絕啟用並在畫面上說明原因，不做「錄了但沒用」這種安靜的失敗。

   ---- 錄製不會動到你的存檔 ----

   決定論模式下 requestPersist 會擋掉所有**非自願**的落地（自動存檔、資料夾同步、
   分頁切走），只有玩家明確按下手動存檔或重新開局才會寫。所以錄製期間切分頁、
   關分頁都不會把種子化亂數跑出來的這一局蓋到 auto_current 上。

   （這件事在 2026-08-01 之前是壞的：onVisibility 的 SHUTDOWN 沒有被擋，
     決定論模式檔頭宣稱的「不落地存檔」只涵蓋週期性自動存檔。見 js/worker/sim.worker.js
     的 requestPersist。） */

var PlayRecorder = (function () {

  /* 安全邊界沿用 js/gm_exec.js 與 installTestSeed 的作法：只認本機 hostname，
     不依賴任何前端可覆寫的旗標。 */
  function isLocal() {
    var h = (typeof location !== 'undefined') && location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  }

  function qs(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)(&|$)').exec(
      (typeof location !== 'undefined' && location.search) || ''
    );
    return m ? decodeURIComponent(m[1]) : null;
  }

  var WANTED = isLocal() && qs('record') === '1';
  var SEED = qs('seed');

  /* 樣本密度。每 N 則 tick 收一筆 view，預設 10（決定論模式下 tick 是每 2 步一則，
     所以預設約每 2 遊戲秒一筆）。要做逐點等價驗證時用 ?rowEvery=1 錄一小段就好——
     全程逐 tick 錄兩小時會產生數萬筆，沒有必要。 */
  var ROW_EVERY = Math.max(1, Number(qs('rowEvery') || 10) || 10);

  /* 上限是保險絲，不是靜默截斷：碰到就停止收集並在 meta 標記 truncated，
     畫面上也會變色。寧可讓人看到「這份資料不完整」，也不要讓人拿殘缺資料下結論。 */
  var MAX_ROWS = 200000;
  var MAX_TRACE = 100000;

  var _on = false;
  var _startSave = null;
  var _startSaveTaken = false;
  var _trace = [];
  var _rows = [];
  var _tickCount = 0;
  var _truncated = false;
  /* 這一場有沒有暫停過戰鬥。

     協議 v14 之前這是致命的：暫停時 gt 不前進，而重播只有 gt 這一條軸，
     無從得知暫停了幾步，那一段必定重現不出來。v14 加入 simT（暫停照走）之後
     已經不是問題，但仍然記錄——讀報告的人要看得出這一場有沒有經過那條路徑，
     而且拿舊版遊戲重播這份錄製時它仍然會踩到。 */
  var _pausedTicks = 0;
  var _pauseWindows = 0;
  var _wasPaused = false;
  /* 遊戲的 buildView() 有沒有 simT。沒有＝這份遊戲是協議 v14 之前的版本，
     錄出來的軌跡只能退回 gt 對齊，暫停限制原封不動。 */
  var _hasSimT = null;
  /* id → { name, args }。ACK 帶 id 回來時才知道是哪一道指令。
     用 id 對應而不是靠訊息順序：順序目前確實成立，但那是 Worker 實作細節，
     而 id 是協議明文（js/worker/protocol.js 的 CMD/ACK）。 */
  var _sent = Object.create(null);
  /* 已經收到 ACK、正在等下一則 tick 蓋 gt 的指令。 */
  var _awaitGt = [];
  var _badge = null;

  function active() { return _on; }

  /* ---- 由 js/bridge.js 呼叫的兩個鉤子 ---- */

  /* 開機存檔。Worker 收到的是 structured clone，主執行緒這份不會被改，
     但仍然深拷貝一次凍結它——之後 UI 若持有同一個參照並改動，錄下的起點就錯了。 */
  function onBoot(save) {
    if (!_on || _startSaveTaken) return;
    _startSaveTaken = true;
    try {
      _startSave = save ? JSON.parse(JSON.stringify(save)) : null;
    } catch (e) {
      _startSave = null;
      console.error('[recorder] 起始存檔無法序列化，重播將只能從全新角色開始：', e);
    }
    paint();
  }

  /* 玩家操作。js/bridge.js 的 send() 是所有玩家操作的唯一出口，錄在別處一定會漏。 */
  function onSend(id, name, args) {
    if (!_on) return;
    if (_trace.length + _awaitGt.length >= MAX_TRACE) { truncate(); return; }
    var copy = null;
    try {
      copy = args ? JSON.parse(JSON.stringify(args)) : {};
    } catch (e) {
      /* 參數理應是純資料（validateCommand 只放行純量與陣列），真的序列化不了就
         記下來讓人看到，不要靜靜錄一筆假的。 */
      console.error('[recorder] 指令參數無法序列化：' + name, e);
      copy = { __unserializable: true };
    }
    _sent[id] = { name: name, args: copy };
  }

  /* ---- 由 WorkerBridge.on 訂閱的兩個事件 ---- */

  function onAck(msg) {
    var rec = _sent[msg.id];
    if (!rec) return;                 // 錄製啟用前送出的指令，沒有對應資料
    delete _sent[msg.id];
    rec.ok = !!msg.ok;
    if (!msg.ok) rec.error = msg.error;
    _awaitGt.push(rec);
  }

  function onTick(msg) {
    var view = msg && msg.view;
    if (!view) return;

    /* 這一則就是 sim.worker.js:1415 為成功指令補送的那一則，view.gt 是指令執行
       當下的遊戲時鐘。失敗的指令沒有補送 tick，會被下一則週期 tick 收走，時間戳
       因此偏晚——但失敗的指令沒有改變狀態，也不消耗重播端的亂數，標記出來即可。 */
    while (_awaitGt.length) {
      var rec = _awaitGt.shift();
      _trace.push({
        seq: _trace.length,
        /* 對齊用的是 simT（暫停時照走），gt 一併留著供人閱讀與舊工具相容。
           兩者的差別與為什麼非要 simT 不可，見 js/worker/protocol.js 的 TICK_VIEW_KEYS。 */
        simT: view.simT,
        gt: view.gt,
        name: rec.name,
        args: rec.args,
        ok: rec.ok,
        error: rec.error,
        /* 失敗指令的 gt 不是精確值，重播端據此決定要不要當成對齊點。 */
        gtExact: rec.ok === true,
        /* 執行當下戰鬥是否暫停。多道指令共用同一個 gt 有兩種成因，後果完全不同：
             同一個 tick 內連送     GT 本來就還沒前進，重播會在同一步依序送出，完全重現
             戰鬥暫停了好幾步       GT 整段不動，原本分散在數步的指令會被壓成一步，會分岔
           只有後者是問題。沒有這個欄位就分不出來，只能把兩者一起當成風險回報。 */
        paused: !!view.paused
      });
    }

    if (_hasSimT === null) _hasSimT = (typeof view.simT === 'number');

    /* 暫停偵測看的是每一則 tick，不是取樣後的 rows——取樣密度低時短暫的暫停會被漏掉。
       只有在遊戲沒有 simT（v14 以前）時這才是致命的，但兩種情況都要記錄。 */
    if (view.paused) {
      _pausedTicks++;
      if (!_wasPaused) { _pauseWindows++; _wasPaused = true; }
    } else {
      _wasPaused = false;
    }

    _tickCount++;
    if (_tickCount % ROW_EVERY !== 0) { paint(); return; }
    if (_rows.length >= MAX_ROWS) { truncate(); return; }
    /* 整份 view 都收，不挑欄位：比對的對象是 buildView() 本身
       （scripts/cross_check.js 就是逐欄比對整個 view），挑欄位等於預先決定
       哪些不一致可以被忽略。 */
    _rows.push(view);
    paint();
  }

  function truncate() {
    if (_truncated) return;
    _truncated = true;
    console.warn('[recorder] 已達錄製上限，停止收集。這份資料不完整，meta.truncated = true。');
    paint();
  }

  /* ---- 匯出 ---- */

  function dump() {
    return {
      format: 'idle-rpg-human-trace/1',
      meta: {
        seed: SEED === null ? null : Number(SEED),
        recordedAt: new Date().toISOString(),
        rowEveryTicks: ROW_EVERY,
        ticks: _tickCount,
        truncated: _truncated,
        /* 有幾道指令送出去卻沒等到 ACK。非 0 代表這份軌跡有缺口，重播會對不上。 */
        unacked: Object.keys(_sent).length,
        /* 暫停過幾次、期間經過幾則 tick。搭配 hasSimT 一起看：
           hasSimT 為 true 時暫停無害（simT 照走），false 時這份錄製重播不出來。 */
        pauseWindows: _pauseWindows,
        pausedTicks: _pausedTicks,
        hasSimT: _hasSimT,
        /* startSave 為 null 有兩種意思，重播端的處置完全不同：
             true   開機時本來就沒有存檔＝全新角色。重播從全新角色開始就是對的。
             false  錄製器沒接到開機事件（掛太晚），起點不明。重播出來不會是那一場。
           少了這個旗標，前者會被誤報成後者——而全新角色其實是最常見的錄製情境。 */
        startSaveCaptured: _startSaveTaken,
        userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || null,
        note: '重播：node scripts/run_sim.js --trace=<本檔>'
      },
      startSave: _startSave,
      trace: _trace,
      rows: _rows
    };
  }

  function download() {
    var data = JSON.stringify(dump());
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'human_trace_seed' + (SEED || 'none') + '_' +
      new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /* 立刻 revoke 會讓部分瀏覽器的下載中途失效，延後釋放。 */
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    return data.length;
  }

  /* ---- 畫面上的小徽章 ----
     錄製是有狀態的動作，看不到它在跑就會發生「以為在錄，其實沒開」。
     只在啟用時建立，正式遊玩不會有這段 DOM。 */

  function ensureBadge() {
    if (_badge || typeof document === 'undefined' || !document.body) return;
    _badge = document.createElement('div');
    _badge.style.cssText = [
      'position:fixed', 'right:8px', 'bottom:8px', 'z-index:99999',
      'font:12px/1.5 monospace', 'background:rgba(20,20,24,.92)', 'color:#e8e8ea',
      'border:1px solid #555', 'border-radius:6px', 'padding:6px 8px',
      'pointer-events:auto', 'max-width:280px'
    ].join(';');
    var btn = document.createElement('button');
    btn.textContent = '匯出軌跡';
    btn.style.cssText = 'margin-top:4px;width:100%;cursor:pointer;font:inherit';
    btn.onclick = function () {
      var n = download();
      btn.textContent = '已匯出 ' + Math.round(n / 1024) + ' KB';
      setTimeout(function () { btn.textContent = '匯出軌跡'; }, 3000);
    };
    var txt = document.createElement('div');
    _badge.appendChild(txt);
    _badge.appendChild(btn);
    _badge._txt = txt;
    document.body.appendChild(_badge);
  }

  function paint() {
    ensureBadge();
    if (!_badge) return;
    /* 暫停只有在遊戲沒有 simT（協議 v14 以前）時才是致命的。有 simT 就照走，不必示警——
       對正常情況亂示警，只會讓人學會忽略示警。 */
    var pauseFatal = _pauseWindows > 0 && _hasSimT === false;
    var bad = _truncated || pauseFatal;
    _badge._txt.textContent =
      '● 錄製中  指令 ' + _trace.length + '　樣本 ' + _rows.length +
      (_truncated ? '　⚠已截斷' : '') +
      (_startSaveTaken ? '' : '　⚠未取得起始存檔') +
      (pauseFatal ? '\n⚠ 暫停過 ' + _pauseWindows + ' 次（' + _pausedTicks +
        ' tick），而這份遊戲沒有 simT——這份錄製重播不出來，請重錄且全程不要按暫停戰鬥' : '');
    _badge._txt.style.whiteSpace = 'pre-wrap';
    _badge.style.borderColor = bad ? '#c04' : '#555';
    _badge.style.background = bad ? 'rgba(74,16,32,.95)' : 'rgba(20,20,24,.92)';
  }

  function refuse(reason) {
    console.warn('[recorder] 未啟用：' + reason);
    if (typeof document === 'undefined') return;
    var show = function () {
      if (!document.body) return;
      var d = document.createElement('div');
      d.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99999;' +
        'font:12px/1.5 monospace;background:#4a1020;color:#ffd7e0;border:1px solid #c04;' +
        'border-radius:6px;padding:6px 8px;max-width:300px';
      d.textContent = '錄製未啟用：' + reason;
      document.body.appendChild(d);
    };
    if (document.body) show();
    else document.addEventListener('DOMContentLoaded', show);
  }

  /* ---- 啟用 ---- */

  if (WANTED && !SEED) {
    refuse('缺少 ?seed=N。沒有種子化亂數，錄下來的軌跡重播時會走另一條亂數序列，比對沒有意義。');
  } else if (WANTED && (typeof WorkerBridge === 'undefined' || !WorkerBridge.on || typeof MSG_OUT === 'undefined')) {
    refuse('WorkerBridge / MSG_OUT 尚未載入。js/recorder.js 必須排在 js/bridge.js 與 js/worker/protocol.js 之後。');
  } else if (WANTED) {
    _on = true;
    /* 用協議常數而不是字串字面值：訊息型別改名時這裡會一起壞掉，
       寫死字串則會安靜地再也收不到訊息。 */
    WorkerBridge.on(MSG_OUT.TICK, onTick);
    WorkerBridge.on(MSG_OUT.ACK, onAck);
    console.warn(
      '[recorder] 錄製已啟用（seed=' + SEED + '，樣本每 ' + ROW_EVERY + ' 則 tick 一筆）。\n' +
      '   決定論模式不會做非自願的落地存檔，錄製期間切分頁不會蓋掉你的 auto_current。'
    );
  }

  return {
    active: active,
    onBoot: onBoot,
    onSend: onSend,
    dump: dump,
    download: download,
    /* 給主控台用：PlayRecorder.stats() 看目前錄到多少 */
    stats: function () {
      return { on: _on, trace: _trace.length, rows: _rows.length, truncated: _truncated };
    }
  };
})();
