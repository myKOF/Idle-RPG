'use strict';
/* =============================================================================
   build_string_csv.cjs — 掃描 js/*.js 與 index.html，產生 config/CSV/String.csv（字串表）
   -----------------------------------------------------------------------------
   範圍：寫死在程式與 HTML 裡、不在任何配置表（config/CSV 其他表）的玩家可見文字。
   做法：chain.cjs 把 `'第 ' + n + ' 階'` 這類 + 串接合併成一條 `第 {0} 階`，
        非字面值部分以 {N} 代替，原運算式寫進「替代字符參數說明」。
   排除：GM／錄製／延遲探針／VFX 驗證／效能診斷等內部工具；console／Error／比對用字面值；
        資料型檔案(data.js 等)中與配置表儲存格完全相同的字串（已在表內）。
   用法：node tools/string-table/build_string_csv.cjs [輸出路徑]
   注意：本工具重新產生整份 CSV，會洗掉人工填的簡體／英文；日後翻譯請以 Excel 為準。
   ============================================================================= */
const fs = require('fs'), path = require('path');
const { extract } = require('./chain.cjs');
const root = path.resolve(__dirname, '..', '..');
const rows = [];
{
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); } else if (e.name.endsWith('.js')) files.push(p); } })(path.join(root, 'js'));
  for (const f of files.sort()) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    for (const m of extract(fs.readFileSync(f, 'utf8'))) rows.push({ file: rel, ...m });
  }
}
const IDEO = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

/* ---------- 配置表儲存格（資料型檔案中與表重複的字串不收） ---------- */
function parseCsv(t) {
  const out = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f.replace(/\r$/, '')); out.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); out.push(row); }
  return out;
}
const cells = new Set();
for (const fn of fs.readdirSync(path.join(root, 'config/CSV'))) {
  if (!fn.endsWith('.csv') || fn === 'String.csv') continue;
  for (const r of parseCsv(fs.readFileSync(path.join(root, 'config/CSV', fn), 'utf8').replace(/^\uFEFF/, ''))) for (const c of r) if (c) cells.add(c);
}
const DATA_FILES = /^js\/(data|skills2|status|runeword_data|elite_data|gem_resonance_data|elite_boss_recipes)\.js$/;

