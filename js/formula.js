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

// 轉生次數只接受 0~10，避免舊存檔或外部資料造成倍率失控。
function reincarnationCount() {
  var n = (typeof G !== 'undefined' && G && G.player) ? Number(G.player.reincarnations) : 0;
  return clamp(Math.floor(isFinite(n) ? n : 0), 0, REINCARNATION_MAX);
}
function reincarnationRankName(count) {
  var n = count === undefined ? reincarnationCount() : clamp(Math.floor(Number(count) || 0), 0, REINCARNATION_MAX);
  return REINCARNATION_RANKS[n] || REINCARNATION_RANKS[REINCARNATION_RANKS.length - 1];
}
function reincarnationExtraMultiplier(count) {
  var n = count === undefined ? reincarnationCount() : clamp(Math.floor(Number(count) || 0), 0, REINCARNATION_MAX);
  return REINCARNATION_EXTRA_MULTIPLIERS[n] || 0;
}
function reincarnationTotalMultiplier(count) {
  var n = count === undefined ? reincarnationCount() : clamp(Math.floor(Number(count) || 0), 0, REINCARNATION_MAX);
  return n === 0 ? 1 : reincarnationExtraMultiplier(n);
}
function reincarnationExpMultiplier(count) {
  var n = clamp(Math.floor(count === undefined ? reincarnationCount() : count), 0, REINCARNATION_MAX);
  return Math.pow(10, n);
}
// 升級經驗基礎增加值（依轉生次數，於括號外相加；轉生 0 次為 0）
function reincarnationExpBaseAdd(count) {
  var n = clamp(Math.floor(count === undefined ? reincarnationCount() : count), 0, REINCARNATION_MAX);
  return REINCARNATION_EXP_BASE_ADD[n] || 0;
}

// 升到下一級所需經驗 =（30 × 等級^2 + 40）× 轉生經驗倍率（每轉 ×10）＋ 升級經驗基礎增加值（依轉生次數）
function xpForLevel(l) { return Math.floor((30 * Math.pow(l, 2.2) + 40) * reincarnationExpMultiplier() + reincarnationExpBaseAdd()); }

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

