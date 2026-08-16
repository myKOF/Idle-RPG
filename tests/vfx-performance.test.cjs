const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const vfx = fs.readFileSync(path.join(root, 'js', 'vfx.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

function loadVfx(documentOverride) {
  const context = {
    console,
    Math,
    Date,
    Object,
    Infinity,
    document: documentOverride || {
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
  assert.match(vfx, /VFX_STALE_EVENT_MS = 1500/);
  assert.match(vfx, /VFX_METEOR_MAX_DELAY_MS = 900/);
  assert.match(vfx, /VFX_METEOR_MAX_TRAVEL_MS[\s\S]*\? VFX_METEOR_RAW_TRAVEL_MS : 700/);
  assert.match(vfx, /VFX_NODE_WATCHDOG_MS = 1000/);
  assert.match(vfx, /VFX_METEOR_HARD_LIFETIME_MS = 2800/);
  assert.match(vfx, /function vfxScheduleFlush\(\)/);
  assert.match(vfx, /function vfxFlushQueue\(\)/);
  assert.match(vfx, /function vfxEnqueue\(spec\)/);
  assert.match(vfx, /now - entry\.queuedAt > VFX_STALE_EVENT_MS/);
  assert.match(vfx, /if \(_vfxEventQueue\.length >= VFX_EVENT_QUEUE_MAX\) _vfxEventQueue\.shift\(\)/);
});

test('Reduced VFX removes the most expensive cosmetic work', () => {
  assert.match(vfx, /function vfxSpecForQuality\(spec\)/);
  assert.match(vfx, /if \(source\.fxKind === 'aura'\) return null/);
  assert.match(vfx, /out\.count = 1/);
  assert.match(vfx, /targetLimit = source\.fxKind === 'chain' \|\| source\.variant === 'chain' \? 2 : 3/);
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

test('Meteor timing is bounded, stale events are skipped, and tracked nodes have a watchdog', () => {
  const context = loadVfx();
  const safe = context.vfxSpecForQuality({
    fxKind: 'rain', variant: 'meteor', delayMs: 5000, travelMs: [5000]
  });
  assert.equal(safe.delayMs, 900);
  assert.deepEqual(safe.travelMs, [700]);

  let rendered = 0;
  context.renderCombatVfx = () => { rendered++; };
  context._vfxEventQueue.push(
    { spec: { fxKind: 'rain', variant: 'meteor' }, queuedAt: Date.now() - 2000 },
    { spec: { fxKind: 'impact' }, queuedAt: Date.now() }
  );
  context.vfxFlushQueue();
  assert.equal(rendered, 1);
  assert.equal(context._vfxEventQueue.length, 0);

  let removed = false;
  const parent = { removeChild(node) { removed = true; node.parentNode = null; } };
  const node = { className: 'vfx-meteor', parentNode: parent };
  context.vfxTrack(node, 0);
  context.vfxRunNodeWatchdog();
  assert.equal(removed, true);
});

test('Target coordinates are cached and invalidated after layout changes', () => {
  assert.match(vfx, /function vfxLayerRect\(layer\)/);
  assert.match(vfx, /_vfxLayerRectCache\.version === _vfxLayoutVersion/);
  assert.match(vfx, /_vfxAnchorCache\[elId\] = \{ target: target, layer: layer, version: _vfxLayoutVersion, rect: r \}/);
  assert.match(vfx, /function vfxInvalidateLayout\(\)[\s\S]*_vfxAnchorCache = Object\.create\(null\)/);
});

test('高塔 VFX 以 BOSS 圖像作為座標錨點，不使用整張 BOSS 卡片中心', () => {
  const floatLayer = {};
  const image = {
    getBoundingClientRect() { return { left: 300, top: 80, width: 84, height: 84 }; }
  };
  const bossVisualHost = {
    querySelector(selector) {
      assert.equal(selector, 'img, span');
      return image;
    }
  };
  const doc = {
    hidden: false,
    getElementById(id) {
      if (id === 'tb-float') return floatLayer;
      if (id === 'tb-emoji') return bossVisualHost;
      return null;
    },
    querySelectorAll() { return []; }
  };
  const context = loadVfx(doc);
  const layer = {
    getBoundingClientRect() { return { left: 100, top: 20, width: 700, height: 400 }; }
  };

  const point = context.vfxPointOf('tb-float', layer);
  assert.equal(point.x, 242);
  assert.equal(point.y, 102);
});

test('普攻劍氣月牙朝向飛行方向', () => {
  assert.match(css, /\.vfx-proj-sword \.vfx-proj-core[\s\S]*?border-left: 5px solid/);
  assert.doesNotMatch(css, /\.vfx-proj-sword \.vfx-proj-core[\s\S]*?border-right: 5px solid/);
});

test('UI protects equipment input and selects reduced quality outside the battle tab', () => {
  assert.match(ui, /function shouldRenderBattle\(now\)/);
  assert.match(ui, /if \(now - \(UI\.lastInteractionAt \|\| 0\) < UI_INPUT_PROTECT_MS\) return false/);
  assert.match(ui, /var interval = UI\.tab === 'tower' \? 200 : UI_BATTLE_RENDER_IDLE_MS/);
  assert.match(ui, /if \(shouldRenderBattle\(now\)\)/);
  assert.match(ui, /document\.addEventListener\('pointerdown', noteUiInteraction, true\)/);
  assert.match(ui, /document\.addEventListener\('keydown', noteUiInteraction, true\)/);
  assert.match(ui, /vfxSetQuality\('reduced'\)/);
  assert.match(ui, /if \(typeof vfxInvalidateLayout === 'function'\) vfxInvalidateLayout\(\)/);
});
