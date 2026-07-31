'use strict';
/* ============ 原生內核宿主（headless） ============

   把 js/worker/sim.worker.js **原封不動**載進一個 vm context，然後由外部驅動它。
   這裡不重寫遊戲的任何一段邏輯：推進時間走 simStep()、玩家操作走 runCommand()、
   讀畫面走 buildView()，三者都是 Worker 自己的函式。

   本檔唯一被允許替換的東西，是「瀏覽器環境」本身：
     1. Math.random  → 種子化 PRNG（可重播；不改任何公式）
     2. Date / performance → 虛擬時鐘（見下方「為什麼一定要虛擬時鐘」）
     3. postMessage / importScripts / setTimeout → Worker 環境替身

   ⚠️ 為什麼一定要虛擬時鐘
   模擬層有兩處直接讀真實時鐘來決定遊戲行為：
     - js/item.js:263  寶石商店以 Date.now() - hourStart 判斷是否刷新
     - js/forge.js:486 熔煉完成時間以 Date.now() 比對 startedAt
   縮時一萬倍時真實時鐘幾乎沒走，這兩個系統會整場靜止——商店永不刷新、熔爐永不出爐。
   舊版 scripts/run_real_ai_player.js 沒有處理，那正是它跑 500 小時卻幾乎沒有熔爐
   與商店活動的原因。時鐘必須跟著模擬時間走。 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeRng } = require('./rng');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKER_DIR = path.join(ROOT, 'js', 'worker');

/* ---- 5Hz 維護函式：與 sim.worker.js 的 loop() 同步的單一來源 ----

   這幾支不在 simStep() 內，但會改變遊戲狀態（刷新寶石商店、解鎖熔爐、記顯示旗標），
   線上是由 loop() 每 200ms 呼叫。headless 必須跑同一組，少跑一支就是靜默失真——
   那個系統會整場不動，而且不會有任何錯誤訊息。

   ⚠️ 有人在 loop() 加第四支維護函式而沒有加到這裡，這裡就會與遊戲不同步。
   tests/sim-harness-sync.test.cjs 會盯住這件事：它比對 sim.worker.js 兩個迴圈區塊
   實際呼叫的函式集合與本清單，不一致就讓 npm test 紅燈。 */
const MAINTENANCE_FNS = ['updateShownRes', 'maintainGemShop', 'checkForgeUnlockNotice', 'markCombatDirty'];

/* 模擬起點的真實時間戳。固定值而非 Date.now()，否則同 seed 兩次跑會因為
   savedAt / hourStart 不同而產生不同存檔——決定論就沒了。 */
const EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

