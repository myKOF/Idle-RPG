const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

/* 六屬性傷害寶石 base 0.5→0.2：
   gemStatValue（linear）Lv1~5 = 0.2×等級（0.2/0.4/0.6/0.8/1.0）、Lv6 起前一級 ×2（2/4/8/16/32）。
   融合寶石快照由 ONE-TIME MIGRATION gemAttrDmgBaseV1 一次性 ×0.4 縮放。 */

function loadFormulaContext() {
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
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
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/skills.js', 'js/talents.js', 'js/player.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('六種屬性傷害寶石 base 皆為 0.2', () => {
  const c = loadFormulaContext();
  for (const t of ['spinel', 'aquamarine', 'amazonite', 'peridot', 'citrine', 'tourmaline']) {
    assert.equal(c.GEM_TYPES[t].base, 0.2, t + ' base 應為 0.2');
    assert.equal(c.GEM_TYPES[t].linear, true);
  }
});

test('gemStatValue：Lv1~5 每級 +0.2%，Lv6 起前一級 ×2', () => {
  const c = loadFormulaContext();
  assert.equal(c.gemStatValue('spinel', 1), 0.2);
  assert.equal(c.gemStatValue('spinel', 2), 0.4);
  assert.equal(c.gemStatValue('spinel', 3), 0.6);
  assert.equal(c.gemStatValue('spinel', 4), 0.8);
  assert.equal(c.gemStatValue('spinel', 5), 1.0);
  assert.equal(c.gemStatValue('spinel', 6), 2.0);
  assert.equal(c.gemStatValue('spinel', 7), 4.0);
  assert.equal(c.gemStatValue('spinel', 8), 8.0);
  assert.equal(c.gemStatValue('spinel', 9), 16.0);
  assert.equal(c.gemStatValue('spinel', 10), 32.0);
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
  assert.equal(st.dmgVsElem.fire, 1.0); // Lv5 = 0.2×5
});

test('遷移 gemAttrDmgBaseV1：融合寶石屬性傷害快照 ×0.4，其他屬性保留', () => {
  const c = loadSaveContext();
  const state = c.newGameState();
  delete state.gemAttrDmgBaseV1;
  // 單屬性融合寶石（5 階等值：舊 0.5×5=2.5 → 新 1.0）
  state.player.fusedGems = [
    { id: 'fg1', stats: [{ type: 'spinel', val: 2.5 }], level: 5, fusions: 0, leaves: 1 },
    // 雙屬性：對火（縮放）＋物攻寶石 ruby（非屬性傷害，不動）
    { id: 'fg2', stats: [{ type: 'aquamarine', val: 5.0 }, { type: 'ruby', val: 30 }], level: 6, fusions: 1, leaves: 2 }
  ];

  c.migrateSave(state);

  assert.equal(state.gemAttrDmgBaseV1, true);
  assert.equal(state.player.fusedGems[0].stats[0].val, 1.0);  // 2.5 × 0.4
  assert.equal(state.player.fusedGems[1].stats[0].val, 2.0);  // 5.0 × 0.4（對冰）
  assert.equal(state.player.fusedGems[1].stats[1].val, 30);   // ruby 不動
});

test('遷移掃描鑲嵌於裝備插槽內的融合寶石', () => {
  const c = loadSaveContext();
  const state = c.newGameState();
  delete state.gemAttrDmgBaseV1;
  // 使用中裝備套的頭盔插槽鑲了一顆對火融合寶石
  state.equipmentSets[0].helmet = {
    name: '頭盔', type: 'helmet', rarity: 5, level: 100, affixes: [], enchants: [],
    sockets: [{ fused: { id: 'fgS', stats: [{ type: 'spinel', val: 2.5 }], level: 5, fusions: 0, leaves: 1 } }]
  };

  c.migrateSave(state);

  const socket = state.equipmentSets[state.equipActive].helmet.sockets[0];
  assert.equal(socket.fused.stats[0].val, 1.0); // 2.5 × 0.4
});

test('遷移冪等：旗標存在不再縮放；新帳號預帶旗標不觸發', () => {
  const c = loadSaveContext();
  const state = c.newGameState();
  delete state.gemAttrDmgBaseV1;
  state.player.fusedGems = [{ id: 'fg1', stats: [{ type: 'spinel', val: 2.5 }], level: 5, fusions: 0, leaves: 1 }];

  c.migrateSave(state);
  assert.equal(state.player.fusedGems[0].stats[0].val, 1.0);
  c.migrateSave(state); // 第二次讀檔
  assert.equal(state.player.fusedGems[0].stats[0].val, 1.0); // 不再縮放

  const fresh = c.newGameState();
  assert.equal(fresh.gemAttrDmgBaseV1, true);
  c.migrateSave(fresh);
  assert.equal(fresh.gemAttrDmgBaseV1, true);
});
