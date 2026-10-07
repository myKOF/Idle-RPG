'use strict';
/* ============================================================
   elite.js — 菁英詞條（技能）引擎（只在 Worker 載入，同 legendary.js）
   ------------------------------------------------------------
   資料表在 js/elite_data.js（ELITE_AFFIXES）；群組與機率參數在 js/data.js（ELITE_GROUP）；
   擲骰函式在 js/formula.js（planEliteWave 一族）；出怪在 js/combat.js（spawnEliteWave）。
   這一支負責三件事：
     1. 給菁英配詞條（eliteRollAffixes／eliteEquip）
     2. 每個 tick 驅動詞條（eliteTick）：冷卻、施放、場域、預警、延遲事件
     3. 掛在傷害管線上的被動反應（eliteIncomingDamage／eliteOnDamaged／eliteOnAttackHit／eliteOnDeath）

   視覺原則（使用者要求「看得出他放了什麼技能」）：
     - 每次施放：頭上浮出「圖示＋技能名」、戰鬥日誌一行、自身一道施法光
     - 凡是會傷到你的範圍技能一律先在地上畫預警（mark-red／mark-blue／各色魔法陣），倒數完才結算
     - 預警與結算用 preset 事件送顯示層；顯示層只畫，傷害判定都在這裡（AI_RULES 8.3：兩者共用同一組半徑與座標）
   所有可調數字都在 ELITE_AFFIXES 與 ELITE_GROUP；這裡不寫配置值。
   ============================================================ */

var ELITE_PLAYER_BODY_R = 18;     // 判定時把玩家當成半徑這麼大的圓（身體邊緣先碰到範圍就算中）
var ELITE_VIS_REFRESH_SEC = 0.3;  // 場域特效的續命間隔（顯示層以 area.id 合併，超過約半秒沒續命就收掉）
var ELITE_CASTS_PER_TICK = 3;     // 同一個 tick 最多開幾個新技能，避免整群同時開火

var ELITE_RT = {
  jobs: [],      // 延遲事件 { at, fn }
  vis: [],       // 地面特效（預警與場域共用）{ id, preset, x, y, r|w,h,a, until, next }
  zones: [],     // 傷害場域
  budget: 0,
  errors: 0
};

/* 全部清掉：玩家死亡、換圖、演武場關閉時呼叫，避免死前排好的預警在復活後還炸人。 */
function eliteReset() {
  ELITE_RT.jobs.length = 0;
  ELITE_RT.vis.length = 0;
  ELITE_RT.zones.length = 0;
}

/* ---------------- 小工具 ---------------- */
function eliteG(key, fallback) {
  var g = (typeof ELITE_GROUP !== 'undefined') ? ELITE_GROUP : null;
  var v = g ? Number(g[key]) : NaN;
  return isFinite(v) ? v : fallback;
}
function eliteDmgScale() { return Math.max(0, eliteG('skillDmgPct', 100)) / 100; }
function eliteCdScale() { return Math.max(0.1, eliteG('cdPct', 100) / 100); }
function eliteHas(m, id) { return !!(m && m.affixes && m.affixes.indexOf(id) >= 0); }
function eliteDef(id) { return (typeof ELITE_AFFIXES !== 'undefined') ? ELITE_AFFIXES[id] : null; }
function elitePlayer() { return (typeof FIELD !== 'undefined' && FIELD) ? FIELD.player : null; }
function elitePos() { return (typeof bfPlayerPos === 'function') ? bfPlayerPos() : { x: 0, y: 0 }; }
function eliteDist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
function eliteMonsterPos(m) { return (m && m.pos && isFinite(m.pos.x) && isFinite(m.pos.y)) ? m.pos : null; }
function elitePlayerAlive() {
  var p = elitePlayer();
  return !!(p && p.hp > 0 && !(FIELD.reviveCd > 0) && !p._sgRevival);
}
function eliteLater(sec, fn) { ELITE_RT.jobs.push({ at: GT + Math.max(0, sec), fn: fn }); }
function eliteGuard(label, fn) {
  try { return fn(); } catch (e) {
    /* 一個詞條壞掉不能把整個戰鬥迴圈拖下水；每種錯誤只報前幾次，不洗版。 */
    if (ELITE_RT.errors++ < 5 && typeof console !== 'undefined') console.error('[elite] ' + label, e);
    return undefined;
  }
}

/* ---------------- 特效派送 ---------------- */
function eliteFx(spec) {
  if (typeof playCombatVfx !== 'function') return;
  spec.cat = 'enemy';
  spec.presetOnly = true;     // 只有 Preset 端畫得出來；沒接上 Runtime 的顯示層整則忽略，不退回泛用爆點
  if (!spec.color) spec.color = '#ffffff';
  playCombatVfx(spec);
}
/* 爆發（一次性）：以 (x,y) 為圓心、半徑 r。 */
function eliteBurstFx(x, y, r, preset, delaySec, elem) {
  if (!preset) return;
  eliteFx({
    fxKind: 'burst', variant: 'elite-burst', elem: elem || null, count: 1, dur: 0.6, hit: false,
    delayMs: delaySec > 0 ? Math.round(delaySec * 1000) : 0,
    area: { x: x, y: y, r: r }, vfx: { attack: preset }
  });
}
/* 在某個實體身上放一次命中型特效（hit 角色）。 */
function eliteHitFx(targetId, preset, delaySec) {
  if (!preset || !targetId) return;
  eliteFx({
    fxKind: 'impact', variant: 'elite-hit', count: 1, dur: 0.4,
    delayMs: delaySec > 0 ? Math.round(delaySec * 1000) : 0,
    targets: [targetId], vfx: { hit: preset }
  });
}
function eliteSelfPulse(m, preset) {
  if (m && m.floatSel) eliteHitFx(m.floatSel, preset || 'cast-buff-dark');
}
/* 地面特效（預警圈、毒雲、火牆…）：登記進 vis 清單，之後每 0.3 秒自動續命直到 until。 */
function eliteVisAdd(v) {
  v.next = 0;
  ELITE_RT.vis.push(v);
  eliteVisEmit(v);
  return v;
}
function eliteVisEmit(v) {
  v.next = GT + ELITE_VIS_REFRESH_SEC;
  var area = { id: v.id, x: v.x, y: v.y };
  if (v.w > 0 && v.h > 0) { area.w = v.w; area.h = v.h; area.a = v.a || 0; }
  else area.r = v.r;
  if (v.curtain) {
    /* 雷牆：顯示層對 variant 'thunder-curtain' 會沿牆面排一列落雷柱（attack 角色），不是平貼地面的 Preset。 */
    eliteFx({
      fxKind: 'aura', variant: 'thunder-curtain', elem: 'lightning', count: 1, dur: 0.2,
      area: area, vfx: { attack: v.preset }
    });
    return;
  }
  eliteFx({
    fxKind: 'aura', variant: 'elite-ground', count: 1, dur: 0.2,
    area: area, vfx: { ground: v.preset }
  });
}
var ELITE_VIS_SEQ = 0;
function eliteVisId(tag) { return 'elite-' + (tag || 'g') + '-' + (ELITE_VIS_SEQ++); }
/* 預警圈：只在 seconds 秒內存在。 */
function eliteWarn(x, y, r, preset, seconds, tag) {
  if (!(seconds > 0) || !preset) return null;
  return eliteVisAdd({ id: eliteVisId(tag || 'warn'), preset: preset, x: x, y: y, r: r, until: GT + seconds });
}
function eliteVisTick() {
  var keep = [];
  for (var i = 0; i < ELITE_RT.vis.length; i++) {
    var v = ELITE_RT.vis[i];
    if (GT >= v.until) continue;
    if (GT >= v.next) eliteVisEmit(v);
    keep.push(v);
  }
  ELITE_RT.vis = keep;
}

