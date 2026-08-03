'use strict';
/* ============ 策略層（能力隔離） ============

   這一層決定「按哪個按鈕」，而且**只能**決定按哪個按鈕。

   隔離方式是能力剝奪，不是執行期偵測：策略跑在一個獨立的 vm context，
   裡面沒有 G、沒有 FIELD、沒有 require、沒有 process、沒有任何遊戲函式。
   它拿到的是 buildView() 的**深拷貝**，回傳的是指令名與參數。
   所以它在語言層面就不可能改狀態，也不可能讀到未經原生計算的內部值。

   為什麼不用 Proxy 攔截寫入：
     1. Proxy 只包得住 G，而戰鬥狀態在 js/combat.js:5 的 module-level `FIELD`，包不到
     2. 成本壓在每次屬性存取上，而要防的事只發生在決策的那一瞬間
     3. 會破壞物件識別比對——js/battlefield.js:186 的 bfLiveList(...).indexOf(locked)
        與 js/combat.js:665 跨 tick 持有的 _lockTarget 正好踩在上面
   拿不到參照的東西，不需要被監控。

   策略本身是**資料**（JSON），不是程式。本檔是它的直譯器，行為固定且可審。 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* 直譯器原始碼。放在獨立的 .js 檔而不是樣板字串——樣板字串會吃掉正規表示式的
   反斜線（/d+$/ 變成 /d+$/），而且不會有任何錯誤，只會安靜地行為錯誤。
   詳見 policy_interpreter.js 檔頭。 */
const INTERPRETER = fs.readFileSync(path.join(__dirname, 'policy_interpreter.js'), 'utf8');

/* ---- 面板參數的哨兵 ----

   策略可以宣告「這個面板的某一塊不用建」（panelParams，例如 inv 的 items 清單）。
   代價是宣告錯了不會壞掉、只會**靜靜壞掉**：路徑解析不到值，規則就永遠不觸發，
   而報表上看起來只是「AI 沒有換裝」。

   所以宣告成 false 的欄位，一律在載入時檢查策略裡有沒有任何地方指到它，
   指到了就直接拒絕開跑。

   ⚠️ 比對的是「整個字串**就是**那條路徑（或以它為前綴再接一個點）」，
   不是子字串掃描。策略檔裡的路徑一律是完整的字串值（`"panels.inv.equipment"`、
   `{"$path": "..."}`），而各種 `_依據` / `說明` 欄位是散文，裡面很可能為了解釋
   而提到同一條路徑——子字串掃描會把那種說明也當成使用，於是「寫了註解」就開不了機。 */
