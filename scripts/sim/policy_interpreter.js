'use strict';
/* ============ 策略直譯器（在隔離 context 內執行） ============

   ⚠️ 這份程式碼**必須**放在真正的 .js 檔，不可以寫成樣板字串塞回 policy.js。
   曾經那樣做過，結果 /d+$/ 在樣板字串裡被當成未知跳脫序列，反斜線被吃掉變成 /d+$/，
   於是 ring2 / weapon2 去不掉結尾數字、對不到背包物品的 slot，那兩個部位永遠不換裝——
   而且不會有任何錯誤訊息，其餘 11 個部位看起來完全正常。
   放在檔案裡還有兩個好處：build_check 會做語法檢查，編輯器也看得懂它是程式碼。

   本檔由 policy.js 讀進隔離 context 執行，那裡沒有 G、沒有 FIELD、沒有 require。 */

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

/* 依序試幾條路徑，回傳第一條解得出值的。**不記 BAD_PATHS**——
   這裡的「解不出來」是預期內的：同一份資料在觀測節奏與決策節奏下住在不同面板
   （觀測建的是便宜的 evalCombat，決策建的是完整的 eval），
   兩條都宣告、哪條在就用哪條。

   ⚠️ 不能直接用 pathVal 串起來：它會把每一次「這一拍沒建這個面板」都記成失效路徑，
   而失效路徑是「策略指到已改名欄位」的診斷管道，被雜訊灌滿就沒用了——
   實測一場 1 小時的模擬就多出 116 筆假警報。 */
function firstPathVal(root, paths) {
  var list = Array.isArray(paths) ? paths : [paths];
  for (var i = 0; i < list.length; i++) {
    var cur = root, parts = String(list[i]).split('.'), ok = true;
    for (var j = 0; j < parts.length; j++) {
      if (cur === null || cur === undefined) { ok = false; break; }
      cur = cur[parts[j]];
    }
    if (ok && cur !== undefined) return cur;
  }
  return undefined;
}

function testCond(root, cond) {
  var v = pathVal(root, cond[0]);
  var op = cond[1];
  /* 右邊也可以是 {$path:...}，才寫得出「金幣夠不夠付這次擴充」這種兩個狀態值的比較。
     只寫得出「跟常數比」的話，成本會隨次數成長的東西就只能先送出去撞牆。 */
  var rhs = resolveArg(root, cond[2]);
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
  /* 乘法只為了寫得出「上限的三成」這種相對門檻（例如法力低於上限 30% 才補法力寶石）。
     一樣不是在算遊戲數值——遊戲數值都由遊戲算好放在狀態裡，這裡只是取閾值。 */
  if (v.$mul !== undefined) {
    var prod = 1;
    for (var mi = 0; mi < v.$mul.length; mi++) prod *= Number(resolveArg(state, v.$mul[mi])) || 0;
    return prod;
  }
  var out = {};
  for (var k in v) out[k] = resolveArg(state, v[k]);
  return out;
}

/* 依角色等級選出適用的「段」。段由上往下比對，第一個 maxLevel >= 目前等級的就是它；
   沒有 maxLevel 的段視為「以上皆非」的最後一段。

   player_strategy.md 的寶石鑲嵌與技能升級都是分階段的（前 50 級／51~100／101 以後），
   所以前中後期在這裡是同一套邊界，不各自定義一套。 */
function pickBand(state, bands, levelPath) {
  if (!bands || !bands.length) return null;
  var lv = Number(pathVal(state, levelPath || 'view.level')) || 0;
  for (var i = 0; i < bands.length; i++) {
    var b = bands[i];
    if (b.maxLevel !== undefined && lv > b.maxLevel) continue;
    /* when：這一段還可以再掛條件（例如「爆率 100% 以上才改鑲屬性傷害」）。
       條件不成立就往下一段找，所以條件段後面一定要留一個無條件的收尾段。 */
    if (b.when && !testCond(state, b.when)) continue;
    return b;
  }
  return null;
}

/* 這個節點底下所有數字的總和。寶石庫存是 { 種類: { 階級: 數量 } } 這種巢狀表，
   要判斷「這種寶石到底有沒有貨」就得把各階級加起來。 */
function sumLeaves(v) {
  if (typeof v === 'number') return v;
  if (!v || typeof v !== 'object') return 0;
  var s = 0;
  for (var k in v) s += sumLeaves(v[k]);
  return s;
}

/* expand：把一條規則展開成多條指令（跨乘）。每一項的候選值來自
     { values: [...] }        寫死的清單
     { list: "名稱" }          policy.lists 裡的清單
     { listByLevel: [...] }   依角色等級分段挑清單（見 pickBand）
     { path: "panels.x.y" }   狀態裡某個物件的鍵（或陣列的元素）
   例如「每種寶石 × 等級 1~4 各試一次合成」就是兩項跨乘。 */
/* learnedIn：只留下「在某張 id→等級 表裡真的有值」的候選。

   為什麼需要：技能點改成只投裝載欄放得下的幾個之後（見 learnPlan），
   優先序清單裡其餘二十幾個永遠不會被學會，而 equip-loadout 仍照著整份清單送——
   實測 3 遊戲小時送出 4,860 次、其中 3,232 次是「尚未學習」。
   不影響正確性（遊戲會擋），但那是白花的成本，而且會把指令統計淹到看不出真正的問題。
   理由與 nonEmpty 只送「手上真的有貨」的寶石種類完全相同。 */
function filterLearned(state, spec, ids) {
  if (!spec.learnedIn) return ids;
  var table = pathVal(state, spec.learnedIn) || {};
  return ids.filter(function (id) { return Number(table[id]) > 0; });
}

function expandCandidates(state, policy, spec) {
  if (spec.values) return filterLearned(state, spec, spec.values.slice());
  if (spec.list) return filterLearned(state, spec, (policy.lists[spec.list] || []).slice());
  if (spec.listByLevel) {
    var band = pickBand(state, spec.listByLevel, spec.levelPath);
    if (!band) return [];
    return (band.list ? (policy.lists[band.list] || []) : (band.values || [])).slice();
  }
  if (spec.path) {
    var v = pathVal(state, spec.path);
    if (!v) return [];
    /* field：陣列元素是物件時取其中一個欄位。
       融合技的 id 是遊戲產生的（fusions[].id = 'fusion_' + uid()），策略沒辦法寫死，
       只能從狀態裡把它撈出來，否則融合完的技能永遠學不了也裝不上。 */
    if (Array.isArray(v)) {
      if (spec.field) {
        var picked = [];
        for (var fi = 0; fi < v.length; fi++) {
          var fv = v[fi] && v[fi][spec.field];
          if (fv !== undefined && fv !== null) picked.push(fv);
        }
        return picked;
      }
      return v.slice();
    }
    var keys = Object.keys(v);
    /* nonEmpty：只留下數量真的大於 0 的鍵。
       遊戲一開局就把全部寶石種類建好、數量為 0（js/player.js:62），不篩的話
       每個合成決策點都會送出 40 種 × 4 階＝160 條必定失敗的指令，把指令統計整個淹掉。
       這不是在替遊戲判斷成敗，只是不去按明顯沒東西可按的按鈕——
       跟 socketEmpty 要卡庫存是同一個理由。 */
    if (spec.nonEmpty) {
      keys = keys.filter(function (k) { return sumLeaves(v[k]) > 0; });
    }
    return keys;
  }
  return [];
}

/* 從偏好群組裡挑一種「手上真的有貨」的寶石。
   依序試：這一輪輪到的群組 → 其餘群組 → 任何有貨的種類。
   送出手上沒有的種類，遊戲只會回「沒有這種寶石」——實測寫死一種時 1,421 次呼叫全部落空。 */
function pickGemType(groups, turn, cursor, spread, stockOf, available, allowFallback) {
  for (var g = 0; g < groups.length; g++) {
    var idx = (turn + g) % groups.length;
    var list = groups[idx] || [];
    for (var k = 0; k < list.length; k++) {
      /* spread 群組（mix）從游標往下輪，讓六種屬性寶石平均分散到各插槽；
         一般的偏好序群組游標恆為 0，永遠先挑清單最前面有貨的那種。 */
      var t = list[(cursor[idx] + k) % list.length];
      if (stockOf[t] > 0) {
        if (spread) cursor[idx] = (cursor[idx] + k + 1) % list.length;
        return t;
      }
    }
  }
  /* 空槽可以退而求其次鑲雜牌（有總比沒有好）；
     但「換掉雜牌」時不行——拿雜牌換雜牌只是白做工，還會每個決策點來回一次。 */
  if (!allowFallback) return null;
  for (var a = 0; a < available.length; a++) if (stockOf[available[a]] > 0) return available[a];
  return null;
}

/* 手上每種寶石的總數與最高階。庫存是 { 種類: { 階級: 數量 } } 的巢狀表。

   minLevelByType：某些種類要求「至少 N 階才鑲」（player_strategy.md：生命／物理／
   魔法只鑲三級以上）。socketGem 鑲的是庫存最高階那顆，所以只要最高階沒到門檻，
   這個種類這一輪就當成沒貨——把它從庫存裡剔掉，後面所有挑選邏輯自動一致。 */
function gemStock(heldGems, minLevelByType) {
  var stockOf = {}, available = [], maxLvOf = {};
  for (var gt in heldGems) {
    var n = sumLeaves(heldGems[gt]);
    if (n <= 0) continue;
    var top = 0;
    for (var lv in heldGems[gt]) {
      if ((Number(heldGems[gt][lv]) || 0) > 0 && Number(lv) > top) top = Number(lv);
    }
    maxLvOf[gt] = top;
    var need = minLevelByType && minLevelByType[gt];
    if (typeof need === 'number' && top < need) continue;    // 階級不夠，這輪不鑲
    stockOf[gt] = n;
    available.push(gt);
  }
  return { stockOf: stockOf, available: available, maxLvOf: maxLvOf };
}

/* 配額：某些種類身上至少要有 N 顆（player_strategy.md：物理／魔法抗性寶石各至少一個；
   法力不夠時補法力恢復寶石）。回傳還缺幾顆，缺的優先補。 */
function gemQuotaNeeds(state, quota, equipment, stockOf) {
  var out = [];
  for (var i = 0; i < (quota || []).length; i++) {
    var q = quota[i];
    if (!q || !q.type) continue;
    if (q.when && !testCond(state, q.when)) continue;
    if (!(stockOf[q.type] > 0)) continue;                    // 手上沒有就不用談
    var have = 0;
    for (var sk in equipment) {
      var it = equipment[sk];
      if (!it || !it.sockets) continue;
      for (var si = 0; si < it.sockets.length; si++) {
        var g = it.sockets[si];
        if (g && g.type === q.type) have++;
      }
    }
    var need = (q.count || 1) - have;
    if (need > 0) out.push({ type: q.type, remaining: need });
  }
  return out;
}

/* 裝備優劣的比較階層（player_strategy.md 裝備詞條洗煉策略：品質 >> 等級 >> 太古詞條數）。

   分數只當最後的平手裁判。itemScore 是遊戲算的沒錯，但它把品質、等級、太古全部
   壓成一個數字——照它排就會出現「品質低一階、但詞條剛好滾得好所以分數高」而換錯，
   而品質決定插槽數與附魔欄數，是換不回來的。

   身上那件給的是完整物件（有 affixes），背包那件是投影過的（只有 ancientCount），
   兩種都要吃得下。 */
function itemRank(it, scoreOverride) {
  if (!it) return [-1, -1, -1, -1];
  var anc = (typeof it.ancientCount === 'number') ? it.ancientCount : 0;
  if (it.affixes) {
    anc = 0;
    for (var i = 0; i < it.affixes.length; i++) if (it.affixes[i] && it.affixes[i].ancient) anc++;
  }
  return [
    (typeof it.rarity === 'number') ? it.rarity : 0,
    (typeof it.level === 'number') ? it.level : 0,
    anc,
    (typeof scoreOverride === 'number') ? scoreOverride : (it.score || 0)
  ];
}
/* null＝這一層無從比較（例如只拿得到身上那件的品質與評分，不知道等級與太古數），
   要當成「平手」往下一層看。當成 -1 的話，任何有等級的候選都會在等級那層直接勝出，
   把「評分較低就不換」整條規則架空。 */
