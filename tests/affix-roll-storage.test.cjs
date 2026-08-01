const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

/* 詞條存檔改造（2026-08-01）：存檔只留「強度值」（roll＝在隨機區間中的位置），
   最終數值一律由參數表（base／每級成長／稀有度倍率）當場算出。

   這支測試釘住的是改造的**目的**，不只是欄位長相：
   調整參數表之後，**舊存檔既有裝備的數值必須跟著變**。
   舊做法把產出當下的數值凍結在 affixes[].val，改參數只會影響新掉落的裝備，
   背包裡的同名詞條永遠停在舊值——那正是本次要消滅的狀態。 */
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
    id: 'it-1', name: '測試劍', rarity: 5, slot: 'weapon', level: 50,
    upgrade: 0, locked: false, affixes: [], sockets: [], enchants: []
  }, over || {});
}

test('產出的詞條只帶強度值，不再帶凍結數值', () => {
  const c = loadContext();
  const it = c.makeEquipment(200, { rarity: 6, level: 200 });
  assert.ok(it.affixes.length > 0);
  it.affixes.forEach((a) => {
    assert.equal(Object.prototype.hasOwnProperty.call(a, 'val'), false, '存檔不得再出現 val');
    assert.equal(typeof a.roll, 'number');
    assert.equal(a.roll, Math.floor(a.roll), '強度值必為整數');
    assert.ok(a.roll >= 0 && a.roll <= c.STRENGTH_ROLL_MAX, '強度值須落在 0 ~ STRENGTH_ROLL_MAX');
  });
});

test('強度值與數值的對應：0＝區間下限、滿值＝區間上限、中間等分', () => {
  const c = loadContext();
  const limits = c.getAffixLimits('hpFlat', 100, 4);
  assert.equal(c.affixValueFromStrength('hpFlat', 100, 4, 0, false), limits.min);
  assert.equal(c.affixValueFromStrength('hpFlat', 100, 4, c.STRENGTH_ROLL_MAX, false), limits.max);
  const mid = c.affixValueFromStrength('hpFlat', 100, 4, c.STRENGTH_ROLL_MAX / 2, false);
  assert.equal(mid, Math.round((limits.min + limits.max) / 2));
  // 單調遞增：強度值越高、數值不會變小（熔爐重骰模組直接比 roll 的前提）
  let prev = -Infinity;
  for (let roll = 0; roll <= c.STRENGTH_ROLL_MAX; roll += 50) {
    const v = c.affixValueFromStrength('hpFlat', 100, 4, roll, false);
    assert.ok(v >= prev);
    prev = v;
  }
});

test('太古位置不看強度值：必為滿值 × 太古倍率', () => {
  const c = loadContext();
  const max = c.getAffixLimits('atkFlat', 100, 6).max;
  const anc = c.affixValueFromStrength('atkFlat', 100, 6, 0, true); // 強度值 0 也一樣
  assert.equal(anc, c.affixValueFromStrength('atkFlat', 100, 6, c.STRENGTH_ROLL_MAX, true));
  assert.ok(anc > max, '太古數值必超出一般上限');
  assert.equal(anc, Math.round(c.affixBaseValue('atkFlat', 100, 6) * 1.2 * c.ANCIENT_AFFIX_VALUE_MULT));
});

test('調整參數表的 base／每級成長後，同一強度值算出新數值（改造目的）', () => {
  const c = loadContext();
  const it = makeItem({ affixes: [{ key: 'atkFlat', roll: 500 }] });
  const before = c.affixValue(it, it.affixes[0]);

  c.AFFIX_POOL.atkFlat.base *= 2;                       // 模擬參數表把基礎值調整為兩倍
  const after = c.affixValue(it, it.affixes[0]);

  assert.equal(after, before * 2, '舊存檔的既有裝備必須跟著套用新參數');
  assert.equal(it.affixes[0].roll, 500, '強度值不因參數調整而變動');
});

test('強化倍率仍是讀取時才乘，不寫回強度值', () => {
  const c = loadContext();
  const it = makeItem({ affixes: [{ key: 'atkFlat', roll: 700 }] });
  const base = c.affixValue(it, it.affixes[0]);
  it.upgrade = 4;
  assert.equal(c.affixValue(it, it.affixes[0]), base, 'affixValue 不含強化倍率');
  assert.equal(c.upgradeMult(it), 1.2);
});

