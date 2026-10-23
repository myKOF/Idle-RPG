const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeElement() {
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {} },
    closest() { return null; }
  };
}

function loadUi() {
  const root = path.resolve(__dirname, '..');
  const elements = new Map();
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const context = {
    console,
    setTimeout() {},
    clearTimeout() {},
    document: {
      getElementById,
      querySelectorAll() { return []; },
      addEventListener() {},
      createElement() { return makeElement(); },
      body: makeElement()
    },
    location: { reload() {} },
    confirm() { return true; },
    bossFightBlocksCommand() { return false; }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/item.js', 'js/ui.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return { context, elements };
}

test('Shift+left pool action adds exactly one gem and can create a new slot', () => {
  const { context } = loadUi();
  const slots = [{ type: 'ruby', lv: 1, n: 3 }];

  const existing = context.adjustGemConvertPool(slots, 'ruby', 1, 10, true, 1000, 9);
  assert.equal(existing.ok, true);
  assert.equal(existing.amount, 1);
  assert.equal(existing.slots[0].n, 4);
  assert.equal(slots[0].n, 3);

  const created = context.adjustGemConvertPool(slots, 'opal', 2, 10, true, 1000, 9);
  assert.equal(created.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(created.slots)), [
    { type: 'ruby', lv: 1, n: 3 },
    { type: 'opal', lv: 2, n: 1 }
  ]);
});

test('Shift+left grid action removes exactly one gem and removes an empty slot', () => {
  const { context } = loadUi();
  const slots = [{ type: 'ruby', lv: 1, n: 2 }, { type: 'opal', lv: 2, n: 1 }];

  const decremented = context.removeGemConvertSlot(slots, 0, true);
  assert.equal(decremented.ok, true);
  assert.equal(decremented.amount, 1);
  assert.equal(decremented.slots[0].n, 1);

  const removed = context.removeGemConvertSlot(decremented.slots, 0, true);
  assert.equal(removed.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(removed.slots)), [
    { type: 'opal', lv: 2, n: 1 }
  ]);
});

test('gem conversion info displays the Shift+left shortcut', () => {
  const { context, elements } = loadUi();
  context.UI.convertSlots = [];
  context.renderGemConvert({ gems: { ruby: { 1: 1 } }, fusedGems: [] });

  const info = elements.get('gconv-info');
  assert.match(info.textContent + info.innerHTML, /Shift\+左鍵：單顆放入／取下/);
});

test('DOM change event仍讀取正式快照縮減過期原料，目標產出只顯示圖示數量', () => {
  const { context, elements } = loadUi();
  context.UI.convertSlots = [{ type: 'ruby', lv: 1, n: 8 }];
  const gemsSnapshot = {
    gems: { ruby: { 1: 2 } },
    fusedGems: []
  };
  context.panelData = () => gemsSnapshot;
  context.document.getElementById('gconv-target').value = 'opal';

  // addEventListener passes the Event object as the first argument when a
  // renderer is used directly as the callback.
  context.renderGemConvert({ type: 'change' });

  assert.equal(context.UI.convertSlots[0].n, 2);
  assert.match(elements.get('gconv-output').innerHTML, /×1/);
  assert.match(elements.get('gconv-output').innerHTML, /蛋白石/);
  assert.equal(elements.get('gconv-btn').disabled, false);
  assert.doesNotMatch(elements.get('gconv-info').innerHTML, /轉換結果預覽|數量不變/);
});

test('Shift conversion sends the exact gem.convert Worker command', async () => {
  const { context } = loadUi();
  let sent = null;
  context.WorkerBridge = {
    send(name, args) {
      sent = { name, args: JSON.parse(JSON.stringify(args)) };
      return Promise.resolve({ ok: true });
    }
  };
  const adjusted = context.adjustGemConvertPool([], 'sapphire', 1, 3, true, 1000, 9);

  await context.sendUiCommand('gem.convert', {
    slots: adjusted.slots,
    targetType: 'ruby'
  }, { keys: [], panels: [] });

  assert.deepEqual(sent, {
    name: 'gem.convert',
    args: {
      slots: [{ type: 'sapphire', lv: 1, n: 1 }],
      targetType: 'ruby'
    }
  });
});

