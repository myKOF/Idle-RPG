'use strict';
/* ============================================================
   elite_boss_recipes.js — 封魔塔 BOSS 的玩家技能招式表（只在 Worker 載入，接在 js/elite_boss.js 之後）
   ------------------------------------------------------------
   每個超神進化技能一個函式，參數全部讀玩家那一列（c.U）與它的前置階（c.T，第 i+1 階）：
     bskU(c, key)     超神那一列的效果參數（最高等級）
     bskT(c, i, key)  第 i+1 階的效果參數（i 從 0 起算）
     c.v              畫面角色：cast／attack／proj／hit／ground／field（本體）與 attack2／proj2／hit2／ground2／field2（觸發）
   原則：pct 優先取超神自己的 pct（它代表這個進化增加的威力），沒有才取第 1 階；多段／多落點由 bskHit 遞減。
   被動型技能（反擊、天地再造…）在這裡是空招式，行為在 js/elite_boss.js 的 bskOnDamaged／eliteBossUndying。
   ============================================================ */

function bskTierRoles(c, tier) {
  var r = (typeof sgVfxRoles === 'function') ? sgVfxRoles(c.gid, { vfxTier: tier, vfxBase: true }) : {};
  return { cast: r.cast, attack: r.attack, proj: r.projectile, hit: r.hit, ground: r.ground, field: r.field };
}
function bskTierTrig(c, tierIdx, role) {
  var t = c.tiers[tierIdx];
  return (t && t.triggerVfx && t.triggerVfx[role]) || '';
}
function bskBusy(c, sec, lock) { eliteBusy(c.m, sec, !!lock); }
function bskSpeed(c, tierIdx, dflt) { return bskLen(bskT(c, tierIdx, 'speed', dflt)); }
function bskAngleToPlayer(c) {
  var mp = eliteMonsterPos(c.m), pp = elitePos();
  return mp ? Math.atan2(pp.y - mp.y, pp.x - mp.x) : 0;
}
/* 把「玩家增益％」轉成 BOSS 增益的係數：乘 psBuffPct，並限制上限 cap（避免疊出無限大）。 */
function bskBuffFactor(pct, cap) { return Math.min(cap === undefined ? 1 : cap, Math.max(0, pct) / 100 * bskBuff()); }
function bskStatusOnPlayer(sid, dur, val, maxStacks) {
  var p = elitePlayer();
  if (!p || !sid || typeof applyStatus !== 'function') return;
  applyStatus(p, sid, { dur: dur, val: val, maxStacks: maxStacks });
}
/* 玩家被標記易傷：BOSS 對玩家的所有傷害提高（js/elite.js eliteAtkFactor 讀 ps.vuln）。 */
function bskVuln(c, fraction, dur) {
  var ps = bskPs(c.m);
  ps.vuln = Math.max(0, Math.min(1, fraction));
  ps.vulnUntil = Math.max(ps.vulnUntil, GT + dur);
}
function bskEnemySid(c, idx) {
  var e = c.d.status && c.d.status.enemy && c.d.status.enemy[idx || 0];
  return e ? e.id : '';
}

/* ===================== 飛刀 ===================== */
BSK_RECIPES.petalStorm = function (c) {
  bskBusy(c, 1.3);
  bskVolley(c, {
    n: bskT(c, 0, 'count', 2) + 3, gap: 0.1, spreadDeg: bskT(c, 0, 'deg', 60), speed: bskSpeed(c, 0, 50), proj: c.v.proj,
    pierceLen: bskLen(14), pierceW: 34, pct: bskT(c, 0, 'pct') + bskU(c, 'pct'), sure: false
  });
};
BSK_RECIPES.deathReaper = function (c) {
  bskBusy(c, 1.2);
  var ps = bskPs(c.m);
  var maxStacks = Math.max(1, Math.floor(bskU(c, 'maxStacks', 20)));
  var dur = bskU(c, 'dur', 8);
  var per = bskU(c, 'pct', 25) / 100 * bskBuff();
  var sid = bskSelfSid(c, 0);
  bskVolley(c, {
    n: bskT(c, 0, 'count', 2) + 1, gap: 0.12, spreadDeg: bskT(c, 0, 'deg', 60) * 0.6, speed: bskSpeed(c, 0, 50), proj: c.v.proj,
    hitR: 40, pct: bskT(c, 0, 'pct'), sure: false,
    onHit: function () {
      if (ps.reaperUntil <= GT) ps.reaperStacks = 0;
      ps.reaperStacks = Math.min(maxStacks, (ps.reaperStacks || 0) + 1);
      ps.reaper = Math.min(1, ps.reaperStacks * per);
      ps.reaperUntil = GT + dur;
      bskSelfStatus(c, sid, dur, { maxStacks: maxStacks });
    }
  });
};
BSK_RECIPES.soulhunterBlade = function (c) {
  bskBusy(c, 1.2);
  var speed = bskSpeed(c, 0, 50);
  bskVolley(c, { n: bskT(c, 0, 'count', 2), gap: 0.15, spreadDeg: bskT(c, 0, 'deg', 60) * 0.5, speed: speed, proj: c.v.proj, hitR: 40, pct: bskT(c, 0, 'pct') * 0.6, sure: false });
  bskChase(c, {
    legs: Math.max(3, Math.floor(bskU(c, 'sec', 8) / 1.3)), speed: speed * 0.6, proj: c.v.proj, hitR: 38,
    pct: bskT(c, 0, 'pct') * 0.4, pctStep: bskU(c, 'pct', 4) * 8, startDelay: 0.5
  });
};

/* ===================== 突刺 ===================== */
function bskThrustGeom(c) {
  var r = (typeof sgRange === 'function') ? sgRange(c.g.range, c.lv) : { length: 12, width: 3 };
  var scale = 1 + bskT(c, 3, 'range', 0) / 100;
  return { len: bskLen((r.length || 12) * scale), width: Math.max(24, bskLen(r.width || 3)) };
}
BSK_RECIPES.phantomOcta = function (c) {
  bskBusy(c, 1.6, true);
  var g = bskThrustGeom(c);
  var base = bskAngleToPlayer(c);
  var dirs = Math.max(2, Math.floor(bskU(c, 'directions', 8)));
  var angles = [];
  for (var i = 0; i < dirs; i++) angles.push(base + i * Math.PI * 2 / dirs);
  bskLines(c, { angles: angles, len: g.len, width: g.width, warn: 1.0, pct: bskT(c, 0, 'pct'), hits: Math.max(1, Math.round(bskT(c, 0, 'count', 2) * 0.5)), proj: c.v.attack });
  var add = bskU(c, 'dodge', 30), sec = bskU(c, 'sec', 2) + 1.0;
  eliteLater(1.0, function () {
    if (!(c.m.hp > 0)) return;
    c.m.dodge = (c.m.dodge || 0) + add;
    bskSelfStatus(c, bskSelfSid(c, 0), sec);
    eliteLater(sec, function () { c.m.dodge = (c.m.dodge || 0) - add; });
  });
};
BSK_RECIPES.shadowExecutioner = function (c) {
  bskBusy(c, 1.5, true);
  var g = bskThrustGeom(c);
  var ps = bskPs(c.m);
  var per = bskU(c, 'perStack', 1) / 100;
  var maxStacks = Math.max(1, Math.floor(bskU(c, 'maxStacks', 100)));
  var dur = bskU(c, 'dur', 30);
  var sid = bskEnemySid(c, 0);
  bskLines(c, {
    len: g.len, width: g.width, warn: 1.0, pct: bskT(c, 0, 'pct'), hits: 2, proj: c.v.attack,
    onHit: function () {
      if (ps.soulUntil <= GT) ps.soulStacks = 0;
      ps.soulStacks = Math.min(maxStacks, (ps.soulStacks || 0) + 1);
      ps.soulUntil = GT + dur;
      bskVuln(c, ps.soulStacks * per, dur);
      bskStatusOnPlayer(sid, dur, ps.soulStacks * per * 100, maxStacks);
    }
  });
};
BSK_RECIPES.oneStrikeKill = function (c) {
  bskBusy(c, 1.9, true);
  var g = bskThrustGeom(c);
  bskLines(c, { len: g.len, width: g.width * 0.8, warn: 1.4, pct: bskT(c, 0, 'pct') * bskU(c, 'mult', 4) * 0.5, hits: 1, proj: c.v.attack });
};

