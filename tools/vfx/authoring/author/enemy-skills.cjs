'use strict';
/* enemy-skills.cjs — 敵人專用技能（Skills2「類別＝enemy」）的特效。

   使用者規則（2026-10-13）：敵人技能的特效不要和玩家現有技能一樣；形態相同時也要用顏色區隔，
   讓玩家在戰鬥裡一眼分得出「這是怪物放的」。所以這裡有兩種做法：
     1. 換色版：把玩家技能已有的 Preset 複製一份、把所有 tint 搬到「敵人配色」，id 一律 en- 開頭
     2. 新作：玩家沒有對應畫面的（火鏈、旋轉光束、毒十字、築牆、飛彈…）用現有素材組新 Preset
   ⚠️ 只用已經在素材庫（vfx/shipped-assets.json）裡的素材，不新增圖檔。
   用法：node tools/vfx/authoring/author/enemy-skills.cjs [id ...]   （沒給 id＝全部重生） */
const fs = require('node:fs');
const path = require('node:path');
const kit = require('../preset-kit.cjs');

/* ---------------- 顏色 ---------------- */
function hexToRgb(h) { const m = /^#([0-9a-f]{6})$/i.exec(h); const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
/* 敵人配色：theme.h＝目標色相；k＝保留原色相差異的比例（0＝全部壓成同一色相、1＝原樣平移）。
   灰白（飽和度低）原樣保留——光暈的白心不能被染掉。 */
const THEMES = {
  fire:      { h: 336, k: 0.5, s: 1.0, l: 0.97 },    // 橘紅 → 緋紅／洋紅
  ice:       { h: 156, k: 0.4, s: 0.9, l: 1.04 },    // 冰藍 → 青綠（跟玩家的冰藍差 50 度以上）
  lightning: { h: 288, k: 0.5, s: 1.0, l: 1.0 },     // 藍白／黃 → 紫紅
  poison:    { h: 72, k: 0.5, s: 1.0, l: 1.0 },      // 綠 → 酸黃綠
  earth:     { h: 265, k: 0.4, s: 0.5, l: 0.88 },    // 土黃 → 灰紫
  dark:      { h: 352, k: 0.4, s: 0.95, l: 0.85 },   // 暗紫 → 暗血紅
  light:     { h: 322, k: 0.5, s: 1.0, l: 1.0 },     // 金白 → 粉紅
  wind:      { h: 52, k: 0.5, s: 1.0, l: 1.0 },      // 青綠 → 金黃
  phys:      { h: 256, k: 0.5, s: 0.55, l: 1.04 },   // 紅／灰白 → 冷紫鋼色
  storm:     { h: 318, k: 0.5, s: 1.0, l: 1.0 },     // 雷霆風暴：紫紅（文件指定）
  warn:      { h: 330, k: 0.5, s: 1.0, l: 1.02 },    // 預警圈：洋紅（玩家技能沒有地面預警圈）
  gold:      { h: 46, k: 0.5, s: 1.0, l: 1.0 }
};
function collectTints(p) {
  const out = [];
  p.layers.forEach(l => {
    if (typeof l.tint === 'string') out.push(l.tint);
    (l.tintOverLife || []).forEach(pt => out.push(pt[1]));
  });
  return out;
}
function meanHue(tints) {
  let x = 0, y = 0;
  tints.forEach(t => {
    const [h, s, l] = rgbToHsl(...hexToRgb(t));
    const w = s * Math.min(l, 1 - l) * 2;
    x += Math.cos(h * Math.PI / 180) * w; y += Math.sin(h * Math.PI / 180) * w;
  });
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function mapTint(hex, theme, mean) {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  if (s < 0.12) return hex;
  let dh = h - mean; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
  const nh = theme.h + dh * theme.k;
  const ns = Math.min(1, s * theme.s), nl = Math.min(0.97, l * theme.l);
  return rgbToHex(...hslToRgb(nh, ns, nl));
}
function forceNeutral(p, hex) {
  p.layers.forEach(l => {
    if (l.type === 'procedural') return;
    const t = typeof l.tint === 'string' ? l.tint : '#ffffff';
    const [, sat] = rgbToHsl(...hexToRgb(t));
    if (sat < 0.12) l.tint = hex;
  });
}
/* 透明度太低時整體加深：每個圖層的 alpha 乘上倍率（最高 1） */
function boostAlpha(p, k) {
  p.layers.forEach(l => { if (typeof l.alpha === 'number') l.alpha = Math.min(1, +(l.alpha * k).toFixed(3)); });
}
function recolor(srcId, newId, themeName, tweak) {
  const theme = THEMES[themeName];
  if (!theme) throw new Error('沒有這個配色：' + themeName);
  const src = JSON.parse(fs.readFileSync(path.join(kit.REPO, 'vfx/presets', srcId + '.json'), 'utf8'));
  const p = JSON.parse(JSON.stringify(src));
  const mean = meanHue(collectTints(p));
  p.layers.forEach(l => {
    if (typeof l.tint === 'string') l.tint = mapTint(l.tint, theme, mean);
    if (l.tintOverLife) l.tintOverLife = l.tintOverLife.map(pt => [pt[0], mapTint(pt[1], theme, mean)]);
  });
  p.id = newId;
  if (tweak) tweak(p);
  return kit.write(p);
}

/* ---------------- 換色版清單：[新 id, 來源 id, 配色] ---------------- */
const RECOLORS = [
  // 預警圈與地面
  ['en-mark-red', 'mark-red', 'warn'], ['en-mark-blue', 'mark-blue', 'warn'],
  ['en-ground-domain-fire', 'ground-domain-fire', 'fire'], ['en-ground-domain-ice', 'ground-domain-ice', 'ice'],
  ['en-ground-domain-earth', 'ground-domain-earth', 'earth'], ['en-ground-mire-magma-10', 'ground-mire-magma-10', 'dark'],
  ['en-ground-blizzard', 'ground-blizzard', 'ice'], ['en-ground-tornado-wind', 'ground-tornado-wind', 'wind'],
  ['en-ground-thunder-orb', 'ground-thunder-orb', 'lightning'], ['en-field-water-prison-dome', 'field-water-prison-dome', 'ice', p => forceNeutral(p, '#7fffd0')],
  ['en-bolt-curtain-lightning', 'bolt-curtain-lightning', 'lightning'], ['en-bolt-chain-lightning', 'bolt-chain-lightning', 'lightning'],
  ['en-lava-trail', 'ground-mire-lava', 'fire'],
  // 爆發
  ['en-burst-fire-shockwave-small', 'burst-fire-shockwave-small', 'fire'], ['en-burst-fire-shockwave', 'burst-fire-shockwave', 'fire'],
  ['en-burst-fire', 'burst-fire', 'fire'], ['en-burst-frost-nova', 'burst-frost-nova', 'ice'],
  ['en-burst-earth', 'burst-earth', 'earth'], ['en-burst-rock-petrify', 'burst-rock-petrify', 'earth'],
  ['en-burst-detonate-phys', 'burst-detonate-phys', 'phys'], ['en-burst-blood', 'burst-blood', 'phys'],
  ['en-burst-holy', 'burst-holy', 'light'], ['en-burst-wind', 'burst-wind', 'wind'],
  ['en-burst-zero-infection', 'burst-zero-infection', 'poison'], ['en-burst-explosion-sheet', 'burst-explosion-sheet', 'fire', p => forceNeutral(p, '#ff4a8a')],
  ['en-ice-burst', 'burst-frost-freeze', 'ice'], ['en-vortex-burst', 'burst-gravity', 'dark', p => boostAlpha(p, 1.4)],
  ['en-molten-core-burst', 'burst-meteor-inferno', 'fire'],
  // 命中
  ['en-hit-fire', 'hit-fire', 'fire'], ['en-hit-dark', 'hit-dark', 'dark'], ['en-hit-ice', 'hit-ice', 'ice'],
  ['en-hit-lightning', 'hit-lightning', 'lightning'], ['en-hit-poison', 'hit-poison', 'poison'], ['en-hit-wind', 'hit-wind', 'wind'],
  ['en-hit-arcane', 'hit-light', 'light'], ['en-hit-spark', 'hit-lightning-blue', 'lightning'], ['en-hit-freeze', 'hit-icearrow-shatter', 'ice'],
  // 彈體
  ['en-proj-meteor-small', 'proj-meteor-small', 'fire'], ['en-proj-dark-orb', 'proj-dark-orb', 'dark'], ['en-proj-ice-shard', 'proj-ice-shard', 'ice'],
  ['en-proj-poison-drop', 'proj-poison-drop', 'poison'], ['en-proj-fireball', 'proj-fireball', 'fire'], ['en-proj-wind-crescent', 'proj-wind-crescent', 'wind'],
  ['en-proj-lightning', 'proj-lightning', 'lightning'], ['en-proj-light-orb', 'proj-light-orb', 'light'], ['en-proj-bloodrage-drain', 'proj-bloodrage-drain', 'phys'],
  ['en-mortar-shell', 'proj-fireball-ember', 'fire'],
  // 其他角色
  ['en-slash-phys-big', 'slash-phys-big', 'phys'], ['en-slash-wind-spin', 'slash-wind-spin', 'wind'], ['en-pillar-light', 'pillar-light', 'light'],
  ['en-curse-dark', 'curse-dark', 'dark'], ['en-vortex', 'black-hole', 'dark', p => { p.sizing = { shape: 'circle', authored: { radius: 100 } }; boostAlpha(p, 1.7); }],
  ['en-cast-fire', 'cast-buff-phys', 'fire', p => forceNeutral(p, '#ff5a7a')], ['en-cast-poison', 'cast-buff-def', 'poison'], ['en-cast-arcane', 'cast-magic', 'light'],
  ['en-cast-gold', 'cast-buff-light', 'gold', p => forceNeutral(p, '#ffc24a')], ['en-cast-dark', 'cast-buff-dark', 'dark'],
  ['en-bolt-storm', 'bolt-sky-purple', 'storm'], ['en-burst-storm', 'burst-detonate-dark', 'storm'], ['en-mark-storm', 'mark-blue', 'storm']
];


/* ---------------- 新作：玩家沒有對應畫面的敵人技能 ----------------
   座標慣例見 tools/vfx/authoring/README.md：地面圖層一律帶 projection（y 壓 0.5），所以在遊戲裡旋轉、
   縮放都發生在地面平面上，和模擬層的圓／線判定同一個幾何。 */
const { A, C } = kit;
const GROUND = { x: 1, y: 0.5 };
const withGround = layer => { layer.projection = GROUND; return layer; };
const D2R = Math.PI / 180;
const circleSizing = r => ({ shape: 'circle', authored: { radius: r } });
const rectSizing = (w, h) => ({ shape: 'rectangle', authored: { width: w, height: h } });
const customSizing = (w, h, wm, hm) => Object.assign({ shape: 'custom', authored: { width: w, height: h } }, wm ? { widthM: wm, heightM: hm } : null);
const orbSizing = r => ({ shape: 'projectile-circle', authored: { radius: r } });

const NEW = {};

/* 毒水窪：冒泡的濃稠酸綠色毒窪（圓形、中央發黑，邊緣翻著氣泡）——和玩家毒沼的「流動菱形泥塊」是兩種畫面。 */
NEW['en-toxic-pool'] = () => ({
  id: 'en-toxic-pool', duration: 3, loop: true,
  sizing: { shape: 'rectangle', widthM: 10, heightM: 10, authored: { width: 120, height: 120 } },
  layers: [
    withGround(kit.sprite({ id: 'sludge', asset: A.discNoise, z: 0, size: 130, alpha: 0.85, tint: '#a8d014', blend: 'add', duration: 3, rotationOverLife: C.spin(0.08), scaleOverLife: C.breathe(0.04) })),
    withGround(kit.sprite({ id: 'murk', asset: kit.AT.discB, z: 1, size: 84, alpha: 0.55, tint: '#26340a', blend: 'normal', duration: 3 })),
    withGround(kit.sprite({ id: 'rim', asset: A.ringSoft, z: 2, size: 128, alpha: 0.7, tint: '#e2ff5a', blend: 'add', duration: 3, alphaOverLife: [[0, 0.55], [0.5, 0.8], [1, 0.55]] })),
    withGround(kit.particle({ id: 'pops', asset: A.ringThin, z: 3, rate: 5, lifetime: [0.5, 0.9], spawnRadius: 44, speed: [0, 4], startPx: [14, 26], alpha: 0.9, tint: '#f0ff8a', blend: 'add', alphaOverLife: [[0, 0], [0.3, 1], [1, 0]], scaleOverLife: [[0, 0.4], [1, 1.3]] })),
    kit.particle({ id: 'bubbles', asset: A.dot, z: 4, rate: 9, lifetime: [0.8, 1.4], spawnRadius: 40, speed: [10, 24], direction: -90, spread: 30, startPx: [8, 16], alpha: 0.9, tint: '#dfff6a', blend: 'add', alphaOverLife: [[0, 0], [0.25, 1], [1, 0]] }),
    kit.particle({ id: 'fumes', asset: A.smokeSoft, z: 5, rate: 3, lifetime: [1, 1.8], spawnRadius: 34, speed: [6, 14], direction: -90, spread: 40, startPx: [40, 70], alpha: 0.35, tint: '#b4d040', blend: 'add', alphaOverLife: [[0, 0], [0.4, 0.6], [1, 0]] })
  ]
});

/* 火鏈：兩隻怪之間的一條橘紅火光鏈條（矩形場域，長度由模擬層的兩端點決定）。
   外層炙熱光暈＋白熱鏈芯＋沿線的火焰環（鏈環）與飄起的火星。 */
NEW['en-fire-chain'] = () => ({
  id: 'en-fire-chain', duration: 1.2, loop: true, sizing: rectSizing(200, 28),
  layers: [
    withGround(kit.sprite({ id: 'glow', asset: A.discB, z: 0, sizeX: 215, sizeY: 120, alpha: 0.6, tint: '#ff3a0a', blend: 'add', duration: 1.2, alphaOverLife: [[0, 0.5], [0.5, 0.72], [1, 0.5]] })),
    withGround(kit.sprite({ id: 'band2', asset: A.trace06H, z: 2, sizeX: 205, sizeY: 70, alpha: 0.95, tint: '#ff6a14', blend: 'add', duration: 1.2, alphaOverLife: [[0, 0.8], [0.5, 1], [1, 0.8]] })),
    withGround(kit.sprite({ id: 'core', asset: A.trace02H, z: 3, sizeX: 205, sizeY: 26, alpha: 1, tint: '#fff2c8', blend: 'add', duration: 1.2 })),
    withGround(kit.particle({ id: 'links', asset: A.ringThin, z: 4, rate: 9, lifetime: [0.5, 0.9], spawnBox: [190, 4], speed: [0, 6], startPx: [44, 56], alpha: 1, tint: '#ffc060', blend: 'add',
      alphaOverLife: [[0, 0], [0.2, 1], [0.8, 0.9], [1, 0]], rotationStart: [0, 360] })),
    kit.particle({ id: 'embers', asset: A.flame04, z: 5, rate: 30, lifetime: [0.35, 0.7], spawnBox: [190, 8], speed: [18, 46], direction: -90, spread: 40, startPx: [22, 38],
      alpha: 0.9, tint: '#ff5a1a', blend: 'add', alphaOverLife: [[0, 0], [0.2, 0.9], [1, 0]] }),
    kit.particle({ id: 'sparks', asset: A.star04, z: 6, rate: 16, lifetime: [0.25, 0.55], spawnBox: [190, 6], speed: [30, 80], direction: -90, spread: 70, startPx: [10, 18],
      alpha: 1, tint: '#fff2b0', blend: 'add', alphaOverLife: [[0, 1], [1, 0]] })
  ]
});

/* 秘法棒核心：地面上的紫粉色核心（預警與持續期間都在）。 */
NEW['en-arcane-core'] = () => ({
  id: 'en-arcane-core', duration: 1.6, loop: true, sizing: circleSizing(100),
  layers: [
    withGround(kit.sprite({ id: 'fill', asset: A.discB, z: 0, size: 200, alpha: 0.22, tint: '#c850ff', blend: 'add', duration: 1.6, scaleOverLife: C.breathe(0.06) })),
    withGround(kit.sprite({ id: 'rune', asset: A.runeMaze, z: 1, size: 170, alpha: 0.6, tint: '#ee7bff', blend: 'add', duration: 1.6, rotationOverLife: C.spin(0.25) })),
    withGround(kit.sprite({ id: 'ring', asset: A.ringThin, z: 2, size: 200, alpha: 0.85, tint: '#ff7ad8', blend: 'add', duration: 1.6, alphaOverLife: [[0, 0.7], [0.5, 1], [1, 0.7]] })),
    kit.sprite({ id: 'core', asset: A.glowSoft, z: 3, size: 70, alpha: 0.95, tint: '#ffd6ff', blend: 'add', duration: 1.6, scaleOverLife: C.breathe(0.12) }),
    kit.particle({ id: 'motes', asset: A.dot, z: 4, rate: 12, lifetime: [0.6, 1.1], spawnRadius: 60, speed: [10, 30], direction: -90, spread: 60, startPx: [6, 12], alpha: 0.9, tint: '#f3a6ff', blend: 'add', alphaOverLife: [[0, 0], [0.3, 1], [1, 0]] })
  ]
});

/* 旋轉光束：N 根從核心向外的白紫光束，順時針掃過 dur 秒（轉速 rot 度／秒與 JSON 一致）。
   光束用漸層光柱素材（cone_a：底端最亮、向上漸淡）以底端為軸心，旋轉 90 度讓它朝 +X 長出去。
   光束長度 authored 100px＝事件半徑（地板圓 r＝光束長度）。 */
function arcaneBeams(arms, dur, rot) {
  const id = 'en-arcane-beams-' + arms;
  const layers = [
    withGround(kit.sprite({ id: 'halo', asset: A.discB, z: 0, size: 44, alpha: 0.5, tint: '#c850ff', blend: 'add', duration: dur, scaleOverLife: C.breathe(0.1) })),
    kit.sprite({ id: 'hub', asset: A.glowSoft, z: 9, size: 26, alpha: 0.9, tint: '#ffd0ff', blend: 'add', duration: dur })
  ];
  const turn = rot * dur * D2R;
  for (let i = 0; i < arms; i++) {
    const base = i * 2 * Math.PI / arms + Math.PI / 2;      // +90°：把「向上」的光柱轉成「朝 +X」
    const spin = [[0, +base.toFixed(5)], [1, +(base + turn).toFixed(5)]];
    layers.push(withGround(kit.sprite({ id: 'beam' + i + '-glow', asset: A.barA, z: 1 + i * 3, anchor: { x: 0.5, y: 1 }, sizeX: 62, sizeY: 100, alpha: 0.7, tint: '#c850ff', blend: 'add', duration: dur, rotationOverLife: spin })));
    layers.push(withGround(kit.sprite({ id: 'beam' + i + '-body', asset: A.barA, z: 2 + i * 3, anchor: { x: 0.5, y: 1 }, sizeX: 34, sizeY: 100, alpha: 0.95, tint: '#e8b6ff', blend: 'add', duration: dur, rotationOverLife: spin })));
    layers.push(withGround(kit.sprite({ id: 'beam' + i + '-core', asset: A.barB, z: 3 + i * 3, anchor: { x: 0.5, y: 1 }, sizeX: 14, sizeY: 100, alpha: 1, tint: '#ffffff', blend: 'add', duration: dur, rotationOverLife: spin })));
  }
  return { id, duration: dur, loop: false, sizing: circleSizing(100), layers };
}
NEW['en-arcane-beams-1'] = () => arcaneBeams(1, 6, 50);

/* 熔岩核心預警：死亡怪物原地的核心膨脹倒數（3 秒），外圈＝爆炸範圍。 */
NEW['en-molten-core-warn'] = () => ({
  id: 'en-molten-core-warn', duration: 3, loop: false, sizing: circleSizing(100),
  layers: [
    withGround(kit.sprite({ id: 'edge', asset: A.ringThin, z: 0, size: 200, alpha: 0.9, tint: '#ff3a3a', blend: 'add', duration: 3, alphaOverLife: [[0, 0.5], [0.6, 0.9], [1, 1]] })),
    withGround(kit.sprite({ id: 'fill', asset: A.discB, z: 1, size: 200, alpha: 0.18, tint: '#ff4a2a', blend: 'add', duration: 3, alphaOverLife: [[0, 0.05], [1, 0.4]] })),
    withGround(kit.sprite({ id: 'grow', asset: A.ringSoft, z: 2, size: 200, alpha: 0.9, tint: '#ffb06a', blend: 'add', duration: 3, scaleOverLife: [[0, 0.1], [1, 1]], alphaOverLife: [[0, 0.2], [1, 0.9]] })),
    kit.sprite({ id: 'core', asset: A.lavaCells, z: 3, size: 70, alpha: 0.95, tint: '#ff6a2a', blend: 'add', duration: 3, scaleOverLife: [[0, 0.5], [0.7, 1.1], [1, 1.9]] }),
    kit.sprite({ id: 'hot', asset: A.glowSoft, z: 4, size: 90, alpha: 0.9, tint: '#fff0c0', blend: 'add', duration: 3, scaleOverLife: [[0, 0.3], [1, 1.6]], alphaOverLife: [[0, 0.3], [0.8, 0.9], [1, 1]] }),
    kit.particle({ id: 'embers', asset: A.dot, z: 5, rate: 20, lifetime: [0.5, 1], spawnRadius: 24, speed: [20, 60], direction: -90, spread: 90, startPx: [6, 12], alpha: 1, tint: '#ff8a3a', blend: 'add', alphaOverLife: [[0, 1], [1, 0]] })
  ]
});

/* 毒液圓點：毒素加持開始前地面先出現的綠色圓點。 */
NEW['en-poison-dot'] = () => ({
  id: 'en-poison-dot', duration: 0.9, loop: true, sizing: circleSizing(100),
  layers: [
    withGround(kit.sprite({ id: 'blob', asset: A.discB, z: 0, size: 90, alpha: 0.7, tint: '#8cff2a', blend: 'add', duration: 0.9, scaleOverLife: C.breathe(0.18) })),
    withGround(kit.sprite({ id: 'ring', asset: A.ringThin, z: 1, size: 130, alpha: 0.9, tint: '#c8ff6a', blend: 'add', duration: 0.9, scaleOverLife: [[0, 0.6], [1, 1.1]], alphaOverLife: [[0, 0.9], [1, 0]] })),
    kit.sprite({ id: 'glint', asset: A.star04, z: 2, size: 36, alpha: 0.9, tint: '#f4ffc8', blend: 'add', duration: 0.9, rotationOverLife: C.spin(0.5) })
  ]
});

/* 毒十字：4 條臂 × 4 顆毒水球，整體順時針旋轉並向外擴散（半徑倍率 0.7→1.5 隨時間線性）。
   模擬層用同一組公式判定：第 i 顆距離 (i+1)*gap*f(t)、角度 臂角＋rot*t、半徑 ballR*f(t)，f(t)=0.7+0.8*t/dur。 */
function poisonCross(dur, rot, balls) {
  const R0 = 100 / balls;                       // authored 100px 對應最外顆的初始半徑（f=1 時）
  const layers = [
    withGround(kit.sprite({ id: 'hub', asset: A.discB, z: 0, size: 60, alpha: 0.7, tint: '#8cff2a', blend: 'add', duration: dur, scaleOverLife: [[0, 0.7], [1, 1.5]] }))
  ];
  const turn = rot * dur * D2R;
  let z = 1;
  for (let arm = 0; arm < 4; arm++) {
    const base = arm * Math.PI / 2;
    const spin = [[0, +base.toFixed(5)], [1, +(base + turn).toFixed(5)]];
    // 軌道線（淡）
    layers.push(withGround(kit.sprite({ id: 'rail' + arm, asset: A.trace06H, z: z++, anchor: { x: 0, y: 0.5 }, sizeX: 100, sizeY: 8, alpha: 0.28, tint: '#7ee02a', blend: 'add', duration: dur, rotationOverLife: spin, scaleOverLife: [[0, 0.7], [1, 1.5]] })));
    for (let b = 0; b < balls; b++) {
      const dist = R0 * (b + 1);
      // 以錨點偏移讓圓球繞著中心轉：anchor.x = -(距離 / 球直徑)
      const d = 26;
      layers.push(withGround(kit.sprite({ id: 'ball' + arm + '-' + b, asset: A.bubble, z: z++, size: d, anchor: { x: -(dist / d) + 0.5, y: 0.5 }, alpha: 0.95, tint: '#9dff3a', blend: 'add',
        duration: dur, rotationOverLife: spin, scaleOverLife: [[0, 0.7], [1, 1.5]] })));
    }
  }
  return { id: 'en-poison-cross', duration: dur, loop: false, sizing: circleSizing(100), layers };
}
NEW['en-poison-cross'] = () => poisonCross(6, 22, 4);

/* 冰晶：地面生出的冰晶持續膨脹（2~3 秒），外圈＝炸裂範圍。 */
NEW['en-ice-crystal'] = () => {
  const layers = [
    withGround(kit.sprite({ id: 'edge', asset: A.ringThin, z: 0, size: 200, alpha: 0.85, tint: '#e6fffb', blend: 'add', duration: 2.5, alphaOverLife: [[0, 0.4], [1, 1]] })),
    withGround(kit.sprite({ id: 'frost', asset: A.discB, z: 1, size: 200, alpha: 0.2, tint: '#9ff5e8', blend: 'add', duration: 2.5, alphaOverLife: [[0, 0.05], [1, 0.4]] })),
    withGround(kit.sprite({ id: 'grow', asset: A.ringSoft, z: 2, size: 200, alpha: 0.85, tint: '#ffffff', blend: 'add', duration: 2.5, scaleOverLife: [[0, 0.15], [1, 1]] }))
  ];
  const pts = [[0, -8, 70, 10], [-34, 4, 56, -22], [34, 6, 56, 24], [-14, 22, 44, -10], [18, 24, 44, 14]];
  pts.forEach((p, i) => {
    layers.push(kit.sprite({ id: 'crystal' + i, asset: A.diamond, z: 3 + i, x: p[0], y: p[1], sizeX: p[2] * 0.6, sizeY: p[2], anchor: { x: 0.5, y: 0.9 }, rotDeg: p[3], alpha: 0.95, tint: '#d8fffa', blend: 'add',
      duration: 2.5, scaleOverLife: [[0, 0.1], [0.5, 0.6], [1, 1.15]], alphaOverLife: [[0, 0.3], [0.5, 0.9], [1, 1]] }));
  });
  layers.push(kit.sprite({ id: 'glint', asset: A.flare16, z: 9, size: 90, alpha: 0.7, tint: '#ffffff', blend: 'add', duration: 2.5, scaleOverLife: [[0, 0.3], [1, 1.2]], alphaOverLife: [[0, 0.1], [1, 0.9]] }));
  return { id: 'en-ice-crystal', duration: 2.5, loop: false, sizing: circleSizing(100), layers };
};

/* 冰球：持續追著玩家飄的旋轉冰球，帶白色冰霧。 */
NEW['en-ice-orb'] = () => ({
  id: 'en-ice-orb', duration: 2, loop: true, sizing: orbSizing(24),
  layers: [
    kit.sprite({ id: 'mist', asset: A.smokeSoft, z: 0, size: 100, alpha: 0.5, tint: '#d8fff8', blend: 'add', duration: 2, rotationOverLife: C.spin(-0.5), scaleOverLife: C.breathe(0.1) }),
    kit.sprite({ id: 'glow', asset: A.glowSoft, z: 1, size: 80, alpha: 0.8, tint: '#7ff0e0', blend: 'add', duration: 2 }),
    kit.sprite({ id: 'ball', asset: A.sphereRim, z: 2, size: 44, alpha: 0.95, tint: '#b8fff4', blend: 'add', duration: 2, rotationOverLife: C.spin(1) }),
    kit.sprite({ id: 'snow', asset: A.snowflake, z: 3, size: 50, alpha: 0.9, tint: '#ffffff', blend: 'add', duration: 2, rotationOverLife: C.spin(-1) }),
    kit.particle({ id: 'flakes', asset: A.star04, z: 4, rate: 14, lifetime: [0.5, 0.9], spawnRadius: 30, speed: [10, 30], direction: -90, spread: 180, startPx: [6, 12], alpha: 0.9, tint: '#ffffff', blend: 'add', alphaOverLife: [[0, 0], [0.3, 1], [1, 0]] })
  ]
});

/* 冰脈衝：以冰球為中心擴散的一圈冰冷脈衝。 */
NEW['en-ice-pulse'] = () => ({
  id: 'en-ice-pulse', duration: 0.7, loop: false, sizing: circleSizing(100),
  layers: [
    withGround(kit.sprite({ id: 'wave', asset: A.ringThin, z: 0, size: 200, alpha: 1, tint: '#d8fff8', blend: 'add', duration: 0.7, scaleOverLife: [[0, 0.1], [1, 1]], alphaOverLife: [[0, 1], [0.7, 0.8], [1, 0]] })),
    withGround(kit.sprite({ id: 'wave2', asset: A.ringSoft, z: 1, size: 200, alpha: 0.9, tint: '#9ff5e8', blend: 'add', duration: 0.7, scaleOverLife: [[0, 0.05], [1, 0.95]], alphaOverLife: [[0, 1], [1, 0]] })),
    withGround(kit.sprite({ id: 'fill', asset: A.discB, z: 2, size: 200, alpha: 0.4, tint: '#7ff0e0', blend: 'add', duration: 0.7, scaleOverLife: [[0, 0.2], [1, 1]], alphaOverLife: [[0, 0.7], [1, 0]] })),
    kit.particle({ id: 'frost', asset: A.star04, z: 3, burst: 24, lifetime: [0.4, 0.7], spawnRadius: 20, speed: [120, 240], direction: 0, spread: 360, startPx: [10, 20], alpha: 1, tint: '#ffffff', blend: 'add', alphaOverLife: [[0, 1], [1, 0]] })
  ]
});

/* 迫擊落點標記：紅色瞄準標記。 */
NEW['en-mortar-mark'] = () => ({
  id: 'en-mortar-mark', duration: 0.8, loop: true, sizing: circleSizing(100),
  layers: [
    withGround(kit.sprite({ id: 'fill', asset: A.discB, z: 0, size: 200, alpha: 0.2, tint: '#ff2a2a', blend: 'add', duration: 0.8, alphaOverLife: [[0, 0.15], [0.5, 0.3], [1, 0.15]] })),
    withGround(kit.sprite({ id: 'reticle', asset: A.reticleAoe, z: 1, size: 200, alpha: 0.9, tint: '#ff4a4a', blend: 'add', duration: 0.8, rotationOverLife: C.spin(0.25) })),
    withGround(kit.sprite({ id: 'pulse', asset: A.ringThin, z: 2, size: 200, alpha: 0.9, tint: '#ffb0b0', blend: 'add', duration: 0.8, scaleOverLife: [[0, 1.1], [1, 0.8]], alphaOverLife: [[0, 0.3], [1, 1]] }))
  ]
});

/* 築牆預警：牆體升起前的地面標記（矩形）：紫色警示帶＋虛線＋飛起的碎石。 */
NEW['en-wall-warn'] = () => ({
  id: 'en-wall-warn', duration: 0.8, loop: true, sizing: rectSizing(200, 28),
  layers: [
    withGround(kit.sprite({ id: 'fill', asset: A.discB, z: 0, sizeX: 215, sizeY: 130, alpha: 0.55, tint: '#9a6cff', blend: 'add', duration: 0.8, alphaOverLife: [[0, 0.4], [0.5, 0.7], [1, 0.4]] })),
    withGround(kit.sprite({ id: 'edge', asset: A.reticleDashed, z: 1, sizeX: 215, sizeY: 120, alpha: 0.9, tint: '#e0ccff', blend: 'add', duration: 0.8 })),
    withGround(kit.sprite({ id: 'line', asset: A.trace06H, z: 2, sizeX: 210, sizeY: 40, alpha: 1, tint: '#f2e8ff', blend: 'add', duration: 0.8 })),
    kit.particle({ id: 'dust', asset: A.dirt01, z: 3, rate: 22, lifetime: [0.4, 0.7], spawnBox: [190, 6], speed: [14, 40], direction: -90, spread: 60, startPx: [16, 26], alpha: 0.8, tint: '#cdbcf0', blend: 'add', alphaOverLife: [[0, 0], [0.3, 0.9], [1, 0]] })
  ]
});

/* 石牆：升起後持續存在的石砌高牆（矩形，長度與厚度由模擬層決定）：一排灰紫的岩塊，頂緣有淡淡的魔力光。 */
NEW['en-stone-wall'] = () => {
  const layers = [
    withGround(kit.sprite({ id: 'shadow', asset: A.discB, z: 0, sizeX: 220, sizeY: 110, alpha: 0.55, tint: '#1a1230', blend: 'add', duration: 1.2 })),
    withGround(kit.sprite({ id: 'base', asset: A.discB, z: 1, sizeX: 205, sizeY: 70, alpha: 0.55, tint: '#7a64a8', blend: 'add', duration: 1.2 }))
  ];
  const xs = [-92, -66, -40, -14, 14, 40, 66, 92];
  xs.forEach((x, i) => {
    layers.push(kit.sprite({ id: 'block' + i, asset: 'codex-authored/rockarmor-objects/plate.png', z: 2 + i, x: x, y: 8, sizeX: 74, sizeY: 104, anchor: { x: 0.5, y: 0.95 },
      rotDeg: (i % 3 - 1) * 4, alpha: 1, tint: i % 2 ? '#ddd0ff' : '#f2eaff', duration: 1.2 }));
  });
  layers.push(withGround(kit.sprite({ id: 'rim', asset: A.trace06H, z: 12, y: -2, sizeX: 210, sizeY: 30, alpha: 0.8, tint: '#e6d6ff', blend: 'add', duration: 1.2, alphaOverLife: [[0, 0.6], [0.5, 0.9], [1, 0.6]] })));
  layers.push(kit.particle({ id: 'dust', asset: A.dirt01, z: 20, rate: 8, lifetime: [0.5, 0.9], spawnBox: [190, 4], speed: [6, 16], direction: -90, spread: 50, startPx: [14, 22], alpha: 0.5, tint: '#c4b4e4', blend: 'add', alphaOverLife: [[0, 0], [0.3, 0.7], [1, 0]] }));
  return { id: 'en-stone-wall', duration: 1.2, loop: true, sizing: rectSizing(200, 28), layers };
};

/* 石牆升起瞬間的塵爆。 */
NEW['en-wall-rise'] = () => ({
  id: 'en-wall-rise', duration: 0.6, loop: false, sizing: circleSizing(100),
  layers: [
    withGround(kit.sprite({ id: 'ring', asset: A.ringThin, z: 0, size: 200, alpha: 0.8, tint: '#d8c8f0', blend: 'add', duration: 0.6, scaleOverLife: [[0, 0.3], [1, 1]], alphaOverLife: [[0, 0.8], [1, 0]] })),
    kit.particle({ id: 'dust', asset: A.dirt03, z: 1, burst: 16, lifetime: [0.4, 0.7], spawnRadius: 50, speed: [30, 90], direction: 0, spread: 360, startPx: [16, 30], alpha: 0.7, tint: '#b8a8d8', blend: 'add', alphaOverLife: [[0, 0.8], [1, 0]] })
  ]
});

/* 金色球形護盾：半透明金色能量光罩，持續 3 秒（一次播完，跟著怪物）。 */
/* 護盾是「罩在身上的球」：整份標 perspective:false（billboard 層），不受視角方向與 FOV 影響（靠畫面邊緣也不會被拉歪）。 */
const billboardAll = p => { p.layers.forEach(l => { l.perspective = false; }); return p; };
NEW['en-gold-dome'] = () => billboardAll({
  id: 'en-gold-dome', duration: 3, loop: false, sizing: customSizing(60, 60, 6, 6),
  layers: [
    kit.sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 120, alpha: 0.5, tint: '#ffcf3a', blend: 'add', duration: 3, alphaOverLife: [[0, 0], [0.08, 1], [0.9, 1], [1, 0]], scaleOverLife: C.breathe(0.05) }),
    kit.sprite({ id: 'shell', asset: A.sphereRim, z: 1, size: 96, alpha: 0.55, tint: '#ffe08a', blend: 'add', duration: 3, alphaOverLife: [[0, 0], [0.08, 1], [0.9, 1], [1, 0]], rotationOverLife: C.spin(0.4) }),
    kit.sprite({ id: 'rim', asset: A.ringThin, z: 2, size: 100, alpha: 0.85, tint: '#fff2b0', blend: 'add', duration: 3, alphaOverLife: [[0, 0], [0.08, 1], [0.9, 1], [1, 0]] }),
    kit.particle({ id: 'glints', asset: A.star04, z: 3, rate: 8, lifetime: [0.4, 0.8], spawnRadius: 40, speed: [4, 14], direction: -90, spread: 180, startPx: [6, 12], alpha: 1, tint: '#fff8d0', blend: 'add', alphaOverLife: [[0, 0], [0.4, 1], [1, 0]] })
  ]
});

