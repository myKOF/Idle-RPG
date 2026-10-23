'use strict';
/* =============================================================================
   migrate.cjs — 把程式裡寫死的顯示文字改成 STR(編號, 參數…) 讀表（AI_RULES 8.10）
   -----------------------------------------------------------------------------
   用法：
     node tools/string-table/migrate.cjs --module 封魔塔            # 遷移該功能模塊的字串
     node tools/string-table/migrate.cjs --module 封魔塔 --dry      # 只報告，不寫檔
     node tools/string-table/migrate.cjs --module 封魔塔 --files js/tower.js,js/ui.js
     node tools/string-table/migrate.cjs --module 通用              # 跨模塊共用的詞（最後處理）

   做法（與 build_string_csv.cjs 同一套抽取，所以表裡的文字一定對得上）：
     A 整條替換：  '第' + n + '層' → STR(編號, n)         （整條 + 串接與表裡的繁體中文完全一致）
     B 字面值內切：'<b>文字</b>'    → '<b>' + STR(編號) + '</b>'（HTML 標記裡的文字節點／屬性值）
     HTML：index.html 的元素文字加 data-str，屬性值併入 data-str-attr。
   不處理（留在報告裡手動）：跨字面值的 HTML 片段含參數、混合內容的 HTML 元素。
   不會碰：GM／診斷等排除範圍、比對用字面值、由配置表重建的字面值區域。
   寫檔後自動：語法檢查、index.html 與 Worker 的 ?v= 快取版本加一。
   ============================================================================= */
const fs = require('fs');
const fsx = require('./fsx.cjs');
const path = require('path');
const vm = require('vm');
const { extract } = require('./chain.cjs');
const { scopeReason, GENERATED_TOP } = require('./scope.cjs');
const { splitMarkup, decodeEnt, IDEO } = require('./markup.cjs');
const { csvParse } = require('./apply_strings.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const MODULE = opt('--module');
const DRY = args.includes('--dry');
const ONLY = opt('--files') ? opt('--files').split(',') : null;
if (!MODULE) { console.error('用法：node tools/string-table/migrate.cjs --module <功能模塊> [--dry] [--files a.js,b.js]'); process.exit(1); }

/* ---------- 表 ---------- */
const trows = csvParse(fs.readFileSync(path.join(ROOT, 'config', 'CSV', 'String.csv'), 'utf8'));
const H = trows[0];
const C = { id: H.indexOf('編號'), mod: H.indexOf('功能模塊'), tw: H.indexOf('繁體中文') };
const table = new Map();
for (const r of trows.slice(1)) table.set(r[C.tw], { id: r[C.id], module: r[C.mod] });
const keyOf = (t) => t.replace(/\r?\n/g, '\\n');
const lookup = (t) => table.get(keyOf(t)) || null;
const find = (t) => { const e = lookup(t); return e && e.module === MODULE ? e : null; };
/* 一條串接（chain）由哪個模塊負責：句子最長的那個條目所屬的模塊。整條一次改完，不拆給不同模塊的提交 */
const ownerOf = (entries) => entries.reduce((best, x) => (!best || x.len > best.len ? x : best), null);

const lit = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r') + "'";

/* ---------- 把字面值還原成文字，同時記下每個字元在原始碼裡的位置 ---------- */
function unescapeMap(raw) {
  let out = '';
  const at = []; // at[i] = 第 i 個輸出字元在 raw 的起點；at[out.length] = raw.length
  for (let i = 0; i < raw.length;) {
    const c = raw[i];
    if (c !== '\\') { at.push(i); out += c; i++; continue; }
    const n = raw[i + 1];
    let len = 2, ch;
    if (n === 'u' && raw[i + 2] === '{') { const e = raw.indexOf('}', i); ch = String.fromCodePoint(parseInt(raw.slice(i + 3, e), 16)); len = e - i + 1; }
    else if (n === 'u') { ch = String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16)); len = 6; }
    else if (n === 'x') { ch = String.fromCharCode(parseInt(raw.slice(i + 2, i + 4), 16)); len = 4; }
    else if (n === 'n') ch = '\n'; else if (n === 't') ch = '\t'; else if (n === 'r') ch = '\r';
    else if (n === '\n') ch = ''; else ch = n;
    for (let k = 0; k < ch.length; k++) at.push(i);
    out += ch; i += len;
  }
  at.push(raw.length);
  return { value: out, at };
}

