'use strict';
/* =============================================================================
   config_tables.cjs — 四系統（技能/寶石/天賦/裝備詞條）配置撥離管線
   -----------------------------------------------------------------------------
   將 js/skills.js 與 js/data.js 中的內容資料表撥離成獨立、可用 Excel 編輯的
   xlsx + CSV；並能把編輯後的表單「回寫」進遊戲 JS（雙向）。

   模式：
     node tools/config_tables.cjs --gen              # 由現有 JS 產生四份 CSV + xlsx（bootstrap / 重新產生）
     node tools/config_tables.cjs --sync             # 由 xlsx 轉出 CSV（供 .bat：讀使用者編輯後的 xlsx）
     node tools/config_tables.cjs --apply            # 試跑：由 CSV 重建 JS 字面值，只報告不寫檔
     node tools/config_tables.cjs --apply --write    # 實際寫回 JS（先備份、寫入後 node --check、失敗還原）

   四表 ↔ JS 字面值：
     Skills            ← SKILLS + UNLOCKS（js/skills.js）
     Gems              ← GEM_TYPES（js/data.js）
     Talents           ← TALENT_TREES + POTENTIAL_TALENTS（js/data.js）
     Equipment_Affix   ← AFFIX_POOL + PASSIVE_POOL + GODFORGE_POOL（js/data.js）

   原理：這些是「純資料字面值」（`var NAME = {…};`）。--gen 以字串感知的括號配對
   萃取字面值 → eval（沙盒，僅需 ACCESSORY_SLOTS 前置）→ 依 schema 攤平成表格列。
   --apply 反向：讀表格列 → 依 schema 重建整個字面值物件 → 就地替換該 `var NAME = …;` 區塊。
   安全：--write 前備份、寫入後對每個目標檔 `node --check`，任一失敗全部還原。
   ============================================================================= */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CSV_DIR = path.join(ROOT, 'config', 'CSV');
const XLSX_DIR = path.join(ROOT, 'config', 'Excel');
const JS = {
  data: path.join(ROOT, 'js', 'data.js'),
  skills: path.join(ROOT, 'js', 'skills.js')
};
const WRITE = process.argv.includes('--write');

/* ===========================================================================
   基礎工具：讀寫、CSV、JS 字面值萃取／eval／輸出
   =========================================================================== */
function readUtf8(p) { return fs.readFileSync(p, 'utf8'); }
function writeUtf8(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); }