/* 狀態光環（Status 表「持續特效」）：套在怪物腳下的一圈脈動光環，半徑由狀態實例的 vfxR（身體半徑）決定。
   狂暴＝血紅；怒意（嗜血、復仇、血祭的攻擊強化）＝橘金並向上冒火星。兩者顏色、動態都不同，一眼分得出是哪一種。 */
NEW['en-aura-enrage'] = () => ({
  id: 'en-aura-enrage', duration: 1.2, loop: true, sizing: circleSizing(100),
  layers: [
    withGround(kit.sprite({ id: 'fill', asset: A.discB, z: 0, size: 190, alpha: 0.2, tint: '#ff2a1a', blend: 'add', duration: 1.2, alphaOverLife: [[0, 0.12], [0.5, 0.26], [1, 0.12]] })),
    withGround(kit.sprite({ id: 'ring', asset: A.ringThin, z: 1, size: 200, alpha: 0.95, tint: '#ff3a2a', blend: 'add', duration: 1.2, alphaOverLife: [[0, 0.55], [0.5, 1], [1, 0.55]], scaleOverLife: C.breathe(0.06) })),
    withGround(kit.sprite({ id: 'ring-inner', asset: A.ringSoft, z: 2, size: 150, alpha: 0.6, tint: '#ff7a5a', blend: 'add', duration: 1.2, alphaOverLife: [[0, 0.3], [0.5, 0.7], [1, 0.3]] }))
  ]
});
NEW['en-aura-rage'] = () => ({
  id: 'en-aura-rage', duration: 1.6, loop: true, sizing: circleSizing(100),
  layers: [
    withGround(kit.sprite({ id: 'fill', asset: A.discB, z: 0, size: 170, alpha: 0.18, tint: '#ff9a2a', blend: 'add', duration: 1.6, alphaOverLife: [[0, 0.1], [0.5, 0.24], [1, 0.1]] })),
    withGround(kit.sprite({ id: 'ring', asset: A.ringThin, z: 1, size: 175, alpha: 0.9, tint: '#ffb03a', blend: 'add', duration: 1.6, rotationOverLife: C.spin(0.5), alphaOverLife: [[0, 0.6], [0.5, 1], [1, 0.6]] })),
    kit.particle({ id: 'embers', asset: A.dot, z: 3, rate: 14, lifetime: [0.5, 0.9], spawnRadius: 70, speed: [14, 34], direction: -90, spread: 30, startPx: [6, 12], alpha: 0.95, tint: '#ffd27a', blend: 'add', alphaOverLife: [[0, 0], [0.3, 1], [1, 0]] })
  ]
});

