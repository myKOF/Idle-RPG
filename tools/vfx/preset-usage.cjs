'use strict';
/* ============================================================
   preset-usage.cjs — 「這個 Preset 被用在遊戲的哪裡」

   VFX Editor 的 Preset 下拉靠它在 id 後面標出用途，挑 preset 時一眼就看得出
   哪些已經上場、哪些還是孤兒。同一份計算也被測試拿去驗人工清單有沒有過期。

   用途來源有兩個，缺一不可：

     1. 配置表（自動掃描）
        config/CSV/{Skills,Skills2,Status}.csv 的特效欄位。只要任一欄填了某個
        preset id，那一列的技能／狀態就算在用它。掃 CSV 而不是掃產生出來的
        js/data.js 與 js/skills2.js：表才是設計師實際在編的東西，而且欄位名稱
        就寫在表頭上，對不上時錯誤訊息指得到人看得懂的地方。

     2. docs/vfx/VFX_PRESET_USAGE_OUTSIDE_TABLES.md（人工維護）
        普攻、天罰、敵方出手這類不屬於任何一列技能的固定對應，寫死在
        js/data.js 的 VFX_COMBAT_DEFAULTS，沒有表格欄位可填。

   為什麼第二項不用 grep js/ 自動產生：「程式碼裡出現這個字串」不等於「遊戲裡
   真的用到」——id 也會出現在註解、測試、除錯開關裡。要判斷一個 preset 是不是
   孤兒，需要的是人確認過的語意。人工清單會過期，所以由
   tests/vfx-preset-usage.test.cjs 三面夾住（見那份文件的說明）。
   ============================================================ */

const fs = require('fs');
const path = require('path');

/* 掃描順序＝「第一個用到它的技能」的定義。一個 preset 被多處使用時只顯示第一個，
   所以順序必須是固定且寫得出來的，不能靠目錄列舉的偶然。 */
/* nameColumn 是「真正用到這個特效的那一個東西」的名字。Skills2 一列＝一個
   階段，而特效是填在階段上的，所以要取階段名稱而不是群組名稱：水龍捲是
   水流彈的第 7 階，標成「水流彈」會指到一個根本沒用這個特效的階段。
   groupColumn 只是拿來補上下文——「傷害強化」「擴散」這種階段名稱在很多
   群組裡都有，單看它認不出是誰的。 */
const TABLES = [
  { file: 'config/CSV/Skills.csv', nameColumn: '名稱', keyColumn: 'id', label: '技能' },
  {
    file: 'config/CSV/Skills2.csv', nameColumn: '階段名稱',
    groupColumn: '群組名稱', keyColumn: '群組ID', label: '技能群組'
  },
  { file: 'config/CSV/Status.csv', nameColumn: '狀態名稱', keyColumn: '狀態ID', label: '狀態' }
];
/* 技能表六欄與狀態表三欄。兩張技能表欄位相同，所以只列一份，找不到的欄位跳過。 */
const VFX_COLUMNS = ['施放特效', '攻擊特效', '飛行子彈', '受擊特效', '地板特效',
  '持續場域特效', '施加特效', '持續特效', '作用特效'];

const OUTSIDE_DOC_REL = 'docs/vfx/VFX_PRESET_USAGE_OUTSIDE_TABLES.md';
const PRESETS_DIR_REL = 'vfx/presets';
const JS_DIR_REL = 'js';

/* CSV 解析：與 tools/config_tables.cjs 同一套規則（引號、跳脫、BOM）。
   不 require 那一支——它一被載入就會去讀 Excel 並可能寫檔，而這裡只要讀。 */
