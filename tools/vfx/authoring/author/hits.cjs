'use strict';
/* hits.cjs — 受擊家族（hit-*）Preset 製作腳本
   結構共用：光暈 halo（大、飽和、低 α、低 z）→ 細環 ring（半徑 6→18px）→ 中心閃光 flash（小、偏白、高 z）
   → 6 顆加法火花向外飛並受重力下墜；元素差異放在火花素材／行為與額外圖層。
   座標：原點 = 目標身體中心；名目：目標身高 60px、主體約 40px。 */
const kit = require('../preset-kit.cjs');
const { A, AT, T, C, RAMP, SHEET, sheetLayer, sprite, particle } = kit;
const PI = Math.PI;

/* ---- 共用曲線（attack ≤ 12%、release 55%~ 之後） ---- */
const FLASH_A = [[0, 0], [0.12, 1], [0.5, 0.7], [1, 0]];
const FLASH_S = [[0, 0.5], [0.2, 1], [1, 1.15]];
const RING_A = [[0, 0], [0.08, 1], [0.55, 0.75], [1, 0]];
const RING_S = [[0, 0.33], [0.35, 0.8], [1, 1]];      // 環半徑 6 → 18px（size 46 的環）
const HALO_A = [[0, 0], [0.1, 1], [0.5, 0.6], [1, 0]];
const HALO_S = [[0, 0.6], [0.3, 1], [1, 1.15]];
const SPARK_A = [[0, 1], [0.5, 1], [1, 0]];
const SPARK_S = [[0, 1], [1, 0.4]];
const FLICKER_A = [[0, 1], [0.25, 0.45], [0.45, 1], [0.7, 0.55], [0.85, 0.9], [1, 0]];

/* ---- 共用三件組：halo / ring / flash ----

   ⚠️ halo 用 screen 而不是 add，這是刻意的，理由是「十個敵人同時受擊」。

   加法混色沒有上限：兩個 0.5 疊起來是 1.0，十個是 5.0。單獨看每一個受擊
   都很漂亮，十個敵人在同一塊區域一起被打到時，十層柔光相加會變成一大團
   純白，把中間的角色整個蓋掉——使用者回報的正是這個。

   screen 是 1-(1-a)(1-b)：永遠逼近 1 但到不了。十層 0.5 的 screen 是 0.999，
   亮，但仍然是「一片亮」而不是「一片死白」，底下的東西還看得見輪廓。
   實測十發同時：halo 面積最大，所以只要改它就足夠；ring 與 flash 又小又短，
   維持加法保有打擊的銳利感。

   （對照組是 hit-fire：它的主體是 normal 混色的序列幀，十發疊起來仍然是
    十個分得開的火球——使用者說那一個「不錯」。normal 完全不累加，
    但柔光用 normal 會把背景壓暗，所以柔光要的是 screen 而不是 normal。）

   flash 也改 screen：它是三層裡最白、最集中的一層，加法之下十發疊起來
   就是實心的一片。halo 的名目尺寸從 64 降到 56——角色身高才 60px，
   64px 的柔光本來就比角色還大，十個散在 9 公尺內就必然連成一片。

   ring 維持加法：它是細環，面積小，而且環與環疊在一起仍然看得出是好幾個環
   （交叉點亮一點正是想要的），那一層負責「有幾個敵人被打到」的資訊。 */
function core(o) {
  const d = o.delay || 0;
  const layers = [];
  if (o.halo !== false) {
    layers.push(sprite({
      id: 'halo', asset: o.haloAsset || A.glowSoft, z: 0, size: o.haloSize || 56,
      alpha: o.haloAlpha === undefined ? 0.62 : o.haloAlpha, tint: o.haloTint, blend: 'screen',
      delay: d, duration: o.haloDur || 0.26, alphaOverLife: HALO_A, scaleOverLife: HALO_S
    }));
  }
  layers.push(sprite({
    id: 'ring', asset: o.ringAsset || A.ringThin, z: 1, size: o.ringSize || 46,
    alpha: o.ringAlpha === undefined ? 0.85 : o.ringAlpha, tint: o.ringTint, blend: 'add',
    delay: d, duration: o.ringDur || 0.3, alphaOverLife: RING_A, scaleOverLife: o.ringScale || RING_S
  }));
  layers.push(sprite({
    id: 'flash', asset: o.flashAsset || A.flash, z: 3, size: o.flashSize || 40,
    alpha: 0.85, tint: o.flashTint, blend: 'screen', rotDeg: o.flashRot || 0,
    delay: d, duration: o.flashDur || 0.16, alphaOverLife: FLASH_A, scaleOverLife: FLASH_S
  }));
  return layers;
}

