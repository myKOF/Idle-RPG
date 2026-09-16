'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('裝備強化階級增加動效驗證', async (t) => {
  const root = path.resolve(__dirname, '..');
  const cssPath = path.join(root, 'css/ashen-forge.css');
  const itemJsPath = path.join(root, 'js/item.js');
  const uiJsPath = path.join(root, 'js/ui.js');

  const css = fs.readFileSync(cssPath, 'utf8');
  const itemJs = fs.readFileSync(itemJsPath, 'utf8');
  const uiJs = fs.readFileSync(uiJsPath, 'utf8');

  await t.test('1. CSS 包含 .it-up.upgrade-pop、.ic-up.upgrade-pop 與 upgradeNumberPop 動畫定義', () => {
    assert.match(css, /\.it-up\s*\{/, '需包含 .it-up 基底樣式');
    assert.match(css, /\.it-up\.upgrade-pop/, '需包含 .it-up.upgrade-pop');
    assert.match(css, /@keyframes\s+upgradeNumberPop/, '需包含 @keyframes upgradeNumberPop');
    assert.match(css, /scale\(2\.[0-9]+\)/, '動畫初始須放大超過 2 倍');
    assert.match(css, /text-shadow:.*#ffffff/, '動畫須帶有白色高亮提示');
    assert.match(css, /scale\(1\)/, '動畫結束需回歸 normal scale 1');
  });

  await t.test('2. itemDetailHTML 支援 opts.justUpgraded 參數並為 .it-up 附加 upgrade-pop', () => {
    assert.match(itemJs, /it\.upgrade\s*\?\s*'\s*<span class="it-up'\s*\+\s*\(\(opts\s*&&\s*opts\.justUpgraded\)\s*\?\s*'\s*upgrade-pop'\s*:\s*''\)/,
      'itemDetailHTML 應在 justUpgraded 為 true 時輸出 upgrade-pop');
  });

  await t.test('3. ui.js 在 renderDetail 與 detailAction 中追蹤強化等級變化並觸發動效', () => {
    assert.match(uiJs, /UI\._upgradingItemId/, '需在 UI 狀態中追蹤正在強化的裝備 ID');
    assert.match(uiJs, /UI\._upgradingItemPrevLevel/, '需追蹤強化前的等級以判斷是否有升級');
    assert.match(uiJs, /UI\._upgradePopUntil/, '需具備時間戳視窗避免 DOM 重建沖掉動畫');
    assert.match(uiJs, /ensureUpgradePopStyle/, '需具備動態注入樣式以防快取');
    assert.match(uiJs, /triggerUpgradeNumberAnimation/, '需具備獨立的動畫觸發函式');
    assert.match(uiJs, /justUpgraded:\s*justUpgraded/, 'renderDetail 應將 justUpgraded 傳給 itemDetailHTML');
  });
});