/* ---------------- 傷害與狀態（打在玩家身上） ---------------- */
/* o：{ mult, elem, sure, phys, dot:{id,name,pct,dur}, stun, slow, atkDown, defDown, dur, label, quiet, push, from:{x,y} }
   走 resolveHit：玩家的減傷、抗性、格擋、護盾與反震都照常生效；元素技能整段改算該屬性（吃對應抗性）。
   sure＝範圍技能：已經讓你看過預警了，不再靠命中率逃避。 */
function eliteHitPlayer(m, o) {
  var p = elitePlayer();
  if (!m || !p || p.hp <= 0 || FIELD.reviveCd > 0) return null;
  var cfg = monsterAtkCfg(m, (o.mult || 1) * eliteDmgScale());
  if (o.elem) { cfg.dmgType = 'magic'; cfg.skillElem = o.elem; }
  else if (o.phys) cfg.dmgType = 'phys';
  if (o.sure) cfg.hit = 100000;
  var dCfg = playerDefCfg(p);
  var res = resolveHit(m, p, cfg, dCfg);
  var pf = 'pv-float';
  if (res.invuln) { floatPlayerEvent(pf, '無敵!', 'defend'); return res; }
  if (res.miss) { floatPlayerEvent(pf, '閃避!', 'dodge defend'); return res; }
  var text = '-' + fmt(res.dmg);
  if (res.crit) text = '爆擊 ' + text;
  floatText(pf, text, res.crit ? 'crit' : 'mdmg');
  if (res.blocked) floatPlayerEvent(pf, '格擋!', 'defend');
  var hpDamage = Math.max(0, res.dmg - (res.absorbed || 0));
  settleEnemyAttackRetaliation({
    attacker: m, target: p, floatSel: pf, result: res, hpDamage: hpDamage,
    blocked: !!res.blocked, defCfg: dCfg, thornsApplied: true
  });
  eliteApplyStatus(p, dCfg, res, o);
  if (!o.quiet && typeof blog === 'function') {
    blog('🛡️ ' + (m.name || '菁英') + ' 的【' + (o.label || '技能') + '】造成 ' + fmt(res.dmg) + ' 傷害。',
      'log-enemy-skill', 'combat');
  }
  return res;
}
function eliteApplyStatus(p, dCfg, res, o) {
  var pf = 'pv-float';
  var ccf = (dCfg.ccFactor === undefined) ? 1 : dCfg.ccFactor;
  if (o.stun > 0 && !resistCtrl(dCfg)) {
    var sd = applyEffect(p, 'stun', o.stun * ccf);
    if (sd) floatPlayerEvent(pf, '眩暈!', 'debuff');
  }
  if (o.slow > 0 && !resistCtrl(dCfg)) {
    var sl = applyEffect(p, 'slow', o.slow * ccf);
    if (sl) floatPlayerEvent(pf, '減速!', 'debuff');
  }
  if (o.dot && o.dot.dur > 0 && res.dmg > 0) {
    var dps = Math.max(1, res.dmg * o.dot.pct / 100 / o.dot.dur);
    applyDot(p, dps, o.dot.dur, o.dot.name, o.dot.id);
    floatPlayerEvent(pf, o.dot.name + '!', 'debuff');
  }
  if (o.atkDown > 0) applyBuff(p, 'atkDown', o.atkDown, o.dur || 6, 'atkDown');
  if (o.defDown > 0) applyBuff(p, 'defDown', o.defDown, o.dur || 6, 'defDown');
  if (o.push > 0 && o.from) elitePushPlayer(o.from.x, o.from.y, o.push);
}
/* 把玩家從 (fx,fy) 往外推 dist（座標單位）。位置由模擬層 bfPlayerPos() 就地改寫。 */
function elitePushPlayer(fx, fy, dist) {
  var pp = elitePos();
  var dx = pp.x - fx, dy = pp.y - fy;
  var d = Math.sqrt(dx * dx + dy * dy) || 1;
  pp.x += dx / d * dist;
  pp.y += dy / d * dist;
}
function elitePullPlayer(tx, ty, step) {
  var pp = elitePos();
  var dx = tx - pp.x, dy = ty - pp.y;
  var d = Math.sqrt(dx * dx + dy * dy);
  if (d <= 1) return;
  var s = Math.min(d, step);
  pp.x += dx / d * s;
  pp.y += dy / d * s;
}
function eliteInCircle(x, y, r) {
  var pp = elitePos();
  return eliteDist(pp.x, pp.y, x, y) <= r + ELITE_PLAYER_BODY_R;
}
function eliteInRect(cx, cy, w, h, a) {
  var pp = elitePos();
  var dx = pp.x - cx, dy = pp.y - cy;
  var c = Math.cos(a), s = Math.sin(a);
  var lx = dx * c + dy * s, ly = -dx * s + dy * c;
  return Math.abs(lx) <= w / 2 + ELITE_PLAYER_BODY_R && Math.abs(ly) <= h / 2 + ELITE_PLAYER_BODY_R;
}
function eliteSegmentDist(ax, ay, bx, by, px, py) {
  var dx = bx - ax, dy = by - ay;
  var l2 = dx * dx + dy * dy;
  var t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return eliteDist(px, py, ax + dx * t, ay + dy * t);
}

/* ---------------- 配詞條 ---------------- */
/* 依關卡與權重抽 count 個詞條；同一個 grp 只取一個，minStage 沒到的不出現。 */
function eliteRollAffixes(stage, count) {
  if (typeof ELITE_AFFIXES === 'undefined') return [];
  var pool = [];
  ELITE_AFFIX_ORDER.forEach(function (id) {
    var d = ELITE_AFFIXES[id];
    if (d.minStage && stage < d.minStage) return;
    pool.push([id, d.w > 0 ? d.w : 10]);
  });
  var picked = [], used = {};
  while (picked.length < count && pool.length) {
    var id = wpick(pool);
    pool = pool.filter(function (e) { return e[0] !== id; });
    var d = ELITE_AFFIXES[id];
    if (d.grp && used[d.grp]) continue;
    if (d.grp) used[d.grp] = true;
    picked.push(id);
  }
  return picked;
}
/* 把詞條裝到敵人身上：被動數值立即生效，主動技能排上第一次施放。 */
function eliteEquip(m, ids) {
  m.affixes = ids.slice();
  var firstMax = Math.max(0.5, eliteG('firstCastMax', 3.5));
  var rt = { cd: {}, busyUntil: 0, summoned: 0, rageMult: 1, sacMult: 1, atkUntil: 0, invulnUntil: 0, reflectUntil: 0, lastImmuneAt: -9 };
  m._el = rt;
  m._fx = [];
  ids.forEach(function (id) {
    var d = eliteDef(id);
    if (!d) return;
    if (d.kind === 'active') rt.cd[id] = Math.max(0.8, rnd(0.6, firstMax));
    if (d.arch === 'regen') rt.cd[id] = d.cd[0];
    if (d.arch === 'zone' && d.trail) rt.cd[id] = rnd(d.cd[0], d.cd[1]) * 0.5;   // 足跡：先走一小段才開始留
    if (d.arch === 'haste') {
      m.aspd = (Number(m.aspd) || 1) * d.aspd;
      m.runSpeed = ((Number(m.runSpeed) > 0) ? Number(m.runSpeed) : (typeof bfEnemySpeed === 'function' ? bfEnemySpeed() : 210)) * d.run;
    }
    if (d.arch === 'giant') {
      m.maxHp *= d.hp; m.hp = m.maxHp;
      m._visScale = d.scale;
    }
  });
  /* 顯示用的主色：第一個詞條的顏色（光環、預警都用它）。 */
  var first = eliteDef(ids[0]);
  if (first) m._elColor = first.color;
  return m;
}

