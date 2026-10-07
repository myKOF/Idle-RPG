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

/* opts.internal：模擬內測版（isInternalServer 為真，符文頁有「詳細說明」開關、預設全部攤開）；預設 true，
   讓既有的版面／篩選／材料齊全測試維持原樣。傳 false ＝正式版：沒有開關、沒成形過的符文真言一律問號。 */
function mount(opts) {
  const internal = !opts || opts.internal !== false;
  const els = {};
  ['tab-runes', 'rune-grid', 'rune-focus', 'rune-tier-filter', 'rune-ready-only', 'runeword-list',
    'rune-total', 'rune-worn', 'rune-codex-count', 'rune-detail-toggle'].forEach((id) => { els[id] = el(id); });
  els['rune-detail-toggle'].hidden = true;
  const c = {
    console, Math: Object.create(Math), UI: { dirty: {} }, setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById: (id) => els[id] || null, querySelectorAll() { return []; }, querySelector() { return null; } },
    blog() {}, flog() {}, GT: 0
  };
  c.window = c;
  const store = {};
  c.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  c.store = store;
  vm.createContext(c);
  ['worker/protocol.js', 'util.js', 'data.js', 'runeword_data.js', 'status.js', 'formula.js', 'item.js', 'runeword.js', 'ui.js', 'ui-runeword.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), c, { filename: 'js/' + f });
  });
  c.isInternalServer = () => internal;   // ui.js 的版本在 vm 裡讀不到 location，直接蓋掉
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
  assert.match(focus, /用在這些符文真言/);
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
  const item = { id: 'w', slot: 'weapon', weaponType: 'sword1h', rarity: 5, level: 100, sockets: [], runes: ['r06', 'r08', null, null], affixes: [] };
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
  assert.match(ui, /sendSlotSocketCommand\(it, mode, 'rune\.socket'/);
  // 符文取代附魔的位置：裝備頁操作列是「符文」、不再有「附魔」按鈕；符文鑲嵌頁的鑲入與取下都走符文孔指令
  assert.match(ui, /data-act="toggle-rune"/);
  assert.doesNotMatch(ui, /data-act="toggle-enchant"/);
  assert.match(ui, /sendUiCommand\('rune\.unsocket'/);
  assert.match(ui, /equipRuneGridHTML/);
  assert.match(ui, /socketRuneToSelected/, '符文鑲嵌頁：選孔後點符文鑲進該孔（與寶石同一套選孔流程）');
  const worker = fs.readFileSync(path.join(root, 'js/worker/sim.worker.js'), 'utf8');
  assert.match(worker, /runeword_data\.js\?v=/);
  assert.match(worker, /'\.\.\/runeword\.js\?v=/);
  assert.match(worker, /runes: p\.runes \|\| \{\}/);
});

/* ============ 符文真言隱藏（2026-10-07）：沒成形過的只顯示問號 ============ */
const wordBlock = (list, id, nextId) => list.slice(list.indexOf('id="rxw-' + id + '"'), list.indexOf('id="rxw-' + nextId + '"'));
const QUESTION8 = '？？？？？？？？';

test('正式版：圖鑑只留名稱／品質／孔數／適用裝備／風味，配方符文剩品質色外框、每條效果 8 個問號，沒有「材料齊全」', () => {
  const c = mount({ internal: false });
  c.setPanels({ gems: {}, fusedGems: [], runes: { r06: 1, r08: 1 }, runewordSeen: {} });
  c.renderRunes();
  const list = c.els['runeword-list'].innerHTML;
  const viper = wordBlock(list, 'rw_viperkiss', 'rw_minorthunder');
  assert.match(viper, /蛇吻/);
  assert.match(viper, /rx-badge">普通</);
  assert.match(viper, /需要 2 個符文孔/);
  assert.match(viper, /適用：單手劍、單手匕首、單手魔劍/);
  assert.match(viper, /rx-flavor/);
  // 配方：兩顆符文都只剩外框＋問號，沒有名稱、沒有字形、沒有可點的 data-rune-goto
  assert.equal((viper.match(/rx-chip is-unknown/g) || []).length, 2);
  assert.doesNotMatch(viper, /毒牙|暗影|data-rune-goto/);
  assert.match(viper, /--c:#4ade80/, '外框顏色＝符文自己的品質色帶（暗影是第 8 階→綠）');
  // 效果：蛇吻有 4 條（3 條屬性＋1 條觸發），每條都是 8 個問號，不得出現任何真正的數值描述
  assert.equal((viper.match(new RegExp('<li class="rx-unknown">' + QUESTION8 + '</li>', 'g')) || []).length, 4);
  assert.doesNotMatch(viper, /物理攻擊|毒屬性|機率/);
  // 就算材料齊全（持有毒牙＋暗影）也不能亮「材料齊全」，否則等於洩漏配方
  assert.doesNotMatch(list, /材料齊全/);
  assert.doesNotMatch(viper, /is-ready/);
});

test('正式版：沒有「詳細說明」開關，就算狀態被設成展開也一樣隱藏', () => {
  const c = mount({ internal: false });
  c.setPanels({ gems: {}, fusedGems: [], runes: {}, runewordSeen: {} });
  c.initRuneUi();
  c.renderRunes();
  assert.equal(c.els['rune-detail-toggle'].hidden, true, '按鈕維持 hidden');
  assert.equal(c.els['rune-detail-toggle'].listeners.click, undefined, '正式版連點擊都沒綁');
  c.runeUiState().detail = true;
  assert.equal(c.runeUiDetailOn(), false);
  c.renderRunes();
  assert.match(c.els['runeword-list'].innerHTML, /rx-unknown/);
  assert.equal(c.runeUiCanToggle(), false);
});

test('成形過一次（runewordSeen）才攤開：配方、效果與材料齊全旗標回來，沒成形過的仍是問號', () => {
  const c = mount({ internal: false });
  c.setPanels({ gems: {}, fusedGems: [], runes: { r06: 1, r08: 1 }, runewordSeen: { rw_viperkiss: 1 } });
  c.renderRunes();
  const list = c.els['runeword-list'].innerHTML;
  const viper = wordBlock(list, 'rw_viperkiss', 'rw_minorthunder');
  assert.match(viper, /毒牙/);
  assert.match(viper, /暗影/);
  assert.match(viper, /物理攻擊/);
  assert.match(viper, /材料齊全/);
  assert.doesNotMatch(viper, /rx-unknown|is-unknown/);
  const thunder = wordBlock(list, 'rw_minorthunder', 'rw_lightguard');
  assert.match(thunder, /rx-unknown/);
  assert.doesNotMatch(thunder, /雷屬性傷害提升/);
});

test('正式版：「只看材料齊全」只算已激活的；未激活的即使材料齊全也不出現', () => {
  const c = mount({ internal: false });
  c.setPanels({ gems: {}, fusedGems: [], runes: { r06: 1, r08: 1 }, runewordSeen: {} });
  const st = c.runeUiState();
  st.ready = true;
  c.renderRunes();
  assert.equal((c.els['runeword-list'].innerHTML.match(/class="rx-word[ "]/g) || []).length, 0);
  c.setPanels({ gems: {}, fusedGems: [], runes: { r06: 1, r08: 1 }, runewordSeen: { rw_viperkiss: 1 } });
  c.renderRunes();
  assert.equal((c.els['runeword-list'].innerHTML.match(/class="rx-word[ "]/g) || []).length, 1);
});

test('符文庫：「用在這些符文真言」未激活的名稱換成問號（品質色、不可點）；已激活的照常可點', () => {
  const c = mount({ internal: false });
  c.setPanels({ gems: {}, fusedGems: [], runes: { r28: 2 }, runewordSeen: {} });
  c.selectRune('r28');   // 命運：用在 輪迴／時之沙／血月 等第 4 級真言
  let focus = c.els['rune-focus'].innerHTML;
  const uses = c.RUNEWORDS.filter((w) => w.runes.includes('r28'));
  assert.ok(uses.length >= 3);
  assert.match(focus, new RegExp('用在這些符文真言（' + uses.length + '）'));
  assert.equal((focus.match(/rx-use is-unknown/g) || []).length, uses.length);
  assert.doesNotMatch(focus, /data-word-goto/, '問號不能點進圖鑑');
  uses.forEach((w) => assert.doesNotMatch(focus, new RegExp(w.name)));
  assert.match(focus, /--c:#fb923c/, '第 4 級＝傳說，問號用傳說的橘色');
  assert.match(focus, /？？？/);
  // 其中一組激活後：那一組顯示名稱與品質、可點；其餘仍是問號
  c.setPanels({ gems: {}, fusedGems: [], runes: { r28: 2 }, runewordSeen: { rw_reincarnation: 1 } });
  c.renderRunes();
  focus = c.els['rune-focus'].innerHTML;
  assert.match(focus, /data-word-goto="rw_reincarnation"/);
  assert.match(focus, /輪迴<i>傳說<\/i>/);
  assert.equal((focus.match(/rx-use is-unknown/g) || []).length, uses.length - 1);
});

test('內測版：預設全部攤開；「詳細說明」開關可切換、記在 localStorage，關掉就和正式版一樣', () => {
  const c = mount({ internal: true });
  c.setPanels({ gems: {}, fusedGems: [], runes: {}, runewordSeen: {} });
  c.initRuneUi();
  c.renderRunes();
  const btn = c.els['rune-detail-toggle'];
  assert.equal(btn.hidden, false, '內測版顯示開關');
  assert.equal(btn.textContent, '詳細說明：開');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.doesNotMatch(c.els['runeword-list'].innerHTML, /rx-unknown/, '預設就是改版前的樣子');
  assert.match(c.els['runeword-list'].innerHTML, /物理攻擊/);
  btn.listeners.click();
  assert.equal(btn.textContent, '詳細說明：關');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.equal(c.store['idle-rpg.runeDetail.v1'], '0');
  const list = c.els['runeword-list'].innerHTML;
  assert.match(list, /rx-unknown/);
  assert.doesNotMatch(list, /rune-stone/, '關掉開關後連石頭圖也不能露出來');
  assert.equal(c.UI.dirty.equip, true, '裝備詳情的配方提示也要重畫');
  btn.listeners.click();
  assert.equal(c.store['idle-rpg.runeDetail.v1'], '1');
  assert.match(c.els['runeword-list'].innerHTML, /物理攻擊/);
});

test('內測版：重新載入後沿用上次的開關狀態', () => {
  const c = mount({ internal: true });
  c.store['idle-rpg.runeDetail.v1'] = '0';
  c.setPanels({ gems: {}, fusedGems: [], runes: {}, runewordSeen: {} });
  c.initRuneUi();
  c.renderRunes();
  assert.equal(c.els['rune-detail-toggle'].textContent, '詳細說明：關');
  assert.match(c.els['runeword-list'].innerHTML, /rx-unknown/);
});

test('裝備詳情的「再鑲入…即可成形」提示：未激活遮成問號、已激活或內測攤開時照舊', () => {
  const it = { id: 'w', slot: 'weapon', weaponType: 'sword1h', rarity: 5, level: 100, sockets: [], runes: ['r06', null, null, null], affixes: [] };
  const ext = mount({ internal: false });
  ext.setPanels({ gems: {}, fusedGems: [], runes: {}, runewordSeen: {} });
  const masked = ext.itemRuneHTML(it);
  assert.match(masked, /再鑲入「？」即可成形【？？？？】/);
  assert.doesNotMatch(masked, /暗影|蛇吻/);
  ext.setPanels({ gems: {}, fusedGems: [], runes: {}, runewordSeen: { rw_viperkiss: 1 } });
  assert.match(ext.itemRuneHTML(it), /再鑲入「暗影」即可成形【蛇吻】/);
  const inn = mount({ internal: true });
  inn.setPanels({ gems: {}, fusedGems: [], runes: {}, runewordSeen: {} });
  assert.match(inn.itemRuneHTML(it), /再鑲入「暗影」即可成形【蛇吻】/);
  // 成形了就直接顯示名稱與效果（那一刻就是激活）
  const formed = Object.assign({}, it, { runes: ['r06', 'r08', null, null] });
  const out = ext.itemRuneHTML(formed);
  assert.match(out, /符文真言【蛇吻】/);
  assert.doesNotMatch(out, /符文之語/);
});

test('品質沿用裝備品質：名稱與顏色讀 RARITIES（白普通／綠精良／紫史詩／橘傳說），圖鑑篩選鈕與卡片徽章同步', () => {
  const c = mount();
  assert.deepEqual(Array.from(c.RUNEWORD_TIER_NAMES), ['', '普通', '精良', '史詩', '傳說']);
  assert.deepEqual(Array.from(c.RUNEWORD_TIER_COLORS), ['', '#9aa5b1', '#4ade80', '#c084fc', '#fb923c']);
  [1, 2, 3, 4].forEach((t) => {
    const r = c.RARITIES[c.RUNEWORD_TIER_RARITY[t]];
    assert.equal(c.RUNEWORD_TIER_NAMES[t], r.name);
    assert.equal(c.RUNEWORD_TIER_COLORS[t], r.color);
  });
  c.setPanels({ gems: {}, fusedGems: [], runes: {}, runewordSeen: {} });
  c.renderRunes();
  const chips = c.els['rune-tier-filter'].innerHTML;
  ['全部', '普通', '精良', '史詩', '傳說'].forEach((n) => assert.match(chips, new RegExp('>' + n + '<')));
  assert.doesNotMatch(chips, /強力|極度特殊/);
});

test('用語：畫面與說明一律是「符文真言」，沒有殘留「符文之語」；頁面大標題只寫「符文」', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<h2 class="pg-title">符文<\/h2>/);
  assert.match(html, /data-rune-tool-btn="codex">符文真言圖鑑</);
  assert.match(html, /id="rune-detail-toggle"[^>]*hidden/);
  ['index.html', 'js/ui-runeword.js', 'js/item.js', 'js/runeword.js', 'js/runeword_data.js', 'js/ui.js', 'js/combat.js', 'js/tower.js',
    'css/runeword.css', 'GM_command.md', 'docs/RUNEWORD_DESIGN.md', 'config/CSV/Runes.csv'].forEach((f) => {
    assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /符文之語/, f + ' 不得殘留舊名稱');
  });
  const c = mount();
  assert.doesNotMatch(c.runeUiHelpText(), /符文之語/);
  assert.match(c.runeUiHelpText(), /符文真言/);
});

