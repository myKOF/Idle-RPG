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
  const shell = { style: {} };
  const stage = { style: { setProperty(key, value) { properties[key] = value; } } };
  const document = {
    readyState: 'complete',
    documentElement: { clientWidth: width, clientHeight: height },
    getElementById(id) { return { 'ui-stage': stage, 'ui-shell': shell }[id] || null; },
    addEventListener(type, callback) { listeners[type] = callback; }
  };
  const window = { innerWidth: width, innerHeight: height, addEventListener(type, callback) { listeners[type] = callback; } };
  vm.runInNewContext(scaler, { document, window });
  return { document, properties, listeners, shell };
}

function assertFillsViewport(ui, width, height) {
  const scale = Number(ui.properties['--ui-scale']);
  assert.ok(scale > 0 && Number.isFinite(scale));
  assert.ok(Math.abs(parseFloat(ui.shell.style.width) * scale - width) < 0.001, 'canvas fills viewport width');
  assert.ok(Math.abs(parseFloat(ui.shell.style.height) * scale - height) < 0.001, 'canvas fills viewport height');
  assert.equal(parseFloat(ui.properties['--ui-canvas-height']), parseFloat(ui.shell.style.height));
  assert.match(ui.shell.style.transform, /translate\(-50%, -50%\) scale\(/);
}

test('UI retains one reference-width layout and gives extra height to the game panels', () => {
  assert.match(css, /#ui-shell #game-layout\s*\{[\s\S]*flex-direction:\s*row\s*!important/);
  assert.match(skin, /height:\s*calc\(var\(--ui-canvas-height, 900px\) - 50px\)\s*!important/);
  assert.match(skin, /max-width:\s*none\s*!important/);
});

for (const [width, height] of [[1920, 1080], [1920, 900], [1536, 864], [1280, 720], [960, 720], [3440, 1440], [390, 844]]) {
  test(`canvas fills ${width}x${height} without letterboxing or nonuniform scaling`, () => {
    const ui = mountScaler(width, height);
    assertFillsViewport(ui, width, height);
    assert.equal(Number(ui.properties['--ui-scale']), Math.min(width / 1920, height / 900));
  });
}

test('fullscreen and resize both refresh the canvas extent', () => {
  const ui = mountScaler(1280, 720);
  ui.document.documentElement.clientWidth = 1920;
  ui.document.documentElement.clientHeight = 1080;
  ui.listeners.fullscreenchange();
  assertFillsViewport(ui, 1920, 1080);
  ui.document.documentElement.clientWidth = 960;
  ui.document.documentElement.clientHeight = 720;
  ui.listeners.resize();
  assertFillsViewport(ui, 960, 720);
});
