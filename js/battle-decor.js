/* 戰場地形裝飾（2026-10）
   ============================================================
   原本每張地圖只有一張 128px 的平鋪地磚，畫面單調。這裡加三層，全部是純表現，模擬層一行不動：
     1. 地面裝飾（decal）：大片色塊、裂痕、碎石、骨骸、水窪、符文圈…貼在地面平面上，打破磚紋重複。
        掛在 bg 層「地板之上、暗角之下」的地面平面容器（scale.y = GROUND_Y_SCALE），子節點用世界座標。
     2. 擺件（prop）：岩石、斷柱、枯樹、墓碑、冰晶…直立物件，掛進實體層（entity），zIndex＝腳底的畫面 y，
        和角色、敵人一起依前後遮擋；擋到玩家時自動變半透明。
     3. 天氣（ambient）：飄沙、落雪、螢火蟲、餘燼…螢幕座標的小粒子，數量固定。

   世界沒有邊界、鏡頭跟著玩家走，所以裝飾依「區塊」產生：鏡頭附近的區塊用 (區塊座標, 地圖, 階段帶) 當亂數種子
   擺放，看不到的區塊回收到物件池。同一個區塊每次回來長得都一樣。
   每 10 個階段換一個「階段帶」：單數帶是地表、雙數帶是地下（沙下神殿、冰窟、腐根地穴、地下墓窟），
   地下版地面較暗、多火盆與光源、少植物。

   貼圖全部執行期用 Canvas 2D 程序化畫好、打包成一張圖集（每張地圖一次，約 20ms），不另外載圖檔。
   效能：全部是靜態精靈，同一張圖集可以合批；每幀只做區塊進出判斷（越過區塊邊界才重算）與粒子位移。
   ?decor=0 整個關掉（A/B 對照用），?decor=lite 減量。 */