/* ---- 序列幀圖層 ----
   素材：CodeManu「VFX Free Pack」（OpenGameArt，CC0，不需標註），
   經 tools/vfx/shrink-sheets.cjs 降到 256px 的格子（原始 517px 用不到，
   在遊戲裡最多播到 300px，VRAM 卻是四倍）。

   與手工疊層的差別：動畫在素材裡，不在曲線裡。所以這一類 preset 常常只有
   一個圖層——形狀的演變（白閃 → 火球 → 碎裂 → 煙環）是畫出來的，
   不是用五六層靜圖的縮放與透明度湊出來的。

   ⚠️ 一律用 30fps 版。60fps 版畫面內容相同但格數多一倍，等於兩倍 VRAM。
   ⚠️ blend 用 normal：這些是有完整 alpha 的彩色畫，不是灰階遮罩。
      用 add 的話煙的灰色會變成發光的霧、白色核心會過曝成一片死白。 */
/* 格線與實際用到的格數在 preset-kit 的 SHEET 目錄（由 sheet-facts.cjs 量出來）。
   Explosion 是 6x5＝30 格但只畫了 27 格，目測完全看不出來；
   照 30 格播的話尾巴會空白三格。

   size 對 sheetLayer 而言是**螢幕像素**（sprite() 的 size 是 512 基準）。
   下面的 95／52 就是畫面上的實際大小。 */
function sheetFx(def, o) {
  return sheetLayer(def, Object.assign({
    id: 'sheet', z: o.z === undefined ? 1 : o.z,
    /* 尾端淡出：素材最後幾格常常還有淡煙，硬切會看到它突然消失。 */
    alphaOverLife: [[0, 1], [0.82, 1], [1, 0]]
  }, o));
}

/* ---- 共用火花：6 顆、向外、受重力、被空氣拖慢、末段變暗 ----
   drag：碎屑噴出去之後會減速。沒有它的話火花是等速直線＋重力的拋物線，
   看起來像被彈開的硬物，而不是被炸散的碎屑。3/秒 在 0.3 秒的壽命裡
   大約掉到四成速度（v ≈ v0·e^(-drag·t)），夠明顯但不會讓它們原地停住。
   tintOverLife：末段壓暗但不改色相（fadeDark 前半是白＝乘 1），
   所以十三種元素共用同一條——冷卻是共通的，顏色不是。 */
function sparks(o) {
  return particle(Object.assign({
    id: 'sparks', asset: A.dot, z: 5, blend: 'add',
    burst: 6, lifetime: [0.22, 0.34], spawnRadius: 4,
    speed: [80, 130], direction: -90, spread: 360, gravity: { x: 0, y: 320 },
    drag: 3, tintOverLife: RAMP.fadeDark,
    startPx: [5, 9], alphaOverLife: SPARK_A, scaleOverLife: SPARK_S
  }, o));
}

const P = {};

/* ---------- hit-phys：暖白方形碎片 ---------- */
/* ⚠️ 這一份試過序列幀（Effect_SmallHit）之後**退回手工版**。
   SmallHit 是一圈細白線的星芒，在 96px 下幾乎看不見——線寬不到一個像素，
   縮放時直接被抹掉。實測對照圖：手工版的環與閃光清楚，序列幀版是一團灰霧。

   這是「哪些特效適合序列幀」的分界：**粗實高對比的形狀**（火球、爆炸、
   血漬）縮到 60～96px 仍然讀得出來；**細線條**（星芒、萬花筒、電弧絲）
   要 200px 以上才成立。受擊特效在這個遊戲裡只有 60～96px，所以這一類
   一律留手工版。 */
P['hit-phys'] = () => ({
  id: 'hit-phys', duration: 0.4, layers: [
    ...core({ haloTint: T.phys.glow, haloAlpha: 0.4, ringTint: T.phys.c1, flashTint: T.phys.c2 }),
    sparks({ asset: A.diamond, tint: T.phys.c1, startPx: [5, 8], rotationStart: [0, PI], rotationSpeed: [-9, 9], speed: [90, 150] })
  ]
});

