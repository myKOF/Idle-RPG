'use strict';
/* ============ 主線任務系統（2026-08-05） ============
   任務定義表 TASKS 在 js/data.js（唯一來源：config/CSV/Task.csv，經套用參數.bat 回寫）。
   本檔只在 Worker 端載入（sim.worker.js importScripts），與 factory / newforge 同類：
   主執行緒讀 tick.view 的 taskIdx / taskProg / taskReady 與 task 面板投影，不載入本檔。

   進度來源分兩類：
   - 累計次數：讀 G.factory.stats 既有統計（upgraded / enchanted），洗煉與合成
     兩個新計數（rerolled / gemComposed）由 item.js 對應成功點遞增。
   - 狀態檢查：每次讀取時依 G 現況計算（身上品質、鑲嵌數、太古數、關卡、高塔層數、
     零件等級、技能等級、生命上限），拔下再裝不會重複計數——這正是設計文檔對鑲嵌任務
     的要求。

   存檔欄位只有 G.taskState = { idx }：idx 為下一個可領取的任務索引（0 起）。
   idx 之前的任務一律視為已領取；任務嚴格循序，僅 idx 那一筆可領。 */

function taskState() {
  if (!G.taskState || typeof G.taskState !== 'object') G.taskState = { idx: 0 };
  var st = G.taskState;
  var max = (typeof TASKS !== 'undefined') ? TASKS.length : 0;
  st.idx = Math.max(0, Math.min(Math.floor(Number(st.idx) || 0), max));
  return st;
}

/* ---- 狀態檢查輔助 ---- */

// 身上滿足「品質 ≥ minR 且 裝備等級 ≥ minLv」的部位數。
// 副手欄被雙手武器連帶佔用時，以主手那把雙手武器計入（穿滿 13 部位才可能達成）。
function taskCountEquipSlots(minR, minLv) {
  var eq = (typeof activeEquipment === 'function') ? activeEquipment() : G.equipment;
  if (!eq) return 0;
  var n = 0;
  for (var i = 0; i < SLOT_LIST.length; i++) {
    var key = SLOT_LIST[i];
    var it = eq[key];
    if (!it && typeof slotBlockedByTwoHand === 'function' && slotBlockedByTwoHand(eq, key)) it = eq.weapon;
    if (it && (Number(it.rarity) || 0) >= minR && (Number(it.level) || 0) >= minLv) n++;
  }
  return n;
}

// 身上目前鑲嵌的寶石總數（一般與融合寶石都算；空槽為 null 不計）
function taskCountSocketedGems() {
  var eq = (typeof activeEquipment === 'function') ? activeEquipment() : G.equipment;
  if (!eq) return 0;
  var n = 0;
  for (var i = 0; i < SLOT_LIST.length; i++) {
    var it = eq[SLOT_LIST[i]];
    if (!it || !Array.isArray(it.sockets)) continue;
    for (var j = 0; j < it.sockets.length; j++) {
      var g = it.sockets[j];
      if (g && (g.fused || (typeof GEM_TYPES !== 'undefined' && GEM_TYPES[g.type]))) n++;
    }
  }
  return n;
}

// 身上裝備的太古詞條總數
function taskCountAncientAffixes() {
  var eq = (typeof activeEquipment === 'function') ? activeEquipment() : G.equipment;
  if (!eq) return 0;
  var n = 0;
  for (var i = 0; i < SLOT_LIST.length; i++) {
    var it = eq[SLOT_LIST[i]];
    if (it && typeof getItemAncientCount === 'function') n += getItemAncientCount(it);
  }
  return n;
}

// 熔爐目前已裝配的零件總數（跨所有熔爐）
function taskCountForgeParts() {
  var nf = G.newForge;
  if (!nf || !Array.isArray(nf.furnaces)) return 0;
  var n = 0;
  for (var i = 0; i < nf.furnaces.length; i++) {
    var fu = nf.furnaces[i];
    if (fu && Array.isArray(fu.parts)) n += fu.parts.length;
  }
  return n;
}

/* 目前等級最高的零件是幾級（「升級任意零件至 N 級」）。
   零件等級是全域資料（G.factory.partLevels，見 formula.js partLevelFor），
   不隨零件有沒有裝在熔爐上而變動；未解鎖的零件視為 0 級，不佔進度。 */
function taskMaxForgePartLevel() {
  var levels = G.factory && G.factory.partLevels;
  if (!levels || typeof levels !== 'object' || typeof PART_TYPES === 'undefined') return 0;
  var best = 0;
  var keys = Object.keys(PART_TYPES);
  for (var i = 0; i < keys.length; i++) {
    var lv = Math.floor(Number(levels[keys[i]]) || 0);
    if (lv > best) best = lv;
  }
  return Math.max(0, best);
}

/* ---- 任務進度 ----
   回傳該任務目前的進度值；與 def.count 比較即知是否達成。
   已領取的任務（idx 之前）由呼叫端直接以 count 顯示，不再重算。 */
