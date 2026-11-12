'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
/* ============ 熔爐寶箱（兩端共載） ============
   資料：config/Excel/Chest.xlsx → js/chest_data.js 的 CHESTS（欄位說明見該檔檔頭與 docs/CHEST_SYSTEM.md）。
   存檔：G.player.chests = { 編號: { lv, xp, n, on } }
     lv 寶箱等級、xp 目前累積的鍛造經驗（未滿一箱的零頭）、n 持有數量（上限 CHEST_MAX_COUNT）、on 是否已解鎖。
   流程：
     拆解任何裝備（factory.js doSalvage：熔爐、背包手動拆解、滿載自動拆解、離線熔爐補算）→ chestGainSalvageXp(品質)
       → 各寶箱依「目前等級列」的 R0～R11 拆解經驗累加；第一次拿到經驗即解鎖；每滿所需經驗得 1 個。
     離線期間熔爐佇列已滿而折算碎片的裝備，在 save.js 同樣呼叫 chestGainSalvageXp（視同已拆解）。
     開啟（chest.open）：每個寶箱抽「開啟掉落數」次，每次依權重選一格掉落；遺物三件寶箱效果在此套用：
       幸運寶箱 relicChestSpeedMult（經驗倍率）、幸運符 relicChestRelicChanceMult（遺物格權重倍率）、
       雙開戒 relicChestDoubleChance（每開一個寶箱有機率獎勵加倍）。
     升級（chest.upgrade）：金幣 chestUpgradeCost ＝ a ＋ b^目前等級。
   兩端共載：主執行緒沒有 G，只用 chestEntry／chestUpgradeCost／chestDropOdds／chestRewardLabel 這些純函式讀面板快照；
   會改狀態的函式（chestGainSalvageXp／chestOpen／chestUpgrade／sanitizeChests）只在 Worker 執行。 */

var CHEST_MAX_COUNT = 9999;   // 每種寶箱最多持有數（使用者規格）
var CHEST_MAX_LEVEL = 20;     // 寶箱最高等級（使用者規格；實際上限＝min(本值, 表格等級列數)）
var CHEST_BY_ID = {};
(function () {
  if (typeof CHESTS === 'undefined') return;
  for (var i = 0; i < CHESTS.length; i++) CHEST_BY_ID[CHESTS[i].id] = CHESTS[i];
})();

