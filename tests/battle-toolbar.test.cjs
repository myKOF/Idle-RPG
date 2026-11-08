'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function node() {
  const attrs = {}, classes = new Set(), listeners = {};
  return { attrs, classes, listeners, style: {}, checked: false,
    setAttribute(k, v) { attrs[k] = v; }, getAttribute(k) { return attrs[k]; },
    addEventListener(k, fn) { listeners[k] = fn; },
    classList: { toggle(k, on) { on ? classes.add(k) : classes.delete(k); } } };
}

test('場景內保留任務、狂暴、內測與原 HUD，操作按鈕僅在上方出現一次', () => {
  const html = read('index.html');
  const start = html.indexOf('<div class="battle-navigation">');
  const scene = html.indexOf('<div class="battle-scene-wrapper"', start);
  const end = html.indexOf('<div class="log-header">', scene);
  for (const id of ['btn-enemy-tip', 'btn-toggle-damage', 'btn-toggle-perf', 'btn-battle-mute', 'st-auto', 'btn-combat-pause', 'btn-battle-info', 'tch-flee', 'btn-battle-fullscreen', 'btn-pip']) {
    assert.equal(html.split('id="' + id + '"').length - 1, 1, id);
    assert.ok(html.slice(start, scene).includes('id="' + id + '"'), id);
    assert.ok(!html.slice(scene, end).includes('id="' + id + '"'), id);
  }
  for (const id of ['quest-bar', 'battle-frenzy', 'battle-fps', 'battle-camera-distance', 'battle-health-orb', 'battle-mana-orb', 'battle-buff-bar', 'battle-skill-bar']) {
    assert.ok(html.slice(scene, end).includes('id="' + id + '"'), id);
  }
  assert.match(html, /<button id="st-auto"[^>]*aria-pressed="true"[^>]*data-str="2433"/);
});

function stageSetup() {
  const button = node(); button.attrs['aria-pressed'] = 'true';
  const state = { pending: false, autoAdvance: true }, calls = [], errors = [];
  let resolve, reject;
  const c = { $id: id => id === 'st-auto' ? button : null, STR: id => String(id),
    nodePendingKey: id => 'node:' + id, isUiCommandPending: () => state.pending,
    UI: { stageHold: {} }, _stagePendingStage: null,
    peekUiPanelData: () => ({ stage: state }), uiCurrentZoneDef() {}, zoneIconHtml() {},
    setHtmlIfChanged() {}, setTextIfChanged() {},
    reportUiCommandFailure: (...args) => errors.push(args),
    sendUiCommand: (...args) => { calls.push(args); state.pending = true;
      return new Promise((yes, no) => { resolve = () => { state.pending = false; yes(); }; reject = () => { state.pending = false; no(Error('rejected')); }; }); }
  };
  const ui = read('js/ui.js');
  vm.createContext(c);
  vm.runInContext(ui.slice(ui.indexOf('function refreshStageAutoButton('), ui.indexOf('function refreshCombatPauseButton(')), c);
  c.initStageAutoButton();
  return { c, button, state, calls, errors, resolve: () => resolve(), reject: () => reject() };
}

test('AUTO 使用既有 Worker 指令、等待 header 期間擋重複與舊快照，完成後依權威狀態更新', async () => {
  const s = stageSetup();
  s.button.listeners.click.call(s.button);
  assert.equal(s.button.attrs['aria-pressed'], 'false');
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls[0])), ['stage.setAutoAdvance', { on: false }, { keys: ['node:stage-auto'], panels: ['battle', 'header'] }]);
  s.c.refreshStageDisplay(); s.button.listeners.click.call(s.button);
  assert.equal(s.button.attrs['aria-pressed'], 'false'); assert.equal(s.calls.length, 1);
  s.state.autoAdvance = false; s.resolve(); await Promise.resolve(); s.c.refreshStageDisplay();
  assert.equal(s.button.classes.has('active'), false);
  s.button.listeners.click.call(s.button);
  s.state.autoAdvance = true; s.resolve(); await Promise.resolve(); s.c.refreshStageDisplay();
  assert.equal(s.button.attrs['aria-pressed'], 'true'); assert.ok(s.button.classes.has('active'));
});

test('AUTO 指令失敗會恢復 header 狀態並回報原錯誤', async () => {
  const s = stageSetup(); s.button.listeners.click.call(s.button); s.reject(); await Promise.resolve();
  assert.equal(s.button.attrs['aria-pressed'], 'true'); assert.equal(s.errors.length, 1);
});

test('靜音快捷鍵與設置雙向同步、音量停用及本機持久化，取消靜音保留音量', () => {
  const button = node(), box = node(), input = node(), group = node(), store = new Map();
  group.querySelectorAll = () => [input];
  const nodes = { 'game-menu': node(), 'btn-battle-mute': button, 'set-mute': box, 'settings-audio-group': group };
  for (const id of ['game-menu-reload', 'game-menu-exit', 'game-menu-save', 'game-menu-settings', 'game-menu-close', 'settings-modal', 'settings-modal-close']) nodes[id] = node();
  const c = { localStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) },
    document: { getElementById: id => nodes[id] || null, addEventListener() {} }, window: { addEventListener() {} } };
  vm.createContext(c); vm.runInContext(read('js/game-settings.js') + '\n' + read('js/game-menu.js'), c);
  c.GameSettings.set('musicVolume', 31); c.GameSettings.set('sfxVolume', 72); c.GameSettings.set('mute', true);
  c.GameMenu.init();
  assert.equal(button.attrs['aria-pressed'], 'true'); assert.equal(box.checked, true); assert.equal(input.disabled, true);
  button.listeners.click();
  assert.equal(c.GameSettings.get('mute'), false); assert.equal(box.checked, false); assert.equal(input.disabled, false);
  box.checked = true; box.listeners.change.call(box);
  assert.equal(button.attrs['aria-pressed'], 'true'); assert.equal(c.GameSettings.sfxGain(), 0);
  assert.equal(JSON.parse(store.get('idle-rpg.gameSettings.v1')).mute, true);
  c.GameSettings.set('mute', false);
  assert.equal(button.attrs['aria-pressed'], 'false');
  assert.equal(c.GameSettings.get('musicVolume'), 31); assert.equal(c.GameSettings.get('sfxVolume'), 72);
});