/* ===================== 迴旋斬 ===================== */
function bskCleaveR(c, tierIdx) {
  var m = bskT(c, tierIdx, 'm', 12);
  var range = 1 + bskT(c, 1, 'range', 0) / 100;
  return bskRad(m * range);
}
BSK_RECIPES.voidShatter = function (c) {
  bskBusy(c, 1.6, true);
  var times = Math.max(1, Math.round(bskT(c, 6, 'times', 2) + bskU(c, 'times', 1)));
  bskRing(c, { r: bskCleaveR(c, 5), times: times, waveGap: 0.35, warn: 1.0, pct: bskT(c, 0, 'pct') * 0.6, proj: c.v.proj });
};
BSK_RECIPES.windChaser = function (c) {
  bskBusy(c, 1.8, true);
  var r = bskCleaveR(c, 0);
  bskRing(c, { r: r, times: 1, warn: 1.0, pct: bskT(c, 0, 'pct'), proj: c.v.proj });
  var hits = Math.max(1, Math.floor(bskU(c, 'hits', 4)));
  var gap = bskU(c, 'gap', 0.2);
  eliteLater(1.1, function () {
    if (!bskAlive(c.m)) return;
    var mp = eliteMonsterPos(c.m);
    if (mp && c.v.attack2) eliteBurstFx(mp.x, mp.y, r, c.v.attack2, 0, 'wind');
    bskTicks(c.m, hits * gap, gap, function (k) {
      var mp2 = eliteMonsterPos(c.m) || mp;
      bskCircleHit(c, mp2.x, mp2.y, r, bskU(c, 'pct', 100), { elem: 'wind', sure: true, quiet: k > 0, hitPreset: c.v.hit2 });
    });
  });
};
BSK_RECIPES.stormGodSlash = function (c) {
  bskBusy(c, 1.5, true);
  var r = bskCleaveR(c, 0) * (1 + bskU(c, 'range', 30) / 100);
  bskRing(c, { r: Math.min(r, bskLen(16)), times: 1, warn: 0.9, pct: bskT(c, 0, 'pct') + bskT(c, 2, 'pct'), proj: c.v.proj });
};

/* ===================== 疾風迅雷 ===================== */
BSK_RECIPES.thunderFlash = function (c) {
  bskBusy(c, 1.8, true);
  var pp = elitePos();
  var px = pp.x, py = pp.y;
  var r = bskRad(bskT(c, 0, 'm', 10));
  var hits = Math.max(1, Math.round(bskT(c, 0, 'hits', 3) * 0.6));
  var gap = bskT(c, 0, 'gap', 0.35);
  var t1 = bskTierRoles(c, 7);
  bskWarnCircle(c, px, py, r, 0.9);
  eliteLater(0.9, function () {
    if (!bskAlive(c.m)) return;
    eliteBurstFx(px, py, r * 1.1, t1.attack, 0, c.elem);
    bskTicks(c.m, hits * gap, gap, function (k) { bskCircleHit(c, px, py, r, bskT(c, 0, 'pct'), { quiet: k > 0 }); });
  });
  var base = bskAngleToPlayer(c);
  var n = Math.max(1, Math.floor(bskU(c, 'count', 3)));
  var angles = [];
  for (var i = 0; i < n; i++) angles.push(base + (i - (n - 1) / 2) * 0.28);
  eliteLater(0.9 + hits * gap, function () {
    if (!bskAlive(c.m)) return;
    bskLines(c, { angles: angles, len: bskLen(60), width: Math.min(bskRad(bskU(c, 'wid', 10)), bskLen(6)), warn: 0.7, pct: bskU(c, 'pct') * 0.5, proj: c.v.attack2, speed: 1800 });
  });
};
BSK_RECIPES.thunderGodSlash = function (c) {
  bskBusy(c, 1.6, true);
  var pp = elitePos();
  var px = pp.x, py = pp.y;
  var r = bskRad(bskT(c, 0, 'm', 10));
  var hits = Math.max(1, Math.round(bskT(c, 0, 'hits', 3) * 0.6));
  var gap = bskT(c, 0, 'gap', 0.35);
  bskWarnCircle(c, px, py, r, 0.9);
  eliteLater(0.9, function () {
    if (!bskAlive(c.m)) return;
    eliteBurstFx(px, py, r * 1.1, bskTierRoles(c, 1).attack, 0, c.elem);
    bskTicks(c.m, hits * gap, gap, function (k) { bskCircleHit(c, px, py, r, bskT(c, 0, 'pct'), { quiet: k > 0 }); });
  });
  bskSpots(c, {
    n: 2, spread: bskLen(7), r: Math.min(bskRad(bskU(c, 'm', 8)), bskLen(6)), warn: 1.1, step: 0.3, pct: bskU(c, 'pct'),
    fall: 'strike', fallPreset: c.v.attack2, elem: 'lightning'
  });
};
BSK_RECIPES.chidori = function (c) {
  bskBusy(c, 1.8);
  bskSpots(c, {
    n: Math.max(2, Math.floor(bskU(c, 'count', 5))), spread: bskLen(9), r: bskRad(5), warn: 0.8, step: 0.12,
    pct: bskU(c, 'pct') + bskU(c, 'scatterPct') * 0.5, burstPreset: c.v.attack, burstScale: 1.0
  });
};

/* ===================== 血刃斬 ===================== */
BSK_RECIPES.slayerDomain = function (c) {
  bskBusy(c, 1.0);
  var r = bskRad(bskU(c, 'm', 24));
  var dur = 8;
  bskSelfStatus(c, bskSelfSid(c, 1), dur, { vfxR: r });
  bskDomain(c, {
    r: r, dur: dur, tick: 1.0, pct: bskT(c, 0, 'pct') * 0.6,
    dot: { id: 'sgBleed', name: STR(1709), pct: bskT(c, 0, 'dotPct', 30), dur: 3 },
    onTick: function () { bskHeal(c, bskU(c, 'healPct', 2) / 8); }
  });
};
BSK_RECIPES.venomDomain = function (c) {
  bskBusy(c, 1.0);
  var r = Math.min(bskRad(bskU(c, 'm', 30)), bskLen(18));
  var dur = Math.min(bskU(c, 'dur', 10), 8);
  bskSelfStatus(c, bskSelfSid(c, 0), dur, { vfxR: r });
  bskDomain(c, {
    r: r, dur: dur, tick: Math.max(0.4, bskU(c, 'gap', 0.5)), pct: bskU(c, 'pct') * 0.5,
    dot: { id: 'sgPoison', name: '萬毒侵蝕', pct: 40, dur: 3 }, hitPreset: c.v.hit2
  });
};
BSK_RECIPES.disintegrate = function (c) {
  bskBusy(c, 1.2);
  var dotDur = 4;
  var boomR = bskRad(bskU(c, 'm', 6));
  bskSpots(c, {
    n: 1, r: Math.max(bskRad(5), 30), warn: 0.7, pct: bskT(c, 0, 'pct'), burstPreset: c.v.attack, burstScale: 1.0,
    dot: { id: 'sgBleed', name: STR(1709), pct: bskT(c, 0, 'dotPct', 30) * (1 + bskU(c, 'gapPct', 40) / 100), dur: dotDur },
    onImpact: function () {
      eliteLater(dotDur, function () {
        if (!bskAlive(c.m)) return;
        var q = elitePos();
        var qx = q.x, qy = q.y;
        bskWarnCircle(c, qx, qy, boomR, 0.8);
        var mp = eliteMonsterPos(c.m);
        if (mp && c.v.proj2) bskFlight(c, c.v.proj2, mp, { x: qx, y: qy }, 0.7, { arcM: 3 });
        eliteLater(0.8, function () {
          if (!bskAlive(c.m)) return;
          if (c.v.attack2) eliteBurstFx(qx, qy, boomR * 1.2, c.v.attack2, 0, c.elem);
          bskCircleHit(c, qx, qy, boomR, bskU(c, 'pct') * 2);
        });
      });
    }
  });
};

