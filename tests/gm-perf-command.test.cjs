'use strict';
/* ============================================================
   gm-perf-command.test.cjs — GM 指令 Performance_Information

   2026-09-30 使用者：效能診斷那幾行只在測試時需要，平常只留 FPS；
   預設隱藏，打 GM 指令才顯示，再打一次就關。

   這條指令只影響主執行緒的畫面，所以在 js/gm.js 處理、不送 Worker
  （Worker 拿不到 DOM）；效果和其他 GM 指令一樣不落地，重新整理後回到隱藏。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function makeElement(tagName) {
  return {
    tagName: tagName.toUpperCase(), id: '', value: '', textContent: '', innerHTML: '', style: {}, children: [],
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, handler) { this.listeners = this.listeners || {}; this.listeners[type] = handler; },
    focus() {}, setAttribute() {}, removeAttribute() {}
  };
}

/* 載入 js/gm.js 的面板（與 gm-command.test.cjs 同一套做法），BattlePerf 用替身。 */
function loadPanel(opts) {
  opts = opts || {};
  const body = makeElement('body');
  const document = {
    body, listeners: {}, readyState: 'complete',
    addEventListener(type, handler) { this.listeners[type] = handler; },
    createElement: makeElement, getElementById() { return null; }
  };
  const sent = [];
  const perf = opts.perf === undefined ? { enabled: true, visible: false, setVisible(v) { this.visible = !!v; return this.visible; } } : opts.perf;
  const context = {
    console, document, location: { hostname: opts.host || 'localhost' }, window: null,
    WorkerBridge: { send(name, args) { sent.push({ name, args }); return Promise.resolve({ ok: true, message: 'Worker 已執行' }); } }
  };
  if (perf) context.BattlePerf = perf;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read('js/gm.js'), context, { filename: 'js/gm.js' });
  const panel = body.children[0];
  const input = panel.children[0];
  const status = panel.children[1];
  const type = (text) => { input.value = text; input.listeners.keydown({ key: 'Enter', preventDefault() {}, stopPropagation() {} }); };
  return { type, status, sent, perf, context };
}

test('GMP-1 第一次輸入＝顯示，再輸入一次＝隱藏；不送 Worker', () => {
  const { type, status, sent, perf } = loadPanel();
  assert.equal(perf.visible, false, '預設隱藏');
  type('Performance_Information');
  assert.equal(perf.visible, true);
  assert.match(status.textContent, /已顯示/);
  assert.equal(status.className, 'gm-status good');
  type('Performance_Information');
  assert.equal(perf.visible, false);
  assert.match(status.textContent, /已隱藏/);
  assert.equal(sent.length, 0, '畫面指令不該送進 Worker');
});

test('GMP-2 指令名稱不分大小寫（與其他 GM 指令一致）', () => {
  for (const name of ['performance_information', 'PERFORMANCE_INFORMATION', 'Performance_Information']) {
    const { type, perf } = loadPanel();
    type(name);
    assert.equal(perf.visible, true, name);
  }
});

test('GMP-3 可以明確指定 on／off，且指定不會被當成切換', () => {
  const { type, perf } = loadPanel();
  type('performance_information on');
  type('performance_information on');
  assert.equal(perf.visible, true, 'on 兩次仍是顯示');
  type('performance_information off');
  type('performance_information 0');
  assert.equal(perf.visible, false, 'off 兩次仍是隱藏');
  type('performance_information 1');
  assert.equal(perf.visible, true);
});

test('GMP-4 亂給參數：回報格式、不改變目前狀態', () => {
  const { type, status, perf } = loadPanel();
  type('performance_information maybe');
  assert.equal(perf.visible, false);
  assert.equal(status.className, 'gm-status bad');
  assert.match(status.textContent, /格式/);
});

test('GMP-5 診斷沒啟用（?perf=0 或非內部版本）：說明原因，不假裝成功', () => {
  const off = loadPanel({ perf: { enabled: false, visible: false, setVisible() { throw new Error('不該被呼叫'); } } });
  off.type('performance_information');
  assert.equal(off.status.className, 'gm-status bad');
  assert.match(off.status.textContent, /未啟用/);
  const missing = loadPanel({ perf: null });
  missing.type('performance_information');
  assert.equal(missing.status.className, 'gm-status bad');
});

test('GMP-6 其他指令照舊送 Worker，不被畫面指令的路徑吃掉', () => {
  const { type, sent, perf } = loadPanel();
  type('god 1');
  type('performance_information_extra');           // 名稱只差一點也不算
  assert.deepEqual(sent.map((m) => m.args.line), ['god 1', 'performance_information_extra']);
  assert.equal(perf.visible, false);
});

