'use strict';
/* =============================================================================
   config_tables.cjs — 六系統（技能/寶石/天賦/裝備詞條/NPC/任務）配置撥離管線
   -----------------------------------------------------------------------------
   將 js/skills.js、js/data.js 與 js/status.js 中的內容資料表撥離成獨立、可用 Excel 編輯的
   xlsx + CSV；並能把編輯後的表單「回寫」進遊戲 JS（雙向）。

   模式：
     node tools/config_tables.cjs --gen              # 由現有 JS 產生四份 CSV + xlsx（bootstrap / 重新產生）
     node tools/config_tables.cjs --sync             # 由 xlsx 轉出 CSV（供 .bat：讀使用者編輯後的 xlsx）
     node tools/config_tables.cjs --apply            # 試跑：由 CSV 重建 JS 字面值，只報告不寫檔
     node tools/config_tables.cjs --apply --write    # 實際寫回 JS（先備份、寫入後 node --check、失敗還原）

   七表 ↔ JS 字面值：
     Skills            ← SKILLS + UNLOCKS（js/skills.js）
     Status            ← STATUS（js/status.js，2026-08-11 技能及狀態改造）
     Gems              ← GEM_TYPES（js/data.js）
     Talents           ← TALENT_TREES + POTENTIAL_TALENTS（js/data.js）
     Equipment_Affix   ← AFFIX_POOL + PASSIVE_POOL + GODFORGE_POOL（js/data.js）
     NPC               ← 各地圖 NPC pool（js/data.js）
     Task              ← TASKS（js/data.js，2026-08-05 任務系統）

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
  skills: path.join(ROOT, 'js', 'skills.js'),
  status: path.join(ROOT, 'js', 'status.js')
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
   六表 schema：extract(把 JS 值攤平成 rows) / rebuild(rows 重建字面值文字)
   每個 schema：{ name, jsFile, sheet, header, extract(vals)->dataRows, rebuild(dataRows)->{var:newText} }
   dataRows 不含表頭；rows() 皆以表頭名稱定位欄位（容忍使用者調欄序）。
   =========================================================================== */
function rowGetter(header) {
  // 標題格允許「第一行=欄名、換行後=中文說明」；欄位對應一律取第一行。
  const idx = {}; header.forEach((h, i) => { idx[String(h).split('\n')[0].trim()] = i; });
  return (row, name) => { const i = idx[name]; return i == null ? '' : (row[i] == null ? '' : String(row[i])); };
}

const SCHEMAS = {};

/* ---- NPC ← 各地圖 NPC pool ----
   NPC.csv 只管理 NPC 基本資料；hpMult／atkMult／defMult／aspdMult 等戰鬥倍率
   仍保留在 js/data.js，不讓「表格沒有的欄位」在套用時被清掉。
   外觀欄沿用既有 NPC.csv 語意：舊地圖填 emoji，亡靈山脈等有獨立外觀 key 的
   NPC 填 appearance key；套用時依既有物件是否有 appearance 欄位判斷寫回位置。 */
const NPC_POOL_DEFS = [
  { zone: 'desert', varName: 'DESERT_POOL' },
  { zone: 'Icefield', varName: 'ICEFIELD_POOL' },
  { zone: 'swamp', varName: 'SWAMP_POOL' },
  { zone: 'undead_mountains', varName: 'UNDEAD_MOUNTAINS_POOL' },
  { zone: 'god_battlefield', varName: 'GOD_BATTLEFIELD_POOL' },
  { zone: 'god_chaos', varName: 'GOD_CHAOS_POOL' },
  { zone: 'god_sanctuary', varName: 'GOD_SANCTUARY_POOL' }
];

SCHEMAS.NPC = {
  name: 'NPC', jsFile: 'data', sheet: 'NPC', vars: NPC_POOL_DEFS.map(d => d.varName),
  header: ['NPC識別碼', 'NPC名稱', '所屬地圖識別碼', '屬性', '外觀', '魔法型（1是／0否）', '出現權重'],
  extract(src) {
    const rows = [];
    NPC_POOL_DEFS.forEach(def => {
      const pool = evalLiteral(extractLiteral(src, def.varName).literal);
      pool.forEach((entry, index) => {
        const id = entry.id || (def.zone + '_' + (index + 1));
        rows.push([id, entry.name, def.zone, entry.attr || '', entry.appearance || entry.emoji || '',
          entry.magic ? '1' : '0', numStr(entry.weight == null ? 1 : entry.weight)]);
      });
    });
    return rows;
  },
  rebuild(dataRows, header, existingSrc) {
    if (!existingSrc) throw new Error('NPC 套用缺少 js/data.js 原始內容');
    const get = rowGetter(header);
    const rowsByZone = {};
    const oldById = {};
    const defByZone = {};
    NPC_POOL_DEFS.forEach(def => {
      rowsByZone[def.zone] = [];
      defByZone[def.zone] = def;
      const pool = evalLiteral(extractLiteral(existingSrc, def.varName).literal);
      pool.forEach((entry, index) => {
        const id = entry.id || (def.zone + '_' + (index + 1));
        oldById[id] = entry;
      });
    });
    dataRows.forEach((row, index) => {
      const id = get(row, 'NPC識別碼').trim();
      if (id === '') return;
      const zone = get(row, '所屬地圖識別碼').trim();
      if (!defByZone[zone]) throw new Error('NPC 第 ' + (index + 2) + ' 列的地圖識別碼不存在：' + zone);
      const old = oldById[id];
      const o = old ? Object.assign({}, old) : {};
      o.id = id;
      o.name = get(row, 'NPC名稱');
      const attr = get(row, '屬性').trim();
      if (attr) o.attr = attr; else delete o.attr;
      const visual = get(row, '外觀');
      if (old && Object.prototype.hasOwnProperty.call(old, 'appearance')) {
        o.appearance = visual;
        if (!o.emoji) o.emoji = visual;
      } else {
        o.emoji = visual;
        delete o.appearance;
      }
      o.magic = toBool(get(row, '魔法型（1是／0否）'));
      o.weight = toNum(get(row, '出現權重'));
      rowsByZone[zone].push(o);
    });
    return NPC_POOL_DEFS.reduce((out, def) => {
      if (!rowsByZone[def.zone].length) throw new Error('NPC 缺少地圖資料：' + def.zone);
      out[def.varName] = 'var ' + def.varName + ' = [\n' +
        rowsByZone[def.zone].map(o => '  ' + jsLit(o)).join(',\n') + '\n];';
      return out;
    }, {});
  }
};

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

