'use strict';
/* probe-summary.cjs — 把 author/*.cjs 的 JSON 輸出壓成一行一個 preset 的核對表。
   用法：node tools/vfx/authoring/author/<family>.cjs | node tools/vfx/authoring/probe-summary.cjs */
let s = '';
process.stdin.on('data', d => (s += d)).on('end', () => {
  const o = JSON.parse(s);
  o.probes.forEach(p => console.log(
    p.id.padEnd(26), '層' + String(p.layers).padStart(2),
    'bbox x[' + p.bbox.x + '] y[' + p.bbox.y + ']',
    '粒子' + p.maxParticles, p.loop ? 'loop' : ''
  ));
  console.log('---- ' + o.written.length + ' 份，素材 ' + o.assetsUsed.length + ' 個');
});
