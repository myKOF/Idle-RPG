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
const VFXLayoutSchema = require(REPO + '/tools/vfx/editor/layout-schema.js');
const INDEX = JSON.parse(fs.readFileSync(REPO + '/vfx/asset-index.json', 'utf8'));
const ASSETS = new Set(INDEX.assets.map(a => a.assetId));
const PRESET_DIR = REPO + '/vfx/presets';
const LAYOUT_DIR = REPO + '/vfx/layouts';

function assertAsset(id, where) {
  if (ASSETS.has(id)) return id;
  const base = id.split('/').pop();
  const near = INDEX.assets.map(a => a.assetId).filter(a => a.endsWith('/' + base)).slice(0, 8);
  throw new Error(where + ' 的 assetId 不存在：' + id + (near.length ? '\n  同檔名候選：\n    ' + near.join('\n    ') : ''));
}

/* 常用素材（都已確認存在於索引；製作時可直接用，也可以自己填 assetId） */
/* ---- 不透明素材 × 非加法混色 = 畫面上一個方塊 ----

   有幾個套件同時提供「黑底」與「透明」兩個版本的同一張圖。黑底版沒有
   alpha 通道，整個矩形都是不透明的；用加法混色時黑色加 0 等於看不見，
   所以用起來完全正常，因此這個地雷可以埋很久都不爆。
   一旦某一層改成 normal 或 multiply，畫面上就會出現一個實心方塊——
   而且方塊的顏色是 tint 過的，看起來不像「畫錯了」，
   比較像「這個特效本來就有一塊背景」，於是會往完全錯的方向查。

   （實際發生過：火殞石的 rim 層、地爆天星的 shadow 層、石化的 stone 層…
    一共 23 層，全都是同一個原因。）

   兩個版本的內容並不等價，不能無腦互換：黑底版的 RGB 已經是「乘完
   亮度」的結果（rgb 193、alpha 255），透明版則是原色配上亮度當 alpha
   （rgb 194、alpha 169）。加法混色下透明版會暗三成左右。
   所以這裡只擋錯誤用法，不自動替換——替換會悄悄改掉八十幾層的亮度。 */
const OPAQUE_ALPHA_TWIN = [
  ['particle-pack/png-black-background/', 'particle-pack/png-transparent/'],
  ['light-masks-1.0/default/', 'light-masks-1.0/transparent/'],
  ['light-masks-1.0/inverted/', 'light-masks-1.0/transparent/']
];
const OPAQUE_IDS = new Set(INDEX.assets
  .filter(a => a.facts && a.facts.pixelsAnalyzed &&
    (a.facts.hasAlphaChannel === false || (a.facts.alpha && a.facts.alpha.borderMean > 0.5)))
  .map(a => a.assetId));

/* 同一張圖的透明版 assetId；沒有對應版本時回 null。 */
function alphaTwin(id) {
  for (const pair of OPAQUE_ALPHA_TWIN) {
    if (id.startsWith(pair[0])) {
      const twin = pair[1] + id.slice(pair[0].length);
      if (ASSETS.has(twin)) return twin;
    }
  }
  return null;
}

function assertBlendable(id, blend, where) {
  if (blend === 'add' || blend === 'screen') return;
  if (!OPAQUE_IDS.has(id)) return;
  const twin = alphaTwin(id);
  throw new Error(where + ' 用了不透明素材配 blend="' + (blend || 'normal') +
    '"，畫面上會是一個實心方塊：\n  ' + id +
    (twin ? '\n  改用透明版：' + twin + '（加法亮度會不同，必要時調 alpha）'
          : '\n  這個素材沒有透明版；改成 blend:"add"，或換一張帶 alpha 的素材'));
}

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
  bolt04: 'particle-pack/png-black-background/spark_04.png',
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

/* A 的透明版對照表。同一個 key，指向同一張圖的帶 alpha 版本。

   為什麼要有這一份而不是直接在 A 裡改掉：加法混色的圖層用黑底版是正確的，
   而且比透明版亮三成（見 assertBlendable 上方的說明）。八十幾層加法圖層
   的亮度是調過的，整批換掉等於把它們全部調暗一次。
   所以兩份並存：加法用 A，normal／multiply 用 AT。

   自動生成而不是手寫，是為了不讓兩份清單有機會分歧——手寫的那一份
   遲早會漏掉某一個 key，而漏掉的症狀就是那個方塊又長回來。 */
const AT = {};
Object.keys(A).forEach(k => { const t = alphaTwin(A[k]); if (t) AT[k] = t; });

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

