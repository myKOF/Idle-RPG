'use strict';
// 編輯器存檔為準：只更新繞行曲線，保留透明度、尺寸與位置。
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '../../../../vfx/presets/ground-storm-dance.json');
const preset = JSON.parse(fs.readFileSync(file, 'utf8'));
const cones = preset.layers.filter(l => l.id.startsWith('tapered-cone-'));
const centerX = cones.reduce((n, l) => n + l.position.x, 0) / cones.length;
const centerY = cones.reduce((n, l) => n + l.position.y, 0) / cones.length;
const projection = 0.38;
for (const l of cones) {
  const x = l.position.x - centerX, y = (l.position.y - centerY) / projection;
  const radius = Math.hypot(x, y), phase = Math.atan2(y, x);
  l.offsetXOverLife = [];
  l.offsetYOverLife = [];
  // 細分橢圓，首尾固定零偏移，循環接縫不跳動。
  for (let i = 0; i <= 15; i++) {
    const t = i / 15, a = phase + t * Math.PI * 2;
    l.offsetXOverLife.push([t, i === 0 || i === 15 ? 0 : +(radius * Math.cos(a) - x).toFixed(5)]);
    l.offsetYOverLife.push([t, i === 0 || i === 15 ? 0 : +((radius * Math.sin(a) - y) * projection).toFixed(5)]);
  }
}
preset.duration = 24;
const result = require('../../../../js/vfx-core.js').validatePreset(preset);
if (!result.ok) throw new Error(result.errors.join('\n'));
fs.writeFileSync(file, JSON.stringify(preset, null, 2) + '\n');
console.log('暴風光壁：24秒一圈，保留編輯器外觀調整');