/* ---- CSV（RFC-4180、去 BOM、輸出帶 BOM + CRLF，與既有工具一致） ---- */
function csvParse(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}
function csvField(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvStringify(rows) {
  return '﻿' + rows.map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/* ---- 字串感知括號配對：從 `var NAME =` 之後的第一個 { 或 [ 掃到對應的收合 ---- */
function extractLiteral(src, varName) {
  const decl = new RegExp('\\bvar\\s+' + varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*');
  const m = decl.exec(src);
  if (!m) throw new Error('找不到 var ' + varName);
  let i = m.index + m[0].length;
  const open = src[i];
  if (open !== '{' && open !== '[') throw new Error(varName + ' 不是物件/陣列字面值');
  const close = open === '{' ? '}' : ']';
  let depth = 0, str = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (str) {
      if (c === '\\') { i++; continue; }
      if (c === str) str = null;
      continue;
    }
    // 略過註解（僅在非字串狀態；避免註解內的 { } ' " 干擾括號配對）
    if (c === '/' && src[i + 1] === '/') { i++; while (i + 1 < src.length && src[i + 1] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i + 1 < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    if (c === "'" || c === '"') { str = c; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error(varName + ' 括號未配對');
  // 收合後應接著分號
  let end = i + 1;
  while (end < src.length && /\s/.test(src[end])) end++;
  if (src[end] === ';') end++;
  const declStart = m.index;
  return { declStart, valueStart: m.index + m[0].length, close: i, end,
    header: src.slice(declStart, m.index + m[0].length), literal: src.slice(m.index + m[0].length, i + 1) };
}
// eval 純資料字面值（沙盒；僅提供資料檔會引用到的常數 ACCESSORY_SLOTS）
function evalLiteral(literal) {
  const ACCESSORY_SLOTS = ['ring', 'amulet'];
  // eslint-disable-next-line no-eval
  return eval('(' + literal + ')');
}

/* ---- JS 字面值輸出（單引號字串、合法識別字/整數鍵不加引號） ---- */
function isIdentKey(k) { return /^[A-Za-z_$][\w$]*$/.test(k); }
function isIntKey(k) { return /^(0|[1-9]\d*)$/.test(k); }
function quoteStr(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r') + "'";
}
function jsLit(v) {
  if (v === null) return 'null';
  if (typeof v === 'number') return numStr(v);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return quoteStr(v);
  if (Array.isArray(v)) return '[' + v.map(jsLit).join(', ') + ']';
  if (typeof v === 'object') {
    const parts = Object.keys(v).map(k => {
      const key = (isIdentKey(k) || isIntKey(k)) ? k : quoteStr(k);
      return key + ': ' + jsLit(v[k]);
    });
    return '{ ' + parts.join(', ') + ' }';
  }
  return String(v);
}
function numStr(n) {
  if (!isFinite(n)) return String(n);
  let out = String(n);
  if (out.indexOf('e') >= 0 || out.indexOf('E') >= 0) out = n.toFixed(12).replace(/\.?0+$/, '');
  return out;
}

/* ---- 欄值型別小工具 ---- */
function toNum(s) { const n = Number(String(s).trim()); if (!isFinite(n)) throw new Error('非數字：「' + s + '」'); return n; }
function toBool(s) { const t = String(s).trim().toUpperCase(); return t === 'TRUE' || t === '是' || t === '1' || t === 'Y'; }
function boolCell(b) { return b ? 'TRUE' : 'FALSE'; }
function splitList(s) { const t = String(s == null ? '' : s).trim(); return t === '' ? [] : t.split(';').map(x => x.trim()).filter(x => x !== ''); }
function joinList(a) { return (a || []).join(';'); }

/* ===========================================================================
   xlsx 讀（ZIP inflate + 工作表 + sharedStrings；取第一張表）
   =========================================================================== */
function readZipEntries(buf) {
  const entries = {}; let i = 0;
  while (i + 4 <= buf.length) {
    const sig = buf.readUInt32LE(i);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.toString('utf8', i + 30, i + 30 + nameLen);
    const dataStart = i + 30 + nameLen + extraLen;
    const raw = buf.slice(dataStart, dataStart + compSize);
    entries[name] = method === 8 ? zlib.inflateRawSync(raw) : raw;
    i = dataStart + compSize;
  }
  return entries;
}
function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}
function colIndex(ref) { const m = /^([A-Z]+)/.exec(ref); let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
/* 命名空間正規化：OpenXML SDK 系工具存的 <x:row>/<x:c>… 剝成 <row>/<c>…（屬性如 r:id 不受影響） */
function stripNsPrefix(xml) { return xml.replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1'); }
function parseSharedStrings(xml) {
  if (!xml) return [];
  xml = stripNsPrefix(xml);
  const out = [];
  xml.replace(/<si>([\s\S]*?)<\/si>/g, (m, inner) => {
    let t = ''; inner.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (mm, x) => { t += x; return ''; }); out.push(decodeXml(t)); return '';
  });
  return out;
}
function parseSheet(xml, shared) {
  xml = stripNsPrefix(xml);
  const rows = [];
  xml.replace(/<row\b([^>]*)>([\s\S]*?)<\/row>/g, (m, rowAttr, inner) => {
    const rm = /\br="(\d+)"/.exec(rowAttr);
    const rowIdx = rm ? parseInt(rm[1], 10) - 1 : rows.length;
    while (rows.length < rowIdx) rows.push([]);
    const cells = [];
    // 剝掉自閉合空儲存格（無值），避免配對式匹配把它與下一格黏在一起
    inner = inner.replace(/<c\b[^>]*\/>/g, '');
    inner.replace(/<c\b([^>]*)>([\s\S]*?)<\/c>/g, (mm, attr, body) => {
      const refM = /\br="([A-Z]+\d+)"/.exec(attr);
      if (!refM) return '';
      const tm = /t="([^"]+)"/.exec(attr); const t = tm ? tm[1] : '';
      let val = ''; const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
      if (t === 's') { if (vm) val = shared[parseInt(vm[1], 10)] || ''; }
      else if (t === 'inlineStr') { let s = ''; body.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (x, y) => { s += y; return ''; }); val = decodeXml(s); }
      else if (t === 'str') { if (vm) val = decodeXml(vm[1]); }
      else { if (vm) val = vm[1]; }
      cells[colIndex(refM[1])] = val; return '';
    });
    rows[rowIdx] = cells; return '';
  });
  for (let r = 0; r < rows.length; r++) if (!rows[r]) rows[r] = [];
  return rows;
}
function resolveFirstSheetPath(entries) {
  const wb = stripNsPrefix(entries['xl/workbook.xml'] ? entries['xl/workbook.xml'].toString('utf8') : '');
  const rels = stripNsPrefix(entries['xl/_rels/workbook.xml.rels'] ? entries['xl/_rels/workbook.xml.rels'].toString('utf8') : '');
  const relMap = {};
  // 屬性順序不限（Excel 寫 Id 在前、OpenXML SDK 系寫 Target 在前）
  rels.replace(/<Relationship\b[^>]*>/g, (tag) => {
    const id = (/\bId="([^"]+)"/.exec(tag) || [])[1];
    const target = (/\bTarget="([^"]+)"/.exec(tag) || [])[1];
    if (id && target) relMap[id] = target;
    return '';
  });
  const sheets = [];
  wb.replace(/<sheet\b[^>]*\/?>/g, (tag) => {
    const rid = (/r:id="([^"]+)"/.exec(tag) || [])[1] || ''; sheets.push({ rid }); return '';
  });
  const chosen = sheets[0]; if (!chosen) throw new Error('xlsx 無工作表');
  let target = relMap[chosen.rid]; if (!target) throw new Error('找不到工作表關聯');
  target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
  return 'xl/' + target;
}
function readXlsxRows(xlsxPath) {
  const buf = fs.readFileSync(xlsxPath);
  const entries = readZipEntries(buf);
  const shared = parseSharedStrings(entries['xl/sharedStrings.xml'] ? entries['xl/sharedStrings.xml'].toString('utf8') : '');
  const sheetPath = resolveFirstSheetPath(entries);
  const rows = parseSheet(entries[sheetPath].toString('utf8'), shared);
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows.map(r => { const o = []; for (let c = 0; c < width; c++) o.push(r[c] == null ? '' : r[c]); return o; });
}

