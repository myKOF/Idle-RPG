'use strict';
/* ============ 神鑄系統（Divine Forge，邏輯層） ============
   六芒星法陣放入 6 件「同品質」裝備（限傳說/神話/創世），消耗金幣鑄造：
     成功 → 消耗全部 6 件，獲得下一品質隨機部位裝備 1 件（6 件創世 → 神鑄創世）
     失敗 → 隨機消耗 2 件，其餘退回背包
   魔塵：六個角尖各可放 1 個，每個 +5% 成功率（鑄造時才實際消耗）。
   常數（FORGE_* / GODFORGE_*）→ js/data.js；成功率公式 forgeSuccessRateFor → js/formula.js §6。
   狀態封裝於 G.forge（slots/dust/autoDust/result/log），渲染由 ui.js renderForge 負責。 */

function forgeState() {
  if (!G.forge) {
    G.forge = { slots: [null, null, null, null, null, null], dustSlots: [false, false, false, false, false, false], autoDust: true, result: null, log: [], unlockNotified: false };
  }
  if (!G.forge.slots || G.forge.slots.length !== FORGE_SLOTS) {
    G.forge.slots = [null, null, null, null, null, null];
  }
  if (!Array.isArray(G.forge.dustSlots) || G.forge.dustSlots.length !== FORGE_SLOTS) {
    G.forge.dustSlots = [false, false, false, false, false, false];
  }
  // 舊版魔塵為計數制（dust: n）：轉換為前 n 格點亮後移除舊欄位
  if (typeof G.forge.dust === 'number') {
    var legacy = clamp(G.forge.dust, 0, FORGE_SLOTS);
    if (legacy > 0 && !G.forge.dustSlots.some(function (x) { return x; })) {
      for (var li = 0; li < legacy; li++) G.forge.dustSlots[li] = true;
    }
    delete G.forge.dust;
  }
  if (!G.forge.log) G.forge.log = [];
  return G.forge;
}

// 神鑄系統是否已開放（角色等級門檻，未達前頁籤隱藏）
function forgeUnlocked() {
  return G && G.player && G.player.level >= FORGE_UNLOCK_LEVEL;
}

// 法陣內部紀錄（顯示於六芒星左側，保留最近 18 筆）
function forgeLog(msg, cls) {
  var f = forgeState();
  f.log.unshift({ msg: msg, cls: cls || '' });
  while (f.log.length > 25) f.log.pop();
  UI.dirty.forge = true;
}

// 神鑄失敗補償：無論裝備或寶石模式，失敗固定獲得 1 個魔塵。
function forgeFailureReward() {
  G.player.dust = (G.player.dust || 0) + 1;
  UI.dirty.header = true;
  UI.dirty.forge = true;
}

/* 法陣模式：'equip'（裝備鑄造）/ 'gem'（寶石鑄造）/ null（空）
   由第一個放入的物件決定，兩種模式不可混放。 */
function forgeMode() {
  var f = forgeState();
  for (var i = 0; i < f.slots.length; i++) {
    if (f.slots[i]) return f.slots[i].kind === 'gem' ? 'gem' : 'equip';
  }
  return null;
}

// 目前法陣要求的裝備品質（由第一件放入的裝備決定）；null = 尚未放入裝備
function forgeRarity() {
  var f = forgeState();
  for (var i = 0; i < f.slots.length; i++) {
    if (f.slots[i] && f.slots[i].kind !== 'gem') return f.slots[i].rarity;
  }
  return null;
}

// 寶石模式：第一顆放入的寶石（{ kind:'gem', type, level }）；null = 尚未放入寶石
function forgeGemFirst() {
  var f = forgeState();
  for (var i = 0; i < f.slots.length; i++) {
    if (f.slots[i] && f.slots[i].kind === 'gem') return f.slots[i];
  }
  return null;
}

function forgeItemCount() {
  return forgeState().slots.filter(function (x) { return !!x; }).length;
}

