'use strict';
/* ============================================================
   elite.js — 高級敵人（菁英、高級菁英、野外 BOSS、封魔塔 BOSS）的技能引擎（只在 Worker 載入）
   ------------------------------------------------------------
   技能資料在 Skills2 表（類別＝enemy → ENEMY_SKILLS2 → js/elite_data.js 的 ELITE_AFFIXES）；
   每種敵人帶哪些技能在 NPC 表。這支檔案是「行為」：
     1. 給敵人配技能（eliteRollSkills／eliteEquip）
     2. 每個 tick 驅動技能（eliteTick）：冷卻、施放、場域、預警、延遲事件，以及「跑位」
     3. 掛在傷害管線上的被動反應（eliteIncomingDamage／eliteOnDamaged／eliteOnAttackHit／eliteOnDeath）
   野外與封魔塔共用同一套：eliteCtx 系列函式決定「現在的玩家、敵人清單、浮字定址」是哪一邊。

   視覺原則（使用者要求「看得出他放了什麼技能」且「不要和玩家技能長得一樣」）：
     - 每次施放：頭上浮出「圖示＋技能名」、戰鬥日誌一行、自身一道施法光
     - 凡是會傷到你的範圍技能一律先在地上畫預警，倒數完才結算；預警與結算用 preset 事件送顯示層
     - 顯示層只畫，傷害判定都在這裡（AI_RULES 8.3：兩者共用同一組半徑與座標）
   所有可調數字都在 Skills2 表（技能）、NPC 表（誰帶什麼）、game_parameters「4-菁英群組」（機率、倍率、體型、跑位）。
   這裡不寫配置值，也不寫 preset id（USAGE：特效一律由 Skills2 表填入）。
   ============================================================ */

var ELITE_PLAYER_BODY_R = 18;     // 判定時把玩家當成半徑這麼大的圓（身體邊緣先碰到範圍就算中）
var ELITE_VIS_REFRESH_SEC = 0.3;  // 場域特效的續命間隔（顯示層以 area.id 合併，超過約半秒沒續命就收掉）
var ELITE_CASTS_PER_TICK = 3;     // 同一個 tick 最多開幾個新技能，避免整群同時開火

var ELITE_RT = {
  jobs: [],      // 延遲事件 { at, fn }
  vis: [],       // 地面特效（預警與場域共用）{ id, preset, x, y, r|w,h,a, until, next, every }
  zones: [],     // 傷害場域
  chains: [],    // 火鏈 { id, a, b, nextTick, vis }
  beams: [],     // 旋轉光束 { owner, x, y, t0, until, arms, nextTick, vis, def }
  crosses: [],   // 毒十字 { owner, x, y, t0, until, nextTick, vis, def }
  orbs: [],      // 冰凍脈衝的追蹤冰球 { owner, x, y, until, nextPulse, vis, def }
  sparks: [],    // 電火花 { owner, x, y, vx, vy, until, r, def }
  walls: [],     // 石牆 { x, y, a, len, thick, until, vis }
  pull: null,    // 漩渦的拉扯進行中 { owner, tx, ty, speed, def }
  budget: 0,
  errors: 0
};