function taskProgressFor(def) {
  if (!def || !G) return 0;
  var stats = (G.factory && G.factory.stats) || {};
  var parts;
  switch (def.type) {
    case 'equipSlots':
      parts = String(def.param || '0|0').split('|');
      return taskCountEquipSlots(Math.floor(Number(parts[0]) || 0), Math.floor(Number(parts[1]) || 0));
    case 'upgradeCount': return Math.floor(Number(stats.upgraded) || 0);
    case 'rerollCount': return Math.floor(Number(stats.rerolled) || 0);
    case 'enchantCount': return Math.floor(Number(stats.enchanted) || 0);
    case 'composeCount': return Math.floor(Number(stats.gemComposed) || 0);
    case 'socketCount': return taskCountSocketedGems();
    case 'forgeParts': return taskCountForgeParts();
    case 'forgePartLevel': return taskMaxForgePartLevel();
    case 'ancientCount': return taskCountAncientAffixes();
    case 'maxHp': return (typeof getStats === 'function') ? Math.floor(getStats().hp || 0) : 0;
    case 'stageClear':
      /* 讀「實際已通關的最高關」（data.js zoneClearedStage）而不是 best-1：
         best 在地圖最後一關會被上限夾住，用 best-1 判定的話「打贏荒漠第 200 關」
         這種以最後一關為目標的任務永遠差 1，整條任務鏈會卡死。 */
      return (typeof zoneClearedStage === 'function') ? zoneClearedStage(def.param) : 0;
    case 'towerFloor':
      // 高塔已通關的最高層（G.tower.highest，見 tower.js endTowerFight 的 firstClear）
      return Math.max(0, Math.floor(Number(G.tower && G.tower.highest) || 0));
    case 'skillLevel':
      return (typeof skillLevel === 'function') ? (skillLevel(def.param) || 0) : 0;
    default: return 0;
  }
}

/* ---- tick 高頻視圖（純量）----
   idx = -1 代表全部任務已完成；此時 prog / ready 無意義。 */
function taskQuickView() {
  if (typeof TASKS === 'undefined' || !G) return { idx: -1, prog: 0, ready: false };
  var st = taskState();
  var def = TASKS[st.idx];
  if (!def) return { idx: -1, prog: 0, ready: false };
  var prog = taskProgressFor(def);
  return { idx: st.idx, prog: prog, ready: prog >= def.count };
}

/* ---- task 面板投影（任務總覽）----
   只送動態欄位；名稱、目標數、獎勵文字由主執行緒讀共載的 TASKS（js/data.js）。 */
function taskPanelData() {
  if (typeof TASKS === 'undefined' || !G) return { idx: 0, tasks: [] };
  var st = taskState();
  var list = [];
  for (var i = 0; i < TASKS.length; i++) {
    var def = TASKS[i];
    var claimed = i < st.idx;
    var prog = claimed ? def.count : taskProgressFor(def);
    list.push({
      idx: i,
      prog: prog,
      claimed: claimed,
      current: i === st.idx,
      ready: (i === st.idx) && prog >= def.count
    });
  }
  return { idx: st.idx, tasks: list };
}

/* ---- 領取獎勵（指令 task.claim → 本函式）----
   領域層面的拒絕回傳 { err }（協議 §4.3：玩家提示走事件，不丟例外）。 */
function taskGrantReward(def) {
  var p = G.player;
  var qty = Math.max(0, Math.floor(Number(def.rewardQty) || 0));
  switch (def.rewardType) {
    case 'gold': p.gold += qty; break;
    case 'scrap': p.scrap += qty; break;
    case 'essence': p.essence += qty; break;
    case 'skillXp':
      if (typeof gainSkillMasteryXp === 'function') gainSkillMasteryXp(qty);
      UI.dirty.skills = true;
      break;
    case 'gem': {
      var lv = Math.max(1, Math.floor(Number(def.rewardParam) || 1));
      for (var i = 0; i < qty; i++) addGem(randomGemType(), lv, 1);
      break;
    }
    case 'book': {
      var key = String(def.rewardParam || '');
      if (typeof ENCHANTS !== 'undefined' && ENCHANTS[key]) {
        p.books[key] = (p.books[key] || 0) + qty;
      }
      break;
    }
    case 'equip': {
      // param = 品質|等級|太古數（等級 0 = 依當前關卡；太古空白 = 自然擲骰）
      var parts = String(def.rewardParam || '0').split('|');
      var opts = { rarity: Math.floor(Number(parts[0]) || 0) };
      var lvl = Math.floor(Number(parts[1]) || 0);
      if (lvl > 0) opts.level = lvl;
      if (parts.length > 2 && String(parts[2]).trim() !== '') {
        opts.ancientCount = Math.max(0, Math.floor(Number(parts[2]) || 0));
      }
      for (var j = 0; j < qty; j++) {
        var it = makeEquipment((G.stage && G.stage.current) || 1, opts);
        /* 直接入包，不走輸送帶：任務獎勵不可被熔爐自動拆解吃掉
           （保底發放比照 js/special_rules.js 的專屬裝備）。 */
        G.inventory.push(it);
        blog('🎁 任務獎勵入包：' + rarityTag(it), 'good');
      }
      UI.dirty.inv = true;
      break;
    }
  }
  UI.dirty.header = true;
}

function taskClaim() {
  if (typeof TASKS === 'undefined' || !G) return { err: '任務表未載入' };
  var st = taskState();
  var def = TASKS[st.idx];
  if (!def) return { err: '所有任務已完成' };
  var prog = taskProgressFor(def);
  if (prog < def.count) return { err: '任務尚未完成（' + prog + '/' + def.count + '）' };
  taskGrantReward(def);
  st.idx++;
  UI.dirty.task = true;
  blog('📜 任務完成：「' + def.name + '」，獲得 ' + def.rewardLabel, 'good');
  var next = TASKS[st.idx];
  if (next) blog('📌 新任務：「' + next.name + '」', 'info');
  else blog('🎉 恭喜！所有任務皆已完成。', 'good');
  return { claimed: def.order, next: next ? next.order : null };
}
