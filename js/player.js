'use strict';
/* ============ 玩家狀態與屬性計算（50+ 屬性系統） ============ */

// 空的一套裝備（所有欄位為 null）
function emptyEquipmentSet() {
  var e = {};
  SLOT_LIST.forEach(function (s) { e[s] = null; });
  return e;
}
var EQUIP_SET_COUNT = 3;
var EQUIP_SET_NAMES = ['第一套', '第二套', '第三套'];
function equipSetName(i) { return EQUIP_SET_NAMES[i] || ('第' + (i + 1) + '套'); }
// 顯示用名稱：有自訂名稱則用之，否則用預設「第X套」
function equipSetLabel(i) {
  var n = (typeof G !== 'undefined' && Array.isArray(G.equipSetNames) && G.equipSetNames[i]) ? String(G.equipSetNames[i]).trim() : '';
  return n || equipSetName(i);
}

// 熔爐（正式版）：建立一座預設熔爐（單傳送帶）。品質勾選預設依企劃示意：
// 普通~傳說＝勾選（自動入帶拆解）、神話/創世＝不勾（保留）；神鑄創世恆不入帶。
function newForgeDefaultFurnace(id) {
  var qualities = [];
  for (var r = 0; r < RARITIES.length; r++) qualities.push(r <= 5);
  return {
    id: id,
    enabled: true,
    qualities: qualities,                        // index=品質，true=該品質裝備自動入帶拆解
    queue: [],                                   // 專屬佇列（總佇列派發而來；帶尾 +N＝此佇列件數）
    belt: [],                                    // 傳送帶（純裝備陣列，帶頭先入爐；自專屬佇列補位）
    timer: 0,
    partSlots: NEW_FORGE_PART_SLOTS_INITIAL,     // 已解鎖零件格數（金幣逐格解鎖至 8）
    parts: []                                    // 已置入零件快照（提供該爐拆解加成）
  };
}

