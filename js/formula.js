'use strict';
/* ============================================================
   遊戲公式總集（formula.js）
   ------------------------------------------------------------
   整個遊戲的數值公式集中在本檔案，依系統分為十個區塊：

     §1  成長與經驗（升級經驗、等級基礎四維）
     §2  玩家屬性彙總 computeStats（50+ 屬性派生）
     §3  戰鬥核心（防禦減傷、命中/暴擊/元素/格擋、治療護盾）
     §4  敵方屬性（野外怪物成長、菁英、高塔 BOSS）
     §5  掉落與獎勵（稀有度、掉落表規則、材料、高塔獎勵）
     §6  裝備數值（詞條、被動、附魔、評分、分解產出）
     §7  強化 / 洗煉 / 合成 / 生產線容量
     §8  寶石（能力值、插槽、合成、融合、商店）
     §9  技能（費用、冷卻、裝載欄、技能融合參數）
     §10 離線收益

   ⚙️ 調整遊戲平衡：改這裡（數值資料表在 data.js，如稀有度表、
      詞條池、掉落表；本檔負責「怎麼算」，data.js 負責「查表值」）。
   📖 全部公式的中文文字說明請見根目錄 game_formula.md。
   ============================================================ */

/* ============================================================
   §1 成長與經驗
   ============================================================ */

// 升到下一級所需經驗 = 30 × 等級^2 + 40
function xpForLevel(l) { return Math.floor(30 * Math.pow(l, 2) + 40); }

/* 等級基礎四維主屬性（不含裝備）：力/敏/智/耐 相同
   = 5 + (等級 - 1) × 2 */
function basePrimaryFor(level) {
  var v = 5 + (level - 1) * 2;
  return { str: v, agi: v, int: v, vit: v };
}

