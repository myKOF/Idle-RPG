const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const workerSrc = fs.readFileSync(path.join(root, 'js/worker/sim.worker.js'), 'utf8');

function loadWorkerContext(now = 42000) {
  const context = {
    console,
    location: { search: '' },
    performance: { now: () => 0 },
    importScripts() {},
    self: { postMessage() {} },
    setInterval() { return 1; },
    clearInterval() {},
    Date: { now: () => now }
  };
  vm.createContext(context);
  vm.runInContext(workerSrc, context, { filename: 'js/worker/sim.worker.js' });
  return context;
}

test('戰鬥暫停狀態可切換並標記戰鬥畫面需要更新', () => {
  const context = vm.createContext({
    UI: { dirty: { battle: false } },
    window: {},
    console
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8'), context);

  assert.equal(context.isCombatPaused(), false);
  assert.equal(context.setCombatPaused(true), true);
  assert.equal(context.isCombatPaused(), true);
  assert.equal(context.UI.dirty.battle, true);
  assert.equal(context.setCombatPaused(false), false);
  assert.equal(context.isCombatPaused(), false);
});

test('主迴圈暫停時凍結戰鬥時間，但不停止工廠與鑄造計時', () => {
  const calls = { forge: [], field: 0, tower: 0, factory: 0, newForge: 0 };
  const context = loadWorkerContext();
  context.GT = 0;
  context.isCombatPaused = () => true;
  context.forgeTick = (now) => { calls.forge.push(now); };
  context.fieldTick = () => { calls.field++; };
  context.towerTick = () => { calls.tower++; };
  context.factoryTick = (dt) => { calls.factory += dt; };
  context.newForgeTick = (dt) => { calls.newForge += dt; };

  context.simStep(1);

  assert.equal(context.GT, 0);
  assert.deepEqual(calls.forge, [42000]);
  assert.equal(calls.field, 0);
  assert.equal(calls.tower, 0);
  assert.equal(calls.factory, 1);
  assert.equal(calls.newForge, 1);

  context.isCombatPaused = () => false;
  context.simStep(0.5);
  assert.equal(context.GT, 0.5);
  assert.equal(calls.field, 1);
  assert.equal(calls.tower, 1);
  assert.equal(calls.factory, 1.5);
  assert.equal(calls.newForge, 1.5);
});

test('戰鬥控制列提供暫停按鈕與可辨識的繼續狀態', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.match(html, /id="btn-combat-pause"/);
  assert.match(html, /⏸ 暫停/);
  assert.match(ui, /sendUiCommand\('combat\.togglePaused'/);
  assert.match(ui, /aria-pressed/);
  assert.match(ui, /▶ 繼續/);
});

test('戰鬥關卡控制列使用正式 tooltip，不使用原生 title', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const combatStart = html.indexOf('<div id="combat-area">');
  const combatEnd = html.indexOf('<div id="detail-log-modal"');
  const combatBlock = html.slice(combatStart, combatEnd);
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.doesNotMatch(combatBlock, /\stitle=/);
  assert.match(combatBlock, /data-tt-title="冰原"/);
  assert.match(combatBlock, /data-tt-title="戰鬥控制"/);
  assert.match(combatBlock, /data-tt-title="迷你視窗"/);
  assert.match(combatBlock, /data-tt-title="統計面板"/);
  assert.match(ui, /el\.setAttribute\('data-tt-desc', paused \? '繼續野外與高塔戰鬥'/);
  assert.doesNotMatch(ui, /el\.title\s*=/);
});

test('戰鬥控制版面將自動推進放在原暫停位置，暫停、迷你視窗與統計面板移至綜合紀錄列', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const stageStart = html.indexOf('<div id="stage-bar">');
  const stageEnd = html.indexOf('</div>', stageStart);
  const stageBar = html.slice(stageStart, stageEnd);
  const logStart = html.indexOf('<div class="log-header">');
  const logEnd = html.indexOf('<div id="battle-log"', logStart);
  const logHeader = html.slice(logStart, logEnd);

  assert.match(stageBar, /id="st-auto"/);
  assert.doesNotMatch(stageBar, /id="btn-combat-pause"/);
  assert.doesNotMatch(stageBar, /id="btn-pip"/);
  assert.doesNotMatch(stageBar, /id="btn-summary"/);
  assert.match(logHeader, /id="btn-combat-pause"/);
  assert.match(logHeader, /id="btn-pip"/);
  assert.match(logHeader, /id="btn-summary"/);
});