/* ---- 元素色階（tintOverLife 用） ----
   色票 T 給的是「這個元素長什麼顏色」，色階給的是「它隨時間怎麼變」。
   兩者分開，因為同一個元素在不同角色上的變化方式不同：
   火的核心要走「白熱 → 黃 → 紅 → 暗」，火的煙卻要走「暗紅 → 灰」。

   一律以白色（＝乘 1）當起點的那幾條，可以直接掛在原本就有 tint 的圖層上，
   不必改它的 tint——相乘語意下起點不變，只是後面開始變色。 */
const RAMP = {
  /* 白熱 → 黃 → 橙紅 → 燼。火焰、爆炸的核心與火星。 */
  fireCore: [[0, '#ffffff'], [0.18, '#ffe08a'], [0.45, '#ff7a2a'], [0.75, '#c02a12'], [1, '#3a1008']],
  /* 亮 → 暗紅 → 灰。爆炸後的煙。 */
  fireSmoke: [[0, '#ffffff'], [0.25, '#c8613a'], [0.6, '#6b5148'], [1, '#3a3a3c']],
  /* 白 → 藍白 → 深藍。閃電放電後的餘輝。 */
  lightning: [[0, '#ffffff'], [0.3, '#eaf4ff'], [0.7, '#8fc4ff'], [1, '#2a4a8a']],
  /* 白 → 冰藍 → 深藍。冰晶碎片。 */
  ice: [[0, '#ffffff'], [0.35, '#cfefff'], [0.75, '#5aa8e6'], [1, '#1e4d78']],
  /* 亮綠 → 深綠。毒與風的餘韻。 */
  poison: [[0, '#ffffff'], [0.4, '#b6f07a'], [0.8, '#4a8f24'], [1, '#1e3a10']],
  /* 白 → 元素色 → 透黑。通用的「亮起來再暗下去」，給不特別指定的元素用。 */
  fadeDark: [[0, '#ffffff'], [0.5, '#ffffff'], [1, '#2a2a30']]
};

/* ---- 序列幀圖集目錄 ----

   一張圖集要正確播放，需要三個數字：格線幾欄幾列、實際用了幾格、
   接回第一格會不會跳。三個都不能用看的——尤其是「用了幾格」：
   Effect_BigHit 是 6x5＝30 格但只畫了 12 格，照 30 格播的話後面
   18 格是全空的，動畫演完會憑空停頓 0.6 秒。

   底下的數字全部由 `node tools/vfx/sheet-facts.cjs` 量出來，
   素材換版時重跑一次即可對照。放在這裡而不是各家族腳本裡，是因為
   同一張圖集常常被兩三個 preset 用到，抄第二份就會有一份先過期。

   loop 欄位是量測給的判定：
     true  末格接回首格的差異與相鄰格相當 → 可以無縫循環（場域、光環）
     false 一次性動畫（無 → 有 → 無）     → 播一次就結束（受擊、爆炸）

   全部素材的內容都填滿格子（佔格 0.92～0.99），所以 preset 的 size
   直接就是想要的畫面尺寸，不需要再除以佔格比例。 */
