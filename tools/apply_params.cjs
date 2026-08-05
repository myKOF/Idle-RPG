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
  skills: path.join(ROOT, 'js', 'skills.js'), player: path.join(ROOT, 'js', 'player.js'),
  save: path.join(ROOT, 'js', 'save.js')
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
const allRows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8')).filter(r => r.length > 1);
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
const ZD_EQUIP = ZD('裝備掉落率（品質R0至R10）');
const ZD_GEMS = ZD('寶石掉落率（等級R1至R5）');
const ZD_BOOK = ZD('技能書掉落率');
const ZD_ESSENCE = ZD('太古精華掉落率');
const ZD_DUST = ZD('魔塵掉落率');
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
      dropRateList(r[ZD_EQUIP], 11, zone + '.裝備掉落率'),
      dropRateList(r[ZD_GEMS], 5, zone + '.寶石掉落率'),
      dropNumber(r[ZD_BOOK], zone + '.技能書掉落率'),
      dropNumber(r[ZD_ESSENCE], zone + '.太古精華掉落率'),
      dropNumber(r[ZD_DUST], zone + '.魔塵掉落率')
    ];
    (grouped[zone] || (grouped[zone] = [])).push(row);
  });
  const expectedZones = ['plains', 'desert', 'swamp', 'undead_mountains', 'god_battlefield', 'god_chaos', 'god_sanctuary'];
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

/* ---------- 編輯清單：每筆 = {file, re(單一群組), value, label} ---------- */
const edits = [];
edits.push({
  file: 'data', scopeVar: 'ZONE_STAGE_DROP_PROFILES',
  re: /ZONE_STAGE_DROP_PROFILES\s*=\s*\{([\s\S]*?)\n\};/,
  grp: 1, value: zoneStageDropContent(), label: 'ZONE_STAGE_DROP_PROFILES（Zone_Stage_Drops.csv）', multiGroup: true
});
function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// 具名純量常數： var NAME = <num>;
function scalarValue(file, varName, value, label) {
  edits.push({ file, re: new RegExp('(\\b' + esc(varName) + '\\s*=\\s*)(-?[\\d.]+)'), grp: 2, value: String(value), label: label || varName });
}
function scalar(file, varName, cat, name, i) {
  scalarValue(file, varName, P(cat, name, i), varName);
}
/* 參數表還沒有這一列（或這一格是空的）時跳過，不中斷整份套用。

   為什麼需要：CSV 是由 config/Excel/game_parameters.xlsx 產生的（套用參數.bat 第 2 步），
   所以「先寫程式、再請人在 Excel 補列」是必然的順序。用 scalar() 的話，那段期間
   每跑一次套用參數就整個中斷，連其他 550 個參數也套不進去。
   跳過的項目會列在最後，不會安靜消失。 */
const skippedParams = [];
function scalarOpt(file, varName, cat, name, i) {
  const row = index[cat] && index[cat][name];
  const raw = row ? row[i] : undefined;
  if (raw === undefined || String(raw).trim() === '' || String(raw).trim() === '0') {
    skippedParams.push(`${cat} / ${name} 參數#${i} → ${varName}`);
    return;
  }
  scalarValue(file, varName, String(raw).trim(), varName);
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
    re: new RegExp('(' + esc(keyAnchor) + '[^\\n]*?\\b' + esc(field) + ':\\s*)(-?[\\d.]+)'),
    grp: 2, value: P(cat, name, i), label: (label || keyAnchor) + '.' + field
  });
}
// 物件跨行欄位（多行物件內第一個該欄位）
function objFieldML(file, keyAnchor, field, cat, name, i, label, scopeVar) {
  edits.push({
    file,
    re: new RegExp('(' + esc(keyAnchor) + '[\\s\\S]*?\\b' + esc(field) + ':\\s*)(-?[\\d.]+)'),
    grp: 2, value: P(cat, name, i), label: (label || keyAnchor) + '.' + field, scopeVar: scopeVar
  });
}
function objFieldMLValue(file, keyAnchor, field, value, label, scopeVar) {
  edits.push({
    file,
    re: new RegExp('(' + esc(keyAnchor) + '[\\s\\S]*?\\b' + esc(field) + ':\\s*)(-?[\\d.]+)'),
    grp: 2, value: String(value), label: (label || keyAnchor) + '.' + field, scopeVar: scopeVar
  });
}
// 內嵌唯一片段： <prefix><num> —— prefix 需在整檔唯一
function inline(file, prefix, value, label) {
  edits.push({ file, re: new RegExp('(' + esc(prefix) + ')(-?[\\d.]+)'), grp: 2, value: String(value), label });
}
// 結構型內嵌數值：錨點只描述公式結構，不把目前程式裡的數值寫死。
// 這樣某個參數先被套用後，同一公式中的其他參數仍能在下一次套用時找到。
function inlineRegex(file, re, value, label) {
  edits.push({ file, re, grp: 2, value: String(value), label });
}
// 前後文夾住數字： <before><num><after> —— 三段合起來需在整檔唯一（用於同一數值多處出現時精準定位）
function numCtx(file, before, after, value, label) {
  edits.push({ file, re: new RegExp('(' + esc(before) + ')(-?[\\d.]+)(' + esc(after) + ')'), grp: 2, value: String(value), label });
}
// 整段陣列內容重建： var NAME = [<content>]; —— content 為新的內部字串
function arrayContent(file, varName, contentStr, label) {
  edits.push({ file, re: new RegExp('(\\b' + esc(varName) + '\\s*=\\s*\\[)([\\s\\S]*?)(\\];)'), grp: 2, value: contentStr, label: label || varName, multiGroup: true });
}

/* ===========================================================================
   映射定義
   =========================================================================== */
