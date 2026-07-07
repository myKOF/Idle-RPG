'use strict';
/* ============ 遊戲資料定義 ============ */

// ---- 稀有度 ----
var RARITIES = [
  { key: 'common',    name: '普通', color: '#9aa5b1', mult: 1.0, affix: [2, 2], salv: 1.0 },
  { key: 'uncommon',  name: '精良', color: '#4ade80', mult: 1.35, affix: [2, 3], salv: 1.7 },
  { key: 'rare',      name: '稀有', color: '#38bdf8', mult: 1.75, affix: [3, 3], salv: 2.8 },
  { key: 'epic',      name: '史詩', color: '#c084fc', mult: 2.3, affix: [3, 4], salv: 4.5 },
  { key: 'legendary', name: '傳說', color: '#fb923c', mult: 3.0, affix: [4, 5], salv: 7.5 },
  { key: 'mythic',    name: '神話', color: '#f87171', mult: 4.0, affix: [5, 5], salv: 12 }
];
var RARE_IDX = 2; // 稀有級（含）以上附帶特殊被動
var MAX_AFFIXES = 6; // 詞條上限屬性可突破至此

// ---- 裝備部位 ----
var SLOT_LIST = ['weapon', 'helmet', 'chest', 'gloves', 'legs', 'boots', 'ring', 'amulet'];
var SLOT_INFO = {
  weapon: { name: '武器', emoji: '⚔️' },
  helmet: { name: '頭盔', emoji: '🪖' },
  chest:  { name: '胸甲', emoji: '🛡️' },
  gloves: { name: '護手', emoji: '🧤' },
  legs:   { name: '護腿', emoji: '👖' },
  boots:  { name: '靴子', emoji: '🥾' },
  ring:   { name: '戒指', emoji: '💍' },
  amulet: { name: '項鍊', emoji: '📿' }
};
var SLOT_BASENAMES = {
  weapon: ['短劍', '長劍', '戰斧', '法杖', '巨鎚'],
  helmet: ['皮帽', '鐵盔', '戰盔', '龍首盔'],
  chest:  ['布衣', '鎖甲', '板甲', '龍鱗甲'],
  gloves: ['布手套', '皮護手', '鐵護手', '龍鱗護手'],
  legs:   ['布褲', '鐵護腿', '重甲腿鎧'],
  boots:  ['草鞋', '皮靴', '疾風之靴'],
  ring:   ['銅戒', '銀戒', '秘紋戒指'],
  amulet: ['木墜', '銀鍊', '星辰項鍊']
};
var RARITY_PREFIX = ['粗糙的', '堅實的', '精工的', '大師級', '傳世的', '神鑄的'];
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
// 附魔可作用部位
var ENCHANT_SLOTS = {
  atk: ['weapon', 'ring', 'gloves'],
  def: ['helmet', 'chest', 'legs'],
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
var GEM_NAMES = ['', '一級寶石', '二級寶石', '三級寶石', '四級寶石', '五級寶石'];

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
var STAT_GROUPS = [
  { title: '基礎屬性', rows: [
    ['❤️ 生命值', function (st) { return fmt(st.hp); }],
    ['💗 生命恢復', function (st) { return fmt1(st.hpRegen + st.hp * 0.015) + '/秒'; }],
    ['🔵 法力值', function (st) { return fmt(st.mp); }],
    ['💧 法力恢復', function (st) { return fmt1(st.mpRegen) + '/秒'; }],
    ['💪 力量', function (st) { return fmt(st.str); }],
    ['🏃 敏捷', function (st) { return fmt(st.agi); }],
    ['🧠 智力', function (st) { return fmt(st.int); }],
    ['🪨 耐力', function (st) { return fmt(st.vit); }]
  ]},
  { title: '進攻屬性', rows: [
    ['⚔️ 物理攻擊', function (st) { return fmt(st.atk); }],
    ['🔮 魔法攻擊', function (st) { return fmt(st.matk); }],
    ['💥 暴擊率', function (st) { return pctStr(st.critRate); }],
    ['🩸 暴擊傷害', function (st) { return Math.round(st.critDmg) + '%'; }],
    ['🗡️ 物理穿透', function (st) { return pctStr(st.pPen); }],
    ['🪄 魔法穿透', function (st) { return pctStr(st.mPen); }],
    ['🎯 命中率', function (st) { return pctStr(st.hit); }],
    ['⚡ 攻擊速度', function (st) { return fmt1(st.aspd) + '/秒'; }],
    ['⏱️ 冷卻縮減', function (st) { return pctStr(st.cdr); }],
    ['🌀 施法速度', function (st) { return pctStr(st.castSpeed); }],
    ['🧛 吸血', function (st) { return pctStr(st.lifesteal); }],
    ['🌊 吸魔', function (st) { return pctStr(st.manaSteal); }],
    ['👑 對菁英傷害', function (st) { return '+' + pctStr(st.eliteDmg); }],
    ['😈 對BOSS傷害', function (st) { return '+' + pctStr(st.bossDmg); }],
    ['💫 範圍傷害', function (st) { return '+' + pctStr(st.aoeDmg); }]
  ]},
  { title: '防禦屬性', rows: [
    ['🛡️ 物理防禦', function (st) { return fmt(st.def); }],
    ['🔰 魔法防禦', function (st) { return fmt(st.mdef); }],
    ['🧱 格擋率', function (st) { return pctStr(st.blockRate); }],
    ['🧲 格擋減傷', function (st) { return pctStr(30 + st.blockDmgRed); }],
    ['💨 閃避率', function (st) { return pctStr(st.evasion); }],
    ['🦾 韌性', function (st) { return pctStr(st.tenacity); }],
    ['🫧 護盾效率', function (st) { return '+' + pctStr(st.shieldEff); }],
    ['🗿 物理抗性', function (st) { return pctStr(st.pRes); }],
    ['🌌 魔法抗性', function (st) { return pctStr(st.mRes); }]
  ]},
  { title: '元素抗性', rows: [
    ['🔥 火焰抗性', function (st) { return pctStr(st.resist.fire); }],
    ['❄️ 冰霜抗性', function (st) { return pctStr(st.resist.ice); }],
    ['⚡ 雷電抗性', function (st) { return pctStr(st.resist.lightning); }],
    ['☠️ 劇毒抗性', function (st) { return pctStr(st.resist.poison); }],
    ['✨ 聖光抗性', function (st) { return pctStr(st.resist.light); }],
    ['🌑 暗影抗性', function (st) { return pctStr(st.resist.dark); }],
    ['🛡️ 控制抵抗', function (st) { return pctStr(st.resist.ctrl); }]
  ]},
  { title: '特殊與機制', rows: [
    ['⛓️ 控制時間縮減', function (st) { return pctStr(st.ccRed); }],
    ['👟 移動速度', function (st) { return '+' + pctStr(st.moveSpeed); }],
    ['💰 掉寶率', function (st) { return '+' + pctStr(st.loot); }],
    ['📚 經驗加成', function (st) { return '+' + pctStr(st.xpBonus); }],
    ['🪙 金幣加成', function (st) { return '+' + pctStr(st.goldBonus); }],
    ['🍀 幸運值', function (st) { return fmt1(st.luck); }],
    ['🎒 負重上限', function (st) { return '+' + fmt(st.weight); }],
    ['🔨 強化成功率', function (st) { return '+' + pctStr(st.enhanceSuccess); }],
    ['⚗️ 分解高產率', function (st) { return '+' + pctStr(st.decomposeYield); }],
    ['🧬 合成變異率', function (st) { return pctStr(st.hybridMutation); }],
    ['🚨 狂暴閾值', function (st) { return '+' + fmt1(st.enrageThreshold) + '%'; }],
    ['📜 詞條上限率', function (st) { return pctStr(st.affixCap); }],
    ['💎 寶石鑲嵌效率', function (st) { return '+' + pctStr(st.gemEff); }]
  ]}
];
