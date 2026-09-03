'use strict';
/* preset-kit.cjs — Preset 製作工具箱（製作階段用，位置 tools/vfx/authoring/；Runtime 與 Editor 不載入）
   用法（在任何 node 腳本裡）：
     const kit = require('./tools/vfx/authoring/preset-kit.cjs');
     kit.write({ id: 'hit-fire', duration: 0.4, layers: [ kit.sprite({...}), kit.particle({...}) ] });
   write() 會：
     1. 檢查每個 assetId 都存在於 vfx/asset-index.json（不存在直接拋錯，列出最接近的候選）
     2. 以 VFXCore.validatePreset 驗證（失敗拋錯）
     3. 以 VFXCore.serialisePreset 輸出 canonical 形式到 vfx/presets/<id>.json
   尺寸換算：所有素材 512×512；kit.px(n) = n/512 → 讓素材在畫面上約 n px。
   座標：+X 向右、+Y 向下；原點 (0,0) ＝ 特效錨點（受擊＝目標身體中心、地板＝圓心、
   狀態光環＝腳底、飛行物＝物體中心且朝 +X 飛、天降＝著地點）。 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..').replace(/\\/g, '/');
const VFXCore = require(REPO + '/js/vfx-core.js');
const INDEX = JSON.parse(fs.readFileSync(REPO + '/vfx/asset-index.json', 'utf8'));
const ASSETS = new Set(INDEX.assets.map(a => a.assetId));
const PRESET_DIR = REPO + '/vfx/presets';

function assertAsset(id, where) {
  if (ASSETS.has(id)) return id;
  const base = id.split('/').pop();
  const near = INDEX.assets.map(a => a.assetId).filter(a => a.endsWith('/' + base)).slice(0, 8);
  throw new Error(where + ' 的 assetId 不存在：' + id + (near.length ? '\n  同檔名候選：\n    ' + near.join('\n    ') : ''));
}

/* 常用素材（都已確認存在於索引；製作時可直接用，也可以自己填 assetId） */
const A = {
  // 光暈／圓盤（加法）
  glowSoft: 'particle-pack/png-black-background/light_03.png',
  glowRings: 'particle-pack/png-black-background/light_01.png',
  discA: 'light-masks-1.0/default/circle_a.png',
  discB: 'light-masks-1.0/default/circle_b.png',
  discNoise: 'light-masks-1.0/default/circle_a_noise.png',
  discStreaks: 'light-masks-1.0/default/circle_a_streaks.png',
  dot: 'particle-pack/png-black-background/circle_05.png',
  // 環
  ringA: 'light-masks-1.0/default/ring_a.png',
  ringB: 'light-masks-1.0/default/ring_b.png',
  ringC: 'light-masks-1.0/default/ring_c.png',
  ringThin: 'particle-pack/png-black-background/circle_02.png',
  ringSoft: 'particle-pack/png-black-background/circle_01.png',
  ringDouble: 'particle-pack/png-black-background/circle_03.png',
  rings3: 'light-masks-1.0/default/circle_rings_a.png',
  rings4: 'light-masks-1.0/default/circle_rings_c.png',
  impactRingIn: 'new_materials/impact-ring/impact_9.png',
  impactRingOut: 'new_materials/impact-ring/impact_14.png',
  impactRingLens: 'new_materials/impact-ring/impact_2.png',
  impactDonut: 'new_materials/impact-ring/impact_5.png',
  // 火焰／煙
  flame04: 'particle-pack/png-black-background/flame_04.png',
  flame01: 'particle-pack/png-black-background/flame_01.png',
  flame05: 'particle-pack/png-black-background/flame_05.png',
  flame05R: 'particle-pack/png-black-background/rotated/flame_05_rotated.png',
  fire01: 'particle-pack/png-black-background/fire_01.png',
  fire02: 'particle-pack/png-black-background/fire_02.png',
  muzzle02: 'particle-pack/png-black-background/muzzle_02.png',
  muzzle02R: 'particle-pack/png-black-background/rotated/muzzle_02_rotated.png',
  muzzle03: 'particle-pack/png-black-background/muzzle_03.png',
  smokeT: 'particle-pack/png-transparent/smoke_04.png',
  smokeAdd: 'particle-pack/png-black-background/smoke_04.png',
  smokeCumulus: 'new_materials/smoke/smoke_13.png',
  smokeSoft: 'new_materials/smoke/smoke3_11.png',
  smokeDark: 'new_materials/smoke/smoke2_1.png',
  smokeDarkCore: 'new_materials/smoke/smoke2_16.png',
  smokeRing: 'new_materials/smoke/smoke_4.png',
  explosionColored: 'smoke-particles/png/explosion/explosion04.png',
  fireWallColored: 'new_materials/fire/fire_28.png',
  fireColumnColored: 'new_materials/fire/fire_31.png',
  // 火花／星芒
  star08: 'particle-pack/png-black-background/star_08.png',
  star02: 'particle-pack/png-black-background/star_02.png',
  star06: 'particle-pack/png-black-background/star_06.png',
  star04: 'particle-pack/png-black-background/star_04.png',
  star05: 'particle-pack/png-black-background/star_05.png',
  star09: 'particle-pack/png-black-background/star_09.png',
  star03: 'particle-pack/png-black-background/star_03.png',
  flash: 'particle-pack/png-black-background/scorch_02.png',
  flashSparse: 'particle-pack/png-black-background/scorch_01.png',
  flare16: 'new_materials/flare/flare_16.png',
  flare30: 'new_materials/flare/flare_30.png',
  flare28: 'new_materials/flare/flare_28.png',
  flare25: 'new_materials/flare/flare_25.png',
  flare03: 'new_materials/flare/flare_3.png',
  flare01: 'particle-pack/png-black-background/flare_01.png',
  // 電
  bolt05: 'particle-pack/png-black-background/spark_05.png',
  bolt06: 'particle-pack/png-black-background/spark_06.png',
  bolt07H: 'particle-pack/png-black-background/spark_07.png',
  bolt06H: 'particle-pack/png-black-background/rotated/spark_06_rotated.png',
  bolt05H: 'particle-pack/png-black-background/rotated/spark_05_rotated.png',
  arc01: 'particle-pack/png-black-background/spark_01.png',
  arc02: 'particle-pack/png-black-background/spark_02.png',
  arc03: 'particle-pack/png-black-background/spark_03.png',
  arc04: 'particle-pack/png-black-background/spark_04.png',
  plasmaBlue: 'new_materials/plasma/magic_particles_2.png',
  plasmaCyan: 'new_materials/plasma/magic_particles_14.png',
  // 條紋／拖尾／斬擊
  trace02: 'particle-pack/png-black-background/trace_02.png',
  trace02H: 'particle-pack/png-black-background/rotated/trace_02_rotated.png',
  trace03: 'particle-pack/png-black-background/trace_03.png',
  trace04: 'particle-pack/png-black-background/trace_04.png',
  trace05: 'particle-pack/png-black-background/trace_05.png',
  trace06: 'particle-pack/png-black-background/trace_06.png',
  trace06H: 'particle-pack/png-black-background/rotated/trace_06_rotated.png',
  trace07: 'particle-pack/png-black-background/trace_07.png',
  slash01: 'particle-pack/png-black-background/slash_01.png',
  slash02: 'particle-pack/png-black-background/slash_02.png',
  slash03: 'particle-pack/png-black-background/slash_03.png',
  slash04: 'particle-pack/png-black-background/slash_04.png',
  scratch: 'particle-pack/png-black-background/scratch_01.png',
  twirl01: 'particle-pack/png-black-background/twirl_01.png',
  twirl02: 'particle-pack/png-black-background/twirl_02.png',
  twirl03: 'particle-pack/png-black-background/twirl_03.png',
  lines1: 'new_materials/streak/lines_1.png',
  lines2: 'new_materials/streak/lines_2.png',
  lines4: 'new_materials/streak/lines_4.png',
  lines9: 'new_materials/streak/lines_9.png',
  // 錐／柱／光束
  coneNoise: 'light-masks-1.0/default/cone_composed_c_noise.png',
  coneC: 'light-masks-1.0/default/cone_composed_c.png',
  coneF: 'light-masks-1.0/default/cone_composed_f.png',
  barA: 'light-masks-1.0/default/cone_a.png',
  barB: 'light-masks-1.0/default/cone_b.png',
  beamB: 'light-masks-1.0/default/streaks_composed_b.png',
  beamF: 'light-masks-1.0/default/streaks_composed_f.png',
  beamD: 'light-masks-1.0/default/streaks_composed_d.png',
  rays7: 'new_materials/beam/lightrays_7.png',
  rays8: 'new_materials/beam/lightrays_8.png',
  muzzleFlash5: 'new_materials/muzzle-flash/muzzle_flash_5.png',
  // 形狀遮罩（透明載體、白色剪影，可染色）
  triangleDown: 'new_materials/mask-shape/dingbats-370.png',
  diamond: 'new_materials/mask-shape/dingbats-366.png',
  sparkle4: 'new_materials/mask-shape/dingbats-489.png',
  snowflake: 'new_materials/mask-shape/dingbats-459.png',
  snowflakeBold: 'new_materials/mask-shape/dingbats-460.png',
  asterisk8: 'new_materials/mask-shape/dingbats-480.png',
  crescentMoon: 'new_materials/mask-shape/dingbats-481.png',
  dart: 'new_materials/mask-shape/dingbats-389.png',
  triangleLeft: 'new_materials/mask-shape/dingbats-283.png',
  crossX: 'new_materials/mask-shape/dingbats-278.png',
  triangleUp: 'new_materials/mask-shape/dingbats-280.png',
  triangleDn: 'new_materials/mask-shape/dingbats-281.png',
  heart: 'particle-pack/png-black-background/symbol_01.png',
  starSym: 'particle-pack/png-black-background/symbol_02.png',
  cross: 'new_materials/mask-shape/dingbats-482.png',
  biohazard: 'new_materials/mask-shape/dingbats-115.png',
  leaf: 'new_materials/mask-shape/dingbats-493.png',
  sunDisc: 'new_materials/mask-shape/dingbats-376.png',
  // 魔法陣／符文環
  runeMaze: 'new_materials/arcane-ring/dingbats-2.png',
  runeNet: 'new_materials/arcane-ring/dingbats-22.png',
  runePlanet: 'new_materials/arcane-ring/dingbats-25.png',
  runeTarget: 'new_materials/arcane-ring/dingbats-100.png',
  runeSpiky: 'new_materials/arcane-ring/spiral_6.png',
  runeTech: 'new_materials/arcane-ring/spiral_35.png',
  runeTicks: 'new_materials/arcane-ring/spiral_37.png',
  rings7: 'new_materials/arcane-ring/spiral_21.png',
  ringsWavy: 'new_materials/arcane-ring/spiral_17.png',
  ringBold: 'new_materials/arcane-ring/dingbats-384.png',
  spiroHex: 'new_materials/spiro/spirowires_1.png',
  magicPenta: 'particle-pack/png-black-background/magic_01.png',
  magicOcta: 'particle-pack/png-black-background/magic_02.png',
  magicCompass: 'particle-pack/png-black-background/magic_03.png',
  magicCross: 'particle-pack/png-black-background/magic_04.png',
  sawRing: 'new_materials/arcane-ring/spiral_26.png',
  sawSmall: 'new_materials/arcane-ring/spiral_25.png',
  clawSwirl: 'new_materials/arcane-ring/spiral_28.png',
  tendrilSpiral: 'new_materials/arcane-ring/spiral_5.png',
  triskelion: 'new_materials/arcane-ring/spiral_2.png',
  // 風／扇
  turbine7: 'new_materials/fan/turbine_1.png',
  turbine14: 'new_materials/fan/turbine_4.png',
  needles16: 'new_materials/fan/turbine_6.png',
  propeller3: 'new_materials/fan/turbine_9.png',
  swirl3: 'new_materials/orb/spiky_4.png',
  windEmblem: 'new_materials/arcane-ring/dingbats-78.png',
  fanA: 'light-masks-1.0/default/fan_a.png',
  // 球體／泡泡／岩石
  bubble: 'new_materials/orb/sphere_28.png',
  bubbleSoap: 'new_materials/orb/sphere_38.png',
  sphereRim: 'new_materials/orb/sphere_41.png',
  sphereMatte: 'new_materials/orb/sphere_1.png',
  rockChrome: 'new_materials/orb/sphere_22.png',
  rockDark: 'new_materials/orb/sphere_23.png',
  rockCracked: 'new_materials/orb/sphere_29.png',
  orbDark: 'new_materials/orb/sphere_35.png',
  orbObsidian: 'new_materials/orb/sphere_47.png',
  dirt01: 'particle-pack/png-black-background/dirt_01.png',
  dirt03: 'particle-pack/png-black-background/dirt_03.png',
  lavaCells: 'new_materials/plasma/magic_particles_5.png',
  // 潑濺／地面
  splat05: 'splat-pack/png/double-512px/splat05.png',
  splat25: 'splat-pack/png/double-512px/splat25.png',
  splat12: 'splat-pack/png/double-512px/splat12.png',
  splat20: 'splat-pack/png/double-512px/splat20.png',
  spatter: 'new_materials/splat/dingbats-392.png',
  spatterCenter: 'new_materials/splat/dingbats-425.png',
  spatterMist: 'new_materials/splat/dingbats-422.png',
  caustics: 'light-masks-1.0/default/water_caustics_a.png',
  causticsThin: 'light-masks-1.0/default/water_caustics_b.png',
  // 準星／預警
  reticleRing: 'new_materials/hud-reticle/target_1.png',
  reticleDashed: 'new_materials/hud-reticle/target_11.png',
  reticleTicks: 'new_materials/hud-reticle/target_2.png',
  reticleHex: 'new_materials/hud-reticle/target_9.png',
  reticleSegments: 'new_materials/hud-reticle/target_3.png',
  reticleAoe: 'new_materials/hud-reticle/target_21.png',
  ringSegments4: 'new_materials/orb/rounded_6.png',
  discWhite: 'light-masks-1.0/default/window_h.png',
  discWhiteBlur: 'light-masks-1.0/default/window_h_blur.png',
  // 其他
  softStar4: 'light-masks-1.0/default/shape_g.png',
  softBlob: 'light-masks-1.0/default/shape_a.png',
  raysDisc: 'new_materials/orb/rounded_8.png',
  pinwheel8: 'new_materials/orb/spiky_1.png',
  sawRing16: 'new_materials/orb/spiky_11.png',
  serratedRing: 'new_materials/orb/spiky_6.png'
};
Object.keys(A).forEach(k => { if (!ASSETS.has(A[k])) throw new Error('kit.A.' + k + ' 指向不存在的 assetId：' + A[k]); });

