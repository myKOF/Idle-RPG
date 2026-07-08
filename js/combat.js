'use strict';
/* ============ 戰鬥引擎（野外 + 共用攻擊邏輯 + 技能） ============ */

// 野外戰鬥狀態
var FIELD = {
  player: null,      // { hp, mp, shield, atkCd, skillCd, effects:{}, poisonUntil, poisonDps }
  monster: null,
  respawnCd: 0,
  reviveCd: 0,
  dpsWindow: []      // [ [GT, dmg], ... ] 供 DPS 顯示
};

function newPlayerEntity(st) {
  return { hp: st.hp, mp: st.mp, shield: 0, atkCd: 1 / st.aspd, skillCds: {}, buffs: {}, dots: [], effects: {}, poisonUntil: 0, poisonDps: 0 };
}

function initFieldPlayer() {
  FIELD.player = newPlayerEntity(getStats());
}

function spawnFieldMonster() {
  var s = G.stage.current;
  var elite = (G.stage.kills === KILLS_PER_STAGE - 1);
  var base = monsterStatsFor(s, elite);
  var mtype = pick(MONSTER_POOL);
  FIELD.monster = {
    name: (elite ? '菁英・' : '') + mtype.name, emoji: mtype.emoji,
    level: base.level, maxHp: base.hp, hp: base.hp,
    atk: base.atk, def: base.def, mdef: base.mdef,
    magic: !!mtype.magic,          // 魔法系怪物：攻擊對玩家魔防
    aspd: base.aspd, dodge: base.dodge,
    elite: elite, isBoss: false, gold: base.gold, xp: base.xp,
    atkCd: 1 / base.aspd + 0.4, effects: {}, ctrlRes: 0,
    poisonUntil: 0, poisonDps: 0, shield: 0, buffs: {}, dots: []
  };
  UI.dirty.battle = true;
}

/* ---- 效果（暈眩/減速/中毒/淨化） ---- */
function applyEffect(ent, key, dur) { ent.effects[key] = GT + dur; }
function effectActive(ent, key) { return (ent.effects[key] || 0) > GT; }
// 減速：攻速 -30%（冷卻累積速度 x0.7）
function slowFactor(ent) { return effectActive(ent, 'slow') ? 0.7 : 1; }

function applyPoison(ent, dps, dur) {
  ent.poisonDps = Math.max(ent.poisonDps || 0, dps);
  ent.poisonUntil = GT + dur;
}
function poisonActive(ent) { return (ent.poisonUntil || 0) > GT; }
// 中毒跳傷（無視防禦）；回傳是否致死
function tickPoison(ent, dt) {
  if (!poisonActive(ent)) return false;
  ent.hp -= ent.poisonDps * dt;
  if (ent.hp <= 0) { ent.hp = 0; return true; }
  return false;
}
function cleanse(ent) {
  ent.effects = {};
  ent.poisonUntil = 0;
  ent.dots = [];
}

/* ---- 增益 / 減益（技能系統用） ---- */
function applyBuff(ent, key, val, dur) {
  if (!ent.buffs) ent.buffs = {};
  ent.buffs[key] = { val: val, until: GT + dur };
}
function buffVal(ent, key) {
  if (!ent || !ent.buffs) return 0;
  var b = ent.buffs[key];
  return (b && b.until > GT) ? b.val : 0;
}
function activeBuffKeys(ent) {
  var out = [];
  if (ent && ent.buffs) for (var k in ent.buffs) if (ent.buffs[k].until > GT) out.push(k);
  return out;
}

