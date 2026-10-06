'use strict';
/* ============ 傳奇特效執行引擎 ============
   數值與效果規格只讀 PASSIVE_POOL；本檔負責戰鬥期路由與短暫狀態，不寫入存檔。
   新版技能（js/skills2.js）的關聯技能改寫由 legendarySkill2Mods 集中提供。 */

var LEGENDARY_RT = null;

function resetLegendaryRT() {
  LEGENDARY_RT = {
    basicAttackCount: 0,
    berserkStacks: 0,
    berserkUntil: 0,
    queue: [],
    knives: [],
    knivesStarted: false,
    dolls: [],
    dollsStarted: false,
    nextLightAt: 0,
    nextFireDrainAt: 0,
    lightShieldArmed: true,
    lightShieldCooldownUntil: 0,
    lightShieldUntil: 0,
    lightShieldGranted: 0
  };
  if (typeof rwResetRT === 'function') rwResetRT();   // 符文之語的戰鬥期狀態一併重置（js/runeword.js）
}
resetLegendaryRT();

function legendaryEnsureRT() {
  if (!LEGENDARY_RT) resetLegendaryRT();
  return LEGENDARY_RT;
}

function legendaryHas(st, key) {
  return !!(st && st.legendaryEffects && st.legendaryEffects[key]);
}

function legendaryClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

var LEGENDARY_FX_NON_VALUE_KEYS = {
  chance: true, count: true, bounces: true, hits: true, maxStacks: true,
  tickSec: true, sec: true, dur: true, gap: true, interval: true, cd: true, cooldownSec: true,
  /* 減免類的百分比：×2 會把「降低 50%」變成「降低 100%」＝代價完全消失，
     方向與補償的用意（讓雙手武器的一個特效抵得上兩個）相反，因此不放大。 */
  reducePct: true,
  basicAttackThreshold: true,
  killExtend: true, double: true, triple: true
};

function legendaryScaleFxValues(value, mult, key) {
  if (Array.isArray(value)) return value.map(function (v) { return legendaryScaleFxValues(v, mult, key); });
  if (!value || typeof value !== 'object') {
    return typeof value === 'number' && !LEGENDARY_FX_NON_VALUE_KEYS[key] ? value * mult : value;
  }
  var out = {};
  for (var k in value) out[k] = legendaryScaleFxValues(value[k], mult, k);
  return out;
}

function legendaryFx(key) {
  var def = PASSIVE_POOL[key];
  if (!def || !def.fx) return {};
  var st = (typeof getStats === 'function') ? getStats() : null;
  var mult = st && st.legendaryEffectMults ? Number(st.legendaryEffectMults[key]) || 1 : 1;
  return mult === 1 ? def.fx : legendaryScaleFxValues(def.fx, mult, '');
}

/* ---- 新版技能（js/skills2.js）的傳奇改寫收斂點（2026-08-19）----
   新版技能群組走 castSkill2。與其在 skills2.js 各處散落 legendaryHas(...) 判斷，這裡提供唯一入口：
   把「relatedSkill 指向該群組 id 且目前生效」的所有傳奇特效的 fx **平坦合併**成一個物件，
   施放端只讀通用參數鍵（thrustLenPct、cleaveFlyM…），不必認得特效 id。
   同名參數鍵的合併規則：**數字相加**（兩個都加 30% 技能傷害就是 +60%，比照詞條加總），
   其餘型別（布林旗標、規格物件）後者覆蓋前者。因此規格物件請一個特效用一個獨立鍵。 */
function legendarySkill2Mods(gid) {
  if (!gid || typeof PASSIVE_POOL === 'undefined') return null;
  var st = (typeof getStats === 'function') ? getStats() : null;
  if (!st || !st.legendaryEffects) return null;
  var out = null;
  for (var key in PASSIVE_POOL) {
    var def = PASSIVE_POOL[key];
    if (!def || def.relatedSkill !== gid || !def.fx) continue;
    if (!legendaryHas(st, key)) continue;
    var fx = legendaryFx(key);
    if (!out) out = {};
    for (var k in fx) {
      out[k] = (typeof fx[k] === 'number' && typeof out[k] === 'number') ? out[k] + fx[k] : fx[k];
    }
  }
  return out;
}

function legendarySettleTriggeredDeaths(result) {
  if (!result || !result.killed) return;
  if (typeof G !== 'undefined' && G && G.tower && G.tower.active) {
    return;
  }
  if (typeof onFieldDeaths === 'function') onFieldDeaths();
}