/* ---- 純函式（兩端） ---- */
function chestMaxLevel(def) { return def && def.levels ? Math.min(CHEST_MAX_LEVEL, def.levels.length) : 0; }
function chestLevelDef(def, lv) {
  var max = chestMaxLevel(def);
  if (!max) return null;
  return def.levels[Math.max(1, Math.min(max, Math.floor(Number(lv) || 1))) - 1];
}
/* 讀一筆存檔紀錄並正規化（不寫回）。初始解鎖的寶箱永遠視為已解鎖。 */
function chestEntry(def, raw) {
  var e = raw && typeof raw === 'object' ? raw : {};
  var xp = Number(e.xp);
  return {
    lv: Math.max(1, Math.min(chestMaxLevel(def) || 1, Math.floor(Number(e.lv) || 1))),
    xp: isFinite(xp) && xp > 0 ? xp : 0,
    n: Math.max(0, Math.min(CHEST_MAX_COUNT, Math.floor(Number(e.n) || 0))),
    on: !!(def && def.init) || e.on === true
  };
}
/* 升一級的金幣；已滿級回 null。 */
function chestUpgradeCost(def, lv) {
  if (!def || lv >= chestMaxLevel(def)) return null;
  return Math.ceil(Number(def.a) + Math.pow(Number(def.b), lv));
}
/* 最低一個會給這種寶箱經驗的裝備品質（未解鎖提示用）；整張表都是 0 回 -1。 */
function chestUnlockRarity(def) {
  var row = chestLevelDef(def, 1);
  if (!row) return -1;
  for (var r = 0; r < row.xp.length; r++) if (Number(row.xp[r]) > 0) return r;
  return -1;
}
function chestRelicMult() { return typeof relicChestRelicChanceMult === 'function' ? relicChestRelicChanceMult() : 1; }
/* 掉落候選與權重（遺物格套「幸運符」倍率）。 */
function chestDropPairs(row) {
  var mult = chestRelicMult(), out = [];
  if (!row || !Array.isArray(row.drops)) return out;
  for (var i = 0; i < row.drops.length; i++) {
    var d = row.drops[i], w = Number(d.w) || 0;
    if (d.k === 'relic') w *= mult;
    if (w > 0) out.push([d, w]);
  }
  return out;
}
/* 每次抽取各格的機率（%），介面提示用。 */
function chestDropOdds(row) {
  var pairs = chestDropPairs(row), total = 0, i;
  for (i = 0; i < pairs.length; i++) total += pairs[i][1];
  return pairs.map(function (p) { return { drop: p[0], pct: total > 0 ? p[1] / total * 100 : 0 }; });
}
function chestRangeText(r) { return r[0] === r[1] ? fmt(r[0]) : fmt(r[0]) + '~' + fmt(r[1]); }
/* 掉落格的名稱（不含數量），提示與日誌共用。 */
function chestDropName(d) {
  var p = d.p;
  switch (d.k) {
    case 'gold': return STR(105);
    case 'scrap': return STR(98);
    case 'essence': return STR(99);
    case 'ancientEssence': return STR(13);
    case 'dust': return STR(100);
    case 'soulOrigin': return STR(101);
    case 'invitation': return STR(2436);
    case 'skillXp': return STR(2496);
    case 'xp': return STR(1864);
    case 'gem': return STR(2500, chestRangeText(p));
    case 'rune': return STR(2499, chestRangeText(p));
    case 'equip': {
      var names = [];
      for (var r = p[0]; r <= p[1]; r++) if (RARITIES[r]) names.push(RARITIES[r].name);
      var label = STR(2497, names.join('／'));
      return d.p2 ? STR(2501, label, chestRangeText(d.p2)) : label;
    }
    case 'relic':
      if (p && typeof RELIC_BY_ID !== 'undefined' && RELIC_BY_ID[p[0]]) return RELIC_BY_ID[p[0]].name;
      return STR(2498);
  }
  return String(d.k);
}
function chestDropText(d) { return d.q[0] === 1 && d.q[1] === 1 ? chestDropName(d) : STR(2495, chestDropName(d), chestRangeText(d.q)); }
/* 開啟結果一筆的顯示名稱（開啟回傳的 rewards[]）。 */
function chestRewardName(rw) {
  switch (rw.k) {
    case 'gem': return (typeof gemLabel === 'function' && GEM_TYPES[rw.type]) ? gemLabel(rw.type, rw.lv) : STR(2500, rw.lv);
    case 'rune': return typeof runeLabel === 'function' ? runeLabel(rw.id) : String(rw.id);
    case 'equip': return STR(2497, RARITIES[rw.r] ? RARITIES[rw.r].name : String(rw.r));
    case 'relic': return (typeof RELIC_BY_ID !== 'undefined' && RELIC_BY_ID[rw.id]) ? RELIC_BY_ID[rw.id].name : STR(2498);
  }
  return chestDropName({ k: rw.k });
}
function chestRewardLabel(rw) { return STR(2495, chestRewardName(rw), fmt(rw.n)); }
function chestRewardsText(rewards) { return rewards.map(chestRewardLabel).join('、'); }