/* ---- 通用持續傷害（流血/燃燒/詛咒…；同名疊加取高） ---- */
function applyDot(ent, dps, dur, name) {
  if (!ent.dots) ent.dots = [];
  for (var i = 0; i < ent.dots.length; i++) {
    if (ent.dots[i].name === name) {
      ent.dots[i].dps = Math.max(ent.dots[i].dps, dps);
      ent.dots[i].until = GT + dur;
      return;
    }
  }
  ent.dots.push({ dps: dps, until: GT + dur, name: name });
}
function hasDots(ent) {
  if (poisonActive(ent)) return true;
  if (!ent.dots) return false;
  for (var i = 0; i < ent.dots.length; i++) if (ent.dots[i].until > GT) return true;
  return false;
}
// 回傳是否致死
function tickDots(ent, dt) {
  if (!ent.dots || !ent.dots.length) return false;
  var total = 0;
  ent.dots = ent.dots.filter(function (d) { return d.until > GT; });
  for (var i = 0; i < ent.dots.length; i++) total += ent.dots[i].dps;
  if (total > 0) {
    ent.hp -= total * dt;
    if (ent.hp <= 0) { ent.hp = 0; return true; }
  }
  return false;
}

/* ---- 共用攻擊流程 ----
   aCfg: { atk, dmgType('phys'|'magic'), level, critRate, critDmg, hit, sunder, pen,
           trueDmgPct, elemAtk, eliteDmg, bossDmg, isPlayer }
   dCfg: { def, mdef, level, dodge, blockRate, blockDmgRed, pRes, mRes, resist{六元素+ctrl},
           ctrlRes, ccFactor, thornsPct, maxHp, isElite, isBoss }
   回傳 { dmg, crit, miss, blocked, killed, thorns, heal, procs[] }        */
function resolveHit(attacker, defender, aCfg, dCfg) {
  var out = { dmg: 0, crit: false, miss: false, blocked: false, killed: false, thorns: 0, heal: 0, absorbed: 0, procs: [] };
  // 命中 vs 閃避
  var hitChance = clamp((aCfg.hit || 100) - (dCfg.dodge || 0), 5, 100);
  if (!chance(hitChance)) { out.miss = true; return out; }
  // 防禦選型（物理/魔法）＋破甲＋穿透
  var dmg = 0;
  if (aCfg.dmgType !== 'magic') {
    var pDef = (dCfg.def || 0) * (1 - (aCfg.sunder || 0) / 100) * (1 - (aCfg.pen || 0) / 100);
    var pDmg = (aCfg.atk || 0) * (1 - defReduction(pDef, aCfg.level || 1));
    pDmg *= 1 - clamp(dCfg.pRes || 0, 0, 60) / 100;
    dmg += pDmg;
  }
  if (aCfg.dmgType === 'magic' || aCfg.dmgType === 'both') {
    var mPen = (aCfg.dmgType === 'both') ? (aCfg.mPen || 0) : (aCfg.pen || 0);
    var baseMAtk = (aCfg.dmgType === 'both') ? (aCfg.matk || 0) : (aCfg.atk || 0);
    var mDef = (dCfg.mdef || 0) * (1 - (aCfg.sunder || 0) / 100) * (1 - mPen / 100);
    var mDmg = baseMAtk * (1 - defReduction(mDef, aCfg.level || 1));
    mDmg *= 1 - clamp(dCfg.mRes || 0, 0, 60) / 100;
    dmg += mDmg;
  }
  dmg *= rnd(0.9, 1.1);
  // 暴擊
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
      if (ek === 'ice' && chance(15) && !resistCtrl(dCfg)) { applyEffect(defender, 'slow', 2 * ccF); out.procs.push('減速'); }
      else if (ek === 'lightning' && chance(10)) { dmg += edmg * 0.8; out.procs.push('連鎖電擊'); }
      else if (ek === 'poison' && chance(25)) { applyPoison(defender, edmg * 0.5, 4); out.procs.push('中毒'); }
      else if (ek === 'light' && chance(20)) { cleanse(attacker); out.procs.push('淨化'); }
      else if (ek === 'dark') { out.heal += edmg * 0.25; } // 暗影汲取
    }
  }
  // 真實傷害（無視防禦與抗性）
  if (aCfg.trueDmgPct) dmg += aCfg.atk * aCfg.trueDmgPct / 100;
  // 對菁英 / 對 BOSS 傷害
  if (dCfg.isElite && aCfg.eliteDmg) dmg *= 1 + aCfg.eliteDmg / 100;
  if (dCfg.isBoss && aCfg.bossDmg) dmg *= 1 + aCfg.bossDmg / 100;
  // 格擋（機率減傷）
  if ((dCfg.blockRate || 0) > 0 && chance(clamp(dCfg.blockRate, 0, 50))) {
    dmg *= 1 - clamp(30 + (dCfg.blockDmgRed || 0), 0, 85) / 100;
    out.blocked = true;
  }
  dmg = Math.max(1, Math.round(dmg));
  // 護盾吸收
  if (defender.shield && defender.shield > 0) {
    out.absorbed = Math.min(defender.shield, dmg);
    defender.shield -= out.absorbed;
    dmg -= out.absorbed;
  }
  defender.hp -= dmg;
  out.dmg = dmg + out.absorbed; // 統計上含護盾吸收量
  if (defender.hp <= 0) { defender.hp = 0; out.killed = true; }
  // 反震（防守方被動）
  if (dCfg.thornsPct && !out.killed) {
    out.thorns = Math.max(1, Math.round(dCfg.maxHp * dCfg.thornsPct / 100));
    attacker.hp -= out.thorns;
  }
  return out;
}

