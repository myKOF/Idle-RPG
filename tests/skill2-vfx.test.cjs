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
  assert.match(skills2, /delayMs: delay, travelMs: \[0, travel\]/);
  assert.match(skills2, /sgKnifeHit\(cfg, next, dmgVal, delay \+ travel/);
  assert.match(skills2, /delay \+= travel;/);
  assert.match(skills2, /if \(!next \|\| next === cur \|\| next\.hp <= 0\) break;/);
  assert.match(skills2, /loopReturn: true/);
  assert.match(skills2, /preserveDeadTargets: preserveDeadOrigin/);
  assert.match(skills2, /extra\.preserveDeadTargets\) spec\.preserveDeadTargets = true/);

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
  assert.match(vfx, /function vfxKnifeReturn\(/);
  assert.match(vfx, /loopReturn: !!spec\.loopReturn/);
  assert.match(vfx, /function vfxIsKnifeProjectileSpec\(spec\)/);
  assert.match(vfx, /if \(vfxIsKnifeProjectileSpec\(spec\)\) return 0;/);
  assert.match(vfx, /var outbound = k < 0\.5;/);
  assert.match(renderer, /pathOverride && pathOverride\.loopReturn/);
  assert.match(renderer, /spec\.loopReturn && targets\.length === 1/);
  assert.match(renderer, /function isKnifeProjectileSpec\(spec\)/);
  assert.match(renderer, /if \(isKnifeProjectileSpec\(spec\)\) return 0;/);
  assert.match(renderer, /if \(isKnifeProjectile\) \{/);
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
  assert.match(renderer, /if \(ent\.state === 'gone' && !allowDeadOrigin\) return false;/);
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
  assert.match(skills2, /var SG_ICEARROW_SPEED = 300/);
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
    'thrust-pierce', 'thrust-parallel', 'thrust-octagonal', 'cleave-shockwave', 'cleave-cross', 'cleave-cross-shockwave', 'knife', 'knife-bounce', 'knife-soulhunter',
    'gale-slashes', 'bleed-tick', 'poison-tick', 'blood-explosion',
    'zero-infection', 'dual-storm'
  ]) {
    assert.ok(skills2.includes("'" + variant + "'") || skills2.includes('"' + variant + '"'), variant);
  }

  for (const variant of [
    'thrust-pierce', 'thrust-parallel', 'thrust-octagonal', 'cleave-shockwave', 'cleave-back', 'cleave-dual', 'cleave-cross', 'cleave-cross-shockwave', 'knife', 'knife-bounce', 'knife-soulhunter',
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
  assert.match(vfx, /isKnifeClass[\s\S]*?spec\.glyph/);
  assert.match(renderer, /spec\.variant === 'knife'[\s\S]*?spec\.variant === 'knife-bounce'/);
  assert.match(css, /\.vfx-proj-knife \.vfx-proj-core[\s\S]*?background: none/);
  assert.match(css, /\.vfx-proj-knife-soulhunter[\s\S]*?drop-shadow\(0 0 20px var\(--vfx-glow/);
  assert.match(renderer, /isKnifeProjectile[\s\S]*?glow\.tint = isKnifeProjectile \? 0xff3850[\s\S]*?glow\.alpha = isKnifeProjectile \? 0\.16 : 0\.8/);
  assert.match(renderer, /isSoulhunterKnife[\s\S]*?glow\.tint = 0xffd23f[\s\S]*?glow\.alpha = 0\.9/);
  assert.match(renderer, /isKnifeBounce[\s\S]*?glow\.tint = isKnifeBounce \? 0xff3850[\s\S]*?glow\.alpha = isKnifeBounce \? 0\.15 : 0\.75/);
  assert.match(css, /\.vfx-proj-knife \.vfx-proj-core[\s\S]*?drop-shadow\(0 0 5px rgba\(255, 56, 80, 0\.2\)\)/);
  assert.match(vfx, /function vfxCleaveArc\([\s\S]*?travel\)/);
  /* 2026-08-19：弧光飛行距離改由模擬層的 lineLength 帶入（傳奇【裂空飛斬】要飛 60 米），
     兩個渲染器都以同一個 arcLen 變數承接，沒帶時才退回原本寫死的 120px。 */
  assert.match(vfx, /var arcLen = Number\(s\.lineLength\) > 0 \? Number\(s\.lineLength\) : 120;/);
  assert.match(renderer, /var arcLen = Number\(spec\.lineLength\) > 0 \? Number\(spec\.lineLength\) : 120;/);
  assert.match(vfx, /vfxCleaveArc\([\s\S]*?length: arcLen/);
  assert.match(vfx, /vfxCleaveArc\([\s\S]*?vfx-cleave-arc-back[\s\S]*?length: arcLen/);
  assert.match(renderer, /spawnCleaveArc\([\s\S]*?frontAngle \+ Math\.PI[\s\S]*?length: arcLen/);
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

test('震碎斬與迴身四方斬共用迴旋斬的方向事件', () => {
  const skills2 = read('js/skills2.js');
  const cleaveStart = skills2.indexOf('function sgCastCleave');
  const cleaveEnd = skills2.indexOf('\n}\n\n/* ---- 匕首投擲', cleaveStart);
  const cleaveBlock = skills2.slice(cleaveStart, cleaveEnd);

  /* 2026-08-19：飛出距離改由 isFlying 決定（第 6 階【震碎斬】∪ 傳奇【裂空飛斬】），
     變體選擇的結構不變——仍是「十字 × 是否飛出」四種組合共用同一組弧光。 */
  assert.match(cleaveBlock, /lvs\[6\] > 0 \? \(isFlying \? 'cleave-cross-shockwave' : 'cleave-cross'\)/);
  assert.match(cleaveBlock, /isFlying \? 'cleave-shockwave'/);
  assert.match(read('css/style.css'), /\.vfx-cleave-arc-back/);
  assert.doesNotMatch(read('css/style.css'), /\.vfx-cleave-wave/);
});

test('疾風斬使用玩家中心的單一道前方 180 度弧形掃擊', () => {
  const vfx = read('js/vfx.js');
  const renderer = read('js/battle-renderer.js');
  const css = read('css/style.css');
  const galeVfxStart = vfx.indexOf("if (kind === 'slash' && s.variant === 'gale-slashes')");
  const galeVfxEnd = vfx.indexOf('for (var t = 0;', galeVfxStart);
  const galeRendererStart = renderer.indexOf("if (spec.variant === 'gale-slashes')");
  const galeRendererEnd = renderer.indexOf('targets.forEach(function (id, ti)', galeRendererStart);

  assert.ok(galeVfxStart >= 0 && galeVfxEnd > galeVfxStart);
  assert.ok(galeRendererStart >= 0 && galeRendererEnd > galeRendererStart);
  assert.match(vfx, /function vfxGaleSweep\([\s\S]*?vfxCleaveSector\([\s\S]*?'vfx-gale-sweep'/);
  assert.match(vfx.slice(galeVfxStart, galeVfxEnd), /vfxGaleSweep\(s, layer, from/);
  assert.doesNotMatch(vfx.slice(galeVfxStart, galeVfxEnd), /vfxBladestorm|vfxRectAround\(rt\.pts/);
  assert.match(vfx.slice(galeVfxStart, galeVfxEnd), /vfxHitReact\(rt\.ids\[gti\]/);
  assert.match(renderer, /function spawnGaleSweep\([\s\S]*?spawnCleaveSector\([\s\S]*?180/);
  assert.match(renderer.slice(galeRendererStart, galeRendererEnd), /spawnGaleSweep\(spec, targets, baseDelay\)/);
  assert.doesNotMatch(renderer.slice(galeRendererStart, galeRendererEnd), /spawnBladestorm|posOf\(id\)/);
  assert.match(css, /\.vfx-gale-sweep[\s\S]*?clip-path: polygon\(50% 50%, 50% 0%,[\s\S]*?50% 100%\)/);
});

test('迴身四方斬使用四個 60 度扇形，四向共用範圍並旋轉放大', () => {
  const skills2 = read('js/skills2.js');
  const vfx = read('js/vfx.js');
  const renderer = read('js/battle-renderer.js');
  const css = read('css/style.css');
  const shim = read('js/worker/shim.js');
  const protocol = read('js/worker/protocol.js');
  assert.match(skills2, /var crossRangePx = Math\.max\(frontFlyPx, sideFlyPx, meleeRangePx\)/);
  assert.match(skills2, /var dirFly = lvs\[6\] > 0 \? crossRangePx/);
  assert.match(skills2, /bfConeTargets\(baseAngle \+ directions\[di\], 60, dirRange, pool\)/);
  assert.match(skills2, /coneDeg: lvs\[6\] > 0 \? 60 : 0/);
  assert.match(skills2, /sgFilterCleaveSectorTargets\(crossed, projectile\.coneBaseAngle/);
  assert.match(skills2, /directionRanges: lvs\[6\] > 0 \? directionRanges : null/);
  assert.match(vfx, /function vfxCleaveSector\(/);
  assert.match(vfx, /vfxCleaveSector\(s, layer, from, cleaveDelay/);
  assert.match(vfx, /var rotationSpeedDeg = 45/);
  assert.match(vfx, /rotation = angle \+ rotationSpeedDeg \* \(elapsed \/ 1000\)/);
  assert.match(vfx, /targetRange = Array\.isArray\(s\.directionRanges\)/);
  assert.match(renderer, /function spawnCleaveSector\(/);
  assert.match(renderer, /spawnCleaveSector\(cleaveFrom\.x, cleaveFrom\.y, spec/);
  assert.match(renderer, /var rotationSpeed = Math\.PI \/ 4/);
  assert.match(renderer, /g\.rotation = baseRotation \+ rotationSpeed \* t/);
  assert.match(renderer, /Math\.PI \/ 6/);
  assert.match(renderer, /targetRange = Array\.isArray\(spec\.directionRanges\)/);
  assert.match(css, /\.vfx-cleave-sector[\s\S]*?clip-path: polygon\(50% 50%, 100% 21\.13%, 100% 78\.87%\)/);
  assert.match(shim, /rangeScale: Number\(spec\.rangeScale\) > 0 \? Number\(spec\.rangeScale\) : 1/);
  assert.match(shim, /directionRanges: Array\.isArray\(spec\.directionRanges\)/);
  assert.match(protocol, /rangeScale／directionRanges/);
});

test('迴旋斬大型弧光半徑在 DOM 與 Canvas 都縮為三分之一', () => {
  const css = read('css/style.css');
  const renderer = read('js/battle-renderer.js');

  assert.match(css, /\.vfx-cleave-arc[\s\S]*?width: 52px;[\s\S]*?height: 52px;[\s\S]*?margin: -26px 0 0 -26px/);
  assert.match(css, /\.vfx-cleave-arc::before[\s\S]*?border: 2\.6px solid transparent/);
  assert.match(css, /\.vfx-cleave-arc::after[\s\S]*?border-width: 0\.87px/);
  assert.match(renderer, /var rangeScale = Number\(spec && spec\.rangeScale\) > 0 \? Number\(spec\.rangeScale\) : 1;[\s\S]*?R = 86 \/ 3 \* rangeScale/);
  assert.match(renderer, /theme\.c1, width: 14\.3 \/ 3 \* rangeScale \* fade/);
  assert.match(renderer, /theme\.c2, width: 5\.2 \/ 3 \* rangeScale \* fade/);
});

test('迴旋斬主斬擊特效採藍色，且尺寸跟隨範圍倍率', () => {
  const skills2 = read('js/skills2.js');
  const vfx = read('js/vfx.js');
  const renderer = read('js/battle-renderer.js');
  assert.match(skills2, /lineLength: cleaveVfxRange, directionRanges: lvs\[6\] > 0 \? directionRanges : null,/);
  assert.match(skills2, /targetCap <= 0 && geomOk && typeof bfEnemiesInArea === 'function'/);
  assert.match(vfx, /var rangeScale = Number\(spec && spec\.rangeScale\) > 0 \? Number\(spec\.rangeScale\) : 1;/);
  assert.match(vfx, /var arcSize = 52 \* rangeScale/);
  assert.match(renderer, /R = 86 \/ 3 \* rangeScale/);
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
  assert.match(skills2, /variant: cleaveVariant, count: Math\.min\(5, slashes\), projectile: isFlying/);
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
  assert.match(renderer, /spec\.variant === 'thunder-strike'[\s\S]*?c1: '#c084fc'/,
    'Canvas 落雷應使用紫色雷電主題');
  assert.match(vfx, /spec\.variant === 'thunder-strike'[\s\S]*?c1: '#c084fc'/,
    'DOM 落雷應使用紫色雷電主題');
  assert.match(renderer, /spawnBolt\(null, id, spec, \(baseDelay \+ ti \* stagger\) \/ 1000, false, true\)/,
    'Canvas 落雷要走紫色雷電分支');
  assert.match(vfx, /var isPurple = spec\.variant === 'thunder-strike';/,
    'DOM 落雷要將地面衝擊標為紫色');
  assert.match(vfx, /\{ mega: true, purple: isPurple \}/,
    'DOM 落雷本體要使用紫色天雷畫法');

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
  const iceFieldCanvas = renderer.slice(renderer.indexOf('function spawnIceField'), renderer.indexOf('function spawnRiser', renderer.indexOf('function spawnIceField')));
  assert.match(iceFieldCanvas, /if \(isHoming\)[\s\S]*?fieldVfxSetPositionTarget\(current,/);
  assert.match(iceFieldCanvas, /else if \(isHoming\)[\s\S]*?fieldVfxStep\(fx, dt\)/);
  assert.doesNotMatch(iceFieldCanvas, /hdx = fx\.destX|hstep = fx\.speed/,
    '追蹤冰箭不得在顯示層另走速度追擊路徑');
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
  const iceFieldDom = vfx.slice(vfx.indexOf('function vfxIceField'), vfx.indexOf('/* 預設天降', vfx.indexOf('function vfxIceField')));
  assert.match(iceFieldDom, /vfxFieldMotionSet\(node, x, y, w, h/);
  assert.doesNotMatch(iceFieldDom, /vfxFieldMotionHome/,
    '追蹤冰箭 DOM 不得自建另一條速度追擊路徑');
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
  assert.match(skills2, /var flightSec = lineLen \/ sgIcearrowSpeed\(\);/);
  assert.match(skills2, /variant: 'ice-arrow-pierce'[\s\S]{0,320}travelMs: \[Math\.round\(flightSec \* 1000\)\]/);
  /* 貫穿段的傷害幾何與畫面方位都是「自己的箭道」（相鄰 15 度均等分）：
     兩者若不同角度，冰箭在轉入追擊時會憑空橫移。 */
  assert.match(skills2, /variant: 'ice-arrow-pierce'[\s\S]{0,200}angle: laneAngle/);
  /* 箭道上沒有敵人是常態（均等分散開），那支箭仍要飛出去：
     模擬層照送事件，顯示層不得因為 targets 是空的就整支不畫。 */
  assert.match(skills2, /sgEmitVfx\('icearrow', path, floatSel/);
  assert.match(renderer, /function spawnIcearrowPierce[\s\S]{0,400}if \(!targets\.length && !\(isFinite\(spec\.angle\) && Number\(spec\.lineLength\) > 0\)\) return;/);
  /* 還沒變成貫穿的第 1 階是單體攻擊：箭直接飛向自己那個敵人，
     不套均等分的箭道（那是貫穿之後才有的形狀）。 */
  assert.match(skills2, /variant: 'ice-arrow', elem: 'ice', count: 1,[\s\S]{0,180}angle: shotAngle/);
  assert.match(skills2, /var shotAngle = geomOk \? bfAngleTo\(arrows\[i\]\) : centerAngle;/);
  // Canvas：同一事件只建立一支沿 angle／length 前進的箭。
  assert.match(renderer, /function spawnIcearrowPierce[\s\S]*?spawnProjectile\(null, flight, spec, null, from, \{ angle: angle, length: length \}\)/);
  assert.match(renderer, /if \(spec\.variant === 'ice-arrow-pierce'\)[\s\S]{0,180}spawnIcearrowPierce\(spec, targets/);
  // DOM：同一事件只建立一個固定終點的 CSS 飛行節點。
  assert.match(vfx, /kind === 'projectile' && \(s\.variant === 'ice-arrow' \|\| s\.variant === 'ice-arrow-pierce'[\s\S]*?vfxProjectile\(s, layer, from, iceArrowEnd, iceArrowDelay, iceArrowTravel\)/);
  assert.match(vfx, /s\.variant === 'ice-arrow' \|\| s\.variant === 'ice-arrow-pierce'/);
  assert.match(renderer, /spec\.variant === 'ice-arrow' && isFinite\(spec\.angle\)/);
});

test('新版技能彈射與特效細化：連鎖閃電無天雷、水流彈藍色拋物彈射、血刃斬綠色子彈、大地守護白光光束、反傷無特效、逐風者淡綠白光龍捲風', () => {
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
  assert.match(vfx, /function isBloodbladeNoHitShakeSpec\(spec\)[\s\S]*?v === 'poison-tick'/);
  assert.match(vfx, /function vfxHitReact\(targetId, elem, delayMs, strong, targetGuard, suppressShake\)/);
  assert.match(vfx, /if \(!suppressShake\) visual\.classList\.add\('vfx-hit'\)/);
  assert.match(vfx, /_suppressHitShake: true[\s\S]*?pIds\[pi\], baseDelay \+ pFlight\)/,
    'DOM poison spread must not shake the target image');
  assert.match(renderer, /function isBloodbladeNoHitJoltSpec\(spec\)[\s\S]*?v === 'poison-tick'/);
  assert.match(renderer, /function hitReact\(elId, elem, strong, suppressJolt\)[\s\S]*?if \(!suppressJolt && canJolt\)/);
  assert.match(renderer, /hitReact\(tgtId, 'poison', false, true\)/,
    'Canvas poison spread must not jolt the target');
  assert.match(vfx, /function vfxAllowsSceneShake\(spec\)[\s\S]*?if \(v === 'poison-spread'\) return false;/,
    'DOM 毒霧感染不得觸發整個戰場的鏡頭震動');
  assert.match(renderer, /function isSpecialScreenShakeSpec\(spec\)[\s\S]*?if \(v === 'poison-spread'\) return false;/,
    'Canvas 毒霧感染不得觸發整個戰場的鏡頭震動');

  // 4. 反擊：移除反傷特效
  assert.doesNotMatch(skills2, /variant: 'counter-sweep'/);

  // 5. 大地守護：生命反射盾白光射向敵人
  assert.match(skills2, /variant: 'earth-reflect', elem: 'light'/);
  assert.match(vfx, /spec\.variant === 'earth-reflect'[\s\S]*?vfxBeam\(eSpec, layer, eFrom, ptList\[ei\]\)/);
  assert.match(renderer, /spec\.variant === 'earth-reflect'[\s\S]*?spawnBeam\(tgtId, eSpec\)/);

  // 6. 水龍捲維持冰系藍色；逐風者龍捲風改用風系淡綠白光
  assert.match(vfx, /vfx-water-tornado-pillar/);
  assert.match(vfx, /var isWater = spec && \(spec\.variant === 'water-tornado' \|\| spec\.elem === 'ice'\)/);
  assert.match(vfx, /vfx-wind-tornado-pillar/);
  assert.match(vfx, /vfx-wind-tongue/);
  assert.match(renderer, /spawnFirePillar\(spec\.area \|\| spec\.area, spec\)|spawnFirePillar\(a, spec\)/);
  assert.match(renderer, /var isWater = spec && \(spec\.variant === 'water-tornado' \|\| spec\.elem === 'ice'\)/);
  assert.match(renderer, /var isWind = spec && spec\.variant === 'wind-tornado'/);
  assert.match(renderer, /var baseColor = isWater \? 0x0369a1 : \(isWind \? 0x166534 : 0x7d1708\)/);
  assert.match(renderer, /var coreColor = isWater \? 0xf0f9ff : \(isWind \? 0xffffff : 0xffffbd\)/);
  assert.match(css, /\.vfx-water-tornado-pillar/);
  assert.match(css, /\.vfx-water-tongue/);
  assert.match(css, /\.vfx-wind-tornado-pillar[\s\S]*?#86efac[\s\S]*?#ffffff/);
  assert.match(css, /\.vfx-wind-tongue[\s\S]*?#86efac/);
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
  // Canvas：虛空斬的半徑成長沿用模擬層的 area.grow，四道各自保留相位與節點
  assert.match(renderer, /function spawnVoidDisc\(spec\)/);
  assert.match(renderer, /disc\.r \+= grow \* dt;/);
  assert.match(renderer, /var dur = Math\.max\(0\.5, Number\(spec && spec\.dur\) \|\| 6\);/);
  assert.match(renderer, /dur \* 1000 \+ 500/);
  assert.match(renderer, /形成連續螺旋/);
  assert.match(skills2, /grow: f\.growPxPerSec \|\| 0/);
  /* 合併鍵：第 7 階本體斬出的那幾道沿用 'void-disc-<i>'（重複施放時延長既有圓盤），
     超神【虛空滅界】每 2 秒自動斬出的那一道另外帶序號，否則每一道都會被當成同一道。 */
  assert.match(skills2, /var keyBase = opts\.keyPrefix \|\| 'void-disc-';/);
  assert.match(skills2, /fieldKey: keyBase \+ i/);
  assert.match(skills2, /keyPrefix: 'void-anni-' \+ \(\+\+SG_VOID_DISC_SEQ\) \+ '-'/);
  assert.match(skills2, /startAng: baseAngle \+ Math\.PI \* 2 \* i \/ discs/);
  assert.match(skills2, /rings: \[\{ r: startR, spin: spin \}\]/);
  assert.match(renderer, /var key = 'void:' \+ \(a\.id \|\|/);
  assert.match(renderer, /var startAngle = Number\(a\.startAng\)/);
  assert.match(renderer, /drawBlade\(startAngle \+ spin \* trailT/);
  // Canvas：屏障／神體／撕裂是釘在自身的風殼
  assert.match(renderer, /function spawnStormShell\(spec\)/);
  assert.match(renderer, /spec\.variant === 'storm-barrier' \|\| spec\.variant === 'storm-god'/);
  // Canvas：追跡風刃只共用追蹤移動，不得共用冰晶／藍球外觀
  assert.match(renderer, /variant === 'ice-arrow-homing' \|\| variant === 'wind-blade-homing'/);
  const windFieldCanvas = renderer.slice(renderer.indexOf('function spawnIceField'), renderer.indexOf('function spawnRiser', renderer.indexOf('function spawnIceField')));
  assert.match(windFieldCanvas, /fx\.variant === 'wind-blade-homing'[\s\S]*?drawWindCrescent\(g,/);
  assert.match(windFieldCanvas, /variant === 'wind-blade-homing'[\s\S]*?fieldVfxSetPositionTarget\(current,/);
  assert.match(windFieldCanvas, /fx\.variant === 'wind-blade-homing'[\s\S]*?fieldVfxStep\(fx, dt\)/);
  assert.match(windFieldCanvas, /fx\.variant !== 'wind-blade-homing'/);

  // DOM：大型風刃沿用直線飛行；追跡風刃沿用移動場域但只建立小型風刃
  assert.match(vfx, /s\.variant === 'wind-blade' \|\| s\.variant === 'wind-blade-small'/);
  assert.match(vfx, /s\.variant === 'ice-arrow-homing' \|\| s\.variant === 'wind-blade-homing'/);
  assert.match(vfx, /'vfx-wind-homing'/);
  const windFieldDom = vfx.slice(vfx.indexOf('function vfxIceField'), vfx.indexOf('/* 預設天降', vfx.indexOf('function vfxIceField')));
  assert.match(windFieldDom, /variant === 'wind-blade-homing'[\s\S]*?vfx-wind-homing-blade/);
  assert.match(windFieldDom, /variant === 'wind-blade-homing'[\s\S]*?不再建立冰晶尖刺或藍色球體/);
  assert.doesNotMatch(windFieldDom, /variant === 'wind-blade-homing'[\s\S]{0,260}vfxFieldMotionHome/);
  assert.match(vfx, /s\.variant === 'wind-blade-homing' \? null : vfxCellsRect\(spec\.cells, layer\)/);
  assert.match(vfx, /function vfxVoidDisc\(spec, layer, rect\)/);
  assert.match(vfx, /s\.variant === 'void-disc'\) vfxVoidDisc\(s, layer, rect\)/);
  assert.match(vfx, /var startAng = Number\(area\.startAng\)/);
  const voidDom = vfx.slice(vfx.indexOf('function vfxVoidDisc'), vfx.indexOf('/* ---- 我方增益', vfx.indexOf('function vfxVoidDisc')));
  assert.match(voidDom, /blade\.style\.setProperty\('--void-angle', startDeg \+ 'deg'\)/);
  assert.doesNotMatch(voidDom, /for \(var i = 0; i < 4; i\+\+\)/, '每個 DOM 節點只畫一道斬擊');

  // CSS：風系的投射物／受擊／光環配色，以及技能標籤
  assert.match(css, /\.vfx-proj-wind \.vfx-proj-core/);
  assert.match(css, /\.vfx-impact-wind \.vfx-p/);
  assert.match(css, /\.vfx-aura-wind \.vfx-aura-p/);
  assert.match(css, /\.vfx-wind-homing \{/);
  assert.match(css, /\.vfx-wind-homing-blade\s*\{[\s\S]*?clip-path: path/);
  assert.match(css, /\.vfx-wind-homing\s*\{[\s\S]*?background: transparent[\s\S]*?border: 0[\s\S]*?box-shadow: none/);
  assert.doesNotMatch(css, /\.vfx-wind-homing \.vfx-ice-shard/);
  assert.match(css, /\.vfx-void-disc \{/);
  assert.match(css, /vfxVoidDiscBlade/);
});

test('全技能移動與傷害範圍使用連續座標，不以棋盤格逐步跳動', () => {
  const battlefield = read('js/battlefield.js');
  const legacySkills = read('js/skills.js');
  const skills2 = read('js/skills2.js');
  const vfx = read('js/vfx.js');
  const renderer = read('js/battle-renderer.js');

  // 新版 23 個技能群組共用的飛行物、移動場域、傷害幾何與環繞場域路徑。
  const projectileTick = skills2.slice(
    skills2.indexOf('function sgTickFlyingProjectiles'),
    skills2.indexOf('function ', skills2.indexOf('function sgTickFlyingProjectiles') + 1)
  );
  const groundMove = skills2.slice(
    skills2.indexOf('function sgGroundMove'),
    skills2.indexOf('function sgGroundChaseDest')
  );
  const groundVictims = skills2.slice(
    skills2.indexOf('function sgGroundVictims'),
    skills2.indexOf('function ', skills2.indexOf('function sgGroundVictims') + 1)
  );
  const orbitStep = skills2.slice(
    skills2.indexOf('function sgOrbitStep'),
    skills2.indexOf('function ', skills2.indexOf('function sgOrbitStep') + 1)
  );
  const bfSegment = battlefield.slice(
    battlefield.indexOf('function bfSegmentTargets'),
    battlefield.indexOf('function ', battlefield.indexOf('function bfSegmentTargets') + 1)
  );
  const scheduler = legacySkills.slice(
    legacySkills.indexOf('function tickSkillSchedulers'),
    legacySkills.indexOf('/* ---- periodicField', legacySkills.indexOf('function tickSkillSchedulers'))
  );

  assert.match(projectileTick, /\(now - projectile\.startAt\) \* projectile\.speed/);
  assert.match(projectileTick, /bfSegmentTargets\(projectile\.origin/);
  assert.match(groundMove, /f\.pos\.x \+= dx \/ dist \* step/);
  assert.match(groundMove, /f\.pos\.y \+= dy \/ dist \* step/);
  // 有轉彎半徑的追擊（追跡風刃／追蹤冰箭）沿目前方向前進，同樣是連續浮點位移
  assert.match(groundMove, /f\.pos\.x \+= Math\.cos\(f\.moveAngle\) \* step/);
  assert.match(groundMove, /f\.pos\.y \+= Math\.sin\(f\.moveAngle\) \* step/);
  assert.doesNotMatch(groundMove, /Math\.(round|floor|ceil)/);
  assert.match(groundVictims, /bfSegmentTargets\(origin, axis/);
  assert.match(groundVictims, /bfEnemiesInArea\(\{ x: f\.pos\.x, y: f\.pos\.y/);
  assert.match(orbitStep, /orb\.ang \+= orb\.spin \* dt/);
  assert.match(orbitStep, /f\.rings\[gi\]\.r \+= f\.growPxPerSec \* dt/);
  assert.doesNotMatch(orbitStep, /Math\.(round|floor|ceil)/);
  assert.match(bfSegment, /Math\.cos\(angle\)/);
  assert.match(bfSegment, /Math\.sqrt\(ox \* ox \+ oy \* oy\)/);
  assert.doesNotMatch(bfSegment, /Math\.(round|floor|ceil)/);
  // 舊版週期領域只更新時間／狀態，不會把傷害範圍座標量化或逐格搬移。
  assert.doesNotMatch(scheduler, /f\.area\.(x|y)\s*[+\-]=/);

  // 所有會移動或改變範圍的畫面路徑都必須採快照補間；追蹤技能不能另走速度積分。
  const rendererField = renderer.slice(
    renderer.indexOf('function spawnIceField'),
    renderer.indexOf('function spawnRiser', renderer.indexOf('function spawnIceField'))
  );
  const domField = vfx.slice(
    vfx.indexOf('function vfxIceField'),
    vfx.indexOf('/* 預設天降', vfx.indexOf('function vfxIceField'))
  );
  const rendererMire = renderer.slice(
    renderer.indexOf('function spawnMirePool'),
    renderer.indexOf('function spawnIceField', renderer.indexOf('function spawnMirePool'))
  );
  const rendererOrb = renderer.slice(
    renderer.indexOf('function spawnThunderOrbField'),
    renderer.indexOf('function spawnThunderFall', renderer.indexOf('function spawnThunderOrbField'))
  );
  const domMire = vfx.slice(
    vfx.indexOf('function vfxMirePool'),
    vfx.indexOf('function vfxThunderOrb', vfx.indexOf('function vfxMirePool'))
  );
  const domOrb = vfx.slice(
    vfx.indexOf('function vfxThunderOrb'),
    vfx.indexOf('function vfxIceField', vfx.indexOf('function vfxThunderOrb'))
  );

  assert.match(rendererField, /fieldVfxSetPositionTarget\(/);
  assert.match(rendererField, /fieldVfxStep\(fx, dt\)/);
  assert.doesNotMatch(rendererField, /hdx = fx\.destX|hstep = fx\.speed/);
  assert.match(rendererMire, /fieldVfxSetTarget\(/);
  assert.match(rendererOrb, /fieldVfxSetPositionTarget\(/);
  assert.match(domField, /vfxFieldMotionSet\(node, x, y, w, h/);
  assert.doesNotMatch(domField, /vfxFieldMotionHome/);
  assert.match(domMire, /vfxFieldMotionSet\(node, x, y, w, h/);
  assert.match(domOrb, /vfxFieldMotionSet\(node, cx - d \/ 2/);
});

test('追蹤風刃不建立綠色方框，且舊事件不會以座標重建跳格節點', () => {
  const renderer = read('js/battle-renderer.js');
  const vfx = read('js/vfx.js');
  const css = read('css/style.css');
  const index = read('index.html');
  const bridge = read('js/bridge.js');
  const worker = read('js/worker/sim.worker.js');

  const rendererField = renderer.slice(
    renderer.indexOf('function spawnIceField'),
    renderer.indexOf('function spawnRiser', renderer.indexOf('function spawnIceField'))
  );
  const domField = vfx.slice(
    vfx.indexOf('function vfxIceField'),
    vfx.indexOf('/* 預設天降', vfx.indexOf('function vfxIceField'))
  );

  // 風系泛用 aura 是最後防線：不能把追蹤風刃或缺 variant 的舊事件畫成方框。
  assert.match(renderer, /spec\.elem === 'wind'\)\) return;/);
  assert.match(renderer, /spec\.fxKind === 'aura' && spec\.elem === 'wind' && !spec\.variant\) return/);
  assert.match(vfx, /kind === 'aura' && s\.elem === 'wind' && !s\.variant\) return/);
  assert.match(vfx, /if \(spec && spec\.elem === 'wind'\) return null;/);

  // 追蹤場域沒有穩定 id 時禁止以 Math.round(x/y) 當鍵；否則每跨一格就會新增半月刃。
  assert.match(renderer, /function fieldVfxKey\(area, variant\)/);
  assert.match(renderer, /if \(variant === 'ice-arrow-homing' \|\| variant === 'wind-blade-homing'\) return null;/);
  assert.match(rendererField, /var key = fieldVfxKey\(a, variant\);[\s\S]*if \(!key\) return null;/);
  assert.match(vfx, /function vfxFieldKey\(area, variant\)/);
  assert.match(domField, /var key = vfxFieldKey\(area, variant\);[\s\S]*if \(!key\) return null;/);

  // 位置與轉彎都要是連續的：位置補間保留最低時長，方向以角度最短路徑平滑追上。
  assert.match(renderer, /var FIELD_VFX_MIN_MOTION_SEC = 0\.12/);
  assert.match(rendererField, /fieldVfxWindAngleStep\(fx, dt\)/);
  assert.match(renderer, /Math\.atan2\(Math\.sin\(target - fx\.windAngle\), Math\.cos\(target - fx\.windAngle\)\)/);
  assert.match(vfx, /return Math\.max\(0\.12, isFinite\(sec\)/);
  assert.match(css, /\.vfx-wind-homing-blade[\s\S]*?transition: transform 120ms linear/);

  /* 主頁與 Worker 必須換版本，否則瀏覽器會繼續執行舊的綠色方框／逐格路徑。
     這幾條釘的是「目前的版號」——之後任何人再動這些檔、把版號往上推時，
     連同這裡一起更新即可（釘住的用意是禁止「改了檔卻沒換版號」）。 */
  assert.match(index, /css\/style\.css\?v=1\.0\.59/);
  assert.match(index, /js\/status\.js\?v=1\.0\.21/);
  assert.match(index, /js\/vfx\.js\?v=1\.0\.73/);
  assert.match(index, /js\/battle-renderer\.js\?v=1\.6\.106/);
  assert.match(index, /js\/skills2\.js\?v=1\.0\.86/);
  assert.match(bridge, /WORKER_ASSET_VERSION = '20260828-wind-vacuum-legendary'/);
  assert.match(worker, /\.\.\/skills\.js\?v=20260828-skill-cast-reset/);
  assert.match(worker, /\.\.\/skills2\.js\?v=20260828-wind-vacuum-legendary/);
  assert.match(worker, /\.\.\/legendary\.js\?v=20260826-chain-thunder-legendary/);
});

/* 2026-08-19 回報三連：真空斬系的綠色落雷、風刃地板綠方塊、風刃一格一格移動。
   三者都在顯示層：事件本身是對的，是分派表少了分支、或補間長度與事件節奏對不上。 */
test('風系事件不得借用雷鏈與泛用方框的畫法', () => {
  const renderer = read('js/battle-renderer.js');
  const vfx = read('js/vfx.js');

  const canvasChain = renderer.slice(
    renderer.indexOf('function handleChainVfx'),
    renderer.indexOf('/* ============ VFX 事件分派')
  );
  const domChain = vfx.slice(
    vfx.indexOf('function vfxChain'),
    vfx.indexOf('function vfxSmite')
  );

  // 1. 風切擴散有自己的畫法（小風刃掠過去），不再掉進 chain 結尾的天頂大雷。
  assert.match(renderer, /function spawnWindRendSpread\(targets, spec, baseDelay\)/);
  assert.match(canvasChain, /spec\.variant === 'wind-rend-spread'/);
  assert.match(canvasChain, /spawnWindRendSpread\(targets, spec, baseDelay\)/);
  assert.match(domChain, /spec\.variant === 'wind-rend-spread'/);

  // 2. 天雷折射鏈是【潛能：連鎖閃電】專屬：未知變體一律不得掉進來（改白名單）。
  //    spawnBolt 會用事件屬性著色，風系掉進去就是「綠色落雷」。
  assert.match(canvasChain, /spec\.variant !== 'chain' && spec\.elem !== 'lightning'/);
  // 白名單守門必須排在天雷那一段之前，否則等於沒擋。
  assert.ok(canvasChain.indexOf("spec.variant !== 'chain' && spec.elem !== 'lightning'") <
    canvasChain.indexOf('spawnContinuousChainLightning'));
  assert.match(domChain, /spec\.variant !== 'chain' && spec\.elem && spec\.elem !== 'lightning'/);

  // 3. 狂風碎裂的沿途脈衝走 burst：要畫氣浪，且不得退回 spawnAreaFlash 的綠色方框。
  const burstCase = renderer.slice(
    renderer.indexOf("      case 'burst':"),
    renderer.indexOf("      case 'beam':")
  );
  assert.match(burstCase, /spec\.variant === 'wind-burst'[\s\S]*?spawnWindBurst\(spec\)/);
  assert.match(burstCase, /!targets\.length && rect && spec\.elem !== 'wind'\) spawnAreaFlash/);
});

test('追蹤場域的畫面位置以指數跟隨逼近權威座標（不做固定時長補間）', () => {
  const renderer = read('js/battle-renderer.js');
  const rendererField = renderer.slice(
    renderer.indexOf('function spawnIceField'),
    renderer.indexOf('function spawnRiser', renderer.indexOf('function spawnIceField'))
  );

  /* 事件的到達節奏本身就不平均（實測同一顆場域：204ms 帶兩步、緊接著 0ms 補一個
     零頭步、再來 94/110/118ms 各一步）。固定時長的補間在事件早到時要衝刺、晚到時
     會走完停住——以實測序列回放有 13.9% 的畫格完全靜止，那就是「一格一格移動」。
     指數跟隨的速度只取決於離權威座標多遠，因此不會有硬停頓（同序列降到 4.9%）。 */
  assert.match(renderer, /var FIELD_VFX_FOLLOW_TAU_SEC = 0\.14/);
  assert.match(renderer, /function fieldVfxFollowStep\(fx, dt\)/);
  assert.match(renderer, /var want = dist \/ FIELD_VFX_FOLLOW_TAU_SEC;/);
  // 追趕速度要以模擬層的權威速度為上限，不得用瞬移補上落後的距離
  assert.match(renderer, /Number\(fx\.speed\) > 0 \? Number\(fx\.speed\) : want\) \* FIELD_VFX_FOLLOW_MAX_MULT/);
  assert.match(rendererField, /fieldVfxSetFollowTarget\(current, Number\(a\.x\), Number\(a\.y\)\)/);
  assert.match(rendererField, /fieldVfxFollowStep\(fx, dt\)/);
  // 朝向取「目前位置 → 權威座標」：跟隨模型沒有補間起點可用
  assert.match(renderer, /var dx = fx\.motionToX - fx\.x, dy = fx\.motionToY - fx\.y;/);
});

/* 超神進化【地爆天星】（2026-08-24 使用者指定的三項調整）：
   兩套顯示層都必須認得那兩個新變體。不認得的變體只會退回泛用畫法——
   那正好是「看起來沒壞、但預警與超巨型殞石全部消失」的失敗模式，所以在這裡釘死。 */
test('地爆天星：黑影預警與超巨型殞石在 Canvas 與 DOM 兩套顯示層都有專屬畫法', () => {
  const skills2 = read('js/skills2.js');
  const vfx = read('js/vfx.js');
  const renderer = read('js/battle-renderer.js');
  const css = read('css/style.css');

  // 模擬層：三段式節奏（預警 → 下墜 → 落地），且體積與下墜倍率是共用語意參數
  assert.match(skills2, /var SG_STARFALL_WARN_SEC = 5;/);
  assert.match(skills2, /var SG_STARFALL_SIZE_MULT = 3;/);
  assert.match(skills2, /var SG_STARFALL_FALL_MULT = 2;/);
  assert.match(skills2, /variant: 'starfall-shadow'/);
  assert.match(skills2, /variant: 'meteor-starfall'/);
  assert.match(skills2, /variant: 'starfall-impact'/);
  assert.match(skills2, /sizeMult: SG_STARFALL_SIZE_MULT/);
  // sgEmitPlayerVfx 必須把 travelMs／sizeMult 帶出去（殞石不掛在任何敵人身上）
  assert.match(skills2, /extra\.travelMs > 0\) spec\.travelMs = \[Number\(extra\.travelMs\)\]/);
  assert.match(skills2, /extra\.sizeMult > 0\) spec\.sizeMult = Number\(extra\.sizeMult\)/);

  // Canvas：專屬畫法 ＋ 暗紅色票 ＋ 前方衝擊波
  assert.match(renderer, /function spawnStarfallShadow\(spec\)/);
  assert.match(renderer, /function spawnStarfallMeteor\(spec\)/);
  assert.match(renderer, /function starfallBowShock\(radius\)/);
  assert.match(renderer, /PIXI_FLARE_COLORS_STARFALL/);
  assert.match(renderer, /spec\.variant === 'starfall-shadow'\) \{ spawnStarfallShadow/);
  assert.match(renderer, /spec\.variant === 'meteor-starfall'\) \{ spawnStarfallMeteor/);
  assert.match(renderer, /spec\.variant === 'starfall-impact'/);

  // Worker → 主執行緒是白名單式事件：sizeMult 漏了殞石就不會變大，而且完全不會報錯
  const shim = read('js/worker/shim.js');
  assert.match(shim, /sizeMult: Number\(spec\.sizeMult\) > 0 \? Number\(spec\.sizeMult\) : 0/);
  assert.match(vfx, /sizeMult: Number\(spec\.sizeMult\) > 0 \? Number\(spec\.sizeMult\) : 0/);
  assert.match(read('js/worker/sim.worker.js'), /shim\.js\?v=5/);

  // DOM（高塔）：同樣兩支，且在 rect 解析之前就攔下來
  assert.match(vfx, /function vfxStarfallShadow\(spec, layer\)/);
  assert.match(vfx, /function vfxStarfallMeteor\(spec, layer, travelMs\)/);
  assert.match(vfx, /s\.variant === 'starfall-shadow'\) \{ vfxStarfallShadow/);
  assert.match(vfx, /s\.variant === 'meteor-starfall'\) \{/);

  // CSS：黑影擴大、暗紅濾鏡、前方衝擊波
  assert.match(css, /\.vfx-starfall-shadow \{/);
  assert.match(css, /@keyframes vfxStarfallShadow/);
  assert.match(css, /\.vfx-meteor-starfall \{[\s\S]*?filter: brightness/);
  assert.match(css, /\.vfx-starfall-shock \{/);
});
