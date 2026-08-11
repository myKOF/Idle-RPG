/* 命中寶石（貓眼石）：月光石（閃避）的對位。
   驗的是「這顆寶石真的會變成玩家的命中率」，不是表裡有沒有那一列——
   寶石只要 stat 指到 computeStats 既有的聚合桶就會生效，這支測試把那條路釘住。 */
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
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function emptyEquipment(context) {
  return context.SLOT_LIST.reduce((equipment, slot) => {
    equipment[slot] = null;
    return equipment;
  }, {});
}

function statsWithHelmetSockets(context, sockets) {
  context.G = {
    player: { level: 1, reincarnations: 0, skills: {} },
    equipment: emptyEquipment(context)
  };
  context.G.equipment.helmet = { affixes: [], sockets: sockets, enchants: [] };
  return context.computeStats();
}

test('命中寶石存在，且與月光石（閃避）成對', () => {
  const context = loadGameContext();
  const gem = context.GEM_TYPES.catseye;
  assert.ok(gem, '缺少命中寶石');
  assert.equal(gem.stat, 'hit');
  assert.equal(gem.pct, true);
  // 與對位的閃避寶石維持同一種成長曲線（非 linear），只有基礎值不同
  assert.equal(!!gem.linear, !!context.GEM_TYPES.moonstone.linear);
  assert.ok(gem.base > context.GEM_TYPES.moonstone.base,
    '命中每點價值低於閃避（玩家命中基礎已有 100%），基礎值應高於月光石');
});

test('鑲上命中寶石會實際提高 st.hit，數值等於該階級的寶石值', () => {
  const context = loadGameContext();
  const before = statsWithHelmetSockets(context, []).hit;
  [1, 3, 5].forEach((level) => {
    const after = statsWithHelmetSockets(context, [{ type: 'catseye', level: level }]).hit;
    const expected = context.gemStatValue('catseye', level);
    assert.equal(Math.round((after - before) * 100) / 100, expected,
      level + ' 級貓眼石應提供 ' + expected + '% 命中');
  });
});

test('命中寶石納入戰力評分（沿用詞條池的 hit 權重，不是預設值 1）', () => {
  const context = loadGameContext();
  assert.equal(context.SCORE_WEIGHTS.hit, 1.2);
  const scored = context.itemScore({
    slot: 'helmet', rarity: 1, level: 1, upgrade: 0,
    affixes: [], sockets: [{ type: 'catseye', level: 5 }], enchants: []
  });
  const bare = context.itemScore({
    slot: 'helmet', rarity: 1, level: 1, upgrade: 0,
    affixes: [], sockets: [], enchants: []
  });
  assert.ok(scored > bare, '鑲了寶石的裝備戰力應高於空槽');
});

test('新寶石自動進入掉落／商店／合成流程（不需另外登記）', () => {
  const context = loadGameContext();
  // randomGemType 直接取 GEM_TYPES 的鍵，所以新種類會自動出現在所有隨機來源
  const item = fs.readFileSync(path.join(__dirname, '..', 'js/item.js'), 'utf8');
  assert.match(item, /function randomGemType\(\)\s*\{\s*return pick\(Object\.keys\(GEM_TYPES\)\)/);
  assert.ok(Object.keys(context.GEM_TYPES).indexOf('catseye') >= 0);
});