/* ---------- 排除範圍 ---------- */
const EXCLUDE_FILE = /^js\/(gm_exec|gm|lagprobe|recorder|vfx-core|vfx-runtime|vfx-pixi-backend|vfx-tower|battle-perf|ai-key-setting|worker\/shim)\.js$/;
const EXCLUDE_FN = /Diag|diag|Perf|perf|Lag|lag|^skills2CleaveRangeScale$|^gm[A-Z]|GM|^validate/;
const dropCallee = /^(console\.\w+|Error|errors\.push|String|\w*\.?(includes|indexOf|startsWith|endsWith|test|match|replace|split))$/;
const ex = { file: 0, fn: 0, callee: 0, cmp: 0, csv: 0, noText: 0, regex: 0 };
const kept = [];
for (const r of rows) {
  if (EXCLUDE_FILE.test(r.file)) { ex.file++; continue; }
  if (EXCLUDE_FN.test(r.fn)) { ex.fn++; continue; }
  if (dropCallee.test(r.callee) || /(^|\.)(includes|indexOf|startsWith|endsWith|test|match)$/.test(r.callee)) { ex.callee++; continue; }
  if (['===', '==', '!==', '!='].includes(r.prev)) { ex.cmp++; continue; }
  if (/^\^|\(\?:/.test(r.text)) { ex.regex++; continue; }
  if (DATA_FILES.test(r.file) && cells.has(r.text)) { ex.csv++; continue; }
  kept.push(r);
}

/* ---------- 內嵌標記處理 ---------- */
const INLINE_OK = /^(b|i|u|em|strong|small|code|br|sub|sup)$/i;
function parseMarkup(s) {
  const parts = []; const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+|<)/g; let m;
  while ((m = re.exec(s))) {
    if (m[5] !== undefined) parts.push({ text: m[5] });
    else parts.push({ tag: m[2].toLowerCase(), close: !!m[1], attrs: m[3] || '', raw: m[0] });
  }
  return parts;
}
function simpleInline(parts) {
  for (const p of parts) {
    if (!p.tag) continue;
    if (INLINE_OK.test(p.tag)) { if (p.attrs.trim() && !/^\s*$/.test(p.attrs)) return false; continue; }
    if (p.tag === 'span') {
      if (p.close) continue;
      const a = p.attrs.trim();
      if (/^style="color:\s*[^";]+;?"$/.test(a) || /^class="[\w\- ]+"$/.test(a)) continue;
      return false;
    }
    return false;
  }
  return true;
}
const ATTR_TEXT = /\s?(?:data-tip|data-tt-title|data-tt-desc|data-tt-[\w-]+|title|aria-label|alt|placeholder|label)="([^"]*)"/g;
const decodeEnt = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
function keepTag(p) {
  if (INLINE_OK.test(p.tag)) return !p.attrs.trim();
  if (p.tag === 'span') {
    if (p.close) return true;
    const a = p.attrs.trim();
    return /^style="color:\s*[^";]+;?"$/.test(a) || /^class="[\w\- ]+"$/.test(a);
  }
  return false;
}
// 去掉沒有配對的標籤（片段式拼接常讓開頭／結尾標籤落單）
function balance(s) {
  const parts = parseMarkup(s); const stack = []; const drop = new Set();
  parts.forEach((p, i) => {
    if (!p.tag || p.tag === 'br') return;
    if (!p.close) stack.push(i);
    else {
      let k = stack.length - 1;
      while (k >= 0 && parts[stack[k]].tag !== p.tag) k--;
      if (k < 0) drop.add(i); else { for (let q = stack.length - 1; q > k; q--) drop.add(stack[q]); stack.length = k; }
    }
  });
  for (const i of stack) drop.add(i);
  return parts.map((p, i) => drop.has(i) ? '' : (p.tag ? p.raw : p.text)).join('');
}
function splitMarkup(text, fromHtmlAttr) {
  const out = [];
  if (fromHtmlAttr) text = decodeEnt(text);
  // A. 屬性值（tooltip／title…）獨立成條
  let rest = text.replace(ATTR_TEXT, (m, v) => { if (IDEO.test(v)) out.push(...splitMarkup(v, true)); return ' '; });
  if (rest !== text) rest = rest.replace(/^[^<>\u3400-\u9fff]*>/, '');
  // B. 其餘文字節點；結構性標籤當斷點，格式標籤（br／b／變色 span）保留
  let buf = '';
  const flush = () => { const t = balance(buf).replace(/\s+/g, ' ').replace(/\s+>/g, '>').trim(); if (t && IDEO.test(t.replace(/<[^>]*>/g, ''))) out.push(t); buf = ''; };
  for (const p of parseMarkup(rest)) {
    if (!p.tag) { buf += p.text; continue; }
    if (keepTag(p)) buf += p.raw; else flush();
  }
  flush();
  return out;
}

/* ---------- 類別／用途 ---------- */
const CAT = [
  [/^index\.html$/, '主界面'],
  [/^js\/(ui|ui-gem-resonance|ui-gem-workshop|ui-runeword|ui-newforge-visuals|game-menu|tablock|save_origin|main)\.js$/, '界面'],
  [/^js\/(data|item|factory|forge|newforge|legendary|stats|talents|tasks|player)\.js$/, '裝備與成長'],
  [/^js\/(runeword|runeword_data|gem_resonance|gem_resonance_data)\.js$/, '符文與寶石'],
  [/^js\/(skills2|skills|status)\.js$/, '技能與狀態'],
  [/^js\/(combat|elite|elite_boss|elite_boss_recipes|tower|battle-arena|battle-renderer|battlefield|battle-decor|special_rules|formula)\.js$/, '戰鬥'],
  [/^js\/(save|bridge|storage|param_autoreload|worker\/sim\.worker|decor-nature)\.js$/, '系統與存檔'],
];
const catOf = f => { for (const [re, n] of CAT) if (re.test(f)) return n; return '其他'; };
const CAT_ORDER = ['主界面', '界面', '裝備與成長', '符文與寶石', '技能與狀態', '戰鬥', '系統與存檔', '其他'];

