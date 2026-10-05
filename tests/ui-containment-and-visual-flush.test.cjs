'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { floatMergeSource } = require('./helpers/ui-float-merge.cjs');

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

function makeDiag(over) {
  return Object.assign({
    floatStale: 0, queueCap: 0, flushErrors: 0, stallDrops: 0, lastStallMs: 0,
    lastFlushAt: 0, lastDropAt: 0, lastErrorAt: 0, lastStallAt: 0, errorLogged: {}
  }, over || {});
}

/* flush 測試共用的環境：只放 flush 會碰到的全域。
   時間由 clock.now 推進，floatText 每件花 floatCostMs。 */
function makeFlushContext(queue, opts) {
  opts = opts || {};
  const clock = { now: 1000 };
  const calls = [];
  const consoleErrors = [];
  const context = {
    UI_WORKER_VISUAL_EVENT_QUEUE: queue,
    UI_WORKER_VISUAL_FLUSH_HANDLE: 0,
    UI_WORKER_VISUAL_QUEUE_MAX: 480,
    UI_WORKER_VISUAL_FRAME_MS: 4,
    UI_WORKER_VISUAL_FRAME_MAX: 800,
    UI_WORKER_VISUAL_FLOAT_STALE_MS: 1500,
    UI_WORKER_VISUAL_STALL_MS: 1000,
    /* 預設「上一次 flush 是 10ms 前」＝畫面有在跑；停擺情境用 opts.lastFlushAt 覆寫 */
    UI_VISUAL_DIAG: makeDiag({ lastFlushAt: opts.lastFlushAt === undefined ? 990 : opts.lastFlushAt }),
    uiNowMs: () => clock.now,
    uiBattlePanelSnapshot: () => ({ stats: {} }),
    scheduleWorkerVisualEventFlush: () => calls.push('scheduleWorkerVisualEventFlush'),
    floatText: (elId, text) => {
      calls.push(['floatText', text]);
      clock.now += opts.floatCostMs || 0;
    },
    console: { error: (...args) => consoleErrors.push(args) }
  };
  if (opts.battleRenderer) context.BattleRenderer = opts.battleRenderer;
  vm.runInNewContext([
    floatMergeSource(),
    functionBody('uiNoteVisualDrop'),
    functionBody('uiNoteVisualEventError'),
    functionBody('flushWorkerVisualEvents')
  ].join('\n'), context);
  return { context, clock, calls, consoleErrors };
}

const floatCalls = (calls) => calls.filter((c) => Array.isArray(c) && c[0] === 'floatText');

test('方案 A: flushWorkerVisualEvents 遵守時間預算並及時 break', () => {
  const { context, calls } = makeFlushContext([
    { kind: 'float', elId: 'mv-float-0', text: '1', cls: 'dmg', damageValue: 1 },
    { kind: 'float', elId: 'mv-float-0', text: '2', cls: 'dmg', damageValue: 2 },
    { kind: 'float', elId: 'mv-float-0', text: '3', cls: 'dmg', damageValue: 3 },
    { kind: 'float', elId: 'mv-float-0', text: '4', cls: 'dmg', damageValue: 4 }
  ], { floatCostMs: 3 });   // 模擬每處理 1 件花費 3ms

  context.flushWorkerVisualEvents();

  // 處理第 1 件後耗時 3ms，未超時；處理第 2 件後耗時 6ms，超出 4ms 上限，立即中斷
  assert.equal(floatCalls(calls).length, 2);
  assert.equal(context.UI_WORKER_VISUAL_EVENT_QUEUE.length, 2);
  assert.ok(calls.includes('scheduleWorkerVisualEventFlush'));
});

