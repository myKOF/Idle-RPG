'use strict';
/* ============ 技能系統 ============
   - 主動技能：消耗 MP、依強度有冷卻（受 CDR 影響），戰鬥中依裝載順序自動施放
   - 被動技能：學會即永久生效（計入屬性）
   - 學習/升級：每升 1 級獲得 1 技能點；學習或升 1 級各花 1 點，上限 Lv.5   */

/* 技能數值公式（SKILL_CAST_LOCK、TIER_GATE_POINTS、loadoutSize、
   skillUpgradeCost、skillMaxLv、skillValue、skillCdFor、scaleAt、
   融合參數 FUSE_FACTOR / FUSION_MUTATION_CHANCE 等）→ js/formula.js §9 */

var SKILL_CATS = {
  phys:    { name: '物理', emoji: '⚔️' },
  magic:   { name: '魔法', emoji: '🔮' },
  def:     { name: '防禦與治療', emoji: '🛡️' },
  special: { name: '特殊', emoji: '✨' },
  passive: { name: '被動', emoji: '📿' }
};

// 技能定義查詢（含玩家自創的融合技）
function skillDef(id) {
  if (SKILLS[id]) return SKILLS[id];
  var fs = G.player.fusions || [];
  for (var i = 0; i < fs.length; i++) if (fs[i].id === id) return fs[i];
  return null;
}
// skillMaxLv → js/formula.js §9

/* fx 欄位說明（主動）：
   dmgType phys/magic/true、stat atk/matk、base+per=傷害%（每級 per）、hits 段數
   elem:{type,portion} 元素占比、dot:{pct,dur,name} 以技能值為基準的每秒跳傷
   stunDur/slowDur、selfDmgPct、healPctOfDmg、healPctMax、hotPct+hotDur
   shieldPctMax、buff/debuff:{key,base,per,dur}、goldPer、mpRestore
   neverMiss、critBonus、execBelow+execMult、maxHpDotPct（詛咒）
   ai：施放條件 hurt30/50/70、debuffed、always（預設有敵人就放）
   被動：fx.passive = { 屬性桶: 每級數值 }、fx.elemMult = 每級元素傷% */
