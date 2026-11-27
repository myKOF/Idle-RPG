const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function context() {
  const c = { console, UI: { dirty: {} } };
  c.window = c;
  vm.createContext(c);
  ['util.js', 'strings_data.js', 'strings.js', 'data.js', 'system-unlocks.js', 'player.js'].forEach(file =>
    vm.runInContext(read('js/' + file), c, { filename: file }));
  return c;
}
const state = (turn = 0, level = 1) => ({ player: { reincarnations: turn, level }, forge: {}, tower: { highest: 0 } });

test('新局初始功能不刷提示；神鑄四頁按正式門檻各自解鎖', () => {
  const c = context();
  assert.deepEqual(plain(c.systemUnlockSnapshot(state())).available, []);
  const required = Math.max(c.FORGE_UNLOCK_REINCARNATION, c.divineForgeUnlock('equip'));
  const before = c.systemUnlockSnapshot(state(required - 1));
  assert.ok(!before.available.includes('forge.equip'));
  const after = c.systemUnlockSnapshot(state(required));
  assert.ok(after.available.includes('forge.equip'));
  assert.ok(!after.available.includes('forge.ancient'));
  const later = c.systemUnlockSnapshot(state(c.divineForgeUnlock('ancient')));
  assert.ok(later.available.includes('forge.equip'));
  assert.ok(later.available.includes('forge.ancient'));
  assert.ok(!later.available.includes('forge.gem'));
  c.DIVINE_FORGE.imprintUnlock = 8;
  assert.ok(!c.systemUnlockSnapshot(state(7)).available.includes('forge.imprint'));
  assert.ok(c.systemUnlockSnapshot(state(8)).available.includes('forge.imprint'));
});

test('寶石／威能／裝備方案／高塔各自依配置與進度投影，不修改輸入', () => {
  const c = context(), s = state(c.GEM_RESONANCE_UNLOCK_REINCARNATION);
  s.tower.highest = c.TOWER_TRIAL_MAX_FLOOR;
  c.EQUIP_SET_UNLOCK_LEVELS[2] = 500;
  c.EQUIP_SET_UNLOCK_REINCARNATIONS[2] = 0;
  const before = JSON.stringify(s);
  const snapshot = c.systemUnlockSnapshot(s);
  assert.ok(snapshot.available.includes('gems.resonance'));
  assert.ok(snapshot.available.includes('talents.1'));
  assert.ok(snapshot.available.includes('equip.set.2'), '轉生後越過0轉等級門檻');
  assert.ok(snapshot.available.includes('tower.hell'));
  assert.ok(!snapshot.available.includes('tower.purgatory'));
  assert.equal(JSON.stringify(s), before);
  assert.ok(!c.systemUnlockSnapshot(state()).available.includes('gems.resonance'));
});

test('已讀跟隨存檔且每頁獨立，新局與另一存檔不受影響', () => {
  const c = context(), s = state(c.divineForgeUnlock('ancient'));
  s.uiUnlockSeen = { 'forge.equip': true, unknown: true };
  const restored = plain(s);
  assert.deepEqual(plain(c.systemUnlockSnapshot(restored)).seen, ['forge.equip']);
  assert.ok(!c.systemUnlockSnapshot(restored).seen.includes('forge.ancient'));
  assert.deepEqual(plain(c.systemUnlockSnapshot(state(3))).seen, []);
  assert.deepEqual(plain(c.newGameState().uiUnlockSeen), {});
});

test('Worker已讀命令拒絕未知／尚未開放ID，可重複標記但不跨頁清除', () => {
  const c = context(), worker = read('js/worker/sim.worker.js');
  const start = worker.indexOf("'ui.markUnlockSeen': function (a) {") + "'ui.markUnlockSeen': ".length;
  const end = worker.indexOf("  'settings.set':", start);
  vm.runInContext('markSeen = (' + worker.slice(start, end).trim().replace(/,$/, '') + ')', c);
  c.G = state(c.divineForgeUnlock('equip'));
  assert.throws(() => c.markSeen({ id: '__proto__' }), /not available/);
  assert.throws(() => c.markSeen({ id: 'forge.imprint' }), /not available/);
  assert.equal(c.G.uiUnlockSeen, undefined);
  c.markSeen({ id: 'forge.equip' });
  c.markSeen({ id: 'forge.equip' });
  assert.deepEqual(plain(c.G.uiUnlockSeen), { 'forge.equip': true });
  assert.equal(c.UI.dirty.header, true);
});

