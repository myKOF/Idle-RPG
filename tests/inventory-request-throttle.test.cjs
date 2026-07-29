'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

/* 掛機時 Worker 幾乎每個 tick 都把 inv 標記為髒，主執行緒於是每秒索取 5 次背包面板。
   每一次的代價是一整條鏈：Worker 重建 427 件投影（實測 122 KB）→ 跨執行緒複製 →
   格線比對 → 整份重建 DOM。實測 20 秒重建 60 次、累計 829 ms，佔全部渲染的 84%。

   節流放在請求端。最重要的安全性質是：**指令自己要的那次請求絕對不能被擋**——
   sendUiCommand 會把該次請求的序號記進 waitPanels，等對應回應才放開單飛鎖；
   請求被吞掉，鎖就永遠不會釋放，玩家的背包按鈕會全部失效。那是實際發生過的事故。 */

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

function constValue(name) {
  const m = ui.match(new RegExp('var\\s+' + name + '\\s*=\\s*(\\d+)\\s*;'));
  assert.ok(m, 'missing const ' + name);
  return Number(m[1]);
}

const IDLE = constValue('INV_REQ_IDLE_MS');
const HOVER = constValue('INV_REQ_HOVER_MS');
const INTERACT = constValue('INV_REQ_INTERACT_MS');

function loadGate() {
  const clock = { now: 2000000 };
  const doc = {};
  const grid = {};
  const box = { addEventListener(ev, fn) { grid[ev] = fn; } };
  const context = {
    Date: { now: () => clock.now },
    document: { addEventListener(ev, fn, capture) { doc[ev] = { fn, capture }; } },
    $id: (id) => (id === 'inventory-grid' ? box : null),
    INV_REQ_IDLE_MS: IDLE, INV_REQ_HOVER_MS: HOVER, INV_REQ_INTERACT_MS: INTERACT,
    _invReqAt: 0, _invReqInteractAt: 0, _invReqPointerInGrid: false,
    _invReqPending: false, _invReqBound: false
  };
  vm.createContext(context);
  vm.runInContext(
    [functionBody('bindInventoryRequestThrottle'),
     functionBody('inventoryPassiveRequestAllowed'),
     functionBody('noteInventoryPanelRequested')].join('\n'),
    context
  );
  // 首次呼叫會綁監聽器並把「頁面剛載入」視同互動；先跨過那段寬限期再驗節流
  const settle = () => {
    context.inventoryPassiveRequestAllowed();
    clock.now += INTERACT + 1;
    context.noteInventoryPanelRequested();
  };
  return { context, clock, doc, grid, settle };
}

test('參數關係合理：互動視窗短於閒置間隔，hover 間隔最長', () => {
  assert.ok(INTERACT < IDLE, '互動視窗若不短於閒置間隔，視窗後半段永遠不會發揮作用');
  assert.ok(HOVER > IDLE, '指標停在格線上時重建代價最高，間隔必須更長');
});

test('純掛機時每秒最多請求一次，時間到就放行', () => {
  const env = loadGate();
  env.settle();
  env.clock.now += IDLE - 1;
  assert.equal(env.context.inventoryPassiveRequestAllowed(), false);
  env.clock.now += 1;
  assert.equal(env.context.inventoryPassiveRequestAllowed(), true, '間隔一到就必須放行');
});

test('玩家一操作就立刻放行，不受節流影響', () => {
  const env = loadGate();
  env.settle();
  env.clock.now += 50;
  assert.equal(env.context.inventoryPassiveRequestAllowed(), false, '前提：此時應被節流');

  env.doc.pointerdown.fn();
  assert.equal(env.context.inventoryPassiveRequestAllowed(), true,
    '按下去要馬上看到結果，節流不得延後玩家自己的操作');
  assert.equal(env.doc.pointerdown.capture, true, '要用捕獲階段收全部輸入');
  assert.equal(env.doc.keydown.capture, true);
});

test('指標停在背包格線上時拉長間隔，離開後恢復', () => {
  const env = loadGate();
  env.settle();
  env.grid.mouseenter();
  env.clock.now += IDLE;
  assert.equal(env.context.inventoryPassiveRequestAllowed(), false);
  env.clock.now += HOVER - IDLE;
  assert.equal(env.context.inventoryPassiveRequestAllowed(), true, '再久也只是延後，不得無限期不更新');

  env.context.noteInventoryPanelRequested();
  env.grid.mouseleave();
  env.clock.now += IDLE;
  assert.equal(env.context.inventoryPassiveRequestAllowed(), true);
});

