'use strict';
/* ============ 模擬 Worker ============
   遊戲狀態 G 與主迴圈的唯一所在地。主執行緒只保留 DOM、事件、渲染與儲存 I/O。

   載入順序不可調換：
     protocol.js  訊息與指令契約
     shim.js      window / document / UI.dirty / blog / recordLoot* 替身
     模擬層 19 支 依照 index.html 原本的順序（有相依關係；tasks.js 僅 Worker 端載入）

   模擬層檔案一律原封不動載入，不得在此改寫其行為——那 17 支同時是 116 支
   既有測試的受測對象。 */

importScripts('protocol.js?v=21', 'shim.js?v=3');
importScripts(
  '../util.js?v=20260814-skill-summary', '../data.js?v=20260816-projectile-speed', '../status.js?v=20260816-magic-fire-skills', '../formula.js?v=20260814-skill2-counter-bloodrage', '../battlefield.js?v=20260816-projectile-speed', '../stats.js',
  '../item.js?v=20260805-tasks',
  '../skills.js?v=20260816-meteor-fireball', '../skills2.js?v=20260816-firehunt', '../talents.js?v=20260811-loadout-cap-clamp',
  '../player.js?v=20260814-skill-min-interval', '../special_rules.js',
  '../combat.js?v=20260816-bloodrage-multi-target', '../legendary.js?v=20260816-magic-fire-skills', '../potential.js?v=20260814-skill-min-interval', '../tower.js?v=20260814-skill2-review-fixes',
  '../factory.js', '../newforge.js', '../forge.js', '../save.js?v=20260814-active-passive',
  '../tasks.js'
);
/* GM 指令執行層。面板留在主執行緒（js/gm.js），執行層必須在狀態所在的這一側。
   它自己會擋非本機 hostname；Worker 的 location 是本檔的 URL，判定結果與主執行緒一致。 */
importScripts('../gm_exec.js?v=20260814-skill2-counter-bloodrage');

/* ---- 決定論測試模式（只在本機、只在網址帶 ?seed=N 時啟用）----
   存在的唯一理由：讓瀏覽器實機跑出來的結果，能和 headless 模擬器
   （scripts/sim/engine.js）逐檢查點比對。沒有這個模式，比對在結構上就做不到：

     1. Math.random 未種子化 → 兩邊必然分岔
     2. 更隱蔽的一點：下面 loop() 的 `dt = Math.min(_catchupDebt, TICK_MS/1000)`
        每輪最後會走一個**不足一步**的殘步，而欠帳來自真實計時器，
        幾乎不會剛好是 0.1 的倍數。所以連「同一個瀏覽器跑兩次」都不會一樣。

   測試模式改動的就是這兩件事，其餘一律不動：
     - Math.random 換成與 scripts/sim/rng.js 相同的 mulberry32
     - 只走整步，殘餘留到下一輪（DETERMINISTIC_STEPS）

   ⚠️ 這代表測試模式與正式遊玩有一處差異：殘步。比對報告必須註明這一點。
   安全邊界沿用 js/gm_exec.js 的作法：只認本機 hostname，不依賴可被前端覆寫的旗標。 */
var DETERMINISTIC_STEPS = false;
(function installTestSeed() {
  var loc = (typeof location !== 'undefined') ? location : null;
  var host = loc && loc.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return;
  var m = /[?&]seed=(\d+)(&|$)/.exec((loc && loc.search) || '');
  if (!m) return;
  var a = (Number(m[1]) >>> 0) || 1;
  Math.random = function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  DETERMINISTIC_STEPS = true;
})();

/* ---- 節奏參數 ---- */
var TICK_MS = 100;          // 模擬步長
var TICK_EMIT_MS = 200;     // 對主執行緒送 tick 的間隔（5Hz）
var AUTOSAVE_SEC = 15;      // 自動存檔
var FOLDER_AUTOSAVE_SEC = 600;

var _booted = false;
var _loopTimer = 0;
var _lastTickAt = 0;
/* ---- 節流基準是真實時間，不是模擬出的遊戲時間 ----
   這三個原本是累加器，加的是「這次 loop 模擬掉的遊戲秒數」。正常運行時一次 loop
   就是一步 TICK_MS，遊戲時間等於真實時間，看不出差別；但補欠帳時一次 loop 會模擬掉
   數十秒遊戲時間（CPU 預算 30ms ÷ 每遊戲秒約 0.67ms），門檻立刻被跨過：
   自動存檔從 15 秒一次變成每個 loop（0.1 秒）一次、資料夾同步從 10 分鐘一次變成約
   1.3 秒一次，各放大約 150 與 450 倍。

   一次自動存檔的實際成本是「整份存檔序列化 → 跨執行緒複製 → 主執行緒 gzip 與
   IndexedDB／檔案寫入」，後期存檔約 400 KB。放大幾百倍後主執行緒會被寫入塞滿，
   玩家的指令要等十秒才有反應，watchdog 也會因為收不到訊息而誤判 Worker 已死並重啟，
   重啟又會丟掉還沒補完的欠帳、改用固定費率的離線收益結算。整條鏈的源頭就是這裡。 */
var _lastEmitAt = 0;
var _lastAutoAt = 0;
var _lastFolderAt = 0;
var _persistSeq = 0;
var _pendingPersist = {};   // token -> kind，等主執行緒回 saveResult
/* 重新開局送出後到頁面真的重載之間，這顆 Worker 的 G 仍是「舊局」。
   期間任何一次自動存檔／關閉落地都會把舊局寫回同一個 auto_current，蓋掉新局。 */
var _restarting = false;
var _maxRunId = 1;          // 由 boot 帶入；重新開局時用來決定新局編號

/* ---- 訊息量測（P4 用，預設關閉）----
   量測本身會扭曲被量測的對象：為了算 payload 大小而做一次 JSON.stringify，
   成本可能比訊息本身還高。所以只在 Worker URL 帶 ?measure=1 時才啟用，
   平常完全不付這個代價。

   兩個數字量的是不同東西，不要混用：
   - bytes：JSON 位元組數，只是**規模的代理指標**。postMessage 走的是 structured
     clone，不是 JSON，實際成本與此不成正比。
   - postMs：postMessage 呼叫本身的耗時，包含 structured clone，這才是真實成本。 */
var MEASURE = (typeof location !== 'undefined') && /[?&]measure=1(&|$)/.test(location.search || '');
var MEASURE_STATS = Object.create(null);

function measureRecord(type, payload, postMs) {
  var s = MEASURE_STATS[type];
  if (!s) s = MEASURE_STATS[type] = { count: 0, bytes: 0, maxBytes: 0, postMs: 0, maxPostMs: 0 };
  s.count++;
  s.postMs += postMs;
  if (postMs > s.maxPostMs) s.maxPostMs = postMs;
  try {
    var bytes = JSON.stringify(payload).length;
    s.bytes += bytes;
    if (bytes > s.maxBytes) s.maxBytes = bytes;
  } catch (e) { /* 無法序列化就只記時間 */ }
}

function measureSnapshot() {
  if (!MEASURE) return null;
  var out = Object.create(null);
  for (var type in MEASURE_STATS) {
    var s = MEASURE_STATS[type];
    out[type] = {
      count: s.count,
      avgBytes: Math.round(s.bytes / s.count),
      maxBytes: s.maxBytes,
      avgPostMs: +(s.postMs / s.count).toFixed(3),
      maxPostMs: +s.maxPostMs.toFixed(3)
    };
  }
  return out;
}

function post(type, payload) {
  payload = payload || {};
  payload.type = type;
  if (!MEASURE) { self.postMessage(payload); return; }
  var t0 = performance.now();
  self.postMessage(payload);
  measureRecord(type, payload, performance.now() - t0);
}

function reportError(where, err) {
  post(MSG_OUT.ERROR, {
    where: where,
    message: err && err.message ? err.message : String(err),
    stack: err && err.stack ? String(err.stack) : ''
  });
}

/* ---- 背景掛機（v9 起）----
   遊戲規則：**分頁在背景＝仍在線上掛機，只有整個遊戲被關掉才算離線。**
   所以隱藏分頁一律維持即時模擬，離線結算只在開機時發生（見 boot）。

   舊版在隱藏 60 秒後停止推進、回前景改用離線收益補，那是從單執行緒 main.js
   繼承來的。它有兩個問題：離線收益是**另一套固定費率模型**（每 20 秒殺一隻
   best−10 的菁英怪，與玩家實際 DPS 與所在關卡無關），拿它替代即時模擬等於
   在背景換一套玩法；而且休眠門檻用 `_hiddenAt` 起算、離線結算的 60 秒下限卻用
   `savedAt` 起算，兩個基準不同——背景約 60～120 秒這段會兩邊都不給，收益是 0。

   真正要解決的是瀏覽器對背景分頁計時器的降頻：計時器晚回來時，
   `elapsed` 會一次很大，舊碼直接截斷成 10 秒，等於把降頻期間的時間丟掉。
   改為「欠帳 + 每次 loop 花固定 CPU 預算補」，時間不丟，也不會為了補進度
   把 Worker 卡住不回訊息。

   量測（Node，V8）：模擬 1 小時遊戲時間＝新手 1.5 秒、後期存檔（Lv.260、背包 800）
   2.4 秒 CPU。所以補一小時只要兩秒多——舊的 10 秒上限是主執行緒才需要的限制
   （在那裡補 10 秒以上會凍畫面），Worker 裡沒有這個約束。 */
var _catchupDebt = 0;          // 尚未補完的遊戲時間（秒）
var _offlineBootTimer = 0;
// 與離線收益同上限：背景掛機不該比關掉遊戲更優待。typeof 保護是因為既有測試會以
// importScripts 空實作載入本檔（模擬層未載入），不能讓模組載入期就炸掉。
var MAX_CATCHUP_DEBT_SEC = (typeof OFFLINE_MAX_HOURS === 'number' ? OFFLINE_MAX_HOURS : 24) * 3600;
var CATCHUP_BUDGET_MS = 30;    // 單次 loop 最多花在補進度的 CPU 時間
var MAX_CATCHUP_STEPS = 2000;  // 保險絲：單次 loop 的步數硬上限（200 秒遊戲時間）

/* 回報給主執行緒的「正在補進度」門檻。每次 loop 進來時 _catchupDebt 本來就有一個
   TICK_MS，那是正常節奏不是欠帳；超過一秒才代表真的落後了。
   主執行緒拿它放寬 watchdog 的判定門檻（見 bridge.js 的存活監測）。 */
var CATCHUP_REPORT_MIN_SEC = 1;

/* 補進度的計時來源要與遊戲時間分開：Date.now() 在測試裡是可控的假時鐘，
   拿它當預算計時會失效。performance.now() 是單調時鐘，正是這裡要的。 */
