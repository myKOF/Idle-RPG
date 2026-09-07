'use strict';
/* bolts.cjs — 天降雷柱／光柱／光束家族（bolt-*、pillar-*、beam-*）Preset 製作腳本
   天降類：原點＝著地點，柱體從 (0,-H) 落到 (0,0)。素材是「滿版直立」的，因此
     anchor y=1（底端釘在原點）＋ sizeY=H 就是整根柱子；分段收窄用多個 sprite 疊。
   光束類：沿 +X 長 200px，anchor x=0（根部在原點）；Runtime 以 scaleX = 距離/200 拉長。 */
const kit = require('../preset-kit.cjs');
const { A, T, C, RAMP, deg, sprite, particle } = kit;
const PI = Math.PI;

const BOT = { x: 0.5, y: 1 };     // 底端對齊原點（天降柱）
const TOP = { x: 0.5, y: 0 };     // 頂端對齊 position（由上往下伸展的光柱）
const LEFT = { x: 0, y: 0.5 };    // 根部對齊原點（沿 +X 的光束）

/* 兩次快閃後消失 */
const STRIKE_A = [[0, 0], [0.05, 1], [0.2, 0.35], [0.32, 1], [0.6, 0.5], [1, 0]];
const CORE_A = [[0, 0], [0.04, 1], [0.22, 0.5], [0.3, 1], [0.55, 0.4], [1, 0]];
const GLOW_A = [[0, 0], [0.08, 0.8], [0.6, 0.45], [1, 0]];
const RING_A = [[0, 0], [0.1, 0.9], [1, 0]];
const RING_S = [[0, 0.3], [1, 1]];

/* ---- 為什麼閃電會畫成一根直棍 ----

   spark_05／06 這幾張素材本身就是漂亮的鋸齒狀閃電（512x512，內容
   328x512，長寬比 0.64）。問題出在 preset 把它壓成 13x167——長寬比
   0.078，橫向被壓縮了八倍。鋸齒的左右擺幅隨著寬度一起縮到剩下 8px，
   於是畫面上就是一條直線；再疊上 barA（4x500 的直棍）當核心，
   看起來就完全是「一道光束從天空照下」而不是閃電劈下。

   所以規則是：**鋸齒的擺幅 ≈ 素材寬度 × 0.64，不能把它壓掉。**
   一段 167px 高的雷要看得出鋸齒，寬度至少要 60～90px。

   連鎖雷是同一個問題轉 90 度：spark_07 的內容長寬比 1.44，preset 畫成
   200x7（14.3）。要注意的是 Runtime 只拉伸 X（scaleX = 距離/200，
   scaleY 固定 1），所以**縱向擺幅完全由 sizeY 決定**，與敵人距離無關——
   sizeY 給足，拉多長都還是鋸齒。

   白熱核心不再用直棍疊，改用 tintOverLife：一開始白熱，很快冷卻成元素色，
   末段轉暗。核心因此永遠與鋸齒重合，不會有一根筆直的白線穿過去。 */
const STRIKE_TINT = {
  gold:   [[0, '#ffffff'], [0.08, '#fff8b0'], [0.35, '#f2b705'], [1, '#6b3f00']],
  purple: [[0, '#ffffff'], [0.08, '#f5e8ff'], [0.35, '#c084fc'], [1, '#3b1060']],
  blue:   [[0, '#ffffff'], [0.15, '#dbeafe'], [0.6, '#7dd3fc'], [1, '#1e3a8a']]
};

const P = {};

/* ---------- 天降雷：三段鋸齒接力落地 ----------
   三段各 190px 高、上下重疊約 30px，x 有小幅偏移讓路徑蜿蜒（真實的雷
   不會落在一條垂直線上）。branch 是分岔：一小段偏出去又消失，
   這一層對「像不像閃電」的貢獻遠大於它的大小。

   glow 保留但壓到 0.2：雷擊瞬間空氣確實會整片發亮，那是對的；
   它會變成光束是因為原本 alpha 0.45 又疊了一根直棍核心。 */
