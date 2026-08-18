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
  assert.match(skills2, /variant: 'firepillar-impact'/);
  assert.match(vfx, /function vfxFirePillarShockwave\(/);
  assert.match(vfx, /s\.variant === 'firepillar-impact'[\s\S]*vfxFirePillarShockwave/);
  assert.match(renderer, /function spawnFirePillarShockwave\(/);
  assert.match(renderer, /spec\.variant === 'firepillar-impact'[\s\S]*spawnFirePillarShockwave/);
  assert.match(css, /\.vfx-firepillar-shockwave[\s\S]*@keyframes vfxFirePillarShockwaveRing/);
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
  assert.match(renderer, /var axisAngle = fx\.angle/);
  assert.match(renderer, /var vortexGroundY = groundY \+ axisY \* vortexOffset/);
  assert.doesNotMatch(renderer, /var baseLong = w \* 0\.47/);
  assert.match(vfx, /var wallAngle = isFinite\(area && area\.a\)/);
  assert.match(vfx, /wallAxisX \* \(vi - 1\) \* 31/);
  assert.match(css, /\.vfx-fire-wall[\s\S]*transform: none/);
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

test('火狩長駐特效在混合技能容量洪峰中保留，拒收後可重建', () => {
  const renderer = read('js/battle-renderer.js');
  const vfx = read('js/vfx.js');

  assert.match(renderer, /var FX_PERSISTENT_AURA_PRIORITY = 3/);
  assert.match(renderer, /candidatePrio < fx\.prio/);
  assert.match(renderer, /ring && !ring\.done && ring\.fx && !ring\.fx\.dead/);
  assert.match(renderer, /var ringFx = addFx\([\s\S]*?FX_PERSISTENT_AURA_PRIORITY/);
  assert.match(renderer, /if \(!ringFx\) \{[\s\S]*?delete _fireHuntRings\[key\]/);
  assert.match(vfx, /function vfxQueuePriority\(spec\)/);
  assert.match(vfx, /spec\.fxKind === 'aura' && spec\.variant === 'firehunt'\) return 3/);
  assert.match(vfx, /queuedPriority < incomingPriority/);
  assert.match(vfx, /if \(evictIndex >= 0\) _vfxEventQueue\.splice\(evictIndex, 1\);[\s\S]*else return;/);
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

test('泥沼／熔岩沼：兩套顯示層都有貼地水窪畫法，且尺寸每次 tick 都跟著場域更新', () => {
  const skills2 = read('js/skills2.js');
  const vfx = read('js/vfx.js');
  const renderer = read('js/battle-renderer.js');
  const css = read('css/style.css');
  const shim = read('js/worker/shim.js');

  // 模擬層：沼澤每一跳送出帶 area 的 aura 事件；熔岩沼換一個 variant 與火屬性
  assert.match(skills2, /var mireVariant = m\.lava[\s\S]*'mire-lava-poison'[\s\S]*'mire-poison'/);
  assert.match(skills2, /elem: m\.lava && !poison \? 'fire' : 'earth'/);
  // 矩形場域的 area 必須帶 w/h/a，顯示層才畫得出方向正確的方框（外接圓 r 供舊畫法退化）
  assert.match(skills2, /var rect = \{ id: f\.vfxId, x: f\.pos\.x, y: f\.pos\.y, w: f\.length, h: f\.width,/);
  assert.match(shim, /area: spec\.area \|\| null/, 'area 必須整包跨 Worker 邊界送出');

  // 場域會長大：尺寸的權威是「出生尺寸 × 當下倍率」，每跳重算，不能就地複利
  assert.match(skills2, /function sgGroundGrowScale\(f\)/);
  assert.match(skills2, /f\.length = f\.baseLength \* s;/);
  assert.match(skills2, /sgGroundApplyGrowth\(f\);   \/\/ 逐漸擴大的場域/);

  // DOM（高塔）與 Canvas（野外）兩條路徑都要接上，否則其中一邊會退回預設光暈
  assert.match(vfx, /function vfxMirePool\(spec, layer, area, rect\)/);
  assert.match(vfx, /else if \(s\.variant === 'mire'[\s\S]*s\.variant === 'mire-poison'[\s\S]*vfxMirePool\(s, layer, spec\.area, rect\);/);
  assert.match(renderer, /function spawnMirePool\(spec\)/);
  assert.match(renderer, /else if \(spec\.variant === 'mire'[\s\S]*spec\.variant === 'mire-poison'[\s\S]*spawnMirePool\(spec\);/);
  // 同一攤沼澤要靠 area.id 合併成一個長駐節點，不是每跳生一個新的
  assert.match(vfx, /var node = _vfxMirePools\[key\];/);
  assert.match(renderer, /var current = _mirePoolFx\[key\];/);
  assert.match(renderer, /function fieldVfxSetTarget\(fx, x, y, w, h, duration\)/);
  assert.match(renderer, /fieldVfxStep\(fx, dt\);/);
  assert.match(renderer, /motionToW = Math\.max\(1, Number\(w\)\)/);
  // 續命與清場：切場景時長駐節點要一起回收
  assert.match(vfx, /_vfxMirePools = Object\.create\(null\);/);
  assert.match(renderer, /if \(_mirePoolFx\[key\] === fx\) delete _mirePoolFx\[key\];/);

  const mireBaseCss = css.slice(css.indexOf('.vfx-mire-pool {'), css.indexOf('.vfx-mire-pool::after'));
  assert.match(mireBaseCss, /border-radius:\s*10px/);
  assert.doesNotMatch(mireBaseCss, /border-radius:\s*50%/);
  assert.match(css, /\.vfx-mire-lava\s*\{/);
  assert.match(skills2, /var mireVariant = m\.lava[\s\S]*'mire-lava-poison'[\s\S]*'mire-poison'/);
  assert.match(vfx, /var poison = spec && \(spec\.variant === 'mire-poison' \|\| spec\.variant === 'mire-lava-poison'\)/);
  assert.match(vfx, /var VFX_MIRE_VISUAL_HEIGHT_RATIO = 0\.52/);
  assert.match(vfx, /var visualH = Math\.max\(24, h \* VFX_MIRE_VISUAL_HEIGHT_RATIO\)/);
  assert.match(vfx, /vfx-mire-current/);
  assert.match(renderer, /var poison = spec\.variant === 'mire-poison' \|\| spec\.variant === 'mire-lava-poison'/);
  assert.match(renderer, /var MIRE_VISUAL_HEIGHT_RATIO = 0\.52/);
  assert.match(renderer, /var visualH = Math\.max\(16, fx\.h \* MIRE_VISUAL_HEIGHT_RATIO\)/);
  assert.match(renderer, /g\.rect\(-rx, -ry, fx\.w, visualH\)/);
  assert.doesNotMatch(renderer, /g\.rect\(-rx, -ry, fx\.w, fx\.h\)/);
  assert.match(renderer, /0x6b2d7c/);
  assert.match(css, /\.vfx-mire-poison\s*\{/);
  assert.match(css, /\.vfx-mire-current\s*\{/);
  assert.match(css, /@keyframes vfxMireCurrent/);
  assert.match(css, /@keyframes vfxMireRipple/);
  assert.match(css, /@keyframes vfxMireBubble/);
});

test('岩甲術與大地守護的自身特效走玩家定址，不會畫到敵人身上', () => {
  const skills2 = read('js/skills2.js');
  assert.match(skills2, /function sgEmitPlayerVfx\(gid, floatSel, extra\)/);
  assert.match(skills2, /playerEventFloatTarget/);
  assert.match(skills2, /sgEmitPlayerVfx\('rockarmor', floatSel, \{ fxKind: 'aura', variant: 'rock-armor'/);
  // 天地共生的復活光柱：沿用既有 rain/pillar 畫法（設計文檔要求「從天而降的光柱」）
  assert.match(skills2, /sgEmitPlayerVfx\('earthguard', 'pv-float', \{ fxKind: 'rain', variant: 'pillar'/);
  // 岩甲尖刺打在敵人身上，走敵人定址的 impact
  assert.match(skills2, /sgEmitVfx\('rockarmor', \[mEnt\], eSel, \{ fxKind: 'impact', variant: 'rock-spike', elem: 'earth' \}\);/);
});

test('雷系三技能的顯示層接線：鏈、天雷、球體場域在 Canvas 與 DOM 兩條路徑都接上', () => {
  const skills2 = read('js/skills2.js');
  const vfx = read('js/vfx.js');
  const renderer = read('js/battle-renderer.js');
  const css = read('css/style.css');

  // 連鎖閃電：一則事件＝一段電弧；起手那一段從玩家身上劈出去
  assert.match(skills2, /fxKind: 'chain', variant: 'lightning-chain'/);
  assert.match(renderer, /if \(spec\.variant === 'lightning-chain'\)/);
  assert.match(renderer, /spawnBolt\(playerPos\(\), targets\[0\], spec, baseDelay \/ 1000, false, false\);/);

  // 落雷術／雷殞天落：天降路徑
  assert.match(renderer, /if \(spec\.variant === 'thunder-strike'\)/);
  assert.match(renderer, /if \(spec\.variant === 'thunder-fall'\)/);
  assert.match(renderer, /function spawnThunderFall\(spec, targetId, delaySec\)/);
  assert.match(vfx, /s\.variant === 'thunder-strike' \|\| s\.variant === 'thunder-fall'/);

  // 雷球：按 area.id 合併的長駐球體，每次事件更新到最新座標（球會飛）
  assert.match(skills2, /variant: 'thunder-orb'/);
  assert.match(renderer, /else if \(spec\.variant === 'thunder-orb'\) spawnThunderOrbField\(spec\);/);
  assert.match(renderer, /var current = _thunderOrbFx\[key\];/);
  assert.match(renderer, /function fieldVfxSetPositionTarget\(fx, x, y, duration\)/);
  assert.match(renderer, /fieldVfxSetPositionTarget\(current, Number\(a\.x\), Number\(a\.y\)/);
  assert.match(vfx, /else if \(s\.variant === 'thunder-orb'\) vfxThunderOrb\(s, layer, spec\.area, rect\);/);
  assert.match(vfx, /_vfxThunderOrbs = Object\.create\(null\);/);
  assert.match(vfx, /function vfxFieldMotionSet\(node, x, y, w, h, duration\)/);
  assert.match(vfx, /requestAnimationFrame\(frame\)/);
  assert.match(vfx, /translate3d\(/);
  assert.match(css, /\.vfx-field-motion\s*\{[\s\S]*?will-change:\s*transform/);

  // 環體電球沿用火狩的環繞畫法，但合併鍵要含變體與屬性（否則兩道會互相吃掉）
  assert.match(renderer, /spec\.variant === 'firehunt' \|\| spec\.variant === 'thunder-orbit'/);
  assert.match(renderer, /var key = \(spec\.variant \|\| 'firehunt'\) \+ ':' \+ \(spec\.elem \|\| ''\) \+ ':' \+/);

  assert.match(css, /\.vfx-thunder-orb\s*\{[\s\S]*?border-radius:\s*50%/);
  assert.match(css, /@keyframes vfxThunderOrbArc/);
});

test('殞石術與雷殞天落在落地前顯示對應顏色的目標提示圈', () => {
  const vfx = read('js/vfx.js');
  const renderer = read('js/battle-renderer.js');
  const css = read('css/style.css');
  const index = read('index.html');

  // 兩套顯示層共用同一個 area.r 語意，落點位置也優先取目標座標。
  assert.match(vfx, /function vfxTargetTelegraph\(spec, layer, pt, radius, delayMs, durationMs, targetGuard\)/);
  assert.match(vfx, /var impactRadius = vfxAreaRadius\(rect, spec\.area\)/);
  assert.match(vfx, /vfxTargetTelegraph\(spec, layer, \{ x: cx, y: cy \}, impactRadius, safeBaseDelay, fall\)/);
  assert.match(vfx, /spec\.variant === 'thunder-fall'[\s\S]*vfxTargetTelegraph\(spec, layer, pt, radius, delayMs, flight, targetGuard\)/);
  assert.match(renderer, /function spawnTargetTelegraph\(spec, cx, cy, radius, delaySec, durationSec, targetId\)/);
  assert.match(renderer, /spawnTargetTelegraph\(spec, cx, cy, rectRadius\(rect\), 0, dur\)/);
  assert.match(renderer, /spawnTargetTelegraph\(spec, to\.x, to\.y, radius, delaySec, dur, targetId\)/);

  const domTelegraphStart = vfx.indexOf('function vfxTargetTelegraph');
  const domTelegraphEnd = vfx.indexOf('function vfxAreaRadius', domTelegraphStart);
  const pixiTelegraphStart = renderer.indexOf('function spawnTargetTelegraph');
  const pixiTelegraphEnd = renderer.indexOf('function spawnMeteor', pixiTelegraphStart);
  assert.doesNotMatch(vfx.slice(domTelegraphStart, domTelegraphEnd), /vfx-target-telegraph-ring/);
  assert.doesNotMatch(renderer.slice(pixiTelegraphStart, pixiTelegraphEnd), /for \(var ri = 0; ri < 3; ri\+\+\)/);

  assert.match(css, /\.vfx-target-telegraph-fire\s*\{[\s\S]*?rgba\(220, 38, 38, 0\.18\)/);
  assert.match(css, /\.vfx-target-telegraph-lightning\s*\{[\s\S]*?rgba\(37, 99, 235, 0\.18\)/);
  assert.doesNotMatch(css, /\.vfx-target-telegraph-ring/);
  assert.match(index, /css\/style\.css\?v=1\.0\.\d+/);
  assert.match(index, /js\/vfx\.js\?v=1\.0\.\d+/);
  assert.match(index, /js\/battle-renderer\.js\?v=1\.6\.\d+/);
  assert.match(index, /js\/skills2\.js\?v=1\.0\.\d+/);
});

/* 冰系三群組（2026-08-17 第七批）：三種新場域與拋物線水彈的兩條渲染路徑都要接上，
   且尺寸／弧高一律沿用模擬層送來的語意參數（AI_RULES 8.3）。 */
test('冰系特效：暴風雪／水龍捲／追蹤冰箭在 Canvas 與 DOM 兩條路徑都有畫法', () => {
  const vfx = fs.readFileSync(path.join(root, 'js/vfx.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const skills2 = fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8');

  // 模擬層：三種場域各自的變體名稱
  assert.match(skills2, /variant: 'blizzard'/);
  assert.match(skills2, /variant: 'water-tornado'/);
  assert.match(skills2, /variant: 'ice-arrow-homing'/);

  // Canvas：aura 分派表接上 spawnIceField，且以 area 為錨點（不是棋盤格 rect）
  assert.match(renderer, /function spawnIceField\(spec\)/);
  assert.match(renderer, /spec\.variant === 'blizzard' \|\| spec\.variant === 'water-tornado' \|\|[\s\S]{0,200}spawnIceField\(spec\)/);
  assert.match(renderer, /function spawnIceField[\s\S]*?var a = spec && spec\.area;/);
  assert.match(renderer, /fx\.variant === 'blizzard'[\s\S]*?var follow = playerPos\(\)/);
  assert.match(renderer, /fx\.variant === 'ice-arrow-homing'[\s\S]*?fx\.speed \* Math\.max/);
  assert.match(skills2, /if \(f\.follow\) rect\.follow = true;/);
  assert.match(skills2, /rect\.destX = f\.dest\.x;[\s\S]{0,80}rect\.speed = f\.speed;/);

  // DOM：aura 分派表接上 vfxIceField，且節點按 area.id 合併
  assert.match(vfx, /function vfxIceField\(spec, layer, area, rect\)/);
  assert.match(vfx, /var isIceField = s\.variant === 'blizzard' \|\| s\.variant === 'water-tornado'/);
  assert.match(vfx, /else if \(isIceField\) vfxIceField\(s, layer, spec\.area, rect\);/);
  assert.match(vfx, /_vfxIceFields\[key\] = node;/);
  assert.match(vfx, /function vfxFieldMotionFollowPlayer\(node, layer\)/);
  assert.match(vfx, /function vfxFieldMotionHome\(node, speed, targetX, targetY\)/);
  assert.match(vfx, /var isIceField = s\.variant === 'blizzard'/);
  // 場景切換時必須一併清掉，否則場域節點會殘留
  assert.match(vfx, /_vfxIceFields = Object\.create\(null\);[\s\S]{0,400}?querySelectorAll/);

  assert.match(css, /\.vfx-blizzard\s*\{/);
  assert.match(css, /\.vfx-water-tornado\s*\{/);
  assert.match(css, /\.vfx-ice-homing\s*\{/);
  assert.match(css, /@keyframes vfxBlizzardFall/);
});

test('冰霜新星範圍使用模擬半徑繪製圓形，暴風雪維持矩形', () => {
  const vfx = fs.readFileSync(path.join(root, 'js/vfx.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const skills2 = fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8');

  assert.match(skills2, /variant: 'frost-nova'[\s\S]{0,120}area: p \? \{ x: p\.x, y: p\.y, r: radiusPx \}/);
  assert.match(renderer, /function spawnFrostNovaArea\(spec\)[\s\S]*?g\.circle\(0, 0, r\)/);
  assert.match(renderer, /spec\.variant === 'frost-nova'[\s\S]*?spawnFrostNovaArea\(spec\)/);
  assert.match(vfx, /function vfxFrostNova\(spec, layer, area, fallbackPt, delayMs\)/);
  assert.match(vfx, /kind === 'burst' && s\.variant === 'frost-nova'[\s\S]*?vfxFrostNova\(s, layer, spec\.area/);
  assert.match(css, /\.vfx-frost-nova\s*\{[\s\S]*?border-radius: 50%/);
  assert.match(css, /@keyframes vfxFrostNovaExpand/);
  assert.match(css, /\.vfx-blizzard\s*\{[\s\S]*?border-radius: 42% \/ 58%/);
});

test('冰系特效：水流彈的拋物線弧高由模擬層的表定值決定', () => {
  const vfx = fs.readFileSync(path.join(root, 'js/vfx.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const skills2 = fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8');

  // 事件必須帶得出 arcM（表定 8 米），而不是讓顯示層自己挑固定弧高
  assert.match(skills2, /if \(extra && extra\.arcM > 0\) spec\.arcM = Number\(extra\.arcM\);/);
  assert.match(skills2, /arcM: cfg\.arcM/);
  assert.match(skills2, /arcM: 8/);

  // Canvas：弧高換算成世界單位後餵進拋物線
  assert.match(renderer, /function projectileArcPx\(spec\)/);
  assert.match(renderer, /Math\.sin\(k \* Math\.PI\) \* projectileArcPx\(spec\)/);
  // DOM：弧高寫進 CSS 變數，並改用拋物線 keyframe
  assert.match(vfx, /function vfxProjectileArcPx\(spec\)/);
  assert.match(vfx, /d\.style\.setProperty\('--vfx-arc', arcPx \+ 'px'\)/);
  assert.match(css, /@keyframes vfxFlyArc/);
  assert.match(css, /var\(--vfx-arc, 18px\)/);
});

test('寒冰箭貫穿：兩條渲染路徑都以單一連續直線投射物呈現', () => {
  const vfx = fs.readFileSync(path.join(root, 'js/vfx.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
  const skills2 = fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8');

  // 模擬層提供貫穿線段的飛行時間，畫面不再使用每個目標的預設延遲。
  assert.match(skills2, /variant: 'ice-arrow-pierce'[\s\S]{0,180}travelMs: \[Math\.round\(lineLen \/ SG_FLYING_PROJECTILE_SPEED \* 1000\)\]/);
  // Canvas：同一事件只建立一支沿 angle／length 前進的箭。
  assert.match(renderer, /function spawnIcearrowPierce[\s\S]*?spawnProjectile\(null, flight, spec, null, from, \{ angle: angle, length: length \}\)/);
  assert.match(renderer, /if \(spec\.variant === 'ice-arrow-pierce'\)[\s\S]{0,180}spawnIcearrowPierce\(spec, targets/);
  // DOM：同一事件只建立一個固定終點的 CSS 飛行節點。
  assert.match(vfx, /kind === 'projectile' && \(?s\.variant === 'ice-arrow-pierce'[\s\S]*?vfxProjectile\(s, layer, from, iceArrowEnd, iceArrowDelay, iceArrowTravel\)/);
});

test('新版技能彈射與特效細化：連鎖閃電無天雷、水流彈藍色拋物彈射、血刃斬綠色子彈、大地守護白光光束、反傷無特效、水龍捲藍色火柱', () => {
  const vfx = fs.readFileSync(path.join(root, 'js/vfx.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
  const skills2 = fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

  // 1. 連鎖閃電：移除天雷落頂特效，只留閃電鏈彈射
  assert.doesNotMatch(vfx, /vfxBolt\(spec, layer, skyPt/);
  assert.match(vfx, /vfxBolt\(spec, layer, casterOrigin, ptList\[0\], baseDelay/);

  // 2. 水流彈：藍色拋物線子彈彈射，寒霜傳染平飛藍色子彈
  assert.match(vfx, /spec\.variant === 'water-bounce'[\s\S]*?variant: 'waterball'/);
  assert.match(vfx, /spec\.variant === 'frost-spread'[\s\S]*?variant: 'frost-bullet'/);
  assert.match(renderer, /spec\.variant === 'water-bounce'[\s\S]*?variant: 'waterball'/);
  assert.match(renderer, /spec\.variant === 'frost-spread'[\s\S]*?variant: 'frost-bullet'/);

  // 3. 血刃斬：移除小刀圖案，使用綠色快速平飛子彈
  assert.match(vfx, /spec\.variant === 'poison-spread'[\s\S]*?variant: 'venom'/);
  assert.match(renderer, /spec\.variant === 'poison-spread'[\s\S]*?variant: 'venom'/);

  // 4. 反擊：移除反傷特效
  assert.doesNotMatch(skills2, /variant: 'counter-sweep'/);

  // 5. 大地守護：生命反射盾白光射向敵人
  assert.match(skills2, /variant: 'earth-reflect', elem: 'light'/);
  assert.match(vfx, /spec\.variant === 'earth-reflect'[\s\S]*?vfxBeam\(eSpec, layer, eFrom, ptList\[ei\]\)/);
  assert.match(renderer, /spec\.variant === 'earth-reflect'[\s\S]*?spawnBeam\(tgtId, eSpec\)/);

  // 6. 水龍捲：使用火龍捲柱體結構搭配藍色系
  assert.match(vfx, /vfx-water-tornado-pillar/);
  assert.match(renderer, /spawnFirePillar\(spec\.area \|\| spec\.area, spec\)|spawnFirePillar\(a, spec\)/);
  assert.match(renderer, /var isWater = spec && \(spec\.variant === 'water-tornado' \|\| spec\.elem === 'ice'\)/);
  assert.match(css, /\.vfx-water-tornado-pillar/);
  assert.match(css, /\.vfx-water-tongue/);
});

/* 風系三群組（2026-08-18 第八批）：設計文檔對特效的外形有明確指定，
   而且尺寸一律沿用模擬層送來的判定數字（AI_RULES 8.3）。
   兩條渲染路徑（Canvas 野外／DOM 高塔）都要接上，缺一邊在高塔就會看不到技能。 */
test('風系特效：風刃／真空斬／迴旋斬／虛空斬／暴風屏障在兩條路徑都有畫法', () => {
  const vfx = fs.readFileSync(path.join(root, 'js/vfx.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const skills2 = fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8');

  // 模擬層：各變體名稱，以及「方位與刀身尺寸必須送到顯示層」的兩個欄位
  ['wind-blade', 'wind-blade-small', 'wind-blade-homing', 'wind-burst',
    'wind-slash', 'wind-spin', 'void-disc', 'storm-barrier', 'storm-god', 'storm-rip']
    .forEach((v) => assert.match(skills2, new RegExp("'" + v + "'"), `模擬層缺少變體 ${v}`));
  assert.match(skills2, /if \(extra && isFinite\(extra\.angle\)\) spec\.angle = Number\(extra\.angle\);/);
  assert.match(skills2, /if \(extra && extra\.bodyLength > 0\) spec\.bodyLength = Number\(extra\.bodyLength\);/);

  // Canvas：風刃走自己的直線飛行（方位取事件的 angle，路徑上沒有敵人也要畫得出來）
  assert.match(renderer, /function spawnWindBlade\(spec, targets, baseDelay\)/);
  assert.match(renderer, /var angle = isFinite\(spec\.angle\) \? Number\(spec\.angle\)/);
  assert.match(renderer, /spec\.variant === 'wind-blade' \|\| spec\.variant === 'wind-blade-small'[\s\S]{0,80}spawnWindBlade\(spec, targets, baseDelay\)/);
  // Canvas：半月箭頭弧形是共用輪廓（風刃與真空斬同一支）
  assert.match(renderer, /function windCrescentPoly\(width, body\)/);
  assert.match(renderer, /function drawWindCrescent\(g, width, body, theme, alpha\)/);
  // Canvas：虛空斬的半徑成長沿用模擬層的 area.grow，且順逆時針各一道
  assert.match(renderer, /function spawnVoidDisc\(spec\)/);
  assert.match(renderer, /disc\.r \+= grow \* dt;/);
  assert.match(renderer, /var dur = Math\.max\(0\.5, Number\(spec && spec\.dur\) \|\| 6\);/);
  assert.match(renderer, /dur \* 1000 \+ 500/);
  assert.match(renderer, /形成連續螺旋/);
  assert.match(skills2, /grow: f\.growPxPerSec \|\| 0/);
  // Canvas：屏障／神體／撕裂是釘在自身的風殼
  assert.match(renderer, /function spawnStormShell\(spec\)/);
  assert.match(renderer, /spec\.variant === 'storm-barrier' \|\| spec\.variant === 'storm-god'/);
  // Canvas：追跡風刃與追蹤冰箭共用同一套移動場域畫法
  assert.match(renderer, /variant === 'ice-arrow-homing' \|\| variant === 'wind-blade-homing'/);

  // DOM：風刃沿用貫穿冰箭那條直線飛行路徑；追跡風刃沿用移動場域
  assert.match(vfx, /s\.variant === 'wind-blade' \|\| s\.variant === 'wind-blade-small'/);
  assert.match(vfx, /s\.variant === 'ice-arrow-homing' \|\| s\.variant === 'wind-blade-homing'/);
  assert.match(vfx, /'vfx-wind-homing'/);
  assert.match(vfx, /function vfxVoidDisc\(spec, layer, rect\)/);
  assert.match(vfx, /s\.variant === 'void-disc'\) vfxVoidDisc\(s, layer, rect\)/);

  // CSS：風系的投射物／受擊／光環配色，以及技能標籤
  assert.match(css, /\.vfx-proj-wind \.vfx-proj-core/);
  assert.match(css, /\.vfx-impact-wind \.vfx-p/);
  assert.match(css, /\.vfx-aura-wind \.vfx-aura-p/);
  assert.match(css, /\.vfx-wind-homing \{/);
  assert.match(css, /\.vfx-void-disc \{/);
  assert.match(css, /vfxVoidDiscBlade/);
});