function legendaryCurrentPlayer() {
  if (typeof G !== 'undefined' && G && G.tower && G.tower.active &&
      typeof TOWER !== 'undefined' && TOWER.player) return TOWER.player;
  if (typeof FIELD !== 'undefined' && FIELD.player) return FIELD.player;
  return null;
}

/* 自動攻擊類特效的目標：離我方最近的敵人（同距離隨機、沿用普攻鎖定）→ js/battlefield.js
   未載入格位模組時退回陣列第一個，行為與改造前一致。 */
function legendaryNearestEnemy(enemies, pEnt) {
  if (typeof bfPickPrimary === 'function') {
    return bfPickPrimary(enemies, pEnt && pEnt._lockTarget) || enemies[0];
  }
  return enemies[0];
}

function legendaryActiveEnemies() {
  if (typeof G !== 'undefined' && G && G.tower && G.tower.active &&
      typeof TOWER !== 'undefined' && TOWER.boss && TOWER.boss.hp > 0) return [TOWER.boss];
  if (typeof liveFieldEnemies === 'function') return liveFieldEnemies();
  return [];
}

function legendaryDualDaggersEquipped() {
  if (typeof G === 'undefined' || !G || !G.equipment) return false;
  var main = G.equipment.weapon;
  var off = G.equipment.weapon2;
  return !!(main && off && main.weaponType === 'dagger1h' && off.weaponType === 'dagger1h');
}

function legendaryControlDuration(ent, key, dur) {
  if (!ent || !ent.maxHp || (key !== 'stun' && key !== 'slow') || typeof getStats !== 'function') return dur;
  var st = getStats();
  if (!legendaryHas(st, 'mountainSunderer')) return dur;
  return dur * (legendaryFx('mountainSunderer').controlDurationMult || 1);
}

function legendaryAttackSpeedMultiplier(pEnt, st) {
  var rt = legendaryEnsureRT();
  var mult = 1;
  if (legendaryHas(st, 'whirlwindStab') && legendaryDualDaggersEquipped()) {
    mult *= 1 + legendaryFx('whirlwindStab').dualDaggerAspdPct / 100;
  }
  if (legendaryHas(st, 'berserkBloodAxe') && rt.berserkUntil > GT) {
    mult *= 1 + rt.berserkStacks * legendaryFx('berserkBloodAxe').onKillBuff.aspdPct / 100;
  }
  if (typeof rwAttackSpeedMultiplier === 'function') mult *= rwAttackSpeedMultiplier(); // 符文之語（js/runeword.js）
  return mult;
}

function legendaryElementDamageUp(st, pEnt) {
  var out = {};
  var src = st && st.elemDmgUp || {};
  for (var key in src) out[key] = src[key];
  /* 本函式是全專案「屬性傷害提升%」的唯一收斂點（普攻與技能都由此取值），
     所以增益型的屬性加成一律掛在這裡，而不是各傷害端各補一次。
     新版技能【火焰增幅】（js/skills2.js）即循此掛入。 */
  if (typeof skill2FireAmpPct === 'function') {
    var fireAmp = skill2FireAmpPct(pEnt);
    if (fireAmp > 0) out.fire = (out.fire || 0) + fireAmp;
  }
  /* 新版技能超神【超重力場】（岩甲術，js/skills2.js）：岩甲期間的土系傷害提升。
     與【火焰增幅】同一條路——加算進該屬性目前的提升%，不另開乘區。 */
  if (typeof skill2RockEarthDamageUpPct === 'function') {
    var earthAmp = skill2RockEarthDamageUpPct(pEnt);
    if (earthAmp > 0) out.earth = (out.earth || 0) + earthAmp;
  }
  /* 新版技能超神【永恒超導體】（連鎖閃電，js/skills2.js）：超導電荷的雷電傷害提升。
     與前兩者同一條路——加算進該屬性目前的提升%，不另開乘區。 */
  if (typeof skill2LightningDamageUpPct === 'function') {
    var lightningAmp = skill2LightningDamageUpPct(pEnt);
    if (lightningAmp > 0) out.lightning = (out.lightning || 0) + lightningAmp;
  }
  /* 新版技能【大地祝福】（大地守護 T2）：全屬性傷害的**乘算**增幅——
     設計文檔明訂「與所有屬性增傷效果為額外的乘法計算」，因此不是再加一筆%，
     而是把每個屬性目前的加成整體放大。 */
  if (typeof skill2ElemDamageUpPct === 'function') {
    var allElem = skill2ElemDamageUpPct();
    if (allElem > 0) {
      var keys = (typeof ELEMENTS !== 'undefined' && ELEMENTS.length)
        ? ELEMENTS : ['fire', 'ice', 'lightning', 'poison', 'light', 'dark', 'earth'];
      for (var ei = 0; ei < keys.length; ei++) {
        var ek = keys[ei];
        out[ek] = ((1 + (out[ek] || 0) / 100) * (1 + allElem / 100) - 1) * 100;
      }
    }
  }
  return out;
}

