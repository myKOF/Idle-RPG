'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
/* ============ 成就系統（2026-10-31） ============
   定義表 ACHIEVEMENTS 在 js/achievement_data.js（唯一來源：config/Excel/Achievement.xlsx，經套用參數.bat 回寫）。
   本檔只在 Worker 端載入（sim.worker.js importScripts），與 tasks.js 同類：
   主執行緒讀 achv 面板投影與共載的 ACHIEVEMENTS 表，不載入本檔。

   存檔 G.achv = { got: { 編號: 達成時間 }, st: { 累計統計 } }
   - got：達成就永久保留（拆裝備、換技能、轉生都不會撤銷）；沒有領獎機制。
   - st ：沒有現成統計可讀的累計值——累計金幣、太古精鑄／神聖刻印成功次數、神鑄消耗件數、
          做出過的符文、歷史最高等級。洗煉／強化次數沿用 G.factory.stats（rerolled／upgraded）。
   判定：每 ACH_CHECK_SEC 遊戲秒掃一次未達成的成就（achTick），讀現況＋累計值；
   狀態型條件（穿滿、鑲嵌數…）因此用「達成過一次」語意，與任務系統「拔下再裝不重複計數」不同。 */

var ACH_CHECK_SEC = 1;
var _achAcc = 0;

function achState() {
  if (!G.achv || typeof G.achv !== 'object') G.achv = { got: {}, st: {} };
  if (!G.achv.got || typeof G.achv.got !== 'object') G.achv.got = {};
  if (!G.achv.st || typeof G.achv.st !== 'object') G.achv.st = {};
  return G.achv;
}
function achStat(key) { return Math.max(0, Number(achState().st[key]) || 0); }

/* ---- 累計統計的寫入點（其他模組在成功點呼叫，皆有 typeof 守衛） ---- */
function achAddStat(key, n) {
  if (!G || !(n > 0)) return;
  var st = achState().st;
  st[key] = (Number(st[key]) || 0) + n;
}
function achAddGold(n) { achAddStat('gold', n); }
function achNoteRune(id) {
  if (!G) return;
  var st = achState().st;
  if (!st.runeMade || typeof st.runeMade !== 'object') st.runeMade = {};
  st.runeMade[id] = 1;
}

/* ---- 現況讀取輔助 ---- */
// 品質換算：神鑄神話（baseRarity）以神話計，其餘用品質編號本身
function achRank(it) {
  var r = RARITIES[Math.floor(Number(it && it.rarity) || 0)];
  return r && r.baseRarity !== undefined ? r.baseRarity : Math.floor(Number(it && it.rarity) || 0);
}
function achEquipSets() { return Array.isArray(G.equipmentSets) && G.equipmentSets.length ? G.equipmentSets : [G.equipment]; }
// 擁有的所有裝備（三套穿戴＋背包）
var _achOwnedCache = null, _achPass = false;   // achCheck／achPanelData 一趟內共用（避免每個條件各掃一次背包）
function achOwnedItems() {
  if (_achOwnedCache) return _achOwnedCache;
  var out = [];
  achEquipSets().forEach(function (eq) {
    if (!eq) return;
    for (var i = 0; i < SLOT_LIST.length; i++) if (eq[SLOT_LIST[i]]) out.push(eq[SLOT_LIST[i]]);
  });
  if (Array.isArray(G.inventory)) for (var j = 0; j < G.inventory.length; j++) if (G.inventory[j]) out.push(G.inventory[j]);
  if (_achPass) _achOwnedCache = out;
  return out;
}
function achBeginPass() { _achPass = true; _achOwnedCache = null; }
function achEndPass() { _achPass = false; _achOwnedCache = null; }
function achEquippedItems() {
  var eq = (typeof activeEquipment === 'function') ? activeEquipment() : G.equipment;
  var out = [];
  if (!eq) return out;
  for (var i = 0; i < SLOT_LIST.length; i++) if (eq[SLOT_LIST[i]]) out.push(eq[SLOT_LIST[i]]);
  return out;
}
// 全身（13 部位）中達到最低品質的部位數；雙手武器連帶佔用的副手欄以主手那把計入
function achCountSlotsAtRank(minRank) {
  var eq = (typeof activeEquipment === 'function') ? activeEquipment() : G.equipment;
  if (!eq) return 0;
  var n = 0;
  for (var i = 0; i < SLOT_LIST.length; i++) {
    var key = SLOT_LIST[i];
    var it = eq[key];
    if (!it && typeof slotBlockedByTwoHand === 'function' && slotBlockedByTwoHand(eq, key)) it = eq.weapon;
    if (it && achRank(it) >= minRank) n++;
  }
  return n;
}
// 各寶石種類擁有的最高階 { 種類: 階 }（庫存與鑲嵌中的都算），一趟走完所有裝備
function achGemTopByType() {
  var top = {}, gems = G.player.gems || {};
  for (var t in gems) {
    for (var lv in gems[t]) if ((gems[t][lv] || 0) > 0 && Number(lv) > (top[t] || 0)) top[t] = Number(lv);
  }
  achOwnedItems().forEach(function (it) {
    if (!Array.isArray(it.sockets)) return;
    it.sockets.forEach(function (g) {
      if (g && !g.fused && g.type && (Number(g.level) || 0) > (top[g.type] || 0)) top[g.type] = Number(g.level) || 0;
    });
  });
  return top;
}
function achActiveRunewords() {
  var seen = {}, list = [];
  if (typeof rwActiveWord !== 'function') return list;
  achEquippedItems().forEach(function (it) {
    var act = rwActiveWord(it);
    if (act && act.word && !seen[act.word.id]) { seen[act.word.id] = 1; list.push(act.word); }
  });
  return list;
}

