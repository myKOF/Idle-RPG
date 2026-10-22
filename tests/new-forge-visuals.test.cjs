'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/ui-newforge-visuals.js'), 'utf8');

function harness(overrides = {}) {
  let time = 0, reduced = false, paints = 0, serial = 0;
  const jobs = new Map();
  const gradient = { addColorStop() {} };
  const drawing = new Proxy({}, { get: (_, key) => {
    if (key === 'clearRect') return () => paints++;
    if (String(key).startsWith('create')) return () => gradient;
    return () => {};
  }, set: () => true });
  class Element {
    constructor() { this.children = []; this.style = {}; this.attrs = {}; this.isConnected = true; this.clientWidth = 352; }
    set innerHTML(value) { this.children = []; this.firstElementChild = value ? new Element() : null; }
    appendChild(child) { if (child.parentNode) child.remove(); child.parentNode = this; child.isConnected = true; this.children.push(child); }
    setAttribute(k, v) { this.attrs[k] = v; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; this.isConnected = false; }
  }
  const node = new Element();
  node.parentNode = { querySelector: () => ({ getContext: () => drawing }) };
  const context = {
    console, document: { hidden: false, createElement: () => new Element() },
    UI: { tab: 'newforge' }, NEW_FORGE_BELT_SHOW: 30, NEW_FORGE_INTERVAL: 2,
    nfBeltChipsHTML: () => '<span class="conv-chip"></span>',
    matchMedia: () => ({ matches: reduced }),
    GameClock: { now: () => time, requestAnimationFrame: fn => { const id = ++serial; jobs.set(id, fn); return id; } }
  };
  Object.assign(context, overrides);
  vm.createContext(context); vm.runInContext(source, context);
  const fu = { id: 1, enabled: true, cycleDurationSec: 2, cycleRemainingSec: 2, belt: [] };
  const entries = () => node.children.filter(c => c.attrs['data-nf-item-id']);
  return { node, fu, entries, context, jobs,
    update() { context.NewForgeVisuals.update(node, fu); },
    step(ms) { time += ms; const callbacks = [...jobs.values()]; jobs.clear(); callbacks.forEach(fn => fn(time)); },
    reduce(value) { reduced = value; }, paints: () => paints,
    x(entry) { return Number(entry.style.transform.match(/translate3d\(([-.\d]+)px/)[1]); }
  };
}

test('單件從最右側進場並連續左移，重複快照不重建或重設進度', () => {
  const h = harness(); h.fu.belt = [{ id: 'a' }]; h.update();
  const a = h.entries()[0];
  assert.equal(h.x(a), 352);
  h.step(500); assert.equal(h.x(a), 264);
  h.fu.cycleRemainingSec = 1.5; h.update();
  assert.equal(h.entries()[0], a); assert.equal(h.x(a), 264);
  h.step(500); assert.equal(h.x(a), 176);
  h.step(500); assert.equal(h.x(a), 88);
  h.step(500); assert.equal(h.x(a), 0);
});

test('相同外觀不同ID分別入帶，消耗頭件後出帶而後件續移', () => {
  const h = harness(); h.fu.belt = [{ id: 'a', name: '同名' }]; h.update(); h.step(1000);
  const a = h.entries()[0]; h.fu.belt.push({ id: 'b', name: '同名' }); h.update();
  const b = h.entries()[1]; assert.notEqual(a, b); assert.equal(h.x(b), 352);
  h.step(500); const before = h.x(b);
  h.fu.belt.shift(); h.update(); assert.equal(h.entries().length, 2);
  h.step(200); assert.equal(h.entries().length, 2, '提前消耗仍保留頭件的剩餘入場路徑');
  h.step(1800); assert.equal(h.entries().length, 1); assert.equal(h.entries()[0], b);
  assert.ok(h.x(b) < before); assert.ok(h.x(b) >= 0);
});

test('停用凍結圖示與程序火焰、恢復不補走停用時間，離頁停止共用排程', () => {
  const h = harness(); h.fu.belt = [{ id: 'a' }]; h.update(); h.step(500);
  const a = h.entries()[0], x = h.x(a); h.fu.enabled = false; h.update();
  const paints = h.paints(); h.step(1000);
  assert.equal(h.x(a), x); assert.equal(h.paints(), paints); assert.equal(h.jobs.size, 0);
  h.fu.enabled = true; h.update(); h.step(500); assert.equal(h.x(a), x - 88);
  assert.ok(h.paints() > paints); assert.equal(h.jobs.size, 1);
  h.context.UI.tab = 'inv'; h.step(500); assert.equal(h.jobs.size, 0);
  h.context.UI.tab = 'newforge'; h.update(); assert.equal(h.jobs.size, 1);
  h.node.isConnected = false; h.step(16); assert.equal(h.jobs.size, 0);
});

test('窄帶限制可見節點、Resize後新節點從右進場，減少動態保持裝備靜態但爐火續播', () => {
  const h = harness(); h.node.clientWidth = 88;
  h.fu.belt = Array.from({ length: 30 }, (_, i) => ({ id: String(i) })); h.update();
  assert.equal(h.entries().length, 2); h.step(2000);
  const first = h.entries()[0]; h.node.clientWidth = 176; h.update();
  assert.equal(h.entries().length, 4); assert.equal(h.entries()[0], first);
  assert.equal(h.x(h.entries()[2]), 176);
  h.reduce(true); h.update();
  assert.deepEqual(h.entries().map(e => h.x(e)), [0, 44, 88, 132]);
  const paints = h.paints(); h.step(1000); assert.ok(h.paints() > paints); assert.equal(h.jobs.size, 1);
  assert.deepEqual(h.entries().map(e => h.x(e)), [0, 44, 88, 132]);
  h.reduce(false); h.update();
  assert.deepEqual(h.entries().map(e => h.x(e)), [0, 44, 88, 132], '恢復動態不得倒退回原進場位置');
});

test('減少動態開啟時空熔爐亦持續冒焰，不等待新快照，停用與離頁仍停止', () => {
  const h = harness(); h.reduce(true); h.update();
  let paints = h.paints();
  h.step(100); assert.ok(h.paints() > paints, '不可只畫第一幀便凍結運轉中的爐火');
  paints = h.paints(); h.step(100); assert.ok(h.paints() > paints);
  h.fu.enabled = false; h.update(); paints = h.paints();
  h.step(500); assert.equal(h.paints(), paints); assert.equal(h.jobs.size, 0);
  h.fu.enabled = true; h.update(); h.step(100); assert.ok(h.paints() > paints);
  h.context.UI.tab = 'equip'; h.step(100); paints = h.paints();
  h.step(500); assert.equal(h.paints(), paints); assert.equal(h.jobs.size, 0);
  h.context.UI.tab = 'newforge'; h.update(); h.step(100); assert.ok(h.paints() > paints);
});

test('變更週期時仍以同一等速續走', () => {
  const h = harness(); h.fu.belt = [{ id: 'a' }]; h.update(); h.step(500);
  const a = h.entries()[0]; assert.equal(h.x(a), 264);
  h.fu.cycleDurationSec = 1; h.fu.cycleRemainingSec = .75; h.update();
  assert.equal(h.x(a), 264);
  h.step(250); assert.equal(h.x(a), 220);
  h.step(1000); assert.equal(h.x(a), 44);
  h.step(500); assert.equal(h.x(a), 0);
});

test('卡片重建搬回原節點，舊快照同外觀多件仍有不同節點', () => {
  const h = harness(); h.fu.belt = [{ name: '同名' }, { name: '同名' }]; h.update(); h.step(500);
  const entries = h.entries(), before = entries.map(e => h.x(e));
  const next = { clientWidth: 352, isConnected: true, style: {}, children: [],
    parentNode: { querySelector: () => null }, set innerHTML(_) { this.children = []; },
    appendChild(child) { if (child.parentNode) child.remove(); child.parentNode = this; this.children.push(child); } };
  h.context.NewForgeVisuals.update(next, h.fu);
  const moved = next.children.filter(c => c.attrs['data-nf-item-id']);
  assert.deepEqual(moved, entries); assert.deepEqual(moved.map(e => h.x(e)), before);
});

test('捲出畫面不重繪粒子，捲回恢復，移除時釋放可見性觀察', () => {
  let observer;
  const h = harness({ IntersectionObserver: class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {} disconnect() { this.disconnected = true; }
  } });
  h.fu.belt = [{ id: 'a' }]; h.update();
  observer.callback([{ isIntersecting: false }]); const paints = h.paints();
  h.step(500); assert.equal(h.jobs.size, 0); assert.equal(h.paints(), paints);
  h.fu.belt = [{ id: 'b' }]; h.update(); assert.equal(h.entries().length, 1);
  observer.callback([{ isIntersecting: true }]); h.step(100);
  assert.equal(h.jobs.size, 1); assert.ok(h.paints() > paints);
  h.node.isConnected = false; h.step(16); assert.equal(observer.disconnected, true);
});