/* 全部清掉：玩家死亡、換圖、演武場關閉、塔戰開始與結束時呼叫，避免死前排好的預警在復活後還炸人。 */
function eliteReset() {
  ELITE_RT.jobs.length = 0;
  ELITE_RT.vis.length = 0;
  ELITE_RT.zones.length = 0;
  ELITE_RT.chains.length = 0;
  ELITE_RT.beams.length = 0;
  ELITE_RT.crosses.length = 0;
  ELITE_RT.orbs.length = 0;
  ELITE_RT.sparks.length = 0;
  ELITE_RT.walls.length = 0;
  ELITE_RT.pull = null;
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
function eliteArch(m, arch) {
  if (!m || !m.affixes) return null;
  for (var i = 0; i < m.affixes.length; i++) { var d = eliteDef(m.affixes[i]); if (d && d.arch === arch) return d; }
  return null;
}
function eliteDist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
function eliteMonsterPos(m) { return (m && m.pos && isFinite(m.pos.x) && isFinite(m.pos.y)) ? m.pos : null; }
function eliteRandInt(lo, hi) { lo = Math.floor(lo); hi = Math.floor(hi); return lo + Math.floor(Math.random() * (hi - lo + 1)); }
function eliteRange(v, fallback) {
  if (Array.isArray(v)) return [Number(v[0]) || 0, Number(v.length > 1 ? v[1] : v[0]) || 0];
  var n = Number(v);
  return isFinite(n) ? [n, n] : (fallback || [0, 0]);
}
function eliteLater(sec, fn) { ELITE_RT.jobs.push({ at: GT + Math.max(0, sec), fn: fn }); }
function eliteGuard(label, fn) {
  try { return fn(); } catch (e) {
    /* 一個技能壞掉不能把整個戰鬥迴圈拖下水；每種錯誤只報前幾次，不洗版。 */
    if (ELITE_RT.errors++ < 5 && typeof console !== 'undefined') console.error('[elite] ' + label, e);
    return undefined;
  }
}

/* ---------------- 野外／封魔塔：現在是哪一邊 ---------------- */
function eliteTowerOn() {
  return typeof TOWER !== 'undefined' && TOWER && typeof G !== 'undefined' && G && G.tower && G.tower.active === true && !!TOWER.boss;
}
function elitePlayer() {
  if (eliteTowerOn()) return TOWER.player || null;
  return (typeof FIELD !== 'undefined' && FIELD) ? FIELD.player : null;
}
function elitePF() { return eliteTowerOn() ? 'tp-float' : 'pv-float'; }       // 我方的浮字／特效定址
function eliteEnemies() {
  if (eliteTowerOn()) return (TOWER.boss && TOWER.boss.hp > 0) ? [TOWER.boss] : [];
  return (typeof fieldEnemyList === 'function') ? fieldEnemyList() : [];
}
function elitePos() { return (typeof bfPlayerPos === 'function') ? bfPlayerPos() : { x: 0, y: 0 }; }
function elitePlayerAlive() {
  var p = elitePlayer();
  if (!p || !(p.hp > 0) || p._sgRevival) return false;
  if (eliteTowerOn()) return true;
  return !(FIELD.reviveCd > 0);
}
/* 這隻現在能不能行動：還在進場倒數、塔戰登場演出中都不行。 */
function eliteReady(m) {
  if (eliteTowerOn()) return !(TOWER.introCd > 0);
  return (typeof fieldCombatReady === 'function') ? fieldCombatReady(m) : true;
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
/* 施法者身上的「施放特效」。沒填就不播（不退回別的畫面）。 */
function eliteCastFx(m, d) {
  if (m && m.floatSel && d && d.v && d.v.cast) eliteHitFx(m.floatSel, d.v.cast);
}
/* 一次飛行：從 (x0,y0) 飛到 (x1,y1)，travelSec 秒；ctrl＝彎曲路徑的控制點（沒給＝直線）；arcM＝拋物線高度（米）。 */
function eliteFlightFx(preset, x0, y0, x1, y1, travelSec, o) {
  if (!preset) return;
  o = o || {};
  var area = { sourceX: x0, sourceY: y0, x: x1, y: y1, knifeFlight: true };
  if (o.ctrl) { area.controlX = o.ctrl.x; area.controlY = o.ctrl.y; }
  eliteFx({
    fxKind: 'projectile', variant: 'elite-flight', elem: o.elem || null, count: 1, dur: travelSec, hit: false,
    delayMs: o.delaySec > 0 ? Math.round(o.delaySec * 1000) : 0, travelMs: [Math.round(Math.max(0.05, travelSec) * 1000)],
    lineWidth: o.bodyD || 0, arcM: o.arcM || 0, area: area, vfx: { projectile: preset }
  });
}
/* 地面特效（預警圈、毒窪、火牆…）：登記進 vis 清單，之後每 0.3 秒自動續命直到 until。 */
function eliteVisAdd(v) {
  v.next = 0;
  ELITE_RT.vis.push(v);
  eliteVisEmit(v);
  return v;
}
function eliteVisEmit(v) {
  v.next = GT + (v.every > 0 ? v.every : ELITE_VIS_REFRESH_SEC);
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
  if (!m || !p || p.hp <= 0 || !elitePlayerAlive()) return null;
  var cfg = monsterAtkCfg(m, (o.mult || 1) * eliteDmgScale());
  if (o.elem) { cfg.dmgType = 'magic'; cfg.skillElem = o.elem; }
  else if (o.phys) cfg.dmgType = 'phys';
  if (o.sure) cfg.hit = 100000;
  var dCfg = playerDefCfg(p);
  var res = resolveHit(m, p, cfg, dCfg);
  var pf = elitePF();
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
    blog('🛡️ ' + (m.name || '敵人') + ' 的【' + (o.label || '技能') + '】造成 ' + fmt(res.dmg) + ' 傷害。',
      'log-enemy-skill', 'combat');
  }
  return res;
}
function eliteApplyStatus(p, dCfg, res, o) {
  var pf = elitePF();
  var ccf = (dCfg.ccFactor === undefined) ? 1 : dCfg.ccFactor;
  if (o.stun > 0 && !resistCtrl(dCfg)) {
    var sd = applyEffect(p, 'stun', o.stun * ccf);
    if (sd) floatPlayerEvent(pf, o.freeze ? '冰凍!' : '眩暈!', 'debuff');
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

/* ---------------- 配技能 ---------------- */
var ELITE_TIER_NAME = { elite: '菁英', elite_adv: '高級菁英', boss: '野外BOSS', tower: '封魔塔BOSS' };
var ELITE_TIER_NPC_KEY = { elite: 'elite', elite_adv: 'elite_adv', boss: 'boss', tower: 'tower_boss' };
var ELITE_ELEM_COLOR = {
  fire: '#ff5a2a', ice: '#7fe0ff', lightning: '#c58cff', earth: '#c9a36a', poison: '#9be83a', dark: '#b05cff', light: '#ffe9a0', wind: '#8fe8c0'
};
/* 這個技能對「這一隻」有沒有意義：單獨一隻抽到火鏈、復仇是白抽。 */
function eliteSkillEligible(d, o) {
  if (!d) return false;
  if (d.needs === 'group' && !(o.group >= 2)) return false;
  if (d.noTower && o.tower) return false;
  if (d.minStage && o.stage < d.minStage) return false;
  if (d.minRange > 0 && o.atkRange > 0 && o.atkRange < d.minRange) return false;   // 例：迫擊最小射程 14 米，近戰怪永遠放不出來
  return true;
}
/* 依 NPC 表的設定替一隻敵人配技能。
   entry＝NPC 表那一列的資料（data.js 的 NPC pool 項目或 BOSS_LIST 項目；有 skills 欄位）。
   tier＝elite／elite_adv／boss／tower。
   回傳技能 id 陣列：專屬技能（一定有）＋隨機技能池抽出的 N 個（N 在表上的下限～上限之間，不重複）。
   entry 沒有 skills（舊測試替身、沒進 NPC 表的怪）：菁英抽 2 個、高級菁英抽 3 個，其餘沒有。 */
function eliteRollSkills(entry, tier, o) {
  o = o || {};
  if (typeof ELITE_AFFIXES === 'undefined') return [];
  var key = ELITE_TIER_NPC_KEY[tier] || tier;
  var cfg = null;
  if (entry && entry.skills) cfg = (tier === 'tower') ? entry.skills : (entry.skills[key] || null);
  if (!cfg && !(entry && entry.skills)) cfg = (tier === 'elite') ? { rnd: [2, 2] } : (tier === 'elite_adv' ? { rnd: [3, 3] } : null);
  var out = [];
  if (!cfg) return out;
  (cfg.ex || []).forEach(function (id) {
    if (ELITE_AFFIXES[id] && out.indexOf(id) < 0) out.push(id);
  });
  var rng = eliteRange(cfg.rnd, [0, 0]);
  var n = eliteRandInt(rng[0], rng[1]);
  if (n <= 0) return out;
  var pool = [];
  eliteSkillIds('random').forEach(function (id) {
    var d = ELITE_AFFIXES[id];
    if (out.indexOf(id) >= 0 || !eliteSkillEligible(d, o)) return;
    pool.push([id, d.w > 0 ? d.w : 10]);
  });
  while (n > 0 && pool.length) {
    var id2 = wpick(pool);
    pool = pool.filter(function (e) { return e[0] !== id2; });
    out.push(id2);
    n--;
  }
  return out;
}
/* 體型與光暈：由敵人類型決定（參數表「敵人體型倍率」）。 */
function eliteTierSize(tier, towerIdx, towerCount) {
  if (tier === 'elite') return eliteG('sizeElite', 1.6);
  if (tier === 'elite_adv') return eliteG('sizeAdv', 2.2);
  if (tier === 'boss') return eliteG('sizeBoss', 3.4);
  var lo = 5, hi = 7;
  if (typeof ELITE_GROUP !== 'undefined' && Array.isArray(ELITE_GROUP.sizeTower)) { lo = Number(ELITE_GROUP.sizeTower[0]) || lo; hi = Number(ELITE_GROUP.sizeTower[1]) || hi; }
  var k = (towerCount > 1) ? Math.max(0, Math.min(1, towerIdx / (towerCount - 1))) : 0;
  return lo + (hi - lo) * k;
}
function eliteTierColor(tier, attr) {
  if (tier === 'elite') return '#7fb2ff';
  if (tier === 'elite_adv') return '#ffd23a';
  return ELITE_ELEM_COLOR[attr] || '#ff8a8a';
}
/* 把技能與體型裝到敵人身上：被動數值立即生效，主動技能排上第一次施放。
   o：{ tier, towerIdx, towerCount }（沒給 tier 就沿用敵人身上的 _tier，再沒有就當菁英） */
function eliteEquip(m, ids, o) {
  o = o || {};
  ids = ids || [];
  m.affixes = ids.slice();
  var firstMax = Math.max(0.5, eliteG('firstCastMax', 3.5));
  var rt = {
    cd: {}, busyUntil: 0, summoned: 0, rageMult: 1, sacMult: 1, atkUntil: 0, invulnUntil: 0, lastImmuneAt: -9,
    repoAt: GT + rnd(1.5, 3.5), pend: null, avStacks: 0, sparkAt: -9, trailX: null, trailY: null, orbs: 0
  };
  m._el = rt;
  m._fx = [];
  var tier = o.tier || m._tier || 'elite';
  m._tier = tier;
  var size = eliteTierSize(tier, o.towerIdx || 0, o.towerCount || 1);
  m._size = size;
  m._bodyR = (typeof bfBodyRadius === 'function' ? bfBodyRadius() : 20) * size;
  m._elColor = eliteTierColor(tier, m.attr);
  ids.forEach(function (id) {
    var d = eliteDef(id);
    if (!d) return;
    if (d.kind === 'active') rt.cd[id] = Math.max(0.8, rnd(0.6, firstMax));
    if (d.arch === 'regen') rt.cd[id] = Math.max(0.5, d.every || 2);
    if (d.arch === 'haste') {
      m.aspd = (Number(m.aspd) || 1) * d.aspd;
      m.runSpeed = ((Number(m.runSpeed) > 0) ? Number(m.runSpeed) : (typeof bfEnemySpeed === 'function' ? bfEnemySpeed() : 210)) * d.run;
    }
    if (d.arch === 'vital') { m.maxHp *= d.hp; m.hp = m.maxHp; }
  });
  return m;
}
/* 這種敵人會不會「跑位」：菁英以上都會；小兵、召喚物、分裂體不會。 */
function eliteMoves(m) { return !!(m && m._tier && m._el); }

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
  var list = eliteEnemies();
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (!e || e._gid !== m._gid) continue;
    if (aliveOnly && !(e.hp > 0)) continue;
    out.push(e);
  }
  if (!out.length && m) out.push(m);
  return out;
}

/* ---------------- 跑位 ----------------
   菁英以上的敵人每隔 repoMin~repoMax 秒換一次位置。目標點以「換完之後仍然打得到玩家」為主：
   用「相對玩家的極座標」記（角度＋距離），所以玩家跑動時目標點會跟著走，不會跑到一個打不到人的地方。
   真正的移動在 js/battlefield.js bfTickApproach（讀 ent._rp）：這裡只決定去哪裡、什麼時候去。 */
function eliteRepoPick(m, mode, ref) {
  var pp = elitePos(), mp = eliteMonsterPos(m);
  if (!mp || typeof bfStopDistance !== 'function') return false;
  var stop = bfStopDistance(m);
  var cur = Math.atan2(mp.y - pp.y, mp.x - pp.x);
  var ang, dist;
  if (mode === 'through' && ref) {
    /* 火鏈：站到「夥伴 → 玩家」連線延伸出去的那一側，鏈條就會掃過玩家身上 */
    ang = Math.atan2(pp.y - ref.y, pp.x - ref.x);
    dist = Math.max(30, stop * 0.9);
  } else {
    var turn = (Math.PI / 3 + Math.random() * Math.PI * 2 / 3) * (Math.random() < 0.5 ? -1 : 1);
    ang = cur + turn;
    dist = Math.max(30, stop * (0.82 + Math.random() * 0.16));
  }
  m._rp = { ang: ang, dist: dist, t0: GT };
  m._rpDone = false;
  m._el.repoAt = Infinity;       // 到了才排下一次
  return true;
}
function eliteRepoTick(m) {
  var rt = m._el;
  if (m._rp && GT - m._rp.t0 > 6) { m._rp = null; m._rpDone = true; }     // 走不到（被擠住）就放棄
  if (m._rpDone) {
    m._rpDone = false;
    rt.repoAt = GT + rnd(Math.max(0.5, eliteG('repoMin', 4)), Math.max(eliteG('repoMin', 4), eliteG('repoMax', 8)));
  }
  if (m._rp || rt.pend || !(GT >= rt.repoAt) || !elitePlayerAlive()) return;
  eliteRepoPick(m, 'random');
}

/* ---------------- 主迴圈 ---------------- */
/* 回傳 true＝玩家在這個 tick 被打死，呼叫端（fieldTick／towerTick）要結束本輪。 */
function eliteTick(dt) {
  var tower = eliteTowerOn();
  if (!tower && (typeof FIELD === 'undefined' || !FIELD.player)) return false;
  ELITE_RT.budget = ELITE_CASTS_PER_TICK;
  var list = eliteEnemies();
  /* 先處理延遲事件與場域，再讓各隻決定下一步。 */
  var jobs = ELITE_RT.jobs;
  ELITE_RT.jobs = [];
  for (var j = 0; j < jobs.length; j++) {
    if (jobs[j].at <= GT) eliteGuard('job', jobs[j].fn);
    else ELITE_RT.jobs.push(jobs[j]);
  }
  eliteGuard('zones', function () { eliteZonesTick(dt); });
  eliteGuard('chains', function () { eliteChainsTick(dt, list); });
  eliteGuard('beams', function () { eliteBeamsTick(dt); });
  eliteGuard('crosses', function () { eliteCrossesTick(dt); });
  eliteGuard('orbs', function () { eliteOrbsTick(dt); });
  eliteGuard('sparks', function () { eliteSparksTick(dt); });
  eliteGuard('walls', function () { eliteWallsTick(dt); });
  eliteGuard('pull', function () { elitePullTick(dt); });
  eliteVisTick();
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    if (!m || !m.affixes || !(m.hp > 0)) continue;
    eliteGuard('skill', function () { eliteTickOne(m, dt); });
  }
  /* 生命鏈結分攤、反震等可能在傷害管線裡把別隻打到 0 血，這裡統一補結算（野外；塔戰由 towerTick 判定 BOSS 死亡）。 */
  if (!tower && typeof onFieldDeaths === 'function') {
    var pending = false;
    for (var k = 0; k < list.length; k++) if (list[k] && list[k].hp <= 0 && !list[k]._rewarded) { pending = true; break; }
    if (pending) onFieldDeaths();
  }
  var p = elitePlayer();
  if (p && p.hp <= 0 && (tower || !(FIELD.reviveCd > 0))) {
    if (!tower) onPlayerFieldDeath();
    return true;
  }
  return false;
}

