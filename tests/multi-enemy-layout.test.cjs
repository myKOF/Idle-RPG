const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(__dirname, '..', 'css/style.css'), 'utf8');

test('多敵人時擴大戰鬥區域並保留較大的敵人卡片空間', () => {
  assert.match(css, /#combat-area\s*\{[\s\S]*flex:\s*0\s+0\s+500px/);
  assert.match(css, /\.battle-scene\s*\{[\s\S]*grid-template-columns:\s*1fr\s+auto\s+1fr/);
  assert.match(css, /\.enemy-party\s*\{[\s\S]*min-height:\s*220px/);
  assert.match(css, /\.enemy-party:not\(\.enemy-count-0\):not\(\.enemy-count-1\) \.enemy-card \.cb-icon\s*\{[\s\S]*width:\s*56px[\s\S]*height:\s*56px/);
  assert.doesNotMatch(css, /#combat-area\.multi-enemy-layout/);
  assert.match(css, /\.battle-scene\.multi-enemy-layout\s*\{[\s\S]*width:\s*calc\(100%\s*\+\s*32px\)[\s\S]*margin-left:\s*-16px[\s\S]*grid-template-columns:\s*240px\s+auto\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /\.enemy-party:not\(\.enemy-count-0\):not\(\.enemy-count-1\) \.enemy-hp\s*\{[\s\S]*width:\s*180px[\s\S]*max-width:\s*100%/);
  assert.match(fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8'), /enemies\.length\s*>\s*3/);
});