test('畫面外收到新裝備，回到可見狀態時必須仍由右端入場', () => {
  let observer;
  const h = harness({ IntersectionObserver: class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {} disconnect() {}
  } });
  h.update(); observer.callback([{ isIntersecting: false }]); h.step(100);
  h.fu.belt = [{ id: 'new-while-hidden' }]; h.update(); h.step(500);
  observer.callback([{ isIntersecting: true }]);
  const item = h.entries()[0]; assert.equal(h.x(item), 352);
  h.step(500); assert.ok(h.x(item) > 0 && h.x(item) < 352);
});

test('高速熔爐在入場途中消耗裝備，仍完成可見的右至左路徑', () => {
  const h = harness(); h.fu.cycleDurationSec = .05; h.fu.cycleRemainingSec = .01;
  h.fu.belt = [{ id: 'fast' }]; h.update(); h.step(20);
  h.fu.belt = []; h.update(); h.step(100);
  assert.equal(h.entries().length, 1, '不得在180ms內壓縮整段傳送帶路徑');
  assert.ok(h.x(h.entries()[0]) > 0 && h.x(h.entries()[0]) < 352);
  h.step(1000); assert.equal(h.entries().length, 0, '已消耗的演出節點最終必須清除');
});

test('大量裝備一次入帶：同批新件逐格貼齊，不重疊也不逐件拉大間距', () => {
  const h = harness(); h.fu.belt = Array.from({ length: 30 }, (_, i) => ({ id: 'm' + i }));
  h.update();
  const xs = h.entries().map(e => h.x(e));
  for (let i = 1; i < xs.length; i++) assert.equal(xs[i] - xs[i - 1], 44, '入場起點逐件相隔一格');
  for (let k = 0; k < 30; k++) {
    h.step(120); h.fu.belt.shift(); h.fu.belt.push({ id: 'n' + k }); h.update();
    const now = h.entries().map(e => h.x(e)).sort((a, b) => a - b);
    for (let i = 1; i < now.length; i++) assert.ok(now[i] - now[i - 1] >= 44 - 1e-6, '相鄰裝備不得重疊：' + now.join(','));
  }
});