/* ===================== 雙刀亂舞 ===================== */
function bskDualSlashes(c, n, pctEach, o) {
  o = o || {};
  var m = c.m;
  var pp = elitePos();
  var r = bskRad(o.r || 4);
  for (var i = 0; i < n; i++) {
    (function (k) {
      var x, y;
      if (k === 0) { x = pp.x; y = pp.y; }
      else { var a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * bskLen(o.spread || 5); x = pp.x + Math.cos(a) * d; y = pp.y + Math.sin(a) * d; }
      var warn = (o.warn || 0.7) + k * (o.step || 0.12);
      bskWarnCircle(c, x, y, r, warn);
      eliteLater(warn, function () {
        if (!bskAlive(m)) return;
        eliteBurstFx(x, y, r * 1.1, c.v.attack, 0, c.elem);
        bskCircleHit(c, x, y, r, pctEach, { quiet: k > 0, dot: o.dot });
      });
    })(i);
  }
}
BSK_RECIPES.doomDance = function (c) {
  bskBusy(c, 2.0);
  var take = Math.min(c.m.hp - 1, c.m.hp * Math.max(0, bskU(c, 'hpPct', 5)) / 100);
  if (take > 0) { c.m.hp -= take; floatEnemyEvent(c.m, 'mv-float', '-' + fmt(take), 'elite-cast'); }
  var n = Math.round(bskT(c, 0, 'count', 2) + bskT(c, 1, 'add', 1) + bskU(c, 'add', 3));
  bskDualSlashes(c, n, bskT(c, 0, 'pct') * 0.25 * (1 + bskU(c, 'pct', 0) / 400));
};
BSK_RECIPES.flameKagura = function (c) {
  bskBusy(c, 2.0);
  var n = Math.round(bskT(c, 0, 'count', 2) + bskT(c, 1, 'add', 1));
  bskDualSlashes(c, n, bskT(c, 0, 'pct') * 0.25, { dot: { id: 'sgKagura', name: '神樂灼焰', pct: bskU(c, 'pct', 30) * 2, dur: 5 } });
};
BSK_RECIPES.asuraDance = function (c) {
  bskBusy(c, 2.2);
  var n = Math.round((bskT(c, 0, 'count', 2) + bskT(c, 1, 'add', 1)) * 2);
  bskDualSlashes(c, n, bskT(c, 0, 'pct') * 0.2 * (1 + bskU(c, 'pct', 20) / 100), { spread: 6 });
};

/* ===================== 反擊（被動：BOSS 被打時反應／致命傷時復活）===================== */
BSK_RECIPES.holyBody = function () { /* 被動：js/elite_boss.js bskOnDamaged */ };
BSK_RECIPES.skyCollapse = function () { /* 被動：js/elite_boss.js bskOnDamaged */ };
BSK_RECIPES.indomitable = function () { /* 被動：js/elite_boss.js eliteBossUndying */ };
BSK_RECIPES.worldRebirth = function () { /* 被動：js/elite_boss.js eliteBossUndying */ };
BSK_RECIPES.fateReversal = function () { /* 被動：js/elite_boss.js eliteBossUndying */ };
BSK_RECIPES.warGodBody = function (c) {
  bskBusy(c, 1.0);
  var lose = Math.min(c.m.hp - 1, c.m.maxHp * bskU(c, 'hpPct', 1) / 100 * 3);
  if (lose > 0) { c.m.hp -= lose; floatEnemyEvent(c.m, 'mv-float', '-' + fmt(lose), 'elite-cast'); }
  var lostPct = Math.max(0, lose) / Math.max(1, c.m.maxHp) * 100;
  bskBuffAtk(c, bskBuffFactor(lostPct * bskU(c, 'mult', 2) * 10, 0.8), 6);
  bskSelfStatus(c, 'eRage', 6);
};

/* ===================== 嗜血狂怒（自身增益）===================== */
function bskRage(c, atkPct, dur, cast) {
  bskBusy(c, 1.0);
  bskBuffAtk(c, bskBuffFactor(atkPct, 0.8), dur);
  bskSelfStatus(c, 'sgBloodrage', dur);
  var mp = eliteMonsterPos(c.m);
  if (mp && cast) eliteBurstFx(mp.x, mp.y, 70, cast, 0);
}
BSK_RECIPES.slayerAdvent = function (c) {
  bskRage(c, bskT(c, 2, 'pct', 20) + bskU(c, 'pct', 100), bskT(c, 0, 'sec', 8), c.v.attack2);
  bskRing(c, { r: bskRad(bskU(c, 'm', 8)), times: 1, warn: 0.8, pct: bskT(c, 0, 'pct', 20) * 4, attack: c.v.attack2 });
};
BSK_RECIPES.warGodRoll = function (c) {
  var dur = bskT(c, 0, 'sec', 8);
  bskRage(c, bskT(c, 2, 'pct', 20) + 40, dur, c.v.attack2);
  var ps = bskPs(c.m);
  ps.lifesteal = Math.min(0.3, bskU(c, 'drain', 100) / 100 * bskBuff() * 0.3);
  ps.lifestealUntil = GT + dur;
  bskSelfStatus(c, bskSelfSid(c, 0), dur);
};
BSK_RECIPES.asuraFist = function (c) {
  var dur = bskU(c, 'sec', 1) + 2;
  bskRage(c, bskU(c, 'pct', 300), dur, c.v.attack2);
  bskSelfStatus(c, bskSelfSid(c, 0), dur);
};

/* ===================== 火球術 ===================== */
function bskMeteorSpots(c, n, pct, spreadM, o) {
  o = o || {};
  var t7 = bskTierRoles(c, 7);
  var r = Math.min(bskRad(bskT(c, 6, 'm', 15) * (1 + (o.sizePct || 0) / 100)), bskLen(9));
  return bskSpots(c, {
    n: n, spread: bskLen(spreadM), r: r, warn: o.warn || 1.2, step: o.step || 0.25, pct: pct,
    fall: 'rain', fallPreset: t7.proj, burstPreset: t7.hit, warnPreset: t7.ground, burstScale: 1.0
  });
}
BSK_RECIPES.meteorFall = function (c) {
  bskBusy(c, 2.2);
  var n = Math.min(6, Math.round(bskT(c, 6, 'count', 3) + bskU(c, 'count', 8)));
  bskMeteorSpots(c, n, bskT(c, 6, 'pct') + bskU(c, 'pct'), 16, { sizePct: bskU(c, 'size', 30), step: 0.28 });
};
BSK_RECIPES.starfallCataclysm = function (c) {
  bskBusy(c, 3.0);
  var pp = elitePos();
  var warn = (typeof SG_STARFALL_WARN_SEC === 'number') ? SG_STARFALL_WARN_SEC : 5;
  var r = Math.min(bskRad(bskT(c, 6, 'm', 15) * ((typeof SG_STARFALL_SIZE_MULT === 'number') ? SG_STARFALL_SIZE_MULT : 3)), bskLen(22));
  var x = pp.x, y = pp.y;
  bskWarnCircle(c, x, y, r, warn, c.v.ground);
  var fall = 0.9;
  eliteFx({
    fxKind: 'rain', variant: 'elite-rain', elem: c.elem, count: 1, dur: fall, hit: false,
    delayMs: Math.round((warn - fall) * 1000), travelMs: [Math.round(fall * 1000)],
    area: { x: x, y: y, fixedLanding: true }, vfx: { projectile: c.v.proj }
  });
  eliteLater(warn, function () {
    if (!bskAlive(c.m)) return;
    if (c.v.attack2) eliteBurstFx(x, y, r * 1.1, c.v.attack2, 0, c.elem);
    if (c.v.hit) eliteBurstFx(x, y, r, c.v.hit, 0, c.elem);
    bskCircleHit(c, x, y, r, bskT(c, 6, 'pct') * 1.2);
  });
};
BSK_RECIPES.phoenixPrairie = function (c) {
  bskBusy(c, 2.2);
  var n = Math.min(4, Math.round(bskT(c, 6, 'count', 3) + bskU(c, 'count', 1)));
  var bonus = 1 + bskU(c, 'pct', 100) / 100 * 0.4;
  bskMeteorSpots(c, n, bskT(c, 6, 'pct') * bonus, 15, { step: 0.3 });
  bskSpots(c, {
    n: Math.min(6, Math.round(bskU(c, 'balls', 10) * 0.5)), spread: bskLen(14), r: bskRad(bskT(c, 0, 'm', 6)), warn: 1.0, step: 0.12,
    pct: bskT(c, 0, 'pct') * bonus * 0.3, fall: 'rain', fallPreset: c.v.proj, burstPreset: c.v.hit, burstScale: 1.0, first: false
  });
};

