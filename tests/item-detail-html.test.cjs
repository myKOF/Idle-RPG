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
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/item.js'].forEach((file) => {
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

/* 詞條存檔只有強度值（js/formula.js §6），數值是算出來的。
   這些測試在意的是「顯示成什麼」，所以照舊用想要的數值描述，換算成對應強度值。
   makeItem 的預設是 Lv.50、稀有度 5，故換算以此為準。 */
function affixAt(c, key, val) {
  return { key: key, roll: c.affixStrengthFromValue(key, 50, 5, val) };
}

test('不讀取 G——沒有 G 的環境下也能產生完整詳情', () => {
  const c = loadItemContext();
  const it = makeItem({ affixes: [affixAt(c, 'atkFlat', 10)] });
  const html = c.itemDetailHTML(it, null, { showAffixReroll: true, gold: 999999, essence: 999 });
  assert.match(html, /測試劍/);
  assert.match(html, /評分/, '標題列應有評分');
  assert.match(html, /btn-it-pool/, '應有詞條池按鈕');
  assert.match(html, /afx-/, '詞條應有分類分色 class');
  assert.match(html, /洗煉區間/, '詞條應有洗煉區間提示');
});

test('洗煉模式只選屬性，不渲染骰子或逐條執行按鈕', () => {
  const c = loadItemContext();
  const it = makeItem({ affixes: [affixAt(c, 'atkFlat', 10), affixAt(c, 'str', 10)] });
  const normal = c.itemDetailHTML(it, null, {});
  const html = c.itemDetailHTML(it, null, { reroll: { active: true, selIdx: 1 } });
  [normal, html].forEach((h) => assert.doesNotMatch(h, /🎲|affix-reroll-btn|it-affix-action|data-act="reroll-affix"/));
  assert.doesNotMatch(normal, /data-reroll-pick|is-reroll-selected|is-reroll-mode/);
  assert.match(html, /it-affixes is-reroll-mode/);
  assert.deepEqual(html.match(/data-reroll-pick="\d+"/g), ['data-reroll-pick="0"', 'data-reroll-pick="1"']);
  assert.equal((html.match(/is-reroll-selected/g) || []).length, 1);
  assert.match(html, /is-reroll-selected[^>]*><div class="it-affix-text" data-reroll-pick="1"/);
});

test('洗煉模式隱藏寶石和附魔，退出恢復顯示且不改資料', () => {
  const c = loadItemContext();
  const it = makeItem({ affixes: [affixAt(c, 'atkFlat', 10)], sockets: [null], enchants: [{ key: Object.keys(c.ENCHANTS)[0], gemLv: 1 }] });
  const before = JSON.stringify(it);
  const normal = c.itemDetailHTML(it, null, {});
  assert.match(normal, /it-sockets/);
  assert.match(normal, /it-enchant/);
  const focused = c.itemDetailHTML(it, null, { reroll: { active: true, selIdx: 0 } });
  assert.doesNotMatch(focused, /it-sockets|it-enchant|data-socket-remove|data-enchant-remove/);
  assert.match(focused, /data-reroll-pick/);
  assert.equal(c.itemDetailHTML(it, null, {}), normal);
  assert.equal(JSON.stringify(it), before);
});

test('渲染不得改動傳入的物品（不補鑲孔、不寫任何欄位）', () => {
  const c = loadItemContext();
  const it = makeItem({ affixes: [affixAt(c, 'atkFlat', 10)], sockets: [] });
  const before = JSON.stringify(it);
  c.itemDetailHTML(it, null, { gold: 0, essence: 0 });
  assert.equal(JSON.stringify(it), before, '渲染函式有副作用＝畫面更新時順便改狀態');
});

test('未附魔不顯示欄位文字，已有附魔只顯示實際效果', () => {
  const c = loadItemContext();
  const empty = c.itemDetailHTML(makeItem(), null, {});
  assert.doesNotMatch(empty, /it-enchant|空附魔/);
  const filled = c.itemDetailHTML(makeItem({ enchants: [{ key: 'fire', gemLv: 1 }] }), null, {});
  assert.match(filled, /it-enchant/);
  assert.match(filled, /data-enchant-remove="0"/);
  assert.doesNotMatch(filled, /空附魔/);
});

