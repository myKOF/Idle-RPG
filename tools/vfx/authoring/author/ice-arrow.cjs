'use strict';
/* ============================================================
   ice-arrow.cjs — 寒冰箭與寒冰爆裂箭特效製作腳本
   依照企劃文檔與參考圖製作：
   1. proj-ice-shard: 1階 寒冰箭（冰錐造型、後方冰霧粒子拖尾、藍白色系）
   2. burst-ice-blast: 7階 寒冰爆裂箭（由中心向外爆發出冰刺爆破、藍白色系）
   3. ground-homing-ice-shard: 追蹤冰箭本體（與寒冰箭同款立體冰錐與脈動光暈）
   ============================================================ */

const kit = require('../preset-kit.cjs');

/* ============================================================
   1. proj-ice-shard (寒冰箭 飛行子彈)
   ============================================================ */
function makeProjIceShard() {
  return {
    id: 'proj-ice-shard',
    duration: 1.2,
    loop: false,
    sizing: {
      authored: { width: 50, height: 24 },
      shape: 'custom',
      widthM: 6,
      heightM: 2
    },
    layers: [
      // 1. 底層柔和藍光光暈
      kit.sprite({
        id: 'glow-outer',
        asset: kit.A.glowSoft,
        zIndex: 0,
        sizeX: 84,
        sizeY: 46,
        alpha: 0.6,
        tint: '#79d8ff',
        blend: 'add',
        duration: 1.2,
        alphaOverLife: [[0, 0], [0.06, 0.95], [0.9, 0.9], [1, 0]]
      }),
      // 2. 冰箭尾流細流
      kit.sprite({
        id: 'streak-core',
        asset: 'new_materials/streak/lines_1.png',
        zIndex: 1,
        x: -24,
        y: 0,
        sizeX: 54,
        sizeY: 18,
        alpha: 0.65,
        tint: '#38bdf8',
        blend: 'add',
        duration: 1.2,
        alphaOverLife: [[0, 0], [0.06, 0.9], [0.9, 0.9], [1, 0]]
      }),
      // 3. 冰錐造型箭體本體（normal 混色保留立體刻面陰影與高光）
      kit.sprite({
        id: 'ice-spike-body',
        asset: 'antigravity-authored/ice/ice-arrow-spike.png',
        zIndex: 2,
        x: 0,
        y: 0,
        sizeX: 66,
        sizeY: 33,
        alpha: 1.0,
        tint: '#ffffff',
        blend: 'normal',
        duration: 1.2,
        alphaOverLife: [[0, 0], [0.05, 1.0], [0.92, 1.0], [1, 0]]
      }),
      // 4. 冰錐表面冰晶亮面（add 混色提供晶瑩透亮光澤）
      kit.sprite({
        id: 'ice-spike-shine',
        asset: 'antigravity-authored/ice/ice-arrow-spike.png',
        zIndex: 3,
        x: 0,
        y: 0,
        sizeX: 64,
        sizeY: 32,
        alpha: 0.7,
        tint: '#e0f7ff',
        blend: 'add',
        duration: 1.2,
        alphaOverLife: [[0, 0], [0.05, 0.9], [0.92, 0.9], [1, 0]]
      }),
      // 5. 箭尖高光星芒閃耀點
      kit.sprite({
        id: 'tip-sparkle',
        asset: kit.A.star08,
        zIndex: 4,
        x: 30,
        y: 0,
        size: 20,
        alpha: 0.9,
        tint: '#ffffff',
        blend: 'add',
        duration: 1.2,
        alphaOverLife: [[0, 0], [0.08, 1.0], [0.92, 0.9], [1, 0]]
      }),
      // 6. 冰霧粒子拖尾特效（後方跟著藍白色冰霧）
      kit.particle({
        id: 'mist-trail',
        asset: 'particle-pack/png-transparent/smoke_04.png',
        zIndex: 1,
        tint: '#e0f2fe',
        blend: 'normal',
        emission: { mode: 'rate', rate: 26 },
        lifetime: [0.2, 0.38],
        spawn: { shape: 'circle', radius: 5 },
        position: { x: -16, y: 0 },
        speed: [25, 55],
        direction: 180,
        spread: 35,
        drag: 3,
        startScale: [kit.px(28), kit.px(48)],
        scaleOverLife: [[0, 0.6], [0.4, 1.0], [1, 1.5]],
        alphaOverLife: [[0, 0], [0.2, 0.5], [0.6, 0.28], [1, 0]],
        tintOverLife: [[0, '#f0f9ff'], [0.5, '#bae6fd'], [1, '#7dd3fc']]
      }),
      // 7. 冰晶火花與碎屑拖尾
      kit.particle({
        id: 'crystal-dust',
        asset: kit.A.dot,
        zIndex: 5,
        tint: '#7dd3fc',
        blend: 'add',
        emission: { mode: 'rate', rate: 30 },
        lifetime: [0.16, 0.32],
        spawn: { shape: 'circle', radius: 5 },
        position: { x: -10, y: 0 },
        speed: [35, 85],
        direction: 180,
        spread: 45,
        drag: 4,
        startScale: [kit.px(5), kit.px(10)],
        scaleOverLife: [[0, 1], [1, 0.25]],
        alphaOverLife: [[0, 0.95], [0.6, 0.75], [1, 0]],
        tintOverLife: [[0, '#ffffff'], [0.4, '#7dd3fc'], [1, '#0284c7']]
      })
    ]
  };
}

