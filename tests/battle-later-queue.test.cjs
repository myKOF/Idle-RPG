'use strict';

/* 延遲播放佇列（js/battle-renderer.js laterFrame／laterDrain／laterShed）
   回報（2026-10-06）：特效很多時技能「不動」、傷害數字全部消失、技能頁整頁空白幾秒才出現。
   真瀏覽器實測（真 GPU、32 隻敵人、6 個滿階技能）：特效事件與飄字各排一個 setTimeout(240ms+) 才播，
   每秒排 1,050 個、只被執行 514 個，懸著 8,600 個、每個晚 4.6～7.6 秒；
   同一條計時器佇列上的 uiTick（setInterval）一起被卡住，FPS 計數器卻還有 35。
   原因不是回呼太貴（約 0.04ms），而是畫格迴圈把主執行緒塞滿時，瀏覽器每幀只放行約 20 個計時器任務。
   修法：延遲事件改排進畫格內批次處理的佇列，由 tickWorld 每幀在預算內取出。

   這裡守住佇列本身的語意；「真的不再堆計時器」要靠真瀏覽器量（見 docs／任務紀錄的實驗方法）。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./helpers/ui-float-merge.cjs');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'js', 'battle-renderer.js'), 'utf8');

const numVar = (name) => {
  const m = new RegExp('var ' + name + ' = ([0-9.]+);').exec(renderer);
  assert.ok(m, 'missing var ' + name);
  return { src: m[0], value: Number(m[1]) };
};
const BUDGET = numVar('LATER_BUDGET_MS'), MAX_LATE = numVar('LATER_FLOAT_MAX_LATE_MS'), CAP = numVar('LATER_CAP');

function makeQueue() {
  const clock = { now: 1000 };
  const errors = [];
  const context = {
    S: { later: { q: [], ran: 0, dropped: 0, droppedFloat: 0, maxLateMs: 0, lastMaxLateMs: 0 } },
    nowMs: () => clock.now,
    console: { error: (...a) => errors.push(a) }
  };
  vm.runInNewContext([BUDGET.src, MAX_LATE.src, CAP.src,
    functionSource(renderer, 'laterFrame'), functionSource(renderer, 'laterShed'), functionSource(renderer, 'laterDrain')].join('\n'), context);
  return { context, clock, errors, L: context.S.later };
}

test('LQ-1 依到期時間排序執行；同一時間到期的維持進來的順序', () => {
  const { context, clock } = makeQueue();
  const order = [];
  context.laterFrame(() => order.push('c'), 300, 1);
  context.laterFrame(() => order.push('a'), 100, 1);
  context.laterFrame(() => order.push('b1'), 200, 1);
  context.laterFrame(() => order.push('b2'), 200, 1);
  clock.now += 400;
  context.laterDrain(1000);
  assert.deepEqual(order, ['a', 'b1', 'b2', 'c']);
});

test('LQ-2 只執行到期的，沒到期的留在佇列裡', () => {
  const { context, clock, L } = makeQueue();
  const ran = [];
  context.laterFrame(() => ran.push('early'), 100, 1);
  context.laterFrame(() => ran.push('late'), 500, 1);
  clock.now += 150;
  assert.equal(context.laterDrain(1000), 1);
  assert.deepEqual(ran, ['early']);
  assert.equal(L.q.length, 1);
  clock.now += 400;
  assert.equal(context.laterDrain(1000), 1);
  assert.deepEqual(ran, ['early', 'late']);
});

test('LQ-3 時間預算：超過就停，剩下的留到下一幀（不一次做完，也不丟）', () => {
  const { context, clock, L } = makeQueue();
  let n = 0;
  for (let i = 0; i < 10; i++) context.laterFrame(() => { n++; clock.now += 2; }, 10, 1);   // 每項花 2ms
  clock.now += 20;
  const ran1 = context.laterDrain(BUDGET.value);
  assert.equal(ran1, Math.ceil(BUDGET.value / 2), '花滿預算就停（每項 2ms，預算 ' + BUDGET.value + 'ms）');
  assert.equal(L.q.length, 10 - ran1, '剩下的還在');
  while (L.q.length) context.laterDrain(BUDGET.value);
  assert.equal(n, 10, '最後全部執行過');
});

test('LQ-4 飄字晚太久就丟（數字比命中晚半秒以上沒有意義）；特效事件不因為晚而丟', () => {
  const { context, clock, L } = makeQueue();
  const ran = [];
  context.laterFrame(() => ran.push('float'), 100, 0);
  context.laterFrame(() => ran.push('vfx'), 100, 1);
  clock.now += 100 + MAX_LATE.value + 1;     // 兩個都過期超過門檻
  context.laterDrain(1000);
  assert.deepEqual(ran, ['vfx']);
  assert.equal(L.droppedFloat, 1);
  assert.equal(L.dropped, 1);
});

test('LQ-5 飄字沒超過門檻就照常執行', () => {
  const { context, clock } = makeQueue();
  const ran = [];
  context.laterFrame(() => ran.push('float'), 100, 0);
  clock.now += 100 + MAX_LATE.value - 1;
  context.laterDrain(1000);
  assert.deepEqual(ran, ['float']);
});

test('LQ-6 佇列上限：超過先丟最舊的飄字，飄字不夠才丟最舊的其他項目', () => {
  const { context, L } = makeQueue();
  const kept = [];
  for (let i = 0; i < CAP.value; i++) context.laterFrame(() => kept.push('v' + i), 1000 + i, 1);
  context.laterFrame(() => {}, 5000, 0);                     // 超過 1 個，而且是飄字
  assert.equal(L.q.length, CAP.value);
  assert.equal(L.q.filter((e) => e.rank === 0).length, 0, '被丟掉的是那個飄字（最舊的飄字）');
  assert.equal(L.droppedFloat, 1);

  context.laterFrame(() => {}, 6000, 1);                     // 再超過 1 個，已經沒有飄字可丟
  assert.equal(L.q.length, CAP.value);
  assert.equal(L.dropped, 2);
  assert.equal(L.droppedFloat, 1, '這次丟的不是飄字');
});

test('LQ-7 一個項目丟例外：不影響其他項目，console 只印前 3 次', () => {
  const { context, clock, errors } = makeQueue();
  const ran = [];
  for (let i = 0; i < 6; i++) context.laterFrame(() => { throw new Error('boom'); }, 10, 1);
  context.laterFrame(() => ran.push('after'), 20, 1);
  clock.now += 100;
  assert.doesNotThrow(() => context.laterDrain(1000));
  assert.deepEqual(ran, ['after']);
  assert.equal(errors.length, 3);
});

test('LQ-8 統計：執行件數、最近一幀與歷來最晚的項目晚了多久', () => {
  const { context, clock, L } = makeQueue();
  context.laterFrame(() => {}, 100, 1);
  clock.now += 130;
  context.laterDrain(1000);
  assert.equal(L.ran, 1);
  assert.equal(L.lastMaxLateMs, 30);
  context.laterFrame(() => {}, 100, 1);
  clock.now += 110;
  context.laterDrain(1000);
  assert.equal(L.lastMaxLateMs, 10, '最近一幀重新算');
  assert.equal(L.maxLateMs, 30, '歷來最晚的保留');
});

test('LQ-9 空佇列：drain 回 0、不做事', () => {
  const { context } = makeQueue();
  assert.equal(context.laterDrain(1000), 0);
});

/* ---------- 接線 ---------- */

