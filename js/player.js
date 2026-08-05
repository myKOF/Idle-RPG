'use strict';

var INITIAL_GOLD = 50000;
var INITIAL_SCRAP = 500;
var INITIAL_ESSENCE = 100;
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
function equipmentSetUnlockedAtLevel(i, level, reincarnations) {
  var idx = Math.floor(Number(i));
  if (!Number.isFinite(idx) || idx < 0 || idx >= EQUIP_SET_COUNT) return false;
  var requiredReincarnations = Array.isArray(EQUIP_SET_UNLOCK_REINCARNATIONS)
    ? Number(EQUIP_SET_UNLOCK_REINCARNATIONS[idx]) || 0
    : 0;
  return Number(level) >= EQUIP_SET_UNLOCK_LEVELS[idx] && Number(reincarnations) >= requiredReincarnations;
}
function equipmentSetUnlocked(i) {
  if (typeof G === 'undefined' || !G.player) return false;
  return equipmentSetUnlockedAtLevel(i, G.player.level, G.player.reincarnations);
}

// 熔爐（正式版）：建立一座預設熔爐。第一座只勾選普通，後續熔爐沿用上一座設定。
// 神鑄創世永遠不入帶。
function newForgeDefaultFurnace(id, previousFurnace) {
  var qualities = [];
  if (previousFurnace && Array.isArray(previousFurnace.qualities)) {
    qualities = previousFurnace.qualities.slice(0, RARITIES.length);
  } else {
    for (var r = 0; r < RARITIES.length; r++) qualities.push(r === 0);
  }
  while (qualities.length < RARITIES.length) qualities.push(false);
  qualities.length = RARITIES.length;
  for (var qr = 0; qr < RARITIES.length; qr++) {
    if (isGodforgedRarity(qr)) qualities[qr] = false;
  }
  return {
    id: id,
    enabled: true,
    qualities: qualities,                        // index=品質，true=該品質裝備自動入帶拆解
    queue: [],                                   // 專屬佇列（總佇列派發而來；帶尾 +N＝此佇列件數）
    belt: [],                                    // 傳送帶（純裝備陣列，帶頭先入爐；自專屬佇列補位）
    timer: 0,
    partSlots: NEW_FORGE_PART_SLOTS_INITIAL,     // 已解鎖零件格數（金幣逐格解鎖至 8）
    parts: []                                    // 已置入零件 key（等級由 factory.partLevels 即時提供）
  };
}