function kindOf(r, text) {
  const c = r.callee || '';
  if (/^(blog|flog|forgeLog|nflog)$/.test(c)) return '日誌';
  if (/^(floatPlayerEvent|floatEnemyEvent|showFloatingText)$/.test(c)) return '飄字';
  if (/showConfirmDialog/.test(c) || r.key === 'title') return '對話框';
  if (/reportUiCommandFailure/.test(c)) return '指令失敗提示';
  if (/setOverlay/.test(c)) return '覆蓋層訊息';
  if (/setAttribute|setAttrIfChanged/.test(c) || /^(tip|desc|tooltip|data-tip)$/.test(r.key)) return '提示';
  if (/^(name|short|label)$/.test(r.key)) return '名稱';
  if (/^(desc|flavor|ult|tiers|note|hint)$/.test(r.key)) return '說明';
  if (/status|Status/.test(c)) return '狀態列';
  if (/</.test(text)) return '界面文字(含標記)';
  return '文字';
}

/* ---------- 替代字符說明 ---------- */
const GLOSS = [
  [/^fmtFull\(/, '數字(完整)'], [/^fmt1\(/, '數字(1位小數)'], [/^fmt\(/, '數字(縮寫)'], [/^esc\(/, '文字(已轉義)'],
  [/\.name\b/, '名稱'], [/\.length\b/, '數量'], [/stage|Stage/, '關卡'], [/level|Level|lv\b/i, '等級'], [/pct|Pct/, '百分比'], [/sec|Sec/, '秒數'],
];
function gloss(expr) { for (const [re, g] of GLOSS) if (re.test(expr)) return g; return ''; }
function describeRepl(text, params) {
  const out = [];
  const used = [...text.matchAll(/\{(\d+)\}/g)].map(m => +m[1]);
  for (const i of [...new Set(used)].sort((a, b) => a - b)) {
    const ex = (params[i] || '').replace(/\s+/g, ' ');
    const g = gloss(ex);
    out.push(`{${i}}=代入參數：${ex.length > 70 ? ex.slice(0, 70) + '…' : ex}${g ? '（' + g + '）' : ''}`);
  }
  const named = [...new Set([...text.matchAll(/\{([A-Za-z_]\w*)\}/g)].map(m => m[1]))];
  if (named.length) out.push(named.map(n => `{${n}}`).join('、') + '=具名參數（程式依配置表數值代入）');
  if (/\\n|\n/.test(text)) out.push('\\n=換行');
  if (/<br\s*\/?>/i.test(text)) out.push('<br>=換行');
  for (const m of text.matchAll(/<span style="color:\s*([^";]+);?">/g)) out.push(`<span style="color:${m[1].trim()}">…</span>=變色(${m[1].trim()})`);
  for (const m of text.matchAll(/<span class="([\w\- ]+)">/g)) out.push(`<span class="${m[1]}">…</span>=套用樣式 ${m[1]}`);
  if (/<b>/i.test(text)) out.push('<b>…</b>=粗體');
  if (/<(i|em)>/i.test(text)) out.push('<i>…</i>=斜體');
  if (/<code>/i.test(text)) out.push('<code>…</code>=等寬字');
  if (/<small>/i.test(text)) out.push('<small>…</small>=小字');
  return [...new Set(out)].join('；');
}

function renumber(text, params) {
  const used = [...new Set([...text.matchAll(/\{(\d+)\}/g)].map(m => +m[1]))].sort((a, b) => a - b);
  const map = new Map(used.map((o, n) => [o, n]));
  return { text: text.replace(/\{(\d+)\}/g, (m, d) => '{' + map.get(+d) + '}'), params: used.map(o => params[o] || '') };
}

/* ---------- 組成條目 ---------- */
const entries = new Map(); // text -> entry
function add(text, params, cat, where, kind) {
  const vis = text.replace(/\{\w+\}/g, '').replace(/<[^>]*>/g, '');
  if (!IDEO.test(vis)) return;
  const ren = renumber(text, params);
  const key = ren.text;
  let e = entries.get(key);
  if (!e) { e = { text: ren.text, params: ren.params, cat, kinds: new Set(), where: [] }; entries.set(key, e); }
  e.kinds.add(kind);
  if (!e.where.includes(where)) e.where.push(where);
}
for (const r of kept) {
  const text = r.text.replace(/\u00a0/g, ' ');
  const pieces = splitMarkup(text);
  const cat = catOf(r.file);
  const ctxName = /^[A-Z][A-Z0-9_]+$/.test(r.top || '') ? r.top : r.fn;
  const where = `${path.basename(r.file)}:${r.line}${ctxName ? ' ' + ctxName : ''}`;
  for (const p of pieces) {
    // 拆開後的片段若引用了 {n}，參數表沿用原本
    add(p, r.params, cat, where, kindOf(r, p));
  }
}

/* ---------- index.html ---------- */
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ''))
    .replace(/<script[\s\S]*?<\/script>/gi, m => m.replace(/[^\n]/g, ''))
    .replace(/<style[\s\S]*?<\/style>/gi, m => m.replace(/[^\n]/g, ''))
    .replace(/<svg[\s\S]*?<\/svg>/gi, m => m.replace(/[^\n]/g, ''));
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)/g;
  let m; let line = 1; let buf = ''; let bufLine = 1; let bufTag = '';
  const flush = () => {
    const t = buf.replace(/\s+/g, ' ').trim();
    if (t && IDEO.test(t)) for (const x of splitMarkup(t, true)) add(x, [], '主界面', `index.html:${bufLine}`, '界面文字');
    buf = '';
  };
  const idStack = [];
  while ((m = tagRe.exec(html))) {
    const nl = (m[0].match(/\n/g) || []).length;
    if (m[4] !== undefined) {
      if (!buf) bufLine = line;
      buf += m[4]; line += nl; continue;
    }
    const tag = m[2].toLowerCase(), attrs = m[3] || '', close = !!m[1];
    if (!close) {
      let a; const re = /\s(data-tip|data-tt-title|data-tt-desc|title|aria-label|alt|placeholder|label)="([^"]*)"/g;
      while ((a = re.exec(' ' + attrs))) if (IDEO.test(a[2])) for (const x of splitMarkup(a[2], true)) add(x, [], '主界面', `index.html:${line}`, '提示');
    }
    const inline = /^(b|i|u|em|strong|small|code|br)$/i.test(tag) && !/\sid=/.test(attrs);
    if (inline) { buf += `<${close ? '/' : ''}${tag}>`; }
    else flush();
    line += nl;
  }
  flush();
}

