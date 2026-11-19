'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { create } = require('../electron/mini-window.cjs');

function setup(throttling = true, options = {}) {
  const windows = [], calls = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false; this.visible = false;
      this.bounds = { x: 50, y: 50, width: options.width || 1000, height: options.height || 700 };
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        mainFrame: {}, send: (...args) => calls.push(args),
        setWindowOpenHandler(fn) { this.openHandler = fn; },
        getBackgroundThrottling: () => throttling,
        getZoomFactor: () => 1,
        setBackgroundThrottling: value => { throttling = value; }
      });
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return !!this.minimized; }
    isMaximized() { return !!this.maximized; }
    isFocused() { return !!this.focused; }
    getNormalBounds() { return { ...this.bounds }; }
    maximize() { this.maximized = true; this.emit('maximize'); }
    minimize() { this.minimized = true; this.hide(); this.emit('minimize'); }
    close() { this.emit('close'); this.destroy(); }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    focus() { this.focused = true; }
    setAlwaysOnTop(value) { this.alwaysOnTop = value; }
    getBounds() { return { ...this.bounds }; }
    getContentBounds() { return { ...this.bounds }; }
    setPosition(x, y) { Object.assign(this.bounds, { x, y }); this.emit('moved'); }
    setBounds(bounds) { Object.assign(this.bounds, bounds); this.emit('moved'); }
    loadFile() { return new Promise((resolve, reject) => {
      this.loadedOnly = resolve;
      this.loaded = () => { this.miniReady(); resolve(); }; this.failed = reject;
    }); }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const owner = new Window({}); owner.show();
  const screen = options.screen || { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) };
  const monitor = create({ owner, BrowserWindow: Window, screen, ...options });
  return { owner, windows, calls, monitor, throttling: () => throttling };
}

test('載入完成才隱藏主窗；迷你置頂、還原時恢復原節流設定且不改主窗尺寸', async () => {
  const env = setup();
  const initial = { title: 'mini', snapshot: {} };
  const opening = env.monitor.open(initial), mini = env.windows[1];
  assert.equal(env.owner.visible, true);
  assert.equal(mini.visible, false);
  assert.equal(mini.options.alwaysOnTop, true);
  assert.equal(mini.options.webPreferences.sandbox, true);
  assert.equal(env.monitor.initial(), initial);
  mini.loaded(); await opening;
  assert.equal(env.owner.visible, false);
  assert.equal(mini.visible, true);
  assert.equal(env.throttling(), false);
  env.monitor.update({ stage: 'latest' });
  assert.deepEqual(env.calls.at(-1), ['mini:update', { stage: 'latest' }]);
  env.monitor.restore();
  assert.equal(mini.isDestroyed(), true);
  assert.equal(env.owner.visible, true);
  assert.equal(env.owner.focused, true);
  assert.equal(env.throttling(), true);
  assert.equal(env.calls.at(-1)[0], 'mini:closed');
});

test('HTML 載入但 renderer 尚未初始化時，主窗繼續可見', async () => {
  const env = setup();
  const opening = env.monitor.open({}), mini = env.windows[1];
  mini.loadedOnly();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.owner.visible, true);
  assert.equal(mini.visible, false);
  env.monitor.ready(); await opening;
  assert.equal(env.owner.visible, false);
  env.monitor.restore();
});

test('重複開啟共用載入與單一視窗，還原後可再次開啟', async () => {
  const env = setup(false);
  const first = env.monitor.open({});
  assert.equal(env.monitor.open({}), first);
  env.windows[1].loaded(); await first;
  await env.monitor.open({});
  assert.equal(env.windows.length, 2);
  env.windows[1].destroy();
  assert.equal(env.throttling(), false, '既有背景掛機設定不得被改回 true');
  const next = env.monitor.open({});
  env.windows[2].loaded(); await next;
  env.monitor.dispose();
});

