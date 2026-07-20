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
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('太古詞條與太古精華掉落機率符合規則與上限', () => {
  const context = loadGameContext();
  assert.equal(context.ancientAffixChanceForEnemy(250), 1);
  assert.equal(context.ancientAffixChanceForEnemy(270), 3);
  assert.equal(context.ancientAffixChanceForEnemy(9999), 3);
  // 高塔公式的輸入是「樓層」而非 BOSS 等級
  assert.equal(context.ancientBossAffixChanceForBoss(40), 5);
  assert.equal(context.ancientBossAffixChanceForBoss(50), 10);
  assert.equal(context.ancientBossAffixChanceForBoss(56), 13);
  assert.equal(context.ancientBossAffixChanceForBoss(999), 100);
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

test('高塔太古機率一律以樓層計算，不再誤用 BOSS 等級', () => {
  const root = path.resolve(__dirname, '..');
  const tower = fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8');
  assert.match(tower, /ancientBossAffixChanceForBoss\(floor\)/);
  assert.match(tower, /ancientEssenceDropChanceForBoss\(floor\)/);
  assert.doesNotMatch(tower, /ancientBossAffixChanceForBoss\(b\.level\)/);
  assert.doesNotMatch(tower, /ancientEssenceDropChanceForBoss\(b\.level\)/);
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(ui, /ancientEssenceDropChanceForBoss\(fl\)/);
  assert.doesNotMatch(ui, /ancientEssenceDropChanceForBoss\(bossStats\.level\)/);
});

test('200 級以上裝備可逐詞條生成太古詞條，數值為上限再加 35%', () => {
  const context = loadGameContext();
  const oldChance = context.chance;
  context.chance = () => true;
  const ancient = context.makeEquipment(200, { rarity: 5, level: 200, ancientRate: 100 });
  assert.ok(ancient.affixes.length > 0);
  ancient.affixes.forEach((affix) => {
    assert.equal(affix.ancient, true);
    const max = context.getAffixLimits(affix.key, ancient.level, ancient.rarity).max;
    assert.equal(affix.val, context.ancientAffixValue(affix.key, ancient.level, ancient.rarity));
    assert.ok(affix.val > max);
  });
  const normal = context.makeEquipment(199, { rarity: 5, level: 199, ancientRate: 100 });
  assert.ok(normal.affixes.every((affix) => !affix.ancient));
  context.chance = oldChance;
});

test('只有史詩級以上裝備可以生成太古詞條', () => {
  const context = loadGameContext();
  context.chance = () => true;
  [0, 1, 2, 3].forEach((rarity) => {
    const item = context.makeEquipment(200, { rarity, level: 200, ancientRate: 100 });
    assert.ok(item.affixes.every((affix) => !affix.ancient), '稀有度 ' + rarity + ' 不應有太古詞條');
  });
  const epic = context.makeEquipment(200, { rarity: 4, level: 200, ancientRate: 100 });
  assert.ok(epic.affixes.every((affix) => affix.ancient));
});

test('神鑄成功產物套用一般敵人的太古詞條規則', () => {
  const root = path.resolve(__dirname, '..');
  const forge = fs.readFileSync(path.join(root, 'js/forge.js'), 'utf8');
  assert.match(forge, /makeEquipment\(maxLv,\s*\{[\s\S]*rarity:\s*r \+ 1,[\s\S]*level:\s*maxLv,[\s\S]*ancientRate:\s*ancientAffixChanceForEnemy\(maxLv\)/);
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

test('勾選太古精華後洗煉會消耗 1 個，並以 30% 機率逐詞條判定', () => {
  const context = loadGameContext();
  context.G = {
    player: { gold: 999999999, essence: 999, ancientEssence: 1 },
    settings: { useAncientEssence: true }
  };
  context.getStats = () => ({ luck: 0 });
  context.markStatsDirty = () => {};
  context.chance = () => true;
  const item = context.makeEquipment(200, { rarity: 5, level: 200 });
  item.affixes = item.affixes.map((affix) => ({ key: affix.key, val: affix.val, ancient: false }));
  assert.equal(context.rerollItemAffixes(item), null);
  assert.equal(context.G.player.ancientEssence, 0);
  assert.ok(item.affixes.every((affix) => affix.ancient));
});

test('太古資源與裝備詳情 UI 已註冊', () => {
  const root = path.resolve(__dirname, '..');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const data = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  assert.match(data, /ANCIENT_REROLL_CHANCE\s*=\s*30/);
  assert.match(html, /id="r-ancient-essence"/);
  assert.match(html, /id="toggle-ancient-essence"/);
  assert.match(ui, /ancientEssence/);
  assert.match(ui, /ancient-affix/);
  assert.match(ui, /function ancientStarBadgeHTML/);
  assert.match(ui, /Math\.min\(7, count\)/);
  assert.match(ui, /ancientStarBadgeHTML\(it\)/);
  assert.match(css, /\.ancient-affix/);
  assert.match(css, /\.ancient-star-badge/);
  assert.match(css, /\.ancient-star-badge \.ancient-star[\s\S]*color:\s*#ffe45c[\s\S]*font-size:\s*18px[\s\S]*-webkit-text-stroke:\s*1px/);
  assert.match(ui, /var overlapClass = shown > 4 \? ' overlap' : ''/);
  assert.match(ui, /ancient-star-badge' \+ overlapClass/);
  assert.match(css, /\.ancient-star-badge\.overlap \.ancient-star \+ \.ancient-star[\s\S]*margin-left:\s*-4px/);
  assert.doesNotMatch(css, /\.ancient-star-badge \.ancient-star:nth-child\(n \+ 5\)/);
  assert.match(html, /id="affix-pool-overlay"/);
  assert.match(ui, /function toggleAffixPool\(anchorEl\)/);
  assert.match(ui, /function hideAffixPool\(\)/);
  assert.match(css, /#affix-pool-overlay[\s\S]*position:\s*fixed[\s\S]*z-index:\s*10050/);
});