function eliteTickOne(m, dt) {
  var rt = m._el;
  if (!rt) return;
  var fx = [];
  if (m.shield > 0.5) fx.push('shield');
  if (rt.invulnUntil > GT) fx.push('invuln');
  if (rt.enraged) fx.push('enrage');
  if (rt.atkUntil > GT || rt.avStacks > 0) fx.push('rage');
  if (fx.join() !== (m._fx || []).join()) m._fx = fx;
  if (rt.atkUntil && rt.atkUntil <= GT) { rt.sacMult = 1; rt.atkUntil = 0; }
  if (!eliteReady(m)) return;
  var acting = !ccActionLocked(m);
  if (acting && !eliteLocked(m)) eliteRepoTick(m);
  /* 先跑位再施放：跑位技能已經在路上，到了（或超時）才放出來 */
  if (rt.pend && acting && (!m._rp || GT >= rt.pend.until)) {
    var pd = eliteDef(rt.pend.id);
    var pid = rt.pend.id;
    rt.pend = null;
    if (pd && ELITE_RT.budget > 0 && elitePlayerAlive() && eliteCanCast(m, pd)) {
      ELITE_RT.budget--;
      rt.cd[pid] = eliteRollCd(pd);
      eliteCast(m, pd, pid);
    } else rt.cd[pid] = 0.6;
  }
  for (var i = 0; i < m.affixes.length; i++) {
    var id = m.affixes[i];
    var d = eliteDef(id);
    if (!d) continue;
    if (d.arch === 'regen') { eliteRegenTick(m, d, rt, dt, id); continue; }
    if (d.arch === 'molten') { if (acting) eliteTrailTick(m, d, rt, dt); continue; }
    if (d.kind !== 'active') continue;
    if (rt.pend && rt.pend.id === id) continue;
    rt.cd[id] = (rt.cd[id] || 0) - dt;
    if (rt.cd[id] > 0 || !acting) continue;
    if (rt.busyUntil > GT || ELITE_RT.budget <= 0 || !elitePlayerAlive()) continue;
    if (!eliteCanCast(m, d)) { rt.cd[id] = 0.6; continue; }
    if (d.repo && !rt.pend && !m._rp) {
      /* 要跑位的技能：先開始跑位，到位後才施放（見上面） */
      var ref = null;
      if (d.arch === 'chain') { var pr = eliteChainPartner(m); ref = pr ? eliteMonsterPos(pr) : null; }
      if (eliteRepoPick(m, ref ? 'through' : 'random', ref)) { rt.pend = { id: id, until: GT + 2.6 }; continue; }
    }
    if (d.repo) { rt.cd[id] = 0.4; continue; }
    ELITE_RT.budget--;
    rt.cd[id] = eliteRollCd(d);
    eliteCast(m, d, id);
  }
}
function eliteRollCd(d) {
  return rnd(d.cd[0], Math.max(d.cd[0], d.cd[1])) * eliteCdScale();
}

/* 施放前提：有些技能要有同伴或有空間才有意義。 */
function eliteCanCast(m, d) {
  switch (d.arch) {
    case 'bloodsac': return eliteGroupMembers(m, true).some(function (e) { return e !== m && !e.elite && e.hp > 0; });
    case 'summon':
      if (eliteTowerOn()) return false;
      if ((m._el.summoned || 0) >= Math.max(0, Math.floor(eliteG('summonCap', 10)))) return false;
      return typeof bfFreeCellCount !== 'function' || bfFreeCellCount(liveFieldEnemies()) > 2;
    case 'heal': return eliteGroupMembers(m, true).some(function (e) { return e.hp < e.maxHp * 0.95; });
    case 'invuln': return eliteGroupMembers(m, true).length >= 2;
    case 'immune': return !(m._el.invulnUntil > GT);
    case 'zone': return ELITE_RT.zones.length < Math.max(1, Math.floor(eliteG('maxZones', 48)));
    case 'puddle': return ELITE_RT.zones.length < Math.max(1, Math.floor(eliteG('maxZones', 48)));
    case 'icepulse': return (m._el.orbs || 0) < Math.max(1, d.maxActive || 1);
    case 'mortar': {
      var mp = eliteMonsterPos(m);
      return !!mp && eliteDist(mp.x, mp.y, elitePos().x, elitePos().y) >= (d.minRange || 0);
    }
    case 'chain': return !!eliteChainPartner(m);
    case 'sparks': return false;
    default: return true;
  }
}

function eliteAnnounce(m, d) {
  floatEnemyEvent(m, 'mv-float', d.emoji + d.name, 'elite-cast');
  if (typeof blog === 'function') blog('⚠️ ' + (m.name || '敵人') + ' 施放【' + d.emoji + d.name + '】', 'log-enemy-skill', 'combat');
  eliteCastFx(m, d);
}
/* 施法期間牠站著不動也不普攻（讓預警與動作對得起來）。 */
function eliteBusy(m, sec, lockMove) {
  var rt = m._el;
  rt.busyUntil = GT + sec;
  if (lockMove) m._elLockUntil = GT + sec;
}

/* 行為原型 → 施放函式。主動技能的 arch 必須在這裡有對應；常駐／被動的 arch 列在 ELITE_PASSIVE_ARCHS。
   新增原型時兩邊擇一登記，tests/elite-data.test.cjs 會逐一核對每個技能都接得上。 */
var ELITE_CASTERS = {
  spots: eliteCastSpots, spot: eliteCastSpot, zone: eliteCastZone, volley: eliteCastVolley,
  bolt: eliteCastBolt, dash: eliteCastDash, spin: eliteCastSpin,
  invuln: eliteCastInvuln, heal: eliteCastHeal, bloodsac: eliteCastBloodsac, curse: eliteCastCurse, drain: eliteCastDrain,
  chain: eliteCastChain, rotbeam: eliteCastRotbeam, puddle: eliteCastPuddle, cross: eliteCastCross, crystals: eliteCastCrystals,
  icepulse: eliteCastIcepulse, mortar: eliteCastMortar, walls: eliteCastWalls, pull: eliteCastPull, immune: eliteCastImmune,
  summon: eliteCastSummon, missiles: eliteCastMissiles
};
var ELITE_PASSIVE_ARCHS = ['regen', 'haste', 'enrage', 'vampiric', 'knockback', 'lifelink', 'phoenix', 'bomber', 'splitter',
  'molten', 'sparks', 'vital', 'avenger'];

function eliteCast(m, d, id) {
  var fn = ELITE_CASTERS[d.arch];
  if (!fn) return;
  eliteAnnounce(m, d);
  fn(m, d);
}

/* ============ 範圍落點：隕石雨、雷霆風暴 ============
   畫面角色：地板特效＝落點預警；飛行子彈＝落下的本體；攻擊特效＝爆發；觸發特效＝第二層（雷霆風暴的落雷）；受擊特效＝打中玩家 */
function eliteCastSpots(m, d) {
  var pp = elitePos();
  var rng = eliteRange(d.n, [3, 3]);
  var n = eliteRandInt(rng[0], rng[1]);
  var total = d.warn + (n - 1) * d.step;
  eliteBusy(m, Math.min(total, 2.2), false);
  for (var i = 0; i < n; i++) {
    var ang = Math.random() * Math.PI * 2;
    var dist = (i === 0) ? 0 : Math.sqrt(Math.random()) * d.spread;   // 第一發直接落在你腳下，逼你移動
    var x = pp.x + Math.cos(ang) * dist, y = pp.y + Math.sin(ang) * dist;
    var warn = d.warn + i * d.step;
    eliteWarn(x, y, d.r, d.v.ground, warn, 'spot');
    if (d.v.proj) {
      var travel = Math.min(0.75, warn);
      eliteFx({
        fxKind: 'rain', variant: 'elite-rain', elem: d.elem || null, count: 1, dur: travel, hit: false,
        delayMs: Math.round(Math.max(0, warn - travel) * 1000), travelMs: [Math.round(travel * 1000)],
        lineWidth: d.bodyD, area: { x: x, y: y, fixedLanding: true }, vfx: { projectile: d.v.proj }
      });
    }
    if (d.v.attack2) {
      eliteFx({
        fxKind: 'rain', variant: 'heaven-tribulation-strike', elem: d.elem || null, count: 1, dur: 0.5, hit: false,
        delayMs: Math.round(warn * 1000), area: { x: x, y: y, r: d.r }, vfx: { attack: d.v.attack2 }
      });
    }
    (function (px, py) {
      eliteLater(warn, function () { eliteSpotImpact(m, d, px, py, d.r, d.dmg); });
    })(x, y);
  }
}
function eliteSpotImpact(m, d, x, y, r, dmgMult) {
  var scale = d.burstScale || 1.15;
  eliteBurstFx(x, y, r * scale, d.v.attack, 0, d.elem);
  if (d.v.attack2 && d.arch === 'spot') eliteBurstFx(x, y, r * scale, d.v.attack2, 0.08, d.elem);
  if (!eliteInCircle(x, y, r)) return;
  var res = eliteHitPlayer(m, {
    mult: dmgMult, elem: d.elem, phys: !d.elem, sure: true, dot: d.dot, stun: d.stun, slow: d.slow,
    label: d.name, push: d.push, from: { x: x, y: y }
  });
  if (res && !res.miss && !res.invuln && d.v.hit) eliteHitFx(elitePF(), d.v.hit);
}

