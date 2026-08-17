/* 落雷／雷殞的延遲特效不能在目標死亡後繼續播放。
   這裡驗證兩條渲染路徑都有「落雷專用」取消守門，且不把一般普攻的 dying
   致死一擊規則一併改掉。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Canvas 落雷與雷殞在目標死亡後取消延遲中的特效', () => {
  const renderer = read('js/battle-renderer.js');

  assert.match(renderer, /function isTargetBoundThunderVfx\(spec\)/);
  assert.match(renderer, /spec\.variant === 'thunder-strike' \|\| spec\.variant === 'thunder-fall'/);
  assert.match(renderer, /function vfxTargetLiveForSpec\(spec, id\)/);
  assert.match(renderer, /ent\.state !== 'dying' && ent\.state !== 'gone'/);
  assert.match(renderer, /if \(spec && \(spec\.variant === 'thunder-strike' \|\| spec\.variant === 'thunder-fall'\)\) \{\s*return !vfxTargetsLive\(spec\);/);
  assert.match(renderer, /typeof targetPtOrId === 'string' && !vfxTargetLiveForSpec\(spec, targetPtOrId\)/);
  assert.match(renderer, /spawnTargetTelegraph\(spec, to\.x, to\.y, radius, delaySec, dur, targetId\)/);
  assert.match(renderer, /typeof targetId === 'string' && !vfxTargetLiveForSpec\(spec, targetId\)/);
  assert.match(renderer, /function spawnImpact\(x, y, spec, strong, targetGuard\)/);
});

test('DOM 落雷元件共用目標守門，死亡後移除雷柱、落點與爆點', () => {
  const vfx = read('js/vfx.js');

  assert.match(vfx, /function vfxTargetIsLive\(targetId\)/);
  assert.match(vfx, /card\.classList\.contains\('is-dead'\)/);
  assert.match(vfx, /function vfxTargetGuard\(targetId\)/);
  assert.match(vfx, /function vfxTrack\(node, ms, targetGuard\)/);
  assert.match(vfx, /requestAnimationFrame\(checkTarget\)/);
  assert.match(vfx, /function vfxSmite\(spec, layer, pt, targetId, delayMs, travelMs\)/);
  assert.match(vfx, /var targetGuard = vfxTargetGuard\(targetId\)/);
  assert.match(vfx, /vfxLightningGroundImpact\(spec, layer, pt, delayMs \+ 30, false, targetGuard\)/);
  assert.match(vfx, /delayMs \+ 40, targetGuard\)/);
});
