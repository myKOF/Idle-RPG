const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

/* 符文頁（js/ui-runeword.js）：用最小 DOM 載入真正的 ui.js＋ui-runeword.js，
   餵 Worker 面板快照，檢查渲染內容、篩選、材料齊全旗標與指令送出。 */
function el(id) {
  const e = {
    id, style: {}, _attrs: {}, _html: '', _text: '', checked: false, listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(k, v) { this._attrs[k] = v; }, getAttribute(k) { return this._attrs[k] ?? null; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelectorAll() { return []; }, querySelector() { return null; }
  };
  Object.defineProperty(e, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; } });
  Object.defineProperty(e, 'textContent', { get() { return this._text; }, set(v) { this._text = v; } });
  return e;
}

function mount() {
  const els = {};
  ['tab-runes', 'rune-grid', 'rune-focus', 'rune-tier-filter', 'rune-ready-only', 'runeword-list',
    'rune-total', 'rune-worn', 'rune-codex-count'].forEach((id) => { els[id] = el(id); });
  const c = {
    console, Math: Object.create(Math), UI: { dirty: {} }, setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById: (id) => els[id] || null, querySelectorAll() { return []; }, querySelector() { return null; } },
    blog() {}, flog() {}, GT: 0
  };
  c.window = c;
  vm.createContext(c);
  ['worker/protocol.js', 'util.js', 'data.js', 'runeword_data.js', 'status.js', 'formula.js', 'item.js', 'runeword.js', 'ui.js', 'ui-runeword.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), c, { filename: 'js/' + f });
  });
  c.els = els;
  c.setPanels = (gems, equip) => {
    c.UI_WORKER_STATE.panels.gems = gems;
    c.UI_WORKER_STATE.panels.equip = equip || null;
  };
  c.sent = [];
  c.sendGemUiCommand = (name, args, ref, panels, ok) => { c.sent.push({ name, args: JSON.parse(JSON.stringify(args)) }); if (ok) ok(name === 'rune.dismantle' ? { id: 'r04', n: 2 } : null); };
  return c;
}

test('符文庫：33 格、持有量與選中符文的合成／拆解狀態', () => {
  const c = mount();
  c.setPanels({ gems: {}, fusedGems: [], runes: { r01: 7, r05: 1 } });
  c.renderRunes();
  const grid = c.els['rune-grid'].innerHTML;
  assert.equal((grid.match(/data-rune-pick=/g) || []).length, 33);
  assert.match(grid, /×7/);
  assert.equal(c.els['rune-total'].textContent, '8');
  // 預設選第 1 階：可合成（7 ≥ 3）、不可拆解（第 1 階）
  const focus = c.els['rune-focus'].innerHTML;
  assert.match(focus, /data-rune-act="compose"(?![^>]*disabled)/);
  assert.match(focus, /data-rune-act="dismantle" disabled/);
  assert.match(focus, /用在這些符文之語/);
  // 選第 5 階（持有 1）：不可合成、可拆解
  c.selectRune('r05');
  const f5 = c.els['rune-focus'].innerHTML;
  assert.match(f5, /data-rune-act="compose" disabled/);
  assert.match(f5, /data-rune-act="dismantle"(?![^>]*disabled)/);
  // 第 20 階起只能掉落
  c.setPanels({ gems: {}, fusedGems: [], runes: { r21: 9 } });
  c.selectRune('r21');
  assert.match(c.els['rune-focus'].innerHTML, /data-rune-act="compose" disabled/);
  assert.match(c.els['rune-focus'].innerHTML, /只能靠擊殺與封魔塔掉落/);
});

