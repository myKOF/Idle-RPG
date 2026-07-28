const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

test('初始化完成後隱藏 Loading', () => {
  // P5 起存檔與關閉流程由 Worker 的 visibilitychange → SHUTDOWN 負責；
  // 主執行緒不再有 beforeunload，也不再於重新整理前主動顯示 Loading。
  let ready;
  const calls = { initUI: 0, initGM: 0, hide: 0 };
  const context = {
    console,
    _saveSuppressed: false,
    window: { showDirectoryPicker: null },
    location: { href: 'http://localhost/' },
    document: {
      hidden: false,
      addEventListener(type, handler) {
        if (type === 'DOMContentLoaded') ready = handler;
      },
      getElementById() { return null; }
    },
    initUI() { calls.initUI++; },
    initGM() { calls.initGM++; },
    uiTick() {},
    dedupeSaveIndex() { return 0; },
    hideLoadingScreen() { calls.hide++; },
    setInterval() { return 1; },
    setTimeout() { return 1; }
  };
  vm.createContext(context);
  vm.runInContext(main, context, { filename: 'js/main.js' });

  assert.equal(typeof ready, 'function');
  assert.deepEqual(calls, { initUI: 0, initGM: 0, hide: 0 });
  ready();
  assert.deepEqual(calls, { initUI: 1, initGM: 1, hide: 1 });
  assert.doesNotMatch(main, /beforeunload|showLoadingScreen\(\)/);
});
