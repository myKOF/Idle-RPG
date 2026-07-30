'use strict';
var CHAOS_IDX = 9;
var CHAOS_GODFORGED_IDX = 10;
var MAX_RARITY_IDX = CHAOS_GODFORGED_IDX;
var REROLL_CHAOS_ESSENCE_COST = 27;
var REROLL_CHAOS_GODFORGED_ESSENCE_COST = 36;
var FORGE_CHAOS_BASE_RATE = 20;
var FORGE_CHAOS_GOLD_COST = 500000000;
var FORGE_CHAOS_DUST_RATE = 3;
var FORGE_CHAOS_DURATION = 13;
var CHAOS_FIELD_DROP_MIN_STAGE = 551;
var CHAOS_FIELD_DROP_PCT = 1;
var CHAOS_FIELD_DROP_ZONES = { god_battlefield: 1, god_chaos: 1, god_sanctuary: 1 };
function isGodforgedRarity(rarity) {
  return rarity === GODFORGED_IDX || rarity === CHAOS_GODFORGED_IDX;
}
function forgeBaseRateFor(rarity) {
  return rarity === CHAOS_IDX ? FORGE_CHAOS_BASE_RATE : (FORGE_BASE_RATE[rarity] || 0);
}
function forgeGoldCostFor(rarity) {
  return rarity === CHAOS_IDX ? FORGE_CHAOS_GOLD_COST : (FORGE_GOLD_COST[rarity] || 0);
}
function forgeEquipDurationFor(rarity) {
  return rarity === CHAOS_IDX ? FORGE_CHAOS_DURATION : (FORGE_EQUIP_DURATION[rarity] || 0);
}
function forgeDustRateFor(rarity) {
  return rarity === CHAOS_IDX ? FORGE_CHAOS_DUST_RATE : FORGE_DUST_RATE;
}
function isForgeableEquipmentRarity(rarity) {
  return rarity === CHAOS_IDX || Object.prototype.hasOwnProperty.call(FORGE_BASE_RATE, rarity);
}
/* ============ 遊戲資料定義 ============ */

/* ---- 稀有度（11 階）----
   affix: 固定詞條數（上下限相同）｜sockets: 寶石鑲孔數｜enchants: 附魔欄位數
   godforged（神鑄創世）：僅能由神鑄系統以 6 件創世鑄造獲得，不自然掉落、
   不可由熔爐合成升階；mult = 創世 × 1.5（詞條數值與洗煉上限同步 1.5 倍）。 */
var RARITIES = [
  { key: 'common', name: '普通', color: '#9aa5b1', mult: 1.0, affix: [1, 1], sockets: 1, enchants: 0, salv: 1.0 },
  { key: 'uncommon', name: '精良', color: '#4ade80', mult: 1.35, affix: [2, 2], sockets: 1, enchants: 1, salv: 1.7 },
  { key: 'rare', name: '稀有', color: '#38bdf8', mult: 1.75, affix: [2, 2], sockets: 1, enchants: 1, salv: 2.8 },
  { key: 'unique', name: '獨特', color: '#ffd700', mult: 2.3, affix: [3, 3], sockets: 2, enchants: 1, salv: 4.5 },
  { key: 'epic', name: '史詩', color: '#c084fc', mult: 3.0, affix: [4, 4], sockets: 3, enchants: 2, salv: 7.5 },
  { key: 'legendary', name: '傳說', color: '#fb923c', mult: 4.0, affix: [5, 5], sockets: 4, enchants: 2, salv: 12 },
  { key: 'mythic', name: '神話', color: '#f87171', mult: 5.2, affix: [6, 6], sockets: 5, enchants: 2, salv: 19 },
  { key: 'genesis', name: '創世', color: '#b8860b', mult: 6.8, affix: [7, 7], sockets: 6, enchants: 3, salv: 30 },
  { key: 'godforged', name: '神鑄創世', color: '#f5c542', mult: 10.2, affix: [8, 8], sockets: 6, enchants: 3, salv: 45 },
  { key: 'chaos', name: '混沌', color: '#c084fc', mult: 15.3, affix: [9, 9], sockets: 6, enchants: 3, salv: 67.5 },
  { key: 'chaosGodforged', name: '神鑄混沌', color: '#ff6bcb', mult: 22.95, affix: [10, 10], sockets: 7, enchants: 3, salv: 101.25 }
];
var PASSIVE_MIN_RARITY = 5; // 傳說級（含）以上附帶傳奇特效
var MAX_AFFIXES = 10; // 單件裝備詞條數安全硬上限（目前稀有度表最高 10 條）
var EQUIP_TIER_SIZE = 50; // 裝備等級分段大小：來源等級 1~49 → 1 級裝，之後每 50 級一套（50/100/150…；equipmentTierLevel → formula.js §6）
var REROLL_ESSENCE_COST = { 6: 9, 7: 14, 8: 20, 9: REROLL_CHAOS_ESSENCE_COST, 10: REROLL_CHAOS_GODFORGED_ESSENCE_COST }; // 神話／創世／神鑄與混沌系列洗煉精華費用

/* ---- 太古詞條與太古精華 ---- */
// 太古詞條產生率表（2026-07-23 改版）：裝備產出時依「詞條數量」擲骰決定太古詞條條數，
// 位置隨機決定後永久固定（洗煉不變位置）。權重 %，索引 = 太古條數（0~N）。
// 表外詞條數量（0/1 或 >10）一律 0 條。擲骰 rollAncientAffixCount → js/formula.js §6。
var ANCIENT_COUNT_WEIGHTS = {
  2: [92, 7.5, 0.5],
  3: [78.1, 19.2, 2.4, 0.3],
  4: [72.11, 22.12, 4.61, 0.96, 0.2],
  5: [74.35, 18.74, 5.07, 1.37, 0.37, 0.1],
  6: [76.87, 15.04, 5.28, 1.85, 0.65, 0.23, 0.08],
  7: [69.92, 18.53, 7.13, 2.74, 1.05, 0.41, 0.16, 0.06],
  8: [64.22, 21.19, 8.65, 3.53, 1.44, 0.59, 0.24, 0.1, 0.04],
  9: [59.92, 23.53, 9.72, 4.02, 1.66, 0.69, 0.28, 0.12, 0.05, 0.02],
  10: [54.72, 26.42, 11.01, 4.59, 1.91, 0.8, 0.33, 0.14, 0.06, 0.02, 0.01]
};
var ANCIENT_ESSENCE_ENEMY_MIN_LEVEL = 49;
var ANCIENT_ESSENCE_ENEMY_BASE_RATE = 1;
var ANCIENT_ESSENCE_ENEMY_LEVEL_RATE = 0.1;
var ANCIENT_ESSENCE_ENEMY_RATE_CAP = 10;
var ANCIENT_ESSENCE_BOSS_BASE_RATE = 10;
var ANCIENT_ESSENCE_BOSS_LEVEL_RATE = 2;
var ANCIENT_ESSENCE_BOSS_RATE_CAP = 100;
var ANCIENT_ESSENCE_SALVAGE_CHANCE = { 4: 0.5, 5: 1, 6: 10, 7: 100, 8: 100 };
var ANCIENT_AFFIX_VALUE_MULT = 1.35;
var ANCIENT_LUCK_WEIGHT_MULT = 0.5;
var ANCIENT_LUCK_WEIGHT_DENOM = 4000;
var DEMON_SEED_BOSS_BASE_RATE = 10;
var DEMON_SEED_BOSS_PER_FLOOR = 2;
var DEMON_SEED_BOSS_RATE_CAP = 100;

/* ---- 轉生系統 ----
   生命與四維在原始總值完成後套用最終倍率：
   1～10 轉分別為 ×10、×20、×40、×80、×160、×320、×640、×1280、×2560、×5120。 */
var MAX_LEVEL = 1000;             // 角色等級上限（升級所需經驗 參數 d）
var SKILL_POINT_BUDGET_CAP = 10000; // 技能點總預算上限（技能點總預算 參數 c）
var REINCARNATION_LEVEL = 1000;   // 可轉生等級：達此級可轉生（可轉生等級 參數 a）
var REINCARNATION_MAX = 20;
var REINCARNATION_RANKS = ['冒險者', '勇者', '大劍師', '破世者', '不朽者', '王者', '大主宰', '神聖尊者', '大聖王', '至高主宰', '位面創世神', '神位1階', '神位2階', '神位3階', '神位4階', '神位5階', '神位6階', '神位7階', '神位8階', '神位9階', '神位終階'];
var REINCARNATION_EXTRA_MULTIPLIERS = [0, 1.5, 2.5, 3.5, 5, 7, 10, 14, 18, 24, 30, 60, 100, 150, 200, 300, 450, 650, 800, 1200, 2500];
// 升級經驗基礎增加值：升級所需經驗在括號外再加此值（依轉生次數；轉生 0 次為 0，1~10 次見轉生對照表 參數 c）。
var REINCARNATION_EXP_BASE_ADD = [0, 500000, 1500000, 3000000, 6000000, 12000000, 24000000, 48000000, 96000000, 192000000, 384000000, 768000000, 1536000000, 3072000000, 6144000000, 12288000000, 24576000000, 49152000000, 98304000000, 196608000000, 393216000000];
var REINCARNATION_EXP_MULTIPLIERS = [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000, 1e11, 1e13, 1e15, 1e17, 1e19, 1e21, 1e23, 1e25, 1e27, 1e29, 1e33];
var REINCARNATION_SKILL_MAX_LEVELS = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120];
var REINCARNATION_FUSION_MAX_LEVELS = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240];

/* ---- 天賦系統（1 轉後開放；《天賦V2》實作 1～10 轉全部天賦） ----
   一般天賦每轉 8 個、每個最高 100 級；數值為每級增量，51 級起使用 high。
   升級成本 = 該天賦轉數 + 1（固定值/級）；整轉 8 個全滿該轉效果 ×2。
   「額外」字樣 = 於對應總值上乘算；沒寫「額外」= 與現有同類加成相加。
   「潛力」為新的技能分類，登錄 10 個節點，依 3/4/7/10 轉解鎖天賦（unlocks 數）逐批開放；
   潛力解鎖天賦目前整批鎖定置灰（disabled），待潛力技能完成後開放。 */
var TALENT_MAX_LEVEL = 100;
var TALENT_EFFECT_BREAK_LEVEL = 50;
var TALENT_IMPLEMENTED_REINCARNATIONS = 10;
var POTENTIAL_NODE_COUNT = 10;
var POTENTIAL_SKILL_BASE_MAX_LEVEL = 20;
var TALENT_TREES = {
  1: [
    { id: 't1_str', name: '力量淬鍊', emoji: '💪', stat: 'strPct', low: 0.5, high: 1, desc: '力量總值額外提高' },
    { id: 't1_agi', name: '迅捷淬鍊', emoji: '🪽', stat: 'agiPct', low: 0.5, high: 1, desc: '敏捷總值額外提高' },
    { id: 't1_int', name: '奧術淬鍊', emoji: '🔮', stat: 'intPct', low: 0.5, high: 1, desc: '智力總值額外提高' },
    { id: 't1_vit', name: '鋼骨淬鍊', emoji: '🦴', stat: 'vitPct', low: 0.5, high: 1, desc: '耐力總值額外提高' },
    { id: 't1_def', name: '物防鍛體', emoji: '🛡️', stat: 'defPct', low: 0.5, high: 1, desc: '物理防禦總值額外提高' },
    { id: 't1_mdef', name: '魔防鍛體', emoji: '🔰', stat: 'mdefPct', low: 0.5, high: 1, desc: '魔法防禦總值額外提高' },
    { id: 't1_pres', name: '物理抗性', emoji: '🪨', stat: 'pRes', low: 0.5, high: 1, desc: '物理抗性總值額外提高' },
    { id: 't1_mres', name: '魔法抗性', emoji: '🌌', stat: 'mRes', low: 0.5, high: 1, desc: '魔法抗性總值額外提高' }
  ],
  2: [
    { id: 't2_crit', name: '致命直覺', emoji: '🎯', stat: 'critRate', low: 5, high: 10, desc: '爆擊率提高' },
    { id: 't2_critdmg', name: '致命裂痕', emoji: '💥', stat: 'critDmg', low: 75, high: 150, desc: '爆擊傷害提高' },
    { id: 't2_evasion', name: '幻影步', emoji: '👻', stat: 'evasion', low: 5, high: 10, desc: '閃避率提高' },
    { id: 't2_hit', name: '洞察弱點', emoji: '👁️', stat: 'hit', low: 5, high: 10, desc: '命中率提高' },
    { id: 't2_hp', name: '生命洪流', emoji: '❤️', stat: 'hpPct', low: 1, high: 2, desc: '生命總值額外提高' },
    { id: 't2_shield', name: '護盾脈衝', emoji: '🔵', stat: 'shieldEff', low: 1, high: 2, desc: '護盾總值額外提高' },
    { id: 't2_normalred', name: '獵人本能', emoji: '🐺', stat: 'normalDmgRed', low: 1, high: 2, desc: '對普通敵人抗性額外提高' },
    { id: 't2_elitered', name: '鎮壓意志', emoji: '🦁', stat: 'eliteDmgRed', low: 1, high: 2, desc: '對菁英敵人抗性額外提高' }
  ],
  3: [
    { id: 't3_normal', name: '清場法則', emoji: '⚔️', stat: 'normalDmg', low: 0.5, high: 1, desc: '對普通敵人傷害額外提高' },
    { id: 't3_elite', name: '破菁法則', emoji: '🗡️', stat: 'eliteDmg', low: 0.5, high: 1, desc: '對菁英傷害額外提高' },
    { id: 't3_boss', name: '弒王法則', emoji: '👑', stat: 'bossDmg', low: 1, high: 2, desc: '對 BOSS 傷害額外提高' },
    { id: 't3_potential', name: '潛力啟示', emoji: '🔓', stat: 'potentialUnlock', low: 2, high: 4, unlocks: 3, desc: '解鎖新類型技能「潛力」三個並給予技能點' },
    { id: 't3_allres', name: '全域適應', emoji: '🧿', stat: 'elemRes', low: 0.5, high: 1, desc: '全屬性抗性額外提高' },
    { id: 't3_def', name: '重甲共鳴', emoji: '🛡️', stat: 'defPct', low: 0.5, high: 1, desc: '物理防禦總值額外提高' },
    { id: 't3_mdef', name: '魔鎧共鳴', emoji: '🔰', stat: 'mdefPct', low: 0.5, high: 1, desc: '魔法防禦總值額外提高' },
    { id: 't3_allres2', name: '傷害緩衝', emoji: '🌫️', stat: 'globalDmgRed', low: 0.5, high: 1, desc: '全局減傷額外提高' }
  ],
  4: [
    { id: 't4_phys', name: '武技昇華', emoji: '⚔️', stat: 'skillPhys', low: 0.5, high: 1, desc: '物理類技能效果額外提高' },
    { id: 't4_magic', name: '法術昇華', emoji: '✨', stat: 'skillMagic', low: 0.5, high: 1, desc: '魔法類技能效果額外提高' },
    { id: 't4_def', name: '守護昇華', emoji: '🛡️', stat: 'skillDef', low: 0.5, high: 1, desc: '防禦與治療類技能效果額外提高' },
    { id: 't4_special', name: '奇策昇華', emoji: '🎲', stat: 'skillSpecial', low: 0.5, high: 1, desc: '特殊類技能效果額外提高' },
    { id: 't4_passive', name: '被動昇華', emoji: '🧬', stat: 'skillPassive', low: 0.5, high: 1, desc: '被動類技能效果額外提高' },
    { id: 't4_potential', name: '潛力覺醒', emoji: '🌠', stat: 'potentialUnlock', low: 2, high: 4, unlocks: 3, desc: '解鎖新類型技能「潛力」三個並給予技能點' },
    { id: 't4_normalred', name: '獵人壁壘', emoji: '🐺', stat: 'normalDmgRed', low: 2, high: 4, desc: '對普通敵人抗性額外提高' },
    { id: 't4_elitered', name: '鎮壓壁壘', emoji: '🦁', stat: 'eliteDmgRed', low: 2, high: 4, desc: '對菁英敵人抗性額外提高' }
  ],
  5: [
    { id: 't5_fire', name: '烈焰共鳴', emoji: '🔥', stat: 'elemFire', low: 0.5, high: 1, desc: '攻擊時額外附加' },
    { id: 't5_ice', name: '寒霜共鳴', emoji: '❄️', stat: 'elemIce', low: 0.5, high: 1, desc: '攻擊時額外附加' },
    { id: 't5_lightning', name: '雷霆共鳴', emoji: '⚡', stat: 'elemLightning', low: 0.5, high: 1, desc: '攻擊時額外附加' },
    { id: 't5_poison', name: '毒脈共鳴', emoji: '☠️', stat: 'elemPoison', low: 0.5, high: 1, desc: '攻擊時額外附加' },
    { id: 't5_light', name: '聖輝共鳴', emoji: '🌟', stat: 'elemLight', low: 0.5, high: 1, desc: '攻擊時額外附加' },
    { id: 't5_dark', name: '暗影共鳴', emoji: '🌑', stat: 'elemDark', low: 0.5, high: 1, desc: '攻擊時額外附加' },
    { id: 't5_allres', name: '全域壁壘', emoji: '🧿', stat: 'elemRes', low: 1, high: 2, desc: '全屬性抗性額外提高' },
    { id: 't5_global', name: '傷害偏折', emoji: '🌀', stat: 'globalDmgRed', low: 1, high: 2, desc: '全局減傷額外提高' }
  ],
  6: [
    { id: 't6_vsfire', name: '滅焰打擊', emoji: '🔥', stat: 'dmgVsFire', low: 2, high: 4, desc: '對火屬性敵人傷害提高' },
    { id: 't6_vsice', name: '碎冰打擊', emoji: '❄️', stat: 'dmgVsIce', low: 2, high: 4, desc: '對冰屬性敵人傷害提高' },
    { id: 't6_vslightning', name: '斷雷打擊', emoji: '⚡', stat: 'dmgVsLightning', low: 2, high: 4, desc: '對電屬性敵人傷害提高' },
    { id: 't6_vspoison', name: '淨毒打擊', emoji: '☠️', stat: 'dmgVsPoison', low: 2, high: 4, desc: '對毒屬性敵人傷害提高' },
    { id: 't6_vsdark', name: '驅暗打擊', emoji: '🌑', stat: 'dmgVsDark', low: 2, high: 4, desc: '對暗屬性敵人傷害提高' },
    { id: 't6_vslight', name: '蝕聖打擊', emoji: '🌟', stat: 'dmgVsLight', low: 2, high: 4, desc: '對聖屬性敵人傷害提高' },
    { id: 't6_boss', name: '弒王進階', emoji: '👑', stat: 'bossDmg', low: 1, high: 2, desc: '對 BOSS 傷害額外提高' },
    { id: 't6_bossred', name: '屠龍血鎧', emoji: '🐉', stat: 'bossDmgRed', low: 1, high: 2, desc: '對 BOSS 敵人抗性額外提高' }
  ],
  7: [
    { id: 't7_patk', name: '武力賁張', emoji: '🗡️', stat: 'patkPct', low: 0.5, high: 1, desc: '物理攻擊總值額外提高' },
    { id: 't7_matk', name: '奧能賁張', emoji: '🪄', stat: 'matkPct', low: 0.5, high: 1, desc: '魔法攻擊總值額外提高' },
    { id: 't7_allres', name: '萬象壁壘', emoji: '🌈', stat: 'elemRes', low: 2, high: 4, desc: '全屬性抗性額外提高' },
    { id: 't7_evasion', name: '無影迷蹤', emoji: '💨', stat: 'evasion', low: 10, high: 20, desc: '閃避率提高' },
    { id: 't7_hit', name: '天眼鎖定', emoji: '🎯', stat: 'hit', low: 10, high: 20, desc: '命中率提高' },
    { id: 't7_global', name: '絕對偏折', emoji: '🕳️', stat: 'globalDmgRed', low: 2, high: 4, desc: '全局減傷額外提高' },
    { id: 't7_potential', name: '潛力爆發', emoji: '💥', stat: 'potentialUnlock', low: 2, high: 4, unlocks: 3, desc: '解鎖新類型技能「潛力」三個並給予技能點' },
    { id: 't7_totaldmg', name: '破壞本源', emoji: '☄️', stat: 'totalDmgPct', low: 0.25, high: 0.5, desc: '總傷害額外增加' }
  ],
  8: [
    { id: 't8_rvsfire', name: '禦焰之心', emoji: '🔥', stat: 'resVsFire', low: 3, high: 6, desc: '對火屬性敵人抗性提高' },
    { id: 't8_rvsice', name: '禦冰之心', emoji: '❄️', stat: 'resVsIce', low: 3, high: 6, desc: '對冰屬性敵人抗性提高' },
    { id: 't8_rvslightning', name: '禦雷之心', emoji: '⚡', stat: 'resVsLightning', low: 3, high: 6, desc: '對電屬性敵人抗性提高' },
    { id: 't8_rvspoison', name: '禦毒之心', emoji: '☠️', stat: 'resVsPoison', low: 3, high: 6, desc: '對毒屬性敵人抗性提高' },
    { id: 't8_rvsdark', name: '禦暗之心', emoji: '🌑', stat: 'resVsDark', low: 3, high: 6, desc: '對暗屬性敵人抗性提高' },
    { id: 't8_rvslight', name: '禦聖之心', emoji: '🌟', stat: 'resVsLight', low: 3, high: 6, desc: '對聖屬性敵人抗性提高' },
    { id: 't8_boss', name: '弒王極意', emoji: '👑', stat: 'bossDmg', low: 4, high: 8, desc: '對 BOSS 傷害額外提高' },
    { id: 't8_bossred', name: '屠龍聖鎧', emoji: '🐉', stat: 'bossDmgRed', low: 5, high: 10, desc: '對 BOSS 敵人抗性額外提高' }
  ],
  9: [
    { id: 't9_fire', name: '烈焰霸體', emoji: '🔥', stat: 'elemFire', low: 2, high: 4, desc: '攻擊時額外附加' },
    { id: 't9_ice', name: '寒霜霸體', emoji: '❄️', stat: 'elemIce', low: 2, high: 4, desc: '攻擊時額外附加' },
    { id: 't9_lightning', name: '雷霆霸體', emoji: '⚡', stat: 'elemLightning', low: 2, high: 4, desc: '攻擊時額外附加' },
    { id: 't9_poison', name: '毒脈霸體', emoji: '☠️', stat: 'elemPoison', low: 2, high: 4, desc: '攻擊時額外附加' },
    { id: 't9_light', name: '聖輝霸體', emoji: '🌟', stat: 'elemLight', low: 2, high: 4, desc: '攻擊時額外附加' },
    { id: 't9_dark', name: '暗影霸體', emoji: '🌑', stat: 'elemDark', low: 2, high: 4, desc: '攻擊時額外附加' },
    { id: 't9_pres', name: '不壞金身', emoji: '🪨', stat: 'pRes', low: 2, high: 4, desc: '物理抗性總值額外提高' },
    { id: 't9_mres', name: '不滅法身', emoji: '🌌', stat: 'mRes', low: 2, high: 4, desc: '魔法抗性總值額外提高' }
  ],
  10: [
    { id: 't10_str', name: '力量超昇', emoji: '💪', stat: 'strPct', low: 0.75, high: 1.5, desc: '力量總值額外提高' },
    { id: 't10_agi', name: '迅捷超昇', emoji: '🪽', stat: 'agiPct', low: 0.75, high: 1.5, desc: '敏捷總值額外提高' },
    { id: 't10_int', name: '奧術超昇', emoji: '🔮', stat: 'intPct', low: 0.75, high: 1.5, desc: '智力總值額外提高' },
    { id: 't10_vit', name: '鋼骨超昇', emoji: '🦴', stat: 'vitPct', low: 0.75, high: 1.5, desc: '耐力總值額外提高' },
    { id: 't10_bossred', name: '屠龍神鎧', emoji: '🐉', stat: 'bossDmgRed', low: 10, high: 20, desc: '對 BOSS 敵人抗性額外提高' },
    { id: 't10_gemeff', name: '寶石共鳴', emoji: '💎', stat: 'gemEff', low: 10, high: 20, desc: '寶石鑲嵌效率提高' },
    { id: 't10_totaldmg', name: '毀滅本源', emoji: '☄️', stat: 'totalDmgPct', low: 1, high: 2, desc: '總傷害額外增幅' },
    { id: 't10_potential', name: '潛力昇華', emoji: '🌌', stat: 'potentialUnlock', low: 2, high: 4, unlocks: 1, desc: '解鎖新類型技能「潛力」一個並給予技能點' }
  ]
};
/* ---- 潛力技能定義已移至 js/skills.js（隨 Skills.xlsx 調適；解鎖/等級/施放邏輯不變） ---- */

