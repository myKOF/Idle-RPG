'use strict';
/* slashes.cjs — 斬擊本體家族（slash-*）Preset 製作腳本
   角色：attack（攻擊本體）。原點＝斬擊的圓心／扇形頂點；+X＝面向。
   共用結構：主弧（粗、飽和、低 z）→ 內弧（細、偏白、高 z）→ 少量火花。
   名目尺寸見 vfx-catalog.cjs；Runtime 依 rangeScale／lineLength 再縮放。

   ⚠️ 扇形（sector）沒有程序化圖元可用（Core 的 procedural 只有 uvScroll），
   因此以 cone_composed_* 的 V 形錐體逼近：頂點在原點、以 scaleX 撐開張角。
   角度是「看起來像」而不是幾何精確——真正的判定範圍在模擬層，這裡只負責畫面。 */
const kit = require('../preset-kit.cjs');
const { A, AT, T, C, RAMP, deg, sprite, particle } = kit;
const PI = Math.PI;

/* ---- 共用曲線 ---- */
const ARC_A = [[0, 0], [0.12, 1], [0.62, 0.85], [1, 0]];
const ARC_S = [[0, 0.82], [0.35, 1], [1, 1.06]];
const INNER_A = [[0, 0], [0.1, 1], [0.5, 0.7], [1, 0]];
const SPARK_A = [[0, 1], [0.55, 0.9], [1, 0]];
const SPARK_S = [[0, 1], [1, 0.45]];
const SECTOR_S = [[0, 0.08], [0.55, 0.95], [1, 0.95]];   // 8% → 95% 半徑
const SECTOR_A = [[0, 0], [0.12, 1], [0.7, 0.85], [1, 0]];
/* 45°／秒 × duration：扇形整體慢慢轉，讓「掃過去」有方向感 */
const sweepDegPerSec = (sec) => [[0, 0], [1, deg(45 * sec)]];

/* ---- 主弧＋內弧：一道斬擊的骨架 ----
   base＝弧的靜止傾角；swing＝生命期內再掃過的角度（度）。 */
function arc(o) {
  const R = o.R, base = o.base === undefined ? -45 : o.base;
  const swing = o.swing === undefined ? 25 : o.swing;
  const dur = o.dur || 0.24;
  return [
    sprite({
      id: o.id || 'arc', asset: o.asset || A.slash02, z: o.z === undefined ? 1 : o.z,
      size: R * 2, alpha: o.alpha === undefined ? 0.95 : o.alpha, tint: o.tint, blend: 'add',
      rotDeg: base, delay: o.delay || 0, duration: dur,
      alphaOverLife: ARC_A, scaleOverLife: ARC_S,
      rotationOverLife: [[0, deg(-swing)], [1, deg(swing)]]
    }),
    sprite({
      id: (o.id || 'arc') + '-inner', asset: o.innerAsset || A.slash01, z: (o.z === undefined ? 1 : o.z) + 1,
      size: R * 2 * (o.innerRatio || 0.82), alpha: 1, tint: o.innerTint || '#ffffff', blend: 'add',
      rotDeg: base, delay: (o.delay || 0) + 0.02, duration: dur * 0.75,
      alphaOverLife: INNER_A, scaleOverLife: [[0, 0.9], [1, 1.08]],
      rotationOverLife: [[0, deg(-swing)], [1, deg(swing)]]
    })
  ];
}

/* ---- 火花：沿斬擊方向甩出去 ---- */
function chips(o) {
  return particle(Object.assign({
    id: 'chips', asset: A.dot, z: 6, blend: 'add',
    burst: 5, lifetime: [0.16, 0.26], spawnRadius: 10,
    speed: [110, 190], direction: 35, spread: 110, gravity: { x: 0, y: 260 },
    /* 削下來的碎屑：與受擊火花同一個道理，噴出去之後會被空氣拖慢。
       壽命只有 0.2 秒左右，drag 給大一點才看得出來。 */
    drag: 4, tintOverLife: RAMP.fadeDark,
    startPx: [4, 7], alphaOverLife: SPARK_A, scaleOverLife: SPARK_S
  }, o));
}

