'use strict';
/* ============ 潛力技能（戰鬥效果模組 V3）============
   主動潛力技能：與一般技能相同，需裝入「裝載欄」（鍵值 'potential:<id>'）才會施放；
                冷卻共用 pEnt.skillCds、施放共用 pickAndCastSkill（skills.js）與技能 GCD 節奏；普攻同步進行。
   被動潛力技能：混沌雙修（crossCore）於 computeStats 併入；
                不屈意志（免死）於 resolveHit 致命段處理。皆學會即常駐、無需裝備。
   數值 potentialSkillValue / 上限 potentialSkillMaxLv / 是否生效 potentialSkillActive → js/talents.js
   資料表 POTENTIAL_TALENTS → js/data.js（含 type/cd/base/per/dmgType/dur/mech）。

   ── 詮釋備註（天賦V3.xlsx 第 2 頁為設計草案，以下為實作取捨；細節見 game_formula.md）──
   ・極速之力：主動 buff——施放後 6 秒內攻速 +值% 且突破 5 次/秒上限
     （potentialVelocityFactor 於戰鬥迴圈放大攻擊頻率；2026-07-21 使用者補上持續時間定調）。
   ・時間坍縮：施放時對「一般技能」冷卻額外提供 CDR 並突破 60% 上限（總 CDR 於施放時夾 90%）；不影響潛力技能自身冷卻。
   ・混沌雙修：所有技能傷害段套用物↔魔互補加成（skills.js castSkill）。
   ・雷霆過載：電擊攻擊技能（2026-07-22 使用者定調，非純 buff）——本體造成 (atkBase＋atkPer×Lv)% 魔攻
     的魔法傷害（電屬性 100%、彈跳 bounces 次、與一般技能同規格結算；firePotentialLightning），
     且持續時間內每 1 秒自動再轟一輪（tickPotentialOverdrive，戰鬥迴圈掛勾）；
     同時期間雷電系技能「整體傷害」×(1＋值%)（castSkill 於 baseVal 乘算，本體自身也吃），
     雷電技能命中追加 (3＋連擊數) 次、各 10% 該擊最終傷害的連鎖；浮字 🌩️ 沿用爆擊樣式（黃字）。
   ・聖療逆轉：期間生命/法力回復額外 +值%，溢出的回復量 ×值% 對主要敵人造成真實傷害。
   ・時空凝滯：期間所有敵人靜止＋玩家所有直接傷害 +值%。時間靜止為最終大絕，
     直接寫入 stun 時戳「不可被免疫」（無視 BOSS 控場免疫與控場遞減）。 */

// 不屈意志內部冷卻（秒）＝ 90 − 值（下限 1）；不受冷卻縮減影響。
function potentialUndyingCd() {
  return Math.max(1, 90 - potentialSkillValue('lastStandUndying'));
}

// 潛力主動技能實際冷卻：吃一般冷卻縮減（夾 60%），不受時間坍縮的突破效果影響。
function potentialActiveCd(def) {
  var cdr = (typeof getStats === 'function') ? Math.min(60, getStats().cdr || 0) : 0;
  return Math.max(0.1, (def.cd || 0) * (1 - cdr / 100));
}

// 可施放（可裝入裝載欄）的潛力機制；被動 crossCore 與被動觸發 undyingGuard 不在此列。
var POTENTIAL_CASTABLE_MECHS = {
  aspd: 1, chainLightning: 1, cdrUncap: 1, invuln: 1, enemySlow: 1, omega: 1, sacredInvert: 1, timeStop: 1
};

/* 極速之力施放期間的攻速倍率：以「未夾上限的總攻速 ÷ 目前(夾 5 次/秒)攻速」放大攻擊頻率，
   等效於 6 秒內攻速 = ASPD_BASE × (1 + (玩家原始攻速% + 技能值%) / 100)，突破 5 次/秒上限。 */
function potentialVelocityFactor(pEnt, st) {
  var v = buffVal(pEnt, 'velocitySurge');
  if (v <= 0) return 1;
  var uncapped = ASPD_BASE * (1 + ((st.aspdBonusBase || 0) + v) / 100);
  return Math.max(1, uncapped / Math.max(0.0001, st.aspd || 1));
}

// 此潛力技能是否可裝入裝載欄（主動且有施放效果）。
function potentialEquippable(def) {
  return !!(def && def.type === 'active' && POTENTIAL_CASTABLE_MECHS[def.mech]);
}

/* 由 pickAndCastSkill（skills.js）呼叫：施放裝載欄中的潛力技能。
   冷卻寫入 pEnt.skillCds[loadoutKey]（與一般技能共用 tick 與就緒排序），
   並套用共用技能 GCD。回傳 { killed, dmg }（與 castSkill 相同介面）。 */
