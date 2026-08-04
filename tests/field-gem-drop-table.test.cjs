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
    rates: row[idx['寶石掉落率（等級R1至R5）']].split('|').map(Number)
  }));
}

test('地圖／關卡掉落表提供 R1～R5 寶石掉落率', () => {
  const context = loadContext();
  const config = readZoneDrops();
  for (const row of config) {
    assert.equal(row.rates.length, 5);
    const expected = config
      .filter((candidate) => candidate.zone === row.zone && row.min >= candidate.min && row.min <= candidate.max)
      .reduce((sum, candidate) => sum.map((value, index) => value + candidate.rates[index]), Array(5).fill(0));
    const cfg = context.zoneStageDropConfigFor(row.zone, row.min);
    assert.deepEqual(JSON.parse(JSON.stringify(cfg.materials.gemRates)), expected, row.zone + ' ' + row.min + ' 寶石率不一致');
  }
});

test('戰鬥程式不再回讀怪物等級寶石掉落表', () => {
  const combat = fs.readFileSync(path.join(ROOT, 'js/combat.js'), 'utf8');
  const save = fs.readFileSync(path.join(ROOT, 'js/save.js'), 'utf8');
  const formula = fs.readFileSync(path.join(ROOT, 'js/formula.js'), 'utf8');
  assert.doesNotMatch(combat, /fieldGemDropRatesFor/);
  assert.doesNotMatch(save, /fieldGemDropRatesFor/);
  assert.doesNotMatch(formula, /FIELD_GEM_DROP_TABLE/);
});