const P = {};

/* ---------- slash-phys：單道暖白斬弧（左上 → 右下） ---------- */
P['slash-phys'] = () => ({
  id: 'slash-phys', duration: 0.3, layers: [
    ...arc({ R: 36, tint: T.phys.c1, base: -45, swing: 25 }),
    chips({ tint: T.phys.c2 })
  ]
});

/* ---------- slash-phys-big：普攻劍氣／疾風亂舞用的大型斬弧 ---------- */
P['slash-phys-big'] = () => ({
  id: 'slash-phys-big', duration: 0.3, layers: [
    ...arc({ R: 54, tint: T.phys.c1, base: -45, swing: 28, alpha: 1 }),
    sprite({
      id: 'gleam', asset: A.trace02H, z: 3, sizeX: 108, sizeY: 16, alpha: 0.8, tint: T.phys.c2,
      blend: 'add', rotDeg: -45, delay: 0.02, duration: 0.16,
      alphaOverLife: C.pop, scaleOverLife: [[0, 0.5], [0.4, 1], [1, 1.1]]
    }),
    chips({ tint: T.phys.c2, burst: 7, speed: [130, 230], startPx: [5, 9] })
  ]
});

/* ---------- slash-bloodblade：紅色斬弧 + 血珠 ---------- */
P['slash-bloodblade'] = () => ({
  id: 'slash-bloodblade', duration: 0.32, layers: [
    ...arc({ R: 40, tint: T.bleed.c1, innerTint: T.bleed.c2, base: -50, swing: 26, dur: 0.26 }),
    particle({
      id: 'drops', asset: AT.dot, z: 6, blend: 'normal', tint: T.bleed.c1,
      burst: 6, lifetime: [0.2, 0.32], spawnRadius: 12, speed: [70, 140], direction: 40, spread: 120,
      gravity: { x: 0, y: 420 }, startPx: [4, 8],
      alphaOverLife: [[0, 1], [0.6, 1], [1, 0]], scaleOverLife: [[0, 1], [1, 0.7]]
    })
  ]
});

/* ---------- slash-dual：兩道交叉斬弧（X 形），錯開 0.06s ---------- */
P['slash-dual'] = () => ({
  id: 'slash-dual', duration: 0.35, layers: [
    ...arc({ id: 'arc-a', R: 40, tint: T.phys.c1, base: -50, swing: 22, z: 1 }),
    ...arc({ id: 'arc-b', R: 40, tint: T.phys.c1, base: 50, swing: -22, z: 3, delay: 0.06 }),
    chips({ tint: T.phys.c2, z: 6, burst: 6, direction: 0, spread: 200, speed: [90, 170] })
  ]
});

/* ---------- slash-cleave-arc：迴旋斬弧（-53° → +59°） ----------
   原點＝玩家、+X＝面向。素材的月牙原本在下方（+Y＝90°），因此底角 -90°
   才會落在 +X；再由 rotationOverLife 掃過 -53°→+59°。 */
P['slash-cleave-arc'] = () => require('./cleave.cjs').make('slash-cleave-arc', false);