function catchupClock() {
  return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

/* ---- 由 ui.js 搬回 Worker 的狀態維護 ----
   這三段原本寫在渲染函式裡，等於「畫面更新時順便改存檔」。渲染有副作用本身就是問題：
   切到別的頁籤就不會發生，開了 PiP 又會重複發生。狀態維護屬於模擬層，搬回這裡。
   P3 請把 ui.js 對應的那幾段刪掉，只保留讀取。 */

/* 資源列首次顯示旗標：數量大於 0 就永久解鎖（原 ui.js renderHeader 內）。
   鍵名沿用 DOM id（r-essence…），因為既有存檔就是這樣存的，不能為了好看而破壞相容。 */
var SHOWN_RES_KEYS = [
  ['r-essence', 'essence'], ['r-dust', 'dust'], ['r-ancient-essence', 'ancientEssence'],
  ['r-soul-origin', 'soulOrigin'], ['r-demon-seed', 'demonSeed'], ['r-magic-scroll', 'magicScroll']
];

/* 旗標是**設了就不會再清除**的，所以已經是 true 的就不必再算一次。
   這個 early-skip 不改變任何語意，純粹省掉重複計算——而它省掉的量不小：
   本函式每 0.2 秒跑一次，其中 totalGemsAll() 會掃過全部寶石種類 × 5 個等級，
   `for in p.books` 又是一次物件走訪。headless 縮時模擬的 profile 顯示這一支
   （含 totalGemsAll/gemCount）佔掉總 CPU 的 39%，只為了決定頂欄圖示要不要顯示。
   瀏覽器端同樣每秒跑 5 次，玩家的機器也一直在付這筆錢。 */
function updateShownRes() {
  var p = G && G.player;
  if (!p) return;
  if (!p.shownRes) p.shownRes = {};
  var sr = p.shownRes;
  for (var i = 0; i < SHOWN_RES_KEYS.length; i++) {
    var key = SHOWN_RES_KEYS[i][0];
    if (!sr[key] && (p[SHOWN_RES_KEYS[i][1]] || 0) > 0) sr[key] = true;
  }
  if (!sr['r-gems'] && typeof totalGemsAll === 'function' && totalGemsAll() > 0) sr['r-gems'] = true;
  if (!sr['r-books']) {
    var books = 0;
    for (var bk in p.books) books += p.books[bk] || 0;
    if (books > 0) sr['r-books'] = true;
  }
}

/* 鑲孔補齊：舊存檔的裝備可能缺 sockets 欄位。原本靠 ui.js 渲染詳情時才補
   （`ensureSockets(it)`），代表沒點開過的裝備永遠不會被補到，鑲孔數也就時有時無。
   改在讀檔後一次補齊全部裝備。 */
function backfillItemSockets() {
  if (typeof ensureSockets !== 'function' || !G) return;
  var seen = [];
  function walk(list) {
    if (!list) return;
    for (var k in list) {
      var it = list[k];
      if (it && it.id && seen.indexOf(it) === -1) {
        seen.push(it);
        ensureSockets(it);
        if (typeof normalizeTwoHandItemCounts === 'function') normalizeTwoHandItemCounts(it);
      }
    }
  }
  walk(G.inventory);
  walk(G.equipment);
  if (Array.isArray(G.equipmentSets)) G.equipmentSets.forEach(walk);
  if (typeof newForgeAllQueuedItems === 'function') walk(newForgeAllQueuedItems(G));
}

/* 寶石商店維護：首次鋪貨與 8 小時定時重置。
   原本由 UI 呼叫 rollGemShop / shopHourlyReset（兩者都在 INTERNAL_ONLY 名單上），
   等於「有沒有打開寶石頁」決定商店會不會刷新。移到這裡由模擬層自己維護。

   首次鋪貨的條件是 items 為空。買光不會讓它變空——buyShopGem 是設 item.sold = true
   而非移除項目（item.js:318），所以不會出現免費重刷。 */
function maintainGemShop() {
  if (typeof gemShop !== 'function') return;
  if (typeof shopHourlyReset === 'function') shopHourlyReset();
  var s = gemShop();
  if (typeof rollGemShop === 'function' && (!s.items || !s.items.length)) {
    rollGemShop();
    UI.dirty.gems = true;
  }
}

/* 戰鬥中每個 emit 週期都把 battle 標髒。

   為什麼需要這一支：血條畫在 battle 面板裡，面板不推就不會重畫。而 combat.js 的
   10 處 UI.dirty.battle 全部落在**結構性事件**上（暫停、敵人清單變動、復活、新波生成、
   清波、死亡退場、換關），傷害套用的路徑上一處都沒有。

   實測（2.5 分鐘、1500 個 200ms 週期）：血量有變化的 824 幀裡，只有 157 幀（19%）
   通知了畫面；兩次刷新最長間隔 3.6 秒。玩家看到的是「好幾秒不掉血，然後忽然見底」——
   累積數秒的傷害在下一次結構性事件時一次現形。

   刻意不逐一去傷害來源補標記：DoT、反傷、多段技、敵人技能、吸血各有各的路徑，
   補得完也保證不了下一個新增的傷害來源會記得補。改成「戰鬥中就是每幀都要重畫」，
   一處涵蓋全部。battle 面板實測 2.8 KB，5Hz 約 14 KB/秒，成本可忽略。 */
function markCombatDirty() {
  if (typeof isCombatPaused === 'function' && isCombatPaused()) return; // 暫停時沒有東西會動
  /* 既有測試有些用精簡 context 直接驅動 loop()，那裡沒有 UI 替身。
     沿用 js/combat.js:26 的既有寫法防護，不要求測試為了這支去補環境。 */
  if (typeof UI !== 'undefined' && UI.dirty) UI.dirty.battle = true;
}

/* 神鑄開放公告：原本由 uiTick 偵測並寫旗標。改由 Worker 在解鎖當下設旗標並送一次事件，
   UI 只負責顯示。旗標寫在存檔裡，所以只會提示一次。 */
function checkForgeUnlockNotice() {
  if (typeof forgeUnlocked !== 'function' || !forgeUnlocked()) return;
  var fs = forgeState();
  if (fs.unlockNotified) return;
  fs.unlockNotified = true;
  UI.dirty.header = true;
  shimPushEvent('notice', { key: 'forgeUnlocked', modal: true });
}

/* ---- 模擬時鐘 ----
   與 js/util.js:4 的 GT 只差一件事：GT 在戰鬥暫停時停住，SIM_T 照走。

   GT 停住是它的語意（它衡量「打了多久」），但暫停期間 simStep 仍然在跑
   factoryTick / newForgeTick / forgeTick——狀態有在動，只是 GT 沒記錄到。
   於是任何想用時間軸把兩次執行對齊的東西（真人軌跡重播、瀏覽器↔headless 交叉驗證）
   一碰到暫停就整批錯開，而分岔點會落在暫停之後好幾秒，看起來像別的原因。

   SIM_T 是那條不會停的軸。與 GT 同樣是每步累加、從 0 起算、不進存檔，
   所以兩次執行只要從同一份存檔開機，它就是同一條刻度。 */
var SIM_T = 0;

function simStep(dt) {
  SIM_T += dt;
  var combatPaused = typeof isCombatPaused === 'function' && isCombatPaused();
  if (!combatPaused) GT += dt;
  if (typeof forgeTick === 'function') forgeTick(Date.now());
  if (!combatPaused) {
    if (typeof fieldTick === 'function') fieldTick(dt);
    if (typeof towerTick === 'function') towerTick(dt);
  }
  if (typeof factoryTick === 'function') factoryTick(dt);
  if (typeof newForgeTick === 'function') newForgeTick(dt);
}

/* 決定論測試模式的迴圈：每次計時器只走**一整步**，維護區塊固定每 N 步跑一次。
   刻意寫成獨立分支而不是在正式路徑上灑條件式——正式路徑一行都不該被這個模式影響。

   為什麼連節奏都要釘死：正式路徑的維護區塊是照真實時間 5Hz 跑的，而 maintainGemShop
   首次會呼叫 rollGemShop() 消耗亂數。它在第 2 步還是第 3 步被呼叫，取決於計時器抖動；
   一旦與 headless 不同，之後整條亂數序列就對不上，比對結果會全錯而且看不出原因。

   測試模式下遊戲時間會落後真實時間（每個計時器週期只走 0.1 秒），這是刻意的：
   要的是可重現的步序，不是即時性。

   同時**不做非自願的落地存檔**——不去動測試用 origin 的儲存空間。這件事由
   requestPersist 把關（見該處說明），不是靠這個迴圈剛好沒呼叫自動存檔：
   onVisibility 的 SHUTDOWN 不經過這裡，只靠迴圈是擋不住的。 */
var _detSteps = 0;
function emitUrgentVisualEvents() {
  if (typeof shimDrainUrgentVisualEvents !== 'function') return;
  var events = shimDrainUrgentVisualEvents();
  if (events.length) post(MSG_OUT.VISUAL, { events: events });
}

function deterministicLoop() {
  if (!_booted) return;
  try {
    simStep(TICK_MS / 1000);
    emitUrgentVisualEvents();
    _detSteps++;
    if (_detSteps % Math.round(TICK_EMIT_MS / TICK_MS) === 0) {
      updateShownRes();
      maintainGemShop();
      checkForgeUnlockNotice();
      markCombatDirty();
      emitTick();
    }
  } catch (e) {
    reportError('deterministicLoop', e);
  }
}

function loop() {
  if (!_booted) return;
  if (DETERMINISTIC_STEPS) { deterministicLoop(); return; }
  try {
    var now = Date.now();
    /* 經過時間一律進欠帳，不截斷——截斷等於把背景降頻期間的時間送給瀏覽器。
       上限只擋「分頁被凍結好幾天」這種極端值。 */
    _catchupDebt = Math.min(_catchupDebt + (now - _lastTickAt) / 1000, MAX_CATCHUP_DEBT_SEC);
    _lastTickAt = now;

    /* 用 CPU 預算而非固定秒數收斂：不同裝置與不同存檔大小的每步成本差很多，
       固定秒數要嘛在慢機器上卡住 Worker、要嘛在快機器上補得沒必要地慢。
       預算用完就把剩下的留到下一次 loop，期間 Worker 仍能回應面板與指令。 */
    var budgetUntil = catchupClock() + CATCHUP_BUDGET_MS;
    var stepped = 0;
    var steps = 0;
    while (_catchupDebt > 0.0001) {
      var dt = Math.min(_catchupDebt, TICK_MS / 1000);
      simStep(dt);
      emitUrgentVisualEvents();
      _catchupDebt -= dt;
      stepped += dt;
      /* 步數上限是保險絲：計時來源若被替換成不會前進的假時鐘（既有測試就是這樣），
         只靠 CPU 預算會一路把欠帳跑完，變成一次很長的同步工作。 */
      if (++steps >= MAX_CATCHUP_STEPS || catchupClock() >= budgetUntil) break;
    }

    /* 一律以 now（真實時間）判斷，`stepped` 只用來推進模擬，不參與節流——見宣告處的說明。
       補進度期間 UI 照樣 5Hz 更新、自動存檔照樣 15 秒一次，與正常遊玩完全相同。 */
    if (now - _lastEmitAt >= TICK_EMIT_MS) {
      _lastEmitAt = now;
      updateShownRes();
      maintainGemShop();
      checkForgeUnlockNotice();
      markCombatDirty();
      emitTick();
    }

    if (now - _lastAutoAt >= AUTOSAVE_SEC * 1000) {
      _lastAutoAt = now;
      requestPersist(PERSIST_KINDS.AUTO);
    }

    if (now - _lastFolderAt >= FOLDER_AUTOSAVE_SEC * 1000) {
      _lastFolderAt = now;
      requestPersist(PERSIST_KINDS.FOLDER);
    }
  } catch (e) {
    reportError('loop', e);
  }
}

/* ---- 高頻視圖 ----
   只放 TICK_VIEW_KEYS 列出的純量。背包、技能樹等大型結構一律走 panel。 */
function buildView() {
  var p = (G && G.player) || {};
  var st = (G && G.stage) || {};
  var fp = (typeof FIELD !== 'undefined' && FIELD) ? FIELD.player : null;
  var stats = (typeof getStats === 'function') ? getStats() : null;
  var tv = (G && typeof taskQuickView === 'function') ? taskQuickView() : null;
  // 附魔書在狀態裡是每種一格的物件；頂欄只顯示總數，別把整個物件塞進高頻視圖
  var bookTotal = 0;
  for (var bk in p.books) bookTotal += p.books[bk] || 0;
  return {
    gold: p.gold || 0,
    scrap: p.scrap || 0,
    essence: p.essence || 0,
    dust: p.dust || 0,
    ancientEssence: p.ancientEssence || 0,
    soulOrigin: p.soulOrigin || 0,
    demonSeed: p.demonSeed || 0,
    magicScroll: p.magicScroll || 0,
    gems: (typeof totalGemsAll === 'function') ? totalGemsAll() : 0,
    books: bookTotal,
    level: p.level || 0,
    xp: p.xp || 0,
    xpMax: (typeof xpForLevel === 'function') ? xpForLevel(p.level || 1) : 0,
    hp: fp ? fp.hp : 0,
    hpMax: stats ? stats.hp : 0,
    mp: fp ? fp.mp : 0,
    mpMax: stats ? stats.mp : 0,
    shield: fp ? fp.shield : 0,
    stage: st.current || 0,
    zone: st.zone || '',
    gt: GT,
    /* 見 SIM_T 宣告處：暫停時 gt 停住、simT 照走，對齊用的是後者。 */
    simT: SIM_T,
    paused: typeof isCombatPaused === 'function' ? !!isCombatPaused() : false,
    towerActive: !!(G && G.tower && G.tower.active),
    forgeBusy: typeof forgeIsBusy === 'function' ? !!forgeIsBusy() : false,
    /* 任務快捷列（v18）：三個純量；名稱與獎勵文字由主執行緒讀共載 TASKS 表 */
    taskIdx: tv ? tv.idx : -1,
    taskProg: tv ? tv.prog : 0,
    taskReady: tv ? tv.ready : false
  };
}

function emitTick() {
  post(MSG_OUT.TICK, {
    view: buildView(),
    dirty: shimDrainDirty(),
    events: shimDrainEvents(),
    diag: shimDiagSnapshot(),
    measure: measureSnapshot(),
    // 一個數字，成本可忽略；主執行緒靠它判斷 Worker 是「忙著補進度」還是「死了」
    catchup: _catchupDebt > CATCHUP_REPORT_MIN_SEC ? Math.round(_catchupDebt) : 0
  });
}

/* ---- 面板資料 ----
   P4 會依實測結果再裁切；目前先給該面板需要的狀態切片，不整份丟。 */
/* ---- 背包投影 ----
   背包格子只用到 7 個直接欄位，加上 itemEnchants() 的 enchant/enchants
   與 ancientStarBadgeHTML() 需要的太古詞條數。詞條本身不送：
   實測後期存檔 800 件完整資料 305 KB，投影後 122 KB（少 60%），
   而保留 affixes 只能少 17%——詞條就是主體。

   需要完整資料的地方（詳情面板、格子 tooltip）改用 params.detailIds 按需索取。 */
var INV_CELL_FIELDS = ['id', 'rarity', 'slot', 'level', 'upgrade', 'synthesized',
                       'locked', 'name', 'weaponType', 'enchant', 'enchants', 'kind'];
var INV_DETAIL_MAX = 200; // 單次索取明細的上限，避免一次要回整包

function inventoryCellView(it) {
  var out = {};
  for (var i = 0; i < INV_CELL_FIELDS.length; i++) {
    var f = INV_CELL_FIELDS[i];
    if (it[f] !== undefined) out[f] = it[f];
  }
  /* getItemAncientCount 住在 item.js（importScripts 順序在本檔之前），直接呼叫。
     這裡傳的是真實物品（有 affixes、沒有 ancientCount），走的是逐條計數那條路徑；
     item.js 裡的 ancientCount 短路分支是給主執行緒讀投影用的。 */
  out.ancientCount = getItemAncientCount(it);
  /* 裝備強弱評分。與 ancientCount 同理：投影裁掉了 affixes/sockets，
     而 itemScore() 需要那些欄位，所以只能在還握有真實物品的這裡算。

     加這個欄位是為了讓「換裝」這個動作有依據。背包投影原本只有品質與等級，
     光看品質換裝是錯的——R0+6 可能比 R2+0 強。評分是遊戲既有的判準
     （js/formula.js:1325，背包滿載「捨弱留強」用的就是它），
     暴露出來之後，模擬器的策略層才能像玩家一樣「看數字挑最好的穿」，
     而不需要自己實作一套強弱比較。 */
  out.score = (typeof itemScore === 'function') ? itemScore(it) : 0;
  /* 這件裝備可以裝在哪些部位（js/data.js:346 的 equipSlotsForItem）。
     不能靠「把部位鍵結尾的數字去掉」來推：雙手武器的合法部位只有 weapon，
     推出來的 weapon2 會讓遊戲為了騰出副手而把主手卸下（js/player.js:291），
     結果主手變空、武器躺在副手。哪件能裝哪裡是遊戲的規則，讓遊戲自己講。 */
  out.slots = (typeof equipSlotsForItem === 'function') ? equipSlotsForItem(it) : [];
  return out;
}

/* ---- 神鑄法陣投影 ----

   params.craft 為 falsy 時只回原本的 forge 狀態（UI 走這條，行為不變）。
   宣告 craft 的策略才會付掃背包的成本。

   為什麼要在遊戲這一側算：
   1. **產物等級 ＝ 六件素材中最高那一件**（js/forge.js resolveForge 的
      `maxLv = Math.max(maxLv, it.level)`）。所以只要一件高等就夠，另外五件是
      同品質的垃圾也無所謂。策略要挑「等級最高的一件 ＋ 等級最低的五件」，
      而背包是策略讀不到的（ROI 策略刻意關掉 panels.inv.items，見 buildInventoryPanel）。
   2. 成功率、每魔塵加成與金幣成本三者都有 CHAOS 例外分支
      （forgeBaseRateFor / forgeDustRateFor / forgeGoldCostFor），抄一份到策略裡
      遲早跟遊戲脫鉤。

   ⚠️ 純讀取：只呼叫遊戲的查詢函式，一個欄位都不寫回 G。 */
function buildForgePanel(params) {
  var out = { forge: (typeof forgeState === 'function') ? forgeState() : G.forge };
  if (!params || !params.craft) return out;

  var keep = Math.max(1, Math.floor(Number(params.keepPerRarity) || (FORGE_SLOTS + 2)));
  /* ⚠️ 不可以呼叫 forgeUnlocked()——它會**寫入存檔**：條件成立時把
     f.unlocked = true 快取回 G.forge（js/forge.js:44）。面板必須唯讀，
     否則「有沒有建過面板」會改變存檔雜湊，決定論一破所有 A/B 比對都失效
     （tests/sim-forge-craft.test.cjs 以存檔雜湊反證）。
     所以這裡讀同一組條件但不回寫。 */
  out.unlocked = !!(out.forge && out.forge.unlocked)
    || ((G.player && G.player.level) >= FORGE_UNLOCK_LEVEL
      && (typeof reincarnationCount === 'function' ? reincarnationCount() : 0) >= FORGE_UNLOCK_REINCARNATION);
  out.slotsNeeded = FORGE_SLOTS;
  out.minRarity = (typeof FORGE_MIN_RARITY === 'number') ? FORGE_MIN_RARITY : null;
  out.failConsume = (typeof FORGE_FAIL_CONSUME === 'number') ? FORGE_FAIL_CONSUME : null;
  out.dustOwned = (G.player && G.player.dust) || 0;
  out.placed = (typeof forgeItemCount === 'function') ? forgeItemCount() : 0;
  out.crafting = !!(out.forge && out.forge.crafting);

  /* ---- 裝備：逐品質的候選 ---- */
  var byR = {};
  var inv = Array.isArray(G.inventory) ? G.inventory : [];
  for (var i = 0; i < inv.length; i++) {
    var it = inv[i];
    if (!it || it.locked || it.kind === 'gem') continue;          // 與 forgeAutoFillApply 同一組條件
    var r = it.rarity;
    if (typeof isForgeableEquipmentRarity === 'function' && !isForgeableEquipmentRarity(r)) continue;
    var b = byR[r] || (byR[r] = { count: 0, all: [] });
    b.count++;
    b.all.push({ id: it.id, level: it.level || 1 });
  }
  out.equip = {};
  for (var rk in byR) {
    var bucket = byR[rk];
    /* 等級高的在前。同級時維持原順序即可——決定論只要求「同一份輸入給同一份輸出」。 */
    bucket.all.sort(function (a, b2) { return b2.level - a.level; });
    var n = bucket.all.length;
    out.equip[rk] = {
      count: bucket.count,
      /* 等級最高的幾件（挑「等級載體」用）與等級最低的幾件（挑墊檔用）。
         兩份都裁到 keep 筆，避免深局背包上千件時把面板灌爆。 */
      top: bucket.all.slice(0, keep),
      low: bucket.all.slice(Math.max(0, n - keep)).reverse(),
      base: (typeof forgeBaseRateFor === 'function') ? forgeBaseRateFor(Number(rk)) : null,
      dustRate: (typeof forgeDustRateFor === 'function') ? forgeDustRateFor(Number(rk)) : null,
      cost: (typeof forgeGoldCostFor === 'function') ? forgeGoldCostFor(Number(rk)) : null
    };
  }

  /* ---- 寶石：逐階級「哪些種類湊得滿六顆」---- */
  out.gem = {};
  var gems = (G.player && G.player.gems) || {};
  for (var type in gems) {
    var byLv = gems[type] || {};
    for (var lv in byLv) {
      var have = Number(byLv[lv]) || 0;
      if (have < FORGE_SLOTS) continue;
      if (!(typeof FORGE_GEM_BASE_RATE !== 'undefined' && FORGE_GEM_BASE_RATE[lv] !== undefined)) continue;
      var slot = out.gem[lv] || (out.gem[lv] = {
        types: [],
        base: FORGE_GEM_BASE_RATE[lv],
        dustRate: (typeof FORGE_GEM_DUST_RATE === 'number') ? FORGE_GEM_DUST_RATE : null,
        cost: (typeof forgeGemCost === 'function') ? forgeGemCost(Number(lv)) : null
      });
      slot.types.push({ type: type, count: have });
    }
  }
  for (var glv in out.gem) {
    /* 數量多的先燒，並以種類名穩定排序——同數量時的順序不能隨物件列舉順序漂移。 */
    out.gem[glv].types.sort(function (a, b3) {
      return (b3.count - a.count) || (a.type < b3.type ? -1 : (a.type > b3.type ? 1 : 0));
    });
  }
  return out;
}

function buildInventoryPanel(params) {
  var items = Array.isArray(G.inventory) ? G.inventory : [];
  var details = null;
  var i, j;

  /* params.items === false：呼叫端明講「我不看這份清單」，那就別建。

     投影一格要跑一次 itemScore（遍歷詞條、寶石、附魔），深局背包 300 件時
     整份清單約 4.4 ms——而 AI 模擬器的 ROI 策略每 5 遊戲秒建一次面板卻**從不讀
     items**（它改用 panels.eval.slotUpgrades 挑換裝）。實測那是 headless 總 CPU
     的 16%，外加每次 129KB 的序列化與深拷貝，全部丟掉。

     其餘欄位一個都不動：count / cap / equipmentScores / equipmentRarities …
     都還在，所以「背包有多滿」「身上那件多強」這些判斷不受影響。
     UI 不傳 params，走的仍然是原本的路徑。 */
  var wantItems = !(params && params.items === false);

  /* params.full：一次要回全部裝備的完整資料。
     這是給關鍵字搜尋用的——它要比對詞條、傳奇特效、太古詞條，就是投影裁掉的那些。
     關鍵字篩選只在內網／本機出現（ui.js 的 isInternalServer()），正式環境的玩家
     看不到那個輸入框，所以這條路徑不會落到玩家身上。
     ⚠️ 不要為了搜尋把這些欄位加回投影：實測加回 affixes 後裁切效益從 56% 掉到 17%。 */
  if (params && params.full === true) {
    details = {};
    for (j = 0; j < items.length; j++) if (items[j]) details[items[j].id] = items[j];
  } else {
    var ids = params && params.detailIds;
    if (Array.isArray(ids) && ids.length) {
      details = {};
      var wanted = {};
      for (i = 0; i < ids.length && i < INV_DETAIL_MAX; i++) wanted[ids[i]] = true;
      for (j = 0; j < items.length; j++) {
        if (items[j] && wanted[items[j].id]) details[items[j].id] = items[j];
      }
    }
  }

  return {
    items: wantItems ? items.map(inventoryCellView) : [],
    details: details,
    count: items.length,
    cap: inventoryCapacityNow(),
    settings: G.settings,                     // compareEq：詳情是否顯示與現有裝備的比較
    equipment: G.equipment,                   // 比較對象＝目前穿戴那套
    viewEquipment: (typeof viewedEquipment === 'function') ? viewedEquipment() : G.equipment,
    /* 目前穿戴那套的評分，與 items[].score 同一把尺（js/formula.js:1325 的 itemScore）。
       沒有這組數字，就只能拿「背包最好的一件」跟空氣比——換裝會變成無條件換，
       把 R0+6 換成 R2+0 反而更弱。 */
    equipmentScores: (function () {
      var out = {};
      var eq = G.equipment || {};
      for (var slot in eq) {
        if (!eq[slot]) { out[slot] = 0; continue; }
        out[slot] = (typeof itemScore === 'function') ? itemScore(eq[slot]) : 0;
      }
      return out;
    })(),
    equipmentRarities: (function () {
      var out = {};
      var eq = G.equipment || {};
      for (var slot in eq) {
        if (!eq[slot]) { out[slot] = -1; continue; }
        out[slot] = typeof eq[slot].rarity === 'number' ? eq[slot].rarity : 0;
      }
      return out;
    })(),
    /* 身上最低品質（空部位不算）。equipmentRarities 是逐部位的表，
       而條件式（策略的 targets.when / rules.if）只比得了純量——
       「全身穿到神話以上了嗎」這種前提沒有這個欄位就表達不出來。
       全空回 -1，語意與逐部位的空值一致。 */
    equipmentRarityMin: (function () {
      var eq = G.equipment || {}, min = null;
      for (var slot in eq) {
        if (!eq[slot]) continue;
        var rv = typeof eq[slot].rarity === 'number' ? eq[slot].rarity : 0;
        if (min === null || rv < min) min = rv;
      }
      return min === null ? -1 : min;
    })(),
    /* 附魔書庫存（逐種）。view.books 只有總數，決定「這件要附什麼」時不夠用。 */
    books: G.player ? (G.player.books || {}) : {},
    /* 下一次背包擴充的金幣成本；已達上限時為 null。
       沒有這個數字的話，外面只能「先送出再看它回金幣不足」——實測一次 101 小時
       的模擬送了 1,212 次擴充、其中 1,014 次是金幣不足的空轉。 */
    expandCost: (function () {
      if (typeof inventoryExpandCost !== 'function') return null;
      var upg = (G.player && G.player.invUpgrades) || 0;
      if (typeof INVENTORY_CAP === 'number' && typeof INVENTORY_MAX === 'number'
        && INVENTORY_CAP + upg >= INVENTORY_MAX) return null;
      return inventoryExpandCost(upg);
    })(),
    /* 每個部位能用的附魔類別與可放幾條——兩者都由遊戲的函式算，不在外面重推。
       部位與類別的對應（武器/戒指/手套/護腕＝攻擊，項鍊/鞋子＝功能，其餘＝防禦）
       是遊戲規則，抄一份到策略裡遲早會跟遊戲脫鉤，而 manualEnchant 只會回一句
       「XX 只能使用 OO 類附魔」，看報表完全不會發現整條規則沒生效過。 */
    equipmentEnchantInfo: (function () {
      var out = {};
      var eq = G.equipment || {};
      for (var slot in eq) {
        if (!eq[slot]) continue;
        out[slot] = {
          cat: (typeof enchantCatForType === 'function') ? enchantCatForType(eq[slot].slot) : null,
          cap: (typeof enchantCapFor === 'function') ? enchantCapFor(eq[slot]) : 0
        };
      }
      return out;
    })()
  };
}

/* 熔爐頁只需要佇列數量、傳送帶圖示與零件設定；不要把數千件完整裝備
   透過 structured clone 傳到主執行緒。大量拆解後，完整 queue 會拖慢 DOM
   與點擊事件，讓升級按鈕看似沒有反應。 */
function newForgePanelView(nf) {
  nf = nf || {};
  var furnaces = Array.isArray(nf.furnaces) ? nf.furnaces : [];
  return {
    queueCount: Array.isArray(nf.queue) ? nf.queue.length : 0,
    furnaces: furnaces.map(function (fu) {
      fu = fu || {};
      return {
        id: fu.id,
        enabled: !!fu.enabled,
        qualities: Array.isArray(fu.qualities) ? fu.qualities.slice() : [],
        parts: Array.isArray(fu.parts) ? fu.parts.map(function (p) { return p && p.key ? { key: p.key } : null; }).filter(Boolean) : [],
        partSlots: Number(fu.partSlots) || 0,
        queueCount: Array.isArray(fu.queue) ? fu.queue.length : 0,
        belt: (Array.isArray(fu.belt) ? fu.belt : []).slice(0, NEW_FORGE_BELT_SHOW).map(function (it) {
          return it ? { rarity: it.rarity, slot: it.slot, name: it.name } : null;
        }).filter(Boolean)
      };
    }),
    stats: {
      salvaged: nf.stats && Number(nf.stats.salvaged) || 0,
      kept: nf.stats && Number(nf.stats.kept) || 0
    },
    tabSeen: nf.tabSeen,
    noticeShown: nf.noticeShown
  };
}

function buildPanel(name, params) {
  if (!G) return null;
  var p = G.player || {};
  switch (name) {
    case 'header':
      /* stats 是使用中那套的屬性；viewStats 是面板檢視中那套（未穿上時的預覽）。
         兩者在檢視使用中那套時是同一份，getViewStats 內部會直接回 getStats。
         dps 取自 FIELD.dpsWindow（最多 10 筆），成本可忽略。 */
      return {
        player: p, stage: G.stage,
        stats: (typeof getStats === 'function') ? getStats() : null,
        viewStats: (typeof getViewStats === 'function') ? getViewStats() : null,
        dps: (typeof currentDps === 'function') ? currentDps() : 0,
        settings: G.settings,
        autoEquip: !!(G.factory && G.factory.autoEquip),
        equipView: G.equipView, equipActive: G.equipActive
      };
    case 'battle':
      /* gt：這份快照是在哪一刻拍的。
         技能冷卻、復活倒數這些欄位存的是「還剩幾秒」而不是絕對時刻，
         而面板只在髒區時才更新——主執行緒若照著舊快照直接顯示，倒數會卡住好幾秒
         再突然歸零。有了 gt 就能扣掉「拍照到現在」經過的時間，變成真正的碼錶。 */
      return {
        gt: GT,
        field: (typeof FIELD !== 'undefined') ? FIELD : null,
        tower: (typeof TOWER !== 'undefined') ? TOWER : null,
        stage: G.stage, zoneProgress: G.zoneProgress,
        /* ---- 我現在站的這一關，掉得出哪些品質 ----

           呼叫的是掉落路徑本人用的那一支（js/combat.js 的
           fieldDropRatesFor(關卡, 怪物等級, 地圖)；怪物等級＝關卡，見
           formula.js monsterStatsFor 的 level: stage）。刻意不投影
           ZONE_STAGE_DROP_TABLE 原表：那會繞過 fieldDropRatesFor 內部
           「外部工具替換 FIELD_DROP_TABLE 時保留舊語意」那條覆寫路徑，
           於是面板說的和實際掉的會不一樣。

           為什麼要有這個欄位：關卡閘門會「品質沒到就退回去刷」，
           但如果那個品質在停下來的那一段**根本掉不出來**，那就不是門檻，
           是死鎖——實測 20 小時 × 5 個 seed 全部卡在同一關，10,185 件掉落裡
           史詩 0 件。門檻能不能達成只有遊戲知道，策略不該自己抄一份掉落表。 */
        dropRates: (typeof fieldDropRatesFor === 'function' && G.stage)
          ? fieldDropRatesFor(G.stage.current, G.stage.current, G.stage.zone)
          : null,
        /* ---- 有哪些地圖、開了沒、各自打得到第幾關 ----

           關卡改造之後每張地圖都是**有限關卡**（荒漠 200、冰原 300、沼澤 400、
           亡靈山脈 500），打到頂就再也推不動，必須換圖。解鎖條件（前置地圖與
           關卡、轉生數）由遊戲的 isZoneUnlocked 判斷，不能讓讀面板的一方自己抄
           一份 Zones.csv——那張表使用者會改。

           沒有這個欄位的話 AI 會在荒漠 200 關永久停住，而且完全沒有徵兆：
           推關指令照送、遊戲照回 ok，只是 stage.current 再也不動。 */
        zones: (function () {
          if (typeof ZONE_LIST === 'undefined' || typeof ZONES === 'undefined') return null;
          var out = [];
          for (var zi = 0; zi < ZONE_LIST.length; zi++) {
            var zk = ZONE_LIST[zi], zd = ZONES[zk];
            if (!zd) continue;
            var zp = (G.zoneProgress && G.zoneProgress[zk]) || null;
            out.push({
              key: zk,
              order: zi,
              maxStage: (typeof zoneMaxStage === 'function') ? zoneMaxStage(zk) : 0,
              unlocked: (typeof isZoneUnlocked === 'function') ? !!isZoneUnlocked(zk) : false,
              current: (zk === G.stage.zone) ? G.stage.current : (zp ? zp.current : 0),
              best: (zk === G.stage.zone) ? G.stage.best : (zp ? zp.best : 0)
            });
          }
          return out;
        })(),
        runStats: self.RUN_STATS || null, lootStats: self.LOOT_STATS || null
      };
    case 'equip':
      return {
        equipment: G.equipment, sets: G.equipmentSets, equipSetNames: G.equipSetNames,
        equipActive: G.equipActive, equipView: G.equipView,
        settings: G.settings,
        stats: (typeof getStats === 'function') ? getStats() : null,
        viewStats: (typeof getViewStats === 'function') ? getViewStats() : null,
        /* 每種詞條能出現在哪些部位、要什麼品質才會出現。取自 AFFIX_POOL，
           是靜態的遊戲規則，不隨狀態改變。

           為什麼要送出來：不送的話，任何「想洗出某條詞條」的一方都得自己抄一份
           部位清單——抄錯就會把精華花在洗不出來的部位上，而且完全沒有徵兆。
           實測踩過：AI 策略手寫的清單裡放了 weapon（命中率根本不能出現在武器上）
           與 bracers（遊戲的鍵是 wrist），375 次洗煉一條都沒洗出來。
           規則的唯一來源是 AFFIX_POOL，讀它就不會有第二份會過期的副本。 */
        affixRules: (function () {
          if (typeof AFFIX_POOL === 'undefined') return null;
          var out = {};
          for (var k in AFFIX_POOL) {
            var d = AFFIX_POOL[k];
            if (!d) continue;
            out[k] = { slots: d.slots || null, minR: (d.minR === undefined) ? null : d.minR };
          }
          return out;
        })()
      };
    case 'inv':
      return buildInventoryPanel(params);
    case 'forge':
      return buildForgePanel(params);
    case 'newforge':
      return {
        newForge: newForgePanelView(G.newForge),
        /* 下一格零件格的解鎖金幣（逐爐，與 furnaces 同索引；已達上限為 null）。
           理由與上面 inv 的 expandCost 完全相同：沒有這個數字，外面只能「先送出
           再看它回金幣不足」。而且這條成本與**熔爐座數和轉生數連動**
           （newForgePartSlotCost），抄一份到策略裡遲早會跟遊戲脫鉤。
           ⚠️ 另開一個陣列而不是塞進 fu——furnaces 就是存檔本體，寫進去會污染存檔。 */
        partSlotCost: (function () {
          var nf = G.newForge;
          if (!nf || typeof newForgePartSlotCost !== 'function') return null;
          var reinc = (typeof reincarnationCount === 'function') ? reincarnationCount() : 0;
          var out = [];
          for (var i = 0; i < nf.furnaces.length; i++) {
            var fu = nf.furnaces[i];
            out.push(fu.partSlots >= NEW_FORGE_PART_SLOTS_MAX
              ? null
              : newForgePartSlotCost(reinc, fu.partSlots, nf.furnaces.length));
          }
          return out;
        })(),
        partSlotsMax: (typeof NEW_FORGE_PART_SLOTS_MAX === 'number') ? NEW_FORGE_PART_SLOTS_MAX : null,
        partLevels: (function () {
          var f = G.factory, out = {};
          Object.keys(PART_TYPES).forEach(function (key) {
            out[key] = partLevelFor(key, f && f.partLevels);
          });
          return out;
        })(),
        /* 策略契約：ownedParts 是目前各分解槽零件可裝配的最高階。
           保留舊欄位名，避免策略端把缺欄位當成「永遠值得保留」。 */
        ownedParts: (function () {
          var f = G.factory, out = {};
          Object.keys(PART_TYPES).forEach(function (key) {
            if (PART_TYPES[key].node === 'salvage') out[key] = partLevelFor(key, f && f.partLevels);
          });
          (f && f.parts || []).forEach(function (p) {
            if (!p || !PART_TYPES[p.key] || PART_TYPES[p.key].node !== 'salvage') return;
            var level = Number(p.level !== undefined ? p.level : p.tier);
            if (isFinite(level)) out[p.key] = Math.max(Number(out[p.key]) || 0, Math.floor(level));
          });
          return out;
        })(),
        partUpgradeCosts: (function () {
          var f = G.factory, out = {};
          Object.keys(PART_TYPES).forEach(function (key) {
            var lv = partLevelFor(key, f && f.partLevels);
            out[key] = lv >= PART_MAX_TIER ? null : partUpgradeCost(lv + 1);
          });
          return out;
        })()
      };
    case 'factory':
      return { factory: G.factory, salvageSettings: p.salvageSettings };
    case 'tower':
      // gt 同 battle：塔內技能冷卻也是「還剩幾秒」，主執行緒要據此把倒數補到現在
      return { gt: GT, tower: G.tower, runtime: (typeof TOWER !== 'undefined') ? TOWER : null };
    case 'gems':
      // 一般寶石是 { type: { lv: n } } 計數；融合寶石才是個別實體
      return {
        gems: p.gems, fusedGems: p.fusedGems,
        shop: (typeof gemShop === 'function') ? gemShop() : p.gemShop
      };
    case 'skills':
      // 2026-07-30 熟練度制：points/budget 改由 skills.js 即時計算；mastery 供熟練度條；
      // scrolls/fusionCosts 供融合面板花費顯示（佔用狀態由 fusions[].components 推導，不另投影）
      return {
        skills: p.skills, unlocks: p.skillUnlocks, loadout: p.loadout,
        loadoutSize: (typeof loadoutSize === 'function') ? loadoutSize() : 0,
        fusions: p.fusions,
        /* 新版技能群組（v19，js/skills2.js）：只投影會變動的各階等級；
           名稱／說明／費用公式由兩端共載的 SKILLS2 表與純函式計算，不進協議。 */
        skills2: (typeof skills2PanelView === 'function') ? skills2PanelView() : null,
        points: (typeof availableSkillPoints === 'function') ? availableSkillPoints() : p.skillPoints,
        budget: (typeof totalSkillPoints === 'function') ? totalSkillPoints() : 0,
        mastery: (function () {
          var m = (typeof ensureSkillMastery === 'function') ? ensureSkillMastery() : (p.skillMastery || { level: 0, xp: 0 });
          return {
            level: m.level, xp: m.xp,
            xpMax: (typeof skillMasteryXpForLevel === 'function') ? skillMasteryXpForLevel(m.level) : 0,
            maxLevel: (typeof SKILL_MASTERY_MAX_LEVEL !== 'undefined') ? SKILL_MASTERY_MAX_LEVEL : 1000
          };
        })(),
        /* 每個技能的人物等級解鎖門檻（沒有門檻的不列）。
           純讀取：只呼叫 skillUnlockLevel（讀 SKILLS 的 unlockLv），**不呼叫
           skillUnlocked**——那一支會把結果 latch 進 G.player.skillUnlocks，
           建面板就變成寫存檔（同 seed 兩場的雜湊會不同，而症狀只是一串對不上的字串）。

           為什麼要送出來：外面要決定「這幾格裝載欄該學哪幾個主動技」，就得知道
           清單上第幾個現在真的學得起來。不送的話只能送出去看它回
           「需人物達到 Lv.100 才解鎖」，而那會讓優先序前面的未解鎖技能永久卡住名額。 */
        unlockLv: (function () {
          if (typeof SKILLS === 'undefined' || typeof skillUnlockLevel !== 'function') return null;
          var out = {};
          for (var sid in SKILLS) {
            var need = skillUnlockLevel(sid);
            if (need > 0) out[sid] = need;
          }
          return out;
        })(),
        /* 一般技能的等級上限（隨轉生數提高，js/formula.js 的 skillMaxLv 只看轉生數、
           不看技能定義，所以是單一數字）。沒有這個數字的話，外面只能對著已經滿級的
           技能一直送升級——實測 3 遊戲小時 18,377 次裡有 16,440 次是「已達最高等級」。 */
        maxLv: (typeof skillMaxLv === 'function') ? skillMaxLv({}) : null,
        scrolls: p.magicScroll || 0,
        fusionCosts: (typeof fusionGoldCost === 'function') ? {
          goldPerComp: fusionGoldCost(1), scrollPerComp: fusionScrollCost(1)
        } : null
      };
    case 'task':
      // 任務總覽（v18）：只送動態欄位（進度/已領/可領）；
      // 名稱、目標數量、獎勵文字由主執行緒讀共載的 TASKS 表（js/data.js）
      return (typeof taskPanelData === 'function') ? taskPanelData() : null;
    case 'talents':
      // 天賦與潛能等級都在 player.talents 底下（levels / potentialLevels）
      /* canReincarnate：轉生按鈕的亮燈條件，由遊戲算給面板。
         門檻（可轉生等級）是參數表的值，不該讓讀面板的一方自己抄一份——
         AI 策略就是靠這個欄位決定何時送 player.reincarnate。 */
      return {
        talents: p.talents, reincarnations: p.reincarnations,
        talentPoints: p.reincarnationTalentPoints,
        canReincarnate: (typeof canReincarnateAt === 'function')
          ? canReincarnateAt(p.level, p.reincarnations) : false
      };
    default: return null;
  }
}

/* ---- 存檔 ----
   序列化在 Worker，落地在主執行緒。savedAt 只能在收到 saveResult{ok:true} 後才算數，
   否則寫入失敗時離線結算的基準會錯位，造成收益漏算或重複結算。 */
/* 決定論測試模式下**不做非自願的落地**。

   檔頭 installTestSeed 那段寫著測試模式「不落地存檔」，但先前那句話只涵蓋
   deterministicLoop 沒有週期性自動存檔而已——onVisibility 在分頁切走時仍會
   requestPersist(SHUTDOWN)，而本函式沒有檢查 DETERMINISTIC_STEPS。
   於是以 ?seed=N 錄製或比對時只要切一次分頁，那一局用種子化亂數跑出來的狀態
   就會蓋掉玩家真正的 auto_current。實測確認過會發生。

   分辨標準是「玩家有沒有要求」，不是「會不會寫檔」：
     擋   auto / folder / shutdown   玩家沒有要求，寫入是副作用
     放行 manual / manualFolder      玩家明確按了存檔，而且寫到 IC_manual_* 另一個位置
     放行 restart                    重新開局的目的就是取代存檔，擋掉會讓它靜靜失敗
   （app.handoff 也走 shutdown，一併擋下；主執行緒等的是 _pendingWrites 歸零，
     沒有寫入就是立刻歸零，不會卡住交接。） */
/* typeof 保護的理由同 MAX_CATCHUP_DEBT_SEC：既有測試會以空的 importScripts 載入本檔，
   那時 protocol.js 沒有載入，PERSIST_KINDS 不存在。所以判斷寫在函式裡、不在載入期求值，
   也不把 'auto' / 'folder' / 'shutdown' 抄成字串字面值——那會變成契約的第二份副本。 */
function isUnattendedPersist(kind) {
  if (typeof PERSIST_KINDS === 'undefined') return false;
  return kind === PERSIST_KINDS.AUTO ||
         kind === PERSIST_KINDS.FOLDER ||
         kind === PERSIST_KINDS.SHUTDOWN;
}

function requestPersist(kind, opts) {
  if (!G) return null;
  if (DETERMINISTIC_STEPS && isUnattendedPersist(kind)) return null;
  if (_restarting && kind !== PERSIST_KINDS.RESTART) return null;
  opts = opts || {};
  try {
    var token = 'p' + (++_persistSeq);
    var prevSavedAt = G.savedAt;
    var state = opts.state || G;
    /* savedAt 的語意是「模擬已經推進到哪個時刻」，不是「這份檔案什麼時候寫的」。
       平常兩者只差一個 tick，但補欠帳時可能差好幾小時——那段時間已經進了 _catchupDebt，
       卻還沒被模擬掉。若照實寫成 Date.now()，玩家在補完之前關掉分頁或 Worker 被重啟，
       下次開機的離線結算會以為那幾小時已經結算過，整段掛機時間就此蒸發。
       往回扣掉欠帳，剩下的部分自然會由離線結算補回，不重複也不漏。
       （寫入時間本身仍記在 meta.savedAt 與檔案的 lastModified 上，存檔清單顯示不受影響。） */
    if (state === G) G.savedAt = Date.now() - Math.round(_catchupDebt * 1000);
    /* 記下是哪個 origin 寫的。存檔資料夾是實體目錄、不分 origin，這個欄位讓開機流程
       能認出「這份不是我寫的」並先問過玩家，出事時也查得出檔案的來歷。
       typeof 保護的理由同 MAX_CATCHUP_DEBT_SEC：既有測試會以空的 importScripts 載入本檔。 */
    if (typeof SAVE_ORIGIN_TAG_V2 === 'string') state.savedBy = SAVE_ORIGIN_TAG_V2;
    var json = JSON.stringify(state);
    // meta 用模擬層既有的 saveRecMeta 產生（只讀 G、不碰儲存），主執行緒不必再自行推算
    var meta = opts.meta || saveRecMeta('auto', 'auto_current', AUTO_FOLDER_FILE_V2);
    _pendingPersist[token] = { kind: kind, savedAt: G.savedAt, prevSavedAt: prevSavedAt, rollback: state === G };
    post(MSG_OUT.PERSIST, { token: token, kind: kind, payload: { json: json, meta: meta } });
    return meta;
  } catch (e) {
    reportError('requestPersist', e);
    return null;
  }
}

/* ---- 儲存 I/O 攔截 ----
   模擬層有 53 處 localStorage 呼叫，全部集中在 save.js 這幾個函式裡。
   Worker 不能碰儲存，但也不該去改 save.js（那 17 支是 116 支既有測試的受測對象）。
   作法：載入後就地換掉這幾個全域函式，讓它們改發 persist 訊息。
   模擬層其他地方照常呼叫 saveGame()，行為維持不變，只是落地端換人。

   沒被攔截到的漏網路徑會撞上 shim.js 的 localStorage 陷阱並拋出明確錯誤，
   不會靜靜寫進一個不會落地的地方。 */
function installStorageGuards() {
  self.saveGame = function () {
    requestPersist(PERSIST_KINDS.AUTO);
    return true;
  };

  self.syncSaveFolder = function () {
    requestPersist(PERSIST_KINDS.FOLDER);
    return Promise.resolve(true);
  };

  /* 檔名一律以 `IC_manual_` 開頭，標籤接在後面。
     這不是美觀問題：存檔資料夾的手動存檔掃描只認 `IC_manual_` 與 `IC_before_bulk_salvage_`
     兩種開頭（save.js 的 scanManualMetadataV2），檔名一旦不符就整個被跳過——檔案確實寫進
     資料夾，卻永遠不會出現在「存檔記錄」清單裡。

     舊版把標籤直接當成前綴，而 ui.js 的「立即存檔」傳的標籤是**存檔資料夾的名稱**，
     於是資料夾叫 Saves 的玩家產生的是 `IC_Saves_<時間戳>.json`，全部掃不到。
     實測某位使用者 7/28 之後按的 8 次立即存檔都在資料夾裡躺著，清單上一筆都沒有。 */
  function buildManualMeta(label) {
    var tag = label ? String(label).replace(/[^a-z0-9_-]+/ig, '_').replace(/^_+|_+$/g, '') : '';
    return saveRecMeta('manual', 'manual_' + Date.now().toString(36) + '_' + ri(100, 999),
      'IC_manual_' + (tag ? tag + '_' : '') + saveStamp(Date.now()) + '.json');
  }

  /* 一般手動存檔：未連接資料夾時仍要落地（舊路徑是寫進瀏覽器存檔記錄）。
     一鍵分解前的保護存檔走的就是這條，不能因為沒接資料夾就靜靜消失。 */
  self.manualSave = function (label) {
    var meta = buildManualMeta(label);
    requestPersist(PERSIST_KINDS.MANUAL, { meta: meta });
    return meta;
  };

  /* 明確「另存到資料夾」：沒接資料夾就該失敗，不要偷偷存到別的地方 */
  self.createManualSaveToFolderV2 = function (label) {
    var meta = buildManualMeta(label);
    requestPersist(PERSIST_KINDS.MANUAL_FOLDER, { meta: meta });
    return meta;
  };

  /* 重新開局。
     ⚠️ 這裡刻意「不」先存一次舊局：舊局與新局的落地目標是同一個 auto_current
     （IndexedDB 同一個 key、資料夾同一個 IC_autosave.json），先存舊局並不會保住它，
     只會和新局的寫入賽跑——實測舊局的非同步寫入在新局完成後 7ms 才落地，直接蓋掉新局，
     玩家按下重新開局後重載回來看到的仍是舊存檔。 */
  self.restartGame = function () {
    _restarting = true;
    var fresh = newGameState();
    fresh.runId = Math.max(_maxRunId, G.runId || 1) + 1; // 新局換一個局號，舊局的手動存檔不受影響
    fresh.savedAt = Date.now();
    /* saveRecMeta 是從 G 現場取值，而此刻 G 仍是舊局——直接沿用會讓存檔索引
       標成「等級 13、第 7 關」卻配著一份全新存檔。meta 必須描述 fresh。 */
    var meta = saveRecMeta('auto', 'auto_current', AUTO_FOLDER_FILE_V2);
    meta.runId = fresh.runId;
    meta.savedAt = fresh.savedAt;
    meta.level = fresh.player.level;
    meta.stage = (fresh.stage && fresh.stage.current) || 1;
    meta.zone = (fresh.stage && fresh.stage.zone) || 'desert';
    requestPersist(PERSIST_KINDS.RESTART, { state: fresh, meta: meta });
    return true;
  };

  // 讀檔一律由主執行緒讀出後以 boot / load 訊息送進來
  self.loadGame = function () { return null; };
  self.loadLatestFolderSave = function (cb) { if (cb) cb(null); };
}

function onSaveResult(msg) {
  var rec = _pendingPersist[msg.token];
  if (!rec) return;
  delete _pendingPersist[msg.token];
  /* 重新開局寫入失敗時不會 reload，這顆 Worker 得繼續活下去——
     若不解除 _restarting，之後的自動存檔會全部被靜靜丟掉。 */
  if (rec.kind === PERSIST_KINDS.RESTART && !msg.ok) {
    _restarting = false;
    shimPushEvent('log', { msg: '⚠️ 重新開局失敗：' + (msg.error || '未知原因'), cls: 'warn' });
  }
  if (!msg.ok && G && rec.rollback) {
    // 落地失敗：把 savedAt 退回上一次成功的值，讓下次離線結算仍以真正落地的時間點為準
    G.savedAt = rec.prevSavedAt;
    shimPushEvent('log', { msg: '⚠️ 存檔寫入失敗：' + (msg.error || '未知原因'), cls: 'warn' });
  }
}

/* ---- 指令 ----
   跨執行緒不能傳物件參考，所以 itemId / gemId / partId 在此解析回物件後，
   再呼叫模擬層原本的函式。

   ⚠️ P3 注意：以下用「spec.args 的鍵順序 = 原函式參數順序」做通用派送。
   多數指令成立，但吃 eq、ref 等特殊參數的（equipItem、fuseGemsV2、
   forgePlaceItem、newForgeInstallPart…）必須逐一核對簽章後補上專屬轉接，
   不要假設通用路徑一定對。 */
/* 由 id 找出物件。搜尋範圍刻意限定「背包 + 目前穿戴的裝備欄」，與 ui.js 的
   findItemById 一致（不含神鑄法陣槽位——那邊要用 slotIndex 取回）。

   存檔會同時序列化 G.equipment 與 active 的 G.equipmentSets，同一件裝備可能有兩份
   同 id 的複本。命中多個代表兩端指的不是同一個物件，這種情況一律拒絕執行，
   不猜——猜錯會複製或吃掉玩家的裝備。 */
function resolveItem(id) {
  if (!id || !G) return { err: 'bad item id' };
  var hits = [];
  var i;
  if (Array.isArray(G.inventory)) {
    for (i = 0; i < G.inventory.length; i++) {
      if (G.inventory[i] && G.inventory[i].id === id) hits.push(G.inventory[i]);
    }
  }
  var eq = G.equipment || {};
  for (var s in eq) if (eq[s] && eq[s].id === id) hits.push(eq[s]);

  if (!hits.length) return { err: 'item not found: ' + id };
  for (i = 1; i < hits.length; i++) {
    // 同一個物件被兩處參考（背包與裝備欄指向同一份）不算歧義
    if (hits[i] !== hits[0]) return { err: 'ambiguous item id: ' + id + '（命中 ' + hits.length + ' 個）' };
  }
  return { item: hits[0] };
}

/* ============ fn:null 指令的 Worker 端實作 ============
   協議裡 fn 為 null 的指令，代表沒有一個既有函式可以直接呼叫：邏輯目前散在 ui.js 裡，
   而且多半不只一步（裝備要先從背包移除、換下來的要退回背包）。這些必須搬進 Worker
   成為單一原子操作，否則指令中途的狀態會被下一個 tick 看見。

   實作原則：
   - 行為與 ui.js 現況**逐行對齊**，這是遷移不是改版；發現可疑之處記錄下來，不順手改
   - 只做狀態轉移，畫面回饋（浮動文字、彈窗）留給主執行緒依 ack 與事件處理
   - 領域層面的拒絕（背包滿、金幣不足）回傳 { err }，不丟例外；
     丟例外保留給協議層面的錯誤（找不到物件、參數非法） */

/* 操作對象是「檢視中那套」裝備，與 ui.js 的 viewedEquipment() 同語意。
   G.equipView 存在狀態裡，所以 Worker 這邊有完整保真度。 */
function targetEquipment(setIndex) {
  if (typeof setIndex === 'number' && typeof equipmentSetAt === 'function') {
    return equipmentSetAt(setIndex);
  }
  return (typeof viewedEquipment === 'function') ? viewedEquipment() : G.equipment;
}

function mustResolve(id) {
  var r = resolveItem(id);
  if (r.err) throw new Error(r.err);
  return r.item;
}

function inventoryCapacityNow() {
  return (typeof inventoryCapacityWithTalents === 'function')
    ? inventoryCapacityWithTalents()
    : INVENTORY_CAP + (G.player.invUpgrades || 0);
}

var COMMAND_IMPL = {
  /* ---- 關卡 ---- */
  'stage.setAutoAdvance': function (a) {
    G.stage.autoAdvance = !!a.on;
    UI.dirty.battle = true;
    return true;
  },
  'stage.goMax': function (a) {
    if (typeof stageGoMax === 'function') stageGoMax();
    else if (G && G.stage) G.stage.current = G.stage.best || 1;
    UI.dirty.battle = true; UI.dirty.header = true;
    return true;
  },
  'stage.go': function (a) {
    if (typeof stageGo === 'function') stageGo(a.delta || 0);
    UI.dirty.battle = true; UI.dirty.header = true;
    return true;
  },

  /* ---- 裝備、背包 ---- */
  'item.equip': function (a) {
    var it = mustResolve(a.itemId);
    var eq = targetEquipment(a.setIndex);
    var idx = G.inventory.indexOf(it);
    if (idx >= 0) G.inventory.splice(idx, 1);
    var old = equipItem(it, a.slotKey || null, eq);
    if (old) { old.locked = false; addToInventory(old); } // 換下來的解鎖後退回背包
    UI.dirty.inv = true; UI.dirty.equip = true; UI.dirty.header = true;
    return { equipped: it.id, replaced: old ? old.id : null };
  },

  'item.unequip': function (a) {
    var it = mustResolve(a.itemId);
    if (G.inventory.length >= inventoryCapacityNow()) {
      blog('⚠️ 背包已滿，無法卸下', 'warn');
      return { err: '背包已滿' };
    }
    var eq = targetEquipment();
    // 依 id 找出實際佔用的欄位：武器與戒指有主副兩欄，不能只看 slotKey
    for (var sk in eq) {
      if (eq[sk] && eq[sk].id === it.id) { eq[sk] = null; break; }
    }
    if (eq === G.equipment) markStatsDirty(); // 只有動到使用中那套才需要重算
    addToInventory(it);
    UI.dirty.inv = true; UI.dirty.equip = true; UI.dirty.header = true;
    return { unequipped: it.id };
  },

  'item.setLock': function (a) {
    var it = mustResolve(a.itemId);
    it.locked = !!a.locked;
    UI.dirty.inv = true; UI.dirty.equip = true;
    return { id: it.id, locked: it.locked };
  },

  'item.upgrade': function (a) {
    var it = mustResolve(a.itemId);
    if (!it) return false;
    var res = (typeof manualUpgrade === 'function') ? manualUpgrade(it) : null;
    UI.dirty.inv = true; UI.dirty.equip = true; UI.dirty.header = true;
    return res;
  },

  'item.rerollAffix': function (a) {
    var it = mustResolve(a.itemId);
    if (!it) return false;
    var res = (typeof rerollSingleAffix === 'function') ? rerollSingleAffix(it, a.affixKey) : null;
    UI.dirty.inv = true; UI.dirty.equip = true; UI.dirty.header = true;
    return res;
  },

  'gem.socket': function (a) {
    var it = mustResolve(a.itemId);
    if (!it) return false;
    var res = (typeof socketGem === 'function') ? socketGem(it, a.type) : null;
    UI.dirty.inv = true; UI.dirty.equip = true; UI.dirty.gems = true; UI.dirty.header = true;
    return res;
  },

  'item.salvage': function (a) {
    var it = mustResolve(a.itemId);
    var idx = G.inventory.indexOf(it);
    if (idx < 0) return { err: '該裝備不在背包中' };
    G.inventory.splice(idx, 1);
    var res = doSalvage(it);
    UI.dirty.inv = true;
    return res;
  },

  /* 一鍵分解。整段邏輯原本寫在 ui.js:2119 salvageAllUnlocked，含分解前自動存檔。
     分解前存檔是刻意的保護，搬過來時必須保留。 */
  'item.salvageBulk': function (a) {
    var maxRarity = a.maxRarity, maxLevel = a.maxLevel, maxAncient = a.maxAncient;
    var hasRarityLimit = typeof maxRarity === 'number' && !isNaN(maxRarity) && maxRarity >= 0;
    var hasLevelLimit = typeof maxLevel === 'number' && !isNaN(maxLevel) && maxLevel > 0;
    var hasAncientLimit = typeof maxAncient === 'number' && !isNaN(maxAncient) && maxAncient >= 0;
    var kept = [], targets = [], count = 0, scrap = 0;

    G.inventory.forEach(function (it) {
      if (it.locked) { kept.push(it); return; }
      if (hasRarityLimit && it.rarity > maxRarity) { kept.push(it); return; }
      if (hasLevelLimit && it.level > maxLevel) { kept.push(it); return; }
      if (hasAncientLimit && getItemAncientCount(it) > maxAncient) { kept.push(it); return; }
      targets.push(it);
    });

    if (targets.length) {
      var rec = manualSave('before_bulk_salvage'); // 已被 installStorageGuards 導向 persist
      if (rec) flog('💾 已建立拆解前存檔：' + rec.fname, 'info');
    }
    targets.forEach(function (it) {
      var res = doSalvage(it, true);
      scrap += res.scrap;
      count++;
    });
    G.inventory = kept;
    if (count) flog('⚒️ 一鍵分解 ' + count + ' 件 → 碎片x' + fmt(scrap), 'info');
    UI.dirty.inv = true;
    return { count: count, scrap: scrap };
  },

  /* ---- 角色 ---- */
  'player.renameEquipSet': function (a) {
    if (!Array.isArray(G.equipmentSets)) return { err: '沒有裝備套資料' };
    var idx = clamp(Math.floor(Number(a.index) || 0), 0, G.equipmentSets.length - 1);
    if (!equipmentSetUnlocked(idx)) return { err: '該裝備套尚未解鎖' };
    if (!Array.isArray(G.equipSetNames)) G.equipSetNames = [];
    G.equipSetNames[idx] = String(a.name == null ? '' : a.name).trim().slice(0, 12); // 上限 12 字
    UI.dirty.equip = true;
    return { index: idx, name: G.equipSetNames[idx] };
  },

  'player.buyInvUpgrade': function () {
    var upg = G.player.invUpgrades || 0;
    if (INVENTORY_CAP + upg >= INVENTORY_MAX) {
      blog('❌ 背包已達最大容量 ' + INVENTORY_MAX + ' 格，無法再擴充', 'warn', 'system');
      return { err: '已達最大容量' };
    }
    var cost = inventoryExpandCost(upg);
    if (G.player.gold < cost) {
      blog('❌ 金幣不足，擴充需要 ' + fmt(cost) + ' 金幣', 'warn', 'system');
      return { err: '金幣不足' };
    }
    G.player.gold -= cost;
    G.player.invUpgrades = upg + 1;
    blog('✅ 背包容量已擴充至 ' + (INVENTORY_CAP + G.player.invUpgrades), 'good', 'system');
    UI.dirty.inv = true; UI.dirty.header = true;
    return { cap: INVENTORY_CAP + G.player.invUpgrades, cost: cost };
  },

  /* 排序模式索引存在存檔裡，但模式清單是 UI 的知識，所以由主執行緒指定索引 */
  'player.setInvSort': function (a) {
    var mode = Math.max(0, Math.floor(Number(a.index) || 0));
    G._invSortIdx = mode;
    if (Array.isArray(G.inventory)) {
      G.inventory.sort(function (itemA, itemB) {
        if (!itemA) return 1;
        if (!itemB) return -1;
        var ancientA = typeof getItemAncientCount === 'function' ? getItemAncientCount(itemA) : 0;
        var ancientB = typeof getItemAncientCount === 'function' ? getItemAncientCount(itemB) : 0;
        var lvA = Number(itemA.level) || 0;
        var lvB = Number(itemB.level) || 0;
        var rarA = Number(itemA.rarity) || 0;
        var rarB = Number(itemB.rarity) || 0;
        var idA = Number(itemA.id) || 0;
        var idB = Number(itemB.id) || 0;

        if (mode === 0) { // 等級優先
          return (lvB - lvA) || (rarB - rarA) || (ancientB - ancientA) || (idA - idB);
        } else if (mode === 1) { // 太古優先
          return (ancientB - ancientA) || (lvB - lvA) || (rarB - rarA) || (idA - idB);
        } else if (mode === 2) { // 品質優先
          return (rarB - rarA) || (lvB - lvA) || (ancientB - ancientA) || (idA - idB);
        }
        return 0;
      });
    }
    UI.dirty.inv = true;
    return { index: G._invSortIdx };
  },

  /* ---- 技能 ---- */
  'skill.reorderLoadout': function (a) {
    var lo = G.player.loadout || [];
    var from = a.from, to = a.to;
    var cap = (typeof loadoutSize === 'function') ? loadoutSize() : 10;
    if (from < 0 || from >= cap || to < 0 || to >= cap || from === to) return { err: '位置無效' };

    var maxIdx = Math.max(from, to);
    while (lo.length <= maxIdx) {
      lo.push(null);
    }

    var tmp = lo[from] || null;
    lo[from] = lo[to] || null;
    lo[to] = tmp;

    while (lo.length > 0 && !lo[lo.length - 1]) {
      lo.pop();
    }

    G.player.loadout = lo;
    UI.dirty.skills = true; UI.dirty.battle = true;
    return { loadout: lo.slice() };
  },

  /* ---- 神鑄 ---- */
  'forge.setAuto': function (a) {
    var fst = forgeState();
    fst[a.key] = !!a.on; // key 已由協議的 enum 白名單擋過 ('autoDust' | 'autoForge')
    if (a.key === 'autoDust' && !a.on) {
      forgeClearDust();
    }
    UI.dirty.forge = true;
    return true;
  },

  'forge.setAutoFill': function (a) {
    var fst = forgeState();
    if (a.kind === 'clear') {
      fst.autoFill = null;
      blog('🔁 神鑄自動放入已取消', 'info');
      UI.dirty.forge = true;
      return { autoFill: null };
    }
    var pick = (a.kind === 'gem')
      ? { kind: 'gem', type: a.gemType, level: a.gemLevel }
      : { kind: 'equip', rarity: a.rarity };
    if (forgeItemCount() > 0) forgeUnloadAll(); // 先清空法陣再放入指定素材
    fst.autoFill = pick;
    var err = forgeAutoFillApply();
    if (err) {
      fst.autoFill = null;
      blog('⚠️ 神鑄自動放入：' + err, 'warn');
      UI.dirty.forge = true;
      return { err: err };
    }
    blog('🔁 神鑄自動放入已啟用：' + forgeAutoFillLabel() +
      '（每次鑄造後自動補放 6 件，數量不足自動停止）', 'good');
    UI.dirty.forge = true;
    return { autoFill: pick };
  },

  /* ---- 熔爐 ---- */
  'newforge.setQuality': function (a) {
    var fu = findNewForgeFurnace(a.furnaceId);
    if (!fu) return { err: '找不到熔爐 ' + a.furnaceId };
    if (a.rarity < 0 || a.rarity >= RARITIES.length || isGodforgedRarity(a.rarity)) return { err: '品質索引超出範圍' };
    fu.qualities[a.rarity] = !!a.on;
    newForgeReturnUnroutable(fu); // 取消勾選的品質自專屬佇列退回總佇列重新派發
    UI.dirty.newforge = true;
    return true;
  },

  'newforge.setEnabled': function (a) {
    var fu = findNewForgeFurnace(a.furnaceId);
    if (!fu) return { err: '找不到熔爐 ' + a.furnaceId };
    fu.enabled = !!a.on;
    newForgeReturnUnroutable(fu); // 停用：專屬佇列退回總佇列
    UI.dirty.newforge = true;
    return true;
  },

  'newforge.markTabSeen': function () {
    var nf = newForgeState();
    nf.tabSeen = true;
    UI.dirty.header = true;
    return true;
  },

  'newforge.markNoticeShown': function () {
    newForgeState().noticeShown = true;
    return true;
  },

  /* ---- 分解設定 ---- */
  'factory.setSalvageSettings': function (a) {
    G.player.salvageSettings = G.player.salvageSettings || {};
    G.player.salvageSettings.maxRarity = (typeof a.maxRarity === 'number') ? a.maxRarity : -1;
    G.player.salvageSettings.maxLevel = (typeof a.maxLevel === 'number' && a.maxLevel > 0) ? a.maxLevel : null;
    G.player.salvageSettings.maxAncient = (typeof a.maxAncient === 'number') ? a.maxAncient : -1;
    UI.dirty.factory = true;
    return G.player.salvageSettings;
  },

  'factory.setAutoEquip': function (a) {
    G.factory.autoEquip = !!a.on;
    UI.dirty.factory = true;
    return true;
  },

  /* ---- 寶石批次 ----
     行為對齊 ui.js 的同步迴圈，上限也照抄：跨執行緒逐次往返不可行，一次跑完再回報。 */
  'gem.composeAll': function (a) {
    var made = 0, err = null;
    while (made < 2500 && !(err = composeGems(a.type, a.level))) made++;
    if (made > 0) {
      blog('♻️ 全部合成：' + gemLabel(a.type, a.level) + ' ×' + (made * GEM_COMPOSE_INPUT_COUNT) +
        ' → ' + gemLabel(a.type, a.level + 1) + ' ×' + made, 'good', 'factory');
    }
    UI.dirty.gems = true;
    return { made: made, err: made > 0 ? null : err };
  },

  'gem.dismantleAll': function (a) {
    var count = 0, gain = 0, r = null;
    while (count < 999) {
      r = dismantleGem(a.type, a.level);
      if (r.err) break;
      count++; gain += r.n;
    }
    if (count > 0) {
      blog('⛏️ 全部拆解：' + gemLabel(a.type, a.level) + ' ×' + count + ' → ' +
        gemLabel(a.type, 1) + ' ×' + gain, 'good', 'factory');
    }
    UI.dirty.gems = true;
    return { count: count, gain: gain, err: count > 0 ? null : (r && r.err) };
  },

  /* ---- 高塔 ----
     手動挑戰同時代表「取消等待中的連挑」；ui.js 現行是先清 TOWER.auto 再開打，
     兩步必須在同一個指令內完成。 */
  'tower.start': function (a) {
    TOWER.auto = null;
    TOWER.autoNextCd = 0;
    startTowerFight(a.floor);
    UI.dirty.tower = true; UI.dirty.battle = true;
    return { active: !!(G.tower && G.tower.active) };
  },

  /* ---- 統計 ---- */
  'stats.reset': function () {
    if (self.RUN_STATS) {
      RUN_STATS.skills = {};
      RUN_STATS.maxStage = (G && G.stage) ? G.stage.current : 1;
    }
    if (typeof resetLootStats === 'function') resetLootStats();
    UI.dirty.battle = true;
    return true;
  },

  /* ---- 設定 ---- */
  'settings.set': function (a) {
    G.settings = G.settings || {};
    G.settings[a.key] = a.value; // key 已由協議的 enum 白名單擋過
    UI.dirty.header = true; UI.dirty.inv = true; UI.dirty.equip = true;
    return true;
  },

  /* ---- 存檔 ---- */
  'save.manual': function (a) { return manualSave(a && a.label); },
  'save.toFolder': function (a) { return createManualSaveToFolderV2(a && a.label); },
  'save.restart': function () { return restartGame(); },

  /* ---- 分頁交接（v8）----
     另一個分頁要接管，這顆 Worker 從此不再是權威。先停迴圈再落地，順序不能反：
     反過來的話，落地與停迴圈之間仍可能插進一次自動存檔，而那正是要避免的多寫入。
     落地用 SHUTDOWN（語意就是「這個分頁要收工了」），主執行緒等它寫完才放開鎖。 */
  'app.handoff': function () {
    if (_loopTimer) { clearInterval(_loopTimer); _loopTimer = 0; }
    _booted = false;
    requestPersist(PERSIST_KINDS.SHUTDOWN);
    return true;
  },

  /* ---- GM ----
     執行層在 js/gm_exec.js（主執行緒與 Worker 共用同一份實作）。
     回傳 { ok, message }，面板依此顯示結果。 */
  'gm.exec': function (a) {
    if (typeof executeGMCommand !== 'function') {
      return { ok: false, message: 'GM 執行層未載入' };
    }
    return executeGMCommand(a.line);
  }
};

function runCommand(name, args) {
  var spec = commandSpec(name);
  if (!spec) return { ok: false, error: 'unknown command: ' + name };
  var invalid = validateCommand(name, args);
  if (invalid) return { ok: false, error: invalid };
  if (COMMAND_IMPL[name]) {
    try {
      return { ok: true, result: COMMAND_IMPL[name](args) };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }
  if (!spec.fn) {
    // 協議中 fn 為 null 的 13 條：邏輯目前仍在 ui.js，P3 搬進 Worker 後才實作
    return { ok: false, error: 'not implemented until P3: ' + name };
  }
  var fn = self[spec.fn];
  if (typeof fn !== 'function') return { ok: false, error: 'missing sim function: ' + spec.fn };

  var needResolve = resolveKeys(name);
  var params = [];
  for (var key in spec.args) {
    if (!Object.prototype.hasOwnProperty.call(spec.args, key)) continue;
    var v = args ? args[key] : undefined;
    if (needResolve.indexOf(key) !== -1) {
      var r = resolveItem(v);
      if (r.err) return { ok: false, error: r.err };
      v = r.item;
    }
    params.push(v);
  }
  try {
    return { ok: true, result: fn.apply(null, params) };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
}

/* 由 1 號熔爐實際勾選的品質產生新手提示文案。
   連續區間縮寫成「普通~史詩」，不連續則逐項列出，一個都沒勾則改寫成另一句。 */
function defaultSalvageHintText() {
  var furnace = G && G.player && G.player.newForge &&
    Array.isArray(G.player.newForge.furnaces) ? G.player.newForge.furnaces[0] : null;
  var flags = furnace && Array.isArray(furnace.qualities) ? furnace.qualities : [];
  var picked = [];
  for (var r = 0; r < RARITIES.length; r++) {
    if (flags[r] && RARITIES[r]) picked.push(r);
  }
  if (!picked.length) {
    return '💡 提示：預設不自動拆解任何品質，掉落裝備會全部保留入包。' +
      '到【熔爐】勾選品質後，該品質才會自動拆解成碎片與精華。';
  }
  var contiguous = picked[picked.length - 1] - picked[0] === picked.length - 1;
  var label;
  if (picked.length === 1) {
    label = RARITIES[picked[0]].name;
  } else if (contiguous) {
    label = RARITIES[picked[0]].name + '~' + RARITIES[picked[picked.length - 1]].name;
  } else {
    label = picked.map(function (r) { return RARITIES[r].name; }).join('、');
  }
  return '💡 提示：預設「' + label + '」品質會自動拆解成碎片與精華，未勾選品質會保留入包。';
}

/* ---- 開機 ---- */
function boot(msg) {
  var loaded = null;
  var notices = [];
  var deferOfflineProgress = false;

  installStorageGuards();
  _maxRunId = msg.maxRunId || 1;

  if (msg.save) {
    loaded = (typeof migrateSave === 'function') ? migrateSave(msg.save) : msg.save;
  }
  G = loaded || newGameState();
  // 存檔中的 xp 可能是舊升級公式留下的溢出值；先完成升級再建立戰鬥實體。
  if (typeof settlePlayerXp === 'function') settlePlayerXp({ silent: true });
  backfillItemSockets();
  updateShownRes();
  if (typeof markStatsDirty === 'function') markStatsDirty();
  if (typeof initFieldPlayer === 'function') initFieldPlayer();

  /* 安全模式跳過離線結算。這是開機流程裡最會爆的一段——它要讀存檔裡的時間戳、
     重跑一段模擬、再結算獎勵，任何一環碰到異常資料都會拋錯，而拋錯就等於開不了機。
     跳過它的代價只是「這次不補離線收益」，換來的是玩家進得去、匯得出存檔。 */
  if (loaded && msg.safeMode) {
    notices.push({ key: '_safeModeNotice', text: '已以安全模式開機：本次略過離線結算，離線期間的收益不會補發。建議先匯出存檔備份。' });
  } else if (loaded && typeof applyOfflineProgress === 'function') {
    /* 離線收益可能要逐筆處理數千次掉落。不要在 BOOTED 前同步執行，
       否則主執行緒只能顯示 HTML 的預設 0/60，直到整段計算結束才拿到面板。 */
    deferOfflineProgress = true;
  }

  /* migrateSave 會把改版公告掛在 G 上，交給主執行緒顯示後刪除旗標。
     P5 起文案在這裡組完整：那些「可用 N 點」之類的補充值只有 Worker 算得出來，
     主執行緒沒有 G，不可能自己接上去。 */
  if (G._skillResetNotice) {
    notices.push({ key: '_skillResetNotice', text: '🛠️ 偵測到技能點異常：已使用 ' + G._skillResetNotice +
      '，已重置所有技能並發還初始技能。技能點已依等級全額退還（可用 ' +
      (typeof availableSkillPoints === 'function' ? availableSkillPoints() : 0) +
      ' 點），請重新配點；之後升級將正常獲得技能點。', cls: 'warn' });
    delete G._skillResetNotice;
  }
  if (G._skillPointRepairNotice) {
    notices.push({ key: '_skillPointRepairNotice', text: '🧮 ' + G._skillPointRepairNotice + '；目前可用技能點 ' +
      (typeof availableSkillPoints === 'function' ? availableSkillPoints() : 0) + ' 點。', cls: 'info' });
    delete G._skillPointRepairNotice;
  }
  // 2026-07-30 技能融合改造：技能等級上限夾回通知（上限值由轉生對照表決定，訊息在 save.js 組好）
  if (G._skillCapClampNotice) {
    notices.push({ key: '_skillCapClampNotice', text: '📏 ' + G._skillCapClampNotice + '；目前可用技能點 ' +
      (typeof availableSkillPoints === 'function' ? availableSkillPoints() : 0) + ' 點。', cls: 'info' });
    delete G._skillCapClampNotice;
  }
  // ONE-TIME MIGRATION: loadoutCapClampV1 的公告（裝載欄上限下修，超額格數已卸下）
  if (G._loadoutCapClampNotice) {
    notices.push({ key: '_loadoutCapClampNotice', text: '🎒 ' + G._loadoutCapClampNotice + '。', cls: 'warn' });
    delete G._loadoutCapClampNotice;
  }
  if (G._talentRespecNotice) {
    notices.push({ key: '_talentRespecNotice', text: '🌟 ' + G._talentRespecNotice +
      '，請至【天賦】頁重新配點（新制成本＝天賦轉數+9／級，Lv.51 起每級加倍）。', cls: 'warn' });
    delete G._talentRespecNotice;
  }
  /* 帶 modal 的公告要彈窗，不是寫進日誌，UI 端據此分辨。
     ⚠️ 2026-07-28 移除全部一次性遷移後，目前只有 _skillPointRepairNotice 還有產生者；
     其餘三個旗標暫時沒有人設定。這段傳輸機制刻意保留——日後若再需要開機公告，
     直接在 migrateSave 設旗標即可，不必重接一次管線。 */
  if (G._talentRespecConfirm) {
    notices.push({ key: '_talentRespecConfirm', text: '天賦系統已重新改造，請重新配置！', modal: true });
    delete G._talentRespecConfirm;
  }

  /* 開機提示。P5 之前這幾則寫在 main.js，靠主執行緒自己那份 G 產生；
     主執行緒不再持有 G 之後，只有這裡算得出來。 */
  /* 新手提示的品質範圍必須跟著實際預設走，不能寫死。
     原文寫「預設普通~傳說品質會自動拆解」，但 newForgeDefaultFurnace 只勾普通
     （player.js 的 `qualities.push(r === 0)`），玩家照著訊息做就會滿包。
     文案與預設值分屬兩個檔案，寫死等於保證日後再次不同步。 */
  if (loaded) {
    notices.push({ key: 'welcomeBack', text: '📖 歡迎回來，冒險者！讀取存檔成功。', cls: 'good' });
    var invCapNow = (typeof inventoryCapacityWithTalents === 'function')
      ? inventoryCapacityWithTalents()
      : INVENTORY_CAP + (G.player.invUpgrades || 0);
    if (G.inventory.length > invCapNow) {
      notices.push({ key: 'inventoryOverCap', cls: 'warn',
        text: '⚠️ 背包超出容量（' + G.inventory.length + '/' + invCapNow +
          '）。今後滿載時將維持上限：新裝備與包內未鎖定最弱者「捨弱留強」擇一保留（上鎖裝備不受影響）。' +
          '超出的部分可用「分解設定」批次清理。' });
    }
  } else {
    notices.push({ key: 'welcomeNew', cls: 'good', text: '⚔️ 歡迎來到《無限征途：合成之巔》！' });
    notices.push({ key: 'welcomeNew2', cls: 'info', text: '你的角色會自動戰鬥。掉落的裝備會流進【熔爐】，記得去勾選各熔爐要拆解的品質！' });
    notices.push({ key: 'welcomeNew3', cls: 'info', text: defaultSalvageHintText() });
    flog('🏭 熔爐已啟動。掉落裝備會依各熔爐勾選的品質自動拆解或保留。', 'info');
  }

  /* 開機時把所有面板標記為髒。正常開機這是多餘的（UI 本來就會索取），
     但自動重啟後主執行緒手上是上一個 Worker 的快取，必須全部換掉。 */
  for (var pi = 0; pi < PANEL_KEYS.length; pi++) UI.dirty[PANEL_KEYS[pi]] = true;

  _booted = true;
  _lastTickAt = Date.now();
  _lastEmitAt = _lastAutoAt = _lastFolderAt = _lastTickAt;
  if (_loopTimer) clearInterval(_loopTimer);
  _loopTimer = setInterval(loop, TICK_MS);

  post(MSG_OUT.BOOTED, {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    snapshot: { view: buildView(), fresh: !loaded },
    offlineSummary: null,
    notices: notices,
    events: shimDrainEvents()
  });

  if (deferOfflineProgress) {
    _offlineBootTimer = setTimeout(function () {
      _offlineBootTimer = 0;
      if (!_booted) return;
      applyOfflineProgress({ chunkSize: 24, done: function (offlineSummary) {
        if (!offlineSummary) return;
        /* applyOfflineProgress() 會透過 shim 累積 dirty/events；立即送出，
           不必等下一個 tick 才讓資源、輸送帶與離線收益摘要出現在 UI。 */
        emitTick();
        G.savedAt = Date.now();
        requestPersist(PERSIST_KINDS.AUTO);
      }});
    }, 0);
  }
}

/* ---- 執行中讀檔（v2 新增）----
   舊路徑的做法是寫進 localStorage 後 location.reload()，靠重新載入換掉整份狀態。
   Worker 架構下不需要重載：主執行緒讀出存檔內容送進來，這裡直接替換 G。
   讀檔前先把目前進度落地，避免玩家切換存檔時弄丟當前這局。 */
function loadIntoRunningSim(msg) {
  if (!msg.save) { reportError('load', new Error('load 訊息沒有帶存檔內容')); return; }
  requestPersist(PERSIST_KINDS.AUTO); // 目前進度先保底
  G = (typeof migrateSave === 'function') ? migrateSave(msg.save) : msg.save;
  if (typeof settlePlayerXp === 'function') settlePlayerXp({ silent: true });
  backfillItemSockets();
  updateShownRes();
  if (typeof markStatsDirty === 'function') markStatsDirty();
  if (typeof initFieldPlayer === 'function') initFieldPlayer();
  if (typeof applyOfflineProgress === 'function') applyOfflineProgress();
  _lastTickAt = Date.now();
  _lastEmitAt = _lastAutoAt = _lastFolderAt = _lastTickAt;
  PANEL_KEYS.forEach(function (k) { UI.dirty[k] = true; });
  post(MSG_OUT.FULL, { snapshot: { view: buildView() }, events: shimDrainEvents() });
  requestPersist(PERSIST_KINDS.AUTO); // 換檔後立刻鎖定 savedAt 基準
}

/* ---- 分頁顯示狀態（v9 起）----
   隱藏不再改變模擬行為——背景就是在線掛機。這裡只剩一件事：切走時落地一次，
   讓「分頁後來被瀏覽器丟棄」的情況至少有個新的存檔點。

   **切回前景時刻意不重設 `_lastTickAt`。** 那正是背景期間累積的時間，
   要讓 loop 把它當成欠帳補完；重設等於把玩家掛機的時間丟掉。 */
function onVisibility(msg) {
  if (typeof shimSetBackground === 'function') shimSetBackground(!!(msg && msg.hidden));
  if (msg.hidden) requestPersist(PERSIST_KINDS.SHUTDOWN);
}

self.onmessage = function (e) {
  var msg = e.data || {};
  try {
    switch (msg.type) {
      case MSG_IN.BOOT:
        boot(msg);
        break;
      case MSG_IN.LOAD:
        loadIntoRunningSim(msg);
        break;
      case MSG_IN.CMD:
        var r = runCommand(msg.name, msg.args);
        post(MSG_OUT.ACK, { id: msg.id, ok: r.ok, result: r.result, error: r.error });
        if (r.ok) emitTick(); // 指令有結果就立刻推一次，不必等下個 tick
        break;
      case MSG_IN.PANEL:
        if (!isPanelKey(msg.name)) { reportError('panel', new Error('unknown panel: ' + msg.name)); break; }
        post(MSG_OUT.PANEL, { name: msg.name, data: buildPanel(msg.name, msg.params) });
        break;
      case MSG_IN.VISIBILITY:
        onVisibility(msg);
        break;
      case MSG_IN.SAVE_RESULT:
        onSaveResult(msg);
        break;
      case MSG_IN.PING:
        post(MSG_OUT.PONG, { t: msg.t, booted: _booted });
        break;
      default:
        reportError('onmessage', new Error('unknown message type: ' + msg.type));
    }
  } catch (err) {
    reportError('onmessage:' + msg.type, err);
  }
};

self.onerror = function (message, filename, lineno) {
  post(MSG_OUT.ERROR, { where: 'worker', message: String(message), stack: filename + ':' + lineno });
};
