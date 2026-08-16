'use strict';
/* ============ 卡頓探針（診斷用，預設完全不啟用）============
   用法：內測服網址加 ?lag=1，例如 http://localhost:5500/index.html?lag=1
   之後每 15 秒自動在 Console 印一次報告；隨時可手動執行 lagReport() 立刻印一次，
   lagReset() 歸零重新計時。

   為什麼要做進遊戲裡而不是叫人貼 Console 片段：Chrome 對「貼程式碼進 Console」
   有防呆（要先手動輸入 allow pasting），回報者踩到時只會看到 not defined，
   完全不知道發生什麼事。加上這個旗標之後，回報卡頓只要換一次網址。

   安全邊界與 js/gm_exec.js 一致：只在本機／內網開啟，正式環境即使加了參數也不動作，
   而且沒有這個參數時本檔一行都不執行——不包裝任何函式、不攔任何屬性。

   ---- 為什麼重點是「強制版面重算」的**次數** ----
   卡頓回報最難處理的是「我這台不卡」。單次耗時取決於機器快慢，比不了；
   但「一秒鐘強制瀏覽器重算幾次版面」是程式行為，兩台機器上是同一個數字。
   而重算一次的成本又取決於整份文件多大（後期背包會把上千個格子掛在版面樹上），
   所以「次數 × 文件大小」才是真正的卡頓來源，這支探針兩個都量。 */

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!/[?&]lag=1(&|$)/.test(location.search || '')) return;

  var host = location.hostname || '';
  var internal = location.protocol === 'file:' || host === 'localhost' ||
    host === '127.0.0.1' || host === '::1' || host === '[::1]' ||
    /^192\.168\./.test(host) || /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (!internal) return;

  var P = { fn: {}, layout: {}, layoutTotal: 0, long: [], cmd: {}, t0: 0, grow: {}, timers: 0, timersPeak: 0 };

  /* ---- 成長追蹤 ----
     用來抓「一旦開始卡就回不去，只有 F5 會好」這類累積型問題。

     ⚠️ 判準看的是**近期最低點**，不是目前值。第一版拿「目前 vs 起始」判斷，
     結果 2026-08-16 的實測報告裡整排都標成嫌疑犯——因為戰鬥中場上有 68 隻怪、
     138 個特效，本來就該比待機時高。戰鬥一結束全部回落，根本沒有洩漏。
     真正的洩漏長的是**地板**：連最閒的那一刻都回不到原本的水位。
     所以這裡記一個滑動窗的最低值，只有「地板持續墊高」才標記。 */
  var GROW_WINDOW = 8;   // 保留最近 8 份報告 ≈ 2 分鐘，要夠長才蓋得住一場戰鬥
  function track(name, value) {
    if (typeof value !== 'number' || !isFinite(value)) return;
    var s = P.grow[name] || (P.grow[name] = { first: value, max: value, now: value, win: [] });
    s.now = value;
    if (value > s.max) s.max = value;
    s.win.push(value);
    if (s.win.length > GROW_WINDOW) s.win.shift();
    s.floor = Math.min.apply(null, s.win);
  }

  /* 未結束的計時器數量。特效與飄字的延遲全靠 setTimeout，
     若某條路徑只排程不執行（或排程速度長期高於觸發速度），這個數字會一路長大。 */
  function wrapTimers() {
    var st = window.setTimeout, ct = window.clearTimeout;
    if (!st || st.__lagWrapped) return;
    var wrapped = function (fn, ms) {
      var args = Array.prototype.slice.call(arguments, 2);
      P.timers++;
      if (P.timers > P.timersPeak) P.timersPeak = P.timers;
      return st(function () {
        P.timers--;
        if (typeof fn === 'function') fn.apply(null, args);
      }, ms);
    };
    wrapped.__lagWrapped = true;
    window.setTimeout = wrapped;
    window.clearTimeout = function (id) { if (P.timers > 0) P.timers--; return ct(id); };
  }

  function bump(bucket, key, ms) {
    var s = bucket[key] || (bucket[key] = { n: 0, ms: 0, max: 0 });
    s.n++;
    if (ms !== undefined) { s.ms += ms; if (ms > s.max) s.max = ms; }
  }

  /* 讀取者歸戶：往上找第一個不是本檔的函式名。抓不到名字（匿名回呼）就記 (anonymous)，
     那本身也是線索——代表呼叫點在某個 callback 裡。 */
  function blame() {
    var stack = '';
    try { stack = new Error().stack || ''; } catch (e) { return '(no-stack)'; }
    var lines = stack.split('\n');
    /* 用「檔名」跳過本檔自己的框架，不要用函式名。
       第一版是比對函式名裡有沒有 blame／lagprobe，結果攔截器本身叫 countLayout，
       兩個條件都不符合，於是每一列都歸戶到 countLayout——報告等於白做。
       本檔的框架一定帶 lagprobe.js，用它判斷不會漏。 */
    for (var i = 1; i < lines.length && i < 12; i++) {
      if (lines[i].indexOf('lagprobe.js') >= 0) continue;
      var m = /at\s+(?:new\s+|async\s+)?([A-Za-z_$][\w$.]*)\s/.exec(lines[i]);
      if (m) return m[1];
      if (/at\s+(?:https?:|<|\()/.test(lines[i])) return '(匿名回呼)';
    }
    return '(anonymous)';
  }

  function countLayout(what) {
    P.layoutTotal++;
    bump(P.layout, blame() + ' → ' + what);
  }

  /* ---- 攔截會強制版面重算的讀取 ---- */
  var origRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    countLayout('getBoundingClientRect');
    return origRect.apply(this, arguments);
  };
  ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'offsetParent',
   'clientWidth', 'clientHeight', 'scrollHeight', 'scrollWidth'].forEach(function (prop) {
    var proto = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)
      ? HTMLElement.prototype : Element.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || !desc.get) return;
    Object.defineProperty(proto, prop, {
      configurable: true,
      get: function () { countLayout(prop); return desc.get.call(this); }
    });
  });
  var origComputed = window.getComputedStyle;
  window.getComputedStyle = function () {
    countLayout('getComputedStyle');
    return origComputed.apply(this, arguments);
  };

  /* ---- 主執行緒長工作 ---- */
  try {
    /* 連同「發生在第幾秒」一起記。只有時長的話分不出那筆 954ms 是載入期的
       一次性成本，還是戰鬥中真的凍住——這兩件事的處理方式完全不同。
       秒數以分頁載入為起點（e.startTime 的基準），不是探針啟動時間。 */
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        P.long.push({ ms: Math.round(e.duration), at: Math.round(e.startTime / 1000) });
      });
      if (P.long.length > 500) P.long.splice(0, 250);
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) {}

  /* ---- 各渲染函式耗時 ---- */
  /* 觀察名單。漏掉一支的代價是「那條路徑在報告裡完全不存在」，而讀報告的人會把
     「沒出現」誤讀成「很快」。實際發生過：回報寶石頁卡頓，但點寶石放進九宮格走的是
     renderGemConvert，當時不在名單上，於是整份報告看起來寶石頁毫無問題。
     新增頁面渲染函式時記得一併加進來。 */
  var TARGETS = ['renderHeader', 'renderBattle', 'renderInventory', 'renderEquip', 'renderDetail',
    'renderForge', 'renderForgeInventoryCells', 'renderNewForge', 'renderSkills', 'renderTalents',
    'renderTower', 'renderTowerFight', 'renderStatsPanel', 'updateSelectionUI', 'syncItemGridCells',
    'inventoryGridSnapshotEqual', 'applyInventoryVisibleRows', 'fitEnemyNames', 'rebuildEnemyParty',
    'flushWorkerVisualEvents', 'handleWorkerUiEvents', 'flushPendingLogDom', 'playCombatVfx',
    'floatText', 'placeFloatAvoidingOverlap', 'showItemTooltip', 'showStatTooltip',
    'renderAttrPanel', 'uiTick',
    // 寶石頁：整支與各子區塊分開量，才看得出是哪一塊慢
    'renderGems', 'renderGemConvert', 'renderGemFusion', 'renderGemShop', 'renderGemDismantle',
    'renderFuseInfo', 'updateShopCountdown'];

  function wrapAll() {
    TARGETS.forEach(function (name) {
      var f = window[name];
      if (typeof f !== 'function' || f.__lagWrapped) return;
      var g = function () {
        var t0 = performance.now();
        try { return f.apply(this, arguments); }
        finally { bump(P.fn, name, performance.now() - t0); }
      };
      g.__lagWrapped = true;
      window[name] = g;
    });
  }

  /* ---- 使用者真正感受到的延遲：按鈕按下 → 按鈕重新可用 ---- */
  function wrapCommands() {
    if (typeof window.acquireUiPending !== 'function' || window.acquireUiPending.__lagWrapped) return;
    var acq = window.acquireUiPending, rel = window.releaseUiPendingToken;
    var wa = function (name) {
      var r = acq.apply(this, arguments);
      if (r && r.entry) { r.entry.__lagAt = performance.now(); r.entry.__lagName = name; }
      return r;
    };
    wa.__lagWrapped = true;
    window.acquireUiPending = wa;
    window.releaseUiPendingToken = function (token) {
      var e = window.UI_COMMAND_PENDING && UI_COMMAND_PENDING.byToken[token];
      if (e && e.__lagAt) bump(P.cmd, e.__lagName, performance.now() - e.__lagAt);
      return rel.apply(this, arguments);
    };
  }

  function rows(bucket, withMs) {
    return Object.keys(bucket).map(function (k) {
      var s = bucket[k];
      var row = { '項目': k, '次數': s.n };
      if (withMs) {
        row['平均ms'] = +(s.ms / s.n).toFixed(1);
        row['最大ms'] = +s.max.toFixed(1);
        row['佔用ms'] = Math.round(s.ms);
      }
      return row;
    }).sort(function (a, b) { return (b['佔用ms'] || b['次數']) - (a['佔用ms'] || a['次數']); });
  }

  window.lagReport = function () {
    var sec = (performance.now() - P.t0) / 1000;
    if (sec <= 0) return '尚未開始計時';
    var busy = P.long.reduce(function (a, b) { return a + b.ms; }, 0);
    var inv = (window.UI_WORKER_STATE && UI_WORKER_STATE.panels.inv) || {};
    var st = (window.WorkerBridge && WorkerBridge.status) ? WorkerBridge.status() : {};
    console.log('%c===== 卡頓探針 ' + sec.toFixed(0) + ' 秒 =====', 'font-weight:bold');
    console.log('分頁 ' + (window.UI ? UI.tab : '?') +
      ' ｜ 背包 ' + inv.count + '/' + inv.cap +
      ' ｜ DOM ' + document.getElementsByTagName('*').length +
      ' ｜ 背包格子 ' + document.querySelectorAll('.item-cell').length +
      ' ｜ 敵人 ' + document.querySelectorAll('.enemy-card').length);
    console.log('Worker: catchup=' + st.catchupSec + 's ticks=' + st.ticks +
      ' errors=' + st.errors + ' restarts=' + st.restarts + ' pending=' + st.pendingCommands);
    console.log('%c強制版面重算 ' + P.layoutTotal + ' 次（每秒 ' +
      (P.layoutTotal / sec).toFixed(0) + ' 次）', 'color:#c00;font-weight:bold');
    console.log('主執行緒長工作(>50ms)：' + P.long.length + ' 次 / 共 ' + busy +
      ' ms / 卡住 ' + (busy / (sec * 1000) * 100).toFixed(1) + '% 的時間　最大幾筆（時長@發生秒數）：' +
      P.long.slice().sort(function (a, b) { return b.ms - a.ms; }).slice(0, 8)
        .map(function (e) { return e.ms + 'ms@' + e.at + 's'; }).join(', '));
    /* ---- 成長追蹤：抓「回不去」的累積型卡頓 ---- */
    var br = (window.BattleRenderer && BattleRenderer.status) ? BattleRenderer.status() : null;
    if (br) {
      track('渲染器 特效(fx)', br.fx);
      track('渲染器 飄字(floats)', br.floats);
      track('渲染器 敵人實體', br.entities);
      track('渲染器 殘留座標(lastPos)', br.lastPos);
      track('渲染器 飄字合併表', br.floatMerge);
      track('渲染器 貼圖快取(imgTex)', br.imgTex);
      if (br.nodes) {
        track('節點 特效層', br.nodes.fx);
        track('節點 實體層', br.nodes.entity);
        track('節點 飄字層', br.nodes.float);
        track('節點 覆蓋層', br.nodes.overlay);
      }
    }
    track('DOM 節點總數', document.getElementsByTagName('*').length);
    track('未結束計時器', P.timers);
    track('Worker 待處理指令', st.pendingCommands);
    track('Worker 落後秒數', st.catchupSec);

    var growRows = Object.keys(P.grow).map(function (k) {
      var g = P.grow[k];
      /* 洩漏＝地板墊高：近兩分鐘裡最閒的那一刻都回不到起始水位。
         窗口沒填滿前不判定，否則開場幾份報告一定誤判。 */
      var floor = (g.floor === undefined) ? g.now : g.floor;
      var suspect = g.win.length >= GROW_WINDOW &&
        floor > g.first + 5 && floor > g.first * 1.5;
      return { '項目': k, '起始': g.first, '目前': g.now, '最大': g.max,
               '近期最低': floor, '疑似洩漏': suspect ? '★ 是' : '' };
    }).sort(function (a, b) { return (b['近期最低'] - b['起始']) - (a['近期最低'] - a['起始']); });
    console.log('%c--- 成長追蹤（看「近期最低」這欄：洩漏長的是地板，不是尖峰）---',
      'color:#c60;font-weight:bold');
    console.table(growRows);
    console.log('計時器峰值 ' + P.timersPeak + ' 個');

    if (Object.keys(P.cmd).length) { console.log('--- 按鈕延遲（按下→可再按）---'); console.table(rows(P.cmd, true)); }
    console.log('--- 誰在強制版面重算（次數）---'); console.table(rows(P.layout, false).slice(0, 15));
    console.log('--- 各函式耗時 ---'); console.table(rows(P.fn, true).slice(0, 15));
    /* 截圖之外的第二條回報管道：截圖會漏掉被 console.table 摺疊的列，
       而回報者通常不會想到要展開。整包資料留在這裡，需要時 copy(__lagData) 就能貼純文字。 */
    window.__lagData = {
      sec: +sec.toFixed(0), tab: window.UI ? UI.tab : null,
      bag: inv.count + '/' + inv.cap,
      dom: document.getElementsByTagName('*').length,
      cells: document.querySelectorAll('.item-cell').length,
      enemies: document.querySelectorAll('.enemy-card').length,
      worker: { catchup: st.catchupSec, ticks: st.ticks, errors: st.errors, restarts: st.restarts },
      layoutTotal: P.layoutTotal, longTasks: P.long.slice(),
      renderer: br, timers: P.timers, timersPeak: P.timersPeak, grow: growRows,
      cmd: rows(P.cmd, true), layout: rows(P.layout, false).slice(0, 20), fn: rows(P.fn, true).slice(0, 20)
    };
    return '把上面整段截圖回報（或執行 copy(__lagData) 貼純文字）';
  };

  /* 成長追蹤刻意**不**歸零：抓累積型問題要的就是一條夠長的基線，
     中途重設會把「起始值」洗成已經漲上去的數字，等於自廢武功。 */
  window.lagReset = function () {
    P.fn = {}; P.layout = {}; P.layoutTotal = 0; P.long = []; P.cmd = {};
    P.t0 = performance.now();
    return '已歸零，重新計時（成長追蹤的基線保留）';
  };

  function start() {
    wrapAll();
    wrapCommands();
    wrapTimers();
    P.t0 = performance.now();
    console.log('%c[卡頓探針] 已啟用（?lag=1）。每 15 秒自動印一次；lagReport() 立即印，lagReset() 歸零。',
      'color:#0a0;font-weight:bold');
    setInterval(function () { window.lagReport(); }, 15000);
  }

  /* ui.js 的函式要等腳本載入完才存在；DOMContentLoaded 之後一定都在了。 */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