// 已放置魔塵數（超過持有量時由後往前釋放，收斂至持有量內）
function forgeDustCount() {
  var f = forgeState();
  var owned = G.player.dust || 0;
  var n = 0;
  for (var i = 0; i < FORGE_SLOTS; i++) if (f.dustSlots[i]) n++;
  for (var j = FORGE_SLOTS - 1; j >= 0 && n > owned; j--) {
    if (f.dustSlots[j]) { f.dustSlots[j] = false; n--; }
  }
  return n;
}

// 自動使用魔塵：依持有量由第一格起補滿（上限 6 格）
function forgeAutoFillDust() {
  var f = forgeState();
  var n = Math.min(FORGE_SLOTS, G.player.dust || 0);
  for (var i = 0; i < FORGE_SLOTS; i++) f.dustSlots[i] = i < n;
  UI.dirty.forge = true;
}

// 清空所有已放置魔塵
function forgeClearDust() {
  var f = forgeState();
  for (var i = 0; i < FORGE_SLOTS; i++) f.dustSlots[i] = false;
}

// 成功率與費用組成 { mode, base, dust, total, cost }；法陣為空時回傳 null
function forgeRateInfo() {
  var mode = forgeMode();
  if (!mode) return null;
  var dustN = forgeDustCount();
  if (mode === 'gem') {
    var g = forgeGemFirst();
    return {
      mode: 'gem', base: FORGE_GEM_BASE_RATE[g.level] || 0, dust: dustN * FORGE_GEM_DUST_RATE,
      total: forgeGemSuccessRateFor(g.level, dustN), cost: forgeGemCost(g.level)
    };
  }
  var r = forgeRarity();
  return {
    mode: 'equip', base: FORGE_BASE_RATE[r] || 0, dust: dustN * FORGE_DUST_RATE,
    total: forgeSuccessRateFor(r, dustN), cost: FORGE_GOLD_COST[r] || 0
  };
}

// 放入裝備（自背包移入第一個空槽）；回傳 null=成功，否則錯誤訊息
function forgePlaceItem(id) {
  var f = forgeState();
  if (forgeMode() === 'gem') return '法陣中已放入寶石，裝備與寶石不可混放';
  var idx = -1;
  for (var i = 0; i < G.inventory.length; i++) if (G.inventory[i].id === id) { idx = i; break; }
  if (idx < 0) return '找不到該裝備';
  var it = G.inventory[idx];
  if (it.rarity >= GODFORGED_IDX) return '神鑄創世裝備無法再放入法陣鑄造';
  if (it.rarity < FORGE_MIN_RARITY) return '只有傳說、神話、創世品質的裝備可放入法陣';
  var need = forgeRarity();
  if (need !== null && it.rarity !== need) {
    return '六件裝備品質必須相同（法陣目前為「' + RARITIES[need].name + '」）';
  }
  var slot = f.slots.indexOf(null);
  if (slot < 0) return '法陣已放滿 6 件裝備';
  G.inventory.splice(idx, 1);
  f.slots[slot] = it;
  f.result = null;
  if (f.autoDust) forgeAutoFillDust(); // 自動使用魔塵：放入時補滿
  UI.dirty.forge = true; UI.dirty.inv = true;
  return null;
}

/* 放入寶石（自寶石庫存扣 1 顆移入第一個空槽）；回傳 null=成功，否則錯誤訊息。
   限 5~9 階、六顆必須同種類同階級；放入當下即自庫存扣除，取回時歸還。 */
function forgePlaceGem(type, level) {
  var f = forgeState();
  if (!GEM_TYPES[type]) return '未知寶石種類';
  if (forgeMode() === 'equip') return '法陣中已放入裝備，裝備與寶石不可混放';
  if (level < GEM_MAX_LEVEL) return '只有五階以上的寶石可放入法陣';
  if (level >= GEM_FORGE_MAX_LEVEL) return GEM_NAMES[GEM_FORGE_MAX_LEVEL] + '寶石已是最高階級，無法再鑄造';
  var first = forgeGemFirst();
  if (first && (first.type !== type || first.level !== level)) {
    return '六顆寶石必須為相同種類與階級（法陣目前為「' + gemLabel(first.type, first.level) + '」）';
  }
  if (gemCount(type, level) < 1) return '沒有「' + gemLabel(type, level) + '」';
  var slot = f.slots.indexOf(null);
  if (slot < 0) return '法陣已放滿 6 顆寶石';
  addGem(type, level, -1);
  f.slots[slot] = { kind: 'gem', type: type, level: level };
  f.result = null;
  if (f.autoDust) forgeAutoFillDust();
  UI.dirty.forge = true;
  return null;
}