/* ---------- hit-fire：火花偏向上飄 + 3 片火舌 ---------- */
/* 序列幀（Effect_Explosion2，中型火球）＋ 元素色光暈。
   原本是 core（光暈／環／閃光）＋ 火星 ＋ 三片火舌共五層，靠縮放與透明度
   湊出「炸開」的感覺；序列幀直接把形狀的演變畫出來，兩層就夠。
   火星那一層留著——它是往上飄的，與素材的球狀擴散是不同方向的動態。 */
P['hit-fire'] = () => ({
  id: 'hit-fire', duration: 0.45, layers: [
    sprite({
      id: 'halo', asset: A.glowSoft, z: 0, size: 72, alpha: 0.5, tint: T.fire.glow, blend: 'add',
      duration: 0.28, alphaOverLife: HALO_A, scaleOverLife: HALO_S
    }),
    sheetFx(SHEET.explosion2, { size: 52, z: 1 }),
    sparks({
      tint: T.fire.c2, direction: -90, spread: 240, speed: [60, 130],
      gravity: { x: 0, y: -140 }, lifetime: [0.26, 0.38], startPx: [4, 8],
      tintOverLife: RAMP.fireCore, z: 2
    })
  ]
});

/* ---------- hit-ice：菱形冰晶碎片 + 星芒閃點 ---------- */
P['hit-ice'] = () => ({
  id: 'hit-ice', duration: 0.4, layers: [
    ...core({ haloTint: T.ice.glow, ringTint: T.ice.c1, flashAsset: A.star09, flashTint: T.ice.c2, flashSize: 44, flashRot: 15 }),
    sparks({ asset: A.diamond, tint: T.ice.c2, startPx: [6, 10], rotationStart: [0, PI], rotationSpeed: [-7, 7], speed: [90, 160], gravity: { x: 0, y: 380 }, tintOverLife: RAMP.ice }),
    particle({
      id: 'glints', asset: A.star08, z: 6, blend: 'add', tint: T.ice.c1,
      burst: 3, lifetime: [0.18, 0.28], spawnRadius: 12, speed: [10, 30], direction: -90, spread: 360,
      startPx: [10, 16], alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 0.5], [0.5, 1], [1, 0.6]]
    })
  ]
});

/* ---------- hit-lightning：細電弧絲（順速度方向）+ 電弧網閃爍 ---------- */
P['hit-lightning'] = () => ({
  id: 'hit-lightning', duration: 0.4, layers: [
    ...core({ haloTint: T.lightning.glow, haloAlpha: 0.55, ringTint: T.lightning.c1, flashTint: T.lightning.c2, flashDur: 0.14 }),
    sprite({
      id: 'arcweb', asset: A.arc02, z: 2, size: 44, alpha: 0.9, tint: T.lightning.c1, blend: 'add', rotDeg: 20,
      duration: 0.2, alphaOverLife: FLICKER_A, scaleOverLife: [[0, 0.7], [0.3, 1], [1, 1.1]]
    }),
    sparks({
      asset: A.bolt05, tint: T.lightning.c2, alignToVelocity: true, velocityRotationOffset: +(PI / 2).toFixed(4),
      lifetime: [0.12, 0.22], speed: [140, 240], gravity: { x: 0, y: 200 }, startPx: [14, 22],
      alphaOverLife: FLICKER_A, scaleOverLife: [[0, 1], [1, 0.6]]
    })
  ]
});

/* ---------- hit-poison：空心毒泡緩慢上浮 + 綠霧 ---------- */
P['hit-poison'] = () => ({
  id: 'hit-poison', duration: 0.4, layers: [
    ...core({ haloTint: T.poison.glow, ringTint: T.poison.c1, flashTint: T.poison.c2, flashSize: 36 }),
    sprite({
      id: 'mist', asset: A.smokeT, z: 2, size: 44, alpha: 0.35, tint: T.poison.c1, blend: 'normal',
      duration: 0.38, alphaOverLife: [[0, 0], [0.15, 1], [0.6, 0.8], [1, 0]], scaleOverLife: [[0, 0.7], [1, 1.35]], rotationOverLife: [[0, 0], [1, 0.5]]
    }),
    sparks({
      asset: A.bubble, tint: T.poison.c1, burst: 6, lifetime: [0.3, 0.4], spawnRadius: 8,
      speed: [25, 60], direction: -90, spread: 150, gravity: { x: 0, y: -50 }, startPx: [7, 12],
      alphaOverLife: [[0, 0], [0.15, 1], [0.85, 1], [1, 0]], scaleOverLife: [[0, 0.6], [0.7, 1], [1, 1.1]]
    })
  ]
});