test('積壓保護只丟「過期」飄字：佇列再長，新鮮的飄字一件都不能被丟', () => {
  /* 回歸：舊版在佇列超過 120 件時，於處理之前先把飄字砍到只剩最新 60 件。
     雷電全開時單一模擬步驟就能送來上百件，那批字一幀就排得完，卻整批不見。 */
  const queue = [];
  for (let i = 0; i < 300; i++) {
    queue.push({ kind: 'float', elId: 'mv-float-' + (i % 10), text: String(i), cls: 'dmg', damageValue: 1, _qAt: 990 });
  }
  const { context, calls } = makeFlushContext(queue, { floatCostMs: 0.01 });

  context.flushWorkerVisualEvents();

  assert.equal(floatCalls(calls).length, 300, '300 件新鮮飄字應該全數送出');
  assert.equal(context.UI_VISUAL_DIAG.floatStale, 0);
  assert.equal(context.UI_WORKER_VISUAL_EVENT_QUEUE.length, 0);
});

test('積壓保護：排超過 STALE_MS 的飄字被丟，特效與新鮮飄字照常處理', () => {
  const vfxSeen = [];
  const { context, calls } = makeFlushContext([
    { kind: 'float', elId: 'mv-float-0', text: 'old-1', cls: 'dmg', damageValue: 1, _qAt: 1000 - 1501 },
    { kind: 'vfx', variant: 'thunder-strike', targets: ['mv-float-0'], _qAt: 1000 - 2000 },
    { kind: 'float', elId: 'mv-float-0', text: 'old-2', cls: 'dmg', damageValue: 1, _qAt: 1000 - 5000 },
    { kind: 'float', elId: 'mv-float-0', text: 'fresh', cls: 'dmg', damageValue: 1, _qAt: 1000 - 1499 },
    { kind: 'float', elId: 'mv-float-0', text: 'no-stamp', cls: 'dmg', damageValue: 1 }
  ], {
    battleRenderer: { wantsVfx: () => true, onVfx: (ev) => vfxSeen.push(ev.variant) }
  });

  context.flushWorkerVisualEvents();

  assert.deepEqual(floatCalls(calls).map((c) => c[1]), ['fresh', 'no-stamp']);
  assert.deepEqual(vfxSeen, ['thunder-strike'], '特效不依年齡丟棄');
  assert.equal(context.UI_VISUAL_DIAG.floatStale, 2);
  assert.ok(context.UI_VISUAL_DIAG.lastDropAt > 0);
});

test('單一視覺事件丟例外不會中斷整幀：後面的飄字照常處理，例外被記錄', () => {
  /* 回歸：flush 是 rAF 回呼。特效處理丟出 TypeError 時，這一幀剩下的事件全被晾著，
     而且沒有重排下一次 flush。這裡用「第二件特效一定丟例外」重現。 */
  const { context, calls, consoleErrors } = makeFlushContext([
    { kind: 'float', elId: 'mv-float-0', text: 'A', cls: 'dmg', damageValue: 1 },
    { kind: 'vfx', variant: 'lightning-chain-end', targets: [] },
    { kind: 'float', elId: 'mv-float-0', text: 'B', cls: 'dmg', damageValue: 1 },
    { kind: 'vfx', variant: 'lightning-chain-end', targets: [] },
    { kind: 'float', elId: 'mv-float-0', text: 'C', cls: 'dmg', damageValue: 1 }
  ], {
    battleRenderer: {
      wantsVfx: () => true,
      onVfx: () => { throw new TypeError("Cannot read properties of undefined (reading 'area')"); }
    }
  });

  assert.doesNotThrow(() => context.flushWorkerVisualEvents());

  assert.deepEqual(floatCalls(calls).map((c) => c[1]), ['A', 'B', 'C']);
  assert.equal(context.UI_WORKER_VISUAL_EVENT_QUEUE.length, 0);
  assert.equal(context.UI_VISUAL_DIAG.flushErrors, 2);
  assert.ok(context.UI_VISUAL_DIAG.lastErrorAt > 0);
  assert.equal(consoleErrors.length, 2, '第一次與第二次都要印出來給人看');
});

test('同一種例外只印前 3 次，之後只計數，避免每幀洗版', () => {
  const queue = [];
  for (let i = 0; i < 10; i++) queue.push({ kind: 'vfx', variant: 'x', targets: [] });
  const { context, consoleErrors } = makeFlushContext(queue, {
    battleRenderer: { wantsVfx: () => true, onVfx: () => { throw new Error('boom'); } }
  });

  context.flushWorkerVisualEvents();

  assert.equal(context.UI_VISUAL_DIAG.flushErrors, 10);
  assert.equal(consoleErrors.length, 3);
});