function legendaryEnemyFloatSel(floatSel) {
  return ({ 'pv-float': 'mv-float', 'tp-float': 'tb-float' })[floatSel] || floatSel;
}

/* 玩家最終傷害共同乘區：普攻、技能與排程傷害都由 resolveHit 進入此函式。 */
function legendaryOutgoingDamageMultiplier(attacker, defender, aCfg) {
  if (!aCfg || !aCfg.isPlayer || typeof getStats !== 'function') return 1;
  var st = getStats();
  var rt = legendaryEnsureRT();
  var mult = 1;
  if (legendaryHas(st, 'mountainSunderer') && defender &&
      (effectActive(defender, 'stun') || effectActive(defender, 'slow'))) {
    mult *= 1 + legendaryFx('mountainSunderer').controlledTargetDamagePct / 100;
  }
  if (legendaryHas(st, 'doomProphet') && attacker) {
    var doom = legendaryFx('doomProphet');
    if ((attacker.shield || 0) <= 0) mult *= 1 + doom.noShieldDamagePct / 100;
    var hpPct = st.hp > 0 ? clamp(attacker.hp / st.hp * 100, 0, 100) : 100;
    var steps = Math.floor((100 - hpPct + 1e-9) / doom.missingHpStepPct);
    if (steps > 0) mult *= 1 + steps * doom.damagePerStepPct / 100;
  }
  if (legendaryHas(st, 'berserkBloodAxe') && rt.berserkUntil > GT) {
    mult *= 1 + rt.berserkStacks * legendaryFx('berserkBloodAxe').onKillBuff.atkPct / 100;
  }
  // 符文之語的條件式增傷（js/runeword.js）：與傳奇特效同一個乘區入口
  if (typeof rwOutgoingMultiplier === 'function') mult *= rwOutgoingMultiplier(attacker, defender, aCfg);
  return mult;
}

function legendaryDotDamageMultiplier(ent) {
  var pEnt = legendaryCurrentPlayer();
  if (!pEnt || !ent) return 1;
  return legendaryOutgoingDamageMultiplier(pEnt, ent, { isPlayer: true });
}

/* 燃燒法則：applyDot 呼叫此函式；非燃燒或未裝備時回傳 null。 */
function legendaryInstantBurn(ent, dps, dur, name) {
  if (!ent || !ent.maxHp || name !== '燃燒' || typeof getStats !== 'function') return null;
  var st = getStats();
  if (!legendaryHas(st, 'burningLaw')) return null;
  var pEnt = legendaryCurrentPlayer() || {};
  var burnFx = legendaryFx('burningLaw');
  var damage = Math.max(1, Math.round(dps * dur * (1 + burnFx.burnDamagePct / 100) *
    legendaryOutgoingDamageMultiplier(pEnt, ent, { isPlayer: true })));
  damage = applyEnemyHpDamage(ent, damage);
  if (typeof trackDps === 'function') trackDps(damage);
  if (typeof recordRunDamage === 'function') recordRunDamage('燃燒法則', damage);
  return damage;
}

function legendaryDamageCfg(pEnt, st, powerPct, dmgType, elem) {
  var stat = dmgType === 'phys' ? (st.atk || 0) : (st.matk || st.atk || 0);
  var base = stat * powerPct / 100;
  // 技能屬性化（2026-07-26）：帶屬性的特效傷害整段即為該屬性魔法傷害，與技能同規格（吃得到爆擊）
  var resolvedType = elem ? 'magic' : (dmgType || 'phys');
  var cfg = {
    atk: base,
    dmgType: resolvedType,
    level: st.level || 1,
    critRate: st.critRate || 0,
    critDmg: st.critDmg || 150,
    hit: Math.max(100, st.hit || 100),
    pen: resolvedType === 'phys' ? effectivePPen(st, pEnt) : effectiveMPen(st, pEnt),   // 穿透含技能增益 penUp
    sunder: st.passives && st.passives.sunder || 0,
    trueDmgPct: 0,
    elemAtk: null,
    elemDmgPct: st.elemDmgPct,
    elemDmgUp: legendaryElementDamageUp(st, pEnt),
    eliteDmg: st.eliteDmg,
    bossDmg: st.bossDmg,
    normalDmg: st.normalDmg,
    totalDmgPct: (st.totalDmgPct || 0) + buffVal(pEnt, 'allDmgUp'),
    dmgVsElem: st.dmgVsElem,
    isPlayer: true
  };
  if (elem) cfg.skillElem = elem;
  return cfg;
}