/* 色票 */
const T = {
  light: { c1: '#ffe47a', c2: '#fffef4', glow: '#fff3a3' },
  dark: { c1: '#6f2da8', c2: '#1a0c2e', glow: '#913dcc', bright: '#c084fc' },
  fire: { c1: '#e63924', c2: '#ffd447', glow: '#ff6a2a' },
  ice: { c1: '#4da6ff', c2: '#f2fbff', glow: '#79d8ff' },
  lightning: { c1: '#f2b705', c2: '#fff8b0', glow: '#ffd23f' },
  earth: { c1: '#ad7444', c2: '#5b3a27', glow: '#c48a55' },
  poison: { c1: '#4caf2b', c2: '#d8ff8a', glow: '#76d83b' },
  wind: { c1: '#86efac', c2: '#ffffff', glow: '#b9f6cf' },
  phys: { c1: '#e6ddc8', c2: '#ffffff', glow: '#f5ecd6' },
  magic: { c1: '#8ea2ff', c2: '#e6ecff', glow: '#a9b8ff' },
  bleed: { c1: '#d92846', c2: '#ffd0d8', glow: '#ff4962' },
  purple: { c1: '#c084fc', c2: '#fdf4ff', glow: '#9333ea' },
  water: { c1: '#38bdf8', c2: '#f0f9ff', glow: '#0284c7' },
  enemy: { c1: '#ff6b6b', c2: '#ffd0d0', glow: '#ff3b3b' },
  blueThunder: { c1: '#7dd3fc', c2: '#ffffff', glow: '#2563eb' }
};

