/* 封魔塔魔王祭壇（2026-10）
   ============================================================
   封魔塔的 BOSS 戰專用場景，刻意和野外任何一張地圖都不一樣：
     野外＝無邊際、依區塊無限長出來的地形（js/battle-decor.js）；
     祭壇＝一座**封閉的圓形競技場**，戰鬥就在場中央打，四周是黑暗。

   組成（全部執行期 Canvas 程序化畫，不讀圖檔；畫風沿用 battle-decor 的低多邊形分面筆觸）：
     地板    黑曜石石板，石縫透出塔色微光（取代野外的地磚，渲染器換 TilingSprite 的貼圖）
     法陣    場中央的召喚法陣：外圈符文帶（慢慢旋轉）＋五芒星與魔王之眼（呼吸發光），
             雙方都站在法陣裡。刻痕（暗色）與光（加色）分兩層，光的亮度跟著狂暴變化
     裂隙    法陣外緣向外放射的熔裂光痕
     深淵    圓場外整片壓黑，邊界外看不到東西＝「被關在祭壇裡」
     擺件    圓場邊緣一圈：黑曜石尖刺、角獸頭骨火盆、前排燭台；BOSS 身後一座帶角的魔門，
             門上兩隻眼睛會亮
     氣氛    灰燼飄落、火星上升、畫面四周隨心跳脈動（狂暴時心跳變快、變重）
     登場    BOSS 名字的標題卡

   三座塔各一套配色：試煉之塔＝血月（紅）、地獄之塔＝熔獄（金橙）、煉獄之塔＝冥火（綠）。

   純表現：模擬層一行不動。坐標系同 battle-decor：
     planeBase／planeGlow  地面平面（scale.y＝groundScale，子節點用世界座標）
     propLayer             實體層（畫面座標，zIndex＝腳底 y，和角色互相遮擋）
     ambientLayer          螢幕座標（粒子、心跳光暈）
     titleLayer            螢幕座標（標題卡，在所有戰鬥表現之上）
   ?arena=0 關閉（塔戰回到野外地板，A/B 對照用）。 */