var SKILLS = {
  /* ================ 物理（12） ================ */
  powerSlash:   { name: '強力斬', emoji: '🗡️', cat: 'phys', cost: 15, cd: 6,
    flavor: '蓄力揮出沉重的一擊。', fx: { dmgType: 'phys', stat: 'atk', base: 180, per: 40 } },
  doubleStrike: { name: '二連擊', emoji: '⚔️', cat: 'phys', cost: 20, cd: 8,
    flavor: '快速的兩段斬擊。', fx: { dmgType: 'phys', stat: 'atk', base: 105, per: 22, hits: 2 } },
  whirlwind:    { name: '旋風斬', emoji: '🌪️', cat: 'phys', cost: 25, cd: 10,
    flavor: '旋轉身軀橫掃周遭。', fx: { dmgType: 'phys', stat: 'atk', base: 230, per: 50 } },
  armorBreak:   { name: '破甲擊', emoji: '🔨', cat: 'phys', cost: 20, cd: 12,
    flavor: '重擊敵人的護甲弱點。', fx: { dmgType: 'phys', stat: 'atk', base: 150, per: 30, debuff: { key: 'defDown', base: 25, per: 5, dur: 5 } } },
  executeStrike:{ name: '處決', emoji: '💀', cat: 'phys', cost: 30, cd: 15,
    flavor: '對瀕死敵人給予終結。', fx: { dmgType: 'phys', stat: 'atk', base: 200, per: 45, execBelow: 30, execMult: 2 } },
  rendWound:    { name: '撕裂', emoji: '🩸', cat: 'phys', cost: 18, cd: 10,
    flavor: '造成難以癒合的傷口。', fx: { dmgType: 'phys', stat: 'atk', base: 120, per: 25, dot: { pct: 25, dur: 5, name: '流血' } } },
  stunBlow:     { name: '震盪重擊', emoji: '💫', cat: 'phys', cost: 25, cd: 14,
    flavor: '猛擊敵人使其暈眩。', fx: { dmgType: 'phys', stat: 'atk', base: 160, per: 32, stunDur: 1.5 } },
  berserkStrike:{ name: '狂暴打擊', emoji: '😤', cat: 'phys', cost: 20, cd: 12,
    flavor: '不顧自身安危的猛攻。', fx: { dmgType: 'phys', stat: 'atk', base: 300, per: 60, selfDmgPct: 5 } },
  preciseThrust:{ name: '精準突刺', emoji: '🎯', cat: 'phys', cost: 15, cd: 8,
    flavor: '絕不落空的致命突刺。', fx: { dmgType: 'phys', stat: 'atk', base: 150, per: 32, neverMiss: true, critBonus: 30 } },
  heavySmash:   { name: '泰山壓頂', emoji: '🪨', cat: 'phys', cost: 28, cd: 13,
    flavor: '沉重的壓制性打擊。', fx: { dmgType: 'phys', stat: 'atk', base: 250, per: 55, slowDur: 3 } },
  swiftCuts:    { name: '疾風連斬', emoji: '🍃', cat: 'phys', cost: 32, cd: 16,
    flavor: '化作疾風的三段斬。', fx: { dmgType: 'phys', stat: 'atk', base: 75, per: 16, hits: 3 } },
  counterStance:{ name: '反擊架勢', emoji: '🔄', cat: 'phys', cost: 22, cd: 18,
    flavor: '擺出以牙還牙的架勢。', fx: { buff: { key: 'thornsUp', base: 12, per: 4, dur: 6 } } },

  /* ================ 魔法（12） ================ */
  arcaneBurst:  { name: '奧術衝擊', emoji: '🌠', cat: 'magic', cost: 30, cd: 10,
    flavor: '釋放純粹的奧術能量。', fx: { dmgType: 'magic', stat: 'matk', base: 165, per: 38 } },
  fireball:     { name: '火球術', emoji: '🔥', cat: 'magic', cost: 25, cd: 9,
    flavor: '投出灼熱的火球並點燃敵人。', fx: { dmgType: 'magic', stat: 'matk', base: 180, per: 40, elem: { type: 'fire', portion: 0.5 }, dot: { pct: 20, dur: 4, name: '燃燒' } } },
  iceLance:     { name: '寒冰槍', emoji: '❄️', cat: 'magic', cost: 25, cd: 9,
    flavor: '冰冷的長槍刺穿敵人。', fx: { dmgType: 'magic', stat: 'matk', base: 165, per: 35, elem: { type: 'ice', portion: 0.5 }, slowDur: 3 } },
  chainLightning:{ name: '連鎖閃電', emoji: '⚡', cat: 'magic', cost: 28, cd: 11,
    flavor: '躍動的閃電連續劈落。', fx: { dmgType: 'magic', stat: 'matk', base: 95, per: 20, hits: 2, elem: { type: 'lightning', portion: 0.4 } } },
  venomCloud:   { name: '劇毒雲霧', emoji: '☠️', cat: 'magic', cost: 26, cd: 12,
    flavor: '瀰漫的毒霧侵蝕敵人。', fx: { dmgType: 'magic', stat: 'matk', base: 100, per: 20, dot: { pct: 40, dur: 6, name: '中毒' } } },
  holySmite:    { name: '聖光審判', emoji: '🌟', cat: 'magic', cost: 25, cd: 10,
    flavor: '聖光降下裁決並潔淨己身。', fx: { dmgType: 'magic', stat: 'matk', base: 170, per: 36, elem: { type: 'light', portion: 0.4 }, selfCleanse: true } },
  shadowBolt:   { name: '暗影箭', emoji: '🌑', cat: 'magic', cost: 25, cd: 10,
    flavor: '汲取生命的暗影之矢。', fx: { dmgType: 'magic', stat: 'matk', base: 160, per: 34, healPctOfDmg: 30 } },
  arcaneBarrage:{ name: '奧術彈幕', emoji: '💫', cat: 'magic', cost: 40, cd: 15,
    flavor: '傾瀉四發奧術飛彈。', fx: { dmgType: 'magic', stat: 'matk', base: 58, per: 13, hits: 4 } },
  meteor:       { name: '隕石術', emoji: '☄️', cat: 'magic', cost: 60, cd: 25,
    flavor: '呼喚天降隕石毀滅一切。', fx: { dmgType: 'magic', stat: 'matk', base: 420, per: 85, elem: { type: 'fire', portion: 0.3 } } },
  manaBurn:     { name: '法力灼燒', emoji: '🔮', cat: 'magic', cost: 20, cd: 8,
    flavor: '以法力引發劇烈爆燃，爆擊時返還法力。', fx: { dmgType: 'magic', stat: 'matk', base: 160, per: 34, mpOnCrit: 20 } },
  frostNova:    { name: '霜之新星', emoji: '🧊', cat: 'magic', cost: 30, cd: 14,
    flavor: '迸發的冰環凍結敵人。', fx: { dmgType: 'magic', stat: 'matk', base: 130, per: 28, elem: { type: 'ice', portion: 0.3 }, stunDur: 1 } },
  voidRift:     { name: '虛空裂隙', emoji: '🕳️', cat: 'magic', cost: 45, cd: 18,
    flavor: '撕開無視一切防禦的虛空。', fx: { dmgType: 'true', stat: 'matk', base: 130, per: 28 } },

  /* ================ 防禦與治療（10） ================ */
  healWound:    { name: '治癒術', emoji: '💚', cat: 'def', cost: 30, cd: 12, ai: 'hurt70',
    flavor: '溫暖的光輝癒合傷口。', fx: { healPctMax: { base: 15, per: 4 } } },
  regenerate:   { name: '再生術', emoji: '🌿', cat: 'def', cost: 28, cd: 15, ai: 'hurt80',
    flavor: '持續再生的自然之力。', fx: { hotPct: { base: 2.5, per: 0.7 }, hotDur: 6 } },
  manaBarrier:  { name: '魔法屏障', emoji: '🛡️', cat: 'def', cost: 30, cd: 15, ai: 'shield',
    flavor: '展開吸收傷害的屏障。', fx: { shieldPctMax: { base: 18, per: 4 } } },
  ironWall:     { name: '鐵壁', emoji: '🏰', cat: 'def', cost: 25, cd: 18, ai: 'hurt50',
    flavor: '硬化全身抵禦攻擊。', fx: { buff: { key: 'defUp', base: 40, per: 10, dur: 6 } } },
  purify:       { name: '淨化術', emoji: '✨', cat: 'def', cost: 15, cd: 10, ai: 'debuffed',
    flavor: '洗去身上的負面狀態。', fx: { selfCleanse: true, healPctMax: { base: 5, per: 1.5 } } },
  lifeLink:     { name: '生命汲取', emoji: '🧛', cat: 'def', cost: 22, cd: 10,
    flavor: '奪取敵人的生命力。', fx: { dmgType: 'magic', stat: 'matk', base: 110, per: 24, healPctOfDmg: 100 } },
  sanctuary:    { name: '庇護所', emoji: '⛪', cat: 'def', cost: 30, cd: 20, ai: 'hurt40',
    flavor: '神聖領域護佑己身。', fx: { buff: { key: 'evasionUp', base: 25, per: 5, dur: 5 } } },
  secondWind:   { name: '回春氣息', emoji: '💨', cat: 'def', cost: 0, cd: 25, ai: 'hurt30',
    flavor: '危急時的求生本能（不耗魔）。', fx: { healPctMax: { base: 10, per: 3 }, mpRestore: 20 } },
  reflectShield:{ name: '反射護盾', emoji: '🪞', cat: 'def', cost: 28, cd: 18,
    flavor: '反彈傷害的光盾。', fx: { buff: { key: 'thornsUp', base: 15, per: 5, dur: 6 }, buff2: { key: 'blockUp', base: 12, per: 4, dur: 6 } } },
  lastStand:    { name: '背水一戰', emoji: '🚩', cat: 'def', cost: 35, cd: 30, ai: 'hurt25',
    flavor: '絕境中爆發的鬥志。', fx: { healPctMax: { base: 20, per: 5 }, buff: { key: 'atkUp', base: 15, per: 5, dur: 6 } } },

  /* ================ 特殊（10） ================ */
  timeWarp:     { name: '時間扭曲', emoji: '⏳', cat: 'special', cost: 35, cd: 20,
    flavor: '加速自身的時間流。', fx: { buff: { key: 'aspdUp', base: 25, per: 7, dur: 6 } } },
  midasTouch:   { name: '點金手', emoji: '🪙', cat: 'special', cost: 25, cd: 20,
    flavor: '揮出將敵人化為財富的一擊。', fx: { dmgType: 'phys', stat: 'atk', base: 100, per: 20, goldPer: 15 } },
  treasureSense:{ name: '尋寶直覺', emoji: '🔍', cat: 'special', cost: 30, cd: 30,
    flavor: '嗅出寶物的氣息。', fx: { buff: { key: 'lootUp', base: 30, per: 10, dur: 10 } } },
  weakenCurse:  { name: '虛弱詛咒', emoji: '📉', cat: 'special', cost: 22, cd: 15,
    flavor: '削弱敵人的力量。', fx: { debuff: { key: 'atkDown', base: 18, per: 4, dur: 6 } } },
  deathCurse:   { name: '死亡詛咒', emoji: '⚰️', cat: 'special', cost: 40, cd: 20,
    flavor: '以敵人生命為薪的詛咒。', fx: { maxHpDotPct: { base: 1.2, per: 0.4 }, dotDur: 5 } },
  blinkDodge:   { name: '瞬身', emoji: '🌀', cat: 'special', cost: 20, cd: 16,
    flavor: '殘影閃避致命攻擊。', fx: { buff: { key: 'evasionUp', base: 35, per: 7, dur: 3 } } },
  mpSiphon:     { name: '法力虹吸', emoji: '🌊', cat: 'special', cost: 0, cd: 12,
    flavor: '從敵人身上抽取法力（不耗魔）。', fx: { dmgType: 'magic', stat: 'matk', base: 80, per: 16, mpRestore: 25 } },
  overload:     { name: '超載', emoji: '💥', cat: 'special', cost: 30, cd: 22,
    flavor: '讓每次爆擊更加致命。', fx: { buff: { key: 'critDmgUp', base: 40, per: 12, dur: 6 } } },
  warcry:       { name: '戰吼', emoji: '📣', cat: 'special', cost: 25, cd: 18,
    flavor: '震天的吼聲鼓舞自己、震懾敵人。', fx: { buff: { key: 'atkUp', base: 12, per: 4, dur: 6 }, debuff: { key: 'atkDown', base: 8, per: 2, dur: 6 } } },
  gamble:       { name: '孤注一擲', emoji: '🎲', cat: 'special', cost: 30, cd: 15,
    flavor: '傷害在 50%~250% 之間隨機。', fx: { dmgType: 'phys', stat: 'atk', base: 150, per: 35, gamble: true } },

  /* ================ 被動（10） ================ */
  toughness:    { name: '堅韌體魄', emoji: '🪨', cat: 'passive', flavor: '生命上限提升。',
    fx: { passive: { hpPct: 5 } } },
  sharpBlade:   { name: '利刃專精', emoji: '⚔️', cat: 'passive', flavor: '物理攻擊提升。',
    fx: { passive: { atkPct: 4 } } },
  arcaneMind:   { name: '奧術心智', emoji: '🧠', cat: 'passive', flavor: '魔法攻擊提升。',
    fx: { passive: { matkPct: 4 } } },
  swiftness:    { name: '迅捷步伐', emoji: '💨', cat: 'passive', flavor: '攻擊速度提升。',
    fx: { passive: { aspdPct: 2 } } },
  keenEye:      { name: '銳眼', emoji: '👁️', cat: 'passive', flavor: '暴擊率提升。',
    fx: { passive: { critRate: 2 } } },
  brutality:    { name: '殘暴', emoji: '💢', cat: 'passive', flavor: '暴擊傷害提升。',
    fx: { passive: { critDmg: 8 } } },
  vampirism:    { name: '嗜血本能', emoji: '🧛', cat: 'passive', flavor: '吸血提升。',
    fx: { passive: { lifesteal: 1.5 } } },
  meditation:   { name: '冥想', emoji: '🧘', cat: 'passive', flavor: '法力上限與回復提升。',
    fx: { passive: { mpFlat: 20, mpRegen: 1 } } },
  ironSkin:     { name: '鋼鐵之膚', emoji: '🛡️', cat: 'passive', flavor: '物理與魔法防禦提升。',
    fx: { passive: { defPct: 5 } } },
  fortuneFavor: { name: '財運亨通', emoji: '🍀', cat: 'passive', flavor: '金幣與經驗獲取提升。',
    fx: { passive: { goldBonus: 5, xpBonus: 5 } } }
};

