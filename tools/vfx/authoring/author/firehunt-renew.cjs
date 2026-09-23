'use strict';
/* 火狩環繞體（母體＋伴生的雙色組合，配色由 Skills2 表決定哪一組用在哪裡：母體＝本體欄飛行子彈、伴生＝觸發子彈）：
     orb-firehunt ＋ orb-firehunt-companion                  黃＋藍（第一～七階、無限星環）
     orb-firehunt-solar ＋ orb-firehunt-solar-companion      紫＋紅（烈陽星環）
     orb-firehunt ＋ orb-firehunt-firegod-companion          黃＋青（火神降臨：它那一列的飛行子彈是普攻星環，母體照第一階）
   2026-09-23 Claude 依使用者回饋重做：舊版兩層 35～54px 的火團拖尾每秒 120 顆、加法疊成粉白一片，火頭不突出。
   座標：+X＝前進方向；火狩本體半徑＝authored 20，Runtime 以 scale＝orbR/20 縮放、逐幀把朝向設成畫面切線。

   拖尾的關鍵：Core 不在一幀內內插出生位置，同一幀發的粒子疊在同一點，所以拖尾的間距＝每幀位移。
   用沿切線方向的細光條（世界座標粒子出生時繼承特效朝向），長度蓋過每幀位移，才會連成平滑的一條而不是一顆顆蓋章。

   node tools/vfx/authoring/author/firehunt-renew.cjs          寫兩個母體（黃、紫）
   node tools/vfx/authoring/author/firehunt-companion.cjs      寫三個伴生（藍、紅、青） */
const kit = require('../preset-kit.cjs');

const P = 'particle-pack/png-black-background/';
const TRACE = P + 'rotated/trace_07_rotated.png';     // 柔邊光條：墨量 寬 0.65、高 0.139
const COMET = P + 'rotated/muzzle_02_rotated.png';    // 左端圓亮、往右張開；轉 180° 後亮端朝前
const DOT = P + 'circle_05.png';                      // 柔點：墨量直徑 0.46
/* 透明底版的 RGB 往邊緣變暗（半徑 96 處只剩 126），normal 混色疊在亮光上會描出一圈較暗的光圈 */
const DOT_T = 'particle-pack/png-transparent/circle_05.png';
const FIRE = P + 'fire_01.png';
const WISP = P + 'flame_04.png';
const q = (px) => +(px / 512).toFixed(5);            // 方框邊長（authored px）→ scale