/* ---------------- 群組站位：同一群擠在一起進場 ---------------- */
function eliteClusterGroups(placed) {
  var byGid = {};
  (placed || []).forEach(function (e) {
    if (!e || e._gid === undefined || !e.pos) return;
    (byGid[e._gid] || (byGid[e._gid] = [])).push(e);
  });
  Object.keys(byGid).forEach(function (gid) {
    var list = byGid[gid];
    if (list.length < 2) return;
    var anchor = list[0].pos;
    var radius = 58;
    var start = Math.random() * Math.PI * 2;
    for (var i = 1; i < list.length; i++) {
      var ang = start + (i - 1) / (list.length - 1) * Math.PI * 2;
      var rr = radius * (0.85 + Math.random() * 0.3);
      list[i].pos = { x: anchor.x + Math.cos(ang) * rr, y: anchor.y + Math.sin(ang) * rr };
    }
  });
}
function eliteGroupMembers(m, aliveOnly) {
  if (!m || m._gid === undefined) return m ? [m] : [];
  var out = [];
  var list = (typeof fieldEnemyList === 'function') ? fieldEnemyList() : [];
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (!e || e._gid !== m._gid) continue;
    if (aliveOnly && !(e.hp > 0)) continue;
    out.push(e);
  }
  return out;
}

/* ---------------- 主迴圈 ---------------- */
/* 回傳 true＝玩家在這個 tick 被打死，呼叫端（fieldTick）要結束本輪。 */
function eliteTick(dt) {
  if (typeof FIELD === 'undefined' || !FIELD.player) return false;
  ELITE_RT.budget = ELITE_CASTS_PER_TICK;
  var list = (typeof fieldEnemyList === 'function') ? fieldEnemyList() : [];
  /* 先處理延遲事件與場域，再讓各隻菁英決定下一步。 */
  var jobs = ELITE_RT.jobs;
  ELITE_RT.jobs = [];
  for (var j = 0; j < jobs.length; j++) {
    if (jobs[j].at <= GT) eliteGuard('job', jobs[j].fn);
    else ELITE_RT.jobs.push(jobs[j]);
  }
  eliteGuard('zones', function () { eliteZonesTick(dt); });
  eliteVisTick();
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    if (!m || !m.affixes || !(m.hp > 0)) continue;
    eliteGuard('affix', function () { eliteTickOne(m, dt); });
  }
  /* 生命鏈結分攤、反震等可能在傷害管線裡把別隻打到 0 血，這裡統一補結算。 */
  if (typeof onFieldDeaths === 'function') {
    var pending = false;
    for (var k = 0; k < list.length; k++) if (list[k] && list[k].hp <= 0 && !list[k]._rewarded) { pending = true; break; }
    if (pending) onFieldDeaths();
  }
  var p = elitePlayer();
  if (p && p.hp <= 0 && !(FIELD.reviveCd > 0)) { onPlayerFieldDeath(); return true; }
  return false;
}

function eliteTickOne(m, dt) {
  var rt = m._el;
  if (!rt) return;
  var fx = [];
  if (m.shield > 0.5) fx.push('shield');
  if (rt.invulnUntil > GT) fx.push('invuln');
  if (rt.reflectUntil > GT) fx.push('reflect');
  if (rt.enraged) fx.push('enrage');
  if (rt.atkUntil > GT) fx.push('rage');
  if (fx.join() !== (m._fx || []).join()) m._fx = fx;
  if (rt.atkUntil && rt.atkUntil <= GT) { rt.sacMult = 1; rt.atkUntil = 0; }
  if (!fieldCombatReady(m)) return;
  var acting = !ccActionLocked(m);
  for (var i = 0; i < m.affixes.length; i++) {
    var id = m.affixes[i];
    var d = eliteDef(id);
    if (!d) continue;
    if (d.arch === 'regen') { eliteRegenTick(m, d, rt, dt, id); continue; }
    if (d.arch === 'zone' && d.trail) { if (acting) eliteTrailTick(m, d, rt, dt, id); continue; }
    if (d.kind !== 'active') continue;
    rt.cd[id] = (rt.cd[id] || 0) - dt;
    if (rt.cd[id] > 0 || !acting) continue;
    if (rt.busyUntil > GT || ELITE_RT.budget <= 0 || !elitePlayerAlive()) continue;
    if (!eliteCanCast(m, d)) { rt.cd[id] = 0.6; continue; }
    ELITE_RT.budget--;
    rt.cd[id] = rnd(d.cd[0], d.cd[1]) * eliteCdScale();
    eliteCast(m, d, id);
  }
}

/* 施放前提：有些技能要有同伴或有空間才有意義。 */
function eliteCanCast(m, d) {
  switch (d.arch) {
    case 'bloodsac': return eliteGroupMembers(m, true).some(function (e) { return e !== m && !e.elite && e.hp > 0; });
    case 'summon':
      if ((m._el.summoned || 0) >= Math.max(0, Math.floor(eliteG('summonCap', 6)))) return false;
      return typeof bfFreeCellCount !== 'function' || bfFreeCellCount(liveFieldEnemies()) > 2;
    case 'heal': return eliteGroupMembers(m, true).some(function (e) { return e.hp < e.maxHp * 0.95; });
    case 'shield': return !(m.shield > m.maxHp * 0.05);
    case 'reflect': return !(m._el.reflectUntil > GT);
    case 'invuln': return eliteGroupMembers(m, true).length >= 2;
    case 'zone': return ELITE_RT.zones.length < Math.max(1, Math.floor(eliteG('maxZones', 24)));
    default: return true;
  }
}

function eliteAnnounce(m, d) {
  floatEnemyEvent(m, 'mv-float', d.emoji + d.name, 'elite-cast');
  if (typeof blog === 'function') blog('⚠️ ' + (m.name || '菁英') + ' 施放【' + d.emoji + d.name + '】', 'log-enemy-skill', 'combat');
  eliteSelfPulse(m);
}
/* 施法期間牠站著不動也不普攻（讓預警與動作對得起來）。 */
function eliteBusy(m, sec, lockMove) {
  var rt = m._el;
  rt.busyUntil = GT + sec;
  if (lockMove) m._elLockUntil = GT + sec;
}

