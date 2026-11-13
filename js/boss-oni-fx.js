/* 第5隻封魔塔BOSS「鬼面」的戰鬥特效（tower_boss_5）。
   模型與動作見 docs/assets/BOSS5_SOURCE.md；Preset 由 tools/vfx/authoring/author/boss-oni.cjs 製作，
   id 在 js/data.js 的 VFX_COMBAT_DEFAULTS.bossOni，並登記於 docs/vfx/VFX_PRESET_USAGE_OUTSIDE_TABLES.md。

   只做畫面：命中、傷害、時序全部由模擬層決定（AI_RULES 8.3）。這裡只在「敵人出手」事件（已經由模擬層算完）之後，
   依 BOSS 這一次實際播放的動作（Attack1／2／3）把對應特效接到動作的關鍵格：
     Attack1 臉部衝撞  → 目標身上的撞擊爆點
     Attack2 吐骷髏    → 嘴前吐氣＋三顆綠色小骷髏（一顆射向目標，另兩顆左右各偏 30°，各飛 60 米）
     Attack3 噴火      → 嘴前沿目標方向的火焰（長度＝到目標的距離，最長 15 米）
   常駐：兩眼紅光、腦後紅霧拖尾（Preset 粒子是世界座標，BOSS 移動時自然拖尾）；死亡第 2 秒碎裂時的爆散。
   座標一律是畫面座標（與 VFX Runtime 的 ctx.posOf／footOf 相同）；1 米＝10 座標單位（BF_SYSTEM_UNITS_PER_METER）。 */