function csvParse(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let field = '', row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* CRLF：交給 \n 收尾 */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* 表頭可能是「欄位名\n（說明）」的多行儲存格，取第一行比對。 */
function headerIndex(header, name) {
  return header.findIndex(function (h) {
    return String(h).split('\n')[0].trim() === name;
  });
}

/* 一格可以填多個 id（分號分隔，與 config_tables 的 splitList 同一套）。 */
function cellIds(value) {
  return String(value == null ? '' : value)
    .split(';').map(function (s) { return s.trim(); }).filter(Boolean);
}

/* presetId → [{ table, kind, name }]，依 TABLES 的順序、每張表由上而下。 */
function scanTables(repoRoot) {
  const out = Object.create(null);
  TABLES.forEach(function (t) {
    const file = path.join(repoRoot, t.file);
    if (!fs.existsSync(file)) return;          // 表不存在＝這一類還沒建，不是錯誤
    const rows = csvParse(fs.readFileSync(file, 'utf8'));
    if (!rows.length) return;
    const header = rows[0];
    const nameAt = headerIndex(header, t.nameColumn);
    const keyAt = headerIndex(header, t.keyColumn);
    const groupAt = t.groupColumn ? headerIndex(header, t.groupColumn) : -1;
    const cols = VFX_COLUMNS
      .map(function (c) { return { at: headerIndex(header, c), column: c }; })
      .filter(function (c) { return c.at >= 0; });

    /* 名字不一定填在用到特效的那一列上（Skills2 的群組名稱只填第一列，
       後面的階段列是空的）。先掃一次建 主鍵 → 名字，第二遍才補得回來——
       否則那些 preset 會被當成「有人用但叫不出名字」而整個漏掉。 */
    const nameByKey = Object.create(null);
    const groupByKey = Object.create(null);
    if (keyAt >= 0) {
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || !row.length) continue;
        const key = String(row[keyAt] || '').trim();
        if (!key) continue;
        const nm = nameAt >= 0 ? String(row[nameAt] || '').trim() : '';
        if (nm && !nameByKey[key]) nameByKey[key] = nm;
        const gp = groupAt >= 0 ? String(row[groupAt] || '').trim() : '';
        if (gp && !groupByKey[key]) groupByKey[key] = gp;
      }
    }

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row.length) continue;
      const key = keyAt >= 0 ? String(row[keyAt] || '').trim() : '';
      const name = (nameAt >= 0 ? String(row[nameAt] || '').trim() : '') ||
        (key ? (nameByKey[key] || '') : '');
      const group = (groupAt >= 0 ? String(row[groupAt] || '').trim() : '') ||
        (key ? (groupByKey[key] || '') : '');
      cols.forEach(function (c) {
        cellIds(row[c.at]).forEach(function (id) {
          (out[id] = out[id] || []).push({
            table: t.file, kind: t.label, name: name, group: group
          });
        });
      });
    }
  });
  return out;
}

/* 人工清單。解析的是 Markdown 表格——文件本身就是那份資料，另外再擺一份 JSON
   只會兩邊分家。格式規定寫在那份文件裡，這裡的解析要跟著它。 */
const OUTSIDE_ROW_RE = /^\|\s*`([a-z0-9][a-z0-9-]*)`\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/;

function readOutsideTables(repoRoot) {
  const file = path.join(repoRoot, OUTSIDE_DOC_REL);
  if (!fs.existsSync(file)) return [];
  const out = [];
  fs.readFileSync(file, 'utf8').split('\n').forEach(function (line) {
    const m = OUTSIDE_ROW_RE.exec(line.trim());
    if (m) out.push({ id: m[1], label: m[2].trim(), where: m[3].trim() });
  });
  return out;
}

function presetIds(repoRoot) {
  const dir = path.join(repoRoot, PRESETS_DIR_REL);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(function (f) { return f.slice(-5) === '.json'; })
    .map(function (f) { return f.slice(0, -5); })
    .sort();
}

/* presetId → [檔名]，只看 js/ 底下被當成字串常數引用的。
   這是給測試用的粗篩，不是用途判定——判定靠人工清單，理由見檔頭。 */