const QUEUE_FUNCS = ['uiNoteVisualDrop', 'uiIsSustainVisualEvent', 'uiVisualRank', 'uiSameSustainField', 'queueWorkerVisualEvent'];
const QUEUE_SOURCE = floatMergeSource() + '\n' + QUEUE_FUNCS.map(functionBody).join('\n');

function makeQueueContext(lastFlushAt) {
  const context = {
    UI_WORKER_VISUAL_EVENT_QUEUE: [{ kind: 'float', text: 'oldest' }],
    UI_WORKER_VISUAL_QUEUE_MAX: 2,
    UI_WORKER_VISUAL_STALL_MS: 1000,
    UI_VISUAL_DIAG: makeDiag({ lastFlushAt }),
    uiNowMs: () => 4242,
    scheduleWorkerVisualEventFlush: () => {}
  };
  vm.runInNewContext(QUEUE_SOURCE, context);
  return context;
}

test('queueWorkerVisualEvent 幫事件蓋進佇列時間，畫面在跑時佇列滿了：擠掉最舊的並算「丟字」', () => {
  const context = makeQueueContext(4200);   // 42ms 前才 flush 過＝畫面有在跑

  const a = { kind: 'float', text: 'a' };
  const b = { kind: 'float', text: 'b' };
  context.queueWorkerVisualEvent(a);
  assert.equal(a._qAt, 4242);
  assert.equal(context.UI_VISUAL_DIAG.queueCap, 0);

  context.queueWorkerVisualEvent(b);   // 佇列已有 2 件（上限），最舊的被擠掉
  assert.deepEqual(context.UI_WORKER_VISUAL_EVENT_QUEUE.map((e) => e.text), ['a', 'b']);
  assert.equal(context.UI_VISUAL_DIAG.queueCap, 1);
  assert.equal(context.UI_VISUAL_DIAG.lastDropAt, 4242);
  assert.equal(context.UI_VISUAL_DIAG.stallDrops, 0);
});

test('畫面停擺（rAF 不跑）期間佇列滿了：另計「停幀」，不算丟字', () => {
  /* 回歸：窗格被遮住時 document.hidden 仍是 false、Worker 照送事件，佇列頂到上限後每來一件擠掉一件。
     實測 45 秒就累積 463 筆，四分鐘可破萬——那時畫面根本沒在畫，不是飄字遺失。 */
  const context = makeQueueContext(0);      // 從沒 flush 過／很久以前才 flush＝停擺
  for (const t of ['a', 'b', 'c', 'd', 'e']) context.queueWorkerVisualEvent({ kind: 'float', text: t });

  assert.equal(context.UI_VISUAL_DIAG.queueCap, 0, '不算丟字');
  assert.equal(context.UI_VISUAL_DIAG.floatStale, 0);
  assert.equal(context.UI_VISUAL_DIAG.stallDrops, 4, '佇列上限 2、原本已有 1 件：第 2～5 次進佇列各擠掉 1 件');
  assert.equal(context.UI_VISUAL_DIAG.lastDropAt, 0, '不觸發「丟字」提示');
  assert.equal(context.UI_VISUAL_DIAG.lastStallAt, 4242);
});

test('畫面停擺後恢復：排太久的飄字算「停幀」略過，不算丟字；並記下停了多久', () => {
  const { context } = makeFlushContext([
    { kind: 'float', elId: 'mv-float-0', text: 'old', cls: 'dmg', damageValue: 1, _qAt: 1000 - 30000 },
    { kind: 'float', elId: 'mv-float-0', text: 'old', cls: 'dmg', damageValue: 1, _qAt: 1000 - 29000 },
    { kind: 'float', elId: 'mv-float-0', text: 'fresh', cls: 'dmg', damageValue: 1, _qAt: 990 }
  ], { lastFlushAt: 1000 - 30000 });        // 上一次 flush 是 30 秒前

  context.flushWorkerVisualEvents();

  assert.equal(context.UI_VISUAL_DIAG.stallDrops, 2);
  assert.equal(context.UI_VISUAL_DIAG.floatStale, 0);
  assert.equal(context.UI_VISUAL_DIAG.lastDropAt, 0);
  assert.equal(context.UI_VISUAL_DIAG.lastStallMs, 30000);
  assert.equal(context.UI_VISUAL_DIAG.lastFlushAt, 1000, 'flush 開始就更新時刻');
});

