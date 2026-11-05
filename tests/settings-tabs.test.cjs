'use strict';
/* 設置視窗：三個頁籤（遊戲設定／音訊／存檔）、預設值、全體靜音聯動、音效增益與攻擊音效開關。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readExpanded } = require('./helpers/str-expand.cjs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function loadSettings(stored) {
  const store = new Map(stored ? [['idle-rpg.gameSettings.v1', JSON.stringify(stored)]] : []);
  const c = { localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) } };
  vm.createContext(c); vm.runInContext(read('js/game-settings.js') + '\nthis.GameSettings = GameSettings;', c);
  return { gs: c.GameSettings, store };
}

test('GameSettings 預設值：輪廓／鏡頭鎖定／我方敵方音效開，靜音關，兩條音量 50%', () => {
  const { gs } = loadSettings();
  assert.deepEqual(JSON.parse(JSON.stringify(gs.defaults())), { outline: true, cameraLock: true, mute: false, musicVolume: 50, sfxVolume: 50, allyAttackSfx: true, enemyAttackSfx: true });
  assert.equal(gs.sfxGain(), 1, '音效 50% ＝ 原本調好的音量');
});

test('GameSettings 存取：持久化、數值夾在 0～100、壞資料退回預設、靜音讓增益歸零', () => {
  const { gs, store } = loadSettings();
  gs.set('sfxVolume', 100); assert.equal(gs.sfxGain(), 2);
  gs.set('sfxVolume', 250); assert.equal(gs.get('sfxVolume'), 100);
  gs.set('musicVolume', 'abc'); assert.equal(gs.get('musicVolume'), 50);
  gs.set('mute', true); assert.equal(gs.sfxGain(), 0);
  gs.set('unknownKey', true); assert.equal(gs.get('unknownKey'), undefined);
  assert.equal(JSON.parse(store.get('idle-rpg.gameSettings.v1')).mute, true);
  const again = loadSettings({ outline: false, sfxVolume: 20, bogus: 1, mute: 'yes' }).gs;
  assert.equal(again.get('outline'), false); assert.equal(again.get('sfxVolume'), 20);
  assert.equal(again.get('mute'), true); assert.equal(again.get('bogus'), undefined);
  assert.equal(loadSettings().gs.get('mute'), false, '沒存過就是預設');
});

test('GameSettings 變更會通知監聽者，值沒變不通知', () => {
  const { gs } = loadSettings(); const seen = [];
  gs.subscribe((k, v) => seen.push([k, v]));
  gs.set('outline', false); gs.set('outline', false); gs.set('cameraLock', false);
  assert.deepEqual(seen, [['outline', false], ['cameraLock', false]]);
});

function loadSfx(gs) {
  const played = [], gains = [];
  const c = { GameSettings: gs, performance: { now: () => 1e6 }, document: { hidden: false, addEventListener() {} }, setTimeout: fn => fn(),
    fetch: async () => ({ arrayBuffer: async () => ({}) }),
    window: { AudioContext: class {
      constructor() { this.state = 'running'; this.destination = {}; }
      decodeAudioData(ab, ok) { ok({}); }
      createGain() { const g = { gain: { value: 1 }, connect() {} }; gains.push(g); return g; }
      createBufferSource() { return { connect() {}, start() { played.push(1); } }; }
    } } };
  vm.createContext(c); vm.runInContext(read('js/sfx.js') + '\nthis.Sfx = Sfx;', c);
  return { sfx: c.Sfx, played, gains, c };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('Sfx：音量依音效音量縮放、全體靜音不發聲、我方／敵方攻擊音效各自可關', async () => {
  const { gs } = loadSettings();
  const s = loadSfx(gs);
  s.sfx.preload(); s.sfx.play('levelUp'); await flush();
  s.sfx.preload(); await flush();
  assert.equal(s.sfx.play('levelUp'), true);
  assert.ok(Math.abs(s.gains[s.gains.length - 1].gain.value - 0.8) < 1e-9, '50% ＝ 原音量 0.8');
  gs.set('sfxVolume', 100); s.sfx.play('levelUp');
  assert.ok(Math.abs(s.gains[s.gains.length - 1].gain.value - 1.6) < 1e-9);
  const before = s.played.length;
  gs.set('mute', true); assert.equal(s.sfx.play('levelUp'), false); assert.equal(s.played.length, before);
  gs.set('mute', false);
  gs.set('allyAttackSfx', false);
  assert.equal(s.sfx.playGroup('basicHit', 0, 'ally'), false);
  assert.equal(s.sfx.playGroup('basicHit', 0, 'enemy'), true);
  gs.set('allyAttackSfx', true); gs.set('enemyAttackSfx', false);
  s.c.performance.now = () => 2e6;
  assert.equal(s.sfx.playGroup('basicHit', 0, 'enemy'), false);
  assert.equal(s.sfx.playGroup('basicHit', 0, 'ally'), true);
});

test('index.html：三個頁籤，遊戲設定頁六項與音訊頁五項，預設勾選與題目一致', () => {
  const html = readExpanded(path.join(root, 'index.html'));
  const tabs = [...html.matchAll(/data-settings-tab="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(tabs, ['game', 'audio', 'save', 'help']);
  assert.match(html, /<button[^>]*id="settings-tab-game"[^>]*>遊戲設定<\/button>/);
  assert.match(html, /<button[^>]*id="settings-tab-audio"[^>]*>音訊<\/button>/);
  assert.match(html, /<button[^>]*id="settings-tab-save"[^>]*>存檔<\/button>/);
  const gamePane = html.match(/id="settings-pane-game"[\s\S]*?<\/section>/)[0];
  const audioPane = html.match(/id="settings-pane-audio"[\s\S]*?<\/section>/)[0];
  const checked = (pane, id) => new RegExp('id="' + id + '"[^>]*\\bchecked').test(pane);
  for (const [id, on] of [['set-outline', true], ['set-reduce-fx', false], ['set-damage-numbers', true], ['set-camera-lock', true], ['set-auto-equip', true], ['set-compare-equip', true]]) {
    assert.ok(gamePane.includes('id="' + id + '"'), id);
    assert.equal(checked(gamePane, id), on, id + ' 預設勾選');
  }
  for (const [id, on] of [['set-mute', false], ['set-ally-sfx', true], ['set-enemy-sfx', true]]) assert.equal(checked(audioPane, id), on, id);
  for (const id of ['set-music-volume', 'set-sfx-volume']) assert.match(audioPane, new RegExp('id="' + id + '" min="0" max="100" step="1" value="50"'));
  for (const tip of ['使人物更清晰', '降低特效以提升性能', '取消此選項可提升性能', '取消此選項可用中鍵調整鏡頭距離',
    '打開此選項時若有空的裝備欄位將自動穿上', '打開此選項以比對身上與背包的裝備數值', '勾選此選項將遊戲設為靜音']) assert.ok(html.includes(tip), tip);
  assert.match(html, /id="tab-settings" class="system-settings-content settings-pane"[^>]*hidden/, '存檔頁籤預設隱藏，內容維持原本的存檔界面');
  assert.match(read('css/ashen-forge.css'), /\.system-settings-card \{[^}]*width: min\(624px, 100%\)/, '寬度＝原 960px 的 65%');
});

function loadMenu(initial) {
  const nodes = {}, listeners = {};
  const mk = (id, extra) => (nodes[id] = Object.assign({ id, style: {}, classList: { toggle() {}, add() {}, remove() {} }, hidden: false, checked: false, disabled: false, value: '50', textContent: '', tabIndex: 0,
    setAttribute() {}, addEventListener(name, fn) { (listeners[id] = listeners[id] || {})[name] = fn; }, focus() {}, getClientRects: () => [1], querySelectorAll: () => [] }, extra));
  ['game-menu', 'settings-modal', 'game-menu-reload', 'game-menu-exit', 'game-menu-save', 'game-menu-settings', 'game-menu-close', 'settings-modal-close', 'game-menu-status',
    'settings-tab-game', 'settings-tab-audio', 'settings-tab-save', 'settings-tab-help', 'settings-pane-game', 'settings-pane-audio', 'tab-settings', 'settings-pane-help',
    'set-outline', 'set-reduce-fx', 'set-damage-numbers', 'set-camera-lock', 'set-auto-equip', 'set-compare-equip', 'set-mute', 'set-ally-sfx', 'set-enemy-sfx',
    'set-music-volume', 'set-sfx-volume', 'set-music-volume-value', 'set-sfx-volume-value', 'toggle-autoequip', 'toggle-compare'].forEach(id => mk(id));
  const group = mk('settings-audio-group', { classes: new Set(), inputs: [nodes['set-music-volume'], nodes['set-sfx-volume'], nodes['set-ally-sfx'], nodes['set-enemy-sfx']] });
  group.classList = { toggle(n, on) { on ? group.classes.add(n) : group.classes.delete(n); } };
  group.querySelectorAll = () => group.inputs;
  nodes['settings-modal'].style.display = 'none'; nodes['game-menu'].style.display = 'none';
  const { gs } = loadSettings(initial);
  const calls = [];
  const ctx = { document: { activeElement: null, getElementById: id => nodes[id] || null, addEventListener() {}, body: { classList: { add() {}, remove() {} } } },
    Promise, setTimeout() {}, window: {}, location: {}, closeTopmostModalOrOverlay() { return false; },
    refreshSettingsPanel() { calls.push('refresh-save'); }, GameSettings: gs,
    BattleRenderer: { setCameraLocked() { calls.push('camera'); } },
    setPerfModeEnabled(v) { calls.push(['perf', v]); }, isPerfModeEnabled: () => false,
    setDamageNumbersEnabled(v) { calls.push(['damage', v]); }, isDamageNumbersEnabled: () => true,
    Event: class { constructor(type) { this.type = type; } } };
  nodes['toggle-autoequip'].dispatchEvent = e => calls.push(['dispatch-autoequip', e.type, nodes['toggle-autoequip'].checked]);
  nodes['toggle-compare'].dispatchEvent = e => calls.push(['dispatch-compare', e.type, nodes['toggle-compare'].checked]);
  vm.createContext(ctx); vm.runInContext(read('js/game-menu.js'), ctx); ctx.GameMenu.init();
  const fire = (id, name, patch) => { Object.assign(nodes[id], patch); listeners[id][name].call(nodes[id]); };
  return { ctx, nodes, gs, calls, fire, group };
}

test('設置頁籤：預設開啟遊戲設定，切到存檔才讀存檔列表，AI 金鑰入口直達存檔頁', () => {
  const m = loadMenu();
  m.ctx.GameMenu.openSettings();
  assert.equal(m.nodes['settings-pane-game'].hidden, false); assert.equal(m.nodes['settings-pane-audio'].hidden, true); assert.equal(m.nodes['tab-settings'].hidden, true);
  assert.ok(!m.calls.includes('refresh-save'));
  m.fire('settings-tab-audio', 'click');
  assert.equal(m.nodes['settings-pane-audio'].hidden, false); assert.equal(m.nodes['settings-pane-game'].hidden, true);
  m.fire('settings-tab-save', 'click');
  assert.equal(m.nodes['tab-settings'].hidden, false); assert.ok(m.calls.includes('refresh-save'));
  m.ctx.GameMenu.openSettings('save');
  assert.equal(m.nodes['tab-settings'].hidden, false); assert.equal(m.nodes['settings-pane-game'].hidden, true);
  m.ctx.GameMenu.openSettings();
  assert.equal(m.nodes['settings-pane-game'].hidden, false, '再次開啟回到第一頁籤');
});

test('遊戲設定頁：輪廓／鏡頭鎖定寫入 GameSettings；降低特效、戰鬥數字、自動穿裝、裝備比對轉接原開關', () => {
  const m = loadMenu();
  m.ctx.GameMenu.openSettings();
  m.fire('set-outline', 'change', { checked: false }); assert.equal(m.gs.get('outline'), false);
  m.fire('set-camera-lock', 'change', { checked: false }); assert.equal(m.gs.get('cameraLock'), false); assert.ok(m.calls.includes('camera'));
  m.fire('set-reduce-fx', 'change', { checked: true }); assert.deepEqual(m.calls.find(c => c[0] === 'perf'), ['perf', true]);
  m.fire('set-damage-numbers', 'change', { checked: false }); assert.deepEqual(m.calls.find(c => c[0] === 'damage'), ['damage', false]);
  m.fire('set-auto-equip', 'change', { checked: false });
  assert.deepEqual(m.calls.find(c => c[0] === 'dispatch-autoequip'), ['dispatch-autoequip', 'change', false]);
  m.fire('set-compare-equip', 'change', { checked: false });
  assert.deepEqual(m.calls.find(c => c[0] === 'dispatch-compare'), ['dispatch-compare', 'change', false]);
});

test('開啟設置時勾選狀態從來源重讀：裝備頁的開關與已存偏好', () => {
  const m = loadMenu({ outline: false, mute: true, sfxVolume: 80 });
  m.nodes['toggle-autoequip'].checked = true; m.nodes['toggle-compare'].checked = false;
  m.ctx.GameMenu.openSettings();
  assert.equal(m.nodes['set-outline'].checked, false); assert.equal(m.nodes['set-auto-equip'].checked, true); assert.equal(m.nodes['set-compare-equip'].checked, false);
  assert.equal(m.nodes['set-damage-numbers'].checked, true); assert.equal(m.nodes['set-reduce-fx'].checked, false);
  assert.equal(m.nodes['set-mute'].checked, true); assert.equal(m.nodes['set-sfx-volume'].value, 80); assert.equal(m.nodes['set-sfx-volume-value'].textContent, '80%');
});

test('全體靜音勾選後，音樂／音效音量與兩個攻擊音效變灰不可用；取消後恢復', () => {
  const m = loadMenu();
  m.ctx.GameMenu.openSettings();
  assert.ok(m.group.inputs.every(i => !i.disabled)); assert.ok(!m.group.classes.has('is-disabled'));
  m.fire('set-mute', 'change', { checked: true });
  assert.equal(m.gs.get('mute'), true); assert.ok(m.group.classes.has('is-disabled')); assert.ok(m.group.inputs.every(i => i.disabled));
  m.fire('set-mute', 'change', { checked: false });
  assert.ok(m.group.inputs.every(i => !i.disabled)); assert.ok(!m.group.classes.has('is-disabled'));
  m.fire('set-sfx-volume', 'input', { value: '75' });
  assert.equal(m.gs.get('sfxVolume'), 75); assert.equal(m.nodes['set-sfx-volume-value'].textContent, '75%');
  m.fire('set-music-volume', 'input', { value: '10' }); assert.equal(m.gs.get('musicVolume'), 10);
});
