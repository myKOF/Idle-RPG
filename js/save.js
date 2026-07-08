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
  // 技能點改由等級即時推導（availableSkillPoints），無需在此補發
  var def = newGameState();
  
  // 防止玩家手動降級（刪除）的初始技能，在讀檔時被 mergeDefaults 誤判為缺漏而自動補回 1 級
  if (data.player && data.player.skills) {
    delete def.player.skills.powerSlash;
    delete def.player.skills.arcaneBurst;
  }
  
  mergeDefaults(data, def);
  // 確保裝備槽位齊全
  SLOT_LIST.forEach(function (s) {
    if (data.equipment[s] === undefined) data.equipment[s] = null;
  });
  // 品質擴充至 8 階：篩選規則陣列補齊（新階預設保留）
  if (data.factory && data.factory.filter && data.factory.filter.actions) {
    while (data.factory.filter.actions.length < RARITIES.length) data.factory.filter.actions.push('keep');
  }
  // 舊版寶石（{1..5: 數量}）→ 轉換為隨機種類
  var gemTypeKeys = Object.keys(GEM_TYPES);
  for (var lv = 1; lv <= GEM_MAX_LEVEL; lv++) {
    var n = data.player.gems[lv];
    if (typeof n === 'number') {
      delete data.player.gems[lv];
      for (var i = 0; i < n; i++) {
        var t = gemTypeKeys[Math.floor(Math.random() * gemTypeKeys.length)];
        if (!data.player.gems[t]) data.player.gems[t] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        data.player.gems[t][lv] = (data.player.gems[t][lv] || 0) + 1;
      }
    }
  }
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
  // 掉落：依「物品掉落表」計算各品質期望件數（高品質優先實體化，最多 30 件，其餘折算碎片）
  var rates = dropRatesFor(FIELD_DROP_TABLE, s);
  var lootMult = 1 + st.loot / 100;
  var realDrops = 0, scrapExtra = 0, slotsLeft = 30;
  for (var r = rates.length - 1; r >= 0; r--) {
    if (!rates[r]) continue;
    var cnt = Math.floor(kills * rates[r] * lootMult / 100);
    if (chance((kills * rates[r] * lootMult) % 100)) cnt++;
    var real = Math.min(cnt, slotsLeft);
    for (var i = 0; i < real; i++) pushConveyor(makeEquipment(s, { rarity: r }));
    slotsLeft -= real;
    realDrops += real;
    scrapExtra += Math.max(0, cnt - real) * Math.round(3 * RARITIES[r].salv);
  }
  G.player.scrap += scrapExtra;

  var hrs = Math.floor(elapsed / 3600), mins = Math.floor((elapsed % 3600) / 60);
  blog('🌙 離線收益（' + (hrs ? hrs + ' 小時 ' : '') + mins + ' 分鐘）：擊殺 ' + fmt(kills) +
    '、金幣 +' + fmt(gold) + '、經驗 +' + fmt(xp) +
    '、裝備 x' + realDrops + ' 已送入輸送帶' + (scrapExtra ? '、碎片 +' + fmt(scrapExtra) : ''), 'good');
}
