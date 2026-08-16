const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

/* 只載入幾何與新版技能定義：施法距離是純函式，不需要完整戰鬥環境。 */
function loadSkills2() {
  const context = { Math, console, isFinite, JSON };
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);
  ['js/battlefield.js', 'js/skills2.js'].forEach((f) => {
    vm.runInContext(read(f), context, { filename: f });
  });
  return context;
}

test('飛刀彈射必須在上一段抵達後才開始下一段', () => {
  const skills2 = read('js/skills2.js');
  const vfx = read('js/vfx.js');
  const renderer = read('js/battle-renderer.js');

  assert.match(skills2, /if \(extra && extra\.delayMs > 0\) spec\.delayMs = Number\(extra\.delayMs\);/);
  assert.match(skills2, /delayMs: chainStartDelay, travelMs: \[0, bounceTravelMs\]/);
  assert.match(skills2, /chainStartDelay \+ bounceTravelMs/);
  assert.match(skills2, /chainStartDelay \+= bounceTravelMs/);
  assert.match(skills2, /if \(!next \|\| next === cur \|\| next\.hp <= 0\) break;/);

  const domChainStart = vfx.indexOf('function vfxChain');
  const domChainEnd = vfx.indexOf('/* ---- 時間安全', domChainStart);
  const domChain = vfx.slice(domChainStart, domChainEnd);
  assert.match(domChain, /var pathStart = baseDelay;/);
  assert.match(domChain, /var pathFlight = vfxProjectileFlightMs\(pathTravel, spec\.dur \|\| 0\.5\);/);
  assert.match(domChain, /pathStart \+ pathFlight/);
  assert.match(domChain, /pathStart \+= pathFlight/);
  assert.doesNotMatch(domChain, /pathI - 1\) \* pathHop/);

  const canvasChainStart = renderer.indexOf('function handleChainVfx');
  const canvasChainEnd = renderer.indexOf('var firstId', canvasChainStart);
  const canvasChain = renderer.slice(canvasChainStart, canvasChainEnd);
  assert.match(canvasChain, /var chainStart = baseDelay;/);
  assert.match(canvasChain, /var hopTravel = projectileTravelMs\(spec\.travelMs && spec\.travelMs\[kb\], 120\);/);
  assert.match(canvasChain, /\}\)\(kb, chainStart, hopTravel\);/);
  assert.match(canvasChain, /chainStart \+= hopTravel;/);
  assert.doesNotMatch(canvasChain, /baseDelay \+ \(hopIndex - 1\) \* stagger/);
});