const px = n => +(n / 512).toFixed(4);
const deg = d => +(d * Math.PI / 180).toFixed(4);
const num = (v, name) => { if (typeof v !== 'number' || !isFinite(v)) throw new Error(name + ' 必須是數字'); return v; };

/* ---- 圖層建構 ---- */
function common(o, out) {
  out.id = o.id;
  if (o.enabled === false) out.enabled = false;
  out.assetId = assertAsset(o.asset || o.assetId, 'layer ' + o.id);
  if (o.z !== undefined) out.zIndex = o.z;
  if (o.x !== undefined || o.y !== undefined) out.position = { x: o.x || 0, y: o.y || 0 };
  if (o.rotation !== undefined) out.rotation = o.rotation;
  if (o.rotDeg !== undefined) out.rotation = deg(o.rotDeg);
  if (o.scale !== undefined) out.scale = typeof o.scale === 'number' ? { x: o.scale, y: o.scale } : o.scale;
  if (o.sx !== undefined || o.sy !== undefined) out.scale = { x: o.sx === undefined ? 1 : o.sx, y: o.sy === undefined ? 1 : o.sy };
  if (o.size !== undefined) out.scale = { x: px(o.size), y: px(o.size) };           // 以像素給尺寸
  if (o.sizeX !== undefined || o.sizeY !== undefined) out.scale = { x: px(o.sizeX === undefined ? o.sizeY : o.sizeX), y: px(o.sizeY === undefined ? o.sizeX : o.sizeY) };
  if (o.anchor !== undefined) out.anchor = typeof o.anchor === 'number' ? { x: o.anchor, y: o.anchor } : o.anchor;
  if (o.alpha !== undefined) out.alpha = o.alpha;
  if (o.tint !== undefined) out.tint = o.tint;
  if (o.blend !== undefined) out.blendMode = o.blend;
  if (o.delay !== undefined) out.delay = o.delay;
  if (o.duration !== undefined) out.duration = o.duration;
  ['alphaOverLife', 'scaleOverLife', 'rotationOverLife'].forEach(k => { if (o[k] !== undefined) out[k] = o[k]; });
  return out;
}
function sprite(o) {
  const out = common(o, { type: 'sprite' });
  ['scaleXOverLife', 'scaleYOverLife', 'rotationXOverLife', 'rotationYOverLife'].forEach(k => { if (o[k] !== undefined) out[k] = o[k]; });
  return out;
}
function particle(o) {
  const out = common(o, { type: 'particle' });
  if (o.burst !== undefined) out.emission = { mode: 'burst', count: o.burst };
  else if (o.rate !== undefined) out.emission = { mode: 'rate', rate: o.rate };
  else if (o.emission) out.emission = o.emission;
  else throw new Error('particle ' + o.id + ' 需要 burst 或 rate');
  if (o.maxParticles !== undefined) out.maxParticles = o.maxParticles;
  if (o.lifetime === undefined) throw new Error('particle ' + o.id + ' 需要 lifetime');
  out.lifetime = o.lifetime;
  if (o.spawnRadius !== undefined) out.spawn = { shape: 'circle', radius: o.spawnRadius };
  else if (o.spawnBox !== undefined) out.spawn = { shape: 'box', width: o.spawnBox[0], height: o.spawnBox[1] };
  else if (o.spawn) out.spawn = o.spawn;
  ['speed', 'direction', 'spread', 'gravity', 'startScale', 'rotationStart', 'rotationSpeed', 'alignToVelocity', 'velocityRotationOffset'].forEach(k => { if (o[k] !== undefined) out[k] = o[k]; });
  if (o.startPx !== undefined) out.startScale = Array.isArray(o.startPx) ? [px(o.startPx[0]), px(o.startPx[1])] : px(o.startPx); // 粒子尺寸以像素給
  return out;
}
function procedural(o) {
  const out = common(o, { type: 'procedural' });
  out.effect = o.effect || 'uvScroll';
  if (o.sizePx) out.size = { x: o.sizePx[0], y: o.sizePx[1] };
  if (o.scrollSpeed) out.scrollSpeed = o.scrollSpeed;
  ['scaleXOverLife', 'scaleYOverLife', 'rotationXOverLife', 'rotationYOverLife'].forEach(k => { if (o[k] !== undefined) out[k] = o[k]; });
  return out;
}