function castPotentialSkill(pEnt, target, def, floatSel, loadoutKey) {
  var st = getStats();
  var targets = Array.isArray(target)
    ? target.filter(function (e) { return e && e.hp > 0; })
    : (target && target.hp > 0 ? [target] : []);
  if (!pEnt.skillCds) pEnt.skillCds = {};
  pEnt.skillCds[loadoutKey || ('potential:' + def.id)] = potentialActiveCd(def);
  pEnt.skillGcd = SKILL_GLOBAL_COOLDOWN;
  /* 特效：潛力技不經 castSkill，於此自行送一則。有傷害段（dmgType）的走一般推導，
     純增益的走 selfBuff；顏色沿用潛力系的專屬色（VFX_CAT_COLORS.potential）。 */
  if (typeof emitSkillVfx === 'function' && typeof skillVfxSpec === 'function') {
    var pSk = { id: def.id, name: def.name, emoji: def.emoji, cat: 'potential', tags: def.tags || [] };
    var pFx = { dmgType: def.dmgType || null };
    emitSkillVfx(skillVfxSpec(pSk, pFx, null,
      targets.map(function (t) { return enemyEventFloatTarget(t, floatSel); }),
      null,
      targets.length && def.dmgType ? null : { targets: [playerEventFloatTarget(floatSel)] }));
  }
  var res = firePotentialActive(pEnt, def, targets, floatSel, st);
  // 45 新技能（echo 族）：dmgWindow「窗內玩家全部傷害」——潛力主動技傷害計入快照窗
  //（潛力施放不經 castSkill，於此統一寫入；typeof 守衛防載入順序問題）
  if (res && res.dmg > 0 && typeof skillRtAccWindowDamage === 'function') skillRtAccWindowDamage(res.dmg);
  UI.dirty.battle = true;
  return { killed: !!(res && res.killed), dmg: (res && res.dmg) || 0 };
}

// 執行潛力技能效果；回傳 { killed, dmg }。
function firePotentialActive(pEnt, def, live, floatSel, st) {
  var val = potentialSkillValue(def.id);
  var dur = def.dur || 0;
  switch (def.mech) {
    case 'aspd':                     // 極速之力：6 秒內攻速+值% 且突破 5 次/秒上限
      applyBuff(pEnt, 'velocitySurge', val, dur);
      floatPlayerEvent(floatSel, def.emoji + ' 攻速+' + fmt1(val) + '%', 'attack');
      blog(def.emoji + ' 你施放潛力【' + def.name + '】：' + dur + ' 秒內突破攻速極限，攻速加成 +' + fmt1(val) + '%！', 'log-player-buff', 'combat');
      return { killed: false, dmg: 0 };
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
    case 'chainLightning': {         // 雷霆過載：本體雷擊＋雷電傷害增益（先上增益，本體同樣吃到）
      applyBuff(pEnt, 'lightningOverload', val, dur);
      var strike = firePotentialLightning(pEnt, def, live, floatSel, st, val);
      pEnt.overdriveNext = GT + 1; // 持續轟擊：往後每 1 秒再轟一輪（tickPotentialOverdrive，增益結束即停）
      floatPlayerEvent(floatSel, def.emoji + ' 雷電+' + fmt1(val) + '%', 'attack');
      blog(def.emoji + ' 你施放潛力【' + def.name + '】：萬雷轟落，造成 ' + fmt(strike.dmg) + ' 電屬性魔法傷害；' +
        dur + ' 秒內每秒持續轟擊，雷電傷害 +' + fmt1(val) + '%，雷電技能命中將引動連鎖雷鏈。', 'log-player-skill', 'combat');
      return strike;
    }
    case 'sacredInvert':             // 聖療逆轉
      applyBuff(pEnt, 'sacredInvert', val, dur);
      floatPlayerEvent(floatSel, def.emoji + ' 回復/溢傷+' + fmt1(val) + '%', 'heal');
      blog(def.emoji + ' 你施放潛力【' + def.name + '】：生命與法力回復、溢出傷害 +' + fmt1(val) + '%（' + dur + '秒）。', 'log-player-buff', 'combat');
      return { killed: false, dmg: 0 };
    case 'timeStop':                 // 時空凝滯：最終大絕——時間靜止「不可被免疫」
      applyBuff(pEnt, 'allDmgUp', val, dur);
      var frozen = 0;
      for (var b = 0; b < live.length; b++) {
        // 直接寫入 stun 時戳，繞過 applyEffect 的 BOSS 控場免疫與控場遞減：
        // 時空凝滯為時間靜止大絕，設計上任何敵人（含 BOSS）皆無法免疫、每次都是完整持續時間。
        var frozenEnt = live[b];
        frozenEnt.effects = frozenEnt.effects || {};
        frozenEnt.effects.stun = Math.max(frozenEnt.effects.stun || 0, GT + dur);
        frozen++;
      }
      floatPlayerEvent(floatSel, def.emoji + ' 全傷+' + fmt1(val) + '%', 'attack');
      blog(def.emoji + ' 你施放潛力【' + def.name + '】：時空靜止！' + frozen + ' 名敵人動彈不得 ' + dur + ' 秒（無視控制免疫），所有傷害 +' + fmt1(val) + '%。', 'log-player-buff', 'combat');
      return { killed: false, dmg: 0 };
    case 'omega':                    // 必殺一擊
      return firePotentialOmega(pEnt, def, live, floatSel, st, val);
  }
  return { killed: false, dmg: 0 };
}

