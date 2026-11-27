'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createEngine } = require('../scripts/sim/engine');
const ui = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');

function harness() {
  const engine = createEngine({ seed: 81 }).boot();
  const c = engine.ctx;
  const badge = { hidden: true, textContent: '', attrs: {},
    getAttribute(k) { return this.attrs[k]; },
    setAttribute(k, v) { this.attrs[k] = v; } };
  c.$id = id => id === 'forge-chest-badge' ? badge : null;
  for (const name of ['setTextIfChanged', 'setAttrIfChanged', 'updateForgeChestBadge']) {
    const start = ui.indexOf('function ' + name + '(');
    vm.runInContext(ui.slice(start, ui.indexOf('\n}', start) + 2), c);
  }
  return { engine, c, badge };
}

test('未開寶箱加總各品質，排除經驗、歷史開箱數與未知編號，讀取不改原資料', () => {
  const { c, badge } = harness();
  const player = { chests: Object.fromEntries(Array.from(c.CHESTS, (def, i) =>
    [def.id, { n: i + 1, xp: 999999, opened: 9999, on: false }])), chestOpened: 8888 };
  player.chests.unknown = { n: 9999 };
  const before = JSON.stringify(player);
  c.updateForgeChestBadge(player);
  const total = c.CHESTS.length * (c.CHESTS.length + 1) / 2;
  assert.equal(badge.textContent, String(total));
  assert.equal(badge.hidden, false);
  assert.equal(badge.attrs['aria-label'], c.STR(2584, c.fmtFull(total)));
  assert.equal(JSON.stringify(player), before);
});

test('0隱藏，1與999完整顯示，1000起999+且讀屏保留完整數量', () => {
  const { c, badge } = harness();
  const id = c.CHESTS[0].id;
  for (const [n, expected] of [[0, '0'], [1, '1'], [999, '999'], [1000, '999+'], [9999, '999+'], [0, '0']]) {
    c.updateForgeChestBadge({ chests: { [id]: { n } } });
    assert.equal(badge.textContent, expected);
    assert.equal(badge.hidden, n === 0);
    assert.equal(badge.attrs['aria-label'], c.STR(2584, c.fmtFull(n)));
  }
  c.updateForgeChestBadge({ chests: Object.fromEntries(Array.from(c.CHESTS, d => [d.id, { n: c.CHEST_MAX_COUNT }])) });
  assert.equal(badge.textContent, '999+');
  assert.equal(badge.attrs['aria-label'], c.STR(2584, c.fmtFull(c.CHEST_MAX_COUNT * c.CHESTS.length)));
});

test('舊檔缺資料與異常數值沿chestEntry正規化，沒有圖示也安全', () => {
  const { c, badge } = harness();
  for (const player of [undefined, {}, { chests: {} }]) {
    c.updateForgeChestBadge(player);
    assert.equal(badge.hidden, true);
  }
  const values = [-9, NaN, '3.9', null, 100000];
  const player = { chests: Object.fromEntries(Array.from(c.CHESTS, (d, i) => [d.id, { n: values[i] }])) };
  c.updateForgeChestBadge(player);
  const total = Array.from(c.CHESTS, d => c.chestEntry(d, player.chests[d.id]).n).reduce((a, b) => a + b, 0);
  assert.equal(total, 10002);
  assert.equal(badge.attrs['aria-label'], c.STR(2584, c.fmtFull(total)));
  c.$id = () => null;
  assert.doesNotThrow(() => c.updateForgeChestBadge(player));
});

test('真正拆解經驗換箱才通知header，開箱指令扣數後角標隱藏，快照不改存檔', () => {
  const { c, badge, engine } = harness();
  const original = c.CHESTS[0];
  const def = { ...original, init: true, levels: [{ ...original.levels[0],
    need: 2, xp: Array(c.RARITIES.length).fill(1), rolls: 1, drops: [{ k: 'gold', q: [1, 1], w: 100 }] }] };
  c.CHESTS = [def]; c.CHEST_BY_ID = { [def.id]: def };
  c.G.player.chests = {};
  c.UI.dirty = {};
  c.chestGainSalvageXp(0, 1);
  assert.equal(c.UI.dirty.newforge, true);
  assert.equal(c.UI.dirty.header, undefined);
  c.chestGainSalvageXp(0, 1);
  assert.equal(c.UI.dirty.header, true);
  const before = JSON.stringify(c.G);
  c.updateForgeChestBadge(engine.panel('header').player);
  assert.equal(badge.textContent, '1');
  assert.equal(badge.hidden, false);
  assert.equal(JSON.stringify(c.G), before);
  c.UI.dirty = {};
  engine.cmd('chest.open', { chestId: def.id, count: 1 });
  assert.equal(c.G.player.chests[def.id].n, 0);
  assert.equal(c.UI.dirty.header, true);
  c.updateForgeChestBadge(engine.panel('header').player);
  assert.equal(badge.hidden, true);
  c.G.player.chests[def.id].n = c.CHEST_MAX_COUNT;
  c.UI.dirty = {};
  c.chestGainSalvageXp(0, 10);
  assert.equal(c.UI.dirty.header, undefined, '已達箱數上限不增加header刷新');
});

test('非熔爐頁收到真正header面板回覆也更新角標，不需newforge投影', () => {
  const { c, badge, engine } = harness();
  const handlers = {};
  c.WorkerBridge = { on: (key, fn) => { handlers[key] = fn; } };
  c.UI_WORKER_STATE = { panels: {}, panelRequests: {}, panelResponseSeq: {}, panelVersions: {}, panelQueued: {} };
  c.UI = { tab: 'skills', dirty: {} };
  c.validUiPanelKey = () => true;
  for (const name of ['handleWorkerDead', 'handleWorkerRestarting', 'handleWorkerRestarted',
    'hideWorkerDeadNotice', 'updateWorkerSafeModeMarker', 'refreshUiPanelSubscriptions',
    'requestPanelData', 'releaseUiPendingByPanel', 'showPendingTowerResultModalIfReady']) c[name] = () => {};
  const start = ui.indexOf('function bindWorkerUiState(');
  vm.runInContext(ui.slice(start, ui.indexOf('\n}', start) + 2), c);
  assert.equal(c.bindWorkerUiState(), true);
  c.G.player.chests = { [c.CHESTS[0].id]: { n: 999 }, [c.CHESTS[1].id]: { n: 1 } };
  handlers[c.MSG_OUT.PANEL]({ name: 'header', data: engine.panel('header') });
  assert.equal(badge.textContent, '999+');
  assert.equal(badge.hidden, false);
  assert.equal(c.UI_WORKER_STATE.panels.newforge, undefined);
  c.G.player.chests = {};
  handlers[c.MSG_OUT.PANEL]({ name: 'header', data: engine.panel('header') });
  assert.equal(badge.hidden, true);
});
