'use strict';
/* ============================================================
   elite_boss.js — 封魔塔 BOSS 施放「玩家超神進化技能」的引擎（只在 Worker 載入，接在 js/elite.js 之後）
   ------------------------------------------------------------
   規則（使用者 2026-10-15）：
     1. 某層 BOSS 解鎖哪個超神進化技能，牠就固定使用哪個（對照＝Skills2 超神列的「封魔塔層級」，見 js/elite_data.js bskPickForFloor）。
     2. 技能的效果參數、特效 Preset、狀態都直接讀玩家那一列（SKILLS2），不另開一份數值；傷害改套 BOSS 的強度。
     3. 沒有解鎖技能的 BOSS 額外多抽 NPC 隨機技能；101 層起每場隨機抽玩家技能（抽籤在 tower.js makeBoss）。
   玩家技能引擎綁死「施法者＝玩家、目標＝敵群」（js/skills2.js），不能直接反向使用；
   這裡把每個技能拆成同一組「動作零件」（齊射、直線、環形、落點、場域、環繞、領域、連鎖、增益…），
   零件全部重用 js/elite.js 的預警／傷害／場域／特效派送，再依每個技能的參數組成它的招式。
   數值全部取技能最高等級（SG_TIER_MAX_LV）；BOSS 側的整體強度由參數表「4-菁英群組／封魔塔BOSS玩家技能」一列的八個旋鈕決定（ELITE_GROUP.ps*，沒填用預設）：
     psDmgPct  技能傷害倍率（技能 pct% × 它 ÷ 100，再乘 BOSS 攻擊）
     psTickPct 持續場域／領域每次跳動的再折扣
     psAreaPct 範圍半徑倍率（玩家技能的範圍是為打一群怪設計的，直接搬給單一玩家會鋪滿全場）
     psBuffPct 玩家式增益（攻擊、疊層）轉成 BOSS 增益時的強度
     psCtrlPct 控場秒數倍率；psShieldPct 護盾量倍率；psReviveHpPct 復活生命倍率；psPassiveGap 被動反應最短間隔（秒）
   ============================================================ */

/* ---------------- 旋鈕與小工具 ---------------- */
function bskG(key, fallback) { return eliteG('ps' + key, fallback); }
function bskMult(pct) { return Math.max(0, Number(pct) || 0) / 100 * bskG('DmgPct', 25) / 100; }
function bskArea() { return Math.max(0.05, bskG('AreaPct', 60) / 100); }
function bskBuff() { return Math.max(0, bskG('BuffPct', 25) / 100); }
function bskCtrl() { return Math.max(0, bskG('CtrlPct', 50) / 100); }
function bskRad(m) { return Math.max(0, Number(m) || 0) * ELITE_METER * bskArea(); }     // 範圍半徑（米→座標單位，乘範圍倍率）
function bskLen(m) { return Math.max(0, Number(m) || 0) * ELITE_METER; }                  // 長度（米→座標單位）
function bskAlive(m) { return !!m && m.hp > 0 && elitePlayerAlive(); }
function bskPs(m) {
  var rt = m._el;
  if (!rt.ps) rt.ps = { atk: 0, atkUntil: 0, dr: 0, drUntil: 0, vuln: 0, vulnUntil: 0, reaper: 0, reaperUntil: 0, lifesteal: 0, lifestealUntil: 0 };
  return rt.ps;
}

/* 取參數：c.U＝超神那一列、c.T＝第 i 階（0 起算），都取最高等級；沒有或為 0 時用 dflt。 */
function bskU(c, key, dflt) { var v = sgVal(c.fx, key, c.lv); return v !== 0 && isFinite(v) ? v : (dflt || 0); }
function bskT(c, i, key, dflt) {
  var t = c.tiers[i];
  var v = (t && t.fx) ? sgVal(t.fx, key, c.lv) : 0;
  return v !== 0 && isFinite(v) ? v : (dflt || 0);
}
function bskCtx(m, d) {
  var g = SKILLS2[d.gid];
  var ult = g.ult[d.ultIdx];
  return {
    m: m, d: d, g: g, gid: d.gid, ult: ult, fx: ult.fx || {}, tiers: g.tiers, v: d.v || {}, lv: bskLevel(),
    magic: g.dmgType === 'magic', elem: g.dmgType === 'magic' ? (g.elem || null) : null, hitCount: 0,
    /* 設計師可在 Skills2 該列的效果參數(JSON) 補 bossMul（這個技能給 BOSS 用時的傷害倍率，預設 1）、bossCd／bossCdMax（冷卻秒數） */
    bossMul: Number(ult.fx && ult.fx.bossMul) > 0 ? Number(ult.fx.bossMul) : 1
  };
}

