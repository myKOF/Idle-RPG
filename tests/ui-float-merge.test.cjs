'use strict';

/* 傷害數字合併分級（js/ui.js UI_FLOAT_MERGE）
   使用者規格（2026-10-05）：大量傷害數字同屏、開始丟字時，先啟動 5 合 1；
   還是丟字，就在 5 合 1 之上再 5 合 1（最極限 25 合 1）；這樣還丟，那就丟。

   執行方式與 ui-containment-and-visual-flush.test.cjs 相同：從 ui.js 原始碼抽出函式丟進 vm。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { floatMergeSource, functionSource } = require('./helpers/ui-float-merge.cjs');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const rendererSrc = fs.readFileSync(path.join(root, 'js', 'battle-renderer.js'), 'utf8');

const SOURCE = [
  floatMergeSource(),
  ...['uiNoteVisualDrop', 'uiIsSustainVisualEvent', 'uiVisualRank', 'uiSameSustainField',
    'queueWorkerVisualEvent', 'uiNoteVisualEventError', 'flushWorkerVisualEvents', 'uiVisualDiagText']
    .map((name) => functionSource(ui, name))
].join('\n');

function makeContext(opts) {
  opts = opts || {};
  const clock = { now: 10000 };
  const shown = [];
  const context = {
    UI_WORKER_VISUAL_EVENT_QUEUE: [],
    UI_WORKER_VISUAL_FLUSH_HANDLE: 0,
    UI_WORKER_VISUAL_QUEUE_MAX: opts.max || 480,
    UI_WORKER_VISUAL_FRAME_MS: 4,
    UI_WORKER_VISUAL_FRAME_MAX: 800,
    UI_WORKER_VISUAL_FLOAT_STALE_MS: 1500,
    UI_WORKER_VISUAL_STALL_MS: 1000,
    UI_VISUAL_DIAG: {
      floatStale: 0, queueCap: 0, flushErrors: 0, stallDrops: 0, lastStallMs: 0,
      lastFlushAt: clock.now - 10, lastDropAt: 0, lastErrorAt: 0, lastStallAt: 0, errorLogged: {}
    },
    uiNowMs: () => clock.now,
    uiBattlePanelSnapshot: () => ({}),
    scheduleWorkerVisualEventFlush: () => {},
    floatText: (elId, text, cls, damageValue) => shown.push({ elId, text, cls, damageValue }),
    console: { error: () => {} }
  };
  if (opts.renderer) context.BattleRenderer = opts.renderer;
  vm.runInNewContext(SOURCE, context);
  return { context, clock, shown, m: context.UI_FLOAT_MERGE, queue: context.UI_WORKER_VISUAL_EVENT_QUEUE };
}

function hit(context, target, value, over) {
  return Object.assign({
    kind: 'float', elId: 'mv-float-' + target, text: context.fmt(value),
    cls: 'dmg enemy-skill', damageValue: value
  }, over || {});
}
const push = (context, ev) => context.queueWorkerVisualEvent(ev);
const totalOf = (queue) => queue.reduce((s, e) => s + (e.kind === 'float' ? e.damageValue : 0), 0);

/* ---------- 合併本身 ---------- */

test('FM-1 第 0 級（平常）完全不合併：每一件都是獨立的飄字', () => {
  const { context, queue } = makeContext();
  for (let i = 0; i < 12; i++) push(context, hit(context, 0, 100));
  assert.equal(queue.length, 12);
  assert.equal(context.UI_FLOAT_MERGE.merged, 0);
  assert.ok(queue.every((e) => e._mergeKey === undefined), '第 0 級不替事件加任何合併標記');
});

test('FM-2 第 1 級＝5 合 1：每 5 次命中併成 1 個數字，傷害加總不少，第 6 次另起一個', () => {
  const { context, m, queue } = makeContext();
  m.tier = 1;
  for (let i = 0; i < 5; i++) push(context, hit(context, 0, 1000));
  assert.equal(queue.length, 1, '5 次命中只佔 1 個名額');
  assert.equal(queue[0].damageValue, 5000);
  assert.equal(queue[0].text, context.fmt(5000), '文字用加總重組');
  assert.equal(m.merged, 4);

  push(context, hit(context, 0, 1000));
  assert.equal(queue.length, 2, '吸滿 5 個就不再吸，第 6 次另起新的');
  assert.equal(queue[1].damageValue, 1000);
});