test('uiVisualDiagText：平常不出字，事件後 5 秒內顯示，之後消失', () => {
  const context = { UI_VISUAL_DIAG: makeDiag(), UI_WORKER_VISUAL_EVENT_QUEUE: [1, 2, 3] };
  vm.runInNewContext(floatMergeSource() + '\n' + functionBody('uiVisualDiagText'), context);

  assert.equal(context.uiVisualDiagText(10000), '');

  context.UI_VISUAL_DIAG.floatStale = 5;
  context.UI_VISUAL_DIAG.queueCap = 2;
  context.UI_VISUAL_DIAG.flushErrors = 1;
  context.UI_VISUAL_DIAG.lastDropAt = 9000;
  const text = context.uiVisualDiagText(10000);
  assert.match(text, /丟字 7/);
  assert.match(text, /例外 1/);
  assert.match(text, /佇列 3/);
  assert.doesNotMatch(text, /停幀/);

  assert.equal(context.uiVisualDiagText(9000 + 5001), '');
});

test('uiVisualDiagText：停幀另外顯示，不混進丟字', () => {
  const context = { UI_VISUAL_DIAG: makeDiag({ stallDrops: 10536, lastStallMs: 4321, lastStallAt: 9000 }), UI_WORKER_VISUAL_EVENT_QUEUE: [] };
  vm.runInNewContext(floatMergeSource() + '\n' + functionBody('uiVisualDiagText'), context);

  const text = context.uiVisualDiagText(10000);
  assert.match(text, /停幀約 4\.3 秒 略過 10536/);
  assert.doesNotMatch(text, /丟字/, '只有停幀時不出「丟字」');

  assert.equal(context.uiVisualDiagText(9000 + 5001), '');
});

test('方案 C: UIContainmentManager 具備獨立註冊、註銷與一鍵開關功能', () => {
  // 模擬簡易 DOM
  const classListMap = new Map();
  const mockElements = {
    '#skill-trees': {
      classList: {
        contains: (cls) => (classListMap.get('#skill-trees') || new Set()).has(cls),
        add: (cls) => {
          if (!classListMap.has('#skill-trees')) classListMap.set('#skill-trees', new Set());
          classListMap.get('#skill-trees').add(cls);
        },
        remove: (cls) => {
          if (classListMap.has('#skill-trees')) classListMap.get('#skill-trees').delete(cls);
        }
      }
    },
    '#custom-panel': {
      classList: {
        contains: (cls) => (classListMap.get('#custom-panel') || new Set()).has(cls),
        add: (cls) => {
          if (!classListMap.has('#custom-panel')) classListMap.set('#custom-panel', new Set());
          classListMap.get('#custom-panel').add(cls);
        },
        remove: (cls) => {
          if (classListMap.has('#custom-panel')) classListMap.get('#custom-panel').delete(cls);
        }
      }
    }
  };

  const context = {
    document: {
      querySelector: (sel) => mockElements[sel] || null
    },
    window: {}
  };

  // 提取 UIContainmentManager 定義
  const mgrStart = ui.indexOf('var UIContainmentManager = {');
  assert.notEqual(mgrStart, -1, 'missing UIContainmentManager');
  const mgrEnd = ui.indexOf('if (typeof window !== \'undefined\')', mgrStart);
  const mgrCode = ui.slice(mgrStart, mgrEnd);

  vm.runInNewContext(mgrCode, context);
  const mgr = context.UIContainmentManager;

  // 1. 初始化並套用預設的 skill-trees
  mgr.init();
  assert.equal(mgr.isContainerActive('skill-trees'), true);
  assert.equal(classListMap.get('#skill-trees').has('ui-contain-layout'), true);

  // 2. 動態擴充自訂容器
  mgr.register('custom-panel', { selector: '#custom-panel' });
  assert.equal(mgr.isContainerActive('custom-panel'), true);
  assert.equal(classListMap.get('#custom-panel').has('ui-contain-layout'), true);

  // 3. 一鍵關閉方案 C
  mgr.setEnabled(false);
  assert.equal(mgr.enabled, false);
  assert.equal(mgr.isContainerActive('skill-trees'), false);
  assert.equal(classListMap.get('#skill-trees').has('ui-contain-layout'), false);
  assert.equal(classListMap.get('#custom-panel').has('ui-contain-layout'), false);

  // 4. 一鍵重新開啟方案 C
  mgr.setEnabled(true);
  assert.equal(mgr.isContainerActive('skill-trees'), true);
  assert.equal(classListMap.get('#skill-trees').has('ui-contain-layout'), true);
  assert.equal(classListMap.get('#custom-panel').has('ui-contain-layout'), true);

  // 5. 縮小/註銷容器
  mgr.unregister('custom-panel');
  assert.equal(mgr.registry['custom-panel'], undefined);
  assert.equal(classListMap.get('#custom-panel').has('ui-contain-layout'), false);
});