/* ============ 單點：熔岩爆裂、冰霜新星、地裂、石化凝視、震地衝擊 ============ */
function eliteCastSpot(m, d) {
  var pp = elitePos();
  var mp = eliteMonsterPos(m) || pp;
  var x = d.at === 'self' ? mp.x : pp.x;
  var y = d.at === 'self' ? mp.y : pp.y;
  eliteBusy(m, d.warn + 0.25, d.at === 'self');
  eliteWarn(x, y, d.r, d.v.ground, d.warn, 'spot');
  eliteLater(d.warn, function () {
    if (d.at === 'self' && !(m.hp > 0)) return;
    eliteSpotImpact(m, d, x, y, d.r, d.dmg);
  });
}

/* ============ 場域：暴風雪、褻瀆領域、龍捲、雷光球、電磁牆、水牢 ============
   畫面角色：地板特效＝預警；持續場域特效＝場域本體 */
function eliteCastZone(m, d) {
  var pp = elitePos();
  var mp = eliteMonsterPos(m) || pp;
  var x, y, a = 0;
  var dirx = pp.x - mp.x, diry = pp.y - mp.y;
  if (d.at === 'self') { x = mp.x; y = mp.y; }
  else if (d.at === 'ahead') { x = mp.x + dirx * 0.55; y = mp.y + diry * 0.55; }
  else { x = pp.x; y = pp.y; }
  var rect = !!(d.w2 > 0 && d.h2 > 0);
  if (rect) a = Math.atan2(diry, dirx) + Math.PI / 2;     // 牆與你的來向垂直
  var warn = d.warn || 0;
  if (warn > 0) {
    eliteBusy(m, warn + 0.2, false);
    if (rect) {
      /* 長條形場域：兩端各亮一個圈，預告「這一條」會燒起來。 */
      var ex = Math.cos(a) * d.w2 / 2, ey = Math.sin(a) * d.w2 / 2;
      var er = Math.max(30, d.h2 * 0.75);
      eliteWarn(x + ex, y + ey, er, d.v.ground, warn, 'wall');
      eliteWarn(x - ex, y - ey, er, d.v.ground, warn, 'wall');
      eliteWarn(x, y, er, d.v.ground, warn, 'wall');
    } else {
      eliteWarn(x, y, d.r, d.v.ground, warn, 'zone');
    }
  } else {
    eliteBusy(m, d.busy || 0.6, false);
  }
  eliteLater(warn, function () {
    if (ELITE_RT.zones.length >= Math.max(1, Math.floor(eliteG('maxZones', 48)))) return;
    eliteZoneSpawn(m, d, x, y, a);
  });
}
function eliteZoneSpawn(m, d, x, y, a) {
  var rect = !!(d.w2 > 0 && d.h2 > 0);
  var z = {
    owner: m, def: d, x: x, y: y, a: a, until: GT + d.life, nextTick: d.tick * 0.5,
    r: d.r || 0, w: rect ? d.w2 : 0, h: rect ? d.h2 : 0
  };
  z.vis = eliteVisAdd({
    id: eliteVisId('zone'), preset: d.v.field, x: x, y: y, r: d.r, w: z.w, h: z.h, a: a, until: z.until, curtain: !!d.curtain
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
/* 熔火：移動時每隔一段距離留下一塊熔岩火徑。 */
function eliteTrailTick(m, d, rt, dt) {
  var mp = eliteMonsterPos(m);
  if (!mp) return;
  if (rt.trailX === null) { rt.trailX = mp.x; rt.trailY = mp.y; return; }
  if (eliteDist(mp.x, mp.y, rt.trailX, rt.trailY) < Math.max(8, d.trailGap || 30)) return;
  rt.trailX = mp.x; rt.trailY = mp.y;
  if (ELITE_RT.zones.length >= Math.max(1, Math.floor(eliteG('maxZones', 48)))) return;
  eliteZoneSpawn(m, d, mp.x, mp.y, 0);
}
/* 熔火：死亡時原地留下熔岩核心，coreDelay 秒後引發大範圍自爆。 */
function eliteMoltenCore(m, d) {
  var mp = eliteMonsterPos(m);
  if (!mp) return;
  var x = mp.x, y = mp.y, delay = d.coreDelay || 3, r = d.coreR || 90;
  eliteWarn(x, y, r, d.v.ground, delay, 'core');
  floatEnemyEvent(m, 'mv-float', d.emoji + '熔岩核心!', 'elite-cast');
  eliteLater(delay, function () {
    eliteBurstFx(x, y, r * 1.1, d.v.attack, 0, d.elem);
    if (eliteInCircle(x, y, r)) {
      var res = eliteHitPlayer(m, { mult: d.coreDmg || 3, elem: d.elem, sure: true, dot: d.dot, label: d.name + '核心' });
      if (res && !res.miss && !res.invuln && d.v.hit) eliteHitFx(elitePF(), d.v.hit);
    }
  });
}

/* ============ 瘟疫：在腳下留一大片毒水窪 ============ */
function eliteCastPuddle(m, d) {
  var mp = eliteMonsterPos(m);
  eliteBusy(m, 0.5, false);
  if (!mp || ELITE_RT.zones.length >= Math.max(1, Math.floor(eliteG('maxZones', 48)))) return;
  eliteZoneSpawn(m, d, mp.x, mp.y, 0);
}

/* ============ 彈體：暗影彈幕、劇毒吐息、冰錐齊射、烈焰火球、旋風刃、閃電矛 ============
   畫面角色：飛行子彈＝彈體；受擊特效＝打中玩家；攻擊特效＝落點爆發 */
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
          sourceId: m.floatSel, targets: [elitePF()], travelMs: [Math.round(d.travel * 1000)],
          lineWidth: d.bodyD, vfx: { projectile: d.v.proj }
        });
        eliteLater(d.travel, function () {
          if (d.v.attack) eliteBurstFx(tx, ty, d.burstR || 70, d.v.attack, 0, d.elem);
          if (!eliteInCircle(tx, ty, d.hitR)) return;
          var res = eliteHitPlayer(m, {
            mult: d.dmg, elem: d.elem, dot: d.dot, stun: d.stun, slow: d.slow, label: d.name,
            quiet: index > 0, sure: false
          });
          if (res && !res.miss && !res.invuln) eliteHitFx(elitePF(), d.v.hit);
        });
      });
    })(i);
  }
}

/* ============ 連鎖閃電：一道電弧直接連到你身上 ============
   畫面走顯示層既有的 lightning-chain（與新版技能【連鎖閃電】同一種 chain 事件）：起點是這隻敵人、終點是你，
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
        targets: [m.floatSel, elitePF()], travelMs: [0, travelMs], preserveDeadTargets: true,
        lineLength: (typeof bfMeterPx === 'function') ? bfMeterPx(18) : 180,
        area: { sourceX: mp.x, sourceY: mp.y, x: pp.x, y: pp.y, chainId: chainId, homingSpeed: ELITE_CHAIN_SPEED },
        vfx: { projectile: d.v.proj, hit: d.v.hit }
      });
      eliteLater(travelMs / 1000 + 0.15, function () {
        eliteFx({ fxKind: 'chain', variant: 'lightning-chain-end', hit: false, vfx: {}, area: { chainId: chainId } });
      });
    }
    eliteHitPlayer(m, { mult: d.dmg, elem: d.elem, label: d.name, stun: d.stun });
  });
}

/* ============ 位移：衝鋒 ============ */
function eliteCastDash(m, d) {
  var pp = elitePos();
  var tx = pp.x, ty = pp.y;
  eliteBusy(m, d.warn + 1.2, true);
  eliteWarn(tx, ty, d.hitR, d.v.ground, d.warn, 'dash');
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
    eliteBurstFx(mp.x, mp.y, 55, d.v.attack, 0);
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
        eliteHitFx(elitePF(), d.v.hit);
        eliteBurstFx(mp2.x, mp2.y, 60, d.v.attack, 0);
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

/* ============ 旋風斬：原地連續橫掃 ============ */
function eliteCastSpin(m, d) {
  var mp = eliteMonsterPos(m);
  if (!mp) return;
  var total = d.warn + d.ticks * d.gap;
  eliteBusy(m, total + 0.2, true);
  eliteWarn(mp.x, mp.y, d.r, d.v.ground, d.warn, 'spin');
  for (var i = 0; i < d.ticks; i++) {
    eliteLater(d.warn + i * d.gap, function () {
      if (!(m.hp > 0)) return;
      var pos = eliteMonsterPos(m) || mp;
      eliteBurstFx(pos.x, pos.y, d.r, d.v.attack, 0);
      if (eliteInCircle(pos.x, pos.y, d.r)) {
        eliteHitPlayer(m, { mult: d.dmg, phys: true, sure: true, label: d.name, quiet: true });
      }
    });
  }
}

/* ============ 支援與干擾 ============ */
function eliteCastInvuln(m, d) {
  eliteBusy(m, d.busy, false);
  var members = eliteGroupMembers(m, true);
  members.forEach(function (e) {
    if (!e._el) return;
    e._el.invulnUntil = GT + d.dur;
    var ep = eliteMonsterPos(e);
    if (ep) eliteBurstFx(ep.x, ep.y, 55 * (d.vfxScale || 1), d.v.attack, 0);
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
      targets: ids.slice(0, 8), vfx: { attack: d.v.attack }
    });
  }
}
function eliteCastBloodsac(m, d) {
  eliteBusy(m, d.busy, false);
  var victims = eliteGroupMembers(m, true).filter(function (e) { return e !== m && !e.elite && e.hp > 0; });
  if (!victims.length) return;
  var v = victims[Math.floor(Math.random() * victims.length)];
  var vp = eliteMonsterPos(v);
  if (vp) eliteBurstFx(vp.x, vp.y, 60, d.v.attack, 0);
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
  if (mp) eliteBurstFx(mp.x, mp.y, 70, d.v.attack, 0.1);
}
function eliteCastCurse(m, d) {
  eliteBusy(m, d.busy, false);
  eliteLater(0.3, function () {
    if (!(m.hp > 0) || !elitePlayerAlive()) return;
    eliteHitFx(elitePF(), d.v.hit);
    eliteHitPlayer(m, {
      mult: d.dmg, elem: d.elem, sure: true, atkDown: d.atkDown, defDown: d.defDown, dur: d.dur, label: d.name
    });
    floatPlayerEvent(elitePF(), '詛咒!', 'debuff');
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
      sourceId: elitePF(), targets: [m.floatSel], travelMs: [550], lineWidth: d.bodyD, vfx: { projectile: d.v.proj }
    });
    if (take > 0) floatPlayerEvent(elitePF(), '-' + fmt(take) + ' 法力', 'debuff');
    var heal = m.maxHp * d.heal / 100;
    m.hp = Math.min(m.maxHp, m.hp + heal);
    eliteHitPlayer(m, { mult: d.dmg, elem: d.elem, sure: true, label: d.name, quiet: true });
  });
}
/* 護盾：金色球形光罩，持續期間完全免疫傷害。 */
function eliteCastImmune(m, d) {
  eliteBusy(m, 0.6, false);
  m._el.invulnUntil = GT + d.dur;
  if (m.floatSel && d.v.field) {
    eliteFx({
      fxKind: 'impact', variant: 'elite-dome', count: 1, dur: d.dur, targets: [m.floatSel], vfx: { hit: d.v.field }
    });
  }
}

