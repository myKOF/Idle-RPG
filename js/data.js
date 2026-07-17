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
var RARE_IDX = 2; // 稀有級（含）以上附帶特殊被動
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
var ANCIENT_ESSENCE_ENEMY_BASE_RATE = 2;
var ANCIENT_ESSENCE_ENEMY_LEVEL_RATE = 0.2;
var ANCIENT_ESSENCE_ENEMY_RATE_CAP = 20;
var ANCIENT_ESSENCE_BOSS_BASE_RATE = 10;
var ANCIENT_ESSENCE_BOSS_LEVEL_RATE = 2;
var ANCIENT_ESSENCE_BOSS_RATE_CAP = 100;
var ANCIENT_ESSENCE_SALVAGE_CHANCE = { 4: 0.5, 5: 1, 6: 10, 7: 100, 8: 100 };
var ANCIENT_AFFIX_VALUE_MULT = 1.35;

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

/* ---- 天賦系統（1 轉後開放；企劃書先實作至 5 轉） ----
   一般天賦每轉 8 個、每個最高 100 級；數值為每級增量，51 級起使用 high。
   「潛力」為獨立技能點，先登錄 10 個節點，依 4/5 轉解鎖天賦逐批開放。 */
var TALENT_MAX_LEVEL = 100;
var TALENT_EFFECT_BREAK_LEVEL = 50;
var TALENT_IMPLEMENTED_REINCARNATIONS = 5;
var POTENTIAL_NODE_COUNT = 10;
var POTENTIAL_SKILL_BASE_MAX_LEVEL = 20;
var TALENT_TREES = {
  1: [
    { id: 't1_str', name: '力量淬鍊', emoji: '💪', stat: 'strPct', low: 1, high: 2, desc: '力量額外提高' },
    { id: 't1_agi', name: '迅捷淬鍊', emoji: '🪽', stat: 'agiPct', low: 1, high: 2, desc: '敏捷額外提高' },
    { id: 't1_int', name: '奧術淬鍊', emoji: '🔮', stat: 'intPct', low: 1, high: 2, desc: '智力額外提高' },
    { id: 't1_vit', name: '鋼骨淬鍊', emoji: '🦴', stat: 'vitPct', low: 1, high: 2, desc: '耐力額外提高' },
    { id: 't1_def', name: '物防鍛體', emoji: '🛡️', stat: 'defPct', low: 1, high: 2, desc: '物理防禦額外提高' },
    { id: 't1_mdef', name: '魔防鍛體', emoji: '🔰', stat: 'mdefPct', low: 1, high: 2, desc: '魔法防禦額外提高' },
    { id: 't1_pres', name: '物理抗性', emoji: '🪨', stat: 'pRes', low: 1, high: 2, desc: '物理抗性額外提高' },
    { id: 't1_mres', name: '魔法抗性', emoji: '🌌', stat: 'mRes', low: 1, high: 2, desc: '魔法抗性額外提高' }
  ],
  2: [
    { id: 't2_fire', name: '烈焰共鳴', emoji: '🔥', stat: 'elemFire', low: 0.25, high: 0.5, desc: '攻擊時額外附加' },
    { id: 't2_ice', name: '寒霜共鳴', emoji: '❄️', stat: 'elemIce', low: 0.25, high: 0.5, desc: '攻擊時額外附加' },
    { id: 't2_lightning', name: '雷霆共鳴', emoji: '⚡', stat: 'elemLightning', low: 0.25, high: 0.5, desc: '攻擊時額外附加' },
    { id: 't2_poison', name: '毒脈共鳴', emoji: '☠️', stat: 'elemPoison', low: 0.25, high: 0.5, desc: '攻擊時額外附加' },
    { id: 't2_light', name: '聖輝共鳴', emoji: '🌟', stat: 'elemLight', low: 0.25, high: 0.5, desc: '攻擊時額外附加' },
    { id: 't2_dark', name: '暗影共鳴', emoji: '🌑', stat: 'elemDark', low: 0.25, high: 0.5, desc: '攻擊時額外附加' },
    { id: 't2_resist', name: '萬象抗性', emoji: '🌈', stat: 'elemRes', low: 1, high: 2, desc: '全元素抗性額外提高' },
    { id: 't2_global', name: '傷害偏折', emoji: '🌀', stat: 'globalDmgRed', low: 0.5, high: 1, desc: '全局減傷額外提高' }
  ],
  3: [
    { id: 't3_crit', name: '致命直覺', emoji: '🎯', stat: 'critRate', low: 5, high: 10, desc: '暴擊率額外提高' },
    { id: 't3_critdmg', name: '致命裂痕', emoji: '💥', stat: 'critDmg', low: 50, high: 100, desc: '暴擊傷害額外提高' },
    { id: 't3_evasion', name: '幻影步', emoji: '👻', stat: 'evasion', low: 5, high: 10, desc: '閃避率額外提高' },
    { id: 't3_hit', name: '洞察弱點', emoji: '👁️', stat: 'hit', low: 5, high: 10, desc: '命中率額外提高' },
    { id: 't3_hp', name: '生命洪流', emoji: '❤️', stat: 'hpPct', low: 1, high: 2, desc: '生命額外提高' },
    { id: 't3_shield', name: '護盾脈衝', emoji: '🔵', stat: 'shieldEff', low: 1, high: 2, desc: '護盾額外提高' },
    { id: 't3_normalred', name: '獵人本能', emoji: '🐺', stat: 'normalDmgRed', low: 1, high: 2, desc: '普通敵人傷害抗性額外提高' },
    { id: 't3_elitered', name: '鎮壓意志', emoji: '🦁', stat: 'eliteDmgRed', low: 1, high: 2, desc: '菁英敵人傷害抗性額外提高' }
  ],
  4: [
    { id: 't4_normal', name: '清場法則', emoji: '⚔️', stat: 'normalDmg', low: 1, high: 2, desc: '對普通敵人傷害額外提高' },
    { id: 't4_elite', name: '破菁法則', emoji: '🗡️', stat: 'eliteDmg', low: 1, high: 2, desc: '對菁英傷害額外提高' },
    { id: 't4_boss', name: '弒王法則', emoji: '👑', stat: 'bossDmg', low: 1, high: 1, desc: '對 BOSS 傷害額外提高' },
    { id: 't4_potential', name: '潛力啟示', emoji: '🔓', stat: 'potentialUnlock', low: 2, high: 4, desc: '解鎖新類型技能「潛力」三個並給予技能點' },
    { id: 't4_resist', name: '全域適應', emoji: '🧿', stat: 'allRes', low: 1, high: 2, desc: '全屬性抗性額外提高' },
    { id: 't4_def', name: '重甲共鳴', emoji: '🛡️', stat: 'defPct', low: 1, high: 2, desc: '物理防禦額外提高' },
    { id: 't4_mdef', name: '魔鎧共鳴', emoji: '🔰', stat: 'mdefPct', low: 1, high: 2, desc: '魔法防禦額外提高' },
    { id: 't4_global', name: '絕對偏折', emoji: '🕳️', stat: 'globalDmgRed', low: 0.5, high: 1, desc: '全局減傷額外提高' }
  ],
  5: [
    { id: 't5_phys', name: '武技昇華', emoji: '⚔️', stat: 'skillPhys', low: 1, high: 2, desc: '物理類技能效果額外提高' },
    { id: 't5_magic', name: '法術昇華', emoji: '✨', stat: 'skillMagic', low: 1, high: 2, desc: '魔法類技能效果額外提高' },
    { id: 't5_def', name: '守護昇華', emoji: '🛡️', stat: 'skillDef', low: 1, high: 2, desc: '防禦與治療類技能效果額外提高' },
    { id: 't5_special', name: '奇策昇華', emoji: '🎲', stat: 'skillSpecial', low: 1, high: 2, desc: '特殊類技能效果額外提高' },
    { id: 't5_passive', name: '被動昇華', emoji: '🧬', stat: 'skillPassive', low: 1, high: 2, desc: '被動類技能效果額外提高' },
    { id: 't5_potential', name: '潛力覺醒', emoji: '🌠', stat: 'potentialUnlock', low: 2, high: 4, desc: '解鎖新類型技能「潛力」兩個並給予技能點' },
    { id: 't5_hp', name: '不滅血脈', emoji: '🩸', stat: 'hpPct', low: 2, high: 4, desc: '生命額外提高' },
    { id: 't5_shield', name: '永恆護壁', emoji: '🔷', stat: 'shieldEff', low: 2, high: 4, desc: '護盾額外提高' }
  ]
};
var POTENTIAL_TALENTS = [
  { id: 'p1_time', name: '時空折疊', emoji: '⏳', cat: 'potential', stat: 'potentialCdr', per: 1, desc: '每級使所有技能的冷卻時間額外縮短 1%' },
  { id: 'p2_secondLife', name: '第二命題', emoji: '💫', cat: 'potential', stat: 'potentialRevive', per: 1, desc: '每場戰鬥第一次受到致命傷害時復活，並恢復最大生命值的 20%（最高 100%）' },
  { id: 'p3_lootEcho', name: '掉落回聲', emoji: '🎁', cat: 'potential', stat: 'potentialLootDup', per: 5, desc: '每級使掉落物數量額外增加 5%' },
  { id: 'p4_voidBag', name: '虛空背包', emoji: '🎒', cat: 'potential', stat: 'potentialInvCap', per: 100, disabled: true, disabledReason: '目前暫不開放升級', desc: '每級增加 100 格背包容量' },
  { id: 'p5_elementCore', name: '元素核心', emoji: '🔆', cat: 'potential', stat: 'potentialElemAtk', per: 2, disabled: true, disabledReason: '目前暫不開放升級', desc: '每級使所有元素附加傷害額外提高 2%' },
  { id: 'p6_execution', name: '終焉預言', emoji: '☄️', cat: 'potential', stat: 'potentialExecute', per: 2, desc: '目標生命低於 20% 時，每級使造成的傷害額外提高 2%' },
  { id: 'p7_aegis', name: '護盾轉生', emoji: '🪞', cat: 'potential', stat: 'potentialShieldOverflow', per: 5, desc: '每級將溢出護盾的 5% 轉換為生命回復' },
  { id: 'p8_manaLoop', name: '法力迴圈', emoji: '🔄', cat: 'potential', stat: 'potentialManaRefund', per: 2, desc: '技能命中敵人後，每級返還技能消耗法力的 2%' },
  { id: 'p9_towerClock', name: '高塔時鐘', emoji: '🗼', cat: 'potential', stat: 'potentialTowerTime', per: 1, desc: '每級增加高塔挑戰限時 1 秒' },
  { id: 'p10_offlineOracle', name: '離線預言', emoji: '🌙', cat: 'potential', stat: 'potentialOffline', per: 5, desc: '每級使離線收益額外提高 5%' }
];

