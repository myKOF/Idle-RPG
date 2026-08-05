const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext(files) {
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function item(over) {
  return Object.assign({
    kind: 'equip',
    slot: 'weapon',
    weaponType: 'sword1h',
    rarity: 5,
    level: 100,
    upgrade: 0,
    affixes: [],
    sockets: [],
    enchants: []
  }, over || {});
}

test('two-handed weapon affix values use the 2x multiplier', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js']);
  assert.equal(c.TWO_HAND_AFFIX_VALUE_MULT, 2.0);
  const oneHand = item();
  const twoHand = item({ weaponType: 'axe2h' });
  const affix = { key: 'atkPct', roll: 500 };

  assert.equal(c.affixValue(oneHand, affix),
    c.affixValueFromStrength('atkPct', 100, 5, 500, false));
  assert.equal(c.affixValue(twoHand, affix),
    c.affixValueFromStrength('atkPct', 100, 5, 500, false, c.TWO_HAND_AFFIX_VALUE_MULT));
  assert.equal(c.getAffixLimits('atkPct', 100, 5, twoHand).max,
    c.affixValueFromStrength('atkPct', 100, 5, c.STRENGTH_ROLL_MAX, false,
      c.TWO_HAND_AFFIX_VALUE_MULT));
});

test('two-handed weapon passive and godforged values use the 2x multiplier', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js']);
  const oneHand = item();
  const twoHand = item({ weaponType: 'greatsword2h' });

  assert.equal(c.passiveValue(oneHand, { key: 'sunder' }), 10);
  assert.equal(c.passiveValue(twoHand, { key: 'sunder' }), 20);
  assert.equal(c.godPassiveValue({ key: 'godMight', roll: 500 }, oneHand), 18);
  assert.equal(c.godPassiveValue({ key: 'godMight', roll: 500 }, twoHand), 36);
});

test('two-handed legendary effect numeric values are doubled without changing timing/count fields', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js', 'js/legendary.js']);
  c.getStats = () => ({ legendaryEffectMults: { mountainSunderer: 2 } });

  const fx = c.legendaryFx('mountainSunderer');
  assert.equal(fx.controlDurationMult, 4);
  assert.equal(fx.controlledTargetDamagePct, 600);

  c.getStats = () => ({ legendaryEffectMults: {} });
  assert.equal(c.legendaryFx('mountainSunderer').controlledTargetDamagePct, 300);
});

test('computeStats records the two-handed multiplier for legendary effects and godforged values', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js', 'js/player.js']);
  c.G = c.newGameState();
  const baseline = c.computeStats();
  c.G.equipment.weapon = item({
    weaponType: 'axe2h',
    passive: { key: 'mountainSunderer' },
    godPassives: [{ key: 'godMight', roll: 0 }]
  });

  const st = c.computeStats();
  assert.equal(st.legendaryEffectMults.mountainSunderer, c.TWO_HAND_EFFECT_VALUE_MULT);
  const godMight = c.godPassiveValue({ key: 'godMight', roll: 0 }, c.G.equipment.weapon);
  assert.equal(st.atk, Math.round(baseline.atk * (1 + godMight / 100)));
});

/* ---- 雙手武器數量加成（2026-08-05 調整）----
   詞條數 +1、附魔欄 +1、鑲孔數 ×1.75 捨去；單手不變。 */

// 各稀有度的雙手規格：[詞條, 附魔欄, 鑲孔]（基準表見 tests/equipment-quality-counts.test.cjs）
const TWO_HAND_EXPECTED = [
  [2, 1, 1],
  [3, 2, 1],
  [3, 2, 1],
  [4, 2, 3],
  [5, 3, 5],
  [6, 3, 7],
  [7, 3, 8],
  [8, 4, 10],
  [9, 4, 10],
  [10, 4, 10],
  [11, 4, 12]
];

test('two-handed weapons gain +1 affix, +1 enchant slot, and floor(1.75x) sockets at creation', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/item.js']);
  c.RARITIES.forEach((r, i) => {
    const twoHand = c.makeEquipment(100, { rarity: i, level: 100, slot: 'weapon', weaponType: 'greatsword2h' });
    assert.equal(twoHand.affixes.length, TWO_HAND_EXPECTED[i][0], r.name + ' 詞條數');
    assert.equal(c.enchantCapFor(twoHand), TWO_HAND_EXPECTED[i][1], r.name + ' 附魔欄');
    assert.equal(twoHand.sockets.length, TWO_HAND_EXPECTED[i][2], r.name + ' 鑲孔數');

    const oneHand = c.makeEquipment(100, { rarity: i, level: 100, slot: 'weapon', weaponType: 'sword1h' });
    assert.equal(oneHand.affixes.length, r.affix[0], r.name + ' 單手詞條數不變');
    assert.equal(c.enchantCapFor(oneHand), r.enchants, r.name + ' 單手附魔欄不變');
    assert.equal(oneHand.sockets.length, r.sockets, r.name + ' 單手鑲孔數不變');
  });
});

