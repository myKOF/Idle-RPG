const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('新版技能的 7 米距離換算為 70 個系統距離單位', () => {
  const context = { Math, console, isFinite };
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);
  vm.runInContext(read('js/battlefield.js'), context, { filename: 'js/battlefield.js' });

  assert.equal(context.BF_SYSTEM_UNITS_PER_METER, 10);
  assert.equal(context.bfMeterPx(7), 70);
  assert.equal(context.bfMeleeRange(), 50);
});

test('六組新版技能均以普攻近戰距離啟動', () => {
  const skills = read('js/skills.js');
  const skills2 = read('js/skills2.js');

  assert.match(skills, /bfPlayerCanReach\(target\)/);
  assert.match(skills2, /var reachable = rawPool\.filter\(function \(e\) \{[\s\S]*bfPlayerCanReach\(e\)/);
  const knifeStart = skills2.indexOf('function sgCastKnife');
  const galeStart = skills2.indexOf('function sgCastGale');
  assert.ok(knifeStart >= 0 && galeStart > knifeStart);
  assert.doesNotMatch(skills2.slice(knifeStart, galeStart), /bfRangedRange/);
});

test('新版技能的特殊性質都有明確 VFX variant', () => {
  const skills2 = read('js/skills2.js');
  const vfx = read('js/vfx.js');
  const renderer = read('js/battle-renderer.js');
  const css = read('css/style.css');

  for (const variant of [
    'thrust-pierce', 'thrust-parallel', 'thrust-octagonal', 'cleave-shockwave', 'cleave-cross', 'cleave-cross-shockwave', 'knife', 'knife-bounce',
    'gale-slashes', 'bleed-tick', 'poison-tick', 'blood-explosion',
    'zero-infection', 'dual-storm'
  ]) {
    assert.ok(skills2.includes("'" + variant + "'") || skills2.includes('"' + variant + '"'), variant);
  }

  for (const variant of [
    'thrust-pierce', 'thrust-parallel', 'thrust-octagonal', 'cleave-shockwave', 'cleave-back', 'cleave-dual', 'cleave-cross', 'cleave-cross-shockwave', 'knife', 'knife-bounce',
    'gale-slashes', 'bleed-tick', 'poison-tick', 'blood-explosion',
    'zero-infection', 'cyclone'
  ]) {
    assert.ok(vfx.includes(variant), variant + ' DOM VFX');
    if (variant === 'bleed-tick' || variant === 'poison-tick') {
      assert.match(renderer, /case 'impact':[\s\S]*spawnImpact/,
        variant + ' Pixi impact theme');
    } else {
      assert.ok(renderer.includes(variant), variant + ' Pixi VFX');
    }
  }

  assert.match(vfx, /vfxThrustLine\([\s\S]*?thrustLength/);
  assert.match(renderer, /spawnThrustLine\([\s\S]*?thrustLength/);
  assert.match(css, /\.vfx-thrust-line[\s\S]*?@keyframes vfxThrustLine/);
  assert.match(css, /\.vfx-proj-knife/);
  assert.match(vfx, /projClass === 'vfx-proj-knife'[\s\S]*?spec\.glyph/);
  assert.match(renderer, /spec\.variant === 'knife'[\s\S]*?spec\.variant === 'knife-bounce'/);
  assert.match(css, /\.vfx-proj-knife \.vfx-proj-core[\s\S]*?background: none/);
  assert.match(vfx, /function vfxCleaveArc\([\s\S]*?travel\)/);
  assert.match(vfx, /vfxCleaveArc\([\s\S]*?length: 120/);
  assert.match(vfx, /vfxCleaveArc\([\s\S]*?vfx-cleave-arc-back[\s\S]*?length: 120/);
  assert.match(renderer, /spawnCleaveArc\([\s\S]*?frontAngle \+ Math\.PI[\s\S]*?length: 120/);
  assert.doesNotMatch(vfx, /vfxCleaveWave|vfx-cleave-wave/);
  assert.doesNotMatch(renderer, /spawnCleaveWave|CLEAVE_WAVE_SPEED_RATIO/);
  assert.match(vfx, /vfxImpact\([\s\S]*?cHitDelay \+ 90/);
  assert.match(renderer, /spawnImpact\(pt\.x, pt\.y, spec, false\)/);
  const vfxCleaveStart = vfx.indexOf("if (kind === 'slash' && (s.variant === 'cleave'");
  const vfxCleaveEnd = vfx.indexOf('\n    return;', vfxCleaveStart);
  const rendererCleaveStart = renderer.indexOf("if (spec.variant === 'cleave'");
  const rendererCleaveEnd = renderer.indexOf('\n          break;', rendererCleaveStart);
  assert.ok(vfxCleaveStart >= 0 && vfxCleaveEnd > vfxCleaveStart);
  assert.ok(rendererCleaveStart >= 0 && rendererCleaveEnd > rendererCleaveStart);
  assert.doesNotMatch(vfx.slice(vfxCleaveStart, vfxCleaveEnd), /vfxSlash\(/);
  assert.doesNotMatch(renderer.slice(rendererCleaveStart, rendererCleaveEnd), /spawnSlash\(/);
});

test('震碎斬與迴身雙連斬共用十字方向的迴旋斬弧光', () => {
  const skills2 = read('js/skills2.js');
  const cleaveStart = skills2.indexOf('function sgCastCleave');
  const cleaveEnd = skills2.indexOf('\n}\n\n/* ---- 匕首投擲', cleaveStart);
  const cleaveBlock = skills2.slice(cleaveStart, cleaveEnd);

  assert.match(cleaveBlock, /lvs\[6\] > 0 \? \(lvs\[5\] > 0 \? 'cleave-cross-shockwave' : 'cleave-cross'\)/);
  assert.match(cleaveBlock, /lvs\[5\] > 0 \? 'cleave-shockwave'/);
  assert.match(read('css/style.css'), /\.vfx-cleave-arc-back/);
  assert.doesNotMatch(read('css/style.css'), /\.vfx-cleave-wave/);
});

test('迴旋斬刀光線寬在 DOM 與 Canvas 都提高 30%', () => {
  const css = read('css/style.css');
  const renderer = read('js/battle-renderer.js');

  assert.match(css, /\.vfx-cleave-arc::before[\s\S]*?border: 7\.8px solid transparent/);
  assert.match(css, /\.vfx-cleave-arc::after[\s\S]*?border-width: 2\.6px/);
  assert.match(renderer, /theme\.c1, width: 14\.3 \* fade/);
  assert.match(renderer, /theme\.c2, width: 5\.2 \* fade/);
});

test('震碎斬距離使用 12 米（120 系統距離單位）', () => {
  const skills2 = read('js/skills2.js');
  const csv = read('config/CSV/Skills2.csv');
  const cleaveCsvLine = csv.split(/\r?\n/).find((line) => line.includes(',6,震碎斬,'));
  assert.match(skills2, /name: '震碎斬', fx: \{ m: 12, mPer: 0\.5 \}/);
  assert.ok(cleaveCsvLine && cleaveCsvLine.includes('""m"":12'), 'Skills2 CSV 應使用 12 米');
  assert.match(read('js/battlefield.js'), /BF_SYSTEM_UNITS_PER_METER = 10/);
});

test('飛出斬擊與貫穿突刺由飛行物命中，不由 VFX 預先產生受擊爆點', () => {
  const skills2 = read('js/skills2.js');
  const vfx = read('js/vfx.js');
  const renderer = read('js/battle-renderer.js');

  assert.match(skills2, /variant: thrustVariant, count: Math\.min\(8, thrustCount\), projectile: isPiercing/);
  assert.match(skills2, /variant: cleaveVariant, count: Math\.min\(5, slashes\), projectile: lvs\[5\] > 0/);
  const thrustVfx = vfx.slice(vfx.indexOf("s.variant === 'thrust-pierce'"), vfx.indexOf("s.variant === 'cleave'"));
  const thrustRenderer = renderer.slice(renderer.indexOf("spec.variant === 'thrust-pierce'"), renderer.indexOf("spec.variant === 'cleave'"));
  assert.match(thrustVfx, /if \(!s\.projectile\)/);
  assert.match(thrustRenderer, /if \(!spec\.projectile\)/);
  const cleaveVfx = vfx.slice(vfx.indexOf("s.variant === 'cleave'"), vfx.indexOf("s.variant === 'gale-slashes'"));
  const cleaveRenderer = renderer.slice(renderer.indexOf("spec.variant === 'cleave'"), renderer.indexOf("spec.variant === 'gale-slashes'"));
  assert.match(cleaveVfx, /if \(!s\.projectile\)/);
  assert.match(cleaveRenderer, /if \(!spec\.projectile\)/);
});

test('突刺光槍 VFX 使用確認的 PNG 素材並保留 DOM／Canvas 退化畫法', () => {
  const css = read('css/style.css');
  const renderer = read('js/battle-renderer.js');
  const thrustCss = css.slice(css.indexOf('.vfx-thrust-line {'), css.indexOf('@keyframes vfxThrustLine'));
  const thrustRenderer = renderer.slice(renderer.indexOf('function spawnThrustLine'), renderer.indexOf('/* 光束 */'));

  assert.match(thrustCss, /images\/vfx\/thrust_lance\.png/);
  assert.match(thrustCss, /var\(--vfx-length/);
  assert.match(thrustCss, /mask-image: linear-gradient/);
  assert.match(css, /@keyframes vfxThrustFlight/);
  assert.match(css, /@property --vfx-reveal-end/);
  assert.match(thrustCss, /rotate\(calc\(var\(--vfx-angle/);
  assert.ok(fs.statSync(path.join(root, 'images/vfx/thrust_lance.png')).size > 1000, '突刺 PNG 素材應存在');
  assert.match(renderer, /PIXI\.Assets\.load\('images\/vfx\/thrust_lance\.png\?v=20260815-narrow-rect'\)/);
  assert.match(thrustRenderer, /if \(S\.thrustLanceTex\)/);
  assert.match(thrustRenderer, /g\.poly\(/);
  assert.match(thrustRenderer, /revealMask\.rect/);
  assert.match(thrustRenderer, /isFinal \? lineLength/);
});

test('突刺 VFX 會保留實際長度與完整段數上限', () => {
  const skills2 = read('js/skills2.js');
  const vfx = read('js/vfx.js');
  const renderer = read('js/battle-renderer.js');
  const shim = read('js/worker/shim.js');

  assert.match(skills2, /第 1 階兩次；第 7 階再加三次；第 2 階觸發時再加兩次/);
  assert.match(skills2, /var isParallel = lvs\[3\] > 0/);
  assert.match(shim, /lineLength: Number\(spec\.lineLength\) > 0/);
  assert.match(shim, /lineWidth: Number\(spec\.lineWidth\) > 0/);
  assert.match(shim, /laneOffsets: Array\.isArray\(spec\.laneOffsets\)/);
  assert.match(shim, /directionCount: Number\(spec\.directionCount\) > 0/);
  assert.match(shim, /projectile: !!spec\.projectile/);
  assert.match(vfx, /var isThrust = spec\.variant === 'thrust'/);
  assert.match(renderer, /var isThrust = spec\.variant === 'thrust'/);
});
