const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('裝備選中外框移除漸變動畫，點擊後立刻出現外框', () => {
  const styleCssPath = path.resolve(__dirname, '../css/style.css');
  const styleCss = fs.readFileSync(styleCssPath, 'utf8');

  const ashenForgeCssPath = path.resolve(__dirname, '../css/ashen-forge.css');
  const ashenForgeCss = fs.readFileSync(ashenForgeCssPath, 'utf8');

  // 1. 驗證 style.css 中 .eq-slot 不再有全屬性 transition: all 0.2s（避免 outline 被漸變）
  assert.ok(
    !styleCss.includes('.eq-slot {\n  position: absolute;\n  transform: translate(-50%, -50%);\n  background: transparent;\n  border: 2px solid transparent;\n  border-radius: 4px;\n  padding: 0;\n  text-align: center;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  overflow: hidden;\n  transition: all 0.2s;'),
    '.eq-slot 不應有 transition: all 0.2s'
  );

  // 2. 驗證 style.css 中 .eq-slot.filled 與 .item-cell 的 transition 移除 outline 與 box-shadow
  assert.ok(
    !styleCss.includes('transition: opacity 0.2s, filter 0.2s, box-shadow 0.2s, outline 0.2s;'),
    '.eq-slot.filled 與 .item-cell 的 transition 不得包含 outline 0.2s 與 box-shadow 0.2s'
  );

  // 3. 驗證 style.css 中 .eq-slot.selected 與 .item-cell.selected 具有 transition: none !important
  assert.match(
    styleCss,
    /\.eq-slot\.selected\s*\{[^}]*transition:\s*none\s*!important/s,
    '.eq-slot.selected 應具備 transition: none !important'
  );
  assert.match(
    styleCss,
    /\.item-cell\.selected\s*\{[^}]*transition:\s*none\s*!important/s,
    '.item-cell.selected 應具備 transition: none !important'
  );

  // 4. 驗證 ashen-forge.css 中選中外框規則具備 transition: none !important
  assert.match(
    ashenForgeCss,
    /#workspace-area\s+\.item-cell\.selected,\s*#workspace-area\s+\.eq-slot\.selected\s*\{[^}]*transition:\s*none\s*!important/s,
    'ashen-forge.css 的選中外框規則應具備 transition: none !important 確保點擊後外框立即出現'
  );

  // 5. 驗證 index.html 快取版本號已同步更新
  const indexHtml = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  assert.match(indexHtml, /css\/style\.css\?v=1\.0\.75/);
  assert.match(indexHtml, /css\/ashen-forge\.css\?v=1\.0\.58/);
});
