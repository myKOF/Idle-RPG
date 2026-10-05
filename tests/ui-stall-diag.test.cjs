'use strict';

/* 卡頓歸因診斷（js/ui.js UI_TICK_DIAG／uiTickGuarded／uiStallDiagText）
   回報（2026-10-05）：傷害數字開著、敵人很多時偶爾「技能都不動」，技能頁打開是空的、
   幾秒後才出現，而 FPS 計數器還在跑。凍結可能出在 uiTick、Worker 訊息、特效佇列任一層，
   所以各記一筆、異常時顯示在 FPS 那一行。這裡守住：記錄正確、平常不出字、不改變 uiTick 的行為。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource, varBlock } = require('./helpers/ui-float-merge.cjs');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');

const numVar = (name) => {
  const m = new RegExp('var ' + name + ' = [^;]+;').exec(ui);
  assert.ok(m, 'missing var ' + name);
  return m[0];
};

const SOURCE = [
  varBlock(ui, 'UI_TICK_DIAG'),
  ...['UI_TICK_SLOW_MS', 'UI_TICK_GAP_MS', 'UI_WORKER_SILENT_MS', 'UI_VISUAL_WAIT_MS'].map(numVar),
  functionSource(ui, 'uiTickNoteError'),
  functionSource(ui, 'uiTickStep'),
  functionSource(ui, 'uiTickGuarded'),
  functionSource(ui, 'uiStallDiagText')
].join('\n');

function makeContext(opts) {
  opts = opts || {};
  const clock = { now: 10000 };
  const errors = [];
  const ticks = { n: 0 };
  const context = {
    UI_WORKER_VISUAL_EVENT_QUEUE: opts.queue || [],
    uiNowMs: () => clock.now,
    uiTick: opts.uiTick || (() => { ticks.n++; clock.now += opts.tickMs || 0; }),
    WorkerBridge: { status: () => ({ silentMs: opts.silentMs === undefined ? 100 : opts.silentMs }) },
    console: { error: (...a) => errors.push(a) }
  };
  vm.runInNewContext(SOURCE, context);
  return { context, clock, errors, ticks, diag: context.UI_TICK_DIAG };
}

test('SD-1 uiTickGuarded 照常執行 uiTick 一次，記下開始時刻與耗時', () => {
  const env = makeContext({ tickMs: 12 });
  env.context.uiTickGuarded();
  assert.equal(env.ticks.n, 1);
  assert.equal(env.diag.lastAt, 10000);
  assert.equal(env.diag.lastMs, 12);
  assert.equal(env.diag.errors, 0);
});

test('SD-2 uiTick 丟例外：不往外丟（與原本 setInterval 回呼一樣只結束這一輪）、計數、記訊息', () => {
  const env = makeContext({ uiTick: () => { throw new TypeError("Cannot read properties of null (reading 'x')"); } });
  assert.doesNotThrow(() => env.context.uiTickGuarded());
  assert.equal(env.diag.errors, 1);
  assert.equal(env.diag.lastErrorAt, 10000);
  assert.match(env.diag.lastErrorMsg, /Cannot read properties of null/);
});

test('SD-3 同一種例外只印前 3 次到 console，之後只計數（uiTick 每 200ms 一次，不能洗版）', () => {
  const env = makeContext({ uiTick: () => { throw new Error('boom'); } });
  for (let i = 0; i < 20; i++) env.context.uiTickGuarded();
  assert.equal(env.diag.errors, 20);
  assert.equal(env.errors.length, 3);
});

test('SD-4 例外之後下一輪照常執行（不因為例外停掉）', () => {
  let n = 0;
  const env = makeContext({ uiTick: () => { n++; if (n === 1) throw new Error('first'); } });
  env.context.uiTickGuarded();
  env.context.uiTickGuarded();
  assert.equal(n, 2);
  assert.equal(env.diag.errors, 1);
});

test('SD-5 慢的 uiTick（≥150ms）才記 slow，一般的不記', () => {
  const fast = makeContext({ tickMs: 149 });
  fast.context.uiTickGuarded();
  assert.equal(fast.diag.slowAt, 0);

  const slow = makeContext({ tickMs: 150 });
  slow.context.uiTickGuarded();
  assert.equal(slow.diag.slowMs, 150);
  assert.equal(slow.diag.slowAt, 10000);
});

test('SD-6 uiStallDiagText 平常不出字', () => {
  const env = makeContext();
  env.context.uiTickGuarded();
  assert.equal(env.context.uiStallDiagText(env.clock.now + 100), '');
});

test('SD-7 uiTick 例外：事件後 5 秒內顯示次數與訊息，之後消失', () => {
  const env = makeContext({ uiTick: () => { throw new Error('renderBattle exploded'); } });
  env.context.uiTickGuarded();
  env.context.uiTickGuarded();
  assert.match(env.context.uiStallDiagText(10000 + 4000), /uiTick 例外 2：\[tick\] renderBattle exploded/);
  assert.equal(env.context.uiStallDiagText(10000 + 5001).includes('例外'), false);
});

test('SD-8 例外訊息很長時截斷，FPS 那一行不會被撐爆', () => {
  const env = makeContext({ uiTick: () => { throw new Error('x'.repeat(500)); } });
  env.context.uiTickGuarded();
  const text = env.context.uiStallDiagText(10001);
  assert.ok(text.length < 120, '長度 ' + text.length);
});

test('SD-9 uiTick 太慢：顯示耗時；例外優先於慢', () => {
  const env = makeContext({ tickMs: 420 });
  env.context.uiTickGuarded();
  assert.match(env.context.uiStallDiagText(10000 + 1000), /uiTick 慢 420ms/);

  const both = makeContext({ uiTick: () => { throw new Error('e'); } });
  both.diag.slowAt = 10000; both.diag.slowMs = 999;
  both.context.uiTickGuarded();
  const text = both.context.uiStallDiagText(10100);
  assert.match(text, /例外/);
  assert.doesNotMatch(text, /慢/);
});

test('SD-10 uiTick 停了超過 1 秒（沒跑、也沒丟例外）：顯示停了多久', () => {
  const env = makeContext();
  env.context.uiTickGuarded();
  assert.equal(env.context.uiStallDiagText(10000 + 1000), '', '剛好 1 秒還不算');
  assert.match(env.context.uiStallDiagText(10000 + 3400), /uiTick 停 3\.4 秒/);
});

test('SD-11 還沒跑過 uiTick（lastAt=0）不誤報「停了」', () => {
  const env = makeContext();
  assert.equal(env.context.uiStallDiagText(99999), '');
});

test('SD-12 Worker 靜默：超過 1.5 秒才顯示，null（還沒收過訊息）不顯示', () => {
  assert.equal(makeContext({ silentMs: 1500 }).context.uiStallDiagText(10000), '');
  assert.match(makeContext({ silentMs: 4200 }).context.uiStallDiagText(10000), /Worker 靜默 4\.2 秒/);
  assert.equal(makeContext({ silentMs: null }).context.uiStallDiagText(10000), '');
});

test('SD-13 特效佇列頭等太久：顯示等了多久與佇列件數；不到 0.5 秒不顯示', () => {
  const young = makeContext({ queue: [{ kind: 'vfx', _qAt: 10000 - 400 }, { kind: 'float', _qAt: 10000 }] });
  assert.equal(young.context.uiStallDiagText(10000), '');

  const old = makeContext({ queue: [{ kind: 'vfx', _qAt: 10000 - 2300 }, { kind: 'float', _qAt: 10000 - 100 }, { kind: 'float', _qAt: 10000 }] });
  assert.match(old.context.uiStallDiagText(10000), /特效佇列等 2\.3 秒（3 件）/);
});

test('SD-14 佇列為空、或頭一件沒有入列時刻：不丟例外、不顯示', () => {
  const empty = makeContext({ queue: [] });
  assert.equal(empty.context.uiStallDiagText(10000), '');
  const bare = makeContext({ queue: [{ kind: 'float' }] });
  assert.equal(bare.context.uiStallDiagText(10000), '');
});

test('SD-15 三層可以同時顯示（各自獨立）', () => {
  const env = makeContext({ silentMs: 3000, queue: [{ kind: 'vfx', _qAt: 10000 - 1000 }] });
  env.diag.lastAt = 10000 - 2500;
  const text = env.context.uiStallDiagText(10000);
  assert.match(text, /uiTick 停/);
  assert.match(text, /Worker 靜默/);
  assert.match(text, /特效佇列等/);
});

/* ---------- uiTick 分段隔離 ---------- */

