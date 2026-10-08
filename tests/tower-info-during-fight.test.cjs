'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ui = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui.js'), 'utf8');
function fn(name) {
  const start = ui.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  return ui.slice(start, ui.indexOf('\n}', start) + 2);
}
function setup() {
  const snapshot = { tower: { active: false, highest: 34 }, runtime: {} };
  const view = { towerActive: false };
  const nodes = {};
  for (const id of ['tower-fight', 'tower-list-wrap', 'tower-tiers', 'tower-highest', 'tower-floors',
    'tower-detail', 'tower-actions', 'tower-result', 'tw-auto-count']) {
    nodes[id] = { style: {}, innerHTML: '', value: '5' };
  }
  const sent = [];
  const c = {
    Math, String, parseInt, UI: { towerBrowse: { sel: 35, tier: 'trial', lastHighest: 34 } },
    uiTowerPanelSnapshot: () => snapshot, uiHeaderPanelSnapshot: () => ({ player: { gold: 1000 } }),
    viewState: () => view, towerCanvasHudActive: () => c.canvas,
    canvas: true, TOWER_MAX_FLOOR: 150, $id: id => nodes[id],
    towerTierOf: () => ({ id: 'trial' }), towerTiers: () => [{ id: 'trial', start: 1, end: 50 }],
    towerTierTabsHTML: () => '<tabs>', towerFloorRowHTML: fl => '<floor>' + fl + '</floor>',
    towerDetailHTML: fl => '<boss-and-rewards>' + fl + '</boss-and-rewards>',
    bindTowerBossImageFallback() {}, setTextIfChanged(el, text) { el.textContent = text; },
    towerChallengeCost: () => 100, fmt: String, esc: String,
    nodePendingKey: () => 'node:tower', isUiCommandPending: () => c.pending, pending: false,
    sendUiCommand: (name, args) => { sent.push({ name, args }); return { catch() {} }; },
    switchTab() {}, reportUiCommandFailure() {}
  };
  vm.createContext(c);
  vm.runInContext(['pendingUiButtonAttributes', 'towerActionsHTML', 'renderTower', 'towerViewActive'].map(fn).join('\n'), c);
  const clickStart = ui.indexOf("    var tf = e.target.closest('[data-tower-floor]');");
  const clickEnd = ui.indexOf('\n  });', clickStart);
  assert.ok(clickStart >= 0 && clickEnd > clickStart);
  vm.runInContext('function towerClick(e) {\n' + ui.slice(clickStart, clickEnd) + '\n}', c);
  return { c, snapshot, view, nodes, sent, active(value) {
    snapshot.tower.active = value; view.towerActive = value;
  }, click(kind, disabled = false) {
    const button = { disabled, getAttribute: () => '35' };
    c.towerClick({ target: { closest: selector => selector === '[data-tower-' + kind + ']' ? button : null } });
  } };
}

test('Canvas 開戰保留樓層與 BOSS／獎勵資訊，兩個挑戰按鈕停用；退出後恢復', () => {
  const s = setup();
  s.c.renderTower();
  const details = s.nodes['tower-detail'].innerHTML;
  const floors = s.nodes['tower-floors'].innerHTML;
  s.active(true); s.c.renderTower();
  assert.equal(s.nodes['tower-fight'].style.display, 'none');
  assert.equal(s.nodes['tower-list-wrap'].style.display, '');
  assert.equal(s.nodes['tower-detail'].innerHTML, details);
  assert.equal(s.nodes['tower-floors'].innerHTML, floors);
  assert.equal((s.nodes['tower-actions'].innerHTML.match(/ disabled/g) || []).length, 2);
  assert.doesNotMatch(s.nodes['tower-actions'].innerHTML, /data-ui-pending-key/, 'pending 解除不可啟用戰鬥停用的按鈕');
  s.c.UI.towerBrowse.sel = 34; s.c.renderTower();
  assert.match(s.nodes['tower-detail'].innerHTML, />34</);
  assert.equal((s.nodes['tower-actions'].innerHTML.match(/ disabled/g) || []).length, 2);
  s.active(false); s.c.renderTower();
  assert.doesNotMatch(s.nodes['tower-actions'].innerHTML, / disabled/);
  assert.equal((s.nodes['tower-actions'].innerHTML.match(/data-ui-pending-key/g) || []).length, 2);
});

test('非戰鬥時仍受指令等待鎖保護，無 Canvas 的戰鬥保留原 DOM 與撤退入口', () => {
  const s = setup();
  s.c.pending = true; s.c.renderTower();
  assert.equal((s.nodes['tower-actions'].innerHTML.match(/ disabled/g) || []).length, 2);
  s.c.pending = false; s.active(true); s.c.canvas = false; s.c.renderTower();
  assert.equal(s.nodes['tower-fight'].style.display, '');
  assert.equal(s.nodes['tower-list-wrap'].style.display, 'none');
});

for (const kind of ['floor', 'auto']) {
  test(kind + '：停用／塔快照開戰／較新的 battle 開戰狀態皆不送指令，退出才可挑戰', () => {
    const s = setup();
    s.click(kind, true);
    s.snapshot.tower.active = true; s.click(kind);
    s.snapshot.tower.active = false; s.view.towerActive = true; s.click(kind);
    assert.equal(s.sent.length, 0);
    s.view.towerActive = false; s.click(kind);
    assert.equal(s.sent.length, 1);
    assert.equal(s.sent[0].name, kind === 'auto' ? 'tower.startAuto' : 'tower.start');
    assert.equal(s.sent[0].args.floor, 35);
    if (kind === 'auto') assert.equal(s.sent[0].args.count, 5);
  });
}
