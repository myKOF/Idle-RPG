'use strict';
/* String 表讀取機制（AI_RULES 8.10）：
   STR 取字／代入參數／語言退路、資料檔與 String.csv 同步、產生器檢查、HTML data-str 與程式 STR(編號) 的編號都存在。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const { build, csvParse } = require(path.join(root, 'tools/string-table/apply_strings.cjs'));

function loadStrings(data, search) {
  const ctx = { console: { warn() {} }, location: { search: search || '' } };
  vm.createContext(ctx);
  vm.runInContext("var STRING_DATA = " + JSON.stringify(data) + ";", ctx);
  vm.runInContext(read('js/strings.js'), ctx, { filename: 'js/strings.js' });
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);

test('STR：直接取字、位置參數、具名參數', () => {
  const ctx = loadStrings({ 1: ['你好'], 2: ['{0} / {1} 件'], 3: ['「{name}」+{pct}%'], 4: ['{0}{0}'] });
  assert.equal(run(ctx, 'STR(1)'), '你好');
  assert.equal(run(ctx, 'STR(2, 3, 9)'), '3 / 9 件');
  assert.equal(run(ctx, 'STR(2, [4, 5])'), '4 / 5 件');
  assert.equal(run(ctx, "STR(3, { name: '劍', pct: 12 })"), '「劍」+12%');
  assert.equal(run(ctx, 'STR(4, 7)'), '77');
});

test('STR：缺參數保留原樣、null 變空字串、0 要顯示', () => {
  const ctx = loadStrings({ 1: ['{0}-{1}'] });
  assert.equal(run(ctx, 'STR(1, 5)'), '5-{1}');
  assert.equal(run(ctx, 'STR(1, null, 0)'), '-0');
});

test('STR：找不到編號回傳 [#編號]，不丟例外', () => {
  const ctx = loadStrings({ 1: ['x'] });
  assert.equal(run(ctx, 'STR(999)'), '[#999]');
  assert.equal(run(ctx, 'Strings.has(1)'), true);
  assert.equal(run(ctx, 'Strings.has(999)'), false);
});

test('語言：簡體／英文空白時退回繁體，有填就用', () => {
  const data = { 1: ['繁體', '简体', 'English'], 2: ['只有繁體'], 3: ['繁', '', 'EN only'] };
  const cn = loadStrings(data, '?lang=zh-CN');
  assert.equal(run(cn, 'Strings.getLang()'), 'zh-CN');
  assert.equal(run(cn, 'STR(1)'), '简体');
  assert.equal(run(cn, 'STR(2)'), '只有繁體');
  assert.equal(run(cn, 'STR(3)'), '繁');
  const en = loadStrings(data, '?foo=1&lang=en');
  assert.equal(run(en, 'STR(1)'), 'English');
  assert.equal(run(en, 'STR(3)'), 'EN only');
  assert.equal(run(loadStrings(data, '?lang=xx'), 'Strings.getLang()'), 'zh-TW');
});

test('資料檔：與 String.csv 同步（改了 Excel／CSV 要重跑 apply_strings.cjs）', () => {
  const r = build();
  assert.ok(!r.errors, (r.errors || []).join('\n'));
  assert.equal(read('js/strings_data.js').replace(/\r\n/g, '\n'), r.js, 'js/strings_data.js 過期：node tools/string-table/apply_strings.cjs');
  const m = /js\/strings_data\.js\?v=([^"']+)/.exec(read('index.html'));
  assert.ok(m, 'index.html 沒有載入 strings_data.js');
  assert.equal(m[1], r.hash, 'index.html 的 strings_data.js ?v= 沒同步');
});

test('資料檔：\\n 還原成真換行，且每列至少有繁體中文', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(read('js/strings_data.js'), ctx);
  const rows = Object.values(vm.runInContext('STRING_DATA', ctx));
  assert.ok(rows.length > 1000);
  assert.ok(rows.every(r => r[0]), '有空的繁體中文');
  assert.ok(!rows.some(r => r.some(v => v.includes('\\n'))), '還有沒還原的 \\n');
});

test('產生器：重複編號、空繁中、替代字符不一致都會被擋', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strtbl-'));
  const csv = path.join(dir, 'String.csv');
  const run1 = (body) => {
    fs.writeFileSync(csv, '﻿編號,功能模塊,用途說明,替代字符參數說明,繁體中文,簡體中文,英文\r\n' + body);
    try {
      execFileSync(process.execPath, [path.join(root, 'tools/string-table/apply_strings.cjs')],
        { env: { ...process.env, STRING_CSV: csv, STRING_JS_OUT: path.join(dir, 'out.js'), STRING_INDEX_HTML: path.join(dir, 'none.html') }, stdio: 'pipe' });
      return '';
    } catch (e) { return String(e.stderr); }
  };
  assert.equal(run1('1,通用,,,甲,,\r\n2,通用,,,乙 {0},,{0} B\r\n'), '');
  assert.match(run1('1,通用,,,甲,,\r\n1,通用,,,乙,,\r\n'), /重複/);
  assert.match(run1('1,通用,,,,,\r\n'), /繁體中文是空的/);
  assert.match(run1('1,通用,,,值 {0},,value\r\n'), /替代字符/);
  assert.match(run1('1,通用,,,值,,value {0}\r\n'), /替代字符/);
  assert.match(run1('x,通用,,,值,,\r\n'), /正整數/);
  assert.ok(!fs.existsSync(path.join(dir, 'out.js')) || fs.readFileSync(path.join(dir, 'out.js'), 'utf8').includes('"2"'), '出錯時不應覆寫資料檔');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('程式與 HTML 引用的 STR(編號)／data-str 編號都存在於資料檔', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(read('js/strings_data.js'), ctx);
  const data = vm.runInContext('STRING_DATA', ctx);
  const missing = [];
  const files = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js') && f !== 'strings_data.js' && f !== 'strings.js').map(f => 'js/' + f);
  files.push('js/worker/sim.worker.js', 'index.html');
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/\bSTR\(\s*(\d+)/g)) if (!data[m[1]]) missing.push(`${f} STR(${m[1]})`);
    for (const m of src.matchAll(/data-str(?:-html)?="(\d+)"/g)) if (!data[m[1]]) missing.push(`${f} data-str=${m[1]}`);
    for (const m of src.matchAll(/data-str-attr="([^"]+)"/g)) for (const p of m[1].split(';')) {
      const id = p.slice(p.lastIndexOf(':') + 1).trim();
      if (id && !data[id]) missing.push(`${f} data-str-attr=${id}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('Worker 與主執行緒都載入 strings 檔，且 Worker 的版本由 bridge 以 sv= 傳入', () => {
  const html = read('index.html');
  const iData = html.indexOf('js/strings_data.js'), iApi = html.indexOf('js/strings.js'), iUi = html.indexOf('js/ui.js');
  assert.ok(iData > 0 && iApi > iData && iUi > iApi, 'index.html 載入順序應為 strings_data → strings → ui');
  const worker = read('js/worker/sim.worker.js');
  assert.match(worker, /strings_data\.js\?v='\s*\+\s*_stringDataVersion/);
  assert.match(worker, /\.\.\/strings\.js/);
  assert.match(read('js/bridge.js'), /qs\.push\('sv=' \+ STRING_DATA_VERSION\)/);
});

test('任務模塊已改為由表讀取（試點）：tasks.js 與 ui.js 的任務文字不再寫死', () => {
  const tasks = read('js/tasks.js');
  for (const s of ['任務表未載入', '所有任務已完成', '任務尚未完成', '新任務：', '恭喜！所有任務皆已完成', '任務獎勵入包']) {
    assert.ok(!new RegExp("'[^'\\n]*" + s).test(tasks), 'tasks.js 還有寫死的：' + s);
  }
  const ui = read('js/ui.js');
  assert.ok(!/'[^'\n]*任務已全部完成/.test(ui) && !/'領取任務獎勵'/.test(ui));
  assert.ok(/data-str="1912"/.test(read('index.html')));
});

test('applyDom：data-str／data-str-html／data-str-attr 會被替換，載入時自動套用一次', () => {
  const mk = (attrs) => ({
    attrs: { ...attrs }, textContent: '', innerHTML: '',
    getAttribute(n) { return this.attrs[n] === undefined ? null : this.attrs[n]; },
    setAttribute(n, v) { this.attrs[n] = v; }
  });
  const a = mk({ 'data-str': '1' }), b = mk({ 'data-str-html': '2' }), c = mk({ 'data-str-attr': 'title:1;data-tt-desc:3' });
  const doc = { body: {}, querySelectorAll(sel) { return sel === '[data-str]' ? [a] : sel === '[data-str-html]' ? [b] : [c]; } };
  const ctx = { console: { warn() {} }, location: { search: '' }, document: doc };
  vm.createContext(ctx);
  vm.runInContext('var STRING_DATA = ' + JSON.stringify({ 1: ['標題'], 2: ['<b>粗體</b>'], 3: ['說明：值'] }) + ';', ctx);
  vm.runInContext(read('js/strings.js'), ctx);
  assert.equal(a.textContent, '標題');
  assert.equal(b.innerHTML, '<b>粗體</b>');
  assert.equal(c.attrs.title, '標題');
  assert.equal(c.attrs['data-tt-desc'], '說明：值');
});

test('漏登記檢查：程式裡寫死的顯示文字都已登記在 String 表（AI_RULES 8.10）', () => {
  let out = '';
  try {
    out = execFileSync(process.execPath, [path.join(root, 'tools/string-table/build_string_csv.cjs'), '--check'], { stdio: 'pipe' }).toString();
  } catch (e) {
    assert.fail('有寫死又沒登記的字串：\n' + String(e.stderr || e.stdout));
  }
  assert.match(out, /未登記 0/);
});

test('每支用到 STR() 的 js 檔開頭都有安全網（單檔載入時不會丟 ReferenceError）', () => {
  const { jsFiles, MARK } = require(path.join(root, 'tools/string-table/guard.cjs'));
  const missing = jsFiles().filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
    return /\bSTR\(/.test(src) && !src.includes(MARK);
  }).map((f) => path.relative(root, f));
  assert.deepEqual(missing, [], '缺安全網（node tools/string-table/guard.cjs 可自動補）');
});