function skyBolt(o) {
  const seg = (id, z, asset, w, y, x) => sprite({
    id: id, asset: asset, z: z, sizeX: w, sizeY: 190, y: y, x: x,
    alpha: 1, tint: '#ffffff', tintOverLife: o.ramp, blend: 'add',
    duration: o.strikeDur, alphaOverLife: STRIKE_A
  });
  return [
    /* 輝光用柔邊圓盤拉長，不用 barB。barB 是 cone_b——舞台燈的光錐，
       左右是**硬邊**；壓成 100x500 就是一個半透明的長方形框在雷的外面，
       正是使用者說的「包著一個方塊」。光錐當光柱是對的，當雷的輝光不對。 */
    sprite({
      id: 'glow', asset: A.discA, z: 0, sizeX: o.glowW, sizeY: 560, anchor: BOT,
      alpha: 0.24, tint: o.edge, blend: 'add', duration: o.dur, alphaOverLife: GLOW_A
    }),
    seg('seg-a', 1, A.bolt06, o.w, -405, 0),
    seg('seg-b', 2, A.bolt05, o.w * 0.9, -250, 12),
    seg('seg-c', 3, A.bolt06, o.w * 0.75, -95, -9),
    sprite({
      id: 'branch', asset: A.bolt04, z: 4, sizeX: o.w * 0.62, sizeY: o.w * 0.62,
      x: o.w * 0.42, y: -300, rotDeg: 34,
      alpha: 0.85, tint: '#ffffff', tintOverLife: o.ramp, blend: 'add',
      duration: o.strikeDur * 0.7, alphaOverLife: STRIKE_A
    })
  ].concat(o.extra || []);
}

P['bolt-sky-lightning'] = () => ({
  id: 'bolt-sky-lightning', duration: 0.4, layers: skyBolt({
    ramp: STRIKE_TINT.gold, edge: '#ffd23f', w: 84, glowW: 100, dur: 0.4, strikeDur: 0.4,
    extra: [
      sprite({ id: 'ground', asset: A.ringA, z: 5, sizeX: 56, sizeY: 22, alpha: 0.9, tint: '#ffd23f', blend: 'add', delay: 0.04, duration: 0.34, alphaOverLife: RING_A, scaleOverLife: RING_S }),
      sprite({ id: 'flash', asset: A.flash, z: 6, size: 42, alpha: 1, tint: '#fff8b0', blend: 'add', delay: 0.03, duration: 0.16, alphaOverLife: C.pop, scaleOverLife: [[0, 0.5], [1, 1.2]] })
    ]
  })
});

/* ---------- bolt-sky-purple：紫雷（更粗 + 著地符紋環） ---------- */
P['bolt-sky-purple'] = () => ({
  id: 'bolt-sky-purple', duration: 0.65, layers: skyBolt({
    ramp: STRIKE_TINT.purple, edge: '#9333ea', w: 104, glowW: 130, dur: 0.65, strikeDur: 0.5,
    extra: [
      /* 符紋環：6 rad/s x 0.65s = 3.9 rad */
      sprite({
        id: 'sigil', asset: A.rings3, z: 5, sizeX: 56, sizeY: 26, alpha: 0.9, tint: '#c084fc', blend: 'add',
        delay: 0.04, duration: 0.61, alphaOverLife: [[0, 0], [0.12, 0.95], [0.7, 0.7], [1, 0]],
        scaleOverLife: RING_S, rotationOverLife: [[0, 0], [1, 3.9]]
      }),
      sprite({ id: 'flash', asset: A.flash, z: 6, size: 52, alpha: 1, tint: '#fdf4ff', blend: 'add', delay: 0.03, duration: 0.2, alphaOverLife: C.pop, scaleOverLife: [[0, 0.5], [1, 1.25]] })
    ]
  })
});

/* ---------- bolt-chain-lightning：沿 +X 的雷鏈段（名目 200px） ----------
   Runtime 只拉伸 X（scaleX = 兩敵距離 / 200），scaleY 固定 1，
   所以縱向擺幅完全由 sizeY 決定：sizeY 96 x 素材內容比 0.69 = 66px 的上下
   蜿蜒，敵人距離多遠都保得住。原本是 sizeY 7，擺幅 5px——那就是直線。

   兩段用不同素材反向疊：spark_07 與旋轉過的 spark_06 鋸齒節奏不同，
   疊起來才不會像同一條線描了兩次。 */