/* ===========================================================================
   xlsx 寫（純 Node ZIP：數字寫 numeric、其餘 inlineStr）
   =========================================================================== */
function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function colName(idx) { let n = idx + 1, s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
function isNumericCell(v) { return typeof v === 'number' || (typeof v === 'string' && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v.trim()) && v.trim() !== ''); }
function sheetXml(rows) {
  const parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
  rows.forEach((row, ri) => {
    parts.push('<row r="' + (ri + 1) + '">');
    row.forEach((cell, ci) => {
      if (cell === '' || cell == null) return;
      const ref = colName(ci) + (ri + 1);
      if (isNumericCell(cell)) parts.push('<c r="' + ref + '"><v>' + String(cell).trim() + '</v></c>');
      else parts.push('<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(cell) + '</t></is></c>');
    });
    parts.push('</row>');
  });
  parts.push('</sheetData></worksheet>');
  return Buffer.from(parts.join(''), 'utf8');
}
function zipStore(files) {
  // files: [{name, data(Buffer)}] → 產生 deflate ZIP
  const locals = []; const centrals = []; let offset = 0;
  const dosTime = 0, dosDate = 0x21; // 1980-01-01 固定（Date.now 不可用且無需真實時間）
  files.forEach(f => {
    const data = f.data;
    const comp = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data) >>> 0;
    const nameBuf = Buffer.from(f.name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  });
  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(localBuf.length, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}
function writeXlsx(xlsxPath, sheetName, rows, extraSheets) {
  // extraSheets（選填）：[{ name, rows }] 追加工作表（第 2 頁起）；讀取端（readXlsxRows/sync）只讀第一張表，
  // 追加表僅供人閱讀（例如 Skills 的「變量定義」說明頁）。
  const sheets = [{ name: sheetName, rows: rows }].concat(extraSheets || []);
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
    '</Types>';
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' + sheets.map((s, i) => '<sheet name="' + xmlEsc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>';
  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
    '</Relationships>';
  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(wbRels, 'utf8') }
  ];
  sheets.forEach((s, i) => files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(s.rows) }));
  fs.mkdirSync(path.dirname(xlsxPath), { recursive: true });
  fs.writeFileSync(xlsxPath, zipStore(files));
}

/* ===========================================================================
   四表 schema：extract(把 JS 值攤平成 rows) / rebuild(rows 重建字面值文字)
   每個 schema：{ name, jsFile, sheet, header, extract(vals)->dataRows, rebuild(dataRows)->{var:newText} }
   dataRows 不含表頭；rows() 皆以表頭名稱定位欄位（容忍使用者調欄序）。
   =========================================================================== */
function rowGetter(header) {
  // 標題格允許「第一行=欄名、換行後=中文說明」；欄位對應一律取第一行。
  const idx = {}; header.forEach((h, i) => { idx[String(h).split('\n')[0].trim()] = i; });
  return (row, name) => { const i = idx[name]; return i == null ? '' : (row[i] == null ? '' : String(row[i])); };
}

const SCHEMAS = {};

