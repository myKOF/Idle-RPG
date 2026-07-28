'use strict';
/* ============ 多分頁互斥（主執行緒）============
   ---- 為什麼需要 ----
   Worker 是模擬與存檔的唯一權威，但那個「唯一」只在單一分頁內成立：一個分頁一顆
   Worker，開兩個分頁就是兩顆各自模擬、各自每 15 秒把整份狀態寫進同一個 auto_current
   （IndexedDB 同一個 key、存檔資料夾同一個 IC_autosave.json），後寫的整份蓋掉先寫的。
   實測兩個分頁跑 50 秒後分別是 Lv.3／金 3,445／第 1 關與 Lv.4／金 4,935／第 7 關，
   關掉其中一個再重載，另一個那幾十秒的進度就消失了。

   ---- 為什麼用 navigator.locks ----
   它是唯一具備互斥語意的選項，作用域是「同一瀏覽器 profile 內的同源」，與 IndexedDB
   的作用域一致——正好涵蓋會互相覆蓋的範圍，不多也不少。而且分頁當掉、當機或被瀏覽器
   丟棄時，鎖由瀏覽器自動釋出，不會留下沒人解得開的鎖（localStorage 自製鎖做不到這點，
   一定得配過期時間，而過期時間一旦短於玩家的分頁凍結時間就會誤放行）。

   BroadcastChannel 只負責「通知另一個分頁該讓位了」，不參與判定。它沒有互斥語意，
   拿它當鎖必然有競態。

   ---- 唯一狀態規則 ----
   拿不到鎖的分頁**完全不初始化遊戲**：不建 Worker、不 initUI、不讀存檔，只有遮罩。
   所以「取得控制權的分頁」永遠是一個剛載入、還沒跑過任何東西的頁面，
   不存在「舊畫面殘留」或「兩份 UI 狀態」要處理。讓位的分頁則落地後直接 reload，
   回到同一條路徑上。 */