/* ---- Worker：狀態 ---- */
function chestStore() {
  var p = G.player;
  if (!p.chests || typeof p.chests !== 'object' || Array.isArray(p.chests)) p.chests = {};
  return p.chests;
}
/* 就地正規化並回傳同一個物件：呼叫端拿著的參照在巢狀流程（開箱→拆解→加經驗）裡必須一直有效。 */
function chestState(id) {
  var store = chestStore(), cur = store[id], norm = chestEntry(CHEST_BY_ID[id], cur);
  if (!cur || typeof cur !== 'object') { store[id] = norm; return norm; }
  cur.lv = norm.lv; cur.xp = norm.xp; cur.n = norm.n; cur.on = norm.on;
  return cur;
}
function chestLog(msg, cls) {
  if (typeof nflog === 'function') nflog(msg, cls);
  else if (typeof addLog === 'function') addLog('newforge-log', msg, cls, 50);
}
/* 加經驗並換算寶箱；回傳這次得到幾個。存滿時經驗停在滿格（開掉一個後下一次拆解立刻補上）。 */
function chestAddXp(def, st, gain) {
  var need = Number(chestLevelDef(def, st.lv).need) || 1;
  st.xp += gain;
  var got = Math.floor(st.xp / need);
  var room = CHEST_MAX_COUNT - st.n;
  if (got > room) got = room;
  st.n += got;
  st.xp = Math.max(0, st.xp - got * need);
  if (st.n >= CHEST_MAX_COUNT) st.xp = Math.min(st.xp, need);
  return got;
}
/* 拆解一件（或 count 件同品質）裝備：各寶箱依目前等級的拆解經驗累加。 */
function chestGainSalvageXp(rarity, count) {
  if (typeof CHESTS === 'undefined' || typeof G === 'undefined' || !G || !G.player) return;
  count = count === undefined ? 1 : Number(count);
  if (!(count > 0)) return;
  var mult = typeof relicChestSpeedMult === 'function' ? relicChestSpeedMult() : 1;
  var changed = false;
  for (var i = 0; i < CHESTS.length; i++) {
    var def = CHESTS[i], st = chestState(def.id), row = chestLevelDef(def, st.lv);
    var gain = row ? (Number(row.xp[rarity]) || 0) * count * mult : 0;
    if (!(gain > 0)) continue;
    if (!st.on) { st.on = true; chestLog(STR(2490, def.name), 'good'); }
    chestAddXp(def, st, gain);
    changed = true;
  }
  if (changed && typeof UI !== 'undefined' && UI.dirty) UI.dirty.newforge = true;
}
/* 離線結算用：記下各寶箱數量，結束時換算成「離線期間累積了幾個」。 */
function chestCountsSnapshot() {
  var out = {};
  if (typeof CHESTS === 'undefined' || !G || !G.player) return out;
  var store = G.player.chests || {};
  CHESTS.forEach(function (def) { out[def.id] = chestEntry(def, store[def.id]).n; });
  return out;
}
function chestGainsSince(before) {
  var gains = [];
  if (!before || typeof CHESTS === 'undefined') return gains;
  CHESTS.forEach(function (def) {
    var d = chestState(def.id).n - (before[def.id] || 0);
    if (d > 0) gains.push({ id: def.id, n: d });
  });
  return gains;
}
function chestGainsText(gains) {
  return gains.map(function (g) { return STR(2495, CHEST_BY_ID[g.id].name, fmt(g.n)); }).join('、');
}

/* ---- Worker：開啟 ---- */
function chestRollRange(r) { return r ? ri(r[0], r[1]) : 0; }
/* 一次抽取放進袋子（同項目合併）。mul＝雙開戒加倍。 */
function chestRollInto(bag, d, mul) {
  var n = chestRollRange(d.q) * mul;
  if (n <= 0) return;
  var key = d.k, entry = { k: d.k, n: 0 };
  if (d.k === 'gem' || d.k === 'rune' || d.k === 'equip') { entry.p = chestRollRange(d.p); key += ':' + entry.p; }
  if (d.k === 'relic' && d.p) { entry.p = d.p[0]; key += ':' + entry.p; }
  if (d.k === 'equip' && d.p2) {   // 太古條數逐件擲骰
    for (var i = 0; i < n; i++) {
      var ac = chestRollRange(d.p2), k2 = key + ':' + ac;
      if (!bag[k2]) bag[k2] = { k: 'equip', p: entry.p, ancient: ac, n: 0 };
      bag[k2].n++;
    }
    return;
  }
  if (!bag[key]) bag[key] = entry;
  bag[key].n += n;
}
/* 寶箱裝備和野外掉落一樣進熔爐佇列（依各熔爐品質勾選拆解或保留入包）；
   佇列已滿改放背包，背包也滿就直接靜默拆解（產出照給），不會遺失也不刷滿日誌。 */
