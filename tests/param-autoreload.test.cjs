const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js/param_autoreload.js'), 'utf8');

/* params_version.txt 由「套用參數.bat」產生且被 .gitignore 排除，
   沒跑過那支批次檔的工作副本根本沒有這個檔。固定 2 秒輪詢一個不存在的檔案
   會讓 console 每 2 秒被記一筆 404，真正的錯誤訊息就淹在裡面了。 */
function load(opts) {
  opts = opts || {};
  const state = { intervals: [], reloads: 0, info: [], fetches: 0 };
  const context = {
    console: { info: (m) => state.info.push(m), log() {}, warn() {}, error() {} },
    Promise, Date, JSON,
    location: { hostname: opts.hostname || 'localhost', reload: () => state.reloads++ },
    document: { hidden: !!opts.hidden },
    setInterval: (fn, ms) => { state.intervals.push(ms); state.poll = fn; return state.intervals.length; },
    clearInterval() {},
    fetch: () => {
      state.fetches++;
      const res = opts.responses.shift();
      if (res === undefined) return Promise.reject(new Error('沒有預備的回應'));
      if (res === null) return Promise.resolve({ ok: false, text: () => Promise.resolve('') });
      return Promise.resolve({ ok: true, text: () => Promise.resolve(res) });
    }
  };
  vm.createContext(context);
  vm.runInContext(src, context, { filename: 'js/param_autoreload.js' });
  return state;
}

const flush = () => new Promise((r) => setImmediate(r));

test('檔案存在時維持 2 秒快速輪詢', async () => {
  const s = load({ responses: ['111', '111'] });
  await flush();
  assert.deepEqual(s.intervals, [2000]);
});

test('檔案不存在時退避成 30 秒，且只提示一次', async () => {
  const s = load({ responses: [null, null, null] });
  await flush();
  assert.deepEqual(s.intervals, [2000, 30000], '首次 404 後應改為慢速探測');
  assert.equal(s.info.length, 1);
  assert.match(s.info[0], /params_version\.txt/);

  s.poll(); await flush();
  s.poll(); await flush();
  assert.deepEqual(s.intervals, [2000, 30000], '持續 404 不應反覆重設計時器');
  assert.equal(s.info.length, 1, '提示不得每次都噴');
});

test('檔案後來出現時自動恢復即時偵測', async () => {
  const s = load({ responses: [null, '111', '222'] });
  await flush();
  assert.deepEqual(s.intervals, [2000, 30000]);

  s.poll(); await flush();
  assert.deepEqual(s.intervals, [2000, 30000, 2000], '檔案出現後應回到 2 秒');

  s.poll(); await flush();
  assert.equal(s.reloads, 1, '內容變動應觸發重載');
});

test('首次讀到內容只記錄不重載', async () => {
  const s = load({ responses: ['111'] });
  await flush();
  assert.equal(s.reloads, 0);
});

test('非本機主機完全不啟用', async () => {
  const s = load({ hostname: 'example.com', responses: [] });
  await flush();
  assert.deepEqual(s.intervals, []);
  assert.equal(s.fetches, 0);
});

test('背景分頁不發出請求', async () => {
  const s = load({ hidden: true, responses: ['111'] });
  await flush();
  assert.equal(s.fetches, 0);
});
