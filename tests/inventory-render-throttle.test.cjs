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
  // 模擬「剛剛畫過一次」，之後的判定才有基準
  const markRendered = () => { context._invRenderedAt = clock.now; };
  return { context, clock, doc, grid, markRendered };
}

test('三個節流參數都存在且大小關係合理', () => {
  assert.ok(IDLE > 0 && HOVER > 0 && INTERACT > 0);
  assert.ok(HOVER > IDLE, '指標停在格線上時的間隔必須比純掛機長，那時重建的代價最高');
});

test('玩家一操作就立刻允許重繪，不受節流影響', () => {
  const env = loadThrottle();
  env.context.inventoryRenderAllowed();      // 首次呼叫順便掛上監聽器
  env.markRendered();

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
  env.context.inventoryRenderAllowed();
  env.markRendered();
  env.clock.now += 50;

  env.doc.keydown.fn();
  assert.equal(env.context.inventoryRenderAllowed(), true);
  assert.equal(env.doc.pointerdown.capture, true,
    '要用捕獲階段收全部輸入，否則漏掉的控制項會變成「按了要等一秒」');
  assert.equal(env.doc.keydown.capture, true);
});

test('純掛機時每秒最多重繪一次，而且是延後不是丟棄', () => {
  const env = loadThrottle();
  env.context.inventoryRenderAllowed();
  env.markRendered();

  env.clock.now += IDLE - 1;
  assert.equal(env.context.inventoryRenderAllowed(), false);

  env.clock.now += 1;
  assert.equal(env.context.inventoryRenderAllowed(), true,
    '間隔一到就必須放行——跳過的那幾次不能讓背包永遠不更新');
});

test('指標停在背包格線上時拉長間隔，離開後恢復', () => {
  const env = loadThrottle();
  env.context.inventoryRenderAllowed();
  env.markRendered();

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

test('uiTick：被節流跳過時不得清掉 dirty.inv', () => {
  const src = functionBody('uiTick');
  assert.match(src, /if \(d\.inv && UI\.tab === 'equip' && inventoryRenderAllowed\(\)\) \{[\s\S]*?renderInventory\(\);[\s\S]*?d\.inv = false;[\s\S]*?\n  \}/,
    'd.inv = false 必須在「真的畫了」的分支內；跳過時清掉等於把那次更新丟掉');
  assert.doesNotMatch(src, /if \(d\.inv && UI\.tab === 'equip'\) \{ renderInventory\(\); d\.inv = false; \}/,
    '舊的無節流寫法應已移除');
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
