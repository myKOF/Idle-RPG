const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

test('頁面初始載入會先顯示全黑 Loading 覆蓋層', () => {
  assert.match(html, /id="loading-screen"[^>]*role="status"/);
  assert.match(html, /id="loading-screen-label"[^>]*>Loading\.<\/div>/);
  assert.match(html, /textContent\s*=\s*'Loading'\s*\+\s*'\.'\.repeat\(dots\)/);
  assert.match(css, /\.loading-screen\s*\{[\s\S]*?position:\s*fixed[\s\S]*?inset:\s*0[\s\S]*?z-index:\s*2147483647[\s\S]*?background:\s*#000/);
  assert.match(css, /\.loading-screen\.is-hidden\s*\{[\s\S]*?display:\s*none/);
});

// 執行正式入口與 UI 的訂閱規則；以可控 frame／Worker 重現讀檔與畫布的不同完成順序。
function setup({ canvas = true } = {}) {
  const frames = [];
  const handlers = {};
  const log = [];
  const bridge = { booted: false };
  const renderer = { ready: false, failed: false };
  let granted;
  let canvasClass = false;
  const c = {
    _saveSuppressed: false,
    UI: { tab: 'equip', dirty: {}, lastBattleRenderAt: 123 },
    UI_WORKER_STATE: { view: null, panels: {} },
    UI_COMMAND_PENDING: { byToken: {} },
    UI_PANEL_SUBSCRIPTIONS_BY_TAB: {
      equip: ['equip', 'inv', 'gems', 'header', 'skills'],
      skills: ['skills', 'talents', 'header']
    },
    UI_PERSISTENT_PANEL_SUBSCRIPTIONS: ['talents', 'header', 'battle'],
    validUiPanelKey: () => true,
    MSG_OUT: { BOOTED: 'booted' },
    WorkerBridge: {
      status: () => bridge,
      on(type, fn) { (handlers[type] ||= []).push(fn); }
    },
    BattleRenderer: { status: () => renderer },
    TabLock: { onGranted(fn) { granted = fn; } },
    window: {},
    document: {
      hidden: false,
      body: { classList: { contains: () => canvasClass } },
      getElementById: id => id === 'battle-canvas-host' && canvas ? {} : null
    },
    showLoadingScreen() { log.push('show'); },
    hideLoadingScreen() { log.push('hide'); },
    initUI() { log.push('init'); },
    initGM() { log.push('gm'); },
    markVisibleUiDirty() { c.UI.dirty.header = c.UI.dirty.battle = true; },
    uiRenderingSuspended: () => c.document.hidden,
    uiTick() {
      log.push('render');
      c.UI.dirty.header = c.UI.dirty.battle = false;
    },
    uiTickGuarded() {},   // main.js 的週期重繪掛的是這個包裝（見 ui.js UI_TICK_DIAG）；這裡只需要它存在
    requestAnimationFrame(fn) { frames.push(fn); },
    setInterval() {},
    setTimeout() {}
  };
  vm.createContext(c);
  const desired = ui.match(/function desiredUiPanelSubscriptions\(\) \{[\s\S]*?\n\}/)[0];
  vm.runInContext(desired, c);
  vm.runInContext(main, c);
  return {
    c, log, bridge, renderer,
    grant() { granted(); },
    emit(type) { (handlers[type] || []).forEach(fn => fn({})); },
    frame() { frames.splice(0).forEach(fn => fn()); },
    panels() {
      Object.keys(c.desiredUiPanelSubscriptions()).forEach(key => { c.UI_WORKER_STATE.panels[key] = {}; });
    },
    ready() { bridge.booted = true; c.UI_WORKER_STATE.view = {}; this.panels(); renderer.ready = true; canvasClass = true; },
    canvasClass(value) { canvasClass = value; }
  };
}

test('Loading 等待讀檔、每個初始面板與首次重繪，不在 initUI 後揭幕', () => {
  const e = setup({ canvas: false });
  e.grant();
  e.panels(); // 面板到齊仍不能取代 BOOTED／view。
  e.frame();
  assert.deepEqual(e.log, ['init', 'show', 'gm']);
  e.bridge.booted = true;
  e.frame();
  assert.ok(!e.log.includes('hide'));
  e.c.UI_WORKER_STATE.view = {};
  const keys = Object.keys(e.c.desiredUiPanelSubscriptions());
  for (const key of keys) {
    delete e.c.UI_WORKER_STATE.panels[key];
    e.frame();
    assert.ok(!e.log.includes('render'), key + ' 尚未到齊不能首畫');
    e.c.UI_WORKER_STATE.panels[key] = {}; // 新角色、空背包仍是有效面板。
  }
  e.frame();
  assert.deepEqual(e.log, ['init', 'show', 'gm', 'render']);
  assert.equal(e.c.UI.lastBattleRenderAt, 0);
  e.frame();
  assert.equal(e.log.at(-1), 'hide');
  e.frame();
  assert.equal(e.log.filter(x => x === 'hide').length, 1);
});

test('資料先到時，等待 Canvas 完成及版面切換後才揭幕', () => {
  const e = setup();
  e.grant();
  e.bridge.booted = true;
  e.c.UI_WORKER_STATE.view = {};
  e.panels();
  e.frame();
  assert.ok(!e.log.includes('render'));
  e.renderer.ready = true;
  e.frame();
  assert.ok(!e.log.includes('render'), '尚未切換 battle-canvas-mode');
  e.canvasClass(true);
  e.frame();
  e.frame();
  assert.deepEqual(e.log.slice(-2), ['render', 'hide']);
});

test('Canvas 先完成仍等待面板；初始化失敗沿用 DOM 備援', () => {
  for (const failed of [false, true]) {
    const e = setup();
    e.grant();
    e.renderer.ready = !failed;
    e.renderer.failed = failed;
    e.canvasClass(!failed);
    e.bridge.booted = true;
    e.c.UI_WORKER_STATE.view = {};
    e.frame();
    assert.ok(!e.log.includes('hide'));
    e.panels();
    e.frame();
    e.frame();
    assert.equal(e.log.at(-1), 'hide');
  }
});

test('背景不揭幕；回到前景完成首畫才顯示', () => {
  const e = setup();
  e.grant();
  e.ready();
  e.c.document.hidden = true;
  e.frame();
  assert.ok(!e.log.includes('render'));
  e.c.document.hidden = false;
  e.frame();
  e.frame();
  assert.equal(e.log.at(-1), 'hide');
});

test('戰鬥 dirty 尚未消費時繼續等待，不露出未完成畫面', () => {
  const e = setup();
  e.grant();
  e.ready();
  const render = e.c.uiTick;
  e.c.uiTick = () => { e.log.push('throttled'); e.c.UI.dirty.header = false; };
  e.frame();
  e.frame();
  assert.ok(!e.log.includes('hide'));
  e.c.uiTick = render;
  e.frame();
  e.frame();
  assert.equal(e.log.at(-1), 'hide');
});

test('等目前分頁訂閱資料，不依賴不顯示的裝備／背包', () => {
  const e = setup({ canvas: false });
  e.c.UI.tab = 'skills';
  e.grant();
  e.ready();
  assert.equal(e.c.UI_WORKER_STATE.panels.inv, undefined);
  e.frame();
  e.frame();
  assert.equal(e.log.at(-1), 'hide');
});

test('Worker 最終失效時取消等待並露出既有錯誤通知', () => {
  const e = setup();
  e.grant();
  e.emit('workerDead');
  e.ready();
  e.frame();
  assert.deepEqual(e.log, ['init', 'show', 'gm', 'hide']);
});

test('存檔來源確認後 BOOTED 恢復黑幕；進入遊戲後不重開 Loading', () => {
  const e = setup();
  e.grant();
  e.c.hideLoadingScreen(); // 模擬 SaveOrigin 為顯示確認視窗而收掉 Loading。
  e.emit('booted');
  assert.equal(e.log.at(-1), 'show');
  e.ready();
  e.frame();
  e.frame();
  e.emit('booted');
  assert.equal(e.log.at(-1), 'hide');
});