/* 行為原型 → 施放函式。主動詞條的 arch 必須在這裡有對應；常駐／被動的 arch 列在 ELITE_PASSIVE_ARCHS。
   新增原型時兩邊擇一登記，tests/elite-data.test.cjs 會逐一核對每個詞條都接得上。 */
var ELITE_CASTERS = {
  spots: eliteCastSpots, spot: eliteCastSpot, zone: eliteCastZone, volley: eliteCastVolley, beam: eliteCastBeam,
  bolt: eliteCastBolt, dash: eliteCastDash, blink: eliteCastBlink, spin: eliteCastSpin, vortex: eliteCastVortex,
  shield: eliteCastShield, reflect: eliteCastReflect, invuln: eliteCastInvuln, heal: eliteCastHeal,
  summon: eliteCastSummon, bloodsac: eliteCastBloodsac, curse: eliteCastCurse, drain: eliteCastDrain
};
var ELITE_PASSIVE_ARCHS = ['regen', 'zone', 'haste', 'giant', 'enrage', 'vampiric', 'thorns', 'knockback',
  'lifelink', 'phoenix', 'bomber', 'splitter'];

function eliteCast(m, d, id) {
  var fn = ELITE_CASTERS[d.arch];
  if (!fn) return;
  eliteAnnounce(m, d);
  fn(m, d);
}

/* ============ 範圍落點：隕石雨、雷霆風暴 ============ */
function eliteCastSpots(m, d) {
  var pp = elitePos();
  var total = d.warn + (d.n - 1) * d.step;
  eliteBusy(m, Math.min(total, 2.2), false);
  for (var i = 0; i < d.n; i++) {
    var ang = Math.random() * Math.PI * 2;
    var dist = (i === 0) ? 0 : Math.sqrt(Math.random()) * d.spread;   // 第一發直接落在你腳下，逼你移動
    var x = pp.x + Math.cos(ang) * dist, y = pp.y + Math.sin(ang) * dist;
    var warn = d.warn + i * d.step;
    eliteWarn(x, y, d.r, d.warnPreset, warn, 'spot');
    if (d.fall) {
      var travel = Math.min(0.75, warn);
      eliteFx({
        fxKind: 'rain', variant: 'elite-rain', elem: d.elem || null, count: 1, dur: travel, hit: false,
        delayMs: Math.round(Math.max(0, warn - travel) * 1000), travelMs: [Math.round(travel * 1000)],
        lineWidth: d.bodyD, area: { x: x, y: y, fixedLanding: true }, vfx: { projectile: d.fall }
      });
    }
    if (d.bolt) {
      eliteFx({
        fxKind: 'rain', variant: 'elite-bolt', elem: d.elem || null, count: 1, dur: 0.5, hit: false,
        delayMs: Math.round(warn * 1000), area: { x: x, y: y, r: d.r }, vfx: { attack: d.bolt }
      });
    }
    (function (px, py) {
      eliteLater(warn, function () { eliteSpotImpact(m, d, px, py, d.r, d.dmg); });
    })(x, y);
  }
}
function eliteSpotImpact(m, d, x, y, r, dmgMult) {
  eliteBurstFx(x, y, r * (d.burstScale || 1.15), d.burst, 0, d.elem);
  if (d.burst2) eliteBurstFx(x, y, r * (d.burstScale || 1.15), d.burst2, 0.08, d.elem);
  if (!eliteInCircle(x, y, r)) return;
  var res = eliteHitPlayer(m, {
    mult: dmgMult, elem: d.elem, phys: !d.elem, sure: true, dot: d.dot, stun: d.stun, slow: d.slow,
    label: d.name, push: d.push, from: { x: x, y: y }
  });
  if (res && !res.miss && !res.invuln && d.hit) eliteHitFx('pv-float', d.hit);
}

/* ============ 單點：熔岩爆裂、冰霜新星、地裂、石化凝視、震地衝擊 ============ */
function eliteCastSpot(m, d) {
  var pp = elitePos();
  var mp = eliteMonsterPos(m) || pp;
  var x = d.at === 'self' ? mp.x : pp.x;
  var y = d.at === 'self' ? mp.y : pp.y;
  eliteBusy(m, d.warn + 0.25, d.at === 'self');
  eliteWarn(x, y, d.r, d.warnPreset, d.warn, 'spot');
  eliteLater(d.warn, function () {
    if (d.at === 'self' && !(m.hp > 0)) return;
    eliteSpotImpact(m, d, x, y, d.r, d.dmg);
  });
}

/* ============ 場域 ============ */
function eliteCastZone(m, d) {
  var pp = elitePos();
  var mp = eliteMonsterPos(m) || pp;
  var x, y, a = 0;
  var dirx = pp.x - mp.x, diry = pp.y - mp.y;
  var dl = Math.sqrt(dirx * dirx + diry * diry) || 1;
  if (d.at === 'self') { x = mp.x; y = mp.y; }
  else if (d.at === 'ahead') { x = mp.x + dirx * 0.55; y = mp.y + diry * 0.55; }
  else { x = pp.x; y = pp.y; }
  if (d.rect) a = Math.atan2(diry, dirx) + Math.PI / 2;     // 牆與你的來向垂直
  var warn = d.warn || 0;
  if (warn > 0) {
    eliteBusy(m, warn + 0.2, false);
    if (d.rect) {
      /* 長條形場域：兩端各亮一個圈，預告「這一條」會燒起來。 */
      var ex = Math.cos(a) * d.w2 / 2, ey = Math.sin(a) * d.w2 / 2;
      var er = Math.max(30, d.h2 * 0.75);
      eliteWarn(x + ex, y + ey, er, d.warnPreset, warn, 'wall');
      eliteWarn(x - ex, y - ey, er, d.warnPreset, warn, 'wall');
      eliteWarn(x, y, er, d.warnPreset, warn, 'wall');
    } else {
      eliteWarn(x, y, d.r, d.warnPreset, warn, 'zone');
    }
  } else {
    eliteBusy(m, d.busy || 0.6, false);
  }
  eliteLater(warn, function () {
    if (ELITE_RT.zones.length >= Math.max(1, Math.floor(eliteG('maxZones', 24)))) return;
    eliteZoneSpawn(m, d, x, y, a);
  });
}
function eliteZoneSpawn(m, d, x, y, a) {
  var z = {
    owner: m, def: d, x: x, y: y, a: a, until: GT + d.life, nextTick: d.tick * 0.5,
    r: d.r || 0, w: d.rect ? d.w2 : 0, h: d.rect ? d.h2 : 0
  };
  z.vis = eliteVisAdd({
    id: eliteVisId('zone'), preset: d.preset, x: x, y: y, r: d.r, w: z.w, h: z.h, a: a, until: z.until, curtain: !!d.curtain
  });
  ELITE_RT.zones.push(z);
  return z;
}
function eliteZonesTick(dt) {
  if (!ELITE_RT.zones.length) return;
  var keep = [];
  var pp = elitePos();
  for (var i = 0; i < ELITE_RT.zones.length; i++) {
    var z = ELITE_RT.zones[i];
    if (GT >= z.until) { z.vis.until = 0; continue; }
    var d = z.def;
    if (d.drift > 0 && elitePlayerAlive()) {
      var dx = pp.x - z.x, dy = pp.y - z.y;
      var dl = Math.sqrt(dx * dx + dy * dy);
      if (dl > 6) {
        var step = Math.min(dl, d.drift * dt);
        z.x += dx / dl * step; z.y += dy / dl * step;
        z.vis.x = z.x; z.vis.y = z.y;
      }
    }
    if (z.vortex && elitePlayerAlive()) {
      var vr = eliteDist(pp.x, pp.y, z.x, z.y);
      if (vr <= z.r * 1.8) elitePullPlayer(z.x, z.y, d.pull * dt);
    }
    z.nextTick -= dt;
    if (z.nextTick <= 0) {
      z.nextTick += d.tick;
      var inside = z.w > 0 ? eliteInRect(z.x, z.y, z.w, z.h, z.a) : eliteInCircle(z.x, z.y, z.r);
      if (inside && elitePlayerAlive()) {
        eliteHitPlayer(z.owner, {
          mult: d.dmg, elem: d.elem, sure: true, dot: d.dot, stun: d.stun, slow: d.slow,
          label: d.name, quiet: true
        });
      }
    }
    keep.push(z);
  }
  ELITE_RT.zones = keep;
}
/* 熔岩足跡：定時在腳下留一塊。 */
function eliteTrailTick(m, d, rt, dt, id) {
  rt.cd[id] = (rt.cd[id] || 0) - dt;
  if (rt.cd[id] > 0) return;
  rt.cd[id] = rnd(d.cd[0], d.cd[1]);
  var mp = eliteMonsterPos(m);
  if (!mp || ELITE_RT.zones.length >= Math.max(1, Math.floor(eliteG('maxZones', 24)))) return;
  eliteZoneSpawn(m, d, mp.x, mp.y, 0);
}

