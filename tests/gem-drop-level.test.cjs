'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');

function load() {
  const ctx = {}; vm.createContext(ctx);
  for (const f of ['js/util.js', 'js/data.js', 'js/item.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
function tally(c, lv, n = 6000) { const o = {}; for (let i = 0; i < n; i++) { const t = c.randomGemTypeForLevel(lv); o[t] = (o[t] || 0) + 1; } return o; }

test('GEMDROP-1 沒填掉落等級＝任何怪物等級權重 1（維持原行為）', () => {
  const c = load();
  assert.equal(c.gemDropWeight('ruby', 1), 1);
  assert.equal(c.gemDropWeight('ruby', 9999), 1);
});

test('GEMDROP-2 依怪物等級區間當權重挑種類；區間外不掉；全部為 0 回傳 null', () => {
  const c = load();
  for (const k of Object.keys(c.GEM_TYPES)) c.GEM_TYPES[k].dropLevels = [[500, 600, 1]];
  c.GEM_TYPES.ruby.dropLevels = [[1, 20, 0.1], [21, 100, 0.2]];
  c.GEM_TYPES.sapphire.dropLevels = [[21, 100, 0.2]];
  assert.deepEqual(Object.keys(tally(c, 10)), ['ruby']);
  const t = tally(c, 50);
  assert.deepEqual(Object.keys(t).sort(), ['ruby', 'sapphire']);
  assert.ok(Math.abs(t.ruby - t.sapphire) < 600);          // 權重相同
  assert.equal(c.randomGemTypeForLevel(300), null);
});

test('GEMDROP-3 Gems 表「掉落等級」解析：格式錯誤中止、正確寫入 dropLevels', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools/config_tables.cjs'), 'utf8');
  const schema = src.slice(src.indexOf('SCHEMAS.Gems ='), src.indexOf('/* ---- Talents'));
  const prefix = src.slice(0, src.indexOf('/* ---- Skills'));
  const c = { require, __dirname: path.join(ROOT, 'tools'), process, console };
  vm.createContext(c);
  vm.runInContext(prefix.slice(0, prefix.indexOf('SCHEMAS.Skills')) + '\n' + schema + '\nthis.schema = SCHEMAS.Gems;', c);
  const h = c.schema.header;
  const row = h.map(() => ''); const set = (n, v) => { row[h.indexOf(n)] = v; };
  set('id', 'ruby'); set('名稱', 'R'); set('開放', '1'); for (let i = 1; i <= 10; i++) set(i + '級', '1');
  set('掉落等級', '{1~20,0.1}|{21~100,0.2}');
  const out = {}; vm.runInNewContext(c.schema.rebuild([row], h).GEM_TYPES, out);
  assert.deepEqual(JSON.parse(JSON.stringify(out.GEM_TYPES.ruby.dropLevels)), [[1, 20, 0.1], [21, 100, 0.2]]);
  set('掉落等級', '1~20,0.1');
  assert.throws(() => c.schema.rebuild([row], h), /掉落等級格式/);
  set('掉落等級', '{30~20,0.1}');
  assert.throws(() => c.schema.rebuild([row], h), /掉落等級範圍/);
});

test('GEMDROP-4 正式 Excel、CSV 與遊戲種類權重一致，不再保留無效開放等級欄', () => {
  const { readXlsxRows, csvParse, SCHEMAS } = require('../tools/config_tables.cjs');
  const rows = readXlsxRows(path.join(ROOT, 'config/Excel/Gems.xlsx'));
  const csv = csvParse(fs.readFileSync(path.join(ROOT, 'config/CSV/Gems.csv'), 'utf8'));
  assert.deepEqual(csv, rows);
  const header = rows[0], dropIndex = header.indexOf('掉落等級');
  assert.ok(dropIndex >= 0);
  assert.equal(header.includes('開放等級'), false, '避免再把限制填進不被讀取的欄位');
  const rebuilt = {};
  vm.runInNewContext(SCHEMAS.Gems.rebuild(rows.slice(1), header).GEM_TYPES, rebuilt);
  const c = load();
  assert.deepEqual(JSON.parse(JSON.stringify(c.GEM_TYPES)), JSON.parse(JSON.stringify(rebuilt.GEM_TYPES)));
  for (const row of rows.slice(1)) {
    assert.notEqual(row[dropIndex], '', row[0] + ' 的原設定應完整遷移');
    const ranges = row[dropIndex].split('|').map(segment => {
      const match = /^\{(\d+)~(\d+),([\d.]+)\}$/.exec(segment);
      assert.ok(match, row[0] + ' 掉落等級格式');
      return match.slice(1).map(Number);
    });
    const boundaries = new Set([1, ...ranges.flatMap(([lo, hi]) => [lo - 1, lo, hi, hi + 1])]);
    for (const level of boundaries) {
      if (level < 1) continue;
      const expected = c.isGemEnabled(row[0]) ? ranges.reduce((sum, [lo, hi, weight]) =>
        sum + (level >= lo && level <= hi ? weight : 0), 0) : 0;
      assert.equal(c.gemDropWeight(row[0], level), expected, row[0] + ' Lv.' + level);
    }
  }
});

test('GEMDROP-5 元素抗性及對元素傷害201級起掉，元素核心51級起掉', () => {
  const c = load();
  for (const [type, def] of Object.entries(c.GEM_TYPES)) {
    const threshold = /^(?:res(?:Fire|Ice|Lightning|Poison|Dark|Light|Earth|Wind)|dmgVs)/.test(def.stat) ? 201 :
      /^elemDmg/.test(def.stat) ? 51 : 1;
    assert.equal(c.gemDropWeight(type, 1), c.isGemEnabled(type) && threshold === 1 ? 1 : 0, type);
    if (threshold > 1) {
      assert.equal(c.gemDropWeight(type, threshold - 1), 0, type + ' 門檻前不得掉落');
      assert.equal(c.gemDropWeight(type, threshold), 1, type + ' 門檻當級可掉落');
    }
  }
});

test('GEMDROP-6 正式野外及離線結算遵守地抗寶石門檻，強化怪物等級不提前解鎖', () => {
  const { createEngine } = require('../scripts/sim/engine.js');
  for (const level of [200, 201]) {
    const e = createEngine({ seed: 19 }).boot(), c = e.ctx, g = e.state();
    for (const [type, def] of Object.entries(c.GEM_TYPES)) def.enabled = type === 'wardEarth';
    c.ZONE_STAGE_DROP_TABLE.swamp = [{ min: 1, max: 400, equipmentRates: [],
      materials: { gemRates: [100], bookRate: 0, ancientEssenceRate: 0, dustRate: 0, partRate: 0 } }];
    g.stage.zone = 'swamp'; g.stage.current = level;
    g.player.gems = {};
    const loot = [];
    c.recordLootGem = (...args) => loot.push(args);
    c.rollFieldDrops({ level });
    assert.equal(c.gemCount('wardEarth', 1) > 0, level >= 201, '野外 Lv.' + level);
    assert.equal(loot.length > 0, level >= 201, '只記錄實際掉落');
    g.player.gems = {};
    c.rollFieldDrops({ level: level + 100, _powerLevelBonus: 100 });
    assert.equal(c.gemCount('wardEarth', 1) > 0, level >= 201, '強化後仍以原怪物等級判斷');
    g.player.gems = {};
    const offline = e.offlineFor(600);
    assert.ok(offline && offline.kills > 0, '確實執行離線擊殺');
    assert.equal(offline.stage, level, '使用可容納門檻等級的正式地圖');
    assert.equal(c.gemCount('wardEarth', 1) > 0, level >= 201, '離線 Lv.' + level);
    assert.equal(Object.values(offline.gems).some(count => count > 0), level >= 201);
    assert.equal(c.randomGemType(), 'wardEarth', '不依怪物等級抽取的其他取得途徑保持開放');
  }
});
