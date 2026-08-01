const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

/* 裝備數值存檔改造第二階段（2026-08-01）：傳奇特效／神鑄創世特效／附魔同樣不存數值。

     傳奇特效  passive:     { key }              數值＝base + perR×(稀有度-傳說級)
     神鑄特效  godPassives: { key, roll }        數值＝base × (80%+強度值/滿值×40%)
     附魔      enchants:    { key, gemLv, mult? } 數值＝enchantValueFor(裝備, 書, 寶石等級)×mult

   釘住的是改造目的：改了公式或參數，**舊存檔既有裝備的數值必須跟著變**。
   詞條部分見 tests/affix-roll-storage.test.cjs。 */
function loadContext(files) {
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  (files || ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js']).forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function makeItem(over) {
  return Object.assign({
    id: 'it-1', name: '測試劍', rarity: 6, slot: 'weapon', level: 100,
    upgrade: 0, locked: false, affixes: [], sockets: [], enchants: []
  }, over || {});
}

/* ---- 傳奇特效 ---- */

test('產出的傳奇特效只存 key，不存數值', () => {
  const c = loadContext();
  let it = null;
  for (let i = 0; i < 40 && !(it && it.passive); i++) {
    it = c.makeEquipment(200, { rarity: 6, level: 200, slot: 'chest' });
  }
  assert.ok(it.passive, '神話級裝備必附帶傳奇特效');
  assert.deepEqual(Object.keys(it.passive), ['key']);
  assert.equal(c.passiveValue(it, it.passive), c.passiveValueFor(it.passive.key, it.rarity));
});

test('傳奇特效數值隨裝備稀有度算出（稀有度提升即跟著提升）', () => {
  const c = loadContext();
  const it = makeItem({ rarity: 5, passive: { key: 'sunder' } });
  assert.equal(c.passiveValue(it, it.passive), 10);   // base 10、傳說級為基準
  it.rarity = 7;
  assert.equal(c.passiveValue(it, it.passive), 14);   // +perR 2 × 2 階
});

test('調整 PASSIVE_POOL 後，舊存檔既有傳奇特效跟著套用新值', () => {
  const c = loadContext();
  const it = makeItem({ rarity: 5, passive: { key: 'sunder' } });
  const before = c.passiveValue(it, it.passive);
  c.PASSIVE_POOL.sunder.base *= 2;
  assert.equal(c.passiveValue(it, it.passive), before * 2);
});

test('舊存檔的傳奇特效凍結值直接丟棄（數值可完全推導）', () => {
  const c = loadContext();
  const it = makeItem({ rarity: 6, passive: { key: 'thorns', val: 999 } });
  c.normalizeItemValueSources(it);
  assert.equal(Object.prototype.hasOwnProperty.call(it.passive, 'val'), false);
  assert.equal(c.passiveValue(it, it.passive), c.passiveValueFor('thorns', 6));
});

test('傳奇特效已下架時沿用凍結值，不崩也不歸零', () => {
  const c = loadContext();
  const it = makeItem({ rarity: 6, passive: { key: 'someRemovedPassive', val: 42 } });
  c.normalizeItemValueSources(it);
  assert.equal(it.passive.val, 42);
  assert.equal(c.passiveValue(it, it.passive), 42);
});

/* ---- 神鑄創世專屬特效 ---- */

test('產出的神鑄特效只存強度值，數值落在 base 的 80%~120%', () => {
  const c = loadContext();
  const it = c.makeEquipment(200, { rarity: c.GODFORGED_IDX, level: 200, slot: 'chest' });
  assert.equal(it.godPassives.length, c.GODFORGE_PASSIVE_COUNT);
  it.godPassives.forEach((gp) => {
    assert.equal(Object.prototype.hasOwnProperty.call(gp, 'val'), false, '存檔不得再出現 val');
    assert.equal(gp.roll, Math.floor(gp.roll));
    assert.ok(gp.roll >= 0 && gp.roll <= c.STRENGTH_ROLL_MAX);
    const base = c.GODFORGE_POOL[gp.key].base;
    const v = c.godPassiveValue(gp);
    assert.ok(v >= base * 0.8 - 0.05 && v <= base * 1.2 + 0.05, gp.key + ' = ' + v);
  });
});

test('神鑄特效：強度值 0／滿值對應區間兩端，調整 base 後等比變動', () => {
  const c = loadContext();
  const base = c.GODFORGE_POOL.godMight.base;
  assert.equal(c.godPassiveValue({ key: 'godMight', roll: 0 }), Math.round(base * 0.8 * 10) / 10);
  assert.equal(c.godPassiveValue({ key: 'godMight', roll: c.STRENGTH_ROLL_MAX }),
    Math.round(base * 1.2 * 10) / 10);

  const gp = { key: 'godMight', roll: 500 };
  const before = c.godPassiveValue(gp);
  c.GODFORGE_POOL.godMight.base *= 2;
  assert.equal(c.godPassiveValue(gp), Math.round(before * 2 * 10) / 10);
  assert.equal(gp.roll, 500, '強度值不因參數調整而變動');
});

test('舊存檔的神鑄特效：val → 強度值且數值不變', () => {
  const c = loadContext();
  const oldVal = c.godPassiveValue({ key: 'smite', roll: 640 });
  const it = makeItem({ rarity: c.GODFORGED_IDX, godPassives: [{ key: 'smite', val: oldVal }] });
  c.normalizeItemValueSources(it);
  assert.equal(Object.prototype.hasOwnProperty.call(it.godPassives[0], 'val'), false);
  assert.equal(c.godPassiveValue(it.godPassives[0]), oldVal, '換算不得改變玩家看到的數值');
  /* 舊值只留到小數一位，反推強度值必然帶進位誤差：smite base 12 → 區間寬度 4.8，
     0.05 的進位誤差在 1000 階刻度上約 10 階。保證的是數值不變，不是還原出同一個 roll。 */
  assert.ok(Math.abs(it.godPassives[0].roll - 640) <= 15, '實際 ' + it.godPassives[0].roll);
});

test('神力（godMight）乘區吃算出來的數值', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js',
    'js/item.js', 'js/skills.js', 'js/talents.js', 'js/player.js']);
  c.G = c.newGameState();
  c.G.player.level = 100;
  const it = makeItem({
    slot: 'chest', rarity: c.GODFORGED_IDX,
    godPassives: [{ key: 'godMight', roll: c.STRENGTH_ROLL_MAX }]
  });
  const base = c.computeStats().atk;
  c.G.equipment.chest = it;
  const withGod = c.computeStats().atk;
  const pct = c.godPassiveValue(it.godPassives[0]);
  assert.ok(pct > 0);
  assert.equal(withGod, Math.round(base * (1 + pct / 100)));
});