/* ============ 彈體 ============ */
function eliteCastVolley(m, d) {
  eliteBusy(m, Math.min(1.8, d.busy + (d.n - 1) * d.gap), false);
  for (var i = 0; i < d.n; i++) {
    (function (index) {
      eliteLater(0.35 + index * d.gap, function () {
        if (!(m.hp > 0) || !elitePlayerAlive()) return;
        var pp = elitePos();
        var tx = pp.x, ty = pp.y;
        eliteFx({
          fxKind: 'projectile', variant: 'elite-proj', elem: d.elem || null, count: 1, dur: d.travel, hit: false,
          sourceId: m.floatSel, targets: ['pv-float'], travelMs: [Math.round(d.travel * 1000)],
          lineWidth: d.bodyD, vfx: { projectile: d.proj }
        });
        eliteLater(d.travel, function () {
          if (d.burst) eliteBurstFx(tx, ty, d.burstR || 70, d.burst, 0, d.elem);
          if (!eliteInCircle(tx, ty, d.hitR)) return;
          var res = eliteHitPlayer(m, {
            mult: d.dmg, elem: d.elem, dot: d.dot, stun: d.stun, slow: d.slow, label: d.name,
            quiet: index > 0, sure: false
          });
          if (res && !res.miss && !res.invuln) eliteHitFx('pv-float', d.hit);
        });
      });
    })(i);
  }
}

/* ============ 直線：秘法光束 ============ */
function eliteCastBeam(m, d) {
  var pp = elitePos();
  var mp = eliteMonsterPos(m) || pp;
  var ang = Math.atan2(pp.y - mp.y, pp.x - mp.x);
  eliteBusy(m, d.warn + 0.45, true);
  /* 預警：沿著光束路徑一路排預警圈，圈的直徑就是判定寬度，看得出路徑與粗細。 */
  var dots = Math.max(2, Math.round(d.len / (d.width * 0.9)));
  for (var bi = 0; bi < dots; bi++) {
    var bt = (bi + 0.5) / dots * d.len;
    eliteWarn(mp.x + Math.cos(ang) * bt, mp.y + Math.sin(ang) * bt, d.width / 2, d.warnPreset, d.warn, 'beam');
  }
  eliteLater(d.warn, function () {
    if (!(m.hp > 0)) return;
    var mp2 = eliteMonsterPos(m) || mp;
    eliteFx({
      fxKind: 'beam', variant: 'elite-beam', elem: d.elem || null, count: 1, dur: 0.35, hit: false,
      sourceId: m.floatSel, angle: ang, lineLength: d.len, lineWidth: d.width, vfx: { attack: d.beamPreset }
    });
    var pp2 = elitePos();
    var ex = mp2.x + Math.cos(ang) * d.len, ey = mp2.y + Math.sin(ang) * d.len;
    if (eliteSegmentDist(mp2.x, mp2.y, ex, ey, pp2.x, pp2.y) <= d.width / 2 + ELITE_PLAYER_BODY_R) {
      eliteHitPlayer(m, { mult: d.dmg, elem: d.elem, sure: true, label: d.name });
    }
  });
}

/* ============ 連鎖閃電：一道電弧直接連到你身上 ============
   畫面走顯示層既有的 lightning-chain（與新版技能【連鎖閃電】同一種 chain 事件）：起點是這隻菁英、終點是你，
   帶 travelMs／sourceX／homingSpeed 才會走「追蹤電弧」那條路徑（沒帶的話電弧長度不對，會穿過你射出去）；
   電弧落地後送 lightning-chain-end 收尾。命中爆點由顯示層在抵達終點時自己播。 */
var ELITE_CHAIN_SPEED = 1600;     // 電弧飛行速度（座標單位／秒），只影響畫面上電弧到達的快慢
function eliteCastBolt(m, d) {
  eliteBusy(m, d.busy, false);
  eliteLater(0.3, function () {
    if (!(m.hp > 0) || !elitePlayerAlive()) return;
    var mp = eliteMonsterPos(m), pp = elitePos();
    if (mp) {
      var dist = eliteDist(mp.x, mp.y, pp.x, pp.y);
      var travelMs = Math.max(60, dist / ELITE_CHAIN_SPEED * 1000);
      var chainId = 'elite-chain-' + (ELITE_VIS_SEQ++);
      eliteFx({
        fxKind: 'chain', variant: 'lightning-chain', elem: d.elem || null, count: 1, dur: 0.35,
        targets: [m.floatSel, 'pv-float'], travelMs: [0, travelMs], preserveDeadTargets: true,
        lineLength: (typeof bfMeterPx === 'function') ? bfMeterPx(18) : 180,
        area: { sourceX: mp.x, sourceY: mp.y, x: pp.x, y: pp.y, chainId: chainId, homingSpeed: ELITE_CHAIN_SPEED },
        vfx: { projectile: d.bolt, hit: d.hit }
      });
      eliteLater(travelMs / 1000 + 0.15, function () {
        eliteFx({ fxKind: 'chain', variant: 'lightning-chain-end', hit: false, vfx: {}, area: { chainId: chainId } });
      });
    }
    eliteHitPlayer(m, { mult: d.dmg, elem: d.elem, label: d.name, stun: d.stun });
  });
}