/* ---- Gems ← GEM_TYPES ---- */
SCHEMAS.Gems = {
  name: 'Gems', jsFile: 'data', sheet: 'Gems', vars: ['GEM_TYPES'],
  header: ['id', '名稱', 'icon圖號', '屬性桶', '屬性名稱', '基礎值', '百分比', '線性'],
  extract(src) {
    const GEM_TYPES = evalLiteral(extractLiteral(src, 'GEM_TYPES').literal);
    return Object.keys(GEM_TYPES).map(id => {
      const g = GEM_TYPES[id];
      return [id, g.name, g.emoji, g.stat, g.statName, numStr(g.base), boolCell(!!g.pct), g.linear ? 'TRUE' : ''];
    });
  },
  rebuild(dataRows, header) {
    const get = rowGetter(header);
    const entries = dataRows.filter(r => get(r, 'id').trim() !== '').map(r => {
      const id = get(r, 'id').trim();
      const o = { name: get(r, '名稱'), emoji: get(r, 'icon圖號'), stat: get(r, '屬性桶'),
        statName: get(r, '屬性名稱'), base: toNum(get(r, '基礎值')), pct: toBool(get(r, '百分比')) };
      if (toBool(get(r, '線性'))) o.linear = true;
      return '  ' + id + ': ' + jsLit(o);
    });
    return { GEM_TYPES: 'var GEM_TYPES = {\n' + entries.join(',\n') + '\n};' };
  }
};

/* ---- Talents ← TALENT_TREES + POTENTIAL_TALENTS ---- */
SCHEMAS.Talents = {
  name: 'Talents', jsFile: 'data', sheet: 'Talents', vars: ['TALENT_TREES'],
  header: ['類型', '轉數', 'id', '名稱', 'icon圖號', '屬性桶', '低階值', '高階值', '每級值', '解鎖數', '停用', '停用原因', '說明'],
  extract(src) {
    const TALENT_TREES = evalLiteral(extractLiteral(src, 'TALENT_TREES').literal);
    const rows = [];
    Object.keys(TALENT_TREES).map(Number).sort((a, b) => a - b).forEach(turn => {
      TALENT_TREES[turn].forEach(t => {
        rows.push(['轉生天賦', String(turn), t.id, t.name, t.emoji, t.stat,
          numStr(t.low), numStr(t.high), '', t.unlocks == null ? '' : numStr(t.unlocks),
          t.disabled ? 'TRUE' : '', t.disabledReason || '', t.desc]);
      });
    });
    // 潛力技能 V3 已移至 Skills 表（js/skills.js 的 POTENTIAL_TALENTS）。
    return rows;
  },
  rebuild(dataRows, header) {
    const get = rowGetter(header);
    const trees = {};
    dataRows.forEach(r => {
      const kind = get(r, '類型').trim(); const id = get(r, 'id').trim();
      if (id === '') return;
      if (kind === '潛力天賦') {
        // 舊版殘留列（潛力已移至 Skills 表）：略過，避免誤併入天賦樹。
        console.log('  – Talents：略過舊潛力列 ' + id + '（潛力已移至 Skills 表）');
        return;
      } else {
        const turn = String(toNum(get(r, '轉數')));
        const o = { id: id, name: get(r, '名稱'), emoji: get(r, 'icon圖號'), stat: get(r, '屬性桶'),
          low: toNum(get(r, '低階值')), high: toNum(get(r, '高階值')) };
        if (get(r, '解鎖數').trim() !== '') o.unlocks = toNum(get(r, '解鎖數'));
        o.desc = get(r, '說明');
        if (toBool(get(r, '停用'))) { o.disabled = true; o.disabledReason = get(r, '停用原因'); }
        (trees[turn] || (trees[turn] = [])).push(o);
      }
    });
    const turnKeys = Object.keys(trees).map(Number).sort((a, b) => a - b);
    const treeText = 'var TALENT_TREES = {\n' + turnKeys.map(turn => {
      const items = trees[turn].map(o => '    ' + jsLit(o)).join(',\n');
      return '  ' + turn + ': [\n' + items + '\n  ]';
    }).join(',\n') + '\n};';
    return { TALENT_TREES: treeText };
  }
};