function legendaryDealDamage(pEnt, target, powerPct, dmgType, elem, floatSel, label, ctx) {
  if (!target || target.hp <= 0 || typeof getStats !== 'function') return null;
  var st = getStats();
  var result = resolveHit(pEnt, target, legendaryDamageCfg(pEnt, st, powerPct, dmgType, elem), monsterDefCfg(target));
  if (!result.miss && result.dmg > 0) {
    if (typeof floatEnemyEvent === 'function') {
      floatEnemyEvent(target, floatSel, fmt(result.dmg), combatDamageFloatClass('enemy-skill', result), result.dmg);
    }
    if (typeof trackDps === 'function') trackDps(result.dmg);
    if (typeof recordRunDamage === 'function') recordRunDamage(label || '傳奇特效', result.dmg);
    if (ctx && typeof ctx.onDamage === 'function') ctx.onDamage(result.dmg);
  }
  return result;
}

/* 取得一次不改動目標的原始普攻最終傷害，供「以普攻傷害為基準」的特效使用。 */
function legendaryPreviewBasicAttack(pEnt, target) {
  if (!pEnt || !target || typeof playerAtkCfg !== 'function' ||
      typeof monsterDefCfg !== 'function' || typeof resolveHit !== 'function') return null;
  var previewTarget = {};
  for (var key in target) previewTarget[key] = target[key];
  if (target.effects) previewTarget.effects = legendaryClone(target.effects);
  if (target.buffs) previewTarget.buffs = legendaryClone(target.buffs);
  if (target.dots) previewTarget.dots = legendaryClone(target.dots);
  previewTarget._sgPreview = true; // 預覽命中：blood 反噬等「敵人受傷」掛鉤須忽略（js/skills2.js）
  var result = resolveHit(pEnt, previewTarget, playerAtkCfg(pEnt), monsterDefCfg(target));
  return result && !result.miss ? result : null;
}

/* 反擊傷害已是原始普攻的最終值，因此只套用特效倍率，不再重複經過目標防禦。 */
function legendaryDealReflectedBasicAttack(pEnt, target, multiplier, floatSel, label) {
  var preview = legendaryPreviewBasicAttack(pEnt, target);
  var mult = Math.max(0, Number(multiplier) || 0);
  if (!preview || !(preview.dmg > 0) || !(mult > 0)) return null;

  var damage = Math.max(1, Math.round(preview.dmg * mult));
  var absorbed = 0;
  if (target.shield && target.shield > 0) {
    absorbed = Math.min(target.shield, damage);
    target.shield = Math.max(0, target.shield - absorbed);
    damage -= absorbed;
  }
  damage = applyEnemyHpDamage(target, damage);
  var result = {
    dmg: damage + absorbed,
    absorbed: absorbed,
    miss: false,
    crit: false,
    blocked: false,
    killed: target.hp <= 0,
    thorns: 0,
    heal: 0,
    procs: []
  };
  if (result.killed) target.hp = 0;
  if (typeof floatEnemyEvent === 'function') {
    floatEnemyEvent(target, floatSel, fmt(result.dmg), combatDamageFloatClass('enemy-skill', result), result.dmg);
  }
  if (typeof trackDps === 'function') trackDps(result.dmg);
  if (typeof recordRunDamage === 'function') recordRunDamage(label || '傳奇特效', result.dmg);
  return result;
}

function legendaryDealAoe(pEnt, enemies, powerPct, dmgType, elem, floatSel, label, ctx) {
  var total = 0;
  var killed = false;
  for (var i = 0; i < enemies.length; i++) {
    var res = legendaryDealDamage(pEnt, enemies[i], powerPct, dmgType, elem, floatSel, label, ctx);
    if (res) {
      total += res.dmg || 0;
      if (res.killed) killed = true;
    }
  }
  return { dmg: total, killed: killed };
}

function legendaryOnBasicAttack(pEnt, target, res, floatSel, st) {
  if (!legendaryHas(st, 'whirlwindStab') || !legendaryDualDaggersEquipped()) return null;
  var rt = legendaryEnsureRT();
  var spec = legendaryFx('whirlwindStab');
  rt.basicAttackCount++;
  if (rt.basicAttackCount < spec.basicAttackThreshold) return null;
  rt.basicAttackCount = 0;
  var total = 0;
  var killed = false;
  for (var i = 0; i < spec.flurryHits && target && target.hp > 0; i++) {
    var hit = legendaryDealDamage(pEnt, target, spec.flurryPowerPct, 'phys', null, floatSel, '旋風之刺');
    if (hit) {
      total += hit.dmg || 0;
      if (hit.killed) killed = true;
    }
  }
  return { dmg: total, killed: killed };
}