/* ---------- slash-cleave-sector：迴身四方斬的 60° 楔形 ---------- */
P['slash-cleave-sector'] = () => ({
  id: 'slash-cleave-sector', duration: 0.5, layers: [
    /* 錐體頂點在素材底邊 → anchor y=1 把頂點釘在原點，再轉 +90° 讓它朝 +X。 */
    sprite({
      /* fill 是扇形的**本體**，原本 alpha 0.2 幾乎看不見，看得見的只剩下
         兩條筆直的邊界線與一整圈細環——畫面上是一張線框示意圖，
         不是一記橫掃。扇形要靠「面」讀出來，邊界線只是輪廓。 */
      id: 'fill', asset: A.coneC, z: 1, sizeX: 90, sizeY: 200, anchor: { x: 0.5, y: 1 },
      alpha: 0.55, tint: '#60a5fa', blend: 'add', rotDeg: 90, duration: 0.5,
      alphaOverLife: SECTOR_A, scaleOverLife: SECTOR_S, rotationOverLife: sweepDegPerSec(0.5)
    }),
    sprite({
      /* ringA 是**整圈**環，但這一招只掃一個扇形；整圈亮著會讓人以為
         範圍是 360 度。壓到 0.16 當作外緣的餘光，不當作範圍指示。 */
      id: 'rim', asset: A.ringA, z: 2, size: 200, alpha: 0.16, tint: '#bfdbfe', blend: 'add',
      duration: 0.5, alphaOverLife: [[0, 0], [0.2, 0.6], [0.75, 0.5], [1, 0]], scaleOverLife: SECTOR_S
    }),
    sprite({
      id: 'edge-a', asset: A.barA, z: 3, sizeX: 8, sizeY: 100, anchor: { x: 0.5, y: 1 },
      alpha: 0.45, tint: '#bfdbfe', blend: 'add', rotDeg: 60, duration: 0.5,
      alphaOverLife: SECTOR_A, scaleOverLife: SECTOR_S, rotationOverLife: sweepDegPerSec(0.5)
    }),
    sprite({
      id: 'edge-b', asset: A.barA, z: 4, sizeX: 8, sizeY: 100, anchor: { x: 0.5, y: 1 },
      alpha: 0.45, tint: '#bfdbfe', blend: 'add', rotDeg: 120, duration: 0.5,
      alphaOverLife: SECTOR_A, scaleOverLife: SECTOR_S, rotationOverLife: sweepDegPerSec(0.5)
    })
  ]
});

/* ---------- slash-gale-sector：疾風斬 180° 半碟 ----------
   180° 用 V 錐體撐不出來，改以「壓扁的圓盤 + 前緣亮弧」逼近：
   圓盤本身給範圍感、亮弧給「掃出去」的方向。 */
P['slash-gale-sector'] = () => ({
  id: 'slash-gale-sector', duration: 0.5, layers: [
    sprite({
      id: 'fill', asset: A.discB, z: 1, sizeX: 200, sizeY: 200, anchor: { x: 0, y: 0.5 },
      alpha: 0.2, tint: T.wind.c1, blend: 'add', duration: 0.5,
      alphaOverLife: SECTOR_A, scaleOverLife: SECTOR_S, rotationOverLife: sweepDegPerSec(0.5)
    }),
    sprite({
      id: 'front', asset: A.slash02, z: 2, size: 200, alpha: 0.9, tint: '#ffffff', blend: 'add',
      rotDeg: -90, duration: 0.5,
      alphaOverLife: SECTOR_A, scaleOverLife: SECTOR_S,
      rotationOverLife: [[0, deg(-90)], [1, deg(90)]]
    }),
    sprite({
      id: 'rim', asset: A.ringA, z: 3, size: 200, alpha: 0.55, tint: '#ffffff', blend: 'add',
      duration: 0.5, alphaOverLife: [[0, 0], [0.2, 0.7], [0.75, 0.5], [1, 0]], scaleOverLife: SECTOR_S
    })
  ]
});

/* 突刺獨立製作，避免家族重生時覆蓋新版本。 */
P['slash-thrust-lance'] = () => require('./thrust.cjs').make('slash-thrust-lance', false, false);

/* ---------- slash-wind-crescent：真空斬新月（朝 +X） ----------
   與 proj-wind-crescent 同一套形狀語彙：slash02 外弧 + slash01 內芯 + rotDeg -90。
   原本用 slash03（細長刀片）畫成 33x75，畫面上是一道細絲；
   風系的斬擊要與物理系的半月斬（slash-phys-big）讀起來是同一種東西，
   只是顏色不同——用不同的素材會讓它看起來像另一個系統畫的。 */