test('普攻觸發角色動作；飛刀彈射與連鎖不觸發，目標離場後延遲事件失效', () => {
  const renderer = read('js/battle-renderer.js');
  const onVfxStart = renderer.indexOf('function onVfx');
  const onVfxEnd = renderer.indexOf('/* ============ 傷害飄字', onVfxStart);
  const onVfx = renderer.slice(onVfxStart, onVfxEnd);

  assert.match(renderer, /function shouldAnimatePlayer\(spec\)/);
  assert.match(renderer, /spec\.cat !== 'enemy' &&\s*spec\.fxKind !== 'chain'/);
  assert.doesNotMatch(renderer, /spec\.cat !== 'enemy' && spec\.cat !== 'basic'/);
  assert.match(renderer, /spec\.fxKind !== 'chain' && spec\.variant !== 'knife-bounce'/);
  assert.match(onVfx, /if \(fxGate\(spec\)\) return;\s*spec\.delayMs = 0;/);
  assert.match(onVfx, /if \(shouldAnimatePlayer\(spec\) && vfxTargetsLive\(spec\)\)/);
  assert.doesNotMatch(onVfx, /if \(spec\.cat !== 'enemy'\) \{/);
  assert.match(renderer, /if \(spec && \(spec\.cat === 'basic' \|\| spec\.variant === 'knife-bounce'\)\)/);
  /* 失效條件只認「離場」。若把垂死（dying／hp<=0）也算失效，普攻事件因 POS_BUFFER_MS
     延後播放，會在面板把敵人標成垂死之後才到期＝擊殺的那一刀永遠丟掉自己的動作。
     行為層的回歸測試在 tests/ui-worker-events.test.cjs。 */
  assert.match(renderer, /if \(ent\.state === 'gone'\) return false;/);
  assert.doesNotMatch(renderer, /ent\.state === 'dying' \|\| ent\.state === 'gone'/);
});

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

/* 施法距離的判定必須只有一份：施放閘門（skills.js）與起手主目標篩選（skills2.js）
   都要走 skills2CanReach，任何一邊自己再算一次距離都會與另一邊漂移。
   武技沒有 castM＝退回普攻近戰距離；魔法群組吃各階表定射程。 */
test('施法距離判定收斂在 skills2CanReach，武技仍是近戰、魔法吃表定射程', () => {
  const skills = read('js/skills.js');
  const skills2 = read('js/skills2.js');

  assert.match(skills, /skills2CanReach\(sgId, ent\)/);
  assert.match(skills2, /var reachable = rawPool\.filter\(function \(e\) \{ return skills2CanReach\(gid, e, lvs\); \}\);/);
  const knifeStart = skills2.indexOf('function sgCastKnife');
  const galeStart = skills2.indexOf('function sgCastGale');
  assert.ok(knifeStart >= 0 && galeStart > knifeStart);
  assert.doesNotMatch(skills2.slice(knifeStart, galeStart), /bfRangedRange/);

  const c = loadSkills2();
  ['thrust', 'cleave', 'knife', 'gale', 'bloodblade', 'dualdance', 'counter', 'bloodrage'].forEach((gid) => {
    assert.equal(c.skills2CastRangePx(gid, c.sgEffectiveLevels(null, gid)), c.bfMeleeRange(), gid + ' 應維持近戰距離');
  });
  // 火球術射程 30 米；投資到第 7 階【殞石術】後由該階改寫為 20 米
  assert.equal(c.skills2CastRangePx('fireball', c.sgEffectiveLevels(null, 'fireball')), c.bfMeterPx(30));
  assert.equal(c.skills2CastRangePx('fireball', [1, 1, 1, 1, 1, 1, 1]), c.bfMeterPx(20));
  assert.equal(c.skills2CastRangePx('firepillar', c.sgEffectiveLevels(null, 'firepillar')), c.bfMeterPx(30));
});

test('新版技能的特殊性質都有明確 VFX variant', () => {
  const skills2 = read('js/skills2.js');
  const skills = read('js/skills.js');
  const vfx = read('js/vfx.js');
  const renderer = read('js/battle-renderer.js');
  const css = read('css/style.css');

  assert.match(skills2, /var SG_METEOR_INTERVAL_MS = 350/);
  assert.match(skills2, /function sgMeteorFallTiming\(\)/);
  assert.match(skills2, /SG_METEOR_DROP_DISTANCE/);
  assert.match(skills2, /SG_METEOR_FALL_SPEED/);
  assert.match(skills2, /var SG_FLYING_PROJECTILE_SPEED = 240/);
  assert.doesNotMatch(skills2, /bfTravelSeconds\(primary\)/);
  assert.match(skills2, /speed: fireballPlan\.speed/);
  assert.match(skills2, /travelMs: \[travelMs\]/);
  assert.match(skills2, /sgQueueMeteor\(pEnt, st, dmgVal, meteorTarget/);
  assert.match(skills2, /variant: 'fireball-small'/);
  assert.match(skills2, /hitFn: sgFireballProjectileHit/);
  assert.match(skills2, /firepillar: \{ name: '火龍捲'/);
  assert.match(skills2, /vfxId: 'sg-ground-' \+ \(\+\+SKILL2_RT\.groundSeq\)/);
  assert.match(skills2, /sgEmitVfx\('fireball', victims, floatSel, \{[\s\S]*variant: 'fire-explosion'/);
  assert.match(skills2, /var fireballPlan = meteor \? null : sgFireballProjectilePlan\(primary\)/);
  assert.match(skills, /id === 'fireball'[\s\S]*skills2FireballIsMeteor/);
  assert.match(skills2, /function skills2FireballIsMeteor\(/);

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
  assert.match(renderer, /isKnifeProjectile[\s\S]*?glow\.tint = isKnifeProjectile \? 0xff3850[\s\S]*?glow\.alpha = isKnifeProjectile \? 0\.16 : 0\.8/);
  assert.match(renderer, /isKnifeBounce[\s\S]*?glow\.tint = isKnifeBounce \? 0xff3850[\s\S]*?glow\.alpha = isKnifeBounce \? 0\.15 : 0\.75/);
  assert.match(css, /\.vfx-proj-knife \.vfx-proj-core[\s\S]*?drop-shadow\(0 0 5px rgba\(255, 56, 80, 0\.2\)\)/);
  assert.match(vfx, /function vfxCleaveArc\([\s\S]*?travel\)/);
  assert.match(vfx, /vfxCleaveArc\([\s\S]*?length: 120/);
  assert.match(vfx, /vfxCleaveArc\([\s\S]*?vfx-cleave-arc-back[\s\S]*?length: 120/);
  assert.match(renderer, /spawnCleaveArc\([\s\S]*?frontAngle \+ Math\.PI[\s\S]*?length: 120/);
  assert.doesNotMatch(vfx, /vfxCleaveWave|vfx-cleave-wave/);
  assert.doesNotMatch(renderer, /spawnCleaveWave|CLEAVE_WAVE_SPEED_RATIO/);
  assert.match(vfx, /vfxImpact\([\s\S]*?cHitDelay \+ 90/);
  assert.match(renderer, /spawnImpact\(pt\.x, pt\.y, spec, false\)/);
  assert.match(renderer, /function spawnFirePillar\(area, spec\)/);
  assert.match(renderer, /spec\.variant === 'pillar'[\s\S]*spawnFirePillar\(pillarArea, spec\)/);
  assert.doesNotMatch(renderer, /function spawnPillar\(/);
  assert.match(vfx, /function vfxFirePillar\(spec, layer, area, fallbackPt\)/);
  assert.match(vfx, /s\.variant === 'pillar'[\s\S]*vfxFirePillar\(s, layer, spec\.area, pillarPt\)/);
  assert.match(css, /\.vfx-fire-pillar[\s\S]*@keyframes vfxFirePillarPulse/);
  assert.match(css, /\.vfx-fire-tongue/);
  assert.match(renderer, /function spawnFireWall\(spec\)[\s\S]*_fireWallFx/);
  assert.match(renderer, /spec\.variant === 'firewall'[\s\S]*spawnFireWall\(spec\)/);
  assert.match(vfx, /function vfxFireWall\(spec, layer, area, rect\)/);
  assert.match(vfx, /s\.variant === 'firewall'[\s\S]*vfxFireWall\(s, layer, spec\.area, rect\)/);
  assert.match(css, /\.vfx-fire-wall-vortex[\s\S]*@keyframes vfxFireWallVortex/);
  assert.match(css, /\.vfx-fire-wall-smoke/);
  assert.match(renderer, /var flameH = Math\.max\(72, Math\.min\(180, h \* 2\.8\)\)/);
  assert.match(renderer, /for \(var vi = 0; vi < 3; vi\+\+\)[\s\S]*vortexPhase/);
  assert.match(vfx, /for \(var vi = 0; vi < 3; vi\+\+\)[\s\S]*vfx-fire-wall-vortex/);
  assert.match(renderer, /node\.rotation = 0/);
  assert.match(vfx, /--vfx-wall-angle', '0rad'/);
  assert.match(css, /\.vfx-fire-wall[\s\S]*transform: rotate\(0deg\)/);
  assert.match(vfx, /var wallH = Math\.max\(84, Math\.min\(180, rectH \* 1\.15\)\)/);
  const vfxCleaveStart = vfx.indexOf("if (kind === 'slash' && (s.variant === 'cleave'");
  const vfxCleaveEnd = vfx.indexOf('\n    return;', vfxCleaveStart);
  const rendererCleaveStart = renderer.indexOf("if (spec.variant === 'cleave'");
  const rendererCleaveEnd = renderer.indexOf('\n          break;', rendererCleaveStart);
  assert.ok(vfxCleaveStart >= 0 && vfxCleaveEnd > vfxCleaveStart);
  assert.ok(rendererCleaveStart >= 0 && rendererCleaveEnd > rendererCleaveStart);
  assert.doesNotMatch(vfx.slice(vfxCleaveStart, vfxCleaveEnd), /vfxSlash\(/);
  assert.doesNotMatch(renderer.slice(rendererCleaveStart, rendererCleaveEnd), /spawnSlash\(/);
});

test('火狩 Canvas 旋轉速度沿用模擬層角速度，舊事件仍可退回方向速度', () => {
  const skills2 = read('js/skills2.js');
  const renderer = read('js/battle-renderer.js');

  assert.match(skills2, /spin: f\.rings\[i\]\.spin >= 0 \? 1 : -1,\s*spinRate: f\.rings\[i\]\.spin/);
  assert.match(renderer, /var spinRate = Number\(a\.spinRate\);/);
  assert.match(renderer, /isFinite\(spinRate\) && Math\.abs\(spinRate\) > 1e-6/);
  assert.match(renderer, /\? spinRate : \(ccw \? -1 : 1\) \* Math\.PI \* 2/);
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

test('迴旋斬大型弧光半徑在 DOM 與 Canvas 都縮為三分之一', () => {
  const css = read('css/style.css');
  const renderer = read('js/battle-renderer.js');

  assert.match(css, /\.vfx-cleave-arc[\s\S]*?width: 52px;[\s\S]*?height: 52px;[\s\S]*?margin: -26px 0 0 -26px/);
  assert.match(css, /\.vfx-cleave-arc::before[\s\S]*?border: 2\.6px solid transparent/);
  assert.match(css, /\.vfx-cleave-arc::after[\s\S]*?border-width: 0\.87px/);
  assert.match(renderer, /var t = -\(delaySec \|\| 0\), dur = Math\.max\(0\.38, spec\.dur \|\| 0\.5\), R = 86 \/ 3/);
  assert.match(renderer, /theme\.c1, width: 14\.3 \/ 3 \* fade/);
  assert.match(renderer, /theme\.c2, width: 5\.2 \/ 3 \* fade/);
});

test('震碎斬距離使用 12 米（120 系統距離單位）', () => {
  const skills2 = read('js/skills2.js');
  const csv = read('config/CSV/Skills2.csv');
  const cleaveCsvLine = csv.split(/\r?\n/).find((line) => /,6,[^,]*,震碎斬,/.test(line));
  // 階段名稱與 fx 之間可能還有「解鎖轉生/等級」欄位（unlock: { … }）
  assert.match(skills2, /name: '震碎斬',.*?fx: \{ m: 12, mPer: 0\.5 \}/);
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
