'use strict';
/* ============================================================
   skills2-enemy-columns.test.cjs — 敵人技能的範圍、速度、間隔填在表格欄位（2026-10-21）

   使用者要求：NPC（敵人）技能的作用範圍、速度、作用間隔要填在 Skills2 的欄位，
   表格沒有適合的欄位才寫在效果參數(JSON)。接線在 tools/skills2-geometry.cjs 的 enemyRoutes。

   守的是三件事：
     1. Excel／CSV／JS 三邊一致：欄位＋JSON 併回來，就是 js/skills2.js 的 ENEMY_SKILLS2（引擎參數一個字都沒變）
     2. 表格有欄位就不能寫在 JSON：距離／速度／間隔類的鍵，不是接線到欄位，就是列在 enemyJsonKeep 並寫明原因
     3. 匯入規則與玩家技能一樣嚴：JSON 留著已接線的鍵、填了沒接線的欄位、填了「每級增量」都拒絕
   不釘任何一格的數值（使用者會在 Excel 調）。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const geo = require('../tools/skills2-geometry.cjs');
const tables = require('../tools/config_tables.cjs');

const ROOT = path.join(__dirname, '..');
const csv = tables.csvParse(fs.readFileSync(path.join(ROOT, 'config/CSV/Skills2.csv'), 'utf8'));
const head = csv[0].map(h => String(h).split('\n')[0].trim());
const col = name => head.indexOf(name);
const enemyRows = csv.slice(1).filter(r => String(r[col('類別')]).trim() === 'enemy');
const ENEMY = tables.evalLiteral(tables.extractLiteral(fs.readFileSync(path.join(ROOT, 'js/skills2.js'), 'utf8'), 'ENEMY_SKILLS2').literal);

/* elite_data.js 換成座標單位的鍵＝距離與速度；再加上時間間隔類 */
const eliteSrc = fs.readFileSync(path.join(ROOT, 'js/elite_data.js'), 'utf8');
const METER_KEYS = JSON.parse(/var ELITE_METER_KEYS = (\[[^\]]*\])/.exec(eliteSrc)[1].replace(/'/g, '"'));
const INTERVAL_KEYS = ['tick', 'gap', 'step', 'pulse'];

test('ENEMY-COL-1 表上的欄位＋JSON 併回來就是 ENEMY_SKILLS2（Excel／CSV／JS 一致）', () => {
  assert.ok(enemyRows.length >= 40, '敵人列：' + enemyRows.length);
  enemyRows.forEach(r => {
    const gid = r[col('群組ID')].trim();
    const fx = geo.enemyApply(gid, JSON.parse(r[col('效果參數(JSON)')]), label => r[col(label)]);
    assert.deepEqual(fx, ENEMY[gid].fx, gid);
  });
  const xlsx = tables.readXlsxRows(path.join(ROOT, 'config/Excel/Skills2.xlsx'));
  assert.deepEqual(csv, xlsx, 'CSV 要是 Excel 的轉出品');
});

test('ENEMY-COL-2 表格有欄位就不能寫在 JSON（不是接線，就是寫明為什麼留著）', () => {
  const bad = [];
  enemyRows.forEach(r => {
    const gid = r[col('群組ID')].trim();
    const json = JSON.parse(r[col('效果參數(JSON)')]);
    Object.keys(json).forEach(k => {
      if (METER_KEYS.indexOf(k) < 0 && INTERVAL_KEYS.indexOf(k) < 0) return;
      if (geo.enemyJsonKeep[k] === undefined) bad.push(gid + '.' + k);
    });
    geo.enemyKeys(gid).forEach(k => { if (json[k] !== undefined) bad.push(gid + '.' + k + '（已接線卻還在 JSON）'); });
  });
  assert.deepEqual(bad, [], '這些參數要接線到 Skills2 欄位（tools/skills2-geometry.cjs 的 enemyRoutes），或列進 enemyJsonKeep 寫明原因');
  /* 漩渦的 r 是畫面半徑；其他技能的 r 一律是傷害範圍，必須在欄位裡 */
  enemyRows.forEach(r => {
    const gid = r[col('群組ID')].trim();
    const json = JSON.parse(r[col('效果參數(JSON)')]);
    if (json.r !== undefined) assert.equal(json.arch, 'pull', gid + ' 的 r 應該填在「' + geo.labels.damage + '」');
  });
});

test('ENEMY-COL-3 接線只指向真的存在的敵人技能與欄位用途', () => {
  Object.keys(geo.enemyRoutes).forEach(gid => {
    assert.ok(ENEMY[gid], 'enemyRoutes 的「' + gid + '」不是敵人技能');
    geo.enemyBindings(gid).forEach(b => assert.ok(geo.labels[b[0]], gid + ' 的用途「' + b[0] + '」不是表格欄位'));
  });
  Object.keys(geo.enemyJsonKeep).forEach(k => assert.ok(geo.enemyJsonKeep[k].length >= 4, k + ' 要寫原因'));
});

test('ENEMY-COL-4 拆開再併回不會掉參數（全部敵人技能）', () => {
  Object.keys(ENEMY).forEach(gid => {
    const split = geo.enemyExtract(gid, ENEMY[gid].fx);
    assert.deepEqual(geo.enemyApply(gid, split.fx, label => split.cells[label]), ENEMY[gid].fx, gid);
  });
});

test('ENEMY-COL-5 匯入規則：JSON 留著已接線的鍵、沒接線的欄位、每級增量、速度 0 都拒絕', () => {
  const none = () => '';
  const only = (label, v) => l => (l === label ? v : '');
  assert.throws(() => geo.enemyApply('e_plague', { r: 6 }, none), /已改填「傷害範圍（米）」/);
  assert.throws(() => geo.enemyApply('e_plague', {}, only(geo.labels.speed, '8')), /未接線「飛行子彈速度/);
  assert.throws(() => geo.enemyApply('e_plague', {}, only(geo.labels.damage, '6,1')), /只有一階/);
  assert.throws(() => geo.enemyApply('e_charge', {}, only(geo.labels.speed, '0')), /大於零/);
  assert.throws(() => geo.enemyApply('e_vitality', {}, only(geo.labels.damage, '3')), /未接線/,
    '沒有任何接線的技能，填了欄位也要拒絕');
});

test('ENEMY-COL-6 長*寬與「一格寫兩個鍵」', () => {
  const wall = geo.enemyApply('e_walls', { life: 7 }, l => (l === geo.labels.body ? '18*3.9' : l === geo.labels.placement ? '9' : ''));
  assert.deepEqual(wall, { life: 7, len: 18, thick: 3.9, dist: 9 });
  assert.equal(geo.enemyExtract('e_walls', wall).cells[geo.labels.body], '18*3.9');
  /* 毒素加持：毒水球和中心毒圈一樣大（使用者 2026-10-16 的規格），一格同時寫兩個鍵 */
  const cross = geo.enemyApply('e_poisoncross', {}, l => (l === geo.labels.damage ? '4' : ''));
  assert.deepEqual(cross, { hubR: 4, ballR: 4 });
  assert.throws(() => geo.enemyExtract('e_poisoncross', { hubR: 4, ballR: 5 }), /值必須相同/);
});

test('ENEMY-COL-7 欄位定義頁寫明敵人技能的新規則', () => {
  const sk = tables.SCHEMAS.Skills2 || Object.values(tables.SCHEMAS).find(s => s && s.name === 'Skills2');
  const text = sk.extraSheets[0].rows.map(r => r[0]).join('\n');
  assert.ok(/範圍、速度、間隔填在表格欄位/.test(text));
  assert.ok(/enemyRoutes/.test(text), '要指出接線在哪裡');
  assert.ok(!/範圍用途欄不使用/.test(text), '舊說法「範圍用途欄不使用」要拿掉');
});