function rankBetter(a, b) {
  for (var i = 0; i < a.length; i++) {
    if (a[i] === null || b[i] === null) continue;
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/* 把偏好段攤平成「輪用群組」＋「是否屬於偏好」的查表。 */
function bandGroups(band, fallbackTypes) {
  var groups = null, spread = false;
  if (band) {
    groups = band.mix ? band.mix : [band.types || []];
    spread = !!band.mix;
  }
  if (!groups) groups = [fallbackTypes || []];
  var set = {}, flat = [];
  for (var i = 0; i < groups.length; i++) {
    for (var j = 0; j < groups[i].length; j++) { set[groups[i][j]] = true; flat.push(groups[i][j]); }
  }
  return { groups: groups, spread: spread, set: set, flat: flat };
}

/* ============ 戰鬥情境追蹤（player_strategy.md 推關策略／卡關定義） ============

   這是直譯器裡唯一有「記憶」的部分。其餘規則都只看當下狀態，但卡關判定天生需要
   跨決策的資訊：上一次打菁英／BOSS 打到剩幾血、隔了多久、這段期間有沒有變強。

   狀態全部放在 memo（policy 實例私有），策略本身仍然拿不到 G、也改不了遊戲。 */

/* 進步基準線：卡關後要「至少替換一件更強裝備／平均強化+2／太古+2／洗出更優詞條／
   更強寶石 2 個以上」才值得再試一次。這裡把五項各自的可比較值一次取下來。 */
function progressSnapshot(state, t) {
  var eq = pathVal(state, t.equipment) || {};
  var scores = pathVal(state, t.equippedScores) || {};
  var snap = { ids: {}, gemLv: {}, upgradeSum: 0, slots: 0, ancient: 0, score: 0 };
  for (var k in eq) {
    var it = eq[k];
    if (!it || !it.id) continue;
    snap.ids[k] = it.id;
    snap.slots++;
    snap.upgradeSum += Number(it.upgrade) || 0;
    snap.score += Number(scores[k]) || 0;
    var af = it.affixes || [];
    for (var i = 0; i < af.length; i++) if (af[i] && af[i].ancient) snap.ancient++;
    var sk = it.sockets || [];
    var lv = [];
    for (var j = 0; j < sk.length; j++) lv.push((sk[j] && Number(sk[j].level)) || 0);
    snap.gemLv[k] = lv;
  }
  return snap;
}

/* 五項只要達成任一項就算「變強了，可以再試」。門檻取自 player_strategy.md。 */
function hasProgressed(base, now) {
  if (!base || !now) return true;

  var swapped = 0;
  for (var k in now.ids) if (base.ids[k] && base.ids[k] !== now.ids[k]) swapped++;
  if (swapped >= 1) return true;                     // 至少替換一件更強裝備

  var avgNow = now.slots ? now.upgradeSum / now.slots : 0;
  var avgBase = base.slots ? base.upgradeSum / base.slots : 0;
  if (avgNow - avgBase >= 2) return true;            // 平均強化增加 2 級

  if (now.ancient - base.ancient >= 2) return true;  // 太古詞條數 +2 以上

  var better = 0;
  for (var sk in now.gemLv) {
    var a = now.gemLv[sk] || [], b = base.gemLv[sk] || [];
    for (var i = 0; i < a.length; i++) if (a[i] > (b[i] || 0)) better++;
  }
  if (better >= 2) return true;                      // 鑲了更強的寶石 2 個以上

  /* 「洗煉出更優詞條」沒有客觀基準——詞條是隨機滾的，好壞取決於當下的目標清單。
     這裡用裝備評分總和上升 2% 當代理指標，是近似而不是精確判定。
     另外四項都能精確計算，而五項只要一項成立就放行，所以這個近似不會卡住流程。 */
  if (base.score > 0 && now.score >= base.score * 1.02) return true;

  return false;
}

/* ============ 觀測與行動是兩件事 ============

   下面兩支的分工，是為了解掉一條非預期的耦合。

   原本這一整段每個「決策點」跑一次，而決策間隔就是 decideEveryGameSec——同一個旋鈕
   同時決定了「玩家多久做一次後勤」與「玩家多仔細看戰鬥」。後果是：

     輕度玩家 60 秒才看一次戰鬥，最後一次取樣可能在死前 60 秒，那時 BOSS 還有 80% 血
     極限玩家 5 秒看一次，最後一次取樣接近死亡瞬間，看到的是 30%

   而重試間隔正是「觀察到的殘血百分比當分鐘數」。於是玩得少的人不只操作少，還會
   **系統性地高估 BOSS 殘血**，把回頭再試的間隔拉長好幾倍。這不是設計，是取樣假象：
   真人盯著螢幕看到的戰鬥細節不會因為他今天只上線兩小時就變粗。

   所以拆成兩支：
     observeCombat  高頻、與玩家強度無關。只讀 view.stage 與 track.monster，很便宜。
     updateContext  低頻、跟著行動走。要背包面板算「有沒有變強」，那個貴。

   ⚠️ observeCombat 必須可重入：同一個時刻被 observe 與 decide 各呼叫一次是正常的，
   兩次都不能重複計數。交戰結束的分支靠 T.engaged 置 null 自我防護。 */

/* 這件裝備身上有沒有某條詞條。換裝與缺口洗煉都要問這件事。 */
function hasAffixKey(item, key) {
  if (!item || !item.affixes) return false;
  for (var i = 0; i < item.affixes.length; i++) {
    if (item.affixes[i] && item.affixes[i].key === key) return true;
  }
  return false;
}

/* 高頻觀測。只做戰鬥取樣與交戰結束的記帳，不碰背包。 */
function observeCombat(state, policy, memo) {
  if (!policy.track) return null;
  var t = policy.track;
  if (!memo.trk) memo.trk = { attempts: {}, engaged: null, baseline: null };
  var T = memo.trk;
  var now = state.gameTimeSec;
  var stage = Number(pathVal(state, t.stage)) || 0;
  var m = pathVal(state, t.monster);

  var mode = 'normal';
  if (m && m.isBoss) mode = 'boss';
  else if (m && m.elite) mode = 'elite';

  /* ---- 玩家自己的血量水位（危險程度的主訊號）----

     「該不該帶保命技」不是「打什麼怪」的函數，是「有沒有在危險」的函數：
     同一隻小怪，裝備夠強就一路輾過去、不夠強就會掛，兩者要的技能組不一樣。
     怪物種類只是相關，不是原因——照種類切換會在「打得很順的菁英」上白白
     犧牲兩格輸出，也會在「打不動的小怪」上完全不作為。

     量法取最保守也最便宜的那一種：**滾動視窗內的最低血量百分比**。
     真人的講法是「掛一掛會不會死」，那需要很長的統計；最低血量是它的前導指標，
     而且一個視窗就量得到——低於一半就是已經很危險了。

     用固定桶輪替而不是保留每一筆取樣：觀測是 1Hz，20 遊戲小時就是 72,000 筆，
     每次都要修剪陣列。桶是 O(1)，代價只是視窗邊界會有一個桶的粒度。 */
  var hpNow = Number(pathVal(state, 'view.hp'));
  var hpMax = Number(pathVal(state, 'view.hpMax'));
  if (hpMax > 0 && isFinite(hpNow)) {
    var hpCfg = (policy.danger && policy.danger.hpFloor) || {};
    var winSec = (typeof hpCfg.windowSec === 'number') ? hpCfg.windowSec : 300;
    var nBuckets = (typeof hpCfg.buckets === 'number') ? hpCfg.buckets : 6;
    var bucketSec = Math.max(1, winSec / nBuckets);
    if (!T.hpFloor) T.hpFloor = { buckets: [], at: -1 };
    var idx = Math.floor(now / bucketSec);
    var HF = T.hpFloor;
    if (HF.at !== idx) {
      /* 換桶：把新桶推進去，超出視窗的丟掉。死亡當下血量是 0，
         那一筆要算數——它正是「已經不安全」最直接的證據。 */
      HF.buckets.push(100);
      while (HF.buckets.length > nBuckets) HF.buckets.shift();
      HF.at = idx;
    }
    var pctNow = 100 * hpNow / hpMax;
    var last = HF.buckets.length - 1;
    if (last >= 0 && pctNow < HF.buckets[last]) HF.buckets[last] = pctNow;
  }

  /* 當前對手的閃避。記在這裡而不是決策點現讀，理由有兩個：
       1. 決策點不一定正在交戰（怪物剛死、正在換關），現讀會拿到 null
       2. 這是高頻觀測，取到的是「最近真的在打的那隻」，不是十秒前的殘影
     有效命中率（自身命中 − 對手閃避）要拿它算，見 evalTargets。 */
  if (m && typeof m.dodge === 'number') {
    T.enemyDodge = m.dodge;
    T.enemyLevel = m.level || 0;
  }

  /* 交戰中：記下這一關打到的最低血量。取樣頻率由 observeEverySec 決定，
     與玩家強度無關——這正是上面說的那條耦合被解開的地方。 */
  if (mode !== 'normal' && m && m.maxHp > 0) {
    if (!T.engaged || T.engaged.stage !== stage) T.engaged = { stage: stage, minHpPct: 100, mode: mode };
    var pct = 100 * m.hp / m.maxHp;
    if (pct < T.engaged.minHpPct) T.engaged.minHpPct = pct;

    /* ---- 敗因取樣（Bottleneck Profiler） ----

       這裡取的是評估器算好的診斷（panels.evalCombat.combat），不是自己判斷。
       兩個時間都要遊戲的公式才算得出來：
         timeToKill  以實測 DPS 校正過的「還要幾秒殺得死」
         timeToDie   對手輸出扣掉我方減免之後的「還有幾秒會倒」
       timeToDie < timeToKill ⇒ EHP_TOO_LOW，反之 ⇒ DPS_TIMEOUT。

       ⚠️ 一定要在觀測節奏上取，不能等到決策點。整場交戰可能只有幾秒，
       而決策間隔是 15~60 秒——決策點取到的多半是「已經沒有對手了」。

       取**最後一次**看到的診斷（持續覆寫），因為愈接近死亡瞬間的樣本愈準：
       開場第一秒血量滿、護盾在，那時的 timeToDie 一律很樂觀。 */
    var pf = policy.profile;
    if (pf && pf.combat) {
      /* 觀測節奏建的是 panels.evalCombat（便宜），決策節奏建的是 panels.eval（完整），
         兩者都有 combat 欄位。宣告成陣列、哪個在就用哪個——
         這一支同時被 observe 與 decide 呼叫，寫死一條路徑必定有一半解不出來。 */
      var cp = firstPathVal(state, pf.combat);
      if (cp && cp.known) {
        T.engaged.cause = cp.cause;
        T.engaged.margin = cp.margin;
        T.engaged.timeToKill = cp.timeToKill;
        T.engaged.timeToDie = cp.timeToDie;
      }
    }
  } else if (T.engaged) {
    /* 交戰結束。關卡往前＝過了，往後＝死了退關（js/combat.js 的 retreatStage）。 */
    var e = T.engaged;
    T.engaged = null;
    if (stage > e.stage) {
      delete T.attempts[e.stage];                    // 過關就清掉紀錄
    } else if (stage < e.stage) {
      var rec = T.attempts[e.stage] || (T.attempts[e.stage] = { fails: 0, micro: 0 });
      rec.fails++;
      rec.lastFailAt = now;
      rec.minHpPct = e.minHpPct;
      rec.mode = e.mode;
      /* 敗因留在紀錄上，供決策點驅動資源分配（打不完就全堆攻、撐不住才補防）。 */
      rec.cause = e.cause || null;
      rec.margin = (typeof e.margin === 'number') ? e.margin : null;

      /* ---- 微調重試（player_strategy.md v2.0：允許連續嘗試 3 次） ----

         舊行為：只要失敗一次，重試間隔就是「殘血百分比當分鐘數」（最少 10 分鐘），
         而且必須先驗到「有變強」才准再試。實測後果是每次卡關至少賠掉十分鐘，
         而真人在這種時候做的事是**換個打法馬上再試一次**——換抗性寶石、
         換技能組、把爆傷換成命中——那些調整只要幾秒，不需要等十分鐘。

         所以前 microLimit 次失敗走短冷卻、而且**不要求「有變強」**：
         敗因已經寫進 ctx.cause，ROI 規則會在這幾秒內針對性地改配置，
         那本身就是「調整」。三次都失敗才承認是真的打不動，退回長冷卻。

         ⚠️ 冷卻不能是 0。指令是循序派送的，換寶石／換裝要幾個決策點才落地；
         冷卻短於一個決策間隔的話，第二次重試會用**完全相同的配置**上場，
         三次微調就白白燒掉，症狀是「重試三次都一模一樣地死」。 */
      var mp = (policy.profile && policy.profile.microRetry) || null;
      var microLimit = mp && typeof mp.limit === 'number' ? mp.limit : 0;
      if (rec.micro === undefined) rec.micro = 0;
      if (rec.micro < microLimit) {
        rec.micro++;
        rec.retryAt = now + (typeof mp.cooldownSec === 'number' ? mp.cooldownSec : 120);
        rec.microPhase = true;
      } else {
        /* 重試間隔＝敵人剩餘血量百分比當分鐘數，最少 10 分鐘。 */
        rec.retryAt = now + Math.max(10, e.minHpPct) * 60;
        rec.microPhase = false;
      }
      /* 基準線要拍背包，那是貴的面板，高頻觀測拿不到也不該拿。改成掛旗標，
         由下一次 updateContext 補拍。延遲最多一個行動間隔，而基準線本來就是
         「卡關當下的強度」這種粗粒度的東西，差幾秒不影響判定。 */
      T.baselinePending = true;
    }
  }
  return mode;
}

/* 每個決策點更新一次，結果掛在 state.ctx 供規則以 ctx.* 路徑取用。 */
function updateContext(state, policy, memo) {
  /* 速率型目標的取樣。放在最前面而且與 track 無關：決策點本身也是一個觀測時刻，
     而沒宣告 track 的策略一樣可以宣告速率目標。 */
  sampleRates(state, policy, memo);
  if (!policy.track) {
    /* 沒有戰鬥追蹤的策略仍然可以宣告目標——deficit 要算，否則相關規則會靜靜地
       永遠不觸發。

       ⚠️ 只補 deficit，不覆寫整個 ctx：呼叫端（測試、或日後別的驅動）可能自己
       塞了 ctx 進來，整包換掉會把它們默默清空。 */
    if (!state.ctx) state.ctx = {};
    /* 危險程度與 track 無關（它只讀血量水位），兩條路徑都要算——
       漏了的話，沒宣告 track 的策略會拿到 ctx.danger === undefined，
       保命技的規則整段空轉而且沒有任何徵兆。理由與下面 roi / stopLoss 相同。 */
    state.ctx.danger = evalDanger(state, policy, memo, null);
    state.ctx.deficit = evalTargets(state, policy, memo);
    /* ⚠️ 邊際效益與止損跟 track 無關，兩條路徑都要算。
       漏了這一行的話，沒宣告 track 的策略會拿到 ctx.roi === undefined，
       而所有 ROI 規則的條件都會靜靜地不成立——規則看起來設好了，實際整段空轉。 */
    state.ctx.roi = rankRoi(state, policy);
    state.ctx.stopLoss = evalStopLoss(state, policy);
    return;
  }
  var t = policy.track;
  /* 先補一次觀測：行動點本身也是一個觀測時刻，而且 observeEverySec 若沒有設定，
     這裡就是唯一的觀測來源（行為與拆分前相同）。 */
  var mode = observeCombat(state, policy, memo);
  var T = memo.trk;
  var now = state.gameTimeSec;
  var stage = Number(pathVal(state, t.stage)) || 0;

  /* 補拍卡關當下的基準線（見 observeCombat 的說明）。 */
  if (T.baselinePending) {
    T.baseline = progressSnapshot(state, t);
    T.baselinePending = false;
  }

  /* 擋在前面的那個卡點：關卡數大於目前所在、且編號最小的那一個。 */
  var blockStage = 0, blockRec = null;
  for (var sk2 in T.attempts) {
    var s2 = Number(sk2);
    if (s2 <= stage) continue;
    if (!blockRec || s2 < blockStage) { blockStage = s2; blockRec = T.attempts[sk2]; }
  }

  var waiting = false;
  if (blockRec) {
    var timeUp = now >= (blockRec.retryAt || 0);
    /* 微調階段不要求「有變強」——那正是微調的意思：改配置而不是變強。
       要求變強會讓三次微調全部被擋在門外，機制等於沒有。
       ⚠️ 這是一個**有界**的放寬（最多 microLimit 次），不是永久放寬。
       docs/SIM_HARNESS.md 記過：任何無界的「條件不滿足就改變行為」都會變成死鎖。 */
    var grew = blockRec.microPhase ? true : hasProgressed(T.baseline, progressSnapshot(state, t));
    waiting = !(timeUp && grew);                     // 時間到＋有變強，兩者都要
  }

  state.ctx = {
    mode: mode,
    stage: stage,
    /* 最近一次觀測到的對手閃避／等級。決策點不一定正在交戰，所以取觀測記下的值，
       見 observeCombat。目標度量（例如有效命中率）要拿它算。 */
    enemyDodge: (typeof T.enemyDodge === 'number') ? T.enemyDodge : null,
    enemyLevel: T.enemyLevel || 0,
    blockStage: blockStage,
    fails: blockRec ? blockRec.fails : 0,
    /* 同一個卡點試了 5 次還過不去＝生存率不足，轉為針對性強化
       （菁英／BOSS 抗性與傷害加成）。 */
    desperate: !!(blockRec && blockRec.fails >= 5),
    retryWaiting: waiting,
    minHpPct: blockRec ? Math.round(blockRec.minHpPct || 100) : 100,

    /* ---- 敗因（Bottleneck Profiler 的輸出） ----
       'DPS_TIMEOUT'：打不完 → 資源全押輸出
       'EHP_TOO_LOW'：撐不住 → 補生命／抗性／減傷
       null：沒有卡點，或還沒取樣到 → 規則一律不改變行為

       ⚠️ 取的是**擋在前面那個卡點**的敗因，不是最近一次交戰的。
       AI 可能正在安全關卡刷怪（那裡不會失敗），但要解的是前面那道牆。 */
    cause: blockRec ? (blockRec.cause || null) : null,
    /* 餘裕比（timeToDie ÷ timeToKill）。>1 殺得死，<1 會先倒。
       比布林值好用的地方是它分得出「差一點」與「差很遠」——
       0.9 值得再微調一次，0.05 就該回去換裝備了。 */
    margin: blockRec ? (blockRec.margin === undefined ? null : blockRec.margin) : null,
    microTries: blockRec ? (blockRec.micro || 0) : 0,
    microPhase: !!(blockRec && blockRec.microPhase)
  };

  /* 目標缺口。要在 state.ctx 建好之後才算——度量路徑可以指向 ctx.*
     （例如有效命中率要用 ctx.enemyDodge）。 */
  state.ctx.deficit = evalTargets(state, policy, memo);

  /* 危險程度。要排在 deficit **之後**：主訊號是死亡率，而那是一個已經宣告過的
     速率型目標（deathRate），沒有理由再量第二份。 */
  state.ctx.danger = evalDanger(state, policy, memo, blockRec);

  /* 邊際效益排序與止損水位。放在最後：它們要讀 panels.eval，而那個面板
     只在決策點才建（貴），觀測節奏上沒有。 */
  state.ctx.roi = rankRoi(state, policy);
  state.ctx.stopLoss = evalStopLoss(state, policy);
}

/* ============ 危險程度：保命技該不該上，看的是處境不是怪物種類 ============

   ---- 這一節在修的誤區 ----

   第一版把它做成「小怪＝點金手／尋寶直覺、BOSS＝魔法屏障／再生術」的固定對應。
   那是錯的模型：同一隻小怪，裝備夠強就一路輾過去、不夠強就會掛；同一隻 BOSS，
   強到能秒就不需要保命技。**怪物種類與危險程度只是相關，不是因果**。
   照種類切換的後果是兩頭落空——在打得很順的菁英身上白白犧牲兩格輸出，
   在打不動的小怪身上完全不作為。實測第一版：菁英太密，每 36 遊戲秒翻一次，
   而 8 個 seed 的死亡數全部上升。

   ---- 兩個訊號，都取「最壞的那一刻」而不是平均 ----

   1. 玩家血量水位（hpFloorPct）：滾動視窗內的**最低**血量百分比。
      真人的講法是「掛一掛會不會死」，那要很長的統計才問得出來；
      最低血量是它的前導指標，一個視窗就量得到。低於一半就是已經很危險。
      平均血量沒有用——被秒的那一下之前，平均值可能一直很好看。

   2. 卡點的敵人殘血（enemyLeftPct）：`T.attempts[卡住那一關].minHpPct`，
      也就是「我最好的一次把牠打到剩幾 %」。這個數字**本來就在量**
      （observeCombat 記，退關時存進 attempts，重試冷卻也是拿它算的），
      只是從來沒有拿去驅動技能。剩得愈多代表差得愈遠。

   ---- 為什麼要遲滯 ----

   兩個門檻（進入 / 離開）不同，否則血量在門檻附近抖動時會每個決策點拆一次裝一次。
   離開的門檻要明顯高於進入——「剛好回到 50%」不代表安全，只代表這一個視窗沒被打到。 */
function evalDanger(state, policy, memo, blockRec) {
  var cfg = policy.danger;
  if (!cfg) return null;
  var T = memo.trk || {};

  /* 視窗還沒攢滿就回 unknown（null），不猜。開場前幾分鐘血量本來就滿，
     猜「安全」會讓保命技在最需要的前期缺席。 */
  var floorPct = null;
  var HF = T.hpFloor;
  if (HF && HF.buckets && HF.buckets.length) {
    var need = (typeof cfg.minBuckets === 'number') ? cfg.minBuckets : 2;
    if (HF.buckets.length >= need) {
      floorPct = 100;
      for (var i = 0; i < HF.buckets.length; i++) {
        if (HF.buckets[i] < floorPct) floorPct = HF.buckets[i];
      }
    }
  }

  var enemyLeftPct = blockRec ? (typeof blockRec.minHpPct === 'number' ? blockRec.minHpPct : null) : null;

  var enterAt = (typeof cfg.enterBelowPct === 'number') ? cfg.enterBelowPct : 50;
  var leaveAt = (typeof cfg.leaveAbovePct === 'number') ? cfg.leaveAbovePct : 65;
  var farBehindPct = (typeof cfg.farBehindPct === 'number') ? cfg.farBehindPct : 30;

  /* ---- 主訊號是「會不會死」，血量水位只是前導指標 ----

     使用者的原話是「一般小怪你能掛多久不死？如果這個需要長時間統計的話，
     那麼用最低剩餘血量也可以」——死亡率是主判準，最低血量是它的替代品。
     兩者的關係不是二選一：實測一份 Lv.169 的存檔在關卡 150 掛了 33 分鐘，
     最低血量是 57%（高於 50% 的門檻），但同一個角色在 20 小時裡會死幾百次。
     只看最低血量會漏掉這種「平常很穩、偶爾被秒」的情況，而那正是最需要保命技的。

     ⚠️ 死亡率讀的是已經宣告過的 deathRate 目標（ratePerMin），不另外量一份——
     同一件事量兩次遲早會對不上，而且視窗長度也會變成兩個要維護的數字。
     unknown（視窗還沒攢滿）不算安全也不算危險，交給血量水位判。 */
  var deathRate = null;
  if (cfg.deathTarget && state.ctx && state.ctx.deficit) {
    var dr = state.ctx.deficit[cfg.deathTarget];
    if (dr && !dr.unknown && typeof dr.value === 'number') deathRate = dr.value;
  }
  var dieAt = (typeof cfg.deathsPerMinAt === 'number') ? cfg.deathsPerMinAt : 0;

  /* 上一次的等級留在 memo 裡，遲滯才有記憶。 */
  if (typeof memo.dangerLevel !== 'number') memo.dangerLevel = 0;
  var lvl = memo.dangerLevel;

  var hpDanger = (floorPct !== null && floorPct < enterAt);
  var hpSafe = (floorPct !== null && floorPct >= leaveAt);
  var dying = (deathRate !== null && deathRate > dieAt);

  if (hpDanger || dying) {
    /* 第二級要再加一個「而且真的解不掉」的證據：擋在前面的那一關，
       最好的一次還讓敵人剩 farBehindPct 以上——那是差得遠，不是差一點。 */
    lvl = (enemyLeftPct !== null && enemyLeftPct >= farBehindPct) ? 2 : 1;
  } else if (hpSafe) {
    /* 血量回到離開門檻**而且**沒有在死，才降級。
       ⚠️ 死亡率 unknown（視窗還沒攢滿）要當成「沒有在死」而不是「不確定所以不降」——
       當成後者的話，任何取不到死亡計數的情境（剛從存檔開機、剛轉生）
       都會讓保命技一旦上去就再也拿不下來，而症狀只是「AI 的輸出永遠少兩格」。 */
    lvl = 0;
  }
  /* 其餘情況（遲滯區間、資料不足）維持原狀 */
  memo.dangerLevel = lvl;

  return {
    level: lvl,
    hpFloorPct: floorPct === null ? null : Math.round(floorPct * 10) / 10,
    deathsPerMin: deathRate === null ? null : Math.round(deathRate * 100) / 100,
    enemyLeftPct: enemyLeftPct === null ? null : Math.round(enemyLeftPct),
    /* 揭露門檻，讓 run_summary 讀得出來這一場是用什麼標準判的 */
    enterBelowPct: enterAt, leaveAbovePct: leaveAt, farBehindPct: farBehindPct
  };
}

/* ============ 邊際效益排序（ROI Driven Affix Selection） ============

   ---- 為什麼要廢掉靜態優先級清單 ----

   舊策略的詞條選擇是一份寫死的保留清單（policy.lists.affixWeapon 之類）。
   問題不是清單排錯，是**清單這種形式本身表達不出正確答案**——正確答案隨面板改變：

     暴擊率 5% 時，一條爆傷詞條的邊際 DPS 幾乎是 0（實測 +0.52%）
     暴擊率 60% 時，同一條爆傷是全場最高

   實測本專案 20 小時的面板：atkFlat +11.11% / hit +6.35% / atkPct +2.96% /
   critRate +1.90% / critDmg +0.52%。任何固定名次在某個階段一定是錯的，
   而錯的時候不會有人發現，只會看到「AI 卡住了」。

   ---- 這裡只做排序，不做評估 ----

   ΔDPS / ΔEHP 由評估器算（scripts/sim/evaluator.js，跑在引擎 context，
   呼叫遊戲的 computeStats）。這裡拿到的已經是純數字，做的事只有兩件：
   依敗因決定攻防權重，然後排序。策略仍然只是「在一堆數字裡挑最大的」。 */
function rankRoi(state, policy) {
  var cfg = policy.roi;
  if (!cfg || !cfg.source) return null;
  var table = pathVal(state, cfg.source);
  if (!table) return null;

  /* ---- 攻防權重由敗因決定 ----
     player_strategy.md v2.0：「超時就全堆攻，被秒殺才補對應屬性抗性或生命」。
     沒有敗因時用中性權重（各半），不是預設堆攻——沒有診斷就不該有偏見。 */
  var cause = state.ctx && state.ctx.cause;
  var w = cfg.weights || {};
  var pair = w[cause] || w.neutral || { offense: 1, ehp: 1 };
  var wo = Number(pair.offense) || 0;
  var we = Number(pair.ehp) || 0;

  var ranked = [];
  for (var key in table) {
    var r = table[key];
    if (!r) continue;                                  // 這條詞條在身上找不到合法部位
    var score = (Number(r.dOffPct) || 0) * wo + (Number(r.dEhpPct) || 0) * we;
    /* 同一條詞條落在**太古位置**上的分數。太古位置洗煉只換種類、永遠維持太古，
       而太古的數值走另一條乘算路徑（見 evaluator.js evalProbeAffix 的註解），
       所以同樣一次洗煉落在太古位置上明顯比較划算。
       面板沒給這個欄位時（舊的評估器）退回一般分數，不會因此高估。 */
    var scoreAnc = (r.dOffPctAncient === undefined)
      ? score
      : (Number(r.dOffPctAncient) || 0) * wo + (Number(r.dEhpPctAncient) || 0) * we;
    ranked.push({
      key: key, slotKey: r.slotKey, score: score, scoreAncient: scoreAnc,
      dOffPct: r.dOffPct, dEhpPct: r.dEhpPct
    });
  }
  /* 決定論：分數相同時以鍵名排序，不能讓物件的鍵順序決定結果。 */
  ranked.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
  });

  return {
    cause: cause || null,
    weights: { offense: wo, ehp: we },
    ranked: ranked,
    best: ranked.length ? ranked[0] : null,
    /* 門檻：低於這個增幅就不值得花精華去追。沒有門檻的話，
       全身詞條都達標之後 AI 仍會為了 +0.01% 無限洗煉，把精華燒光。 */
    minGainPct: (typeof cfg.minGainPct === 'number') ? cfg.minGainPct : 0.5
  };
}

/* ============ 止損與過渡（Resource Stop-loss） ============

   player_strategy.md v2.0：「若資源／金幣低於一定比例，AI 自動降級詞條要求
   （選擇次佳詞條），避免因死摳完美太古裝而卡死資源累積。」

   ---- 為什麼需要分母 ----

   「金幣低於一定比例」的比例要有分母。用固定門檻（例如「金幣 < 10 萬」）
   在前期太嚴、後期形同虛設——強化成本隨等級成長，10 萬在關卡 20 是巨款、
   在關卡 150 連一次強化都不夠。

   所以分母取**遊戲當下報的成本**（panels.eval.resources.upgradesAffordable
   ＝身上最貴那件還能再強化幾次）。這個比值在任何階段都是同一個意思。

   ---- 實測動機 ----

   一場 20 小時的模擬送了 52,465 次 item.upgrade，遊戲回「資源不足」51,353 次（98%）。
   策略完全不看有沒有錢就一路送，於是資源永遠在見底邊緣，每一項投資都做不完整。 */
function evalStopLoss(state, policy) {
  var cfg = policy.stopLoss;
  if (!cfg) return null;

  var afford = pathVal(state, cfg.affordPath);
  var essence = Number(pathVal(state, cfg.essencePath));
  var lean = false, reasons = [];

  /* null＝身上沒有裝備可強化（開局那幾秒）。當成「不缺」而不是「缺」：
     缺的那一側會降級要求，開局就降級沒有意義。 */
  if (typeof afford === 'number' && isFinite(afford)) {
    var need = (typeof cfg.minUpgradesAffordable === 'number') ? cfg.minUpgradesAffordable : 3;
    if (afford < need) { lean = true; reasons.push('upgrade'); }
  }
  if (isFinite(essence)) {
    var needE = (typeof cfg.minEssence === 'number') ? cfg.minEssence : 0;
    if (essence < needE) { lean = true; reasons.push('essence'); }
  }

  return {
    lean: lean,
    reasons: reasons,
    /* 過渡模式下把 ROI 門檻放寬幾倍：只要出現「還可以」的詞條就停手去推關，
       不再追最佳解。倍率 >1 代表要求**更高**的增幅才動手（＝更少動手、更省資源）。 */
    gainMultiplier: lean ? ((typeof cfg.leanGainMultiplier === 'number') ? cfg.leanGainMultiplier : 4) : 1
  };
}

/* ============ 目標與缺口 ============

   策略原本寫的是「該做什麼」——一份靜態的詞條保留清單。問題是正確答案會隨關卡改變：
   關卡 100 不需要命中率，關卡 146 命中率是唯一解。任何固定清單必然在某個階段是錯的，
   而錯的時候不會有人發現，只會看到「AI 卡住了」。

   實測過的例子：怪物閃避在關卡 130 是 86.8%、關卡 150 是 103%，而命中公式是
   clamp(自身命中 − 對手閃避, 5%, 100%)。角色面板命中 100%、身上 65 條詞條一條命中率
   都沒有，於是有效命中率觸底 5%——13,718 次出手只中 551 次。策略完全不知道這件事，
   它以為自己物攻 91K 很強。

   改成宣告「要達成什麼」：每個 target 是一個可量測的目標值，直譯器每個決策點算出
   當前值與缺口，掛在 ctx.deficit 供規則使用。補到目標缺口自然歸零，優先序自己讓位，
   不需要有人去改清單。

   目標的度量方式刻意只做少數幾種 kind，不做運算式語言——策略是資料不是程式，
   能算的東西愈少愈好稽核。要新的度量就加一種 kind，並在這裡寫清楚它算什麼。 */