var TabLock = (function () {
  var LOCK_NAME = 'idle-rpg-sim';
  var CHANNEL_NAME = 'idle-rpg-tabs';
  var MSG_YIELD = 'yield-request';

  /* 讓位後 reload 回來的分頁不得自動搶鎖：接管方是輪詢取得鎖的，中間有幾十毫秒的空窗，
     讓位方若在重載後立刻搶，兩個分頁會來回互搶。旗標放 sessionStorage（每分頁獨立），
     設 TTL 是因為玩家也可能隔很久才自己按 F5，那時該恢復正常搶鎖。 */
  var YIELD_FLAG_KEY = 'idlerpg.tablock.yielded';
  var YIELD_FLAG_TTL_MS = 30000;

  var POLL_MS = 250;
  var TAKEOVER_TIMEOUT_MS = 10000;

  var _initFns = [];
  var _inited = false;
  var _holder = false;
  var _releaseLock = null;   // 呼叫即釋出 Web Lock
  var _channel = null;
  var _yielding = false;
  var _overlay = null;
  var _pollTimer = 0;

  function supported() {
    return typeof navigator !== 'undefined' && navigator.locks &&
      typeof navigator.locks.request === 'function';
  }

  /* ---- 遮罩 ----
     樣式沿用 ui.js 既有的 worker-dead-notice（同一套視覺語言，不另立一套）。
     這裡不寫進 ui.js 是因為那支檔案由 Codex 負責，而且遮罩必須在 initUI 之前就能顯示。 */
  function ensureOverlay() {
    if (_overlay) return _overlay;
    var overlay = document.createElement('div');
    overlay.id = 'tab-lock-notice';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100001;display:flex;align-items:center;' +
      'justify-content:center;padding:24px;background:rgba(3,7,18,.92);';

    var card = document.createElement('div');
    card.style.cssText = 'width:min(520px,100%);padding:24px;border:1px solid #f59e0b;border-radius:14px;' +
      'background:#111827;color:#f9fafb;box-shadow:0 20px 60px rgba(0,0,0,.55);text-align:center;';

    var title = document.createElement('h2');
    title.id = 'tab-lock-title';
    title.style.cssText = 'margin:0 0 12px;color:#fcd34d;';

    var desc = document.createElement('p');
    desc.id = 'tab-lock-desc';
    desc.style.cssText = 'margin:0 0 18px;line-height:1.65;';

    var btn = document.createElement('button');
    btn.id = 'tab-lock-btn';
    btn.type = 'button';
    btn.className = 'btn';
    btn.addEventListener('click', function () { requestTakeover(); });

    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(btn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    _overlay = overlay;
    return overlay;
  }

  function setOverlay(title, desc, btnText) {
    ensureOverlay();
    document.getElementById('tab-lock-title').textContent = title;
    document.getElementById('tab-lock-desc').textContent = desc;
    var btn = document.getElementById('tab-lock-btn');
    if (btnText) {
      btn.textContent = btnText;
      btn.disabled = false;
      btn.style.display = '';
      btn.focus();
    } else {
      btn.disabled = true;
      btn.style.display = 'none';
    }
    // Loading 動畫留在遮罩底下會一直轉，玩家會以為還在載入
    if (typeof hideLoadingScreen === 'function') hideLoadingScreen();
  }

  function removeOverlay() {
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;
  }

  function showBusy() {
    setOverlay('🔒 遊戲已在另一個分頁進行中',
      '同時用兩個分頁遊玩會讓兩邊的進度互相覆蓋，所以這個分頁先停在這裡。' +
      '按下按鈕即可把控制權接過來——另一個分頁會先保存進度再停止，不會掉東西。',
      '在此分頁接管');
  }

  /* ---- 初始化 ----
     bridge.js 與 main.js 把各自的開機工作註冊進來，取得控制權時才依序執行。
     順序即註冊順序：bridge 先（Worker 越早開機，畫面空白越短），main 後。 */
  function onGranted(fn) {
    if (_inited) { fn(); return; }
    _initFns.push(fn);
  }

  function runInit() {
    if (_inited) return;
    _inited = true;
    removeOverlay();
    for (var i = 0; i < _initFns.length; i++) {
      try { _initFns[i](); }
      catch (e) { console.error('[tablock] 初始化失敗：', e); }
    }
  }

  /* 取得鎖就一直握著：回呼回傳的 Promise 未解決前，瀏覽器不會把鎖給別人。
     cb(true) 代表已成為控制分頁。 */
  function tryAcquire(cb) {
    navigator.locks.request(LOCK_NAME, { ifAvailable: true }, function (lock) {
      if (!lock) { cb(false); return; }
      _holder = true;
      var held = new Promise(function (resolve) { _releaseLock = resolve; });
      try { cb(true); } catch (e) { console.error('[tablock] 取得控制權後初始化失敗：', e); }
      return held;
    }).catch(function (e) {
      console.error('[tablock] 取鎖失敗：', e);
      cb(false);
    });
  }

  function channel() {
    if (_channel) return _channel;
    if (typeof BroadcastChannel !== 'function') return null;
    try {
      _channel = new BroadcastChannel(CHANNEL_NAME);
      _channel.onmessage = onChannelMessage;
    } catch (e) { _channel = null; }
    return _channel;
  }

  function broadcast(msg) {
    var ch = channel();
    if (ch) { try { ch.postMessage(msg); } catch (e) {} }
  }

  function onChannelMessage(ev) {
    var data = ev && ev.data;
    if (!data || data.type !== MSG_YIELD) return;
    if (!_holder || _yielding) return;
    yieldControl();
  }

  /* ---- 讓位 ----
     必須「先落地、後放手」：接管方是在拿到鎖之後才去讀存檔的，若這裡先放手再存檔，
     就會重演 e85ff42 那個競態——舊資料在新分頁讀完之後才寫進去。

     落地完成後直接 reload：這顆分頁的 Worker 已經停了，畫面上的數值全部凍結在讓位那一刻，
     留著只會誤導玩家。重載後它會走一般流程發現鎖被別人持有，顯示「已在另一個分頁進行中」，
     想要回來按接管即可——只有一條路徑，不必為「讓位中」另外維護一種狀態。 */
  function yieldControl() {
    _yielding = true;
    setOverlay('🔄 正在把控制權交給另一個分頁…', '正在保存目前進度，請稍候。', null);
    var finish = function () {
      try { sessionStorage.setItem(YIELD_FLAG_KEY, String(Date.now())); } catch (e) {}
      if (_releaseLock) { _releaseLock(); _releaseLock = null; }
      _holder = false;
      location.reload();
    };
    if (typeof WorkerBridge !== 'undefined' && typeof WorkerBridge.handoff === 'function') {
      WorkerBridge.handoff(finish);
    } else {
      finish();
    }
  }

  /* 讓位後重載回來的第一次載入不搶鎖，直接顯示遮罩（見 YIELD_FLAG_KEY 註解）。 */
  function consumeYieldFlag() {
    var raw = null;
    try {
      raw = sessionStorage.getItem(YIELD_FLAG_KEY);
      sessionStorage.removeItem(YIELD_FLAG_KEY);
    } catch (e) { return false; }
    if (!raw) return false;
    var at = Number(raw);
    return isFinite(at) && (Date.now() - at) < YIELD_FLAG_TTL_MS;
  }

  /* ---- 接管 ----
     廣播讓位要求後輪詢搶鎖，而不是排隊等鎖：排隊的請求會在「持有者哪天關掉分頁」時
     突然被授予，那時玩家早就不在這個分頁了，等於在背景默默開了一局。輪詢逾時就收手，
     狀態永遠停在玩家看得到的地方。 */
  function requestTakeover() {
    if (_holder || _inited) return;
    setOverlay('⏳ 正在要求另一個分頁交出控制權…', '另一個分頁會先保存進度再停止，通常一兩秒內完成。', null);
    broadcast({ type: MSG_YIELD, at: Date.now() });
    var deadline = Date.now() + TAKEOVER_TIMEOUT_MS;
    var poll = function () {
      _pollTimer = 0;
      tryAcquire(function (ok) {
        if (ok) { runInit(); return; }
        if (Date.now() >= deadline) {
          setOverlay('⚠️ 另一個分頁沒有回應',
            '它可能已被瀏覽器凍結，或正在忙。請直接關閉另一個分頁後再試一次。',
            '再試一次');
          return;
        }
        _pollTimer = setTimeout(poll, POLL_MS);
      });
    };
    poll();
  }

  function start() {
    if (!supported()) {
      /* 沒有 Web Locks 就沒有可靠的互斥手段。這時擋下遊戲的代價（完全不能玩）
         遠大於多分頁覆蓋的風險（要玩家自己開兩個分頁才會發生），所以照常開機並留下警告。 */
      console.warn('[tablock] 此瀏覽器不支援 navigator.locks，多分頁保護未啟用；請勿同時開啟兩個遊戲分頁。');
      runInit();
      return;
    }
    channel(); // 提早訂閱：成為控制分頁後才會用到，但註冊成本極低
    if (consumeYieldFlag()) { showBusy(); return; }
    tryAcquire(function (ok) {
      if (ok) runInit();
      else showBusy();
    });
  }

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  return {
    onGranted: onGranted,
    isHolder: function () { return _holder; },
    /* 測試與除錯用 */
    _internal: {
      start: start,
      requestTakeover: requestTakeover,
      yieldControl: yieldControl,
      lockName: LOCK_NAME,
      channelName: CHANNEL_NAME
    }
  };
})();