/* ---- 附魔 ---- */

test('手動附魔存的是寶石等級 0，不存數值', () => {
  const c = loadContext();
  const it = makeItem({ slot: 'chest', rarity: 4, level: 50, enchants: [] });
  c.applyEnchantTo(it, 'vigor', 0);
  // vm context 的物件與測試端不同 realm，比 JSON 而非 deepEqual
  assert.equal(JSON.stringify(it.enchants), JSON.stringify([{ key: 'vigor', gemLv: 0 }]));
  assert.equal(c.enchantValue(it, it.enchants[0]), c.enchantValueFor(it, 'vigor', 0));
});

test('同類附魔只在數值更高時換掉來源；變異倍率一併納入比較', () => {
  const c = loadContext();
  const it = makeItem({ slot: 'weapon', rarity: 6, level: 200, enchants: [] });
  c.applyEnchantTo(it, 'ice', 3);
  assert.equal(it.enchants[0].gemLv, 3);
  c.applyEnchantTo(it, 'ice', 1);                       // 較弱 → 不換
  assert.equal(it.enchants[0].gemLv, 3);
  c.applyEnchantTo(it, 'ice', 5);                       // 較強 → 換
  assert.equal(it.enchants[0].gemLv, 5);

  it.enchants[0] = { key: 'ice', gemLv: 5, mult: 1.5 }; // 變異過的附魔
  const mutated = c.enchantValue(it, it.enchants[0]);
  assert.equal(mutated, Math.round(c.enchantValueFor(it, 'ice', 5) * 1.5 * 10) / 10);
  c.applyEnchantTo(it, 'ice', 6);                       // 寶石等級較高但仍打不過 ×1.5
  assert.equal(c.enchantValue(it, it.enchants[0]), mutated, '不得把更好的既有附魔換掉');
});