/* 預警圈／預警帶的 Preset：從敵人技能表（Skills2 類別＝enemy）裡找同屬性、用來標落點的地板特效，不在程式裡寫 id。 */
var BSK_WARN_CACHE = {};
function bskWarnPreset(elem) {
  var key = elem || '-';
  if (BSK_WARN_CACHE[key] !== undefined) return BSK_WARN_CACHE[key];
  var exact = '', any = '';
  for (var i = 0; i < ELITE_AFFIX_ORDER.length; i++) {
    var d = ELITE_AFFIXES[ELITE_AFFIX_ORDER[i]];
    if (!d || d.kind !== 'active' || !d.v || !d.v.ground) continue;
    if (d.arch !== 'spots' && d.arch !== 'spot' && d.arch !== 'zone') continue;
    if (!any) any = d.v.ground;
    if (elem && d.elem === elem && !exact) exact = d.v.ground;
    if (!elem && !d.elem && !exact) exact = d.v.ground;
  }
  BSK_WARN_CACHE[key] = exact || any || '';
  return BSK_WARN_CACHE[key];
}
function bskWarnCircle(c, x, y, r, sec, preset) { return eliteWarn(x, y, r, preset || bskWarnPreset(c.elem), sec, 'psw'); }
function bskWarnRect(c, x, y, w, h, a, sec, preset) {
  if (!(sec > 0)) return null;
  return eliteVisAdd({ id: eliteVisId('pswr'), preset: preset || bskWarnPreset(c.elem), x: x, y: y, w: w, h: h, a: a, until: GT + sec });
}
/* 每 gap 秒呼叫一次 fn(k, t)，共 total 秒；BOSS 死亡或玩家倒下就停。 */
function bskTicks(m, total, gap, fn) {
  var n = Math.max(1, Math.floor(total / Math.max(0.05, gap) + 1e-6));
  for (var i = 0; i < n; i++) {
    (function (k) {
      eliteLater(k * gap, function () { if (bskAlive(m)) fn(k, k * gap); });
    })(i);
  }
}
function bskPolar(cx, cy, ang, dist) { return { x: cx + Math.cos(ang) * dist, y: cy + Math.sin(ang) * dist }; }
function bskRand(lo, hi) { return lo + Math.random() * (hi - lo); }

/* 同一次施放裡，打在同一個玩家身上的第 N 下遞減：玩家技能的多段／多落點是為打一群怪設計的，
   全部疊在單一玩家身上會爆量。持續場域與領域的跳動（dim:false）另有 psTickPct 約束，不吃這條。 */
var BSK_DIMINISH = [1, 1, 0.75, 0.55, 0.4, 0.3];
function bskTickMul() { return Math.max(0, bskG('TickPct', 20) / 100); }

/* 一次打到玩家：傷害＝技能 pct 轉成 BOSS 倍率，再吃玩家身上的易傷；o 可帶 stun／slow／dot／sure／quiet／push／elem 等 eliteHitPlayer 選項。 */
function bskHit(c, pct, o) {
  o = o || {};
  var dim = 1;
  if (o.dim !== false) {
    dim = BSK_DIMINISH[Math.min(c.hitCount, BSK_DIMINISH.length - 1)];
    c.hitCount++;
  }
  var elem = o.elem !== undefined ? o.elem : c.elem;
  var opts = {
    mult: bskMult(pct) * (o.mul || 1) * dim * c.bossMul, elem: elem, phys: !elem && !c.magic, label: o.label || c.d.name,
    sure: o.sure !== false, quiet: !!o.quiet
  };
  ['stun', 'slow', 'dot', 'push', 'from', 'atkDown', 'defDown', 'dur', 'freeze'].forEach(function (k) { if (o[k] !== undefined) opts[k] = o[k]; });
  if (opts.stun > 0) opts.stun *= bskCtrl();
  if (opts.slow > 0) opts.slow *= bskCtrl();
  var res = eliteHitPlayer(c.m, opts);
  if (res && !res.miss && !res.invuln) {
    var ps = c.m._el && c.m._el.ps;
    if (ps && ps.lifestealUntil > GT && ps.lifesteal > 0) {
      var heal = Math.max(0, res.dmg - (res.absorbed || 0)) * ps.lifesteal;
      if (heal > 0) c.m.hp = Math.min(c.m.maxHp, c.m.hp + heal);
    }
    var hp = o.hitPreset === undefined ? c.v.hit : o.hitPreset;
    if (hp && o.hitFx !== false) eliteHitFx(elitePF(), hp);
    if (o.onHit) o.onHit(res);
  }
  return res;
}
/* 在 (x,y) 半徑 r 內才打（範圍技能的結算）。 */
function bskCircleHit(c, x, y, r, pct, o) {
  if (!eliteInCircle(x, y, r)) return null;
  return bskHit(c, pct, o);
}

/* ---------------- 動作零件：飛行 ---------------- */
function bskFlight(c, preset, from, to, travel, o) {
  if (!preset) return;
  o = o || {};
  eliteFlightFx(preset, from.x, from.y, to.x, to.y, travel, { elem: c.elem, bodyD: o.bodyD, arcM: o.arcM, ctrl: o.ctrl, delaySec: o.delay });
}

/* 齊射：n 發彈體朝玩家飛去（扇形 spreadDeg）。
   落點判定：pierceLen>0＝貫穿整條路徑（沿線段）；track＝落地當下鎖定玩家腳下（躲不掉）；其餘＝落在發射當下玩家的位置，離開圈外即可躲開。
   o：n gap spreadDeg speed(座標/秒) proj pct hitR pierceLen pierceW track burstR burstPreset sure onHit startDelay randomSpread bodyD */
