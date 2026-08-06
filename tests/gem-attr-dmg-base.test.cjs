const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

/* 六屬性傷害寶石 base 0.5→0.2→1（2026-08-06 調整為 1，使 5 級＝5%）：
   gemStatValue（linear）Lv1~5 = 1×等級（1/2/3/4/5）、Lv6 起前一級 ×2（10/20/40/80/160）。
   融合寶石的快照曾有一次性遷移 gemAttrDmgBaseV1，2026-07-28 隨全部一次性遷移一併移除
   （改版後會刪檔，不再需要相容舊存檔）。 */

function loadFormulaContext() {
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function loadSaveContext() {
  const context = {
    console, Math, Date,
    window: {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, key() { return null; }, length: 0 }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/skills.js', 'js/talents.js', 'js/player.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('六種屬性傷害寶石 base 皆為 1', () => {
  const c = loadFormulaContext();
  for (const t of ['spinel', 'aquamarine', 'amazonite', 'peridot', 'citrine', 'tourmaline']) {
    assert.equal(c.GEM_TYPES[t].base, 1, t + ' base 應為 1');
    assert.equal(c.GEM_TYPES[t].linear, true);
  }
});

test('gemStatValue：Lv1~5 每級 +1%，Lv6 起前一級 ×2', () => {
  const c = loadFormulaContext();
  assert.equal(c.gemStatValue('spinel', 1), 1);
  assert.equal(c.gemStatValue('spinel', 2), 2);
  assert.equal(c.gemStatValue('spinel', 3), 3);
  assert.equal(c.gemStatValue('spinel', 4), 4);
  assert.equal(c.gemStatValue('spinel', 5), 5);
  assert.equal(c.gemStatValue('spinel', 6), 10);
  assert.equal(c.gemStatValue('spinel', 7), 20);
  assert.equal(c.gemStatValue('spinel', 8), 40);
  assert.equal(c.gemStatValue('spinel', 9), 80);
  assert.equal(c.gemStatValue('spinel', 10), 160);
});

test('鑲嵌一般屬性寶石以新 base 動態計算（無需遷移）', () => {
  const c = loadFormulaContext();
  c.itemEnchants = () => [];
  c.G = {
    player: { level: 1, reincarnations: 0, skills: {}, talents: { levels: {}, potentialLevels: {} } },
    equipment: c.SLOT_LIST.reduce((eq, s) => { eq[s] = null; return eq; }, {})
  };
  c.G.equipment.helmet = { affixes: [], sockets: [{ type: 'spinel', level: 5 }] };
  const st = c.computeStats();
  assert.equal(st.dmgVsElem.fire, 5); // Lv5 = 1×5
});
