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
  const battleSnapshot = { stats: { comboHits: 2, aspd: 3 } };
  const context = {
    UI_WORKER_VISUAL_EVENT_QUEUE: [],
    UI_WORKER_VISUAL_FLUSH_HANDLE: 0,
    UI_WORKER_VISUAL_QUEUE_MAX: 160,
    UI_WORKER_VISUAL_FRAME_BUDGET: 6,
    addLog: (...args) => calls.push(['addLog', ...args]),
    routeUiLog: (...args) => calls.push(['routeUiLog', ...args]),
    workerTowerActiveForLog: () => true,
    uiBattlePanelSnapshot: () => battleSnapshot,
    floatText: (...args) => calls.push(['floatText', ...args])
  };
  vm.runInNewContext([
    functionBody('scheduleWorkerVisualEventFlush'),
    functionBody('queueWorkerVisualEvent'),
    functionBody('flushWorkerVisualEvents'),
    functionBody('handleWorkerUiEvents')
  ].join('\n'), context);

  context.handleWorkerUiEvents([
    { kind: 'flog', msg: '熔爐', cls: 'ok' },
    { kind: 'log', msg: '直接', cls: 'warn', box: 'custom-log', cap: 12 },
    { kind: 'log', msg: '戰鬥', cls: 'dmg', cat: 'combat' },
    { kind: 'float', elId: 'mv-float-0', text: '10', cls: 'dmg', damageValue: 10 },
    { kind: 'loot', fn: 'recordLootKill', args: [1, 'field'] }
  ]);
  context.flushWorkerVisualEvents();

  assert.deepEqual(calls, [
    ['addLog', 'newforge-log', '熔爐', 'ok', 50],
    ['addLog', 'custom-log', '直接', 'warn', 12],
    ['routeUiLog', '戰鬥', 'dmg', 'combat', true],
    ['floatText', 'mv-float-0', '10', 'dmg', 10, null, battleSnapshot, undefined]
  ]);
});

test('BOOTED 在套用 Snapshot 後轉送開機期間累積的 Worker Events', () => {
  const calls = [];
  const handlers = {};
  const context = {
    UI_WORKER_STATE: { bridgeBound: false },
    WorkerBridge: {
      on: (name, handler) => { handlers[name] = handler; }
    },
    MSG_OUT: { BOOTED: 'BOOTED', FULL: 'FULL', TICK: 'TICK', PANEL: 'PANEL' },
    applyUiSnapshot: snapshot => calls.push(['snapshot', snapshot]),
    updateWorkerSafeModeMarker: () => calls.push(['safe-mode']),
    handleWorkerUiEvents: events => calls.push(['events', events]),
    handleWorkerBootNotices: notices => calls.push(['notices', notices]),
    handleWorkerDead: () => {},
    handleWorkerRestarting: () => {},
    handleWorkerRestarted: () => {},
    hideWorkerDeadNotice: () => {},
    refreshUiPanelSubscriptions: () => {},
    requestPanelData: () => {}
  };
  vm.runInNewContext(functionBody('bindWorkerUiState'), context);

  assert.equal(context.bindWorkerUiState(), true);
  calls.length = 0;
  const snapshot = { view: { towerActive: false } };
  const events = [{ kind: 'flog', msg: '🏭 熔爐已啟動' }];
  const notices = [{ key: 'welcome' }];
  handlers.BOOTED({ snapshot, events, notices });

  assert.deepEqual(calls, [
    ['snapshot', snapshot],
    ['safe-mode'],
    ['events', events],
    ['notices', notices]
  ]);
});

test('Worker log 分類優先採用 cat，並依 tower Snapshot 導向 boss log', () => {
  const calls = [];
  const context = {
    UI_WORKER_STATE: { view: { towerActive: true } },
    peekUiPanelData: () => ({ tower: { active: false } }),
    addLog: (...args) => calls.push(args)
  };
  vm.runInNewContext([
    functionBody('classifyUiLogCategory'),
    functionBody('workerTowerActiveForLog'),
    functionBody('routeUiLog')
  ].join('\n'), context);

  assert.equal(context.workerTowerActiveForLog(), true);
  context.UI_WORKER_STATE.view = null;
  assert.equal(context.workerTowerActiveForLog(), false);
  context.UI_WORKER_STATE.view = { towerActive: true };
  context.routeUiLog('任意文字', 'hit', 'combat', context.workerTowerActiveForLog());
  assert.deepEqual(calls, [['battle-log', '任意文字', 'hit', 150, 'boss']]);
});

