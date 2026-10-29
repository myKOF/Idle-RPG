'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const MODEL_CACHE = 'idle_rpg_gemini_models';
const unknownPrompt = '請替我的測試角色準備足夠金幣';
const flush = async () => { for (let i = 0; i < 160; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const success = (commands = ['gold 123']) => ({ ok: true, json: async () => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify(commands) }] } }]
}) });

function setup({ cache = true, key = true } = {}) {
  let now = 0, timerId = 0;
  const timers = new Map();
  const storage = {};
  if (key) storage.idle_rpg_gemini_api_key = 'fake-test-key';
  if (cache) storage[MODEL_CACHE] = JSON.stringify({ version: 2, savedAt: 0,
    models: ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.6-flash'] });
  const calls = [], sent = [];
  function element(tagName) {
    return { tagName, style: {}, children: [], listeners: {}, value: '',
      appendChild(child) { this.children.push(child); },
      addEventListener(type, handler) { this.listeners[type] = handler; }, focus() {} };
  }
  const document = { readyState: 'complete', body: element('body'), listeners: {},
    createElement: element, getElementById() { return null; },
    addEventListener(type, handler) { this.listeners[type] = handler; } };
  const context = {
    console, document, location: { hostname: 'localhost' }, AbortController,
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    localStorage: { getItem(k) { return storage[k] || null; }, setItem(k, v) { storage[k] = v; }, removeItem(k) { delete storage[k]; } },
    fetch(url, options) { calls.push({ url, options }); return context.respond(url, options); },
    respond() { return new Promise(() => {}); },
    WorkerBridge: { send(name, payload) { sent.push({ name, ...payload }); return Promise.resolve({ ok: true, message: 'OK' }); } }
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ['js/ai-key-setting.js', 'js/gm.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  const panel = document.body.children[0], input = panel.children[0], status = panel.children[1];
  function type(text) { input.value = text; input.listeners.keydown({ key: 'Enter', preventDefault() {}, stopPropagation() {} }); }
  async function advance(ms) {
    const end = now + ms;
    while (true) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].fn(); await flush();
    }
    now = end; await flush();
  }
  return { context, ai: context.AiKeySetting, calls, sent, type, input, status, storage, timers, advance,
    jump(ms) { now += ms; } };
}

test('常用白話無Key直接送Worker，完全不建立雲端請求或計時器', async () => {
  const env = setup({ key: false });
  env.type('請幫我加金幣1000億個，然後幫我全身強化+50');
  await flush();
  assert.deepEqual(env.sent.map((s) => s.line.replace(/ @gm-batch:[\w-]+$/, '')), ['gold 100000000000', 'modequip wear +50']);
  assert.match(env.sent[1].line, / @gm-batch:[\w-]+$/);
  assert.equal(env.calls.length, 0);
  assert.equal(env.timers.size, 0);
});

test('無模型快取時直接呼叫快速首選，不等待模型清單；30秒逾時先取消再重試', async () => {
  const env = setup({ cache: false });
  const pending = deferred();
  env.context.respond = () => pending.promise;
  env.type(unknownPrompt); await flush();
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].options.method, 'POST');
  assert.match(env.calls[0].url, /gemini-3.5-flash-lite/);
  await env.advance(29999);
  assert.equal(env.calls[0].options.signal.aborted, false);
  assert.match(env.status.textContent, /理解/);
  await env.advance(1);
  assert.equal(env.calls[0].options.signal.aborted, true);
  assert.match(env.status.textContent, /已超過30秒無回應，重試中.*重試1\/3/);
  assert.equal(env.calls.length, 2);
  assert.match(env.calls[1].url, /gemini-3.8-flash/);
  const timeoutStatus = env.status.textContent;
  env.ai.cancelNaturalCommand(); await flush();
  pending.resolve(success());
  await flush();
  assert.equal(env.calls.length, 2);
  assert.equal(env.storage[MODEL_CACHE], undefined);
  assert.equal(env.sent.length, 0);
  assert.match(timeoutStatus, /重試1\/3/);
  assert.equal(env.timers.size, 0);
});

test('每次最多30秒，初次加三次重試後停止，fetch忽略取消也不能執行遲到指令', async () => {
  const env = setup();
  const pending = deferred(); env.context.respond = () => pending.promise;
  env.type(unknownPrompt); await flush();
  for (let retry = 1; retry <= 3; retry++) {
    await env.advance(30000);
    assert.equal(env.calls.length, retry + 1);
    assert.equal(env.calls[retry - 1].options.signal.aborted, true);
    assert.equal(env.calls[retry].options.signal.aborted, false);
    assert.match(env.status.textContent, new RegExp('重試' + retry + '/3'));
  }
  await env.advance(30000);
  assert.equal(env.calls[0].options.signal.aborted, true);
  pending.resolve(success()); await flush();
  assert.equal(env.sent.length, 0);
  assert.equal(env.calls.length, 4, '最多初次加三次重試');
  assert.ok(env.calls.every((call) => call.options.signal.aborted));
  assert.equal(env.ai._lastWorkingModel, undefined);
  assert.match(env.status.textContent, /等待上限.*取消.*未執行/);
  assert.equal(env.timers.size, 0);
});

