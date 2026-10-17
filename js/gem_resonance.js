'use strict';
/* ============ 寶石共鳴（兩端共載：主執行緒與模擬 Worker） ============
   資料表在 js/gem_resonance_data.js（配置表 Gem_resonance）。本檔負責：
     1. 版面與相鄰關係（純函式，不碰 G）
     2. 共鳴對屬性的貢獻（resonanceEntries，computeStats 與 UI 預覽共用同一份）
     3. 鑲嵌／取下／升級（Worker 端指令實作，操作 G.player.resonance）

   存檔：G.player.resonance = { holes: { '區域:孔': { gems: [{type, level}], lv } } }。
   只存「有內容」的孔；區域與孔以版面編號定址（區域 0~5＝外圍區，6＝中央區；孔 0＝中心，1~6＝外圈）。
   鑲進孔的寶石由庫存扣除（與裝備鑲嵌同一套），取下退回庫存。

   屬性：孔裡的每顆寶石提供自己的能力；孔等級 L 另外讓「相鄰孔的寶石」多算
   min(L × perLevelPct, maxPct)%。相鄰＝同一區域內：中心孔與六個外圈孔互為相鄰，
   外圈孔與左右兩個外圈孔相鄰。不跨區域。 */

var RESONANCE_RING_SIZE = 6;
var RESONANCE_HOLE_COUNT = RESONANCE_RING_SIZE + 1;

function resonanceRegionCount() { return GEM_RESONANCE_REGIONS.length; }
function resonanceMaxHoleLevel() { return GEM_RESONANCE_UPGRADES.length; }
function resonanceHoleKey(region, hole) { return region + ':' + hole; }
function resonanceValidHole(region, hole) {
  return Number.isInteger(region) && Number.isInteger(hole) &&
    region >= 0 && region < resonanceRegionCount() && hole >= 0 && hole < RESONANCE_HOLE_COUNT;
}

/* 相鄰孔（同區域）。孔 0 與外圈互連；外圈孔 h（1~6）與前後外圈孔及中心相鄰。 */
function resonanceNeighbors(hole) {
  var out = [];
  if (hole === 0) {
    for (var i = 1; i <= RESONANCE_RING_SIZE; i++) out.push(i);
    return out;
  }
  out.push(0);
  out.push(hole === 1 ? RESONANCE_RING_SIZE : hole - 1);
  out.push(hole === RESONANCE_RING_SIZE ? 1 : hole + 1);
  return out;
}

function resonanceHoleCap(region, hole) {
  return hole === 0 ? GEM_RESONANCE_REGIONS[region].centerCap : 1;
}
function resonanceHoleMinLevel(region, hole) {
  return GEM_RESONANCE_REGIONS[region].minLv[hole];
}
/* 這個區域能否鑲這種寶石（只看種類限制，不看是否開放）。 */
function resonanceTypeAllowed(region, type) {
  var types = GEM_RESONANCE_REGIONS[region].types;
  return !types || types.indexOf(type) !== -1;
}
/* 孔等級對應的相鄰加成（倍率，0~maxPct/100）。 */
function resonanceBonusMult(holeLevel) {
  var pct = Math.min(Math.max(0, holeLevel) * GEM_RESONANCE_SETTINGS.perLevelPct, GEM_RESONANCE_SETTINGS.maxPct);
  return pct / 100;
}

/* ---- 狀態讀取（容許缺漏欄位）---- */
function resonanceHoleState(state, region, hole) {
  var h = state && state.holes && state.holes[resonanceHoleKey(region, hole)];
  return { gems: (h && Array.isArray(h.gems)) ? h.gems : [], lv: (h && h.lv) || 0 };
}

/* 共鳴對屬性的貢獻清單：[{ type, level, mult }]，每項＝「這種寶石的 level 階能力 × mult」。
   自己孔裡的寶石 mult＝1；孔等級帶來的相鄰加成逐顆寶石各列一項。 */
function resonanceEntries(state) {
  var out = [];
  if (!state || !state.holes) return out;
  for (var r = 0; r < resonanceRegionCount(); r++) {
    for (var h = 0; h < RESONANCE_HOLE_COUNT; h++) {
      var self = resonanceHoleState(state, r, h);
      if (!self.gems.length && !self.lv) continue;
      self.gems.forEach(function (g) { out.push({ type: g.type, level: g.level, mult: 1 }); });
      var bonus = resonanceBonusMult(self.lv);
      if (!(bonus > 0)) continue;
      resonanceNeighbors(h).forEach(function (nh) {
        resonanceHoleState(state, r, nh).gems.forEach(function (g) {
          out.push({ type: g.type, level: g.level, mult: bonus });
        });
      });
    }
  }
  return out;
}

/* 升級到下一級的花費；已滿級回 null。 */
function resonanceUpgradeCost(holeLevel) {
  return holeLevel >= resonanceMaxHoleLevel() ? null : GEM_RESONANCE_UPGRADES[holeLevel];
}