/* ---- 每波敵人數量（依敵種各自擲骰）----
   小怪／菁英／BOSS 三種**分開**設定：同樣出 16 隻，小怪還打得動，菁英根本打不了，
   BOSS 又佔 2×2 格、棋盤放不下。所以三者各有一張權重表。
   [數量, 權重]；權重只看相對大小，總和不必湊 100，權重 0 不會被抽中。
   數量上限為棋盤總格數（BF_COLS×BF_ROWS）。
   參數表：4-敵人數量 的三列，寫法為 {數量,權重} 或 {下限~上限,權重}。 */
var FIELD_ENEMY_COUNT_TABLE = [[1, 5], [2, 5], [3, 5], [4, 8], [5, 10], [6, 20], [7, 10], [8, 10], [9, 10], [10, 5], [11, 5], [12, 4], [13, 3], [14, 2], [15, 1], [16, 0.5]];
var FIELD_ELITE_COUNT_TABLE = [[1, 60], [2, 30], [3, 10]];
var FIELD_BOSS_COUNT_TABLE = [[1, 100]];

/* ---- 戰場站位（敵方棋盤）----
   敵方固定 BF_COLS 行 × BF_ROWS 列，我方是棋盤左側的單一單位。
   距離＝普攻與技能的選敵依據，數字越小越近：
     距離 = BF_DIST_PER_COL×(行-1) + (中央列 ? BF_DIST_CENTER_ROW : BF_DIST_OUTER_ROW)
   4×4 的結果即規格表：
          c1 c2 c3 c4
       r1  2  4  6  8
       r2  1  3  5  7      ← 我方在左側，對齊中央兩列
       r3  1  3  5  7
       r4  2  4  6  8
   格位判定與選敵邏輯 → js/battlefield.js */
var BF_COLS = 4;               // 敵方棋盤行數（由左至右，越右越遠）
var BF_ROWS = 4;               // 敵方棋盤列數
var BF_DIST_PER_COL = 2;       // 每往右一行增加的距離
var BF_DIST_CENTER_ROW = 1;    // 中央列的基礎距離
var BF_DIST_OUTER_ROW = 2;     // 外側列的基礎距離
var BF_BOSS_W = 2;             // BOSS 佔格寬（行）
var BF_BOSS_H = 2;             // BOSS 佔格高（列）

/* ---- 野外 BOSS ----
   每 FIELD_BOSS_STAGE_INTERVAL 階出現一次，優先於菁英階段（第 50 階出 BOSS 而非菁英）；
   固定單一敵人、佔 BF_BOSS_W×BF_BOSS_H 格、免疫控場（isBoss → formula.js §3）。
   倍率語意比照菁英：相對於同階段普通怪；攻速為絕對值不是倍率。 */
var FIELD_BOSS_STAGE_INTERVAL = 50;
var FIELD_BOSS_HP_MULT = 20;      // 生命倍率
var FIELD_BOSS_ATK_MULT = 6;      // 攻擊倍率
var FIELD_BOSS_DEF_MULT = 4;      // 物理／魔法防禦倍率
var FIELD_BOSS_REWARD_MULT = 12;  // 金幣與經驗倍率
var FIELD_BOSS_DODGE_ADD = 5;     // 閃避加成（百分點）
var FIELD_BOSS_ASPD = 1.2;        // 攻速（次/秒，絕對值）
var FIELD_BOSS_DROP_MULT = 3;     // 掉落倍率：裝備與材料統一乘此值（比照 ELITE_DROP_MULT）

/* ---- 野外怪物命中／閃避分段成長 ----
   rate 是該等級區間「每級增加值」；未填 max 代表從 min 起套用至無限。 */
var FIELD_MONSTER_HIT_BASE = 100;
var FIELD_MONSTER_HIT_GROWTH = [{ min: 1, max: 49, rate: 0.5 },
  { min: 50, max: 99, rate: 0.7 },
  { min: 100, max: 149, rate: 1 },
  { min: 150, max: 199, rate: 1.4 },
  { min: 200, max: 299, rate: 1.8 },
  { min: 300, rate: 2 }];
var FIELD_MONSTER_DODGE_BASE = 5;
var FIELD_MONSTER_DODGE_GROWTH = [{ min: 1, max: 49, rate: 0.5 },
  { min: 50, max: 99, rate: 0.65 },
  { min: 100, max: 149, rate: 0.8 },
  { min: 150, max: 199, rate: 1 },
  { min: 200, max: 299, rate: 1.2 },
  { min: 300, rate: 1.5 }];

/* ---- 裝備部位 ----
   SLOT_LIST = 裝備欄位（13 欄，含雙武器/雙戒指）；ITEM_TYPES = 物品種類（11 種）。
   武器/戒指類物品可裝入主/副兩個欄位（slotTypeOf 對應）。 */
