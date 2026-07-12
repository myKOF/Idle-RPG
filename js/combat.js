'use strict';
/* ============ 戰鬥引擎（野外 + 共用攻擊邏輯 + 技能） ============ */

// 野外戰鬥狀態
var FIELD = {
  player: null,      // { hp, mp, shield, atkCd, skillCd, effects:{}, poisonUntil, poisonDps }
  monster: null,
  monsters: [],
  respawnCd: 0,
  reviveCd: 0,
  dpsWindow: []      // [ [GT, dmg], ... ] 供 DPS 顯示
};

function newPlayerEntity(st) {
  return { hp: st.hp, mp: st.mp, shield: 0, atkCd: 1 / st.aspd, skillCds: {}, skillGcd: 0, buffs: {}, dots: [], effects: {}, poisonUntil: 0, poisonDps: 0 };
}

function initFieldPlayer() {
  FIELD.player = newPlayerEntity(getStats());
}

function fieldEnemyList() {
  if (Array.isArray(FIELD.monsters) && (FIELD.monsters.length || !FIELD.monster)) return FIELD.monsters;
  return FIELD.monster ? [FIELD.monster] : [];
}

function syncFieldPrimary() {
  var enemies = Array.isArray(FIELD.monsters) ? FIELD.monsters : fieldEnemyList();
  FIELD.monster = enemies.length ? enemies[0] : null;
  FIELD.monsters = enemies;
}

function liveFieldEnemies() {
  return fieldEnemyList().filter(function (m) { return m && m.hp > 0; });
}

function markFieldEnemyFloatTargets(enemies) {
  for (var i = 0; i < enemies.length; i++) enemies[i].floatSel = 'mv-float-' + i;
}

function spawnFieldMonster() {
  var s = G.stage.current;
  var elite = isEliteStage(s); // 菁英規則 → formula.js §4
  var base = monsterStatsFor(s, elite);
  var zn = currentZoneDef();
  var count = rollFieldEnemyCount();
  var enemies = [];
  for (var i = 0; i < count; i++) {
    var mtype = pick(zn.pool);
    enemies.push({
      name: (elite ? '菁英・' : '') + mtype.name, emoji: mtype.emoji,
      level: base.level,
      maxHp: base.hp * zn.hpMult, hp: base.hp * zn.hpMult,
      atk: base.atk * zn.atkMult,
      def: base.def * zn.defMult, mdef: base.mdef * zn.defMult,
      magic: !!mtype.magic,          // 魔法系怪物：攻擊對玩家魔防
      aspd: base.aspd, dodge: base.dodge,
      elite: elite, isBoss: false,
      gold: base.gold * zn.rewardMult, xp: base.xp * zn.rewardMult, // 金幣/經驗 x場景倍率
      atkCd: 1 / base.aspd + 0.4, effects: {}, ctrlRes: 0,
      poisonUntil: 0, poisonDps: 0, shield: 0, buffs: {}, dots: []
    });
  }
  FIELD.monsters = enemies;
  markFieldEnemyFloatTargets(enemies);
  syncFieldPrimary();
  UI.dirty.battle = true;
}

/* ---- 場景切換：各場景獨立保存進度與最高階段 ---- */
function switchZone(zoneKey) {
  if (!ZONES[zoneKey] || G.stage.zone === zoneKey) return;
  var zd = ZONES[zoneKey];
  if (zd.reqZone) {
    var b = (G.stage.zone === zd.reqZone) ? G.stage.best : ((G.zoneProgress && G.zoneProgress[zd.reqZone] && G.zoneProgress[zd.reqZone].best) || 1);
    if (b < zd.reqStage) return; // 尚未解鎖
  }
  // 保存目前場景進度
  if (!G.zoneProgress) G.zoneProgress = {};
  G.zoneProgress[G.stage.zone || 'plains'] = { current: G.stage.current, best: G.stage.best };
  // 載入目標場景進度
  var zp = G.zoneProgress[zoneKey] || { current: 1, best: 1 };
  G.stage.zone = zoneKey;
  G.stage.current = zp.current || 1;
  G.stage.best = zp.best || 1;
  G.stage.kills = 0;
  FIELD.monster = null;
  FIELD.monsters = [];
  FIELD.respawnCd = 0.5;
  var zn = ZONES[zoneKey];
  blog(zn.emoji + ' 前往【' + zn.name + '】！第 ' + G.stage.current + ' 階段（歷史最高 ' + G.stage.best +
    (zn.rewardMult > 1 ? '，非裝備掉落 x' + zn.rewardMult : '') + '）', 'info');
  UI.dirty.battle = true;
}