test('FM-3 第 2 級＝25 合 1（5 合 1 的再 5 合 1）：上限 25 次命中', () => {
  const { context, m, queue } = makeContext();
  m.tier = 2;
  for (let i = 0; i < 25; i++) push(context, hit(context, 0, 10));
  assert.equal(queue.length, 1);
  assert.equal(queue[0].damageValue, 250);
  push(context, hit(context, 0, 10));
  assert.equal(queue.length, 2, '第 26 次另起新的');
});

test('FM-4 只併「同一目標、同一類別、同一前綴」：不同的各自保留', () => {
  const { context, m, queue } = makeContext();
  m.tier = 1;
  push(context, hit(context, 0, 100));
  push(context, hit(context, 1, 100));                                                    // 不同目標
  push(context, hit(context, 0, 100, { cls: 'crit enemy-skill' }));                        // 暴擊
  push(context, hit(context, 0, 100, { cls: 'crit enemy-skill crit-high-roll' }));         // 高倍率暴擊是另一種字
  push(context, hit(context, 0, 100, { cls: 'dmg enemy-attack' }));                        // 普攻
  push(context, hit(context, 0, 100, { text: '格擋 ' + context.fmt(100) }));               // 格擋前綴
  push(context, hit(context, 0, 100, { text: '反擊 ' + context.fmt(100) }));               // 反擊前綴
  assert.equal(queue.length, 7, '7 種組合沒有任何兩個互併');
  push(context, hit(context, 0, 100));                                                     // 與第一個同鍵
  assert.equal(queue.length, 7);
  assert.equal(queue[0].damageValue, 200);
});

test('FM-5 不同的連擊群組編號（damage-group-*）照樣併在一起', () => {
  const { context, m, queue } = makeContext();
  m.tier = 1;
  push(context, hit(context, 0, 100, { cls: 'dmg enemy-attack damage-group-a1' }));
  push(context, hit(context, 0, 100, { cls: 'dmg enemy-attack damage-group-b2' }));
  assert.equal(queue.length, 1);
  assert.equal(queue[0].damageValue, 200);
});

test('FM-6 不是「敵人身上的傷害數字」的一律不動（我方、玩家事件、MISS、文字對不上數值）', () => {
  const { context, m, queue } = makeContext();
  m.tier = 2;
  const cases = [
    hit(context, 0, 100, { elId: 'pv-float' }),                                 // 我方身上
    hit(context, 0, 100, { elId: 'tp-float' }),
    hit(context, 0, 100, { cls: 'player-event skill-cast skill-cast-total' }),  // 技能名稱＋總傷害
    { kind: 'float', elId: 'mv-float-0', text: 'MISS', cls: 'miss enemy-dodge' },
    hit(context, 0, 100, { damageValue: undefined }),
    hit(context, 0, 100, { damageValue: 0 }),
    hit(context, 0, 100, { damageValue: -5, text: '-5' }),
    hit(context, 0, 100, { damageValue: NaN }),
    hit(context, 0, 100, { text: context.fmt(100) + '!' }),                      // 數字不在結尾
    hit(context, 0, 100, { text: context.fmt(999) }),                             // 文字與數值對不上
    hit(context, 0, 100, { text: '2' + context.fmt(100) })                        // 前綴帶數字：不是「前綴＋數字」的樣子
  ];
  cases.forEach((ev) => { push(context, ev); push(context, Object.assign({}, ev)); });
  assert.equal(queue.length, cases.length * 2, '每一件都原樣入列，沒有被吸收');
  assert.equal(m.merged, 0);
});

test('FM-7 塔戰 BOSS 的 tb-float 也會併（DOM 與 Canvas 共用同一條佇列）', () => {
  const { context, m, queue } = makeContext();
  m.tier = 1;
  push(context, hit(context, 0, 100, { elId: 'tb-float' }));
  push(context, hit(context, 0, 100, { elId: 'tb-float' }));
  assert.equal(queue.length, 1);
});