function resistCtrl(dCfg) {
  var r = (dCfg.ctrlRes || 0);
  return r > 0 && chance(r);
}

/* ---- 攻防組態（pEnt 可帶入戰鬥實體以套用技能增益） ---- */
function playerAtkCfg(pEnt) {
  var st = getStats();
  var atkMul = 1 + buffVal(pEnt, 'atkUp') / 100;
  return {
    atk: st.atk * atkMul, matk: st.matk * atkMul, dmgType: 'both', level: st.level,
    critRate: st.critRate, critDmg: st.critDmg + buffVal(pEnt, 'critDmgUp'), hit: st.hit,
    sunder: st.passives.sunder || 0, pen: st.pPen, mPen: st.mPen,
    trueDmgPct: st.passives.trueDmg || 0, elemAtk: st.elemAtk,
    eliteDmg: st.eliteDmg, bossDmg: st.bossDmg, isPlayer: true
  };
}
function playerDefCfg(pEnt) {
  var st = getStats();
  var defMul = 1 + buffVal(pEnt, 'defUp') / 100;
  return {
    def: st.def * defMul, mdef: st.mdef * defMul, level: st.level,
    dodge: st.evasion + buffVal(pEnt, 'evasionUp'),
    blockRate: st.blockRate + buffVal(pEnt, 'blockUp'), blockDmgRed: st.blockDmgRed,
    pRes: st.pRes, mRes: st.mRes, resist: st.resist, ctrlRes: st.resist.ctrl,
    ccFactor: (1 - st.tenacity / 100) * (1 - st.ccRed / 100),
    thornsPct: (st.passives.thorns || 0) + buffVal(pEnt, 'thornsUp'), maxHp: st.hp, isPlayer: true
  };
}
function monsterAtkCfg(m, mult) {
  mult = mult || 1;
  var ea = m.elemAtk || null;
  if (ea && mult !== 1) { // 狂暴/重擊倍率也要套用到元素傷害
    var scaled = {};
    for (var i = 0; i < ELEMENTS.length; i++) scaled[ELEMENTS[i]] = (ea[ELEMENTS[i]] || 0) * mult;
    ea = scaled;
  }
  return {
    atk: m.atk * mult * (1 - buffVal(m, 'atkDown') / 100),
    dmgType: m.magic ? 'magic' : 'phys', level: m.level,
    critRate: 5, critDmg: 150, hit: 100, elemAtk: ea
  };
}
function monsterDefCfg(m) {
  var defMul = 1 - buffVal(m, 'defDown') / 100;
  return {
    def: m.def * defMul, mdef: (m.mdef || m.def * 0.75) * defMul, level: m.level, dodge: m.dodge || 0,
    resist: m.resist || {}, ctrlRes: m.ctrlRes || 0, maxHp: m.maxHp,
    isElite: !!m.elite, isBoss: !!m.isBoss
  };
}