/* ---- 主執行緒佇列：分級牺牲與就地合併
   2026-10-01 無限冰裂：真實瀏覽器 20 秒內發射事件 270 個全丟。
   2026-10-05 臨界雷劫＋300 隻敵人：飄字每秒約 3,300 件、每個 5Hz tick 批次 600 多件，
   一批就把佇列裡還沒 flush 的特效整批擠掉，雷球事件只有 42% 進得了渲染器。 ---- */

function makeRankedQueueContext(queue, max) {
  const context = {
    UI_WORKER_VISUAL_EVENT_QUEUE: queue,
    UI_WORKER_VISUAL_QUEUE_MAX: max,
    UI_WORKER_VISUAL_STALL_MS: 1000,
    UI_VISUAL_DIAG: makeDiag({ lastFlushAt: 4200 }),
    uiNowMs: () => 4242,
    scheduleWorkerVisualEventFlush: () => {}
  };
  vm.runInNewContext(QUEUE_SOURCE, context);
  return context;
}
const refresh = (id, extra) => Object.assign({ kind: 'vfx', fxKind: 'aura', variant: 'thunder-orb', area: { id } }, extra || {});
const shot = (variant) => ({ kind: 'vfx', fxKind: 'projectile', variant: variant || 'ice-arrow-pierce' });
const floatEv = (text) => ({ kind: 'float', text });
const label = (e) => e.text || (e.area && e.area.id) || e.variant;

test('QUEUE-1 滿了：先擠掉最舊的飄字，特效事件（一次性與持續刷新）一件都不動', () => {
  const context = makeRankedQueueContext([floatEv('f1'), refresh('s1'), floatEv('f2'), shot('old-shot')], 4);
  context.queueWorkerVisualEvent(shot('new-shot'));
  assert.deepEqual(context.UI_WORKER_VISUAL_EVENT_QUEUE.map(label), ['s1', 'f2', 'old-shot', 'new-shot']);
  assert.equal(context.UI_VISUAL_DIAG.queueCap, 1);
});

test('QUEUE-2 滿了且沒有飄字：持續刷新比一次性事件先被犧牲', () => {
  const context = makeRankedQueueContext([shot('a'), refresh('s1'), shot('b')], 3);
  context.queueWorkerVisualEvent(shot('c'));
  assert.deepEqual(context.UI_WORKER_VISUAL_EVENT_QUEUE.map(label), ['a', 'b', 'c']);
});

test('QUEUE-3 進來的比佇列裡最低的還低：丟進來的（飄字撞上全是特效的佇列）', () => {
  const context = makeRankedQueueContext([shot('a'), refresh('s1')], 2);
  context.queueWorkerVisualEvent(floatEv('late'));
  assert.deepEqual(context.UI_WORKER_VISUAL_EVENT_QUEUE.map(label), ['a', 's1']);
  assert.equal(context.UI_VISUAL_DIAG.queueCap, 1);
  // 全是一次性事件時，持續刷新進不來
  const full = makeRankedQueueContext([shot('a'), shot('b')], 2);
  full.queueWorkerVisualEvent(refresh('s2'));
  assert.deepEqual(full.UI_WORKER_VISUAL_EVENT_QUEUE.map(label), ['a', 'b']);
});