test('LQ-10 onVfx／onFloat／onAct 的延遲播放走 laterFrame，不再排 setTimeout', () => {
  /* onVfx 後半段是舊式（非 Preset）畫法，裡面仍有各效果自己的 stagger 計時器；
     實測重負載下排程點只有延遲播放那三行，所以只要求「延遲那一段」不用計時器。 */
  const vfx = functionSource(renderer, 'onVfx');
  const delayBlock = /var baseDelay = [\s\S]*?\n    \}\n/.exec(vfx);
  assert.ok(delayBlock, '找得到延遲播放那一段');
  assert.match(delayBlock[0], /laterFrame\(/);
  assert.doesNotMatch(delayBlock[0], /setTimeout\s*\(/);
  for (const name of ['onFloat', 'onAct']) {
    const body = functionSource(renderer, name);
    assert.doesNotMatch(body, /setTimeout\s*\(/, name + ' 不應再排計時器');
    assert.match(body, /laterFrame\(/, name + ' 要走延遲佇列');
  }
});

test('LQ-11 飄字排 rank 0、特效排 rank 1（滿了先丟飄字、過期只丟飄字都靠這個）', () => {
  assert.match(functionSource(renderer, 'onFloat'), /laterFrame\([\s\S]*?\}, delay, 0\);/);
  assert.match(functionSource(renderer, 'onVfx'), /laterFrame\([\s\S]*?\}, baseDelay, 1\);/);
});

test('LQ-12 tickWorld 在更新之前取出到期項目；背景分頁整個清掉', () => {
  const body = functionSource(renderer, 'tickWorld');
  const at = body.indexOf('laterDrain(LATER_BUDGET_MS)');
  assert.ok(at > 0, 'tickWorld 要呼叫 laterDrain');
  assert.match(body, /if \(S\.later\.q\.length\) \{\s*if \(documentHidden\(\)\) \{[^}]*S\.later\.q\.length = 0;[^}]*\}\s*else laterDrain\(LATER_BUDGET_MS\);/);
  const playerBlock = body.indexOf('var p = S.player;');
  assert.ok(at < playerBlock, '要在玩家與特效更新之前，讓這一幀新播的東西同一幀就更新');
});

test('LQ-13 status() 帶出延遲佇列的狀態，卡頓時可以從診斷看到佇列長度與晚了多久', () => {
  assert.match(renderer, /later: \{ q: S\.later\.q\.length, ran: S\.later\.ran, dropped: S\.later\.dropped,/);
});