/* ---------- hit-light：白金塵點 + 星芒閃光 ---------- */
P['hit-light'] = () => ({
  id: 'hit-light', duration: 0.4, layers: [
    ...core({ haloTint: T.light.c1, haloAlpha: 0.55, haloSize: 70, ringTint: T.light.c1, flashAsset: A.star09, flashTint: T.light.c2, flashSize: 46 }),
    sprite({
      id: 'cross', asset: A.star02, z: 4, size: 34, alpha: 0.9, tint: T.light.c2, blend: 'add', rotDeg: 45,
      duration: 0.22, alphaOverLife: FLASH_A, scaleOverLife: [[0, 0.6], [0.25, 1], [1, 1.2]], rotationOverLife: [[0, 0], [1, 0.6]]
    }),
    sparks({ asset: A.star04, tint: T.light.c2, startPx: [6, 11], speed: [70, 130], gravity: { x: 0, y: 240 }, lifetime: [0.26, 0.38] })
  ]
});

/* ---------- hit-dark：內縮漩渦（0~0.16s）→ 暗核 → 0.14s 後爆開 ---------- */
P['hit-dark'] = () => ({
  id: 'hit-dark', duration: 0.4, layers: [
    sprite({
      id: 'vortex', asset: A.twirl02, z: 2, size: 64, alpha: 0.95, tint: T.dark.c1, blend: 'add',
      duration: 0.17, alphaOverLife: [[0, 0], [0.15, 1], [0.8, 1], [1, 0.5]],
      scaleOverLife: [[0, 1.25], [1, 0.3]], rotationOverLife: [[0, 0], [1, -3.8]]
    }),
    sprite({
      id: 'darkcore', asset: A.smokeT, z: 4, size: 30, alpha: 0.85, tint: T.dark.c2, blend: 'normal',
      duration: 0.32, alphaOverLife: [[0, 0], [0.35, 1], [0.7, 0.8], [1, 0]],
      scaleOverLife: [[0, 0.3], [0.4, 1], [1, 1.5]], rotationOverLife: [[0, 0], [1, 1.2]]
    }),
    ...core({ delay: 0.14, haloTint: T.dark.glow, haloAlpha: 0.6, ringTint: T.dark.c1, ringDur: 0.26, flashTint: T.dark.bright, flashSize: 36, flashDur: 0.14 }),
    sparks({ tint: T.dark.bright, delay: 0.14, lifetime: [0.18, 0.26], speed: [110, 180], gravity: { x: 0, y: 300 }, startPx: [4, 8] })
  ]
});

/* ---------- hit-earth：方形碎石（不透明）+ 塵土 ---------- */
P['hit-earth'] = () => ({
  id: 'hit-earth', duration: 0.4, layers: [
    ...core({ haloTint: T.earth.glow, haloAlpha: 0.4, ringTint: T.earth.c1, flashTint: T.earth.glow, flashSize: 38 }),
    particle({
      id: 'dust', asset: A.smokeT, z: 2, blend: 'normal', tint: T.earth.c2, alpha: 0.5,
      burst: 3, lifetime: [0.3, 0.38], spawnRadius: 6, speed: [20, 45], direction: -90, spread: 360,
      startPx: [16, 24], alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 0.6], [1, 1.5]]
    }),
    sparks({
      asset: A.diamond, tint: T.earth.c1, blend: 'normal', startPx: [6, 10],
      rotationStart: [0, PI], rotationSpeed: [-8, 8], speed: [70, 130], gravity: { x: 0, y: 440 },
      lifetime: [0.22, 0.32], scaleOverLife: [[0, 1], [1, 0.7]], alphaOverLife: [[0, 1], [0.7, 1], [1, 0]]
    })
  ]
});

/* ---------- hit-wind：細長風刃碎片（順速度方向）淺綠 + 白 ---------- */
P['hit-wind'] = () => ({
  id: 'hit-wind', duration: 0.4, layers: [
    ...core({ haloTint: T.wind.glow, haloAlpha: 0.35, ringTint: T.wind.c1, flashTint: T.wind.c2, flashSize: 34, flashDur: 0.14 }),
    sparks({
      asset: A.trace02, tint: T.wind.c1, alignToVelocity: true, velocityRotationOffset: +(PI / 2).toFixed(4),
      lifetime: [0.16, 0.26], speed: [110, 190], gravity: { x: 0, y: 120 }, startPx: [16, 26], scaleOverLife: [[0, 1], [1, 0.5]]
    }),
    particle({
      id: 'sparks-white', asset: A.trace02, z: 6, blend: 'add', tint: T.wind.c2,
      burst: 4, lifetime: [0.12, 0.2], spawnRadius: 4, speed: [140, 220], direction: -90, spread: 360,
      gravity: { x: 0, y: 80 }, startPx: [10, 16], alignToVelocity: true, velocityRotationOffset: +(PI / 2).toFixed(4),
      alphaOverLife: SPARK_A, scaleOverLife: [[0, 1], [1, 0.4]]
    })
  ]
});

