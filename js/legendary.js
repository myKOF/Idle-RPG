'use strict';
/* ============ 傳奇特效執行引擎 ============
   數值與效果規格只讀 PASSIVE_POOL；本檔負責戰鬥期路由與短暫狀態，不寫入存檔。
   關聯技能由 legendaryPrepareSkillCast 集中改寫；觸發技能統一走
   legendaryCastTriggeredSkill，未學習／未解鎖時仍以 Lv.1 免費結算。 */

var LEGENDARY_RT = null;

function resetLegendaryRT() {
  LEGENDARY_RT = {
    basicAttackCount: 0,
    berserkStacks: 0,
    berserkUntil: 0,
    nextMultiCast: null,
    chargedSkill: null,
    chargedEffectPct: 0,
    deathDomainUntil: 0,
    queue: [],
    fields: [],
    knives: [],
    knivesStarted: false,
    dolls: [],
    dollsStarted: false,
    nextMeteorAt: 0,
    nextLightAt: 0,
    nextChargeAt: 0,
    nextFireDrainAt: 0,
    lightShieldArmed: true,
    lightShieldUntil: 0,
    lightShieldGranted: 0
  };
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

function legendaryFx(key) {
  var def = PASSIVE_POOL[key];
  return def && def.fx ? def.fx : {};
}

function legendaryTriggeredSkillLevel(id) {
  var lv = (typeof skillLevel === 'function') ? skillLevel(id) : 0;
  return Math.max(1, Math.floor(Number(lv) || 0));
}

function legendaryCastTriggeredSkill(pEnt, targets, id, floatSel, extraOpts) {
  var def = (typeof skillDef === 'function') ? skillDef(id) : null;
  if (!def || typeof castSkill !== 'function') return null;
  var opts = {
    free: true,
    noCooldown: true,
    noGcd: true,
    noCastLock: true,
    noLegendaryProcs: true,
    triggeredByLegendary: true
  };
  extraOpts = extraOpts || {};
  for (var key in extraOpts) opts[key] = extraOpts[key];
  return castSkill(pEnt, targets, id, legendaryTriggeredSkillLevel(id), floatSel, undefined, opts);
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

function legendarySkillManaCost(pEnt, id, sk, lv, st) {
  if (legendaryHas(st, 'manaExplosion') && id === 'manaBurn') {
    return Math.max(0, (st.mp || 0) * (legendaryFx('manaExplosion').manaCostMaxPct || 0) / 100);
  }
  return (typeof skillManaCost === 'function') ? skillManaCost(sk, lv) : (sk.cost || 0);
}

/* 關聯技能集中改寫。回傳值只存在本次施放，不污染 SKILLS 原始資料。 */
function legendaryPrepareSkillCast(pEnt, targets, id, sk, fx, lv, st, opts) {
  var rt = legendaryEnsureRT();
  var out = {
    fx: legendaryClone(fx) || {},
    effectMult: 1,
    cdMult: 1,
    manaCost: null,
    repeat: 1,
    deferBloodSurgeSacrifice: false,
    wasExecute: false
  };

  if (legendaryHas(st, 'deathDomain')) {
    var domain = legendaryFx('deathDomain').domainOnSkillCast;
    rt.deathDomainUntil = Math.max(rt.deathDomainUntil || 0, GT + domain.dur);
  }
  if ((rt.deathDomainUntil || 0) > GT && out.fx.dmgType) {
    var domainFx = legendaryFx('deathDomain').domainOnSkillCast;
    // 特規：領域期間所有技能整段轉為指定屬性（elemOverride 優先於技能標籤與融合技多屬性）
    out.fx.dmgType = 'magic';
    delete out.fx.elems;
    out.fx.elemOverride = domainFx.convertElem;
    out.effectMult *= 1 + domainFx.skillDamagePct / 100;
  }

  if (legendaryHas(st, 'whirlwindBleed') && id === 'whirlwind') {
    var bleed = legendaryFx('whirlwindBleed').skillDot;
    out.fx.dot = { pct: bleed.tickPowerPct, dur: bleed.dur, name: bleed.name };
  }
  if (legendaryHas(st, 'stormSigilChain') && id === 'stormSigil') {
    var sigilFx = legendaryFx('stormSigilChain');
    out.effectMult *= 1 + sigilFx.skillDamagePct / 100;
    if (out.fx.brand) out.fx.brand.maxStacks = (out.fx.brand.maxStacks || 1) + sigilFx.brandExtraStacks;
  }
  if (legendaryHas(st, 'skyfallMeteor') && id === 'meteor') {
    out.effectMult *= 1 + legendaryFx('skyfallMeteor').skillDamagePct / 100;
  }
  if (legendaryHas(st, 'manaExplosion') && id === 'manaBurn') {
    var manaFx = legendaryFx('manaExplosion');
    out.effectMult *= 1 + manaFx.skillDamagePct / 100;
    out.manaCost = Math.max(0, (st.mp || 0) * manaFx.manaCostMaxPct / 100);
  }
  if (legendaryHas(st, 'judgmentArrival') && id === 'holySmite') {
    var judgeFx = legendaryFx('judgmentArrival');
    out.effectMult *= 1 + judgeFx.skillDamagePct / 100;
    out.cdMult *= 1 + judgeFx.skillCdPct / 100;
  }
  if (legendaryHas(st, 'shadowAnnihilation') && id === 'voidRift') {
    var voidFx = legendaryFx('shadowAnnihilation');
    out.fx.execBelow = voidFx.execBelow;
    out.effectMult *= 1 + voidFx.skillDamagePct / 100;
    out.wasExecute = (targets || []).some(function (ent) {
      return ent && ent.maxHp > 0 && ent.hp / ent.maxHp * 100 < voidFx.execBelow;
    });
  }
  if (legendaryHas(st, 'voidFate') && id === 'bloodSurge') {
    delete out.fx.hpSacrifice;
    out.deferBloodSurgeSacrifice = true;
  }
  if (rt.chargedSkill === id) {
    out.effectMult *= 1 + (rt.chargedEffectPct || 0) / 100;
    rt.chargedSkill = null;
    rt.chargedEffectPct = 0;
  }
  if (rt.nextMultiCast && id !== 'arcaneBurst') {
    out.repeat = rt.nextMultiCast.repeats || 2;
    rt.nextMultiCast = null;
  }
  if (opts && opts.powerMult) out.effectMult *= Math.max(0, Number(opts.powerMult) || 0);
  return out;
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
  return mult;
}

function legendaryElementDamageUp(st, pEnt) {
  var out = {};
  var src = st && st.elemDmgUp || {};
  for (var key in src) out[key] = src[key];
  if (buffVal(pEnt, 'legendaryDarkUp') > 0) {
    out.dark = (out.dark || 0) + buffVal(pEnt, 'legendaryDarkUp');
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
  if (defender && defender._legendaryFrostbite && defender._legendaryFrostbite.until > GT) {
    mult *= 1 + defender._legendaryFrostbite.stacks * (defender._legendaryFrostbite.ampPct || 0) / 100;
  }
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
  ent.hp = Math.max(0, ent.hp - damage);
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
    pen: resolvedType === 'phys' ? (st.pPen || 0) : (st.mPen || 0),
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
      floatEnemyEvent(target, floatSel, (elem ? '✦' : '') + fmt(result.dmg), 'dmg enemy-skill', result.dmg);
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
  target.hp -= damage;
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
    floatEnemyEvent(target, floatSel, fmt(result.dmg), 'dmg enemy-skill', result.dmg);
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

function legendaryApplyFrostbite(target, dur, ampPct, maxStacks) {
  if (!target) return;
  var cur = target._legendaryFrostbite;
  if (!cur || cur.until <= GT) cur = { stacks: 0, ampPct: 0, until: 0 };
  cur.stacks = Math.min(maxStacks || 20, cur.stacks + 1);
  cur.ampPct = Math.max(cur.ampPct || 0, ampPct || 0);
  cur.until = GT + dur;
  target._legendaryFrostbite = cur;
}

function legendaryQueue(at, resolve) {
  legendaryEnsureRT().queue.push({ at: at, resolve: resolve });
}

function legendaryScheduleChain(pEnt, spec, floatSel) {
  // 連鎖不再每跳全場亂數挑：記住上一跳打到誰，下一跳跳到離它最近的鄰居 → js/battlefield.js
  var chainState = { last: null };
  for (var i = 0; i < spec.bounces; i++) {
    (function (delayIndex) {
      legendaryQueue(GT + spec.tickSec * (delayIndex + 1), function (ctx) {
        var enemies = ctx && ctx.getEnemies ? ctx.getEnemies() : legendaryActiveEnemies();
        if (!enemies.length) return;
        var target = (typeof bfChainNext === 'function')
          ? (bfChainNext(chainState.last, enemies) || enemies[0])
          : enemies[Math.floor(Math.random() * enemies.length)];
        chainState.last = target;
        legendaryDealDamage(pEnt, target, spec.powerPct, 'magic', spec.elem, floatSel, '閃電飛越', ctx);
        if (target.hp <= 0 && ctx && typeof ctx.onDeaths === 'function') ctx.onDeaths();
      });
    })(i);
  }
}

function legendaryStartVenomField(pEnt, spec, floatSel) {
  legendaryEnsureRT().fields.push({
    name: '劇毒血霧',
    nextAt: GT + spec.tickSec,
    until: GT + spec.dur,
    tickSec: spec.tickSec,
    tick: function (ctx) {
      var enemies = ctx && ctx.getEnemies ? ctx.getEnemies() : legendaryActiveEnemies();
      var result = legendaryDealAoe(pEnt, enemies, spec.powerPct, 'magic', 'poison', floatSel, '劇毒血霧', ctx);
      if (result.killed && ctx && typeof ctx.onDeaths === 'function') ctx.onDeaths();
    }
  });
}

function legendaryStartVoidFate(pEnt, floatSel) {
  var spec = legendaryFx('voidFate');
  var tickSec = 1;
  var ticks = Math.max(1, Math.round(spec.dur / tickSec));
  legendaryEnsureRT().fields.push({
    name: '虛無命運',
    nextAt: GT + tickSec,
    until: GT + spec.dur,
    tickSec: tickSec,
    ticksLeft: ticks,
    tick: function (ctx) {
      if (this.ticksLeft-- <= 0 || !pEnt || pEnt.hp <= 0) return;
      var st = getStats();
      var hpPct = spec.deferredHpLossPct / ticks;
      var hpLoss = Math.min(Math.max(0, pEnt.hp), st.hp * hpPct / 100);
      pEnt.hp = Math.max(0, pEnt.hp - hpLoss);
      legendaryOnHealthLost(pEnt, hpLoss, floatSel);
      var enemies = ctx && ctx.getEnemies ? ctx.getEnemies() : legendaryActiveEnemies();
      for (var i = 0; i < enemies.length; i++) {
        var damage = Math.max(1, Math.round(enemies[i].maxHp * hpPct * spec.enemyHpLossPerPlayerPct / 100));
        enemies[i].hp = Math.max(0, enemies[i].hp - damage);
        if (ctx && typeof ctx.onDamage === 'function') ctx.onDamage(damage);
        if (typeof trackDps === 'function') trackDps(damage);
        if (typeof recordRunDamage === 'function') recordRunDamage('虛無命運', damage);
      }
      if (ctx && typeof ctx.onDeaths === 'function') ctx.onDeaths();
    }
  });
}

/* 技能完成後的傳奇特效分發。 */
function legendaryOnSkillCast(pEnt, targets, id, sk, fx, lv, st, out, floatSel, prep, opts) {
  if (opts && opts.noLegendaryProcs) return;
  targets = targets || [];

  if (legendaryHas(st, 'whirlwindRift') && sk && sk.cat === 'phys') {
    var split = legendaryFx('whirlwindRift').onSkillCast;
    if (chance(split.chance)) {
      var splitOut = legendaryCastTriggeredSkill(pEnt, targets, split.triggerSkill, floatSel);
      if (splitOut) {
        out.dmg = (out.dmg || 0) + (splitOut.dmg || 0);
        if (splitOut.killed) out.killed = true;
      }
    }
  }
  if (legendaryHas(st, 'lightningLeap') && sk && sk.cat === 'magic') {
    var chain = legendaryFx('lightningLeap').onSkillCastChain;
    if (chance(chain.chance)) legendaryScheduleChain(pEnt, chain, floatSel);
  }

  var elem = (typeof skillElemOf === 'function') ? skillElemOf(sk, fx) : null;
  if (legendaryHas(st, 'auroraStaff') && elem === 'ice' && out && out.dmg > 0) {
    var frost = legendaryFx('auroraStaff').onElemSkill;
    for (var i = 0; i < targets.length; i++) {
      legendaryApplyFrostbite(targets[i], frost.frostbiteDur, frost.damageTakenPerStackPct, frost.maxStacks);
    }
  }
  if (legendaryHas(st, 'iceShriek') && elem === 'ice' && chance(legendaryFx('iceShriek').onElemSkillProc.chance)) {
    var shard = legendaryFx('iceShriek').onElemSkillProc;
    var shardTarget = targets.filter(function (ent) { return ent && ent.hp > 0; })[0];
    if (shardTarget) {
      var shardRes = legendaryDealDamage(pEnt, shardTarget, shard.powerPct, 'magic', 'ice', floatSel, '冰晶尖嘯');
      legendaryApplyFrostbite(shardTarget, shard.frostbiteDur, 0, 20);
      if (shardRes && shardRes.killed) out.killed = true;
      if (shardRes) out.dmg = (out.dmg || 0) + (shardRes.dmg || 0);
    }
  }
  if (legendaryHas(st, 'frostSpike') && id === 'frostNova') {
    var spike = legendaryFx('frostSpike').extraSkillHit;
    var spikeTarget = targets.filter(function (ent) { return ent && ent.hp > 0; })[0];
    if (spikeTarget) {
      var spikeRes = legendaryDealDamage(pEnt, spikeTarget, spike.powerPct, spike.dmgType, spike.elem, floatSel, '冰霜尖刺');
      if (spikeRes && spikeRes.killed) out.killed = true;
      if (spikeRes) out.dmg = (out.dmg || 0) + (spikeRes.dmg || 0);
    }
  }
  if (legendaryHas(st, 'venomMist') && elem === 'poison') {
    var mist = legendaryFx('venomMist').onElemSkillField;
    if (chance(mist.chance)) legendaryStartVenomField(pEnt, mist, floatSel);
  }
  if (legendaryHas(st, 'holyImpact') && id === 'arcaneBurst') {
    var multi = legendaryFx('holyImpact').nextMultiCast;
    legendaryEnsureRT().nextMultiCast = {
      repeats: chance(multi.tripleChance) ? multi.triple : multi.double
    };
  }
  if (legendaryHas(st, 'shadowAnnihilation') && id === 'voidRift' && prep && prep.wasExecute) {
    var dark = legendaryFx('shadowAnnihilation').onExecuteElemBuff;
    applyBuff(pEnt, 'legendaryDarkUp', dark.pct, dark.dur);
  }
  if (legendaryHas(st, 'voidFate') && id === 'bloodSurge' && prep && prep.deferBloodSurgeSacrifice) {
    legendaryStartVoidFate(pEnt, floatSel);
  }
}

function legendaryOnManaSpent(pEnt, spent, st, floatSel) {
  if (!legendaryHas(st, 'manaGuard') || !(spent > 0) || !(st.mp > 0)) return;
  var spec = legendaryFx('manaGuard').manaSpendShield;
  var gained = st.hp * (spent / st.mp) * (spec.shieldHpPct / spec.manaPct);
  var cap = st.hp * spec.capHpPct / 100;
  var before = Math.max(0, pEnt.shield || 0);
  pEnt.shield = Math.min(cap, before + gained);
  if (typeof refreshShieldMaxAfterGain === 'function') refreshShieldMaxAfterGain(pEnt, before);
  if (pEnt.shield > before && typeof floatPlayerEvent === 'function') {
    floatPlayerEvent(floatSel, '🛡️+' + fmt(pEnt.shield - before), 'shield');
  }
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
  if (!legendaryHas(st, 'magicLightShield') || !rt.lightShieldArmed || !(st.hp > 0) || !(pEnt.hp > 0) ||
      pEnt.hp / st.hp * 100 >= legendaryFx('magicLightShield').lowHpThresholdPct) return;
  var spec = legendaryFx('magicLightShield');
  var before = Math.max(0, pEnt.shield || 0);
  var target = st.hp * spec.shieldHpPct / 100;
  pEnt.shield = Math.max(before, target);
  rt.lightShieldGranted = Math.max(0, pEnt.shield - before);
  rt.lightShieldUntil = GT + spec.dur;
  rt.lightShieldArmed = false;
  applyBuff(pEnt, 'legendaryLightShieldRed', spec.dmgRedPct, spec.dur);
  if (typeof refreshShieldMaxAfterGain === 'function') refreshShieldMaxAfterGain(pEnt, before);
  if (typeof floatPlayerEvent === 'function') floatPlayerEvent(floatSel, '✨魔法光盾', 'shield');
}

function legendaryOnHealthLost(pEnt, amount, floatSel) {
  if (!(amount > 0) || !pEnt || typeof getStats !== 'function') return;
  var st = getStats();
  if (!legendaryHas(st, 'shadowRipper')) return;
  var rip = legendaryFx('shadowRipper').onHealthLost;
  if (chance(rip.chance)) {
    var ripOut = legendaryCastTriggeredSkill(pEnt, legendaryActiveEnemies(), rip.triggerSkill,
      legendaryEnemyFloatSel(floatSel));
    legendarySettleTriggeredDeaths(ripOut);
  }
}

function legendaryOnPlayerDamaged(attacker, pEnt, hpDamage, blocked, hitResult, floatSel) {
  if (!pEnt || typeof getStats !== 'function') return;
  var st = getStats();
  var enemies = legendaryActiveEnemies();
  var enemyFloatSel = legendaryEnemyFloatSel(floatSel);

  legendaryOnHealthLost(pEnt, hpDamage, floatSel);
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
    if (pEnt.mp >= recoil.thornsManaCost) {
      pEnt.mp -= recoil.thornsManaCost;
      var extra = Math.max(1, Math.round(hitResult.thorns * recoil.thornsDamagePct / 100));
      attacker.hp = Math.max(0, attacker.hp - extra);
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

function legendaryTickFields(ctx) {
  var rt = legendaryEnsureRT();
  var keep = [];
  for (var i = 0; i < rt.fields.length; i++) {
    var field = rt.fields[i];
    while (field.nextAt <= GT && field.nextAt <= field.until) {
      if (typeof field.tick === 'function') field.tick.call(field, ctx);
      field.nextAt += Math.max(0.1, field.tickSec || 1);
    }
    if (field.until > GT) keep.push(field);
  }
  rt.fields = keep;
}

function legendaryTickAutomaticSkills(ctx, pEnt, st) {
  var rt = legendaryEnsureRT();
  if (legendaryHas(st, 'skyfallMeteor')) {
    var meteor = legendaryFx('skyfallMeteor').autoTrigger;
    if (!rt.nextMeteorAt) rt.nextMeteorAt = GT + meteor.sec;
    if (rt.nextMeteorAt <= GT) {
      rt.nextMeteorAt += meteor.sec;
      var meteorOut = legendaryCastTriggeredSkill(pEnt, ctx.getEnemies(), meteor.skill, ctx.floatSel);
      if (meteorOut && meteorOut.killed && ctx.onDeaths) ctx.onDeaths();
    }
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
  if (legendaryHas(st, 'oathOfCondemnation')) {
    var charge = legendaryFx('oathOfCondemnation').autoCharge;
    if (!rt.nextChargeAt) rt.nextChargeAt = GT + charge.sec;
    if (rt.nextChargeAt <= GT) {
      rt.nextChargeAt += charge.sec;
      var cooling = [];
      for (var id in pEnt.skillCds) {
        if (id.indexOf('potential:') !== 0 && (pEnt.skillCds[id] || 0) > 0) cooling.push(id);
      }
      if (cooling.length) {
        var chosen = cooling[Math.floor(Math.random() * cooling.length)];
        pEnt.skillCds[chosen] = 0;
        if (typeof markSkillReady === 'function') markSkillReady(pEnt, chosen);
        rt.chargedSkill = chosen;
        rt.chargedEffectPct = charge.effectPct;
      }
    }
  }
}

function legendaryTickFireSpirit(pEnt, st) {
  var rt = legendaryEnsureRT();
  if (!legendaryHas(st, 'fireSpiritShield')) return;
  var spec = legendaryFx('fireSpiritShield');
  if (!rt.nextFireDrainAt) rt.nextFireDrainAt = GT + 1;
  while (rt.nextFireDrainAt <= GT && pEnt.hp > 0) {
    var loss = Math.min(Math.max(0, pEnt.hp), st.hp * spec.selfHpDrainPctPerSec / 100);
    pEnt.hp = Math.max(0, pEnt.hp - loss);
    legendaryOnHealthLost(pEnt, loss, 'pv-float');
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
  legendaryTickAutomaticSkills(ctx, pEnt, st);
  legendaryTickFireSpirit(pEnt, st);
  legendaryTickLightShield(pEnt, st);
  legendaryTickQueue(ctx);
  legendaryTickFields(ctx);
  if (legendaryHas(st, 'shadowTracker')) legendaryTickKnives(ctx, pEnt, st);
  if (legendaryHas(st, 'ghostLamp')) legendaryTickDolls(ctx, pEnt, st);
  legendaryApplyLowLifeShield(pEnt, st, ctx.floatSel === 'tb-float' ? 'tp-float' : 'pv-float');
  return { playerKilled: pEnt.hp <= 0 };
}
