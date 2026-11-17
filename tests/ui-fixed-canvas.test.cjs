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
  const scale = Number(ui.properties['--ui-scale']);
  assert.equal(scale, Math.min(width / 1920, height / 900));
  assert.equal(canvas.scale, scale);
  assert.equal(properties['--ui-canvas-width'], '1920px');
  assert.equal(properties['--ui-canvas-height'], '900px');
  const topLeft = canvas.point(0, 0);
  const bottomRight = canvas.point(width, height);
  assert.ok(topLeft.x <= 0.001 && topLeft.y <= 0.001);
  closeTo(topLeft.x, 1920 - bottomRight.x);
  closeTo(topLeft.y, 900 - bottomRight.y);
  closeTo(Math.max(topLeft.x, topLeft.y), 0);
}

test('the fixed layout is scaled over a black stage and clipped to its frame', () => {
  assert.match(css, /#ui-stage\s*\{[^}]*background:\s*#000/);
  assert.match(css, /#ui-shell\s*\{[^}]*translate\(-50%, -50%\) scale\(var\(--ui-scale, 1\)\)[^}]*overflow:\s*clip/);
  assert.match(css, /#ui-shell #game-layout\s*\{[\s\S]*flex-direction:\s*row\s*!important/);
  assert.match(skin, /height:\s*calc\(var\(--ui-canvas-height, 900px\) - 50px\)\s*!important/);
});

for (const [width, height] of [[1919, 911], [1569, 509], [1920, 900], [1280, 720], [3440, 1440], [390, 844]]) {
  test(`canvas fits and centers within ${width}x${height}`, () => {
    assertFitsViewport(mountScaler(width, height), width, height);
  });
}

test('fullscreen and resize refresh the scale and anchor coordinates', () => {
  const ui = mountScaler(1280, 720);
  ui.document.documentElement.clientWidth = 1200;
  ui.document.documentElement.clientHeight = 450;
  ui.listeners.fullscreenchange();
  assertFitsViewport(ui, 1200, 450);
  const rect = ui.canvas.rect({ getBoundingClientRect: () => ({ left: 130, top: 20, right: 160, bottom: 60, width: 30, height: 40 }) });
  assert.deepEqual({ ...rect }, { left: 20, top: 40, right: 80, bottom: 120, width: 60, height: 80 });
  ui.document.documentElement.clientWidth = 960;
  ui.document.documentElement.clientHeight = 650;
  ui.listeners.resize();
  assertFitsViewport(ui, 960, 650);
  assert.deepEqual({ ...ui.canvas.point(130, 140) }, { x: 260, y: 80 });
});
