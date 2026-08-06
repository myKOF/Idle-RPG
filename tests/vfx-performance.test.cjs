const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const vfx = fs.readFileSync(path.join(root, 'js', 'vfx.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

function loadVfx() {
  const context = {
    console,
    Math,
    Date,
    Object,
    Infinity,
    document: {
      hidden: false,
      getElementById() { return null; },
      querySelectorAll() { return []; }
    },
    setTimeout() { return 1; },
    clearTimeout() {},
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {}
  };
  vm.runInNewContext(vfx, context, { filename: 'js/vfx.js' });
  return context;
}

test('VFX exposes quality tiers and bounded frame scheduling', () => {
  assert.match(vfx, /VFX_QUALITY_LEVELS = \{ FULL: 'full', REDUCED: 'reduced', OFF: 'off' \}/);
  assert.match(vfx, /VFX_EVENT_QUEUE_MAX = 48/);
  assert.match(vfx, /VFX_FRAME_BUDGET_FULL = 8/);
  assert.match(vfx, /VFX_FRAME_BUDGET_REDUCED = 4/);
  assert.match(vfx, /VFX_MERGE_WINDOW_MS = 120/);
  assert.match(vfx, /function vfxScheduleFlush\(\)/);
  assert.match(vfx, /function vfxFlushQueue\(\)/);
  assert.match(vfx, /function vfxEnqueue\(spec\)/);
  assert.match(vfx, /if \(_vfxEventQueue\.length >= VFX_EVENT_QUEUE_MAX\) _vfxEventQueue\.shift\(\)/);
});

test('Reduced VFX removes the most expensive cosmetic work', () => {
  assert.match(vfx, /function vfxSpecForQuality\(spec\)/);
  assert.match(vfx, /if \(spec\.fxKind === 'aura'\) return null/);
  assert.match(vfx, /out\.count = 1/);
  assert.match(vfx, /targetLimit = spec\.fxKind === 'chain' \|\| spec\.variant === 'chain' \? 2 : 3/);
  assert.match(vfx, /if \(_vfxQuality === VFX_QUALITY_LEVELS\.REDUCED && !strong\) return/);
  assert.match(vfx, /if \(_vfxQuality !== VFX_QUALITY_LEVELS\.FULL\) return/);
  assert.match(vfx, /if \(_vfxQuality === VFX_QUALITY_LEVELS\.REDUCED\) n = 1/);
  assert.match(vfx, /function renderCombatVfx\(spec\)/);
  assert.match(vfx, /function playCombatVfx\(spec\)[\s\S]*vfxEnqueue\(next\)/);
});

test('Quality changes and short-burst events are bounded at runtime', () => {
  const context = loadVfx();
  assert.equal(context.vfxQuality(), 'full');
  context.vfxSetQuality('reduced');
  assert.equal(context.vfxQuality(), 'reduced');

  const reduced = context.vfxSpecForQuality({
    fxKind: 'chain', count: 5,
    targets: ['a', 'b', 'c', 'd'],
    travelMs: [1, 2, 3, 4]
  });
  assert.equal(reduced.count, 1);
  assert.deepEqual(reduced.targets, ['a', 'b']);
  assert.deepEqual(reduced.travelMs, [1, 2]);
  assert.equal(context.vfxSpecForQuality({ fxKind: 'aura' }), null);

  context.playCombatVfx({ fxKind: 'impact', cat: 'basic', elem: 'fire', targets: ['a'] });
  context.playCombatVfx({ fxKind: 'impact', cat: 'basic', elem: 'fire', targets: ['a'] });
  assert.equal(context._vfxEventQueue.length, 1);
  context.vfxSetQuality('off');
  assert.equal(context._vfxEventQueue.length, 0);
  assert.equal(context.vfxQuality(), 'off');
});

test('Target coordinates are cached and invalidated after layout changes', () => {
  assert.match(vfx, /function vfxLayerRect\(layer\)/);
  assert.match(vfx, /_vfxLayerRectCache\.version === _vfxLayoutVersion/);
  assert.match(vfx, /_vfxAnchorCache\[elId\] = \{ target: target, layer: layer, version: _vfxLayoutVersion, rect: r \}/);
  assert.match(vfx, /function vfxInvalidateLayout\(\)[\s\S]*_vfxAnchorCache = Object\.create\(null\)/);
});

test('UI protects equipment input and selects reduced quality outside the battle tab', () => {
  assert.match(ui, /function shouldRenderBattle\(now\)/);
  assert.match(ui, /if \(now - \(UI\.lastInteractionAt \|\| 0\) < UI_INPUT_PROTECT_MS\) return false/);
  assert.match(ui, /var interval = UI\.tab === 'tower' \? 200 : UI_BATTLE_RENDER_IDLE_MS/);
  assert.match(ui, /if \(shouldRenderBattle\(now\)\)/);
  assert.match(ui, /document\.addEventListener\('pointerdown', noteUiInteraction, true\)/);
  assert.match(ui, /document\.addEventListener\('keydown', noteUiInteraction, true\)/);
  assert.match(ui, /vfxSetQuality\(UI\.tab === 'tower' \? 'full' : 'reduced'\)/);
  assert.match(ui, /if \(typeof vfxInvalidateLayout === 'function'\) vfxInvalidateLayout\(\)/);
});