/* ============================================================
   §2 玩家屬性彙總（50+ 屬性系統核心）
   流程：等級基礎四維 → 累加裝備詞條 / 被動技能 / 鑲嵌寶石
        → 派生出面板上的所有數值（含上限 clamp）
   ============================================================ */

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
  var socketed = []; // 鑲嵌的寶石（gemEff 需在詞條聚合完成後才知道，先蒐集）

  SLOT_LIST.forEach(function (slot) {
    var it = G.equipment[slot];
    if (!it) return;
    if (it.sockets) {
      it.sockets.forEach(function (g) { if (g && (g.fused || GEM_TYPES[g.type])) socketed.push(g); });
    }
    var um = upgradeMult(it); // 強化倍率：每 +1 詞條數值 +5%
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
    itemEnchants(it).forEach(function (en) {
      var ek = en.key, ev = en.val;
      var e = ENCHANTS[ek];
      if (!e) return;
      if (e.cat === 'atk' && e.elem) elemAtk[e.elem] += ev;
      else if (ENCHANT_RES_MAP[ek]) resist[ENCHANT_RES_MAP[ek]] += ev;
      else if (ek === 'ctrlRes') resist.ctrl += ev;
      else if (ek === 'loot') A.loot += ev;
      else if (ek === 'haste') A.moveSpeed += ev;
    });
  });

  // 被動技能加成：每級效果 × 技能等級
  if (G.player.skills) {
    for (var sid in G.player.skills) {
      var slv = G.player.skills[sid];
      var sdef = (typeof SKILLS !== 'undefined') ? SKILLS[sid] : null;
      if (!sdef || !sdef.fx || !sdef.fx.passive || !slv) continue;
      for (var pk in sdef.fx.passive) {
        if (A[pk] !== undefined) A[pk] += sdef.fx.passive[pk] * slv;
      }
    }
  }

  // 鑲嵌寶石加成（受「寶石鑲嵌效率」屬性放大；融合寶石逐屬性計入）
  var gemMult = 1 + A.gemEff / 100;
  function applyGemStat(gemType, rawVal) {
    var v = rawVal * gemMult;
    var key = GEM_TYPES[gemType].stat;
    var re = affixResElem(key);
    if (key === 'aspd') A.aspdPct += v;
    else if (re) resist[re] = (resist[re] || 0) + v;
    else if (A[key] !== undefined) A[key] += v;
  }
  socketed.forEach(function (g) {
    if (g.fused) {
      g.fused.stats.forEach(function (s) { applyGemStat(s.type, s.val); });
    } else if (GEM_TYPES[g.type]) {
      applyGemStat(g.type, gemStatValue(g.type, g.level));
    }
  });

  /* ---- 派生公式（st.base = 純等級/四維的基礎值，供屬性面板拆解顯示） ---- */
  var lv = p.level;
  var st = { level: lv };
  // 四維主屬性
  st.str = Math.round(A.str); st.agi = Math.round(A.agi);
  st.int = Math.round(A.int); st.vit = Math.round(A.vit);
  // 基礎：生命 = (120 + (等級-1)×22 + 耐力×10 + 定值) × (1 + 生命%)
  st.base = {};
  st.base.hp = 120 + (lv - 1) * 22 + st.vit * 10;
  st.hp = Math.round((st.base.hp + A.hpFlat) * (1 + A.hpPct / 100));
  st.hpRegen = A.hpRegen;                                    // 額外生命恢復/秒（另有 BASE_HP_REGEN_PCT%/秒 基礎回復）
  // 法力 = 40 + 智力×4 + 定值；法力恢復 = 2 + 智力×0.06 + 加成
  st.base.mp = 40 + st.int * 4;
  st.mp = Math.round(st.base.mp + A.mpFlat);
  st.mpRegen = 2 + st.int * 0.06 + A.mpRegen;
  // 進攻：物攻 = (8 + (等級-1)×1.6 + 力量×2 + 定值) × (1 + 物攻%)
  st.base.atk = 8 + (lv - 1) * 1.6 + st.str * 2;
  st.atk = Math.round((st.base.atk + A.atkFlat) * (1 + A.atkPct / 100));
  // 魔攻 = (6 + (等級-1)×1.2 + 智力×2 + 定值) × (1 + 魔攻%)
  st.base.matk = 6 + (lv - 1) * 1.2 + st.int * 2;
  st.matk = Math.round((st.base.matk + A.matkFlat) * (1 + A.matkPct / 100));
  st.critRate = clamp(5 + st.agi * 0.06 + A.critRate, 0, 100);   // 暴擊率：基礎 5% + 敏捷×0.06
  st.critDmg = 150 + A.critDmg;                                  // 暴擊傷害：基礎 150%
  st.pPen = clamp(A.pPen, 0, 80);                                // 穿透上限 80%
  st.mPen = clamp(A.mPen, 0, 80);
  st.hit = 100 + A.hit;                                          // 命中：基礎 100%
  st.aspd = clamp(1.0 * (1 + (A.aspdPct + st.agi * 0.15) / 100), 0.2, 5); // 攻速：基礎 1/秒，敏捷×0.15%，上限 5
  st.cdr = clamp(A.cdr, 0, 60);                                  // 冷卻縮減上限 60%
  st.castSpeed = clamp(A.castSpeed, 0, 50);                      // 施法速度上限 50%
  st.lifesteal = clamp(A.lifesteal, 0, 60);                      // 吸血上限 60%
  st.manaSteal = clamp(A.manaSteal, 0, 30);                      // 吸魔上限 30%
  st.eliteDmg = A.eliteDmg;
  st.bossDmg = A.bossDmg;
  st.aoeDmg = A.aoeDmg;
  // 防禦：物防 = (4 + (等級-1)×1.0 + 耐力×0.9 + 定值) × (1 + 物防%)
  st.base.def = 4 + (lv - 1) * 1.0 + st.vit * 0.9;
  st.def = Math.round((st.base.def + A.defFlat) * (1 + A.defPct / 100));
  // 魔防 = (3 + (等級-1)×0.8 + 智力×0.7 + 定值) × (1 + 物防%［共用］)
  st.base.mdef = 3 + (lv - 1) * 0.8 + st.int * 0.7;
  st.mdef = Math.round((st.base.mdef + A.mdefFlat) * (1 + A.defPct / 100));
  st.blockRate = clamp(A.blockRate, 0, 50);                      // 格擋率上限 50%
  st.blockDmgRed = clamp(A.blockDmgRed, 0, 50);                  // 額外格擋減傷上限 50%（總減傷 = 30% + 此值）
  st.evasion = clamp(st.agi * 0.08 + A.evasion, 0, 40);          // 閃避：敏捷×0.08，上限 40%
  st.tenacity = clamp(A.tenacity, 0, 60);                        // 韌性上限 60%
  st.shieldEff = A.shieldEff;
  st.pRes = clamp(A.pRes, 0, 60);                                // 物理/魔法抗性上限 60%
  st.mRes = clamp(A.mRes, 0, 60);
  // 元素抗性上限 75%、控制抵抗上限 80%
  ELEMENTS.forEach(function (e2) { resist[e2] = clamp(resist[e2], 0, 75); });
  resist.ctrl = clamp(resist.ctrl, 0, 80);
  st.resist = resist;
  // 特殊與機制
  st.ccRed = clamp(A.ccRed, 0, 60);                              // 控制時間縮減上限 60%
  st.moveSpeed = clamp(A.moveSpeed, 0, 50);                      // 移動速度上限 50%（縮短出怪間隔）
  st.loot = A.loot;
  st.xpBonus = A.xpBonus;
  st.goldBonus = A.goldBonus;
  st.luck = clamp(A.luck, 0, 100);                               // 幸運值上限 100
  st.weight = Math.round(st.str * 0.5 + A.weight);               // 負重 = 力量×0.5 + 詞條
  st.enhanceSuccess = A.enhanceSuccess;
  st.decomposeYield = A.decomposeYield;
  st.hybridMutation = clamp(A.hybridMutation, 0, 60);            // 合成變異率上限 60%
  st.enrageThreshold = clamp(A.enrageThreshold, 0, 30);          // 狂暴閾值上限 +30
  st.affixCap = clamp(A.affixCap, 0, 100);
  st.gemEff = A.gemEff;
  // 被動上限：連擊 45%、暈眩 30%
  if (passives.doubleHit) passives.doubleHit = Math.min(passives.doubleHit, 45);
  if (passives.stun) passives.stun = Math.min(passives.stun, 30);
  st.passives = passives;
  st.elemAtk = elemAtk;
  st.A = A;
  return st;
}

