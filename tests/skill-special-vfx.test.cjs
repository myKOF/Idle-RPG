const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const skills = read('js/skills.js');
const vfx = read('js/vfx.js');
const renderer = read('js/battle-renderer.js');
const shim = read('js/worker/shim.js');

test('三個指定技能使用專用 VFX 與命中規格', () => {
  assert.match(skills, /chainLightning:[\s\S]*?hits:\s*3/);
  assert.match(skills, /arcaneBarrage:\s*\{\s*variant:\s*'arcane-barrage'/);
  assert.match(skills, /meteor:\s*\{\s*fxKind:\s*'rain',\s*variant:\s*'meteor'/);

  assert.match(vfx, /function vfxBarrageProjectile\(/);
  assert.match(vfx, /var mx0 = cx, my0 = rect\.y - 190/);
  assert.match(vfx, /flash\.style\.borderRadius = '50%'/);

  assert.match(renderer, /function spawnBarrageMissile\(/);
  assert.match(renderer, /if \(spec\.variant === 'arcane-barrage'/);
  assert.match(renderer, /for \(var lane = 0; lane < 3; lane\+\+\)[\s\S]*spawnBarrageMissile\(id, spec, -1, lane[\s\S]*spawnBarrageMissile\(id, spec, 1, lane/);
  assert.match(renderer, /for \(var strike = 0; strike < 3; strike\+\+\)/);
  assert.match(renderer, /spawnFireShockwave\(cx, cy/);
  assert.match(renderer, /var outerWidth = 13 - 10\.5 \* q/);
  assert.match(shim, /area: spec\.area \|\| null/);
});