/* ---- 效果（暈眩/減速/中毒/淨化） ---- */
function applyEffect(ent, key, dur) { ent.effects[key] = GT + dur; }
function effectActive(ent, key) { return (ent.effects[key] || 0) > GT; }
// 減速攻速倍率公式 slowFactor → js/formula.js §3

function applyPoison(ent, dps, dur) {
  ent.poisonDps = Math.max(ent.poisonDps || 0, dps);
  ent.poisonUntil = GT + dur;
}
function poisonActive(ent) { return (ent.poisonUntil || 0) > GT; }
// 中毒跳傷（無視防禦）；回傳是否致死
function tickPoison(ent, dt) {
  if (!poisonActive(ent)) return false;
  ent.hp -= ent.poisonDps * dt * globalDamageMultiplierForEntity(ent);
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
    ent.hp -= total * dt * globalDamageMultiplierForEntity(ent);
    if (ent.hp <= 0) { ent.hp = 0; return true; }
  }
  return false;
}

function globalDamageMultiplierForEntity(ent) {
  var total = ent && ent.globalDmgRed || 0;
  if (ent === FIELD.player && typeof getStats === 'function') {
    var st = getStats();
    total = st.globalDmgRed || 0;
  }
  return globalDamageMultiplier(total);
}

/* ---- 共用攻擊流程 ----
   傷害結算總公式 resolveHit 與控制抵抗判定 resistCtrl → js/formula.js §3 */

/* ---- 攻防組態（pEnt 可帶入戰鬥實體以套用技能增益） ---- */
function playerAtkCfg(pEnt) {
  var st = getStats();
  var atkMul = 1 + buffVal(pEnt, 'atkUp') / 100;
  // 神鑄特效【神怒】：生命低於 30% 時，造成的傷害提高
  if (pEnt && (st.passives.godWrath || 0) > 0 && pEnt.hp < st.hp * 0.3) {
    atkMul *= 1 + st.passives.godWrath / 100;
  }
  return {
    atk: st.atk * atkMul, matk: st.matk * atkMul, dmgType: 'both', level: st.level,
    critRate: st.critRate, critDmg: st.critDmg + buffVal(pEnt, 'critDmgUp'), hit: st.hit,
    sunder: st.passives.sunder || 0, pen: st.pPen, mPen: st.mPen,
    trueDmgPct: st.passives.trueDmg || 0, elemAtk: st.elemAtk, globalDmgRed: st.globalDmgRed,
    annihilate: st.passives.annihilate || 0,
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
    dmgRed: st.passives.sanctuary || 0, globalDmgRed: st.globalDmgRed, undying: st.passives.undying || 0,
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
    critRate: 5, critDmg: 150, hit: 100, elemAtk: ea, globalDmgRed: m.globalDmgRed || 0
  };
}
function monsterDefCfg(m) {
  var defMul = 1 - buffVal(m, 'defDown') / 100;
  return {
    def: m.def * defMul, mdef: (m.mdef || m.def * 0.75) * defMul, level: m.level, dodge: m.dodge || 0,
    resist: m.resist || {}, ctrlRes: m.ctrlRes || 0, maxHp: m.maxHp,
    isElite: !!m.elite, isBoss: !!m.isBoss, globalDmgRed: m.globalDmgRed || 0
  };
}