function bskVolley(c, o) {
  var m = c.m;
  var n = Math.max(1, Math.floor(o.n || 1));
  var spread = (o.spreadDeg || 0) * Math.PI / 180;
  for (var i = 0; i < n; i++) {
    (function (index) {
      eliteLater((o.startDelay || 0.25) + index * (o.gap || 0.15), function () {
        if (!bskAlive(m)) return;
        var mp = eliteMonsterPos(m), pp = elitePos();
        if (!mp) return;
        var base = o.angle !== undefined ? o.angle : Math.atan2(pp.y - mp.y, pp.x - mp.x);
        var off = o.randomSpread ? bskRand(-spread / 2, spread / 2) : (n > 1 ? (index / (n - 1) - 0.5) * spread : 0);
        var ang = base + off;
        var dist = Math.max(eliteDist(mp.x, mp.y, pp.x, pp.y), o.minRange || 80);
        var to = o.pierceLen > 0 ? bskPolar(mp.x, mp.y, ang, Math.max(o.pierceLen, dist + 60))   // 貫穿射程至少要夠到玩家
          : (o.track ? { x: pp.x, y: pp.y } : bskPolar(mp.x, mp.y, ang, dist));
        var travel = Math.max(0.18, eliteDist(mp.x, mp.y, to.x, to.y) / Math.max(60, o.speed || 400));
        bskFlight(c, o.proj, mp, to, travel, { bodyD: o.bodyD });
        var from = { x: mp.x, y: mp.y };
        eliteLater(travel, function () {
          if (!bskAlive(m)) return;
          var p2 = elitePos();
          var land = o.track ? { x: p2.x, y: p2.y } : to;
          if (o.burstPreset && o.burstR > 0) eliteBurstFx(land.x, land.y, o.burstR, o.burstPreset, 0, c.elem);
          var inside;
          if (o.pierceLen > 0) inside = eliteSegmentDist(from.x, from.y, to.x, to.y, p2.x, p2.y) <= (o.pierceW || 30) / 2 + ELITE_PLAYER_BODY_R;
          else inside = o.track ? true : eliteInCircle(land.x, land.y, o.hitR || 40);
          if (!inside) return;
          bskHit(c, o.pct, { sure: !!o.sure, quiet: index > 0 || !!o.quiet, stun: o.stun, slow: o.slow, dot: o.dot, onHit: o.onHit });
        });
      });
    })(i);
  }
}

/* 連續折返的追擊飛行物（追魂刃、追蹤風刃、追蹤冰箭）：每一段鎖定出發當下的玩家位置，抵達後再朝玩家新位置出發。 */
function bskChase(c, o) {
  var m = c.m;
  var legs = Math.max(1, Math.floor(o.legs || 3));
  var cur = null;
  function leg(k) {
    if (k >= legs || !bskAlive(m)) return;
    var mp = eliteMonsterPos(m), pp = elitePos();
    var from = cur || (mp ? { x: mp.x, y: mp.y } : null);
    if (!from) return;
    var aim = o.jitter ? bskPolar(pp.x, pp.y, Math.random() * Math.PI * 2, Math.random() * o.jitter) : { x: pp.x, y: pp.y };
    var travel = Math.max(0.18, eliteDist(from.x, from.y, aim.x, aim.y) / Math.max(60, o.speed || 400));
    bskFlight(c, o.proj, from, aim, travel, { bodyD: o.bodyD });
    eliteLater(travel, function () {
      if (!bskAlive(m)) return;
      cur = aim;
      if (o.burstPreset && o.burstR > 0) eliteBurstFx(aim.x, aim.y, o.burstR, o.burstPreset, 0, c.elem);
      if (eliteInCircle(aim.x, aim.y, o.hitR || 36)) {
        bskHit(c, (o.pct || 0) + (o.pctStep || 0) * k, { sure: false, quiet: k > 0, onHit: o.onHit, slow: o.slow, stun: o.stun });
      }
      leg(k + 1);
    });
  }
  eliteLater(o.startDelay || 0.3, function () { leg(0); });
}

/* ---------------- 動作零件：直線 ----------------
   多條帶狀攻擊（突刺、光束）：先在地上標出每一條，倒數結束才出手。
   o：angles(絕對角度陣列，沒給＝朝玩家一條) len width warn pct hits(每條連續幾下) hitGap proj(沿線飛出的特效) onHit stun */
function bskLines(c, o) {
  var m = c.m;
  var mp = eliteMonsterPos(m), pp = elitePos();
  if (!mp) return;
  var base = Math.atan2(pp.y - mp.y, pp.x - mp.x);
  var angles = o.angles || [base];
  var len = o.len, width = o.width, warn = o.warn || 1;
  angles.forEach(function (a) {
    var cx = mp.x + Math.cos(a) * len / 2, cy = mp.y + Math.sin(a) * len / 2;
    bskWarnRect(c, cx, cy, len, width, a, warn);
  });
  eliteLater(warn, function () {
    if (!bskAlive(m)) return;
    var mp2 = eliteMonsterPos(m) || mp;
    angles.forEach(function (a) {
      var cx = mp2.x + Math.cos(a) * len / 2, cy = mp2.y + Math.sin(a) * len / 2;
      var to = bskPolar(mp2.x, mp2.y, a, len);
      bskFlight(c, o.proj, mp2, to, Math.max(0.12, len / Math.max(200, o.speed || 900)), { bodyD: width });
      for (var h = 0; h < (o.hits || 1); h++) {
        (function (hi) {
          eliteLater(0.12 + hi * (o.hitGap || 0.14), function () {
            if (!bskAlive(m)) return;
            if (!eliteInRect(cx, cy, len, width, a)) return;
            bskHit(c, o.pct, { sure: true, quiet: hi > 0, stun: o.stun, slow: o.slow, dot: o.dot, onHit: o.onHit });
          });
        })(h);
      }
    });
  });
}

/* ---------------- 動作零件：環形 ----------------
   以 (中心＝BOSS) 半徑 r 的圓：先標預警，倒數後爆發並打圈內。times>1＝連續多波（每波 waveGap）。 */
