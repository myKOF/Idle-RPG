const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const css = fs.readFileSync('css/style.css', 'utf8');
const scaler = fs.readFileSync('js/ui-scale.js', 'utf8');

test('UI uses a fixed reference canvas instead of responsive reflow', () => {
  assert.match(css, /#ui-stage\s*\{[\s\S]*position:\s*fixed/);
  assert.match(css, /#ui-shell\s*\{[\s\S]*width:\s*1920px[\s\S]*height:\s*900px/);
  assert.match(css, /#ui-shell #game-layout\s*\{[\s\S]*flex-direction:\s*row\s*!important/);
  assert.match(css, /#ui-shell #combat-area\s*\{[\s\S]*width:\s*500px\s*!important/);
  assert.match(css, /#ui-shell \.battle-scene,[\s\S]*grid-template-columns:\s*202px auto minmax\(0, 1fr\)\s*!important/);
});

test('UI scaler preserves the 1920x900 aspect ratio', () => {
  assert.match(scaler, /DESIGN_WIDTH\s*=\s*1920/);
  assert.match(scaler, /DESIGN_HEIGHT\s*=\s*900/);
  assert.match(scaler, /Math\.min\(width \/ DESIGN_WIDTH, height \/ DESIGN_HEIGHT\)/);
  assert.match(scaler, /translate\(-50%, -50%\) scale\(/);
});