test('QUEUE-4 同等級滿了維持原本的丟最舊（飄字擠飄字、一次性擠一次性）', () => {
  const floats = makeRankedQueueContext([floatEv('a'), floatEv('b')], 2);
  floats.queueWorkerVisualEvent(floatEv('c'));
  assert.deepEqual(floats.UI_WORKER_VISUAL_EVENT_QUEUE.map(label), ['b', 'c']);
  const shots = makeRankedQueueContext([shot('a'), shot('b')], 2);
  shots.queueWorkerVisualEvent(shot('c'));
  assert.deepEqual(shots.UI_WORKER_VISUAL_EVENT_QUEUE.map(label), ['b', 'c']);
});

test('QUEUE-5 同一個場域的持續刷新就地合併：不多佔名額、不算丟棄，留下最新那則', () => {
  const context = makeRankedQueueContext([refresh('s1', { n: 1 }), shot('a'), refresh('s2', { n: 1 })], 3);
  context.queueWorkerVisualEvent(refresh('s1', { n: 2 }));
  const q = context.UI_WORKER_VISUAL_EVENT_QUEUE;
  assert.equal(q.length, 3, '佇列沒變長（而且已經滿了也照樣進得來）');
  assert.equal(q[0].n, 2, '舊的那則被換成最新的');
  assert.equal(q[0]._qAt, 4242);
  assert.equal(context.UI_VISUAL_DIAG.queueCap, 0, '合併不是丟棄');
  assert.deepEqual(q.map(label), ['s1', 'a', 's2']);
});

test('QUEUE-6 合併的鍵是「變體＋場域 id」：不同變體或不同場域各自保留', () => {
  const context = makeRankedQueueContext([], 10);
  context.queueWorkerVisualEvent(refresh('x', { variant: 'thunder-orb' }));
  context.queueWorkerVisualEvent(refresh('x', { variant: 'wind-blade-homing' }));
  context.queueWorkerVisualEvent(refresh('y', { variant: 'thunder-orb' }));
  context.queueWorkerVisualEvent(refresh('x', { variant: 'thunder-orb' }));
  assert.equal(context.UI_WORKER_VISUAL_EVENT_QUEUE.length, 3);
});

test('QUEUE-7 沒有 area.id 的光環與一次性事件不合併', () => {
  const context = makeRankedQueueContext([], 10);
  const bare = { kind: 'vfx', fxKind: 'aura', variant: 'thunder-orb', area: { x: 1 } };
  context.queueWorkerVisualEvent(bare);
  context.queueWorkerVisualEvent(Object.assign({}, bare));
  context.queueWorkerVisualEvent(shot('a'));
  context.queueWorkerVisualEvent(shot('a'));
  assert.equal(context.UI_WORKER_VISUAL_EVENT_QUEUE.length, 4);
});

test('QUEUE-8 洪水情境：300 隻敵人的飄字批次進來，佇列裡的特效事件一件都不會被擠掉', () => {
  const context = makeRankedQueueContext([], 480);
  for (let i = 0; i < 60; i++) context.queueWorkerVisualEvent(refresh('orb-' + i));
  for (let i = 0; i < 20; i++) context.queueWorkerVisualEvent(shot('launch-' + i));
  for (let i = 0; i < 700; i++) context.queueWorkerVisualEvent(floatEv('dmg-' + i));   // 一個 tick 批次
  const q = context.UI_WORKER_VISUAL_EVENT_QUEUE;
  assert.equal(q.length, 480);
  assert.equal(q.filter((e) => e.kind === 'vfx').length, 80, '特效 80 件全在');
  assert.equal(q.filter((e) => e.kind === 'float').length, 400);
  assert.equal(q[q.length - 1].text, 'dmg-699', '留下的是最新的飄字');
});