function bskRing(c, o) {
  var m = c.m;
  var mp = eliteMonsterPos(m);
  if (!mp) return;
  var times = Math.max(1, Math.floor(o.times || 1));
  var warn = o.warn || 0.9;
  bskWarnCircle(c, mp.x, mp.y, o.r, warn + (times - 1) * (o.waveGap || 0.3));
  for (var i = 0; i < times; i++) {
    (function (w) {
      eliteLater(warn + w * (o.waveGap || 0.3), function () {
        if (!bskAlive(m)) return;
        var mp2 = eliteMonsterPos(m) || mp;
        var preset = o.attack || c.v.attack;
        if (o.proj) eliteFx({
          fxKind: 'burst', variant: 'elite-burst', elem: c.elem, count: 1, dur: 0.5, hit: false,
          area: { x: mp2.x, y: mp2.y, r: o.r }, vfx: { attack: o.proj }
        });
        else if (preset) eliteBurstFx(mp2.x, mp2.y, o.r * 1.1, preset, 0, c.elem);
        bskCircleHit(c, mp2.x, mp2.y, o.r, o.pct, { sure: true, quiet: w > 0, stun: o.stun, slow: o.slow, dot: o.dot, push: o.push, from: o.push ? { x: mp2.x, y: mp2.y } : undefined, onHit: o.onHit });
      });
    })(i);
  }
}

/* ---------------- 動作零件：落點 ----------------
   在玩家周圍落下 n 個打擊點，每點先預警再爆炸。
   o：n spread r warn step first fall('rain'彈體落下｜'strike'垂直落雷｜無) fallPreset burstPreset pct stun slow dot onImpact(x,y,i) elemOverride burstScale */
function bskSpots(c, o) {
  var m = c.m;
  var pp = elitePos();
  var n = Math.max(1, Math.floor(o.n || 1));
  for (var i = 0; i < n; i++) {
    var ang = Math.random() * Math.PI * 2;
    var dist = (i === 0 && o.first !== false) ? 0 : Math.sqrt(Math.random()) * (o.spread || 80);
    var x = pp.x + Math.cos(ang) * dist, y = pp.y + Math.sin(ang) * dist;
    var warn = (o.warn || 1) + i * (o.step || 0.2);
    bskWarnCircle(c, x, y, o.r, warn, o.warnPreset);
    if (o.fall === 'rain' && o.fallPreset) {
      var travel = Math.min(0.75, warn);
      eliteFx({
        fxKind: 'rain', variant: 'elite-rain', elem: c.elem, count: 1, dur: travel, hit: false,
        delayMs: Math.round(Math.max(0, warn - travel) * 1000), travelMs: [Math.round(travel * 1000)],
        lineWidth: o.bodyD || 0, area: { x: x, y: y, fixedLanding: true }, vfx: { projectile: o.fallPreset }
      });
    } else if (o.fall === 'strike' && o.fallPreset) {
      eliteFx({
        fxKind: 'rain', variant: 'heaven-tribulation-strike', elem: c.elem, count: 1, dur: 0.5, hit: false,
        delayMs: Math.round(warn * 1000), area: { x: x, y: y, r: o.r }, vfx: { attack: o.fallPreset }
      });
    }
    (function (px, py, k, wt) {
      eliteLater(wt, function () {
        if (!bskAlive(m)) return;
        if (o.burstPreset) eliteBurstFx(px, py, o.r * (o.burstScale || 1.15), o.burstPreset, 0, c.elem);
        if (o.onImpact) o.onImpact(px, py, k);
        bskCircleHit(c, px, py, o.r, o.pct, { sure: true, quiet: k > 0, stun: o.stun, slow: o.slow, dot: o.dot, elem: o.elem, hitPreset: o.hitPreset, atkDown: o.atkDown, dur: o.dur });
      });
    })(x, y, i, warn);
  }
  return (o.warn || 1) + (n - 1) * (o.step || 0.2);
}

/* ---------------- 動作零件：持續場域 ----------------
   在 (x,y) 放一塊持續 life 秒的場域，每 tick 秒對站在裡面的玩家結算一次（傷害＝pct × psTickPct，跳動型傷害的整體折扣）。
   場域可以移動（move(f, dt) 每 0.1 秒改 f.x／f.y）、可以只做效果不傷人（pct＝0，用 onTick 做事）。
   o：x y r｜w h a(矩形) life tick pct preset(場域特效) hitPreset stun slow dot warn warnPreset move onTick(inside,f) onSpawn(f) curtain */
function bskField(c, o) {
  var m = c.m;
  var warn = o.warn || 0;
  if (warn > 0) {
    if (o.w > 0 && o.h > 0) bskWarnRect(c, o.x, o.y, o.w, o.h, o.a || 0, warn, o.warnPreset);
    else bskWarnCircle(c, o.x, o.y, o.r, warn, o.warnPreset);
  }
  var f = { x: o.x, y: o.y, r: o.r || 0, w: o.w || 0, h: o.h || 0, a: o.a || 0, born: GT + warn, vis: null };
  eliteLater(warn, function () {
    if (!bskAlive(m)) return;
    var life = o.life || 4;
    f.born = GT;
    f.vis = o.preset ? eliteVisAdd({
      id: eliteVisId('psfield'), preset: o.preset, x: f.x, y: f.y, r: f.r, w: f.w, h: f.h, a: f.a, until: GT + life,
      curtain: !!o.curtain, every: o.move ? 0.12 : undefined
    }) : null;
    if (o.onSpawn) o.onSpawn(f);
    var acc = 0;
    var tick = o.tick || 0.5;
    bskTicks(m, life, 0.1, function () {
      if (o.move) o.move(f, 0.1);
      if (f.vis) { f.vis.x = f.x; f.vis.y = f.y; f.vis.a = f.a; }
      var inside = f.w > 0 ? eliteInRect(f.x, f.y, f.w, f.h, f.a) : eliteInCircle(f.x, f.y, f.r);
      acc += 0.1;
      if (acc + 1e-6 < tick) return;
      acc = 0;
      if (inside) {
        if (o.pct > 0) bskHit(c, o.pct, { dim: false, mul: bskTickMul(), sure: true, quiet: true, stun: o.stun, slow: o.slow, dot: o.dot, hitPreset: o.hitPreset });
        if (o.onTick) o.onTick(true, f);
      } else if (o.onTick) o.onTick(false, f);
    });
    eliteLater(life + 0.1, function () { if (f.vis) f.vis.until = 0; });
  });
  return f;
}