/* ---- 治療（溢出的 50% 轉為護盾，上限受護盾效率影響） ---- */
function healPlayer(pEnt, amount, st) {
  if (amount <= 0) return;
  var space = st.hp - pEnt.hp;
  if (amount <= space) { pEnt.hp += amount; return; }
  pEnt.hp = st.hp;
  var over = amount - space;
  var cap = st.hp * 0.15 * (1 + (st.shieldEff || 0) / 100);
  pEnt.shield = Math.min(cap, (pEnt.shield || 0) + over * 0.5);
}

// 完整的一次玩家普攻（含連擊/暈眩/減速/吸血/吸魔/暗影汲取）
function doPlayerAttack(pEnt, mEnt, floatSel, depth) {
  var st = getStats();
  var res = resolveHit(pEnt, mEnt, playerAtkCfg(pEnt), monsterDefCfg(mEnt));
  var mName = mEnt.name || '怪物';
  var logMsg = (depth ? '' : '你攻擊 ' + mName + '，');
  if (res.miss) {
    floatText(floatSel, 'MISS', 'miss');
    logMsg += (depth ? '<span class="log-hl-bad">攻擊被閃避了！</span>' : '<span class="log-hl-bad">被閃避了！</span>');
  } else {
    var dmgStr = fmt(res.dmg);
    if (res.crit) dmgStr = '爆擊 ' + dmgStr;
    if (res.blocked) dmgStr = '格擋 ' + dmgStr;
    floatText(floatSel, dmgStr, res.crit ? 'crit' : 'dmg');
    trackDps(res.dmg);
    recordRunDamage('普攻', res.dmg);
    logMsg += (res.crit ? '<span class="log-hl-good">爆擊</span> ' : '造成 ') + fmt(res.dmg) + ' 傷害。';
    if (res.blocked) logMsg += '<span class="log-hl-bad">（被格擋）</span>';
    if (res.procs.length) logMsg += '<span class="log-hl-good">［' + res.procs.join('・') + '］</span>';
    if (res.thorns) logMsg += '<span class="log-hl-bad">遭到反震 ' + fmt(res.thorns) + ' 傷害。</span>';
    // 吸血 / 暗影汲取 / 吸魔
    var healAmt = res.dmg * st.lifesteal / 100 + (res.heal || 0);
    if (healAmt > 0) {
      healPlayer(pEnt, healAmt, st);
      floatText('pv-float', '+' + fmt(Math.round(healAmt)), 'heal');
      if (st.lifesteal > 0 || res.heal) logMsg += '<span class="log-hl-good">汲取回復 ' + fmt(healAmt) + '。</span>';
    }
    if (st.manaSteal > 0) {
      var mpGain = res.dmg * st.manaSteal / 100;
      pEnt.mp = Math.min(st.mp, pEnt.mp + mpGain);
      floatText('pv-float', '+' + fmt(Math.round(mpGain)) + ' MP', 'mp');
    }
    // 被動：暈眩 / 減速
    if (!res.killed) {
      if ((st.passives.stun || 0) > 0 && chance(st.passives.stun) && !resistCtrl(monsterDefCfg(mEnt))) {
        applyEffect(mEnt, 'stun', 1);
        logMsg += '<span class="log-hl-good">將其擊暈！</span>';
      }
      if ((st.passives.slowHit || 0) > 0 && chance(st.passives.slowHit) && !resistCtrl(monsterDefCfg(mEnt))) {
        applyEffect(mEnt, 'slow', 3);
        logMsg += '<span class="log-hl-good">附加減速！</span>';
      }
    }
  }
  // 連擊（僅一層）；補刀擊殺必須回報給呼叫端
  if (!res.killed && !depth && (st.passives.doubleHit || 0) > 0 && chance(st.passives.doubleHit)) {
    var res2 = doPlayerAttack(pEnt, mEnt, floatSel, 1);
    logMsg += ' <span class="log-hl-good">觸發連擊！</span>追加' + res2.logText;
    if (res2 && res2.killed) { res.killed = true; res.dmg += res2.dmg; }
  }
  res.logText = logMsg;
  if (!depth) {
    blog('⚔️ ' + logMsg, 'dim-text', 'combat');
  }
  return res;
}

