const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const workerPath = path.join(root, 'js/worker/sim.worker.js');

/* sim.worker.js 整支要 importScripts 才能跑，測試只取出 defaultSalvageHintText 的原始碼，
   丟進帶有 RARITIES 與 G 的沙箱執行——測的仍是正式檔案裡的那一份，不是複製品。 */
function loadHintFn(furnace) {
  const src = fs.readFileSync(workerPath, 'utf8');
  const start = src.indexOf('function defaultSalvageHintText()');
  assert.ok(start >= 0, 'sim.worker.js 找不到 defaultSalvageHintText');
  let depth = 0;
  let i = src.indexOf('{', start);
  const bodyStart = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  const fnSrc = src.slice(start, i + 1);

  const context = { console };
  vm.createContext(context);
  // 稀有度表是真的，名稱若改動測試會跟著改動
  vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), context,
    { filename: 'js/data.js' });
  context.G = { player: { newForge: { furnaces: furnace ? [furnace] : [] } } };
  vm.runInContext(fnSrc, context, { filename: 'defaultSalvageHintText' });
  return context;
}

function qualities(indices) {
  const ctx = loadHintFn(null);
  const flags = new Array(ctx.RARITIES.length).fill(false);
  indices.forEach((r) => { flags[r] = true; });
  return flags;
}

test('新手提示的品質範圍等於 1 號熔爐的實際預設，不是寫死的字串', () => {
  // 用真正的 newForgeDefaultFurnace 產生預設爐，避免文案與預設值各自漂移
  const simCtx = { console, window: {} };
  vm.createContext(simCtx);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js', 'js/player.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), simCtx, { filename: f });
  });
  const defaultFurnace = simCtx.newForgeDefaultFurnace(1);

  const ctx = loadHintFn(defaultFurnace);
  const text = ctx.defaultSalvageHintText();

  // 預設實際勾了哪些，文案就必須只提到哪些
  const checked = [];
  defaultFurnace.qualities.forEach((on, r) => { if (on) checked.push(simCtx.RARITIES[r].name); });
  assert.ok(checked.length > 0, '預設熔爐至少要勾一個品質，否則本測試需改寫');
  checked.forEach((name) => {
    assert.ok(text.includes(name), `文案應提到已勾選的「${name}」，實得：${text}`);
  });
  simCtx.RARITIES.forEach((r, idx) => {
    if (defaultFurnace.qualities[idx]) return;
    assert.ok(!text.includes('「' + r.name + '」') && !text.includes(r.name + '~'),
      `文案不應把未勾選的「${r.name}」講成預設，實得：${text}`);
  });
});

test('連續區間縮寫成 A~B', () => {
  const ctx = loadHintFn({ qualities: qualities([0, 1, 2, 3, 4]) });
  assert.match(ctx.defaultSalvageHintText(), /「普通~史詩」品質會自動拆解/);
});

test('單一品質不加波浪號', () => {
  const ctx = loadHintFn({ qualities: qualities([0]) });
  assert.match(ctx.defaultSalvageHintText(), /「普通」品質會自動拆解/);
});

test('不連續的勾選逐項列出', () => {
  const ctx = loadHintFn({ qualities: qualities([0, 2]) });
  assert.match(ctx.defaultSalvageHintText(), /「普通、稀有」品質會自動拆解/);
});

test('一個都沒勾時改用「全部保留入包」的說法', () => {
  const ctx = loadHintFn({ qualities: qualities([]) });
  const text = ctx.defaultSalvageHintText();
  assert.match(text, /不自動拆解任何品質/);
  // 可以說明「勾了才會拆」，但不得宣稱某個品質是預設會拆的
  assert.ok(!/預設「[^」]+」品質會自動拆解/.test(text),
    '沒勾任何品質時不得宣稱某品質為預設拆解，實得：' + text);
});

test('熔爐資料缺失時不拋錯', () => {
  const ctx = loadHintFn(null);
  assert.equal(typeof ctx.defaultSalvageHintText(), 'string');
});
