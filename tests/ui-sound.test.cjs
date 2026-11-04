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
    fire(name, values = {}) { handlers[name]({ isTrusted: true, pointerType: 'mouse', buttons: 0, clientX: clock, clientY: 10, target: node(), ...values }); } };
}

test('no autoplay or unapproved fetch; first real gesture loads exactly the four approved WAVs', async () => {
  const s = mount();
  s.fire('pointerover'); s.fire('pointerdown', { isTrusted: false });
  await settle(); assert.equal(s.created(), 0); assert.deepEqual(s.requests, []);
  s.fire('pointerdown'); await settle();
  assert.equal(s.created(), 1); assert.equal(s.played.length, 0);
  assert.deepEqual(s.requests.map(url => url.split('?')[0]), ['audio/ui-preview/01-hover.wav', 'audio/ui-preview/hover-options-v5/H10.wav', 'audio/ui-preview/05-success.wav', 'audio/achievements/mixkit-game-level-completed-2059.wav']);
  s.fire('keydown'); await settle(); assert.equal(s.created(), 1); assert.equal(s.requests.length, 4);
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

test('nine requested hover scopes apply equally to pointer, keyboard and touch while H10 clicks stay functional', async () => {
  const s = mount(); s.fire('pointerdown'); await settle();
  s.c.uiForgePanelSnapshot = () => ({ occupied: 0 });
  s.c.forgeViewState = snap => snap;
  s.c.forgeViewItemCount = forge => forge.occupied;
  const cases = [];
  const add = (scope, allowed, markers) => markers.forEach(marker => cases.push({ scope, allowed, marker }));
  add('tabs', true, ['char', 'equip', 'skills', 'newforge', 'gems', 'runes', 'tower', 'talents', 'forge'].map(tab => '[data-tab="' + tab + '"]'));
  add('tab-equip', true, ['upgrade', 'toggle-reroll', 'reroll-affix', 'toggle-socket', 'toggle-rune', 'engrave-rune'].map(act => '[data-act="' + act + '"]'));
  add('tab-equip', false, ['[data-act="equip"]', '[data-act="unequip"]', '.item-cell[data-id]', '.eq-slot', '[data-reroll-pick]', '[data-socket-pick]', '[data-gem-socket]', '[data-rune-socket]', '[data-rune-erase]', '[data-eqset]', '#inv-sort', '#inv-filter-btn', '.pg-help']);
  add('tab-skills', true, ['[data-skill2-learn]', '[data-skill2-max]', '[data-skill2-downgrade]', '[data-skill2-delete]']);
  add('tab-skills', false, ['[data-sgb-group]', '[data-sgb-filter]', '[data-sgb-tier]', '[data-sgb-ult]', '[data-skill-equip]', '[data-skill-unequip]', '[data-skill2-ultpick]', '[data-skill2-ultswitch]', '[data-sg-max-group]', '#skill-unlock-toggle']);
  add('tab-newforge', true, ['#nf-add-btn', '[data-nf-partupgrade]', '[data-nf-partinstall-key]', '[data-nf-partun]', '[data-nf-partsopen]', '#btn-newforge-log-detail', '.pg-help']);
  add('tab-gems', true, ['#fuse-btn', '#fuse-all-btn']);
  add('tab-gems', false, ['[data-gem-pick]', '[data-gem-lv]', '[data-gem-filter]', '[data-gem-tool-btn]', '[data-shop-buy]', '[data-gres-upgrade]', '[data-gres-hole]', '#gem-owned-only', '.pg-help']);
  add('tab-runes', false, ['[data-rune-pick]', '[data-rune-act]', '[data-rune-tier]', '[data-rune-tool-btn]', '[data-word-goto]', '#rune-ready-only', '.pg-help']);
  add('tab-tower', true, ['[data-tower-floor]']);
  add('tab-tower', false, ['[data-tower-pick]', '[data-tower-tier]', '[data-tower-auto]', '#tower-flee', '#btn-boss-tip', '.pg-help']);
  add('tower-result-modal', false, ['#btn-tower-result-boss-tip', '#tower-result-close']);
  add('tower-canvas-hud', false, ['#tch-flee']);
  add('tab-talents', false, ['[data-talent-select]', '[data-talent-turn]', '#talent-upgrade', '.pg-help']);
  add('tab-forge', true, ['#forge-go', '#forge-unload', '#forge-auto']);
  add('tab-forge', false, ['#forge-mode-equip', '#forge-mode-ancient', '#forge-mode-gem', '#forge-mode-imprint', '[data-forge-quality]', '#forge-equipped-tab', '#forge-stone-plus', '#forge-stone-minus', '[data-forge-slot]', '[data-forge-gem]', '.item-cell[data-id]', '#inv-sort', '.pg-help', '[data-act="upgrade"]']);
  for (const { scope, allowed, marker } of cases) {
    const anchor = s.node('button', s.node('#' + scope), [marker]), child = s.node('span', anchor);
    for (const event of ['pointerover', 'focusin', 'pointerdown']) {
      s.advance(200); const before = s.played.length;
      if (event === 'focusin') s.fire('keydown');
      s.fire(event, { target: child, pointerType: event === 'pointerdown' ? 'touch' : 'mouse' }); await settle();
      assert.equal(s.played.length - before, Number(allowed), scope + ':' + marker + ':' + event);
      if (allowed) assert.ok(s.played.at(-1).includes('01-hover.wav'));
    }
    s.advance(200); const beforeClick = s.played.length; s.fire('click', { target: child, button: 0 }); await settle();
    assert.equal(s.played.length, beforeClick + 1, 'H10 remains audible: ' + scope + ':' + marker);
    assert.ok(s.played.at(-1).includes('/H10.wav'));
  }
});

test('hover rules follow relocated inventory and current forge fill/unload function; switch labels normalize to controls', async () => {
  const s = mount(); s.fire('pointerdown'); await settle();
  let occupied = 0;
  s.c.uiForgePanelSnapshot = () => ({ occupied }); s.c.forgeViewState = snap => snap; s.c.forgeViewItemCount = forge => forge.occupied;
  const forge = s.node('#tab-forge'), fill = s.node('button', forge, ['#forge-unload']);
  s.fire('pointerover', { target: fill }); await settle(); assert.equal(s.played.length, 1);
  occupied = 1; s.advance(200); s.fire('pointerover', { target: fill }); await settle(); assert.equal(s.played.length, 1);
  s.fire('click', { target: fill, button: 0 }); await settle(); assert.equal(s.played.length, 2, 'unload still has H10');
  occupied = 0; s.advance(200); s.fire('pointerover', { target: fill }); await settle(); assert.equal(s.played.length, 3);
  const inventory = s.node('#inv-section-box', s.node('#tab-equip'));
  const item = s.node('.item-cell[data-id]', inventory), child = s.node('span', item);
  for (const scope of ['tab-equip', 'tab-forge']) {
    inventory.parent = s.node('#' + scope); s.advance(200); s.fire('pointerover', { target: child }); await settle(); assert.equal(s.played.length, 3, scope);
  }
  const label = s.node('label', forge); label.tagName = 'LABEL';
  label.control = s.node('input:not([type="hidden"])', label, ['#forge-auto']);
  s.advance(200); s.fire('pointerover', { target: s.node('span', label) }); await settle(); assert.equal(s.played.length, 4);
  s.advance(200); s.fire('pointerover', { target: label.control, relatedTarget: label }); await settle(); assert.equal(s.played.length, 4);
  label.control.disabled = true; s.advance(200); s.fire('pointerover', { target: label }); await settle(); assert.equal(s.played.length, 4);
  label.control.disabled = false; label.parent = s.node('#tab-runes'); s.advance(200); s.fire('pointerdown', { target: label, pointerType: 'touch' }); await settle(); assert.equal(s.played.length, 4);
});

test('delegation keeps ordinary controls and help icons audible; child movement and stationary repaint stay silent', async () => {
  const s = mount(); s.fire('pointerdown'); await settle();
  for (const kind of ['button', '.tab-btn', '.pg-help', '.forge-info-btn', '#btn-enemy-tip', '#btn-boss-tip', '#btn-tower-result-boss-tip', '[data-talent-turn]', '[data-tower-pick]', '[data-load-save]']) {
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

test('only passive tips stay silent; an actual action inside tips remains audible for hover, keyboard and touch', async () => {
  const s = mount(); s.fire('keydown'); await settle();
  for (const kind of ['[data-tip]', '[data-tt-title]', '[data-tt-desc]', '[title]:not([title=""])',
    '[data-sk]', '[data-buff-tip]', '[data-enemy-buff-tip]', '[data-talent-tip]',
    '.nf-fart', '.nf-pu-row', '.equip-material-icon', '.res', '.battle-buff-badge']) {
    const card = s.node(kind), child = s.node('span', card), icon = s.node('span', child);
    s.advance(200); s.fire('pointerover', { target: icon });
    s.fire('keydown'); s.fire('focusin', { target: child });
    s.fire('pointerdown', { target: child, pointerType: 'touch' });
    await settle(); assert.equal(s.played.length, 0, kind);
  }
  const actions = ['button', '.pg-help', '.forge-info-btn', '#btn-enemy-tip', '.item-cell[data-id]',
    '.eq-slot', '[data-nf-partinstall-key]', '[data-nf-partupgrade]', '[data-nf-partsopen]', '[data-nf-partun]',
    '[data-nf-unlockslot]', '[data-reroll-pick]', '[data-socket-pick]', '[data-gres-hole]', '[data-rune-pick]'];
  for (const kind of actions) {
    const action = s.node(kind, s.node('[data-tip]'));
    for (const event of ['pointerover', 'focusin', 'pointerdown']) {
      s.advance(200);
      if (event === 'focusin') s.fire('keydown');
      s.fire(event, { target: s.node('span', action), pointerType: event === 'pointerdown' ? 'touch' : 'mouse' });
      await settle();
    }
  }
  assert.equal(s.played.length, actions.length * 3, 'tips cannot suppress real controls and their descendants');
});

test('disabled controls and decorative cards stay silent; associated labels share their enabled control', async () => {
  const s = mount(); s.fire('pointerdown'); await settle();
  const disabled = s.node('button'); disabled.disabled = true;
  const ariaDisabled = s.node('[role="button"]'); ariaDisabled.matches = () => true;
  const label = s.node('label'); label.tagName = 'LABEL';
  for (const node of [disabled, ariaDisabled, label, s.node('.save-row'), s.node('.nf-pu-row')]) {
    s.advance(200); s.fire('pointerover', { target: node }); await settle(); assert.equal(s.played.length, 0);
  }
  label.control = s.node('input:not([type="hidden"])'); label.control.disabled = true;
  s.advance(200); s.fire('pointerover', { target: s.node('span', label) }); await settle(); assert.equal(s.played.length, 0);
  label.control.disabled = false;
  s.advance(200); s.fire('pointerover', { target: s.node('span', label) }); await settle(); assert.equal(s.played.length, 1);
  s.advance(200); s.fire('pointerover', { target: label.control, relatedTarget: label }); await settle();
  assert.equal(s.played.length, 1, 'label track and input share one interaction target');
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
  const h10 = fs.readFileSync(path.join(root, 'audio/ui-preview/hover-options-v5/H10.wav'));
  const h10Hash = crypto.createHash('sha256').update(h10).digest('hex');
  assert.equal(h10Hash, '338a16bc9ce91a90b3b081e25e93306b5830eefa05fbba780c85d8f9f94b9f37');
  assert.ok(source.includes('H10.wav?v=' + h10Hash.slice(0, 12)));
  for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'H6', 'H7', 'H8', 'H9']) assert.ok(!source.includes(id + '.wav'));
});