test('接線：gems 面板帶 runewordSeen、協議 v48、快取版號已 bump', () => {
  const worker = fs.readFileSync(path.join(root, 'js/worker/sim.worker.js'), 'utf8');
  assert.match(worker, /runewordSeen: p\.runewordSeen \|\| \{\}/);
  const proto = fs.readFileSync(path.join(root, 'js/worker/protocol.js'), 'utf8');
  assert.match(proto, /WORKER_PROTOCOL_VERSION = 48;/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /js\/worker\/protocol\.js\?v=48/);
  assert.match(worker, /protocol\.js\?v=48/);
  assert.match(worker, /'\.\.\/runeword\.js\?v=[^']+'/);   // 只驗證有帶版號：確切字串每次改檔都會換，不釘
  assert.match(fs.readFileSync(path.join(root, 'js/bridge.js'), 'utf8'), /WORKER_ASSET_VERSION = '[^']+'/);
});

/* ============ 符文石圖（2026-10-07，images/runes）：每顆符文都有一張刻了字的石頭圖 ============ */
test('符文石圖檔：33 顆符文各一張 160×160 透明 PNG，runeStoneSrc 指到真的檔案，版本字尾可破快取', () => {
  const c = mount();
  assert.equal(c.RUNES.length, 33);
  c.RUNES.forEach((r) => {
    const src = c.runeStoneSrc(r.id);
    assert.match(src, new RegExp('^images/runes/stone-' + r.id + '\\.png\\?v=\\d+$'));
    const file = path.join(root, src.split('?')[0]);
    assert.ok(fs.existsSync(file), file + ' 不存在');
    const b = fs.readFileSync(file);
    assert.equal(b.slice(0, 8).toString('hex'), '89504e470d0a1a0a', r.id + ' 不是 PNG');
    assert.equal(b.readUInt32BE(16), 160, r.id + ' 寬度');
    assert.equal(b.readUInt32BE(20), 160, r.id + ' 高度');
    assert.equal(b[25], 6, r.id + ' 要有透明通道（RGBA）');
    assert.ok(b.length < 80 * 1024, r.id + ' 檔案過大：' + b.length);
  });
  assert.equal(fs.readdirSync(path.join(root, 'images', 'runes')).filter((f) => /\.png$/.test(f)).length, 33, '資料夾裡沒有多餘的圖');
});