/* ---- 進度：回傳 { prog, goal }；prog >= goal 即達成 ---- */
function achProgress(def) {
  var p = G.player, goal = Math.max(0, Number(def.count) || 0), prog = 0, i;
  var fstats = (G.factory && G.factory.stats) || {};
  switch (def.type) {
    case 'equipFull': prog = achCountSlotsAtRank(Math.floor(Number(def.param) || 0)); break;
    case 'level':
      prog = Math.max(achStat('maxLevel'), Number(p.level) || 0);
      if ((Number(p.reincarnations) || 0) > 0) prog = Math.max(prog, REINCARNATION_LEVEL);   // 轉生需要滿級，舊檔補記
      break;
    case 'enhanceLevel':
      achOwnedItems().forEach(function (it) { if ((Number(it.upgrade) || 0) > prog) prog = Number(it.upgrade) || 0; });
      break;
    case 'ancientEquipped': prog = (typeof taskCountAncientAffixes === 'function') ? taskCountAncientAffixes() : 0; break;
    case 'rerollCount': prog = Math.floor(Number(fstats.rerolled) || 0); break;
    case 'upgradeCount': prog = Math.floor(Number(fstats.upgraded) || 0); break;
    case 'socketEquipped': prog = (typeof taskCountSocketedGems === 'function') ? taskCountSocketedGems() : 0; break;
    case 'gemLevel': {
      var top = achGemTopByType();
      for (var gt in top) if (top[gt] > prog) prog = top[gt];
      break;
    }
    case 'gemAllTypes': {
      var types = Object.keys(GEM_TYPES).filter(function (t) { return typeof isGemEnabled === 'function' ? isGemEnabled(t) : true; });
      goal = types.length;
      var topAll = achGemTopByType();
      for (i = 0; i < types.length; i++) if ((topAll[types[i]] || 0) >= (Number(def.count) || 10)) prog++;
      break;
    }
    case 'gemDivine':
      (p.fusedGems || []).forEach(function (fg) { if (fg && fg.divine) prog++; });
      break;
    case 'godEquip':
      achOwnedItems().forEach(function (it) {
        var r = RARITIES[Math.floor(Number(it.rarity) || 0)];
        if (r && (r.key === 'godforged' || r.key === 'chaosGodforged' || r.key === 'mythicGodforged')) prog++;
      });
      break;
    case 'ancientCast': prog = achStat('ancientCast'); break;
    case 'imprintCount': prog = achStat('imprint'); break;
    case 'divineConsumed': prog = achStat('divineConsumed'); break;
    case 'dualLegend':
      achOwnedItems().forEach(function (it) { if (typeof itemPassives === 'function' && itemPassives(it).length >= 2) prog++; });
      break;
    case 'forgePartsMax': {
      var keys = (typeof PART_TYPES !== 'undefined') ? Object.keys(PART_TYPES) : [];
      goal = keys.length;
      var levels = (G.factory && G.factory.partLevels) || {};
      for (i = 0; i < keys.length; i++) if (Math.floor(Number(levels[keys[i]]) || 0) >= PART_MAX_TIER) prog++;
      break;
    }
    case 'goldTotal': prog = achStat('gold'); break;
    case 'runewordActive':
    case 'runewordDistinct': prog = achActiveRunewords().length; break;
    case 'runeMade': {
      var rid = String(def.param || '');
      goal = 1;
      prog = (achState().st.runeMade && achState().st.runeMade[rid]) || (typeof runeCount === 'function' && runeCount(rid) > 0) ? 1 : 0;
      break;
    }
    case 'runewordTier': {
      var minTier = Math.floor(Number(def.param) || 1);
      achActiveRunewords().forEach(function (w) { if ((Number(w.tier) || 0) >= minTier) prog++; });
      break;
    }
    case 'reincarnation': prog = Math.floor(Number(p.reincarnations) || 0); break;
    case 'towerFloor': prog = Math.max(0, Math.floor(Number(G.tower && G.tower.highest) || 0)); break;
    case 'monsterPower': prog = (typeof talentThreatTotal === 'function') ? 100 + talentThreatTotal() : 100; break;
    case 'skillUlt': {
      var sp = String(def.param || '').split(':');
      var pick = (typeof sgUltPickOf === 'function') ? sgUltPickOf(p.skills2 && p.skills2.ult, sp[0]) : null;
      prog = (pick && pick.id === sp[1]) ? pick.lv : 0;
      break;
    }
  }
  return { prog: prog, goal: goal };
}

