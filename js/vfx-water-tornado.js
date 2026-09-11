'use strict';
/* Original water-tornado construction, evaluated at runtime. No images or flipbook.
   Core supplies time; this module returns geometry/pixels, never owns a ticker or DOM.
   Components share the same water-volume equation, but remain separate editor layers. */
var VFXWaterTornado = (function () {
  var TAU = Math.PI * 2, SIZE = 320;
  var PARTS = ['halo', 'rear-ribbons', 'rear-sheets', 'body', 'front-sheets', 'white-crests', 'front-ribbons', 'base', 'bloom', 'dust', 'spray', 'cyclone-rear', 'cyclone-front'];
  var SHEETS = [[0.02365975443136804, -0.46519314773330445, 2.610106874012103, 0.056643926353784346, 0.9649827894583254, 4.054516154345219], [0.05729986863238355, 0.017429018526247786, 3.574378350993001, 0.03582454107640964, 0.6960557931624624, 0.06351078633081064], [0.10673609154349062, -0.4334274818816455, 2.365976212085835, 0.06688174264144432, 1.096345966494638, 0.5137108420696083], [0.1662438684500654, -0.1327824604756228, 2.747829979615223, 0.06152113172535501, 0.8599462544374519, 0.8649631891259818], [0.18345867305102723, -0.2877514670409795, 2.7823935327699854, 0.03235759595132496, 0.6502185095565658, 5.009016370368174], [0.2576391508408289, -0.504623366466615, 3.2182080492102134, 0.044149294796552045, 0.661214925953489, 3.0114143960633726], [0.265562517204271, 0.3588745929880609, 3.753164506238809, 0.03279421397084197, 0.6022373860815405, 5.1339268796443775], [0.310687043676363, 0.18995688557880663, 2.5444561653275097, 0.03581913998259008, 0.904274151763313, 2.673501123610644], [0.36895732028294603, 0.2718568367371833, 2.6504699043958366, 0.04400957899150848, 0.7807880556896403, 1.400724433074496], [0.40083934329640014, -0.020312144311402935, 3.660773596983897, 0.058850786886614756, 0.6875342931120388, 3.041486299970057], [0.475344306582549, -0.6084952623468958, 2.537948173717443, 0.05195854870546377, 0.6798256302411791, 5.208341162858979], [0.4919546781624438, 0.12277870885345477, 2.740681842385902, 0.040979508249361085, 0.783225730763679, 0.8553904507404643], [0.558673550015681, 0.3088201587459716, 3.540395717868086, 0.037063917513549295, 0.9199734017985013, 5.700664941264143], [0.5892411794034599, -0.01964930170134005, 3.2025500487288, 0.04842403796268724, 0.6796095986594459, 5.763740894959456], [0.6497220153736302, 0.5784334035737851, 3.618164415251657, 0.050848476417424855, 1.1811361971069299, 1.2741829076910438], [0.6800776226253816, 0.1284062161447337, 2.089864927317977, 0.03510890816535199, 0.8600302873131781, 3.3291909116546274], [0.7248687827860768, -0.4648101440619131, 3.420995716440387, 0.054457899585103026, 0.7074416926661898, 4.491977729924247], [0.7666100529131592, 0.1609924189119274, 3.7251371633360852, 0.06492445237214789, 0.6459727834439496, 0.0824491338897454], [0.8355708310496641, -0.4451758848861808, 3.77805071881187, 0.04363321888155225, 0.6938993841519127, 0.6964852561141285], [0.8793213521745237, -0.007430629779804576, 3.1053403310329237, 0.05481386511870555, 0.7553854501672307, 0.8081764812398148], [0.8978663361701084, 0.5899068206493238, 3.4250453224826947, 0.03467338089763731, 0.8402316752961185, 0.2148019187158543], [0.9721594445054466, -0.45292477092155625, 1.8921398661156144, 0.06529714626937061, 0.7976543529783151, 1.7290100092485483]];
  var cache = new Map();
  function clamp(v) { return Math.max(0, Math.min(1, v)); }
  function mod(v) { return v - Math.floor(v); }
  function shape(q, p) {
    return [320 + 13 * Math.sin(q * 7 + p) * Math.sin(Math.PI * clamp(q)) + 9 * Math.sin(q * 12 - p),
      (70 + 70 * Math.pow(2 * q - 1, 2)) * (1 + .026 * Math.sin(q * 29 - p * 2))];
  }
  function polygon(out, points, color) { out.push({ points: points, color: color }); }
  function line(out, points, color, width) { out.push({ points: points, color: color, line: width }); }
  function random(seed) { return function () { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; }; }
  function pixels(part, p, stride) {
    stride = stride || 1;
    var data = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (var iy = 0; iy < SIZE; iy+=stride) {
      var y = iy * 2 + .5, qg = (y - 8) / 578, q = clamp(qg), cr = shape(q, p), c = cr[0], r = cr[1];
      for (var ix = 0; ix < SIZE; ix+=stride) {
        var x = ix * 2 + .5, red, green, blue, alpha;
        if (part === 'halo') {
          var distance = Math.abs(x - c) - r * 1.01;
          var band = Math.exp(-Math.max(distance, 0) / 28) * clamp((distance + 17) / 20) * clamp((1.05 - qg) / .09) * clamp((qg + .06) / .08) * (.82 + .18 * Math.sin(q * 17 + p * 2));
          var wide = Math.exp(-Math.max(distance, 0) / 49) * clamp((distance + 6) / 19) * clamp((1.05 - qg) / .09) * clamp((qg + .06) / .08);
          red = band * 12 + wide * 2; green = band * 46 + wide * 10; blue = band * 78 + wide * 29;
          alpha = clamp(blue / 255 * 1.6);
        } else {
          var u = (x - c) / (r * 1.11);
          if (Math.abs(u) >= 1 && (Math.pow((x - 320) / 150, 2) + Math.pow((y - 595) / 36, 2) >= 1)) continue;
          var a = Math.asin(Math.max(-1, Math.min(1, u)));
          var flow = q * 29 + a * 2 + p * 2 + .23 * Math.sin(q * 69 + a * 6 + p * 3);
          var surf = Math.pow(clamp((Math.sin(flow) + .3) / 1.3), 2);
          var fine = Math.pow(Math.max(0, Math.sin(flow * 3 + .7 * Math.sin(q * 93 + a * 8 - p * 2))), 7);
          var mask = clamp((1 - Math.abs(u)) / .16) * clamp((1.035 - qg) / .085) * clamp((qg + .045) / .06);
          var cross = Math.pow(clamp((Math.sin(q * 19 + a * 3.2 + p * 2 + .4 * Math.sin(q * 43 + p)) + .35) / 1.35), 1.4);
          var shade = .82 + .18 * Math.cos(a * 1.7);
          red = (5 + surf * 7 + cross * 9) * mask;
          green = (40 + surf * 72 + cross * 29 + fine * 8) * mask * shade;
          blue = (133 + surf * 77 + cross * 26 + fine * 12) * mask * shade;
          alpha = mask * (.90 + .08 * surf);
          var dx = (x - 320) / 150, dy = (y - 595) / 36, radial = Math.sqrt(dx * dx + dy * dy);
          var pm = clamp((1 - radial) / .19), swirl = Math.pow(Math.max(0, Math.sin(radial * 13 - Math.atan2(dy, dx) * 2 - p * 2)), 2);
          red = Math.max(red, (4 + swirl * 4) * pm); green = Math.max(green, (33 + swirl * 34) * pm); blue = Math.max(blue, (112 + swirl * 66) * pm);
          alpha = Math.max(alpha, pm * .96);
        }
        var k = (iy * SIZE + ix) * 4;
        if (alpha > 0) { data[k] = red / alpha; data[k + 1] = green / alpha; data[k + 2] = blue / alpha; data[k + 3] = alpha * 255;
          for(var sy=0;sy<stride;sy++)for(var sx=0;sx<stride;sx++){var dest=((iy+sy)*SIZE+ix+sx)*4;data[dest]=data[k];data[dest+1]=data[k+1];data[dest+2]=data[k+2];data[dest+3]=data[k+3];}
        }
      }
    }
    return data;
  }
  function sheetGeometry(spec, p) {
    var q0 = spec[0], off = spec[1], arc = spec[2], width = spec[3], gain = spec[4], seed = spec[5];
    var rise = mod(q0 - p / TAU) * 1.2 - .1, fade = clamp((rise + .1) / .12) * clamp((1.1 - rise) / .12), points = [], mean = 0;
    for (var k = 0; k < 96; k++) {
      var s = k / 95, angle = -q0 * 21 + off - p * 2 + (s - .5) * arc;
      var q = rise + (s - .5) * arc * .057 + .003 * Math.sin(s * 16 + seed + p * 2), cr = shape(q, p);
      var flare = 1 + .065 * Math.pow(Math.sin(s * Math.PI), 2) + .06 * Math.pow(s, 5);
      var thick = 578 * width * Math.pow(Math.sin(Math.PI * s), 1.3) * (.79 + .19 * Math.sin(s * 23 + seed) + .12 * Math.sin(s * 61 + seed * 2)) * (.8 + .3 * Math.cos(angle)) * (1 + .35 * Math.sin(Math.PI * clamp(q)));
      points.push([cr[0] + cr[1] * flare * Math.cos(angle), 8 + q * 578 + cr[1] * .13 * Math.sin(angle), Math.sin(angle), thick, s]); mean += Math.sin(angle);
    }
    return { points: points, gain: gain, seed: seed, fade: fade, depth: mean / 96 };
  }
  var sheetPhase = NaN, sheetLayers = null;
  function sheets(part, p, fire) {
    var front = part !== 'rear-sheets', crest = part === 'white-crests', out = [];
    // Fire uses 20 of 22 sheets (previously 15): roughly 30% denser.
    if(sheetPhase !== p){sheetPhase=p;sheetLayers=SHEETS.map(function(spec){return sheetGeometry(spec,p);});}
    var layers = sheetLayers.filter(function (_, i) { return !fire || i % 11 !== 4; });
    if (front) layers.sort(function (a, b) { return a.depth - b.depth; });
    layers.forEach(function (layer) {
      for (var k = 0; k < 95; k++) {
        var v = layer.points[k], n = layer.points[k + 1], z = (v[2] + n[2]) * .5;
        if ((z > 0) !== front) continue;
        var vis = clamp((z + .16) / 1.16), face = (.35 + .65 * vis) * layer.gain;
        if (!crest) polygon(out, [[v[0], v[1] - v[3] * .23], [n[0], n[1] - n[3] * .23], [n[0] + n[3] * .19, n[1] + n[3]], [v[0] + v[3] * .19, v[1] + v[3]]], [3, 55 + 125 * face, 145 + 100 * Math.min(1, face), (front ? 155 + 90 * vis : 50) * layer.fade]);
        else {
          var env = Math.max(0, Math.sin(Math.PI * v[4])), peak = .55 + .45 * Math.sin(layer.seed + v[4] * 4);
          var specular = clamp((z - .06) * 1.7) * peak, w = v[3] * (.16 + .68 * specular) * env, wn = n[3] * (.16 + .68 * specular) * env, bright = clamp(specular * 1.7);
          polygon(out, [[v[0], v[1]], [n[0], n[1]], [n[0] + wn * .55, n[1] + wn], [v[0] + w * .55, v[1] + w]], [20 + 235 * bright, 160 + 95 * bright, 255, (130 + 125 * bright) * layer.fade]);
          if (env > .2 && specular > .25) line(out, [[v[0], v[1] - .6], [n[0], n[1] - .6]], [185, 241, 255, (90 + 130 * specular) * layer.fade], 1);
        }
      }
    });
    return out;
  }
  function ribbons(front, p, fire) {
    var out = [];
    for (var j = 0; j < 17; j++) {
      if (fire && j % 2) continue;
      var h = mod(j / 17 - p / TAU) * 1.2 - .1, fade = clamp((h + .1) / .12) * clamp((1.1 - h) / .12), points = [];
      for (var k = 0; k < 130; k++) {
        var s = k / 129, a = -j * 2.39 - p * 2 + (s - .5) * (3.3 + j % 3 * .3), q = h + (s - .5) * .17, cr = shape(q, p);
        var rr = cr[1] * (1.21 + .23 * Math.pow(Math.sin(s * Math.PI), 2)) + 10 + Math.pow(s, 3) * (13 + j % 4 * 5);
        points.push([cr[0] + rr * Math.cos(a), 8 + q * 578 + rr * .15 * Math.sin(a), (4 + j % 3 * 2.5) * Math.pow(Math.sin(s * Math.PI), 1.5), a, s]);
      }
      for (var k2 = 0; k2 < 129; k2++) {
        var v = points[k2], n = points[k2 + 1], z = Math.sin((v[3] + n[3]) * .5);
        if ((z > 0) !== front) continue;
        var alpha = (60 + 76 * Math.max(0, z)) * fade * Math.pow(Math.sin(Math.PI * v[4]), .6) * (front ? 1 : .48);
        polygon(out, [[v[0], v[1]], [n[0], n[1]], [n[0] + n[2] * .4, n[1] + n[2]], [v[0] + v[2] * .4, v[1] + v[2]]], [131, 216, 255, alpha]);
        if (front && j % 3 === 0) line(out, [[v[0], v[1]], [n[0], n[1]]], [193, 235, 255, alpha * .68], 1);
      }
    }
    return out;
  }
  function base(p) {
    var out = [];
    for (var j = 0; j < 6; j++) {
      var upper = [], lower = [];
      for (var k = 0; k < 110; k++) {
        var s = k / 109, a = s * 3.9 - p * 2 + j * 1.31, r = (58 + j * 16) * (1 + .075 * Math.sin(a * 4 + p));
        var x = 320 + r * Math.cos(a), y = 599 + r * .145 * Math.sin(a), w = Math.pow(Math.sin(s * Math.PI), 1.5) * (11 + j * .8) * (1 + .3 * Math.sin(s * 17 + j));
        upper.push([x, y]); lower.push([x + w * .7, y + w]);
      }
      polygon(out, upper.concat(lower.reverse()), [4, 75 + j * 8, 170 + j * 7, 95 + j * 8]);
      if (j % 3 === 0) line(out, upper.slice(25, 80), [90, 210, 255, 170], 2);
    }
    return out;
  }
  function particles(part, p, density) {
    var out = [], rnd = random(208), count = Math.round((part === 'dust' ? 46 : 120) * density);
    for (var j = 0; j < count; j++) {
      var life = mod(p / TAU * (part === 'dust' ? 1 : 2) + rnd()), side = rnd() < .5 ? -1 : 1;
      if (part === 'dust') {
        var x = 320 + side * (42 + life * (45 + rnd() * 60)) + rnd() * 36 - 18, y = 594 - life * (25 + rnd() * 40), r = 8 + life * (16 + rnd() * 14);
        out.push({ ellipse: [x, y, r, r * .5], color: [108, 134, 154, 22 * Math.pow(Math.sin(Math.PI * life), 1.3)] });
      } else {
        var h = .1 + rnd() * .87, cr = shape(h, p), x2 = cr[0] + side * (cr[1] * .86 + life * (12 + rnd() * 68));
        var y2 = 8 + h * 578 - life * (10 + rnd() * 35) + life * life * 30, strength = Math.pow(Math.sin(Math.PI * life), 1.5) * (.25 + rnd() * .45), length = 2 + rnd() * 6;
        line(out, [[x2, y2], [x2 - side * length, y2 + length * .4]], [105, 210, 255, strength * 255], 1);
      }
    }
    return out;
  }
  // Remap generated colors before rasterization; water samples remain independent.
  function fireColor(c, y) {
    var heat = clamp((c[1] * .75 + c[0] * .25) / 255);
    var center = Math.pow(Math.sin(Math.PI * clamp(y / 620)), 1.4);
    var gain = .42 + .68 * center;
    return [(165 + heat * 90) * gain, (20 + 205 * Math.pow(heat, 1.35)) * gain, (3 + 46 * Math.pow(heat, 4)) * gain, c[3]];
  }
  function fireTopFade(x, y, p) {
    var swirlX = x + 22 * Math.sin(y * .026 - p * 2);
    var tip = 48 + 30 * Math.sin(swirlX * .037 + p * 2) + 16 * Math.sin(swirlX * .081 - p);
    var fade = clamp((y - tip) / 75);
    return fade * fade * (3 - 2 * fade);
  }
  function fireCommand(c, p) {
    var y = c.points ? c.points.reduce(function (sum, v) { return sum + v[1]; }, 0) / c.points.length : c.ellipse[1];
    var x = c.points ? c.points.reduce(function (sum, v) { return sum + v[0]; }, 0) / c.points.length : c.ellipse[0];
    var color = fireColor(c.color, y);
    color[3] *= fireTopFade(x, y, p);
    return Object.assign({}, c, { color: color });
  }
  // Ring-born spray follows angular momentum while expanding and falling.
  // The projected orbit is elliptical; height is independent of ground depth.
  function cyclone(front, p, density) {
    var out = [], mist = [], rnd = random(77123);
    function at(seed, life, r, lift, turn) {
      var angle = seed - life * turn;
      var radius = r + life * life * 100;
      return [320 + Math.cos(angle) * radius,
        320 + Math.sin(angle) * radius * .32 - Math.sin(Math.PI * life) * lift,
        Math.sin(angle)];
    }
    for (var i = 0, count = Math.round(1100 * density); i < count; i++) {
      var phase = rnd(), seed = rnd() * TAU, r = 125 + rnd() * 45;
      var lift = 8 + Math.pow(rnd(), 2) * 68, turn = 2.4 + rnd() * 1.5;
      var life = mod(p / TAU * 3 + phase), pos = at(seed, life, r, lift, turn);
      var size = .7 + rnd() * 2.2, fade = Math.pow(Math.sin(Math.PI * life), .7);
      var bright = rnd();
      if ((pos[2] >= 0) !== front) continue;
      if (i % 9 === 0) mist.push({ellipse:[pos[0],pos[1],9+size*4,3+size*2],color:[78,193,220,85*fade]});
      var prev = at(seed, Math.max(0, life - .008 - bright * .015), r, lift, turn);
      line(out, [[prev[0],prev[1]],[pos[0],pos[1]]],
        bright > .7 ? [188,244,255,185*fade] : [46,175+bright*45,231,110*fade],size);
    }
    // Broken foam gathers into spiral wakes rather than uniform circles.
    for(var arm=0;arm<5;arm++) for(var j=0;j<65;j++) {
      var u=j/65, a=arm*TAU/5-p*3-u*1.65;
      if((Math.sin(a)>=0)!==front) continue;
      var rr=138+u*82+4*Math.sin(j*1.8+arm), rr2=rr+1.2;
      var x=320+Math.cos(a)*rr,y=320+Math.sin(a)*rr*.32-5;
      var strength=Math.sin(Math.PI*u)*(.5+.5*Math.sin(j*2.3+arm));
      line(out,[[x,y],[320+Math.cos(a-.025)*rr2,320+Math.sin(a-.025)*rr2*.32-5]],
        [110,222,243,95*strength],1.5);
      if(j%3===0) mist.push({ellipse:[x,y,12,4],color:[54,167,201,30*strength]});
    }
    return {commands:out,groups:[{commands:mist,blur:5,alpha:.75}]};
  }
  function sample(part, seconds, density, palette) {
    if (PARTS.indexOf(part) < 0) throw new Error('Unknown water part: ' + part);
    density = density === undefined ? 1 : density;
    var fire = palette === 'fire';
    var tick = Math.floor(mod(seconds / 4) * 80 + 1e-7), key = part + ':' + tick + ':' + density + (fire ? ':fire' : '');
    if (cache.has(key)) return cache.get(key);
    var p = TAU * tick / 80, out = { key: key, width: SIZE, height: SIZE, commands: [] };
    if (part === 'body' || part === 'halo') out.pixels = pixels(part, p, fire ? 1 : 2);
    else if (part.indexOf('sheets') >= 0 || part === 'white-crests') out.commands = sheets(part, p, fire);
    else if (part.indexOf('ribbons') >= 0) { out.commands = ribbons(part === 'front-ribbons', p, fire); out.blur = .45; }
    else if (part.indexOf('cyclone-') === 0) { var flow = cyclone(part === 'cyclone-front', p, density); out.commands = flow.commands; out.groups = flow.groups; }
    else if (part === 'base') out.commands = base(p);
    else if (part === 'dust' || part === 'spray') { out.commands = particles(part, p, density); if (part === 'dust') out.blur = 5; }
    else if (part === 'bloom') {
      var hot = sheets('white-crests', p, fire).map(function (c) { return Object.assign({}, c, { color: [Math.max(0, c.color[0] - 90) * 1.6, Math.max(0, c.color[1] - 90) * 1.6, 255, c.color[3]] }); });
      out.groups = [{ commands: hot, blur: 5, alpha: .48 }, { commands: hot, blur: 17, alpha: .26 }];
    }
    if (fire) {
      out.commands = out.commands.map(function (c) { return fireCommand(c, p); });
      if (out.groups) out.groups.forEach(function (g) { g.commands = g.commands.map(function (c) { return fireCommand(c, p); }); });
      if (out.pixels) for (var i = 0; i < out.pixels.length; i += 4) {
        var y = Math.floor(i / 4 / SIZE) * 2, x = (i / 4 % SIZE) * 2;
        var color = fireColor([out.pixels[i], out.pixels[i + 1], out.pixels[i + 2], out.pixels[i + 3]], y);
        if (part === 'body') {
          var cr = shape(clamp((y - 8) / 578), p);
          var coreHeat = clamp(1.45 * Math.exp(-Math.pow((x - cr[0]) / (cr[1] * .8), 2)) * Math.exp(-Math.pow((y - 310) / 155, 2)));
          color[0] += (255 - color[0]) * coreHeat;
          color[1] += (238 - color[1]) * coreHeat;
          color[2] += (110 - color[2]) * coreHeat;
        }
        out.pixels[i] = color[0]; out.pixels[i + 1] = color[1]; out.pixels[i + 2] = color[2];
        // Uneven drifting flame tips, softly eroded before the texture boundary.
        out.pixels[i + 3] *= fireTopFade(x, y, p);
      }
    }
    cache.set(key, out);
    // Bounded recent samples, not a pre-rendered animation or an image atlas.
    if (cache.size > 44) cache.delete(cache.keys().next().value);
    return out;
  }
  return { PARTS: Object.freeze(PARTS), sample: sample, shape: shape };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = VFXWaterTornado;
