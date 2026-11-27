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
   熔煉等流程會用 Date.now() 比對起始時間。加速模擬時，真實時鐘幾乎沒走，
   熔煉也就無法按照模擬時間出爐。時鐘必須跟著模擬時間走。 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeRng } = require('./rng');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKER_DIR = path.join(ROOT, 'js', 'worker');
const EDITION_FILE = path.join(ROOT, 'js', 'game-edition.js');
const EDITIONS = ['full', 'demo'];
/* 不認得的值直接報錯：靜靜退回 'full' 的話，使用者以為跑的是 demo，結果全是正式版數值。 */
function normalizeEdition(v) {
  if (v === undefined || v === null || v === '') return 'full';
  if (EDITIONS.indexOf(v) < 0) throw new Error('不認得的遊戲版本：' + v + '（可用：' + EDITIONS.join('、') + '）');
  return v;
}

/* ---- 邊際效益評估器（harness 專用，不出貨給玩家） ----

   載進**引擎**的 context（看得到 G / FIELD / 遊戲函式），而不是策略的 context。
   策略仍然只拿得到它算出來的純資料，隔離一點都沒有放寬——見 evaluator.js 檔頭。

   為什麼不放進 js/worker/sim.worker.js 的 buildPanel：那份程式碼會跟著正式版
   出貨給真人玩家，而這裡的東西只有 AI 模擬器用得到。 */
const EVALUATOR = fs.readFileSync(path.join(__dirname, 'evaluator.js'), 'utf8');

/* ---- 5Hz 維護函式：與 sim.worker.js 的 loop() 同步的單一來源 ----

   這幾支不在 simStep() 內，但會處理熔爐解鎖、資源顯示旗標與戰鬥更新。
   線上是由 loop() 每 200ms 呼叫。headless 必須跑同一組，少跑一支就是靜默失真——
   那個系統會整場不動，而且不會有任何錯誤訊息。

   ⚠️ 有人在 loop() 加第四支維護函式而沒有加到這裡，這裡就會與遊戲不同步。
   tests/sim-harness-sync.test.cjs 會盯住這件事：它比對 sim.worker.js 兩個迴圈區塊
   實際呼叫的函式集合與本清單，不一致就讓 npm test 紅燈。 */
const MAINTENANCE_FNS = ['updateShownRes', 'checkForgeUnlockNotice', 'markCombatDirty'];