test('主端只清除實際點選的可用頁，父圖標彙總所有未讀頁且失敗可重試', async () => {
  const c = context(), buttons = new Map(), listeners = {}, requests = [];
  function button() {
    const names = new Set();
    return { disabled: false, names, classList: { contains(name) { return names.has(name); }, toggle(name, on) { on ? names.add(name) : names.delete(name); } }, getAttribute() { return null; } };
  }
  c.systemUnlockEntries().forEach(entry => buttons.set(entry.selector, button()));
  const nav = button(); nav.getAttribute = () => 'forge';
  c.document = {
    querySelector: selector => buttons.get(selector) || null,
    querySelectorAll: selector => selector === '#tabs .tab-btn' ? [nav] : buttons.has(selector) ? [buttons.get(selector)] : [],
    addEventListener: (kind, fn) => { listeners[kind] = fn; }
  };
  c.UI.tab = 'forge';
  const header = { systemUnlocks: { available: ['forge.equip', 'forge.ancient'], seen: [] } };
  c.uiHeaderPanelSnapshot = () => header;
  let fail = true;
  c.sendUiCommand = (name, args) => { requests.push([name, args.id]); return fail ? Promise.reject(new Error('offline')) : Promise.resolve(true); };
  vm.runInContext(read('js/ui-unlock-notices.js'), c);
  c.refreshSystemUnlockHints();
  assert.ok(nav.names.has('unlock-nav-pending'));
  assert.ok(buttons.get('#forge-mode-equip').names.has('unlock-tab-pending'), '預設頁不因進入父功能而清除');
  const click = selector => listeners.click({ target: { closest: query => query === selector ? buttons.get(query) : null } });
  click('#forge-mode-imprint');
  assert.equal(requests.length, 0);
  click('#forge-mode-equip');
  await new Promise(resolve => setImmediate(resolve));
  fail = false;
  click('#forge-mode-equip');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  header.systemUnlocks.seen = ['forge.equip'];
  c.refreshSystemUnlockHints();
  assert.ok(!buttons.get('#forge-mode-equip').names.has('unlock-tab-pending'));
  assert.ok(buttons.get('#forge-mode-ancient').names.has('unlock-tab-pending'));
  assert.ok(nav.names.has('unlock-nav-pending'));
  header.systemUnlocks.seen.push('forge.ancient');
  c.refreshSystemUnlockHints();
  assert.ok(!nav.names.has('unlock-nav-pending'));
  c.uiHeaderPanelSnapshot = () => null;
  assert.doesNotThrow(() => c.refreshSystemUnlockHints());
});

test('閃爍沒有時限；自主任意操作只清當前已查看頁，程式事件不算', async () => {
  for (const kind of ['pointerdown', 'click', 'keydown', 'wheel']) {
    const c = context(), listeners = {}, requests = [];
    const active = { getAttribute: name => name === 'aria-pressed' ? 'true' : null, classList: { contains: () => false } };
    const inactive = { getAttribute: () => null, classList: { contains: () => false } };
    const header = { systemUnlocks: { available: ['forge.equip', 'forge.ancient'], seen: [] } };
    c.document = {
      querySelector: selector => selector === '#forge-mode-equip' ? active : inactive,
      querySelectorAll: () => [],
      addEventListener: (name, fn) => { listeners[name] = fn; }
    };
    c.uiHeaderPanelSnapshot = () => header;
    c.sendUiCommand = (name, args) => { requests.push(args.id); return Promise.resolve(true); };
    vm.runInContext(read('js/ui-unlock-notices.js'), c);
    const event = { type: kind, isTrusted: true, target: { closest: () => null } };
    c.UI.tab = 'char';
    listeners[kind](event);
    c.UI.tab = 'forge';
    for (let i = 0; i < 100; i++) c.refreshSystemUnlockHints();
    assert.deepEqual(requests, [], kind + ': 進入父功能或持續刷新不清預設頁');
    listeners[kind]({ ...event, isTrusted: false });
    assert.deepEqual(requests, [], kind + ': 程式事件不清');
    listeners[kind](event);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requests, ['forge.equip'], kind + ': 只清當頁，太古提示保留');
  }
});

test('世界地圖只在荒漠真正通關100關後提示，已讀隨存檔保留且新局獨立', () => {
  const c = context(), s = state();
  s.stage = { zone: 'desert', current: 100, best: 100 };
  s.zoneProgress = { desert: { best: 100, cleared: 99 } };
  const id = 'worldMap.firstClear';
  assert.ok(!c.systemUnlockSnapshot(s).available.includes(id), '到達末關還不算勝利');
  s.zoneProgress.desert.cleared = 100;
  const original = JSON.stringify(s);
  assert.ok(c.systemUnlockSnapshot(s).available.includes(id));
  assert.equal(JSON.stringify(s), original, '共載索引不寫入狀態');
  const worker = read('js/worker/sim.worker.js');
  const start = worker.indexOf("'ui.markUnlockSeen': function (a) {") + "'ui.markUnlockSeen': ".length;
  const end = worker.indexOf("  'settings.set':", start);
  vm.runInContext('markSeen = (' + worker.slice(start, end).trim().replace(/,$/, '') + ')', c);
  c.G = s;
  c.markSeen({ id });
  assert.equal(c.UI.dirty.header, true);
  const restored = plain(c.G);
  assert.ok(c.systemUnlockSnapshot(restored).seen.includes(id));
  restored.stage.zone = 'Icefield';
  assert.ok(c.systemUnlockSnapshot(restored).seen.includes(id), '換圖與重複通關不重置');
  assert.ok(!c.systemUnlockSnapshot(plain(JSON.parse(original))).seen.includes(id), '另一未讀存檔保持提示');
  assert.ok(!c.systemUnlockSnapshot(c.newGameState()).available.includes(id));
  c.G = state();
  assert.throws(() => c.markSeen({ id }), /not available/, '首通前點地圖不提前已讀');
});