test('noteInventoryPanelRequested 會重設間隔並清掉待辦', () => {
  const env = loadGate();
  env.context._invReqPending = true;
  env.context.noteInventoryPanelRequested();
  assert.equal(env.context._invReqPending, false);
  assert.equal(env.context._invReqAt, env.clock.now);
});

/* ---- 安全性質：指令路徑不得被節流 ---- */

test('requestPanelData 本身沒有節流——指令要的那次請求一定送得出去', () => {
  assert.doesNotMatch(functionBody('requestPanelData'), /inventoryPassiveRequestAllowed/,
    '在 requestPanelData 內節流會把指令的請求也吞掉，單飛鎖永遠不釋放、按鈕全部失效');
  const callSites = (ui.match(/inventoryPassiveRequestAllowed\(\)/g) || []).length;
  assert.equal(callSites, 3,
    '應只有兩個呼叫點（tick 髒區迴圈、uiTick 補送）加上函式自身的定義行');
});

test('被節流擋下時不標記 dirty——沒有新資料，標了只會白重繪一次', () => {
  const tickHandler = ui.slice(ui.indexOf('var dirty = msg.dirty || [];'));
  const loop = tickHandler.slice(0, tickHandler.indexOf('\n    }'));
  assert.match(loop, /if \(key === 'inv' && !inventoryPassiveRequestAllowed\(\)\) \{\s*_invReqPending = true;\s*continue;\s*\}/,
    '擋下時要記下待辦並直接 continue，不得落到 UI.dirty[key] = true');
});

/* ---- 補送 ---- */

function runUiTick(state) {
  const src = functionBody('uiTick');
  const requested = [];
  const context = {
    UI: { tab: 'equip', dirty: {}, sel: null },
    Date: { now: () => state.now },
    _titleTimer: 0,
    INV_REQ_IDLE_MS: IDLE, INV_REQ_HOVER_MS: HOVER, INV_REQ_INTERACT_MS: INTERACT,
    _invReqAt: state.reqAt || 0,
    _invReqInteractAt: state.interactAt || 0,
    _invReqPointerInGrid: false,
    _invReqPending: !!state.pending,
    _invReqBound: true,                                  // 已綁定：測試不需要 DOM
    bindInventoryRequestThrottle: function () {},
    window: { location: { hostname: 'localhost' } }       // uiTick 尾端會讀 hostname
  };
  // uiTick 呼叫到的名字一律自動補成 no-op，日後新增呼叫時測試不會因缺 stub 而假失敗
  const names = new Set([...src.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)].map((m) => m[1]));
  names.forEach((n) => { if (!(n in context)) context[n] = function () {}; });
  context.requestPanelData = (key, force) => { requested.push([key, force]); };
  vm.createContext(context);
  vm.runInContext(
    [functionBody('inventoryPassiveRequestAllowed'),
     functionBody('noteInventoryPanelRequested'), src].join('\n'),
    context
  );
  context.uiTick();
  return { context, requested };
}

test('被擋下的請求由 uiTick 補送，掉落停止後背包不會永遠停格', () => {
  const r = runUiTick({ now: 3000000, pending: true, reqAt: 3000000 - IDLE, interactAt: 0 });
  assert.deepEqual(r.requested, [['inv', true]], '待辦存在且間隔已到時必須補送');
  assert.equal(r.context._invReqPending, false, '補送後要清掉待辦');
  assert.ok(!r.context.UI.dirty.inv,
    '補送時不得標記 dirty：資料還沒回來，標了會讓同一輪 uiTick 立刻拿舊快照白重畫一次');
});

test('待辦存在但間隔未到時不補送', () => {
  const r = runUiTick({ now: 3000000, pending: true, reqAt: 3000000 - 100, interactAt: 0 });
  assert.deepEqual(r.requested, []);
  assert.equal(r.context._invReqPending, true, '待辦要留著，下一個允許的 tick 再送');
});

test('沒有待辦時 uiTick 不會主動請求背包面板', () => {
  const r = runUiTick({ now: 3000000, pending: false, reqAt: 0, interactAt: 0 });
  assert.deepEqual(r.requested, []);
});