/* ============================================================
   2. burst-ice-blast (寒冰爆裂箭 冰爆特效)
   ============================================================ */
function makeBurstIceBlast() {
  return {
    id: 'burst-ice-blast',
    duration: 0.65,
    loop: false,
    sizing: {
      authored: { radius: 100 },
      shape: 'circle'
    },
    layers: [
      // 1. 地面／空間擴散的圓形冰爆震波環
      kit.sprite({
        id: 'shockwave-ring',
        asset: kit.A.ringThin,
        zIndex: 1,
        size: 260,
        alpha: 0.95,
        tint: '#79d8ff',
        blend: 'add',
        duration: 0.55,
        alphaOverLife: [[0, 0], [0.08, 1.0], [0.5, 0.6], [1, 0]],
        scaleOverLife: [[0, 0.12], [0.4, 0.88], [1, 1.08]]
      }),
      // 2. 外層細緻冰霜雙重衝擊環
      kit.sprite({
        id: 'frost-wave-outer',
        asset: kit.A.ringB,
        zIndex: 2,
        size: 240,
        alpha: 0.85,
        tint: '#e0f2fe',
        blend: 'add',
        duration: 0.52,
        alphaOverLife: [[0, 0.9], [0.35, 0.5], [1, 0]],
        scaleOverLife: [[0, 0.08], [0.5, 0.9], [1, 1.04]]
      }),
      // 3. 中心向外迅速膨脹並擴散的極寒白藍凍氣雲
      kit.sprite({
        id: 'frost-cloud-mist',
        asset: 'particle-pack/png-transparent/smoke_04.png',
        zIndex: 3,
        size: 250,
        alpha: 0.55,
        tint: '#f0f9ff',
        blend: 'normal',
        duration: 0.65,
        alphaOverLife: [[0, 0], [0.1, 0.65], [0.45, 0.35], [1, 0]],
        scaleOverLife: [[0, 0.25], [0.5, 0.95], [1, 1.25]]
      }),
      // 4. 由中心向外爆發出的核心冰刺尖錐群（立體刻面本體）
      kit.sprite({
        id: 'radiating-spikes-body',
        asset: 'antigravity-authored/ice/ice-burst-spikes.png',
        zIndex: 4,
        size: 265,
        alpha: 1.0,
        tint: '#ffffff',
        blend: 'normal',
        duration: 0.62,
        alphaOverLife: [[0, 0], [0.07, 1.0], [0.55, 0.95], [1, 0]],
        scaleOverLife: [[0, 0.1], [0.18, 0.96], [0.45, 1.02], [1, 1.05]]
      }),
      // 5. 核心冰刺群加法光芒（晶瑩剔透藍白光感）
      kit.sprite({
        id: 'radiating-spikes-glow',
        asset: 'antigravity-authored/ice/ice-burst-spikes.png',
        zIndex: 5,
        size: 260,
        alpha: 0.8,
        tint: '#7dd3fc',
        blend: 'add',
        duration: 0.55,
        alphaOverLife: [[0, 0], [0.08, 0.9], [0.4, 0.45], [1, 0]],
        scaleOverLife: [[0, 0.12], [0.18, 0.96], [0.5, 1.0], [1, 1.03]]
      }),
      // 6. 中心瞬間爆裂極亮閃光
      kit.sprite({
        id: 'center-burst-flash',
        asset: kit.A.star08,
        zIndex: 6,
        size: 165,
        alpha: 1.0,
        tint: '#ffffff',
        blend: 'add',
        duration: 0.24,
        alphaOverLife: [[0, 0], [0.05, 1.0], [0.35, 0.6], [1, 0]],
        scaleOverLife: [[0, 0.3], [0.3, 1.15], [1, 0.8]]
      }),
      // 7. 360 度四向爆散的獨立冰晶尖刺粒子
      kit.particle({
        id: 'flying-ice-crystals',
        asset: 'antigravity-authored/ice/ice-spike-single.png',
        zIndex: 7,
        tint: '#f0f9ff',
        blend: 'normal',
        emission: { mode: 'burst', count: 20 },
        lifetime: [0.35, 0.55],
        spawn: { shape: 'circle', radius: 10 },
        speed: [190, 340],
        direction: 0,
        spread: 360,
        alignToVelocity: true,
        drag: 3.5,
        startScale: [kit.px(18), kit.px(30)],
        scaleOverLife: [[0, 0.4], [0.2, 1.0], [1, 0.5]],
        alphaOverLife: [[0, 1], [0.65, 0.85], [1, 0]]
      }),
      // 8. 冰爆細密碎屑與冰霜閃光火花
      kit.particle({
        id: 'frost-sparkles',
        asset: kit.A.star08,
        zIndex: 8,
        tint: '#ffffff',
        blend: 'add',
        emission: { mode: 'burst', count: 24 },
        lifetime: [0.3, 0.5],
        spawn: { shape: 'circle', radius: 12 },
        speed: [120, 260],
        direction: 0,
        spread: 360,
        drag: 3.2,
        startScale: [kit.px(12), kit.px(22)],
        scaleOverLife: [[0, 1], [1, 0.3]],
        alphaOverLife: [[0, 1], [0.6, 0.8], [1, 0]],
        tintOverLife: [[0, '#ffffff'], [0.4, '#7dd3fc'], [1, '#0284c7']]
      })
    ]
  };
}