/* ---- Equipment_Affix ← AFFIX_POOL + PASSIVE_POOL + GODFORGE_POOL + SCORE_WEIGHTS ----
   戰力權重（SCORE_WEIGHTS）不佔獨立列：以「戰力權重」欄放在對應詞條列上
   （2026-07-23 自主參數表「表-戰力權重」撥離；經使用者確認採欄位制避免重覆列）。
   空白＝未列入 SCORE_WEIGHTS，戰力評分以 1 計。 */
SCHEMAS.Equipment_Affix = {
  name: 'Equipment_Affix', jsFile: 'data', sheet: 'Equipment_Affix', vars: ['AFFIX_POOL', 'PASSIVE_POOL', 'GODFORGE_POOL', 'SCORE_WEIGHTS'],
  // 「出現部位」欄表頭帶多行中文說明（rowGetter 取第一行對應欄名，其餘為給使用者看的註解）
  header: ['池', 'id', '名稱', '基礎值', '成長基礎值', '每級成長', '百分比', '權重', '戰力權重', '最低稀有度',
    '出現部位\n空白＝不限（全部部位）\nweapon＝主／副武器；helmet＝頭盔\nshoulder＝肩甲；chest＝胸甲；belt＝腰帶\ngloves＝護手；wrist＝手腕；legs＝護腿\nboots＝靴子；ring＝戒指 I／II；amulet＝項鍊\nall_lock＝全鎖定（不會出現在任何裝備部位上，也不會出現在屬性面板）\n多部位用 ; 分隔，例如 ring;amulet＝戒指與項鍊',
    '每階perR', '屬性桶stats', '說明', '效果類型', '關聯技能', '觸發技能', '限定武器類型', '效果參數JSON'],
  extract(src) {
    const AFFIX_POOL = evalLiteral(extractLiteral(src, 'AFFIX_POOL').literal);
    const PASSIVE_POOL = evalLiteral(extractLiteral(src, 'PASSIVE_POOL').literal);
    const GODFORGE_POOL = evalLiteral(extractLiteral(src, 'GODFORGE_POOL').literal);
    const SCORE_WEIGHTS = evalLiteral(extractLiteral(src, 'SCORE_WEIGHTS').literal);
    const rows = [];
    Object.keys(AFFIX_POOL).forEach(id => {
      const a = AFFIX_POOL[id];
      rows.push(['詞條池', id, a.name, numStr(a.base), numStr(a.growthBase), numStr(a.lv), boolCell(!!a.pct), numStr(a.weight),
        SCORE_WEIGHTS[id] == null ? '' : numStr(SCORE_WEIGHTS[id]),
        a.minR == null ? '' : numStr(a.minR), a.slots ? joinList(a.slots) : '', '', '', '', '', '', '', '']);
    });
    // 防呆：SCORE_WEIGHTS 若出現「非詞條 id」的鍵（目前沒有），仍需落表以免 round-trip 遺失
    Object.keys(SCORE_WEIGHTS).forEach(id => {
      if (!AFFIX_POOL[id]) rows.push(['戰力權重', id, id, '', '', '', '', '', numStr(SCORE_WEIGHTS[id]), '', '', '', '非詞條屬性的戰力權重（僅寶石等來源）。', '', '', '', '', '']);
    });
    Object.keys(PASSIVE_POOL).forEach(id => {
      const p = PASSIVE_POOL[id];
      rows.push(['傳奇特效', id, p.name, numStr(p.base), '', '', '', '', '', '', '', numStr(p.perR), '', p.desc,
        p.type || '', p.relatedSkill || '', p.triggerSkill || '',
        p.weaponTypes ? joinList(p.weaponTypes) : '', p.fx ? JSON.stringify(p.fx) : '']);
    });
    Object.keys(GODFORGE_POOL).forEach(id => {
      const g = GODFORGE_POOL[id];
      rows.push(['神鑄特效', id, g.name, numStr(g.base), '', '', '', '', '', '', '', '', g.stats ? joinList(g.stats) : '', g.desc, '', '', '', '', '']);
    });
    return rows;
  },
  rebuild(dataRows, header) {
    const get = rowGetter(header);
    const affix = [], passive = [], god = [], weights = [];
    dataRows.forEach(r => {
      const pool = get(r, '池').trim(); const id = get(r, 'id').trim();
      if (id === '') return;
      if (pool === '詞條池') {
        const growthBase = get(r, '成長基礎值').trim();
        const o = { name: get(r, '名稱'), base: toNum(get(r, '基礎值')),
          growthBase: growthBase === '' ? toNum(get(r, '基礎值')) : toNum(growthBase),
          lv: toNum(get(r, '每級成長')), pct: toBool(get(r, '百分比')), weight: toNum(get(r, '權重')) };
        if (get(r, '最低稀有度').trim() !== '') o.minR = toNum(get(r, '最低稀有度'));
        const slots = splitList(get(r, '出現部位')); if (slots.length) o.slots = slots;
        affix.push('  ' + id + ': ' + jsLit(o));
        // 「戰力權重」欄：空白＝不列入 SCORE_WEIGHTS（評分以 1 計）
        if (get(r, '戰力權重').trim() !== '') weights.push('  ' + id + ': ' + numStr(toNum(get(r, '戰力權重'))));
      } else if (pool === '傳奇特效') {
        const o = { name: get(r, '名稱'), desc: get(r, '說明'), base: toNum(get(r, '基礎值')), perR: toNum(get(r, '每階perR')) };
        const effectType = get(r, '效果類型').trim();
        const relatedSkill = get(r, '關聯技能').trim();
        const triggerSkill = get(r, '觸發技能').trim();
        const weaponTypes = splitList(get(r, '限定武器類型'));
        const fxText = get(r, '效果參數JSON').trim();
        if (effectType || relatedSkill || triggerSkill || weaponTypes.length || fxText) o.legendary = true;
        if (effectType) o.type = effectType;
        if (relatedSkill) o.relatedSkill = relatedSkill;
        if (triggerSkill) o.triggerSkill = triggerSkill;
        if (weaponTypes.length) o.weaponTypes = weaponTypes;
        if (fxText) o.fx = parseJsonCell(fxText, 'Equipment_Affix ' + id);
        passive.push('  ' + id + ': ' + jsLit(o));
      } else if (pool === '神鑄特效') {
        const o = { name: get(r, '名稱'), desc: get(r, '說明'), base: toNum(get(r, '基礎值')) };
        const stats = splitList(get(r, '屬性桶stats')); if (stats.length) o.stats = stats;
        god.push('  ' + id + ': ' + jsLit(o));
      } else if (pool === '戰力權重') {
        // 防呆列：非詞條 id 的權重（值在「戰力權重」欄）
        if (get(r, '戰力權重').trim() !== '') weights.push('  ' + id + ': ' + numStr(toNum(get(r, '戰力權重'))));
      }
    });
    return {
      AFFIX_POOL: 'var AFFIX_POOL = {\n' + affix.join(',\n') + '\n};',
      PASSIVE_POOL: 'var PASSIVE_POOL = {\n' + passive.join(',\n') + '\n};',
      GODFORGE_POOL: 'var GODFORGE_POOL = {\n' + god.join(',\n') + '\n};',
      SCORE_WEIGHTS: 'var SCORE_WEIGHTS = {\n' + weights.join(',\n') + '\n};'
    };
  }
};