/* ---------- 單一檔案 ---------- */
function planFile(rel, src) {
  const recs = extract(src).filter(r => {
    const rr = { ...r, file: rel };
    if (scopeReason(rr)) return false;
    if (r.top && GENERATED_TOP.test(r.top) && /^js\/(data|skills2|status|runeword_data|gem_resonance_data|elite_data)\.js$/.test(rel)) return false;
    return !!r.span && !!r.ops;
  });
  const edits = [];
  let miss = 0;
  for (const r of recs) {
    const text = r.text.replace(/\u00a0/g, ' ');
    // A：整條替換（允許頭尾的空白留在程式碼，表裡的文字不含頭尾空白）
    let e = lookup(text), lead = '', trail = '';
    if (!e) {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
      if (m && m[2] && (m[1] || m[3]) && !/[<>]/.test(m[2])) { e = lookup(m[2]); lead = m[1]; trail = m[3]; }
    }
    if (e && !/\u00a0/.test(r.text)) { if (e.module === MODULE) edits.push({ kind: 'A', s: r.span[0], e: r.span[1], id: e.id, ops: r.ops, lead, trail }); continue; }
    // D：含替代字符的句子被 HTML 標記包住（'<div>戰鬥數據：DPS ' + x + '</div>'）→ 重組整條，只換掉句子本身
    const d = planD(r, src, text);
    if (d) { if (d.owner === MODULE) edits.push(d.edit); continue; }
    // B：字面值內切（HTML 標記裡的文字節點、屬性值）
    const pend = [];
    const owners = [];
    for (const op of r.ops) {
      if (op.type === 'str') {
        const raw = src.slice(op.s + 1, op.e - 1);
        const q = src[op.s];
        const cuts = cutLiteral(raw, op.s + 1, null);
        if (cuts.length) { pend.push({ kind: 'B', s: op.s, e: op.e, quote: q, cuts, base: op.s + 1, raw }); owners.push(...cuts); }
      } else if (op.type === 'tpl') {
        for (const p of op.tok.parts) {
          if (p.text === undefined || !p.text) continue;
          const cuts = cutLiteral(p.text, p.textStart, true);
          if (cuts.length) { pend.push({ kind: 'T', s: p.textStart, e: p.textStart + p.text.length, cuts, base: p.textStart, raw: p.text }); owners.push(...cuts); }
        }
      }
    }
    if (pend.length && ownerOf(owners).module === MODULE) edits.push(...pend);
  }
  if (process.env.MIG_TRACE) for (const ed of edits) console.error('[edit]', rel, ed.kind, ed.id || (ed.cuts && ed.cuts.map(c => c.id).join(',')) || (ed.seq && ed.seq.filter(x => x.str).map(x => x.str).join(',')), 'line', src.slice(0, ed.s).split('\n').length);
  return { edits, miss };
}

/* 與 build_string_csv.cjs 的 renumber 相同：句子內用到的 {N} 依出現順序重新編成 {0}、{1}… */
function renumberText(t) {
  const used = [...new Set([...t.matchAll(/\{(\d+)\}/g)].map(m => +m[1]))].sort((a, b) => a - b);
  const map = new Map(used.map((o, i) => [o, i]));
  return t.replace(/\{(\d+)\}/g, (m, d) => '{' + map.get(+d) + '}');
}

