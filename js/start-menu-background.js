'use strict';

/* 裝飾層的場景座標對應 images/start-menu/battlefield-atmosphere.webp。
   選單負責提供定位容器、掛載和卸載，這裡只管理背景自己的生命週期。 */
var StartMenuBackground = (function () {
  const ASSETS = new URL('../images/start-menu/', document.currentScript.src);
  const WIDTH = 1672;
  const HEIGHT = 941;
  const TAU = Math.PI * 2;
  const FRAME_MS = 1000 / 30;
  const REDUCED_MOTION_SCALE = .65;
  const GATE_FOG_RATE = 1.25;
  const MIDGROUND_FOG_SPEED = -14;
  const MIDGROUND_FOG_DENSITY = 1.30;
  const DUST_GUST_RATE = 1.30;
  const FIRE_INTENSITY = 2;
  const GATE_SKY_OPENING =
    'M729 258Q744 217 785 195L810 193 832 168 853 160 871 207 900 191Q937 212 930 258' +
    'L914 315 901 349 878 365 864 398 848 393 820 413 801 395 778 356 765 338 745 366 724 376Z';
  const LIGHTNING_BOUNDS = { x: 700, y: 135, w: 280, h: 300 };
  const DUST_ORIGINS = { x: 270, y: 535, w: WIDTH - 135, h: 362 };
  // 紅框使用底圖座標，跟隨滿版裁切。
  const LOCAL_HAZE = { x: 208, y: 426, w: 756, h: 405 };
  const LOCAL_DUST_AMOUNT = 2;
  const LOCAL_DUST_OVERLAP = LOCAL_HAZE.y + LOCAL_HAZE.h - DUST_ORIGINS.y;
  // 陣風從遮罩的右半起掀，保留向左消散的空間。
  const LOCAL_DUST_ORIGINS = {
    x: LOCAL_HAZE.x + 235, y: DUST_ORIGINS.y, w: LOCAL_HAZE.w - 235, h: LOCAL_DUST_OVERLAP - 44
  };
  const LOCAL_DUST_RATE = DUST_GUST_RATE *
    (LOCAL_HAZE.w * LOCAL_DUST_OVERLAP) / (DUST_ORIGINS.w * DUST_ORIGINS.h);

  // x, y, 寬, 高, 沿旗桿的斜率, 末端下垂, 振幅, 遠近色調
  const CLOTH = [
    { sprite: 0, x: 252, y: 71, w: 283, h: 176, lean: -54, drop: 94, swing: 26, haze: 0 },
    { sprite: 1, x: 184, y: 305, w: 157, h: 29, lean: -10, drop: 54, swing: 18, haze: 0 },
    { sprite: 0, x: 303, y: 343, w: 101, h: 46, lean: -7, drop: 23, swing: 9, haze: .32 },
    { sprite: 1, x: 261, y: 400, w: 55, h: 13, lean: -3, drop: 18, swing: 6, haze: .35 },
    { sprite: 0, x: 1360, y: 485, w: 108, h: 48, lean: -15, drop: 22, swing: 11, haze: .25 },
    { sprite: 1, x: 1630, y: 405, w: 54, h: 16, lean: -4, drop: 22, swing: 6, haze: .45 }
  ];
  // 底圖錨點依序為鎧甲胸縫、斷劍護手、右側肋骨與遠近殘骸。
  const WISPS = [
    [550, 615, 69, 1], [955, 810, 55, .90], [1289, 674, 68, .87],
    [65, 538, 53, .46], [1085, 654, 37, .55], [1583, 643, 54, .67], [1187, 702, 24, .48]
  ];
  // 火源對齊底圖山稜的明亮裂隙。最遠一帶在岩脊後方，只露出較弱的火光。
  const FIRE_RIDGES = [
    { strength: .82, points: [[1206, 221, 22], [1249, 284, 24], [1269, 318, 22], [1281, 313, 24], [1300, 308, 25], [1314, 301, 19]] },
    { strength: .94, points: [[1411, 364, 22], [1434, 357, 22], [1457, 351, 24], [1470, 345, 24], [1507, 336, 24]] },
    { strength: .59, points: [[1566, 282, 18], [1582, 284, 20], [1599, 277, 17], [1622, 297, 19]] }
  ];
  const SAND_SHADES = ['#a9845b', '#c6a478', '#e0b780', '#f4d4a2', '#74604d'];

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
      GATE_SKY_OPENING
    );
    ctx.fill(openings);
    return mask;
  }

  function makeLocalHaze() {
    const { w, h } = LOCAL_HAZE;
    const surface = canvas(w, h);
    const mask = canvas(w, h);
    const maskContext = mask.getContext('2d');
    const horizontal = maskContext.createLinearGradient(0, 0, w, 0);
    const vertical = maskContext.createLinearGradient(0, 0, 0, h);
    for (const edge of [horizontal, vertical]) {
      edge.addColorStop(0, 'transparent');
      edge.addColorStop(.17, '#000');
      edge.addColorStop(.81, '#000');
      edge.addColorStop(1, 'transparent');
    }
    maskContext.fillStyle = horizontal;
    maskContext.fillRect(0, 0, w, h);
    maskContext.globalCompositeOperation = 'destination-in';
    maskContext.fillStyle = vertical;
    maskContext.fillRect(0, 0, w, h);
    return { surface, mask, context: surface.getContext('2d') };
  }

  function makeAtmosphere() {
    const sky = canvas(768, 432);
    const skyContext = sky.getContext('2d');
    const clouds = [
      { tile: vaporTexture(512, 120, [180, 140, 104], 91, true), w: 1910, y: -52, h: 310, speed: 3.5, alpha: .36 },
      { tile: vaporTexture(512, 125, [71, 59, 54], 413, true), w: 1460, y: -28, h: 356, speed: 6.7, alpha: .59 },
      { tile: vaporTexture(512, 100, [159, 122, 91], 611, true), w: 1160, y: 151, h: 240, speed: 9.6, alpha: .38 }
    ];
    const leftBank = { tile: vaporTexture(512, 128, [64, 50, 42], 1003, true), w: 970, y: -38, h: 406, speed: 14.4, alpha: .67 };
    const midground = {
      tile: vaporTexture(512, 78, [160, 127, 94], 781, true), w: 1480, y: 354, h: 174,
      speed: MIDGROUND_FOG_SPEED, alpha: .29 * MIDGROUND_FOG_DENSITY
    };
    const groundFog = {
      tile: vaporTexture(512, 128, [161, 145, 122], 1207, true),
      w: 1120, y: LOCAL_HAZE.y - 22, h: LOCAL_HAZE.h + 36, speed: -7.5, alpha: .38
    };
    for (const cloud of [...clouds, leftBank, midground, groundFog]) cloud.pattern = skyContext.createPattern(cloud.tile, 'repeat-x');
    const leftFade = skyContext.createLinearGradient(410, 0, 640, 0);
    leftFade.addColorStop(0, '#000');
    leftFade.addColorStop(1, 'transparent');
    // 裁切範圍落在拱門石材上，開口邊緣仍由原畫遮罩羽化。
    const gateBounds = 'M716 145H951V426H716Z';
    return {
      sky, skyContext, clouds, leftBank, leftFade, midground, groundFog, mask: skyMask(),
      gate: new Path2D(gateBounds),
      outsideGate: new Path2D('M0 0H' + WIDTH + 'V' + HEIGHT + 'H0Z ' + gateBounds),
      localHaze: makeLocalHaze(),
      lightningGlow: vaporTexture(192, 144, [242, 74, 65], 1751, false),
      sand: vaporTexture(192, 48, [181, 138, 89], 561, false),
      haze: vaporTexture(192, 56, [141, 108, 76], 801, false),
      spirit: vaporTexture(64, 112, [93, 201, 183], 171, false),
      embers: makeEmbers()
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
    const { sky, skyContext, mask, clouds, leftBank, leftFade, gate, outsideGate, midground } = atmosphere;
    skyContext.setTransform(1, 0, 0, 1, 0, 0);
    skyContext.clearRect(0, 0, sky.width, sky.height);
    skyContext.save();
    skyContext.scale(sky.width / WIDTH, sky.height / HEIGHT);
    cloudStrip(skyContext, leftBank, time);
    skyContext.save();
    skyContext.globalCompositeOperation = 'destination-in';
    skyContext.fillStyle = leftFade;
    skyContext.fillRect(0, 0, WIDTH, HEIGHT);
    skyContext.restore();

    skyContext.save();
    skyContext.clip(outsideGate, 'evenodd');
    for (const cloud of clouds) cloudStrip(skyContext, cloud, time);
    skyContext.restore();
    skyContext.clip(gate);
    for (const cloud of clouds) cloudStrip(skyContext, cloud, time * GATE_FOG_RATE);
    skyContext.restore();
    skyContext.save();
    skyContext.globalCompositeOperation = 'destination-in';
    skyContext.drawImage(mask, 0, 0);
    skyContext.restore();
    ctx.drawImage(sky, 0, 0, WIDTH, HEIGHT);
    cloudStrip(ctx, midground, time);
  }

  function lightningPath(start, end, roughness, random) {
    let points = [start, end];
    for (let level = 0; level < 5; level++) {
      const next = [];
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const offset = (random() - .5) * roughness * Math.pow(.51, level);
        next.push(a, {
          x: (a.x + b.x) / 2 + dy / distance * offset,
          y: (a.y + b.y) / 2 - dx / distance * offset * .42
        });
      }
      next.push(points[points.length - 1]);
      points = next;
    }
    return points;
  }

  function makeGateLightning(glow) {
    const random = Math.random;
    const { x, y, w, h } = LIGHTNING_BOUNDS;
    const start = { x: 816 + random() * 48, y: 202 + random() * 18 };
    const end = { x: start.x - 43 + random() * 80, y: 321 + random() * 47 };
    const main = lightningPath(start, end, 35 + random() * 24, random);
    const paths = [{ points: main, width: .82 + random() * .32, alpha: 1 }];
    for (let i = 0; i < 7; i++) {
      const root = main[5 + Math.floor(random() * 22)];
      const direction = random() < .5 ? -1 : 1;
      const tip = {
        x: root.x + direction * (10 + random() * 28),
        y: root.y + 10 + random() * 34
      };
      const branch = lightningPath(root, tip, 10 + random() * 9, random);
      paths.push({ points: branch, width: .25 + random() * .25, alpha: .43 + random() * .37 });
      const fork = branch[11 + Math.floor(random() * 12)];
      paths.push({
        points: lightningPath(fork, { x: fork.x + direction * (5 + random() * 12), y: fork.y + 5 + random() * 13 }, 5, random),
        width: .16 + random() * .13, alpha: .22 + random() * .3
      });
    }

    const channel = canvas(w, h), clouds = canvas(w, h);
    const ctx = channel.getContext('2d');
    const cloud = clouds.getContext('2d');
    const opening = new Path2D(GATE_SKY_OPENING);
    ctx.translate(-x, -y);
    ctx.clip(opening);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const path of paths) {
      ctx.globalAlpha = path.alpha;
      ctx.beginPath();
      path.points.forEach((p, i) => { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.shadowColor = '#e71e48';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = 'rgba(196,17,47,.32)';
      ctx.lineWidth = path.width * 8;
      ctx.stroke();
      ctx.shadowBlur = 3;
      ctx.strokeStyle = '#f53d56';
      ctx.lineWidth = path.width * 2.4;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffd6c8';
      ctx.lineWidth = path.width * .66;
      ctx.stroke();
    }

    cloud.translate(-x, -y);
    cloud.clip(opening);
    const centerX = (start.x + end.x) / 2;
    const centerY = start.y + (end.y - start.y) * .37;
    const scatter = cloud.createRadialGradient(centerX, centerY, 2, centerX, centerY, 101);
    scatter.addColorStop(0, 'rgba(234,55,61,.38)');
    scatter.addColorStop(.45, 'rgba(177,27,48,.21)');
    scatter.addColorStop(1, 'rgba(113,16,33,0)');
    cloud.fillStyle = scatter;
    cloud.fillRect(x, y, w, h);
    cloud.globalAlpha = .64;
    cloud.drawImage(glow, centerX - 98, centerY - 79, 196, 158);
    cloud.globalAlpha = .34;
    cloud.drawImage(glow, centerX - 61, centerY - 32, 156, 167);
    return {
      channel, clouds,
      pulses: [{ at: 0, strength: 1, decay: .095 },
        { at: .13 + random() * .07, strength: .52 + random() * .32, decay: .07 },
        { at: .31 + random() * .10, strength: .23 + random() * .31, decay: .09 }]
    };
  }

  function drawGateLightning(ctx, glow, state, time, motionScale) {
    if (state.event && time - state.started >= 1.1) {
      state.event = null;
      state.next = time + 7 + Math.random() * 12;
    }
    if (!state.event && time >= state.next) {
      state.event = makeGateLightning(glow);
      state.started = time;
    }
    if (!state.event) return;
    const age = time - state.started;
    let flash = 0;
    if (motionScale < 1) {
      flash = .53 * Math.pow(Math.sin(Math.PI * clamp(age / .82)), 2);
    } else {
      for (const pulse of state.event.pulses) {
        const since = age - pulse.at;
        if (since >= 0) flash += pulse.strength * Math.min(1, since / .009) * Math.exp(-since / pulse.decay);
      }
    }
    const afterglow = (1 - Math.exp(-age / .035)) * Math.exp(-age / .34);
    const { x, y } = LIGHTNING_BOUNDS;
    ctx.save();
    ctx.globalAlpha = Math.min(1, flash * .85 + afterglow * .45) * motionScale;
    ctx.drawImage(state.event.clouds, x, y);
    ctx.globalAlpha = Math.min(1, flash) * motionScale;
    ctx.drawImage(state.event.channel, x, y);
    ctx.restore();
  }

  function clothSprites(atlas) {
    return [[90, 0, 1603, 647], [125, 704, 1500, 171]].map(([x, y, w, h]) => {
      const sprite = canvas(Math.ceil(w / 2), Math.ceil(h / 2));
      sprite.getContext('2d').drawImage(atlas, x, y, w, h, 0, 0, sprite.width, sprite.height);
      return sprite;
    });
  }

  function updateClothWind(wind, time) {
    if (time >= wind.end) {
      wind.start = time;
      wind.end = time + 1.4 + Math.random() * 4.8;
      wind.from = wind.to;
      wind.to = .20 + Math.random() * 1.14;
    }
    const progress = (time - wind.start) / (wind.end - wind.start);
    wind.strength = wind.from + (wind.to - wind.from) * ease(progress);
    wind.phase += (time - wind.last) * (1.9 + wind.strength * 3.4);
    wind.last = time;
  }

  function clothPoint(flag, u, v, wind, index, motionScale) {
    const travel = wind.phase - u * 8 + index * 1.7;
    const flex = u * u * flag.swing * motionScale * wind.strength;
    const fold = Math.sin(travel + v * .85);
    const snap = Math.sin(travel * 2.38 + v * 1.2);
    const flutter = flex * (fold + .34 * snap);
    // 旗布沿旗桿的斜向彎曲，強風時窄布條也保有連續的網格。
    return {
      x: flag.x + u * flag.w + v * flag.lean + flex * (.28 * fold - .35 + .09 * snap) + flutter * flag.lean / flag.h,
      y: flag.y + v * flag.h + u * flag.drop + flutter
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

  function drawCloth(ctx, sprites, wind, motionScale) {
    for (const [index, flag] of CLOTH.entries()) {
      const sprite = sprites[flag.sprite];
      const columns = index === 0 ? 12 : 6;
      const rows = flag.sprite === 0 ? 3 : 2;
      const sw = sprite.width / columns, sh = sprite.height / rows;
      const mesh = [];
      for (let y = 0; y <= rows; y++) {
        for (let x = 0; x <= columns; x++) mesh.push(clothPoint(flag, x / columns, y / rows, wind, index, motionScale));
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
    ctx.save();
    for (const [index, [x, y, height, strength]] of WISPS.entries()) {
      const t = time + index * 2.31;
      const radius = height * .44;
      const light = ctx.createRadialGradient(x, y - 3, 1, x, y - 3, radius);
      light.addColorStop(0, 'rgba(87,217,191,.56)');
      light.addColorStop(.32, 'rgba(58,180,160,.27)');
      light.addColorStop(1, 'rgba(49,146,150,0)');
      ctx.globalAlpha = strength * (.84 + .16 * Math.sin(t * 1.3));
      ctx.fillStyle = light;
      ctx.fillRect(x - radius, y - 3 - radius, radius * 2, radius * 2);
      for (let curl = 0; curl < 8; curl++) {
        const age = mod(t * (.32 + (curl % 3) * .027) + curl * .127, 1);
        const drift = height * (-.32 * age * age + .18 * Math.sin(age * 8 + t * 1.24 + curl) * age);
        const w = height * (.22 + .38 * age), h = height * (.48 + .23 * age);
        const peak = Math.sin(age * Math.PI);
        ctx.save();
        ctx.translate(x + drift, y - age * height);
        ctx.rotate(-.12 - .32 * age + Math.sin(t * 1.9 + curl) * .16);
        ctx.globalAlpha = .78 * strength * peak * (1 - age * .54);
        ctx.drawImage(sprite, -w / 2, -h * .72, w, h);
        ctx.restore();
      }
      const filament = ctx.createLinearGradient(x, y, x, y - height);
      filament.addColorStop(0, 'rgba(177,252,221,.63)');
      filament.addColorStop(.35, 'rgba(103,213,205,.33)');
      filament.addColorStop(1, 'rgba(90,180,192,0)');
      ctx.strokeStyle = filament;
      ctx.lineCap = 'round';
      for (let thread = 0; thread < 3; thread++) {
        const sway = Math.sin(t * 1.8 + thread * 2.1);
        const flow = Math.sin(t * 1.2 + thread * 2.9);
        ctx.lineWidth = height * (.014 + thread * .004);
        ctx.beginPath();
        ctx.moveTo(x + (thread - 1) * height * .045, y - 2);
        ctx.bezierCurveTo(x + height * (.05 + sway * .15), y - height * .31,
          x - height * (.19 + flow * .19), y - height * .61,
          x - height * (.30 + sway * .17), y - height * (.72 + thread * .105));
        ctx.stroke();
      }
      ctx.fillStyle = '#b3ffe7';
      for (let mote = 0; mote < 6; mote++) {
        const age = mod(t * (.20 + mote * .019) + mote * .227, 1);
        const drift = Math.sin(mote * 3.4 + age * 7) * age * .28 - age * .44;
        const size = height * (.014 + (mote % 3) * .005) * (1 - age * .4);
        ctx.globalAlpha = strength * .79 * Math.sin(age * Math.PI) ** 2;
        ctx.fillRect(x + height * drift, y - height * 1.14 * age, size, size);
      }
    }
    ctx.restore();
  }

  function makeEmbers() {
    const random = randomStream(4547);
    return Array.from({ length: 34 }, () => ({
      x: random() * (WIDTH + 40),
      y: 310 + random() * 585,
      phase: random() * TAU,
      speed: 9 + random() * 26,
      rise: 2 + random() * 6,
      size: .5 + random() * 1.6
    }));
  }

  function drawEmbers(ctx, embers, time, motionScale) {
    ctx.save();
    for (const { x, y, phase, speed, rise, size } of embers) {
      const drift = mod(x - time * speed, WIDTH + 40) - 20;
      const lift = mod(y - 310 - time * rise, 585);
      const altitude = 310 + lift + Math.sin(time * .85 + phase) * 6;
      const flicker = .5 + .5 * Math.sin(time * 1.4 + phase);
      ctx.globalAlpha = .64 * motionScale * flicker ** 2 * Math.sin(lift / 585 * Math.PI);
      ctx.fillStyle = '#b85f38';
      ctx.fillRect(drift - size * .55, altitude - size * .55, size * 2.1, size * 2.1);
      ctx.fillStyle = '#ffc18b';
      ctx.fillRect(drift, altitude, size, size * .8);
    }
    ctx.restore();
  }

  function fireLight(image, x, y, radius) {
    const size = radius * 2;
    const light = canvas(size, size);
    const sample = light.getContext('2d', { willReadFrequently: true });
    sample.drawImage(image, x - radius, y - radius, size, size, 0, 0, size, size);
    let pixels;
    try {
      pixels = sample.getImageData(0, 0, size, size);
    } catch (error) {
      if (error.name === 'SecurityError') return null;
      throw error;
    }
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const i = (row * size + col) * 4;
        const [red, green, blue] = [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]];
        const heat = clamp((red - green - 24) / 59) * clamp((red - blue - 40) / 76);
        const falloff = ease(clamp(1 - Math.hypot(col - radius, row - radius) / radius));
        // 以原畫暖色明暗做遮罩，保留火線前的山石和裂紋。
        pixels.data[i] = 255;
        pixels.data[i + 1] = Math.min(198, green + 58);
        pixels.data[i + 2] = blue + 24;
        pixels.data[i + 3] = Math.round(255 * clamp(FIRE_INTENSITY * heat * falloff));
      }
    }
    sample.putImageData(pixels, 0, 0);
    return light;
  }

  function makeFires(image) {
    const random = randomStream(7265);
    return FIRE_RIDGES.flatMap(({ strength, points }) => points.map(([x, y, radius]) => {
      const halo = canvas(radius * 4, radius * 4);
      const ctx = halo.getContext('2d');
      const center = radius * 2;
      ctx.translate(center, center);
      ctx.scale(1.28, .85);
      const glow = ctx.createRadialGradient(0, -radius * .38, 0, 0, -radius * .38, radius * 1.43);
      glow.addColorStop(0, 'rgba(216,86,39,' + .33 * FIRE_INTENSITY + ')');
      glow.addColorStop(.44, 'rgba(184,69,33,' + .16 * FIRE_INTENSITY + ')');
      glow.addColorStop(1, 'rgba(137,59,37,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-center, -center, center * 2, center * 2);
      return {
        x, y, radius, strength, halo, detail: fireLight(image, x, y, radius),
        phase: random() * TAU, rate: .9 + random() * 2.4,
        sparks: Array.from({ length: 3 }, () => ({
          phase: random() * 5, life: .78 + random() * 1.38,
          drift: 3 + random() * 15, rise: 4 + random() * 20, size: .35 + random() * .8
        }))
      };
    }));
  }

  function drawFires(ctx, fires, time) {
    for (const fire of fires) {
      const { x, y, radius, strength, halo, detail, phase, rate, sparks } = fire;
      const roll = ease(.5 + .5 * Math.sin(time * rate + phase));
      const flicker = .5 + .29 * Math.sin(time * (rate * 3.3 + 2.1) - phase)
        + .21 * Math.sin(time * (rate * 5.2 + 1.3) + phase);
      ctx.globalAlpha = strength * (.19 + .68 * roll + .13 * flicker);
      ctx.drawImage(halo, x - radius * 2, y - radius * 2);
      ctx.globalAlpha = strength * (.16 + .44 * roll + .40 * flicker);
      if (detail) ctx.drawImage(detail, x - radius, y - radius);

      const tongue = FIRE_INTENSITY * strength * (1 + 4.8 * roll * flicker);
      const bend = Math.sin(time * rate * 3 + phase) * 1.3;
      ctx.fillStyle = '#ffba7b';
      ctx.globalAlpha = clamp(FIRE_INTENSITY * strength * flicker * roll * .57);
      ctx.beginPath();
      ctx.moveTo(x - .9, y + .5);
      ctx.quadraticCurveTo(x - 1.2, y - tongue * .52, x + bend + .5, y - tongue);
      ctx.quadraticCurveTo(x + 1.9, y - tongue * .38, x + 1, y + .5);
      ctx.fill();
      for (const spark of sparks) {
        const age = mod(time + spark.phase, spark.life) / spark.life;
        const lift = Math.sin(Math.PI * age);
        ctx.globalAlpha = clamp(FIRE_INTENSITY * strength * lift * lift * (.22 + .32 * flicker));
        const emberX = x + spark.drift * age + Math.sin(age * 5 + phase) * age * 2;
        const emberY = y - spark.rise * age;
        ctx.fillRect(emberX, emberY, spark.size * 1.3, spark.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  function makeDustGust(start, area, amount) {
    const random = Math.random;
    const y = area.y + random() * area.h, x = area.x + random() * area.w;
    const depth = .58 + (y - DUST_ORIGINS.y) / DUST_ORIGINS.h * .89;
    const release = .65 + random() * 2.95, strength = .31 + random() * .69;
    const sweep = depth * (80 + random() * 140);
    const span = depth * (185 + random() * 195), slope = (random() - .5) * 37;
    const push = .74 + strength * .64;

    // 陣風前緣沿地表前進，沙粒沿一段寬的風帶掀起，各自散去。
    function liftOff() {
      const along = (random() + random()) / 2;
      return {
        x: x - along * sweep + (random() - .5) * span,
        y: y + along * slope + (random() - .5) * (22 + strength * 21) * depth,
        born: start + along * release,
        spread: random() - .5,
        drift: (random() - .57) * (36 + strength * 22) * depth,
        curl: (random() - .5) * (10 + strength * 18) * depth,
        phase: random() * TAU
      };
    }

    const grains = Array.from({ length: Math.round(156 + strength * 243) * amount }, () => ({
      ...liftOff(), speed: depth * push * (22 + random() * 58), life: .54 + random() * 1.57,
      loft: depth * (2 + random() * 13), size: depth * (.25 + random() * random() * 1.35)
    }));
    const trails = Array.from({ length: Math.round(6 + strength * 12) * amount }, () => ({
      ...liftOff(), speed: depth * push * (21 + random() * 33), life: 1.7 + random() * 2.9,
      loft: depth * (2 + random() * 8), breadth: .66 + random() * .68, pale: random() > .46
    }));
    return { depth, strength, grains, trails, end: start + release + 4.6 };
  }

  function sandX(particle, age, progress) {
    return particle.x - particle.speed * age * (.77 + (.30 + particle.spread * .46) * progress);
  }

  function sandY(particle, progress, loft) {
    const turbulence = Math.sin(particle.phase + progress * 7) * particle.curl;
    return particle.y + particle.drift * progress * progress + (turbulence - particle.loft) * loft;
  }

  function drawDust(ctx, textures, dust, time, motionScale) {
    if (time >= dust.next) {
      // 只排入當下的陣風，慢幀後不補播已錯過的沙塵。
      dust.gusts.push(makeDustGust(Math.max(dust.next, time - .9), dust.area, dust.amount));
      dust.next = time + (1.02 + Math.pow(Math.random(), 1.6) * 4.2) / dust.rate;
    }
    dust.gusts = dust.gusts.filter(gust => time < gust.end);
    for (const { depth, strength, trails } of dust.gusts) {
      for (const trail of trails) {
        const age = time - trail.born;
        const progress = age / trail.life;
        if (progress <= 0 || progress >= 1) continue;
        const fade = Math.sin(progress * Math.PI);
        const width = (46 + 194 * progress) * depth * trail.breadth;
        const height = (5 + 29 * progress * progress) * depth * trail.breadth * dust.fogHeight;
        const turn = (.12 * Math.sin(trail.phase + progress * 5) + trail.drift * .003) * progress;
        ctx.save();
        ctx.translate(sandX(trail, age, progress), sandY(trail, progress, fade));
        ctx.rotate(turn);
        ctx.globalAlpha = fade * (.34 + strength * .46) * motionScale;
        ctx.drawImage(trail.pale ? textures.sand : textures.haze, -width * .85, -height * .78, width, height);
        ctx.restore();
      }
    }
    for (const { strength, grains } of dust.gusts) {
      for (let i = 0; i < grains.length; i++) {
        const grain = grains[i];
        const age = time - grain.born;
        const progress = age / grain.life;
        if (progress <= 0 || progress >= 1) continue;
        const hop = 4 * progress * (1 - progress);
        ctx.globalAlpha = Math.min(1, progress * 7) * (1 - progress) * (.24 + strength * .62) * motionScale;
        ctx.fillStyle = SAND_SHADES[i % SAND_SHADES.length];
        ctx.fillRect(sandX(grain, age, progress), sandY(grain, progress, hop),
          grain.size * (1.15 + grain.speed * .015), grain.size * .76);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawLocalDust(ctx, atmosphere, dust, time, motionScale) {
    const { x, y, w, h } = LOCAL_HAZE;
    const { surface, mask, context } = atmosphere.localHaze;
    context.clearRect(0, 0, w, h);
    context.save();
    context.translate(-x, -y);
    cloudStrip(context, atmosphere.groundFog, time);
    drawDust(context, atmosphere, dust, time, motionScale);
    context.restore();
    context.save();
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(mask, 0, 0);
    context.restore();
    ctx.drawImage(surface, x, y);
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
    still.src = new URL('battlefield-atmosphere.webp', ASSETS);
    const surface = layer(root, canvas(1, 1), fill);
    const ctx = surface.getContext('2d');
    layer(root, document.createElement('div'), {
      position: 'absolute', inset: '0',
      background: 'radial-gradient(ellipse at 50% 49%, rgba(17,12,12,.26), transparent 63%), radial-gradient(ellipse at 50% 45%, transparent 49%, rgba(16,10,10,.37) 100%)'
    });

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const atmosphere = ctx && makeAtmosphere();
    let disposed = false, inView = false, frame = null, previous = null;
    let sprites, fires, time = 5.6, lastPaint = -Infinity;
    const dust = { gusts: [], next: time - .9, area: DUST_ORIGINS, rate: DUST_GUST_RATE, fogHeight: 1, amount: 1 };
    // 加一條與原區域出現率相同的獨立陣風，使區內頻率加倍。
    const localDust = {
      gusts: [], next: time - .7, area: LOCAL_DUST_ORIGINS, rate: LOCAL_DUST_RATE,
      fogHeight: 1.85, amount: LOCAL_DUST_AMOUNT
    };
    const clothWind = { end: time, last: time, phase: time * 4.2, to: .72 };
    const lightning = { event: null, next: time + 2.8 + Math.random() * 3.4, started: 0 };

    function draw() {
      if (!ctx || !inView) return;
      const motionScale = motion.matches ? REDUCED_MOTION_SCALE : 1;
      ctx.setTransform(surface.width / WIDTH, 0, 0, surface.height / HEIGHT, 0, 0);
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      if (fires) drawFires(ctx, fires, time);
      drawGateLightning(ctx, atmosphere.lightningGlow, lightning, time, motionScale);
      drawClouds(ctx, atmosphere, time);
      if (sprites) {
        updateClothWind(clothWind, time);
        drawCloth(ctx, sprites, clothWind, motionScale);
      }
      drawWisps(ctx, atmosphere.spirit, time);
      drawDust(ctx, atmosphere, dust, time, motionScale);
      drawLocalDust(ctx, atmosphere, localDust, time, motionScale);
      drawEmbers(ctx, atmosphere.embers, time, motionScale);
    }

    function tick(now) {
      frame = null;
      if (disposed || !inView || document.hidden || !root.isConnected) {
        previous = null;
        return;
      }
      // 降低背景的動態強度，仍保留連續演出。
      if (previous !== null) time += (now - previous) / 1000 * (motion.matches ? REDUCED_MOTION_SCALE : 1);
      previous = now;
      if (now - lastPaint >= FRAME_MS - 1) {
        lastPaint = now;
        draw();
      }
      frame = requestAnimationFrame(tick);
    }

    function syncPlayback() {
      const play = ctx && inView && !disposed && !document.hidden && root.isConnected;
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

    const atlas = new Image();
    if (ctx) atlas.src = new URL('cloth-atlas.webp', ASSETS);
    const atlasReady = ctx ? atlas.decode().then(() => {
      if (disposed) return false;
      sprites = clothSprites(atlas);
      draw();
      return true;
    }, () => false) : Promise.resolve(false);
    const stillReady = still.decode().then(() => {
      if (disposed) return false;
      if (ctx) fires = makeFires(still);
      draw();
      return true;
    }, () => false);

    return {
      ready: Promise.all([stillReady, atlasReady])
        .then(results => !disposed && results.every(Boolean)),
      destroy() {
        if (disposed) return;
        disposed = true;
        syncPlayback();
        resize.disconnect();
        visibility.disconnect();
        document.removeEventListener('visibilitychange', syncPlayback);
        surface.width = surface.height = 0;
        sprites = null;
        fires = null;
        dust.gusts.length = 0;
        localDust.gusts.length = 0;
        lightning.event = null;
        root.remove();
      }
    };
  }

  return { mount };
})();