test('上方來源依尚可放入數量／九格／千顆上限禁用，滿九格仍可追加既有堆疊', () => {
  const { context } = loadUi();
  const snapshot = { gems: { ruby: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, 2000])) }, fusedGems: [] };
  context.panelData = () => snapshot;
  context.renderGems = () => {};
  context.blog = () => {};
  context.UI.gemBrowse.tool = 'convert';
  assert.equal(context.stageGemConvert('ruby', 1, true), true);
  assert.equal(context.UI.convertSlots[0].n, 1);
  assert.equal(context.stageGemConvert('ruby', 1, false), true);
  assert.equal(context.UI.convertSlots[0].n, 1000);
  assert.match(context.gemConvertBlockReason(snapshot, 'ruby', 1), /上限/);
  for (let lv = 2; lv <= 9; lv++) assert.equal(context.stageGemConvert('ruby', lv, true), true);
  assert.match(context.gemConvertBlockReason(snapshot, 'ruby', 10), /已滿/);
  assert.equal(context.stageGemConvert('ruby', 10, true), false);
  assert.equal(context.stageGemConvert('ruby', 2, true), true);
  assert.equal(context.UI.convertSlots[1].n, 2);
  const html = context.gemFocusHTML(snapshot, 'ruby', 20000);
  const cell10 = html.match(/<button[^>]*data-gem-lv="10"[^>]*>/)[0];
  assert.match(cell10, /disabled/);
  assert.match(cell10, /draggable="false"/);
  context.UI.gemBrowse.tool = 'compose';
  assert.equal(context.stageGemConvert('ruby', 2, true), false);
  assert.doesNotMatch(context.gemFocusHTML(snapshot, 'ruby', 20000), /data-gconv-gem| disabled/);
});

test('轉換拖放只接受本頁來源，放下重新驗庫存；拖影只有同尺寸圖示，取消清除', () => {
  const { context } = loadUi();
  const snapshot = { gems: { ruby: { 1: 4 } }, fusedGems: [] };
  context.panelData = () => snapshot;
  context.UI.gemBrowse.tool = 'convert';
  context.renderGems = () => {};
  context.blog = () => {};
  const nodes = {};
  for (const id of ['gem-focus', 'gconv-grid', 'gconv-btn', 'gconv-clear', 'gconv-target']) {
    const el = context.document.getElementById(id);
    el.handlers = {};
    el.addEventListener = (name, fn) => { el.handlers[name] = fn; };
    nodes[id] = el;
  }
  const ghosts = [];
  context.document.createElement = () => ({ style: {}, children: [], setAttribute() {}, appendChild(n) { this.children.push(n); }, remove() { this.removed = true; } });
  context.document.body.appendChild = node => ghosts.push(node);
  context.initGemConvertUi();
  const image = { style: {} };
  const icon = { getBoundingClientRect: () => ({ left: 20, top: 30, width: 42, height: 42 }), cloneNode: () => image };
  const source = { closest: () => source, getAttribute: () => 'ruby:1', querySelector: () => icon };
  let ghost, hotspot;
  const transfer = { setData() {}, setDragImage(el, x, y) { ghost = el; hotspot = [x, y]; } };
  const event = { target: source, dataTransfer: transfer, preventDefault() {} };
  const grid = nodes['gconv-grid'].handlers, focus = nodes['gem-focus'].handlers;
  grid.drop(event);
  assert.equal((context.UI.convertSlots || []).length, 0, '外部拖曳不能憑payload放入');
  focus.dragstart(event);
  assert.equal(ghost.children.length, 1);
  assert.equal(ghost.children[0], image);
  assert.match(ghost.style.cssText, /width:42px;height:42px/);
  assert.deepEqual(hotspot, [21, 21]);
  snapshot.gems.ruby[1] = 0;
  grid.drop(event);
  assert.equal((context.UI.convertSlots || []).length, 0, '拖曳途中失效不放入');
  assert.equal(ghost.removed, true);
  assert.equal(context.UI.gemBrowse.convertDrag, null);
  snapshot.gems.ruby[1] = 4;
  focus.dragstart(event);
  grid.drop({ ...event, shiftKey: true });
  assert.equal(context.UI.convertSlots[0].n, 1);
  assert.equal(ghost.removed, true);
  focus.dragstart(event);
  focus.dragend(event);
  assert.equal(context.UI.convertSlots[0].n, 1, '取消拖曳不增加原料');
  assert.equal(ghost.removed, true);
});

