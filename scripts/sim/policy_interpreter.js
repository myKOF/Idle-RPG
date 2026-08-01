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
function expandCandidates(state, policy, spec) {
  if (spec.values) return spec.values.slice();
  if (spec.list) return (policy.lists[spec.list] || []).slice();
  if (spec.listByLevel) {
    var band = pickBand(state, spec.listByLevel, spec.levelPath);
    if (!band) return [];
    return (band.list ? (policy.lists[band.list] || []) : (band.values || [])).slice();
  }
  if (spec.path) {
    var v = pathVal(state, spec.path);
    if (!v) return [];
    if (Array.isArray(v)) return v.slice();
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
  } else if (T.engaged) {
    /* 交戰結束。關卡往前＝過了，往後＝死了退關（js/combat.js 的 retreatStage）。 */
    var e = T.engaged;
    T.engaged = null;
    if (stage > e.stage) {
      delete T.attempts[e.stage];                    // 過關就清掉紀錄
    } else if (stage < e.stage) {
      var rec = T.attempts[e.stage] || (T.attempts[e.stage] = { fails: 0 });
      rec.fails++;
      rec.lastFailAt = now;
      rec.minHpPct = e.minHpPct;
      rec.mode = e.mode;
      /* 重試間隔＝敵人剩餘血量百分比當分鐘數，最少 10 分鐘。 */
      rec.retryAt = now + Math.max(10, e.minHpPct) * 60;
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
  if (!policy.track) {
    /* 沒有戰鬥追蹤的策略仍然可以宣告目標——deficit 要算，否則相關規則會靜靜地
       永遠不觸發。

       ⚠️ 只補 deficit，不覆寫整個 ctx：呼叫端（測試、或日後別的驅動）可能自己
       塞了 ctx 進來，整包換掉會把它們默默清空。 */
    if (!state.ctx) state.ctx = {};
    state.ctx.deficit = evalTargets(state, policy, memo);
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
    var grew = hasProgressed(T.baseline, progressSnapshot(state, t));
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
    minHpPct: blockRec ? Math.round(blockRec.minHpPct || 100) : 100
  };

  /* 目標缺口。要在 state.ctx 建好之後才算——度量路徑可以指向 ctx.*
     （例如有效命中率要用 ctx.enemyDodge）。 */
  state.ctx.deficit = evalTargets(state, policy, memo);
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
function evalTargets(state, policy, memo) {
  var out = {};
  var list = policy.targets || [];
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    if (!t || !t.id) continue;
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
    }

    if (value === null) { out[t.id] = { value: null, target: t.atLeast, short: 0, met: true, unknown: true }; continue; }
    var short = Math.max(0, (Number(t.atLeast) || 0) - value);
    out[t.id] = { value: value, target: Number(t.atLeast) || 0, short: short, met: short <= 0, unknown: false };
  }
  return out;
}

/* 高頻觀測的進入點。不回傳指令——觀測不是操作，玩家看戰鬥不算按按鈕。
   驅動端每 observeEverySec 呼叫一次，與 decide 的頻率無關。 */
function observe(state, policy, memo) {
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

        /* ⚠️ 這裡刻意**不**因為「身上這件帶著補缺口的詞條」就擋下換裝。

           試過，結果更糟：實測 100 小時從關卡 190 掉到 117。原因是目標訂了達不到的值
           （有效命中 95%，而高關卡怪物閃避已超過 100%，公式上永遠達不到），
           於是「缺口未補滿」永遠成立，保護變成永久凍結，裝備從此停止升級。

           教訓是通則：**任何「缺口未補滿時就改變行為」的規則，都要能在目標達不到時
           自己收手**，否則不可達的目標會把整個策略鎖死在緊急模式。
           換裝把詞條換掉的損失，由缺口洗煉重新洗回來吸收——那是有界的成本，
           凍結換裝不是。 */
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
        /* cap 0＝普通裝備不能附魔；已放滿就跳過（同鍵覆蓋只有數值會提升時才成立，
           而裝備不動的話數值不會變，每次都送只會每次都被回絕）。 */
        var cur = eItem.enchants || [];
        if (!(info.cap > 0) || cur.length >= info.cap) continue;

        var cands = byCat[info.cat] || [];
        if (!cands.length) continue;
        var has = {};
        for (var hi = 0; hi < cur.length; hi++) if (cur[hi] && cur[hi].key) has[cur[hi].key] = true;

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

        /* park：這一段的安全關卡區間（player_strategy.md 的「安全關卡」建議值）。
           品質沒到門檻時就待在區間裡刷——低於下緣要往前推到區間內，
           高於上緣要退回來。只把自動推關關掉是不夠的：關掉時人在哪就停在哪，
           可能停在一個一直死的關卡，而指南要的是停在「穩定不死、殺得快」的那一段。 */
        /* 卡關重試閘門：上一次菁英／BOSS 沒打過，且「時間沒到」或「還沒變強」，
           就不准再往前送死——回安全關卡刷到條件滿足為止（player_strategy.md 卡關定義）。
           這一條蓋過品質門檻：品質達標也不代表打得過那一關。 */
        if (state.ctx && state.ctx.retryWaiting) passGate = false;

        var park = cp.park;
        var inPark = !!(park && park.length === 2);
        if (!passGate && inPark && gStage > park[1] && gCfg.retreatCmd) {
          out.push({ name: gCfg.retreatCmd, args: { delta: park[1] - gStage }, ruleId: r.id });
        }

        var gArgs = {};
        for (var gak in baseArgs) gArgs[gak] = baseArgs[gak];
        /* 一定要是布林值：協議的 on 是 bool，回 undefined 會被 validateCommand 擋下。 */
        gArgs[gCfg.argKey || 'on'] = !!(passGate || (inPark && gStage < park[0]));
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
        var want = (typeof tg2.maxAffixes === 'number') ? tg2.maxAffixes : 1;
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
