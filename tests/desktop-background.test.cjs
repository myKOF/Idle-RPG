'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { bindWindowActivity } = require('../electron/window-activity.cjs');
const source = fs.readFileSync(require.resolve('../js/game-visibility.js'), 'utf8');

function harness(desktop = true) {
  const events = new EventEmitter();
  let update, resolve;
  const query = new Promise(r => { resolve = r; });
  const document = { hidden: false, addEventListener: events.on.bind(events), dispatchEvent: e => events.emit(e.type) };
  const c = { document, Event: class { constructor(type) { this.type = type; } }, console,
    window: desktop ? { ApexHost: { activity: { get: () => query, onChange: fn => { update = fn; } } } } : {} };
  vm.createContext(c); vm.runInContext(source, c);
  return { c, document, resolve, update: state => update(state), fire: name => events.emit(name) };
}
function ticker() {
  return { started: true, starts: 0, stops: 0,
    start() { this.started = true; this.starts++; }, stop() { this.started = false; this.stops++; } };
}

test('桌面失焦／最小化／隱藏獨立於 Chromium visibility，還原後才恢復顯示', () => {
  const win = new EventEmitter(); const sent = [];
  let visible = true, focused = true, minimized = false;
  Object.assign(win, { isVisible: () => visible, isFocused: () => focused, isMinimized: () => minimized,
    isDestroyed: () => false, webContents: Object.assign(new EventEmitter(), { isDestroyed: () => false, send: (_, state) => sent.push(state.background) }) });
  const activity = bindWindowActivity(win);
  assert.equal(activity.get().background, false);
  focused = false; win.emit('blur');
  minimized = true; win.emit('minimize');
  minimized = false; win.emit('restore');
  focused = true; win.emit('focus');
  visible = false; win.emit('hide');
  visible = true; win.emit('show');
  assert.deepEqual(sent, [true, true, true, false, true, false]);
  assert.equal(bindWindowActivity(win, { alwaysActive: true }).get().background, false);
});

test('較早的初始查詢不得覆蓋新的原生視窗事件，停止中的 ticker 不被喚醒', async () => {
  const h = harness(); const t = ticker(); const stopped = ticker(); stopped.started = false;
  h.c.GameVisibility.trackTicker(t); h.c.GameVisibility.trackTicker(stopped);
  assert.equal(t.started, false);
  h.update({ background: false }); assert.equal(t.started, true); assert.equal(stopped.started, false);
  h.resolve({ background: true }); await Promise.resolve();
  assert.equal(h.c.GameVisibility.isHidden(), false);
  h.update({ background: true }); t.start(); assert.equal(t.started, false);
  h.update({ background: false }); assert.equal(t.started, true);
});

test('網頁版原生 visibility 仍停止／恢復繪圖，手動 stop 的意圖會保留', () => {
  const h = harness(false); const t = ticker(); h.c.GameVisibility.trackTicker(t);
  h.document.hidden = true; h.fire('visibilitychange'); assert.equal(t.started, false);
  t.stop(); h.document.hidden = false; h.fire('visibilitychange'); assert.equal(t.started, false);
  t.start(); assert.equal(t.started, true);
});

test('背景顯示暫停與選單 GameClock 暫停交錯時，不會誤啟動或永久停止 ticker', () => {
  for (const sequence of [['hide', 'pause', 'show', 'resume'], ['pause', 'hide', 'resume', 'show'], ['pause', 'hide', 'show', 'resume']]) {
    const h = harness(); h.update({ background: false });
    h.c.performance = { now: () => 0 }; h.c.Date = Date; h.c.globalThis = h.c;
    h.c.setTimeout = () => 1; h.c.clearTimeout = () => {};
    h.c.setInterval = () => 1; h.c.clearInterval = () => {};
    vm.runInContext(fs.readFileSync(require.resolve('../js/game-clock.js'), 'utf8'), h.c);
    const t = ticker(); h.c.GameVisibility.trackTicker(t); h.c.GameClock.trackTicker(t);
    let hidden = false, paused = false;
    for (const action of sequence) {
      if (action === 'hide' || action === 'show') { hidden = action === 'hide'; h.update({ background: hidden }); }
      else { paused = action === 'pause'; h.c.GameClock.setPaused(paused); }
      assert.equal(t.started, !hidden && !paused, sequence.join('/'));
    }
  }
});

test('桌面正式模式停用背景節流，活動 API 受既有來源守門且快取有更新', () => {
  const main = fs.readFileSync(require.resolve('../electron/main.cjs'), 'utf8');
  assert.match(main, /backgroundThrottling: false/);
  assert.match(main, /ipcMain.handle\('activity:get',[\s\S]*?if \(!trustedSender\(event\)\) throw/);
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert.ok(html.indexOf('js/game-visibility.js?') < html.indexOf('js/battle-renderer.js?'));
  for (const name of ['bridge', 'ui', 'battle-renderer', 'vfx', 'vfx-tower', 'sfx', 'start-menu-background']) {
    assert.match(html, new RegExp('js/' + name + '\\.js\\?v=20261119-background(?:-mini)?-v1'));
  }
});