/* ---------------- 動作零件：連鎖閃電弧 ----------------
   一道電弧瞬間連到玩家身上（同 e_chainlightning 的畫法：追蹤電弧＋收尾事件）。 */
function bskBolt(c, o) {
  var m = c.m;
  var mp = eliteMonsterPos(m), pp = elitePos();
  if (!mp) return;
  var dist = eliteDist(mp.x, mp.y, pp.x, pp.y);
  var travelMs = Math.max(60, dist / ELITE_CHAIN_SPEED * 1000);
  var chainId = 'elite-chain-' + (ELITE_VIS_SEQ++);
  eliteFx({
    fxKind: 'chain', variant: 'lightning-chain', elem: c.elem, count: 1, dur: 0.35,
    targets: [m.floatSel, elitePF()], travelMs: [0, travelMs], preserveDeadTargets: true,
    lineLength: bfMeterPx(18),
    area: { sourceX: mp.x, sourceY: mp.y, x: pp.x, y: pp.y, chainId: chainId, homingSpeed: ELITE_CHAIN_SPEED },
    vfx: { projectile: o.proj || c.v.proj, hit: o.hitPreset === undefined ? c.v.hit : o.hitPreset }
  });
  eliteLater(travelMs / 1000 + 0.15, function () {
    eliteFx({ fxKind: 'chain', variant: 'lightning-chain-end', hit: false, vfx: {}, area: { chainId: chainId } });
  });
  eliteLater(travelMs / 1000, function () {
    if (!bskAlive(m)) return;
    bskHit(c, o.pct, { sure: false, quiet: !!o.quiet, stun: o.stun, hitFx: false, onHit: o.onHit });
  });
}

/* ---------------- 動作零件：環繞體 ----------------
   n 顆環繞體繞著 BOSS（rps 圈／秒，半徑從 r0 長到 r1），碰到玩家就命中一次（同一顆 touchCd 秒內不重複）。
   畫面只送一則軌道事件（js/vfx-runtime.js playOrbit，圓心用 area.centreId 指到 BOSS），逐幀的旋轉與外擴由顯示層照同一組公式補；
   判定在這裡用同一組公式逐 0.1 秒算：角度＝startAng＋spin×t＋2π×k／n、半徑＝r0＋(r1−r0)×t／dur（與 playOrbit 的 grow／growMax 對齊）。
   o：n dur rps r0 r1 orbR pct touchCd orbPreset(環繞體特效) ringPreset(軌道環特效) spin(±1) auraVariant onTouch(x,y,orbIndex) stun slow */
var BSK_ORBIT_SEQ = 0;
function bskOrbit(c, o) {
  var m = c.m;
  var mp0 = eliteMonsterPos(m);
  if (!mp0) return;
  var n = Math.max(1, Math.min(12, Math.floor(o.n || 1)));
  var dur = Math.min(12, o.dur || 5);
  var r1 = o.r1 === undefined ? o.r0 : o.r1;
  var dir = (o.spin || 1) < 0 ? -1 : 1;
  var spinRate = dir * (o.rps || 0.5) * Math.PI * 2;
  var base = Math.random() * Math.PI * 2;
  var touched = [];
  var lastAny = -9;
  for (var i = 0; i < n; i++) touched.push(-9);
  if (o.orbPreset) {
    eliteFx({
      fxKind: 'aura', variant: o.auraVariant || 'firehunt', elem: c.elem, dur: dur, count: n, hit: false,
      area: {
        x: mp0.x, y: mp0.y, r: o.r0, orbR: o.orbR, orbs: n, spin: dir, spinRate: spinRate, startAng: base,
        id: 'ps-orbit-' + (BSK_ORBIT_SEQ++), centreId: m.floatSel, grow: dur > 0 ? (r1 - o.r0) / dur : 0, growMax: r1 > o.r0 ? r1 : 0,
        rGrowTo: 1, rGrowSec: 1, orbGrowTo: 1, orbGrowSec: 1
      },
      vfx: { projectile: o.orbPreset, ground: o.ringPreset || undefined }
    });
  }
  bskTicks(m, dur, 0.1, function (k, t) {
    var mp = eliteMonsterPos(m);
    if (!mp) return;
    var rad = o.r0 + (r1 - o.r0) * Math.min(1, t / dur);
    var pp = elitePos();
    for (var j = 0; j < n; j++) {
      var a = base + spinRate * t + j * Math.PI * 2 / n;
      var ox = mp.x + Math.cos(a) * rad, oy = mp.y + Math.sin(a) * rad;
      if (GT - touched[j] < (o.touchCd || 0.6) || GT - lastAny < (o.anyCd || 0.5)) continue;   // 同一顆有間隔，整組之間也有間隔（單一玩家不會被一圈球連續打滿）
      if (eliteDist(ox, oy, pp.x, pp.y) <= o.orbR + ELITE_PLAYER_BODY_R) {
        touched[j] = GT;
        lastAny = GT;
        bskHit(c, o.pct, { dim: false, mul: 1, sure: true, quiet: true, stun: o.stun, slow: o.slow });
        if (o.onTouch) o.onTouch(ox, oy, j);
      }
    }
  });
}