/* ---- 速率型目標的取樣 ----

   ratePerMin 量的是「一個累積計數器每分鐘增加多少」，例如野外擊殺數。
   它跟其他 kind 不一樣：單看一個瞬間的值沒有意義，必須有兩個時刻才算得出來，
   所以要在觀測時累積，不能等到決策點才現讀。

   為什麼需要這種度量：命中率、抗性、生存餘裕這些都是**原因**，而
   player_strategy.md 定義安全關卡用的是**結果**——「能在平均 3 秒內殺死一個敵人」。
   量結果的好處是它一次涵蓋所有原因：命中不足、傷害不足、抗性不足、被打斷，
   任何一項出問題都會反映在殺敵速度上，不必替每一個原因各寫一條規則。

   ⚠️ 計數器要挑對來源。這裡用的是遊戲的 LOOT_STATS：
     - 離線結算**不會**寫進 LOOT_STATS（js/save.js 的 applyOfflineProgress 不呼叫
       recordLootKill），所以離線那一段不會汙染速率
     - 但塔戰的 BOSS 會計入總數（js/tower.js），所以要指到 sources.field 那一桶，
       不要指到總數——否則爬塔會被誤算成「野外打得動」 */
function sampleRates(state, policy, memo) {
  var list = policy.targets || [];
  if (!list.length) return;
  var now = Number(state.gameTimeSec) || 0;
  if (!memo.rates) memo.rates = {};

  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    if (!t || t.kind !== 'ratePerMin' || !t.id) continue;
    var raw = pathVal(state, t.counter);
    if (raw === null || raw === undefined) continue;   // 這一拍沒送這個面板，跳過不記
    var v = Number(raw);
    if (!isFinite(v)) continue;

    var r = memo.rates[t.id] || (memo.rates[t.id] = { pts: [] });
    var pts = r.pts;
    var last = pts.length ? pts[pts.length - 1] : null;

    /* 觀測與決策可能落在同一個遊戲時刻（決策點本身也是觀測時刻）。
       時間沒前進就只更新最後一點，不新增——否則視窗會被同時刻的重複點灌滿。 */
    if (last && now - last.t <= 0) { last.v = v; continue; }

    /* 計數器倒退＝被歸零（遊戲的統計「清理」會重建 LOOT_STATS）。
       不處理的話差分變負數，速率會憑空變成 0 以下，閘門就被一個假訊號關上。 */
    if (last && v < last.v) { r.pts = pts = []; last = null; }

    /* 取樣中斷過就重新起算。

       ⚠️ 這一條是離線期間的必要防護。state.gameTimeSec 是含離線的牆鐘
       （scripts/sim/engine.js 的 gameTimeSec 讀 vNowMs，而 offlineFor 會把它往前推），
       但離線收益不寫 LOOT_STATS。所以離線 16 小時之後那一拍是「時間過了 57,600 秒、
       擊殺 0 隻」——速率被算成 0 隻/分，閘門會在每天上線的頭五分鐘誤判成打不動並退關。
       中斷不是「打不動」，是「沒在看」，兩者要分開。 */
    var gap = (typeof t.maxGapSec === 'number') ? t.maxGapSec : windowSecOf(t);
    if (last && (now - last.t) >= gap) { r.pts = pts = []; }

    pts.push({ t: now, v: v });

    /* 只留視窗內的點，外加一個剛好在視窗起點之前的點當基準。
       pts[0] 是基準，pts[1] 一旦也出了視窗才丟得掉 pts[0]。 */
    var win = windowSecOf(t);
    while (pts.length > 2 && (now - pts[1].t) >= win) pts.shift();
  }
}

function windowSecOf(t) {
  return (typeof t.windowSec === 'number' && t.windowSec > 0) ? t.windowSec : 300;
}

function evalTargets(state, policy, memo) {
  var out = {};
  var list = policy.targets || [];
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    if (!t || !t.id) continue;

    /* 目標可以有前提。用途是**排順序**，不是開關：真人的打法是
       「先在穩定關卡快速刷怪累積材料，穿上 Lv100 史詩／傳說之後才去洗寶石鑲嵌率；
       在那之前能洗到經驗加成就很好，升級速度差很多」。
       寶石鑲嵌率期望要 168 次洗煉才中一條，材料不夠時去追它等於把精華燒在
       最貴的那一項上，其他兩項也拿不到。

       前提不成立時回報 met＝已達標，讓缺口規則自動讓位給還沒達標的目標。 */
    if (t.when && !testCond(state, t.when)) {
      out[t.id] = { value: null, target: t.atLeast, cap: t.atMost, short: 0, over: 0, met: true, waiting: true };
      continue;
    }

    var value = null;

    if (t.kind === 'selfMinusEnemy') {
      /* 自身屬性減去對手的對應屬性，並套用遊戲的夾值（例如命中率下限 5%、上限 100%）。
         夾值必須套：不套的話「命中 100 − 閃避 103 = −3」會被當成缺口 98，
         但實際上再怎麼補到 100 之前都是 5%，缺口的大小會誤導優先序。 */
      /* ⚠️ 一定要先擋 null/undefined 再轉數字：Number(null) 是 0 不是 NaN。
         漏了這一步，還沒觀測到怪物時會被算成「閃避 0 ⇒ 命中 100% ⇒ 已達標」——
         一個假的達標，缺口規則整場都不會啟動，而且完全沒有徵兆。 */
      var selfRaw = pathVal(state, t.self);
      var enemyRaw = pathVal(state, t.enemy);
      var self = (selfRaw === null || selfRaw === undefined) ? NaN : Number(selfRaw);
      var enemy = (enemyRaw === null || enemyRaw === undefined) ? NaN : Number(enemyRaw);
      if (isFinite(self) && isFinite(enemy)) {
        value = self - enemy;
        if (typeof t.clampMin === 'number') value = Math.max(t.clampMin, value);
        if (typeof t.clampMax === 'number') value = Math.min(t.clampMax, value);
      }
    } else if (t.kind === 'value') {
      var v = Number(pathVal(state, t.path));
      if (isFinite(v)) value = v;
    } else if (t.kind === 'affixCount') {
      /* 身上（限定部位）已經有幾條這條詞條。

         為什麼需要這一種：player_strategy.md 對首飾的要求是「至少保證共 N 條
         寶石鑲嵌率／經驗加成／掉寶率」——那是**數量下限**，而保留清單
         （rerollOffTarget）只表達得出「這些可以留」，表達不出「這個要湊到 N 條」。
         實測後果：極限玩家 5 個 seed、15 件首飾，規格各 3 條，實際只出現
         寶石鑲嵌 1 條、經驗 4 條、掉寶 2 條——因為那三條合計只佔項鏈詞條池權重的
         3%（336 分之 10），保留清單裡有 18 項可接受，隨便中一項就停手。 */
      var acEquip = pathVal(state, t.equipment || 'panels.inv.equipment') || {};
      var acN = 0;
      for (var acK in acEquip) {
        var acIt = acEquip[acK];
        if (!acIt || !acIt.affixes) continue;
        /* slots 同時接受裝備欄位鍵（ring2）與遊戲的部位鍵（ring）——
           兩套鍵在戒指與副手上不一致，只認一套就會漏掉一格。 */
        if (t.slots && t.slots.indexOf(acK) < 0 && t.slots.indexOf(acIt.slot) < 0) continue;
        for (var acA = 0; acA < acIt.affixes.length; acA++) {
          if (acIt.affixes[acA] && acIt.affixes[acA].key === t.affixKey) acN++;
        }
      }
      value = acN;
    } else if (t.kind === 'ratePerMin') {
      /* 取樣點由 sampleRates 累積，這裡只做差分。
         視窗還沒攢夠就回 null（＝unknown）：資料不足時不要下判斷，
         「還不知道」跟「已達標」與「沒達標」是三件不同的事。 */
      var rr = memo.rates && memo.rates[t.id];
      var pts = rr && rr.pts;
      if (pts && pts.length >= 2) {
        var a = pts[0], b = pts[pts.length - 1];
        var span = b.t - a.t;
        /* 預設要求視窗攢到一半才給值。太短的視窗在殺敵這種離散事件上雜訊很大：
           3 秒殺一隻的關卡，隨便一個 10 秒的空窗都會被算成 0 隻/分。 */
        var minSpan = (typeof t.minSpanSec === 'number') ? t.minSpanSec : windowSecOf(t) / 2;
        if (span > 0 && span >= minSpan) value = (b.v - a.v) / span * 60;
      }
    }

    if (value === null) {
      out[t.id] = { value: null, target: t.atLeast, cap: t.atMost, short: 0, over: 0, met: true, unknown: true };
      continue;
    }
    /* ---- 目標可以是下限、上限，或兩者 ----

       atLeast 是「至少要到這個值」（命中率、詞條條數）。
       atMost 是「不可以超過這個值」，加進來是為了表達**死亡率**這種目標——
       它天生是上限，用 atLeast 表達不出來。

       實測動機：Codex 的獨立驗證抓到 seed 20260903 退步，逐 2 小時的曲線顯示
       ROI 策略 20 小時死了 **1,137 次**，而對照組只有 49 次（23 倍）。
       角色一直站在打不動的關卡重複送死，於是撿不到裝備、也跨不過裝等斷點——
       諷刺的是那正是這個機制原本要修的東西。
       當時沒有任何一道閘門在量「我是不是一直在死」。 */
    var hasMin = (typeof t.atLeast === 'number');
    var hasMax = (typeof t.atMost === 'number');
    var short = hasMin ? Math.max(0, t.atLeast - value) : 0;
    var over = hasMax ? Math.max(0, value - t.atMost) : 0;
    out[t.id] = {
      value: value,
      target: hasMin ? t.atLeast : null,
      cap: hasMax ? t.atMost : null,
      short: short,
      over: over,
      met: short <= 0 && over <= 0,
      unknown: false
    };
  }
  return out;
}

/* 高頻觀測的進入點。不回傳指令——觀測不是操作，玩家看戰鬥不算按按鈕。
   驅動端每 observeEverySec 呼叫一次，與 decide 的頻率無關。 */
function observe(state, policy, memo) {
  sampleRates(state, policy, memo);
  observeCombat(state, policy, memo);
}

