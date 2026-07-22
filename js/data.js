'use strict';
/* ============ 遊戲資料定義 ============ */

/* ---- 稀有度（9 階）----
   affix: 詞條數量範圍｜sockets: 寶石鑲孔數｜enchants: 附魔欄位數
   godforged（神鑄創世）：僅能由神鑄系統以 6 件創世鑄造獲得，不自然掉落、
   不可由熔爐合成升階；mult = 創世 × 1.5（詞條數值與洗煉上限同步 1.5 倍）。 */
var RARITIES = [
  { key: 'common', name: '普通', color: '#9aa5b1', mult: 1.0, affix: [1, 2], sockets: 1, enchants: 1, salv: 1.0 },
  { key: 'uncommon', name: '精良', color: '#4ade80', mult: 1.35, affix: [1, 2], sockets: 1, enchants: 1, salv: 1.7 },
  { key: 'rare', name: '稀有', color: '#38bdf8', mult: 1.75, affix: [2, 3], sockets: 2, enchants: 1, salv: 2.8 },
  { key: 'unique', name: '獨特', color: '#ffd700', mult: 2.3, affix: [3, 4], sockets: 2, enchants: 2, salv: 4.5 },
  { key: 'epic', name: '史詩', color: '#c084fc', mult: 3.0, affix: [4, 5], sockets: 3, enchants: 2, salv: 7.5 },
  { key: 'legendary', name: '傳說', color: '#fb923c', mult: 4.0, affix: [4, 5], sockets: 4, enchants: 2, salv: 12 },
  { key: 'mythic', name: '神話', color: '#f87171', mult: 5.2, affix: [6, 6], sockets: 5, enchants: 3, salv: 19 },
  { key: 'genesis', name: '創世', color: '#b8860b', mult: 6.8, affix: [7, 7], sockets: 6, enchants: 3, salv: 30 },
  { key: 'godforged', name: '神鑄創世', color: '#f5c542', mult: 10.2, affix: [7, 7], sockets: 6, enchants: 3, salv: 45 }
];
var PASSIVE_MIN_RARITY = 5; // 傳說級（含）以上附帶特殊被動
var MAX_AFFIXES = 8; // 詞條上限屬性可突破至此（創世 7 + 突破 1）
var REROLL_ESSENCE_COST = { 6: 9, 7: 14, 8: 20 }; // 神話／創世／神鑄創世洗煉精華費用

/* ---- 太古詞條與太古精華 ---- */
var ANCIENT_EQUIP_MIN_LEVEL = 200;
var ANCIENT_EQUIP_MIN_RARITY = 4; // 史詩級（索引 4）以上
var ANCIENT_ENEMY_MIN_LEVEL = 250;
var ANCIENT_AFFIX_BASE_RATE = 1;
var ANCIENT_AFFIX_ENEMY_RATE = 0.1;
var ANCIENT_AFFIX_RATE_CAP = 3;
var ANCIENT_BOSS_AFFIX_BASE_RATE = 5;
var ANCIENT_BOSS_AFFIX_LEVEL_RATE = 0.5;
var ANCIENT_REROLL_CHANCE = 30;
// 太古精華洗煉消耗數量（依裝備稀有度 0~8：普通/精良/稀有/獨特/史詩/傳說/神話/創世/神鑄創世）
var REROLL_ANCIENT_ESSENCE_COST = [1, 1, 1, 1, 1, 1, 2, 3, 4];
var ANCIENT_ESSENCE_ENEMY_MIN_LEVEL = 49;
var ANCIENT_ESSENCE_ENEMY_BASE_RATE = 1;
var ANCIENT_ESSENCE_ENEMY_LEVEL_RATE = 0.1;
var ANCIENT_ESSENCE_ENEMY_RATE_CAP = 10;
var ANCIENT_ESSENCE_BOSS_BASE_RATE = 10;
var ANCIENT_ESSENCE_BOSS_LEVEL_RATE = 2;
var ANCIENT_ESSENCE_BOSS_RATE_CAP = 100;
var ANCIENT_ESSENCE_SALVAGE_CHANCE = { 4: 0.5, 5: 1, 6: 10, 7: 100, 8: 100 };
var ANCIENT_AFFIX_VALUE_MULT = 1.35;
var DEMON_SEED_BOSS_BASE_RATE = 10;
var DEMON_SEED_BOSS_PER_FLOOR = 2;
var DEMON_SEED_BOSS_RATE_CAP = 100;

