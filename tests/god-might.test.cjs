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
  // Lv1 基礎魔攻 16：16 × (1 + 100%) × (1 + 20%) = 38.4 → 38
  assert.equal(stats.base.matk, 16);
  assert.equal(stats.matk, 38);
  assert.equal(stats.A.matkPct, 100);
});

test('神力提示改為額外提高', () => {
  const root = path.resolve(__dirname, '..');
  const data = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
  assert.match(data, /godMight:\s*\{[^}]*desc:\s*'物理與魔法攻擊額外提高 \{v\}%'/);
});
