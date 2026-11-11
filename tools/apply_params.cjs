'use strict';
/* =============================================================================
   apply_params.cjs — 把 game_parameters.csv 的數值回寫進 js/data.js 與 js/formula.js
   -----------------------------------------------------------------------------
   用法：
     node tools/apply_params.cjs            # 試跑（dry-run）：只列出將變更的項目，不寫檔
     node tools/apply_params.cjs --write    # 實際寫入（會先備份，寫入後以 node --check 驗證，失敗自動還原）

   原理：每個參數用「唯一錨點」定位程式中的數字後就地取代；資料表陣列則整段重建。
   安全：錨點若匹配 0 次或 >1 次一律中止（不猜）；--write 前備份、寫入後語法檢查，失敗還原。
   涵蓋：data.js 全部具名常數與資料表 + formula.js 具名常數與內嵌算式係數（玩家屬性派生、
         屬性上限、戰鬥核心、高塔 BOSS 倍率、稀有度擲骰、強化/洗煉/寶石/技能費用等），共 495 個參數。
        未涵蓋：combat.js 的怪物固定值、少數以分數寫死（與 CSV 百分比單位不同）的係數、公式結構本身。
   ============================================================================= */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
// 預設讀 config/CSV/game_parameters.csv（由 config/Excel/game_parameters.xlsx 轉出）；
// 可用環境變數 PARAMS_CSV 指定其他路徑（測試用）。
const CSV_PATH = process.env.PARAMS_CSV || path.join(ROOT, 'config', 'CSV', 'game_parameters.csv');
const FILES = {
  data: path.join(ROOT, 'js', 'data.js'), formula: path.join(ROOT, 'js', 'formula.js'),
  combat: path.join(ROOT, 'js', 'combat.js'), item: path.join(ROOT, 'js', 'item.js'),
  player: path.join(ROOT, 'js', 'player.js'),
  save: path.join(ROOT, 'js', 'save.js'), renderer: path.join(ROOT, 'js', 'battle-renderer.js')
};
const WRITE = process.argv.includes('--write');

/* ---------- CSV 解析（RFC4180、去 BOM） ---------- */
function parseCsv(text) {
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
const parameterRows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8')).filter(r => r.length > 1);
const STORE_CSV_PATH = process.env.STORE_CSV || path.join(ROOT, 'config', 'CSV', 'Store.csv');
const storeRows = parseCsv(fs.readFileSync(STORE_CSV_PATH, 'utf8')).filter(r => r.length > 1);
if (JSON.stringify(parameterRows[0]) !== JSON.stringify(storeRows[0].slice(0, parameterRows[0].length))) throw new Error('Store.csv 基本表頭必須與 game_parameters.csv 相同');
if (parameterRows.slice(1).some(r => /^8-(?:寶石商店|寶店刷出|商人)/.test(r[2]))) throw new Error('商人參數只能存在 Store.csv');
const allRows = parameterRows.concat(storeRows.slice(1));
// 地圖專屬資料由獨立地圖表管理；game_parameters 只保留通用公式與計算參數。
const ZONES_CSV_PATH = process.env.ZONES_CSV || path.join(ROOT, 'config', 'CSV', 'Zones.csv');
const zoneRows = parseCsv(fs.readFileSync(ZONES_CSV_PATH, 'utf8')).filter(r => r.length > 1);
const zoneHeader = zoneRows[0] || [];
const zoneIdCol = zoneHeader.indexOf('地圖識別碼');
if (zoneIdCol < 0) throw new Error('Zones.csv 表頭缺少「地圖識別碼」：' + JSON.stringify(zoneHeader));
const zoneById = {};
zoneRows.slice(1).forEach(r => { zoneById[r[zoneIdCol]] = r; });
function ZP(zoneKey, field) {
  const col = zoneHeader.indexOf(field);
  const row = zoneById[zoneKey];
  if (col < 0 || !row || row[col] === undefined || row[col] === '') {
    throw new Error('Zones.csv 缺少欄位或資料：' + zoneKey + ' / ' + field);
  }
  return String(row[col]).trim();
}
// 地圖／關卡掉落由獨立表管理；這裡只負責把該表投影到 data.js。
const ZONE_STAGE_DROPS_CSV_PATH = process.env.ZONE_STAGE_DROPS_CSV || path.join(ROOT, 'config', 'CSV', 'Zone_Stage_Drops.csv');
const zoneStageDropRows = parseCsv(fs.readFileSync(ZONE_STAGE_DROPS_CSV_PATH, 'utf8')).filter(r => r.length > 1);
const zoneStageDropHeader = zoneStageDropRows[0] || [];
const ZD = (name) => {
  const col = zoneStageDropHeader.indexOf(name);
  if (col < 0) throw new Error('Zone_Stage_Drops.csv 表頭缺少「' + name + '」：' + JSON.stringify(zoneStageDropHeader));
  return col;
};
const ZD_ZONE = ZD('地圖識別碼');
const ZD_MIN = ZD('最低關卡');
const ZD_MAX = ZD('最高關卡');
const ZD_EQUIP = ZD('裝備掉落率（品質R0至R11）');
const ZD_GEMS = ZD('寶石掉落率（等級R1至R10）');
const ZD_BOOK = ZD('技能書掉落率');
const ZD_ESSENCE = ZD('太古精華掉落率');
const ZD_DIVINE_STONE = ZD('神性之石掉落率');
function dropNumber(raw, label) {
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) throw new Error('Zone_Stage_Drops.csv 數值無法解析：' + label + ' / ' + raw);
  return n;
}
function dropRateList(raw, expected, label) {
  const values = String(raw).split('|').map((v, i) => dropNumber(v, label + '[' + i + ']'));
  if (values.length !== expected) throw new Error('Zone_Stage_Drops.csv 欄位數量錯誤：' + label + '（需要 ' + expected + '，實際 ' + values.length + '）');
  return values;
}
function zoneStageDropContent() {
  const grouped = {};
  zoneStageDropRows.slice(1).forEach((r, i) => {
    const zone = String(r[ZD_ZONE] || '').trim();
    if (!zone) throw new Error('Zone_Stage_Drops.csv 第 ' + (i + 2) + ' 列缺少地圖識別碼');
    const row = [
      dropNumber(r[ZD_MIN], zone + '.最低關卡'),
      dropNumber(r[ZD_MAX], zone + '.最高關卡'),
      dropRateList(r[ZD_EQUIP], 12, zone + '.裝備掉落率'),
      dropRateList(r[ZD_GEMS], 10, zone + '.寶石掉落率'),
      dropNumber(r[ZD_BOOK], zone + '.技能書掉落率'),
      dropNumber(r[ZD_ESSENCE], zone + '.太古精華掉落率'),
      dropNumber(r[ZD_DIVINE_STONE], zone + '.神性之石掉落率')
    ];
    (grouped[zone] || (grouped[zone] = [])).push(row);
  });
  const expectedZones = Object.keys(zoneById);
  expectedZones.forEach(zone => {
    if (!grouped[zone] || !grouped[zone].length) throw new Error('Zone_Stage_Drops.csv 缺少地圖：' + zone);
    grouped[zone].sort((a, b) => a[0] - b[0]);
    let coveredThrough = 0;
    for (const row of grouped[zone]) {
      if (row[0] > row[1]) {
        throw new Error('Zone_Stage_Drops.csv 關卡區間反向：' + zone);
      }
      if (row[0] > coveredThrough + 1) {
        throw new Error('Zone_Stage_Drops.csv 關卡區間不連續：' + zone);
      }
      coveredThrough = Math.max(coveredThrough, row[1]);
    }
  });
  return expectedZones.map(zone => '  ' + zone + ': ' + JSON.stringify(grouped[zone])).join(',\n');
}
// 以「表頭名稱」定位欄位，而非寫死位置：日後在中間插欄（例如「變動」）也不會錯位。
// 「編號」「變動」等註記欄一律忽略，只認「系統分類 / 名稱 / 參數a…」。
const header = allRows.find(r => r.indexOf('系統分類') >= 0) || allRows[0];
const COL_CAT = header.indexOf('系統分類');
const COL_NAME = header.indexOf('名稱');
const COL_P0 = header.indexOf('參數a');
if (COL_CAT < 0 || COL_NAME < 0 || COL_P0 < 0) {
  throw new Error('CSV 表頭缺少必要欄位（需有「系統分類」「名稱」「參數a」）。實際表頭：' + JSON.stringify(header));
}
const csvRows = allRows.filter(r => r[COL_CAT] !== '系統分類' && r[0] !== '編號'); // 濾掉表頭列
// index[cat][name] = params[]（參數a..參數l）
const index = {};
csvRows.forEach(r => {
  const cat = r[COL_CAT], name = r[COL_NAME], params = r.slice(COL_P0);
  (index[cat] || (index[cat] = {}))[name] = params;
});
function P(cat, name, i) {
  if (!index[cat] || !index[cat][name]) throw new Error('CSV 缺少列：' + cat + ' / ' + name);
  const v = index[cat][name][i];
  if (v === undefined || v === '') throw new Error('CSV 缺少參數：' + cat + ' / ' + name + ' 參數#' + i);
  return v.trim();
}
// 直接編輯 Store 時及早拒絕無法產生有效商品的配置，避免扣款後才發現壞資料。
function storeNumber(name, min, max, integer) {
  const v = Number(P('神祕商人', name, 0));
  if (!Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) throw new Error('Store 神祕商人 / ' + name + ' 超出有效範圍');
  return v;
}
storeNumber('最高等級', 1, 20, true);
storeNumber('邀請券掉落率', 0, 100);
['寶石權重','裝備權重','符文權重','遺物權重','裝備價格基數','符文價格基數','符文價格指數','遺物價格基數'].forEach(n => storeNumber(n,0,Number.MAX_SAFE_INTEGER));
storeNumber('裝備等級倍率', Number.MIN_VALUE, Number.MAX_SAFE_INTEGER);
for (const [lo,hi,min,max] of [['裝備最低品質','裝備最高品質',0,11],['符文最低階級','符文最高階級',1,33],['遺物最低階級','遺物最高階級',1,Number.MAX_SAFE_INTEGER]]) {
  if (storeNumber(lo,min,max,true) > storeNumber(hi,min,max,true)) throw new Error('Store ' + lo + ' 不得大於 ' + hi);
}

/* ---------- 編輯清單：每筆 = {file, re(單一群組), value, label} ---------- */
const edits = [];
edits.push({
  file: 'data', scopeVar: 'ZONE_STAGE_DROP_PROFILES',
  re: /ZONE_STAGE_DROP_PROFILES\s*=\s*\{([\s\S]*?)\n\};/,
  grp: 1, value: zoneStageDropContent(), label: 'ZONE_STAGE_DROP_PROFILES（Zone_Stage_Drops.csv）', multiGroup: true
});
/* 功能解鎖條件：獨立表 config/CSV/system_unlock.csv（由 system_unlock.xlsx 轉出）。
   欄位：系統類型、系統名稱、解鎖等級(等級/轉生等級)、系統說明文字；第三欄格式「等級/轉生次數」，兩條件需同時滿足。
   表裡缺列或格式錯誤就中止，不靜默沿用舊值。 */
const SYSTEM_UNLOCK_CSV_PATH = process.env.SYSTEM_UNLOCK_CSV || path.join(ROOT, 'config', 'CSV', 'system_unlock.csv');
const systemUnlockRows = parseCsv(fs.readFileSync(SYSTEM_UNLOCK_CSV_PATH, 'utf8')).filter(r => r.length > 1);
const systemUnlockHeader = systemUnlockRows[0] || [];
const SU_NAME_COL = systemUnlockHeader.indexOf('系統名稱');
const SU_VALUE_COL = systemUnlockHeader.findIndex(h => String(h).indexOf('解鎖等級') === 0);
if (SU_NAME_COL < 0 || SU_VALUE_COL < 0) throw new Error('system_unlock.csv 表頭缺少「系統名稱」或「解鎖等級(等級/轉生等級)」：' + JSON.stringify(systemUnlockHeader));
function systemUnlock(name) {
  const hits = systemUnlockRows.slice(1).filter(r => String(r[SU_NAME_COL]).trim() === name);
  if (hits.length !== 1) throw new Error('system_unlock.csv 「' + name + '」必須剛好 1 列，目前 ' + hits.length + ' 列');
  const raw = String(hits[0][SU_VALUE_COL] || '').trim();
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(raw);
  if (!m) throw new Error('system_unlock.csv 「' + name + '」解鎖條件須為「等級/轉生次數」的整數（例 1/1），目前為「' + raw + '」（Excel 若把它轉成日期，請把格子設為文字格式再填）');
  return { level: m[1], reinc: m[2] };
}
function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// 完整十進位字面值，包含 Excel 轉出的科學記號；不可留下舊指數尾碼。
const NUMBER_SOURCE = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.source;
const NUMBER_LITERAL = new RegExp('^(?:' + NUMBER_SOURCE + ')$');
// 具名純量常數： var NAME = <num>;
function scalarValue(file, varName, value, label) {
  edits.push({ file, re: new RegExp('(\\b' + esc(varName) + '\\s*=\\s*)(' + NUMBER_SOURCE + ')'), grp: 2, value: String(value), label: label || varName });
}
function scalar(file, varName, cat, name, i) {
  scalarValue(file, varName, P(cat, name, i), varName);
}
/* 陣列格式：{1,2,3,5,7} → [1, 2, 3, 5, 7]（遊戲端每次隨機抽一個，機率均等）。
   刻意排除含 ~ 的寫法：那是 rangeBound 的區間格式（{下限~上限}），不是清單。 */
function numberListLiteral(raw) {
  const txt = String(raw).trim();
  const m = /^\{\s*([^}~]*?)\s*\}$/.exec(txt);
  if (!m) return null;
  const parts = m[1].split(/[,;、]/).map(x => x.trim()).filter(x => x !== '');
  if (!parts.length) return null;
  const nums = parts.map(x => {
    const n = Number(x);
    if (!Number.isFinite(n)) throw new Error('參數陣列含非數值：' + txt + '（' + x + '）');
    return n;
  });
  return '[' + nums.join(', ') + ']';
}
/* 這一格可以填單一數值，也可以填 {a,b,c} 陣列。程式端兩種都要吃得下。 */
function scalarOrList(file, varName, cat, name, i) {
  const raw = P(cat, name, i);
  const list = numberListLiteral(raw);
  edits.push({
    file,
    re: new RegExp('(\\b' + esc(varName) + '\\s*=\\s*)(\\[[^\\]]*\\]|' + NUMBER_SOURCE + ')'),
    grp: 2, value: list || String(raw).trim(), label: varName
  });
}
/* 參數表還沒有這一列（或這一格是空的）時跳過，不中斷整份套用。

   為什麼需要：CSV 是由 config/Excel/game_parameters.xlsx 產生的（套用參數.bat 第 2 步），
   所以「先寫程式、再請人在 Excel 補列」是必然的順序。用 scalar() 的話，那段期間
   每跑一次套用參數就整個中斷，連其他 550 個參數也套不進去。
   跳過的項目會列在最後，不會安靜消失。 */