test('載入失敗保留主窗並可重試，不會留下幽靈視窗', async () => {
  const env = setup();
  const first = env.monitor.open({});
  env.windows[1].failed(new Error('missing mini page'));
  await assert.rejects(first, /missing mini page/);
  assert.equal(env.owner.visible, true);
  assert.equal(env.windows[1].destroyed, true);
  assert.equal(env.throttling(), true);
  const next = env.monitor.open({}); env.windows[2].loaded(); await next;
  env.monitor.dispose();
});

test('迷你 renderer 結束會帶回主窗；結束遊戲只清理、不重開主窗', async () => {
  const env = setup();
  const first = env.monitor.open({}); env.windows[1].loaded(); await first;
  env.windows[1].webContents.emit('render-process-gone');
  assert.equal(env.owner.visible, true);
  const next = env.monitor.open({}); env.windows[2].loaded(); await next;
  const before = env.calls.length;
  env.monitor.dispose();
  assert.equal(env.owner.visible, false);
  assert.equal(env.throttling(), true);
  assert.equal(env.calls.length, before);
  await assert.rejects(env.monitor.open({}), /closing/);
});

test('載入中關閉或結束遊戲，遲到的載入不得隱藏主窗', async () => {
  for (const action of ['restore', 'dispose']) {
    const env = setup();
    const opening = env.monitor.open({});
    env.monitor[action](); env.windows[1].loaded();
    await assert.rejects(opening, /closed while loading/);
    assert.equal(env.owner.visible, true);
    assert.equal(env.throttling(), true);
  }
});

test('只有迷你主框架能取得初始化資料或要求恢復；禁止導覽與彈窗', async () => {
  const env = setup();
  const opening = env.monitor.open({}), mini = env.windows[1];
  const event = { sender: mini.webContents, senderFrame: mini.webContents.mainFrame };
  assert.equal(env.monitor.accepts(event), true);
  assert.equal(env.monitor.accepts({ ...event, senderFrame: {} }), false);
  assert.equal(env.monitor.accepts({ ...event, sender: env.owner.webContents }), false);
  assert.deepEqual(mini.webContents.openHandler({ url: 'https://example.com' }), { action: 'deny' });
  let blocked = false;
  mini.webContents.emit('will-navigate', { preventDefault() { blocked = true; } });
  assert.equal(blocked, true);
  mini.loaded(); await opening;
  env.monitor.restore();
  assert.equal(env.monitor.accepts(event), false);
});

test('共用渲染更新血魔量與戰況，日誌以文字顯示避免 HTML 注入', () => {
  const nodes = {};
  const document = {
    getElementById(id) { return nodes[id] ??= { style: {}, children: [], appendChild(child) { this.children.push(child); } }; },
    createTextNode(text) { return { text }; }, createElement(tag) { return { tag }; }
  };
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/mini-monitor.js'), 'utf8'), context);
  context.MiniMonitor.render(document, {
    stage: 'field', lv: 'Lv.8', pHp: 25, pMp: 50, eHp: 75,
    pHpText: '25 / 100', pMpText: '50 / 100', eHpText: '75 / 100',
    eName: 'boss', info: 'DPS 100', logs: ['<img onerror=bad()>', 'next']
  });
  assert.equal(nodes['m-stage'].textContent, 'field');
  assert.equal(nodes['m-php'].style.width, '25%');
  assert.equal(nodes['m-pmp'].style.width, '50%');
  assert.equal(nodes['m-ehp'].style.width, '75%');
  assert.deepEqual(nodes['m-log'].children, [{ text: '<img onerror=bad()>' }, { tag: 'br' }, { text: 'next' }]);
});

function positionFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-position-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'mini-window-position.json');
}
async function open(env) {
  const opening = env.monitor.open({}), mini = env.windows.at(-1);
  mini.loaded(); await opening; return mini;
}