/* D：把整條串接拆成「文字／參數」項目，對照 splitMarkup 切出的句子，句子的範圍換成 STR(編號, 範圍內的參數…) */
function planD(r, src, text) {
  const pieces = splitMarkup(text);
  const hits = pieces.map(p => ({ p, e: lookup(renumberText(p)) })).filter(x => x.e);
  if (!hits.some(h => /\{\d+\}/.test(h.p))) return null;
  const items = [];
  for (const op of r.ops) {
    if (op.type === 'str') items.push({ text: unescapeMap(src.slice(op.s + 1, op.e - 1)).value });
    else if (op.type === 'tpl') {
      for (const p of op.tok.parts) {
        if (p.text !== undefined) { if (p.text) items.push({ text: unescapeMap(p.text).value }); }
        else items.push({ ph: [p.exprStart, p.exprEnd] });
      }
    } else items.push({ ph: [op.s, op.e] });
  }
  let k = 0, J = '';
  for (const it of items) {
    it.start = J.length;
    if (it.ph) { it.k = k++; J += '{' + it.k + '}'; } else J += it.text;
    it.end = J.length;
  }
  if (J.replace(/\u00a0/g, ' ') !== text) { if (process.env.MIG_DEBUG) console.error('[D] J!=text line', r.line, JSON.stringify(J.slice(0, 90)), JSON.stringify(text.slice(0, 90))); return null; } // 重組結果與抽取不一致就不動
  // 找每個句子在 J 的範圍
  const spans = [];
  let from = 0;
  for (const h of hits) {
    // 句子裡的 {N} 是重新編號過的（從 0 起），在整條裡的編號不同，所以用「任意 {數字}」比對
    const pat = h.p.split(/\{\d+\}/).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ +/g, '\\s+')).join('\\{\\d+\\}');
    const m = new RegExp(pat).exec(J.slice(from));
    if (!m) continue;
    const idx = from + m.index, len = m[0].length;
    spans.push({ a: idx, b: idx + len, id: h.e.id });
    from = idx + len;
  }
  if (!spans.length) return null;
  const seq = [];
  const emitRange = (a, b) => {
    for (const it of items) {
      if (it.end <= a || it.start >= b) continue;
      if (it.ph) seq.push({ expr: it.ph });
      else { const t = it.text.slice(Math.max(a, it.start) - it.start, Math.min(b, it.end) - it.start); if (t) seq.push({ lit: t }); }
    }
  };
  let cur = 0;
  for (const sp of spans) {
    emitRange(cur, sp.a);
    seq.push({ str: sp.id, phs: items.filter(it => it.ph && it.start >= sp.a && it.end <= sp.b).map(it => it.ph) });
    cur = sp.b;
  }
  emitRange(cur, J.length);
  // 相鄰文字合併
  const merged = [];
  for (const x of seq) { const l = merged[merged.length - 1]; if (x.lit !== undefined && l && l.lit !== undefined) l.lit += x.lit; else merged.push(x); }
  return { owner: ownerOf(hits.map(h => ({ module: h.e.module, len: h.p.length }))).module, edit: { kind: 'D', s: r.span[0], e: r.span[1], seq: merged } };
}