/* ============================================================
   §3 戰鬥核心
   ============================================================ */

// 防禦減傷率 = 防禦 / (防禦 + 60 + 8 × 攻擊者等級)
function defReduction(def, attackerLevel) {
  if (def <= 0) return 0;
  return def / (def + 60 + 8 * attackerLevel);
}

var SLOW_ASPD_FACTOR = 0.7;   // 減速狀態：攻速 -30%（攻擊冷卻累積 ×0.7）
var BASE_HP_REGEN_PCT = 1.5;  // 野外每秒基礎生命回復（最大生命 %；高塔內無此回復）
var KILL_HEAL_PCT = 12;       // 野外擊殺回復（最大生命 %，溢出轉護盾）

function slowFactor(ent) { return effectActive(ent, 'slow') ? SLOW_ASPD_FACTOR : 1; }

/* ---- 共用攻擊流程（傷害結算總公式） ----
   結算順序：命中 → 防禦減傷（含破甲/穿透）→ 物/魔抗性 → ±10% 浮動
           → 暴擊 → 元素附加（含特效觸發）→ 真實傷害 → 對菁英/BOSS 加成
           → 格擋 → 護盾吸收 → 扣血 → 反震
   aCfg: { atk, dmgType('phys'|'magic'|'both'), level, critRate, critDmg, hit, sunder, pen,
           trueDmgPct, elemAtk, eliteDmg, bossDmg, isPlayer }
   dCfg: { def, mdef, level, dodge, blockRate, blockDmgRed, pRes, mRes, resist{六元素+ctrl},
           ctrlRes, ccFactor, thornsPct, maxHp, isElite, isBoss }
   回傳 { dmg, crit, miss, blocked, killed, thorns, heal, procs[] }        */
function resolveHit(attacker, defender, aCfg, dCfg) {
  var out = { dmg: 0, crit: false, miss: false, blocked: false, killed: false, thorns: 0, heal: 0, absorbed: 0, procs: [] };
  // 命中率 = clamp(攻擊者命中 - 防守者閃避, 5%, 100%)
  var hitChance = clamp((aCfg.hit || 100) - (dCfg.dodge || 0), 5, 100);
  if (!chance(hitChance)) { out.miss = true; return out; }
  // 防禦選型（物理/魔法）＋破甲＋穿透：有效防禦 = 防禦 × (1-破甲%) × (1-穿透%)
  var dmg = 0;
  if (aCfg.dmgType !== 'magic') {
    var pDef = (dCfg.def || 0) * (1 - (aCfg.sunder || 0) / 100) * (1 - (aCfg.pen || 0) / 100);
    var pDmg = (aCfg.atk || 0) * (1 - defReduction(pDef, aCfg.level || 1));
    pDmg *= 1 - clamp(dCfg.pRes || 0, 0, 60) / 100;   // 物理抗性：結算防禦後再按比例減免
    dmg += pDmg;
  }
  if (aCfg.dmgType === 'magic' || aCfg.dmgType === 'both') {
    var mPen = (aCfg.dmgType === 'both') ? (aCfg.mPen || 0) : (aCfg.pen || 0);
    var baseMAtk = (aCfg.dmgType === 'both') ? (aCfg.matk || 0) : (aCfg.atk || 0);
    var mDef = (dCfg.mdef || 0) * (1 - (aCfg.sunder || 0) / 100) * (1 - mPen / 100);
    var mDmg = baseMAtk * (1 - defReduction(mDef, aCfg.level || 1));
    mDmg *= 1 - clamp(dCfg.mRes || 0, 0, 60) / 100;   // 魔法抗性
    dmg += mDmg;
  }
  dmg *= rnd(0.9, 1.1);   // 傷害浮動 ±10%
  // 暴擊：傷害 × 暴傷%（基礎 150%）
  if (chance(aCfg.critRate || 0)) { dmg *= (aCfg.critDmg || 150) / 100; out.crit = true; }
  // 元素附加（各自受對應抗性影響，並觸發元素特效）
  var elem = aCfg.elemAtk || null;
  if (elem) {
    var res = dCfg.resist || {};
    var ccF = (dCfg.ccFactor === undefined) ? 1 : dCfg.ccFactor;
    for (var i = 0; i < ELEMENTS.length; i++) {
      var ek = ELEMENTS[i];
      var ev = elem[ek] || 0;
      if (!ev) continue;
      var edmg = ev * (1 - clamp(res[ek] || 0, 0, 75) / 100);
      dmg += edmg;
      // 元素特效：冰 15% 減速 2 秒｜雷 10% 追加 80% 電擊｜毒 25% 中毒（50% 元傷/秒×4 秒）
      //          光 20% 淨化自身｜暗 汲取元傷 25% 回復
      if (ek === 'ice' && chance(15) && !resistCtrl(dCfg)) { applyEffect(defender, 'slow', 2 * ccF); out.procs.push('減速'); }
      else if (ek === 'lightning' && chance(10)) { dmg += edmg * 0.8; out.procs.push('連鎖電擊'); }
      else if (ek === 'poison' && chance(25)) { applyPoison(defender, edmg * 0.5, 4); out.procs.push('中毒'); }
      else if (ek === 'light' && chance(20)) { cleanse(attacker); out.procs.push('淨化'); }
      else if (ek === 'dark') { out.heal += edmg * 0.25; } // 暗影汲取
    }
  }
  // 真實傷害（無視防禦與抗性）= 攻擊力 × 真傷%
  if (aCfg.trueDmgPct) dmg += aCfg.atk * aCfg.trueDmgPct / 100;
  // 對菁英 / 對 BOSS 傷害加成
  if (dCfg.isElite && aCfg.eliteDmg) dmg *= 1 + aCfg.eliteDmg / 100;
  if (dCfg.isBoss && aCfg.bossDmg) dmg *= 1 + aCfg.bossDmg / 100;
  // 格擋（機率減傷）：總減傷 = 30% + 格擋減傷詞條，上限 85%
  if ((dCfg.blockRate || 0) > 0 && chance(clamp(dCfg.blockRate, 0, 50))) {
    dmg *= 1 - clamp(30 + (dCfg.blockDmgRed || 0), 0, 85) / 100;
    out.blocked = true;
  }
  dmg = Math.max(1, Math.round(dmg));   // 最低傷害 1
  // 護盾吸收
  if (defender.shield && defender.shield > 0) {
    out.absorbed = Math.min(defender.shield, dmg);
    defender.shield -= out.absorbed;
    dmg -= out.absorbed;
  }
  defender.hp -= dmg;
  out.dmg = dmg + out.absorbed; // 統計上含護盾吸收量
  if (defender.hp <= 0) { defender.hp = 0; out.killed = true; }
  // 反震（防守方被動）= 防守方最大生命 × 反震%
  if (dCfg.thornsPct && !out.killed) {
    out.thorns = Math.max(1, Math.round(dCfg.maxHp * dCfg.thornsPct / 100));
    attacker.hp -= out.thorns;
  }
  return out;
}

