'use strict';
/* =============================================================================
   apply_strings.cjs — 把 config/CSV/String.csv 轉成遊戲讀取用的 js/strings_data.js
   -----------------------------------------------------------------------------
   資料流：config/Excel/String.xlsx →（套用參數.bat／xlsx_to_csv）→ config/CSV/String.csv
           →（本工具）→ js/strings_data.js →（js/strings.js 的 STR()）→ 畫面
   輸出是純資料（var STRING_DATA_VERSION／var STRING_DATA），主執行緒 <script>、
   Worker importScripts、Node vm 測試都能直接載入。

   用法：
     node tools/string-table/apply_strings.cjs            # 轉換並寫檔，同步 index.html 的 ?v=
     node tools/string-table/apply_strings.cjs --check    # 只檢查，不寫檔（資料檔過期或表格有誤時以非 0 結束）

   檢查（有任何錯誤就不寫檔、不動遊戲）：
     - 編號必須是正整數且不得重複
     - 繁體中文欄不得為空（程式以它為預設語言與退路）
     - 簡體／英文若有填，{N}、{名稱} 替代字符必須與繁體中文完全相同（缺少或多出都會讓畫面出錯）
   \n 在表格裡是兩個字元（反斜線＋n），輸出時還原為真正的換行，與原本程式碼的字串一致。
   ============================================================================= */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const CSV = process.env.STRING_CSV || path.join(ROOT, 'config', 'CSV', 'String.csv');
const OUT = process.env.STRING_JS_OUT || path.join(ROOT, 'js', 'strings_data.js');
const INDEX_HTML = process.env.STRING_INDEX_HTML || path.join(ROOT, 'index.html');
const CHECK_ONLY = process.argv.includes('--check');
const COLS = { id: '編號', module: '功能模塊', zhTW: '繁體中文', zhCN: '簡體中文', en: '英文' };

function csvParse(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

function placeholders(s) {
  return [...new Set([...s.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(m => m[1]))].sort().join(',');
}
const unescapeNl = s => s.replace(/\\n/g, '\n');

function build() {
  if (!fs.existsSync(CSV)) throw new Error('找不到 ' + CSV);
  const rows = csvParse(fs.readFileSync(CSV, 'utf8')).filter(r => r.some(c => c !== ''));
  const head = rows[0];
  const col = {};
  for (const k of Object.keys(COLS)) col[k] = head.indexOf(COLS[k]);
  for (const k of ['id', 'zhTW', 'zhCN', 'en']) if (col[k] < 0) throw new Error('String.csv 缺少欄位「' + COLS[k] + '」');
  const errors = [], data = {}, order = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const id = String(r[col.id] || '').trim();
    if (!/^[1-9]\d*$/.test(id)) { errors.push(`第 ${line} 列：編號「${id}」不是正整數`); return; }
    if (data[id]) { errors.push(`第 ${line} 列：編號 ${id} 重複`); return; }
    const tw = r[col.zhTW] || '', cn = r[col.zhCN] || '', en = r[col.en] || '';
    if (!tw) { errors.push(`第 ${line} 列（編號 ${id}）：繁體中文是空的`); return; }
    const base = placeholders(tw);
    if (cn && placeholders(cn) !== base) errors.push(`第 ${line} 列（編號 ${id}）：簡體中文的替代字符 {${placeholders(cn)}} 與繁體中文 {${base}} 不一致`);
    if (en && placeholders(en) !== base) errors.push(`第 ${line} 列（編號 ${id}）：英文的替代字符 {${placeholders(en)}} 與繁體中文 {${base}} 不一致`);
    const vals = [unescapeNl(tw), unescapeNl(cn), unescapeNl(en)];
    while (vals.length > 1 && vals[vals.length - 1] === '') vals.pop();
    data[id] = vals; order.push(id);
  });
  if (errors.length) return { errors };
  order.sort((a, b) => a - b);
  const body = order.map(id => '  ' + JSON.stringify(id) + ': ' + JSON.stringify(data[id])).join(',\n');
  const hash = crypto.createHash('sha1').update(body).digest('hex').slice(0, 8);
  const js = "'use strict';\n" +
    '/* 自動產生，請勿手改。來源：config/Excel/String.xlsx（Excel 是唯一來源）。\n' +
    '   重新產生：node tools/string-table/apply_strings.cjs（套用參數.bat 會自動執行）。\n' +
    '   每列＝[繁體中文, 簡體中文, 英文]；後面的空欄已省略。讀取請用 js/strings.js 的 STR()。 */\n' +
    "var STRING_DATA_VERSION = '" + hash + "';\n" +
    'var STRING_DATA = {\n' + body + '\n};\n';
  return { js, hash, count: order.length };
}

function syncIndexVersion(hash) {
  if (!fs.existsSync(INDEX_HTML)) return false;
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const re = /(js\/strings_data\.js\?v=)[^"']*/;
  if (!re.test(html)) return false;
  const next = html.replace(re, '$1' + hash);
  if (next === html) return false;
  fs.writeFileSync(INDEX_HTML, next);
  return true;
}

function main() {
  let r;
  try { r = build(); } catch (e) { console.error('[strings] ' + e.message); process.exit(1); }
  if (r.errors) {
    console.error('[strings] String 表有 ' + r.errors.length + ' 個問題，未產生資料檔：');
    r.errors.slice(0, 30).forEach(m => console.error('  - ' + m));
    process.exit(1);
  }
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  const same = cur.replace(/\r\n/g, '\n') === r.js;
  if (CHECK_ONLY) {
    if (!same) { console.error('[strings] js/strings_data.js 與 String.csv 不同步，請執行：node tools/string-table/apply_strings.cjs'); process.exit(2); }
    console.log('[strings] 同步（' + r.count + ' 條，版本 ' + r.hash + '）');
    return;
  }
  if (!same) fs.writeFileSync(OUT, r.js);
  const bumped = syncIndexVersion(r.hash);
  console.log('[strings] ' + r.count + ' 條 → ' + path.relative(ROOT, OUT) + '（版本 ' + r.hash + (same ? '，內容未變' : '，已更新') + (bumped ? '，index.html 的 ?v= 已同步' : '') + '）');
}

if (require.main === module) main();
module.exports = { build, csvParse, placeholders };