test('鑲嵌頁只顯示孔位，選取和卸下按鈕分開且不改原始資料', () => {
  const c = loadItemContext();
  const it = makeItem({ affixes: [affixAt(c, 'atkFlat', 10)], enchants: [{ key: 'fire', gemLv: 1 }], sockets: [null, { type: 'ruby', level: 2 }, null] });
  const before = JSON.stringify(it);
  const h = c.itemDetailHTML(it, null, { socket: { active: true, selIdx: 1, pending: false } });
  assert.doesNotMatch(h, /it-title|it-sub|it-affix|it-enchant|it-passive/);
  assert.equal((h.match(/data-socket-pick=/g) || []).length, 3);
  assert.equal((h.match(/is-socket-selected/g) || []).length, 1);
  assert.match(h, /data-socket-pick="1" aria-pressed="true"/);
  assert.match(h, /class="socket-remove" data-socket-remove="1"[^>]*>卸下/);
  assert.match(c.itemDetailHTML(it, null, { socket: { active: true, selIdx: 1, pending: true } }), /data-socket-remove="1"[^>]* disabled/);
  assert.equal(JSON.stringify(it), before);
});

test('寶石鑲孔逐孔顯示，重複寶石不合併且保留原取下索引', () => {
  const c = loadItemContext();
  const it = makeItem({ sockets: [null, { type: 'ruby', level: 1 }, { type: 'ruby', level: 1 }, null] });
  const before = JSON.stringify(it);
  const html = c.itemDetailHTML(it, null, {});
  assert.match(html, /寶石鑲孔/);
  assert.equal((html.match(/class="socket /g) || []).length, 4);
  assert.match(html, /鑲孔 1（空）/);
  assert.match(html, /鑲孔 4（空）/);
  assert.deepEqual(html.match(/data-socket-remove="\d+"/g), ['data-socket-remove="1"', 'data-socket-remove="2"']);
  assert.equal(JSON.stringify(it), before);
});

test('融合寶石與不同種類寶石維持各自孔位', () => {
  const c = loadItemContext();
  const fused = { id: 'fused', stats: [{ type: 'ruby', mult: 1 }, { type: 'sapphire', mult: 1 }], level: 5, fusions: 1, leaves: 2 };
  const it = makeItem({ sockets: [{ fused }, { type: 'ruby', level: 2 }, { type: 'sapphire', level: 1 }, null] });
  const before = JSON.stringify(it);
  const html = c.itemDetailHTML(it, null, {});
  assert.equal((html.match(/class="socket /g) || []).length, 4);
  assert.match(html, /fused-socket" data-socket-remove="0"[^>]*>1\. .*融合寶石/);
  assert.deepEqual(html.match(/data-socket-remove="\d+"/g), ['data-socket-remove="0"', 'data-socket-remove="1"', 'data-socket-remove="2"']);
  assert.equal(JSON.stringify(it), before);
});

test('掉寶率詞條顯示經 effectiveDropRateEffect 換算後的實際生效值', () => {
  const c = loadItemContext();
  const it = makeItem({ affixes: [affixAt(c, 'loot', 20)] });
  const html = c.itemDetailHTML(it, null, {});
  const shown = c.effectiveDropRateEffect(20); // 20 × 0.5 = 10
  assert.equal(c.DROP_RATE_EFFECT_MULT, 0.5);
  assert.match(html, new RegExp('\\+<span[^>]*>' + shown + '%|\\+' + shown + '%'),
    `掉寶率應顯示實際生效的 ${shown}%，不是詞條原值 20%`);
  assert.doesNotMatch(html, /\+20%/, '顯示原值會讓玩家高估一倍');
});

test('同 key 詞條合併累加成一行', () => {
  const c = loadItemContext();
  const it = makeItem({ affixes: [affixAt(c, 'atkFlat', 10), affixAt(c, 'atkFlat', 5)] });
  // 關掉洗煉區塊，否則詞條池模板也會列出「物理攻擊」這個可能詞條，混進計數裡
  const html = c.itemDetailHTML(it, null, { showAffixReroll: false });
  const named = (html.match(/物理攻擊/g) || []).length;
  assert.equal(named, 1, `同 key 應合併成一行，實際 ${named} 行`);
  assert.match(html, /\+<span[^>]*>15<\/span>|\+15/, '數值應為兩者相加');
});

test('滿值詞條金色高亮', () => {
  const c = loadItemContext();
  const it = makeItem({ affixes: [{ key: 'atkFlat', roll: c.STRENGTH_ROLL_MAX }] }); // 強度值滿值
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
