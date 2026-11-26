'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createEngine } = require('../scripts/sim/engine.js');
const root = path.resolve(__dirname, '..');

function setup(fixture = true) {
  const engine = createEngine({ seed: 20261126 }).boot(null);
  const c = engine.ctx;
  const empty = () => Object.fromEntries(c.SLOT_LIST.map(slot => [slot, null]));
  c.G.equipmentSets = [empty(), empty(), empty()];
  c.G.equipment = c.G.equipmentSets[0]; c.G.equipActive = 0; c.G.equipView = 0;
  c.G.player.skills2 = { levels: {}, ult: {} };
  if (fixture) {
    Object.assign(c.PRIMARY_STAT_GROWTH, { base: 5, perLevel: 2 });
    Object.assign(c.DERIVED_COEF, { hpBase: 500, hpPerLevel: 30, mpBase: 200, mpPerLevel: 10 });
    c.PRIMARY_STAT_EFFECTS.intMp = 1.5;
  }
  c.markStatsDirty();
  return engine;
}
function at(engine, level, reinc) {
  const c = engine.ctx;
  c.G.player.level = level; c.G.player.reincarnations = reinc; c.markStatsDirty();
  return c.getStats();
}
function withoutLevel(stats) {
  return JSON.parse(JSON.stringify({ ...stats, level: 0 }));
}
function item(c, key, value) {
  return { id: 20261126, slot: 'chest', level: 100, rarity: 0, upgrade: 0,
    affixes: [{ key, roll: c.affixStrengthFromValue(key, 100, 0, value) }], sockets: [], enchants: [] };
}

test('0轉基礎四維、生命與法力隨實級成長，法力a/b/c含小數依既有規則取整', () => {
  const engine = setup();
  for (const [level, prim, hp, mp] of [[1, 5, 525, 208], [2, 7, 565, 221], [25, 53, 1485, 520], [1000, 2003, 40485, 13195]]) {
    const st = at(engine, level, 0);
    assert.equal(st.int, prim); assert.equal(st.vit, prim);
    assert.equal(st.hp, hp); assert.equal(st.mp, mp); assert.equal(st.level, level);
  }
});

test('每個轉生階級的全部派生屬性固定以1000級計算，不隨實級增減', () => {
  const engine = setup(); const c = engine.ctx;
  for (let reinc = 1; reinc <= c.REINCARNATION_MAX; reinc++) {
    const expected = withoutLevel(at(engine, 1000, reinc));
    for (const level of [1, 2, 50, 999, 1000, 2000, 1]) {
      const st = at(engine, level, reinc);
      assert.deepEqual(withoutLevel(st), expected, reinc + '轉／實級' + level);
      assert.equal(st.level, level, '戰鬥等級仍取實級');
      assert.equal(c.G.player.level, level, '不得改寫玩家等級');
    }
  }
  const first = at(engine, 1, 1);
  assert.equal(first.int, 3005); assert.equal(first.hp, 60728); assert.equal(first.mp, 19792);
});

test('轉生等級項保持1000，原始智力與法力定值先加總再套法力轉生倍率', () => {
  const engine = setup(); const c = engine.ctx;
  at(engine, 1, 1);
  c.G.equipment.chest = item(c, 'mpFlat', 80); c.markStatsDirty();
  assert.equal(c.getStats().mp, 19912, '定值也乘1轉法力倍率');
  c.G.equipment.chest = item(c, 'int', 10); c.markStatsDirty();
  const st = c.getStats();
  assert.equal(st.A.int, 2013);
  assert.equal(st.int, 3020);
  assert.equal(st.mp, 19814, '用倍率前的2013智力派生，避免重複乘四維倍率');
});

test('每級法力與每智力係數可獨立為零，讀取a/b/c不混欄', () => {
  const engine = setup(); const c = engine.ctx;
  at(engine, 4, 0);
  c.DERIVED_COEF.mpPerLevel = 0; c.markStatsDirty(); assert.equal(c.getStats().mp, 217);
  c.PRIMARY_STAT_EFFECTS.intMp = 0; c.DERIVED_COEF.mpPerLevel = 7;
  c.markStatsDirty(); assert.equal(c.getStats().mp, 221);
  c.DERIVED_COEF.mpBase = 0; c.markStatsDirty(); assert.equal(c.getStats().mp, 21);
});

test('面板預覽與Worker戰鬥快照共用新派生值，檢視別套不改穿著屬性', () => {
  const engine = setup(); const c = engine.ctx;
  at(engine, 7, 1);
  c.G.equipmentSets[1].chest = item(c, 'mpFlat', 80);
  c.setEquipView(1);
  const header = engine.panel('header');
  assert.equal(header.player.level, 7);
  assert.equal(header.stats.level, 7); assert.equal(header.stats.mp, 19792);
  assert.equal(header.viewStats.mp, 19912); assert.equal(header.viewStats.int, 3005);
  assert.equal(engine.view().mpMax, 19792);
  assert.equal(c.getStats().mp, 19792);
  c.G.player.level = 999; c.markStatsDirty();
  assert.equal(engine.panel('header').viewStats.mp, 19912);
});

test('正式轉生將實際等級歸1，派生維持1000基礎；舊檔重載及Demo同樣生效', () => {
  const engine = setup(false); const c = engine.ctx;
  at(engine, c.REINCARNATION_LEVEL, 0);
  const before = c.getStats();
  c.reincarnate();
  assert.equal(c.G.player.level, 1); assert.equal(c.G.player.reincarnations, 1);
  const after = c.getStats();
  assert.equal(after.base.hp, before.base.hp); assert.equal(after.base.mp, before.base.mp);
  const saved = JSON.parse(engine.saveJson());
  for (const edition of ['full', 'demo']) {
    const restored = createEngine({ seed: 20261126, edition }).boot(saved);
    assert.equal(restored.ctx.G.player.level, 1);
    assert.equal(restored.ctx.getStats().mp, after.mp);
    assert.equal(restored.ctx.getStats().hp, after.hp);
    assert.equal(restored.panel('header').stats.mp, after.mp);
  }
});

test('game_parameters目前來源a/b/c與runtime一致，新增每級錨點可獨立擾動', () => {
  const c = setup(false).ctx;
  const rows = fs.readFileSync(path.join(root, 'config/CSV/game_parameters.csv'), 'utf8').split(/\r?\n/);
  const mana = rows.find(row => row.startsWith('56,')).split(',');
  assert.deepEqual([c.DERIVED_COEF.mpBase, c.DERIVED_COEF.mpPerLevel, c.PRIMARY_STAT_EFFECTS.intMp], mana.slice(6, 9).map(Number));
  const changed = mana.slice(); changed[7] = '37'; changed[8] = '4.25';
  const input = path.join(os.tmpdir(), 'mana-params-' + randomUUID() + '.csv');
  const dataBefore = fs.readFileSync(path.join(root, 'js/data.js'));
  try {
    fs.writeFileSync(input, rows.map(row => row.startsWith('56,') ? changed.join(',') : row).join('\r\n'));
    const output = execFileSync(process.execPath, ['tools/apply_params.cjs'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PARAMS_CSV: input }
    });
    assert.match(output, /mp每級\.mpPerLevel：.* → 37/);
    assert.match(output, /mp每智\.intMp：.* → 4\.25/);
    assert.deepEqual(fs.readFileSync(path.join(root, 'js/data.js')), dataBefore, '試跑不得改來源程式');
  } finally { fs.rmSync(input, { force: true }); }
});
