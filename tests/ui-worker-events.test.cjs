'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

function functionBody(name) {
  const start = ui.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const open = ui.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < ui.length; i++) {
    if (ui[i] === '{') depth++;
    if (ui[i] === '}' && --depth === 0) return ui.slice(start, i + 1);
  }
  assert.fail('unterminated function ' + name);
}

test('Worker Event 將 flog、log 與 float 接到既有 UI 呈現函式', () => {
  const calls = [];
  const context = {
    addLog: (...args) => calls.push(['addLog', ...args]),
    routeUiLog: (...args) => calls.push(['routeUiLog', ...args]),
    workerTowerActiveForLog: () => true,
    floatText: (...args) => calls.push(['floatText', ...args])
  };
  vm.runInNewContext(functionBody('handleWorkerUiEvents'), context);

  context.handleWorkerUiEvents([
    { kind: 'flog', msg: '熔爐', cls: 'ok' },
    { kind: 'log', msg: '直接', cls: 'warn', box: 'custom-log', cap: 12 },
    { kind: 'log', msg: '戰鬥', cls: 'dmg', cat: 'combat' },
    { kind: 'float', elId: 'mv-float-0', text: '10', cls: 'dmg', damageValue: 10 },
    { kind: 'loot', fn: 'recordLootKill', args: [1, 'field'] }
  ]);

  assert.deepEqual(calls, [
    ['addLog', 'newforge-log', '熔爐', 'ok', 50],
    ['addLog', 'custom-log', '直接', 'warn', 12],
    ['routeUiLog', '戰鬥', 'dmg', 'combat', true],
    ['floatText', 'mv-float-0', '10', 'dmg', 10]
  ]);
});

test('Worker log 分類優先採用 cat，並依 tower Snapshot 導向 boss log', () => {
  const calls = [];
  const context = {
    UI_WORKER_STATE: { view: { towerActive: false } },
    peekUiPanelData: () => ({ tower: { active: true } }),
    addLog: (...args) => calls.push(args)
  };
  vm.runInNewContext([
    functionBody('classifyUiLogCategory'),
    functionBody('workerTowerActiveForLog'),
    functionBody('routeUiLog')
  ].join('\n'), context);

  assert.equal(context.workerTowerActiveForLog(), true);
  context.routeUiLog('任意文字', 'hit', 'combat', context.workerTowerActiveForLog());
  assert.deepEqual(calls, [['boss-log', '任意文字', 'hit', 150, 'boss']]);
});

test('待顯示敵人飄字以 elId 圖層存在性判斷，不再比較跨執行緒物件', () => {
  const flush = functionBody('flushPendingEnemyFloats');
  assert.match(flush, /\$id\(item\.elId\)/);
  assert.doesNotMatch(flush, /fieldEnemyList|activeEnemies|indexOf\(item\.ent\)/);
});

test('掉落統計由 battle Snapshot 暫時供既有 renderer 讀取且渲染後還原', () => {
  const mainRun = { source: 'main-run' };
  const mainLoot = { source: 'main-loot' };
  const workerRun = { source: 'worker-run' };
  const workerLoot = { source: 'worker-loot' };
  const context = {
    window: { RUN_STATS: mainRun, LOOT_STATS: mainLoot },
    workerUiStateEnabled: () => true,
    peekUiPanelData: () => ({ runStats: workerRun, lootStats: workerLoot }),
    requestPanelData: () => assert.fail('已有 Snapshot 時不應再要求面板')
  };
  vm.runInNewContext(functionBody('withWorkerBattleStats'), context);

  let rendered;
  assert.equal(context.withWorkerBattleStats(() => {
    rendered = [context.window.RUN_STATS, context.window.LOOT_STATS];
  }), true);
  assert.deepEqual(rendered, [workerRun, workerLoot]);
  assert.equal(context.window.RUN_STATS, mainRun);
  assert.equal(context.window.LOOT_STATS, mainLoot);

  const handler = functionBody('handleWorkerUiEvents');
  assert.doesNotMatch(handler, /\brecordLoot[A-Z]\w*\s*\(/);
});