(function (global) {
  'use strict';
  /* 鬼面的三個貼圖版本：5／15／25 層（及每 50 層重複）
     tower_boss_5 朱紅、tower_boss_15 藍、tower_boss_25 紫 */
  var NPC_IDS = { tower_boss_5: 1, tower_boss_15: 1, tower_boss_25: 1 };
  var PX_PER_MODEL_M = 58;          // Preset 的製作基準：縮放 1.8 的 BOSS，每個模型公尺約 58 畫面像素
  var UNITS_PER_M = 10;
  var ACT_WAIT_MS = 1800;           // 敵人出手事件（立即）與動作播放（延後約 240ms＋站定）之間最多等多久
  var SHATTER_SEC = 2.0;            // Die 動作第 2 秒碎裂
  var SKULL_SPEED = 340;            // 畫面像素／秒
  var SKULL_RANGE_M = 60;           // 兩顆偏角小骷髏的飛行距離
  var SKULL_SPREAD = Math.PI / 6;   // 左右各 30°
  var FLAME_MAX_M = 15, FLAME_MIN_PX = 60;
  /* 動作剪輯內的關鍵時間（秒，原速），來自 build_rig.py 的 clip 定義 */
  var KEY = {
    attack1: { hit: 0.633 },
    attack2: { release: 0.4667 },
    attack3: { start: 0.7333, end: 1.6 }
  };

  function isOni(ent) { return !!(ent && ent.npc3d && ent.data && NPC_IDS[ent.data.npcId] === 1 && ent.body && ent.body.npc3d); }
  function alive(ent) { return !!(ent && ent.state !== 'dying' && ent.state !== 'gone' && ent.root && !ent.root.destroyed); }

  function create(o) {
    var vfx = o.vfx, baseIds = o.presets || {};
    /* 三個貼圖版本各有一套吐骷髏／噴火的顏色（baseIds.variants[npcId] 覆蓋 spit／skull／skullHit／flame）；眼睛、紅霧、撞擊、碎裂共用 */
    function idsOf(ent) {
      var v = baseIds.variants && ent && ent.data && baseIds.variants[ent.data.npcId];
      return v ? Object.assign({}, baseIds, v) : baseIds;
    }
    var ids = baseIds;
    var ents = typeof o.entities === 'function' ? o.entities : function () { return o.entities; }, screenPosOf = o.screenPosOf, hitReact = o.hitReact || function () {}, footOf = o.footOf || screenPosOf;
    var loops = Object.create(null), timers = [], skulls = [], flames = [], pending = null, clock = 0;

    function ctrlOf(ent) { return ent.body.npc3d.controller; }
    /* 畫布像素 → 畫面像素的倍率，以及相對 Preset 製作基準的大小倍率 */
    function bodyScale(ent) { return Math.abs(ent.body.scale && ent.body.scale.x) || 0; }
    function relScale(ent) { return bodyScale(ent) * ctrlOf(ent).pxPerMeter / PX_PER_MODEL_M; }
    /* 模型上具名節點（骨骼／掛點）目前的畫面座標 */
    function anchor(ent, name) {
      var c = ctrlOf(ent);
      var a = typeof c.anchorPoint === 'function' ? c.anchorPoint(name) : null;
      if (!a) return null;
      var k = bodyScale(ent);
      return { x: ent.root.x + a.x * k, y: ent.root.y + a.y * k };
    }
    /* params.depthY＝畫面座標的腳底 Y 加偏移（大於腳底＝蓋在角色前，小於＝在角色後），見 VFXRuntime.playFree */
    function play(id, params) { return id && vfx && vfx.playFree ? vfx.playFree(id, params) : null; }
    var FRONT = 2, BEHIND = -2;   // 相對腳底 Y 的深度偏移（畫面像素）
    function depthOf(ent) { return ent && ent.root && !ent.root.destroyed ? ent.root.y : 0; }
    function footY(id) { var p = footOf(id); return p ? p.y : 0; }
    function later(ms, fn) { timers.push({ at: clock + Math.max(0, ms), fn: fn }); }

    /* ---------- 常駐：眼睛紅光＋紅霧 ---------- */
    function stopLoops(entId) {
      var l = loops[entId];
      if (!l) return;
      ['eyeL', 'eyeR', 'mist'].forEach(function (k) { if (l[k]) l[k].finish(); });
      delete loops[entId];
    }
    function syncLoops() {
      Object.keys(loops).forEach(function (id) { if (!isOni(ents()[id]) || !alive(ents()[id])) stopLoops(id); });
      Object.keys(ents()).forEach(function (id) {
        var ent = ents()[id];
        if (!isOni(ent) || !alive(ent)) return;
        var rel = relScale(ent);
        if (!(rel > 0)) return;
        var eyeL = anchor(ent, 'Eye_L'), eyeR = anchor(ent, 'Eye_R'), back = anchor(ent, 'Fx_Back');
        if (!eyeL || !eyeR || !back) return;
        var l = loops[id] || (loops[id] = { eyeL: null, eyeR: null, mist: null });
        var fy = depthOf(ent);
        function place(key, id2, pos, depth) {
          var q = { position: pos, scale: rel, depthY: depth };
          if (!l[key]) l[key] = play(id2, q);
          else if (!l[key].move(q)) l[key] = null;
        }
        place('eyeL', ids.eye, eyeL, fy + FRONT);
        place('eyeR', ids.eye, eyeR, fy + FRONT);
        place('mist', ids.mist, back, fy + BEHIND);
      });
    }

    /* ---------- 敵人出手：先記下來，等動作播放時再接到關鍵格 ---------- */
    function attack(spec) {
      var src = spec && spec.sourceId ? ents()[spec.sourceId] : null;
      if (!isOni(src)) return false;
      pending = { sourceId: spec.sourceId, targetId: spec.targets && spec.targets[0] || 'pv-float', hit: spec.hit !== false, at: clock };
      return true;
    }
    function targetPos(id, fallback) {
      var p = screenPosOf(id);
      return p || fallback;
    }
    function impactAt(targetId, hit) {
      var p = targetPos(targetId, null);
      if (p) play(ids.ramHit, { position: p, scale: 1, depthY: footY(targetId) + FRONT });
      if (hit) hitReact(targetId);
    }
    function startSkulls(ent, targetId, hit) {
      var m = anchor(ent, 'Fx_Mouth');
      var tp = targetPos(targetId, null);
      if (!m || !tp) return;
      var rel = relScale(ent);
      var fy = depthOf(ent) + FRONT;
      var ids = idsOf(ent);
      play(ids.spit, { position: m, rotation: Math.atan2(tp.y - m.y, tp.x - m.x), scale: rel, depthY: fy });
      var base = Math.atan2(tp.y - m.y, tp.x - m.x), dist = Math.hypot(tp.x - m.x, tp.y - m.y);
      [0, SKULL_SPREAD, -SKULL_SPREAD].forEach(function (off, i) {
        var ang = base + off;
        var range = i === 0 ? dist : SKULL_RANGE_M * UNITS_PER_M;
        var ref = play(ids.skull, { position: { x: m.x, y: m.y }, rotation: ang, scale: rel, depthY: fy });
        if (ref) skulls.push({ ref: ref, hitId: ids.skullHit, depthY: fy, x: m.x, y: m.y, ang: ang, left: range, center: i === 0, targetId: targetId, hit: hit, rel: rel });
      });
    }
    function startFlame(ent, targetId, hit, durSec) {
      var m = anchor(ent, 'Fx_Mouth');
      var tp = targetPos(targetId, null);
      if (!m || !tp) return;
      var f = { depthY: depthOf(ent) + FRONT, entId: ent.id, targetId: targetId, until: clock + durSec * 1000, ref: null, reacted: false, hit: hit, rel: relScale(ent) };
      f.ref = play(idsOf(ent).flame, flameParams(f, m, tp));
      if (f.ref) flames.push(f);
      if (hit) later(150, function () { hitReact(targetId); });
    }
    function flameParams(f, m, tp) {
      var dx = tp.x - m.x, dy = tp.y - m.y, dist = Math.hypot(dx, dy);
      var len = Math.min(FLAME_MAX_M * UNITS_PER_M, Math.max(FLAME_MIN_PX, dist + 12));
      return { position: m, rotation: Math.atan2(dy, dx), scaleX: len / 200, scaleY: f.rel, depthY: f.depthY };
    }
    /* 這一次實際播放的是哪個攻擊動作（js/npc3d.js 記在 state.attackKey）＋它被壓縮成幾秒 */
    /* 動作要在播放前決定：普攻（模擬層有送出手事件的那一次）在撞擊／吐骷髏／噴火三招之間隨機挑，
       但不連續兩下同一招——與玩家主角普攻同一個規則（js/battle-renderer.js playerAttackAnim）；
       技能施放（沒有出手事件、沒有對應特效）一律用撞擊動作，不影響普攻的隨機。
       Npc3D.play 照 state.forceKey 播（用完即清），見 js/npc3d.js。 */
    var lastBasic = {}, lastKeys = [];
    var random = typeof o.random === 'function' ? o.random : Math.random;
    var KEYS = ['attack1', 'attack2', 'attack3'];
    function beforeAct(ent) {
      if (!isOni(ent)) return;
      var key = 'attack1';
      if (pending && pending.sourceId === ent.id) {
        var pool = KEYS.filter(function (k) { return k !== lastBasic[ent.id]; });
        key = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
        lastBasic[ent.id] = key;
      }
      ent.body.npc3d.forceKey = key;
      lastKeys.push(key); if (lastKeys.length > 12) lastKeys.shift();
    }
    function onActPlayed(ent, seconds) {
      if (!isOni(ent) || !pending || pending.sourceId !== ent.id) return;
      var st = ent.body.npc3d, key = st.attackKey, cfg = key && st.clips[key];
      if (!cfg) return;
      var clipSec = ctrlOf(ent).duration(cfg.clip) || 1;
      var f = (Number(seconds) > 0 ? Number(seconds) : clipSec) / clipSec;
      var p = pending; pending = null;
      var k = KEY[key] || KEY.attack1;
      if (key === 'attack2') later(k.release * f * 1000, function () { if (alive(ent)) startSkulls(ent, p.targetId, p.hit); });
      else if (key === 'attack3') later(k.start * f * 1000, function () { if (alive(ent)) startFlame(ent, p.targetId, p.hit, (k.end - k.start) * f); });
      else later((k.hit || 0.633) * f * 1000, function () { impactAt(p.targetId, p.hit); });
    }

    /* ---------- 死亡：第 2 秒碎裂 ---------- */
    function onDeath(ent) {
      if (!isOni(ent)) return;
      stopLoops(ent.id);
      var deathY = depthOf(ent) + FRONT;
      later(SHATTER_SEC * 1000, function () {
        var p = ent.root && !ent.root.destroyed ? (anchor(ent, 'Body') || { x: ent.root.x, y: ent.root.y - 60 }) : null;
        if (p) play(ids.shatter, { position: p, scale: Math.max(0.5, relScale(ent)), depthY: deathY });
      });
    }

    /* ---------- 每幀 ---------- */
    function update(dt) {
      clock += Math.max(0, dt) * 1000;
      for (var i = timers.length - 1; i >= 0; i--) {
        if (timers[i].at <= clock) { var t = timers.splice(i, 1)[0]; try { t.fn(); } catch (e) { /* 特效失敗不影響戰鬥 */ } }
      }
      if (pending && clock - pending.at > ACT_WAIT_MS) { var p = pending; pending = null; impactAt(p.targetId, p.hit); }
      syncLoops();
      for (var s = skulls.length - 1; s >= 0; s--) {
        var k = skulls[s], step = SKULL_SPEED * dt;
        if (k.center) {
          var tp = targetPos(k.targetId, null);
          if (tp) { k.ang = Math.atan2(tp.y - k.y, tp.x - k.x); k.left = Math.hypot(tp.x - k.x, tp.y - k.y); }
        }
        if (step >= k.left) {
          if (k.center) {
            var end = targetPos(k.targetId, { x: k.x, y: k.y });
            play(k.hitId, { position: end, scale: 1, depthY: footY(k.targetId) + FRONT });
            if (k.hit) hitReact(k.targetId);
          }
          k.ref.finish(); skulls.splice(s, 1); continue;
        }
        k.x += Math.cos(k.ang) * step; k.y += Math.sin(k.ang) * step; k.left -= step;
        if (!k.ref.move({ position: { x: k.x, y: k.y }, rotation: k.ang, scale: k.rel, depthY: k.depthY })) skulls.splice(s, 1);
      }
      for (var f = flames.length - 1; f >= 0; f--) {
        var fl = flames[f], ent = ents()[fl.entId];
        var m = ent && isOni(ent) && alive(ent) ? anchor(ent, 'Fx_Mouth') : null, tgt = targetPos(fl.targetId, null);
        if (clock >= fl.until || !m || !tgt) { fl.ref.finish(); flames.splice(f, 1); continue; }
        if (!fl.ref.move(flameParams(fl, m, tgt))) flames.splice(f, 1);
      }
    }
    function clear() {
      Object.keys(loops).forEach(stopLoops);
      skulls.forEach(function (k) { k.ref.stop(); }); skulls = [];
      flames.forEach(function (f) { f.ref.stop(); }); flames = [];
      timers = []; pending = null;
    }
    function anchors() {
      var out = [];
      Object.keys(ents()).forEach(function (id) {
        var e = ents()[id];
        if (!isOni(e)) return;
        out.push({ id: id, root: { x: Math.round(e.root.x), y: Math.round(e.root.y) }, scale: +bodyScale(e).toFixed(3), rel: +relScale(e).toFixed(3),
          bounds: (function () { var b = e.root.getBounds(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })(),
          eyeL: anchor(e, 'Eye_L'), eyeR: anchor(e, 'Eye_R'), mouth: anchor(e, 'Fx_Mouth'), back: anchor(e, 'Fx_Back'), body: anchor(e, 'Body') });
      });
      return out;
    }
    return { attack: attack, anchors: anchors, beforeAct: beforeAct, onActPlayed: onActPlayed, onDeath: onDeath, update: update, clear: clear, isOni: isOni,
      _state: function () { return { loops: Object.keys(loops).length, skulls: skulls.length, flames: flames.length, timers: timers.map(function (t) { return Math.round(t.at - clock); }), pending: !!pending, clock: Math.round(clock), keys: lastKeys.join(',') }; } };
  }
  global.BossOniFx = { create: create, NPC_IDS: NPC_IDS, KEY: KEY, isOni: isOni };
})(typeof window !== 'undefined' ? window : globalThis);
