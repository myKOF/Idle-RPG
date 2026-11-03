const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
function loadContext() {
  const context = { console, Math };
  vm.createContext(context);
  for (const file of ['js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js']) {
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
    rates: row[idx['寶石掉落率（等級R1至R10）']].split('|').map(Number)
  }));
}

test('地圖／關卡掉落表提供 R1～R10 寶石掉落率', () => {
  const context = loadContext();
  const config = readZoneDrops();
  for (const row of config) {
    assert.equal(row.rates.length, 10);
    const expected = config
      .filter((candidate) => candidate.zone === row.zone && row.min >= candidate.min && row.min <= candidate.max)
      .reduce((sum, candidate) => sum.map((value, index) => value + candidate.rates[index]), Array(10).fill(0));
    const cfg = context.zoneStageDropConfigFor(row.zone, row.min);
    assert.deepEqual(JSON.parse(JSON.stringify(cfg.materials.gemRates)), expected, row.zone + ' ' + row.min + ' 寶石率不一致');
  }
});

test('R6～R10 非零配置依階級掉落，零配置不掉落', () => {
  const context = loadContext();
  context.window = context;
  context.UI = { dirty: {} };
  for (const file of ['js/util.js', 'js/battlefield.js', 'js/combat.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
  context.G = { stage: { zone: 'test', current: 1 }, player: {} };
  context.FIELD = { player: {} };
  context.getStats = () => ({ loot: 0 });
  context.buffVal = () => 0;
  context.currentZoneDef = () => ({ rewardMult: 1 });
  context.rollDropCount = (rate) => Math.floor(rate / 100);
  context.randomGemType = () => 'ruby';
  context.gemLabel = (type, level) => type + level;
  const received = [];
  context.addGem = (type, level, count) => received.push([type, level, count]);
  const rates = Array(10).fill(0);
  context.ZONE_STAGE_DROP_TABLE.test = [{ min: 1, max: 1, equipmentRates: [],
    materials: { gemRates: rates, bookRate: 0, ancientEssenceRate: 0, dustRate: 0 } }];
  context.rollFieldDrops({ level: 1 });
  assert.deepEqual(received, []);
  rates.fill(100, 5);
  context.rollFieldDrops({ level: 1 });
  assert.deepEqual(received, [6, 7, 8, 9, 10].map(level => ['ruby', level, 1]));
});

test('戰鬥程式不再回讀怪物等級寶石掉落表', () => {
  const combat = fs.readFileSync(path.join(ROOT, 'js/combat.js'), 'utf8');
  const save = fs.readFileSync(path.join(ROOT, 'js/save.js'), 'utf8');
  const formula = fs.readFileSync(path.join(ROOT, 'js/formula.js'), 'utf8');
  assert.doesNotMatch(combat, /fieldGemDropRatesFor/);
  assert.doesNotMatch(save, /fieldGemDropRatesFor/);
  assert.doesNotMatch(formula, /FIELD_GEM_DROP_TABLE/);
});