var BattleDecor = (function () {
  'use strict';

  /* ============ 小工具 ============ */
  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash3(x, y, z) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function strHash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function hexRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // k > 0 變亮、k < 0 變暗（-1～1）
  function shade(hex, k) {
    var c = hexRgb(hex);
    var t = k < 0 ? 0 : 255, p = Math.abs(k);
    return 'rgb(' + Math.round(c[0] + (t - c[0]) * p) + ',' + Math.round(c[1] + (t - c[1]) * p) + ',' + Math.round(c[2] + (t - c[2]) * p) + ')';
  }
  // 調亮／調暗後再帶透明度
  function shadeRgba(hex, k, a) {
    var c = hexRgb(hex);
    var t = k < 0 ? 0 : 255, p = Math.abs(k);
    return 'rgba(' + Math.round(c[0] + (t - c[0]) * p) + ',' + Math.round(c[1] + (t - c[1]) * p) + ',' + Math.round(c[2] + (t - c[2]) * p) + ',' + a + ')';
  }
  // 同 shade，但回傳 #rrggbb（給要再做色階的材質用）
  function shadeHex(hex, k) {
    var c = hexRgb(hex);
    var t = k < 0 ? 0 : 255, p = Math.abs(k);
    return '#' + c.map(function (v) { return ('0' + Math.round(v + (t - v) * p).toString(16)).slice(-2); }).join('');
  }
  function rgba(hex, a) {
    var c = hexRgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function range(r, a, b) { return a + (b - a) * r(); }
  function pick(r, list) { return list[Math.floor(r() * list.length) % list.length]; }

  // 不規則的團塊輪廓（以橢圓為底加雜訊），回傳點陣列
  function blob(cx, cy, rx, ry, n, jitter, r) {
    var pts = [];
    var phase = r() * Math.PI * 2;
    for (var i = 0; i < n; i++) {
      var a = phase + i / n * Math.PI * 2;
      var k = 1 + (r() * 2 - 1) * jitter;
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return pts;
  }
  function pathPoly(g, pts) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  }
  // 平滑的封閉曲線（中點二次曲線）
  function pathSmooth(g, pts) {
    var n = pts.length;
    g.beginPath();
    var m0 = [(pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2];
    g.moveTo(m0[0], m0[1]);
    for (var i = 0; i < n; i++) {
      var p = pts[i], q = pts[(i + 1) % n];
      g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    }
    g.closePath();
  }
  function shadowEllipse(g, cx, cy, rx, ry, a) {
    g.save();
    var grad = g.createRadialGradient(cx, cy, 0, cx, cy, rx);
    grad.addColorStop(0, 'rgba(0,0,0,' + a + ')');
    grad.addColorStop(0.7, 'rgba(0,0,0,' + (a * 0.6) + ')');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.translate(cx, cy);
    g.scale(1, ry / rx);
    g.beginPath();
    g.arc(0, 0, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  function speckle(g, r, x0, y0, w, h, n, color, size, clipPath) {
    g.save();
    if (clipPath) { clipPath(); g.clip(); }
    g.fillStyle = color;
    for (var i = 0; i < n; i++) {
      var s = size * (0.4 + r());
      g.fillRect(x0 + r() * w, y0 + r() * h, s, s);
    }
    g.restore();
  }

  /* ============ 直立擺件 ============
     每個畫法收 (g, w, h, r, pal, opt)，座標是邏輯像素（外層已依圖集解析度放大）；腳底在 (w/2, h - FOOT)。

     2026-10 改版：立體感交給 DecorSculpt（js/decor-sculpt.js）——先用圖元（橢球、錐形管、圓柱、圓錐、
     切面、斜角方塊）塑形，再統一打光（光從左上前方），所以每種擺件的明暗方向一致、表面有石紋／樹皮／裂紋。
     向量筆觸只留給：貼地陰影與發光暈（先畫，在物件後面）、極細的東西（草葉、刺、旗上的紋章）。
     美術手法參考 RPG Maker MV 地圖圖塊（左上光、暗部偏冷亮部偏暖、深色描邊），沒有使用其素材（AI_RULES.md 第二原則）。 */
  var FOOT = 8;

  function sculpt(w, h, scale) { return new DecorSculpt.Sculpt(w, h, scale || TEX_SCALE); }
  /* 地面裝飾用一半解析度塑形（放大貼回圖集）：它們本來就柔、又會被地面平面壓扁，
     看不出差別，像素卻只剩四分之一（石板地原本一張要 75～140ms）。 */
  var DECAL_SCALE = 0.75;
  // 材質：color 是原色，其餘見 DecorSculpt 的 render（amb 環境光、bump 凹凸強度、spec 高光、emit 自發光…）
  function M(color, o) {
    var m = { color: color };
    if (o) for (var k in o) m[k] = o[k];
    return m;
  }
  function noiseTex(kind, scale, amp, r) { return { kind: kind, scale: scale, amp: amp, ox: r() * 256, oy: r() * 256 }; }
  function merge(a, b) {
    var o = {}, k;
    for (k in a) o[k] = a[k];
    for (k in b) o[k] = b[k];
    return o;
  }
  // 平面橢圓（朝上的頂面：樹樁截面、碗口）
  function ellipsePts(cx, cy, rx, ry, n) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2;
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return pts;
  }
  function rotPts(pts, ox, oy, ang) {
    var c = Math.cos(ang), s = Math.sin(ang);
    return pts.map(function (p) {
      var dx = p[0] - ox, dy = p[1] - oy;
      return [ox + dx * c - dy * s, oy + dx * s + dy * c];
    });
  }
  var UP_NX = 0, UP_NY = -0.82, UP_NZ = 0.57;   // 3/4 俯視下水平頂面的法線

  var SNOW = M('#e6eef8', { coolHue: 222, shift: 16, amb: 0.5, bump: 0.45, spec: 0.12, hiLift: 0.85 });

  // 腳邊碎石：幾顆小切面石頭
  function pebblesAt(S, r, cx, fy, spread, n, mat, z) {
    for (var k = 0; k < n; k++) {
      var pr = range(r, 1.4, 3.2);
      S.ellipsoid(cx + range(r, -spread, spread), fy - pr * 0.6, pr * range(r, 1, 1.4), pr, z + range(r, 0, 3), mat,
        { cutY: fy + 0.5, facet: 0.6, facetScale: 4, fox: r() * 256, foy: r() * 256 });
    }
  }

  /* 低多邊形岩塊：7 點輪廓＋正面一個稜點、頂面一個中心點，拆成六個凸面，每面固定法線。
     光從左上 → 左上兩面最亮、右下兩面最暗，面與面之間有深度差，打光時會描出清楚的稜線（鑿出來的感覺）。 */
  function rockFacets(S, r, cx, by, bw, bh, z, mat, o) {
    var hw = bw / 2;
    var P = [
      [cx - hw, by],
      [cx - hw * range(r, 0.9, 1), by - bh * range(r, 0.3, 0.5)],
      [cx - hw * range(r, 0.42, 0.66), by - bh * range(r, 0.78, 0.94)],
      [cx + hw * range(r, -0.18, 0.12), by - bh],
      [cx + hw * range(r, 0.42, 0.62), by - bh * range(r, 0.68, 0.88)],
      [cx + hw * range(r, 0.9, 1), by - bh * range(r, 0.24, 0.42)],
      [cx + hw * range(r, 0.84, 0.96), by]
    ];
    var Q = [cx + hw * range(r, -0.14, 0.08), by - bh * range(r, 0.4, 0.55)];
    var T = [lerp(P[2][0], P[4][0], 0.5) + range(r, -2, 2), lerp(P[2][1], P[4][1], 0.5) + bh * range(r, 0.06, 0.14)];
    var B = [Q[0] + range(r, -2, 3), by];
    var faces = [
      [[P[2], P[3], T], -0.3, -0.85, 0.45, 0],
      [[P[3], P[4], T], 0.38, -0.78, 0.5, 0.5],
      [[P[1], P[2], T, Q], -0.8, -0.32, 0.5, 1.8],
      [[T, P[4], P[5], Q], 0.72, -0.25, 0.64, 2.2],
      [[P[0], P[1], Q, B], -0.52, 0.12, 0.84, 3.2],
      [[Q, P[5], P[6], B], 0.52, 0.22, 0.82, 3.6]
    ];
    faces.forEach(function (f) {
      // 每面法線再隨機偏一點，同一種岩石的各塊才不會完全一樣亮
      S.facet(f[0], z + f[4], f[1] + range(r, -0.08, 0.08), f[2] + range(r, -0.06, 0.06), f[3], mat, o);
    });
  }

  /* ---- 岩石：主岩塊＋一兩塊靠前的小岩塊，腳邊碎石；積雪／苔蘚只長在朝上的面 ---- */
  function drawRock(g, w, h, r, pal, opt) {
    opt = opt || {};
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 4, fy - 1, w * 0.48, w * 0.13, 0.55);
    var S = sculpt(w, h);
    var rock = M(pal.base, { bump: 1, amb: 0.24, wrap: 0.1, hiLift: 0.5, cavity: 0.05, shift: pal.shift });
    var top = opt.snow ? SNOW : (opt.moss ? M(opt.moss, { bump: 1.6, amb: 0.3 }) : null);
    var o = {
      bevel: 1.3, tex: noiseTex(pal.strata ? 'strata' : 'default', 70 / Math.max(40, w), pal.strata ? 0.35 : 1.3, r),
      top: top, topThr: -0.55, topNoise: opt.moss ? 0.42 : (opt.snow ? 0.22 : 0)
    };
    var big = w > 120;
    var mainH = (fy - 2) * range(r, 0.82, 1);
    rockFacets(S, r, cx + range(r, -0.04, 0.04) * w, fy, w * (big ? 0.62 : 0.76), mainH, 0, rock, o);
    if (big) {
      rockFacets(S, r, cx - w * range(r, 0.24, 0.3), fy, w * range(r, 0.34, 0.42), mainH * range(r, 0.55, 0.7), 6, rock, o);
      rockFacets(S, r, cx + w * range(r, 0.24, 0.3), fy, w * range(r, 0.3, 0.38), mainH * range(r, 0.45, 0.6), 7, rock, o);
    }
    if (r() < 0.75) rockFacets(S, r, cx - w * range(r, 0.24, 0.32), fy, w * range(r, 0.26, 0.36), mainH * range(r, 0.3, 0.45), 9, rock, o);
    if (r() < 0.6) rockFacets(S, r, cx + w * range(r, 0.22, 0.32), fy, w * range(r, 0.22, 0.3), mainH * range(r, 0.25, 0.4), 10, rock, o);
    pebblesAt(S, r, cx, fy, w * 0.46, Math.round(range(r, 1, 4)), rock, 14);
    S.render(g, { footY: fy, footAO: mainH * 0.4, inner: 0.42, zEdge: 0.6 });
  }

  /* ---- 石筍／冰柱／尖岩：一根主錐＋一兩根小錐，橫向層理 ---- */
  function drawSpire(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 4, fy, w * 0.44, w * 0.12, 0.5);
    if (pal.glow) {
      var halo = g.createRadialGradient(cx, fy - h * 0.4, 0, cx, fy - h * 0.4, w * 0.62);
      halo.addColorStop(0, rgba(pal.glow, 0.22)); halo.addColorStop(1, rgba(pal.glow, 0));
      g.fillStyle = halo; g.fillRect(0, 0, w, h);
    }
    var S = sculpt(w, h);
    var mat = M(pal.base, { bump: 1.1, amb: pal.amb || 0.28, spec: pal.spec || 0, shin: 16, emit: pal.glow ? 0.05 : 0, emitColor: pal.glow, shift: pal.shift });
    var cones = [{ x: cx + range(r, -0.05, 0.05) * w, rb: w * range(r, 0.2, 0.25), ht: (fy - 3) * range(r, 0.86, 1), z: 0 }];
    var n = 1 + Math.floor(r() * 2.4);
    for (var i = 0; i < n; i++) {
      cones.push({ x: cx + (i % 2 ? 1 : -1) * w * range(r, 0.2, 0.3), rb: w * range(r, 0.1, 0.16), ht: fy * range(r, 0.3, 0.56), z: w * 0.22 + i * 3 });
    }
    cones.forEach(function (c) {
      S.cone(c.x, fy + 2, c.rb, c.ht, c.z, mat, {
        tex: noiseTex(pal.smooth ? 'grain' : 'strata', pal.smooth ? 1.2 : 0.6, pal.smooth ? 1 : 0.8, r),
        bend: range(r, -4, 4), power: range(r, 0.85, 1.15), facet: pal.smooth ? 0.45 : 0.4, facetScale: 3, fox: r() * 256, foy: r() * 256
      });
      if (pal.glow) S.glowDisc(c.x, fy - c.ht * 0.3, c.rb * 0.5, c.ht * 0.28, 0.35);
    });
    pebblesAt(S, r, cx, fy, w * 0.4, 3, mat, w * 0.35);
    S.render(g, { footY: fy, footAO: 14 });
  }

  /* ---- 石柱：兩層斜角底座＋有凹槽的柱身；完整的有柱頭，斷的有朝上的破裂面與腳邊碎塊 ---- */
  function drawPillar(g, w, h, r, pal, opt) {
    opt = opt || {};
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 7, fy - 1, w * 0.52, w * 0.15, 0.5);
    var S = sculpt(w, h);
    var stone = M(pal.base, { bump: 1, amb: 0.3, cavity: 0.06 });
    var tex = noiseTex('crack', 0.75, 1.1, r);
    var sw = w * 0.26;
    var y = fy;
    function plinth(halfW, hh, z) {
      S.block(cx - halfW, y - hh, cx + halfW, y, z, stone, { bevel: 1.6, depth: 4, tex: tex });
      y = y - hh - 4;
    }
    plinth(w * 0.46, Math.max(5, h * 0.05), sw + 7);
    plinth(w * 0.37, Math.max(4, h * 0.04), sw + 4);
    var topY = opt.intact ? h * 0.15 : h * range(r, 0.22, 0.38);
    var jag = null;
    if (!opt.intact) {
      jag = [];
      var steps = 6, tilt = range(r, -1, 1) * 10;
      for (var s = 0; s <= steps; s++) jag.push([cx - sw + 2 * sw * s / steps, topY + range(r, -4, 5) + (s / steps - 0.5) * tilt]);
    }
    var topAt = jag ? function (x) {
      var t = (x - (cx - sw)) / (2 * sw) * steps;
      var i = Math.max(0, Math.min(steps - 1, Math.floor(t)));
      var f = Math.max(0, Math.min(1, t - i));
      return jag[i][1] + (jag[i + 1][1] - jag[i][1]) * f;
    } : null;
    S.column(cx, topY, y + 4, sw, 0, stone, { flutes: 5, tex: tex, topY: topAt, taper: 0.05 });
    if (opt.intact) {
      S.block(cx - sw * 1.12, topY - 5, cx + sw * 1.12, topY + 2, sw + 2, stone, { bevel: 1.4, tex: tex });
      S.block(cx - sw * 1.32, topY - 13, cx + sw * 1.32, topY - 5, sw + 4, stone, { bevel: 1.6, depth: 5, tex: tex });
    } else {
      // 破裂面：沿鋸齒一段段朝上的小平面
      for (var j = 0; j < jag.length - 1; j++) {
        var a = jag[j], b = jag[j + 1];
        S.facet([[a[0], a[1]], [b[0], b[1]], [b[0] + 1.5, b[1] - 4], [a[0] + 1.5, a[1] - 4]], sw * 0.6, 0.1 * (j % 2 ? 1 : -1), -0.8, 0.58, stone, { tex: tex });
      }
      pebblesAt(S, r, cx + (r() < 0.5 ? -1 : 1) * w * 0.32, fy, w * 0.14, 3, stone, sw + 10);
    }
    if (opt.moss) {
      var moss = M(opt.moss, { bump: 1.6, amb: 0.3 });
      for (var m = 0; m < 4; m++) {
        S.ellipsoid(cx + range(r, -w * 0.4, w * 0.4), fy - range(r, 1, 6), range(r, 3, 6), range(r, 2, 3.5), sw + 9, moss, { cutY: fy + 0.5, tex: noiseTex('default', 2, 2, r) });
      }
    }
    S.render(g, { footY: fy, footAO: 12 });
  }

  /* ---- 枯樹：粗短的樹幹分成兩三根主枝，每段都扭一下；樹皮是沿枝幹拉長的雜訊 ---- */
  function drawDeadTree(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 4, fy, w * 0.34, w * 0.09, 0.45);
    var S = sculpt(w, h);
    var bark = M(pal.wood, { bump: 1.6, amb: 0.3, hiLift: 0.42, cavity: 0.06 });
    var trunkR = Math.max(3.4, w * 0.075);
    function limb(x, y, len, ang, rad, depth, z, cut) {
      var mx = x + Math.cos(ang) * len * 0.5 + range(r, -1, 1) * len * 0.08;
      var my = y + Math.sin(ang) * len * 0.5 + range(r, -1, 1) * len * 0.05;
      var ang2 = ang + range(r, -0.38, 0.38);
      var ex = mx + Math.cos(ang2) * len * 0.5, ey = my + Math.sin(ang2) * len * 0.5;
      var rm = rad * 0.84, re = rad * 0.66;
      var tex = { kind: 'bark', scale: 0.7, amp: 1.8, ox: r() * 256, oy: r() * 256 };
      S.capsule(x, y, rad, mx, my, rm, z, bark, cut ? { tex: tex, cutY: cut } : { tex: tex });
      S.capsule(mx, my, rm, ex, ey, re, z, bark, { tex: tex, uOff: len * 0.5 });
      if (depth <= 0 || re < 0.8) return;
      var n = depth >= 3 ? (r() < 0.35 ? 3 : 2) : (r() < 0.65 ? 2 : 1);
      for (var i = 0; i < n; i++) {
        var spread = (n === 1 ? 0 : (i - (n - 1) / 2) * range(r, 0.6, 0.95)) + range(r, -0.25, 0.25);
        limb(ex, ey, len * range(r, 0.56, 0.76), ang2 + spread, re * range(r, 0.78, 0.92), depth - 1, z + range(r, -3, 3));
      }
    }
    // 樹根：往兩側趴在地上
    var roots = [-1, 1, r() < 0.5 ? -0.45 : 0.5];
    roots.forEach(function (k, i) {
      S.capsule(cx, fy - trunkR * 1.6, trunkR * 0.9, cx + k * trunkR * range(r, 2.8, 3.8), fy + 0.5, trunkR * 0.3, 3 + i, bark,
        { tex: { kind: 'bark', scale: 0.7, amp: 1.6, ox: r() * 256, oy: r() * 256 }, cutY: fy + 1 });
    });
    limb(cx, fy + 1, h * 0.34, -Math.PI / 2 + range(r, -0.12, 0.12), trunkR, 4, 0, fy + 0.5);
    S.render(g, { footY: fy, footAO: 10, inner: 0.5, zEdge: 2 });
  }

  /* ---- 仙人掌：有縱向稜的柱身與手臂，刺用向量點上去 ---- */
  function drawCactus(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 4, fy, w * 0.34, w * 0.09, 0.42);
    var S = sculpt(w, h);
    var skin = M(pal.base, { bump: 0.8, amb: 0.3, shift: 26, hiLift: 0.5 });
    var cw = w * 0.13;
    var tex = noiseTex('grain', 1.5, 0.8, r);
    var spines = [];
    var armY = fy - h * range(r, 0.36, 0.48), lx = cx - cw * 2.6;
    S.capsule(cx, armY, cw * 0.6, lx, armY + 1, cw * 0.6, -1, skin, { tex: tex, ribs: 4 });
    S.capsule(lx, armY + 1, cw * 0.66, lx - 1, armY - h * 0.22, cw * 0.6, -1, skin, { tex: tex, ribs: 4 });
    spines.push([lx, armY - h * 0.22, armY]);
    if (r() < 0.75) {
      var armY2 = fy - h * range(r, 0.28, 0.4), rx = cx + cw * 2.5;
      S.capsule(cx, armY2, cw * 0.58, rx, armY2 + 1, cw * 0.58, -1, skin, { tex: tex, ribs: 4 });
      S.capsule(rx, armY2 + 1, cw * 0.62, rx + 1, armY2 - h * 0.17, cw * 0.56, -1, skin, { tex: tex, ribs: 4 });
      spines.push([rx, armY2 - h * 0.17, armY2]);
    }
    S.capsule(cx, fy + 2, cw, cx, fy - h * 0.78 + cw, cw * 0.94, 0, skin, { tex: tex, ribs: 5, cutY: fy + 1 });
    spines.push([cx, fy - h * 0.78 + cw, fy]);
    if (r() < 0.35) S.ellipsoid(cx, fy - h * 0.78 + cw * 0.3, cw * 0.55, cw * 0.4, cw + 2, M(pal.flower || '#e06a8a', { amb: 0.4, bump: 0.6 }), {});
    S.render(g, { footY: fy, footAO: 10 });
    // 刺：沿稜線的小亮點
    g.fillStyle = rgba('#f4ecd0', 0.75);
    spines.forEach(function (sp) {
      for (var y = sp[1] + 4; y < sp[2] - 2; y += 5) {
        g.fillRect(sp[0] - cw * 0.55, y, 1.1, 1.1);
        g.fillRect(sp[0] + cw * 0.45, y + 2.5, 1.1, 1.1);
        g.fillRect(sp[0] - 0.4, y + 1.2, 1, 1);
      }
    });
  }

  /* ---- 晶簇：六角柱（三個可見側面＋三個尖端切面），強高光、內部裂紋與核心微光 ---- */
  function drawCrystals(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 3, fy, w * 0.44, w * 0.12, 0.38);
    var halo = g.createRadialGradient(cx, fy - h * 0.4, 0, cx, fy - h * 0.4, w * 0.6);
    halo.addColorStop(0, rgba(pal.glow, 0.3));
    halo.addColorStop(1, rgba(pal.glow, 0));
    g.fillStyle = halo;
    g.fillRect(0, 0, w, h);
    var S = sculpt(w, h);
    var cm = M(pal.base, { amb: 0.4, spec: 0.9, shin: 24, emit: 0.06, emitColor: pal.glow, bump: 0.7, shift: 30, hiLift: 0.78, wrap: 0.4 });
    var rockM = M(pal.rock || '#6a6a78', { bump: 1, amb: 0.26 });
    var n = 3 + Math.floor(r() * 3);
    var shards = [];
    for (var i = 0; i < n; i++) {
      shards.push({
        x: cx + range(r, -w * 0.26, w * 0.26), hgt: (fy - 4) * range(r, 0.38, 0.86) * (i === 0 ? 1.08 : 0.82),
        sw: w * range(r, 0.13, 0.2), lean: range(r, -0.32, 0.32)
      });
    }
    shards.sort(function (a, b) { return b.hgt - a.hgt; });
    shards.forEach(function (s, k) {
      var z = k * 5, by = fy + 1, hw = s.sw / 2;
      var shY = by - s.hgt * 0.78, tip = [s.x + s.lean * s.hgt, by - Math.min(s.hgt, fy - 2)];
      var shs = s.lean * s.hgt * 0.78;
      var xl = s.x - hw, xcl = s.x - hw * 0.32, xcr = s.x + hw * 0.32, xr = s.x + hw;
      var tex = noiseTex('crack', 1.4, 1.1, r);
      S.facet([[xl, by], [xcl, by], [xcl + shs, shY], [xl + shs, shY]], z, -0.74, -0.1, 0.66, cm, { tex: tex });
      S.facet([[xcr, by], [xr, by], [xr + shs, shY], [xcr + shs, shY]], z, 0.74, -0.1, 0.66, cm, { tex: tex });
      S.facet([[xcl, by], [xcr, by], [xcr + shs, shY], [xcl + shs, shY]], z + 2, 0.05, -0.04, 1, cm, { tex: tex });
      S.facet([[xl + shs, shY], [xcl + shs, shY], tip], z, -0.62, -0.55, 0.56, cm, { tex: tex });
      S.facet([[xcr + shs, shY], [xr + shs, shY], tip], z, 0.62, -0.55, 0.56, cm, { tex: tex });
      S.facet([[xcl + shs, shY], [xcr + shs, shY], tip], z + 2, 0.02, -0.66, 0.75, cm, { tex: tex });
      S.glowDisc(s.x + shs * 0.35, by - s.hgt * 0.32, hw * 0.75, s.hgt * 0.34, 0.45);
    });
    pebblesAt(S, r, cx, fy, w * 0.42, 4, rockM, 40);
    S.render(g, { footY: fy, footAO: 7, inner: 0.4, zEdge: 1.5, ao: 0.3 });
  }

  /* ---- 墓碑：凸多邊形的拱頂石板（斜角邊）＋側面厚度＋刻出來的十字與字行；前面一坨土 ---- */
  function drawGrave(g, w, h, r, pal, opt) {
    opt = opt || {};
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 5, fy, w * 0.46, w * 0.12, 0.45);
    var S = sculpt(w, h);
    var stone = M(pal.base, { bump: 1.1, amb: 0.3, cavity: 0.07 });
    var dirt = M(pal.dirt || '#3a3028', { bump: 1.6, amb: 0.28 });
    var sw = w * 0.56, sh = h * 0.7, tilt = range(r, -0.1, 0.1);
    var ox = cx, oy = fy - 3;
    var pts = [[ox - sw / 2, oy], [ox + sw / 2, oy], [ox + sw / 2, oy - sh + sw / 2]];
    for (var a = 1; a < 10; a++) {
      var t = a / 10 * Math.PI;
      pts.push([ox + Math.cos(t) * sw / 2, oy - sh + sw / 2 - Math.sin(t) * sw / 2]);
    }
    pts.push([ox - sw / 2, oy - sh + sw / 2]);
    pts = rotPts(pts, ox, oy, tilt);
    var tex = noiseTex('crack', 1.3, 1.6, r);
    // 側面厚度（右後方）
    S.facet(pts.map(function (p) { return [p[0] + 3.5, p[1] + 1]; }), 0, 0.85, 0, 0.5, stone, { tex: tex });
    S.facet(pts, 5, 0, 0, 1, stone, { bevel: 2.4, tex: tex });
    function carveRot(ax, ay, bx, by, wd, d) {
      var p = rotPts([[ax, ay], [bx, by]], ox, oy, tilt);
      S.carve(p[0][0], p[0][1], p[1][0], p[1][1], wd, d);
    }
    if (opt.cross !== false) {
      carveRot(ox, oy - sh + sw * 0.25, ox, oy - sh * 0.4, 2.2, 2.6);
      carveRot(ox - sw * 0.2, oy - sh + sw * 0.5, ox + sw * 0.2, oy - sh + sw * 0.5, 2.2, 2.6);
    }
    carveRot(ox - sw * 0.28, oy - sh * 0.27, ox + sw * 0.28, oy - sh * 0.27, 1.1, 1.6);
    carveRot(ox - sw * 0.22, oy - sh * 0.18, ox + sw * 0.22, oy - sh * 0.18, 1.1, 1.6);
    S.ellipsoid(cx + 1, fy - 1, w * 0.44, 6.5, 12, dirt, { cutY: fy + 1, rz: 6, tex: noiseTex('default', 1.6, 2, r) });
    if (opt.moss) {
      var moss = M(opt.moss, { bump: 1.6, amb: 0.3 });
      for (var m = 0; m < 3; m++) S.ellipsoid(cx + range(r, -sw * 0.45, sw * 0.45), fy - range(r, 3, 7), range(r, 2.5, 5), range(r, 2, 3.5), 14, moss, { tex: noiseTex('default', 2, 2, r) });
    }
    S.render(g, { footY: fy, footAO: 10 });
  }

  /* ---- 骷髏堆：散骨（兩端有骨節的錐形管）＋兩三顆頭骨（頭蓋＋下顎＋凹陷的眼窩） ---- */
  function drawSkullPile(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 3, fy, w * 0.46, w * 0.13, 0.42);
    var S = sculpt(w, h);
    var bone = M(pal.bone, { bump: 0.7, amb: 0.34, shift: 18, hiLift: 0.72, cavity: 0.06 });
    var hole = M('#241a12', { amb: 0.18, bump: 0.2, hiLift: 0.1 });
    var grain = noiseTex('grain', 1.2, 0.8, r);
    function boneAt(x, y, len, ang, z) {
      var dx = Math.cos(ang) * len / 2, dy = Math.sin(ang) * len / 2;
      var px = -Math.sin(ang) * 1.3, py = Math.cos(ang) * 1.3;
      S.capsule(x - dx, y - dy, 1.5, x + dx, y + dy, 1.5, z, bone, { tex: grain });
      [-1, 1].forEach(function (sd) {
        S.ellipsoid(x + sd * dx + px, y + sd * dy + py, 2.1, 2.1, z + 0.5, bone, { tex: grain });
        S.ellipsoid(x + sd * dx - px, y + sd * dy - py, 2.1, 2.1, z + 0.5, bone, { tex: grain });
      });
    }
    function skullAt(x, y, s, z, turn) {
      S.ellipsoid(x, y - s * 0.3, s, s * 0.88, z, bone, { rz: s * 0.9, tex: grain });
      S.ellipsoid(x + turn * s * 0.12, y + s * 0.42, s * 0.62, s * 0.4, z + s * 0.25, bone, { rz: s * 0.45, tex: grain });
      S.ellipsoid(x - s * 0.36 + turn * s * 0.15, y - s * 0.02, s * 0.24, s * 0.26, z + s * 0.95, hole, { rz: 0.6 });
      S.ellipsoid(x + s * 0.36 + turn * s * 0.15, y - s * 0.02, s * 0.24, s * 0.26, z + s * 0.95, hole, { rz: 0.6 });
      S.ellipsoid(x + turn * s * 0.15, y + s * 0.3, s * 0.1, s * 0.13, z + s * 0.9, hole, { rz: 0.4 });
      for (var t = -2; t <= 2; t++) S.carve(x + turn * s * 0.12 + t * s * 0.13, y + s * 0.55, x + turn * s * 0.12 + t * s * 0.13, y + s * 0.75, 0.9, 1.4);
    }
    for (var b = 0; b < 6; b++) boneAt(cx + range(r, -w * 0.32, w * 0.32), fy - range(r, 2, 9), range(r, 12, 19), range(r, -0.7, 0.7), range(r, 0, 4));
    var s = w * 0.11;
    skullAt(cx - s * 1.2, fy - s * 1.0, s, 8, -1);
    skullAt(cx + s * 1.15, fy - s * 0.85, s * 0.9, 9, 1);
    if (r() < 0.7) skullAt(cx + range(r, -2, 2), fy - s * 2.25, s * 0.95, 4, range(r, -1, 1));
    S.render(g, { footY: fy, footAO: 8, inner: 0.5, zEdge: 2 });
  }

  /* ---- 蘑菇叢：莖（錐形管）＋菌傘（上半橢球）＋菌褶（傘下暗帶）＋斑點；深處的會自己發光 ---- */
  function drawMushrooms(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx, fy, w * 0.42, w * 0.1, 0.38);
    var halo = g.createRadialGradient(cx, fy - h * 0.35, 0, cx, fy - h * 0.35, w * 0.62);
    halo.addColorStop(0, rgba(pal.glow, 0.32)); halo.addColorStop(1, rgba(pal.glow, 0));
    g.fillStyle = halo; g.fillRect(0, 0, w, h);
    var S = sculpt(w, h);
    var stem = M(pal.stem, { bump: 0.6, amb: 0.36, shift: 14 });
    var cap = M(pal.cap, { bump: 0.7, amb: 0.32, spec: 0.25, shin: 16, emit: 0.1, emitColor: pal.glow, shift: 28 });
    var gill = M(shadeHex(pal.cap, -0.45), { amb: 0.25, bump: 1.4, emit: 0.05, emitColor: pal.glow });
    var spot = M(pal.spot || '#ffffff', { amb: 0.5, bump: 0.3, emit: 0.15, emitColor: pal.glow });
    var n = 2 + Math.floor(r() * 3);
    var list = [];
    for (var i = 0; i < n; i++) list.push({ x: cx + range(r, -w * 0.3, w * 0.3), hh: (fy - 6) * range(r, 0.3, 0.75), cw: w * range(r, 0.2, 0.34) });
    list.sort(function (a, b) { return b.hh - a.hh; });
    list.forEach(function (m, k) {
      var z = k * 6, capY = fy - m.hh;
      var bend = range(r, -3, 3);
      S.capsule(m.x, fy + 1, m.cw * 0.13, m.x + bend, capY + 1, m.cw * 0.1, z, stem, { tex: noiseTex('grain', 1.5, 0.8, r), cutY: fy + 1 });
      S.ellipsoid(m.x + bend, capY + m.cw * 0.06, m.cw * 0.56, m.cw * 0.14, z + 1, gill, { tex: noiseTex('bark', 2.5, 1.2, r) });
      S.ellipsoid(m.x + bend, capY, m.cw * 0.6, m.cw * 0.42, z + 3, cap, { cutY: capY + m.cw * 0.04, rz: m.cw * 0.4, tex: noiseTex('grain', 1.2, 0.8, r) });
      for (var sp = 0; sp < 4; sp++) {
        var sa = range(r, -0.75, 0.75), sx = m.x + bend + Math.sin(sa) * m.cw * 0.42, sy = capY - Math.cos(sa) * m.cw * 0.26 + 1;
        S.ellipsoid(sx, sy, range(r, 1, 2), range(r, 0.8, 1.5), z + 3 + m.cw * 0.35, spot, { rz: 0.8 });
      }
      S.glowDisc(m.x + bend, capY - m.cw * 0.1, m.cw * 0.5, m.cw * 0.3, 0.15);
    });
    S.render(g, { footY: fy, footAO: 8 });
  }

  /* ---- 蘆葦：細葉維持向量（雕塑的最小尺寸太粗），用深淺兩筆疊出圓柱感；穗是小錐形管 ---- */
  function drawReeds(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx, fy, w * 0.36, w * 0.08, 0.3);
    g.lineCap = 'round';
    var n = 11 + Math.floor(r() * 6);
    var heads = [];
    for (var i = 0; i < n; i++) {
      var x = cx + range(r, -w * 0.3, w * 0.3);
      var hh = (fy - 4) * range(r, 0.45, 0.95);
      var bend = range(r, -w * 0.18, w * 0.18);
      var k = range(r, -0.35, 0.1);
      var grad = g.createLinearGradient(0, fy, 0, fy - hh);
      grad.addColorStop(0, shade(pal.base, k - 0.35)); grad.addColorStop(1, shade(pal.base, k + 0.2));
      g.strokeStyle = grad;
      g.lineWidth = range(r, 1.6, 2.6);
      g.beginPath(); g.moveTo(x, fy); g.quadraticCurveTo(x + bend * 0.3, fy - hh * 0.6, x + bend, fy - hh); g.stroke();
      g.strokeStyle = rgba('#fff8d8', 0.18);
      g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(x - 0.5, fy - 2); g.quadraticCurveTo(x + bend * 0.3 - 0.5, fy - hh * 0.6, x + bend - 0.4, fy - hh); g.stroke();
      if (r() < 0.4) heads.push([x + bend * 0.95, fy - hh * 0.95, x + bend * 0.99, fy - hh * 0.78]);
    }
    if (heads.length) {
      var S = sculpt(w, h);
      var head = M(pal.head || '#5a3a20', { bump: 1, amb: 0.3 });
      heads.forEach(function (hd, j) { S.capsule(hd[0], hd[1], 1.8, hd[2], hd[3], 2.1, j, head, { tex: noiseTex('grain', 2, 1, r) }); });
      S.render(g, { footAO: 0 });
    }
  }

  /* ---- 樹樁：外皮有縱紋的短圓柱＋朝上的年輪截面＋趴地的根 ---- */
  function drawStump(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 3, fy, w * 0.46, w * 0.12, 0.42);
    var S = sculpt(w, h);
    var wood = M(pal.wood, { bump: 1.5, amb: 0.28, cavity: 0.06 });
    var ring = M(pal.ring || '#a08060', { bump: 0.8, amb: 0.4, shift: 14 });
    var sw = w * 0.3, top = fy - h * 0.48;
    var barkTex = { kind: 'bark', scale: 0.8, amp: 2, sx: 0.12, sy: 3, ox: r() * 256, oy: r() * 256 };
    [-1, 1, r() < 0.5 ? -0.3 : 0.35].forEach(function (k, i) {
      S.capsule(cx + k * sw * 0.5, fy - 5, sw * 0.32, cx + k * sw * range(r, 1.5, 1.9), fy + 1, sw * 0.14, sw + 2 + i, wood, { tex: barkTex, cutY: fy + 1 });
    });
    S.column(cx, top, fy + 1, sw, 0, wood, { tex: { kind: 'bark', scale: 0.9, amp: 2, sx: 3, sy: 0.15, ox: r() * 256, oy: r() * 256 }, taper: 0.14 });
    var rx = sw * 0.86, ry = sw * 0.34;
    S.facet(ellipsePts(cx, top, rx, ry, 18), sw + 1, UP_NX, UP_NY, UP_NZ, ring, { bevel: 1.5, tex: noiseTex('grain', 2, 0.6, r) });
    for (var k = 1; k <= 3; k++) {
      var pts = ellipsePts(cx + range(r, -1, 1), top, rx * k / 4, ry * k / 4, 14);
      for (var e = 0; e < pts.length; e++) {
        var p = pts[e], q = pts[(e + 1) % pts.length];
        S.carve(p[0], p[1], q[0], q[1], 0.7, 1.2);
      }
    }
    S.carve(cx, top, cx + rx * 0.7, top + ry * 0.4, 0.9, 2);   // 乾裂
    if (pal.moss) {
      var moss = M(pal.moss, { bump: 1.6, amb: 0.3 });
      for (var m = 0; m < 4; m++) S.ellipsoid(cx + range(r, -sw, sw), fy - range(r, 2, h * 0.25), range(r, 2.5, 5), range(r, 2, 4), sw + 3, moss, { tex: noiseTex('default', 2, 2, r) });
    }
    S.render(g, { footY: fy, footAO: 10 });
  }

  /* ---- 火盆：立柱式（圓底座＋漸細的柱身＋中段束環），上面一個寬口的半球碗，碗口一圈唇邊、裡面是發光的煤炭；
     火焰另外一張做序列幀動畫（碗口高度＝腳底上方 0.58 × 高，buildChunk 依此擺火焰） ---- */
  function drawBrazier(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 3, fy, w * 0.4, w * 0.11, 0.48);
    var S = sculpt(w, h);
    var metal = M(pal.metal, { spec: 0.5, shin: 16, amb: 0.28, bump: 0.7, shift: 18, cavity: 0.06 });
    var coal = M('#3a1a10', { amb: 0.25, bump: 1.5, emitColor: pal.fire2 || '#ffd27a' });
    var grain = noiseTex('grain', 1.6, 0.9, r);
    var bowlY = fy - h * 0.58, bw = w * 0.74;
    S.ellipsoid(cx, fy - 2, w * 0.34, 5.5, 0, metal, { cutY: fy + 0.5, rz: 5, tex: grain });
    S.ellipsoid(cx, fy - 6, w * 0.22, 4, 2, metal, { rz: 4, tex: grain });
    S.column(cx, bowlY + bw * 0.22, fy - 7, w * 0.085, 3, metal, { flutes: 3, taper: 0.25, tex: grain });
    S.ellipsoid(cx, (bowlY + fy) / 2 + 2, w * 0.13, 3, 7, metal, { rz: 3.5, tex: grain });
    S.ellipsoid(cx, bowlY + bw * 0.24, w * 0.12, 3, 7, metal, { rz: 3.5, tex: grain });
    S.ellipsoid(cx, bowlY, bw / 2, bw * 0.34, 9, metal, { cutAbove: bowlY, rz: bw * 0.3, tex: grain });
    S.facet(ellipsePts(cx, bowlY, bw / 2 - 1, bw * 0.13, 22), 12, UP_NX, UP_NY, UP_NZ, coal, { bevel: 1.2, tex: noiseTex('cell', 3, 2, r) });
    S.glowDisc(cx, bowlY, bw * 0.44, bw * 0.12, 0.95);
    // 碗口前緣的唇邊（沿橢圓下半圈的一串短管）
    var prev = null;
    for (var a = 0; a <= 12; a++) {
      var t = a / 12 * Math.PI, p = [cx + Math.cos(t) * bw / 2, bowlY + Math.sin(t) * bw * 0.14];
      if (prev) S.capsule(prev[0], prev[1], 1.6, p[0], p[1], 1.6, 14, metal, {});
      prev = p;
    }
    S.render(g, { footY: fy, footAO: 8, ao: 0.35 });
  }

  /* 火焰序列幀：雜訊驅動的火舌，frame 決定雜訊往上捲的相位（循環 FLAME_FRAMES 幀） */
  var FLAME_FRAMES = 6;
  function drawFlameFrame(g, w, h, r, pal, frame) {
    var cx = w / 2, by = h - 3;
    var glow = g.createRadialGradient(cx, by - h * 0.3, 0, cx, by - h * 0.3, w * 0.6);
    glow.addColorStop(0, rgba(pal.fire || '#ff8a2a', 0.32)); glow.addColorStop(1, rgba(pal.fire || '#ff8a2a', 0));
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    if (typeof DecorSculpt === 'undefined') return;
    var s = TEX_SCALE * 2, W = Math.ceil(w * s), H = Math.ceil(h * s);
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var cx2 = cv.getContext && cv.getContext('2d', { willReadFrequently: true });
    var img = cx2 && cx2.createImageData ? cx2.createImageData(W, H) : null;
    if (!img || !img.data) return;
    var d = img.data;
    var hot = hexRgb(pal.fire2 || '#ffd27a'), mid = hexRgb(pal.fire || '#ff6a1a');
    var ph = (frame || 0) / FLAME_FRAMES * 64;
    for (var py = 0; py < H; py++) {
      var ly = py / s, v = (by - ly) / (h * 0.92);
      if (v < 0 || v > 1.05) continue;
      for (var px = 0; px < W; px++) {
        var lx = px / s;
        var turb = (DecorSculpt.fbm(lx * 1.6 + 40, ly * 1.2 + ph) - 0.5) * 1.4 * v;
        var u = (lx - cx) / (w * 0.42) + turb;
        var width = Math.pow(Math.max(0, 1 - v), 0.7) * (0.85 + 0.25 * DecorSculpt.fbm(ly * 0.8 + ph * 0.5, 7));
        var I = (1 - Math.abs(u) / Math.max(0.05, width)) * (1.15 - v);
        I += (DecorSculpt.fbm(lx * 3 + 11, ly * 2.2 + ph * 1.6) - 0.5) * 0.5;
        if (I <= 0.05) continue;
        var o = (py * W + px) * 4, c;
        if (I > 0.8) { var t = Math.min(1, (I - 0.8) / 0.3); c = [hot[0] + (255 - hot[0]) * t, hot[1] + (250 - hot[1]) * t, hot[2] + (230 - hot[2]) * t]; }
        else if (I > 0.45) { var t2 = (I - 0.45) / 0.35; c = [mid[0] + (hot[0] - mid[0]) * t2, mid[1] + (hot[1] - mid[1]) * t2, mid[2] + (hot[2] - mid[2]) * t2]; }
        else { var t3 = I / 0.45; c = [mid[0] * (0.45 + 0.55 * t3), mid[1] * (0.3 + 0.7 * t3), mid[2] * (0.3 + 0.7 * t3)]; }
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2];
        d[o + 3] = Math.min(1, I * 1.8) * 255;
      }
    }
    cx2.putImageData(img, 0, 0);
    g.drawImage(cv, 0, 0, W, H, 0, 0, w, h);
  }
  // 舊介面（封魔塔祭壇 js/battle-arena.js 也在用）：第 0 幀
  function drawFlame(g, w, h, r, pal) { drawFlameFrame(g, w, h, r, pal, 0); }

  // 環境火獨立於火盆：多股熱氣柱疊成半透明密度，頂部與邊緣自然散去。
  var ENV_FIRE_FRAMES = 24;
  function drawEnvironmentFire(g,w,h,frame) {
    var scale=TEX_SCALE,W=Math.ceil(w*scale),H=Math.ceil(h*scale);
    var cv=document.createElement('canvas');cv.width=W;cv.height=H;
    var cg=cv.getContext('2d'),im=cg.createImageData?cg.createImageData(W,H):null;
    if(!im||!im.data)return;
    var pixels=im.data,phase=frame/ENV_FIRE_FRAMES*Math.PI*2;
    var plumes=[[-.29,.20,.72,1.2],[.04,.30,.96,0],[.31,.18,.64,3.4]];
    function smooth(a,b,x){var t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);}
    for(var py=0;py<H;py++){
      var v=(h-2-py/scale)/(h*.93);
      if(v<0||v>1.1)continue;
      var row=[];
      for(var p=0;p<plumes.length;p++){
        var plume=plumes[p],top=plume[2]+Math.sin(phase*2+plume[3])*.09,t=v/top;
        if(t<0||t>=1)continue;
        var center=plume[0]+Math.sin(v*8-phase*2+plume[3])*v*.24+Math.sin(v*18-phase*3+p)*v*.045;
        var radius=plume[1]*Math.pow(1-t,.64)*(1+.18*Math.sin(v*13-phase*3+p))+.009;
        row.push([center,radius,1-smooth(.7,1,t)]);
      }
      for(var px=0;px<W;px++){
        var u=(px/scale-w/2)/(w*.46),density=0;
        for(var j=0;j<row.length;j++){
          var dx=(u-row[j][0])/row[j][1];density+=Math.exp(-dx*dx*1.5)*row[j][2];
        }
        // 往上捲的明暗紋理與密度孔洞；時間皆為整數週期，尾幀回首幀不跳。
        var eddy=Math.sin(u*17+v*22-phase*4)*.12+Math.sin(u*31-v*13+phase*3)*.065;
        density=Math.max(0,density*(.86+eddy)-Math.max(0,eddy)*v*.35);
        var alpha=smooth(.035,.7,density)*(1-smooth(.6,1,v))*(.96-v*.28)*smooth(-.018,.035,v);
        if(alpha<.003)continue;
        var heat=Math.min(1,density*.76)*(1-v*.63),o=(py*W+px)*4;
        pixels[o]=255;
        pixels[o+1]=Math.round(42+Math.pow(heat,.85)*190);
        pixels[o+2]=Math.round(6+Math.pow(heat,2.4)*114);
        pixels[o+3]=Math.round(Math.min(1,alpha)*255);
      }
    }
    cg.putImageData(im,0,0);g.drawImage(cv,0,0,W,H,0,0,w,h);
    // 火星與火焰共用預烘圖集，不另建節點、Timer或執行期粒子。
    for(var ember=0;ember<4;ember++){
      var age=(frame/ENV_FIRE_FRAMES+ember*.243)%1,fade=Math.sin(age*Math.PI);
      var ex=w*.5+Math.sin(ember*2.7+age*5)*w*.24*age,ey=h-3-age*(h-7);
      var er=.7+ember%2*.35,glow=g.createRadialGradient(ex,ey,0,ex,ey,er*2.5);
      glow.addColorStop(0,'rgba(255,239,153,'+(fade*.95)+')');glow.addColorStop(.32,'rgba(255,166,50,'+(fade*.8)+')');glow.addColorStop(1,'rgba(255,90,12,0)');
      g.fillStyle=glow;g.fillRect(ex-er*2.5,ey-er*2.5,er*5,er*5);
    }
  }

  /* ---- 斷牆：一排排寬窄不一的斜角磚，色調略有差異；外形是參差的殘牆（中間高、兩端矮），上排缺磚，頂面露出厚度 ---- */
  function drawRuinWall(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 8, fy, w * 0.52, w * 0.1, 0.45);
    var S = sculpt(w, h);
    var tones = [M(pal.base, { bump: 1, amb: 0.3, cavity: 0.06 }), M(shadeHex(pal.base, 0.1), { bump: 1, amb: 0.3 }), M(shadeHex(pal.base, -0.14), { bump: 1, amb: 0.28 })];
    var tex = noiseTex('crack', 1, 1.2, r);
    var ww = w * 0.9, x0 = cx - ww / 2, rowH = 11;
    var maxRows = Math.max(2, Math.floor((fy - 10) / rowH));
    // 牆頂輪廓：幾個控制點內插，再加一點雜訊
    var prof = [];
    for (var c = 0; c <= 4; c++) prof.push(range(r, 0.3, 1) * (c === 0 || c === 4 ? 0.45 : 1));
    function rowsAt(x) {
      var t = (x - x0) / ww * 4, i = Math.max(0, Math.min(3, Math.floor(t))), f = t - i;
      return Math.max(1, Math.round((prof[i] + (prof[i + 1] - prof[i]) * f) * maxRows + range(r, -0.6, 0.6)));
    }
    for (var k = 0; k < maxRows; k++) {
      var xx = x0 - (k % 2 ? ww * 0.06 : 0);
      while (xx < x0 + ww - 4) {
        var bwid = Math.min(x0 + ww - xx, ww / 6 * range(r, 0.7, 1.3));
        var mid = xx + bwid / 2;
        var rows = rowsAt(mid);
        if (k < rows && !(k === rows - 1 && r() < 0.18)) {
          var y1 = fy - k * rowH, y0 = y1 - rowH + 1;
          var isTop = k === rows - 1;
          S.block(Math.max(x0, xx) + 0.6, y0 + range(r, -0.4, 0.4), xx + bwid - 0.6, y1, 6 + range(r, -1.4, 1.4), tones[Math.floor(r() * tones.length)],
            { bevel: 1.7, depth: isTop ? 5 : 0, skew: 2, tex: tex });
        }
        xx += bwid;
      }
    }
    if (pal.moss) {
      var moss = M(pal.moss, { bump: 1.6, amb: 0.3 });
      for (var m = 0; m < 6; m++) S.ellipsoid(x0 + range(r, 0, ww), fy - range(r, 2, 30), range(r, 3, 6), range(r, 2, 4), 9, moss, { tex: noiseTex('default', 2, 2, r) });
    }
    pebblesAt(S, r, cx, fy, ww * 0.5, 5, tones[0], 12);
    S.render(g, { footY: fy, footAO: 12, inner: 0.6, zEdge: 0.8 });
  }

  /* ---- 插在地上的劍：菱形斷面的劍身（左右兩個切面）、護手、纏帶劍柄、劍首；土堆 ---- */
  function drawSword(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 6, fy, w * 0.32, w * 0.08, 0.42);
    var S = sculpt(w, h);
    var steel = M('#a8b0ba', { spec: 0.8, shin: 24, amb: 0.3, bump: 0.5, shift: 20, hiLift: 0.8 });
    var gold = M(pal.metal || '#8a6a30', { spec: 0.6, shin: 16, amb: 0.3, bump: 0.5 });
    var grip = M('#3a2618', { bump: 1.6, amb: 0.28 });
    var dirt = M(pal.dirt || '#3a3028', { bump: 1.6, amb: 0.28 });
    var ang = range(r, -0.32, 0.32), ox = cx, oy = fy - 2;
    var L = (fy - 6) * 0.95, bwid = 4.2;
    var blade = function (pts, nx) { S.facet(rotPts(pts, ox, oy, ang), 4, nx, -0.05, 0.85, steel, { tex: noiseTex('grain', 2, 0.4, r) }); };
    blade([[ox - bwid, oy], [ox, oy], [ox, oy - L * 0.72], [ox - bwid, oy - L * 0.7]], -0.55);
    blade([[ox, oy], [ox + bwid, oy], [ox + bwid, oy - L * 0.7], [ox, oy - L * 0.72]], 0.55);
    var gp = rotPts([[ox - 12, oy - L * 0.74], [ox + 12, oy - L * 0.74], [ox, oy - L * 0.78], [ox, oy - L * 0.98], [ox, oy - L]], ox, oy, ang);
    S.capsule(gp[0][0], gp[0][1], 2.4, gp[1][0], gp[1][1], 2.4, 8, gold, {});
    S.capsule(gp[2][0], gp[2][1], 2.2, gp[3][0], gp[3][1], 2.2, 7, grip, { tex: { kind: 'strata', scale: 3, amp: 1.5, ox: 0, oy: 0 } });
    S.ellipsoid(gp[4][0], gp[4][1], 3.4, 3.4, 9, gold, {});
    S.ellipsoid(cx, fy - 1, 10, 4, 10, dirt, { cutY: fy + 1, rz: 4, tex: noiseTex('default', 2, 2, r) });
    S.render(g, { footY: fy, footAO: 4, ao: 0.3 });
  }

  /* ---- 戰旗：旗桿＋橫桿，旗面切成幾條直條、法線左右交錯做出布摺，下緣撕裂；紋章用向量蓋上 ---- */
  function drawBanner(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w * 0.35;
    shadowEllipse(g, cx + 6, fy, w * 0.32, w * 0.08, 0.42);
    var S = sculpt(w, h);
    var pole = M('#4a3424', { bump: 1.2, amb: 0.3 });
    var cloth = M(pal.cloth, { bump: 0.8, amb: 0.32, shift: 24 });
    var px2 = cx + range(r, -2, 2);
    S.capsule(cx, fy + 1, 2.2, px2, fy - h * 0.92, 1.8, 0, pole, { tex: noiseTex('bark', 0.8, 1.2, r), cutY: fy + 1 });
    var top = fy - h * 0.86, fw = w * 0.56, fh = h * 0.5;
    S.capsule(px2 - 3, top - 2, 1.6, px2 + fw + 3, top - 1, 1.6, 6, pole, {});
    var strips = 6;
    for (var i = 0; i < strips; i++) {
      var xa = px2 + 2 + fw * i / strips, xb = px2 + 2 + fw * (i + 1) / strips;
      var botA = top + fh - (i ? range(r, 0, 12) : 0), botB = top + fh - range(r, 0, 12);
      var sway = Math.sin(i * 1.3) * 2;
      S.facet([[xa, top], [xb, top], [xb + sway, botB], [xa + sway, botA]], 3 + (i % 2) * 1.5, (i % 2 ? 0.35 : -0.3), 0, 1, cloth, { tex: noiseTex('grain', 2, 0.6, r) });
    }
    S.render(g, { footY: fy, footAO: 4, inner: 0.25, zEdge: 1 });
    g.save();
    g.globalAlpha = 0.85;
    g.fillStyle = pal.emblem || '#d8b26a';
    var ex = px2 + 2 + fw * 0.5, ey = top + fh * 0.4, er = fw * 0.15;
    g.beginPath(); g.arc(ex, ey, er, 0, Math.PI * 2); g.fill();
    g.fillStyle = shade(pal.cloth, -0.3);
    g.beginPath(); g.moveTo(ex, ey - er * 0.7); g.lineTo(ex + er * 0.55, ey + er * 0.45); g.lineTo(ex - er * 0.55, ey + er * 0.45); g.closePath(); g.fill();
    g.restore();
  }

  var RUNE_GLYPHS = [
    [[0, 0, 0, 1], [0, 0.25, 0.6, 0], [0, 0.55, 0.6, 0.3]],
    [[0, 0, 0, 1], [0, 0, 0.6, 0.25], [0.6, 0.25, 0, 0.5], [0, 0.5, 0.6, 1]],
    [[0.3, 0, 0.3, 1], [0, 0.3, 0.6, 0.7]],
    [[0, 0, 0.6, 1], [0.6, 0, 0, 1]],
    [[0.3, 0, 0.3, 1], [0.3, 0.25, 0, 0.55], [0.3, 0.25, 0.6, 0.55]],
    [[0, 1, 0.3, 0], [0.3, 0, 0.6, 1], [0.12, 0.6, 0.48, 0.6]],
    [[0, 0, 0.6, 0.5], [0.6, 0.5, 0, 1], [0.6, 0, 0.6, 1]]
  ];
  /* ---- 符文石：尖頂石板（斜角邊）＋刻出的發光符文；外面再疊一層向量發光當泛光 ---- */
  function drawRuneStone(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 4, fy, w * 0.42, w * 0.11, 0.42);
    var halo = g.createRadialGradient(cx, fy - h * 0.45, 0, cx, fy - h * 0.45, w * 0.62);
    halo.addColorStop(0, rgba(pal.glow, 0.24)); halo.addColorStop(1, rgba(pal.glow, 0));
    g.fillStyle = halo; g.fillRect(0, 0, w, h);
    var S = sculpt(w, h);
    var stone = M(pal.base, { bump: 1.1, amb: 0.3, emitColor: pal.glow, cavity: 0.06 });
    var sw = w * 0.48, top = fy - h * 0.86;
    var pts = [[cx - sw / 2, fy + 1], [cx + sw / 2, fy + 1], [cx + sw * 0.44, top + 12], [cx + sw * 0.12, top + 1], [cx - sw * 0.1, top], [cx - sw * 0.42, top + 10]];
    var tex = noiseTex('crack', 1.3, 1.6, r);
    S.facet(pts.map(function (p) { return [p[0] + 3, p[1] + 1]; }), 0, 0.85, 0, 0.5, stone, { tex: tex });
    S.facet(pts, 5, 0, 0, 1, stone, { bevel: 3, tex: tex });
    // 符文：從一組自創的折線字形裡挑（不是任何真實文字），每個字形用 0～0.6 × 0～1 的單位座標描述
    var strokes = [];
    var rows = Math.max(3, Math.floor((fy - top - 26) / 15));
    var gs = Math.min(11, (fy - top - 26) / rows - 3);
    for (var k = 0; k < rows; k++) {
      var gy = top + 18 + k * ((fy - top - 26) / rows), gx = cx - gs * 0.3;
      RUNE_GLYPHS[Math.floor(r() * RUNE_GLYPHS.length)].forEach(function (st) {
        var a = [gx + st[0] * gs, gy + st[1] * gs], b = [gx + st[2] * gs, gy + st[3] * gs];
        S.carve(a[0], a[1], b[0], b[1], 1.7, 1.9, 1);
        strokes.push([a, b]);
      });
    }
    S.render(g, { footY: fy, footAO: 10 });
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.shadowColor = pal.glow; g.shadowBlur = 8;
    g.strokeStyle = rgba(pal.glow, 0.35); g.lineWidth = 1.2;
    strokes.forEach(function (l) { g.beginPath(); g.moveTo(l[0][0], l[0][1]); g.lineTo(l[1][0], l[1][1]); g.stroke(); });
    g.restore();
  }

  /* ---- 草叢：細葉向量（深色葉基、淺色葉尖），底下一小團陰影 ---- */
  function drawGrass(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx, fy, w * 0.32, w * 0.07, 0.25);
    g.lineCap = 'round';
    var n = 12 + Math.floor(r() * 8);
    for (var i = 0; i < n; i++) {
      var x = cx + range(r, -w * 0.3, w * 0.3);
      var hh = (fy - 2) * range(r, 0.3, 0.88);
      var bend = range(r, -w * 0.22, w * 0.22);
      var k = range(r, -0.25, 0.2);
      var grad = g.createLinearGradient(0, fy, 0, fy - hh);
      grad.addColorStop(0, shade(pal.base, k - 0.45)); grad.addColorStop(0.6, shade(pal.base, k)); grad.addColorStop(1, shade(pal.base, k + 0.28));
      g.strokeStyle = grad;
      g.lineWidth = range(r, 1.3, 2.3);
      g.beginPath(); g.moveTo(x, fy); g.quadraticCurveTo(x + bend * 0.2, fy - hh * 0.6, x + bend, fy - hh); g.stroke();
    }
  }

  /* ---- 陶甕：圓腹＋短頸＋唇口，腰上一道刻紋；有的已經破了一半 ---- */
  function drawUrn(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 3, fy, w * 0.4, w * 0.11, 0.42);
    var S = sculpt(w, h);
    var clay = M(pal.base, { bump: 0.7, amb: 0.3, spec: 0.15, shin: 16, shift: 22 });
    var hole = M('#1e140e', { amb: 0.2 });
    var tex = noiseTex('crack', 1.6, 1, r);
    var bodyR = w * 0.36, bodyY = fy - bodyR * 0.95;
    var broken = r() < 0.35;
    S.ellipsoid(cx, bodyY, bodyR, bodyR * 0.95, 0, clay, { cutY: fy, rz: bodyR * 0.9, tex: tex });
    if (!broken) {
      var neckTop = bodyY - bodyR * 1.25;
      S.column(cx, neckTop, bodyY - bodyR * 0.7, bodyR * 0.36, bodyR * 0.3, clay, { tex: tex });
      S.facet(ellipsePts(cx, neckTop, bodyR * 0.48, bodyR * 0.16, 16), bodyR * 0.55, UP_NX, UP_NY, UP_NZ, clay, { bevel: 1.5 });
      S.facet(ellipsePts(cx, neckTop + 0.5, bodyR * 0.28, bodyR * 0.08, 12), bodyR * 0.6, 0, 0, 1, hole, {});
    } else {
      S.facet([[cx - bodyR * 0.6, bodyY - bodyR * 0.3], [cx + bodyR * 0.2, bodyY - bodyR * 0.75], [cx + bodyR * 0.7, bodyY - bodyR * 0.2], [cx, bodyY + bodyR * 0.1]], bodyR + 2, 0, 0, 1, hole, {});
      pebblesAt(S, r, cx + bodyR, fy, bodyR * 0.6, 3, clay, bodyR + 4);
    }
    var by = bodyY - bodyR * 0.15;
    S.carve(cx - bodyR * 0.9, by, cx + bodyR * 0.9, by, 1.2, 1.6);
    S.render(g, { footY: fy, footAO: 8 });
  }

  /* ---- 碎石堆：大小岩塊堆成一座小丘，大的在下、小的在上（同一套低多邊形岩塊） ---- */
  function drawRubble(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 4, fy, w * 0.5, w * 0.13, 0.5);
    var S = sculpt(w, h);
    var rock = M(pal.base, { bump: 1, amb: 0.24, wrap: 0.1, hiLift: 0.5, cavity: 0.05 });
    var o = { bevel: 1, tex: noiseTex('default', 1.4, 1.1, r) };
    var n = 7 + Math.floor(r() * 5);
    for (var i = 0; i < n; i++) {
      var t = i / n;
      var bh = (fy - 4) * range(r, 0.22, 0.38) * (1.2 - t * 0.6);
      var spread = w * 0.38 * (1 - t * 0.6);
      var by = fy - t * (fy - 6) * 0.42;
      rockFacets(S, r, cx + range(r, -spread, spread), by, bh * range(r, 1.2, 1.7), bh, t * 30, rock, o);
    }
    S.render(g, { footY: fy, footAO: 10, inner: 0.5, zEdge: 0.6 });
  }

  /* ---- 地標（大型場景物件，偶爾出現） ---- */
  // 石拱門：兩根柱子撐一塊橫樑，一側可能崩落
  function drawArch(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 10, fy - 2, w * 0.52, w * 0.12, 0.5);
    var pw = w * 0.24, ph = h * 0.86;
    var broken = r() < 0.5;
    g.save(); g.translate(w * 0.06, 0); drawPillar(g, pw, h, r, pal, { intact: true, moss: pal.moss }); g.restore();
    g.save(); g.translate(w - pw - w * 0.06, 0);
    drawPillar(g, pw, h, r, pal, broken ? { moss: pal.moss } : { intact: true, moss: pal.moss });
    g.restore();
    var S = sculpt(w, h);
    var stone = M(pal.base, { bump: 1, amb: 0.3, cavity: 0.06 });
    var tex = noiseTex('crack', 1.1, 1.6, r);
    var ly = h - ph - FOOT - 4, lh = h * 0.1;
    var lx0 = w * 0.03, lx1 = broken ? w * 0.66 : w * 0.97;
    S.block(lx0, ly - lh, lx1, ly, 20, stone, { bevel: 2, depth: 6, tex: tex });
    for (var k = 1; k < 6; k++) {
      var x = lx0 + (lx1 - lx0) * k / 6;
      S.carve(x, ly - lh + 3, x, ly - 3, 1, 1.5);
    }
    if (broken) {
      var bp = rotPts([[w * 0.68, fy - lh - 2], [w * 0.92, fy - lh - 2], [w * 0.92, fy - 2], [w * 0.68, fy - 2]], w * 0.8, fy - 6, 0.18);
      S.facet(bp, 26, 0, 0, 1, stone, { bevel: 2, tex: tex });
      pebblesAt(S, r, w * 0.75, fy, w * 0.12, 5, stone, 30);
    }
    S.render(g, { footY: fy, footAO: 0 });
  }

  /* 巨獸骸骨：側躺的骨架。脊椎是一道拱起的弧（尾端貼地、肩部最高），肋骨從脊椎垂下、向前彎再落到地面；
     後側肋骨較暗、往左錯開，前後兩排才看得出是一副胸腔。頭骨貼地、張著下顎，頂上一支彎角。 */
  function drawGiantBones(g, w, h, r, pal) {
    var fy = h - FOOT;
    shadowEllipse(g, w * 0.5, fy - 2, w * 0.5, w * 0.1, 0.45);
    var S = sculpt(w, h);
    var bone = M(pal.bone, { bump: 0.9, amb: 0.33, shift: 20, hiLift: 0.68, cavity: 0.06 });
    var hole = M('#1e1610', { amb: 0.18 });
    var grain = noiseTex('crack', 1.1, 0.9, r);
    function bez(p0, p1, p2, p3, t) {
      var u = 1 - t;
      return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
    }
    function boneCurve(p0, p1, p2, p3, n, r0, r1, z, mat) {
      var prev = p0;
      for (var i = 1; i <= n; i++) {
        var t = i / n, p = bez(p0, p1, p2, p3, t);
        S.capsule(prev[0], prev[1], r0 + (r1 - r0) * (t - 1 / n), p[0], p[1], r0 + (r1 - r0) * t, z, mat || bone, { tex: grain });
        prev = p;
      }
    }
    // 脊椎曲線：尾端（左）貼地 → 肩部最高 → 頸部往右下接頭骨
    var sp0 = [w * 0.04, fy - 6], sp1 = [w * 0.24, fy - h * 0.5], sp2 = [w * 0.5, fy - h * 0.78], sp3 = [w * 0.74, fy - h * 0.3];
    var ribs = 7;
    // 後排肋骨（先畫、z 低、顏色暗一點）
    var backBone = M(shadeHex(pal.bone, -0.2), { bump: 0.9, amb: 0.3, shift: 20, hiLift: 0.5 });
    for (var k = 0; k < ribs; k++) {
      var t = 0.25 + k / (ribs - 1) * 0.55;
      var b0 = bez(sp0, sp1, sp2, sp3, t);
      var len = (fy - b0[1]) * range(r, 0.92, 1.02);
      var reach = w * 0.045 * (1 - Math.abs(t - 0.55));
      boneCurve([b0[0] - 3, b0[1]], [b0[0] - reach * 1.4, b0[1] + len * 0.2], [b0[0] - reach * 1.8, b0[1] + len * 0.75], [b0[0] - reach * 0.9 - 4, fy - 3], 6, 3, 1.8, -8, backBone);
    }
    // 脊椎：一節節椎骨＋朝上的棘突
    var verts = 16;
    for (var v = 0; v <= verts; v++) {
      var tv = v / verts, p = bez(sp0, sp1, sp2, sp3, tv);
      var vs = 3.2 + 3.2 * Math.sin(tv * Math.PI);
      S.ellipsoid(p[0], p[1], vs * 1.05, vs * 0.85, 4, bone, { tex: grain });
      if (v % 2 === 0 && tv > 0.1 && tv < 0.9) S.capsule(p[0], p[1] - vs * 0.6, vs * 0.4, p[0] - 2, p[1] - vs * 2.2, vs * 0.22, 3, bone, { tex: grain });
    }
    // 前排肋骨：從脊椎垂下、往前（右下）彎、落地
    for (var k2 = 0; k2 < ribs; k2++) {
      var t2 = 0.25 + k2 / (ribs - 1) * 0.55;
      var a0 = bez(sp0, sp1, sp2, sp3, t2);
      var len2 = (fy - a0[1]) * range(r, 0.95, 1.05);
      var reach2 = w * 0.06 * (1.1 - Math.abs(t2 - 0.55));
      var broken = r() < 0.18;
      var end = broken ? [a0[0] + reach2 * 1.6, a0[1] + len2 * 0.55] : [a0[0] + reach2 * 0.8 + 3, fy - 3];
      boneCurve([a0[0] + 2, a0[1] + 2], [a0[0] + reach2 * 1.3, a0[1] + len2 * 0.12], [a0[0] + reach2 * 1.9, a0[1] + len2 * (broken ? 0.4 : 0.7)], end, 7, 3.6, 2, 10);
    }
    // 頭骨：貼地、吻部朝右；下顎張開，眼窩與鼻孔凹陷
    var hx = w * 0.8, hy = fy - h * 0.15, hs = Math.min(h * 0.2, w * 0.09);
    S.ellipsoid(hx + hs * 0.9, fy - hs * 0.28, hs * 0.85, hs * 0.26, 14, bone, { rz: hs * 0.3, tex: grain, cutY: fy });
    S.ellipsoid(hx, hy, hs * 1.05, hs * 0.78, 16, bone, { rz: hs * 0.75, tex: grain });
    S.ellipsoid(hx + hs * 0.95, hy + hs * 0.08, hs * 0.85, hs * 0.42, 18, bone, { rz: hs * 0.45, tex: grain });
    S.ellipsoid(hx + hs * 0.08, hy - hs * 0.12, hs * 0.24, hs * 0.2, 16 + hs * 0.74, hole, { rz: 0.6 });
    S.ellipsoid(hx + hs * 1.55, hy - hs * 0.02, hs * 0.09, hs * 0.08, 18 + hs * 0.44, hole, { rz: 0.4 });
    for (var tt = 0; tt < 4; tt++) S.capsule(hx + hs * (0.6 + tt * 0.28), hy + hs * 0.42, 1.2, hx + hs * (0.62 + tt * 0.28), hy + hs * 0.62, 0.8, 19, bone, {});
    boneCurve([hx - hs * 0.3, hy - hs * 0.55], [hx - hs * 1.3, hy - hs * 1.5], [hx - hs * 0.4, hy - hs * 2.6], [hx + hs * 0.5, hy - hs * 2.4], 9, hs * 0.26, hs * 0.06, 20);
    S.render(g, { footY: fy, footAO: 14, inner: 0.55, zEdge: 2 });
  }

  /* ============ 地面裝飾（俯視畫，地面平面容器會縱向壓成 GROUND_Y_SCALE） ============
     色塊／積雪改用雜訊門檻的有機形狀（邊緣是破碎的，不是圓形光暈）；碎石、骨頭、石板改用浮雕（俯視、同一個光向）。 */
  function decalPatch(g, w, h, r, pal) {
    var a = pal.alpha || 0.14;
    DecorSculpt.patch(g, w, h, 0.45, {
      color: pal.color, color2: shadeHex(pal.color, a > 0.15 ? -0.35 : 0.18),
      alpha: Math.min(0.85, a * 3.4), noiseScale: 300 / w, ox: r() * 256, oy: r() * 256, threshold: 0.45, soft: 0.13
    });
    // 細碎顆粒，讓色塊不是平的
    for (var k = 0; k < w * 0.8; k++) {
      var a2 = r() * Math.PI * 2, d2 = Math.sqrt(r()) * w * 0.38;
      g.fillStyle = rgba(r() < 0.5 ? '#000000' : (pal.grain || '#ffffff'), 0.06 + r() * 0.07);
      var s = 1 + r() * 2;
      g.fillRect(w / 2 + Math.cos(a2) * d2, h / 2 + Math.sin(a2) * d2, s, s);
    }
  }
  function decalCrack(g, w, h, r, pal) {
    var cx = w / 2, cy = h / 2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    var segs = [];
    function grow(x, y, ang, len, width, depth) {
      var pts = [[x, y]];
      var n = 4 + Math.floor(r() * 3);
      for (var i = 0; i < n; i++) {
        ang += range(r, -0.5, 0.5);
        x += Math.cos(ang) * len / n; y += Math.sin(ang) * len / n;
        pts.push([x, y]);
        if (depth > 0 && r() < 0.35) grow(x, y, ang + range(r, -1.2, 1.2), len * 0.5, width * 0.6, depth - 1);
      }
      segs.push({ pts: pts, width: width });
    }
    var arms = 2 + Math.floor(r() * 2);
    for (var a = 0; a < arms; a++) grow(cx, cy, a / arms * Math.PI * 2 + range(r, -0.4, 0.4), w * range(r, 0.3, 0.45), range(r, 3, 5), 2);
    function strokeAll(col, extra, blur) {
      g.save();
      if (blur) { g.shadowColor = col; g.shadowBlur = blur; }
      g.strokeStyle = col;
      segs.forEach(function (s) {
        g.lineWidth = Math.max(0.6, s.width + extra);
        g.beginPath(); g.moveTo(s.pts[0][0], s.pts[0][1]);
        for (var i = 1; i < s.pts.length; i++) g.lineTo(s.pts[i][0], s.pts[i][1]);
        g.stroke();
      });
      g.restore();
    }
    // 地板紋路只保留暗色刻痕，避免亮色分岔看似電絲或散落枝條。
    strokeAll('rgba(8,8,10,0.64)', 0);
  }

  // 碎石：幾顆切面小石頭（浮雕），各自帶一點往右下的落影
  function decalPebbles(g, w, h, r, pal) {
    var S = sculpt(w, h, DECAL_SCALE);
    var m = M(pal.color, { bump: 0.9, amb: 0.3, cavity: 0.05 });
    var n = 7 + Math.floor(r() * 8);
    g.fillStyle = 'rgba(0,0,0,0.32)';
    for (var i = 0; i < n; i++) {
      var x = w / 2 + range(r, -w * 0.38, w * 0.38), y = h / 2 + range(r, -h * 0.38, h * 0.38);
      var s = range(r, 2.4, 6.5), sx = s * range(r, 1, 1.45);
      g.beginPath(); g.ellipse(x + 1.8, y + 1.8, sx, s, 0, 0, Math.PI * 2); g.fill();
      S.ellipsoid(x, y, sx, s, i * 0.1, m, { rz: s * 0.75, facet: 0.55, facetScale: 4.5, fox: r() * 256, foy: r() * 256, tex: noiseTex('default', 2, 1, r) });
    }
    S.render(g, { footAO: 0, ao: 0.25 });
  }

  // 散骨：兩端帶骨節的長骨，偶爾一顆頭骨（浮雕）
  function decalBones(g, w, h, r, pal) {
    var S = sculpt(w, h, DECAL_SCALE);
    var bone = M(pal.color, { bump: 0.7, amb: 0.34, shift: 18, hiLift: 0.7 });
    var hole = M('#1e1610', { amb: 0.18 });
    var n = 3 + Math.floor(r() * 4);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    for (var i = 0; i < n; i++) {
      var x = w / 2 + range(r, -w * 0.33, w * 0.33), y = h / 2 + range(r, -h * 0.33, h * 0.33);
      var len = range(r, 14, 26), ang = r() * Math.PI;
      var dx = Math.cos(ang) * len / 2, dy = Math.sin(ang) * len / 2;
      var px = -Math.sin(ang) * 1.5, py = Math.cos(ang) * 1.5;
      g.save(); g.translate(x + 2, y + 2); g.rotate(ang); g.fillRect(-len / 2, -2.5, len, 5); g.restore();
      S.capsule(x - dx, y - dy, 1.8, x + dx, y + dy, 1.8, i, bone, { tex: noiseTex('grain', 1.5, 0.8, r) });
      [-1, 1].forEach(function (sd) {
        S.ellipsoid(x + sd * dx + px, y + sd * dy + py, 2.5, 2.5, i + 0.5, bone, {});
        S.ellipsoid(x + sd * dx - px, y + sd * dy - py, 2.5, 2.5, i + 0.5, bone, {});
      });
    }
    if (r() < 0.6) {
      var sx = w / 2 + range(r, -w * 0.2, w * 0.2), sy = h / 2 + range(r, -h * 0.2, h * 0.2);
      g.beginPath(); g.ellipse(sx + 2.5, sy + 2.5, 10, 12, 0, 0, Math.PI * 2); g.fill();
      S.ellipsoid(sx, sy, 10, 12, 20, bone, { rz: 9, tex: noiseTex('grain', 1.5, 0.8, r) });
      S.ellipsoid(sx - 4, sy + 1.5, 3, 3.4, 29.5, hole, { rz: 0.5 });
      S.ellipsoid(sx + 4, sy + 1.5, 3, 3.4, 29.5, hole, { rz: 0.5 });
    }
    S.render(g, { footAO: 0, ao: 0.25 });
  }

  // 凍土上的薄冰：岸線由碎霜漸散，不用完整亮框把冰面圈成獨立物件。
  function decalFrozenPuddle(g, w, h, r, pal) {
    var cx = w / 2, cy = h / 2;
    var pts = blob(cx, cy, w * 0.35, h * 0.30, 28, 0.32, r);
    g.save();
    g.lineJoin = 'round';
    // 先鋪低對比的凍土過渡，再疊內部冰色；外緣保留地板紋理。
    [0.12, 0.16, 0.20].forEach(function (alpha, i) {
      pathSmooth(g, pts);
      g.strokeStyle = rgba('#3e5362', alpha);
      g.lineWidth = w * (0.10 - i * 0.03); g.stroke();
    });
    pathSmooth(g, pts);
    var gr = g.createLinearGradient(cx, h * 0.2, cx, h * 0.8);
    gr.addColorStop(0, rgba(pal.color, 0.24));
    gr.addColorStop(0.5, rgba('#426379', 0.48));
    gr.addColorStop(1, rgba('#273f50', 0.35));
    g.fillStyle = gr; g.fill();
    g.save(); pathSmooth(g, pts); g.clip();
    // 霧化冰紋與短裂隙，避免橫跨整面的玻璃反光。
    speckle(g, r, w * 0.1, h * 0.1, w * 0.8, h * 0.8, 150, 'rgba(173,199,210,0.13)', 1.2);
    for (var i = 0; i < 4; i++) {
      var x = w * range(r, 0.28, 0.70), y = h * range(r, 0.30, 0.68);
      var dx = w * range(r, 0.04, 0.10), dy = h * range(r, -0.05, 0.05);
      g.strokeStyle = 'rgba(160,190,205,0.16)'; g.lineWidth = 0.65;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx * 0.45, y + dy);
      g.lineTo(x + dx, y + dy * 0.6); g.stroke();
    }
    g.restore();
    // 取平滑岸線上的點，讓斷續霜粒跨過內外兩側，保持缺口與深淺變化。
    for (var j = 0; j < pts.length; j++) {
      var prev = pts[(j + pts.length - 1) % pts.length], p = pts[j], next = pts[(j + 1) % pts.length];
      var bx = (prev[0] + p[0] * 6 + next[0]) / 8, by = (prev[1] + p[1] * 6 + next[1]) / 8;
      if (r() < 0.25) continue;
      for (var k = 0; k < 7; k++) {
        var spread = w * range(r, 0.015, 0.05);
        var sx = bx + range(r, -spread, spread), sy = by + range(r, -spread, spread);
        var size = range(r, 0.45, 1.7);
        g.fillStyle = pick(r, ['rgba(161,187,201,0.28)', 'rgba(200,216,222,0.24)', 'rgba(78,101,117,0.38)']);
        g.beginPath(); g.ellipse(sx, sy, size * 1.5, size, r() * Math.PI, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
  }

  function decalPuddle(g, w, h, r, pal) {
    if (pal.frozen) { decalFrozenPuddle(g, w, h, r, pal); return; }
    var pts = blob(w / 2, h / 2, w * 0.38, h * 0.32, 12, 0.18, r);
    pathSmooth(g, pts);
    var gr = g.createRadialGradient(w * 0.45, h * 0.42, 0, w / 2, h / 2, w * 0.42);
    gr.addColorStop(0, rgba(pal.color, 0.85));
    gr.addColorStop(0.8, shadeRgba(pal.color, -0.4, 0.85));
    gr.addColorStop(1, rgba(pal.color, 0.4));
    g.fillStyle = gr; g.fill();
    g.save(); pathSmooth(g, pts); g.clip();
    g.strokeStyle = rgba('#ffffff', 0.18); g.lineWidth = 2;
    for (var i = 0; i < 3; i++) {
      var y = h * range(r, 0.3, 0.7);
      g.beginPath(); g.moveTo(w * 0.2, y); g.quadraticCurveTo(w * 0.5, y - 4, w * 0.8, y); g.stroke();
    }
    g.restore();
    pathSmooth(g, pts);
    g.strokeStyle = rgba(pal.rim || '#000000', 0.5); g.lineWidth = 3; g.stroke();
    g.strokeStyle = rgba('#ffffff', 0.12); g.lineWidth = 1; g.stroke();
  }

  function decalRunes(g, w, h, r, pal) {
    var cx = w / 2, cy = h / 2, R = w * 0.42;
    g.save();
    g.shadowColor = pal.glow; g.shadowBlur = 10;
    g.strokeStyle = rgba(pal.glow, 0.55);
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.4;
    g.beginPath(); g.arc(cx, cy, R * 0.8, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(cx, cy, R * 0.32, 0, Math.PI * 2); g.stroke();
    var n = 12;
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2;
      var x = cx + Math.cos(a) * R * 0.9, y = cy + Math.sin(a) * R * 0.9;
      g.save(); g.translate(x, y); g.rotate(a + Math.PI / 2);
      g.beginPath(); g.moveTo(-3, -3); g.lineTo(3, 0); g.lineTo(-3, 3); if (i % 2) { g.moveTo(0, -4); g.lineTo(0, 4); } g.stroke();
      g.restore();
    }
    for (var k = 0; k < 3; k++) {
      var a2 = k / 3 * Math.PI * 2 - Math.PI / 2;
      g.beginPath(); g.moveTo(cx + Math.cos(a2) * R * 0.32, cy + Math.sin(a2) * R * 0.32); g.lineTo(cx + Math.cos(a2) * R * 0.8, cy + Math.sin(a2) * R * 0.8); g.stroke();
    }
    g.restore();
  }

  // 殘破石板地：不規則的斜角石板（浮雕），越往外缺得越多，偶有裂紋
  function decalTiles(g, w, h, r, pal) {
    var S = sculpt(w, h, DECAL_SCALE);
    var tones = [M(pal.color, { bump: 1, amb: 0.3, cavity: 0.06 }), M(shadeHex(pal.color, -0.12), { bump: 1, amb: 0.3 }), M(shadeHex(pal.color, 0.1), { bump: 1, amb: 0.3 })];
    var tex = noiseTex('crack', 1.2, 1.2, r);
    var cell = 34, cx = w / 2, cy = h / 2;
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (var y = 0; y < h; y += cell) {
      var rowOff = (Math.floor(y / cell) % 2) * cell * 0.5;
      for (var x = -cell; x < w; x += cell) {
        var x0 = x + rowOff, x1 = x0 + cell;
        var d = Math.hypot((x0 + x1) / 2 - cx, y + cell / 2 - cy) / (w * 0.47);
        if (d > 1 || r() < d * d * 0.9 + 0.06) continue;   // 外圈缺磚多
        var j = function () { return range(r, -2, 2); };
        var pts = [[x0 + 1.5 + j(), y + 1.5 + j()], [x1 - 1.5 + j(), y + 1.5 + j()], [x1 - 1.5 + j(), y + cell - 1.5 + j()], [x0 + 1.5 + j(), y + cell - 1.5 + j()]];
        g.beginPath(); g.moveTo(pts[0][0] + 2, pts[0][1] + 2);
        for (var p = 1; p < 4; p++) g.lineTo(pts[p][0] + 2, pts[p][1] + 2);
        g.closePath(); g.fill();
        S.facet(pts, range(r, -1, 1), range(r, -0.08, 0.08), range(r, -0.08, 0.08), 1, tones[Math.floor(r() * 3)], { bevel: 2.2, tex: tex });
        if (r() < 0.25) S.carve(x0 + range(r, 4, cell * 0.4), y + range(r, 4, cell - 4), x0 + range(r, cell * 0.6, cell - 4), y + range(r, 4, cell - 4), 1, 1.8);
      }
    }
    S.render(g, { footAO: 0, ao: 0.4, inner: 0.4, zEdge: 0.8 });
  }

  function decalLight(g, w, h, r, pal) {
    var gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, rgba(pal.color, 0.55));
    gr.addColorStop(0.4, rgba(pal.color, 0.22));
    gr.addColorStop(1, rgba(pal.color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }

  // 積雪：雜訊門檻的雪堆（邊緣破碎），上面撒幾顆亮點
  function decalSnow(g, w, h, r, pal) {
    DecorSculpt.patch(g, w, h, 0.45, {
      color: pal.color, color2: '#ffffff', alpha: 0.55, noiseScale: 300 / w, ox: r() * 256, oy: r() * 256, threshold: 0.5, soft: 0.1
    });
    for (var k = 0; k < 60; k++) {
      g.fillStyle = rgba('#ffffff', 0.18 + r() * 0.2);
      g.fillRect(w / 2 + range(r, -w * 0.3, w * 0.3), h / 2 + range(r, -h * 0.3, h * 0.3), 1.5, 1.5);
    }
  }

  /* ============ 粒子貼圖 ============
     全部是白色（執行期用 tint 上色），依用途分形狀：
     dot 軟圓點（飄沙）、fog 霧團、glow 亮核＋大光暈（螢火蟲、幽魂）、streak 拉長的火星（餘燼，沿速度方向轉）、
     flake 雪花（軟圓＋六芒細線）、spark 四芒星（魔力微粒，閃爍時縮放）、ray 斜射的光柱（聖域）。 */
  function particleDot(g, w, h) {
    var gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
  function particleFog(g, w, h, r) {
    // 在獨立畫布套柔邊，避免 destination-in 清掉圖集內的其他素材。
    var c = document.createElement('canvas');
    c.width = Math.ceil(w * TEX_SCALE); c.height = Math.ceil(h * TEX_SCALE);
    var fog = c.getContext('2d');
    fog.scale(TEX_SCALE, TEX_SCALE);
    for (var i = 0; i < 14; i++) {
      var x = w / 2 + range(r, -w * 0.28, w * 0.28), y = h / 2 + range(r, -h * 0.2, h * 0.2);
      var rad = w * range(r, 0.15, 0.3);
      var gr = fog.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.22)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      fog.fillStyle = gr;
      fog.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // 橢圓外圈以 smoothstep 淡至零，並留透明邊，放大取樣也不會露出裁切框。
    fog.save();
    fog.translate(w / 2, h / 2);
    fog.scale(w / 2 - 2, h / 2 - 2);
    var edge = fog.createRadialGradient(0, 0, 0, 0, 0, 1);
    edge.addColorStop(0, 'rgba(255,255,255,1)');
    for (var j = 0; j <= 16; j++) {
      var t = j / 16, a = 1 - t * t * (3 - 2 * t);
      edge.addColorStop(0.55 + 0.45 * t, 'rgba(255,255,255,' + a + ')');
    }
    fog.globalCompositeOperation = 'destination-in';
    fog.fillStyle = edge;
    fog.fillRect(-2, -2, 4, 4);
    fog.restore();
    g.drawImage(c, 0, 0, w, h);
  }
  function particleGlow(g, w, h) {
    var gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.1, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.22, 'rgba(255,255,255,0.45)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
  function particleStreak(g, w, h) {
    g.save();
    g.translate(w / 2, h / 2);
    g.scale(1, h / w);
    var gr = g.createRadialGradient(w * 0.18, 0, 0, 0, 0, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.25)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, 0, w / 2, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  function particleFlake(g, w, h) {
    var cx = w / 2, cy = h / 2;
    var gr = g.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.3, 'rgba(255,255,255,0.75)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.lineWidth = 0.7;
    for (var i = 0; i < 3; i++) {
      var a = i / 3 * Math.PI;
      g.beginPath(); g.moveTo(cx - Math.cos(a) * w * 0.45, cy - Math.sin(a) * w * 0.45); g.lineTo(cx + Math.cos(a) * w * 0.45, cy + Math.sin(a) * w * 0.45); g.stroke();
    }
  }
  function particleSpark(g, w, h) {
    var cx = w / 2, cy = h / 2;
    var gr = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.3);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    [[w * 0.5, w * 0.06], [w * 0.06, w * 0.5]].forEach(function (d) {
      g.beginPath();
      g.moveTo(cx - d[0], cy); g.lineTo(cx, cy - d[1]); g.lineTo(cx + d[0], cy); g.lineTo(cx, cy + d[1]);
      g.closePath(); g.fill();
    });
  }
  function particleRay(g, w, h) {
    var gx = g.createLinearGradient(0, 0, w, 0);
    gx.addColorStop(0, 'rgba(255,255,255,0)');
    gx.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    gx.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gx;
    g.fillRect(0, 0, w, h);
    // 上下兩端淡出：用 destination-in 乘上縱向遮罩
    g.save();
    g.globalCompositeOperation = 'destination-in';
    var gy = g.createLinearGradient(0, 0, 0, h);
    gy.addColorStop(0, 'rgba(0,0,0,0)');
    gy.addColorStop(0.25, 'rgba(0,0,0,1)');
    gy.addColorStop(0.7, 'rgba(0,0,0,0.8)');
    gy.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gy;
    g.fillRect(0, 0, w, h);
    g.restore();
  }
  // [名稱, 寬, 高, 種子]（邏輯像素）
  function particleRipple(g,w,h) {
    g.strokeStyle='rgba(225,245,224,.85)';g.lineWidth=1.4;g.beginPath();g.ellipse(w/2,h/2,w*.4,h*.3,0,0,Math.PI*2);g.stroke();
  }
  function particlePetal(g,w,h) {
    var gr=g.createLinearGradient(0,0,w,h);gr.addColorStop(0,'#fff9ea');gr.addColorStop(1,'#cba5b2');
    g.fillStyle=gr;g.beginPath();g.ellipse(w/2,h/2,w*.28,h*.42,.5,0,Math.PI*2);g.fill();
  }
  var PARTICLE_SPECS = [['dot',16,16,1],['fog',200,120,2],['glow',32,32,3],['streak',36,10,4],['flake',16,16,5],['spark',24,24,6],['ray',64,256,7],['ripple',48,24,8],['petal',16,16,9]];
  var PARTICLE_DRAW = {skyVeil:particleSkyVeil,skyRiver:particleSkyRiver,divineOrbit:particleDivineOrbit,dot:particleDot,fog:particleFog,glow:particleGlow,streak:particleStreak,flake:particleFlake,spark:particleSpark,ray:particleRay,ripple:particleRipple,petal:particlePetal};
  var PARTICLE_W = {};
  PARTICLE_SPECS.forEach(function (p) { PARTICLE_W[p[0]] = p[1]; });

  /* ============ 各地圖的組合 ============
     props：[種類, 權重, 寬, 高, 調色, 選項]；decals：[種類, 權重, 尺寸, 調色]
     deep：地下版（每 10 階段一帶，雙數帶）——地面加暗、換一批擺件、光源多 */
  var SAND = { light: '#c8a87e', base: '#8a6c4c', dark: '#34261a', hi: '#ffe8c8', strata: true };
  var DARKSTONE = { light: '#8a8a94', base: '#55555e', dark: '#1e1e24' };
  var ICEROCK = { light: '#c8dcec', base: '#6e8aa4', dark: '#24364a', hi: '#ffffff' };
  var MOSSROCK = { light: '#7a8a6a', base: '#4a5640', dark: '#1a2216' };
  var MARBLE = { light: '#f4efe4', base: '#c9c1b0', dark: '#6e6658', hi: '#ffffff', shift: 14 };
  var CHAOSROCK = { light: '#6a5a7a', base: '#3a2e48', dark: '#120c1a' };
  var ASH = { light: '#7a6a62', base: '#4a3e38', dark: '#1a1412' };
  // 尖岩（spire）：smooth＝冰／晶質（切面明顯、無層理）
  var SAND_SPIRE = { base: '#9a7a54' };
  var ICE_SPIRE = { base: '#9ccbea', spec: 0.6, smooth: true, amb: 0.4, shift: 18 };
  var ICE_SPIRE_GLOW = { base: '#7ab8e8', glow: '#7ad0ff', spec: 0.7, smooth: true, amb: 0.4, shift: 18 };
  var DARK_SPIRE = { base: '#565260' };
  var CHAOS_SPIRE = { base: '#6a3a8a', glow: '#d070ff', spec: 0.45, smooth: true, amb: 0.34, shift: 26 };

  /* 新地貌的原創浮雕。共用材質打光，但輪廓／結構各自製作；不借用舊圖的本體貼圖。 */
  function drawFanFern(g,w,h,r,pal) {
    var fy=h-FOOT,cx=w/2;
    shadowEllipse(g,cx,fy,w*.4,w*.09,.3);
    for(var i=0;i<11;i++) {
      var a=-Math.PI*.95+i/10*Math.PI*.9,len=h*range(r,.55,.95),ex=cx+Math.cos(a)*w*.46,ey=fy+Math.sin(a)*len;
      g.strokeStyle='#72937a';g.lineWidth=1.3;g.beginPath();g.moveTo(cx,fy);g.quadraticCurveTo(cx,ey,ex,ey);g.stroke();
      for(var j=1;j<9;j++) {
        var t=j/9,x=lerp(cx,ex,t*t),y=lerp(fy,ey,2*t-t*t),s=Math.sin(t*Math.PI)*w*.09;
        for(var k=-1;k<=1;k+=2){g.fillStyle=k<0?'#345f51':'#6a9270';g.beginPath();g.moveTo(x,y+2);g.quadraticCurveTo(x+k*s,y-5,x+k*s*.9,y-8);g.quadraticCurveTo(x+k*s*.4,y-5,x,y);g.fill();}
      }
    }
  }
  function drawBasalt(g,w,h,r,pal) {
    var S=sculpt(w,h),fy=h-FOOT,stone=M(pal.base||'#403d40',{bump:1.5,amb:.25,spec:.04,shift:16,hiLift:.22});
    shadowEllipse(g,w/2,fy,w*.44,w*.12,.5);
    for(var i=0;i<4;i++) {
      var x=w*(.22+i/3*.56),hh=h*range(r,.3,.8),y=fy-range(r,0,h*.05);
      rockFacets(S,r,x,y,w*range(r,.25,.38),hh,i*4,stone,{bevel:.7,tex:noiseTex('grain',1.3,1.3,r)});
    }
    S.render(g,{footY:fy,footAO:10});
    if(pal.glow){g.strokeStyle=pal.glow;g.lineWidth=1.4;for(var j=0;j<5;j++){var xx=w*(.2+j*.14);g.beginPath();g.moveTo(xx,fy-3);g.lineTo(xx-3,fy-h*.18);g.lineTo(xx+1,fy-h*.26);g.stroke();}}
  }
  function drawObsidian(g,w,h,r,pal) {
    var fy=h-FOOT,S=sculpt(w,h),glass=M('#292430',{bump:.6,amb:.2,hiLift:.16,spec:.08});
    shadowEllipse(g,w/2,fy,w*.4,w*.1,.4);
    // 根部埋入斷裂母岩，柱腳不再整排切齊同一條水平線。
    for(var i=0;i<4;i++)rockFacets(S,r,w*(.25+i*.17),fy-range(r,0,h*.045),w*range(r,.2,.3),h*range(r,.4,.85),i*5,glass,{bevel:.5,tex:noiseTex('grain',1.7,.6,r)});
    for(var b=0;b<6;b++)rockFacets(S,r,w*range(r,.13,.87),fy+range(r,-3,1),w*range(r,.2,.35),h*range(r,.06,.19),24+b,M('#3a3033',{bump:1.4,amb:.22,hiLift:.18}),{bevel:.6,tex:noiseTex('grain',1.2,1.3,r)});
    pebblesAt(S,r,w/2,fy,w*.45,10,M('#45393b',{bump:1.1,amb:.25}),34);
    S.render(g,{footY:fy,footAO:8});
    g.strokeStyle='rgba(196,104,70,.5)';g.lineWidth=.7;g.beginPath();g.moveTo(w*.48,fy-h*.48);g.lineTo(w*.52,fy-h*.27);g.lineTo(w*.46,fy-3);g.stroke();
  }
  function drawLavaContact(g,w,r) {
    // 地面平面上的灰燼裙邊；中心實、外圈碎散，不以一圈整齊的石頭框住物件。
    shadowEllipse(g,0,1,w*.62,w*.23,.42);
    for(var i=0;i<150;i++){
      var a=r()*Math.PI*2,d=Math.sqrt(r()),x=Math.cos(a)*w*.69*d,y=Math.sin(a)*w*.23*d;
      var s=range(r,.45,2.3)*(1-d*.5);g.fillStyle=rgba(pick(r,['#594642','#84716a','#231d24','#3f3438']),.12+(1-d)*.5);
      pathPoly(g,[[x-s,y],[x-s*.4,y-s*.7],[x+s*.8,y-s*.3],[x+s,y+s*.3]]);g.fill();
    }
  }
  function drawFulgurite(g,w,h,r,pal) {
    var fy=h-FOOT,S=sculpt(w,h),mat=M('#536779',{bump:1.7,amb:.32,spec:.06,hiLift:.2});
    shadowEllipse(g,w/2,fy,w*.35,w*.1,.4);
    for(var i=0;i<4;i++){var x=w*.5+range(r,-w*.2,w*.2),y=fy-h*range(r,.4,.78),ex=x+range(r,-w*.28,w*.28),ey=y-h*range(r,.08,.17);S.capsule(w*.5,fy,w*.045,x,y,w*.027,0,mat,{tex:noiseTex('grain',.8,1.3,r)});S.capsule(x,y,w*.027,ex,ey,w*.01,3,mat,{tex:noiseTex('grain',.8,1.3,r)});}
    rockFacets(S,r,w*.5,fy,w*.58,h*.18,6,M('#4e586b',{bump:1.5,amb:.25,hiLift:.24}),{tex:noiseTex('grain',1,1.3,r)});
    S.render(g,{footY:fy,footAO:7});
  }
  function decalBiomass(g,w,h,r,pal) {
    var forest=pal.kind==='forest',lava=pal.kind==='lava';
    for(var i=0;i<90;i++) {
      var a=r()*Math.PI*2,d=Math.sqrt(r()),x=w/2+Math.cos(a)*w*.46*d,y=h/2+Math.sin(a)*h*.46*d;
      var alpha=(1-d)*.7;g.fillStyle=rgba(pick(r,forest?['#45664a','#6e7954','#334b3d']:lava?['#423c42','#625552','#2b2c33']:['#525e71','#82929d','#394557']),alpha);
      g.beginPath();g.ellipse(x,y,range(r,2,9),range(r,1,4),r()*Math.PI,0,Math.PI*2);g.fill();
    }
    if(lava){
      var pts=blob(w/2,h/2,w*.28,h*.15,16,.4,r);pathSmooth(g,pts);g.save();g.clip();
      var heat=g.createRadialGradient(w/2,h/2,0,w/2,h/2,w*.3);heat.addColorStop(0,'rgba(218,100,43,.8)');heat.addColorStop(.6,'rgba(139,50,32,.65)');heat.addColorStop(1,'rgba(57,35,34,0)');g.fillStyle=heat;g.fillRect(0,0,w,h);
      for(var j=0;j<22;j++){var x=w/2+range(r,-w*.3,w*.3),y=h/2+range(r,-h*.17,h*.17);pathPoly(g,blob(x,y,range(r,4,12),range(r,3,8),7,.35,r));g.fillStyle=pick(r,['#3d3032','#4b3635','#302b31']);g.fill();}
      g.restore();
    }
  }
  /* 可平鋪的週期雜訊地表，不用方向性波紋，避免投影後看起來像水面或規則格線。 */
  function buildGround(zoneKey) {
    if(zoneKey&&zoneKey.indexOf('god_')===0)return divineGround(zoneKey);
    var colors={mist_forest:[39,59,49],lava_mountain:[56,44,43],thunder_peak:[63,74,88]};
    var c=colors[zoneKey];if(!c)return null;
    var canvas=document.createElement('canvas');canvas.width=canvas.height=256;var g=canvas.getContext('2d'),im=g.createImageData(256,256);
    function periodic(x,y,cells){
      var gx=x/256*cells,gy=y/256*cells,ix=Math.floor(gx),iy=Math.floor(gy),tx=gx-ix,ty=gy-iy;
      tx=tx*tx*(3-2*tx);ty=ty*ty*(3-2*ty);
      function n(a,b){return hash3(a%cells,b%cells,173)/4294967296;}
      return lerp(lerp(n(ix,iy),n(ix+1,iy),tx),lerp(n(ix,iy+1),n(ix+1,iy+1),tx),ty)-.5;
    }
    for(var y=0;y<256;y++)for(var x=0;x<256;x++){
      var n=periodic(x,y,4)*10+periodic(x,y,16)*6+periodic(x,y,64)*3+(hash3(x,y,37)/4294967296-.5)*2;
      var k=(y*256+x)*4;for(var j=0;j<3;j++)im.data[k+j]=c[j]+n;im.data[k+3]=255;
    }
    g.putImageData(im,0,0);return canvas;
  }

  /* 周期Voronoi讓虛空裂片真正分離；聖域為珍珠瓷面，戰場為神金殘台，皆非泥土。 */
  function divineGround(zoneKey) {
    var S=512,c=document.createElement('canvas');c.width=c.height=S;
    var g=c.getContext('2d'),im=g.createImageData(S,S),r=mulberry(strHash(zoneKey)),cells=[];
    var holy=zoneKey==='god_sanctuary',chaos=zoneKey==='god_chaos';
    for(var cy=0;cy<5;cy++)for(var cx=0;cx<5;cx++)cells.push({x:(cx+.18+r()*.64)*S/5,y:(cy+.18+r()*.64)*S/5,k:r()});
    for(var y=0;y<S;y++)for(var x=0;x<S;x++){
      var first=1e9,second=1e9,cell=null;
      for(var i=0;i<cells.length;i++){
        var p=cells[i],dx=Math.abs(x-p.x),dy=Math.abs(y-p.y);dx=Math.min(dx,S-dx);dy=Math.min(dy,S-dy);
        var dist=dx*dx+dy*dy;
        if(dist<first){second=first;first=dist;cell=p;}else if(dist<second)second=dist;
      }
      var seam=(Math.sqrt(second)-Math.sqrt(first)),noise=(hash3(x,y,71)/4294967296-.5)*2;
      var base,light=cell.k*10+noise;
      if(chaos){
        if(seam<24){var edge=Math.max(0,1-Math.abs(seam-22)/2);base=[5+edge*59,7+edge*67,19+edge*113];}
        else{var bevel=Math.min(1,(seam-24)/7);base=[26+light*1.1+bevel*5,31+light+bevel*7,59+light*1.7+bevel*11];}
      }else if(holy){
        var vein=Math.sin(x*Math.PI*4/S+Math.sin(y*Math.PI*2/S)*2)*Math.sin(y*Math.PI*2/S+x*Math.PI*2/S);
        var shine=Math.pow(Math.max(0,Math.cos((x+y)*Math.PI*2/S)),12)*12;
        // 聖域以寬大無縫瓷面承托金紋，避開混沌裂片相同的拼塊輪廓。
        base=[173+noise+shine+vein*6,193+noise+shine+vein*5,208+noise+shine+vein*4];
      }else{
        var glow=Math.max(0,1-Math.abs(seam-1.3)/1.2);
        base=seam<3?[40+glow*64,34+glow*39,43+glow*10]:[64+light,58+light*.8,69+light*.7];
      }
      var off=(y*S+x)*4;for(var ch=0;ch<3;ch++)im.data[off+ch]=base[ch];im.data[off+3]=255;
    }
    g.putImageData(im,0,0);
    // 零星星點襯出深淵與裂片的距離。
    if(chaos)for(var st=0;st<180;st++){g.fillStyle=st%3?'rgba(165,180,255,.38)':'rgba(244,217,255,.6)';g.fillRect(r()*S,r()*S,.6+r(),.6+r());}
    return c;
  }

  function decalDivine(g,w,h,r,pal) {
    var holy=pal.kind==='sanctuary',chaos=pal.kind==='chaos';
    g.save();g.translate(w/2,h/2);g.rotate(r()*Math.PI*2);
    var color=holy?'#e8dbaf':chaos?'#9c98df':'#d2a46b';
    if(chaos){
      for(var j=0;j<3;j++){
        g.strokeStyle=rgba(j%2?'#91c8ef':'#ab78e1',.12+j*.035);g.lineWidth=1+j;
        g.beginPath();g.ellipse(0,0,w*(.21+j*.055),h*(.09+j*.025),.3,.2,5.7);g.stroke();
      }
    }else{
      for(var ring=0;ring<3;ring++){g.strokeStyle=rgba(color,ring===1?.42:.22);g.lineWidth=ring===1?1.5:1;g.beginPath();g.arc(0,0,w*(.25+ring*.025),0,Math.PI*2);g.stroke();}
      for(var k=0;k<12;k++){
        g.save();g.rotate(k*Math.PI/6);g.strokeStyle=rgba(color,.46);g.lineWidth=1.3;
        g.beginPath();g.moveTo(-4,-w*.30);g.lineTo(-4,-w*.34);g.lineTo(3,-w*.32);g.lineTo(4,-w*.35);g.stroke();g.restore();
      }
      g.strokeStyle=rgba(color,.19);g.lineWidth=1;
      for(var ray=0;ray<6;ray++){g.save();g.rotate(ray*Math.PI/3);g.beginPath();g.moveTo(0,-w*.08);g.lineTo(w*.18,-w*.10);g.lineTo(0,-w*.24);g.stroke();g.restore();}
    }
    g.restore();
  }

  /* 遠方天空河：單張預烘霧帶與星塵，三層視差；不在每幀重繪Canvas。 */
  function particleSkyRiver(g,w,h,r) {
    for(var band=0;band<18;band++){
      g.beginPath();
      for(var i=0;i<=80;i++){
        var x=i/80*w,y=h*.49+Math.sin(x/w*Math.PI*1.7-.8)*h*.19+(band-8.5)*h*.012;
        if(!i)g.moveTo(x,y);else g.lineTo(x,y);
      }
      g.strokeStyle='rgba(255,255,255,'+(.018+Math.sin(band/18*Math.PI)*.025)+')';g.lineWidth=h*(.025+Math.sin(band/18*Math.PI)*.055);g.stroke();
    }
    for(var star=0;star<850;star++){
      var sx=r()*w,mid=h*.49+Math.sin(sx/w*Math.PI*1.7-.8)*h*.19;
      var sy=mid+(r()+r()+r()-1.5)*h*.19,sz=.3+Math.pow(r(),8)*2.1;
      g.fillStyle='rgba(255,255,255,'+(.12+r()*.6)+')';g.fillRect(sx,sy,sz,sz);
      if(sz>1.8){g.fillStyle='rgba(255,255,255,.3)';g.fillRect(sx-3,sy+.5,7,.6);g.fillRect(sx+.5,sy-3,.6,7);}
    }
    // 兩端及上下均淡出，縮放或超寬視窗也不露出矩形邊界。
    var fade=g.createLinearGradient(0,0,w,0);fade.addColorStop(0,'transparent');fade.addColorStop(.12,'white');fade.addColorStop(.88,'white');fade.addColorStop(1,'transparent');
    g.globalCompositeOperation='destination-in';g.fillStyle=fade;g.fillRect(0,0,w,h);g.globalCompositeOperation='source-over';
  }
  function particleSkyVeil(g,w,h) {
    var gr=g.createLinearGradient(0,0,0,h);gr.addColorStop(0,'white');gr.addColorStop(.32,'rgba(255,255,255,.96)');gr.addColorStop(.6,'rgba(255,255,255,.7)');gr.addColorStop(1,'transparent');
    g.fillStyle=gr;g.fillRect(0,0,w,h);
  }
  function particleDivineOrbit(g,w,h) {
    g.save();g.translate(w/2,h/2);g.strokeStyle='rgba(255,255,255,.65)';g.lineWidth=1.1;
    for(var i=0;i<3;i++){g.beginPath();g.arc(0,0,w*(.29+i*.06),i*2,i*2+1.6);g.stroke();}
    for(var k=0;k<8;k++){g.save();g.rotate(k*Math.PI/4);g.fillStyle='rgba(255,255,255,.7)';g.fillRect(-1,-h*.41,2,5);g.restore();}
    g.restore();
  }

  var KITS = {
    desert: {
      tint: 0xffffff, deepTint: 0x8a7f78,
      props: [['rock', 5, 70, 56, SAND], ['rock', 3, 46, 36, SAND], ['pillar', 1.6, 64, 132, { base: '#b8966a' }], ['deadTree', 1.6, 96, 128, { wood: '#3e2c1e', hi: '#c8a878' }],
        ['cactus', 1.6, 64, 104, { base: '#4a5e36' }], ['skullPile', 1, 64, 50, { bone: '#e2d6bc' }], ['rubble', 1.4, 62, 46, SAND]],
      deepProps: [['pillar', 2.5, 64, 140, { base: '#a88a62' }, { intact: true }], ['pillar', 2, 64, 132, { base: '#a88a62' }], ['ruinWall', 2, 120, 76, { base: '#8a6e4c' }],
        ['brazier', 1.6, 58, 80, { metal: '#6a5a48' }], ['spire', 2, 60, 112, SAND_SPIRE], ['urn', 1.6, 40, 48, { base: '#9a5a3a' }], ['skullPile', 1.2, 64, 50, { bone: '#d8ccb0' }],
        ['rubble', 1.4, 62, 46, SAND]],
      decals: [['patch', 6, 360, { color: '#c09868', alpha: 0.11 }], ['patch', 4, 300, { color: '#2a1a0e', alpha: 0.18 }], ['crack', 3, 150, { dark: 'rgba(30,18,8,0.8)', rim: '#e8c890' }],
        ['pebbles', 4, 90, { color: '#8a6a4a' }], ['bones', 1.2, 90, { color: '#d8ccb0' }]],
      deepDecals: [['tiles', 4, 300, { color: '#8a7050' }], ['patch', 4, 300, { color: '#1a1008', alpha: 0.22 }], ['crack', 3, 150, { dark: 'rgba(20,12,6,0.8)', rim: '#c8a070' }], ['pebbles', 3, 90, { color: '#7a5a3a' }]],
      ambient: { kind: 'dust', count: 34, color: 0xf0d8a8, fog: 2, fogTint: 0xd8b888, fogAlpha: 0.1, fogWind: -1 },
      deepAmbient: { kind: 'embers', count: 26, color: 0xffa040 }
    },
    Icefield: {
      tint: 0xffffff, deepTint: 0x7f8aa0,
      props: [['rock', 4, 72, 58, ICEROCK, { snow: true }], ['rock', 3, 46, 38, ICEROCK, { snow: true }], ['crystals', 3, 70, 96, { light: '#e8f6ff', base: '#8cc8f0', dark: '#2a5a8a', glow: '#9ad8ff', rock: '#6a7a8c' }],
        ['spire', 1.8, 56, 104, ICE_SPIRE], ['deadTree', 1.4, 90, 120, { wood: '#2e3440', hi: '#e8f0ff' }], ['skullPile', 0.6, 60, 48, { bone: '#dfe6ee' }]],
      deepProps: [['crystals', 5, 80, 118, { light: '#f0fbff', base: '#7ab8e8', dark: '#1e4a7a', glow: '#7ad0ff', rock: '#4a5a6c' }], ['spire', 3, 60, 118, ICE_SPIRE_GLOW],
        ['rock', 3, 70, 56, ICEROCK, { snow: true }], ['pillar', 1.2, 60, 128, { base: '#9ab0c4' }], ['brazier', 1, 58, 80, { metal: '#5a6474', fire: '#4ab0ff', fire2: '#d8f4ff' }]],
      decals: [['snow', 6, 340, { color: '#eef6ff' }], ['patch', 3, 300, { color: '#203448', alpha: 0.16 }], ['crack', 3, 160, { dark: 'rgba(20,40,70,0.75)', rim: '#ffffff', glow: '#9ad8ff' }],
        ['puddle', 1.5, 150, { color: '#9ccbe8', frozen: true }], ['pebbles', 2, 80, { color: '#8aa0b4' }]],
      deepDecals: [['crack', 4, 170, { dark: 'rgba(10,30,60,0.8)', rim: '#cfefff', glow: '#7ad0ff' }], ['puddle', 3, 170, { color: '#6aa8d8', frozen: true }], ['patch', 4, 320, { color: '#0e1a2a', alpha: 0.22 }],
        ['snow', 2, 280, { color: '#dcecff' }], ['light', 1.4, 220, { color: '#7ad0ff' }]],
      ambient: { kind: 'snow', count: 50, color: 0xffffff, fog: 2, fogTint: 0xdfeaf6, fogAlpha: 0.12, fogWind: -1 },
      deepAmbient: { kind: 'motes', count: 30, color: 0x9ad8ff }
    },
    mist_forest: {
      tint:0xffffff,deepTint:0x819d96,
      props:[['mistTree',4,172,215,{}],['fanFern',4,86,54,{}],['rootGate',1,148,115,{}]],
      deepProps:[['rootGate',3,168,128,{}],['fanFern',3,86,54,{}],['mistTree',1,145,180,{}]],
      decals:[['biomass',6,280,{kind:'forest'}],['patch',4,330,{color:'#102c24',alpha:.22}],['roots',2,170,{}]],
      deepDecals:[['biomass',5,260,{kind:'forest'}],['roots',3,190,{}],['light',1.3,210,{color:'#86c7b3'}]],
      ambient:{kind:'fireflies',count:18,color:0xb8dac3,fog:5,fogTint:0x98c4b9,fogAlpha:.18,fogWind:1,rays:2,rayColor:0xb8d8bd},
      deepAmbient:{kind:'wisps',count:16,color:0x9ed5c7,fog:4,fogTint:0x6fada8,fogAlpha:.15},motion:{wind:.6,local:'gas'}
    },
    lava_mountain: {
      tint:0xffffff,deepTint:0xb39a98,
      props:[['lavaOutcrop',1.3,125,158,{}],['lavaVent',1.1,110,78,{}],['obsidian',1.5,80,107,{}],['basalt',1.2,62,48,{base:'#49434c'}],['magmaPool',2,142,94,{}],['burningLog',2,126,98,{}],['slagBoulder',1.8,102,83,{}],['burningLog',.8,88,58,{}],['slagBoulder',1,72,54,{}],['magmaPool',.7,90,60,{}]],
      deepProps:[['lavaOutcrop',1.5,145,178,{}],['lavaVent',1.2,112,86,{}],['obsidian',1.6,88,122,{}],['basalt',1,68,50,{base:'#49434c'}],['magmaPool',2.4,150,100,{}],['burningLog',1.5,120,94,{}],['slagBoulder',2,112,91,{}],['burningLog',.8,88,58,{}],['slagBoulder',1,72,54,{}],['magmaPool',.7,90,60,{}]],
      decals:[['biomass',4,230,{kind:'lava'}],['crack',4,210,{dark:'#4d201c',rim:'#c27046',glow:'#ef6b26'}],['patch',4,320,{color:'#1d1820',alpha:.25}]],
      deepDecals:[['biomass',5,270,{kind:'lava'}],['crack',5,220,{dark:'#4d201c',rim:'#db9c65',glow:'#ff842d'}],['light',1.5,220,{color:'#d86630'}]],
      ambient:{kind:'embers',count:36,color:0xf8a15b,fog:3,fogTint:0x84706b,fogAlpha:.15,fogWind:-1},deepAmbient:{kind:'embers',count:42,color:0xffb35d,fog:2,fogTint:0x725453,fogAlpha:.17},motion:{wind:.4,local:'smoke'}
    },
    thunder_peak: {
      tint:0xffffff,deepTint:0x8695b3,
      props:[['stormSpire',3.8,120,156,{}],['fulgurite',1.5,90,106,{}],['windPine',2.3,158,145,{}],['stormGrass',2,60,40,{base:'#77867f'}]],
      deepProps:[['fulgurite',4,105,128,{}],['stormSpire',3,132,172,{}],['basalt',2.5,115,130,{base:'#586274',glow:'#a6b8dd'}]],
      decals:[['biomass',5,250,{kind:'storm'}],['crack',3,175,{dark:'#222a3c',rim:'#96a8be'}],['patch',4,310,{color:'#1c293b',alpha:.22}]],
      deepDecals:[['biomass',5,240,{kind:'storm'}],['crack',3,190,{dark:'#242a40',rim:'#b1c5e2',glow:'#8ba3d9'}],['light',1,220,{color:'#9fb9da'}]],
      ambient:{kind:'rain',count:70,color:0xb9d3eb,fog:3,fogTint:0x91a7bf,fogAlpha:.15,fogWind:-1},deepAmbient:{kind:'motes',count:25,color:0xacc6eb,fog:2,fogTint:0x6e7da4,fogAlpha:.12},motion:{wind:1.6,local:'frost'}
    },
    swamp: {
      tint: 0xffffff, deepTint: 0x7c8a78,
      props: [['reeds', 4, 70, 96, { base: '#6a7a3a', head: '#4a2e1a' }], ['mushrooms', 2.6, 62, 66, { cap: '#8a3a6a', stem: '#d8d0b8', spot: '#f0e0f0', glow: '#c070ff' }],
        ['stump', 2, 82, 66, { wood: '#4a3424', ring: '#8a6a48', moss: '#4a6a2a' }], ['rock', 2.4, 84, 64, MOSSROCK, { moss: '#5a8a3a' }], ['deadTree', 1.4, 96, 132, { wood: '#2a2a1e', hi: '#8a9a6a' }],
        ['grass', 2, 54, 40, { base: '#5a7a34' }], ['fern', 3, 76, 50, { base: '#5a7a34' }], ['log', 1.8, 120, 62, { wood: '#4a3424' }]],
      deepProps: [['mushrooms', 5, 70, 78, { cap: '#2a7a6a', stem: '#c8d8c8', spot: '#d0fff0', glow: '#40ffd0' }], ['stump', 2, 64, 58, { wood: '#3a2a1e', ring: '#7a5a3a', moss: '#3a5a2a' }],
        ['rock', 2, 84, 64, MOSSROCK, { moss: '#3a7a4a' }], ['ruinWall', 1.2, 110, 70, { base: '#5a5a48', moss: '#4a7a3a' }], ['reeds', 2, 70, 96, { base: '#4a5a2a', head: '#2a1a10' }],
        ['fern', 1.8, 70, 46, { base: '#3c6650' }], ['log', 1.4, 120, 62, { wood: '#3a2a1e' }]],
      decals: [['puddle', 5, 190, { color: '#2a3a24', rim: '#0a0e08' }], ['patch', 5, 340, { color: '#3a4a1e', alpha: 0.2 }], ['patch', 3, 300, { color: '#0e140a', alpha: 0.2 }],
        ['pebbles', 2, 80, { color: '#4a5a3a' }], ['roots', 2, 150, {}], ['litter', 4, 210, {}]],
      deepDecals: [['puddle', 5, 200, { color: '#1a3a34', rim: '#06100e' }], ['patch', 5, 340, { color: '#0a1410', alpha: 0.24 }], ['light', 2, 200, { color: '#40ffd0' }],
        ['roots', 2, 150, {}], ['litter', 3, 210, {}]],
      ambient: { kind: 'fireflies', count: 26, color: 0xd8ff7a, fog: 3 }, deepAmbient: { kind: 'fireflies', count: 30, color: 0x60ffd8, fog: 4 }
    },
    undead_mountains: {
      tint: 0xffffff, deepTint: 0x7a7480,
      props: [['grave', 4, 54, 72, { base: '#7a7a82', dirt: '#2e2a26' }, { moss: '#4a5a3a' }], ['skullPile', 2, 66, 52, { bone: '#cfc6b4' }], ['deadTree', 2.4, 100, 140, { wood: '#1e1a1e', hi: '#8a8090' }],
        ['rock', 3, 66, 52, DARKSTONE], ['ruinWall', 1.2, 116, 72, { base: '#5a5660' }], ['rubble', 1.2, 62, 46, DARKSTONE]],
      deepProps: [['grave', 3, 54, 72, { base: '#6a6672', dirt: '#24201e' }], ['skullPile', 3, 70, 56, { bone: '#c6bca8' }], ['ruinWall', 2.4, 120, 80, { base: '#4a4652' }],
        ['brazier', 2.2, 58, 80, { metal: '#4a4450', fire: '#9a4aff', fire2: '#e8c8ff' }], ['pillar', 1.6, 62, 136, { base: '#6a6672' }], ['spire', 1.6, 58, 110, DARK_SPIRE],
        ['urn', 1.2, 40, 48, { base: '#6a5a4a' }]],
      decals: [['patch', 6, 340, { color: '#1a161e', alpha: 0.22 }], ['crack', 3, 160, { dark: 'rgba(10,8,12,0.85)', rim: '#b0a8c0' }], ['bones', 2.4, 100, { color: '#c6bca8' }],
        ['pebbles', 3, 90, { color: '#5a5660' }]],
      deepDecals: [['tiles', 4, 300, { color: '#4a4652' }], ['crack', 3, 170, { dark: 'rgba(10,6,16,0.85)', rim: '#a090c0', glow: '#8a4aff' }], ['bones', 2.4, 100, { color: '#beb4a0' }],
        ['light', 1.4, 220, { color: '#9a5aff' }]],
      ambient: { kind: 'wisps', count: 18, color: 0xb8a8ff, fog: 3, fogTint: 0x9a90b0, fogAlpha: 0.14 }, deepAmbient: { kind: 'embers', count: 24, color: 0xb070ff }
    },
    god_battlefield: { decals: [], deepDecals: [] },
    god_chaos: { decals: [], deepDecals: [] },
    god_sanctuary: { decals: [], deepDecals: [] }
  };
  // 每張地貌的本體重新造型，地下另配遺跡／結晶／枯木組合。
  var REBUILT_PROPS = {
    desert: {
      surface: [['rock',3,92,70],['cactus',2,68,114],['dryGrass',3,78,49],['pillar',1.2,70,125],['urn',1.6,56,62],['deadTree',.8,104,140],['rubble',1.7,80,52]],
      deep: [['arch',1,140,132],['pillar',2,68,132],['urn',2.2,56,64],['rock',2,90,66],['dryGrass',1,68,43],['rubble',2,86,55],['brazier',1.2,58,80,{metal:'#6a5a48'}]]
    },
    Icefield: {
      surface: [['pine',2.2,125,178],['crystals',2,83,118],['rock',3,100,72],['shrub',3,78,52],['stump',1,78,62],['spire',1.2,73,113]],
      deep: [['crystals',3.4,90,128],['spire',2,70,118],['rock',2,90,67],['pillar',1.4,74,131],['shrub',2,76,48],['brazier',1,58,80,{metal:'#5a6474',fire:'#4ab0ff',fire2:'#d8f4ff'}]]
    },
    swamp: {
      surface: [['willow',1.3,138,185],['reeds',3,76,94],['fern',3,88,56],['mushrooms',2,63,60],['stump',1.5,90,70],['rock',2.1,95,70],['grass',2,64,43],['log',1.5,130,65]],
      deep: [['willow',1,118,156],['mushrooms',3.2,70,75],['rock',2,96,71],['ruinWall',1.2,112,78],['reeds',1.5,74,93],['fern',2,81,52],['log',1.2,130,65]]
    },
    undead_mountains: {
      surface: [['grave',3.2,76,100],['deadTree',1.8,113,159],['skullPile',1.5,92,64],['rock',2,97,72],['ruinWall',1.1,130,90],['dryGrass',2.8,70,46],['rubble',1.2,87,55]],
      deep: [['arch',1.2,145,142],['grave',2.5,72,96],['skullPile',2,96,70],['urn',1.2,53,62],['pillar',1.6,72,133],['dryGrass',1.4,70,46],['brazier',1.4,58,80,{metal:'#4a4450',fire:'#9a4aff',fire2:'#e8c8ff'}]]
    },
    god_battlefield: {
      surface: [['godBlade',3,100,174],['warCrown',2,133,166],['sunRelic',1.4,114,153],['chainShard',2.5,104,104]],
      deep: [['warCrown',2.4,141,181],['godBlade',3,107,187],['sunRelic',1.7,122,165],['chainShard',2.2,111,114]]
    },
    god_chaos: {
      surface: [['voidGyre',1.8,133,177],['voidPrism',3,126,161],['voidSpindle',2.2,81,164],['voidLens',1.8,125,154]],
      deep: [['voidGyre',2.5,143,190],['voidPrism',2.8,134,172],['voidSpindle',2.3,87,176],['voidLens',2,134,168]]
    },
    god_sanctuary: {
      surface: [['seraphWing',2.4,137,188],['celestialHarp',1.8,121,171],['haloDais',2,113,166],['lightLotus',3,95,86]],
      deep: [['seraphWing',2.3,145,198],['celestialHarp',2,129,183],['haloDais',2.4,123,181],['lightLotus',2.8,103,96]]
    }
  };
  Object.keys(REBUILT_PROPS).forEach(function(key){
    KITS[key].props=REBUILT_PROPS[key].surface;
    KITS[key].deepProps=REBUILT_PROPS[key].deep;
    // 取消裝飾貼片裡的規則磚格，地面以磨損／碎屑建立層次。
    KITS[key].decals=KITS[key].decals.filter(function(d){return d[0]!=='tiles';});
    KITS[key].deepDecals=KITS[key].deepDecals.filter(function(d){return d[0]!=='tiles';});
    KITS[key].motion={wind:.7, local: key==='swamp'?'gas':key==='Icefield'?'frost':key==='god_sanctuary'?'petal':key==='god_chaos'?'void':'smoke'};
  });
  KITS[''] = KITS.desert;

  /* 地面覆蓋與岩石沿用各地貌配色；荒漠／冰原不長苔沼植物。 */
  function natureStyle(kitKey, deep) {
    var pal = { desert: SAND, Icefield: ICEROCK, swamp: MOSSROCK, undead_mountains: DARKSTONE,
      god_battlefield: ASH, god_chaos: CHAOSROCK, god_sanctuary: MARBLE }[kitKey] || SAND;
    var style = { stone: pal.base, light: pal.light, dark: pal.dark,
      soil: pal.base, moss: kitKey === 'swamp', snow: kitKey === 'Icefield', theme: kitKey, deep: !!deep,
      accent: {Icefield:'#8dcced',god_chaos:'#a780d2',god_sanctuary:'#b6ad87',undead_mountains:'#9b98a8',god_battlefield:'#9c8771',desert:'#c6a46d'}[kitKey] };
    if (kitKey === 'swamp') {
      style.stone = '#718171'; style.light = '#b3b69b'; style.dark = '#2e443b'; style.soil = '#55563a';
      if (deep) style.cap = '#456f69';
    }
    if (kitKey==='mist_forest') Object.assign(style,{stone:'#677e70',light:'#a3af98',dark:'#263c34',soil:'#3c5343',moss:true});
    if (kitKey==='lava_mountain') Object.assign(style,{stone:'#54464b',light:'#8b7169',dark:'#211d26',soil:'#493b39'});
    if (kitKey==='thunder_peak') Object.assign(style,{stone:'#707d8f',light:'#a6b5bd',dark:'#2c3749',soil:'#4c5b6d'});
    return style;
  }
  Object.keys(KITS).filter(function (k) { return k && k !== 'swamp' && k.indexOf('god_')!==0; }).forEach(function (key) {
    KITS[key].decals.push(['litter', 2, 180, {}]);
    KITS[key].deepDecals.push(['litter', 2, 180, {}]);
  });

  ['god_battlefield','god_chaos','god_sanctuary'].forEach(function(key){
    var kit=KITS[key],holy=key==='god_sanctuary',chaos=key==='god_chaos';
    kit.tint=0xffffff;kit.deepTint=holy?0xd9e1f5:chaos?0xc2b7e8:0xd5bdac;
    kit.decals=[['divine',3,360,{kind:holy?'sanctuary':chaos?'chaos':'battlefield'}]];
    kit.deepDecals=[['divine',3,400,{kind:holy?'sanctuary':chaos?'chaos':'battlefield'}]];
    kit.motion={wind:0,local:'divine'};
    kit.skyRiver={colors:holy?[0x8caee3,0xffe4ae,0xe9c3eb]:chaos?[0x7758df,0x78c5ed,0xdba5ee]:[0xb26961,0xffd39b,0xa8c4ed]};
    kit.ambient={kind:'motes',count:holy?22:26,color:holy?0xffe9bd:chaos?0xa5cfff:0xffc98b,fog:holy?2:1,fogTint:holy?0xc1d9ef:chaos?0x695f9f:0xb69c98,fogAlpha:.07,rays:holy?2:0,rayColor:0xffecc8};
    kit.deepAmbient=kit.ambient;
  });

  /* 地標：大型場景物件，每個區塊約 14% 機率出現一個，其他擺件會避開它。格式同 props。 */
  var LANDMARKS = {
    desert: {
      surface: [['giantBones', 3, 260, 130, { bone: '#d8ccb0' }], ['rock', 2, 190, 130, SAND], ['arch', 1.5, 220, 190, { base: '#b8966a' }]],
      deep: [['arch', 3, 220, 200, { base: '#a88a62' }], ['giantBones', 1.5, 260, 130, { bone: '#cfc2a6' }]]
    },
    Icefield: {
      surface: [['crystals', 3, 150, 210, { light: '#f0fbff', base: '#8cc8f0', dark: '#2a5a8a', glow: '#9ad8ff', rock: '#6a7a8c' }], ['rock', 2, 190, 140, ICEROCK, { snow: true }],
        ['giantBones', 1, 260, 130, { bone: '#dfe6ee' }]],
      deep: [['crystals', 4, 160, 230, { light: '#f0fbff', base: '#7ab8e8', dark: '#1e4a7a', glow: '#7ad0ff', rock: '#4a5a6c' }], ['arch', 1, 220, 190, { base: '#9ab0c4' }]]
    },
    swamp: {
      surface: [['deadTree', 3, 220, 250, { wood: '#26261a', hi: '#7a8a5a' }], ['rock', 1.5, 180, 120, MOSSROCK, { moss: '#5a8a3a' }]],
      deep: [['deadTree', 2, 220, 250, { wood: '#1e1e16', hi: '#6a7a50' }], ['arch', 1.5, 220, 190, { base: '#5a5a48', moss: '#4a7a3a' }]]
    },
    undead_mountains: {
      surface: [['arch', 2.5, 220, 200, { base: '#6a6672' }], ['deadTree', 2, 220, 260, { wood: '#1a161a', hi: '#8a8090' }], ['giantBones', 1.5, 260, 130, { bone: '#c6bca8' }]],
      deep: [['arch', 3, 220, 200, { base: '#5a5662' }], ['giantBones', 1.5, 260, 130, { bone: '#beb4a0' }]]
    },
    god_battlefield: {
      surface: [['godBlade',2,174,292],['warCrown',1.4,225,270]],
      deep: [['warCrown',2,234,280],['sunRelic',1.5,210,260]]
    },
    god_chaos: {
      surface: [['voidGyre',2,225,292],['voidLens',1,214,265]],
      deep: [['voidGyre',2,237,300],['voidSpindle',1,142,278]]
    },
    god_sanctuary: {
      surface: [['seraphWing',2,224,290],['haloDais',1.5,196,272]],
      deep: [['celestialHarp',1.5,217,286],['seraphWing',2,234,300]]
    }
  };
  var LANDMARK_CHANCE = 0.14;
  LANDMARKS.mist_forest={surface:[['mistTree',1,230,280,{}]],deep:[['rootGate',1,250,255,{}]]};
  LANDMARKS.lava_mountain={surface:[['lavaOutcrop',1,220,260,{}],['lavaVent',.6,235,165,{}],['slagBoulder',1,190,145,{}]],deep:[['lavaVent',.7,260,185,{}],['lavaOutcrop',1,220,265,{}],['slagBoulder',1.2,205,158,{}]]};
  LANDMARKS.thunder_peak={surface:[['stormSpire',1,205,265,{}],['windPine',1,230,260,{}]],deep:[['stormSpire',1,210,270,{}]]};
  var LANDMARK_VARIANTS = 2;

  var PROP_DRAW = {
    stormGrass:drawGrass,
    fanFern:drawFanFern,basalt:drawBasalt,obsidian:drawObsidian,fulgurite:drawFulgurite,
    rock: drawRock, pillar: drawPillar, deadTree: drawDeadTree, cactus: drawCactus, crystals: drawCrystals,
    grave: drawGrave, skullPile: drawSkullPile, mushrooms: drawMushrooms, reeds: drawReeds, stump: drawStump,
    brazier: drawBrazier, ruinWall: drawRuinWall, sword: drawSword, banner: drawBanner, runeStone: drawRuneStone, grass: drawGrass,
    arch: drawArch, giantBones: drawGiantBones, spire: drawSpire, urn: drawUrn, rubble: drawRubble
  };
  var DECAL_DRAW = {
    divine:decalDivine,biomass:decalBiomass,
    patch: decalPatch, crack: decalCrack, pebbles: decalPebbles, bones: decalBones, puddle: decalPuddle,
    runes: decalRunes, tiles: decalTiles, light: decalLight, snow: decalSnow
  };
  /* 背景建圖 Worker（相對於 index.html）。改了 decor-sculpt／decor-nature／battle-decor 要一起更新
     這裡的版本與 Worker 檔內 importScripts 的版本字串，否則 Worker 會吃到快取的舊畫法。 */
  var ATLAS_WORKER_URL = 'js/worker/decor-atlas.worker.js?v=1.0.21';
  var VARIANTS = 3;          // 每種擺件／地面裝飾畫幾個變體
  var TEX_SCALE = 1.5;       // 圖集解析度（畫面放大或高 DPI 時仍清楚；開 mipmap 避免縮小時閃爍）

  /* ============ 圖集 ============ */
  /* ---- 圖集分段建造 ----
     浮雕擺件逐像素打光，整張圖集要一兩百毫秒；一次做完會在換地圖／換階段帶時卡一下。
     所以拆成兩步：planAtlas 只排版（很快）、stepAtlas 一張一張畫，超過時間預算就停、下一幀接著畫。
     buildAtlas 是一次畫完的同步版本，給預覽頁與測試用。 */
  function atlasKey(kitKey, deep) { return kitKey + (deep ? '#deep' : ''); }
  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  function layoutAtlas(kitKey, deep) {
    var kit = KITS[kitKey] || KITS[''];
    var specs = [];
    var props = deep ? kit.deepProps : kit.props;
    var lm = LANDMARKS[kitKey] || LANDMARKS.desert;
    var landmarks = (deep ? lm.deep : lm.surface) || [];
    landmarks.forEach(function (p, i) {
      for (var v = 0; v < LANDMARK_VARIANTS; v++) specs.push({ kind: 'prop', key: 'L' + i + '_' + v, variant:v, type: p[0], w: p[2], h: p[3], pal: p[4], opt: p[5], seed: strHash(kitKey + 'L' + p[0] + i + '_' + v + (deep ? 'd' : '')) });
    });
    var decals = deep ? kit.deepDecals : kit.decals;
    props.forEach(function (p, i) {
      for (var v = 0; v < VARIANTS; v++) specs.push({ kind: 'prop', key: 'p' + i + '_' + v, variant:v, type: p[0], w: p[2], h: p[3], pal: p[4], opt: p[5], seed: strHash(kitKey + p[0] + i + '_' + v + (deep ? 'd' : '')) });
      if (p[0] === 'brazier' && !specs.some(function (s) { return s.key === 'flame' + i + '_0'; })) {
        for (var f = 0; f < FLAME_FRAMES; f++) specs.push({ kind: 'flame', key: 'flame' + i + '_' + f, type: 'flame', w: 34, h: 48, pal: p[4], seed: 7 + i, frame: f });
      }
    });
    if (kitKey === 'lava_mountain') {
      for (var ef=0;ef<ENV_FIRE_FRAMES;ef++) specs.push({kind:'flame',key:'envFlame'+ef,type:'environmentFire',w:64,h:88,seed:173,frame:ef});
    }
    decals.forEach(function (d, i) {
      var nv = d[0] === 'light' ? 1 : VARIANTS;
      for (var v = 0; v < nv; v++) specs.push({ kind: 'decal', key: 'd' + i + '_' + v, type: d[0], w: d[2], h: d[2], pal: d[3], seed: strHash(kitKey + d[0] + i + '_' + v + (deep ? 'd' : '')) });
    });
    var style = natureStyle(kitKey, deep);
    var natureProps = ['godBlade','warCrown','sunRelic','chainShard','voidGyre','voidPrism','voidSpindle','voidLens','seraphWing','celestialHarp','haloDais','lightLotus','magmaPool','burningLog','slagBoulder','mistTree','rootGate','lavaVent','windPine','lavaOutcrop','stormSpire','rock','stump','log','fern','reeds','mushrooms','grass','willow','pine','deadTree','shrub','dryGrass','cactus','pillar','grave','urn','arch','ruinWall','rubble','runeStone','crystals','spire','skullPile','giantBones','banner','sword'];
    var contacts = [];
    specs.forEach(function (s) {
      s.natureStyle = style;
      s.nature = s.kind === 'prop' && natureProps.indexOf(s.type) >= 0;
      if (s.kind === 'decal') s.nature = s.type === 'litter' || s.type === 'roots' || (kitKey === 'swamp' && s.type === 'puddle');
      if (s.kind !== 'prop') return;
      // 接觸區不與本體一起 billboard：在地面層以同腳點、縮放與翻面放置。
      contacts.push({ kind: 'contact', key: 'foot_' + s.key, type: s.type, propW: s.w,
        w: Math.ceil(s.w * 1.65 + 28), h: Math.ceil(s.w * 0.9 + 40), seed: s.seed ^ 0x7f4a7c15, natureStyle: style });
    });
    specs = specs.concat(contacts);
    PARTICLE_SPECS.forEach(function (p) { specs.push({ kind: 'particle', key: p[0], type: p[0], w: p[1], h: p[2], seed: p[3] }); });
    if(kit.skyRiver){
      specs.push({kind:'particle',key:'skyVeil',type:'skyVeil',w:256,h:256,seed:1});
      specs.push({kind:'particle',key:'skyRiver',type:'skyRiver',w:768,h:240,seed:1327});
      specs.push({kind:'particle',key:'divineOrbit',type:'divineOrbit',w:128,h:128,seed:7});
    }
    // 架子式打包
    var PAD = 6, MAXW = 2048;
    var x = PAD, y = PAD, rowH = 0;
    specs.sort(function (a, b) { return b.h - a.h; });
    specs.forEach(function (s) {
      var pw = Math.ceil(s.w * TEX_SCALE), ph = Math.ceil(s.h * TEX_SCALE);
      if (x + pw + PAD > MAXW) { x = PAD; y += rowH + PAD; rowH = 0; }
      s.px = x; s.py = y; s.pw = pw; s.ph = ph;
      x += pw + PAD;
      rowH = Math.max(rowH, ph);
    });
    var H = y + rowH + PAD;
    return {
      key: atlasKey(kitKey, deep), kitKey: kitKey, deep: deep, width: MAXW, height: Math.min(4096, Math.max(64, H)),
      specs: specs, kit: kit, props: props, decals: decals, landmarks: landmarks, next: 0, done: false
    };
  }

  function planAtlas(kitKey, deep) {
    var plan = layoutAtlas(kitKey, deep);
    plan.canvas = document.createElement('canvas');
    plan.canvas.width = plan.width;
    plan.canvas.height = plan.height;
    // CPU 端畫布：擺件逐張 putImageData 合成進來（見 DecorSculpt），GPU 畫布會每張同步回讀一次
    plan.g = plan.canvas.getContext('2d', { willReadFrequently: true });
    return plan;
  }

  function drawSpec(g, s) {
    g.save();
    g.beginPath(); g.rect(s.px, s.py, s.pw, s.ph); g.clip();
    g.translate(s.px, s.py);
    g.scale(TEX_SCALE, TEX_SCALE);
    var r = mulberry(s.seed);
    try {
      if (s.kind === 'contact') {
        g.translate(s.w / 2, s.h / 2); g.scale(1, 2);
        DecorNature.drawContact(g, 0, 0, s.propW, s.seed, s.natureStyle);
        if (s.natureStyle.theme === 'lava_mountain') drawLavaContact(g,s.propW,r);
      } else if (s.nature && s.kind === 'prop') {
        DecorNature.drawBody(g, s.type, s.w / 2, s.h - FOOT, s.w * 0.9, s.h - FOOT, s.seed, s.natureStyle, s.variant);
      } else if (s.nature && s.kind === 'decal') {
        DecorNature.drawSurface(g, s.type, s.w, s.h, s.seed, s.natureStyle);
      } else if (s.kind === 'prop') PROP_DRAW[s.type](g, s.w, s.h, r, s.pal, s.opt);
      else if (s.kind === 'decal') DECAL_DRAW[s.type](g, s.w, s.h, r, s.pal);
      else if (s.kind === 'flame') {
        if(s.type==='environmentFire')drawEnvironmentFire(g,s.w,s.h,s.frame);
        else drawFlameFrame(g, s.w, s.h, r, s.pal, s.frame);
      }
      else PARTICLE_DRAW[s.type](g, s.w, s.h, r);
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[decor] 畫 ' + s.type + ' 失敗', e);
    }
    g.restore();
  }

  // 畫到超過預算就停（至少畫一張）；回傳是否全部畫完
  function stepAtlas(plan, budgetMs) {
    var t0 = nowMs();
    while (plan.next < plan.specs.length) {
      drawSpec(plan.g, plan.specs[plan.next++]);
      if (nowMs() - t0 >= budgetMs) break;
    }
    plan.done = plan.next >= plan.specs.length;
    return plan.done;
  }

  function buildAtlas(kitKey, deep) {
    var plan = planAtlas(kitKey, deep);
    stepAtlas(plan, Infinity);
    return plan;
  }

  function weightedPick(r, list) {
    var total = 0;
    for (var i = 0; i < list.length; i++) total += list[i][1];
    var t = r() * total;
    for (var j = 0; j < list.length; j++) { t -= list[j][1]; if (t <= 0) return j; }
    return list.length - 1;
  }

  /* ============ 執行期 ============ */
  var CHUNK_W = 560;             // 區塊寬（世界單位）
  var CHUNK_H = 560;             // 區塊高（世界單位；畫面上是一半）
  var STAGE_BAND = 10;           // 每 10 個階段換一帶，雙數帶是地下
  var PLAYER_FADE_ALPHA = 0.38;  // 擺件擋到玩家時的透明度

  /* ?obstacles=1：把會擋路的佔地橢圓畫在地上（紅色），檢查「看到的岩石」跟「擋路的範圍」對不對得上 */
  function obstacleDebugOn() {
    try { return /[?&]obstacles=1(&|$)/.test(location.search); } catch (e) { return false; }
  }
  function decorQueryMode() {
    try {
      var m = /[?&]decor=([^&]+)/.exec(location.search);
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  }

  /* 直立貼圖抵銷整片畫面透視，只留遠近縮放（2026-10-03 使用者：場景物件不要被 FOV 往中央上方扭曲）。
     basis 來自 battle-renderer 的 sceneBillboardBasis（opts.billboard，腳點座標進、{w, shear, skew, k} 出；
     沒開透視回傳 null＝原樣）。矩陣 [[1, shear], [0, w]] 左乘貼圖自己的縮放，Pixi 寫成 skew.x 與 scale.y 的乘數 k。
     anchor 給「掛在別的擺件上」的零件（火焰、魔門的眼睛）：它們沿用錨點的基底，位置也經過同一個矩陣，
     才會像剛體一樣跟著擺件走——不然零件各自被網格推到別處，火焰會飄離火盆的碗口。
     offX／offY 是零件相對錨點腳底、抵銷之前的位移（世界直屬座標，往上為負）。 */
  function billboardSprite(s, billboard, bx, by, anchor, offX, offY) {
    var ref = anchor || s;
    var b = billboard ? billboard(ref.x, ref.y) : null;
    if (anchor) {
      s.x = anchor.x + (offX || 0) + (b ? b.shear * (offY || 0) : 0);
      s.y = anchor.y + (b ? b.w * (offY || 0) : (offY || 0));
    }
    s.skew.x = b ? b.skew : 0;
    s.scale.set(bx, b ? by * b.k : by);
  }

  function create(opts) {
    var PIXI = opts.PIXI;
    var mode = decorQueryMode();
    var enabled = mode !== '0' && mode !== 'off';
    var lite = mode === 'lite';
    var debugObstacles = obstacleDebugOn() && !!PIXI.Graphics;
    var groundScale = opts.groundScale || 0.5;
    var decalLayer = opts.decalLayer;     // 地面平面（世界座標，scale.y = groundScale）
    var lightLayer = opts.lightLayer;     // 同上，加色光暈（火盆地面光）
    var propLayer = opts.propLayer;       // 實體層（畫面座標，sortable）
    var ambientLayer = opts.ambientLayer; // 螢幕座標
    var distantLayer = opts.distantLayer; // 地板之上、角色之後的螢幕遠景

    /* 建圖的時間預算（毫秒／幀）：目前場景的圖集要盡快出來；另一個階段帶（地表⇄地下）在背景慢慢預建，
       換帶時就不必再等。測試傳 Infinity／0 讓建圖同步完成、不做背景預建。 */
    var BUILD_BUDGET = opts.buildBudgetMs === undefined ? 6 : opts.buildBudgetMs;
    var PREBUILD_BUDGET = opts.prebuildBudgetMs === undefined ? 3 : opts.prebuildBudgetMs;
    var CACHE_MAX = 2;   // 畫好的圖集留幾張（每張約 2048×1500，CPU 端約 12MB）

    /* 背景建圖：支援 Worker＋OffscreenCanvas 時整張圖集交給 js/worker/decor-atlas.worker.js 畫，
       主執行緒只收 ImageBitmap、上傳貼圖；不支援或 Worker 出錯時退回上面的分段建圖。 */
    var WK = { worker: null, failed: false, seq: 0, pending: {} };
    function workerAvailable() {
      return opts.worker !== false && !WK.failed && typeof Worker !== 'undefined' &&
        typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
    }
    function ensureWorker() {
      if (WK.worker || WK.failed) return WK.worker;
      try {
        WK.worker = new Worker(opts.workerUrl || ATLAS_WORKER_URL);
        WK.worker.onmessage = onWorkerMessage;
        WK.worker.onerror = function (e) { workerFailed((e && e.message) || 'worker error'); };
      } catch (e) {
        workerFailed(e && e.message);
      }
      return WK.worker;
    }
    function workerFailed(reason) {
      if (WK.failed) return;
      WK.failed = true;
      if (typeof console !== 'undefined') console.warn('[decor] 背景建圖失敗，改在主執行緒分段畫：', reason);
      if (WK.worker) { try { WK.worker.terminate(); } catch (_) { /* 已經停了 */ } WK.worker = null; }
      WK.pending = {};
      if (D.building && D.building.worker) D.building = planAtlas(D.building.kitKey, D.building.deep);
      if (D.prebuild && D.prebuild.worker) D.prebuild = null;
    }
    function onWorkerMessage(e) {
      var m = e.data || {};
      var plan = WK.pending[m.id];
      delete WK.pending[m.id];
      if (!plan) { if (m.bitmap && m.bitmap.close) m.bitmap.close(); return; }
      if (m.error) { workerFailed(m.error); return; }
      plan.bitmap = m.bitmap;
      plan.done = true;
      if (D.building === plan) {
        D.building = null;
        putCache(plan);
        if (D.target && plan.key === D.target.key) activate(plan);
      } else if (D.prebuild === plan) {
        D.prebuild = null;
        putCache(plan);
      } else if (plan.bitmap && plan.bitmap.close) {
        plan.bitmap.close();   // 送出後換了地圖，這張已經用不到
      }
    }
    // 新開一張圖集：能用 Worker 就送過去，不能就在主執行緒分段畫
    function newBuild(kitKey, deep) {
      if (workerAvailable() && ensureWorker()) {
        var plan = layoutAtlas(kitKey, deep);
        plan.worker = true;
        plan.id = ++WK.seq;
        WK.pending[plan.id] = plan;
        WK.worker.postMessage({ id: plan.id, kitKey: kitKey, deep: deep });
        return plan;
      }
      return planAtlas(kitKey, deep);
    }
    function releasePlan(plan) {
      if (plan && plan.bitmap && plan.bitmap.close) plan.bitmap.close();
    }

    var D = {
      kitKey: null, deep: false, band: -1, atlas: null, baseTex: null, textures: {}, seedBase: 0,
      chunks: new Map(), lastChunkKey: '', pools: { decal: [], prop: [], flame: [], light: [], local: [] },
      particles: [], fogs: [], rays: [], lastCam: null, visible: true, time: 0,
      counts: { decals: 0, props: 0 },
      target: null, building: null, prebuild: null, cache: new Map(),
      localGroups: new Map(), localActive: [], localSelection: '', motionOn: true
    };

    function texFor(key) { return D.textures[key] || null; }

    function releaseAll() {
      D.localGroups.forEach(releaseLocalGroup);D.localGroups.clear();D.localActive.length=0;D.localSelection='';
      D.chunks.forEach(function (c) { releaseChunk(c); });
      D.chunks.clear();
      D.lastChunkKey = '';
    }

    // 卸下目前的圖集：節點回收、貼圖釋放（GPU），畫好的畫布留在快取
    function deactivate() {
      releaseAll();
      Object.keys(D.pools).forEach(function (k) {
        D.pools[k].forEach(function (s) { s.destroy(); });
        D.pools[k] = [];
      });
      clearParticles();
      for (var k2 in D.textures) if (D.textures[k2]) D.textures[k2].destroy(false);
      D.textures = {};
      if (D.baseTex) { D.baseTex.destroy(true); D.baseTex = null; }
      D.atlas = null;
    }

    function putCache(plan) {
      D.cache.delete(plan.key);
      D.cache.set(plan.key, plan);
      while (D.cache.size > CACHE_MAX) {
        var oldest = D.cache.keys().next().value;
        if (D.atlas && D.atlas.key === oldest && D.cache.size > 1) {
          // 正在用的那張不丟：挪到最新
          var cur = D.cache.get(oldest);
          D.cache.delete(oldest); D.cache.set(oldest, cur);
          oldest = D.cache.keys().next().value;
        }
        releasePlan(D.cache.get(oldest));
        D.cache.delete(oldest);
      }
    }

    function applyTarget() {
      var t = D.target;
      D.sceneKey = t.key;
      D.kitKey = t.kitKey;
      D.deep = t.deep;
      D.band = t.band;
      D.seedBase = strHash(t.key + ':' + t.band);
    }

    function activate(plan) {
      var source = plan.bitmap
        ? new PIXI.ImageSource({ resource: plan.bitmap, autoGenerateMipmaps: true, scaleMode: 'linear' })
        : new PIXI.CanvasSource({ resource: plan.canvas, autoGenerateMipmaps: true, scaleMode: 'linear' });
      D.baseTex = new PIXI.Texture({ source: source });
      plan.specs.forEach(function (s) {
        D.textures[s.key] = new PIXI.Texture({ source: source, frame: new PIXI.Rectangle(s.px, s.py, s.pw, s.ph) });
      });
      D.atlas = plan;
      applyTarget();
      setupAmbient();
    }

    function setScene(zoneKey, stageNum) {
      if (!enabled) return;
      var kitKey = KITS[zoneKey] ? zoneKey : '';
      var band = Math.max(0, Math.floor((Math.max(1, Number(stageNum) || 1) - 1) / STAGE_BAND));
      var deep = band % 2 === 1;
      var key = atlasKey(kitKey, deep);
      if (D.target && D.target.key === key && D.target.band === band) return;
      var sameAtlas = !!(D.target && D.target.key === key);
      D.target = { key: key, kitKey: kitKey, deep: deep, band: band };
      var kit = KITS[kitKey] || KITS[''];
      if (opts.onTint) opts.onTint(deep ? kit.deepTint : kit.tint);
      if (sameAtlas && D.atlas) {
        // 只換階段帶（例：地表第 1 帶 → 第 3 帶）：圖集不變，換一組種子重新擺放
        releaseAll();
        applyTarget();
        return;
      }
      if (sameAtlas && D.building) return;   // 還在畫同一張，畫完會套用新的帶
      deactivate();
      // 背景預建中的若不是要去的地方就丟掉；剛好是就接手繼續畫
      if (D.prebuild && D.prebuild.key !== key) D.prebuild = null;
      if (D.building && D.building.key !== key) D.building = null;
      var cached = D.cache.get(key);
      if (cached) {
        putCache(cached);
        D.building = null;
        activate(cached);
      } else if (!D.building) {
        if (D.prebuild) { D.building = D.prebuild; D.prebuild = null; }
        else D.building = newBuild(kitKey, deep);
      }
    }

    // 目前場景的圖集畫好之後，趁空檔把另一個階段帶（地表⇄地下）也先畫起來
    function prebuildStep() {
      if (!D.prebuild) {
        var t = D.target;
        if (!t) return;
        var other = atlasKey(t.kitKey, !t.deep);
        if (D.cache.has(other)) return;
        D.prebuild = newBuild(t.kitKey, !t.deep);
      }
      if (D.prebuild.worker) return;   // Worker 畫好會自己收進快取
      if (stepAtlas(D.prebuild, PREBUILD_BUDGET)) {
        putCache(D.prebuild);
        D.prebuild = null;
      }
    }

    /* ---- 物件池 ---- */
    function takeSprite(pool, tex, parent) {
      var s = D.pools[pool].pop();
      if (!s || s.destroyed) {
        s = new PIXI.Sprite(tex);
      } else {
        s.texture = tex;
      }
      s.visible = D.visible;   // 高塔戰期間整體隱藏時，新產生的區塊也跟著藏
      s.alpha = 1;
      s.tint = 0xffffff;
      s.rotation = 0;
      s.skew.x = 0;
      s.blendMode = pool === 'light' ? 'add' : 'normal';
      parent.addChild(s);
      return s;
    }
    function giveSprite(pool, s) {
      if (!s || s.destroyed) return;
      if (s.parent) s.parent.removeChild(s);
      D.pools[pool].push(s);
    }

    /* ---- 區塊 ---- */
    function buildChunk(cx, cy) {
      var atlas = D.atlas;
      var r = mulberry(hash3(cx, cy, D.seedBase));
      var chunk = { cx: cx, cy: cy, decals: [], props: [], flames: [], lights: [], emitters: [], debug: [] };
      var x0 = cx * CHUNK_W, y0 = cy * CHUNK_H;
      var nDecal = lite ? 2 : 2 + Math.floor(r() * 2);
      for (var i = 0; i < nDecal; i++) {
        var di = weightedPick(r, atlas.decals);
        var d = atlas.decals[di];
        var dv = d[0] === 'light' ? 0 : Math.floor(r() * VARIANTS);
        var tex = texFor('d' + di + '_' + dv);
        if (!tex) continue;
        var isLight = d[0] === 'light';
        var s = takeSprite(isLight ? 'light' : 'decal', tex, isLight ? lightLayer : decalLayer);
        s.anchor.set(0.5);
        var k = (1 / TEX_SCALE) * range(r, 0.8, 1.3);
        s.scale.set(k);
        s.rotation = r() * Math.PI * 2;
        s.x = x0 + r() * CHUNK_W;
        s.y = y0 + r() * CHUNK_H;
        s.alpha = isLight ? 0.55 : range(r, 0.75, 1);
        (isLight ? chunk.lights : chunk.decals).push(s);
        if(d[0]==='puddle'&&(D.kitKey==='swamp'||D.kitKey==='Icefield'))chunk.emitters.push({key:cx+':'+cy+':d'+i,x:s.x,y:s.y,height:0,kind:D.kitKey==='swamp'?'gas':'frost',seed:hash3(cx,cy,i)});
        if(d[0]==='divine')chunk.emitters.push({key:cx+':'+cy+':divine'+i,x:s.x,y:s.y,height:0,width:d[2]*k*TEX_SCALE,kind:'divine',seed:hash3(cx,cy,i)});
      }
      /* 擺件的位置、種類、縮放、翻面全由 BattleTerrain.layoutChunk 決定（純函式，模擬層擋路用的是同一份清單），
         這裡只把清單變成精靈。大型擺件每區塊 1～3 個（偶爾空一塊留白）加 1～2 個矮的小碎物，地標約 14% 機率。 */
      var items = BattleTerrain.layoutChunk(D.kitKey, D.deep, D.seedBase, cx, cy);
      function placeProp(p, texKey, px, py, k, flip) {
        var ptex = texFor(texKey);
        if (!ptex) return null;
        var ps = takeSprite('prop', ptex, propLayer);
        ps.anchor.set(0.5, (p[3] - FOOT) / p[3]);
        var sc = (1 / TEX_SCALE) * k;   // 貼圖是 TEX_SCALE 倍解析度，畫面上的尺寸＝邏輯尺寸 × k
        ps.scale.set(sc * flip, sc);
        ps._bbX = sc * flip; ps._bbY = sc;   // 貼圖自己的縮放；每幀的透視抵銷以它為底（見 billboardChunks）
        ps.x = px;
        ps.y = py * groundScale;
        ps.zIndex = ps.y;
        ps._decorH = p[3] * k;
        ps._decorW = p[2] * k;
        ps._natureSway = {dryGrass:.055,shrub:.035,grass:.045,reeds:.025,willow:.012,pine:.008,banner:.05}[p[0]] || 0;
        ps._naturePhase = (hash3(cx,cy,Math.floor(px+py))>>>0)/4294967296*Math.PI*2;
        var localKind = (D.atlas.kit.motion || {}).local;
        var localSource = localKind==='smoke'?p[0]==='deadTree':localKind==='gas'?p[0]==='stump':localKind==='frost'?p[0]==='crystals':localKind==='void'?p[0]==='crystals'||p[0]==='runeStone':localKind==='petal'?p[0]==='shrub':p[0]==='dryGrass';
        if(D.kitKey==='mist_forest')localSource=p[0]==='rootGate';
        if(D.kitKey==='lava_mountain'){
          localSource=['lavaVent','lavaOutcrop','magmaPool','burningLog','slagBoulder'].indexOf(p[0])>=0;
          localKind='fire';
        }
        if(D.kitKey==='thunder_peak')localSource=p[0]==='fulgurite'||p[0]==='stormSpire';
        if(D.kitKey==='desert'&&p[0]==='dryGrass'){localKind='dust';localSource=true;}
        if(localSource)chunk.emitters.push({key:cx+':'+cy+':p'+texKey+':'+px,x:px,y:py,
          height:localKind==='fire'?p[3]*k*({lavaVent:.36,lavaOutcrop:.42,magmaPool:.32,burningLog:.25,slagBoulder:.48}[p[0]]||0):localKind==='smoke'?p[3]*k*.65:8,
          width:p[2]*k,scale:k,anchor:localKind==='fire'?ps:null,kind:localKind,seed:hash3(cx,cy,Math.floor(px))});
        var groundTex = texFor('foot_' + texKey);
        if (groundTex) {
          var gs = takeSprite('decal', groundTex, decalLayer);
          gs.anchor.set(0.5);
          // 圖集接觸區以俯視空間畫，地面容器負責 groundScale 與透視。
          gs.scale.set(sc * flip, sc);
          gs.x = px; gs.y = py;
          ps._decorGround = gs;
          chunk.decals.push(gs);
        }
        chunk.props.push(ps);
        return ps;
      }
      if (debugObstacles) {
        items.forEach(function (it0) {
          it0.shapes.forEach(function (e) {
            var dg = new PIXI.Graphics();
            dg.ellipse(e[0], e[1], e[2], e[3]).fill({ color: 0xff3030, alpha: 0.28 }).stroke({ width: 2, color: 0xff3030, alpha: 0.9 });
            decalLayer.addChild(dg);
            chunk.debug.push(dg);
          });
        });
      }
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        // 減量模式：只畫會擋路的障礙（看得到才不會被無形的東西擋住）與第一件
        if (lite && !it.solid && j > 0) continue;
        var isLm = it.src === 'L';
        var p = isLm ? atlas.landmarks[it.idx] : atlas.props[it.idx];
        if (!p) continue;
        var px = it.x, py = it.y, pk = it.k;
        var ps = placeProp(p, (isLm ? 'L' : 'p') + it.idx + '_' + it.variant, px, py, pk, it.flip);
        if (!ps) continue;
        if (!isLm && p[0] === 'brazier') {
          var ftex = texFor('flame' + it.idx + '_0');
          if (ftex) {
            var fl = takeSprite('flame', ftex, propLayer);
            fl._frames = [];
            for (var ff = 0; ff < FLAME_FRAMES; ff++) fl._frames.push(texFor('flame' + it.idx + '_' + ff) || ftex);
            fl.anchor.set(0.5, 1);
            fl.scale.set(1 / TEX_SCALE);
            fl.x = px;
            // 火盆碗口在腳底上方 0.58 × 高（見 drawBrazier 的 bowlY）
            fl.y = ps.y - p[3] * 0.58 * pk;
            fl._bbParent = ps; fl._bbOffY = fl.y - ps.y;   // 跟著火盆的矩陣走（見 billboardSprite）
            fl._bbX = fl._bbY = 1 / TEX_SCALE;
            fl.zIndex = ps.zIndex + 0.5;
            fl._phase = it.phase;
            fl._baseY = fl.y;
            chunk.flames.push(fl);
          }
          var glowTex = lightTexture();
          if (glowTex) {
            var lg = takeSprite('light', glowTex, lightLayer);
            lg.anchor.set(0.5);
            // dot 貼圖是 16 邏輯像素（×TEX_SCALE）；地面光圈直徑約 230 世界單位（地面平面再壓扁成橢圓）
            lg.scale.set(230 / (16 * TEX_SCALE));
            lg.tint = flameTint(p[4]);
            lg.x = px; lg.y = py;
            lg.alpha = 0.5;
            lg._phase = it.phase * 0.7;
            chunk.lights.push(lg);
            chunk.flames.push(lg);
          }
        }
      }
      return chunk;
    }

    function flameTint(pal) {
      var hex = (pal && pal.fire) || '#ff8a2a';
      return parseInt(hex.slice(1), 16);
    }
    function lightTexture() {
      return texFor('dot');
    }

    function releaseChunk(chunk) {
      if (chunk.debug) chunk.debug.forEach(function (g) { if (g.parent) g.parent.removeChild(g); g.destroy(); });
      chunk.decals.forEach(function (s) { giveSprite('decal', s); });
      chunk.props.forEach(function (s) { giveSprite('prop', s); });
      chunk.flames.forEach(function (s) { if (s.blendMode === 'add') return; giveSprite('flame', s); });
      chunk.lights.forEach(function (s) { giveSprite('light', s); });
    }

    function syncChunks(view) {
      var R = view.drawRect;
      // 畫得到的世界範圍：橫向直接換算；縱向是投影座標，換回世界要除以 groundScale。
      // 直立擺件的腳在畫面下緣以下仍可能露出上半身，所以下方多留一段。
      var wx0 = view.camX + (R.x - view.W / 2) - 160;
      var wx1 = view.camX + (R.x + R.width - view.W / 2) + 160;
      var wy0 = view.camY + (R.y - view.H / 2) / groundScale - 120;
      var wy1 = view.camY + (R.y + R.height - view.H / 2) / groundScale + 420;
      var cx0 = Math.floor(wx0 / CHUNK_W), cx1 = Math.floor(wx1 / CHUNK_W);
      var cy0 = Math.floor(wy0 / CHUNK_H), cy1 = Math.floor(wy1 / CHUNK_H);
      var key = cx0 + ',' + cx1 + ',' + cy0 + ',' + cy1;
      if (key === D.lastChunkKey) return;
      D.lastChunkKey = key;
      var want = {};
      for (var cy = cy0; cy <= cy1; cy++) {
        for (var cx = cx0; cx <= cx1; cx++) {
          var k = cx + ':' + cy;
          want[k] = true;
          if (!D.chunks.has(k)) D.chunks.set(k, buildChunk(cx, cy));
        }
      }
      D.chunks.forEach(function (c, k2) {
        if (!want[k2]) { releaseChunk(c); D.chunks.delete(k2); }
      });
      var nd = 0, np = 0;
      D.chunks.forEach(function (c) { nd += c.decals.length + c.lights.length; np += c.props.length; });
      D.counts.decals = nd; D.counts.props = np;
    }

    /* ---- 擋到玩家的擺件變半透明 ---- */
    function fadeNearPlayer(view) {
      var px = view.playerX, py = view.playerScreenY;
      if (px === undefined || py === undefined) return;
      D.chunks.forEach(function (c) {
        for (var i = 0; i < c.props.length; i++) {
          var s = c.props[i];
          // 擺件在玩家前面（腳底較低）、橫向蓋得到、高度蓋得到玩家身體才淡出
          var front = s.y > py && s.y - s._decorH < py + 4;
          var over = Math.abs(s.x - px) < s._decorW * 0.5 + 18;
          var target = front && over ? PLAYER_FADE_ALPHA : 1;
          if (s.alpha !== target) s.alpha += (target - s.alpha) * 0.25;
          if (Math.abs(s.alpha - target) < 0.02) s.alpha = target;
        }
      });
    }

    function animateFlames(dt) {
      D.chunks.forEach(function (c) {
        for (var i = 0; i < c.flames.length; i++) {
          var f = c.flames[i];
          var t = D.time * 9 + f._phase;
          var flick = 0.85 + 0.15 * Math.sin(t) * Math.sin(t * 1.7 + 1.3);
          if (f.blendMode === 'add') {
            f.alpha = 0.38 + 0.14 * flick;
          } else {
            // 序列幀約每秒 10 張（各火盆相位錯開），再疊一點縮放抖動
            if (f._frames && f._frames.length) {
              var fi = Math.floor(D.time * 10 + f._phase * 3) % f._frames.length;
              if (f.texture !== f._frames[fi]) f.texture = f._frames[fi];
            }
            // 只算火焰自己的縮放；實際寫進 sprite 在 billboardChunks（要乘上透視抵銷）
            f._bbY = (1 / TEX_SCALE) * (0.94 + 0.1 * flick);
            f._bbX = (1 / TEX_SCALE) * (0.97 + 0.05 * Math.sin(t * 1.3));
          }
        }
      });
    }

    /* 直立擺件與火焰抵銷畫面透視：鏡頭每幀都在動，shear 隨橫向位置變，所以每幀對所有在畫的擺件重算
       （數量約幾十個，每個只有幾次乘除）。加色的地面光暈在地面平面容器裡，本來就該跟地板一起透視，不碰。 */
    function billboardChunks() {
      var bb = opts.billboard;
      D.chunks.forEach(function (c) {
        for (var i = 0; i < c.props.length; i++) {
          var s = c.props[i];
          billboardSprite(s, bb, s._bbX, s._bbY);
          if(s._natureSway&&!lite)s.skew.x+=Math.sin(D.time*.85+s._naturePhase)*s._natureSway;
        }
        for (var j = 0; j < c.flames.length; j++) {
          var f = c.flames[j];
          if (f.blendMode === 'add' || !f._bbParent) continue;
          billboardSprite(f, bb, f._bbX, f._bbY, f._bbParent, 0, f._bbOffY);
        }
      });
    }

    /* ---- 天氣粒子（螢幕座標；鏡頭移動時跟著反向漂，看起來釘在場景裡） ----
       每種天氣用自己的貼圖：雪＝雪花（遠近兩層，近的大而快）、餘燼＝拉長的火星（沿速度方向轉、加法混色、閃爍）、
       螢火蟲／幽魂＝亮核光暈、魔力微粒＝四芒星（閃爍縮放）。聖域另有幾道緩慢明滅的斜射光柱。 */
    var AMB_TEX = { rain:'streak', snow: 'flake', dust: 'dot', embers: 'streak', fireflies: 'glow', wisps: 'glow', motes: 'spark' };
    var AMB_ADD = { embers: true, fireflies: true, motes: true };
    function clearParticles() {
      D.particles.forEach(function (p) { p.s.destroy(); });
      D.fogs.forEach(function (p) { p.s.destroy(); });
      (D.rays || []).forEach(function (p) { p.s.destroy(); });
      (D.river || []).forEach(function(s){s.destroy();});D.river=[];
      if(D.skyVeil){D.skyVeil.destroy();D.skyVeil=null;}
      D.particles = []; D.fogs = []; D.rays = [];
    }
    function setupAmbient() {
      clearParticles();
      if (!ambientLayer || !D.atlas) return;
      var amb = D.deep ? D.atlas.kit.deepAmbient : D.atlas.kit.ambient;
      if (!amb) return;
      D.ambient = amb;
      if(D.atlas.kit.skyRiver&&distantLayer){
        D.skyVeil=new PIXI.Sprite(texFor('skyVeil'));D.skyVeil.anchor.set(0);
        D.skyVeil.tint=D.kitKey==='god_sanctuary'?0x303c62:D.kitKey==='god_chaos'?0x09091f:0x1a1726;
        distantLayer.addChild(D.skyVeil);
        D.atlas.kit.skyRiver.colors.forEach(function(color){
          var river=new PIXI.Sprite(texFor('skyRiver'));river.anchor.set(.5);river.tint=color;
          river.blendMode='add';river._decorSkyRiver=true;distantLayer.addChild(river);D.river.push(river);
        });
      }
      var count = lite ? Math.round(amb.count * 0.4) : amb.count;
      var r = mulberry(D.seedBase ^ 99);
      var texKey = AMB_TEX[amb.kind] || 'dot';
      var tex = texFor(texKey) || texFor('dot');
      for (var i = 0; i < count; i++) {
        var s = new PIXI.Sprite(tex);
        s.anchor.set(0.5);
        s.tint = amb.color;
        s.blendMode = AMB_ADD[amb.kind] ? 'add' : 'normal';
        ambientLayer.addChild(s);
        D.particles.push(resetParticle({ s: s, r: r, tw: PARTICLE_W[texKey] || 16 }, true));
      }
      var fogN = lite ? 0 : (amb.fog || 0);
      var fogTex = texFor('fog');
      for (var k = 0; k < fogN; k++) {
        var f = new PIXI.Sprite(fogTex);
        f.anchor.set(0.5);
        f.tint = amb.fogTint || (amb.kind === 'fireflies' ? 0xb8d0b0 : 0xffffff);
        f.alpha = amb.fogAlpha || 0.22;
        f.scale.set(range(r, 1.6, 2.6) / TEX_SCALE * 2);
        ambientLayer.addChildAt(f, 0);
        D.fogs.push({ s: f, x: r(), y: range(r, 0.2, 0.9), vx: range(r, 0.004, 0.012) * (amb.fogWind || (r() < 0.5 ? -1 : 1)) });
      }
      var rayN = lite ? 0 : (amb.rays || 0);
      var rayTex = texFor('ray');
      for (var j = 0; j < rayN && rayTex; j++) {
        var ry = new PIXI.Sprite(rayTex);
        ry.anchor.set(0.5, 0);
        ry.tint = amb.rayColor || 0xfff0c0;
        ry.blendMode = 'add';
        ry.rotation = amb.rayAngle === undefined ? -0.38 : amb.rayAngle;
        ry.scale.set(range(r, 1.6, 2.6) / TEX_SCALE, range(r, 2.6, 3.4) / TEX_SCALE);
        ry.alpha = 0;
        ambientLayer.addChildAt(ry, 0);
        D.rays.push({ s: ry, x: (j + 0.3 + r() * 0.4) / rayN, phase: r() * 10, a: range(r, 0.07, 0.13) });
      }
    }
    function resetParticle(p, anywhere) {
      var r = p.r, kind = D.ambient.kind;
      var W = D.lastW || 800, H = D.lastH || 800;
      p.x = r() * W;
      p.y = anywhere ? r() * H : (kind === 'snow' || kind === 'rain' ? -10 : (kind === 'embers' || kind === 'motes' || kind === 'wisps' ? H + 10 : r() * H));
      p.life = 0;
      p.maxLife = range(r, 4, 9);
      p.phase = r() * 10;
      var size;
      if (kind === 'snow') {
        p.near = r() < 0.28;
        if (p.near) { p.vx = range(r, -22, 8); p.vy = range(r, 62, 96); size = range(r, 6, 10); p.a = range(r, 0.7, 0.95); }
        else { p.vx = range(r, -12, 6); p.vy = range(r, 26, 52); size = range(r, 2.5, 5); p.a = range(r, 0.45, 0.75); }
      }
      else if (kind === 'rain') { p.vx=range(r,-105,-70);p.vy=range(r,220,320);size=range(r,16,26);p.a=range(r,.16,.35); }
      else if (kind === 'dust') { p.vx = range(r, -42, -16); p.vy = range(r, -5, 5); size = range(r, 2, 5); p.a = range(r, 0.2, 0.45); }
      else if (kind === 'embers') { p.vx = range(r, -14, 14); p.vy = range(r, -62, -24); size = range(r, 7, 12); p.a = range(r, 0.6, 1); }
      else if (kind === 'fireflies') { p.vx = range(r, -14, 14); p.vy = range(r, -10, 10); size = range(r, 11, 18); p.a = range(r, 0.55, 1); }
      else if (kind === 'wisps') { p.vx = range(r, -8, 8); p.vy = range(r, -14, -5); size = range(r, 26, 44); p.a = range(r, 0.1, 0.2); }
      else { p.vx = range(r, -6, 6); p.vy = range(r, -18, -5); size = range(r, 6, 12); p.a = range(r, 0.5, 0.9); }
      p.size = size;
      p.s.scale.set(size / ((p.tw || 16) * TEX_SCALE));   // 貼圖是 tw 邏輯像素 × 圖集解析度
      p.s.rotation = 0;
      p.s.alpha = 0;
      return p;
    }
    function updateParticles(view, dt) {
      if (!D.particles.length && !D.fogs.length && !(D.rays && D.rays.length)) return;
      var W = view.W, H = view.H;
      D.lastW = W; D.lastH = H;
      // 鏡頭位移換成畫面上的反向漂移（視差 0.9：粒子在地面之上一點點）
      var dx = 0, dy = 0;
      if (D.lastCam) {
        dx = (view.camX - D.lastCam.x) * 0.9;
        dy = (view.camY - D.lastCam.y) * groundScale * 0.9;
        if (Math.abs(dx) > W || Math.abs(dy) > H) { dx = 0; dy = 0; }
      }
      D.lastCam = { x: view.camX, y: view.camY };
      var kind = D.ambient ? D.ambient.kind : '';
      var T = D.time;
      var far=view.drawRect||{x:0,y:0,width:W,height:H};
      if(D.skyVeil){D.skyVeil.x=far.x;D.skyVeil.y=far.y;D.skyVeil.width=far.width;D.skyVeil.height=far.height*.38;}
      // 遠景只做極小視差；上緣淡入的星河不蓋住中央戰鬥與角色。
      (D.river||[]).forEach(function(s,i){
        s.x=far.x+far.width*.5+Math.sin(T*.035+i)*far.width*.025-Math.sin(view.camX/2400)*far.width*.018;
        s.y=far.y+far.height*(.065+i*.045)+Math.sin(T*.045+i*1.6)*far.height*.009-Math.sin(view.camY/3200)*far.height*.006;
        s.width=far.width*(1.65+i*.10);s.height=far.height*(.40+i*.055);
        s.alpha=(i===1?.8:.48)*(D.deep?.8:1);
      });
      for (var i = 0; i < D.particles.length; i++) {
        var p = D.particles[i];
        p.life += dt;
        var sway = 0;
        if (kind === 'snow') sway = Math.sin(T * 1.6 + p.phase) * (p.near ? 22 : 12);
        else if (kind === 'fireflies') sway = Math.sin(T * 0.9 + p.phase) * 18;
        else if (kind === 'embers') sway = Math.sin(T * 2.3 + p.phase) * 8;
        p.x += p.vx * dt - dx * (kind === 'snow' && p.near ? 1.15 : 1);
        p.y += p.vy * dt - dy;
        var fade = Math.min(1, p.life / 0.8, (p.maxLife - p.life) / 0.8);
        var mul = 1;
        if (kind === 'fireflies') mul = 0.55 + 0.45 * Math.sin(T * 3 + p.phase * 2);
        else if (kind === 'embers') mul = 0.7 + 0.3 * Math.sin(T * 13 + p.phase * 5);
        p.s.alpha = Math.max(0, fade) * p.a * mul;
        p.s.x = p.x + sway;
        p.s.y = p.y;
        if (kind === 'rain') { p.s.rotation=Math.atan2(p.vy,p.vx); }
        else if (kind === 'embers') {
          // 火星沿著飛行方向拉長
          p.s.rotation = Math.atan2(p.vy, p.vx + Math.cos(T * 2.3 + p.phase) * 18);
        } else if (kind === 'motes') {
          var tw = 0.55 + 0.45 * Math.abs(Math.sin(T * 2.2 + p.phase));
          p.s.scale.set(p.size * tw / ((p.tw || 16) * TEX_SCALE));
          p.s.rotation = T * 0.6 + p.phase;
        }
        if (p.life > p.maxLife || p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) {
          resetParticle(p, p.life < p.maxLife);
          if (p.life === 0 && !(p.x >= 0 && p.x <= W)) p.x = Math.random() * W;
        }
      }
      for (var k = 0; k < D.fogs.length; k++) {
        var f = D.fogs[k];
        f.x += f.vx * dt - dx / W;
        if (f.x < -0.4) f.x += 1.8; else if (f.x > 1.4) f.x -= 1.8;
        f.s.x = f.x * W;
        f.s.y = f.y * H - dy;
      }
      for (var j = 0; D.rays && j < D.rays.length; j++) {
        var ry = D.rays[j];
        ry.x -= dx * 0.25 / W;
        if (ry.x < -0.3) ry.x += 1.6; else if (ry.x > 1.3) ry.x -= 1.6;
        ry.s.x = ry.x * W;
        ry.s.y = -H * 0.1;
        ry.s.alpha = ry.a * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(T * 0.35 + ry.phase)));
      }
    }

    function update(view) {
      if (!enabled) return;
      if (D.building && !D.building.worker) {
        if (stepAtlas(D.building, BUILD_BUDGET)) {
          var built = D.building;
          D.building = null;
          putCache(built);
          if (D.target && built.key === D.target.key) activate(built);
        }
      } else if (!D.building && D.atlas && PREBUILD_BUDGET > 0) {
        prebuildStep();
      }
      if (!D.atlas) return;
      var dt = Math.max(0, Math.min(0.1, view.dt || 0));
      if(!D.visible||!D.motionOn)dt=0;
      D.time += dt;
      syncChunks(view);
      fadeNearPlayer(view);
      animateFlames(dt);
      billboardChunks();
      updateLocalEffects(view);
      updateParticles(view, dt);
    }

    // 只選附近有限個源點；圖集煙團預先柔邊，不在每幀套模糊濾鏡。
    function releaseLocalGroup(group) {
      group.sprites.forEach(function(s){giveSprite('local',s);});
    }
    function updateLocalEffects(view) {
      var selection=D.lastChunkKey+':'+Math.floor(view.camX/96)+':'+Math.floor(view.camY/96);
      if(selection!==D.localSelection){
        D.localSelection=selection;
        var candidates=[];
        D.chunks.forEach(function(c){c.emitters.forEach(function(e){
          var dx=e.x-view.camX,dy=(e.y-view.camY)*groundScale;
          if(Math.abs(dx)<view.W/2+100&&Math.abs(dy)<view.H/2+100)candidates.push({e:e,d:dx*dx+dy*dy});
        });});
        candidates.sort(function(a,b){return a.d-b.d||(a.e.key<b.e.key?-1:1);});
        var wanted={},limit=lite?2:6;
        candidates.slice(0,limit).forEach(function(c){wanted[c.e.key]=c.e;});
        D.localGroups.forEach(function(group,key){if(!wanted[key]){releaseLocalGroup(group);D.localGroups.delete(key);}});
        Object.keys(wanted).forEach(function(key){
          if(D.localGroups.has(key))return;
          var e=wanted[key],sprites=[],n=lite?1:3;
          for(var i=0;i<n;i++){
            var bubble=e.kind==='gas'&&e.height===0&&i===0;
            var fire=e.kind==='fire'&&i===0,halo=e.kind==='fire'&&i===1;
            var divine=e.kind==='divine';
            var texture=divine?'divineOrbit':fire?'envFlame0':halo?'glow':bubble?'ripple':e.kind==='void'?'glow':e.kind==='petal'?'petal':e.kind==='dust'?'dot':'fog';
            var s=takeSprite('local',texFor(texture),divine?decalLayer:halo?(lightLayer||decalLayer):bubble?decalLayer:propLayer);s.anchor.set(.5);
            if(fire)s.anchor.set(.5,1);
            if(halo)s.blendMode='add';
            s._bbParent=fire?e.anchor:null;s._bbOffY=-e.height;s._bbOffX=0;
            s._decorLocal=true;s._natureBubble=bubble;s._natureIndex=i;s._natureTexture=texture;
            s._natureFireHalo=halo;
            s.tint=divine?(D.kitKey==='god_sanctuary'?[0xffebbe,0xa5c9f3,0xd9b9ed][i]:D.kitKey==='god_chaos'?[0x95bbef,0xbe89ef,0x7ce8ed][i]:0xf5c083):fire?0xffffff:halo?0xff661b:e.kind==='fire'?0x736460:e.kind==='gas'?0xa6b969:e.kind==='frost'?0xc5e6ee:e.kind==='void'?0xb297db:e.kind==='smoke'?0x9e9b8b:0xe5cfac;
            // 固定來源的形狀／深度只在取出池時設定；投影仍每幀跟隨腳點與鏡頭。
            if(fire){
              s._bbX=s._bbY=.63*e.scale/TEX_SCALE;
              s.zIndex=e.y*groundScale+.2;s.alpha=.90;s.rotation=0;
            }else if(halo){
              s.x=e.x;s.y=e.y;s.scale.set(e.width*.85/(PARTICLE_W.glow*TEX_SCALE));s.rotation=0;
            }
            sprites.push(s);
          }
          var frames=null;
          if(e.kind==='fire'){frames=[];for(var ef=0;ef<ENV_FIRE_FRAMES;ef++)frames.push(texFor('envFlame'+ef));}
          D.localGroups.set(key,{source:e,sprites:sprites,frames:frames,phase:(e.seed>>>0)/4294967296});
        });
        D.localActive=Array.from(D.localGroups.values());
      }
      for(var gi=0;gi<D.localActive.length;gi++){
        var group=D.localActive[gi];
        var e=group.source,phase=group.phase;
        for(var si=0;si<group.sprites.length;si++){
          var s=group.sprites[si];
          if(s._natureTexture==='divineOrbit'){
            var orbitSize=e.width*(.7+si*.17)/(128*TEX_SCALE);
            s.scale.set(orbitSize);s.x=e.x;s.y=e.y;
            s.rotation=D.time*(si%2?-.035:.025)+phase*6+si*1.4;
            s.alpha=.16+.08*Math.sin(D.time*.6+phase*6+si*2);
          }else if(s._natureTexture==='envFlame0'){
            var ft=D.time*24+phase*ENV_FIRE_FRAMES;
            s.texture=group.frames[Math.floor(ft)%ENV_FIRE_FRAMES];
            billboardSprite(s,opts.billboard,s._bbX,s._bbY,s._bbParent,s._bbOffX,s._bbOffY);
          }else if(s._natureFireHalo){
            s.alpha=.12+.025*Math.sin(D.time*5+phase*6);
          }else{
            var age=(D.time*.22+phase+s._natureIndex/3)%1,fade=Math.sin(age*Math.PI);
            if(s._natureBubble){
              s.x=e.x;s.y=e.y;s.scale.set((.15+age*.65)/TEX_SCALE);s.alpha=fade*.32;s.rotation=0;
            }else{
              var side=Math.sin(age*3+phase*6),fog=s._natureTexture==='fog',base=fog?.16:s._natureTexture==='glow'?.22:.3;
              s._bbX=s._bbY=base*(.6+age*.9);
              s.x=e.x+side*(fog?18:30);s.y=e.y*groundScale-e.height-age*(fog?40:32);
              s.zIndex=e.y*groundScale+.1;s.alpha=fade*(fog?.24:.65);
              s.rotation=fog?0:age*2;billboardSprite(s,opts.billboard,s._bbX,s._bbY);
            }
          }
        }
      }
    }

    function setVisible(on) {
      on = !!on && enabled;
      if (D.visible === on) return;
      D.visible = on;
      if (decalLayer) decalLayer.visible = on;
      if (lightLayer) lightLayer.visible = on;
      if (ambientLayer) ambientLayer.visible = on;
      if (distantLayer) distantLayer.visible = on;
      D.chunks.forEach(function (c) {
        c.props.forEach(function (s) { s.visible = on; });
        c.flames.forEach(function (s) { s.visible = on; });
      });
      D.localGroups.forEach(function(group){group.sprites.forEach(function(s){s.visible=on;});});
    }

    function stats() {
      return {
        enabled: enabled, lite: lite, scene: D.target ? D.target.key : null, band: D.target ? D.target.band : -1,
        ready: !!D.atlas, building: D.building ? (D.building.worker ? 'worker' : D.building.next + '/' + D.building.specs.length) : null,
        worker: WK.failed ? 'failed' : (WK.worker ? 'on' : 'off'),
        prebuilding: D.prebuild ? D.prebuild.key : null, cached: Array.from(D.cache.keys()),
        chunks: D.chunks.size, decals: D.counts.decals, props: D.counts.props, particles: D.particles.length + D.fogs.length + D.rays.length,
        skyRiver:(D.river||[]).length,localSources:D.localGroups.size,localParticles:Array.from(D.localGroups.values()).reduce(function(n,g){return n+g.sprites.length;},0),motion:D.motionOn,motionTime:D.time,
        atlas: D.atlas ? D.atlas.width + 'x' + D.atlas.height + (D.atlas.bitmap ? ' (worker)' : '') : null
      };
    }

    function destroy() {
      deactivate();
      D.cache.forEach(releasePlan);
      D.cache.clear();
      if (WK.worker) { try { WK.worker.terminate(); } catch (_) { /* 已經停了 */ } WK.worker = null; }
      WK.pending = {};
      D.building = null;
      D.prebuild = null;
      D.target = null;
    }

    return { setScene: setScene, update: update, setVisible: setVisible, setMotionEnabled:function(on){D.motionOn=!!on;}, stats: stats, destroy: destroy, enabled: enabled };
  }

  return {
    create: create,
    KITS: KITS,
    // 給預覽頁與測試用：畫出某張地圖（地表／地下）的整張圖集
    buildAtlas: buildAtlas,
    buildGround: buildGround,
    STAGE_BAND: STAGE_BAND,
    /* 程序化繪圖的小工具與共用畫法：封魔塔的魔王祭壇（js/battle-arena.js）沿用同一套筆觸，
       不另寫第二份（畫風才會一致）。只放純函式，不含任何執行期狀態。 */
    art: {
      mulberry: mulberry, strHash: strHash, shade: shade, shadeRgba: shadeRgba, rgba: rgba,
      lerp: lerp, range: range, pick: pick, blob: blob, pathPoly: pathPoly, pathSmooth: pathSmooth,
      shadowEllipse: shadowEllipse, speckle: speckle, drawFlame: drawFlame,
      particleDot: particleDot, particleFog: particleFog, FOOT: FOOT, TEX_SCALE: TEX_SCALE,
      billboardSprite: billboardSprite
    },
    _internals: { mulberry: mulberry, hash3: hash3, CHUNK_W: CHUNK_W, CHUNK_H: CHUNK_H, planAtlas: planAtlas, stepAtlas: stepAtlas, LANDMARKS: LANDMARKS }
  };
})();
