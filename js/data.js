'use strict';
/* ============ 遊戲資料定義 ============ */

/* ---- 稀有度（8 階）----
   affix: 詞條數量範圍｜sockets: 寶石鑲孔數｜enchants: 附魔欄位數 */
var RARITIES = [
  { key: 'common',    name: '普通', color: '#9aa5b1', mult: 1.0,  affix: [1, 2], sockets: 1, enchants: 1, salv: 1.0 },
  { key: 'uncommon',  name: '精良', color: '#4ade80', mult: 1.35, affix: [1, 2], sockets: 1, enchants: 1, salv: 1.7 },
  { key: 'rare',      name: '稀有', color: '#38bdf8', mult: 1.75, affix: [2, 3], sockets: 2, enchants: 1, salv: 2.8 },
  { key: 'unique',    name: '獨特', color: '#c084fc', mult: 2.3,  affix: [3, 4], sockets: 2, enchants: 2, salv: 4.5 },
  { key: 'epic',      name: '史詩', color: '#ffd700', mult: 3.0,  affix: [4, 5], sockets: 3, enchants: 2, salv: 7.5 },
  { key: 'legendary', name: '傳說', color: '#fb923c', mult: 4.0,  affix: [4, 5], sockets: 4, enchants: 2, salv: 12 },
  { key: 'mythic',    name: '神話', color: '#f87171', mult: 5.2,  affix: [6, 6], sockets: 5, enchants: 3, salv: 19 },
  { key: 'genesis',   name: '創世', color: '#b8860b', mult: 6.8,  affix: [7, 7], sockets: 6, enchants: 3, salv: 30 }
];
var RARE_IDX = 2; // 稀有級（含）以上附帶特殊被動
var MAX_AFFIXES = 8; // 詞條上限屬性可突破至此（創世 7 + 突破 1）

/* ---- 裝備部位 ----
   SLOT_LIST = 裝備欄位（12 欄，含雙武器/雙戒指）；ITEM_TYPES = 物品種類（10 種）。
   武器/戒指類物品可裝入主/副兩個欄位（slotTypeOf 對應）。 */
var SLOT_LIST = ['weapon', 'weapon2', 'helmet', 'shoulder', 'chest', 'belt', 'gloves', 'legs', 'boots', 'ring', 'ring2', 'amulet'];
var ITEM_TYPES = ['weapon', 'helmet', 'shoulder', 'chest', 'belt', 'gloves', 'legs', 'boots', 'ring', 'amulet'];
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
  weapon:   { name: '主武器', emoji: '⚔️' },
  weapon2:  { name: '副武器', emoji: '🗡️' },
  helmet:   { name: '頭盔', emoji: '🪖' },
  shoulder: { name: '肩甲', emoji: '🦾' },
  chest:    { name: '胸甲', emoji: '🛡️' },
  belt:     { name: '腰帶', emoji: '🪢' },
  gloves:   { name: '護手', emoji: '🧤' },
  legs:     { name: '護腿', emoji: '👖' },
  boots:    { name: '靴子', emoji: '🥾' },
  ring:     { name: '戒指', emoji: '💍' },
  ring2:    { name: '戒指Ⅱ', emoji: '💍' },
  amulet:   { name: '項鍊', emoji: '📿' }
};
var SLOT_BASENAMES = {
  weapon:   ['短劍', '長劍', '戰斧', '法杖', '巨鎚'],
  helmet:   ['皮帽', '鐵盔', '戰盔', '龍首盔'],
  shoulder: ['布肩墊', '鐵肩甲', '戰場護肩', '龍骨肩鎧'],
  chest:    ['布衣', '鎖甲', '板甲', '龍鱗甲'],
  belt:     ['麻繩腰帶', '皮革腰帶', '鎖鏈腰帶', '巨龍束帶'],
  gloves:   ['布手套', '皮護手', '鐵護手', '龍鱗護手'],
  legs:     ['布褲', '鐵護腿', '重甲腿鎧'],
  boots:    ['草鞋', '皮靴', '疾風之靴'],
  ring:     ['銅戒', '銀戒', '秘紋戒指'],
  amulet:   ['木墜', '銀鍊', '星辰項鍊']
};
var RARITY_PREFIX = ['普通的', '精良的', '稀有的', '獨特的', '史詩的', '傳說的', '神話的', '創世的'];
var ACCESSORY_SLOTS = ['ring', 'amulet'];

/* ---- 詞條池（50+ 屬性核心） ----
   base: 一級基準值, lv: 每裝備等級成長係數, pct: 是否百分比顯示,
   weight: 出現權重, minR: 最低稀有度, slots: 限定部位（省略=全部）      */