/* ---- 轉生系統 ----
   生命與四維在原始總值完成後套用最終倍率：
   1～10 轉分別為 ×10、×20、×40、×80、×160、×320、×640、×1280、×2560、×5120。 */
var MAX_LEVEL = 9999;             // 角色等級上限（升級所需經驗 參數 d）
var SKILL_POINT_BUDGET_CAP = 10000; // 技能點總預算上限（技能點總預算 參數 c）
var REINCARNATION_LEVEL = 9999;   // 可轉生等級：達此級可轉生（可轉生等級 參數 a）
var REINCARNATION_MAX = 10;
var REINCARNATION_RANKS = ['冒險者', '勇者', '大劍師', '破世者', '不朽者', '王者', '大主宰', '神聖尊者', '大聖王', '至高主宰', '位面創世神'];
var REINCARNATION_EXTRA_MULTIPLIERS = [0, 10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120];
// 升級經驗基礎增加值：升級所需經驗在括號外再加此值（依轉生次數；轉生 0 次為 0，1~10 次見轉生對照表 參數 c）。
var REINCARNATION_EXP_BASE_ADD = [0, 100000, 300000, 900000, 2700000, 8100000, 24300000, 72900000, 218700000, 656100000, 1968300000];
// 各轉經驗倍數（索引 1~10＝該轉升級經驗需求相對「上一轉」的倍數；參數表「1-成長經驗/轉生經驗倍率」a~j）
// 累積倍率 = 各轉倍數連乘（例：3 轉 = 10×10×10 = 1000）。
var REINCARNATION_EXP_STEP_MULTS = [1, 10, 10, 10, 10, 10, 10, 10, 10, 10, 100];

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
/* ---- 潛力技能（V3；主動＝學會即自動施放、被動＝學會即常駐；經 3/4/7/10 轉「潛力」天賦節點解鎖）----
   欄位：type active/passive/passiveTrigger；cd 冷卻秒；base 起始值；per 每級增量（無數值上限，等級上限比照一般技能＝20＋轉生×10）；
   dmgType 傷害類型；dur 主動增益持續秒；mech 對應戰鬥機制（js/potential.js / formula.js / skills.js 依此分派）。
   數值來源＝天賦V3.xlsx 第 2 頁；戰鬥公式與詮釋見 game_formula.md §潛力技能。 */
