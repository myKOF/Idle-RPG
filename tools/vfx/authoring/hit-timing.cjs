'use strict';

// 僅處理受擊家族；hit-gale-burst 是技能攻擊本體，不套用這份節奏。
const IDS = ['hit-phys', 'hit-fire', 'hit-ice', 'hit-lightning', 'hit-poison',
  'hit-light', 'hit-dark', 'hit-earth', 'hit-wind', 'hit-bleed',
  'hit-fire-explosion', 'hit-thunder-purple', 'hit-enemy'];
const HEAVY = new Set(['hit-fire-explosion', 'hit-thunder-purple']);
const round = n => +n.toFixed(6);
function scaleValue(v, k) {
  return Array.isArray(v) ? v.map(n => round(n * k)) : round(v * k);
}
function shorten(preset) {
  const p = JSON.parse(JSON.stringify(preset));
  if (!IDS.includes(p.id)) return p;
  const total = HEAVY.has(p.id) ? 0.22 : 0.14;
  if (p.duration <= total) return p;
  const factor = total / p.duration;
  for (const l of p.layers) {
    l.delay = round((l.delay || 0) * factor);
    l.duration = round((l.duration || p.duration) * factor);
    if (l.type === 'particle') {
      l.lifetime = scaleValue(l.lifetime, factor);
      // 時間縮短時保留原有散射距離與彈道。
      for (const k of ['speed', 'rotationSpeed', 'orbitalSpeed', 'radialSpeed', 'drag']) {
        if (l[k] !== undefined) l[k] = scaleValue(l[k], 1 / factor);
      }
      if (l.gravity) for (const k of ['x', 'y']) l.gravity[k] = round((l.gravity[k] || 0) / (factor * factor));
      l.alphaOverLife = [[0,1],[0.2,0.65],[0.6,0.2],[1,0]];
    } else if (l.id === 'flash') {
      l.delay = Math.min(l.delay, 0.015);
      l.duration = Math.min(l.duration, 0.05 - l.delay);
      l.alphaOverLife = [[0,0],[0.12,1],[0.4,0.45],[1,0]];
    } else {
      l.alphaOverLife = [[0,0],[0.1,1],[0.35,0.55],[0.7,0.15],[1,0]];
    }
    if (l.sheet && l.sheet.mode === 'fps' && l.sheet.fps) l.sheet.fps = round(l.sheet.fps / factor);
  }
  p.duration = total;
  return p;
}
module.exports = { IDS, HEAVY, shorten };