/* ================ 里程碑解鎖（豐富技能成長） ================
   前期升級只加基礎數值；達到指定等級解鎖附加效果；更高等級強化該效果。
   欄位為淺層覆蓋（同名欄位以高等級版本為準）。                        */
var UNLOCKS = {
  // 物理
  powerSlash:    { 4: { stunDur: 0.5 }, 8: { stunDur: 1, critBonus: 15 } },
  doubleStrike:  { 4: { hits: 3 }, 8: { hits: 3, healPctOfDmg: 12 } },
  whirlwind:     { 4: { slowDur: 2 }, 8: { slowDur: 3, debuff: { key: 'defDown', base: 10, per: 2, dur: 4 } } },
  armorBreak:    { 4: { debuff: { key: 'defDown', base: 35, per: 6, dur: 6 } }, 8: { debuff: { key: 'defDown', base: 45, per: 7, dur: 8 }, stunDur: 0.5 } },
  executeStrike: { 4: { execBelow: 40 }, 8: { execBelow: 50, execMult: 2.5 } },
  rendWound:     { 4: { dot: { pct: 40, dur: 6, name: '流血' } }, 8: { dot: { pct: 55, dur: 7, name: '流血' }, healPctOfDmg: 15 } },
  stunBlow:      { 4: { stunDur: 2 }, 8: { stunDur: 2.5, debuff: { key: 'atkDown', base: 10, per: 2, dur: 4 } } },
  berserkStrike: { 4: { critBonus: 20 }, 8: { selfDmgPct: 3, critBonus: 35 } },
  preciseThrust: { 4: { critBonus: 50 }, 8: { critBonus: 50, execBelow: 25, execMult: 1.8 } },
  heavySmash:    { 4: { slowDur: 4 }, 8: { slowDur: 4, stunDur: 1 } },
  swiftCuts:     { 4: { hits: 4 }, 8: { hits: 5, dot: { pct: 15, dur: 3, name: '流血' } } },
  counterStance: { 4: { buff2: { key: 'blockUp', base: 10, per: 3, dur: 6 } }, 8: { buff: { key: 'thornsUp', base: 20, per: 6, dur: 8 } } },
  // 魔法
  arcaneBurst:   { 4: { mpOnCrit: 15 }, 8: { mpOnCrit: 15, doubleCastPct: 15 } },
  fireball:      { 4: { dot: { pct: 35, dur: 5, name: '燃燒' } }, 8: { dot: { pct: 45, dur: 6, name: '燃燒' }, elem: { type: 'fire', portion: 0.65 } } },
  iceLance:      { 4: { slowDur: 4 }, 8: { slowDur: 4, stunDur: 0.8 } },
  chainLightning:{ 4: { hits: 3 }, 8: { hits: 3, doubleCastPct: 20 } },
  venomCloud:    { 4: { dot: { pct: 55, dur: 7, name: '中毒' } }, 8: { dot: { pct: 65, dur: 8, name: '中毒' }, debuff: { key: 'atkDown', base: 12, per: 2, dur: 5 } } },
  holySmite:     { 4: { healPctMax: { base: 4, per: 1 } }, 8: { healPctMax: { base: 6, per: 1.5 }, buff: { key: 'atkUp', base: 8, per: 2, dur: 5 } } },
  shadowBolt:    { 4: { healPctOfDmg: 45 }, 8: { healPctOfDmg: 55, dot: { pct: 25, dur: 4, name: '侵蝕' } } },
  arcaneBarrage: { 4: { hits: 5 }, 8: { hits: 6, mpOnCrit: 10 } },
  meteor:        { 4: { dot: { pct: 30, dur: 5, name: '燃燒' } }, 8: { dot: { pct: 40, dur: 6, name: '燃燒' }, stunDur: 1.2 } },
  manaBurn:      { 4: { mpOnCrit: 35 }, 8: { mpOnCrit: 40, debuff: { key: 'defDown', base: 15, per: 3, dur: 5 } } },
  frostNova:     { 4: { stunDur: 1.5 }, 8: { stunDur: 1.5, slowDur: 4, elem: { type: 'ice', portion: 0.5 } } },
  voidRift:      { 4: { execBelow: 30, execMult: 1.5 }, 8: { execBelow: 30, execMult: 1.5, doubleCastPct: 15 } },
  // 防禦與治療
  healWound:     { 4: { selfCleanse: true }, 8: { buff: { key: 'defUp', base: 15, per: 3, dur: 4 } } },
  regenerate:    { 4: { hotDur: 8 }, 8: { hotPct: { base: 4, per: 1 }, hotDur: 8 } },
  manaBarrier:   { 4: { shieldPctMax: { base: 24, per: 5 } }, 8: { shieldPctMax: { base: 28, per: 6 }, buff: { key: 'blockUp', base: 10, per: 2, dur: 6 } } },
  ironWall:      { 4: { buff2: { key: 'thornsUp', base: 8, per: 2, dur: 6 } }, 8: { buff: { key: 'defUp', base: 55, per: 12, dur: 8 } } },
  purify:        { 4: { healPctMax: { base: 8, per: 2 } }, 8: { buff: { key: 'evasionUp', base: 15, per: 3, dur: 3 } } },
  lifeLink:      { 4: { healPctOfDmg: 130 }, 8: { healPctOfDmg: 150, dot: { pct: 30, dur: 4, name: '侵蝕' } } },
  sanctuary:     { 4: { buff2: { key: 'defUp', base: 15, per: 3, dur: 5 } }, 8: { buff: { key: 'evasionUp', base: 35, per: 6, dur: 6 } } },
  secondWind:    { 4: { mpRestore: 40 }, 8: { mpRestore: 50, healPctMax: { base: 16, per: 4 } } },
  reflectShield: { 4: { shieldPctMax: { base: 8, per: 2 } }, 8: { buff: { key: 'thornsUp', base: 25, per: 6, dur: 8 } } },
  lastStand:     { 4: { buff2: { key: 'aspdUp', base: 15, per: 3, dur: 6 } }, 8: { healPctMax: { base: 30, per: 6 } } },
  // 特殊
  timeWarp:      { 4: { buff2: { key: 'evasionUp', base: 10, per: 2, dur: 6 } }, 8: { buff: { key: 'aspdUp', base: 40, per: 9, dur: 7 } } },
  midasTouch:    { 4: { goldPer: 25 }, 8: { goldPer: 35, buff: { key: 'lootUp', base: 15, per: 3, dur: 5 } } },
  treasureSense: { 4: { buff: { key: 'lootUp', base: 45, per: 12, dur: 12 } }, 8: { goldPer: 10 } },
  weakenCurse:   { 4: { slowDur: 2 }, 8: { debuff: { key: 'atkDown', base: 28, per: 5, dur: 8 } } },
  deathCurse:    { 4: { dotDur: 7 }, 8: { maxHpDotPct: { base: 1.8, per: 0.5 }, dotDur: 7 } },
  blinkDodge:    { 4: { buff: { key: 'evasionUp', base: 45, per: 8, dur: 4 } }, 8: { buff2: { key: 'aspdUp', base: 12, per: 3, dur: 4 } } },
  mpSiphon:      { 4: { mpRestore: 40 }, 8: { mpRestore: 45, debuff: { key: 'atkDown', base: 10, per: 2, dur: 4 } } },
  overload:      { 4: { buff2: { key: 'atkUp', base: 8, per: 2, dur: 6 } }, 8: { buff: { key: 'critDmgUp', base: 60, per: 15, dur: 8 } } },
  warcry:        { 4: { debuff: { key: 'atkDown', base: 12, per: 3, dur: 6 } }, 8: { buff: { key: 'atkUp', base: 18, per: 5, dur: 8 } } },
  gamble:        { 4: { critBonus: 20 }, 8: { critBonus: 20, execBelow: 35, execMult: 2 } }
};