function legendaryOnEnemyKill(pEnt) {
  if (typeof getStats !== 'function') return;
  var st = getStats();
  if (!legendaryHas(st, 'berserkBloodAxe')) return;
  var rt = legendaryEnsureRT();
  var spec = legendaryFx('berserkBloodAxe').onKillBuff;
  if (rt.berserkUntil <= GT) rt.berserkStacks = 0;
  rt.berserkStacks = Math.min(spec.maxStacks, rt.berserkStacks + 1);
  rt.berserkUntil = GT + spec.dur;
}

function legendaryApplyLowLifeShield(pEnt, st, floatSel) {
  var rt = legendaryEnsureRT();
  var spec = legendaryFx('magicLightShield');
  if (!legendaryHas(st, 'magicLightShield') || !rt.lightShieldArmed || rt.lightShieldCooldownUntil > GT ||
      !(st.hp > 0) || !(pEnt.hp > 0) || pEnt.hp / st.hp * 100 >= spec.lowHpThresholdPct) return;
  var before = Math.max(0, pEnt.shield || 0);
  var target = st.hp * spec.shieldHpPct / 100;
  pEnt.shield = Math.max(before, target);
  rt.lightShieldGranted = Math.max(0, pEnt.shield - before);
  rt.lightShieldUntil = GT + spec.dur;
  rt.lightShieldCooldownUntil = GT + spec.cooldownSec;
  rt.lightShieldArmed = false;
  applyBuff(pEnt, 'legendaryLightShieldRed', spec.dmgRedPct, spec.dur);
  if (typeof refreshShieldMaxAfterGain === 'function') refreshShieldMaxAfterGain(pEnt, before);
  if (typeof floatPlayerEvent === 'function') floatPlayerEvent(floatSel, '✨魔法光盾', 'shield');
}

function legendaryOnPlayerDamaged(attacker, pEnt, hpDamage, blocked, hitResult, floatSel) {
  if (!pEnt || typeof getStats !== 'function') return;
  // 符文之語的受擊／格擋／低血量觸發（js/runeword.js）
  if (typeof rwOnPlayerDamaged === 'function') rwOnPlayerDamaged(attacker, pEnt, hpDamage, blocked, hitResult, floatSel);
  var st = getStats();
  var enemies = legendaryActiveEnemies();
  var enemyFloatSel = legendaryEnemyFloatSel(floatSel);

  if (hpDamage > 0 && legendaryHas(st, 'thunderShock')) {
    var shock = legendaryFx('thunderShock').onHealthLostAoe;
    if (chance(shock.chance)) {
      var shockOut = legendaryDealAoe(pEnt, enemies, shock.powerPct * (enemies.length === 1 ? shock.singleMult : 1),
        'magic', shock.elem, enemyFloatSel, '雷霆之震');
      legendarySettleTriggeredDeaths(shockOut);
    }
  }
  if (hpDamage > 0 && legendaryHas(st, 'fireSpiritShield') && attacker && attacker.hp > 0) {
    var fire = legendaryFx('fireSpiritShield');
    attacker._fireSpiritStacks = Math.min(fire.maxStacks, (attacker._fireSpiritStacks || 0) + 1);
    applyDot(attacker, (st.matk || st.atk || 0) * fire.retaliateBurnPct / 100 * attacker._fireSpiritStacks,
      999999, '火靈灼燒');
  }
  if (blocked && legendaryHas(st, 'unyieldingGuard') && attacker && attacker.hp > 0) {
    var guard = legendaryFx('unyieldingGuard').onBlock;
    if (chance(guard.chance)) {
      var blockReduction = typeof blockDmgReduction === 'function'
        ? blockDmgReduction(st.blockDmgRed || 0) : (st.blockDmgRed || 0);
      var reflectMultiplier = blockReduction / 100 * guard.reflectBlockPct / 100;
      var reflect = legendaryDealReflectedBasicAttack(
        pEnt, attacker, reflectMultiplier, enemyFloatSel, '不屈護衛');
      legendarySettleTriggeredDeaths(reflect);
      applyBuff(pEnt, 'legendaryGuardRed', guard.dmgRedPct, guard.dur);
    }
  }
  if (hitResult && hitResult.thorns > 0 && legendaryHas(st, 'magicRecoil') && attacker && attacker.hp > 0) {
    var recoil = legendaryFx('magicRecoil');
    if ((typeof gmMpLockActive === 'function' && gmMpLockActive(pEnt)) ||
        pEnt.mp >= recoil.thornsManaCost) {
      if (!(typeof gmMpLockActive === 'function' && gmMpLockActive(pEnt))) {
        pEnt.mp -= recoil.thornsManaCost;
      }
      var extra = Math.max(1, Math.round(hitResult.thorns * recoil.thornsDamagePct / 100));
      if (!(typeof gmHpLockActive === 'function' && gmHpLockActive(attacker))) {
        attacker.hp = Math.max(0, attacker.hp - extra);
      }
      hitResult.thorns += extra;
    }
  }
  legendaryApplyLowLifeShield(pEnt, st, floatSel);
}