/* ---- Equipment_Affix ← AFFIX_POOL + PASSIVE_POOL + GODFORGE_POOL ---- */
SCHEMAS.Equipment_Affix = {
  name: 'Equipment_Affix', jsFile: 'data', sheet: 'Equipment_Affix', vars: ['AFFIX_POOL', 'PASSIVE_POOL', 'GODFORGE_POOL'],
  header: ['池', 'id', '名稱', '基礎值', '每級成長', '百分比', '權重', '最低稀有度', '出現部位', '每階perR', '屬性桶stats', '說明'],
  extract(src) {
    const AFFIX_POOL = evalLiteral(extractLiteral(src, 'AFFIX_POOL').literal);
    const PASSIVE_POOL = evalLiteral(extractLiteral(src, 'PASSIVE_POOL').literal);
    const GODFORGE_POOL = evalLiteral(extractLiteral(src, 'GODFORGE_POOL').literal);
    const rows = [];
    Object.keys(AFFIX_POOL).forEach(id => {
      const a = AFFIX_POOL[id];
      rows.push(['詞條池', id, a.name, numStr(a.base), numStr(a.lv), boolCell(!!a.pct), numStr(a.weight),
        a.minR == null ? '' : numStr(a.minR), a.slots ? joinList(a.slots) : '', '', '', '']);
    });
    Object.keys(PASSIVE_POOL).forEach(id => {
      const p = PASSIVE_POOL[id];
      rows.push(['特殊被動', id, p.name, numStr(p.base), '', '', '', '', '', numStr(p.perR), '', p.desc]);
    });
    Object.keys(GODFORGE_POOL).forEach(id => {
      const g = GODFORGE_POOL[id];
      rows.push(['神鑄特效', id, g.name, numStr(g.base), '', '', '', '', '', '', g.stats ? joinList(g.stats) : '', g.desc]);
    });
    return rows;
  },
  rebuild(dataRows, header) {
    const get = rowGetter(header);
    const affix = [], passive = [], god = [];
    dataRows.forEach(r => {
      const pool = get(r, '池').trim(); const id = get(r, 'id').trim();
      if (id === '') return;
      if (pool === '詞條池') {
        const o = { name: get(r, '名稱'), base: toNum(get(r, '基礎值')), lv: toNum(get(r, '每級成長')),
          pct: toBool(get(r, '百分比')), weight: toNum(get(r, '權重')) };
        if (get(r, '最低稀有度').trim() !== '') o.minR = toNum(get(r, '最低稀有度'));
        const slots = splitList(get(r, '出現部位')); if (slots.length) o.slots = slots;
        affix.push('  ' + id + ': ' + jsLit(o));
      } else if (pool === '特殊被動') {
        const o = { name: get(r, '名稱'), desc: get(r, '說明'), base: toNum(get(r, '基礎值')), perR: toNum(get(r, '每階perR')) };
        passive.push('  ' + id + ': ' + jsLit(o));
      } else if (pool === '神鑄特效') {
        const o = { name: get(r, '名稱'), desc: get(r, '說明'), base: toNum(get(r, '基礎值')) };
        const stats = splitList(get(r, '屬性桶stats')); if (stats.length) o.stats = stats;
        god.push('  ' + id + ': ' + jsLit(o));
      }
    });
    return {
      AFFIX_POOL: 'var AFFIX_POOL = {\n' + affix.join(',\n') + '\n};',
      PASSIVE_POOL: 'var PASSIVE_POOL = {\n' + passive.join(',\n') + '\n};',
      GODFORGE_POOL: 'var GODFORGE_POOL = {\n' + god.join(',\n') + '\n};'
    };
  }
};

/* ---- Skills ← SKILLS + UNLOCKS ---- */
/* Skills.xlsx 第 2 工作表「變量定義」：基礎/里程碑 fx 全部變量的中文定義（一行一個變量；僅供人閱讀，sync/apply 只讀第 1 表）。 */
const FX_GLOSSARY_ROWS = [
  ['基礎fx(JSON)'],
  ['【傷害】'],
  ['dmgType=傷害類型(phys=物理/magic=魔法/true=真實·無視防禦抗性)；'],
  ['stat=傷害參照屬性(atk=物攻/matk=魔攻)；'],
  ['base=Lv.1傷害%(占物攻/魔攻)；'],
  ['per=每級傷害%增量；'],
  ['hits=攻擊段數；'],
  ['critBonus=此技能額外爆擊率%；'],
  ['neverMiss=必定命中(true)；'],
  ['gamble=傷害隨機50%~250%(true)；'],
  ['selfDmgPct=自傷(損失自身最大生命%)；'],
  ['【元素】'],
  ['elem={type:元素種類,portion:元素占比0~1}；'],
  ['elems={元素:占比,…}(融合技多元素)；'],
  ['元素種類：fire=火/ice=冰/lightning=雷/poison=毒/light=聖/dark=暗；'],
  ['【持續傷害】'],
  ['dot={pct:每秒跳傷(占技能傷害%),dur:持續秒,name:顯示名}；'],
  ['dotList=[多條dot](融合技)；'],
  ['maxHpDotPct={base,per}=詛咒跳傷(占敵最大生命%/秒)；'],
  ['dotDur=詛咒持續秒；'],
  ['【控場】'],
  ['stunDur=暈眩秒數；'],
  ['slowDur=減速秒數；'],
  ['【回復/護盾】'],
  ['healPctMax={base,per}=回復最大生命%；'],
  ['hotPct={base,per}=每秒再生最大生命%；'],
  ['hotDur=再生持續秒；'],
  ['shieldPctMax={base,per}=護盾(占最大生命%)；'],
  ['healPctOfDmg=傷害轉生命回復%；'],
  ['mpRestore=回復法力點數；'],
  ['mpOnCrit=爆擊返還法力點數；'],
  ['selfCleanse=淨化自身負面(true)；'],
  ['【增益/減益】'],
  ['buff/buff2={key,base,per,dur}=自身增益；'],
  ['debuff/debuff2={key,base,per,dur}=敵方減益；'],
  ['（其中 base=Lv.1數值%、per=每級增量、dur=持續秒）'],
  ['key種類：atkUp=攻擊/defUp=防禦/aspdUp=攻速/evasionUp=閃避/critDmgUp=爆傷/lootUp=掉寶/thornsUp=反震/blockUp=格擋/hot=再生/atkDown=降敵攻/defDown=降敵防；'],
  ['【處決/其他】'],
  ['execBelow=處決閾值(敵血量%以下觸發)；'],
  ['execMult=處決傷害倍率；'],
  ['goldPer=金幣掠奪係數(×技能等級×角色等級)；'],
  ['doubleCastPct=雙重施法機率%；'],
  ['comboDetonate=冰火引爆追加傷害%(融合變異)；'],
  ['【被動技】'],
  ['passive={屬性:每級數值}；'],
  ['屬性種類：hpPct=生命上限%/atkPct=物攻%/matkPct=魔攻%/aspdPct=攻速%/critRate=爆擊率/critDmg=爆擊傷害/lifesteal=吸血/mpFlat=法力上限/mpRegen=法力回復每秒/defPct=物防%/mdefPct=魔防%/goldBonus=金幣獲取%/xpBonus=經驗獲取%；'],
  ['【潛力技能(系統分類=potential)】'],
  ['type=類型(active=主動/passive=被動/passiveTrigger=被動觸發)；'],
  ['base=效果基準值；'],
  ['per=每級效果增量；'],
  ['dur=增益持續秒；'],
  ['dmgType=傷害類型(phys=物理/magic=魔法)；'],
  ['mech=戰鬥機制代號(接線鍵勿改)；'],
  ['en=英文名；'],
  ['desc=質變說明(面板顯示的完整敘述)；'],
  [''],
  ['里程碑fx(JSON)'],
  ['格式：{"等級":{覆蓋欄位},…}，例 {"4":{…},"8":{…}}；'],
  ['＝技能升到該等級後，用其中欄位「覆蓋」基礎fx的同名欄位(淺層覆蓋、達標的高等級優先)；'],
  ['可用變量與定義同上「基礎fx(JSON)」；'],
  ['潛力技能不使用此欄；']
];