// 控制抵抗判定：ctrlRes% 機率完全抵抗暈眩/減速
function resistCtrl(dCfg) {
  var r = (dCfg.ctrlRes || 0);
  return r > 0 && chance(r);
}

/* ---- 治療公式：溢出治療的 50% 轉為護盾 ----
   護盾上限 = 最大生命 × 15% × (1 + 護盾效率%) */
function healPlayer(pEnt, amount, st) {
  if (amount <= 0) return;
  var space = st.hp - pEnt.hp;
  if (amount <= space) { pEnt.hp += amount; return; }
  pEnt.hp = st.hp;
  var over = amount - space;
  var cap = st.hp * 0.15 * (1 + (st.shieldEff || 0) / 100);
  pEnt.shield = Math.min(cap, (pEnt.shield || 0) + over * 0.5);
}

/* ============================================================
   §4 敵方屬性
   ============================================================ */

/* ---- 野外怪物成長曲線（指數 × 線性）----
   生命 = (30 + 階段×8)   × 1.13^(階段-1)
   攻擊 = (6 + 階段×1.2)  × 1.10^(階段-1)
   防禦 = (2 + 階段×0.5)  × 1.08^(階段-1)（魔防 = 物防×0.75）
   金幣 = (5 + 階段)      × 1.07^(階段-1)
   經驗 = (8 + 階段)      × 1.08^(階段-1)
   菁英：生命×2.5、攻擊×1.5、金幣/經驗×3、閃避 5%、攻速 1.25
   ※ 場景倍率（ZONES 的 hpMult/atkMult/defMult/rewardMult）在
     spawnFieldMonster（combat.js）套用。 */
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
    aspd: 0.75,
    dodge: 0, gold: gold, xp: xp, elite: !!elite
  };
  if (elite) {
    m.hp *= 2.5; m.atk *= 1.5; m.gold *= 3; m.xp *= 3; m.dodge = 5; m.aspd = 1.25;
  }
  return m;
}

// 菁英出現規則：階段為 10 的倍數
function isEliteStage(stage) { return stage % 10 === 0; }

/* ---- 高塔 BOSS 數值 ----
   對應野外階段 = 4 + 樓層×5（以此為基準怪物再放大）
   等級 = 對應階段+3｜生命 ×22｜攻擊 ×1.9｜物/魔防 ×1.5
   攻速 2.0｜閃避 = min(5+樓層, 20)%｜控制抵抗 70%
   元素 BOSS：元素附傷 = 基準攻擊 × 0.5（以魔法攻擊結算） */
function bossStatsFor(floor) {
  var refStage = 4 + floor * 5;
  var base = monsterStatsFor(refStage, false);
  return {
    refStage: refStage,
    level: refStage + 3,
    hp: base.hp * 22,
    atk: base.atk * 1.9,
    def: base.def * 1.5,
    mdef: base.mdef * 1.5,
    aspd: 2.0,
    dodge: Math.min(5 + floor, 20),
    ctrlRes: 70,
    elemAtkVal: base.atk * 0.5
  };
}

/* ============================================================
   §5 掉落與獎勵
   ============================================================ */