/* ============ 常駐：再生 ============ */
function eliteRegenTick(m, d, rt, dt, id) {
  rt.cd[id] = (rt.cd[id] === undefined ? (d.every || 2) : rt.cd[id]) - dt;
  if (rt.cd[id] > 0) return;
  rt.cd[id] = d.every || 2;
  if (m.hp >= m.maxHp) return;
  var add = m.maxHp * d.pct / 100;
  var before = m.hp;
  m.hp = Math.min(m.maxHp, m.hp + add);
  floatEnemyEvent(m, 'mv-float', '+' + fmt(m.hp - before), 'elite-heal');
  var mp = eliteMonsterPos(m);
  if (mp) eliteBurstFx(mp.x, mp.y, 46, d.v.attack, 0);
}

/* ============ 火鏈：同群夥伴之間拉出一條火鏈，持續到怪物死亡 ============
   鏈條本身是常駐的（eliteChainsTick 維護）；「施放」＝跑位到玩家另一側，讓鏈條掃過你身上。
   畫面角色：持續場域特效＝鏈條本體（矩形，長度＝兩端距離）；施放特效＝施法者身上；受擊特效＝打中玩家 */
function eliteChainPartner(m) {
  var mem = eliteGroupMembers(m, true);
  if (mem.length < 2) return null;
  var idx = mem.indexOf(m);
  if (idx < 0) return null;
  for (var k = 1; k < mem.length; k++) {
    var e = mem[(idx + k) % mem.length];
    if (e !== m && e.hp > 0 && eliteMonsterPos(e)) return e;
  }
  return null;
}
function eliteCastChain(m, d) {
  eliteBusy(m, 0.2, false);
}
function eliteChainsTick(dt, list) {
  var want = {};
  var player = elitePlayerAlive();
  var pp = elitePos();
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    if (!m || !(m.hp > 0)) continue;
    var d = eliteArch(m, 'chain');
    if (!d || !eliteReady(m)) continue;
    var other = eliteChainPartner(m);
    if (!other) continue;
    var key = [m.floatSel, other.floatSel].sort().join('|');
    if (want[key]) continue;
    want[key] = { a: m, b: other, d: d };
  }
  var keep = [];
  ELITE_RT.chains.forEach(function (c) {
    if (want[c.key]) { c.a = want[c.key].a; c.b = want[c.key].b; c.d = want[c.key].d; delete want[c.key]; keep.push(c); }
    else if (c.vis) c.vis.until = 0;
  });
  Object.keys(want).forEach(function (key) {
    var w = want[key];
    var c = { key: key, a: w.a, b: w.b, d: w.d, nextTick: 0, vis: null };
    c.vis = { id: eliteVisId('chain'), preset: w.d.v.field, x: 0, y: 0, w: 1, h: 1, a: 0, until: Infinity, every: 0.12, next: 0 };
    c.vis.until = GT + 9999;
    ELITE_RT.vis.push(c.vis);
    keep.push(c);
  });
  ELITE_RT.chains = keep;
  keep.forEach(function (c) {
    var ap = eliteMonsterPos(c.a), bp = eliteMonsterPos(c.b);
    if (!ap || !bp) return;
    var len = Math.max(20, eliteDist(ap.x, ap.y, bp.x, bp.y));
    c.vis.x = (ap.x + bp.x) / 2; c.vis.y = (ap.y + bp.y) / 2;
    c.vis.w = len; c.vis.h = Math.max(24, c.d.wid * 2.2);
    c.vis.a = Math.atan2(bp.y - ap.y, bp.x - ap.x);
    c.nextTick -= dt;
    if (c.nextTick > 0 || !player) return;
    c.nextTick = c.d.tick || 0.25;
    if (eliteSegmentDist(ap.x, ap.y, bp.x, bp.y, pp.x, pp.y) <= c.d.wid / 2 + ELITE_PLAYER_BODY_R) {
      var res = eliteHitPlayer(c.a, { mult: c.d.dmg, elem: c.d.elem, sure: true, quiet: true, label: c.d.name });
      if (res && !res.miss && !res.invuln && c.d.v.hit) eliteHitFx(elitePF(), c.d.v.hit);
    }
  });
}

/* ============ 秘法加持：丟出秘法棒，核心伸出順時針旋轉的光束 ============
   光束數量 arms[下限,上限]；轉速 rot（度／秒）與 Preset 的旋轉曲線同值（模擬層與畫面同一組公式）。
   畫面角色：地板特效＝核心；持續場域特效＝1 根光束的旋轉 Preset；觸發持續場域特效＝2 根 */
function eliteCastRotbeam(m, d) {
  var pp = elitePos();
  var ang = Math.random() * Math.PI * 2;
  var rr = Math.sqrt(Math.random()) * (d.throwRange || 180);
  var cx = pp.x + Math.cos(ang) * rr, cy = pp.y + Math.sin(ang) * rr;
  var rng = eliteRange(d.arms, [1, 2]);
  var arms = eliteRandInt(rng[0], rng[1]);
  var warn = d.warn || 1, dur = d.dur || 6;
  eliteBusy(m, 0.6, false);
  var core = eliteVisAdd({ id: eliteVisId('arcane'), preset: d.v.ground, x: cx, y: cy, r: 19.5, until: GT + warn + dur });
  eliteLater(warn, function () {
    var b = { owner: m, def: d, x: cx, y: cy, t0: GT, until: GT + dur, arms: arms, nextTick: 0, core: core };
    b.vis = eliteVisAdd({ id: eliteVisId('beam'), preset: d.v.field, x: cx, y: cy, r: d.len, until: b.until });
    ELITE_RT.beams.push(b);
  });
}
function eliteBeamsTick(dt) {
  if (!ELITE_RT.beams.length) return;
  var keep = [];
  var pp = elitePos();
  var player = elitePlayerAlive();
  for (var i = 0; i < ELITE_RT.beams.length; i++) {
    var b = ELITE_RT.beams[i];
    if (GT >= b.until) { if (b.vis) b.vis.until = 0; if (b.core) b.core.until = 0; continue; }
    keep.push(b);
    b.nextTick -= dt;
    if (b.nextTick > 0 || !player) continue;
    b.nextTick = b.def.tick || 0.2;
    var t = GT - b.t0;
    var turn = (b.def.rot || 50) * Math.PI / 180 * t;
    for (var k = 0; k < b.arms; k++) {
      var th = k * 2 * Math.PI / b.arms + turn;
      var ex = b.x + Math.cos(th) * b.def.len, ey = b.y + Math.sin(th) * b.def.len;
      if (eliteSegmentDist(b.x, b.y, ex, ey, pp.x, pp.y) <= b.def.wid / 2 + ELITE_PLAYER_BODY_R) {
        var res = eliteHitPlayer(b.owner, { mult: b.def.dmg, elem: b.def.elem, sure: true, quiet: true, label: b.def.name });
        if (res && !res.miss && !res.invuln && b.def.v.hit) eliteHitFx(elitePF(), b.def.v.hit);
        break;
      }
    }
  }
  ELITE_RT.beams = keep;
}

