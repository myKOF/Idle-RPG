/* 野外裝備掉落表：唯一來源為 Zone_Stage_Drops.csv 的地圖／關卡區間。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadContext() {
  const context = { console, Math };
  vm.createContext(context);
  for (const file of ['js/data.js', 'js/formula.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
  return context;
}
function plain(v) { return JSON.parse(JSON.stringify(v)); }
function parseCsvLine(line) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function readZoneDrops() {
  const lines = fs.readFileSync(path.join(ROOT, 'config/CSV/Zone_Stage_Drops.csv'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const idx = Object.fromEntries(header.map((name, i) => [name, i]));
  return lines.slice(1).map(parseCsvLine).map((row) => ({
    zone: row[idx['地圖識別碼']],
    min: Number(row[idx['最低關卡']]),
    max: Number(row[idx['最高關卡']]),
    rates: row[idx['裝備掉落率（品質R0至R10）']].split('|').map(Number)
  }));
}

test('地圖掉落表集中管理 R0～R10 裝備掉落率', () => {
  const context = loadContext();
  const config = readZoneDrops();
  const table = plain(context.ZONE_STAGE_DROP_TABLE);

  // origin/develop 的掉落表新增了兩個地圖／關卡區間；目前 CSV 資料列為 32 列。
  assert.equal(config.length, 32);
  assert.deepEqual(Object.keys(table), ['plains', 'desert', 'swamp', 'undead_mountains', 'god_battlefield', 'god_chaos', 'god_sanctuary']);
  for (const row of config) {
    assert.equal(row.rates.length, 11, row.zone + ' ' + row.min + ' 應有 R0～R10 共 11 欄');
    assert.deepEqual(
      table[row.zone].find((item) => item.min === row.min && item.max === row.max).equipmentRates,
      row.rates,
      row.zone + ' ' + row.min + '~' + row.max + ' 裝備掉落率不一致'
    );
  }
});

test('地圖／關卡邊界查表與 CSV 一致，混沌 R9 由 Zone_Stage_Drops 控制', () => {
  const context = loadContext();
  const config = readZoneDrops();
  for (const row of config) {
    const expected = config
      .filter((candidate) => candidate.zone === row.zone && row.min >= candidate.min && row.min <= candidate.max)
      .reduce((sum, candidate) => sum.map((value, index) => value + candidate.rates[index]), Array(11).fill(0));
    assert.deepEqual(
      plain(context.fieldDropRatesFor(row.min, 1, row.zone)),
      expected,
      row.zone + ' 關卡 ' + row.min + ' 查表錯誤'
    );
  }
  assert.equal(context.fieldDropRatesFor(550, 1, 'god_battlefield')[9], 0);
  assert.equal(context.fieldDropRatesFor(551, 1, 'god_battlefield')[9], 1);
  assert.equal(context.fieldDropRatesFor(551, 1, 'god_chaos')[9], 1);
  assert.equal(context.fieldDropRatesFor(601, 1, 'god_sanctuary')[9], 1);
});

test('重疊的地圖／關卡列按裝備、寶石與材料欄位逐欄相加', () => {
  const context = loadContext();
  context.ZONE_STAGE_DROP_TABLE.overlap_fixture = [
    {
      min: 20, max: 99,
      equipmentRates: [35, 20, 15, 5, 1, 0, 0, 0, 0, 0, 0],
      materials: { gemRates: [1, 0, 0, 0, 0], bookRate: 2, ancientEssenceRate: 3, dustRate: 4, partRate: 5 }
    },
    {
      min: 40, max: 49,
      equipmentRates: [0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0],
      materials: { gemRates: [0, 1, 0, 0, 0], bookRate: 3, ancientEssenceRate: 4, dustRate: 5, partRate: 6 }
    }
  ];

  assert.deepEqual(
    plain(context.fieldDropRatesFor(30, 1, 'overlap_fixture')),
    [35, 20, 15, 5, 1, 0, 0, 0, 0, 0, 0]
  );
  assert.deepEqual(
    plain(context.fieldDropRatesFor(40, 1, 'overlap_fixture')),
    [35, 20, 15, 5, 3, 0, 0, 0, 0, 0, 0]
  );
  assert.deepEqual(
    plain(context.fieldMaterialConfigFor('overlap_fixture', 40)),
      // 野外零件掉落已移除，材料表不再提供 partRate。
      { gemRates: [1, 1, 0, 0, 0], bookRate: 5, ancientEssenceRate: 7, dustRate: 9 }
  );
});

test('game_parameters 不再保留地圖掉落重複列', () => {
  const csv = fs.readFileSync(path.join(ROOT, 'config/CSV/game_parameters.csv'), 'utf8');
  assert.doesNotMatch(csv, /5-野外裝備掉落/);
  assert.doesNotMatch(csv, /5-野外寶石掉落/);
  assert.doesNotMatch(csv, /5-野外材料/);
});
