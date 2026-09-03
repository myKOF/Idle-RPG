'use strict';
/* ============================================================
   vfx-runtime.js — VFX Preset 的遊戲端轉接層（Runtime Adapter）

   它是「模擬層送出的 VFX 事件」與「VFX Core」之間唯一的橋：
     spec（含 spec.vfx = 角色 → preset id） → 挑出主要角色 → 決定放在哪、多大、怎麼動
   規格與角色語意見 docs/vfx/VFX_RUNTIME_ADAPTER.md §1。

   三條不可動搖的界線：
     1. **只做表現，不做判定。** 位置、半徑、飛行時間全部來自事件本身
        （AI_RULES 8.3：計算層與表現層共用同一個語意參數），這裡不自己編路徑。
     2. **缺主要角色就整則退回舊畫法**（tryPlay 回 false）。半套的畫面比舊畫面更糟，
        而且會讓「哪些技能已經 Preset 化」變得看不出來。
     3. **Core 不認得遊戲概念。** 目標、玩家、場域合併都在這一層；Core 只提供
        play／setTransform／stop 三個旋鈕。

   名目尺寸（Preset 以此繪製，這裡負責換算成實際幾何）：
     圓形場域／範圍爆發 半徑 100px、矩形場域 200×100、光束與連鎖段 沿 +X 長 200px、
     環繞體 半徑 20px、受擊／施放／狀態 以目標身高 60px 為基準。
   ============================================================ */