/* ============ 毒素加持：毒水球排成的十字軌道，緩慢旋轉並向外擴散 ============
   第 i 顆距離 ＝ (i+1)×ballGap×f(t)；f(t)＝0.7＋0.8×t／dur；角度 ＝ 臂角＋rot×t；半徑 ＝ ballR×f(t)（與 Preset 同一組公式）。
   畫面角色：地板特效＝開頭的毒液圓點；持續場域特效＝十字本體 */
function eliteCastCross(m, d) {
  var pp = elitePos();
  var ang = Math.random() * Math.PI * 2;
  var rr = Math.sqrt(Math.random()) * (d.throwRange || 120);
  var cx = pp.x + Math.cos(ang) * rr, cy = pp.y + Math.sin(ang) * rr;
  var warn = d.warn || 0.9, dur = d.dur || 6;
  eliteBusy(m, 0.6, false);
  eliteWarn(cx, cy, 14, d.v.ground, warn, 'poisondot');
  eliteLater(warn, function () {
    var span = (d.balls || 4) * (d.ballGap || 22);
    var c = { owner: m, def: d, x: cx, y: cy, t0: GT, until: GT + dur, nextTick: 0 };
    c.vis = eliteVisAdd({ id: eliteVisId('cross'), preset: d.v.field, x: cx, y: cy, r: span, until: c.until });
    ELITE_RT.crosses.push(c);
  });
}
function eliteCrossesTick(dt) {
  if (!ELITE_RT.crosses.length) return;
  var keep = [];
  var pp = elitePos();
  var player = elitePlayerAlive();
  for (var i = 0; i < ELITE_RT.crosses.length; i++) {
    var c = ELITE_RT.crosses[i];
    if (GT >= c.until) { if (c.vis) c.vis.until = 0; continue; }
    keep.push(c);
    c.nextTick -= dt;
    if (c.nextTick > 0 || !player) continue;
    c.nextTick = c.def.tick || 0.25;
    var t = GT - c.t0, f = 0.7 + 0.8 * t / (c.def.dur || 6);
    var turn = (c.def.rot || 22) * Math.PI / 180 * t;
    var hit = false;
    for (var arm = 0; arm < 4 && !hit; arm++) {
      var th = arm * Math.PI / 2 + turn;
      for (var b = 0; b < (c.def.balls || 4); b++) {
        var dist = (b + 1) * (c.def.ballGap || 22) * f;
        var bx = c.x + Math.cos(th) * dist, by = c.y + Math.sin(th) * dist;
        if (eliteDist(pp.x, pp.y, bx, by) <= (c.def.ballR || 9) * f + ELITE_PLAYER_BODY_R) { hit = true; break; }
      }
    }
    if (hit) {
      var res = eliteHitPlayer(c.owner, { mult: c.def.dmg, elem: c.def.elem, sure: true, dot: c.def.dot, quiet: true, label: c.def.name });
      if (res && !res.miss && !res.invuln && c.def.v.hit) eliteHitFx(elitePF(), c.def.v.hit);
    }
  }
  ELITE_RT.crosses = keep;
}

/* ============ 冰爆：地面浮現膨脹的冰晶，2~3 秒後炸裂並把範圍內的你冰凍 ============ */
function eliteCastCrystals(m, d) {
  var pp = elitePos();
  var rng = eliteRange(d.n, [3, 5]);
  var n = eliteRandInt(rng[0], rng[1]);
  var grow = eliteRange(d.grow, [2.2, 2.8]);
  eliteBusy(m, 0.8, false);
  for (var i = 0; i < n; i++) {
    var ang = Math.random() * Math.PI * 2;
    var dist = (i === 0) ? 0 : Math.sqrt(Math.random()) * d.spread;     // 第一顆在你腳下，逼你移動
    var x = pp.x + Math.cos(ang) * dist, y = pp.y + Math.sin(ang) * dist;
    var life = grow[0] + Math.random() * Math.max(0, grow[1] - grow[0]);
    eliteWarn(x, y, d.r, d.v.ground, life, 'crystal');
    (function (px, py) {
      eliteLater(life, function () {
        eliteBurstFx(px, py, d.r * 1.15, d.v.attack, 0, d.elem);
        if (!eliteInCircle(px, py, d.r)) return;
        var res = eliteHitPlayer(m, { mult: d.dmg, elem: d.elem, sure: true, stun: d.freeze, freeze: true, label: d.name });
        if (res && !res.miss && !res.invuln && d.v.hit) eliteHitFx(elitePF(), d.v.hit);
      });
    })(x, y);
  }
}

/* ============ 冰凍脈衝：持續追著你飄的旋轉冰球，周圍定時釋放冰冷脈衝 ============ */
function eliteCastIcepulse(m, d) {
  var mp = eliteMonsterPos(m);
  if (!mp) return;
  eliteBusy(m, 0.5, false);
  var o = { owner: m, def: d, x: mp.x, y: mp.y, until: GT + (d.life || 8), nextPulse: GT + 0.5 };
  o.vis = { id: eliteVisId('icorb'), preset: d.v.field, x: o.x, y: o.y, r: 14, until: o.until, every: 0.12, next: 0 };
  ELITE_RT.vis.push(o.vis);
  m._el.orbs = (m._el.orbs || 0) + 1;
  ELITE_RT.orbs.push(o);
}
function eliteOrbsTick(dt) {
  if (!ELITE_RT.orbs.length) return;
  var keep = [];
  var pp = elitePos();
  var player = elitePlayerAlive();
  for (var i = 0; i < ELITE_RT.orbs.length; i++) {
    var o = ELITE_RT.orbs[i];
    if (GT >= o.until) { o.vis.until = 0; if (o.owner._el) o.owner._el.orbs = Math.max(0, (o.owner._el.orbs || 1) - 1); continue; }
    keep.push(o);
    if (player) {
      var dx = pp.x - o.x, dy = pp.y - o.y, dl = Math.sqrt(dx * dx + dy * dy);
      if (dl > 4) { var st = Math.min(dl, (o.def.move || 30) * dt); o.x += dx / dl * st; o.y += dy / dl * st; }
    }
    o.vis.x = o.x; o.vis.y = o.y;
    if (GT >= o.nextPulse && player) {
      o.nextPulse = GT + (o.def.pulse || 0.8);
      eliteBurstFx(o.x, o.y, o.def.r, o.def.v.attack, 0, o.def.elem);
      if (eliteInCircle(o.x, o.y, o.def.r)) {
        var res = eliteHitPlayer(o.owner, { mult: o.def.dmg, elem: o.def.elem, sure: true, slow: o.def.slow, quiet: true, label: o.def.name });
        if (res && !res.miss && !res.invuln && o.def.v.hit) eliteHitFx(elitePF(), o.def.v.hit);
      }
    }
  }
  ELITE_RT.orbs = keep;
}

/* ============ 迫擊：高角度拋射數顆火球，有最小射程 ============ */
function eliteCastMortar(m, d) {
  var mp = eliteMonsterPos(m), pp = elitePos();
  if (!mp) return;
  var rng = eliteRange(d.n, [3, 4]);
  var n = eliteRandInt(rng[0], rng[1]);
  eliteBusy(m, d.warn + (n - 1) * d.step + 0.3, false);
  for (var i = 0; i < n; i++) {
    var ang = Math.random() * Math.PI * 2;
    var dist = (i === 0) ? 0 : Math.sqrt(Math.random()) * d.spread;
    var x = pp.x + Math.cos(ang) * dist, y = pp.y + Math.sin(ang) * dist;
    var warn = d.warn + i * d.step;
    eliteWarn(x, y, d.r, d.v.ground, warn, 'mortar');
    eliteFlightFx(d.v.proj, mp.x, mp.y, x, y, Math.max(0.3, warn), { arcM: (d.arc || 60) / ELITE_METER, elem: d.elem, bodyD: d.bodyD });
    (function (px, py) {
      eliteLater(warn, function () {
        eliteBurstFx(px, py, d.r * 1.2, d.v.attack, 0, d.elem);
        if (!eliteInCircle(px, py, d.r)) return;
        var res = eliteHitPlayer(m, { mult: d.dmg, elem: d.elem, sure: true, label: d.name, quiet: i > 0 });
        if (res && !res.miss && !res.invuln && d.v.hit) eliteHitFx(elitePF(), d.v.hit);
      });
    })(x, y);
  }
}

/* ============ 築牆：在你周圍升起 U 型或平行排列的石牆 ============
   牆擋住「近戰」：雙方都不能隔著牆近戰攻擊（遠程不受影響），玩家也走不過牆（battlefield.js 呼叫 eliteWallBlocks／eliteClampMove）。 */