test('首次依主遊戲所在螢幕的可用區域置中，包含負座標螢幕', async () => {
  let target;
  const env = setup(true, { screen: { getDisplayMatching: bounds => {
    target = bounds; return { workArea: { x: -1920, y: 40, width: 1920, height: 1040 } };
  } } });
  env.owner.bounds.x = -1500;
  const mini = await open(env);
  assert.equal(target.x, -1500);
  assert.deepEqual([mini.bounds.x, mini.bounds.y], [-1095, 435]);
  env.monitor.restore();
});

test('移動立即記錄，還原與重建控制器後從磁碟恢復上次位置', async t => {
  const file = positionFile(t), env = setup(true, { positionFile: file });
  const mini = await open(env);
  mini.setPosition(145, 236);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { x: 145, y: 236 });
  env.monitor.restore();
  const again = await open(env);
  assert.deepEqual([again.bounds.x, again.bounds.y], [145, 236]);
  // 最後拖曳位置即使尚未送出 moved，關閉仍須補保存。
  Object.assign(again.bounds, { x: 349, y: 456 });
  env.monitor.dispose();
  const restarted = setup(true, { positionFile: file });
  const restored = await open(restarted);
  assert.deepEqual([restored.bounds.x, restored.bounds.y], [349, 456]);
  restarted.monitor.restore();
});

test('－只最小化迷你；□回主窗，兩者均保存普通位置而不記錄最大化／最小化座標', async t => {
  const file = positionFile(t), env = setup(true, { positionFile: file });
  const mini = await open(env);
  assert.equal(mini.options.minimizable, true);
  assert.equal(mini.options.maximizable, true);
  mini.setPosition(200, 300);
  const normal = mini.getBounds();
  mini.getBounds = () => mini.minimized ? { x: -32000, y: -32000, width: 270, height: 250 } :
    mini.maximized ? { x: 0, y: 0, width: 1920, height: 1040 } : normal;
  mini.minimize();
  assert.equal(env.owner.visible, false);
  assert.equal(mini.destroyed, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { x: 200, y: 300 });
  mini.minimized = false; mini.maximize();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(mini.destroyed, true);
  assert.equal(env.owner.visible, true);
  const again = await open(env);
  assert.deepEqual([again.bounds.x, again.bounds.y], [200, 300]);
  Object.assign(again.bounds, { x: 310, y: 420 }); again.close();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { x: 310, y: 420 });
});

test('螢幕拔除／工作區縮小時限制在畫面內，既有負座標位置可以保留', async t => {
  const file = positionFile(t);
  fs.writeFileSync(file, JSON.stringify({ x: -900, y: 300 }));
  const negative = setup(true, { positionFile: file, screen: {
    getDisplayMatching: () => ({ workArea: { x: -1920, y: 0, width: 1920, height: 1040 } })
  } });
  const first = await open(negative);
  assert.deepEqual([first.bounds.x, first.bounds.y], [-900, 300]); negative.monitor.restore();
  const removed = setup(true, { positionFile: file });
  const second = await open(removed);
  assert.deepEqual([second.bounds.x, second.bounds.y], [0, 300]); removed.monitor.restore();
  fs.writeFileSync(file, JSON.stringify({ x: 1800, y: 1000 }));
  const smaller = setup(true, { positionFile: file, screen: {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 24, width: 1280, height: 696 } })
  } });
  const third = await open(smaller);
  assert.deepEqual([third.bounds.x, third.bounds.y], [1010, 470]); smaller.monitor.restore();
});

test('位置偏好損壞或格式不合法時首次置中，不影響主窗切換', async t => {
  const file = positionFile(t);
  for (const invalid of ['broken json', 'null', '{"x":"12","y":30}', '{"x":12.5,"y":30}', '{"x":9007199254740991,"y":30}']) {
    fs.writeFileSync(file, invalid);
    const env = setup(true, { positionFile: file });
    const mini = await open(env);
    assert.deepEqual([mini.bounds.x, mini.bounds.y], [825, 395]);
    env.monitor.restore(); assert.equal(env.owner.visible, true);
  }
});