/* ============================================================
   3. ground-homing-ice-shard (追蹤冰箭本體)
   ============================================================ */
function makeGroundHomingIceShard() {
  return {
    id: 'ground-homing-ice-shard',
    duration: 0.55,
    loop: true,
    sizing: {
      authored: { width: 40, height: 26 },
      shape: 'custom',
      widthM: 3,
      heightM: 3
    },
    layers: [
      kit.sprite({
        id: 'glow',
        asset: kit.A.glowSoft,
        zIndex: 0,
        sizeX: 58,
        sizeY: 34,
        alpha: 0.55,
        tint: '#79d8ff',
        blend: 'add',
        duration: 0.55,
        alphaOverLife: [[0, 0.45], [0.5, 0.65], [1, 0.45]],
        scaleOverLife: [[0, 1], [0.5, 1.08], [1, 1]]
      }),
      kit.sprite({
        id: 'streak',
        asset: 'new_materials/streak/lines_1.png',
        zIndex: 1,
        x: -14,
        y: 0,
        sizeX: 36,
        sizeY: 14,
        alpha: 0.55,
        tint: '#38bdf8',
        blend: 'add',
        duration: 0.55,
        alphaOverLife: [[0, 0.5], [0.5, 0.7], [1, 0.5]]
      }),
      kit.sprite({
        id: 'spike-body',
        asset: 'antigravity-authored/ice/ice-arrow-spike.png',
        zIndex: 2,
        sizeX: 44,
        sizeY: 22,
        alpha: 1.0,
        tint: '#ffffff',
        blend: 'normal',
        duration: 0.55,
        alphaOverLife: [[0, 0.95], [0.5, 1.0], [1, 0.95]]
      }),
      kit.sprite({
        id: 'spike-shine',
        asset: 'antigravity-authored/ice/ice-arrow-spike.png',
        zIndex: 3,
        sizeX: 42,
        sizeY: 21,
        alpha: 0.6,
        tint: '#e0f7ff',
        blend: 'add',
        duration: 0.55,
        alphaOverLife: [[0, 0.55], [0.5, 0.8], [1, 0.55]]
      }),
      kit.sprite({
        id: 'tip-star',
        asset: kit.A.star08,
        zIndex: 4,
        x: 20,
        y: 0,
        size: 14,
        alpha: 0.85,
        tint: '#ffffff',
        blend: 'add',
        duration: 0.55,
        scaleOverLife: [[0, 0.9], [0.5, 1.15], [1, 0.9]]
      }),
      kit.particle({
        id: 'trail-particles',
        asset: kit.A.dot,
        zIndex: 5,
        tint: '#f2fbff',
        blend: 'add',
        emission: { mode: 'rate', rate: 20 },
        lifetime: [0.18, 0.32],
        spawn: { shape: 'circle', radius: 6 },
        position: { x: -10, y: 0 },
        speed: [20, 50],
        direction: 180,
        spread: 50,
        drag: 3,
        startScale: [kit.px(4), kit.px(8)],
        scaleOverLife: [[0, 1], [1, 0.3]],
        alphaOverLife: [[0, 0.9], [1, 0]],
        tintOverLife: [[0, '#ffffff'], [0.5, '#7dd3fc'], [1, '#0284c7']]
      })
    ]
  };
}

if (require.main === module) {
  console.log('Writing proj-ice-shard...');
  console.log(kit.write(makeProjIceShard()));
  console.log('Writing burst-ice-blast...');
  console.log(kit.write(makeBurstIceBlast()));
  console.log('Writing ground-homing-ice-shard...');
  console.log(kit.write(makeGroundHomingIceShard()));
}

module.exports = {
  makeProjIceShard,
  makeBurstIceBlast,
  makeGroundHomingIceShard
};