/* ===================== 火龍捲 ===================== */
BSK_RECIPES.infernoTempest = function (c) {
  bskBusy(c, 2.4);
  bskVolley(c, {
    n: 4, gap: 0.6, startDelay: 0.5, speed: bskLen(bskU(c, 'speed', 36)), proj: c.v.proj2, track: true,
    burstR: bskRad(bskU(c, 'm', 6)), burstPreset: c.v.attack2, pct: bskU(c, 'pct') * 0.5, sure: true
  });
};
BSK_RECIPES.eternalInferno = function (c) {
  bskBusy(c, 1.2);
  var t7 = bskTierRoles(c, 7);
  var pp = elitePos();
  var r = bskRad(bskT(c, 0, 'm', 3) * 2);
  var sec = Math.min(bskU(c, 'sec', 6), 7);
  var speed = bskLen(bskT(c, 6, 'speed', 6)) * 2;
  var wander = 0;
  bskField(c, {
    x: pp.x, y: pp.y, r: r, life: sec, tick: 0.4, pct: bskT(c, 0, 'pct') * 0.8, preset: t7.field, warn: 0.8,
    move: function (f, dt) {
      var tp = elitePos();
      wander += dt;
      var tx = tp.x + Math.cos(wander * 1.7) * 80, ty = tp.y + Math.sin(wander * 2.3) * 80;
      var dx = tx - f.x, dy = ty - f.y, dl = Math.sqrt(dx * dx + dy * dy) || 1;
      var st = Math.min(dl, speed * dt);
      f.x += dx / dl * st; f.y += dy / dl * st;
    },
    onSpawn: function (f) {
      bskTicks(c.m, sec, 1.0, function () {
        bskField(c, {
          x: f.x, y: f.y, r: bskRad(bskU(c, 'm', 20) * 0.2), life: bskU(c, 'sec', 6) * 0.6, tick: Math.max(0.4, bskU(c, 'gap', 0.5)),
          pct: bskU(c, 'pct'), preset: c.v.ground2
        });
      });
    }
  });
};
BSK_RECIPES.dragonDevour = function (c) {
  bskBusy(c, 1.4);
  var sec = Math.min(bskU(c, 'sec', 8), 6);
  var r = Math.min(bskRad(bskU(c, 'm', 15)), bskLen(10));
  bskDomain(c, { r: r, dur: sec, tick: Math.max(0.4, bskU(c, 'gap', 0.35)), pct: bskU(c, 'pct') * 0.7, pull: bskLen(3), preset: c.v.field });
  bskTicks(c.m, sec, 1.0, function () {
    var n = Math.round(bskRand(bskU(c, 'ballMin', 2), bskU(c, 'ballMax', 4)));
    bskSpots(c, {
      n: Math.max(1, Math.min(2, n)), spread: bskLen(10), r: bskRad(bskU(c, 'ballM', 6)), warn: 0.9, step: 0.15, pct: bskU(c, 'ballPct', 400) * 0.4,
      fall: 'rain', fallPreset: c.v.proj, burstPreset: c.v.attack2, burstScale: 1.0, first: false
    });
  });
};

/* ===================== 火狩 ===================== */
BSK_RECIPES.solarRing = function (c) {
  bskBusy(c, 0.9);
  var r0 = bskLen(bskT(c, 0, 'm', 8) * 0.9);
  bskOrbit(c, {
    n: Math.round(bskT(c, 3, 'count', 3) + bskU(c, 'count', 1)), dur: Math.min(6, bskT(c, 0, 'sec', 4) + 2),
    rps: bskT(c, 0, 'rps', 0.45) * (1 + bskU(c, 'spin', 30) / 100), r0: r0, r1: r0 * (1 + bskU(c, 'grow', 60) / 100), orbR: 16,
    pct: bskT(c, 3, 'pct') * 0.8 + bskU(c, 'pct'), touchCd: 0.6, orbPreset: c.v.proj, ringPreset: c.v.ground, auraVariant: 'firehunt'
  });
  bskSelfStatus(c, 'sgFirehunt', 6);
};
BSK_RECIPES.infiniteRing = function (c) {
  bskBusy(c, 0.9);
  bskOrbit(c, {
    n: 6, dur: 6, rps: bskT(c, 0, 'rps', 0.45), r0: 40, r1: bskLen(bskU(c, 'm', 40) * 0.5), orbR: 16,
    pct: bskT(c, 3, 'pct'), touchCd: 0.6, orbPreset: c.v.proj, ringPreset: c.v.ground, auraVariant: 'firehunt'
  });
};
BSK_RECIPES.fireGodDescend = function (c) {
  bskBusy(c, 1.2);
  var dur = 6;
  var bodyR = bskLen(bskU(c, 'm', 6));
  bskSelfStatus(c, bskSelfSid(c, 0), dur, { vfxR: bodyR });
  bskDomain(c, { r: bodyR * 1.5, dur: dur, tick: Math.max(0.5, bskU(c, 'gap', 0.5)), pct: bskU(c, 'pct') * 0.5, hitPreset: c.v.hit });
  bskVolley(c, {
    n: Math.round(bskU(c, 'orbs', 3)), gap: 0.1, spreadDeg: 50, speed: bskLen(bskU(c, 'speed', 24)) * 2, proj: c.v.proj,
    pierceLen: bskLen(bskU(c, 'flyM', 50)) * 0.5, pierceW: 50, pct: bskT(c, 0, 'pct'), startDelay: 0.8
  });
};

/* ===================== 岩甲術 ===================== */
BSK_RECIPES.superRockArt = function (c) {
  bskBusy(c, 1.6, true);
  var r = Math.min(bskRad(bskU(c, 'm', 24)), bskLen(14));
  var mp = eliteMonsterPos(c.m);
  if (!mp) return;
  bskWarnCircle(c, mp.x, mp.y, r, 1.0, c.v.ground);
  eliteLater(1.0, function () {
    if (!bskAlive(c.m)) return;
    var mp2 = eliteMonsterPos(c.m) || mp;
    eliteBurstFx(mp2.x, mp2.y, r, c.v.attack, 0, c.elem);
    bskCircleHit(c, mp2.x, mp2.y, r, 60, { stun: bskU(c, 'sec', 2), label: c.d.name + '·石化' });
    for (var w = 0; w < 3; w++) {
      (function (k) {
        eliteLater(0.6 + k * 0.9, function () {
          if (!bskAlive(c.m)) return;
          bskSpots(c, {
            n: 3, spread: bskLen(6), r: bskRad(3), warn: 0.5, step: 0.08, pct: bskU(c, 'pct') * 0.6,
            fall: 'strike', fallPreset: c.v.attack2, elem: 'earth'
          });
        });
      })(w);
    }
  });
};
BSK_RECIPES.adamantBody = function (c) {
  bskBusy(c, 1.0);
  var dur = bskT(c, 0, 'sec', 10);
  var shield = (bskT(c, 0, 'pct') + bskT(c, 1, 'pct')) * bskG('ShieldPct', 15) / 100 * (1 + bskU(c, 'hp', 50) / 100) / 2;
  if (typeof applyShield === 'function') applyShield(c.m, shield, dur, 'shield');
  bskBuffDr(c, Math.min(0.5, bskU(c, 'red', 40) / 100 * 0.55), dur);
  bskSelfStatus(c, 'sgRockArmor', dur);
  var mp = eliteMonsterPos(c.m);
  if (mp && c.v.ground) eliteBurstFx(mp.x, mp.y, 90, c.v.ground, 0);
};
BSK_RECIPES.gravityField = function (c) {
  bskBusy(c, 1.5, true);
  var r = bskRad(bskU(c, 'm', 12));
  var mp = eliteMonsterPos(c.m);
  if (!mp) return;
  bskWarnCircle(c, mp.x, mp.y, r, 0.9);
  eliteLater(0.9, function () {
    if (!bskAlive(c.m)) return;
    var mp2 = eliteMonsterPos(c.m) || mp;
    eliteBurstFx(mp2.x, mp2.y, r, c.v.attack, 0, c.elem);
    bskCircleHit(c, mp2.x, mp2.y, r, bskU(c, 'pct') * 0.5, { slow: 2.5, atkDown: bskU(c, 'stiff', 65) * 0.5, dur: bskU(c, 'stiffSec', 5) });
  });
  bskSelfStatus(c, bskSelfSid(c, 0), 6, { vfxR: r });
};