/* ---------------- 動作零件：領域 ----------------
   以 BOSS 為中心的光環，持續 dur 秒；玩家在半徑內每 tick 秒吃一次傷害，可附拉扯／緩速。
   o：r dur tick pct preset(場域特效) pull(座標/秒) slow stun dot phys onTick */
function bskDomain(c, o) {
  var m = c.m;
  var mp0 = eliteMonsterPos(m);
  if (!mp0) return;
  var dur = o.dur || 6;
  var vis = o.preset ? eliteVisAdd({ id: eliteVisId('psdom'), preset: o.preset, x: mp0.x, y: mp0.y, r: o.r, until: GT + dur, every: 0.15 }) : null;
  var acc = 0;
  bskTicks(m, dur, 0.1, function () {
    var mp = eliteMonsterPos(m);
    if (!mp) return;
    if (vis) { vis.x = mp.x; vis.y = mp.y; }
    var pp = elitePos();
    var d = eliteDist(mp.x, mp.y, pp.x, pp.y);
    if (d > o.r + ELITE_PLAYER_BODY_R) { acc = Math.min(acc + 0.1, o.tick || 0.5); return; }
    if (o.pull > 0 && d > 40) {
      var step = Math.min(d - 30, o.pull * 0.1);
      pp.x -= (pp.x - mp.x) / d * step; pp.y -= (pp.y - mp.y) / d * step;
    }
    acc += 0.1;
    if (acc + 1e-6 < (o.tick || 0.5)) return;
    acc = 0;
    if (o.pct > 0) bskHit(c, o.pct, { dim: false, mul: bskTickMul(), sure: true, quiet: true, slow: o.slow, stun: o.stun, dot: o.dot });
    if (o.onTick) o.onTick();
  });
  eliteLater(dur + 0.1, function () { if (vis) vis.until = 0; });
}

/* ---------------- 動作零件：BOSS 自身增益 ---------------- */
function bskSelfStatus(c, sid, dur, extra) {
  if (!sid || typeof applyStatus !== 'function') return;
  var ctx = { dur: dur, vfxR: (c.m._bodyR || 20) * 1.15 };
  if (extra) Object.keys(extra).forEach(function (k) { ctx[k] = extra[k]; });
  applyStatus(c.m, sid, ctx);
}
/* 這一列的「我方狀態」第 idx 個條目的狀態 id（上身畫面由 Status 表決定）。 */
function bskSelfSid(c, idx) {
  var e = c.d.status && c.d.status.self && c.d.status.self[idx || 0];
  return e ? e.id : '';
}
function bskBuffAtk(c, factor, dur) {
  var ps = bskPs(c.m);
  ps.atk = Math.max(ps.atk, factor);
  ps.atkUntil = Math.max(ps.atkUntil, GT + dur);
}
function bskBuffDr(c, dr, dur) {
  var ps = bskPs(c.m);
  ps.dr = Math.max(ps.dr, Math.min(0.9, dr));
  ps.drUntil = Math.max(ps.drUntil, GT + dur);
}
function bskHeal(c, pct, label) {
  var m = c.m;
  var add = m.maxHp * pct / 100;
  var before = m.hp;
  m.hp = Math.min(m.maxHp, m.hp + add);
  if (m.hp > before) floatEnemyEvent(m, 'mv-float', '+' + fmt(m.hp - before), 'elite-heal');
}
function bskShield(c, amount, dur) {
  var m = c.m;
  m.shield = (m.shield || 0) + amount;
  if (typeof applyBuff === 'function') applyBuff(m, 'shield', 0, dur, 'shield');
}

/* ---------------- 動作零件：衝近 ----------------
   以 BOSS 為中心的招式（環形、領域、突刺、環繞體）需要玩家在範圍裡才有意義，而 BOSS 平常站在離玩家一個身位以外：
   離玩家比 reach 遠就先高速衝到離玩家 reach×0.75 處（沿用衝鋒的位移引擎 m._elDash），到位後才出招。 */
function bskDashSpeed() {
  for (var i = 0; i < ELITE_AFFIX_ORDER.length; i++) {
    var d = ELITE_AFFIXES[ELITE_AFFIX_ORDER[i]];
    if (d && d.arch === 'dash' && d.speed > 0) return d.speed;
  }
  return 900;
}
function bskNear(c, reach, fn) {
  var m = c.m;
  var mp = eliteMonsterPos(m), pp = elitePos();
  if (!mp) { fn(); return; }
  var dist = eliteDist(mp.x, mp.y, pp.x, pp.y);
  if (dist <= reach) { fn(); return; }
  var stop = Math.max(reach * 0.75, 50);
  var run = dist - stop;
  var dur = Math.max(0.12, run / bskDashSpeed());
  var ux = (pp.x - mp.x) / dist, uy = (pp.y - mp.y) / dist;
  eliteBusy(m, dur + 0.3, true);
  m._elLockUntil = GT + dur + 0.25;
  m._elDash = { sx: mp.x, sy: mp.y, ex: mp.x + ux * run, ey: mp.y + uy * run, t: 0, dur: dur };
  eliteLater(dur, function () {
    if (!(m.hp > 0)) { m._elDash = null; return; }
    var dash = m._elDash;
    var pos = eliteMonsterPos(m);
    if (dash && pos) { pos.x = dash.ex; pos.y = dash.ey; }
    m._elDash = null;
    if (bskAlive(m)) fn();
  });
}