// 怪物攻擊玩家
var THORN_FLOAT_MAP = { 'pv-float': 'mv-float', 'tp-float': 'tb-float' };
function doMonsterAttack(mEnt, pEnt, floatSel, mult) {
  var dCfg = playerDefCfg(pEnt);
  var res = resolveHit(mEnt, pEnt, monsterAtkCfg(mEnt, mult), dCfg);
  var logMsg = (mEnt.name || '怪物') + (mult && mult > 1 ? ' <span class="log-hl-bad">重擊</span>你，' : ' 攻擊你，');
  if (res.miss) {
    floatText(floatSel, 'MISS', 'miss');
    logMsg += '<span class="log-hl-good">被你閃避了！</span>';
  } else {
    var isCrit = mult && mult > 1;
    var dmgStr = fmt(res.dmg);
    if (isCrit) dmgStr = '爆擊 ' + dmgStr;
    if (res.blocked) dmgStr = '格擋 ' + dmgStr;
    floatText(floatSel, dmgStr, isCrit ? 'crit' : 'mdmg');
    logMsg += '造成 ' + fmt(res.dmg) + (mEnt.magic ? ' 魔法' : '') + ' 傷害。';
    if (res.blocked) logMsg += '<span class="log-hl-good">你格擋了部分傷害！</span>';
    if (res.absorbed) logMsg += '<span class="log-hl-good">護盾吸收 ' + fmt(res.absorbed) + '。</span>';
    if (res.procs.length) logMsg += '<span class="log-hl-bad">［' + res.procs.join('・') + '］</span>';
  }
  if (res.thorns) {
    floatText(THORN_FLOAT_MAP[floatSel] || floatSel, '反傷 ' + fmt(res.thorns), 'defend');
    logMsg += '<span class="log-hl-good">並遭到荊棘反震 ' + fmt(res.thorns) + ' 傷害！</span>';
  }
  blog('🛡️ ' + logMsg, 'dim-text', 'combat');
  return res;
}

function trackDps(dmg) {
  FIELD.dpsWindow.push([GT, dmg]);
  while (FIELD.dpsWindow.length && FIELD.dpsWindow[0][0] < GT - 10) FIELD.dpsWindow.shift();
}
function currentDps() {
  var sum = 0;
  for (var i = 0; i < FIELD.dpsWindow.length; i++) sum += FIELD.dpsWindow[i][1];
  var span = Math.min(10, Math.max(1, GT - (G._startGT || 0)));
  return sum / Math.min(10, span);
}