/* ---- 常用曲線 ---- */
const C = {
  fadeOut: [[0, 1], [1, 0]],
  fadeInOut: [[0, 0], [0.15, 1], [0.7, 0.9], [1, 0]],
  flash: [[0, 0], [0.1, 1], [0.45, 0.6], [1, 0]],
  pop: [[0, 0], [0.05, 1], [0.25, 0.7], [1, 0]],
  grow: (a, b) => [[0, a], [1, b]],
  growEase: (a, b) => [[0, a], [0.35, a + (b - a) * 0.7], [1, b]],
  breathe: (amp) => [[0, 1 - amp], [0.5, 1 + amp], [1, 1 - amp]],
  spin: (turns) => [[0, 0], [1, +(Math.PI * 2 * turns).toFixed(5)]],
  flicker: [[0, 1], [0.1, 1.25], [0.2, 0.8], [0.3, 1.2], [0.4, 0.85], [0.5, 1.15], [0.6, 0.8], [0.7, 1.2], [0.8, 0.9], [0.9, 1.1], [1, 1]],
  holdFade: (holdUntil) => [[0, 1], [holdUntil, 1], [1, 0]]
};

function write(preset) {
  const p = { schemaVersion: 1, id: preset.id, duration: preset.duration, loop: !!preset.loop, layers: preset.layers };
  if (!/^[a-z0-9][a-z0-9-]*$/.test(p.id) || p.id.length > 64) throw new Error('非法 preset id：' + p.id);
  if (p.layers.length > 32) throw new Error(p.id + ' 圖層超過 32');
  const seen = new Set();
  p.layers.forEach(l => { if (seen.has(l.id)) throw new Error(p.id + ' 圖層 id 重複：' + l.id); seen.add(l.id); });
  const res = VFXCore.validatePreset(p);
  if (!res.ok) throw new Error('preset ' + p.id + ' 不合法：\n  - ' + res.errors.join('\n  - '));
  const text = VFXCore.serialisePreset(p);
  fs.writeFileSync(path.join(PRESET_DIR, p.id + '.json'), text, 'utf8');
  return p.id;
}

