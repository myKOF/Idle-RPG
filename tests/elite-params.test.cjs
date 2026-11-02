'use strict';
/* elite-params.test.cjs — 參數表「4-菁英群組」與 js/data.js 的 ELITE_GROUP 一致，且 apply_params 擋得住打錯的格子。
   期望值不寫死：以參數表當下的內容為準，改的是「兩邊會不會脫鉤」「壞格子會不會被擋」。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const tables = require('../tools/config_tables.cjs');

const root = path.resolve(__dirname, '..');
const CSV = path.join(root, 'config', 'CSV', 'game_parameters.csv');

function runApply(csvPath) {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'apply_params.cjs')], {
    env: Object.assign({}, process.env, csvPath ? { PARAMS_CSV: csvPath } : {}), encoding: 'utf8'
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function tempCsv(transform) {
  const text = fs.readFileSync(CSV, 'utf8');
  const file = path.join(os.tmpdir(), 'gp-elite-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.csv');
  fs.writeFileSync(file, transform(text), 'utf8');
  return file;
}

test('ELITE-PARAMS-1 參數表有「4-菁英群組」剩下的 8 列（高級敵人、封魔塔BOSS玩家技能等全域設定），且與 data.js 一致（apply_params 試跑不報變更）', () => {
  const text = fs.readFileSync(CSV, 'utf8');
  const names = ['普通關菁英群數量權重', '混合群與小兵', '菁英技能全域設定'];
  names.push('高級菁英機率', '高級菁英倍率', '敵人體型倍率', '跑位設定', '封魔塔BOSS玩家技能');
  assert.equal(names.length, 8);
  names.forEach((n) => assert.ok(text.indexOf(',4-菁英群組,' + n + ',') >= 0, '參數表缺列：' + n));
  // 已搬到 Zones 表的機率／權重列不可再留在主參數表
  ['普通關菁英機率(', '群組成員數權重(', '純菁英群機率(', '菁英技能數量權重'].forEach((n) => assert.ok(text.indexOf(',' + n) < 0, '主參數表不應再有：' + n));
  assert.ok(text.indexOf(',4-敵人數量,') < 0, '「4-敵人數量」已搬到 Zones 表');
  const r = runApply();
  assert.equal(r.code, 0, r.out.slice(-400));
  assert.match(r.out, /錨點問題 0/);
  assert.match(r.out, /將變更 0/, 'data.js 的 ELITE_GROUP 與參數表脫鉤了：' + r.out.slice(-600));
});

test('ELITE-PARAMS-2 改參數表的格子，試跑會列出 ELITE_GROUP 的變更（證明錨點接得上）', () => {
  const csv = tempCsv((t) => t.replace(/(,4-菁英群組,菁英技能全域設定,[^\n]*?),100,100,/, '$1,150,100,'));
  const r = runApply(csv);
  assert.match(r.out, /ELITE_GROUP/);
  assert.match(r.out, /skillDmgPct: 150/);
});

function zoneRebuild(mutate) {
  const rows = tables.csvParse(fs.readFileSync(path.join(root, 'config', 'CSV', 'Zones.csv'), 'utf8')).filter((r) => r.length > 1);
  const header = rows.shift();
  const col = (name) => header.findIndex((h) => h.split('\n')[0].trim() === name);
  mutate(rows, col);
  return tables.SCHEMAS.Zones.rebuild(rows, header, fs.readFileSync(path.join(root, 'js', 'data.js'), 'utf8'));
}

test('ELITE-PARAMS-3 Zones 表格式打錯的區間格會被擋下並指出是哪一張地圖、哪一欄', () => {
  assert.throws(() => zoneRebuild((rows, col) => { rows.find((r) => r[1] === 'swamp')[col('普通關菁英機率')] = '{1~100;8}'; }), /swamp \/ 普通關菁英機率/);
});

test('ELITE-PARAMS-4 Zones 表整欄空白、數值為負、區間上下界顛倒、關卡沒被涵蓋，都會被擋下', () => {
  assert.throws(() => zoneRebuild((rows, col) => { rows[0][col('純菁英群機率')] = ''; }), /沒有任何設定/);
  assert.throws(() => zoneRebuild((rows, col) => { rows[0][col('普通關菁英機率')] = '{9999~101,7}'; }), /上下界顛倒/);
  assert.throws(() => zoneRebuild((rows, col) => { rows[0][col('普通關菁英機率')] = '{1~100,-6}'; }), /數值不可為負/);
  assert.throws(() => zoneRebuild((rows, col) => { rows[0][col('小怪數量權重')] = '{1~20,1~2,95}'; }), /沒有被任何區間涵蓋/);
  const ok = zoneRebuild((rows, col) => { rows[0][col('小怪數量權重')] = '{1~9999,2~3,5}'; });
  assert.ok(ok.ZONE_ENCOUNTER.replace(/\s/g, '').includes('mobCount:[[1,9999,[[2,5],[3,5]]]]'));
});