const RAR_KEYS = { '普通': 'common', '精良': 'uncommon', '稀有': 'rare', '獨特': 'unique', '史詩': 'epic', '傳說': 'legendary', '神話': 'mythic', '創世': 'genesis', '神鑄創世': 'godforged', '混沌': 'chaos', '神鑄混沌': 'chaosGodforged' };
// 稀有度表：mult(0) affix下限(1) affix上限(2) sockets(3) enchants(4) salv(5)
Object.keys(RAR_KEYS).forEach(nm => {
  const anchor = "key: '" + RAR_KEYS[nm] + "'";
  objField('data', anchor, 'mult', '表-稀有度', nm, 0, nm);
  edits.push({ file: 'data', re: new RegExp(esc(anchor) + "[^\\n]*?affix:\\s*\\[\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\]"), grp: 1, grp2: 2, value: P('表-稀有度', nm, 1), value2: P('表-稀有度', nm, 2), label: nm + '.affix', twoGroup: true });
  objField('data', anchor, 'sockets', '表-稀有度', nm, 3, nm);
  objField('data', anchor, 'enchants', '表-稀有度', nm, 4, nm);
  objField('data', anchor, 'salv', '表-稀有度', nm, 5, nm);
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
scalar('player', 'INITIAL_SCRAP', '0-遊戲預設', '開場裝備碎片', 0);
scalar('player', 'INITIAL_ESSENCE', '0-遊戲預設', '開場附魔精華', 0);

const ZONE_KEYS = {
  '草原': 'plains',
  '荒漠': 'desert',
  '沼澤': 'swamp',
  '亡靈山脈': 'undead_mountains',
  '太古戰場': 'god_battlefield',
  '混沌界': 'god_chaos',
  '永恒神域': 'god_sanctuary'
};
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
scalar('data', 'REINCARNATION_LEVEL', '1-成長經驗', '可轉生等級 / 最高轉生', 0);
scalar('data', 'REINCARNATION_MAX', '1-成長經驗', '可轉生等級 / 最高轉生', 1);
// 神鑄
scalar('data', 'FORGE_UNLOCK_LEVEL', '1-成長經驗', '神鑄系統解鎖等級', 0);
scalar('data', 'FORGE_UNLOCK_REINCARNATION', '1-成長經驗', '神鑄系統解鎖等級', 1);
scalar('data', 'FORGE_DUST_RATE', '6-神鑄', '裝備神鑄成功率', 0);
scalar('data', 'FORGE_CHAOS_DUST_RATE', '6-神鑄', '裝備神鑄混沌魔塵加成', 0);
scalar('data', 'FORGE_GEM_DUST_RATE', '6-神鑄', '寶石神鑄成功率', 0);
scalar('data', 'FORGE_FAIL_CONSUME', '6-神鑄', '神鑄失敗', 0);
scalar('data', 'FORGE_SLOTS', '6-神鑄', '神鑄槽位 / 魔塵上限', 0);
// FORGE_BASE_RATE / FORGE_GOLD_COST / FORGE_EQUIP_DURATION（物件）
objField('data', 'FORGE_BASE_RATE = {', '5', '6-神鑄', '裝備神鑄基礎成功率', 0, 'FORGE_BASE_RATE');
objField('data', 'FORGE_BASE_RATE = {', '6', '6-神鑄', '裝備神鑄基礎成功率', 1, 'FORGE_BASE_RATE');
objField('data', 'FORGE_BASE_RATE = {', '7', '6-神鑄', '裝備神鑄基礎成功率', 2, 'FORGE_BASE_RATE');
scalar('data', 'FORGE_CHAOS_BASE_RATE', '6-神鑄', '裝備神鑄混沌基礎成功率', 0);
objField('data', 'FORGE_GOLD_COST = {', '5', '6-神鑄', '裝備神鑄金幣', 0, 'FORGE_GOLD_COST');
objField('data', 'FORGE_GOLD_COST = {', '6', '6-神鑄', '裝備神鑄金幣', 1, 'FORGE_GOLD_COST');
objField('data', 'FORGE_GOLD_COST = {', '7', '6-神鑄', '裝備神鑄金幣', 2, 'FORGE_GOLD_COST');
scalar('data', 'FORGE_CHAOS_GOLD_COST', '6-神鑄', '裝備神鑄混沌金幣', 0);
objField('data', 'FORGE_EQUIP_DURATION = {', '5', '6-神鑄', '裝備神鑄時間(秒)', 0, 'FORGE_EQUIP_DURATION');
objField('data', 'FORGE_EQUIP_DURATION = {', '6', '6-神鑄', '裝備神鑄時間(秒)', 1, 'FORGE_EQUIP_DURATION');
objField('data', 'FORGE_EQUIP_DURATION = {', '7', '6-神鑄', '裝備神鑄時間(秒)', 2, 'FORGE_EQUIP_DURATION');
scalar('data', 'FORGE_CHAOS_DURATION', '6-神鑄', '裝備神鑄混沌時間(秒)', 0);
['0', '1', '2', '3', '4'].forEach((k, idx) => {
  const codeKey = [5, 6, 7, 8, 9][idx];
  objField('data', 'FORGE_GEM_BASE_RATE = {', String(codeKey), '6-神鑄', '寶石神鑄基礎成功率', idx, 'FORGE_GEM_BASE_RATE');
  objField('data', 'FORGE_GEM_DURATION = {', String(codeKey), '6-神鑄', '寶石神鑄時間(秒)', idx, 'FORGE_GEM_DURATION');
});
// 魔塵掉落由 Zone_Stage_Drops.csv 管理；高塔 BOSS 魔塵仍由 game_parameters 管理。
scalar('data', 'DUST_BOSS_BASE', '4-高塔BOSS', '高塔 BOSS 魔塵', 1);
scalar('data', 'DUST_BOSS_PER_LEVEL', '4-高塔BOSS', '高塔 BOSS 魔塵', 2);
scalar('data', 'DUST_BOSS_CAP', '4-高塔BOSS', '高塔 BOSS 魔塵', 0);
// 高塔（2026-07-23 起三塔獨立：每列參數欄依「試煉→地獄→煉獄」順序攤平，
// 錨定 data.js 的 TOWER_BOSS_TRIAL / TOWER_BOSS_HELL / TOWER_BOSS_PURGATORY 物件欄位）
rangeBound('data', 'TOWER_TRIAL_MAX_FLOOR', '4-高塔BOSS', '試練之塔範圍', 0, 2);
rangeBound('data', 'TOWER_HELL_MAX_FLOOR', '4-高塔BOSS', '試練之塔範圍', 1, 2);
rangeBound('data', 'TOWER_PURGATORY_MAX_FLOOR', '4-高塔BOSS', '試練之塔範圍', 2, 2);
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
  objFieldML('data', anchor, 'aspd', '4-高塔BOSS', '攻速 / 控制抵抗', t * 2, L('aspd'));
  objFieldML('data', anchor, 'ctrlRes', '4-高塔BOSS', '攻速 / 控制抵抗', t * 2 + 1, L('ctrlRes'));
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
inline('data', 'TOWER_ENRAGE_HP = ', 50, 'TOWER_ENRAGE_HP'); // 狂暴血量門檻（無對應可調 CSV 欄，固定內嵌；全塔共用）
// 寶石相關
scalar('data', 'GEM_MAX_LEVEL', '表-固定參數', '寶石一般上限 / 神鑄上限', 0);
scalar('data', 'GEM_FORGE_MAX_LEVEL', '表-固定參數', '寶石一般上限 / 神鑄上限', 1);
scalar('data', 'GEM_COMPOSE_INPUT_COUNT', '8-寶石', '寶石合成(手動)', 0);
scalar('data', 'GEM_FUSE_BASE_RATE', '8-寶石', '寶石融合成功率', 1);
scalar('data', 'GEM_FUSE_RATE_DECAY', '8-寶石', '寶石融合成功率', 2);
scalar('data', 'GEM_FUSE_MIN_RATE', '8-寶石', '寶石融合成功率', 0);
inline('data', 'GEM_SHOP_MAX_LEVEL = ', 20, 'GEM_SHOP_MAX_LEVEL');
scalar('data', 'GEM_SHOP_REFRESH_BASE', '8-寶石商店', '手動刷新費用', 0);
scalar('data', 'GEM_SHOP_REFRESH_EXPONENT', '8-寶石商店', '手動刷新費用', 1);
// 其他 data.js 常數
scalar('data', 'ENCHANT_ESSENCE_COST', '6-裝備', '手動附魔費用', 1);
scalar('data', 'PART_MAX_TIER', '表-固定參數', '零件階級上限', 0);
scalar('data', 'PART_KEEP_PER_KEY', '表-固定參數', '零件庫存保留', 0);
scalar('data', 'PART_UPGRADE_COST_A', '表-固定參數', '零件升級金錢消耗', 0);
scalar('data', 'PART_UPGRADE_COST_B', '表-固定參數', '零件升級金錢消耗', 1);
scalar('data', 'PART_UPGRADE_COST_C', '表-固定參數', '零件升級金錢消耗', 2);
scalar('data', 'RESPAWN_DELAY', '表-固定參數', '出怪間隔', 0);
scalar('data', 'REVIVE_DELAY', '表-固定參數', '死亡復活時間', 0);
scalar('data', 'CONVEYOR_CAP', '7-容量', '輸送帶容量', 0);
scalar('data', 'SYNTH_BUFFER_CAP', '7-容量', '合成暫存區', 0);
scalar('data', 'INVENTORY_CAP', '7-容量', '背包容量', 0);        // a＝初始格數
scalar('data', 'INVENTORY_MAX', '7-容量', '背包容量', 1);        // b＝擴充上限（可自訂）
scalar('data', 'FACTORY_BASE_INTERVAL', '7-容量', '生產線處理間隔', 0);
scalar('data', 'SYNTH_GREAT_BASE', '7-合成', '大成功率', 0);
// 奧術衝擊技能常數
objFieldML('data', 'var SKILL = {', 'cost', '9-技能', '奧術衝擊(基礎技能)', 0, 'SKILL');
objFieldML('data', 'var SKILL = {', 'baseCd', '9-技能', '奧術衝擊(基礎技能)', 1, 'SKILL');
objFieldML('data', 'var SKILL = {', 'castTime', '9-技能', '奧術衝擊(基礎技能)', 2, 'SKILL');
objFieldML('data', 'var SKILL = {', 'matkScale', '9-技能', '奧術衝擊(基礎技能)', 3, 'SKILL');
objFieldML('data', 'var SKILL = {', 'atkScale', '9-技能', '奧術衝擊(基礎技能)', 4, 'SKILL');

/* ---- 陣列 / 巢狀陣列重建 ---- */
// REROLL_ESSENCE_COST = { 6: 9, 7: 14, 8: 20 }
objField('data', 'REROLL_ESSENCE_COST = {', '6', '7-洗煉', '精華費用', 0, 'REROLL_ESSENCE_COST');
objField('data', 'REROLL_ESSENCE_COST = {', '7', '7-洗煉', '精華費用', 1, 'REROLL_ESSENCE_COST');
objField('data', 'REROLL_ESSENCE_COST = {', '8', '7-洗煉', '精華費用', 2, 'REROLL_ESSENCE_COST');
// FUSE_GOLD_COST = [0, 100, 300, 900, 2700, 8100]
{
  const g = [0, 1, 2, 3, 4].map(i => P('8-寶石', '寶石合成金幣', i));
  arrayContent('data', 'FUSE_GOLD_COST', '0, ' + g.join(', '), 'FUSE_GOLD_COST');
}
function parseExpMultiplier(raw) {
  const str = String(raw).trim();
  const m = str.match(/^10\^(\d+)$/);
  if (m) {
    const exp = parseInt(m[1], 10);
    if (exp === 0) return '1';
    if (exp <= 9) return String(Math.pow(10, exp));
    return '1e' + exp;
  }
  const n = Number(str);
  if (!isNaN(n)) return String(n);
  return str;
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
// REINCARNATION_EXTRA_MULTIPLIERS = [0, 10, 20, ...]（索引0固定0；1~20 取 CSV 轉生對照表 param a）
{
  const g = [];
  for (let n = 1; n <= 20; n++) {
    const val = Number(getReincarnationCell(n, 0));
    g.push(Number.isInteger(val) ? val : parseFloat(val.toFixed(6)));
  }
  arrayContent('data', 'REINCARNATION_EXTRA_MULTIPLIERS', '0, ' + g.join(', '), 'REINCARNATION_EXTRA_MULTIPLIERS');
}
// REINCARNATION_EXP_BASE_ADD = [0, 100000, 300000, ...]（索引0固定0；1~20 取 CSV 轉生對照表 param c＝升級經驗基礎增加值）
{
  const g = [];
  for (let n = 1; n <= 20; n++) g.push(getReincarnationCell(n, 2));
  arrayContent('data', 'REINCARNATION_EXP_BASE_ADD', '0, ' + g.join(', '), 'REINCARNATION_EXP_BASE_ADD');
}
// REINCARNATION_RANKS = ['冒險者', '勇者', ...]（0~20 取 CSV 轉生對照表 param d）
{
  const g = [];
  for (let n = 0; n <= 20; n++) g.push("'" + getReincarnationCell(n, 3) + "'");
  arrayContent('data', 'REINCARNATION_RANKS', g.join(', '), 'REINCARNATION_RANKS');
}
// REINCARNATION_EXP_MULTIPLIERS = [1, 10, 100, ...]（0~20 取 CSV 轉生對照表 param b＝升級經驗倍率）
{
  const g = [];
  for (let n = 0; n <= 20; n++) {
    const raw = getReincarnationCell(n, 1);
    g.push(parseExpMultiplier(raw));
  }
  arrayContent('data', 'REINCARNATION_EXP_MULTIPLIERS', g.join(', '), 'REINCARNATION_EXP_MULTIPLIERS');
}
// REINCARNATION_SKILL_MAX_LEVELS = [20, 30, ...]（0~20 取 CSV 轉生對照表 param e＝一般技能上限）
{
  const g = [];
  for (let n = 0; n <= 20; n++) g.push(Number(getReincarnationCell(n, 4)));
  arrayContent('data', 'REINCARNATION_SKILL_MAX_LEVELS', g.join(', '), 'REINCARNATION_SKILL_MAX_LEVELS');
}
// REINCARNATION_FUSION_MAX_LEVELS = [0, 20, ...]（0~20 取 CSV 轉生對照表 param f＝融合技上限增加值）
{
  const g = [];
  for (let n = 0; n <= 20; n++) g.push(Number(getReincarnationCell(n, 5)));
  arrayContent('data', 'REINCARNATION_FUSION_MAX_LEVELS', g.join(', '), 'REINCARNATION_FUSION_MAX_LEVELS');
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
arrayContent('data', 'FIELD_ENEMY_COUNT_TABLE', parseCountTuples('4-敵人數量', '小怪 數量權重'), 'FIELD_ENEMY_COUNT_TABLE');
const PLAINS_EARLY_ENEMY_COUNT_RANGES = ['1~20', '21~40', '41~60', '61~80', '81~100'];
const plainsEarlyEnemyCountTables = PLAINS_EARLY_ENEMY_COUNT_RANGES.map(range =>
  parseCountTuples('4-敵人數量', '小怪 數量權重(草原' + range + '關)'));
/* ⚠️ arrayContent 替換的是既有 `[ ... ]` **裡面**的內容（regex 第 2 組），
   所以這裡只能給「元素們」，不能再自己包一層外括號——包了就會寫成 [[...]]，
   變成長度 1 的陣列：[0] 是整包巢狀表、[1]~[4] 全是 undefined。
   後果是 fieldCountTableFor() 在 1~20 關拿到不是權重表的東西（實測固定出 1 隻怪）、
   21~100 關則因為 undefined 直接掉回後期表，五段分段等於完全沒生效。
   隔壁 FIELD_ENEMY_COUNT_TABLE 傳的是 parseCountTuples() 的回傳值，本來就沒有外括號。 */
arrayContent('data', 'FIELD_PLAINS_EARLY_ENEMY_COUNT_TABLES',
  plainsEarlyEnemyCountTables.map(table => '[' + table + ']').join(', '),
  'FIELD_PLAINS_EARLY_ENEMY_COUNT_TABLES');
arrayContent('data', 'FIELD_ELITE_COUNT_TABLE', parseCountTuples('4-敵人數量', '菁英 數量權重'), 'FIELD_ELITE_COUNT_TABLE');
arrayContent('data', 'FIELD_BOSS_COUNT_TABLE', parseCountTuples('4-敵人數量', 'BOSS 數量權重'), 'FIELD_BOSS_COUNT_TABLE');
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
    edits.push({ file: 'data', scopeVar: 'BOSS_DROP_TABLE', re: new RegExp('min: ' + min + ',\\s*rates:\\s*\\[([^\\]]*)\\]'), grp: 1, value: rates.join(', '), label: 'BOSS_DROP min' + min, multiGroup: true });
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

/* ---- formula.js 具名常數 ---- */
scalar('formula', 'GLOBAL_DMG_RED_CAP', '2-屬性派生', '全局減傷', 0);
scalar('formula', 'GLOBAL_DMG_RED_DENOMINATOR', '2-屬性派生', '全局減傷', 1);
scalar('formula', 'SLOW_ASPD_FACTOR', '3-戰鬥核心', '減速狀態攻速', 0);
scalar('formula', 'CONTROL_DECAY_PER_SEC_NORMAL', '3-戰鬥核心', '控場遞減', 0);
scalar('formula', 'CONTROL_DECAY_PER_SEC_ELITE', '3-戰鬥核心', '控場遞減', 1);
scalar('formula', 'BASE_HP_REGEN_PCT', '2-屬性派生', '野外基礎生命恢復', 0);
scalar('formula', 'WAVE_CLEAR_HEAL_PCT', '3-戰鬥核心', '過關回復', 0);
scalar('formula', 'DROP_RATE_EFFECT_MULT', '5-掉落通則', '掉寶率效果折半', 0);
scalar('formula', 'SPEED_GEAR_FIXED_BONUS', '5-掉落通則', '加速齒輪固定加成', 0);
inline('formula', 'ANCIENT_AFFIX_SALVAGE_CHANCE = ', 50, 'ANCIENT_AFFIX_SALVAGE_CHANCE'); // 每條太古詞條的拆解判定機率
inline('formula', 'SALVAGE_SLOT_MAX = ', 20, 'SALVAGE_SLOT_MAX');
inline('formula', 'SALVAGE_SLOT_INITIAL = ', 10, 'SALVAGE_SLOT_INITIAL');
inline('formula', 'SALVAGE_SLOT_UNLOCK_GOLD_BASE = ', P('7-分解槽', '分解槽解鎖費用', 0), 'SALVAGE_SLOT_UNLOCK_GOLD_BASE');
inline('formula', 'SALVAGE_SLOT_UNLOCK_GOLD_RATE = ', P('7-分解槽', '分解槽解鎖費用', 1), 'SALVAGE_SLOT_UNLOCK_GOLD_RATE');
scalar('formula', 'FUSE_FACTOR', '9-融合', '素材繼承比例', 0);
scalar('formula', 'FUSION_MUTATION_CHANCE', '9-融合', '變異觸發率', 0);
scalar('formula', 'FUSION_CD_FACTOR', '9-融合', '融合冷卻', 0);
scalar('formula', 'OFFLINE_MAX_HOURS', '10-離線', '有效離線時間', 0);
scalar('formula', 'OFFLINE_LEVEL_REDUCE', '10-離線', '計算等級', 0);
scalar('formula', 'OFFLINE_KILL_INTERVAL', '10-離線', '擊殺速率', 0);
/* 下面三個要等 Excel 補上欄位／列才會生效，在那之前 scalarOpt 會跳過並列在報表最後。
   「計算等級」列目前只有參數a（扣減），b（取整單位）與 c（關卡比例）是新增的欄位。 */
scalarOpt('formula', 'OFFLINE_STAGE_ROUND', '10-離線', '計算等級', 1);
scalarOpt('formula', 'OFFLINE_STAGE_RATIO', '10-離線', '計算等級', 2);
scalarOpt('formula', 'OFFLINE_ELITE', '10-離線', '怪物種類', 0);
scalar('formula', 'SKILL_CAST_LOCK', '9-技能', '施放硬直', 0);
scalar('formula', 'SKILL_GLOBAL_COOLDOWN', '9-技能', '技能共用冷卻(GCD)', 0);
// ESSENCE_SALVAGE_CHANCE_BY_RARITY = [0.1,0.5,1,2,4,8,20,100,100]
arrayContent('formula', 'ESSENCE_SALVAGE_CHANCE_BY_RARITY',
  index['6-分解精華機率']['附魔精華拆解機率'].slice(0, 9).join(', '), 'ESSENCE_SALVAGE_CHANCE_BY_RARITY');
// ANCIENT_ESSENCE_SALVAGE_CHANCE = { 4: 史詩, 5: 傳說, 6: 神話, 7: 創世, 8: 神鑄 }（普通~獨特不掉，物件無該鍵）
['4', '5', '6', '7', '8'].forEach(k => {
  objField('data', 'ANCIENT_ESSENCE_SALVAGE_CHANCE = {', k, '6-分解精華機率', '太古精華拆解機率(依稀有度)', Number(k), '太古拆解機率.' + k);
});
// SCORE_WEIGHTS（戰力權重）：2026-07-23 已撥離至 Equipment_Affix 表各詞條列的「戰力權重」欄（config_tables.cjs 管理），
// 本表不再定義「表-戰力權重」錨點；主參數表殘留該分類列一律視為死列忽略。

/* ---- formula.js 內嵌係數（唯一片段） ---- */
// 升級經驗：係數 × 等級^次方 + 常數
inline('formula', 'Math.floor((', P('1-成長經驗', '升級所需經驗', 0), 'xp-a（係數）');
inline('formula', ' * Math.pow(l, ', P('1-成長經驗', '升級所需經驗', 1), 'xp-b（次方）');
// xp-c（常數）：錨點不綁定次方值（次方＝xp-b 可被調整），以 Math.pow(l, <任意>) + 為前綴。
edits.push({ file: 'formula', re: /(Math\.pow\(l, -?[\d.]+\) \+ )(-?[\d.]+)/, grp: 2, value: P('1-成長經驗', '升級所需經驗', 2), label: 'xp-c（常數）' });
// 基礎四維：基底 + (等級-1) × 每級增加
inline('formula', 'var v = ', P('1-成長經驗', '等級基礎四維', 0), '四維-a（基底）');
/* 每級增加的錨點不能綁基底值——基底一旦被前一條套用改掉，這一條就再也對不上，
   而且是靜靜地對不上（見下方防禦減傷曲線那兩行的說明）。 */
inlineRegex('formula', /(var v = -?[\d.]+ \+ \(level - 1\) \* )(-?[\d.]+)/, P('1-成長經驗', '等級基礎四維', 1), '四維-b（每級）');
// 野外怪物成長：形如 var X = (a + stage [* b]) * Math.pow(c, stage - 1)。
// b/c 錨點以正規式「萬用」掉同一行的 a（與 b）值，避免調整某一項後其它項錨點失配。
inline('formula', 'var hp = (', P('4-野外怪物', '生命', 0), 'hp-a');
edits.push({ file: 'formula', re: /(var hp = \([\d.]+ \+ stage \* )([\d.]+)/, grp: 2, value: P('4-野外怪物', '生命', 1), label: 'hp-b' });
edits.push({ file: 'formula', re: /(var hp = \([\d.]+ \+ stage \* [\d.]+\) \* Math\.pow\()([\d.]+)/, grp: 2, value: P('4-野外怪物', '生命', 2), label: 'hp-c' });
inline('formula', 'var atk = (', P('4-野外怪物', '攻擊', 0), 'atk-a');
edits.push({ file: 'formula', re: /(var atk = \([\d.]+ \+ stage \* )([\d.]+)/, grp: 2, value: P('4-野外怪物', '攻擊', 1), label: 'atk-b' });
edits.push({ file: 'formula', re: /(var atk = \([\d.]+ \+ stage \* [\d.]+\) \* Math\.pow\()([\d.]+)/, grp: 2, value: P('4-野外怪物', '攻擊', 2), label: 'atk-c' });
inline('formula', 'var def = (', P('4-野外怪物', '物理防禦', 0), 'def-a');
edits.push({ file: 'formula', re: /(var def = \([\d.]+ \+ stage \* )([\d.]+)/, grp: 2, value: P('4-野外怪物', '物理防禦', 1), label: 'def-b' });
edits.push({ file: 'formula', re: /(var def = \([\d.]+ \+ stage \* [\d.]+\) \* Math\.pow\()([\d.]+)/, grp: 2, value: P('4-野外怪物', '物理防禦', 2), label: 'def-c' });
inline('formula', 'var gold = (', P('4-野外怪物', '金幣', 0), 'gold-a');
edits.push({ file: 'formula', re: /(var gold = \([\d.]+ \+ stage\) \* Math\.pow\()([\d.]+)/, grp: 2, value: P('4-野外怪物', '金幣', 2), label: 'gold-c' });
inline('formula', 'var xp = (', P('4-野外怪物', '經驗', 0), 'xp2-a');
edits.push({ file: 'formula', re: /(var xp = \([\d.]+ \+ stage\) \* Math\.pow\()([\d.]+)/, grp: 2, value: P('4-野外怪物', '經驗', 2), label: 'xp2-c' });
// 野外怪物攻速：只鎖定 monsterStatsFor 內的 aspd 欄位。
edits.push({ file: 'formula', re: /(function monsterStatsFor[\s\S]*?aspd:\s*)(-?[\d.]+)(,)/, grp: 2, value: P('4-野外怪物', '攻擊速度', 0), label: 'mob-aspd' });
// 野外怪物命中／閃避：基礎值 + 各等級區間的每級增加值累加。
scalar('data', 'FIELD_MONSTER_DODGE_BASE', '4-野外怪物', '閃避率', 0);
arrayContent('data', 'FIELD_MONSTER_DODGE_GROWTH', levelGrowthContent('4-野外怪物', '閃避率'), '怪物閃避分段成長');
scalar('data', 'FIELD_MONSTER_HIT_BASE', '4-野外怪物', '命中率', 0);
arrayContent('data', 'FIELD_MONSTER_HIT_GROWTH', levelGrowthContent('4-野外怪物', '命中率'), '怪物命中分段成長');

/* ---- §2 玩家屬性派生（computeStats） ---- */
inlineRegex('formula', /(st\.base\.hp\s*=\s*)(-?[\d.]+)(?=\s*\+\s*\(lv\s*-\s*1\)\s*\*\s*)/,
  P('2-屬性派生', '生命上限', 0), 'hp基底');
inlineRegex('formula', /(st\.base\.hp\s*=\s*-?[\d.]+\s*\+\s*\(lv\s*-\s*1\)\s*\*\s*)(-?[\d.]+)/,
  P('2-屬性派生', '生命上限', 1), 'hp每級');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'vitHp', '2-屬性派生', '生命上限', 2, 'hp每耐');
inline('formula', 'st.base.mp = ', P('2-屬性派生', '法力上限', 0), 'mp基底');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'intMp', '2-屬性派生', '法力上限', 1, 'mp每智');
inline('formula', 'st.mpRegen = ', P('2-屬性派生', '法力恢復/秒', 0), 'mpregen基底');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'intMpRegen', '2-屬性派生', '法力恢復/秒', 1, 'mpregen每智');
// 物攻/魔攻 = (a + 定值 + b×定值×c^轉生次數 + 主屬×d) × (1+對應%)；物防/魔防另有耐力×e、共用攻擊%
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
inline('formula', 'st.critRate = capValue(', P('2-屬性派生', '暴擊率', 0), '暴擊率基底');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'agiCritRate', '2-屬性派生', '暴擊率', 1, '暴擊率每敏');
inline('formula', 'st.critDmg = ', P('2-屬性派生', '暴擊傷害', 0), '暴傷基底');
objFieldML('data', 'COMBO_HITS_COEF = {', 'a', '2-屬性派生', '連擊數', 0, '連擊數-a');
objFieldML('data', 'COMBO_HITS_COEF = {', 'b', '2-屬性派生', '連擊數', 1, '連擊數-b');
objFieldML('data', 'COMBO_HITS_COEF = {', 'c', '2-屬性派生', '連擊數', 2, '連擊數-c');
scalar('data', 'ASPD_BASE', '2-屬性派生', '攻擊速度', 0);
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'agiAspdPct', '2-屬性派生', '攻擊速度', 1, '攻速每敏');
inline('formula', 'st.hit = 100 + st.agi * ', P('2-屬性派生', '命中率', 0), '命中每敏');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'agiEvasion', '2-屬性派生', '閃避率', 0, '閃避每敏');
objFieldML('data', 'PRIMARY_STAT_EFFECTS = {', 'strWeight', '2-屬性派生', '負重上限', 0, '負重每力');

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
inlineRegex('formula', /(return def \/ \(def \+ )(-?[\d.]+)/, P('3-戰鬥核心', '防禦減傷率', 0), '防減-常數');
inlineRegex('formula', /(return def \/ \(def \+ -?[\d.]+ \+ )(-?[\d.]+)/, P('3-戰鬥核心', '防禦減傷率', 1), '防減-每級');
// 敵種傷害抗性（普通敵人/普通菁英/普通BOSS）：a/b/c；表列缺席時跳過（相容尚未含此列的舊參數表）
if (index['3-戰鬥核心'] && index['3-戰鬥核心']['敵種傷害抗性']) {
  scalar('formula', 'ENEMY_TYPE_DMG_RED_A', '3-戰鬥核心', '敵種傷害抗性', 0);
  scalar('formula', 'ENEMY_TYPE_DMG_RED_B', '3-戰鬥核心', '敵種傷害抗性', 1);
  scalar('formula', 'ENEMY_TYPE_DMG_RED_C', '3-戰鬥核心', '敵種傷害抗性', 2);
}
inline('formula', 'var randomDamageMultiplier = rnd(', P('3-戰鬥核心', '傷害浮動', 0), '浮動-下');
inlineRegex('formula', /(var randomDamageMultiplier = rnd\(-?[\d.]+, )(-?[\d.]+)/, P('3-戰鬥核心', '傷害浮動', 1), '浮動-上');
numCtx('formula', 'dmg = Math.max(', ', Math.round(dmg))', P('3-戰鬥核心', '最低傷害下限', 0), '最低傷害');
inline('formula', 'iceSlowChance: ', P('3-元素特效', '冰霜 特效', 0), '元素-冰');
inline('formula', 'lightningChance: ', P('3-元素特效', '雷電 特效', 0), '元素-雷');
inline('formula', 'poisonChance: ', P('3-元素特效', '劇毒 特效', 0), '元素-毒');
inline('formula', 'lightCleanseChance: ', P('3-元素特效', '聖光 特效', 0), '元素-光');
numCtx('formula', 'clamp(dCfg.dmgRed, 0, ', ')', P('3-戰鬥核心', '聖佑(神鑄)減傷上限', 0), '聖佑上限');
inline('formula', 'GT - defender._undyingAt >= ', P('3-戰鬥核心', '不朽(神鑄)回復', 1), '不朽秒數');

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
inline('formula', 'effectiveDropRateEffect(lootBonus || 0) / ', P('5-稀有度擲骰', '權重加成 b', 0), '權重加成除數');
inline('formula', ' + s * ', P('5-稀有度擲骰', '權重加成 b', 1), '權重加成每階');
/* 稀有度權重表：每一列形如 [稀有度索引, 權重 * Math.min(b, 上限)]，
   高稀有度另有解鎖階段門檻 (s >= 門檻 ? 權重 : 0)。

   ⚠️ 「上限」的錨點不能綁權重值。綁了的話，權重一被套用，上限就再也對不上——
   而且是靜靜地對不上，那個參數從此形同從參數表消失。實測擾動全表時，
   這裡的 7 個上限全部失配。結構型錨點只認公式形狀，彼此不會互相打死。 */
numCtx('formula', '[0, ', ']', P('5-稀有度擲骰', '普通 權重', 0), '權重-普通');
numCtx('formula', '[1, ', ' * Math.min', P('5-稀有度擲骰', '精良 權重', 0), '權重-精良');
inlineRegex('formula', /(\[1, -?[\d.]+ \* Math\.min\(b, )(-?[\d.]+)/, P('5-稀有度擲骰', '精良 權重', 2), '上限-精良');
numCtx('formula', '[2, ', ' * Math.min', P('5-稀有度擲骰', '稀有 權重', 0), '權重-稀有');
inlineRegex('formula', /(\[2, -?[\d.]+ \* Math\.min\(b, )(-?[\d.]+)/, P('5-稀有度擲骰', '稀有 權重', 2), '上限-稀有');
numCtx('formula', '[3, ', ' * Math.min', P('5-稀有度擲骰', '獨特 權重', 0), '權重-獨特');
inlineRegex('formula', /(\[3, -?[\d.]+ \* Math\.min\(b, )(-?[\d.]+)/, P('5-稀有度擲骰', '獨特 權重', 2), '上限-獨特');
/* 史詩以上多一層階段門檻。門檻值本身也是參數（權重欄位 1），所以連它一起萬用掉。 */
numCtx('formula', '(s >= 8 ? ', ' : 0)', P('5-稀有度擲骰', '史詩 權重', 0), '權重-史詩');
inlineRegex('formula', /(\[4, \(s >= [\d.]+ \? -?[\d.]+ : 0\) \* Math\.min\(b, )(-?[\d.]+)/, P('5-稀有度擲骰', '史詩 權重', 2), '上限-史詩');
numCtx('formula', '(s >= 15 ? ', ' : 0)', P('5-稀有度擲骰', '傳說 權重', 0), '權重-傳說');
inlineRegex('formula', /(\[5, \(s >= [\d.]+ \? -?[\d.]+ : 0\) \* Math\.min\(b, )(-?[\d.]+)/, P('5-稀有度擲骰', '傳說 權重', 2), '上限-傳說');
numCtx('formula', '(s >= 25 ? ', ' : 0)', P('5-稀有度擲骰', '神話 權重', 0), '權重-神話');
inlineRegex('formula', /(\[6, \(s >= [\d.]+ \? -?[\d.]+ : 0\) \* Math\.min\(b, )(-?[\d.]+)/, P('5-稀有度擲骰', '神話 權重', 2), '上限-神話');
numCtx('formula', '(s >= 40 ? ', ' : 0)', P('5-稀有度擲骰', '創世 權重', 0), '權重-創世');
inlineRegex('formula', /(\[7, \(s >= [\d.]+ \? -?[\d.]+ : 0\) \* Math\.min\(b, )(-?[\d.]+)/, P('5-稀有度擲骰', '創世 權重', 2), '上限-創世');

/* ---- §6 裝備 ---- */
numCtx('formula', 'return 1 + ', ' * (item.upgrade', P('6-裝備', '強化倍率', 0), '強化倍率');
// 附魔攻擊類：v = (base + item.level * per)。base 與 per 互不硬編（任一被調整，另一錨點也不會失配）；
// 以「+ item.level *」限定只中 §6 附魔攻那行，不誤中同檔另一處 `var v = (def.base + ...`。
edits.push({ file: 'formula', re: /(var v = \()([\d.]+)( \+ item\.level \* [\d.]+)/, grp: 2, value: P('6-裝備', '附魔-攻擊類', 0), label: '附魔攻-基' });
edits.push({ file: 'formula', re: /(var v = \([\d.]+ \+ item\.level \* )([\d.]+)/, grp: 2, value: P('6-裝備', '附魔-攻擊類', 1), label: '附魔攻-每級' });
numCtx('formula', '(1 + ', ' * (gemLevel || 0))', P('6-裝備', '附魔-攻擊類', 2), '附魔攻-每寶石');
inlineRegex('formula', /(var val = Math\.round\(\()(-?[\d.]+)(?= \+ item\.rarity \* )/, P('6-裝備', '附魔-防禦/功能類', 0), '附魔防-基');
inline('formula', ' + item.rarity * ', P('6-裝備', '附魔-防禦/功能類', 1), '附魔防-每階');
inline('formula', '(gemLevel || 0) * ', P('6-裝備', '附魔-防禦/功能類', 2), '附魔防-每寶石');
inline('formula', 'Math.min(val, ', P('6-裝備', '附魔-防禦/功能類', 3), '附魔防-上限');
inlineRegex('formula', /(scrap: Math\.max\(1, Math\.round\(\()(-?[\d.]+)(?= \+ it\.level \* )/, P('6-裝備', '分解-碎片', 0), '分解碎-基');
inlineRegex('formula', /(scrap: Math\.max\(1, Math\.round\(\(-?[\d.]+ \+ it\.level \* )(-?[\d.]+)/, P('6-裝備', '分解-碎片', 1), '分解碎-每級');
numCtx('formula', 'gold: Math.round((', ' + it.level) * r.salv * ', P('6-裝備', '分解-金幣', 0), '分解金-基');
inline('formula', ') * r.salv * ', P('6-裝備', '分解-金幣', 1), '分解金-倍率');

/* ---- §7 強化 / 洗煉 ---- */
numCtx('formula', 'return Math.max(', ', 100 - (nextLevel - 5)', P('7-強化', '基礎成功率', 0), '強化率下限');
inline('formula', '100 - (nextLevel - 5) * ', P('7-強化', '基礎成功率', 1), '強化率遞減');
/* 強化／洗煉費用：形如 <資源>: Math.round(係數 * Math.pow(底, 指數變數) * (1 + it.level * 每級))
   三個參數同在一行，錨點一律萬用掉其他兩個，否則套用其中一個就會打死另外兩個。
   以 lv / it.rarity 這個指數變數區分強化與洗煉，兩者的行形狀在其餘部分相同。 */
inlineRegex('formula', /(gold: Math\.round\()(-?[\d.]+)(?= \* Math\.pow\([\d.]+, lv\))/, P('7-強化', '金幣費用', 0), '強化金-係數');
inlineRegex('formula', /(gold: Math\.round\(-?[\d.]+ \* Math\.pow\()(-?[\d.]+)(?=, lv\))/, P('7-強化', '金幣費用', 1), '強化金-底');
inlineRegex('formula', /(gold: Math\.round\(-?[\d.]+ \* Math\.pow\([\d.]+, lv\) \* \(1 \+ it\.level \* )(-?[\d.]+)/, P('7-強化', '金幣費用', 2), '強化金-每級');
inlineRegex('formula', /(scrap: Math\.round\()(-?[\d.]+)(?= \* Math\.pow\([\d.]+, lv\))/, P('7-強化', '碎片費用', 0), '強化碎-係數');
inlineRegex('formula', /(scrap: Math\.round\(-?[\d.]+ \* Math\.pow\()(-?[\d.]+)(?=, lv\))/, P('7-強化', '碎片費用', 1), '強化碎-底');
inlineRegex('formula', /(scrap: Math\.round\(-?[\d.]+ \* Math\.pow\([\d.]+, lv\) \* \(1 \+ it\.level \* )(-?[\d.]+)/, P('7-強化', '碎片費用', 2), '強化碎-每級');
inlineRegex('formula', /(gold: Math\.round\()(-?[\d.]+)(?= \* Math\.pow\([\d.]+, it\.rarity\))/, P('7-洗煉', '金幣費用', 0), '洗煉金-係數');
inlineRegex('formula', /(gold: Math\.round\(-?[\d.]+ \* Math\.pow\()(-?[\d.]+)(?=, it\.rarity\))/, P('7-洗煉', '金幣費用', 1), '洗煉金-底');
inlineRegex('formula', /(gold: Math\.round\(-?[\d.]+ \* Math\.pow\([\d.]+, it\.rarity\) \* \(1 \+ it\.level \* )(-?[\d.]+)/, P('7-洗煉', '金幣費用', 2), '洗煉金-每級');
scalar('formula', 'AFFIX_REROLL_LOWER_WEIGHT', '7-洗煉', '數值洗煉分段權重', 0);
scalar('formula', 'AFFIX_REROLL_UPPER_BASE_WEIGHT', '7-洗煉', '數值洗煉分段權重', 1);
scalar('formula', 'AFFIX_REROLL_BIAS_EXPONENT', '7-洗煉', '數值洗煉分段權重', 2);

/* ---- §8 寶石 ---- */
inline('formula', 'g.base * level * (1 + ', P('8-寶石', '能力數值(1~5階)', 0), '寶石係數a');
inline('formula', 'g.base * GEM_MAX_LEVEL * (1 + ', P('8-寶石', '能力數值(1~5階)', 0), '寶石係數b');
inline('formula', 'base5 * Math.pow(', P('8-寶石', '能力數值(6~10階神鑄)', 0), '寶石神鑄底');
numCtx('formula', 'return ', ' + (level - GEM_MAX_LEVEL)', P('6-神鑄', '寶石神鑄金幣', 0), '寶石神鑄金-基');
inline('formula', '(level - GEM_MAX_LEVEL) * ', P('6-神鑄', '寶石神鑄金幣', 0), '寶石神鑄金-每階');
inlineRegex('formula', /(return )(-?[\d.]+)(?= \+ Math\.pow\(level, [\d.]+\) \* )/, P('8-寶石商店', '升級費用', 0), '寶店升級-基');
inline('formula', 'Math.pow(level, ', P('8-寶石商店', '升級費用', 1), '寶店升級-次方');
inlineRegex('formula', /(Math\.pow\(level, [\d.]+\) \* )(-?[\d.]+)/, P('8-寶石商店', '升級費用', 2), '寶店升級-係數');

/* ---- §9 技能 ---- */
inlineRegex('formula', /(var cost = Math\.floor\()(-?[\d.]+)(?= \* lv \+ Math\.pow\()/, P('9-技能', '升級費用', 0), '技升-係數');
inline('formula', ' + Math.pow(', P('9-技能', '升級費用', 1), '技升-底');
inline('formula', '1 + lv / ', P('9-技能', '升級費用', 2), '技升-除數');
inline('formula', 'skillBaseManaCost(def) * (1 + ', P('9-技能', '一般技能法力消耗', 0), '法力每級');
inlineRegex('formula', /(function loadoutSize\(\)[\s\S]*?Math\.floor\(lvl\s*\/\s*)(-?[\d.]+)(?=\s*\)\s*\)\s*\)\s*;)/,
  P('1-成長經驗', '技能裝載欄', 0), '裝載欄-每級');
inlineRegex('formula', /(function loadoutSize\(\)[\s\S]*?return Math\.min\(-?[\d.]+\s*,\s*Math\.max\()(-?[\d.]+)(?=\s*,\s*-?[\d.]+\s*\+\s*Math\.floor\(lvl\s*\/\s*-?[\d.]+\s*\)\s*\)\s*\)\s*;)/,
  P('1-成長經驗', '技能裝載欄', 1), '裝載欄-下限');
inlineRegex('formula', /(function loadoutSize\(\)[\s\S]*?return Math\.min\(-?[\d.]+\s*,\s*Math\.max\(-?[\d.]+\s*,\s*)(-?[\d.]+)(?=\s*\+\s*Math\.floor\(lvl\s*\/\s*-?[\d.]+\s*\)\s*\)\s*\)\s*;)/,
  P('1-成長經驗', '技能裝載欄', 1), '裝載欄-基準');
inlineRegex('formula', /(function loadoutSize\(\)[\s\S]*?return Math\.min\()(-?[\d.]+)(?=\s*,\s*Math\.max\()/,
  P('1-成長經驗', '技能裝載欄', 2), '裝載欄-上限');

/* ---- Batch2a：補接 formula.js 內漏接的可調單值（多值行用正規式避免相依錨點失配） ---- */
numCtx('formula', 'gold: Math.round(', ' * floor', P('5-高塔獎勵', '金幣', 0), '高塔-金幣');
numCtx('formula', 'Math.floor(floor / ', ')', P('5-高塔獎勵', '寶石', 0), '高塔-寶石');
numCtx('formula', 'essence: ', ' + floor', P('5-高塔獎勵', '附魔精華', 0), '高塔-附魔精華');
edits.push({ file: 'formula', re: /(itemLevel: )([\d.]+)( \+ floor)/, grp: 2, value: P('5-高塔獎勵', '裝備戰利品等級', 0), label: '高塔-裝備等級底' });
edits.push({ file: 'formula', re: /(itemLevel: [\d.]+ \+ floor \* )([\d.]+)/, grp: 2, value: P('5-高塔獎勵', '裝備戰利品等級', 1), label: '高塔-裝備等級係數' });
numCtx('formula', 's *= 1 + ', ' * it.godPassives.length', P('6-裝備', '戰力評分', 0), '戰力-神鑄每條');
numCtx('formula', 's *= 1 + it.rarity * ', ';', P('6-裝備', '戰力評分', 1), '戰力-稀有度');
// 背包擴充費用：a + b × c^購買次數（具名常數；a/b/c＝參數 0/1/2）
scalar('data', 'INVENTORY_EXPAND_COST_BASE', '7-容量', '背包擴充費用', 0);
scalar('data', 'INVENTORY_EXPAND_COST_MULT', '7-容量', '背包擴充費用', 1);
scalar('data', 'INVENTORY_EXPAND_COST_RATE', '7-容量', '背包擴充費用', 2);
inline('formula', 'GEM_CONVERT_SLOTS = ', P('8-寶石', '寶石轉換(九宮格)', 0), 'GEM_CONVERT_SLOTS');
inline('formula', 'GEM_CONVERT_STACK = ', P('8-寶石', '寶石轉換(九宮格)', 1), 'GEM_CONVERT_STACK');
inline('formula', 'GEM_DISMANTLE_KEEP = ', P('8-寶石', '寶石拆解(一般)', 0), 'GEM_DISMANTLE_KEEP');

/* ---- Batch2b：跨檔（formula/combat/item）補接 ---- */
// 護盾（單一常數；使用者採表格值：溢出轉護盾 1%、護盾上限 10%）
scalar('formula', 'SHIELD_OVERFLOW_PCT', '3-戰鬥核心', '溢出治療轉護盾', 0);
scalar('formula', 'SHIELD_HEAL_CAP_PCT', '3-戰鬥核心', '護盾上限(治療轉化)', 0);
scalar('formula', 'SHIELD_SKILL_CAP_PCT', '3-戰鬥核心', '護盾上限(技能給予)', 0);
// 菁英倍率（formula.js；金幣與經驗共用參數 c）
numCtx('formula', 'm.hp *= ', ';', P('4-野外怪物', '菁英倍率', 0), '菁英-生命');
numCtx('formula', 'm.atk *= ', ';', P('4-野外怪物', '菁英倍率', 1), '菁英-攻擊');
numCtx('formula', 'm.gold *= ', ';', P('4-野外怪物', '菁英倍率', 2), '菁英-金幣');
numCtx('formula', 'm.xp *= ', ';', P('4-野外怪物', '菁英倍率', 2), '菁英-經驗');
numCtx('formula', 'm.dodge += ', ';', P('4-野外怪物', '菁英倍率', 3), '菁英-閃避');
numCtx('formula', 'm.aspd = ', ';', P('4-野外怪物', '菁英倍率', 4), '菁英-攻速');
// 怪物命中 fallback（monsterAtkCfg：hit: m.hit || a；實際命中率由「4-野外怪物/命中率」與「4-高塔BOSS/命中率」的 m.hit 驅動，此處僅為保底預設值）
numCtx('combat', 'hit: m.hit || ', ',', P('3-戰鬥核心', '怪物固定戰鬥值', 0), '怪物-命中');
// 敵人爆擊（formula.js §4；2026-07-30 起依敵種區分，取代原「怪物固定戰鬥值」的暴擊a/暴傷b）
scalar('formula', 'ENEMY_CRIT_RATE_NORMAL', '3-戰鬥核心', '敵人爆擊', 0);
scalar('formula', 'ENEMY_CRIT_RATE_ELITE', '3-戰鬥核心', '敵人爆擊', 1);
scalar('formula', 'ENEMY_CRIT_RATE_BOSS', '3-戰鬥核心', '敵人爆擊', 2);
scalar('formula', 'ENEMY_CRIT_DMG_PCT', '3-戰鬥核心', '敵人爆擊', 3);
// 穿透 → 忽略防禦曲線（formula.js §3；穿透不設上限，超過 100% 的忽略量轉增傷）
scalar('formula', 'PEN_IGNORE_A', '3-戰鬥核心', '穿透忽略防禦', 0);
scalar('formula', 'PEN_IGNORE_B', '3-戰鬥核心', '穿透忽略防禦', 1);
scalar('formula', 'PEN_IGNORE_C', '3-戰鬥核心', '穿透忽略防禦', 2);
// 野外菁英掉落倍率（formula.js 常數 ELITE_DROP_MULT；野外 rollFieldDrops 與離線收益共用）
scalar('formula', 'ELITE_DROP_MULT', '4-野外怪物', '野外菁英掉落倍率', 0);
// 寶石商店刷新週期（item.js，單一常數）
scalar('item', 'GEM_SHOP_REFRESH_HOURS', '8-寶石商店', '刷新週期', 0);
// 技能點（2026-07-30 熟練度制）：a=基礎點數(skills.js SKILL_POINT_BASE，須與 player.js 初始 skills 數量一致)；b 已停用（升級不再給點）；
// c=舊制上限常數（data.js SKILL_POINT_BUDGET_CAP，改制後僅保留相容）
numCtx('skills', 'var SKILL_POINT_BASE = ', ';', P('1-成長經驗', '技能點總預算', 0), '技能點-基礎');
scalar('data', 'SKILL_POINT_BUDGET_CAP', '1-成長經驗', '技能點總預算', 2);
// 技能熟練度（2026-07-30）：經驗需求 ⌊a×L^b+c⌋；上限等級與擊殺經驗率（formula.js §9）
scalar('formula', 'SKILL_MASTERY_XP_A', '1-成長經驗', '技能熟練度經驗需求', 0);
scalar('formula', 'SKILL_MASTERY_XP_B', '1-成長經驗', '技能熟練度經驗需求', 1);
scalar('formula', 'SKILL_MASTERY_XP_C', '1-成長經驗', '技能熟練度經驗需求', 2);
scalar('formula', 'SKILL_MASTERY_MAX_LEVEL', '1-成長經驗', '技能熟練度', 0);
scalar('formula', 'SKILL_MASTERY_XP_RATE', '1-成長經驗', '技能熟練度', 1);
// 技能融合（2026-07-30 種子演算法）：花費／物魔判定／攻擊力四檔／同屬性／效果融合／成長曲線／卷軸換算
scalar('formula', 'FUSION_GOLD_COST_PER_COMP', '9-融合', '融合花費', 0);
scalar('formula', 'FUSION_SCROLL_COST_PER_COMP', '9-融合', '融合花費', 1);
scalar('formula', 'FUSION_BOTH_BASE_CHANCE', '9-融合', '物魔判定', 0);
scalar('formula', 'FUSION_BOTH_STAT_FACTOR', '9-融合', '物魔判定', 1);
arrayContent('formula', 'FUSION_ATK_TIERS',
  [0, 1, 2, 3].map(i => P('9-融合', '攻擊力四檔', i)).join(', '), 'FUSION_ATK_TIERS');
arrayContent('formula', 'FUSION_ATK_TIER_WEIGHTS',
  [4, 5, 6, 7].map(i => P('9-融合', '攻擊力四檔', i)).join(', '), 'FUSION_ATK_TIER_WEIGHTS');
scalar('formula', 'FUSION_SAME_ELEM_BONUS', '9-融合', '同屬性加成', 0);
scalar('formula', 'FUSION_EFFECT_FUSE_CHANCE', '9-融合', '效果融合機率', 0);
scalar('formula', 'FUSION_LV1_RATIO', '9-融合', '成長曲線', 0);
scalar('formula', 'MAGIC_SCROLL_ESSENCE_RATIO', '6-分解精華機率', '魔法卷軸換算', 0);

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
// 比較兩段文字的數值序列是否相同（忽略空白/格式差異）
function numsEqual(a, b) {
  const na = (String(a).match(/-?[\d.]+/g) || []).map(Number);
  const nb = (String(b).match(/-?[\d.]+/g) || []).map(Number);
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
      const chg = e.multiGroup ? !numsEqual(cur, e.value) : (Number(cur) !== Number(e.value));
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