SCHEMAS.Skills = {
  name: 'Skills', jsFile: 'skills', sheet: 'Skills', vars: ['SKILLS', 'UNLOCKS', 'POTENTIAL_TALENTS'],
  extraSheets: [{ name: '變量定義', rows: FX_GLOSSARY_ROWS }],
  header: ['id', '系統分類', '名稱', 'icon圖號', '施法消耗', '冷卻', '施放AI', '說明文字', '基礎fx(JSON)', '里程碑fx(JSON)'],
  extract(src) {
    const SKILLS = evalLiteral(extractLiteral(src, 'SKILLS').literal);
    const UNLOCKS = evalLiteral(extractLiteral(src, 'UNLOCKS').literal);
    const POTENTIAL_TALENTS = evalLiteral(extractLiteral(src, 'POTENTIAL_TALENTS').literal);
    const rows = Object.keys(SKILLS).map(id => {
      const s = SKILLS[id];
      const un = UNLOCKS[id];
      return [id, s.cat, s.name, s.emoji,
        s.cost == null ? '' : numStr(s.cost), s.cd == null ? '' : numStr(s.cd),
        s.ai || '', s.flavor || '', JSON.stringify(s.fx), un ? JSON.stringify(un) : ''];
    });
    // 潛力技能 V3（系統分類=potential；列順序＝解鎖順序）：與一般技能同格式——
    // 共用欄放 名稱/icon/冷卻/說明文字(風味)，其餘機制參數（type/base/per/dur/dmgType/mech/en/desc）收進「基礎fx(JSON)」。
    POTENTIAL_TALENTS.forEach(t => {
      const fx = { type: t.type || 'active', base: t.base == null ? 0 : t.base, per: t.per == null ? 0 : t.per };
      if (t.dur != null) fx.dur = t.dur;
      if (t.dmgType) fx.dmgType = t.dmgType;
      fx.mech = t.mech || '';
      if (t.en) fx.en = t.en;
      if (t.desc) fx.desc = t.desc;
      rows.push([t.id, 'potential', t.name, t.emoji, '', t.cd == null ? '' : numStr(t.cd), '', t.flavor || '', JSON.stringify(fx), '']);
    });
    return rows;
  },
  rebuild(dataRows, header) {
    const get = rowGetter(header);
    const skillEntries = []; const unlockEntries = []; const potentials = [];
    dataRows.forEach(r => {
      const id = get(r, 'id').trim(); if (id === '') return;
      if (get(r, '系統分類').trim() === 'potential') {
        // 潛力 fx JSON → 依 js/skills.js 欄位順序組裝：id,name,[en],emoji,cat,type,[cd],base,per,[dmgType],[dur],mech,desc,flavor
        const fxRaw = get(r, '基礎fx(JSON)').trim();
        if (fxRaw === '') throw new Error('潛力列「' + id + '」缺基礎fx(JSON)——可能是舊格式（獨立欄位版）的 xlsx/CSV，請先重生表格再套用');
        const fx = parseJsonCell(fxRaw, id + ' 潛力fx');
        const o = { id: id, name: get(r, '名稱') };
        if (fx.en) o.en = String(fx.en);
        o.emoji = get(r, 'icon圖號'); o.cat = 'potential';
        o.type = fx.type || 'active';
        const cd = get(r, '冷卻'); if (String(cd).trim() !== '') o.cd = toNum(cd);
        o.base = toNum(fx.base == null ? '0' : fx.base);
        o.per = toNum(fx.per == null ? '0' : fx.per);
        if (fx.dmgType) o.dmgType = String(fx.dmgType);
        if (fx.dur != null) o.dur = toNum(fx.dur);
        o.mech = fx.mech == null ? '' : String(fx.mech);
        o.desc = fx.desc == null ? '' : String(fx.desc);
        const flavor = get(r, '說明文字'); if (flavor !== '') o.flavor = flavor;
        potentials.push(o);
        return;
      }
      const o = { name: get(r, '名稱'), emoji: get(r, 'icon圖號'), cat: get(r, '系統分類') };
      const cost = get(r, '施法消耗').trim(), cd = get(r, '冷卻').trim(), ai = get(r, '施放AI').trim();
      if (cost !== '') o.cost = toNum(cost);
      if (cd !== '') o.cd = toNum(cd);
      if (ai !== '') o.ai = ai;
      o.flavor = get(r, '說明文字');
      const fxRaw = get(r, '基礎fx(JSON)').trim();
      o.fx = fxRaw === '' ? {} : parseJsonCell(fxRaw, id + ' 基礎fx');
      skillEntries.push('  ' + id + ': ' + jsLit(o));
      const unRaw = get(r, '里程碑fx(JSON)').trim();
      if (unRaw !== '' && unRaw !== '{}') {
        const un = parseJsonCell(unRaw, id + ' 里程碑fx');
        unlockEntries.push('  ' + id + ': ' + jsLit(un));
      }
    });
    return {
      SKILLS: 'var SKILLS = {\n' + skillEntries.join(',\n') + '\n};',
      UNLOCKS: 'var UNLOCKS = {\n' + unlockEntries.join(',\n') + '\n};',
      POTENTIAL_TALENTS: 'var POTENTIAL_TALENTS = [\n' + potentials.map(o => '  ' + jsLit(o)).join(',\n') + '\n];'
    };
  }
};
function parseJsonCell(s, label) {
  try { return JSON.parse(s); }
  catch (e) { throw new Error(label + ' JSON 解析失敗：' + e.message + '\n  內容：' + s); }
}

