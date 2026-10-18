const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');

function element() {
  const classes = new Set();
  return { innerHTML: '', textContent: '', value: '', options: [], style: {}, handlers: {},
    addEventListener(name, fn) { this.handlers[name] = fn; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), toggle(c, on) { on ? classes.add(c) : classes.delete(c); }, contains: c => classes.has(c) }
  };
}
function load(ui = false) {
  const nodes = new Map(), get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const c = { console, setTimeout() {}, clearTimeout() {}, confirm() { return true; }, bossFightBlocksCommand() { return false; },
    document: { getElementById: get, querySelectorAll: () => [], addEventListener() {}, body: element(), createElement: element },
    location: { reload() {} }, UI: { dirty: {} }
  };
  c.window = c;
  vm.createContext(c);
  const files = ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/item.js'];
  if (ui) files.push('js/ui.js', 'js/ui-gem-workshop.js');
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
  c.G = { player: { gold: 0, gems: {} } };
  return { c, get };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('2～10級無損拆回前一階，配方與合成互逆，無金幣成本', () => {
  const { c } = load();
  const yields = [3, 3, 3, 3, 4, 4, 4, 4, 6];
  for (let lv = 2; lv <= 10; lv++) {
    c.G.player.gems = { ruby: { [lv]: 1 } };
    const r = c.dismantleGem('ruby', lv);
    assert.equal(r.n, yields[lv - 2]);
    assert.equal(r.level, lv - 1);
    assert.equal(c.gemCount('ruby', lv), 0);
    assert.equal(c.gemCount('ruby', lv - 1), yields[lv - 2]);
    assert.equal(c.G.player.gold, 0);
    assert.equal(c.gemL1Worth(lv - 1) * r.n, c.gemL1Worth(lv));
    c.G.player.gold = c.FUSE_GOLD_COST[lv - 1];
    assert.equal(c.composeGems('ruby', lv - 1), null);
    assert.equal(c.gemCount('ruby', lv), 1);
    assert.equal(c.gemCount('ruby', lv - 1), 0);
    assert.equal(c.G.player.gold, 0);
  }
  for (const lv of [0, 1, 11, 2.5, '2']) assert.equal(c.gemDismantleYield(lv), 0);
});

test('九宮格混種類／相鄰階級只拆所選初始原料一次，不把產出連拆', () => {
  const { c } = load();
  c.G.player.gems = { ruby: { 10: 1, 9: 2 }, sapphire: { 3: 4 } };
  c.G.player.gold = 123;
  const slots = [{ type: 'ruby', lv: 10, n: 1 }, { type: 'ruby', lv: 9, n: 2 }, { type: 'sapphire', lv: 3, n: 4 }];
  const before = JSON.stringify(slots), expected = plain(c.gemDismantlePlan(slots));
  assert.deepEqual(plain(c.dismantleGems(slots)), expected);
  assert.equal(JSON.stringify(slots), before);
  assert.equal(c.gemCount('ruby', 10), 0);
  assert.equal(c.gemCount('ruby', 9), 6);
  assert.equal(c.gemCount('ruby', 8), 8);
  assert.equal(c.gemCount('sapphire', 2), 12);
  assert.equal(c.gemCount('sapphire', 1), 0);
  assert.equal(c.G.player.gold, 123);
});

test('全部槽驗初始庫存、重複槽合計；無效／關閉／超額皆原子拒絕', () => {
  const { c } = load();
  c.G.player.gems = { ruby: { 10: 1, 2: 3 }, turquoise: { 2: 4 } };
  const invalid = [[], null, [null], [{ type: 'ruby', lv: 10, n: 1 }, { type: 'ruby', lv: 9, n: 1 }],
    [{ type: 'ruby', lv: 2, n: 2 }, { type: 'ruby', lv: 2, n: 2 }],
    [{ type: 'ruby', lv: 1, n: 1 }], [{ type: 'turquoise', lv: 2, n: 2 }], [{ type: '__proto__', lv: 2, n: 2 }],
    ...[0, -1, 1.5, '2', 1001, NaN].map(n => [{ type: 'ruby', lv: 2, n }]),
    ...[0, 11, 2.5, '2'].map(lv => [{ type: 'ruby', lv, n: 1 }]),
    Array(10).fill({ type: 'ruby', lv: 2, n: 1 })];
  for (const slots of invalid) {
    const before = JSON.stringify(c.G);
    assert.equal(typeof c.dismantleGems(slots).err, 'string');
    assert.equal(JSON.stringify(c.G), before);
  }
  c.G.player.gems.ruby[2] = 1000;
  assert.equal(c.dismantleGems([{ type: 'ruby', lv: 2, n: 1000 }]).count, 1000);
  assert.equal(c.gemCount('ruby', 1), 3000);
});

function uiFixture() {
  const { c, get } = load(true);
  const snapshot = { gems: { ruby: { 1: 5, 2: 2000, 9: 6, 10: 5 }, sapphire: { 3: 2 } }, fusedGems: [] };
  c.panelData = () => snapshot;
  c.blog = () => {};
  c.renderGems = () => { c.renderFuseInfo(snapshot); c.renderGemConvert(snapshot); c.renderGemDismantleWorkshop(snapshot); };
  c.UI.gemBrowse.sel = 'ruby';
  c.UI.gemBrowse.fuseLv = 9;
  const timers = [];
  c.setTimeout = (fn, ms) => timers.push({ fn, ms });
  c.clearTimeout = id => { timers[id - 1].cancelled = true; };
  return { c, get, snapshot, timers };
}

test('拆解來源禁用一級、支援Shift單顆與千顆堆疊，預覽前一階圖示及數量', () => {
  const { c, get } = uiFixture();
  c.UI.gemBrowse.tool = 'dismantle';
  assert.equal(c.stageGemDismantle('ruby', 1, false), false);
  assert.equal(c.stageGemDismantle('ruby', 10, true), true);
  assert.equal(c.UI.gemDismantleSlots[0].n, 1);
  assert.match(get('gdis-output').innerHTML, /九級紅寶石/);
  assert.match(get('gdis-output').innerHTML, /×6/);
  assert.equal(c.stageGemDismantle('ruby', 10, false), true);
  assert.equal(c.UI.gemDismantleSlots[0].n, 5);
  assert.match(get('gdis-output').innerHTML, /×30/);
  assert.equal(c.stageGemDismantle('ruby', 2, false), true);
  assert.equal(c.UI.gemDismantleSlots[1].n, 1000);
  assert.match(get('gdis-output').innerHTML, /×3000/);
  const html = c.gemFocusHTML({ gems: { ruby: { 1: 5, 2: 2000 } } }, 'ruby', 2005);
  assert.match(html.match(/<button[^>]*data-gem-lv="1"[^>]*>/)[0], /disabled/);
  assert.match(html, /data-gdis-gem="ruby:2"/);
});

for (const all of [false, true]) test(`合成${all ? '全部' : '單次'}按下即播，同一次配方保留至2秒及確認成功`, async () => {
  const { c, get, snapshot, timers } = uiFixture();
  c.UI.gemBrowse.tool = 'compose';
  c.renderGems();
  const recipe = get('fuse-recipe').innerHTML;
  let calls = 0, confirm, resolve;
  c.sendGemUiCommand = (cmd, args, ref, panels, done) => {
    calls++; assert.equal(cmd, all ? 'gem.composeAll' : 'gem.compose');
    assert.deepEqual(plain(args), { type: 'ruby', level: 9 });
    confirm = done; return new Promise(r => { resolve = r; });
  };
  const pending = c.runGemCompose(all);
  assert.equal(get('fuse-recipe').classList.contains('is-converting'), true);
  assert.equal(get('fuse-btn').disabled, true);
  assert.equal(get('fuse-all-btn').disabled, true);
  assert.equal(get('gem-focus').inert, true);
  assert.equal(get('fuse-status').textContent, '');
  await c.runGemCompose(!all); assert.equal(calls, 1);
  snapshot.gems.ruby[9] = 0;
  c.renderGems(); assert.equal(get('fuse-recipe').innerHTML, recipe);
  confirm(); resolve(null); await pending;
  assert.equal(get('fuse-status').textContent, '');
  assert.equal(timers[0].ms, 2000);
  timers[0].fn();
  assert.equal(c.UI.gemComposeFx, null);
  assert.equal(get('fuse-status').textContent, '合成成功！');
  assert.equal(get('gem-focus').inert, false);
});

test('拆解光效保存原料／產出，兩秒後等晚回覆才完成，失敗／重試不假報成功', async () => {
  const { c, get, snapshot, timers } = uiFixture();
  c.UI.gemBrowse.tool = 'dismantle';
  c.stageGemDismantle('ruby', 10, true);
  let confirm, resolve;
  c.sendGemUiCommand = (cmd, args, ref, panels, done) => {
    assert.equal(cmd, 'gem.dismantleSlots');
    assert.deepEqual(plain(args.slots), [{ type: 'ruby', lv: 10, n: 1 }]);
    confirm = done; return new Promise(r => { resolve = r; });
  };
  const pending = c.runGemDismantle();
  snapshot.gems.ruby[10] = 0;
  c.renderGems();
  assert.match(get('gdis-grid').innerHTML, /十級紅寶石/);
  assert.match(get('gdis-output').innerHTML, /×6/);
  timers[0].fn(); assert.equal(get('gdis-status').textContent, '');
  confirm(); resolve(null); await pending;
  assert.equal(c.UI.gemDismantleFx, null);
  assert.equal(get('gdis-output').innerHTML, '');
  assert.equal(get('gdis-status').textContent, '拆解成功！');
  c.stageGemDismantle('sapphire', 3, true);
  c.sendGemUiCommand = () => Promise.resolve(null); // 統一錯誤處理不呼叫成功回呼
  await c.runGemDismantle();
  assert.equal(c.UI.gemDismantleFx, null);
  assert.equal(c.UI.gemDismantleSlots[0].n, 1);
  assert.equal(get('gdis-status').textContent, '');
  assert.equal(timers[1].cancelled, true);
  timers[0].fn(); assert.equal(c.UI.gemDismantleFx, null);
});

test('兩個新提示文字精確，拆解只保留清空與一鍵拆解，移除舊下拉及融合清單', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /data-tt-desc="選取上方寶石以合成更高階的寶石"/);
  assert.match(html, /data-tt-desc="選擇上方寶石進行拆解，可將高級寶石拆解為前一階寶石&#10;拆解過程不會產生任何損耗。"/);
  const panel = html.slice(html.indexOf('data-gem-panel="dismantle"'), html.indexOf('data-gem-panel="fusion"'));
  assert.deepEqual([...panel.matchAll(/<button id="([^"]+)"/g)].map(m => m[1]), ['gdis-clear', 'gdis-btn']);
  assert.doesNotMatch(panel, /id="gdis-(?:type|level|fused|result|all-btn)"/);
});
test('正式Worker九宮格拆解指令回傳同源產出，非法整批不扣庫存', () => {
  const { createEngine } = require('../scripts/sim/engine');
  const engine = createEngine({ seed: 20261018 }).boot(null);
  engine.cmd('gm.exec', { line: 'gem ruby 10 1' });
  engine.cmd('gm.exec', { line: 'gem ruby 9 2' });
  const gems = engine.state().player.gems, gold = engine.state().player.gold;
  const slots = [{ type: 'ruby', lv: 10, n: 1 }, { type: 'ruby', lv: 9, n: 2 }];
  const before = JSON.stringify(gems);
  const invalid = engine.cmd('gem.dismantleSlots', { slots: [...slots, { type: 'ruby', lv: 10, n: 1 }] });
  assert.equal(invalid.ok, true); // Worker傳輸成功，遊戲拒絕沿既有 result.err 契約。
  assert.match(invalid.result.err, /庫存不足/);
  assert.equal(JSON.stringify(gems), before);
  const valid = engine.cmd('gem.dismantleSlots', { slots });
  assert.equal(valid.ok, true);
  assert.deepEqual(plain(valid.result.outputs), [{ type: 'ruby', lv: 9, n: 6 }, { type: 'ruby', lv: 8, n: 8 }]);
  assert.equal(gems.ruby[9], 6); assert.equal(gems.ruby[8], 8); assert.equal(gems.ruby[10], 0);
  assert.equal(engine.state().player.gold, gold);
});