/* ---- 普通關卡敵人數量 ----
   僅普通敵人使用；菁英與高塔 BOSS 固定單一敵人。權重總和 = 100%。 */
var FIELD_ENEMY_COUNT_TABLE = [[1, 60], [2, 25], [3, 10], [4, 5]];

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
  evasion: 0, tenacity: 60, pRes: 95, mRes: 95, elemRes: 95, ctrlRes: 80,
  ccRed: 60, moveSpeed: 50, luck: 100, hybridMutation: 60, enrageThreshold: 30,
  affixCap: 100, doubleHit: 45, stun: 30
  // 註：全局減傷上限＝GLOBAL_DMG_RED_CAP（由「2-屬性派生/全局減傷」控制）；此處不重複。
};
var PRIMARY_STAT_EFFECTS = {
  strAtk: 2,
  strWeight: 0.5,
  agiCritRate: 0.0001,
  agiAspdPct: 0,
  agiEvasion: 0.0001,
  intMp: 2,
  intMpRegen: 0.002,
  intMatk: 2,
  intMdef: 0.7,
  vitHp: 10,
  vitDef: 0.9
};
// 連擊數係數：連擊數 = a·ln(暴擊率−100) + b·(暴擊率−100) + c（暴擊率 ≤100% 時為 0；由參數表「2-屬性派生／連擊數」控制）
var COMBO_HITS_COEF = { a: 0.875, b: 0.01387, c: 0.0861 };
var ASPD_BASE = 1.0;
var ASPD_MIN = 0.2;
var ASPD_CAP = 5;
var BLOCK_DMG_RED_BASE = 30;
var GODFORGED_IDX = 8;                       // 神鑄創世稀有度索引
var FORGE_UNLOCK_LEVEL = 1;                  // 神鑄系統解鎖等級（條件一：等級 ≥ 此值）；解鎖後永久保留
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
var FORGE_GEM_DURATION = { 5: 2, 6: 3, 7: 4, 8: 5, 9: 6 };       // 寶石神鑄時間（秒）
var DUST_FIELD_MIN_LEVEL = 150;              // 野外魔塵掉落的最低敵人等級
var DUST_FIELD_BASE = 0.1;                   // 野外魔塵基礎掉落率 %（150 級時）
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
  godWall: { name: '神壁', desc: '物理與魔法防禦提高 {v}%', base: 25, stats: ['defPct'] },
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
  normalDmgRed: { name: '普通敵人傷害抗性', base: 6, lv: 0.35, pct: false, weight: 9, minR: 3 },
  eliteDmgRed: { name: '菁英傷害抗性', base: 6, lv: 0.35, pct: false, weight: 9, minR: 3 },
  bossDmgRed: { name: 'BOSS傷害抗性', base: 6, lv: 0.35, pct: false, weight: 9, minR: 3 },
  aspd: { name: '攻擊速度%', base: 3, lv: 0.012, pct: true, weight: 6 },
  critRate: { name: '暴擊率%', base: 2.5, lv: 0.012, pct: true, weight: 6 },
  critDmg: { name: '暴擊傷害%', base: 8, lv: 0.05, pct: true, weight: 5 },
  pPen: { name: '物理穿透%', base: 3, lv: 0.015, pct: true, weight: 4, minR: 1 },
  mPen: { name: '魔法穿透%', base: 3, lv: 0.015, pct: true, weight: 4, minR: 1 },
  hit: { name: '命中率%', base: 3, lv: 0.015, pct: true, weight: 5 },
  cdr: { name: '冷卻縮減%', base: 2.5, lv: 0.01, pct: true, weight: 4, minR: 2 },
  castSpeed: { name: '施法速度%', base: 3, lv: 0.012, pct: true, weight: 4, minR: 2 },
  lifesteal: { name: '吸血%', base: 1.5, lv: 0.008, pct: true, weight: 4 },
  manaSteal: { name: '吸魔%', base: 1.2, lv: 0.006, pct: true, weight: 3, minR: 2 },
  eliteDmg: { name: '對菁英傷害%', base: 4, lv: 0.02, pct: true, weight: 4, minR: 3 },
  bossDmg: { name: '對BOSS傷害%', base: 4, lv: 0.02, pct: true, weight: 4, minR: 3 },
  normalDmg: { name: '對普通敵人傷害%', base: 3, lv: 0.35, pct: true, weight: 9, minR: 3 }, // 放出量同物理防禦（defFlat）；僅對非菁英且非 BOSS 敵人生效
  aoeDmg: { name: '範圍傷害%', base: 4, lv: 0.02, pct: true, weight: 4, minR: 2 },
  // === 防禦 ===
  blockRate: { name: '格擋率%', base: 2.5, lv: 0.012, pct: true, weight: 4 },
  blockDmgRed: { name: '格擋減傷%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 2 },
  evasion: { name: '閃避率%', base: 2, lv: 0.01, pct: true, weight: 4 },
  tenacity: { name: '韌性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 2 },
  shieldEff: { name: '護盾效率%', base: 5, lv: 0.025, pct: true, weight: 3, minR: 3 },
  pRes: { name: '物理抗性%', base: 2, lv: 0.008, pct: true, weight: 3, minR: 3 },
  mRes: { name: '魔法抗性%', base: 2, lv: 0.008, pct: true, weight: 3, minR: 3 },
  // === 元素抗性 ===
  resFire: { name: '火焰抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 1 },
  resIce: { name: '冰霜抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 1 },
  resLightning: { name: '雷電抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 1 },
  resPoison: { name: '劇毒抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 1 },
  resLight: { name: '聖光抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 1 },
  resDark: { name: '暗影抗性%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 1 },
  // === 特殊與機制（多為飾品專屬） ===
  ccRed: { name: '控制時間縮減%', base: 4, lv: 0.02, pct: true, weight: 3, minR: 3 },
  moveSpeed: { name: '移動速度%', base: 3, lv: 0.012, pct: true, weight: 4 },
  loot: { name: '掉寶率%', base: 3, lv: 0.015, pct: true, weight: 4, minR: 3 },
  xpBonus: { name: '經驗加成%', base: 4, lv: 0.02, pct: true, weight: 4, minR: 3, slots: ACCESSORY_SLOTS },
  goldBonus: { name: '金幣加成%', base: 5, lv: 0.025, pct: true, weight: 4, minR: 3, slots: ACCESSORY_SLOTS },
  luck: { name: '幸運值', base: 2, lv: 0.1, pct: false, weight: 3, minR: 3, slots: ACCESSORY_SLOTS },
  weight: { name: '負重上限', base: 2, lv: 0.3, pct: false, weight: 3, slots: ACCESSORY_SLOTS },
  enhanceSuccess: { name: '強化成功率%', base: 3, lv: 0.015, pct: true, weight: 3, minR: 3 },
  decomposeYield: { name: '分解高產率%', base: 3, lv: 0.015, pct: true, weight: 3, minR: 3 },
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
    'resPoison', 'resLight', 'resDark', 'ccRed']
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
  fireRes: { name: '火焰抗性', cat: 'def', desc: '減少受到的火焰傷害', emoji: '🧯' },
  iceRes: { name: '冰霜抗性', cat: 'def', desc: '減少受到的冰霜傷害', emoji: '🧊' },
  lightningRes: { name: '雷電抗性', cat: 'def', desc: '減少受到的雷電傷害', emoji: '🔌' },
  poisonRes: { name: '劇毒抗性', cat: 'def', desc: '減少受到的劇毒傷害', emoji: '💊' },
  lightRes: { name: '聖光抗性', cat: 'def', desc: '減少受到的聖光傷害', emoji: '🕶️' },
  darkRes: { name: '暗影抗性', cat: 'def', desc: '減少受到的暗影傷害', emoji: '🕯️' },
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
var ENCHANT_ESSENCE_COST = 5; // 每次附魔消耗附魔精華
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

// ---- 怪物（magic: 以魔法攻擊，對玩家魔防） ----
var MONSTER_POOL = [
  { name: '史萊姆', emoji: '🟢' }, { name: '哥布林', emoji: '👺' },
  { name: '野狼', emoji: '🐺' }, { name: '骷髏兵', emoji: '💀' },
  { name: '暗影蝠', emoji: '🦇', magic: true }, { name: '樹妖', emoji: '🌳', magic: true },
  { name: '蜥蜴戰士', emoji: '🦎' }, { name: '半獸人', emoji: '🐗' },
  { name: '幽靈', emoji: '👻', magic: true }, { name: '石像鬼', emoji: '🗿' },
  { name: '牛頭人', emoji: '🐂' }, { name: '雙足飛龍', emoji: '🐉', magic: true }
];
/* ---- 戰鬥場景 ----
   荒漠/沼澤敵人更強；經驗、金幣、材料（寶石/附魔書/精華）掉落 x2 / x3，
   裝備掉落表不變。各場景獨立保存推進進度與最高階段。 */
var DESERT_POOL = [
  { name: '沙漠蠍', emoji: '🦂' }, { name: '沙蟲', emoji: '🪱' },
  { name: '木乃伊', emoji: '🧟', magic: true }, { name: '沙漠禿鷹', emoji: '🦅' },
  { name: '響尾蛇', emoji: '🐍' }, { name: '沙魔', emoji: '👹', magic: true },
  { name: '石化蜥蜴', emoji: '🦎' }, { name: '沙漠強盜', emoji: '🏴‍☠️' },
  { name: '火焰精靈', emoji: '🔥', magic: true }, { name: '遠古石像', emoji: '🗿' },
  { name: '沙丘巨獸', emoji: '🐫' }, { name: '太陽祭司', emoji: '☀️', magic: true }
];
var SWAMP_POOL = [
  { name: '劇毒蛙', emoji: '🐸' }, { name: '沼澤鱷', emoji: '🐊' },
  { name: '巨型水蛭', emoji: '🪱' }, { name: '瘴氣幽魂', emoji: '👻', magic: true },
  { name: '食人花', emoji: '🌺' }, { name: '泥漿怪', emoji: '🫠' },
  { name: '毒蚊群', emoji: '🦟' }, { name: '沼澤巫婆', emoji: '🧙', magic: true },
  { name: '腐爛樹人', emoji: '🌳', magic: true }, { name: '蜥蜴薩滿', emoji: '🦎', magic: true },
  { name: '深沼水蛇', emoji: '🐍' }, { name: '沼澤霸主', emoji: '🐲', magic: true }
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
  { name: '烈焰魔君', emoji: '🔥', elem: 'fire', img: 'boss_flame.png' },
  { name: '冰霜女皇', emoji: '❄️', elem: 'ice', img: 'boss_ice.png' },
  { name: '雷霆巨獸', emoji: '⚡', elem: 'lightning', img: 'boss_thunder.png' },
  { name: '鋼鐵魔像', emoji: '🤖', elem: null, img: 'boss_iron.png' },
  { name: '劇毒之母', emoji: '🕷️', elem: 'poison', img: 'boss_poison.png' },
  { name: '深淵領主', emoji: '😈', elem: 'dark', img: 'boss_abyss.png' },
  { name: '亡靈霜龍', emoji: '🐲', elem: 'ice', img: 'boss_dragon.png' },
  { name: '聖焰審判官', emoji: '😇', elem: 'light', img: 'boss_light.png' },
  { name: '風暴泰坦', emoji: '🌩️', elem: 'lightning', img: 'boss_storm.png' },
  { name: '混沌之影', emoji: '🌑', elem: 'dark', img: 'boss_chaos.png' }
];
var TOWER_BOSS_REF_STAGE_BASE = 4;
var TOWER_BOSS_REF_STAGE_PER_FLOOR = 5;
var TOWER_BOSS_LEVEL_BONUS = 3;
var TOWER_BOSS_HIT_BASE = 200;
var TOWER_BOSS_HIT_PER_FLOOR = 20;
var TOWER_BASE_HP_MULT = 20;
var TOWER_BASE_ATK_MULT = 3;
var TOWER_BOSS_DEF_MULT = 10;
var TOWER_BOSS_ASPD = 5;
var TOWER_BOSS_CTRL_RES = 70;
var TOWER_BOSS_DODGE_BASE = 20;
var TOWER_BOSS_DODGE_CAP = 10000000;
var TOWER_BOSS_DODGE_PER_FLOOR = 40;
var TOWER_BOSS_ELEM_ATK_BASE = 3;
var TOWER_BOSS_ELEM_HELL_MULT = 20;
var TOWER_BOSS_XP_MULT = 2;
var TOWER_TRIAL_MAX_FLOOR = 50;
var TOWER_HELL_MAX_FLOOR = 100;
var TOWER_PURGATORY_MAX_FLOOR = 150;
var TOWER_MAX_FLOOR = TOWER_PURGATORY_MAX_FLOOR;
var TOWER_HELL_ATK_MULT = 5;
var TOWER_HELL_HP_MULT = 20;
// 煉獄之塔相對於地獄之塔的 BOSS 攻擊／生命倍率
var TOWER_PURGATORY_ATK_MULT = 5;
var TOWER_PURGATORY_HP_MULT = 10;
var TOWER_HELL_SOUL_ORIGIN_BASE_RATE = 5;
var TOWER_HELL_SOUL_ORIGIN_PER_FLOOR = 1;
var TOWER_TIME_LIMIT = 60;     // 限時 60 秒
function towerTimeLimitWithTalents() {
  var bonus = (typeof talentStatBonuses === 'function') ? talentStatBonuses().potentialTowerTime : 0;
  return TOWER_TIME_LIMIT + (bonus || 0);
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
var INVENTORY_CAP = 60;        // 背包基礎容量
var INVENTORY_MAX = 1000;      // 背包擴充上限（含基礎容量）
var FACTORY_BASE_INTERVAL = 2.0; // 生產線基礎處理間隔（秒/件）
var SYNTHESIS_ENABLED = false; // 合成節點暫時關閉，連同合成專用零件與其掉落一併停用
var SYNTH_GREAT_BASE = 5;        // 合成大成功基礎機率 %

function isFactoryNodeEnabled(node) {
  return node !== 'synth' || SYNTHESIS_ENABLED;
}
// 強化成功率公式 upgradeSuccessBase → 集中於 js/formula.js §7

// ---- 新熔爐（測試版；與舊生產線並行，企劃書：熔爐改造）----
var NEW_FORGE_MAX = 10;            // 熔爐座數上限
var NEW_FORGE_INTERVAL = 2.0;      // 每座熔爐處理間隔（秒/次）
var NEW_FORGE_QUEUE_CAP = 20000;   // 導入佇列上限；滿載時新裝備回退舊輸送帶
var NEW_FORGE_TYPES = {
  smith: { name: '鍛造熔爐', emoji: '🔥', desc: '專門處理裝備及礦石' },
  rune:  { name: '符文熔爐', emoji: '🔮', desc: '處理附魔書及寶石', wip: true },
  magic: { name: '魔法熔爐', emoji: '✨', desc: '處理所有強化、洗煉等高級材料', wip: true }
};
// 傳送帶（生產線）：每爐最多 3 條；篩選器自動篩選原材料上帶，由右至左入爐
var NEW_FORGE_LINES_MAX = 3;          // 每座熔爐傳送帶上限
var NEW_FORGE_BELT_CAP = 10;          // 每條傳送帶在途批次上限（視覺緩衝）
var NEW_FORGE_LINE_LOAD_PER_TICK = 5; // 每 tick 每條傳送帶最多自佇列篩選件數
// 各熔爐類型可選篩選器（wip＝企劃書尚未提供配方，僅顯示不可用）
var NEW_FORGE_FILTERS = {
  smith: [
    { key: 'salvage', name: '拆解裝備' },
    { key: 'craft',   name: '鍛造裝備' },
    { key: 'smelt',   name: '熔煉礦石' }
  ],
  rune: [
    { key: 'scroll', name: '製作附魔卷軸', wip: true },
    { key: 'gem',    name: '製作寶石', wip: true }
  ],
  magic: [
    { key: 'scrap',   name: '製作裝備碎片', wip: true },
    { key: 'essence', name: '製作附魔精華', wip: true },
    { key: 'dust',    name: '製作魔塵', wip: true },
    { key: 'ancient', name: '製作太古精華', wip: true }
  ]
};
// 熔爐大圖（卡片左側）
var NEW_FORGE_IMAGES = {
  smith: 'images/Forging_Furnace.png',
  rune: 'images/Runes_Furnace.png',
  magic: 'images/Magic_Furnace.png'
};
// 15 種礦石/材料註冊表（tier 0＝拆解碎料、tier 1＝熔煉產物）
var NEW_FORGE_MATERIALS = {
  slag:           { name: '爐渣',     emoji: '🪨', tier: 0, color: '#9aa5b1' },
  ironShard:      { name: '碎鐵塊',   emoji: '⚙️', tier: 0, color: '#c8ccd4' },
  silverShard:    { name: '碎銀',     emoji: '🥈', tier: 0, color: '#e3e6ee' },
  goldShard:      { name: '碎金塊',   emoji: '🥇', tier: 0, color: '#ffd700' },
  mithrilShard:   { name: '秘銀碎片', emoji: '🔹', tier: 0, color: '#7dd3fc' },
  thoriumShard:   { name: '瑟銀碎片', emoji: '🟢', tier: 0, color: '#4ade80' },
  arcaniteShard:  { name: '奧金碎片', emoji: '🔸', tier: 0, color: '#fb923c' },
  magisteelShard: { name: '魔鋼碎片', emoji: '🟣', tier: 0, color: '#c084fc' },
  ironIngot:      { name: '鐵錠',     emoji: '🧱', tier: 1, color: '#c8ccd4' },
  silverIngot:    { name: '銀錠',     emoji: '⬜', tier: 1, color: '#e3e6ee' },
  goldIngot:      { name: '金錠',     emoji: '🟨', tier: 1, color: '#ffd700' },
  mithril:        { name: '秘銀',     emoji: '💠', tier: 1, color: '#7dd3fc' },
  thorium:        { name: '瑟銀',     emoji: '🟩', tier: 1, color: '#4ade80' },
  arcanite:       { name: '奧金',     emoji: '🟧', tier: 1, color: '#fb923c' },
  magisteel:      { name: '魔鋼',     emoji: '🟪', tier: 1, color: '#c084fc' }
};
/* 拆解產出表（索引＝裝備品質 0 普通 ~ 7 創世；神鑄創世(8)不入表、一律保留）。
   數值＝期望件數：整數部分必得、小數部分為額外 1 件的機率（newForgeRollAmount → formula.js §7）。 */
var NEW_FORGE_SALVAGE_YIELD = [
  { slag: 1,  ironShard: 0.5, silverShard: 0.1 },
  { slag: 2,  ironShard: 0.6, silverShard: 0.2, goldShard: 0.1 },
  { slag: 3,  ironShard: 0.8, silverShard: 0.3, goldShard: 0.25 },
  { slag: 4,  ironShard: 1,   silverShard: 0.4, goldShard: 0.3,  mithrilShard: 0.1,  thoriumShard: 0.01, arcaniteShard: 0.001 },
  { slag: 5,  ironShard: 2,   silverShard: 0.6, goldShard: 0.5,  mithrilShard: 0.25, thoriumShard: 0.02, arcaniteShard: 0.002, magisteelShard: 0.0002 },
  { slag: 7,  ironShard: 3,   silverShard: 1,   goldShard: 0.75, mithrilShard: 0.5,  thoriumShard: 0.2,  arcaniteShard: 0.04,  magisteelShard: 0.01 },
  { slag: 10, ironShard: 10,  silverShard: 10,  goldShard: 5,    mithrilShard: 3,    thoriumShard: 1,    arcaniteShard: 1 },
  { slag: 50, ironShard: 20,  silverShard: 20,  goldShard: 10,   mithrilShard: 10,   thoriumShard: 5,    arcaniteShard: 3,     magisteelShard: 1 }
];
// 鍛造裝備配方：消耗材料＋任 1 件 inputRarity 品質裝備 → target 品質（等級/部位同素材）
var NEW_FORGE_CRAFT_RECIPES = [
  { target: 2, inputRarity: 1, mats: { mithril: 2 } },
  { target: 3, inputRarity: 2, mats: { mithril: 5 } },
  { target: 4, inputRarity: 3, mats: { mithril: 10 } },
  { target: 5, inputRarity: 4, mats: { mithril: 10, thorium: 5 } }
];
// 熔煉礦石配方：產品 → 消耗材料（每次產出 1 件）
var NEW_FORGE_SMELT_RECIPES = {
  ironIngot:   { slag: 2,  ironShard: 2 },
  silverIngot: { slag: 2,  silverShard: 2 },
  goldIngot:   { slag: 2,  goldShard: 2 },
  mithril:     { slag: 3,  mithrilShard: 2,   ironIngot: 2,  silverIngot: 3 },
  thorium:     { slag: 4,  thoriumShard: 2,   ironIngot: 2,  silverIngot: 3 },
  arcanite:    { slag: 5,  arcaniteShard: 2,  goldIngot: 2,  mithril: 2 },
  magisteel:   { slag: 10, magisteelShard: 2, ironIngot: 10, thorium: 4, arcanite: 4 }
};

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
  fluorite: { name: '螢石', emoji: '💙', stat: 'mRes', statName: '魔法抗性%', base: 0.8, pct: true }
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
  { min: 150, rates: [50, 40, 30, 10, 6, 2.5, 0.2, 0] },
  { min: 100, rates: [40, 30, 15, 10, 5, 1.5, 0, 0] },
  { min: 50, rates: [35, 20, 8, 5, 0, 0, 0, 0] },
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
  else if (type === '/s') s = fmt(val) + '/秒';
  else if (type === 'raw1') s = fmt1(val);
  else s = fmt(val);
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
      { k: 'vitDef', unit: '點', label: '物理防禦' }
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

function statDesc(st, baseDesc, label, keyBase, pctKey) {
  if (!st.A) return baseDesc;
  var flat = st.A[keyBase + 'Flat'] || 0;
  var pct = pctKey ? (st.A[pctKey] || 0) : 0;
  var base = (st.base && st.base[keyBase]) ? st.base[keyBase] : 0;
  var s = baseDesc + '<br><br><span style="color:#aaa">';
  s += label + '總值：<span style="color:#fff">' + fmt(st[keyBase]) + '</span>';
  if (base !== 0) s += '<br>' + label + '基礎：<span style="color:#fff">' + fmt(base) + '</span>';
  if (flat !== 0) s += '<br>' + label + '定值加成：<span style="color:#fff">' + (flat > 0 ? '+' : '') + fmt(flat) + '</span>';
  if (pct !== 0) s += '<br>' + label + '百分比加成：<span style="color:#fff">' + (pct > 0 ? '+' : '') + pctStr(pct) + '</span>';
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

function defenseStatDesc(st, baseDesc, label, keyBase, pctKey) {
  return statDesc(st, baseDesc, label, keyBase, pctKey) + defenseReductionDesc(st, keyBase);
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
      ['⚔️ 物理攻擊', function (st) { return statFmt(st.atk, null); }, function (st) { return statDesc(st, '影響普攻與多數物理技能的傷害基礎。', '物理攻擊', 'atk', 'atkPct'); }],
      ['🔮 魔法攻擊', function (st) { return statFmt(st.matk, null); }, function (st) { return statDesc(st, '影響多數魔法技能的傷害基礎。', '魔法攻擊', 'matk', 'matkPct'); }],
      ['💥 暴擊率', function (st) { return statFmt(st.critRate, STAT_CAPS.critRate, '%'); }, '攻擊時造成額外暴擊傷害的機率。暴擊率 100% 為完全爆擊，超過 100% 的部分會衍生「連擊數」。' + capText(STAT_CAPS.critRate, '%')],
      ['🔗 連擊數', function (st) { return (st.comboHits || 0) > 0 ? fmt1(st.comboHits) + ' 次' : '—'; }, '暴擊率超過 100% 後衍生：普攻與技能的「直接傷害」會額外追加的攻擊次數。持續傷害不受影響。'],
      ['🩸 暴擊傷害', function (st) { return Math.round(st.critDmg) + '%'; }, '觸發暴擊時的傷害倍率。'],
      ['🗡️ 物理穿透', function (st) { return statFmt(st.pPen, STAT_CAPS.pPen, '%'); }, '造成物理傷害時，無視敵方一定比例的物理防禦。' + capText(STAT_CAPS.pPen, '%')],
      ['🪄 魔法穿透', function (st) { return statFmt(st.mPen, STAT_CAPS.mPen, '%'); }, '造成魔法傷害時，無視敵方一定比例的魔法防禦。' + capText(STAT_CAPS.mPen, '%')],
      ['🎯 命中率', function (st) { return statFmt(st.hit, null, '%'); }, '直接抵消敵方的閃避機率。'],
      ['⚡ 攻擊速度', function (st) { return statFmt(st.aspd, ASPD_CAP, '/s'); }, function () { return '每秒進行普通攻擊的次數。' + capText(ASPD_CAP, '/秒'); }],
      ['⏱️ 冷卻縮減', function (st) { return statFmt(st.cdr, STAT_CAPS.cdr, '%'); }, '減少技能所需的冷卻時間。' + capText(STAT_CAPS.cdr, '%')],
      ['🌀 施法速度', function (st) { return statFmt(st.castSpeed, STAT_CAPS.castSpeed, '%'); }, '縮短技能的施放延遲或詠唱時間。' + capText(STAT_CAPS.castSpeed, '%')],
      ['🧛 吸血', function (st) { return statFmt(st.lifesteal, STAT_CAPS.lifesteal, '%'); }, '造成傷害時，將部分傷害轉化為自身生命值。' + capText(STAT_CAPS.lifesteal, '%')],
      ['🌊 吸魔', function (st) { return statFmt(st.manaSteal, STAT_CAPS.manaSteal, '%'); }, '造成傷害時，將部分傷害轉化為自身法力值。' + capText(STAT_CAPS.manaSteal, '%')],
      ['👑 對菁英傷害', function (st) { return statFmt(st.eliteDmg, null, '%', true); }, '對菁英怪或首領怪物造成的額外傷害加成。'],
      ['😈 對BOSS傷害', function (st) { return statFmt(st.bossDmg, null, '%', true); }, '專門對首領怪物造成的額外傷害加成。'],
      ['👤 對普通敵人傷害', function (st) { return statFmt(st.normalDmg, null, '%', true); }, '對普通敵人（非菁英、非BOSS）造成的額外傷害加成，公式與對菁英/BOSS傷害相同。'],
      ['💫 範圍傷害', function (st) { return statFmt(st.aoeDmg, null, '%', true); }, '多目標或範圍技能的總體傷害加成。']
    ]
  },
  {
    title: '防禦屬性', rows: [
      ['🛡️ 物理防禦', function (st) { return statFmt(st.def, null); }, function (st) { return defenseStatDesc(st, '根據防禦公式降低受到的物理傷害。', '物理防禦', 'def', 'defPct'); }],
      ['🔰 魔法防禦', function (st) { return statFmt(st.mdef, null); }, function (st) { return defenseStatDesc(st, '根據防禦公式降低受到的魔法傷害。', '魔法防禦', 'mdef', 'defPct'); }],
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
      ['🗿 物理抗性', function (st) { return statFmt(st.pRes, STAT_CAPS.pRes, '%'); }, '結算防禦後，進一步按比例直接減免受到的物理傷害。' + capText(STAT_CAPS.pRes, '%')],
      ['🌌 魔法抗性', function (st) { return statFmt(st.mRes, STAT_CAPS.mRes, '%'); }, '結算防禦後，進一步按比例直接減免受到的魔法傷害。' + capText(STAT_CAPS.mRes, '%')],
      ['🔥 火焰抗性', function (st) { return statFmt(st.resist.fire, STAT_CAPS.elemRes, '%'); }, '按比例降低受到的火焰屬性傷害。' + capText(STAT_CAPS.elemRes, '%')],
      ['❄️ 冰霜抗性', function (st) { return statFmt(st.resist.ice, STAT_CAPS.elemRes, '%'); }, '按比例降低受到的冰霜屬性傷害。' + capText(STAT_CAPS.elemRes, '%')],
      ['⚡ 雷電抗性', function (st) { return statFmt(st.resist.lightning, STAT_CAPS.elemRes, '%'); }, '按比例降低受到的雷電屬性傷害。' + capText(STAT_CAPS.elemRes, '%')],
      ['☠️ 劇毒抗性', function (st) { return statFmt(st.resist.poison, STAT_CAPS.elemRes, '%'); }, '按比例降低受到的劇毒屬性傷害。' + capText(STAT_CAPS.elemRes, '%')],
      ['✨ 聖光抗性', function (st) { return statFmt(st.resist.light, STAT_CAPS.elemRes, '%'); }, '按比例降低受到的聖光屬性傷害。' + capText(STAT_CAPS.elemRes, '%')],
      ['🌑 暗影抗性', function (st) { return statFmt(st.resist.dark, STAT_CAPS.elemRes, '%'); }, '按比例降低受到的暗影屬性傷害。' + capText(STAT_CAPS.elemRes, '%')],
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