// 依等級/樓層從掉落表（data.js 的 FIELD_DROP_TABLE / BOSS_DROP_TABLE）取機率列
function dropRatesFor(table, lvl) {
  for (var i = 0; i < table.length; i++) {
    if (lvl >= table[i].min) return table[i].rates;
  }
  return table[table.length - 1].rates;
}
// 機率 → 掉落件數（>100% 規則：150% = 必掉 1 件 + 50% 機率再 1 件）
function rollDropCount(pct) {
  if (pct <= 0) return 0;
  var n = Math.floor(pct / 100);
  if (chance(pct - n * 100)) n++;
  return n;
}

/* ---- 稀有度擲骰（非掉落表路徑：合成產物等用）----
   權重加成 b = 1 + 掉寶加成/200 + 階段×0.006（各稀有度有權重與加成上限；
   史詩 8 階起、傳說 15 階起、神話 25 階起、創世 40 階起才可能出現） */
function rollRarity(stage, lootBonus) {
  var s = stage || 1;
  var b = 1 + (lootBonus || 0) / 200 + s * 0.006;
  var w = [
    [0, 55],
    [1, 25 * Math.min(b, 2)],
    [2, 12 * Math.min(b, 2.5)],
    [3, 5.5 * Math.min(b, 3)],                       // 獨特（紫）
    [4, (s >= 8 ? 1.8 : 0) * Math.min(b, 3.5)],      // 史詩（金）
    [5, (s >= 15 ? 0.35 : 0) * Math.min(b, 4)],      // 傳說（橘）
    [6, (s >= 25 ? 0.08 : 0) * Math.min(b, 4.5)],    // 神話（紅）
    [7, (s >= 40 ? 0.015 : 0) * Math.min(b, 5)]      // 創世（暗金）
  ];
  return wpick(w);
}

/* ---- 野外材料掉落（基礎機率 %；實際機率 × (1+掉寶率) × 場景倍率，
       用 rollDropCount 結算 >100% 必掉規則）---- */
var FIELD_GEM_DROP_PCT = 6;      // 寶石（階段 4+）
var FIELD_BOOK_DROP_PCT = 4;     // 附魔書（階段 8+）
var FIELD_ESSENCE_DROP_PCT = 9;  // 附魔精華（階段 10+，掉 1~2 顆 × 場景倍率）

// 野外寶石等級：基準級 = 1 + ⌊階段/15⌋（上限 5）；70% 出基準級、30% 出低一級
function fieldGemLevelFor(stage) {
  var glv = clamp(1 + Math.floor(stage / 15), 1, GEM_MAX_LEVEL);
  return wpick([[glv, 70], [Math.max(1, glv - 1), 30]]);
}

/* ---- 高塔通關獎勵 ----
   零件階級 = 1 + ⌊(樓層-1)/4⌋（上限 T5）；首通必得，重複通關 30%
   金幣 = 200 × 樓層（首通 ×2）
   寶石等級 = 1 + ⌊樓層/4⌋（上限 5，隨機種類 ×2 顆）
   附魔精華 = 3 + 樓層（另附魔書 ×2）
   裝備戰利品等級 = 4 + 樓層×5（依 BOSS 掉落表擲骰） */
function towerRewardFor(floor, firstClear) {
  return {
    partTier: clamp(1 + Math.floor((floor - 1) / 4), 1, PART_MAX_TIER),
    partChance: firstClear ? 100 : 30,
    gold: Math.round(200 * floor * (firstClear ? 2 : 1)),
    gemLevel: clamp(1 + Math.floor(floor / 4), 1, GEM_MAX_LEVEL),
    essence: 3 + floor,
    itemLevel: 4 + floor * 5
  };
}

/* ============================================================
   §6 裝備數值
   ============================================================ */

/* ---- 詞條數值 ----
   基準值 = (base + base × lv係數 × (裝備等級-1)) × 稀有度倍率
   實際值 = 基準值 × rnd(0.8, 1.2)（即洗煉區間 ±20%） */
function rollAffixValue(key, itemLevel, rarityIdx) {
  var def = AFFIX_POOL[key];
  var r = RARITIES[rarityIdx];
  var v = (def.base + def.base * def.lv * (itemLevel - 1)) * r.mult * rnd(0.8, 1.2);
  return def.pct ? Math.round(v * 10) / 10 : Math.round(v);
}
// 詞條可能範圍（洗煉區間顯示用）：基準值 × 0.8 ~ × 1.2
function getAffixLimits(key, itemLevel, rarityIdx) {
  var def = AFFIX_POOL[key];
  var r = RARITIES[rarityIdx];
  var baseV = (def.base + def.base * def.lv * (itemLevel - 1)) * r.mult;
  var minV = def.pct ? Math.round(baseV * 0.8 * 10) / 10 : Math.round(baseV * 0.8);
  var maxV = def.pct ? Math.round(baseV * 1.2 * 10) / 10 : Math.round(baseV * 1.2);
  return { min: minV, max: maxV };
}

// 強化倍率：每 +1 全詞條數值 +5%
function upgradeMult(item) { return 1 + 0.05 * (item.upgrade || 0); }

// 特殊被動數值 = base + perR × (稀有度 - 稀有級)
function passiveValueFor(key, rarity) {
  var pd = PASSIVE_POOL[key];
  return Math.round((pd.base + pd.perR * (rarity - RARE_IDX)) * 10) / 10;
}