var BossArena = (function () {
  'use strict';

  var ART = (typeof BattleDecor !== 'undefined' && BattleDecor.art) ? BattleDecor.art : null;
  var TEX_SCALE = 1.5;
  var FOOT = 8;

  /* ============ 三座塔的配色 ============ */
  var TIERS = {
    trial: {
      name: '血月祭壇',
      glow: '#ff2a3c', glowHi: '#ffb0b8', fire: '#ff3424', fire2: '#ffd2a8',
      stone: { light: '#4a3e46', base: '#221a20', dark: '#070507' },
      seam: '#ff2a3c', floor: '#18121a', portal: '#5a0610',
      ember: 0xff4a3a, ash: 0x9a8e90, edge: 0xc0101e, light: 0xff3a30
    },
    hell: {
      name: '熔獄王座',
      glow: '#ff8a14', glowHi: '#ffe6a0', fire: '#ff7010', fire2: '#fff0b0',
      stone: { light: '#4e3c30', base: '#261a14', dark: '#080504' },
      seam: '#ff7a10', floor: '#1a120e', portal: '#6a2604',
      ember: 0xffa030, ash: 0xa09080, edge: 0xd05008, light: 0xff8a20
    },
    purgatory: {
      name: '冥火祭壇',
      glow: '#7cff3a', glowHi: '#e4ffc0', fire: '#6aff2a', fire2: '#f0ffd0',
      stone: { light: '#3a4640', base: '#18201c', dark: '#040705' },
      seam: '#6aff2a', floor: '#101612', portal: '#0e3a08',
      ember: 0x9aff4a, ash: 0x8e9a90, edge: 0x2a9a10, light: 0x7aff3a
    }
  };
  function tierOf(boss) {
    if (boss && boss.purgatory) return 'purgatory';
    if (boss && boss.hell) return 'hell';
    return 'trial';
  }

  function art() {
    if (!ART) throw new Error('BossArena 需要先載入 js/battle-decor.js（共用繪圖工具）');
    return ART;
  }

  /* ============ 地板：黑曜石石板（可四方連續，渲染器以 TilingSprite 鋪） ============ */
  var FLOOR_SIZE = 256;
  function drawFloor(g, pal, seed) {
    DecorNature.drawArenaFloor(g,pal,seed,FLOOR_SIZE);
  }

  function environmentStyle(pal) {
    return {stone:pal.stone.base,light:pal.stone.light,dark:pal.stone.dark,soil:'#3f3832',moss:false,snow:false,
      theme:pal===TIERS.purgatory?'god_chaos':'undead_mountains',accent:pal.glow};
  }
  function drawRelic(g,w,h,r,pal) {
    var kind=pal===TIERS.trial?'grave':pal===TIERS.hell?'deadTree':'crystals';
    DecorNature.drawBody(g,kind,w/2,h-FOOT,w*.88,h-FOOT,Math.floor(r()*1e9),environmentStyle(pal));
  }

  /* ============ 法陣（白色線稿；由精靈 tint 上色，刻痕版與發光版共用） ============ */
  var SIGIL_SIZE = 768;
  // 程序化符文：在 w×h 的格子裡畫 3～5 筆
  function rune(g, r, w, h) {
    var A = art();
    var n = 3 + Math.floor(r() * 3);
    g.beginPath();
    for (var i = 0; i < n; i++) {
      var kind = r();
      var x1 = A.range(r, -w / 2, w / 2), y1 = A.range(r, -h / 2, h / 2);
      if (kind < 0.6) {
        g.moveTo(x1, y1);
        g.lineTo(A.range(r, -w / 2, w / 2), A.range(r, -h / 2, h / 2));
      } else if (kind < 0.85) {
        g.moveTo(x1 + w * 0.18, y1);
        g.arc(x1, y1, w * 0.18, 0, Math.PI * A.range(r, 1, 2));
      } else {
        g.moveTo(x1, -h / 2); g.lineTo(x1, h / 2);
      }
    }
    g.stroke();
  }
  // 外圈：雙線圓＋符文帶＋刻度（這一層會整片旋轉）
  function drawSigilRing(g, seed, glow) {
    var A = art(), r = A.mulberry(seed), c = SIGIL_SIZE / 2;
    g.save();
    g.translate(c, c);
    g.strokeStyle = '#ffffff';
    g.lineCap = 'round';
    if (glow) { g.shadowColor = '#ffffff'; g.shadowBlur = 14; }
    var k = glow ? 1.4 : 1;
    g.lineWidth = 5 * k; g.beginPath(); g.arc(0, 0, c * 0.96, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2 * k; g.beginPath(); g.arc(0, 0, c * 0.92, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3 * k; g.beginPath(); g.arc(0, 0, c * 0.76, 0, Math.PI * 2); g.stroke();
    // 刻度
    g.lineWidth = 1.6 * k;
    for (var t = 0; t < 72; t++) {
      var a = t / 72 * Math.PI * 2, long = t % 6 === 0;
      g.beginPath();
      g.moveTo(Math.cos(a) * c * 0.92, Math.sin(a) * c * 0.92);
      g.lineTo(Math.cos(a) * c * (long ? 0.87 : 0.895), Math.sin(a) * c * (long ? 0.87 : 0.895));
      g.stroke();
    }
    // 符文帶（沿切線排列）
    g.lineWidth = 2.2 * k;
    var N = 24;
    for (var i = 0; i < N; i++) {
      var ang = i / N * Math.PI * 2;
      g.save();
      g.rotate(ang);
      g.translate(0, -c * 0.815);
      rune(g, r, c * 0.07, c * 0.075);
      g.restore();
    }
    g.restore();
  }
  // 內圈：五芒星＋星角小圓＋內圓＋魔王之眼（這一層固定不轉，只呼吸發光）
  function drawSigilCore(g, seed, glow) {
    var A = art(), r = A.mulberry(seed), c = SIGIL_SIZE / 2;
    var R = c * 0.74;
    g.save();
    g.translate(c, c);
    g.strokeStyle = '#ffffff';
    g.fillStyle = '#ffffff';
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (glow) { g.shadowColor = '#ffffff'; g.shadowBlur = 16; }
    var k = glow ? 1.4 : 1;
    var star = [];
    for (var i = 0; i < 5; i++) {
      var a = -Math.PI / 2 + i / 5 * Math.PI * 2;
      star.push([Math.cos(a) * R, Math.sin(a) * R]);
    }
    g.lineWidth = 4 * k;
    g.beginPath();
    for (var j = 0; j <= 5; j++) {
      var p = star[(j * 2) % 5];
      if (j === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
    }
    g.stroke();
    // 星角小圓與符文
    star.forEach(function (p) {
      g.lineWidth = 2.5 * k;
      g.beginPath(); g.arc(p[0], p[1], c * 0.075, 0, Math.PI * 2); g.stroke();
      g.save(); g.translate(p[0], p[1]); g.lineWidth = 1.8 * k; rune(g, r, c * 0.06, c * 0.06); g.restore();
    });
    // 內圓（雙線）＋放射細線
    g.lineWidth = 3 * k; g.beginPath(); g.arc(0, 0, c * 0.3, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.4 * k; g.beginPath(); g.arc(0, 0, c * 0.26, 0, Math.PI * 2); g.stroke();
    for (var t = 0; t < 10; t++) {
      var aa = t / 10 * Math.PI * 2 + Math.PI / 10;
      g.beginPath();
      g.moveTo(Math.cos(aa) * c * 0.3, Math.sin(aa) * c * 0.3);
      g.lineTo(Math.cos(aa) * c * 0.42, Math.sin(aa) * c * 0.42);
      g.stroke();
    }
    // 魔王之眼：直立的杏仁形眼眶＋縱向瞳孔
    var ew = c * 0.17, eh = c * 0.085;
    g.lineWidth = 3 * k;
    g.beginPath();
    g.moveTo(-ew, 0);
    g.quadraticCurveTo(0, -eh * 2, ew, 0);
    g.quadraticCurveTo(0, eh * 2, -ew, 0);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.ellipse(0, 0, c * 0.022, eh * 0.85, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /* ============ 法陣外緣的熔裂光痕（白色，加色層 tint） ============ */
  var CRACK_SIZE = 768;
  function drawCracks(g, seed, innerFrac) {
    var A = art(), r = A.mulberry(seed), c = CRACK_SIZE / 2;
    g.save();
    g.translate(c, c);
    g.strokeStyle = '#ffffff';
    g.lineCap = 'round'; g.lineJoin = 'round';
    // 裂紋走深色材質；祭壇法陣另有自己的發光層。
    g.shadowBlur = 0;
    var N = 13;
    for (var i = 0; i < N; i++) {
      var a = (i + A.range(r, -0.3, 0.3)) / N * Math.PI * 2;
      var rad = c * innerFrac * A.range(r, 0.96, 1.02);
      var len = c * A.range(r, 0.3, 0.55);
      var steps = 7;
      var x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      g.lineWidth = A.range(r, 2.2, 3.6);
      g.beginPath(); g.moveTo(x, y);
      for (var s = 1; s <= steps; s++) {
        var t = s / steps;
        var aa = a + A.range(r, -0.08, 0.08);
        x = Math.cos(aa) * (rad + len * t); y = Math.sin(aa) * (rad + len * t);
        g.lineTo(x, y);
        if (s === 3 && r() < 0.7) {   // 分岔
          g.save();
          g.lineWidth *= 0.6;
          var bx = x, by = y, ba = aa + (r() < 0.5 ? -1 : 1) * A.range(r, 0.15, 0.3);
          for (var b = 0; b < 3; b++) { bx += Math.cos(ba) * len * 0.12; by += Math.sin(ba) * len * 0.12; g.lineTo(bx, by); }
          g.moveTo(x, y);
          g.restore();
        }
      }
      g.stroke();
    }
    g.restore();
  }

  /* ============ 深淵：圓場外整片壓黑（中心透明，邊緣接近全黑） ============ */
  /* 貼圖會拉到圓場的 ABYSS_SPAN 倍大：圓場邊緣（半徑比 1/ABYSS_SPAN＝0.25）以內透明，
     往外很快壓到接近全黑，而且一路黑到貼圖邊——畫面再大、鏡頭再偏也看不到亮的地板。 */
  var ABYSS_SPAN = 4;
  function drawAbyss(g, size) {
    var c = size / 2;
    var gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.24, 'rgba(0,0,0,0)');
    gr.addColorStop(0.31, 'rgba(0,0,0,0.45)');
    gr.addColorStop(0.4, 'rgba(0,0,0,0.82)');
    gr.addColorStop(0.5, 'rgba(0,0,0,0.94)');
    gr.addColorStop(1, 'rgba(0,0,0,0.97)');
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
  }
  // 畫面四周的心跳光暈（白色，螢幕層 tint＋加色）
  function drawEdgeGlow(g, size) {
    var c = size / 2;
    var gr = g.createRadialGradient(c, c, c * 0.45, c, c, c * 1.05);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
  }

  /* ============ 直立擺件（座標是邏輯像素；腳底在 (w/2, h - FOOT)） ============ */
  // 黑曜石尖刺：一根主刺＋兩根副刺，刺面有塔色的發光裂紋
  function drawSpike(g, w, h, r, pal) {
    var A = art(), fy = h - FOOT, cx = w / 2;
    A.shadowEllipse(g, cx + 4, fy, w * 0.42, w * 0.11, 0.55);
    function shard(bx, bw, sh, lean) {
      var tip = [bx + lean, fy - sh];
      var left = [bx - bw / 2, fy], right = [bx + bw / 2, fy];
      var mid = [bx + lean * 0.35 + A.range(r, -bw * 0.1, bw * 0.1), fy - sh * A.range(r, 0.15, 0.3)];
      A.pathPoly(g, [left, tip, mid]);
      var gl = g.createLinearGradient(left[0], fy, tip[0], tip[1]);
      gl.addColorStop(0, A.shade(pal.stone.base, -0.2)); gl.addColorStop(1, pal.stone.light);
      g.fillStyle = gl; g.fill();
      A.pathPoly(g, [mid, tip, right]);
      var grr = g.createLinearGradient(mid[0], fy, right[0], tip[1]);
      grr.addColorStop(0, pal.stone.dark); grr.addColorStop(1, A.shade(pal.stone.base, -0.15));
      g.fillStyle = grr; g.fill();
      A.pathPoly(g, [left, tip, right]);
      g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 1; g.stroke();
      // 稜線受光
      g.strokeStyle = A.rgba(pal.glowHi, 0.18); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(mid[0], mid[1]); g.lineTo(tip[0], tip[1]); g.stroke();
      // 發光裂紋
      g.save();
      g.shadowColor = pal.glow; g.shadowBlur = 8;
      g.strokeStyle = A.rgba(pal.glow, 0.85); g.lineWidth = 1.4;
      g.beginPath();
      var x = bx + A.range(r, -bw * 0.15, bw * 0.15), y = fy - 4;
      g.moveTo(x, y);
      for (var s = 0; s < 5; s++) { x += A.range(r, -4, 4) + lean * 0.08; y -= sh * A.range(r, 0.08, 0.14); g.lineTo(x, y); }
      g.stroke();
      g.restore();
    }
    shard(cx - w * 0.22, w * 0.3, h * A.range(r, 0.45, 0.55), -w * 0.12);
    shard(cx + w * 0.24, w * 0.26, h * A.range(r, 0.38, 0.5), w * 0.1);
    shard(cx, w * 0.42, h - FOOT - 4, A.range(r, -w * 0.08, w * 0.08));
    // 底部碎石
    for (var i = 0; i < 5; i++) {
      var px = cx + A.range(r, -w * 0.4, w * 0.4), pw = A.range(r, 5, 10);
      A.pathPoly(g, [[px - pw, fy], [px, fy - pw * 0.9], [px + pw, fy]]);
      g.fillStyle = A.shade(pal.stone.base, -0.3); g.fill();
    }
  }

  // 角獸頭骨火盆：疊石底座＋上翹的角＋頭骨碗（眼窩透光）；火焰另外一張
  function drawDemonBrazier(g, w, h, r, pal) {
    var A = art(), fy = h - FOOT, cx = w / 2;
    A.shadowEllipse(g, cx + 4, fy, w * 0.4, w * 0.1, 0.5);
    // 底座三層
    var blocks = [[w * 0.62, h * 0.12], [w * 0.46, h * 0.3], [w * 0.56, h * 0.08]];
    var y = fy;
    blocks.forEach(function (b, i) {
      var bw = b[0], bh = b[1];
      var gr = g.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
      gr.addColorStop(0, A.shade(pal.stone.base, 0.15)); gr.addColorStop(0.4, pal.stone.base); gr.addColorStop(1, pal.stone.dark);
      g.fillStyle = gr;
      g.fillRect(cx - bw / 2, y - bh, bw, bh);
      g.fillStyle = A.rgba(pal.stone.light, 0.6);
      g.fillRect(cx - bw / 2, y - bh, bw, 2);
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1;
      g.strokeRect(cx - bw / 2 + 0.5, y - bh + 0.5, bw - 1, bh - 1);
      if (i === 1) {   // 中段刻一道塔色符紋
        g.save(); g.shadowColor = pal.glow; g.shadowBlur = 6;
        g.strokeStyle = A.rgba(pal.glow, 0.7); g.lineWidth = 1.3;
        g.beginPath(); g.moveTo(cx, y - bh * 0.2); g.lineTo(cx, y - bh * 0.8);
        g.moveTo(cx - bw * 0.18, y - bh * 0.55); g.lineTo(cx + bw * 0.18, y - bh * 0.55); g.stroke();
        g.restore();
      }
      y -= bh;
    });
    var bowlY = y;            // 頭骨碗口
    var sw = w * 0.5;
    // 角：從頭骨兩側往上翹
    [-1, 1].forEach(function (side) {
      g.beginPath();
      g.moveTo(cx + side * sw * 0.32, bowlY - 2);
      g.quadraticCurveTo(cx + side * sw * 1.05, bowlY - 2, cx + side * sw * 0.86, bowlY - h * 0.2);
      g.quadraticCurveTo(cx + side * sw * 0.8, bowlY - h * 0.08, cx + side * sw * 0.48, bowlY + 6);
      g.closePath();
      var hg = g.createLinearGradient(cx, bowlY, cx + side * sw, bowlY - h * 0.2);
      hg.addColorStop(0, '#5a4a40'); hg.addColorStop(1, '#d8ccb4');
      g.fillStyle = hg; g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.stroke();
    });
    // 頭骨（正面）
    g.beginPath();
    g.moveTo(cx - sw * 0.42, bowlY);
    g.quadraticCurveTo(cx - sw * 0.46, bowlY + h * 0.1, cx - sw * 0.2, bowlY + h * 0.13);
    g.lineTo(cx + sw * 0.2, bowlY + h * 0.13);
    g.quadraticCurveTo(cx + sw * 0.46, bowlY + h * 0.1, cx + sw * 0.42, bowlY);
    g.closePath();
    var sg = g.createLinearGradient(cx - sw / 2, bowlY, cx + sw / 2, bowlY + h * 0.12);
    sg.addColorStop(0, '#e2d8c2'); sg.addColorStop(1, '#6e6252');
    g.fillStyle = sg; g.fill();
    g.strokeStyle = 'rgba(10,6,4,0.8)'; g.lineWidth = 1.1; g.stroke();
    // 眼窩透光
    g.save();
    g.shadowColor = pal.glow; g.shadowBlur = 8; g.fillStyle = pal.glow;
    [-1, 1].forEach(function (side) {
      g.beginPath(); g.ellipse(cx + side * sw * 0.16, bowlY + h * 0.05, sw * 0.08, sw * 0.06, 0, 0, Math.PI * 2); g.fill();
    });
    g.restore();
    // 碗口炭火
    var coal = g.createRadialGradient(cx, bowlY, 0, cx, bowlY, sw * 0.42);
    coal.addColorStop(0, pal.fire2); coal.addColorStop(0.5, pal.fire); coal.addColorStop(1, '#200606');
    g.fillStyle = coal;
    g.beginPath(); g.ellipse(cx, bowlY, sw * 0.42, sw * 0.1, 0, 0, Math.PI * 2); g.fill();
  }

  // 燭台：一小堆骨頭上插著高低不一的蠟燭，燭火是塔色
  function drawCandles(g, w, h, r, pal) {
    var A = art(), fy = h - FOOT, cx = w / 2;
    A.shadowEllipse(g, cx + 3, fy, w * 0.42, w * 0.12, 0.45);
    // 骨堆
    for (var b = 0; b < 4; b++) {
      var bx = cx + A.range(r, -w * 0.3, w * 0.3), by = fy - A.range(r, 0, 5);
      g.save(); g.translate(bx, by); g.rotate(A.range(r, -0.5, 0.5));
      g.fillStyle = '#b8ac94';
      g.fillRect(-w * 0.16, -1.6, w * 0.32, 3.2);
      g.beginPath(); g.arc(-w * 0.16, 0, 2.6, 0, Math.PI * 2); g.arc(w * 0.16, 0, 2.6, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    var n = 4 + Math.floor(r() * 3);
    var candles = [];
    for (var i = 0; i < n; i++) {
      candles.push({ x: cx + A.range(r, -w * 0.32, w * 0.32), hgt: A.range(r, h * 0.25, h * 0.62), wd: A.range(r, 4.5, 7) });
    }
    candles.sort(function (a, b2) { return a.hgt - b2.hgt; });
    candles.forEach(function (c2) {
      var top = fy - 3 - c2.hgt;
      var wg = g.createLinearGradient(c2.x - c2.wd / 2, 0, c2.x + c2.wd / 2, 0);
      wg.addColorStop(0, '#e8dcc0'); wg.addColorStop(1, '#7a6a52');
      g.fillStyle = wg;
      g.fillRect(c2.x - c2.wd / 2, top, c2.wd, c2.hgt);
      // 蠟淚
      g.fillStyle = '#efe4cc';
      g.fillRect(c2.x - c2.wd / 2, top, c2.wd, 2.5);
      g.fillRect(c2.x - c2.wd / 2 + A.range(r, 0, c2.wd - 1.5), top, 1.5, A.range(r, 4, 10));
      // 燭火（小，靜態；整體的光暈另由地面光圈負責）
      g.save();
      g.shadowColor = pal.fire; g.shadowBlur = 8;
      g.fillStyle = pal.fire;
      g.beginPath(); g.ellipse(c2.x, top - 5, 2.6, 5.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = pal.fire2;
      g.beginPath(); g.ellipse(c2.x, top - 4, 1.2, 2.8, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    });
  }

  // 魔門：BOSS 身後的巨大門框，門楣是一張帶角的魔王臉，門內是塔色的深淵漩渦
  function drawGate(g, w, h, r, pal) {
    var A = art(), fy = h - FOOT, cx = w / 2;
    A.shadowEllipse(g, cx, fy, w * 0.52, w * 0.09, 0.6);
    var pw = w * 0.17;                 // 柱寬
    var inner = w * 0.5;               // 門洞寬
    var archTop = fy - h * 0.72;       // 門洞頂
    // 門洞：深淵漩渦
    g.save();
    g.beginPath();
    g.moveTo(cx - inner / 2, fy);
    g.lineTo(cx - inner / 2, archTop + inner * 0.3);
    g.quadraticCurveTo(cx, archTop - inner * 0.25, cx + inner / 2, archTop + inner * 0.3);
    g.lineTo(cx + inner / 2, fy);
    g.closePath();
    g.clip();
    var pg = g.createRadialGradient(cx, fy - h * 0.38, 0, cx, fy - h * 0.38, h * 0.5);
    pg.addColorStop(0, pal.glowHi); pg.addColorStop(0.18, pal.glow); pg.addColorStop(0.5, pal.portal); pg.addColorStop(1, '#000000');
    g.fillStyle = pg;
    g.fillRect(cx - inner, archTop - inner, inner * 2, h);
    g.strokeStyle = A.rgba(pal.glowHi, 0.25);
    g.lineWidth = 2;
    for (var sp = 0; sp < 5; sp++) {   // 漩渦線
      g.beginPath();
      for (var t = 0; t <= 40; t++) {
        var a = t / 40 * Math.PI * 3 + sp * 1.26, rad = t / 40 * inner * 0.7;
        var x = cx + Math.cos(a) * rad, y = fy - h * 0.38 + Math.sin(a) * rad * 1.2;
        if (t === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.restore();
    // 兩根柱子（帶尖刺）
    [-1, 1].forEach(function (side) {
      var x0 = cx + side * (inner / 2 + pw / 2);
      var gr = g.createLinearGradient(x0 - pw / 2, 0, x0 + pw / 2, 0);
      if (side < 0) { gr.addColorStop(0, pal.stone.light); gr.addColorStop(1, pal.stone.dark); }
      else { gr.addColorStop(0, pal.stone.base); gr.addColorStop(1, pal.stone.dark); }
      g.fillStyle = gr;
      A.pathPoly(g, [[x0 - pw / 2, fy], [x0 - pw * 0.42, archTop - h * 0.05], [x0 + pw * 0.42, archTop - h * 0.05], [x0 + pw / 2, fy]]);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 1.2; g.stroke();
      for (var k = 0; k < 3; k++) {   // 柱身外側的尖刺
        var sy = fy - h * (0.18 + k * 0.17), sx = x0 + side * pw / 2;
        A.pathPoly(g, [[sx, sy], [sx + side * pw * 0.55, sy - pw * 0.25], [sx, sy - pw * 0.35]]);
        g.fillStyle = A.shade(pal.stone.base, -0.2); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.6)'; g.stroke();
      }
      // 柱上的發光符文
      g.save(); g.shadowColor = pal.glow; g.shadowBlur = 8; g.strokeStyle = A.rgba(pal.glow, 0.8); g.lineWidth = 1.6;
      for (var q = 0; q < 3; q++) {
        g.save(); g.translate(x0, fy - h * (0.2 + q * 0.15)); rune(g, r, pw * 0.5, pw * 0.5); g.restore();
      }
      g.restore();
    });
    // 門楣：帶角的魔王臉
    var fyTop = archTop - h * 0.04, faceW = w * 0.56, faceH = h * 0.2;
    [-1, 1].forEach(function (side) {   // 大角
      g.beginPath();
      g.moveTo(cx + side * faceW * 0.3, fyTop - faceH * 0.5);
      g.bezierCurveTo(cx + side * faceW * 0.95, fyTop - faceH * 0.6, cx + side * w * 0.52, fyTop - faceH * 1.2, cx + side * w * 0.46, fyTop - faceH * 1.75);
      g.bezierCurveTo(cx + side * w * 0.42, fyTop - faceH * 1.2, cx + side * faceW * 0.62, fyTop - faceH * 0.55, cx + side * faceW * 0.32, fyTop - faceH * 0.15);
      g.closePath();
      var hg = g.createLinearGradient(cx, fyTop, cx + side * w * 0.5, fyTop - faceH * 1.7);
      hg.addColorStop(0, '#3a2e2a'); hg.addColorStop(0.7, '#a89880'); hg.addColorStop(1, '#efe6d2');
      g.fillStyle = hg; g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1.2; g.stroke();
    });
    // 臉（倒梯形＋顴骨分面）
    var face = [[cx - faceW / 2, fyTop - faceH * 0.6], [cx + faceW / 2, fyTop - faceH * 0.6], [cx + faceW * 0.3, fyTop + faceH * 0.35], [cx, fyTop + faceH * 0.55], [cx - faceW * 0.3, fyTop + faceH * 0.35]];
    A.pathPoly(g, face);
    var fg = g.createLinearGradient(cx - faceW / 2, fyTop - faceH, cx + faceW / 2, fyTop + faceH * 0.5);
    fg.addColorStop(0, pal.stone.light); fg.addColorStop(0.5, pal.stone.base); fg.addColorStop(1, pal.stone.dark);
    g.fillStyle = fg; g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.8)'; g.lineWidth = 1.3; g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx, fyTop - faceH * 0.6); g.lineTo(cx, fyTop + faceH * 0.55); g.stroke();
    // 眉骨與眼窩（眼睛的亮光另外一張精靈做脈動）
    [-1, 1].forEach(function (side) {
      A.pathPoly(g, [[cx + side * faceW * 0.06, fyTop - faceH * 0.18], [cx + side * faceW * 0.36, fyTop - faceH * 0.36], [cx + side * faceW * 0.3, fyTop - faceH * 0.02]]);
      g.fillStyle = '#000000'; g.fill();
    });
    // 獠牙
    g.fillStyle = '#d8ccb4';
    [-1, 1].forEach(function (side) {
      A.pathPoly(g, [[cx + side * faceW * 0.08, fyTop + faceH * 0.3], [cx + side * faceW * 0.14, fyTop + faceH * 0.75], [cx + side * faceW * 0.19, fyTop + faceH * 0.22]]);
      g.fill();
    });
    // 門檻
    g.fillStyle = A.shade(pal.stone.base, -0.1);
    g.fillRect(cx - w * 0.44, fy - h * 0.035, w * 0.88, h * 0.035);
    g.fillStyle = A.rgba(pal.stone.light, 0.6);
    g.fillRect(cx - w * 0.44, fy - h * 0.035, w * 0.88, 1.5);
  }

  /* 擺件規格：[種類, 寬, 高]（邏輯像素） */
  var PROP_SPECS = {
    relic: {draw:drawRelic,w:112,h:156,variants:2},
    spike: { draw: drawSpike, w: 96, h: 168, variants: 3 },
    spikeSmall: { draw: drawSpike, w: 64, h: 104, variants: 2 },
    brazier: { draw: drawDemonBrazier, w: 72, h: 120, variants: 1 },
    candles: { draw: drawCandles, w: 60, h: 58, variants: 2 },
    gate: { draw: drawGate, w: 300, h: 330, variants: 1 }
  };

  /* ============ 貼圖（每座塔一份，第一次進場時畫，之後重用） ============ */
  var _texCache = {};
  function canvasOf(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function buildTextures(PIXI, tierKey) {
    if (_texCache[tierKey]) return _texCache[tierKey];
    var A = art(), pal = TIERS[tierKey];
    var seed = A.strHash('arena:' + tierKey);
    function tex(canvas, mip) {
      var src = new PIXI.CanvasSource({ resource: canvas, autoGenerateMipmaps: mip !== false, scaleMode: 'linear' });
      return new PIXI.Texture({ source: src });
    }
    function paint(w, h, fn) { var c = canvasOf(w, h); fn(c.getContext('2d')); return c; }
    var T = { pal: pal, props: {} };
    T.floor = tex(paint(FLOOR_SIZE, FLOOR_SIZE, function (g) { drawFloor(g, pal, seed); }), false);
    T.ringLine = tex(paint(SIGIL_SIZE, SIGIL_SIZE, function (g) { drawSigilRing(g, seed ^ 1, false); }));
    T.ringGlow = tex(paint(SIGIL_SIZE, SIGIL_SIZE, function (g) { drawSigilRing(g, seed ^ 1, true); }));
    T.coreLine = tex(paint(SIGIL_SIZE, SIGIL_SIZE, function (g) { drawSigilCore(g, seed ^ 2, false); }));
    T.coreGlow = tex(paint(SIGIL_SIZE, SIGIL_SIZE, function (g) { drawSigilCore(g, seed ^ 2, true); }));
    T.cracks = tex(paint(CRACK_SIZE, CRACK_SIZE, function (g) { drawCracks(g, seed ^ 3, CRACK_INNER); }));
    T.abyss = tex(paint(256, 256, function (g) { drawAbyss(g, 256); }));
    T.edge = tex(paint(256, 256, function (g) { drawEdgeGlow(g, 256); }));
    T.contact = tex(paint(180,64,function(g){DecorNature.drawContact(g,90,32,138,seed^19,environmentStyle(pal));}));
    T.fog = tex(paint(96,96,function(g){var gr=g.createRadialGradient(48,48,0,48,48,48);gr.addColorStop(0,'rgba(210,211,196,.4)');gr.addColorStop(.6,'rgba(180,182,172,.15)');gr.addColorStop(1,'transparent');g.fillStyle=gr;g.fillRect(0,0,96,96);}));
    T.dot = tex(paint(24, 24, function (g) { A.particleDot(g, 24, 24); }));
    T.flame = tex(paint(Math.ceil(40 * TEX_SCALE), Math.ceil(56 * TEX_SCALE), function (g) {
      g.scale(TEX_SCALE, TEX_SCALE); A.drawFlame(g, 40, 56, A.mulberry(seed ^ 4), { fire: pal.fire, fire2: pal.fire2 });
    }));
    Object.keys(PROP_SPECS).forEach(function (key) {
      var spec = PROP_SPECS[key];
      T.props[key] = [];
      for (var v = 0; v < spec.variants; v++) {
        var c = paint(Math.ceil(spec.w * TEX_SCALE), Math.ceil(spec.h * TEX_SCALE), function (g) {
          g.scale(TEX_SCALE, TEX_SCALE);
          try { spec.draw(g, spec.w, spec.h, A.mulberry(seed ^ A.strHash(key + v)), pal); }
          catch (e) { if (typeof console !== 'undefined') console.warn('[arena] 畫 ' + key + ' 失敗', e); }
        });
        T.props[key].push(tex(c));
      }
    });
    _texCache[tierKey] = T;
    return T;
  }

  /* 法陣外緣在裂隙貼圖上的半徑比例（裂隙從這裡往外長） */
  var CRACK_INNER = 0.42;

  function queryOff() {
    try { return /[?&]arena=(0|off)(&|$)/.test(location.search || ''); } catch (e) { return false; }
  }

  /* ============ 執行期 ============ */
  function create(opts) {
    var PIXI = opts.PIXI;
    var groundScale = opts.groundScale || 0.5;
    var enabled = !queryOff() && !!ART;
    var A = ART;
    var R = {
      on: false, tier: null, T: null, cx: 0, cy: 0, rx: 0, ry: 0,
      time: 0, ignite: 0, enraged: false, enrageFlash: 0,
      base: [], glow: [], props: [], flames: [], eyes: [], lights: [],
      local: [], particles: [], edge: null, title: null, rng: null
    };

    function sprite(tex, parent) {
      var s = new PIXI.Sprite(tex);
      parent.addChild(s);
      return s;
    }
    function clearAll() {
      R.base.concat(R.glow, R.props, R.flames, R.eyes, R.lights).forEach(function (s) { if (s && !s.destroyed) s.destroy(); });
      R.particles.concat(R.local).forEach(function (p) { if (!p.s.destroyed) p.s.destroy(); });
      if (R.edge && !R.edge.destroyed) R.edge.destroy();
      if (R.title && !R.title.root.destroyed) R.title.root.destroy({ children: true });
      R.base = []; R.glow = []; R.props = []; R.flames = []; R.eyes = []; R.lights = [];
      R.local = []; R.particles = []; R.edge = null; R.title = null;
    }

    /* 進場：center 是世界座標（雙方開場站位的中點）；view 給畫面尺寸，用來決定圓場多大——
       圓場邊緣的擺件要剛好落在畫面四周，太大看不到、太小會把戰鬥擠在一起。 */
    function enter(o) {
      if (!enabled) return false;
      clearAll();
      var tierKey = TIERS[o.tier] ? o.tier : 'trial';
      var T = buildTextures(PIXI, tierKey);
      R.on = true; R.tier = tierKey; R.T = T;
      R.cx = o.cx; R.cy = o.cy;
      R.time = 0; R.ignite = 0; R.enraged = false; R.enrageFlash = 0;
      R.rng = A.mulberry(A.strHash(tierKey + ':' + Math.round(o.cx) + ':' + Math.round(o.cy)));
      var W = o.W || 800, H = o.H || 800;
      R.viewH = H;
      // 圓場（世界單位）：橫向約畫面寬的 0.46，縱向約畫面高的 0.4（畫面上是一半，所以世界單位要除以 groundScale）
      R.rx = Math.max(260, Math.min(560, W * 0.46));
      R.ry = Math.max(200, Math.min(440, H * 0.4)) / groundScale;
      var sigilR = Math.max(200, Math.min(380, Math.min(R.rx, R.ry) * 0.72));
      R.sigilR = sigilR;
      var pb = opts.planeBase, pg = opts.planeGlow;
      // 深淵（最底，非等比縮放成圓場的橢圓）
      var ab = sprite(T.abyss, pb);
      ab.anchor.set(0.5);
      ab.width = R.rx * 2 * ABYSS_SPAN; ab.height = R.ry * 2 * ABYSS_SPAN;
      ab.x = R.cx; ab.y = R.cy;
      R.base.push(ab);
      // 法陣刻痕（暗色、一般混色）
      function sigilPair(lineTex, glowTex, rotates) {
        var line = sprite(lineTex, pb);
        line.anchor.set(0.5); line.width = line.height = sigilR * 2;
        line.x = R.cx; line.y = R.cy; line.tint = 0x000000; line.alpha = 0.55;
        var glow = sprite(glowTex, pg);
        glow.anchor.set(0.5); glow.width = glow.height = sigilR * 2;
        glow.x = R.cx; glow.y = R.cy; glow.tint = parseInt(T.pal.glow.slice(1), 16);
        glow.blendMode = 'add'; glow.alpha = 0;
        line._rotates = glow._rotates = rotates;
        R.base.push(line); R.glow.push(glow);
      }
      sigilPair(T.ringLine, T.ringGlow, 1);
      sigilPair(T.coreLine, T.coreGlow, 0);
      // 裂隙
      var ck = sprite(T.cracks, pg);
      ck.anchor.set(0.5);
      ck.width = ck.height = sigilR / CRACK_INNER * 2;
      ck.x = R.cx; ck.y = R.cy;
      ck.tint = 0x08080a;
      ck.blendMode = 'normal'; ck.alpha = 0.55; ck._cracks = true;
      R.base.push(ck);
      placeProps(T);
      setupAmbient(T);
      showTitle(o.title, o.subtitle, T.pal);
      return true;
    }

    function placeProps(T) {
      var r = R.rng;
      var layer = opts.propLayer;
      var k = Math.max(0.75, Math.min(1.25, R.rx / 400));
      function put(key, ang, scaleMul, radiusMul) {
        var list = T.props[key];
        var spec = PROP_SPECS[key];
        var tex = list[Math.floor(r() * list.length) % list.length];
        var rm = radiusMul || 1;
        var wx = R.cx + Math.cos(ang) * R.rx * rm, wy = R.cy + Math.sin(ang) * R.ry * rm;
        var s = sprite(tex, layer);
        s.anchor.set(0.5, (spec.h - FOOT) / spec.h);
        var sc = k * (scaleMul || 1);
        s.scale.set(sc / TEX_SCALE * (key === 'gate' || r() < 0.5 ? 1 : -1), sc / TEX_SCALE);
        s._bbX = s.scale.x; s._bbY = s.scale.y;   // 貼圖自己的縮放；每幀的透視抵銷以它為底（見 update）
        s.x = wx; s.y = wy * groundScale; s.zIndex = s.y;
        s._h = spec.h * sc; s._w = spec.w * sc;
        R.props.push(s);
        var foot=sprite(T.contact,opts.planeBase);foot.anchor.set(.5);foot.x=wx;foot.y=wy;
        foot.width=spec.w*sc*1.15;foot.height=spec.w*sc*.38/groundScale;foot.alpha=.6;R.base.push(foot);
        if(key==='relic')for(var n=0;n<3;n++){
          var fog=sprite(T.fog,layer);fog.anchor.set(.5);fog.tint=parseInt(T.pal.glowHi.slice(1),16);fog._arenaLocal=true;
          R.local.push({s:fog,parent:s,sc:sc,index:n,phase:r(),height:spec.h*.6*sc});
        }
        return { s: s, wx: wx, wy: wy, sc: sc, spec: spec };
      }
      function groundLight(wx, wy, size, alpha) {
        var lg = sprite(T.dot, opts.planeGlow);
        lg.anchor.set(0.5);
        lg.width = lg.height = size;
        lg.x = wx; lg.y = wy;
        lg.tint = T.pal.light !== undefined ? T.pal.light : 0xff4040;
        lg.blendMode = 'add'; lg.alpha = alpha; lg._base = alpha; lg._phase = r() * 10;
        R.lights.push(lg);
        return lg;
      }
      var D = Math.PI / 180;
      /* 魔門：正後方（畫面上方），站在法陣外緣——BOSS 像是剛從門裡走出來。
         畫面頂端有 BOSS 大血條與塔戰資訊列（約 95px），門楣那張臉（眼睛在門高 0.8 處）一定要露在它們下面：
         依鏡頭到門腳的距離回推門能有多高。鏡頭對著玩家，玩家就站在圓場中心附近。 */
      var gateOffset = R.sigilR + 30;                                    // 世界單位
      var gateFootY = R.viewH / 2 - gateOffset * groundScale;            // 畫面座標（相對畫布頂端）
      var headroom = Math.max(95, R.viewH * 0.12);
      var gateMul = Math.max(0.45, Math.min(1.15, (gateFootY - headroom) / (PROP_SPECS.gate.h * 0.8))) / k;
      var gate = put('gate', -90 * D, gateMul, gateOffset / R.ry);
      /* 門上的兩隻眼睛：位置對應 drawGate 的眼窩——門楣臉的中線在腳底上方 0.76 × 高，
         眼窩再往上 0.18 張臉高（臉高 0.2 × 高）、左右各 0.19 張臉寬（臉寬 0.56 × 寬）。 */
      var gs = gate.spec, gsc = gate.sc;
      [-1, 1].forEach(function (side) {
        var eye = sprite(T.dot, layer);
        eye.anchor.set(0.5);
        eye.tint = parseInt(T.pal.glow.slice(1), 16);
        eye.blendMode = 'add';
        eye.width = 34 * gsc; eye.height = 18 * gsc;
        eye._bbX = eye.scale.x; eye._bbY = eye.scale.y;
        /* 眼睛是門的零件：位移相對門腳底，跟著門的抵銷矩陣走（見 update 的 billboardSprite） */
        eye._bbParent = gate.s;
        eye._bbOffX = side * gs.w * 0.56 * 0.19 * gsc;
        eye._bbOffY = -gs.h * (0.76 + 0.2 * 0.18) * gsc;
        eye.x = gate.s.x + eye._bbOffX;
        eye.y = gate.s.y + eye._bbOffY;
        eye.zIndex = gate.s.zIndex + 1;
        R.eyes.push(eye);
      });
      groundLight(gate.wx, gate.wy + 30, 420 * k, 0.5);
      // 火盆：四個斜角
      [-145, -35, 145, 35].forEach(function (deg) {
        var b = put('brazier', deg * D, 1);
        var fl = sprite(T.flame, layer);
        fl.anchor.set(0.5, 1);
        fl.scale.set(b.sc / TEX_SCALE);
        fl.x = b.s.x;
        // 碗口在腳底上方 (0.12 + 0.3 + 0.08) × 高（見 drawDemonBrazier 的三層底座），火焰底部埋進碗裡一點
        fl.y = b.s.y - b.spec.h * 0.5 * b.sc + 3 * b.sc;
        fl._bbParent = b.s; fl._bbOffX = 0; fl._bbOffY = fl.y - b.s.y;   // 跟著火盆的矩陣走
        fl.zIndex = b.s.zIndex + 0.5;
        fl._phase = r() * 10; fl._sc = b.sc;
        R.flames.push(fl);
        groundLight(b.wx, b.wy, 300 * k, 0.55);
      });
      // 尖刺：上半圈與兩側
      [-120, -60, -168, -12, 168, 12, -100, -80].forEach(function (deg, i) {
        put(i===2||i===3?'relic':i >= 6 ? 'spikeSmall' : 'spike', (deg + A.range(r, -5, 5)) * D, A.range(r, 0.85, 1.1), i >= 6 ? 1.18 : A.range(r, 0.98, 1.06));
      });
      // 下半圈（離鏡頭近、會擋視線的一側）只放矮的：小尖刺與燭台
      [118, 62].forEach(function (deg) { put('spikeSmall', deg * D, A.range(r, 0.8, 0.95)); });
      [100, 80, 140, 40].forEach(function (deg) {
        var c = put('candles', (deg + A.range(r, -4, 4)) * D, A.range(r, 0.9, 1.1), 0.94);
        groundLight(c.wx, c.wy, 150 * k, 0.4);
      });
    }

    /* ---- 氣氛：灰燼、火星、心跳光暈 ---- */
    function setupAmbient(T) {
      var layer = opts.ambientLayer;
      if (!layer) return;
      var r = R.rng;
      var edge = sprite(T.edge, layer);
      edge.tint = T.pal.edge !== undefined ? T.pal.edge : 0xc0101e;
      edge.blendMode = 'add';
      edge.alpha = 0;
      R.edge = edge;
      for (var i = 0; i < 46; i++) {
        var ash = i < 18;
        var s = sprite(T.dot, layer);
        s.anchor.set(0.5);
        s.tint = ash ? T.pal.ash : T.pal.ember;
        if (!ash) s.blendMode = 'add';
        R.particles.push(resetParticle({ s: s, ash: ash, r: r }, true));
      }
    }
    function resetParticle(p, anywhere) {
      var r = p.r, W = R.W || 800, H = R.H || 800;
      p.x = r() * W;
      p.y = anywhere ? r() * H : (p.ash ? -10 : H + 10);
      p.life = 0;
      p.maxLife = A.range(r, 4, 9);
      p.phase = r() * 10;
      if (p.ash) { p.vx = A.range(r, -10, 10); p.vy = A.range(r, 14, 30); p.size = A.range(r, 2.5, 5); p.a = A.range(r, 0.25, 0.5); }
      else { p.vx = A.range(r, -12, 12); p.vy = A.range(r, -60, -24); p.size = A.range(r, 2, 4.5); p.a = A.range(r, 0.55, 0.95); }
      p.s.width = p.s.height = p.size;
      p.s.alpha = 0;
      return p;
    }

    /* ---- 登場標題卡 ---- */
    function showTitle(title, subtitle, pal) {
      var layer = opts.titleLayer;
      if (!layer || !title) return;
      var root = new PIXI.Container();
      var sub = new PIXI.Text({
        text: subtitle || '',
        style: { fontFamily: 'serif', fontSize: 15, fontWeight: 'bold', fill: pal.glowHi, letterSpacing: 6,
          stroke: { color: '#000000', width: 4 } }
      });
      sub.anchor.set(0.5, 1);
      var main = new PIXI.Text({
        text: title,
        style: { fontFamily: 'serif', fontSize: 38, fontWeight: 'bold', fill: '#f4ece0', letterSpacing: 8,
          stroke: { color: pal.portal, width: 6 },
          dropShadow: { color: pal.glow, blur: 14, distance: 0, alpha: 0.9 } }
      });
      main.anchor.set(0.5, 0);
      main.y = 4;
      var bar = new PIXI.Graphics();
      bar.rect(-150, -2, 300, 1.5).fill({ color: parseInt(pal.glow.slice(1), 16), alpha: 0.8 });
      bar.y = 54;
      root.addChild(sub); root.addChild(main); root.addChild(bar);
      root.alpha = 0;
      layer.addChild(root);
      R.title = { root: root, t: 0 };
    }
    // 淡入 0.4 秒 → 停 1.6 秒 → 淡出 0.7 秒；從略大縮回原尺寸
    var TITLE_IN = 0.4, TITLE_HOLD = 1.6, TITLE_OUT = 0.7;
    function updateTitle(dt) {
      var T = R.title;
      if (!T) return;
      T.t += dt;
      var t = T.t, a;
      if (t < TITLE_IN) a = t / TITLE_IN;
      else if (t < TITLE_IN + TITLE_HOLD) a = 1;
      else a = Math.max(0, 1 - (t - TITLE_IN - TITLE_HOLD) / TITLE_OUT);
      T.root.alpha = a;
      var sc = 1 + 0.12 * Math.max(0, 1 - t / TITLE_IN);
      T.root.scale.set(sc);
      T.root.x = R.W / 2;
      T.root.y = R.H * 0.3;
      if (t > TITLE_IN + TITLE_HOLD + TITLE_OUT) {
        T.root.destroy({ children: true });
        R.title = null;
      }
    }

    /* 心跳：一拍兩下（咚—咚），平常 1.25 秒一拍，狂暴 0.72 秒一拍 */
    function heartbeat(t, period) {
      var x = (t % period) / period;
      function bump(c, w) { var d = (x - c) / w; return Math.exp(-d * d); }
      return Math.min(1, bump(0.08, 0.05) + 0.7 * bump(0.26, 0.05));
    }

    function update(view) {
      if (!R.on) return;
      var dt = Math.max(0, Math.min(0.1, view.dt || 0));
      R.time += dt;
      R.W = view.W; R.H = view.H;
      if (view.enraged && !R.enraged) R.enrageFlash = 1;
      R.enraged = !!view.enraged;
      R.enrageFlash = Math.max(0, R.enrageFlash - dt * 1.2);
      R.ignite = Math.min(1, R.ignite + dt / 1.4);   // 法陣點燃
      var ign = R.ignite * R.ignite * (3 - 2 * R.ignite);
      var t = R.time;
      // 法陣：外圈慢轉、光隨呼吸（狂暴時更亮更急）
      var breath = R.enraged ? 0.82 + 0.18 * Math.sin(t * 5.2) : 0.62 + 0.2 * Math.sin(t * 1.7);
      for (var i = 0; i < R.glow.length; i++) {
        var gsp = R.glow[i];
        if (gsp._cracks) gsp.alpha = ign * (R.enraged ? 0.75 : 0.45) * (0.85 + 0.15 * Math.sin(t * 2.3 + 1));
        else gsp.alpha = ign * breath;
        if (gsp._rotates) gsp.rotation += dt * (R.enraged ? 0.22 : 0.07);
      }
      for (var b = 0; b < R.base.length; b++) if (R.base[b]._rotates) R.base[b].rotation += dt * (R.enraged ? 0.22 : 0.07);
      // 火焰閃爍
      for (var f = 0; f < R.flames.length; f++) {
        var fl = R.flames[f], ft = t * 9 + fl._phase;
        var flick = 0.85 + 0.15 * Math.sin(ft) * Math.sin(ft * 1.7 + 1.3);
        fl._bbY = fl._sc / TEX_SCALE * (0.92 + 0.2 * flick) * (R.enraged ? 1.2 : 1);
        fl._bbX = fl._sc / TEX_SCALE * (0.95 + 0.08 * Math.sin(ft * 1.3));
      }
      /* 直立的門、火盆、尖刺與它們的零件抵銷畫面透視，只留遠近縮放（opts.billboard 沒給＝原樣）。
         鏡頭每幀都在動，shear 隨橫向位置變，所以每幀重算。 */
      var bboard = A.billboardSprite;
      for (var pi = 0; pi < R.props.length; pi++) bboard(R.props[pi], opts.billboard, R.props[pi]._bbX, R.props[pi]._bbY);
      // 餘煙／冥霧附著在兩件主題遺物上；固定六團，不建立 Timer 或每幀節點。
      R.local.forEach(function(p){
        var age=(t*.18+p.phase+p.index/3)%1,fade=Math.sin(age*Math.PI);
        var offX=Math.sin(t*.45+p.phase*7)*14,offY=-p.height-age*42;
        p.s.alpha=fade*.23*ign*p.parent.alpha;p.s.zIndex=p.parent.zIndex+.1;
        bboard(p.s,opts.billboard,p.sc*(.3+age*.3),p.sc*(.3+age*.3),p.parent,offX,offY);
      });
      for (var fi = 0; fi < R.flames.length; fi++) {
        var fb = R.flames[fi];
        bboard(fb, opts.billboard, fb._bbX, fb._bbY, fb._bbParent, fb._bbOffX, fb._bbOffY);
      }
      for (var ei = 0; ei < R.eyes.length; ei++) {
        var eb = R.eyes[ei];
        bboard(eb, opts.billboard, eb._bbX, eb._bbY, eb._bbParent, eb._bbOffX, eb._bbOffY);
      }
      for (var l = 0; l < R.lights.length; l++) {
        var lg = R.lights[l];
        lg.alpha = ign * lg._base * (0.8 + 0.2 * Math.sin(t * 6 + lg._phase));
      }
      // 魔門的眼睛：慢慢睜開，跟著心跳亮
      var beatPeriod = R.enraged ? 0.72 : 1.25;
      var beat = heartbeat(t, beatPeriod);
      for (var e = 0; e < R.eyes.length; e++) R.eyes[e].alpha = ign * (0.55 + 0.45 * beat) * (R.enraged ? 1 : 0.85);
      // 心跳光暈（螢幕四周）
      if (R.edge) {
        R.edge.width = view.W; R.edge.height = view.H;
        var baseA = R.enraged ? 0.16 : 0.07, beatA = R.enraged ? 0.3 : 0.14;
        R.edge.alpha = ign * (baseA + beatA * beat) + R.enrageFlash * 0.5;
      }
      // 擋到玩家的擺件淡出（同 battle-decor）
      var px = view.playerX, py = view.playerScreenY;
      if (px !== undefined && py !== undefined) {
        for (var q = 0; q < R.props.length; q++) {
          var s = R.props[q];
          var front = s.y > py && s.y - s._h < py + 4;
          var over = Math.abs(s.x - px) < s._w * 0.5 + 18;
          var target = front && over ? 0.38 : 1;
          if (s.alpha !== target) s.alpha += (target - s.alpha) * 0.25;
        }
      }
      // 粒子
      for (var n = 0; n < R.particles.length; n++) {
        var p = R.particles[n];
        p.life += dt;
        var speed = (!p.ash && R.enraged) ? 1.6 : 1;
        p.x += p.vx * dt + (p.ash ? Math.sin(t * 1.3 + p.phase) * 6 * dt : 0);
        p.y += p.vy * dt * speed;
        var fade = Math.min(1, p.life / 0.8, (p.maxLife - p.life) / 0.8);
        p.s.alpha = Math.max(0, fade) * p.a * ign;
        p.s.x = p.x; p.s.y = p.y;
        if (p.life > p.maxLife || p.y < -30 || p.y > view.H + 30 || p.x < -30 || p.x > view.W + 30) resetParticle(p, false);
      }
      updateTitle(dt);
    }

    function exit() {
      clearAll();
      R.on = false;
    }

    function floorTexture() { return R.on && R.T ? R.T.floor : null; }

    function stats() {
      return {
        enabled: enabled, on: R.on, tier: R.tier, props: R.props.length, glow: R.glow.length,
        localParticles:R.local.length, particles: R.particles.length, title: !!R.title, enraged: R.enraged,
        center: R.on ? { x: R.cx, y: R.cy, rx: R.rx, ry: R.ry, sigilR: R.sigilR } : null
      };
    }

    return { enter: enter, exit: exit, update: update, floorTexture: floorTexture, active: function () { return R.on; }, stats: stats, enabled: enabled };
  }

  return { create: create, TIERS: TIERS, tierOf: tierOf, PROP_SPECS: PROP_SPECS, _draw: {
    floor: drawFloor, sigilRing: drawSigilRing, sigilCore: drawSigilCore, cracks: drawCracks,
    spike: drawSpike, brazier: drawDemonBrazier, candles: drawCandles, gate: drawGate
  } };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BossArena;