function newPartLevels() {
  var levels = {};
  Object.keys(PART_TYPES).forEach(function (key) { levels[key] = 1; });
  return levels;
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

    savedAt: Date.now(),
    player: {
      level: 1, xp: 0,
      reincarnations: 0,
      reincarnationTalentPoints: 0,
      talents: { levels: {}, potentialLevels: {} },
      gold: INITIAL_GOLD, scrap: INITIAL_SCRAP, essence: INITIAL_ESSENCE, ancientEssence: 0, soulOrigin: 0,
      dust: 0,                // 魔塵（神鑄材料）
      magicScroll: 0,         // 魔法卷軸（技能融合材料；取得比照附魔精華、數量 1/10）
      gems: gems,
      fusedGems: [],          // 融合寶石（雙屬性，個別實體）
      gemShop: { level: 1, items: [], refreshCount: 0, hourStart: Date.now() },
      books: books,
      invUpgrades: 0,
      // 技能：初始自帶 3 個 1 級技能；技能點由「技能熟練度」提供（2026-07-30 改制）
      skills: { powerSlash: 1, arcaneBurst: 1, manaBarrier: 1 },
      skillUnlocks: { powerSlash: true, arcaneBurst: true, manaBarrier: true }, // 人物等級達標後永久解鎖的技能
      skillPoints: 0,
      skillMastery: { level: 0, xp: 0 }, // 技能熟練度：打怪/道具給經驗，每級 1 技能點，0~1000 級
      loadout: ['powerSlash', 'arcaneBurst', 'manaBarrier'],
      fusions: []   // 玩家自創的融合技定義（{components, seed} 種子重算制）

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
      swamp:  { current: 1, best: 1 },
      undead_mountains: { current: 1, best: 1 },
      god_battlefield: { current: 1, best: 1 },
      god_chaos: { current: 1, best: 1 },
      god_sanctuary: { current: 1, best: 1 }
    },
    factory: {
      filter: { actions: ['salvage', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep'], smartSalvage: false },
      autoEquip: true,
      salvage: {},
      synth: { enabled: false, mergeEnabled: true, hybridEnabled: true, minGemLevel: 1, bookChoice: 'any' },
      enchant: { enabled: false, overwrite: false },
      upgrade: { enabled: false, cap: 5 },
      conveyor: [],
      synthBuffer: [],
      parts: [],
      partLevels: newPartLevels(),
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
    settings: { compareEq: true },
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
function normalizePlayerXpValue(value) {
  // Infinity 只可能來自執行期極端大量入帳；保留它，讓結算流程把角色推到最高級。
  if (value === Infinity) return value;
  var n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/* 將目前經驗完整結算。除了 gainXp 外，讀檔後也必須呼叫這支，因為升級公式
   可能在兩次存檔之間調整，舊存檔的 xp 可能已經超過新公式的下一級門檻。 */
function settlePlayerXp(options) {
  options = options || {};
  var p = options.player || (typeof G !== 'undefined' && G ? G.player : null);
  if (!p) return 0;

  var level = Number(p.level);
  p.level = Number.isFinite(level) ? clamp(Math.floor(level), 1, MAX_LEVEL) : 1;
  p.xp = normalizePlayerXpValue(p.xp);

  var gained = 0;
  while (p.level < MAX_LEVEL) {
    var need = Number(xpForLevel(p.level));
    // 公式異常時停止，避免壞資料造成無限迴圈；正常公式永遠是正的有限值。
    if (!Number.isFinite(need) || need <= 0 || p.xp < need) break;
    p.xp -= need;
    p.level++;
    gained++;
    // 2026-07-30 技能熟練度制：升級不再給技能點（技能點改由技能熟練度提供，見 skills.js）
    if (reincarnationCount() > 0) {
      p.reincarnationTalentPoints = (p.reincarnationTalentPoints || 0) + 1;
    }
  }
  if (p.level >= MAX_LEVEL) p.xp = 0;
  if (gained > 0) {
    markStatsDirty();
    var reward = reincarnationCount() > 0
      ? '、<span class="log-hl-good">轉生天賦點 +' + gained + '</span>'
      : '';
    if (options.silent !== true && typeof blog === 'function') {
      blog('🎉 等級提升！目前等級 ' + p.level + '（四維主屬性 +2' + reward + '）', 'good');
    }
    // 升級回滿血藍
    if (typeof getStats === 'function') {
      var st = getStats();
      if (typeof FIELD !== 'undefined' && FIELD && FIELD.player) {
        FIELD.player.hp = st.hp; FIELD.player.mp = st.mp;
      }
    }
    if (typeof UI !== 'undefined' && UI.dirty) {
      UI.dirty.header = true; UI.dirty.skills = true; UI.dirty.talents = true;
    }
  }
  return gained;
}

function gainXp(n) {
  var p = G.player;
  var amount = Number(n);
  // 無效／負數入帳不應污染 xp；但仍結算既有的溢出經驗，修復舊存檔也不必等下一筆有效收益。
  if (!Number.isNaN(amount) && amount >= 0) {
    p.xp = normalizePlayerXpValue(p.xp) + amount;
  } else {
    p.xp = normalizePlayerXpValue(p.xp);
  }
  return settlePlayerXp();
}

/* ---- 轉生 ----
   保留裝備、技能、資源與關卡，只重置等級／經驗；轉生後的天賦點持續累計。 */
function reincarnate() {
  var p = G.player;
  var count = reincarnationCount();
  if (count >= REINCARNATION_MAX) return '已達最高轉生次數（' + REINCARNATION_MAX + ' 轉）';
  if (p.level < REINCARNATION_LEVEL) return '角色尚未達到 ' + REINCARNATION_LEVEL + ' 級';
  p.reincarnations = count + 1;
  p.level = 1;
  p.xp = 0;
  G.equipActive = 0;
  G.equipView = 0;
  G.equipment = G.equipmentSets[0];
  // 技能熟練度（技能點來源）不受轉生影響；轉生後所有技能等級上限 +5（skillMaxLv 查表）。
  markStatsDirty();
  if (typeof FIELD !== 'undefined' && FIELD && FIELD.player) {
    var st = getStats();
    FIELD.player.hp = st.hp;
    FIELD.player.mp = st.mp;
    FIELD.player.shield = 0;
    FIELD.player.shieldMax = 0;
    FIELD.player.shieldMaxVersion = SHIELD_MAX_VERSION;
    FIELD.player.skillCds = {};
    FIELD.player.skillGcd = 0;
    // 45 新技能：轉生重置技能冷卻時，一併清空技能執行期狀態（比照 skillCds）
    if (typeof resetSkillRT === 'function') resetSkillRT();
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
  if (!equipmentSetUnlocked(i)) return;
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
  if (!equipmentSetUnlocked(i)) return;
  G.equipActive = i;
  G.equipView = i;
  G.equipment = G.equipmentSets[i]; // 重導使用中那套
  markStatsDirty();
  UI.dirty.equip = true; UI.dirty.header = true; UI.dirty.battle = true;
}

/* ---- 裝備操作 ----
   武器依類型決定可裝欄位（equipSlotsForItem）：單手武器可雙持、副手武器僅副手、
   雙手武器裝在主手並同時佔據副手；戒指類可裝入主/副兩欄。
   多候選欄位時優先裝入空欄，皆有裝備時替換較弱者。
   eq 可指定目標套（預設使用中 G.equipment；面板檢視非使用中套時傳入檢視套）。 */
function equipTargetSlot(it, eq) {
  eq = eq || G.equipment;
  var cands = equipSlotsForItem(it);
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

// 穿上裝備（可指定欄位與目標套），回傳被替換下來的舊裝備（可能為 null）。
// 雙手武器佔據主副手：連帶被擠下的另一件（副手或雙手主武器）直接退回背包（滿載時走 addToInventory 既有規則）。
function equipItem(it, slotKey, eq) {
  eq = eq || G.equipment;
  var key = slotKey || equipTargetSlot(it, eq);
  // 裝上雙手武器 → 副手一併卸下
  if (key === 'weapon' && isTwoHandItem(it) && eq.weapon2) {
    var off = eq.weapon2;
    eq.weapon2 = null;
    off.locked = false;
    addToInventory(off);
    blog('🗡️ 雙手武器佔據主副手：已卸下副手 ' + rarityTag(off), 'info');
  }
  // 主手為雙手武器時要裝副手 → 先卸下該雙手武器
  if (key === 'weapon2' && isTwoHandItem(eq.weapon)) {
    var mh = eq.weapon;
    eq.weapon = null;
    mh.locked = false;
    addToInventory(mh);
    blog('🗡️ 裝備副手：已卸下佔用雙欄的 ' + rarityTag(mh), 'info');
  }
  /* ⚠️ 同一件裝備不得同時佔兩個欄位。

     戒指與武器各有主副兩欄，而「把已經戴在 ring 的那只再裝到 ring2」是完全合法的
     呼叫（resolveItem 會從裝備欄找到它）。少了這一段的話 eq.ring 與 eq.ring2 會
     指向**同一個物件**，而且兩次呼叫都回成功、沒有任何警告。

     後果不只是屬性被算兩次：
       存檔    JSON.stringify 把同一個物件寫成兩份，id 相同
       讀檔    變成兩個獨立物件共用一個 id
       之後    resolveItem 回「ambiguous item id（命中 2 個）」——
               這件裝備從此不能強化、不能洗煉、也不能卸下，永久磚掉

     而且它會自我繁殖：item.unequip 只清掉找到的第一個欄位就 break，
     接著 addToInventory 讓背包與裝備欄同時持有；下一次換裝再把同一個物件
     addToInventory 一次，背包裡就出現兩份。

     實測 84 個模擬存檔有 74 個含重複 id（最舊的批次就有），
     單一存檔中位數 2~19 組。裝到另一個欄位的正確語意是**移動**，不是複製。 */
  for (var sk in eq) {
    if (eq[sk] === it && sk !== key) eq[sk] = null;
  }
  var old = eq[key];
  if (old === it) old = null;                 // 原地重裝：沒有被換下來的那件
  eq[key] = it;
  if (eq === G.equipment) markStatsDirty(); // 只有動到使用中那套才需重算屬性
  UI.dirty.equip = true; UI.dirty.header = true;
  return old;
}

// 自動穿裝：只填補空的裝備部位；已有裝備後不再自動替換。
// 雙手武器需主副手皆空才自動穿；副手欄被雙手武器佔用時視同已有裝備。
function tryAutoEquip(it) {
  var cands = equipSlotsForItem(it);
  for (var i = 0; i < cands.length; i++) {
    var key = cands[i];
    if (G.equipment[key]) continue;
    if (slotBlockedByTwoHand(G.equipment, key)) continue;        // 副手被雙手武器連帶佔用
    if (isTwoHandItem(it) && G.equipment.weapon2) continue;      // 雙手武器不自動擠下副手
    equipItem(it, key);
    blog('🎽 自動穿裝：' + rarityTag(it) + '（' + SLOT_INFO[key].name + '）', 'info');
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
