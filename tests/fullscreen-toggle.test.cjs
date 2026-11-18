const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const display = fs.readFileSync(path.join(root, 'js/display-settings-ui.js'), 'utf8');

test('頂欄移除全螢幕按鈕，內測資訊仍插在版本更新提示前', () => {
  const topbar = index.match(/<header id="topbar"[\s\S]*?<\/header>/)[0];
  assert.doesNotMatch(topbar, /\bbtn-fullscreen\b/);
  assert.doesNotMatch(ui, /\bbtn-fullscreen\b/);
  assert.match(topbar, /class="brand-sub"[^>]*><\/span>\s*<button id="update-banner"/);
  assert.match(ui, /var updateBanner = \$id\('update-banner'\);[\s\S]*?updateBanner\.before\(wrap\)/);
});

test('顯示設定與戰鬥工具列仍提供各自的全螢幕控制', () => {
  assert.match(index, /name="display-mode" value="fullscreen"/);
  assert.match(index, /name="display-mode" value="windowed"/);
  assert.match(display, /document\.documentElement\.requestFullscreen\(\)/);
  assert.match(display, /document\.exitFullscreen\(\)/);
  assert.match(index, /id="btn-battle-fullscreen"/);
});

async function mountDisplay(mode, desktop) {
  const calls = [];
  const brand = { getBoundingClientRect: () => ({ right: 200 }) };
  const resources = { getBoundingClientRect: () => ({ left: 1400 }) };
  let doubleClick;
  const topbar = {
    querySelector(selector) { return selector === '.brand' ? brand : null; },
    addEventListener(name, fn) { if (name === 'dblclick') doubleClick = fn; }
  };
  const nodes = {
    topbar, 'res-bar': resources,
    'settings-pane-display': { querySelectorAll: () => [], addEventListener() {} }
  };
  const document = {
    fullscreenElement: mode === 'fullscreen' ? {} : null,
    getElementById(id) { return nodes[id] ??= { addEventListener() {} }; },
    addEventListener() {},
    async exitFullscreen() { calls.push('exitFullscreen'); this.fullscreenElement = null; }
  };
  const window = desktop ? { ApexHost: { display: {
    onChange() {}, async get() { return { mode, vsync: true, activeVsync: true }; }, async setResolution() {},
    async setMode(mode) { calls.push(mode); return { mode, vsync: true, activeVsync: true }; }
  } } } : {};
  const context = vm.createContext({ document, window, GameSettings: { get: () => '1920x1080' } });
  vm.runInContext(display, context);
  context.DisplaySettingsUI.init();
  const settled = () => new Promise(resolve => setImmediate(resolve));
  await settled();
  return { calls, brand, resources, settled,
    click(overrides) { doubleClick({ target: topbar, button: 0, clientX: 750, ...overrides }); } };
}

for (const mode of ['fullscreen', 'borderless']) {
  test(`桌面 ${mode} 時，只有頂欄中央空白處的左鍵雙擊會回到視窗模式`, async () => {
    const { click, calls, brand, resources, settled } = await mountDisplay(mode, true);
    click({ button: 2 });
    click({ target: brand });
    click({ target: resources });
    click({ target: { id: 'update-banner' } });
    click({ clientX: 199 });
    click({ clientX: 1400 });
    assert.deepEqual(calls, []);
    click();
    await settled();
    assert.deepEqual(calls, ['windowed']);
    click();
    assert.deepEqual(calls, ['windowed'], '視窗模式下不會切回全螢幕');
  });
}

test('網頁全螢幕同樣可以由頂欄雙擊退出', async () => {
  const { click, calls, settled } = await mountDisplay('fullscreen', false);
  click();
  await settled();
  click();
  assert.deepEqual(calls, ['exitFullscreen']);
});
