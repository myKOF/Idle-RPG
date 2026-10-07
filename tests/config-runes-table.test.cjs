const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const cfg = require(path.join(root, 'tools', 'config_tables.cjs'));
const schema = cfg.SCHEMAS.Runes;
const csvPath = path.join(root, 'config', 'CSV', 'Runes.csv');
const xlsxPath = path.join(root, 'config', 'Excel', 'Runes.xlsx');
const dataSrc = fs.readFileSync(path.join(root, 'js', 'runeword_data.js'), 'utf8');

/* 配置表 Runes（2026-10-07）：符文、符文真言與全域設定的唯一資料來源。
   Excel（config/Excel/Runes.xlsx）→ CSV → js/runeword_data.js 三個字面值，由 tools/config_tables.cjs 接線。 */
const csvRows = () => cfg.csvParse(fs.readFileSync(csvPath, 'utf8')).filter((r) => r.length > 1);
const lit = (src, name) => cfg.evalLiteral(cfg.extractLiteral(src, name).literal);
const plain = (x) => JSON.parse(JSON.stringify(x));
function rebuildFrom(rows) {
  const header = rows[0];
  const out = schema.rebuild(rows.slice(1), header);
  const merged = {};
  Object.keys(out).forEach((k) => { merged[k] = lit(out[k], k); });
  return plain(merged);
}
function mutate(fn) {
  const rows = csvRows().map((r) => r.slice());
  fn(rows, (name) => rows[0].indexOf(name));
  return rows;
}
const findRow = (rows, kind, id) => rows.find((r) => r[0] === kind && r[1] === id);

test('Runes 表已登錄在配置撥離管線，xlsx 不由 --gen 手拼（AI_RULES 8.5）', () => {
  assert.ok(schema, 'SCHEMAS.Runes 存在');
  assert.deepEqual(schema.vars, ['RUNE_SETTINGS', 'RUNES', 'RUNEWORDS']);
  assert.equal(schema.jsFile, 'runes');
  assert.equal(schema.noXlsxGen, true);
  const tool = fs.readFileSync(path.join(root, 'tools', 'config_tables.cjs'), 'utf8');
  assert.match(tool, /const TABLE_ORDER = \[[^\]]*'Runes'\]/);
  assert.match(tool, /runes: path\.join\(ROOT, 'js', 'runeword_data\.js'\)/);
});

test('CSV 與 js/runeword_data.js 一致（重建出的三個字面值與程式裡的語意相同）', () => {
  const rebuilt = rebuildFrom(csvRows());
  assert.deepEqual(rebuilt.RUNE_SETTINGS, plain(lit(dataSrc, 'RUNE_SETTINGS')));
  assert.deepEqual(rebuilt.RUNES, plain(lit(dataSrc, 'RUNES')));
  assert.deepEqual(rebuilt.RUNEWORDS, plain(lit(dataSrc, 'RUNEWORDS')));
});

test('由程式資料攤平成表格再重建，語意不變（往返無損）；表頭與列數合理', () => {
  const rows = [schema.header].concat(schema.extract(dataSrc));
  const rebuilt = rebuildFrom(rows);
  assert.deepEqual(rebuilt.RUNES, plain(lit(dataSrc, 'RUNES')));
  assert.deepEqual(rebuilt.RUNEWORDS, plain(lit(dataSrc, 'RUNEWORDS')));
  const kinds = {};
  rows.slice(1).forEach((r) => { kinds[r[0]] = (kinds[r[0]] || 0) + 1; });
  assert.equal(kinds['符文'], 33);
  assert.equal(kinds['符文真言'], lit(dataSrc, 'RUNEWORDS').length);
  assert.ok(kinds['設定'] >= 19, '設定列：孔數上限＋11 個稀有度＋合成／拆解／縮放／掉落');
  rows.forEach((r) => assert.equal(r.length, schema.header.length, '每列欄數與表頭一致'));
});

test('Excel 檔存在、第一頁內容與 CSV 完全一致，並有一頁欄位說明', () => {
  assert.ok(fs.existsSync(xlsxPath), 'config/Excel/Runes.xlsx 由 tools/excel-create-table.ps1（Excel COM）建立');
  const fromXlsx = cfg.readXlsxRows(xlsxPath);
  assert.deepEqual(fromXlsx.map((r) => r.slice(0, schema.header.length)), csvRows());
  assert.equal(schema.extraSheets[0].name, '欄位說明');
  assert.ok(schema.extraSheets[0].rows.length > 20);
});

