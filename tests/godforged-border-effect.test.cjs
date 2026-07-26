const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');

test('神鑄創世使用彩色流動外框，且不擴散到其他品質', () => {
  const block = css.match(/\.eff-godforged\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(block, /border:\s*none\s*!important/);
  assert.match(css, /\.eff-godforged::before\s*\{[\s\S]*conic-gradient\([\s\S]*#ff3b30[\s\S]*#0a84ff[\s\S]*#bf5af2/);
  assert.match(css, /\.eff-godforged::before\s*\{[\s\S]*animation:\s*godforgedRainbowSpin\s+0\.3s\s+linear\s+infinite/);
  assert.match(css, /\.eff-godforged::after\s*\{[\s\S]*rgba\(184,\s*134,\s*11,\s*0\.9\)[\s\S]*rgba\(139,\s*101,\s*8,\s*0\.95\)/);
  assert.match(css, /\.eff-godforged::after\s*\{[\s\S]*conic-gradient\([\s\S]*rgba\(0,\s*0,\s*0,\s*0\.22\)/);
  assert.match(css, /\.eff-godforged::after\s*\{[\s\S]*animation:\s*godforgedInnerFlow\s+[\d.]+s\s+linear\s+infinite/);
  assert.match(css, /@property\s+--godforged-inner-angle\s*\{/);
  assert.match(css, /@keyframes\s+godforgedInnerFlow\s*\{/);
  assert.match(css, /@keyframes\s+godforgedRainbowSpin\s*\{/);
  assert.doesNotMatch(css, /\.eff-genesis\s*,\s*\.eff-godforged/);
});