var SLOT_LIST = ['weapon', 'weapon2', 'helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'ring2', 'amulet'];
var ITEM_TYPES = ['weapon', 'helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'];
// 欄位 → 物品種類
function slotTypeOf(slotKey) {
  if (slotKey === 'weapon2') return 'weapon';
  if (slotKey === 'ring2') return 'ring';
  return slotKey;
}
// 物品種類 → 可裝入的欄位
function equipSlotsForType(type) {
  if (type === 'weapon') return ['weapon', 'weapon2'];
  if (type === 'ring') return ['ring', 'ring2'];
  return [type];
}

/* ---- 武器類型系統（2026-07-23 武器改造）----
   武器大類三種：oneHand＝單手武器、twoHand＝雙手武器（裝在主手並同時佔據副手，
   副手不可再裝備）、offHand＝副手武器（只能裝在副手）。
   各類型實際可裝欄位以 slots 定義：單手武器中**僅單手匕首可雙持**（主/副手皆可、一次兩把），
   單手劍/單手魔杖/單手魔劍皆僅限主手。
   詞條暫沿用現行 weapon 部位詞條池（AFFIX_POOL slots:['weapon']），待後續分類型改造。 */
var WEAPON_CATEGORIES = {
  oneHand: { name: '單手武器' },
  twoHand: { name: '雙手武器' },
  offHand: { name: '副手武器' }
};
var DEFAULT_WEAPON_TYPE = 'sword1h'; // 舊存檔武器補默認類型（僅主手；裝在副手欄的舊武器由存檔整理改補匕首，保持位置合法）
var WEAPON_TYPES = {
  sword1h:      { name: '單手劍',   cat: 'oneHand', hands: 1, slots: ['weapon'], emoji: '🗡️', basenames: ['短劍', '長劍', '騎士劍'] },
  dagger1h:     { name: '單手匕首', cat: 'oneHand', hands: 1, slots: ['weapon', 'weapon2'], emoji: '🔪', basenames: ['小刀', '彎刃匕首', '刺客匕首'] },
  wand1h:       { name: '單手魔杖', cat: 'oneHand', hands: 1, slots: ['weapon'], emoji: '🪄', basenames: ['木魔杖', '秘紋魔杖', '星輝魔杖'] },
  magicSword1h: { name: '單手魔劍', cat: 'oneHand', hands: 1, slots: ['weapon'], emoji: '⚔️', basenames: ['符文魔劍', '咒能魔劍', '滅魔劍'] },
  greatsword2h: { name: '雙手大劍', cat: 'twoHand', hands: 2, slots: ['weapon'], emoji: '🗡️', basenames: ['闊劍', '巨劍', '斬龍大劍'] },
  axe2h:        { name: '雙手斧',   cat: 'twoHand', hands: 2, slots: ['weapon'], emoji: '🪓', basenames: ['戰斧', '重斧', '滅世巨斧'] },
  staff2h:      { name: '雙手法杖', cat: 'twoHand', hands: 2, slots: ['weapon'], emoji: '🦯', basenames: ['修行法杖', '賢者法杖', '大法師法杖'] },
  magicSword2h: { name: '雙手魔劍', cat: 'twoHand', hands: 2, slots: ['weapon'], emoji: '⚔️', basenames: ['雙刃魔劍', '深淵魔劍', '混沌魔劍'] },
  shield:       { name: '盾牌',     cat: 'offHand', hands: 1, slots: ['weapon2'], emoji: '🛡️', basenames: ['木盾', '鐵壁盾', '聖殿巨盾'] },
  focus:        { name: '法器',     cat: 'offHand', hands: 1, slots: ['weapon2'], emoji: '⚜️', basenames: ['祈願法器', '祕儀法器', '神諭法器'] },
  spellbook:    { name: '魔法書',   cat: 'offHand', hands: 1, slots: ['weapon2'], emoji: '📖', basenames: ['咒文書', '禁咒魔法書', '賢者魔導書'] },
  orb:          { name: '水晶球',   cat: 'offHand', hands: 1, slots: ['weapon2'], emoji: '🔮', basenames: ['水晶球', '祕法水晶球', '預言水晶球'] }
};
/* 武器專屬特殊能力（預留架構，尚未實裝）：
   之後每種武器類型掛專屬能力，規劃結構 {key: {name, desc, base, ...}}（比照 GODFORGE_POOL）；
   裝備欄位 it.weaponAbility 已預留（null＝無），實際能力池與數值待設計後填入。 */
var WEAPON_ABILITY_POOL = {
  sword1h: {}, dagger1h: {}, wand1h: {}, magicSword1h: {},
  greatsword2h: {}, axe2h: {}, staff2h: {}, magicSword2h: {},
  shield: {}, focus: {}, spellbook: {}, orb: {}
};
// 取武器類型定義（非武器或未知類型回 null）
function weaponDef(it) {
  if (!it || slotTypeOf(it.slot || '') !== 'weapon') return null;
  return WEAPON_TYPES[it.weaponType] || null;
}
// 是否為雙手武器（裝上時同時佔據主手＋副手）
function isTwoHandItem(it) {
  var wd = weaponDef(it);
  return !!wd && wd.cat === 'twoHand';
}
// 該欄位是否被雙手武器連帶佔用（＝副手欄且主手裝著雙手武器）
function slotBlockedByTwoHand(eq, slotKey) {
  return slotKey === 'weapon2' && !!eq && isTwoHandItem(eq.weapon);
}
// 物品「實例」→ 可裝入的欄位：武器依類型定義，其餘同 equipSlotsForType
function equipSlotsForItem(it) {
  if (!it) return [];
  var wd = weaponDef(it);
  if (wd) return wd.slots.slice();
  return equipSlotsForType(it.slot);
}
// 舊存檔相容：武器補上類型與特殊能力預留欄位。
// preferType 可指定補的類型（存檔整理對「裝在副手欄」的舊武器傳 dagger1h，保持位置合法；其餘預設單手劍）。
function ensureWeaponMeta(it, preferType) {
  if (!it || typeof it !== 'object' || slotTypeOf(it.slot || '') !== 'weapon') return it;
  if (!WEAPON_TYPES[it.weaponType]) {
    it.weaponType = WEAPON_TYPES[preferType] ? preferType : DEFAULT_WEAPON_TYPE;
  }
  if (it.weaponAbility === undefined) it.weaponAbility = null;
  return it;
}
// 物品種類顯示名：武器顯示「類型（大類）」，其餘用部位名
function itemTypeLabel(it) {
  var wd = weaponDef(it);
  if (wd) return wd.name + '（' + WEAPON_CATEGORIES[wd.cat].name + '）';
  return (SLOT_INFO[it.slot] || {}).name || it.slot;
}

var SLOT_INFO = {
  weapon: { name: '主手', emoji: '⚔️', icon: 'icon_weapon.png' },
  weapon2: { name: '副手', emoji: '🗡️', icon: 'icon_weapon.png' },
  helmet: { name: '頭盔', emoji: '🪖', icon: 'icon_helmet.png' },
  shoulder: { name: '肩甲', emoji: '🦾', icon: 'icon_shoulder.png' },
  chest: { name: '胸甲', emoji: '🛡️', icon: 'icon_chest.png' },
  belt: { name: '腰帶', emoji: '🪢', icon: 'icon_belt.png' },
  gloves: { name: '護手', emoji: '🧤', icon: 'icon_gloves.png' },
  wrist: { name: '手腕', emoji: '🦾', icon: 'icon_wrist.png' },
  legs: { name: '護腿', emoji: '👖', icon: 'icon_legs_armor.png' },
  boots: { name: '靴子', emoji: '🥾', icon: 'icon_legs.png' },
  ring: { name: '戒指', emoji: '💍', icon: 'icon_ring.png' },
  ring2: { name: '戒指Ⅱ', emoji: '💍', icon: 'icon_ring.png' },
  amulet: { name: '項鍊', emoji: '📿', icon: 'icon_amulet.png' }
};
var SLOT_BASENAMES = {
  weapon: ['短劍', '長劍', '戰斧', '法杖', '巨鎚'],
  helmet: ['皮帽', '鐵盔', '戰盔', '龍首盔'],
  shoulder: ['布肩墊', '鐵肩甲', '戰場護肩', '龍骨肩鎧'],
  chest: ['布衣', '鎖甲', '板甲', '龍鱗甲'],
  belt: ['麻繩腰帶', '皮革腰帶', '鎖鏈腰帶', '巨龍束帶'],
  gloves: ['布手套', '皮護手', '鐵護手', '龍鱗護手'],
  wrist: ['布腕帶', '皮護腕', '鐵護腕', '龍鱗護腕'],
  legs: ['布褲', '鐵護腿', '重甲腿鎧'],
  boots: ['草鞋', '皮靴', '疾風之靴'],
  ring: ['銅戒', '銀戒', '秘紋戒指'],
  amulet: ['木墜', '銀鍊', '星辰項鍊']
};
var RARITY_PREFIX = ['普通的', '精良的', '稀有的', '獨特的', '史詩的', '傳說的', '神話的', '創世的', '神鑄創世的', '混沌的', '神鑄混沌的'];
var ACCESSORY_SLOTS = ['ring', 'amulet'];

/* ---- 神鑄系統（Divine Forge）----
   六芒星法陣放入 6 件「同品質」裝備（限傳說/神話/創世）鑄造下一品質裝備；
   失敗隨機消耗 3 件、其餘退回背包。魔塵每個 +5% 成功率，最多 6 個。 */
/* 屬性數值上限（單一來源）：computeStats 夾限、面板顯示、提示文字、apply_params 一律引用此表。
   改上限只需改這裡（或參數表「2-屬性上限」→ apply_params 寫入此表），夾限與 tip 會一起同步。 */
var STAT_CAPS = {
  critRate: 0, pPen: 80, mPen: 80, cdr: 60, castSpeed: 50,
  lifesteal: 60, manaSteal: 30, blockRate: 50, blockDmgRed: 50,
  evasion: 0, tenacity: 60, ctrlRes: 80,
  ccRed: 60, moveSpeed: 50, luck: 100, hybridMutation: 60, enrageThreshold: 30,
  affixCap: 100, doubleHit: 45, stun: 30
  // 註：全局減傷上限＝GLOBAL_DMG_RED_CAP（由「2-屬性派生/全局減傷」控制）；此處不重複。
};

/* ---- 45 新技能 × 11 機制族：通用上限常數（PLAN.md §0 防失衡硬條款）----
   引擎只讀「技能 fx JSON ＋ 此處具名常數」，不得散落硬編碼；
   印記（brand）儲能端固定值不隨級、引爆端小幅成長屬資料設計規則，寫在各技能 fx，不另設常數。 */
var DOT_DETONATE_CAP_PCT = 100;      // dotSynergy：DoT 引爆結清倍率上限（引爆 ≤100% 剩餘 DoT 總值）
var OVERHEAL_DMG_CAP_PCT = 90;       // resourceConvert：溢療轉真傷比例上限（≤90%）
var SHIELD_BURST_ATK_MULT_CAP = 10;  // resourceConvert：護盾引爆追加傷害上限 = 魔攻 × 此倍數
var BUFF_EXTEND_CAP_PCT = 100;       // buffExtend：每個增益/DoT 累計延長 ≤ 原始持續 × 此%（依 applyBuff/applyDot 補存的 dur/ext 計）
var SKILL_PROC_DEPTH_MAX = 1;        // procCast：引動/重播/免費結算的遞迴深度上限（防無限連鎖）
var BUFF_EXTEND_LOW_REMAIN_SEC = 2;  // buffExtend：增益/DoT 剩餘低於此秒數時，延長量加倍（lowThreshold2x 的門檻）
var DEF_FEEDBACK_DUR_SEC = 8;        // passiveDefFeedback：施放 def 技後反哺層的存續秒數（守勢反哺）
var REPLAY_BEST_TRACK_SEC = 15;      // procCast：replayBest 傷害快照保留秒數（須 ≥ 各技 window 上限；消費端仍以自身 window 篩選）
var RECENT_BEST_MAX_ENTRIES = 20;    // procCast：replayBest 傷害快照筆數上限（防長時間戰鬥無限累積）
// 被動觸發鍵白名單（PLAN.md §2）：computeStats 被動觸發路由只聚合這些鍵至 st.skillTriggers，供戰鬥端消費。
var PASSIVE_TRIGGER_KEYS = [
  'passiveEcho',      // 殘響法則：傷害技延遲回響
  'passiveKillCd',    // 死神節拍：技能擊殺扣其他技冷卻
  'passiveProc',      // 殺陣反射：技能暴擊引動免費普攻
  'passiveDotHaste',  // 蝕骨頻率：DoT 跳動頻率倍率
  'dotAmpPer',        // 蝕骨頻率 M4：目標每 1 個 DoT 對其技能增傷%
  'dotSplashOnKill',  // 蝕骨頻率 M8：死亡時 DoT 濺射
  'passiveNthFree',   // 零式節律：每第 N 次施放免費＋增幅
  'passiveExtraHit',  // 幻影連鋒：多段技追加幻影段
  'passiveDefFeedback', // 守勢反哺：def 技後下一傷害技增幅
  'passiveBrandAmp',  // 獵殺烙印：印記儲能比／不消耗層數
  'passiveCastExtend' // 流光永續：施放傷害技延長自身增益
];
var PRIMARY_STAT_EFFECTS = {
  strAtk: 1,
  strDef: 0.35,
  strWeight: 0.5,
  agiCritRate: 0.00001,
  agiAspdPct: 0,
  agiEvasion: 0.0000035,
  intMp: 2,
  intMpRegen: 0.002,
  intMatk: 1,
  intMdef: 0.35,
  vitHp: 10,
  vitDef: 0.65,
  vitMdef: 0.65
};
// 攻防派生係數（參數表「2-屬性派生」22~25 列）：
// 攻擊 = (base + 定值 + flatMult×定值×reincBase^轉生次數 + 主屬性×係數) × (1 + 對應攻擊%)
// 防禦 = (base + 定值 + flatMult×定值×reincBase^轉生次數 + 主屬性×係數 + 耐力×係數) × (1 + 共用對應攻擊%)
var DERIVED_COEF = {
  atkBase: 8, atkFlatMult: 1.2, atkReincBase: 2.5,
  matkBase: 6, matkFlatMult: 1.2, matkReincBase: 2.5,
  defBase: 3, defFlatMult: 0.75, defReincBase: 2.4,
  mdefBase: 2, mdefFlatMult: 0.75, mdefReincBase: 2.4
};
// 連擊數係數：連擊數 = a·ln(暴擊率−100) + b·(暴擊率−100) + c（暴擊率 ≤100% 時為 0；由參數表「2-屬性派生／連擊數」控制）
var COMBO_HITS_COEF = { a: 0.875, b: 0.0025, c: 0.05 };
var ASPD_BASE = 1.0;
var ASPD_MIN = 0.2;
var ASPD_CAP = 5;
var BLOCK_DMG_RED_BASE = 30;
var GODFORGED_IDX = 8;                       // 神鑄創世稀有度索引
var EQUIP_SET_UNLOCK_LEVELS = [1, 500, 2000]; // 第 1/2/3 套裝備的解鎖等級
var FORGE_UNLOCK_LEVEL = 1;               // 神鑄系統解鎖等級（條件一：等級 ≥ 此值）；解鎖後永久保留
var FORGE_UNLOCK_REINCARNATION = 1;          // 神鑄系統解鎖所需轉生次數（條件二：轉生 ≥ 此值）；需與條件一同時滿足
var FORGE_MIN_RARITY = 5;                    // 可入爐最低品質（傳說）
var FORGE_SLOTS = 6;                         // 六芒星槽位數
var FORGE_BASE_RATE = { 5: 55, 6: 40, 7: 25 };                  // 基礎成功率 %（依素材品質）
var FORGE_GOLD_COST = { 5: 5000000, 6: 20000000, 7: 100000000 }; // 單次金幣消耗（傳說 500 萬｜神話 2000 萬｜創世 1 億）
var FORGE_DUST_RATE = 5;                     // 每個魔塵 +5% 成功率（裝備鑄造）
var FORGE_FAIL_CONSUME = 3;                  // 鑄造失敗消耗件數
var FORGE_EQUIP_DURATION = { 5: 3, 6: 5, 7: 8 };                // 裝備神鑄時間（秒）
/* 寶石神鑄：6 顆同種同階（5~9 階）→ 1 顆高一階（上限 10 階）。
   費用公式 forgeGemCost、成功率 forgeGemSuccessRateFor → js/formula.js §6 */
var FORGE_GEM_BASE_RATE = { 5: 50, 6: 40, 7: 35, 8: 25, 9: 15 }; // 基礎成功率 %（依素材階級）
var FORGE_GEM_DUST_RATE = 3;                 // 每個魔塵 +3% 成功率（寶石鑄造）
var FORGE_GEM_DURATION = { 5: 1, 6: 2, 7: 3, 8: 4, 9: 6 };       // 寶石神鑄時間（秒）
var DUST_FIELD_MIN_LEVEL = 49;              // 野外魔塵掉落的最低敵人等級
var DUST_FIELD_BASE = 1;                   // 野外魔塵基礎掉落率 %（150 級時）
var DUST_FIELD_PER_LEVEL = 0.1;              // 敵人每高 1 級的掉落率加成 %
var DUST_FIELD_CAP = 5;                      // 野外魔塵掉落率上限 %
var DUST_BOSS_BASE = 2;                      // 高塔 BOSS 魔塵基礎掉落率 %
var DUST_BOSS_PER_LEVEL = 0.2;               // 高塔樓層每 +1 層的掉落率加成 %
var DUST_BOSS_CAP = 30;                      // 高塔 BOSS 魔塵掉落率上限 %

/* ---- 神鑄創世專屬特效池（12 種，僅出現於神鑄創世裝備，生成時必帶 2 條）----
   stats: 直接併入 computeStats 的屬性聚合桶；無 stats 者為戰鬥觸發型
  （掛勾：resolveHit［破滅/聖佑/不朽］、doPlayerAttack［天罰/萬象汲取］、
   playerAtkCfg［神怒］）。數值公式 godforgePassiveValue → js/formula.js §6。 */
var GODFORGE_PASSIVE_COUNT = 2;
var GODFORGE_POOL = {
  dragonBlood: { name: '龍血', desc: '生命上限提高 {v}%', base: 25, stats: ['hpPct'] },
  godMight: { name: '神力', desc: '物理與魔法攻擊額外提高 {v}%', base: 18, stats: ['atkPct', 'matkPct'] },
  godHaste: { name: '神速', desc: '攻擊速度提高 {v}%', base: 15, stats: ['aspdPct'] },
  godSlayer: { name: '屠神', desc: '對菁英與BOSS傷害提高 {v}%', base: 30, stats: ['eliteDmg', 'bossDmg'] },
  greed: { name: '貪婪', desc: '金幣加成與掉寶率提高 {v}%', base: 25, stats: ['goldBonus', 'loot'] },
  godWall: { name: '神壁', desc: '物理與魔法防禦提高 {v}%', base: 25, stats: ['defPct', 'mdefPct'] },
  smite: { name: '天罰', desc: '攻擊時有 {v}% 機率降下神雷，造成 250% 物理攻擊的真實傷害', base: 12 },
  annihilate: { name: '破滅', desc: '暴擊時有 {v}% 機率使本次傷害翻倍', base: 15 },
  sanctuary: { name: '聖佑', desc: '受到的所有傷害降低 {v}%', base: 8 },
  undying: { name: '不朽', desc: '受到致命攻擊時有 {v}% 機率保留 1 點生命並回復 30% 最大生命（60 秒內限一次）', base: 30 },
  omniDrain: { name: '萬象汲取', desc: '攻擊時額外回復造成傷害 {v}% 的生命與法力', base: 5 },
  godWrath: { name: '神怒', desc: '生命低於 30% 時，造成的傷害提高 {v}%', base: 35 }
};

/* ---- 詞條池（50+ 屬性核心） ----
   base: 一級基準值, lv: 每裝備等級成長係數, pct: 是否百分比顯示,
   weight: 出現權重, minR: 最低稀有度, slots: 限定部位（省略=全部）      */
var AFFIX_POOL = {
  atkFlat: { name: '物理攻擊', base: 4, lv: 0.55, pct: false, weight: 11, slots: ['weapon', 'helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  atkPct: { name: '物理攻擊%', base: 4, lv: 0.02, pct: true, weight: 7, slots: ['weapon', 'belt', 'gloves', 'ring', 'amulet'] },
  matkFlat: { name: '魔法攻擊', base: 4, lv: 0.55, pct: false, weight: 11, slots: ['weapon', 'helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  matkPct: { name: '魔法攻擊%', base: 4, lv: 0.02, pct: true, weight: 7, slots: ['weapon', 'belt', 'gloves', 'ring', 'amulet'] },
  hpFlat: { name: '生命值', base: 22, lv: 3, pct: false, weight: 11, slots: ['helmet', 'shoulder', 'chest', 'gloves', 'wrist', 'legs', 'boots', 'amulet'] },
  hpPct: { name: '生命值%', base: 5, lv: 0.02, pct: true, weight: 7, slots: ['helmet', 'shoulder', 'chest', 'gloves', 'wrist', 'legs', 'boots', 'amulet'] },
  hpRegen: { name: '生命恢復/秒', base: 2, lv: 0.5, pct: false, weight: 5, slots: ['helmet', 'shoulder', 'chest', 'gloves', 'wrist', 'legs', 'boots', 'amulet'] },
  mpFlat: { name: '法力值', base: 10, lv: 1.2, pct: false, weight: 5, slots: ['helmet', 'shoulder', 'chest', 'gloves', 'wrist', 'legs', 'boots', 'amulet'] },
  mpRegen: { name: '法力恢復/秒', base: 0.8, lv: 0.06, pct: false, weight: 4, slots: ['helmet', 'shoulder', 'chest', 'gloves', 'wrist', 'legs', 'boots', 'amulet'] },
  str: { name: '力量', base: 3, lv: 0.4, pct: false, weight: 8, slots: ['weapon', 'helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  agi: { name: '敏捷', base: 3, lv: 0.4, pct: false, weight: 8, slots: ['weapon', 'helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  int: { name: '智力', base: 3, lv: 0.4, pct: false, weight: 8, slots: ['weapon', 'helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  vit: { name: '耐力', base: 3, lv: 0.4, pct: false, weight: 8, slots: ['weapon', 'helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  defFlat: { name: '物理防禦', base: 3, lv: 0.35, pct: false, weight: 9, slots: ['helmet', 'shoulder', 'chest', 'gloves', 'wrist', 'legs', 'boots', 'amulet'] },
  defPct: { name: '物理防禦%', base: 4, lv: 0.02, pct: true, weight: 6, slots: ['helmet', 'shoulder', 'chest', 'gloves', 'wrist', 'legs', 'boots', 'amulet'] },
  mdefFlat: { name: '魔法防禦', base: 3, lv: 0.35, pct: false, weight: 9, slots: ['helmet', 'shoulder', 'chest', 'gloves', 'wrist', 'legs', 'boots', 'amulet'] },
  mdefPct: { name: '魔法防禦%', base: 4, lv: 0.02, pct: true, weight: 6, slots: ['helmet', 'shoulder', 'chest', 'gloves', 'wrist', 'legs', 'boots', 'amulet'] },
  globalDmgRed: { name: '全局減傷', base: 3, lv: 0.35, pct: false, weight: 9, minR: 4, slots: ['helmet', 'shoulder', 'chest', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  normalDmgRed: { name: '普通敵人傷害抗性', base: 6, lv: 0.35, pct: false, weight: 9, minR: 4, slots: ['shoulder', 'chest', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  eliteDmgRed: { name: '菁英傷害抗性', base: 6, lv: 0.35, pct: false, weight: 9, minR: 4, slots: ['shoulder', 'chest', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  bossDmgRed: { name: 'BOSS傷害抗性', base: 6, lv: 0.35, pct: false, weight: 9, minR: 4, slots: ['shoulder', 'chest', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  aspd: { name: '攻擊速度%', base: 3, lv: 0.012, pct: true, weight: 6, slots: ['weapon', 'gloves', 'ring', 'amulet'] },
  critRate: { name: '暴擊率%', base: 2.5, lv: 0.012, pct: true, weight: 6, slots: ['weapon', 'belt', 'ring', 'amulet'] },
  critDmg: { name: '暴擊傷害%', base: 8, lv: 0.05, pct: true, weight: 5, slots: ['weapon', 'belt', 'ring', 'amulet'] },
  pPen: { name: '物理穿透%', base: 3, lv: 0.015, pct: true, weight: 4, minR: 4, slots: ['weapon', 'gloves', 'wrist', 'ring', 'amulet'] },
  mPen: { name: '魔法穿透%', base: 3, lv: 0.015, pct: true, weight: 4, minR: 4, slots: ['weapon', 'gloves', 'wrist', 'ring', 'amulet'] },
  hit: { name: '命中率%', base: 3, lv: 0.015, pct: true, weight: 5, slots: ['helmet', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  cdr: { name: '冷卻縮減%', base: 2.5, lv: 0.01, pct: true, weight: 4, minR: 4, slots: ['helmet', 'belt', 'gloves', 'ring', 'amulet'] },
  castSpeed: { name: '施法速度%', base: 3, lv: 0.012, pct: true, weight: 4, minR: 4, slots: ['all_lock'] },
  lifesteal: { name: '吸血%', base: 1.5, lv: 0.008, pct: true, weight: 4, slots: ['chest', 'wrist', 'ring', 'amulet'] },
  manaSteal: { name: '吸魔%', base: 1.2, lv: 0.006, pct: true, weight: 3, minR: 4, slots: ['chest', 'wrist', 'ring', 'amulet'] },
  eliteDmg: { name: '對菁英傷害%', base: 4, lv: 0.02, pct: true, weight: 4, minR: 3, slots: ['weapon', 'helmet', 'shoulder', 'ring', 'amulet'] },
  bossDmg: { name: '對BOSS傷害%', base: 4, lv: 0.02, pct: true, weight: 4, minR: 3, slots: ['weapon', 'helmet', 'shoulder', 'ring', 'amulet'] },
  normalDmg: { name: '對普通敵人傷害%', base: 3, lv: 0.035, pct: true, weight: 9, minR: 3, slots: ['weapon', 'helmet', 'shoulder', 'ring', 'amulet'] },
  dmgVsFire: { name: '對火屬性敵人傷害%', base: 0.8, lv: 0.005, pct: true, weight: 3, minR: 3, slots: ['weapon', 'ring', 'amulet'] },
  dmgVsIce: { name: '對冰屬性敵人傷害%', base: 0.8, lv: 0.005, pct: true, weight: 3, minR: 3, slots: ['weapon', 'ring', 'amulet'] },
  dmgVsLightning: { name: '對雷屬性敵人傷害%', base: 0.8, lv: 0.005, pct: true, weight: 3, minR: 3, slots: ['weapon', 'ring', 'amulet'] },
  dmgVsPoison: { name: '對毒屬性敵人傷害%', base: 0.8, lv: 0.005, pct: true, weight: 3, minR: 3, slots: ['weapon', 'ring', 'amulet'] },
  dmgVsLight: { name: '對聖屬性敵人傷害%', base: 0.8, lv: 0.005, pct: true, weight: 3, minR: 3, slots: ['weapon', 'ring', 'amulet'] },
  dmgVsDark: { name: '對暗屬性敵人傷害%', base: 0.8, lv: 0.005, pct: true, weight: 3, minR: 3, slots: ['weapon', 'ring', 'amulet'] },
  elemDmgFire: { name: '火屬性傷害提升%', base: 2, lv: 0.01, pct: true, weight: 3, minR: 3, slots: ['weapon', 'belt', 'gloves', 'wrist', 'ring', 'amulet'] },
  elemDmgIce: { name: '冰屬性傷害提升%', base: 2, lv: 0.01, pct: true, weight: 3, minR: 3, slots: ['weapon', 'belt', 'gloves', 'wrist', 'ring', 'amulet'] },
  elemDmgLightning: { name: '雷屬性傷害提升%', base: 2, lv: 0.01, pct: true, weight: 3, minR: 3, slots: ['weapon', 'belt', 'gloves', 'wrist', 'ring', 'amulet'] },
  elemDmgPoison: { name: '毒屬性傷害提升%', base: 2, lv: 0.01, pct: true, weight: 3, minR: 3, slots: ['weapon', 'belt', 'gloves', 'wrist', 'ring', 'amulet'] },
  elemDmgLight: { name: '聖屬性傷害提升%', base: 2, lv: 0.01, pct: true, weight: 3, minR: 3, slots: ['weapon', 'belt', 'gloves', 'wrist', 'ring', 'amulet'] },
  elemDmgDark: { name: '暗屬性傷害提升%', base: 2, lv: 0.01, pct: true, weight: 3, minR: 3, slots: ['weapon', 'belt', 'gloves', 'wrist', 'ring', 'amulet'] },
  aoeDmg: { name: '範圍傷害%', base: 4, lv: 0.02, pct: true, weight: 4, minR: 4, slots: ['weapon', 'amulet'] },
  blockRate: { name: '格擋率%', base: 2.5, lv: 0.012, pct: true, weight: 4, slots: ['weapon', 'shoulder', 'chest', 'gloves', 'wrist', 'legs', 'amulet'] },
  blockDmgRed: { name: '格擋減傷%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 4, slots: ['shoulder', 'chest', 'gloves', 'wrist', 'legs', 'amulet'] },
  evasion: { name: '閃避率%', base: 2, lv: 0.01, pct: true, weight: 4, slots: ['helmet', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  tenacity: { name: '韌性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 4, slots: ['helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  shieldEff: { name: '護盾效率%', base: 5, lv: 0.025, pct: true, weight: 3, minR: 3, slots: ['helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  pRes: { name: '物理抗性%', base: 2, lv: 0.008, pct: true, weight: 3, minR: 3, slots: ['helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  mRes: { name: '魔法抗性%', base: 2, lv: 0.008, pct: true, weight: 3, minR: 3, slots: ['helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  resFire: { name: '火焰抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 3, slots: ['helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  resIce: { name: '冰霜抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 3, slots: ['helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  resLightning: { name: '雷電抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 3, slots: ['helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  resPoison: { name: '劇毒抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 3, slots: ['helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  resLight: { name: '聖光抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 3, slots: ['helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  resDark: { name: '暗影抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 3, slots: ['helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  resAll: { name: '全屬性抗性%', base: 1, lv: 0.005, pct: true, weight: 3, minR: 4, slots: ['helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  ccRed: { name: '控制時間縮減%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 4, slots: ['helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'] },
  moveSpeed: { name: '移動速度%', base: 3, lv: 0.012, pct: true, weight: 4, slots: ['all_lock'] },
  loot: { name: '掉寶率%', base: 3, lv: 0.015, pct: true, weight: 4, minR: 4, slots: ['ring', 'amulet'] },
  xpBonus: { name: '經驗加成%', base: 4, lv: 0.02, pct: true, weight: 4, minR: 4, slots: ['ring', 'amulet'] },
  goldBonus: { name: '金幣加成%', base: 5, lv: 0.025, pct: true, weight: 4, minR: 4, slots: ['ring', 'amulet'] },
  luck: { name: '幸運值', base: 2, lv: 0.1, pct: false, weight: 3, minR: 4, slots: ['helmet', 'ring', 'amulet'] },
  weight: { name: '負重上限', base: 2, lv: 0.3, pct: false, weight: 3, minR: 4, slots: ['shoulder', 'chest', 'legs', 'boots', 'ring', 'amulet'] },
  enhanceSuccess: { name: '強化成功率%', base: 3, lv: 0.015, pct: true, weight: 3, minR: 4, slots: ['ring', 'amulet'] },
  decomposeYield: { name: '分解高產率%', base: 3, lv: 0.015, pct: true, weight: 3, minR: 4, slots: ['all_lock'] },
  hybridMutation: { name: '合成變異率%', base: 2.5, lv: 0.012, pct: true, weight: 2, minR: 4, slots: ['all_lock'] },
  enrageThreshold: { name: '狂暴閾值+', base: 2, lv: 0.08, pct: false, weight: 2, minR: 4, slots: ['all_lock'] },
  affixCap: { name: '詞條上限率%', base: 3, lv: 0.015, pct: true, weight: 2, minR: 4, slots: ['ring', 'amulet'] },
  gemEff: { name: '寶石鑲嵌效率%', base: 5, lv: 0.025, pct: true, weight: 2, minR: 4, slots: ['ring', 'amulet'] }
};

// ---- 詞條顯示分類（裝備詳情/滑過提示分色用；未列入者一律視為 util 功能類） ----
function affixIsAllLocked(key) {
  var def = AFFIX_POOL[key];
  if (!def || def.slots === undefined || def.slots === null) return false;
  if (def.slots === 'all_lock') return true;
  return Array.isArray(def.slots) && def.slots.indexOf('all_lock') >= 0;
}

function statPanelRowIsAllLocked(row) {
  if (!row) return false;
  if (row.affixKey) return affixIsAllLocked(row.affixKey);
  var label = String(row[0] || '').replace(/%/g, '').replace(/\s/g, '');
  for (var key in AFFIX_POOL) {
    if (!affixIsAllLocked(key)) continue;
    var name = String(AFFIX_POOL[key].name || '').replace(/%/g, '').replace(/\s/g, '');
    if (name && label.indexOf(name) >= 0) return true;
  }
  return false;
}

var AFFIX_CATS = {
  base: ['hpFlat', 'hpPct', 'hpRegen', 'mpFlat', 'mpRegen', 'str', 'agi', 'int', 'vit'],
  off: ['atkFlat', 'atkPct', 'matkFlat', 'matkPct', 'aspd', 'critRate', 'critDmg', 'pPen', 'mPen',
    'hit', 'cdr', 'castSpeed', 'lifesteal', 'manaSteal', 'eliteDmg', 'bossDmg', 'normalDmg', 'aoeDmg'],
  def: ['defFlat', 'defPct', 'mdefFlat', 'mdefPct', 'globalDmgRed', 'normalDmgRed', 'eliteDmgRed', 'bossDmgRed', 'blockRate', 'blockDmgRed', 'evasion',
    'tenacity', 'shieldEff', 'pRes', 'mRes', 'resFire', 'resIce', 'resLightning',
    'resPoison', 'resLight', 'resDark', 'resAll', 'ccRed']
};
var AFFIX_CAT_LOOKUP = (function () {
  var m = {};
  for (var c in AFFIX_CATS) {
    for (var i = 0; i < AFFIX_CATS[c].length; i++) m[AFFIX_CATS[c][i]] = c;
  }
  return m;
})();
function affixCat(key) { return AFFIX_CAT_LOOKUP[key] || 'util'; }

// ---- 傳奇特效（傳說級以上） ----
// 附檔《神力之巔_記事錄.xlsx》「傳奇特效」為企劃來源。
// weaponTypes 限定可出現的武器類型；relatedSkill 修改既有技能；triggerSkill 可無視解鎖直接觸發既有技能。
// fx 僅存 JSON 安全的數值規格，執行邏輯集中於 js/legendary.js。
var PASSIVE_POOL = {
  sunder: { name: '破甲', desc: '攻擊時忽略目標 {v}% 防禦', base: 10, perR: 2 },
  thorns: { name: '反震', desc: '受擊時對敵人造成自身 {v}% 最大生命的傷害', base: 5, perR: 1 },
  doubleHit: { name: '連擊', desc: '攻擊時有 {v}% 機率再次攻擊', base: 10, perR: 2 },
  stun: { name: '暈眩', desc: '攻擊時有 {v}% 機率暈眩敵人 1 秒', base: 6, perR: 1.5 },
  slowHit: { name: '減速', desc: '攻擊時有 {v}% 機率使敵人攻速降低 30%，持續 3 秒', base: 12, perR: 3 },
  trueDmg: { name: '真傷', desc: '每次攻擊附加 {v}% 攻擊力的真實傷害', base: 6, perR: 1.5 },
  soulEater: { name: '吸魂', desc: '擊殺敵人時回復 {v}% 最大生命', base: 5, perR: 1.5 },
  whirlwindRift: {
    name: '旋風裂解', desc: '當你施放物理技能時，有 30% 機率觸發一次無消耗的旋風斬技能。',
    base: 0, perR: 0, legendary: true, type: 'phys', triggerSkill: 'whirlwind', weaponTypes: ['sword1h'],
    fx: { onSkillCast: { cat: 'phys', chance: 30, triggerSkill: 'whirlwind' } }
  },
  mountainSunderer: {
    name: '崩山裂地者', desc: '當你對敵人造成暈眩或緩速效果時，該效果持續時間 +100%，且對處於該狀態的敵人造成的傷害提高 300%。',
    base: 0, perR: 0, legendary: true, weaponTypes: ['axe2h'],
    fx: { controlDurationMult: 2, controlledTargetDamagePct: 300 }
  },
  shadowTracker: {
    name: '影襲追蹤者', desc: '射出三把飛刀追蹤攻擊敵人，每 1 秒各攻擊 1 次並造成 60% 物理傷害；飛刀存在 4 秒，期間擊殺敵人會使所有飛刀持續時間 +0.5 秒。',
    base: 0, perR: 0, legendary: true, type: 'phys', weaponTypes: ['dagger1h'],
    fx: { shadowKnives: { count: 3, tickSec: 1, powerPct: 60, dur: 4, killExtend: 0.5 } }
  },
  whirlwindStab: {
    name: '旋風之刺', desc: '裝備兩把單手匕首時攻速額外提高 50%；每使用 20 次普攻後打出 3 連擊，每擊造成 120% 物理傷害。',
    base: 0, perR: 0, legendary: true, type: 'phys', weaponTypes: ['dagger1h'],
    fx: { dualDaggerAspdPct: 50, basicAttackThreshold: 20, flurryHits: 3, flurryPowerPct: 120 }
  },
  shadowRipper: {
    name: '暗影撕裂者', desc: '當你損失生命時，有 25% 機率對敵人施放一次無消耗的撕裂技能。',
    base: 0, perR: 0, legendary: true, triggerSkill: 'rendWound', weaponTypes: ['dagger1h'],
    fx: { onHealthLost: { chance: 25, triggerSkill: 'rendWound' } }
  },
  doomProphet: {
    name: '末日預言者', desc: '沒有生命護盾時傷害提高 50%；生命值每降低 10%，傷害再提高 10%。',
    base: 0, perR: 0, legendary: true, weaponTypes: ['dagger1h'],
    fx: { noShieldDamagePct: 50, missingHpStepPct: 10, damagePerStepPct: 10 }
  },
  berserkBloodAxe: {
    name: '狂暴血斧', desc: '擊殺敵人時獲得「狂暴」：攻速與攻擊提高 3%，持續 6 秒，最多疊加 20 層。',
    base: 0, perR: 0, legendary: true, weaponTypes: ['axe2h'],
    fx: { onKillBuff: { atkPct: 3, aspdPct: 3, dur: 6, maxStacks: 20 } }
  },
  manaGuard: {
    name: '法力防護', desc: '每消耗 1% 法力，獲得 0.5% 最大生命的生命護盾；護盾上限為最大生命的 50%。',
    base: 0, perR: 0, legendary: true, weaponTypes: ['magicSword1h'],
    fx: { manaSpendShield: { manaPct: 1, shieldHpPct: 0.5, capHpPct: 50 } }
  },
  unyieldingGuard: {
    name: '不屈護衛', desc: '格擋成功時有 35% 機率，以自身原始普攻最終傷害 × 實際格擋減傷 × 500% 反擊，並使受到的傷害降低 20%，持續 3 秒。',
    base: 0, perR: 0, legendary: true, weaponTypes: ['shield'],
    fx: { onBlock: { chance: 35, reflectBlockPct: 500, dmgRedPct: 20, dur: 3 } }
  },
  whirlwindBleed: {
    name: '旋風回旋斬', desc: '旋風斬會附加流血，每 1 秒造成 50% 物理傷害，持續 5 秒。',
    base: 0, perR: 0, legendary: true, type: 'phys', relatedSkill: 'whirlwind', weaponTypes: ['greatsword2h'],
    fx: { skillDot: { name: '流血', tickPowerPct: 50, dur: 5 } }
  },
  frostSpike: {
    name: '冰霜尖刺', desc: '霜之新星會同時施放冰霜尖刺，造成 250% 冰寒傷害。',
    base: 0, perR: 0, legendary: true, type: 'ice', relatedSkill: 'frostNova', weaponTypes: ['focus'],
    fx: { extraSkillHit: { powerPct: 250, elem: 'ice', dmgType: 'magic' } }
  },
  auroraStaff: {
    name: '極光法杖', desc: '使用冰寒技能命中時使敵人凍傷 4 秒；每層使敵人受到的傷害提高 10%，最多疊加 20 層。',
    base: 0, perR: 0, legendary: true, type: 'ice', weaponTypes: ['staff2h'],
    fx: { onElemSkill: { elem: 'ice', frostbiteDur: 4, damageTakenPerStackPct: 10, maxStacks: 20 } }
  },
  iceShriek: {
    name: '冰晶尖嘯', desc: '施放冰系技能時有 35% 機率射出一道冰晶尖刺，造成 80% 冰寒傷害並使敵人凍傷 3 秒。',
    base: 0, perR: 0, legendary: true, type: 'ice', weaponTypes: ['orb'],
    fx: { onElemSkillProc: { elem: 'ice', chance: 35, powerPct: 80, frostbiteDur: 3 } }
  },
  lightningLeap: {
    name: '閃電飛越', desc: '施放魔法技能時有 35% 機率形成連鎖閃電，每 0.3 秒彈射 1 次並造成 50% 雷電傷害，最多 5 次。',
    base: 0, perR: 0, legendary: true, type: 'lightning', weaponTypes: ['wand1h'],
    fx: { onSkillCastChain: { cat: 'magic', chance: 35, powerPct: 50, elem: 'lightning', bounces: 5, tickSec: 0.3 } }
  },
  thunderShock: {
    name: '雷霆之震', desc: '受到生命傷害時有 35% 機率對所有敵人造成 50% 雷電傷害；只有一名敵人時傷害翻倍。',
    base: 0, perR: 0, legendary: true, type: 'lightning', weaponTypes: ['focus'],
    fx: { onHealthLostAoe: { chance: 35, powerPct: 50, elem: 'lightning', singleMult: 2 } }
  },
  stormSigilChain: {
    name: '雷紋連鎖', desc: '雷紋刻印可額外累積 3 次，且造成的傷害提高 100%。',
    base: 0, perR: 0, legendary: true, type: 'lightning', relatedSkill: 'stormSigil', weaponTypes: ['orb'],
    fx: { skillDamagePct: 100, brandExtraStacks: 3 }
  },
  burningLaw: {
    name: '燃燒法則', desc: '燃燒持續傷害會一次性全部作用，且傷害提高 30%。',
    base: 0, perR: 0, legendary: true, type: 'fire', weaponTypes: ['staff2h'],
    fx: { burnInstant: true, burnDamagePct: 30 }
  },
  fireSpiritShield: {
    name: '火靈盾', desc: '身體永久被火焰包覆，每秒損失 1% 最大生命；攻擊你的敵人持續受到 20% 火焰灼燒傷害，最多疊加 10 層。',
    base: 0, perR: 0, legendary: true, type: 'fire', weaponTypes: ['spellbook'],
    fx: { selfHpDrainPctPerSec: 1, retaliateBurnPct: 20, maxStacks: 10 }
  },
  skyfallMeteor: {
    name: '神落天殞', desc: '每隔 8 秒自動召喚一顆無消耗的殞石，且殞石術傷害提高 50%。',
    base: 0, perR: 0, legendary: true, type: 'fire', relatedSkill: 'meteor', triggerSkill: 'meteor', weaponTypes: ['staff2h'],
    fx: { autoTrigger: { skill: 'meteor', sec: 8 }, skillDamagePct: 50 }
  },
  manaExplosion: {
    name: '法力爆燃', desc: '法力灼燒改為消耗最大法力的 50%，且傷害提高 500%。',
    base: 0, perR: 0, legendary: true, type: 'fire', relatedSkill: 'manaBurn', weaponTypes: ['orb'],
    fx: { manaCostMaxPct: 50, skillDamagePct: 500 }
  },
  magicLightShield: {
    name: '魔法光盾', desc: '生命值低於 50% 時產生相當於最大生命的光盾；光盾期間受到的傷害降低 35%，持續 5 秒。',
    base: 0, perR: 0, legendary: true, type: 'light', weaponTypes: ['orb'],
    fx: { lowHpThresholdPct: 50, shieldHpPct: 100, dmgRedPct: 35, dur: 5 }
  },
  lightCollision: {
    name: '光之碰撞', desc: '每隔 4 秒自動發射追蹤光彈尋找最近的目標，造成 250% 聖屬性傷害。',
    base: 0, perR: 0, legendary: true, type: 'light', weaponTypes: ['wand1h'],
    fx: { autoProjectile: { sec: 4, powerPct: 250, elem: 'light' } }
  },
  judgmentArrival: {
    name: '審判降臨', desc: '聖光審判的傷害提高 50%，且冷卻時間縮短 30%。',
    base: 0, perR: 0, legendary: true, type: 'light', relatedSkill: 'holySmite', weaponTypes: ['wand1h'],
    fx: { skillDamagePct: 50, skillCdPct: -30 }
  },
  holyImpact: {
    name: '聖光衝擊', desc: '施放奧術衝擊後，下一個技能必定雙重施法，且有 20% 機率變為三重施法。',
    base: 0, perR: 0, legendary: true, type: 'light', relatedSkill: 'arcaneBurst', weaponTypes: ['focus'],
    fx: { nextMultiCast: { double: 2, tripleChance: 20, triple: 3 } }
  },
  deathDomain: {
    name: '死亡領域', desc: '施放技能時展開死亡領域，使所有技能傷害轉為毒屬性並提高 50%，持續 10 秒。',
    base: 0, perR: 0, legendary: true, type: 'poison', weaponTypes: ['spellbook'],
    fx: { domainOnSkillCast: { dur: 10, convertElem: 'poison', skillDamagePct: 50 } }
  },
  venomMist: {
    name: '劇毒血霧', desc: '施放毒系技能時有 25% 機率使毒霧籠罩所有敵人；每 0.5 秒造成 35% 毒屬性傷害，持續 4 秒。',
    base: 0, perR: 0, legendary: true, type: 'poison', weaponTypes: ['wand1h'],
    fx: { onElemSkillField: { elem: 'poison', chance: 25, tickSec: 0.5, powerPct: 35, dur: 4, target: 'all' } }
  },
  ghostLamp: {
    name: '幽冥神燈', desc: '召喚 2 個擁有你 20% 生命與攻擊力的鬼娃衝向敵人；敵人優先攻擊鬼娃，鬼娃死亡時對所有敵人造成 300% 暗影傷害。',
    base: 0, perR: 0, legendary: true, type: 'dark', weaponTypes: ['focus'],
    fx: { summons: { count: 2, hpPct: 20, atkPct: 20, explosionPct: 300, elem: 'dark', taunt: true } }
  },
  shadowAnnihilation: {
    name: '暗影滅寂', desc: '虛空裂隙的目標血量判定改為 20%，傷害提高 1000%；發動處決後暗屬性傷害提高 30%，持續 6 秒。',
    base: 0, perR: 0, legendary: true, type: 'dark', relatedSkill: 'voidRift', weaponTypes: ['staff2h'],
    fx: { execBelow: 20, skillDamagePct: 1000, onExecuteElemBuff: { elem: 'dark', pct: 30, dur: 6 } }
  },
  voidFate: {
    name: '虛無命運', desc: '瀝血狂濤的生命扣減改為 5 秒內扣減 30% 最大生命；期間每減少 1% 生命，所有敵人同等減少 1% 最大生命。',
    base: 0, perR: 0, legendary: true, type: 'dark', relatedSkill: 'bloodSurge', weaponTypes: ['orb'],
    fx: { deferredHpLossPct: 30, dur: 5, enemyHpLossPerPlayerPct: 1 }
  },
  oathOfCondemnation: {
    name: '天譴之誓', desc: '每隔 4 秒隨機使一個正在冷卻的技能冷卻歸零，且其下一次傷害或效果提高 50%。',
    base: 0, perR: 0, legendary: true, weaponTypes: ['orb'],
    fx: { autoCharge: { sec: 4, effectPct: 50 } }
  },
  magicRecoil: {
    name: '魔法反震', desc: '反震敵人時消耗 10 點魔力，且該次反震傷害提高 100%。',
    base: 0, perR: 0, legendary: true, weaponTypes: ['spellbook'],
    fx: { thornsManaCost: 10, thornsDamagePct: 100 }
  }
};

// 傳奇特效是否可出現在指定裝備；無 weaponTypes 表示不限部位。
function passiveAllowedForItem(key, item) {
  var def = PASSIVE_POOL[key];
  if (!def) return false;
  if (!def.weaponTypes || !def.weaponTypes.length) return true;
  return !!item && def.weaponTypes.indexOf(item.weaponType) >= 0;
}
function passiveKeysForItem(item) {
  var out = [];
  for (var key in PASSIVE_POOL) if (passiveAllowedForItem(key, item)) out.push(key);
  return out;
}

/* ---- 戰力評分權重（itemScore → formula.js §6）----
   鍵 = 詞條/屬性 key；未列出者以 1 計。
   2026-07-23 起由 Equipment_Affix 表各詞條列的「戰力權重」欄管理（config_tables.cjs），自 formula.js 移入。 */
var SCORE_WEIGHTS = {
  atkFlat: 1,
  atkPct: 2.6,
  matkFlat: 1,
  matkPct: 2.6,
  hpFlat: 0.05,
  hpPct: 2,
  hpRegen: 0.6,
  mpFlat: 0.075,
  mpRegen: 2,
  str: 1.8,
  agi: 1.8,
  int: 1.8,
  vit: 1.8,
  defFlat: 0.9,
  defPct: 1.8,
  mdefFlat: 0.9,
  mdefPct: 1.8,
  globalDmgRed: 1,
  normalDmgRed: 1,
  eliteDmgRed: 1,
  bossDmgRed: 1,
  aspd: 2.8,
  critRate: 2.4,
  critDmg: 0.9,
  pPen: 2.2,
  mPen: 2.2,
  hit: 1.2,
  cdr: 2,
  castSpeed: 1.4,
  lifesteal: 2.2,
  manaSteal: 1.4,
  eliteDmg: 1.2,
  bossDmg: 1.2,
  normalDmg: 1.2,
  aoeDmg: 1.4,
  blockRate: 2,
  blockDmgRed: 1.2,
  evasion: 2.2,
  tenacity: 1.2,
  shieldEff: 1,
  pRes: 2,
  mRes: 2,
  resFire: 0.8,
  resIce: 0.8,
  resLightning: 0.8,
  resPoison: 0.8,
  resLight: 0.8,
  resDark: 0.8,
  ccRed: 1.2,
  moveSpeed: 1.5,
  loot: 0.8,
  xpBonus: 0.8,
  goldBonus: 0.8,
  luck: 1.5,
  weight: 0.8,
  enhanceSuccess: 0.8,
  decomposeYield: 0.8,
  hybridMutation: 1.2,
  enrageThreshold: 1,
  affixCap: 1.2,
  gemEff: 1
};

// ---- 元素 ----
// short = 「X屬性」語境用單字（火/冰/雷/毒/聖/暗；light 屬性統一稱「聖」，不再稱「光」）
var ELEMENTS = ['fire', 'ice', 'lightning', 'poison', 'light', 'dark'];
/* color：戰鬥特效用的主色（js/vfx.js）。與 tips 的文字色分開，特效要的是在暗底上夠亮的顏色。 */
var ELEM_INFO = {
  fire: { name: '火焰', short: '火', emoji: '🔥', color: '#fb7233' },
  ice: { name: '冰霜', short: '冰', emoji: '❄️', color: '#54c7fc' },
  lightning: { name: '雷電', short: '雷', emoji: '⚡', color: '#ffd93d' },
  poison: { name: '劇毒', short: '毒', emoji: '☠️', color: '#9ee34a' },
  light: { name: '聖光', short: '聖', emoji: '✨', color: '#ffe9a8' },
  dark: { name: '暗影', short: '暗', emoji: '🌑', color: '#b76cff' }
};

/* 特效時間軸（模擬層與 js/vfx.js 共用）——傷害數字必須跟畫面對得上：
   模擬層是一瞬間把傷害全部結算完的，但畫面上子彈要飛、多段要一段一段打。
   所以浮字的顯示時間由這兩個常數往後推，讓「數字跳出來」對齊「打到人」那一刻。
   改這裡會同時改變特效節奏與數字節奏，兩者不會走鐘。 */
var VFX_HIT_STAGGER_SEC = 0.09;   // 多段傷害每一段之間的間隔

/* 投射物是「等速飛行」而不是「固定飛行時間」：飛行秒數 = 我方到敵人中心的距離 ÷ 速度。
   固定時間的話，打第 1 行的子彈會慢吞吞、打第 4 行的又太快，數字跟命中永遠對不上。
   單位是「格/秒」——棋盤 4 格寬，所以最近約 0.07 秒、最遠（右上/右下角）約 0.3 秒。
   上下限用來避免貼臉時瞬間到、以及極端棋盤設定下拖太久。 */
var VFX_PROJECTILE_SPEED_CELLS = 14;
var VFX_TRAVEL_MIN_SEC = 0.06;
var VFX_TRAVEL_MAX_SEC = 0.45;

/* 無屬性技能的特效主色：依技能系統分類取色（js/vfx.js 與 skillVfxSpec 共用）。 */
var VFX_CAT_COLORS = {
  phys: '#e6ddc8',      // 物理：刀光的冷白
  magic: '#8ea2ff',     // 魔法：秘能藍紫
  def: '#7ff0c0',       // 防禦與治療：生命綠
  special: '#ffc773',   // 特殊
  passive: '#c9c9c9',
  potential: '#ff9de2'  // 潛力技能
};

// ---- 附魔 ----
var ENCHANTS = {
  fire: { name: '火焰附魔', cat: 'atk', elem: 'fire', desc: '附加高額火焰傷害', emoji: '🔥' },
  ice: { name: '冰凍附魔', cat: 'atk', elem: 'ice', desc: '附加冰霜傷害，15% 機率使敵人減速 2 秒', emoji: '❄️' },
  lightning: { name: '閃電附魔', cat: 'atk', elem: 'lightning', desc: '附加雷電傷害，10% 機率追加一道電擊', emoji: '⚡' },
  poison: { name: '毒液附魔', cat: 'atk', elem: 'poison', desc: '附加劇毒傷害，25% 機率使敵人中毒 4 秒', emoji: '🧪' },
  light: { name: '聖光附魔', cat: 'atk', elem: 'light', desc: '附加聖光傷害，20% 機率淨化自身負面狀態', emoji: '🌟' },
  dark: { name: '暗影附魔', cat: 'atk', elem: 'dark', desc: '附加暗影傷害，並汲取其 25% 回復生命', emoji: '🌑' },
  fireRes: { name: '火焰抗性', cat: 'def', desc: '火焰屬性抗性額外提高：其他來源合計 ×(1+此值%)', emoji: '🧯' },
  iceRes: { name: '冰霜抗性', cat: 'def', desc: '冰霜屬性抗性額外提高：其他來源合計 ×(1+此值%)', emoji: '🧊' },
  lightningRes: { name: '雷電抗性', cat: 'def', desc: '雷電屬性抗性額外提高：其他來源合計 ×(1+此值%)', emoji: '🔌' },
  poisonRes: { name: '劇毒抗性', cat: 'def', desc: '劇毒屬性抗性額外提高：其他來源合計 ×(1+此值%)', emoji: '💊' },
  lightRes: { name: '聖光抗性', cat: 'def', desc: '聖屬性抗性額外提高：其他來源合計 ×(1+此值%)', emoji: '🕶️' },
  darkRes: { name: '暗影抗性', cat: 'def', desc: '暗影屬性抗性額外提高：其他來源合計 ×(1+此值%)', emoji: '🕯️' },
  ctrlRes: { name: '控制抵抗', cat: 'def', desc: '機率完全抵抗暈眩與減速', emoji: '🛡️' },
  loot: { name: '尋寶附魔', cat: 'util', desc: '增加裝備掉落率', emoji: '💰' },
  haste: { name: '疾行附魔', cat: 'util', desc: '增加移動速度（縮短推圖間隔）', emoji: '🌀' },
  vigor: { name: '活力附魔', cat: 'util', desc: '提升生命上限', emoji: '❤️' },
  clarity: { name: '澄明附魔', cat: 'util', desc: '提升法力恢復速度', emoji: '💧' },
  focus: { name: '專注附魔', cat: 'util', desc: '縮短技能冷卻時間', emoji: '🎯' },
  fortune: { name: '財運附魔', cat: 'util', desc: '提高金幣獲取量', emoji: '🪙' },
  wisdom: { name: '智慧附魔', cat: 'util', desc: '提高經驗獲取量', emoji: '📚' }
};
// 附魔可作用部位（裝備欄位）
var ENCHANT_SLOTS = {
  atk: ['weapon', 'weapon2', 'ring', 'ring2', 'gloves', 'wrist'],
  def: ['helmet', 'shoulder', 'chest', 'belt', 'legs'],
  util: ['amulet', 'boots']
};
var ENCHANT_ESSENCE_COST = 1; // 每次附魔消耗附魔精華
// 附魔抗性 → 元素對應
var ENCHANT_RES_MAP = {
  fireRes: 'fire', iceRes: 'ice', lightningRes: 'lightning',
  poisonRes: 'poison', lightRes: 'light', darkRes: 'dark'
};

// ---- 技能（自動施放） ----
var SKILL = {
  name: '奧術衝擊', emoji: '🌠',
  cost: 30,          // MP 消耗
  baseCd: 10,        // 基礎冷卻（受 CDR 影響）
  castTime: 0.8,     // 舊基礎技能資料欄位；現行技能不以施法時間延後普攻
  matkScale: 1.5,    // 魔攻倍率
  atkScale: 0.3      // 物攻倍率
};

// ---- 怪物（magic: 以魔法攻擊，對玩家魔防；attr: 屬性標籤（六大屬性），供「對X屬性敵人傷害」加成與 tips 顯示 ----
var MONSTER_POOL = [
  { name: '史萊姆', emoji: '🟢', attr: 'poison' }, { name: '哥布林', emoji: '👺', attr: 'dark' },
  { name: '野狼', emoji: '🐺', attr: 'ice' }, { name: '骷髏兵', emoji: '💀', attr: 'dark' },
  { name: '暗影蝠', emoji: '🦇', magic: true, attr: 'dark' }, { name: '樹妖', emoji: '🌳', magic: true, attr: 'poison' },
  { name: '蜥蜴戰士', emoji: '🦎', attr: 'poison' }, { name: '半獸人', emoji: '🐗', attr: 'fire' },
  { name: '幽靈', emoji: '👻', magic: true, attr: 'dark' }, { name: '石像鬼', emoji: '🗿', attr: 'light' },
  { name: '牛頭人', emoji: '🐂', attr: 'fire' }, { name: '雙足飛龍', emoji: '🐉', magic: true, attr: 'lightning' }
];
/* ---- 戰鬥場景 ----
   荒漠/沼澤敵人更強；經驗、金幣、材料（寶石/附魔書/精華）掉落 x2 / x3，
   裝備掉落表不變。各場景獨立保存推進進度與最高階段。 */
var DESERT_POOL = [
  { name: '沙漠蠍', emoji: '🦂', attr: 'poison' }, { name: '沙蟲', emoji: '🪱', attr: 'fire' },
  { name: '木乃伊', emoji: '🧟', magic: true, attr: 'dark' }, { name: '沙漠禿鷹', emoji: '🦅', attr: 'lightning' },
  { name: '響尾蛇', emoji: '🐍', attr: 'poison' }, { name: '沙魔', emoji: '👹', magic: true, attr: 'dark' },
  { name: '石化蜥蜴', emoji: '🦎', attr: 'poison' }, { name: '沙漠強盜', emoji: '🏴‍☠️', attr: 'fire' },
  { name: '火焰精靈', emoji: '🔥', magic: true, attr: 'fire' }, { name: '遠古石像', emoji: '🗿', attr: 'light' },
  { name: '沙丘巨獸', emoji: '🐫', attr: 'fire' }, { name: '太陽祭司', emoji: '☀️', magic: true, attr: 'light' }
];
var SWAMP_POOL = [
  { name: '劇毒蛙', emoji: '🐸', attr: 'poison' }, { name: '沼澤鱷', emoji: '🐊', attr: 'dark' },
  { name: '巨型水蛭', emoji: '🪱', attr: 'dark' }, { name: '瘴氣幽魂', emoji: '👻', magic: true, attr: 'poison' },
  { name: '食人花', emoji: '🌺', attr: 'poison' }, { name: '泥漿怪', emoji: '🫠', attr: 'poison' },
  { name: '毒蚊群', emoji: '🦟', attr: 'poison' }, { name: '沼澤巫婆', emoji: '🧙', magic: true, attr: 'dark' },
  { name: '腐爛樹人', emoji: '🌳', magic: true, attr: 'poison' }, { name: '蜥蜴薩滿', emoji: '🦎', magic: true, attr: 'lightning' },
  { name: '深沼水蛇', emoji: '🐍', attr: 'ice' }, { name: '沼澤霸主', emoji: '🐲', magic: true, attr: 'dark' }
];
/* ---- 神界練功場景敵人（11轉及以上解鎖） ---- */
var GOD_BATTLEFIELD_POOL = [
  { name: '太古戰魂', emoji: '👻', attr: 'dark' }, { name: '遠古神兵', emoji: '🗡️', attr: 'light' },
  { name: '破天戰將', emoji: '🛡️', attr: 'light' }, { name: '烈焰神衛', emoji: '💥', magic: true, attr: 'fire' },
  { name: '狂暴泰坦', emoji: '🗿', attr: 'lightning' }, { name: '神魔殘骸', emoji: '☠️', attr: 'dark' },
  { name: '不朽英靈', emoji: '🌟', magic: true, attr: 'light' }, { name: '裁決之劍', emoji: '⚔️', attr: 'light' },
  { name: '滅世魔將', emoji: '👹', magic: true, attr: 'dark' }, { name: '太古龍魂', emoji: '🐉', magic: true, attr: 'lightning' },
  { name: '戰爭主宰', emoji: '🔱', attr: 'light' }, { name: '殞星巨獸', emoji: '☄️', magic: true, attr: 'fire' }
];
var GOD_CHAOS_POOL = [
  { name: '混沌幼獸', emoji: '🐾', attr: 'dark' }, { name: '虛空行者', emoji: '🌌', magic: true, attr: 'dark' },
  { name: '時空魔靈', emoji: '⏱️', magic: true, attr: 'lightning' }, { name: '裂縫幻影', emoji: '👥', attr: 'dark' },
  { name: '混沌噬魂獸', emoji: '👾', attr: 'dark' }, { name: '蝕天巨煞', emoji: '👹', magic: true, attr: 'poison' },
  { name: '虛空之眼', emoji: '👁️', magic: true, attr: 'dark' }, { name: '元素狂暴體', emoji: '⚡', magic: true, attr: 'lightning' },
  { name: '混沌使者', emoji: '🔮', magic: true, attr: 'light' }, { name: '星雲魔獸', emoji: '🌌', magic: true, attr: 'ice' },
  { name: '創世餘燼', emoji: '🔥', magic: true, attr: 'fire' }, { name: '混沌大天尊', emoji: '☸️', magic: true, attr: 'dark' }
];
var GOD_SANCTUARY_POOL = [
  { name: '巡天聖光', emoji: '💫', magic: true, attr: 'light' }, { name: '熾天使', emoji: '👼', magic: true, attr: 'light' },
  { name: '智天使', emoji: '👼‍♀️', magic: true, attr: 'light' }, { name: '審判使者', emoji: '⚖️', attr: 'light' },
  { name: '聖域守衛', emoji: '🛡️', attr: 'light' }, { name: '曜光巨龍', emoji: '🐉', magic: true, attr: 'light' },
  { name: '神威巨像', emoji: '🏛️', attr: 'light' }, { name: '永恒靈體', emoji: '🕊️', magic: true, attr: 'light' },
  { name: '創世執法官', emoji: '📜', magic: true, attr: 'light' }, { name: '神王護衛長', emoji: '👑', attr: 'light' },
  { name: '諸神榮光', emoji: '🌟', magic: true, attr: 'light' }, { name: '永恒神王', emoji: '🌌', magic: true, attr: 'light' }
];

var ZONE_LIST = ['plains', 'desert', 'swamp', 'god_battlefield', 'god_chaos', 'god_sanctuary'];
var REALMS = {
  human: { name: '凡人界', emoji: '🌍', zones: ['plains', 'desert', 'swamp'] },
  god: { name: '神界', emoji: '✨', zones: ['god_battlefield', 'god_chaos', 'god_sanctuary'] }
};
var ZONES = {
  plains: {
    name: '草原', emoji: '🌿', pool: MONSTER_POOL, realm: 'human',
    hpMult: 1, atkMult: 1, defMult: 1, aspdMult: 1, rewardMult: 1
  },
  desert: {
    name: '荒漠', emoji: '🏜️', pool: DESERT_POOL, realm: 'human',
    hpMult: 2.2, atkMult: 1.8, defMult: 1.6, aspdMult: 1.5, rewardMult: 1.25, reqZone: 'plains', reqStage: 100
  },
  swamp: {
    name: '沼澤', emoji: '🦠', pool: SWAMP_POOL, realm: 'human',
    hpMult: 4, atkMult: 2.8, defMult: 2.4, aspdMult: 2, rewardMult: 1.5, reqZone: 'desert', reqStage: 100
  },
  god_battlefield: {
    name: '太古戰場', emoji: '⚔️', pool: GOD_BATTLEFIELD_POOL, realm: 'god',
    hpMult: 10, atkMult: 5, defMult: 4, aspdMult: 1.75, rewardMult: 5
  },
  god_chaos: {
    name: '混沌界', emoji: '🌀', pool: GOD_CHAOS_POOL, realm: 'god',
    hpMult: 25, atkMult: 10, defMult: 8, aspdMult: 2, rewardMult: 12, reqZone: 'god_battlefield', reqStage: 100
  },
  god_sanctuary: {
    name: '永恒神域', emoji: '✨', pool: GOD_SANCTUARY_POOL, realm: 'god',
    hpMult: 60, atkMult: 20, defMult: 15, aspdMult: 2.25, rewardMult: 25, reqZone: 'god_chaos', reqStage: 100
  }
};
function currentZoneDef() {
  return ZONES[(G.stage && G.stage.zone) || 'plains'] || ZONES.plains;
}

var RESPAWN_DELAY = 0.8;       // 出怪間隔（秒）
var FIELD_ENEMY_DEATH_CLEAR_DELAY = 2.1; // 野外敵人死亡後保留戰鬥資訊時間（秒）；須長於 2 秒傷害飄字動畫
var REVIVE_DELAY = 3.0;        // 死亡復活時間（秒）
var FIELD_DEATH_STAGE_RETREAT = 10; // 野外死亡退回階段數

// ---- BOSS 高塔（元素 BOSS 以魔法攻擊） ----
var BOSS_LIST = [
  // attr = 屬性標籤（每個敵人必有；供「對X屬性敵人傷害」加成與 tips 顯示）；elem = 元素攻擊機制（可為 null，不因 attr 而改變）
  { name: '烈焰魔君', emoji: '🔥', elem: 'fire', attr: 'fire', img: 'boss_flame.png' },
  { name: '冰霜女皇', emoji: '❄️', elem: 'ice', attr: 'ice', img: 'boss_ice.png' },
  { name: '雷霆巨獸', emoji: '⚡', elem: 'lightning', attr: 'lightning', img: 'boss_thunder.png' },
  { name: '鋼鐵魔像', emoji: '🤖', elem: null, attr: 'lightning', img: 'boss_iron.png' },
  { name: '劇毒之母', emoji: '🕷️', elem: 'poison', attr: 'poison', img: 'boss_poison.png' },
  { name: '深淵領主', emoji: '😈', elem: 'dark', attr: 'dark', img: 'boss_abyss.png' },
  { name: '亡靈霜龍', emoji: '🐲', elem: 'ice', attr: 'ice', img: 'boss_dragon.png' },
  { name: '聖焰審判官', emoji: '😇', elem: 'light', attr: 'light', img: 'boss_light.png' },
  { name: '風暴泰坦', emoji: '🌩️', elem: 'lightning', attr: 'lightning', img: 'boss_storm.png' },
  { name: '混沌之影', emoji: '🌑', elem: 'dark', attr: 'dark', img: 'boss_chaos.png' }
];
/* ---- 高塔 BOSS 各塔獨立參數 ----
   試煉之塔(1~50)／地獄之塔(51~100)／煉獄之塔(101~150) 三套獨立設定，
   由 towerBossCfg(floor)（formula.js §4）依樓層選用；
   數值來自參數表「4-高塔BOSS」各列（apply_params 以物件名＋欄位錨定）。
   hpMult/atkMult/defMult 為「直接乘基準值」的總倍率（各塔獨立、不再鏈乘）。 */
var TOWER_BOSS_TRIAL = {                                  // 試煉之塔 1~50 層
  refStageBase: 4, refStagePerFloor: 5,                   // 對應野外階段 = base + 樓層×perFloor
  levelBonus: 3,                                          // BOSS 等級 = 對應階段 + levelBonus
  hitBase: 200, hitPerFloor: 70,                          // 命中率 = hitBase + 樓層×hitPerFloor
  hpMult: 20, atkMult: 3, defMult: 10,                    // 生命/攻擊/物魔防 = 基準 × 倍率
  aspd: 3, ctrlRes: 70,                                   // 攻速（次/秒）／控制抵抗%
  dodgeBase: 20, dodgeCap: 10000000, dodgePerFloor: 40,   // 閃避 = min(base + 樓層×per, cap)%
  elemMult: 3,                                            // 元素附傷 = 總魔攻 × elemMult
  xpMult: 2,                                              // 經驗 = 建議野外階段普通怪經驗 × xpMult
  timeLimit: 60, enrageTime: 40, enrageMult: 3, chargePeriod: 8 // 戰鬥規則：限時/狂暴檢查秒/狂暴倍率/蓄力周期秒
};
var TOWER_BOSS_HELL = {                                   // 地獄之塔 51~100 層
  refStageBase: 4, refStagePerFloor: 5,
  levelBonus: 3,
  hitBase: 200, hitPerFloor: 70,
  hpMult: 400, atkMult: 15, defMult: 10,
  aspd: 3, ctrlRes: 70,
  dodgeBase: 20, dodgeCap: 10000000, dodgePerFloor: 40,
  elemMult: 3,
  xpMult: 2,
  timeLimit: 60, enrageTime: 40, enrageMult: 3, chargePeriod: 8
};
var TOWER_BOSS_PURGATORY = {                              // 煉獄之塔 101~150 層
  refStageBase: 4, refStagePerFloor: 5,
  levelBonus: 3,
  hitBase: 200, hitPerFloor: 70,
  hpMult: 4000, atkMult: 75, defMult: 10,
  aspd: 3, ctrlRes: 70,
  dodgeBase: 20, dodgeCap: 10000000, dodgePerFloor: 40,
  elemMult: 3,
  xpMult: 2,
  timeLimit: 60, enrageTime: 40, enrageMult: 3, chargePeriod: 8
};
var TOWER_TRIAL_MAX_FLOOR = 50;
var TOWER_HELL_MAX_FLOOR = 100;
var TOWER_PURGATORY_MAX_FLOOR = 150;
var TOWER_MAX_FLOOR = TOWER_PURGATORY_MAX_FLOOR;
// 高塔挑戰金幣消耗分層：cost = round(a × 樓層^b)，依樓層落在哪一段選用該段的 a/b。
// 段落取自參數表「4-高塔BOSS／挑戰金幣消耗」（格式 {下限~上限,a=,b=}）；超過最高段的樓層沿用最後一段。
var TOWER_CHALLENGE_COST_TIERS = [
  { min: 1, max: 50, a: 10000, b: 1.8 },
  { min: 51, max: 100, a: 50000, b: 2 },
  { min: 101, max: 150, a: 100000, b: 2.2 }
];
var TOWER_HELL_SOUL_ORIGIN_BASE_RATE = 5;
var TOWER_HELL_SOUL_ORIGIN_PER_FLOOR = 1;
// 高塔限時（秒）：各塔獨立（TOWER_BOSS_*.timeLimit），依樓層選塔。
// 潛力技能 V3 起，潛力不再提供高塔限時加成（舊 potentialTowerTime 已移除）。
function towerTimeLimitWithTalents(floor) {
  return towerBossCfg(floor).timeLimit;
}
var TOWER_ENRAGE_HP = 50;      // 血量高於 50% 觸發（玩家「狂暴閾值」屬性可提高此門檻）；全塔共用

// ---- 自動機組零件 ----
/* 零件數值 = perTier × 階級（T1~T7）；node 決定可安裝的節點。
   分解槽零件（node:'salvage'）多樣化：產量倍率、精粹強化、額外材料掉落…
   效果掛勾在 factory.js 的 doSalvage（以 partBonus('salvage', key) 讀取）。 */
var PART_TYPES = {
  // === 分解槽（Salvage）：10 種，涵蓋速度 / 產量 / 精華 / 額外掉落 ===
  speedGear: { name: '加速齒輪', emoji: '⚙️', node: 'salvage', desc: '分解速度 +{v}%', perTier: 25 },
  scrapForge: { name: '碎片熔煉爐', emoji: '🔥', node: 'salvage', desc: '分解碎片產量 +{v}%', perTier: 20 },
  goldSluice: { name: '淘金濾網', emoji: '💰', node: 'salvage', desc: '分解金幣產量 +{v}%', perTier: 25 },
  extractLens: { name: '精粹透鏡', emoji: '🔬', node: 'salvage', desc: '分解時附魔精華產出率 +{v}%', perTier: 20 },
  bookScavenger: { name: '拓本回收臂', emoji: '📖', node: 'salvage', desc: '分解時 {v}% 機率回收 1 本附魔書', perTier: 0.4 },
  duplicator: { name: '複製處理艙', emoji: '♻️', node: 'salvage', desc: '分解時 {v}% 機率產出（碎片＋金幣）翻倍', perTier: 3 },
  archivist: { name: '知識回收器', emoji: '📚', node: 'salvage', desc: '分解時 {v}% 機率獲得經驗（裝備等級×25）', perTier: 1.5 },
  prospector: { name: '探礦核心', emoji: '⛏️', node: 'salvage', desc: '分解時 {v}% 機率額外掉落一個自動機組零件', perTier: 0.15 },
  fortuneChip: { name: '幸運晶片', emoji: '🎰', node: 'salvage', desc: '分解時 {v}% 機率「大豐收」：本次碎片/金幣/精華 ×3', perTier: 0.5 },
  ancientEssenceRate: { name: '太古精華萃取器', emoji: '🧬', node: 'salvage', desc: '分解太古精華掉落率 +{v}%', perTier: 25 },
  // === 合成節點（Synth） ===
  luckCore: { name: '幸運核心', emoji: '🍀', node: 'synth', desc: '合成大成功率 +{v}%', perTier: 8 },
  rerollModule: { name: '重骰模組', emoji: '🎲', node: 'synth', desc: '合成時詞條重骰（取較佳值）機率 +{v}%', perTier: 15 }
};
var PART_MAX_TIER = 7;
var NODE_NAMES = { filter: '篩選節點', salvage: '分解槽', synth: '合成節點', enchant: '附魔節點', upgrade: '強化節點' };
var PART_SLOTS_PER_NODE = 2;   // 每個可安裝節點的零件槽數（預設；可由 PART_SLOTS 覆寫）
var PART_SLOTS = { synth: 2 }; // 各節點零件槽數（分解槽使用金幣解鎖，見 formula.js salvageSlotCount）
function slotsForNode(node) {
  if (node === 'salvage') return salvageSlotCount(); // 分解槽使用金幣解鎖至 20 格
  return PART_SLOTS[node] || PART_SLOTS_PER_NODE;
}
var PART_KEEP_PER_KEY = 10;    // 零件庫存收斂：每種零件未安裝者最多保留 10 顆

// ---- 生產線 ----
var CONVEYOR_CAP = 20000;      // 輸送帶固定硬上限；超出的新裝備直接丟棄
var SYNTH_BUFFER_CAP = 30;     // 合成暫存區基礎容量（受「負重上限」屬性擴充）
var INVENTORY_CAP = 100;       // 背包基礎容量（參數表「7-容量／背包容量」a）
var INVENTORY_MAX = 1000;      // 背包擴充上限（含基礎容量，可自訂；參數表「7-容量／背包容量」b）
// 背包擴充費用：a + b × c^購買次數（購買次數 = 已擴充次數 + 1）；參數表「7-容量／背包擴充費用」a/b/c
var INVENTORY_EXPAND_COST_BASE = 10000;  // a＝基值
var INVENTORY_EXPAND_COST_MULT = 10000;  // b＝擴充倍數
var INVENTORY_EXPAND_COST_RATE = 1.02;   // c＝指數底
var FACTORY_BASE_INTERVAL = 2.0; // 生產線基礎處理間隔（秒/件）
var SYNTHESIS_ENABLED = false; // 合成節點暫時關閉，連同合成專用零件與其掉落一併停用
var SYNTH_GREAT_BASE = 5;        // 合成大成功基礎機率 %

function isFactoryNodeEnabled(node) {
  return node !== 'synth' || SYNTHESIS_ENABLED;
}
// 強化成功率公式 upgradeSuccessBase → 集中於 js/formula.js §7

// ---- 熔爐（正式版；原「新熔爐」合併取代舊生產線輸送帶/篩選/分解槽）----
// 拆解產出沿用舊分解槽規則（碎片/金幣/附魔精華/太古精華 → factory.js doSalvage、
// formula.js salvageResult）；零件加成改由各熔爐零件格提供。專屬材料系統已移除。
var NEW_FORGE_MAX = 12;            // 熔爐座數硬上限（實際可設數量與轉生連動 → formula.js newForgeMaxFurnaces）
var NEW_FORGE_BASE_FURNACES = 2;   // 0 轉可設熔爐數
var NEW_FORGE_FURNACE_PER_REINC = 1; // 每 1 轉再多可設熔爐數
var NEW_FORGE_INTERVAL = 2.0;      // 每座熔爐入爐間隔（秒/件）
var NEW_FORGE_QUEUE_CAP = 20000;   // 佇列「總量」上限＝總佇列＋各爐專屬佇列合計；滿載時新裝備丟棄（同舊輸送帶滿載規則，並防存檔膨脹）
var NEW_FORGE_FURNACE_QUEUE_CAP = 9999; // 每座熔爐專屬佇列上限（帶尾 +N 顯示封頂同值）
var NEW_FORGE_BELT_CAP = 30;       // 傳送帶在途件數上限（原 10 ×3）
var NEW_FORGE_BELT_SHOW = 30;      // 傳送帶顯示件數上限（＝容量全顯；帶滿時以常見遊戲視窗寬約 8 成滿）
var NEW_FORGE_ROUTE_PER_TICK = NEW_FORGE_BELT_CAP; // 每輪路由每座熔爐可分派件數＝帶容量：單輪足以補滿空帶，配合平均分流不餓死後面的熔爐（原 5 過低，加速齒輪快爐會吃光額度）
var NEW_FORGE_NAME = '鍛造熔爐';
var NEW_FORGE_EMOJI = '🔥';
var NEW_FORGE_DESC = '專門處理裝備及礦石';
var NEW_FORGE_IMAGE = 'images/furnace_LV1.png'; // 熔爐大圖（統一）
// 零件置入格：每爐初始 3 格、金幣逐格解鎖至 8 格（成本公式 → formula.js newForgePartSlotCost）
var NEW_FORGE_PART_SLOTS_INITIAL = 3;
var NEW_FORGE_PART_SLOTS_MAX = 8;
var NEW_FORGE_SLOT_COST_REINC = 50000; // 50000×轉生²
var NEW_FORGE_SLOT_COST_BASE = 2000;  // 2000×(已解鎖-1)^(熔爐數)
var NEW_FORGE_SLOT_COST_EXP = 0;

// ---- 寶石 ----
/* GEM_MAX_LEVEL = 一般系統上限（掉落/商店/合成/轉換/拆解/融合皆以此為限）。
   6~10 階為「神鑄寶石」：僅能由神鑄法陣以 6 顆同種同階（5 階起）合成，
   每高 1 階能力 ×2（gemStatValue → js/formula.js §8）。 */
var GEM_MAX_LEVEL = 5;
var GEM_FORGE_MAX_LEVEL = 10;
var GEM_NAMES = ['', '一級', '二級', '三級', '四級', '五級', '六級', '七級', '八級', '九級', '十級'];

/* 寶石種類（12 種能力）：鑲嵌到裝備插槽後生效。
   stat 對應 computeStats 的聚合桶（aspd 會轉為 aspdPct） */
var GEM_TYPES = {
  ruby: { name: '紅寶石', emoji: '🔴', stat: 'atkFlat', statName: '物理攻擊', base: 6, pct: false },
  sapphire: { name: '藍寶石', emoji: '🔵', stat: 'matkFlat', statName: '魔法攻擊', base: 6, pct: false },
  topaz: { name: '黃玉', emoji: '🟡', stat: 'hpFlat', statName: '生命值', base: 40, pct: false },
  emerald: { name: '綠寶石', emoji: '🟢', stat: 'hpRegen', statName: '生命恢復/秒', base: 3, pct: false },
  diamond: { name: '鑽石', emoji: '⚪', stat: 'defFlat', statName: '物理防禦', base: 5, pct: false },
  lapis: { name: '青金石', emoji: '🔷', stat: 'mdefFlat', statName: '魔法防禦', base: 5, pct: false },
  amethyst: { name: '紫水晶', emoji: '🟣', stat: 'critRate', statName: '暴擊率%', base: 1.5, pct: true },
  garnet: { name: '石榴石', emoji: '🟠', stat: 'critDmg', statName: '暴擊傷害%', base: 5, pct: true },
  opal: { name: '蛋白石', emoji: '🩵', stat: 'aspd', statName: '攻擊速度%', base: 1.5, pct: true },
  onyx: { name: '黑曜石', emoji: '⚫', stat: 'lifesteal', statName: '吸血%', base: 1, pct: true },
  moonstone: { name: '月光石', emoji: '🌙', stat: 'evasion', statName: '閃避率%', base: 1, pct: true },
  /* 命中（月光石的對位）：命中與閃避是 1:1 相抵的一對（resolveHit 取 clamp(命中−閃避, 5, 100)），
     但玩家命中基礎已有 100%、敵人閃避從 5% 起隨等級成長，所以同樣 1 點的命中價值低於閃避。
     base 取 1.5＝月光石的 1.5 倍，與詞條池同一對的比例一致（命中 base 3 / 閃避 base 2）。 */
  catseye: { name: '貓眼石', emoji: '👁️', stat: 'hit', statName: '命中率%', base: 1.5, pct: true },
  sunstone: { name: '太陽石', emoji: '☀️', stat: 'luck', statName: '幸運值', base: 1.5, pct: false },
  // === 防禦類（2026-07-09 新增 6 種）===
  jade: { name: '翡翠', emoji: '🟩', stat: 'tenacity', statName: '韌性%', base: 1.5, pct: true },
  turquoise: { name: '綠松石', emoji: '🟦', stat: 'blockRate', statName: '格擋率%', base: 1, pct: true },
  agate: { name: '瑪瑙', emoji: '🟤', stat: 'blockDmgRed', statName: '格擋減傷%', base: 1.5, pct: true },
  pearl: { name: '珍珠', emoji: '🤍', stat: 'shieldEff', statName: '護盾效率%', base: 2, pct: true },
  malachite: { name: '孔雀石', emoji: '💚', stat: 'pRes', statName: '物理抗性%', base: 0.8, pct: true },
  fluorite: { name: '螢石', emoji: '💙', stat: 'mRes', statName: '魔法抗性%', base: 0.8, pct: true },
  // === 對屬性敵人傷害（六大屬性；linear：1~5 階＝base×等級 線性、6 階起每階 ×2）===
  // base=0.2：Lv1 0.2%、每級 +0.2% 至 Lv5 1.0%，Lv6 起為前一級 ×2（2.0%、4.0%…）。
  spinel: { name: '尖晶石', emoji: '🔥', stat: 'dmgVsFire', statName: '對火屬性敵人傷害%', base: 0.2, pct: true, linear: true },
  aquamarine: { name: '海藍寶石', emoji: '❄️', stat: 'dmgVsIce', statName: '對冰屬性敵人傷害%', base: 0.2, pct: true, linear: true },
  amazonite: { name: '天河石', emoji: '⚡', stat: 'dmgVsLightning', statName: '對雷屬性敵人傷害%', base: 0.2, pct: true, linear: true },
  peridot: { name: '橄欖石', emoji: '☠️', stat: 'dmgVsPoison', statName: '對毒屬性敵人傷害%', base: 0.2, pct: true, linear: true },
  citrine: { name: '黃水晶', emoji: '✨', stat: 'dmgVsLight', statName: '對聖屬性敵人傷害%', base: 0.2, pct: true, linear: true },
  tourmaline: { name: '黑碧璽', emoji: '🌑', stat: 'dmgVsDark', statName: '對暗屬性敵人傷害%', base: 0.2, pct: true, linear: true },
  // === 屬性傷害提升（六大屬性，2026-07-23 新增；提升「自身」該屬性元素傷害輸出；linear 同上）===
  coreFire: { name: '焰核寶石', emoji: '🌋', stat: 'elemDmgFire', statName: '火屬性傷害提升%', base: 0.2, pct: true, linear: true },
  coreIce: { name: '冰核寶石', emoji: '🌨️', stat: 'elemDmgIce', statName: '冰屬性傷害提升%', base: 0.2, pct: true, linear: true },
  coreLightning: { name: '雷核寶石', emoji: '🌩️', stat: 'elemDmgLightning', statName: '雷屬性傷害提升%', base: 0.2, pct: true, linear: true },
  corePoison: { name: '毒核寶石', emoji: '🦠', stat: 'elemDmgPoison', statName: '毒屬性傷害提升%', base: 0.2, pct: true, linear: true },
  coreLight: { name: '聖核寶石', emoji: '🌟', stat: 'elemDmgLight', statName: '聖屬性傷害提升%', base: 0.2, pct: true, linear: true },
  coreDark: { name: '暗核寶石', emoji: '🌚', stat: 'elemDmgDark', statName: '暗屬性傷害提升%', base: 0.2, pct: true, linear: true },
  // === 元素抗性寶石（linear：1~5 階每級 +base%、6 階起每階 ×2）===
  // 六系 base=5 → L1~5：5/10/15/20/25%、L6~10：50/100/200/400/800%（L10 +800%）
  // 全系 base=1 → L1~5：1/2/3/4/5%、L6~10：10/20/40/80/160%（L10 +160%，六大屬性一起加）
  wardFire: { name: '火抗寶石', emoji: '🧯', stat: 'resFire', statName: '火焰抗性%', base: 5, pct: true, linear: true },
  wardIce: { name: '冰抗寶石', emoji: '🧊', stat: 'resIce', statName: '冰霜抗性%', base: 5, pct: true, linear: true },
  wardLightning: { name: '電抗寶石', emoji: '🔌', stat: 'resLightning', statName: '雷電抗性%', base: 5, pct: true, linear: true },
  wardPoison: { name: '毒抗寶石', emoji: '💊', stat: 'resPoison', statName: '劇毒抗性%', base: 5, pct: true, linear: true },
  wardDark: { name: '暗抗寶石', emoji: '🕯️', stat: 'resDark', statName: '暗影抗性%', base: 5, pct: true, linear: true },
  wardLight: { name: '聖抗寶石', emoji: '🕶️', stat: 'resLight', statName: '聖光抗性%', base: 5, pct: true, linear: true },
  wardAll: { name: '全屬性抗性寶石', emoji: '🌈', stat: 'resAll', statName: '全屬性抗性%', base: 1, pct: true, linear: true }
};
// 寶石數值/插槽/附魔欄位公式（gemStatValue、socketCountFor、enchantCapFor）→ js/formula.js §8
// 寶石合成：3 顆「同種類、同等級」→ 1 顆同種類下一級；UI 另支援全部類型逐種類合成
var GEM_TYPE_ALL = '__all__';
var GEM_COMPOSE_INPUT_COUNT = 3; // 每次手動合成所需的同種同級寶石數量
var FUSE_GOLD_COST = [0, 100, 300, 900, 2700, 8100]; // 金幣費用，依素材等級

/* ---- 寶石融合 v2（僅限 5 階）----
   不同屬性 x2 → 雙屬性寶石（數值隨機）；同屬性 → 數值介於兩者間、上限 2 倍。
   成功率 60%，融合成品每成功一次 -10%（最低 10%）。
   失敗：較弱的一顆降解為低階寶石（4~8 顆 1 級或 2~4 顆 2 級同屬性）。 */
var GEM_FUSE_BASE_RATE = 60;
var GEM_FUSE_RATE_DECAY = 10;
var GEM_FUSE_MIN_RATE = 10;

/* ---- 寶石商店 ----
   商店等級 1~20：刷出數量與寶石階級機率依下方表格；價格依寶石階級。
   手動刷新費用 = 5000 x（下一次重置序號 ^ 2.5），刷新次數每 8 小時重置。 */
var GEM_SHOP_TABLE = [
  { lv: 1, price: 10000 },
  { lv: 2, price: 100000 },
  { lv: 3, price: 500000 },
  { lv: 4, price: 2000000 },
  { lv: 5, price: 10000000 },
  { lv: 6, price: 50000000 },
  { lv: 7, price: 200000000 },
  { lv: 8, price: 1000000000 },
  { lv: 9, price: 10000000000 },
  { lv: 10, price: 1000000000000 }
];
var GEM_SHOP_MAX_LEVEL = 20;
// 每列為 [刷出數量, 機率%]，對應圖表「商店等級 / 刷出數量」。
var GEM_SHOP_COUNT_TABLE = [
  [[5, 50], [6, 50]],
  [[5, 50], [6, 40], [7, 10]],
  [[5, 50], [6, 30], [7, 10], [8, 10]],
  [[5, 45], [6, 30], [7, 15], [8, 10]],
  [[5, 40], [6, 30], [7, 15], [8, 15]],
  [[5, 35], [6, 30], [7, 15], [8, 15], [9, 5]],
  [[6, 35], [7, 30], [8, 15], [9, 15], [10, 5]],
  [[6, 30], [7, 30], [8, 15], [9, 15], [10, 10]],
  [[7, 30], [8, 30], [9, 15], [10, 15], [11, 10]],
  [[8, 30], [9, 30], [10, 15], [11, 15], [12, 10]],
  [[9, 30], [10, 30], [11, 15], [12, 15], [13, 10]],
  [[10, 30], [11, 30], [12, 15], [13, 15], [14, 10]],
  [[11, 30], [12, 30], [13, 15], [14, 15], [15, 10]],
  [[12, 30], [13, 30], [14, 15], [15, 15], [16, 10]],
  [[13, 30], [14, 30], [15, 15], [16, 15], [17, 10]],
  [[14, 30], [15, 30], [16, 15], [17, 15], [18, 10]],
  [[15, 30], [16, 30], [17, 15], [18, 15], [19, 10]],
  [[15, 10], [16, 20], [17, 30], [18, 15], [19, 15], [20, 10]],
  [[15, 10], [16, 20], [17, 30], [18, 15], [19, 15], [20, 10]],
  [[15, 10], [16, 20], [17, 30], [18, 15], [19, 15], [20, 10]]
];
// 每列為 [寶石階級, 機率%]，對應圖表「商店等級 / 刷出寶石等級」。
var GEM_SHOP_TIER_TABLE = [
  [[1, 75], [2, 20], [3, 4], [4, 1]],
  [[1, 73], [2, 20], [3, 5], [4, 2]],
  [[1, 71], [2, 20], [3, 6], [4, 3]],
  [[1, 70.5], [2, 20], [3, 6], [4, 3], [5, 0.5]],
  [[1, 69], [2, 20], [3, 6], [4, 4], [5, 1]],
  [[1, 67.5], [2, 20], [3, 6], [4, 5], [5, 1.5]],
  [[1, 64], [2, 20], [3, 8], [4, 6], [5, 2]],
  [[1, 61.5], [2, 20], [3, 9], [4, 7], [5, 2.5]],
  [[1, 59], [2, 20], [3, 10], [4, 8], [5, 3]],
  [[1, 58], [2, 20], [3, 10], [4, 8], [5, 3.5], [6, 0.5]],
  [[1, 57.25], [2, 20], [3, 10], [4, 8], [5, 4], [6, 0.75]],
  [[1, 53.5], [2, 20], [3, 12], [4, 9], [5, 4.5], [6, 1]],
  [[1, 53.25], [2, 20], [3, 12], [4, 9], [5, 4.5], [6, 1.25]],
  [[1, 53], [2, 20], [3, 12], [4, 9], [5, 4.5], [6, 1.5]],
  [[1, 51.5], [2, 20], [3, 12], [4, 10], [5, 5], [6, 1], [7, 0.5]],
  [[1, 50.75], [2, 20], [3, 12], [4, 10], [5, 5], [6, 1.25], [7, 1]],
  [[1, 50.5], [2, 20], [3, 12], [4, 10], [5, 5], [6, 1.25], [7, 1.25]],
  [[1, 50], [2, 20], [3, 12], [4, 10], [5, 5], [6, 1.25], [7, 1.25], [8, 0.5]],
  [[1, 49.65], [2, 20], [3, 12], [4, 10], [5, 5], [6, 1.25], [7, 1.25], [8, 0.75], [9, 0.1]],
  [[1, 48.9], [2, 20], [3, 12], [4, 10], [5, 5], [6, 1.25], [7, 1.25], [8, 1], [9, 0.5], [10, 0.1]]
];
var GEM_SHOP_REFRESH_BASE = 5000;
var GEM_SHOP_REFRESH_EXPONENT = 2.5;
function gemShopPrice(lv) { // 商店標價：查上方 GEM_SHOP_TABLE（刷新費用公式 shopRefreshCost → js/formula.js §8）
  for (var i = 0; i < GEM_SHOP_TABLE.length; i++) if (GEM_SHOP_TABLE[i].lv === lv) return GEM_SHOP_TABLE[i].price;
  return 0;
}

/* ---- 物品掉落表 ----
   每個品質獨立擲骰（可同時掉多件）；機率 >100%：必掉 floor(p/100) 件，餘數為再掉 1 件的機率。
   rates 索引 = 品質 0~7（普通~創世）。 */
var FIELD_DROP_TABLE = [   // 野外：依怪物等級
  { min: 150, rates: [50, 40, 30, 10, 5, 2, 0.05, 0] },
  { min: 100, rates: [40, 30, 15, 10, 2.5, 1, 0, 0] },
  { min: 50, rates: [35, 20, 8, 4, 0.5, 0, 0, 0] },
  { min: 1, rates: [15, 10, 5, 0, 0, 0, 0, 0] }
];
var FIELD_GEM_DROP_TABLE = [ // 野外寶石：依怪物等級，各階級獨立判定
  { min: 301, rates: [14, 2.3, 0.8, 0.4, 0.3] },
  { min: 251, rates: [12, 2, 0.7, 0.3, 0.2] },
  { min: 201, rates: [10, 1.7, 0.6, 0.2, 0] },
  { min: 151, rates: [8, 1.4, 0.5, 0.1, 0] },
  { min: 101, rates: [6, 1.1, 0.4, 0, 0] },
  { min: 51, rates: [4, 0.8, 0.3, 0, 0] },
  { min: 1, rates: [2, 0.5, 0.2, 0, 0] }
];
var BOSS_DROP_TABLE = [    // 高塔 BOSS：依樓層 7 檔（與掉落表加總列逐欄核對：165/232/256/323/538/700/715）
  { min: 31, rates: [0, 0, 0, 300, 200, 150, 50, 15] },   // 30級含以上（715%）
  { min: 26, rates: [0, 0, 0, 300, 200, 150, 40, 10] },   // 26~30（700%）
  { min: 21, rates: [0, 0, 0, 250, 150, 100, 33, 5] },    // 21~25（538%）
  { min: 16, rates: [0, 0, 0, 150, 100, 50, 20, 2.5] },  // 16~20（322.5%）
  { min: 11, rates: [0, 0, 0, 100, 100, 50, 5, 1] },    // 11~15（256%）
  { min: 6, rates: [0, 0, 100, 100, 20, 10, 2, 0] },    // 6~10（232%）
  { min: 1, rates: [0, 0, 100, 50, 10, 5, 0, 0] }     // 1~5（165%）
];
/* 掉落表取用/擲骰公式（dropRatesFor、rollDropCount）→ js/formula.js §5
   怪物成長曲線 monsterStatsFor → js/formula.js §4
   升級經驗 xpForLevel、等級基礎四維 basePrimaryFor → js/formula.js §1
   防禦減傷 defReduction → js/formula.js §3 */

/* ---- 屬性面板顯示定義（側欄用） ---- */
function statFmt(val, cap, type, prefix) {
  var s = '';
  if (type === '%') s = pctStr(val);
  else if (type === '%.1f') s = Number(val).toFixed(1) + '%';
  else if (type === '/s') s = colorizeUnit(fmt(val)) + '/秒';
  else if (type === '/s.1f') s = colorizeUnit(Number(val).toFixed(1)) + '/秒';
  else if (type === 'raw1') s = fmt1(val);
  else s = colorizeUnit(fmt(val));
  if (prefix) s = '+' + s;
  // 上限 0（或 null）代表無上限，不做「達上限」金色標示。
  if (cap !== null && cap > 0 && val >= cap) return '<span style="color: #ffd700;">' + s + '</span>';
  return s;
}

// 屬性上限的說明文字：上限 0（或負）代表「無上限」。
// 註：於 STAT_GROUPS 建構（載入時）即呼叫，故不得依賴後載入檔的函式（如 fmt）；上限值為小整數，直接串接即可。
function capText(cap, unit, plus) {
  if (!(cap > 0)) return '';
  return '（上限：' + (plus ? '+' : '') + cap + (unit || '') + '）';
}

function effectNum(n) {
  n = Number(n) || 0;
  var s = n.toFixed(6).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

function joinEffectParts(parts) {
  if (parts.length <= 1) return parts[0] || '';
  return parts.slice(0, -1).join('、') + '與 ' + parts[parts.length - 1];
}

function primaryStatDesc(key) {
  var defs = {
    str: [
      { k: 'strAtk', unit: '點', label: '物理攻擊力' },
      { k: 'strDef', unit: '點', label: '物理防禦' },
      { k: 'strWeight', unit: '點', label: '負重上限' }
    ],
    agi: [
      { k: 'agiCritRate', unit: '%', label: '暴擊率' },
      { k: 'agiAspdPct', unit: '%', label: '攻速' },
      { k: 'agiEvasion', unit: '%', label: '閃避率' }
    ],
    int: [
      { k: 'intMp', unit: '點', label: '法力上限' },
      { k: 'intMpRegen', unit: '', label: '法力恢復' },
      { k: 'intMatk', unit: '點', label: '魔法攻擊力' },
      { k: 'intMdef', unit: '點', label: '魔法防禦' }
    ],
    vit: [
      { k: 'vitHp', unit: '點', label: '生命上限' },
      { k: 'vitDef', unit: '點', label: '物理防禦' },
      { k: 'vitMdef', unit: '點', label: '魔法防禦' }
    ]
  }[key] || [];
  var parts = [];
  defs.forEach(function (d) {
    var v = Number(PRIMARY_STAT_EFFECTS[d.k]);
    if (!isFinite(v) || v === 0) return;
    parts.push(effectNum(v) + d.unit + ' ' + d.label);
  });
  return parts.length ? '每增加 1 點提高 ' + joinEffectParts(parts) + '。' : '目前沒有額外派生效果。';
}

function blockDmgRedTotalCap() {
  return STAT_CAPS.blockDmgRed > 0 ? BLOCK_DMG_RED_BASE + STAT_CAPS.blockDmgRed : 0;
}

function blockDmgReduction(extra) {
  return capValue(BLOCK_DMG_RED_BASE + (extra || 0), blockDmgRedTotalCap());
}

function statDesc(st, baseDesc, label, keyBase, pctKey, pctNote) {
  if (!st.A) return baseDesc;
  var flat = st.A[keyBase + 'Flat'] || 0;
  var pct = pctKey ? (st.A[pctKey] || 0) : 0;
  var base = (st.base && st.base[keyBase]) ? st.base[keyBase] : 0;
  var reincBonus = (st.reincFlatBonus && st.reincFlatBonus[keyBase]) || 0;
  var s = baseDesc + '<br><br><span style="color:#aaa">';
  s += label + '總值：<span style="color:#fff">' + fmt(st[keyBase]) + '</span>';
  if (base !== 0) s += '<br>' + label + '基礎：<span style="color:#fff">' + fmt(base) + '</span>';
  if (flat !== 0) s += '<br>' + label + '定值加成：<span style="color:#fff">' + (flat > 0 ? '+' : '') + fmt(flat) + '</span>';
  if (st.reincFlatBonus && st.reincFlatBonus[keyBase] !== undefined) {
    s += '<br>' + label + '轉生強化：<span style="color:#fff">' + (reincBonus > 0 ? '+' : '') + fmt(reincBonus) + '</span>';
  }
  if (pct !== 0) s += '<br>' + label + '百分比加成' + (pctNote || '') + '：<span style="color:#fff">' + (pct > 0 ? '+' : '') + pctStr(pct) + '</span>';
  s += '</span>';
  return s;
}

function pctStrFloor4(n) {
  n = Number(n) || 0;
  return (Math.floor(n * 10000) / 10000).toFixed(4) + '%';
}

// 全局減傷顯示格式化：無條件捨去至小數點後四位，且不可能等於或超過 100% (最高為 99.9999%)
function pctStrFloor4GlobalDmgRed(n) {
  n = Number(n) || 0;
  var val = Math.floor(n * 10000) / 10000;
  if (val >= 100) {
    val = 99.9999;
  }
  return val.toFixed(4) + '%';
}

function defenseReductionDesc(st, keyBase) {
  var reduction = defReduction(st[keyBase] || 0, st.level || 1) * 100;
  return '<br><br><span style="color:#ffd700">目前同級減傷率：' + pctStrFloor4(reduction) + '</span>';
}

function defenseStatDesc(st, baseDesc, label, keyBase, pctKey, pctNote) {
  return statDesc(st, baseDesc, label, keyBase, pctKey, pctNote) + defenseReductionDesc(st, keyBase);
}

function resistanceReductionDesc(st, value, reductionFn) {
  var reduction = reductionFn(value || 0, st.level || 1) * 100;
  return '<br><br><span style="color:#ffd700">目前總減傷：' + pctStrFloor4(reduction) + '</span>';
}

// 六系元素抗性 tips：附魔抗性為獨立乘區（其他來源合計 ×(1+同系附魔合計%)），有附魔時顯示拆解
function elementResistDesc(st, elem, label) {
  var s = '降低受到的' + label + '屬性傷害，抗性值越高減傷效果越強。附魔「' + label + '屬性抗性」為額外加成：其他來源合計 ×(1+附魔合計%)。';
  var total = (st.resist && st.resist[elem]) || 0;
  var en = (st.enchantRes && st.enchantRes[elem]) || 0;
  if (en !== 0) {
    var base = total / (1 + en / 100);
    s += '<br><br><span style="color:#aaa">其他來源合計：<span style="color:#fff">' + fmt1(base) + '%</span>' +
      '<br>附魔獨立乘區：<span style="color:#fff">×(1 + ' + fmt1(en) + '%)</span></span>';
  }
  return s + resistanceReductionDesc(st, total, elementalResistanceReduction);
}

// 敵種傷害抗性（普通敵人/普通菁英/普通BOSS）tips：黃字顯示以自身等級為攻擊者等級的目前減傷率（截斷至小數四位）
function enemyTypeDmgRedDesc(st, key, label) {
  var reduction = enemyTypeDamageReduction(st[key] || 0, st.level || 1) * 100;
  return '受到' + label + '攻擊時，於全局減傷之後的最終階段按「減免值 ÷ (減免值 + ' +
    ENEMY_TYPE_DMG_RED_A + ' + ' + ENEMY_TYPE_DMG_RED_B + '×攻擊者等級)」比例減傷；多件裝備直接加總。' +
    '<br><br><span style="color:#ffd700">目前同級減傷率：' + pctStrFloor4(reduction) + '</span>';
}

var STAT_GROUPS = [
  {
    title: '基礎屬性', rows: [
      ['❤️ 生命值', function (st) { return statFmt(st.hp, null); }, function (st) { return statDesc(st, '承受傷害的能力，歸零時角色將會死亡。', '生命', 'hp', 'hpPct'); }],
      ['💗 生命恢復', function (st) { return statFmt(st.hpRegen + st.hp * BASE_HP_REGEN_PCT / 100, null, '/s'); }, '每秒自動回復的生命值（包含基礎 1.5% 與額外加成）。'],
      ['🔵 法力值', function (st) { return statFmt(st.mp, null); }, function (st) { return statDesc(st, '施放多數技能所需的能量。', '法力', 'mp', null); }],
      ['💧 法力恢復', function (st) { return statFmt(st.mpRegen, null, '/s'); }, '每秒自動回復的法力值。'],
      ['💪 力量', function (st) { return statFmt(st.str, null); }, function () { return primaryStatDesc('str'); }],
      ['🏃 敏捷', function (st) { return statFmt(st.agi, null); }, function () { return primaryStatDesc('agi'); }],
      ['🧠 智力', function (st) { return statFmt(st.int, null); }, function () { return primaryStatDesc('int'); }],
      ['🪨 耐力', function (st) { return statFmt(st.vit, null); }, function () { return primaryStatDesc('vit'); }]
    ]
  },
  {
    title: '進攻屬性', rows: [
      ['⚔️ 物理攻擊', function (st) { return statFmt(st.atk, null); }, function (st) { return statDesc(st, '影響普攻與多數物理技能的傷害基礎。由力量派生；裝備等「定值加成」會依轉生次數獲得指數強化。', '物理攻擊', 'atk', 'atkPct'); }],
      ['🔮 魔法攻擊', function (st) { return statFmt(st.matk, null); }, function (st) { return statDesc(st, '影響多數魔法技能的傷害基礎。由智力派生；裝備等「定值加成」會依轉生次數獲得指數強化。', '魔法攻擊', 'matk', 'matkPct'); }],
      ['💥 暴擊率', function (st) { return statFmt(st.critRate, STAT_CAPS.critRate, '%'); }, '攻擊時造成額外暴擊傷害的機率。暴擊率 100% 為完全爆擊，超過 100% 的部分會衍生「連擊數」。' + capText(STAT_CAPS.critRate, '%')],
      ['🔗 連擊數', function (st) { return (st.comboHits || 0) > 0 ? fmt1(st.comboHits) + ' 次' : '—'; }, '暴擊率超過 100% 後衍生：普攻與技能的「直接傷害」會額外追加的攻擊次數。持續傷害不受影響。'],
      ['🩸 暴擊傷害', function (st) { return Math.round(st.critDmg) + '%'; }, '觸發暴擊時的傷害倍率。'],
      ['🗡️ 物理穿透', function (st) { return statFmt(st.pPen, STAT_CAPS.pPen, '%'); }, '造成物理傷害時，無視敵方一定比例的物理防禦。' + capText(STAT_CAPS.pPen, '%')],
      ['🪄 魔法穿透', function (st) { return statFmt(st.mPen, STAT_CAPS.mPen, '%'); }, '造成魔法傷害時，無視敵方一定比例的魔法防禦。' + capText(STAT_CAPS.mPen, '%')],
      ['🎯 命中率', function (st) { return statFmt(st.hit, null, '%'); }, '直接抵消敵方的閃避機率。'],
      ['⚡ 攻擊速度', function (st) { return statFmt(st.aspd, ASPD_CAP, '/s.1f'); }, function () { return '每秒進行普通攻擊的次數。' + capText(ASPD_CAP, '/秒'); }],
      ['⏱️ 冷卻縮減', function (st) { return statFmt(st.cdr, STAT_CAPS.cdr, '%.1f'); }, '減少技能所需的冷卻時間。' + capText(STAT_CAPS.cdr, '%')],
      ['🌀 施法速度', function (st) { return statFmt(st.castSpeed, STAT_CAPS.castSpeed, '%.1f'); }, '縮短技能的施放延遲或詠唱時間。' + capText(STAT_CAPS.castSpeed, '%')],
      ['🧛 吸血', function (st) { return statFmt(st.lifesteal, STAT_CAPS.lifesteal, '%.1f'); }, '造成傷害時，將部分傷害轉化為自身生命值。' + capText(STAT_CAPS.lifesteal, '%')],
      ['🌊 吸魔', function (st) { return statFmt(st.manaSteal, STAT_CAPS.manaSteal, '%.1f'); }, '造成傷害時，將部分傷害轉化為自身法力值。' + capText(STAT_CAPS.manaSteal, '%')],
      ['👑 對菁英傷害', function (st) { return statFmt(st.eliteDmg, null, '%', true); }, '對菁英怪或首領怪物造成的額外傷害加成。'],
      ['😈 對BOSS傷害', function (st) { return statFmt(st.bossDmg, null, '%', true); }, '專門對首領怪物造成的額外傷害加成。'],
      ['👤 對普通敵人傷害', function (st) { return statFmt(st.normalDmg, null, '%', true); }, '對普通敵人（非菁英、非BOSS）造成的額外傷害加成，公式與對菁英/BOSS傷害相同。'],
      ['🔥 對火屬性敵人傷害', function (st) { return statFmt(st.dmgVsElem.fire, null, '%', true); }, '對「帶火屬性標籤」的敵人造成的傷害提高。'],
      ['❄️ 對冰屬性敵人傷害', function (st) { return statFmt(st.dmgVsElem.ice, null, '%', true); }, '對「帶冰屬性標籤」的敵人造成的傷害提高。'],
      ['⚡ 對雷屬性敵人傷害', function (st) { return statFmt(st.dmgVsElem.lightning, null, '%', true); }, '對「帶雷屬性標籤」的敵人造成的傷害提高。'],
      ['☠️ 對毒屬性敵人傷害', function (st) { return statFmt(st.dmgVsElem.poison, null, '%', true); }, '對「帶毒屬性標籤」的敵人造成的傷害提高。'],
      ['✨ 對聖屬性敵人傷害', function (st) { return statFmt(st.dmgVsElem.light, null, '%', true); }, '對「帶聖屬性標籤」的敵人造成的傷害提高。'],
      ['🌑 對暗屬性敵人傷害', function (st) { return statFmt(st.dmgVsElem.dark, null, '%', true); }, '對「帶暗屬性標籤」的敵人造成的傷害提高。'],
      ['🔥 火屬性傷害提升', function (st) { return statFmt(st.elemDmgUp.fire, null, '%', true); }, '自身造成的火屬性元素傷害提高（含附魔固定元素攻擊、技能元素成分與天賦元素附傷）。'],
      ['❄️ 冰屬性傷害提升', function (st) { return statFmt(st.elemDmgUp.ice, null, '%', true); }, '自身造成的冰屬性元素傷害提高（含附魔固定元素攻擊、技能元素成分與天賦元素附傷）。'],
      ['⚡ 雷屬性傷害提升', function (st) { return statFmt(st.elemDmgUp.lightning, null, '%', true); }, '自身造成的雷屬性元素傷害提高（含附魔固定元素攻擊、技能元素成分與天賦元素附傷）。'],
      ['☠️ 毒屬性傷害提升', function (st) { return statFmt(st.elemDmgUp.poison, null, '%', true); }, '自身造成的毒屬性元素傷害提高（含附魔固定元素攻擊、技能元素成分與天賦元素附傷）。'],
      ['✨ 聖屬性傷害提升', function (st) { return statFmt(st.elemDmgUp.light, null, '%', true); }, '自身造成的聖屬性元素傷害提高（含附魔固定元素攻擊、技能元素成分與天賦元素附傷）。'],
      ['🌑 暗屬性傷害提升', function (st) { return statFmt(st.elemDmgUp.dark, null, '%', true); }, '自身造成的暗屬性元素傷害提高（含附魔固定元素攻擊、技能元素成分與天賦元素附傷）。'],
      ['💫 範圍傷害', function (st) { return statFmt(st.aoeDmg, null, '%', true); }, '多目標或範圍技能的總體傷害加成。']
    ]
  },
  {
    title: '防禦屬性', rows: [
      ['🛡️ 物理防禦', function (st) { return statFmt(st.def, null); }, function (st) { return defenseStatDesc(st, '根據防禦公式降低受到的物理傷害。由力量與耐力派生；定值加成依轉生次數指數強化，百分比加成取自物理防禦%。', '物理防禦', 'def', 'defPct'); }],
      ['🔰 魔法防禦', function (st) { return statFmt(st.mdef, null); }, function (st) { return defenseStatDesc(st, '根據防禦公式降低受到的魔法傷害。由智力與耐力派生；定值加成依轉生次數指數強化，百分比加成取自魔法防禦%。', '魔法防禦', 'mdef', 'mdefPct'); }],
      ['🛡️ 全局減傷', function (st) { return statFmt(st.globalDmgRed, null); }, function (st) {
        var reduction = globalDamageReduction(st.globalDmgRed) * 100;
        var capNote = GLOBAL_DMG_RED_CAP > 0 ? '（減傷上限 ' + GLOBAL_DMG_RED_CAP + '%）' : '';
        return '在最終傷害階段降低受到的所有傷害' + capNote + '。<br><br><span style="color:#ffd700">目前實際減傷：' + pctStrFloor4GlobalDmgRed(reduction) + '</span>';
      }],
      ['👤 普通敵人傷害抗性', function (st) { return statFmt(st.normalDmgRed, null); }, function (st) { return enemyTypeDmgRedDesc(st, 'normalDmgRed', '普通敵人（非菁英、非BOSS）'); }],
      ['👑 菁英傷害抗性', function (st) { return statFmt(st.eliteDmgRed, null); }, function (st) { return enemyTypeDmgRedDesc(st, 'eliteDmgRed', '菁英敵人'); }],
      ['😈 BOSS傷害抗性', function (st) { return statFmt(st.bossDmgRed, null); }, function (st) { return enemyTypeDmgRedDesc(st, 'bossDmgRed', 'BOSS'); }],
      ['🧱 格擋率', function (st) { return statFmt(st.blockRate, STAT_CAPS.blockRate, '%'); }, '受到攻擊時，有機率觸發格擋來減輕部分傷害。' + capText(STAT_CAPS.blockRate, '%')],
      ['🧲 格擋減傷', function (st) { return statFmt(blockDmgReduction(st.blockDmgRed), blockDmgRedTotalCap(), '%'); }, function () { return '成功格擋時能減免的傷害比例（' + BLOCK_DMG_RED_BASE + '% 基礎 + 詞條）。' + capText(blockDmgRedTotalCap(), '%'); }],
      ['💨 閃避率', function (st) { return statFmt(st.evasion, STAT_CAPS.evasion, '%'); }, '完全避開敵人攻擊的機率（受敵方命中率影響）。' + capText(STAT_CAPS.evasion, '%')],
      ['🦾 韌性', function (st) { return statFmt(st.tenacity, STAT_CAPS.tenacity, '%'); }, '降低自身被施加暈眩、減速等控制狀態的機率。' + capText(STAT_CAPS.tenacity, '%')],
      ['🫧 護盾效率', function (st) { return statFmt(st.shieldEff, null, '%', true); }, '提升護盾的最大吸收上限與獲取量。'],
      ['🗿 物理抗性', function (st) { return statFmt(st.pRes, null, '%'); }, function (st) { return '降低受到的物理傷害，抗性值越高減傷效果越強。' + resistanceReductionDesc(st, st.pRes, physicalResistanceReduction); }],
      ['🌌 魔法抗性', function (st) { return statFmt(st.mRes, null, '%'); }, function (st) { return '降低受到的魔法傷害，抗性值越高減傷效果越強。' + resistanceReductionDesc(st, st.mRes, magicResistanceReduction); }],
      ['🔥 火焰抗性', function (st) { return statFmt(st.resist.fire, null, '%'); }, function (st) { return elementResistDesc(st, 'fire', '火焰'); }],
      ['❄️ 冰霜抗性', function (st) { return statFmt(st.resist.ice, null, '%'); }, function (st) { return elementResistDesc(st, 'ice', '冰霜'); }],
      ['⚡ 雷電抗性', function (st) { return statFmt(st.resist.lightning, null, '%'); }, function (st) { return elementResistDesc(st, 'lightning', '雷電'); }],
      ['☠️ 劇毒抗性', function (st) { return statFmt(st.resist.poison, null, '%'); }, function (st) { return elementResistDesc(st, 'poison', '劇毒'); }],
      ['✨ 聖光抗性', function (st) { return statFmt(st.resist.light, null, '%'); }, function (st) { return elementResistDesc(st, 'light', '聖光'); }],
      ['🌑 暗影抗性', function (st) { return statFmt(st.resist.dark, null, '%'); }, function (st) { return elementResistDesc(st, 'dark', '暗影'); }],
      ['🛡️ 控制抵抗', function (st) { return statFmt(st.resist.ctrl, STAT_CAPS.ctrlRes, '%'); }, '全面降低所有負面異常狀態的命中率。' + capText(STAT_CAPS.ctrlRes, '%')]
    ]
  },
  {
    title: '特殊與機制', rows: [
      ['⛓️ 控制時間縮減', function (st) { return statFmt(st.ccRed, STAT_CAPS.ccRed, '%'); }, '減少被施加暈眩、減速等控制狀態的持續時間。' + capText(STAT_CAPS.ccRed, '%')],
      ['👟 移動速度', function (st) { return statFmt(st.moveSpeed, STAT_CAPS.moveSpeed, '%', true); }, '提高探索地圖、遇敵或到達終點的速度。' + capText(STAT_CAPS.moveSpeed, '%', true)],
      ['💰 掉寶率', function (st) { return statFmt(st.loot, null, '%', true); }, '提高擊殺怪物後掉落裝備與道具的機率。'],
      ['📚 經驗加成', function (st) { return statFmt(st.xpBonus, null, '%', true); }, '額外增加戰鬥勝利後獲得的經驗值。'],
      ['🪙 金幣加成', function (st) { return statFmt(st.goldBonus, null, '%', true); }, '額外增加戰鬥勝利後獲得的金幣。'],
      ['🍀 幸運值', function (st) { return statFmt(st.luck, STAT_CAPS.luck, 'raw1'); }, '提升太古詞條的出現機率。' + capText(STAT_CAPS.luck, '')],
      ['🎒 負重上限', function (st) { return statFmt(st.weight, null, null, true); }, '提升生產線輸送帶與合成暫存區的容量上限。'],
      ['🔨 強化成功率', function (st) { return statFmt(st.enhanceSuccess, null, '%', true); }, '提升裝備強化的成功機率。'],
      ['⚗️ 分解高產率', function (st) { return statFmt(st.decomposeYield, null, '%', true); }, '增加分解裝備時獲得洗煉精粹的數量或機率。'],
      ['🧬 合成變異率', function (st) { return statFmt(st.hybridMutation, STAT_CAPS.hybridMutation, '%'); }, '提升裝備合成時發生特殊異變（如詞條升級）的機率。' + capText(STAT_CAPS.hybridMutation, '%')],
      ['🚨 狂暴閾值', function (st) { return statFmt(st.enrageThreshold, STAT_CAPS.enrageThreshold, '%', true); }, '影響怪物進入狂暴狀態的時間點或血量條件。' + capText(STAT_CAPS.enrageThreshold, '%', true)],
      ['📜 詞條上限率', function (st) { return statFmt(st.affixCap, STAT_CAPS.affixCap, '%'); }, '影響裝備洗煉時更高數值的出現機率。'],
      ['💎 寶石鑲嵌效率', function (st) { return statFmt(st.gemEff, null, '%', true); }, '全面放大所有已鑲嵌寶石的能力值。']
    ]
  }
];
