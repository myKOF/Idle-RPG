'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
/* ============ 遺物（2026-11-09） ============
   資料表 js/relic_data.js（配置表 Relics）；本檔兩端共載：
     Worker   取得／升級遺物、各系統讀效果數值
     主執行緒 遺物頁與費用預覽（強化碎片、洗煉精華、背包擴充…）讀同一組數值

   存檔：G.player.relics = { 編號: { lv: 目前等級（0＝尚未解鎖）, n: 尚未用掉的件數 } }。
   取得一件＝n+1；尚未解鎖時，件數一到第 1 級的「升級數量」就自動解鎖（第 1 級預設 1，所以拿到就是 Lv.1）。
   之後升級由玩家在遺物頁按下（relic.upgrade），消耗下一級的「升級數量」。滿級後件數照樣累積，不會消失。

   各系統一律透過 relicValue(效果鍵) 讀「目前等級的數值強度」（沒有這件遺物＝0），
   不得自己翻 RELICS 或存檔。效果鍵的單位與接線位置見下方 RELIC_EFFECT_KEYS 的說明。

   寶箱由使用者另外實作，本檔只提供：relicGrant（給遺物）、relicRandomId（抽一件）、
   relicChestSpeedMult／relicChestRelicChanceMult／relicChestDoubleChance（三件寶箱遺物的數值）。 */

/* 效果鍵（新增鍵要同步 tools/config_tables.cjs 的 RELIC_EFFECT_KEYS）。單位與接線位置：
     offlineHours 小時｜save.js applyOfflineProgress 離線上限（relicOfflineMaxHours）
     offlineXp %｜save.js 離線經驗　　offlineEquipDrop %｜save.js 離線裝備掉落率
     returnBuffMinutes 分鐘｜save.js 離線結算時啟動（relicStartReturnBuff）、formula.js computeStats 加成
     offlineTowerReward 小時｜save.js 離線結算 → tower.js grantTowerBossRewards
     salvageScrap／salvageEssence／salvageGold %｜factory.js doSalvage
     salvageXp %｜factory.js doSalvage（與知識核心零件相加）　salvageGemChance %｜同上（與寶石採集器相加）
     synthBuffer 個｜formula.js synthBufCap
     inventoryMax 格｜formula.js inventoryExpandMax　　inventoryExpandDiscount %｜formula.js inventoryExpandCost
     merchantDiscount %｜item.js merchantItemPrice　　merchantHighGem／merchantHighEquip／merchantHighRune %｜item.js 神祕商人供應器
     merchantTicketDrop %｜tower.js grantTowerBossRewards 邀請券
     gemComposeSave %｜item.js composeGems　　runeComposeSave／runeDismantleBonus／runeEraseKeep %｜runeword.js
     rerollEssenceDiscount %｜formula.js rerollCost　　upgradeScrapDiscount %｜formula.js upgradeCost
     upgradeDouble %｜factory.js tryUpgrade　　forgeDustRefund %｜forge.js doForge　　imprintLegendary %｜forge.js forgeApplyImprint
     towerAutoSpeed %｜sim.worker.js simStep、tower.js towerAutoSpeedMult、ui.js 結算倒數　　towerBossTime 秒｜data.js towerTimeLimitWithTalents
     chestSpeed／chestRelicChance／chestDouble %｜寶箱系統（另外實作）：relicChest* 三支 */
var RELIC_EFFECT_KEYS = ['offlineHours', 'offlineXp', 'offlineEquipDrop', 'returnBuffMinutes', 'offlineTowerReward',
  'salvageScrap', 'salvageEssence', 'salvageXp', 'salvageGold', 'synthBuffer', 'salvageGemChance',
  'inventoryMax', 'inventoryExpandDiscount',
  'merchantDiscount', 'merchantHighGem', 'merchantHighEquip', 'merchantHighRune', 'merchantTicketDrop',
  'gemComposeSave', 'runeComposeSave', 'runeDismantleBonus', 'runeEraseKeep',
  'rerollEssenceDiscount', 'upgradeScrapDiscount', 'upgradeDouble', 'forgeDustRefund', 'imprintLegendary',
  'towerAutoSpeed', 'towerBossTime',
  'chestSpeed', 'chestRelicChance', 'chestDouble'];

/* 固定參數（Excel 設計稿的文字裡寫死的數字；要調再搬進參數表）。 */
var RELIC_RETURN_BUFF_PCT = 10;          // 晨鐘：回到遊戲後經驗值與掉寶率 +10%
var RELIC_FORGE_REFUND_RATE = 0.25;      // 精煉神石：返還本次消耗神性之石的 25%
var RELIC_MERCHANT_HIGH_GEM_LEVEL = 7;   // 熔晶坩堝：7 級（含）以上寶石
var RELIC_MERCHANT_HIGH_EQUIP_RARITY = 5; // 神祕裝備券：傳說（R5）以上
var RELIC_MERCHANT_HIGH_RUNE_TIER = 19;  // 符文刻印：19 階（含）以上符文

