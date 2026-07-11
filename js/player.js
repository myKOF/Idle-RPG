'use strict';
/* ============ 玩家狀態與屬性計算（50+ 屬性系統） ============ */

function newGameState() {
  var equipment = {};
  SLOT_LIST.forEach(function (s) { equipment[s] = null; });
  var books = {};
  for (var bk in ENCHANTS) books[bk] = 0;
  var gems = {};
  for (var gt in GEM_TYPES) gems[gt] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  return {
    version: 1,
    runId: 1,           // 第幾局（重新開局 +1；每局的自動存檔各自獨立，舊存檔以 mergeDefaults 補 1）
    skillDmgV2: true,   // 2026-07-09 技能傷害重調旗標（migrateSave 據此對舊存檔融合技做一次性加成）
    specialBuffTrimV1: true, // 特殊技能第二增益移除後的既有融合技能一次性清理旗標
    savedAt: Date.now(),
    player: {
      level: 1, xp: 0,
      reincarnations: 0,
      reincarnationTalentPoints: 0,
      gold: 50, scrap: 0, essence: 0,
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
    equipment: equipment,
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
      procTimer: 0, enchTimer: 0, upTimer: 0,
      stats: { salvaged: 0, extracted: 0, synthesized: 0, enchanted: 0, upgraded: 0, upgradeFailed: 0, mutated: 0 }
    },
    tower: { highest: 0, active: false },
    forge: {  // 神鑄系統：六芒星槽位 / 六格魔塵符位 / 自動魔塵 / 自動鑄造 / 等待狀態 / 上次產物 / 法陣紀錄
      slots: [null, null, null, null, null, null],
      dustSlots: [false, false, false, false, false, false],
      autoDust: true, result: null, log: [], unlockNotified: false, unlocked: false,
      autoFill: null, autoForge: false, crafting: null
    },
    settings: { compareEq: false },
    firstRunAt: Date.now()
  };
}

/* ---- 屬性彙總 ----
   流程：等級基礎四維 + 裝備詞條聚合 → 派生 50+ 屬性。
   計算公式本體（computeStats、affixResElem）→ js/formula.js §2；
   此處僅保留快取機制。 */
var _statsCache = null;
function markStatsDirty() { _statsCache = null; }

function getStats() {
  if (!_statsCache) _statsCache = computeStats();
  return _statsCache;
}

/* ---- 經驗 / 升級 ---- */
function gainXp(n) {
  var p = G.player;
  p.xp += n;
  var gained = 0;
  while (p.level < REINCARNATION_LEVEL && p.xp >= xpForLevel(p.level)) {
    p.xp -= xpForLevel(p.level);
    p.level++;
    gained++;
    if (reincarnationCount() > 0) {
      p.reincarnationTalentPoints = (p.reincarnationTalentPoints || 0) + 1;
    } else {
      p.skillPointBudget = (p.skillPointBudget || 0) + 1;
    }
  }
  if (p.level >= REINCARNATION_LEVEL) p.xp = 0;
  if (gained > 0) {
    markStatsDirty();
    var reward = reincarnationCount() > 0
      ? '<span class="log-hl-good">轉生天賦點 +' + gained + '</span>'
      : '<span class="log-hl-good">技能點 +' + gained + '</span>';
    blog('🎉 等級提升！目前等級 ' + p.level + '（四維主屬性 +2、' + reward + '）', 'good');
    // 升級回滿血藍
    var st = getStats();
    if (FIELD.player) { FIELD.player.hp = st.hp; FIELD.player.mp = st.mp; }
    UI.dirty.header = true; UI.dirty.skills = true;
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
  // 技能點總預算在轉生後保留；之後升級只增加轉生天賦點。
  p.skillPointBudget = skillBudgetBeforeReinc;
  markStatsDirty();
  if (typeof FIELD !== 'undefined' && FIELD && FIELD.player) {
    var st = getStats();
    FIELD.player.hp = st.hp;
    FIELD.player.mp = st.mp;
    FIELD.player.shield = 0;
    FIELD.player.skillCds = {};
    FIELD.player.skillGcd = 0;
  }
  UI.dirty.header = true;
  UI.dirty.skills = true;
  UI.dirty.battle = true;
  blog('🌟 轉生成功！成為【' + reincarnationRankName(p.reincarnations) + '】。等級重置為 1，生命、法力與四大屬性變為 ×' + reincarnationTotalMultiplier() + '，經驗需求 ×' + reincarnationExpMultiplier() + '。', 'good');
  return null;
}

/* ---- 裝備操作 ----
   武器/戒指類可裝入主/副兩欄：優先裝入空欄，皆有裝備時替換較弱者 */
function equipTargetSlot(it) {
  var cands = equipSlotsForType(it.slot);
  if (typeof UI !== 'undefined' && UI.lastEquipSlot && cands.indexOf(UI.lastEquipSlot) >= 0) {
    return UI.lastEquipSlot;
  }
  var best = cands[0], bestScore = Infinity;
  for (var i = 0; i < cands.length; i++) {
    var cur = G.equipment[cands[i]];
    if (!cur) return cands[i]; // 空欄優先
    var s = itemScore(cur);
    if (s < bestScore) { bestScore = s; best = cands[i]; }
  }
  return best;
}

// 穿上裝備（可指定欄位），回傳被替換下來的舊裝備（可能為 null）
function equipItem(it, slotKey) {
  var key = slotKey || equipTargetSlot(it);
  var old = G.equipment[key];
  G.equipment[key] = it;
  markStatsDirty();
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
  var cap = INVENTORY_CAP + (G.player.invUpgrades || 0);
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
