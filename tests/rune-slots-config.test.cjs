const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { loadRuneEnv, makeItem } = require('./helpers/runeword-env.cjs');

const root = path.resolve(__dirname, '..');
const cfg = require(path.join(root, 'tools', 'config_tables.cjs'));
const gpPath = path.join(root, 'config', 'CSV', 'game_parameters.csv');

/* 裝備的符文孔數（2026-10-07）：每個稀有度有幾個符文孔，由 game_parameters「表-稀有度」各列（編號 321～331）的「參數g」配置，
   apply_params 寫回 js/data.js 的 RARITIES[i].runeSlots；雙手武器在有孔的稀有度上再加 RUNE_SETTINGS.twoHandBonusSlots（加法，不是倍數）。 */

function gpRarityRows() {
  const rows = cfg.csvParse(fs.readFileSync(gpPath, 'utf8')).filter((r) => r.length > 1);
  const head = rows[0];
  const cId = head.indexOf('編號'), cCat = head.indexOf('系統分類'), cName = head.indexOf('名稱'), cG = head.indexOf('參數g'), cF = head.indexOf('中文說明');
  return { rows, head, list: rows.filter((r) => r[cCat] === '表-稀有度').map((r) => ({ id: Number(r[cId]), name: r[cName], g: r[cG], desc: r[cF] })) };
}

test('game_parameters 編號 321～331 的參數g ＝ RARITIES.runeSlots：11 個稀有度各一格、與程式一致、說明欄有寫 g', () => {
  const { list } = gpRarityRows();
  const rarities = cfg.evalLiteral(cfg.extractLiteral(fs.readFileSync(path.join(root, 'js', 'data.js'), 'utf8'), 'RARITIES').literal);
  assert.equal(list.length, 11);
  assert.deepEqual(list.map((r) => r.id), [321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331]);
  list.forEach((r, i) => {
    assert.equal(r.name, rarities[i].name, '列順序與稀有度順序一致');
    assert.equal(Number(r.g), rarities[i].runeSlots, `${r.name} 的符文孔數：配置表與程式一致`);
    assert.match(r.desc, /g=符文孔數/, `${r.name} 的說明欄要寫明參數g是符文孔數`);
  });
});

test('改配置表一格（某稀有度的參數g），apply_params 會把它寫進 RARITIES.runeSlots（錨點接得上）', () => {
  const { rows, head, list } = gpRarityRows();
  const cG = head.indexOf('參數g'), cCat = head.indexOf('系統分類'), cName = head.indexOf('名稱');
  const target = list.find((r) => r.name === '神鑄混沌');
  const now = Number(target.g), next = now > 0 ? now - 1 : 1;
  rows.forEach((r) => { if (r[cCat] === '表-稀有度' && r[cName] === '神鑄混沌') r[cG] = String(next); });
  const tmp = path.join(os.tmpdir(), 'gp-apply-rune-slots-' + process.pid + '-' + Date.now() + '.csv');
  fs.writeFileSync(tmp, cfg.csvStringify(rows), 'utf8');
  try {
    const res = spawnSync(process.execPath, ['tools/apply_params.cjs'], { cwd: root, encoding: 'utf8', env: Object.assign({}, process.env, { PARAMS_CSV: tmp }) });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp('神鑄混沌\\.runeSlots：' + now + ' → ' + next), '試跑要列出這一格的變更');
    assert.match(res.stdout, /錨點問題 0/);
  } finally { fs.rmSync(tmp, { force: true }); }
});

const run = (e, code) => vm.runInContext(code, e);

test('符文孔數讀稀有度表：改 RARITIES.runeSlots，一般裝備的孔數、鑲嵌容量與真言最低稀有度跟著走', () => {
  const e = loadRuneEnv();
  e.RARITIES.forEach((r, i) => assert.equal(e.runeSlotCountFor(makeItem(e, { rarity: i, slot: 'chest', weaponType: undefined })), Math.min(r.runeSlots, e.RUNE_SETTINGS.maxSlots)));
  run(e, 'RARITIES[3].runeSlots = 3;');
  const unique = makeItem(e, { rarity: 3, slot: 'chest', weaponType: undefined });
  assert.equal(e.runeSlotCountFor(unique), 3);
  e.addRune('r01', 5);
  for (let k = 0; k < 3; k++) assert.equal(e.socketRune(unique, 'r01'), null);
  assert.match(e.socketRune(unique, 'r01'), /已滿/);
  const three = e.RUNEWORDS.find((w) => w.runes.length === 3 && !e.rwWordTwoHandOnly(w));
  assert.ok(three, '資料裡有 3 顆符文、不限雙手的真言');
  assert.ok(e.rwMinRarity(three) <= 3, '獨特有 3 孔後，3 顆符文的真言最低稀有度不晚於獨特');
  run(e, 'RARITIES.forEach(function (r) { r.runeSlots = 0; });');
  assert.equal(e.runeSlotCountFor(unique), 0);
  assert.equal(e.rwMinRarity(three), -1);
  assert.equal(e.rwRegularMaxSlots(), 0);
});

test('雙手武器的符文孔＝同稀有度一般裝備 + twoHandBonusSlots（加法，不是加倍）；沒有孔的稀有度不加；不超過上限', () => {
  const e = loadRuneEnv();
  assert.equal(e.RUNE_SETTINGS.twoHandBonusSlots, 1, '雙手武器多 1 孔');
  const slotsOf = (rarity, weaponType) => e.runeSlotCountFor(makeItem(e, { rarity, weaponType }));
  e.RARITIES.forEach((r, i) => {
    const one = slotsOf(i, 'sword1h'), two = slotsOf(i, 'axe2h');
    assert.equal(one, Math.min(r.runeSlots, e.RUNE_SETTINGS.maxSlots), r.name + ' 單手');
    assert.equal(two, r.runeSlots > 0 ? Math.min(r.runeSlots + 1, e.RUNE_SETTINGS.maxSlots) : 0, r.name + ' 雙手');
  });
  assert.equal(slotsOf(0, 'axe2h'), 0, '普通（0 孔）的雙手武器也沒有符文孔');
  run(e, 'RARITIES[3].runeSlots = 3;');
  assert.equal(slotsOf(3, 'sword1h'), 3);
  assert.equal(slotsOf(3, 'axe2h'), 4, '3 孔 → 雙手 4 孔（不是 6）');
  run(e, 'RUNE_SETTINGS.twoHandBonusSlots = 4;');
  assert.equal(slotsOf(3, 'axe2h'), e.RUNE_SETTINGS.maxSlots, '加成再大也不超過符文孔數上限');
  run(e, 'RUNE_SETTINGS.twoHandBonusSlots = 0;');
  assert.equal(slotsOf(3, 'axe2h'), 3, '加成 0＝與一般裝備一樣');
});

test('裝備上已鑲的符文不會因為孔數設定調低而消失：仍列出、可抹除', () => {
  const e = loadRuneEnv();
  const it = makeItem(e, { rarity: 5, slot: 'chest', weaponType: undefined });
  it.runes = ['r01', 'r02', 'r03', 'r04'];
  run(e, 'RARITIES[5].runeSlots = 2;');
  assert.equal(e.runeSlotCountFor(it), 2);
  assert.equal(e.rwSlots(it).length, 4, '已鑲在後面孔位的符文仍會列出');
  e.G.player.scrap = 1e9; e.G.player.essence = 1e9;
  assert.equal(e.eraseRune(it, 3), null);
});