test('Worker 飄字以 elId 呈現，舊路徑也保留已離場目標的浮字', () => {
  const staleEnemy = { id: 'stale' };
  const calls = [];
  const context = {
    PENDING_ENEMY_FLOATS: [
      { elId: 'mv-float-0', text: '10', cls: 'dmg', damageValue: 10, ent: null },
      { elId: 'mv-float-1', text: '20', cls: 'dmg', damageValue: 20, ent: staleEnemy }
    ],
    fieldEnemyList: () => [{ id: 'current' }],
    $id: () => ({ offsetParent: {} }),
    // 圖層可見性判斷已抽成 floatLayerAttached（同一幀內快取 offsetParent）
    floatLayerAttached: (layer) => !!layer && layer.offsetParent !== null,
    animatePendingEnemyKill: (...args) => calls.push(['animate', ...args]),
    floatText: (...args) => calls.push(['float', ...args])
  };
  vm.runInNewContext(functionBody('flushPendingEnemyFloats'), context);
  const battleSnapshot = { stats: { comboHits: 2, aspd: 3 } };
  context.flushPendingEnemyFloats(battleSnapshot);

  assert.deepEqual(calls, [
    ['animate', null, 'mv-float-0', 'dmg', battleSnapshot],
    ['float', 'mv-float-0', '10', 'dmg', 10, null, battleSnapshot],
    ['animate', staleEnemy, 'mv-float-1', 'dmg', battleSnapshot],
    ['float', 'mv-float-1', '20', 'dmg', 20, staleEnemy, battleSnapshot]
  ]);
  assert.equal(context.PENDING_ENEMY_FLOATS.length, 0);
});

test('背景 Worker float 不建立 DOM，只記錄最新敵方傷害', () => {
  const calls = [];
  const context = {
    uiRenderingSuspended: () => true,
    isEnemyHitFloat: () => true,
    rememberBackgroundEnemyFloat: (...args) => calls.push(['remember', ...args]),
    floatText: (...args) => calls.push(['floatText', ...args])
  };
  vm.runInNewContext(functionBody('handleWorkerUiEvents'), context);

  context.handleWorkerUiEvents([
    { kind: 'float', elId: 'mv-float-0', text: '10', cls: 'dmg', damageValue: 10 }
  ]);

  assert.deepEqual(calls, [['remember', 'mv-float-0', '10', 'dmg', 10]]);
});

test('待建立敵人圖層時不設浮字數量上限，也不丟棄舊目標的浮字', () => {
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  const queueStart = ui.indexOf('function queuePendingEnemyFloat(');
  const queueEnd = ui.indexOf('function animatePendingEnemyKill(', queueStart);
  const flushStart = ui.indexOf('function flushPendingEnemyFloats(');
  const flushEnd = ui.indexOf('function floatText(', flushStart);
  assert.ok(queueStart >= 0 && queueEnd > queueStart);
  assert.ok(flushStart >= 0 && flushEnd > flushStart);
  assert.doesNotMatch(ui.slice(queueStart, queueEnd), /PENDING_ENEMY_FLOATS\.length\s*>\s*50/);
  assert.doesNotMatch(ui.slice(flushStart, flushEnd), /activeEnemies\.indexOf\(item\.ent\)/);
});

test('Worker delayed lethal float animates a dead enemy bar from full to empty', () => {
  const fill = { style: {}, offsetWidth: 0 };
  const card = { querySelector: () => fill };
  const layer = { closest: () => card };
  const context = {
    isEnemyHitFloat: () => true,
    $id: () => layer,
    setTimeout: () => 0,
    INSTANT_KILL_HP_ANIMATION_MS: 100
  };
  vm.runInNewContext(functionBody('animatePendingEnemyKill'), context);
  context.animatePendingEnemyKill(null, 'mv-float-0', 'dmg enemy-attack', {
    field: { monsters: [{ hp: 0, maxHp: 100 }] }
  });
  assert.equal(fill.style.width, '0%');
  assert.equal(fill.style.transition, 'width 100ms linear');
});

test('統計清除在 Worker 模式送 stats.reset 並等待 battle Snapshot 重繪', async () => {
  const calls = [];
  const list = { innerHTML: 'old summary' };
  const context = {
    workerUiStateEnabled: () => true,
    nodePendingKey: id => 'node:' + id,
    sendUiCommand: (name, args, options) => {
      calls.push({ name, args, options });
      return Promise.resolve(true);
    },
    uiCommandResultError: () => null,
    reportUiCommandFailure: error => assert.fail(String(error)),
    $id: id => id === 'battle-summary-list' ? list : null,
    renderStatsPanel: () => assert.fail('ACK 時不應直接用舊 Snapshot 重繪')
  };
  vm.runInNewContext([
    functionBody('clearStatsSummaryDom'),
    functionBody('resetStatsFromUi')
  ].join('\n'), context);

  assert.equal(await context.resetStatsFromUi(), true);
  /* silentResultError：這支自己在 .then 裡呼叫 reportUiCommandFailure，
     所以要求 sendUiCommand 不要再回報一次（見 js/ui.js sendUiCommand 的說明）。 */
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    name: 'stats.reset',
    args: {},
    options: { silentResultError: true, keys: ['node:stats'], panels: ['battle'] }
  }]);
  assert.equal(list.innerHTML, '');
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