// 取得指定等級的實際效果（基礎 fx + 已達標的里程碑覆蓋）
function effectiveFx(id, def, lv) {
  var base = def.fx;
  var patches = UNLOCKS[id];
  if (!patches) return base;
  var fx = {};
  var k;
  for (k in base) fx[k] = base[k];
  var lvs = Object.keys(patches).map(Number).sort(function (a, b) { return a - b; });
  for (var i = 0; i < lvs.length; i++) {
    if (lv >= lvs[i]) {
      var p = patches[lvs[i]];
      for (k in p) fx[k] = p[k];
    }
  }
  return fx;
}
// 下一個里程碑等級（無則回傳 0）
function nextUnlockLv(id, lv) {
  var patches = UNLOCKS[id];
  if (!patches) return 0;
  var lvs = Object.keys(patches).map(Number).sort(function (a, b) { return a - b; });
  for (var i = 0; i < lvs.length; i++) if (lv < lvs[i]) return lvs[i];
  return 0;
}

/* ---- 技能點（由等級直接推導，杜絕漏發） ----
   總點數 = 等級 - 1；已花費 = 所有已學技能等級總和 - 2（初始兩個免費 1 級技能） */
// 初始免費技能額度：僅在仍持有該起始技能時計入（防止降級套利）
function freeStarterCredit() {
  return (skillLevel('powerSlash') > 0 ? 1 : 0) + (skillLevel('arcaneBurst') > 0 ? 1 : 0);
}
function totalSkillPoints() { return Math.max(0, G.player.level - 1); }
function spentSkillPoints() {
  var spent = 0;
  if (G.player.skills) {
    for (var id in G.player.skills) spent += G.player.skills[id];
  }
  return Math.max(0, spent - freeStarterCredit());
}
function availableSkillPoints() { return Math.max(0, totalSkillPoints() - spentSkillPoints()); }

/* ---- 查詢（skillValue / skillCdFor / scaleAt → js/formula.js §9） ---- */
function skillLevel(id) { return (G.player.skills && G.player.skills[id]) || 0; }

/* ---- 技能樹階層（每 4 個為一階，需在該系投入足夠點數） ---- */
function skillTier(id) {
  var sk = SKILLS[id];
  if (!sk) return 0;
  var idx = 0;
  for (var k in SKILLS) {
    if (SKILLS[k].cat !== sk.cat) continue;
    if (k === id) break;
    idx++;
  }
  return Math.floor(idx / 4);
}
function catSpentPoints(cat) {
  var sum = 0;
  for (var id in G.player.skills) {
    var sk = SKILLS[id];
    if (sk && sk.cat === cat) sum += G.player.skills[id];
  }
  return sum;
}
// 回傳 null=可學，否則鎖定原因
function tierLockReason(id) {
  var sk = SKILLS[id];
  if (!sk) return null; // 融合技不受階層限制
  var need = skillTier(id) * TIER_GATE_POINTS;
  if (skillLevel(id) > 0) return null; // 已學會的不再鎖
  if (catSpentPoints(sk.cat) < need) return '需先在' + SKILL_CATS[sk.cat].name + '系投入 ' + need + ' 點（目前 ' + catSpentPoints(sk.cat) + '）';
  return null;
}

/* ---- 學習 / 升級 / 裝載 ---- */
function learnOrUpgradeSkill(id) {
  var sk = skillDef(id);
  if (!sk) return '未知技能';
  var lv = skillLevel(id);
  if (lv >= skillMaxLv(sk)) return '已達最高等級';
  var cost = skillUpgradeCost(lv);
  if (G.player.gold < cost) return '金幣不足（需要 ' + fmt(cost) + '）';
  var lock = tierLockReason(id);
  if (lock) return lock;
  G.player.gold -= cost;
  G.player.skills[id] = lv + 1;
  if (sk.cat === 'passive') markStatsDirty();
  UI.dirty.skills = true; UI.dirty.header = true;
  var newFx = UNLOCKS[id] && UNLOCKS[id][lv + 1];
  blog((lv === 0 ? '📖 學會技能' : '⬆️ 技能升級') + '：' + sk.emoji + sk.name + ' Lv.' + (lv + 1) + '（消耗 ' + fmt(cost) + ' 金幣）' +
    (newFx ? ' <span class="log-hl-good">✨解鎖新效果！</span>' : ''), 'good');
  return null;
}
// 降級：退回 1 級並歸還消耗金幣（降至 0 = 遺忘；融合技最低 Lv.1，移除請用刪除）
function downgradeSkill(id) {
  var sk = skillDef(id);
  if (!sk) return '未知技能';
  var lv = skillLevel(id);
  if (!lv) return '尚未學習';
  if (sk.cat === 'fusion' && lv <= 1) return '融合技最低為 Lv.1，如要移除請使用「刪除」';
  var nl = lv - 1;
  var refund = skillUpgradeCost(nl);
  G.player.gold += refund;
  if (nl <= 0) {
    delete G.player.skills[id];
    unequipSkillFromLoadout(id);
    if (UI.fuseSlots) {
      var fi = UI.fuseSlots.indexOf(id);
      if (fi >= 0) UI.fuseSlots.splice(fi, 1);
    }
    blog('↩️ 已遺忘技能：' + sk.emoji + sk.name + '（歸還 ' + fmt(refund) + ' 金幣）', 'info');
  } else {
    G.player.skills[id] = nl;
    blog('⬇️ 技能降級：' + sk.emoji + sk.name + ' Lv.' + nl + '（歸還 ' + fmt(refund) + ' 金幣）', 'info');
  }
  if (sk.cat === 'passive') markStatsDirty();
  UI.dirty.skills = true; UI.dirty.header = true;
  return null;
}

function equipSkillToLoadout(id) {
  var sk = skillDef(id);
  if (!sk || sk.cat === 'passive') return '被動技能無需裝備';
  if (!skillLevel(id)) return '尚未學習';
  var lo = G.player.loadout;
  if (lo.indexOf(id) >= 0) return '已在裝載欄';
  if (lo.length >= loadoutSize()) return '裝載欄已滿（' + loadoutSize() + ' 格，每 20 級 +1 格）';
  lo.push(id);
  UI.dirty.skills = true;
  return null;
}
function unequipSkillFromLoadout(id) {
  var lo = G.player.loadout;
  var i = lo.indexOf(id);
  if (i >= 0) { lo.splice(i, 1); UI.dirty.skills = true; }
}

/* ---- 施放條件（AI）：fx 需傳入等級解析後的效果 ---- */
function skillConditionOk(sk, fx, pEnt, target, st) {
  var hpPct = pEnt.hp / st.hp * 100;
  switch (sk.ai) {
    case 'hurt25': if (hpPct >= 25) return false; break;
    case 'hurt30': if (hpPct >= 30) return false; break;
    case 'hurt40': if (hpPct >= 40) return false; break;
    case 'hurt50': if (hpPct >= 50) return false; break;
    case 'hurt70': if (hpPct >= 70) return false; break;
    case 'hurt80': if (hpPct >= 80) return false; break;
    case 'debuffed':
      if (!effectActive(pEnt, 'stun') && !effectActive(pEnt, 'slow') && !hasDots(pEnt)) return false;
      break;
    case 'shield':
      if ((pEnt.shield || 0) > st.hp * 0.05) return false;
      break;
  }
  // 傷害/減益類需要目標
  if ((fx.dmgType || fx.debuff || fx.maxHpDotPct) && (!target || target.hp <= 0)) return false;
  // 增益不重複疊放
  if (fx.buff && buffVal(pEnt, fx.buff.key) > 0) return false;
  return true;
}

