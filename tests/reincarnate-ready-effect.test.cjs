const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

test('可轉生按鈕掛上 ready class，保留高亮效果但不使用旋轉外框', () => {
  assert.match(ui, /reincBtn\.classList\.toggle\('reincarnate-ready', canReincarnate\)/);
  assert.match(css, /\.reincarnate-btn\.reincarnate-ready\s*\{[\s\S]*animation:\s*reincReadyBgFlow\s+0\.75s\s+linear\s+infinite,\s*reincReadyButtonPulse\s+0\.55s\s+ease-in-out\s+infinite\s+alternate/);
  assert.match(css, /\.reincarnate-btn\.reincarnate-ready::after\s*\{[\s\S]*animation:\s*reincReadySweep\s+0\.9s\s+linear\s+infinite/);
  assert.match(css, /@keyframes\s+reincReadyButtonPulse\s*\{/);
  assert.match(css, /@keyframes\s+reincReadySweep\s*\{/);
  assert.doesNotMatch(css, /\.reincarnate-btn\.reincarnate-ready::before/);
  assert.doesNotMatch(css, /reincReadyBorderSpin/);
});