test('affix hard cap allows the two-hand bonus; ancient roll falls back to the highest table row', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js']);
  assert.equal(c.maxAffixesFor(item({ weaponType: 'axe2h' })), c.MAX_AFFIXES + c.TWO_HAND_BONUS_AFFIXES);
  assert.equal(c.maxAffixesFor(item()), c.MAX_AFFIXES);

  // 表外高詞條數（神鑄混沌雙手 10+1=11）：以表內最高列（10 詞條）代替，而非一律 0 條
  assert.equal(c.rollAncientAffixCount(1, 0), 0);
  let sawNonZero = false;
  for (let i = 0; i < 500; i++) {
    const n = c.rollAncientAffixCount(11, 0);
    assert.ok(Number.isInteger(n) && n >= 0 && n <= 10);
    if (n > 0) sawNonZero = true;
  }
  assert.ok(sawNonZero, '11 詞條的太古擲骰不得永遠 0 條（P(全 0) ≈ 0.18^500）');
});

test('normalizeTwoHandItemCounts tops up existing two-hand weapons idempotently', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js']);
  const twoHand = item({
    weaponType: 'greatsword2h',
    rarity: 6,
    affixes: [
      { key: 'atkFlat', roll: 100 }, { key: 'atkPct', roll: 200 }, { key: 'str', roll: 300 },
      { key: 'critRate', roll: 400 }, { key: 'hpFlat', roll: 500, ancient: true }, { key: 'agi', roll: 600 }
    ],
    sockets: [null, null, null, null, null]
  });
  c.normalizeTwoHandItemCounts(twoHand);
  assert.equal(twoHand.affixes.length, 7, '神話 6 詞條 → 補至 7');
  assert.equal(twoHand.sockets.length, 8, '神話鑲孔 5 → 補至 ⌊5×1.75⌋=8');
  const keys = twoHand.affixes.map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length, '補的詞條不得與現有詞條重複');
  const added = twoHand.affixes[6];
  assert.ok(!added.ancient, '補的詞條必為非太古');
  assert.ok(Number.isInteger(added.roll) && added.roll >= 0 && added.roll <= c.STRENGTH_ROLL_MAX);
  assert.ok(twoHand.affixes[4].ancient, '既有太古位置不變');

  const snapshot = JSON.stringify(twoHand);
  c.normalizeTwoHandItemCounts(twoHand);
  assert.equal(JSON.stringify(twoHand), snapshot, '冪等：再跑一次不得變動');

  const oneHand = item({ rarity: 6, affixes: [{ key: 'atkFlat', roll: 100 }], sockets: [null] });
  c.normalizeTwoHandItemCounts(oneHand);
  assert.equal(oneHand.affixes.length, 1, '單手武器不補詞條');
  assert.equal(oneHand.sockets.length, 1, '單手武器不補鑲孔');
});

test('migrateSave tops up two-hand weapons in equipment, inventory, and conveyor', () => {
  const c = { console, UI: { dirty: {} }, localStorage: {
    getItem() { return null; }, setItem() {}, removeItem() {}, key() { return null; }, length: 0
  } };
  c.window = c;
  vm.createContext(c);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js',
    'js/player.js', 'js/item.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c, { filename: file });
  });
  const oldTwoHand = (id) => ({
    id, kind: 'equip', slot: 'weapon', weaponType: 'axe2h', rarity: 5, level: 100,
    name: '舊雙手斧', upgrade: 0, synthesized: false, locked: false,
    affixes: [
      { key: 'atkFlat', roll: 100 }, { key: 'atkPct', roll: 200 }, { key: 'str', roll: 300 },
      { key: 'critRate', roll: 400 }, { key: 'agi', roll: 500 }
    ],
    sockets: [null, null, null, null],
    enchants: []
  });
  const data = c.migrateSave({
    player: {},
    equipment: { weapon: oldTwoHand('eq-1') },
    inventory: [oldTwoHand('inv-1')],
    factory: { conveyor: [oldTwoHand('cv-1')] }
  });
  [data.equipment.weapon, data.inventory[0], data.factory.conveyor[0]].forEach((it) => {
    assert.equal(it.affixes.length, 6, it.id + '：傳說 5 詞條 → 補至 6');
    assert.equal(it.sockets.length, 7, it.id + '：傳說鑲孔 4 → 補至 ⌊4×1.75⌋=7');
  });
});