/* ---- 野外主迴圈 ---- */
function fieldTick(dt) {
  if (G.tower.active) return; // 高塔戰鬥期間野外暫停
  var st = getStats();
  if (!FIELD.player) initFieldPlayer();
  var p = FIELD.player;

  // 死亡復活
  if (FIELD.reviveCd > 0) {
    FIELD.reviveCd -= dt;
    if (FIELD.reviveCd <= 0) {
      p.hp = st.hp; p.mp = st.mp; p.shield = 0;
      cleanse(p);
      blog('💫 你已復活，繼續征途！', 'info');
      UI.dirty.battle = true;
    }
    return;
  }

  // 回復：基礎 1.5%/秒 + 生命恢復屬性 + 再生增益；法力恢復；技能冷卻
  var hot = buffVal(p, 'hot');
  if (p.hp < st.hp) p.hp = Math.min(st.hp, p.hp + (st.hp * (0.015 + hot / 100) + st.hpRegen) * dt);
  p.mp = Math.min(st.mp, p.mp + st.mpRegen * dt);
  tickSkillCds(p, dt);

  // 持續傷害（玩家：中毒 / 詛咒等）
  if (tickPoison(p, dt) || tickDots(p, dt)) { onPlayerFieldDeath(); return; }

  // 出怪
  if (!FIELD.monster) {
    FIELD.respawnCd -= dt;
    if (FIELD.respawnCd <= 0) spawnFieldMonster();
    return;
  }
  var m = FIELD.monster;

  // 持續傷害（怪物：中毒 / 流血 / 燃燒 / 詛咒）
  if (tickPoison(m, dt) || tickDots(m, dt)) { onFieldKill(m); return; }

  // 玩家行動（減速 -30%；時間扭曲等攻速增益加速）
  if (!effectActive(p, 'stun')) {
    // 技能優先（依裝載順序）
    var sres = pickAndCastSkill(p, m, 'mv-float');
    if (sres && sres.killed) { onFieldKill(m); return; }
    if (p.hp <= 0) { onPlayerFieldDeath(); return; } // 狂暴打擊等自傷技能
    p.atkCd -= dt * slowFactor(p) * (1 + buffVal(p, 'aspdUp') / 100);
    if (p.atkCd <= 0) {
      var res = doPlayerAttack(p, m, 'mv-float');
      p.atkCd += 1 / st.aspd;
      if (res.killed) { onFieldKill(m); return; }
    }
  }
  // 怪物攻擊
  if (!effectActive(m, 'stun')) {
    m.atkCd -= dt * slowFactor(m);
    if (m.atkCd <= 0) {
      doMonsterAttack(m, p, 'pv-float');
      m.atkCd += 1 / m.aspd;
      if (p.hp <= 0) { onPlayerFieldDeath(); return; }
      if (m.hp <= 0) { onFieldKill(m); return; } // 反震擊殺
    }
  }
}

function onFieldKill(m) {
  var st = getStats();
  // 擊殺回復 12% 最大生命（溢出轉護盾）
  healPlayer(FIELD.player, st.hp * 0.12, st);
  // 吸魂
  if ((st.passives.soulEater || 0) > 0) {
    healPlayer(FIELD.player, st.hp * st.passives.soulEater / 100, st);
  }
  var goldGain = Math.round(m.gold * (1 + st.goldBonus / 100));
  var xpGain = Math.round(m.xp * (1 + st.xpBonus / 100));
  G.player.gold += goldGain;
  gainXp(xpGain);
  blog('💀 擊敗 ' + m.name + '，獲得 ' + fmt(goldGain) + ' 金幣、' + fmt(xpGain) + ' 經驗值。', 'good', 'combat');
  rollFieldDrops(m);
  G.stage.kills++;
  FIELD.monster = null;
  // 移動速度：縮短推圖間隔
  FIELD.respawnCd = RESPAWN_DELAY * (1 - st.moveSpeed / 100);
  if (G.stage.kills >= KILLS_PER_STAGE) {
    G.stage.kills = 0;
    if (G.stage.autoAdvance) {
      G.stage.current++;
      if (G.stage.current > G.stage.best) G.stage.best = G.stage.current;
      blog('🚩 推進至第 ' + G.stage.current + ' 階段！', 'good');
    }
  }
  UI.dirty.battle = true; UI.dirty.header = true;
}

function onPlayerFieldDeath() {
  blog('☠️ 你被擊倒了…退回第 1 階段重頭來過（' + REVIVE_DELAY + ' 秒後復活）', 'bad');
  flushRunSummary();
  FIELD.monster = null;
  FIELD.reviveCd = REVIVE_DELAY;
  G.stage.kills = 0;
  G.stage.current = 1;
  UI.dirty.battle = true;
}