function chestDeliverEquipment(it, tally) {
  if (typeof newForgeTryIntake === 'function' && G.newForge && newForgeTryIntake(it)) { tally.forge++; return; }
  var cap = typeof inventoryCapacityWithTalents === 'function' ? inventoryCapacityWithTalents() : INVENTORY_CAP + (G.player.invUpgrades || 0);
  if (G.inventory.length < cap) { G.inventory.push(it); UI.dirty.inv = true; tally.inv++; return; }
  doSalvage(it, true);
  tally.salvaged++;
}
var CHEST_REWARD_ORDER = ['gold', 'scrap', 'essence', 'ancientEssence', 'dust', 'soulOrigin', 'skillXp', 'xp', 'gem', 'rune', 'equip', 'relic', 'invitation'];
var CHEST_SIMPLE_RES = { scrap: 1, essence: 1, ancientEssence: 1, dust: 1, soulOrigin: 1 };
/* 發放袋子內容，回傳顯示用清單（寶石依實際種類、遺物依實際編號展開）。 */
function chestGrantBag(bag, tally) {
  var p = G.player, out = [], keys = Object.keys(bag), i, j;
  var stage = Math.max(1, Math.floor(Number(G.stage && G.stage.current) || 1));
  for (i = 0; i < keys.length; i++) {
    var e = bag[keys[i]], n = e.n;
    if (e.k === 'gold') { p.gold += n; if (typeof achAddGold === 'function') achAddGold(n); out.push({ k: 'gold', n: n }); }
    else if (CHEST_SIMPLE_RES[e.k]) { p[e.k] = (Number(p[e.k]) || 0) + n; out.push({ k: e.k, n: n }); }
    else if (e.k === 'invitation') { if (typeof addMerchantInvitations === 'function') addMerchantInvitations(n); out.push({ k: e.k, n: n }); }
    else if (e.k === 'skillXp') { if (typeof gainSkillMasteryXp === 'function') gainSkillMasteryXp(n); UI.dirty.skills = true; out.push({ k: e.k, n: n }); }
    else if (e.k === 'xp') { if (typeof gainXp === 'function') gainXp(n); out.push({ k: e.k, n: n }); }
    else if (e.k === 'gem') {
      var byType = {};
      for (j = 0; j < n; j++) { var t = randomGemType(); if (t) byType[t] = (byType[t] || 0) + 1; }
      Object.keys(byType).forEach(function (t) { addGem(t, e.p, byType[t]); out.push({ k: 'gem', type: t, lv: e.p, n: byType[t] }); });
    } else if (e.k === 'rune') {
      var rune = typeof RUNES !== 'undefined' ? RUNES[e.p - 1] : null;
      if (rune && typeof addRune === 'function') { addRune(rune.id, n); out.push({ k: 'rune', id: rune.id, n: n }); }
    } else if (e.k === 'equip') {
      var opts = { rarity: e.p };
      if (e.ancient !== undefined) opts.ancientCount = e.ancient;
      for (j = 0; j < n; j++) chestDeliverEquipment(makeEquipment(stage, opts), tally);
      out.push({ k: 'equip', r: e.p, n: n });
    } else if (e.k === 'relic') {
      var byId = {};
      for (j = 0; j < n; j++) {
        var id = e.p || (typeof relicRandomId === 'function' ? relicRandomId() : 0);
        if (id && typeof relicGrant === 'function' && relicGrant(id, 1)) byId[id] = (byId[id] || 0) + 1;
      }
      Object.keys(byId).forEach(function (id) { out.push({ k: 'relic', id: Number(id), n: byId[id] }); });
    }
  }
  // 合併同種寶石／裝備（不同擲骰鍵可能得到同一結果），再依固定種類順序排列（同種依階級／品質由低到高）
  var merged = {}, list = [];
  out.forEach(function (rw) {
    var key = rw.k + ':' + (rw.type || '') + ':' + (rw.lv || '') + ':' + (rw.id || '') + ':' + (rw.r === undefined ? '' : rw.r);
    if (merged[key]) merged[key].n += rw.n;
    else { merged[key] = rw; list.push(rw); }
  });
  var rank = function (rw) { var i = CHEST_REWARD_ORDER.indexOf(rw.k); return (i < 0 ? 99 : i) * 1000 + (rw.lv || 0) + (rw.r || 0) + (rw.k === 'rune' && typeof RUNES !== 'undefined' ? RUNES.findIndex(function (x) { return x.id === rw.id; }) : 0); };
  list.sort(function (a, b) { return rank(a) - rank(b); });
  return list;
}
/* 指令 chest.open：開 count 個（上限＝持有數）。成功回 { chestId, opened, doubled, rewards, equip }，失敗回錯誤字串。 */
function chestOpen(chestId, count) {
  var def = CHEST_BY_ID[chestId];
  if (!def) return STR(2485);
  var st = chestState(chestId);
  if (!st.on) return STR(2486, def.name);
  if (st.n <= 0) return STR(2487, def.name);
  var row = chestLevelDef(def, st.lv), pairs = chestDropPairs(row);
  if (!pairs.length || !(row.rolls > 0)) return STR(2488, def.name);
  count = Math.max(1, Math.min(st.n, Math.floor(Number(count) || 1)));
  var dbl = typeof relicChestDoubleChance === 'function' ? relicChestDoubleChance() : 0;
  var bag = {}, doubled = 0;
  for (var i = 0; i < count; i++) {
    var mul = dbl > 0 && chance(dbl) ? 2 : 1;
    if (mul > 1) doubled++;
    for (var r = 0; r < row.rolls; r++) chestRollInto(bag, wpick(pairs), mul);
  }
  st.n -= count;
  if (G.factory && G.factory.stats) G.factory.stats.chestOpened = (Number(G.factory.stats.chestOpened) || 0) + count;   // 任務進度（tasks.js chestOpenCount）
  var tally = { forge: 0, inv: 0, salvaged: 0 };
  var rewards = chestGrantBag(bag, tally);
  chestLog(STR(2491, def.name, fmt(count), chestRewardsText(rewards)) + (doubled ? STR(2492, fmt(doubled)) : ''), 'good');
  UI.dirty.newforge = true; UI.dirty.header = true; UI.dirty.inv = true; UI.dirty.gems = true;
  return { chestId: def.id, opened: count, doubled: doubled, rewards: rewards, equip: tally };
}
/* 指令 chest.upgrade：成功回 null，失敗回錯誤字串。 */
function chestUpgrade(chestId) {
  var def = CHEST_BY_ID[chestId];
  if (!def) return STR(2485);
  var st = chestState(chestId);
  if (!st.on) return STR(2486, def.name);
  var cost = chestUpgradeCost(def, st.lv);
  if (cost === null) return STR(2489, def.name, chestMaxLevel(def));
  if (G.player.gold < cost) return STR(42, fmt(cost));
  G.player.gold -= cost;
  st.lv++;
  chestLog(STR(2493, def.name, st.lv, fmt(cost)), 'good');
  UI.dirty.newforge = true; UI.dirty.header = true;
  return null;
}
/* 熔爐面板投影（lv／xp／n／on，介面再用 CHESTS 查定義）。唯讀：建面板不得改動存檔（tests/sim-forge-parts.test.cjs）。 */
function chestPanelView() {
  var out = {};
  if (typeof CHESTS === 'undefined' || !G || !G.player) return out;
  var store = G.player.chests || {};
  CHESTS.forEach(function (def) {
    var st = chestEntry(def, store[def.id]);
    out[def.id] = { lv: st.lv, xp: st.xp, n: st.n, on: st.on };
  });
  return out;
}
/* 存檔淨化（save.js migrateSave）：已知編號正規化；表上暫時拿掉的編號原樣保留，避免改表時清掉玩家進度。 */
function sanitizeChests(data) {
  if (!data || !data.player) return;
  var store = data.player.chests;
  if (!store || typeof store !== 'object' || Array.isArray(store)) store = data.player.chests = {};
  Object.keys(store).forEach(function (id) {
    if (!store[id] || typeof store[id] !== 'object') { delete store[id]; return; }
    if (CHEST_BY_ID[id]) store[id] = chestEntry(CHEST_BY_ID[id], store[id]);
  });
}
