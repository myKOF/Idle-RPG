const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math), window: {}, UI: { dirty: {}, sel: null } };
  context.Math.random = () => 0.5;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js', 'js/player.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function emptySet(context) {
  const eq = {};
  context.SLOT_LIST.forEach((s) => { eq[s] = null; });
  return eq;
}

function makeG(context) {
  const setA = emptySet(context);
  const setB = emptySet(context);
  setB.chest = {
    id: 1, slot: 'chest', level: 10, rarity: 0, upgrade: 0,
    affixes: [{ key: 'atkFlat', val: 500 }], sockets: [], enchants: []
  };
  return {
    player: { level: 1, skills: {}, reincarnations: 0 },
    equipmentSets: [setA, setB, emptySet(context)],
    equipActive: 0,
    equipView: 0,
    equipment: setA
  };
}

test('computeStats 可用覆寫裝備套計算（不影響預設 G.equipment 路徑）', () => {
  const context = loadContext();
  context.G = makeG(context);
  const worn = context.computeStats();
  const preview = context.computeStats(context.G.equipmentSets[1]);
  assert.equal(preview.atk - worn.atk, 500); // 第二套多 500 定值物攻
  assert.equal(context.computeStats().atk, worn.atk); // 預設路徑不受影響
});

test('getViewStats 依檢視套回傳預覽屬性，戰鬥用 getStats 維持穿著套', () => {
  const context = loadContext();
  context.G = makeG(context);
  context.markStatsDirty();

  assert.equal(context.getViewStats().atk, context.getStats().atk); // 檢視＝穿著 → 相同

  context.setEquipView(1); // 切頁檢視第二套（未穿上）
  const preview = context.getViewStats();
  const worn = context.getStats();
  assert.equal(preview.atk - worn.atk, 500, '面板預覽應反映檢視套');
  assert.equal(context.getStats().atk, worn.atk, '戰鬥屬性不得因檢視切頁而改變');

  context.setEquipView(0); // 切回
  assert.equal(context.getViewStats().atk, worn.atk);
});

test('檢視套裝備變動（markStatsDirty）後預覽屬性即時更新', () => {
  const context = loadContext();
  context.G = makeG(context);
  context.setEquipView(1);
  const before = context.getViewStats().atk;
  context.G.equipmentSets[1].chest.affixes[0].val = 1500; // 模擬洗煉/強化改動檢視套
  context.markStatsDirty();
  const after = context.getViewStats().atk;
  assert.equal(after - before, 1000);
});