/* ---------------- 入口：技能定義 → 招式 ---------------- */
var BSK_RECIPES = {};
var BSK_NEAR = {};     // 招式 id → function(c) 回傳需要玩家在多近（座標單位）才打得到；沒列＝遠距招式，原地施放
function bskCast(m, d) {
  var fn = BSK_RECIPES[d.ultId];
  if (!fn) return;
  var c = bskCtx(m, d);
  var reachFn = BSK_NEAR[d.ultId];
  if (reachFn) bskNear(c, reachFn(c), function () { fn(c); });
  else fn(c);
}
ELITE_CASTERS.psk = bskCast;

/* ---------------- 被動型技能：BOSS 被打時反應（神聖之體、天穹崩裂）----------------
   js/elite.js eliteOnDamaged 在最前面呼叫；每次 BOSS 實際受傷算一次。 */
function bskOnDamaged(m, dealt) {
  if (!m || !m.affixes || !m._el || !(m.hp > 0)) return;
  for (var i = 0; i < m.affixes.length; i++) {
    var d = eliteDef(m.affixes[i]);
    if (!d || d.pool !== 'player') continue;
    if (d.arch === 'pskCounter') bskCounterHit(m, d);
    else if (d.arch === 'pskReact') bskReactHit(m, d);
  }
}
/* 神聖之體：每受 count 次攻擊就朝玩家射出一顆光彈（落點預警後爆炸）。兩次觸發至少隔 psPassiveGap 秒。 */
function bskCounterHit(m, d) {
  var ps = bskPs(m);
  var c = bskCtx(m, d);
  ps.counter = (ps.counter || 0) + 1;
  if (ps.counter < Math.max(1, Math.floor(bskU(c, 'count', 10)))) return;
  if (GT - (ps.counterAt || -99) < bskG('PassiveGap', 4)) return;
  ps.counter = 0;
  ps.counterAt = GT;
  eliteAnnounce(m, d);
  bskSpots(c, {
    n: 1, r: bskRad(bskU(c, 'm', 8)), warn: 0.9, pct: bskU(c, 'pct') * 0.5, fall: 'rain', fallPreset: c.v.proj2, burstPreset: c.v.attack2,
    elem: 'light', hitPreset: undefined
  });
}
/* 天穹崩裂：受到攻擊時有 chance% 機率朝玩家射出一道小型追蹤風刃。兩次觸發至少隔 psPassiveGap 秒。 */
function bskReactHit(m, d) {
  var ps = bskPs(m);
  var c = bskCtx(m, d);
  if (GT - (ps.reactAt || -99) < bskG('PassiveGap', 4) * 0.6) return;
  if (Math.random() * 100 >= bskU(c, 'chance', 20)) return;
  ps.reactAt = GT;
  eliteAnnounce(m, d);
  bskChase(c, {
    legs: 3, speed: bskLen(bskT(c, 0, 'speed', 18)) * 1.6, proj: bskTierTrig(c, 3, 'projectile') || c.v.proj, hitR: 40,
    pct: (bskT(c, 3, 'pct') + bskU(c, 'pct')) * 0.8, startDelay: 0.2
  });
}

/* ---------------- 被動型技能：致命傷時保命／復活（不屈鬥魂、天地再造、逆轉乾坤）----------------
   js/tower.js endTowerFight(win) 最前面呼叫：回傳 true＝BOSS 沒有真的死，戰鬥繼續。 */