/* ---- 治療（溢出轉護盾）公式 healPlayer → js/formula.js §3 ---- */

// 完整的一次玩家普攻（含連擊/暈眩/減速/吸血/吸魔/暗影汲取）
function doPlayerAttack(pEnt, mEnt, floatSel, depth) {
  var st = getStats();
  var res = resolveHit(pEnt, mEnt, playerAtkCfg(pEnt), monsterDefCfg(mEnt));
  var mName = mEnt.name || '怪物';
  var logMsg = (depth ? '' : '你攻擊 ' + mName + '，');
  if (res.miss) {
    floatText(mEnt.floatSel || floatSel, 'MISS', 'miss');
    logMsg += (depth ? '<span class="log-hl-bad">攻擊被閃避了！</span>' : '<span class="log-hl-bad">被閃避了！</span>');
  } else {
    var dmgStr = fmt(res.dmg);
    if (res.crit) dmgStr = '爆擊 ' + dmgStr;
    if (res.blocked) dmgStr = '格擋 ' + dmgStr;
    floatText(mEnt.floatSel || floatSel, dmgStr, res.crit ? 'crit' : 'dmg');
    trackDps(res.dmg);
    recordRunDamage('普攻', res.dmg);
    logMsg += (res.crit ? '<span class="log-hl-good">爆擊</span> ' : '造成 ') + fmt(res.dmg) + ' 傷害。';
    if (res.blocked) logMsg += '<span class="log-hl-bad">（被格擋）</span>';
    if (res.procs.length) logMsg += '<span class="log-hl-good">［' + res.procs.join('・') + '］</span>';
    if (res.thorns) logMsg += '<span class="log-hl-bad">遭到反震 ' + fmt(res.thorns) + ' 傷害。</span>';
    // 吸血 / 暗影汲取 / 吸魔（神鑄特效【萬象汲取】同時加成生命與法力回復）
    var omni = st.passives.omniDrain || 0;
    var healAmt = res.dmg * (st.lifesteal + omni) / 100 + (res.heal || 0);
    if (healAmt > 0) {
      healPlayer(pEnt, healAmt, st);
      floatText('pv-float', '+' + fmt(Math.round(healAmt)), 'heal');
      if (st.lifesteal > 0 || omni > 0 || res.heal) logMsg += '<span class="log-hl-good">汲取回復 ' + fmt(healAmt) + '。</span>';
    }
    if (st.manaSteal + omni > 0) {
      var mpGain = res.dmg * (st.manaSteal + omni) / 100;
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
      // 神鑄特效【天罰】：機率降下神雷，造成 250% 物理攻擊的真實傷害（無視防禦）
      if ((st.passives.smite || 0) > 0 && chance(st.passives.smite)) {
        var smiteDmg = Math.max(1, Math.round(st.atk * 2.5));
        mEnt.hp -= smiteDmg;
        trackDps(smiteDmg);
        recordRunDamage('天罰', smiteDmg);
        floatText(mEnt.floatSel || floatSel, '⚡' + fmt(smiteDmg), 'crit');
        logMsg += '<span class="log-hl-good">天罰降臨，追加 ' + fmt(smiteDmg) + ' 真實傷害！</span>';
        if (mEnt.hp <= 0) { mEnt.hp = 0; res.killed = true; res.dmg += smiteDmg; }
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

  // 回復：基礎 BASE_HP_REGEN_PCT%/秒 + 生命恢復屬性 + 再生增益；法力恢復；技能冷卻
  var hot = buffVal(p, 'hot');
  if (p.hp < st.hp) p.hp = Math.min(st.hp, p.hp + (st.hp * (BASE_HP_REGEN_PCT / 100 + hot / 100) + st.hpRegen) * dt);
  p.mp = Math.min(st.mp, p.mp + st.mpRegen * dt);
  tickSkillCds(p, dt);

  // 持續傷害（玩家：中毒 / 詛咒等）
  if (tickPoison(p, dt) || tickDots(p, dt)) { onPlayerFieldDeath(); return; }

  // 出怪
  if (!liveFieldEnemies().length) {
    FIELD.respawnCd -= dt;
    if (FIELD.respawnCd <= 0) spawnFieldMonster();
    return;
  }
  var enemies = liveFieldEnemies();

  // 持續傷害（怪物：中毒 / 流血 / 燃燒 / 詛咒）
  for (var di = 0; di < enemies.length; di++) {
    if (tickPoison(enemies[di], dt) || tickDots(enemies[di], dt)) onFieldKill(enemies[di]);
  }
  enemies = liveFieldEnemies();
  if (!enemies.length) return;

  // 玩家行動（減速 -30%；時間扭曲等攻速增益加速）
  if (!effectActive(p, 'stun')) {
    // 技能優先（依裝載順序）
    var sres = pickAndCastSkill(p, enemies, 'mv-float');
    if (sres && sres.killed) {
      onFieldDeaths();
      enemies = liveFieldEnemies();
      if (!enemies.length) return;
      return;
    }
    if (p.hp <= 0) { onPlayerFieldDeath(); return; } // 狂暴打擊等自傷技能
    p.atkCd -= dt * slowFactor(p) * (1 + buffVal(p, 'aspdUp') / 100);
    if (p.atkCd <= 0) {
      // 普攻固定鎖定第一名存活敵人，直到其死亡才切換下一名。
      var primary = liveFieldEnemies()[0];
      var res = doPlayerAttack(p, primary, primary.floatSel || 'mv-float');
      p.atkCd += 1 / st.aspd;
      if (res.killed) onFieldDeaths();
      if (!liveFieldEnemies().length) return;
    }
  }
  // 怪物攻擊
  enemies = liveFieldEnemies();
  for (var mi = 0; mi < enemies.length; mi++) {
    var m = enemies[mi];
    if (!effectActive(m, 'stun')) {
      m.atkCd -= dt * slowFactor(m);
      if (m.atkCd <= 0) {
        doMonsterAttack(m, p, 'pv-float');
        m.atkCd += 1 / m.aspd;
        if (p.hp <= 0) { onPlayerFieldDeath(); return; }
        if (m.hp <= 0) onFieldKill(m); // 反震擊殺
      }
    }
  }
}

function onFieldKill(m) {
  if (!m || m._rewarded) return;
  m._rewarded = true;
  var st = getStats();
  // 擊殺回復 KILL_HEAL_PCT% 最大生命（溢出轉護盾）
  healPlayer(FIELD.player, st.hp * KILL_HEAL_PCT / 100, st);
  // 吸魂
  if ((st.passives.soulEater || 0) > 0) {
    healPlayer(FIELD.player, st.hp * st.passives.soulEater / 100, st);
  }
  var goldGain = Math.round(m.gold * (1 + st.goldBonus / 100));
  var xpGain = Math.round(m.xp * (1 + st.xpBonus / 100));
  G.player.gold += goldGain;
  gainXp(xpGain);
  
  var drops = rollFieldDrops(m);
  blog('💀 擊敗 ' + m.name, 'dim-text', 'combat');
  var lootMsg = '📦 戰利品：💰' + fmt(goldGain) + ' 💡' + fmt(xpGain);
  if (drops.length) lootMsg += ' ' + drops.join('、');
  blog(lootMsg, 'good', 'loot');
  var enemies = fieldEnemyList();
  var idx = enemies.indexOf(m);
  if (idx >= 0) enemies.splice(idx, 1);
  FIELD.monsters = enemies;
  markFieldEnemyFloatTargets(enemies);
  syncFieldPrimary();
  if (enemies.length) {
    UI.dirty.battle = true;
    return;
  }
  G.stage.kills++;
  // 移動速度：縮短推圖間隔；只有整波敵人全部擊殺後才進入下一波。
  FIELD.respawnCd = RESPAWN_DELAY * (1 - st.moveSpeed / 100);
  if (G.stage.autoAdvance) {
    G.stage.current++;
    if (G.stage.current > G.stage.best) G.stage.best = G.stage.current;
    blog('🚩 推進至第 ' + G.stage.current + ' 階段！', 'good');
  }
  UI.dirty.battle = true; UI.dirty.header = true;
}

function onFieldDeaths() {
  var enemies = fieldEnemyList().slice();
  for (var i = 0; i < enemies.length; i++) {
    if (enemies[i].hp <= 0) onFieldKill(enemies[i]);
  }
}

function onPlayerFieldDeath() {
  blog('☠️ 你被擊倒了…退回第 1 階段重頭來過（' + REVIVE_DELAY + ' 秒後復活）', 'bad');
  flushRunSummary();
  FIELD.monster = null;
  FIELD.monsters = [];
  FIELD.reviveCd = REVIVE_DELAY;
  G.stage.kills = 0;
  G.stage.current = 1;
  UI.dirty.battle = true;
}

/* ---- 掉落 ---- */
function rollFieldDrops(m) {
  var st = getStats();
  var s = G.stage.current;
  var lootBonus = st.loot + effectiveDropRateEffect(buffVal(FIELD.player, 'lootUp')); // 尋寶直覺增益已減半
  var drops = [];
  // 菁英掉落：裝備與材料都在一般基礎上乘 1.5，不再使用舊版裝備 x2／零件 x3 特例。
  var rates = dropRatesFor(FIELD_DROP_TABLE, m.level);
  var eliteDropMult = m.elite ? 1.5 : 1;
  var dropMult = (1 + lootBonus / 100) * eliteDropMult;
  for (var r = 0; r < rates.length; r++) {
    if (!rates[r]) continue;
    var n = rollDropCount(rates[r] * dropMult);
    for (var k = 0; k < n; k++) {
      var it = makeEquipment(s, { rarity: r, ancientRate: ancientAffixChanceForEnemy(m.level) });
      pushConveyor(it);
      drops.push('裝備[' + rarityTag(it) + ']');
    }
  }
  // ===== 材料掉落：場景倍率（荒漠 x2 / 沼澤 x3；>100% 依必掉+餘數規則）
  //       基礎機率與寶石等級公式 → formula.js §5 =====
  var rw = currentZoneDef().rewardMult;
  // 寶石（階段 4+，隨機種類）
  if (s >= 4) {
    var gemN = rollDropCount(FIELD_GEM_DROP_PCT * (1 + lootBonus / 100) * rw * eliteDropMult);
    for (var gi = 0; gi < gemN; gi++) {
      var lv = fieldGemLevelFor(s);
      var gtype = randomGemType();
      addGem(gtype, lv, 1);
      drops.push('💎' + gemLabel(gtype, lv));
    }
  }
  // 附魔書（階段 8+）
  if (s >= 8) {
    var bookN = rollDropCount(FIELD_BOOK_DROP_PCT * (1 + lootBonus / 100) * rw * eliteDropMult);
    for (var bi = 0; bi < bookN; bi++) {
      var bk = pick(Object.keys(ENCHANTS));
      G.player.books[bk]++;
      drops.push('📖' + ENCHANTS[bk].name + '書');
    }
  }
  // 附魔精華（階段 10+，數量 x場景倍率）
  if (s >= 10 && chance(FIELD_ESSENCE_DROP_PCT * eliteDropMult)) {
    var amt = ri(1, 2) * rw;
    G.player.essence += amt;
    drops.push('✨精華x' + amt);
  }
  // 太古精華（250 級以上敵人；獨立機率，不受掉寶率與場景倍率影響）
  var ancientEssenceRate = ancientEssenceDropChanceForEnemy(m.level) * eliteDropMult;
  if (ancientEssenceRate > 0 && chance(ancientEssenceRate)) {
    G.player.ancientEssence = (G.player.ancientEssence || 0) + 1;
    drops.push('🧬太古精華');
    UI.dirty.header = true;
  }
  // 魔塵（神鑄材料）：150 級起掉落，敵人每高 1 級 +0.1%、上限 5%
  //（fieldDustRate → formula.js §5；不受掉寶率/場景倍率影響）
  var dustRate = fieldDustRate(m.level) * eliteDropMult;
  if (dustRate > 0 && chance(dustRate)) {
    G.player.dust = (G.player.dust || 0) + 1;
    drops.push('💫魔塵');
    blog('💫 敵人掉落神鑄材料：魔塵 x1（持有 ' + fmt(G.player.dust) + '）', 'loot');
    UI.dirty.forge = true;
  }
  // 自動機組零件（階段 5+；材料掉落率同樣乘以菁英 1.5 倍）
  if (s >= 5) {
    var partN = rollDropCount(FIELD_PART_DROP_PCT * (1 + lootBonus / 100) * rw * eliteDropMult);
    for (var pn = 0; pn < partN; pn++) {
      var np = makePart(fieldPartTierFor(s, m.elite));
      if (!np) continue;
      G.factory.parts.push(np);
      drops.push('🔧' + PART_TYPES[np.key].emoji + np.name);
      if (np.tier >= 3) blog('🔩 敵人掉落自動機組零件：' + PART_TYPES[np.key].emoji + np.name + '（' + partDesc(np) + '）', 'loot');
    }
    if (partN) { trimFactoryParts(); UI.dirty.factory = true; } // 收斂零件庫存，防無限成長
  }
  return drops;
}

/* ---- 手動階段控制 ---- */
function stageGo(delta) {
  var t = G.stage.current + delta;
  if (t < 1 || t > G.stage.best) return;
  G.stage.current = t;
  G.stage.kills = 0;
  FIELD.monster = null;
  FIELD.monsters = [];
  FIELD.respawnCd = 0.3;
  UI.dirty.battle = true;
}
function stageGoMax() {
  stageGo(G.stage.best - G.stage.current);
}
/* ---- 塔戰相關邏輯省略 ---- */

window.RUN_STATS = { runCount: 1, maxStage: 1, skills: {} };
function recordRunDamage(skillName, dmg) {
  if (!RUN_STATS.skills[skillName]) RUN_STATS.skills[skillName] = { count: 0, damage: 0 };
  RUN_STATS.skills[skillName].count++;
  RUN_STATS.skills[skillName].damage += (dmg || 0);
  RUN_STATS.maxStage = Math.max(RUN_STATS.maxStage, G.stage.current);
}

function generateSummaryHtml(current) {
  var totalDmg = 0;
  for (var k in RUN_STATS.skills) totalDmg += RUN_STATS.skills[k].damage;
  if (totalDmg === 0) return '';
  var html = '<div class="summary-card"' + (current ? ' data-summary-current="true"' : '') + '>';
  html += '<div class="summary-card-title">------------' + (current ? '目前戰鬥（即時統計）' : '第 ' + RUN_STATS.runCount + ' 場戰鬥') + '--------------</div>';
  html += '<div class="summary-card-row"><span style="color:var(--accent)">最高關數</span>：' + RUN_STATS.maxStage + '</div>';
  for (var k in RUN_STATS.skills) {
    var sk = RUN_STATS.skills[k];
    var pct = totalDmg > 0 ? (sk.damage / totalDmg * 100).toFixed(1) : 0;
    html += '<div class="summary-card-row"><span style="color:var(--accent)">' + k + '</span>：' + fmt(sk.count) + '次，傷害 ' + Math.round(sk.damage).toLocaleString() + ' (' + pct + '%)</div>';
  }
  html += '</div>';
  return html;
}

function flushRunSummary() {
  var list = $id('battle-summary-list');
  if (list) {
    var current = list.querySelector('[data-summary-current]');
    if (current) current.remove();
  }
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
