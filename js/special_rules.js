'use strict';
/* ============================================================================
   special_rules.js — 玩家歷史進程「一次性特規」處理
   ----------------------------------------------------------------------------
   專門存放「依玩家進度觸發、且每位玩家一輩子只發生一次」的特殊規則。
   目前收錄的保底獎勵：
     · 30~33 級：必得 1 件任意部位「獨特」裝備
     · 50~60 級：必得 1 件任意部位「史詩」裝備
   機制：進入該等級窗口後，每擊殺 1 隻野外怪 +0.5% 掉落機率（累進、不重置），
        直到掉落為止即完成；超過窗口上限仍未掉落者，下一次擊殺保底必得。
        既有存檔若已超過窗口（歷史上「應得而未得」），首次擊殺時直接補發。

   狀態：G.player.specialGrants[里程碑id] = { done, pity }；隨存檔 JSON 序列化，
        舊存檔於首次擊殺惰性建立（比照 talents 的 ensure 模式，毋須改 save/newGameState）。
   接線：由 js/combat.js 的 onFieldKill 於每次擊殺呼叫 specialGrantsOnKill()。
   數值集中：本模組的規則定義集中於下方 SPECIAL_GRANT_MILESTONES，改這裡即可調整。
   ============================================================================ */

/* 里程碑定義（rarity 為 RARITIES 索引：普通0 精良1 稀有2 獨特3 史詩4 傳說5 神話6 創世7 神鑄8） */
var SPECIAL_GRANT_MILESTONES = [
  { id: 'guaranteedUniqueLv30', minLevel: 30, maxLevel: 33, rarity: 3, perKillChance: 0.5, tierName: '獨特' },
  { id: 'guaranteedEpicLv50',   minLevel: 50, maxLevel: 60, rarity: 4, perKillChance: 0.5, tierName: '史詩' }
];

/* 惰性建立狀態容器（舊存檔相容；不覆蓋既有值） */
function ensureSpecialGrantsState() {
  if (!G.player.specialGrants || typeof G.player.specialGrants !== 'object') G.player.specialGrants = {};
  return G.player.specialGrants;
}

/* 玩家（穿戴中＋背包）是否已擁有稀有度 >= minRarity 的裝備（相應品質「含以上」即視為已滿足） */
function playerHasEquipmentRarity(minRarity) {
  var i, it;
  for (i = 0; i < SLOT_LIST.length; i++) {
    it = G.equipment && G.equipment[SLOT_LIST[i]];
    if (it && it.kind === 'equip' && it.rarity >= minRarity) return true;
  }
  var inv = G.inventory || [];
  for (i = 0; i < inv.length; i++) {
    it = inv[i];
    if (it && it.kind === 'equip' && it.rarity >= minRarity) return true;
  }
  return false;
}

/* 每次野外擊殺呼叫一次（傳入被擊殺的怪物 m）：推進各未完成里程碑的累進機率並判定發放。
   窗口門檻用「玩家等級」；發放的裝備等級用「當時擊殺的怪物等級」（比照一般掉落）。 */
function specialGrantsOnKill(monster) {
  if (typeof G === 'undefined' || !G || !G.player) return;
  var state = ensureSpecialGrantsState();
  var level = Math.floor(Number(G.player.level) || 1);   // 玩家等級 → 判斷窗口
  // 怪物等級 → 決定發放裝備的等級（無怪物時退回目前階段）
  var monsterLevel = (monster && monster.level) ? Math.floor(Number(monster.level)) : ((G.stage && G.stage.current) || 1);
  for (var i = 0; i < SPECIAL_GRANT_MILESTONES.length; i++) {
    var ms = SPECIAL_GRANT_MILESTONES[i];
    var s = state[ms.id] || (state[ms.id] = { done: false, pity: 0 });
    if (s.done) continue;
    if (level < ms.minLevel) continue;                 // 尚未進入窗口：達到門檻才開始累進
    if (level > ms.maxLevel) {
      // 已超出窗口上限：若玩家身上/背包「已有相應品質(含以上)裝備」則視為滿足、不發；
      // 否則本次擊殺直接掉落 1 件補上（歷史進程保底）。
      s.done = true;
      if (!playerHasEquipmentRarity(ms.rarity)) grantSpecialEquipment(ms, monsterLevel);
      continue;
    }
    // 窗口內（minLevel ≤ 等級 ≤ maxLevel）：每殺累進機率，保底於窗口內必得。
    s.pity += ms.perKillChance;                         // 累進機率（%）
    if (chance(s.pity)) {
      s.done = true;
      grantSpecialEquipment(ms, monsterLevel);
    }
  }
}

/* 強制發放一件「指定稀有度、隨機部位」裝備（等級依當時怪物等級），保證進背包（滿載允許暫時超出、絕不自動分解） */
function grantSpecialEquipment(ms, monsterLevel) {
  var stage = Math.max(1, Math.floor(Number(monsterLevel) || (G.stage && G.stage.current) || 1));
  var it = makeEquipment(stage, { rarity: ms.rarity }); // 省略 slot=隨機部位、省略 level=依怪物等級 stage±1（比照一般掉落）
  G.inventory.push(it);                                              // 比照 forgeReturnItem：保底放入
  UI.dirty.inv = true;
  var cap = (typeof inventoryCapacityWithTalents === 'function')
    ? inventoryCapacityWithTalents()
    : INVENTORY_CAP + (G.player.invUpgrades || 0);
  var over = G.inventory.length > cap ? '（背包已滿，暫時超出容量，請整理背包）' : '';
  if (typeof blog === 'function') {
    blog('🎁 進程獎勵：達成 ' + ms.minLevel + '~' + ms.maxLevel + ' 級里程碑，必得 ' +
      (typeof rarityTag === 'function' ? rarityTag(it) : ms.tierName) + it.name + over, 'good');
  }
}
