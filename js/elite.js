'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
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
var ELITE_MAX_WALL_CASTS = 2;
var ELITE_MAX_SAME_SKILL = 5;     // 同一種主動技能全場同時最多幾個還沒消失（誰施放都算，滿了就沒人能再放，直到有一個消失）
var ELITE_WALL_NAV_LIMITS = { walls: 6, activeWalls: 6, meshes: 8, builds: 2, routes: 16, replan: 0.5, check: 0.25, goalMove: 24, radiusStep: 4 };

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
  wallCasts: [], // 預警即占名額，直到這次施放的牆全數消失
  holds: [],     // 每次施放占一個「同技能名額」直到效果消失 { id, until }（上限見 ELITE_MAX_SAME_SKILL）
  wallNav: null, // 有上限的牆角路網與各角色路徑快取；不進存檔／Protocol
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
  ELITE_RT.wallCasts.length = 0;
  ELITE_RT.holds.length = 0;
  ELITE_RT.wallNav = null;
  ELITE_RT.pull = null;
  if (typeof bfPlayerPos === 'function') bfPlayerPos().lift = 0;
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
  if (typeof bfEnemyAlerted === 'function' && !bfEnemyAlerted(m)) return false;
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
  if (o.holdSec > 0) area.holdSec = o.holdSec;
  if (o.brake) area.brake = true;
  if (isFinite(o.holdAngle)) area.holdAngle = o.holdAngle;
  if (isFinite(o.startAngle)) area.startAngle = o.startAngle;
  eliteFx({
    fxKind: 'projectile', variant: o.variant || 'elite-flight', elem: o.elem || null, count: 1, dur: travelSec, hit: false,
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
  else { area.r = v.r; if (v.a !== undefined) area.a = v.a; }      // 圓形場域也可以帶朝向（毒十字依敵人面向玩家的方向轉）
  if (v.poisonTrail) {
    area.r = v.r;
    area.growAge = Math.max(0, GT - v.t0);
    area.lifeSec = Math.max(0, v.until - GT);
    eliteFx({ fxKind: 'aura', variant: 'elite-poison-trail', count: 1, dur: area.lifeSec,
      travelMs: [v.growSec * 1000], area: area, vfx: { ground: v.preset } });
    return;
  }
  /* 會移動的場域（火鏈）：把中心的移動速度與方向一起送過去，顯示層在兩則事件之間沿著它自走，不會一格一格跳。 */
  if (v.speed > 0 && isFinite(v.moveA)) { area.speed = v.speed; area.moveA = v.moveA; }
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
    targets: v.targets,
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
  if (p && Array.isArray(p.dots) && m && m.name) {
    for (var pdi = 0; pdi < p.dots.length; pdi++) {
      if (p.dots[pdi] && !p.dots[pdi].sourceName) {
        p.dots[pdi].sourceName = m.name;
        p.dots[pdi].sourceKey = p.dots[pdi].sourceKey || 'enemy';
      }
    }
  }
  var pf = elitePF();
  if (res.invuln) { floatPlayerEvent(pf, STR(498), 'defend'); return res; }
  if (res.miss) { floatPlayerEvent(pf, STR(500), 'dodge defend'); return res; }
  var text = '-' + fmt(res.dmg);
  if (res.crit) text = STR(9, text);
  floatText(pf, text, res.crit ? 'crit' : 'mdmg');
  if (res.blocked) floatPlayerEvent(pf, STR(502), 'defend');
  var hpDamage = Math.max(0, res.dmg - (res.absorbed || 0));
  if (res.dmg > 0 && window.recordPlayerDamageHit) {
    window.recordPlayerDamageHit((m && m.name) || STR(459), (o && o.label) || STR(41), res.dmg);
  }
  settleEnemyAttackRetaliation({
    attacker: m, target: p, floatSel: pf, result: res, hpDamage: hpDamage,
    blocked: !!res.blocked, defCfg: dCfg, thornsApplied: true
  });
  eliteApplyStatus(p, dCfg, res, o, m);
  if (!o.quiet && typeof blog === 'function') {
    blog(STR(531, (m.name || STR(459)), (o.label || STR(41)), fmt(res.dmg)),
      'log-enemy-skill', 'combat');
  }
  return res;
}
function eliteApplyStatus(p, dCfg, res, o, m) {
  var pf = elitePF();
  var ccf = (dCfg.ccFactor === undefined) ? 1 : dCfg.ccFactor;
  if (o.stun > 0 && !resistCtrl(dCfg)) {
    var sd = applyEffect(p, 'stun', o.stun * ccf);
    if (sd) floatPlayerEvent(pf, o.freeze ? STR(532) : STR(533), 'debuff');
  }
  if (o.slow > 0 && !resistCtrl(dCfg)) {
    var sl = applyEffect(p, 'slow', o.slow * ccf);
    if (sl) floatPlayerEvent(pf, STR(534), 'debuff');
  }
  if (o.dot && o.dot.dur > 0 && res.dmg > 0) {
    var dps = Math.max(1, res.dmg * o.dot.pct / 100 / o.dot.dur);
    applyDot(p, dps, o.dot.dur, o.dot.name, o.dot.id, undefined, undefined, {
      sourceName: m && m.name,
      sourceKey: 'enemy',
      subType: o.dot.name || o.label,
      srcAtk: m ? { level: m.level, isElite: !!m.elite, isBoss: !!m.isBoss, attr: m.attr || null, magic: !!m.magic } : undefined
    });
    floatPlayerEvent(pf, o.dot.name + '!', 'debuff');
  }
  if (o.atkDown > 0) applyBuff(p, 'atkDown', o.atkDown, o.dur || 6, 'atkDown');
  if (o.defDown > 0) applyBuff(p, 'defDown', o.defDown, o.dur || 6, 'defDown');
  if (o.push > 0 && o.from) elitePushPlayer(o.from.x, o.from.y, o.push);
}
/* 把玩家從 (fx,fy) 往外推 dist（座標單位）。位置由模擬層 bfPlayerPos() 就地改寫。 */
function elitePushPlayer(fx, fy, dist) {
  var pp = elitePos();
  var ox = pp.x, oy = pp.y;
  var dx = pp.x - fx, dy = pp.y - fy;
  var d = Math.sqrt(dx * dx + dy * dy) || 1;
  pp.x += dx / d * dist;
  pp.y += dy / d * dist;
  eliteClampMove(ox, oy, pp);
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
var ELITE_TIER_NAME = { elite: STR(535), elite_adv: STR(536), boss: STR(537), tower: STR(538) };
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
  if (d.minRange > 0 && o.atkRange > 0 && o.atkRange < d.minRange) return false;   // 例：迫擊要拉開到 24 米才放，射程 6 米的近戰怪不配這種技能
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
  var n = eliteRandInt(rng[0], rng[1]) + Math.max(0, Math.floor(o.extraRnd || 0));   // extraRnd＝封魔塔沒解鎖技能的 BOSS 額外多抽幾個
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
    dist = m._hover > 0 ? Math.max(30, m._hover * (0.75 + Math.random() * 0.25)) : Math.max(30, stop * 0.9);
  } else if (mode === 'away' && ref > 0) {
    /* 拉開距離（迫擊這類施放前要離玩家夠遠的技能）：沿「玩家 → 牠」的方向往外退，稍微偏一點角度才不像一直線倒退；
       目標點多留 2 米，到了之後距離才確定夠。ref＝要拉開到的距離（座標單位）。 */
    ang = cur + (Math.random() * 2 - 1) * Math.PI / 9;
    dist = ref + 20;
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
  /* 帶火鏈的怪：跑位間隔改用火鏈自己的 repoGap（比全域短得多），而且每次都跑到「夥伴→玩家」延伸線上，
     目的是讓鏈條掃過玩家，不是貼臉近戰；平時只守在 hover 距離（見 battlefield.js）。 */
  var chain = eliteArch(m, 'chain');
  m._hover = chain && chain.hover > 0 ? chain.hover : 0;
  var gap = chain && chain.repoGap ? eliteRange(chain.repoGap, [1.5, 3]) : [Math.max(0.5, eliteG('repoMin', 4)), Math.max(eliteG('repoMin', 4), eliteG('repoMax', 8))];
  if (m._rpDone) {
    m._rpDone = false;
    rt.repoAt = GT + rnd(gap[0], Math.max(gap[0], gap[1]));
  }
  if (m._rp || rt.pend || !(GT >= rt.repoAt) || !elitePlayerAlive()) return;
  var pr = chain ? eliteChainPartner(m) : null;
  var ref = pr ? eliteMonsterPos(pr) : null;
  eliteRepoPick(m, ref ? 'through' : 'random', ref);
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

/* ============ 狀態標記（Status 表）============
   怪物身上的持續狀態（無敵護罩、狂暴、怒意、再生）的「畫面」一律由 Status 表決定（上身、持續、作用特效），
   引擎只負責在狀態成立／結束時對應地掛上、拿掉；數值（免疫、攻擊倍率、回復）仍由本檔結算。
   各技能掛哪個狀態寫在 Skills2 的「我方狀態」欄（d.status.self），引擎把它記在 rt.*Sid，沒填就用預設。 */
var ELITE_STATE_DEFAULT = { invuln: 'eInvuln', enrage: 'eEnrage', rage: 'eRage', regen: 'eRegen' };
/* 光環半徑＝身體半徑的倍數（球形光罩比地面光環小一點才罩得住身體） */
var ELITE_STATE_R = { eInvuln: 0.8 };
function eliteStatusEntry(d, side) {
  var list = d && d.status && d.status[side];
  return (list && list[0]) || null;
}
/* 技能的狀態欄寫的持續秒數（數字，或本技能效果參數的鍵名）；沒寫就用 fallback */
function eliteStatusDur(d, side, fallback) {
  var e = eliteStatusEntry(d, side);
  if (!e || e.dur === undefined) return fallback;
  var v = typeof e.dur === 'string' ? d[e.dur] : e.dur;
  return v > 0 ? v : fallback;
}
function eliteStatusOn(m, sid, dur) {
  if (typeof applyStatus !== 'function') return;
  applyStatus(m, sid, { dur: dur, vfxR: (m._bodyR || 20) * (ELITE_STATE_R[sid] || 1.15) });
}
function eliteStatusOff(m, sid) {
  var def = (typeof statusDef === 'function') ? statusDef(sid) : null;
  if (def && m.buffs && m.buffs[def.key]) delete m.buffs[def.key];
}
function eliteSyncStates(m, rt) {
  var want = {};
  var regen = eliteArch(m, 'regen');
  want[rt.invulnSid || ELITE_STATE_DEFAULT.invuln] = rt.invulnUntil > GT ? rt.invulnUntil - GT : 0;
  want[rt.enrageSid || ELITE_STATE_DEFAULT.enrage] = rt.enraged ? 99999 : 0;
  want[rt.rageSid || ELITE_STATE_DEFAULT.rage] = rt.atkUntil > GT ? rt.atkUntil - GT : (rt.avStacks > 0 ? 99999 : 0);
  if (regen) want[eliteStatusEntry(regen, 'self') ? eliteStatusEntry(regen, 'self').id : ELITE_STATE_DEFAULT.regen] = 99999;
  Object.keys(want).forEach(function (sid) {
    var active = (typeof statusActive === 'function') && statusActive(m, sid);
    if (want[sid] > 0 && !active) eliteStatusOn(m, sid, want[sid]);
    else if (!(want[sid] > 0) && active) eliteStatusOff(m, sid);
  });
}

function eliteTickOne(m, dt) {
  var rt = m._el;
  if (!rt) return;
  eliteSyncStates(m, rt);
  if (rt.atkUntil && rt.atkUntil <= GT) { rt.sacMult = 1; rt.atkUntil = 0; }
  if (!eliteReady(m)) return;
  var acting = !ccActionLocked(m);
  if (acting && !eliteLocked(m)) eliteRepoTick(m);
  /* 先跑位再施放：跑位技能已經在路上，到了（或超時）才放出來 */
  if (rt.pend && acting && (!m._rp || GT >= rt.pend.until)) {
    var pd = eliteDef(rt.pend.id);
    var pid = rt.pend.id;
    if (rt.pend.away && m._rp) { m._rp = null; m._rpDone = true; }   // 超時還沒跑完：停下來直接放
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
    if (eliteKeepAway(m, d, id)) continue;
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
/* 施放前要離玩家夠遠的技能（效果參數 minRange，例：迫擊 24 米）：太近就先往外跑，
   跑到了就放；被追著 backoff 秒（預設 3）還拉不開就直接放（使用者 2026-10-21）。
   回傳 true＝已經開始跑開，這一輪不施放（到位或超時由 eliteTickOne 的 pend 結算）。 */
function eliteKeepAway(m, d, id) {
  if (!(d.minRange > 0)) return false;
  var rt = m._el, mp = eliteMonsterPos(m), pp = elitePos();
  if (!mp || eliteDist(mp.x, mp.y, pp.x, pp.y) >= d.minRange) return false;
  if (rt.pend) { rt.cd[id] = 0.4; return true; }           // 另一個技能正在跑位等施放：不搶它的 pend
  if (!eliteMoves(m) || !eliteRepoPick(m, 'away', d.minRange)) return false;   // 不會跑位的怪：直接放
  rt.pend = { id: id, until: GT + (d.backoff > 0 ? d.backoff : 3), away: true };
  return true;
}

/* 施放前提：有些技能要有同伴或有空間才有意義。 */
function eliteCanCast(m, d) {
  if (eliteHoldCount(d.id) >= ELITE_MAX_SAME_SKILL) return false;
  if (d.arch === 'walls' && eliteWallCastCount() >= ELITE_MAX_WALL_CASTS) return false;
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
    case 'mortar': return !!eliteMonsterPos(m);   // 距離不夠時先跑開再放（eliteKeepAway），不在這裡擋
    case 'chain': return !!eliteChainPartner(m);
    case 'pull': {
      /* 玩家已經貼在牠身邊（拉不動）或離太遠（超出拉扯範圍）都是白放：只在「拉得動、拉得有感」時才抽這個技能 */
      var vp = eliteMonsterPos(m), pd = vp ? eliteDist(vp.x, vp.y, elitePos().x, elitePos().y) : 0;
      return !!vp && pd >= elitePullStop(m) + (d.minPull || 0) && pd <= elitePullReach(m, d);
    }
    case 'sparks': return false;
    default: return true;
  }
}

function eliteAnnounce(m, d) {
  floatEnemyEvent(m, 'mv-float', d.emoji + d.name, 'elite-cast');
  if (typeof blog === 'function') blog(STR(539, (m.name || STR(459)), d.emoji, d.name), 'log-enemy-skill', 'combat');
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

/* 同技能名額：施放當下占一個，預警＋效果持續（life／dur，沒有的瞬發技能占 1 秒）結束才釋出。 */
function eliteHoldCount(id) {
  var holds = ELITE_RT.holds;
  for (var i = holds.length - 1; i >= 0; i--) if (GT >= holds[i].until) holds.splice(i, 1);
  var n = 0;
  for (var j = 0; j < holds.length; j++) if (holds[j].id === id) n++;
  return n;
}
function eliteHoldAdd(d) {
  var sec = (Number(d.warn) || 0) + Math.max(Number(d.life) || 0, Number(d.dur) || 0, 1);
  ELITE_RT.holds.push({ id: d.id, until: GT + sec });
}

function eliteCast(m, d, id) {
  var fn = ELITE_CASTERS[d.arch];
  if (!fn) return;
  eliteHoldAdd(d);
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
          mult: d.dmg, elem: d.elem, phys: d.phys, sure: true, dot: d.dot, stun: d.stun, slow: d.slow,
          label: d.name, quiet: true
        });
      }
    }
    keep.push(z);
  }
  ELITE_RT.zones = keep;
}
/* 熔火：移動時每隔一段距離留下一塊熔岩火徑。
   怪物一幀可能跑很遠（跑位、衝刺），所以沿著「上次落點→現在位置」每隔 gap 補一塊，不然火徑會斷成一塊一塊、中間一大段空白；
   場域數量到上限時，先收掉這隻怪自己最舊的一塊（火徑尾端先消失），不是不放新的（那樣怪物身後就是斷層）。 */