test('偏好寫入失敗仍在本次執行記住位置並保持可還原', async t => {
  const file = positionFile(t); fs.writeFileSync(file, 'not a directory');
  const errors = [], env = setup(true, { positionFile: path.join(file, 'position.json'), log: (...args) => errors.push(args) });
  const mini = await open(env); mini.setPosition(234, 345); env.monitor.restore();
  assert.equal(env.owner.visible, true); assert.ok(errors.length > 0);
  const again = await open(env); assert.deepEqual([again.bounds.x, again.bounds.y], [234, 345]);
  env.monitor.restore();
});

test('按住期間即時跟隨游標，放開後停止並只保存最後位置，重開保持位置', async t => {
  const file = positionFile(t);
  let cursor = { x: 845, y: 410 };
  const env = setup(true, { positionFile: file, screen: {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    getCursorScreenPoint: () => ({ ...cursor })
  } });
  const mini = await open(env);
  const size = [mini.bounds.width, mini.bounds.height];
  env.monitor.drag('start', { x: 20, y: 15 });
  cursor = { x: 945, y: 470 }; env.monitor.drag('move');
  assert.deepEqual([mini.bounds.x, mini.bounds.y], [925, 455]);
  assert.equal(fs.existsSync(file), false, '每次移動不寫磁碟');
  env.monitor.drag('start', { x: 20, y: 15 });
  cursor = { x: 845, y: 420 }; env.monitor.drag('move');
  assert.deepEqual([mini.bounds.x, mini.bounds.y], [825, 405], '重複 start 不重設滑鼠偏移');
  cursor = { x: 800, y: 400 }; env.monitor.drag('end');
  assert.deepEqual([mini.bounds.x, mini.bounds.y], [780, 385], '放開包含最後一筆游標位置');
  assert.deepEqual([mini.bounds.width, mini.bounds.height], size, '連續移動使用起始尺寸');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { x: 780, y: 385 });
  cursor = { x: 900, y: 500 }; env.monitor.drag('move');
  assert.deepEqual([mini.bounds.x, mini.bounds.y], [780, 385]);
  env.monitor.restore();
  const again = await open(env);
  assert.deepEqual([again.bounds.x, again.bounds.y], [780, 385]);
  env.monitor.restore();
});

test('跨負座標螢幕使用原生 DIP；失焦、最小化或關閉中止拖曳', async () => {
  for (const action of ['blur', 'minimize', 'restore']) {
    let cursor = { x: 845, y: 410 };
    const env = setup(true, { screen: {
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
      getCursorScreenPoint: () => ({ ...cursor })
    } });
    const mini = await open(env);
    env.monitor.drag('move');
    assert.deepEqual([mini.bounds.x, mini.bounds.y], [825, 395], '未按住不移動');
    env.monitor.drag('start', { x: 20, y: 15 });
    cursor = { x: -955, y: 210 }; env.monitor.drag('move');
    assert.deepEqual([mini.bounds.x, mini.bounds.y], [-975, 195]);
    if (action === 'blur') mini.emit('blur');
    else if (action === 'minimize') mini.minimize();
    else env.monitor.restore();
    cursor = { x: -850, y: 300 }; env.monitor.drag('move');
    assert.deepEqual([mini.bounds.x, mini.bounds.y], [-975, 195], action);
    env.monitor.dispose();
  }
});

