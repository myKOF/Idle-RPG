'use strict';
/* 序章2D網格演出。關節取播放器總時鐘、共用其單一rAF；粒子登記WAAPI，無獨立計時循環。
   PNG母圖與透明WebP來源見images/intro-v2/SOURCE.md；形狀裝飾為本模組原創程序圖形。 */
var IntroMotion = (function () {
  function node(parent, cls, styles) {
    var el = document.createElement('div'); el.className = cls;
    Object.keys(styles || {}).forEach(function (k) { el.style[k] = styles[k]; });
    parent.appendChild(el); return el;
  }
  function random(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function transform(x, y, angle, sx, sy) {
    return 'translate(' + x + 'cqw,' + y + 'cqh) rotate(' + angle + 'deg) scale(' + (sx === undefined ? 1 : sx) + ',' + (sy === undefined ? 1 : sy) + ')';
  }

  function poseAt(pose, t, duration) {
    var folded = pose === 'awakening' || pose === 'rising';
    var wings = [];
    for (var side = 0; side < 2; side++) for (var pair = 0; pair < 3; pair++) {
      var amplitude = pose === 'fall' ? 5.5 - pair : folded ? 1.1 + pair * .35 : 2.2 - pair * .25;
      var period = pose === 'fall' ? .98 + pair * .15 : folded ? 2.4 + pair * .28 : 1.8 + pair * .23;
      wings.push({ pair: pair, side: side ? 1 : -1, angle: Math.sin(t * Math.PI * 2 / period + pair * .4) * amplitude });
    }
    return { wings: wings, fraction: Math.max(0, Math.min(1, t / duration)), folded: folded };
  }
  var FOLDED_ROOTS = [.3, .47, .6], FOLDED_TIPS = [.25, .6, .88], OPEN_ROOTS = [.5, .56, .62], OPEN_TIPS = [.1, .49, .9];
  function deform(pose, u, v, t, duration, state) {
    state = state || poseAt(pose, t, duration);
    var aspect = 941 / 1672, roots = state.folded ? FOLDED_ROOTS : OPEN_ROOTS, tips = state.folded ? FOLDED_TIPS : OPEN_TIPS;
    var side = u < .5 ? -1 : 1, distance = Math.abs(u - .5), influence = Math.max(0, Math.min(1, (distance - .025) / .15));
    influence = influence * influence * (3 - 2 * influence);
    var weights = [], sum = 0, spread = Math.min(1, distance / .4);
    for (var p = 0; p < 3; p++) {
      var rootY = roots[p];
      var tipY = tips[p];
      var centerY = rootY + (tipY - rootY) * spread;
      var weight = Math.exp(-Math.pow((v - centerY) / .16, 2)); weights.push(weight); sum += weight;
    }
    var x = u, y = v;
    for (var pair = 0; pair < 3; pair++) {
      var bone = state.wings[(side < 0 ? 0 : 3) + pair];
      var angle = bone.angle * side * Math.PI / 180;
      var px = side < 0 ? .47 : .53, py = roots[pair];
      var dx = u - px, dy = (v - py) * aspect, strength = influence * weights[pair] / Math.max(.00001, sum);
      x += (Math.cos(angle) * dx - Math.sin(angle) * dy - dx) * strength;
      y += (Math.sin(angle) * dx + Math.cos(angle) * dy - dy) / aspect * strength;
    }
    var torso = Math.exp(-Math.pow((u - .5) / .1, 2) - Math.pow((v - .62) / .22, 2));
    x += Math.sin(t * (pose === 'fall' ? 12 : 3)) * .0025 * torso;
    var handX = state.folded ? .4 : .55, handY = state.folded ? .85 : .67;
    var hand = Math.exp(-Math.pow((u - handX) / .065, 2) - Math.pow((v - handY) / .09, 2));
    y += Math.sin(t * 24) * .0018 * hand;
    var cape = Math.exp(-Math.pow((u - .45) / .08, 2)) * Math.max(0, v - .6);
    x += Math.sin(t * 5 + v * 11) * .014 * cape;
    var f = state.fraction, tilt = pose === 'fall' ? Math.sin(t * 5) * 1.8 + (f * 2 - 1) * 2.5 : 0;
    var a = tilt * Math.PI / 180, rx = x - .5, ry = (y - .5) * aspect;
    x = .5 + Math.cos(a) * rx - Math.sin(a) * ry;
    y = .5 + (Math.sin(a) * rx + Math.cos(a) * ry) / aspect;
    var fit = state.folded ? .95 : .92;
    x = .5 + (x - .5) * fit; y = .5 + (y - .5) * fit;
    if (pose === 'fall') { x += Math.sin(t * 3) * .006; y += -.015 + f * .045; }
    if (state.folded) y -= .025 * f;
    if (pose === 'standing') { var rise = Math.min(1, f / .35); rise = 1 - Math.pow(1 - rise, 3); y = .88 + (y - .88) * (.72 + .28 * rise); }
    return { x: x, y: y };
  }
  function triangle(ctx, image, p, q, r) {
    var determinant = p.sx * (q.sy - r.sy) + q.sx * (r.sy - p.sy) + r.sx * (p.sy - q.sy);
    var a = (p.x * (q.sy - r.sy) + q.x * (r.sy - p.sy) + r.x * (p.sy - q.sy)) / determinant;
    var b = (p.y * (q.sy - r.sy) + q.y * (r.sy - p.sy) + r.y * (p.sy - q.sy)) / determinant;
    var c = (p.x * (r.sx - q.sx) + q.x * (p.sx - r.sx) + r.x * (q.sx - p.sx)) / determinant;
    var d = (p.y * (r.sx - q.sx) + q.y * (p.sx - r.sx) + r.y * (q.sx - p.sx)) / determinant;
    var e = (p.x * (q.sx * r.sy - r.sx * q.sy) + q.x * (r.sx * p.sy - p.sx * r.sy) + r.x * (p.sx * q.sy - q.sx * p.sy)) / determinant;
    var f = (p.y * (q.sx * r.sy - r.sx * q.sy) + q.y * (r.sx * p.sy - p.sx * r.sy) + r.y * (p.sx * q.sy - q.sx * p.sy)) / determinant;
    var cx = (p.x + q.x + r.x) / 3, cy = (p.y + q.y + r.y) / 3;
    ctx.save(); ctx.beginPath();
    [p, q, r].forEach(function (v, index) { var dx = v.x - cx, dy = v.y - cy, length = Math.max(1, Math.sqrt(dx * dx + dy * dy)); var x = v.x + dx / length * .35, y = v.y + dy / length * .35; if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.closePath(); ctx.clip(); ctx.setTransform(a, b, c, d, e, f); ctx.drawImage(image, 0, 0); ctx.restore();
  }

  function build(layer, host, animate, reduced) {
    var art = node(host, 'intro-motion-art');
    if (layer.src) {
      var warm = document.createElement('img'); warm.src = layer.src; warm.decoding = 'async';
      if (typeof warm.decode === 'function') warm.decode().catch(function () {});
    }
    var at = layer.at, dur = layer.dur;
    function track(el, frames, start, length, extra) {
      if (reduced) return;
      var opts = { delay: at + (start || 0), duration: length || dur, fill: 'both', easing: 'linear' };
      Object.keys(extra || {}).forEach(function (k) { opts[k] = extra[k]; });
      animate(el, frames, opts);
    }
    function pulse(el, period, opacity) {
      if (reduced) { el.style.opacity = String(opacity === undefined ? .7 : opacity); return; }
      track(el, [{ opacity: .15, transform: 'scale(.85)' }, { opacity: opacity || .8, transform: 'scale(1.12)' }, { opacity: .15, transform: 'scale(.85)' }], 0, period, { iterations: Math.ceil(dur / period) });
    }
    function particle(kind, i, count, start, span, origin) {
      if (reduced && i > 2) return;
      var a = random(i + count), b = random(i + count * 2);
      var el = node(art, 'intro-motion-particle ' + kind, {
        left: ((origin ? origin[0] : 14) + a * (origin ? origin[2] : 72)) + '%',
        top: ((origin ? origin[1] : 8) + b * (origin ? origin[3] : 25)) + '%',
        width: (kind === 'intro-bone' ? .8 : .2 + a * .45) + '%', height: (.35 + b * 1.2) + '%'
      });
      var begin = start + (i % count) / count * span;
      track(el, [
        { offset: 0, opacity: 0, transform: transform(0, 0, a * 80) },
        { offset: .12, opacity: .85, transform: transform(a * 2, 2, a * 130) },
        { offset: .75, opacity: .65, transform: transform(a * 9 - 4, 20 + b * 22, a * 360) },
        { offset: 1, opacity: 0, transform: transform(a * 15 - 6, 36 + b * 28, a * 540) }
      ], begin, Math.min(2200 + b * 1000, dur - begin));
    }
    function flag(x, y, gold, burn) {
      var pole = node(art, 'intro-banner-pole', { left: x + '%', top: y + '%', height: '24%' });
      var cloth = node(art, 'intro-banner ' + (gold ? 'is-gold' : 'is-rag'), { left: (x + .2) + '%', top: (y + 1) + '%', width: '4.3%', height: '18%' });
      for (var j = 0; j < 5; j++) {
        var strip = node(cloth, 'intro-banner-strip', { top: j * 19 + '%', height: '22%', width: (100 - j * 8) + '%' });
        var frames = [
          { offset: 0, transform: 'skewX(-8deg) rotate(-4deg)', opacity: 1 },
          { offset: .24, transform: 'skewX(16deg) rotate(7deg)', opacity: 1 },
          { offset: .5, transform: 'skewX(-20deg) rotate(-6deg)', opacity: 1 },
          { offset: .76, transform: 'skewX(14deg) rotate(5deg)', opacity: burn ? .6 : 1 },
          { offset: 1, transform: 'skewX(-10deg) rotate(-3deg)', opacity: burn ? 0 : 1 }
        ];
        track(strip, frames, burn ? 500 + j * 160 : 0, burn ? 3800 - j * 120 : 1800 + j * 160,
          burn ? {} : { iterations: Math.ceil(dur / (1800 + j * 160)) });
      }
      if (burn) {
        var fire = node(cloth, 'intro-banner-fire'); pulse(fire, 650, .9);
        for (var k = 0; k < 8; k++) particle('intro-ash', k + Math.round(x), 8, 2100, 1900, [x, y + 8, 5, 10]);
      }
      return pole;
    }
    function rig(pose) {
      if (reduced) {
        var still = document.createElement('img'); still.src = layer.src; still.alt = ''; still.className = 'intro-rig-still'; art.appendChild(still); return;
      }
      var canvas = document.createElement('canvas'); canvas.className = 'intro-rig-mesh intro-angel-' + pose;
      var ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d', { alpha: true }) : null;
      if (!ctx) { var fallback = document.createElement('img'); fallback.src = layer.src; fallback.className = 'intro-rig-still'; fallback.alt = ''; art.appendChild(fallback); return; }
      art.appendChild(canvas);
      var image = document.createElement('img'); image.src = layer.src; image.decoding = 'async';
      if (typeof image.decode === 'function') image.decode().catch(function () {});
      var last = -Infinity, columns = 16, rows = 10;
      art.render = function (time, force) {
        if (time < at || time > at + dur || !image.complete || !image.naturalWidth) return;
        if (!force && time - last >= 0 && time - last < 33) return;
        last = time;
        var width = Math.max(1, Math.min(1280, Math.round(art.getBoundingClientRect().width * Math.min(window.devicePixelRatio || 1, 1.5))));
        var height = Math.round(width * 941 / 1672);
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
        var vertices = [], sample = poseAt(pose, (time - at) / 1000, dur / 1000);
        for (var y = 0; y <= rows; y++) for (var x = 0; x <= columns; x++) {
          var u = x / columns, v = y / rows;
          var point = deform(pose, u, v, (time - at) / 1000, dur / 1000, sample);
          vertices.push({ sx: u * image.naturalWidth, sy: v * image.naturalHeight, x: point.x * width, y: point.y * height });
        }
        for (var row = 0; row < rows; row++) for (var col = 0; col < columns; col++) {
          var n = row * (columns + 1) + col;
          triangle(ctx, image, vertices[n], vertices[n + 1], vertices[n + columns + 1]);
          triangle(ctx, image, vertices[n + 1], vertices[n + columns + 2], vertices[n + columns + 1]);
        }
      };
      art.dispose = function () { canvas.width = 0; canvas.height = 0; };
    }
    if (layer.motion === 'heaven') {
      var rift = node(art, 'intro-dark-rift'); pulse(rift, 1700, .8);
      for (var b = 0; b < 3; b++) {
        var bolt = node(art, 'intro-rift-lightning', { left: (46 + b * 4) + '%', top: (12 + b * 3) + '%' });
        track(bolt, [{ offset: 0, opacity: 0 }, { offset: .13, opacity: .75 }, { offset: .25, opacity: .05 }, { offset: .6, opacity: .4 }, { offset: 1, opacity: 0 }], 600 + b * 1200, 550);
      }
      flag(24, 31, true, true); flag(73, 34, true, true);
      for (var d = 0; d < 20; d++) particle('intro-debris', d, 20, 300, 3500, [27, 37, 49, 20]);
      for (var p = 0; p < 12; p++) particle('intro-void-dust', p, 12, 0, 3500, [45, 7, 15, 25]);
    } else if (layer.motion === 'fall') {
      rig('fall');
      for (var f = 0; f < 22; f++) particle('intro-burning-feather', f, 22, 100, 4600, [26, 20, 50, 35]);
      for (var c = 0; c < 5; c++) {
        var cloud = node(art, 'intro-cloud-rush', { left: (c * 22 - 10) + '%', top: (10 + c * 14) + '%' });
        track(cloud, [{ opacity: 0, transform: transform(-14, 20, -22) }, { offset: .2, opacity: .25 }, { opacity: 0, transform: transform(20, -40, -22) }], c * 650, 1800, { iterations: 3 });
      }
    } else if (layer.motion === 'wasteland') {
      flag(17, 35, false, false); flag(78, 45, false, false);
      for (var w = 0; w < 5; w++) {
        var wisp = node(art, 'intro-moving-wisp', { left: (19 + random(w) * 65) + '%', top: (57 + random(w + 5) * 24) + '%' });
        track(wisp, [{ opacity: .05, transform: transform(0, 1, -8, .7) }, { offset: .5, opacity: .65, transform: transform(.8, -1, 8, 1.1) }, { opacity: .05, transform: transform(0, -2, -8, .7) }], 0, 2400 + w * 130, { iterations: 4 });
      }
      for (var bone = 0; bone < 6; bone++) {
        var grass = node(art, bone < 3 ? 'intro-dry-grass' : 'intro-wind-bone', { left: (12 + bone * 14) + '%', top: (73 + bone % 3 * 6) + '%' });
        track(grass, [{ transform: 'rotate(-3deg)' }, { transform: 'rotate(4deg)' }, { transform: 'rotate(-3deg)' }], 0, 2200 + bone * 80, { iterations: 4 });
      }
      for (var sand = 0; sand < 12; sand++) particle('intro-sand-grain', sand, 12, 0, 5100, [8, 48, 85, 30]);
    } else if (layer.motion === 'awakening') rig('awakening');
    else if (layer.motion === 'rising') rig('rising');
    else if (layer.motion === 'standing') {
      rig('standing');
      for (var g = 0; g < 3; g++) {
        var ghost = node(art, 'intro-approaching-wraith', { left: (g === 1 ? 72 : 20 + g * 8) + '%', top: (42 + g * 6) + '%' });
        track(ghost, [{ opacity: 0, transform: transform(0, 0, 0, .6) }, { offset: .25, opacity: .25 }, { opacity: .5, transform: transform(g === 1 ? -4 : 4, 3, 0, 1.1) }], 0, dur);
      }
    }
    return art;
  }
  return { build: build, _internal: { random: random, transform: transform, deform: deform, poseAt: poseAt } };
})();