test('FM-8 洪水：一個 5Hz 批次 700 件命中、50 隻敵人，第 1 級把佇列壓到遠低於上限，總傷害一點不少', () => {
  const { context, m, queue } = makeContext();
  m.tier = 1;
  let sum = 0;
  for (let i = 0; i < 700; i++) { const v = 100 + (i % 7); sum += v; push(context, hit(context, i % 50, v)); }
  assert.equal(totalOf(queue), sum);
  assert.ok(queue.length <= 50 * 3, '每隻 14 次命中，5 合 1 ＝ 3 個（實際 ' + queue.length + '）');
  assert.equal(context.UI_VISUAL_DIAG.queueCap, 0, '沒有丟字');
});

test('FM-9 空佇列的飄字入列時沿用原物件（不複製），首件事件保有第一次命中的入列時刻', () => {
  const { context, m, queue, clock } = makeContext();
  m.tier = 1;
  const first = hit(context, 0, 100);
  push(context, first);
  clock.now += 300;
  push(context, hit(context, 0, 100));
  assert.equal(queue[0], first);
  assert.equal(first._qAt, 10000, '過期判斷看第一次命中，不會因為併進新命中而延壽');
});

/* ---------- 離開佇列後不可再被吸收 ---------- */

test('FM-10 被 flush 處理掉的那一則不再吸收：之後的命中另起新的，不會憑空消失', () => {
  const { context, m, queue, shown, clock } = makeContext();
  m.tier = 1;
  push(context, hit(context, 0, 100));
  push(context, hit(context, 0, 100));
  context.flushWorkerVisualEvents();
  assert.equal(shown.length, 1);
  assert.equal(shown[0].damageValue, 200);

  clock.now += 16;
  push(context, hit(context, 0, 100));
  assert.equal(queue.length, 1, '新的命中進了佇列');
  context.flushWorkerVisualEvents();
  assert.equal(shown.length, 2);
  assert.equal(shown[1].damageValue, 100);
  assert.deepEqual(Object.keys(m.open), [], '處理完登記表是空的');
});

test('FM-11 被佇列滿了擠掉的那一則不再吸收：命中不會併進已經丟掉的數字裡', () => {
  const { context, m, queue } = makeContext({ max: 2 });
  m.tier = 1;
  push(context, hit(context, 0, 100));     // A（可吸收）
  push(context, hit(context, 1, 100));     // B
  push(context, hit(context, 2, 100));     // 滿了：最舊的 A 被擠掉
  assert.deepEqual(queue.map((e) => e.elId), ['mv-float-1', 'mv-float-2']);
  assert.equal(m.open['mv-float-0|dmg enemy-skill|'], undefined, 'A 的登記被清掉');
  push(context, hit(context, 0, 100));     // 新的目標 0 命中：另起新的，不是併進 A
  assert.equal(queue.some((e) => e.elId === 'mv-float-0' && e.damageValue === 100), true);
});

test('FM-12 畫面被隱藏、整批佇列清空時，登記表一併清空', () => {
  const { context, m, queue } = makeContext();
  m.tier = 1;
  push(context, hit(context, 0, 100));
  assert.equal(Object.keys(m.open).length, 1);
  context.uiRenderingSuspended = () => true;
  context.rememberBackgroundEnemyFloat = () => {};
  context.flushWorkerVisualEvents();
  assert.equal(queue.length, 0);
  assert.deepEqual(Object.keys(m.open), []);
  context.uiRenderingSuspended = () => false;
  push(context, hit(context, 0, 100));
  assert.equal(queue.length, 1);
  assert.equal(queue[0].damageValue, 100, '清空後的命中不會併進已經不存在的那一則');
});

test('FM-13 降級後，已經吸得比新上限多的那一則不再吸收', () => {
  const { context, m, queue } = makeContext();
  m.tier = 2;
  for (let i = 0; i < 20; i++) push(context, hit(context, 0, 10));
  assert.equal(queue[0].damageValue, 200);
  m.tier = 1;
  push(context, hit(context, 0, 10));
  assert.equal(queue.length, 2, '已經有 20 次，超過 5 合 1 的上限，新命中另起');
});

/* ---------- 分級：丟字驅動 ---------- */

