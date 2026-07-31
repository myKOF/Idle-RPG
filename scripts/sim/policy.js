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

function createPolicy(policy) {
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
    /* 策略宣告它需要哪些面板。驅動端只建這幾個——背包面板很大，
       每個決策點都建一次會白白付出序列化成本。 */
    needPanels: policy.needPanels || [],
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

    /* 解析不出值的狀態路徑。非空就代表策略有規則正在靜靜失效——
       多半是遊戲面板欄位改名了，而策略還指著舊路徑。 */
    badPaths() { return vm.runInContext('JSON.parse(JSON.stringify(BAD_PATHS))', ctx); },

    /* 反證用：在隔離 context 內執行任意一段程式，看它能不能碰到遊戲狀態。 */
    __evalInPolicyContext(src) { return vm.runInContext(src, ctx); }
  };
}

module.exports = { createPolicy };