/* ===================== 泥沼術 ===================== */
function bskMireSize() { return Math.min(bskRad(9), bskLen(7)); }
BSK_RECIPES.plagueMire = function (c) {
  bskBusy(c, 1.0);
  var pp = elitePos();
  bskField(c, {
    x: pp.x, y: pp.y, r: bskMireSize(), life: Math.min(8, bskU(c, 'sec', 8)), tick: Math.max(0.4, bskU(c, 'gap', 0.35)),
    pct: bskU(c, 'pct'), preset: c.v.ground, warn: 0.9, slow: 1.2, dot: { id: 'sgPlague', name: '惡疫', pct: 30, dur: 3 }
  });
};
BSK_RECIPES.abyssInferno = function (c) {
  bskBusy(c, 1.0);
  var pp = elitePos();
  var life = 8;
  var fallSec = bskU(c, 'ballSec', 0.9);
  bskField(c, {
    x: pp.x, y: pp.y, r: bskMireSize(), life: life, tick: 0.5, pct: bskT(c, 6, 'dotPct', 70) * 0.8, preset: c.v.ground, warn: 0.9,
    onSpawn: function () {
      bskTicks(c.m, life, Math.max(0.8, bskU(c, 'gap', 1)), function () {
        var mp = eliteMonsterPos(c.m);
        var n = Math.max(1, Math.min(2, Math.round(bskU(c, 'count', 3) * 0.6)));
        for (var i = 0; i < n; i++) {
          var tp = elitePos();
          var a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * bskLen(8);
          var x = tp.x + Math.cos(a) * d, y = tp.y + Math.sin(a) * d;
          var rr = bskRad(bskU(c, 'm', 6));
          bskWarnCircle(c, x, y, rr, fallSec);
          if (mp) bskFlight(c, c.v.proj, mp, { x: x, y: y }, fallSec, { arcM: bskU(c, 'arcM', 12) });
          (function (px, py) {
            eliteLater(fallSec, function () {
              if (!bskAlive(c.m)) return;
              eliteBurstFx(px, py, rr * 1.15, c.v.attack2, 0, c.elem);
              bskCircleHit(c, px, py, rr, bskU(c, 'pct') * 0.5, { quiet: true });
            });
          })(x, y);
        }
      });
    }
  });
};
BSK_RECIPES.netherMire = function (c) {
  bskBusy(c, 1.0);
  var pp = elitePos();
  var hpLine = bskU(c, 'hpPct', 30) / 100;
  var chance = bskU(c, 'chance', 0.5);
  var add = bskU(c, 'add', 0.5);
  var roll = chance;
  bskField(c, {
    x: pp.x, y: pp.y, r: bskMireSize(), life: 8, tick: 0.5, pct: bskT(c, 6, 'dotPct', 70) * 0.8, preset: c.v.ground, warn: 0.9, slow: 1.2,
    onTick: function (inside) {
      if (!inside) return;
      var p = elitePlayer();
      var hp = p ? p.hp / Math.max(1, getStats().hp) : 1;
      if (hp > hpLine) return;
      roll += add;
      if (Math.random() * 100 < roll) {
        floatPlayerEvent(elitePF(), '黃泉!', 'debuff');
        bskHit(c, 900, { dim: false, sure: true, label: c.d.name + '·斬殺' });
        roll = chance;
      }
    }
  });
};

/* ===================== 大地守護 ===================== */
BSK_RECIPES.hallOfRadiance = function (c) {
  bskBusy(c, 0.8);
  var m = c.m;
  var pct = bskU(c, 'pct', 2) * 0.6;
  bskTicks(m, 8, Math.max(1, bskU(c, 'sec', 2)), function () {
    var before = m.hp;
    var add = m.maxHp * pct / 100;
    m.hp = Math.min(m.maxHp, m.hp + add);
    var over = add - (m.hp - before);
    if (over > 0 && typeof applyShield === 'function') applyShield(m, Math.min(5, over / m.maxHp * 100 * bskU(c, 'conv', 25) / 100 * 4), 6, 'shield');
    if (m.hp > before) floatEnemyEvent(m, 'mv-float', '+' + fmt(m.hp - before), 'elite-heal');
    eliteFx({ fxKind: 'rain', variant: 'pillar', elem: 'light', count: 1, dur: 1, hit: false, targets: [m.floatSel], vfx: { attack: c.v.attack } });
  });
};

/* ===================== 連鎖閃電 ===================== */
BSK_RECIPES.skyThunderArray = function (c) {
  bskBusy(c, 1.2);
  var gap = Math.max(0.8, bskU(c, 'gap', 1));
  var volleys = Math.max(2, Math.min(5, Math.floor(bskU(c, 'sec', 2) / gap) + 1));
  var per = Math.max(1, Math.round(bskT(c, 0, 'count', 3) * 0.6));
  for (var v = 0; v < volleys; v++) {
    (function (k) {
      eliteLater(0.3 + k * gap, function () {
        if (!bskAlive(c.m)) return;
        for (var b = 0; b < per; b++) {
          (function (j) {
            eliteLater(j * 0.2, function () { if (bskAlive(c.m)) bskBolt(c, { pct: bskT(c, 0, 'pct') * 0.5, quiet: k > 0 || j > 0 }); });
          })(b);
        }
      });
    })(v);
  }
};
BSK_RECIPES.eternalSuperconductor = function (c) {
  bskBusy(c, 1.0);
  var ps = bskPs(c.m);
  var per = bskU(c, 'pct', 2) / 100 * 2;
  var stacks = 0;
  bskSelfStatus(c, bskSelfSid(c, 0), 8);
  bskTicks(c.m, 8, 0.8, function (k) {
    stacks++;
    ps.atk = Math.max(ps.atk, Math.min(0.5, stacks * per));
    ps.atkUntil = Math.max(ps.atkUntil, GT + 2);
    bskBolt(c, { pct: bskT(c, 0, 'pct') * 0.4, proj: c.v.proj2, hitPreset: c.v.hit2, quiet: k > 0 });
  });
};
BSK_RECIPES.flyingThunderGod = function (c) {
  bskBusy(c, 1.2);
  var n = Math.round(bskRand(bskU(c, 'count', 4), bskU(c, 'countMax', 6)));
  var width = Math.min(bskRad(bskU(c, 'wid', 30)), bskLen(5));
  var len = bskLen(60);
  var sec = Math.min(bskU(c, 'sec', 3), 2.5);
  for (var i = 0; i < n; i++) {
    (function (k) {
      eliteLater(k * Math.max(0.25, bskU(c, 'gap', 0.25)), function () {
        if (!bskAlive(c.m)) return;
        var mp = eliteMonsterPos(c.m), pp = elitePos();
        if (!mp) return;
        var a = Math.atan2(pp.y - mp.y, pp.x - mp.x) + bskRand(-0.9, 0.9);
        var cx = mp.x + Math.cos(a) * len / 2, cy = mp.y + Math.sin(a) * len / 2;
        bskField(c, {
          x: cx, y: cy, w: len, h: width, a: a, life: sec, tick: Math.max(0.4, bskU(c, 'tick', 0.5)), pct: bskU(c, 'pct'),
          preset: c.v.field2, warn: 0.8
        });
      });
    })(i);
  }
};

