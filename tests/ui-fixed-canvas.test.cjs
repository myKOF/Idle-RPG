const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const css = fs.readFileSync('css/style.css', 'utf8');
const skin = fs.readFileSync('css/ashen-forge.css', 'utf8');
const scaler = fs.readFileSync('js/ui-scale.js', 'utf8');

function mountScaler(width, height) {
  const properties = {};
  const listeners = {};
  const stage = { style: { setProperty(key, value) { properties[key] = value; } } };
  const document = {
    documentElement: { clientWidth: width, clientHeight: height },
    getElementById(id) { return id === 'ui-stage' ? stage : null; },
    addEventListener(type, callback) { listeners[type] = callback; }
  };
  const window = { innerWidth: width, innerHeight: height, addEventListener(type, callback) { listeners[type] = callback; } };
  vm.runInNewContext(scaler, { document, window });
  return { document, properties, listeners, canvas: window.UiCanvas };
}

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 0.001, `${actual} should be ${expected}`);
}

function assertFitsViewport(ui, width, height) {
  const { canvas, properties } = ui;
  const scale = Number(properties['--ui-scale']);
  assert.equal(scale, width / 1920);
  assert.equal(canvas.scale, scale);
  assert.equal(properties['--ui-canvas-width'], '1920px');
  closeTo(parseFloat(properties['--ui-canvas-height']) * scale, height);
  closeTo(parseFloat(properties['--ui-vh']) * scale, height / 100);
  assert.deepEqual({ ...canvas.point(0, 0) }, { x: 0, y: 0 });
  const bottomRight = canvas.point(width, height);
  closeTo(bottomRight.x, canvas.width);
  closeTo(bottomRight.y, canvas.height);
}

test('the canvas fills the viewport while the gameplay columns retain their design widths', () => {
  assert.match(css, /#ui-shell\s*\{[^}]*inset:\s*0 auto auto 0[^}]*transform:\s*scale\(var\(--ui-scale, 1\)\)[^}]*transform-origin:\s*top left/);
  assert.match(css, /#ui-shell #game-layout\s*\{[^}]*height:\s*calc\(100% - 50px\) !important[^}]*flex-direction:\s*row\s*!important/);
  assert.match(skin, /#ui-shell #combat-area\s*\{[^}]*--af-combat-w:\s*720px/);
});

for (const [width, height] of [[1919, 911], [1569, 509], [1920, 900], [1280, 720], [3440, 1440], [390, 844]]) {
  test(`canvas fills ${width}x${height} using a width-only scale`, () => {
    assertFitsViewport(mountScaler(width, height), width, height);
  });
}

test('fullscreen and resize refresh the scale and anchor coordinates', () => {
  const ui = mountScaler(1280, 720);
  ui.document.documentElement.clientWidth = 1200;
  ui.document.documentElement.clientHeight = 450;
  ui.listeners.fullscreenchange();
  assertFitsViewport(ui, 1200, 450);
  const rect = ui.canvas.rect({ getBoundingClientRect: () => ({ left: 125, top: 25, right: 175, bottom: 50, width: 50, height: 25 }) });
  assert.deepEqual({ ...rect }, { left: 200, top: 40, right: 280, bottom: 80, width: 80, height: 40 });
  ui.document.documentElement.clientHeight = 650;
  ui.listeners.resize();
  assertFitsViewport(ui, 1200, 650);
  assert.equal(ui.canvas.height, 1040);
  ui.document.documentElement.clientWidth = 960;
  ui.listeners.resize();
  assertFitsViewport(ui, 960, 650);
  assert.deepEqual({ ...ui.canvas.point(130, 140) }, { x: 260, y: 280 });
});