const skippedParams = [];
function scalarOpt(file, varName, cat, name, i, allowZero) {
  const row = index[cat] && index[cat][name];
  const raw = row ? row[i] : undefined;
  const txt = raw === undefined ? '' : String(raw).trim();
  /* allowZero：0 是這個參數的有效值（例如「換目標間隔 0 秒＝不等待」）時傳 true，
     否則把 0 當成空格跳過——多數參數填 0 的意思是「這一格沒用到」。 */
  if (txt === '' || (!allowZero && txt === '0')) {
    skippedParams.push(`${cat} / ${name} 參數#${i} → ${varName}`);
    return;
  }
  scalarValue(file, varName, txt, varName);
}
function rangeBound(file, varName, cat, name, i, bound) {
  const raw = P(cat, name, i);
  const match = raw.match(/^\{\s*(-?[\d.]+)\s*~\s*(-?[\d.]+)\s*\}$/);
  if (!match) throw new Error('CSV 樓層範圍格式錯誤：' + cat + ' / ' + name + ' / ' + raw);
  scalarValue(file, varName, match[bound], varName);
}
// 物件同行欄位： <keyAnchor> ... <field>: <num>（限制在同一行內）
// 前綴（含 keyAnchor 到 field:）獨立成群組1、數字為群組2；如此定位時從前綴之後找數字，
// 避免匹配到前面欄位中相同的數字字串（例：rewardMult 的 2 誤中 hpMult 的 2.2）。
function objField(file, keyAnchor, field, cat, name, i, label) {
  edits.push({
    file,
    re: new RegExp('(' + esc(keyAnchor) + '[^\\n]*?\\b' + esc(field) + ':\\s*)(' + NUMBER_SOURCE + ')'),
    grp: 2, value: P(cat, name, i), label: (label || keyAnchor) + '.' + field
  });
}
// 物件跨行欄位（多行物件內第一個該欄位）
function objFieldML(file, keyAnchor, field, cat, name, i, label, scopeVar) {
  edits.push({
    file,
    re: new RegExp('(' + esc(keyAnchor) + '[\\s\\S]*?\\b' + esc(field) + ':\\s*)(' + NUMBER_SOURCE + ')'),
    grp: 2, value: P(cat, name, i), label: (label || keyAnchor) + '.' + field, scopeVar: scopeVar
  });
}
function objFieldMLValue(file, keyAnchor, field, value, label, scopeVar) {
  edits.push({
    file,
    re: new RegExp('(' + esc(keyAnchor) + '[\\s\\S]*?\\b' + esc(field) + ':\\s*)(' + NUMBER_SOURCE + ')'),
    grp: 2, value: String(value), label: (label || keyAnchor) + '.' + field, scopeVar: scopeVar
  });
}

/* 遠方預置怪群與遊走：名稱錨點，不依賴函式內的數字或程式碼片段。 */
['cellM', 'preloadM', 'minDistanceM', 'maxGroups', 'maxGroupSize', 'minGroups'].forEach(function (field, i) {
  objFieldML('data', '', field, '4-遠方怪群', '預先生成', i, 'FIELD_ENCOUNTER', 'FIELD_ENCOUNTER');
});
['roamRadiusM', 'roamSpeedRatio', 'roamWaitMin', 'roamWaitMax'].forEach(function (field, i) {
  objFieldML('data', '', field, '4-遠方怪群', '未警戒遊走', i, 'FIELD_ENCOUNTER', 'FIELD_ENCOUNTER');
});
/* ---- 已移除：inline / inlineRegex / numCtx（2026-08-10）----
   這三個 helper 是「錨定程式碼片段」的寫法：inline 綁前綴字串（'st.base.mp = '）、
   inlineRegex 綁整條正規式、numCtx 綁前後文夾住的數字。

   全部 101 條這類錨點已改成 scalar / objFieldML（綁變數名或「物件名＋欄位名」），
   helper 本身一併刪掉，避免下一個人照著舊範例再寫一條回來。

   為什麼非拿掉不可：它們綁的是「程式碼長什麼樣子」，任何一次正常重構都可能讓錨點
   0 命中，而 apply_params 對 0 命中只在試跑輸出列一行——真正套用時會**安靜地**
   少套那個值，程式、測試、Review 全部看不出異常。實際發生過三次：
     - 寶石商店升級費用：把字面值抽成常數後三條錨點同時失聯
     - 附魔攻擊基底／每級：改寫算式時被打斷，且打斷處與改動處不在同一行
     - 技能裝載欄 4 條：改寫 loadoutSize 後一起失聯

   若日後真的遇到「值無法具名」的情況（例如要改的不是數字而是整段結構），
   請優先考慮 arrayContent，或先把值具名再接；要重新引入形狀比對，
   請連同「為什麼這個值不能具名」一起寫在 commit 訊息裡。 */
// 整段陣列內容重建： var NAME = [<content>]; —— content 為新的內部字串
function arrayContent(file, varName, contentStr, label) {
  edits.push({ file, re: new RegExp('(\\b' + esc(varName) + '\\s*=\\s*\\[)([\\s\\S]*?)(\\];)'), grp: 2, value: contentStr, label: label || varName, multiGroup: true });
}

/* ===========================================================================
   映射定義
   =========================================================================== */
const RAR_KEYS = { '普通': 'common', '精良': 'uncommon', '稀有': 'rare', '獨特': 'unique', '史詩': 'epic', '傳說': 'legendary', '神話': 'mythic', '創世': 'genesis', '神鑄創世': 'godforged', '混沌': 'chaos', '神鑄混沌': 'chaosGodforged', '神鑄神話': 'mythicGodforged' };
// 稀有度表：mult(0) affix下限(1) affix上限(2) sockets(3) enchants(4) salv(5) runeSlots(6)
Object.keys(RAR_KEYS).forEach(nm => {
  const anchor = "key: '" + RAR_KEYS[nm] + "'";
  objField('data', anchor, 'mult', '表-稀有度', nm, 0, nm);
  edits.push({ file: 'data', re: new RegExp(esc(anchor) + "[^\\n]*?affix:\\s*\\[\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\]"), grp: 1, grp2: 2, value: P('表-稀有度', nm, 1), value2: P('表-稀有度', nm, 2), label: nm + '.affix', twoGroup: true });
  objField('data', anchor, 'sockets', '表-稀有度', nm, 3, nm);
  objField('data', anchor, 'enchants', '表-稀有度', nm, 4, nm);
  objField('data', anchor, 'salv', '表-稀有度', nm, 5, nm);
  objField('data', anchor, 'runeSlots', '表-稀有度', nm, 6, nm);   // 符文孔數（js/runeword.js 的 rwSlotCountAt 讀它）
});

/* ---- 【2026-07-20 配置撥離】以下四組已改由獨立表單管理，apply_params 不再接線 ----
   詞條池 → config/CSV/Equipment_Affix.csv（AFFIX_POOL）
   傳奇特效 → config/CSV/Equipment_Affix.csv（PASSIVE_POOL）
   神鑄特效 → config/CSV/Equipment_Affix.csv（GODFORGE_POOL）
   寶石種類 → config/CSV/Gems.csv（GEM_TYPES）
   由 tools/config_tables.cjs 雙向套用；此處刻意不再定義 表-詞條池/表-傳奇特效/表-神鑄特效/表-寶石種類 的錨點。
   game_parameters 內若仍殘留這四組的舊列，一律為「死列」（apply_params 忽略），
   實際數值以上述四表為準（唯一來源）。 */

// 自動機組零件：基礎值(0)＋每級增加值(1)
const PART_KEYS = { '加速齒輪': 'speedGear', '碎片熔煉爐': 'scrapForge', '淘金濾網': 'goldSluice', '精粹透鏡': 'extractLens', '知識核心': 'knowledgeCore', '寶石採集器': 'gemCollector', '幸運之心': 'luckHeart', '太古精華萃取器': 'ancientEssenceRate', '熔爐核心': 'furnaceCore' };
Object.keys(PART_KEYS).forEach(nm => {
  objField('data', PART_KEYS[nm] + ':', 'base', '表-自動機組零件', nm, 0, '零件基礎值-' + nm);
  objField('data', PART_KEYS[nm] + ':', 'perLevel', '表-自動機組零件', nm, 1, '零件每級增加值-' + nm);
});

// 場景倍率改由 config/CSV/Zones.csv 管理；game_parameters 不再是地圖倍率來源。
// 新遊戲／重新開局的初始資源（由參數表「0-遊戲預設」控制）。
scalar('player', 'INITIAL_GOLD', '0-遊戲預設', '開場金幣', 0);
scalar('renderer', 'BATTLE_CAMERA_DISTANCE_PERCENT', '8-戰鬥畫面', '戰鬥鏡頭距離', 0);
scalar('renderer', 'NPC_ELITE_GLOW_ALPHA', '8-戰鬥畫面', '菁英光暈與混色濃度', 0);
scalar('renderer', 'NPC_ELITE_ADV_GLOW_ALPHA', '8-戰鬥畫面', '菁英光暈與混色濃度', 1);
scalar('renderer', 'NPC_ELITE_BLEND_ALPHA', '8-戰鬥畫面', '菁英光暈與混色濃度', 2);
scalar('renderer', 'NPC_ELITE_ADV_BLEND_ALPHA', '8-戰鬥畫面', '菁英光暈與混色濃度', 3);
scalar('player', 'INITIAL_SCRAP', '0-遊戲預設', '開場裝備碎片', 0);
scalar('player', 'INITIAL_ESSENCE', '0-遊戲預設', '開場附魔精華', 0);

const ZONE_KEYS = Object.fromEntries(Object.keys(zoneById).map(id => [ZP(id,'地圖名稱'),id]));
Object.keys(ZONE_KEYS).forEach(nm => {
  const zoneKey = ZONE_KEYS[nm];
  const a = zoneKey + ':';
  objFieldMLValue('data', a, 'hpMult', ZP(zoneKey, '生命倍率'), '場景-' + nm, 'ZONES');
  objFieldMLValue('data', a, 'atkMult', ZP(zoneKey, '攻擊倍率'), '場景-' + nm, 'ZONES');
  objFieldMLValue('data', a, 'defMult', ZP(zoneKey, '防禦倍率'), '場景-' + nm, 'ZONES');
  objFieldMLValue('data', a, 'aspdMult', ZP(zoneKey, '攻速倍率'), '場景-' + nm, 'ZONES');
  objFieldMLValue('data', a, 'rewardMult', ZP(zoneKey, '經驗金幣獎勵倍率'), '場景-' + nm, 'ZONES');
});