function newGameState() {
  // 三套裝備；equipment 永遠指向「使用中」那套（equipActive）以維持既有屬性/戰鬥/存檔行為
  var equipmentSets = [];
  for (var _es = 0; _es < EQUIP_SET_COUNT; _es++) equipmentSets.push(emptyEquipmentSet());
  var equipment = equipmentSets[0];
  var books = {};
  for (var bk in ENCHANTS) books[bk] = 0;
  var gems = {};
  for (var gt in GEM_TYPES) gems[gt] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  return {
    version: 1,
    runId: 1,           // 第幾局（重新開局 +1；每局的自動存檔各自獨立，舊存檔以 mergeDefaults 補 1）
    skillDmgV2: true,   // 2026-07-09 技能傷害重調旗標（migrateSave 據此對舊存檔融合技做一次性加成）
    specialBuffTrimV1: true, // 特殊技能第二增益移除後的既有融合技能一次性清理旗標
    externalGoldRecoveryV1: true,
    talentTreesV2RespecV1: true, // 天賦系統 V2（1~10 轉）改版：新帳號無需重置退點
    talentTreesV2RespecV2: true, // 天賦升級消耗改制（Lv.51 起加倍）第二次重置：新帳號無需處理
    talentTreesV2RespecV3: true, // 天賦升級消耗再調整（基礎改轉數+2）第三次重置：新帳號無需處理
    talentTreesV2RespecV4: true, // 天賦升級消耗再調整（基礎改轉數+9）第四次重置：新帳號無需處理
    equipSetPotentialLimitV1: true, // 多套裝備 (Lv.2000) 與潛力 (3轉) 新開放門檻限制：新帳號無需重置

    savedAt: Date.now(),
    player: {
      level: 1, xp: 0,
      reincarnations: 0,
      reincarnationTalentPoints: 0,
      talents: { levels: {}, potentialLevels: {} },
      gold: 50, scrap: 0, essence: 0, ancientEssence: 0, soulOrigin: 0,
      dust: 0,                // 魔塵（神鑄材料）
      gems: gems,
      fusedGems: [],          // 融合寶石（雙屬性，個別實體）
      gemShop: { level: 1, items: [], refreshCount: 0, hourStart: Date.now() },
      books: books,
      invUpgrades: 0,
      // 技能：初始自帶 2 個 1 級技能；每升 1 級 +1 技能點
      skills: { powerSlash: 1, arcaneBurst: 1 },
      skillPoints: 0,
      skillPointBudget: 2,     // 技能點總預算；初始兩個 1 級技能也計入 2 點
      loadout: ['powerSlash', 'arcaneBurst'],
      fusions: []   // 玩家自創的融合技定義

    },
    equipmentSets: equipmentSets,   // 三套裝備
    equipActive: 0,                 // 使用中（穿著）那套索引 → 供屬性/戰鬥
    equipView: 0,                   // 面板檢視中那套索引（純 UI）
    equipSetNames: ['', '', ''],    // 每套自訂名稱（空＝用預設「第X套」）
    equipment: equipment,           // 永遠 = equipmentSets[equipActive]
    inventory: [],
    stage: { current: 1, best: 1, kills: 0, autoAdvance: true, zone: 'plains' },
    zoneProgress: {   // 各戰鬥場景獨立進度（stage 為當前場景的即時狀態）
      plains: { current: 1, best: 1 },
      desert: { current: 1, best: 1 },
      swamp:  { current: 1, best: 1 }
    },
    factory: {
      filter: { actions: ['salvage', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep'], smartSalvage: false },
      autoEquip: true,
      salvage: {},
      synth: { enabled: false, mergeEnabled: true, hybridEnabled: true, gemMerge: true, minGemLevel: 1, bookChoice: 'any' },
      enchant: { enabled: false, overwrite: false },
      upgrade: { enabled: false, cap: 5 },
      conveyor: [],
      synthBuffer: [],
      parts: [],
      installed: { salvage: [], synth: [] },
      salvageSlots: 10,
      procTimer: 0, enchTimer: 0, upTimer: 0,
      stats: { salvaged: 0, extracted: 0, synthesized: 0, enchanted: 0, upgraded: 0, upgradeFailed: 0, mutated: 0 }
    },
    newForge: {   // 熔爐（正式版）：待處理佇列 / 熔爐清單（最多 NEW_FORGE_MAX 座）
      queue: [],
      furnaces: [newForgeDefaultFurnace(1)],
      nextId: 2,
      // 改版公告旗標：新局預設已讀；舊存檔載入時由 migrateSave 設為 false → 彈窗＋頁籤閃爍
      noticeShown: true,
      tabSeen: true,
      stats: { salvaged: 0, kept: 0 }
    },
    tower: { highest: 0, active: false },
    forge: {  // 神鑄系統：六芒星槽位 / 六格魔塵符位 / 自動魔塵 / 自動鑄造 / 等待狀態 / 上次產物 / 法陣紀錄
      slots: [null, null, null, null, null, null],
      dustSlots: [false, false, false, false, false, false],
      autoDust: true, result: null, log: [], unlockNotified: false, unlocked: false,
      autoFill: null, autoForge: false, crafting: null
    },
    settings: { compareEq: true, useAncientEssence: false },
    firstRunAt: Date.now()
  };
}

/* ---- 屬性彙總 ----
   流程：等級基礎四維 + 裝備詞條聚合 → 派生 50+ 屬性。
   計算公式本體（computeStats、affixResElem）→ js/formula.js §2；
   此處僅保留快取機制。 */
var _statsCache = null;
var _viewStatsCache = null; // 「檢視中」裝備套的預覽屬性快取（僅屬性面板顯示用）
function markStatsDirty() { _statsCache = null; _viewStatsCache = null; }

function getStats() {
  if (!_statsCache) _statsCache = computeStats();
  return _statsCache;
}

/* 屬性面板顯示用：檢視中裝備套的屬性預覽。
   檢視套＝穿著套時即為 getStats()；否則以檢視套計算 would-be 屬性。
   戰鬥／回復／掉落等一切邏輯仍使用 getStats()（穿著中那套），不受切頁影響。 */
function getViewStats() {
  if (typeof isViewingActiveSet !== 'function' || isViewingActiveSet()) return getStats();
  if (!_viewStatsCache) _viewStatsCache = computeStats(viewedEquipment());
  return _viewStatsCache;
}

/* ---- 經驗 / 升級 ---- */
function gainXp(n) {
  var p = G.player;
  p.xp += n;
  var gained = 0;
  while (p.level < MAX_LEVEL && p.xp >= xpForLevel(p.level)) {
    p.xp -= xpForLevel(p.level);
    p.level++;
    gained++;
    if (reincarnationCount() > 0) {
      p.reincarnationTalentPoints = (p.reincarnationTalentPoints || 0) + 1;
    } else {
      p.skillPointBudget = (p.skillPointBudget || 0) + 1;
    }
  }
  if (p.level >= MAX_LEVEL) p.xp = 0;
  if (gained > 0) {
    markStatsDirty();
    var reward = reincarnationCount() > 0
      ? '<span class="log-hl-good">轉生天賦點 +' + gained + '</span>'
      : '<span class="log-hl-good">技能點 +' + gained + '</span>';
    blog('🎉 等級提升！目前等級 ' + p.level + '（四維主屬性 +2、' + reward + '）', 'good');
    // 升級回滿血藍
    var st = getStats();
    if (FIELD.player) { FIELD.player.hp = st.hp; FIELD.player.mp = st.mp; }
    UI.dirty.header = true; UI.dirty.skills = true; UI.dirty.talents = true;
  }
}

/* ---- 轉生 ----
   保留裝備、技能、資源與關卡，只重置等級／經驗；轉生後的天賦點持續累計。 */
function reincarnate() {
  var p = G.player;
  var count = reincarnationCount();
  if (count >= REINCARNATION_MAX) return '已達最高轉生次數（' + REINCARNATION_MAX + ' 轉）';
  if (p.level < REINCARNATION_LEVEL) return '角色尚未達到 ' + REINCARNATION_LEVEL + ' 級';
  var skillBudgetBeforeReinc = Math.max(p.skillPointBudget || 0, p.level + 1);
  p.reincarnations = count + 1;
  p.level = 1;
  p.xp = 0;
  G.equipActive = 0;
  G.equipView = 0;
  G.equipment = G.equipmentSets[0];
  // 技能點總預算在轉生後保留；之後升級只增加轉生天賦點。
  p.skillPointBudget = skillBudgetBeforeReinc;
  markStatsDirty();
  if (typeof FIELD !== 'undefined' && FIELD && FIELD.player) {
    var st = getStats();
    FIELD.player.hp = st.hp;
    FIELD.player.mp = st.mp;
    FIELD.player.shield = 0;
    FIELD.player.shieldMax = 0;
    FIELD.player.shieldMaxVersion = SHIELD_MAX_VERSION;
    FIELD.player.shieldSkillBase = 0;
    FIELD.player.shieldSkillPct = 0;
    FIELD.player.skillCds = {};
    FIELD.player.skillGcd = 0;
  }
  UI.dirty.header = true;
  UI.dirty.skills = true;
  UI.dirty.talents = true;
  UI.dirty.battle = true;
  blog('🌟 轉生成功！成為【' + reincarnationRankName(p.reincarnations) + '】。等級重置為 1，生命、法力與四大屬性變為 ×' + reincarnationTotalMultiplier() + '，經驗需求 ×' + reincarnationExpMultiplier() + '。', 'good');
  return null;
}

/* ---- 三套裝備輔助 ----
   G.equipment 永遠 = equipmentSets[equipActive]（使用中）；面板檢視另有 equipView。 */
function equipmentSetAt(i) {
  if (!Array.isArray(G.equipmentSets)) return G.equipment; // 極舊存檔容錯
  var idx = clamp(Math.floor(Number(i) || 0), 0, G.equipmentSets.length - 1);
  return G.equipmentSets[idx];
}
function activeEquipment() { return equipmentSetAt(G.equipActive || 0); }
function viewedEquipment() { return equipmentSetAt(typeof G.equipView === 'number' ? G.equipView : (G.equipActive || 0)); }
function isViewingActiveSet() { return (G.equipView || 0) === (G.equipActive || 0); }
// 面板檢視切頁（純 UI，不換穿；屬性面板改顯示檢視套的預覽屬性）
function setEquipView(idx) {
  if (!Array.isArray(G.equipmentSets)) return;
  var i = clamp(Math.floor(Number(idx) || 0), 0, G.equipmentSets.length - 1);
  if (G.player.level < 2000 && i > 0) return;
  G.equipView = i;
  _viewStatsCache = null;           // 換檢視目標 → 重算預覽
  UI.sel = null;
  UI.dirty.equip = true;
  UI.dirty.header = true;           // 屬性面板立即改顯檢視套
}
// 確定切換：把使用中那套換成目前檢視那套 → 重算屬性
function switchToEquipSet(idx) {
  if (!Array.isArray(G.equipmentSets)) return;
  var i = clamp(Math.floor(Number(idx) || 0), 0, G.equipmentSets.length - 1);
  if (G.player.level < 2000 && i > 0) return;
  G.equipActive = i;
  G.equipView = i;
  G.equipment = G.equipmentSets[i]; // 重導使用中那套
  markStatsDirty();
  UI.dirty.equip = true; UI.dirty.header = true; UI.dirty.battle = true;
}

/* ---- 裝備操作 ----
   武器/戒指類可裝入主/副兩欄：優先裝入空欄，皆有裝備時替換較弱者。
   eq 可指定目標套（預設使用中 G.equipment；面板檢視非使用中套時傳入檢視套）。 */
function equipTargetSlot(it, eq) {
  eq = eq || G.equipment;
  var cands = equipSlotsForType(it.slot);
  if (typeof UI !== 'undefined' && UI.lastEquipSlot && cands.indexOf(UI.lastEquipSlot) >= 0) {
    return UI.lastEquipSlot;
  }
  var best = cands[0], bestScore = Infinity;
  for (var i = 0; i < cands.length; i++) {
    var cur = eq[cands[i]];
    if (!cur) return cands[i]; // 空欄優先
    var s = itemScore(cur);
    if (s < bestScore) { bestScore = s; best = cands[i]; }
  }
  return best;
}

// 穿上裝備（可指定欄位與目標套），回傳被替換下來的舊裝備（可能為 null）
function equipItem(it, slotKey, eq) {
  eq = eq || G.equipment;
  var key = slotKey || equipTargetSlot(it, eq);
  var old = eq[key];
  eq[key] = it;
  if (eq === G.equipment) markStatsDirty(); // 只有動到使用中那套才需重算屬性
  UI.dirty.equip = true; UI.dirty.header = true;
  return old;
}

// 嘗試自動換裝：與（較弱的）現有裝備比較，較強則穿上，舊裝回輸送帶
function tryAutoEquip(it) {
  var key = equipTargetSlot(it);
  var cur = G.equipment[key];
  if (itemScore(it) > itemScore(cur) * 1.02) {
    var old = equipItem(it, key);
    blog('🔁 自動換裝：' + rarityTag(it) + '（' + SLOT_INFO[key].name + '）', 'info');
    if (old) {
      old.locked = false;
      pushConveyor(old); // 舊裝備回到輸送帶，交給生產線處置
    }
    return true;
  }
  return false;
}

function rarityTag(it) {
  return '[' + RARITIES[it.rarity].name + '] ' + it.name;
}

// 神話以上不允許背景自動分解；需要玩家手動確認後才拆。
var AUTO_SALVAGE_PROTECT_RARITY = 6;
function isAutoSalvageProtected(it) {
  return it && it.rarity >= AUTO_SALVAGE_PROTECT_RARITY;
}
function autoSalvageScore(it) {
  try { return itemScore(it); }
  catch (e) { return (it && it.level ? it.level : 0) + (it && it.rarity ? it.rarity : 0) * 1000; }
}
function findAutoSalvageCandidateIndex(items) {
  if (!items || !items.length) return -1;
  var best = -1;
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it || it.locked || isAutoSalvageProtected(it)) continue;
    if (best < 0 ||
      it.rarity < items[best].rarity ||
      (it.rarity === items[best].rarity && autoSalvageScore(it) < autoSalvageScore(items[best]))) {
      best = i;
    }
  }
  return best;
}
function takeAutoSalvageCandidate(items) {
  var idx = findAutoSalvageCandidateIndex(items);
  return idx >= 0 ? items.splice(idx, 1)[0] : null;
}