/* ---- 施放執行 ---- */
function castSkill(pEnt, target, id, lv, floatSel) {
  var sk = skillDef(id);
  var fx = effectiveFx(id, sk, lv);
  var st = getStats();
  pEnt.mp -= sk.cost;
  if (!pEnt.skillCds) pEnt.skillCds = {};
  pEnt.skillCds[id] = skillCdFor(sk);
  pEnt.atkCd += SKILL_CAST_LOCK * (1 - st.castSpeed / 100); // 施放硬直
  var out = { killed: false, dmg: 0 };
  var logMsg = sk.emoji + ' 你施放【' + sk.name + ' Lv.' + lv + '】，';
  var parts = [];

  // === 傷害段 ===
  if (fx.dmgType) {
    var baseVal = ((fx.base || 0) + (fx.per || 0) * (lv - 1)) / 100 * (st[fx.stat] || st.atk) * (1 + st.aoeDmg / 100);
    if (fx.gamble) baseVal *= rnd(0.33, 1.67); // 孤注一擲：50%~250% 相對波動
    var hits = fx.hits || 1;
    // 雙重施法（奧術過載等）：追加一段
    if (fx.doubleCastPct && chance(fx.doubleCastPct)) { hits++; parts.push('<span class="log-hl-good">雙重施法！</span>'); }
    var totalDmg = 0, anyCrit = false, allMiss = true;
    for (var h = 0; h < hits; h++) {
      if (target.hp <= 0) break;
      var dmgRes;
      if (fx.dmgType === 'true') {
        // 真實傷害：無視防禦/抗性/格擋
        var td = Math.max(1, Math.round(baseVal * rnd(0.95, 1.05)));
        target.hp -= td;
        dmgRes = { dmg: td, killed: target.hp <= 0, miss: false, crit: false };
        if (dmgRes.killed) target.hp = 0;
      } else {
        // 元素占比：單一 elem 或融合技的 elems 多元素表
        var elemAtk = null, portion = 0;
        if (fx.elems) {
          elemAtk = {};
          for (var ee in fx.elems) { elemAtk[ee] = baseVal * fx.elems[ee]; portion += fx.elems[ee]; }
        } else if (fx.elem) {
          portion = fx.elem.portion;
          elemAtk = {};
          elemAtk[fx.elem.type] = baseVal * portion;
        }
        portion = Math.min(portion, 0.8);
        var aCfg = {
          atk: baseVal * (1 - portion), dmgType: fx.dmgType, level: st.level,
          critRate: st.critRate + (fx.critBonus || 0), critDmg: st.critDmg,
          hit: fx.neverMiss ? 999 : 100, pen: fx.dmgType === 'magic' ? st.mPen : st.pPen,
          elemAtk: elemAtk, eliteDmg: st.eliteDmg, bossDmg: st.bossDmg, isPlayer: true
        };
        // 處決：低血量加成
        if (fx.execBelow && target.hp / target.maxHp * 100 < fx.execBelow) aCfg.atk *= (fx.execMult || 2);
        dmgRes = resolveHit(pEnt, target, aCfg, monsterDefCfg(target));
      }
      if (!dmgRes.miss) {
        allMiss = false;
        totalDmg += dmgRes.dmg;
        if (dmgRes.crit) anyCrit = true;
        var dmgStr = fmt(dmgRes.dmg);
        if (dmgRes.crit) dmgStr = '爆擊 ' + dmgStr;
        if (dmgRes.blocked) dmgStr = '格擋 ' + dmgStr;
        floatText(floatSel, sk.emoji + dmgStr, dmgRes.crit ? 'crit' : 'dmg');
        trackDps(dmgRes.dmg);
        if (typeof recordRunDamage === 'function') recordRunDamage(sk.name, dmgRes.dmg);
      } else {
        floatText(floatSel, 'MISS', 'miss');
      }
      if (dmgRes.killed) { out.killed = true; break; }
    }
    // 冰與火之歌：目標同時處於減速與燃燒時引爆
    if (fx.comboDetonate && target.hp > 0 && effectActive(target, 'slow') && targetHasDot(target, '燃燒')) {
      var boom = Math.max(1, Math.round(totalDmg * fx.comboDetonate / 100));
      target.hp -= boom;
      totalDmg += boom;
      floatText(floatSel, '❄️🔥' + fmt(boom), 'crit');
      trackDps(boom);
      parts.push('<span class="log-hl-good">冰火引爆 ' + fmt(boom) + '！</span>');
      if (target.hp <= 0) { target.hp = 0; out.killed = true; }
    }
    out.dmg = totalDmg;
    if (allMiss) parts.push('<span class="log-hl-bad">被閃避了！</span>');
    else parts.push((anyCrit ? '<span class="log-hl-good">爆擊</span>' : '') + '造成 ' + fmt(totalDmg) + (hits > 1 ? '（' + hits + ' 段）' : '') + ' 傷害');
    // 命中後效果
    if (totalDmg > 0) {
      if (fx.healPctOfDmg) { healPlayer(pEnt, totalDmg * fx.healPctOfDmg / 100, st); parts.push('<span class="log-hl-good">汲取 ' + fmt(totalDmg * fx.healPctOfDmg / 100) + ' 生命</span>'); }
      if (fx.mpOnCrit && anyCrit) { pEnt.mp = Math.min(st.mp, pEnt.mp + fx.mpOnCrit); parts.push('返還 ' + fx.mpOnCrit + ' 法力'); }
      if (fx.goldPer) { var gg = Math.round(fx.goldPer * lv * st.level); G.player.gold += gg; parts.push('<span class="log-hl-good">獲得 ' + fmt(gg) + ' 金幣</span>'); UI.dirty.header = true; }
      if (fx.dot && target.hp > 0) { applyDot(target, baseVal * fx.dot.pct / 100, fx.dot.dur, fx.dot.name); parts.push('附加' + fx.dot.name); }
      if (fx.dotList && target.hp > 0) {
        for (var dl = 0; dl < fx.dotList.length; dl++) {
          var dd = fx.dotList[dl];
          applyDot(target, baseVal * dd.pct / 100, dd.dur, dd.name);
          parts.push('附加' + dd.name);
        }
      }
      if (fx.stunDur && target.hp > 0 && !resistCtrl(monsterDefCfg(target))) { applyEffect(target, 'stun', fx.stunDur); parts.push('<span class="log-hl-good">暈眩 ' + fx.stunDur + ' 秒</span>'); }
      if (fx.slowDur && target.hp > 0 && !resistCtrl(monsterDefCfg(target))) { applyEffect(target, 'slow', fx.slowDur); parts.push('減速'); }
      if (st.manaSteal > 0) pEnt.mp = Math.min(st.mp, pEnt.mp + totalDmg * st.manaSteal / 100);
      if (st.lifesteal > 0) healPlayer(pEnt, totalDmg * st.lifesteal / 100, st);
    }
  }
  // === 非傷害效果 ===
  if (fx.healPctMax) { var hv = st.hp * scaleAt(fx.healPctMax, lv) / 100; healPlayer(pEnt, hv, st); parts.push('<span class="log-hl-good">回復 ' + fmt(hv) + ' 生命</span>'); }
  if (fx.hotPct) { applyBuff(pEnt, 'hot', scaleAt(fx.hotPct, lv), fx.hotDur); parts.push('<span class="log-hl-good">持續再生 ' + fx.hotDur + ' 秒</span>'); }
  if (fx.shieldPctMax) {
    var sv = st.hp * scaleAt(fx.shieldPctMax, lv) / 100 * (1 + st.shieldEff / 100);
    pEnt.shield = Math.min(st.hp * 0.5, (pEnt.shield || 0) + sv);
    parts.push('<span class="log-hl-good">獲得 ' + fmt(sv) + ' 護盾</span>');
  }
  if (fx.selfCleanse) { cleanse(pEnt); parts.push('淨化負面狀態'); }
  if (fx.mpRestore) { pEnt.mp = Math.min(st.mp, pEnt.mp + fx.mpRestore); parts.push('回復 ' + fx.mpRestore + ' 法力'); }
  if (fx.buff) { applyBuff(pEnt, fx.buff.key, scaleAt(fx.buff, lv), fx.buff.dur); parts.push('<span class="log-hl-good">' + buffLabel(fx.buff.key) + ' +' + fmt1(scaleAt(fx.buff, lv)) + '%（' + fx.buff.dur + '秒）</span>'); }
  if (fx.buff2) { applyBuff(pEnt, fx.buff2.key, scaleAt(fx.buff2, lv), fx.buff2.dur); }
  if (fx.debuff && target && target.hp > 0) { applyBuff(target, fx.debuff.key, scaleAt(fx.debuff, lv), fx.debuff.dur); parts.push('<span class="log-hl-bad">敵方' + buffLabel(fx.debuff.key) + ' -' + fmt1(scaleAt(fx.debuff, lv)) + '%</span>'); }
  if (fx.maxHpDotPct && target && target.hp > 0) {
    // 死亡詛咒：以敵方最大生命為基準的跳傷（對高血量目標設上限）
    var cdps = Math.min(target.maxHp * scaleAt(fx.maxHpDotPct, lv) / 100, st.matk * 3);
    applyDot(target, cdps, fx.dotDur || 5, '詛咒');
    parts.push('<span class="log-hl-bad">附加死亡詛咒</span>');
  }

  blog(logMsg + parts.join('，') + '。', 'dim-text', 'combat');
  UI.dirty.battle = true;
  return out;
}