var AFFIX_POOL = {
  // === 基礎 ===
  atkFlat:   { name: '物理攻擊',   base: 4,   lv: 0.55,  pct: false, weight: 11 },
  atkPct:    { name: '物理攻擊%',  base: 4,   lv: 0.02,  pct: true,  weight: 7 },
  matkFlat:  { name: '魔法攻擊',   base: 4,   lv: 0.55,  pct: false, weight: 11 },
  matkPct:   { name: '魔法攻擊%',  base: 4,   lv: 0.02,  pct: true,  weight: 7 },
  hpFlat:    { name: '生命值',     base: 22,  lv: 3.0,   pct: false, weight: 11 },
  hpPct:     { name: '生命值%',    base: 5,   lv: 0.02,  pct: true,  weight: 7 },
  hpRegen:   { name: '生命恢復/秒', base: 2,  lv: 0.5,   pct: false, weight: 5 },
  mpFlat:    { name: '法力值',     base: 10,  lv: 1.2,   pct: false, weight: 5 },
  mpRegen:   { name: '法力恢復/秒', base: 0.8, lv: 0.06, pct: false, weight: 4 },
  str:       { name: '力量',       base: 3,   lv: 0.4,   pct: false, weight: 8 },
  agi:       { name: '敏捷',       base: 3,   lv: 0.4,   pct: false, weight: 8 },
  int:       { name: '智力',       base: 3,   lv: 0.4,   pct: false, weight: 8 },
  vit:       { name: '耐力',       base: 3,   lv: 0.4,   pct: false, weight: 8 },
  // === 進攻 ===
  defFlat:   { name: '物理防禦',   base: 3,   lv: 0.35,  pct: false, weight: 9 },
  defPct:    { name: '物理防禦%',  base: 4,   lv: 0.02,  pct: true,  weight: 6 },
  mdefFlat:  { name: '魔法防禦',   base: 3,   lv: 0.35,  pct: false, weight: 9 },
  aspd:      { name: '攻擊速度%',  base: 3,   lv: 0.012, pct: true,  weight: 6 },
  critRate:  { name: '暴擊率%',    base: 2.5, lv: 0.012, pct: true,  weight: 6 },
  critDmg:   { name: '暴擊傷害%',  base: 8,   lv: 0.05,  pct: true,  weight: 5 },
  pPen:      { name: '物理穿透%',  base: 3,   lv: 0.015, pct: true,  weight: 4, minR: 1 },
  mPen:      { name: '魔法穿透%',  base: 3,   lv: 0.015, pct: true,  weight: 4, minR: 1 },
  hit:       { name: '命中率%',    base: 3,   lv: 0.015, pct: true,  weight: 5 },
  cdr:       { name: '冷卻縮減%',  base: 2.5, lv: 0.01,  pct: true,  weight: 4, minR: 2 },
  castSpeed: { name: '施法速度%',  base: 3,   lv: 0.012, pct: true,  weight: 4, minR: 2 },
  lifesteal: { name: '吸血%',      base: 1.5, lv: 0.008, pct: true,  weight: 4 },
  manaSteal: { name: '吸魔%',      base: 1.2, lv: 0.006, pct: true,  weight: 3, minR: 2 },
  eliteDmg:  { name: '對菁英傷害%', base: 4,  lv: 0.02,  pct: true,  weight: 4, minR: 2 },
  bossDmg:   { name: '對BOSS傷害%', base: 4,  lv: 0.02,  pct: true,  weight: 4, minR: 2 },
  aoeDmg:    { name: '範圍傷害%',  base: 4,   lv: 0.02,  pct: true,  weight: 4, minR: 2 },
  // === 防禦 ===
  blockRate: { name: '格擋率%',    base: 2.5, lv: 0.012, pct: true,  weight: 4 },
  blockDmgRed:{ name: '格擋減傷%', base: 4,   lv: 0.02,  pct: true,  weight: 3, minR: 2 },
  evasion:   { name: '閃避率%',    base: 2,   lv: 0.01,  pct: true,  weight: 4 },
  tenacity:  { name: '韌性%',      base: 4,   lv: 0.02,  pct: true,  weight: 3, minR: 2 },
  shieldEff: { name: '護盾效率%',  base: 5,   lv: 0.025, pct: true,  weight: 3, minR: 3 },
  pRes:      { name: '物理抗性%',  base: 2,   lv: 0.008, pct: true,  weight: 3, minR: 3 },
  mRes:      { name: '魔法抗性%',  base: 2,   lv: 0.008, pct: true,  weight: 3, minR: 3 },
  // === 元素抗性 ===
  resFire:   { name: '火焰抗性%',  base: 4,   lv: 0.02,  pct: true,  weight: 3, minR: 1 },
  resIce:    { name: '冰霜抗性%',  base: 4,   lv: 0.02,  pct: true,  weight: 3, minR: 1 },
  resLightning:{ name: '雷電抗性%', base: 4,  lv: 0.02,  pct: true,  weight: 3, minR: 1 },
  resPoison: { name: '劇毒抗性%',  base: 4,   lv: 0.02,  pct: true,  weight: 3, minR: 1 },
  resLight:  { name: '聖光抗性%',  base: 4,   lv: 0.02,  pct: true,  weight: 3, minR: 1 },
  resDark:   { name: '暗影抗性%',  base: 4,   lv: 0.02,  pct: true,  weight: 3, minR: 1 },
  // === 特殊與機制（多為飾品專屬） ===
  ccRed:     { name: '控制時間縮減%', base: 4, lv: 0.02, pct: true,  weight: 3, minR: 3 },
  moveSpeed: { name: '移動速度%',  base: 3,   lv: 0.012, pct: true,  weight: 4 },
  loot:      { name: '掉寶率%',    base: 3,   lv: 0.015, pct: true,  weight: 4 },
  xpBonus:   { name: '經驗加成%',  base: 4,   lv: 0.02,  pct: true,  weight: 4, slots: ACCESSORY_SLOTS },
  goldBonus: { name: '金幣加成%',  base: 5,   lv: 0.025, pct: true,  weight: 4, slots: ACCESSORY_SLOTS },
  luck:      { name: '幸運值',     base: 2,   lv: 0.1,   pct: false, weight: 3, minR: 3, slots: ACCESSORY_SLOTS },
  weight:    { name: '負重上限',   base: 2,   lv: 0.3,   pct: false, weight: 3, slots: ACCESSORY_SLOTS },
  enhanceSuccess:{ name: '強化成功率%', base: 3, lv: 0.015, pct: true, weight: 3, minR: 3 },
  decomposeYield:{ name: '分解高產率%', base: 3, lv: 0.015, pct: true, weight: 3, minR: 3 },
  hybridMutation:{ name: '合成變異率%', base: 2.5, lv: 0.012, pct: true, weight: 2, minR: 4 },
  enrageThreshold:{ name: '狂暴閾值+', base: 2, lv: 0.08, pct: false, weight: 2, minR: 4 },
  affixCap:  { name: '詞條上限率%', base: 3,  lv: 0.015, pct: true,  weight: 2, minR: 4, slots: ACCESSORY_SLOTS },
  gemEff:    { name: '寶石鑲嵌效率%', base: 5, lv: 0.025, pct: true, weight: 2, minR: 4, slots: ACCESSORY_SLOTS }
};

