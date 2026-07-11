const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('神鑄自動放入選單將素材清單與固定操作列分離', () => {
  const uiJs = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.match(uiJs, /class="fam-list"/);
  assert.match(uiJs, /class="fam-foot"/);
  assert.match(uiJs, /fam-gem-mode/);
  assert.match(uiJs, /famList\.style\.height/);
  assert.match(uiJs, /rows \+= '<div class="fam-opt'.*data-fam-equip/s);
});

test('神鑄寶石自動放入會將可合成項目優先排列', () => {
  const uiJs = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.match(uiJs, /gemOptions\.sort\(/);
  assert.match(uiJs, /b\.canForge\s*-\s*a\.canForge/);
});

test('神鑄自動放入選單的操作列固定且清單獨立捲動', () => {
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

  assert.match(css, /\.forge-auto-menu\s*{[\s\S]*display:\s*flex/);
  assert.match(css, /\.forge-auto-menu\s*{[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.fam-list\s*{[\s\S]*overflow-y:\s*scroll/);
  assert.match(css, /\.fam-list\s*{[\s\S]*overscroll-behavior:\s*contain/);
  assert.match(css, /\.fam-foot\s*{[\s\S]*flex:\s*0\s+0\s+auto/);
  assert.match(css, /\.forge-auto-menu\.fam-gem-mode\s+\.fam-list\s*{[\s\S]*flex:\s*0\s+0\s+auto/);
});

test('寶石自動放入選單會設定明確高度並隔離滑鼠滾輪', () => {
  const uiJs = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

  assert.match(uiJs, /invTab === 'gems'[\s\S]*menu\.style\.height/);
  assert.match(uiJs, /addEventListener\('wheel'/);
  assert.match(uiJs, /list\.scrollTop \+= e\.deltaY/);
  assert.match(uiJs, /e\.stopPropagation\(\)/);
  assert.doesNotMatch(uiJs, /forgeAutoMiddleScroll/);
});