/* 粗略檢查：用 NullBackend 模擬，回報每一幀最大的節點數與位置範圍，方便核對名目尺寸 */
function probe(id, opts) {
  const preset = JSON.parse(fs.readFileSync(path.join(PRESET_DIR, id + '.json'), 'utf8'));
  const backend = VFXCore.createNullBackend();
  const resolver = VFXCore.createIndexResolver(INDEX, '/x');
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxNodes = 0, frames = 0;
  const rt = VFXCore.createRuntime({ backend: {
    createNode: backend.createNode,
    updateNode: function (n, t) {
      if (!t || t.visible === false) return;
      const w = 512 * Math.abs(t.scaleX) / 2, h = 512 * Math.abs(t.scaleY) / 2;
      minX = Math.min(minX, t.x - w); maxX = Math.max(maxX, t.x + w);
      minY = Math.min(minY, t.y - h); maxY = Math.max(maxY, t.y + h);
    },
    destroyNode: backend.destroyNode
  }, resolver, budget: { maxActiveEffects: 4, maxParticles: 4000, perEffectParticleLimit: 2000 } });
  rt.registerPreset(preset);
  rt.play(preset.id, (opts && opts.params) || {});
  const total = Math.min(60, preset.duration * ((opts && opts.loops) || 1) + 1.5);
  for (let t = 0; t < total; t += 1 / 60) { rt.update(1 / 60); frames++; const s = rt.stats(); maxNodes = Math.max(maxNodes, s.activeParticles); }
  return { id: id, layers: preset.layers.length, bbox: { x: [Math.round(minX), Math.round(maxX)], y: [Math.round(minY), Math.round(maxY)] }, maxParticles: maxNodes, duration: preset.duration, loop: preset.loop };
}

module.exports = { A, T, C, px, deg, sprite, particle, procedural, write, probe, assertAsset, ASSETS, REPO };