test('GMP-7 不在本機環境：面板根本不會建立，runClientCommand 也不會處理', () => {
  const { runClientCommand } = (() => {
    const ctx = { console, location: { hostname: 'game.example.com' }, BattlePerf: { enabled: true, visible: false, setVisible() { throw new Error('不該被呼叫'); } } };
    ctx.window = undefined;
    vm.createContext(ctx);
    const mod = { exports: {} };
    ctx.module = mod;
    vm.runInContext(read('js/gm.js'), ctx, { filename: 'js/gm.js' });
    return mod.exports;
  })();
  assert.equal(runClientCommand('performance_information'), null);
});

/* ================= BattlePerf 本身 ================= */

function loadPerf(extra) {
  const sandbox = Object.assign({
    window: {}, location: { search: '', hostname: 'localhost', protocol: 'http:' },
    isInternalVersion: () => true, performance, console, setInterval, clearInterval,
    Date, Math, Object, Array, String, Number, JSON, Promise
  }, extra || {});
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(read('js/vfx-core.js').replace(/if \(typeof module[\s\S]*$/, '') + '\nthis.VFXCore = VFXCore;', ctx);
  vm.runInContext(read('js/battle-perf.js').replace(/if \(typeof module[\s\S]*$/, '') + '\nthis.BattlePerf = BattlePerf;', ctx);
  return ctx.BattlePerf;
}

test('GMP-8 BattlePerf 預設隱藏：即使啟用也不輸出文字；顯示後才有；切換回傳目前狀態', () => {
  const P = loadPerf();
  assert.equal(P.enabled, true);
  assert.equal(P.visible, false);
  assert.equal(P.lines(), '', '隱藏時 lines() 不能有任何字');
  assert.equal(P.setVisible(true), true);
  assert.equal(P.visible, true);
  assert.notEqual(P.lines(), '', '顯示時至少要有內容（掛勾未就緒時是等待提示）');
  assert.equal(P.toggle(), false);
  assert.equal(P.visible, false);
  assert.equal(P.lines(), '');
});

test('GMP-9 診斷沒啟用時：setVisible／toggle 回 null，visible 永遠是 false', () => {
  const P = loadPerf({ isInternalVersion: () => false });
  assert.equal(P.enabled, false);
  assert.equal(P.setVisible(true), null);
  assert.equal(P.toggle(), null);
  assert.equal(P.visible, false);
  const off = loadPerf({ location: { search: '?perf=0', hostname: 'localhost', protocol: 'http:' } });
  assert.equal(off.toggle(), null);
});

test('GMP-10 隱藏只是不輸出文字：收集照常進行（perfReport 隨時可用）', () => {
  const P = loadPerf();
  const listeners = [];
  P._hook({ ticker: { add: (fn, c, prio) => listeners.push({ fn, prio }) },
    renderer: { gl: { drawElements() {}, getExtension: () => null, getParameter: () => 'GPU', RENDERER: 1 }, width: 1, height: 1, resolution: 1 } });
  listeners.sort((a, b) => b.prio - a.prio).forEach((l) => l.fn());
  assert.equal(P.visible, false);
  assert.ok(P._state().frames.length >= 1, '隱藏時仍在記錄每一幀');
});

test('GMP-11 不落地：battle-perf.js／gm.js 不寫 localStorage（重新整理後回到隱藏）', () => {
  // 只抓「實際使用」，註解裡提到這個詞不算
  const usesStorage = /(?:localStorage|sessionStorage)\s*[.\[]|indexedDB\s*\./;
  assert.ok(!usesStorage.test(read('js/battle-perf.js')));
  assert.ok(!usesStorage.test(read('js/gm.js')));
});

test('GMP-12 接線：ui.js 只有 visible 時才多印那幾行，隱藏時還原單行樣式；gm.js 版號已 bump', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /var perfShown = perfOn && BattlePerf\.visible;/);
  assert.match(ui, /\(perfShown \? '\\n' \+ BattlePerf\.lines\(\) : ''\)/);
  assert.match(ui, /fpsEl\.style\.whiteSpace = perfShown \? 'pre' : '';/);
  assert.match(ui, /fpsEl\.style\.lineHeight = perfShown \? '1\.3' : '';/);
  const html = read('index.html');
  assert.match(html, /<script src="js\/gm\.js\?v=[^"]+"><\/script>/, 'gm.js 沒有版號會吃到快取的舊檔');
});

test('GMP-13 指令有寫進 GM_command.md', () => {
  const doc = read('GM_command.md');
  assert.match(doc, /Performance_Information/);
});