function createEngine(opts) {
  opts = opts || {};
  const seed = opts.seed >>> 0;
  const rng = makeRng(seed);
  /* 原生日誌／掉落／飄字事件的接收端。不接的話一律丟棄，但一定要取走——
     見 step() 內的說明。 */
  const onEvents = opts.onEvents || null;
  /* 只給 scripts/verify_equivalence.js 用：把 updateShownRes 換回改造前的實作，
     證明 early-skip 沒有改變 G。正式跑不要開。 */
  const legacyShownRes = !!opts.legacyShownRes;

  let vNowMs = EPOCH_MS;          // 虛擬時鐘（毫秒），只由 advanceClock 推進
  const timers = [];              // setTimeout 佇列，由 flushTimers 手動排掉
  const outbox = [];              // Worker → 主執行緒的訊息（persist / ack / error…）

  const RealDate = Date;
  function VirtualDate(...args) {
    return args.length ? new RealDate(...args) : new RealDate(vNowMs);
  }
  VirtualDate.prototype = RealDate.prototype;
  VirtualDate.now = () => vNowMs;
  VirtualDate.parse = RealDate.parse;
  VirtualDate.UTC = RealDate.UTC;

  /* Math 必須是**自有屬性**的複本，不能用 Object.create(Math)。
     後者讓每一次 Math.floor / Math.max 都走一層原型鏈查找，V8 的內建函式
     inline cache 會失效——而模擬層每步呼叫 Math.* 數百次，這層間接成本會全額付出。 */
  const MathCopy = {};
  Object.getOwnPropertyNames(Math).forEach((k) => { MathCopy[k] = Math[k]; });
  MathCopy.random = rng;

  const ctx = {
    console,
    JSON,
    Math: MathCopy,
    Date: VirtualDate,
    performance: { now: () => vNowMs - EPOCH_MS },
    location: { search: '', href: 'file:///sim/sim.worker.js', hostname: 'localhost' },
    setTimeout(fn, ms) { timers.push({ fn, at: vNowMs + (ms || 0) }); return timers.length; },
    clearTimeout() {},
    setInterval() { return 0; },   // 迴圈由驅動端掌控，不讓 Worker 自己跑
    clearInterval() {},
    postMessage(msg) { outbox.push(msg); },
    importScripts(...files) {
      for (const f of files) {
        const abs = path.resolve(WORKER_DIR, f);
        vm.runInContext(fs.readFileSync(abs, 'utf8'), ctx, { filename: path.relative(ROOT, abs) });
      }
    }
  };
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  /* 唯一的載入動作：跑真正的 Worker 進入點。它自己會 importScripts 那 20 支模擬層檔案，
     順序與線上完全一致——不在這裡自己列清單，列了就會有第二份載入順序要維護。 */
  vm.runInContext(
    fs.readFileSync(path.join(WORKER_DIR, 'sim.worker.js'), 'utf8'),
    ctx,
    { filename: 'js/worker/sim.worker.js' }
  );

  /* A/B 用：改造前的 updateShownRes 原始實作（每次都重算，不看旗標是否已設）。
     刻意保留原文，讓「優化前 vs 優化後」的比對對象是真的舊行為，不是我描述的舊行為。 */
  if (legacyShownRes) {
    vm.runInContext(`
      function updateShownRes() {
        var p = G && G.player;
        if (!p) return;
        if (!p.shownRes) p.shownRes = {};
        for (var i = 0; i < SHOWN_RES_KEYS.length; i++) {
          if ((p[SHOWN_RES_KEYS[i][1]] || 0) > 0) p.shownRes[SHOWN_RES_KEYS[i][0]] = true;
        }
        if (typeof totalGemsAll === 'function' && totalGemsAll() > 0) p.shownRes['r-gems'] = true;
        var books = 0;
        for (var bk in p.books) books += p.books[bk] || 0;
        if (books > 0) p.shownRes['r-books'] = true;
      }
    `, ctx, { filename: 'legacy-updateShownRes' });
  }

  const TICK_MS = ctx.TICK_MS;
  const DT = TICK_MS / 1000;
  const EMIT_EVERY = Math.max(1, Math.round(ctx.TICK_EMIT_MS / TICK_MS));

  function flushTimers() {
    while (timers.length) {
      const t = timers.shift();
      t.fn();
    }
  }

  function send(msg) {
    ctx.onmessage({ data: msg });
    flushTimers();
  }

  let stepCount = 0;

  return {
    ctx,
    seed,
    dt: DT,

    /* 開機走 Worker 真正的 boot()，含 migrateSave / newGameState / initFieldPlayer /
       離線結算，一步都不省。save 傳 null 就是全新角色。 */
    boot(save) {
      send({ type: ctx.MSG_IN.BOOT, save: save || null, now: vNowMs, maxRunId: 1 });
      return this;
    },

    /* 推進 n 個原生步長。dt 固定為 TICK_MS/1000，不放大——步長是遊戲行為的一部分。

       每 EMIT_EVERY 步跑一次 loop() 裡的 5Hz 區塊。那幾支不在 simStep 內，
       但 maintainGemShop 會刷新寶石商店、checkForgeUnlockNotice 會解鎖熔爐，
       都是實際遊戲行為；只呼叫 simStep 會讓這兩個系統整場不動。
       節奏以「模擬時間 5Hz」對齊，與線上真實時間 5Hz 是同一件事。

       ⚠️ 這三支一支都不能少、也不能改頻率。updateShownRes 寫的 shownRes 旗標是
       **黏著式**的（某資源曾經 >0 就永久顯示），所以「多久取樣一次」本身就是語意的一部分：
       改成觀測前才跑，只要策略把某項資源花光，那一瞬間的旗標就會漏掉，存檔跟著不一樣。
       它原本佔 headless 總 CPU 的 39%，但正確的解法是讓那支函式本身變便宜
       （已在 js/worker/sim.worker.js 加上 early-skip），不是少呼叫它。 */
    step(n) {
      const simStep = ctx.simStep;
      /* 從 MAINTENANCE_FNS 取，不逐一寫死——清單是唯一來源，測試盯著它與遊戲同步。
         呼叫順序必須與 loop() 一致：updateShownRes 會被 maintainGemShop 影響到的
         寶石數量讀取，順序反了旗標會晚一個週期才latch。 */
      const maintenance = MAINTENANCE_FNS.map((n2) => ctx[n2]);
      const drain = ctx.shimDrainEvents;
      for (let i = 0; i < n; i++) {
        vNowMs += TICK_MS;
        simStep(DT);
        if ((++stepCount % EMIT_EVERY) === 0) {
          for (let m = 0; m < maintenance.length; m++) maintenance[m]();
          /* 事件佇列上限 400，滿了之後每則事件都要 shift() 一次。
             線上是主執行緒每 200ms 取走，這裡對齊同樣節奏取走，行為一致。 */
          if (onEvents) onEvents(drain());
          else drain();
        }
      }
      return this;
    },

    stepSeconds(sec) { return this.step(Math.round(sec / DT)); },
    stepHours(h) { return this.stepSeconds(h * 3600); },

    /* 玩家操作的唯一入口。與 Worker 收到 MSG_IN.CMD 時走的是同一支 runCommand，
       指令名不在 js/worker/protocol.js 的指令表內會被它自己擋下。 */
    cmd(name, args) { return ctx.runCommand(name, args || {}); },

    view() { ctx.updateShownRes(); return ctx.buildView(); },
    panel(name, params) { return ctx.buildPanel(name, params); },
    events() { return ctx.shimDrainEvents(); },

    state() { ctx.updateShownRes(); return ctx.G; },
    saveJson() { ctx.updateShownRes(); return vm.runInContext('JSON.stringify(G)', ctx); },
    gameTimeSec() { return (vNowMs - EPOCH_MS) / 1000; },
    steps() { return stepCount; },
    outbox() { return outbox; },

    /* 存檔落地前對齊 savedAt，與線上存檔的語意一致（存檔時間＝當下時間）。
       這是寫 G，所以刻意留在引擎宿主而不是策略層，並且只在匯出時發生一次。 */
    stampSavedAt() { ctx.G.savedAt = vNowMs; return this; }
  };
}

module.exports = { createEngine, EPOCH_MS, MAINTENANCE_FNS };
