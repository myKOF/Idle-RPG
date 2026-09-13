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

  var P = { fn: {}, layout: {}, layoutTotal: 0, long: [], input: [], cmd: {}, t0: 0, grow: {}, timers: 0, timersPeak: 0,
    frames: 0, frameGaps: [], frameT0: 0, loaf: [],
    rafInFrame: 0, rafMsInFrame: 0, rafPeak: { n: 0, ms: 0, at: 0 } };

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

  /* ---- 一幀的內部拆解（Long Animation Frame）----
     2026-09-13 的報告卡在這一步：長工作 26 秒、卡住 19.4% 的時間，但觀察名單上
     最貴的一支只有 31.8ms。結論只能寫到「時間花在 JS 之外」，再往下就沒有工具了——
     而「樣式重算太貴」與「版面計算太貴」要動的地方完全不同，猜錯就是再白跑一輪。

     long-animation-frame 是唯一能把一幀切開的瀏覽器 API。它給的三段正好對應
     三種責任：
       腳本      startTime → renderStart     （事件處理、計時器；含不在名單上的）
       更新迴圈  renderStart → styleAndLayoutStart（rAF 回呼，Pixi／VFX 在這裡）
       樣式版面  styleAndLayoutStart → 結束   （瀏覽器自己的樣式重算與版面計算）
     而且 scripts[] 會附上函式名與檔案，連沒被包裝的第三方程式碼都歸得了戶。
     Chrome 123 起支援；不支援的瀏覽器整段 try 掉，報告少這一塊但其餘照常。 */
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        var end = e.startTime + e.duration;
        var styleMs = e.styleAndLayoutStart ? Math.round(end - e.styleAndLayoutStart) : 0;
        var renderMs = (e.renderStart && e.styleAndLayoutStart)
          ? Math.round(e.styleAndLayoutStart - e.renderStart) : 0;
        var scriptMs = e.renderStart ? Math.round(e.renderStart - e.startTime) : 0;
        var top = (e.scripts || []).map(function (sc) {
          return {
            name: sc.sourceFunctionName || sc.invokerType || sc.invoker || '(匿名)',
            ms: Math.round(sc.duration || 0)
          };
        }).sort(function (a, b) { return b.ms - a.ms; }).slice(0, 2);
        P.loaf.push({
          ms: Math.round(e.duration), at: Math.round(e.startTime / 1000),
          script: scriptMs, render: renderMs, style: styleMs, top: top
        });
      });
      if (P.loaf.length > 200) P.loaf.splice(0, 100);
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) {}

  /* ---- 使用者真正感受到的延遲：按下去 → 畫面更新 ----
     長工作表與函式耗時表回答的是「CPU 花在哪」，但回報進來的話是「點了沒反應」。
     等待的那一段不屬於任何一支函式，兩張表上都看不見它——2026-09-12 的技能頁
     卡頓回報就是這種：彈窗渲染量到只有 0.4ms，使用者卻等了一秒。
     Event Timing 直接量整段，並拆成三截，責任歸屬一眼就分得出來：
       等待 ＝ 事件產生到 handler 開始（主執行緒被別的工作佔住）
       處理 ＝ 我們自己的 handler（開彈窗、重繪）
       呈現 ＝ handler 結束到畫面真的更新（版面重算與繪製太重）
     durationThreshold 的規格下限是 16ms，填更小也只會拿到 16。 */
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        P.input.push({
          name: e.name,
          total: Math.round(e.duration),
          wait: Math.round(e.processingStart - e.startTime),
          run: Math.round(e.processingEnd - e.processingStart),
          paint: Math.round(e.startTime + e.duration - e.processingEnd),
          at: Math.round(e.startTime / 1000)
        });
      });
      if (P.input.length > 300) P.input.splice(0, 150);
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
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
    /* 計時器驅動的路徑。2026-08-16 的報告裡長工作是 ~100ms、每秒一次，
       但名單上每一支的單次最大都不到 16ms——兇手整個在名單外。
       這幾支都是 setInterval 掛著的，最有機會是那種「平常不跑、被觸發後
       每秒咬一口」的東西，補進來才不會又是一張看不出兇手的報告。 */
    'checkForUpdates', 'saveGame', 'renderStatsPanel', 'renderQuestModal',
    'drawMiniCanvas', 'renderMiniWindow', 'syncUiScale', 'resize',
    // 寶石頁：整支與各子區塊分開量，才看得出是哪一塊慢
    'renderGems', 'renderGemConvert', 'renderGemFusion', 'renderGemShop', 'renderGemDismantle',
    'renderFuseInfo', 'updateShopCountdown',
    /* 技能頁：點技能圖標 → 升級彈窗。2026-09-12 回報「點了約 1 秒才彈出，彈窗裡的
       操作也一樣慢」，而這條路徑上原本一支都不在名單裡——正是本段開頭警告的那種
       情況：報告會把它顯示成「完全沒問題」。彈窗是同步渲染、不等 Worker 的，
       所以要嘛這幾支自己慢，要嘛主執行緒被別人佔住；兩者都得先量得到才分得出來。 */
    'openSkillModal', 'renderSkillModal', 'renderSkill2Modal', 'renderSkill2UltModal',
    'showSkillTooltip', 'describeSkill2Group', 'describeSkill2Tier'];

  /* ---- rAF 回呼耗時 ----
     2026-09-12 的回報：長工作 41 次共 9216ms（最大幾筆 550～680ms），但 TARGETS 名單上
     每一支的**單次最大**都不到 17ms——兇手整個在名單外。名單只包得到掛在 window 上的
     具名函式，而 PixiJS 的 ticker 與 VFX Runtime 都活在 IIFE 裡、由 rAF 驅動，包不到。
     從 rAF 這一層攔就不必知道它叫什麼名字：先分出「長工作發生在 rAF 裡還是外面」，
     那一刀就把嫌疑範圍從整個前端縮到渲染迴圈或其他地方，再往下查才有方向。
     要在 Pixi 的 ticker 開始跑之前包（start() 在 DOMContentLoaded，app.init 是非同步的，
     來得及）；晚了的話 Pixi 會拿到未包裝的原版，報告裡就永遠是 0。 */
  function wrapRaf() {
    var raf = window.requestAnimationFrame;
    if (typeof raf !== 'function' || raf.__lagWrapped) return;
    var g = function (cb) {
      if (typeof cb !== 'function') return raf.call(window, cb);
      return raf.call(window, function (t) {
        var t0 = performance.now();
        try { return cb(t); }
        finally {
          var ms = performance.now() - t0;
          bump(P.fn, 'rAF回呼:' + (cb.name || '匿名'), ms);
          /* 單次耗時看不出「一幀排了幾十個回呼」這種形態：每一個都很便宜，
             加起來卻吃掉整幀。2026-09-13 的拆解就是這樣——更新迴圈 717ms，
             但單次最大只有 27.4ms。累計在這裡，由 trackFrames 每幀結算。 */
          P.rafInFrame++;
          P.rafMsInFrame += ms;
        }
      });
    };
    g.__lagWrapped = true;
    window.requestAnimationFrame = g;
  }

  /* ---- 影格產出 ----
     這一支回答的是「瀏覽器到底有沒有在出畫面」，而那是目前唯一分得出兩種病因的量測：

       間隔長 ＋ rAF 回呼短 ＋ 沒有長工作  → 主執行緒是閒的，卡在合成／點陣化（GPU 那側）
       間隔長 ＋ rAF 回呼長                → 渲染迴圈自己太貴（Pixi／VFX）
       間隔長 ＋ 長工作多但 rAF 回呼短      → 被主執行緒上的別人佔走

     兩種的修法完全相反（一個要減圖層與點陣化面積，一個要減渲染工作量），
     而既有的報告全都只看主執行緒，分不出來——2026-09-13 連兩次改到錯的地方
     就是因為少了這一條。

     刻意用**未包裝**的原版 rAF 排程：包裝過的會把這支自己也算成一筆 rAF 回呼，
     污染它要量的東西。 */
  function trackFrames(rawRaf) {
    if (typeof rawRaf !== 'function') return;
    var last = performance.now();
    P.frameT0 = last;
    function tick(t) {
      /* 上一幀的 rAF 統計在這裡結算（兩次 tick 之間跑掉的回呼＝一幀份）。

         ⚠️ 這裡**不能**用「回呼數」挑最忙的一幀。第一版是 rafInFrame > rafPeak.n，
         結果 2026-09-13 的報告印出「6 個回呼／1ms」，讓我以為更新迴圈很閒、
         把懷疑導去 CSS 動畫（後來證實是錯的）——因為回呼最多的那一幀，
         跟吃掉最多時間的那一幀根本不是同一幀。要找的是**耗時**最大的那一幀。

         另註：本支雖然用未包裝的原版 rAF，但它在自己的回呼尾端才重新排程，
         所以通常排在其他人後面，不是前面。對「兩次 tick 之間的累計」這個口徑
         沒有影響，但別再照著舊註解以為它最先跑。 */
      if (P.rafMsInFrame > P.rafPeak.ms) {
        P.rafPeak = { n: P.rafInFrame, ms: Math.round(P.rafMsInFrame), at: Math.round(t / 1000) };
      }
      P.rafInFrame = 0;
      P.rafMsInFrame = 0;
      var gap = t - last;
      last = t;
      P.frames++;
      /* 只留夠長的間隔：60fps 正常是 16.7ms，超過 50ms 才算「畫面停住」。
         全部都留的話幾分鐘就是好幾萬筆，報告也讀不動。 */
      if (gap > 50) {
        P.frameGaps.push({ ms: Math.round(gap), at: Math.round(t / 1000) });
        if (P.frameGaps.length > 300) P.frameGaps.splice(0, 150);
      }
      rawRaf.call(window, tick);
    }
    rawRaf.call(window, tick);
  }

  /* ---- 更新區間裡的其他回呼 ----
     2026-09-13 的拆解把兇手鎖進 renderStart → styleAndLayoutStart 這個區間
    （腳本 0ms、樣式版面 1ms、這一段 611ms），而 rAF 回呼整幀只有 6 個共 1ms。
     這個區間裡還會跑 ResizeObserver 與 IntersectionObserver 的回呼，兩者都不經過
     rAF、也不在 TARGETS 名單上（battle-renderer 的 resize 活在 IIFE 裡，
     名單上的 'resize' 包不到它）。先把這兩條包起來排除掉，剩下的才是引擎自己的工作。 */
  function wrapObservers() {
    ['ResizeObserver', 'IntersectionObserver'].forEach(function (name) {
      var Orig = window[name];
      if (typeof Orig !== 'function' || Orig.__lagWrapped) return;
      var Wrapped = function (cb) {
        var g = function () {
          var t0 = performance.now();
          try { return cb.apply(this, arguments); }
          finally { bump(P.fn, name + '回呼', performance.now() - t0); }
        };
        return new Orig(g);
      };
      Wrapped.__lagWrapped = true;
      Wrapped.prototype = Orig.prototype;
      window[name] = Wrapped;
    });
  }

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

  /* 最慢的幾幀，連同「腳本／更新迴圈／樣式版面」三段拆解。 */
  /* 開機那幾秒（載圖集、建整頁 DOM）本來就會有幾百毫秒的幀，而且每次都排第一，
     結論就會一路指向開機、而不是回報者真正遇到的症狀。有開機之後的樣本時一律
     只看那些；整段都在開機期才退回全部，並在判讀裡講明。 */
  var BOOT_SEC = 10;
  function worstFrames(n) {
    var settled = P.loaf.filter(function (f) { return f.at >= BOOT_SEC; });
    var pool = settled.length ? settled : P.loaf;
    return pool.slice().sort(function (a, b) { return b.ms - a.ms; }).slice(0, n || 3);
  }
  function onlyBootSamples() {
    return P.loaf.length > 0 && !P.loaf.some(function (f) { return f.at >= BOOT_SEC; });
  }
  function frameBreakdownText() {
    var w = worstFrames(3);
    if (!w.length) return '';
    return w.map(function (f) {
      var who = f.top.length ? ('｜' + f.top.map(function (t) { return t.name + ' ' + t.ms + 'ms'; }).join('、')) : '';
      return f.ms + 'ms@' + f.at + 's（腳本' + f.script + '／更新迴圈' + f.render +
        '／樣式版面' + f.style + who + '）';
    }).join('　｜　');
  }

  /* getAnimations 在節點多時本身就要花時間，只在印報告時取一次（15 秒一次）。 */
  function animationCount() {
    try {
      return (document.getAnimations && document.getAnimations().length) || 0;
    } catch (e) { return -1; }
  }

  function worstGaps() {
    return P.frameGaps.slice().sort(function (a, b) { return b.ms - a.ms; }).slice(0, 6)
      .map(function (e) { return e.ms + 'ms@' + e.at + 's'; }).join(' ');
  }

  /* ---- 自動判讀 ----
     2026-09-13 使用者反映「不知道那些資訊怎麼看」。這是對的：前幾輪我都在要原始
     數字、再自己在對話裡推論，等於把分析外包給回報者，而且每漏截一行就推錯一次。
     判讀規則本來就是固定的幾條，寫進程式才不會每次重講，也不會因為截圖少一段就失準。

     三條分叉（對應三種完全不同的修法）：
       停住時主執行緒也在忙 ＋ 最貴的是 rAF 回呼 → 畫面更新迴圈自己太貴
       停住時主執行緒也在忙 ＋ 最貴的不在名單上 → 時間花在 JS 之外（樣式重算／版面計算）
       停住時主執行緒是閒的                      → 卡在顯示卡合成／點陣化那一側 */
  function diagnose() {
    var sec = Math.max(1, (performance.now() - P.t0) / 1000);
    if (!P.frames) return ['【判讀】這個分頁沒有在產生畫面（在背景或被別的視窗蓋住），量不到東西。'];
    if (!P.frameGaps.length) {
      return ['【判讀】這段期間沒有量到畫面停住（>50ms）。剛才若有卡，請在卡的當下再取一次。'];
    }
    var lines = [];
    var worst = P.frameGaps.slice().sort(function (a, b) { return b.ms - a.ms; })[0];
    lines.push('【判讀】' + sec.toFixed(0) + ' 秒內畫面停住 ' + P.frameGaps.length +
      ' 次，最長 ' + worst.ms + 'ms。');

    /* 停住的那一秒，主執行緒是不是也在長工作？長工作與影格的時間基準都是分頁載入，
       可以直接比。容許 ±1 秒：兩者都是四捨五入到秒，邊界上會差一格。 */
    var matched = 0;
    for (var i = 0; i < P.frameGaps.length; i++) {
      for (var j = 0; j < P.long.length; j++) {
        if (Math.abs(P.long[j].at - P.frameGaps[i].at) <= 1) { matched++; break; }
      }
    }
    if (matched / P.frameGaps.length < 0.5) {
      lines.push('　其中只有 ' + matched + ' 次主執行緒同時在忙 → 主執行緒是閒的，' +
        '卡在顯示卡合成／點陣化那一側。');
      lines.push('　把這一整段截圖回報即可，不必自己判斷。');
      return lines;
    }
    lines.push('　其中 ' + matched + ' 次主執行緒同時在忙 → 是主執行緒被擋住，不是顯示卡。');

    var longMax = 0;
    for (i = 0; i < P.long.length; i++) if (P.long[i].ms > longMax) longMax = P.long[i].ms;
    var byMax = rows(P.fn, true).slice().sort(function (a, b) { return b['最大ms'] - a['最大ms']; });
    var top = byMax[0];
    var raf = null;
    for (i = 0; i < byMax.length; i++) {
      if (String(byMax[i]['項目']).indexOf('rAF回呼') === 0) { raf = byMax[i]; break; }
    }
    /* 門檻取長工作最大值的一半：要求完全相等太嚴（一次長工作裡通常不只跑一支），
       但若名單上最貴的只有長工作的零頭，那就代表時間根本不在我們量得到的地方。 */
    if (raf && raf['最大ms'] >= longMax * 0.5) {
      lines.push('　最貴的是「' + raf['項目'] + '」單次最大 ' + raf['最大ms'] +
        'ms → 兇手在畫面更新迴圈裡（Pixi／VFX 特效）。');
    } else if (top && top['最大ms'] >= longMax * 0.5) {
      lines.push('　最貴的是「' + top['項目'] + '」單次最大 ' + top['最大ms'] +
        'ms → 兇手就是這一支。');
    } else {
      lines.push('　長工作最大 ' + longMax + 'ms，但名單上最貴的一支只有 ' +
        (top ? top['最大ms'] + 'ms（' + top['項目'] + '）' : '0ms') + ' → 兇手不在名單上。');
      /* 有 long-animation-frame 就別停在「JS 之外」：那句話涵蓋的三件事要動的
         地方完全不同，直接把最慢那一幀的三段攤開，讓結論落到其中一段上。 */
      var wf = worstFrames(1)[0];
      if (!wf) {
        lines.push('　（這個瀏覽器不支援 long-animation-frame，無法再往下拆。）');
      } else if (onlyBootSamples()) {
        lines.push('　目前只有開機期（前 ' + BOOT_SEC + ' 秒）的樣本，那段本來就慢。' +
          '請在遊戲跑順之後執行 lagReset()，再重現一次卡頓。');
      } else {
        var seg = [['腳本（事件與計時器）', wf.script], ['畫面更新迴圈（Pixi／VFX）', wf.render],
          ['瀏覽器的樣式重算與版面計算', wf.style]];
        seg.sort(function (a, b) { return b[1] - a[1]; });
        lines.push('　最慢的一幀 ' + wf.ms + 'ms 拆開來：腳本 ' + wf.script + 'ms／更新迴圈 ' +
          wf.render + 'ms／樣式版面 ' + wf.style + 'ms。');
        lines.push('　→ 主要花在「' + seg[0][0] + '」' + seg[0][1] + 'ms' +
          (wf.top.length ? ('，其中最貴的是 ' + wf.top[0].name + ' ' + wf.top[0].ms + 'ms') : '') + '。');
        /* 更新迴圈吃掉一幀有兩種長相，修法不同：一個很貴的回呼 → 那支自己慢；
           幾十個便宜的回呼 → 是排程失控（同一幀被排了太多次）。 */
        if (seg[0][0].indexOf('更新迴圈') >= 0) {
          lines.push('　　（rAF 最貴的一幀：' + P.rafPeak.ms + 'ms／' + P.rafPeak.n +
            ' 個回呼 @' + P.rafPeak.at + 's' +
            (P.rafPeak.n >= 10 ? ' → 排程失控，不是單一支慢' : '') + '）');
          /* rAF 只佔零頭、而 LoAF 又沒列出任何腳本 → 這一段不是我們的程式碼在跑，
             而是瀏覽器自己的更新工作，目前唯一會長到這種量級的是 CSS 動畫／轉場。 */
          if (P.rafPeak.n < 10 && P.rafPeak.ms < wf.render * 0.25 && !wf.top.length) {
            lines.push('　　rAF 只佔零頭且沒有任何腳本被列出 → 不是我們的程式碼，' +
              '是瀏覽器每幀推進 CSS 動畫／轉場的成本（目前進行中 ' + animationCount() + ' 個）。');
          }
        }
      }
    }
    lines.push('　把這一整段截圖回報即可，不必自己判斷。');
    return lines;
  }

  /* 互動延遲一律以「最慢的排前面」呈現：卡頓回報要看的是最差那幾次，平均會把它抹平。 */
  function inputRows() {
    return P.input.slice().sort(function (a, b) { return b.total - a.total; }).map(function (e) {
      return { '事件': e.name, '總延遲ms': e.total, '等待ms': e.wait, '處理ms': e.run,
               '呈現ms': e.paint, '發生秒數': e.at };
    });
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
    console.log('%c影格產出 ' + P.frames + ' 次（每秒 ' + (P.frames / sec).toFixed(0) +
      '）｜畫面停住(>50ms) ' + P.frameGaps.length + ' 次，最長：' + (worstGaps() || '無'),
      'color:#06c;font-weight:bold');
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
      /* VFX Preset Runtime 的量體。舊的追蹤項目全是 DOM 時代留下來的集合，
         Preset 接手戰鬥特效之後，真正會長到上萬的是這幾個——而它們的成本
         落在 Pixi 的 rAF 迴圈裡，函式耗時表一個字都看不到。 */
      var pr = br.preset;
      if (pr) {
        if (pr.fx) {
          track('Preset 特效(fx)', pr.fx.activeEffects);
          track('Preset 粒子(fx)', pr.fx.activeParticles);
          track('Preset 節點池(fx)', pr.fx.pooledNodes);
        }
        if (pr.zone) {
          track('Preset 場域特效', pr.zone.activeEffects);
          track('Preset 場域粒子', pr.zone.activeParticles);
        }
      }
      if (br.nodes) {
        track('節點 特效層', br.nodes.fx);
        track('節點 實體層', br.nodes.entity);
        track('節點 飄字層', br.nodes.float);
        track('節點 覆蓋層', br.nodes.overlay);
      }
    }
    track('DOM 節點總數', document.getElementsByTagName('*').length);
    /* 進行中的 CSS 動畫與轉場。瀏覽器每一幀都要把它們全部推進一次，而那一步就在
       renderStart → styleAndLayoutStart 之間、且**不是腳本**——LoAF 的 scripts[]
       看不到它，函式耗時表也看不到。數量大到幾千就足以吃掉整幀。 */
    track('CSS 動畫／轉場', animationCount());
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

    if (P.input.length) {
      console.log('%c--- 互動延遲（按下→畫面更新；只記錄超過 16ms 的）---', 'color:#c00;font-weight:bold');
      console.table(inputRows().slice(0, 10));
    }
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
      layoutTotal: P.layoutTotal, longTasks: P.long.slice(), input: inputRows().slice(0, 20),
      frames: P.frames, frameGaps: P.frameGaps.slice(-40), loaf: worstFrames(10), rafPeak: P.rafPeak,
      renderer: br, timers: P.timers, timersPeak: P.timersPeak, grow: growRows,
      cmd: rows(P.cmd, true), layout: rows(P.layout, false).slice(0, 20), fn: rows(P.fn, true).slice(0, 20)
    };
    return '把上面整段截圖回報（或執行 copy(__lagData) 貼純文字）';
  };

  /* ---- 一鍵純文字摘要 ----
     為什麼要有這一支：console.table 會被 DevTools 摺疊成「Array(n)」，回報者截圖時
     最關鍵的兩張表（長工作、各函式耗時）幾乎每次都收起來或被捲出畫面——
     2026-09-12 的技能頁卡頓回報來回三次都沒拿到那兩塊，時間全花在要圖上。
     這支把同樣的東西壓成六行純文字，一張截圖就涵蓋得完，不必展開也不必捲動。 */
  window.lagText = function () {
    var sec = Math.max(1, (performance.now() - P.t0) / 1000);
    var st = (window.WorkerBridge && WorkerBridge.status) ? WorkerBridge.status() : {};
    var inv = (window.UI_WORKER_STATE && UI_WORKER_STATE.panels.inv) || {};
    var busy = P.long.reduce(function (a, b) { return a + b.ms; }, 0);
    var topLong = P.long.slice().sort(function (a, b) { return b.ms - a.ms; }).slice(0, 6)
      .map(function (e) { return e.ms + 'ms@' + e.at + 's'; }).join(' ');
    var fn = rows(P.fn, true).slice(0, 8).map(function (r) {
      return r['項目'] + ' ' + r['佔用ms'] + 'ms(' + r['次數'] + '次/最大' + r['最大ms'] + ')';
    }).join('　｜　');
    var lay = rows(P.layout, false).slice(0, 5).map(function (r) {
      return r['項目'] + ' ' + r['次數'];
    }).join('　｜　');
    var inp = inputRows().slice(0, 3).map(function (r) {
      return r['事件'] + ' ' + r['總延遲ms'] + 'ms(等' + r['等待ms'] + '/處' + r['處理ms'] +
        '/呈' + r['呈現ms'] + ')@' + r['發生秒數'] + 's';
    }).join('　｜　');
    var out = [
      '[卡頓探針] ' + sec.toFixed(0) + 's｜分頁 ' + (window.UI ? UI.tab : '?') +
        '｜DOM ' + document.getElementsByTagName('*').length +
        '｜背包 ' + inv.count + '/' + inv.cap +
        '｜計時器 ' + P.timers + '（峰值 ' + P.timersPeak + '）' +
        '｜CSS 動畫 ' + animationCount(),
      'Worker：catchup=' + st.catchupSec + 's ticks=' + st.ticks + ' errors=' + st.errors +
        ' restarts=' + st.restarts + ' pending=' + st.pendingCommands,
      '強制重算 ' + P.layoutTotal + ' 次（每秒 ' + (P.layoutTotal / sec).toFixed(1) + '）：' + (lay || '無'),
      '長工作 ' + P.long.length + ' 次／共 ' + busy + 'ms（卡住 ' +
        (busy / (sec * 1000) * 100).toFixed(1) + '% 的時間）最大：' + (topLong || '無'),
      '影格 ' + P.frames + ' 次（每秒 ' + (P.frames / sec).toFixed(0) + '）｜停住(>50ms) ' +
        P.frameGaps.length + ' 次，最長：' + (worstGaps() || '無'),
      '互動最差：' + (inp || '無（沒有超過 16ms 的互動）'),
      '函式 TOP8：' + (fn || '無'),
      '最慢的幀：' + (frameBreakdownText() || '無（瀏覽器不支援 long-animation-frame）'),
      'rAF 最貴的一幀：' + P.rafPeak.ms + 'ms／' + P.rafPeak.n + ' 個回呼 @' + P.rafPeak.at + 's'
    ].concat(diagnose());
    console.log('%c' + out.join(String.fromCharCode(10)), 'color:#0a0;line-height:1.6');
    return '把上面這一段截圖回報就夠了';
  };

  /* ---- 繪製成本開關（診斷用，只改行內樣式，重新整理即復原）----
     2026-09-12 回報：捲動技能頁時戰鬥區明顯卡頓甚至定格，完全不動就正常。

     為什麼這個現象值得一個專用開關：整個 UI 外殼掛在 transform: scale() 底下
     （js/ui-scale.js），捲動區與戰鬥 canvas 在同一棵被縮放的圖層樹裡。這種結構
     走不了瀏覽器的 GPU 捲動快路徑，捲動等於在主執行緒重繪整個捲動區——而技能頁
     一屏大約 80 個帶模糊陰影的格子（每個 .sg-stage-learned 有外光暈＋內陰影，
     每列 .sg-group-row 另有漸層＋內陰影）。模糊半徑的繪製成本很高，而 Pixi 的
     ticker 跟它搶同一個 frame，於是畫面就停住。

     這是假設，不是結論。與其照著假設改程式，不如把三個嫌疑各自關掉再捲一次：
     差別用眼睛就看得出來，一次就知道是不是、以及是哪一個。

       lagPaint('noanim')  全頁停掉 CSS 動畫與轉場（每幀推進動畫的成本）
       lagPaint('nohover') 捲動區內不做命中判定與過場動畫（CSS :hover 重算成本）
       lagPaint('shadow') 關掉所有陰影與濾鏡（繪製成本）
       lagPaint('skip')   離開畫面的技能列整列跳過渲染（content-visibility）
       lagPaint('layer')  把戰鬥 canvas 提升成獨立合成圖層
       lagPaint('all')    三個一起開
       lagPaint('reset')  全部復原
     每一個也都能用網址帶（不必碰 Console）：?lag=1&noanim=1、?lag=1&nohover=1 …… */
  window.lagPaint = function (mode) {
    mode = String(mode || 'all');
    var nodes = document.querySelectorAll('.sg-stage-node, .sg-group-row, .skill-card, .talent-node');
    var wraps = document.querySelectorAll('.sg-group-row-wrap');
    var canvas = document.querySelector('canvas.battle-canvas');
    var did = [];
    var i;
    var NOHOVER_ID = '__lagNoHover';
    var NOANIM_ID = '__lagNoAnim';

    if (mode === 'reset') {
      var oldStyle = document.getElementById(NOHOVER_ID);
      if (oldStyle) oldStyle.remove();
      var oldAnim = document.getElementById(NOANIM_ID);
      if (oldAnim) oldAnim.remove();
      for (i = 0; i < nodes.length; i++) { nodes[i].style.boxShadow = ''; nodes[i].style.filter = ''; }
      for (i = 0; i < wraps.length; i++) { wraps[i].style.contentVisibility = ''; wraps[i].style.containIntrinsicSize = ''; }
      if (canvas) canvas.style.willChange = '';
      return '已全部復原（' + nodes.length + ' 個節點、' + wraps.length + ' 列）';
    }
    /* 全頁停掉 CSS 動畫與轉場。
       2026-09-13 的拆解把兇手鎖在 renderStart → styleAndLayoutStart 之間
      （腳本 0ms、樣式版面 1ms、這一段 611ms），而 rAF 回呼整幀只有 6 個共 1ms，
       LoAF 的 scripts[] 也是空的——那一段不是任何腳本，只剩「瀏覽器每幀推進
       CSS 動畫與轉場」這一項會長到那個量級。

       本專案有 143 條 transition／animation，其中不少是 conic-gradient 加 filter
       的無限旋轉（神鑄創世裝備的 .eff-godforged、被動技能格的 bss-passive-spin…）。
       那種動畫每一幀都要重新產生漸層並重新點陣化，合成器幫不上忙，而且**與有沒有
       捲動無關**——正好對得上「60 秒停住 107 次」這種持續發生的形態。

       這是目前最強的假設，但仍然是假設：停掉之後卡頓消失就成立，沒消失就換方向。
       ⚠️ 生效期間畫面會少掉所有動態效果，reset 或重新整理即復原。 */
    if (mode === 'noanim' || mode === 'all') {
      if (!document.getElementById(NOANIM_ID)) {
        var sa = document.createElement('style');
        sa.id = NOANIM_ID;
        sa.textContent = '*, *::before, *::after { animation: none !important;' +
          ' transition: none !important; }';
        document.head.appendChild(sa);
      }
      did.push('全頁停掉 CSS 動畫與轉場');
    }
    /* 捲動時游標不動、元素在游標底下移動，瀏覽器每一幀都要重新判定誰被 :hover，
       再對命中的那一條做樣式重算；.sg-stage-node 每顆還掛著 transition，
       hover 掃過去會一路啟動過場。這些全發生在 JS 之外——擋掉 JS 的 hover handler
       （2026-09-13 已做）對它一點用都沒有，函式耗時表上也永遠看不到。
       對捲動區的**子元素**關掉命中判定：捲動區本身仍收得到滾輪，捲動照常，
       但裡面不再有任何元素會被 hover，整條重算就消失。
       ⚠️ 生效期間捲動區內點不到東西（包括技能格子），reset 即復原。 */
    if (mode === 'nohover' || mode === 'all') {
      if (!document.getElementById(NOHOVER_ID)) {
        var st = document.createElement('style');
        st.id = NOHOVER_ID;
        st.textContent = '#workspace-area main > * { pointer-events: none !important; }' +
          '#workspace-area main *, #workspace-area main *::before, #workspace-area main *::after' +
          ' { transition: none !important; animation: none !important; }';
        document.head.appendChild(st);
      }
      did.push('捲動區內關閉命中判定與過場動畫');
    }
    if (mode === 'shadow' || mode === 'all') {
      for (i = 0; i < nodes.length; i++) { nodes[i].style.boxShadow = 'none'; nodes[i].style.filter = 'none'; }
      did.push('關陰影與濾鏡 ' + nodes.length + ' 個');
    }
    if (mode === 'skip' || mode === 'all') {
      for (i = 0; i < wraps.length; i++) {
        wraps[i].style.contentVisibility = 'auto';
        wraps[i].style.containIntrinsicSize = '0 70px';
      }
      did.push('離屏跳過渲染 ' + wraps.length + ' 列');
    }
    if (mode === 'layer' || mode === 'all') {
      if (canvas) { canvas.style.willChange = 'transform'; did.push('canvas 獨立圖層'); }
      else did.push('找不到 canvas.battle-canvas');
    }
    if (!did.length) return "用法：lagPaint('noanim' | 'nohover' | 'shadow' | 'skip' | 'layer' | 'all' | 'reset')";
    return did.join('；') + '　→ 現在再捲一次技能頁，看戰鬥區還會不會定格';
  };

  /* 成長追蹤刻意**不**歸零：抓累積型問題要的就是一條夠長的基線，
     中途重設會把「起始值」洗成已經漲上去的數字，等於自廢武功。 */
  window.lagReset = function () {
    P.fn = {}; P.layout = {}; P.layoutTotal = 0; P.long = []; P.input = []; P.cmd = {};
    P.frames = 0; P.frameGaps = []; P.loaf = [];
    P.rafInFrame = 0; P.rafMsInFrame = 0; P.rafPeak = { n: 0, ms: 0, at: 0 };
    P.t0 = performance.now();
    return '已歸零，重新計時（成長追蹤的基線保留）';
  };

  /* ---- 開關也走網址參數 ----
     本檔開頭就寫著「回報卡頓只要換一次網址」，理由是 Chrome 對「貼程式碼進
     Console」有防呆（要先手動輸入 allow pasting）。2026-09-13 回報者踩到了，
     回覆只有「沒辦法輸入」——而我當時給的驗證方式正是叫他在 Console 打指令，
     等於自己違反了本檔的設計前提。
     ?lag=1&noanim=1 這種寫法讓所有開關都不必碰 Console。

     開機時畫面還沒建好（Pixi 的 canvas 要等資產載完），所以每次自動報告時再套一次；
     每個 mode 都是冪等的（style 標籤看 id、行內樣式重設同值），重複套用沒有副作用。 */
  function applyUrlModes() {
    if (typeof window.lagPaint !== 'function') return;
    ['noanim', 'nohover', 'shadow', 'skip', 'layer'].forEach(function (mode) {
      if (new RegExp('[?&]' + mode + '=1(&|$)').test(location.search || '')) {
        window.lagPaint(mode);
      }
    });
  }

  function start() {
    var rawRaf = window.requestAnimationFrame;
    wrapRaf();
    wrapObservers();
    trackFrames(rawRaf);
    wrapAll();
    wrapCommands();
    wrapTimers();
    P.t0 = performance.now();
    console.log('%c[卡頓探針] 已啟用（?lag=1）。每 15 秒自動印一份純文字摘要；lagReport() 印完整表格，' +
      'lagText() 立即印摘要，lagReset() 歸零，' +
      "lagPaint('all') 試關繪製成本。",
      'color:#0a0;font-weight:bold');
    /* 自動報告改印純文字版。console.table 會被 DevTools 摺成「Array(n)」，
       而回報者截到的幾乎都是這個自動報告——2026-09-12～13 為了拿其中兩張表
       來回了六次，每次都是「捲錯位置」或「表收起來了」。
       印一份隨手截就完整的，比要求對方去展開正確的那張表可靠得多。
       完整的表仍在 lagReport()，需要細節時自己叫。 */
    applyUrlModes();
    /* 開機那十幾秒（載圖集、建整頁 DOM、第一次全頁渲染）本來就會有幾百毫秒的幀，
       而且會一路霸佔統計，讓結論指向開機而不是回報者真正遇到的症狀。
       判讀已經會略過前 10 秒的幀，但長工作、影格與函式耗時仍是從載入起算的累計。
       自動歸零一次，回報者就不必記得去按 lagReset()——尤其在連 Console 都打不開的
       環境裡，那本來就是做不到的要求。成長追蹤的基線照舊保留。 */
    setTimeout(function () {
      window.lagReset();
      console.log('%c[卡頓探針] 已自動歸零（跳過開機期），以下為穩定狀態的數字。',
        'color:#0a0;font-weight:bold');
    }, 20000);
    setInterval(function () { window.lagText(); applyUrlModes(); }, 15000);
  }

  /* ui.js 的函式要等腳本載入完才存在；DOMContentLoaded 之後一定都在了。 */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