P['slash-wind-crescent'] = () => require('./vacuumslash-renew.cjs').make();

/* ---------- slash-wind-spin：真空迴旋（扁橢圓風環，縱向壓 0.62） ---------- */
P['slash-wind-spin'] = () => ({
  id: 'slash-wind-spin', duration: 0.42, layers: [
    sprite({
      id: 'ring', asset: A.ringB, z: 1, sizeX: 120, sizeY: 74, alpha: 0.9, tint: T.wind.c1,
      blend: 'add', duration: 0.42,
      alphaOverLife: [[0, 0], [0.15, 1], [0.7, 0.8], [1, 0]],
      scaleOverLife: [[0, 0.7], [0.45, 1], [1, 1.08]], rotationOverLife: C.spin(0.5)
    }),
    sprite({
      id: 'ring-inner', asset: A.ringThin, z: 2, sizeX: 96, sizeY: 59, alpha: 0.8, tint: '#ffffff',
      blend: 'add', duration: 0.42,
      alphaOverLife: [[0, 0], [0.2, 0.9], [0.7, 0.6], [1, 0]],
      scaleOverLife: [[0, 0.75], [0.5, 1], [1, 1.06]], rotationOverLife: C.spin(-0.5)
    }),
    sprite({
      id: 'blades', asset: A.twirl02, z: 3, sizeX: 120, sizeY: 74, alpha: 0.7, tint: '#ffffff',
      blend: 'add', duration: 0.42,
      alphaOverLife: [[0, 0], [0.18, 0.8], [0.7, 0.6], [1, 0]],
      scaleOverLife: [[0, 0.65], [0.5, 1], [1, 1.05]], rotationOverLife: C.spin(1)
    })
  ]
});

/* ---------- slash-enemy-melee：敵方近戰爪痕 ---------- */
P['slash-enemy-melee'] = () => ({
  id: 'slash-enemy-melee', duration: 0.26, layers: [
    sprite({
      id: 'claw', asset: A.scratch, z: 1, size: 72, alpha: 0.95, tint: T.enemy.c1, blend: 'add',
      rotDeg: -40, duration: 0.22,
      alphaOverLife: ARC_A, scaleOverLife: [[0, 0.75], [0.35, 1], [1, 1.06]],
      rotationOverLife: [[0, deg(-14)], [1, deg(14)]]
    }),
    sprite({
      id: 'claw-inner', asset: A.slash01, z: 2, size: 58, alpha: 0.9, tint: '#ffffff', blend: 'add',
      rotDeg: -40, delay: 0.02, duration: 0.16,
      alphaOverLife: INNER_A, scaleOverLife: [[0, 0.9], [1, 1.06]]
    })
  ]
});

/* ---------- 寫出 + 驗證 ---------- */
const ORDER = ['slash-phys', 'slash-phys-big', 'slash-bloodblade', 'slash-dual',
  'slash-cleave-arc', 'slash-cleave-sector', 'slash-gale-sector', 'slash-thrust-lance',
  'slash-wind-crescent', 'slash-wind-spin', 'slash-enemy-melee'];
const written = [];
const assets = new Set();
for (const id of ORDER) {
  const preset = P[id]();
  if (preset.id !== id) throw new Error('id 不符：' + id);
  const zs = new Set();
  preset.layers.forEach(l => { const z = l.zIndex || 0; if (zs.has(z)) throw new Error(id + ' zIndex 重複：' + z); zs.add(z); });
  preset.layers.forEach(l => assets.add(l.assetId));
  written.push(kit.write(preset));
}
const probes = ORDER.map(id => kit.probe(id));
console.log(JSON.stringify({ written, probes, assetsUsed: [...assets].sort() }, null, 1));
