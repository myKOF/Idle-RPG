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

const vm = require('vm');

/* 直譯器原始碼。刻意以字串形式在隔離 context 內求值——它跑的地方沒有 G，
   所以連「不小心碰到遊戲狀態」都做不到。 */
const INTERPRETER = `
/* 解析失敗的路徑要記下來。策略用 $path 或條件指到某個面板欄位，
   欄位一旦改名，路徑就會解析成 undefined——條件永遠不成立、規則靜靜失效，
   不會有任何錯誤訊息，試跑報告只會顯示「這條規則沒送出過」。
   遊戲改版時這是最容易發生、也最難察覺的一種失真，所以要主動記錄。 */
var BAD_PATHS = {};

function pathVal(root, path) {
  var cur = root;
  var parts = String(path).split('.');
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) { BAD_PATHS[path] = (BAD_PATHS[path] || 0) + 1; return undefined; }
    cur = cur[parts[i]];
  }
  if (cur === undefined) BAD_PATHS[path] = (BAD_PATHS[path] || 0) + 1;
  return cur;
}

function testCond(root, cond) {
  var v = pathVal(root, cond[0]);
  var op = cond[1];
  var rhs = cond[2];
  switch (op) {
    case '>':  return v > rhs;
    case '>=': return v >= rhs;
    case '<':  return v < rhs;
    case '<=': return v <= rhs;
    case '==': return v === rhs;
    case '!=': return v !== rhs;
    case 'truthy': return !!v;
    case 'falsy':  return !v;
    default: throw new Error('未知條件運算子: ' + op);
  }
}

/* 參數值可以是常數，也可以是取自狀態的參照：
     { "$path": "panels.tower.tower.highest" }
     { "$add": [ {"$path":"..."}, 1 ] }
   只有取值與加法，沒有一般化的運算式——策略是要「指哪個按鈕」，不是要算遊戲數值。 */
function resolveArg(state, v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(function (x) { return resolveArg(state, x); });
  if (v.$path !== undefined) return pathVal(state, v.$path);
  if (v.$add !== undefined) {
    var sum = 0;
    for (var i = 0; i < v.$add.length; i++) sum += Number(resolveArg(state, v.$add[i])) || 0;
    return sum;
  }
  var out = {};
  for (var k in v) out[k] = resolveArg(state, v[k]);
  return out;
}

/* expand：把一條規則展開成多條指令（跨乘）。每一項的候選值來自
     { values: [...] }        寫死的清單
     { list: "名稱" }          policy.lists 裡的清單
     { path: "panels.x.y" }   狀態裡某個物件的鍵（或陣列的元素）
   例如「每種寶石 × 等級 1~4 各試一次合成」就是兩項跨乘。 */
function expandCandidates(state, policy, spec) {
  if (spec.values) return spec.values.slice();
  if (spec.list) return (policy.lists[spec.list] || []).slice();
  if (spec.path) {
    var v = pathVal(state, spec.path);
    if (!v) return [];
    if (Array.isArray(v)) return v.slice();
    return Object.keys(v);
  }
  return [];
}

/* 回傳這個決策點要送出的指令陣列。純函式：同樣的輸入必定得到同樣的輸出。 */
function decide(state, policy, memo) {
  var out = [];
  var now = state.gameTimeSec;
  for (var i = 0; i < policy.rules.length; i++) {
    var r = policy.rules[i];
    if (r.once && memo.fired[r.id]) continue;
    if (r.everySec) {
      var last = memo.lastAt[r.id];
      if (last !== undefined && now - last < r.everySec) continue;
    }
    var ok = true;
    if (r.if) {
      for (var c = 0; c < r.if.length; c++) {
        if (!testCond(state, r.if[c])) { ok = false; break; }
      }
    }
    if (!ok) continue;

    var baseArgs = resolveArg(state, r.args || {});

    if (r.bestPerSlot) {
      /* 換裝：每個部位挑背包裡分數最高、且比身上那件更高的一件。

         ⚠️ 比較用的 score 是**遊戲算的**（js/formula.js:1325 的 itemScore，
         背包滿載「捨弱留強」用的就是同一把尺），這裡只做「取最大值」與「大於就換」。
         策略不知道也不需要知道什麼叫強——那是遊戲的判斷，跟玩家看著面板上的數字
         挑最好的一件穿上，是同一件事。

         為什麼非要有這條：遊戲的自動裝備只填空格，不做替換
         （js/player.js:313 的 if (G.equipment[key]) continue），
         所以開場一分鐘把 13 個部位塞滿垃圾之後，它就再也不會動。
         真人玩家是全程手動換裝的，AI 不做這件事就會穿著開場的普通裝打到底。 */
      var cfg = r.bestPerSlot;
      var items = pathVal(state, cfg.items) || [];
      var eqScores = pathVal(state, cfg.equippedScores) || {};
      var eqRarities = pathVal(state, 'panels.inv.equipmentRarities') || {};

      /* 依據 player_strategy.md「品質高優先穿」鐵律：
         1. 只要背包物品的品質 (rarity) > 身上現有裝備的品質，100% 強制換上！
         2. 若品質相同，評分 (score) 較高者優先換上！ */
      var used = {};
      for (var slotKey in eqScores) {
        var baseSlot = String(slotKey).replace(/\d+$/, '');
        var currRarity = (typeof eqRarities[slotKey] === 'number') ? eqRarities[slotKey] : -1;
        var currScore = eqScores[slotKey] || 0;

        var best = null;
        for (var it = 0; it < items.length; it++) {
          var item = items[it];
          if (!item || item.slot !== baseSlot || item.locked) continue;
          if (used[item.id]) continue;

          var itemRar = typeof item.rarity === 'number' ? item.rarity : 0;
          var itemSc = item.score || 0;

          if (!best) {
            best = item;
          } else {
            var bestRar = typeof best.rarity === 'number' ? best.rarity : 0;
            var bestSc = best.score || 0;
            if (itemRar > bestRar) {
              best = item;
            } else if (itemRar === bestRar && itemSc > bestSc) {
              best = item;
            }
          }
        }
        if (!best) continue;

        var bestRarity = typeof best.rarity === 'number' ? best.rarity : 0;
        var bestScore = best.score || 0;

        if (bestRarity > currRarity || (bestRarity === currRarity && bestScore > currScore)) {
          used[best.id] = true;
          out.push({ name: r.cmd, args: { itemId: best.id, slotKey: slotKey }, ruleId: r.id });
        }
      }
    } else if (r.argsList) {
      /* 同一條規則要送多組固定參數（例如三個品質各設一次）。 */
      for (var m = 0; m < r.argsList.length; m++) {
        out.push({ name: r.cmd, args: resolveArg(state, r.argsList[m]), ruleId: r.id });
      }
    } else if (r.expand) {
      /* 逐項跨乘。展開後每一條都是獨立指令，能不能成立由遊戲判斷——
         點數不足、素材不夠、前置未達一律由 runCommand 回錯，策略不預判。 */
      var combos = [{}];
      for (var e = 0; e < r.expand.length; e++) {
        var spec = r.expand[e];
        var cands = expandCandidates(state, policy, spec);
        var next = [];
        for (var a = 0; a < combos.length; a++) {
          for (var b = 0; b < cands.length; b++) {
            var merged = {};
            for (var kk in combos[a]) merged[kk] = combos[a][kk];
            merged[spec.key] = cands[b];
            next.push(merged);
          }
        }
        combos = next;
      }
      for (var q = 0; q < combos.length; q++) {
        var args = {};
        for (var bk in baseArgs) args[bk] = baseArgs[bk];
        for (var ck in combos[q]) args[ck] = combos[q][ck];
        out.push({ name: r.cmd, args: args, ruleId: r.id });
      }
    } else {
      out.push({ name: r.cmd, args: baseArgs, ruleId: r.id });
    }
    memo.lastAt[r.id] = now;
    if (r.once) memo.fired[r.id] = true;
  }
  return out;
}
`;

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
