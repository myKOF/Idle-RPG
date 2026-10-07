'use strict';
/* elite-params.test.cjs — 參數表「4-菁英群組」與 js/data.js 的 ELITE_GROUP 一致，且 apply_params 擋得住打錯的格子。
   期望值不寫死：以參數表當下的內容為準，改的是「兩邊會不會脫鉤」「壞格子會不會被擋」。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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

test('ELITE-PARAMS-1 參數表有「4-菁英群組」全部 19 列，且與 data.js 一致（apply_params 試跑不報變更）', () => {
  const text = fs.readFileSync(CSV, 'utf8');
  const names = [];
  ['荒漠', '冰原', '沼澤', '亡靈山脈', '其他地圖'].forEach((z) => {
    names.push('普通關菁英機率(' + z + ')', '群組成員數權重(' + z + ')', '純菁英群機率(' + z + ')');
  });
  names.push('普通關菁英群數量權重', '菁英技能數量權重', '混合群與小兵', '菁英技能全域設定');
  assert.equal(names.length, 19);
  names.forEach((n) => assert.ok(text.indexOf(',4-菁英群組,' + n + ',') >= 0, '參數表缺列：' + n));
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

test('ELITE-PARAMS-3 格式打錯的區間格會被擋下並指出是哪一列，不會寫進程式', () => {
  const bad = tempCsv((t) => t.replace(/(,4-菁英群組,普通關菁英機率\(沼澤\),[^\n]*?),"?\{1~100,8\}"?,/, '$1,"{1~100;8}",'));
  const r = runApply(bad);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /普通關菁英機率\(沼澤\)/);
});

test('ELITE-PARAMS-4 整列沒有有效格、數值為負、區間上下界顛倒，都會被擋下', () => {
  const empty = tempCsv((t) => t.replace(/(,4-菁英群組,純菁英群機率\(荒漠\),[^\n]*?,)"\{1~100,15\}","\{101~9999,30\}",/, '$10,0,'));
  assert.notEqual(runApply(empty).code, 0, '整列全空要擋');
  const reversed = tempCsv((t) => t.replace(/\{101~9999,7\}/, '{9999~101,7}'));
  assert.notEqual(runApply(reversed).code, 0, '上下界顛倒要擋');
  const negative = tempCsv((t) => t.replace(/\{1~100,6\}/, '{1~100,-6}'));
  assert.notEqual(runApply(negative).code, 0, '負數要擋');
});