test('建立 xlsx 的腳本走 Excel COM：不手拼 XML、不覆蓋既有檔、正常模式重開驗證兩次', () => {
  const buf = fs.readFileSync(path.join(root, 'tools', 'excel-create-table.ps1'));
  assert.deepEqual([buf[0], buf[1], buf[2]], [0xEF, 0xBB, 0xBF], '含中文的 .ps1 必須帶 BOM');
  const text = buf.toString('utf8');
  assert.match(text, /New-Object -ComObject Excel\.Application/);
  assert.match(text, /目標已存在，本腳本只建立新檔、不覆蓋/);
  assert.equal((text.match(/Verify \$book \$data/g) || []).length, 2, '重開逐格驗證兩次');
  assert.doesNotMatch(text, /sheet1\.xml|ZipFile|System\.IO\.Compression|\[Content_Types\]/, '不得手工拼 xlsx 封裝');
});

/* ---- 套用時的檢查：打錯一格要整次中止並指出位置 ---- */

test('設定檢查：孔數超過上限、隨稀有度變少、最高稀有度放不滿、拆解會賺、缺設定列都被擋下', () => {
  assert.throws(() => rebuildFrom(mutate((rows, c) => { findRow(rows, '設定', 'slots_legendary')[c('設定值')] = '5'; })), /符文孔數：傳說.*0~4/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { findRow(rows, '設定', 'slots_epic')[c('設定值')] = '4'; findRow(rows, '設定', 'slots_legendary')[c('設定值')] = '3'; })), /不可隨稀有度變少/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { findRow(rows, '設定', 'maxSlots')[c('設定值')] = '5'; })), /最高稀有度必須放得滿/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { findRow(rows, '設定', 'dismantleYield')[c('設定值')] = '3'; })), /拆解產出必須/);
  assert.throws(() => rebuildFrom(mutate((rows) => { rows.splice(rows.indexOf(findRow(rows, '設定', 'statScale')), 1); })), /缺少設定列「statScale」/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { findRow(rows, '設定', 'drop_tierSpread')[c('設定值')] = '1.2'; })), /小於 1/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { findRow(rows, '設定', 'composeCount')[c('設定值')] = 'abc'; })), /必須是數字/);
});

test('符文檢查：詞條不存在、倍率非正、列順序被改（階與 id 對不上）、名稱重複都被擋下', () => {
  assert.throws(() => rebuildFrom(mutate((rows, c) => { findRow(rows, '符文', 'r01')[c('武器詞條')] = 'noSuchAffix'; })), /詞條「noSuchAffix」不在詞條池/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { findRow(rows, '符文', 'r02')[c('防具倍率')] = '0'; })), /必須大於 0/);
  assert.throws(() => rebuildFrom(mutate((rows) => {
    const a = rows.indexOf(findRow(rows, '符文', 'r01')), b = a + 1;
    [rows[a], rows[b]] = [rows[b], rows[a]];
  })), /id 必須是「r01」/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { findRow(rows, '符文', 'r02')[c('名稱')] = findRow(rows, '符文', 'r01')[c('名稱')]; })), /名稱重複/);
});

test('符文真言檢查：配方（太長／太短／不是符文／重複）、裝備標記、屬性鍵、效果鍵、被動鍵、傳奇特效、事件觸發 JSON 都被擋下', () => {
  const word = (rows) => findRow(rows, '符文真言', 'rw_viperkiss');
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('配方')] = '微光;餘燼;霜痕;風語;巖心'; })), /5 顆符文，超過符文孔數上限 4/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('配方')] = '微光'; })), /至少要 2 顆/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('配方')] = '微光;不存在的符文'; })), /不是符文/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('配方')] = findRow(rows, '符文真言', 'rw_firstcry')[c('配方')]; })), /配方與別的符文真言完全相同/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('適用裝備')] = 'sword1h;pants'; })), /適用裝備「pants」/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('適用裝備')] = ''; })), /不可空白/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('屬性加成')] = 'noSuchAffix:1'; })), /鍵「noSuchAffix」不存在/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('屬性加成')] = 'atkPct=1'; })), /格式錯誤/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('靜態效果')] = 'dmgPtc:10'; })), /鍵「dmgPtc」不存在/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('被動')] = 'spikes:5'; })), /鍵「spikes」不存在/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('傳奇特效')] = 'noSuchLegend'; })), /傳奇特效「noSuchLegend」/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('事件觸發(JSON)')] = '[{"on":"hit",'; })), /JSON 解析失敗/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('事件觸發(JSON)')] = '[{"on":"sneeze","acts":[{"act":"heal","pctMax":5}]}]'; })), /不是已知觸發/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('事件觸發(JSON)')] = '[{"on":"hit","acts":[{"act":"explode"}]}]'; })), /不是已知動作/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('事件觸發(JSON)')] = '[{"on":"tick","acts":[{"act":"cleanse"}]}]'; })), /tick 必須有 every/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('階／級距')] = '7'; })), /級距.*1~4/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[c('名稱')] = findRow(rows, '符文真言', 'rw_firstcry')[c('名稱')]; })), /名稱重複/);
  assert.throws(() => rebuildFrom(mutate((rows, c) => { word(rows)[1] = 'viper'; })), /rw_ 開頭/);
  assert.throws(() => rebuildFrom(mutate((rows) => { word(rows)[0] = '亂填'; })), /類型.*只能是/);
});