var RELIC_BY_ID = {};
var RELIC_BY_EFFECT = {};
(function indexRelics() {
  if (typeof RELICS === 'undefined') return;
  for (var i = 0; i < RELICS.length; i++) {
    RELIC_BY_ID[RELICS[i].id] = RELICS[i];
    RELIC_BY_EFFECT[RELICS[i].effect] = RELICS[i];
  }
})();

/* 遺物存檔：Worker 讀 G.player.relics；主執行緒沒有 G，讀 header 面板（它投影整個 player）。 */
function relicStore() {
  if (typeof G !== 'undefined' && G && G.player) {
    if (!G.player.relics || typeof G.player.relics !== 'object' || Array.isArray(G.player.relics)) G.player.relics = {};
    return G.player.relics;
  }
  if (typeof peekUiPanelData === 'function') {
    var h = peekUiPanelData('header');
    if (h && h.player && h.player.relics && typeof h.player.relics === 'object') return h.player.relics;
  }
  return {};
}
function relicMaxLevel(relic) { return relic && Array.isArray(relic.levels) ? relic.levels.length : 0; }
/* 某件遺物目前的 { lv, n }；壞值一律收斂成合法範圍（只讀，不寫回）。 */
function relicEntry(id, store) {
  var relic = RELIC_BY_ID[id];
  var raw = (store || relicStore())[id];
  var lv = Math.floor(Number(raw && raw.lv) || 0), n = Math.floor(Number(raw && raw.n) || 0);
  return { lv: relic ? Math.max(0, Math.min(lv, relicMaxLevel(relic))) : 0, n: Math.max(0, n) };
}
function relicLevel(id, store) { return relicEntry(id, store).lv; }
/* 效果數值：這個效果鍵的遺物目前等級的「數值強度」，沒有解鎖＝0。 */
function relicValue(effect, store) {
  var relic = RELIC_BY_EFFECT[effect];
  if (!relic) return 0;
  var lv = relicLevel(relic.id, store);
  return lv > 0 ? Math.max(0, Number(relic.levels[lv - 1].value) || 0) : 0;
}
/* 升到下一級要幾件；已滿級回 0。 */
function relicNextCost(id, store) {
  var relic = RELIC_BY_ID[id];
  if (!relic) return 0;
  var lv = relicLevel(id, store);
  return lv >= relicMaxLevel(relic) ? 0 : relic.levels[lv].cost;
}
function relicNumText(v) { return String(Math.round(Number(v) * 1000) / 1000); }
/* 第 lv 級的效果說明（{v} 代入數值強度）；lv 超出範圍回空字串。 */
function relicDescAt(relic, lv) {
  var row = relic && relic.levels[lv - 1];
  return row ? String(row.desc).replace(/\{v\}/g, relicNumText(row.value)) : '';
}

/* ---- Worker：取得／升級 ---- */
/* 給 n 件遺物（寶箱、GM）。回傳實際給了幾件；未解鎖且件數夠時自動解鎖第 1 級。 */
function relicGrant(id, n) {
  var relic = RELIC_BY_ID[id];
  n = Math.floor(Number(n) || 0);
  if (!relic || n <= 0) return 0;
  var store = relicStore(), cur = relicEntry(id, store);
  cur.n = Math.min(Number.MAX_SAFE_INTEGER, cur.n + n);
  if (cur.lv === 0 && cur.n >= relic.levels[0].cost) { cur.n -= relic.levels[0].cost; cur.lv = 1; relicEffectChanged(); }
  store[id] = cur;
  if (typeof UI !== 'undefined' && UI.dirty) UI.dirty.header = true;
  return n;
}
/* 升一級：消耗下一級的升級數量。成功回 null，失敗回錯誤字串。 */
function relicUpgrade(id) {
  var relic = RELIC_BY_ID[id];
  if (!relic) return STR(2450);
  var store = relicStore(), cur = relicEntry(id, store);
  if (cur.lv === 0) return STR(2451);
  if (cur.lv >= relicMaxLevel(relic)) return STR(2452);
  var cost = relic.levels[cur.lv].cost;
  if (cur.n < cost) return STR(2453, cost, cur.n);
  cur.n -= cost; cur.lv += 1;
  store[id] = cur;
  relicEffectChanged();
  if (typeof blog === 'function') blog(STR(2454, relic.name, cur.lv), 'good');
  if (typeof UI !== 'undefined' && UI.dirty) UI.dirty.header = true;
  return null;
}
/* 等級變動後：會進屬性的效果（晨鐘）要重算屬性，背包上限要重畫。 */
function relicEffectChanged() {
  if (typeof markStatsDirty === 'function') markStatsDirty();
  if (typeof UI !== 'undefined' && UI.dirty) { UI.dirty.header = true; UI.dirty.inv = true; UI.dirty.tower = true; }
}
/* 寶箱用：等機率抽一件遺物的編號（寶箱要自訂權重時再擴充）。 */
function relicRandomId() {
  if (typeof RELICS === 'undefined' || !RELICS.length) return 0;
  return RELICS[Math.floor(Math.random() * RELICS.length)].id;
}

