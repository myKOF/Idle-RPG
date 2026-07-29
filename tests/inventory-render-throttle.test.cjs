'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

/* 掛機時掉落頻繁，UI.dirty.inv 幾乎每個 tick 都被標記，uiTick 於是每 200ms 重建整個
   背包格線。實測後期存檔（427 件）20 秒內重建 60 次、累計 829ms，佔全部渲染時間的 84%。
   代價不只是 CPU——整份重建會換掉游標底下那一格，hover 掉、tooltip 閃、點擊沒中。

   節流的三段規則不能只驗「有沒有變慢」，要驗的是**該快的地方沒有被拖慢**：
   玩家按下去必須立刻看到結果，否則這個修正會製造出比它解決的更糟的問題。 */

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

// 常數一律從原始碼取，測試不重寫數值——調參數時測試才會跟著調整而不是變成假通過
function constValue(name) {
  const m = ui.match(new RegExp('var\\s+' + name + '\\s*=\\s*(\\d+)\\s*;'));
  assert.ok(m, 'missing const ' + name);
  return Number(m[1]);
}

const IDLE = constValue('INV_IDLE_MIN_MS');
const HOVER = constValue('INV_HOVER_MIN_MS');
const INTERACT = constValue('INV_INTERACT_MS');

function loadThrottle() {
  const clock = { now: 1000000 };
  const doc = {};
  const grid = {};
  const box = { addEventListener(ev, fn) { grid[ev] = fn; } };
  const context = {
    Date: { now: () => clock.now },
    document: { addEventListener(ev, fn, capture) { doc[ev] = { fn, capture }; } },
    $id: (id) => (id === 'inventory-grid' ? box : null),
    INV_IDLE_MIN_MS: IDLE,
    INV_HOVER_MIN_MS: HOVER,
    INV_INTERACT_MS: INTERACT,
    _invRenderedAt: 0,
    _invInteractAt: 0,
    _invPointerInGrid: false,
    _invThrottleBound: false
  };
  vm.createContext(context);
  vm.runInContext(
    functionBody('bindInventoryRenderThrottle') + '\n' + functionBody('inventoryRenderAllowed'),
    context
  );
  const markRendered = () => { context._invRenderedAt = clock.now; };
  /* 首次呼叫會綁定監聽器，並把「頁面剛載入」視同互動（開機期間面板陸續抵達，
     那段不能節流）。要驗節流本身，得先跨過那段寬限期再開始。 */
  const bindAndSettle = () => {
    context.inventoryRenderAllowed();
    clock.now += INTERACT + 1;
    markRendered();
  };
  return { context, clock, doc, grid, markRendered, bindAndSettle };
}

test('頁面剛載入的寬限期內不節流，避免開機閃出空背包', () => {
  const env = loadThrottle();
  assert.equal(env.context.inventoryRenderAllowed(), true, '第一次一定要放行');
  env.markRendered();

  env.clock.now += 100;
  assert.equal(env.context.inventoryRenderAllowed(), true,
    '開機那幾百毫秒面板才陸續抵達，這段期間每一份都要畫得出來');

  env.clock.now += INTERACT;
  assert.equal(env.context.inventoryRenderAllowed(), false, '寬限期過後恢復節流');
});

test('三個節流參數都存在且大小關係合理', () => {
  assert.ok(IDLE > 0 && HOVER > 0 && INTERACT > 0);
  assert.ok(HOVER > IDLE, '指標停在格線上時的間隔必須比純掛機長，那時重建的代價最高');
});