/* ---- data.js 具名純量常數 ---- */
scalar('data', 'MAX_AFFIXES', '表-固定參數', '詞條數硬上限', 0);
scalar('data', 'REROLL_CHAOS_ESSENCE_COST', '7-洗煉', '混沌精華費用', 0);
scalar('data', 'REROLL_CHAOS_GODFORGED_ESSENCE_COST', '7-洗煉', '神鑄混沌精華費用', 0);
scalar('data', 'REROLL_ESSENCE_LEVEL_DIVISOR', '7-洗煉', '精華費用', 3);
// 太古常數（2026-07-23 改版：太古詞條產出時決定；野外掉落率由 Zone_Stage_Drops.csv 管理）
scalar('data', 'ANCIENT_ESSENCE_BOSS_BASE_RATE', '5-太古詞條', '高塔太古精華機率', 1);
scalar('data', 'ANCIENT_ESSENCE_BOSS_LEVEL_RATE', '5-太古詞條', '高塔太古精華機率', 3);
scalar('data', 'ANCIENT_ESSENCE_BOSS_RATE_CAP', '5-太古詞條', '高塔太古精華機率', 0);
scalar('data', 'ANCIENT_AFFIX_VALUE_MULT', '5-太古詞條', '太古詞條數值倍率', 0);
// 太古詞條產生率表（詞條數量 2~10 各一列；參數a..= 0條,1條,…N條 權重 %）→ ANCIENT_COUNT_WEIGHTS 逐列重建
scalar('data', 'ANCIENT_LUCK_WEIGHT_MULT', '5-太古詞條', '太古幸運權重倍率', 0);
scalar('data', 'ANCIENT_LUCK_WEIGHT_DENOM', '5-太古詞條', '太古幸運權重分母', 0);
for (let n = 2; n <= 10; n++) {
  const vals = [];
  for (let i = 0; i <= n; i++) vals.push(P('5-太古詞條', '太古詞條產生率(' + n + '詞條)', i));
  edits.push({
    file: 'data', scopeVar: 'ANCIENT_COUNT_WEIGHTS',
    re: new RegExp('\\b' + n + ':\\s*\\[([^\\]]*)\\]'),
    grp: 1, value: vals.join(', '), label: '太古產生率.' + n + '詞條', multiGroup: true
  });
}
// 等級上限（升級所需經驗 參數 d）
scalar('data', 'MAX_LEVEL', '1-成長經驗', '升級所需經驗', 3);
// 轉生
scalarValue('data', 'REINCARNATION_LEVEL', systemUnlock('轉生').level, 'REINCARNATION_LEVEL（system_unlock）');
scalar('data', 'REINCARNATION_MAX', '1-成長經驗', '可轉生等級 / 最高轉生', 1);
// 功能解鎖條件（system_unlock 表；等級/轉生次數）
{
  const bind = (sysName, levelVar, reincVar) => {
    const u = systemUnlock(sysName);
    scalarValue('data', levelVar, u.level, levelVar + '（system_unlock）');
    scalarValue('data', reincVar, u.reinc, reincVar + '（system_unlock）');
  };
  // 神鑄四功能（裝備神鑄／太古精鑄／神級寶石／神聖刻印）：只看轉生次數，等級欄必須填 1。
  [['裝備神鑄', 'equipUnlock'], ['太古精鑄', 'ancientUnlock'], ['神級寶石', 'gemUnlock'], ['神聖刻印', 'imprintUnlock']].forEach(([sysName, field]) => {
    const u = systemUnlock(sysName);
    if (Number(u.level) !== 1) throw new Error('system_unlock.csv 「' + sysName + '」只支援轉生次數門檻，等級欄必須是 1（目前 ' + u.level + '）');
    objFieldMLValue('data', 'DIVINE_FORGE = {', field, u.reinc, '神鑄（system_unlock）');
  });
  bind('天堂威能', 'TALENT_UNLOCK_LEVEL', 'TALENT_UNLOCK_REINCARNATION');
  bind('寶石共鳴', 'GEM_RESONANCE_UNLOCK_LEVEL', 'GEM_RESONANCE_UNLOCK_REINCARNATION');
  bind('符文系統', 'RUNE_UNLOCK_LEVEL', 'RUNE_UNLOCK_REINCARNATION');
  const sets = ['裝備方案 第1套', '裝備方案 第2套', '裝備方案 第3套'].map(systemUnlock);
  [['EQUIP_SET_UNLOCK_LEVELS', 'level'], ['EQUIP_SET_UNLOCK_REINCARNATIONS', 'reinc']].forEach(([varName, key]) => {
    edits.push({
      file: 'data', re: new RegExp('(\\b' + varName + '\\s*=\\s*)(\\[[^\\]]*\\])'), grp: 2,
      value: '[' + sets.map(x => x[key]).join(', ') + ']', label: varName + '（system_unlock）'
    });
  });
}
// 新版神鑄的每一項數值皆由 game_parameters 的新版分類管理。
{
  const number = name => {
    const v = Number(P('6-新版神鑄', name, 0));
    if (!Number.isFinite(v) || v < 0) throw Error('新版神鑄參數必須為非負有限數值：' + name);
    return v;
  };
  const equipment = number('裝備神鑄素材件數');
  const gems = number('神級寶石每類顆數');
  if (!Number.isInteger(equipment) || equipment < 1 || equipment > 6) throw Error('裝備神鑄素材件數必須為1～6整數');
  if (!Number.isInteger(gems) || gems < 1 || gems > 3) throw Error('神級寶石每類顆數必須為1～3整數');
  if (number('精鑄刻印素材件數') !== 1) throw Error('精鑄刻印素材件數必須為1');
  if (!(number('太古精鑄第二條精華消耗倍率') >= 1)) throw Error('太古精鑄第二條精華消耗倍率必須大於或等於1');
  const threshold1 = number('太古精鑄精華加倍成功率門檻'), threshold2 = number('太古精鑄精華四倍成功率門檻');
  if (!(threshold1 < threshold2 && threshold2 <= 100)) throw Error('太古精鑄成功率門檻必須為遞增且不超過100');
  const mult1 = number('太古精鑄第一門檻精華消耗倍率'), mult2 = number('太古精鑄第二門檻精華消耗倍率');
  if (!(mult1 >= 1 && mult2 >= mult1)) throw Error('太古精鑄門檻消耗倍率必須大於或等於1且不遞減');
  const min = number('裝備神鑄失敗最少損失'), max = number('裝備神鑄失敗最多損失');
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max || max > equipment) throw Error('裝備神鑄失敗損失必須為整數，且最少≤最多≤素材件數');
  for (const name of ['裝備神鑄每石成功率','精鑄寶石刻印每石成功率']) if (!(number(name) > 0)) throw Error('每石成功率必須大於0：' + name);
  for (const name of ['裝備神鑄神話成功率','裝備神鑄創世成功率','裝備神鑄混沌成功率','精鑄刻印神話成功率','精鑄刻印創世成功率','精鑄刻印混沌成功率','神級寶石成功率']) if (number(name) > 100) throw Error('成功率不可超過100：' + name);
  if (number('無效果神性之石返還率') > 1) throw Error('神性之石返還率不可超過1');
  const weights = ['神聖詞條刻印權重','太古詞條刻印權重','神聖鑲孔刻印權重','額外普通詞條刻印權重','額外太古詞條刻印權重','額外傳奇特效刻印權重','無效果刻印權重'];
  if (!(weights.reduce((sum, name) => sum + number(name), 0) > 0)) throw Error('刻印權重總和必須大於0');
}
objFieldML('data', 'DIVINE_FORGE = {', 'equipMythicRate', '6-新版神鑄', '裝備神鑄神話成功率', 0, '神鑄.equipMythicRate');
objFieldML('data', 'DIVINE_FORGE = {', 'equipGenesisRate', '6-新版神鑄', '裝備神鑄創世成功率', 0, '神鑄.equipGenesisRate');
objFieldML('data', 'DIVINE_FORGE = {', 'equipChaosRate', '6-新版神鑄', '裝備神鑄混沌成功率', 0, '神鑄.equipChaosRate');
objFieldML('data', 'DIVINE_FORGE = {', 'singleMythicRate', '6-新版神鑄', '精鑄刻印神話成功率', 0, '神鑄.singleMythicRate');
objFieldML('data', 'DIVINE_FORGE = {', 'singleGenesisRate', '6-新版神鑄', '精鑄刻印創世成功率', 0, '神鑄.singleGenesisRate');
objFieldML('data', 'DIVINE_FORGE = {', 'singleChaosRate', '6-新版神鑄', '精鑄刻印混沌成功率', 0, '神鑄.singleChaosRate');
objFieldML('data', 'DIVINE_FORGE = {', 'gemRate', '6-新版神鑄', '神級寶石成功率', 0, '神鑄.gemRate');
objFieldML('data', 'DIVINE_FORGE = {', 'equipStoneRate', '6-新版神鑄', '裝備神鑄每石成功率', 0, '神鑄.equipStoneRate');
objFieldML('data', 'DIVINE_FORGE = {', 'singleStoneRate', '6-新版神鑄', '精鑄寶石刻印每石成功率', 0, '神鑄.singleStoneRate');
objFieldML('data', 'DIVINE_FORGE = {', 'ancientSecondEssenceMult', '6-新版神鑄', '太古精鑄第二條精華消耗倍率', 0, '神鑄.ancientSecondEssenceMult');
objFieldML('data', 'DIVINE_FORGE = {', 'ancientEssenceThreshold1', '6-新版神鑄', '太古精鑄精華加倍成功率門檻', 0, '神鑄.ancientEssenceThreshold1');
objFieldML('data', 'DIVINE_FORGE = {', 'ancientEssenceMult1', '6-新版神鑄', '太古精鑄第一門檻精華消耗倍率', 0, '神鑄.ancientEssenceMult1');
objFieldML('data', 'DIVINE_FORGE = {', 'ancientEssenceThreshold2', '6-新版神鑄', '太古精鑄精華四倍成功率門檻', 0, '神鑄.ancientEssenceThreshold2');
objFieldML('data', 'DIVINE_FORGE = {', 'ancientEssenceMult2', '6-新版神鑄', '太古精鑄第二門檻精華消耗倍率', 0, '神鑄.ancientEssenceMult2');
objFieldML('data', 'DIVINE_FORGE = {', 'equipMythicGold', '6-新版神鑄', '裝備神鑄神話金幣', 0, '神鑄.equipMythicGold');
objFieldML('data', 'DIVINE_FORGE = {', 'equipGenesisGold', '6-新版神鑄', '裝備神鑄創世金幣', 0, '神鑄.equipGenesisGold');
objFieldML('data', 'DIVINE_FORGE = {', 'equipChaosGold', '6-新版神鑄', '裝備神鑄混沌金幣', 0, '神鑄.equipChaosGold');
objFieldML('data', 'DIVINE_FORGE = {', 'ancientMythicGold', '6-新版神鑄', '太古精鑄神話金幣', 0, '神鑄.ancientMythicGold');
objFieldML('data', 'DIVINE_FORGE = {', 'ancientGenesisGold', '6-新版神鑄', '太古精鑄創世金幣', 0, '神鑄.ancientGenesisGold');
objFieldML('data', 'DIVINE_FORGE = {', 'ancientChaosGold', '6-新版神鑄', '太古精鑄混沌金幣', 0, '神鑄.ancientChaosGold');
objFieldML('data', 'DIVINE_FORGE = {', 'imprintMythicGold', '6-新版神鑄', '神聖刻印神話金幣', 0, '神鑄.imprintMythicGold');
objFieldML('data', 'DIVINE_FORGE = {', 'imprintGenesisGold', '6-新版神鑄', '神聖刻印創世金幣', 0, '神鑄.imprintGenesisGold');
objFieldML('data', 'DIVINE_FORGE = {', 'imprintChaosGold', '6-新版神鑄', '神聖刻印混沌金幣', 0, '神鑄.imprintChaosGold');
objFieldML('data', 'DIVINE_FORGE = {', 'gemGold', '6-新版神鑄', '神級寶石金幣', 0, '神鑄.gemGold');
objFieldML('data', 'DIVINE_FORGE = {', 'equipCount', '6-新版神鑄', '裝備神鑄素材件數', 0, '神鑄.equipCount');
objFieldML('data', 'DIVINE_FORGE = {', 'singleCount', '6-新版神鑄', '精鑄刻印素材件數', 0, '神鑄.singleCount');
objFieldML('data', 'DIVINE_FORGE = {', 'gemPerType', '6-新版神鑄', '神級寶石每類顆數', 0, '神鑄.gemPerType');
objFieldML('data', 'DIVINE_FORGE = {', 'failMin', '6-新版神鑄', '裝備神鑄失敗最少損失', 0, '神鑄.failMin');
objFieldML('data', 'DIVINE_FORGE = {', 'failMax', '6-新版神鑄', '裝備神鑄失敗最多損失', 0, '神鑄.failMax');
objFieldML('data', 'DIVINE_FORGE = {', 'gemValue', '6-新版神鑄', '神級寶石屬性保留率', 0, '神鑄.gemValue');
objFieldML('data', 'DIVINE_FORGE = {', 'sacredValue', '6-新版神鑄', '神聖詞條倍率', 0, '神鑄.sacredValue');
objFieldML('data', 'DIVINE_FORGE = {', 'socketValue', '6-新版神鑄', '神聖鑲孔倍率', 0, '神鑄.socketValue');
objFieldML('data', 'DIVINE_FORGE = {', 'refundRate', '6-新版神鑄', '無效果神性之石返還率', 0, '神鑄.refundRate');
objFieldML('data', 'DIVINE_FORGE = {', 'sacredAffixWeight', '6-新版神鑄', '神聖詞條刻印權重', 0, '神鑄.sacredAffixWeight');
objFieldML('data', 'DIVINE_FORGE = {', 'ancientAffixWeight', '6-新版神鑄', '太古詞條刻印權重', 0, '神鑄.ancientAffixWeight');
objFieldML('data', 'DIVINE_FORGE = {', 'sacredSocketWeight', '6-新版神鑄', '神聖鑲孔刻印權重', 0, '神鑄.sacredSocketWeight');
objFieldML('data', 'DIVINE_FORGE = {', 'extraAffixWeight', '6-新版神鑄', '額外普通詞條刻印權重', 0, '神鑄.extraAffixWeight');
objFieldML('data', 'DIVINE_FORGE = {', 'extraAncientWeight', '6-新版神鑄', '額外太古詞條刻印權重', 0, '神鑄.extraAncientWeight');
objFieldML('data', 'DIVINE_FORGE = {', 'legendaryWeight', '6-新版神鑄', '額外傳奇特效刻印權重', 0, '神鑄.legendaryWeight');
objFieldML('data', 'DIVINE_FORGE = {', 'refundWeight', '6-新版神鑄', '無效果刻印權重', 0, '神鑄.refundWeight');
// 魔塵掉落由 Zone_Stage_Drops.csv 管理；高塔 BOSS 魔塵仍由 game_parameters 管理。
scalar('data', 'DUST_BOSS_BASE', '4-高塔BOSS', '高塔 BOSS 魔塵', 1);
scalar('data', 'DUST_BOSS_PER_LEVEL', '4-高塔BOSS', '高塔 BOSS 魔塵', 2);
scalar('data', 'DUST_BOSS_CAP', '4-高塔BOSS', '高塔 BOSS 魔塵', 0);
// 高塔（2026-07-23 起三塔獨立：每列參數欄依「試煉→地獄→煉獄」順序攤平，
// 錨定 data.js 的 TOWER_BOSS_TRIAL / TOWER_BOSS_HELL / TOWER_BOSS_PURGATORY 物件欄位）
rangeBound('data', 'TOWER_TRIAL_MAX_FLOOR', '4-高塔BOSS', '試練之塔範圍', 0, 2);
rangeBound('data', 'TOWER_HELL_MAX_FLOOR', '4-高塔BOSS', '試練之塔範圍', 1, 2);
rangeBound('data', 'TOWER_PURGATORY_MAX_FLOOR', '4-高塔BOSS', '試練之塔範圍', 2, 2);
// 舊版 Excel 將攻速與控制抵抗交錯存放；僅相容控制抵抗，攻速仍由 NPC 表管理。
const towerCtrlLegacy = !(index['4-高塔BOSS'] && index['4-高塔BOSS']['控制抵抗'])
  && !!(index['4-高塔BOSS'] && index['4-高塔BOSS']['攻速 / 控制抵抗']);
if (towerCtrlLegacy) {
  console.log('[舊版參數表相容] 控制抵抗讀取「攻速 / 控制抵抗」的 b/d/f 欄；舊攻速 a/c/e 欄不套用，攻速以 NPC.xlsx 的 tower_boss 列為準。');
}
[['TOWER_BOSS_TRIAL', '試煉', 0], ['TOWER_BOSS_HELL', '地獄', 1], ['TOWER_BOSS_PURGATORY', '煉獄', 2]].forEach(([anchor, tag, t]) => {
  const L = (f) => '高塔' + tag + '-' + f;
  objFieldML('data', anchor, 'refStageBase', '4-高塔BOSS', '對應野外階段', t * 2, L('refStageBase'));
  objFieldML('data', anchor, 'refStagePerFloor', '4-高塔BOSS', '對應野外階段', t * 2 + 1, L('refStagePerFloor'));
  objFieldML('data', anchor, 'levelBonus', '4-高塔BOSS', 'BOSS 等級', t, L('levelBonus'));
  objFieldML('data', anchor, 'hitBase', '4-高塔BOSS', '命中率', t * 2, L('hitBase'));
  objFieldML('data', anchor, 'hitPerFloor', '4-高塔BOSS', '命中率', t * 2 + 1, L('hitPerFloor'));
  objFieldML('data', anchor, 'hpMult', '4-高塔BOSS', '生命', t, L('hpMult'));
  objFieldML('data', anchor, 'atkMult', '4-高塔BOSS', '攻擊', t, L('atkMult'));
  objFieldML('data', anchor, 'defMult', '4-高塔BOSS', '物/魔防', t, L('defMult'));
  // 攻速 2026-11-08 移到 NPC 表 tower_boss 列（逐隻設定，見 tools/config_tables.cjs）；這列只剩控制抵抗
  objFieldML('data', anchor, 'ctrlRes', '4-高塔BOSS', towerCtrlLegacy ? '攻速 / 控制抵抗' : '控制抵抗', towerCtrlLegacy ? t * 2 + 1 : t, L('ctrlRes'));
  objFieldML('data', anchor, 'dodgeBase', '4-高塔BOSS', '閃避率', t * 3, L('dodgeBase'));
  objFieldML('data', anchor, 'dodgeCap', '4-高塔BOSS', '閃避率', t * 3 + 1, L('dodgeCap'));
  objFieldML('data', anchor, 'dodgePerFloor', '4-高塔BOSS', '閃避率', t * 3 + 2, L('dodgePerFloor'));
  objFieldML('data', anchor, 'elemMult', '4-高塔BOSS', '元素附傷(元素 BOSS)', t, L('elemMult'));
  objFieldML('data', anchor, 'xpMult', '4-高塔BOSS', '經驗', t, L('xpMult'));
  objFieldML('data', anchor, 'timeLimit', '4-高塔BOSS', '戰鬥規則', t * 4, L('timeLimit'));
  objFieldML('data', anchor, 'enrageTime', '4-高塔BOSS', '戰鬥規則', t * 4 + 1, L('enrageTime'));
  objFieldML('data', anchor, 'enrageMult', '4-高塔BOSS', '戰鬥規則', t * 4 + 2, L('enrageMult'));
  objFieldML('data', anchor, 'chargePeriod', '4-高塔BOSS', '戰鬥規則', t * 4 + 3, L('chargePeriod'));
});
scalar('data', 'TOWER_HELL_SOUL_ORIGIN_BASE_RATE', '4-高塔BOSS', '魔魂本源(地獄之塔)', 0);
scalar('data', 'TOWER_HELL_SOUL_ORIGIN_PER_FLOOR', '4-高塔BOSS', '魔魂本源(地獄之塔)', 1);
scalar('data', 'DEMON_SEED_BOSS_RATE_CAP', '4-高塔BOSS', '魔種(煉獄之塔)', 0);
scalar('data', 'DEMON_SEED_BOSS_BASE_RATE', '4-高塔BOSS', '魔種(煉獄之塔)', 1);
scalar('data', 'DEMON_SEED_BOSS_PER_FLOOR', '4-高塔BOSS', '魔種(煉獄之塔)', 2);
scalarValue('data', 'TOWER_ENRAGE_HP', 50, 'TOWER_ENRAGE_HP'); // 狂暴血量門檻（無對應可調 CSV 欄，固定內嵌；全塔共用）
// 寶石相關
scalar('data', 'GEM_MAX_LEVEL', '表-固定參數', '寶石一般上限 / 神鑄上限', 0);
scalar('data', 'GEM_FORGE_MAX_LEVEL', '表-固定參數', '寶石一般上限 / 神鑄上限', 1);
scalar('data', 'GEM_COMPOSE_INPUT_COUNT', '8-寶石', '寶石合成(手動)', 0);
scalar('data', 'GEM_COMPOSE_HIGH_INPUT_COUNT', '8-寶石', '寶石合成(手動)', 1);
scalar('data', 'GEM_COMPOSE_TOP_INPUT_COUNT', '8-寶石', '寶石合成(手動)', 2);
scalar('data', 'GEM_SHOP_MAX_LEVEL', '神祕商人', '最高等級', 0);
objFieldML('data', 'MYSTERY_MERCHANT_SETTINGS', 'ticketDropRate', '神祕商人', '邀請券掉落率', 0);
objFieldML('data', 'MYSTERY_MERCHANT_SETTINGS', 'gemWeight', '神祕商人', '寶石權重', 0);
objFieldML('data', 'MYSTERY_MERCHANT_SETTINGS', 'equipmentWeight', '神祕商人', '裝備權重', 0);
objFieldML('data', 'MYSTERY_MERCHANT_SETTINGS', 'runeWeight', '神祕商人', '符文權重', 0);
objFieldML('data', 'MYSTERY_MERCHANT_SETTINGS', 'relicWeight', '神祕商人', '遺物權重', 0);
objFieldML('data', 'MYSTERY_MERCHANT_SETTINGS', 'equipmentMinRarity', '神祕商人', '裝備最低品質', 0);
objFieldML('data', 'MYSTERY_MERCHANT_SETTINGS', 'equipmentMaxRarity', '神祕商人', '裝備最高品質', 0);
objFieldML('data', 'MYSTERY_MERCHANT_SETTINGS', 'equipmentPriceBase', '神祕商人', '裝備價格基數', 0);
objFieldML('data', 'MYSTERY_MERCHANT_SETTINGS', 'equipmentLevelMultiplier', '神祕商人', '裝備等級倍率', 0);
objFieldML('data', 'MYSTERY_MERCHANT_SETTINGS', 'runeMinTier', '神祕商人', '符文最低階級', 0);
objFieldML('data', 'MYSTERY_MERCHANT_SETTINGS', 'runeMaxTier', '神祕商人', '符文最高階級', 0);
objFieldML('data', 'MYSTERY_MERCHANT_SETTINGS', 'runePriceBase', '神祕商人', '符文價格基數', 0);
objFieldML('data', 'MYSTERY_MERCHANT_SETTINGS', 'runePriceExponent', '神祕商人', '符文價格指數', 0);
objFieldML('data', 'MYSTERY_MERCHANT_SETTINGS', 'relicPriceBase', '神祕商人', '遺物價格基數', 0);
objFieldML('data', 'MYSTERY_MERCHANT_SETTINGS', 'relicMinTier', '神祕商人', '遺物最低階級', 0);
objFieldML('data', 'MYSTERY_MERCHANT_SETTINGS', 'relicMaxTier', '神祕商人', '遺物最高階級', 0);
// 升級費用：參數表早就有「8-寶石商店／升級費用」這一列（a + 等級^b × c），但一直沒接上，
// 於是係數寫死在 formula.js 裡，改參數表不會生效。2026-08-10 補接。
scalar('data', 'GEM_SHOP_UPGRADE_BASE', '8-寶石商店', '升級費用', 0);
scalar('data', 'GEM_SHOP_UPGRADE_EXPONENT', '8-寶石商店', '升級費用', 1);
scalar('data', 'GEM_SHOP_UPGRADE_COEF', '8-寶石商店', '升級費用', 2);
// 其他 data.js 常數
scalar('data', 'ENCHANT_ESSENCE_COST', '6-裝備', '手動附魔費用', 1);
scalar('data', 'PART_MAX_TIER', '表-固定參數', '零件階級上限', 0);
scalar('data', 'PART_KEEP_PER_KEY', '表-固定參數', '零件庫存保留', 0);
scalar('data', 'PART_UPGRADE_COST_A', '表-固定參數', '零件升級金錢消耗', 0);
scalar('data', 'PART_UPGRADE_COST_B', '表-固定參數', '零件升級金錢消耗', 1);
scalar('data', 'PART_UPGRADE_COST_C', '表-固定參數', '零件升級金錢消耗', 2);
/* 出怪間隔一列兩個值：a＝同一關內每一波的間隔，b＝切換到下一關之後的間隔。
   （原本這一列是 RESPAWN_DELAY「空場補怪間隔 × (1-移動速度%)」，已取消：
     間隔改為純定值，不再受移動速度影響。） */
