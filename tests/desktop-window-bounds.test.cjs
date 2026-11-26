'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { create } = require('../electron/window-bounds.cjs');

function fixture(t, contents, area = { x: 0, y: 0, width: 1920, height: 1040 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-bounds-unit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'window-bounds.json');
  if (contents !== undefined) fs.writeFileSync(file, contents);
  const store = create(file, { getDisplayMatching: () => ({ workArea: area }) });
  const win = Object.assign(new EventEmitter(), {
    bounds: { x: 80, y: 100, width: 1037, height: 683 }, full: false, max: false, min: false, destroyed: false,
    isDestroyed() { return this.destroyed; }, isFullScreen() { return this.full; },
    isMaximized() { return this.max; }, isMinimized() { return this.min; }, getBounds() { return { ...this.bounds }; }
  });
  let allowed = true;
  const tracker = store.bind(win, () => allowed);
  t.after(() => win.emit('closed'));
  return { store, tracker, win, file, allow: value => { allowed = value; }, read: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}

test('無紀錄、壞 JSON 及無效尺寸退回初始大小，不視為已保存', t => {
  for (const value of [undefined, '{', 'null', JSON.stringify({ x: 1, y: 2, width: 10, height: 10 }),
    JSON.stringify({ x: 1e20, y: 0, width: 1000, height: 600 }),
    JSON.stringify({ x: 0, y: 0, width: '1000', height: 600 })]) {
    const f = fixture(t, value);
    assert.equal(f.store.hasSaved(), false);
    assert.deepEqual(f.store.initialBounds(), { width: 1600, height: 900 });
  }
});

test('關窗立刻落地最後自訂尺寸，新實例完整還原，與渲染解析度無關', t => {
  const f = fixture(t);
  f.win.emit('resize');
  f.win.emit('close');
  assert.deepEqual(f.read(), f.win.bounds);
  assert.equal(f.store.hasSaved(), true);
  const again = create(f.file, { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1.5 }) });
  assert.deepEqual(again.initialBounds(), f.win.bounds, 'DIP 大小不重複除以 DPI');
});

test('拖曳連續事件合併儲存最後大小與位置', async t => {
  const f = fixture(t);
  f.win.emit('resize');
  f.win.bounds = { x: 95, y: 72, width: 1117, height: 703 };
  f.win.emit('resize'); f.win.emit('move');
  assert.equal(fs.existsSync(f.file), false);
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.deepEqual(f.read(), f.win.bounds);
});

test('全螢幕、最大化、最小化、模式轉換與銷毀不覆蓋一般視窗紀錄', t => {
  const f = fixture(t); f.tracker.remember(); const expected = f.read();
  f.win.bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  for (const key of ['full', 'max', 'min', 'destroyed']) {
    f.win[key] = true; f.tracker.remember(); assert.deepEqual(f.read(), expected); f.win[key] = false;
  }
  f.allow(false); f.win.emit('close'); assert.deepEqual(f.read(), expected);
});

test('副螢幕負座標正常還原；移除螢幕／工作區縮小時縮入可用區域', t => {
  const saved = { x: -1750, y: 70, width: 1037, height: 683 };
  const second = fixture(t, JSON.stringify(saved), { x: -1920, y: 0, width: 1920, height: 1040 });
  assert.deepEqual(second.store.initialBounds(), saved);
  const removed = fixture(t, JSON.stringify(saved), { x: 0, y: 0, width: 900, height: 600 });
  assert.deepEqual(removed.store.initialBounds(), { x: 0, y: 0, width: 900, height: 600 });
});

test('無法寫入偏好只記錄錯誤，不阻止關窗或宣稱保存成功', t => {
  const f = fixture(t); const errors = [];
  const blocker = path.join(path.dirname(f.file), 'not-a-directory'); fs.writeFileSync(blocker, 'x');
  const bad = create(path.join(blocker, 'window-bounds.json'), {}, (...args) => errors.push(args));
  const tracker = bad.bind(f.win, () => true);
  assert.doesNotThrow(() => tracker.remember());
  assert.equal(bad.hasSaved(), false); assert.ok(errors.length > 0);
});

async function displayHarness(saved) {
  const nodes = {}, calls = [];
  const node = id => nodes[id] || (nodes[id] = { listeners: {}, querySelectorAll: () => [], querySelector: () => null,
    addEventListener(name, fn) { this.listeners[name] = fn; } });
  const c = { console, STR: () => '', document: { getElementById: node },
    GameSettings: { get: key => key === 'displayResolution' ? '1920x1080' : 100, set() {} },
    window: { ApexHost: { display: { onChange() {}, get: async () => ({ mode: 'windowed', hasWindowBounds: saved }),
      setResolution: async (w, h) => { calls.push([w, h]); } } } } };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(require.resolve('../js/display-settings-ui.js'), 'utf8'), c);
  c.DisplaySettingsUI.init();
  await new Promise(resolve => setImmediate(resolve));
  return { nodes, calls };
}

test('顯示頁啟動有視窗紀錄時不覆蓋尺寸，手動選解析度仍生效', async () => {
  const h = await displayHarness(true);
  assert.deepEqual(h.calls, []);
  h.nodes['settings-pane-display'].listeners.change({ target: { id: 'set-display-resolution', value: '1920x1080' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls, [[1920, 1080]]);
  assert.deepEqual((await displayHarness(false)).calls, [[1920, 1080]], '首次啟動沿用原本設定');
});