/* 狂暴爆發：復仇觸發時身上炸開的血紅氣浪。 */
NEW['en-rage-burst'] = () => ({
  id: 'en-rage-burst', duration: 0.9, loop: false, sizing: customSizing(60, 60, 6, 6),
  layers: [
    kit.sprite({ id: 'flash', asset: A.glowSoft, z: 0, size: 120, alpha: 0.9, tint: '#ff2a2a', blend: 'add', duration: 0.9, alphaOverLife: C.pop, scaleOverLife: [[0, 0.4], [1, 1.5]] }),
    kit.sprite({ id: 'ring', asset: A.impactRingOut, z: 1, size: 110, alpha: 0.9, tint: '#ff5a5a', blend: 'add', duration: 0.9, scaleOverLife: [[0, 0.3], [1, 1.2]], alphaOverLife: [[0, 1], [1, 0]] }),
    kit.particle({ id: 'aura', asset: A.flame04, z: 2, burst: 20, lifetime: [0.5, 0.9], spawnRadius: 16, speed: [30, 90], direction: -90, spread: 120, startPx: [20, 40], alpha: 0.85, tint: '#ff3030', blend: 'add', alphaOverLife: [[0, 0.9], [1, 0]] })
  ]
});

/* 召喚法陣：新生小怪腳下一閃而過的紫色法陣。 */
NEW['en-summon-circle'] = () => ({
  id: 'en-summon-circle', duration: 0.9, loop: false, sizing: circleSizing(100),
  layers: [
    withGround(kit.sprite({ id: 'rune', asset: A.runeNet, z: 0, size: 190, alpha: 0.85, tint: '#c07aff', blend: 'add', duration: 0.9, rotationOverLife: C.spin(0.3), alphaOverLife: C.fadeInOut, scaleOverLife: [[0, 0.6], [1, 1]] })),
    withGround(kit.sprite({ id: 'ring', asset: A.ringThin, z: 1, size: 200, alpha: 0.9, tint: '#e6b0ff', blend: 'add', duration: 0.9, alphaOverLife: C.fadeInOut })),
    kit.particle({ id: 'rise', asset: A.dot, z: 2, burst: 18, lifetime: [0.5, 0.9], spawnRadius: 60, speed: [30, 80], direction: -90, spread: 30, startPx: [6, 12], alpha: 1, tint: '#e6b0ff', blend: 'add', alphaOverLife: [[0, 1], [1, 0]] })
  ]
});