/* ---------- hit-bleed：暗紅閃光 + 血濺貼花 + 亮粉紅血滴向下濺落（無震動） ---------- */
P['hit-bleed'] = () => ({
  id: 'hit-bleed', duration: 0.45, layers: [
    ...core({ haloTint: T.bleed.c1, haloAlpha: 0.45, haloSize: 60, ringTint: T.bleed.c1, ringAlpha: 0.6, ringSize: 40, flashTint: T.bleed.c1, flashSize: 36 }),
    /* 噴濺改用序列幀：靜圖的潑濺只能靠縮放曲線「長大」，那是所有方向
       同時擴散；真實的血是先噴出去、再往下掛。動畫在素材裡就有了。
       BloodImpact 是這批圖集裡少數格子很小的（69x60），縮到 44px 仍然
       是粗實的色塊，不會踩到細線條在小尺寸下消失的那條界線。 */
    sheetFx(SHEET.bloodImpact, { id: 'splat', z: 2, size: 44, duration: 0.42 }),
    particle({
      id: 'drops', asset: A.lines1, z: 5, blend: 'normal', tint: T.bleed.c2,
      burst: 6, lifetime: [0.24, 0.32], spawnRadius: 5, speed: [30, 90], direction: 90, spread: 150,
      gravity: { x: 0, y: 400 }, startPx: [12, 18], alignToVelocity: true, velocityRotationOffset: +(PI / 2).toFixed(4),
      alphaOverLife: [[0, 1], [0.6, 1], [1, 0]], scaleOverLife: [[0, 0.8], [0.3, 1], [1, 0.8]]
    }),
    particle({
      id: 'mist', asset: A.dot, z: 6, blend: 'add', tint: T.bleed.c2,
      burst: 4, lifetime: [0.18, 0.28], spawnRadius: 6, speed: [40, 90], direction: 90, spread: 220,
      gravity: { x: 0, y: 300 }, startPx: [3, 6], alphaOverLife: SPARK_A, scaleOverLife: SPARK_S
    })
  ]
});

/* ---------- hit-fire-explosion：大型火球爆炸（環半徑 6→60px、0.62s；18 顆火花 + 6 火舌 + 煙） ---------- */
/* 序列幀（Effect_Explosion，大爆炸）。原本是九層手工疊出來的，
   序列幀版有完整的爆炸生命史：白閃 → 火球膨脹 → 碎裂成橘色顆粒 → 白煙環 → 灰煙散開。
   那個「碎裂」的階段是靜圖疊層做不出來的——形狀本身要變。

   保留兩層：底下的元素色光暈（屬性辨識）與衝擊環（範圍感，素材本身沒有明確邊界）。 */
P['hit-fire-explosion'] = () => ({
  id: 'hit-fire-explosion', duration: 0.75, layers: [
    sprite({
      id: 'halo', asset: A.glowSoft, z: 0, size: 150, alpha: 0.55, tint: T.fire.glow, blend: 'add',
      duration: 0.45, alphaOverLife: HALO_A, scaleOverLife: [[0, 0.5], [0.3, 1], [1, 1.2]]
    }),
    sprite({
      id: 'ring', asset: A.ringThin, z: 1, size: 150, alpha: 0.85, tint: T.fire.glow, blend: 'add',
      duration: 0.62, alphaOverLife: [[0, 0], [0.06, 1], [0.6, 0.6], [1, 0]],
      scaleOverLife: [[0, 0.1], [0.4, 0.72], [1, 1]]
    }),
    sheetFx(SHEET.explosion, { size: 95, z: 2 })
  ]
});