test('FM-14 分級：丟字 → 5 合 1 → 還丟 → 25 合 1 → 還丟維持 25 合 1（之後就是原本的丟棄）', () => {
  const env = makeContext();
  const { context, m } = env;
  context.uiFloatMergeStep(env.clock.now);                     // 第一次評估只開窗
  assert.equal(m.tier, 0);

  runWindow(env, 3000, 3);
  assert.equal(m.tier, 1, '開始丟字 → 5 合 1');

  runWindow(env, 3000, 3);
  assert.equal(m.tier, 1, '剛升級不到 holdMs，先觀察');

  runWindow(env, 3000, 3);
  assert.equal(m.tier, 2, '5 合 1 之後還丟 → 25 合 1');

  runWindow(env, 3000, 3);
  runWindow(env, 3000, 3);
  assert.equal(m.tier, 2, '25 合 1 已經是最高一級');
  assert.equal(m.tiers[m.tier], 25);
});

test('FM-15 零星丟一兩件字不升級（要一個評估窗內丟到 escalateDrops 件）', () => {
  const env = makeContext();
  env.context.uiFloatMergeStep(env.clock.now);
  for (let i = 0; i < 12; i++) runWindow(env, 3000, 2);        // 負載很高，但每窗只丟 2 件
  assert.equal(env.m.tier, 0);
});

test('FM-15b 評估窗：丟字分散在好幾個畫格裡，累計到窗結束才一起判斷（不是逐格看）', () => {
  const { context, m, clock } = makeContext();
  context.uiFloatMergeStep(clock.now);                       // 開窗
  for (let frame = 1; frame <= 4; frame++) {
    clock.now += 100;
    m.arrivals += 300;                                      // 3000 件/秒
    context.uiFloatMergeNoteDrop(clock.now);                // 每格只丟 1 件，單格看永遠不到 3 件
    context.uiFloatMergeStep(clock.now);
  }
  assert.equal(m.tier, 0, '窗還沒結束（400ms），先不判斷');
  clock.now += 150;
  m.arrivals += 450;
  context.uiFloatMergeStep(clock.now);
  assert.equal(m.tier, 1, '窗結束：4 件 ≥ 3 件門檻 → 升級');
});

test('FM-15c 負載太低（< minRate）時丟字不是洪水造成的：不升級，也不記下升級基準', () => {
  const env = makeContext();
  env.context.uiFloatMergeStep(env.clock.now);
  for (let i = 0; i < 10; i++) runWindow(env, 100, 20);        // 每秒才 100 件、卻丟了 40 件/秒
  assert.equal(env.m.tier, 0);
  assert.deepEqual(Array.from(env.m.escRate), [0, 0, 0]);
});

test('FM-15d 畫面剛從停擺恢復：積壓補畫造成的丟字（佇列與同屏淘汰）兩個窗內不計', () => {
  const state = { evicted: 0 };
  const env = makeContext({ renderer: { floatEvictedCount: () => state.evicted } });
  const { context, m, clock } = env;
  context.uiFloatMergeStep(clock.now);
  runWindow(env, 3000, 0);

  clock.now += 20000;                                          // 停了 20 秒後的第一次 flush
  m.arrivals += 60000;
  context.uiFloatMergeStep(clock.now, true);
  state.evicted += 40;                                         // 補畫積壓，同屏上限被頂爆
  context.uiFloatMergeNoteDrop(clock.now);
  context.uiFloatMergeNoteDrop(clock.now + 5);
  clock.now += 100; context.uiFloatMergeStep(clock.now);
  runWindow(env, 3000, 0);
  runWindow(env, 3000, 0);
  assert.equal(m.drops, 0, '安靜期內的丟字完全不計');
  assert.equal(m.tier, 0);

  state.evicted += 5; clock.now += 600; m.arrivals += 1800;   // 安靜期過後的淘汰照常計
  context.uiFloatMergeStep(clock.now);
  assert.equal(m.drops, 5);
});

test('FM-15e flush 把「距離上次 flush 太久」傳給評估：停擺後的第一次 flush 才開安靜期', () => {
  const live = makeContext();                                  // 預設：上一次 flush 是 10ms 前
  live.context.flushWorkerVisualEvents();
  assert.equal(live.m.quietUntil, 0);

  const stalled = makeContext();
  stalled.context.UI_VISUAL_DIAG.lastFlushAt = stalled.clock.now - 30000;
  stalled.context.flushWorkerVisualEvents();
  assert.equal(stalled.m.quietUntil, stalled.clock.now + 2 * stalled.m.windowMs);
});

