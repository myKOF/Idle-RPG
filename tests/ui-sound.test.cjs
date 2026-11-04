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
    createBufferSource() {
      const voice = { connect() {}, disconnect() {}, stop() { this.stopped = true; }, start() { played.push(this.buffer.url); } };
      voices.push(voice); return voice;
    }
  }
  const c = {
    performance: { now: () => clock },
    document: { hidden: false, addEventListener: (name, fn) => { handlers[name] = fn; } },
    window: { AudioContext: options.unsupported ? undefined : AudioContext, addEventListener: (name, fn) => { handlers[name] = fn; } },
    fetch: async url => { requests.push(url); if (options.fail) throw new Error('unavailable'); return { ok: true, arrayBuffer: async () => ({ url }) }; },
    UI: {}
  };
  vm.createContext(c); vm.runInContext(source, c);
  function node(kind = 'button', parent = null) {
    const n = { kind, parent, closest(selectors) {
      if (selectors.startsWith('[hidden]')) return null;
      for (let current = this; current; current = current.parent) {
        if (selectors.split(', ').includes(current.kind)) return current;
      }
      return null;
    } };
    return n;
  }
  return { c, requests, played, voices, node, advance: ms => { clock += ms; }, created: () => created,
    fire(name, values = {}) { handlers[name]({ isTrusted: true, pointerType: 'mouse', buttons: 0, clientX: clock, clientY: 10, target: node(), ...values }); } };
}

test('no autoplay or unapproved fetch; first real gesture loads exactly the two approved WAVs', async () => {
  const s = mount();
  s.fire('pointerover'); s.fire('pointerdown', { isTrusted: false });
  await settle(); assert.equal(s.created(), 0); assert.deepEqual(s.requests, []);
  s.fire('pointerdown'); await settle();
  assert.equal(s.created(), 1); assert.equal(s.played.length, 0);
  assert.deepEqual(s.requests.map(url => url.split('?')[0]), ['audio/ui-preview/01-hover.wav', 'audio/ui-preview/05-success.wav']);
  s.fire('keydown'); await settle(); assert.equal(s.created(), 1); assert.equal(s.requests.length, 2);
});

test('delegation keeps ordinary controls and help icons audible; child movement and stationary repaint stay silent', async () => {
  const s = mount(); s.fire('pointerdown'); await settle();
  for (const kind of ['button', '.tab-btn', '.pg-help', '.forge-info-btn', '#btn-enemy-tip', '#btn-boss-tip', '#btn-tower-result-boss-tip', '.tlx-tier', '.tower-floor', '.save-row']) {
    s.advance(100); const anchor = s.node(kind), child = s.node('span', anchor);
    s.fire('pointerover', { target: child }); await settle();
    const count = s.played.length;
    s.advance(100); s.fire('pointerover', { target: anchor, relatedTarget: child }); await settle(); assert.equal(s.played.length, count);
    s.fire('pointerover', { target: s.node(kind) }); await settle(); assert.equal(s.played.length, count);
  }
  assert.equal(s.played.length, 10);
  const anchor = s.node('button'), icon = s.node('span', anchor), closest = icon.closest;
  icon.closest = function (selectors) { return selectors.includes('[aria-hidden="true"]') ? this : closest.call(this, selectors); };
  s.advance(100); s.fire('pointerover', { target: icon }); await settle();
  assert.equal(s.played.length, 11, 'decorative aria-hidden icon must retain its visible button hover');
  assert.ok(s.played.every(url => url.includes('01-hover')));
  assert.ok(s.voices.slice(0, -1).every(voice => voice.stopped));
});

test('all ordinary tips and item cards stay silent for hover, keyboard and touch, including nested native buttons', async () => {
  const s = mount(); s.fire('keydown'); await settle();
  for (const kind of ['[data-tip]', '[data-tt-title]', '[data-tt-desc]', '[title]:not([title=""])',
    '.item-cell', '.eq-slot.filled', '.forge-slot.filled', '.act-btn-tooltip', '[data-sk]', '[data-buff-tip]',
    '.gem-inventory-cell', '.gem-chip', '.socket.filled', '.gres-gem', '.gres-hole', '.equip-material-icon',
    '.sgb-item', '.gx-item', '.gx-chip', '.rx-card', '.rx-use', '.talent-icon', '.battle-buff-badge']) {
    const card = s.node(kind), child = s.node('button', card), icon = s.node('span', child);
    s.advance(200); s.fire('pointerover', { target: icon });
    s.fire('keydown'); s.fire('focusin', { target: child });
    s.fire('pointerdown', { target: child, pointerType: 'touch' });
    await settle(); assert.equal(s.played.length, 0, kind);
  }
  for (const kind of ['.pg-help', '.forge-info-btn', '#btn-enemy-tip']) {
    const help = s.node(kind, s.node('[data-tip]'));
    s.advance(200); s.fire('pointerover', { target: s.node('span', help) }); await settle();
  }
  assert.equal(s.played.length, 3, 'interface explanation icons take precedence over tip silence');
});

test('background, scroll, drag, static content and rapid movement do not create sound storms', async () => {
  const options = {}, s = mount(options); s.fire('pointerdown'); await settle();
  s.fire('pointerover'); await settle(); assert.equal(s.played.length, 1);
  s.advance(10); s.fire('pointerover'); await settle(); assert.equal(s.played.length, 1);
  for (const values of [{ buttons: 1 }, { isTrusted: false }, { target: s.node('p') }]) {
    s.advance(100); s.fire('pointerover', values);
  }
  s.c.UI.panelScrolling = true; s.advance(100);
  s.fire('pointerover', { target: s.node('button', s.node('#workspace-area main')) });
  s.c.UI.inventoryScrolling = true; s.advance(100);
  s.fire('pointerover', { target: s.node('.item-cell', s.node('#inventory-grid')) });
  await settle(); assert.equal(s.played.length, 1);
  s.c.document.hidden = true; s.fire('visibilitychange'); assert.ok(s.voices[0].stopped);
  s.c.UISound.commandResult('item.upgrade', 'ok'); await settle(); assert.equal(s.played.length, 1);
});

test('keyboard focus and touch use the hover sample without adding a click sound', async () => {
  const s = mount(), anchor = s.node('button'); s.fire('keydown'); await settle();
  s.fire('focusin', { target: anchor }); await settle(); assert.equal(s.played.length, 1);
  s.advance(150); s.fire('pointerdown', { target: anchor }); s.fire('focusin', { target: anchor });
  await settle(); assert.equal(s.played.length, 1);
  s.advance(150); s.fire('pointerdown', { target: anchor, pointerType: 'touch' });
  s.fire('pointerover', { target: anchor, pointerType: 'touch' }); await settle(); assert.equal(s.played.length, 2);
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
  s.c.fetch = url => new Promise(resolve => { if (url.includes('01-hover')) resolveFetch = resolve; });
  s.fire('pointerdown'); await settle(); s.fire('pointerover'); s.advance(300);
  resolveFetch({ ok: true, arrayBuffer: async () => ({ url: 'late-hover' }) });
  await settle(); assert.equal(s.played.length, 0);
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
  for (const name of ['01-hover.wav', '05-success.wav']) {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'audio/ui-preview', name))).digest('hex');
    assert.equal(digest, manifest.files.find(file => file.file === name).sha256);
    assert.ok(source.includes(name + '?v=' + digest.slice(0, 12)));
  }
  for (const name of ['02-click.wav', '03-reroll.wav', '04-divine-forge.wav', '06-failure.wav', '00-all-preview.wav']) assert.ok(!source.includes(name));
});
