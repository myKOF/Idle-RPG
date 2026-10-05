const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('裝備詞條預覽界面開啟時，點擊操作該界面外的任意區域即關閉該界面', () => {
  const uiPath = path.resolve(__dirname, '../js/ui.js');
  const uiCode = fs.readFileSync(uiPath, 'utf8');

  // 驗證關鍵程式碼改動：outside click 判斷不再包含 #detail-pane
  assert.ok(
    !uiCode.includes("!e.target.closest('#affix-pool-overlay, #detail-pane')"),
    '外點關閉邏輯中不得排除 #detail-pane，點擊詳情卡片內部應正常關閉詞條預覽'
  );
  assert.ok(
    uiCode.includes("if (!e.target.closest('#affix-pool-overlay')) hideAffixPool();"),
    '外點關閉邏輯應正確判斷只要不在 #affix-pool-overlay 內即執行 hideAffixPool'
  );

  // 模擬 DOM 與事件環境
  let overlayDisplay = 'none';
  let overlayHtml = '';
  let poolSource = null;
  let poolItemId = null;

  const overlayEl = {
    id: 'affix-pool-overlay',
    style: {
      get display() { return overlayDisplay; },
      set display(val) { overlayDisplay = val; },
      left: '',
      top: ''
    },
    get innerHTML() { return overlayHtml; },
    set innerHTML(val) { overlayHtml = val; },
    offsetWidth: 200,
    offsetHeight: 300,
    closest(selector) {
      if (selector === '#affix-pool-overlay') return this;
      return null;
    }
  };

  const overlayItemEl = {
    closest(selector) {
      if (selector === '#affix-pool-overlay') return overlayEl;
      return null;
    }
  };

  const detailPaneEl = {
    id: 'detail-pane',
    closest(selector) {
      if (selector === '#detail-pane') return this;
      return null;
    }
  };

  const detailUpgradeBtn = {
    closest(selector) {
      if (selector === '#detail-pane') return detailPaneEl;
      if (selector === '#detail-pane .btn, #equip-action-bar .btn') return this;
      return null;
    },
    getAttribute(attr) {
      if (attr === 'data-act') return 'upgrade';
      return null;
    }
  };

  const bagCellEl = {
    closest(selector) {
      if (selector === '#inv-grid') return {};
      return null;
    }
  };

  const poolBtnEl = {
    nextElementSibling: { innerHTML: '<div class="it-pool-title">可能出現的詞條：</div>' },
    getBoundingClientRect() { return { right: 300, bottom: 100, left: 200, top: 80 }; },
    closest(selector) {
      if (selector === '[data-affix-pool-toggle]') return this;
      if (selector === '#detail-pane') return detailPaneEl;
      return null;
    }
  };

  const UI = {
    sel: { id: 101 },
    get affixPoolSource() { return poolSource; },
    set affixPoolSource(val) { poolSource = val; },
    get affixPoolItemId() { return poolItemId; },
    set affixPoolItemId(val) { poolItemId = val; }
  };

  const $id = (id) => {
    if (id === 'affix-pool-overlay') return overlayEl;
    if (id === 'detail-pane') return detailPaneEl;
    return null;
  };

  // 提取 toggleAffixPool 與 hideAffixPool 邏輯
  function hideAffixPool() {
    const overlay = $id('affix-pool-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.innerHTML = '';
    UI.affixPoolSource = null;
    UI.affixPoolItemId = null;
  }

  function toggleAffixPool(anchorEl) {
    const overlay = $id('affix-pool-overlay');
    const source = anchorEl && anchorEl.nextElementSibling;
    if (!overlay || !source) return;
    if (UI.affixPoolSource === source && overlay.style.display !== 'none') {
      hideAffixPool();
      return;
    }
    overlay.innerHTML = source.innerHTML;
    overlay.style.display = 'block';
    UI.affixPoolSource = source;
    UI.affixPoolItemId = UI.sel ? UI.sel.id : null;
  }

  // 模擬 click 事件委派處理常式
  function handleClick(e) {
    const poolBtn = e.target.closest('[data-affix-pool-toggle]');
    if (poolBtn) {
      toggleAffixPool(poolBtn);
      return;
    }
    if (!e.target.closest('#affix-pool-overlay')) {
      hideAffixPool();
    }
  }

  // 1. 初始狀態：未開啟
  assert.equal(overlayDisplay, 'none');

  // 2. 點擊驚嘆號按鈕開啟詞條預覽
  handleClick({ target: poolBtnEl });
  assert.equal(overlayDisplay, 'block');
  assert.equal(overlayHtml.includes('可能出現的詞條：'), true);
  assert.equal(UI.affixPoolItemId, 101);

  // 3. 點擊詞條預覽界面內部：界面保持開啟
  handleClick({ target: overlayItemEl });
  assert.equal(overlayDisplay, 'block');

  // 4. 點擊裝備詳情卡片內部空白處或文字：界面自動關閉
  handleClick({ target: detailPaneEl });
  assert.equal(overlayDisplay, 'none');
  assert.equal(overlayHtml, '');
  assert.equal(UI.affixPoolItemId, null);

  // 5. 再次開啟詞條預覽
  handleClick({ target: poolBtnEl });
  assert.equal(overlayDisplay, 'block');

  // 6. 點擊裝備詳情卡片內的強化按鈕：界面自動關閉
  handleClick({ target: detailUpgradeBtn });
  assert.equal(overlayDisplay, 'none');

  // 7. 再次開啟詞條預覽
  handleClick({ target: poolBtnEl });
  assert.equal(overlayDisplay, 'block');

  // 8. 點擊背包格子或其它區域：界面自動關閉
  handleClick({ target: bagCellEl });
  assert.equal(overlayDisplay, 'none');

  // 9. 再次開啟後點擊驚嘆號按鈕自身：正常收起關閉
  handleClick({ target: poolBtnEl });
  assert.equal(overlayDisplay, 'block');
  handleClick({ target: poolBtnEl });
  assert.equal(overlayDisplay, 'none');
});