// ---- 特殊被動（稀有級以上） ----
var PASSIVE_POOL = {
  sunder:    { name: '破甲', desc: '攻擊時忽略目標 {v}% 防禦', base: 10, perR: 2 },
  thorns:    { name: '反震', desc: '受擊時對敵人造成自身 {v}% 最大生命的傷害', base: 5, perR: 1 },
  doubleHit: { name: '連擊', desc: '攻擊時有 {v}% 機率再次攻擊', base: 10, perR: 2 },
  stun:      { name: '暈眩', desc: '攻擊時有 {v}% 機率暈眩敵人 1 秒', base: 6, perR: 1.5 },
  slowHit:   { name: '減速', desc: '攻擊時有 {v}% 機率使敵人攻速降低 30%，持續 3 秒', base: 12, perR: 3 },
  trueDmg:   { name: '真傷', desc: '每次攻擊附加 {v}% 攻擊力的真實傷害', base: 6, perR: 1.5 },
  soulEater: { name: '吸魂', desc: '擊殺敵人時回復 {v}% 最大生命', base: 5, perR: 1.5 }
};

// ---- 元素 ----
var ELEMENTS = ['fire', 'ice', 'lightning', 'poison', 'light', 'dark'];
var ELEM_INFO = {
  fire:      { name: '火焰', emoji: '🔥' },
  ice:       { name: '冰霜', emoji: '❄️' },
  lightning: { name: '雷電', emoji: '⚡' },
  poison:    { name: '劇毒', emoji: '☠️' },
  light:     { name: '聖光', emoji: '✨' },
  dark:      { name: '暗影', emoji: '🌑' }
};

