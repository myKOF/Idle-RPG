const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadFormulaContext() {
  const context = { console };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

/* ---- 參數表讀取 ----
   數值一律以 config/CSV/game_parameters.csv 為準：這兩支測試驗的是
   「程式裡的數值與配表一致」，不是把配表的數字再抄一份到測試裡。
   （抄一份的下場就是每次調平衡都誤報失敗——2026-07-28 的數值調整正是如此。）
   CSV 由 xlsx 轉出，說明欄含逗號與引號，所以要照 RFC4180 解析。 */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function paramTable() {
  const rows = parseCsv(fs.readFileSync(path.join(root, 'config/CSV/game_parameters.csv'), 'utf8'));
  const header = rows[0].map((h) => h.trim());
  const catAt = header.indexOf('系統分類');
  const nameAt = header.indexOf('名稱');
  const firstParamAt = header.indexOf('參數a');
  assert.ok(catAt >= 0 && nameAt >= 0 && firstParamAt >= 0, '參數表表頭缺少必要欄位');
  const index = new Map();
  const names = [];
  rows.slice(1).forEach((r) => {
    if (!r[nameAt]) return;
    if (r[catAt].trim() === '1-轉生對照表') names.push(r[nameAt].trim());
    index.set(r[catAt].trim() + '/' + r[nameAt].trim(), r.slice(firstParamAt).map((v) => (v || '').trim()));
  });
  index.reincarnationNames = names;
  const get = (cat, name, i) => {
    const params = index.get(cat + '/' + name);
    assert.ok(params, '參數表缺少列：' + cat + ' / ' + name);
    return params[i];
  };
  get.reincarnationNames = names;
  return get;
}

/* 轉生對照表的列名允許「轉生 N 次」「轉生 N次」等空白差異——實表裡就有一列少了空白
   （轉生 11次）。tools/apply_params.cjs 的 getReincarnationCell 同樣容忍，
   這裡比照辦理，免得一個空白讓整支測試變成假警報。 */
function reincarnationRowName(rows, n) {
  const found = rows.find((name) => {
    const m = /^轉生\s*(\d+)\s*次$/.exec(name);
    return m && Number(m[1]) === n;
  });
  assert.ok(found, '參數表缺少轉生 ' + n + ' 次那一列');
  return found;
}

// 轉生對照表的升級經驗倍率寫成 10^11 這種形式（與 tools/apply_params.cjs 同解析規則）
function parsePowerNotation(raw) {
  const m = /^(\d+(?:\.\d+)?)\^(\d+)$/.exec(String(raw).trim());
  return m ? Math.pow(Number(m[1]), Number(m[2])) : Number(raw);
}

test('升級所需經驗與參數表「1-成長經驗/升級所需經驗」一致', () => {
  const context = loadFormulaContext();
  const P = paramTable();
  const a = Number(P('1-成長經驗', '升級所需經驗', 0));
  const b = Number(P('1-成長經驗', '升級所需經驗', 1));
  const c = Number(P('1-成長經驗', '升級所需經驗', 2));
  assert.ok(isFinite(a) && isFinite(b) && isFinite(c), '參數表的 a/b/c 不是數字');

  // xpForLevel(l) = ⌊(a×l^b + c) × 轉生經驗倍率 + 升級經驗基礎增加值⌋；未轉生時倍率 1、增加值 0
  [1, 2, 10, 50, 100, 500].forEach((lv) => {
    assert.equal(context.xpForLevel(lv), Math.floor(a * Math.pow(lv, b) + c), 'Lv' + lv + ' 升級經驗與參數表不符');
  });
  // 曲線本身的語意：嚴格遞增
  for (let lv = 1; lv < 30; lv++) {
    assert.ok(context.xpForLevel(lv + 1) > context.xpForLevel(lv), '升級經驗必須隨等級遞增');
  }
});

test('轉生設定與參數表「1-轉生對照表」一致（支援 20 轉）', () => {
  const context = loadFormulaContext();
  const P = paramTable();

  assert.equal(context.REINCARNATION_MAX, 20);
  assert.equal(context.REINCARNATION_RANKS.length, 21);
  assert.equal(context.reincarnationTotalMultiplier(0), 1);
  assert.equal(context.reincarnationExpMultiplier(0), 1);

  for (let n = 1; n <= 20; n++) {
    const row = reincarnationRowName(P.reincarnationNames, n);
    // a=生命與四維最終倍率、b=升級經驗倍率、d=階級名稱
    assert.equal(context.reincarnationTotalMultiplier(n), Number(P('1-轉生對照表', row, 0)),
      row + ' 的生命四維倍率與參數表不符');
    /* 經驗倍率大到 1e33，Math.pow(10,23) 與程式裡的字面值 1e23 會差 1 ULP，
       所以用相對誤差比較，不比位元。 */
    const expMul = parsePowerNotation(P('1-轉生對照表', row, 1));
    const gotExpMul = context.reincarnationExpMultiplier(n);
    assert.ok(Math.abs(gotExpMul - expMul) <= Math.abs(expMul) * 1e-12,
      row + ' 的升級經驗倍率與參數表不符：' + gotExpMul + ' vs ' + expMul);
    assert.equal(context.reincarnationRankName(n), P('1-轉生對照表', row, 3),
      row + ' 的階級名稱與參數表不符');
  }
  assert.equal(context.reincarnationRankName(0), '冒險者');
});