test('headers已到但回應body掛起仍算逾時，遲到body不執行', async () => {
  const env = setup();
  const body = deferred(); env.context.respond = async () => ({ ok: true, json: () => body.promise });
  env.type(unknownPrompt); await flush(); await env.advance(120000);
  body.resolve(await success().json()); await flush();
  assert.equal(env.sent.length, 0);
  assert.equal(env.ai._lastWorkingModel, undefined);
  assert.equal(env.calls[0].options.signal.aborted, true);
});

test('第一次逾時的成功結果晚到時仍被丟棄，只有目前重試可執行一次', async () => {
  const env = setup();
  const first = deferred(), second = deferred();
  env.context.respond = () => env.calls.length === 1 ? first.promise : second.promise;
  env.type(unknownPrompt); await flush(); await env.advance(30000);
  first.resolve(success(['gold 999'])); await flush();
  assert.equal(env.sent.length, 0);
  assert.equal(env.ai._lastWorkingModel, undefined);
  second.resolve(success(['gold 123'])); await flush();
  assert.deepEqual(env.sent.map((s) => s.line), ['gold 123']);
  assert.equal(env.calls.length, 2);
  assert.equal(env.timers.size, 0);
  await env.advance(120000);
  assert.equal(env.sent.length, 1);
});

test('錯誤可立即重試；僅使用兩種快速模型，總計最多四次嘗試', async () => {
  const env = setup();
  env.context.respond = async () => env.calls.length === 1 ? { ok: false, status: 503, json: async () => ({}) } : success();
  env.type(unknownPrompt); await flush();
  assert.equal(env.calls.length, 2);
  assert.deepEqual(env.sent.map((s) => s.line), ['gold 123']);
  assert.equal(env.timers.size, 0);
  await env.advance(20000);
  assert.equal(env.sent.length, 1);

  const failed = setup();
  failed.context.respond = async () => ({ ok: false, status: 503, json: async () => ({}) });
  failed.type(unknownPrompt); await flush();
  assert.equal(failed.calls.length, 4);
  assert.equal(new Set(failed.calls.map((call) => call.url)).size, 2);
  assert.equal(failed.sent.length, 0);
  assert.equal(failed.timers.size, 0);
  assert.match(failed.status.textContent, /未執行/);
});

test('單次timer被節流時仍依實際期限丟棄過期回應並重試', async () => {
  const env = setup();
  const pending = deferred(); env.context.respond = () => pending.promise;
  env.type(unknownPrompt); await flush();
  env.jump(30001); // 模擬背景分頁timer被節流，未觸發計時器。
  env.context.respond = () => new Promise(() => {});
  pending.resolve(success()); await flush();
  assert.equal(env.sent.length, 0);
  assert.equal(env.calls[0].options.signal.aborted, true);
  assert.match(env.status.textContent, /已超過30秒無回應，重試中/);
  assert.equal(env.calls.length, 2);
  env.ai.cancelNaturalCommand(); await flush();
});

test('總timer被節流到超過兩分鐘仍拒絕遲到結果，不再追加重試', async () => {
  const env = setup();
  const pending = deferred(); env.context.respond = () => pending.promise;
  env.type(unknownPrompt); await flush();
  env.jump(120001); pending.resolve(success()); await flush();
  assert.equal(env.sent.length, 0);
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].options.signal.aborted, true);
  assert.equal(env.timers.size, 0);
});

test('新白話／原生指令送出時取消舊解析，遲到結果不能蓋掉新結果', async () => {
  for (const newCommand of ['幫我加金幣50個', 'gold 50']) {
    const env = setup();
    const pending = deferred(); env.context.respond = () => pending.promise;
    env.type(unknownPrompt); await flush();
    env.type(newCommand); await flush();
    assert.equal(env.calls[0].options.signal.aborted, true);
    const status = env.status.textContent;
    pending.resolve(success()); await flush();
    assert.deepEqual(env.sent.map((s) => s.line), ['gold 50']);
    assert.equal(env.status.textContent, status);
    assert.equal(env.timers.size, 0);
  }
});

test('新雲端解析取代舊解析，舊finally不能清掉新請求的取消權', async () => {
  const env = setup();
  const first = deferred(), second = deferred();
  env.context.respond = () => env.calls.length === 1 ? first.promise : second.promise;
  env.type(unknownPrompt); await flush();
  env.type('替我準備另外一套測試資源'); await flush();
  assert.equal(env.calls[0].options.signal.aborted, true);
  assert.equal(env.calls[1].options.signal.aborted, false);
  env.ai.cancelNaturalCommand(); await flush();
  assert.equal(env.calls[1].options.signal.aborted, true);
  first.resolve(success()); second.resolve(success()); await flush();
  assert.equal(env.sent.length, 0);
});

test('Escape關閉指令框取消解析，晚到成功結果不能執行', async () => {
  const env = setup();
  const pending = deferred(); env.context.respond = () => pending.promise;
  env.type(unknownPrompt); await flush();
  env.input.listeners.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  await flush();
  assert.equal(env.calls[0].options.signal.aborted, true);
  pending.resolve(success()); await flush();
  assert.equal(env.sent.length, 0);
  assert.equal(env.timers.size, 0);
});

test('未知複合句等待整句翻譯，逾時不能先執行已認得的子句', async () => {
  const env = setup();
  env.type('幫我加金幣1000億，替我準備一套適合打王的裝備'); await flush();
  assert.equal(env.sent.length, 0);
  assert.equal(env.calls.length, 1);
  await env.advance(120000);
  assert.equal(env.sent.length, 0);
});