P['bolt-chain-lightning'] = () => ({
  id: 'bolt-chain-lightning', duration: 0.32, layers: [
    sprite({ id: 'glow', asset: A.trace06H, z: 0, sizeX: 200, sizeY: 44, anchor: LEFT, alpha: 0.3, tint: '#ffd23f', blend: 'add', duration: 0.32, alphaOverLife: GLOW_A }),
    sprite({
      id: 'seg-a', asset: A.bolt07H, z: 1, sizeX: 200, sizeY: 96, anchor: LEFT,
      alpha: 1, tint: '#ffffff', tintOverLife: STRIKE_TINT.gold, blend: 'add',
      duration: 0.32, alphaOverLife: STRIKE_A
    }),
    sprite({
      id: 'seg-b', asset: A.bolt06H, z: 2, sizeX: 200, sizeY: 68, anchor: LEFT,
      alpha: 0.8, tint: '#ffffff', tintOverLife: STRIKE_TINT.gold, blend: 'add',
      duration: 0.32, alphaOverLife: CORE_A
    })
  ]
});

/* ---------- bolt-curtain-lightning：雷幕電柱（loop、持續重抖） ----------
   同樣把 14x450 的直棍拆成兩段 70x235 的鋸齒；核心不再是 barA 直棍，
   改由 tintOverLife 讓鋸齒本身白熱。 */
P['bolt-curtain-lightning'] = () => ({
  id: 'bolt-curtain-lightning', duration: 0.4, loop: true, layers: [
    sprite({ id: 'glow', asset: A.discA, z: 0, sizeX: 78, sizeY: 500, anchor: BOT, alpha: 0.3, tint: '#2563eb', blend: 'add', duration: 0.4, alphaOverLife: [[0, 0.6], [0.5, 0.9], [1, 0.6]] }),
    sprite({ id: 'col-a', asset: A.bolt06, z: 1, sizeX: 70, sizeY: 235, y: -335, alpha: 0.95, tint: '#ffffff', tintOverLife: STRIKE_TINT.blue, blend: 'add', duration: 0.4, alphaOverLife: C.flicker }),
    sprite({ id: 'col-b', asset: A.bolt05, z: 2, sizeX: 62, sizeY: 235, y: -115, x: 8, alpha: 0.95, tint: '#ffffff', tintOverLife: STRIKE_TINT.blue, blend: 'add', duration: 0.4, alphaOverLife: C.flicker }),
    /* 每 0.07s 重抖一次：壽命 0.07s 的短命電弧以 rate 發射，沿柱體隨機出現 */
    particle({
      id: 'jitter', asset: A.bolt05, z: 3, blend: 'add', tint: '#7dd3fc',
      rate: 14, lifetime: [0.06, 0.08], spawnBox: [40, 390], y: -245,
      speed: [0, 0], direction: 0, spread: 0, startPx: [90, 150],
      alphaOverLife: [[0, 1], [0.6, 0.9], [1, 0]], scaleOverLife: [[0, 1], [1, 1]]
    }),
    sprite({ id: 'ground', asset: A.dot, z: 4, size: 26, alpha: 0.95, tint: '#ffffff', blend: 'add', duration: 0.4, alphaOverLife: [[0, 0.8], [0.5, 1], [1, 0.8]] }),
    sprite({ id: 'ground-glow', asset: A.glowSoft, z: 5, sizeX: 60, sizeY: 26, alpha: 0.55, tint: '#2563eb', blend: 'add', duration: 0.4, alphaOverLife: [[0, 0.6], [0.5, 0.9], [1, 0.6]] })
  ]
});

/* ---- 光柱共用：由上往下伸展（anchor 頂端），著地閃光＋塵粒上浮 ---- */
function pillar(o) {
  return [
    sprite({
      id: 'glow', asset: A.barB, z: 0, sizeX: 74, sizeY: 400, anchor: TOP, y: -400,
      alpha: 0.4, tint: o.edge, blend: 'add', duration: 0.9,
      alphaOverLife: [[0, 0], [0.2, 0.8], [0.7, 0.6], [1, 0]],
      scaleYOverLife: [[0, 0.05], [0.22, 1], [1, 1]]
    }),
    sprite({
      id: 'body', asset: A.beamD, z: 1, sizeX: 40, sizeY: 400, anchor: TOP, y: -400,
      alpha: 0.95, tint: o.edge, blend: 'add', duration: 0.9,
      alphaOverLife: [[0, 0], [0.15, 1], [0.7, 0.9], [1, 0]],
      scaleYOverLife: [[0, 0.05], [0.22, 1], [1, 1]]
    }),
    sprite({
      id: 'core', asset: A.beamB, z: 2, sizeX: 16, sizeY: 400, anchor: TOP, y: -400,
      alpha: 1, tint: o.core, blend: 'add', duration: 0.9,
      alphaOverLife: [[0, 0], [0.12, 1], [0.7, 0.95], [1, 0]],
      scaleYOverLife: [[0, 0.05], [0.2, 1], [1, 1]]
    }),
    sprite({
      id: 'land', asset: A.flare30, z: 3, size: 70, alpha: 1, tint: o.core, blend: 'add',
      delay: 0.2, duration: 0.36, alphaOverLife: C.pop, scaleOverLife: [[0, 0.4], [0.35, 1], [1, 1.15]]
    }),
    sprite({
      id: 'ring', asset: A.ringA, z: 4, sizeX: 90, sizeY: 34, alpha: 0.8, tint: o.edge, blend: 'add',
      delay: 0.2, duration: 0.5, alphaOverLife: RING_A, scaleOverLife: RING_S
    }),
    particle(Object.assign({
      id: 'motes', asset: A.dot, z: 5, blend: 'add', tint: o.edge,
      burst: 5, lifetime: [0.4, 0.6], spawnRadius: 22, speed: [30, 60], direction: -90, spread: 70,
      /* 著地揚起的塵：往上噴之後被空氣拖住、慢慢淡掉。 */
      gravity: { x: 0, y: -50 }, drag: 2.5, tintOverLife: RAMP.fadeDark, startPx: [5, 9],
      alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 0.7], [1, 0.4]]
    }, o.motes || {}))
  ];
}

