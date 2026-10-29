'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const CACHE = 'idle_rpg_gm_translations', MODELS = 'idle_rpg_gemini_models';
const prompt = '把主手物理攻擊調成50000';
const flush = async () => { for (let i = 0; i < 160; i++) await Promise.resolve(); };
const success = (commands = ['modequip weapon atkFlat 50000']) => ({ ok: true, json: async () => ({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(commands) }] } }]
}) });

function setup(storage = {}, host = 'localhost') {
  let now = 100000;
  storage.idle_rpg_gemini_api_key = storage.idle_rpg_gemini_api_key || 'fake-test-key';
  const sent = [], calls = [];
  function element(tagName) {
    return { tagName, children: [], listeners: {}, style: {}, value: '',
      appendChild(child) { this.children.push(child); },
      addEventListener(type, handler) { this.listeners[type] = handler; }, focus() {} };
  }
  const document = { readyState: 'complete', body: element('body'), listeners: {},
    createElement: element, getElementById() { return null; },
    addEventListener(type, handler) { this.listeners[type] = handler; } };
  const ctx = { console, document, location: { hostname: host }, AbortController, setTimeout, clearTimeout,
    Date: class extends Date { static now() { return now; } },
    localStorage: { getItem(k) { return storage[k] || null; }, setItem(k, v) { storage[k] = v; }, removeItem(k) { delete storage[k]; } },
    fetch(url, options) { calls.push({ url, options }); return ctx.respond(url, options); },
    respond: async () => success(),
    worker: async () => ({ ok: true, message: 'OK' }),
    WorkerBridge: { send(name, payload) { sent.push({ name, ...payload }); return ctx.worker(name, payload); } },
    UI: { sel: null, dirty: {} }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const file of ['js/ai-key-setting.js', 'js/gm.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  }
  const panel = document.body.children[0];
  const input = panel && panel.children[0], status = panel && panel.children[1];
  function type(text) { input.value = text; input.listeners.keydown({ key: 'Enter', preventDefault() {}, stopPropagation() {} }); }
  return { ctx, ai: ctx.AiKeySetting, sent, calls, storage, type, input, status,
    buttons: panel ? panel.children[2].children : [], jump(ms) { now += ms; } };
}

test('預設固定首選及單一備援，無模型清單查詢，依各模型能力使用最低思考', async () => {
  const env = setup();
  env.ctx.respond = async () => env.calls.length === 1 ? { ok: false, status: 503, json: async () => ({}) } : success();
  const progress = [];
  await env.ai.parseNaturalCommand(prompt, undefined, (event) => progress.push(event));
  assert.deepEqual(env.calls.map((c) => c.url.match(/models\/([^:]+)/)[1]), ['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
  assert.ok(env.calls.every((c) => c.options.method === 'POST'));
  assert.deepEqual(JSON.parse(env.calls[0].options.body).generationConfig.thinkingConfig, { thinkingLevel: 'minimal', includeThoughts: false });
  assert.deepEqual(JSON.parse(env.calls[1].options.body).generationConfig.thinkingConfig, { thinkingLevel: 'low', includeThoughts: false });
  assert.equal(progress[1].retry, 1);
  assert.equal(progress[1].reason, 'error');
  // 備援成功也不會偷偷成為下一次首選。
  await env.ai.parseNaturalCommand('把頭盔生命調成50000');
  assert.match(env.calls[2].url, /gemini-3.5-flash-lite/);
});

test('測試金鑰只選已知快速文字模型，剔除舊版、Pro、音訊、圖片及未知模型', async () => {
  const env = setup();
  env.ctx.respond = async () => ({ ok: true, json: async () => ({ models: [
    'gemini-2.0-flash', 'gemini-3.1-pro-preview', 'gemini-3.8-flash-tts', 'gemini-2.5-flash-image',
    'unknown-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'
  ].map((name) => ({ name: 'models/' + name, supportedGenerationMethods: ['generateContent'] })) }) });
  const result = await env.ai.testApiKey();
  assert.equal(result.modelsCount, 2);
  assert.equal(result.topModel, 'gemini-3.5-flash-lite');
  assert.deepEqual(JSON.parse(env.storage[MODELS]).models, ['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
  env.ctx.respond = async () => success();
  await env.ai.parseNaturalCommand(prompt);
  assert.equal(env.calls[1].options.method, 'POST');
});

test('舊帳號有2.5模型時關閉thinking budget，模型快取到期回到目前預設', async () => {
  const env = setup();
  env.storage[MODELS] = JSON.stringify({ version: 2, savedAt: 100000, models: ['gemini-2.5-flash'] });
  await env.ai.parseNaturalCommand(prompt);
  assert.match(env.calls[0].url, /gemini-2.5-flash:/);
  assert.deepEqual(JSON.parse(env.calls[0].options.body).generationConfig.thinkingConfig, { thinkingBudget: 0, includeThoughts: false });
  env.jump(86400000);
  await env.ai.parseNaturalCommand(prompt);
  assert.match(env.calls[1].url, /gemini-3.5-flash-lite/);
});

test('只有翻譯成功不保存；整批Worker成功才快取，相同句每次仍正常執行', async () => {
  const env = setup();
  await env.ai.parseNaturalCommand(prompt);
  assert.equal(env.ai.getCachedNaturalCommand(prompt), null);
  env.calls.length = 0;
  env.type(prompt); await flush();
  assert.equal(env.calls.length, 1);
  assert.equal(env.sent.length, 1);
  assert.ok(env.storage[CACHE]);
  env.type(prompt); await flush();
  assert.equal(env.calls.length, 1);
  assert.equal(env.sent.length, 2);
  assert.match(env.status.textContent, /快取/);
  assert.equal(env.storage[CACHE].includes('fake-test-key'), false);
});

test('翻譯快取跨重新載入有效，傳回副本避免污染，不保存選取裝備ID', async () => {
  const first = setup();
  first.ctx.respond = async () => success(['modequip sel atkFlat 50000']);
  first.ctx.UI.sel = { source: 'inv', id: 111 };
  first.type(prompt); await flush();
  assert.match(first.sent[0].line, /@sel:inv:111/);
  assert.equal(first.storage[CACHE].includes('@sel:'), false);
  const second = setup(first.storage);
  second.ctx.UI.sel = { source: 'inv', id: 222 };
  const commands = second.ai.getCachedNaturalCommand(prompt);
  commands[0] = 'gold 999';
  second.type(prompt); await flush();
  assert.equal(second.calls.length, 0);
  assert.equal(second.sent[0].line.replace(/ @gm-batch:[\w-]+$/, ''), 'modequip sel atkFlat 50000 @sel:inv:222');
  assert.match(second.sent[0].line, / @gm-batch:[\w-]+$/);
  assert.equal(first.storage[CACHE].includes('@gm-batch:'), false);
});

test('部分Worker失敗、Promise拒絕、無效JSON與截斷回應都不快取', async () => {
  for (const reject of [false, true]) {
    const env = setup();
    env.ctx.respond = async () => success(['gold 10', 'scrap 20']);
    env.ctx.worker = async () => {
      if (env.sent.length === 2) {
        if (reject) throw new Error('Worker error');
        return { ok: false, message: 'no item' };
      }
      return { ok: true, message: 'OK' };
    };
    env.type(prompt); await flush();
    assert.equal(env.sent.length, 2);
    assert.equal(env.ai.getCachedNaturalCommand(prompt), null);
  }
  for (const data of [
    { candidates: [{ content: { parts: [{ text: '{broken' }] } }] },
    { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '["gold 10"]' }] } }] },
    { candidates: [{ content: { parts: [{ text: '[{"command":"gold 10"}]' }] } }] }
  ]) {
    const env = setup(); env.ctx.respond = async () => ({ ok: true, json: async () => data });
    env.type(prompt); await flush();
    assert.equal(env.calls.length, 4);
    assert.equal(env.sent.length, 0);
    assert.equal(env.ai.getCachedNaturalCommand(prompt), null);
  }
});

test('快取命中後執行失敗會移除，下次重新翻譯', async () => {
  const env = setup(); env.type(prompt); await flush();
  env.ctx.worker = async () => ({ ok: false, message: 'missing item' });
  env.type(prompt); await flush();
  assert.equal(env.calls.length, 1);
  assert.equal(env.ai.getCachedNaturalCommand(prompt), null);
  env.type(prompt); await flush();
  assert.equal(env.calls.length, 2);
});

test('完整句比對、不跨數量、語意版本與寶石資料簽章；七天到期及最多32筆', () => {
  const env = setup();
  env.ai.rememberNaturalCommand(prompt, ['gold 10']);
  assert.equal(env.ai.getCachedNaturalCommand(prompt + '但不要改武器'), null);
  env.ctx.GEM_TYPES = { ruby: { enabled: true, name: '紅寶石' } };
  assert.equal(env.ai.getCachedNaturalCommand(prompt), null);
  env.ai.rememberNaturalCommand(prompt, ['gold 10']);
  env.jump(7 * 86400000);
  assert.equal(env.ai.getCachedNaturalCommand(prompt), null);
  for (let i = 0; i < 33; i++) env.ai.rememberNaturalCommand('把主手物攻調成' + i, ['modequip weapon atkFlat ' + i]);
  assert.equal(JSON.parse(env.storage[CACHE]).entries.length, 32);
  assert.equal(env.ai.getCachedNaturalCommand('把主手物攻調成0'), null);
  assert.ok(env.ai.getCachedNaturalCommand('把主手物攻調成32'));
  const data = JSON.parse(env.storage[CACHE]); data.version = 0; env.storage[CACHE] = JSON.stringify(data);
  assert.equal(env.ai.getCachedNaturalCommand('把主手物攻調成32'), null);
});

test('不保存狀態依賴語句、空結果、非指令、非法清單或已綁定的選取ID', () => {
  const env = setup();
  for (const text of ['把目前的等級升一級', '照剛才的裝備給我一套', '給我適合的裝備', '再幫我改裝備']) {
    env.ai.rememberNaturalCommand(text, ['level 500']);
    assert.equal(env.ai.getCachedNaturalCommand(text), null);
  }
  for (const list of [[], [{}], ['eval anything'], ['gold 1\nscrap 2'], ['modequip sel atkFlat 3 @sel:inv:123'], ['modequip sel atkFlat 3 @gm-batch:old']]) {
    env.ai.rememberNaturalCommand(prompt, list);
    assert.equal(env.ai.getCachedNaturalCommand(prompt), null);
  }
});

test('清除快取與更換金鑰均生效；儲存被封鎖時只用當頁記憶體', () => {
  const env = setup(); env.ai.rememberNaturalCommand(prompt, ['gold 1']);
  env.ai.setApiKey('replacement-key');
  assert.equal(env.ai.getCachedNaturalCommand(prompt), null);
  env.ai.rememberNaturalCommand(prompt, ['gold 1']);
  env.ai.clearNaturalCommandCache();
  assert.equal(env.storage[CACHE], undefined);
  env.ctx.localStorage.setItem = () => { throw new Error('quota'); };
  env.ai.rememberNaturalCommand(prompt, ['gold 1']);
  assert.deepEqual(Array.from(env.ai.getCachedNaturalCommand(prompt)), ['gold 1']);
  env.ai.clearNaturalCommandCache();
  assert.equal(env.ai.getCachedNaturalCommand(prompt), null);
});

test('常用預設只填入可本機解析的內容，按Enter才執行；清除按鈕不送Worker', async () => {
  const env = setup();
  assert.equal(env.buttons.length, 5);
  for (const button of env.buttons.slice(0, 4)) {
    const before = env.sent.length;
    button.listeners.click();
    assert.equal(env.sent.length, before);
    const expected = Array.from(env.ai.parseFastPath(env.input.value));
    env.type(env.input.value); await flush();
    assert.deepEqual(env.sent.slice(before).map((s) => s.line), expected);
  }
  assert.equal(env.calls.length, 0);
  env.ai.rememberNaturalCommand(prompt, ['gold 1']);
  const before = env.sent.length;
  env.buttons[4].listeners.click();
  assert.equal(env.sent.length, before);
  assert.equal(env.ai.getCachedNaturalCommand(prompt), null);
});

test('非內部環境不能讀取／寫入快取、取得預設或建立GM工具列', () => {
  const env = setup({}, 'game.example.com');
  env.ai.rememberNaturalCommand(prompt, ['gold 1']);
  assert.equal(env.ai.getCachedNaturalCommand(prompt), null);
  assert.equal(env.storage[CACHE], undefined);
  assert.equal(env.ai.getNaturalPresets().length, 0);
  assert.equal(env.buttons.length, 0);
});

test('AI輸出或快取不能自行授權突破；只有原句明確授權才送出旗標', async () => {
  for (const allowed of [false, true]) {
    const env = setup();
    env.ctx.respond = async () => success(['modequip weapon atkFlat 50000 --allow-overcap']);
    const text = allowed ? '允許突破詞條上限，' + prompt : prompt;
    env.type(text); await flush();
    assert.equal(env.sent.length, 1);
    assert.equal(env.sent[0].line.includes('--allow-overcap'), allowed);
    assert.equal(env.ai.getCachedNaturalCommand(text)[0].includes('--allow-overcap'), allowed);
  }
});

test('同句子指令共用批次；重複輸入使用新批次，快取不保存批次標記', async () => {
  const env = setup();
  env.ctx.respond = async () => success(['modequip weapon lifesteal 100', 'modequip weapon manaSteal 100']);
  env.type(prompt); await flush(); env.type(prompt); await flush();
  assert.equal(env.sent.length, 4);
  const batches = env.sent.map(s => s.line.match(/@gm-batch:([\w-]+)/)[1]);
  assert.equal(batches[0], batches[1]);
  assert.equal(batches[2], batches[3]);
  assert.notEqual(batches[0], batches[2]);
  assert.equal(env.storage[CACHE].includes('@gm-batch:'), false);
  assert.equal(env.calls.length, 1);
});

test('詞條規則升版後，舊版追加語意的翻譯快取失效', () => {
  const env = setup();
  env.ai.rememberNaturalCommand(prompt, ['modequip weapon lifesteal 100']);
  const data = JSON.parse(env.storage[CACHE]);
  assert.equal(data.version, 2);
  data.version = 1;
  env.storage[CACHE] = JSON.stringify(data);
  assert.equal(env.ai.getCachedNaturalCommand(prompt), null);
});
