const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Canvas 投射物預判移動目標，接近目標時可提前命中', () => {
  const renderer = read('js/battle-renderer.js');

  assert.match(renderer, /function projectileTargetVelocity\(targetId\)[\s\S]*?samples\.length < 2/);
  assert.match(renderer, /function projectileTargetPoint\(targetId, horizonSec\)[\s\S]*?velocity\.x \* horizon/);
  assert.match(renderer, /function projectileNearTarget\(x, y, targetId\)[\s\S]*?radius \* radius/);

  const projectile = renderer.slice(
    renderer.indexOf('function spawnProjectile('),
    renderer.indexOf('function spawnBarrageMissile(')
  );
  assert.match(projectile, /projectileTargetPoint\(targetId, Math\.max\(0, dur - t\)\)/);
  assert.match(projectile, /if \(k >= 1 \|\| \(!path && projectileNearTarget\(node\.x, node\.y, targetId\)\)\)/);
  assert.doesNotMatch(projectile, /var to = posOf\(targetId\);/);

  const barrage = renderer.slice(
    renderer.indexOf('function spawnBarrageMissile('),
    renderer.indexOf('function spawnTrailDot(')
  );
  assert.match(barrage, /projectileTargetPoint\(targetId, Math\.max\(0, dur - t\)\)/);
  assert.match(barrage, /if \(k >= 1 \|\| projectileNearTarget\(x, y, targetId\)\)/);

  /* 預判點必須低通後才餵給彈體位置：速度是用兩個 5Hz 取樣估的，因此它是階梯
     函數——目標一停下來，預判點會在一幀之內往回跳「速度 × 預判時間」那麼遠。
     彈體位置是預判點的函數，那一跳就是畫面上的瞬移（AI_RULES 8.3.1）。 */
  assert.match(renderer, /function projectileAimStep\(aim, want, dt\)/);
  assert.match(renderer, /var PROJECTILE_AIM_TAU_SEC = /);
  assert.match(projectile, /projectileAimStep\(aim, projectileTargetPoint\(/);
  assert.match(barrage, /projectileAimStep\(aim,/);
});

/* 轉彎不得折角（AI_RULES 8.3.1）：連鎖彈射與迴旋飛刀都是「飛到 A 再飛到 B」，
   每一段各自畫直線的話，轉折處的方向會在一幀之內整個換掉。 */
test('Canvas 投射物的轉彎是連續的弧，且抵達時刻不變', () => {
  const renderer = read('js/battle-renderer.js');

  // 以「進場航向」為起始切線的二次貝茲；正對後方時要夾角度，避免退化成原路倒退
  assert.match(renderer, /function curveControl\(fromX, fromY, toX, toY, enterAngle\)/);
  assert.match(renderer, /Math\.max\(-CURVE_ENTRY_MAX_RAD, Math\.min\(CURVE_ENTRY_MAX_RAD, diff\)\)/);
  assert.match(renderer, /function curveAt\(fromV, ctrlV, toV, k\)/);
  assert.match(renderer, /function curveHeading\(fromX, fromY, ctrl, toX, toY, k\)/);
  // 機身朝向逐幀追上切線，不在轉折處瞬間翻面
  assert.match(renderer, /var PROJECTILE_FACING_TAU_SEC = /);

  // 連鎖的每一跳都要接上一段的航向
  assert.match(renderer, /function chainEnterAngle\(targets, hopIndex\)/);
  const chain = renderer.slice(renderer.indexOf('function handleChainVfx('),
    renderer.indexOf('/* ============ VFX 事件分派'));
  const hops = chain.match(/enterAngle: chainEnterAngle\(targets, hopIndex\)/g) || [];
  assert.ok(hops.length >= 2, '飛刀彈射與水球彈跳都要帶進場航向');
  const spreads = chain.match(/enterAngle: [pf]Enter/g) || [];
  assert.ok(spreads.length >= 2, '毒霧／寒霜傳染也要帶進場航向');

  // 迴旋飛刀：貫穿之後走三次貝茲的迴旋弧，不再 180 度原路折返
  const proj = renderer.slice(renderer.indexOf('function spawnProjectile('),
    renderer.indexOf('function spawnIcearrowPierce('));
  assert.match(proj, /cubicAt\(throughX, c1x, c2x, targetNow\.x, q2\)/);
  assert.doesNotMatch(proj, /outbound \? from\.x : throughX, outbound \? throughX : targetNow\.x/,
    '折返段不得是「起訖點對調的直線」');

  // 奧術彈幕：一條貝茲走完散開→過彎→追擊，不是兩段各自收斂到零速度
  const barrage = renderer.slice(renderer.indexOf('function spawnBarrageMissile('),
    renderer.indexOf('function spawnTrailDot('));
  assert.match(barrage, /curveAt\(start\.x, turn\.x, targetAim\.x, q\)/);
  assert.doesNotMatch(barrage, /if \(k < 0\.38\)/, '不得再用兩段補間在轉彎處接起來');
});