function eliteCastWalls(m, d) {
  var pp = elitePos(), mp = eliteMonsterPos(m) || pp;
  var ux = pp.x - mp.x, uy = pp.y - mp.y, ul = Math.sqrt(ux * ux + uy * uy) || 1;
  ux /= ul; uy /= ul;                         // 由怪物指向玩家
  var vx = -uy, vy = ux;                      // 垂直方向
  var len = d.len, thick = d.thick, off = d.dist, life = d.life, warn = d.warn || 0.8;
  var shape = Math.random() < 0.5 ? 'U' : 'parallel';
  var segs = [
    { x: pp.x + vx * off, y: pp.y + vy * off, a: Math.atan2(uy, ux), len: len },        // 左右兩面與怪物來向平行
    { x: pp.x - vx * off, y: pp.y - vy * off, a: Math.atan2(uy, ux), len: len }
  ];
  if (shape === 'U') {
    // 背面：缺口朝著怪物，把玩家關在裡面
    segs.push({ x: pp.x + ux * off, y: pp.y + uy * off, a: Math.atan2(vy, vx), len: off * 2 + thick });
  }
  eliteBusy(m, warn + 0.4, false);
  segs.forEach(function (s) {
    eliteVisAdd({ id: eliteVisId('wallwarn'), preset: d.v.ground, x: s.x, y: s.y, w: s.len, h: Math.max(thick * 2, 28), a: s.a, until: GT + warn });
  });
  eliteLater(warn, function () {
    segs.forEach(function (s) {
      var wall = { x: s.x, y: s.y, a: s.a, len: s.len, thick: thick, until: GT + life, owner: m, def: d };
      wall.vis = eliteVisAdd({ id: eliteVisId('wall'), preset: d.v.field, x: s.x, y: s.y, w: s.len, h: Math.max(thick * 2, 28), a: s.a, until: wall.until });
      ELITE_RT.walls.push(wall);
      eliteBurstFx(s.x, s.y, s.len * 0.55, d.v.attack, 0);
    });
    // 升牆時被牆壓到的玩家會被推出牆外（不傷人，免得卡進牆裡）
    eliteWallsPushOut();
  });
}
function eliteWallsTick(dt) {
  if (!ELITE_RT.walls.length) return;
  ELITE_RT.walls = ELITE_RT.walls.filter(function (w) {
    if (GT >= w.until) { if (w.vis) w.vis.until = 0; return false; }
    return true;
  });
}
/* 線段與牆（旋轉矩形，外擴 pad）相交嗎？ */
function eliteWallHit(w, ax, ay, bx, by, pad) {
  var c = Math.cos(-w.a), s = Math.sin(-w.a);
  var lax = (ax - w.x) * c - (ay - w.y) * s, lay = (ax - w.x) * s + (ay - w.y) * c;
  var lbx = (bx - w.x) * c - (by - w.y) * s, lby = (bx - w.x) * s + (by - w.y) * c;
  var hx = w.len / 2 + pad, hy = w.thick / 2 + pad;
  // slab 法：線段 [la, lb] 與軸對齊矩形 [-hx,hx]×[-hy,hy]
  var t0 = 0, t1 = 1, dx = lbx - lax, dy = lby - lay;
  var p = [-dx, dx, -dy, dy], q = [lax + hx, hx - lax, lay + hy, hy - lay];
  for (var i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; continue; }
    var r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
/* 兩點之間有沒有牆擋著（近戰判定用）。 */
function eliteWallBlocks(ax, ay, bx, by) {
  var ws = ELITE_RT.walls;
  for (var i = 0; i < ws.length; i++) if (eliteWallHit(ws[i], ax, ay, bx, by, 0)) return true;
  return false;
}
/* 玩家移動：新位置與舊位置之間穿過牆就留在原地。回傳 true＝被擋住。 */
function eliteClampMove(ox, oy, pos) {
  var ws = ELITE_RT.walls;
  for (var i = 0; i < ws.length; i++) {
    if (eliteWallHit(ws[i], ox, oy, pos.x, pos.y, ELITE_PLAYER_BODY_R * 0.6)) { pos.x = ox; pos.y = oy; return true; }
  }
  return false;
}
function eliteWallsPushOut() {
  var pp = elitePos();
  for (var i = 0; i < ELITE_RT.walls.length; i++) {
    var w = ELITE_RT.walls[i];
    if (!eliteWallHit(w, pp.x, pp.y, pp.x, pp.y, ELITE_PLAYER_BODY_R * 0.6)) continue;
    // 沿牆的法線方向推到牆外（往離玩家較近的那一側）
    var nx = -Math.sin(w.a), ny = Math.cos(w.a);
    var side = ((pp.x - w.x) * nx + (pp.y - w.y) * ny) >= 0 ? 1 : -1;
    var need = w.thick / 2 + ELITE_PLAYER_BODY_R * 0.6 + 2;
    var cur = Math.abs((pp.x - w.x) * nx + (pp.y - w.y) * ny);
    pp.x += nx * side * (need - cur); pp.y += ny * side * (need - cur);
  }
}

/* ============ 漩渦：把你快速拉扯到牠身邊 ============ */
function eliteCastPull(m, d) {
  var mp = eliteMonsterPos(m);
  if (!mp) return;
  eliteBusy(m, (d.windup || 0.9) + 0.9, true);
  var vis = eliteVisAdd({ id: eliteVisId('vortex'), preset: d.v.field, x: mp.x, y: mp.y, r: d.r, until: GT + (d.windup || 0.9) });
  eliteLater(d.windup || 0.9, function () {
    if (!(m.hp > 0) || !elitePlayerAlive()) return;
    var mp2 = eliteMonsterPos(m);
    if (!mp2) return;
    var pp = elitePos();
    var dist = eliteDist(pp.x, pp.y, mp2.x, mp2.y);
    if (dist > d.r + (m._bodyR || 20)) return;               // 不在漩渦範圍內：拉不到
    var stop = (m._bodyR || 20) + ELITE_PLAYER_BODY_R + 12;
    if (dist <= stop) { eliteHitPlayer(m, { mult: d.dmg, elem: d.elem, sure: true, stun: d.stun, label: d.name }); return; }
    var ux = (pp.x - mp2.x) / dist, uy = (pp.y - mp2.y) / dist;
    ELITE_RT.pull = { owner: m, def: d, tx: mp2.x + ux * stop, ty: mp2.y + uy * stop, speed: d.speed || 600 };
    floatPlayerEvent(elitePF(), '被拉扯!', 'debuff');
  });
}
function elitePullTick(dt) {
  var pl = ELITE_RT.pull;
  if (!pl) return;
  if (!elitePlayerAlive()) { ELITE_RT.pull = null; return; }
  var pp = elitePos();
  var dx = pl.tx - pp.x, dy = pl.ty - pp.y, dl = Math.sqrt(dx * dx + dy * dy);
  var step = pl.speed * dt;
  if (dl <= step + 1) {
    pp.x = pl.tx; pp.y = pl.ty;
    ELITE_RT.pull = null;
    var mp = eliteMonsterPos(pl.owner) || pp;
    eliteBurstFx(mp.x, mp.y, 70, pl.def.v.attack, 0, pl.def.elem);
    eliteHitPlayer(pl.owner, { mult: pl.def.dmg, elem: pl.def.elem, sure: true, stun: pl.def.stun, label: pl.def.name });
    return;
  }
  pp.x += dx / dl * step; pp.y += dy / dl * step;
}
/* 被拉扯中：玩家自己的走位暫停（battlefield.js bfTickPlayer 呼叫）。 */
function elitePlayerLocked() { return !!ELITE_RT.pull; }

/* ============ 召喚：召喚數隻與自己同屬性的普通怪 ============ */
function eliteCastSummon(m, d) {
  eliteBusy(m, d.busy || 1.2, false);
  var cap = Math.max(0, Math.floor(eliteG('summonCap', 10)));
  var rng = eliteRange(d.n, [2, 4]);
  var n = Math.min(eliteRandInt(rng[0], rng[1]), cap - (m._el.summoned || 0));
  if (n <= 0 || typeof spawnEliteSummons !== 'function') return;
  var made = spawnEliteSummons(m, n);
  m._el.summoned = (m._el.summoned || 0) + made.length;
  made.forEach(function (e) {
    var ep = eliteMonsterPos(e);
    if (ep) eliteBurstFx(ep.x, ep.y, 52, d.v.attack, 0);
  });
}

/* ============ 飛彈：祕法導彈先朝後方緩慢飛出，再轉彎加速衝向你 ============ */
function eliteCastMissiles(m, d) {
  var rng = eliteRange(d.n, [3, 5]);
  var n = eliteRandInt(rng[0], rng[1]);
  eliteBusy(m, 0.9 + n * 0.12, false);
  var presets = (d.presets && d.presets.length) ? d.presets : [d.v.proj];
  for (var i = 0; i < n; i++) {
    (function (index) {
      eliteLater(0.2 + index * 0.14, function () {
        if (!(m.hp > 0) || !elitePlayerAlive()) return;
        var mp = eliteMonsterPos(m), pp = elitePos();
        if (!mp) return;
        var preset = presets[Math.floor(Math.random() * presets.length)];
        var ax = mp.x - pp.x, ay = mp.y - pp.y, al = Math.sqrt(ax * ax + ay * ay) || 1;
        ax /= al; ay /= al;                                   // 玩家 → 怪物（往後方）
        var side = (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.55);
        var back = d.back || 32;
        var bx = mp.x + ax * back - ay * back * side, by = mp.y + ay * back + ax * back * side;
        var leg1 = d.leg1 || 0.55, leg2 = d.leg2 || 0.38;
        eliteFlightFx(preset, mp.x, mp.y, bx, by, leg1, { ctrl: { x: mp.x + ax * back * 0.5, y: mp.y + ay * back * 0.5 }, bodyD: d.bodyD });
        eliteLater(leg1, function () {
          if (!(m.hp > 0) || !elitePlayerAlive()) return;
          var tp = elitePos();
          var lx = tp.x, ly = tp.y;                           // 轉彎的當下鎖定落點：走位就躲得掉
          var mx = (bx + lx) / 2 - (ly - by) * 0.25 * side, my = (by + ly) / 2 + (lx - bx) * 0.25 * side;
          eliteFlightFx(preset, bx, by, lx, ly, leg2, { ctrl: { x: mx, y: my }, bodyD: d.bodyD });
          eliteLater(leg2, function () {
            eliteBurstFx(lx, ly, d.r * 1.3, d.v.attack, 0, d.elem);
            if (!eliteInCircle(lx, ly, d.r)) return;
            var res = eliteHitPlayer(m, { mult: d.dmg, elem: d.elem, sure: false, label: d.name, quiet: index > 0 });
            if (res && !res.miss && !res.invuln && d.v.hit) eliteHitFx(elitePF(), d.v.hit);
          });
        });
      });
    })(i);
  }
}

/* ============ 帶電：每次被打到就向四周散出電火花 ============ */
function eliteSparksOnHit(m, d) {
  var rt = m._el, mp = eliteMonsterPos(m);
  if (!rt || !mp || GT - rt.sparkAt < (d.gap || 0.35)) return;
  rt.sparkAt = GT;
  var rng = eliteRange(d.n, [2, 4]);
  var n = eliteRandInt(rng[0], rng[1]);
  var cap = Math.max(1, Math.floor(d.cap || 36));
  var life = d.life || 3.5, spd = d.speed || 80;
  for (var i = 0; i < n && ELITE_RT.sparks.length < cap; i++) {
    var ang = Math.random() * Math.PI * 2;
    var vx = Math.cos(ang) * spd, vy = Math.sin(ang) * spd;
    ELITE_RT.sparks.push({ owner: m, def: d, x: mp.x, y: mp.y, vx: vx, vy: vy, until: GT + life, r: d.r || 12 });
    eliteFlightFx(d.v.proj, mp.x, mp.y, mp.x + vx * life, mp.y + vy * life, life, { elem: d.elem, bodyD: d.bodyD });
  }
}
function eliteSparksTick(dt) {
  if (!ELITE_RT.sparks.length) return;
  var keep = [];
  var pp = elitePos();
  var player = elitePlayerAlive();
  for (var i = 0; i < ELITE_RT.sparks.length; i++) {
    var s = ELITE_RT.sparks[i];
    if (GT >= s.until) continue;
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (player && eliteDist(pp.x, pp.y, s.x, s.y) <= s.r + ELITE_PLAYER_BODY_R) {
      var res = eliteHitPlayer(s.owner, { mult: s.def.dmg, elem: s.def.elem, sure: false, label: s.def.name, quiet: true });
      if (res && !res.miss && !res.invuln && s.def.v.hit) eliteHitFx(elitePF(), s.def.v.hit);
      continue;               // 一顆火花只打一次
    }
    keep.push(s);
  }
  ELITE_RT.sparks = keep;
}

/* ============ 傷害管線：受到傷害 ============ */
/* 敵人受到傷害前的最終修正（resolveHit／applyEnemyHpDamage 呼叫）。 */
function eliteIncomingDamage(m, dmg, attacker) {
  var rt = m && m._el;
  if (!rt || !(dmg > 0)) return dmg;
  if (rt.invulnUntil > GT) {
    if (GT - rt.lastImmuneAt > 0.5) { rt.lastImmuneAt = GT; floatEnemyEvent(m, 'mv-float', '免疫', 'elite-cast'); }
    return 0;
  }
  var mult = 1;
  (m.affixes || []).forEach(function (id) {
    var d = eliteDef(id);
    if (d && d.arch === 'lifelink' && eliteLinkPartners(m).length) mult *= 1 - d.share / 100;
  });
  return Math.max(0, Math.round(dmg * mult));
}
function eliteLinkPartners(m) {
  return eliteGroupMembers(m, true).filter(function (e) { return e !== m && eliteArch(e, 'lifelink'); });
}
var ELITE_SHARING = false;
/* 敵人受傷後的反應。 */
function eliteOnDamaged(m, dealt, attacker) {
  var rt = m && m._el;
  if (!rt || !(dealt > 0)) return;
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
      if (mp) eliteBurstFx(mp.x, mp.y, 85, d.v.attack, 0);
      floatEnemyEvent(m, 'mv-float', d.emoji + '狂暴!', 'elite-cast');
      if (typeof blog === 'function') blog('😡 ' + (m.name || '敵人') + ' 進入狂暴！', 'log-enemy-skill', 'combat');
    } else if (d.arch === 'sparks') {
      eliteSparksOnHit(m, d);
    }
  }
}