scalarOrList('data', 'FIELD_WAVE_SPAWN_INTERVAL', '表-固定參數', '出怪間隔', 0);
scalar('data', 'FIELD_STAGE_SWITCH_DELAY', '表-固定參數', '出怪間隔', 1);
scalar('data', 'REVIVE_DELAY', '表-固定參數', '死亡復活時間', 0);
/* 換目標間隔：這一列是後加的，Excel 主檔補上之前用 scalarOpt 跳過（0 是有效值，要 allowZero）。 */
scalarOpt('data', 'TARGET_SWITCH_DELAY', '表-固定參數', '換目標間隔', 0, true);
scalar('data', 'CONVEYOR_CAP', '7-容量', '輸送帶容量', 0);
scalar('data', 'SYNTH_BUFFER_CAP', '7-容量', '合成暫存區', 0);
scalar('data', 'INVENTORY_CAP', '7-容量', '背包容量', 0);        // a＝初始格數
scalar('data', 'INVENTORY_MAX', '7-容量', '背包容量', 1);        // b＝擴充上限（可自訂）
scalar('data', 'FACTORY_BASE_INTERVAL', '7-容量', '生產線處理間隔', 0);
scalar('data', 'SYNTH_GREAT_BASE', '7-合成', '大成功率', 0);

/* ---- 陣列 / 巢狀陣列重建 ---- */
// 神話／創世／神鑄創世的洗煉精華費用，依名稱接至對應品質編號。
objField('data', 'REROLL_ESSENCE_COST = {', '6', '7-洗煉', '精華費用', 0, 'REROLL_ESSENCE_COST');
objField('data', 'REROLL_ESSENCE_COST = {', '7', '7-洗煉', '精華費用', 1, 'REROLL_ESSENCE_COST');
objField('data', 'REROLL_ESSENCE_COST = {', '9', '7-洗煉', '精華費用', 2, 'REROLL_ESSENCE_COST');
// FUSE_GOLD_COST：各素材階級的合成金幣。
{
  const g = Array.from({ length: 9 }, (_, i) => P('8-寶石', '寶石合成金幣', i));
  arrayContent('data', 'FUSE_GOLD_COST', '0, ' + g.join(', '), 'FUSE_GOLD_COST');
}
/* 「10^次方」寫法轉成 JS 數字字面值。次方可為小數（例 10^9.5）。
   ⚠️ 不可把原字串照抄進 JS：`10^9.5` 在 JS 是位元 XOR，結果是 3 而不是 10 的 9.5 次方。
   所以無法解析的格子一律中止，不再回傳原字串。 */
function parseExpMultiplier(raw) {
  const str = String(raw).trim();
  const m = str.match(/^10\s*\^\s*(\d+(?:\.\d+)?)$/);
  if (m) {
    const exp = Number(m[1]);
    if (exp === 0) return '1';
    if (!Number.isInteger(exp)) return String(Math.pow(10, exp));
    if (exp <= 9) return String(Math.pow(10, exp));
    return '1e' + exp;
  }
  if (str !== '' && NUMBER_LITERAL.test(str)) return String(Number(str));
  throw new Error('轉生對照表 升級經驗倍率無法解析：「' + str + '」（應為數字或 10^次方，例 10^9.5）');
}
function getReincarnationCell(n, paramIdx) {
  const table = index['1-轉生對照表'];
  if (!table) throw new Error('CSV 缺少系統分類：1-轉生對照表');
  const exactKey = '轉生 ' + n + ' 次';
  if (table[exactKey]) return P('1-轉生對照表', exactKey, paramIdx);
  const noSpaceKey = '轉生 ' + n + '次';
  if (table[noSpaceKey]) return P('1-轉生對照表', noSpaceKey, paramIdx);
  const foundKey = Object.keys(table).find(k => {
    const m = k.match(/^轉生\s*(\d+)\s*次$/);
    return m && parseInt(m[1], 10) === n;
  });
  if (foundKey) return P('1-轉生對照表', foundKey, paramIdx);
  throw new Error('CSV 缺少列：1-轉生對照表 / 轉生 ' + n + ' 次');
}
/* 轉生對照表欄位（2026-11-05 起生命／法力／四維分開填）：
   a=生命最終倍率 b=法力最終倍率 c=四維最終倍率 d=升級經驗倍率 e=升級經驗基礎增加值 f=階級名稱 */
const REINC_COL = { hp: 0, mp: 1, stat: 2, expMult: 3, expAdd: 4, rank: 5 };
// REINCARNATION_HP／MP／STAT_MULTIPLIERS = [1, 1.5, ...]（0~20 轉，索引＝轉生次數）
[['REINCARNATION_HP_MULTIPLIERS', REINC_COL.hp, '生命'],
 ['REINCARNATION_MP_MULTIPLIERS', REINC_COL.mp, '法力'],
 ['REINCARNATION_STAT_MULTIPLIERS', REINC_COL.stat, '四維']].forEach(([varName, col, label]) => {
  const g = [];
  for (let n = 0; n <= 20; n++) {
    const raw = String(getReincarnationCell(n, col)).trim();
    const val = Number(raw);
    if (!NUMBER_LITERAL.test(raw) || !(val > 0)) {
      throw new Error('轉生對照表 轉生 ' + n + ' 次 ' + label + '最終倍率須為正數，目前為「' + raw + '」');
    }
    g.push(Number.isInteger(val) ? val : parseFloat(val.toFixed(6)));
  }
  arrayContent('data', varName, g.join(', '), varName);
});
// REINCARNATION_EXP_BASE_ADD = [0, 100000, 300000, ...]（索引0固定0；1~20 取 e 欄＝升級經驗基礎增加值）
{
  const g = [];
  for (let n = 1; n <= 20; n++) g.push(getReincarnationCell(n, REINC_COL.expAdd));
  arrayContent('data', 'REINCARNATION_EXP_BASE_ADD', '0, ' + g.join(', '), 'REINCARNATION_EXP_BASE_ADD');
}
// REINCARNATION_RANKS = ['冒險者', '勇者', ...]（0~20 取 f 欄＝階級名稱）
{
  const g = [];
  for (let n = 0; n <= 20; n++) g.push("'" + getReincarnationCell(n, REINC_COL.rank) + "'");
  arrayContent('data', 'REINCARNATION_RANKS', g.join(', '), 'REINCARNATION_RANKS');
}
// REINCARNATION_EXP_MULTIPLIERS = [1, 10, 100, ...]（0~20 取 d 欄＝升級經驗倍率）
{
  const g = [];
  for (let n = 0; n <= 20; n++) {
    const raw = getReincarnationCell(n, REINC_COL.expMult);
    g.push(parseExpMultiplier(raw));
  }
  arrayContent('data', 'REINCARNATION_EXP_MULTIPLIERS', g.join(', '), 'REINCARNATION_EXP_MULTIPLIERS');
}
/* 每波敵人數量：小怪／菁英／BOSS 三張獨立權重表。
   欄位寫法 {數量,權重} 或 {下限~上限,權重}（也接受 = 當分隔，與本表其他區間欄位一致）。
   例：{1~4,10} 代表 1~4 隻的權重都是 10。留空或 0 的欄位略過。 */
function parseCountTuples(cat, name) {
  const params = index[cat] && index[cat][name];
  if (!params) throw new Error('CSV 缺少列：' + cat + ' / ' + name);
  const out = [];
  params.forEach(cell => {
    const raw = (cell == null ? '' : String(cell)).trim();
    if (raw === '' || raw === '0') return;               // Excel 會把留空欄填成 0
    const m = /^\{\s*(\d+)\s*(?:~\s*(\d+)\s*)?[,=]\s*(-?[\d.]+)\s*\}$/.exec(raw);
    if (!m) throw new Error('數量權重格式無法解析：' + cat + ' / ' + name + ' →「' + raw + '」' +
      '（應為 {數量,權重} 或 {下限~上限,權重}）');
    const lo = Number(m[1]);
    const hi = m[2] === undefined ? lo : Number(m[2]);
    const w = Number(m[3]);
    if (!(hi >= lo)) throw new Error('數量區間上下界顛倒：' + cat + ' / ' + name + ' →「' + raw + '」');
    for (let n = lo; n <= hi; n++) out.push('[' + n + ', ' + w + ']');
  });
  if (!out.length) throw new Error('數量權重全空：' + cat + ' / ' + name);
  return out.join(', ');
}
/* 每波小怪／菁英群／BOSS 數量、菁英機率與群成員數：已搬到 Zones 表右側六欄，
   由 tools/config_tables.cjs 重建 data.js 的 ZONE_ENCOUNTER，這裡不再處理。 */
/* 菁英群組（參數表「4-菁英群組」）→ data.js 的 ELITE_GROUP（整個物件重建，註解寫在物件外面）。
   普通關菁英機率／群成員數／純菁英群機率在 Zones 表（ZONE_ENCOUNTER），不在這裡。
   群數權重沿用 {數量,權重} 的寫法（parseCountTuples）。 */