test('FM-16 恢復：丟字停了 calmMs 才降一級，一級一級降，中途又丟字就重新計時', () => {
  const { context, m, clock } = makeContext();
  m.tier = 2; m.changedAt = clock.now; m.lastDropAt = clock.now; m.windowAt = clock.now;

  clock.now += 3900; context.uiFloatMergeStep(clock.now);
  assert.equal(m.tier, 2, '不到 calmMs 不降');

  clock.now += 600; context.uiFloatMergeStep(clock.now);     // 評估窗 500ms：要隔一個窗才會重算
  assert.equal(m.tier, 1, '滿 calmMs 降一級');

  clock.now += 600; context.uiFloatMergeStep(clock.now);
  assert.equal(m.tier, 1, '一級一級降：剛降完不會緊接著再降，要再安靜 calmMs');

  clock.now += 3000; context.uiFloatMergeNoteDrop(clock.now);       // 中途丟了一件（不到升級門檻）
  clock.now += 1500; context.uiFloatMergeStep(clock.now);
  assert.equal(m.tier, 1, '那一件丟字讓「沒丟字」的計時重來，離上次丟字才 1.5 秒，不降');

  clock.now += 4100; context.uiFloatMergeStep(clock.now);
  assert.equal(m.tier, 0, '又安靜超過 calmMs，降回第 0 級');
});

/* 一個評估窗（500ms）：arrivalsPerSec 件/秒的飄字到達，並丟 drops 件 */
function runWindow(env, arrivalsPerSec, drops) {
  env.clock.now += 500;
  env.context.UI_FLOAT_MERGE.arrivals += Math.round(arrivalsPerSec / 2);
  for (let i = 0; i < (drops || 0); i++) env.context.uiFloatMergeNoteDrop(env.clock.now);
  env.context.uiFloatMergeStep(env.clock.now);
}

test('FM-26 負載沒降就不降級：合併讓丟字歸零，但那不代表洪水退了（實測會每 5 秒振盪一次）', () => {
  const env = makeContext();
  env.context.uiFloatMergeStep(env.clock.now);                 // 開窗
  runWindow(env, 3300, 5);                                     // 3300 件/秒，丟字 → 5 合 1
  assert.equal(env.m.tier, 1);
  assert.equal(env.m.escRate[1], 3300, '記下升級當下的負載');

  for (let i = 0; i < 60; i++) runWindow(env, 3300, 0);        // 30 秒、同樣的負載、合併把丟字壓到 0
  assert.equal(env.m.tier, 1, '負載還在，不能因為「沒在丟字」就降級');
});

test('FM-27 負載掉到升級時的 7 成以下、又安靜滿 calmMs，才降一級', () => {
  const env = makeContext();
  env.context.uiFloatMergeStep(env.clock.now);
  runWindow(env, 3300, 5);
  assert.equal(env.m.tier, 1);

  for (let i = 0; i < 30; i++) runWindow(env, 2600, 0);         // 79%：還沒降到 7 成以下
  assert.equal(env.m.tier, 1);

  for (let i = 0; i < 7; i++) runWindow(env, 2000, 0);          // 61%，但只有 3.5 秒
  assert.equal(env.m.tier, 1, '安靜不滿 calmMs');
  for (let i = 0; i < 3; i++) runWindow(env, 2000, 0);
  assert.equal(env.m.tier, 0, '負載降下來且滿 4 秒 → 降級');
});

test('FM-28 降級用的基準是「升上目前這一級」時的負載，兩級各記各的', () => {
  const env = makeContext();
  env.context.uiFloatMergeStep(env.clock.now);
  runWindow(env, 2000, 5);                                      // 2000 件/秒 → 5 合 1
  runWindow(env, 6000, 5);                                      // 負載升到 6000 還在丟，但剛升級 500ms，還在觀察期
  assert.equal(env.m.tier, 1);
  runWindow(env, 6000, 5);                                      // 觀察期滿（1 秒）→ 25 合 1
  assert.equal(env.m.tier, 2);
  assert.equal(env.m.escRate[1], 2000);
  assert.equal(env.m.escRate[2], 6000);

  for (let i = 0; i < 20; i++) runWindow(env, 3000, 0);         // 3000 < 6000×0.7：第 2 級可以降
  assert.equal(env.m.tier, 1, '25 合 1 → 5 合 1');
  for (let i = 0; i < 40; i++) runWindow(env, 3000, 0);         // 3000 > 2000×0.7：第 1 級不能降
  assert.equal(env.m.tier, 1);
});

