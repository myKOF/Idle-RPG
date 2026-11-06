'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/ui-sound.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

function mount(options = {}) {
  const handlers = {}, requests = [], played = [], voices = [];
  let clock = 1000, created = 0;
  class AudioContext {
    constructor() { this.state = 'suspended'; this.destination = {}; created++; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    decodeAudioData(bytes) { return Promise.resolve({ url: bytes.url }); }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createBufferSource() {
      const voice = { connect() {}, disconnect() {}, stop() { this.stopped = true; }, start() { played.push(this.buffer.url); } };
      voices.push(voice); return voice;
    }
  }
  const c = {
    performance: { now: () => clock },
    document: { hidden: false, addEventListener: (name, fn) => { handlers[name] = fn; } },
    window: { AudioContext: options.unsupported ? undefined : AudioContext, addEventListener: (name, fn) => { handlers[name] = fn; } },
    fetch: async url => { requests.push(url); if (options.fail) throw new Error('unavailable'); return { ok: true, arrayBuffer: async () => ({ url }) }; }
  };
  vm.createContext(c); vm.runInContext(source, c);
  function node(kind = 'button', parent = null, aliases = []) {
    const n = { kind, parent, aliases, id: [kind, ...aliases].find(s => s.startsWith('#'))?.slice(1), closest(selectors) {
      if (selectors.startsWith('[hidden]')) return null;
      for (let current = this; current; current = current.parent) {
        if (selectors.split(', ').some(s => s === current.kind || current.aliases.includes(s))) return current;
      }
      return null;
    } };
    return n;
  }
  return { c, requests, played, voices, node, advance: ms => { clock += ms; }, created: () => created,
    fire(name, values = {}) { handlers[name]?.({ isTrusted: true, pointerType: 'mouse', buttons: 0, clientX: clock, clientY: 10, target: node(), ...values }); } };
}

test('no autoplay or unapproved fetch; first real gesture loads exactly the three approved WAVs', async () => {
  const s = mount();
  s.fire('pointerover'); s.fire('pointerdown', { isTrusted: false });
  await settle(); assert.equal(s.created(), 0); assert.deepEqual(s.requests, []);
  s.fire('pointerdown'); await settle();
  assert.equal(s.created(), 1); assert.equal(s.played.length, 0);
  assert.deepEqual(s.requests.map(url => url.split('?')[0]), ['audio/ui-preview/hover-options-v5/H10.wav', 'audio/ui-preview/05-success.wav', 'audio/achievements/mixkit-game-level-completed-2059.wav']);
  s.fire('keydown'); await settle(); assert.equal(s.created(), 1); assert.equal(s.requests.length, 3);
});

test('achievement sound skips locked and hidden notifications, never replays them, and stops in background', async () => {
  const s = mount();
  s.c.UISound.achievementUnlocked(); await settle(); assert.equal(s.created(), 0);
  s.fire('pointerdown'); await settle(); assert.equal(s.played.length, 0);
  s.c.UISound.achievementUnlocked(); await settle(); assert.equal(s.played.length, 1);
  assert.ok(s.played[0].includes('mixkit-game-level-completed-2059.wav'));
  s.c.document.hidden = true; s.fire('visibilitychange'); assert.ok(s.voices[0].stopped);
  s.advance(4000); s.c.UISound.achievementUnlocked(); await settle(); assert.equal(s.played.length, 1);
  s.c.document.hidden = false; s.fire('visibilitychange'); s.fire('keydown'); await settle(); assert.equal(s.played.length, 1);
  s.c.UISound.achievementUnlocked(); await settle(); assert.equal(s.played.length, 2);
});

test('late achievement decoding and unavailable audio never block the notification or replay stale sound', async () => {
  for (const options of [{ unsupported: true }, { fail: true }]) {
    const s = mount(options); s.fire('pointerdown'); assert.doesNotThrow(() => s.c.UISound.achievementUnlocked());
    await settle(); assert.equal(s.played.length, 0);
  }
  const s = mount(); let release;
  s.c.fetch = url => new Promise(resolve => { if (url.includes('mixkit')) release = () => resolve({ ok: true, arrayBuffer: async () => ({ url }) }); });
  s.fire('pointerdown'); await settle(); s.c.UISound.achievementUnlocked(); s.advance(1000); release();
  await settle(); assert.equal(s.played.length, 0);
  s.c.UISound.achievementUnlocked(); await settle(); assert.equal(s.played.length, 1);
});

test('H10 plays on real activation only, with passive tips, disabled, synthetic, secondary and background clicks silent', async () => {
  const s = mount(); s.fire('pointerdown'); await settle();
  assert.equal(s.played.length, 0, 'pressing without completing a click must not play H10');
  for (const kind of ['button', '[data-nf-partinstall-key]', '.item-cell[data-id]', '[data-reroll-pick]']) {
    s.advance(200); s.fire('click', { target: s.node('span', s.node(kind, s.node('[data-tip]'))), button: 0 }); await settle();
  }
  assert.equal(s.played.length, 4); assert.ok(s.played.every(url => url.includes('/H10.wav')));
  const disabled = s.node('button'); disabled.disabled = true;
  for (const values of [{ target: s.node('[data-tip]') }, { target: disabled }, { isTrusted: false }, { button: 1 }, { button: 2 }]) {
    s.advance(200); s.fire('click', values); await settle();
  }
  assert.equal(s.played.length, 4);
  s.advance(200); s.fire('keydown', { key: 'Enter' }); s.fire('click', { detail: 0, button: 0 }); await settle();
  assert.equal(s.played.length, 5, 'native keyboard activation delivers one trusted click');
  s.c.document.hidden = true; s.fire('click', { button: 0 }); await settle(); assert.equal(s.played.length, 5);
});

test('pointer entry, keyboard focus and touch press stay silent across the former hover scopes', async () => {
  const s = mount(); s.fire('pointerdown'); await settle();
  const controls = [
    ['tabs', '[data-tab="equip"]'], ['tab-equip', '[data-act="upgrade"]'],
    ['tab-skills', '[data-skill2-learn]'], ['tab-newforge', '#nf-add-btn'],
    ['tab-gems', '#fuse-btn'], ['tab-tower', '[data-tower-floor]'],
    ['tab-forge', '#forge-go'], ['settings-modal', '#settings-tab-audio']
  ];
  for (const [scope, marker] of controls) {
    const target = s.node('span', s.node('button', s.node('#' + scope), [marker]));
    for (const event of ['pointerover', 'focusin', 'pointerdown']) {
      s.advance(200);
      if (event === 'focusin') s.fire('keydown', { key: 'Tab' });
      s.fire(event, { target, pointerType: event === 'pointerdown' ? 'touch' : 'mouse' });
      await settle();
      assert.deepEqual(s.played, [], scope + ':' + event);
    }
  }
  const target = s.node('button', s.node('#tabs'));
  s.fire('click', { target, button: 0, pointerType: 'touch' }); await settle();
  assert.deepEqual(s.played.map(url => url.split('?')[0]), ['audio/ui-preview/hover-options-v5/H10.wav']);
});

test('clicks on enabled label descendants play H10 while unassociated or disabled labels stay silent', async () => {
  const s = mount();
  const label = s.node('label'); label.tagName = 'LABEL';
  const target = s.node('span', label);
  s.fire('click', { target }); await settle(); assert.equal(s.played.length, 0);
  label.control = s.node('input:not([type="hidden"])', label);
  label.control.disabled = true;
  s.fire('click', { target }); await settle(); assert.equal(s.played.length, 0);
  label.control.disabled = false;
  s.fire('click', { target }); await settle(); assert.equal(s.played.length, 1);
  assert.ok(s.played[0].includes('/H10.wav'));
});

test('success sample is restricted to actual upgrade ok and accepted reroll, including wrapped results', async () => {
  const s = mount(); s.fire('pointerdown'); await settle();
  for (const [name, result] of [['item.upgrade', 'ok'], ['item.rerollAffix', null], ['item.upgrade', { result: 'ok' }], ['item.rerollAffix', { result: null }]]) {
    s.c.UISound.commandResult(name, result); await settle(); s.advance(200);
  }
  assert.equal(s.played.length, 4);
  for (const name of ['item.upgrade', 'item.rerollAffix', 'forge.start', 'forge.result', 'task.claim', 'item.equip']) {
    for (const result of ['fail', 'poor', false, undefined, { err: 'rejected' }, 'resource error']) {
      s.advance(200); s.c.UISound.commandResult(name, result);
    }
  }
  s.c.UISound.commandResult('forge.start', null); await settle(); assert.equal(s.played.length, 4);
  assert.ok(s.played.every(url => url.includes('05-success')));
});

test('unsupported audio, load failure and late decoding never block UI or replay stale actions', async () => {
  for (const options of [{ unsupported: true }, { fail: true }]) {
    const s = mount(options); s.fire('pointerdown'); s.c.UISound.commandResult('item.upgrade', 'ok'); await settle(); assert.equal(s.played.length, 0);
  }
  const s = mount();
  let resolveFetch;
  s.c.fetch = url => {
    if (!url.includes('/H10.wav')) return Promise.resolve({ ok: true, arrayBuffer: async () => ({ url }) });
    return new Promise(resolve => { resolveFetch = () => resolve({ ok: true, arrayBuffer: async () => ({ url }) }); });
  };
  s.fire('click', { button: 0 }); await settle(); s.advance(300);
  resolveFetch(); await settle(); assert.equal(s.played.length, 0);
  s.fire('click', { button: 0 }); await settle(); assert.equal(s.played.length, 1);
});

test('detailAction waits for accepted Worker results; rejection, missing resources and missing affix never sound', async () => {
  const start = ui.indexOf('function detailAction('), end = ui.indexOf('\nfunction salvageAllUnlocked(', start);
  for (const [act, result, expected] of [['upgrade', 'ok', 1], ['upgrade', 'fail', 0], ['upgrade', 'poor', 0], ['reroll-affix', null, 1], ['reroll-affix', 'resource error', 0]]) {
    const heard = [];
    let resolve;
    const c = { UI: {}, it: { id: 'gear', affixes: [{ key: 'atk' }] }, AFFIX_POOL: { atk: {} },
      findSelItem() { return this.it; }, uiHeaderPanelSnapshot: () => ({ player: {} }),
      equipRerollModeFor: () => ({ selIdx: 0 }), isUiCommandPending: () => false, itemPendingKey: () => 'gear',
      sendUiCommand: () => new Promise(r => { resolve = r; }),
      UISound: { commandResult: (name, value) => { if ((name === 'item.upgrade' && value === 'ok') || (name === 'item.rerollAffix' && value === null)) heard.push(name); } },
      showFloatingText() {}, reportUiCommandFailure() {}, triggerUpgradeNumberAnimation() {},
      hasOwnUiState: (obj, key) => Object.prototype.hasOwnProperty.call(obj, key), STR: String };
    // findSelItem is called as a global function, not a method on this fixture.
    c.findSelItem = () => c.it;
    vm.createContext(c);
    const errorStart = ui.indexOf('function uiCommandResultError('), errorEnd = ui.indexOf('\nfunction requestUiPanels', errorStart);
    vm.runInContext(ui.slice(errorStart, errorEnd) + '\n' + ui.slice(start, end), c);
    c.detailAction(act, {}); assert.deepEqual(heard, []);
    resolve(result); await settle(); assert.equal(heard.length, expected, act + ':' + result);
    c.it = null; c.detailAction(act, {}); assert.equal(heard.length, expected);
  }
});

test('runtime loads only approved immutable originals and the versioned sound module precedes UI', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.indexOf('js/ui-sound.js?v=') < html.indexOf('js/ui.js?v='));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'audio/ui-preview/manifest.json')));
  const crypto = require('node:crypto');
  const success = '05-success.wav';
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'audio/ui-preview', success))).digest('hex');
  assert.equal(digest, manifest.files.find(file => file.file === success).sha256);
  assert.ok(source.includes(success + '?v=' + digest.slice(0, 12)));
  for (const name of ['01-hover.wav', '02-click.wav', '03-reroll.wav', '04-divine-forge.wav', '06-failure.wav', '00-all-preview.wav']) assert.ok(!source.includes(name));
  const h10 = fs.readFileSync(path.join(root, 'audio/ui-preview/hover-options-v5/H10.wav'));
  const h10Hash = crypto.createHash('sha256').update(h10).digest('hex');
  assert.equal(h10Hash, '338a16bc9ce91a90b3b081e25e93306b5830eefa05fbba780c85d8f9f94b9f37');
  assert.ok(source.includes('H10.wav?v=' + h10Hash.slice(0, 12)));
  for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'H6', 'H7', 'H8', 'H9']) assert.ok(!source.includes(id + '.wav'));
});