test('帶上放不下的件數由 hiddenCount 回報，供 +N 排隊數加總', () => {
  const h = harness(); h.fu.belt = Array.from({ length: 30 }, (_, i) => ({ id: 'q' + i }));
  h.update();
  const shown = h.entries().length;
  assert.ok(shown < 30);
  assert.equal(h.context.NewForgeVisuals.hiddenCount(1), 30 - shown);
  h.fu.belt = [{ id: 'q0' }]; h.update();
  assert.equal(h.context.NewForgeVisuals.hiddenCount(1), 0);
});

test('離開分頁再切回：帶上原本滿的，回來直接鋪滿目前內容，不清空重走', () => {
  const h = harness(); h.fu.belt = Array.from({ length: 30 }, (_, i) => ({ id: 'a' + i })); h.update(); h.step(3000);
  const full = h.entries().length; assert.ok(full >= 8);
  h.context.UI.tab = 'skills'; h.node.clientWidth = 0; h.update(); h.step(100);
  h.fu.belt = Array.from({ length: 30 }, (_, i) => ({ id: 'b' + i }));
  h.context.UI.tab = 'newforge'; h.node.clientWidth = 352; h.update();
  const now = h.entries();
  assert.equal(now.length, full);
  now.forEach((e, i) => assert.equal(h.x(e), i * 44, '回來即在定位'));
});