test('FM-29 queueWorkerVisualEvent 為每則飄字累計到達數（含被吸收的），特效不算', () => {
  const { context, m } = makeContext();
  m.tier = 1;
  for (let i = 0; i < 7; i++) push(context, hit(context, 0, 100));
  push(context, { kind: 'vfx', fxKind: 'projectile', variant: 'x' });
  assert.equal(m.arrivals, 7, '被吸收的 6 則也算到達');
});

test('FM-17 渲染器的同屏淘汰（MAX_FLOATS）也算丟字，用累計值取差', () => {
  const state = { evicted: 0 };
  const env = makeContext({ renderer: { floatEvictedCount: () => state.evicted } });
  const { context, m } = env;
  context.uiFloatMergeStep(env.clock.now);
  assert.equal(m.tier, 0);

  state.evicted = 2; runWindow(env, 3000, 0);
  assert.equal(m.tier, 0, '2 件不到門檻');

  state.evicted = 12; runWindow(env, 3000, 0);
  assert.equal(m.tier, 1, '一個窗內淘汰 10 件 → 5 合 1');
  assert.equal(m.evictedSeen, 12);

  runWindow(env, 3000, 0);
  assert.equal(m.tier, 1, '累計值沒再增加就不是新的丟字');
});

test('FM-18 沒有 BattleRenderer（或沒有計數函式）時不丟例外', () => {
  const a = makeContext();
  assert.doesNotThrow(() => a.context.uiFloatMergeStep(a.clock.now));
  const b = makeContext({ renderer: {} });
  assert.doesNotThrow(() => b.context.uiFloatMergeStep(b.clock.now));
});

/* ---------- 什麼算「丟字」 ---------- */

test('FM-19 佇列滿了：擠掉飄字、或飄字被丟，才推動分級；擠掉特效不算', () => {
  const shotEv = () => ({ kind: 'vfx', fxKind: 'projectile', variant: 'ice-arrow-pierce' });
  const floatEv = () => ({ kind: 'float', elId: 'pv-float', text: 'x', cls: 'dmg' });

  const floatsFull = makeContext({ max: 2 });
  push(floatsFull.context, floatEv()); push(floatsFull.context, floatEv());
  push(floatsFull.context, floatEv());
  assert.equal(floatsFull.m.drops, 1, '飄字擠飄字');

  const shotsIn = makeContext({ max: 2 });
  push(shotsIn.context, floatEv()); push(shotsIn.context, floatEv());
  push(shotsIn.context, shotEv());
  assert.equal(shotsIn.m.drops, 1, '特效進來擠掉的是飄字');

  const shotsFull = makeContext({ max: 2 });
  push(shotsFull.context, shotEv()); push(shotsFull.context, shotEv());
  push(shotsFull.context, shotEv());
  assert.equal(shotsFull.m.drops, 0, '滿佇列都是特效、擠掉的也是特效：與飄字無關');
  assert.equal(shotsFull.context.UI_VISUAL_DIAG.queueCap, 1, '但照舊記為佇列丟棄');

  const floatIntoShots = makeContext({ max: 2 });
  push(floatIntoShots.context, shotEv()); push(floatIntoShots.context, shotEv());
  push(floatIntoShots.context, floatEv());
  assert.equal(floatIntoShots.m.drops, 1, '飄字撞上全是特效的佇列：丟進來的那件飄字');
});

test('FM-19b 畫面停擺（沒在 flush）時佇列滿了：照舊記停幀，但不推動合併分級', () => {
  const env = makeContext({ max: 2 });
  env.context.UI_VISUAL_DIAG.lastFlushAt = env.clock.now - 30000;   // 30 秒沒 flush ＝ rAF 停了
  for (let i = 0; i < 10; i++) push(env.context, hit(env.context, i, 100));
  assert.equal(env.context.UI_VISUAL_DIAG.stallDrops, 8);
  assert.equal(env.m.drops, 0, '停擺期間丟的字不算洪水');
});