const TABLE_ORDER = ['Skills', 'Gems', 'Talents', 'Equipment_Affix'];

/* ===========================================================================
   模式：--gen / --sync / --apply
   =========================================================================== */
function csvPathOf(name) { return path.join(CSV_DIR, name + '.csv'); }
function xlsxPathOf(name) { return path.join(XLSX_DIR, name + '.xlsx'); }

function cmdGen() {
  const srcMap = { data: readUtf8(JS.data), skills: readUtf8(JS.skills) };
  TABLE_ORDER.forEach(name => {
    const sc = SCHEMAS[name];
    const dataRows = sc.extract(srcMap[sc.jsFile]);
    const rows = [sc.header].concat(dataRows);
    writeUtf8(csvPathOf(name), csvStringify(rows));
    writeXlsx(xlsxPathOf(name), sc.sheet, rows, sc.extraSheets);
    console.log('  ✔ ' + name + '：' + dataRows.length + ' 列 → CSV + xlsx');
  });
  console.log('[gen] 已由 JS 產生四表。');
}

function cmdSync() {
  TABLE_ORDER.forEach(name => {
    const xp = xlsxPathOf(name);
    if (!fs.existsSync(xp)) { console.log('  – ' + name + '：無 xlsx，略過'); return; }
    let rows;
    try { rows = readXlsxRows(xp); }
    catch (e) { console.error('  ✗ ' + name + ' 讀取 xlsx 失敗（可能被 Excel 鎖定）：' + e.message); process.exit(2); }
    writeUtf8(csvPathOf(name), csvStringify(rows));
    console.log('  ✔ ' + name + '：xlsx → CSV（' + rows.length + ' 列）');
  });
  console.log('[sync] 已由 xlsx 轉出 CSV。');
}