/* ---- 附魔數值 ----
   攻擊類威力 = (5 + 裝備等級×1.2) × 稀有度倍率 × (1 + 0.15×寶石等級)
   （火焰附魔再 ×1.25，純高額傷害定位）
   防禦/功能類 = 8 + 稀有度×4 + 寶石等級×3（%，上限 60） */
function enchantPower(item, gemLevel) {
  var r = RARITIES[item.rarity];
  var v = (5 + item.level * 1.2) * r.mult * (1 + 0.15 * (gemLevel || 0));
  return Math.round(v);
}
function enchantValueFor(item, bookKey, gemLevel) {
  var e = ENCHANTS[bookKey];
  if (e.cat === 'atk') {
    var v = enchantPower(item, gemLevel);
    if (bookKey === 'fire') v = Math.round(v * 1.25); // 火焰：純高額傷害
    return v;
  }
  // 抗性 / 功能類：百分比，隨稀有度與寶石成長，設定上限
  var val = Math.round((8 + item.rarity * 4 + (gemLevel || 0) * 3) * 10) / 10;
  return Math.min(val, 60);
}

/* ---- 裝備戰力評分（自動換裝比較用）----
   評分 = Σ(詞條值 × 權重 × 強化倍率) + Σ(寶石值 × 權重)
        → 有被動 ×1.15 → + Σ(附魔值 × 1.2攻/2防) → ×(1 + 稀有度×0.06)
   未列出的詞條權重以 1 計 */
var SCORE_WEIGHTS = {
  atkFlat: 1.0, atkPct: 2.6, matkFlat: 1.0, matkPct: 2.6,
  hpFlat: 0.16, hpPct: 2.2, hpRegen: 0.6,
  defFlat: 0.9, defPct: 1.8, mdefFlat: 0.9,
  mpFlat: 0.25, mpRegen: 2.0,
  str: 1.8, agi: 1.8, int: 1.8, vit: 1.8,
  aspd: 2.8, critRate: 2.4, critDmg: 0.9,
  pPen: 2.2, mPen: 2.2, hit: 1.2, cdr: 2.0, castSpeed: 1.4,
  lifesteal: 2.2, manaSteal: 1.4, eliteDmg: 1.2, bossDmg: 1.2, aoeDmg: 1.4,
  blockRate: 2.0, blockDmgRed: 1.2, evasion: 2.2, tenacity: 1.2, shieldEff: 1.0,
  pRes: 2.0, mRes: 2.0,
  resFire: 0.8, resIce: 0.8, resLightning: 0.8, resPoison: 0.8, resLight: 0.8, resDark: 0.8,
  ccRed: 1.2, moveSpeed: 1.5, loot: 0.8, xpBonus: 0.8, goldBonus: 0.8,
  luck: 1.5, weight: 0.8, enhanceSuccess: 0.8, decomposeYield: 0.8,
  hybridMutation: 1.2, enrageThreshold: 1.0, affixCap: 1.2, gemEff: 1.0
};
function itemScore(it) {
  if (!it) return 0;
  var s = 0, um = upgradeMult(it);
  for (var i = 0; i < it.affixes.length; i++) {
    var a = it.affixes[i];
    s += (SCORE_WEIGHTS[a.key] || 1) * a.val * um;
  }
  // 鑲嵌的寶石計入評分（避免自動換裝丟棄鑲嵌裝備；融合寶石逐屬性計）
  if (it.sockets) {
    for (var j = 0; j < it.sockets.length; j++) {
      var g = it.sockets[j];
      if (!g) continue;
      if (g.fused) {
        g.fused.stats.forEach(function (fs) { s += fs.val * (SCORE_WEIGHTS[GEM_TYPES[fs.type].stat] || 1); });
      } else if (GEM_TYPES[g.type]) {
        s += gemStatValue(g.type, g.level) * (SCORE_WEIGHTS[GEM_TYPES[g.type].stat] || 1);
      }
    }
  }
  if (it.passive) s *= 1.15;
  var ens = itemEnchants(it);
  for (var ei = 0; ei < ens.length; ei++) {
    var e = ENCHANTS[ens[ei].key];
    if (e) s += (e.cat === 'atk') ? ens[ei].val * 1.2 : ens[ei].val * 2;
  }
  s *= 1 + it.rarity * 0.06;
  return s;
}

/* ---- 分解產出 ----
   碎片 = (2 + 裝備等級×0.6) × 稀有度分解係數 × rnd(0.85, 1.15)（最低 1）
   金幣 = (3 + 裝備等級) × 分解係數 × 0.5
   精粹提取（機率 = extractChance，見 extractChanceNow）：
     精華 = 1~2 + ⌊稀有度/2⌋，另 30% 機率附贈 1 顆一級寶石
   每個附魔額外回收 1 精華 */