function legendaryChooseEnemyAttackTarget(playerEnt) {
  var rt = legendaryEnsureRT();
  if (typeof getStats === 'function' && !legendaryHas(getStats(), 'ghostLamp')) return playerEnt;
  for (var i = 0; i < rt.dolls.length; i++) if (rt.dolls[i].hp > 0) return rt.dolls[i];
  return playerEnt;
}

function legendaryExplodeDoll(doll, floatSel) {
  if (!doll || doll._exploded) return;
  doll._exploded = true;
  var pEnt = legendaryCurrentPlayer();
  var enemies = legendaryActiveEnemies();
  var explosion = legendaryDealAoe(pEnt, enemies, legendaryFx('ghostLamp').summons.explosionPct,
    'magic', 'dark', floatSel, '幽冥神燈');
  legendarySettleTriggeredDeaths(explosion);
}

function legendaryMonsterAttackDoll(mEnt, doll, floatSel, mult, skillName) {
  var st = getStats();
  var defPct = legendaryFx('ghostLamp').summons.hpPct / 100;
  var dCfg = {
    def: (st.def || 0) * defPct,
    mdef: (st.mdef || 0) * defPct,
    level: st.level || 1,
    dodge: 0,
    blockRate: 0,
    blockDmgRed: 0,
    pRes: st.pRes || 0,
    mRes: st.mRes || 0,
    resist: st.resist || {},
    ctrlRes: 0,
    ccFactor: 1,
    globalDmgRed: 0,
    maxHp: doll.maxHp
  };
  var res = resolveHit(mEnt, doll, monsterAtkCfg(mEnt, mult), dCfg);
  if (typeof floatPlayerEvent === 'function') {
    floatPlayerEvent(playerEventFloatTarget(floatSel), '鬼娃 -' + fmt(res.dmg || 0), 'defend');
  }
  if (doll.hp <= 0) legendaryExplodeDoll(doll, floatSel);
  return res;
}

function legendaryEnsureKnives(pEnt, st) {
  var rt = legendaryEnsureRT();
  if (rt.knivesStarted || !legendaryHas(st, 'shadowTracker')) return;
  rt.knivesStarted = true;
  var spec = legendaryFx('shadowTracker').shadowKnives;
  for (var i = 0; i < spec.count; i++) {
    rt.knives.push({ until: GT + spec.dur, nextAt: GT + spec.tickSec });
  }
}

function legendaryEnsureDolls(pEnt, st) {
  var rt = legendaryEnsureRT();
  if (rt.dollsStarted || !legendaryHas(st, 'ghostLamp')) return;
  rt.dollsStarted = true;
  var spec = legendaryFx('ghostLamp').summons;
  for (var i = 0; i < spec.count; i++) {
    rt.dolls.push({
      _legendaryDoll: true,
      name: '幽冥鬼娃',
      hp: st.hp * spec.hpPct / 100,
      maxHp: st.hp * spec.hpPct / 100,
      atk: Math.max(st.atk || 0, st.matk || 0) * spec.atkPct / 100,
      nextAt: GT + 1,
      effects: {},
      buffs: {},
      dots: [],
      shield: 0
    });
  }
}

/* 連鎖閃電排程器：新版技能【突刺】的傳奇特效【迅雷穿刺】（thrustChain）經 js/skills2.js sgThrustOnHit 呼叫。
   2026-09-29 舊版技能移除時曾連同 lightningLeap 誤刪，由 skills2 的 typeof 守衛靜默略過，效果消失。 */
function legendaryQueue(at, resolve) {
  legendaryEnsureRT().queue.push({ at: at, resolve: resolve });
}

/* 連鎖閃電的畫面（2026-08-19 補）：本檔原本一發特效都不送，玩家只看得到敵人身上
   憑空跳出傷害字。這裡送出與新版技能【連鎖閃電】同一種 chain 事件，
   兩個渲染器（js/vfx.js 與 js/battle-renderer.js）都已認得 lightning-chain。
   from 留白＝從我方出手點連到第一個目標。 */
