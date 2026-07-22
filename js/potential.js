'use strict';
/* ============ 潛力技能（戰鬥效果模組 V3）============
   主動潛力技能：與一般技能相同，需裝入「裝載欄」（鍵值 'potential:<id>'）才會施放；
                冷卻共用 pEnt.skillCds、施放共用 pickAndCastSkill（skills.js）與 GCD/硬直節奏。
   被動潛力技能：極速之力（攻速＋解除上限）與混沌雙修（crossCore）於 computeStats 併入；
                不屈意志（免死）於 resolveHit 致命段處理。皆學會即常駐、無需裝備。
   數值 potentialSkillValue / 上限 potentialSkillMaxLv / 是否生效 potentialSkillActive → js/talents.js
   資料表 POTENTIAL_TALENTS → js/data.js（含 type/cd/base/per/dmgType/dur/mech）。

   ── 詮釋備註（天賦V3.xlsx 第 2 頁為設計草案，以下為實作取捨；細節見 game_formula.md）──
   ・極速之力：因無持續時間、效果為攻速加成＋解除 5 次/秒上限，實作為「被動常駐」。
   ・時間坍縮：施放時對「一般技能」冷卻額外提供 CDR 並突破 60% 上限（總 CDR 於施放時夾 90%）；不影響潛力技能自身冷卻。
   ・混沌雙修：所有技能傷害段套用物↔魔互補加成（skills.js castSkill）。
   ・雷霆過載：期間雷電系技能傷害 +值%，並於命中後追加 (3＋連擊數) 次、各 10% 該擊傷害的連鎖。
   ・聖療逆轉：期間生命/法力回復額外 +值%，溢出的回復量 ×值% 對主要敵人造成真實傷害。
   ・時空凝滯：期間所有敵人靜止（stun，遵守 BOSS 控場免疫）＋玩家所有直接傷害 +值%。 */

// 不屈意志內部冷卻（秒）＝ 90 − 值（下限 1）；不受冷卻縮減影響。
function potentialUndyingCd() {
  return Math.max(1, 90 - potentialSkillValue('lastStandUndying'));
}

// 潛力主動技能實際冷卻：吃一般冷卻縮減（夾 60%），不受時間坍縮的突破效果影響。
function potentialActiveCd(def) {
  var cdr = (typeof getStats === 'function') ? Math.min(60, getStats().cdr || 0) : 0;
  return Math.max(0.1, (def.cd || 0) * (1 - cdr / 100));
}

// 可施放（可裝入裝載欄）的潛力機制；被動 aspd/crossCore 與被動觸發 undyingGuard 不在此列。
var POTENTIAL_CASTABLE_MECHS = {
  chainLightning: 1, cdrUncap: 1, invuln: 1, enemySlow: 1, omega: 1, sacredInvert: 1, timeStop: 1
};

// 此潛力技能是否可裝入裝載欄（主動且有施放效果）。
function potentialEquippable(def) {
  return !!(def && def.type === 'active' && POTENTIAL_CASTABLE_MECHS[def.mech]);
}

/* 由 pickAndCastSkill（skills.js）呼叫：施放裝載欄中的潛力技能。
   冷卻寫入 pEnt.skillCds[loadoutKey]（與一般技能共用 tick 與就緒排序），
   並套用共用 GCD 與施放硬直。回傳 { killed, dmg }（與 castSkill 相同介面）。 */
function castPotentialSkill(pEnt, target, def, floatSel, loadoutKey) {
  var st = getStats();
  var targets = Array.isArray(target)
    ? target.filter(function (e) { return e && e.hp > 0; })
    : (target && target.hp > 0 ? [target] : []);
  if (!pEnt.skillCds) pEnt.skillCds = {};
  pEnt.skillCds[loadoutKey || ('potential:' + def.id)] = potentialActiveCd(def);
  pEnt.skillGcd = SKILL_GLOBAL_COOLDOWN;
  pEnt.atkCd += SKILL_CAST_LOCK * (1 - st.castSpeed / 100); // 施放硬直（與一般技能一致）
  var res = firePotentialActive(pEnt, def, targets, floatSel, st);
  UI.dirty.battle = true;
  return { killed: !!(res && res.killed), dmg: (res && res.dmg) || 0 };
}

