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

test('神力改為物理與魔法攻擊的額外乘區', () => {
  const context = loadGameContext();
  context.G = {
    player: { level: 1, reincarnations: 0, skills: {} },
    equipment: emptyEquipment(context)
  };
  context.G.equipment.helmet = {
    affixes: [{ key: 'matkPct', val: 100 }],
    sockets: [],
    godPassives: [{ key: 'godMight', val: 20 }]
  };

  const stats = context.computeStats();
  /* ⚠️ 期望值從遊戲常數推導，不寫死數字。
     這支測試要驗的是「神力是一個額外乘區」這個關係，而基礎魔攻的係數
     （DERIVED_COEF.matkBase、PRIMARY_STAT_EFFECTS.intMatk）是參數表管的可調值。
     先前寫死 11／26，參數一調就紅燈，但驗的關係其實沒有變。 */
  const expectedBase = context.DERIVED_COEF.matkBase + stats.int * context.PRIMARY_STAT_EFFECTS.intMatk;
  assert.equal(stats.base.matk, expectedBase, '基礎魔攻 = 係數 + 智力 × 每點智力魔攻');
  // 神力 20% 是額外乘區：base × (1 + matkPct%) × (1 + 神力%)
  assert.equal(stats.matk, Math.round(expectedBase * (1 + 100 / 100) * (1 + 20 / 100)));
  assert.equal(stats.A.matkPct, 100);
});

test('神力提示改為額外提高', () => {
  const root = path.resolve(__dirname, '..');
  const data = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
  assert.match(data, /godMight:\s*\{[^}]*desc:\s*'物理與魔法攻擊額外提高 \{v\}%'/);
});