test('FM-15f 第一次評估只開窗：不拿累積值（頁面載入以來的毫秒數當跨度）去升級', () => {
  const { context, m, clock } = makeContext();
  m.arrivals = 100000;
  for (let i = 0; i < 10; i++) context.uiFloatMergeNoteDrop(clock.now);
  context.uiFloatMergeStep(clock.now);
  assert.equal(m.tier, 0);
  assert.equal(m.windowAt, clock.now, '只是把窗開在現在');
  assert.equal(m.seenDrops, 10, '之前累積的丟字不算進第一個窗');
});

test('FM-20 排太久而過期的飄字算丟字；畫面停擺期間丟的不算', () => {
  const live = makeContext();
  live.queue.push({ kind: 'float', elId: 'mv-float-0', text: '1', cls: 'dmg', damageValue: 1, _qAt: live.clock.now - 2000 });
  live.context.flushWorkerVisualEvents();
  assert.equal(live.m.drops, 1);

  const stalled = makeContext();
  stalled.context.UI_VISUAL_DIAG.lastFlushAt = stalled.clock.now - 30000;
  stalled.queue.push({ kind: 'float', elId: 'mv-float-0', text: '1', cls: 'dmg', damageValue: 1, _qAt: stalled.clock.now - 29000 });
  stalled.context.flushWorkerVisualEvents();
  assert.equal(stalled.m.drops, 0, '那段時間本來就沒在畫');
  assert.equal(stalled.context.UI_VISUAL_DIAG.stallDrops, 1);
});

/* ---------- 端到端 ---------- */

test('FM-21 端到端：丟字使分級升級後，同樣的洪水不再丟字，畫面上拿到的是加總過的數字', () => {
  const { context, m, shown, clock, queue } = makeContext({ max: 100 });
  const wave = () => { for (let i = 0; i < 400; i++) push(context, hit(context, i % 20, 100)); };

  context.flushWorkerVisualEvents();     // 第一次 flush 只開窗

  // 第 0 級：400 件撞上上限 100，最舊的被擠掉
  wave();
  assert.ok(context.UI_VISUAL_DIAG.queueCap >= 300, '平常的行為不變：滿了就丟最舊的');
  assert.ok(m.drops >= 300);

  // flush 看到丟字 → 升級（0.6 秒內到達 400 件＝約 670 件/秒，高於 minRate）
  clock.now += 600;
  context.flushWorkerVisualEvents();
  assert.equal(m.tier, 1);
  queue.length = 0; m.open = Object.create(null);
  context.UI_VISUAL_DIAG.queueCap = 0;
  shown.length = 0;

  clock.now += 16;
  wave();
  assert.equal(context.UI_VISUAL_DIAG.queueCap, 0, '5 合 1 之後同樣的洪水一件都沒丟');
  assert.equal(queue.length, 20 * 4, '每隻 20 次命中 ÷ 5 ＝ 4 個');
  context.flushWorkerVisualEvents();
  assert.equal(shown.reduce((s, e) => s + e.damageValue, 0), 400 * 100, '總傷害一點不少');
  assert.ok(shown.every((e) => e.damageValue === 500 && e.text === context.fmt(500)));
});

test('FM-22 FPS 計數器：合併進行中會標示目前的合併比', () => {
  const { context, m } = makeContext();
  assert.equal(context.uiVisualDiagText(50000), '');
  m.tier = 1; m.merged = 37;
  assert.match(context.uiVisualDiagText(50000), /傷害合併 5 合 1（已併 37）/);
  m.tier = 2;
  assert.match(context.uiVisualDiagText(50000), /傷害合併 25 合 1/);
});

/* ---------- 契約 ---------- */

test('FM-23 渲染器匯出 floatEvictedCount，且讀的是淘汰計數（ui.js 靠它偵測同屏丟字）', () => {
  assert.match(rendererSrc, /floatEvictedCount:\s*function\s*\(\)\s*\{\s*return S\.floatEvicted;\s*\}/);
  assert.match(rendererSrc, /S\.floatEvicted\+\+/);
});

test('FM-24 預設參數就是使用者規格：5 合 1、再 5 合 1 ＝ 25 合 1，沒有第四級', () => {
  const { m } = makeContext();
  assert.deepEqual(Array.from(m.tiers), [1, 5, 25]);
});