/* ============ 傷害管線：這隻敵人打中玩家之後 ============ */
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
          sourceId: elitePF(), targets: [m.floatSel], travelMs: [500], vfx: { projectile: d.v.proj }
        });
      }
    } else if (d.arch === 'knockback' && chance(d.chance)) {
      var mp = eliteMonsterPos(m);
      if (mp) {
        elitePushPlayer(mp.x, mp.y, d.dist);
        eliteBurstFx(elitePos().x, elitePos().y, 55, d.v.attack, 0);
        floatPlayerEvent(elitePF(), '被擊飛!', 'debuff');
        var dCfg = playerDefCfg(p);
        if (d.stun > 0 && !resistCtrl(dCfg)) applyEffect(p, 'stun', d.stun * (dCfg.ccFactor === undefined ? 1 : dCfg.ccFactor));
      }
    }
  }
}
/* monsterAtkCfg 的攻擊倍率（狂暴、血祭、復仇）。 */
function eliteAtkFactor(m) {
  var rt = m && m._el;
  if (!rt) return 1;
  var av = 1;
  if (rt.avStacks > 0) { var da = eliteArch(m, 'avenger'); if (da) av = 1 + da.atk * rt.avStacks; }
  return (rt.rageMult > 0 ? rt.rageMult : 1) * (rt.atkUntil > GT && rt.sacMult > 0 ? rt.sacMult : 1) * av;
}

/* ============ 死亡 ============ */
/* 回傳 true＝牠沒有真的死（不死鳥重生），onFieldKill 直接結束、不給獎勵。 */
function eliteOnDeath(m) {
  if (!m) return false;
  /* 先通知同伴：復仇的存活者變強；召喚師死了，牠召喚的小怪最大生命縮水 */
  eliteOnAllyDeath(m);
  if (!m.affixes || !m._el) return false;
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
      if (mp) { eliteBurstFx(mp.x, mp.y, 110, d.v.attack, 0); }
      if (d.v.attack2) {
        eliteFx({
          fxKind: 'rain', variant: 'pillar', elem: 'light', count: 1, dur: 1, hit: false,
          targets: [m.floatSel], vfx: { attack: d.v.attack2 }
        });
      }
      floatEnemyEvent(m, 'mv-float', d.emoji + '浴火重生!', 'elite-cast');
      if (typeof blog === 'function') blog('🕊️ ' + (m.name || '敵人') + ' 浴火重生，帶著 ' + Math.round(d.hp) + '% 生命站了起來！', 'log-enemy-skill', 'combat');
      return true;
    }
  }
  /* 以下不阻止死亡，只在死後留下東西。 */
  for (var j = 0; j < m.affixes.length; j++) {
    var dd = eliteDef(m.affixes[j]);
    if (!dd) continue;
    if (dd.arch === 'bomber') eliteBomberArm(m, dd);
    else if (dd.arch === 'molten') eliteMoltenCore(m, dd);
    else if (dd.arch === 'splitter' && typeof spawnEliteSplits === 'function') {
      var kids = spawnEliteSplits(m, dd);
      kids.forEach(function (e) {
        var ep = eliteMonsterPos(e);
        if (ep) eliteBurstFx(ep.x, ep.y, 50, dd.v.attack, 0);
      });
      floatEnemyEvent(m, 'mv-float', dd.emoji + '分裂!', 'elite-cast');
    }
  }
  return false;
}
function eliteOnAllyDeath(dead) {
  var list = eliteEnemies();
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (!e || e === dead || !(e.hp > 0)) continue;
    /* 復仇：同一群每死一隻，存活的復仇者變大、變強、變快 */
    if (dead._gid !== undefined && e._gid === dead._gid && e._el) {
      var da = eliteArch(e, 'avenger');
      if (da) {
        var rt = e._el;
        rt.avStacks = (rt.avStacks || 0) + 1;
        e._grow = (e._grow || 1) * (1 + da.size);
        e.aspd = (Number(e.aspd) || 1) * (1 + da.aspd);
        e.runSpeed = ((Number(e.runSpeed) > 0) ? Number(e.runSpeed) : (typeof bfEnemySpeed === 'function' ? bfEnemySpeed() : 210)) * (1 + da.run);
        var ep = eliteMonsterPos(e);
        if (ep) eliteBurstFx(ep.x, ep.y, 70, da.v.cast, 0);
        eliteCastFx(e, da);
        floatEnemyEvent(e, 'mv-float', da.emoji + '復仇!', 'elite-cast');
      }
    }
    /* 召喚師死了：牠召喚的敵人最大生命縮水（預設 −90%） */
    if (e._summoner === dead) {
      var ds = eliteArch(dead, 'summon');
      var cut = ds ? ds.hpCut : 0.9;
      e.maxHp = Math.max(1, e.maxHp * (1 - cut));
      e.hp = Math.min(e.hp, e.maxHp);
    }
  }
}
function eliteBomberArm(m, d) {
  var mp = eliteMonsterPos(m);
  if (!mp) return;
  var x = mp.x, y = mp.y;
  eliteWarn(x, y, d.r, d.v.ground, d.delay, 'bomb');
  floatEnemyEvent(m, 'mv-float', d.emoji + '即將爆炸!', 'elite-cast');
  eliteLater(d.delay, function () {
    eliteBurstFx(x, y, d.r * 1.2, d.v.attack, 0, d.elem);
    if (eliteInCircle(x, y, d.r)) eliteHitPlayer(m, { mult: d.dmg, elem: d.elem, sure: true, label: d.name });
  });
}

/* 每隻敵人每個 tick 的衝鋒推進（由 fieldTick／towerTick 呼叫）。 */
function eliteStepMotion(list, dt) {
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    if (m && m._elDash && m.hp > 0) eliteDashStep(m, dt);
  }
}
/* 這隻現在被技能鎖住（施法／衝鋒中）：不走路、不普攻。 */
function eliteLocked(m) { return !!(m && m._elLockUntil > GT); }