const ELITE_GROUP_CAT = '4-菁英群組';
function eliteGroupBody() {
  const n = (name, i) => {
    const v = Number(P(ELITE_GROUP_CAT, name, i));
    if (!Number.isFinite(v) || v < 0) throw new Error('菁英群組數值不可為負或非數字：' + name + ' 參數#' + i);
    return String(v);
  };
  return '\n  normalGroupCount: ['+ parseCountTuples(ELITE_GROUP_CAT, '普通關菁英群數量權重') + ']' +
    ',\n  leaders: ' + n('混合群與小兵', 0) + ', minionHp: ' + n('混合群與小兵', 1) +
    ', minionAtk: ' + n('混合群與小兵', 2) + ', minionReward: ' + n('混合群與小兵', 3) +
    ',\n  skillDmgPct: ' + n('菁英技能全域設定', 0) + ', cdPct: ' + n('菁英技能全域設定', 1) +
    ', firstCastMax: ' + n('菁英技能全域設定', 2) + ', maxZones: ' + n('菁英技能全域設定', 3) +
    ', summonCap: ' + n('菁英技能全域設定', 4) + ', linkBeam: ' + n('菁英技能全域設定', 5) +
    ',\n  advChance: [' + n('高級菁英機率', 0) + ', ' + n('高級菁英機率', 1) + ']' +
    ', advHp: ' + n('高級菁英倍率', 0) + ', advAtk: ' + n('高級菁英倍率', 1) + ', advReward: ' + n('高級菁英倍率', 2) +
    ',\n  sizeElite: ' + n('敵人體型倍率', 0) + ', sizeAdv: ' + n('敵人體型倍率', 1) + ', sizeBoss: ' + n('敵人體型倍率', 2) +
    ', sizeTower: [' + n('敵人體型倍率', 3) + ', ' + n('敵人體型倍率', 4) + ']' +
    ',\n  repoMin: ' + n('跑位設定', 0) + ', repoMax: ' + n('跑位設定', 1) + ', repoSpeed: ' + n('跑位設定', 2) +
    // 封魔塔 BOSS 的玩家技能（js/elite_boss.js）：整體強度的八個旋鈕
    ',\n  psDmgPct: ' + n('封魔塔BOSS玩家技能', 0) + ', psTickPct: ' + n('封魔塔BOSS玩家技能', 1) + ', psAreaPct: ' + n('封魔塔BOSS玩家技能', 2) +
    ', psBuffPct: ' + n('封魔塔BOSS玩家技能', 3) + ', psCtrlPct: ' + n('封魔塔BOSS玩家技能', 4) + ', psShieldPct: ' + n('封魔塔BOSS玩家技能', 5) +
    ', psReviveHpPct: ' + n('封魔塔BOSS玩家技能', 6) + ', psPassiveGap: ' + n('封魔塔BOSS玩家技能', 7);
}
edits.push({
  file: 'data', scopeVar: 'ELITE_GROUP',
  re: /ELITE_GROUP\s*=\s*\{([\s\S]*?)\n\};/,
  grp: 1, multiGroup: true, label: 'ELITE_GROUP（4-菁英群組）', value: eliteGroupBody()
});
// 戰場站位（敵方棋盤）：格數、距離係數、BOSS 佔格 → js/battlefield.js 讀這些常數
scalar('data', 'BF_COLS', '4-戰場站位', '棋盤格數', 0);
scalar('data', 'BF_ROWS', '4-戰場站位', '棋盤格數', 1);
scalar('data', 'BF_DIST_PER_COL', '4-戰場站位', '距離規則', 0);
scalar('data', 'BF_DIST_CENTER_ROW', '4-戰場站位', '距離規則', 1);
scalar('data', 'BF_DIST_OUTER_ROW', '4-戰場站位', '距離規則', 2);
scalar('data', 'BF_BOSS_W', '4-戰場站位', 'BOSS 佔格', 0);
scalar('data', 'BF_BOSS_H', '4-戰場站位', 'BOSS 佔格', 1);
// 野外 BOSS：出現階段、數值倍率、掉落倍率
scalar('data', 'FIELD_BOSS_STAGE_INTERVAL', '4-野外BOSS', '出現階段', 0);
scalar('data', 'FIELD_BOSS_HP_MULT', '4-野外BOSS', '數值倍率', 0);
scalar('data', 'FIELD_BOSS_ATK_MULT', '4-野外BOSS', '數值倍率', 1);
scalar('data', 'FIELD_BOSS_DEF_MULT', '4-野外BOSS', '數值倍率', 2);
scalar('data', 'FIELD_BOSS_REWARD_MULT', '4-野外BOSS', '數值倍率', 3);
scalar('data', 'FIELD_BOSS_DODGE_ADD', '4-野外BOSS', '數值倍率', 4);
scalar('data', 'FIELD_BOSS_ASPD', '4-野外BOSS', '數值倍率', 5);
scalar('data', 'FIELD_BOSS_DROP_MULT', '4-野外BOSS', '掉落倍率', 0);
// 掉落表：重建每個 min 檔的 rates
// 從 {下限~上限=值} 取出「值」；解析不出有效數字則中止（防 Excel 破壞後寫入垃圾）。
function parseTuple(cell) {
  cell = (cell == null ? '' : String(cell)).trim();
  // 空格、或被 Excel 自動填成純數字 0 的「空 bracket」一律視為 0%（該區段不掉落）。
  if (cell === '' || (/^-?[\d.]+$/.test(cell) && Number(cell) === 0)) return '0';
  const m = /=(-?[\d.]+)\}/.exec(cell);
  if (!m || !isFinite(Number(m[1]))) throw new Error('CSV 元組無法解析為數字（可能被 Excel 破壞）：「' + cell + '」');
  return m[1];
}
// 命中／閃避：CSV 以 {下限~上限=每級增加值} 或 {下限+=每級增加值} 表示。
function parseLevelGrowthBracket(cell) {
  cell = (cell == null ? '' : String(cell)).trim();
  const m = /^\{\s*(\d+)\s*(?:~\s*(\d+)|\+)\s*=\s*(-?[\d.]+)\s*\}$/.exec(cell);
  if (!m || !isFinite(Number(m[3]))) {
    throw new Error('CSV 等級區間無法解析為數字：「' + cell + '」');
  }
  return '{ min: ' + Number(m[1]) + (m[2] ? ', max: ' + Number(m[2]) : '') + ', rate: ' + Number(m[3]) + ' }';
}
function levelGrowthContent(cat, name) {
  const params = index[cat] && index[cat][name];
  if (!params) throw new Error('CSV 缺少等級區間參數：' + cat + ' / ' + name);
  const brackets = params.filter(cell => /^\s*\{/.test(String(cell))).map(parseLevelGrowthBracket);
  if (!brackets.length) throw new Error('CSV 缺少有效等級區間參數：' + cat + ' / ' + name);
  return brackets.join(',\n  ');
}
// 高塔裝備：CSV 每品質 7 bracket（1~5..31+）→ code min 1/6/11/16/21/26/31
{
  const quals = ['普通', '精良', '稀有', '獨特', '史詩', '傳說', '神話', '創世'];
  const minByIdx = [1, 6, 11, 16, 21, 26, 31];
  minByIdx.forEach((min, bi) => {
    const rates = quals.map(q => parseTuple(index['5-高塔裝備掉落'][q + '裝備'][bi]));
    edits.push({ file: 'data', scopeVar: 'BOSS_DROP_TABLE', re: new RegExp('min: ' + min + ',\\s*rates:\\s*\\[([^\\]]*)\\]'), grp: 1, value: rates.concat([0, 0, 0, 0]).join(', '), label: 'BOSS_DROP min' + min, multiGroup: true });
  });
}
// 寶石標價
[1,2,3,4,5,6,7,8,9,10].forEach((lv, i) => {
  edits.push({ file: 'data', re: new RegExp('lv: ' + lv + ', price: (\\d+)'), grp: 1, value: P('8-寶石商店', '寶石標價(Lv1~10)', i), label: '寶石標價Lv' + lv });
});
// 寶石商店刷出數量 / 階級表（整段重建）
function rebuildPairTable(varName, group) {
  const lines = [];
  for (let lv = 1; lv <= 20; lv++) {
    // 只取真正的「數量=機率」格；空格與被 Excel 填成純數字（如 0）的補位格一律略過。
    const params = index[group]['商店 Lv.' + lv].filter(x => x !== '' && x.indexOf('=') >= 0);
    const pairs = params.map(p => {
      const s = p.split('=');
      const n = Number(s[0]), pr = Number(s[1]);
      // 每格必須是「數量=機率」兩個有效數字；否則中止（Excel 常把含冒號的格轉成時間值破壞資料）。
      if (s.length !== 2 || !isFinite(n) || !isFinite(pr)) {
        throw new Error(group + ' 商店 Lv.' + lv + ' 的「' + p + '」無法解析為「數量=機率」（可能被 Excel 破壞）');
      }
      return '[' + n + ', ' + pr + ']';
    });
    lines.push('\n  [' + pairs.join(', ') + ']');
  }
  arrayContent('data', varName, lines.join(',') + '\n', varName);
}
rebuildPairTable('GEM_SHOP_COUNT_TABLE', '8-寶店刷出數量');
rebuildPairTable('GEM_SHOP_TIER_TABLE', '8-寶店刷出階級');
// 商人太古詞條分佈以具名資料表錨點接線，不綁內嵌程式碼。
const ancientCountPairs = index['神祕商人']['裝備太古詞條機率'].filter(x => x !== '' && x !== '0').map(text => {
  const pair = text.split('=').map(Number);
  if (pair.length !== 2 || !Number.isInteger(pair[0]) || pair[0] < 0 || !Number.isFinite(pair[1]) || pair[1] < 0) throw new Error('Store 裝備太古詞條機率需填「非負整數條數=機率%」');
  return pair;
});
if (!ancientCountPairs.length || new Set(ancientCountPairs.map(p => p[0])).size !== ancientCountPairs.length || Math.abs(ancientCountPairs.reduce((sum,p) => sum + p[1],0) - 100) > 1e-8) throw new Error('Store 裝備太古詞條機率不得重複條數，且總和須為100%');
arrayContent('data', 'MERCHANT_EQUIPMENT_ANCIENT_COUNT_TABLE', '\n  ' + ancientCountPairs.map(p => '[' + p.join(', ') + ']').join(', ') + '\n', '商人裝備太古詞條機率');

const merchantCategories = new Map([['寶石', 'gem'], ['裝備', 'equipment'], ['符文', 'rune'], ['遺物', 'relic']]);
const merchantSlots = new Map([
  ['武器', 'weapon'], ['頭盔', 'helmet'], ['肩甲', 'shoulder'], ['胸甲', 'chest'], ['腰帶', 'belt'],
  ['手套', 'gloves'], ['護腕', 'wrist'], ['腿甲', 'legs'], ['靴子', 'boots'], ['戒指', 'ring'], ['項鍊', 'amulet']
]);
function merchantIntegerKey(min, max) {
  return key => /^\d+$/.test(key) && Number(key) >= min && Number(key) <= max ? Number(key) : undefined;
}
const merchantLevelGroups = [
  ['MERCHANT_CATEGORY_TABLE', '8-商人刷出類別', key => merchantCategories.get(key), true],
  ['MERCHANT_EQUIPMENT_RARITY_TABLE', '8-商人裝備品質', merchantIntegerKey(0, 11)],
  ['MERCHANT_EQUIPMENT_SLOT_TABLE', '8-商人裝備部位', key => merchantSlots.get(key)],
  ['MERCHANT_EQUIPMENT_ANCIENT_LEVEL_TABLE', '8-商人裝備太古', merchantIntegerKey(0, Number.MAX_SAFE_INTEGER)],
  ['MERCHANT_RUNE_TIER_TABLE', '8-商人符文階級', merchantIntegerKey(1, 33)],
  ['MERCHANT_RELIC_TIER_TABLE', '8-商人遺物階級', merchantIntegerKey(1, Number.MAX_SAFE_INTEGER)]
];
const hasMerchantLevelRows = merchantLevelGroups.some(([, group]) => index[group]);
for (const [variable, group, parseKey, canDisable] of merchantLevelGroups) {
  const groupRows = storeRows.filter(row => row[COL_CAT] === group);
  if (hasMerchantLevelRows && groupRows.length !== 20) throw new Error('Store ' + group + ' 須有20列商店等級');
  const rows = Array.from({ length: 20 }, (_, i) => {
    if (!hasMerchantLevelRows) return null;
    const name = '商店 Lv.' + (i + 1);
    const label = 'Store ' + group + ' / ' + name;
    const cells = index[group] && index[group][name];
    if (!cells) throw new Error(label + ' 缺少機率列');
    const entries = cells.map(cell => cell.trim()).filter(cell => cell !== '' && cell !== '0');
    if (!entries.length) return null;
    const pairs = entries.map(cell => {
      const parts = cell.split('=').map(part => part.trim());
      const key = parseKey(parts[0]);
      const chance = Number(parts[1]);
      if (parts.length !== 2 || key === undefined || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(parts[1]) || !Number.isFinite(chance) || chance > 100) {
        throw new Error(label + ' 的「' + cell + '」需填有效項目=機率%');
      }
      return [key, chance];
    });
    const total = pairs.reduce((sum, pair) => sum + pair[1], 0);
    if (new Set(pairs.map(pair => pair[0])).size !== pairs.length || (!(canDisable && total === 0) && Math.abs(total - 100) > 1e-8)) {
      throw new Error(label + ' 不得重複項目，機率總和須為100%');
    }
    return pairs;
  });
  arrayContent('data', variable, '\n  ' + rows.map(row => JSON.stringify(row).replace(/,/g, ', ')).join(',\n  ') + '\n', variable);
}

/* ---- formula.js 具名常數 ---- */
scalar('formula', 'GLOBAL_DMG_RED_CAP', '2-屬性派生', '全局減傷', 0);
scalar('formula', 'GLOBAL_DMG_RED_DENOMINATOR', '2-屬性派生', '全局減傷', 1);
scalar('formula', 'SLOW_ASPD_FACTOR', '3-戰鬥核心', '減速狀態攻速', 0);
scalar('formula', 'CONTROL_DECAY_PER_HIT_ACT', '3-戰鬥核心', '控場遞減', 0);
scalar('formula', 'CONTROL_DECAY_PER_HIT_ASPD', '3-戰鬥核心', '控場遞減', 1);
scalar('formula', 'CONTROL_DECAY_PER_HIT_MOVE', '3-戰鬥核心', '控場遞減', 2);
scalar('formula', 'CONTROL_DECAY_MERGE_SEC', '3-戰鬥核心', '控場遞減', 3);
scalar('formula', 'BASE_HP_REGEN', '2-屬性派生', '野外基礎生命恢復', 0);
scalar('formula', 'WAVE_CLEAR_HEAL_PCT', '3-戰鬥核心', '過關回復', 0);
scalar('formula', 'DROP_RATE_EFFECT_MULT', '5-掉落通則', '掉寶率效果折半', 0);
scalarValue('formula', 'ANCIENT_AFFIX_SALVAGE_CHANCE', 50, 'ANCIENT_AFFIX_SALVAGE_CHANCE'); // 每條太古詞條的拆解判定機率
scalarValue('formula', 'SALVAGE_SLOT_MAX', 20, 'SALVAGE_SLOT_MAX');
scalarValue('formula', 'SALVAGE_SLOT_INITIAL', 10, 'SALVAGE_SLOT_INITIAL');
// 舊分解槽已退役；保留相容公式的固定值，不讓新版熔爐參數改變舊存檔行為。
scalarValue('formula', 'SALVAGE_SLOT_UNLOCK_GOLD_BASE', 10000, 'SALVAGE_SLOT_UNLOCK_GOLD_BASE');
scalarValue('formula', 'SALVAGE_SLOT_UNLOCK_GOLD_RATE', 3, 'SALVAGE_SLOT_UNLOCK_GOLD_RATE');
scalar('data', 'NEW_FORGE_SLOT_COST_A', '7-分解槽', '分解槽解鎖費用', 0);
scalar('data', 'NEW_FORGE_SLOT_COST_B', '7-分解槽', '分解槽解鎖費用', 1);
scalar('data', 'NEW_FORGE_SLOT_COST_C', '7-分解槽', '分解槽解鎖費用', 2);
scalar('data', 'NEW_FORGE_SLOT_COST_D', '7-分解槽', '分解槽解鎖費用', 3);
scalar('formula', 'OFFLINE_MAX_HOURS', '10-離線', '有效離線時間', 0);
scalar('formula', 'OFFLINE_LEVEL_REDUCE', '10-離線', '計算等級', 0);
scalar('formula', 'OFFLINE_KILL_INTERVAL', '10-離線', '擊殺速率', 0);
/* 下面三個要等 Excel 補上欄位／列才會生效，在那之前 scalarOpt 會跳過並列在報表最後。
   「計算等級」列目前只有參數a（扣減），b（取整單位）與 c（關卡比例）是新增的欄位。 */
scalarOpt('formula', 'OFFLINE_STAGE_ROUND', '10-離線', '計算等級', 1);
scalarOpt('formula', 'OFFLINE_STAGE_RATIO', '10-離線', '計算等級', 2);
scalarOpt('formula', 'OFFLINE_ELITE', '10-離線', '怪物種類', 0);
scalar('formula', 'SKILL_CAST_LOCK', '9-技能', '施放硬直', 0);
// 參數b：放出後角色多站定幾秒（等 Excel 參數b 填值才生效；填 0 或空白＝不站定，scalarOpt 會跳過）
scalarOpt('formula', 'SKILL_CAST_HOLD', '9-技能', '施放硬直', 1);
scalar('formula', 'SKILL_MIN_CAST_INTERVAL', '9-技能', '技能施放最短間隔', 0);
// 參數a～l依序對應R0～R11的附魔精華拆解機率。
arrayContent('formula', 'ESSENCE_SALVAGE_CHANCE_BY_RARITY',
  index['6-分解精華機率']['附魔精華拆解機率'].slice(0, 12).join(', '), 'ESSENCE_SALVAGE_CHANCE_BY_RARITY');
// R4～R11的太古精華拆解機率；普通～獨特不產出基礎精華，太古詞條另行判定。
['4', '5', '6', '7', '8', '9', '10', '11'].forEach(k => {
  objField('data', 'ANCIENT_ESSENCE_SALVAGE_CHANCE = {', k, '6-分解精華機率', '太古精華拆解機率(依稀有度)', Number(k), '太古拆解機率.' + k);
});
// SCORE_WEIGHTS（戰力權重）：2026-07-23 已撥離至 Equipment_Affix 表各詞條列的「戰力權重」欄（config_tables.cjs 管理），
// 本表不再定義「表-戰力權重」錨點；主參數表殘留該分類列一律視為死列忽略。

/* ---- formula.js 內嵌係數（唯一片段） ---- */
// 升級經驗：係數 × 等級^次方 + 常數
objFieldML('data', 'XP_LEVEL_COEF = {', 'a', '1-成長經驗', '升級所需經驗', 0, 'xp-a（係數）');
objFieldML('data', 'XP_LEVEL_COEF = {', 'b', '1-成長經驗', '升級所需經驗', 1, 'xp-b（次方）');
objFieldML('data', 'XP_LEVEL_COEF = {', 'c', '1-成長經驗', '升級所需經驗', 2, 'xp-c（常數）');
// 基礎四維：基底 + (等級-1) × 每級增加
objFieldML('data', 'PRIMARY_STAT_GROWTH = {', 'base', '1-成長經驗', '等級基礎四維', 0, '四維-a（基底）');
objFieldML('data', 'PRIMARY_STAT_GROWTH = {', 'perLevel', '1-成長經驗', '等級基礎四維', 1, '四維-b（每級）');
// 野外怪物成長：各項 = (a + 關卡 × b) × c^(關卡-1)；係數見 data.js FIELD_MONSTER_GROWTH。
objFieldML('data', 'FIELD_MONSTER_GROWTH = {', 'hpA', '4-野外怪物', '生命', 0, 'hp-a');
objFieldML('data', 'FIELD_MONSTER_GROWTH = {', 'hpB', '4-野外怪物', '生命', 1, 'hp-b');
objFieldML('data', 'FIELD_MONSTER_GROWTH = {', 'hpC', '4-野外怪物', '生命', 2, 'hp-c');
objFieldML('data', 'FIELD_MONSTER_GROWTH = {', 'atkA', '4-野外怪物', '攻擊', 0, 'atk-a');
objFieldML('data', 'FIELD_MONSTER_GROWTH = {', 'atkB', '4-野外怪物', '攻擊', 1, 'atk-b');
objFieldML('data', 'FIELD_MONSTER_GROWTH = {', 'atkC', '4-野外怪物', '攻擊', 2, 'atk-c');
objFieldML('data', 'FIELD_MONSTER_GROWTH = {', 'defA', '4-野外怪物', '物理防禦', 0, 'def-a');
objFieldML('data', 'FIELD_MONSTER_GROWTH = {', 'defB', '4-野外怪物', '物理防禦', 1, 'def-b');
objFieldML('data', 'FIELD_MONSTER_GROWTH = {', 'defC', '4-野外怪物', '物理防禦', 2, 'def-c');
objFieldML('data', 'FIELD_MONSTER_GROWTH = {', 'goldA', '4-野外怪物', '金幣', 0, 'gold-a');
objFieldML('data', 'FIELD_MONSTER_GROWTH = {', 'goldC', '4-野外怪物', '金幣', 2, 'gold-c');
objFieldML('data', 'FIELD_MONSTER_GROWTH = {', 'xpA', '4-野外怪物', '經驗', 0, 'xp2-a');
objFieldML('data', 'FIELD_MONSTER_GROWTH = {', 'xpC', '4-野外怪物', '經驗', 2, 'xp2-c');
objFieldML('data', 'FIELD_MONSTER_GROWTH = {', 'aspd', '4-野外怪物', '攻擊速度', 0, 'mob-aspd');
// 野外怪物命中／閃避：基礎值 + 各等級區間的每級增加值累加。
scalar('data', 'FIELD_MONSTER_DODGE_BASE', '4-野外怪物', '閃避率', 0);
arrayContent('data', 'FIELD_MONSTER_DODGE_GROWTH', levelGrowthContent('4-野外怪物', '閃避率'), '怪物閃避分段成長');
scalar('data', 'FIELD_MONSTER_HIT_BASE', '4-野外怪物', '命中率', 0);
arrayContent('data', 'FIELD_MONSTER_HIT_GROWTH', levelGrowthContent('4-野外怪物', '命中率'), '怪物命中分段成長');

/* ---- §2 玩家屬性派生（computeStats） ---- */
objFieldML('data', 'DERIVED_COEF = {', 'hpBase', '2-屬性派生', '生命上限', 0, 'hp基底');
objFieldML('data', 'DERIVED_COEF = {', 'hpPerLevel', '2-屬性派生', '生命上限', 1, 'hp每級');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'vitHp', '2-屬性派生', '生命上限', 2, 'hp每耐');
objFieldML('data', 'DERIVED_COEF = {', 'mpBase', '2-屬性派生', '法力上限', 0, 'mp基底');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'intMp', '2-屬性派生', '法力上限', 1, 'mp每智');
objFieldML('data', 'DERIVED_COEF = {', 'mpRegenBase', '2-屬性派生', '法力恢復/秒', 0, 'mpregen基底');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'intMpRegen', '2-屬性派生', '法力恢復/秒', 1, 'mpregen每智');
// 物攻/魔攻 = (a + 定值 + b×定值×c^轉生次數 + 主屬×d) × (1+對應%)；物防/魔防另有體質×e、共用攻擊%
objFieldML('data', 'DERIVED_COEF = {', 'atkBase', '2-屬性派生', '物理攻擊', 0, 'atk基底a');
objFieldML('data', 'DERIVED_COEF = {', 'atkFlatMult', '2-屬性派生', '物理攻擊', 1, 'atk定值係數b');
objFieldML('data', 'DERIVED_COEF = {', 'atkReincBase', '2-屬性派生', '物理攻擊', 2, 'atk轉生指數底c');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'strAtk', '2-屬性派生', '物理攻擊', 3, 'atk每力d');
objFieldML('data', 'DERIVED_COEF = {', 'matkBase', '2-屬性派生', '魔法攻擊', 0, 'matk基底a');
objFieldML('data', 'DERIVED_COEF = {', 'matkFlatMult', '2-屬性派生', '魔法攻擊', 1, 'matk定值係數b');
objFieldML('data', 'DERIVED_COEF = {', 'matkReincBase', '2-屬性派生', '魔法攻擊', 2, 'matk轉生指數底c');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'intMatk', '2-屬性派生', '魔法攻擊', 3, 'matk每智d');
objFieldML('data', 'DERIVED_COEF = {', 'defBase', '2-屬性派生', '物理防禦', 0, 'def基底a');
objFieldML('data', 'DERIVED_COEF = {', 'defFlatMult', '2-屬性派生', '物理防禦', 1, 'def定值係數b');
objFieldML('data', 'DERIVED_COEF = {', 'defReincBase', '2-屬性派生', '物理防禦', 2, 'def轉生指數底c');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'strDef', '2-屬性派生', '物理防禦', 3, 'def每力d');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'vitDef', '2-屬性派生', '物理防禦', 4, 'def每耐e');
objFieldML('data', 'DERIVED_COEF = {', 'mdefBase', '2-屬性派生', '魔法防禦', 0, 'mdef基底a');
objFieldML('data', 'DERIVED_COEF = {', 'mdefFlatMult', '2-屬性派生', '魔法防禦', 1, 'mdef定值係數b');
objFieldML('data', 'DERIVED_COEF = {', 'mdefReincBase', '2-屬性派生', '魔法防禦', 2, 'mdef轉生指數底c');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'intMdef', '2-屬性派生', '魔法防禦', 3, 'mdef每智d');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'vitMdef', '2-屬性派生', '魔法防禦', 4, 'mdef每耐e');
objFieldML('data', 'DERIVED_COEF = {', 'critRateBase', '2-屬性派生', '暴擊率', 0, '暴擊率基底');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'agiCritRate', '2-屬性派生', '暴擊率', 1, '暴擊率每敏');
objFieldML('data', 'DERIVED_COEF = {', 'critDmgBase', '2-屬性派生', '暴擊傷害', 0, '暴傷基底');
objFieldML('data', 'COMBO_HITS_COEF = {', 'trigger', '2-屬性派生', '連擊數', 0, '連擊數-觸發率');
objFieldML('data', 'COMBO_HITS_COEF = {', 'crit', '2-屬性派生', '連擊數', 1, '連擊數-暴擊a');
objFieldML('data', 'COMBO_HITS_COEF = {', 'aspd', '2-屬性派生', '連擊數', 2, '連擊數-攻速a');
objFieldML('data', 'COMBO_HITS_COEF = {', 'cdr', '2-屬性派生', '連擊數', 3, '連擊數-冷卻縮減a');
scalar('data', 'ASPD_BASE', '2-屬性派生', '攻擊速度', 0);
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'agiAspdPct', '2-屬性派生', '攻擊速度', 1, '攻速每敏');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'agiHit', '2-屬性派生', '命中率', 0, '命中每敏');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'agiEvasion', '2-屬性派生', '閃避率', 0, '閃避每敏');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'strHpRegen', '2-屬性派生', '生命恢復/秒', 0, 'hpregen每力');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'vitHpRegen', '2-屬性派生', '生命恢復/秒', 1, 'hpregen每體');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'vitMpRegen', '2-屬性派生', '法力恢復/秒', 2, 'mpregen每體');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'agiCritDmg', '2-屬性派生', '暴擊傷害', 1, '暴傷每敏');