var POTENTIAL_TALENTS = [
  { id: 'velocityForce', name: '極速之力', en: 'Velocity Force', emoji: '⚡', cat: 'potential',
    type: 'passive', base: 0, per: 5, mech: 'aspd',
    desc: '突破速度的極限——你的攻速自此掙脫 5 次/秒的枷鎖，直抵無限，能登臨何等境界，端看你的領悟。每級 +5% 攻速加成。',
    flavor: '突破速度極限，攻速掙脫 5 次/秒的枷鎖，能達到什麼程度端看你的領悟。' },
  { id: 'lightningOverdrive', name: '雷霆過載', en: 'Lightning Overdrive', emoji: '🌩️', cat: 'potential',
    type: 'active', cd: 45, base: 0, per: 0.4, dmgType: 'magic', dur: 8, mech: 'chainLightning',
    desc: '雷霆過載，化為狂亂的連鎖閃電——雷電技能 100% 引動雷鏈，於敵群間肆意躍動（最多 3＋連擊數 次彈跳、每次撕裂 10% 該擊傷害），愈戰愈烈、生生不息，持續 8 秒。每級 +0.4% 雷電傷害。',
    flavor: '過載的雷能在敵群間肆意跳躍，愈是激烈愈難止息。' },
  { id: 'chronoCollapse', name: '時間坍縮', en: 'Chronostasis', emoji: '🕳️', cat: 'potential',
    type: 'active', cd: 75, base: 0, per: 0.2, dur: 3, mech: 'cdrUncap',
    desc: '打破時空的禁錮——冷卻縮減自此突破 60% 的天塹，所有技能的冷卻如坍縮的星辰般急速消融，持續 3 秒。每級額外 −0.2% 冷卻。（不縮減自身冷卻，但仍受一般冷卻縮減加成）',
    flavor: '此技能對自身冷卻不生效，但冷卻縮減仍可作用於它。' },
  { id: 'absoluteSanctuary', name: '絕對領域', en: 'Absolute Sanctuary', emoji: '🛡️', cat: 'potential',
    type: 'active', cd: 75, base: 0.5, per: 0.025, mech: 'invuln',
    desc: '降臨絕對的領域，展開無敵結界——其間免疫一切傷害與負面效果，任何攻擊都無法觸及你分毫。基礎 0.5 秒，每級 +0.025 秒。',
    flavor: '在絕對的領域中，任何傷害都無法觸及你分毫。' },
  { id: 'lastStandUndying', name: '不屈意志', en: 'Last Undying Stand', emoji: '💀', cat: 'potential',
    type: 'passiveTrigger', cd: 90, base: 0, per: 0.4, mech: 'undyingGuard',
    desc: '意志不屈者，縱使命懸一線亦絕不倒下——受到致命傷害時免除死亡，並獲得 1 秒無敵。觸發後進入冷卻，每級 −0.4 秒。（不受冷卻縮減影響）',
    flavor: '意志不屈者，縱使命懸一線也絕不倒下。（此技能不受冷卻縮減影響）' },
  { id: 'timeBarrier', name: '時間結界', en: 'Time Barrier', emoji: '⏱️', cat: 'potential',
    type: 'active', cd: 45, base: 0, per: 1, dur: 8, mech: 'enemySlow',
    desc: '編織拖曳時光的結界，敵人的動作被無情延緩，攻速大幅降低，持續 8 秒。每級敵人攻速 −1%。（敵降低後攻速 = 原攻速 /(1+降低%)）',
    flavor: '結界之內，敵人的時間被無情拖曳。' },
  { id: 'dualCoreFusion', name: '混沌雙修', en: 'Dual-Core Fusion', emoji: '☯️', cat: 'potential',
    type: 'passive', base: 0, per: 0.6, mech: 'crossCore',
    desc: '雙核交融，物理與魔法的界限就此崩解——所有物理技能汲取魔攻之力、所有魔法技能承載物攻之威。每級 +0.6%。',
    flavor: '雙核交融，物理與魔法在你手中不再涇渭分明。' },
  { id: 'omegaImpact', name: '必殺一擊', en: 'Omega Impact', emoji: '🎯', cat: 'potential',
    type: 'active', cd: 60, base: 100, per: 3, dmgType: 'phys', mech: 'omega',
    desc: '凝聚全身之力於一擊，依你的爆擊率轟出毀天滅地的必殺——造成「爆擊率% × 必殺傷害加成%」的物理傷害；爆擊率愈高，此擊愈是無可匹敵。必殺傷害加成 = 100% + 每級 +3%。',
    flavor: '爆擊率愈高，這一擊便愈是毀天滅地。' },
  { id: 'sacredInversion', name: '聖療逆轉', en: 'Sacred Inversion', emoji: '✨', cat: 'potential',
    type: 'active', cd: 45, base: 0, per: 0.5, dur: 6, mech: 'sacredInvert',
    desc: '聖療之光賜福於身，生命與法力回復大幅提升；滿溢的療癒之力逆轉為裁決，化作同等傷害傾瀉於敵，持續 6 秒。每級 +0.5%。',
    flavor: '滿溢的聖光既能療癒自身，亦能化為裁決敵人的利刃。' },
  { id: 'chronosStasis', name: '時空凝滯', en: 'Chronos Stasis', emoji: '🌀', cat: 'potential',
    type: 'active', cd: 120, base: 0, per: 0.5, dur: 8, mech: 'timeStop',
    desc: '封鎖周遭的時空，令萬物靜止——唯有承神之賜福者能自由行動；凝滯之間你的所有傷害大幅提升，敵人動彈不得，持續 8 秒。每級 +0.5% 所有傷害。',
    flavor: '唯有獲得神之賜福者，方能在凝滯的時空中行動自如。' }
];

/* ---- 普通關卡敵人數量 ----
   僅普通敵人使用；菁英與高塔 BOSS 固定單一敵人。權重總和 = 100%。 */
var FIELD_ENEMY_COUNT_TABLE = [[1, 60], [2, 25], [3, 10], [4, 5]];

