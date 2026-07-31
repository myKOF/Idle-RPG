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

         哪一種寶石由策略資料指定（gemType，例如 garnet＝爆傷，
         對應 player_strategy.md「寶石以攻擊為主，目標全身戴滿爆傷寶石」）。
         夠不夠鑲、等級對不對一律由遊戲判斷，這裡只負責找出空槽並送指令。 */
      var sCfg = r.socketEmpty;
      var sEquip = pathVal(state, sCfg.equipment) || {};
      var heldGems = pathVal(state, sCfg.gems) || {};

      /* ⚠️ 不能寫死寶石種類。socketGem() 找不到那種寶石就直接回「沒有這種寶石」
         （js/item.js:368），實測寫死 garnet 的話 1,421 次呼叫全部落空——
         身上明明有 31 顆，只是沒有那一種。
         改成：先照 preferTypes 的優先序找手上真的有的，都沒有就用任何一種有貨的。
         等級由遊戲自己挑（socketGem 會取現有的最高階），策略不介入。 */
      var available = [];
      for (var gt in heldGems) {
        var lvObj = heldGems[gt], n = 0;
        for (var gl in lvObj) n += Number(lvObj[gl]) || 0;
        if (n > 0) available.push(gt);
      }
      var pick = null;
      var prefer = sCfg.preferTypes || [];
      for (var pi = 0; pi < prefer.length && !pick; pi++) {
        if (available.indexOf(prefer[pi]) >= 0) pick = prefer[pi];
      }
      if (!pick && available.length) pick = available[0];
      /* 送出的數量不能超過該種寶石的庫存，否則多出來的每一條都會換回
         「沒有這種寶石」——實測一次決策點就浪費 183 次呼叫，把報表淹掉。 */
      var stock = 0;
      if (pick && heldGems[pick]) for (var sl in heldGems[pick]) stock += Number(heldGems[pick][sl]) || 0;
      if (pick && stock > 0) {
        for (var ssk in sEquip) {
          var sItem = sEquip[ssk];
          if (!sItem || !sItem.id || !sItem.sockets) continue;
          var hasEmpty = false;
          for (var si = 0; si < sItem.sockets.length; si++) if (!sItem.sockets[si]) { hasEmpty = true; break; }
          if (!hasEmpty) continue;
          if (stock <= 0) break;
          stock--;
          /* 每個部位一次只送一顆：鑲上之後空槽與庫存都會變，下個決策點再算一次即可。 */
          out.push({ name: r.cmd, args: { itemId: sItem.id, type: pick }, ruleId: r.id });
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