/* ---- Worker 端指令實作（回傳 null＝成功，字串＝錯誤訊息）---- */
function resonanceEnsure() {
  var p = G.player;
  if (!p.resonance || typeof p.resonance !== 'object') p.resonance = { holes: {} };
  if (!p.resonance.holes || typeof p.resonance.holes !== 'object') p.resonance.holes = {};
  return p.resonance;
}
function resonanceTouched() {
  if (typeof markStatsDirty === 'function') markStatsDirty();
  UI.dirty.gems = true; UI.dirty.header = true;
}

/* 鑲嵌：level 省略時取庫存裡「達到該孔最低階」的最低一階（不浪費高階寶石）。 */
function socketResonanceGem(region, hole, type, level) {
  if (!resonanceValidHole(region, hole)) return '無效的共鳴孔位';
  if (!GEM_TYPES[type] || !isGemEnabled(type)) return '此寶石已關閉或不存在，無法鑲嵌';
  if (!resonanceTypeAllowed(region, type)) return GEM_RESONANCE_REGIONS[region].name + '區不能鑲這種寶石';
  var min = resonanceHoleMinLevel(region, hole);
  var lv = 0;
  if (level != null) {
    if (!Number.isInteger(level) || level < 1 || level > GEM_FORGE_MAX_LEVEL) return '無效寶石階級';
    if (level < min) return '此孔需要 ' + GEM_NAMES[min] + '以上的寶石';
    if (gemCount(type, level) > 0) lv = level;
  } else {
    for (var l = min; l <= GEM_FORGE_MAX_LEVEL; l++) { if (gemCount(type, l) > 0) { lv = l; break; } }
  }
  if (!lv) return '沒有符合階級的寶石';
  var st = resonanceEnsure();
  var key = resonanceHoleKey(region, hole);
  var slot = st.holes[key] || (st.holes[key] = { gems: [], lv: 0 });
  if (!Array.isArray(slot.gems)) slot.gems = [];
  if (slot.gems.length >= resonanceHoleCap(region, hole)) return '此孔已滿，請先取下寶石';
  addGem(type, lv, -1);
  slot.gems.push({ type: type, level: lv });
  resonanceTouched();
  return null;
}

/* 取下：index 為孔內第幾顆。孔等級保留（升級是孔的資產，不跟著寶石走）。 */
function unsocketResonanceGem(region, hole, index) {
  if (!resonanceValidHole(region, hole)) return '無效的共鳴孔位';
  var slot = resonanceEnsure().holes[resonanceHoleKey(region, hole)];
  if (!slot || !Array.isArray(slot.gems) || !slot.gems[index]) return '此處沒有寶石';
  var g = slot.gems.splice(index, 1)[0];
  addGem(g.type, g.level, 1);
  if (!slot.gems.length && !slot.lv) delete resonanceEnsure().holes[resonanceHoleKey(region, hole)];
  resonanceTouched();
  return null;
}

/* 升級要扣哪一種寶石：孔裡有寶石就用它的種類；空孔則從本區允許且開放的種類中，挑庫存夠付的、存量最多的一種。
   countOf(type, level) 取庫存數量（Worker 讀 G、UI 讀面板快照）；沒有任何種類付得起回 null。 */
function resonanceUpgradePayType(region, slot, cost, countOf) {
  if (slot && slot.gems && slot.gems.length) return slot.gems[0].type;
  var best = null, bestN = 0;
  Object.keys(GEM_TYPES).forEach(function (t) {
    if (!isGemEnabled(t) || !resonanceTypeAllowed(region, t)) return;
    var n = countOf(t, cost.gemLv);
    if (n >= cost.gemCount && n > bestN) { best = t; bestN = n; }
  });
  return best;
}

/* 升級：金幣＋指定階級的寶石（種類見 resonanceUpgradePayType）。孔不必鑲寶石也能升級。 */
function upgradeResonanceHole(region, hole) {
  if (!resonanceValidHole(region, hole)) return '無效的共鳴孔位';
  var st = resonanceEnsure();
  var key = resonanceHoleKey(region, hole);
  var slot = st.holes[key];
  var cost = resonanceUpgradeCost((slot && slot.lv) || 0);
  if (!cost) return '此孔已達等級上限';
  if (G.player.gold < cost.gold) return '金幣不足（需要 ' + fmt(cost.gold) + '）';
  var type = resonanceUpgradePayType(region, slot, cost, gemCount);
  if (!type) return '需要 ' + cost.gemCount + ' 顆' + GEM_NAMES[cost.gemLv] + '寶石（本區可用種類），庫存不足';
  if (gemCount(type, cost.gemLv) < cost.gemCount) {
    return '「' + GEM_NAMES[cost.gemLv] + GEM_TYPES[type].name + '」不足 ' + cost.gemCount + ' 顆';
  }
  G.player.gold -= cost.gold;
  addGem(type, cost.gemLv, -cost.gemCount);
  if (!slot) slot = st.holes[key] = { gems: [], lv: 0 };
  slot.lv = (slot.lv || 0) + 1;
  resonanceTouched();
  return null;
}