function eliteBossUndying(b) {
  if (!b || !b.affixes || !b._el || !eliteTowerOn() || TOWER.boss !== b) return false;
  var ps = bskPs(b);
  var indomitable = null, rebirth = null, reversal = null;
  for (var i = 0; i < b.affixes.length; i++) {
    var d = eliteDef(b.affixes[i]);
    if (!d || d.arch !== 'pskUndying') continue;
    if (d.ultId === 'indomitable') indomitable = d;
    else if (d.ultId === 'worldRebirth') rebirth = d;
    else if (d.ultId === 'fateReversal') reversal = d;
  }
  if (indomitable) {
    var ci = bskCtx(b, indomitable);
    if (GT - (ps.indomitableAt === undefined ? -999 : ps.indomitableAt) >= bskU(ci, 'cd', 40)) {
      ps.indomitableAt = GT;
      bskIndomitable(b, indomitable, ci);
      return true;
    }
  }
  var d2 = rebirth || reversal;
  if (d2) {
    if (ps.reviveCharges === undefined) {
      var charges = 0;
      if (rebirth) charges += 1;
      if (reversal) charges += Math.max(1, Math.min(2, Math.round(bskU(bskCtx(b, reversal), 'max', 2))));
      ps.reviveCharges = charges;
    }
    if (ps.reviveCharges > 0) {
      ps.reviveCharges--;
      bskRebirth(b, d2, bskCtx(b, d2));
      return true;
    }
  }
  return false;
}
function bskIndomitable(b, d, c) {
  var rt = b._el;
  b.hp = Math.max(1, b.maxHp * 0.03);
  rt.invulnUntil = GT + bskU(c, 'sec', 2.5);
  rt.invulnSid = 'eInvuln';
  var mp = eliteMonsterPos(b);
  var r = bskRad(bskU(c, 'm', 30));
  floatEnemyEvent(b, 'mv-float', d.emoji + d.name + '!', 'elite-cast');
  if (typeof blog === 'function') blog('🛡️ ' + (b.name || 'BOSS') + ' 發動【' + d.emoji + d.name + '】，免於一死！', 'log-enemy-skill', 'combat');
  if (mp) {
    if (c.v.attack2) eliteBurstFx(mp.x, mp.y, r, c.v.attack2, 0);
    if (c.v.hit2) eliteHitFx(b.floatSel, c.v.hit2);
    if (c.v.ground2) eliteWarn(mp.x, mp.y, r, c.v.ground2, bskU(c, 'lightSec', 2), 'psind');
    var pp = elitePos();
    if (eliteDist(pp.x, pp.y, mp.x, mp.y) <= r) {
      elitePushPlayer(mp.x, mp.y, bskLen(bskU(c, 'pushM', 30)) * 0.5);
      var p = elitePlayer();
      if (p) {
        var dCfg = playerDefCfg(p);
        var ccf = (dCfg.ccFactor === undefined) ? 1 : dCfg.ccFactor;
        if (!resistCtrl(dCfg)) applyEffect(p, 'stun', bskU(c, 'stunSec', 3) * bskCtrl() * ccf);
      }
    }
  }
}
function bskRebirth(b, d, c) {
  var rt = b._el;
  var pct = Math.max(1, bskU(bskCtx(b, d), 'hp', 50) * bskG('ReviveHpPct', 40) / 100);
  b.hp = Math.max(1, b.maxHp * pct / 100);
  b.shield = 0;
  rt.invulnUntil = GT + 2.5;
  rt.invulnSid = 'eInvuln';
  if (typeof cleanse === 'function') cleanse(b);
  var mp = eliteMonsterPos(b);
  floatEnemyEvent(b, 'mv-float', d.emoji + d.name + '!', 'elite-cast');
  if (typeof blog === 'function') blog('🌍 ' + (b.name || 'BOSS') + ' 發動【' + d.emoji + d.name + '】，以 ' + Math.round(pct) + '% 生命重生！', 'log-enemy-skill', 'combat');
  if (mp) eliteBurstFx(mp.x, mp.y, 110, c.v.attack, 0);
  if (c.v.hit) eliteHitFx(b.floatSel, c.v.hit);
}

/* ---------------- 技能定義補完（冷卻、種類）----------------
   js/elite_data.js 只整理名稱／特效；冷卻與主動／被動由這裡決定（Worker 才需要）。
   預設冷卻＝該群組的玩家冷卻 × [1.25, 2]；自身增益、領域、場域這類持續很久的招式拉長，避免整場都在放。 */
var BSK_META = {
  holyBody: { kind: 'passive', arch: 'pskCounter' },
  skyCollapse: { kind: 'passive', arch: 'pskReact' },
  indomitable: { kind: 'passive', arch: 'pskUndying' },
  worldRebirth: { kind: 'passive', arch: 'pskUndying' },
  fateReversal: { kind: 'passive', arch: 'pskUndying' }
};
/* 持續型招式的冷卻（秒）：[下限, 上限] */
var BSK_LONG_CD = [16, 22];
var BSK_LONG = ['slayerDomain', 'venomDomain', 'fireGodDescend', 'gravityField', 'abyssBurial', 'waterPrisonFall', 'adamantBody', 'valgrForce',
  'hallOfRadiance', 'warGodBody', 'slayerAdvent', 'warGodRoll', 'asuraFist', 'plagueMire', 'abyssInferno', 'netherMire', 'iceKingDomain',
  'solarRing', 'infiniteRing', 'criticalThunderbolt', 'voidAnnihilation', 'spacetimeCollapse', 'eternalSuperconductor'];
function bskDecorate() {
  Object.keys(ELITE_AFFIXES).forEach(function (id) {
    var d = ELITE_AFFIXES[id];
    if (!d || d.pool !== 'player') return;
    var meta = BSK_META[d.ultId];
    if (meta) { d.kind = meta.kind; d.arch = meta.arch; d.cd = [0, 0]; return; }
    d.kind = 'active';
    d.arch = 'psk';
    var base = Number(SKILLS2[d.gid].cd) > 0 ? Number(SKILLS2[d.gid].cd) : 10;
    d.cd = BSK_LONG.indexOf(d.ultId) >= 0 ? BSK_LONG_CD.slice() : [base * 1.25, base * 2];
    if (d.ultId === 'stormGodSlash') {
      var sec = Math.max(2, sgVal(SKILLS2.cleave.ult[2].fx, 'sec', bskLevel()));
      d.cd = [sec * 1.5, sec * 2.2];
    }
    var ufx = SKILLS2[d.gid].ult[d.ultIdx].fx || {};
    if (Number(ufx.bossCd) > 0) d.cd = [Number(ufx.bossCd), Math.max(Number(ufx.bossCd), Number(ufx.bossCdMax) || Number(ufx.bossCd) * 1.3)];   // 設計師在 Skills2 該列指定的 BOSS 冷卻
  });
  ELITE_PASSIVE_ARCHS.push('pskCounter', 'pskReact', 'pskUndying');
}
bskDecorate();
