'use strict';

/* 裝飾層的場景座標對應 images/start-menu/battlefield.webp。
   選單負責提供定位容器、掛載和卸載，這裡只管理背景自己的生命週期。 */
var StartMenuBackground = (function () {
  const ASSETS = new URL('../images/start-menu/', document.currentScript.src);
  const WIDTH = 1672;
  const HEIGHT = 941;
  const TAU = Math.PI * 2;
  const FRAME_MS = 1000 / 30;

  // x, y, 寬, 高, 沿旗桿的斜率, 末端下垂, 振幅, 遠近色調
  const CLOTH = [
    { sprite: 0, x: 252, y: 71, w: 283, h: 176, lean: -54, drop: 94, swing: 26, haze: 0 },
    { sprite: 1, x: 184, y: 305, w: 157, h: 29, lean: -10, drop: 54, swing: 18, haze: 0 },
    { sprite: 0, x: 303, y: 343, w: 101, h: 46, lean: -7, drop: 23, swing: 9, haze: .32 },
    { sprite: 1, x: 261, y: 400, w: 55, h: 13, lean: -3, drop: 18, swing: 6, haze: .35 },
    { sprite: 0, x: 1360, y: 485, w: 108, h: 48, lean: -15, drop: 22, swing: 11, haze: .25 },
    { sprite: 1, x: 1630, y: 405, w: 54, h: 16, lean: -4, drop: 22, swing: 6, haze: .45 }
  ];
  const WISPS = [
    [65, 538, 64], [1085, 654, 37], [1583, 643, 68],
    [1008, 753, 22], [1187, 702, 21], [1164, 773, 17], [1190, 772, 15]
  ];
  // 每個風沙源貼齊地面、盔甲或遺骸。景深決定速度、抬升及顆粒大小。
  const DUST_SOURCES = [
    [94, 531, 90, 25, .65], [155, 760, 143, 25, 1.2],
    [369, 690, 92, 38, 1], [546, 786, 115, 24, 1.15],
    [681, 860, 112, 24, 1.32], [232, 915, 148, 17, 1.5],
    [666, 571, 118, 19, .54], [835, 631, 140, 20, .69],
    [822, 817, 115, 20, 1.22], [1037, 759, 92, 22, 1],
    [1176, 715, 86, 24, .9], [1311, 796, 109, 25, 1.2],
    [1512, 861, 126, 27, 1.3], [1464, 587, 89, 24, .62],
    [1079, 914, 142, 19, 1.52], [45, 861, 100, 29, 1.4]
  ];

  const ease = t => t * t * (3 - 2 * t);
  const clamp = t => Math.max(0, Math.min(1, t));
  const mod = (t, period) => ((t % period) + period) % period;

  function randomStream(seed) {
    return function () {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  function canvas(width, height) {
    const el = document.createElement('canvas');
    el.width = width;
    el.height = height;
    return el;
  }

  // 環繞水平格點的多尺度噪聲，讓左右接縫連同梯度一起吻合。
  function noiseGrid(columns, rows, seed) {
    const random = randomStream(seed);
    const values = Float32Array.from({ length: columns * (rows + 1) }, random);
    return function (u, v) {
      const x = u * columns, y = v * rows;
      const left = Math.floor(x) % columns, right = (left + 1) % columns;
      const top = Math.floor(y) * columns, bottom = top + columns;
      const a = ease(x - Math.floor(x)), b = ease(y - Math.floor(y));
      const upper = values[top + left] * (1 - a) + values[top + right] * a;
      const lower = values[bottom + left] * (1 - a) + values[bottom + right] * a;
      return upper * (1 - b) + lower * b;
    };
  }

  function vaporTexture(width, height, rgb, seed, band) {
    const texture = canvas(width, height);
    const ctx = texture.getContext('2d');
    const data = ctx.createImageData(width, height);
    const octaves = [1, 2, 4, 8, 16].map((step, i) => ({
      sample: noiseGrid(step * 4, step * 3, seed + step),
      weight: Math.pow(.52, i)
    }));
    for (let y = 0; y < height; y++) {
      const v = y / height;
      for (let x = 0; x < width; x++) {
        const u = x / width;
        let density = 0;
        for (const { sample, weight } of octaves) density += sample(u, v) * weight;
        const irregularity = density - .42;
        const vertical = Math.sin(Math.PI * v);
        const shape = band ? vertical : vertical * Math.sin(Math.PI * u);
        const alpha = ease(clamp((irregularity - .20) * 2.2)) * Math.pow(shape, band ? 1.15 : 1.8);
        const pixel = (y * width + x) * 4;
        const tint = Math.round((density - .8) * 36);
        data.data[pixel] = rgb[0] + tint;
        data.data[pixel + 1] = rgb[1] + tint;
        data.data[pixel + 2] = rgb[2] + tint;
        data.data[pixel + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(data, 0, 0);
    return texture;
  }

  function skyMask() {
    const mask = canvas(768, 432);
    const ctx = mask.getContext('2d');
    ctx.scale(mask.width / WIDTH, mask.height / HEIGHT);
    ctx.filter = 'blur(4px)';
    // 保留拱頂、內緣、左側矛桿與遠方城堡的遮擋關係。
    const openings = new Path2D(
      'M-30 -30H252L230 93 181 289 151 324 146 231 110 203 69 225 52 211 58 142 -30 89Z ' +
      'M266 -30H842L825 19 773 51 732 93 731 42 700 43 669 61 655 113 626 143 604 126 570 152 560 202 525 218 513 312 474 373 414 365 362 360 321 333 237 318 181 344 199 249 229 131Z ' +
      'M849 -30H1710V151L1657 155 1626 168 1589 180 1555 122 1541 155 1525 134 1499 124 1482 75 1453 40 1422 96 1409 130 1380 155 1346 140 1316 182 1288 152 1257 187 1215 195 1197 163 1180 127 1148 179 1111 226 1082 242 1055 210 1037 229 1025 147 995 130 986 84 961 64 939 84 919 56 892 52 857 19Z ' +
      'M729 258Q744 217 785 195L810 193 832 168 853 160 871 207 900 191Q937 212 930 258L914 315 901 349 878 365 864 398 848 393 820 413 801 395 778 356 765 338 745 366 724 376Z'
    );
    ctx.fill(openings);
    return mask;
  }

  function makeAtmosphere() {
    const sky = canvas(768, 432);
    const skyContext = sky.getContext('2d');
    const clouds = [
      { tile: vaporTexture(512, 120, [180, 140, 104], 91, true), w: 1910, y: -52, h: 310, speed: 3.5, alpha: .36 },
      { tile: vaporTexture(512, 125, [71, 59, 54], 413, true), w: 1460, y: -28, h: 356, speed: 6.7, alpha: .59 },
      { tile: vaporTexture(512, 100, [159, 122, 91], 611, true), w: 1160, y: 151, h: 240, speed: 9.6, alpha: .38 },
      { tile: vaporTexture(512, 78, [160, 127, 94], 781, true), w: 1480, y: 354, h: 174, speed: 12.5, alpha: .29 }
    ];
    for (const cloud of clouds) cloud.pattern = skyContext.createPattern(cloud.tile, 'repeat-x');
    return {
      sky, skyContext, clouds, mask: skyMask(),
      sand: vaporTexture(192, 48, [181, 138, 89], 561, false),
      haze: vaporTexture(192, 56, [141, 108, 76], 801, false),
      spirit: vaporTexture(64, 112, [115, 176, 154], 171, false)
    };
  }

  function cloudStrip(ctx, layer, time) {
    const start = mod(time * layer.speed + layer.y * 2, layer.w) - layer.w;
    const scale = layer.w / layer.tile.width;
    ctx.save();
    ctx.translate(start, layer.y);
    ctx.scale(scale, layer.h / layer.tile.height);
    ctx.globalAlpha = layer.alpha;
    ctx.fillStyle = layer.pattern;
    ctx.fillRect(0, 0, (WIDTH - start) / scale, layer.tile.height);
    ctx.restore();
  }

  function drawClouds(ctx, atmosphere, time) {
    const { sky, skyContext, mask, clouds } = atmosphere;
    skyContext.setTransform(1, 0, 0, 1, 0, 0);
    skyContext.clearRect(0, 0, sky.width, sky.height);
    skyContext.save();
    skyContext.scale(sky.width / WIDTH, sky.height / HEIGHT);
    for (let i = 0; i < 3; i++) cloudStrip(skyContext, clouds[i], time);
    skyContext.restore();
    skyContext.save();
    skyContext.globalCompositeOperation = 'destination-in';
    skyContext.drawImage(mask, 0, 0);
    skyContext.restore();
    ctx.drawImage(sky, 0, 0, WIDTH, HEIGHT);
    cloudStrip(ctx, clouds[3], time);
  }

  function clothSprites(atlas) {
    return [[90, 0, 1603, 647], [125, 704, 1500, 171]].map(([x, y, w, h]) => {
      const sprite = canvas(Math.ceil(w / 2), Math.ceil(h / 2));
      sprite.getContext('2d').drawImage(atlas, x, y, w, h, 0, 0, sprite.width, sprite.height);
      return sprite;
    });
  }

  function clothPoint(flag, u, v, time, index) {
    const travel = time * 4.2 - u * 8 + index * 1.7;
    const flex = u * u;
    const gust = .74 + .26 * Math.sin(time * 1.14 - index * .6);
    const fold = Math.sin(travel + v * 2.4);
    const snap = Math.sin(travel * 2.38 + v * 3.9);
    return {
      x: flag.x + u * flag.w + v * flag.lean + flex * flag.swing * (.41 * fold - .35 + .17 * snap),
      y: flag.y + v * flag.h + u * flag.drop + flex * flag.swing * gust * (fold + .34 * snap)
    };
  }

  function texturedTriangle(ctx, sprite, a, b, c, upper, sourceWidth, sourceHeight, sx, sy) {
    // a→b and a→c follow the source rectangle's axes. The companion triangle uses the opposite corner.
    const direction = upper ? 1 : -1;
    const ax = (b.x - a.x) / sourceWidth * direction;
    const ay = (b.y - a.y) / sourceWidth * direction;
    const bx = (c.x - a.x) / sourceHeight * direction;
    const by = (c.y - a.y) / sourceHeight * direction;
    const mx = (a.x + b.x + c.x) / 3;
    const my = (a.y + b.y + c.y) / 3;
    ctx.save();
    ctx.beginPath();
    for (const p of [a, b, c]) {
      const expansion = .75 / Math.max(1, Math.hypot(p.x - mx, p.y - my));
      ctx.lineTo(p.x + (p.x - mx) * expansion, p.y + (p.y - my) * expansion);
    }
    ctx.closePath();
    ctx.clip();
    ctx.transform(ax, ay, bx, by, a.x - ax * sx - bx * sy, a.y - ay * sx - by * sy);
    ctx.drawImage(sprite, 0, 0);
    ctx.restore();
  }

  function drawCloth(ctx, sprites, time) {
    for (const [index, flag] of CLOTH.entries()) {
      const sprite = sprites[flag.sprite];
      const columns = index === 0 ? 12 : 6;
      const rows = flag.sprite === 0 ? 3 : 2;
      const sw = sprite.width / columns, sh = sprite.height / rows;
      const mesh = [];
      for (let y = 0; y <= rows; y++) {
        for (let x = 0; x <= columns; x++) mesh.push(clothPoint(flag, x / columns, y / rows, time, index));
      }
      ctx.globalAlpha = 1 - flag.haze;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
          const n = y * (columns + 1) + x;
          const a = mesh[n], b = mesh[n + 1], c = mesh[n + columns + 1], d = mesh[n + columns + 2];
          texturedTriangle(ctx, sprite, a, b, c, true, sw, sh, x * sw, y * sh);
          texturedTriangle(ctx, sprite, d, c, b, false, sw, sh, (x + 1) * sw, (y + 1) * sh);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawWisps(ctx, sprite, time) {
    for (const [index, [x, y, height]] of WISPS.entries()) {
      const t = time + index * 2.31;
      const light = ctx.createRadialGradient(x, y - 3, 1, x, y - 3, height * .32);
      light.addColorStop(0, 'rgba(120,185,155,.31)');
      light.addColorStop(1, 'rgba(96,152,130,0)');
      ctx.fillStyle = light;
      ctx.fillRect(x - height * .32, y - height * .37, height * .64, height * .65);
      for (let curl = 0; curl < 8; curl++) {
        const age = mod(t * (.42 + (curl % 3) * .027) + curl * .127, 1);
        const drift = height * (.52 * age * age + .18 * Math.sin(age * 8 + t * 1.24 + curl) * age);
        const w = height * (.22 + .38 * age), h = height * (.48 + .23 * age);
        const peak = Math.sin(age * Math.PI);
        ctx.save();
        ctx.translate(x + drift, y - age * height);
        ctx.rotate(.12 + .40 * age + Math.sin(t * 1.9 + curl) * .16);
        ctx.globalAlpha = .63 * peak * (1 - age * .54);
        ctx.drawImage(sprite, -w / 2, -h * .72, w, h);
        ctx.restore();
      }
      const filament = ctx.createLinearGradient(x, y, x, y - height);
      filament.addColorStop(0, 'rgba(173,213,176,.46)');
      filament.addColorStop(.35, 'rgba(157,205,177,.24)');
      filament.addColorStop(1, 'rgba(105,178,156,0)');
      ctx.strokeStyle = filament;
      ctx.lineCap = 'round';
      for (let thread = 0; thread < 3; thread++) {
        const sway = Math.sin(t * 1.8 + thread * 2.1);
        const flow = Math.sin(t * 1.2 + thread * 2.9);
        ctx.lineWidth = height * (.014 + thread * .004);
        ctx.beginPath();
        ctx.moveTo(x + (thread - 1) * height * .045, y - 2);
        ctx.bezierCurveTo(x - height * (.1 + sway * .15), y - height * .31,
          x + height * (.27 + flow * .19), y - height * .61,
          x + height * (.39 + sway * .17), y - height * (.72 + thread * .105));
        ctx.stroke();
      }
    }
  }

  function makeDust() {
    const random = randomStream(9154);
    const grains = [], trails = [];
    for (const [source, [x, y, spread, rise, depth]] of DUST_SOURCES.entries()) {
      for (let i = 0; i < 102; i++) {
        grains.push({
          x: x + (random() - .5) * spread, y: y + (random() - .5) * rise,
          depth, speed: depth * (36 + 110 * random()), life: .47 + random() * 1.48,
          phase: random() * 9, loft: depth * (1 + random() * 14),
          size: depth * (.26 + random() * random() * 1.35), source
        });
      }
      for (let i = 0; i < 4; i++) {
        trails.push({
          x: x + (random() - .5) * spread, y: y + (random() - .5) * rise,
          depth, speed: depth * (31 + 37 * random()), life: 2.9 + 2.4 * random(),
          phase: random() * 7, loft: depth * (1.9 + random() * 7), source
        });
      }
    }
    return { grains, trails };
  }

  function gustAt(time, index) {
    return .36 + .64 * Math.pow(.5 + .5 * Math.sin(time * 1.14 - index * .46), 1.7);
  }

  function drawDust(ctx, textures, dust, time) {
    const wind = DUST_SOURCES.map((_, index) => gustAt(time, index));
    for (const trail of dust.trails) {
      const age = mod(time + trail.phase, trail.life);
      const progress = age / trail.life;
      const x = trail.x + age * trail.speed;
      const y = trail.y - trail.loft * Math.sin(progress * Math.PI);
      const width = (40 + 196 * progress) * trail.depth;
      const height = (6 + 18 * progress) * trail.depth;
      ctx.globalAlpha = Math.sin(progress * Math.PI) * wind[trail.source] * .73;
      ctx.drawImage(trail.source % 2 ? textures.haze : textures.sand, x - width * .15, y - height * .78, width, height);
    }
    ctx.globalAlpha = 1;
    const shades = ['#a9845b', '#c6a478', '#e0b780', '#f4d4a2', '#74604d'];
    for (let i = 0; i < dust.grains.length; i++) {
      const grain = dust.grains[i];
      const age = mod(time + grain.phase, grain.life);
      const progress = age / grain.life;
      const hop = 4 * progress * (1 - progress);
      const x = grain.x + grain.speed * age * (.76 + progress * .33);
      const y = grain.y - grain.loft * hop + Math.sin(age * 12 + grain.phase) * hop * 1.4;
      ctx.globalAlpha = Math.min(1, progress * 7) * (1 - progress) * (.22 + wind[grain.source] * .62);
      ctx.fillStyle = shades[i % shades.length];
      ctx.fillRect(x, y, grain.size * (1.15 + grain.speed * .015), grain.size * .76);
    }
    ctx.globalAlpha = 1;
  }

  function layer(host, el, style) {
    Object.assign(el.style, style);
    host.appendChild(el);
    return el;
  }

  function mount(host) {
    const root = layer(host, document.createElement('div'), {
      position: 'absolute', inset: '0', zIndex: '0', overflow: 'hidden',
      pointerEvents: 'none', background: '#1a1411'
    });
    root.className = 'start-menu-background';
    root.setAttribute('aria-hidden', 'true');
    const fill = { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' };
    const still = layer(root, new Image(), fill);
    still.alt = '';
    still.src = new URL('battlefield.webp', ASSETS);
    const surface = layer(root, canvas(1, 1), fill);
    const ctx = surface.getContext('2d');
    layer(root, document.createElement('div'), {
      position: 'absolute', inset: '0',
      background: 'radial-gradient(ellipse at 50% 49%, rgba(17,12,12,.26), transparent 63%), radial-gradient(ellipse at 50% 45%, transparent 49%, rgba(16,10,10,.37) 100%)'
    });

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const atmosphere = ctx && makeAtmosphere();
    const dust = ctx && makeDust();
    let disposed = false, inView = false, frame = null, previous = null;
    let sprites, time = 5.6, lastPaint = -Infinity;

    function draw() {
      if (!ctx || !inView) return;
      ctx.setTransform(surface.width / WIDTH, 0, 0, surface.height / HEIGHT, 0, 0);
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      drawClouds(ctx, atmosphere, time);
      if (sprites) drawCloth(ctx, sprites, time);
      drawWisps(ctx, atmosphere.spirit, time);
      drawDust(ctx, atmosphere, dust, time);
    }

    function tick(now) {
      frame = null;
      if (disposed || !inView || document.hidden || motion.matches || !root.isConnected) {
        previous = null;
        return;
      }
      if (previous !== null) time += (now - previous) / 1000;
      previous = now;
      if (now - lastPaint >= FRAME_MS - 1) {
        lastPaint = now;
        draw();
      }
      frame = requestAnimationFrame(tick);
    }

    function syncPlayback() {
      const play = ctx && inView && !disposed && !document.hidden && !motion.matches && root.isConnected;
      if (play && frame === null) frame = requestAnimationFrame(tick);
      if (!play && frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
        previous = null;
      }
    }

    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height || !ctx) return;
      const rasterWidth = Math.min(1440, Math.ceil(Math.max(width, height * WIDTH / HEIGHT) * Math.min(devicePixelRatio, 1.25)));
      if (surface.width !== rasterWidth) {
        surface.width = rasterWidth;
        surface.height = Math.round(rasterWidth * HEIGHT / WIDTH);
      }
      draw();
    });
    const visibility = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (inView) draw();
      syncPlayback();
    });
    resize.observe(root);
    visibility.observe(root);
    document.addEventListener('visibilitychange', syncPlayback);
    motion.addEventListener('change', syncPlayback);

    const atlas = new Image();
    if (ctx) atlas.src = new URL('cloth-atlas.webp', ASSETS);
    const atlasReady = ctx ? atlas.decode().then(() => {
      if (disposed) return false;
      sprites = clothSprites(atlas);
      draw();
      return true;
    }, () => false) : Promise.resolve(false);

    return {
      ready: Promise.all([still.decode().then(() => true, () => false), atlasReady])
        .then(results => !disposed && results.every(Boolean)),
      destroy() {
        if (disposed) return;
        disposed = true;
        syncPlayback();
        resize.disconnect();
        visibility.disconnect();
        document.removeEventListener('visibilitychange', syncPlayback);
        motion.removeEventListener('change', syncPlayback);
        surface.width = surface.height = 0;
        sprites = null;
        root.remove();
      }
    };
  }

  return { mount };
})();
