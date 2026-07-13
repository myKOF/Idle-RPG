const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');

test('頁面初始載入會先顯示全黑 Loading 覆蓋層', () => {
  assert.match(html, /id="loading-screen"[^>]*role="status"/);
  assert.match(html, /id="loading-screen-label"[^>]*>Loading\.<\/div>/);
  assert.match(html, /textContent\s*=\s*'Loading'\s*\+\s*'\.'\.repeat\(dots\)/);
  assert.match(css, /\.loading-screen\s*\{[\s\S]*?position:\s*fixed[\s\S]*?inset:\s*0[\s\S]*?z-index:\s*2147483647[\s\S]*?background:\s*#000/);
  assert.match(css, /\.loading-screen\.is-hidden\s*\{[\s\S]*?display:\s*none/);
});

test('重新整理前顯示 Loading，初始化完成後隱藏', () => {
  assert.match(html, /showLoadingScreen\(\);\s*location\.reload\(\)/);
  assert.match(main, /window\.addEventListener\('beforeunload',[\s\S]*?showLoadingScreen\(\)[\s\S]*?saveGame\(\)/);
  assert.match(main, /hideLoadingScreen\(\);/);
});