/* ---- 野外怪物命中／閃避分段成長 ----
   rate 是該等級區間「每級增加值」；未填 max 代表從 min 起套用至無限。 */
var FIELD_MONSTER_HIT_BASE = 100;
var FIELD_MONSTER_HIT_GROWTH = [
  { min: 1, max: 49, rate: 0.5 },
  { min: 50, max: 99, rate: 0.75 },
  { min: 100, max: 149, rate: 1 },
  { min: 150, max: 199, rate: 2 },
  { min: 200, max: 299, rate: 2.5 },
  { min: 300, rate: 3 }
];
var FIELD_MONSTER_DODGE_BASE = 5;
var FIELD_MONSTER_DODGE_GROWTH = [
  { min: 1, max: 49, rate: 0.5 },
  { min: 50, max: 99, rate: 0.75 },
  { min: 100, max: 149, rate: 1 },
  { min: 150, max: 199, rate: 1.5 },
  { min: 200, rate: 2 }
];

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
var SLOT_INFO = {
  weapon: { name: '主武器', emoji: '⚔️', icon: 'icon_weapon.png' },
  weapon2: { name: '副武器', emoji: '🗡️', icon: 'icon_weapon.png' },
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
var RARITY_PREFIX = ['普通的', '精良的', '稀有的', '獨特的', '史詩的', '傳說的', '神話的', '創世的', '神鑄創世的'];
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
var FORGE_UNLOCK_LEVEL = 2000;               // 神鑄系統解鎖等級（條件一：等級 ≥ 此值）；解鎖後永久保留
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
  // === 基礎 ===
  atkFlat: { name: '物理攻擊', base: 4, lv: 0.55, pct: false, weight: 11 },
  atkPct: { name: '物理攻擊%', base: 4, lv: 0.02, pct: true, weight: 7 },
  matkFlat: { name: '魔法攻擊', base: 4, lv: 0.55, pct: false, weight: 11 },
  matkPct: { name: '魔法攻擊%', base: 4, lv: 0.02, pct: true, weight: 7 },
  hpFlat: { name: '生命值', base: 22, lv: 3.0, pct: false, weight: 11 },
  hpPct: { name: '生命值%', base: 5, lv: 0.02, pct: true, weight: 7 },
  hpRegen: { name: '生命恢復/秒', base: 2, lv: 0.5, pct: false, weight: 5 },
  mpFlat: { name: '法力值', base: 10, lv: 1.2, pct: false, weight: 5 },
  mpRegen: { name: '法力恢復/秒', base: 0.8, lv: 0.06, pct: false, weight: 4 },
  str: { name: '力量', base: 3, lv: 0.4, pct: false, weight: 8 },
  agi: { name: '敏捷', base: 3, lv: 0.4, pct: false, weight: 8 },
  int: { name: '智力', base: 3, lv: 0.4, pct: false, weight: 8 },
  vit: { name: '耐力', base: 3, lv: 0.4, pct: false, weight: 8 },
  // === 進攻 ===
  defFlat: { name: '物理防禦', base: 3, lv: 0.35, pct: false, weight: 9 },
  defPct: { name: '物理防禦%', base: 4, lv: 0.02, pct: true, weight: 6 },
  mdefFlat: { name: '魔法防禦', base: 3, lv: 0.35, pct: false, weight: 9 },
  globalDmgRed: { name: '全局減傷', base: 3, lv: 0.35, pct: false, weight: 9, minR: 4 },
  // 敵種傷害抗性（定值減免）：放出量約為物理防禦（defFlat）的 2 倍；減傷公式 enemyTypeDamageReduction → formula.js §3
  normalDmgRed: { name: '普通敵人傷害抗性', base: 6, lv: 0.35, pct: false, weight: 9, minR: 4 },
  eliteDmgRed: { name: '菁英傷害抗性', base: 6, lv: 0.35, pct: false, weight: 9, minR: 4 },
  bossDmgRed: { name: 'BOSS傷害抗性', base: 6, lv: 0.35, pct: false, weight: 9, minR: 4 },
  aspd: { name: '攻擊速度%', base: 3, lv: 0.012, pct: true, weight: 6 },
  critRate: { name: '暴擊率%', base: 2.5, lv: 0.012, pct: true, weight: 6 },
  critDmg: { name: '暴擊傷害%', base: 8, lv: 0.05, pct: true, weight: 5 },
  pPen: { name: '物理穿透%', base: 3, lv: 0.015, pct: true, weight: 4, minR: 4 },
  mPen: { name: '魔法穿透%', base: 3, lv: 0.015, pct: true, weight: 4, minR: 4 },
  hit: { name: '命中率%', base: 3, lv: 0.015, pct: true, weight: 5 },
  cdr: { name: '冷卻縮減%', base: 2.5, lv: 0.01, pct: true, weight: 4, minR: 4 },
  castSpeed: { name: '施法速度%', base: 3, lv: 0.012, pct: true, weight: 4, minR: 4 },
  lifesteal: { name: '吸血%', base: 1.5, lv: 0.008, pct: true, weight: 4 },
  manaSteal: { name: '吸魔%', base: 1.2, lv: 0.006, pct: true, weight: 3, minR: 4 },
  eliteDmg: { name: '對菁英傷害%', base: 4, lv: 0.02, pct: true, weight: 4, minR: 3 },
  bossDmg: { name: '對BOSS傷害%', base: 4, lv: 0.02, pct: true, weight: 4, minR: 3 },
  normalDmg: { name: '對普通敵人傷害%', base: 3, lv: 0.035, pct: true, weight: 9, minR: 3 }, // 基礎值恢復 10 倍；成長係數維持原值
  // === 對屬性敵人傷害（六大屬性；數值約為暴擊傷害%詞條的 1/10）===
  dmgVsFire: { name: '對火屬性傷害%', base: 0.8, lv: 0.005, pct: true, weight: 3, minR: 3 },
  dmgVsIce: { name: '對冰屬性傷害%', base: 0.8, lv: 0.005, pct: true, weight: 3, minR: 3 },
  dmgVsLightning: { name: '對雷屬性傷害%', base: 0.8, lv: 0.005, pct: true, weight: 3, minR: 3 },
  dmgVsPoison: { name: '對毒屬性傷害%', base: 0.8, lv: 0.005, pct: true, weight: 3, minR: 3 },
  dmgVsLight: { name: '對光屬性傷害%', base: 0.8, lv: 0.005, pct: true, weight: 3, minR: 3 },
  dmgVsDark: { name: '對暗屬性傷害%', base: 0.8, lv: 0.005, pct: true, weight: 3, minR: 3 },
  aoeDmg: { name: '範圍傷害%', base: 4, lv: 0.02, pct: true, weight: 4, minR: 4 },
  // === 防禦 ===
  blockRate: { name: '格擋率%', base: 2.5, lv: 0.012, pct: true, weight: 4 },
  blockDmgRed: { name: '格擋減傷%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 4 },
  evasion: { name: '閃避率%', base: 2, lv: 0.01, pct: true, weight: 4 },
  tenacity: { name: '韌性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 4 },
  shieldEff: { name: '護盾效率%', base: 5, lv: 0.025, pct: true, weight: 3, minR: 3 },
  pRes: { name: '物理抗性%', base: 2, lv: 0.008, pct: true, weight: 3, minR: 3 },
  mRes: { name: '魔法抗性%', base: 2, lv: 0.008, pct: true, weight: 3, minR: 3 },
  // === 元素抗性 ===
  resFire: { name: '火焰抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 3 },
  resIce: { name: '冰霜抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 3 },
  resLightning: { name: '雷電抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 3 },
  resPoison: { name: '劇毒抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 3 },
  resLight: { name: '聖光抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 3 },
  resDark: { name: '暗影抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 3 },
  // 全屬性抗性（史詩詞條）：同時加到六大元素抗性，數值約為單一屬性抗性詞條的 1/4（base/lv = resFire 的 1/4）
  resAll: { name: '全屬性抗性%', base: 1, lv: 0.005, pct: true, weight: 3, minR: 4 },
  // === 特殊與機制（多為飾品專屬） ===
  ccRed: { name: '控制時間縮減%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 4 },
  moveSpeed: { name: '移動速度%', base: 3, lv: 0.012, pct: true, weight: 4 },
  loot: { name: '掉寶率%', base: 3, lv: 0.015, pct: true, weight: 4, minR: 4 },
  xpBonus: { name: '經驗加成%', base: 4, lv: 0.02, pct: true, weight: 4, minR: 4, slots: ACCESSORY_SLOTS },
  goldBonus: { name: '金幣加成%', base: 5, lv: 0.025, pct: true, weight: 4, minR: 4, slots: ACCESSORY_SLOTS },
  luck: { name: '幸運值', base: 2, lv: 0.1, pct: false, weight: 3, minR: 4, slots: ACCESSORY_SLOTS },
  weight: { name: '負重上限', base: 2, lv: 0.3, pct: false, weight: 3, minR: 4, slots: ACCESSORY_SLOTS },
  enhanceSuccess: { name: '強化成功率%', base: 3, lv: 0.015, pct: true, weight: 3, minR: 4 },
  decomposeYield: { name: '分解高產率%', base: 3, lv: 0.015, pct: true, weight: 3, minR: 4 },
  hybridMutation: { name: '合成變異率%', base: 2.5, lv: 0.012, pct: true, weight: 2, minR: 4 },
  enrageThreshold: { name: '狂暴閾值+', base: 2, lv: 0.08, pct: false, weight: 2, minR: 4 },
  affixCap: { name: '詞條上限率%', base: 3, lv: 0.015, pct: true, weight: 2, minR: 4, slots: ACCESSORY_SLOTS },
  gemEff: { name: '寶石鑲嵌效率%', base: 5, lv: 0.025, pct: true, weight: 2, minR: 4, slots: ACCESSORY_SLOTS }
};

// ---- 詞條顯示分類（裝備詳情/滑過提示分色用；未列入者一律視為 util 功能類） ----
var AFFIX_CATS = {
  base: ['hpFlat', 'hpPct', 'hpRegen', 'mpFlat', 'mpRegen', 'str', 'agi', 'int', 'vit'],
  off: ['atkFlat', 'atkPct', 'matkFlat', 'matkPct', 'aspd', 'critRate', 'critDmg', 'pPen', 'mPen',
    'hit', 'cdr', 'castSpeed', 'lifesteal', 'manaSteal', 'eliteDmg', 'bossDmg', 'normalDmg', 'aoeDmg'],
  def: ['defFlat', 'defPct', 'mdefFlat', 'globalDmgRed', 'normalDmgRed', 'eliteDmgRed', 'bossDmgRed', 'blockRate', 'blockDmgRed', 'evasion',
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

// ---- 特殊被動（稀有級以上） ----
var PASSIVE_POOL = {
  sunder: { name: '破甲', desc: '攻擊時忽略目標 {v}% 防禦', base: 10, perR: 2 },
  thorns: { name: '反震', desc: '受擊時對敵人造成自身 {v}% 最大生命的傷害', base: 5, perR: 1 },
  doubleHit: { name: '連擊', desc: '攻擊時有 {v}% 機率再次攻擊', base: 10, perR: 2 },
  stun: { name: '暈眩', desc: '攻擊時有 {v}% 機率暈眩敵人 1 秒', base: 6, perR: 1.5 },
  slowHit: { name: '減速', desc: '攻擊時有 {v}% 機率使敵人攻速降低 30%，持續 3 秒', base: 12, perR: 3 },
  trueDmg: { name: '真傷', desc: '每次攻擊附加 {v}% 攻擊力的真實傷害', base: 6, perR: 1.5 },
  soulEater: { name: '吸魂', desc: '擊殺敵人時回復 {v}% 最大生命', base: 5, perR: 1.5 }
};

// ---- 元素 ----
var ELEMENTS = ['fire', 'ice', 'lightning', 'poison', 'light', 'dark'];
var ELEM_INFO = {
  fire: { name: '火焰', emoji: '🔥' },
  ice: { name: '冰霜', emoji: '❄️' },
  lightning: { name: '雷電', emoji: '⚡' },
  poison: { name: '劇毒', emoji: '☠️' },
  light: { name: '聖光', emoji: '✨' },
  dark: { name: '暗影', emoji: '🌑' }
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
  lightRes: { name: '聖光抗性', cat: 'def', desc: '聖光屬性抗性額外提高：其他來源合計 ×(1+此值%)', emoji: '🕶️' },
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
  castTime: 0.8,     // 施法時間（受施法速度影響，會延後下次普攻）
  matkScale: 1.5,    // 魔攻倍率
  atkScale: 0.3      // 物攻倍率
};

// ---- 怪物（magic: 以魔法攻擊，對玩家魔防；attr: 屬性標籤（六大屬性），供「對X屬性傷害」加成與 tips 顯示 ----
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
var ZONE_LIST = ['plains', 'desert', 'swamp'];
var ZONES = {
  plains: {
    name: '草原', emoji: '🌿', pool: MONSTER_POOL,
    hpMult: 1, atkMult: 1, defMult: 1, aspdMult: 1, rewardMult: 1
  },
  desert: {
    name: '荒漠', emoji: '🏜️', pool: DESERT_POOL,
    hpMult: 2.2, atkMult: 1.8, defMult: 1.6, aspdMult: 1.5, rewardMult: 1.25, reqZone: 'plains', reqStage: 100
  },
  swamp: {
    name: '沼澤', emoji: '🦠', pool: SWAMP_POOL,
    hpMult: 4, atkMult: 2.8, defMult: 2.4, aspdMult: 2, rewardMult: 1.5, reqZone: 'desert', reqStage: 100
  }
};
function currentZoneDef() {
  return ZONES[(G.stage && G.stage.zone) || 'plains'] || ZONES.plains;
}

var RESPAWN_DELAY = 0.8;       // 出怪間隔（秒）
var FIELD_ENEMY_DEATH_CLEAR_DELAY = 1.5; // 野外敵人死亡後保留戰鬥資訊時間（秒）
var REVIVE_DELAY = 3.0;        // 死亡復活時間（秒）
var FIELD_DEATH_STAGE_RETREAT = 10; // 野外死亡退回階段數

// ---- BOSS 高塔（元素 BOSS 以魔法攻擊） ----
var BOSS_LIST = [
  // attr = 屬性標籤（每個敵人必有；供「對X屬性傷害」加成與 tips 顯示）；elem = 元素攻擊機制（可為 null，不因 attr 而改變）
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
var TOWER_BOSS_REF_STAGE_BASE = 4;
var TOWER_BOSS_REF_STAGE_PER_FLOOR = 5;
var TOWER_BOSS_LEVEL_BONUS = 3;
var TOWER_BOSS_HIT_BASE = 200;
var TOWER_BOSS_HIT_PER_FLOOR = 70;
var TOWER_BASE_HP_MULT = 20;
var TOWER_BASE_ATK_MULT = 3;
var TOWER_BOSS_DEF_MULT = 10;
var TOWER_BOSS_ASPD = 3;
var TOWER_BOSS_CTRL_RES = 70;
var TOWER_BOSS_DODGE_BASE = 20;
var TOWER_BOSS_DODGE_CAP = 10000000;
var TOWER_BOSS_DODGE_PER_FLOOR = 40;
var TOWER_BOSS_ELEM_ATK_BASE = 3;
var TOWER_BOSS_ELEM_HELL_MULT = 1;
var TOWER_BOSS_XP_MULT = 2;
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
var TOWER_HELL_ATK_MULT = 5;
var TOWER_HELL_HP_MULT = 20;
// 煉獄之塔相對於地獄之塔的 BOSS 攻擊／生命倍率
var TOWER_PURGATORY_ATK_MULT = 5;
var TOWER_PURGATORY_HP_MULT = 10;
var TOWER_HELL_SOUL_ORIGIN_BASE_RATE = 5;
var TOWER_HELL_SOUL_ORIGIN_PER_FLOOR = 1;
var TOWER_TIME_LIMIT = 60;     // 限時 60 秒
function towerTimeLimitWithTalents() {
  // 潛力技能 V3 起，潛力不再提供高塔限時加成（舊 potentialTowerTime 已移除）。
  return TOWER_TIME_LIMIT;
}
var TOWER_ENRAGE_TIME = 40;    // 40 秒檢查狂暴
var TOWER_ENRAGE_HP = 50;      // 血量高於 50% 觸發（玩家「狂暴閾值」屬性可提高此門檻）
var TOWER_ENRAGE_MULT = 3;     // 傷害增加 200% => 3 倍

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
  spinel: { name: '尖晶石', emoji: '🔥', stat: 'dmgVsFire', statName: '對火屬性傷害%', base: 0.2, pct: true, linear: true },
  aquamarine: { name: '海藍寶石', emoji: '❄️', stat: 'dmgVsIce', statName: '對冰屬性傷害%', base: 0.2, pct: true, linear: true },
  amazonite: { name: '天河石', emoji: '⚡', stat: 'dmgVsLightning', statName: '對雷屬性傷害%', base: 0.2, pct: true, linear: true },
  peridot: { name: '橄欖石', emoji: '☠️', stat: 'dmgVsPoison', statName: '對毒屬性傷害%', base: 0.2, pct: true, linear: true },
  citrine: { name: '黃水晶', emoji: '✨', stat: 'dmgVsLight', statName: '對光屬性傷害%', base: 0.2, pct: true, linear: true },
  tourmaline: { name: '黑碧璽', emoji: '🌑', stat: 'dmgVsDark', statName: '對暗屬性傷害%', base: 0.2, pct: true, linear: true },
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
// 寶石合成：2 顆「同種類、同等級」→ 1 顆同種類下一級；UI 另支援全部類型逐種類合成
var GEM_TYPE_ALL = '__all__';
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
      ['🔥 對火屬性傷害', function (st) { return statFmt(st.dmgVsElem.fire, null, '%', true); }, '對「帶火屬性標籤」的敵人造成的傷害提高（打其他屬性的敵人不生效）。'],
      ['❄️ 對冰屬性傷害', function (st) { return statFmt(st.dmgVsElem.ice, null, '%', true); }, '對「帶冰屬性標籤」的敵人造成的傷害提高（打其他屬性的敵人不生效）。'],
      ['⚡ 對雷屬性傷害', function (st) { return statFmt(st.dmgVsElem.lightning, null, '%', true); }, '對「帶雷屬性標籤」的敵人造成的傷害提高（打其他屬性的敵人不生效）。'],
      ['☠️ 對毒屬性傷害', function (st) { return statFmt(st.dmgVsElem.poison, null, '%', true); }, '對「帶毒屬性標籤」的敵人造成的傷害提高（打其他屬性的敵人不生效）。'],
      ['✨ 對光屬性傷害', function (st) { return statFmt(st.dmgVsElem.light, null, '%', true); }, '對「帶光屬性標籤」的敵人造成的傷害提高（打其他屬性的敵人不生效）。'],
      ['🌑 對暗屬性傷害', function (st) { return statFmt(st.dmgVsElem.dark, null, '%', true); }, '對「帶暗屬性標籤」的敵人造成的傷害提高（打其他屬性的敵人不生效）。'],
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
      ['🍀 幸運值', function (st) { return statFmt(st.luck, STAT_CAPS.luck, 'raw1'); }, '提升在洗煉或合成裝備時出現高階詞條的機率。' + capText(STAT_CAPS.luck, '')],
      ['🎒 負重上限', function (st) { return statFmt(st.weight, null, null, true); }, '提升生產線輸送帶與合成暫存區的容量上限。'],
      ['🔨 強化成功率', function (st) { return statFmt(st.enhanceSuccess, null, '%', true); }, '提升裝備強化的成功機率。'],
      ['⚗️ 分解高產率', function (st) { return statFmt(st.decomposeYield, null, '%', true); }, '增加分解裝備時獲得洗煉精粹的數量或機率。'],
      ['🧬 合成變異率', function (st) { return statFmt(st.hybridMutation, STAT_CAPS.hybridMutation, '%'); }, '提升裝備合成時發生特殊異變（如詞條升級）的機率。' + capText(STAT_CAPS.hybridMutation, '%')],
      ['🚨 狂暴閾值', function (st) { return statFmt(st.enrageThreshold, STAT_CAPS.enrageThreshold, '%', true); }, '影響怪物進入狂暴狀態的時間點或血量條件。' + capText(STAT_CAPS.enrageThreshold, '%', true)],
      ['📜 詞條上限率', function (st) { return statFmt(st.affixCap, STAT_CAPS.affixCap, '%'); }, '影響裝備洗煉或生成時獲得更多詞條的機率。' + capText(STAT_CAPS.affixCap, '%')],
      ['💎 寶石鑲嵌效率', function (st) { return statFmt(st.gemEff, null, '%', true); }, '全面放大所有已鑲嵌寶石的能力值。']
    ]
  }
];