const SHEET_DIR = 'spritemancer-vfx-256/30fps/';
function sheetDef(file, cols, rows, count, loop) {
  /* 每格尺寸寫在檔名結尾（..._256x125.png）。sheetLayer 要靠它把
     「螢幕上幾像素」換算成 scale——見下方那段註解。 */
  const m = /_(\d+)x(\d+)\.png$/i.exec(file);
  if (!m) throw new Error('圖集檔名沒有格尺寸：' + file);
  return {
    asset: SHEET_DIR + file, columns: cols, rows: rows, count: count, loop: loop,
    cellW: +m[1], cellH: +m[2]
  };
}
const SHEET = {
  /* --- 可無縫循環：場域、光環、持續狀態 --- */
  anima:       sheetDef('effect_anima_1_256x256.png', 6, 5, 30, true),   // 青色靈焰三舌上竄
  constellation: sheetDef('effect_constellation_1_245x256.png', 6, 5, 30, true), // 彩色星屑飄散
  ditheredFire: sheetDef('effect_ditheredfire_1_256x122.png', 6, 5, 30, true),   // 橫帶烈焰（火牆）
  eldenRing:   sheetDef('effect_eldenring_1_254x256.png', 6, 5, 30, true),       // 橙色火環，亮弧繞行
  electricShield: sheetDef('effect_electricshield_1_256x256.png', 6, 5, 30, true), // 藍色電環
  fastPixelFire: sheetDef('effect_fastpixelfire_1_173x193.png', 6, 5, 30, true), // 團狀火焰翻騰
  hyperspeed:  sheetDef('effect_hyperspeed_1_256x255.png', 6, 5, 30, true),      // 藍色水平速度線
  magma:       sheetDef('effect_magma_1_256x125.png', 6, 5, 30, true),           // 岩漿向上噴發（左右對稱）
  powerChords: sheetDef('effect_powerchords_1_256x175.png', 6, 5, 30, true),     // 由一點向上張開的光錐
  tentacles:   sheetDef('effect_tentacles_1_256x190.png', 6, 5, 30, true),       // 粉紅觸手上竄
  worm:        sheetDef('effect_worm_1_256x229.png', 6, 5, 30, true),            // 青白扭曲觸鬚

  /* --- 一次性：受擊、爆炸、爆發 --- */
  bigHit:      sheetDef('effect_bighit_1_256x254.png', 6, 5, 12, false),  // 黃色星芒 → 白閃（只有 12 格）
  bloodImpact: sheetDef('effect_bloodimpact_1_69x60.png', 6, 5, 25, false), // 血液噴濺
  charged:     sheetDef('effect_charged_1_221x256.png', 7, 6, 40, false), // 藍色放射電花（7x6 格）
  explosion:   sheetDef('effect_explosion_1_256x256.png', 6, 5, 27, false), // 黃橙爆炸＋日冕
  explosion2:  sheetDef('effect_explosion2_1_256x256.png', 6, 5, 27, false), // 橙白爆炸
  impact:      sheetDef('effect_impact_1_247x256.png', 6, 5, 15, false),  // 白色細星芒（線很細，200px 以下會消失）
  puffAndStars: sheetDef('effect_puffandstars_1_120x109.png', 7, 6, 30, false), // 橙星＋暗煙（暈眩）
  smallHit:    sheetDef('effect_smallhit_1_256x254.png', 6, 5, 15, false), // 小型星芒（同樣是細線）
  theVortex:   sheetDef('effect_thevortex_1_254x256.png', 6, 5, 25, false), // 紫→青漩渦球，脹縮一次
  wheel:       sheetDef('effect_wheel_1_256x256.png', 6, 5, 25, false)     // 綠色放射輪爆
  /* effect_kabooms 未收錄：內容是漫畫「KABOOM」字樣，不是特效。 */
};

const px = n => +(n / 512).toFixed(4);
const deg = d => +(d * Math.PI / 180).toFixed(4);
const num = (v, name) => { if (typeof v !== 'number' || !isFinite(v)) throw new Error(name + ' 必須是數字'); return v; };

/* ---- 圖層建構 ---- */
function common(o, out) {
  out.id = o.id;
  if (o.enabled === false) out.enabled = false;
  out.assetId = assertAsset(o.asset || o.assetId, 'layer ' + o.id);
  assertBlendable(out.assetId, o.blend, 'layer ' + o.id);
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
  ['alphaOverLife', 'tintOverLife', 'scaleOverLife', 'rotationOverLife'].forEach(k => { if (o[k] !== undefined) out[k] = o[k]; });
  return out;
}
function sprite(o) {
  const out = common(o, { type: 'sprite' });
  if (o.sheet !== undefined) out.sheet = o.sheet;
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
  ['speed', 'direction', 'spread', 'gravity', 'drag', 'radialSpeed', 'orbitalSpeed', 'noise',
    'subEmitter', 'sheet',
    'startScale', 'rotationStart', 'rotationSpeed', 'alignToVelocity', 'velocityRotationOffset']
    .forEach(k => { if (o[k] !== undefined) out[k] = o[k]; });
  /* 角速度以「圈／秒」給比較好想（技能表寫的就是「繞行 N 圈」），存檔仍是弧度／秒。 */
  if (o.orbitRps !== undefined) out.orbitalSpeed = +(o.orbitRps * Math.PI * 2).toFixed(4);
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
  const sizing = preset.sizing || require('./standardize-sizes.cjs').sizingFor(p.id);
  if (sizing) p.sizing = sizing;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(p.id) || p.id.length > 64) throw new Error('非法 preset id：' + p.id);
  if (p.layers.length > 32) throw new Error(p.id + ' 圖層超過 32');
  const seen = new Set();
  p.layers.forEach(l => { if (seen.has(l.id)) throw new Error(p.id + ' 圖層 id 重複：' + l.id); seen.add(l.id); });
  const res = VFXCore.validatePreset(p);
  if (!res.ok) throw new Error('preset ' + p.id + ' 不合法：\n  - ' + res.errors.join('\n  - '));
  const text = VFXCore.serialisePreset(p);
  fs.writeFileSync(path.join(PRESET_DIR, p.id + '.json'), text, 'utf8');
  writeRootGroupLayout(p);
  return p.id;
}

