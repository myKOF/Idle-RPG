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

  var P = { fn: {}, layout: {}, layoutTotal: 0, long: [], cmd: {}, t0: 0 };

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
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) { P.long.push(Math.round(e.duration)); });
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
    var busy = P.long.reduce(function (a, b) { return a + b; }, 0);
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
      ' ms / 卡住 ' + (busy / (sec * 1000) * 100).toFixed(1) + '% 的時間　最大幾筆：' +
      P.long.slice().sort(function (a, b) { return b - a; }).slice(0, 8).join(', '));
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
      cmd: rows(P.cmd, true), layout: rows(P.layout, false).slice(0, 20), fn: rows(P.fn, true).slice(0, 20)
    };
    return '把上面整段截圖回報（或執行 copy(__lagData) 貼純文字）';
  };

  window.lagReset = function () {
    P.fn = {}; P.layout = {}; P.layoutTotal = 0; P.long = []; P.cmd = {};
    P.t0 = performance.now();
    return '已歸零，重新計時';
  };

  function start() {
    wrapAll();
    wrapCommands();
    P.t0 = performance.now();
    console.log('%c[卡頓探針] 已啟用（?lag=1）。每 15 秒自動印一次；lagReport() 立即印，lagReset() 歸零。',
      'color:#0a0;font-weight:bold');
    setInterval(function () { window.lagReport(); }, 15000);
  }

  /* ui.js 的函式要等腳本載入完才存在；DOMContentLoaded 之後一定都在了。 */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