/* ---- 判定與解鎖 ---- */
function achUnlock(def) {
  var st = achState();
  st.got[def.id] = Date.now();
  UI.dirty.achv = true;
  blog(STR(2227, def.name), 'good');
  if (typeof shimPushEvent === 'function') shimPushEvent('notice', { key: 'achievementUnlocked', data: { id: def.id } });
}
function achCheck() {
  if (typeof ACHIEVEMENTS === 'undefined' || !G || !G.player) return 0;
  var st = achState(), n = 0;
  var lv = Number(G.player.level) || 0;
  if (lv > achStat('maxLevel')) st.st.maxLevel = lv;
  achBeginPass();
  try {
    for (var i = 0; i < ACHIEVEMENTS.length; i++) {
      var def = ACHIEVEMENTS[i];
      if (st.got[def.id]) continue;
      var r = achProgress(def);
      if (r.goal > 0 ? r.prog >= r.goal : r.prog > 0) { achUnlock(def); n++; }
    }
  } finally { achEndPass(); }
  return n;
}
function achTick(dt) {
  _achAcc += dt;
  if (_achAcc < ACH_CHECK_SEC) return;
  _achAcc = 0;
  achCheck();
}

/* ---- achv 面板投影：只送動態欄位；名稱、圖示、條件文字由主執行緒讀共載的 ACHIEVEMENTS ---- */
function achPanelData() {
  if (typeof ACHIEVEMENTS === 'undefined' || !G || !G.player) return { list: [], got: 0 };
  var st = achState(), list = [], got = 0;
  achBeginPass();
  try {
    for (var i = 0; i < ACHIEVEMENTS.length; i++) {
      var def = ACHIEVEMENTS[i];
      var at = st.got[def.id] || 0;
      if (at) got++;
      var r = achProgress(def);
      list.push({ id: def.id, at: at, prog: at ? r.goal : Math.min(r.prog, r.goal), goal: r.goal });
    }
  } finally { achEndPass(); }
  return { list: list, got: got };
}