/* 在一段原始字面值文字裡找出屬於本模塊的條目，回傳 [{rs,re,id}]（相對 raw 的位置） */
function cutLiteral(raw, absStart, isTpl) {
  const { value, at } = unescapeMap(raw);
  if (!IDEO.test(value)) return [];
  const out = [];
  let from = 0;
  for (const piece of splitMarkup(value)) {
    const e = lookup(piece);
    if (!e) continue;
    let idx = value.indexOf(piece, from);
    let plen = piece.length;
    if (idx < 0) { // splitMarkup 會把連續空白收成一個
      const re = new RegExp(piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
      const m = re.exec(value.slice(from));
      if (!m) continue;
      idx = from + m.index; plen = m[0].length;
    }
    out.push({ rs: at[idx], re: at[idx + plen], id: e.id, module: e.module, len: piece.length });
    from = idx + plen;
  }
  return out;
}

/* ---------- 套用編輯（含巢狀：整條替換的參數裡還有別的替換） ---------- */
function applyEdits(src, edits) {
  edits.sort((a, b) => a.s - b.s || b.e - a.e);
  const roots = [];
  const stack = [];
  for (const ed of edits) {
    ed.children = [];
    while (stack.length && ed.s >= stack[stack.length - 1].e) stack.pop();
    if (stack.length) {
      const parent = stack[stack.length - 1];
      if (ed.e > parent.e) throw new Error('編輯範圍交錯：' + src.slice(ed.s, ed.s + 40));
      // B/T 的切割在字面值內，不會包含別人；只有 A 的參數可能含子編輯
      parent.children.push(ed);
    } else roots.push(ed);
    stack.push(ed);
  }
  function range(s, e, nodes) {
    let out = '', cur = s;
    for (const n of nodes) { if (n.s < s || n.e > e) continue; out += src.slice(cur, n.s) + render(n); cur = n.e; }
    return out + src.slice(cur, e);
  }
  function render(n) {
    if (n.kind === 'A') {
      const params = [];
      for (const op of n.ops) {
        if (op.type === 'expr') params.push(range(op.s, op.e, n.children).trim());
        else if (op.type === 'tpl') for (const p of op.tok.parts) if (p.expr !== undefined) params.push(range(p.exprStart, p.exprEnd, n.children).trim());
      }
      const call = 'STR(' + n.id + (params.length ? ', ' + params.join(', ') : '') + ')';
      return (n.lead ? lit(n.lead) + ' + ' : '') + call + (n.trail ? ' + ' + lit(n.trail) : '');
    }
    if (n.kind === 'D') {
      const parts = n.seq.map(x => x.lit !== undefined ? lit(x.lit)
        : x.expr ? range(x.expr[0], x.expr[1], n.children).trim()
          : 'STR(' + x.str + (x.phs.length ? ', ' + x.phs.map(p => range(p[0], p[1], n.children).trim()).join(', ') : '') + ')');
      if (n.seq[0] && n.seq[0].expr) parts.unshift("''");
      return parts.join(' + ');
    }
    // B：'前' + STR(id) + '後'；T：`前${STR(id)}後`
    let out = '', cur = 0;
    const parts = [];
    for (const c of n.cuts) { parts.push({ pre: n.raw.slice(cur, c.rs - 0) , id: c.id }); cur = c.re; }
    const tail = n.raw.slice(cur);
    if (n.kind === 'T') {
      out = '';
      cur = 0;
      for (const c of n.cuts) { out += n.raw.slice(cur, c.rs) + '${STR(' + c.id + ')}'; cur = c.re; }
      return out + n.raw.slice(cur);
    }
    const q = n.quote;
    const seq = [];
    cur = 0;
    for (const c of n.cuts) {
      const pre = n.raw.slice(cur, c.rs);
      if (pre) seq.push(q + pre + q);
      seq.push('STR(' + c.id + ')');
      cur = c.re;
    }
    if (tail) seq.push(q + tail + q);
    return seq.join(' + ');
  }
  // 因為 B 的 raw 是相對 base 的字串，cuts 位置要換成相對 raw
  for (const ed of edits) if (ed.kind === 'B' || ed.kind === 'T') ed.cuts = ed.cuts.map(c => ({ ...c, rs: c.rs, re: c.re }));
  return range(0, src.length, roots);
}

/* ---------- 版本號 ---------- */
function bumpVersions(rels, tag) {
  const idxPath = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(idxPath, 'utf8');
  const wPath = path.join(ROOT, 'js', 'worker', 'sim.worker.js');
  let worker = fs.readFileSync(wPath, 'utf8');
  const bPath = path.join(ROOT, 'js', 'bridge.js');
  let bridge = fs.readFileSync(bPath, 'utf8');
  let workerTouched = false;
  for (const rel of rels) {
    const base = rel.replace(/^js\//, '');
    const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp('(src="js/' + esc + '\\?v=)([^"]+)(")'), (m, a, v, c) => {
      const num = /^(\d+(?:\.\d+)*)$/.exec(v);
      if (num) { const p = v.split('.'); p[p.length - 1] = String(Number(p[p.length - 1]) + 1); return a + p.join('.') + c; }
      return a + tag + c;
    });
    const wre = new RegExp("(['\"]\\.\\./" + esc + "\\?v=)([^'\"]+)(['\"])");
    if (wre.test(worker)) { worker = worker.replace(wre, '$1' + tag + '$3'); workerTouched = true; }
    else if (new RegExp("(['\"]\\.\\./" + esc + "['\"])").test(worker)) { worker = worker.replace(new RegExp("(['\"]\\.\\./" + esc + ")(['\"])"), "$1?v=" + tag + "$2"); workerTouched = true; }
  }
  if (workerTouched) {
    fsx.write(wPath, worker);
    bridge = bridge.replace(/(var WORKER_ASSET_VERSION = ')[^']*(')/, '$1' + tag + '$2');
    fsx.write(bPath, bridge);
    html = html.replace(/(src="js\/bridge\.js\?v=)(\d+(?:\.\d+)*)(")/, (m, a, v, c) => { const p = v.split('.'); p[p.length - 1] = String(Number(p[p.length - 1]) + 1); return a + p.join('.') + c; });
  }
  fsx.write(idxPath, html);
  // VFX 編輯器頁與主頁共用的腳本版號必須一致（tests/vfx-editor-cache-versions.test.cjs CV-1）
  const edPath = path.join(ROOT, 'tools', 'vfx', 'editor', 'index.html');
  if (fs.existsSync(edPath)) {
    let ed = fs.readFileSync(edPath, 'utf8'); const before = ed;
    for (const rel of rels) {
      const base = rel.replace(/^js\//, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp('src="js/' + base + '\\?v=([^"]+)"').exec(html);
      if (m) ed = ed.replace(new RegExp('(src="/js/' + base + '\\?v=)[^"]+(")'), '$1' + m[1] + '$2');
    }
    if (ed !== before) fsx.write(edPath, ed);
  }
}

/* ---------- index.html ---------- */
function migrateHtml() {
  const p = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(p, 'utf8');
  const orig = html;
  let n = 0; const manual = [];
  const maskBlocks = (h) => h.replace(/<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, m => m.replace(/[^\n]/g, ' '));
  const ATTRS = /(data-tip|data-tt-title|data-tt-desc|data-tt-[\w-]+|title|aria-label|alt|placeholder|label)="([^"]*)"/g;
  // 1) 屬性值 → data-str-attr
  {
    const masked = maskBlocks(html);
    const tagRe = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
    let m, out = '', cur = 0;
    while ((m = tagRe.exec(masked))) {
      const attrs = m[2];
      if (!IDEO.test(attrs)) continue;
      const moves = [];
      let newAttrs = attrs.replace(new RegExp('\\s' + ATTRS.source, 'g'), (all, name, val) => {
        if (!IDEO.test(val)) return all;
        const e = find(decodeEnt(val).replace(/\s+/g, ' ').trim());
        if (!e) { if (!table.has(decodeEnt(val).replace(/\s+/g, ' ').trim())) manual.push('屬性 ' + name + '="' + val.slice(0, 30) + '"'); return all; }
        moves.push(name + ':' + e.id); return '';
      });
      if (!moves.length) continue;
      const ex = /\sdata-str-attr="([^"]*)"/.exec(newAttrs);
      if (ex) newAttrs = newAttrs.replace(ex[0], ' data-str-attr="' + ex[1] + ';' + moves.join(';') + '"');
      else newAttrs = newAttrs.replace(/(\s*\/?)$/, ' data-str-attr="' + moves.join(';') + '"$1');
      out += html.slice(cur, m.index) + '<' + m[1] + newAttrs + '>';
      cur = m.index + m[0].length; n += moves.length;
    }
    html = out + html.slice(cur);
  }
  // 2) 元素文字 → data-str／data-str-html
  {
    const masked = maskBlocks(html);
    const elRe = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>([^<]*(?:<(?:b|i|u|em|strong|small|code|br)\s*\/?>[^<]*|<\/(?:b|i|u|em|strong|small|code)>[^<]*)*)<\/\1>/g;
    let m, out = '', cur = 0;
    while ((m = elRe.exec(masked))) {
      const inner = m[3];
      if (!IDEO.test(inner)) continue;
      if (/\sdata-str(?:-html)?=/.test(m[2])) continue;
      const hasTag = /</.test(inner);
      const core = decodeEnt(inner).replace(/\s+/g, ' ').trim();
      const e = find(core);
      if (!e) { continue; }
      const attr = hasTag ? 'data-str-html' : 'data-str';
      out += html.slice(cur, m.index) + '<' + m[1] + m[2].replace(/(\s*\/?)$/, ' ' + attr + '="' + e.id + '"$1') + '></' + m[1] + '>';
      cur = m.index + m[0].length; n++;
    }
    html = out + html.slice(cur);
  }
  // 3b) <b>文字</b> 這種整段含格式標籤的條目 → <span data-str-html>
  {
    const masked = maskBlocks(html);
    const fmtRe = /<(b|i|u|em|strong|small|code)>([^<>]*[㐀-鿿][^<>]*)<\/\1>/g;
    let m, out = '', cur = 0;
    while ((m = fmtRe.exec(masked))) {
      const e = find(m[0].replace(/\s+/g, ' ').trim());
      if (!e) continue;
      out += html.slice(cur, m.index) + '<span data-str-html="' + e.id + '"></span>';
      cur = m.index + m[0].length; n++;
    }
    html = out + html.slice(cur);
  }
  // 3) 混合內容（文字旁邊還有別的元素）的文字節點 → 包一個 <span data-str>
  {
    const masked = maskBlocks(html);
    const textRe = />([^<>]*[㐀-鿿][^<>]*)</g;
    let m, out = '', cur = 0;
    while ((m = textRe.exec(masked))) {
      const rawText = m[1];
      const e = find(decodeEnt(rawText).replace(/\s+/g, ' ').trim());
      textRe.lastIndex = m.index + 1 + rawText.length;
      if (!e) continue;
      const lead = /^\s*/.exec(rawText)[0], trail = /\s*$/.exec(rawText)[0];
      out += html.slice(cur, m.index + 1) + lead + '<span data-str="' + e.id + '"></span>' + trail;
      cur = m.index + 1 + rawText.length; n++;
    }
    html = out + html.slice(cur);
  }
  return { html, changed: html !== orig, n, manual };
}

