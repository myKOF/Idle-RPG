'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

test('技能詳情重繪與失效錨點仍會清理浮動提示 Tooltip', () => {
  // 技能瀏覽器重繪時只接回仍被懸停的同一選項，其餘提示仍要清理。
  const browserStart = ui.indexOf('function renderSkillBrowser(');
  const renderBrowserBlock = ui.slice(browserStart, ui.indexOf('\n}', browserStart));
  assert.match(renderBrowserBlock, /if \(oldTipAnchor\)/);
  assert.match(renderBrowserBlock, /else hideTooltip\(\);/);

  // refreshOpenStatTooltip 當錨點脫離 DOM 或所屬彈窗隱藏時必須自動 hideTooltip
  const refreshBlock = ui.slice(ui.indexOf('function refreshOpenStatTooltip()'), ui.indexOf('function refreshOpenResourceTooltip()'));
  assert.match(refreshBlock, /if \(!anchorEl \|\| !document\.documentElement\.contains\(anchorEl\)\)\s*\{\s*hideTooltip\(\);/);
  assert.match(refreshBlock, /if \(modalParent && modalParent\.style\.display === 'none'\)\s*\{\s*hideTooltip\(\);/);
});

test('提示錨點移除或所屬彈窗隱藏時真正關閉，仍可見的錨點保留', () => {
  function body(name) {
    const start = ui.indexOf('function ' + name + '(');
    return ui.slice(start, ui.indexOf('\n}', start) + 2);
  }
  for (const state of ['detached', 'hidden', 'visible']) {
    const tip = { style: { display: 'block' } };
    const anchor = { closest() { return { style: { display: state === 'hidden' ? 'none' : 'flex' } }; }, getAttribute() { return null; } };
    const c = { UI: { tooltipAnchor: anchor }, $id: () => tip,
      document: { documentElement: { contains: () => state !== 'detached' } } };
    vm.runInNewContext(body('hideTooltip') + '\n' + body('refreshOpenStatTooltip') + '\nrefreshOpenStatTooltip();', c);
    assert.equal(tip.style.display, state === 'visible' ? 'block' : 'none', state);
    assert.equal(c.UI.tooltipAnchor, state === 'visible' ? anchor : null, state);
  }
});