// 取回單一槽位物件（裝備回背包、寶石回庫存）
function forgeRemoveItem(slotIdx) {
  var f = forgeState();
  var it = f.slots[slotIdx];
  if (!it) return;
  f.slots[slotIdx] = null;
  if (it.kind === 'gem') addGem(it.type, it.level, 1);
  else forgeReturnItem(it);
  if (forgeItemCount() === 0) forgeClearDust();
  UI.dirty.forge = true;
}

// 全卸下：所有槽位物件退回並清空魔塵；回傳取回件數
function forgeUnloadAll() {
  var f = forgeState();
  var n = 0;
  for (var i = 0; i < f.slots.length; i++) {
    var it = f.slots[i];
    if (!it) continue;
    if (it.kind === 'gem') addGem(it.type, it.level, 1);
    else forgeReturnItem(it);
    f.slots[i] = null;
    n++;
  }
  forgeClearDust();
  UI.dirty.forge = true;
  return n;
}

// 點擊角尖符位：在「該位置」放入或取下魔塵；回傳 null=成功，否則錯誤訊息
function forgeToggleDust(idx) {
  var f = forgeState();
  if (!(idx >= 0 && idx < FORGE_SLOTS)) return null;
  if (f.dustSlots[idx]) {
    f.dustSlots[idx] = false;
  } else {
    if ((G.player.dust || 0) <= forgeDustCount()) return '魔塵不足（持有 ' + fmt(G.player.dust || 0) + ' 個）';
    f.dustSlots[idx] = true;
  }
  UI.dirty.forge = true;
  return null;
}

/* 法陣退回專用：保證放回背包（滿載時允許暫時超出容量，比照高品質保護行為）。
   不走 addToInventory——其滿載路徑會把未受保護品質（傳說）自動分解銷毀，
   玩家主動取回/鑄造失敗退回的裝備不得有銷毀風險。 */
function forgeReturnItem(it) {
  var cap = INVENTORY_CAP + (G.player.invUpgrades || 0);
  G.inventory.push(it);
  if (G.inventory.length > cap) {
    flog('🛡️ 背包已滿，法陣退回的 ' + rarityTag(it) + ' 已保留（目前超出容量，請整理背包）', 'warn');
  }
  UI.dirty.inv = true;
}

// 素材被消耗前取回鑲嵌的寶石（比照分解流程，不隨鑄造銷毀）
function forgeReclaimSockets(it) {
  if (!it.sockets) return;
  for (var i = 0; i < it.sockets.length; i++) {
    var g = it.sockets[i];
    if (g && g.fused) {
      if (!G.player.fusedGems) G.player.fusedGems = [];
      G.player.fusedGems.push(g.fused);
      it.sockets[i] = null;
    } else if (g && GEM_TYPES[g.type]) {
      addGem(g.type, g.level, 1);
      it.sockets[i] = null;
    }
  }
}