test('快速拖曳保留按下位置並換算內容邊框及縮放，多次拖曳不累加原生取整尺寸', async () => {
  let cursor = { x: 1100, y: 700 };
  const env = setup(true, { screen: {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    getCursorScreenPoint: () => cursor
  } });
  const mini = await open(env), requested = [];
  mini.getContentBounds = () => ({ ...mini.bounds, x: mini.bounds.x + 1, y: mini.bounds.y + 2 });
  mini.webContents.getZoomFactor = () => 1.5;
  mini.setBounds = bounds => {
    requested.push(bounds);
    Object.assign(mini.bounds, bounds, { width: bounds.width + 1, height: bounds.height + 2 });
  };
  for (let i = 0; i < 3; i++) {
    env.monitor.drag('start', { x: 20, y: 10 });
    env.monitor.drag('move');
    assert.deepEqual([mini.bounds.x, mini.bounds.y], [cursor.x - 31, cursor.y - 17]);
    env.monitor.drag('end');
    cursor = { x: cursor.x + 100, y: cursor.y + 50 };
  }
  assert.deepEqual(requested.map(bounds => [bounds.width, bounds.height]), [[270, 250], [270, 250], [270, 250]]);
  Object.assign(mini.bounds, { width: 400, height: 300 }); mini.emit('resized');
  env.monitor.drag('start', { x: 20, y: 10 }); env.monitor.drag('move'); env.monitor.drag('end');
  assert.deepEqual([requested.at(-1).width, requested.at(-1).height], [400, 300]);
  env.monitor.restore();
});

function titleBarPreload(platform = 'win32') {
  const sends = [], nodes = {}, handlers = {};
  let api;
  function node() {
    return {
      style: {}, children: [], handlers: {}, captured: null,
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.append(child); },
      prepend(child) { this.children.unshift(child); nodes[child.id] = child; },
      addEventListener(name, fn) { this.handlers[name] = fn; },
      setPointerCapture(id) { this.captured = id; },
      hasPointerCapture(id) { return this.captured === id; },
      releasePointerCapture() { this.captured = null; }
    };
  }
  const document = { title: 'title from String table', body: node(), createElement: node, getElementById: id => nodes[id] };
  const context = vm.createContext({ document, process: { platform },
    window: { addEventListener: (name, fn) => { handlers[name] = fn; } },
    require: () => ({ ipcRenderer: { invoke() {}, send: (...args) => sends.push(JSON.parse(JSON.stringify(args))) },
      contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } })
  });
  vm.runInContext(fs.readFileSync(require.resolve('../electron/mini-preload.cjs'), 'utf8'), context);
  api.ready(); api.ready();
  return { sends, nodes, handlers, document, api };
}

test('專用標題列捕捉左鍵拖曳，放開／取消／失去捕捉／失焦清理且不暴露拖曳 API', () => {
  for (const finish of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) {
    const env = titleBarPreload(), bar = env.nodes['mini-titlebar'];
    const event = { button: 0, buttons: 1, pointerId: 7, isPrimary: true, clientX: 20, clientY: 15, preventDefault() {} };
    assert.equal(env.document.body.children.length, 1, '重複 ready 不重建標題列');
    assert.equal(bar.children[0].children[1].textContent, env.document.title);
    assert.equal(env.api.drag, undefined);
    bar.handlers.pointerdown({ ...event, button: 2 });
    bar.handlers.pointerdown({ ...event, isPrimary: false });
    assert.deepEqual(env.sends, []);
    bar.handlers.pointerdown(event);
    assert.equal(bar.captured, 7);
    bar.handlers.pointermove({ ...event, pointerId: 8 });
    bar.handlers.pointerup({ ...event, pointerId: 8 });
    bar.handlers.pointermove(event);
    if (finish === 'blur') env.handlers.blur({});
    else bar.handlers[finish](event);
    bar.handlers.pointermove(event);
    assert.deepEqual(env.sends, [['mini:drag', 'start', { x: 20, y: 15 }], ['mini:drag', 'move'], ['mini:drag', 'end']], finish);
    assert.equal(bar.captured, null);
  }
  assert.equal(titleBarPreload('linux').nodes['mini-titlebar'], undefined);
  const env = titleBarPreload(); env.nodes['mini-titlebar'].handlers.dblclick({});
  assert.deepEqual(env.sends, [['mini:restore']]);
});