test('玩家一操作就立刻允許重繪，不受節流影響', () => {
  const env = loadThrottle();
  env.bindAndSettle();

  env.clock.now += 50;
  assert.equal(env.context.inventoryRenderAllowed(), false, '前提：剛畫完且無互動時應被節流');

  env.doc.pointerdown.fn();                  // 玩家點了東西
  assert.equal(env.context.inventoryRenderAllowed(), true,
    '按下去要馬上看到結果——節流不得延後玩家自己的操作');

  // 互動視窗內會連續重繪好幾次；取視窗尾端那一次當基準，才驗得到「視窗過後恢復節流」
  env.clock.now += INTERACT - 100;
  assert.equal(env.context.inventoryRenderAllowed(), true, '互動視窗內一律放行');
  env.markRendered();

  env.clock.now += 200;   // 已超出互動視窗，但距上次重繪還不到閒置間隔
  assert.equal(env.context.inventoryRenderAllowed(), false, '互動視窗過後應恢復節流');
});

test('互動視窗必須短於閒置間隔，否則視窗後半段形同虛設', () => {
  assert.ok(INTERACT < IDLE,
    'INTERACT >= IDLE 時，視窗一結束閒置間隔必定也已滿足，後半段從來不會發揮作用');
});

test('鍵盤操作與點擊同等對待，且都掛在捕獲階段', () => {
  const env = loadThrottle();
  env.bindAndSettle();
  env.clock.now += 50;

  env.doc.keydown.fn();
  assert.equal(env.context.inventoryRenderAllowed(), true);
  assert.equal(env.doc.pointerdown.capture, true,
    '要用捕獲階段收全部輸入，否則漏掉的控制項會變成「按了要等一秒」');
  assert.equal(env.doc.keydown.capture, true);
});

test('純掛機時每秒最多重繪一次，而且是延後不是丟棄', () => {
  const env = loadThrottle();
  env.bindAndSettle();

  env.clock.now += IDLE - 1;
  assert.equal(env.context.inventoryRenderAllowed(), false);

  env.clock.now += 1;
  assert.equal(env.context.inventoryRenderAllowed(), true,
    '間隔一到就必須放行——跳過的那幾次不能讓背包永遠不更新');
});

test('指標停在背包格線上時拉長間隔，離開後恢復', () => {
  const env = loadThrottle();
  env.bindAndSettle();

  env.grid.mouseenter();
  env.clock.now += IDLE;
  assert.equal(env.context.inventoryRenderAllowed(), false,
    '游標在格線上時重建會把底下那一格換掉，tooltip 與點擊都會受影響');

  env.clock.now += HOVER - IDLE;
  assert.equal(env.context.inventoryRenderAllowed(), true,
    '再怎麼樣也只是延後：撐過 INV_HOVER_MIN_MS 仍要更新，不得無限延後');

  env.markRendered();
  env.grid.mouseleave();
  env.clock.now += IDLE;
  assert.equal(env.context.inventoryRenderAllowed(), true, '指標離開後回到一般間隔');
});

/* ---- uiTick 實際執行 ----
   2026-07-29 回歸：節流上線後，F5 重新載入會看到空背包（0/60），要切到別的瀏覽器分頁
   再切回來才出現。原因是被節流延後的那次重繪只留在 UI.dirty.inv 上，而 panel 回應那一側
   會在「格線內容與前一份相同」時把它清掉（bindWorkerUiState 的 inventoryGridUnchanged
   分支）——延後於是變成丟失，直到切回前景重新標記所有面板才補畫。

   所以待重繪狀態必須記在 _invRenderPending 上。這一組測試真的跑 uiTick，
   只做原始碼比對抓不到這種跨函式的互動。 */
