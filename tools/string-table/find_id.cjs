'use strict';
/* find_id.cjs — 在 String 表查編號：node tools/string-table/find_id.cjs 關鍵字 [關鍵字…]
   關鍵字可以是文字片段、編號，或「模塊:戰鬥」只列某功能模塊。 */
const fs = require('fs');
const path = require('path');
const { csvParse } = require('./apply_strings.cjs');
const rows = csvParse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'CSV', 'String.csv'), 'utf8'));
const head = rows[0];
const ci = n => head.indexOf(n);
const terms = process.argv.slice(2);
if (!terms.length) { console.error('用法：node tools/string-table/find_id.cjs 關鍵字 [模塊:名稱]'); process.exit(1); }
for (const r of rows.slice(1)) {
  const ok = terms.every(t => t.startsWith('模塊:') ? r[ci('功能模塊')] === t.slice(3) : (r[ci('編號')] === t || r[ci('繁體中文')].includes(t)));
  if (ok) console.log(r[ci('編號')] + '\t' + r[ci('功能模塊')] + '\t' + r[ci('繁體中文')].slice(0, 100) + (r[ci('替代字符參數說明')] ? '\t[' + r[ci('替代字符參數說明')].slice(0, 80) + ']' : ''));
}