/* 回傳這個決策點要送出的指令陣列。純函式：同樣的輸入必定得到同樣的輸出。 */
function decide(state, policy, memo) {
  updateContext(state, policy, memo);
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
      var eqItems = pathVal(state, cfg.equipment || 'panels.inv.equipment') || {};

      /* 依據 player_strategy.md「品質高優先穿」鐵律：
         1. 只要背包物品的品質 (rarity) > 身上現有裝備的品質，100% 強制換上！
         2. 若品質相同，評分 (score) 較高者優先換上！ */
      var used = {};
      for (var slotKey in eqScores) {
        /* 部位歸屬以遊戲提供的 item.slots 為準（面板欄位，來自 equipSlotsForItem）。
           舊版是把部位鍵結尾的數字去掉當基礎部位——那對戒指沒問題，
           但雙手武器的合法部位只有 weapon，硬塞進 weapon2 會害主手被卸下。
           沒有 slots 欄位的舊資料才退回去數字的作法。 */
        var baseSlot = String(slotKey).replace(/\d+$/, '');
        /* 身上那件的排名。equipmentRarities 只有品質，等級與太古數要從
           equipment 的完整物件取；沒有那件時 itemRank 會回全 -1，任何一件都贏它。 */
        var currItem = eqItems[slotKey];
        var currRank = currItem
          ? itemRank(currItem, eqScores[slotKey] || 0)
          : [(typeof eqRarities[slotKey] === 'number') ? eqRarities[slotKey] : -1, null, null, eqScores[slotKey] || 0];

        var best = null, bestRank = null;
        for (var it = 0; it < items.length; it++) {
          var item = items[it];
          if (!item || item.locked) continue;
          var fits = (item.slots && item.slots.length)
            ? (item.slots.indexOf(slotKey) >= 0)     // 遊戲說了算
            : (item.slot === baseSlot);              // 舊資料退路
          if (!fits) continue;
          if (used[item.id]) continue;

          var rk = itemRank(item);
          if (!best || rankBetter(rk, bestRank)) { best = item; bestRank = rk; }
        }
        if (!best) continue;

        /* ---- 保住已經投資在太古位置上的關鍵詞條 ----

           ⚠️ 先講一個試過而且失敗的版本：「身上這件帶著補缺口的詞條就不換」。
           實測 100 小時從關卡 190 掉到 117——因為那個條件綁的是**缺口未補滿**，
           而目標訂了達不到的值時它永遠成立，保護就變成永久凍結，裝備停止升級。
           通則：任何「缺口未補滿時就改變行為」的規則都要能在目標達不到時自己收手。

           keepInvested 綁的是完全不同的東西：**這件裝備的太古位置上實際帶著什麼**。
           那是有界的（太古位置數量固定、看得見、與目標達成與否無關），不會凍結。

           為什麼只保太古位置：太古位置洗煉必為滿值且永遠維持太古（js/item.js 的
           rerollSingleAffix），所以洗在太古上的關鍵詞條是**可累積的永久投資**；
           洗在普通位置上的，換裝之後重洗一次就回來了。

           真人存檔就是這樣打的：ring2 是史詩 Lv50，三條太古分別帶著寶石鑲嵌、
           掉寶率、經驗加成，於是他留著它並把強化從 +5 堆到 +20；而 boots 的太古
           帶的是力量／智力／法力恢復（雜項），他就換成傳說 Lv100 了。
           規則不是「有太古就留」，是「太古位置帶的是不是關鍵詞條」。

           ⚠️ 背包投影沒有 affixes（js/worker/sim.worker.js 的 INV_CELL_FIELDS 刻意
           裁掉，加回去裁切效益從 56% 掉到 17%），所以候選裝備帶什麼看不到，
           只看得到 ancientCount。這個不對稱是可接受的：新掉落的太古位置是隨機的，
           期望帶到關鍵詞條的機率極低。真要放行就靠 overrideRarityGap。 */
        var ki = cfg.keepInvested;
        if (ki && currItem && currItem.affixes) {
          var keyset = {};
          var kiT = policy.targets || [];
          for (var kti = 0; kti < kiT.length; kti++) {
            if (kiT[kti] && kiT[kti].affixKey) keyset[kiT[kti].affixKey] = true;
          }
          var invested = 0;
          for (var kai = 0; kai < currItem.affixes.length; kai++) {
            var kaf = currItem.affixes[kai];
            if (!kaf || !kaf.key) continue;
            if (ki.ancientOnly !== false && !kaf.ancient) continue;
            if (keyset[kaf.key]) invested++;
          }
          if (invested > 0) {
            /* ⚠️ 裝等必須先看，而且比品質重要。
               詞條數值 =（基礎值 + 成長基礎值×每級成長×(裝等−1)）× 品質倍率（js/item.js affixValue），
               裝等 1 的詞條只剩基礎值，等於沒有。只比品質的話，一件裝等 1 的 R4
               會把整個部位鎖到 R6 才放行——實測 100 小時後 ring／ring2／amulet
               三個部位全都停在 R4 裝等 1，其餘九個部位早就是 R5 裝等 100。

               同一條詞條換到更高裝等的底子上一定更強，而且洗煉可以再洗回來，
               所以「候選裝等更高」時保護一律不成立，不看品質。 */
            var lvGap = (typeof ki.overrideLevelGap === 'number') ? ki.overrideLevelGap : 0;
            var curLv = (typeof currItem.level === 'number') ? currItem.level : 0;
            var bestLv = (typeof best.level === 'number') ? best.level : 0;
            if (bestLv > curLv + lvGap) {
              /* 裝等更高：放行，不套用保護 */
            } else {
              /* 品質高出這麼多階就仍然換——避免一件早期的低階裝把那個部位永久鎖死。 */
              var gap = (typeof ki.overrideRarityGap === 'number') ? ki.overrideRarityGap : 2;
              var curR = (typeof currItem.rarity === 'number') ? currItem.rarity : -1;
              if ((best.rarity || 0) < curR + gap) continue;
            }
          }
        }

        if (rankBetter(bestRank, currRank)) {
          used[best.id] = true;
          out.push({ name: r.cmd, args: { itemId: best.id, slotKey: slotKey }, ruleId: r.id });
        }
      }
    } else if (r.socketEmpty) {
      /* 把寶石鑲進身上裝備的空插槽。

         為什麼需要：先前策略完全沒有 gem.socket 規則，於是寶石只進不出——
         實測 2 小時後身上握著 31 顆寶石、13 個部位卻是 0 鑲嵌、24 個空插槽全開著。
         寶石不鑲等於沒有，這是純粹的漏做。

         哪一種寶石由策略資料指定，對應 player_strategy.md 的「寶石鑲嵌策略」：
         偏好序隨等級改變（前 50 級／51~100／101 以後各一段），101 以後那段是
         「一半爆傷、一半六大屬性傷害加成」——用 mix 表示，兩組輪流取用。
         夠不夠鑲、等級對不對一律由遊戲判斷，這裡只負責找出空槽並送指令。
         鑲上去的階級也是遊戲挑的（socketGem 取庫存中最高階），所以策略只要在
         鑲嵌前先把寶石合成上去，就會自動鑲到當前可得的最高品質。 */
      var sCfg = r.socketEmpty;
      var sEquip = pathVal(state, sCfg.equipment) || {};
      var heldGems = pathVal(state, sCfg.gems) || {};

      /* ⚠️ 不能寫死寶石種類。socketGem() 找不到那種寶石就直接回「沒有這種寶石」
         （js/item.js:368），實測寫死 garnet 的話 1,421 次呼叫全部落空——
         身上明明有 31 顆，只是沒有那一種。
         所以先把「哪些種類真的有貨、各有幾顆」算出來，之後每送一顆就扣一顆；
         送超過庫存的話多出來的每一條都會換回「沒有這種寶石」，實測一次決策點
         就浪費 183 次呼叫，把報表淹掉。 */
      var sStock = gemStock(heldGems, sCfg.minLevelByType);

      /* 偏好群組：preferByLevel 分段（types＝偏好序；mix＝多組輪流取用），
         沒設定就退回單一段的 preferTypes。 */
      var sBand = bandGroups(pickBand(state, sCfg.preferByLevel, sCfg.levelPath), sCfg.preferTypes);
      var groupTurn = 0;
      var cursor = [];
      for (var ci = 0; ci < sBand.groups.length; ci++) cursor.push(0);

      /* 配額先補：抗性各一顆、法力不夠時補法力恢復，這些是「至少要有」而不是
         「優先鑲滿」，所以排在偏好序之前、但只補到數量為止。 */
      var needs = gemQuotaNeeds(state, sCfg.quota, sEquip, sStock.stockOf);

      if (sStock.available.length) {
        for (var ssk in sEquip) {
          var sItem = sEquip[ssk];
          if (!sItem || !sItem.id || !sItem.sockets) continue;
          var hasEmpty = false;
          for (var si = 0; si < sItem.sockets.length; si++) if (!sItem.sockets[si]) { hasEmpty = true; break; }
          if (!hasEmpty) continue;

          var pick = null;
          while (needs.length && !pick) {
            if (sStock.stockOf[needs[0].type] > 0) pick = needs[0].type;
            if (--needs[0].remaining <= 0 || !pick) needs.shift();
          }
          if (!pick) {
            pick = pickGemType(sBand.groups, groupTurn, cursor, sBand.spread, sStock.stockOf, sStock.available, true);
            if (pick) groupTurn = (groupTurn + 1) % sBand.groups.length;
          }
          if (!pick) break;                       // 庫存見底
          sStock.stockOf[pick]--;
          /* 每個部位一次只送一顆：鑲上之後空槽與庫存都會變，下個決策點再算一次即可。 */
          out.push({ name: r.cmd, args: { itemId: sItem.id, type: pick }, ruleId: r.id });
        }
      }
    } else if (r.salvageBelowEquipped) {
      /* 熔爐的分解品質門檻要跟著身上的裝備一起往上升。

         player_strategy.md 的「最佳分解策略」是：全身穿滿某品質時，把低於身上的
         全部分解。先前這條規則是 once:true——開局設定一次「只拆 R0/R1」就再也不動，
         於是稀有裝一路累積：101 小時實測背包 298 格裡有 247 件稀有（83%），
         背包一滿，掉落連熔爐佇列都進不去而被直接丟棄（pushConveyor），
         主手那把獨特武器 90 小時都等不到。

         門檻取身上**最低**的品質：低於它的裝備不可能升級任何一個部位。
         只在狀態與現況不同時才送指令，免得每次決策都送一輪必然無效的設定。 */
      var svCfg = r.salvageBelowEquipped;
      var svRar = pathVal(state, svCfg.equippedRarities) || {};
      var furnaces = pathVal(state, svCfg.furnaces) || [];
      var minRar = null;
      for (var svk in svRar) {
        var rv3 = Number(svRar[svk]);
        if (!(rv3 >= 0)) continue;                       // -1＝空部位
        if (minRar === null || rv3 < minRar) minRar = rv3;
      }
      if (minRar !== null) {
        for (var fi = 0; fi < furnaces.length; fi++) {
          var fu = furnaces[fi];
          if (!fu || fu.id === undefined || !fu.qualities) continue;
          for (var qi = 0; qi < fu.qualities.length; qi++) {
            var want = qi < minRar;
            if (!!fu.qualities[qi] === want) continue;
            out.push({ name: r.cmd, args: { furnaceId: fu.id, rarity: qi, on: want }, ruleId: r.id });
          }
        }
      }
    } else if (r.salvageWhenFull) {
      /* 背包壓力閥：快滿時把「配不上身上最好那件」的庫存一次清掉。

         為什麼需要：背包滿了不只是換裝挑不到東西，而是**整條掉落管線停擺**——
         熔爐佇列推不進背包就回堵，新裝備直接丟棄。角色會停在原地打幾十小時，
         畫面上完全正常，只是再也不會有任何東西掉下來。

         門檻取身上**最高**品質往下 belowMaxBy 階。平常不動；只有在空間真的稀缺時，
         才用「留得下最好的」這個標準取代「留得下可能有用的」。 */
      var bfCfg = r.salvageWhenFull;
      var bfCnt = Number(pathVal(state, bfCfg.count)) || 0;
      var bfCap = Number(pathVal(state, bfCfg.cap)) || 0;
      var bfRatio = (typeof bfCfg.fullRatio === 'number') ? bfCfg.fullRatio : 0.9;
      if (bfCap > 0 && (bfCnt / bfCap) >= bfRatio) {
        var bfRar = pathVal(state, bfCfg.equippedRarities) || {};
        var maxRar2 = -1;
        for (var bk in bfRar) { var bv = Number(bfRar[bk]); if (bv > maxRar2) maxRar2 = bv; }
        var cut = maxRar2 - ((typeof bfCfg.belowMaxBy === 'number') ? bfCfg.belowMaxBy : 1);
        if (cut >= 0) out.push({ name: r.cmd, args: { maxRarity: cut }, ruleId: r.id });
      }
    } else if (r.forgeSlots) {
      /* 熔爐零件格解鎖（金幣）。

         為什麼需要：實測 20 小時的存檔，兩座熔爐都是 **0/3 格、一個零件都沒裝**，
         而零件庫存裡每一種都已經是 T7×10（庫存上限）。整個熔爐零件系統整場沒被用過。

         成本由遊戲給（panels.newforge.partSlotCost，逐爐、已達上限為 null），
         策略不重算——那條公式與熔爐座數和轉生數連動（formula.js newForgePartSlotCost）。
         先比對成本再送出，理由同 buyInvUpgrade：不比的話全是金幣不足的空轉。

         goldRatio 是保留閥：金幣同時要餵強化與背包擴充，不能為了解鎖格子把它抽乾。 */
      var fsCfg = r.forgeSlots;
      var fsFur = pathVal(state, fsCfg.furnaces) || [];
      var fsCost = pathVal(state, fsCfg.slotCosts) || [];
      var fsGold = Number(pathVal(state, fsCfg.gold)) || 0;
      var fsRatio = (typeof fsCfg.goldRatio === 'number') ? fsCfg.goldRatio : 0.25;
      for (var fsi = 0; fsi < fsFur.length; fsi++) {
        var fsFu = fsFur[fsi];
        var fsC = fsCost[fsi];
        if (!fsFu || fsFu.id === undefined) continue;
        if (typeof fsC !== 'number') continue;           // null＝已達上限
        if (fsC > fsGold * fsRatio) continue;
        out.push({ name: r.cmd, args: { furnaceId: fsFu.id }, ruleId: r.id });
        /* 一次只解一格：解完成本會變（指數隨已解鎖格數上升），下個決策點重算即可。
           同一拍連送兩次會用到過期的成本，第二次多半是空轉。 */
      }
    } else if (r.forgeParts) {
      /* 熔爐零件配置。

         player_strategy.md 的熔爐策略（使用者口述）：
           一座爐 8 格全押「附魔精華產出」、另一座 8 格全押「裝備碎片產出」，
           之後依換裝實際消耗掉的材料剩餘，再微調兩爐的零件比例；
           若產能跟不上打怪速度（產品開始堆積），適度放上加速零件。

         這裡把那三句話拆成三個可觀測的訊號，全部由遊戲的面板提供：
           基本盤   plan[爐序]      —— 每座爐的主力零件
           微調     rebalance       —— 只有一種材料見底時，另一座爐讓出 shiftSlots 格
           加速     backlog         —— 該爐專屬佇列積到門檻才換上加速齒輪

         ⚠️ 熔爐只保存零件種類，不保存階級；效果數值一律由遊戲的全域
         partLevels 即時計算。零件不佔用也不消耗庫存，同類型可以重複裝滿、
         兩座爐可以共用同一批零件（newforge.js newForgeInstallPart）。
         因此這裡不必做庫存配額，也不必因零件升級而拆下重裝。 */
      var fpCfg = r.forgeParts;
      var fpFur = pathVal(state, fpCfg.furnaces) || [];
      var fpPlan = fpCfg.plan || [];
      /* plan（一爐一種）與 mix（每爐同一比例）兩種寫法擇一，有任一個就開工。
         ⚠️ 這裡原本只看 fpPlan.length——改用 mix 而把 plan 拿掉之後，
         整條規則會靜靜地一個指令都不送，而報表上只會看到「熔爐 0 格零件」。 */
      if (fpPlan.length || (fpCfg.mix && fpCfg.mix.length)) {
        /* ---- 微調：哪一種材料比較緊 ----
           ⚠️ 不能用「庫存低於某個絕對值」判斷。這份策略把精華與碎片都花到見底
           （實測 20 小時結局：精華 8、碎片 661），任何絕對門檻都會同時成立，
           規則等於整場不動——那是我第一版寫錯的地方。

           改比**滿足率** fill = 庫存 / ref：ref 是策略宣告的「這種材料存到多少算寬裕」，
           作用是把兩種單位換算到同一把尺（洗一次 5~6 精華、強化一次數百碎片，
           直接比大小沒有意義）。兩邊都見底時仍分得出誰更緊，這正是需要的。

           ⚠️ 一定要用 庫存/ref 而不是 ref/庫存。後者在庫存 0 的時候會退化成
           「ref 比較大的那一種永遠贏」——開局兩種都是 0，卻會判成碎片緊 100 倍。
           滿足率沒有這個問題：0/50 與 0/5000 都是 0，分不出來就不動。

           差距要大到 minRatio 倍才搬，免得在兩者相當時來回搬格子。 */
        var fpShiftTo = null;
        var fpShiftFrom = null;
        var fpShift = 0;
        var rbCfg = fpCfg.rebalance;
        if (rbCfg && rbCfg.materials && rbCfg.materials.length === 2) {
          var fill = [];
          for (var rbi = 0; rbi < rbCfg.materials.length; rbi++) {
            var mat = rbCfg.materials[rbi];
            if (!mat || !mat.part) { fill = null; break; }
            var stock = Number(pathVal(state, mat.stock));
            var ref = Number(mat.ref) || 0;
            if (!(stock >= 0) || !(ref > 0)) { fill = null; break; }   // 面板讀不到／沒宣告 ref 就不動
            fill.push({ part: mat.part, f: stock / ref });
          }
          if (fill && fill.length === 2) {
            var minRatio = (typeof rbCfg.minRatio === 'number') ? rbCfg.minRatio : 2;
            var rich = fill[0].f >= fill[1].f ? fill[0] : fill[1];
            var poor = rich === fill[0] ? fill[1] : fill[0];
            /* rich.f > 0 這個條件擋掉「兩邊都是 0」——那時誰更緊是分不出來的。 */
            var verdict = (rich.f > 0 && rich.f > poor.f * minRatio) ? poor.part : null;

            /* ---- 遲滯：同一個判斷要連續成立 holdRounds 次才動手 ----
               兩種材料都是「攢一批、一次花光」的用法，庫存本身在跳，
               單看一拍的比值會每 5 分鐘翻一次面。實測 seed20260903 的日誌：
               16:50 把碎片熔煉爐裝進 1 號爐、16:55 又換回精粹透鏡，
               整場 308 次安裝／146 次拆卸，其中大半是這樣來回搬。

               churn 本身不花資源，但時間平均下來等於沒有微調過——
               而且熔爐派工取負載最少者，兩座爐互相讓格子會直接互相抵銷。 */
            if (!memo.forge) memo.forge = {};
            var fm = memo.forge[r.id] || (memo.forge[r.id] = { last: null, run: 0, applied: null });
            if (verdict === fm.last) fm.run++;
            else { fm.last = verdict; fm.run = 1; }
            var hold = (typeof rbCfg.holdRounds === 'number') ? Math.max(1, rbCfg.holdRounds) : 3;
            if (fm.run >= hold) fm.applied = verdict;

            if (fm.applied) {
              fpShiftTo = fm.applied;
              /* 讓格子的來源＝**最寬裕的那一種材料**，不是尾端隨便挑。
                 從尾端讓的話會系統性地吃掉 mix 裡排最後的那一種：實測
                 精華滿足率 0.08、碎片 0.91，微調每一拍都觸發，把排在尾端的
                 兩個寶石採集器換成精粹透鏡，20 小時下來 gemCollector 一個都不剩。 */
              fpShiftFrom = rich.part;
              fpShift = Math.max(0, Math.floor(Number(rbCfg.shiftSlots) || 0));
            }
          }
        }

        for (var fpi = 0; fpi < fpFur.length; fpi++) {
          var fu2 = fpFur[fpi];
          if (!fu2 || fu2.id === undefined) continue;
          var slots = Math.max(0, Math.floor(Number(fu2.partSlots) || 0));
          if (!slots) continue;
          var mine = fpPlan.length ? fpPlan[fpi % fpPlan.length] : null;

          /* ---- 想要的配置 ----

             兩種寫法：
               plan  一座爐一種主力零件（舊寫法，plan[爐序]）
               mix   每一座爐都照同一個比例混裝（[{part, count}, ...]）

             混裝才是對的：熔爐派工是負載平衡的（newForgeDispatchTarget 挑最閒的），
             所以一件裝備會落到哪座爐是隨機的。一爐全精華、一爐全碎片的話，
             同一件裝備只會吃到其中一種加成；每爐都照同一個比例，才是每一件都吃到。

             格數不足 8 時按比例分配（最大餘數法，同餘照宣告順序），
             這樣早期只有 3 格也會先給比重最高的那一種。 */
          var want = [];
          var fpMix = fpCfg.mix;
          if (fpMix && fpMix.length) {
            var totalW = 0;
            for (var mi = 0; mi < fpMix.length; mi++) totalW += Math.max(0, Number(fpMix[mi].count) || 0);
            if (totalW > 0) {
              var alloc = [], used = 0;
              for (var mj = 0; mj < fpMix.length; mj++) {
                var exact = slots * (Math.max(0, Number(fpMix[mj].count) || 0) / totalW);
                var base = Math.floor(exact);
                alloc.push({ part: fpMix[mj].part, n: base, rem: exact - base, ord: mj });
                used += base;
              }
              /* 餘數大的先拿；完全相同時照宣告順序，維持決定論。 */
              var rest = alloc.slice().sort(function (a, b) { return (b.rem - a.rem) || (a.ord - b.ord); });
              for (var ri = 0; used < slots && ri < rest.length; ri++, used++) rest[ri].n++;
              for (var ak = 0; ak < alloc.length; ak++) {
                for (var an = 0; an < alloc[ak].n; an++) want.push(alloc[ak].part);
              }
            }
          }
          if (!want.length) {
            if (!mine) continue;
            for (var wi = 0; wi < slots; wi++) want.push(mine);
          }

          /* 加速：只在**這一座爐**真的塞車時才換。沒有回堵的爐子加速等於零收益
             （帶上沒東西可燒），拿產量格去換是純虧。 */
          var bkCfg = fpCfg.backlog;
          if (bkCfg && bkCfg.part) {
            var queued = (fu2.queue ? fu2.queue.length : 0) + (fu2.belt ? fu2.belt.length : 0);
            if (queued >= (Number(bkCfg.queueAtLeast) || Infinity)) {
              var bkN = Math.min(slots, Math.max(0, Math.floor(Number(bkCfg.slots) || 0)));
              for (var bi = 0; bi < bkN; bi++) want[bi] = bkCfg.part;
            }
          }

          /* 微調：讓出格子給見底的那一種材料。

             舊寫法是「只有不是自己主力的那座爐要讓」，那個判斷建立在
             「一座爐一種零件」上；改成混裝之後每座爐都同時有兩種材料零件，
             條件永遠不成立，微調等於整條失效。
             改成從尾端把**其他種類**的格子讓出來，混裝與單一主力兩種寫法都適用。 */
          if (fpShiftTo && fpShiftFrom && fpShift) {
            var given = 0;
            for (var si2 = want.length - 1; si2 >= 0 && given < fpShift; si2--) {
              /* 只動「最寬裕那一種材料」的格子。不能改成「除了目標以外都可以讓」——
                 那會把 mix 裡排在尾端的種類系統性地吃光（實測 gemCollector 20 小時
                 一個不剩），而那一種根本不在微調的材料清單裡，本來就不該被牽連。
                 加速格也自然被排除，因為它不是材料零件。 */
              if (want[si2] !== fpShiftFrom) continue;
              want[si2] = fpShiftTo;
              given++;
            }
          }

          /* ---- 收斂：先拆該拆的，再裝該裝的 ---- */
          var have = (fu2.parts || []).slice();
          var need = {};
          for (var ni = 0; ni < want.length; ni++) need[want[ni]] = (need[want[ni]] || 0) + 1;

          /* uninstallCmd 缺席時退化成「只補空格、不動已裝的」——
             送 name:undefined 出去會變成一條遊戲不認得的指令，
             報表上只看得到錯誤計數，看不出是策略少宣告了一個欄位。
             （policy-keys 的哨兵會擋下這個缺漏，這裡只是不讓它變成髒指令。） */
          var canDrop = typeof r.uninstallCmd === 'string' && r.uninstallCmd;
          var drop = [];
          for (var hi = 0; hi < have.length; hi++) {
            var hp = have[hi];
            var keep = false;
            if (hp && hp.key && need[hp.key] > 0) {
              /* 熔爐零件只保存 key；效果等級由遊戲的全域 partLevels 即時計算，
                 升級後不需要拆下重裝，保留同種類格位即可。 */
              keep = true;
            }
            if (!keep && !canDrop) { need[hp.key] = (need[hp.key] || 0); continue; } // 拆不了：這一格就這樣佔著
            if (keep) need[hp.key]--;
            else drop.push(hi);
          }
          /* ⚠️ 一定要由大到小送。newForgeUninstallPart 是 splice，
             先拆小索引會讓後面每一個索引往前位移一格，於是拆錯零件。 */
          for (var di = drop.length - 1; di >= 0; di--) {
            out.push({ name: r.uninstallCmd, args: { furnaceId: fu2.id, slotIndex: drop[di] }, ruleId: r.id });
          }
          /* 沒有拆的能力時，可裝的上限就是實際空格數，超出的會被遊戲擋下。 */
          var room = canDrop ? (slots - (have.length - drop.length)) : (slots - have.length);

          /* 裝：剩下的缺口逐個補。裝不裝得成由遊戲判斷（沒有該類型零件會回錯），
             策略不預判庫存——零件掉落是野外/高塔的事。
             ⚠️ 拆一定要排在裝前面：格子滿的時候 installPart 直接回「零件格已滿」。 */
          for (var nk in need) {
            for (var ai2 = 0; ai2 < need[nk] && room > 0; ai2++, room--) {
              out.push({ name: r.cmd, args: { furnaceId: fu2.id, partKey: nk }, ruleId: r.id });
            }
          }
        }
      }
    } else if (r.enchantPriority) {
      /* 依部位可用的附魔類別挑書附上去。

         遊戲規定每個部位只吃一種類別（enchantCatForType：武器/戒指/手套/護腕＝攻擊，
         項鍊/鞋子＝功能，其餘＝防禦），所以 player_strategy.md 的附魔優先序
         其實是**按類別分工**而不是單一排序：
           功能部位 → 生命值(vigor)
           攻擊部位 → 冰凍(ice)
           防禦部位 → 六大屬性抗性，平均分散

         ⚠️ 部位與類別的對應由遊戲的面板欄位提供（equipmentEnchantInfo），
         策略不自己抄一份。抄一份的話遲早跟遊戲脫鉤，而 manualEnchant 只會回
         「XX 只能使用 OO 類附魔」——看報表完全不會發現整條規則從沒生效過。 */
      var eCfg = r.enchantPriority;
      var eEquip = pathVal(state, eCfg.equipment) || {};
      var eInfo = pathVal(state, eCfg.enchantInfo) || {};
      var eBooks = pathVal(state, eCfg.books) || {};
      /* 情境覆寫：項鏈與鞋子平時放經驗與掉寶率，遇菁英／BOSS 生存不足時
         換成生命值與冷卻縮短（player_strategy.md 附魔策略）。
         第一個條件成立的覆寫說了算，其餘類別沿用基本設定。 */
      var byCat = eCfg.byCategory || {};
      for (var ov = 0; ov < (eCfg.overrides || []).length; ov++) {
        var o = eCfg.overrides[ov];
        if (!o || !o.byCategory) continue;
        if (o.when && !testCond(state, o.when)) continue;
        var merged = {};
        for (var mk in byCat) merged[mk] = byCat[mk];
        for (var ok in o.byCategory) merged[ok] = o.byCategory[ok];
        byCat = merged;
        break;
      }
      var spreadCats = {};
      for (var sc = 0; sc < (eCfg.spread || []).length; sc++) spreadCats[eCfg.spread[sc]] = true;

      /* 每個類別各自的游標，讓「平均分散」那種類別（六大抗性）輪流取用，
         而不是把書全押在清單第一個上。 */
      if (!memo.enchantCursor) memo.enchantCursor = {};
      var eQuota = (typeof eCfg.maxPerDecision === 'number') ? eCfg.maxPerDecision : 4;

      for (var esk in eEquip) {
        if (eQuota <= 0) break;
        var eItem = eEquip[esk];
        var info = eInfo[esk];
        if (!eItem || !eItem.id || !info || !info.cat) continue;
        /* cap 0＝普通裝備不能附魔。 */
        var cur = eItem.enchants || [];
        if (!(info.cap > 0)) continue;

        var cands = byCat[info.cat] || [];
        if (!cands.length) continue;
        var has = {};
        for (var hi = 0; hi < cur.length; hi++) if (cur[hi] && cur[hi].key) has[cur[hi].key] = true;

        /* ---- 格子滿了：低順位的換掉，不要就這樣佔一輩子 ----

           ⚠️ 這裡原本是「已放滿就跳過」，於是**第一本掉到的書把格子佔死**。
           實測 2 小時的存檔：鞋子與項鍊各附了 fortune（那是 util 清單的第五順位，
           只因為它是當下唯一有的書），而真人的同部位是 focus + vigor，
           冷卻縮減 48% 對 AI 的 0%。附魔書是隨機掉的，所以「先到先得」等於隨機配置。

           拆是免費的：removeEnchantAt 會把那本書退回庫存（js/item.js，只有精華不退，
           而那筆精華早就花掉了）。所以只要庫存裡有更高順位的書就該換。
           送出拆的指令即可，下一個決策點自然會用更好的那本補上。 */
        if (cur.length >= info.cap) {
          var rmCmd = r.removeCmd;
          if (!rmCmd) continue;                       // 沒宣告拆的能力：維持舊行為
          var bestRank = -1;
          for (var bi2 = 0; bi2 < cands.length; bi2++) {
            if (has[cands[bi2]]) continue;
            if ((Number(eBooks[cands[bi2]]) || 0) < 1) continue;
            bestRank = bi2; break;                    // cands 已是優先序
          }
          if (bestRank < 0) continue;                 // 沒有更好的書可用
          /* 身上最差的那一格：不在清單裡的視為最差（排在清單長度之後）。 */
          var worstIdx = -1, worstRank = -1;
          for (var wi2 = 0; wi2 < cur.length; wi2++) {
            var wk = cur[wi2] && cur[wi2].key;
            var rk = wk ? cands.indexOf(wk) : -1;
            if (rk < 0) rk = cands.length;
            if (rk > worstRank) { worstRank = rk; worstIdx = wi2; }
          }
          if (worstIdx < 0 || bestRank >= worstRank) continue;   // 沒有比較好就別動
          eQuota--;
          out.push({ name: rmCmd, args: { itemId: eItem.id, index: worstIdx }, ruleId: r.id });
          continue;
        }

        var start = spreadCats[info.cat] ? (memo.enchantCursor[info.cat] || 0) : 0;
        var bookKey = null;
        for (var ci2 = 0; ci2 < cands.length; ci2++) {
          var cand = cands[(start + ci2) % cands.length];
          if (has[cand]) continue;
          if ((Number(eBooks[cand]) || 0) < 1) continue;      // 沒書就別送，遊戲只會回「沒有這本書」
          bookKey = cand;
          if (spreadCats[info.cat]) memo.enchantCursor[info.cat] = (start + ci2 + 1) % cands.length;
          break;
        }
        if (!bookKey) continue;

        eBooks[bookKey] = (Number(eBooks[bookKey]) || 0) - 1;  // 同一決策點內不重複用同一本
        eQuota--;
        out.push({ name: r.cmd, args: { itemId: eItem.id, bookKey: bookKey }, ruleId: r.id });
      }
    } else if (r.stageGate) {
      /* 關卡閘門：裝備品質沒到門檻就關掉自動推關，留在原地掛機把裝備換上來。

         對應 player_strategy.md「前期優先生存任務指南」：那份指南的核心是
         **不要讓關卡跑在裝備前面**——推得太深只會一直死，死了就掉不到裝備，
         掉不到裝備就更推不動。先前策略是無條件每 15 秒送一次「開啟自動推關」，
         等於全程一路往前衝，正是指南要防的那件事。

         ⚠️ 覆蓋率只算「身上真的有裝備」的部位。空部位在面板裡是 -1，
         而雙手武器會讓 weapon2 永遠空著——把空部位算進分母的話覆蓋率
         永遠到不了 100%，閘門就變成永久關閉，模擬整場卡在同一關而且看不出原因。 */
      var gCfg = r.stageGate;
      var gStage = Number(pathVal(state, gCfg.stage)) || 0;
      var gRar = pathVal(state, gCfg.equippedRarities) || {};

      var cp = null;
      var cps = gCfg.checkpoints || [];
      for (var gi = 0; gi < cps.length; gi++) {
        if (cps[gi].maxStage === undefined || gStage <= cps[gi].maxStage) { cp = cps[gi]; break; }
      }
      if (cp) {
        var totalSlots = 0, meetSlots = 0;
        for (var gk in gRar) {
          var gv = Number(gRar[gk]);
          if (!(gv >= 0)) continue;                 // -1＝該部位是空的，不列入分母
          totalSlots++;
          if (gv >= (cp.minRarity || 0)) meetSlots++;
        }
        var need = (cp.coverage === undefined) ? 1 : cp.coverage;
        /* need 為 0 代表這一段沒有要求（指南只涵蓋前期，之後交回各強度的推關策略）。 */
        var passGate = (need <= 0) || (totalSlots > 0 && (meetSlots / totalSlots) >= need);

        /* ---- 門檻要是根本達不成，那就不是門檻，是死鎖 ----

           ⚠️ 這一條救的是一個已經發生過兩次、而且兩次都完全沒有徵兆的事故。

           第一次：閘門要求 41~50 關達到 30% 史詩，但掉落表按怪物等級查，
           Lv20~49 的史詩掉落率是 0。101 小時、85,524 次擲骰，史詩一件都沒掉。
           當時補了一支建置期哨兵擋住它。

           第二次（關卡改造之後）：遊戲把掉落的權威從「怪物等級」換成
           「地圖＋關卡」（js/combat.js 的 fieldDropRatesFor），草原 1~50 關的
           獨特與史詩掉落率都是 0——而哨兵還在讀舊的 FIELD_DROP_TABLE，
           **沒有失敗，是瞎了**。實測 20 小時 × 5 個 seed 全部退回 34 關，
           10,185 件掉落裡獨特 2 件、史詩 0 件，五個 seed 的關卡一模一樣是 50。

           教訓不是「再補一支更嚴的哨兵」——建置期檢查會跟著權威改變而失效。
           要在**執行期**問遊戲：我停下來刷的這一關，這個品質掉不掉得出來？
           掉不出來就放行，不要站在原地等一個不會來的東西。

           這條規則天生會自己收手（掉落率是有界的、看得見的，與目標達成與否無關），
           不會變成「缺口未補滿就永久凍結」那種反過來的死鎖。
           也刻意只在 passGate 為 false 時才問：達標的情況本來就要放行。 */
        if (!passGate && cp.minRarity > 0 && gCfg.dropRates) {
          var gRates = pathVal(state, gCfg.dropRates);
          /* 面板拿不到（舊存檔、面板改名）時什麼都不做——沉默放行比沉默卡死更難查。 */
          if (gRates && gRates.length > cp.minRarity && !(Number(gRates[cp.minRarity]) > 0)) {
            passGate = true;
          }
        }

        /* park：這一段的安全關卡區間（player_strategy.md 的「安全關卡」建議值）。
           品質沒到門檻時就待在區間裡刷——低於下緣要往前推到區間內，
           高於上緣要退回來。只把自動推關關掉是不夠的：關掉時人在哪就停在哪，
           可能停在一個一直死的關卡，而指南要的是停在「穩定不死、殺得快」的那一段。 */
        /* 卡關重試閘門：上一次菁英／BOSS 沒打過，且「時間沒到」或「還沒變強」，
           就不准再往前送死——回安全關卡刷到條件滿足為止（player_strategy.md 卡關定義）。
           這一條蓋過品質門檻：品質達標也不代表打得過那一關。 */
        if (state.ctx && state.ctx.retryWaiting) passGate = false;

        /* 產出閘門：宣告的目標沒達成，這一關就不算安全關卡。

           前面兩道閘門（裝備品質覆蓋率、卡關重試）量的都是**投入**——身上穿了什麼、
           上次死在哪。但 player_strategy.md 對安全關卡的定義量的是**產出**：
           「能在平均 3 秒內殺死一個敵人」。兩者會脫節：實測有一場全身史詩、沒死過、
           重試閘門也沒攔，卻在關卡 150 之後每分鐘殺 0~1 隻，整整 24 個在線小時
           零掉落零經驗——三道閘門一道都沒響，因為沒有一道在量「有沒有打死東西」。

           量產出的另一個好處是它一次涵蓋所有原因。命中不足、傷害不足、抗性不足，
           任何一項出問題都反映在殺敵速度上，不必替每一個原因各補一條規則。 */
        var reqs = gCfg.requireTargets || [];
        var targetBlocked = false;
        for (var rq = 0; rq < reqs.length; rq++) {
          var dq = state.ctx && state.ctx.deficit && state.ctx.deficit[reqs[rq]];
          /* unknown 不算沒達標。視窗還沒攢滿就退關的話，每次退關都會再觸發一次退關。 */
          if (dq && !dq.unknown && !dq.met) { targetBlocked = true; break; }
        }
        if (targetBlocked) passGate = false;

        /* ============ 裝等斷點優先（Dynamic Farming Stage Selector） ============

           ---- 舊行為做錯了什麼 ----

           checkpoints 的 park 是寫死的關卡區間（前期是 [11,15] / [21,25] /
           [41,45] / [51,59]）。實測 20 小時 × 10 個 seed，5 個 seed 在
           park [41,45] 裡來回震盪整整 20 小時，最後全身 13 件都是「R4 史詩、裝等 1」，
           物攻 334。另外 5 個跨過關卡 50 之後物攻衝到 34,983。

           原因是掉落的裝備等級由 equipmentTierLevel 分段（js/formula.js:1251，
           EQUIP_TIER_SIZE = 50）：關卡 1~49 掉裝等 1、50~99 掉裝等 50。
           **park [41,45] 是一個每一件掉落都是裝等 1 的區間**，而裝等 1 的詞條
           只剩 base（實測 atkFlat 12.0 對 335.4，差 27.95 倍）。

           於是形成閉環死鎖：
             裝備永遠裝等 1 → 戰力上不去 → 過不了關卡 50 的守關 BOSS
             → 品質覆蓋率閘門把它退回 [41,45] → 裝備永遠裝等 1

           三道舊閘門一道都沒響，因為沒有一道在量「我停的地方掉得出有用的裝備嗎」。

           ---- 為什麼不用需求規格裡的效率公式 ----

           規格要的是 (每秒擊退怪物數 × 單隻經驗金幣) / (1 + 死亡率 penalty)。
           那個機制本專案**已經實作過、量過、而且回退了**：
           docs/SIM_HARNESS.md「產出閘門」一節記錄 4 個 seed 的 A/B，
           四種門檻全部輸給不設閘門（中位關卡 160.5 → 136~145.5）。
           原因是離線收益吃的是 stage.best 這個單向棘輪，且隨關卡指數成長，
           退關省下的在線時間換不回那筆損失。

           所以這裡改成量**同一件事的另一面**：不是「這關殺得快嗎」，
           而是「我停的這一段掉得出比身上更好的裝備嗎」。它天生不會叫 AI 退關——
           下限永遠是當前裝等分段的底，退到分段以下只會讓掉落更差。

           ---- 三條規則 ----

           1. 身上裝備的裝等已經落後於當前關卡能掉的 → 這裡值得刷，不要往前衝
           2. 身上裝等已經追平當前分段 → 這一段再刷也拿不到更好的，往斷點推
           3. 退關的地板是**當前分段的底**，不是固定區間；分段之內盡量待在深處
              （關卡愈深品質擲骰愈好，而裝等不變——純賺） */
        var park = cp.park;
        var tierCfg = gCfg.tierPush;
        var tier = tierCfg ? pathVal(state, tierCfg.source) : null;
        var tierFloor = null;
        var tierBand = false;      // park 上緣是否已被拉到裝等分段的頂端（見下方 behind）

        /* ---- 往前推之前先確認撐得住 ----

           ⚠️ 這一條是 Codex 獨立驗證抓出來的，而且抓在最要害的地方。

           實測 seed 20260903：ROI 場 20 小時死 **1,137 次**，對照組只有 49 次（23 倍）。
           角色一路被推到分段深處反覆送死，於是撿不到裝備、也跨不過裝等斷點——
           這個機制反而擋掉了它自己要促成的那件事。

           原因是下面那句 `if (!behind && gain >= minGain) passGate = true`：
           在**第一個裝等分段**（關卡 1~49）裡，掉落的裝等恆為 1，身上的裝等自然也是 1，
           所以 `behind` 永遠是 false——tierPush 於是無條件放行整個第一段，
           把角色一路推到分段深處，完全沒有任何一道閘門在問「你打得動嗎」。

           所以 advanceOk 必須同時管住**兩條**前進路徑（放行推關、以及分段內往前走），
           不能只管其中一條。第一版只管了分段內那條，測出來完全沒有效果。

           只擋前進，不強迫後退——後退交給遊戲自己的死亡退關與 park 下緣。
           多加一個退關來源只會讓歸因變難，而這一層的退關機制已經有兩個了。

           unknown（視窗還沒攢滿）當成不准前進：前進是有風險的動作，
           資料不足時按兵不動即可，下一拍就會有值，不會卡死。 */
        var advanceOk = true;
        var areq = tierCfg && tierCfg.advanceRequiresTargets;
        if (areq && areq.length) {
          for (var ai2 = 0; ai2 < areq.length; ai2++) {
            var dq2 = state.ctx && state.ctx.deficit && state.ctx.deficit[areq[ai2]];
            if (!dq2 || dq2.unknown || !dq2.met) { advanceOk = false; break; }
          }
        }

        if (tier && typeof tier.nextBreakpointStage === 'number') {
          /* 當前分段的底：跌破它，掉落的裝等會退一階，那是換不回來的損失。
             itemLevelHere 就是分段起點（裝等 1 的那一段起點視為關卡 1）。 */
          tierFloor = (tier.itemLevelHere > 1) ? tier.itemLevelHere : 1;

          var behind = (tier.equippedItemLevelMin !== null
            && tier.equippedItemLevelMin < tier.itemLevelHere);
          var gain = Number(tier.breakpointGain) || 0;
          var minGain = (typeof tierCfg.minBreakpointGain === 'number') ? tierCfg.minBreakpointGain : 2;

          /* 追平了、而且跨過斷點有明顯收益 → 放行往前推，不受品質覆蓋率門檻約束。

             ⚠️ 這裡蓋掉的是**品質覆蓋率**，不是卡關重試。retryWaiting 在下面
             仍然會把它關回去——真的打不過的時候往前送死沒有意義，
             那時該做的是微調重試（見 Bottleneck Profiler）。 */
          if (!behind && gain >= minGain && advanceOk) passGate = true;

          /* 落後於當前分段：這一段還有東西可以撿，把 park 上緣拉到分段底部之上。
             舊的固定區間 [41,45] 在這裡會被分段底 [tierFloor, 斷點−1] 取代。 */
          if (behind && park && park.length === 2 && park[1] < tier.nextBreakpointStage - 1) {
            park = [Math.max(park[0], tierFloor), tier.nextBreakpointStage - 1];
            tierBand = true;
          }
        }

        var inPark = !!(park && park.length === 2);
        var parkRetreat = (!passGate && inPark && gStage > park[1] && gCfg.retreatCmd);
        if (parkRetreat) {
          out.push({ name: gCfg.retreatCmd, args: { delta: park[1] - gStage }, ruleId: r.id });
        }

        /* ---- 掛機安全關卡：分段之內待在**底部**，不是深處 ----

           ⚠️ 這一段推翻了下方 advanceOn 註解裡的「分段之內往前推是純賺：
           關卡愈深品質擲骰愈好」。那句話在舊制成立（rollRarity 有 stage×0.006
           的連續項），關卡改造之後不成立了：野外掉落改走
           rollFieldDrops → fieldDropRatesFor → ZONE_STAGE_DROP_TABLE 查表
           （js/combat.js:931），粒度是**關卡區間**，區間之內完全相同。

           用遊戲自己的函式量草原 100~149 這一段（evaluator 的 tier.farmFloorStage
           就是這樣搜出來的，兩個階梯函式的等值區間取交集）：

             掉落率   R3 10% / R4 1.5%    100 關與 149 關**完全一樣**
             裝等     100                 一樣
             怪物血量 ×25.79              149 關要多花 25.8 倍時間殺一隻
             經驗     ×21.25              成長比血量慢

           所以停在 149 的裝備／材料／金幣時薪只有停在 100 的 1/25.8，
           連經驗時薪都是 0.82 倍——沒有任何一項是賺的。

           真人的玩法正是這樣：「掛 101、151、201 這種會掉下一級裝備
           且最容易快速殺敵的關卡；材料跟裝備掉落數的權重比等級高，
           等級只是在前者都不缺的情況下盡量能衝就衝高」。

           ---- 掛機點是階梯，不是「能推多深推多深」----

           evaluator 的 farmFloorStage / nextFarmStage 把整張圖切成一串掛機點：
             草原 1 → 21 → 40 → 50 → 100 → 150 → 200
             荒漠 1 → 50 → 200 → 250 → 300
           每一格的掉落與裝等都比前一格好，格子**之內**完全相同。
           所以正確的走法是逐格搬家，而不是在格子裡一路走到打不動。

           舊行為是後者：閘門只問「還推得動嗎」，於是角色停在
           **它能存活的最深處**——那正是同一格裡時薪最低的一關。

           ---- 為什麼往上跳而不是用自動推關走 ----

           stageGo 在 [1, min(best, 地圖上限)] 之內是**直接跳**（js/combat.js:993），
           不必逐關重打。所以搬家到已經到過的關卡是零成本的；
           只有超出 best 的那一段才需要自動推關一關一關清。

           ---- 為什麼需要 pushHoldSec ----

           沒有遲滯會震盪：退到底 → 目標達標 → 往上跳 → 打不動 → 退到底 → ……
           而那趟「打不動」正是要消除的浪費。退回來之後先刷一段時間
           （撿裝備、洗詞條、強化）再試。

           遲滯**必須有界**（計時器會到期），不能寫成「變強了才准再試」——
           docs/SIM_HARNESS.md 記過：任何無界的「條件不滿足就改變行為」
           最後都變成死鎖。

           ---- 範圍 ----

           只在**沒有指南安全區間**的關卡段接管（!inPark）。前期那幾個
           寫死的 park 區間是量過的行為，不動它。實際策略裡那是關卡 60 之後，
           而所有觀察到的浪費也都在那之後。 */
        var fpk = gCfg.farmPark;
        var farmParked = false;
        var farmAuto = null;                 // 非 null 時覆寫自動推關的開關
        /* ⚠️ 自己宣告 source，不共用 tierPush 的。兩個機制的生命週期不同——
           tierPush 的 minBreakpointGain=2 在裝等 50 之後就不再成立
           （100→150 只有 1.496 倍），策略遲早會把 tierPush 拿掉，
           那時 farmPark 不該跟著一起失效。 */
        var fpTier = (fpk && fpk.source) ? pathVal(state, fpk.source) : tier;
        if (fpk && !inPark && !parkRetreat && gCfg.retreatCmd
          && fpTier && typeof fpTier.farmFloorStage === 'number') {
          if (!memo.gate) memo.gate = {};
          var fgm = memo.gate[r.id] || (memo.gate[r.id] = {});
          var holdSec = (typeof fpk.pushHoldSec === 'number') ? fpk.pushHoldSec : 900;
          var holding = (fgm.lastFarmParkAt !== undefined && now - fgm.lastFarmParkAt < holdSec);

          var floorS = fpTier.farmFloorStage;
          var nextS = (typeof fpTier.nextFarmStage === 'number') ? fpTier.nextFarmStage : 0;

          /* 搬去下一格的條件：不在遲滯期、裝等已追平這一格、宣告的目標都達標、
             不在卡關重試。任何一項不成立就待在這一格的底部把它刷滿。
             「裝等落後」就是「這一格還有東西可以撿」——那正是使用者說的
             「材料跟裝備掉落數的權重比等級高」。 */
          var behindTier = (fpTier.equippedItemLevelMin !== null
            && fpTier.equippedItemLevelMin !== undefined
            && fpTier.equippedItemLevelMin < fpTier.itemLevelHere);
          var hop = !holding && !behindTier && advanceOk && !targetBlocked
            && !(state.ctx && state.ctx.retryWaiting) && nextS > gStage;
          var fpTarget = hop ? nextS : floorS;

          if (gStage > fpTarget) {
            /* 退回去是免費的（stageGo 直接跳），所以不設收益門檻——
               停在同一格的深處沒有任何一項指標是賺的。 */
            out.push({ name: gCfg.retreatCmd, args: { delta: fpTarget - gStage }, ruleId: r.id });
            fgm.lastFarmParkAt = now;
            farmParked = true;
          } else if (hop && gStage < fpTarget) {
            /* 往上搬：best 之內直接跳，超出的部分交給自動推關逐關清。
               best 取 tier.best（＝G.stage.best），那正是 stageGo 用來夾值的同一個數。 */
            var fpBest = Number(fpTier.best) || 0;
            var fpJump = Math.min(fpBest, fpTarget);
            if (fpJump > gStage) {
              out.push({ name: gCfg.retreatCmd, args: { delta: fpJump - gStage }, ruleId: r.id });
            }
          }
          farmAuto = gStage < fpTarget;
        }

        /* 動態退關：產出不足而且這一段沒有指南給的安全區間時，自己往回退。

           光把自動推關關掉是不夠的——關掉時人在哪就停在哪，而停下來的地方
           正是那個打不動的關卡。要退回打得動的地方，撿裝備、把命中與傷害拉上來，
           再讓閘門自己重新打開往前推。這是個閉環，不是一次性的判斷。

           ⚠️ everySec 必須 >= 速率目標的 windowSec。退太快的話下一次判斷用的
           還是退關前那個關卡的取樣，會連退好幾階直到視窗換血完畢——
           tests/policy-keys.test.cjs 有哨兵盯著這個關係。

           ⚠️ 沒有「已知安全關卡」這種下限。看起來很自然（不要退到證明過打得動的
           關卡以下），但推關途中視窗會橫跨好幾關，「當時達標」記到的關卡編號
           不見得真的打得動；一旦記錯就成了永遠退不下去的地板，閘門關著、退關被擋，
           整場卡死。改成無條件相信當下的量測：退錯了下一個視窗會把它推回去。 */
        var rtc = gCfg.targetRetreat;
        if (targetBlocked && rtc && gCfg.retreatCmd && !parkRetreat && !farmParked) {
          if (!memo.gate) memo.gate = {};
          var gm = memo.gate[r.id] || (memo.gate[r.id] = {});
          var cool = (typeof rtc.everySec === 'number') ? rtc.everySec : 300;
          var floorStage = Math.max(1, Number(rtc.minStage) || 1);
          /* 動態地板：不得退出當前的裝等分段。

             ⚠️ 這**看起來**就是那個實測失敗的 tierFloors（見下方註解裡的警告：
             24 小時 × 5 seed，關卡中位數 78 → 50，三個 seed 死鎖在關卡 50）。
             差別在於資料來源：舊版的地板是「策略記下來的已知安全關卡」——
             一旦記錯就永遠退不下去。這裡的地板是 equipmentTierLevel 算出來的
             **靜態分段邊界**，與「打不打得動」無關，也不會因為記錯而漂移。
             跌破它一定更差（掉落裝等退一階），所以它只會把退關限制在同一段裡。

             ⚠️⚠️ 但上面那句「不會造成死鎖」是錯的，而且錯得很貴。
             人**正好站在分段底**的時候（gStage === tierFloor），地板等於當前關卡，
             `gStage > floorStage` 恆為 false——退關永遠送不出去。
             分段邊界剛好是 EQUIP_TIER_SIZE 的倍數（50/100/150），而角色推關時
             一定會踩上去，於是那幾關成了吸收態：進得去、出不來。

             實測 sim_ab_forge 8 個 seed：7 個在第 5~18 小時停在關卡 **150 或 100**
             （兩個都是分段邊界），之後 10 小時只殺 56 隻怪。
             關卡 150 的怪物防禦 454,009、血量 14,268,860，而角色物攻 33,797——
             一隻要打 9.5 分鐘。牠們不是打不過，是**打不完**。
             而 stage.go 整場只送了 22 次，因為地板把它擋掉了。

             站在分段底時，這道地板已經沒有東西可以保護：底下那一段本來就更差，
             但「更差的掉落」遠好過「每小時 5.6 隻」。所以只在**分段之內**套用它。 */
          if (tierFloor !== null && tierFloor > floorStage && gStage > tierFloor) floorStage = tierFloor;
          /* ⚠️ 試過在這裡加「不退出當前裝等分段」的地板（tierFloors），實測更差：
             24 小時 × 5 seed，關卡中位數 78 → 50、物攻 4,336 → 716、死亡 11 → 24，
             五個 seed 有三個死鎖在關卡 50。理由就是上面那段註解講的——
             它就是一種「已知安全關卡」下限。動機（掉出分段撿到的裝備弱一個量級）
             是對的，但用地板去擋會直接踩進死鎖。 */
          if (gStage > floorStage && (gm.lastRetreatAt === undefined || now - gm.lastRetreatAt >= cool)) {
            var to = Math.max(floorStage, gStage - Math.max(1, Number(rtc.step) || 5));
            out.push({ name: gCfg.retreatCmd, args: { delta: to - gStage }, ruleId: r.id });
            gm.lastRetreatAt = now;
          }
        }

        var gArgs = {};
        for (var gak in baseArgs) gArgs[gak] = baseArgs[gak];
        /* 一定要是布林值：協議的 on 是 bool，回 undefined 會被 validateCommand 擋下。

           「低於安全區間下緣就往前推」這一條要讓給產出閘門：品質不足時往前推是為了
           進到指南建議的區間，但打不動的時候往前推只會更打不動。 */
        /* ---- 在 park 區間裡要往哪走 ----

           舊語意是「低於下緣才往前推」，也就是進到區間之後就原地不動。
           對寫死的小區間（[11,15]）那沒問題，但 tierBand 把上緣拉到分段頂端
           （例如 [41,99]）之後，原地不動就變成災難：

             實測 seed …076，第 14 小時踏進關卡 51，之後**整整 6 小時停在 51**，
             碎片累積到 157,034 沒有用掉，而對照組同時間已經推到關卡 89。

           分段之內往前推是純賺：裝等不變（同一段），但關卡愈深品質擲骰愈好、
           經驗與金幣也愈多。所以在 tierBand 模式下，目標是推到**上緣**而不是下緣。

           ⚠️ 只在 tierBand 成立時改變語意。寫死的小區間仍照舊——
           那些是「指南建議停在這裡」，不是「這一段隨便你跑」。

           ⚠️⚠️ 上面那句「關卡愈深品質擲骰愈好」在關卡改造之後**已經不成立**
           （掉落改成依關卡區間查表，區間之內完全相同；見上方 farmPark 那段）。
           farmPark 只在 !inPark 的關卡段接管，所以這裡的 tierBand 語意不變——
           兩者的作用範圍是互斥的。 */
        /* ⚠️ park 可以不存在（收尾那一段的 checkpoint 通常沒有），所以取值一定要
           在 inPark 之內。少了這道防護會在「沒有安全區間」的關卡段直接拋錯，
           而那是最常見的一段——tests/sim-policy-targets.test.cjs 抓到過。 */
        /* advanceOk 見上方——它同時管住「放行推關」與「分段內往前走」兩條路徑。
           ⚠️ tierPush 沒設定時 advanceOk 恆為 true，既有策略的行為不變。 */
        /* ⚠️ park 可能是 null（見上方警告），所有取值都要在 inPark 之內做。 */
        var advanceOn = inPark && gStage < (tierBand ? park[1] : park[0]) && !targetBlocked && advanceOk;
        /* farmAuto 非 null＝farmPark 接管了這一段（!inPark 時才會發生）。
           它已經把「該待在哪一格」算完了，自動推關只是「還沒走到就繼續走」。 */
        gArgs[gCfg.argKey || 'on'] = (farmAuto !== null) ? !!farmAuto : !!(passGate || advanceOn);
        out.push({ name: r.cmd, args: gArgs, ruleId: r.id });
      }
    } else if (r.convertToPreferred) {
      /* 把不在當前偏好段的寶石轉成偏好種類（九宮格轉換）。

         為什麼需要：偏好種類只佔 40 種寶石裡的 5~7 種，掉落又是隨機的，
         所以光靠「挑有貨的鑲」永遠補不滿——實測 3 小時後身上偏好種類只有 5/20 顆，
         其餘全是掉到什麼算什麼。轉換在遊戲裡是同階 1:1、數量不變、不花金幣
         （convertGems，js/item.js），所以這是把既有庫存重新分配，不是憑空生資源。

         排在合成之前：轉換讓同一種類的數量集中，合成才有 3 顆可併，
         鑲上去的階級也才會跟著上去。

         ⚠️ maxSlots / maxPerSlot 是遊戲的九宮格上限（GEM_CONVERT_SLOTS /
         GEM_CONVERT_STACK），寫在策略資料裡；超過的話 convertGems 會在動手前
         整批回絕——一格超標就整批白做，而且不會有徵兆。
         tests/policy-keys.test.cjs 有哨兵盯著這兩個值不得超過遊戲的上限。 */
      var cCfg = r.convertToPreferred;
      var cGems = pathVal(state, cCfg.gems) || {};
      var cBand = bandGroups(pickBand(state, cCfg.preferByLevel, cCfg.levelPath), cCfg.preferTypes);

      if (cBand.flat.length) {
        var maxSlots = cCfg.maxSlots || 9;
        var maxPerSlot = cCfg.maxPerSlot || 1000;
        var maxCommands = cCfg.maxCommands || 4;

        /* 配額種類（抗性、法力恢復）不是雜牌。
           不排除的話會變成：這條規則把抗性寶石轉成爆傷，socketEmpty 又永遠補不到配額——
           實測 20 小時後身上一顆抗性寶石都沒有，而策略明明要求各鑲一個。 */
        var keepTypes = {};
        for (var kq = 0; kq < (cCfg.quota || []).length; kq++) {
          var kt = cCfg.quota[kq] && cCfg.quota[kq].type;
          if (kt) keepTypes[kt] = true;
        }

        /* 雜牌＝有貨、不在當前偏好段、也不是配額種類。轉換是同階進行的，
           所以每個 (種類, 階級) 各佔一格。 */
        var junk = [];
        for (var jt in cGems) {
          if (cBand.set[jt] || keepTypes[jt]) continue;
          for (var jl in cGems[jt]) {
            var jn = Number(cGems[jt][jl]) || 0;
            var jlv = Number(jl);
            if (jn > 0 && jlv >= 1) junk.push({ type: jt, lv: jlv, n: Math.min(jn, maxPerSlot) });
          }
        }

        /* 目標在偏好種類之間輪流分配。全部轉成同一種的話，101 段那個
           「一半爆傷、一半六大屬性傷害加成」會被轉成清一色爆傷。 */
        var buckets = {}, order = [];
        for (var ji = 0; ji < junk.length; ji++) {
          var tgt = cBand.flat[ji % cBand.flat.length];
          if (!buckets[tgt]) { buckets[tgt] = []; order.push(tgt); }
          buckets[tgt].push(junk[ji]);
        }

        /* rebalance：把「已經是偏好種類」的其中一種轉成另一群，直到後者佔到指定比例。

           為什麼需要：201 級起的策略是「把一半的爆傷寶石換成元素屬性傷害加成寶石」。
           但元素寶石在 201 之前一直是雜牌、早就被轉光了，到 201 時庫存是零；
           而爆傷與元素寶石那時都算偏好種類，一般的轉換邏輯不會在兩者之間轉，
           於是 mix 分段永遠挑不到元素寶石——規則看起來設好了，實際整段是空轉。

           只轉 minLevel 以上的：低階元素寶石的加成比爆傷還低，換上去會讓傷害不升反降。 */
        for (var rbi = 0; rbi < (cCfg.rebalance || []).length; rbi++) {
          var rb = cCfg.rebalance[rbi];
          if (!rb || !rb.from || !rb.to || !rb.to.length) continue;
          if (rb.when && !testCond(state, rb.when)) continue;
          var minLv = (typeof rb.minLevel === 'number') ? rb.minLevel : 1;

          var fromByLv = [], fromTotal = 0;
          var fl = cGems[rb.from] || {};
          for (var flk in fl) {
            var flv = Number(flk), fn = Number(fl[flk]) || 0;
            if (flv >= minLv && fn > 0) { fromByLv.push({ lv: flv, n: fn }); fromTotal += fn; }
          }
          var toTotal = 0;
          for (var tti = 0; tti < rb.to.length; tti++) {
            var tl = cGems[rb.to[tti]] || {};
            for (var tlk in tl) if (Number(tlk) >= minLv) toTotal += Number(tl[tlk]) || 0;
          }
          var share = (typeof rb.toShare === 'number') ? rb.toShare : 0.5;
          var budget = Math.floor(share * (fromTotal + toTotal)) - toTotal;
          if (budget <= 0) continue;

          fromByLv.sort(function (a, b) { return b.lv - a.lv; });   // 高階先換
          var tIdx = 0;
          for (var fbi = 0; fbi < fromByLv.length && budget > 0; fbi++) {
            var take = Math.min(fromByLv[fbi].n, budget, maxPerSlot);
            if (take <= 0) continue;
            budget -= take;
            out.push({
              name: r.cmd,
              args: { slots: [{ type: rb.from, lv: fromByLv[fbi].lv, n: take }], targetType: rb.to[tIdx % rb.to.length] },
              ruleId: r.id
            });
            tIdx++;
          }
        }

        var emitted = 0;
        for (var oi = 0; oi < order.length && emitted < maxCommands; oi++) {
          var bSlots = buckets[order[oi]];
          for (var off = 0; off < bSlots.length && emitted < maxCommands; off += maxSlots) {
            out.push({
              name: r.cmd,
              args: { slots: bSlots.slice(off, off + maxSlots), targetType: order[oi] },
              ruleId: r.id
            });
            emitted++;
          }
        }
      }
    } else if (r.unsocketOffPriority) {
      /* 把不符合當前偏好段、或階級低於庫存最高階的寶石拆下來，讓 socket-gems 重鑲。

         為什麼非要有這條：socketEmpty 只填**空槽**，而前期偏好種類根本還沒掉到，
         退而求其次鑲上的雜牌寶石就會把插槽佔死——實測 3 小時後 12 個插槽全是
         貓眼石／堇青石／藍晶石這類，偏好種類 0 顆。等級跨到 51 偏好序整組換掉時，
         身上也不會有任何變化。沒有這條規則，分段偏好序等於裝飾。

         拆寶石在遊戲裡是**免費且無損**的（unsocketGem 直接 addGem 退回庫存，
         js/item.js），所以這是純粹的重新配置，不消耗任何資源。

         ⚠️ 拆與補**必須在同一個決策點成對送出**（replaceWith 指定補的指令）。
         只拆不補的話，空出來的槽會在下一個決策點被 socket-gems 的「沒有偏好種類
         就鑲任何有貨的」退路重新塞回雜牌——實測那樣做 3 小時後偏好種類只有 3/17 顆，
         而且每分鐘都在拆了又鑲。指令是循序派送的，unsocket 先執行，
         接著的 socket 就找得到那個剛空出來的槽。

         兩個安全閥：
         - 補不到**偏好**種類就完全不動（這一條不吃「任何有貨的」退路）。
           拿雜牌換雜牌只是白做工，插槽空著更糟。
         - maxPerDecision 限制單次換的數量，避免一口氣把全身拆光。 */
      var uoCfg = r.unsocketOffPriority;
      var uoEquip = pathVal(state, uoCfg.equipment) || {};
      var uoStock = gemStock(pathVal(state, uoCfg.gems) || {}, uoCfg.minLevelByType);

      /* 偏好種類與 socketEmpty 取自同一份設定，維持單一來源——
         兩邊各寫一份的話，改了其中一份就會變成「拆掉的正是剛鑲上的」無限來回。 */
      var uBand = bandGroups(pickBand(state, uoCfg.preferByLevel, uoCfg.levelPath), uoCfg.preferTypes);
      /* 配額種類（抗性、法力恢復）也算「符合偏好」，否則這裡會把 socketEmpty
         剛依配額鑲上的抗性寶石當成雜牌拆掉，兩條規則每分鐘互相拆台。 */
      for (var uq = 0; uq < (uoCfg.quota || []).length; uq++) {
        var qt = uoCfg.quota[uq] && uoCfg.quota[uq].type;
        if (qt && !uBand.set[qt]) { uBand.set[qt] = true; uBand.flat.push(qt); }
      }
      var uTurn = 0, uCursor = [];
      for (var uc = 0; uc < uBand.groups.length; uc++) uCursor.push(0);

      var swapCmd = uoCfg.replaceWith;
      var quota = (typeof uoCfg.maxPerDecision === 'number') ? uoCfg.maxPerDecision : 2;

      for (var uk in uoEquip) {
        if (quota <= 0) break;
        var uItem = uoEquip[uk];
        if (!uItem || !uItem.id || !uItem.sockets) continue;
        for (var ui = 0; ui < uItem.sockets.length && quota > 0; ui++) {
          var sg = uItem.sockets[ui];
          if (!sg || sg.fused || !sg.type) continue;          // 空槽與融合寶石不動

          var offPriority = uBand.flat.length > 0 && !uBand.set[sg.type];
          /* socketGem 鑲的是庫存最高階那顆，所以「身上這顆比庫存最高階低」
             就代表重鑲會拿到更好的。這個條件會自然收斂：換上最高階之後就不再成立。 */
          var lowerThanStock = (uoStock.maxLvOf[sg.type] || 0) > (sg.level || 0);
          if (!offPriority && !lowerThanStock) continue;      // 符合偏好又已是最高階：不動

          /* 補什麼：階級升級的情況補回同一種（才拿得到高階那顆）；
             換掉雜牌的情況照偏好序挑，且不吃「任何有貨的」退路。 */
          var repl = null;
          if (!offPriority) {
            repl = sg.type;
          } else {
            repl = pickGemType(uBand.groups, uTurn, uCursor, uBand.spread, uoStock.stockOf, uoStock.available, false);
            if (repl) uTurn = (uTurn + 1) % uBand.groups.length;
          }
          if (!repl) continue;                                // 補不到偏好種類就不拆

          quota--;
          out.push({ name: r.cmd, args: { itemId: uItem.id, index: ui }, ruleId: r.id });
          if (swapCmd) {
            uoStock.stockOf[repl] = (uoStock.stockOf[repl] || 0) - 1;
            out.push({ name: swapCmd, args: { itemId: uItem.id, type: repl }, ruleId: r.id });
          }
        }
      }
    } else if (r.loadoutSwap) {
      /* 技能欄滿了的時候，把優先序最差的那個卸下來，讓好的擠進去。

         為什麼需要：技能欄格數 = min(20, max(4, 4 + 等級/50))（js/formula.js loadoutSize），
         50 級才多一格，而開局就預設塞了 powerSlash／arcaneBurst／manaBarrier 三個。
         arcaneBurst 是 Lv.1 的魔法技，在物理流裡永遠是廢的，但沒有卸下的動作它就
         佔著格子到天荒地老——實測 100 小時後技能欄仍是那三個開局技能。

         只送卸下、不送裝上：裝上交給 equip-loadout（下一個決策點就會補），
         這樣「補什麼」只有一份邏輯。與 unsocket-off-priority 只拆不補是同一個取捨，
         差別在那邊補不到就不拆，這邊卸下是無損的（技能等級保留，隨時可再裝）。

         收斂條件：只有當「場外存在排序更前面、且已學會的技能」時才卸。
         全部裝的都已經是最優的 N 個時條件不成立，不會每分鐘拆了又裝。 */
      var lsCfg = r.loadoutSwap;
      var lsOrder = (policy.lists && policy.lists[lsCfg.priority]) || [];
      var lsPanel = pathVal(state, lsCfg.skills) || {};
      var lsLoadout = lsPanel.loadout || [];
      var lsSize = Number(lsPanel.loadoutSize) || 0;
      var lsLearned = lsPanel.skills || {};

      if (lsOrder.length && lsSize > 0 && lsLoadout.length >= lsSize) {
        var rankOf = {};
        for (var lo = 0; lo < lsOrder.length; lo++) rankOf[lsOrder[lo]] = lo;
        var WORST = lsOrder.length + 1;          // 不在優先序裡的一律排最後

        /* protect：由別條規則管理的格子，這裡一律不碰。

           ⚠️ 這不是防禦性程式。優先序裡沒有的 id 一律被排成 WORST，而 BOSS 戰
           換上去的保命技（regenerate / manaBarrier）本來就不在刷圖的優先序裡——
           不保護的話，boss-loadout 換上去、下一個決策點就被這條當成「最差的」拆掉，
           兩條規則會在整場 BOSS 戰裡互相拆台，而報表上只看得到指令數變多。 */
        var lsProtect = {};
        var lsProtectList = lsCfg.protect || [];
        for (var lp2 = 0; lp2 < lsProtectList.length; lp2++) lsProtect[lsProtectList[lp2]] = true;

        /* 場上最差的那個 */
        var worstId = null, worstRank = -1;
        for (var li = 0; li < lsLoadout.length; li++) {
          var lid = lsLoadout[li];
          if (lsProtect[lid]) continue;
          var lrank = (rankOf[lid] === undefined) ? WORST : rankOf[lid];
          if (lrank > worstRank) { worstRank = lrank; worstId = lid; }
        }

        /* 場外有沒有更好的、而且真的學會了的 */
        var equipped = {};
        for (var le = 0; le < lsLoadout.length; le++) equipped[lsLoadout[le]] = true;
        var better = false;
        for (var lb = 0; lb < lsOrder.length && lb < worstRank; lb++) {
          var cand = lsOrder[lb];
          if (equipped[cand]) continue;
          if (!(Number(lsLearned[cand]) > 0)) continue;   // 沒學會的裝不上，不能拿它當理由卸
          better = true;
          break;
        }

        if (better && worstId) {
          out.push({ name: r.cmd, args: { id: worstId }, ruleId: r.id });
        }
      }
    } else if (r.learnPlan) {
      /* ---- 技能點的投法：主動只學裝載欄放得下的，其餘全投被動 ----

         為什麼需要這條：js/skills.js 的 pickAndCastSkill **只走 G.player.loadout**，
         沒裝載的主動技一次都不會被施放。而技能點是 1 級 1 點
         （skills.js 的 spentSkillPoints 直接加總各技能等級），所以學了不裝＝死點。

         舊做法是一份寫死的清單（前期 16 個／中期 27 個／後期 39 個），但裝載欄是
         loadoutSize() = clamp(4 + ⌊等級/50⌋, 4, 20)、1 轉後 20——**清單長度與格數
         是兩套獨立的數字**。實測一場 Lv.152 的存檔：152 點裡有 37 點（24%）壓在
         強力斬 10／魔法屏障 10／二連拳 10／再生術 6／奧術衝擊 1 這些沒裝載的主動上。

         而且前期清單的第 2~5 名正是 powerSlash／doubleStrike／manaBarrier／regenerate：
         那時候只有 4~5 格，裝得下；Lv.50 之後被更好的擠掉，點數留在原地。
         「清單順序即投點優先序」在格數固定時沒問題，格數會長就會失真。

         名額一律由**遊戲**給（panels.skills.loadoutSize），不在策略裡寫死。

         送出順序＝投點優先序（點數不足時後面的由遊戲擋下）：
           1. 主動：優先序清單的前 loadoutSize 個
           2. always：不常駐裝載欄、但一定要學的（例如 BOSS 戰才換上的保命技）
           3. 被動：被動不佔裝載欄，學會就常駐，剩下的點全投這裡 */
      var lpCfg = r.learnPlan;
      var lpPanel = pathVal(state, lpCfg.skills) || {};
      var lpSize = Number(lpPanel.loadoutSize) || 0;
      var lpLearned = lpPanel.skills || {};
      var lpUnlockLv = lpPanel.unlockLv || {};
      var lpLevel = Number(pathVal(state, lpCfg.level)) || 0;
      var lpActives = (policy.lists && policy.lists[lpCfg.actives]) || [];
      var lpPassives = (policy.lists && policy.lists[lpCfg.passives]) || [];
      var lpAlways = lpCfg.always || [];

      if (lpSize > 0) {
        var lpSeen = {};
        /* 已滿級的不再送。上限由遊戲給（panels.skills.maxLv，隨轉生數提高），
           不寫死 10——寫死的話轉生後就會停在 10 級而且沒有任何徵兆。 */
        var lpMax = Number(lpPanel.maxLv) || 0;
        var lpPush = function (id) {
          if (!id || lpSeen[id]) return;
          lpSeen[id] = true;
          if (lpMax > 0 && Number(lpLearned[id]) >= lpMax) return;
          out.push({ name: r.cmd, args: { id: id }, ruleId: r.id });
        };
        /* 名額只能給「現在真的學得起來」的：優先序前面若是還沒解鎖的高等技能，
           照位置硬切會讓那幾格永久空著（送出去只會得到「需人物達到 Lv.N 才解鎖」）。
           已經學會的一律算數——它已經佔著格子了。 */
        var lpTaken = 0;
        for (var lpi = 0; lpi < lpActives.length && lpTaken < lpSize; lpi++) {
          var lpId = lpActives[lpi];
          var lpNeed = Number(lpUnlockLv[lpId]) || 0;
          if (!(Number(lpLearned[lpId]) > 0) && lpNeed > lpLevel) continue;
          lpPush(lpId);
          lpTaken++;
        }
        for (var lpa = 0; lpa < lpAlways.length; lpa++) lpPush(lpAlways[lpa]);
        for (var lpp = 0; lpp < lpPassives.length; lpp++) lpPush(lpPassives[lpp]);
      }
    } else if (r.combatLoadout) {
      /* ---- 依戰況換裝載欄：打菁英／BOSS 時換上保命技 ----

         BOSS 戰是一場十分鐘的消耗戰，而刷圖是幾秒一隻——兩者要的技能組不一樣。
         遊戲這邊完全支援：unequipSkillFromLoadout 無條件、無成本、**技能等級保留**，
         而且冷卻是掛在角色實體上（pEnt.skillCds 以技能 id 為鍵），換上換下不會重置。

         判斷來源是遊戲給的怪物旗標（monster.elite / monster.isBoss），不是策略自己
         推算關卡——推算會在改版時靜靜失準。

         ⚠️ 收斂條件：只有當「現在的裝載欄與目標不一致」時才送指令。少了這一條，
         每個決策點都會重送一次卸下＋裝上，指令統計被灌爆而且看不出來有沒有真的切換。

         ⚠️ 卸下要排在裝上前面：裝載欄是滿的，先送裝上只會得到「裝載欄已滿」。
         同一個決策點內指令是照順序送的，所以一拍就換完。 */
      var clCfg = r.combatLoadout;
      var clPanel = pathVal(state, clCfg.skills) || {};
      var clLoadout = clPanel.loadout || [];
      var clLearned = clPanel.skills || {};
      var clIn = [], clOut = [];

      /* ---- 由危險程度分級決定要帶幾個保命技 ----

         不是「打什麼怪」而是「有沒有在危險」——見 evalDanger 的說明。
         階梯是累積的：等級 1 上第一階，等級 2 連第二階一起上。
         等級 0 全部退場，兩個產出技回到場上。 */
      var clLevel = Number(pathVal(state, clCfg.danger));
      if (!isFinite(clLevel)) clLevel = 0;
      var clHas = {};
      for (var cl = 0; cl < clLoadout.length; cl++) clHas[clLoadout[cl]] = true;

      /* 擠掉產出技是**代價**，不是換裝的必要步驟：裝載欄還有空格時，保命技直接
         裝進空格就好。少了這個判斷會有一格永遠空著——實測 Lv.138（格數
         clamp(4+⌊138/50⌋,4,20)=6）只裝了 5 個，尋寶直覺 Lv.10/10 學好了坐在板凳上，
         而空的那一格既沒有輸出也沒有保命。
         這也是卸下／裝上 3.2 倍不對稱的來源：equip-loadout 每分鐘把尋寶直覺補回空格，
         danger-loadout 每 5 秒又把它拆掉，兩條規則整場互相拆台。
         loadoutSize 由遊戲的面板給；拿不到（0）時退回舊行為「一律擠掉」，寧可保守。 */
      var clSize = Number(clPanel.loadoutSize) || 0;
      var clSacrifice = [];

      var clTiers = clCfg.tiers || [];
      for (var ct = 0; ct < clTiers.length; ct++) {
        var tier = clTiers[ct];
        var need = (typeof tier.atLeast === 'number') ? tier.atLeast : 1;
        var wantThis = clLevel >= need;
        var tIn = tier.swapIn || [], tOut = tier.swapOut || [];

        if (wantThis) {
          /* ⚠️ 保命技還沒學會就**整階不動**。
             少了這道檢查會變成「卸下產出技、卻裝不上保命技」——兩格白白空著，
             既沒有輸出也沒有保命。實測 20 遊戲小時卸下 1,272 次、裝上只有 381 次，
             差的那 891 次就是這個。
             （已經在場上的算數：那代表上一拍已經換好了。） */
          var usable = true;
          for (var tu = 0; tu < tIn.length; tu++) {
            if (!clHas[tIn[tu]] && !(Number(clLearned[tIn[tu]]) > 0)) { usable = false; break; }
          }
          if (!usable) continue;
          for (var ti = 0; ti < tIn.length; ti++) clIn.push(tIn[ti]);
          /* swapOut 進的是**候選**池不是卸下清單——真的裝不下才動它。
             池子跨階共用且照宣告順序犧牲：只差一格時要先丟尋寶直覺，
             逐階各自結算的話第一階會用掉空格、第二階反而去擠點金手。 */
          for (var to = 0; to < tOut.length; to++) clSacrifice.push(tOut[to]);
        } else {
          /* 退場方向不必檢查：把保命技拿下來永遠是安全的，
             補回產出技若還沒學會，下面的 clAdd 會自己擋掉，空格也有 equip-loadout 會填。 */
          for (var ti2 = 0; ti2 < tIn.length; ti2++) clOut.push(tIn[ti2]);
          for (var to2 = 0; to2 < tOut.length; to2++) clIn.push(tOut[to2]);
        }
      }

      /* 算出這一拍之後裝載欄會佔掉幾格，超過才從候選池裡挑人犧牲。 */
      var clSeen = {}, clFill = clLoadout.length;
      for (var cf = 0; cf < clOut.length; cf++) {
        if (clHas[clOut[cf]] && !clSeen[clOut[cf]]) { clSeen[clOut[cf]] = true; clFill--; }
      }
      for (var cg = 0; cg < clIn.length; cg++) {
        if (!clHas[clIn[cg]] && !clSeen[clIn[cg]] && Number(clLearned[clIn[cg]]) > 0) {
          clSeen[clIn[cg]] = true; clFill++;
        }
      }
      for (var cs = 0; cs < clSacrifice.length; cs++) {
        if (clSize > 0 && clFill <= clSize) break;      // 裝得下就別動產出技
        var clVictim = clSacrifice[cs];
        if (!clHas[clVictim] || clSeen[clVictim]) continue;
        clOut.push(clVictim);
        clSeen[clVictim] = true;
        clFill--;
      }

      /* 要裝上的一律限於「已經學會」的——沒學會的送出去只會被遊戲回「尚未學習」，
         而且會讓我們誤以為已經切換過去了，於是永遠不再送卸下。 */
      var clAdd = [], clRemove = [];
      for (var ci = 0; ci < clIn.length; ci++) {
        if (!clHas[clIn[ci]] && Number(clLearned[clIn[ci]]) > 0) clAdd.push(clIn[ci]);
      }
      for (var co = 0; co < clOut.length; co++) if (clHas[clOut[co]]) clRemove.push(clOut[co]);

      /* 只在真的要動的時候才動。兩邊都空＝已經是目標狀態。 */
      if (clRemove.length || clAdd.length) {
        for (var cr = 0; cr < clRemove.length; cr++) {
          out.push({ name: clCfg.unequipCmd || 'skill.unequipLoadout', args: { id: clRemove[cr] }, ruleId: r.id });
        }
        for (var ca = 0; ca < clAdd.length; ca++) {
          out.push({ name: r.cmd, args: { id: clAdd[ca] }, ruleId: r.id });
        }
      }
    } else if (r.deleteUnusedSkills) {
      /* ---- 回收：學了、但永遠不會被施放的主動技，把點數退回來 ----

         js/skills.js 的 deleteSkill 是**全額退還**（「已全額退還 N 技能點」），
         所以早期學錯的不必認賠——前期只有 4~5 格時裝得下的技能，
         Lv.50 之後被更好的擠掉，那些點現在可以拿回來重投被動。

         ⚠️ 三道保護，少一道就會刪到不該刪的：
           1. 現在裝載欄裡的一律不刪（包含 BOSS 戰暫時換上去的）。
           2. 任何宣告過的清單裡的一律不刪——BOSS 組平時就是「學了沒裝」的狀態，
              不保護的話它每五分鐘被刪一次、再被 learnPlan 學回來，無限迴圈。
           3. 融合技的材料一律不刪。deleteSkill **不檢查融合佔用**
              （equipSkillToLoadout 才檢查），刪掉材料會把融合技一起弄壞。
         被動也一律不刪：它們不佔裝載欄，學會就一直有效。 */
      var duCfg = r.deleteUnusedSkills;
      var duPanel = pathVal(state, duCfg.skills) || {};
      var duLearned = duPanel.skills || {};
      var duLoadout = duPanel.loadout || [];
      var duSize = Number(duPanel.loadoutSize) || 0;
      var duFusions = duPanel.fusions || [];

      if (duSize > 0) {
        var duKeep = {};
        for (var dk = 0; dk < duLoadout.length; dk++) duKeep[duLoadout[dk]] = true;
        var duActives = (policy.lists && policy.lists[duCfg.actives]) || [];
        for (var da = 0; da < duActives.length && da < duSize; da++) duKeep[duActives[da]] = true;
        var duPassives = (policy.lists && policy.lists[duCfg.passives]) || [];
        for (var dp = 0; dp < duPassives.length; dp++) duKeep[duPassives[dp]] = true;
        var duAlways = duCfg.always || [];
        for (var dal = 0; dal < duAlways.length; dal++) duKeep[duAlways[dal]] = true;
        /* 融合技本身與它的材料都要保住 */
        for (var df = 0; df < duFusions.length; df++) {
          var fu = duFusions[df];
          if (!fu) continue;
          if (fu.id) duKeep[fu.id] = true;
          var comps = fu.components || [];
          for (var dc = 0; dc < comps.length; dc++) {
            duKeep[typeof comps[dc] === 'string' ? comps[dc] : (comps[dc] && comps[dc].id)] = true;
          }
        }

        var duMax = (typeof duCfg.maxPerRun === 'number') ? duCfg.maxPerRun : 3;
        var duSent = 0;
        for (var dId in duLearned) {
          if (duSent >= duMax) break;
          if (duKeep[dId]) continue;
          if (!(Number(duLearned[dId]) > 0)) continue;
          /* 被動不刪：它們不佔裝載欄，學會就常駐。策略層看不到 cat，
             所以靠「被動清單」宣告——不在清單裡的被動本來也不該被學。 */
          out.push({ name: r.cmd, args: { id: dId }, ruleId: r.id });
          duSent++;
        }
      }
    } else if (r.rerollOffTarget) {
      /* 把身上裝備「不在目標清單裡」的詞條洗掉。

         player_strategy.md 的詞條策略是「以攻擊為主、防禦為輔」，但先前只有戒指與項鍊
         各一條洗煉規則，其餘 11 個部位從來沒洗過——實測身上滿是 defPct／evasion／
         mdefFlat／resFire 這類詞條，攻擊詞條沒幾個。

         目標清單是策略資料（targetAffixes）。⚠️ 清單裡的鍵必須真的存在於遊戲的
         AFFIX_POOL：先前寫了 patk／crit／xpGain／dropRate 四個不存在的鍵，
         送出去只會被遊戲回錯，而且不會有人發現。正確鍵名見 js/data.js 的 AFFIX_POOL。

         洗到什麼由遊戲擲骰決定，策略只負責指出「這條不是我要的」。 */
      var rCfg = r.rerollOffTarget;
      var rEquip = pathVal(state, rCfg.equipment) || {};
      var minRarity = (typeof rCfg.minRarity === 'number') ? rCfg.minRarity : 0;

      /* 目標清單依部位分組（player_strategy.md 裝備詞條洗煉策略）：
         主副手全洗傷害、防具以防禦為主、項鏈戒指以寶石鑲嵌效率／掉寶／經驗為關鍵。
         用同一份清單套 13 個部位是不可能對的——武器根本洗不出防禦詞條，
         而項鏈戒指專屬的 gemEff／loot／xpBonus 放進武器清單也永遠不會出現。

         每組可掛多份清單，各自帶 when 條件（例如爆傷要爆率破 50% 才留）。
         沒有 slots 的組是收尾組，套用在其餘所有部位。 */
      var groupCache = {};
      function wantedFor(slotKey) {
        if (groupCache[slotKey]) return groupCache[slotKey];
        var groups = rCfg.targetGroups;
        var set = {};
        /* 所有宣告過的目標詞條一律視為保留，不管它在不在哪份清單裡。

           ⚠️ 不這樣做，兩條規則會互相打架：rerollForDeficit 好不容易在武器上洗出
           命中率，rerollOffTarget 下一輪就把它洗掉——因為 affixWeapon 這份清單裡
           沒有 hit。實測就是這樣：身上 65 條詞條，命中率 0 條。
           保留集從目標宣告自動長出來，就不會有人忘記同步。 */
        var tg = policy.targets || [];
        for (var tgi = 0; tgi < tg.length; tgi++) {
          if (tg[tgi] && tg[tgi].affixKey) set[tg[tgi].affixKey] = true;
        }
        if (!groups) {
          var single = (policy.lists && policy.lists[rCfg.targetList]) || [];
          for (var si2 = 0; si2 < single.length; si2++) set[single[si2]] = true;
        } else {
          for (var gi2 = 0; gi2 < groups.length; gi2++) {
            var g = groups[gi2];
            if (g.slots && g.slots.indexOf(slotKey) < 0) continue;
            for (var li2 = 0; li2 < (g.lists || []).length; li2++) {
              var entry = g.lists[li2];
              if (entry.when && !testCond(state, entry.when)) continue;
              var lst = (policy.lists && policy.lists[entry.list]) || [];
              for (var ki2 = 0; ki2 < lst.length; ki2++) set[lst[ki2]] = true;
            }
            break;                                   // 第一個對上的組說了算
          }
        }
        groupCache[slotKey] = set;
        return set;
      }

      for (var rsk in rEquip) {
        var rItem = rEquip[rsk];
        if (!rItem || !rItem.id || !rItem.affixes) continue;
        if ((rItem.rarity || 0) < minRarity) continue;      // 低品質不值得花精華
        var wanted = wantedFor(rsk);
        for (var ai = 0; ai < rItem.affixes.length; ai++) {
          var af = rItem.affixes[ai];
          if (!af || !af.key || wanted[af.key]) continue;
          if (af.ancient && rCfg.keepAncient !== false) continue;   // 太古詞條預設不動
          out.push({ name: r.cmd, args: { itemId: rItem.id, affixKey: af.key }, ruleId: r.id });
        }
      }
    } else if (r.rerollForDeficit) {
      /* ============ 缺口驅動的洗煉 ============

         rerollOffTarget 是「把不要的洗掉」，它只能被動等遊戲擲出保留清單裡的任一項。
         保留清單有 19 項時，隨便中一項就停手——所以它**永遠不會刻意去取得某一條詞條**。
         這就是命中率一條都沒有的原因：hit 在清單裡（會被保留），但機率只有 1/19，
         而且武器清單裡根本沒有它，洗到還會被洗掉。

         這條規則反過來：目標沒達成時，指定一個部位持續洗，直到那條詞條出現為止。
         等於真人說的「我拿一兩個詞條格去換命中率」——player_strategy.md 寫的
         「超過40級裝備開始可至少搭配1~2條命中率詞條」就是這件事。

         缺口補滿之後規則自動停手，不需要有人回來改清單。 */
      var dCfg = r.rerollForDeficit;
      var dEquip = pathVal(state, dCfg.equipment) || {};
      if (!memo.deficitTries) memo.deficitTries = {};
      var targets = policy.targets || [];

      /* ⚠️ 同一個決策點裡，一件裝備只能被洗一次。

         沒有這道協調時，多個目標會**擠在同一件裝備上**，而且各自挑到同一條犧牲品
         （犧牲品的定義是「第一條不是目標、也不是太古的詞條」，對同一件裝備必然相同）。
         第一條指令洗掉它之後，後面每一條都會被遊戲回「找不到指定的屬性」。

         實測（6 遊戲小時、seed 20260908）：
           reroll-for-deficit 送出 61 次、成功 30 次，**31 次（51%）是這個原因**。
           memo.deficitTries 更直接：jewelXpBonus 28 次有效洗煉全部落在 ring，
           jewelLoot 27 次也全部落在 ring，jewelGemEff 一次都沒被服務到——
           三個目標搶同一件戒指，而 ring2 與項鍊整場沒被碰過。

         而 xpBonus／loot／gemEff 這三條詞條**同一件裝備各只能有一條**
         （AFFIX_POOL 的 slots 是 ring/amulet，minR 4），所以「三個目標擠一件」
         在結構上永遠湊不滿——實測 8 個 seed 的 xpBonus 全部是 0 條。

         改成一件裝備一拍只服務一個目標，三個目標自然散到 ring／ring2／項鍊上。 */
      var deficitUsed = {};

      for (var ti = 0; ti < targets.length; ti++) {
        var tg2 = targets[ti];
        if (!tg2 || !tg2.affixKey) continue;
        var d = state.ctx && state.ctx.deficit && state.ctx.deficit[tg2.id];
        if (!d || d.unknown || d.met) continue;               // 沒缺口就不動

        /* ---- 可洗的部位由遊戲決定，不由策略宣告 ----

           每種詞條只會出現在特定部位（AFFIX_POOL 的 slots），這是遊戲規則。
           策略手寫一份就是抄第二份，抄錯不會有徵兆——實測寫了 weapon（命中率根本
           不能出現在武器上）與 bracers（遊戲的鍵是 wrist），375 次洗煉一條都沒出來。

           改成從 panels.equip.affixRules 讀。策略只宣告「我要哪一條詞條」，
           「它能長在哪裡」是遊戲的事。日後加新目標也不必再查一次部位表。 */
        var rules = pathVal(state, dCfg.affixRules || 'panels.equip.affixRules') || {};
        var allowRule = rules[tg2.affixKey];
        var allowSlots = allowRule && allowRule.slots ? allowRule.slots : null;

        /* 候選部位＝身上所有部位，交集遊戲允許的那些。
           策略仍可用 slots 進一步縮小範圍，但不能擴大——擴大只會洗到洗不出來的地方。

           ---- 犧牲哪一格是策略決定，不是隨便挑 ----

           同一條詞條通常有好幾個部位可以洗出來（命中率有 7 個），而那些部位的詞條格
           價值差很多。player_strategy.md：「項鏈戒指是裝備中的關鍵，其中最關鍵的為
           寶石鑲嵌率，其次為掉寶率與經驗加成」——把首飾的一格拿去換命中率，
           等於用最貴的格子付帳。

           avoidSlots 是硬排除，preferSlots 是排序偏好（沒列到的排在後面）。
           兩者都用遊戲的部位鍵（AFFIX_POOL 的 slots 用的那一套），不是裝備欄位鍵，
           免得又出現 bracers/wrist 這種對不上的抄寫錯誤。 */
        var avoid = tg2.avoidSlots || [];
        var prefer = tg2.preferSlots || [];
        var slots = [];
        for (var sk3 in dEquip) {
          var itC = dEquip[sk3];
          if (!itC || !itC.slot) continue;
          if (allowSlots && allowSlots.indexOf(itC.slot) < 0) continue;
          if (avoid.indexOf(itC.slot) >= 0) continue;
          if (tg2.slots && tg2.slots.indexOf(sk3) < 0 && tg2.slots.indexOf(itC.slot) < 0) continue;
          if (allowRule && allowRule.minR !== null && (itC.rarity || 0) < allowRule.minR) continue;
          slots.push(sk3);
        }
        /* 依偏好排序。沒列到的一律排在列到的後面；同組之間用部位鍵排序，
           確保決定論——object 的鍵順序不該影響結果。 */
        slots.sort(function (x, y) {
          var px = prefer.indexOf(dEquip[x].slot); if (px < 0) px = prefer.length;
          var py = prefer.indexOf(dEquip[y].slot); if (py < 0) py = prefer.length;
          if (px !== py) return px - py;
          return x < y ? -1 : (x > y ? 1 : 0);
        });
        /* 要湊到幾條。affixCount 目標的 atLeast 本身就是數量下限，不必再寫一次
           maxAffixes——寫兩次遲早對不上，而對不上的症狀是「洗到一半就停」。 */
        var want = (typeof tg2.maxAffixes === 'number') ? tg2.maxAffixes
          : (tg2.kind === 'affixCount' ? (Number(tg2.atLeast) || 1) : 1);
        /* 先數身上已經有幾條。夠了就不再洗——這是「拿一兩個詞條格去換」的上限，
           不是「全身都洗成這個」。 */
        var have = 0;
        for (var s1 = 0; s1 < slots.length; s1++) {
          var itA = dEquip[slots[s1]];
          if (!itA || !itA.affixes) continue;
          for (var a1 = 0; a1 < itA.affixes.length; a1++) {
            if (itA.affixes[a1] && itA.affixes[a1].key === tg2.affixKey) have++;
          }
        }
        if (have >= want) continue;

        /* 挑一個還沒有這條詞條的部位來洗。同一個部位試太多次仍洗不出來，就跳過它——
           有些詞條在某些部位的詞條池裡根本不存在，硬洗只會無限燒精華，而且沒有徵兆。
           放棄次數記在 memo 並由 report 回報，不靜靜放棄。 */
        var maxTries = (typeof tg2.maxTriesPerSlot === 'number') ? tg2.maxTriesPerSlot : 40;
        for (var s2 = 0; s2 < slots.length; s2++) {
          var slotKey2 = slots[s2];
          var itB = dEquip[slotKey2];
          if (!itB || !itB.id || !itB.affixes || !itB.affixes.length) continue;
          if ((itB.rarity || 0) < (dCfg.minRarity || 0)) continue;
          if (deficitUsed[itB.id]) continue;                  // 這一拍已經有別的目標在洗它了

          var hasIt = false;
          for (var a2 = 0; a2 < itB.affixes.length; a2++) {
            if (itB.affixes[a2] && itB.affixes[a2].key === tg2.affixKey) { hasIt = true; break; }
          }
          if (hasIt) continue;

          /* 試次以「目標 + 部位 + 這件裝備」為鍵。換了裝備就重新算——
             新裝備的詞條池可能不一樣，拿舊裝備的失敗次數判它死刑是錯的。

             ⚠️ 只有「真的洗到了」才算一次。策略層看不到指令結果，但看得到詞條有沒有變：
             送出去的洗煉若因為精華不足被遊戲擋下，這件裝備的詞條組合不會變。
             不這樣分辨的話，資源不足的空轉會把試次燒光，然後永久放棄這個部位——
             實測 832 次嘗試有 579 次（70%）是資源不足，於是所有部位都在沒洗到半次的
             情況下被判死刑，整條規則等於沒作用。 */
          var sig = [];
          for (var a4 = 0; a4 < itB.affixes.length; a4++) {
            sig.push((itB.affixes[a4] && itB.affixes[a4].key) || '?');
          }
          sig = sig.join(',');

          var tryKey = tg2.id + '|' + slotKey2 + '|' + itB.id;
          var rec2 = memo.deficitTries[tryKey];
          if (!rec2) rec2 = memo.deficitTries[tryKey] = { n: 0, sig: sig };
          else if (rec2.sig !== sig) { rec2.n++; rec2.sig = sig; }   // 詞條變了＝上一次真的洗了
          if (rec2.n >= maxTries) continue;

          /* 洗掉這件上面第一條「不是目標、也不是太古」的詞條。
             選第一條而不是挑最沒用的：策略層沒有評價詞條好壞的能力，
             那是遊戲的事；硬要挑就會變成在 harness 裡寫遊戲數值判斷。 */
          var victim = null;
          for (var a3 = 0; a3 < itB.affixes.length; a3++) {
            var af3 = itB.affixes[a3];
            if (!af3 || !af3.key) continue;
            if (af3.key === tg2.affixKey) continue;
            if (af3.ancient && dCfg.keepAncient !== false) continue;
            victim = af3.key; break;
          }
          if (!victim) continue;

          deficitUsed[itB.id] = true;
          out.push({ name: r.cmd, args: { itemId: itB.id, affixKey: victim }, ruleId: r.id });
          break;                                              // 一次只專注一個部位
        }
      }
    } else if (r.upgradePriority) {
      /* 強化資源分配：每個品質有各自的強化上限，身上最高品質的部位不設上限。

         為什麼不是「只強化最高品質」：低階裝也得打得動，關卡推不過去就掉不到更好的裝備，
         那是死結。所以低階裝要強到「夠用」為止。

         為什麼不是「全部一視同仁」：低階裝遲早被換掉，換掉時強化等級一起消失。
         先前每個部位各一條規則、不分品質一律強化，前期把碎片與金幣全砸在藍裝上，
         實測 2 小時內 2,268 次強化呼叫回「資源不足」，就是這樣被吸乾的。

         上限表 capByRarity 以品質索引取值（R0 起算），是**策略資料**，可直接在
         policy JSON 調整。身上最高品質不套上限——那是最終會留下的裝備，
         材料本來就該集中在它身上（player_strategy.md 各強度的 +20/+35/+50/+60 目標）。 */
      var uCfg = r.upgradePriority;
      var uRarities = pathVal(state, uCfg.equippedRarities) || {};
      var uEquip = pathVal(state, uCfg.equipment) || {};
      var capTable = uCfg.capByRarity || [];

      var maxRarity = -1;
      for (var rk in uRarities) {
        var rv = Number(uRarities[rk]);
        if (rv > maxRarity) maxRarity = rv;
      }
      for (var sk in uRarities) {
        var eqItem = uEquip[sk];
        if (!eqItem || !eqItem.id) continue;
        var slotRarity = Number(uRarities[sk]);
        if (slotRarity !== maxRarity) {
          /* 非最高品質：查上限表。表上沒列到的品質視為不強化，
             避免「忘了填就變成無限強化」這種靜默的資源黑洞。 */
          var cap = (typeof capTable[slotRarity] === 'number') ? capTable[slotRarity] : 0;
          if ((eqItem.upgrade || 0) >= cap) continue;
        }
        var uArgs = {};
        for (var ak in baseArgs) uArgs[ak] = baseArgs[ak];
        uArgs[uCfg.argKey || 'itemId'] = eqItem.id;
        out.push({ name: r.cmd, args: uArgs, ruleId: r.id });
      }
    } else if (r.equipByPower) {
      /* ============ 換裝：問遊戲哪一件真的比較強 ============

         這條取代 bestPerSlot 的字典序比較 [品質, 裝等, 太古數, 評分]。

         ---- 為什麼一定要換掉 ----

         實測 20 小時 × 10 個 seed：5 個 seed 最後全身 13 件都是「R4 史詩、裝等 1」，
         物攻 334、等級 54、卡在關卡 42 整整 20 小時動不了。
         另外 5 個跨過關卡 50 之後物攻直接衝到 34,983。

         原因是字典序把**品質**排在**裝等**前面。而遊戲的掉落分段
         （equipmentTierLevel，js/formula.js:1251，EQUIP_TIER_SIZE=50）是
         關卡 1~49 掉裝等 1、50~99 掉裝等 50，同時詞條數值 =
         (基礎值 + 成長基礎值 × 每級成長 × (裝等−1)) × 品質倍率。實測同一條 atkFlat：

             裝等 1 → 裝等 50   ×27.95
             R2 → R5（裝等 1）   ×2.29

         **品質排在裝等前面，等於用一個 ×2.3 的因子否決一個 ×28 的因子。**
         一件 R4 裝等 1 會把整個部位鎖死，直到同品質的新裝等掉落為止。

         ---- 那品質的價值跑到哪去了 ----

         沒有不見。品質決定插槽數與詞條數（R4 三槽四詞條、R5 四槽五詞條），
         而那些在 computeStats 裡本來就算得到，會如實反映在戰力差上。
         差別只在於它現在是**一個可以被別的因子超越的加分**，而不是否決權。

         插槽變少與強化歸零這兩件無法由 computeStats 反映的成本，
         由評估器折算成 need 門檻（見 evaluator.js 的 evalSlotUpgrades）。

         ---- 策略在這裡做什麼 ----

         只做一件事：把評估器標記為 worth 的部位送出換裝指令。
         誰比較強是遊戲算的，不是這裡判斷的。 */
      var epCfg = r.equipByPower;
      var epTable = pathVal(state, epCfg.source);
      if (epTable) {
        /* 決定論：物件的鍵順序不該影響送出的指令順序。 */
        var epSlots = [];
        for (var epk in epTable) epSlots.push(epk);
        epSlots.sort();

        var epQuota = (typeof epCfg.maxPerDecision === 'number') ? epCfg.maxPerDecision : 13;
        /* ⚠️ 同一件背包裝備不得同時被送去兩個部位。

           評估器是**逐部位獨立**精算的，所以一只好戒指必然同時成為 ring 與 ring2
           的最佳候選（武器主副手同理）。兩條指令都送出去的話，遊戲會先把它裝到
           ring、再把同一件裝到 ring2——舊的 equipItem 不檢查，兩個欄位就指向同一個
           物件，存檔寫成兩份、讀回來變成兩個共用 id 的獨立物件，那件裝備從此
           不能強化／洗煉／卸下（resolveItem 回「ambiguous item id」）。

           實測 84 個模擬存檔有 74 個含重複 id。遊戲端已改成「移動」語意
           （js/player.js equipItem），但策略也不該送這種指令——第二條必然是
           把第一條的成果搬走，等於白花一個決策額度。
           舊的 bestPerSlot 規則本來就有這道 used 去重，換成評估器時漏掉了。 */
        var epUsed = {};
        for (var epi = 0; epi < epSlots.length && epQuota > 0; epi++) {
          var ep = epTable[epSlots[epi]];
          if (!ep || !ep.itemId || !ep.worth) continue;
          if (epUsed[ep.itemId]) continue;
          /* 額外的最低增幅門檻。評估器的 worth 已經扣掉插槽與強化成本，
             這裡是策略自己再加一道——換裝會讓寶石與附魔重來一輪，
             增幅太小的話換來換去的間接成本大於帳面收益。

             ⚠️ 階級判準（forcedByTier）豁免這道門檻。那條規則的前提就是
             「當下的帳面增幅不算數」——候選是裸的、詞條是隨機骰的，而那些都能
             事後補回來；它比的是洗不掉的品質與裝等。用當下增幅再擋一次，
             等於把那條規則整個廢掉（實測那些換裝的 gain 多半是負的）。 */
          if (!ep.forcedByTier
            && typeof epCfg.minGainPct === 'number' && ep.gain < epCfg.minGainPct) continue;
          epQuota--;
          epUsed[ep.itemId] = true;
          out.push({ name: r.cmd, args: { itemId: ep.itemId, slotKey: epSlots[epi] }, ruleId: r.id });
        }
      }
    } else if (r.rerollByRoi) {
      /* ============ 邊際效益驅動的洗煉 ============

         舊的兩條洗煉規則各有一半的答案，合起來仍然不完整：
           rerollOffTarget    「洗掉不在保留清單裡的」——被動，永遠不會主動去追某條詞條
           rerollForDeficit   「補到目標為止」——主動，但只認宣告過的目標

         兩者都要有人先寫下「什麼是好詞條」。這條規則不需要：
         好壞由 ctx.roi 排序（來自評估器的 ΔDPS/ΔEHP），犧牲哪一條由
         panels.eval.equippedAffixes 的邊際貢獻決定——兩邊都是遊戲算的。

         ---- 動作 ----

         1. 取 ROI 第一名的詞條與它建議的部位
         2. 在那個部位上找出邊際貢獻最低的一條詞條當犧牲品
         3. 只有「第一名的增幅 > 犧牲品的損失 + 門檻」時才送出洗煉

         第 3 點是這條規則不會空轉的原因：洗煉是隨機的，期望值不划算就不要洗。
         門檻會隨止損水位放寬（資源見底時要求更高的增幅才動手）。

         ⚠️ 洗煉的結果由遊戲擲骰，這裡只決定「犧牲哪一格」。
         策略仍然沒有能力指定要洗出什麼——那本來就不是玩家能決定的事。 */
      var rrCfg = r.rerollByRoi;
      var roi = state.ctx && state.ctx.roi;
      var eqAff = pathVal(state, rrCfg.equippedAffixes);
      var rrEquip = pathVal(state, rrCfg.equipment) || {};

      if (roi && roi.best && eqAff) {
        /* 止損：資源見底時把門檻乘上去（＝更少動手），而不是直接停手。
           完全停手會讓「資源不足」變成一個永久狀態——不洗就不會變強，
           不變強就推不過去，推不過去就掉不到資源。 */
        var sl = state.ctx.stopLoss;
        var gate = roi.minGainPct * (sl ? sl.gainMultiplier : 1);

        /* ---- 排序名次要落在「有被探測過的部位」上 ----

           評估器為了省 computeStats，只對前幾名的宿主部位探「身上這條詞條值多少」
           （probeTopSlots）。而它挑前幾名用的是**未加權**的增幅，這裡的排序卻是
           **依敗因加權**過的——兩份名次不一定同一個。

           不處理的話，第一名的部位剛好沒被探到時，eqAff[tgtSlot] 是 undefined，
           規則直接靜靜地什麼都不做。那種失效不會有任何徵兆，只會在報表上看到
           「reroll-by-roi 送出 0 次」，而看報表的人會以為是門檻設太高。

           所以往下找第一個「有被探到」的名次。找不到就是這一拍真的沒東西可洗。 */
        var pick = null;
        for (var rri = 0; rri < roi.ranked.length; rri++) {
          var cand2 = roi.ranked[rri];
          if (cand2.score < gate) break;              // 已排序，後面只會更低
          if (eqAff[cand2.slotKey]) { pick = cand2; break; }
        }
        if (!pick) pick = null;

        var tgtSlot = pick ? pick.slotKey : null;
        var affList = tgtSlot ? eqAff[tgtSlot] : null;
        var tgtItem = tgtSlot ? rrEquip[tgtSlot] : null;

        if (pick && affList && affList.length && tgtItem && tgtItem.id) {
          /* 身上已經有這條詞條就不必洗了——洗出第二條同名詞條遊戲會擋，
             而且 ROI 表算的是「多一條」的價值，不是「多兩條」。 */
          var already = false;
          for (var rai = 0; rai < affList.length; rai++) {
            if (affList[rai].key === pick.key) { already = true; break; }
          }

          if (!already) {
            /* ---- 犧牲品：淨收益最大的那一條 ----

               淨收益 = 洗出新詞條的收益 − 犧牲掉這一條的損失。

               ⚠️ 收益不是常數，它**取決於犧牲的是哪一種位置**。
               遊戲規則（js/item.js rerollSingleAffix）：「太古與否只看位置」——
               洗太古位置只換詞條種類，永遠維持太古，而太古的數值走另一條乘算路徑
               （baseV × AFFIX_MAX_VALUE_MULT × ANCIENT_AFFIX_VALUE_MULT，與 roll 無關）。
               所以同一次洗煉落在太古位置上的期望收益明顯較高，
               而評估器現在把兩種都算給我們（score / scoreAncient）。

               先前這裡只比損失、而且直接跳過太古位置，於是一批「保證滿值」的格子
               被永久閒置：實測 8 個存檔的 47 個太古位置有 49% 放著遊戲權重 <= 1 的詞條
               （生命值 0.05、法力值 0.075、生命恢復 0.6 這一類）。

               keepAncient 仍然預設為真——放行是策略要明確宣告的事。 */
            var victimAf = null, victimNet = -Infinity;
            for (var raj = 0; raj < affList.length; raj++) {
              var af2 = affList[raj];
              var isAnc = !!af2.ancient;
              if (isAnc && rrCfg.keepAncient !== false) continue;
              var loss = (af2.lossOffPct || 0) * roi.weights.offense
                + (af2.lossEhpPct || 0) * roi.weights.ehp;
              var gain = isAnc
                ? ((typeof pick.scoreAncient === 'number') ? pick.scoreAncient : pick.score)
                : pick.score;
              var net = gain - loss;
              /* 決定論：淨收益相同時以鍵名決勝，不讓陣列順序以外的東西影響結果。 */
              if (net > victimNet || (net === victimNet && victimAf && af2.key < victimAf.key)) {
                victimNet = net; victimAf = af2;
              }
            }

            /* 淨期望增益。這是整條規則的守門員：
               新詞條的價值必須明顯高於被犧牲那條，而且高出門檻。 */
            if (victimAf && victimNet >= gate) {
              out.push({ name: r.cmd, args: { itemId: tgtItem.id, affixKey: victimAf.key }, ruleId: r.id });
            }
          }
        }
      }
    } else if (r.upgradeByRoi) {
      /* ============ 強化：先確認付得起，再決定強化誰 ============

         ---- 實測動機 ----

         一場 20 小時的模擬送了 52,465 次 item.upgrade，其中 51,353 次（98%）
         遊戲回「資源不足」。舊規則（upgradePriority）只看品質上限表，
         完全不看戶頭裡有沒有錢，於是：
           - 每個決策點對 13 個部位各送一次，絕大多數必定落空
           - 少數成功的那幾次把資源打散在「即將被換掉」的部位上
             （強化等級在換裝時一起蒸發）

         ---- 兩道閘門 ----

         1. **付得起**：panels.eval.resources.upgradesAffordable < 門檻就整條停手。
            這不是保守，是把資源攢到能真的做完一次投資為止。
         2. **值得投**：正要被換掉的部位不強化（評估器說那個部位有 worth 的候選）。
            強化等級換裝時歸零，往那裡投等於直接丟掉。

         品質上限表（capByRarity）沿用舊規則的語意，仍然是策略資料。 */
      var urCfg = r.upgradeByRoi;
      var urAfford = pathVal(state, urCfg.affordPath);
      var urNeed = (typeof urCfg.minAffordable === 'number') ? urCfg.minAffordable : 1;
      /* 逐部位的付款能力。有這張表時整體門檻只當粗閘，實際由每個部位自己決定——
         一個部位付不起不該讓全身停工（見 evaluator.js evalResources 的實測說明）。 */
      var urSlotAfford = urCfg.affordableSlots ? pathVal(state, urCfg.affordableSlots) : null;

      /* null／NaN＝還算不出成本（開局沒有裝備）。當成「先別強化」——
         這一條每個決策點都會重來，晚幾秒沒有代價。 */
      if (typeof urAfford === 'number' && isFinite(urAfford) && urAfford >= urNeed) {
        var urRarities = pathVal(state, urCfg.equippedRarities) || {};
        var urEquip = pathVal(state, urCfg.equipment) || {};
        var urPlan = pathVal(state, urCfg.slotUpgrades) || {};
        var urCap = urCfg.capByRarity || [];

        var urMaxRarity = -1;
        for (var urk in urRarities) {
          var urv = Number(urRarities[urk]);
          if (urv > urMaxRarity) urMaxRarity = urv;
        }

        /* 決定論：鍵順序不該決定資源花在誰身上。 */
        var urSlots = [];
        for (var urk2 in urRarities) urSlots.push(urk2);
        urSlots.sort();

        var urQuota = (typeof urCfg.maxPerDecision === 'number') ? urCfg.maxPerDecision : 4;
        for (var uri = 0; uri < urSlots.length && urQuota > 0; uri++) {
          var urSlot = urSlots[uri];
          var urItem = urEquip[urSlot];
          if (!urItem || !urItem.id) continue;

          /* 這一格現在付得起嗎。付不起就跳過**這一格**，不是停掉整條規則。 */
          if (urSlotAfford && urSlotAfford[urSlot] === false) continue;

          /* 這個部位馬上要換掉：強化等級會一起蒸發，別投。 */
          var urPlanned = urPlan[urSlot];
          if (urPlanned && urPlanned.worth) continue;

          var urRar = Number(urRarities[urSlot]);
          if (urRar !== urMaxRarity) {
            var urLimit = (typeof urCap[urRar] === 'number') ? urCap[urRar] : 0;
            if ((urItem.upgrade || 0) >= urLimit) continue;
          }

          /* ---- 極端強化是虧的：先把全身推到同一個水位 ----

             強化成本是指數的（碎片 8×1.35^等級），而成功率在 +17 之後觸底 30%，
             失敗還要付半額。裝等 100、無成功率加成的期望碎片：
               +25 累計 440,754   +30 累計 2,004,659   +35 累計 9,017,264
             **把一件從 +32 推到 +35 要 5,357,090 碎片，那足夠把 12 個部位從 +0
             推到 +25**。而戰力上 +35 對 +25 是 ×1.22（一件），同樣的材料換到的是
             ×1.22（十二件）。

             例外：帶著**全域型詞條**的裝備值得推更高——
               gemEff（寶石鑲嵌效率）放大**全身**已鑲嵌寶石（formula.js 的
                 gemMult = 1 + gemEff/100，不是只加強自己）；
               enhanceSuccess（強化成功率）直接降低自己後續每一級的期望成本
                 （+40% 時推到 +35 的總成本降到 56%）。
             兩條都只出現在戒指與項鍊、史詩以上——那個部位群天生就是特別投資的目標。 */
          var urMax = (typeof urCfg.maxUpgrade === 'number') ? urCfg.maxUpgrade : Infinity;
          var urGlobalKeys = urCfg.globalAffixKeys || [];
          if (urGlobalKeys.length && urItem.affixes) {
            for (var ugi = 0; ugi < urItem.affixes.length; ugi++) {
              var uga = urItem.affixes[ugi];
              if (uga && uga.key && urGlobalKeys.indexOf(uga.key) >= 0) {
                urMax = (typeof urCfg.maxUpgradeGlobalAffix === 'number')
                  ? urCfg.maxUpgradeGlobalAffix : urMax;
                break;
              }
            }
          }
          if ((urItem.upgrade || 0) >= urMax) continue;

          urQuota--;
          var urArgs = {};
          for (var urak in baseArgs) urArgs[urak] = baseArgs[urak];
          urArgs[urCfg.argKey || 'itemId'] = urItem.id;
          out.push({ name: r.cmd, args: urArgs, ruleId: r.id });
        }
      }
    } else if (r.upgradeParts) {
      /* ---- 零件升級：全域乘數，優先於任何其他熔爐操作 ----

         零件等級存在 factory.partLevels，是**全域**的——升一次所有熔爐的同種零件
         一起變強（js/newforge.js newForgeUpgradePart 只改 partLevels，不動熔爐存檔）。
         而它直接決定精華／碎片／寶石的產出率。

         實測 24 小時 × 5 seed：AI 的零件全部停在 1 級（newforge.upgradePart 這條
         指令一次都沒送過），真人是 extractLens 5 / gemCollector 6 / scrapForge 4。
         結果分解件數 24,586 對 46,921、結局精華存量 12 對 11,932——
         而精華不夠正是「40% 的詞條是垃圾卻洗不掉」的病因：
         洗煉送出 12,328 次只成功 24.8%，失敗的 8,507 次全是「資源不足（需要精華 5）」。

         只升**這座策略真的在用的**零件（mix 宣告的那幾種），照宣告順序輪流升，
         每個決策點最多送一條——成本會隨等級變，同一拍連送兩次第二次多半空轉。
         成本由遊戲給（panels.newforge.partUpgradeCosts），策略不重算；
         goldRatio 是保留閥，金幣同時要餵強化與背包擴充。 */
      var upCfg = r.upgradeParts;
      var upLevels = pathVal(state, upCfg.levels) || {};
      var upCosts = pathVal(state, upCfg.costs) || {};
      var upGold = Number(pathVal(state, upCfg.gold)) || 0;
      var upRatio = (typeof upCfg.goldRatio === 'number') ? upCfg.goldRatio : 0.5;
      var upKeys = upCfg.parts || [];
      /* 等級最低的先升：全域乘數之間先補短板，比把單一種類推到頂划算。
         同級時照宣告順序，維持決定論。 */
      var upBest = null, upBestLv = Infinity, upBestOrd = Infinity;
      for (var ui = 0; ui < upKeys.length; ui++) {
        var uk = upKeys[ui];
        var ulv = Number(upLevels[uk]);
        var ucost = Number(upCosts[uk]);
        if (!(ulv >= 0) || !(ucost > 0)) continue;      // 已達上限時遊戲給 null
        if (ucost > upGold * upRatio) continue;
        if (ulv < upBestLv || (ulv === upBestLv && ui < upBestOrd)) {
          upBest = uk; upBestLv = ulv; upBestOrd = ui;
        }
      }
      if (upBest) out.push({ name: r.cmd, args: { partKey: upBest }, ruleId: r.id });
    } else if (r.resumeBest) {
      /* ---- 被打回去就直接切回來，不要重打一遍 ----

         野外死亡會退 FIELD_DEATH_STAGE_RETREAT（目前 10）關。這件事**本身不是損失**，
         因為關卡可以自由切（stage.goMax 一步跳回 min(best, 地圖上限)）——
         真人就是這樣玩的：BOSS 打不過立刻退 20 關掛機，覺得能打了馬上切回去。

         損失的是「沒切回去」。實測 20 小時死 456 次、每次退 10 關，而 stage.go 只送了
         36 次、stage.goMax **一次都沒送過**——角色老老實實把那 10 關重打一遍，
         一次約 3 分鐘。把兩邊的速率放在一起看就知道為什麼推不動：
           清怪推關 +3.4 關/分（每波 +1 關 × 自動推關開著 70% 的時間）
           死亡退關 −3.8 關/分（0.382 次/分 × 10 關）
         淨值是負的，20 小時大半在做白工。

         ⚠️ 不能無條件切回去，否則就是站在打不過的關卡反覆送死。判準沿用既有的
         **卡關重試閘門**（ctx.retryWaiting）：上一次沒打過、而且「時間沒到或還沒變強」
         時不准回去——那正是「覺得能挑戰了」這句話已經實作好的版本。
         另外還要求宣告的目標達標，語意與 stageGate.requireTargets 一致。 */
      var rbCfg = r.resumeBest;
      var rbStage = Number(pathVal(state, rbCfg.stage)) || 0;
      var rbBest = Number(pathVal(state, rbCfg.best)) || 0;
      var rbGap = (typeof rbCfg.minGap === 'number') ? rbCfg.minGap : 3;
      var rbOk = rbBest - rbStage >= rbGap;
      if (rbOk && state.ctx && state.ctx.retryWaiting) rbOk = false;
      var rbReq = rbCfg.requireTargets || [];
      for (var rbi = 0; rbi < rbReq.length && rbOk; rbi++) {
        var rbD = state.ctx && state.ctx.deficit && state.ctx.deficit[rbReq[rbi]];
        /* unknown 不算達標：資料不足時不要往前跳，下一拍就有值。 */
        if (!rbD || rbD.unknown || !rbD.met) rbOk = false;
      }
      if (rbOk) out.push({ name: r.cmd, args: baseArgs, ruleId: r.id });
    } else if (r.switchZone) {
      /* ---- 打通一張圖就換下一張 ----

         關卡改造之後每張地圖都是有限關卡（草原 200、荒漠 300、沼澤 400、
         亡靈山脈 500）。打到頂之後 js/combat.js 會把 current 夾在 maxStage、
         設 mapComplete 並停止出怪——**推關指令照送、遊戲照回 ok，但關卡再也不動**。
         沒有這條規則的話 AI 會在草原 200 關永久停住而且完全沒有徵兆。

         觸發條件刻意保守：**只有當前這張圖真的打通了才換**。
         換過去是從那張圖的第 1 關重新開始（怪物倍率更高、掉落裝等歸 1），
         短期一定是退步；在還推得動的時候換等於自己找罪受。
         打通之後則沒有別的選擇——留在原地是零產出。

         目標取「已解鎖、且上限比當前這張高」之中 order 最小的那一張：
         照設計順序走一階，不跳關。解鎖與否一律由遊戲的 isZoneUnlocked 回答。 */
      var szCfg = r.switchZone;
      var szZones = pathVal(state, szCfg.zones) || [];
      var szCur = null;
      for (var szi = 0; szi < szZones.length; szi++) {
        if (szZones[szi] && szZones[szi].key === pathVal(state, szCfg.currentZone)) szCur = szZones[szi];
      }
      if (szCur && szCur.maxStage > 0 && (szCur.best || 0) >= szCur.maxStage) {
        var szNext = null;
        for (var szj = 0; szj < szZones.length; szj++) {
          var sz = szZones[szj];
          if (!sz || !sz.unlocked) continue;
          if (!(sz.maxStage > szCur.maxStage)) continue;
          if (!szNext || sz.order < szNext.order) szNext = sz;
        }
        if (szNext) out.push({ name: r.cmd, args: { zoneKey: szNext.key }, ruleId: r.id });
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