/* ---------- 主流程 ---------- */
function listFiles() {
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); } else if (e.name.endsWith('.js')) files.push(p); } })(path.join(ROOT, 'js'));
  return files.map(f => path.relative(ROOT, f).split(path.sep).join('/')).sort();
}

const changedFiles = [];
let total = 0, totalMiss = 0;
for (const rel of listFiles()) {
  if (ONLY && !ONLY.includes(rel)) continue;
  if (/^js\/(strings|strings_data)\.js$/.test(rel)) continue;
  const abs = path.join(ROOT, rel);
  const src = fs.readFileSync(abs, 'utf8');
  const { edits } = planFile(rel, src);
  if (!edits.length) continue;
  const next = applyEdits(src, edits);
  try { new vm.Script(next, { filename: rel }); } catch (e) { console.error('✖ ' + rel + ' 改完語法錯誤：' + e.message); process.exit(2); }
  console.log(`  ${rel}: ${edits.length} 處`);
  total += edits.length;
  if (!DRY) { fsx.write(abs, next); changedFiles.push(rel); }
}
const h = migrateHtml();
if (h.changed) {
  console.log(`  index.html: ${h.n} 處`);
  total += h.n;
  if (!DRY) fsx.write(path.join(ROOT, 'index.html'), h.html);
}
if (h.manual.length) console.log('  index.html 需手動：' + h.manual.slice(0, 20).join('、'));
if (!DRY) require('./bump.cjs').bumpFromGit('20261023-str-' + ({ '封魔塔': 'tower', '熔爐': 'furnace', '神鑄': 'forge', '寶石': 'gem', '符文': 'rune', '技能': 'skill', '威能': 'talent', '裝備': 'equip', '角色': 'char', '戰鬥': 'battle', '存檔與系統': 'system', '通用': 'common', '任務': 'quest' }[MODULE] || 'x'));
console.log(`[migrate] ${MODULE}：${DRY ? '（試跑）' : ''}共 ${total} 處；剩餘請看：node tools/string-table/build_string_csv.cjs --check`);
