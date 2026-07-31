/* 野外裝備掉落表：js/data.js 的 FIELD_DROP_TABLE 必須與配置表逐格一致。

   ⚠️ 基準取自 config/CSV/game_parameters.csv，不是寫死在測試裡。
   先前這裡把層數（8 層）與邊界值（49→0、50→0.5）寫死，於是設計者在 Excel 調一次
   掉落率，測試就紅一次——而紅的原因跟品質無關，只是測試沒跟上。那會訓練出
   「這支測試紅了先改測試」的習慣，等到真的抓到 bug 時也不會有人相信它。

   對帳式寫法同時抓得更多：apply_params 少套一列、套錯欄位、區間合併算錯，
   都會在這裡現形，而且訊息直接指出是哪一個品質的哪一層。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadDataContext() {
  const context = { console, Math };
  vm.createContext(context);
  ['js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  });
  return context;
}

/* vm context 裡建立的陣列帶的是那個 realm 的 Array.prototype，
   直接丟給 deepStrictEqual 會因為原型不同而失敗——而且印出來的 actual/expected
   一模一樣，看起來像鬧鬼。一律先 JSON round-trip 搬回本 realm 再比。 */
function plain(v) { return JSON.parse(JSON.stringify(v)); }

/* 逗號分隔、支援雙引號包住的欄位。 */
function parseCsvLine(line) {
  const out = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/* 讀出「5-野外裝備掉落」那幾列，每列是一個品質，欄位形如 {40~49=1.5} 或 {300+=8}。
   回傳 [{ name, spans: [{lo, hi, rate}] }]，順序即品質索引 0..N。 */
function readDropSpansFromConfig() {
  const csv = fs.readFileSync(path.join(ROOT, 'config/CSV/game_parameters.csv'), 'utf8');
  const rows = csv.split(/\r?\n/).map(parseCsvLine).filter((r) => r.length > 1);
  const out = [];
  for (const cols of rows) {
    if (cols[2] !== '5-野外裝備掉落') continue;
    const spans = [];
    for (const cell of cols.slice(3)) {
      const m = /^\{(\d+)\s*(?:~\s*(\d+)|(\+))\s*=\s*([\d.]+)\}$/.exec(String(cell).trim());
      if (!m) continue;
      spans.push({ lo: Number(m[1]), hi: m[3] ? Infinity : Number(m[2]), rate: Number(m[4]) });
    }
    if (spans.length) out.push({ name: cols[3], spans });
  }
  return out;
}

test('野外裝備掉落表逐格對齊配置表', () => {
  const context = loadDataContext();
  const table = plain(context.FIELD_DROP_TABLE);
  const config = readDropSpansFromConfig();

  assert.ok(config.length >= 4,
    '在 config/CSV/game_parameters.csv 找不到「5-野外裝備掉落」的品質列——' +
    '配置表的分類名稱改了？改了就要一併更新本測試的取列條件');

  /* 分層門檻＝所有品質所有區間下緣的聯集（apply_params 就是這樣合併的），由高到低。 */
  const bounds = [...new Set(config.flatMap((q) => q.spans.map((s) => s.lo)))].sort((a, b) => b - a);
  assert.deepEqual(table.map((t) => t.min), bounds,
    '分層門檻應為各品質區間下緣的聯集（由高到低）');

  const rateAt = (spans, lv) => {
    const hit = spans.find((s) => lv >= s.lo && lv <= s.hi);
    return hit ? hit.rate : 0;
  };

  for (const tier of table) {
    assert.equal(tier.rates.length, config.length,
      `min=${tier.min} 的品質欄數（${tier.rates.length}）與配置表的品質列數（${config.length}）不符`);
    config.forEach((q, idx) => {
      assert.equal(tier.rates[idx], rateAt(q.spans, tier.min),
        `min=${tier.min} 的「${q.name}」機率為 ${tier.rates[idx]}，配置表是 ${rateAt(q.spans, tier.min)}`);
    });
    tier.rates.forEach((r) => assert.ok(r >= 0 && r <= 100, `min=${tier.min} 出現不合理機率：${r}`));
  }
});

test('dropRatesFor 在每個分層邊界的前後各取到正確的一層', () => {
  /* 邊界值同樣由配置表推出。守的是「查表取到相鄰層」這種差一錯誤——
     實際發生過裝備套裝等級門檻取代掉落率區間的回歸。 */
  const context = loadDataContext();
  const config = readDropSpansFromConfig();
  const bounds = [...new Set(config.flatMap((q) => q.spans.map((s) => s.lo)))].sort((a, b) => a - b);

  for (const b of bounds) {
    const at = plain(context.dropRatesFor(context.FIELD_DROP_TABLE, b));
    const expect = config.map((q) => {
      const hit = q.spans.find((s) => b >= s.lo && b <= s.hi);
      return hit ? hit.rate : 0;
    });
    assert.deepEqual(at, expect, `怪物 Lv${b}（分層下緣）查到的機率與配置表不符`);

    if (b > 1) {
      const below = plain(context.dropRatesFor(context.FIELD_DROP_TABLE, b - 1));
      const expectBelow = config.map((q) => {
        const hit = q.spans.find((s) => (b - 1) >= s.lo && (b - 1) <= s.hi);
        return hit ? hit.rate : 0;
      });
      assert.deepEqual(below, expectBelow, `怪物 Lv${b - 1}（分層下緣的前一級）不該提早切到上一層`);
    }
  }
});

test('掉落率隨怪物等級遞增（有例外時要在配置表裡是刻意的）', () => {
  /* 這條是設計慣例而不是硬性規則：越高等的怪不該掉得比低等的差。
     目前配置表刻意讓怪物 Lv40~49 的史詩掉落率（1.5%）高於 Lv50~99（1%），
     用意是讓玩家在挑戰 50 關 BOSS 前先湊到一部份史詩裝。
     這裡把例外具名列出——要新增例外必須寫進 KNOWN_INVERSIONS 並說明理由，
     才不會有人在調表時不小心把某個品質調反了卻沒人發現。 */
  const KNOWN_INVERSIONS = [
    { lower: 40, higher: 50, rarityIndex: 4, why: '刻意：40~49 關先湊史詩，為 50 關 BOSS 做準備' }
  ];
  const isKnown = (lo, hi, q) => KNOWN_INVERSIONS.some(
    (k) => k.lower === lo && k.higher === hi && k.rarityIndex === q);

  const table = plain(loadDataContext().FIELD_DROP_TABLE);   // 由高到低
  for (let i = 1; i < table.length; i++) {
    for (let q = 0; q < table[i].rates.length; q++) {
      if (table[i].rates[q] <= table[i - 1].rates[q]) continue;
      assert.ok(isKnown(table[i].min, table[i - 1].min, q),
        `Lv${table[i].min}+ 的第 ${q} 品質機率（${table[i].rates[q]}%）高於更高等級層 ` +
        `Lv${table[i - 1].min}+（${table[i - 1].rates[q]}%）。` +
        '若是刻意設計請加進 KNOWN_INVERSIONS 並寫明理由；否則就是配置表調反了');
    }
  }
});