test('按下即播、快照早於回覆不清畫面；確認成功仍等兩秒結束才提示，刷新／連點不重播', async () => {
  const { context, elements } = loadUi();
  const snapshot = { gems: { ruby: { 1: 4 }, opal: { 1: 0 } }, fusedGems: [] };
  context.panelData = () => snapshot;
  context.UI.gemBrowse.tool = 'convert';
  context.UI.convertSlots = [{ type: 'ruby', lv: 1, n: 4 }];
  context.document.getElementById('gconv-target').value = 'opal';
  context.renderGems = () => context.renderGemConvert(snapshot);
  context.blog = () => {};
  const timers = [];
  context.setTimeout = (fn, ms) => timers.push({ fn, ms });
  let calls = 0, succeed, resolveCommand;
  context.sendGemUiCommand = (name, args, ref, panels, onSuccess) => {
    calls++;
    assert.equal(name, 'gem.convert');
    assert.equal(args.slots[0].n, 4);
    succeed = onSuccess;
    return new Promise(resolve => { resolveCommand = resolve; });
  };
  const pending = context.runGemConvert();
  assert.equal(context.UI.gemConvertFx.phase, 'playing');
  assert.equal(context.UI.gemConvertFx.acknowledged, false);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 2000);
  assert.equal(elements.get('gem-focus').inert, true);
  assert.equal(elements.get('gem-table').inert, true);
  snapshot.gems.ruby[1] = 0;
  snapshot.gems.opal[1] = 2;
  context.renderGems();
  assert.match(elements.get('gconv-grid').innerHTML, /×4/);
  assert.match(elements.get('gconv-output').innerHTML, /×2/);
  assert.equal(elements.get('gconv-status').textContent, '');
  assert.equal(elements.get('gconv-btn').disabled, true);
  assert.equal(elements.get('gconv-target').disabled, true);
  assert.equal(elements.get('gconv-clear').disabled, true);
  assert.equal(context.stageGemConvert('opal', 1, true), false);
  await context.runGemConvert();
  assert.equal(calls, 1);
  succeed();
  resolveCommand(null);
  await pending;
  assert.equal(context.UI.gemConvertFx.phase, 'playing');
  assert.equal(context.UI.gemConvertFx.acknowledged, true);
  assert.equal(context.UI.convertSlots.length, 0);
  assert.equal(elements.get('gconv-status').textContent, '');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 2000);
  for (let i = 0; i < 3; i++) context.renderGems();
  assert.match(elements.get('gconv-grid').innerHTML, /×4/);
  assert.match(elements.get('gconv-output').innerHTML, /×2/);
  assert.equal(timers.length, 1);
  timers[0].fn();
  assert.equal(context.UI.gemConvertFx, null);
  assert.doesNotMatch(elements.get('gconv-grid').innerHTML, /class="gconv-slot filled"/);
  assert.equal(elements.get('gconv-output').innerHTML, '');
  assert.equal(elements.get('gconv-status').textContent, '轉換成功！');
  assert.equal(elements.get('gconv-target').disabled, false);
  assert.equal(elements.get('gconv-clear').disabled, false);
  assert.equal(elements.get('gem-focus').inert, false);
  assert.equal(elements.get('gem-table').inert, false);
  assert.equal(context.stageGemConvert('opal', 1, true), true);
  assert.equal(elements.get('gconv-status').textContent, '');
  assert.equal(snapshot.gems.opal[1], 2, '轉場及下一次暫放不重複修改權威庫存');
});

