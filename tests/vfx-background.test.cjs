const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const vfx = fs.readFileSync(path.join(root, 'js', 'vfx.js'), 'utf8');

test('背景切換會停用並清除戰鬥特效，回前景後重新啟用', () => {
  assert.match(ui, /function handleVisibilityChange\(\)[\s\S]*?vfxSetEnabled\(false\)[\s\S]*?vfxSetEnabled\(true\)/);
  assert.match(vfx, /function vfxSetEnabled\(on\)[\s\S]*?if \(!on\) vfxClear\(\)/);
  assert.match(vfx, /function vfxClear\(\)[\s\S]*?_vfxGeneration\+\+/);
  assert.match(vfx, /vfx-hit-strong/);
  assert.match(vfx, /vfx-scene-shake-strong/);
});

test('被清除的延遲受擊與畫面震動 callback 不會在回前景後復活', () => {
  assert.match(vfx, /if \(!_vfxEnabled \|\| generation !== _vfxGeneration\) return;/);
  assert.match(vfx, /generation !== _vfxGeneration \|\| card\._vfxHitUntil !== until/);
});
