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

/* 依角色等級選出適用的「段」。段由上往下比對，第一個 maxLevel >= 目前等級的就是它；
   沒有 maxLevel 的段視為「以上皆非」的最後一段。

   player_strategy.md 的寶石鑲嵌與技能升級都是分階段的（前 50 級／51~100／101 以後），
   所以前中後期在這裡是同一套邊界，不各自定義一套。 */
function pickBand(state, bands, levelPath) {
  if (!bands || !bands.length) return null;
  var lv = Number(pathVal(state, levelPath || 'view.level')) || 0;
  for (var i = 0; i < bands.length; i++) {
    if (bands[i].maxLevel === undefined || lv <= bands[i].maxLevel) return bands[i];
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

/* 手上每種寶石的總數與最高階。庫存是 { 種類: { 階級: 數量 } } 的巢狀表。 */
function gemStock(heldGems) {
  var stockOf = {}, available = [], maxLvOf = {};
  for (var gt in heldGems) {
    var n = sumLeaves(heldGems[gt]);
    if (n <= 0) continue;
    stockOf[gt] = n;
    available.push(gt);
    var top = 0;
    for (var lv in heldGems[gt]) {
      if ((Number(heldGems[gt][lv]) || 0) > 0 && Number(lv) > top) top = Number(lv);
    }
    maxLvOf[gt] = top;
  }
  return { stockOf: stockOf, available: available, maxLvOf: maxLvOf };
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
        /* 部位歸屬以遊戲提供的 item.slots 為準（面板欄位，來自 equipSlotsForItem）。
           舊版是把部位鍵結尾的數字去掉當基礎部位——那對戒指沒問題，
           但雙手武器的合法部位只有 weapon，硬塞進 weapon2 會害主手被卸下。
           沒有 slots 欄位的舊資料才退回去數字的作法。 */
        var baseSlot = String(slotKey).replace(/\d+$/, '');
        var currRarity = (typeof eqRarities[slotKey] === 'number') ? eqRarities[slotKey] : -1;
        var currScore = eqScores[slotKey] || 0;

        var best = null;
        for (var it = 0; it < items.length; it++) {
          var item = items[it];
          if (!item || item.locked) continue;
          var fits = (item.slots && item.slots.length)
            ? (item.slots.indexOf(slotKey) >= 0)     // 遊戲說了算
            : (item.slot === baseSlot);              // 舊資料退路
          if (!fits) continue;
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
      var sStock = gemStock(heldGems);

      /* 偏好群組：preferByLevel 分段（types＝偏好序；mix＝多組輪流取用），
         沒設定就退回單一段的 preferTypes。 */
      var sBand = bandGroups(pickBand(state, sCfg.preferByLevel, sCfg.levelPath), sCfg.preferTypes);
      var groupTurn = 0;
      var cursor = [];
      for (var ci = 0; ci < sBand.groups.length; ci++) cursor.push(0);

      if (sStock.available.length) {
        for (var ssk in sEquip) {
          var sItem = sEquip[ssk];
          if (!sItem || !sItem.id || !sItem.sockets) continue;
          var hasEmpty = false;
          for (var si = 0; si < sItem.sockets.length; si++) if (!sItem.sockets[si]) { hasEmpty = true; break; }
          if (!hasEmpty) continue;
          var pick = pickGemType(sBand.groups, groupTurn, cursor, sBand.spread, sStock.stockOf, sStock.available, true);
          if (!pick) break;                       // 庫存見底
          sStock.stockOf[pick]--;
          groupTurn = (groupTurn + 1) % sBand.groups.length;
          /* 每個部位一次只送一顆：鑲上之後空槽與庫存都會變，下個決策點再算一次即可。 */
          out.push({ name: r.cmd, args: { itemId: sItem.id, type: pick }, ruleId: r.id });
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
      var uoStock = gemStock(pathVal(state, uoCfg.gems) || {});

      /* 偏好種類與 socketEmpty 取自同一份設定，維持單一來源——
         兩邊各寫一份的話，改了其中一份就會變成「拆掉的正是剛鑲上的」無限來回。 */
      var uBand = bandGroups(pickBand(state, uoCfg.preferByLevel, uoCfg.levelPath), uoCfg.preferTypes);
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
      var wanted = {};
      var wantList = (policy.lists && policy.lists[rCfg.targetList]) || [];
      for (var wi = 0; wi < wantList.length; wi++) wanted[wantList[wi]] = true;
      var minRarity = (typeof rCfg.minRarity === 'number') ? rCfg.minRarity : 0;

      for (var rsk in rEquip) {
        var rItem = rEquip[rsk];
        if (!rItem || !rItem.id || !rItem.affixes) continue;
        if ((rItem.rarity || 0) < minRarity) continue;      // 低品質不值得花精華
        for (var ai = 0; ai < rItem.affixes.length; ai++) {
          var af = rItem.affixes[ai];
          if (!af || !af.key || wanted[af.key]) continue;
          if (af.ancient && rCfg.keepAncient !== false) continue;   // 太古詞條預設不動
          out.push({ name: r.cmd, args: { itemId: rItem.id, affixKey: af.key }, ruleId: r.id });
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