test('runeStoneHTML：未知符文回空字串；有圖時帶 class 與 alt 空字串、不可拖曳', () => {
  const c = mount();
  assert.equal(c.runeStoneHTML('zz', 'rs-card'), '');
  const h = c.runeStoneHTML('r05', 'rs-chip');
  assert.match(h, /^<img class="rune-stone rs-chip" src="images\/runes\/stone-r05\.png\?v=\d+" alt="" draggable="false"/);
});

test('符文庫與圖鑑：格子、選中大圖、攤開的配方標籤用石頭圖；問號標籤與未激活的用途沒有任何圖', () => {
  const c = mount({ internal: false });
  c.setPanels({ gems: {}, fusedGems: [], runes: { r06: 1, r08: 1 }, runewordSeen: { rw_viperkiss: 1 } });
  c.renderRunes();
  const grid = c.els['rune-grid'].innerHTML;
  assert.equal((grid.match(/<img class="rune-stone rs-card"/g) || []).length, 33);
  assert.doesNotMatch(grid, /ᚠ|ᚢ/, '格子裡不再有 Unicode 字形');
  assert.match(grid, /stone-r01\.png/);
  assert.match(c.els['rune-focus'].innerHTML, /rx-focus-glyph"><img class="rune-stone rs-focus" src="images\/runes\/stone-r01\.png/);
  const list = c.els['runeword-list'].innerHTML;
  const viper = wordBlock(list, 'rw_viperkiss', 'rw_minorthunder');
  assert.equal((viper.match(/<img class="rune-stone rs-chip"/g) || []).length, 2, '蛇吻已激活：兩顆配方符文都是石頭圖');
  assert.match(viper, /stone-r06\.png/);
  assert.match(viper, /stone-r08\.png/);
  const thunder = wordBlock(list, 'rw_minorthunder', 'rw_lightguard');
  assert.doesNotMatch(thunder, /<img|stone-r/, '未激活的配方不得露出任何石頭圖（會洩漏是哪幾顆）');
  assert.match(thunder, /rx-chip is-unknown/);
  c.selectRune('r28');
  assert.doesNotMatch(c.els['rune-focus'].innerHTML.split('rx-uses')[1], /<img/, '未激活的用途不得有圖');
});

