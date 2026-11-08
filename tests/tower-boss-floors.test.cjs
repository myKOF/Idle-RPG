'use strict';
/* 封魔塔 BOSS 每關一列（2026-11-08）：NPC 表 tower_boss_1~50＝第 1~50 關，51 層起從第 1 列重新輪；
   每列的生命／攻擊／防禦／命中／閃避倍率乘在參數表「4-高塔BOSS」的樓層公式上（js/formula.js bossStatsFor）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cfg = require('../tools/config_tables.cjs');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const source = read('js/data.js');
const sc = cfg.SCHEMAS.NPC;
const col = n => sc.header.indexOf(n);
const MULTS = [['生命倍率', 'hpMult'], ['攻擊倍率', 'atkMult'], ['防禦倍率', 'defMult'], ['命中倍率', 'hitMult'], ['閃避倍率', 'dodgeMult']];

function formulaContext() {
  const c = { console, Math };
  vm.createContext(c);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js']
    .forEach(f => vm.runInContext(read(f), c, { filename: f }));
  return c;
}

test('TBF-1 NPC 表有 50 列 tower_boss，依關卡順序；倍率欄預填 1、其他類型留白', () => {
  const rows = cfg.csvParse(read('config/CSV/NPC.csv')).filter(r => r.length > 1);
  const h = rows.shift(), i = n => h.indexOf(n);
  const towers = rows.filter(r => r[i('類型')] === 'tower_boss');
  assert.deepEqual(towers.map(r => r[i('NPC識別碼')]), Array.from({ length: 50 }, (_, k) => 'tower_boss_' + (k + 1)));
  towers.forEach(r => MULTS.forEach(([label]) => assert.equal(r[i(label)], '1', r[0] + ' ' + label)));
  rows.filter(r => r[i('類型')] !== 'tower_boss').forEach(r => MULTS.forEach(([label]) => assert.equal(r[i(label)], '', r[0] + ' ' + label)));
  // 第3關已獨立換成LV3；13/23/33/43仍保留原雷霆外觀。其他複製列及玩法欄保持。
  const same = ['NPC名稱', '屬性', '外觀', '站立圖像', '移動速度(米/秒)', '攻擊速度(次/秒)', '攻擊距離(米)', '魔法型（1是／0否）', '專屬技能', '隨機技能下限', '隨機技能上限', '3D模型'];
  towers.slice(10).forEach((r, k) => same.forEach(n => assert.equal(r[i(n)], towers[k % 10 === 2 ? 12 : k % 10][i(n)], r[0] + ' ' + n)));
  for (const number of [13, 23, 33, 43]) {
    const row = towers[number - 1];
    assert.equal(row[i('NPC名稱')], '雷霆巨獸');
    assert.equal(row[i('站立圖像')], 'sprites/boss/boss_thunder.png');
    assert.equal(row[i('3D模型')], '');
    for (const field of ['屬性', '移動速度(米/秒)', '攻擊速度(次/秒)', '攻擊距離(米)', '專屬技能']) {
      assert.equal(row[i(field)], towers[2][i(field)]);
    }
  }
});

test('TBF-2 樓層對應：第 n 關用 tower_boss_n，51／101 層回到第 1 關那列', () => {
  const c = formulaContext();
  assert.equal(c.BOSS_LIST.length, 50);
  [[1, 1], [11, 11], [50, 50], [51, 1], [100, 50], [101, 1], [150, 50]].forEach(([floor, row]) => {
    assert.equal(c.towerBossDefFor(floor).id, 'tower_boss_' + row, 'floor ' + floor);
  });
});

test('TBF-3 每關倍率乘在樓層公式上，只影響那一關；元素附傷跟著攻擊走、防禦同時作用於物防與魔防', () => {
  const c = formulaContext();
  const before = { f7: c.bossStatsFor(7), f8: c.bossStatsFor(8), f57: c.bossStatsFor(57) };
  Object.assign(c.BOSS_LIST[6], { hpMult: 2, atkMult: 1.5, defMult: 0.5, hitMult: 1.2, dodgeMult: 0 });
  const after = c.bossStatsFor(7);
  const close = (a, b, m) => assert.ok(Math.abs(a / b - 1) < 1e-12, m + ': ' + a + ' vs ' + b);
  close(after.hp, before.f7.hp * 2, 'hp');
  close(after.atk, before.f7.atk * 1.5, 'atk');
  close(after.elemAtkVal, before.f7.elemAtkVal * 1.5, 'elemAtkVal');
  close(after.def, before.f7.def * 0.5, 'def');
  close(after.mdef, before.f7.mdef * 0.5, 'mdef');
  close(after.hit, before.f7.hit * 1.2, 'hit');
  assert.equal(after.dodge, 0);
  assert.equal(after.level, before.f7.level);
  assert.equal(after.xp, before.f7.xp, '經驗不受戰鬥倍率影響');
  assert.deepEqual(c.bossStatsFor(8), before.f8, '其他關不受影響');
  close(c.bossStatsFor(57).hp, before.f57.hp * 2, '第 57 層沿用第 7 關那列（地獄塔公式 × 同一組倍率）');
});

test('TBF-4 套用：倍率寫進 BOSS_LIST、空白或 1 不寫入；非法值與其他類型填寫都會中止', () => {
  const base = () => sc.extract(source).map(r => r.slice());
  const towerRow = (rows, n) => rows.find(r => r[0] === 'tower_boss_' + n);
  const listOf = rows => cfg.evalLiteral(cfg.extractLiteral(sc.rebuild(rows, sc.header, source).BOSS_LIST, 'BOSS_LIST').literal);
  let rows = base();
  towerRow(rows, 23)[col('生命倍率')] = '3.5';
  towerRow(rows, 23)[col('閃避倍率')] = '';
  towerRow(rows, 24)[col('防禦倍率')] = '0';
  let list = listOf(rows);
  assert.equal(list[22].hpMult, 3.5);
  assert.equal(list[22].dodgeMult, undefined);
  assert.equal(list[23].defMult, 0);
  assert.equal(list[0].hpMult, undefined);
  for (const [label, value, re] of [['生命倍率', '0', /大於 0/], ['攻擊倍率', '-1', /大於 0/], ['命中倍率', 'abc', /命中倍率/]]) {
    rows = base(); towerRow(rows, 5)[col(label)] = value;
    assert.throws(() => sc.rebuild(rows, sc.header, source), re, label + '=' + value);
  }
  rows = base(); rows.find(r => r[3] === 'elite')[col('攻擊倍率')] = '2';
  assert.throws(() => sc.rebuild(rows, sc.header, source), /只有 tower_boss 列能填/);
});

test('TBF-5 套用：可增減關數（從 1 依序），魔法型決定元素；新增的列不需要舊資料', () => {
  const rows = sc.extract(source).map(r => r.slice());
  const extra = rows.find(r => r[0] === 'tower_boss_4').slice();   // 鋼鐵魔像：魔法型 0
  extra[0] = 'tower_boss_51';
  extra[col('NPC名稱')] = '新關卡魔像';
  extra[col('魔法型（1是／0否）')] = '1';
  rows.push(extra);
  const list = cfg.evalLiteral(cfg.extractLiteral(sc.rebuild(rows, sc.header, source).BOSS_LIST, 'BOSS_LIST').literal);
  assert.equal(list.length, 51);
  assert.equal(list[50].name, '新關卡魔像');
  assert.equal(list[50].elem, 'lightning');
  assert.equal(list[3].elem, null);
});