// 執行潛力技能效果；回傳 { killed, dmg }。
function firePotentialActive(pEnt, def, live, floatSel, st) {
  var val = potentialSkillValue(def.id);
  var dur = def.dur || 0;
  switch (def.mech) {
    case 'cdrUncap':                 // 時間坍縮
      applyBuff(pEnt, 'chronoCdr', val, dur);
      floatPlayerEvent(floatSel, def.emoji + ' CDR+' + fmt1(val) + '%', 'special');
      blog(def.emoji + ' 你施放潛力【' + def.name + '】：冷卻縮減突破上限 +' + fmt1(val) + '%（' + dur + '秒）。', 'log-player-buff', 'combat');
      return { killed: false, dmg: 0 };
    case 'invuln':                   // 絕對領域
      pEnt.effects = pEnt.effects || {};
      pEnt.effects.invuln = Math.max(pEnt.effects.invuln || 0, GT + val);
      floatPlayerEvent(floatSel, def.emoji + ' 無敵 ' + fmt1(val) + 's', 'defend');
      blog(def.emoji + ' 你施放潛力【' + def.name + '】：展開無敵結界 ' + fmt1(val) + ' 秒。', 'log-player-buff', 'combat');
      return { killed: false, dmg: 0 };
    case 'enemySlow':                // 時間結界
      var applied = 0;
      for (var a = 0; a < live.length; a++) { if (applyBuff(live[a], 'enemyAspdDown', val, dur)) applied++; }
      floatPlayerEvent(floatSel, def.emoji + ' 敵攻速-' + fmt1(val) + '%', 'special');
      blog(def.emoji + ' 你施放潛力【' + def.name + '】：' + applied + ' 名敵人攻速降低 ' + fmt1(val) + '%（' + dur + '秒）。', 'log-player-buff', 'combat');
      return { killed: false, dmg: 0 };
    case 'chainLightning':           // 雷霆過載
      applyBuff(pEnt, 'lightningOverload', val, dur);
      floatPlayerEvent(floatSel, def.emoji + ' 雷電+' + fmt1(val) + '%', 'attack');
      blog(def.emoji + ' 你施放潛力【' + def.name + '】：雷電技能觸發連鎖閃電，雷電傷害 +' + fmt1(val) + '%（' + dur + '秒）。', 'log-player-buff', 'combat');
      return { killed: false, dmg: 0 };
    case 'sacredInvert':             // 聖療逆轉
      applyBuff(pEnt, 'sacredInvert', val, dur);
      floatPlayerEvent(floatSel, def.emoji + ' 回復/溢傷+' + fmt1(val) + '%', 'heal');
      blog(def.emoji + ' 你施放潛力【' + def.name + '】：生命與法力回復、溢出傷害 +' + fmt1(val) + '%（' + dur + '秒）。', 'log-player-buff', 'combat');
      return { killed: false, dmg: 0 };
    case 'timeStop':                 // 時空凝滯
      applyBuff(pEnt, 'allDmgUp', val, dur);
      var frozen = 0;
      for (var b = 0; b < live.length; b++) { if (applyEffect(live[b], 'stun', dur)) frozen++; }
      floatPlayerEvent(floatSel, def.emoji + ' 全傷+' + fmt1(val) + '%', 'attack');
      blog(def.emoji + ' 你施放潛力【' + def.name + '】：' + frozen + ' 名敵人靜止 ' + dur + ' 秒，所有傷害 +' + fmt1(val) + '%。', 'log-player-buff', 'combat');
      return { killed: false, dmg: 0 };
    case 'omega':                    // 必殺一擊
      return firePotentialOmega(pEnt, def, live, floatSel, st, val);
  }
  return { killed: false, dmg: 0 };
}