const PALETTES = {
  fire: {
    core: '#fff6d8', fire: '#ffc85a', comet: '#ff9a2e', halo: '#ff6418',
    trail: [[0, '#fff2b8'], [0.3, '#ffcc48'], [0.65, '#ff7a20'], [1, '#c8242c']],
    glow: [[0, '#ff8a2a'], [1, '#9c1630']],
    spark: [[0, '#fff0c0'], [0.4, '#ffb040'], [1, '#ff4a18']],
    wisp: [[0, '#ffb848'], [1, '#d42e1c']], lick: '#ff8a28', trailK: 1
  },
  /* 烈陽星環的母體：與黃色母體同一套加法畫法，換成紫色 */
  purple: {
    core: '#f8ecff', fire: '#d890ff', comet: '#b050ff', halo: '#8a28ff',
    trail: [[0, '#f4e0ff'], [0.3, '#d890ff'], [0.65, '#9a40f0'], [1, '#5a1498']],
    glow: [[0, '#a048ff'], [1, '#4a1070']],
    spark: [[0, '#f8e8ff'], [0.4, '#d090ff'], [1, '#8a3cf0']],
    wisp: [[0, '#d088ff'], [1, '#6a1eb8']], lick: '#b060ff', trailK: 1
  },
  /* 伴生（2026-09-23 第二版）：火狩一多時，加法的藍白核心與拖尾疊成一整圈白環、分不清首尾。
     比照火神降臨的做法——加法層的紅色成分壓到 ≤ 10（拖尾尾端 ≤ 42 且已淡出），再怎麼疊只會飽和成青藍、到不了白；
     核心與火星改透明底 normal 混色，核心的暗邊光圈把每一團的頭和拖尾分開。 */
  blue: {
    core: '#d6ecff', fire: '#0a9cff', comet: '#0a6cff', halo: '#0048ff',
    trail: [[0, '#0ae0ff'], [0.3, '#0aa8ff'], [0.65, '#0a5aff'], [1, '#2a14c8']],
    glow: [[0, '#0a4cff'], [1, '#200a9c']],
    spark: [[0, '#e0f4ff'], [0.4, '#8cc4ff'], [1, '#4a5cff']],
    wisp: [[0, '#0aa0ff'], [1, '#2a2ad8']], lick: '#0a78ff',
    solidCore: true,
    /* 伴生是配角，而且緊跟母體走同一條軌道：藍拖尾疊在火拖尾上會變白。壓到一半，火色本體才是主角 */
    trailK: 0.5
  },
  /* 烈陽星環的伴生：同藍色伴生的做法，加法層的綠、藍成分 ≤ 10，疊多只飽和成紅橘 */
  red: {
    core: '#ffd4cc', fire: '#ff400a', comet: '#ff280a', halo: '#d00a0a',
    trail: [[0, '#ff700a'], [0.3, '#ff400a'], [0.65, '#d0160a'], [1, '#6e0a0a']],
    glow: [[0, '#ff200a'], [1, '#600a0a']],
    spark: [[0, '#ffe0d4'], [0.4, '#ff7a5a'], [1, '#c81e14']],
    wisp: [[0, '#ff480a'], [1, '#900a0a']], lick: '#ff300a',
    solidCore: true, trailK: 0.5
  },
  /* 火神降臨的伴生：加法層的紅色成分 ≤ 10，偏綠的青色，和藍色伴生分得開 */
  cyan: {
    core: '#d4fff6', fire: '#0affd8', comet: '#0ae0c8', halo: '#0aa8b0',
    trail: [[0, '#0afff0'], [0.3, '#0af0d4'], [0.65, '#0ab4c0'], [1, '#0a6480']],
    glow: [[0, '#0ac0c8'], [1, '#0a4a64']],
    spark: [[0, '#e0fff8'], [0.4, '#7af0e0'], [1, '#20a8b8']],
    wisp: [[0, '#0af0d0'], [1, '#0a78a0']], lick: '#0af0d0',
    solidCore: true, trailK: 0.5
  }
};

