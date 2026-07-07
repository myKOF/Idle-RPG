'use strict';
/* ============ 玩家狀態與屬性計算（50+ 屬性系統） ============ */

function newGameState() {
  var equipment = {};
  SLOT_LIST.forEach(function (s) { equipment[s] = null; });
  var books = {};
  for (var bk in ENCHANTS) books[bk] = 0;
  return {
    version: 1,
    savedAt: Date.now(),
    player: {
      level: 1, xp: 0,
      gold: 50, scrap: 0, essence: 0,
      gems: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      books: books
    },
    equipment: equipment,
    inventory: [],
    stage: { current: 1, best: 1, kills: 0, autoAdvance: true },
    factory: {
      filter: { actions: ['salvage', 'keep', 'keep', 'keep', 'keep', 'keep'], smartSalvage: false },
      autoEquip: true,
      salvage: {},
      synth: { enabled: true, mergeEnabled: true, hybridEnabled: true, gemMerge: true, minGemLevel: 1, bookChoice: 'any' },
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
    firstRunAt: Date.now()
  };
}

/* ---- 屬性彙總 ----
   流程：等級基礎四維 + 裝備詞條聚合 → 派生 50+ 屬性 */
var _statsCache = null;
function markStatsDirty() { _statsCache = null; }

// 元素抗性詞條 key（resFire...）→ 元素 key
function affixResElem(key) {
  if (!/^res[A-Z]/.test(key)) return null;
  var e = key.slice(3);
  return e.charAt(0).toLowerCase() + e.slice(1); // fire / ice / lightning / poison / light / dark
}

function computeStats() {
  var p = G.player;
  var prim = basePrimaryFor(p.level);
  // 聚合桶（詞條 key 與桶名一致；特例：aspd → aspdPct、resX → resist）
  var A = {
    str: prim.str, agi: prim.agi, int: prim.int, vit: prim.vit,
    hpFlat: 0, hpPct: 0, atkFlat: 0, atkPct: 0, matkFlat: 0, matkPct: 0,
    defFlat: 0, defPct: 0, mdefFlat: 0, mpFlat: 0,
    hpRegen: 0, mpRegen: 0, aspdPct: 0, critRate: 0, critDmg: 0,
    pPen: 0, mPen: 0, hit: 0, cdr: 0, castSpeed: 0, lifesteal: 0, manaSteal: 0,
    eliteDmg: 0, bossDmg: 0, aoeDmg: 0,
    blockRate: 0, blockDmgRed: 0, evasion: 0, tenacity: 0, shieldEff: 0, pRes: 0, mRes: 0,
    ccRed: 0, moveSpeed: 0, loot: 0, xpBonus: 0, goldBonus: 0, luck: 0, weight: 0,
    enhanceSuccess: 0, decomposeYield: 0, hybridMutation: 0, enrageThreshold: 0, affixCap: 0, gemEff: 0
  };
  var resist = { fire: 0, ice: 0, lightning: 0, poison: 0, light: 0, dark: 0, ctrl: 0 };
  var passives = {};
  var elemAtk = { fire: 0, ice: 0, lightning: 0, poison: 0, light: 0, dark: 0 };

  SLOT_LIST.forEach(function (slot) {
    var it = G.equipment[slot];
    if (!it) return;
    var um = upgradeMult(it);
    it.affixes.forEach(function (a) {
      var v = a.val * um;
      var k = a.key;
      var re = affixResElem(k);
      if (k === 'aspd') A.aspdPct += v;
      else if (re) resist[re] = (resist[re] || 0) + v;
      else if (A[k] !== undefined) A[k] += v;
    });
    if (it.passive) {
      passives[it.passive.key] = (passives[it.passive.key] || 0) + it.passive.val;
    }
    if (it.enchant) {
      var ek = it.enchant.key, ev = it.enchant.val;
      var e = ENCHANTS[ek];
      if (!e) return;
      if (e.cat === 'atk' && e.elem) elemAtk[e.elem] += ev;
      else if (ENCHANT_RES_MAP[ek]) resist[ENCHANT_RES_MAP[ek]] += ev;
      else if (ek === 'ctrlRes') resist.ctrl += ev;
      else if (ek === 'loot') A.loot += ev;
      else if (ek === 'haste') A.moveSpeed += ev;
    }
  });

  var lv = p.level;
  var st = { level: lv };
  // 四維主屬性
  st.str = Math.round(A.str); st.agi = Math.round(A.agi);
  st.int = Math.round(A.int); st.vit = Math.round(A.vit);
  // 基礎
  st.hp = Math.round((120 + (lv - 1) * 22 + st.vit * 10 + A.hpFlat) * (1 + A.hpPct / 100));
  st.hpRegen = A.hpRegen;                                    // 額外生命恢復/秒（另有 1.5%/秒 基礎回復）
  st.mp = Math.round(40 + st.int * 4 + A.mpFlat);
  st.mpRegen = 2 + st.int * 0.06 + A.mpRegen;
  // 進攻
  st.atk = Math.round((8 + (lv - 1) * 1.6 + st.str * 2 + A.atkFlat) * (1 + A.atkPct / 100));    // 物理攻擊
  st.matk = Math.round((6 + (lv - 1) * 1.2 + st.int * 2 + A.matkFlat) * (1 + A.matkPct / 100)); // 魔法攻擊
  st.critRate = clamp(5 + st.agi * 0.06 + A.critRate, 0, 100);
  st.critDmg = 150 + A.critDmg;
  st.pPen = clamp(A.pPen, 0, 80);
  st.mPen = clamp(A.mPen, 0, 80);
  st.hit = 100 + A.hit;
  st.aspd = clamp(1.0 * (1 + (A.aspdPct + st.agi * 0.15) / 100), 0.2, 5);
  st.cdr = clamp(A.cdr, 0, 60);
  st.castSpeed = clamp(A.castSpeed, 0, 50);
  st.lifesteal = clamp(A.lifesteal, 0, 60);
  st.manaSteal = clamp(A.manaSteal, 0, 30);
  st.eliteDmg = A.eliteDmg;
  st.bossDmg = A.bossDmg;
  st.aoeDmg = A.aoeDmg;
  // 防禦
  st.def = Math.round((4 + (lv - 1) * 1.0 + st.vit * 0.9 + A.defFlat) * (1 + A.defPct / 100));   // 物理防禦
  st.mdef = Math.round((3 + (lv - 1) * 0.8 + st.int * 0.7 + A.mdefFlat) * (1 + A.defPct / 100)); // 魔法防禦
  st.blockRate = clamp(A.blockRate, 0, 50);
  st.blockDmgRed = clamp(A.blockDmgRed, 0, 50);
  st.evasion = clamp(st.agi * 0.08 + A.evasion, 0, 40);
  st.tenacity = clamp(A.tenacity, 0, 60);
  st.shieldEff = A.shieldEff;
  st.pRes = clamp(A.pRes, 0, 60);
  st.mRes = clamp(A.mRes, 0, 60);
  // 元素抗性
  ELEMENTS.forEach(function (e2) { resist[e2] = clamp(resist[e2], 0, 75); });
  resist.ctrl = clamp(resist.ctrl, 0, 80);
  st.resist = resist;
  // 特殊與機制
  st.ccRed = clamp(A.ccRed, 0, 60);
  st.moveSpeed = clamp(A.moveSpeed, 0, 50);
  st.loot = A.loot;
  st.xpBonus = A.xpBonus;
  st.goldBonus = A.goldBonus;
  st.luck = clamp(A.luck, 0, 100);
  st.weight = Math.round(st.str * 0.5 + A.weight);
  st.enhanceSuccess = A.enhanceSuccess;
  st.decomposeYield = A.decomposeYield;
  st.hybridMutation = clamp(A.hybridMutation, 0, 60);
  st.enrageThreshold = clamp(A.enrageThreshold, 0, 30);
  st.affixCap = clamp(A.affixCap, 0, 100);
  st.gemEff = A.gemEff;
  // 被動上限
  if (passives.doubleHit) passives.doubleHit = Math.min(passives.doubleHit, 45);
  if (passives.stun) passives.stun = Math.min(passives.stun, 30);
  st.passives = passives;
  st.elemAtk = elemAtk;
  return st;
}

function getStats() {
  if (!_statsCache) _statsCache = computeStats();
  return _statsCache;
}

/* ---- 經驗 / 升級 ---- */
function gainXp(n) {
  var p = G.player;
  p.xp += n;
  var leveled = false;
  while (p.xp >= xpForLevel(p.level)) {
    p.xp -= xpForLevel(p.level);
    p.level++;
    leveled = true;
  }
  if (leveled) {
    markStatsDirty();
    blog('🎉 等級提升！目前等級 ' + p.level + '（四維主屬性 +2）', 'good');
    // 升級回滿血藍
    var st = getStats();
    if (FIELD.player) { FIELD.player.hp = st.hp; FIELD.player.mp = st.mp; }
    UI.dirty.header = true;
  }
}

/* ---- 裝備操作 ---- */
// 穿上裝備，回傳被替換下來的舊裝備（可能為 null）
function equipItem(it) {
  var old = G.equipment[it.slot];
  G.equipment[it.slot] = it;
  markStatsDirty();
  UI.dirty.equip = true; UI.dirty.header = true;
  return old;
}

// 嘗試自動換裝：若比目前裝備強則穿上，舊裝回輸送帶。回傳是否換裝
function tryAutoEquip(it) {
  var cur = G.equipment[it.slot];
  if (itemScore(it) > itemScore(cur) * 1.02) {
    var old = equipItem(it);
    blog('🔁 自動換裝：' + rarityTag(it) + '（' + SLOT_INFO[it.slot].name + '）', 'info');
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

// 放入背包（滿了自動分解）
function addToInventory(it) {
  if (G.inventory.length >= INVENTORY_CAP) {
    var res = doSalvage(it, true);
    flog('📦 背包已滿，自動分解 ' + rarityTag(it) + ' → 碎片x' + res.scrap, 'warn');
    return false;
  }
  G.inventory.push(it);
  UI.dirty.inv = true;
  return true;
}
