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