function layersFor(c) {
  const k = (a) => +(a * c.trailK).toFixed(3);
  return [
    /* ---- 拖尾（世界座標：留在路徑上，不跟著火頭走） ---- */
    { id: 'trail-glow', type: 'particle', assetId: DOT, zIndex: 0, alpha: k(0.3), blendMode: 'add',
      duration: 1, emission: { mode: 'rate', rate: 36 }, lifetime: [0.3, 0.3],
      spawn: { shape: 'point' }, speed: [0, 0], startScale: [q(52), q(52)], worldSpace: true,
      tintOverLife: c.glow, alphaOverLife: [[0, 1], [0.5, 0.7], [1, 0]], scaleOverLife: [[0, 0.8], [1, 1.25]] },
    { id: 'trail-core', type: 'particle', assetId: TRACE, zIndex: 1, alpha: k(0.9), blendMode: 'add',
      duration: 1, emission: { mode: 'rate', rate: 36 }, lifetime: [0.26, 0.26],
      spawn: { shape: 'point' }, speed: [0, 0], startScale: [q(58), q(58)], worldSpace: true,
      tintOverLife: c.trail, alphaOverLife: [[0, 1], [0.55, 0.8], [1, 0]], scaleOverLife: [[0, 1], [1, 0.4]] },
    /* 隨機旋轉、大小不一的小火苗與不規則火星：讓拖尾有火的質地，但不排成蓋章的樣子 */
    { id: 'trail-wisps', type: 'particle', assetId: WISP, zIndex: 2, alpha: k(0.45), blendMode: 'add',
      duration: 1, emission: { mode: 'rate', rate: 18 }, lifetime: [0.14, 0.26],
      spawn: { shape: 'circle', radius: 4 }, speed: [5, 20], direction: 180, spread: 60,
      startScale: [q(22), q(30)], rotationStart: [0, 6.28], rotationSpeed: [-5, 5], worldSpace: true,
      tintOverLife: c.wisp, alphaOverLife: [[0, 0], [0.25, 1], [1, 0]], scaleOverLife: [[0, 0.6], [0.5, 1], [1, 0.7]] },
    { id: 'trail-sparks', type: 'particle', assetId: c.solidCore ? DOT_T : DOT, zIndex: 3, alpha: 1, blendMode: c.solidCore ? 'normal' : 'add',
      duration: 1, emission: { mode: 'rate', rate: 10 }, lifetime: [0.15, 0.5],
      spawn: { shape: 'circle', radius: 8 }, speed: [10, 90], direction: 180, spread: 200, drag: 2,
      startScale: [q(5), q(11)], worldSpace: true,
      tintOverLife: c.spark, alphaOverLife: [[0, 1], [0.7, 0.8], [1, 0]] },
    /* ---- 火頭（本地座標：跟著朝向轉） ---- */
    { id: 'head-halo', type: 'sprite', assetId: DOT, zIndex: 4, scale: { x: q(100), y: q(100) }, alpha: 0.35,
      tint: c.halo, blendMode: 'add', duration: 0.5, loop: true, scaleOverLife: [[0, 1], [0.5, 1.08], [1, 1]] },
    /* 亮端（原圖 x=0.33）轉 180° 後落在中心右方 0.17 個方框：往回挪，讓亮端對齊火狩中心 */
    { id: 'head-comet', type: 'sprite', assetId: COMET, zIndex: 5, position: { x: -14.6, y: 0 }, rotation: 3.1416,
      scale: { x: q(86), y: q(86) }, alpha: 0.95, tint: c.comet, blendMode: 'add',
      duration: 0.24, loop: true, scaleOverLife: [[0, 1], [0.5, 1.07], [1, 1]] },
    { id: 'head-licks', type: 'particle', assetId: WISP, zIndex: 6, alpha: 0.8, tint: c.lick, blendMode: 'add',
      duration: 1, emission: { mode: 'rate', rate: 16 }, lifetime: [0.1, 0.2],
      spawn: { shape: 'circle', radius: 6 }, speed: [30, 60], direction: 180, spread: 50,
      startScale: [q(22), q(30)], rotationStart: [0, 6.28], alphaOverLife: [[0, 0], [0.3, 1], [1, 0]] },
    { id: 'head-fire', type: 'sprite', assetId: FIRE, zIndex: 7, scale: { x: q(38), y: q(38) }, alpha: 0.6,
      tint: c.fire, blendMode: 'add', rotationSpeed: 7 },
    { id: 'head-core', type: 'sprite', assetId: c.solidCore ? DOT_T : DOT, zIndex: 8, scale: { x: q(26), y: q(26) }, alpha: 1,
      tint: c.core, blendMode: c.solidCore ? 'normal' : 'add' }
  ];
}

const SIZING = { shape: 'custom', widthM: 4, heightM: 4, authored: { width: 40, height: 40, radius: 20 } };
function make(id, palette) {
  return { id: id || 'orb-firehunt', duration: 1, loop: true, layers: layersFor(PALETTES[palette || 'fire']), sizing: SIZING };
}

if (require.main === module) {
  kit.write(make('orb-firehunt-solar', 'purple'));
  kit.write(make('orb-firehunt', 'fire'));
}
module.exports = { make, PALETTES };