// ---- 附魔 ----
var ENCHANTS = {
  fire:      { name: '火焰附魔', cat: 'atk',  elem: 'fire', desc: '附加高額火焰傷害', emoji: '🔥' },
  ice:       { name: '冰凍附魔', cat: 'atk',  elem: 'ice', desc: '附加冰霜傷害，15% 機率使敵人減速 2 秒', emoji: '❄️' },
  lightning: { name: '閃電附魔', cat: 'atk',  elem: 'lightning', desc: '附加雷電傷害，10% 機率追加一道電擊', emoji: '⚡' },
  poison:    { name: '毒液附魔', cat: 'atk',  elem: 'poison', desc: '附加劇毒傷害，25% 機率使敵人中毒 4 秒', emoji: '🧪' },
  light:     { name: '聖光附魔', cat: 'atk',  elem: 'light', desc: '附加聖光傷害，20% 機率淨化自身負面狀態', emoji: '🌟' },
  dark:      { name: '暗影附魔', cat: 'atk',  elem: 'dark', desc: '附加暗影傷害，並汲取其 25% 回復生命', emoji: '🌑' },
  fireRes:   { name: '火焰抗性', cat: 'def',  desc: '減少受到的火焰傷害', emoji: '🧯' },
  iceRes:    { name: '冰霜抗性', cat: 'def',  desc: '減少受到的冰霜傷害', emoji: '🧊' },
  lightningRes:{ name: '雷電抗性', cat: 'def', desc: '減少受到的雷電傷害', emoji: '🔌' },
  poisonRes: { name: '劇毒抗性', cat: 'def',  desc: '減少受到的劇毒傷害', emoji: '💊' },
  lightRes:  { name: '聖光抗性', cat: 'def',  desc: '減少受到的聖光傷害', emoji: '🕶️' },
  darkRes:   { name: '暗影抗性', cat: 'def',  desc: '減少受到的暗影傷害', emoji: '🕯️' },
  ctrlRes:   { name: '控制抵抗', cat: 'def',  desc: '機率完全抵抗暈眩與減速', emoji: '🛡️' },
  loot:      { name: '尋寶附魔', cat: 'util', desc: '增加裝備掉落率', emoji: '💰' },
  haste:     { name: '疾行附魔', cat: 'util', desc: '增加移動速度（縮短推圖間隔）', emoji: '🌀' }
};
// 附魔可作用部位（裝備欄位）
var ENCHANT_SLOTS = {
  atk: ['weapon', 'weapon2', 'ring', 'ring2', 'gloves'],
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
var KILLS_PER_STAGE = 1;       // 只要擊殺 1 隻即推進階段
var RESPAWN_DELAY = 0.8;       // 出怪間隔（秒）
var REVIVE_DELAY = 3.0;        // 死亡復活時間（秒）

// ---- BOSS 高塔（元素 BOSS 以魔法攻擊） ----
var BOSS_LIST = [
  { name: '烈焰魔君', emoji: '🔥', elem: 'fire' },
  { name: '冰霜女皇', emoji: '❄️', elem: 'ice' },
  { name: '雷霆巨獸', emoji: '⚡', elem: 'lightning' },
  { name: '鋼鐵魔像', emoji: '🤖', elem: null },
  { name: '劇毒之母', emoji: '🕷️', elem: 'poison' },
  { name: '深淵領主', emoji: '😈', elem: 'dark' },
  { name: '亡靈霜龍', emoji: '🐲', elem: 'ice' },
  { name: '聖焰審判官', emoji: '😇', elem: 'light' },
  { name: '風暴泰坦', emoji: '🌩️', elem: 'lightning' },
  { name: '混沌之影', emoji: '🌑', elem: 'dark' }
];
var TOWER_TIME_LIMIT = 60;     // 限時 60 秒
var TOWER_ENRAGE_TIME = 40;    // 40 秒檢查狂暴
var TOWER_ENRAGE_HP = 50;      // 血量高於 50% 觸發（玩家「狂暴閾值」屬性可提高此門檻）
var TOWER_ENRAGE_MULT = 3;     // 傷害增加 200% => 3 倍

// ---- 自動機組零件 ----
var PART_TYPES = {
  speedGear: {
    name: '加速齒輪', emoji: '⚙️', node: 'salvage',
    desc: '分解速度 +{v}%', perTier: 25
  },
  luckCore: {
    name: '幸運核心', emoji: '🍀', node: 'synth',
    desc: '合成大成功率 +{v}%', perTier: 8
  },
  rerollModule: {
    name: '重骰模組', emoji: '🎲', node: 'synth',
    desc: '合成時詞條重骰（取較佳值）機率 +{v}%', perTier: 15
  }
};
var PART_MAX_TIER = 5;
var NODE_NAMES = { filter: '篩選節點', salvage: '分解槽', synth: '合成節點', enchant: '附魔節點', upgrade: '強化節點' };
var PART_SLOTS_PER_NODE = 2;   // 每個可安裝節點的零件槽數

// ---- 生產線 ----
var CONVEYOR_CAP = 40;         // 輸送帶基礎容量（受「負重上限」屬性擴充）
var SYNTH_BUFFER_CAP = 30;     // 合成暫存區基礎容量（受「負重上限」屬性擴充）
var INVENTORY_CAP = 60;        // 背包容量
var FACTORY_BASE_INTERVAL = 2.0; // 生產線基礎處理間隔（秒/件）
var ESSENCE_EXTRACT_CHANCE = 10; // 分解觸發「精粹提取」基礎機率 %
var SYNTH_GREAT_BASE = 5;        // 合成大成功基礎機率 %
// 強化成功率：+5 以內必成，之後每級 -6%，下限 30%（受「強化成功率」屬性提升）
function upgradeSuccessBase(nextLevel) {
  if (nextLevel <= 5) return 100;
  return Math.max(30, 100 - (nextLevel - 5) * 6);
}

// ---- 寶石 ----
var GEM_MAX_LEVEL = 5;
var GEM_NAMES = ['', '一級', '二級', '三級', '四級', '五級'];

/* 寶石種類（12 種能力）：鑲嵌到裝備插槽後生效。
   stat 對應 computeStats 的聚合桶（aspd 會轉為 aspdPct） */
var GEM_TYPES = {
  ruby:      { name: '紅寶石', emoji: '🔴', stat: 'atkFlat',   statName: '物理攻擊',   base: 6,   pct: false },
  sapphire:  { name: '藍寶石', emoji: '🔵', stat: 'matkFlat',  statName: '魔法攻擊',   base: 6,   pct: false },
  topaz:     { name: '黃玉',   emoji: '🟡', stat: 'hpFlat',    statName: '生命值',     base: 40,  pct: false },
  emerald:   { name: '綠寶石', emoji: '🟢', stat: 'hpRegen',   statName: '生命恢復/秒', base: 3,  pct: false },
  diamond:   { name: '鑽石',   emoji: '⚪', stat: 'defFlat',   statName: '物理防禦',   base: 5,   pct: false },
  lapis:     { name: '青金石', emoji: '🔷', stat: 'mdefFlat',  statName: '魔法防禦',   base: 5,   pct: false },
  amethyst:  { name: '紫水晶', emoji: '🟣', stat: 'critRate',  statName: '暴擊率%',    base: 1.5, pct: true },
  garnet:    { name: '石榴石', emoji: '🟠', stat: 'critDmg',   statName: '暴擊傷害%',  base: 5,   pct: true },
  opal:      { name: '蛋白石', emoji: '🩵', stat: 'aspd',      statName: '攻擊速度%',  base: 1.5, pct: true },
  onyx:      { name: '黑曜石', emoji: '⚫', stat: 'lifesteal', statName: '吸血%',      base: 1,   pct: true },
  moonstone: { name: '月光石', emoji: '🌙', stat: 'evasion',   statName: '閃避率%',    base: 1,   pct: true },
  sunstone:  { name: '太陽石', emoji: '☀️', stat: 'luck',      statName: '幸運值',     base: 1.5, pct: false }
};
// 寶石能力數值（隨等級超線性成長）
function gemStatValue(type, level) {
  var g = GEM_TYPES[type];
  return Math.round(g.base * level * (1 + 0.2 * (level - 1)) * 10) / 10;
}
// 插槽數：依稀有度表（普/精良 1、稀有/獨特 2、史詩 3、傳說 4、神話 5、創世 6）
function socketCountFor(rarity) {
  var r = RARITIES[clamp(rarity, 0, RARITIES.length - 1)];
  return r.sockets;
}
// 附魔欄位數
function enchantCapFor(it) {
  return RARITIES[clamp(it.rarity, 0, RARITIES.length - 1)].enchants;
}
// 寶石融合：消耗 2 顆同級寶石 → 隨機種類同級，機率升 1 級
var FUSE_GOLD_COST = [0, 100, 300, 900, 2700, 8100]; // 依等級
var FUSE_UPGRADE_CHANCE = 25; // % 基礎（+幸運值/2）

/* ---- 物品掉落表 ----
   每個品質獨立擲骰（可同時掉多件）；機率 >100%：必掉 floor(p/100) 件，餘數為再掉 1 件的機率。
   rates 索引 = 品質 0~7（普通~創世）。 */
var FIELD_DROP_TABLE = [   // 野外：依怪物等級
  { min: 150, rates: [0,  0,  25, 15, 5, 2, 1, 0] },
  { min: 100, rates: [0,  20, 15, 10, 5, 2, 0, 0] },
  { min: 50,  rates: [25, 10, 5,  2,  0, 0, 0, 0] },
  { min: 1,   rates: [25, 10, 5,  0,  0, 0, 0, 0] }
];
var BOSS_DROP_TABLE = [    // 高塔 BOSS：依樓層 7 檔（與掉落表加總列逐欄核對：165/232/256/323/538/700/715）
  { min: 31, rates: [0, 0, 0,   300, 200, 150, 50, 15] },   // 30級含以上（715%）
  { min: 26, rates: [0, 0, 0,   300, 200, 150, 40, 10] },   // 26~30（700%）
  { min: 21, rates: [0, 0, 0,   250, 150, 100, 33, 5] },    // 21~25（538%）
  { min: 16, rates: [0, 0, 0,   150, 100, 50,  20, 2.5] },  // 16~20（322.5%）
  { min: 11, rates: [0, 0, 0,   100, 100, 50,  5,  1] },    // 11~15（256%）
  { min: 6,  rates: [0, 0, 100, 100, 20,  10,  2,  0] },    // 6~10（232%）
  { min: 1,  rates: [0, 0, 100, 50,  10,  5,   0,  0] }     // 1~5（165%）
];
function dropRatesFor(table, lvl) {
  for (var i = 0; i < table.length; i++) {
    if (lvl >= table[i].min) return table[i].rates;
  }
  return table[table.length - 1].rates;
}
// 機率 → 掉落件數（>100% 規則：150% = 必掉 1 件 + 50% 再 1 件）
function rollDropCount(pct) {
  if (pct <= 0) return 0;
  var n = Math.floor(pct / 100);
  if (chance(pct - n * 100)) n++;
  return n;
}

// ---- 怪物 / 成長曲線 ----
function monsterStatsFor(stage, elite) {
  var hp = (30 + stage * 8) * Math.pow(1.13, stage - 1);
  var atk = (6 + stage * 1.2) * Math.pow(1.10, stage - 1);
  var def = (2 + stage * 0.5) * Math.pow(1.08, stage - 1);
  var gold = (5 + stage) * Math.pow(1.07, stage - 1);
  var xp = (8 + stage) * Math.pow(1.08, stage - 1);
  var m = {
    level: stage, hp: hp, atk: atk,
    def: def,                 // 物理防禦
    mdef: def * 0.75,         // 魔法防禦
    aspd: 1.0,
    dodge: 0, gold: gold, xp: xp, elite: !!elite
  };
  if (elite) {
    m.hp *= 2.5; m.atk *= 1.5; m.gold *= 3; m.xp *= 3; m.dodge = 5;
  }
  return m;
}

function xpForLevel(l) { return Math.floor(30 * Math.pow(l, 1.85) + 40); }

/* ---- 玩家基礎屬性（不含裝備）----
   四維主屬性隨等級成長，再派生出各項數值（詳見 computeStats） */
function basePrimaryFor(level) {
  var v = 5 + (level - 1) * 2;
  return { str: v, agi: v, int: v, vit: v };
}

// 防禦減傷：def / (def + 60 + 8 * 攻擊者等級)
function defReduction(def, attackerLevel) {
  if (def <= 0) return 0;
  return def / (def + 60 + 8 * attackerLevel);
}

/* ---- 屬性面板顯示定義（側欄用） ---- */
function statFmt(val, cap, type, prefix) {
  var s = '';
  if (type === '%') s = pctStr(val);
  else if (type === '/s') s = fmt1(val) + '/秒';
  else if (type === 'raw1') s = fmt1(val);
  else s = fmt(val);
  if (prefix) s = '+' + s;
  if (cap !== null && val >= cap) return '<span style="color: #ffd700;">' + s + '</span>';
  return s;
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

var STAT_GROUPS = [
  { title: '基礎屬性', rows: [
    ['❤️ 生命值', function (st) { return statFmt(st.hp, null); }, function(st) { return statDesc(st, '承受傷害的能力，歸零時角色將會死亡。', '生命', 'hp', 'hpPct'); }],
    ['💗 生命恢復', function (st) { return statFmt(st.hpRegen + st.hp * 0.015, null, '/s'); }, '每秒自動回復的生命值（包含基礎 1.5% 與額外加成）。'],
    ['🔵 法力值', function (st) { return statFmt(st.mp, null); }, function(st) { return statDesc(st, '施放多數技能所需的能量。', '法力', 'mp', null); }],
    ['💧 法力恢復', function (st) { return statFmt(st.mpRegen, null, '/s'); }, '每秒自動回復的法力值。'],
    ['💪 力量', function (st) { return statFmt(st.str, null); }, '每增加 1 點提高 2 點物理攻擊力。'],
    ['🏃 敏捷', function (st) { return statFmt(st.agi, null); }, '每增加 1 點提高 0.06% 暴擊率、0.15% 攻速與 0.08% 閃避率。'],
    ['🧠 智力', function (st) { return statFmt(st.int, null); }, '每增加 1 點提高 4 點法力上限、0.06 法力恢復、2 點魔法攻擊力與 0.7 魔法防禦。'],
    ['🪨 耐力', function (st) { return statFmt(st.vit, null); }, '每增加 1 點提高 10 點生命上限與 0.9 物理防禦。']
  ]},
  { title: '進攻屬性', rows: [
    ['⚔️ 物理攻擊', function (st) { return statFmt(st.atk, null); }, function(st) { return statDesc(st, '影響普攻與多數物理技能的傷害基礎。', '物理攻擊', 'atk', 'atkPct'); }],
    ['🔮 魔法攻擊', function (st) { return statFmt(st.matk, null); }, function(st) { return statDesc(st, '影響多數魔法技能的傷害基礎。', '魔法攻擊', 'matk', 'matkPct'); }],
    ['💥 暴擊率', function (st) { return statFmt(st.critRate, 100, '%'); }, '攻擊時造成額外暴擊傷害的機率。（上限：100%）'],
    ['🩸 暴擊傷害', function (st) { return Math.round(st.critDmg) + '%'; }, '觸發暴擊時的傷害倍率。'],
    ['🗡️ 物理穿透', function (st) { return statFmt(st.pPen, 80, '%'); }, '造成物理傷害時，無視敵方一定比例的物理防禦。（上限：80%）'],
    ['🪄 魔法穿透', function (st) { return statFmt(st.mPen, 80, '%'); }, '造成魔法傷害時，無視敵方一定比例的魔法防禦。（上限：80%）'],
    ['🎯 命中率', function (st) { return statFmt(st.hit, null, '%'); }, '直接抵消敵方的閃避機率。'],
    ['⚡ 攻擊速度', function (st) { return statFmt(st.aspd, 5, '/s'); }, '每秒進行普通攻擊的次數。（上限：5/秒）'],
    ['⏱️ 冷卻縮減', function (st) { return statFmt(st.cdr, 60, '%'); }, '減少技能所需的冷卻時間。（上限：60%）'],
    ['🌀 施法速度', function (st) { return statFmt(st.castSpeed, 50, '%'); }, '縮短技能的施放延遲或詠唱時間。（上限：50%）'],
    ['🧛 吸血', function (st) { return statFmt(st.lifesteal, 60, '%'); }, '造成傷害時，將部分傷害轉化為自身生命值。（上限：60%）'],
    ['🌊 吸魔', function (st) { return statFmt(st.manaSteal, 30, '%'); }, '造成傷害時，將部分傷害轉化為自身法力值。（上限：30%）'],
    ['👑 對菁英傷害', function (st) { return statFmt(st.eliteDmg, null, '%', true); }, '對菁英怪或首領怪物造成的額外傷害加成。'],
    ['😈 對BOSS傷害', function (st) { return statFmt(st.bossDmg, null, '%', true); }, '專門對首領怪物造成的額外傷害加成。'],
    ['💫 範圍傷害', function (st) { return statFmt(st.aoeDmg, null, '%', true); }, '多目標或範圍技能的總體傷害加成。']
  ]},
  { title: '防禦屬性', rows: [
    ['🛡️ 物理防禦', function (st) { return statFmt(st.def, null); }, function(st) { return statDesc(st, '根據防禦公式降低受到的物理傷害。', '物理防禦', 'def', 'defPct'); }],
    ['🔰 魔法防禦', function (st) { return statFmt(st.mdef, null); }, function(st) { return statDesc(st, '根據防禦公式降低受到的魔法傷害。', '魔法防禦', 'mdef', 'defPct'); }],
    ['🧱 格擋率', function (st) { return statFmt(st.blockRate, 50, '%'); }, '受到攻擊時，有機率觸發格擋來減輕部分傷害。（上限：50%）'],
    ['🧲 格擋減傷', function (st) { return statFmt(30 + st.blockDmgRed, 80, '%'); }, '成功格擋時能減免的傷害比例。（上限：80%）'],
    ['💨 閃避率', function (st) { return statFmt(st.evasion, 40, '%'); }, '完全避開敵人攻擊的機率（受敵方命中率影響）。（上限：40%）'],
    ['🦾 韌性', function (st) { return statFmt(st.tenacity, 60, '%'); }, '降低自身被施加暈眩、減速等控制狀態的機率。（上限：60%）'],
    ['🫧 護盾效率', function (st) { return statFmt(st.shieldEff, null, '%', true); }, '提升護盾的最大吸收上限與獲取量。'],
    ['🗿 物理抗性', function (st) { return statFmt(st.pRes, 60, '%'); }, '結算防禦後，進一步按比例直接減免受到的物理傷害。（上限：60%）'],
    ['🌌 魔法抗性', function (st) { return statFmt(st.mRes, 60, '%'); }, '結算防禦後，進一步按比例直接減免受到的魔法傷害。（上限：60%）']
  ]},
  { title: '元素抗性', rows: [
    ['🔥 火焰抗性', function (st) { return statFmt(st.resist.fire, 75, '%'); }, '按比例降低受到的火焰屬性傷害。（上限：75%）'],
    ['❄️ 冰霜抗性', function (st) { return statFmt(st.resist.ice, 75, '%'); }, '按比例降低受到的冰霜屬性傷害。（上限：75%）'],
    ['⚡ 雷電抗性', function (st) { return statFmt(st.resist.lightning, 75, '%'); }, '按比例降低受到的雷電屬性傷害。（上限：75%）'],
    ['☠️ 劇毒抗性', function (st) { return statFmt(st.resist.poison, 75, '%'); }, '按比例降低受到的劇毒屬性傷害。（上限：75%）'],
    ['✨ 聖光抗性', function (st) { return statFmt(st.resist.light, 75, '%'); }, '按比例降低受到的聖光屬性傷害。（上限：75%）'],
    ['🌑 暗影抗性', function (st) { return statFmt(st.resist.dark, 75, '%'); }, '按比例降低受到的暗影屬性傷害。（上限：75%）'],
    ['🛡️ 控制抵抗', function (st) { return statFmt(st.resist.ctrl, 80, '%'); }, '全面降低所有負面異常狀態的命中率。（上限：80%）']
  ]},
  { title: '特殊與機制', rows: [
    ['⛓️ 控制時間縮減', function (st) { return statFmt(st.ccRed, 60, '%'); }, '減少被施加暈眩、減速等控制狀態的持續時間。（上限：60%）'],
    ['👟 移動速度', function (st) { return statFmt(st.moveSpeed, 50, '%', true); }, '提高探索地圖、遇敵或到達終點的速度。（上限：+50%）'],
    ['💰 掉寶率', function (st) { return statFmt(st.loot, null, '%', true); }, '提高擊殺怪物後掉落裝備與道具的機率。'],
    ['📚 經驗加成', function (st) { return statFmt(st.xpBonus, null, '%', true); }, '額外增加戰鬥勝利後獲得的經驗值。'],
    ['🪙 金幣加成', function (st) { return statFmt(st.goldBonus, null, '%', true); }, '額外增加戰鬥勝利後獲得的金幣。'],
    ['🍀 幸運值', function (st) { return statFmt(st.luck, 100, 'raw1'); }, '提升在洗煉或合成裝備時出現高階詞條的機率。（上限：100）'],
    ['🎒 負重上限', function (st) { return statFmt(st.weight, null, null, true); }, '提升生產線輸送帶與合成暫存區的容量上限。'],
    ['🔨 強化成功率', function (st) { return statFmt(st.enhanceSuccess, null, '%', true); }, '提升裝備強化的成功機率。'],
    ['⚗️ 分解高產率', function (st) { return statFmt(st.decomposeYield, null, '%', true); }, '增加分解裝備時獲得洗煉精粹的數量或機率。'],
    ['🧬 合成變異率', function (st) { return statFmt(st.hybridMutation, 60, '%'); }, '提升裝備合成時發生特殊異變（如詞條升級）的機率。（上限：60%）'],
    ['🚨 狂暴閾值', function (st) { return statFmt(st.enrageThreshold, 30, '%', true); }, '影響怪物進入狂暴狀態的時間點或血量條件。（上限：+30%）'],
    ['📜 詞條上限率', function (st) { return statFmt(st.affixCap, 100, '%'); }, '影響裝備洗煉或生成時獲得更多詞條的機率。（上限：100%）'],
    ['💎 寶石鑲嵌效率', function (st) { return statFmt(st.gemEff, null, '%', true); }, '全面放大所有已鑲嵌寶石的能力值。']
  ]}
];
