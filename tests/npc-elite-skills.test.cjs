'use strict';
/* NPC 表的「類型」「技能」「技能特效」「備註」欄（2026-10-08）：
   normal／elite／boss 各一列；elite 列的技能是這種菁英固定使用的詞條。 */
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

test('NPC-SKILL-1 每個 NPC 有 normal／elite／boss 三列，技能欄只有 elite 列有值', () => {
  const { col, rows } = readCsv();
  const byId = {};
  rows.forEach((r) => { (byId[r[col('NPC識別碼')]] = byId[r[col('NPC識別碼')]] || []).push(r); });
  assert.equal(Object.keys(byId).length, 84);
  Object.keys(byId).forEach((id) => {
    assert.deepEqual(byId[id].map((r) => r[col('類型')]), ['normal', 'elite', 'boss'], id);
    byId[id].forEach((r) => {
      if (r[col('類型')] !== 'elite') assert.equal(r[col('技能')], '', id + ' ' + r[col('類型')] + ' 不該有技能');
      assert.notEqual(r[col('備註')], '', id + ' 要有備註');
    });
  });
});

test('NPC-SKILL-2 elite 列的技能存在、1~3 個、同一 NPC 不重複也不同互斥組，特效欄列得出 preset 檔', () => {
  const { col, rows } = readCsv();
  const c = loadEliteEnv();
  const A = c.ELITE_AFFIXES;
  const presets = new Set(fs.readdirSync(path.join(root, 'vfx/presets')).map((f) => f.replace(/\.json$/i, '')));
  rows.filter((r) => r[col('類型')] === 'elite').forEach((r) => {
    const id = r[col('NPC識別碼')];
    const ids = r[col('技能')].split(';').filter(Boolean);
    assert.ok(ids.length >= 1 && ids.length <= 3, id + ' 技能數 ' + ids.length);
    assert.equal(new Set(ids).size, ids.length, id + ' 技能重複');
    const grps = ids.map((k) => { assert.ok(A[k], id + ' 未知技能 ' + k); return A[k].grp; }).filter(Boolean);
    assert.equal(new Set(grps).size, grps.length, id + ' 同互斥組：' + ids);
    ids.forEach((k) => {
      assert.ok(r[col('技能特效')].includes(A[k].name + '：'), id + ' 特效欄缺 ' + k);
      assert.ok(r[col('備註')].includes(A[k].name + '：'), id + ' 備註缺 ' + k);
    });
    (r[col('技能特效')].match(/[A-Za-z][A-Za-z0-9-]+/g) || []).forEach((p) => assert.ok(presets.has(p), id + ' 特效 ' + p + ' 不存在'));
  });
});

test('NPC-SKILL-3 CSV 與 js/data.js 一致：套用後無差異，且唯讀欄位是最新的', () => {
  const r = spawnSync(process.execPath, ['tools/config_tables.cjs', '--apply', 'NPC'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /語意變更 0/);
  const fresh = cfg.SCHEMAS.NPC.extract(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'));
  assert.equal(cfg.csvStringify([cfg.SCHEMAS.NPC.header].concat(fresh)).replace(/^﻿/, ''),
    fs.readFileSync(path.join(root, 'config/CSV/NPC.csv'), 'utf8').replace(/^﻿/, ''),
    '改了技能請執行 node tools/config_tables.cjs --gen 的等價流程重新產生技能特效與備註欄');
});

test('NPC-SKILL-4 套用檢查：未知技能、超過 3 個、未知類型都會中止', () => {
  const src = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
  const sc = cfg.SCHEMAS.NPC;
  const base = () => sc.extract(src).map((r) => r.slice());
  const i = (n) => sc.header.indexOf(n);
  const eliteRow = (rows) => rows.find((r) => r[i('類型')] === 'elite');
  const rebuild = (rows) => sc.rebuild(rows, sc.header, src);
  assert.doesNotThrow(() => rebuild(base()));
  let rows = base(); eliteRow(rows)[i('技能')] = 'nosuchskill';
  assert.throws(() => rebuild(rows), /不存在/);
  rows = base(); eliteRow(rows)[i('技能')] = 'meteor;firewall;heal;regen';
  assert.throws(() => rebuild(rows), /超過 3 個/);
  rows = base(); eliteRow(rows)[i('類型')] = 'king';
  assert.throws(() => rebuild(rows), /類型/);
});

test('NPC-SKILL-5 菁英群出怪：有固定技能的 NPC 用固定技能；表裡留白的才吃整群隨機', () => {
  const c = loadEliteEnv();
  const run = (code) => require('node:vm').runInContext(code, c);
  /* 荒漠：史萊姆(desert_1)固定放 heal；其餘全部清空，確認「留白＝沿用隨機」 */
  run("Object.keys(NPC_CONFIG_TABLE).forEach(function (k) { NPC_CONFIG_TABLE[k].eliteSkills = []; }); NPC_CONFIG_TABLE.desert_1.eliteSkills = ['heal', 'regen'];");
  let fixed = 0, random = 0;
  for (let n = 0; n < 200; n++) {
    run("G.stage.current = 10; G.stage.zone = 'desert'; FIELD.monsters = []; FIELD.monster = null; FIELD._waveClearPending = false;");
    const wave = c.spawnFieldMonster(false);
    const elites = wave.filter((e) => e.elite);
    elites.forEach((e) => {
      if (e.npcId === 'desert_1') { fixed++; assert.deepEqual(Array.from(e.affixes), ['heal', 'regen']); }
      else random++;
    });
    const others = elites.filter((e) => e.npcId !== 'desert_1');
    others.forEach((e) => assert.ok(e.affixes.length >= 1 && e.affixes.length <= 3, '沒指定的仍是隨機 1~3 個'));
  }
  assert.ok(fixed > 0 && random > 0, '兩種情況都該出現（固定 ' + fixed + '／隨機 ' + random + '）');
});