/* 雷霆過載本體雷擊：造成 (atkBase＋atkPer×Lv)% 魔攻的電屬性傷害（技能屬性化，整段皆為電屬性），
   於存活敵人間彈跳 bounces 次、每跳皆為完整傷害段（比照多段技能）。
   結算與一般技能同規格：爆擊/破甲/真傷/裝備固定元素攻擊/敵種/屬性/全傷全部生效；
   本體即雷電系——施放時掛上的雷電傷害增益（boostVal）對自身同樣乘算。 */
function firePotentialLightning(pEnt, def, live, floatSel, st, boostVal) {
  var lv = potentialLevel(def.id);
  var pct = ((def.atkBase || 0) + (def.atkPer || 0) * lv) / 100;
  var atkStat = st.matk || 0;
  if ((st.crossCore || 0) > 0) atkStat += (st.atk || 0) * st.crossCore / 100; // 混沌雙修：魔法技能承載物攻
  var baseVal = atkStat * pct;
  if (boostVal > 0) baseVal *= 1 + boostVal / 100;
  var bounces = def.bounces || 5;
  var out = { killed: false, dmg: 0 };
  // 由近而遠連鎖：第一跳打最近的敵人，之後每跳跳到離上一個目標最近的鄰居 → js/battlefield.js
  var chainOrder = (typeof bfChainOrder === 'function')
    ? bfChainOrder(pEnt && pEnt._lockTarget, live, bounces) : [];
  for (var i = 0; i < bounces; i++) {
    live = live.filter(function (m) { return m && m.hp > 0; });
    if (!live.length) break;
    var t = chainOrder[i] || live[i % live.length];
    if (!t || t.hp <= 0) continue;
    // 技能屬性化：本體傷害段整段即為電屬性傷害（skillElem，與一般技能同規格）
    var elemAtk = null;
    if (st.elemAtk) {
      for (var ea in st.elemAtk) {
        if (!st.elemAtk[ea]) continue;
        if (!elemAtk) elemAtk = {};
        var eaVal = st.elemAtk[ea];
        if (ea === 'lightning' && boostVal > 0) eaVal *= 1 + boostVal / 100; // 裝備固定雷電附傷同步乘算
        elemAtk[ea] = eaVal;
      }
    }
    var aCfg = {
      atk: baseVal, dmgType: 'magic', skillElem: 'lightning', level: st.level,
      critRate: st.critRate, critDmg: st.critDmg,
      hit: Math.max(100, st.hit), pen: st.mPen,
      sunder: (st.passives && st.passives.sunder) || 0,
      trueDmgPct: (st.passives && st.passives.trueDmg) || 0,
      annihilate: (st.passives && st.passives.annihilate) || 0,
      elemAtk: elemAtk, elemDmgPct: st.elemDmgPct, elemDmgUp: st.elemDmgUp,
      eliteDmg: st.eliteDmg, bossDmg: st.bossDmg, normalDmg: st.normalDmg,
      totalDmgPct: (st.totalDmgPct || 0) + buffVal(pEnt, 'allDmgUp'),
      dmgVsElem: st.dmgVsElem, isPlayer: true
    };
    var res = resolveHit(pEnt, t, aCfg, monsterDefCfg(t));
    if (!res.miss) {
      floatEnemyEvent(t, floatSel, def.emoji + (res.crit ? '爆擊 ' : '') + fmt(res.dmg), (res.crit ? 'crit ' : 'dmg ') + 'enemy-skill', res.dmg);
      trackDps(res.dmg);
      if (typeof recordRunDamage === 'function') recordRunDamage(def.name, res.dmg, 'potential:' + def.id, lv);
      out.dmg += res.dmg;
      if (res.killed) out.killed = true;
    } else {
      floatEnemyEvent(t, floatSel, 'MISS', 'miss enemy-dodge');
    }
  }
  return out;
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
   追加 (3＋連擊數) 次、各 chainPortion(10%) 該擊總傷害的連鎖：
   第一跳打主目標，之後每跳跳到離上一個目標最近的鄰居（→ js/battlefield.js bfChainOrder）。
   sourceCrit＝本擊是否爆擊：連鎖傷害本就內含爆擊倍率，浮字樣式沿用一般技能爆擊（黃字）。
   skDef＝技能定義（可選末參）：§3.5 系別判定統一走 skillElemOf（帶 lightning 標籤即算雷電系）。 */
function applyPotentialChainLightning(pEnt, fx, targets, totalDmg, comboReps, floatSel, sourceCrit, skDef) {
  if (buffVal(pEnt, 'lightningOverload') <= 0) return { killed: false };
  var isLightning = (typeof skillElemOf === 'function')
    ? (skillElemOf(skDef, fx) === 'lightning' || (fx.elems && fx.elems.lightning))
    : !!(fx.elems && fx.elems.lightning);
  if (!isLightning || totalDmg <= 0) return { killed: false };
  var out = { killed: false, dmg: 0 };
  var bounces = 3 + Math.max(0, comboReps || 0);
  var per = totalDmg * 0.10;
  var floatCls = (sourceCrit ? 'crit ' : 'dmg ') + 'enemy-skill'; // 與一般技能浮字同規則
  // 前綴用 🌩️（雷霆過載 emoji）：與「⚡天罰（神鑄特效，吃物攻）」及連鎖閃電技能本體的 ⚡ 區隔，避免誤判傷害來源
  var floatPrefix = '🌩️' + (sourceCrit ? '爆擊 ' : '');
  /* 彈跳對象取自整個戰場而不是技能自己的 targets：技能改成單體之後，
     沿用 targets 會讓所有彈跳都落在同一隻身上。第一跳打主目標，之後由近而遠往鄰居擴散。 */
  var field = (typeof skillRtActiveEnemies === 'function')
    ? skillRtActiveEnemies(targets) : (targets || []).filter(function (m) { return m && m.hp > 0; });
  var first = (targets || []).filter(function (m) { return m && m.hp > 0; })[0] || null;
  var chain = (typeof bfChainOrder === 'function') ? bfChainOrder(first, field, bounces) : [];
  for (var i = 0; i < bounces; i++) {
    var t = chain[i] || field[i % Math.max(1, field.length)];
    if (!t || t.hp <= 0) continue;
    var d = Math.max(1, Math.round(per));
    t.hp -= d;
    out.dmg += d;
    floatEnemyEvent(t, floatSel, floatPrefix + fmt(d), floatCls, d);
    trackDps(d);
    if (typeof recordRunDamage === 'function') recordRunDamage('雷霆過載·連鎖', d); // 列入傷害統計，可與天罰分辨
    if (t.hp <= 0) { t.hp = 0; out.killed = true; }
  }
  // 45 新技能（echo 族）：連鎖閃電傷害計入 dmgWindow 快照窗——直接於此寫入而不折入
  // castSkill 的 out.dmg（避免污染 recentBest 重播快照與 proc 擲骰基準）
  if (out.dmg > 0 && typeof skillRtAccWindowDamage === 'function') skillRtAccWindowDamage(out.dmg);
  return out;
}

/* 雷霆過載持續轟擊：施放後於增益持續時間內，每 1 秒自動再轟一輪本體雷擊（完整彈跳）。
   由戰鬥迴圈呼叫（與聖療逆轉同位置、不受暈眩影響）；增益結束即停。
   回傳 null（本次未轟）或 { killed, dmg }。 */
function tickPotentialOverdrive(pEnt, enemies, floatSel) {
  var boost = buffVal(pEnt, 'lightningOverload');
  if (boost <= 0 || !pEnt.overdriveNext || GT < pEnt.overdriveNext) return null;
  var def = (typeof potentialDef === 'function') ? potentialDef('lightningOverdrive') : null;
  if (!def) return null;
  var live = (enemies || []).filter(function (m) { return m && m.hp > 0; });
  if (!live.length) return null;
  pEnt.overdriveNext = GT + 1;
  var r = firePotentialLightning(pEnt, def, live, floatSel, getStats(), boost);
  // 45 新技能（echo 族）：持續轟擊傷害計入 dmgWindow 快照窗（不經 castPotentialSkill，於此補寫）
  if (r && r.dmg > 0 && typeof skillRtAccWindowDamage === 'function') skillRtAccWindowDamage(r.dmg);
  return r;
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
  floatEnemyEvent(t, floatSel, '✨' + fmt(d), 'dmg enemy-skill', d);
  trackDps(d);
  // 45 新技能（echo 族）：聖療逆轉溢出真傷計入 dmgWindow 快照窗
  if (typeof skillRtAccWindowDamage === 'function') skillRtAccWindowDamage(d);
  if (t.hp <= 0) { t.hp = 0; return true; }
  return false;
}