/* 飛彈：四種顏色（白藍紫黃）的祕法導彈，拖著光尾。朝 +X 飛。 */
function missile(color, head, tail) {
  const id = 'en-missile-' + color;
  return {
    id, duration: 1.2, loop: false, sizing: orbSizing(8),
    layers: [
      kit.sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 44, alpha: 0.9, tint: tail, blend: 'add', duration: 1.2, alphaOverLife: [[0, 0], [0.05, 1], [0.9, 1], [1, 0]] }),
      kit.sprite({ id: 'body', asset: A.flare16, z: 1, sizeX: 30, sizeY: 14, alpha: 1, tint: head, blend: 'add', duration: 1.2, alphaOverLife: [[0, 0], [0.05, 1], [0.9, 1], [1, 0]] }),
      kit.sprite({ id: 'core', asset: A.dot, z: 2, size: 12, alpha: 1, tint: '#ffffff', blend: 'add', duration: 1.2, alphaOverLife: [[0, 0], [0.05, 1], [0.9, 1], [1, 0]] }),
      kit.particle({ id: 'trail', asset: A.smokeAdd, z: 3, rate: 40, lifetime: [0.25, 0.45], spawnRadius: 2, speed: [4, 14], direction: 180, spread: 20, startPx: [12, 22], alpha: 0.7, tint: tail, blend: 'add', alphaOverLife: [[0, 0.7], [1, 0]], scaleOverLife: [[0, 1], [1, 0.3]] })
    ]
  };
}
NEW['en-missile-white'] = () => missile('white', '#ffffff', '#cfe4ff');
NEW['en-missile-blue'] = () => missile('blue', '#aee0ff', '#3a8cff');
NEW['en-missile-purple'] = () => missile('purple', '#f0c8ff', '#a64cff');
NEW['en-missile-yellow'] = () => missile('yellow', '#fff6b8', '#ffc42a');
NEW['en-missile-burst'] = () => ({
  id: 'en-missile-burst', duration: 0.45, loop: false, sizing: circleSizing(100),
  layers: [
    withGround(kit.sprite({ id: 'ring', asset: A.ringThin, z: 0, size: 200, alpha: 0.9, tint: '#e6f0ff', blend: 'add', duration: 0.45, scaleOverLife: [[0, 0.2], [1, 1]], alphaOverLife: [[0, 1], [1, 0]] })),
    kit.sprite({ id: 'flash', asset: A.star08, z: 1, size: 120, alpha: 1, tint: '#ffffff', blend: 'add', duration: 0.45, alphaOverLife: C.pop, scaleOverLife: [[0, 0.4], [1, 1.2]] }),
    kit.particle({ id: 'bits', asset: A.star04, z: 2, burst: 12, lifetime: [0.25, 0.45], spawnRadius: 8, speed: [80, 200], direction: 0, spread: 360, startPx: [8, 14], alpha: 1, tint: '#cfe4ff', blend: 'add', alphaOverLife: [[0, 1], [1, 0]] })
  ]
});