/* ---------- pillar-light：聖光柱 ---------- */
P['pillar-light'] = () => ({ id: 'pillar-light', duration: 0.9, layers: pillar({ core: '#fffef4', edge: '#ffe47a' }) });

/* ---------- pillar-earth：大地再造光柱（塵土向外散開） ---------- */
P['pillar-earth'] = () => ({
  id: 'pillar-earth', duration: 0.9,
  layers: pillar({
    core: '#c48a55', edge: '#ad7444',
    motes: { asset: A.smokeT, blend: 'normal', burst: 7, direction: 0, spread: 360, speed: [50, 110], gravity: { x: 0, y: 60 }, startPx: [10, 18], alphaOverLife: [[0, 0], [0.2, 0.7], [1, 0]] }
  })
});

/* ---- 光束共用：沿 +X、根部在原點 ---- */
function beam(o) {
  const A_IN_OUT = [[0, 0], [0.25, 1], [0.7, 0.9], [1, 0]];
  return [
    sprite({ id: 'glow', asset: A.trace06H, z: 0, sizeX: 200, sizeY: o.w * 3, anchor: LEFT, alpha: 0.5, tint: o.glow, blend: 'add', duration: 0.45, alphaOverLife: A_IN_OUT }),
    sprite({ id: 'body', asset: A.trace06H, z: 1, sizeX: 200, sizeY: o.w, anchor: LEFT, alpha: 0.95, tint: o.body, blend: 'add', duration: 0.45, alphaOverLife: A_IN_OUT }),
    sprite({ id: 'core', asset: A.trace02H, z: 2, sizeX: 200, sizeY: o.w * 0.5, anchor: LEFT, alpha: 1, tint: o.core, blend: 'add', duration: 0.45, alphaOverLife: A_IN_OUT })
  ];
}

/* ---------- beam-light：聖光光束 ---------- */
P['beam-light'] = () => ({
  id: 'beam-light', duration: 0.45,
  layers: beam({ w: 10, body: '#fffef4', core: '#ffffff', glow: '#ffe47a' })
});

/* ---------- beam-ice：寒冰槍光束（帶白色斜紋） ---------- */
P['beam-ice'] = () => ({
  id: 'beam-ice', duration: 0.45, layers: [
    ...beam({ w: 8, body: '#4da6ff', core: '#f2fbff', glow: '#79d8ff' }),
    /* 斜紋：uvScroll 讓條紋沿光束流動（Core 目前唯一的程序化效果） */
    kit.procedural({
      id: 'streaks', asset: A.lines4, z: 3, effect: 'uvScroll', sizePx: [200, 8],
      anchor: LEFT, alpha: 0.7, tint: '#f2fbff', blend: 'add',
      scrollSpeed: { x: -2.4, y: 0 }, duration: 0.45,
      alphaOverLife: [[0, 0], [0.25, 0.8], [0.7, 0.7], [1, 0]]
    })
  ]
});

/* ---------- 寫出 + 驗證 ---------- */
const ORDER = ['bolt-sky-lightning', 'bolt-sky-purple', 'bolt-chain-lightning', 'bolt-curtain-lightning',
  'pillar-light', 'pillar-earth', 'beam-light', 'beam-ice'];
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