test('設計表改了就會跟著遊戲走：改 CSV 的孔數／倍率／配方，重建出的字面值與引擎讀到的一致', () => {
  const rows = mutate((r, c) => {
    findRow(r, '設定', 'slots_rare')[c('設定值')] = '2';
    findRow(r, '符文', 'r10')[c('武器倍率')] = '1.5';
    findRow(r, '符文真言', 'rw_firstcry')[c('配方')] = '微光;巖心';
    const nu = word => word;
    const clone = findRow(r, '符文真言', 'rw_stoneskin').slice();
    clone[1] = 'rw_extra_test'; clone[2] = '測試新語'; clone[8] = '霜痕;霜痕;霜痕'; clone[13] = 'dmgPct:5';
    r.push(clone); nu(clone);
  });
  const out = rebuildFrom(rows);
  assert.equal(out.RUNE_SETTINGS.slotsByRarity[2], 2);
  assert.deepEqual(out.RUNES[9].w, ['atkPct', 1.5]);
  assert.deepEqual(out.RUNEWORDS.find((w) => w.id === 'rw_firstcry').runes, ['r01', 'r05']);
  const extra = out.RUNEWORDS.find((w) => w.id === 'rw_extra_test');
  assert.deepEqual(extra.runes, ['r03', 'r03', 'r03']);
  assert.deepEqual(extra.fx, { dmgPct: 5 });
  // 寫回的 JS 文字能被載入、並讓引擎讀到新數字
  const header = rows[0];
  const text = schema.rebuild(rows.slice(1), header);
  const ctx = { Math: Object.create(Math) };
  vm.createContext(ctx);
  vm.runInContext(dataSrc, ctx);
  vm.runInContext(text.RUNE_SETTINGS + '\n' + text.RUNES + '\n' + text.RUNEWORDS + '\nthis.__s = RUNE_SETTINGS; this.__w = RUNEWORDS.length;', ctx);
  assert.equal(ctx.__s.slotsByRarity[2], 2);
  assert.equal(ctx.__w, out.RUNEWORDS.length);
});

test('備註欄有能力中文名稱說明：符文列＝兩側屬性中文名，符文真言列＝屬性中文名與效果說明，不含英文鍵', () => {
  const rows = [schema.header].concat(schema.extract(dataSrc));
  const note = rows[0].indexOf('備註');
  const keys = Object.keys(lit(fs.readFileSync(path.join(root, 'js', 'data.js'), 'utf8'), 'AFFIX_POOL'));
  let runes = 0, words = 0;
  rows.slice(1).forEach((r) => {
    if (r[0] !== '符文' && r[0] !== '符文真言') return;
    assert.ok(r[note], `${r[1]} 沒有備註`);
    assert.doesNotMatch(r[note], /undefined|NaN/);
    keys.filter((k) => k.length > 4).forEach((k) => assert.ok(!r[note].includes(k), `${r[1]} 的備註出現英文鍵 ${k}`));
    if (r[0] === '符文') { runes++; assert.match(r[note], /^武器：.+×.+｜防具・飾品・副手：.+×/); }
    else { words++; assert.match(r[note], /[一-鿿]/); }
  });
  assert.equal(runes, 33);
  assert.equal(words, lit(dataSrc, 'RUNEWORDS').length);
  const r10 = rows.find((r) => r[1] === 'r10');
  assert.match(r10[note], /物理攻擊%?×0\.7|物理攻擊×0\.7/, '血誓：武器側物理攻擊 ×0.7');
  // 重新註解是冪等的，且依該列「目前」的數值產生（使用者改了倍率，備註跟著新數字）
  assert.deepEqual(cfg.annotateRuneRows(rows), rows);
  const edited = rows.map((r) => r.slice());
  edited.find((r) => r[1] === 'r01')[rows[0].indexOf('武器倍率')] = '2';
  assert.match(cfg.annotateRuneRows(edited).find((r) => r[1] === 'r01')[note], /命中率×2｜/);
});