test('裝備詳情的符文孔、符文鑲嵌頁的符文格、背包角標都用石頭圖', () => {
  const c = mount();
  c.setPanels({ gems: {}, fusedGems: [], runes: { r13: 2, r25: 1 }, runewordSeen: {} });
  const it = { id: 'w', slot: 'weapon', weaponType: 'sword1h', rarity: 5, level: 100, sockets: [], runes: ['r13', 'r25', null, null], affixes: [] };
  const detail = c.itemRuneHTML(it);
  assert.equal((detail.match(/<img class="rune-stone rs-row"/g) || []).length, 2);
  assert.match(detail, /stone-r13\.png/);
  assert.match(detail, /stone-r25\.png/);
  const panel = c.equipRuneGridHTML(it, c.uiGemsPanelSnapshot());
  assert.equal((panel.match(/<img class="rune-stone rs-icon"/g) || []).length, 2, '只列出持有的符文');
  assert.match(panel, /data-rune-socket="r25"[^>]*>\s*<img/);
  const badge = c.itemRuneBadgeHTML(it);
  assert.match(badge, /<img class="rune-stone rs-badge" src="images\/runes\/stone-r13\.png/);
  assert.match(badge, /×2/);
});

test('符文石圖的接線：index.html 引用的 css／js 版號與快取、素材來源記錄', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /css\/runeword\.css\?v=[\d.]+/);   // 版號只驗證存在（每次改檔都會 +1，不釘確切值）
  assert.match(html, /js\/ui-runeword\.js\?v=[\d.]+/);
  const css = fs.readFileSync(path.join(root, 'css/runeword.css'), 'utf8');
  ['rs-card', 'rs-focus', 'rs-chip', 'rs-row', 'rs-icon', 'rs-badge'].forEach((k) => assert.match(css, new RegExp('\\.' + k + '\\b'), '缺 ' + k + ' 的尺寸樣式'));
  assert.match(css, /\.rune-stone \{[^}]*pointer-events: none/);
  const data = fs.readFileSync(path.join(root, 'js/runeword_data.js'), 'utf8');
  assert.match(data, /var RUNE_STONE_VER = \d+;/);
  assert.ok(fs.existsSync(path.join(root, 'tools/rune-stones/rune-stone-painter.js')), '產生器要隨專案保存');
});
