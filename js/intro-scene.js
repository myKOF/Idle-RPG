'use strict';
/* =============================================================================
   intro-scene.js — 開頭動畫的「分件場景」圖層（kind: 'scene'，播放器見 js/intro-player.js）
   -----------------------------------------------------------------------------
   繪本式序章需要的不是對一張圖整體變形，而是把背景各層、人物各部位拆開各自控制：
   雲帶各自視差漂移、翅膀以肩胛為軸擺動、披風以肩線為軸搖曳、劍光沿劍刃滑過……
   這個模組把一個 scene 圖層展開成一棵部件樹：

     scene（1920×1080 設計座標，cover 縮放到視窗；鏡頭推拉作用在整棵樹）
       └ part（box＝設計座標 [x, y, w, h]，origin＝旋轉／縮放軸心）
           ├ 外層：出場時間窗的淡入淡出＋主運動 path（多關鍵影格，一次性）
           └ 內層：循環運動 loop（無限次、可來回），與主運動疊加互不覆蓋
               └ 內容：image／shape／text，或 children（子部件，座標相對於本 box）

   全部用 Web Animations、只動 transform／opacity（合成器執行，開機時主執行緒忙也不卡），
   透過播放器傳入的 animate() 登記，暫停、略過、seek 與分頁隱藏都跟著總時鐘走。
   減少動態偏好：只保留淡入淡出，不建主運動、循環與粒子。

   部件欄位：
     kind      'image'（預設，有 src）| 'shape'（純 CSS，外觀寫在 cls）| 'group'（只放 children）
               | 'particles'（粒子群，見下）| 'text'（String 表 str）
     box       [x, y, w, h] 設計座標（px），相對於父部件
     origin    transform-origin，預設 '50% 50%'
     flip      true＝圖片水平翻轉（左右翼共用一張圖；只對 image 有效）
     at, dur   相對於父部件開始的時間窗（毫秒）；省略＝跟父部件同時、同長
     fadeIn, fadeOut  淡入／淡出（毫秒，預設 0）
     path      主運動：[{ t: 0~1, x, y, scale, sx, sy, rotate }...]，x／y 為設計座標 px；easing 套用每一段
     loop      循環運動：{ frames: [同上], dur, alternate, easing, phase: 0~1, alpha: [低, 高] }
     cls       額外的 CSS class
   粒子欄位：count, seed, size: [最小, 最大], rise: [px], drift: [px], dur: [毫秒], cls
   ============================================================================= */
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
var IntroScene = (function () {
  var DESIGN_W = 1920, DESIGN_H = 1080;

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function range(r, pair, d) {
    if (!pair) return d;
    return pair[0] + (pair[1] - pair[0]) * r();
  }

  function transformOf(p) {
    p = p || {};
    var s = num(p.scale, 1);
    return 'translate(' + num(p.x, 0) + 'px, ' + num(p.y, 0) + 'px) rotate(' + num(p.rotate, 0) + 'deg) scale(' +
      num(p.sx, s) + ', ' + num(p.sy, s) + ')';
  }

  /* path／loop 的關鍵影格。t 缺的話平均分配；只給一格就原地不動。 */
  function keyframes(list) {
    if (!list || !list.length) return null;
    var n = list.length;
    return list.map(function (k, i) {
      return { offset: num(k.t, n === 1 ? 0 : i / (n - 1)), transform: transformOf(k) };
    }).concat(n === 1 ? [{ offset: 1, transform: transformOf(list[0]) }] : []);
  }

  function fadeFrames(dur, fi, fo) {
    dur = Math.max(1, dur);
    fi = Math.max(0, fi); fo = Math.max(0, fo);
    if (fi + fo > dur) { var k = dur / (fi + fo); fi *= k; fo *= k; }
    var out = [{ offset: 0, opacity: fi > 0 ? 0 : 1 }];
    if (fi > 0) out.push({ offset: fi / dur, opacity: 1 });
    if (fo > 0) out.push({ offset: 1 - fo / dur, opacity: 1 });
    out.push({ offset: 1, opacity: fo > 0 ? 0 : 1 });
    return out;
  }

  /* 驗證部件樹；回傳錯誤字串陣列。 */
  function validate(scene) {
    var errs = [];
    function validateWalk(parts, where) {
      (parts || []).forEach(function (p, i) {
        var tag = where + '[' + i + ']' + (p.id ? '(' + p.id + ')' : '') + '：';
        var kind = p.kind || (p.src ? 'image' : 'group');
        if (['image', 'shape', 'group', 'particles', 'text'].indexOf(kind) < 0) errs.push(tag + '未知的 kind ' + kind);
        if (!Array.isArray(p.box) || p.box.length !== 4) errs.push(tag + '需要 box [x, y, w, h]');
        if (kind === 'image' && !p.src) errs.push(tag + 'image 需要 src');
        if (kind === 'text' && !(p.str > 0)) errs.push(tag + 'text 需要 String 表編號 str');
        if (kind === 'particles' && !(p.count > 0)) errs.push(tag + 'particles 需要 count');
        if (p.loop && !(num(p.loop.dur, 0) > 0)) errs.push(tag + 'loop 需要 dur');
        if (p.children) validateWalk(p.children, tag);
      });
    }
    if (!Array.isArray(scene.parts) || !scene.parts.length) errs.push('scene 沒有 parts');
    else validateWalk(scene.parts, 'parts');
    return errs;
  }

  function div(cls) {
    var el = document.createElement('div');
    el.className = cls;
    return el;
  }

  function build(layer, host, animate, reduced) {
    var start = num(layer.at, 0), total = num(layer.dur, 1);
    var fit = div('intro-scene-fit');
    var cam = div('intro-scene-cam');
    fit.appendChild(cam);
    host.appendChild(fit);

    /* cover 縮放：以圖層本身（滿版）的實際大小為準。用 ResizeObserver 而不是只在起播時算一次：
       頁面在背景或尺寸為 0 時起播，之後變成可見也要重算，否則整個場景會縮成 0。 */
    function refit() {
      var rect = host.getBoundingClientRect ? host.getBoundingClientRect() : null;
      var vw = (rect && rect.width) || (typeof window !== 'undefined' && window.innerWidth) || DESIGN_W;
      var vh = (rect && rect.height) || (typeof window !== 'undefined' && window.innerHeight) || DESIGN_H;
      var k = Math.max(vw / DESIGN_W, vh / DESIGN_H);
      fit.style.transform = 'translate(-50%, -50%) scale(' + k + ')';
    }
    refit();
    var observer = null;
    if (typeof ResizeObserver === 'function') { observer = new ResizeObserver(refit); observer.observe(host); }
    else if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', refit);

    if (layer.camera && !reduced) {
      cam.style.transformOrigin = layer.camera.origin || '50% 50%';
      animate(cam, keyframes(layer.camera.path), {
        delay: start, duration: total, fill: 'both', easing: layer.camera.easing || 'ease-in-out'
      });
    }

    function buildPart(p, parent, base, parentDur) {
      var kind = p.kind || (p.src ? 'image' : 'group');
      var at = num(p.at, 0), dur = num(p.dur, parentDur - at);
      var t0 = base + at;
      // cls 只套在 shape 的外層（外觀就是這一層的背景）；image／text 套在內容上，particles 套在每顆粒子上
      var outer = div('intro-part' + (p.cls && kind === 'shape' ? ' ' + p.cls : ''));
      var box = p.box || [0, 0, DESIGN_W, DESIGN_H];
      outer.style.left = box[0] + 'px'; outer.style.top = box[1] + 'px';
      outer.style.width = box[2] + 'px'; outer.style.height = box[3] + 'px';
      if (p.id) outer.setAttribute('data-part', p.id);
      var origin = p.origin || '50% 50%';
      outer.style.transformOrigin = origin;
      var inner = div('intro-part-inner');
      inner.style.transformOrigin = origin;
      outer.appendChild(inner);
      parent.appendChild(outer);

      if (kind === 'image') {
        var img = document.createElement('img');
        img.src = p.src; img.alt = ''; img.draggable = false; img.decoding = 'async';
        img.className = 'intro-part-img' + (p.cls ? ' ' + p.cls : '') + (p.flip ? ' is-flipped' : '');
        if (typeof img.decode === 'function') img.decode().catch(function () {});
        inner.appendChild(img);
      } else if (kind === 'text') {
        var tx = div('intro-part-text' + (p.cls ? ' ' + p.cls : ''));
        tx.textContent = STR.apply(null, [p.str].concat(p.args || []));
        inner.appendChild(tx);
      }

      // 時間窗與淡入淡出（外層）；第一個動畫套上前先藏起來
      outer.style.opacity = '0';
      animate(outer, fadeFrames(dur, num(p.fadeIn, 0), num(p.fadeOut, 0)), { delay: t0, duration: Math.max(1, dur), fill: 'both' });

      if (!reduced && p.path) {
        animate(outer, keyframes(p.path), { delay: t0, duration: Math.max(1, dur), fill: 'both', easing: p.easing || 'ease-in-out' });
      }
      if (!reduced && p.loop) {
        var lp = p.loop;
        var frames = keyframes(lp.frames || [{}]);
        if (lp.alpha) {
          frames = frames.map(function (k, i) {
            var copy = { offset: k.offset, transform: k.transform };
            copy.opacity = i % 2 ? lp.alpha[1] : lp.alpha[0];
            return copy;
          });
        }
        animate(inner, frames, {
          delay: t0, duration: lp.dur, iterations: Infinity, fill: 'both',
          direction: lp.alternate ? 'alternate' : 'normal', easing: lp.easing || 'ease-in-out',
          iterationStart: num(lp.phase, 0)
        });
      }

      if (kind === 'particles') {
        if (!reduced) buildParticles(p, inner, t0, dur);
      } else if (p.children) {
        p.children.forEach(function (child) { buildPart(child, inner, t0, dur); });
      }
    }

    function buildParticles(p, host, t0, dur) {
      var r = rng(num(p.seed, 1));
      var box = p.box;
      for (var i = 0; i < p.count; i++) {
        var size = range(r, p.size, 6);
        var dot = div('intro-particle' + (p.cls ? ' ' + p.cls : ''));
        dot.style.left = (r() * box[2]) + 'px';
        dot.style.top = (box[3] * (0.4 + r() * 0.6)) + 'px';
        dot.style.width = size + 'px'; dot.style.height = size + 'px';
        host.appendChild(dot);
        var rise = range(r, p.rise, 200), drift = range(r, p.drift, 40) * (r() < 0.5 ? -1 : 1);
        var peak = 0.5 + r() * 0.5;
        animate(dot, [
          { offset: 0, opacity: 0, transform: 'translate(0, 0)' },
          { offset: 0.2, opacity: peak },
          { offset: 0.75, opacity: peak * 0.8 },
          { offset: 1, opacity: 0, transform: 'translate(' + drift + 'px, ' + (-rise) + 'px)' }
        ], { delay: t0, duration: range(r, p.dur, 4000), iterations: Infinity, iterationStart: r(), easing: 'linear', fill: 'both' });
      }
    }

    (layer.parts || []).forEach(function (p) { buildPart(p, cam, start, total); });

    return {
      dispose: function () {
        if (observer) observer.disconnect();
        else if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', refit);
      }
    };
  }

  return { build: build, validate: validate, _internal: { keyframes: keyframes, transformOf: transformOf, fadeFrames: fadeFrames } };
})();