function legendaryEmitChainVfx(from, to, floatSel, elem) {
  if (typeof playCombatVfx !== 'function' || typeof enemyEventFloatTarget !== 'function') return;
  var ids = [];
  if (from && from.hp > 0) ids.push(enemyEventFloatTarget(from, floatSel));
  if (to) ids.push(enemyEventFloatTarget(to, floatSel));
  if (!ids.length) return;
  playCombatVfx({
    fxKind: 'chain', variant: 'lightning-chain', glyph: '⚡',
    color: (typeof VFX_CAT_COLORS !== 'undefined' && VFX_CAT_COLORS.magic) || '#f2b705',
    cat: 'magic', elem: elem || 'lightning', targets: ids, area: null, dur: 0.35, count: 1,
    vfx: (typeof vfxCombatRoles === 'function') ? vfxCombatRoles('legendaryLightningChain') : null
  });
}

function legendaryScheduleChain(pEnt, spec, floatSel) {
  /* 連鎖記住上一跳打到誰，下一跳從「它以外的存活敵人」裡隨機挑一個 → js/battlefield.js。
     【迅雷穿刺】（原本還有已刪除的【閃電飛越】）的敘述都沒有規定彈射範圍、也沒有寫「最近」，
     所以候選是整個戰場、挑法是等機率隨機（使用者定調 2026-08-21）。 */
  var chainState = { last: null };
  for (var i = 0; i < spec.bounces; i++) {
    (function (delayIndex) {
      legendaryQueue(GT + spec.tickSec * (delayIndex + 1), function (ctx) {
        var enemies = ctx && ctx.getEnemies ? ctx.getEnemies() : legendaryActiveEnemies();
        if (!enemies.length) return;
        var target = (typeof bfChainNext === 'function')
          ? (bfChainNext(chainState.last, enemies) || enemies[0])
          : enemies[Math.floor(Math.random() * enemies.length)];
        legendaryEmitChainVfx(chainState.last, target, floatSel, spec.elem);
        chainState.last = target;
        legendaryDealDamage(pEnt, target, spec.powerPct, 'magic', spec.elem, floatSel,
          spec.label || '迅雷穿刺', ctx);
        if (target.hp <= 0 && ctx && typeof ctx.onDeaths === 'function') ctx.onDeaths();
      });
    })(i);
  }
}

function legendaryTickQueue(ctx) {
  var rt = legendaryEnsureRT();
  var keep = [];
  for (var i = 0; i < rt.queue.length; i++) {
    var q = rt.queue[i];
    if (q.at <= GT) {
      if (typeof q.resolve === 'function') q.resolve(ctx);
    } else keep.push(q);
  }
  rt.queue = keep;
}

function legendaryTickKnives(ctx, pEnt, st) {
  var rt = legendaryEnsureRT();
  var spec = legendaryFx('shadowTracker').shadowKnives;
  for (var i = 0; i < rt.knives.length; i++) {
    var knife = rt.knives[i];
    while (knife.nextAt <= GT && knife.nextAt <= knife.until) {
      var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
      if (!enemies.length) break;
      var target = legendaryNearestEnemy(enemies, pEnt); // 自動攻擊打最近的敵人（原本取陣列第一個）
      var res = legendaryDealDamage(pEnt, target, spec.powerPct, 'phys', null, ctx.floatSel, '影襲追蹤者', ctx);
      knife.nextAt += spec.tickSec;
      if (res && res.killed) {
        for (var j = 0; j < rt.knives.length; j++) rt.knives[j].until += spec.killExtend;
        if (ctx.onDeaths) ctx.onDeaths();
      }
    }
  }
  rt.knives = rt.knives.filter(function (knife) { return knife.until > GT; });
}

function legendaryTickDolls(ctx, pEnt, st) {
  var rt = legendaryEnsureRT();
  var spec = legendaryFx('ghostLamp').summons;
  for (var i = 0; i < rt.dolls.length; i++) {
    var doll = rt.dolls[i];
    if (doll.hp <= 0 || doll.nextAt > GT) continue;
    var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
    if (!enemies.length) continue;
    var powerPct = (doll.atk / Math.max(1, st.atk || st.matk || 1)) * 100;
    var res = legendaryDealDamage(pEnt, legendaryNearestEnemy(enemies, pEnt), powerPct, 'phys', null, ctx.floatSel, '幽冥鬼娃', ctx);
    doll.nextAt += 1;
    if (res && res.killed && ctx.onDeaths) ctx.onDeaths();
  }
}

