'use strict';
/* ============ 存檔 / 讀檔 / 離線收益 ============ */

var SAVE_KEY = 'infinite_conquest_save_v1';
// 重置/匯入後重新整理前，須阻止 beforeunload 自動存檔把舊狀態寫回去
var _saveSuppressed = false;

function saveGame() {
  if (_saveSuppressed) return;
  try {
    G.savedAt = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(G));
  } catch (e) { /* 容量滿或隱私模式，靜默失敗 */ }
}

function loadGame() {
  try {
    var raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    var data = JSON.parse(raw);
    if (!data || data.version !== 1) return null;
    return migrateSave(data);
  } catch (e) { return null; }
}

// 以預設狀態為底，深補缺漏欄位（存檔向前相容）
function migrateSave(data) {
  var def = newGameState();
  mergeDefaults(data, def);
  // 確保裝備槽位齊全
  SLOT_LIST.forEach(function (s) {
    if (data.equipment[s] === undefined) data.equipment[s] = null;
  });
  data.tower.active = false; // 讀檔時不可能處於高塔戰鬥
  return data;
}
function mergeDefaults(target, def) {
  for (var k in def) {
    if (target[k] === undefined || target[k] === null) {
      if (def[k] !== null && typeof def[k] === 'object') {
        target[k] = JSON.parse(JSON.stringify(def[k]));
      } else if (target[k] === undefined) {
        target[k] = def[k];
      }
    } else if (typeof def[k] === 'object' && def[k] !== null && !Array.isArray(def[k]) &&
               typeof target[k] === 'object' && !Array.isArray(target[k])) {
      mergeDefaults(target[k], def[k]);
    }
  }
}

function resetGame() {
  _saveSuppressed = true;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
}

function exportSave() {
  saveGame();
  return btoa(unescape(encodeURIComponent(JSON.stringify(G))));
}
function importSave(str) {
  try {
    var data = JSON.parse(decodeURIComponent(escape(atob(str.trim()))));
    if (!data || data.version !== 1) return false;
    _saveSuppressed = true;
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    location.reload();
    return true;
  } catch (e) { return false; }
}

/* ---- 離線收益（上限 8 小時） ---- */
function applyOfflineProgress() {
  if (!G.savedAt) return;
  var elapsed = (Date.now() - G.savedAt) / 1000;
  if (elapsed < 60) return; // 一分鐘內不計
  elapsed = Math.min(elapsed, 8 * 3600);

  var st = getStats();
  var s = Math.max(1, G.stage.current);
  var m = monsterStatsFor(s, false);
  // 估算單殺時間：怪物血量 / 玩家 DPS（含爆擊期望），效率 50%
  var critMult = 1 + st.critRate / 100 * (st.critDmg / 100 - 1);
  var dps = Math.max(1, st.atk * (1 - defReduction(m.def, st.level)) * st.aspd * critMult);
  var killTime = m.hp / dps + RESPAWN_DELAY;
  var kills = Math.floor(elapsed / killTime * 0.5);
  if (kills < 1) return;
  kills = Math.min(kills, 20000);

  var gold = Math.round(m.gold * kills * (1 + st.goldBonus / 100));
  var xp = Math.round(m.xp * kills * (1 + st.xpBonus / 100));
  G.player.gold += gold;
  gainXp(xp);
  // 掉落的裝備直接以生產線邏輯即時處理（最多 30 件實體，其餘折算碎片）
  var drops = Math.floor(kills * 0.28);
  var realDrops = Math.min(drops, 30);
  for (var i = 0; i < realDrops; i++) {
    pushConveyor(makeEquipment(s, {}));
  }
  var scrapExtra = Math.max(0, drops - realDrops) * 3;
  G.player.scrap += scrapExtra;

  var hrs = Math.floor(elapsed / 3600), mins = Math.floor((elapsed % 3600) / 60);
  blog('🌙 離線收益（' + (hrs ? hrs + ' 小時 ' : '') + mins + ' 分鐘）：擊殺 ' + fmt(kills) +
    '、金幣 +' + fmt(gold) + '、經驗 +' + fmt(xp) +
    '、裝備 x' + realDrops + ' 已送入輸送帶' + (scrapExtra ? '、碎片 +' + fmt(scrapExtra) : ''), 'good');
}
