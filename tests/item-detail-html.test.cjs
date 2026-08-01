const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

/* itemDetailHTML 必須是純函式：主執行緒（Worker 架構下沒有 G）與 Worker 兩邊都要能呼叫。
   它一旦讀 G，ui.js 就用不了它；而 ui.js 用不了它的結果，就是那邊長出第二套簡化實作，
   然後兩份慢慢分歧——掉寶率沒換算、同 key 詞條不合併等顯示錯誤就是這樣來的。
   這支測試把「純函式」這件事釘住。 */
function loadItemContext() {
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  // 刻意不定義 G：讀到就是 ReferenceError，測試會直接失敗
  return context;
}

function makeItem(over) {
  return Object.assign({
    id: 'it-1', name: '測試劍', rarity: 5, slot: 'weapon', level: 50,
    upgrade: 0, locked: false, affixes: [], sockets: [], enchants: []
  }, over || {});
}

test('不讀取 G——沒有 G 的環境下也能產生完整詳情', () => {
  const c = loadItemContext();
  const it = makeItem({ affixes: [{ key: 'atkFlat', val: 10 }] });
  const html = c.itemDetailHTML(it, null, { showAffixReroll: true, gold: 999999, essence: 999 });
  assert.match(html, /測試劍/);
  assert.match(html, /評分/, '標題列應有評分');
  assert.match(html, /btn-it-pool/, '應有詞條池按鈕');
  assert.match(html, /afx-/, '詞條應有分類分色 class');
  assert.match(html, /洗煉區間/, '詞條應有洗煉區間提示');
});

test('洗煉花費依傳入的餘額標示不足，未提供餘額時不標紅', () => {
  const c = loadItemContext();
  const it = makeItem({ affixes: [{ key: 'atkFlat', val: 10 }] });
  const cost = c.rerollCost(it);

  const rich = c.itemDetailHTML(it, null, { gold: cost.gold, essence: cost.essence });
  const poor = c.itemDetailHTML(it, null, { gold: cost.gold - 1, essence: 0 });
  const unknown = c.itemDetailHTML(it, null, {});

  assert.doesNotMatch(rich, /fca5a5/, '買得起不應標紅');
  assert.match(poor, /fca5a5/, '買不起應標紅');
  assert.doesNotMatch(unknown, /fca5a5/,
    '不知道餘額時標紅等於對玩家謊報買不起');
});

test('渲染不得改動傳入的物品（不補鑲孔、不寫任何欄位）', () => {
  const c = loadItemContext();
  const it = makeItem({ affixes: [{ key: 'atkFlat', val: 10 }], sockets: [] });
  const before = JSON.stringify(it);
  c.itemDetailHTML(it, null, { gold: 0, essence: 0 });
  assert.equal(JSON.stringify(it), before, '渲染函式有副作用＝畫面更新時順便改狀態');
});

test('掉寶率詞條顯示經 effectiveDropRateEffect 換算後的實際生效值', () => {
  const c = loadItemContext();
  const it = makeItem({ affixes: [{ key: 'loot', val: 20 }] });
  const html = c.itemDetailHTML(it, null, {});
  const shown = c.effectiveDropRateEffect(20); // 20 × 0.5 = 10
  assert.equal(c.DROP_RATE_EFFECT_MULT, 0.5);
  assert.match(html, new RegExp('\\+<span[^>]*>' + shown + '%|\\+' + shown + '%'),
    `掉寶率應顯示實際生效的 ${shown}%，不是詞條原值 20%`);
  assert.doesNotMatch(html, /\+20%/, '顯示原值會讓玩家高估一倍');
});

test('同 key 詞條合併累加成一行', () => {
  const c = loadItemContext();
  const it = makeItem({ affixes: [{ key: 'atkFlat', val: 10 }, { key: 'atkFlat', val: 5 }] });
  // 關掉洗煉區塊，否則詞條池模板也會列出「物理攻擊」這個可能詞條，混進計數裡
  const html = c.itemDetailHTML(it, null, { showAffixReroll: false });
  const named = (html.match(/物理攻擊/g) || []).length;
  assert.equal(named, 1, `同 key 應合併成一行，實際 ${named} 行`);
  assert.match(html, /\+<span[^>]*>15<\/span>|\+15/, '數值應為兩者相加');
});

test('滿值詞條金色高亮', () => {
  const c = loadItemContext();
  const limits = c.getAffixLimits('atkFlat', 50, 5);
  const it = makeItem({ affixes: [{ key: 'atkFlat', val: limits.max }] });
  assert.match(c.itemDetailHTML(it, null, {}), /fbbf24/);
});

test('裝備等級文字依每 50 級套用品質色，超過最高品質固定最高色', () => {
  const c = loadItemContext();
  const cases = [
    [1, 0], [49, 0], [50, 1], [99, 1], [100, 2],
    [c.RARITIES.length * 50, c.RARITIES.length - 1],
    [c.RARITIES.length * 50 + 50, c.RARITIES.length - 1]
  ];

  cases.forEach(([level, rarity]) => {
    assert.equal(c.equipmentLevelRarityIndex(level), rarity, `Lv.${level} 應對應 R${rarity}`);
    const html = c.itemDetailHTML(makeItem({ level }), null, {});
    assert.match(html, new RegExp('class="it-level" style="color:' + c.RARITIES[rarity].color.replace('#', '\\#') + '">等級 ' + level + '<'));
  });
});

test('ui.js 三個裝備詳情呼叫點共用 itemDetailHTML', () => {
  const uiSrc = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.doesNotMatch(uiSrc, /\buiItemDetailHTML\b/,
    'ui.js 不得保留或呼叫簡化重寫的 uiItemDetailHTML');

  const callers = uiSrc.match(/\bitemDetailHTML\s*\(/g) || [];
  assert.equal(callers.length, 3, '裝備面板與兩張 tooltip 卡片應共用三個 itemDetailHTML 呼叫點');

  const nullCmpCallers = uiSrc.match(/\bitemDetailHTML\s*\([^,]+,\s*null,\s*\{/g) || [];
  assert.equal(nullCmpCallers.length, 3, '三個呼叫點的 cmp 第二參數都必須是 null');

  const detailCallBlocks = uiSrc.match(/\bitemDetailHTML\s*\([^;]+?\}\)/gs) || [];
  assert.equal(detailCallBlocks.length, 3);
  detailCallBlocks.forEach((call, index) => {
    assert.match(call, /\bgold\s*:/, `第 ${index + 1} 個呼叫點必須傳入 headerSnapshot.player.gold`);
    assert.match(call, /\bessence\s*:/, `第 ${index + 1} 個呼叫點必須傳入 headerSnapshot.player.essence`);
  });
});
