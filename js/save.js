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
  var hadZone = data.stage && data.stage.zone !== undefined; // 需在 mergeDefaults 前判斷
  var hadSkillDmgV2 = !!data.skillDmgV2;                     // 需在 mergeDefaults 前判斷（merge 會補 true）
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
  // 戰鬥場景系統：舊存檔進度歸入「草原」
  if (!hadZone) {
    data.stage.zone = 'plains';
    data.zoneProgress.plains = { current: data.stage.current || 1, best: data.stage.best || 1 };
  }
  /* 2026-07-09 技能傷害全面重調：一般技能定義（SKILLS）已直接改數值，
     但玩家自創融合技的 fx 是存檔快照 → 一次性等比加成（越強加越多，最高 +300%）。 */
  if (!hadSkillDmgV2 && data.player.fusions && data.player.fusions.length) {
    data.player.fusions.forEach(function (fs) {
      if (!fs.fx || !fs.fx.base) return;
      var mult = fs.fx.base >= 700 ? 4 : (fs.fx.base >= 400 ? 3.5 : 3);
      fs.fx.base = Math.round(fs.fx.base * mult);
      if (fs.fx.per) fs.fx.per = Math.round(fs.fx.per * mult * 10) / 10;
    });
  }
  data.tower.active = false; // 讀檔時不可能處於高塔戰鬥
  if (!data.settings) data.settings = { compareEq: false };
  
  // 修正舊有裝備名稱前綴
  var fixName = function(it) {
    if (!it) return;
    it.name = RARITY_PREFIX[it.rarity] + it.name.replace(/^(粗糙的|堅實的|精工的|奇異的|大師級|傳世的|神鑄的|創世的|普通的|精良的|稀有的|獨特的|史詩的|傳說的|神話的)/, '');
  };
  for (var k in data.equipment) fixName(data.equipment[k]);
  data.inventory.forEach(fixName);
  data.factory.conveyor.forEach(fixName);
  data.factory.synthBuffer.forEach(fixName);

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

/* ---- 離線收益（時間上限與擊殺估算公式 → js/formula.js §10） ---- */
function applyOfflineProgress() {
  if (!G.savedAt) return;
  var elapsed = (Date.now() - G.savedAt) / 1000;
  if (elapsed < 60) return; // 一分鐘內不計
  elapsed = Math.min(elapsed, OFFLINE_MAX_HOURS * 3600);

  var st = getStats();
  var est = offlineKillEstimate(elapsed);
  var kills = est.kills, m = est.monster, s = est.stage;
  if (kills < 1) return;

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