/* ---- 掉落 ---- */
function rollFieldDrops(m) {
  var st = getStats();
  var s = G.stage.current;
  var lootBonus = st.loot + buffVal(FIELD.player, 'lootUp'); // 尋寶直覺增益
  // 裝備：依「物品掉落表」各品質獨立擲骰（掉寶率加成、菁英 x2）
  var rates = dropRatesFor(FIELD_DROP_TABLE, m.level);
  var dropMult = (1 + lootBonus / 100) * (m.elite ? 2 : 1);
  for (var r = 0; r < rates.length; r++) {
    if (!rates[r]) continue;
    var n = rollDropCount(rates[r] * dropMult);
    for (var k = 0; k < n; k++) {
      var it = makeEquipment(s, { rarity: r });
      pushConveyor(it);
      if (r >= 4) blog('✨ 獲得 ' + rarityTag(it) + '！已送入生產線', 'loot');
    }
  }
  // 寶石（階段 4+，隨機種類）
  if (s >= 4 && chance(6 * (1 + lootBonus / 100))) {
    var glv = clamp(1 + Math.floor(s / 15), 1, GEM_MAX_LEVEL);
    var lv = wpick([[glv, 70], [Math.max(1, glv - 1), 30]]);
    var gtype = randomGemType();
    addGem(gtype, lv, 1);
    flog('💎 撿到 ' + gemLabel(gtype, lv), 'info');
  }
  // 附魔書（階段 8+）
  if (s >= 8 && chance(4 * (1 + lootBonus / 100))) {
    var bk = pick(Object.keys(ENCHANTS));
    G.player.books[bk]++;
    flog('📖 撿到 ' + ENCHANTS[bk].name + '書', 'info');
  }
  // 附魔精華（階段 10+）
  if (s >= 10 && chance(3)) {
    G.player.essence += ri(1, 2);
  }
}

/* ---- 手動階段控制 ---- */
function stageGo(delta) {
  var t = G.stage.current + delta;
  if (t < 1 || t > G.stage.best) return;
  G.stage.current = t;
  G.stage.kills = 0;
  FIELD.monster = null;
  FIELD.respawnCd = 0.3;
  UI.dirty.battle = true;
}
/* ---- 塔戰相關邏輯省略 ---- */

window.RUN_STATS = { runCount: 1, maxStage: 1, skills: {} };
function recordRunDamage(skillName, dmg) {
  if (!RUN_STATS.skills[skillName]) RUN_STATS.skills[skillName] = { count: 0, damage: 0 };
  RUN_STATS.skills[skillName].count++;
  RUN_STATS.skills[skillName].damage += (dmg || 0);
  RUN_STATS.maxStage = Math.max(RUN_STATS.maxStage, G.stage.current);
}

function generateSummaryHtml() {
  var totalDmg = 0;
  for (var k in RUN_STATS.skills) totalDmg += RUN_STATS.skills[k].damage;
  if (totalDmg === 0) return '';
  var html = '<div class="summary-card">';
  html += '<div class="summary-card-title">------------第 ' + RUN_STATS.runCount + ' 場戰鬥--------------</div>';
  html += '<div class="summary-card-row">最高關數：' + RUN_STATS.maxStage + '</div>';
  for (var k in RUN_STATS.skills) {
    var sk = RUN_STATS.skills[k];
    var pct = totalDmg > 0 ? (sk.damage / totalDmg * 100).toFixed(1) : 0;
    html += '<div class="summary-card-row">' + k + '：' + fmt(sk.count) + '次，傷害 ' + Math.round(sk.damage).toLocaleString() + ' (' + pct + '%)</div>';
  }
  html += '</div>';
  return html;
}

function flushRunSummary() {
  var list = $id('battle-summary-list');
  var html = generateSummaryHtml();
  if (list && html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    list.insertBefore(d.firstChild, list.firstChild);
  }
  RUN_STATS.runCount++;
  RUN_STATS.maxStage = G.stage.current > 1 ? 1 : G.stage.current; // Next run starts at 1
  RUN_STATS.skills = {};
}
