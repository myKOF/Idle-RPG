'use strict';
/* NPC 表（2026-10-13 菁英改造）：每個 NPC 四列 normal／elite／elite_adv／boss，另有封魔塔 BOSS 的 tower_boss 列；
   技能欄＝專屬技能（Skills2 敵人技能群組ID）＋隨機技能數量下限／上限；技能特效欄已移除。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadEliteEnv } = require('./helpers/elite-env.cjs');

const root = path.resolve(__dirname, '..');
const cfg = require('../tools/config_tables.cjs');

function readCsv() {
  const rows = cfg.csvParse(fs.readFileSync(path.join(root, 'config/CSV/NPC.csv'), 'utf8'));
  const header = rows[0];
  const col = (n) => { const i = header.indexOf(n); assert.ok(i >= 0, '缺欄位 ' + n); return i; };
  return { header, col, rows: rows.slice(1).filter((r) => r.length > 1) };
}

test('NPC-SKILL-1 欄位：技能特效欄已移除，新增專屬技能與隨機技能數量上下限', () => {
  const { header } = readCsv();
  assert.deepEqual(header.slice(header.indexOf('專屬技能')), ['專屬技能', '隨機技能下限', '隨機技能上限', '備註']);
  assert.ok(header.indexOf('技能特效') < 0, '技能特效欄不再需要');
  assert.ok(header.indexOf('技能') < 0);
});

test('NPC-SKILL-2 每個 NPC 有 normal／elite／elite_adv／boss 四列；另有 10 列 tower_boss（封魔塔 BOSS）', () => {
  const { col, rows } = readCsv();
  const byId = {};
  rows.forEach((r) => { (byId[r[col('NPC識別碼')]] = byId[r[col('NPC識別碼')]] || []).push(r[col('類型')]); });
  const ids = Object.keys(byId);
  const towers = ids.filter((id) => /^tower_boss_/.test(id));
  assert.equal(towers.length, 10);
  towers.forEach((id) => assert.deepEqual(byId[id], ['tower_boss'], id));
  const npcs = ids.filter((id) => !/^tower_boss_/.test(id));
  assert.equal(npcs.length, 84);
  npcs.forEach((id) => assert.deepEqual(byId[id], ['normal', 'elite', 'elite_adv', 'boss'], id));
});

test('NPC-SKILL-3 文件規定的技能數量：菁英 2 隨機；高級菁英 3 隨機；野外 BOSS 1 專屬＋3 隨機；封魔塔 BOSS 1~2 專屬＋4~6 隨機', () => {
  const { col, rows } = readCsv();
  const c = loadEliteEnv();
  rows.forEach((r) => {
    const id = r[col('NPC識別碼')], type = r[col('類型')];
    const ex = r[col('專屬技能')].split(';').filter(Boolean);
    const lo = r[col('隨機技能下限')], hi = r[col('隨機技能上限')];
    ex.forEach((k) => assert.ok(c.ELITE_AFFIXES[k], id + ' 專屬技能 ' + k + ' 不存在'));
    assert.equal(new Set(ex).size, ex.length);
    if (type === 'normal') { assert.deepEqual([ex.length, lo, hi], [0, '', ''], id + ' 普通怪沒有技能'); }
    if (type === 'elite') { assert.deepEqual([ex.length, lo, hi], [0, '2', '2'], id); }
    if (type === 'elite_adv') { assert.deepEqual([ex.length, lo, hi], [0, '3', '3'], id); }
    if (type === 'boss') { assert.deepEqual([ex.length, lo, hi], [1, '3', '3'], id); assert.equal(c.ELITE_AFFIXES[ex[0]].pool, 'exclusive'); }
    if (type === 'tower_boss') {
      assert.ok(ex.length >= 1 && ex.length <= 2, id + ' 專屬 1~2 個');
      assert.deepEqual([lo, hi], ['4', '6'], id);
      ex.forEach((k) => { assert.ok(!c.ELITE_AFFIXES[k].noTower, id + ' 的專屬技能 ' + k + ' 在封魔塔沒有作用'); assert.notEqual(c.ELITE_AFFIXES[k].needs, 'group'); });
    }
  });
});

test('NPC-SKILL-4 資料同步：套用後 js/data.js 一致（NPC pool 的 skills、BOSS_LIST 的 skills 與 id）', () => {
  const r = spawnSync(process.execPath, ['tools/config_tables.cjs', '--apply', 'NPC'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /語意變更 0/);
  const c = loadEliteEnv();
  assert.equal(c.NPC_CONFIG_TABLE.desert_11.skills.boss.ex.length, 1);
  assert.deepEqual(Array.from(c.NPC_CONFIG_TABLE.desert_1.skills.elite.rnd), [2, 2]);
  assert.equal(c.BOSS_LIST.length, 10);
  c.BOSS_LIST.forEach((b, i) => { assert.equal(b.id, 'tower_boss_' + (i + 1)); assert.ok(b.skills.ex.length >= 1); assert.deepEqual(Array.from(b.skills.rnd), [4, 6]); });
  const fresh = cfg.SCHEMAS.NPC.extract(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'));
  assert.equal(cfg.csvStringify([cfg.SCHEMAS.NPC.header].concat(fresh)).replace(/^﻿/, '').replace(/\r\n/g, '\n'),
    fs.readFileSync(path.join(root, 'config/CSV/NPC.csv'), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n'), '備註欄是自動產生的，改了技能請重新產生 CSV');
});

test('NPC-SKILL-5 套用檢查：未知專屬技能、隨機數量超出技能池、上限小於下限、未知類型、專屬技能重複都會中止', () => {
  const src = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
  const sc = cfg.SCHEMAS.NPC;
  const base = () => sc.extract(src).map((r) => r.slice());
  const i = (n) => sc.header.indexOf(n);
  const rowOf = (rows, type) => rows.find((r) => r[i('類型')] === type);
  const rebuild = (rows) => sc.rebuild(rows, sc.header, src);
  assert.doesNotThrow(() => rebuild(base()));
  let rows = base(); rowOf(rows, 'boss')[i('專屬技能')] = 'e_nosuchskill';
  assert.throws(() => rebuild(rows), /不是 Skills2 表的敵人技能/);
  rows = base(); rowOf(rows, 'elite')[i('隨機技能上限')] = '99';
  assert.throws(() => rebuild(rows), /超過隨機技能池/);
  rows = base(); { const r = rowOf(rows, 'elite'); r[i('隨機技能下限')] = '3'; r[i('隨機技能上限')] = '2'; }
  assert.throws(() => rebuild(rows), /上限不得小於下限/);
  rows = base(); rowOf(rows, 'elite')[i('類型')] = 'king';
  assert.throws(() => rebuild(rows), /類型/);
  rows = base(); rowOf(rows, 'boss')[i('專屬技能')] = 'e_meteor;e_meteor';
  assert.throws(() => rebuild(rows), /重複/);
  rows = base(); rows.pop();
  assert.throws(() => rebuild(rows), /tower_boss/, '封魔塔 BOSS 列數固定');
});

test('NPC-SKILL-6 基本資料只認 normal 列：改其他類型列的名稱不會影響遊戲；改 tower_boss 列的名稱、屬性會寫回 BOSS_LIST', () => {
  const src = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
  const sc = cfg.SCHEMAS.NPC;
  const i = (n) => sc.header.indexOf(n);
  const rows = sc.extract(src).map((r) => r.slice());
  rows.find((r) => r[i('類型')] === 'elite' && r[i('NPC識別碼')] === 'desert_1')[i('NPC名稱')] = '被改名的菁英';
  rows.find((r) => r[i('NPC識別碼')] === 'tower_boss_1')[i('NPC名稱')] = '新名字魔君';
  const out = sc.rebuild(rows, sc.header, src);
  const desert = cfg.evalLiteral(cfg.extractLiteral(out.DESERT_POOL, 'DESERT_POOL').literal);
  assert.equal(desert[0].name, '史萊姆', '只認 normal 列');
  const bosses = cfg.evalLiteral(cfg.extractLiteral(out.BOSS_LIST, 'BOSS_LIST').literal);
  assert.equal(bosses[0].name, '新名字魔君');
  assert.equal(bosses[0].img, 'boss_flame.png', '圖檔不受表控制');
});

test('NPC-SKILL-7 Skills2 的敵人技能列：有「類別」欄、只有 enemy 列進 ENEMY_SKILLS2，玩家技能不受影響', () => {
  const rows = cfg.csvParse(fs.readFileSync(path.join(root, 'config/CSV/Skills2.csv'), 'utf8')).filter((r) => r.length > 1);
  const header = rows[0];
  const k = header.indexOf('類別');
  assert.ok(k >= 0, 'Skills2 要有「類別」欄（位置由使用者調整，用表頭名稱找）');
  const enemy = rows.slice(1).filter((r) => r[k] === 'enemy');
  const player = rows.slice(1).filter((r) => r[k] === '');
  assert.ok(enemy.length >= 50);
  assert.equal(enemy.length + player.length, rows.length - 1, '類別只有 enemy 與留白兩種');
  enemy.forEach((r) => assert.match(r[0], /^e_/));
  player.forEach((r) => assert.doesNotMatch(r[0], /^e_/));
  const c = loadEliteEnv();
  assert.equal(Object.keys(c.ENEMY_SKILLS2).length, enemy.length);
  Object.keys(c.ENEMY_SKILLS2).forEach((id) => assert.ok(!c.SKILLS2[id], '玩家技能表裡不該出現敵人技能 ' + id));
});