var VFXRuntime = (function () {

  var NOMINAL_RADIUS = 100;     // 圓形場域／範圍爆發
  var NOMINAL_RECT_W = 200;     // 矩形場域
  var NOMINAL_RECT_H = 100;
  var NOMINAL_BEAM = 200;       // 光束／連鎖段沿 +X 的長度
  var NOMINAL_LANCE = 100;      // 帶 angle 的方向型攻擊（突刺光槍）沿 +X 的長度
  var NOMINAL_LANCE_W = 36;     // 同上的名目寬度
  var NOMINAL_ORB = 20;         // 環繞體名目半徑（scale＝area.orbR/20）
  /* 環繞場域的三個常數與舊畫法（battle-renderer spawnFireHunt）取同一組值：
     兩邊畫的是同一個東西，數字分家就會出現「切 ?vfx=legacy 前後大小不一樣」。 */
  var ORBIT_MAX_SEC = 12;       // 顯示上限（秒）；【再生】可延長，但不無限延長
  var ORBIT_FLAT = 0.62;        // 俯視壓扁，與棋盤的透視一致
  var ORBIT_LIFT = 12;          // 圓心略高於腳底，對齊角色貼圖的視覺中心
  var STRONG_HIT_SCALE = 1.6;   // 範圍型命中的受擊爆點放大倍率

  /* 場域事件是每一拍送一次的：這一拍之後多久沒有續命就收掉。
     取 2.5 拍是為了容忍一次掉幀或一次事件遺失，又不會在場域真的結束後還留著。 */
  var GROUND_KEEP_TICKS = 2.5;
  var GROUND_MIN_KEEP_SEC = 0.35;
  /* 狀態光環的快照頻率是 5Hz，同樣要容忍一次遺失。 */
  var AURA_KEEP_SEC = 0.6;

  var FX_BUDGET = { maxActiveEffects: 160, maxParticles: 2400 };
  var ZONE_BUDGET = { maxActiveEffects: 40, maxParticles: 1200 };

  /* ---------------------------------------------------------------
     角色選擇：這一則事件的「主要角色」是誰
     --------------------------------------------------------------- */
  function primaryRoleOf(spec, roles) {
    var kind = spec.fxKind;
    var variant = spec.variant || '';
    /* 變體特例（見設計文件 §1.1 的最後一段）——先判，因為它們跨 fxKind。 */
    if (variant === 'starfall-impact') return 'hit';            // 只做受擊回饋
    if (kind === 'impact' && variant === 'pillar') return 'ground';
    if ((kind === 'impact' || kind === 'burst') && variant === 'wind-burst') return 'attack';
    if (kind === 'impact' && variant === 'smite') return 'attack';

    switch (kind) {
      case 'projectile': return 'projectile';
      case 'slash': case 'strike': case 'burst': case 'beam': case 'curse': return 'attack';
      case 'rain': return roles.projectile ? 'projectile' : 'attack';
      case 'chain': return roles.projectile ? 'projectile' : 'attack';
      case 'aura': return 'ground';
      case 'selfBuff': return 'cast';
      case 'impact': return 'hit';
      case 'enemy-attack': return variant === 'enemy-projectile' ? 'projectile' : 'attack';
      default: return null;
    }
  }

  /* 範圍型命中的爆點放大：一顆隕石的落點不該與一刀砍中同樣大小。 */
  function hitScaleOf(spec) {
    if (Number(spec.sizeMult) > 0) return Number(spec.sizeMult);
    return (spec.fxKind === 'rain' || spec.fxKind === 'burst') ? STRONG_HIT_SCALE : 1;
  }

  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }
  function travelSecAt(spec, i) {
    var arr = spec.travelMs;
    if (!Array.isArray(arr) || !arr.length) return 0;
    var ms = num(arr[Math.min(i, arr.length - 1)], 0);
    return Math.max(0, ms) / 1000;
  }

  /* ---------------------------------------------------------------
     建立一份 Adapter。backend／resolver／ctx 全部由呼叫端注入，
     因此測試可以用 NullBackend 在 Node 裡跑完整條路徑。
     ctx 需要：posOf(id)、playerPos()、projectileTargetPoint(id, sec)
     --------------------------------------------------------------- */
  function create(opts) {
    var o = opts || {};
    var ctx = o.ctx || {};
    if (!ctx.posOf || !ctx.playerPos) throw new Error('VFXRuntime 需要 ctx.posOf 與 ctx.playerPos');
    /* 受擊爆點打在身體中心，施放光環與狀態光環的原點卻在腳底（名目身高 60px 的 0 點）。
       沒有 footOf 就退回 posOf——光環會浮高半個身位，但不會壞掉。 */
    var footOf = ctx.footOf || ctx.posOf;
    var Core = o.core || (typeof VFXCore !== 'undefined' ? VFXCore : null);
    if (!Core) throw new Error('VFXRuntime 需要 VFXCore');

    var rtFx = Core.createRuntime({
      backend: o.fxBackend, resolver: o.resolver,
      budget: o.fxBudget || FX_BUDGET
    });
    var rtZone = Core.createRuntime({
      backend: o.zoneBackend || o.fxBackend, resolver: o.resolver,
      budget: o.zoneBudget || ZONE_BUDGET
    });

    var known = Object.create(null);        // presetId → true（兩個 runtime 都註冊過）
    var projectiles = [];                   // 逐幀前進的飛行物
    var follows = [];                       // 跟著玩家／實體走的效果（cast）
    var grounds = Object.create(null);      // area.id → 場域
    var orbits = Object.create(null);       // 合併鍵 → 環繞場域（軌道環＋N 個環繞體）
    var auras = Object.create(null);        // entKey + '|' + sid → 狀態光環
    var pending = [];                       // 延後播放（受擊要等飛行物抵達）
    var clock = 0;                          // 累計秒數（隨 update(dt) 前進，暫停時不走）
    var counters = { played: 0, skipped: 0, missing: 0 };

    function registerPresets(list) {
      (list || []).forEach(function (p) {
        if (!p || !p.id || known[p.id]) return;
        rtFx.registerPreset(p);
        rtZone.registerPreset(p);
        known[p.id] = true;
      });
    }

    function has(id) { return !!(id && known[id]); }

    /* ---- 播放：把 Core 的 handle 連同它屬於哪個 runtime 一起記住 ----
       Core 超出 budget 時 play() 回 null（寧可少一個特效也不掉幀）。
       那會讓 tryPlay 回 false，於是這一則改由舊畫法接手——洪峰時畫面會混著兩種風格，
       但不會有「該有的特效整個不見」。降級的門檻就是 budget，不在這裡另外加限流。 */
    function play(rt, presetId, params) {
      if (!has(presetId)) { counters.missing++; return null; }
      var handle = rt.play(presetId, params || {});
      if (handle === null || handle === undefined) return null;
      counters.played++;
      return { rt: rt, handle: handle };
    }
    function stopRef(ref) {
      if (!ref) return;
      ref.rt.stop(ref.handle);
    }

    /* ---- 幾何 ---- */
    function areaCentre(area) {
      return { x: num(area.x, 0), y: num(area.y, 0) };
    }
    /* 場域／範圍的縮放：圓形吃半徑，矩形吃長寬，兩者的名目尺寸不同。 */
    function areaScaleParams(area) {
      var w = num(area.w, 0), h = num(area.h, 0);
      if (w > 0 && h > 0) {
        return { scaleX: w / NOMINAL_RECT_W, scaleY: h / NOMINAL_RECT_H, rotation: num(area.a, 0) };
      }
      var r = num(area.r, 0);
      if (r > 0) return { scale: r / NOMINAL_RADIUS, rotation: num(area.a, 0) };
      return { scale: 1, rotation: 0 };
    }

    /* ---- 主要角色的四種擺法 ---- */

    /* 目標身上（受擊、詛咒、單體攻擊本體）。
       帶 sourceId 時（敵方近戰）把畫面轉向「攻擊者 → 目標」，爪痕才會朝著被打的人。 */
    function playOnTargets(rt, presetId, spec, scale, delaySec) {
      var ids = Array.isArray(spec.targets) ? spec.targets.slice(0, 8) : [];
      if (!ids.length) return false;
      var any = false;
      for (var i = 0; i < ids.length; i++) {
        if (delaySec > 0) {
          pending.push({ at: clock + delaySec, rt: rt, presetId: presetId, targetId: ids[i], scale: scale });
          any = true;
          continue;
        }
        var p = ctx.posOf(ids[i]);
        var params = { position: p, scale: scale };
        if (spec.sourceId) {
          var src = ctx.posOf(spec.sourceId);
          params.rotation = Math.atan2(p.y - src.y, p.x - src.x);
        }
        if (play(rt, presetId, params)) any = true;
      }
      return any;
    }

    /* 攻擊本體要不要等：帶 travelMs 的近戰／斬擊事件，畫面應該和傷害數字同時到。 */
    function hitDelayFor(spec) {
      return travelSecAt(spec, 0);
    }

    /* 範圍中心（爆發、場域一次性） */
    function playOnArea(rt, presetId, spec) {
      if (!spec.area) return false;
      var params = areaScaleParams(spec.area);
      params.position = areaCentre(spec.area);
      return !!play(rt, presetId, params);
    }

    /* 帶 angle 的方向型攻擊（突刺光槍、齊射的風刃）：從施法者身上沿該方位拉出去。
       方位是模擬層算好的（路徑上可能一個敵人都沒有，不能從 targets 反推），
       長寬同樣沿用事件帶來的 lineLength／lineWidth，不自己另外挑一組。 */
    function playDirectional(rt, presetId, spec) {
      var len = num(spec.lineLength, 0);
      if (!(len > 0)) return false;
      var width = num(spec.lineWidth, 0);
      var from = spec.sourceId ? ctx.posOf(spec.sourceId) : ctx.playerPos();
      return !!play(rt, presetId, {
        position: from,
        rotation: num(spec.angle, 0),
        scaleX: len / NOMINAL_LANCE,
        scaleY: width > 0 ? width / NOMINAL_LANCE_W : 1
      });
    }

    /* 從玩家（或起點）沿方向拉長到目標：光束與連鎖段 */
    function playBeam(rt, presetId, spec) {
      var ids = Array.isArray(spec.targets) ? spec.targets : [];
      var from = ids.length >= 2 ? ctx.posOf(ids[0])
        : (spec.sourceId ? ctx.posOf(spec.sourceId) : ctx.playerPos());
      var toId = ids.length >= 2 ? ids[1] : ids[0];
      if (!toId) return false;
      var to = ctx.posOf(toId);
      var dx = to.x - from.x, dy = to.y - from.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (!(dist > 0)) dist = 1;
      return !!play(rt, presetId, {
        position: from,
        rotation: Math.atan2(dy, dx),
        scaleX: dist / NOMINAL_BEAM,
        scaleY: 1
      });
    }

    /* 飛行物：逐幀 setTransform 從起點移到目標，朝飛行方向旋轉 */
    function playProjectile(rt, presetId, spec) {
      var ids = Array.isArray(spec.targets) ? spec.targets : [];
      var chained = ids.length >= 2;
      var toId = chained ? ids[1] : ids[0];
      if (!toId) return false;
      var travel = travelSecAt(spec, chained ? 1 : 0);
      var from;
      /* 起點：連鎖段從前一個目標、敵方出手從攻擊者（sourceId）、天降從落點正上方，
         其餘才是從玩家。敵方投射物若用玩家當起點，會變成「從自己身上飛向自己」。 */
      if (chained) from = ctx.posOf(ids[0]);
      else if (spec.sourceId) from = ctx.posOf(spec.sourceId);
      else if (spec.fxKind === 'rain') {
        /* 天降：從落點正上方 500px 落下（名目高度，與 bolt 家族同一組座標慣例）。 */
        var landing = spec.area ? areaCentre(spec.area) : ctx.posOf(toId);
        from = { x: landing.x, y: landing.y - 500 };
      } else from = ctx.playerPos();
      var to = (travel > 0 && ctx.projectileTargetPoint)
        ? ctx.projectileTargetPoint(toId, travel) : ctx.posOf(toId);
      var ref = play(rt, presetId, {
        position: from,
        rotation: Math.atan2(to.y - from.y, to.x - from.x),
        scale: Number(spec.sizeMult) > 0 ? Number(spec.sizeMult) : 1
      });
      if (!ref) return false;
      projectiles.push({
        ref: ref, from: from, targetId: toId, t: 0,
        dur: travel > 0 ? travel : 0.001,
        scale: Number(spec.sizeMult) > 0 ? Number(spec.sizeMult) : 1
      });
      return true;
    }

    /* 玩家腳底並跟著玩家走：施放特效 */
    function playOnPlayer(rt, presetId, spec) {
      var ref = play(rt, presetId, { position: footOf('pv-float') });
      if (!ref) return false;
      follows.push({ ref: ref, key: 'pv-float', until: clock + Math.max(0.2, num(spec.dur, 0.9)) });
      return true;
    }

    /* 持續場域：以 area.id 合併，重複事件只續命與更新位置 */
    function playGround(presetId, spec) {
      if (!spec.area) return false;
      var key = spec.area.id ||
        (presetId + '@' + Math.round(num(spec.area.x, 0)) + ',' + Math.round(num(spec.area.y, 0)));
      var keep = Math.max(GROUND_MIN_KEEP_SEC, num(spec.dur, 0.5) * GROUND_KEEP_TICKS);
      var params = areaScaleParams(spec.area);
      params.position = areaCentre(spec.area);
      var live = grounds[key];
      if (live && live.presetId === presetId) {
        live.expireAt = clock + keep;
        live.ref.rt.setTransform(live.ref.handle, params);
        return true;
      }
      if (live) { stopRef(live.ref); delete grounds[key]; }
      var ref = play(rtZone, presetId, params);
      if (!ref) return false;
      grounds[key] = { ref: ref, presetId: presetId, expireAt: clock + keep };
      return true;
    }

    /* ---------------------------------------------------------------
       環繞場域：軌道環（zone 層）＋ 沿環公轉的 N 個環繞體（fx 層）

       幾何與成長曲線全部沿用模擬層送來的語意參數（AI_RULES 8.3），
       公式與舊畫法 battle-renderer.spawnFireHunt 逐項對齊——那是模擬層實際判定
       接觸的那個圓，畫小了玩家會覺得「明明沒碰到卻扣血」。
       圓心不取 area 的 x／y 而是逐幀讀玩家座標：環繞場域本來就跟著玩家跑。
       --------------------------------------------------------------- */
    function orbitGeom(area) {
      var rate = num(area.spinRate, NaN);
      return {
        ringR: Math.max(6, num(area.r, 0)),
        orbR: Math.max(3, num(area.orbR, 0)),
        /* 起始角：模擬層算接觸時用的就是 startAng + 2π·k/count（sgOrbitStep），
           顯示層必須用同一個角度，否則畫面上的球與實際會打到人的球對不起來
           （AI_RULES 8.3）。虛空鋸刃更是靠它把四片盤錯開——忽略它會四片疊在一起。 */
        startAng: num(area.startAng, 0),
        orbs: Math.max(1, Math.min(12, Math.floor(num(area.orbs, 1)))),
        /* 角速度沿用模擬層的實際值；舊事件沒有 spinRate 就退回每秒 1 圈。 */
        spin: (isFinite(rate) && Math.abs(rate) > 1e-6) ? rate
          : (num(area.spin, 1) < 0 ? -1 : 1) * Math.PI * 2,
        growPx: Math.max(0, num(area.grow, 0)),          // 環半徑每秒外擴 px
        growMax: Math.max(0, num(area.growMax, 0)),      // 外擴上限（0＝不設限）
        spiral: num(area.spiral, 0) > 0,                 // 每一團各自從圓心往外長
        spiralLag: Math.max(0, num(area.spiralLag, 0)),  // 相鄰兩團的出生間隔（秒）
        orbGrowTo: Math.max(1, num(area.orbGrowTo, 1)),
        orbGrowSec: Math.max(0.1, num(area.orbGrowSec, 1)),
        rGrowTo: Math.max(1, num(area.rGrowTo, 1)),
        rGrowSec: Math.max(0.1, num(area.rGrowSec, num(area.orbGrowSec, 1)))
      };
    }
    function orbitCentre() {
      var p = footOf('pv-float');
      return { x: p.x, y: p.y - ORBIT_LIFT };
    }
    /* 合併鍵：同一道（半徑＋方向相同）只保留一組。【再生】延長持續時間時
       模擬層會補送同一道的事件，沒有這層合併就會愈疊愈多團。
       鍵含變體與屬性——火狩與環體電球可能同時存在且半徑相同。 */
    function orbitKeyOf(spec, geo) {
      if (spec.area && spec.area.id) return String(spec.area.id);
      return (spec.variant || 'orbit') + ':' + (spec.elem || '') + ':' +
        Math.round(geo.ringR) + ':' + (geo.spin < 0 ? 'ccw' : 'cw');
    }
    /* 團數會變（火狩每投資一階多一團）：多退少補，不整組重建。 */
    function syncOrbCount(entry) {
      while (entry.orbs.length > entry.geo.orbs) stopRef(entry.orbs.pop());
      while (entry.orbs.length < entry.geo.orbs) {
        var ref = play(rtFx, entry.orbId, { position: orbitCentre(), scale: entry.geo.orbR / NOMINAL_ORB });
        if (!ref) break;                    // 預算滿了就先少幾團，下一次事件再補
        entry.orbs.push(ref);
      }
    }
    function stopOrbit(key) {
      var o = orbits[key];
      if (!o) return;
      if (o.ring) stopRef(o.ring);
      o.orbs.forEach(stopRef);
      delete orbits[key];
    }
    function playOrbit(spec, roles) {
      /* 沒有環繞體的 preset 就整則交還舊畫法：只畫軌道環等於把環繞體弄不見。 */
      var orbId = roles.projectile;
      if (!orbId || !has(orbId)) return false;
      var geo = orbitGeom(spec.area);
      var key = orbitKeyOf(spec, geo);
      var dur = Math.min(ORBIT_MAX_SEC, Math.max(0.5, num(spec.dur, 4)));
      var live = orbits[key];
      if (live && live.orbId === orbId) {
        live.dur = Math.min(ORBIT_MAX_SEC, Math.max(live.dur, live.t + dur));
        live.geo = geo;
        syncOrbCount(live);
        return true;
      }
      if (live) stopOrbit(key);
      var ringId = (roles.ground && has(roles.ground)) ? roles.ground : '';
      var centre = orbitCentre();
      var entry = {
        orbId: orbId, ringId: ringId, geo: geo, t: 0, dur: dur, orbs: [],
        ring: ringId ? play(rtZone, ringId, { position: centre, scale: geo.ringR / NOMINAL_RADIUS }) : null
      };
      orbits[key] = entry;
      syncOrbCount(entry);
      /* 一團都放不下（預算滿）＝這一則沒有畫面，交還舊畫法。 */
      if (!entry.orbs.length) { stopOrbit(key); return false; }
      return true;
    }
    function updateOrbits(step) {
      Object.keys(orbits).forEach(function (key) {
        var o = orbits[key];
        o.t += step;
        if (o.t >= o.dur) { stopOrbit(key); return; }
        var g = o.geo;
        var centre = orbitCentre();
        function ease(sec) { return Math.max(0, Math.min(1, o.t / sec)); }
        /* 體積成長（超神【烈陽星環】）：出生後 orbGrowSec 秒內線性長到 orbGrowTo 倍。 */
        var orbR = g.orbGrowTo > 1 ? g.orbR * (1 + (g.orbGrowTo - 1) * ease(g.orbGrowSec)) : g.orbR;
        /* 圈距成長：這一道環的半徑在 rGrowSec 秒內線性長到 rGrowTo 倍（最內圈恆為 1）。 */
        var ringRNow = g.rGrowTo > 1 ? g.ringR * (1 + (g.rGrowTo - 1) * ease(g.rGrowSec)) : g.ringR;
        var capR = g.growMax > 0 ? g.growMax : Infinity;
        /* 整環一起長（虛空斬）先算好；螺旋（超神【無限星環】）則每一團各自算。 */
        var wholeR = (g.growPx > 0 && !g.spiral) ? Math.min(capR, ringRNow + g.growPx * o.t) : ringRNow;
        if (o.ring && !o.ring.rt.setTransform(o.ring.handle,
          { position: centre, scale: wholeR / NOMINAL_RADIUS })) o.ring = null;
        var base = g.startAng + g.spin * o.t;
        var dir = g.spin < 0 ? -1 : 1;
        for (var i = o.orbs.length - 1; i >= 0; i--) {
          /* 螺旋：第 i 團晚 i×spiralLag 秒才出生，半徑因此短了那一段時間的成長量——
             整組畫出來是一條從圓心往外長的螺旋，而不是同心圓。 */
          var orbT = g.spiral ? Math.max(0, o.t - i * g.spiralLag) : o.t;
          var rNow = g.spiral ? Math.min(capR, ringRNow + g.growPx * orbT) : wholeR;
          var ang = base + Math.PI * 2 * i / o.orbs.length;
          /* 朝向取「螢幕上的切線方向」而不是 ang＋90°：橢圓被壓扁 0.62 之後，
             那兩者差得出來（Preset 一律朝 +X 繪製，拖尾會指錯邊）。 */
          var heading = Math.atan2(Math.cos(ang) * ORBIT_FLAT * dir, -Math.sin(ang) * dir);
          var alive = o.orbs[i].rt.setTransform(o.orbs[i].handle, {
            position: { x: centre.x + Math.cos(ang) * rNow, y: centre.y + Math.sin(ang) * rNow * ORBIT_FLAT },
            rotation: heading,
            scale: orbR / NOMINAL_ORB
          });
          if (!alive) o.orbs.splice(i, 1);
        }
        if (!o.orbs.length && !o.ring) stopOrbit(key);
      });
    }

    /* ---------------------------------------------------------------
       tryPlay：整則事件的入口。回 false＝這一則交還給舊畫法。
       --------------------------------------------------------------- */
    function tryPlay(spec) {
      if (!spec) return false;
      var roles = spec.vfx;
      if (!roles || typeof roles !== 'object') return false;
      /* 環繞場域（火狩星環、環體電球、虛空鋸刃）：軌道環與環繞體是同一件事，
         必須一起接手，因此走自己的路徑而不是一般的角色分派。 */
      if (spec.area && num(spec.area.orbs, 0) > 0) return playOrbit(spec, roles);
      var role = primaryRoleOf(spec, roles);
      var presetId = role ? roles[role] : '';
      if (!presetId || !has(presetId)) { counters.skipped++; return false; }

      var ok = false;
      switch (role) {
        case 'hit':
          ok = playOnTargets(rtFx, presetId, spec, hitScaleOf(spec), 0);
          break;
        case 'projectile':
          ok = playProjectile(rtFx, presetId, spec);
          break;
        case 'cast':
          ok = playOnPlayer(rtFx, presetId, spec);
          break;
        case 'ground':
          ok = playGround(presetId, spec);
          break;
        case 'attack':
          if (spec.area) ok = playOnArea(rtFx, presetId, spec);
          else if (isFinite(spec.angle) && num(spec.lineLength, 0) > 0) ok = playDirectional(rtFx, presetId, spec);
          else if (spec.fxKind === 'beam' || spec.fxKind === 'chain') ok = playBeam(rtFx, presetId, spec);
          else ok = playOnTargets(rtFx, presetId, spec, 1, hitDelayFor(spec));
          break;
        default:
          ok = false;
      }
      if (!ok) { counters.skipped++; return false; }

      /* 天降類的落點預警：飛行物在天上飛的同時，地上要有那一圈紅／藍標記。
         舊畫法本來就兩個都畫，只接手飛行物會讓預警圈消失。 */
      if (role === 'projectile' && spec.area && roles.ground && has(roles.ground)) {
        playGround(roles.ground, spec);
      }

      /* 受擊爆點：同一則事件的 hit 角色跟著主要角色走（飛行物則等它抵達）；
         主要角色本身就是 hit 時不重複播。
         spec.hit === false＝這一擊被閃避或被無敵擋下，舊畫法同樣不畫爆點。 */
      if (role !== 'hit' && spec.hit !== false && roles.hit && has(roles.hit)) {
        playOnTargets(rtFx, roles.hit, spec, hitScaleOf(spec),
          role === 'projectile' ? travelSecAt(spec, Array.isArray(spec.targets) && spec.targets.length >= 2 ? 1 : 0) : 0);
      }
      return true;
    }

    /* ---------------------------------------------------------------
       狀態光環：由 5Hz 面板快照 reconcile（事件驅動做不到「還在不在」）
       entries：[{ key, sids: [statusId...] }]，key 即 posOf 認得的 elId
       --------------------------------------------------------------- */
    function syncStatuses(entries) {
      var wanted = Object.create(null);
      (entries || []).forEach(function (e) {
        if (!e || !e.key || !Array.isArray(e.sids)) return;
        e.sids.forEach(function (sid) {
          var presetId = statusAuraPreset(sid);
          if (!presetId || !has(presetId)) return;
          var k = e.key + '|' + sid;
          wanted[k] = true;
          var live = auras[k];
          if (live) { live.expireAt = clock + AURA_KEEP_SEC; return; }
          var ref = play(rtFx, presetId, { position: footOf(e.key) });
          if (ref) auras[k] = { ref: ref, key: e.key, expireAt: clock + AURA_KEEP_SEC };
        });
      });
      /* 沒出現在這次快照裡的立刻收掉：狀態消失時光環必須跟著消失，
         留到 expireAt 才收會讓「解除控場」看起來慢半拍。 */
      Object.keys(auras).forEach(function (k) {
        if (wanted[k]) return;
        stopRef(auras[k].ref);
        delete auras[k];
      });
    }
    function statusAuraPreset(sid) {
      if (typeof statusVfxPreset !== 'function') return '';
      return statusVfxPreset(sid, 'aura') || '';
    }

    /* ---------------------------------------------------------------
       每幀推進
       --------------------------------------------------------------- */
    function update(dt) {
      var step = Math.max(0, num(dt, 0));
      clock += step;

      /* 延後的受擊爆點 */
      for (var q = pending.length - 1; q >= 0; q--) {
        if (pending[q].at > clock) continue;
        var job = pending[q];
        pending.splice(q, 1);
        play(job.rt, job.presetId, { position: ctx.posOf(job.targetId), scale: job.scale });
      }

      /* 飛行物：位置由「起點 → 目標當下座標」線性補間，目標會動就跟著動。 */
      for (var i = projectiles.length - 1; i >= 0; i--) {
        var pr = projectiles[i];
        pr.t += step;
        var k = Math.min(1, pr.t / pr.dur);
        var to = ctx.posOf(pr.targetId);
        var x = pr.from.x + (to.x - pr.from.x) * k;
        var y = pr.from.y + (to.y - pr.from.y) * k;
        var alive = pr.ref.rt.setTransform(pr.ref.handle, {
          position: { x: x, y: y },
          rotation: Math.atan2(to.y - pr.from.y, to.x - pr.from.x),
          scale: pr.scale
        });
        if (!alive || k >= 1) {
          if (alive) stopRef(pr.ref);
          projectiles.splice(i, 1);
        }
      }

      /* 跟隨玩家的施放特效 */
      for (var f = follows.length - 1; f >= 0; f--) {
        var fo = follows[f];
        var live = fo.ref.rt.setTransform(fo.ref.handle, { position: footOf(fo.key) });
        if (!live || fo.until <= clock) {
          if (live && fo.until <= clock) stopRef(fo.ref);
          follows.splice(f, 1);
        }
      }

      /* 狀態光環跟著實體走 */
      Object.keys(auras).forEach(function (k) {
        var a = auras[k];
        if (a.expireAt <= clock) { stopRef(a.ref); delete auras[k]; return; }
        if (!a.ref.rt.setTransform(a.ref.handle, { position: footOf(a.key) })) delete auras[k];
      });

      updateOrbits(step);

      /* 場域到期 */
      Object.keys(grounds).forEach(function (k) {
        if (grounds[k].expireAt > clock) return;
        stopRef(grounds[k].ref);
        delete grounds[k];
      });

      rtFx.update(step);
      rtZone.update(step);
    }

    function clear() {
      projectiles.length = 0;
      follows.length = 0;
      pending.length = 0;
      Object.keys(orbits).forEach(stopOrbit);
      grounds = Object.create(null);
      auras = Object.create(null);
      rtFx.stopAll();
      rtZone.stopAll();
    }

    function destroy() {
      clear();
      rtFx.destroy();
      rtZone.destroy();
    }

    return {
      registerPresets: registerPresets,
      has: has,
      tryPlay: tryPlay,
      syncStatuses: syncStatuses,
      update: update,
      clear: clear,
      destroy: destroy,
      stats: function () {
        return {
          presets: Object.keys(known).length,
          projectiles: projectiles.length,
          grounds: Object.keys(grounds).length,
          orbits: Object.keys(orbits).length,
          auras: Object.keys(auras).length,
          pending: pending.length,
          played: counters.played, skipped: counters.skipped, missing: counters.missing,
          fx: rtFx.stats(), zone: rtZone.stats()
        };
      }
    };
  }

  /* ---------------------------------------------------------------
     瀏覽器端組裝：收集表格引用到的 preset id → fetch → 建 Pixi backend
     --------------------------------------------------------------- */

  /* 表格是唯一來源，因此要載哪些 preset 由表格決定，不另外維護一張清單。 */
  function collectPresetIds() {
    var ids = Object.create(null);
    function take(vfx) {
      if (!vfx || typeof vfx !== 'object') return;
      for (var k in vfx) if (vfx[k]) ids[vfx[k]] = true;
    }
    function takeDeep(v) {
      if (!v) return;
      if (typeof v === 'string') { ids[v] = true; return; }
      if (typeof v !== 'object') return;
      for (var k in v) takeDeep(v[k]);
    }
    if (typeof SKILLS !== 'undefined' && SKILLS) {
      for (var s in SKILLS) take(SKILLS[s] && SKILLS[s].vfx);
    }
    if (typeof SKILLS2 !== 'undefined' && SKILLS2) {
      for (var g in SKILLS2) {
        var grp = SKILLS2[g];
        if (!grp) continue;
        (grp.tiers || []).forEach(function (t) { take(t && t.vfx); });
        (grp.ult || []).forEach(function (u) { take(u && u.vfx); });
      }
    }
    if (typeof STATUS !== 'undefined' && STATUS) {
      for (var st in STATUS) take(STATUS[st] && STATUS[st].vfx);
    }
    if (typeof VFX_COMBAT_DEFAULTS !== 'undefined') takeDeep(VFX_COMBAT_DEFAULTS);
    return Object.keys(ids);
  }

  function loadPresets(ids, base) {
    var prefix = (base || 'vfx/presets') + '/';
    return Promise.all(ids.map(function (id) {
      return fetch(prefix + id + '.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    })).then(function (list) {
      return list.filter(function (p) { return p && p.id; });
    });
  }

  /* battle-renderer 在 init 成功之後呼叫；回傳 Promise<adapter | null>。
     任何一步失敗都回 null——顯示層會整批退回舊畫法，不會半殘。 */
  function boot(o) {
    var opts = o || {};
    if (typeof VFXCore === 'undefined' || typeof VFXPixiBackend === 'undefined') return Promise.resolve(null);
    return fetch(opts.shippedUrl || 'vfx/shipped-assets.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (index) {
        if (!index) return null;
        var resolver = VFXCore.createIndexResolver(index, index.baseUrl || 'images/vfx/assets');
        var adapter = create({
          resolver: resolver,
          fxBackend: VFXPixiBackend.createBackend({ container: opts.fxContainer }),
          zoneBackend: VFXPixiBackend.createBackend({ container: opts.zoneContainer }),
          ctx: opts.ctx
        });
        var ids = collectPresetIds();
        return loadPresets(ids, opts.presetBase).then(function (presets) {
          adapter.registerPresets(presets);
          return adapter;
        });
      })
      .catch(function () { return null; });
  }

  return {
    create: create,
    boot: boot,
    collectPresetIds: collectPresetIds,
    primaryRoleOf: primaryRoleOf,
    NOMINAL: {
      radius: NOMINAL_RADIUS, rectW: NOMINAL_RECT_W, rectH: NOMINAL_RECT_H,
      beam: NOMINAL_BEAM, lance: NOMINAL_LANCE, lanceWidth: NOMINAL_LANCE_W, orb: NOMINAL_ORB
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VFXRuntime;
}
