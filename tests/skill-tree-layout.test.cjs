const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// 舊版技能樹與融合技能列表已移除；技能樹格線目前只給「潛力」分類使用（新版技能群組走 .sg-skill-list）。

test('融合技能列表容器已隨融合系統移除，不留孤兒節點與樣式', () => {
  assert.doesNotMatch(html, /fusion-skill-list/);
  assert.doesNotMatch(css, /#fusion-skill-list/);
  assert.match(html, /id="skill-trees"/);
});
