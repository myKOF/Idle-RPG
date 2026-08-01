/* 法力寶石（堇青石＝法力值、藍晶石＝法力恢復）：黃玉／綠寶石的法力側對位。
   驗的是「這兩顆寶石真的會變成玩家的法力與法力回復」，不是表裡有沒有那兩列——
   寶石只要 stat 指到 computeStats 既有的聚合桶就會生效，這支測試把那條路釘住。
   比照 tests/gem-hit.test.cjs。 */
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

test('法力寶石存在，且與生命側的黃玉／綠寶石成對', () => {
  const context = loadGameContext();
  const mp = context.GEM_TYPES.iolite;
  const mpRegen = context.GEM_TYPES.kyanite;
  assert.ok(mp, '缺少法力值寶石');
  assert.ok(mpRegen, '缺少法力恢復寶石');
  assert.equal(mp.stat, 'mpFlat');
  assert.equal(mpRegen.stat, 'mpRegen');
  // 定值寶石（非百分比），與對位的黃玉／綠寶石維持同一種成長曲線（非 linear）
  assert.equal(mp.pct, false);
  assert.equal(mpRegen.pct, false);
  assert.equal(!!mp.linear, !!context.GEM_TYPES.topaz.linear);
  assert.equal(!!mpRegen.linear, !!context.GEM_TYPES.emerald.linear);
});

test('法力恢復寶石 Lv.1 至少為 1，且整體約為生命恢復寶石的三分之一', () => {
  const context = loadGameContext();
  const mpRegen = context.GEM_TYPES.kyanite;
  const hpRegen = context.GEM_TYPES.emerald;
  assert.equal(mpRegen.base, 1);
  assert.equal(context.gemStatValue('kyanite', 1), 1);
  assert.equal(context.gemStatValue('kyanite', 10), 288);
  assert.equal(context.gemStatValue('emerald', 10), 864);
  assert.equal(context.gemStatValue('kyanite', 10) / context.gemStatValue('emerald', 10), 1 / 3);
});

test('鑲上法力寶石會實際提高 st.mp 與 st.mpRegen，數值等於該階級的寶石值', () => {
  const context = loadGameContext();
  const bare = statsWithHelmetSockets(context, []);
  [1, 3, 5].forEach((level) => {
    const withMp = statsWithHelmetSockets(context, [{ type: 'iolite', level: level }]);
    // 法力值會再乘轉生倍率，0 轉時為 1；以四捨五入後的差額比對
    assert.equal(withMp.mp - bare.mp, context.gemStatValue('iolite', level),
      level + ' 級堇青石應提供對應法力值');

    const withRegen = statsWithHelmetSockets(context, [{ type: 'kyanite', level: level }]);
    const expected = context.gemStatValue('kyanite', level);
    assert.equal(Math.round((withRegen.mpRegen - bare.mpRegen) * 100) / 100, expected,
      level + ' 級藍晶石應提供 ' + expected + '/秒 法力恢復');
  });
});

test('法力寶石納入戰力評分（沿用詞條池的 mpFlat／mpRegen 權重）', () => {
  const context = loadGameContext();
  const bare = context.itemScore({
    slot: 'helmet', rarity: 1, level: 1, upgrade: 0,
    affixes: [], sockets: [], enchants: []
  });
  ['iolite', 'kyanite'].forEach((type) => {
    const scored = context.itemScore({
      slot: 'helmet', rarity: 1, level: 1, upgrade: 0,
      affixes: [], sockets: [{ type: type, level: 5 }], enchants: []
    });
    assert.ok(scored > bare, type + ' 鑲了寶石的裝備戰力應高於空槽');
  });
});

test('法力寶石自動進入掉落／商店／合成流程（不需另外登記）', () => {
  const context = loadGameContext();
  // randomGemType 直接取 GEM_TYPES 的鍵，所以新種類會自動出現在所有隨機來源
  const item = fs.readFileSync(path.join(__dirname, '..', 'js/item.js'), 'utf8');
  assert.match(item, /function randomGemType\(\)\s*\{\s*return pick\(Object\.keys\(GEM_TYPES\)\)/);
  assert.ok(Object.keys(context.GEM_TYPES).indexOf('iolite') >= 0);
  assert.ok(Object.keys(context.GEM_TYPES).indexOf('kyanite') >= 0);
});