/* ---- §2 屬性上限：單一來源 STAT_CAPS（data.js）；formula.js 夾限與 data.js 面板顯示/提示皆引用之 ---- */
objFieldML('data', 'STAT_CAPS = {', 'critRate', '2-屬性上限', '暴擊率 上限', 0, '上限-暴擊率');
objFieldML('data', 'STAT_CAPS = {', 'pPen', '2-屬性上限', '物理穿透 上限', 0, '上限-物穿');
objFieldML('data', 'STAT_CAPS = {', 'mPen', '2-屬性上限', '魔法穿透 上限', 0, '上限-魔穿');
objFieldML('data', 'STAT_CAPS = {', 'cdr', '2-屬性上限', '冷卻縮減 上限', 0, '上限-CDR');
objFieldML('data', 'STAT_CAPS = {', 'castSpeed', '2-屬性上限', '施法速度 上限', 0, '上限-施法');
objFieldML('data', 'STAT_CAPS = {', 'lifesteal', '2-屬性上限', '吸血 上限', 0, '上限-吸血');
objFieldML('data', 'STAT_CAPS = {', 'manaSteal', '2-屬性上限', '吸魔 上限', 0, '上限-吸魔');
objFieldML('data', 'STAT_CAPS = {', 'blockRate', '2-屬性上限', '格擋率 上限', 0, '上限-格擋率');
objFieldML('data', 'STAT_CAPS = {', 'blockDmgRed', '2-屬性上限', '格擋減傷(詞條部分) 上限', 0, '上限-格擋減傷');
objFieldML('data', 'STAT_CAPS = {', 'evasion', '2-屬性上限', '閃避率 上限', 0, '上限-閃避');
objFieldML('data', 'STAT_CAPS = {', 'tenacity', '2-屬性上限', '韌性 上限', 0, '上限-韌性');
objFieldML('data', 'STAT_CAPS = {', 'ctrlRes', '2-屬性上限', '控制抵抗 上限', 0, '上限-控抗');
objFieldML('data', 'STAT_CAPS = {', 'ccRed', '2-屬性上限', '控制時間縮減 上限', 0, '上限-控縮');
objFieldML('data', 'STAT_CAPS = {', 'moveSpeed', '2-屬性上限', '移動速度 上限', 0, '上限-移速');
objFieldML('data', 'STAT_CAPS = {', 'luck', '2-屬性上限', '幸運值 上限', 0, '上限-幸運');
objFieldML('data', 'STAT_CAPS = {', 'hybridMutation', '2-屬性上限', '合成變異率 上限', 0, '上限-變異');
objFieldML('data', 'STAT_CAPS = {', 'enrageThreshold', '2-屬性上限', '狂暴閾值 上限', 0, '上限-狂暴');
objFieldML('data', 'STAT_CAPS = {', 'affixCap', '2-屬性上限', '詞條上限率 上限', 0, '上限-詞條率');
objFieldML('data', 'STAT_CAPS = {', 'doubleHit', '2-屬性上限', '被動-連擊 上限', 0, '上限-連擊');
objFieldML('data', 'STAT_CAPS = {', 'stun', '2-屬性上限', '被動-暈眩 上限', 0, '上限-暈眩');

/* ---- §3 戰鬥核心 ---- */
scalar('formula', 'PHYSICAL_RESISTANCE_A', '3-戰鬥核心', '物理抗性減傷', 0);
scalar('formula', 'PHYSICAL_RESISTANCE_B', '3-戰鬥核心', '物理抗性減傷', 1);
scalar('formula', 'PHYSICAL_RESISTANCE_C', '3-戰鬥核心', '物理抗性減傷', 2);
scalar('formula', 'MAGIC_RESISTANCE_A', '3-戰鬥核心', '魔法抗性減傷', 0);
scalar('formula', 'MAGIC_RESISTANCE_B', '3-戰鬥核心', '魔法抗性減傷', 1);
scalar('formula', 'MAGIC_RESISTANCE_C', '3-戰鬥核心', '魔法抗性減傷', 2);
scalar('formula', 'ELEMENTAL_RESISTANCE_A', '3-戰鬥核心', '六系元素抗性減傷', 0);
scalar('formula', 'ELEMENTAL_RESISTANCE_B', '3-戰鬥核心', '六系元素抗性減傷', 1);
scalar('formula', 'ELEMENTAL_RESISTANCE_C', '3-戰鬥核心', '六系元素抗性減傷', 2);
/* 防禦減傷曲線的兩個係數。錨點必須用 inlineRegex 而不是 inline——
   inline 會把前綴原文寫死，於是「常數」被套用之後，「每級係數」的錨點
   'return def / (def + 60 + ' 就再也對不上了（60 已經變成別的值）。
   實際發生過：2026-08-02 的參數套用把常數從 60 改成 10000，下一次試跑就報
   「防減-每級：錨點匹配 0 次」，那個參數從此靜靜地套不進去。
   結構型錨點只描述公式形狀，同一條公式裡的參數彼此不會互相打死。 */
scalar('formula', 'DEF_REDUCTION_CONST', '3-戰鬥核心', '防禦減傷率', 0);
scalar('formula', 'DEF_REDUCTION_PER_LEVEL', '3-戰鬥核心', '防禦減傷率', 1);
scalar('formula', 'DEF_REDUCTION_FLOOR', '3-戰鬥核心', '防禦減傷率', 2);   // c：a + b×等級差 的下限
// 敵種傷害抗性（普通敵人/普通菁英/普通BOSS）：a/b/c；表列缺席時跳過（相容尚未含此列的舊參數表）
if (index['3-戰鬥核心'] && index['3-戰鬥核心']['敵種傷害抗性']) {
  scalar('formula', 'ENEMY_TYPE_DMG_RED_A', '3-戰鬥核心', '敵種傷害抗性', 0);
  scalar('formula', 'ENEMY_TYPE_DMG_RED_B', '3-戰鬥核心', '敵種傷害抗性', 1);
  scalar('formula', 'ENEMY_TYPE_DMG_RED_C', '3-戰鬥核心', '敵種傷害抗性', 2);
}
scalar('formula', 'DAMAGE_VARIANCE_MIN', '3-戰鬥核心', '傷害浮動', 0);
scalar('formula', 'DAMAGE_VARIANCE_MAX', '3-戰鬥核心', '傷害浮動', 1);
scalar('formula', 'DAMAGE_MIN', '3-戰鬥核心', '最低傷害下限', 0);
objFieldML('formula', 'ELEM_PROC = {', 'iceSlowChance', '3-元素特效', '冰霜 特效', 0, '元素-冰');
objFieldML('formula', 'ELEM_PROC = {', 'lightningChance', '3-元素特效', '雷電 特效', 0, '元素-雷');
objFieldML('formula', 'ELEM_PROC = {', 'poisonChance', '3-元素特效', '劇毒 特效', 0, '元素-毒');
objFieldML('formula', 'ELEM_PROC = {', 'lightCleanseChance', '3-元素特效', '聖光 特效', 0, '元素-光');
scalar('formula', 'GODFORGED_SANCTUARY_RED_CAP', '3-戰鬥核心', '聖佑(神鑄)減傷上限', 0);
scalar('formula', 'GODFORGED_UNDYING_COOLDOWN_SEC', '3-戰鬥核心', '不朽(神鑄)回復', 1);