function salvageResult(it, extractChance) {
  var r = RARITIES[it.rarity];
  var out = {
    scrap: Math.max(1, Math.round((2 + it.level * 0.6) * r.salv * rnd(0.85, 1.15))),
    gold: Math.round((3 + it.level) * r.salv * 0.5),
    essence: 0, gem: 0, extracted: false
  };
  if (chance(extractChance === undefined ? ESSENCE_EXTRACT_CHANCE : extractChance)) {
    out.extracted = true;
    out.essence = ri(1, 2) + Math.floor(it.rarity / 2);
    if (chance(30)) out.gem = 1; // 額外一級寶石
  }
  out.essence += itemEnchants(it).length; // 每個附魔回收 1 額外精華
  return out;
}

/* ============================================================
   §7 強化 / 洗煉 / 合成 / 生產線容量
   ============================================================ */

// 強化基礎成功率：+5 以內必成，之後每級 -6%，下限 30%
function upgradeSuccessBase(nextLevel) {
  if (nextLevel <= 5) return 100;
  return Math.max(30, 100 - (nextLevel - 5) * 6);
}
/* 強化費用（隨強化等級指數成長、隨裝備等級線性放大）：
   金幣 = 25 × 1.45^強化等級 × (1 + 裝備等級×0.08)
   碎片 = 8 × 1.35^強化等級 × (1 + 裝備等級×0.04) */
function upgradeCost(it) {
  var lv = it.upgrade || 0;
  return {
    gold: Math.round(25 * Math.pow(1.45, lv) * (1 + it.level * 0.08)),
    scrap: Math.round(8 * Math.pow(1.35, lv) * (1 + it.level * 0.04))
  };
}
// 實際強化成功率 = 基礎 + 「強化成功率」屬性（上限 100%）；失敗損失半數材料
function upgradeSuccessChance(it) {
  var next = (it.upgrade || 0) + 1;
  return Math.min(100, upgradeSuccessBase(next) + getStats().enhanceSuccess);
}

/* 洗煉費用（整件或單詞條同價）：
   金幣 = 40 × 1.7^稀有度 × (1 + 裝備等級×0.15)
   精華 = 1 + 稀有度 */
function rerollCost(it) {
  return {
    gold: Math.round(40 * Math.pow(1.7, it.rarity) * (1 + it.level * 0.15)),
    essence: 1 + it.rarity
  };
}

// 精粹提取率 = 基礎 10% + 分解高產率屬性 + 幸運值/3
function extractChanceNow() {
  var st = getStats();
  return ESSENCE_EXTRACT_CHANCE + st.decomposeYield + st.luck / 3;
}

// 合成大成功率 = 基礎 5% + 幸運核心零件加成 + 幸運值/2（稀有度額外 +1）
function synthGreatChanceNow() {
  return SYNTH_GREAT_BASE + partBonus('synth', 'luckCore') + getStats().luck / 2;
}

// 生產線容量（受「負重上限」屬性擴充）
function conveyorCap() { return CONVEYOR_CAP + getStats().weight; }          // 輸送帶 = 40 + 負重
function synthBufCap() { return SYNTH_BUFFER_CAP + Math.floor(getStats().weight / 2); } // 暫存區 = 30 + 負重/2

/* ============================================================
   §8 寶石
   ============================================================ */

// 寶石能力數值（隨等級超線性成長）= base × 等級 × (1 + 0.2 × (等級-1))
function gemStatValue(type, level) {
  var g = GEM_TYPES[type];
  return Math.round(g.base * level * (1 + 0.2 * (level - 1)) * 10) / 10;
}
// 插槽數：依稀有度表（普/精良 1、稀有/獨特 2、史詩 3、傳說 4、神話 5、創世 6）
function socketCountFor(rarity) {
  var r = RARITIES[clamp(rarity, 0, RARITIES.length - 1)];
  return r.sockets;
}
// 附魔欄位數：依稀有度表（普~稀有 1、獨特~傳說 2、神話/創世 3）
function enchantCapFor(it) {
  return RARITIES[clamp(it.rarity, 0, RARITIES.length - 1)].enchants;
}

/* ---- 寶石合成 / 轉換 / 拆解換算（2026-07-09 改版）----
   合成鏈：2 顆同種同級 → 1 顆同種下一級（消耗金幣 FUSE_GOLD_COST[素材等級]），
   故 1 顆 N 級寶石的合成總成本 = 2^(N-1) 顆 1 級（5 級 = 16 顆）。 */
var GEM_CONVERT_SLOTS = 9;     // 寶石轉換九宮格格數
var GEM_CONVERT_STACK = 10;    // 每格同種同級寶石上限
var GEM_DISMANTLE_KEEP = 0.7;  // 拆解保留比例（損失 30%）

// 1 顆 lv 級寶石換算多少顆 1 級寶石
function gemL1Worth(lv) { return Math.pow(2, lv - 1); }
// 一般寶石拆解產出（同種 1 級寶石）= ⌊2^(等級-1) × 0.7⌋（例：5 級 → ⌊16×0.7⌋ = 11 顆）
function gemDismantleYield(lv) { return Math.floor(gemL1Worth(lv) * GEM_DISMANTLE_KEEP); }
/* 融合寶石拆解：融合素材樹的葉子都是 5 階寶石（各值 16 顆 1 級）。
   fg.leaves 記錄素材 5 階總數（融合時雙方相加；不計成功率，一律視為 100%）
   → 總成本 = 16 × leaves 顆 1 級，拆解產出 = ⌊總成本 × 0.7⌋（依屬性種類均分）。
   ※ fg.fusions 為「融合世代」（max+1，見 item.js），僅用於顯示與成功率遞減；
     舊存檔無 leaves 欄位時以 (fusions+1) 後備（migrateSave 會補）。 */
