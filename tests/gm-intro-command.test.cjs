'use strict';
/* ============================================================
   gm-intro-command.test.cjs — GM 指令 intro：直接播放開頭動畫

   只影響主執行緒畫面（js/intro-player.js），在 js/gm.js 處理、不送 Worker。
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

/* 與 gm-perf-command.test.cjs 同一套載入方式；IntroPlayer 用替身，只記錄呼叫。 */
function loadPanel(opts) {
  opts = opts || {};
  const body = makeElement('body');
  const document = {
    body, listeners: {}, readyState: 'complete',
    addEventListener(type, handler) { this.listeners[type] = handler; },
    createElement: makeElement, getElementById() { return null; }
  };
  const sent = [];
  const calls = [];
  const player = {
    playing: false,
    isPlaying() { return this.playing; },
    play(tl, o) { calls.push(['play', o.id, tl]); if (opts.playFails) return false; this.playing = true; return true; },
    abort(reason) { calls.push(['abort', reason]); this.playing = false; }
  };
  const context = {
    console, document, location: { hostname: 'localhost' }, window: null,
    WorkerBridge: { send(name, args) { sent.push({ name, args }); return Promise.resolve({ ok: true, message: 'Worker 已執行' }); } }
  };
  if (!opts.noPlayer) {
    context.IntroPlayer = player;
    context.INTRO_TIMELINES = opts.timelines || { test: { layers: [] }, title: { layers: [] } };
  }
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read('js/gm.js'), context, { filename: 'js/gm.js' });
  const panel = body.children[0];
  const input = panel.children[0];
  const status = panel.children[1];
  const type = (text) => { input.value = text; input.listeners.keydown({ key: 'Enter', preventDefault() {}, stopPropagation() {} }); };
  return { type, status, sent, calls, player, context };
}

test('GMI-1 intro 不帶名稱＝播第一條時間軸，不送 Worker', () => {
  const { type, status, sent, calls, context } = loadPanel();
  type('intro');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'play');
  assert.equal(calls[0][1], 'test');
  assert.equal(calls[0][2], context.INTRO_TIMELINES.test);
  assert.match(status.textContent, /播放開頭動畫「test」/);
  assert.equal(status.className, 'gm-status good');
  assert.equal(sent.length, 0, '畫面指令不該送進 Worker');
});

test('GMI-2 指定名稱、指令名稱不分大小寫', () => {
  const { type, calls } = loadPanel();
  type('INTRO title');
  assert.deepStrictEqual(calls.map((c) => c.slice(0, 2)), [['play', 'title']]);
});

test('GMI-3 list 列出名稱；不存在的名稱回報可用清單且不播放', () => {
  const { type, status, calls } = loadPanel();
  type('intro list');
  assert.match(status.textContent, /test、title/);
  type('intro nope');
  assert.match(status.textContent, /沒有名為「nope」.*test、title/);
  assert.equal(status.className, 'gm-status bad');
  type('intro toString');
  assert.match(status.textContent, /沒有名為「toString」/, '原型鍵不算');
  assert.equal(calls.length, 0);
});

test('GMI-4 播放中再輸入會拒絕；stop 立即停止', () => {
  const { type, status, calls, player } = loadPanel();
  type('intro stop');
  assert.match(status.textContent, /沒有在播放/);
  type('intro');
  type('intro');
  assert.match(status.textContent, /正在播放中/);
  assert.equal(calls.filter((c) => c[0] === 'play').length, 1);
  type('intro stop');
  assert.deepStrictEqual(calls[calls.length - 1], ['abort', 'gm']);
  assert.equal(player.playing, false);
  assert.match(status.textContent, /已停止/);
});

test('GMI-5 播放失敗或播放器沒載入時回報失敗', () => {
  const failed = loadPanel({ playFails: true });
  failed.type('intro');
  assert.match(failed.status.textContent, /播放失敗/);
  assert.equal(failed.status.className, 'gm-status bad');
  const missing = loadPanel({ noPlayer: true });
  missing.type('intro');
  assert.match(missing.status.textContent, /未載入/);
  assert.equal(missing.sent.length, 0, '沒載入也不能轉送 Worker');
});

test('GMI-6 GM_command.md 有登記這條指令', () => {
  const doc = read('GM_command.md');
  assert.match(doc, /## 10\.11 播放開頭動畫/);
  assert.match(doc, /intro stop/);
});
