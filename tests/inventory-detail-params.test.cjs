'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

/* 背包格子只送 12 個欄位的投影，完整物品資料只存在於面板回應的 `details`。
   任何一次不帶 detailIds 的 inv 面板請求，回應都會把 details 洗成 null，於是
   findSelItem() 對背包物品回 null，detailAction() 第一行就 return——
   〔裝備〕〔分解〕〔強化〕〔鎖定〕四顆按鈕全部靜靜失效（點了沒反應，不是變灰）。

   所以 detailIds 必須「所有環境」都附上。它曾經和關鍵字篩選的 full 參數共用同一個
   isInternalServer() 守衛，導致外部玩家永遠拿不到——而且在 localhost 上守衛恆真，
   內測環境測不出來。這一組測試就是釘住那個環境差異。 */

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

// isInternalServer 用真的那一支，不在測試裡另抄判斷條件
function loadParams({ hostname, keyword, sel }) {
  const loc = { hostname, protocol: 'https:' };
  const context = {
    console,
    location: loc,
    window: { location: loc },
    document: {},
    UI: { sel: sel || null },
    $id: (id) => (id === 'inv-keyword-filter' ? { value: keyword || '' } : null)
  };
  vm.createContext(context);
  vm.runInContext(
    functionBody('isInternalServer') + '\n' + functionBody('activeUiPanelParams'),
    context
  );
  return context;
}

const SEL = { id: 'item-42', source: 'inv' };

// vm 內建立的物件原型與測試 realm 不同，deepStrictEqual 會因此失敗——正規化後再比
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

test('回歸：正式環境（公開網域）選取背包物品時，仍必須附上 detailIds', () => {
  const ctx = loadParams({ hostname: 'game.example.com', sel: SEL });
  assert.equal(ctx.isInternalServer(), false, '前提：這是外部環境');
  assert.deepEqual(plain(ctx.activeUiPanelParams('inv')), { detailIds: ['item-42'] },
    '拿不到 detailIds 的話，外部玩家的背包按鈕會全部失效');
});

test('內測環境選取背包物品時同樣附上 detailIds', () => {
  const ctx = loadParams({ hostname: 'localhost', sel: SEL });
  assert.equal(ctx.isInternalServer(), true);
  assert.deepEqual(plain(ctx.activeUiPanelParams('inv')), { detailIds: ['item-42'] });
});

test('關鍵字篩選仍是內測限定：正式環境不得回傳 full', () => {
  const inner = loadParams({ hostname: 'localhost', keyword: '暴擊', sel: SEL });
  assert.deepEqual(plain(inner.activeUiPanelParams('inv')), { full: true },
    '內測服有關鍵字時要整包，否則篩不到詞條');

  const outer = loadParams({ hostname: 'game.example.com', keyword: '暴擊', sel: SEL });
  assert.deepEqual(plain(outer.activeUiPanelParams('inv')), { detailIds: ['item-42'] },
    '正式環境沒有關鍵字輸入框，不得因為殘留值就要整包資料（實測 800 件整包 305KB）');
});

test('沒有選取背包物品時不附加參數', () => {
  assert.equal(loadParams({ hostname: 'game.example.com' }).activeUiPanelParams('inv'), undefined);
  assert.equal(
    loadParams({ hostname: 'game.example.com', sel: { id: 'x', source: 'equip' } })
      .activeUiPanelParams('inv'),
    undefined,
    '裝備欄物品走 equip 面板、本來就是完整物件，不需要 detailIds');
});

test('只對 inv 面板加參數', () => {
  const ctx = loadParams({ hostname: 'localhost', sel: SEL });
  ['equip', 'header', 'gems', 'skills'].forEach((k) => {
    assert.equal(ctx.activeUiPanelParams(k), undefined, k + ' 不該被加上參數');
  });
});