test('舊存檔換算：val → roll 且數值不變、val 欄位移除', () => {
  const c = loadContext();
  const it = makeItem({ affixes: [] });
  // 以現行公式產生一個合法舊值（產出當下凍結的數值）
  const oldVal = c.affixValueFromStrength('hpFlat', 50, 5, 617, false);
  it.affixes = [{ key: 'hpFlat', val: oldVal, ancient: false }];

  c.ensureItemAffixRolls(it);

  const a = it.affixes[0];
  assert.equal(Object.prototype.hasOwnProperty.call(a, 'val'), false, '換算後必須移除 val');
  assert.equal(c.affixValue(it, a), oldVal, '換算不得改變玩家看到的數值');
  /* 舊 val 是四捨五入後的數字，反推強度值必然帶進位誤差（區間越寬誤差越大）。
     保證的是「玩家看到的數值不變」，不是「還原出一模一樣的 roll」。
     全詞條 × 等級 × 稀有度掃描下，換算後數值最壞飄移 0.049%。 */
  assert.ok(Math.abs(a.roll - 617) <= 3, '強度值應回到產出時的位置附近，實際 ' + a.roll);
});

test('舊存檔換算：太古位置一律重算為現行太古倍率', () => {
  const c = loadContext();
  const it = makeItem({
    // 舊存檔的太古數值可能是舊倍率算出來的，換算時不沿用
    affixes: [{ key: 'atkFlat', val: 1, ancient: true }]
  });
  c.ensureItemAffixRolls(it);
  assert.equal(it.affixes[0].roll, c.STRENGTH_ROLL_MAX);
  assert.equal(c.affixValue(it, it.affixes[0]),
    c.affixValueFromStrength('atkFlat', 50, 5, c.STRENGTH_ROLL_MAX, true));
});

test('舊存檔換算是冪等的：重複讀檔不再變動', () => {
  const c = loadContext();
  const it = makeItem({ affixes: [{ key: 'hpFlat', val: c.affixValueFromStrength('hpFlat', 50, 5, 300, false) }] });
  c.ensureItemAffixRolls(it);
  const snapshot = JSON.stringify(it.affixes);
  c.ensureItemAffixRolls(it);
  c.ensureItemAffixRolls(it);
  assert.equal(JSON.stringify(it.affixes), snapshot);
});

test('已從參數表下架的詞條：沿用凍結數值，不崩也不歸零', () => {
  const c = loadContext();
  const it = makeItem({ affixes: [{ key: 'someRemovedAffix', val: 123 }] });
  c.ensureItemAffixRolls(it);
  assert.equal(it.affixes[0].val, 123, '推不出基準值時必須保留原值');
  assert.equal(it.affixes[0].roll, undefined);
  assert.equal(c.affixValue(it, it.affixes[0]), 123);
});

test('沒有 roll 的詞條在任何讀取點都會就地自癒（漏掃容器的最後一道防線）', () => {
  const c = loadContext();
  const oldVal = c.affixValueFromStrength('atkFlat', 50, 5, 888, false);
  const it = makeItem({ affixes: [{ key: 'atkFlat', val: oldVal }] });
  assert.equal(c.itemScore(it) > 0, true);            // 只是讀評分
  assert.equal(typeof it.affixes[0].roll, 'number', '讀取時應已補上強度值');
  assert.equal(Object.prototype.hasOwnProperty.call(it.affixes[0], 'val'), false);
  assert.equal(c.affixValue(it, it.affixes[0]), oldVal, '自癒不得改變數值');
});

test('存檔載入會掃過所有裝備容器（migrateSave → fixLoadedItem）', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js',
    'js/item.js', 'js/skills.js', 'js/talents.js', 'js/player.js', 'js/newforge.js', 'js/save.js']);
  const legacy = () => ({
    id: 'x' + Math.random(), kind: 'equip', name: '獨特的胸甲', slot: 'chest', rarity: 3, level: 50, upgrade: 0,
    affixes: [{ key: 'hpFlat', val: c.affixValueFromStrength('hpFlat', 50, 3, 250, false) }],
    sockets: [], enchants: [], locked: false
  });
  const save = c.newGameState();
  save.version = 1;
  save.equipment.chest = legacy();
  save.equipmentSets = null;                 // 舊存檔沒有三套裝備 → 走 equipment 那條
  save.inventory = [legacy()];
  save.factory.conveyor = [legacy()];
  save.factory.synthBuffer = [legacy()];
  save.newForge.queue = [legacy()];
  save.newForge.furnaces[0].queue = [legacy()];
  save.newForge.furnaces[0].belt = [legacy()];
  save.forge.slots[0] = legacy();

  const out = c.migrateSave(JSON.parse(JSON.stringify(save)));

  const collected = []
    .concat(Object.keys(out.equipment).map((s) => out.equipment[s]))
    .concat(out.inventory, out.factory.conveyor, out.factory.synthBuffer,
      out.newForge.queue, out.newForge.furnaces[0].queue, out.newForge.furnaces[0].belt,
      out.forge.slots)
    .filter((it) => it && Array.isArray(it.affixes) && it.affixes.length);
  assert.equal(collected.length, 8, '八個裝備容器都應被掃到');
  collected.forEach((it) => {
    it.affixes.forEach((a) => {
      assert.equal(a.roll, 250, JSON.stringify(a) + ' 未換算為強度值');
      assert.equal(Object.prototype.hasOwnProperty.call(a, 'val'), false);
    });
  });
});