// 目標是否帶有指定名稱的持續傷害
function targetHasDot(ent, name) {
  if (!ent.dots) return false;
  for (var i = 0; i < ent.dots.length; i++) {
    if (ent.dots[i].name === name && ent.dots[i].until > GT) return true;
  }
  return false;
}

// 依裝載順序挑一個可施放的技能（每 tick 至多一個）
function pickAndCastSkill(pEnt, target, floatSel) {
  var st = getStats();
  if (!pEnt.skillCds) pEnt.skillCds = {};
  var lo = G.player.loadout || [];
  for (var i = 0; i < lo.length; i++) {
    var id = lo[i];
    var sk = skillDef(id);
    var lv = skillLevel(id);
    if (!sk || !lv) continue;
    if ((pEnt.skillCds[id] || 0) > 0) continue;
    if (pEnt.mp < sk.cost) continue;
    if (!skillConditionOk(sk, effectiveFx(id, sk, lv), pEnt, target, st)) continue;
    return castSkill(pEnt, target, id, lv, floatSel);
  }
  return null;
}
function tickSkillCds(pEnt, dt) {
  if (!pEnt.skillCds) return;
  for (var k in pEnt.skillCds) {
    if (pEnt.skillCds[k] > 0) pEnt.skillCds[k] -= dt;
  }
}

/* ================ 技能融合系統 ================
   2~4 個已學習的主動技能 → 融合技：繼承素材的部分效果（以素材當前等級的
   完整效果為準，含里程碑），並有機率誕生一種變異效果。
   初始等級 = 素材等級加總，可再升 20 級；素材歸零可重學；
   刪除融合技時（點數採等級推導制）所有投入點數自動歸還。
   （FUSE_FACTOR、FUSION_MUTATION_CHANCE 等融合參數 → js/formula.js §9） */

// 變異效果池（req 檢查與融合結果的關聯性；apply 直接改寫 fx；存檔只存 key/name/desc）
var FUSION_MUTATIONS = [
  { key: 'iceFireSong', name: '冰與火之歌', desc: '目標同時處於減速（冰）與燃燒狀態時，引發冰爆追加 100% 傷害',
    req: function (fx) { return fx.elems && fx.elems.fire && fx.elems.ice; },
    apply: function (fx) { fx.comboDetonate = 100; } },
  { key: 'lifeResonance', name: '生命共鳴', desc: '此技能傷害的 25% 額外轉化為生命回復',
    req: function (fx) { return fx.dmgType && (fx.healPctMax || fx.hotPct || fx.healPctOfDmg); },
    apply: function (fx) { fx.healPctOfDmg = (fx.healPctOfDmg || 0) + 25; } },
  { key: 'thunderEcho', name: '雷鳴回響', desc: '雷霆之力殘響不散：25% 機率雙重施法',
    req: function (fx) { return fx.elems && fx.elems.lightning; },
    apply: function (fx) { fx.doubleCastPct = (fx.doubleCastPct || 0) + 25; } },
  { key: 'venomBloom', name: '劇毒綻放', desc: '所有持續傷害效果威力 +50%',
    req: function (fx) { return fx.dotList && fx.dotList.length; },
    apply: function (fx) { fx.dotList.forEach(function (d) { d.pct = Math.round(d.pct * 1.5); }); } },
  { key: 'timeRipple', name: '時空漣漪', desc: '附帶的增益效果持續時間變為兩倍',
    req: function (fx) { return !!fx.buff; },
    apply: function (fx) { if (fx.buff) fx.buff.dur *= 2; if (fx.buff2) fx.buff2.dur *= 2; } },
  { key: 'reapInstinct', name: '收割本能', desc: '嗜血的融合本能：目標血量低於 25% 時傷害 x2',
    req: function (fx) { return fx.dmgType && fx.dmgType !== 'true'; },
    apply: function (fx) { fx.execBelow = Math.max(fx.execBelow || 0, 25); fx.execMult = Math.max(fx.execMult || 0, 2); } },
  { key: 'guardEmber', name: '守護餘燼', desc: '融合的殘餘能量凝為屏障：施放時額外獲得最大生命 8% 的護盾',
    req: function (fx) { return !!(fx.shieldPctMax || fx.healPctMax || fx.buff); },
    apply: function (fx) { if (!fx.shieldPctMax) fx.shieldPctMax = { base: 8, per: 1 }; } },
  { key: 'manaVortex', name: '法力漩渦', desc: '融合亂流回饋法力：施放後回復 30 點法力',
    req: function () { return true; },
    apply: function (fx) { fx.mpRestore = (fx.mpRestore || 0) + 30; } }
];

// 融合技命名：以元素/性質取字
function fusionName(comps, fx) {
  var chars = [];
  if (fx.elems) for (var e in fx.elems) { var ch = ELEM_INFO[e].name.charAt(0); if (chars.indexOf(ch) < 0) chars.push(ch); }
  if (!chars.length) {
    if (fx.stat === 'matk') chars.push('奧');
    else if (fx.dmgType) chars.push('武');
    if (fx.healPctMax || fx.hotPct) chars.push('聖');
    if (fx.buff) chars.push('靈');
  }
  chars = chars.slice(0, 3);
  var suffix = fx.dmgType === 'true' ? '虛空奧義' : (fx.dmgType === 'magic' ? '衝擊彈' : (fx.dmgType ? '斬擊' : (fx.healPctMax || fx.hotPct ? '聖歌' : '祕法')));
  return (chars.join('') || '混沌') + '融合·' + suffix;
}

