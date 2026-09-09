'use strict';
/* 座標 → 米制本體契約。只補 metadata，不重採樣圖層或改動曲線。
   明確尺寸優先；其他圓／方／長方採 Runtime 的 SIZE_DEFAULTS。
   authored 是舊製作座標的本體基準，光暈與粒子不計入。 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const Core = require(root + '/js/vfx-core.js');
const Runtime = require(root + '/js/vfx-runtime.js');
const catalog = require('./vfx-catalog.cjs').PRESETS;
const circle = (r, radiusM, projectile) => Object.assign({
  shape: projectile ? 'projectile-circle' : 'circle', authored: { radius: r }
}, radiusM === undefined ? {} : { radiusM });
const rect = (w, h, widthM, heightM, shape = 'rectangle') => Object.assign({
  shape, authored: { width: w, height: h }
}, widthM === undefined ? {} : { widthM, heightM });
const custom = (w, h, widthM = w / 10, heightM = h / 10) => rect(w, h, widthM, heightM, 'custom');

// 不規則外觀各自定義；投射物的飛行距離絕不是物體長度。
const overrides = {
  'slash-thrust-lance': rect(120, 30, 12, 3),
  'slash-thrust-empowered': rect(120, 30, 12, 3),
  'slash-thrust-scatter': rect(120, 30, 12, 3),
  'proj-knife': custom(28, 10, 6, 2),
  'proj-knife-gold': custom(28, 10, 6, 2),
  'proj-swordwave': custom(30, 30),
  'proj-ice-shard': custom(22, 18, 6, 2),
  'proj-lightning': custom(26, 10),
  'proj-poison-drop': custom(15, 17),
  'proj-earth-rock': rect(33, 33, undefined, undefined, 'projectile-square'),
  'proj-wind-crescent': custom(96, 104, 4, 8),
  'proj-fireball': circle(42.5, undefined, true),
  'ground-blizzard': rect(200, 100, 20, 20, 'square'),
  'ground-thunder-orb': circle(30, 3, true),
  'ground-homing-ice-shard': custom(30, 30, 3, 3),
  'ground-homing-wind-crescent': custom(30, 30, 3, 6),
  'orb-void-disc': circle(24, 3, true),
  'orb-thunder': circle(20, 3, true),
  'orb-firehunt': circle(20, undefined, true)
};
for (const element of ['fire', 'water', 'wind']) {
  overrides['ground-tornado-' + element] = {
    shape: 'custom', widthM: 10, heightM: 21,
    authored: { width: 56, height: 118, radius: 28 }
  };
}

function sizingFor(id) {
  if (overrides[id]) return overrides[id];
  const p = catalog[id];
  if (!p) return null; // Editor 的測試／示範 preset 不屬技能目錄
  const n = p.nominal || '';
  if (/^(body|target) /.test(n) || p.family === 'status' || p.family === 'curse' || p.family === 'cast') {
    return custom(60, 60); // 人物附著效果：獨立身形座標，不是地面判定圓
  }
  let m = /^rect (\d+)x(\d+)/.exec(n);
  if (m) return rect(+m[1], +m[2]);
  m = /^[Rr] (\d+)/.exec(n);
  if (m) {
    if (p.family === 'slash') return custom(+m[1] * 2, +m[1] * 2);
    return circle(+m[1], undefined, p.family === 'projectile' || p.family === 'orb');
  }
  m = /^D (\d+)/.exec(n);
  if (m) return circle(+m[1] / 2, undefined, true);
  if (p.family === 'bolt') {
    const horizontal = /^L /.test(n);
    return custom(horizontal ? 200 : 60, horizontal ? 30 : Number(n.match(/\d+/)[0]));
  }
  if (id === 'slash-wind-crescent') return custom(88, 96, 6, 6);
  throw new Error('需單獨定義尺寸：' + id);
}
function apply() {
  let count = 0;
  for (const file of fs.readdirSync(root + '/vfx/presets').filter(f => f.endsWith('.json'))) {
    const dest = root + '/vfx/presets/' + file;
    const p = JSON.parse(fs.readFileSync(dest, 'utf8'));
    const sizing = p.sizing || sizingFor(p.id);
    if (!sizing) continue;
    Runtime.resolveSizing(sizing);
    p.sizing = sizing;
    const text = Core.serialisePreset(p);
    if (text !== fs.readFileSync(dest, 'utf8')) { fs.writeFileSync(dest, text); count++; }
  }
  console.log('尺寸契約更新：' + count);
}
if (require.main === module) apply();
module.exports = { sizingFor };