// 執行鑄造；回傳 null=已執行（結果寫入紀錄），否則錯誤訊息
function doForge() {
  var f = forgeState();
  var mode = forgeMode();
  if (forgeItemCount() < FORGE_SLOTS) {
    return mode === 'gem' ? '需放滿 6 顆相同種類與階級的寶石' : '需放滿 6 件相同品質的裝備';
  }
  var info = forgeRateInfo();
  var cost = info.cost;
  if (G.player.gold < cost) return '金幣不足（需要 ' + fmt(cost) + '，持有 ' + fmt(G.player.gold) + '）';
  var dustUsed = forgeDustCount();
  var rate = info.total;
  G.player.gold -= cost;
  if (dustUsed > 0) G.player.dust -= dustUsed;
  forgeClearDust();
  UI.dirty.header = true;

  // === 寶石鑄造：6 顆同種同階 → 1 顆高一階；失敗損失 2 顆、其餘退回庫存 ===
  if (mode === 'gem') {
    var g = forgeGemFirst();
    var costTail = '（成功率 ' + fmt1(rate) + '%，金幣 -' + fmt(cost) + (dustUsed ? '、魔塵 -' + dustUsed : '') + '）';
    f.slots = [null, null, null, null, null, null];
    if (chance(rate)) {
      addGem(g.type, g.level + 1, 1);
      f.result = { kind: 'gem', type: g.type, level: g.level + 1 };
      forgeLog('獲得 ' + gemLabel(g.type, g.level + 1) + '*1', 'good');
      blog('🔯 神鑄成功！6 顆' + gemLabel(g.type, g.level) + ' 合成 ' + gemLabel(g.type, g.level + 1) + ' x1' + costTail, 'good');
    } else {
      // 放入時已自庫存扣除：退回 4 顆（六顆同種同階，等同隨機消耗 2 顆）
      addGem(g.type, g.level, FORGE_SLOTS - FORGE_FAIL_CONSUME);
      forgeFailureReward();
      forgeLog('鑄造失敗！退回寶石*' + (FORGE_SLOTS - FORGE_FAIL_CONSUME), 'bad');
      blog('🔯 鑄造失敗！損失 ' + gemLabel(g.type, g.level) + ' x' + FORGE_FAIL_CONSUME +
        '，其餘 ' + (FORGE_SLOTS - FORGE_FAIL_CONSUME) + ' 顆已退回庫存，獲得魔塵 x1' + costTail, 'warn');
    }
    UI.dirty.forge = true;
    return null;
  }
  var r = forgeRarity();

  if (chance(rate)) {
    // 成功：消耗全部 6 件（取回鑲嵌寶石），產出下一品質隨機部位裝備（等級 = 素材中最高）
    var maxLv = 1;
    f.slots.forEach(function (it) { maxLv = Math.max(maxLv, it.level); forgeReclaimSockets(it); });
    f.slots = [null, null, null, null, null, null];
    var newIt = makeEquipment(maxLv, { rarity: r + 1, level: maxLv });
    f.result = { name: newIt.name, rarity: newIt.rarity, slot: newIt.slot, level: newIt.level };
    addToInventory(newIt);
    forgeLog('獲得 ' + newIt.name + '*1', 'good');
    blog('🔯 神鑄成功！獲得 ' + rarityTag(newIt) + '（成功率 ' + fmt1(rate) + '%，金幣 -' + fmt(cost) +
      (dustUsed ? '、魔塵 -' + dustUsed : '') + '）', 'good');
  } else {
    // 失敗：隨機消耗 2 件（取回鑲嵌寶石），其餘退回背包
    var order = [];
    for (var oi = 0; oi < FORGE_SLOTS; oi++) order.push(oi);
    for (var si = order.length - 1; si > 0; si--) {
      var sj = Math.floor(Math.random() * (si + 1));
      var tmp = order[si]; order[si] = order[sj]; order[sj] = tmp;
    }
    var lostNames = [];
    for (var k = 0; k < FORGE_FAIL_CONSUME; k++) {
      var li = order[k];
      forgeReclaimSockets(f.slots[li]);
      lostNames.push(f.slots[li].name);
      f.slots[li] = null;
    }
    for (var s = 0; s < f.slots.length; s++) {
      if (f.slots[s]) { forgeReturnItem(f.slots[s]); f.slots[s] = null; }
    }
    var rName = RARITIES[r] ? RARITIES[r].name : '裝備';
    forgeFailureReward();
    forgeLog('鑄造失敗！退回' + rName + '裝備*' + (FORGE_SLOTS - FORGE_FAIL_CONSUME), 'bad');
    blog('🔯 鑄造失敗！損失 ' + lostNames.join('、') + '，其餘裝備已退回背包（成功率 ' + fmt1(rate) +
      '%，金幣 -' + fmt(cost) + (dustUsed ? '、魔塵 -' + dustUsed : '') + '，獲得魔塵 x1）', 'warn');
  }
  UI.dirty.forge = true; UI.dirty.inv = true;
  return null;
}