/* ============ 位移：衝鋒、瞬影 ============ */
function eliteCastDash(m, d) {
  var pp = elitePos();
  var tx = pp.x, ty = pp.y;
  eliteBusy(m, d.warn + 1.2, true);
  eliteWarn(tx, ty, d.hitR, d.warnPreset, d.warn, 'dash');
  eliteLater(d.warn, function () {
    if (!(m.hp > 0)) return;
    var mp = eliteMonsterPos(m);
    if (!mp) return;
    var dx = tx - mp.x, dy = ty - mp.y;
    var dl = Math.sqrt(dx * dx + dy * dy);
    var stop = 36;
    var run = Math.max(0, dl - stop);
    var dur = Math.max(0.12, run / d.speed);
    m._elLockUntil = GT + dur + 0.2;
    eliteBurstFx(mp.x, mp.y, 55, d.burst, 0);
    m._elDash = {
      sx: mp.x, sy: mp.y,
      ex: dl > 0 ? mp.x + dx / dl * run : mp.x, ey: dl > 0 ? mp.y + dy / dl * run : mp.y,
      t: 0, dur: dur
    };
    eliteLater(dur, function () {
      if (!(m.hp > 0)) { m._elDash = null; return; }
      var dash = m._elDash;
      if (dash) { var pos = eliteMonsterPos(m); if (pos) { pos.x = dash.ex; pos.y = dash.ey; } }
      m._elDash = null;
      var mp2 = eliteMonsterPos(m) || mp;
      var pp2 = elitePos();
      if (eliteDist(pp2.x, pp2.y, mp2.x, mp2.y) <= d.hitR) {
        eliteHitFx('pv-float', d.impact);
        eliteBurstFx(mp2.x, mp2.y, 60, d.burst, 0);
        eliteHitPlayer(m, { mult: d.dmg, phys: true, sure: true, stun: d.stun, push: d.push, from: mp2, label: d.name });
      }
    });
  });
}
/* 衝鋒進行中：每個 tick 把牠沿路徑推進（座標由模擬層決定，顯示層只內插）。 */
function eliteDashStep(m, dt) {
  var dash = m._elDash;
  if (!dash) return;
  dash.t += dt;
  var k = Math.min(1, dash.t / dash.dur);
  var pos = eliteMonsterPos(m);
  if (!pos) return;
  pos.x = dash.sx + (dash.ex - dash.sx) * k;
  pos.y = dash.sy + (dash.ey - dash.sy) * k;
}

function eliteCastBlink(m, d) {
  var pp = elitePos();
  var ang = Math.random() * Math.PI * 2;
  var tx = pp.x + Math.cos(ang) * d.dist, ty = pp.y + Math.sin(ang) * d.dist;
  var mp = eliteMonsterPos(m);
  eliteBusy(m, d.warn + 0.6, true);
  if (mp) eliteBurstFx(mp.x, mp.y, 60, d.burst, 0);
  eliteWarn(tx, ty, d.r, d.warnPreset, d.warn, 'blink');
  eliteLater(d.warn, function () {
    if (!(m.hp > 0)) return;
    var pos = eliteMonsterPos(m);
    if (pos) { pos.x = tx; pos.y = ty; m._wasInRange = false; }
    eliteBurstFx(tx, ty, d.r * 1.2, d.burst, 0, d.elem);
    if (eliteInCircle(tx, ty, d.r)) eliteHitPlayer(m, { mult: d.dmg, elem: d.elem, sure: true, label: d.name });
  });
}

/* ============ 旋風斬：原地連續橫掃 ============ */
function eliteCastSpin(m, d) {
  var mp = eliteMonsterPos(m);
  if (!mp) return;
  var total = d.warn + d.ticks * d.gap;
  eliteBusy(m, total + 0.2, true);
  eliteWarn(mp.x, mp.y, d.r, d.warnPreset, d.warn, 'spin');
  for (var i = 0; i < d.ticks; i++) {
    eliteLater(d.warn + i * d.gap, function () {
      if (!(m.hp > 0)) return;
      var pos = eliteMonsterPos(m) || mp;
      eliteBurstFx(pos.x, pos.y, d.r, d.burst, 0);
      if (eliteInCircle(pos.x, pos.y, d.r)) {
        eliteHitPlayer(m, { mult: d.dmg, phys: true, sure: true, label: d.name, quiet: true });
      }
    });
  }
}

/* ============ 虛空漩渦：拖拽＋坍縮 ============ */
function eliteCastVortex(m, d) {
  var pp = elitePos();
  var mp = eliteMonsterPos(m) || pp;
  var ang = Math.random() * Math.PI * 2;
  var vx = pp.x + Math.cos(ang) * 130, vy = pp.y + Math.sin(ang) * 130;
  eliteBusy(m, d.warn + d.life + 0.4, false);
  eliteWarn(vx, vy, d.r, d.warnPreset, d.warn, 'vortex');
  eliteLater(d.warn, function () {
    var vis = eliteVisAdd({ id: eliteVisId('hole'), preset: d.preset, x: vx, y: vy, r: d.r, until: GT + d.life });
    var z = { owner: m, def: d, x: vx, y: vy, until: GT + d.life, nextTick: 9999, r: d.r, w: 0, h: 0, vis: vis, vortex: true };
    ELITE_RT.zones.push(z);
    eliteLater(d.life, function () {
      eliteBurstFx(vx, vy, d.r * 1.15, d.burst, 0, d.elem);
      if (eliteInCircle(vx, vy, d.r)) eliteHitPlayer(m, { mult: d.dmg, elem: d.elem, sure: true, slow: d.slow, label: d.name });
    });
  });
}