/* ---------- 排序＆輸出 ---------- */
const list = [...entries.values()];
list.sort((a, b) => {
  const c = CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat);
  if (c) return c;
  const fa = a.where[0].split(':')[0], fb = b.where[0].split(':')[0];
  if (fa !== fb) return fa < fb ? -1 : 1;
  return parseInt(a.where[0].split(':')[1]) - parseInt(b.where[0].split(':')[1]);
});
function csvCell(v) { v = String(v ?? ''); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
const header = ['編號', '用途說明', '替代字符參數說明', '繁體中文', '簡體中文', '英文'];
const lines = [header.map(csvCell).join(',')];
list.forEach((e, i) => {
  const kinds = [...e.kinds].join('/');
  const locs = e.where.slice(0, 3).join('、') + (e.where.length > 3 ? `…等${e.where.length}處` : '');
  const use = `[${e.cat}] ${kinds}｜${locs}`;
  lines.push([i + 1, use, describeRepl(e.text, e.params), e.text.replace(/\r?\n/g, '\\n'), '', ''].map(csvCell).join(','));
});
const outPath = process.argv[2] || path.join(root, 'config', 'CSV', 'String.csv');
fs.writeFileSync(outPath, '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
console.log('excluded', ex, 'kept', kept.length, 'entries', list.length);
const byCat = {}; list.forEach(e => byCat[e.cat] = (byCat[e.cat] || 0) + 1); console.log(byCat);