// 必殺一擊：物理傷害 = 爆擊率% × 必殺傷害加成% × 物攻（單體，經 resolveHit 結算防禦）。
function firePotentialOmega(pEnt, def, live, floatSel, st, mult) {
  var target = live[0];
  if (!target || target.hp <= 0) return { killed: false, dmg: 0 };
  var atkVal = st.atk * (st.critRate / 100) * (mult / 100);
  var aCfg = {
    atk: atkVal, dmgType: 'phys', level: st.level,
    critRate: 0, critDmg: st.critDmg,
    hit: Math.max(100, st.hit), pen: st.pPen,
    annihilate: 0,
    eliteDmg: st.eliteDmg, bossDmg: st.bossDmg, normalDmg: st.normalDmg,
    totalDmgPct: (st.totalDmgPct || 0) + buffVal(pEnt, 'allDmgUp'),
    dmgVsElem: st.dmgVsElem, isPlayer: true
  };
  var res = resolveHit(pEnt, target, aCfg, monsterDefCfg(target));
  if (!res.miss) {
    floatEnemyEvent(target, floatSel, def.emoji + '必殺 ' + fmt(res.dmg), 'crit enemy-skill', res.dmg);
    trackDps(res.dmg);
    if (typeof recordRunDamage === 'function') recordRunDamage(def.name, res.dmg, 'potential:' + def.id, potentialLevel(def.id));
    blog(def.emoji + ' 你施放潛力【' + def.name + '】：必殺一擊造成 ' + fmt(res.dmg) + ' 物理傷害！', 'log-player-skill', 'combat');
  } else {
    floatEnemyEvent(target, floatSel, 'MISS', 'miss enemy-dodge');
  }
  return { killed: !!res.killed, dmg: res.dmg || 0 };
}

/* 雷霆過載連鎖：由 skills.js castSkill 在雷電系技能命中後呼叫。
   追加 (3＋連擊數) 次、各 chainPortion(10%) 該擊總傷害的連鎖，隨機分配給存活敵人。 */
function applyPotentialChainLightning(pEnt, fx, targets, totalDmg, comboReps, floatSel) {
  if (buffVal(pEnt, 'lightningOverload') <= 0) return { killed: false };
  var isLightning = (fx.elem && fx.elem.type === 'lightning') || (fx.elems && fx.elems.lightning);
  if (!isLightning || totalDmg <= 0) return { killed: false };
  var live = (targets || []).filter(function (m) { return m && m.hp > 0; });
  var out = { killed: false };
  var bounces = 3 + Math.max(0, comboReps || 0);
  var per = totalDmg * 0.10;
  for (var i = 0; i < bounces; i++) {
    live = live.filter(function (m) { return m && m.hp > 0; });
    if (!live.length) { if (!targets || !targets.length) break; live = [targets[0]]; if (live[0].hp <= 0) break; }
    var t = live[i % live.length];
    var d = Math.max(1, Math.round(per));
    t.hp -= d;
    floatEnemyEvent(t, floatSel, '⚡' + fmt(d), 'enemy-skill', d);
    trackDps(d);
    if (t.hp <= 0) { t.hp = 0; out.killed = true; }
  }
  return out;
}

/* 聖療逆轉溢出：由戰鬥迴圈於回復後呼叫。
   額外回復 = 基礎回復 × 值%；溢出的回復量 × 值% 對主要敵人造成真實傷害。回傳是否致死。 */
function tickPotentialRegen(pEnt, st, dt, enemies, floatSel) {
  var sacred = buffVal(pEnt, 'sacredInvert');
  if (sacred <= 0) return false;
  var ratio = sacred / 100;
  var baseHp = (st.hp * (BASE_HP_REGEN_PCT / 100) + (st.hpRegen || 0)) * dt;
  var extraHp = baseHp * ratio;
  var hpOverflow = Math.max(0, (pEnt.hp + extraHp) - st.hp);
  pEnt.hp = Math.min(st.hp, pEnt.hp + extraHp);
  var baseMp = (st.mpRegen || 0) * dt;
  var extraMp = baseMp * ratio;
  var mpOverflow = Math.max(0, (pEnt.mp + extraMp) - st.mp);
  pEnt.mp = Math.min(st.mp, pEnt.mp + extraMp);
  var overflowDmg = (hpOverflow + mpOverflow) * ratio;
  if (overflowDmg < 1) return false;
  var live = (enemies || []).filter(function (m) { return m && m.hp > 0; });
  if (!live.length) return false;
  var t = live[0];
  var d = Math.max(1, Math.round(overflowDmg));
  t.hp -= d;
  floatEnemyEvent(t, floatSel, '✨' + fmt(d), 'enemy-skill', d);
  trackDps(d);
  if (t.hp <= 0) { t.hp = 0; return true; }
  return false;
}