test('荒漠末關實際勝利後產生地圖提示，重複刷關不復活已讀提示', () => {
  const c = context();
  c.blog = () => {};
  for (const file of ['status', 'formula', 'battlefield', 'combat']) {
    vm.runInContext(read('js/' + file + '.js'), c, { filename: file });
  }
  c.G = { ...state(), stage: { zone: 'desert', current: 100, best: 100, kills: 0, autoAdvance: true },
    zoneProgress: { desert: { current: 100, best: 100, cleared: 99 } }, uiUnlockSeen: {} };
  c.FIELD.player = null;
  const id = 'worldMap.firstClear';
  assert.ok(!c.systemUnlockSnapshot(c.G).available.includes(id));
  c.FIELD._waveClearPending = true;
  c.completeFieldWave({ hp: 100 });
  assert.ok(c.systemUnlockSnapshot(c.G).available.includes(id));
  assert.equal(c.UI.dirty.header, true, '勝利髒標記驅動header提示更新');
  c.G.uiUnlockSeen[id] = true;
  for (let i = 0; i < 3; i++) {
    c.FIELD._waveClearPending = true;
    c.completeFieldWave({ hp: 100 });
    assert.ok(c.systemUnlockSnapshot(c.G).seen.includes(id));
  }
});

test('世界地圖提示跨主面板，只能點擊按鈕解除，其他操作與刷新皆保持且失敗可重試', async () => {
  const c = context(), listeners = {}, requests = [], classes = new Set();
  const id = 'worldMap.firstClear';
  // 即使世界地圖日後帶有選中狀態，也不得因滾輪／按鍵／點別處而清提示。
  const button = { disabled: false, getAttribute: name => name === 'aria-pressed' ? 'true' : null,
    classList: { contains: name => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } };
  const header = { systemUnlocks: { available: [id], seen: [] } };
  c.document = {
    querySelector: selector => selector === '#btn-world-map' ? button : null,
    querySelectorAll: selector => selector === '#btn-world-map' ? [button] : [],
    addEventListener: (name, fn) => { listeners[name] = fn; }
  };
  c.uiHeaderPanelSnapshot = () => header;
  let fail = true;
  c.sendUiCommand = (name, args) => {
    requests.push([name, args.id]);
    if (fail) return Promise.reject(new Error('offline'));
    header.systemUnlocks.seen.push(args.id);
    return Promise.resolve(true);
  };
  vm.runInContext(read('js/ui-unlock-notices.js'), c);
  const unrelated = { isTrusted: true, target: { closest: () => null } };
  const click = { isTrusted: true, target: { closest: selector => selector === '#btn-world-map' ? button : null } };
  for (const tab of ['equip', 'skills', 'tower', 'char']) {
    c.UI.tab = tab;
    for (let i = 0; i < 100; i++) c.refreshSystemUnlockHints();
    for (const kind of ['pointerdown', 'keydown', 'wheel', 'click']) listeners[kind](unrelated);
    assert.ok(classes.has('unlock-tab-pending'));
  }
  assert.deepEqual(requests, [], '沒有計時解除或依主頁狀態自動已讀');
  listeners.click({ ...click, isTrusted: false });
  button.disabled = true;
  listeners.click(click);
  button.disabled = false;
  assert.deepEqual(requests, [], '程式呼叫與停用按鈕不算點擊');
  listeners.click(click);
  await new Promise(resolve => setImmediate(resolve));
  c.refreshSystemUnlockHints();
  assert.ok(classes.has('unlock-tab-pending'), '命令失敗保留提示');
  fail = false;
  listeners.click(click);
  await new Promise(resolve => setImmediate(resolve));
  c.refreshSystemUnlockHints();
  assert.ok(!classes.has('unlock-tab-pending'));
  listeners.click(click);
  assert.deepEqual(requests, [['ui.markUnlockSeen', id], ['ui.markUnlockSeen', id]]);
  header.systemUnlocks.seen = [];
  c.refreshSystemUnlockHints();
  assert.ok(classes.has('unlock-tab-pending'), '載入另一未讀存檔再次提示');
});
