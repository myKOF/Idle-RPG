'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scaler = fs.readFileSync(path.resolve(__dirname, '../js/ui-scale.js'), 'utf8');
function mountCanvas(width, height) {
  const window = { addEventListener() {} };
  const document = {
    documentElement: { clientWidth: width, clientHeight: height },
    getElementById: () => ({ style: { setProperty() {} } }),
    addEventListener() {}
  };
  vm.runInNewContext(scaler, { document, window });
  return window;
}

test('CSS #affix-pool-overlay 樣式不再限制 500px，支援隨內容自適應延伸', () => {
  const cssPath = path.resolve(__dirname, '../css/style.css');
  const cssCode = fs.readFileSync(cssPath, 'utf8');

  // 驗證移除 500px 的硬性限制
  assert.ok(
    !cssCode.includes('max-height: min(500px'),
    '#affix-pool-overlay 不應再被 500px 硬性限制上限'
  );
  assert.match(
    cssCode,
    /#affix-pool-overlay\s*\{[^}]*max-height:\s*calc\(var\(--ui-canvas-height, 100vh\)\s*-\s*16px\)/,
    '#affix-pool-overlay 應以遊戲畫布高度保留上下各 8px'
  );
});

test('positionAffixPool 依錨點位置動態計算 maxHeight 延伸至畫面底部（留 8px 邊距）', () => {
  const uiPath = path.resolve(__dirname, '../js/ui.js');
  const uiCode = fs.readFileSync(uiPath, 'utf8');

  assert.ok(uiCode.includes('function positionAffixPool(anchorEl)'), '應有 positionAffixPool 函式');

  let overlayStyle = { left: '', top: '', maxHeight: '', display: 'none' };
  const overlayEl = {
    id: 'affix-pool-overlay',
    style: overlayStyle,
    offsetWidth: 240,
    offsetHeight: 400
  };

  const fakeWindow = mountCanvas(1200, 450);

  const fnMatch = uiCode.match(/function positionAffixPool\(anchorEl\)\s*\{([\s\S]*?)\n\}\n\nfunction toggleAffixPool/);
  assert.ok(fnMatch, 'positionAffixPool 函式應能成功提取');

  const positionFn = new Function('$id', 'window', 'anchorEl', fnMatch[1]);
  const $id = (id) => (id === 'affix-pool-overlay' ? overlayEl : null);

  // 左右黑邊各 120px，錨點換回畫布座標後 bottom 為 200，right 為 500。
  const anchorEl = {
    getBoundingClientRect: () => ({
      left: 360,
      right: 370,
      top: 90,
      bottom: 100
    })
  };

  positionFn($id, fakeWindow, anchorEl);

  // y = bottom (200) + 8 = 208
  // maxH = 900 - 208 - 8 = 684
  assert.equal(overlayStyle.top, '208px');
  assert.equal(overlayStyle.maxHeight, '684px');
  // x = right (500) - tw (240) = 260
  assert.equal(overlayStyle.left, '260px');
});

test('toggleAffixPool 與 hideAffixPool 正確管理顯示、錨點與 maxHeight 清理', () => {
  const uiPath = path.resolve(__dirname, '../js/ui.js');
  const uiCode = fs.readFileSync(uiPath, 'utf8');

  let overlayStyle = { left: '', top: '', maxHeight: '500px', display: 'none' };
  let overlayHtml = '';
  const overlayEl = {
    id: 'affix-pool-overlay',
    style: overlayStyle,
    get innerHTML() { return overlayHtml; },
    set innerHTML(val) { overlayHtml = val; },
    offsetWidth: 200,
    offsetHeight: 300
  };

  const UI = {
    sel: { id: 999 },
    affixPoolSource: null,
    affixPoolAnchor: null,
    affixPoolItemId: null
  };

  const fakeWindow = mountCanvas(960, 650);

  const hideMatch = uiCode.match(/function hideAffixPool\(\)\s*\{([\s\S]*?)\n\}\n\nfunction positionAffixPool/);
  assert.ok(hideMatch, 'hideAffixPool 函式應能成功提取');

  const posMatch = uiCode.match(/function positionAffixPool\(anchorEl\)\s*\{([\s\S]*?)\n\}\n\nfunction toggleAffixPool/);
  assert.ok(posMatch, 'positionAffixPool 函式應能成功提取');

  const toggleMatch = uiCode.match(/function toggleAffixPool\(anchorEl\)\s*\{([\s\S]*?)\n\}\n\n\/\* ---- 寶石分頁/);
  assert.ok(toggleMatch, 'toggleAffixPool 函式應能成功提取');

  const hideFn = new Function('$id', 'UI', hideMatch[1]);
  const posFn = new Function('$id', 'window', 'anchorEl', posMatch[1]);
  const toggleFn = new Function('$id', 'UI', 'hideAffixPool', 'positionAffixPool', 'anchorEl', toggleMatch[1]);

  const $id = (id) => (id === 'affix-pool-overlay' ? overlayEl : null);

  const poolSource = { innerHTML: '<div>詞條清單內容</div>' };
  const poolBtn = {
    nextElementSibling: poolSource,
    getBoundingClientRect: () => ({ left: 150, right: 160, top: 150, bottom: 160 })
  };

  // 1. 呼叫 toggleAffixPool 開啟
  toggleFn($id, UI, () => hideFn($id, UI), (btn) => posFn($id, fakeWindow, btn), poolBtn);

  assert.equal(overlayStyle.display, 'block');
  assert.equal(overlayHtml, '<div>詞條清單內容</div>');
  assert.equal(UI.affixPoolAnchor, poolBtn);
  assert.equal(UI.affixPoolItemId, 999);
  assert.equal(overlayStyle.top, '128px');
  // 900 - 128 - 8 = 764px
  assert.equal(overlayStyle.maxHeight, '764px');

  // 2. 呼叫 hideAffixPool 關閉
  hideFn($id, UI);

  assert.equal(overlayStyle.display, 'none');
  assert.equal(overlayHtml, '');
  assert.equal(overlayStyle.maxHeight, '');
  assert.equal(UI.affixPoolSource, null);
  assert.equal(UI.affixPoolAnchor, null);
  assert.equal(UI.affixPoolItemId, null);
});