test('權威拒絕取消光效及計時、不提示成功，保留原料並解鎖，可立即重試', async () => {
  const { context, elements } = loadUi();
  const snapshot = { gems: { ruby: { 1: 4 } }, fusedGems: [] };
  context.panelData = () => snapshot;
  context.UI.convertSlots = [{ type: 'ruby', lv: 1, n: 4 }];
  context.document.getElementById('gconv-target').value = 'opal';
  context.renderGems = () => context.renderGemConvert(snapshot);
  context.blog = () => {};
  const errors = [], timers = [];
  context.reportUiCommandFailure = (label, error) => errors.push(error);
  context.setTimeout = (fn, ms) => timers.push({ fn, ms });
  context.clearTimeout = id => { timers[id - 1].cancelled = true; };
  context.sendUiCommand = () => Promise.resolve('庫存不足');
  await context.runGemConvert();
  assert.deepEqual(errors, ['庫存不足']);
  assert.equal(context.UI.gemConvertFx, null);
  assert.equal(context.UI.convertSlots[0].n, 4);
  assert.equal(elements.get('gconv-status').textContent, '');
  assert.equal(elements.get('gconv-btn').disabled, false);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].cancelled, true);
  timers[0].fn();
  assert.equal(context.UI.gemConvertFx, null);
  context.sendUiCommand = () => Promise.reject(new Error('連線失敗'));
  await context.runGemConvert();
  assert.equal(errors[1].message, '連線失敗');
  assert.equal(context.UI.gemConvertFx, null);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].cancelled, true);
  context.sendUiCommand = () => Promise.resolve(null);
  await context.runGemConvert();
  assert.equal(context.UI.gemConvertFx.phase, 'playing');
  assert.equal(elements.get('gconv-status').textContent, '');
  assert.equal(timers.length, 3);
  timers[0].fn();
  assert.equal(context.UI.gemConvertFx.phase, 'playing', '舊回呼不能清除重試中的展示');
  timers[2].fn();
  assert.equal(elements.get('gconv-status').textContent, '轉換成功！');
});

test('兩秒結束但權威回覆尚未到達時不假報成功；晚回覆完成、不重播或重設計時', async () => {
  const { context, elements } = loadUi();
  const snapshot = { gems: { ruby: { 1: 4 } }, fusedGems: [] };
  context.panelData = () => snapshot;
  context.UI.convertSlots = [{ type: 'ruby', lv: 1, n: 4 }];
  context.document.getElementById('gconv-target').value = 'opal';
  context.renderGems = () => context.renderGemConvert(snapshot);
  context.blog = () => {};
  const timers = [];
  context.setTimeout = (fn, ms) => timers.push({ fn, ms });
  let confirm, resolveCommand;
  context.sendGemUiCommand = (cmd, args, ref, panels, onSuccess) => {
    confirm = onSuccess;
    return new Promise(resolve => { resolveCommand = resolve; });
  };
  const pending = context.runGemConvert();
  timers[0].fn();
  assert.equal(context.UI.gemConvertFx.elapsed, true);
  assert.equal(context.UI.gemConvertFx.acknowledged, false);
  assert.equal(elements.get('gconv-status').textContent, '');
  assert.equal(elements.get('gconv-btn').disabled, true);
  confirm();
  resolveCommand(null);
  await pending;
  assert.equal(context.UI.gemConvertFx, null);
  assert.equal(elements.get('gconv-status').textContent, '轉換成功！');
  assert.equal(elements.get('gconv-output').innerHTML, '');
  assert.equal(timers.length, 1);
});