function assertPanelParams(policy) {
  const pp = policy.panelParams;
  if (!pp || typeof pp !== 'object') return;

  const banned = [];
  for (const panel of Object.keys(pp)) {
    const cfg = pp[panel];
    if (!cfg || typeof cfg !== 'object') continue;
    for (const field of Object.keys(cfg)) {
      if (cfg[field] === false) banned.push('panels.' + panel + '.' + field);
    }
  }
  if (!banned.length) return;

  const walk = (node) => {
    if (typeof node === 'string') {
      for (const path of banned) {
        if (node === path || node.startsWith(path + '.')) {
          throw new Error(
            `策略宣告了不建 ${path}（panelParams），但策略裡有規則以 "${node}" 指到它。` +
            `那條規則會永遠取不到值而靜靜失效——要嘛把宣告拿掉，要嘛把規則改成不需要它。`);
        }
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') { for (const k of Object.keys(node)) walk(node[k]); }
  };
  walk(policy);
}

function createPolicy(policy) {
  assertPanelParams(policy);
  /* 空 context：沒有 require / process / console / G / FIELD。
     連 Math.random 都沒有——策略不該有隨機性，否則決定論就斷了。 */
  const ctx = vm.createContext(Object.create(null));
  /* vm context 一定會帶進 ECMAScript 內建物件，其中兩個必須拔掉：
       Math.random  策略若自己擲骰，同 seed 就不再重現，所有比對失效
       Date.now     策略若讀真實時間，行為會隨執行時刻改變
     這兩個是決定論的漏洞，不是安全問題——但決定論一破，交叉驗證與回歸比對就全廢了。
     改成呼叫即拋錯：寧可在開發期大聲失敗，也不要靜靜產生不可重現的結果。 */
  vm.runInContext(`
    Math.random = function () { throw new Error('策略層禁止使用 Math.random：隨機性會破壞決定論。需要隨機請在策略資料裡寫死選擇。'); };
    Date.now = function () { throw new Error('策略層禁止讀真實時間：請用 state.gameTimeSec（遊戲時間）。'); };
  `, ctx, { filename: 'policy-sandbox-preamble' });
  vm.runInContext(INTERPRETER, ctx, { filename: 'policy-interpreter' });
  /* 策略資料也做一次深拷貝再送進去，避免外面持有同一個物件被改。 */
  ctx.__policy = JSON.parse(JSON.stringify(policy));
  ctx.__memo = { fired: {}, lastAt: {} };

  return {
    name: policy.name,
    decideEveryGameSec: policy.decideEveryGameSec || 10,
    /* 每日在線時數。策略只是宣告，班表由驅動端（scripts/run_sim.js）實作——
       「什麼時候不在玩」不是策略能決定的事，它連自己何時被呼叫都不知道。

       ⚠️ 沒有預設值：沒宣告就是 undefined，驅動端據此判斷「這份策略沒有班表」。
       給 24 當預設看起來無害，但那會讓「沒宣告」與「宣告 24 小時」變成同一件事，
       摘要就分不出這一場是沒有班表還是刻意全天在線。 */
    dailyActiveHours: policy.dailyActiveHours,
    /* 策略宣告它需要哪些面板。驅動端只建這幾個——背包面板很大，
       每個決策點都建一次會白白付出序列化成本。 */
    needPanels: policy.needPanels || [],

    /* 建面板時要傳給遊戲的參數（逐面板）。目前唯一的用途是 inv 的
       { items: false }——不讀那份清單的策略不必付它的錢，見
       js/worker/sim.worker.js 的 buildInventoryPanel。
       宣告錯了由上面的 assertPanelParams 在載入時擋下。 */
    panelParams: policy.panelParams || null,

    /* ---- 觀測頻率（與行動頻率分開）----
       decideEveryGameSec 是「玩家多久做一次後勤」；這一個是「玩家多仔細看戰鬥」。
       兩者原本是同一個旋鈕，導致玩得少的人連戰鬥觀測都變粗，卡關重試間隔被
       系統性拉長——真人不是這樣（見 policy_interpreter.js 的「觀測與行動是兩件事」）。

       預設 1 秒且**不因玩家強度而異**，那正是解耦的目的。
       設成與 decideEveryGameSec 相同即可還原拆分前的行為。 */
    observeEverySec: (typeof policy.observeEverySec === 'number' && policy.observeEverySec > 0)
      ? policy.observeEverySec : 1,

    /* 觀測只需要 track.monster / track.stage 與速率目標的計數器指到的面板，
       不需要背包。從宣告的路徑推導，不另外要策略再列一份會與宣告不同步的清單。

       ⚠️ 速率型目標（ratePerMin）的計數器一定要列進來。漏掉的話觀測時
       pathVal 取不到值、取樣直接跳過，速率就只會在決策點被取樣——決策間隔
       是 15~60 秒，視窗要好幾分鐘才攢得滿，而且完全不會有錯誤訊息。 */
    observePanels: (function () {
      const out = [];
      const add = (p) => {
        if (typeof p !== 'string') return;
        const m = /^panels\.([^.]+)/.exec(p);
        if (m && out.indexOf(m[1]) === -1) out.push(m[1]);
      };
      const t = policy.track || {};
      for (const key of ['monster', 'stage']) add(t[key]);
      for (const tg of policy.targets || []) {
        if (tg && tg.kind === 'ratePerMin') add(tg.counter);
      }
      /* 敗因診斷（policy.profile）要在死掉的那一瞬間附近取樣，所以它指到的面板
         必須跟著 1Hz 觀測一起建。漏掉的話 cause 只會在決策點被取樣——
         輕度玩家 60 秒一次，整場交戰會落在兩次取樣之間，敗因永遠是 null，
         而且完全不會有錯誤訊息（規則只是靜靜地不觸發）。

         ⚠️ 這裡只能放**便宜**的面板。完整的 panels.eval 一次要跑約 47 次
         computeStats，掛上 1Hz 就是每個遊戲秒全身重算 47 遍——
         那是這個設計最容易踩的效能陷阱（與背包面板同一類）。 */
      const pf = policy.profile || {};
      /* ⚠️ 宣告成陣列時，**只有第一條**會被加進觀測面板。

         陣列的用途是「同一份資料在觀測節奏與決策節奏下住在不同面板」
         （觀測建便宜的 evalCombat、決策建完整的 eval），直譯器會依序試。
         但觀測是 1Hz，把完整版也加進來就等於每個遊戲秒跑幾十次 computeStats——
         那正是這個設計最容易踩的效能陷阱（與背包面板同一類，見 SIM_HARNESS.md）。

         所以約定：**第一條必須是觀測用的那一份，而且必須是便宜的**。 */
      for (const key of ['combat', 'cause']) {
        const v = pf[key];
        add(Array.isArray(v) ? v[0] : v);
      }
      return out;
    })(),
    /* 評估器參數（要評估哪些詞條、每個部位精算幾個候選）。
       它是策略資料，不是引擎設定——不同強度的玩家會評估不同的東西。 */
    evalConfig: policy.evalConfig || null,
    /* 開跑前的 GM 前置（例如把角色墊到已轉生，才測得到天賦與神鑄）。
       屬於「建立測試前提」，不是推進遊戲；會原文寫進 run_summary.json 公開揭露。 */
    bootstrap: policy.bootstrap || [],

    /* state 必須是純資料（view 的深拷貝 + 遊戲時間）。
       這裡再做一次 JSON round-trip：即使呼叫端不小心傳了活的物件參照進來，
       跨過這一行之後也只剩下值。 */
    decide(state) {
      ctx.__state = JSON.parse(JSON.stringify(state));
      const cmds = vm.runInContext('decide(__state, __policy, __memo)', ctx);
      /* 回傳值同樣拷貝出來，隔離 context 內的物件不外流。 */
      return JSON.parse(JSON.stringify(cmds));
    },

    /* 高頻觀測。不回傳指令——觀測不是操作，玩家看戰鬥不算按按鈕。
       隔離方式與 decide 完全相同：策略拿到的仍然只是深拷貝，碰不到遊戲狀態。 */
    observe(state) {
      ctx.__state = JSON.parse(JSON.stringify(state));
      vm.runInContext('observe(__state, __policy, __memo)', ctx);
    },

    /* 解析不出值的狀態路徑。非空就代表策略有規則正在靜靜失效——
       多半是遊戲面板欄位改名了，而策略還指著舊路徑。 */
    badPaths() { return vm.runInContext('JSON.parse(JSON.stringify(BAD_PATHS))', ctx); },

    /* 反證用：在隔離 context 內執行任意一段程式，看它能不能碰到遊戲狀態。 */
    __evalInPolicyContext(src) { return vm.runInContext(src, ctx); }
  };
}

module.exports = { createPolicy };