function legendaryTickAutomaticSkills(ctx, pEnt, st, dt) {
  var rt = legendaryEnsureRT();
  /* 死亡／倒地期間暫停所有自動觸發（判定入口在 js/skills2.js skills2AutoCastBlocked）。
     節拍整條往後推 dt，因此剩餘時間不變：既不會在復活瞬間把倒地期間累積的節拍一次補發，
     也不會白白損失一次蓄力。模組未載入時（Node vm 單檔測試）視為未阻擋，行為與改造前相同。 */
  if (typeof skills2AutoCastBlocked === 'function' && skills2AutoCastBlocked(pEnt)) {
    if (rt.nextLightAt > 0) rt.nextLightAt += Math.max(0, Number(dt) || 0);
    return;
  }
  if (legendaryHas(st, 'lightCollision')) {
    var light = legendaryFx('lightCollision').autoProjectile;
    if (!rt.nextLightAt) rt.nextLightAt = GT + light.sec;
    if (rt.nextLightAt <= GT) {
      rt.nextLightAt += light.sec;
      var enemies = ctx.getEnemies();
      if (enemies.length) {
        var lightRes = legendaryDealDamage(pEnt, legendaryNearestEnemy(enemies, pEnt), light.powerPct, 'magic', light.elem,
          ctx.floatSel, '光之碰撞', ctx);
        if (lightRes && lightRes.killed && ctx.onDeaths) ctx.onDeaths();
      }
    }
  }
}

function legendaryTickFireSpirit(pEnt, st, dt) {
  var rt = legendaryEnsureRT();
  if (!legendaryHas(st, 'fireSpiritShield')) return;
  /* 死亡／倒地期間不自損：【不屈鬥魂】倒地時生命被鎖在 1，若這裡照樣每秒扣，
     會把「死了 5 秒之後原地復活」的保護一刀砍斷（扣到 0 之後下一次判死就是真死）。
     節拍同樣往後推——補跳是 while 迴圈，單純 return 會在復活當下一次全灌下去。 */
  if (typeof skills2AutoCastBlocked === 'function' && skills2AutoCastBlocked(pEnt)) {
    if (rt.nextFireDrainAt > 0) rt.nextFireDrainAt += Math.max(0, Number(dt) || 0);
    return;
  }
  var spec = legendaryFx('fireSpiritShield');
  if (!rt.nextFireDrainAt) rt.nextFireDrainAt = GT + 1;
  while (rt.nextFireDrainAt <= GT && pEnt.hp > 0) {
    var loss = Math.min(Math.max(0, pEnt.hp), st.hp * spec.selfHpDrainPctPerSec / 100);
    if (!(typeof gmHpLockActive === 'function' && gmHpLockActive(pEnt))) {
      pEnt.hp = Math.max(0, pEnt.hp - loss);
      if (typeof sgWarGodBodyOnDamaged === 'function') sgWarGodBodyOnDamaged(loss, pEnt);
    }
    rt.nextFireDrainAt += 1;
  }
}

function legendaryTickLightShield(pEnt, st) {
  var rt = legendaryEnsureRT();
  if (pEnt.hp >= st.hp * legendaryFx('magicLightShield').lowHpThresholdPct / 100) {
    rt.lightShieldArmed = true;
  }
  if (rt.lightShieldUntil && rt.lightShieldUntil <= GT) {
    var remove = Math.min(Math.max(0, pEnt.shield || 0), rt.lightShieldGranted || 0);
    pEnt.shield = Math.max(0, (pEnt.shield || 0) - remove);
    rt.lightShieldUntil = 0;
    rt.lightShieldGranted = 0;
  }
}

/* 野外與高塔各 tick 一次；回傳 playerKilled 供呼叫端立即結束戰鬥。 */
function tickLegendaryEffects(dt, ctx) {
  if (!ctx || !ctx.pEnt || typeof getStats !== 'function') return { playerKilled: false };
  var pEnt = ctx.pEnt;
  var st = getStats();
  legendaryEnsureKnives(pEnt, st);
  legendaryEnsureDolls(pEnt, st);
  legendaryTickAutomaticSkills(ctx, pEnt, st, dt);
  legendaryTickFireSpirit(pEnt, st, dt);
  legendaryTickLightShield(pEnt, st);
  legendaryTickQueue(ctx);
  if (legendaryHas(st, 'shadowTracker')) legendaryTickKnives(ctx, pEnt, st);
  if (legendaryHas(st, 'ghostLamp')) legendaryTickDolls(ctx, pEnt, st);
  legendaryApplyLowLifeShield(pEnt, st, ctx.floatSel === 'tb-float' ? 'tp-float' : 'pv-float');
  if (typeof rwTick === 'function') rwTick(dt, ctx); // 符文之語：週期觸發、生命祭獻（js/runeword.js）
  return { playerKilled: pEnt.hp <= 0 };
}
