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

  /* 米制本體尺寸。authored 是素材座標中的本體，不包含外暈／拖尾。
     保留作者的座標精度，以轉換矩陣統一尺寸；Editor 往返不必重採樣素材。 */
  var SIZE_DEFAULTS = { circle: { radiusM: 6 }, square: { widthM: 6, heightM: 6 },
    rectangle: { widthM: 6, heightM: 3 }, 'projectile-circle': { radiusM: 6 },
    'projectile-square': { widthM: 6, heightM: 6 } };
  function resolveSizing(sizing, actual, unitsPerMeter) {
    if (!sizing) return null; // 舊版／外部 Preset 保留既有名目尺寸
    var defaults = SIZE_DEFAULTS[sizing.shape];
    if (!defaults && sizing.shape !== 'custom') throw new Error('未知 VFX sizing.shape');
    var a = sizing.authored || {}, target = actual || {};
    var unit = Number(unitsPerMeter) || 10;
    function positive(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
    var radius = sizing.radiusM === undefined ? defaults && defaults.radiusM : sizing.radiusM;
    var width = sizing.widthM === undefined ? defaults && defaults.widthM : sizing.widthM;
    var height = sizing.heightM === undefined ? defaults && defaults.heightM : sizing.heightM;
    if (positive(radius)) { width = radius * 2; height = radius * 2; }
    if (!positive(width) || !positive(height)) throw new Error('VFX sizing 必須定義正的本體尺寸');
    var aw = positive(a.width) ? a.width : a.radius * 2;
    var ah = positive(a.height) ? a.height : a.radius * 2;
    if (!positive(aw) || !positive(ah)) throw new Error('VFX sizing.authored 必須定義正的本體尺寸');
    var w = width * unit, h = height * unit;
    if (positive(target.w) && positive(target.h)) { w = target.w; h = target.h; }
    else if (positive(target.r)) {
      var ar = positive(a.radius) ? a.radius : aw / 2;
      return { scaleX: target.r / ar, scaleY: target.r / ar };
    }
    return { scaleX: w / aw, scaleY: h / ah };
  }

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

  /* ---- 移動場域的畫面位置／尺寸：推算自走 ＋ 連續修正（AI_RULES 8.3.1）----
     一則場域事件＝模擬層的一個節拍快照，但事件的到達節奏本身不平均：Worker 是
     批次送出的，場域另有自己的節拍，兩者不整除。收到就 setTransform 到權威座標
     ＝每則事件瞬移一次，那正是玩家看到的「一格一格移動」。

     只做「朝最新快照逼近」也不夠：節拍慢的場域（雷球、火龍捲）兩則事件之間隔得
     比逼近所需的時間還久，逼到了就沒有東西可以追，畫面會停在那裡等下一則——
     追上、停住、再衝一段，玩家看到的仍然是一格一格。

     因此分成兩段：
       ① 推算自走：沿模擬層當下的航向、用模擬層的速度前進（事件帶著 speed／moveA／
          dest，見 skills2.sgGroundArea）。這一段與模擬層是同一條運動法則，所以
          兩則事件之間畫面照樣在動，而且動得跟判定範圍一樣快。
       ② 連續修正：自走與最新快照之間的殘差以一階低通衰減掉，不是瞬間歸位。
          掉幀、分頁凍結、落點中途改變都靠這一段吸收。
     殘差大到不像是推算誤差時直接就位——硬拖一段長距離比直接就位更難看。
     時間常數與舊畫法（battle-renderer 的 FIELD_VFX_FOLLOW_TAU_SEC）取同一個值：
     兩邊畫的是同一件事，數字分家就會出現「切 ?vfx=legacy 前後手感不一樣」。
     判定位置永遠是模擬層的 area.x/y，這裡只補畫面，不改命中。 */
  var GROUND_FOLLOW_TAU_SEC = 0.14;
  /* 殘差上限：超過一個名目場域半徑就不吸收，直接就位。 */
  var GROUND_MAX_RESIDUAL_PX = NOMINAL_RADIUS;
  /* 修正速度的上限＝行進速度的一部分。事件描述的模擬時刻與它到達的時刻對不齊，
     每則事件因此都會留下一點殘差；修正得比行進本身還快，畫面就會忽快忽慢——
     一樣是不平滑。壓在行進速度之下，殘差會收斂成一個固定的落後量（看不出來），
     修正過程則完全藏在行進裡。 */
  var GROUND_CORRECT_MAX_RATIO = 0.3;

  /* 逐幀朝目標值收斂的一階低通：係數只跟 dt 有關，因此掉幀時不會走過頭。 */
  function approach(cur, target, dt, tau) {
    if (!(dt > 0)) return cur;
    return cur + (target - cur) * (1 - Math.exp(-dt / tau));
  }
  /* 角度走最短路徑，否則 ±π 交界會整圈轉回去。 */
  function approachAngle(cur, target, dt, tau) {
    if (!(dt > 0)) return cur;
    var d = Math.atan2(Math.sin(target - cur), Math.cos(target - cur));
    return cur + d * (1 - Math.exp(-dt / tau));
  }

  /* ---- 轉彎不折角：以「進場航向」為起始切線的二次貝茲（AI_RULES 8.3.1）----
     連鎖彈射（飛刀彈射、水球彈跳、毒霧／寒霜傳染）是「飛到 A 再飛到 B」：
     每一段各自畫直線的話，轉折處的方向會在一幀之內整個換掉——那就是硬折角。
     改成二次貝茲：起點切線＝上一段的航向、終點仍是模擬層的目標點、飛行時間
     仍是事件帶來的 travelMs，因此路徑彎了但抵達時刻一點都沒變，傷害數字與
     畫面到達仍然同一刻（AI_RULES 8.3）。
     進場角度必須夾住：正對後方時三個控制點共線，貝茲會退化成「沿原路倒退再
     前進」，比硬折角更糟；夾到上限之後仍然是一道連續的弧。 */
  var CURVE_ENTRY_MAX_RAD = Math.PI * 2 / 3;   // 進場航向與弦的最大夾角
  var CURVE_HANDLE_RATIO = 0.55;               // 控制點離起點多遠（弦長的比例）
  function curveControl(from, to, enterAngle) {
    if (!isFinite(enterAngle)) return null;
    var dx = to.x - from.x, dy = to.y - from.y;
    var chord = Math.sqrt(dx * dx + dy * dy);
    if (!(chord > 1e-6)) return null;
    var chordAng = Math.atan2(dy, dx);
    var diff = Math.atan2(Math.sin(enterAngle - chordAng), Math.cos(enterAngle - chordAng));
    if (Math.abs(diff) < 1e-3) return null;    // 本來就對著目標＝直線，不必彎
    var a = chordAng + Math.max(-CURVE_ENTRY_MAX_RAD, Math.min(CURVE_ENTRY_MAX_RAD, diff));
    return {
      x: from.x + Math.cos(a) * chord * CURVE_HANDLE_RATIO,
      y: from.y + Math.sin(a) * chord * CURVE_HANDLE_RATIO
    };
  }
  /* 二次貝茲取點與切線；ctrl 為 null 時退化成直線（與加入轉彎之前完全相同）。 */
  function curvePoint(from, ctrl, to, k) {
    if (!ctrl) return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
    var u = 1 - k;
    return {
      x: u * u * from.x + 2 * u * k * ctrl.x + k * k * to.x,
      y: u * u * from.y + 2 * u * k * ctrl.y + k * k * to.y
    };
  }
  function curveHeading(from, ctrl, to, k) {
    if (!ctrl) return Math.atan2(to.y - from.y, to.x - from.x);
    var u = 1 - k;
    return Math.atan2(2 * u * (ctrl.y - from.y) + 2 * k * (to.y - ctrl.y),
      2 * u * (ctrl.x - from.x) + 2 * k * (to.x - ctrl.x));
  }
  /* 機身朝向追上實際航向的時間常數：轉彎時刀鋒要跟著彎，但不能一幀轉到底。 */
  var PROJECTILE_FACING_TAU_SEC = 0.05;
  /* 上一段飛行抵達時的航向保留多久（連鎖的下一段要接得上）。 */
  var ARRIVAL_KEEP_SEC = 1.2;

  /* 表面尺寸規則：Preset 是照野外戰場的名目尺寸畫的（身高 60px、半徑 100px、天降 500px），
     換到別的版面（高塔的 202px 卡片）就得整組縮放。三個係數分開的理由是它們對應
     三種不同的名目基準，用同一個數字縮會顧此失彼。
     野外一律用這份預設（全部 1），畫出來就是 Preset 原本被畫成的尺寸。 */
  var DEFAULT_PROFILE = {
    scale: 1,        // 角色身上（受擊／施放／狀態光環／目標身上的攻擊本體）
    areaScale: 1,    // 帶 area 的（範圍爆發、場域、環繞場域）
    skyScale: 1,     // 天降（fxKind rain）
    /* 沒有 area 時場域改用的名目半徑。野外取名目值＝照 Preset 原尺寸畫：
       自身增益光殼（暴風屏障、岩甲、狂血、暴風之舞、雷幻身）本來就沒有判定半徑
       可言，模擬層也不會給 area，這一類只能照作者畫的大小貼在腳底。
       0＝不畫（維持退回舊畫法），只留給還沒決定尺寸規則的新版面。 */
    groundR: 100
  };

  /* 特效預算＝效能節流。使用者決策 2026-09-06：**先整個拿掉**，
     不管畫面上同時有幾個特效，之後再依實機體感決定該調到多少。

     為什麼是決策而不是預設值：節流一旦作用，超出的那幾則會被丟掉，
     而在 2026-09-06 之前它們是退回舊畫法——同一次風刃齊射裡因此混著
     新舊兩種畫風（實機回報）。退回舊畫法已經修掉了（見 play 的說明），
     但「峰值時少掉幾道特效」仍然是看得出來的，所以先讓它完全不綁。

     要重新開啟節流：把下面三個數字改小即可（單一控制點，兩個表面各一份）。
     取值是 Core 的硬上限——Core 仍然保留有限上限，只是高到不會綁住任何合理用途。
     ⚠️ perEffectParticleLimit 不能再往上調，Core 的發射迴圈靠它保證終止。 */
  var FX_BUDGET = { maxActiveEffects: 65536, maxParticles: 64000, perEffectParticleLimit: 2000 };
  var ZONE_BUDGET = { maxActiveEffects: 65536, maxParticles: 64000, perEffectParticleLimit: 2000 };

  /* ---------------------------------------------------------------
     角色選擇：這一則事件的「主要角色」是誰
     --------------------------------------------------------------- */
  function primaryRoleOf(spec, roles) {
    var kind = spec.fxKind;
    var variant = spec.variant || '';
    if (spec.cat === 'basic') return 'hit'; // 普攻只播受擊，角色動作由畫面層保留。
    /* 變體特例（見設計文件 §1.1 的最後一段）——先判，因為它們跨 fxKind。 */
    if (variant === 'counter-riposte' && roles.projectile) return 'projectile';
    if (variant === 'starfall-impact') return 'hit';            // 只做受擊回饋
    if (kind === 'impact' && variant === 'pillar') return roles.field ? 'field' : 'ground';
    if ((kind === 'impact' || kind === 'burst') && variant === 'wind-burst') return 'attack';
    if (kind === 'impact' && variant === 'smite') return 'attack';

    switch (kind) {
      case 'projectile': return 'projectile';
      case 'slash': case 'strike': case 'burst': case 'beam': case 'curse': return 'attack';
      case 'rain': return roles.projectile ? 'projectile' : 'attack';
      case 'chain': return roles.projectile ? 'projectile' : 'attack';
      case 'aura': return roles.field ? 'field' : 'ground';
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
  // Preset 與 legacy 共用權威逐團幾何；age 是整次施放的經過秒數。
  function sampleOrbitMember(area, age, index) {
    var members = area && area.members;
    var member = Array.isArray(members) && members[index];
    if (!member) return null;
    var spin = num(area.spinRate, 0), dir = spin < 0 ? -1 : 1;
    function growth(to, sec) { return 1 + Math.max(0, num(to, 1) - 1) * Math.min(1, age / Math.max(0.1, num(sec, 1))); }
    var bodyR = num(area.orbR, 0) * growth(area.orbGrowTo, area.orbGrowSec);
    var ringR = num(area.r, 0) * growth(area.rGrowTo, area.rGrowSec);
    var cap = num(area.growMax, 0) > 0 ? area.growMax : Infinity;
    function radius(m) { return Math.min(cap, (area.spiral ? num(m.radiusBase, ringR) : ringR) + Math.max(0, num(area.grow, 0)) * age); }
    var r = radius(member), angle = num(member.phase, 0) + spin * age;
    if (member.companion && member.parentId != null) {
      var parent = members.find(function (m) { return m.id === member.parentId && !m.companion; });
      if (parent) {
        r = radius(parent);
        angle = num(parent.phase, 0) + spin * age - dir * (bodyR * 2 + Math.max(0, num(area.companionGap, 0))) / Math.max(1, r);
      }
    }
    return { angle: angle, radius: r, bodyR: bodyR, companion: !!member.companion };
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
    var profile = {
      scale: num(o.profile && o.profile.scale, DEFAULT_PROFILE.scale),
      areaScale: num(o.profile && o.profile.areaScale, DEFAULT_PROFILE.areaScale),
      skyScale: num(o.profile && o.profile.skyScale, DEFAULT_PROFILE.skyScale),
      groundR: num(o.profile && o.profile.groundR, DEFAULT_PROFILE.groundR)
    };
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
    var presetSizes = Object.create(null);
    var presetDurations = Object.create(null);
    var trackedBeamWidths = Object.create(null);
    var projectiles = [];                   // 逐幀前進的飛行物
    var follows = [];                       // 跟著玩家／實體走的效果（cast）
    var trackingBeams = [];                  // 彈射電弧逐幀追蹤兩端的顯示位置
    var grounds = Object.create(null);      // area.id → 場域
    var arrivals = Object.create(null);     // targetId → 上一段飛行抵達時的航向
    var orbits = Object.create(null);       // 合併鍵 → 環繞場域（軌道環＋N 個環繞體）
    var auras = Object.create(null);        // entKey + '|' + sid → 狀態光環
    var pending = [];                       // 延後播放（受擊要等飛行物抵達）
    var clock = 0;                          // 累計秒數（隨 update(dt) 前進，暫停時不走）
    var moonSwingIndex = 0;                 // 圓形判定內的刀光朝向差，避免連斬輪廓完全重合
    var counters = { played: 0, skipped: 0, missing: 0, dropped: 0 };

    function registerPresets(list) {
      (list || []).forEach(function (p) {
        if (!p || !p.id || known[p.id]) return;
        if (p.sizing) resolveSizing(p.sizing); // 載入即驗證，錯誤不可靜默變成 NaN
        rtFx.registerPreset(p);
        rtZone.registerPreset(p);
        known[p.id] = true;
        presetSizes[p.id] = p.sizing || null;
        presetDurations[p.id] = p.duration;
        if (p.id === 'bolt-chain-travel-bluewhite') {
          var front = p.layers.find(function(l) { return l.id === 'travelling-electric-front'; });
          trackedBeamWidths[p.id] = front ? 256 * num(front.scale && front.scale.x, 1) : NOMINAL_BEAM;
        }
        if ((p.id === 'aura-rockarmor-stone' || p.id === 'aura-earth-reversal') && p.layers.some(function(l) { return l.id === 'orbiting-stone-plates-front'; })) {
          ['back', 'front'].forEach(function(half) {
            var part = JSON.parse(JSON.stringify(p)); part.id += '-' + half;
            part.layers = part.layers.filter(function(l) { return (l.id === 'orbiting-stone-plates-front') === (half === 'front'); });
            registerPresets([part]);
          });
        }
        // 火牆在編輯器是三柱合成；遊戲中各柱保持直立，只沿判定軸排列底部。
        if (p.id === 'ground-firewall' && p.layers.some(function (l) { return l.id.indexOf('column-0-') === 0; })) {
          for (var column = 0; column < 3; column++) {
            var prefix = 'column-' + column + '-';
            var part = JSON.parse(JSON.stringify(p));
            part.id = p.id + '-column-' + column;
            part.layers = part.layers.filter(function (l) { return l.id.indexOf(prefix) === 0; });
            var columnWidth = p.sizing.authored.width / 3;
            part.layers.forEach(function (l) { l.position.x -= (column - 1) * columnWidth * .8; });
            part.sizing = { shape: 'custom', widthM: 6, heightM: 12, authored: { width: columnWidth, height: p.sizing.authored.height, radius: columnWidth / 2 } };
            registerPresets([part]);
          }
        }
      });
    }

    function has(id) { return !!(id && known[id]); }
    function sizeOf(id, actual) {
      var unit = typeof bfMeterPx === 'function' ? bfMeterPx(1) : 10;
      return resolveSizing(presetSizes[id], actual, unit);
    }
    function defaultSize(id, scale) {
      var p = sizeOf(id) || { scaleX: 1, scaleY: 1 };
      p.scaleX *= num(scale, 1); p.scaleY *= num(scale, 1);
      return p;
    }

    /* 把表面的尺寸係數乘進 transform 參數。沒給任何縮放時視為 1，
       這樣「角色身上」那類不帶 scale 的呼叫在高塔也會整組縮。 */
    function sized(params, k) {
      var mult = num(k, profile.scale);
      if (mult === 1) return params;
      var out = {};
      for (var key in params) out[key] = params[key];
      var hasAxis = out.scaleX !== undefined || out.scaleY !== undefined;
      if (out.scale !== undefined) out.scale *= mult;
      if (out.scaleX !== undefined) out.scaleX *= mult;
      if (out.scaleY !== undefined) out.scaleY *= mult;
      if (out.scale === undefined && !hasAxis) out.scale = mult;
      return out;
    }

    /* ---- 播放：把 Core 的 handle 連同它屬於哪個 runtime 一起記住 ----
       Core 超出 budget 時 play() 回 null（寧可少一個特效也不掉幀）。
       ⚠️ 這一種 null 與「沒有這份 preset」是兩回事，必須分得出來：
       沒有 preset ＝ 本來就該退回舊畫法；超出 budget ＝ 這一幀畫不下，
       退回舊畫法只會讓同一次齊射裡有幾道是 Preset、有幾道是舊鐮刀
       （2026-09-06 實機回報）。少一道遠比多一種畫風不顯眼，所以超預算時整則丟掉。
       budgetDrops 就是給 tryPlay 分辨這兩者用的。 */
    var budgetDrops = 0;
    function play(rt, presetId, params, mult) {
      if ((presetId === 'aura-rockarmor-stone' || presetId === 'aura-earth-reversal') && has(presetId + '-front')) {
        var back = play(rtZone, presetId + '-back', params, mult);
        var front = play(rtFx, presetId + '-front', params, mult);
        if (!back || !front) { stopRef(back); stopRef(front); return null; }
        return { parts: [back, front] };
      }
      if (!has(presetId)) { counters.missing++; return null; }
      var handle = rt.play(presetId, sized(params || {}, mult));
      if (handle === null || handle === undefined) { budgetDrops++; return null; }
      counters.played++;
      return { rt: rt, handle: handle };
    }
    function stopRef(ref) {
      if (!ref) return;
      if (ref.parts) { ref.parts.forEach(stopRef); return; }
      ref.rt.stop(ref.handle);
    }
    /* setTransform 也要走同一條縮放，否則逐幀更新會把 play 時乘上的係數洗掉。 */
    function moveRef(ref, params, mult) {
      if (ref.parts) { var alive = ref.parts.map(function(part) { return moveRef(part, params, mult); }); return alive.every(Boolean); }
      return ref.rt.setTransform(ref.handle, sized(params, mult));
    }

    /* ---- 幾何 ---- */
    function areaCentre(area) {
      return { x: num(area.x, 0), y: num(area.y, 0) };
    }
    /* 場域／範圍的縮放：圓形吃半徑，矩形吃長寬，兩者的名目尺寸不同。 */
    function areaScaleParams(area, presetId) {
      var resolved = sizeOf(presetId, area);
      if (resolved) { resolved.rotation = num(area.a, 0); return resolved; }
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
        var params = defaultSize(presetId, scale);
        params.position = p;
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

    function playThunderstrike(rt, presetId, spec) {
      var ids = Array.isArray(spec.targets) ? spec.targets : [];
      ids.forEach(function (id) {
        if (ctx.chainPoint && !ctx.chainPoint(id)) return;
        var ref = play(rt, presetId, Object.assign(defaultSize(presetId), { position: footOf(id) }));
        if (ref) follows.push({ ref: ref, key: id, until: clock + presetDurations[presetId], requireVisible: true });
      });
      return true;
    }

    /* 範圍中心（爆發、場域一次性） */
    function playOnArea(rt, presetId, spec) {
      if (!spec.area) return false;
      var params = areaScaleParams(spec.area, presetId);
      params.position = areaCentre(spec.area);
      return !!play(rt, presetId, params, profile.areaScale);
    }

    /* 帶 angle 的方向型攻擊（突刺光槍、齊射的風刃）：從施法者身上沿該方位拉出去。
       方位是模擬層算好的（路徑上可能一個敵人都沒有，不能從 targets 反推），
       長寬同樣沿用事件帶來的 lineLength／lineWidth，不自己另外挑一組。 */
    function playDirectional(rt, presetId, spec) {
      var len = num(spec.lineLength, 0);
      if (!(len > 0)) return false;
      var width = num(spec.lineWidth, 0);
      var from = spec.sourceId ? ctx.posOf(spec.sourceId) : ctx.playerPos();
      var thrust = /^thrust(?:-|$)/.test(spec.variant || '');
      var lanes = thrust && Array.isArray(spec.laneOffsets) && spec.laneOffsets.length
        ? spec.laneOffsets.slice(0, 3) : [0];
      var dirs = thrust ? Math.max(1, Math.min(8, Math.floor(num(spec.directionCount, 1)))) : 1;
      var laneWidth = width / lanes.length;
      var body = thrust ? num(spec.bodyLength, laneWidth > 0 ? laneWidth * 4 : 120) : len;
      var shape = sizeOf(presetId, { w: body, h: thrust ? laneWidth * 2 : laneWidth }) || {
        scaleX: len / NOMINAL_LANCE, scaleY: width > 0 ? width / NOMINAL_LANCE_W : 1 };
      var any = false;
      for (var d = 0; d < dirs; d++) {
        var angle = num(spec.angle, 0) + d * Math.PI * 2 / dirs;
        for (var l = 0; l < lanes.length; l++) {
          var offset = num(lanes[l], 0);
          shape.position = { x: from.x - Math.sin(angle) * offset, y: from.y + Math.cos(angle) * offset };
          shape.rotation = angle;
          if (thrust) {
            var travel = Math.max(0.05, travelSecAt(spec, 0) || len / 480);
            var origin = { x: shape.position.x, y: shape.position.y };
            var dimensions = { scaleX: shape.scaleX, scaleY: shape.scaleY };
            var ref = play(rt, presetId, Object.assign({}, shape, {
              scaleX: 0, timeScale: presetDurations[presetId] / (travel + 0.08)
            }));
            if (ref) {
              projectiles.push({ref:ref,from:origin,to:{x:origin.x+Math.cos(angle)*len,y:origin.y+Math.sin(angle)*len},
                t:0,dur:travel,facing:angle,enterAngle:NaN,mult:profile.scale,dimensions:dimensions,
                thrustBody:body,thrustLength:len});
              any = true;
            }
          } else if (play(rt, presetId, shape)) any = true;
        }
      }
      return any;
    }

    // 迴旋斬：同一半月本體，近戰原地掃過；飛行版本只改位置。
    function playCleave(rt, presetId, spec) {
      var origin = ctx.playerPos();
      var target = spec.targets && spec.targets.length ? ctx.posOf(spec.targets[0]) : origin;
      var angle = typeof spec.angle === 'number' && isFinite(spec.angle) ? spec.angle : Math.atan2(target.y-origin.y,target.x-origin.x);
      var dirs = /cleave-cross/.test(spec.variant || '') ? 4 : 1;
      var dimensions = defaultSize(presetId, num(spec.rangeScale, 1));
      var any = false;
      for (var d = 0; d < dirs; d++) {
        var facing = angle + d * Math.PI / 2;
        var len = spec.directionRanges && spec.directionRanges[d] > 0 ? spec.directionRanges[d] : num(spec.lineLength, 0);
        var flight = !!spec.projectile && len > 0;
        var travel = Math.max(0.05, len / 240);
        var ref = play(rt, presetId, Object.assign({position:origin,rotation:facing,
          timeScale:flight ? presetDurations[presetId] / (travel + 0.08) : 1}, dimensions));
        if (!ref) continue;
        any = true;
        if (flight) projectiles.push({ref:ref,from:{x:origin.x,y:origin.y},
          to:{x:origin.x+Math.cos(facing)*len,y:origin.y+Math.sin(facing)*len},
          t:0,dur:travel,facing:facing,enterAngle:NaN,mult:profile.scale,dimensions:dimensions});
      }
      return any;
    }

    /* 從玩家（或起點）沿方向拉長到目標：光束與連鎖段 */
    function playBeam(rt, presetId, spec) {
      var ids = Array.isArray(spec.targets) ? spec.targets : [];
      var from = ids.length >= 2 ? ctx.posOf(ids[0])
        : (spec.sourceId ? ctx.posOf(spec.sourceId) : ctx.playerPos());
      var toId = ids.length >= 2 ? ids[1] : ids[0];
      if (!toId) return false;
      var to = ctx.posOf(toId);
      if (presetId === 'bolt-chain-travel-bluewhite' && ctx.chainPoint) {
        from = ctx.chainPoint(ids.length >= 2 ? ids[0] : (spec.sourceId || 'pv-float'));
        to = ctx.chainPoint(toId);
        // 端點已離場時消費事件，不能退回 legacy 的備用位置。
        if (!from || !to) return true;
      }
      var dx = to.x - from.x, dy = to.y - from.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (!(dist > 0)) dist = 1;
      var ref = play(rt, presetId, {
        position: from,
        rotation: Math.atan2(dy, dx),
        scaleX: dist / (trackedBeamWidths[presetId] || NOMINAL_BEAM),
        scaleY: trackedBeamWidths[presetId] ? profile.scale : 1
      }, trackedBeamWidths[presetId] ? 1 : undefined);
      if (ref && presetId === 'bolt-chain-travel-bluewhite') {
        trackingBeams.push({ ref: ref, fromId: ids.length >= 2 ? ids[0] : spec.sourceId, toId: toId, width: trackedBeamWidths[presetId] || NOMINAL_BEAM });
      }
      return !!ref;
    }

    /* 飛行物：逐幀 setTransform 從起點移到目標，朝飛行方向旋轉 */
    function playProjectile(rt, presetId, spec) {
      var ids = Array.isArray(spec.targets) ? spec.targets : [];
      /* 天降永遠不是連鎖段。少了後半這個條件，一顆同時打到兩個以上敵人的
         隕石會被當成雷鏈：起點取 ids[0] 的位置、終點取 ids[1]，於是
         「從天而降」變成「在兩個敵人之間橫著飛過去」，而且尺寸還是天降的
         放大倍率——畫面上是一團巨大的火球從旁邊滑過，看起來像特效不見了。
         地爆天星（打全場，targets 是所有敵人）必然踩到這一條。 */
      var chained = ids.length >= 2 && spec.fxKind !== 'rain';
      var toId = chained ? ids[1] : ids[0];
      /* 方向型飛行物（風刃、貫穿冰箭、火神星環）：模擬層說的是「朝這個方位飛這麼遠」，
         路徑上可能一個敵人都沒有（四方向齊射就是這樣），所以
           ① 不能從 targets 反推航向——那會讓刀鋒轉去追人，與判定的直線路徑分家
           ② 更不能因為沒有目標就整則退回舊畫法
         ②正是「同一個技能同時出現新舊兩種畫面」的成因：有敵人在路徑上的那幾把走
         Preset、沒有的那幾把走舊畫法。方位與刀身長度是模擬層的表定值（AI_RULES 8.3），
         直接照用。連鎖段與敵方出手另有各自的起點規則，不套這條。 */
      var directed = isFinite(spec.angle) && num(spec.lineLength, 0) > 0 &&
        !chained && !spec.sourceId && spec.fxKind !== 'rain';
      var fixedLanding = presetId === 'proj-waterball-flow' && spec.area && spec.area.fixedLanding === true;
      if (!toId && !directed && !fixedLanding) return false;
      var travel = travelSecAt(spec, chained ? 1 : 0);
      var from;
      /* 起點：連鎖段從前一個目標、敵方出手從攻擊者（sourceId）、天降從落點正上方，
         其餘才是從玩家。敵方投射物若用玩家當起點，會變成「從自己身上飛向自己」。 */
      if (chained) from = ctx.posOf(ids[0]);
      else if (spec.sourceId) from = ctx.posOf(spec.sourceId);
      else if (spec.fxKind === 'rain') {
        /* 天降：從落點正上方 500px 落下（名目高度，與 bolt 家族同一組座標慣例）。
           換到別的版面時高度要跟著整體縮——柱子縮小了、出生點卻還在 500px 之外，
           會變成「先看到一段空白才落下來」。 */
        var landing = spec.area ? areaCentre(spec.area) : ctx.posOf(toId);
        from = { x: landing.x, y: landing.y - 500 * profile.skyScale };
        if (presetId === 'proj-meteor-inferno' || presetId === 'proj-thunderfall-sky') {
          // 正規化後「未指定角度」是 null，Number(null) 會變成 0，不能用 num。
          var fallAngle = typeof spec.angle === 'number' && isFinite(spec.angle) ? spec.angle : Math.PI / 3;
          from = { x: landing.x - Math.cos(fallAngle) * 500 * profile.skyScale,
            y: landing.y - Math.sin(fallAngle) * 500 * profile.skyScale };
        }
      } else from = ctx.playerPos();
      var to = fixedLanding ? {x:spec.area.x,y:spec.area.y} : directed
        ? { x: from.x + Math.cos(spec.angle) * num(spec.lineLength, 0),
            y: from.y + Math.sin(spec.angle) * num(spec.lineLength, 0) }
        : ((travel > 0 && ctx.projectileTargetPoint)
          ? ctx.projectileTargetPoint(toId, travel) : ctx.posOf(toId));
      /* 連鎖段接上一段的航向：整條鏈因此是一條連續彎過去的線，
         而不是每個彈射點折一次角。第一段沒有上一段，enterAngle 留 NaN＝直線。 */
      if (fixedLanding) {from={x:spec.area.sourceX,y:spec.area.sourceY};to={x:spec.area.x,y:spec.area.y};}
      var enterAngle = chained ? arrivalAngle(ids[0]) : NaN;
      var ctrl = curveControl(from, to, enterAngle);
      var arcHeight = presetId === 'proj-waterball-flow' ? Math.max(0,num(spec.arcM,0)) * (typeof bfMeterPx === 'function' ? bfMeterPx(1) : 10) : 0;
      if (arcHeight > 0) ctrl = {x:(from.x+to.x)/2,y:(from.y+to.y)/2-2*arcHeight};
      var mult = spec.fxKind === 'rain' ? profile.skyScale : profile.scale;
      var facing = curveHeading(from, ctrl, to, 0);
      var dimensions = num(spec.bodyLength, 0) > 0 && num(spec.lineWidth, 0) > 0
        ? sizeOf(presetId, { w: spec.bodyLength, h: spec.lineWidth }) : null;
      dimensions = dimensions || defaultSize(presetId, Number(spec.sizeMult) > 0 ? Number(spec.sizeMult) : 1);
      var params = Object.assign({ position: from, rotation: facing }, dimensions);
      var ref = play(rt, presetId, params, mult);
      if (!ref) return false;
      projectiles.push({
        /* to 固定＝方向型（目標會動也不追）；targetId＝追著目標當下的座標走。 */
        ref: ref, from: from, targetId: toId, to: directed || fixedLanding ? to : null, t: 0,
        dur: travel > 0 ? travel : 0.001,
        mult: mult, enterAngle: enterAngle, facing: facing, arcHeight: arcHeight,
        dimensions: dimensions
      });
      return true;
    }

    /* 上一段飛行抵達某個目標時的航向（過期就當作沒有）。 */
    function arrivalAngle(id) {
      var a = arrivals[id];
      if (!a) return NaN;
      if (clock - a.at > ARRIVAL_KEEP_SEC) { delete arrivals[id]; return NaN; }
      return a.angle;
    }

    /* 玩家腳底並跟著玩家走：施放特效 */
    function playOnPlayer(rt, presetId, spec) {
      var ref = play(rt, presetId, Object.assign(defaultSize(presetId), { position: footOf('pv-float') }));
      if (!ref) return false;
      follows.push({ ref: ref, key: 'pv-float', until: clock + Math.max(0.2, num(spec.dur, 0.9)) });
      return true;
    }

    /* 這一則事件的權威幾何 → 場域的推算基準與目標尺寸。畫面值由 updateGrounds
       逐幀推進，事件本身不動畫面（見 GROUND_FOLLOW_TAU_SEC 的說明）。 */
    function groundAim(g, spec) {
      if (!spec.area) {
        /* 沒有座標的版面（高塔）：釘在目標腳底，逐幀跟著它走。 */
        g.anchored = true;
        g.speed = 0; g.moveA = NaN; g.hasDest = false;
        var fallbackSize = sizeOf(g.presetId, (g.presetId === 'aura-rockarmor-stone' || g.presetId === 'aura-earth-reversal' || g.presetId === 'proj-icearrow-frost') ? null : (o.profile && o.profile.groundR > 0 ? { r: profile.groundR } : null));
        g.uniform = !fallbackSize;
        g.tsx = fallbackSize ? fallbackSize.scaleX : profile.groundR / NOMINAL_RADIUS;
        g.tsy = fallbackSize ? fallbackSize.scaleY : g.tsx;
        g.trot = 0;
        return;
      }
      var area = spec.area;
      /* area.follow＝模擬層的圓心恆等於我方座標（暴風雪、常駐領域）。
         這種場域不必推算：畫面每幀直接貼玩家錨點，連一點落後都沒有。 */
      g.anchored = !!area.follow;
      /* 運動語意（模擬層 sgGroundArea 只在這一拍真的在動時才帶）：
         沒帶＝這一拍是靜止的，推算自走那一段自然就不會走。 */
      g.speed = Math.max(0, num(area.speed, 0));
      g.moveA = num(area.moveA, NaN);
      g.turnRate = num(area.turnRate, 0);
      g.hasDest = isFinite(num(area.destX, NaN)) && isFinite(num(area.destY, NaN));
      if (g.hasDest) { g.destX = num(area.destX, 0); g.destY = num(area.destY, 0); }
      var w = num(area.w, 0), h = num(area.h, 0);
      // 追蹤冰箭沿用發射本體尺寸；area.r 僅控制碰撞，不能縮小箭體。
      var resolved = sizeOf(g.presetId, g.presetId === 'proj-icearrow-frost' ? null : area);
      if (resolved) {
        g.uniform = false; g.tsx = resolved.scaleX; g.tsy = resolved.scaleY;
      } else if (w > 0 && h > 0) {
        g.uniform = false;
        g.tsx = w / NOMINAL_RECT_W;
        g.tsy = h / NOMINAL_RECT_H;
      } else {
        var r = num(area.r, 0);
        g.uniform = true;
        g.tsx = g.tsy = r > 0 ? r / NOMINAL_RADIUS : 1;
      }
      g.trot = g.presetId === 'proj-icearrow-frost' &&
        typeof area.moveA === 'number' && isFinite(area.moveA) ? area.moveA : num(area.a, 0);
      if (g.anchored) return;                 // 位置的權威是玩家，不讀事件座標
      /* 推算基準換成這一則的權威座標，畫面與基準的落差記進殘差，由 update 衰減掉。 */
      var prevX = g.bx + g.ox, prevY = g.by + g.oy;
      g.bx = num(area.x, 0);
      g.by = num(area.y, 0);
      g.ox = prevX - g.bx;
      g.oy = prevY - g.by;
      if (Math.sqrt(g.ox * g.ox + g.oy * g.oy) > GROUND_MAX_RESIDUAL_PX) { g.ox = 0; g.oy = 0; }
    }
    /* 釘在某個實體腳底的場域（高塔版面、follow 場域）每幀的權威座標。 */
    function groundAnchorPoint(g) {
      return footOf(g.anchor || 'pv-float');
    }
    /* 推算基準的自走：沿模擬層當下的航向、用模擬層的速度前進；知道落點時不越過
       落點（等速直線飛向落點的場域抵達後就停駐，畫面必須跟著停）。 */
    function groundDeadReckon(g, dt) {
      if (!(g.speed > 0) || !isFinite(g.moveA) || !(dt > 0)) return;
      var run = g.speed * dt;
      if (Math.abs(g.turnRate || 0) > 1e-8) {
        var angle = g.moveA + g.turnRate * dt;
        var radius = g.speed / g.turnRate;
        g.bx += radius * (Math.sin(angle) - Math.sin(g.moveA));
        g.by += radius * (Math.cos(g.moveA) - Math.cos(angle));
        g.moveA = angle;
        return;
      }
      if (g.hasDest) {
        var dx = g.destX - g.bx, dy = g.destY - g.by;
        var left = Math.sqrt(dx * dx + dy * dy);
        if (!(left > 1e-6)) return;
        run = Math.min(run, left);
      }
      g.bx += Math.cos(g.moveA) * run;
      g.by += Math.sin(g.moveA) * run;
    }
    /* 殘差歸零：以一階低通的速度收斂，但移動中的場域另外壓上行進速度的比例上限。
       靜止的場域沒有行進可以藏，維持單純的一階低通。 */
    function groundCorrect(g, dt) {
      if (!(dt > 0)) return;
      var mag = Math.sqrt(g.ox * g.ox + g.oy * g.oy);
      if (!(mag > 1e-4)) { g.ox = 0; g.oy = 0; return; }
      var want = mag / GROUND_FOLLOW_TAU_SEC;
      if (g.speed > 0) want = Math.min(want, g.speed * GROUND_CORRECT_MAX_RATIO);
      var fix = Math.min(mag, want * dt);
      g.ox -= g.ox / mag * fix;
      g.oy -= g.oy / mag * fix;
    }
    function groundParams(g) {
      var p = { position: { x: g.x, y: g.y }, rotation: g.rot };
      if (g.uniform) p.scale = g.sx;
      else { p.scaleX = g.sx; p.scaleY = g.sy; }
      if (g.rise) {
        var enter = Math.max(0, Math.min(1, (clock - g.bornAt) / 0.3));
        var leave = Math.max(0, Math.min(1, (g.expireAt - clock) / 0.3));
        var amount = Math.min(enter, leave);
        amount = amount * amount * (3 - 2 * amount);
        delete p.scale;
        p.scaleX = g.sx * amount; p.scaleY = g.sy * amount;
        p.opacity = amount;
      }
      return p;
    }

    /* 持續場域：以 area.id 合併，重複事件只續命與更新「權威目標」 */
    function playGround(presetId, spec, role) {
      // 舊技能表的 ground ID 僅作相容入口；直接播放玩家編輯的同一份發射 preset。
      if (presetId === 'ground-icearrow-frost') presetId = 'proj-icearrow-frost';
      if (presetId === 'ground-firewall' && has(presetId + '-column-0') && spec.area) {
        var wall = spec.area, axis = num(wall.a, 0), result = false;
        for (var column = 0; column < 3; column++) {
          var offset = (column - 1) * num(wall.w, 180) * 0.8 / 3;
          var area = Object.assign({}, wall, {
            id: (wall.id || 'firewall@' + wall.x + ',' + wall.y) + '-column-' + column,
            x: num(wall.x, 0) + Math.cos(axis) * offset,
            y: num(wall.y, 0) + Math.sin(axis) * offset,
            r: num(wall.h, 60) / 2, a: 0
          });
          delete area.w; delete area.h;
          if (isFinite(area.destX) && isFinite(area.destY)) {
            area.destX += Math.cos(axis) * offset; area.destY += Math.sin(axis) * offset;
          }
          result = playGround(presetId + '-column-' + column, Object.assign({}, spec, { area: area }), 'field') || result;
        }
        return result;
      }
      /* 沒有 area 的事件有兩種：高塔（實體沒有座標，area 一律 null）與
         自身增益光殼（沒有判定半徑可言）。兩種都畫在目標腳底並跟著它走，
         大小由 profile.groundR 這個名目半徑決定；0 才維持退回舊畫法。 */
      var noArea = !spec.area;
      if (noArea && !(profile.groundR > 0)) return false;
      var anchor = noArea
        ? (Array.isArray(spec.targets) && spec.targets.length ? spec.targets[0] : 'pv-float')
        : 'pv-float';
      var key = noArea ? (presetId + '@' + anchor)
        : (spec.area.id ||
           (presetId + '@' + Math.round(num(spec.area.x, 0)) + ',' + Math.round(num(spec.area.y, 0))));
      // 場域本體與地面提示可共用 area.id，但必須分別續命、移動及回收。
      key = (role === 'field' ? 'field:' : 'ground:') + key;
      var keep = Math.max(GROUND_MIN_KEEP_SEC, num(spec.dur, 0.5) * GROUND_KEEP_TICKS);
      var mult = noArea || presetId === 'proj-icearrow-frost' ? profile.scale : profile.areaScale;
      var live = grounds[key];
      if (live && live.presetId === presetId) {
        live.expireAt = clock + keep;
        groundAim(live, spec);
        return true;
      }
      if (live) { stopRef(live.ref); delete grounds[key]; }
      var g = {
        bornAt: clock, rise: (presetId === 'aura-rockarmor-stone' || presetId === 'aura-earth-reversal') || presetId === 'ground-mire-earth' || presetId === 'ground-mire-venom' || presetId === 'ground-mire-magma' || presetId === 'fire-tornado-inferno' || presetId.indexOf('ground-firewall-column-') === 0,
        ref: null, presetId: presetId, expireAt: clock + keep, mult: mult, anchor: anchor,
        anchored: false, speed: 0, moveA: NaN, hasDest: false, destX: 0, destY: 0,
        bx: 0, by: 0, ox: 0, oy: 0,
        x: 0, y: 0, rot: 0, trot: 0, sx: 1, sy: 1, tsx: 1, tsy: 1, uniform: true
      };
      groundAim(g, spec);
      if (g.anchored) { var p = groundAnchorPoint(g); g.bx = p.x; g.by = p.y; }
      /* 出生的第一幀沒有推算歷史：畫面值＝權威值，殘差為 0。 */
      g.ox = 0; g.oy = 0;
      g.x = g.bx; g.y = g.by; g.rot = g.trot; g.sx = g.tsx; g.sy = g.tsy;
      var ref = play(role === 'field' ? rtFx : rtZone, presetId, groundParams(g), mult);
      if (!ref) return false;
      g.ref = ref;
      grounds[key] = g;
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
        area: area, members: Array.isArray(area.members) ? area.members : null,
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
      if (entry.geo.members) {
        var old = entry.orbs, next = [];
        entry.geo.members.forEach(function (member, index) {
          var presetId = member.companion ? entry.companionId : entry.orbId;
          var ref = old.find(function (r) { return r.memberId === member.id && r.presetId === presetId; });
          if (!ref) {
            var pose = sampleOrbitMember(entry.geo.area, entry.t, index), centre = orbitCentre();
            ref = play(rtFx, presetId, Object.assign({
              position: { x: centre.x + Math.cos(pose.angle) * pose.radius, y: centre.y + Math.sin(pose.angle) * pose.radius * ORBIT_FLAT }
            }, sizeOf(presetId, { r: pose.bodyR }) || { scale: pose.bodyR / NOMINAL_ORB }), profile.areaScale);
          }
          if (ref) { ref.memberId = member.id; ref.presetId = presetId; next.push(ref); }
        });
        old.forEach(function (ref) { if (next.indexOf(ref) < 0) stopRef(ref); });
        entry.orbs = next;
        return;
      }
      while (entry.orbs.length > entry.geo.orbs) stopRef(entry.orbs.pop());
      while (entry.orbs.length < entry.geo.orbs) {
        var ref = play(rtFx, entry.orbId, Object.assign({ position: orbitCentre() },
          sizeOf(entry.orbId, { r: entry.geo.orbR }) || { scale: entry.geo.orbR / NOMINAL_ORB }), profile.areaScale);
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
      if (geo.members && !geo.members.length) { stopOrbit(key); return true; }
      var companionId = spec.area.companionPreset || orbId;
      if (geo.members && geo.members.some(function (m) { return m.companion; }) && !has(companionId)) return false;
      var dur = Math.min(ORBIT_MAX_SEC, Math.max(0.5, num(spec.dur, 4)));
      var live = orbits[key];
      if (live && live.orbId === orbId) {
        live.dur = geo.members ? live.t + dur : Math.min(ORBIT_MAX_SEC, Math.max(live.dur, live.t + dur));
        live.geo = geo;
        live.companionId = companionId;
        syncOrbCount(live);
        return true;
      }
      if (live) stopOrbit(key);
      var ringId = (roles.ground && has(roles.ground)) ? roles.ground : '';
      var centre = orbitCentre();
      var entry = {
        orbId: orbId, companionId: companionId, ringId: ringId, geo: geo,
        t: geo.members ? Math.max(0, num(spec.area.orbitAge, 0)) : 0,
        dur: dur + (geo.members ? Math.max(0, num(spec.area.orbitAge, 0)) : 0), orbs: [],
        ring: ringId ? play(rtZone, ringId, Object.assign({ position: centre },
          sizeOf(ringId, { r: geo.ringR }) || { scale: geo.ringR / NOMINAL_RADIUS }), profile.areaScale) : null
      };
      orbits[key] = entry;
      syncOrbCount(entry);
      /* 一團都放不下（預算滿）＝這一則沒有畫面，交還舊畫法。 */
      if (!entry.orbs.length) { stopOrbit(key); return false; }
      return true;
    }
    /* 場域每幀推進：位置指數跟隨權威座標、尺寸與角度逐幀逼近，到期才收掉。
       跟隨我方的場域直接貼玩家錨點（模擬層就是這樣定義它的圓心）。 */
    function updateGrounds(step) {
      Object.keys(grounds).forEach(function (k) {
        var g = grounds[k];
        if (g.expireAt <= clock) { stopRef(g.ref); delete grounds[k]; return; }
        var previousX = g.x, previousY = g.y;
        if (g.anchored) {
          var p = groundAnchorPoint(g);
          g.bx = p.x; g.by = p.y; g.ox = 0; g.oy = 0;
        } else {
          groundDeadReckon(g, step);
          groundCorrect(g, step);
        }
        g.x = g.bx + g.ox;
        g.y = g.by + g.oy;
        if (g.presetId === 'proj-icearrow-frost') {
          // Face the rendered displacement, including snapshot correction; a separate
          // rotation easing would make the arrow slide sideways while turning.
          var dx = g.x - previousX, dy = g.y - previousY;
          if (step > 0 && dx * dx + dy * dy > 1e-10) g.rot = Math.atan2(dy, dx);
        } else {
          g.rot = approachAngle(g.rot, g.trot, step, GROUND_FOLLOW_TAU_SEC);
        }
        g.sx = approach(g.sx, g.tsx, step, GROUND_FOLLOW_TAU_SEC);
        g.sy = approach(g.sy, g.tsy, step, GROUND_FOLLOW_TAU_SEC);
        if (!moveRef(g.ref, groundParams(g), g.mult)) delete grounds[k];
      });
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
        if (o.ring && !moveRef(o.ring, Object.assign({ position: centre },
          sizeOf(o.ringId, { r: wholeR }) || { scale: wholeR / NOMINAL_RADIUS }),
          profile.areaScale)) o.ring = null;
        var base = g.startAng + g.spin * o.t;
        var dir = g.spin < 0 ? -1 : 1;
        for (var i = o.orbs.length - 1; i >= 0; i--) {
          /* 螺旋：第 i 團晚 i×spiralLag 秒才出生，半徑因此短了那一段時間的成長量——
             整組畫出來是一條從圓心往外長的螺旋，而不是同心圓。 */
          var orbT = g.spiral ? Math.max(0, o.t - i * g.spiralLag) : o.t;
          var rNow = g.spiral ? Math.min(capR, ringRNow + g.growPx * orbT) : wholeR;
          var ang = base + Math.PI * 2 * i / o.orbs.length;
          var memberPose = g.members ? sampleOrbitMember(g.area, o.t, g.members.findIndex(function (m) { return m.id === o.orbs[i].memberId; })) : null;
          if (memberPose) { ang = memberPose.angle; rNow = memberPose.radius; orbR = memberPose.bodyR; }
          var presetId = o.orbs[i].presetId || o.orbId;
          /* 朝向取「螢幕上的切線方向」而不是 ang＋90°：橢圓被壓扁 0.62 之後，
             那兩者差得出來（Preset 一律朝 +X 繪製，拖尾會指錯邊）。 */
          var heading = Math.atan2(Math.cos(ang) * ORBIT_FLAT * dir, -Math.sin(ang) * dir);
          var alive = moveRef(o.orbs[i], Object.assign({
            position: { x: centre.x + Math.cos(ang) * rNow, y: centre.y + Math.sin(ang) * rNow * ORBIT_FLAT },
            rotation: heading
          }, sizeOf(presetId, { r: orbR }) || { scale: orbR / NOMINAL_ORB }), profile.areaScale);
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
      if (spec.area && (num(spec.area.orbs, 0) > 0 || Array.isArray(spec.area.members))) {
        var orbDrops = budgetDrops;
        if (playOrbit(spec, roles)) return true;
        /* 與下面同一條規則：超出 budget 就整則丟掉，不落回舊畫法。 */
        if (budgetDrops > orbDrops) { counters.dropped++; return true; }
        return false;
      }
      var role = primaryRoleOf(spec, roles);
      var presetId = role ? roles[role] : '';
      if (!presetId || !has(presetId)) { counters.skipped++; return false; }
      /* 野外渲染器已消耗 delayMs；高塔直接呼叫 Adapter，仍須保留波次間隔。
         使用更新時鐘排程，clear() 會一起取消，不留下換頁後的計時器。 */
      if (num(spec.delayMs, 0) > 0) {
        pending.push({ at: clock + spec.delayMs / 1000, spec: Object.assign({}, spec, { delayMs: 0 }) });
        return true;
      }

      var ok = false;
      var drops0 = budgetDrops;
      switch (role) {
        case 'hit':
          ok = presetId === 'hit-thunderstrike-bluewhite' ? playThunderstrike(rtFx, presetId, spec) : (presetId === 'burst-meteor-inferno' || presetId === 'hit-thunderfall-impact' || presetId === 'hit-waterball-splash') && spec.area
            ? playOnArea(rtFx, presetId, spec)
            : playOnTargets(rtFx, presetId, spec, hitScaleOf(spec), 0);
          break;
        case 'projectile':
          ok = playProjectile(rtFx, presetId, spec);
          break;
        case 'cast':
          ok = playOnPlayer(rtFx, presetId, spec);
          break;
        case 'field': case 'ground':
          ok = playGround(presetId, spec, role);
          break;
        case 'attack':
          if (presetId === 'bolt-thunderstrike-bluewhite') {
            ok = playThunderstrike(rtFx, presetId, spec);
          } else if (spec.variant === 'dual-slash' || spec.variant === 'dual-storm') {
            var danceIds = spec.targets || [];
            var danceSource = spec.sourceId ? ctx.posOf(spec.sourceId) : ctx.playerPos();
            for (var di = 0; di < danceIds.length; di++) {
              var danceParams = defaultSize(presetId, 1);
              danceParams.position = ctx.posOf(danceIds[di]);
              danceParams.rotation = Math.atan2(danceParams.position.y - danceSource.y,
                danceParams.position.x - danceSource.x) + num(spec.angle, 0);
              if (play(rtFx, presetId, danceParams)) ok = true;
            }
          } else if (spec.variant === 'gale-moon') {
            var moonParams = sizeOf(presetId, { r: spec.area && spec.area.r }) || defaultSize(presetId, 1);
            moonParams.position = spec.targets && spec.targets.length ? ctx.posOf(spec.targets[0]) : areaCentre(spec.area);
            var moonSource = spec.sourceId ? ctx.posOf(spec.sourceId) : ctx.playerPos();
            var moonDx = moonParams.position.x - moonSource.x;
            var moonDy = moonParams.position.y - moonSource.y;
            // 素材刃口朝 +X；連斬角差必須疊在施法者到目標的方向上。
            var moonFacing = moonDx || moonDy ? Math.atan2(moonDy, moonDx) : num(spec.angle, 0);
            moonParams.rotation = moonFacing + [-0.15, 0, 0.15][moonSwingIndex++ % 3];
            ok = !!play(rtFx, presetId, moonParams);
          } else if (/^cleave(?:-|$)/.test(spec.variant || '')) {
            ok = playCleave(rtFx, presetId, spec);
          } else if (/^thrust(?:-|$)/.test(spec.variant || '') && num(spec.lineLength, 0) > 0) {
            var aimed = Object.assign({}, spec);
            if (typeof spec.angle !== 'number' || !isFinite(spec.angle)) {
              var origin = ctx.playerPos();
              var target = spec.targets && spec.targets.length ? ctx.posOf(spec.targets[0]) : origin;
              aimed.angle = Math.atan2(target.y - origin.y, target.x - origin.x);
            }
            ok = playDirectional(rtFx, presetId, aimed);
          } else if (spec.area) ok = playOnArea(rtFx, presetId, spec);
          else if (isFinite(spec.angle) && num(spec.lineLength, 0) > 0) ok = playDirectional(rtFx, presetId, spec);
          else if (spec.fxKind === 'beam' || spec.fxKind === 'chain') ok = playBeam(rtFx, presetId, spec);
          else ok = playOnTargets(rtFx, presetId, spec, 1, hitDelayFor(spec));
          break;
        default:
          ok = false;
      }
      /* 播不出來有兩種：超出 budget（丟掉，見 play 的說明）與其他（交還舊畫法）。 */
      if (!ok) {
        if (budgetDrops > drops0) { counters.dropped++; return true; }
        counters.skipped++; return false;
      }

      /* 天降類的落點預警：飛行物在天上飛的同時，地上要有那一圈紅／藍標記。
         舊畫法本來就兩個都畫，只接手飛行物會讓預警圈消失。

         沒有 area 的天降也要畫。地爆天星打的是全場、不掛在任何敵人身上，
         模擬層因此不給 area；原本的條件把它整個濾掉，落地影子就永遠不出現。
         playGround 本來就處理得了無 area 的情形（畫在 targets[0] 腳底、
         大小由 profile.groundR 決定），這裡只是別提前擋掉它。 */
      if ((role === 'projectile' || role === 'field') && roles.ground && has(roles.ground) &&
          (role === 'field' || spec.area || spec.fxKind === 'rain')) {
        playGround(roles.ground, spec);
      }

      /* 受擊爆點：同一則事件的 hit 角色跟著主要角色走（飛行物則等它抵達）；
         主要角色本身就是 hit 時不重複播。
         spec.hit === false＝這一擊被閃避或被無敵擋下，舊畫法同樣不畫爆點。 */
      if (role !== 'hit' && presetId !== 'proj-waterball-flow' && spec.hit !== false && presetId !== 'proj-meteor-inferno' && presetId !== 'proj-thunderfall-sky' && presetId !== 'hit-thunderfall-impact' && presetId !== 'bolt-thunderstrike-bluewhite' && !(spec.projectile && /^(?:thrust|cleave)(?:-|$)/.test(spec.variant || '')) && roles.hit && has(roles.hit)) {
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
        if (job.spec) { tryPlay(job.spec); continue; }
        play(job.rt, job.presetId, Object.assign(defaultSize(job.presetId, job.scale), { position: ctx.posOf(job.targetId) }));
      }

      /* 飛行物：沿「起點 → 目標當下座標」的曲線前進，目標會動就跟著動。
         有進場航向時（連鎖的第二段起）走二次貝茲，因此轉彎是一道弧而不是折角；
         機身朝向取路徑當下的切線並逐幀追上，不會在轉折處瞬間翻面。 */
      for (var i = projectiles.length - 1; i >= 0; i--) {
        var pr = projectiles[i];
        pr.t += step;
        var k = Math.min(1, pr.t / pr.dur);
        var to = pr.to || ctx.posOf(pr.targetId);
        var ctrl = curveControl(pr.from, to, pr.enterAngle);
        if (pr.arcHeight > 0) ctrl = {x:(pr.from.x+to.x)/2,y:(pr.from.y+to.y)/2-2*pr.arcHeight};
        var at = curvePoint(pr.from, ctrl, to, k);
        var movingDimensions = pr.dimensions;
        if (pr.thrustBody) {
          var distance = pr.thrustLength * k;
          var tailDistance = Math.max(0, distance - pr.thrustBody);
          at = {x:pr.from.x+Math.cos(pr.facing)*tailDistance,y:pr.from.y+Math.sin(pr.facing)*tailDistance};
          movingDimensions = {scaleX:pr.dimensions.scaleX*Math.min(1,distance/pr.thrustBody),scaleY:pr.dimensions.scaleY};
        }
        pr.facing = pr.arcHeight > 0 ? curveHeading(pr.from, ctrl, to, k) : approachAngle(pr.facing, curveHeading(pr.from, ctrl, to, k),
          step, PROJECTILE_FACING_TAU_SEC);
        var alive = moveRef(pr.ref, Object.assign({
          position: { x: at.x, y: at.y },
          rotation: pr.facing
        }, movingDimensions), pr.mult);
        if (!alive || k >= 1) {
          /* 抵達時的航向留給連鎖的下一段接手（見 playProjectile 的 enterAngle）。 */
          if (k >= 1 && pr.targetId) arrivals[pr.targetId] = { angle: pr.facing, at: clock };
          if (alive) stopRef(pr.ref);
          projectiles.splice(i, 1);
        }
      }

      /* 使用每幀已插值的實體座標，電弧前端抵達時仍落在移動目標上。 */
      for (var bi = trackingBeams.length - 1; bi >= 0; bi--) {
        var beam = trackingBeams[bi];
        var beamFrom = beam.fromId ? ctx.posOf(beam.fromId) : ctx.playerPos();
        var beamTo = ctx.posOf(beam.toId);
        if (ctx.chainPoint) {
          beamFrom = ctx.chainPoint(beam.fromId || 'pv-float');
          beamTo = ctx.chainPoint(beam.toId);
          if (!beamFrom || !beamTo) {
            stopRef(beam.ref); trackingBeams.splice(bi, 1); continue;
          }
        }
        var bdx = beamTo.x - beamFrom.x, bdy = beamTo.y - beamFrom.y;
        if (!moveRef(beam.ref, {
          position: beamFrom, rotation: Math.atan2(bdy, bdx),
          scaleX: Math.max(1, Math.sqrt(bdx * bdx + bdy * bdy)) / beam.width, scaleY: profile.scale
        }, 1)) trackingBeams.splice(bi, 1);
      }

      /* 跟隨玩家的施放特效 */
      for (var f = follows.length - 1; f >= 0; f--) {
        var fo = follows[f];
        if (fo.requireVisible && ctx.chainPoint && !ctx.chainPoint(fo.key)) { stopRef(fo.ref); follows.splice(f, 1); continue; }
        var live = moveRef(fo.ref, { position: footOf(fo.key) });
        if (!live || fo.until <= clock) {
          if (live && fo.until <= clock) stopRef(fo.ref);
          follows.splice(f, 1);
        }
      }

      /* 狀態光環跟著實體走 */
      Object.keys(auras).forEach(function (k) {
        var a = auras[k];
        if (a.expireAt <= clock) { stopRef(a.ref); delete auras[k]; return; }
        if (!moveRef(a.ref, { position: footOf(a.key) })) delete auras[k];
      });

      updateOrbits(step);

      updateGrounds(step);

      rtFx.update(step);
      rtZone.update(step);
    }

    /* 只收「持續場域」：場域與環繞場域的權威都在模擬層的執行期狀態
       （SKILL_RT／SKILL2_RT），顯示層本身沒有「現在還在不在」的資訊，只能靠
       模擬層不斷重送來續命。玩家倒地時那一批執行期狀態是被整批清掉的
       （js/combat.js onPlayerFieldDeath → resetSkillRT），之後不會再有人續命——
       留著只是等各自的顯示壽命自己走完，畫面上就是「人已經倒了，岩甲的石板還在繞」。
       飛行物、受擊爆點與狀態光環不在此列：前兩者本來就是一次性的，
       狀態光環另有 syncStatuses 逐張快照對帳。 */
    function clearFields() {
      Object.keys(orbits).forEach(stopOrbit);
      Object.keys(grounds).forEach(function (k) {
        stopRef(grounds[k].ref);
        delete grounds[k];
      });
    }

    function clear() {
      moonSwingIndex = 0;
      projectiles.length = 0;
      follows.length = 0;
      trackingBeams.length = 0;
      pending.length = 0;
      arrivals = Object.create(null);
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
      clearFields: clearFields,
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
          dropped: counters.dropped,
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

  /* vfx/presets/*.json 與 vfx/shipped-assets.json 是**資料**，不是被 index.html
     的 ?v= 管到的程式。改了資料卻沒換這個版號，測試者的瀏覽器會繼續吃快取裡的
     舊 preset——回報的現象會與 repo 裡的內容完全對不起來，而且查不出原因。
     ⚠️ 動到 vfx/presets 或 shipped-assets.json 時，這一行要一起改。 */
  var DATA_VERSION = '20260912-water-cyclone';

  function loadPresets(ids, base) {
    var prefix = (base || 'vfx/presets') + '/';
    return Promise.all(ids.map(function (id) {
      return fetch(prefix + id + '.json?v=' + DATA_VERSION, { cache: 'no-store' })
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
    return fetch((opts.shippedUrl || 'vfx/shipped-assets.json') + '?v=' + DATA_VERSION, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (index) {
        if (!index) return null;
        var resolver = VFXCore.createIndexResolver(index, index.baseUrl || 'images/vfx/assets');
        var adapter = create({
          resolver: resolver,
          fxBackend: VFXPixiBackend.createBackend({ container: opts.fxContainer, depthSort: true }),
          zoneBackend: VFXPixiBackend.createBackend({ container: opts.zoneContainer, depthSort: true }),
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
    loadPresets: loadPresets,
    primaryRoleOf: primaryRoleOf,
    resolveSizing: resolveSizing,
    sampleOrbitMember: sampleOrbitMember,
    SIZE_DEFAULTS: SIZE_DEFAULTS,
    NOMINAL: {
      radius: NOMINAL_RADIUS, rectW: NOMINAL_RECT_W, rectH: NOMINAL_RECT_H,
      beam: NOMINAL_BEAM, lance: NOMINAL_LANCE, lanceWidth: NOMINAL_LANCE_W, orb: NOMINAL_ORB
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VFXRuntime;
}
