const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { csvParse, readXlsxRows } = require('../tools/config_tables.cjs');
const { createEngine } = require('../scripts/sim/engine.js');

test('離線間隔的 Excel 來源、CSV 匯出、參數錨點與執行值一致', () => {
  const ctx = createEngine({ seed: 1 }).ctx;
  const root = path.resolve(__dirname, '..');
  const csv = csvParse(fs.readFileSync(path.join(root, 'config/CSV/game_parameters.csv'), 'utf8'));
  const excel = readXlsxRows(path.join(root, 'config/Excel/game_parameters.xlsx'));
  const param = (rows, name) => Number(rows.find((row) => row[2] === '10-離線' && row[3] === name)[6]);

  assert.equal(param(csv, '戰鬥間隔'), 5);
  assert.equal(param(excel, '戰鬥間隔'), 5);
  assert.equal(ctx.OFFLINE_WAVE_INTERVAL, 5);
  assert.equal(param(csv, '有效離線時間'), ctx.OFFLINE_MAX_HOURS);
  assert.deepEqual(csv.filter((row) => row[2] === '10-離線').map((row) => row[3]),
    ['有效離線時間', '結算關卡', '戰鬥間隔', '出怪規則']);
  const anchors = fs.readFileSync(path.join(root, 'tools/apply_params.cjs'), 'utf8');
  assert.match(anchors, /OFFLINE_WAVE_INTERVAL.*10-離線.*戰鬥間隔/);
  assert.doesNotMatch(anchors, /OFFLINE_LEVEL_REDUCE|OFFLINE_ELITE|OFFLINE_KILL_INTERVAL/);
});

test('場次以完整間隔取整，參數調整只改變場次', () => {
  const ctx = createEngine({ seed: 1 }).ctx;
  assert.equal(ctx.offlineWaveCount(4.99), 0);
  assert.equal(ctx.offlineWaveCount(60), 12);
  assert.equal(ctx.offlineWaveCount(64.99), 12);
  assert.equal(ctx.offlineWaveCount(65), 13);
  ctx.OFFLINE_WAVE_INTERVAL = 7;
  assert.equal(ctx.offlineWaveCount(60), 8);
});