/* ===================== 落雷術 ===================== */
BSK_RECIPES.thunderMatrix = function (c) {
  bskBusy(c, 1.6);
  var pp = elitePos();
  var span = bskLen(30);
  var wid = Math.min(bskRad(bskU(c, 'wid', 6)) * 1.5, bskLen(6));
  var speed = bskLen(bskU(c, 'speed', 30));
  var n = Math.min(3, Math.max(2, Math.round(bskU(c, 'count', 2))));
  var sweep = span * 2 / speed;
  for (var k = 0; k < n * 2; k++) {
    (function (i) {
      var horizontal = (i % 2 === 0);
      var sign = (Math.floor(i / 2) % 2 === 0) ? 1 : -1;
      var startAt = 0.6 + i * 0.55;
      var startX = horizontal ? pp.x : pp.x - sign * span;
      var startY = horizontal ? pp.y - sign * span : pp.y;
      var hit = false;
      bskField(c, {
        x: startX, y: startY, w: span * 2, h: wid, a: horizontal ? 0 : Math.PI / 2, life: sweep, tick: 0.1, pct: 0, preset: c.v.attack, curtain: true,
        warn: startAt, warnPreset: c.v.ground,
        move: function (f, dt) { if (horizontal) f.y += sign * speed * dt; else f.x += sign * speed * dt; },
        onTick: function (inside) {
          if (inside && !hit) { hit = true; bskHit(c, bskU(c, 'pct') * 0.45, { quiet: i > 0 }); }
        }
      });
    })(k);
  }
};
BSK_RECIPES.heavenTribulation = function (c) {
  bskBusy(c, 1.5);
  for (var w = 0; w < 3; w++) {
    (function (k) {
      eliteLater(k * 1.1, function () {
        if (!bskAlive(c.m)) return;
        bskSpots(c, {
          n: Math.max(1, Math.round(bskU(c, 'count', 2))), spread: bskLen(6), r: Math.min(bskRad(bskU(c, 'radiusM', 8)), bskLen(6)), warn: 0.9, step: 0.25,
          pct: bskU(c, 'pct') * 0.4, fall: 'strike', fallPreset: c.v.attack2, hitPreset: c.v.hit2
        });
      });
    })(w);
  }
};
BSK_RECIPES.eternalThunderPrison = function (c) {
  bskBusy(c, 1.2);
  var pulses = Math.max(2, Math.min(4, Math.floor(bskU(c, 'sec', 3) / Math.max(0.5, bskU(c, 'gap', 1))) + 1));
  var n = Math.max(2, Math.round((bskT(c, 0, 'count', 2) + bskT(c, 1, 'add', 1)) * 0.6));
  for (var p = 0; p < pulses; p++) {
    (function (k) {
      eliteLater(k * Math.max(0.9, bskU(c, 'gap', 1) * 1.6), function () {
        if (!bskAlive(c.m)) return;
        bskSpots(c, {
          n: n, spread: bskLen(9), r: bskRad(4), warn: 0.8, step: 0.15, pct: (bskT(c, 0, 'pct') + bskT(c, 3, 'pct')) * 0.5,
          fall: 'strike', fallPreset: c.v.attack, first: k === 0
        });
      });
    })(p);
  }
};

/* ===================== 雷球 ===================== */
BSK_RECIPES.criticalThunderbolt = function (c) {
  bskBusy(c, 0.9);
  var childLife = bskU(c, 'childSec', 3);
  var r0 = bskLen(bskT(c, 3, 'm', 8)) * 0.9;
  bskOrbit(c, {
    n: Math.round(bskT(c, 3, 'count', 2)), dur: Math.min(8, bskU(c, 'sec', 10)), rps: bskT(c, 3, 'rps', 0.7), r0: r0, r1: r0 * 1.8, orbR: 18,
    pct: bskT(c, 3, 'pct') + bskU(c, 'pct'), touchCd: 0.7, orbPreset: c.v.proj, auraVariant: 'thunder-orbit',
    onTouch: function (x, y) {
      if (Math.random() * 100 > bskU(c, 'chance', 5) * 2.5) return;
      bskField(c, { x: x, y: y, r: bskRad(bskT(c, 0, 'm', 4)), life: childLife, tick: 0.5, pct: bskT(c, 0, 'pct') * 2, preset: c.v.field });
    }
  });
  bskSelfStatus(c, 'sgThunderOrb', 6);
};
BSK_RECIPES.thunderBurst = function (c) {
  bskBusy(c, 1.2);
  var mp = eliteMonsterPos(c.m);
  if (!mp) return;
  var n = Math.round(bskT(c, 0, 'count', 2)) + 1;
  var speed = bskLen(bskT(c, 0, 'speed', 6)) * 4;
  for (var i = 0; i < n; i++) {
    (function (k) {
      eliteLater(k * 0.5, function () {
        if (!bskAlive(c.m)) return;
        var m0 = eliteMonsterPos(c.m) || mp;
        bskField(c, {
          x: m0.x, y: m0.y, r: bskRad(bskT(c, 0, 'm', 4)), life: 4, tick: bskT(c, 0, 'gap', 0.35), pct: bskT(c, 0, 'pct') * 0.8, preset: c.v.field,
          move: function (f, dt) {
            var tp = elitePos();
            var dx = tp.x - f.x, dy = tp.y - f.y, dl = Math.sqrt(dx * dx + dy * dy) || 1;
            var st = Math.min(dl, speed * dt);
            f.x += dx / dl * st; f.y += dy / dl * st;
          },
          onTick: function (inside) {
            if (!inside || Math.random() * 100 > bskU(c, 'chance', 10) * 2) return;
            bskBolt(c, { pct: bskU(c, 'pct') * 0.5, proj: c.v.proj2, hitPreset: c.v.hit2, quiet: true });
          }
        });
      });
    })(i);
  }
};
BSK_RECIPES.thunderfallShatter = function (c) {
  bskBusy(c, 2.2);
  var n = Math.round(bskT(c, 6, 'count', 2)) + 2;
  var r = Math.min(bskRad(bskT(c, 6, 'm', 15) * (1 + bskU(c, 'scale', 50) / 100)), bskLen(10));
  bskSpots(c, {
    n: n, spread: bskLen(14), r: r, warn: 1.2, step: Math.max(0.6, bskU(c, 'gap', 1) * 0.8), pct: bskU(c, 'pct'),
    fall: 'rain', fallPreset: bskTierTrig(c, 6, 'projectile'), burstPreset: bskTierTrig(c, 6, 'hit'), warnPreset: bskTierTrig(c, 6, 'ground'),
    stun: bskT(c, 6, 'sec', 3) * 0.5, burstScale: 1.0
  });
};

/* ===================== 寒冰箭 ===================== */
BSK_RECIPES.absoluteZeroBurst = function (c) {
  bskBusy(c, 1.4);
  bskVolley(c, {
    n: Math.round(bskT(c, 0, 'count', 2) + bskT(c, 4, 'add', 1)), gap: 0.18, spreadDeg: bskT(c, 0, 'deg', 15) * 3, speed: bskLen(bskT(c, 0, 'speed', 58)),
    proj: c.v.proj, track: true, burstR: bskRad(bskT(c, 6, 'm', 6)) * (1 + bskU(c, 'rangePct', 25) / 100), burstPreset: bskTierTrig(c, 6, 'attack'),
    pct: bskU(c, 'pct') * 0.7, sure: true, slow: 1.5
  });
};
BSK_RECIPES.infiniteIceRift = function (c) {
  bskBusy(c, 1.4);
  var refund = bskU(c, 'sec', 0.01) * 10;
  bskVolley(c, {
    n: 6, gap: 0.12, spreadDeg: bskT(c, 0, 'deg', 15) * 2, speed: bskLen(bskT(c, 0, 'speed', 58)), proj: c.v.proj, hitR: 36,
    pct: bskT(c, 0, 'pct') * 0.5, sure: false, slow: 1.0,
    onHit: function () { var rt = c.m._el; if (rt && rt.cd) rt.cd[c.d.id] = Math.max(0.5, (rt.cd[c.d.id] || 0) - refund); }
  });
};
BSK_RECIPES.tearsOfIce = function (c) {
  bskBusy(c, 1.2);
  var waves = Math.min(4, Math.round(bskU(c, 'waves', 10) * 0.4));
  var per = Math.min(4, Math.round(bskU(c, 'count', 10) * 0.4));
  for (var w = 0; w < waves; w++) {
    (function (k) {
      eliteLater(k * Math.max(0.5, bskU(c, 'gap', 0.35) * 1.5), function () {
        if (!bskAlive(c.m)) return;
        bskSpots(c, {
          n: per, spread: bskLen(9), r: bskRad(2.5), warn: 0.7, step: 0.1, pct: bskU(c, 'pct') * 0.4,
          fall: 'rain', fallPreset: c.v.proj2, burstPreset: c.v.hit2, burstScale: 1.0, first: k === 0, slow: 1.0
        });
      });
    })(w);
  }
};

