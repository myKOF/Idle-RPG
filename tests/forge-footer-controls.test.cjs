const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('神鑄底部使用兩個可見 checkbox 控制項', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.match(html, /<div class="forge-foot">[\s\S]*id="forge-autodust"[\s\S]*id="forge-autoforge"[\s\S]*<\/div>/);
  assert.match(html, /<input type="checkbox" id="forge-autodust">\s*自動使用魔塵/);
  assert.match(html, /<input type="checkbox" id="forge-autoforge">\s*自動鑄造/);
  assert.doesNotMatch(html, /<button[^>]*id="forge-autodust"/);
  assert.doesNotMatch(html, /<button[^>]*id="forge-autoforge"/);
  assert.doesNotMatch(html, /id="forge-autodust">\s*✅/);
  assert.doesNotMatch(html, /id="forge-autoforge">\s*✅/);
  const autoForgeHandler = ui.match(/\$id\('forge-autoforge'\)\.addEventListener\('change', function \(\) \{([\s\S]*?)\n\s{4}\}\);/);
  assert.ok(autoForgeHandler, '找不到自動鑄造勾選事件');
  assert.doesNotMatch(autoForgeHandler[1], /doForge\(/, '勾選自動鑄造時不應立即開始鑄造');
  assert.doesNotMatch(autoForgeHandler[1], /forgeAutoFillApply\(/, '勾選自動鑄造時不應自動放入素材');
  const inputBlock = css.match(/\.forge-foot\s+\.chk\s+input\s*\{([^}]*)\}/s);
  assert.ok(inputBlock, '找不到神鑄底部 checkbox 專用樣式');
  assert.match(inputBlock[1], /appearance:\s*none;/);
  assert.match(inputBlock[1], /width:\s*18px;/);
  assert.match(inputBlock[1], /height:\s*18px;/);
  assert.match(inputBlock[1], /opacity:\s*1;/);
  assert.doesNotMatch(inputBlock[1], /display:\s*none;/);
});