function runUiTick(state) {
  const src = functionBody('uiTick');
  const calls = [];
  const context = {
    UI: { tab: 'equip', dirty: Object.assign({ inv: false }, state.dirty), sel: null },
    Date: { now: () => state.now },
    _titleTimer: 0,
    _invRenderedAt: state.renderedAt || 0,
    _invInteractAt: state.interactAt || 0,
    _invPointerInGrid: !!state.pointerInGrid,
    _invThrottleBound: true,          // 已綁定：測試不需要 DOM
    _invRenderPending: !!state.pending,
    INV_IDLE_MIN_MS: IDLE,
    INV_HOVER_MIN_MS: HOVER,
    INV_INTERACT_MS: INTERACT,
    bindInventoryRenderThrottle: function () {},
    window: { location: { hostname: 'localhost' } }   // uiTick 尾端會讀 hostname
  };
  /* uiTick 呼叫到的名字一律自動補成 no-op：日後那支函式新增呼叫時，
     測試不會因為少一個 stub 就變成假失敗。 */
  const names = new Set(
    [...src.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)].map((m) => m[1])
  );
  names.forEach((n) => { if (!(n in context)) context[n] = function () {}; });
  context.renderInventory = function () { calls.push('renderInventory'); };
  vm.createContext(context);
  vm.runInContext(functionBody('inventoryRenderAllowed') + '\n' + src, context);
  context.uiTick();
  return { calls, context };
}

test('回歸：延後的重繪不得因為 dirty.inv 被別處清掉而消失', () => {
  // 節流擋下一次重繪後，panel 回應把 UI.dirty.inv 清成 false——這正是 F5 空背包的成因
  const r = runUiTick({
    now: 1000000, dirty: { inv: false }, pending: true,
    renderedAt: 1000000 - IDLE - 1, interactAt: 0
  });
  assert.deepEqual(r.calls, ['renderInventory'],
    '待重繪狀態必須自己記著；只靠 dirty.inv 會在 F5 後整個背包空白');
  assert.equal(r.context._invRenderPending, false, '補畫完要把待辦清掉');
});

test('uiTick：被節流跳過時把待重繪記在 _invRenderPending 上', () => {
  const r = runUiTick({
    now: 1000000, dirty: { inv: true }, pending: false,
    renderedAt: 1000000 - 100, interactAt: 0     // 剛畫完 100ms，且無互動 → 應被擋下
  });
  assert.deepEqual(r.calls, [], '前提：這次應該被節流擋下');
  assert.equal(r.context._invRenderPending, true, '擋下時必須記下來，否則這次更新就丟了');
  assert.equal(r.context.UI.dirty.inv, true,
    '沒畫就不能清 dirty.inv——節流是延後，不是丟棄');
});

test('uiTick：允許時正常重繪並清掉兩個旗標', () => {
  const r = runUiTick({
    now: 1000000, dirty: { inv: true }, pending: false,
    renderedAt: 1000000 - IDLE, interactAt: 0
  });
  assert.deepEqual(r.calls, ['renderInventory']);
  assert.equal(r.context.UI.dirty.inv, false);
  assert.equal(r.context._invRenderPending, false);
});

test('uiTick：不在裝備頁時不碰背包格線', () => {
  const src = functionBody('uiTick');
  assert.match(src, /if \(UI\.tab === 'equip' && \(d\.inv \|\| _invRenderPending\)\)/,
    '分頁判斷必須在最外層，否則離開裝備頁時仍會被 _invRenderPending 觸發');
});

test('uiTick：舊的無節流寫法已移除', () => {
  assert.doesNotMatch(functionBody('uiTick'),
    /if \(d\.inv && UI\.tab === 'equip'\) \{ renderInventory\(\); d\.inv = false; \}/);
});

test('uiTick：節流只套用在裝備頁，熔爐與神鑄兩頁不受影響', () => {
  const src = functionBody('uiTick');
  const throttled = src.match(/inventoryRenderAllowed\(\)/g) || [];
  assert.equal(throttled.length, 1, '節流只該出現在裝備頁背包那一處');
  assert.match(src, /\(d\.newforge \|\| d\.inv \|\| d\.factory\) && UI\.tab === 'newforge'/,
    '神鑄頁仍照舊即時重繪');
  assert.match(src, /\(d\.forge \|\| d\.inv \|\| d\.gems\) && UI\.tab === 'forge'/,
    '熔爐頁仍照舊即時重繪');
});