/* 模擬起點的真實時間戳。固定值而非 Date.now()，否則同 seed 兩次跑會因為
   savedAt 不同而產生不同存檔——決定論就沒了。 */
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
  /* 遊戲版本：'full'（正式版／內測版的數值）或 'demo'（Steam 封測，倍率與開放範圍見 js/data.js「Demo 版」）。 */
  const edition = normalizeEdition(opts.edition);

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

  const env = {
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
        /* ⚠️ 真正的 importScripts 收的是 **URL**，不是檔案路徑。
           遊戲會在上面掛快取破壞用的查詢字串，例如
             importScripts('../player.js?v=20260804-xp-settle')
           瀏覽器那邊 HTTP server 會照樣送出同一個檔，只是繞過快取；
           這裡是 fs.readFileSync，`?v=...` 會變成檔名的一部分而直接 ENOENT。

           實測就是這樣炸的：別的分支加了 ?v= 之後，整個模擬器（含儀表板的自測）
           一律以退出碼 1 失敗，而錯誤訊息是
             ENOENT: open 'js\player.js?v=20260804-xp-settle'
           ——看起來像檔案不見了，實際上是墊片沒有做靜態檔案伺服器會做的事。

           所以照 server 的行為把 query 與 fragment 去掉。這是墊片該補的相容性，
           不是遊戲該遷就 harness——線上用 ?v= 破快取是完全正當的做法。 */
        const clean = String(f).split('#')[0].split('?')[0];
        const abs = path.resolve(WORKER_DIR, clean);
        /* 版本旗標：與桌面外殼（electron/main.cjs 的 EDITION_SCRIPT）同一個做法——
           js/game-edition.js 永遠寫 'full'，demo 版改寫它的內容，遊戲程式只有一份。 */
        const src = (edition !== 'full' && abs === EDITION_FILE)
          ? "'use strict';\nvar GAME_EDITION = " + JSON.stringify(edition) + ';\n'
          : fs.readFileSync(abs, 'utf8');
        vm.runInContext(src, ctx, { filename: path.relative(ROOT, abs) });
      }
    }
  };
  /* ---- 為什麼用 DONT_CONTEXTIFY ----

     舊做法是把 env 這個沙盒物件交給 vm.createContext「contextify」。那樣建出來的 context，
     全域物件前面掛著一層攔截器：遊戲裡每一次讀全域變數——G、FIELD、跨檔呼叫的每一支函式、
     bfNum 的 self[name]——都要先過一趟 C++ 回呼。實測同一個迴圈讀全域 1e7 次：
       一般 context 10~48 ms、contextify 的 vm context 2,578~3,020 ms（慢 60~300 倍）。
     模擬層每一步讀全域數千次，這是 headless 模擬最大的單一成本，比任何遊戲函式都大。

     DONT_CONTEXTIFY（Node 22.8+）建出的是普通的全域物件，沒有攔截器；
     宿主照樣用 ctx.X 讀寫，vm.runInContext 照樣能用。內建物件仍是 context 自己的一份
     （與 contextify 時相同），替身（Math／Date／importScripts…）照舊一個個掛上去。
     與舊做法的最終存檔雜湊逐位相同（tests/sim-engine-context.test.cjs）。

     opts.contextify=true 或 Node 太舊時退回舊做法，供 A/B 量測與相容。 */
  const useContextify = !!opts.contextify || !(vm.constants && vm.constants.DONT_CONTEXTIFY);
  let ctx;
  if (useContextify) {
    ctx = env;
    ctx.self = ctx;
    ctx.globalThis = ctx;
    vm.createContext(ctx);
  } else {
    ctx = vm.createContext(vm.constants.DONT_CONTEXTIFY);
    for (const k of Object.keys(env)) ctx[k] = env[k];
    ctx.self = ctx;
  }

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

  /* 評估器要在遊戲載完之後才載入——它呼叫的 computeStats / affixBaseValue /
     defReduction 全都由上面那趟 importScripts 定義出來。 */
  vm.runInContext(EVALUATOR, ctx, { filename: 'scripts/sim/evaluator.js' });

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
  let evalParams = {};   // 由 setEvalParams 設定，見下方 panel()

  return {
    ctx,
    seed,
    edition,
    dt: DT,

    /* 開機走 Worker 真正的 boot()，含 migrateSave / newGameState / initFieldPlayer /
       離線結算，一步都不省。save 傳 null 就是全新角色。 */
    boot(save) {
      send({ type: ctx.MSG_IN.BOOT, save: save || null, now: vNowMs, maxRunId: 1 });
      return this;
    },

    /* 推進 n 個原生步長。dt 固定為 TICK_MS/1000，不放大——步長是遊戲行為的一部分。

       每 EMIT_EVERY 步跑一次 loop() 裡的 5Hz 區塊。那幾支不在 simStep 內，
       例如 checkForgeUnlockNotice 會解鎖熔爐。
       節奏以「模擬時間 5Hz」對齊，與線上真實時間 5Hz 是同一件事。

       ⚠️ 這三支一支都不能少、也不能改頻率。updateShownRes 寫的 shownRes 旗標是
       **黏著式**的（某資源曾經 >0 就永久顯示），所以「多久取樣一次」本身就是語意的一部分：
       改成觀測前才跑，只要策略把某項資源花光，那一瞬間的旗標就會漏掉，存檔跟著不一樣。
       它原本佔 headless 總 CPU 的 39%，但正確的解法是讓那支函式本身變便宜
       （已在 js/worker/sim.worker.js 加上 early-skip），不是少呼叫它。 */
    step(n) {
      const simStep = ctx.simStep;
      /* 從 MAINTENANCE_FNS 取，維持與遊戲 loop() 相同的呼叫順序。 */
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

    /* ---- 離線一段時間 ----

       模擬「玩家把遊戲關掉，過了 N 秒才再打開」。

       遊戲對離線的定義很明確（js/worker/sim.worker.js:145）：
       **分頁在背景＝仍在線上掛機，只有整個遊戲被關掉才算離線**，而離線結算只在
       開機時發生。所以這裡照著真實流程走，一步都不省：

         1. stampSavedAt()          等同關掉遊戲時的落地（savedAt ＝ 當下）
         2. 推進虛擬時鐘，不跑 simStep   離線期間遊戲根本沒在跑
         3. applyOfflineProgress()  遊戲自己的離線結算

       ⚠️ 收益一律由 js/save.js 的 applyOfflineProgress 計算，harness 不碰任何公式。
       離線使用固定戰鬥間隔，依存檔的地圖和關卡抽取野外波次。
       結算函式同時處理時間上限與最短時間門檻。

       不傳 done 就走同步路徑（js/save.js 結尾的 for 迴圈），直接回傳摘要；
       非同步分塊路徑是給瀏覽器不要卡住主執行緒用的，headless 不需要。

       回傳遊戲給的摘要物件；elapsed 不足一分鐘或算不出擊殺數時遊戲會回 undefined。 */
    offlineFor(sec) {
      const seconds = Math.max(0, Number(sec) || 0);
      this.stampSavedAt();
      vNowMs += Math.round(seconds * 1000);
      const summary = ctx.applyOfflineProgress ? ctx.applyOfflineProgress() : undefined;
      /* 結算完把 savedAt 對到新的當下。不對的話下一次離線會把這一段重算一遍
         （elapsed 從舊的 savedAt 起算），收益就重複了。 */
      this.stampSavedAt();
      /* 離線結算會 blog 一行摘要，走的是 shim 事件佇列；不取走的話會佔著佇列，
         而佇列滿 400 則之後每則都要 shift 一次。與 step() 的處理一致。 */
      const drained = ctx.shimDrainEvents ? ctx.shimDrainEvents() : [];
      if (onEvents && drained && drained.length) onEvents(drained);
      return summary || null;
    },

    /* 玩家操作的唯一入口。與 Worker 收到 MSG_IN.CMD 時走的是同一支 runCommand，
       指令名不在 js/worker/protocol.js 的指令表內會被它自己擋下。 */
    cmd(name, args) { return ctx.runCommand(name, args || {}); },

    view() { ctx.updateShownRes(); return ctx.buildView(); },

    /* 'eval' 是 harness 自己的面板，不在遊戲的 buildPanel 裡。
       走同一個 panel() 進入點是刻意的：策略端不需要知道哪些面板是遊戲給的、
       哪些是評估器給的，兩者在 needPanels 裡長得一模一樣。

       ⚠️ 評估器**只讀不寫**。它呼叫 computeStats(override) 算假設狀態，
       但 override 是複製出來的裝備表，G 本身一個欄位都沒動——
       這一點由 tests/sim-evaluator.test.cjs 以存檔雜湊反證（觀測前後雜湊必須相同）。 */
    panel(name, params) {
      /* evalCombat 是便宜的那一半（只做敗因側寫），掛在 1Hz 觀測上；
         eval 是完整版（含換裝精算與詞條 ROI），只在決策點呼叫。
         分兩個面板名而不是一個參數，是為了讓 policy.js 從宣告的路徑
         自動推導出「觀測時要建哪些面板」——參數推導不出來。 */
      if (name === 'evalCombat') return ctx.buildEvalCombatPanel();
      if (name === 'rune') return ctx.buildRunePanel();   // 符文決策（harness 專用，見 evaluator.js）
      if (name === 'skill') return ctx.buildSkillPanel(); // 技能決策（harness 專用，見 evaluator.js）
      if (name === 'taskGoal') return ctx.buildTaskGoalPanel(); // 任務目標（harness 專用，見 evaluator.js）
      if (name === 'equipRules') return ctx.buildEquipRulesPanel(); // 裝備欄規則（harness 專用，見 evaluator.js）
      if (name === 'talentPlan') return ctx.buildTalentPlanPanel();    // 威能等級／費用／開放（harness 專用，見 evaluator.js）
      if (name === 'fieldLoad') return ctx.buildFieldLoadPanel();     // 戰場存活敵人／容量（harness 專用，見 evaluator.js）
      if (name === 'relicPlan') return ctx.buildRelicPlanPanel();       // 遺物等級／件數／可否升級（harness 專用，見 evaluator.js）
      if (name === 'merchantPlan') return ctx.buildMerchantPlanPanel(); // 神祕商人貨架與實際售價（harness 專用，見 evaluator.js）
      if (name === 'gearTier') return ctx.buildGearTierPanel();         // 各場景掉落裝等與是否通關（harness 專用，見 evaluator.js）
      if (name === 'towerFarm') return ctx.buildTowerFarmPanel();       // 高塔各樓層掉落裝等與稀有度上限（harness 專用，見 evaluator.js）
      if (name === 'gemRules') return ctx.buildGemRulesPanel();       // 寶石比例與停用種類（harness 專用，見 evaluator.js）
      if (name === 'equipSets') return ctx.buildEquipSetsPanel(params); // 三套裝備（harness 專用，見 evaluator.js）
      if (name === 'eval') return ctx.buildEvalPanel(params || evalParams);
      const out = ctx.buildPanel(name, params);
      /* battle 面板的 field 就是遊戲活生生的 FIELD，其中 monsters 是場上每一隻怪的完整物件——
         後期 100 隻時約 29KB，而觀測每遊戲秒都要把整份 state 深拷貝進策略 context。
         實測那次拷貝每次約 0.6ms，比直譯器本身（約 0.02ms）貴 30 倍，佔整場時間 14%。
         七份策略沒有任何一份讀 field.monsters（它們讀的是單數的 field.monster：目前鎖定的那一隻）。

         策略以 panelParams.battle["field.monsters"] = false 宣告不需要它。鍵名刻意寫成路徑：
         policy.js 的 assertPanelParams 會據此禁止任何規則指到 panels.battle.field.monsters，
         宣告錯了在載入時就擋下，不會變成「規則永遠取不到值」的靜默失效。
         只在 harness 這裡做淺拷貝，不動出貨給玩家的 sim.worker.js（UI 要畫怪就需要它）。 */
      if (name === 'battle' && out && out.field && params && params['field.monsters'] === false) {
        const field = {};
        for (const k of Object.keys(out.field)) if (k !== 'monsters') field[k] = out.field[k];
        return Object.assign({}, out, { field });
      }
      return out;
    },

    /* 策略以 policy.evalConfig 宣告要評估哪些詞條、每個部位精算幾個候選。
       驅動端在開跑前設一次，之後每個決策點沿用——這是策略資料，不是引擎的事。 */
    setEvalParams(p) { evalParams = p || {}; return this; },
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

module.exports = { createEngine, EPOCH_MS, MAINTENANCE_FNS, EDITIONS, normalizeEdition };
