const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGameContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

// 規格表：詞條數量 → [0條, 1條, …, N條] 太古權重（%）
const SPEC_WEIGHTS = {
  2: [92, 7.5, 0.5],
  3: [78.1, 19.2, 2.4, 0.3],
  4: [72.11, 22.12, 4.61, 0.96, 0.2],
  5: [74.35, 18.74, 5.07, 1.37, 0.37, 0.1],
  6: [76.87, 15.04, 5.28, 1.85, 0.65, 0.23, 0.08],
  7: [69.92, 18.53, 7.13, 2.74, 1.05, 0.41, 0.16, 0.06],
  8: [64.22, 21.19, 8.65, 3.53, 1.44, 0.59, 0.24, 0.1, 0.04],
  9: [59.92, 23.53, 9.72, 4.02, 1.66, 0.69, 0.28, 0.12, 0.05, 0.02],
  10: [54.72, 26.42, 11.01, 4.59, 1.91, 0.8, 0.33, 0.14, 0.06, 0.02, 0.01]
};

test('太古詞條產生率表與規格一致', () => {
  const context = loadGameContext();
  assert.equal(JSON.stringify(context.ANCIENT_COUNT_WEIGHTS), JSON.stringify(SPEC_WEIGHTS));
});

test('rollAncientAffixCount 依權重擲骰；查無詞條數量列回傳 0', () => {
  const context = loadGameContext();
  // 權重對為 [太古條數, 權重%]；stub wpick 取第一個（0 條）與最後一個（N 條）驗證表格接線
  context.wpick = (pairs) => {
    assert.equal(pairs.length >= 3, true);
    pairs.forEach(([idx, w], i) => { assert.equal(idx, i); assert.equal(typeof w, 'number'); });
    return pairs[0][0];
  };
  assert.equal(context.rollAncientAffixCount(2), 0);
  context.wpick = (pairs) => pairs[pairs.length - 1][0];
  assert.equal(context.rollAncientAffixCount(2), 2);
  assert.equal(context.rollAncientAffixCount(10), 10);
  // 表外詞條數量（0/1/11）一律 0 條
  assert.equal(context.rollAncientAffixCount(0), 0);
  assert.equal(context.rollAncientAffixCount(1), 0);
  assert.equal(context.rollAncientAffixCount(11), 0);
});

test('裝備產出時決定太古條數與位置，太古數值必為滿值 ×1.35', () => {
  const context = loadGameContext();
  context.rollAncientAffixCount = (n) => Math.min(2, n); // 固定擲出 2 條
  const it = context.makeEquipment(200, { rarity: 6, level: 200 }); // 神話：6 詞條
  assert.equal(it.affixes.length, 6);
  const ancients = it.affixes.filter((a) => a.ancient);
  assert.equal(ancients.length, 2);
  it.affixes.forEach((a) => {
    const v = context.affixValue(it, a);
    const limits = context.getAffixLimits(a.key, it.level, it.rarity);
    if (a.ancient) {
      assert.equal(a.roll, context.AFFIX_ROLL_MAX, '太古位置的強度值必為滿值');
      assert.equal(v, context.affixValueFromStrength(a.key, it.level, it.rarity, context.AFFIX_ROLL_MAX, true));
      assert.ok(v > limits.max, '太古數值必超出一般上限');
    } else {
      assert.ok(a.roll >= 0 && a.roll <= context.AFFIX_ROLL_MAX, '一般位置的強度值須落在刻度內');
      assert.ok(v <= limits.max + 1e-9);
    }
  });
});

test('低稀有度與低等級裝備同樣依表產生太古（不再有 Lv.200／史詩門檻）', () => {
  const context = loadGameContext();
  context.rollAncientAffixCount = (n) => (n >= 1 ? 1 : 0);
  const it = context.makeEquipment(1, { rarity: 0, level: 1 }); // 普通：1~2 詞條
  const ancients = it.affixes.filter((a) => a.ancient);
  assert.equal(ancients.length, it.affixes.length >= 1 ? 1 : 0);
});

test('整件洗煉：太古位置永久固定且必滿值，非太古位置永不洗出太古', () => {
  const context = loadGameContext();
  context.G = { player: { gold: 999999999, essence: 99999, ancientEssence: 5 } };
  context.getStats = () => ({ luck: 100 });
  context.markStatsDirty = () => {};
  context.chance = () => true; // 幸運重骰必觸發，也不得產生太古
  context.rollAncientAffixCount = () => 0;
  const it = context.makeEquipment(200, { rarity: 6, level: 200 });
  // 手動指定位置 1、3 為太古（模擬產出時決定）
  it.affixes = it.affixes.map((a, i) => {
    const ancient = i === 1 || i === 3;
    return { key: a.key, roll: ancient ? context.AFFIX_ROLL_MAX : a.roll, ancient: ancient };
  });
  for (let round = 0; round < 3; round++) {
    assert.equal(context.rerollItemAffixes(it), null);
    it.affixes.forEach((a, i) => {
      if (i === 1 || i === 3) {
        assert.equal(a.ancient, true, '第 ' + i + ' 位置應維持太古');
        assert.equal(a.roll, context.AFFIX_ROLL_MAX, '太古位置洗煉後強度值仍為滿值');
        assert.ok(context.affixValue(it, a) > context.getAffixLimits(a.key, it.level, it.rarity).max);
      } else {
        assert.equal(a.ancient, false, '第 ' + i + ' 位置不應洗出太古');
      }
    });
  }
  // 洗煉不再消耗太古精華
  assert.equal(context.G.player.ancientEssence, 5);
});