function presetIdsInJs(repoRoot) {
  const dir = path.join(repoRoot, JS_DIR_REL);
  const out = Object.create(null);
  if (!fs.existsSync(dir)) return out;
  const files = fs.readdirSync(dir).filter(function (f) { return f.slice(-3) === '.js'; });
  const sources = files.map(function (f) {
    return { file: f, text: fs.readFileSync(path.join(dir, f), 'utf8') };
  });
  presetIds(repoRoot).forEach(function (id) {
    /* 前後要有引號：避免 'hit-fire' 被 'hit-fire-explosion' 這一行誤判成有引用。 */
    const re = new RegExp('[\'"]' + id.replace(/[-]/g, '\\-') + '[\'"]');
    const hits = sources.filter(function (s) { return re.test(s.text); })
      .map(function (s) { return s.file; });
    if (hits.length) out[id] = hits;
  });
  return out;
}

/* presetId → { label, source }。沒被用到的 preset 不會出現在結果裡——
   下拉上「沒有括號」就代表這一份目前是孤兒，那個空白本身是資訊。 */
function usageLabels(repoRoot) {
  const tables = scanTables(repoRoot);
  const outside = readOutsideTables(repoRoot);
  const known = Object.create(null);
  presetIds(repoRoot).forEach(function (id) { known[id] = true; });

  const out = Object.create(null);
  /* 表優先：技能名稱比「普攻」這種泛稱具體，而且是設計師自己取的。 */
  /* 階段名稱與群組名稱不同時，兩個都顯示：「傷害強化」「擴散」這類階段名稱
     在很多群組裡都有，單看認不出是誰的；而只寫群組名稱又會指到一個根本
     沒用這個特效的階段（水龍捲是水流彈的第 7 階）。 */
  function rowLabel(r) {
    return (r.group && r.group !== r.name) ? r.group + '·' + r.name : r.name;
  }

  Object.keys(tables).forEach(function (id) {
    if (!known[id]) return;                    // 表上填了不存在的 preset，交給別的檢查報

    /* 用到同一份 preset 的全部都要看得到，不是只看第一個：改一份共用的 preset
       會同時動到那些技能，只顯示第一個的話那個影響範圍是隱形的。

       但「全部逐階列出」撐不下——hit-wind 有 15 個階段，接起來 119 個字，
       而且同一個群組名會重複六七次。所以按群組收攏，再按「這個群組用到幾階」
       決定寫多細：

         只用到一階，而且階段名與群組名不同 → 寫到階段（水龍捲是水流彈的第 7 階，
                                              只寫「水流彈」會指到沒用這個特效的階段）
         用到多階                          → 只寫群組名，逐階的細節留給 tooltip

       精確度花在有差別的地方，不是每一列都攤開。 */
    const order = [];
    const stagesByGroup = Object.create(null);
    const seenAll = Object.create(null);
    const all = [];
    tables[id].forEach(function (r) {
      if (!r.name) return;
      const full = rowLabel(r);
      if (!seenAll[full]) { seenAll[full] = true; all.push(full); }
      const key = r.group || r.name;
      if (!stagesByGroup[key]) { stagesByGroup[key] = []; order.push(key); }
      if (stagesByGroup[key].indexOf(r.name) < 0) stagesByGroup[key].push(r.name);
    });
    if (!all.length) return;

    const labels = order.map(function (group) {
      const stages = stagesByGroup[group];
      return (stages.length === 1 && stages[0] !== group)
        ? group + '·' + stages[0]
        : group;
    });
    out[id] = { label: labels[0], labels: labels, all: all, source: 'table', count: all.length };
  });
  outside.forEach(function (row) {
    if (!known[row.id] || out[row.id]) return;
    out[row.id] = {
      label: row.label, labels: [row.label], all: [row.label], source: 'outside', count: 1
    };
  });
  return out;
}

module.exports = {
  TABLES: TABLES,
  VFX_COLUMNS: VFX_COLUMNS,
  OUTSIDE_DOC_REL: OUTSIDE_DOC_REL,
  csvParse: csvParse,
  scanTables: scanTables,
  readOutsideTables: readOutsideTables,
  presetIds: presetIds,
  presetIdsInJs: presetIdsInJs,
  usageLabels: usageLabels
};