/* ============ 支援與干擾 ============ */
function eliteCastShield(m, d) {
  eliteBusy(m, d.busy, false);
  applyShield(m, d.pct, d.dur, 'shield');
  var mp = eliteMonsterPos(m);
  if (mp) eliteBurstFx(mp.x, mp.y, 70 * (d.vfxScale || 1), d.vfx, 0);
}
function eliteCastReflect(m, d) {
  eliteBusy(m, d.busy, false);
  m._el.reflectUntil = GT + d.dur;
  m._el.reflectPct = d.pct;
  var mp = eliteMonsterPos(m);
  if (mp) eliteBurstFx(mp.x, mp.y, 75, d.vfx, 0);
  floatEnemyEvent(m, 'mv-float', '反射中', 'elite-cast');
}
function eliteCastInvuln(m, d) {
  eliteBusy(m, d.busy, false);
  var members = eliteGroupMembers(m, true);
  members.forEach(function (e) {
    if (!e._el) e._el = { cd: {}, busyUntil: 0, summoned: 0, rageMult: 1, sacMult: 1, atkUntil: 0, invulnUntil: 0, reflectUntil: 0, lastImmuneAt: -9 };
    e._el.invulnUntil = GT + d.dur;
    var ep = eliteMonsterPos(e);
    if (ep) eliteBurstFx(ep.x, ep.y, 55 * (d.vfxScale || 1), d.vfx, 0);
  });
}
function eliteCastHeal(m, d) {
  eliteBusy(m, d.busy, false);
  var ids = [];
  eliteGroupMembers(m, true).forEach(function (e) {
    var add = e.maxHp * d.pct / 100;
    var before = e.hp;
    e.hp = Math.min(e.maxHp, e.hp + add);
    if (e.hp > before) {
      floatEnemyEvent(e, 'mv-float', '+' + fmt(e.hp - before), 'elite-heal');
      if (e.floatSel) ids.push(e.floatSel);
    }
  });
  if (ids.length) {
    eliteFx({
      fxKind: 'rain', variant: 'pillar', elem: 'light', count: 1, dur: 1, hit: false,
      targets: ids.slice(0, 8), vfx: { attack: d.vfx }
    });
  }
}
function eliteCastSummon(m, d) {
  eliteBusy(m, d.busy, false);
  var cap = Math.max(0, Math.floor(eliteG('summonCap', 6)));
  var n = Math.min(d.n, cap - (m._el.summoned || 0));
  if (n <= 0 || typeof spawnEliteSummons !== 'function') return;
  var made = spawnEliteSummons(m, n);
  m._el.summoned = (m._el.summoned || 0) + made.length;
  made.forEach(function (e) {
    var ep = eliteMonsterPos(e);
    if (ep) eliteBurstFx(ep.x, ep.y, 52, d.vfx, 0);
  });
}
function eliteCastBloodsac(m, d) {
  eliteBusy(m, d.busy, false);
  var victims = eliteGroupMembers(m, true).filter(function (e) { return e !== m && !e.elite && e.hp > 0; });
  if (!victims.length) return;
  var v = victims[Math.floor(Math.random() * victims.length)];
  var vp = eliteMonsterPos(v);
  if (vp) eliteBurstFx(vp.x, vp.y, 60, d.vfx, 0);
  v.hp = 0;
  floatEnemyEvent(v, 'mv-float', '獻祭', 'elite-cast');
  if (typeof onFieldKill === 'function') onFieldKill(v);
  var heal = m.maxHp * d.heal / 100;
  m.hp = Math.min(m.maxHp, m.hp + heal);
  var rt = m._el;
  rt.sacMult = 1 + d.atk / 100;
  rt.atkUntil = GT + d.dur;
  floatEnemyEvent(m, 'mv-float', '+' + fmt(heal), 'elite-heal');
  var mp = eliteMonsterPos(m);
  if (mp) eliteBurstFx(mp.x, mp.y, 70, d.vfx, 0.1);
}
function eliteCastCurse(m, d) {
  eliteBusy(m, d.busy, false);
  eliteLater(0.3, function () {
    if (!(m.hp > 0) || !elitePlayerAlive()) return;
    eliteHitFx('pv-float', d.vfx);
    eliteHitPlayer(m, {
      mult: d.dmg, elem: d.elem, sure: true, atkDown: d.atkDown, defDown: d.defDown, dur: d.dur, label: d.name
    });
    floatPlayerEvent('pv-float', '詛咒!', 'debuff');
  });
}
function eliteCastDrain(m, d) {
  eliteBusy(m, d.busy, false);
  eliteLater(0.25, function () {
    if (!(m.hp > 0) || !elitePlayerAlive()) return;
    var p = elitePlayer();
    var maxMp = (typeof getStats === 'function') ? (getStats().mp || 0) : 0;
    var take = Math.min(p.mp || 0, maxMp * d.mp / 100);
    p.mp = Math.max(0, (p.mp || 0) - take);
    /* 光球從你身上飛回牠身上，一眼看出法力被抽走。 */
    eliteFx({
      fxKind: 'projectile', variant: 'elite-drain', count: 1, dur: 0.55, hit: false,
      sourceId: 'pv-float', targets: [m.floatSel], travelMs: [550], lineWidth: d.bodyD, vfx: { projectile: d.proj }
    });
    if (take > 0) floatPlayerEvent('pv-float', '-' + fmt(take) + ' 法力', 'debuff');
    var heal = m.maxHp * d.heal / 100;
    m.hp = Math.min(m.maxHp, m.hp + heal);
    eliteHitPlayer(m, { mult: d.dmg, elem: d.elem, sure: true, label: d.name, quiet: true });
  });
}

/* ============ 常駐：再生 ============ */
function eliteRegenTick(m, d, rt, dt, id) {
  rt.cd[id] = (rt.cd[id] === undefined ? d.cd[0] : rt.cd[id]) - dt;
  if (rt.cd[id] > 0) return;
  rt.cd[id] = d.cd[0];
  if (m.hp >= m.maxHp) return;
  var add = m.maxHp * d.pct / 100;
  var before = m.hp;
  m.hp = Math.min(m.maxHp, m.hp + add);
  floatEnemyEvent(m, 'mv-float', '+' + fmt(m.hp - before), 'elite-heal');
  var mp = eliteMonsterPos(m);
  if (mp) eliteBurstFx(mp.x, mp.y, 46, d.vfx, 0);
}

/* ============ 傷害管線：受到傷害 ============ */
/* 菁英受到傷害前的最終修正（resolveHit／applyEnemyHpDamage 呼叫）。 */
function eliteIncomingDamage(m, dmg, attacker) {
  var rt = m && m._el;
  if (!rt || !(dmg > 0)) return dmg;
  if (rt.invulnUntil > GT) {
    if (GT - rt.lastImmuneAt > 0.5) { rt.lastImmuneAt = GT; floatEnemyEvent(m, 'mv-float', '免疫', 'elite-cast'); }
    return 0;
  }
  var mult = 1;
  m.affixes.forEach(function (id) {
    var d = eliteDef(id);
    if (!d) return;
    if (d.arch === 'giant') mult *= 1 - d.red / 100;
    if (d.arch === 'lifelink' && eliteLinkPartners(m).length) mult *= 1 - d.share / 100;
  });
  return Math.max(0, Math.round(dmg * mult));
}
function eliteLinkPartners(m) {
  return eliteGroupMembers(m, true).filter(function (e) { return e !== m && eliteHas(e, 'lifelink'); });
}
var ELITE_SHARING = false;
/* 菁英受傷後的反應。attacker 為玩家時才有反震類（持續傷害與衍生傷害 attacker＝null 不反彈）。 */
function eliteOnDamaged(m, dealt, attacker) {
  var rt = m && m._el;
  if (!rt || !(dealt > 0)) return;
  var player = elitePlayer();
  var byPlayer = !!(attacker && attacker === player);
  for (var i = 0; i < m.affixes.length; i++) {
    var d = eliteDef(m.affixes[i]);
    if (!d) continue;
    if (d.arch === 'lifelink' && !ELITE_SHARING) {
      var partners = eliteLinkPartners(m);
      if (partners.length) {
        ELITE_SHARING = true;
        var total = dealt / Math.max(0.01, 1 - d.share / 100);      // 還原成原本應受的傷害
        var each = total * (d.share / 100) / partners.length;
        for (var k = 0; k < partners.length; k++) {
          var partner = partners[k];
          if (partner._el && partner._el.invulnUntil > GT) continue;
          partner.hp = Math.max(0, partner.hp - each);
        }
        ELITE_SHARING = false;
      }
    } else if (d.arch === 'enrage' && !rt.enraged && m.hp > 0 && m.hp <= m.maxHp * d.hpPct / 100) {
      rt.enraged = true;
      rt.rageMult = d.atk;
      m.aspd = (Number(m.aspd) || 1) * d.aspd;
      var mp = eliteMonsterPos(m);
      if (mp) eliteBurstFx(mp.x, mp.y, 85, d.vfx, 0);
      floatEnemyEvent(m, 'mv-float', d.emoji + '狂暴!', 'elite-cast');
      if (typeof blog === 'function') blog('😡 ' + (m.name || '菁英') + ' 進入狂暴！', 'log-enemy-skill', 'combat');
    } else if (d.arch === 'thorns' && byPlayer) {
      eliteReflect(m, dealt * d.pct / 100, d.cap, d.hit, '荊棘');
    }
  }
  if (byPlayer && rt.reflectUntil > GT) eliteReflect(m, dealt * (rt.reflectPct || 0) / 100, 25, 'hit-phys', '反射');
}
/* 反彈給玩家：先封頂（占玩家最大生命的 capPct%），再走 resolveHit 吃玩家的防禦。 */
function eliteReflect(m, raw, capPct, hitPreset, label) {
  var p = elitePlayer();
  if (!p || p.hp <= 0 || !(raw > 0)) return;
  var st = getStats();
  raw = Math.min(raw, st.hp * Math.max(1, capPct) / 100);
  var cfg = {
    atk: raw, dmgType: 'phys', level: m.level, critRate: 0, critDmg: 100, hit: 100000,
    elemAtk: null, globalDmgRed: 0, isElite: true, isBoss: false, attr: null
  };
  var dCfg = playerDefCfg(p);
  var res = resolveHit(m, p, cfg, dCfg);
  if (res.invuln || res.miss) return;
  floatText('pv-float', '-' + fmt(res.dmg), 'mdmg');
  floatPlayerEvent('pv-float', label + '!', 'debuff');
  eliteHitFx('pv-float', hitPreset);
}