test('SD-18 uiTickStep：正常回 true；丟例外回 false、不往外丟、記下是哪一段', () => {
  const env = makeContext();
  let ran = 0;
  assert.equal(env.context.uiTickStep('header', () => { ran++; }), true);
  assert.equal(ran, 1);
  assert.equal(env.diag.errors, 0);

  assert.equal(env.context.uiTickStep('battle', () => { throw new Error('boom'); }), false);
  assert.equal(env.diag.errors, 1);
  assert.equal(env.diag.lastErrorMsg, '[battle] boom');
});

test('SD-19 不同段的例外各自計印次數：battle 的 boom 與 header 的 boom 是兩種', () => {
  const env = makeContext();
  for (let i = 0; i < 10; i++) {
    env.context.uiTickStep('battle', () => { throw new Error('boom'); });
    env.context.uiTickStep('header', () => { throw new Error('boom'); });
  }
  assert.equal(env.diag.errors, 20);
  assert.equal(env.errors.length, 6, '兩種各印前 3 次');
});

/* 真的 uiTick 本體：其餘呼叫自動補成 no-op（作法同 inventory-request-throttle.test.cjs） */
function runRealUiTick(over) {
  const src = functionSource(ui, 'uiTick');
  const calls = [];
  const context = Object.assign({
    UI: { tab: 'skills', dirty: { header: true, battle: true, skills: true }, lastBattleRenderAt: 0, lastInteractionAt: 0, sel: null },
    Date: { now: () => 100000 },
    _titleTimer: 0,
    _invReqPending: false,
    UI_INPUT_PROTECT_MS: 0,
    UI_BATTLE_RENDER_IDLE_MS: 0,
    window: { location: { hostname: 'example.com' } },
    uiRenderingSuspended: () => false,
    shouldRenderBattle: () => true,
    uiNowMs: () => 5000,
    console: { error: () => {} }
  }, over || {});
  const names = new Set([...src.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)].map((m) => m[1]));
  names.forEach((n) => { if (!(n in context)) context[n] = function () { calls.push(n); }; });
  context.renderSkills = function () { calls.push('renderSkills'); };
  context.renderHeader = over && over.renderHeader || function () { calls.push('renderHeader'); };
  context.renderBattle = over && over.renderBattle || function () { calls.push('renderBattle'); };
  vm.createContext(context);
  vm.runInContext(SOURCE + '\n' + src, context);
  return { context, calls };
}