function computeStats(equipmentOverride) {
  // equipmentOverride：計算指定裝備套的屬性（屬性面板預覽「檢視中」那套用）；省略＝穿著中 G.equipment。
  var equipment = equipmentOverride || G.equipment;
  var p = G.player;
  var prim = basePrimaryFor(p.level);
  // 聚合桶（詞條 key 與桶名一致；特例：aspd → aspdPct、resX → resist）
  var A = {
    str: prim.str, agi: prim.agi, int: prim.int, vit: prim.vit,
    hpFlat: 0, hpPct: 0, atkFlat: 0, atkPct: 0, matkFlat: 0, matkPct: 0,
    defFlat: 0, defPct: 0, mdefFlat: 0, mdefPct: 0, mpFlat: 0,
    hpRegen: 0, mpRegen: 0, aspdPct: 0, critRate: 0, critDmg: 0,
    pPen: 0, mPen: 0, hit: 0, cdr: 0, castSpeed: 0, lifesteal: 0, manaSteal: 0,
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, aoeDmg: 0, globalDmgRed: 0,
    // 4 轉敵種傷害天賦：與裝備／其他既有敵種傷害分開計算，保留獨立乘區。
    talentEliteDmg: 0, talentBossDmg: 0, talentNormalDmg: 0,
    normalDmgRed: 0, eliteDmgRed: 0, bossDmgRed: 0,
    blockRate: 0, blockDmgRed: 0, evasion: 0, tenacity: 0, shieldEff: 0, pRes: 0, mRes: 0,
    ccRed: 0, moveSpeed: 0, loot: 0, xpBonus: 0, goldBonus: 0, luck: 0, weight: 0,
    enhanceSuccess: 0, decomposeYield: 0, hybridMutation: 0, enrageThreshold: 0, affixCap: 0, gemEff: 0
  };
  var resist = { fire: 0, ice: 0, lightning: 0, poison: 0, light: 0, dark: 0, ctrl: 0 };
  var passives = {};
  var godAttackMultiplier = 1;
  var elemAtk = { fire: 0, ice: 0, lightning: 0, poison: 0, light: 0, dark: 0 };
  var socketed = []; // 鑲嵌的寶石（gemEff 需在詞條聚合完成後才知道，先蒐集）

  SLOT_LIST.forEach(function (slot) {
    var it = equipment[slot];
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
    // 神鑄創世專屬特效：屬性型直接併入聚合桶，觸發型併入 passives 供戰鬥掛勾讀取
    if (it.godPassives) {
      it.godPassives.forEach(function (gp) {
        var gd = GODFORGE_POOL[gp.key];
        if (!gd) return;
        if (gd.stats) {
          if (gp.key === 'godMight') {
            godAttackMultiplier *= 1 + gp.val / 100;
            return;
          }
          gd.stats.forEach(function (bk) {
            if (A[bk] !== undefined) A[bk] += bk === 'loot' ? effectiveDropRateEffect(gp.val) : gp.val;
          });
        } else {
          passives[gp.key] = (passives[gp.key] || 0) + gp.val;
        }
      });
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
      else if (ek === 'vigor') A.hpPct += ev;
      else if (ek === 'clarity') A.mpRegen += ev;
      else if (ek === 'focus') A.cdr += ev;
      else if (ek === 'fortune') A.goldBonus += ev;
      else if (ek === 'wisdom') A.xpBonus += ev;
    });
  });

  // 被動技能加成：每級效果 × 技能等級；5 轉天賦的被動技能效果同步放大。
  var talent = (typeof talentStatBonuses === 'function') ? talentStatBonuses() : {};
  if (G.player.skills) {
    for (var sid in G.player.skills) {
      var slv = G.player.skills[sid];
      var sdef = (typeof SKILLS !== 'undefined') ? SKILLS[sid] : null;
      if (!sdef || !sdef.fx || !sdef.fx.passive || !slv) continue;
      for (var pk in sdef.fx.passive) {
        if (A[pk] !== undefined) {
          var passiveVal = sdef.fx.passive[pk] * slv * (1 + (talent.skillPassive || 0) / 100);
          A[pk] += pk === 'loot' ? effectiveDropRateEffect(passiveVal) : passiveVal;
        }
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

  // 天賦效果在裝備、寶石與被動技能彙總後套用；潛力不另設點數，僅提供技能分類與戰鬥衍生加成。
  A.str *= 1 + (talent.strPct || 0) / 100;
  A.agi *= 1 + (talent.agiPct || 0) / 100;
  A.int *= 1 + (talent.intPct || 0) / 100;
  A.vit *= 1 + (talent.vitPct || 0) / 100;
  A.hpPct += talent.hpPct || 0;
  // 天賦「物防/魔防鍛體、重甲/魔鎧共鳴」＝獨立乘區（連乘），於派生段套用，不併入裝備物防%/魔防%桶。
  A.critRate += talent.critRate || 0;
  A.critDmg += talent.critDmg || 0;
  A.hit += talent.hit || 0;
  A.evasion += talent.evasion || 0;
  A.shieldEff += talent.shieldEff || 0;
  // 天賦「傷害偏折/絕對偏折」＝全局減傷額外提高%（乘算），於派生段套用，不在此加定值。
  // 敵種傷害天賦不併入裝備／詞條桶；戰鬥結算時另乘一次，避免變成同一個加總百分比。
  A.talentNormalDmg += talent.normalDmg || 0;
  A.talentEliteDmg += talent.eliteDmg || 0;
  A.talentBossDmg += talent.bossDmg || 0;
  A.normalDmgRed += talent.normalDmgRed || 0;
  A.eliteDmgRed += talent.eliteDmgRed || 0;
  A.pRes += (talent.pRes || 0) + (talent.allRes || 0);
  A.mRes += (talent.mRes || 0) + (talent.allRes || 0);
  ELEMENTS.forEach(function (e3) { resist[e3] += (talent.elemRes || 0) + (talent.allRes || 0); });

  /* ---- 派生公式（st.base = 純等級/四維的基礎值，供屬性面板拆解顯示） ---- */
  var lv = p.level;
  var reincMult = reincarnationTotalMultiplier();
  var rawStr = Math.round(A.str), rawAgi = Math.round(A.agi);
  var rawInt = Math.round(A.int), rawVit = Math.round(A.vit);
  var st = { level: lv, reincarnationMultiplier: reincMult };
  // 四維主屬性：原始總值完成後，再套用轉生最終倍率。
  st.str = Math.round(rawStr * reincMult); st.agi = Math.round(rawAgi * reincMult);
  st.int = Math.round(rawInt * reincMult); st.vit = Math.round(rawVit * reincMult);
  // 基礎：生命 = (120 + (等級-1)×22 + 耐力×10 + 定值) × (1 + 生命%)
  st.base = {};
  st.base.hp = 120 + (lv - 1) * 22 + rawVit * PRIMARY_STAT_EFFECTS.vitHp;
  var rawHp = (st.base.hp + A.hpFlat) * (1 + A.hpPct / 100);
  st.hp = Math.round(rawHp * reincMult);
  st.hpRegen = A.hpRegen;                                    // 額外生命恢復/秒（另有 BASE_HP_REGEN_PCT%/秒 基礎回復）
  // 法力 =（40 + 原始智力×4 + 定值）×轉生倍率；法力恢復另依原有公式計算
  st.base.mp = 40 + rawInt * PRIMARY_STAT_EFFECTS.intMp;
  var rawMp = st.base.mp + A.mpFlat;
  st.mp = Math.round(rawMp * reincMult);
  st.mpRegen = 2 + st.int * PRIMARY_STAT_EFFECTS.intMpRegen + A.mpRegen;
  // 進攻／防禦定值的轉生指數強化：flatMult × 定值 × reincBase^轉生次數（0 轉時 = flatMult×定值）
  var reincN = reincarnationCount();
  st.reincFlatBonus = {
    atk: DERIVED_COEF.atkFlatMult * A.atkFlat * Math.pow(DERIVED_COEF.atkReincBase, reincN),
    matk: DERIVED_COEF.matkFlatMult * A.matkFlat * Math.pow(DERIVED_COEF.matkReincBase, reincN),
    def: DERIVED_COEF.defFlatMult * A.defFlat * Math.pow(DERIVED_COEF.defReincBase, reincN),
    mdef: DERIVED_COEF.mdefFlatMult * A.mdefFlat * Math.pow(DERIVED_COEF.mdefReincBase, reincN)
  };
  // 進攻：物攻 = (8 + 物攻定值 + 1.2×物攻定值×2.8^轉生次數 + 力量×1) × (1 + 物攻%)
  st.base.atk = DERIVED_COEF.atkBase + st.str * PRIMARY_STAT_EFFECTS.strAtk;
  st.atk = Math.round((st.base.atk + A.atkFlat + st.reincFlatBonus.atk) * (1 + A.atkPct / 100) * godAttackMultiplier);
  // 魔攻 = (6 + 魔攻定值 + 1.2×魔攻定值×2.8^轉生次數 + 智力×1) × (1 + 魔攻%)
  st.base.matk = DERIVED_COEF.matkBase + st.int * PRIMARY_STAT_EFFECTS.intMatk;
  st.matk = Math.round((st.base.matk + A.matkFlat + st.reincFlatBonus.matk) * (1 + A.matkPct / 100) * godAttackMultiplier);
  st.critRate = capValue(5 + st.agi * PRIMARY_STAT_EFFECTS.agiCritRate + A.critRate, STAT_CAPS.critRate);   // 暴擊率：基礎 5% + 敏捷係數
  st.critDmg = 150 + A.critDmg;                                  // 暴擊傷害：基礎 150%
  st.comboHits = comboHitsFor(st.critRate);                     // 連擊數：暴擊率破 100% 衍生的額外攻擊次數（僅普攻／技能直接傷害，持續傷害不計）
  st.pPen = capValue(A.pPen, STAT_CAPS.pPen);                                // 穿透上限（上限 0＝無上限）
  st.mPen = capValue(A.mPen, STAT_CAPS.mPen);
  st.hit = st.agi * 0 + A.hit;                                // 命中率：敏捷×a + 加成（無上限；戰鬥結算再 clamp 5~100）
  st.aspd = ASPD_CAP > 0
    ? clamp(ASPD_BASE * (1 + (A.aspdPct + st.agi * PRIMARY_STAT_EFFECTS.agiAspdPct) / 100), ASPD_MIN, ASPD_CAP)
    : Math.max(ASPD_MIN, ASPD_BASE * (1 + (A.aspdPct + st.agi * PRIMARY_STAT_EFFECTS.agiAspdPct) / 100)); // 攻速：基礎攻速、敏捷係數與上限皆由 data.js 控制
  st.cdr = capValue(A.cdr + (talent.potentialCdr || 0), STAT_CAPS.cdr);       // 潛力：時空折疊
  st.castSpeed = capValue(A.castSpeed, STAT_CAPS.castSpeed);                      // 施法速度上限（上限 0＝無上限）
  st.lifesteal = capValue(A.lifesteal, STAT_CAPS.lifesteal);                      // 吸血上限（上限 0＝無上限）
  st.manaSteal = capValue(A.manaSteal, STAT_CAPS.manaSteal);                      // 吸魔上限（上限 0＝無上限）
  // 面板仍顯示敵種傷害的合計值；戰鬥使用 base/talent 欄位，以保留兩個獨立乘區。
  st.baseEliteDmg = A.eliteDmg;
  st.baseBossDmg = A.bossDmg;
  st.baseNormalDmg = A.normalDmg;
  st.talentEliteDmg = A.talentEliteDmg;
  st.talentBossDmg = A.talentBossDmg;
  st.talentNormalDmg = A.talentNormalDmg;
  st.eliteDmg = A.eliteDmg + A.talentEliteDmg;
  st.bossDmg = A.bossDmg + A.talentBossDmg;
  st.normalDmg = A.normalDmg + A.talentNormalDmg;
  st.aoeDmg = A.aoeDmg;
  st.globalDmgRed = A.globalDmgRed * (1 + (talent.globalDmgRed || 0) / 100); // 傷害偏折/絕對偏折：全局減傷總值 ×(1+天賦%)
  st.normalDmgRed = A.normalDmgRed;   // 敵種傷害抗性（定值；減傷公式 enemyTypeDamageReduction → §3）
  st.eliteDmgRed = A.eliteDmgRed;
  st.bossDmgRed = A.bossDmgRed;
  // 防禦：物防 = (3 + 物防定值 + 0.75×物防定值×2.7^轉生次數 + 力量×0.35 + 耐力×0.65) × (1 + 物防%) × (1 + 天賦物防%［獨立乘區］)
  st.base.def = DERIVED_COEF.defBase + st.str * PRIMARY_STAT_EFFECTS.strDef + st.vit * PRIMARY_STAT_EFFECTS.vitDef;
  st.def = Math.round((st.base.def + A.defFlat + st.reincFlatBonus.def) * (1 + A.defPct / 100) * (1 + (talent.defPct || 0) / 100));
  // 魔防 = (2 + 魔防定值 + 0.75×魔防定值×2.7^轉生次數 + 智力×0.35 + 耐力×0.65) × (1 + 魔防%) × (1 + 天賦魔防%［獨立乘區］)
  st.base.mdef = DERIVED_COEF.mdefBase + st.int * PRIMARY_STAT_EFFECTS.intMdef + st.vit * PRIMARY_STAT_EFFECTS.vitMdef;
  st.mdef = Math.round((st.base.mdef + A.mdefFlat + st.reincFlatBonus.mdef) * (1 + A.mdefPct / 100) * (1 + (talent.mdefPct || 0) / 100));
  st.blockRate = capValue(A.blockRate, STAT_CAPS.blockRate);                      // 格擋率上限（上限 0＝無上限）
  st.blockDmgRed = capValue(A.blockDmgRed, STAT_CAPS.blockDmgRed);                  // 額外格擋減傷上限（總減傷 = 30% + 此值；上限 0＝不夾上限）
  st.evasion = capValue(st.agi * PRIMARY_STAT_EFFECTS.agiEvasion + A.evasion, STAT_CAPS.evasion);          // 閃避：敏捷係數（上限 0＝無上限）
  st.tenacity = capValue(A.tenacity, STAT_CAPS.tenacity);                        // 韌性上限（上限 0＝無上限）
  st.shieldEff = A.shieldEff;
  // 物理、魔法與元素抗性不設上限；仍保留下限 0，避免負抗性反向增傷。
  st.pRes = Math.max(0, Number(A.pRes) || 0);
  st.mRes = Math.max(0, Number(A.mRes) || 0);
  ELEMENTS.forEach(function (e2) { resist[e2] = Math.max(0, Number(resist[e2]) || 0); });
  resist.ctrl = capValue(resist.ctrl, STAT_CAPS.ctrlRes);
  st.resist = resist;
  // 特殊與機制
  st.ccRed = capValue(A.ccRed, STAT_CAPS.ccRed);                              // 控制時間縮減上限（上限 0＝無上限）
  st.moveSpeed = capValue(A.moveSpeed, STAT_CAPS.moveSpeed);                      // 移動速度上限（縮短出怪間隔；上限 0＝無上限）
  st.loot = effectiveDropRateEffect(A.loot);
  st.xpBonus = A.xpBonus;
  st.goldBonus = A.goldBonus;
  st.luck = capValue(A.luck, STAT_CAPS.luck);                               // 幸運值上限（上限 0＝無上限）
  st.weight = Math.round(st.str * PRIMARY_STAT_EFFECTS.strWeight + A.weight);               // 負重 = 力量係數 + 詞條
  st.enhanceSuccess = A.enhanceSuccess;
  st.decomposeYield = A.decomposeYield;
  st.hybridMutation = capValue(A.hybridMutation, STAT_CAPS.hybridMutation);            // 合成變異率上限（上限 0＝無上限）
  st.enrageThreshold = capValue(A.enrageThreshold, STAT_CAPS.enrageThreshold);          // 狂暴閾值上限（上限 0＝無上限）
  st.affixCap = capValue(A.affixCap, STAT_CAPS.affixCap);                             // 詞條上限率（上限 0＝無上限）
  st.gemEff = A.gemEff;
  // 被動上限：連擊 45%、暈眩 30%（上限 0＝無上限）
  if (passives.doubleHit) passives.doubleHit = capValue(passives.doubleHit, STAT_CAPS.doubleHit);
  if (passives.stun) passives.stun = capValue(passives.stun, STAT_CAPS.stun);
  st.passives = passives;
  st.talent = talent;
  // 2 轉元素天賦：攻擊時附加「當次傷害 × 天賦%」的元素傷害（結算於 resolveHit 元素附加段）；
  // 潛力「元素核心」把所有元素附加傷害（含裝備附魔的固定值元素攻擊）乘算提高。
  var talentElemMap = {
    fire: talent.elemFire || 0, ice: talent.elemIce || 0, lightning: talent.elemLightning || 0,
    poison: talent.elemPoison || 0, light: talent.elemLight || 0, dark: talent.elemDark || 0
  };
  var elemBoost = 1 + (talent.potentialElemAtk || 0) / 100;
  var elemDmgPct = {};
  ELEMENTS.forEach(function (e4) {
    elemAtk[e4] *= elemBoost;
    elemDmgPct[e4] = talentElemMap[e4] * elemBoost;
  });
  st.elemDmgPct = elemDmgPct;
  st.potentialRevive = talent.potentialRevive || 0;
  st.potentialLootDup = talent.potentialLootDup || 0;
  st.potentialInvCap = talent.potentialInvCap || 0;
  st.potentialExecute = talent.potentialExecute || 0;
  st.potentialShieldOverflow = talent.potentialShieldOverflow || 0;
  st.potentialManaRefund = talent.potentialManaRefund || 0;
  st.potentialTowerTime = talent.potentialTowerTime || 0;
  st.potentialOffline = talent.potentialOffline || 0;
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

// 元素附傷減免：只套用對應元素抗性，不重複套用魔法抗性
function resistanceReduction(total, enemyLevel, exponent, base, levelCoef) {
  total = Math.max(0, Number(total) || 0);
  if (total <= 0) return 0;
  var power = Math.pow(total, Number(exponent));
  var level = Number(enemyLevel) || 1;
  var denominator = power + Number(base) + Number(levelCoef) * level;
  return denominator > 0 ? power / denominator : 0;
}

var PHYSICAL_RESISTANCE_EXPONENT = 1.8;
var PHYSICAL_RESISTANCE_BASE = 10;
var PHYSICAL_RESISTANCE_LEVEL_COEF = 0.1;
var MAGIC_RESISTANCE_EXPONENT = 1.8;
var MAGIC_RESISTANCE_BASE = 10;
var MAGIC_RESISTANCE_LEVEL_COEF = 0.1;
var ELEMENTAL_RESISTANCE_EXPONENT = 1.8;
var ELEMENTAL_RESISTANCE_BASE = 10;
var ELEMENTAL_RESISTANCE_LEVEL_COEF = 0.1;

function physicalResistanceReduction(total, enemyLevel) {
  return resistanceReduction(total, enemyLevel, PHYSICAL_RESISTANCE_EXPONENT, PHYSICAL_RESISTANCE_BASE, PHYSICAL_RESISTANCE_LEVEL_COEF);
}
function magicResistanceReduction(total, enemyLevel) {
  return resistanceReduction(total, enemyLevel, MAGIC_RESISTANCE_EXPONENT, MAGIC_RESISTANCE_BASE, MAGIC_RESISTANCE_LEVEL_COEF);
}
function elementalResistanceReduction(total, enemyLevel) {
  return resistanceReduction(total, enemyLevel, ELEMENTAL_RESISTANCE_EXPONENT, ELEMENTAL_RESISTANCE_BASE, ELEMENTAL_RESISTANCE_LEVEL_COEF);
}

function elementalResistanceMultiplier(resist, element, enemyLevel) {
  var value = resist && resist[element] || 0;
  return 1 - elementalResistanceReduction(value, enemyLevel);
}

// 全局減傷：減傷率 = min(GLOBAL_DMG_RED_CAP%, 全局減傷總合 /（全局減傷總合 + GLOBAL_DMG_RED_DENOMINATOR）)。
// globalDamageReduction 回傳減傷率；globalDamageMultiplier 回傳套用後的
// 剩餘傷害倍率 = 1 − 減傷率。只在有該詞綴（total>0）時啟用，否則維持原傷害（倍率 1）。
var GLOBAL_DMG_RED_CAP = 100;   // 全局減傷上限（%）；設 0＝無上限（減傷率自然趨近 100%）
var GLOBAL_DMG_RED_DENOMINATOR = 100; // 全局減傷曲線分母；越大代表同數值減傷越低。
function globalDamageReduction(total) {
  total = Number(total) || 0;
  if (total <= 0) return 0;
  var denom = Math.max(1, Number(GLOBAL_DMG_RED_DENOMINATOR) || 1);
  var capFrac = GLOBAL_DMG_RED_CAP > 0 ? GLOBAL_DMG_RED_CAP / 100 : 1;   // 上限 0＝無上限
  return Math.min(capFrac, total / (total + denom));
}
function globalDamageMultiplier(total) {
  return 1 - globalDamageReduction(total);
}

/* ---- 敵種傷害抗性（普通敵人/普通菁英/普通BOSS，三屬性共用曲線）----
   減傷率 = 抗性值總合 / (抗性值總合 + a + b × 攻擊者等級)，a/b 與防禦減傷曲線同基準。
   於 resolveHit 全局減傷之後、最低傷害之前的最末端套用；
   依攻擊者敵種（普通/菁英/BOSS）選用防守方對應的抗性總合。 */
var ENEMY_TYPE_DMG_RED_A = 100;  // 常數 a
var ENEMY_TYPE_DMG_RED_B = 0.25;   // 攻擊者每級係數 b
function enemyTypeDamageReduction(total, attackerLevel) {
  total = Number(total) || 0;
  if (total <= 0) return 0;
  return total / (total + ENEMY_TYPE_DMG_RED_A + ENEMY_TYPE_DMG_RED_B * (Number(attackerLevel) || 1));
}

var SLOW_ASPD_FACTOR = 0.7;   // 減速狀態：攻速 -30%（攻擊冷卻累積 ×0.7）
var BASE_HP_REGEN_PCT = 1.5;  // 野外每秒基礎生命回復（最大生命 %；高塔內無此回復）
var KILL_HEAL_PCT = 12;       // 野外擊殺回復（最大生命 %，溢出轉護盾）

function slowFactor(ent) { return effectActive(ent, 'slow') ? SLOW_ASPD_FACTOR : 1; }

// 高塔 BOSS 不受會改變攻擊頻率的控制效果影響。
function isBossControlImmune(ent) { return !!(ent && ent.isBoss); }
function isAttackFrequencyControlKey(key) {
  return key === 'stun' || key === 'slow' || key === 'aspdDown' || key === 'attackSpeedDown';
}

/* ---- 控場遞減 ----
   對敵方施加會改變攻擊頻率的控制（暈眩/減速/攻速降低）時，
   實際持續時間 = 原持續 × max(0, 1 − 敵人存活秒數 × 每秒遞減%/100)。
   例：普通敵人 1%/秒 → 8 秒暈眩在戰鬥 50 秒時施放剩 4 秒、100 秒後完全無效。
   套用點＝combat.js applyEffect / applyBuff；玩家實體無 _spawnAt → 不遞減；BOSS 由 isBossControlImmune 完全免疫。 */
var CONTROL_DECAY_PER_SEC_NORMAL = 1; // 普通敵人每存活 1 秒，控制持續時間 −1%
var CONTROL_DECAY_PER_SEC_ELITE = 3;  // 菁英每秒 −3%（約 33 秒後完全免疫）
function controlDurationFactor(ent) {
  if (!ent || ent._spawnAt === undefined || ent._spawnAt === null) return 1;
  var decay = ent.elite ? CONTROL_DECAY_PER_SEC_ELITE : CONTROL_DECAY_PER_SEC_NORMAL;
  return Math.max(0, 1 - (GT - ent._spawnAt) * decay / 100);
}

/* ---- 連擊數（暴擊率破 100% 衍生的多段攻擊） ----
   語意：暴擊率 = 100% 為「完全爆擊」；超過 100% 才衍生額外攻擊次數。
   公式：連擊數 = a·ln(暴擊率%) + b·暴擊率% + c，取 max(0)。
   其中「暴擊率%」＝把暴擊率當比值直接代入（例：暴擊率 5000% → 代入 50，即 critRate 數值 ÷ 100），不做「減 100」。
   係數 COMBO_HITS_COEF 由參數表「2-屬性派生／連擊數」控制（a=自然對數乘數、b=暴擊乘數、c=常數）。
   例：暴擊率 1380% → 代入 13.8 → ≈2.57 → 固定額外 2 次 + 57% 機率第 3 次。僅作用於普攻與技能直接傷害，持續傷害不計。 */
function comboHitsFor(critRate) {
  var cr = Number(critRate) || 0;
  if (cr <= 100) return 0;                 // ≤100% 為完全爆擊，尚無連擊
  var x = cr / 100;                        // 暴擊率% 直接代入（5000% → 50）
  var n = COMBO_HITS_COEF.a * Math.log(x) + COMBO_HITS_COEF.b * x + COMBO_HITS_COEF.c;
  return n > 0 ? n : 0;
}

// 依連擊數擲骰出本次實際追加攻擊次數：整數部分固定追加，小數部分為機率再追加一次
function rollComboHits(st) {
  var c = (st && st.comboHits) || 0;
  if (c <= 0) return 0;
  var n = Math.floor(c);
  if (chance((c - n) * 100)) n++;
  return n;
}

/* ---- 共用攻擊流程（傷害結算總公式） ----
   結算順序：命中 → 防禦減傷（含破甲/穿透）→ 物/魔抗性 → ±10% 浮動
           → 暴擊 → 元素附加（含特效觸發）→ 真實傷害 → 對普通/菁英/BOSS 加成
           → 格擋 → 聖佑 → 全局減傷 → 敵種傷害抗性 → 護盾吸收 → 扣血 → 反震
   aCfg: { atk, dmgType('phys'|'magic'|'both'), level, critRate, critDmg, hit, sunder, pen,
     trueDmgPct, elemAtk, elemDmgPct, eliteDmg, bossDmg, normalDmg,
     talentEliteDmg, talentBossDmg, talentNormalDmg, isElite, isBoss, isPlayer }
         （elemAtk = 固定值元素攻擊；elemDmgPct = 2 轉天賦附傷%，按當次傷害附加）
         （isElite/isBoss = 攻擊者自身敵種，供防守方敵種傷害抗性選值）
   dCfg: { def, mdef, level, dodge, blockRate, blockDmgRed, pRes, mRes, resist{六元素+ctrl},
           ctrlRes, ccFactor, thornsPct, maxHp, isElite, isBoss,
           normalDmgRed, eliteDmgRed, bossDmgRed }
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
    pDmg *= 1 - physicalResistanceReduction(dCfg.pRes, aCfg.level || 1);   // 物理抗性：結算防禦後套用抗性曲線
    dmg += pDmg;
  }
  if (aCfg.dmgType === 'magic' || aCfg.dmgType === 'both') {
    var mPen = (aCfg.dmgType === 'both') ? (aCfg.mPen || 0) : (aCfg.pen || 0);
    var baseMAtk = (aCfg.dmgType === 'both') ? (aCfg.matk || 0) : (aCfg.atk || 0);
    var mDef = (dCfg.mdef || 0) * (1 - (aCfg.sunder || 0) / 100) * (1 - mPen / 100);
    var mDmg = baseMAtk * (1 - defReduction(mDef, aCfg.level || 1));
    mDmg *= 1 - magicResistanceReduction(dCfg.mRes, aCfg.level || 1);   // 魔法抗性：結算防禦後套用抗性曲線
    dmg += mDmg;
  }
  dmg *= rnd(0.9, 1.1);   // 傷害浮動 ±10%
  // 暴擊：傷害 × 暴傷%（基礎 150%）；神鑄特效【破滅】暴擊時機率翻倍
  if (chance(aCfg.critRate || 0)) {
    dmg *= (aCfg.critDmg || 150) / 100; out.crit = true;
    if (aCfg.annihilate && chance(aCfg.annihilate)) { dmg *= 2; out.procs.push('破滅'); }
  }
  // 元素附加（各自受對應抗性影響，並觸發元素特效）
  // 每系元素值 = 固定值元素攻擊 + 附傷基底 × 天賦附傷%；附傷基底 = 元素附加前的當次傷害（含防禦/抗性/浮動/暴擊）
  var elem = aCfg.elemAtk || null;
  var elemPct = aCfg.elemDmgPct || null;
  if (elem || elemPct) {
    var res = dCfg.resist || {};
    var ccF = (dCfg.ccFactor === undefined) ? 1 : dCfg.ccFactor;
    var attachBase = dmg;
    for (var i = 0; i < ELEMENTS.length; i++) {
      var ek = ELEMENTS[i];
      var ev = (elem && elem[ek] || 0) + attachBase * (elemPct && elemPct[ek] || 0) / 100;
      if (!ev) continue;
      var edmg = ev * elementalResistanceMultiplier(res, ek, aCfg.level || 1);
      dmg += edmg;
      // 元素特效：冰 15% 減速 2 秒｜雷 10% 追加 80% 電擊｜毒 25% 中毒（50% 元傷/秒×4 秒）
      //          光 20% 淨化自身｜暗 汲取元傷 25% 回復
      if (ek === 'ice' && chance(15) && !resistCtrl(dCfg)) { if (applyEffect(defender, 'slow', 2 * ccF)) out.procs.push('減速'); } // 控場遞減歸零時不觸發
      else if (ek === 'lightning' && chance(10)) { dmg += edmg * 0.8; out.procs.push('連鎖電擊'); }
      else if (ek === 'poison' && chance(25)) { applyPoison(defender, edmg * 0.5, 4); out.procs.push('中毒'); }
      else if (ek === 'light' && chance(20)) { cleanse(attacker); out.procs.push('淨化'); }
      else if (ek === 'dark') { out.heal += edmg * 0.25; } // 暗影汲取
    }
  }
  // 真實傷害（無視防禦與抗性）= 攻擊力 × 真傷%
  if (aCfg.trueDmgPct) dmg += aCfg.atk * aCfg.trueDmgPct / 100;
  // 對敵種傷害：裝備／詞條與 4 轉天賦分屬獨立乘區。
  // 例：既有對菁英 +10%、天賦對菁英 +1% = 原始傷害 ×1.10×1.01，不是 ×1.11。
  var typeDmg = dCfg.isBoss ? (aCfg.bossDmg || 0)
    : (dCfg.isElite ? (aCfg.eliteDmg || 0) : (aCfg.normalDmg || 0));
  var talentTypeDmg = dCfg.isBoss ? (aCfg.talentBossDmg || 0)
    : (dCfg.isElite ? (aCfg.talentEliteDmg || 0) : (aCfg.talentNormalDmg || 0));
  if (typeDmg) dmg *= 1 + typeDmg / 100;
  if (talentTypeDmg) dmg *= 1 + talentTypeDmg / 100;
  // 格擋（機率減傷）：機率與減傷上限共用 STAT_CAPS，0 代表不設上限。
  var blockChance = capValue(dCfg.blockRate || 0, STAT_CAPS.blockRate);
  if (blockChance > 0 && chance(blockChance)) {
    dmg *= 1 - blockDmgReduction(dCfg.blockDmgRed || 0) / 100;
    out.blocked = true;
  }
  // 神鑄特效【聖佑】：受到的所有傷害按比例降低（上限 50%）
  if (dCfg.dmgRed) dmg *= 1 - clamp(dCfg.dmgRed, 0, 50) / 100;
  // 全局減傷：所有既有傷害計算完成後才套用，之後才進入最低傷害與護盾結算。
  if (dCfg.globalDmgRed) dmg *= globalDamageMultiplier(dCfg.globalDmgRed);
  // 敵種傷害抗性：依攻擊者敵種（普通/菁英/BOSS）選用對應抗性值，於全局減傷之後的最末端套用。
  var typeRedTotal = aCfg.isBoss ? (dCfg.bossDmgRed || 0)
    : (aCfg.isElite ? (dCfg.eliteDmgRed || 0) : (dCfg.normalDmgRed || 0));
  if (typeRedTotal > 0) dmg *= 1 - enemyTypeDamageReduction(typeRedTotal, aCfg.level || 1);
  dmg = Math.max(1, Math.round(dmg));   // 最低傷害 1
  // 護盾吸收
  if (defender.shield && defender.shield > 0) {
    out.absorbed = Math.min(defender.shield, dmg);
    defender.shield = Math.max(0, defender.shield - out.absorbed);
    if (defender.shield <= 0) {
      defender.shieldMax = 0;
      defender.shieldMaxVersion = SHIELD_MAX_VERSION;
      defender.shieldSkillBase = 0;
      defender.shieldSkillPct = 0;
    }
    dmg -= out.absorbed;
  }
  defender.hp -= dmg;
  out.dmg = dmg + out.absorbed; // 統計上含護盾吸收量
  if (defender.hp <= 0) {
    // 神鑄特效【不朽】：致命攻擊時機率保留 1 點生命並回復 30% 最大生命（60 秒內限一次）
    if (dCfg.undying && (!defender._undyingAt || GT - defender._undyingAt >= 60) && chance(dCfg.undying)) {
      defender._undyingAt = GT;
      defender.hp = Math.max(1, Math.round((dCfg.maxHp || 1) * 0.3));
      out.procs.push('不朽');
    } else if (dCfg.potentialRevive && !defender._potentialRevived) {
      defender._potentialRevived = true;
      defender.hp = Math.max(1, Math.round((dCfg.maxHp || 1) * Math.min(100, dCfg.potentialRevive * 20) / 100));
      out.procs.push('第二命題');
    } else {
      defender.hp = 0; out.killed = true;
    }
  }
  // 反震（防守方被動）= 防守方最大生命 × 反震%
  if (dCfg.thornsPct && !out.killed) {
    out.thorns = Math.max(1, Math.round(dCfg.maxHp * dCfg.thornsPct / 100 * globalDamageMultiplier(aCfg.globalDmgRed)));
    attacker.hp -= out.thorns;
  }
  return out;
}

// 控制抵抗判定：ctrlRes% 機率完全抵抗暈眩/減速
function resistCtrl(dCfg) {
  var r = (dCfg.ctrlRes || 0);
  return r > 0 && chance(r);
}

/* ---- 治療公式 ----
   溢出治療的 SHIELD_OVERFLOW_PCT% 轉為護盾；
   護盾上限 = 最大生命 × SHIELD_HEAL_CAP_PCT% × (1 + 護盾效率%) */
var SHIELD_HEAL_CAP_PCT = 10;   // 治療轉化護盾上限（占最大生命 %）
var SHIELD_OVERFLOW_PCT = 1;    // 溢出治療轉護盾比例（%）
var SHIELD_SKILL_CAP_PCT = 10000; // 技能直接給予的護盾上限（占最大生命 %；10000 = 100 倍生命）
var SHIELD_MAX_VERSION = 2;
function refreshShieldMaxAfterGain(ent, beforeShield) {
  if (!ent) return;
  var shield = Math.max(0, ent.shield || 0);
  if (shield <= 0) {
    ent.shield = 0;
    ent.shieldMax = 0;
    ent.shieldMaxVersion = SHIELD_MAX_VERSION;
    ent.shieldSkillBase = 0;
    ent.shieldSkillPct = 0;
    return;
  }
  beforeShield = Math.max(0, beforeShield || 0);
  if (shield > beforeShield || !(ent.shieldMax > 0) || ent.shieldMax < shield) ent.shieldMax = shield;
  ent.shieldMaxVersion = SHIELD_MAX_VERSION;
}
function healPlayer(pEnt, amount, st) {
  if (amount <= 0) return;
  var space = st.hp - pEnt.hp;
  if (amount <= space) { pEnt.hp += amount; return; }
  pEnt.hp = st.hp;
  var over = amount - space;
  var cap = st.hp * (SHIELD_HEAL_CAP_PCT / 100) * (1 + (st.shieldEff || 0) / 100);
  var beforeShield = Math.max(0, pEnt.shield || 0);
  var nextShield = Math.min(cap, beforeShield + over * (SHIELD_OVERFLOW_PCT / 100));
  pEnt.shield = Math.max(beforeShield, nextShield);
  if (pEnt.shield > beforeShield) {
    pEnt.shieldSkillBase = 0;
    pEnt.shieldSkillPct = 0;
  }
  refreshShieldMaxAfterGain(pEnt, beforeShield);
}

/* ============================================================
   §4 敵方屬性
   ============================================================ */

/* ---- 野外怪物成長曲線（指數 × 線性；數值以參數表「4-野外怪物」為準）----
   生命 = (30 + 階段×8)   × 1.095^(階段-1)
   攻擊 = (6 + 階段×1.2)  × 1.11^(階段-1)
   防禦 = (2 + 階段×0.5)  × 1.08^(階段-1)（魔防 = 物防×0.75）
   金幣 = (20 + 階段)     × 1.02^(階段-1)
   經驗 = (8 + 階段)      × 1.06^(階段-1)
   命中率 = 100% + 敵人等級×4%、閃避率 = 10% + 敵人等級×4%（敵人等級 = 階段；於 resolveHit 相減後最低 5%）
   菁英：生命×3、攻擊×2、金幣/經驗×2、閃避 +5%、攻速 3
   ※ 場景倍率（ZONES 的 hpMult/atkMult/defMult/rewardMult）在
     spawnFieldMonster（combat.js）套用。 */
function monsterStatsFor(stage, elite) {
  var hp = (30 + stage * 8) * Math.pow(1.095, stage - 1);
  var atk = (6 + stage * 1.2) * Math.pow(1.11, stage - 1);
  var def = (2 + stage * 0.5) * Math.pow(1.08, stage - 1);
  var gold = (20 + stage) * Math.pow(1.02, stage - 1);
  var xp = (8 + stage) * Math.pow(1.06, stage - 1);
  var m = {
    level: stage, hp: hp, atk: atk,
    def: def,                 // 物理防禦
    mdef: def * 0.75,         // 魔法防禦
    aspd: 2,
    dodge: 10 + stage * 4,
    hit: 100 + stage * 4,     // 命中率 = 100% + 敵人等級×1%（敵人等級 = 階段）
    gold: gold, xp: xp, elite: !!elite
  };
  if (elite) {
    m.hp *= 3; m.atk *= 2; m.gold *= 2; m.xp *= 2; m.dodge += 5; m.aspd = 3;
  }
  return m;
}

// 菁英出現規則：階段為 10 的倍數
function isEliteStage(stage) { return stage % 10 === 0; }

// 高塔分區：1~50 試煉之塔、51~100 地獄之塔、101~150 煉獄之塔。
function isHellTowerFloor(floor) {
  floor = Math.floor(Number(floor) || 0);
  return floor > TOWER_TRIAL_MAX_FLOOR && floor <= TOWER_HELL_MAX_FLOOR;
}

function isPurgatoryTowerFloor(floor) {
  floor = Math.floor(Number(floor) || 0);
  return floor > TOWER_HELL_MAX_FLOOR && floor <= TOWER_PURGATORY_MAX_FLOOR;
}

// 普通關卡敵人數量：1 隻 78%、2 隻 15%、3 隻 5%、4 隻 2%。
function rollFieldEnemyCount() { return wpick(FIELD_ENEMY_COUNT_TABLE); }

/* ---- 高塔 BOSS 數值 ----
   對應野外階段 = 4 + 樓層×5（以此為基準怪物再放大）
   等級 = 對應階段+3｜生命 = 基準生命×一般倍率，再依塔區套用地獄／煉獄倍率
   攻擊 = 基準攻擊×一般倍率，再依塔區套用地獄／煉獄倍率
   攻速、閃避、命中、控制抵抗與元素附傷皆由 data.js 高塔參數控制。 */
function bossStatsFor(floor) {
  var refStage = TOWER_BOSS_REF_STAGE_BASE + floor * TOWER_BOSS_REF_STAGE_PER_FLOOR;
  var base = monsterStatsFor(refStage, false);
  var hell = isHellTowerFloor(floor);
  var purgatory = isPurgatoryTowerFloor(floor);
  var hpMult = purgatory ? TOWER_HELL_HP_MULT * TOWER_PURGATORY_HP_MULT
    : (hell ? TOWER_HELL_HP_MULT : 1);
  var atkMult = purgatory ? TOWER_HELL_ATK_MULT * TOWER_PURGATORY_ATK_MULT
    : (hell ? TOWER_HELL_ATK_MULT : 1);
  return {
    refStage: refStage,
    level: refStage + TOWER_BOSS_LEVEL_BONUS,
    hell: hell,
    purgatory: purgatory,
    hp: base.hp * TOWER_BASE_HP_MULT * hpMult,
    atk: base.atk * TOWER_BASE_ATK_MULT * atkMult,
    def: base.def * TOWER_BOSS_DEF_MULT,
    mdef: base.mdef * TOWER_BOSS_DEF_MULT,
    aspd: TOWER_BOSS_ASPD,
    dodge: Math.min(TOWER_BOSS_DODGE_BASE + floor * TOWER_BOSS_DODGE_PER_FLOOR, TOWER_BOSS_DODGE_CAP),
    hit: TOWER_BOSS_HIT_BASE + floor * TOWER_BOSS_HIT_PER_FLOOR,
    ctrlRes: TOWER_BOSS_CTRL_RES,
    elemAtkVal: base.atk * TOWER_BOSS_ELEM_ATK_BASE * (hell ? TOWER_BOSS_ELEM_HELL_MULT : 1),
    xp: base.xp * TOWER_BOSS_XP_MULT
  };
}

/* ============================================================
   §5 掉落與獎勵
   ============================================================ */

// 依等級/樓層從掉落表（data.js 的 FIELD_DROP_TABLE / BOSS_DROP_TABLE）取機率列
// 掉寶率來源平衡：裝備詞條、附魔、技能與相關分解零件的效果統一減半。
// 存檔仍保留原始數值，透過此入口計算即可讓既有物品立即套用新規則。
var DROP_RATE_EFFECT_MULT = 0.5;
var DROP_RATE_PART_KEYS = {
  ancientEssenceRate: true, duplicator: true,
  fortuneChip: true, bookScavenger: true, prospector: true
};
var SPEED_GEAR_FIXED_BONUS = 50;
function effectiveDropRateEffect(value) {
  return (Number(value) || 0) * DROP_RATE_EFFECT_MULT;
}
function effectivePartEffectValue(key, value) {
  return DROP_RATE_PART_KEYS[key] ? effectiveDropRateEffect(value) : value;
}
function effectiveFactoryPartValue(key, value) {
  return key === 'speedGear' ? (Number(value) || 0) + SPEED_GEAR_FIXED_BONUS : value;
}

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
// 熔爐可設熔爐數：0 轉 2 座、每 1 轉 +1 座、上限 NEW_FORGE_MAX(12)
function newForgeMaxFurnaces(reinc) {
  var r = Math.max(0, Math.floor(Number(reinc) || 0));
  return clamp(NEW_FORGE_BASE_FURNACES + NEW_FORGE_FURNACE_PER_REINC * r, NEW_FORGE_BASE_FURNACES, NEW_FORGE_MAX);
}
// 熔爐零件格解鎖金幣 = 50000×轉生² + 10000×(該爐已解鎖格數-1)^(4＋熔爐數量)；上限 8 格
function newForgePartSlotCost(reinc, unlocked, furnaceCount) {
  var r = Math.max(0, Math.floor(Number(reinc) || 0));
  return NEW_FORGE_SLOT_COST_REINC * r * r +
    NEW_FORGE_SLOT_COST_BASE * Math.pow(Math.max(1, unlocked - 1), NEW_FORGE_SLOT_COST_EXP + Math.max(0, furnaceCount));
}

/* ---- 稀有度擲骰（非掉落表路徑：合成產物等用）----
   權重加成 b = 1 + 掉寶加成/200 + 階段×0.006（各稀有度有權重與加成上限；
   史詩 8 階起、傳說 15 階起、神話 25 階起、創世 40 階起才可能出現） */
function rollRarity(stage, lootBonus) {
  var s = stage || 1;
  var b = 1 + effectiveDropRateEffect(lootBonus || 0) / 200 + s * 0.006;
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
var FIELD_BOOK_DROP_PCT = 4;     // 附魔書（階段 8+）
var FIELD_PART_DROP_PCT = 0.5;   // 自動機組零件（階段 5+，機率低；菁英掉落率同乘菁英倍率）
var ELITE_DROP_MULT = 1.3;       // 菁英掉落倍率：裝備與材料都在一般基礎上乘此值（野外與離線收益共用）

/* ---- 太古詞條／太古精華機率 ---- */
function ancientAffixChanceForEnemy(level) {
  level = Number(level) || 0;
  if (level < ANCIENT_ENEMY_MIN_LEVEL) return ANCIENT_AFFIX_BASE_RATE;
  return Math.min(ANCIENT_AFFIX_RATE_CAP,
    ANCIENT_AFFIX_BASE_RATE + (level - ANCIENT_ENEMY_MIN_LEVEL) * ANCIENT_AFFIX_ENEMY_RATE);
}
// 高塔太古機率一律以「樓層」計算；勿傳 BOSS 等級（= 樓層×5+7，會使機率過早封頂）。
function ancientBossAffixChanceForBoss(floor) {
  floor = Number(floor) || 0;
  if (floor < 40) return 0;
  return Math.min(100, ANCIENT_BOSS_AFFIX_BASE_RATE + (floor - 40) * ANCIENT_BOSS_AFFIX_LEVEL_RATE);
}
function ancientEssenceDropChanceForEnemy(level) {
  level = Number(level) || 0;
  if (level < ANCIENT_ENEMY_MIN_LEVEL) return 0;
  return Math.min(ANCIENT_ESSENCE_ENEMY_RATE_CAP,
    ANCIENT_ESSENCE_ENEMY_BASE_RATE + (level - ANCIENT_ENEMY_MIN_LEVEL) * ANCIENT_ESSENCE_ENEMY_LEVEL_RATE);
}
function ancientEssenceDropChanceForBoss(floor) {
  floor = Number(floor) || 0;
  if (floor < 40) return 0;
  return Math.min(ANCIENT_ESSENCE_BOSS_RATE_CAP,
    ANCIENT_ESSENCE_BOSS_BASE_RATE + (floor - 40) * ANCIENT_ESSENCE_BOSS_LEVEL_RATE);
}
function ancientEssenceSalvageChanceForRarity(rarity) {
  return ANCIENT_ESSENCE_SALVAGE_CHANCE[rarity] || 0;
}

// 野外掉落零件的階級：隨階段成長（每 12 階 +1），菁英再 +1，上限 T7
function fieldPartTierFor(stage, elite) {
  return clamp(1 + Math.floor(stage / 12) + (elite ? 1 : 0), 1, PART_MAX_TIER);
}

// 野外寶石掉落率：依怪物等級查表，各階級獨立判定
function fieldGemDropRatesFor(level) {
  return dropRatesFor(FIELD_GEM_DROP_TABLE, level);
}

// 高塔挑戰金幣消耗 = 100000 × 樓層^2.6
function towerChallengeCost(floor) {
  return Math.round(100000 * Math.pow(Math.max(1, Number(floor) || 1), 2.6));
}

// 高塔 BOSS 魔塵掉落率 = min(30%, 2% + 樓層 × 0.2%)
function bossDustRate(floor) {
  return Math.min(DUST_BOSS_CAP, DUST_BOSS_BASE + floor * DUST_BOSS_PER_LEVEL);
}

// 地獄之塔魔魂本源掉落率 = 5% +（樓層 - 51）× 1%；只在 51~100 樓生效。
function hellSoulOriginDropChance(floor) {
  floor = Math.floor(Number(floor) || 0);
  if (!isHellTowerFloor(floor)) return 0;
  return Math.min(100, TOWER_HELL_SOUL_ORIGIN_BASE_RATE +
    (floor - TOWER_TRIAL_MAX_FLOOR - 1) * TOWER_HELL_SOUL_ORIGIN_PER_FLOOR);
}

// 野外魔塵掉落率 = min(5%, 0.1% + (敵人等級 - 150) × 0.1%)；150 級以下不掉落
function fieldDustRate(level) {
  if (level < DUST_FIELD_MIN_LEVEL) return 0;
  return Math.min(DUST_FIELD_CAP, DUST_FIELD_BASE + (level - DUST_FIELD_MIN_LEVEL) * DUST_FIELD_PER_LEVEL);
}

/* ---- 高塔通關獎勵 ----
   零件階級 = 1 + ⌊(樓層-1)/4⌋（上限 T7）；首通必得，重複通關 30%
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
function ancientAffixValue(key, itemLevel, rarityIdx) {
  var def = AFFIX_POOL[key];
  var r = RARITIES[rarityIdx];
  var baseV = (def.base + def.base * def.lv * (itemLevel - 1)) * r.mult;
  var v = baseV * 1.2 * ANCIENT_AFFIX_VALUE_MULT;
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

// 神鑄創世專屬特效數值 = base × rnd(0.8, 1.2)
function godforgePassiveValue(key) {
  var d = GODFORGE_POOL[key];
  return Math.round(d.base * rnd(0.8, 1.2) * 10) / 10;
}

// 神鑄成功率（裝備）= 基礎（依素材品質）+ 魔塵數 × 5%
function forgeSuccessRateFor(rarity, dustCount) {
  return clamp((FORGE_BASE_RATE[rarity] || 0) + dustCount * FORGE_DUST_RATE, 0, 100);
}

// 神鑄成功率（寶石）= 基礎（依素材階級）+ 魔塵數 × 3%
function forgeGemSuccessRateFor(level, dustCount) {
  return clamp((FORGE_GEM_BASE_RATE[level] || 0) + dustCount * FORGE_GEM_DUST_RATE, 0, 100);
}

// 寶石神鑄金幣費用 = 1000000 + (素材階級 - 5) × 1000000
function forgeGemCost(level) {
  return 1000000 + (level - GEM_MAX_LEVEL) * 1000000;
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
  lifesteal: 2.2, manaSteal: 1.4, eliteDmg: 1.2, bossDmg: 1.2, normalDmg: 1.2, aoeDmg: 1.4, globalDmgRed: 1.0,
  normalDmgRed: 1.0, eliteDmgRed: 1.0, bossDmgRed: 1.0,
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
  if (it.godPassives && it.godPassives.length) s *= 1 + 0.15 * it.godPassives.length; // 神鑄創世專屬特效
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
   附魔精華 = rollDropCount(稀有度基礎機率 × (1 + 精粹透鏡加成總合/100))
   鑲嵌寶石會在分解前取回，但分解本身不產出寶石。 */
var ANCIENT_AFFIX_SALVAGE_CHANCE = 50;
var ESSENCE_SALVAGE_CHANCE_BY_RARITY = [0.1, 0.5, 1, 2, 4, 8, 20, 100, 100];
function essenceSalvageChanceForRarity(rarity) {
  var idx = clamp(Math.floor(Number(rarity) || 0), 0, ESSENCE_SALVAGE_CHANCE_BY_RARITY.length - 1);
  return ESSENCE_SALVAGE_CHANCE_BY_RARITY[idx];
}
function salvageResult(it, ancientEssenceBonus, essenceBonus) {
  var r = RARITIES[it.rarity];
  var out = {
    scrap: Math.max(1, Math.round((2 + it.level * 0.6) * r.salv * rnd(0.85, 1.15))),
    gold: Math.round((3 + it.level) * r.salv * 0.5),
    essence: 0, ancientEssence: 0
  };
  var essenceChance = essenceSalvageChanceForRarity(it.rarity) *
    (1 + Math.max(0, Number(essenceBonus) || 0) / 100);
  out.essence = rollDropCount(essenceChance);
  var ancientBaseChance = ancientEssenceSalvageChanceForRarity(it.rarity);
  var ancientSalvageChance = ancientBaseChance * (1 + (Number(ancientEssenceBonus) || 0) / 100);
  var ancientEssenceWon = ancientSalvageChance > 0 && chance(ancientSalvageChance);
  if (!ancientEssenceWon && it.affixes) {
    for (var ai = 0; ai < it.affixes.length; ai++) {
      if (it.affixes[ai] && it.affixes[ai].ancient && chance(ANCIENT_AFFIX_SALVAGE_CHANCE)) {
        ancientEssenceWon = true;
        break;
      }
    }
  }
  if (ancientEssenceWon) out.ancientEssence = 1;
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
   精華 = 普通～傳說沿用 1 + 稀有度；神話／創世／神鑄創世固定為 9／14／20 */
function rerollCost(it) {
  var essence = REROLL_ESSENCE_COST[it.rarity];
  if (essence === undefined) essence = 1 + it.rarity;
  return {
    gold: Math.round(40 * Math.pow(1.7, it.rarity) * (1 + it.level * 0.15)),
    essence: essence
  };
}

// 太古精華洗煉消耗數量：依裝備稀有度查表（REROLL_ANCIENT_ESSENCE_COST；越界夾在有效範圍）
function rerollAncientEssenceCostFor(rarity) {
  var arr = REROLL_ANCIENT_ESSENCE_COST;
  var idx = clamp(Math.floor(Number(rarity) || 0), 0, arr.length - 1);
  return arr[idx];
}

// 合成大成功率 = 基礎 5% + 幸運核心零件加成 + 幸運值/2（稀有度額外 +1）
function synthGreatChanceNow() {
  return SYNTH_GREAT_BASE + partBonus('synth', 'luckCore') + getStats().luck / 2;
}

// 背包擴充費用：10000 × 購買次數²（購買次數 = 已擴充次數 + 1，即本次為第幾次擴充）
function inventoryExpandCost(upg) {
  var n = (upg || 0) + 1;
  return 10000 * n * n;
}

// 生產線容量（受「負重上限」屬性擴充）
function conveyorCap() { return CONVEYOR_CAP; }                              // 輸送帶固定上限
function synthBufCap() { return SYNTH_BUFFER_CAP + Math.floor(getStats().weight / 2); } // 暫存區 = 30 + 負重/2

// 分解槽零件安裝格數：目前初始 10 格，使用金幣逐格解鎖，最高 20 格。
// 舊存檔沒有 salvageSlots 欄位時由 migrateSave 保留既有 10 格。
var SALVAGE_SLOT_MAX = 20;
var SALVAGE_SLOT_INITIAL = 10;
var SALVAGE_SLOT_LEGACY_DEFAULT = 10;
var SALVAGE_SLOT_UNLOCK_GOLD_BASE = 10000;
var SALVAGE_SLOT_UNLOCK_GOLD_RATE = 3;
function salvageSlotCount() {
  if (typeof G === 'undefined' || !G || !G.factory || G.factory.salvageSlots === undefined) return SALVAGE_SLOT_LEGACY_DEFAULT;
  var slots = Math.floor(Number(G.factory.salvageSlots) || SALVAGE_SLOT_INITIAL);
  if (slots < SALVAGE_SLOT_INITIAL) {
    G.factory.salvageSlots = SALVAGE_SLOT_INITIAL;
    return SALVAGE_SLOT_INITIAL;
  }
  slots = clamp(slots, SALVAGE_SLOT_INITIAL, SALVAGE_SLOT_MAX);
  G.factory.salvageSlots = slots;
  return slots;
}
// 解鎖至第 N 格的費用：10,000 × 3^(N-1)，N 為解鎖後的目標格數。
function salvageSlotUnlockCost(currentSlots) {
  var current = clamp(Math.floor(Number(currentSlots) || SALVAGE_SLOT_INITIAL), SALVAGE_SLOT_INITIAL, SALVAGE_SLOT_MAX);
  if (current >= SALVAGE_SLOT_MAX) return 0;
  var target = current + 1;
  return SALVAGE_SLOT_UNLOCK_GOLD_BASE * Math.pow(SALVAGE_SLOT_UNLOCK_GOLD_RATE, target - 1);
}

/* ============================================================
   §8 寶石
   ============================================================ */

/* 寶石能力數值：
   1~5 階（一般）= base × 等級 × (1 + 0.2 × (等級-1))
   6~10 階（神鑄）= 五階數值 × 2^(階級-5)（每高 1 階能力 ×2） */
function gemStatValue(type, level) {
  var g = GEM_TYPES[type];
  if (level > GEM_MAX_LEVEL) {
    var base5 = g.base * GEM_MAX_LEVEL * (1 + 0.2 * (GEM_MAX_LEVEL - 1));
    return Math.round(base5 * Math.pow(2, level - GEM_MAX_LEVEL) * 10) / 10;
  }
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
var GEM_CONVERT_STACK = 1000;   // 每格同種同級寶石上限
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

// 商店手動刷新費用 = 5000 ×（下一次重置序號 ^ 2.5）；次數每 8 小時重置
function shopRefreshCost() {
  var resetNo = (gemShop().refreshCount || 0) + 1;
  return Math.round(GEM_SHOP_REFRESH_BASE * Math.pow(resetNo, GEM_SHOP_REFRESH_EXPONENT));
}

// 寶石商店升級費用 = 10000 + 商店等級^3 × 4000000；Lv.20 已滿級
function gemShopUpgradeCost(level) {
  level = clamp(level || 1, 1, GEM_SHOP_MAX_LEVEL);
  if (level >= GEM_SHOP_MAX_LEVEL) return 0;
  return 10000 + Math.pow(level, 3) * 4000000;
}

/* ============================================================
   §9 技能
   ============================================================ */

var SKILL_MAX_LV = 10;         // 一般技能等級上限（保留給外部參照）
var SKILL_CAST_LOCK = 0.5;     // 施放硬直（秒；實際 = 0.5 × (1 - 施法速度%)）
var SKILL_GLOBAL_COOLDOWN = 0.4; // 技能共用冷卻（秒；固定值，不受冷卻縮減影響）
var TIER_GATE_POINTS = 3;      // 技能樹：每階層需在該系已投入的點數（第 N 階需 N×3 點）

// 裝載欄：角色每 20 級 +1 格（最低 2 格，最多 20 格）
function loadoutSize() { return Math.min(20, Math.max(2, Math.floor(G.player.level / 20))); }

// 技能升級金幣費用 = 20000 × 當前等級 + 20^(1 + 當前等級/10)
function skillUpgradeCost(lv) {
  var cost = Math.floor(20000 * lv + Math.pow(20, 1 + lv / 10));
  return Math.min(5000000, cost);
}

// 各類技能等級上限：每轉生一般技能 +10、融合技 +20。
function skillMaxLv(def) {
  var rc = reincarnationCount();
  if (def && def.cat === 'fusion') return (def.maxLv || 40) + rc * 20;
  if (def && def.cat === 'passive') return 30 + rc * 10;
  return 20 + rc * 10;
}

// 技能傷害倍率（%）= base + per × (等級-1)
function skillValue(sk, lv) { return (sk.fx.base || 0) + (sk.fx.per || 0) * (lv - 1); }
// 實際冷卻 = 技能冷卻 × (1 - 冷卻縮減%)
function skillCdFor(sk) { return sk.cd * (1 - getStats().cdr / 100); }
// 技能基礎法力消耗：融合技能取所有素材技能的原始消耗總和。
function skillBaseManaCost(def) {
  if (!def) return 0;
  if (def.cat === 'fusion' && Array.isArray(def.components)) {
    var total = 0, found = 0;
    for (var i = 0; i < def.components.length; i++) {
      var component = (typeof SKILLS !== 'undefined') ? SKILLS[def.components[i]] : null;
      if (!component) continue;
      total += Math.max(0, Number(component.cost) || 0);
      found++;
    }
    if (found) return total;
  }
  return Math.max(0, Number(def.cost) || 0);
}
// 實際法力消耗 = 基礎消耗 ×（1 + 10% ×（技能等級 - 1））；非複利。
function skillManaCost(def, level) {
  if (!def || def.cat === 'passive') return 0;
  var lv = Math.max(1, Number(level) || 1);
  return Math.max(0, Math.round(skillBaseManaCost(def) * (1 + 0.1 * (lv - 1))));
}
// buff/heal 等 {base,per} 縮放通用式 = base + per × (等級-1)
function scaleAt(def, lv) { return def.base + def.per * (lv - 1); }

/* ---- 技能融合參數 ---- */
var FUSE_FACTOR = 0.75;           // 素材效果繼承比例（傷害/元素占比等 ×0.75 後合併；2026-07-09 由 0.6 上調，融合技傷害最高可達舊版 +300%）
var FUSION_MUTATION_CHANCE = 45;  // 變異基礎機率 %（實際 = 45 + 幸運值/3）
var FUSION_CD_FACTOR = 1.25;      // 融合技冷卻 = 素材最長冷卻 × 1.25

// 融合變異觸發率 = 基礎 45% + 幸運值/3
function fusionMutationChance() { return FUSION_MUTATION_CHANCE + getStats().luck / 3; }

/* ============================================================
   §10 離線收益
   ============================================================ */

var OFFLINE_MAX_HOURS = 24;        // 離線收益時間上限（小時）；1 分鐘內不計
var OFFLINE_LEVEL_REDUCE = 10;    // 計算等級扣減：目前地圖最高階段 − 此值，再捨去個位數（下限 1）
var OFFLINE_KILL_INTERVAL = 20;   // 擊殺速率：每隔此秒數擊殺 1 隻菁英怪

// 離線計算等級 = max(1, ⌊(目前地圖最高階段 − OFFLINE_LEVEL_REDUCE) / 10⌋ × 10)
// 例：沼澤最高 256 → 256 − 10 = 246 → 捨去個位數 → 240 級沼澤菁英怪
function offlineStageFor(best) {
  var s = Math.floor((Math.max(1, Math.floor(Number(best) || 1)) - OFFLINE_LEVEL_REDUCE) / 10) * 10;
  return Math.max(1, s);
}

// 離線擊殺數 = ⌊有效離線秒數 / 擊殺間隔 × (1 + 離線預言%)⌋；每隻菁英怪掉落單獨擲骰（save.js）
function offlineKillCount(elapsed, potentialOfflinePct) {
  var interval = Math.max(1, Number(OFFLINE_KILL_INTERVAL) || 1);
  return Math.max(0, Math.floor(elapsed / interval * (1 + (Number(potentialOfflinePct) || 0) / 100)));
}