test('圖鑑：全部配方、材料齊全旗標（含重複符文的數量需求）、穿戴中成形旗標', () => {
  const c = mount();
  c.setPanels({ gems: {}, fusedGems: [], runes: { r06: 1, r08: 1, r03: 1 } }, null);
  c.renderRunes();
  let list = c.els['runeword-list'].innerHTML;
  assert.equal((list.match(/class="rx-word[ "]/g) || []).length, c.RUNEWORDS.length);
  assert.match(list, /id="rxw-rw_viperkiss"[^>]*>/);
  const viper = list.slice(list.indexOf('id="rxw-rw_viperkiss"'), list.indexOf('id="rxw-rw_minorthunder"'));
  assert.match(viper, /材料齊全/);
  // 凜冬使者需要 2 顆霜痕（r03）；只有 1 顆 → 不算齊全
  const winter = list.slice(list.indexOf('id="rxw-rw_winterherald"'), list.indexOf('id="rxw-rw_bloodgulp"'));
  assert.doesNotMatch(winter, /材料齊全/);
  assert.match(winter, /×2/);
  // 穿戴中成形
  const item = { id: 'w', slot: 'weapon', weaponType: 'sword1h', rarity: 5, level: 100, sockets: [{ rune: 'r06' }, { rune: 'r08' }, null, null], affixes: [] };
  c.setPanels({ gems: {}, fusedGems: [], runes: {} }, { equipment: { weapon: item }, sets: null });
  c.renderRunes();
  list = c.els['runeword-list'].innerHTML;
  assert.match(list, /穿戴中・已成形/);
  assert.equal(c.els['rune-worn'].textContent, '1');
});

test('圖鑑篩選：級距與「只看材料齊全」', () => {
  const c = mount();
  c.setPanels({ gems: {}, fusedGems: [], runes: { r06: 1, r08: 1 } });
  const st = c.runeUiState();
  st.tier = 4;
  c.renderRunes();
  let list = c.els['runeword-list'].innerHTML;
  assert.equal((list.match(/class="rx-word[ "]/g) || []).length, c.RUNEWORDS.filter((w) => w.tier === 4).length);
  st.tier = 0; st.ready = true;
  c.renderRunes();
  list = c.els['runeword-list'].innerHTML;
  assert.equal((list.match(/class="rx-word[ "]/g) || []).length, 1, '只剩材料齊全的蛇吻');
  assert.match(list, /蛇吻/);
  assert.match(c.els['rune-codex-count'].textContent, new RegExp('顯示 1 / ' + c.RUNEWORDS.length));
});

test('按鈕送出對應的符文指令', () => {
  const c = mount();
  c.setPanels({ gems: {}, fusedGems: [], runes: { r02: 5 } });
  c.selectRune('r02');
  c.runeUiAction('compose');
  c.runeUiAction('composeAll');
  c.runeUiAction('dismantle');
  assert.deepEqual(c.sent.map((s) => s.name), ['rune.compose', 'rune.composeAll', 'rune.dismantle']);
  c.sent.forEach((s) => assert.deepEqual(s.args, { runeId: 'r02' }));
});

test('index.html 與 ui.js 的接線：分頁、script／css、面板訂閱、socket 模式符文圖示', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /data-tab="runes"/);
  assert.match(html, /<section id="tab-runes" class="tab"/);
  assert.match(html, /js\/runeword_data\.js\?v=/);
  assert.match(html, /js\/runeword\.js\?v=/);
  assert.match(html, /js\/ui-runeword\.js\?v=/);
  assert.match(html, /css\/runeword\.css\?v=/);
  // 載入順序：資料表要在 formula 之前（computeStats 會讀），ui-runeword 在 ui 之後
  assert.ok(html.indexOf('src="js/runeword_data.js?v=') < html.indexOf('src="js/formula.js?v='));
  assert.ok(html.indexOf('src="js/item.js?v=') < html.indexOf('src="js/runeword.js?v='));
  assert.ok(html.indexOf('src="js/ui.js?v=') < html.indexOf('src="js/ui-runeword.js?v='));
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(ui, /runes: \['gems', 'equip', 'header'\]/);
  assert.match(ui, /data-rune-socket/);
  assert.match(ui, /sendUiCommand\('rune\.socket'/);
  const worker = fs.readFileSync(path.join(root, 'js/worker/sim.worker.js'), 'utf8');
  assert.match(worker, /runeword_data\.js\?v=/);
  assert.match(worker, /'\.\.\/runeword\.js\?v=/);
  assert.match(worker, /runes: p\.runes \|\| \{\}/);
});