function fusedGemL1Worth(fg) { return gemL1Worth(GEM_MAX_LEVEL) * (fg.leaves || ((fg.fusions || 0) + 1)); }
function fusedGemDismantleYield(fg) { return Math.floor(fusedGemL1Worth(fg) * GEM_DISMANTLE_KEEP); }

// 寶石融合成功率 = 60% - 10% ×（雙方累計成功融合次數），最低 10%
function gemFuseRate(m1, m2) {
  return Math.max(GEM_FUSE_MIN_RATE, GEM_FUSE_BASE_RATE - GEM_FUSE_RATE_DECAY * ((m1 ? m1.fusions : 0) + (m2 ? m2.fusions : 0)));
}

// 商店手動刷新費用 = 50000 + 本小時刷新次數 × 10000（次數每小時重置）
function shopRefreshCost() {
  return GEM_SHOP_REFRESH_BASE + gemShop().refreshCount * GEM_SHOP_REFRESH_STEP;
}

/* ============================================================
   §9 技能
   ============================================================ */

var SKILL_MAX_LV = 10;         // 一般技能等級上限（保留給外部參照）
var SKILL_CAST_LOCK = 0.5;     // 施放硬直（秒；實際 = 0.5 × (1 - 施法速度%)）
var TIER_GATE_POINTS = 3;      // 技能樹：每階層需在該系已投入的點數（第 N 階需 N×3 點）

// 裝載欄：角色每 20 級 +1 格（最低 2 格，最多 20 格）
function loadoutSize() { return Math.min(20, Math.max(2, Math.floor(G.player.level / 20))); }

// 技能升級金幣費用 = 20000 × 當前等級 + 20^(1 + 當前等級/10)
function skillUpgradeCost(lv) {
  var cost = Math.floor(20000 * lv + Math.pow(20, 1 + lv / 10));
  return Math.min(5000000, cost);
}

// 各類技能等級上限：融合技 = 素材加總+20（存於 def.maxLv）／被動 30／主動 20
function skillMaxLv(def) {
  if (def && def.maxLv) return def.maxLv;
  if (def && def.cat === 'fusion') return 40;
  if (def && def.cat === 'passive') return 30;
  return 20;
}

// 技能傷害倍率（%）= base + per × (等級-1)
function skillValue(sk, lv) { return (sk.fx.base || 0) + (sk.fx.per || 0) * (lv - 1); }
// 實際冷卻 = 技能冷卻 × (1 - 冷卻縮減%)
function skillCdFor(sk) { return sk.cd * (1 - getStats().cdr / 100); }
// buff/heal 等 {base,per} 縮放通用式 = base + per × (等級-1)
function scaleAt(def, lv) { return def.base + def.per * (lv - 1); }

/* ---- 技能融合參數 ---- */
var FUSE_FACTOR = 0.75;           // 素材效果繼承比例（傷害/元素占比等 ×0.75 後合併；2026-07-09 由 0.6 上調，融合技傷害最高可達舊版 +300%）
var FUSION_MUTATION_CHANCE = 45;  // 變異基礎機率 %（實際 = 45 + 幸運值/3）
var FUSION_COST_FACTOR = 0.65;    // 融合技 MP 消耗 = 素材消耗加總 × 0.65
var FUSION_CD_FACTOR = 1.25;      // 融合技冷卻 = 素材最長冷卻 × 1.25

// 融合變異觸發率 = 基礎 45% + 幸運值/3
function fusionMutationChance() { return FUSION_MUTATION_CHANCE + getStats().luck / 3; }

/* ============================================================
   §10 離線收益
   ============================================================ */

var OFFLINE_MAX_HOURS = 8;      // 離線收益時間上限（小時）
var OFFLINE_EFFICIENCY = 0.5;   // 離線效率（估算擊殺數 × 50%）
var OFFLINE_MAX_KILLS = 20000;  // 單次離線擊殺上限

/* 離線擊殺估算：
   期望暴擊倍率 = 1 + 暴擊率 × (暴傷 - 1)
   DPS = 物攻 × (1 - 怪物防禦減傷) × 攻速 × 期望暴擊倍率
   單殺耗時 = 怪物血量 / DPS + 出怪間隔
   擊殺數 = ⌊離線秒數 / 單殺耗時 × 效率⌋（上限 20000） */
function offlineKillEstimate(elapsed) {
  var st = getStats();
  var s = Math.max(1, G.stage.current);
  var m = monsterStatsFor(s, false);
  var critMult = 1 + st.critRate / 100 * (st.critDmg / 100 - 1);
  var dps = Math.max(1, st.atk * (1 - defReduction(m.def, st.level)) * st.aspd * critMult);
  var killTime = m.hp / dps + RESPAWN_DELAY;
  var kills = Math.floor(elapsed / killTime * OFFLINE_EFFICIENCY);
  return { kills: Math.min(kills, OFFLINE_MAX_KILLS), monster: m, stage: s };
}