P['hit-thunder-purple'] = () => ({
  id: 'hit-thunder-purple', duration: 0.45, layers: [
    sprite({
      id: 'halo', asset: A.glowSoft, z: 0, size: 96, alpha: 0.6, tint: T.purple.glow, blend: 'add',
      duration: 0.32, alphaOverLife: HALO_A, scaleOverLife: HALO_S
    }),
    sprite({
      id: 'ring', asset: A.ringThin, z: 1, size: 60, alpha: 0.95, tint: T.purple.c1, blend: 'add',
      duration: 0.34, alphaOverLife: RING_A, scaleOverLife: [[0, 0.25], [0.4, 0.8], [1, 1]]
    }),
    sprite({
      id: 'arcweb-a', asset: A.arc02, z: 2, size: 66, alpha: 0.9, tint: T.purple.c1, blend: 'add', rotDeg: 15,
      duration: 0.22, alphaOverLife: FLICKER_A, scaleOverLife: [[0, 0.7], [0.3, 1], [1, 1.1]]
    }),
    sprite({
      id: 'arcweb-b', asset: A.arc01, z: 3, size: 58, alpha: 0.8, tint: T.purple.glow, blend: 'add', rotDeg: -70, delay: 0.05,
      duration: 0.2, alphaOverLife: FLICKER_A, scaleOverLife: [[0, 0.8], [1, 1.15]]
    }),
    sprite({
      id: 'flash', asset: A.star09, z: 4, size: 46, alpha: 1, tint: T.purple.c2, blend: 'add', rotDeg: 10,
      duration: 0.16, alphaOverLife: FLASH_A, scaleOverLife: FLASH_S
    }),
    particle({
      id: 'sparks', asset: A.bolt05, z: 5, blend: 'add', tint: T.purple.c2,
      burst: 10, lifetime: [0.14, 0.26], spawnRadius: 6, speed: [160, 280], direction: -90, spread: 360,
      gravity: { x: 0, y: 220 }, startPx: [16, 26], alignToVelocity: true, velocityRotationOffset: +(PI / 2).toFixed(4),
      alphaOverLife: FLICKER_A, scaleOverLife: [[0, 1], [1, 0.6]]
    }),
    particle({
      id: 'glints', asset: A.star08, z: 6, blend: 'add', tint: T.purple.c2,
      burst: 4, lifetime: [0.2, 0.3], spawnRadius: 14, speed: [40, 90], direction: -90, spread: 360,
      startPx: [8, 14], alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 0.5], [0.5, 1], [1, 0.5]]
    })
  ]
});

/* ---------- hit-enemy：紅色小環 + 4 顆淡紅塵點（輕量） ---------- */
P['hit-enemy'] = () => ({
  id: 'hit-enemy', duration: 0.3, layers: [
    sprite({
      id: 'ring', asset: A.ringA, z: 1, size: 38, alpha: 0.9, tint: T.enemy.c1, blend: 'add',
      duration: 0.26, alphaOverLife: [[0, 0], [0.1, 0.95], [0.6, 0.6], [1, 0]], scaleOverLife: [[0, 0.35], [1, 1]]
    }),
    sprite({
      id: 'flash', asset: A.dot, z: 2, size: 24, alpha: 1, tint: T.enemy.c2, blend: 'add',
      duration: 0.12, alphaOverLife: C.pop, scaleOverLife: [[0, 0.6], [0.2, 1], [1, 1.2]]
    }),
    particle({
      id: 'dust', asset: A.dot, z: 3, blend: 'add', tint: T.enemy.c2,
      burst: 4, lifetime: [0.18, 0.26], spawnRadius: 4, speed: [60, 110], direction: -90, spread: 360,
      gravity: { x: 0, y: 220 }, startPx: [4, 7], alphaOverLife: [[0, 1], [0.4, 1], [1, 0]], scaleOverLife: SPARK_S
    })
  ]
});

/* ---------- 寫出 + 驗證 ---------- */
const ORDER = ['hit-phys', 'hit-fire', 'hit-ice', 'hit-lightning', 'hit-poison', 'hit-light', 'hit-dark', 'hit-earth', 'hit-wind', 'hit-bleed', 'hit-fire-explosion', 'hit-thunder-purple', 'hit-enemy'];
const written = [];
const assets = new Set();
for (const id of ORDER) {
  const preset = P[id]();
  if (preset.id !== id) throw new Error('id 不符：' + id);
  // z 唯一性檢查
  const zs = new Set();
  preset.layers.forEach(l => { const z = l.zIndex || 0; if (zs.has(z)) throw new Error(id + ' zIndex 重複：' + z); zs.add(z); });
  preset.layers.forEach(l => assets.add(l.assetId));
  written.push(kit.write(preset));
}
const probes = ORDER.map(id => kit.probe(id));
console.log(JSON.stringify({ written, probes, assetsUsed: [...assets].sort() }, null, 1));