/* ---- Skills ← SKILLS + UNLOCKS ---- */
/* Skills.xlsx 第 2 工作表「變量定義」：基礎/里程碑 fx 全部變量的中文定義（一行一個變量；僅供人閱讀，sync/apply 只讀第 1 表）。 */
/* 標籤欄供值：以 JS 內 SKILLS/POTENTIAL_TALENTS 的 tags 陣列為唯一準據（SSOT＝js/skills.js；
   §3.5 定案後初版種子 fallback 已移除）；讀表方向（--apply）仍由 rebuild 解析「標籤」欄回寫 tags。 */
function skillTagsForConfig(s) {
  return Array.isArray(s.tags) ? s.tags : [];
}
const INITIAL_SKILL_UNLOCK_LEVELS = {
  powerSlash: 1,
  arcaneBurst: 1
};
function skillUnlockLevelForConfig(s, id) {
  if (s && s.unlockLv != null && isFinite(Number(s.unlockLv))) return Math.max(0, Math.floor(Number(s.unlockLv)));
  if (s && s.cat === 'potential') return 0;
  return INITIAL_SKILL_UNLOCK_LEVELS[id] || 5;
}
const FX_GLOSSARY_ROWS = [
  ['標籤'],
  ['用途：技能的元素系別標籤；「系統分類」仍表示物理/魔法/防禦與治療/特殊/被動等技能大類，兩者分開管理；'],
  ['格式：使用元素鍵值，若有多個標籤以半形分號「;」分隔（例：fire;poison）；空白＝此技能沒有元素系別標籤；'],
  ['fire＝火系：火焰、燃燒、熾熱等元素特性；'],
  ['ice＝冰系：冰霜、寒冰、凍結、減速等元素特性；'],
  ['lightning＝雷系：雷電、閃電、雷鳴等元素特性；'],
  ['poison＝毒系：毒素、劇毒、疫病、腐蝕、蝕骨等元素特性；'],
  ['light＝聖系：聖光、神聖、治癒、奧術等聖屬特性；本版初始將所有奧術技能歸入聖系；'],
  ['dark＝暗系：暗影、黑暗、虛空、詛咒等元素特性；'],
  ['注意：標籤欄同時決定「技能打出的傷害屬性」（2026-07-26 技能屬性化）：帶標籤的傷害技能，整段傷害皆為該屬性；'],
  ['　　　物攻/魔攻只是加成基礎，最終結算會套用該屬性抗性、屬性傷害提升%、對屬性敵人加成與該屬性的元素特效；'],
  ['　　　多個標籤時以第一個為傷害屬性，其餘僅作顯示分類；空白＝不屬性化，維持純物理/純魔法；'],
  ['解鎖等級'],
  ['用途：決定角色達到哪個人物等級後可學習此技能；達到門檻時會寫入玩家存檔，之後永久解鎖；'],
  ['格式：填寫非負整數人物等級；0 或空白＝不追加人物等級限制（潛力技能仍由原本的潛力節點規則控制）；'],
  ['初始測試值：powerSlash、arcaneBurst＝1；其他一般技能＝5；潛力技能＝0；可直接在 Skills 表調整；'],
  ['注意：此欄只控制人物等級解鎖，不會取代技能點、潛力節點或融合技生成條件；'],
  [''],
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
  ['傷害屬性由「標籤」欄決定，fx 內不再填 elem 元素占比（舊 elem={type,portion} 已廢除）；'],
  ['elems={元素:權重,…}=融合技多屬性權重(合計1)，傷害依權重拆成各屬性分別結算；'],
  ['elemOverride=強制改屬性(特規用，例：傳奇【死亡領域】期間所有技能轉毒屬性)，優先於標籤與 elems；'],
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
  ['key種類：atkUp=攻擊/defUp=防禦/aspdUp=攻速/evasionUp=閃避/critDmgUp=爆傷/lootUp=掉寶/thornsUp=反震/blockUp=格擋/hot=再生/penUp=物理與魔法穿透/atkDown=降敵攻/defDown=降敵防；'],
  ['注意：2026-07-30 起技能不再使用 defDown（降敵防）；原有降防技改為 buff penUp（增加自身物理與魔法穿透%）；'],
  ['　　　defDown 僅為舊存檔融合技快照的相容保留，新設計請勿再填；'],
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
  ['atkBase=本體攻擊傷害%基準(雷霆過載：魔攻%)；'],
  ['atkPer=每級本體攻擊傷害%增量；'],
  ['bounces=本體攻擊彈跳次數(每跳完整傷害)；'],
  ['dur=增益持續秒；'],
  ['dmgType=傷害類型(phys=物理/magic=魔法)；'],
  ['mech=戰鬥機制代號(接線鍵勿改)；'],
  ['en=英文名；'],
  ['desc=質變說明(面板顯示的完整敘述)；'],
  [''],
  ['傷害範圍'],
  ['空白＝單體(1*1)，一次只打 1 個敵人；'],
  ['A*B＝直向 A 格 × 橫向 B 格，以主目標為準取該大小的方框，框內敵人全部命中；'],
  ['　例：3*3 方框、2*2 方框、1*3 由左往右貫穿的直線、3*1 擋在面前的橫牆；'],
  ['all＝全體：對敵方 4×4 棋盤內所有敵人造成傷害；'],
  ['主目標的挑法與普攻相同（最近優先、同距離隨機、鎖定不換）；'],
  ['佔多格的單位(BOSS)被範圍蓋到時仍只算命中 1 次；'],
  ['額外觸發的傷害(引爆／濺射／連鎖)不受此欄影響，也不算進單體/群體判定；'],
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
  header: ['id', '系統分類', '標籤', '解鎖等級', '名稱', 'icon圖號', '施法消耗', '冷卻', '施放AI', '傷害範圍', '說明文字', '基礎fx(JSON)', '里程碑fx(JSON)'],
  extract(src) {
    const SKILLS = evalLiteral(extractLiteral(src, 'SKILLS').literal);
    const UNLOCKS = evalLiteral(extractLiteral(src, 'UNLOCKS').literal);
    const POTENTIAL_TALENTS = evalLiteral(extractLiteral(src, 'POTENTIAL_TALENTS').literal);
    const rows = Object.keys(SKILLS).map(id => {
      const s = SKILLS[id];
      const un = UNLOCKS[id];
        return [id, s.cat, joinList(skillTagsForConfig(s, id)), skillUnlockLevelForConfig(s, id), s.name, s.emoji,
        s.cost == null ? '' : numStr(s.cost), s.cd == null ? '' : numStr(s.cd),
        s.ai || '', s.shape || '', s.flavor || '', JSON.stringify(s.fx), un ? JSON.stringify(un) : ''];
    });
    // 潛力技能 V3（系統分類=potential；列順序＝解鎖順序）：與一般技能同格式——
    // 共用欄放 名稱/icon/冷卻/說明文字(風味)，其餘機制參數（type/base/per/dur/dmgType/mech/en/desc）收進「基礎fx(JSON)」。
    POTENTIAL_TALENTS.forEach(t => {
      const fx = { type: t.type || 'active', base: t.base == null ? 0 : t.base, per: t.per == null ? 0 : t.per };
      if (t.atkBase != null) fx.atkBase = t.atkBase;
      if (t.atkPer != null) fx.atkPer = t.atkPer;
      if (t.bounces != null) fx.bounces = t.bounces;
      if (t.dur != null) fx.dur = t.dur;
      if (t.dmgType) fx.dmgType = t.dmgType;
      fx.mech = t.mech || '';
      if (t.en) fx.en = t.en;
      if (t.desc) fx.desc = t.desc;
       rows.push([t.id, 'potential', joinList(skillTagsForConfig(t)), skillUnlockLevelForConfig(t, t.id), t.name, t.emoji, '', t.cd == null ? '' : numStr(t.cd), '', t.shape || '', t.flavor || '', JSON.stringify(fx), '']);
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
         const unlockLvRaw = get(r, '解鎖等級').trim();
         const o = { id: id, name: get(r, '名稱'), tags: splitList(get(r, '標籤')), unlockLv: unlockLvRaw === '' ? 0 : Math.max(0, Math.floor(toNum(unlockLvRaw))) };
        if (fx.en) o.en = String(fx.en);
        o.emoji = get(r, 'icon圖號'); o.cat = 'potential';
        o.type = fx.type || 'active';
        const cd = get(r, '冷卻'); if (String(cd).trim() !== '') o.cd = toNum(cd);
        o.base = toNum(fx.base == null ? '0' : fx.base);
        o.per = toNum(fx.per == null ? '0' : fx.per);
        if (fx.atkBase != null) o.atkBase = toNum(fx.atkBase);
        if (fx.atkPer != null) o.atkPer = toNum(fx.atkPer);
        if (fx.bounces != null) o.bounces = toNum(fx.bounces);
        if (fx.dmgType) o.dmgType = String(fx.dmgType);
        if (fx.dur != null) o.dur = toNum(fx.dur);
        o.mech = fx.mech == null ? '' : String(fx.mech);
        o.desc = fx.desc == null ? '' : String(fx.desc);
        const pShape = get(r, '傷害範圍').trim();
        if (pShape !== '') o.shape = pShape;
        const flavor = get(r, '說明文字'); if (flavor !== '') o.flavor = flavor;
        potentials.push(o);
        return;
      }
       const unlockLvRaw = get(r, '解鎖等級').trim();
       const o = { name: get(r, '名稱'), emoji: get(r, 'icon圖號'), cat: get(r, '系統分類'), tags: splitList(get(r, '標籤')), unlockLv: unlockLvRaw === '' ? 0 : Math.max(0, Math.floor(toNum(unlockLvRaw))) };
      const cost = get(r, '施法消耗').trim(), cd = get(r, '冷卻').trim(), ai = get(r, '施放AI').trim();
      if (cost !== '') o.cost = toNum(cost);
      if (cd !== '') o.cd = toNum(cd);
      if (ai !== '') o.ai = ai;
      // 傷害範圍：空白＝單體（1x1）；可填 2x2／3x3／all（全場）。解析 → js/battlefield.js bfParseShape
      const shape = get(r, '傷害範圍').trim();
      if (shape !== '') o.shape = shape;
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

/* ---- Task 表的「參數定義」說明頁（xlsx 第二頁；程式不讀取，僅供編表者查閱）----
   與 Skills 的「變量定義」同慣例：內容登錄在此，--gen 重生表格時一併寫出。
   同步流程只讀第一頁（readXlsxRows 取第一張表），本頁不影響管線。 */
const TASK_GLOSSARY_ROWS = [
  ['任務表（Task）欄位與參數定義'],
  ['本頁為說明頁，程式不讀取；第一頁「Task」才是資料來源。改完存檔（Ctrl+S）後雙擊「套用參數.bat」套用，本機開著的遊戲約 2 秒自動重載。'],
  [''],
  ['── 各欄位 ──'],
  ['順序：任務編號（1 起）。玩家依此順序逐一領取，只有當前任務可領。⚠️ 鑰匙欄：請勿變動既有列的順序值，改了會被當成新任務。'],
  ['任務說明：遊戲內顯示的任務名稱（戰鬥區快捷列與任務總覽）。'],
  ['目標類型：進度怎麼計算，見下方「目標類型」清單。'],
  ['目標參數：搭配目標類型的附加參數；多個值用直線「|」分隔，格式見各類型說明。'],
  ['目標數量：達成門檻；進度 ≥ 此值即可領取。'],
  ['獎勵類型：發什麼獎，見下方「獎勵類型」清單。'],
  ['獎勵參數：搭配獎勵類型的附加參數，格式見各類型說明。'],
  ['獎勵數量：發放數量。'],
  ['獎勵顯示：遊戲內顯示的獎勵文字。⚠️ 程式是照「獎勵類型/參數/數量」發獎，此欄只負責顯示——改數值時記得同步改這裡，否則玩家看到的和實拿的會不一致。'],
  ['備註：純說明欄，給編表的人看，不會進遊戲（也不寫回程式）。'],
  [''],
  ['── 目標類型（與目標參數格式） ──'],
  ['equipSlots＝身上部位數：計算身上滿足條件的部位數（共 13 部位；雙手武器視同佔用主手＋副手兩格）。'],
  ['　　目標參數＝最低品質|最低等級。例：0|0＝任意裝備、2|0＝稀有(含)以上、4|50＝史詩(含)以上且裝備等級 50(含)以上。品質索引見下方對照表。'],
  ['upgradeCount＝累計強化成功次數（失敗不計）。目標參數留空。'],
  ['rerollCount＝累計洗煉次數（整件洗與單條洗各計 1 次）。目標參數留空。'],
  ['enchantCount＝累計附魔成功次數（被拒不計）。目標參數留空。'],
  ['composeCount＝累計寶石合成次數（「全部合成」一次合 N 組計 N）。目標參數留空。'],
  ['socketCount＝身上目前同時鑲嵌的寶石數（拔下即減，重複拔裝不累加）。目標參數留空。'],
  ['forgeParts＝所有熔爐目前已裝配的零件總數（卸下即減）。目標參數留空。'],
  ['forgePartLevel＝目前等級最高的熔爐零件是幾級（任一種零件達 N 級即可；零件等級是全域的，卸下不影響）。目標參數留空。'],
  ['ancientCount＝身上裝備的太古詞條（帶✡星）總數。目標參數留空。'],
  ['maxHp＝生命最大值（屬性面板數值；掉回門檻以下進度也會掉）。目標參數留空。'],
  ['stageClear＝通關指定地圖第 N 關（N＝目標數量）。目標參數＝地圖識別碼，見下方對照表。可以指定該地圖的最後一關。'],
  ['towerFloor＝高塔已通關的最高層數（N＝目標數量）。目標參數留空；層數與塔別無關（試煉/地獄/煉獄同一條層數軸）。'],
  ['skillLevel＝指定技能達到 N 級（N＝目標數量；1＝學會）。目標參數＝技能 id（查 Skills 表第一欄）。'],
  [''],
  ['── 獎勵類型（與獎勵參數格式） ──'],
  ['gold＝金幣、scrap＝裝備碎片、essence＝附魔精華：獎勵參數留空；獎勵數量＝發放量。'],
  ['skillXp＝技能熟練度經驗：獎勵參數留空；獎勵數量＝經驗值。'],
  ['gem＝寶石（種類隨機）：獎勵參數＝寶石等級 1~5；獎勵數量＝顆數（每顆種類各自隨機）。'],
  ['book＝附魔書：獎勵參數＝附魔書 id（見下方對照表）；獎勵數量＝本數。'],
  ['equip＝裝備：獎勵參數＝品質|等級|太古數；獎勵數量＝件數。'],
  ['　　品質＝品質索引（見下方對照表）；'],
  ['　　等級＝裝備等級；填 0＝依玩家當前關卡自動決定（裝備等級以 50 關為一階：1~49 關為 1 級裝、50~99 關為 50 級裝…）；'],
  ['　　太古數＝固定太古詞條條數；整段留空＝依一般掉落規則自然擲骰。例：3|1＝獨特 1 級（太古自然擲骰）、4|50|2＝史詩 50 級固定 2 條太古。'],
  [''],
  ['── 品質索引對照 ──'],
  ['0＝普通、1＝精良、2＝稀有、3＝獨特、4＝史詩、5＝傳說、6＝神話、7＝創世、8＝神鑄創世、9＝混沌、10＝神鑄混沌'],
  [''],
  ['── 地圖識別碼對照 ──'],
  ['desert＝荒漠、Icefield＝冰原、swamp＝沼澤、undead_mountains＝亡靈山脈、god_battlefield＝太古戰場、god_chaos＝混沌界、god_sanctuary＝永恒神域'],
  [''],
  ['── 附魔書 id 對照 ──'],
  ['fire＝火焰附魔、ice＝冰凍附魔、lightning＝閃電附魔、poison＝毒液附魔、light＝聖光附魔、dark＝暗影附魔'],
  ['fireRes＝火焰抗性、iceRes＝冰霜抗性、lightningRes＝雷電抗性、poisonRes＝劇毒抗性、lightRes＝聖光抗性、darkRes＝暗影抗性、ctrlRes＝控制抵抗'],
  ['loot＝尋寶附魔、haste＝疾行附魔、vigor＝活力附魔、clarity＝澄明附魔、focus＝專注附魔、fortune＝財運附魔、wisdom＝智慧附魔'],
  [''],
  ['── 新增／修改任務注意 ──'],
  ['1. 任務嚴格照「順序」逐一領取；新增任務請接在最後一列、給新的順序值。'],
  ['2. 玩家存檔只記「已領到第幾個」，刪除或重排既有任務會讓舊玩家的進度指到錯的任務；上線後請避免刪列與重排，要停用就把該任務改成極易達成的內容。'],
  ['3. 累計型（強化/洗煉/附魔/合成）跨任務共用同一個計數：例「強化10次」與「強化20次」共用，前者完成時後者即為 10/20。'],
  ['4. 品質/等級門檻是「以上皆可」：稀有任務穿史詩也算。'],
  ['5. 改完別忘了同步「獎勵顯示」欄的文字。']
];

/* ---- Task ← TASKS（js/data.js）主線任務表（2026-08-05 任務系統） ----
   目標類型：equipSlots（參數=最低品質|最低等級）/ upgradeCount / rerollCount /
   enchantCount / composeCount / socketCount / forgeParts / forgePartLevel /
   ancientCount / maxHp / stageClear（參數=地圖識別碼）/ towerFloor /
   skillLevel（參數=技能id）。
   獎勵類型：gold / scrap / essence / skillXp / gem（參數=寶石等級）/
   book（參數=附魔書id）/ equip（參數=品質|等級|太古數；等級 0=依當前關卡、太古空白=自然擲骰）。
   「備註」欄為純說明欄，不寫回 JS（同 Skills 表的「完整描述」欄）。
   第二頁「參數定義」＝ TASK_GLOSSARY_ROWS（說明頁，程式不讀取）。 */
SCHEMAS.Task = {
  name: 'Task', jsFile: 'data', sheet: 'Task', vars: ['TASKS'],
  extraSheets: [{ name: '參數定義', rows: TASK_GLOSSARY_ROWS }],
  header: ['順序', '任務說明', '目標類型', '目標參數', '目標數量', '獎勵類型', '獎勵參數', '獎勵數量', '獎勵顯示'],
  extract(src) {
    const TASKS = evalLiteral(extractLiteral(src, 'TASKS').literal);
    return TASKS.map(t => [numStr(t.order), t.name, t.type, t.param || '', numStr(t.count),
      t.rewardType, t.rewardParam || '', numStr(t.rewardQty), t.rewardLabel || '']);
  },
  rebuild(dataRows, header) {
    const get = rowGetter(header);
    const entries = dataRows.filter(r => get(r, '順序').trim() !== '').map(r => {
      const o = { order: Math.floor(toNum(get(r, '順序'))), name: get(r, '任務說明'), type: get(r, '目標類型').trim() };
      const param = get(r, '目標參數').trim(); if (param !== '') o.param = param;
      o.count = toNum(get(r, '目標數量'));
      o.rewardType = get(r, '獎勵類型').trim();
      const rp = get(r, '獎勵參數').trim(); if (rp !== '') o.rewardParam = rp;
      o.rewardQty = toNum(get(r, '獎勵數量'));
      o.rewardLabel = get(r, '獎勵顯示');
      if (o.type === '') throw new Error('任務 ' + o.order + ' 缺目標類型');
      if (o.rewardType === '') throw new Error('任務 ' + o.order + ' 缺獎勵類型');
      return '  ' + jsLit(o);
    });
    return { TASKS: 'var TASKS = [\n' + entries.join(',\n') + '\n];' };
  }
};

/* ---- Status ← STATUS（js/status.js）狀態表（2026-08-11 技能及狀態改造） ----
   技能＝一次性效果、狀態＝有持續時間的效果。本表是全遊戲狀態的唯一定義來源：
   持續傷害、持續回復、控場、增益／減益的名稱、圖標、數值、持續時間與作用間隔都在這裡調。
   技能引用狀態時可覆寫「狀態傷害」與「持續時間」（保留各技能與里程碑的成長曲線），
   其餘欄位一律以本表為準。第二頁「欄位定義」＝ STATUS_GLOSSARY_ROWS（說明頁，程式不讀取）。 */
const STATUS_EFFECT_KINDS = ['dot', 'hot', 'stat', 'ctrl'];
const STATUS_GLOSSARY_ROWS = [
  ['狀態ID'],
  ['用途：狀態的唯一識別碼，技能的「基礎fx(JSON)」以 status 陣列用這個 ID 引用；'],
  ['注意：這是鑰匙欄，改了會被當成新狀態，已引用它的技能會找不到狀態；'],
  [''],
  ['狀態名稱 / 狀態圖標'],
  ['用途：戰鬥日誌、敵我狀態列與技能說明文字顯示用；程式端不再有第二份對照表，改這裡就會全部一起改；'],
  [''],
  ['狀態分類'],
  ['buff＝增益（我方有利）；debuff＝減益（負面）；ctrl＝控場（限制行動）；'],
  ['用途：決定 UI 配色，以及「淨化」會清掉哪些狀態（只清 debuff 與 ctrl）；'],
  [''],
  ['狀態效果'],
  ['dot＝持續傷害（每次作用扣血）；'],
  ['hot＝持續回復（每秒回復最大生命%）；'],
  ['stat＝屬性增減（攻擊、防禦、閃避…）；'],
  ['ctrl＝行動限制（暈眩、減速、無敵）；'],
  [''],
  ['效果鍵值'],
  ['狀態效果＝stat 時填增益鍵：atkUp/defUp/aspdUp/evasionUp/critDmgUp/blockUp/thornsUp/lootUp/penUp/atkDown/defDown/enemyAspdDown 等；'],
  ['狀態效果＝ctrl 時填 stun（暈眩）/slow（減速）/invuln（無敵）；'],
  ['狀態效果＝hot 時固定填 hot；dot 留空；'],
  ['注意：這是接線鍵，對應戰鬥程式讀取的欄位，不要自行改名；'],
  [''],
  ['傷害屬性'],
  ['fire＝火／ice＝冰／lightning＝雷／poison＝毒／light＝聖／dark＝暗；空白＝無屬性；'],
  ['用途：持續傷害的屬性歸屬（顯示與分類用）；'],
  [''],
  ['傷害來源'],
  ['skill＝占「施放當下的技能傷害」百分比（燃燒、流血、中毒…）；'],
  ['maxHp＝占「目標最大生命」百分比（死亡詛咒）；'],
  ['value＝直接數值（不經百分比換算）；'],
  [''],
  ['狀態傷害'],
  ['每次作用的量，依「傷害來源」解讀（skill/maxHp 填百分比數字，value 填數值）；'],
  ['狀態效果＝hot 時＝每秒回復的最大生命%；stat／ctrl 不使用本欄；'],
  ['技能可在自己的 fx 覆寫本欄（例：火球術的燃燒 20%、隕石術的燃燒 30%）；'],
  [''],
  ['傷害上限參照 / 傷害上限倍率'],
  ['上限＝施法者的該項屬性 × 倍率（例：matk 與 6 ＝ 魔攻 ×6）；參照欄留空＝無上限；'],
  ['用途：避免「占最大生命%」型的持續傷害在高血量敵人身上暴衝；'],
  [''],
  ['效果數值'],
  ['狀態效果＝stat 時的增減幅度%（例：攻擊提升 15 ＝ 攻擊力 +15%）；dot／hot／ctrl 不使用；'],
  ['技能可在自己的 fx 覆寫本欄；'],
  [''],
  ['持續時間'],
  ['狀態生效的秒數；技能可在自己的 fx 覆寫（保留里程碑成長）；'],
  ['注意：控場類（暈眩、減速）的實際秒數還會再乘上控場遞減與目標韌性；'],
  [''],
  ['作用間隔時間'],
  ['持續傷害每隔幾秒結算一次（例：1 ＝ 每秒跳一次傷害）；'],
  ['0＝不分段，改為連續結算（每一幀依比例扣血）；stat／ctrl 類填 0；'],
  ['注意：狀態到期時會把不足一次間隔的餘額補跳，所以「總傷害＝狀態傷害×(持續時間÷作用間隔)」恆成立，'],
  ['　　　調整作用間隔只改變跳傷的節奏，不改變總量；'],
  [''],
  ['疊加規則 / 最大疊層'],
  ['refresh＝重新計時（後蓋前）；strongest＝取高並重新計時（目前持續傷害採用）；stack＝疊層；'],
  ['最大疊層＝疊加規則為 stack 時的上限，其餘填 1；'],
  [''],
  ['── 新增狀態注意 ──'],
  ['1. 新增一列即可新增狀態；要讓技能用到它，還要在 Skills 表該技能的「基礎fx(JSON)」加 status 引用，'],
  ['   例：{"dmgType":"magic","stat":"matk","base":300,"per":60,"status":[{"id":"burn"}]}；'],
  ['2. status 陣列可帶 dmg／dur／val 覆寫本表預設值，例 {"id":"burn","dmg":35,"dur":5}；不帶就吃本表的值；'],
  ['3. 狀態效果＝stat／ctrl 的「效果鍵值」必須是程式認得的鍵，不能自創；dot／hot 則可自由新增。']
];

SCHEMAS.Status = {
  name: 'Status', jsFile: 'status', sheet: 'Status', vars: ['STATUS'],
  extraSheets: [{ name: '欄位定義', rows: STATUS_GLOSSARY_ROWS }],
  header: ['狀態ID', '狀態名稱', '狀態圖標', '狀態分類', '狀態效果', '效果鍵值', '傷害屬性', '傷害來源',
    '狀態傷害', '傷害上限參照', '傷害上限倍率', '效果數值', '持續時間', '作用間隔時間', '疊加規則', '最大疊層', '說明'],
  extract(src) {
    const STATUS = evalLiteral(extractLiteral(src, 'STATUS').literal);
    return Object.keys(STATUS).map(id => {
      const s = STATUS[id];
      return [id, s.name, s.icon, s.kind, s.effect, s.key || '', s.elem || '', s.dmgSource || '',
        numStr(s.dmg || 0), s.capStat || '', numStr(s.capMult || 0), numStr(s.val || 0),
        numStr(s.dur || 0), numStr(s.interval || 0), s.stack || 'refresh', numStr(s.maxStacks || 1), s.desc || ''];
    });
  },
  rebuild(dataRows, header) {
    const get = rowGetter(header);
    const entries = dataRows.filter(r => get(r, '狀態ID').trim() !== '').map(r => {
      const id = get(r, '狀態ID').trim();
      const effect = get(r, '狀態效果').trim();
      const key = get(r, '效果鍵值').trim();
      if (STATUS_EFFECT_KINDS.indexOf(effect) < 0) {
        throw new Error('狀態「' + id + '」的狀態效果必須是 ' + STATUS_EFFECT_KINDS.join('/') + '，目前是「' + effect + '」');
      }
      if ((effect === 'stat' || effect === 'ctrl' || effect === 'hot') && key === '') {
        throw new Error('狀態「' + id + '」的狀態效果是 ' + effect + '，必須填「效果鍵值」');
      }
      const o = {
        name: get(r, '狀態名稱'), icon: get(r, '狀態圖標'),
        kind: get(r, '狀態分類').trim() || 'debuff', effect: effect, key: key,
        elem: get(r, '傷害屬性').trim(), dmgSource: get(r, '傷害來源').trim(),
        dmg: toNum(get(r, '狀態傷害').trim() || '0'),
        capStat: get(r, '傷害上限參照').trim(), capMult: toNum(get(r, '傷害上限倍率').trim() || '0'),
        val: toNum(get(r, '效果數值').trim() || '0'),
        dur: toNum(get(r, '持續時間').trim() || '0'),
        interval: toNum(get(r, '作用間隔時間').trim() || '0'),
        stack: get(r, '疊加規則').trim() || 'refresh',
        maxStacks: toNum(get(r, '最大疊層').trim() || '1'),
        desc: get(r, '說明')
      };
      return '  ' + id + ': ' + jsLit(o);
    });
    if (!entries.length) throw new Error('Status 表沒有任何狀態列');
    return { STATUS: 'var STATUS = {\n' + entries.join(',\n') + '\n};' };
  }
};

const TABLE_ORDER = ['Skills', 'Status', 'Gems', 'Talents', 'Equipment_Affix', 'NPC', 'Task'];

/* ===========================================================================
   模式：--gen / --sync / --apply
   =========================================================================== */
function csvPathOf(name) { return path.join(CSV_DIR, name + '.csv'); }
function xlsxPathOf(name) { return path.join(XLSX_DIR, name + '.xlsx'); }

function cmdGen(only) {
  const srcMap = { data: readUtf8(JS.data), skills: readUtf8(JS.skills), status: readUtf8(JS.status) };
  TABLE_ORDER.forEach(name => {
    if (only && name !== only) return; // --gen <表名>：只重生指定表，不動其他表
    const sc = SCHEMAS[name];
    const dataRows = sc.extract(srcMap[sc.jsFile]);
    const rows = [sc.header].concat(dataRows);
    writeUtf8(csvPathOf(name), csvStringify(rows));
    writeXlsx(xlsxPathOf(name), sc.sheet, rows, sc.extraSheets);
    console.log('  ✔ ' + name + '：' + dataRows.length + ' 列 → CSV + xlsx');
  });
  console.log('[gen] 已由 JS 產生' + (only ? '「' + only + '」表' : '七表') + '。');
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

function cmdApply(only) {
  const srcMap = { data: readUtf8(JS.data), skills: readUtf8(JS.skills), status: readUtf8(JS.status) };
  const newSrc = { data: srcMap.data, skills: srcMap.skills, status: srcMap.status };
  const changes = []; // {name, var, changed}
  let hadError = false;

  TABLE_ORDER.forEach(name => {
    if (only && name !== only) return;
    const sc = SCHEMAS[name];
    const cp = csvPathOf(name);
    if (!fs.existsSync(cp)) { console.log('  – ' + name + '：無 CSV，略過'); return; }
    const allRows = csvParse(readUtf8(cp)).filter(r => r.length > 1 && r.some(c => String(c).trim() !== ''));
    if (!allRows.length) { console.log('  – ' + name + '：CSV 空，略過'); return; }
    const header = allRows[0];
    const dataRows = allRows.slice(1);
    let rebuilt;
    try { rebuilt = sc.rebuild(dataRows, header, srcMap[sc.jsFile]); }
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
const only = process.argv.find(a => TABLE_ORDER.includes(a));
if (mode === 'gen') cmdGen(only);
else if (mode === 'sync') cmdSync();
else if (mode === 'apply') cmdApply(only);
else {
  console.log('用法：node tools/config_tables.cjs [--gen | --sync | --apply [--write]] [Skills|Status|Gems|Talents|Equipment_Affix|NPC|Task]');
  process.exit(1);
}