test('SD-20 renderBattle 丟例外時，技能頁照樣重繪（原本整輪被跳過、技能頁保持空白）', () => {
  const { context, calls } = runRealUiTick({ renderBattle: () => { throw new Error('renderBattle exploded'); } });
  assert.doesNotThrow(() => context.uiTick());
  assert.ok(calls.includes('renderSkills'), '技能頁要重繪');
  assert.equal(context.UI.dirty.skills, false, '技能頁的 dirty 旗標清掉');
  assert.equal(context.UI.dirty.battle, true, '戰鬥那段失敗：dirty 保留，下一輪重試');
  assert.equal(context.UI.lastBattleRenderAt, 0, '失敗不算畫過');
  assert.equal(context.UI_TICK_DIAG.errors, 1);
  assert.match(context.UI_TICK_DIAG.lastErrorMsg, /^\[battle\] renderBattle exploded$/);
});

test('SD-21 renderHeader 丟例外時，戰鬥與技能頁照樣重繪，頭部 dirty 保留', () => {
  const { context, calls } = runRealUiTick({ renderHeader: () => { throw new Error('header exploded'); } });
  context.uiTick();
  assert.ok(calls.includes('renderSkills'));
  assert.equal(context.UI.dirty.header, true);
  assert.equal(context.UI.dirty.battle, false, '戰鬥那段沒壞，照常清旗標');
  assert.match(context.UI_TICK_DIAG.lastErrorMsg, /^\[header\]/);
});

test('SD-22 refreshBuffTooltip 丟例外也不連累技能頁', () => {
  const { context, calls } = runRealUiTick({ refreshBuffTooltip: () => { throw new Error('tip exploded'); } });
  context.uiTick();
  assert.ok(calls.includes('renderSkills'));
  assert.match(context.UI_TICK_DIAG.lastErrorMsg, /^\[buffTooltip\]/);
});

test('SD-23 全部正常時行為不變：每段各跑一次、旗標都清掉、沒有任何錯誤紀錄', () => {
  const { context, calls } = runRealUiTick();
  context.uiTick();
  assert.deepEqual(calls.filter((n) => /^render(Header|Battle|Skills)$/.test(n)), ['renderHeader', 'renderBattle', 'renderSkills']);
  assert.equal(context.UI.dirty.header, false);
  assert.equal(context.UI.dirty.battle, false);
  assert.equal(context.UI.dirty.skills, false);
  assert.equal(context.UI.lastBattleRenderAt, 100000);
  assert.equal(context.UI_TICK_DIAG.errors, 0);
});

test('SD-24 shouldRenderBattle 為假時戰鬥不畫、旗標不動', () => {
  const { context, calls } = runRealUiTick({ shouldRenderBattle: () => false });
  context.uiTick();
  assert.equal(calls.includes('renderBattle'), false);
  assert.equal(context.UI.dirty.battle, true);
});

/* ---------- 接線 ---------- */

test('SD-16 main.js 週期重繪掛的是 uiTickGuarded（不是裸的 uiTick）', () => {
  assert.match(mainSrc, /setInterval\(uiTickGuarded,\s*200\)/);
  assert.doesNotMatch(mainSrc, /setInterval\(uiTick,/);
});

test('SD-17 FPS 計數器把 uiStallDiagText 接在 uiVisualDiagText 後面', () => {
  assert.match(ui, /'FPS: ' \+ fps \+ uiVisualDiagText\(now\) \+ uiStallDiagText\(now\)/);
});