/* ============ 傷害管線：這隻菁英打中玩家之後 ============ */
function eliteOnAttackHit(m, p, res, hpDamage) {
  if (!m || !m.affixes || !res || res.miss || res.invuln) return;
  for (var i = 0; i < m.affixes.length; i++) {
    var d = eliteDef(m.affixes[i]);
    if (!d) continue;
    if (d.arch === 'vampiric' && hpDamage > 0) {
      var heal = hpDamage * d.pct / 100;
      var before = m.hp;
      m.hp = Math.min(m.maxHp, m.hp + heal);
      if (m.hp > before) {
        floatEnemyEvent(m, 'mv-float', '+' + fmt(m.hp - before), 'elite-heal');
        eliteFx({
          fxKind: 'projectile', variant: 'elite-drain', count: 1, dur: 0.5, hit: false,
          sourceId: 'pv-float', targets: [m.floatSel], travelMs: [500], vfx: { projectile: d.proj }
        });
      }
    } else if (d.arch === 'knockback' && chance(d.chance)) {
      var mp = eliteMonsterPos(m);
      if (mp) {
        elitePushPlayer(mp.x, mp.y, d.dist);
        eliteBurstFx(elitePos().x, elitePos().y, 55, d.vfx, 0);
        floatPlayerEvent('pv-float', '被擊飛!', 'debuff');
        var dCfg = playerDefCfg(p);
        if (d.stun > 0 && !resistCtrl(dCfg)) applyEffect(p, 'stun', d.stun * (dCfg.ccFactor === undefined ? 1 : dCfg.ccFactor));
      }
    }
  }
}
/* monsterAtkCfg 的攻擊倍率（狂暴、血祭）。 */
function eliteAtkFactor(m) {
  var rt = m && m._el;
  if (!rt) return 1;
  return (rt.rageMult > 0 ? rt.rageMult : 1) * (rt.atkUntil > GT && rt.sacMult > 0 ? rt.sacMult : 1);
}

/* ============ 死亡 ============ */
/* 回傳 true＝牠沒有真的死（不死鳥重生），onFieldKill 直接結束、不給獎勵。 */
function eliteOnDeath(m) {
  if (!m || !m.affixes || !m._el) return false;
  var rt = m._el;
  for (var i = 0; i < m.affixes.length; i++) {
    var id = m.affixes[i];
    var d = eliteDef(id);
    if (!d) continue;
    if (d.arch === 'phoenix' && !rt.phoenixUsed) {
      rt.phoenixUsed = true;
      m.hp = Math.max(1, m.maxHp * d.hp / 100);
      m.shield = 0;
      rt.invulnUntil = GT + 1.6;
      if (typeof cleanse === 'function') cleanse(m);
      var mp = eliteMonsterPos(m);
      if (mp) { eliteBurstFx(mp.x, mp.y, 110, d.vfx, 0); }
      eliteFx({
        fxKind: 'rain', variant: 'pillar', elem: 'light', count: 1, dur: 1, hit: false,
        targets: [m.floatSel], vfx: { attack: d.vfx2 }
      });
      floatEnemyEvent(m, 'mv-float', d.emoji + '浴火重生!', 'elite-cast');
      if (typeof blog === 'function') blog('🕊️ ' + (m.name || '菁英') + ' 浴火重生，帶著 ' + Math.round(d.hp) + '% 生命站了起來！', 'log-enemy-skill', 'combat');
      return true;
    }
  }
  /* 以下不阻止死亡，只在死後留下東西。 */
  for (var j = 0; j < m.affixes.length; j++) {
    var dd = eliteDef(m.affixes[j]);
    if (!dd) continue;
    if (dd.arch === 'bomber') eliteBomberArm(m, dd);
    else if (dd.arch === 'splitter' && typeof spawnEliteSplits === 'function') {
      var kids = spawnEliteSplits(m, dd);
      kids.forEach(function (e) {
        var ep = eliteMonsterPos(e);
        if (ep) eliteBurstFx(ep.x, ep.y, 50, dd.vfx, 0);
      });
      floatEnemyEvent(m, 'mv-float', dd.emoji + '分裂!', 'elite-cast');
    }
  }
  return false;
}
function eliteBomberArm(m, d) {
  var mp = eliteMonsterPos(m);
  if (!mp) return;
  var x = mp.x, y = mp.y;
  eliteWarn(x, y, d.r, d.warnPreset, d.delay, 'bomb');
  floatEnemyEvent(m, 'mv-float', d.emoji + '即將爆炸!', 'elite-cast');
  eliteLater(d.delay, function () {
    eliteBurstFx(x, y, d.r * 1.2, d.burst, 0, d.elem);
    if (eliteInCircle(x, y, d.r)) eliteHitPlayer(m, { mult: d.dmg, elem: d.elem, sure: true, label: d.name });
  });
}

/* 每隻敵人每個 tick 的位移鎖與衝鋒推進（由 fieldTick 呼叫，見 combat.js）。 */
function eliteStepMotion(list, dt) {
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    if (m && m._elDash && m.hp > 0) eliteDashStep(m, dt);
  }
}
/* 這隻現在被詞條鎖住（施法／衝鋒中）：不走路、不普攻。 */
function eliteLocked(m) { return !!(m && m._elLockUntil > GT); }