/* ---- §4 高塔 BOSS ---- */
// 挑戰金幣消耗分層：CSV 以 {下限~上限,a=係數,b=指數} 逐段表示 → 重建 TOWER_CHALLENGE_COST_TIERS。
{
  const segCells = ((index['4-高塔BOSS'] && index['4-高塔BOSS']['挑戰金幣消耗']) || [])
    .filter(c => /^\s*\{/.test(String(c)));
  if (!segCells.length) throw new Error('CSV 缺少高塔挑戰金幣消耗分層參數（需 {下限~上限,a=,b=}）');
  const tiers = segCells.map(cell => {
    const m = /^\{\s*(-?[\d.]+)\s*~\s*(-?[\d.]+)\s*,\s*a\s*=\s*(-?[\d.]+)\s*,\s*b\s*=\s*(-?[\d.]+)\s*\}$/.exec(String(cell).trim());
    if (!m) throw new Error('高塔挑戰金幣消耗分層格式錯誤：「' + cell + '」（需 {下限~上限,a=,b=}）');
    return '{ min: ' + Number(m[1]) + ', max: ' + Number(m[2]) + ', a: ' + Number(m[3]) + ', b: ' + Number(m[4]) + ' }';
  });
  arrayContent('data', 'TOWER_CHALLENGE_COST_TIERS', '\n  ' + tiers.join(',\n  ') + '\n', 'TOWER_CHALLENGE_COST_TIERS');
}

/* ---- §5 稀有度擲骰（rollRarity） ---- */
objFieldML('formula', 'RARITY_ROLL = {', 'bonusDivisor', '5-稀有度擲骰', '權重加成 b', 0, '權重加成除數');
objFieldML('formula', 'RARITY_ROLL = {', 'bonusPerStage', '5-稀有度擲骰', '權重加成 b', 1, '權重加成每階');
/* 稀有度權重表：每一列形如 [稀有度索引, 權重 * Math.min(b, 上限)]，
   高稀有度另有解鎖階段門檻 (s >= 門檻 ? 權重 : 0)。

   ⚠️ 「上限」的錨點不能綁權重值。綁了的話，權重一被套用，上限就再也對不上——
   而且是靜靜地對不上，那個參數從此形同從參數表消失。實測擾動全表時，
   這裡的 7 個上限全部失配。結構型錨點只認公式形狀，彼此不會互相打死。 */
objFieldML('formula', 'RARITY_ROLL = {', 'commonWeight', '5-稀有度擲骰', '普通 權重', 0, '權重-普通');
objFieldML('formula', 'RARITY_ROLL = {', 'uncommonWeight', '5-稀有度擲骰', '精良 權重', 0, '權重-精良');
objFieldML('formula', 'RARITY_ROLL = {', 'uncommonCap', '5-稀有度擲骰', '精良 權重', 2, '上限-精良');
objFieldML('formula', 'RARITY_ROLL = {', 'rareWeight', '5-稀有度擲骰', '稀有 權重', 0, '權重-稀有');
objFieldML('formula', 'RARITY_ROLL = {', 'rareCap', '5-稀有度擲骰', '稀有 權重', 2, '上限-稀有');
objFieldML('formula', 'RARITY_ROLL = {', 'uniqueWeight', '5-稀有度擲骰', '獨特 權重', 0, '權重-獨特');
objFieldML('formula', 'RARITY_ROLL = {', 'uniqueCap', '5-稀有度擲骰', '獨特 權重', 2, '上限-獨特');
/* 史詩以上多一層階段門檻。門檻值本身也是參數（權重欄位 1），所以連它一起萬用掉。 */
objFieldML('formula', 'RARITY_ROLL = {', 'epicWeight', '5-稀有度擲骰', '史詩 權重', 0, '權重-史詩');
objFieldML('formula', 'RARITY_ROLL = {', 'epicCap', '5-稀有度擲骰', '史詩 權重', 2, '上限-史詩');
objFieldML('formula', 'RARITY_ROLL = {', 'legendaryWeight', '5-稀有度擲骰', '傳說 權重', 0, '權重-傳說');
objFieldML('formula', 'RARITY_ROLL = {', 'legendaryCap', '5-稀有度擲骰', '傳說 權重', 2, '上限-傳說');
objFieldML('formula', 'RARITY_ROLL = {', 'mythicWeight', '5-稀有度擲骰', '神話 權重', 0, '權重-神話');
objFieldML('formula', 'RARITY_ROLL = {', 'mythicCap', '5-稀有度擲骰', '神話 權重', 2, '上限-神話');
objFieldML('formula', 'RARITY_ROLL = {', 'genesisWeight', '5-稀有度擲骰', '創世 權重', 0, '權重-創世');
objFieldML('formula', 'RARITY_ROLL = {', 'genesisCap', '5-稀有度擲骰', '創世 權重', 2, '上限-創世');

/* ---- §6 裝備 ---- */
scalar('formula', 'UPGRADE_VALUE_MULT', '6-裝備', '強化倍率', 0);
// 附魔攻擊類：v = (base + item.level * per)。base 與 per 互不硬編（任一被調整，另一錨點也不會失配）；
// 以「+ item.level *」限定只中 §6 附魔攻那行，不誤中同檔另一處 `var v = (def.base + ...`。
objFieldML('formula', 'ENCHANT_ATK = {', 'base', '6-裝備', '附魔-攻擊類', 0, '附魔攻-基');
objFieldML('formula', 'ENCHANT_ATK = {', 'perLevel', '6-裝備', '附魔-攻擊類', 1, '附魔攻-每級');
objFieldML('formula', 'ENCHANT_ATK = {', 'perGemLevel', '6-裝備', '附魔-攻擊類', 2, '附魔攻-每寶石');
objFieldML('formula', 'ENCHANT_DEF = {', 'base', '6-裝備', '附魔-防禦/功能類', 0, '附魔防-基');
objFieldML('formula', 'ENCHANT_DEF = {', 'perRarity', '6-裝備', '附魔-防禦/功能類', 1, '附魔防-每階');
objFieldML('formula', 'ENCHANT_DEF = {', 'perGemLevel', '6-裝備', '附魔-防禦/功能類', 2, '附魔防-每寶石');
objFieldML('formula', 'ENCHANT_DEF = {', 'cap', '6-裝備', '附魔-防禦/功能類', 3, '附魔防-上限');
objFieldML('formula', 'SALVAGE_SCRAP = {', 'base', '6-裝備', '分解-碎片', 0, '分解碎-基');
objFieldML('formula', 'SALVAGE_SCRAP = {', 'perLevel', '6-裝備', '分解-碎片', 1, '分解碎-每級');
objFieldML('formula', 'SALVAGE_GOLD = {', 'base', '6-裝備', '分解-金幣', 0, '分解金-基');
objFieldML('formula', 'SALVAGE_GOLD = {', 'mult', '6-裝備', '分解-金幣', 1, '分解金-倍率');

/* ---- §7 強化 / 洗煉 ---- */
objFieldML('formula', 'UPGRADE_SUCCESS = {', 'floor', '7-強化', '基礎成功率', 0, '強化率下限');
objFieldML('formula', 'UPGRADE_SUCCESS = {', 'decayPerLevel', '7-強化', '基礎成功率', 1, '強化率遞減');
/* 強化／洗煉費用：形如 <資源>: Math.round(係數 * Math.pow(底, 指數變數) * (1 + it.level * 每級))
   三個參數同在一行，錨點一律萬用掉其他兩個，否則套用其中一個就會打死另外兩個。
   以 lv / it.rarity 這個指數變數區分強化與洗煉，兩者的行形狀在其餘部分相同。 */
objFieldML('formula', 'UPGRADE_COST_GOLD = {', 'coef', '7-強化', '金幣費用', 0, '強化金-係數');
objFieldML('formula', 'UPGRADE_COST_GOLD = {', 'base', '7-強化', '金幣費用', 1, '強化金-底');
objFieldML('formula', 'UPGRADE_COST_GOLD = {', 'perLevel', '7-強化', '金幣費用', 2, '強化金-每級');
objFieldML('formula', 'UPGRADE_COST_SCRAP = {', 'coef', '7-強化', '碎片費用', 0, '強化碎-係數');
objFieldML('formula', 'UPGRADE_COST_SCRAP = {', 'base', '7-強化', '碎片費用', 1, '強化碎-底');
objFieldML('formula', 'UPGRADE_COST_SCRAP = {', 'perLevel', '7-強化', '碎片費用', 2, '強化碎-每級');
objFieldML('formula', 'REROLL_COST_GOLD = {', 'coef', '7-洗煉', '金幣費用', 0, '洗煉金-係數');
objFieldML('formula', 'REROLL_COST_GOLD = {', 'base', '7-洗煉', '金幣費用', 1, '洗煉金-底');
objFieldML('formula', 'REROLL_COST_GOLD = {', 'perLevel', '7-洗煉', '金幣費用', 2, '洗煉金-每級');
scalar('formula', 'AFFIX_REROLL_LOWER_WEIGHT', '7-洗煉', '數值洗煉分段權重', 0);
scalar('formula', 'AFFIX_REROLL_UPPER_BASE_WEIGHT', '7-洗煉', '數值洗煉分段權重', 1);
scalar('formula', 'AFFIX_REROLL_BIAS_EXPONENT', '7-洗煉', '數值洗煉分段權重', 2);

/* ---- §8 寶石 ---- */
/* 寶石商店升級費用改由 data.js 的三個具名常數承接（見上方 GEM_SHOP_UPGRADE_* 的 scalar），
   原本這裡是三條 inline／inlineRegex 錨點，直接改寫 formula.js 算式裡的字面值。

   為什麼換掉：那種錨點綁的是「程式碼長什麼樣子」。`Math.pow(level, ` 這個錨點連
   「有沒有別的函式也這樣寫」都分不出來，而且任何人把字面值抽成常數（正是本次做的事）
   錨點就 0 命中——套用參數表會安靜地少套三個值，只有仔細看試跑輸出才會發現。
   改成具名常數之後，錨點綁的是變數名，與算式怎麼寫無關。 */

/* ---- §9 技能 ---- */
// 技能裝載欄：第 3~6 格各一條解鎖門檻（system_unlock 表「技能裝載欄 第N格」；前 2 格開局即有，見 formula.js LOADOUT_BASE_SLOTS）
arrayContent('formula', 'LOADOUT_SLOT_UNLOCKS', '\n' + [3, 4, 5, 6].map(n => {
  const u = systemUnlock('技能裝載欄 第' + n + '格');
  return '  { level: ' + u.level + ', reinc: ' + u.reinc + ' }';
}).join(',\n') + '\n', 'LOADOUT_SLOT_UNLOCKS（system_unlock）');

/* ---- Batch2a：補接 formula.js 內漏接的可調單值（多值行用正規式避免相依錨點失配） ---- */
objFieldML('formula', 'TOWER_REWARD = {', 'goldPerFloor', '5-高塔獎勵', '金幣', 0, '高塔-金幣');
objFieldML('formula', 'TOWER_REWARD = {', 'gemFloorsPerLevel', '5-高塔獎勵', '寶石', 0, '高塔-寶石');
objFieldML('formula', 'TOWER_REWARD = {', 'essenceBase', '5-高塔獎勵', '附魔精華', 0, '高塔-附魔精華');
objFieldML('formula', 'TOWER_REWARD = {', 'itemLevelBase', '5-高塔獎勵', '裝備戰利品等級', 0, '高塔-裝備等級底');
objFieldML('formula', 'TOWER_REWARD = {', 'itemLevelPerFloor', '5-高塔獎勵', '裝備戰利品等級', 1, '高塔-裝備等級係數');
scalar('formula', 'ITEM_SCORE_GODFORGED_PER_PASSIVE', '6-裝備', '戰力評分', 0);
scalar('formula', 'ITEM_SCORE_PER_RARITY', '6-裝備', '戰力評分', 1);
// 背包擴充費用：a + b × c^購買次數（具名常數；a/b/c＝參數 0/1/2）
scalar('data', 'INVENTORY_EXPAND_COST_BASE', '7-容量', '背包擴充費用', 0);
scalar('data', 'INVENTORY_EXPAND_COST_MULT', '7-容量', '背包擴充費用', 1);
scalar('data', 'INVENTORY_EXPAND_COST_RATE', '7-容量', '背包擴充費用', 2);
scalar('formula', 'GEM_CONVERT_SLOTS', '8-寶石', '寶石轉換(九宮格)', 0);
scalar('formula', 'GEM_CONVERT_STACK', '8-寶石', '寶石轉換(九宮格)', 1);
scalar('formula', 'GEM_DISMANTLE_KEEP', '8-寶石', '寶石拆解(融合)', 0);

/* ---- Batch2b：跨檔（formula/combat/item）補接 ---- */
// 護盾（單一常數；使用者採表格值：溢出轉護盾 1%、護盾上限 10%）
scalar('formula', 'SHIELD_OVERFLOW_PCT', '3-戰鬥核心', '溢出治療轉護盾', 0);
scalar('formula', 'SHIELD_HEAL_CAP_PCT', '3-戰鬥核心', '護盾上限(治療轉化)', 0);
scalar('formula', 'SHIELD_SKILL_CAP_PCT', '3-戰鬥核心', '護盾上限(技能給予)', 0);
// 菁英倍率（formula.js；金幣與經驗共用參數 c）
objFieldML('data', 'FIELD_ELITE = {', 'hpMult', '4-野外怪物', '菁英倍率', 0, '菁英-生命');
objFieldML('data', 'FIELD_ELITE = {', 'atkMult', '4-野外怪物', '菁英倍率', 1, '菁英-攻擊');
objFieldML('data', 'FIELD_ELITE = {', 'rewardMult', '4-野外怪物', '菁英倍率', 2, '菁英-獎勵');
objFieldML('data', 'FIELD_ELITE = {', 'dodgeAdd', '4-野外怪物', '菁英倍率', 3, '菁英-閃避');
objFieldML('data', 'FIELD_ELITE = {', 'aspd', '4-野外怪物', '菁英倍率', 4, '菁英-攻速');
// 怪物命中 fallback（monsterAtkCfg：hit: m.hit || a；實際命中率由「4-野外怪物/命中率」與「4-高塔BOSS/命中率」的 m.hit 驅動，此處僅為保底預設值）
scalar('data', 'MONSTER_DEFAULT_HIT', '3-戰鬥核心', '怪物固定戰鬥值', 0);
// 敵人爆擊（formula.js §4；2026-07-30 起依敵種區分，取代原「怪物固定戰鬥值」的暴擊a/暴傷b）
scalar('formula', 'ENEMY_CRIT_RATE_NORMAL', '3-戰鬥核心', '敵人爆擊', 0);
scalar('formula', 'ENEMY_CRIT_RATE_ELITE', '3-戰鬥核心', '敵人爆擊', 1);
scalar('formula', 'ENEMY_CRIT_RATE_BOSS', '3-戰鬥核心', '敵人爆擊', 2);
scalar('formula', 'ENEMY_CRIT_DMG_PCT', '3-戰鬥核心', '敵人爆擊', 3);
// 穿透 → 忽略防禦曲線（formula.js §3；忽略防禦 = 穿透倍率 ÷ (穿透倍率 + max(c, a + b×(受攻擊者等級 − 攻擊者等級)))）
scalar('formula', 'PEN_IGNORE_A', '3-戰鬥核心', '穿透忽略防禦', 0);
scalar('formula', 'PEN_IGNORE_B', '3-戰鬥核心', '穿透忽略防禦', 1);
scalar('formula', 'PEN_IGNORE_C', '3-戰鬥核心', '穿透忽略防禦', 2);
// 野外菁英掉落倍率（formula.js 常數 ELITE_DROP_MULT；野外 rollFieldDrops 與離線收益共用）
scalar('formula', 'ELITE_DROP_MULT', '4-野外怪物', '野外菁英掉落倍率', 0);
// 技能熟練度（2026-07-30）：經驗需求 ⌊a×L^b+c⌋；上限等級與擊殺經驗率（formula.js §9）
scalar('formula', 'SKILL_MASTERY_XP_A', '1-成長經驗', '技能熟練度經驗需求', 0);
scalar('formula', 'SKILL_MASTERY_XP_B', '1-成長經驗', '技能熟練度經驗需求', 1);
scalar('formula', 'SKILL_MASTERY_XP_C', '1-成長經驗', '技能熟練度經驗需求', 2);
scalar('formula', 'SKILL_MASTERY_MAX_LEVEL', '1-成長經驗', '技能熟練度', 0);
scalar('formula', 'SKILL_MASTERY_XP_RATE', '1-成長經驗', '技能熟練度', 1);
/* 等級前不出現的屬性 → data.js AFFIX_LEVEL_GATES（2026-10-30 起改由 system_unlock 表管理）。
   表裡「元素傷害詞條」「屬性抗性詞條」兩列的等級＝「從這一級起出現」（與其他解鎖列同一個意思）；
   程式內 AFFIX_LEVEL_GATES 的 level 是「這一級（含）以前不出現」，所以寫入時 -1。轉生欄只支援 0。
   詞條鍵必須存在於 Equipment_Affix 表的詞條池，打錯就中止——否則那一筆限制會靜靜地失效。 */
{
  const AFFIX_GATE_ROWS = [
    ['元素傷害詞條', ['elemDmgFire', 'elemDmgIce', 'elemDmgLightning', 'elemDmgPoison', 'elemDmgLight', 'elemDmgDark', 'elemDmgEarth', 'elemDmgWind']],
    ['屬性抗性詞條', ['resFire', 'resIce', 'resLightning', 'resPoison', 'resLight', 'resDark', 'resEarth', 'resWind', 'resAll']]
  ];
  const affixCsvPath = process.env.EQUIPMENT_AFFIX_CSV || path.join(ROOT, 'config', 'CSV', 'Equipment_Affix.csv');
  const knownAffixKeys = new Set(parseCsv(fs.readFileSync(affixCsvPath, 'utf8'))
    .filter(r => r[0] === '詞條池').map(r => r[1]));
  const byLevel = new Map();
  AFFIX_GATE_ROWS.forEach(([sysName, keys]) => {
    const u = systemUnlock(sysName);
    if (Number(u.reinc) !== 0) throw new Error('system_unlock.csv 「' + sysName + '」只支援等級門檻，轉生欄必須是 0（目前 ' + u.reinc + '）');
    const level = Number(u.level) - 1;
    if (!(level >= 0)) throw new Error('system_unlock.csv 「' + sysName + '」等級必須 ≥ 1');
    const unknown = keys.filter(k => !knownAffixKeys.has(k));
    if (unknown.length) throw new Error(sysName + ' 含有詞條池沒有的鍵：' + unknown.join('、'));
    if (level === 0) return; // 1 級起就出現＝沒有門檻
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(...keys);
  });
  const groups = Array.from(byLevel.entries()).map(([level, keys]) =>
    '  { level: ' + level + ', keys: [' + keys.map(k => "'" + k + "'").join(', ') + '] }');
  arrayContent('data', 'AFFIX_LEVEL_GATES', groups.length ? '\n' + groups.join(',\n') + '\n' : '', 'AFFIX_LEVEL_GATES（system_unlock）');
}
// 神界：開放條件是「通關人界最後一張地圖」，由 Zones 表前置欄管理；system_unlock 只放一列說明，這裡確認它還在。
systemUnlock('神界');
/* ===========================================================================
   套用引擎
   =========================================================================== */
const srcCache = {};
function src(f) { return srcCache[f] || (srcCache[f] = fs.readFileSync(FILES[f], 'utf8')); }

const results = []; // {label, file, kind, old, new, changed, error}
// scopeVar: 將搜尋限制在某 var 區塊內（例如 ZONE_STAGE_DROP_PROFILES）以避免同名欄位在他處誤中
function scopedText(file, scopeVar) {
  return scopedTextValue(src(file), scopeVar);
}
function scopedTextValue(t, scopeVar) {
  if (!scopeVar) return { text: t, offset: 0 };
  const re = new RegExp('\\b' + esc(scopeVar) + '\\s*=\\s*[\\[{][\\s\\S]*?[\\]}];', 'g');
  let m; let last = null;
  while ((m = re.exec(t)) !== null) { last = m; if (m.index === re.lastIndex) re.lastIndex++; }
  if (!last) return { text: t, offset: 0 };
  return { text: last[0], offset: last.index };
}
// 抽掉數字與空白後剩下的骨架（鍵名、標點）——用來偵測「數值相同但鍵名不同」的變更
function nonNumericSkeleton(s) {
  return String(s).replace(new RegExp(NUMBER_SOURCE, 'g'), '#').replace(/\s+/g, '');
}
// 比較兩段文字的數值序列是否相同（忽略空白/格式差異）
function numsEqual(a, b) {
  const na = (String(a).match(new RegExp(NUMBER_SOURCE, 'g')) || []).map(Number);
  const nb = (String(b).match(new RegExp(NUMBER_SOURCE, 'g')) || []).map(Number);
  return na.length === nb.length && na.every((x, i) => x === nb[i]);
}

let hadError = false;
edits.forEach(e => {
  try {
    const { text, offset } = scopedText(e.file, e.scopeVar);
    /* 'd'（hasIndices）讓 match 帶上每個群組的真實起訖位置。沒有它就只能靠
       「在整段 match 裡搜尋群組文字」去猜位置，而那個猜法會寫到錯的地方——
       見 groupSpan 的說明。 */
    const re = new RegExp(e.re.source, 'gd');
    const matches = [];
    let m; while ((m = re.exec(text)) !== null) { matches.push(m); if (m.index === re.lastIndex) re.lastIndex++; }
    if (matches.length !== 1) {
      results.push({ label: e.label, file: e.file, error: '錨點匹配 ' + matches.length + ' 次（需剛好 1 次）' });
      hadError = true; return;
    }
    const mm = matches[0];
    // 目標在檔案中的絕對位置：用「被取代群組」的起點（非 match 起點）。同檔多筆變更須依此「由後往前」
    // 套用；若兩筆 edit 的 match 起點相同（如 gold-a 改基底、gold-c 改冪次，皆從 var gold =( 起算），
    // 以群組起點排序才能讓較後者先套用，避免前面較短/較長的取代位移後面尚未套用之錨點。
    const pos = offset + groupSpan(mm, e.grp).start;
    if (e.twoGroup) {
      const chg = String(Number(mm[1])) !== String(Number(e.value)) || String(Number(mm[2])) !== String(Number(e.value2));
      results.push({ label: e.label, file: e.file, pos: pos, old: mm[1] + ',' + mm[2], new: e.value + ',' + e.value2, changed: chg, apply: () => applyTwo(e, mm, offset) });
    } else {
      const cur = mm[e.grp];
      /* multiGroup 是整段內容重建，過去只比數字序列（numsEqual）以忽略排版差異。
         但地圖識別碼改名（plains → desert）這種「數字全同、鍵名不同」的變更會被判成
         無變更而靜默不套用——2026-08-07 地圖改名時實際踩到。改為數字序列與
         非數字骨架都要一致才算相同；純空白差異仍視為無變更，不會每次都跳變更。 */
      /* 數值對數值就照數字比（2.0 與 2 視為相同）；只要有一邊不是純數字
         （例如候選值陣列 [0.75, 1, 2]）就改比字串，忽略空白差異。
         照數字比的話 Number('[...]') 是 NaN，NaN !== NaN 恆成立，
         每跑一次都會報「將變更」，內容卻一模一樣。 */
      const plainNum = (v) => NUMBER_LITERAL.test(String(v).trim());
      const chg = e.multiGroup
        ? (!numsEqual(cur, e.value) || nonNumericSkeleton(cur) !== nonNumericSkeleton(e.value))
        : (plainNum(cur) && plainNum(e.value)
            ? Number(cur) !== Number(e.value)
            : String(cur).replace(/\s+/g, '') !== String(e.value).replace(/\s+/g, ''));
      results.push({ label: e.label, file: e.file, pos: pos, old: cur, new: e.value, changed: chg, apply: () => applyOne(e, mm, offset) });
    }
  } catch (err) {
    results.push({ label: e.label, file: e.file, error: err.message }); hadError = true;
  }
});

/* 群組在檔案中的真實位置，取自正則的 hasIndices（'d' 旗標）。

   ⚠️ 舊版是「在整段 match 裡搜尋群組的文字」來推位置，那個推法在群組文字於
   match 內更早處也出現時會指到錯的地方。實測踩到：稀有度表的 affix 上下限，
   match 從 key: 'epic' 起算，中間就有 mult: 4，於是找 '4' 找到 mult 那一個，
   套用後把 { mult: 4, affix: [4, 4] } 寫成 { mult: 4, affix: [4,54] }——
   數值錯、格式也錯，而且不會有任何錯誤訊息。

   捕獲位置是正則引擎自己給的，沒有猜的餘地。 */
function groupSpan(mm, gi) {
  if (!mm.indices || !mm.indices[gi]) {
    throw new Error('群組 ' + gi + ' 沒有捕獲位置（正則需帶 d 旗標，且該群組必須有匹配到）');
  }
  return { start: mm.indices[gi][0], end: mm.indices[gi][1] };
}
function applyOne(e, mm, offset) {
  const span = groupSpan(mm, e.grp);
  const t = src(e.file);
  srcCache[e.file] = t.slice(0, offset + span.start) + e.value + t.slice(offset + span.end);
}
function applyTwo(e, mm, offset) {
  // 先替換第二群組再第一群組（避免位移）
  const s1 = groupSpan(mm, 1), s2 = groupSpan(mm, 2);
  let t = src(e.file);
  t = t.slice(0, offset + s2.start) + e.value2 + t.slice(offset + s2.end);
  t = t.slice(0, offset + s1.start) + e.value + t.slice(offset + s1.end);
  srcCache[e.file] = t;
}

/* ---- 錨點獨立性自檢（--check-anchors）----

   問題：某個錨點若把**另一個參數的現值**寫進字串裡，那麼只要那個參數被調整過一次，
   這個錨點就再也對不上——它負責的參數從此靜靜地套不進程式，公式讀的不再是配置表的值。
   這種壞法沒有徵兆：遊戲照跑、測試照綠、參數表照改，只是改了沒有效果。
   實測發現過 23 條（2026-08-02）。

   檢查方式：把每一個目標數值都換成一個不同的值（原值 +1），在**記憶體裡**套用，
   然後要求每一個錨點仍然剛好命中一次。全程不寫檔——寫檔的版本會與平行執行的
   其他測試互相干擾（實測會讓 49 個無關測試連帶紅掉）。

   只擾動單群組的純數值錨點：twoGroup 與 multiGroup 的目標是整段內容，
   它們的錨點本來就不是靠鄰近數值定位的。 */
if (process.argv.includes('--check-anchors')) {
  const perturbed = {};
  Object.keys(FILES).forEach((f) => { perturbed[f] = src(f); });

  /* 逐檔由後往前套用，避免前面的取代位移後面的位置。 */
  const spans = [];
  edits.forEach((e) => {
    if (e.twoGroup || e.multiGroup) return;
    try {
      const { text, offset } = scopedText(e.file, e.scopeVar);
      const re = new RegExp(e.re.source, 'gd');
      const ms = []; let m;
      while ((m = re.exec(text)) !== null) { ms.push(m); if (m.index === re.lastIndex) re.lastIndex++; }
      if (ms.length !== 1) return;                 // 本來就壞的由主流程回報
      const sp = groupSpan(ms[0], e.grp);
      const cur = Number(ms[0][e.grp]);
      if (!Number.isFinite(cur)) return;
      spans.push({ file: e.file, start: offset + sp.start, end: offset + sp.end, value: String(cur + 1) });
    } catch (err) { /* 主流程會回報 */ }
  });
  spans.sort((a, b) => b.start - a.start);
  spans.forEach((s) => {
    perturbed[s.file] = perturbed[s.file].slice(0, s.start) + s.value + perturbed[s.file].slice(s.end);
  });

  /* 擾動後重新比對每一個錨點。 */
  const broken = [];
  edits.forEach((e) => {
    let text = perturbed[e.file];
    if (e.scopeVar) {
      text = scopedTextValue(text, e.scopeVar).text;
    }
    const re = new RegExp(e.re.source, 'g');
    let n = 0, m2;
    while ((m2 = re.exec(text)) !== null) { n++; if (m2.index === re.lastIndex) re.lastIndex++; }
    if (n !== 1) broken.push({ file: e.file, label: e.label, n: n });
  });

  console.log('=== apply_params (--check-anchors) ===');
  console.log('擾動了 ' + spans.length + ' 個數值後重新比對 ' + edits.length + ' 個錨點');
  if (!broken.length) {
    console.log('✅ 所有錨點仍剛好命中一次（錨點彼此獨立，不依賴其他參數的現值）');
    process.exit(0);
  }
  console.log('❌ ' + broken.length + ' 個錨點在其他參數變動後失配——那些參數會靜靜地套不進程式：');
  broken.forEach((b) => console.log('  ✗ ' + b.file + ' ' + b.label + '：擾動後匹配 ' + b.n + ' 次'));
  process.exit(2);
}

/* ---- 報告 ---- */
const errors = results.filter(r => r.error);
const changes = results.filter(r => !r.error && r.changed);
const okUnchanged = results.filter(r => !r.error && !r.changed);
console.log('=== apply_params ' + (WRITE ? '(--write)' : '(dry-run)') + ' ===');
console.log('對應參數總數：' + results.length + '（一致 ' + okUnchanged.length + '、將變更 ' + changes.length + '、錨點問題 ' + errors.length + '）');
if (errors.length) {
  console.log('\n[錨點問題]（這些不會被寫入；請回報以修正對應）');
  errors.forEach(r => console.log('  ✗ ' + r.file + ' ' + r.label + '：' + r.error));
}
if (skippedParams.length) {
  console.log('\n[參數表尚未提供]（程式已支援，補上這些格子就會生效；目前沿用程式內的預設值）');
  skippedParams.forEach(s => console.log('  – ' + s));
}
if (changes.length) {
  console.log('\n[將套用的變更]');
  changes.forEach(r => console.log('  • ' + r.file + ' ' + r.label + '：' + r.old + ' → ' + r.new));
} else {
  console.log('\n（無數值變更：CSV 與程式目前一致）');
}

if (!WRITE) {
  console.log('\n這是試跑。確認無誤後加 --write 實際寫入。');
  if (hadError) process.exitCode = 2;
  process.exit();
}

/* ---- 寫入：備份 → 套用 → node --check → 失敗還原 ---- */
if (hadError) {
  console.log('\n偵測到錨點問題，為安全起見中止寫入（不修改任何檔案）。');
  process.exit(2);
}
if (!changes.length) { console.log('\n無變更，未寫檔。'); process.exit(0); }
const backups = {};
Object.keys(FILES).forEach(f => { backups[f] = fs.readFileSync(FILES[f], 'utf8'); });
try {
  // 由後往前套用（同檔內位置由大到小），避免前面的取代位移後面尚未套用之錨點。
  changes.slice().sort((a, b) => b.pos - a.pos).forEach(r => r.apply());
  Object.keys(FILES).forEach(f => fs.writeFileSync(FILES[f], src(f), 'utf8'));
  Object.keys(FILES).forEach(f => execFileSync(process.execPath, ['--check', FILES[f]]));
  // 更新重載權杖：遊戲頁面（本機）偵測到此檔變動即自動重新整理，套用後不必手動 F5。
  try { fs.writeFileSync(path.join(ROOT, 'params_version.txt'), String(Date.now())); } catch (e) { }
  console.log('\n✔ 已寫入並通過語法檢查，共套用 ' + changes.length + ' 項變更。遊戲頁面將自動重新整理。');
} catch (err) {
  Object.keys(FILES).forEach(f => fs.writeFileSync(FILES[f], backups[f], 'utf8'));
  console.log('\n✗ 寫入後驗證失敗，已還原所有檔案。錯誤：' + err.message);
  process.exit(1);
}