// 執行融合；回傳 null=成功，否則錯誤訊息
function fuseSkills(ids) {
  if (!ids || ids.length < 2) return '至少需要 2 個素材技能';
  if (ids.length > 4) return '最多 4 個素材技能';
  var comps = [], totalLv = 0, i;
  for (i = 0; i < ids.length; i++) {
    var d = SKILLS[ids[i]];
    if (!d) return '融合技不能作為素材';
    if (d.cat === 'passive') return '被動技能無法融合';
    var lv = skillLevel(ids[i]);
    if (!lv) return '素材技能「' + d.name + '」尚未學習';
    comps.push({ id: ids[i], def: d, lv: lv, fx: effectiveFx(ids[i], d, lv) });
    totalLv += lv;
  }
  var fx = {};
  // --- 傷害合併（各取 60% 相加；屬性採多數決）---
  var dmgComps = comps.filter(function (c) { return c.fx.dmgType; });
  if (dmgComps.length) {
    var base = 0, per = 0, matkVotes = 0, hits = 1, anyTrue = false;
    dmgComps.forEach(function (c) {
      base += (c.fx.base || 0) * FUSE_FACTOR;
      per += (c.fx.per || 0) * FUSE_FACTOR;
      if (c.fx.stat === 'matk') matkVotes++;
      if (c.fx.dmgType === 'true') anyTrue = true;
      hits = Math.max(hits, c.fx.hits || 1);
    });
    fx.dmgType = anyTrue ? 'true' : (matkVotes * 2 >= dmgComps.length ? 'magic' : 'phys');
    fx.stat = (matkVotes * 2 >= dmgComps.length) ? 'matk' : 'atk';
    fx.base = Math.round(base);
    fx.per = Math.round(per * 10) / 10;
    if (hits > 1) fx.hits = Math.min(hits, 4);
  }
  // --- 元素合併 ---
  var elems = {};
  comps.forEach(function (c) {
    if (c.fx.elem) elems[c.fx.elem.type] = (elems[c.fx.elem.type] || 0) + c.fx.elem.portion * FUSE_FACTOR;
    if (c.fx.elems) for (var e in c.fx.elems) elems[e] = (elems[e] || 0) + c.fx.elems[e] * FUSE_FACTOR;
  });
  if (Object.keys(elems).length) {
    for (var e2 in elems) elems[e2] = Math.round(elems[e2] * 100) / 100;
    fx.elems = elems;
  }
  // --- 持續傷害（同名取高，最多 2 種）---
  var dmap = {};
  comps.forEach(function (c) {
    var list = [];
    if (c.fx.dot) list.push(c.fx.dot);
    if (c.fx.dotList) list = list.concat(c.fx.dotList);
    list.forEach(function (dd) {
      var nd = { pct: Math.round(dd.pct * 0.7), dur: dd.dur, name: dd.name };
      if (!dmap[nd.name] || dmap[nd.name].pct < nd.pct) dmap[nd.name] = nd;
    });
  });
  var dlist = Object.keys(dmap).map(function (k) { return dmap[k]; }).slice(0, 2);
  if (dlist.length) fx.dotList = dlist;
  // --- 控場 / 治療 / 護盾 / 其他（擇優或加總後打折）---
  var agg = { stun: 0, slow: 0, healB: 0, healP: 0, hotB: 0, hotP: 0, hotDur: 0, shB: 0, shP: 0,
    hpod: 0, mpRestore: 0, mpOnCrit: 0, goldPer: 0, critBonus: 0, execB: 0, execM: 0 };
  var buffs = [], debuff = null, maxHpDot = null;
  comps.forEach(function (c) {
    var f = c.fx;
    agg.stun = Math.max(agg.stun, f.stunDur || 0);
    agg.slow = Math.max(agg.slow, f.slowDur || 0);
    if (f.healPctMax) { agg.healB += scaleAt(f.healPctMax, 1) * FUSE_FACTOR; agg.healP += (f.healPctMax.per || 0) * FUSE_FACTOR; }
    if (f.hotPct) { agg.hotB += scaleAt(f.hotPct, 1) * FUSE_FACTOR; agg.hotP += (f.hotPct.per || 0) * FUSE_FACTOR; agg.hotDur = Math.max(agg.hotDur, f.hotDur || 5); }
    if (f.shieldPctMax) { agg.shB += scaleAt(f.shieldPctMax, 1) * FUSE_FACTOR; agg.shP += (f.shieldPctMax.per || 0) * FUSE_FACTOR; }
    agg.hpod += (f.healPctOfDmg || 0) * 0.7;
    agg.mpRestore += (f.mpRestore || 0) * 0.7;
    agg.mpOnCrit = Math.max(agg.mpOnCrit, f.mpOnCrit || 0);
    agg.goldPer += (f.goldPer || 0) * 0.6;
    agg.critBonus = Math.max(agg.critBonus, (f.critBonus || 0) * 0.8);
    agg.execB = Math.max(agg.execB, f.execBelow || 0);
    agg.execM = Math.max(agg.execM, f.execMult || 0);
    if (f.neverMiss) fx.neverMiss = true;
    if (f.selfCleanse) fx.selfCleanse = true;
    if (f.buff) buffs.push(f.buff);
    if (f.buff2) buffs.push(f.buff2);
    if (f.debuff && !debuff) debuff = f.debuff;
    if (f.maxHpDotPct && !maxHpDot) maxHpDot = f;
  });
  if (agg.stun) fx.stunDur = Math.round(agg.stun * 0.8 * 10) / 10;
  if (agg.slow) fx.slowDur = Math.round(agg.slow * 0.8 * 10) / 10;
  if (agg.healB) fx.healPctMax = { base: Math.round(agg.healB * 10) / 10, per: Math.round(agg.healP * 10) / 10 };
  if (agg.hotB) { fx.hotPct = { base: Math.round(agg.hotB * 10) / 10, per: Math.round(agg.hotP * 10) / 10 }; fx.hotDur = agg.hotDur; }
  if (agg.shB) fx.shieldPctMax = { base: Math.round(agg.shB * 10) / 10, per: Math.round(agg.shP * 10) / 10 };
  if (agg.hpod) fx.healPctOfDmg = Math.min(100, Math.round(agg.hpod));
  if (agg.mpRestore) fx.mpRestore = Math.round(agg.mpRestore);
  if (agg.mpOnCrit) fx.mpOnCrit = Math.round(agg.mpOnCrit);
  if (agg.goldPer) fx.goldPer = Math.round(agg.goldPer);
  if (agg.critBonus) fx.critBonus = Math.round(agg.critBonus);
  if (agg.execB) { fx.execBelow = agg.execB; fx.execMult = agg.execM || 2; }
  if (buffs[0]) fx.buff = { key: buffs[0].key, base: Math.round(buffs[0].base * 0.8), per: buffs[0].per, dur: buffs[0].dur };
  if (buffs[1]) fx.buff2 = { key: buffs[1].key, base: Math.round(buffs[1].base * 0.8), per: buffs[1].per, dur: buffs[1].dur };
  if (debuff) fx.debuff = { key: debuff.key, base: Math.round(debuff.base * 0.8), per: debuff.per, dur: debuff.dur };
  if (maxHpDot) { fx.maxHpDotPct = { base: Math.round(maxHpDot.maxHpDotPct.base * 0.7 * 10) / 10, per: maxHpDot.maxHpDotPct.per }; fx.dotDur = maxHpDot.dotDur || 5; }

  // --- 變異效果（每次至多一種，需與融合結果相關；觸發率公式 → formula.js §9）---
  var mutation = null;
  if (chance(fusionMutationChance())) {
    var pool = FUSION_MUTATIONS.filter(function (m) { return m.req(fx); });
    if (pool.length) {
      var m = pick(pool);
      m.apply(fx);
      mutation = { key: m.key, name: m.name, desc: m.desc };
    }
  }

  var cost = Math.round(comps.reduce(function (s, c) { return s + (c.def.cost || 0); }, 0) * FUSION_COST_FACTOR);
  var cd = Math.round(Math.max.apply(null, comps.map(function (c) { return c.def.cd || 8; })) * FUSION_CD_FACTOR);
  var def = {
    id: 'fusion_' + uid(), name: fusionName(comps, fx), emoji: '🧬', cat: 'fusion',
    cost: cost, cd: cd, maxLv: totalLv + 20, components: ids.slice(),
    mutation: mutation, flavor: '由 ' + comps.map(function (c) { return c.def.name; }).join('、') + ' 融合而成的專屬奧義。',
    fx: fx
  };
  if (!G.player.fusions) G.player.fusions = [];
  G.player.fusions.push(def);
  G.player.skills[def.id] = totalLv;          // 初始等級 = 素材等級加總
  ids.forEach(function (cid) {                 // 素材歸零、卸下
    delete G.player.skills[cid];
    unequipSkillFromLoadout(cid);
  });
  markStatsDirty();
  UI.dirty.skills = true; UI.dirty.header = true;
  blog('⚗️ <span class="log-hl-good">技能融合成功！</span>誕生【🧬' + def.name + '】Lv.' + totalLv +
    (mutation ? '，並覺醒變異效果<span class="log-hl-good">【' + mutation.name + '】</span>！' : '（未觸發變異）'), 'good');
  return null;
}

