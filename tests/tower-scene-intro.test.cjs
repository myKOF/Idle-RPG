'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ui = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui.js'), 'utf8');
function readFunction(name) {
  const start = ui.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = ui.indexOf('\n}', start);
  assert.ok(end >= 0, name + ' end');
  return ui.slice(start, end + 2);
}

function setup(tab) {
  let now = 0;
  const view = { paused: false, towerActive: true };
  const runtime = { floor: 1, elapsed: 0, introCd: 2.4, dmgDealt: 0, boss: { maxHp: 600 } };
  const nodes = {};
  for (const id of ['tw-timer', 'tch-timer', 'tower-canvas-hud', 'tch-floor', 'tch-enrage', 'tch-auto', 'tch-dps']) {
    nodes[id] = { textContent: '', style: {}, classList: { toggle() {} } };
  }
  const c = {
    Math, Number, UI: { tab, towerTimerAnchor: null, towerTimerRaf: 0 },
    viewState: () => view, uiTowerPanelSnapshot: () => ({ runtime }),
    uiBattlePanelSnapshot: () => ({ tower: runtime }), towerViewActive: () => view.towerActive,
    BattleRenderer: { active: () => true }, towerTimeLimitWithTalents: () => 60,
    towerTimerNow: () => now, scheduleTowerTimerFrame: () => 1,
    stopTowerTimerAnimation() { c.UI.towerTimerAnchor = null; c.UI.towerTimerRaf = 0; },
    $id: (id) => nodes[id], fmt: String,
    setStyleIfChanged: (el, key, value) => { el.style[key] = value; },
    setTextIfChanged: (el, value) => { el.textContent = value; }
  };
  vm.createContext(c);
  vm.runInContext(['formatTowerTimerSeconds', 'towerTimerRuntime', 'renderTowerTimerFrame',
    'towerCanvasHudActive', 'renderTowerCanvasHud'].map(readFunction).join('\n'), c);
  return { c, runtime, view, nodes, at(ms) { now = ms; }, frame() { c.renderTowerTimerFrame(); },
    hud() { c.renderTowerCanvasHud({ tower: runtime }, view); } };
}

function assertTimers(s, text) {
  assert.equal(s.nodes['tw-timer'].textContent, text);
  assert.equal(s.nodes['tch-timer'].textContent, text);
}

for (const tab of ['battle', 'tower']) {
  test(tab + '：登場及等待首個開戰快照時兩處倒數固定 60 秒，不延用舊場錨點', () => {
    const s = setup(tab);
    s.c.UI.towerTimerAnchor = { elapsed: 15, at: 0 };
    s.at(500);
    s.frame();
    assertTimers(s, '60.0s');
    assert.equal(s.c.UI.towerTimerAnchor, null);
    for (const [ms, introCd] of [[1500, 1], [2400, 0.1], [2600, 0], [3000, 0]]) {
      s.at(ms); s.runtime.introCd = introCd;
      if (tab === 'battle') s.hud();
      s.frame();
      assertTimers(s, '60.0s');
      assert.equal(s.c.UI.towerTimerAnchor, null);
    }
    assert.equal(s.c.UI.towerTimerRaf, 1, '保持逐幀更新以等候開戰');
  });
}

test('正式 elapsed 推進才建立新錨點，倒數平滑且暫停／連挑不沿用上一場時間', () => {
  const s = setup('battle');
  s.hud(); s.at(2400); s.frame();
  assertTimers(s, '60.0s');
  s.runtime.introCd = 0; s.runtime.elapsed = 0.1;
  s.at(2600); s.hud();
  s.at(3100); s.frame();
  assertTimers(s, '59.4s');
  s.view.paused = true; s.frame();
  assertTimers(s, '59.9s');
  assert.equal(s.c.UI.towerTimerRaf, 0);
  assert.equal(s.c.UI.towerTimerAnchor, null);
  s.at(10000); s.frame();
  assertTimers(s, '59.9s');
  s.view.paused = false; s.hud(); s.at(10200); s.frame();
  assertTimers(s, '59.7s');
  s.runtime.elapsed = 0; s.runtime.introCd = 2.4;
  s.at(11000); s.hud(); s.at(11500); s.frame();
  assertTimers(s, '60.0s');
  assert.equal(s.c.UI.towerTimerAnchor, null);
});
