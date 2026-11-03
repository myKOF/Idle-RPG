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
    return { disabled: false, names, classList: { toggle(name, on) { on ? names.add(name) : names.delete(name); } }, getAttribute() { return null; } };
  }
  c.systemUnlockEntries().forEach(entry => buttons.set(entry.selector, button()));
  const nav = button(); nav.getAttribute = () => 'forge';
  c.document = {
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
