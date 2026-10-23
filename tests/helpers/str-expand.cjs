'use strict';
/* 原始碼比對型測試的輔助：把 STR(編號, 參數…) 展開回遷移前的字串串接，data-str 展開回元素文字，
   讓「檢查程式裡有沒有某段中文／某個串接結構」的舊測試在遷移到 String 表之後仍然有效。
   展開的是繁體中文（預設語言）；只用於讀取原始碼做比對，不影響被測程式本身。 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
let DATA = null;
function data() {
  if (DATA) return DATA;
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'strings_data.js'), 'utf8'), ctx);
  DATA = vm.runInContext('STRING_DATA', ctx);
  return DATA;
}

const q = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";

/* 切出 STR( 之後的引數字串（頂層逗號分隔），回傳 { args, end } */
function parseArgs(src, open) {
  const args = [];
  let depth = 0, cur = '', i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      cur += src.slice(i, j + 1); i = j; continue;
    }
    if (c === '(' || c === '[' || c === '{') { depth++; cur += c; continue; }
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) { args.push(cur.trim()); return { args, end: i + 1 }; }
      depth--; cur += c; continue;
    }
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  return null;
}

function expandStrSource(src) {
  const table = data();
  let out = '', cur = 0;
  const re = /(^|[^\w$.])STR\(/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[1].length;
    const parsed = parseArgs(src, start + 4);
    if (!parsed || !/^\d+$/.test(parsed.args[0])) continue;
    const row = table[parsed.args[0]];
    if (!row) continue;
    const params = parsed.args.slice(1).map((a) => expandStrSource(a));
    const text = row[0];
    const pieces = [];
    let last = 0;
    text.replace(/\{(\d+)\}/g, (all, n, idx) => {
      if (idx > last) pieces.push(q(text.slice(last, idx)));
      pieces.push(params[+n] === undefined ? q(all) : params[+n]);
      last = idx + all.length;
      return all;
    });
    if (last < text.length) pieces.push(q(text.slice(last)));
    if (!pieces.length) pieces.push("''");
    // 以字串開頭，避免第一個參數是數字時變成數字相加
    if (!/^'/.test(pieces[0])) pieces.unshift("''");
    out += src.slice(cur, start) + pieces.join(' + ');
    cur = parsed.end;
    re.lastIndex = parsed.end;
  }
  return out + src.slice(cur);
}

const attrEsc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
/* index.html：data-str／data-str-html 填回元素內容，data-str-attr 展開成屬性 */
function expandStrHtml(html) {
  const table = data();
  html = html.replace(/<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)\sdata-str(-html)?="(\d+)"((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/\1>/g,
    (all, tag, pre, isHtml, id, post, inner) => {
      const row = table[id];
      if (!row) return all;
      const text = isHtml ? row[0] : row[0].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return '<' + tag + pre + post + '>' + text + '</' + tag + '>';
    });
  return html.replace(/\sdata-str-attr="([^"]*)"/g, (all, list) => list.split(';').map((p) => {
    const cut = p.lastIndexOf(':');
    const row = table[p.slice(cut + 1).trim()];
    return row ? ' ' + p.slice(0, cut).trim() + '="' + attrEsc(row[0]) + '"' : '';
  }).join(''));
}

/* 讀取原始碼並展開；.html 走 HTML 規則，其餘走 JS 規則 */
function readExpanded(file, encoding) {
  const src = fs.readFileSync(file, encoding || 'utf8');
  return /\.html?$/i.test(file) ? expandStrHtml(src) : expandStrSource(src);
}

module.exports = { expandStrSource, expandStrHtml, readExpanded };
