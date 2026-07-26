'use strict';
/* =============================================================================
   xlsx_to_csv.cjs — 把 config/Excel/game_parameters.xlsx 轉成 config/CSV/game_parameters.csv
   -----------------------------------------------------------------------------
   用途：讓你在 Excel 高效調整數值，套用時自動把 xlsx 轉回系統讀取用的 CSV。
   輸出：UTF-8 帶 BOM、CRLF、RFC-4180 引號規則，與原本的 game_parameters.csv 完全同格式。
   特點：純 Node（用內建 zlib 解 xlsx 的 ZIP），不需安裝任何套件；
        直接讀 xlsx 位元組，「Excel 開著」也能轉（不需先關 Excel）。
   目標工作表：以「名稱」= game_parameters 定位（非位置），找不到才退回第一張表。

   用法：
     node tools/xlsx_to_csv.cjs           # 轉換並覆蓋 config/CSV/game_parameters.csv
   環境變數（測試用）：
     PARAMS_XLSX     來源 xlsx 路徑（預設 config/Excel/game_parameters.xlsx）
     PARAMS_CSV_OUT  輸出 csv 路徑（預設 config/CSV/game_parameters.csv）
   ============================================================================= */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const XLSX = process.env.PARAMS_XLSX || path.join(ROOT, 'config', 'Excel', 'game_parameters.xlsx');
const OUT = process.env.PARAMS_CSV_OUT || path.join(ROOT, 'config', 'CSV', 'game_parameters.csv');
const SHEET_NAME = 'game_parameters';

/* ---------- 讀 xlsx（ZIP local file header 逐一解壓） ---------- */
function readZipEntries(buf) {
  const entries = {};
  let i = 0;
  while (i + 4 <= buf.length) {
    const sig = buf.readUInt32LE(i);
    if (sig !== 0x04034b50) break; // 只走 local file header；遇到 central directory 就停
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.toString('utf8', i + 30, i + 30 + nameLen);
    const dataStart = i + 30 + nameLen + extraLen;
    const raw = buf.slice(dataStart, dataStart + compSize);
    entries[name] = method === 8 ? zlib.inflateRawSync(raw) : raw; // 8=deflate、0=store
    i = dataStart + compSize;
  }
  return entries;
}

/* ---------- 命名空間正規化：<x:sheet>/<x:row>… → <sheet>/<row>…
   某些工具（OpenXML SDK 系）存的 xlsx 元素帶前綴，Excel 本身則不帶；
   統一剝掉「元素名」的前綴後再解析（屬性如 xml:space、r:id 不受影響）。 ---------- */
function stripNsPrefix(xml) {
  return xml.replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1');
}

/* ---------- XML 實體解碼（&amp; 最後解，避免二次解碼） ---------- */
function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

/* ---------- 數字清理：走一趟 Number 用最短往返表示，洗掉 Excel 的滿精度雜訊 ----------
   例：5.0000000000000001E-2 -> 0.05；30 -> 30；1.05 -> 1.05                              */
function cleanNum(s) {
  const n = Number(s);
  if (!isFinite(n)) return s;
  let out = String(n);
  if (out.indexOf('e') >= 0 || out.indexOf('E') >= 0) {
    out = n.toFixed(12).replace(/\.?0+$/, ''); // 遊戲參數範圍內避免科學記號
  }
  return out;
}

/* ---------- A1 欄名 -> 0 起始欄索引 ---------- */
function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref);
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* ---------- 解析 sharedStrings：每個 <si> 內所有 <t> 串接 ---------- */
function parseSharedStrings(xml) {
  if (!xml) return [];
  xml = stripNsPrefix(xml);
  const out = [];
  xml.replace(/<si>([\s\S]*?)<\/si>/g, (m, inner) => {
    let t = '';
    inner.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (mm, x) => { t += x; return ''; });
    out.push(decodeXml(t));
    return '';
  });
  return out;
}

/* ---------- 解析工作表 XML -> 二維儲存格陣列（保留型別與公式，供跨表鏡像回填） ---------- */
function parseSheetCells(xml, shared) {
  xml = stripNsPrefix(xml);
  const rows = [];
  xml.replace(/<row\b([^>]*)>([\s\S]*?)<\/row>/g, (m, rowAttr, inner) => {
    // 尊重列號 r=（缺列的 xlsx 才不會整段上移）；沒有 r 就接續排
    const rm = /\br="(\d+)"/.exec(rowAttr);
    const rowIdx = rm ? parseInt(rm[1], 10) - 1 : rows.length;
    while (rows.length < rowIdx) rows.push([]);
    const cells = [];
    // 先剝掉自閉合空儲存格 <c r="B98" s="5" />（無值），避免配對式匹配把它與下一格黏在一起
    inner = inner.replace(/<c\b[^>]*\/>/g, '');
    // 一般儲存格：<c r="A1" t="s"> ... </c>（屬性順序不限）
    inner.replace(/<c\b([^>]*)>([\s\S]*?)<\/c>/g, (mm, attr, body) => {
      const refM = /\br="([A-Z]+\d+)"/.exec(attr);
      if (!refM) return '';
      const tm = /t="([^"]+)"/.exec(attr);
      const t = tm ? tm[1] : '';
      const fm = /<f[^>]*>([\s\S]*?)<\/f>/.exec(body);
      let val = '';
      const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
      if (t === 's') {
        if (vm) val = shared[parseInt(vm[1], 10)] || '';
      } else if (t === 'inlineStr') {
        let s = '';
        body.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (x, y) => { s += y; return ''; });
        val = decodeXml(s);
      } else if (t === 'str') {
        if (vm) val = decodeXml(vm[1]); // 公式回傳字串
      } else if (t === 'e') {
        if (vm) val = vm[1]; // 錯誤快取（如 #NAME?），後續嘗試由公式參照回填
      } else {
        if (vm) val = cleanNum(vm[1]); // 數字（含公式的快取數值）
      }
      cells[colIndex(refM[1])] = { t: t, v: val, f: fm ? decodeXml(fm[1]) : null };
      return '';
    });
    rows[rowIdx] = cells;
    return '';
  });
  // 填補跳號留下的空洞，維持二維陣列完整
  for (let r = 0; r < rows.length; r++) if (!rows[r]) rows[r] = [];
  return rows;
}