/* ---- 各系統共用的換算 ---- */
function relicPct(effect) { return relicValue(effect) / 100; }
/* 機率判定：數值強度是百分比。 */
function relicRoll(effect) {
  var v = relicValue(effect);
  return v > 0 && Math.random() * 100 < v;
}
/* 打折：回傳原價 ×(1 − 數值%)，至少 0；整數費用用 Math.round 以外的取整時由呼叫端處理。 */
function relicDiscount(effect, amount) {
  return amount * Math.max(0, 1 - relicPct(effect));
}
/* 小數產量的機率取整：3.4 → 3（60%）或 4（40%），期望值不變。 */
function relicRoundChance(x) {
  var base = Math.floor(x);
  return base + (Math.random() < x - base ? 1 : 0);
}
/* 離線收益上限（小時，含遺物）。 */
function relicOfflineMaxHours() {
  return (typeof OFFLINE_MAX_HOURS === 'number' ? OFFLINE_MAX_HOURS : 24) + relicValue('offlineHours');
}
/* 封魔塔連續挑戰的速度倍率（1＝原速）。 */
function relicTowerAutoSpeedMult() { return 1 + relicPct('towerAutoSpeed'); }

/* ---- 晨鐘：回到遊戲後的限時加成 ----
   離線結算成功時開始計時（G.player.relicReturnUntil，絕對時間毫秒，隨存檔）；
   屬性快取在到期那一刻要作廢，由 relicTick 檢查。 */
function relicStartReturnBuff(now) {
  var minutes = relicValue('returnBuffMinutes');
  if (!(minutes > 0) || typeof G === 'undefined' || !G || !G.player) return 0;
  G.player.relicReturnUntil = (now || Date.now()) + minutes * 60000;
  _relicBuffWasActive = true;   // 讓 relicTick 一定看得到「到期」這個轉變，即使開始與到期之間沒跑過 tick
  if (typeof markStatsDirty === 'function') markStatsDirty();
  return minutes;
}
function relicReturnBuffActive(now) {
  var p = (typeof G !== 'undefined' && G && G.player) ? G.player : null;
  if (!p) {
    var h = typeof peekUiPanelData === 'function' ? peekUiPanelData('header') : null;
    p = h && h.player;
  }
  return !!(p && Number(p.relicReturnUntil) > (now || Date.now()));
}
function relicReturnBuffPct() { return relicReturnBuffActive() ? RELIC_RETURN_BUFF_PCT : 0; }
var _relicBuffWasActive = false;
function relicTick() {
  var on = relicReturnBuffActive();
  if (on !== _relicBuffWasActive) {
    _relicBuffWasActive = on;
    if (typeof markStatsDirty === 'function') markStatsDirty();
    if (typeof UI !== 'undefined' && UI.dirty) UI.dirty.header = true;
  }
}

/* ---- 神祕商人：高級品出現率（與原機率相乘） ----
   權重表 [[值, 權重], …] 中符合條件的值，權重 ×(1 + 數值%)。 */
function relicBoostWeights(pairs, effect, isHigh) {
  var mult = 1 + relicPct(effect);
  if (mult === 1) return pairs;
  return pairs.map(function (p) { return isHigh(p[0]) ? [p[0], p[1] * mult] : p; });
}

/* ---- 寶箱介面（寶箱系統另外實作） ---- */
function relicChestSpeedMult() { return 1 + relicPct('chestSpeed'); }
function relicChestRelicChanceMult() { return 1 + relicPct('chestRelicChance'); }
function relicChestDoubleChance() { return relicValue('chestDouble'); }

/* ---- 遺物頁（主執行緒）用的整理 ---- */
function relicCategories() {
  var cats = [], seen = {};
  (typeof RELICS !== 'undefined' ? RELICS : []).forEach(function (r) {
    if (!seen[r.cat]) { seen[r.cat] = { name: r.cat, list: [] }; cats.push(seen[r.cat]); }
    seen[r.cat].list.push(r);
  });
  return cats;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RELIC_EFFECT_KEYS: RELIC_EFFECT_KEYS, relicValue: relicValue, relicGrant: relicGrant, relicUpgrade: relicUpgrade };
}