// 刪除融合技：等級推導制下，所有投入點數（含融合轉移與後續升級）自動歸還
function deleteFusion(id) {
  var fs = G.player.fusions || [];
  for (var i = 0; i < fs.length; i++) {
    if (fs[i].id === id) {
      var refund = skillLevel(id);
      fs.splice(i, 1);
      delete G.player.skills[id];
      unequipSkillFromLoadout(id);
      UI.dirty.skills = true; UI.dirty.header = true;
      blog('🗑️ 已刪除融合技，歸還 ' + refund + ' 點技能點（可用於重新學習素材技能）', 'info');
      return null;
    }
  }
  return '找不到該融合技';
}

/* ---- 說明文字生成 ---- */
function buffLabel(key) {
  return ({ atkUp: '攻擊', defUp: '防禦', aspdUp: '攻速', evasionUp: '閃避', critDmgUp: '爆傷',
    lootUp: '掉寶', thornsUp: '反震', blockUp: '格擋', hot: '再生',
    atkDown: '攻擊', defDown: '防禦' })[key] || key;
}
function describeSkill(id, lv) {
  var sk = skillDef(id);
  if (!sk) return '';
  lv = Math.max(1, lv || 1);
  var fx = effectiveFx(id, sk, lv);
  
  function growStr(v) { return '<span class="txt-grow">' + v + '</span>'; }
  function statStr(v) { return '<span class="txt-static">' + v + '</span>'; }
  function scaleStr(defObj, lvArg) {
    var val = scaleAt(defObj, lvArg);
    return (defObj && defObj.per) ? growStr(fmt1(val)) : statStr(fmt1(val));
  }
  
  var p = [];
  if (fx.passive) {
    var names = { hpPct: '生命上限', atkPct: '物理攻擊', matkPct: '魔法攻擊', aspdPct: '攻擊速度',
      critRate: '暴擊率', critDmg: '暴擊傷害', lifesteal: '吸血', mpFlat: '法力上限',
      mpRegen: '法力恢復/秒', defPct: '物理/魔法防禦', goldBonus: '金幣獲取', xpBonus: '經驗獲取' };
    for (var k in fx.passive) p.push((names[k] || k) + ' +' + growStr(fmt1(fx.passive[k] * lv)) + (k === 'mpFlat' || k === 'mpRegen' ? '' : '%'));
    return '被動：' + p.join('、');
  }
  if (fx.dmgType) {
    var t = fx.dmgType === 'true' ? '真實' : (fx.dmgType === 'magic' ? '魔法' : '物理');
    var statName = fx.stat === 'matk' ? '魔攻' : '物攻';
    var dVal = (fx.base || 0) + (fx.per || 0) * (lv - 1);
    var dStr = fx.per ? growStr(fmt1(dVal)) : statStr(fmt1(dVal));
    p.push('造成 ' + dStr + '% ' + statName + ' 的' + t + '傷害' + (fx.hits ? ' x' + statStr(fx.hits) + ' 段' : ''));
    if (fx.elem) p.push(ELEM_INFO[fx.elem.type].name + '屬性佔 ' + statStr(Math.round(fx.elem.portion * 100)) + '%');
    if (fx.elems) {
      var eparts = [];
      for (var ek2 in fx.elems) eparts.push(ELEM_INFO[ek2].name + ' ' + statStr(Math.round(fx.elems[ek2] * 100)) + '%');
      p.push('元素屬性：' + eparts.join('、'));
    }
    if (fx.doubleCastPct) p.push(statStr(fx.doubleCastPct) + '% 機率雙重施法');
    if (fx.comboDetonate) p.push('目標同時處於減速與燃燒時，引發冰火爆炸追加 ' + statStr(fx.comboDetonate) + '% 傷害');
    if (fx.execBelow) p.push('目標血量 <' + statStr(fx.execBelow) + '% 時傷害 x' + statStr(fx.execMult));
    if (fx.neverMiss) p.push('必定命中');
    if (fx.critBonus) p.push('此擊暴擊率 +' + statStr(fx.critBonus) + '%');
    if (fx.gamble) p.push('傷害隨機浮動 ±' + statStr(67) + '%');
    if (fx.selfDmgPct) p.push('自身損失 ' + statStr(fx.selfDmgPct) + '% 生命');
    if (fx.healPctOfDmg) p.push('汲取傷害的 ' + statStr(fx.healPctOfDmg) + '% 為生命');
    if (fx.mpOnCrit) p.push('爆擊返還 ' + statStr(fx.mpOnCrit) + ' 法力');
    if (fx.goldPer) p.push('掠奪金幣');
    if (fx.dot) p.push('附加' + fx.dot.name + '（每秒 ' + statStr(fx.dot.pct) + '% 技能傷害，' + statStr(fx.dot.dur) + ' 秒）');
    if (fx.dotList) fx.dotList.forEach(function (dd) { p.push('附加' + dd.name + '（每秒 ' + statStr(dd.pct) + '%，' + statStr(dd.dur) + ' 秒）'); });
    if (fx.stunDur) p.push('暈眩 ' + statStr(fx.stunDur) + ' 秒');
    if (fx.slowDur) p.push('減速 ' + statStr(fx.slowDur) + ' 秒');
  }
  if (fx.healPctMax) p.push('回復 ' + scaleStr(fx.healPctMax, lv) + '% 最大生命');
  if (fx.hotPct) p.push('每秒再生 ' + scaleStr(fx.hotPct, lv) + '% 生命，持續 ' + statStr(fx.hotDur) + ' 秒');
  if (fx.shieldPctMax) p.push('獲得 ' + scaleStr(fx.shieldPctMax, lv) + '% 最大生命的護盾');
  if (fx.selfCleanse) p.push('淨化自身負面狀態');
  if (fx.mpRestore) p.push('回復 ' + statStr(fx.mpRestore) + ' 法力');
  if (fx.buff) p.push('自身' + buffLabel(fx.buff.key) + ' +' + scaleStr(fx.buff, lv) + '%，持續 ' + statStr(fx.buff.dur) + ' 秒');
  if (fx.buff2) p.push(buffLabel(fx.buff2.key) + ' +' + scaleStr(fx.buff2, lv) + '%');
  if (fx.debuff) p.push('敵方' + buffLabel(fx.debuff.key) + ' -' + scaleStr(fx.debuff, lv) + '%，持續 ' + statStr(fx.debuff.dur) + ' 秒');
  if (fx.maxHpDotPct) p.push('每秒造成敵方最大生命 ' + scaleStr(fx.maxHpDotPct, lv) + '% 的詛咒傷害（' + statStr(fx.dotDur || 5) + '秒，有上限）');
  var desc = p.join('；');
  // 融合技：附上變異與素材資訊
  if (sk.cat === 'fusion') {
    if (sk.mutation) desc += '<div class="skt-mutation">【變異：' + sk.mutation.name + '】' + sk.mutation.desc + '</div>';
    if (sk.components) {
      var cn = sk.components.map(function (cid) { var d = SKILLS[cid]; return d ? d.name : cid; });
      desc += '<div class="skt-components">（融合自：' + cn.join(' ＋ ') + '）</div>';
    }
  } else {
    var nx = nextUnlockLv(id, lv);
    if (nx) desc += '。⭐ Lv.' + nx + ' 解鎖／強化附加效果';
  }
  return desc;
}