/* ===================== 水流彈 ===================== */
BSK_RECIPES.waterPrisonFall = function (c) {
  bskBusy(c, 1.2);
  var r = bskRad(bskU(c, 'm', 20));
  var dur = bskU(c, 'sec', 6);
  var enemySid = bskEnemySid(c, 1);
  bskSelfStatus(c, bskSelfSid(c, 0), dur, { vfxR: r });
  bskBuffDr(c, Math.min(0.5, bskU(c, 'rangedRed', 30) / 100), dur);
  bskDomain(c, {
    r: r, dur: dur, tick: 0.5, pct: 0,
    onTick: function () {
      bskVuln(c, Math.min(0.5, bskU(c, 'vuln', 50) / 100 * 0.5), 1.5);
      var p = elitePlayer();
      if (p && typeof applyBuff === 'function') applyBuff(p, 'atkDown', bskU(c, 'atkRed', 30), 1.5, 'atkDown');
      bskStatusOnPlayer(enemySid, 1.5, 0);
    }
  });
};
BSK_RECIPES.ragingTide = function (c) {
  bskBusy(c, 1.4);
  var pp = elitePos();
  var px = pp.x, py = pp.y;
  var side = bskLen(bskT(c, 6, 'side', 10)) * 0.8 / 2;
  var tornadoR = bskRad(bskT(c, 6, 'm', 5));
  var fieldPreset = bskTierTrig(c, 6, 'field');
  var life = 4;
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (cr) {
    bskField(c, { x: px + cr[0] * side, y: py + cr[1] * side, r: tornadoR, life: life, tick: 0.5, pct: bskT(c, 6, 'pct') * 0.6, preset: fieldPreset, warn: 0.8 });
  });
  eliteLater(0.8 + life * 0.7 + bskU(c, 'mergeDelay', 1.5) * 0.3, function () {
    if (!bskAlive(c.m)) return;
    var mr = Math.min(bskRad(bskU(c, 'm', 30)), bskLen(11));
    if (c.v.ground2) eliteBurstFx(px, py, mr, c.v.ground2, 0);
    bskField(c, { x: px, y: py, r: mr, life: Math.min(4, bskU(c, 'sec', 6)), tick: 0.5, pct: bskU(c, 'pct') * 0.8, preset: c.v.field2, warn: 0.6 });
  });
};
BSK_RECIPES.abyssBurial = function (c) {
  bskBusy(c, 1.2);
  var r = Math.min(bskRad(bskU(c, 'm', 30)), bskLen(14));
  bskSelfStatus(c, bskSelfSid(c, 0), 8, { vfxR: r });
  bskDomain(c, {
    r: r, dur: 8, tick: Math.max(0.5, bskU(c, 'gap', 0.35)), pct: bskT(c, 0, 'pct') * 0.3, pull: bskLen(bskU(c, 'pullSpeed', 3)) * 1.2, slow: 1.0, hitPreset: c.v.hit2,
    onTick: function () { bskVuln(c, Math.min(0.5, bskU(c, 'vuln', 50) / 100 * 0.5), 1.5); }
  });
};

/* ===================== 冰霜新星 ===================== */
function bskNovaR(c) { return bskRad(bskT(c, 1, 'm', 13)); }
BSK_RECIPES.infiniteNova = function (c) {
  bskBusy(c, 1.5, true);
  var times = 3;
  var gap = Math.max(1.0, bskU(c, 'gap', 1));
  var pct = bskT(c, 0, 'pct') + bskT(c, 1, 'pct') + bskU(c, 'pct');
  for (var i = 0; i < times; i++) {
    (function (k) {
      eliteLater(k * gap, function () {
        if (!bskAlive(c.m)) return;
        bskRing(c, { r: bskNovaR(c), times: 1, warn: 0.7, pct: pct * 0.5, slow: 1.5, stun: k === times - 1 ? 1.2 : undefined });
      });
    })(i);
  }
};
BSK_RECIPES.crystalResonance = function (c) {
  bskBusy(c, 1.6, true);
  bskRing(c, { r: bskNovaR(c), times: 1, warn: 0.8, pct: bskT(c, 0, 'pct') + bskT(c, 1, 'pct'), stun: 1.5 * (1 + bskU(c, 'durPct', 50) / 100) });
  for (var i = 0; i < 3; i++) {
    (function (k) {
      eliteLater(1.0 + k * Math.max(0.6, bskU(c, 'gap', 0.5) * 1.4), function () {
        if (!bskAlive(c.m)) return;
        var q = elitePos();
        var qx = q.x, qy = q.y;
        var rr = bskRad(bskU(c, 'm', 8));
        bskWarnCircle(c, qx, qy, rr, 0.6);
        eliteLater(0.6, function () {
          if (!bskAlive(c.m)) return;
          eliteBurstFx(qx, qy, rr * 1.1, c.v.attack2, 0, c.elem);
          bskCircleHit(c, qx, qy, rr, bskU(c, 'pct') * 0.5, { quiet: k > 0 });
        });
      });
    })(i);
  }
};
BSK_RECIPES.iceKingDomain = function (c) {
  bskBusy(c, 1.2);
  var mp = eliteMonsterPos(c.m);
  if (!mp) return;
  var side = Math.min(bskRad(bskT(c, 6, 'side', 24) * (1 + bskU(c, 'scale', 50) / 100)), bskLen(24));
  var sec = Math.min(bskT(c, 6, 'sec', 8), 7);
  bskField(c, {
    x: mp.x, y: mp.y, w: side, h: side, a: 0, life: sec, tick: Math.max(0.5, bskT(c, 6, 'gap', 0.4)), pct: bskT(c, 6, 'pct'), preset: bskTierTrig(c, 6, 'ground'),
    warn: 0.8, slow: 1.0, move: function (f) { var q = eliteMonsterPos(c.m); if (q) { f.x = q.x; f.y = q.y; } }
  });
  bskTicks(c.m, sec, Math.max(1.0, bskU(c, 'gap', 1)), function () {
    var n = Math.max(1, Math.min(3, Math.round(bskRand(bskU(c, 'min', 2), bskU(c, 'max', 8)) * 0.4)));
    bskSpots(c, {
      n: n, spread: bskLen(8), r: bskRad(bskU(c, 'm', 8)), warn: 0.8, step: 0.12, pct: bskU(c, 'pct') * 0.5 / Math.max(1, bskU(c, 'hits', 4)) * 2,
      warnPreset: c.v.ground2, burstPreset: c.v.ground2, burstScale: 1.0, first: false, slow: 1.0
    });
  });
};

/* ===================== 風刃 ===================== */
function bskCrescent(c, n, pct, o) {
  o = o || {};
  var t1 = bskTierRoles(c, 1);
  bskVolley(c, {
    n: n, gap: 0.18, spreadDeg: o.spreadDeg === undefined ? 24 : o.spreadDeg, speed: bskLen(bskT(c, 0, 'speed', 18)) * 2.2, proj: o.proj || t1.proj,
    pierceLen: bskLen(24), pierceW: o.width || Math.min(bskLen(8) * (1 + bskT(c, 1, 'size', 0) / 100), 90), pct: pct, sure: false, startDelay: o.startDelay
  });
}
BSK_RECIPES.stormMyriad = function (c) {
  bskBusy(c, 1.6);
  bskCrescent(c, 1 + Math.round(bskU(c, 'add', 1)), bskT(c, 0, 'pct') * 0.6);
  bskChase(c, {
    legs: Math.max(3, Math.floor(bskU(c, 'sec', 7) / 1.4)), speed: bskLen(bskT(c, 0, 'speed', 18)) * 1.6,
    proj: bskTierTrig(c, 3, 'projectile') || c.v.proj, hitR: 40, pct: bskT(c, 3, 'pct') + bskU(c, 'pct'), startDelay: 0.6
  });
};
BSK_RECIPES.stormMountain = function (c) {
  bskBusy(c, 1.6);
  var heal = bskU(c, 'healPct', 2) / 4;
  var bonus = 1 + (bskU(c, 'windPct', 75) + bskU(c, 'earthPct', 50)) / 100 * 0.15;
  bskCrescent(c, 3, bskT(c, 0, 'pct') * 0.6 * bonus, { proj: c.v.proj });
  bskVolley(c, {
    n: 1, startDelay: 0.5, speed: bskLen(bskT(c, 0, 'speed', 18)) * 2.2, proj: c.v.proj, pierceLen: bskLen(24), pierceW: 60,
    pct: bskT(c, 0, 'pct') * 0.6 * bonus, onHit: function () { bskHeal(c, heal); }, sure: false
  });
};

