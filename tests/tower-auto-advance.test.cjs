'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createEngine } = require('../scripts/sim/engine.js');
const root = path.resolve(__dirname, '..');

function setup(floor = 1) {
  const e = createEngine({ seed: 17 }).boot(null), c = e.ctx;
  c.G.tower.highest = floor - 1;
  c.G.player.gold = 1e30;
  return { e, c, start() { c.runCommand('tower.start', { floor }); },
    win() { c.TOWER.boss.hp = 0; c.endTowerFight(true); },
    confirm() { return c.runCommand('tower.confirmResult', {}); } };
}

test('缺欄預設開啟：正式Worker勝利通知含倒數，確認後下一層只扣一次費用', () => {
  const s = setup(), { c } = s;
  assert.equal(c.G.tower.autoAdvance, undefined);
  s.start(); s.win();
  assert.equal(c.G.tower.highest, 1);
  assert.equal(c.TOWER.floor, 1);
  assert.equal(c.TOWER.showingResult, true);
  assert.equal(c.TOWER.result.advanceFloor, 2);
  assert.equal(c.TOWER.result.autoCountdown, true);
  assert.equal(c.TOWER.result.autoContinue, true);
  assert.ok(c.shimDrainEvents().some(event => event.data && event.data.advanceFloor === 2));
  c.G.player.gold = 1e9;
  s.confirm();
  assert.equal(c.G.tower.active, true);
  assert.equal(c.TOWER.floor, 2);
  assert.equal(c.TOWER.introCd, c.TOWER_INTRO_SEC);
  assert.equal(c.G.player.gold, 1e9 - c.towerChallengeCost(2));
  const after = c.G.player.gold;
  s.confirm();
  assert.equal(c.G.player.gold, after);
  assert.equal(c.G.tower.active, true);
  s.win(); s.confirm();
  assert.equal(c.TOWER.floor, 3, '接續戰鬥勝利後繼續推進');
});

test('關閉設定經正式Worker面板及存讀保留，不自動接關；可重新開啟', () => {
  const s = setup(), { c, e } = s;
  assert.equal(c.runCommand('tower.setAutoAdvance', { on: false }).ok, true);
  assert.equal(c.buildPanel('tower').tower.autoAdvance, false);
  const loaded = createEngine({ seed: 17 }).boot(JSON.parse(e.saveJson())).ctx;
  assert.equal(loaded.G.tower.autoAdvance, false);
  s.start(); s.win();
  assert.equal(c.TOWER.result.advanceFloor, undefined);
  s.confirm();
  assert.equal(c.G.tower.active, false);
  c.runCommand('tower.setAutoAdvance', { on: true });
  s.start(); s.win(); s.confirm();
  assert.equal(c.TOWER.floor, 2);
});

for (const reason of ['death', 'timeout', 'flee']) {
  test(reason + ' 不推進，確認後回到野外', () => {
    const s = setup(), { c } = s;
    s.start();
    if (reason === 'death') c.TOWER.player.hp = 0;
    c.endTowerFight(false, reason);
    assert.equal(c.TOWER.result.advanceFloor, undefined);
    assert.equal(c.TOWER.result.autoCountdown, undefined);
    s.confirm();
    assert.equal(c.G.tower.active, false);
    assert.equal(c.G.tower.highest, 0);
  });
}

test('同層連挑含最後一場、僅挑一次與手動停止連挑皆不轉入推進', () => {
  for (const count of [1, 2]) {
    const s = setup(), { c } = s;
    c.runCommand('tower.startAuto', { floor: 1, count });
    for (let i = 0; i < count; i++) {
      s.win();
      assert.equal(c.TOWER.result.advanceFloor, undefined);
      s.confirm();
      assert.equal(c.TOWER.floor, 1);
      assert.equal(c.G.tower.active, i < count - 1);
    }
  }
  const s = setup(), { c } = s;
  c.runCommand('tower.startAuto', { floor: 1, count: 2 }); s.win();
  c.runCommand('tower.stopAuto', {}); s.confirm();
  assert.equal(c.G.tower.active, false);
});

test('最高層停止；第50與100層可跨塔別挑戰下一層', () => {
  for (const floor of [50, 100, 150]) {
    const s = setup(floor), { c } = s;
    s.start(); s.win(); s.confirm();
    assert.equal(c.G.tower.active, floor < 150);
    assert.equal(c.TOWER.floor, floor < 150 ? floor + 1 : floor);
  }
});

test('金幣不足不排倒數；倒數期間金幣變少或下層未解鎖不扣款、不開戰', () => {
  for (const phase of ['result', 'confirm', 'locked']) {
    const s = setup(), { c } = s;
    s.start();
    if (phase === 'result') c.G.player.gold = 0;
    s.win();
    if (phase === 'result') assert.equal(c.TOWER.result.autoCountdown, undefined);
    if (phase === 'confirm') c.G.player.gold = 0;
    if (phase === 'locked') c.G.tower.highest = 0;
    const gold = c.G.player.gold;
    s.confirm();
    assert.equal(c.G.tower.active, false);
    assert.equal(c.G.player.gold, gold);
  }
});

test('停止推進或倒數期間取消勾選立即取消續戰', () => {
  for (const name of ['tower.stopAuto', 'tower.setAutoAdvance']) {
    const s = setup(), { c } = s;
    s.start(); s.win();
    c.runCommand(name, name === 'tower.setAutoAdvance' ? { on: false } : {});
    assert.equal(c.TOWER.result.autoCountdown, false);
    s.confirm();
    assert.equal(c.G.tower.active, false);
  }
});

test('UI checkbox走Worker指令與面板確認，結算停止按鈕讀取對應文案', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="tw-auto-advance" checked/);
  const start = ui.indexOf("  var towerAdvanceToggle = $id('tw-auto-advance');");
  const end = ui.indexOf("  $id('toggle-compare')", start);
  const sent = [], toggle = { checked: false, setAttribute() {}, addEventListener(_, fn) { this.change = fn; } };
  const c = { $id: () => toggle, nodePendingKey: x => 'node:' + x,
    sendUiCommand: (name, args, opts) => { sent.push({ name, args, opts }); return Promise.resolve(); } };
  vm.runInNewContext(ui.slice(start, end), c);
  toggle.change.call(toggle);
  assert.equal(sent[0].name, 'tower.setAutoAdvance');
  assert.equal(sent[0].args.on, false);
  assert.deepEqual(Array.from(sent[0].opts.panels), ['tower']);
  assert.match(ui, /advanceToggle.checked = towerState.autoAdvance !== false/);
  assert.match(ui, /r && r.advanceFloor \? STR\(2242\) : STR\(1819\)/);
});