/* ---------- 儲存格取值：錯誤快取＋單純跨表參照（=計算表!A2）時，改讀參照目標 ----------
   背景：主表為「同列鏡像」——每格都是 =計算表!同座標 的公式。若 xlsx 由不會算公式的
   工具寫出（快取被蓋成 #NAME? 等錯誤值），改為直接追蹤參照去計算表取值。
   Excel 參照空儲存格會得 0，這裡沿用同一語意以維持 CSV 輸出一致。 */
const SIMPLE_REF = /^(?:'([^']+)'|([^!']+))!\$?([A-Z]+)\$?(\d+)$/;
function cellOut(grids, cell, depth) {
  if (!cell) return '';
  if (cell.t === 'e' && cell.f && (depth || 0) < 4) {
    const m = SIMPLE_REF.exec(cell.f.trim());
    if (m) {
      const grid = grids[m[1] || m[2]];
      if (grid) {
        const target = (grid[parseInt(m[4], 10) - 1] || [])[colIndex(m[3] + '1')];
        const v = cellOut(grids, target, (depth || 0) + 1);
        return v === '' ? '0' : v; // Excel 語意：參照空儲存格 → 0
      }
    }
  }
  return cell.v;
}

/* ---------- 找目標工作表檔名（以名稱定位） ---------- */
function resolveSheetPath(entries) {
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
    const name = decodeXml((/name="([^"]*)"/.exec(tag) || [])[1] || '');
    const rid = (/r:id="([^"]+)"/.exec(tag) || [])[1] || '';
    sheets.push({ name, rid });
    return '';
  });
  let chosen = sheets.find(s => s.name === SHEET_NAME) || sheets[0];
  if (!chosen) throw new Error('xlsx 內找不到任何工作表');
  const all = [];
  for (const s of sheets) {
    let target = relMap[s.rid];
    if (!target) { if (s === chosen) throw new Error('找不到工作表 ' + s.name + ' 的關聯檔'); continue; }
    target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    all.push({ path: 'xl/' + target, name: s.name });
  }
  return { path: all.find(s => s.name === chosen.name).path, name: chosen.name, all };
}

/* ---------- CSV 欄位引號（RFC-4180） ---------- */
function csvField(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ---------- 主流程 ---------- */
function main() {
  if (!fs.existsSync(XLSX)) {
    console.error('[xlsx_to_csv] 找不到來源檔：' + XLSX);
    process.exit(2);
  }
  let buf;
  try {
    buf = fs.readFileSync(XLSX);
  } catch (e) {
    console.error('[xlsx_to_csv] 無法讀取 xlsx（可能被 Excel 鎖定）。請在 Excel 中存檔後再試。\n  ' + e.message);
    process.exit(2);
  }
  const entries = readZipEntries(buf);
  const shared = parseSharedStrings(entries['xl/sharedStrings.xml'] ? entries['xl/sharedStrings.xml'].toString('utf8') : '');
  const info = resolveSheetPath(entries);
  const sheetBuf = entries[info.path];
  if (!sheetBuf) throw new Error('xlsx 內缺少工作表檔：' + info.path);
  // 解析全部工作表為儲存格網格：主表鏡像公式的錯誤快取可回填參照目標（計算表）的值
  const grids = {};
  for (const s of info.all) {
    if (entries[s.path]) grids[s.name] = parseSheetCells(entries[s.path].toString('utf8'), shared);
  }
  const cellGrid = grids[info.name];
  let resolved = 0, unresolved = 0;
  const rows = cellGrid.map(r => r.map(cell => {
    if (cell && cell.t === 'e') {
      const v = cellOut(grids, cell, 0);
      if (v !== cell.v) resolved++; else unresolved++;
      return v;
    }
    return cell ? cell.v : '';
  }));
  if (resolved) console.log('[xlsx_to_csv] 主表 ' + resolved + ' 格為鏡像公式錯誤快取，已由參照目標工作表回填數值。');
  if (unresolved) console.warn('[xlsx_to_csv] ⚠ ' + unresolved + ' 格錯誤快取無法回填（非單純跨表參照），將原樣輸出錯誤值。');

  // 欄寬：至少對齊表頭欄數，含所有實際內容欄
  let width = 0;
  rows.forEach(r => { if (r.length > width) width = r.length; });
  const headerLen = rows.length ? rows[0].length : 18;
  if (headerLen > width) width = headerLen;
  if (width < 18) width = 18; // 6 基本欄（編號/變動/系統分類/名稱/參數化公式/中文說明）+ 參數 a..l

  // 去掉尾端整列全空的列
  while (rows.length && rows[rows.length - 1].every(c => c == null || c === '')) rows.pop();

  const lines = rows.map(r => {
    const out = [];
    for (let c = 0; c < width; c++) out.push(csvField(r[c] == null ? '' : r[c]));
    return out.join(',');
  });
  const csv = '﻿' + lines.join('\r\n') + '\r\n';

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, csv, 'utf8');
  console.log('[xlsx_to_csv] 已轉換工作表「' + info.name + '」→ ' + path.relative(ROOT, OUT) +
    '（' + rows.length + ' 列 × ' + width + ' 欄）');
}

main();