/* 單一根群組（使用者規則 2026-09-03）：每份 Preset 的所有圖層一律收進**一個**群組。
   理由是 Editor 之後要能同時開啟多份特效一起編輯——那時候「一列＝一個特效」才分得開，
   散落在根層級的圖層會混成一鍋。分組是 authoring metadata（vfx/layouts/<id>.json），
   不進 Preset、不進 Runtime，因此這條規則對畫面零影響（見 editor/layout-schema.js 檔頭）。
   群組 id／名稱一律取 preset id：多份特效同時打開時，列表上要一眼看出這一組是誰的。 */
function writeRootGroupLayout(p) {
  const layout = {
    schemaVersion: VFXLayoutSchema.SCHEMA_VERSION,
    presetId: p.id,
    groups: [{ id: p.id, name: p.id, layerIds: p.layers.map(l => l.id) }],
    order: ['group:' + p.id]
  };
  const res = VFXLayoutSchema.validateLayout(layout);
  if (!res.ok) throw new Error('layout ' + p.id + ' 不合法：\n  - ' + res.errors.join('\n  - '));
  if (!fs.existsSync(LAYOUT_DIR)) fs.mkdirSync(LAYOUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(LAYOUT_DIR, p.id + '.json'), VFXLayoutSchema.serialiseLayout(layout), 'utf8');
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

/* 一張序列幀圖層。把「圖集怎麼播」與「這一層長什麼樣」分開：
   def 來自上面的目錄（格線、格數、能不能循環），o 是這一次的用法。

   ⚠️ size 是**螢幕像素**，這一點與 sprite() 不同，而且非這樣不可。

   sprite() 的 px(n) = n/512：那個 512 是素材庫裡一般貼圖的邊長，
   所以對一張 512x512 的圖來說「size: 200」剛好就是畫面上 200px。
   序列幀不是這樣——貼圖是**一格**，Magma 的格子只有 256x125。
   同一句 size: 200 套到那張圖上會得到 256 x 200/512 = 100px 寬、
   125 x 200/512 = 49px 高，寬高各差一半，而且兩張格子尺寸不同的圖集
   寫同一個數字會得到不同大小。這種錯不會報錯，只會讓特效小一號，
   在畫面上很容易被當成「素材本來就這麼小」而去改別的地方。

   （已經寫好的三份 preset 正是踩了這個坑：原始碼寫 190，畫面上是 95。
    改用 sheetLayer 時數字一併改成實際的 95，行為不變、原始碼終於誠實。）

   mode 預設 'life'：整份序列攤在圖層生命上，所以 duration 就是播放速度旋鈕。
   要照素材原速（30fps）播，duration 設成 count/30。 */
function sheetLayer(def, o) {
  const over = Object.assign({}, o);
  delete over.mode;
  /* 螢幕像素 → sprite() 期待的「512 基準」尺寸。兩軸各自換算，
     因為非正方的格子（256x125）兩軸的比例本來就不同。 */
  const toBase = (v, cell) => v === undefined ? undefined : +(v * 512 / cell).toFixed(2);
  if (over.size !== undefined) {
    over.sizeX = toBase(over.size, def.cellW);
    over.sizeY = toBase(over.size * def.cellH / def.cellW, def.cellH);   // 等比
    delete over.size;
  } else {
    if (over.sizeX !== undefined) over.sizeX = toBase(over.sizeX, def.cellW);
    if (over.sizeY !== undefined) over.sizeY = toBase(over.sizeY, def.cellH);
  }
  return sprite(Object.assign({
    asset: def.asset,
    blend: 'normal',
    alpha: 1
  }, over, {
    sheet: {
      columns: def.columns, rows: def.rows, count: def.count,
      mode: o.mode || 'life',
      loop: def.loop
    }
  }));
}

module.exports = { A, AT, T, C, RAMP, SHEET, sheetLayer, alphaTwin, px, deg, sprite, particle, procedural, write, writeRootGroupLayout, probe, assertAsset, ASSETS, REPO };