function eliteTrailTick(m, d, rt, dt) {
  var mp = eliteMonsterPos(m);
  if (!mp) return;
  if (rt.trailX === null) { rt.trailX = mp.x; rt.trailY = mp.y; return; }
  var gap = Math.max(8, d.trailGap || 30);
  var dist = eliteDist(mp.x, mp.y, rt.trailX, rt.trailY);
  if (dist < gap) return;
  var n = Math.min(8, Math.floor(dist / gap));
  var cap = Math.max(1, Math.floor(eliteG('maxZones', 48)));
  var ux = (mp.x - rt.trailX) / dist, uy = (mp.y - rt.trailY) / dist;
  var x0 = rt.trailX, y0 = rt.trailY;
  for (var k = 1; k <= n; k++) {
    if (ELITE_RT.zones.length >= cap) {
      var old = -1;
      for (var i = 0; i < ELITE_RT.zones.length; i++) if (ELITE_RT.zones[i].owner === m && ELITE_RT.zones[i].def === d) { old = i; break; }
      if (old < 0) break;
      ELITE_RT.zones[old].vis.until = 0;
      ELITE_RT.zones.splice(old, 1);
    }
    eliteZoneSpawn(m, d, x0 + ux * gap * k, y0 + uy * gap * k, 0);
  }
  rt.trailX = x0 + ux * gap * n; rt.trailY = y0 + uy * gap * n;
  if (dist > gap * 8) { rt.trailX = mp.x; rt.trailY = mp.y; }   // 瞬間移動等超長距離：不補，直接從新位置開始
}
/* 熔火：死亡時原地留下熔岩核心，coreDelay 秒後引發大範圍自爆。 */
function eliteMoltenCore(m, d) {
  var mp = eliteMonsterPos(m);
  if (!mp) return;
  var x = mp.x, y = mp.y, delay = d.coreDelay || 3, r = d.coreR || 90;
  eliteWarn(x, y, r, d.v.ground, delay, 'core');
  floatEnemyEvent(m, 'mv-float', STR(540, d.emoji), 'elite-cast');
  eliteLater(delay, function () {
    eliteBurstFx(x, y, r * 1.1, d.v.attack, 0, d.elem);
    if (eliteInCircle(x, y, r)) {
      var res = eliteHitPlayer(m, { mult: d.coreDmg || 3, elem: d.elem, sure: true, dot: d.dot, label: STR(541, d.name) });
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
      if (dash) { var pos = eliteMonsterPos(m); if (pos) { var ox = pos.x, oy = pos.y; pos.x = dash.ex; pos.y = dash.ey; eliteClampMove(ox, oy, pos, bfEntityRadius(m) * 0.6); } }
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
  var ox = pos.x, oy = pos.y;
  pos.x = dash.sx + (dash.ex - dash.sx) * k;
  pos.y = dash.sy + (dash.ey - dash.sy) * k;
  if (eliteClampMove(ox, oy, pos, bfEntityRadius(m) * 0.6)) {
    // 結束點也停在牆前，延遲結算不能再把衝鋒者送到原終點。
    dash.ex = pos.x; dash.ey = pos.y; dash.sx = pos.x; dash.sy = pos.y;
  }
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
    var ie = eliteStatusEntry(d, 'self');
    if (ie) e._el.invulnSid = ie.id;
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
  floatEnemyEvent(v, 'mv-float', STR(542), 'elite-cast');
  if (typeof onFieldKill === 'function') onFieldKill(v);
  var heal = m.maxHp * d.heal / 100;
  m.hp = Math.min(m.maxHp, m.hp + heal);
  var rt = m._el;
  rt.sacMult = 1 + d.atk / 100;
  rt.atkUntil = GT + d.dur;
  if (eliteStatusEntry(d, 'self')) rt.rageSid = eliteStatusEntry(d, 'self').id;
  floatEnemyEvent(m, 'mv-float', '+' + fmt(heal), 'elite-heal');
}
function eliteCastCurse(m, d) {
  eliteBusy(m, d.busy, false);
  eliteLater(0.3, function () {
    if (!(m.hp > 0) || !elitePlayerAlive()) return;
    var ce = eliteStatusEntry(d, 'enemy');   // 詛咒的上身畫面由 Status 表決定
    if (ce && typeof applyStatus === 'function' && elitePlayer()) {
      applyStatus(elitePlayer(), ce.id, {
        dur: eliteStatusDur(d, 'enemy', d.dur),
        source: { sourceName: m && m.name, sourceKey: 'enemy', subType: d.name }
      });
    }
    eliteHitPlayer(m, {
      mult: d.dmg, elem: d.elem, sure: true, atkDown: d.atkDown, defDown: d.defDown, dur: d.dur, label: d.name
    });
    floatPlayerEvent(elitePF(), STR(543), 'debuff');
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
    if (take > 0) floatPlayerEvent(elitePF(), STR(544, fmt(take)), 'debuff');
    var heal = m.maxHp * d.heal / 100;
    m.hp = Math.min(m.maxHp, m.hp + heal);
    eliteHitPlayer(m, { mult: d.dmg, elem: d.elem, sure: true, label: d.name, quiet: true });
  });
}
/* 護盾：金色球形光罩，持續期間完全免疫傷害。 */
function eliteCastImmune(m, d) {
  eliteBusy(m, 0.6, false);
  m._el.invulnUntil = GT + d.dur;
  var se = eliteStatusEntry(d, 'self');
  if (se) m._el.invulnSid = se.id;   // 光罩的畫面由 Status 表的持續特效決定（eliteSyncStates 掛上）
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
  if (typeof statusTickVfxCollect === 'function') {   // 每次回復的畫面＝Status 表「再生」的作用特效
    var rs = eliteStatusEntry(d, 'self');
    statusTickVfxCollect(m, rs ? rs.id : ELITE_STATE_DEFAULT.regen);
  }
}

/* ============ 火鏈：同群夥伴之間拉出一條火鏈，持續到怪物死亡 ============
   鏈條本身是常駐的（eliteChainsTick 維護）；「施放」＝跑位到玩家另一側，讓鏈條掃過你身上。
   畫面角色：持續場域特效＝鏈條本體（矩形，長度＝兩端距離）；施放特效＝施法者身上；受擊特效＝打中玩家 */
/* 火鏈夥伴：同群裡「最近」的活著的怪，且距離不超過鏈條最長長度（最多鏈環數 × linkLen × 2，最長那份最多拉長一倍）。
   以前是挑名單上的下一隻，群散得很開時（熔火怪跑得快）鏈條會被拉得極長、鏈環變成巨大的環，中間一個怪都沒有。
   太遠就不連：鏈條不出現，等牠們靠近再連上。 */
function eliteChainPartner(m) {
  var mem = eliteGroupMembers(m, true);
  if (mem.length < 2 || mem.indexOf(m) < 0) return null;
  var mp = eliteMonsterPos(m);
  if (!mp) return null;
  var d = eliteArch(m, 'chain');
  var maxLen = Infinity;
  if (d) {
    var vars = eliteChainVariants(d);
    maxLen = vars[vars.length - 1].n * (d.linkLen > 0 ? d.linkLen : 15) * 2;
  }
  var best = null, bd = Infinity;
  for (var k = 0; k < mem.length; k++) {
    var e = mem[k];
    if (e === m || !(e.hp > 0)) continue;
    var ep = eliteMonsterPos(e);
    if (!ep) continue;
    var dd = eliteDist(mp.x, mp.y, ep.x, ep.y);
    if (dd < bd) { bd = dd; best = e; }
  }
  return best && bd <= maxLen ? best : null;
}
function eliteCastChain(m, d) {
  eliteBusy(m, 0.2, false);
}
/* 火鏈的畫面是一節一節的鏈環：鏈環數固定的 Preset 被拉成不同長度，鏈環就會被拉成長橢圓、不像鏈子。
   所以 Skills2 火鏈列給了好幾份「鏈環數不同」的 Preset（持續場域特效＝基準、效果參數 presets＝其餘，id 以 -N 結尾，N＝鏈環數），
   這裡依「兩端距離 ÷ linkLen」挑鏈環數最接近的一份；差一級以內不換（避免在兩份之間來回跳）。 */
function eliteChainVariants(d) {
  if (d._chainVars) return d._chainVars;
  var out = [];
  [d.v.field].concat(d.presets || []).forEach(function (id) {
    var m = /-(\d+)$/.exec(String(id || ''));
    if (m) out.push({ n: Number(m[1]), id: id });
  });
  out.sort(function (a, b) { return a.n - b.n; });
  d._chainVars = out.length ? out : [{ n: 1, id: d.v.field }];
  return d._chainVars;
}
function eliteChainPick(d, len, cur) {
  var vars = eliteChainVariants(d);
  var want = len / (d.linkLen > 0 ? d.linkLen : 15);
  var best = 0;
  for (var i = 1; i < vars.length; i++) {
    if (Math.abs(Math.log(vars[i].n / want)) < Math.abs(Math.log(vars[best].n / want))) best = i;
  }
  if (cur !== undefined && cur !== best && Math.abs(Math.log(vars[cur].n / want)) < Math.log(1.25)) return cur;   // 差不多就別換
  return best;
}
/* 同一群的活怪連成一圈：2 隻＝一條線、3 隻＝三角形、4 隻＝四邊形…（依繞群體中心的角度排序，邊不會交叉）。
   群裡只要有一隻帶火鏈就會連整圈；單條邊太長（超過最長鏈環數 × linkLen × 2）就不畫那一條。 */
function eliteChainRing(m) {
  var mem = eliteGroupMembers(m, true).filter(function (e) { return e.hp > 0 && eliteMonsterPos(e); });
  if (mem.length < 2) return [];
  if (mem.length === 2) return [[mem[0], mem[1]]];
  var cx = 0, cy = 0;
  mem.forEach(function (e) { var p = eliteMonsterPos(e); cx += p.x; cy += p.y; });
  cx /= mem.length; cy /= mem.length;
  var ang = function (e) { var p = eliteMonsterPos(e); return Math.atan2(p.y - cy, p.x - cx); };
  mem.sort(function (u, v) { return ang(u) - ang(v); });
  var out = [];
  for (var i = 0; i < mem.length; i++) out.push([mem[i], mem[(i + 1) % mem.length]]);
  return out;
}
/* 火鏈顯示自走的速度上限：兩端怪物跑位時的最高速度（跑速 × 跑位加速），再多留 20% 餘裕；
   超過就是瞬移（衝刺、重排），不是走路。 */
function eliteChainMaxDriftSpeed(a, b) {
  var run = typeof bfEnemyRunSpeed === 'function' ? Math.max(bfEnemyRunSpeed(a), bfEnemyRunSpeed(b)) : 210;
  var rsp = (typeof ELITE_GROUP !== 'undefined' && ELITE_GROUP && ELITE_GROUP.repoSpeed > 1) ? ELITE_GROUP.repoSpeed : 1;
  return run * rsp * 1.2;
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
    var vars = eliteChainVariants(d);
    var maxLen = vars[vars.length - 1].n * (d.linkLen > 0 ? d.linkLen : 15) * 2;
    eliteChainRing(m).forEach(function (pr) {
      var pa = eliteMonsterPos(pr[0]), pb = eliteMonsterPos(pr[1]);
      if (eliteDist(pa.x, pa.y, pb.x, pb.y) > maxLen) return;
      var key = [pr[0].floatSel, pr[1].floatSel].sort().join('|');
      if (want[key]) return;
      /* 兩端的順序固定（依 floatSel 排序），不隨整圈排列改變：鏈條的角度由 a→b 決定，順序一翻就轉了 180°，
         有怪物死亡、整圈重排時剩下的鏈條會忽然旋轉。 */
      var lo = String(pr[0].floatSel) <= String(pr[1].floatSel);
      want[key] = { a: lo ? pr[0] : pr[1], b: lo ? pr[1] : pr[0], d: d, o: m };
    });
  }
  var keep = [];
  ELITE_RT.chains.forEach(function (c) {
    if (want[c.key]) { c.a = want[c.key].a; c.b = want[c.key].b; c.d = want[c.key].d; c.o = want[c.key].o; delete want[c.key]; keep.push(c); }
    else if (c.vis) c.vis.until = 0;
  });
  Object.keys(want).forEach(function (key) {
    var w = want[key];
    var c = { key: key, a: w.a, b: w.b, d: w.d, o: w.o, nextTick: 0, vis: null };
    c.varIdx = undefined;
    keep.push(c);
  });
  ELITE_RT.chains = keep;
  keep.forEach(function (c) {
    var ap = eliteMonsterPos(c.a), bp = eliteMonsterPos(c.b);
    if (!ap || !bp) return;
    var len = Math.max(20, eliteDist(ap.x, ap.y, bp.x, bp.y));
    var vi = eliteChainPick(c.d, len, c.varIdx);
    if (vi !== c.varIdx || !c.vis) {
      if (c.vis) c.vis.until = 0;           // 換一份鏈環數不同的 Preset：舊的自然收掉
      c.varIdx = vi;
      c.vis = { id: eliteVisId('chain'), preset: eliteChainVariants(c.d)[vi].id, x: 0, y: 0, w: 1, h: 1, a: 0, until: GT + 9999, every: 0.12, next: 0 };
      ELITE_RT.vis.push(c.vis);
    }
    var mx = (ap.x + bp.x) / 2, my = (ap.y + bp.y) / 2;
    /* 速度只用來讓顯示層在兩則事件之間自走。怪物多時夥伴會換、整圈會重排、怪被擠開，中點一拍就跳一大段，
       若照位移除以 dt 估速度，顯示層會沿著那個離譜的速度一路飛出畫面。所以：兩端換人、換 Preset、
       或這一拍中點位移超過合理速度，就視為瞬移，速度歸零；其餘也不超過上限。 */
    var maxDrift = eliteChainMaxDriftSpeed(c.a, c.b);
    var jumped = c.lastX === undefined || c.lastA !== c.a || c.lastB !== c.b || vi !== c.lastVi ||
      !(dt > 0) || eliteDist(mx, my, c.lastX, c.lastY) > maxDrift * dt;
    if (jumped) { c.vx = 0; c.vy = 0; }
    else {
      c.vx = (c.vx || 0) * 0.5 + (mx - c.lastX) / dt * 0.5;
      c.vy = (c.vy || 0) * 0.5 + (my - c.lastY) / dt * 0.5;
    }
    c.lastX = mx; c.lastY = my; c.lastA = c.a; c.lastB = c.b; c.lastVi = vi;
    var csp = Math.sqrt((c.vx || 0) * (c.vx || 0) + (c.vy || 0) * (c.vy || 0));
    if (csp > maxDrift) { c.vx *= maxDrift / csp; c.vy *= maxDrift / csp; csp = maxDrift; }
    c.vis.speed = csp > 3 ? csp : 0;
    c.vis.moveA = csp > 3 ? Math.atan2(c.vy, c.vx) : NaN;
    c.vis.x = mx; c.vis.y = my;
    c.vis.targets = [c.a.floatSel, c.b.floatSel];
    c.vis.w = len; c.vis.h = c.d.linkH > 0 ? c.d.linkH : Math.max(24, c.d.wid * 2.2);
    c.vis.a = Math.atan2(bp.y - ap.y, bp.x - ap.x);
    c.nextTick -= dt;
    if (c.nextTick > 0 || !player) return;
    c.nextTick = c.d.tick || 0.25;
    if (eliteSegmentDist(ap.x, ap.y, bp.x, bp.y, pp.x, pp.y) <= c.d.wid / 2 + ELITE_PLAYER_BODY_R) {
      var res = eliteHitPlayer(c.o || c.a, { mult: c.d.dmg, elem: c.d.elem, sure: true, quiet: true, label: c.d.name });
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

/* 毒素加持：表定 len／speed 決定連續伸展的前緣，ballR 是水帶半寬。
   四臂為從中心到前緣的膠囊形；舊 balls 配置保留相容、不再離散放球。
   朝向由敵人面對玩家的方向決定，生成後不旋轉。 */
function eliteCastCross(m, d) {
  var pp = elitePos();
  var ang = Math.random() * Math.PI * 2;
  var rr = Math.sqrt(Math.random()) * (d.throwRange || 120);
  var cx = pp.x + Math.cos(ang) * rr, cy = pp.y + Math.sin(ang) * rr;
  var warn = d.warn || 0.9, dur = d.dur || 6;
  /* 十字的朝向：一條臂沿著「敵人 → 玩家」的方向，另一條與它垂直（斜向來的敵人就畫成斜十字，不是固定的正十字）。 */
  var mp0 = eliteMonsterPos(m) || pp;
  var ang0 = (Math.abs(pp.x - mp0.x) + Math.abs(pp.y - mp0.y) > 1) ? Math.atan2(pp.y - mp0.y, pp.x - mp0.x) : 0;
  eliteBusy(m, 0.6, false);
  var hub = eliteVisAdd({ id: eliteVisId('poisondot'), preset: d.v.ground, x: cx, y: cy, r: d.hubR || 28, until: GT + warn + dur });
  eliteLater(warn, function () {
    var c = { owner: m, def: d, x: cx, y: cy, a: ang0, t0: GT, until: GT + dur, nextTick: 0, hub: hub };
    c.vis = eliteVisAdd({ id: eliteVisId('cross'), preset: d.v.field, x: cx, y: cy,
      r: d.len || 360, w: d.len || 360, h: (d.ballR || 18) * 2, a: ang0,
      poisonTrail: true, t0: c.t0, growSec: (d.len || 360) / (d.speed || 120), until: c.until });
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
    if (GT >= c.until) { if (c.vis) c.vis.until = 0; if (c.hub) c.hub.until = 0; continue; }
    keep.push(c);
    c.nextTick -= dt;
    if (c.nextTick > 0 || !player) continue;
    c.nextTick = c.def.tick || 0.25;
    var t = GT - c.t0;
    var len = c.def.len || 360, reach = Math.min(len, (c.def.speed || 120) * t);
    var ballR = c.def.ballR || 18;
    var hit = eliteDist(pp.x, pp.y, c.x, c.y) <= (c.def.hubR || 28) + ELITE_PLAYER_BODY_R;     // 中心的毒圈
    for (var arm = 0; arm < 4 && !hit; arm++) {
      var th = (c.a || 0) + arm * Math.PI / 2;
      var dx = pp.x - c.x, dy = pp.y - c.y;
      var along = Math.max(0, Math.min(reach, dx * Math.cos(th) + dy * Math.sin(th)));
      var bx = c.x + Math.cos(th) * along, by = c.y + Math.sin(th) * along;
      if (eliteDist(pp.x, pp.y, bx, by) <= ballR + ELITE_PLAYER_BODY_R) hit = true;
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

/* ============ 迫擊：高角度拋射數顆火球；施放前先拉開到 minRange 以外（eliteKeepAway） ============ */
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

/* ============ 築牆：在你周圍升起 2～3 面整塊岩壁（平行 2 面或 U 型 3 面） ============
   每面 len × thick，由五片不規則岩石組成（畫面見 en-stone-wall）。n＝一次升起幾面（2＝平行、3＝U 型）。
   雙方不能穿牆移動或隔牆近戰攻擊（遠程攻擊不受影響），共用旋轉矩形判定。 */
var ELITE_WALL_STEP = Math.PI / 12;           // 牆的朝向吸附到 15° 的倍數：每個角度各有一張畫好的整面岩壁（en-stone-wall-度數）
function eliteWallPreset(d, a) {
  var deg = ((Math.round(a / ELITE_WALL_STEP) * 15) % 180 + 180) % 180;
  var base = String(d.v.field || '').replace(/-\d+$/, '');
  var id = base + '-' + deg;
  return (id === d.v.field || (d.presets && d.presets.indexOf(id) >= 0)) ? id : d.v.field;
}
function eliteCastWalls(m, d) {
  if (eliteWallCastCount() >= ELITE_MAX_WALL_CASTS) return false;
  var pp = elitePos(), mp = eliteMonsterPos(m) || pp;
  var a0 = Math.round(Math.atan2(pp.y - mp.y, pp.x - mp.x) / ELITE_WALL_STEP) * ELITE_WALL_STEP;
  var ux = Math.cos(a0), uy = Math.sin(a0);   // 由怪物指向玩家（吸附到 15° 的倍數）
  var vx = -uy, vy = ux;                      // 垂直方向
  var len = d.len, thick = d.thick, off = d.dist, life = d.life, warn = d.warn || 0.8;
  var cast = { id: eliteVisId('wallcast'), pending: true, until: GT + warn + life };
  ELITE_RT.wallCasts.push(cast);
  var nr = eliteRange(d.n, [2, 3]);
  var shape = eliteRandInt(nr[0], nr[1]) >= 3 ? 'U' : 'parallel';
  var segs = [
    { x: pp.x + vx * off, y: pp.y + vy * off, a: Math.atan2(uy, ux), len: len },        // 左右兩面與怪物來向平行
    { x: pp.x - vx * off, y: pp.y - vy * off, a: Math.atan2(uy, ux), len: len }
  ];
  if (shape === 'U') {
    // 背面：缺口朝著怪物，把玩家關在裡面（同樣是 len 長）
    segs.push({ x: pp.x + ux * off, y: pp.y + uy * off, a: Math.atan2(vy, vx), len: len });
  }
  eliteBusy(m, warn + 0.4, false);
  segs.forEach(function (s) {
    eliteVisAdd({ id: eliteVisId('wallwarn'), preset: d.v.ground, x: s.x, y: s.y, w: s.len, h: thick, a: s.a, until: GT + warn });
  });
  eliteLater(warn, function () {
    cast.pending = false;
    cast.until = GT + life;
    segs.forEach(function (s) {
      var wall = { x: s.x, y: s.y, a: s.a, len: s.len, thick: thick, until: GT + life, castId: cast.id, owner: m, def: d };
      wall.vis = eliteVisAdd({ id: eliteVisId('wall'), preset: eliteWallPreset(d, s.a), x: s.x, y: s.y, w: s.len, h: thick, a: s.a, until: wall.until });
      ELITE_RT.walls.push(wall);
      eliteBurstFx(s.x, s.y, s.len * 0.32, d.v.attack, 0);
    });
    // 升牆時把壓到的玩家與NPC推出牆外（不傷人，免得卡進牆裡）。
    eliteWallsPushOut();
  });
  return true;
}
function eliteWallCastCount() {
  for (var i = ELITE_RT.wallCasts.length - 1; i >= 0; i--) {
    var cast = ELITE_RT.wallCasts[i];
    if (!cast.pending && GT >= cast.until) ELITE_RT.wallCasts.splice(i, 1);
  }
  return ELITE_RT.wallCasts.length;
}
function eliteWallsTick(dt) {
  eliteWallCastCount();
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
  for (var i = 0; i < ws.length; i++) if (GT < ws[i].until && eliteWallHit(ws[i], ax, ay, bx, by, 0)) return true;
  return false;
}
/* 雙方移動共用掃掠線段，避免單Tick高速穿牆；pad由呼叫者傳入自己的體型。 */
function eliteClampMove(ox, oy, pos, pad) {
  if (pad === undefined) pad = ELITE_PLAYER_BODY_R * 0.6;
  var ws = ELITE_RT.walls;
  for (var i = 0; i < ws.length; i++) {
    if (GT < ws[i].until && eliteWallHit(ws[i], ox, oy, pos.x, pos.y, pad)) { pos.x = ox; pos.y = oy; return true; }
  }
  return false;
}
/* 只在直線受阻時繞牆。不搜尋地圖／網格：最多取目的地附近六面牆的角點，
   同體型、同目的地共用路網；角色沿快取角點走，短時間內不重算。
   遇到超出預算或封死的牆群就停住，最後仍由eliteClampMove防止穿牆。 */
function eliteWallWaypoint(pos, target, pad) {
  var ws = ELITE_RT.walls;
  if (!ws.length) return target;
  function clear(a, b, radius) {
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (GT < w.until && eliteWallHit(w, a.x, a.y, b.x, b.y, radius)) return false;
    }
    return true;
  }
  var nav = ELITE_RT.wallNav;
  var valid = nav && nav.walls === ws && nav.count === ws.length && GT < nav.expires;
  if (valid) {
    if (nav.routeAt !== GT) { nav.routeAt = GT; nav.routePlans = 0; }
    var cached = nav.routes.get(pos);
    if (cached && cached.pad === pad && cached.until > GT && Math.hypot(target.x - cached.tx, target.y - cached.ty) < ELITE_WALL_NAV_LIMITS.goalMove) {
      while (cached.points.length && Math.hypot(pos.x - cached.points[0].x, pos.y - cached.points[0].y) < 1) cached.points.shift();
      if (!cached.points.length) return null;
      if (GT < cached.checkAt) return cached.points[0];
      cached.checkAt = GT + ELITE_WALL_NAV_LIMITS.check;
      if (clear(pos, target, pad)) { nav.routes.delete(pos); return target; }
      if (clear(pos, cached.points[0], pad)) return cached.points[0];
    }
  }
  if (clear(pos, target, pad)) return target;
  if (!nav || nav.walls !== ws || nav.count !== ws.length || GT >= nav.expires) {
    var active = ws.filter(function (w) { return GT < w.until; });
    nav = ELITE_RT.wallNav = { walls: ws, count: ws.length, activeCount: active.length, expires: active.reduce(function (t, w) { return Math.min(t, w.until); }, Infinity), meshes: [], routes: new WeakMap() };
  }
  // 大量同時築牆時先只做碰撞，待牆減少再恢復繞行，避免路網驗邊成本隨牆數上升。
  if (nav.activeCount > ELITE_WALL_NAV_LIMITS.activeWalls) return null;
  if (nav.routeAt !== GT) { nav.routeAt = GT; nav.routePlans = 0; }
  // 每Tick只替有限角色選路，其他角色下輪重試；成功路徑沿用到牆變動或目標明顯移動。
  if (nav.routePlans >= ELITE_WALL_NAV_LIMITS.routes) return null;
  nav.routePlans++;
  // 體型向上分桶，讓同群NPC共用；路徑只會更保守，不會縮小碰撞體。
  var radius = Math.ceil(pad / ELITE_WALL_NAV_LIMITS.radiusStep) * ELITE_WALL_NAV_LIMITS.radiusStep;
  var mesh = nav.meshes.find(function (m) { return m.radius === radius && m.until > GT && Math.hypot(m.tx - target.x, m.ty - target.y) < ELITE_WALL_NAV_LIMITS.goalMove; });
  if (!mesh) {
    // 每個模擬Tick最多建立兩份共用路網；其餘體型等下一輪，避免同時冷啟造成尖峰。
    if (nav.buildAt !== GT) { nav.buildAt = GT; nav.builds = 0; }
    if (nav.builds >= ELITE_WALL_NAV_LIMITS.builds) return null;
    nav.builds++;
    var goal = { x: target.x, y: target.y, wallGoal: true };
    eliteWallPushOut(goal, radius);
    var near = ws.filter(function (w) { return GT < w.until; }).sort(function (a, b) {
      return Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y);
    }).slice(0, ELITE_WALL_NAV_LIMITS.walls);
    var points = [goal];
    near.forEach(function (w) {
      var co = Math.cos(w.a), si = Math.sin(w.a), hx = w.len / 2 + radius + 2, hy = w.thick / 2 + radius + 2;
      [-1, 1].forEach(function (x) { [-1, 1].forEach(function (y) {
        var p = { x: w.x + x * hx * co - y * hy * si, y: w.y + x * hx * si + y * hy * co };
        if (clear(p, p, radius)) points.push(p);
      }); });
    });
    var distances = points.map(function () { return Infinity; }), next = [], done = [], links = points.map(function () { return []; });
    for (var a = 0; a < points.length; a++) for (var b = a + 1; b < points.length; b++) {
      if (!clear(points[a], points[b], radius)) continue;
      var len = Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
      links[a].push({ i: b, len: len }); links[b].push({ i: a, len: len });
    }
    distances[0] = 0;
    for (var step = 0; step < points.length; step++) {
      var best = -1;
      for (var j = 0; j < points.length; j++) if (!done[j] && isFinite(distances[j]) && (best < 0 || distances[j] < distances[best])) best = j;
      if (best < 0) break;
      done[best] = true;
      links[best].forEach(function (edge) {
        var d = distances[best] + edge.len;
        if (d < distances[edge.i]) { distances[edge.i] = d; next[edge.i] = best; }
      });
    }
    mesh = { radius: radius, tx: target.x, ty: target.y, until: GT + ELITE_WALL_NAV_LIMITS.replan, points: points, distances: distances, next: next };
    nav.meshes.push(mesh);
    if (nav.meshes.length > ELITE_WALL_NAV_LIMITS.meshes) nav.meshes.shift();
  }
  var first = -1, cost = Infinity;
  for (var k = 0; k < mesh.points.length; k++) {
    var p = mesh.points[k], d = Math.hypot(pos.x - p.x, pos.y - p.y) + mesh.distances[k];
    if (d < cost && clear(pos, p, radius)) { first = k; cost = d; }
  }
  var path = [];
  for (var n = 0; first >= 0 && n < mesh.points.length; n++) {
    path.push(mesh.points[first]);
    if (first === 0) break;
    first = mesh.next[first];
  }
  nav.routes.set(pos, { tx: target.x, ty: target.y, pad: pad,
    until: path.length ? nav.expires : GT + ELITE_WALL_NAV_LIMITS.replan,
    checkAt: GT + ELITE_WALL_NAV_LIMITS.check, points: path });
  return path[0] || null;
}
function eliteWallsPushOut() {
  eliteWallPushOut(elitePos(), ELITE_PLAYER_BODY_R * 0.6);
  var enemies = eliteEnemies();
  for (var i = 0; i < enemies.length; i++) {
    var m = enemies[i], p = eliteMonsterPos(m);
    if (!p || !(m.hp > 0)) continue;
    eliteWallPushOut(p, bfEntityRadius(m) * 0.6);
  }
}
function eliteWallPushOut(p, pad) {
  var ws = ELITE_RT.walls;
  // 多面交角需反覆檢查，推出一面後不能留在另一面內。
  for (var pass = 0; pass < ws.length * 4; pass++) {
    var moved = false;
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (GT >= w.until || !eliteWallHit(w, p.x, p.y, p.x, p.y, pad)) continue;
      var c = Math.cos(w.a), s = Math.sin(w.a);
      var x = (p.x - w.x) * c + (p.y - w.y) * s;
      var y = -(p.x - w.x) * s + (p.y - w.y) * c;
      var hx = w.len / 2 + pad + 2, hy = w.thick / 2 + pad + 2;
      if (hx - Math.abs(x) < hy - Math.abs(y)) x = (x >= 0 ? 1 : -1) * hx;
      else y = (y >= 0 ? 1 : -1) * hy;
      p.x = w.x + x * c - y * s; p.y = w.y + x * s + y * c;
      moved = true;
    }
    if (!moved) break;
  }
}

/* ============ 漩渦：把你快速拉扯到牠身邊 ============ */
/* 漩渦：停下來的距離（貼到牠身邊）與拉得到的最遠距離。拉扯範圍 pullR 與漩渦畫面半徑 r 是兩回事：
   怪物常站在自己的攻擊距離（6／24／36 米）外開打，畫面上的漩渦不必有那麼大，但拉扯要能夠到。 */
function elitePullStop(m) { return (m._bodyR || 20) + ELITE_PLAYER_BODY_R + 12; }
function elitePullReach(m, d) { return (d.pullR > 0 ? d.pullR : d.r) + (m._bodyR || 20); }
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
    if (dist > elitePullReach(m, d)) return;                 // 不在拉扯範圍內：拉不到
    var stop = elitePullStop(m);
    if (dist <= stop) { eliteHitPlayer(m, { mult: d.dmg, elem: d.elem, sure: true, stun: d.stun, label: d.name }); return; }
    var ux = (pp.x - mp2.x) / dist, uy = (pp.y - mp2.y) / dist;
    var tx = mp2.x + ux * stop, ty = mp2.y + uy * stop;
    ELITE_RT.pull = { owner: m, def: d, tx: tx, ty: ty, speed: d.speed || 600, sx: pp.x, sy: pp.y, total: eliteDist(pp.x, pp.y, tx, ty) };
    floatPlayerEvent(elitePF(), STR(545), 'debuff');
  });
}
function elitePullTick(dt) {
  var pl = ELITE_RT.pull;
  if (!pl) return;
  if (!elitePlayerAlive()) { ELITE_RT.pull = null; elitePos().lift = 0; return; }
  if (pl.wallWait !== undefined) {
    pl.wallWait -= dt;
    if (pl.wallWait <= 1e-6) { ELITE_RT.pull = null; elitePullImpact(pl); }
    return;
  }
  var pp = elitePos();
  var ox = pp.x, oy = pp.y;
  var dx = pl.tx - pp.x, dy = pl.ty - pp.y, dl = Math.sqrt(dx * dx + dy * dy);
  var step = pl.speed * dt;
  if (dl <= step + 1) {
    pp.x = pl.tx; pp.y = pl.ty; pp.lift = 0;
    ELITE_RT.pull = null;
    eliteClampMove(ox, oy, pp);
    elitePullImpact(pl);
    return;
  }
  pp.x += dx / dl * step; pp.y += dy / dl * step;
  if (eliteClampMove(ox, oy, pp)) {
    // 牆只攔位移，不取消技能傷害；沿原剩餘飛行時間結算，避免提早或漏掉命中。
    pp.lift = 0; pl.wallWait = Math.max(0, (dl - step) / pl.speed); return;
  }
  /* 低拋物線：離地高度隨已走比例 k 走 4·h·k·(1-k)，起點與終點貼地、中點最高 arcH（座標單位，表上填米）。 */
  if (pl.def.arcH > 0 && pl.total > 0) {
    var k = Math.max(0, Math.min(1, 1 - dl / pl.total));
    pp.lift = 4 * pl.def.arcH * k * (1 - k);
  }
}
function elitePullImpact(pl) {
  var mp = eliteMonsterPos(pl.owner) || elitePos();
  eliteBurstFx(mp.x, mp.y, 70, pl.def.v.attack, 0, pl.def.elem);
  eliteHitPlayer(pl.owner, { mult: pl.def.dmg, elem: pl.def.elem, sure: true, stun: pl.def.stun, label: pl.def.name });
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

/* ============ 飛彈：快速後退、剎停待機後整批齊射 ============ */
function eliteCastMissiles(m, d) {
  var rng = eliteRange(d.n, [3, 5]);
  var n = eliteRandInt(rng[0], rng[1]);
  var leg1 = d.leg1 || 0.55, leg2 = d.leg2 || 0.38;
  var hold = Math.max(0, Number(d.hold) || 0);
  var windup = 0.2;
  eliteBusy(m, windup + leg1 + hold + leg2, false);
  var presets = (d.presets && d.presets.length) ? d.presets : [d.v.proj];
  eliteLater(windup, function () {
    if (!(m.hp > 0) || !elitePlayerAlive()) return;
    var mp = eliteMonsterPos(m), pp = elitePos();
    if (!mp) return;
    var ax = mp.x - pp.x, ay = mp.y - pp.y, al = Math.sqrt(ax * ax + ay * ay) || 1;
    ax /= al; ay /= al;
    var back = d.back || 32, spread = d.spread !== undefined ? d.spread : back * 1.35, missiles = [];
    for (var i = 0; i < n; i++) {
      var preset = presets[Math.floor(Math.random() * presets.length)];
      // 橫向展開與後退深度各讀自己的配置，齊射彎曲係數沿用原side。
      var side = n > 1 ? -0.8 + 1.6 * i / (n - 1) : 0;
      var bx = mp.x + ax * back - ay * spread * side;
      var by = mp.y + ay * back + ax * spread * side;
      var facing = Math.atan2(pp.y - by, pp.x - bx);
      missiles.push({ preset: preset, x: bx, y: by, side: side, facing: facing });
      eliteFlightFx(preset, mp.x, mp.y, bx, by, leg1, {
        variant: 'elite-missile-flight', bodyD: d.bodyD,
        ctrl: { x: mp.x + ax * back * 0.5, y: mp.y + ay * back * 0.5 },
        brake: true, holdSec: hold, holdAngle: facing
      });
    }
    eliteLater(leg1 + hold, function () {
      if (!(m.hp > 0) || !elitePlayerAlive()) return;
      var tp = elitePos(), lx = tp.x, ly = tp.y; // 齊射這一拍才共同鎖定落點。
      missiles.forEach(function (shot, index) {
        var mx = (shot.x + lx) / 2 - (ly - shot.y) * 0.25 * shot.side;
        var my = (shot.y + ly) / 2 + (lx - shot.x) * 0.25 * shot.side;
        eliteFlightFx(shot.preset, shot.x, shot.y, lx, ly, leg2, {
          variant: 'elite-missile-flight', bodyD: d.bodyD,
          ctrl: { x: mx, y: my }, startAngle: shot.facing
        });
      });
      eliteLater(leg2, function () {
        if (!elitePlayerAlive()) return;
        missiles.forEach(function (shot, index) {
          eliteBurstFx(lx, ly, d.r * 1.3, d.v.attack, 0, d.elem);
          if (!eliteInCircle(lx, ly, d.r)) return;
          var res = eliteHitPlayer(m, { mult: d.dmg, elem: d.elem, sure: false, label: d.name, quiet: index > 0 });
          if (res && !res.miss && !res.invuln && d.v.hit) eliteHitFx(elitePF(), d.v.hit);
        });
      });
    });
  });
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
    if (GT - rt.lastImmuneAt > 0.5) { rt.lastImmuneAt = GT; floatEnemyEvent(m, 'mv-float', STR(546), 'elite-cast'); }
    return 0;
  }
  var mult = 1;
  if (rt.ps && rt.ps.drUntil > GT && rt.ps.dr > 0) mult *= 1 - rt.ps.dr;     // 玩家技能的減傷（js/elite_boss.js）
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
  if (typeof bskOnDamaged === 'function') bskOnDamaged(m, dealt);        // 玩家技能的被動反應（js/elite_boss.js）
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
      if (eliteStatusEntry(d, 'self')) rt.enrageSid = eliteStatusEntry(d, 'self').id;   // 上身爆發與光環由 Status 表決定
      rt.rageMult = d.atk;
      m.aspd = (Number(m.aspd) || 1) * d.aspd;
      floatEnemyEvent(m, 'mv-float', STR(547, d.emoji), 'elite-cast');
      if (typeof blog === 'function') blog(STR(548, (m.name || STR(459))), 'log-enemy-skill', 'combat');
    } else if (d.arch === 'sparks') {
      eliteSparksOnHit(m, d);
    }
  }
}

/* ============ 傷害管線：這隻敵人打中玩家之後 ============ */
function eliteOnAttackHit(m, p, res, hpDamage) {
  if (!m || !m.affixes || !res || res.miss || res.invuln) return;
  var psl = m._el && m._el.ps;
  if (psl && psl.lifestealUntil > GT && psl.lifesteal > 0 && hpDamage > 0) m.hp = Math.min(m.maxHp, m.hp + hpDamage * psl.lifesteal);   // 戰神屠錄的吸血
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
        floatPlayerEvent(elitePF(), STR(549), 'debuff');
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
  var ps = rt.ps;
  var pf = 1;
  if (ps) {
    if (ps.atkUntil > GT && ps.atk > 0) pf *= 1 + ps.atk;                    // 玩家技能增益（js/elite_boss.js）
    if (ps.reaperUntil > GT && ps.reaper > 0) pf *= 1 + ps.reaper;
    if (ps.vulnUntil > GT && ps.vuln > 0) pf *= 1 + ps.vuln;                // 玩家被標記易傷：BOSS 對你的傷害提高
  }
  return (rt.rageMult > 0 ? rt.rageMult : 1) * (rt.atkUntil > GT && rt.sacMult > 0 ? rt.sacMult : 1) * av * pf;
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
      rt.invulnUntil = GT + eliteStatusDur(d, 'self', 1.6);
      if (eliteStatusEntry(d, 'self')) rt.invulnSid = eliteStatusEntry(d, 'self').id;
      if (typeof cleanse === 'function') cleanse(m);
      var mp = eliteMonsterPos(m);
      if (mp) { eliteBurstFx(mp.x, mp.y, 110, d.v.attack, 0); }
      if (d.v.attack2) {
        eliteFx({
          fxKind: 'rain', variant: 'pillar', elem: 'light', count: 1, dur: 1, hit: false,
          targets: [m.floatSel], vfx: { attack: d.v.attack2 }
        });
      }
      floatEnemyEvent(m, 'mv-float', STR(550, d.emoji), 'elite-cast');
      if (typeof blog === 'function') blog(STR(551, (m.name || STR(459)), Math.round(d.hp)), 'log-enemy-skill', 'combat');
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
      floatEnemyEvent(m, 'mv-float', STR(552, dd.emoji), 'elite-cast');
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
      /* 體積有上限：一般菁英／高級菁英每次 +size（20%）、最多 sizeMax（2 倍）；BOSS 每次 +bossSize（10%）、最多 bossSizeMax（1.5 倍）。
         體積、攻速、跑速都是連乘，不設上限在人堆裡死十隻就是 6 倍大小、6 倍攻速；體積長到上限就不再疊層。 */
      var avBoss = e._tier === 'boss' || e._tier === 'tower';
      var avStep = avBoss ? (da && da.bossSize > 0 ? da.bossSize : 0.1) : (da ? da.size : 0);
      var avCap = avBoss ? (da && da.bossSizeMax > 0 ? da.bossSizeMax : 1.5) : (da && da.sizeMax > 0 ? da.sizeMax : 2);
      if (da && (e._grow || 1) < avCap - 1e-9) {
        var rt = e._el;
        rt.avStacks = (rt.avStacks || 0) + 1;
        if (eliteStatusEntry(da, 'self')) rt.rageSid = eliteStatusEntry(da, 'self').id;
        e._grow = Math.min(avCap, (e._grow || 1) * (1 + avStep));
        e.aspd = (Number(e.aspd) || 1) * (1 + da.aspd);
        e.runSpeed = ((Number(e.runSpeed) > 0) ? Number(e.runSpeed) : (typeof bfEnemySpeed === 'function' ? bfEnemySpeed() : 210)) * (1 + da.run);
        eliteCastFx(e, da);
        floatEnemyEvent(e, 'mv-float', STR(553, da.emoji), 'elite-cast');
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
  floatEnemyEvent(m, 'mv-float', STR(554, d.emoji), 'elite-cast');
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