/* 放入背包（嚴格維持容量上限，不再超量收納）：
   滿載時 —— 未受保護（傳說以下）的新物品直接分解；
   受保護（神話+）的新物品先分解包內未受保護的最弱者騰位；
   若包內全為神話+，則與「未鎖定中評分最低者」捨弱留強交換，
   新物品較弱（或包內全上鎖）時分解新物品。上鎖裝備永不被動分解。 */
function addToInventory(it) {
  var cap = typeof inventoryCapacityWithTalents === 'function' ? inventoryCapacityWithTalents() : INVENTORY_CAP + (G.player.invUpgrades || 0);
  if (G.inventory.length < cap) {
    G.inventory.push(it);
    UI.dirty.inv = true;
    return true;
  }
  if (isAutoSalvageProtected(it)) {
    var cand = takeAutoSalvageCandidate(G.inventory);
    if (cand) {
      var cres = doSalvage(cand, true);
      G.inventory.push(it);
      UI.dirty.inv = true;
      flog('🛡️ 背包已滿，保留高品質 ' + rarityTag(it) + '，改為自動分解 ' + rarityTag(cand) + ' → 碎片x' + cres.scrap, 'warn');
      return true;
    }
    // 包內全為受保護品質：捨弱留強（新品強於未鎖定最弱者才收納）
    var worstIdx = -1, worstScore = Infinity;
    for (var i = 0; i < G.inventory.length; i++) {
      var x = G.inventory[i];
      if (!x || x.locked) continue;
      var s = autoSalvageScore(x);
      if (s < worstScore) { worstScore = s; worstIdx = i; }
    }
    if (worstIdx >= 0 && worstScore < autoSalvageScore(it)) {
      var old = G.inventory.splice(worstIdx, 1)[0];
      var ores = doSalvage(old, true);
      G.inventory.push(it);
      UI.dirty.inv = true;
      flog('🛡️ 背包已滿，捨弱留強：自動分解較弱的 ' + rarityTag(old) + ' → 碎片x' + ores.scrap + '，收納 ' + rarityTag(it), 'warn');
      return true;
    }
    var nres = doSalvage(it, true);
    flog('📦 背包已滿且新獲得的 ' + rarityTag(it) + ' 未強於包內未鎖定裝備，自動分解 → 碎片x' + nres.scrap, 'warn');
    return false;
  }
  var res = doSalvage(it, true);
  flog('📦 背包已滿，自動分解 ' + rarityTag(it) + ' → 碎片x' + res.scrap, 'warn');
  return false;
}