function cmdApply() {
  const srcMap = { data: readUtf8(JS.data), skills: readUtf8(JS.skills) };
  const newSrc = { data: srcMap.data, skills: srcMap.skills };
  const changes = []; // {name, var, changed}
  let hadError = false;

  TABLE_ORDER.forEach(name => {
    const sc = SCHEMAS[name];
    const cp = csvPathOf(name);
    if (!fs.existsSync(cp)) { console.log('  – ' + name + '：無 CSV，略過'); return; }
    const allRows = csvParse(readUtf8(cp)).filter(r => r.length > 1 && r.some(c => String(c).trim() !== ''));
    if (!allRows.length) { console.log('  – ' + name + '：CSV 空，略過'); return; }
    const header = allRows[0];
    const dataRows = allRows.slice(1);
    let rebuilt;
    try { rebuilt = sc.rebuild(dataRows, header); }
    catch (e) { console.error('  ✗ ' + name + ' 重建失敗：' + e.message); hadError = true; return; }
    Object.keys(rebuilt).forEach(varName => {
      let loc;
      try { loc = extractLiteral(newSrc[sc.jsFile], varName); }
      catch (e) { console.error('  ✗ ' + name + '/' + varName + ' 定位失敗：' + e.message); hadError = true; return; }
      const newBlock = rebuilt[varName];
      // 語意比對：eval 舊/新字面值深度比較，數值/結構一致即視為無變更（僅格式差異不算）。
      // 僅在「語意有變更」時才就地替換該區塊，避免無編輯時仍反覆重排、抹掉手寫註解、產生無謂 diff。
      const oldVal = evalLiteral(loc.literal);
      const newVal = evalLiteral(extractLiteral(newBlock, varName).literal);
      const changed = !deepEqual(oldVal, newVal);
      if (changed) newSrc[sc.jsFile] = newSrc[sc.jsFile].slice(0, loc.declStart) + newBlock + newSrc[sc.jsFile].slice(loc.end);
      changes.push({ name, varName, changed, file: sc.jsFile });
    });
  });

  const changed = changes.filter(c => c.changed);
  console.log('=== config_tables apply ' + (WRITE ? '(--write)' : '(dry-run)') + ' ===');
  console.log('重建字面值 ' + changes.length + ' 個（語意變更 ' + changed.length + '）');
  changed.forEach(c => console.log('  • ' + c.name + ' / ' + c.varName + '（' + c.file + '.js）語意有變更'));

  if (hadError) { console.log('\n偵測到重建/定位問題，中止（未寫任何檔）。'); process.exit(2); }
  if (!WRITE) { console.log('\n這是試跑。加 --write 實際寫回 JS。'); return; }
  if (!changed.length) { console.log('\n無語意變更，未寫檔（CSV 與 JS 一致）。'); return; }

  // 寫入：備份 → 只覆蓋有變更的檔 → node --check → 失敗還原
  const touched = Array.from(new Set(changed.map(c => c.file)));
  const backups = {}; Object.keys(JS).forEach(f => { backups[f] = fs.readFileSync(JS[f], 'utf8'); });
  try {
    touched.forEach(f => fs.writeFileSync(JS[f], newSrc[f], 'utf8'));
    Object.keys(JS).forEach(f => execFileSync(process.execPath, ['--check', JS[f]]));
    try { fs.writeFileSync(path.join(ROOT, 'params_version.txt'), String(pseudoStamp())); } catch (e) {}
    console.log('\n✔ 已寫回 JS 並通過語法檢查。遊戲頁面將自動重新整理。');
  } catch (err) {
    Object.keys(JS).forEach(f => fs.writeFileSync(JS[f], backups[f], 'utf8'));
    console.log('\n✗ 寫入後驗證失敗，已還原所有 JS。錯誤：' + err.message);
    process.exit(1);
  }
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) { if (!Object.prototype.hasOwnProperty.call(b, k)) return false; if (!deepEqual(a[k], b[k])) return false; }
    return true;
  }
  return false;
}
function pseudoStamp() {
  // params_version.txt 只需在每次寫入時「變動」即可觸發本機自動重載；用檔案內容自增避免依賴 Date.now
  try { const cur = Number(fs.readFileSync(path.join(ROOT, 'params_version.txt'), 'utf8').trim()) || 0; return cur + 1; }
  catch (e) { return 1; }
}

/* ---- 進入點 ---- */
const mode = process.argv.includes('--gen') ? 'gen'
  : process.argv.includes('--sync') ? 'sync'
  : process.argv.includes('--apply') ? 'apply' : '';
if (mode === 'gen') cmdGen();
else if (mode === 'sync') cmdSync();
else if (mode === 'apply') cmdApply();
else {
  console.log('用法：node tools/config_tables.cjs [--gen | --sync | --apply [--write]]');
  process.exit(1);
}