test('調整附魔公式後，舊存檔既有附魔跟著套用新值', () => {
  const c = loadContext();
  const it = makeItem({ slot: 'weapon', rarity: 6, level: 200, enchants: [{ key: 'ice', gemLv: 4 }] });
  const before = c.enchantValue(it, it.enchants[0]);
  it.level = 400;                                        // 等級進位＝公式輸入改變
  assert.ok(c.enchantValue(it, it.enchants[0]) > before, '附魔數值隨裝備等級公式重算');
});

test('舊存檔的附魔：val → gemLv，攻擊類／防禦類／火焰附魔數值都不變', () => {
  const c = loadContext();
  const cases = [
    { slot: 'weapon', rarity: 6, level: 200, key: 'ice', gemLv: 4 },
    { slot: 'weapon', rarity: 7, level: 150, key: 'fire', gemLv: 2 },   // 火焰另乘 1.25
    { slot: 'chest', rarity: 5, level: 100, key: 'vigor', gemLv: 3 },   // 防禦/功能類（%、上限 60）
    { slot: 'chest', rarity: 8, level: 300, key: 'vigor', gemLv: 20 }   // 已頂到 60% 上限
  ];
  cases.forEach((cs) => {
    const it = makeItem({ slot: cs.slot, rarity: cs.rarity, level: cs.level, enchants: [] });
    const oldVal = c.enchantValueFor(it, cs.key, cs.gemLv);
    it.enchants = [{ key: cs.key, val: oldVal }];
    c.normalizeItemValueSources(it);
    assert.equal(Object.prototype.hasOwnProperty.call(it.enchants[0], 'val'), false, cs.key);
    const back = c.enchantValue(it, it.enchants[0]);
    assert.ok(Math.abs(back - oldVal) <= (cs.key === 'fire' ? 1 : 0.1),
      cs.key + ' 換算後 ' + back + ' 應接近原值 ' + oldVal);
  });
});

test('附魔已下架時沿用凍結值', () => {
  const c = loadContext();
  const it = makeItem({ enchants: [{ key: 'someRemovedEnchant', val: 33 }] });
  c.normalizeItemValueSources(it);
  assert.equal(it.enchants[0].val, 33);
  assert.equal(c.enchantValue(it, it.enchants[0]), 33);
});

/* ---- 整體 ---- */

test('normalizeItemValueSources 冪等：重複讀檔不再變動', () => {
  const c = loadContext();
  const it = makeItem({
    rarity: 6, level: 200, slot: 'weapon',
    affixes: [{ key: 'atkFlat', val: c.affixValueFromStrength('atkFlat', 200, 6, 400, false) }],
    passive: { key: 'sunder', val: 14 },
    godPassives: [{ key: 'smite', val: 12 }],
    enchants: [{ key: 'ice', val: 500 }]
  });
  c.normalizeItemValueSources(it);
  const snapshot = JSON.stringify(it);
  c.normalizeItemValueSources(it);
  c.normalizeItemValueSources(it);
  assert.equal(JSON.stringify(it), snapshot);
});

test('存檔載入會一併換算特效與附魔（migrateSave → fixLoadedItem）', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js',
    'js/item.js', 'js/skills.js', 'js/talents.js', 'js/player.js', 'js/newforge.js', 'js/save.js']);
  const save = c.newGameState();
  save.version = 1;
  save.inventory = [{
    id: 'legacy-1', kind: 'equip', name: '神話的鎖甲', slot: 'chest', rarity: 6, level: 200,
    upgrade: 0, locked: false, sockets: [],
    affixes: [{ key: 'hpFlat', val: c.affixValueFromStrength('hpFlat', 200, 6, 700, false) }],
    passive: { key: 'thorns', val: 8 },
    godPassives: [{ key: 'sanctuary', val: 9 }],
    enchants: [{ key: 'vigor', val: 30 }]
  }];

  const out = c.migrateSave(JSON.parse(JSON.stringify(save)));
  const it = out.inventory[0];
  assert.equal(Object.prototype.hasOwnProperty.call(it.affixes[0], 'val'), false, '詞條');
  assert.equal(Object.prototype.hasOwnProperty.call(it.passive, 'val'), false, '傳奇特效');
  assert.equal(Object.prototype.hasOwnProperty.call(it.godPassives[0], 'val'), false, '神鑄特效');
  assert.equal(Object.prototype.hasOwnProperty.call(it.enchants[0], 'val'), false, '附魔');
  assert.equal(typeof it.godPassives[0].roll, 'number');
  assert.equal(typeof it.enchants[0].gemLv, 'number');
  assert.ok(c.itemScore(it) > 0, '評分仍算得出來');
});
