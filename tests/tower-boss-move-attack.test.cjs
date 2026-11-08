'use strict';
/* 封魔塔 BOSS 的移動速度／攻擊速度／攻擊距離（2026-11-08）：
   由 NPC 表 tower_boss 列逐隻設定（tools/config_tables.cjs → BOSS_LIST），
   js/tower.js makeBoss 走野外 NPC 同一套換算（js/combat.js npcCombatProfile）；
   參數表「4-高塔BOSS」不再有攻速。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cfg = require('../tools/config_tables.cjs');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const source = read('js/data.js');
const rows = cfg.csvParse(read('config/CSV/NPC.csv')).filter(r => r.length > 1);
const header = rows[0], ix = name => header.indexOf(name);
const clone = () => rows.slice(1).map(r => r.slice());
const bosses = literal => cfg.evalLiteral(cfg.extractLiteral(literal, 'BOSS_LIST').literal);

/* 從 combat.js 取出 npcSightRange／npcCombatProfile 原文，避免測試裡另抄一份換算。 */
function combatProfileFns() {
  const src = read('js/combat.js');
  const start = src.indexOf('function npcSightRange(');
  const end = src.indexOf('function makeFieldEnemy(');
  assert.ok(start > 0 && end > start);
  const ctx = { bfMeterPx: m => m * 10 };
  vm.runInNewContext(src.slice(start, end), ctx);
  return ctx;
}

test('TBMA-1 NPC 表 tower_boss 列已填移動／攻擊三欄，且寫進 BOSS_LIST', () => {
  const towerRows = rows.slice(1).filter(r => r[ix('類型')] === 'tower_boss');
  assert.equal(towerRows.length, 50);
  const list = bosses(source);
  towerRows.forEach((r, i) => {
    ['移動速度(米/秒)', '攻擊速度(次/秒)', '攻擊距離(米)'].forEach(col => assert.ok(Number(r[ix(col)]) > 0, r[0] + ' ' + col));
    assert.equal(list[i].runSpeed, Number(r[ix('移動速度(米/秒)')]));
    assert.equal(list[i].atkSpeed, Number(r[ix('攻擊速度(次/秒)')]));
    assert.equal(list[i].atkRange, Number(r[ix('攻擊距離(米)')]));
  });
});

test('TBMA-2 改表上的數值只影響那一隻；留白＝欄位不寫入（戰場預設）；填 0 中止套用', () => {
  const data = clone();
  const row = data.find(r => r[0] === 'tower_boss_2');
  row[ix('移動速度(米/秒)')] = '7.5';
  row[ix('攻擊速度(次/秒)')] = '';
  const out = bosses(cfg.SCHEMAS.NPC.rebuild(data, header, source).BOSS_LIST);
  assert.equal(out[1].runSpeed, 7.5);
  assert.equal(out[1].atkSpeed, undefined);
  assert.deepEqual(out[0], bosses(source)[0]);
  row[ix('攻擊距離(米)')] = '0';
  assert.throws(() => cfg.SCHEMAS.NPC.rebuild(data, header, source), /攻擊距離\(米\)」必須是大於 0/);
});

test('TBMA-3 extract 會把 BOSS_LIST 的三項寫回表格（往返一致）', () => {
  const extracted = cfg.SCHEMAS.NPC.extract(source);
  const h = cfg.SCHEMAS.NPC.header;
  const r = extracted.find(x => x[0] === 'tower_boss_4');
  const b = bosses(source)[3];
  assert.equal(r[h.indexOf('移動速度(米/秒)')], String(b.runSpeed));
  assert.equal(r[h.indexOf('攻擊速度(次/秒)')], String(b.atkSpeed));
  assert.equal(r[h.indexOf('攻擊距離(米)')], String(b.atkRange));
});

test('TBMA-4 makeBoss 用表上的攻速（絕對值，不分塔），移速與射程換成戰場座標', () => {
  const list = bosses(source);
  const fns = combatProfileFns();
  const stats = { level: 5, hp: 1000, atk: 10, def: 1, mdef: 1, dodge: 0, hit: 100, xp: 1, ctrlRes: 70, elemAtkVal: 1 };
  const ctx = { BOSS_LIST: list, STR: (_id, f, n) => f + ' ' + n, bossStatsFor: () => stats, ELEMENTS: ['fire'],
    npcCombatProfile: fns.npcCombatProfile, towerBossDefFor: f => list[(f - 1) % list.length] };
  vm.runInNewContext(read('js/tower.js'), ctx);
  [1, 4, 51, 101].forEach(floor => {
    const bd = list[(floor - 1) % list.length];
    const b = ctx.makeBoss(floor);
    assert.equal(b.aspd, bd.atkSpeed, 'floor ' + floor);
    assert.equal(b.runSpeed, bd.runSpeed * 10);
    assert.equal(b.atkRange, bd.atkRange * 10);
    assert.equal(b.sightRange, bd.sightRange * 10);
  });
});

test('TBMA-5 參數表與 formula.js 不再有塔 BOSS 攻速（避免兩套攻速並存）', () => {
  const gp = cfg.csvParse(read('config/CSV/game_parameters.csv'));
  const tower = gp.filter(r => r[2] === '4-高塔BOSS');
  assert.ok(tower.some(r => r[3] === '控制抵抗'));
  assert.ok(!tower.some(r => /攻速/.test(r[3])));
  ['TOWER_BOSS_TRIAL', 'TOWER_BOSS_HELL', 'TOWER_BOSS_PURGATORY'].forEach(name => {
    const o = cfg.evalLiteral(cfg.extractLiteral(source, name).literal);
    assert.equal(o.aspd, undefined, name);
    assert.equal(o.ctrlRes, 70, name);
  });
  assert.doesNotMatch(read('js/formula.js'), /aspd:\s*cfg\.aspd/);
});