test('單詞條洗煉：太古位置必滿值只換種類，非太古位置不會變太古', () => {
  const context = loadGameContext();
  context.G = { player: { gold: 999999999, essence: 99999, ancientEssence: 5 } };
  context.getStats = () => ({ luck: 100 });
  context.markStatsDirty = () => {};
  context.chance = () => true;
  context.rollAncientAffixCount = () => 0;
  const it = context.makeEquipment(200, { rarity: 6, level: 200 });
  it.affixes = it.affixes.map((a, i) => ({
    key: a.key, roll: i === 0 ? context.AFFIX_ROLL_MAX : a.roll, ancient: i === 0
  }));
  // 太古位置：重骰後仍為太古、必滿值
  assert.equal(context.rerollSingleAffix(it, it.affixes[0].key), null);
  assert.equal(it.affixes[0].ancient, true);
  assert.equal(it.affixes[0].roll, context.AFFIX_ROLL_MAX);
  assert.ok(context.affixValue(it, it.affixes[0]) >
    context.getAffixLimits(it.affixes[0].key, it.level, it.rarity).max);
  // 非太古位置：重骰後仍非太古
  assert.equal(context.rerollSingleAffix(it, it.affixes[2].key), null);
  assert.equal(it.affixes[2].ancient, false);
  assert.equal(context.G.player.ancientEssence, 5);
});

test('太古精華掉落與拆解機率維持不變', () => {
  const context = loadGameContext();
  assert.equal(context.ancientEssenceDropChanceForEnemy(48), 0);
  assert.equal(context.ancientEssenceDropChanceForEnemy(49), 1);
  assert.equal(context.ancientEssenceDropChanceForEnemy(179), 10);
  assert.equal(context.ancientEssenceDropChanceForEnemy(340), 10);
  assert.equal(context.ancientEssenceDropChanceForBoss(40), 10);
  assert.equal(context.ancientEssenceDropChanceForBoss(85), 100);
  assert.equal(context.ancientEssenceSalvageChanceForRarity(4), 0.5);
  assert.equal(context.ancientEssenceSalvageChanceForRarity(5), 1);
  assert.equal(context.ancientEssenceSalvageChanceForRarity(6), 10);
  assert.equal(context.ancientEssenceSalvageChanceForRarity(7), 100);
  assert.equal(context.ancientEssenceSalvageChanceForRarity(8), 100);
});

test('太古精華萃取器使用目前拆解機率的倍率加成，太古詞條另逐條獨立判定', () => {
  const context = loadGameContext();
  const calls = [];
  context.rnd = () => 1;
  context.ri = () => 1;
  context.itemEnchants = () => [];
  context.chance = (p) => { calls.push(p); return p === 50 && calls.length === 4; };
  const item = {
    rarity: 5,
    level: 200,
    affixes: [
      { key: 'atkFlat', val: 1, ancient: true },
      { key: 'matkFlat', val: 1, ancient: true },
      { key: 'hpFlat', val: 1, ancient: true },
      { key: 'defFlat', val: 1, ancient: true }
    ],
    sockets: []
  };
  const result = context.salvageResult(item, 175, 0);
  assert.equal(calls[0], 25);
  assert.equal(calls[1], 2.75);
  assert.deepEqual(calls.slice(2, 4), [50, 50]);
  assert.equal(result.ancientEssence, 1);
});

test('舊「洗煉洗出太古／太古精華消耗」機制已全面拆除', () => {
  const root = path.resolve(__dirname, '..');
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const item = read('js/item.js');
  const formula = read('js/formula.js');
  const data = read('js/data.js');
  const ui = read('js/ui.js');
  const html = read('index.html');
  assert.doesNotMatch(item, /useAncientEssence/);
  assert.doesNotMatch(item, /rerollAncientEssenceCost/);
  assert.doesNotMatch(item, /ANCIENT_REROLL_CHANCE/);
  assert.doesNotMatch(formula, /ancientAffixChanceForEnemy/);
  assert.doesNotMatch(formula, /ancientBossAffixChanceForBoss/);
  assert.doesNotMatch(formula, /rerollAncientEssenceCostFor/);
  assert.doesNotMatch(data, /ANCIENT_REROLL_CHANCE/);
  assert.doesNotMatch(data, /REROLL_ANCIENT_ESSENCE_COST/);
  assert.match(data, /ANCIENT_COUNT_WEIGHTS/);
  assert.doesNotMatch(ui, /toggle-ancient-essence/);
  assert.doesNotMatch(ui, /useAncientEssence/);
  assert.doesNotMatch(html, /toggle-ancient-essence/);
  ['js/combat.js', 'js/tower.js', 'js/save.js', 'js/forge.js'].forEach((f) => {
    assert.doesNotMatch(read(f), /ancientRate/, f + ' 不應再傳 ancientRate');
  });
});

test('太古資源與裝備詳情 UI 仍註冊（星標樣式／資源列／詞條池浮窗）', () => {
  const root = path.resolve(__dirname, '..');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const item = fs.readFileSync(path.join(root, 'js/item.js'), 'utf8');
  assert.match(html, /id="r-ancient-essence"/);
  assert.match(ui, /ancientEssence/);
  assert.match(item, /ancient-affix/);
  assert.match(ui, /function ancientStarBadgeHTML/);
  assert.match(css, /\.ancient-affix/);
  assert.match(css, /\.ancient-star-badge/);
  assert.match(html, /id="affix-pool-overlay"/);
});