/* ===================== 真空斬 ===================== */
BSK_RECIPES.vacuumOmen = function (c) {
  bskBusy(c, 1.4);
  var pp = elitePos();
  var px = pp.x, py = pp.y;
  var r = bskRad(bskT(c, 0, 'm', 6));
  var t1 = bskTierRoles(c, 1);
  bskWarnCircle(c, px, py, r, 0.7);
  eliteLater(0.7, function () {
    if (!bskAlive(c.m)) return;
    eliteBurstFx(px, py, r * 1.1, t1.attack, 0, c.elem);
    bskCircleHit(c, px, py, r, bskT(c, 0, 'pct') * 0.5, { hitPreset: t1.hit });
  });
  for (var i = 0; i < 3; i++) {
    (function (k) {
      var a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * bskLen(7);
      bskField(c, {
        x: px + Math.cos(a) * d, y: py + Math.sin(a) * d, r: bskRad(5), life: bskU(c, 'sec', 3), tick: Math.max(0.4, bskU(c, 'gap', 0.25) * 2),
        pct: bskU(c, 'pct'), preset: c.v.ground2, warn: 0.8 + k * 0.2, hitPreset: c.v.hit2
      });
    })(i);
  }
};
function bskVoidBlades(c, n, dur, r0, r1, pct) {
  bskOrbit(c, {
    n: n, dur: dur, rps: bskT(c, 6, 'rps', 1) * 0.6, r0: r0, r1: r1, orbR: bskLen(bskT(c, 6, 'bodyM', 12)) * 0.25,
    pct: pct, touchCd: 0.8, anyCd: 0.8, orbPreset: bskTierTrig(c, 6, 'projectile'), ringPreset: bskTierTrig(c, 6, 'ground'), auraVariant: 'void-disc'
  });
  bskSelfStatus(c, 'sgVoidBlade', dur);
}
BSK_RECIPES.voidAnnihilation = function (c) {
  bskBusy(c, 1.0);
  var r0 = bskLen(bskT(c, 6, 'm', 6));
  var dur = Math.min(7, bskT(c, 6, 'sec', 6));
  bskVoidBlades(c, Math.round(bskT(c, 6, 'count', 4)), dur, r0, Math.min(bskLen(18), r0 + bskLen(bskT(c, 6, 'growM', 4)) * dur * 0.6),
    bskT(c, 6, 'pct') * 0.2 * (1 + bskU(c, 'pct', 100) / 400));
};
BSK_RECIPES.spacetimeCollapse = function (c) {
  bskBusy(c, 1.0);
  var r = bskRad(bskU(c, 'm', 12)) * 1.4;
  var dur = Math.min(9, bskT(c, 6, 'sec', 6) * (1 + bskU(c, 'pct', 50) / 100));
  bskVoidBlades(c, Math.round(bskT(c, 6, 'count', 4)), dur, r, r, bskT(c, 6, 'pct') * 0.2);
};

/* ===================== 暴風屏障 ===================== */
BSK_RECIPES.valgrForce = function (c) {
  bskBusy(c, 1.0);
  var dur = bskT(c, 6, 'sec', 2) * (1 + bskU(c, 'sec', 50) / 100) + 3;
  bskBuffDr(c, Math.min(0.5, (bskT(c, 6, 'red', 99) + bskU(c, 'red', 0.1)) / 100 * 0.5), dur);
  bskBuffAtk(c, bskBuffFactor(bskT(c, 6, 'pct') + bskU(c, 'pct'), 0.6), dur);
  bskSelfStatus(c, 'sgStormBarrier', dur);
  bskSelfStatus(c, 'sgStormGod', dur);
  if (typeof applyShield === 'function') applyShield(c.m, (bskT(c, 0, 'shield') + bskT(c, 5, 'shield')) * 0.6, dur, 'shield');
};
BSK_RECIPES.skyfallStars = function (c) {
  bskBusy(c, 1.6);
  for (var w = 0; w < 3; w++) {
    (function (k) {
      eliteLater(k * 1.4, function () {
        if (!bskAlive(c.m)) return;
        var n = Math.max(1, Math.min(3, Math.round(bskRand(bskU(c, 'min', 1), bskU(c, 'max', 3)))));
        bskSpots(c, {
          n: n, spread: bskLen(10), r: Math.min(bskRad(bskU(c, 'm', 8)), bskLen(6)), warn: 1.1, step: 0.3, pct: bskU(c, 'pct') * 0.4,
          fall: 'rain', fallPreset: c.v.proj2, burstPreset: c.v.hit2, warnPreset: c.v.ground2, burstScale: 1.0, first: k === 0
        });
      });
    })(w);
  }
};
BSK_RECIPES.myriadPhenomena = function (c) {
  bskBusy(c, 1.8);
  var bonus = 1 + bskU(c, 'pct', 50) / 100;
  var base = bskAngleToPlayer(c);
  for (var d = 0; d < 4; d++) {
    bskVolley(c, {
      n: 2, gap: 0.2, startDelay: 0.4, angle: base + d * Math.PI / 2, speed: bskLen(18) * 2.2, proj: bskTierTrig(c, 3, 'projectile'),
      pierceLen: bskLen(20), pierceW: 70, pct: bskT(c, 0, 'pct') * 0.3 * bonus, sure: false, quiet: d > 0
    });
  }
  bskVoidBlades(c, 4, 6, bskLen(6), bskLen(14), bskT(c, 6, 'pct') * 0.2 * bonus);
};

/* ===================== 需要玩家在附近才有意義的招式：先衝近 ===================== */
function bskReachOf(f, k) { return function (c) { return f(c) * k; }; }
BSK_NEAR.phantomOcta = bskReachOf(function (c) { return bskThrustGeom(c).len; }, 0.8);
BSK_NEAR.shadowExecutioner = bskReachOf(function (c) { return bskThrustGeom(c).len; }, 0.8);
BSK_NEAR.oneStrikeKill = bskReachOf(function (c) { return bskThrustGeom(c).len; }, 0.8);
BSK_NEAR.voidShatter = bskReachOf(function (c) { return bskCleaveR(c, 5); }, 0.8);
BSK_NEAR.windChaser = bskReachOf(function (c) { return bskCleaveR(c, 0); }, 0.8);
BSK_NEAR.stormGodSlash = bskReachOf(function (c) { return bskCleaveR(c, 0); }, 0.8);
BSK_NEAR.slayerDomain = bskReachOf(function (c) { return bskRad(bskU(c, 'm', 24)); }, 0.8);
BSK_NEAR.venomDomain = bskReachOf(function (c) { return Math.min(bskRad(bskU(c, 'm', 30)), bskLen(18)); }, 0.8);
BSK_NEAR.slayerAdvent = bskReachOf(function (c) { return bskRad(bskU(c, 'm', 8)); }, 0.8);
BSK_NEAR.solarRing = bskReachOf(function (c) { return bskLen(bskT(c, 0, 'm', 8) * 0.9); }, 1.05);
BSK_NEAR.infiniteRing = function () { return 120; };
BSK_NEAR.fireGodDescend = bskReachOf(function (c) { return bskLen(bskU(c, 'm', 6)) * 1.5; }, 0.8);
BSK_NEAR.superRockArt = bskReachOf(function (c) { return Math.min(bskRad(bskU(c, 'm', 24)), bskLen(14)); }, 0.8);
BSK_NEAR.gravityField = bskReachOf(function (c) { return bskRad(bskU(c, 'm', 12)); }, 0.8);
BSK_NEAR.waterPrisonFall = bskReachOf(function (c) { return bskRad(bskU(c, 'm', 20)); }, 0.8);
BSK_NEAR.abyssBurial = bskReachOf(function (c) { return Math.min(bskRad(bskU(c, 'm', 30)), bskLen(14)); }, 0.8);
BSK_NEAR.infiniteNova = bskReachOf(function (c) { return bskNovaR(c); }, 0.8);
BSK_NEAR.crystalResonance = bskReachOf(function (c) { return bskNovaR(c); }, 0.8);
BSK_NEAR.iceKingDomain = bskReachOf(function (c) { return Math.min(bskRad(bskT(c, 6, 'side', 24) * (1 + bskU(c, 'scale', 50) / 100)), bskLen(24)) / 2; }, 0.9);
BSK_NEAR.criticalThunderbolt = bskReachOf(function (c) { return bskLen(bskT(c, 3, 'm', 8)) * 0.9; }, 1.1);
BSK_NEAR.voidAnnihilation = function (c) { return bskLen(bskT(c, 6, 'm', 6)) + 20; };
BSK_NEAR.spacetimeCollapse = bskReachOf(function (c) { return bskRad(bskU(c, 'm', 12)) * 1.4; }, 1.0);
BSK_NEAR.myriadPhenomena = function () { return 100; };
BSK_NEAR.dragonDevour = bskReachOf(function (c) { return Math.min(bskRad(bskU(c, 'm', 15)), bskLen(10)); }, 1.0);