/* 電火花（帶電）：一條不規則的藍白色閃電絲，三股鋸齒電光各自快速閃爍、微微抖動，沒有圓形本體
   （和玩家的藍白電球、敵人的雷光球都是圓的，這個是線狀）。朝 +X 飛，細長形（custom 尺寸，不靠 bodyD）。 */
NEW['en-spark'] = () => {
  const D = 0.25;   // 變形（閃爍、抖動）的循環週期：0.5→0.25 秒，頻率 ×2
  const flick = (shift) => [[0, 1], [0.12, 0.2], [0.26, 1], [0.4, 0.3], [0.55, 0.95], [0.7, 0.15], [0.85, 1], [1, 1]]
    .map(([t, v], i, arr) => [+((t + shift) % 1).toFixed(3), v]).sort((x, y) => x[0] - y[0]);
  const jig = (amp, ph) => [[0, -amp], [0.2, amp * 0.8], [0.4, -amp * 0.6], [0.6, amp], [0.8, -amp * 0.9], [1, -amp]].map(([t, v]) => [t, +(v * ph).toFixed(3)]);
  return {
    id: 'en-spark', duration: D, loop: true, sizing: customSizing(56, 22, 4, 1.6),
    layers: [
      kit.sprite({ id: 'glow', asset: A.glowSoft, z: 0, sizeX: 78, sizeY: 20, alpha: 0.3, tint: '#3a8cff', blend: 'add', duration: D, alphaOverLife: [[0, 0.5], [0.3, 0.25], [0.6, 0.5], [1, 0.5]] }),
      kit.sprite({ id: 'fil-a', asset: A.bolt05H, z: 1, sizeX: 80, sizeY: 30, alpha: 1, tint: '#8fd0ff', blend: 'add', duration: D, alphaOverLife: flick(0), rotationOverLife: jig(0.2, 1) }),
      kit.sprite({ id: 'fil-b', asset: A.bolt06H, z: 2, sizeX: 70, sizeY: 26, alpha: 1, tint: '#d4eeff', blend: 'add', duration: D, alphaOverLife: flick(0.37), rotationOverLife: jig(0.22, -1) }),
      kit.sprite({ id: 'fil-c', asset: A.bolt05H, z: 3, sizeX: 62, sizeY: -22, alpha: 0.9, tint: '#5aa8ff', blend: 'add', duration: D, alphaOverLife: flick(0.71), rotationOverLife: jig(0.3, 1) }),
      kit.sprite({ id: 'core', asset: A.bolt05H, z: 4, sizeX: 76, sizeY: 8, alpha: 1, tint: '#ffffff', blend: 'add', duration: D, alphaOverLife: flick(0.2), rotationOverLife: jig(0.12, -1) }),
      kit.particle({ id: 'zap', asset: A.bolt04, z: 5, rate: 14, lifetime: [0.1, 0.22], spawnRadius: 10, speed: [30, 80], direction: 0, spread: 360, startPx: [12, 22], alpha: 1, tint: '#bfe4ff', blend: 'add', alphaOverLife: [[0, 1], [1, 0]] })
    ]
  };
};

module.exports = { THEMES, RECOLORS, NEW, recolor };

/* 使用者已在 VFX Editor 手調過的特效：重生會蓋掉他的修改，預設跳過（明確指定 id 並加 --force 才重生）。 */
const USER_EDITED = new Set(['en-gold-dome', 'en-vortex']);

if (require.main === module) {
  const force = process.argv.includes('--force');
  const only = new Set(process.argv.slice(2).filter(a => a !== '--force'));
  const made = [];
  RECOLORS.forEach(([newId, srcId, theme, tweak]) => {
    if (only.size && !only.has(newId)) return;
    if (USER_EDITED.has(newId) && !(force && only.has(newId))) return;
    made.push(recolor(srcId, newId, theme, tweak));
  });
  Object.keys(NEW).forEach(id => {
    if (only.size && !only.has(id)) return;
    if (USER_EDITED.has(id) && !(force && only.has(id))) return;
    made.push(kit.write(NEW[id]()));
  });
  console.log('敵人技能特效 ' + made.length + ' 份');
}
