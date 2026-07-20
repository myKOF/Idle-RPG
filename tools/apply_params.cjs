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
        屬性上限、戰鬥核心、高塔 BOSS 倍率、稀有度擲骰、強化/洗煉/寶石/技能費用等），共 626 個參數。
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
function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// 具名純量常數： var NAME = <num>;
function scalarValue(file, varName, value, label) {
  edits.push({ file, re: new RegExp('(\\b' + esc(varName) + '\\s*=\\s*)(-?[\\d.]+)'), grp: 2, value: String(value), label: label || varName });
}
function scalar(file, varName, cat, name, i) {
  scalarValue(file, varName, P(cat, name, i), varName);
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
function objFieldML(file, keyAnchor, field, cat, name, i, label) {
  edits.push({
    file,
    re: new RegExp('(' + esc(keyAnchor) + '[\\s\\S]*?\\b' + esc(field) + ':\\s*)(-?[\\d.]+)'),
    grp: 2, value: P(cat, name, i), label: (label || keyAnchor) + '.' + field
  });
}
// 內嵌唯一片段： <prefix><num> —— prefix 需在整檔唯一
function inline(file, prefix, value, label) {
  edits.push({ file, re: new RegExp('(' + esc(prefix) + ')(-?[\\d.]+)'), grp: 2, value: String(value), label });
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
const RAR_KEYS = { '普通': 'common', '精良': 'uncommon', '稀有': 'rare', '獨特': 'unique', '史詩': 'epic', '傳說': 'legendary', '神話': 'mythic', '創世': 'genesis', '神鑄創世': 'godforged' };
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
   特殊被動 → config/CSV/Equipment_Affix.csv（PASSIVE_POOL）
   神鑄特效 → config/CSV/Equipment_Affix.csv（GODFORGE_POOL）
   寶石種類 → config/CSV/Gems.csv（GEM_TYPES）
   由 tools/config_tables.cjs 雙向套用；此處刻意不再定義 表-詞條池/表-特殊被動/表-神鑄特效/表-寶石種類 的錨點。
   game_parameters 內若仍殘留這四組的舊列，一律為「死列」（apply_params 忽略），
   實際數值以上述四表為準（唯一來源）。 */

// 自動機組零件：perTier(0)
const PART_KEYS = { '加速齒輪': 'speedGear', '碎片熔煉爐': 'scrapForge', '淘金濾網': 'goldSluice', '精粹透鏡': 'extractLens', '拓本回收臂': 'bookScavenger', '複製處理艙': 'duplicator', '知識回收器': 'archivist', '探礦核心': 'prospector', '幸運晶片': 'fortuneChip', '太古精華萃取器': 'ancientEssenceRate', '幸運核心': 'luckCore', '重骰模組': 'rerollModule' };
Object.keys(PART_KEYS).forEach(nm => objField('data', PART_KEYS[nm] + ':', 'perTier', '表-自動機組零件', nm, 0, '零件-' + nm));

// 場景倍率：hpMult(0) atkMult(1) defMult(2) aspdMult(3) rewardMult(4)
const ZONE_KEYS = { '草原': 'plains', '荒漠': 'desert', '沼澤': 'swamp' };
Object.keys(ZONE_KEYS).forEach(nm => {
  const a = ZONE_KEYS[nm] + ':';
  objFieldML('data', a, 'hpMult', '4-場景倍率', nm, 0, '場景-' + nm);
  objFieldML('data', a, 'atkMult', '4-場景倍率', nm, 1, '場景-' + nm);
  objFieldML('data', a, 'defMult', '4-場景倍率', nm, 2, '場景-' + nm);
  objFieldML('data', a, 'aspdMult', '4-場景倍率', nm, 3, '場景-' + nm);
  objFieldML('data', a, 'rewardMult', '4-場景倍率', nm, 4, '場景-' + nm);
});

/* ---- data.js 具名純量常數 ---- */
scalar('data', 'MAX_AFFIXES', '表-固定參數', '詞條數硬上限', 0);
// 太古常數
scalar('data', 'ANCIENT_AFFIX_BASE_RATE', '5-太古詞條', '野外太古詞條機率', 1);
scalar('data', 'ANCIENT_AFFIX_ENEMY_RATE', '5-太古詞條', '野外太古詞條機率', 3);
scalar('data', 'ANCIENT_AFFIX_RATE_CAP', '5-太古詞條', '野外太古詞條機率', 0);
scalar('data', 'ANCIENT_BOSS_AFFIX_BASE_RATE', '5-太古詞條', '高塔太古詞條機率', 1);
scalar('data', 'ANCIENT_BOSS_AFFIX_LEVEL_RATE', '5-太古詞條', '高塔太古詞條機率', 3);
scalar('data', 'ANCIENT_ESSENCE_ENEMY_BASE_RATE', '5-野外材料', '太古精華', 1);
scalar('data', 'ANCIENT_ESSENCE_ENEMY_LEVEL_RATE', '5-野外材料', '太古精華', 3);
scalar('data', 'ANCIENT_ESSENCE_ENEMY_RATE_CAP', '5-野外材料', '太古精華', 0);
scalar('data', 'ANCIENT_ESSENCE_ENEMY_MIN_LEVEL', '5-野外材料', '太古精華', 2);
scalar('data', 'ANCIENT_ESSENCE_BOSS_BASE_RATE', '5-太古詞條', '高塔太古精華機率', 1);
scalar('data', 'ANCIENT_ESSENCE_BOSS_LEVEL_RATE', '5-太古詞條', '高塔太古精華機率', 3);
scalar('data', 'ANCIENT_ESSENCE_BOSS_RATE_CAP', '5-太古詞條', '高塔太古精華機率', 0);
scalar('data', 'ANCIENT_REROLL_CHANCE', '7-洗煉', '太古精華洗煉', 0);
scalar('data', 'ANCIENT_AFFIX_VALUE_MULT', '5-太古詞條', '太古詞條數值倍率', 0);
scalar('data', 'ANCIENT_ENEMY_MIN_LEVEL', '5-太古詞條', '野外太古詞條機率', 2);
// 等級上限（升級所需經驗 參數 d）
scalar('data', 'MAX_LEVEL', '1-成長經驗', '升級所需經驗', 3);
// 轉生
scalar('data', 'REINCARNATION_LEVEL', '1-成長經驗', '可轉生等級 / 最高轉生', 0);
scalar('data', 'REINCARNATION_MAX', '1-成長經驗', '可轉生等級 / 最高轉生', 1);
// 神鑄
scalar('data', 'FORGE_UNLOCK_LEVEL', '1-成長經驗', '神鑄系統解鎖等級', 0);
scalar('data', 'FORGE_UNLOCK_REINCARNATION', '1-成長經驗', '神鑄系統解鎖等級', 1);
scalar('data', 'FORGE_DUST_RATE', '6-神鑄', '裝備神鑄成功率', 0);
scalar('data', 'FORGE_GEM_DUST_RATE', '6-神鑄', '寶石神鑄成功率', 0);
scalar('data', 'FORGE_FAIL_CONSUME', '6-神鑄', '神鑄失敗', 0);
scalar('data', 'FORGE_SLOTS', '6-神鑄', '神鑄槽位 / 魔塵上限', 0);
// FORGE_BASE_RATE / FORGE_GOLD_COST / FORGE_EQUIP_DURATION（物件）
objField('data', 'FORGE_BASE_RATE = {', '5', '6-神鑄', '裝備神鑄基礎成功率', 0, 'FORGE_BASE_RATE');
objField('data', 'FORGE_BASE_RATE = {', '6', '6-神鑄', '裝備神鑄基礎成功率', 1, 'FORGE_BASE_RATE');
objField('data', 'FORGE_BASE_RATE = {', '7', '6-神鑄', '裝備神鑄基礎成功率', 2, 'FORGE_BASE_RATE');
objField('data', 'FORGE_GOLD_COST = {', '5', '6-神鑄', '裝備神鑄金幣', 0, 'FORGE_GOLD_COST');
objField('data', 'FORGE_GOLD_COST = {', '6', '6-神鑄', '裝備神鑄金幣', 1, 'FORGE_GOLD_COST');
objField('data', 'FORGE_GOLD_COST = {', '7', '6-神鑄', '裝備神鑄金幣', 2, 'FORGE_GOLD_COST');
objField('data', 'FORGE_EQUIP_DURATION = {', '5', '6-神鑄', '裝備神鑄時間(秒)', 0, 'FORGE_EQUIP_DURATION');
objField('data', 'FORGE_EQUIP_DURATION = {', '6', '6-神鑄', '裝備神鑄時間(秒)', 1, 'FORGE_EQUIP_DURATION');
objField('data', 'FORGE_EQUIP_DURATION = {', '7', '6-神鑄', '裝備神鑄時間(秒)', 2, 'FORGE_EQUIP_DURATION');
['0', '1', '2', '3', '4'].forEach((k, idx) => {
  const codeKey = [5, 6, 7, 8, 9][idx];
  objField('data', 'FORGE_GEM_BASE_RATE = {', String(codeKey), '6-神鑄', '寶石神鑄基礎成功率', idx, 'FORGE_GEM_BASE_RATE');
  objField('data', 'FORGE_GEM_DURATION = {', String(codeKey), '6-神鑄', '寶石神鑄時間(秒)', idx, 'FORGE_GEM_DURATION');
});
// 魔塵掉落
scalar('data', 'DUST_FIELD_MIN_LEVEL', '5-野外材料', '魔塵', 2);
scalar('data', 'DUST_FIELD_BASE', '5-野外材料', '魔塵', 1);
scalar('data', 'DUST_FIELD_PER_LEVEL', '5-野外材料', '魔塵', 3);
scalar('data', 'DUST_FIELD_CAP', '5-野外材料', '魔塵', 0);
scalar('data', 'DUST_BOSS_BASE', '4-高塔BOSS', '高塔 BOSS 魔塵', 1);
scalar('data', 'DUST_BOSS_PER_LEVEL', '4-高塔BOSS', '高塔 BOSS 魔塵', 2);
scalar('data', 'DUST_BOSS_CAP', '4-高塔BOSS', '高塔 BOSS 魔塵', 0);
// 高塔
rangeBound('data', 'TOWER_TRIAL_MAX_FLOOR', '4-高塔BOSS', '試練之塔範圍', 0, 2);
rangeBound('data', 'TOWER_HELL_MAX_FLOOR', '4-高塔BOSS', '試練之塔範圍', 1, 2);
rangeBound('data', 'TOWER_PURGATORY_MAX_FLOOR', '4-高塔BOSS', '試練之塔範圍', 2, 2);
scalar('data', 'TOWER_BOSS_REF_STAGE_BASE', '4-高塔BOSS', '對應野外階段', 0);
scalar('data', 'TOWER_BOSS_REF_STAGE_PER_FLOOR', '4-高塔BOSS', '對應野外階段', 1);
scalar('data', 'TOWER_BOSS_LEVEL_BONUS', '4-高塔BOSS', 'BOSS 等級', 0);
scalar('data', 'TOWER_BOSS_HIT_BASE', '4-高塔BOSS', '命中率', 0);
scalar('data', 'TOWER_BOSS_HIT_PER_FLOOR', '4-高塔BOSS', '命中率', 1);
scalar('data', 'TOWER_BASE_HP_MULT', '4-高塔BOSS', '生命', 0);
scalar('data', 'TOWER_HELL_HP_MULT', '4-高塔BOSS', '生命', 1);
scalar('data', 'TOWER_PURGATORY_HP_MULT', '4-高塔BOSS', '生命', 2);
scalar('data', 'TOWER_BASE_ATK_MULT', '4-高塔BOSS', '攻擊', 0);
scalar('data', 'TOWER_HELL_ATK_MULT', '4-高塔BOSS', '攻擊', 1);
scalar('data', 'TOWER_PURGATORY_ATK_MULT', '4-高塔BOSS', '攻擊', 2);
scalar('data', 'TOWER_BOSS_DEF_MULT', '4-高塔BOSS', '物/魔防', 0);
scalar('data', 'TOWER_BOSS_ASPD', '4-高塔BOSS', '攻速 / 控制抵抗', 0);
scalar('data', 'TOWER_BOSS_CTRL_RES', '4-高塔BOSS', '攻速 / 控制抵抗', 1);
scalar('data', 'TOWER_BOSS_DODGE_BASE', '4-高塔BOSS', '閃避率', 0);
scalar('data', 'TOWER_BOSS_DODGE_CAP', '4-高塔BOSS', '閃避率', 1);
scalar('data', 'TOWER_BOSS_DODGE_PER_FLOOR', '4-高塔BOSS', '閃避率', 2);
scalar('data', 'TOWER_BOSS_ELEM_ATK_BASE', '4-高塔BOSS', '元素附傷(元素 BOSS)', 0);
scalar('data', 'TOWER_BOSS_ELEM_HELL_MULT', '4-高塔BOSS', '元素附傷(元素 BOSS)', 1);
scalar('data', 'TOWER_BOSS_XP_MULT', '4-高塔BOSS', '經驗', 0);
scalar('data', 'TOWER_HELL_SOUL_ORIGIN_BASE_RATE', '4-高塔BOSS', '魔魂本源(地獄之塔)', 0);
scalar('data', 'TOWER_HELL_SOUL_ORIGIN_PER_FLOOR', '4-高塔BOSS', '魔魂本源(地獄之塔)', 1);
scalar('data', 'DEMON_SEED_BOSS_RATE_CAP', '4-高塔BOSS', '魔種(煉獄之塔)', 0);
scalar('data', 'DEMON_SEED_BOSS_BASE_RATE', '4-高塔BOSS', '魔種(煉獄之塔)', 1);
scalar('data', 'DEMON_SEED_BOSS_PER_FLOOR', '4-高塔BOSS', '魔種(煉獄之塔)', 2);
scalar('data', 'TOWER_TIME_LIMIT', '4-高塔BOSS', '戰鬥規則', 0);
scalar('data', 'TOWER_ENRAGE_TIME', '4-高塔BOSS', '戰鬥規則', 1);
inline('data', 'TOWER_ENRAGE_HP = ', 50, 'TOWER_ENRAGE_HP'); // 狂暴血量門檻（無對應可調 CSV 欄，固定內嵌）
scalar('data', 'TOWER_ENRAGE_MULT', '4-高塔BOSS', '戰鬥規則', 2);
// 寶石相關
scalar('data', 'GEM_MAX_LEVEL', '表-固定參數', '寶石一般上限 / 神鑄上限', 0);
scalar('data', 'GEM_FORGE_MAX_LEVEL', '表-固定參數', '寶石一般上限 / 神鑄上限', 1);
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
scalar('data', 'RESPAWN_DELAY', '表-固定參數', '出怪間隔', 0);
scalar('data', 'REVIVE_DELAY', '表-固定參數', '死亡復活時間', 0);
scalar('data', 'CONVEYOR_CAP', '7-容量', '輸送帶容量', 0);
scalar('data', 'SYNTH_BUFFER_CAP', '7-容量', '合成暫存區', 0);
scalar('data', 'INVENTORY_CAP', '7-容量', '背包容量', 0);
inline('data', 'INVENTORY_MAX = ', 1000, 'INVENTORY_MAX');
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
// 太古精華洗煉消耗（依稀有度 0~8 陣列）
arrayContent('data', 'REROLL_ANCIENT_ESSENCE_COST',
  index['7-洗煉']['太古精華洗煉消耗'].slice(0, 9).join(', '), 'REROLL_ANCIENT_ESSENCE_COST');
// FUSE_GOLD_COST = [0, 100, 300, 900, 2700, 8100]
{
  const g = [0, 1, 2, 3, 4].map(i => P('8-寶石', '寶石合成金幣', i));
  arrayContent('data', 'FUSE_GOLD_COST', '0, ' + g.join(', '), 'FUSE_GOLD_COST');
}
// REINCARNATION_EXTRA_MULTIPLIERS = [0, 10, 20, ...5120]（索引0固定0；1~10 取 CSV 轉生對照表 param a）
{
  const g = [];
  for (let n = 1; n <= 10; n++) g.push(P('1-轉生對照表', '轉生 ' + n + ' 次', 0));
  arrayContent('data', 'REINCARNATION_EXTRA_MULTIPLIERS', '0, ' + g.join(', '), 'REINCARNATION_EXTRA_MULTIPLIERS');
}
// REINCARNATION_EXP_BASE_ADD = [0, 100000, 300000, ...]（索引0固定0；1~10 取 CSV 轉生對照表 param c＝升級經驗基礎增加值）
{
  const g = [];
  for (let n = 1; n <= 10; n++) g.push(P('1-轉生對照表', '轉生 ' + n + ' 次', 2));
  arrayContent('data', 'REINCARNATION_EXP_BASE_ADD', '0, ' + g.join(', '), 'REINCARNATION_EXP_BASE_ADD');
}
// FIELD_ENEMY_COUNT_TABLE = [[1,60],[2,25],[3,10],[4,5]]
{
  const c = ['1 隻', '2 隻', '3 隻', '4 隻'].map((nm, i) => '[' + (i + 1) + ', ' + P('4-敵人數量', nm, 0) + ']');
  arrayContent('data', 'FIELD_ENEMY_COUNT_TABLE', c.join(', '), 'FIELD_ENEMY_COUNT_TABLE');
}
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
// 野外裝備：CSV 每品質 4 個 bracket（1~49,50~99,100~149,150+）→ code min 1/50/100/150
{
  const quals = ['普通', '精良', '稀有', '獨特', '史詩', '傳說', '神話', '創世'];
  const brIdxByMin = { 1: 0, 50: 1, 100: 2, 150: 3 };
  [1, 50, 100, 150].forEach(min => {
    const rates = quals.map(q => parseTuple(index['5-野外裝備掉落'][q + '裝備'][brIdxByMin[min]]));
    edits.push({ file: 'data', scopeVar: 'FIELD_DROP_TABLE', re: new RegExp('min: ' + min + ',\\s*rates:\\s*\\[([^\\]]*)\\]'), grp: 1, value: rates.join(', '), label: 'FIELD_DROP min' + min, multiGroup: true });
  });
}
// 野外寶石：CSV 每 bracket 一列，5 tier；code min 1/51/101/151/201/251/301
{
  const brName = { 1: '1~50', 51: '51~100', 101: '101~150', 151: '151~200', 201: '201~250', 251: '251~300', 301: '301+' };
  Object.keys(brName).forEach(min => {
    const params = index['5-野外寶石掉落']['怪物等級 ' + brName[min]].slice(0, 5);
    edits.push({ file: 'data', scopeVar: 'FIELD_GEM_DROP_TABLE', re: new RegExp('min: ' + min + ',\\s*rates:\\s*\\[([^\\]]*)\\]'), grp: 1, value: params.join(', '), label: 'FIELD_GEM min' + min, multiGroup: true });
  });
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
scalar('formula', 'KILL_HEAL_PCT', '3-戰鬥核心', '擊殺回復', 0);
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
scalar('formula', 'TIER_GATE_POINTS', '9-技能', '技能樹門檻', 0);
scalar('formula', 'SKILL_CAST_LOCK', '9-技能', '施放硬直', 0);
scalar('formula', 'SKILL_GLOBAL_COOLDOWN', '9-技能', '技能共用冷卻(GCD)', 0);
// ESSENCE_SALVAGE_CHANCE_BY_RARITY = [0.1,0.5,1,2,4,8,20,100,100]
arrayContent('formula', 'ESSENCE_SALVAGE_CHANCE_BY_RARITY',
  index['6-分解精華機率']['附魔精華拆解機率'].slice(0, 9).join(', '), 'ESSENCE_SALVAGE_CHANCE_BY_RARITY');
// ANCIENT_ESSENCE_SALVAGE_CHANCE = { 4: 史詩, 5: 傳說, 6: 神話, 7: 創世, 8: 神鑄 }（普通~獨特不掉，物件無該鍵）
['4', '5', '6', '7', '8'].forEach(k => {
  objField('data', 'ANCIENT_ESSENCE_SALVAGE_CHANCE = {', k, '6-分解精華機率', '太古精華拆解機率(依稀有度)', Number(k), '太古拆解機率.' + k);
});
// SCORE_WEIGHTS（重建物件內容）
{
  const wKeyByName = {
    '物理攻擊': 'atkFlat', '物理攻擊%': 'atkPct', '魔法攻擊': 'matkFlat', '魔法攻擊%': 'matkPct',
    '生命值': 'hpFlat', '生命值%': 'hpPct', '生命恢復/秒': 'hpRegen', '物理防禦': 'defFlat', '物理防禦%': 'defPct', '魔法防禦': 'mdefFlat',
    '法力值': 'mpFlat', '法力恢復/秒': 'mpRegen', '力量': 'str', '敏捷': 'agi', '智力': 'int', '耐力': 'vit',
    '攻擊速度%': 'aspd', '暴擊率%': 'critRate', '暴擊傷害%': 'critDmg', '物理穿透%': 'pPen', '魔法穿透%': 'mPen', '命中率%': 'hit', '冷卻縮減%': 'cdr', '施法速度%': 'castSpeed',
    '吸血%': 'lifesteal', '吸魔%': 'manaSteal', '對菁英傷害%': 'eliteDmg', '對BOSS傷害%': 'bossDmg', '對普通敵人傷害%': 'normalDmg', '範圍傷害%': 'aoeDmg', '全局減傷': 'globalDmgRed',
    '普通敵人傷害抗性': 'normalDmgRed', '菁英傷害抗性': 'eliteDmgRed', 'BOSS傷害抗性': 'bossDmgRed',
    '格擋率%': 'blockRate', '格擋減傷%': 'blockDmgRed', '閃避率%': 'evasion', '韌性%': 'tenacity', '護盾效率%': 'shieldEff', '物理抗性%': 'pRes', '魔法抗性%': 'mRes',
    '火焰抗性%': 'resFire', '冰霜抗性%': 'resIce', '雷電抗性%': 'resLightning', '劇毒抗性%': 'resPoison', '聖光抗性%': 'resLight', '暗影抗性%': 'resDark',
    '控制時間縮減%': 'ccRed', '移動速度%': 'moveSpeed', '掉寶率%': 'loot', '經驗加成%': 'xpBonus', '金幣加成%': 'goldBonus',
    '幸運值': 'luck', '負重上限': 'weight', '強化成功率%': 'enhanceSuccess', '分解高產率%': 'decomposeYield',
    '合成變異率%': 'hybridMutation', '狂暴閾值+': 'enrageThreshold', '詞條上限率%': 'affixCap', '寶石鑲嵌效率%': 'gemEff'
  };
  Object.keys(index['表-戰力權重'] || {}).forEach(nm => {
    const key = wKeyByName[nm];
    if (!key) return;
    edits.push({ file: 'formula', re: new RegExp('\\b' + esc(key) + ':\\s*(-?[\\d.]+)(?=[,\\s}])'), grp: 1, value: P('表-戰力權重', nm, 0), label: '權重-' + nm, scopeVar: 'SCORE_WEIGHTS' });
  });
}

/* ---- formula.js 內嵌係數（唯一片段） ---- */
// 升級經驗 (30 * l^2 + 40)
inline('formula', 'Math.floor((', P('1-成長經驗', '升級所需經驗', 0), 'xp-a=30');
inline('formula', ' * Math.pow(l, ', P('1-成長經驗', '升級所需經驗', 1), 'xp-b（次方）');
// xp-c（常數）：錨點不綁定次方值（次方＝xp-b 可被調整），以 Math.pow(l, <任意>) + 為前綴。
edits.push({ file: 'formula', re: /(Math\.pow\(l, -?[\d.]+\) \+ )(-?[\d.]+)/, grp: 2, value: P('1-成長經驗', '升級所需經驗', 2), label: 'xp-c（常數）' });
// 基礎四維 5 + (level - 1) * 2
inline('formula', 'var v = ', P('1-成長經驗', '等級基礎四維', 0), '四維-a=5');
inline('formula', 'var v = 5 + (level - 1) * ', P('1-成長經驗', '等級基礎四維', 1), '四維-b=2');
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
inline('formula', 'st.base.hp = ', P('2-屬性派生', '生命上限', 0), 'hp基底');
inline('formula', 'st.base.hp = 120 + (lv - 1) * ', P('2-屬性派生', '生命上限', 1), 'hp每級');
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
scalar('formula', 'PHYSICAL_RESISTANCE_EXPONENT', '3-戰鬥核心', '物理抗性減傷', 0);
scalar('formula', 'PHYSICAL_RESISTANCE_BASE', '3-戰鬥核心', '物理抗性減傷', 1);
scalar('formula', 'PHYSICAL_RESISTANCE_LEVEL_COEF', '3-戰鬥核心', '物理抗性減傷', 2);
scalar('formula', 'MAGIC_RESISTANCE_EXPONENT', '3-戰鬥核心', '魔法抗性減傷', 0);
scalar('formula', 'MAGIC_RESISTANCE_BASE', '3-戰鬥核心', '魔法抗性減傷', 1);
scalar('formula', 'MAGIC_RESISTANCE_LEVEL_COEF', '3-戰鬥核心', '魔法抗性減傷', 2);
scalar('formula', 'ELEMENTAL_RESISTANCE_EXPONENT', '3-戰鬥核心', '六系元素抗性減傷', 0);
scalar('formula', 'ELEMENTAL_RESISTANCE_BASE', '3-戰鬥核心', '六系元素抗性減傷', 1);
scalar('formula', 'ELEMENTAL_RESISTANCE_LEVEL_COEF', '3-戰鬥核心', '六系元素抗性減傷', 2);
inline('formula', 'return def / (def + ', P('3-戰鬥核心', '防禦減傷率', 0), '防減-常數');
inline('formula', 'return def / (def + 60 + ', P('3-戰鬥核心', '防禦減傷率', 1), '防減-每級');
// 敵種傷害抗性（普通敵人/普通菁英/普通BOSS）：a/b；表列缺席時跳過（相容尚未含此列的舊參數表）
if (index['3-戰鬥核心'] && index['3-戰鬥核心']['敵種傷害抗性']) {
  scalar('formula', 'ENEMY_TYPE_DMG_RED_A', '3-戰鬥核心', '敵種傷害抗性', 0);
  scalar('formula', 'ENEMY_TYPE_DMG_RED_B', '3-戰鬥核心', '敵種傷害抗性', 1);
}
inline('formula', 'dmg *= rnd(', P('3-戰鬥核心', '傷害浮動', 0), '浮動-下');
inline('formula', 'dmg *= rnd(0.9, ', P('3-戰鬥核心', '傷害浮動', 1), '浮動-上');
numCtx('formula', 'dmg = Math.max(', ', Math.round(dmg))', P('3-戰鬥核心', '最低傷害下限', 0), '最低傷害');
inline('formula', "ek === 'ice' && chance(", P('3-元素特效', '冰霜 特效', 0), '元素-冰');
inline('formula', "ek === 'lightning' && chance(", P('3-元素特效', '雷電 特效', 0), '元素-雷');
inline('formula', "ek === 'poison' && chance(", P('3-元素特效', '劇毒 特效', 0), '元素-毒');
inline('formula', "ek === 'light' && chance(", P('3-元素特效', '聖光 特效', 0), '元素-光');
numCtx('formula', 'clamp(dCfg.dmgRed, 0, ', ')', P('3-戰鬥核心', '聖佑(神鑄)減傷上限', 0), '聖佑上限');
inline('formula', 'GT - defender._undyingAt >= ', P('3-戰鬥核心', '不朽(神鑄)回復', 1), '不朽秒數');

/* ---- §4 高塔 BOSS ---- */
numCtx('formula', 'return Math.round(', ' * Math.pow(Math.max(1, Number(floor)', P('4-高塔BOSS', '挑戰金幣消耗', 0), 'boss金幣係數');
numCtx('formula', 'Number(floor) || 1), ', '))', P('4-高塔BOSS', '挑戰金幣消耗', 1), 'boss金幣指數');

/* ---- §5 稀有度擲骰（rollRarity） ---- */
inline('formula', 'effectiveDropRateEffect(lootBonus || 0) / ', P('5-稀有度擲骰', '權重加成 b', 0), '權重加成除數');
inline('formula', ' + s * ', P('5-稀有度擲骰', '權重加成 b', 1), '權重加成每階');
numCtx('formula', '[0, ', ']', P('5-稀有度擲骰', '普通 權重', 0), '權重-普通');
numCtx('formula', '[1, ', ' * Math.min', P('5-稀有度擲骰', '精良 權重', 0), '權重-精良');
numCtx('formula', '[1, 25 * Math.min(b, ', ')', P('5-稀有度擲骰', '精良 權重', 2), '上限-精良');
numCtx('formula', '[2, ', ' * Math.min', P('5-稀有度擲骰', '稀有 權重', 0), '權重-稀有');
numCtx('formula', '[2, 12 * Math.min(b, ', ')', P('5-稀有度擲骰', '稀有 權重', 2), '上限-稀有');
numCtx('formula', '[3, ', ' * Math.min', P('5-稀有度擲骰', '獨特 權重', 0), '權重-獨特');
numCtx('formula', '[3, 5.5 * Math.min(b, ', ')', P('5-稀有度擲骰', '獨特 權重', 2), '上限-獨特');
numCtx('formula', '(s >= 8 ? ', ' : 0)', P('5-稀有度擲骰', '史詩 權重', 0), '權重-史詩');
numCtx('formula', '1.8 : 0) * Math.min(b, ', ')', P('5-稀有度擲骰', '史詩 權重', 2), '上限-史詩');
numCtx('formula', '(s >= 15 ? ', ' : 0)', P('5-稀有度擲骰', '傳說 權重', 0), '權重-傳說');
numCtx('formula', '0.35 : 0) * Math.min(b, ', ')', P('5-稀有度擲骰', '傳說 權重', 2), '上限-傳說');
numCtx('formula', '(s >= 25 ? ', ' : 0)', P('5-稀有度擲骰', '神話 權重', 0), '權重-神話');
numCtx('formula', '0.08 : 0) * Math.min(b, ', ')', P('5-稀有度擲骰', '神話 權重', 2), '上限-神話');
numCtx('formula', '(s >= 40 ? ', ' : 0)', P('5-稀有度擲骰', '創世 權重', 0), '權重-創世');
numCtx('formula', '0.015 : 0) * Math.min(b, ', ')', P('5-稀有度擲骰', '創世 權重', 2), '上限-創世');

/* ---- §6 裝備 ---- */
numCtx('formula', 'return 1 + ', ' * (item.upgrade', P('6-裝備', '強化倍率', 0), '強化倍率');
// 附魔攻擊類：v = (base + item.level * per)。base 與 per 互不硬編（任一被調整，另一錨點也不會失配）；
// 以「+ item.level *」限定只中 §6 附魔攻那行，不誤中同檔另一處 `var v = (def.base + ...`。
edits.push({ file: 'formula', re: /(var v = \()([\d.]+)( \+ item\.level \* [\d.]+)/, grp: 2, value: P('6-裝備', '附魔-攻擊類', 0), label: '附魔攻-基' });
edits.push({ file: 'formula', re: /(var v = \([\d.]+ \+ item\.level \* )([\d.]+)/, grp: 2, value: P('6-裝備', '附魔-攻擊類', 1), label: '附魔攻-每級' });
numCtx('formula', '(1 + ', ' * (gemLevel || 0))', P('6-裝備', '附魔-攻擊類', 2), '附魔攻-每寶石');
numCtx('formula', 'Math.round((', ' + item.rarity * 4', P('6-裝備', '附魔-防禦/功能類', 0), '附魔防-基');
inline('formula', ' + item.rarity * ', P('6-裝備', '附魔-防禦/功能類', 1), '附魔防-每階');
inline('formula', '(gemLevel || 0) * ', P('6-裝備', '附魔-防禦/功能類', 2), '附魔防-每寶石');
inline('formula', 'Math.min(val, ', P('6-裝備', '附魔-防禦/功能類', 3), '附魔防-上限');
numCtx('formula', 'Math.round((', ' + it.level * 0.6)', P('6-裝備', '分解-碎片', 0), '分解碎-基');
inline('formula', 'Math.round((2 + it.level * ', P('6-裝備', '分解-碎片', 1), '分解碎-每級');
numCtx('formula', 'Math.round((', ' + it.level) * r.salv', P('6-裝備', '分解-金幣', 0), '分解金-基');
inline('formula', ' + it.level) * r.salv * ', P('6-裝備', '分解-金幣', 1), '分解金-係數');

/* ---- §7 強化 / 洗煉 ---- */
numCtx('formula', 'return Math.max(', ', 100 - (nextLevel - 5)', P('7-強化', '基礎成功率', 0), '強化率下限');
inline('formula', '100 - (nextLevel - 5) * ', P('7-強化', '基礎成功率', 1), '強化率遞減');
numCtx('formula', 'gold: Math.round(', ' * Math.pow(1.45', P('7-強化', '金幣費用', 0), '強化金-係數');
inline('formula', 'Math.round(25 * Math.pow(', P('7-強化', '金幣費用', 1), '強化金-底');
numCtx('formula', 'Math.pow(1.45, lv) * (1 + it.level * ', '))', P('7-強化', '金幣費用', 2), '強化金-每級');
numCtx('formula', 'scrap: Math.round(', ' * Math.pow(1.35', P('7-強化', '碎片費用', 0), '強化碎-係數');
inline('formula', 'Math.round(8 * Math.pow(', P('7-強化', '碎片費用', 1), '強化碎-底');
numCtx('formula', 'Math.pow(1.35, lv) * (1 + it.level * ', '))', P('7-強化', '碎片費用', 2), '強化碎-每級');
numCtx('formula', 'gold: Math.round(', ' * Math.pow(1.7', P('7-洗煉', '金幣費用', 0), '洗煉金-係數');
inline('formula', 'Math.round(40 * Math.pow(', P('7-洗煉', '金幣費用', 1), '洗煉金-底');
numCtx('formula', 'Math.pow(1.7, it.rarity) * (1 + it.level * ', '))', P('7-洗煉', '金幣費用', 2), '洗煉金-每級');

/* ---- §8 寶石 ---- */
inline('formula', 'g.base * level * (1 + ', P('8-寶石', '能力數值(1~5階)', 0), '寶石係數a');
inline('formula', 'g.base * GEM_MAX_LEVEL * (1 + ', P('8-寶石', '能力數值(1~5階)', 0), '寶石係數b');
inline('formula', 'base5 * Math.pow(', P('8-寶石', '能力數值(6~10階神鑄)', 0), '寶石神鑄底');
numCtx('formula', 'return ', ' + (level - GEM_MAX_LEVEL)', P('6-神鑄', '寶石神鑄金幣', 0), '寶石神鑄金-基');
inline('formula', '(level - GEM_MAX_LEVEL) * ', P('6-神鑄', '寶石神鑄金幣', 0), '寶石神鑄金-每階');
numCtx('formula', 'return ', ' + Math.pow(level, 3)', P('8-寶石商店', '升級費用', 0), '寶店升級-基');
inline('formula', 'Math.pow(level, ', P('8-寶石商店', '升級費用', 1), '寶店升級-次方');
inline('formula', 'Math.pow(level, 3) * ', P('8-寶石商店', '升級費用', 2), '寶店升級-係數');

/* ---- §9 技能 ---- */
numCtx('formula', 'Math.floor(', ' * lv + Math.pow(20', P('9-技能', '升級費用', 0), '技升-係數');
inline('formula', ' + Math.pow(', P('9-技能', '升級費用', 1), '技升-底');
inline('formula', '1 + lv / ', P('9-技能', '升級費用', 2), '技升-除數');
inline('formula', 'skillBaseManaCost(def) * (1 + ', P('9-技能', '一般技能法力消耗', 0), '法力每級');
inline('formula', '2 + Math.floor(G.player.level / ', P('1-成長經驗', '技能裝載欄', 0), '裝載欄-每級');
numCtx('formula', 'Math.max(', ', 2 + Math.floor(G.player.level', P('1-成長經驗', '技能裝載欄', 1), '裝載欄-下限');
numCtx('formula', 'Math.max(2, ', ' + Math.floor(G.player.level', P('1-成長經驗', '技能裝載欄', 1), '裝載欄-初始');
numCtx('formula', 'return Math.min(', ', Math.max(2', P('1-成長經驗', '技能裝載欄', 2), '裝載欄-上限');

/* ---- Batch2a：補接 formula.js 內漏接的可調單值（多值行用正規式避免相依錨點失配） ---- */
// REINCARNATION_EXP_STEP_MULTS = [1, a..j]（各轉相對上一轉的經驗倍數；索引 0 固定 1）
{
  const g = [];
  for (let i = 0; i < 10; i++) g.push(P('1-成長經驗', '轉生經驗倍率', i));
  arrayContent('data', 'REINCARNATION_EXP_STEP_MULTS', '1, ' + g.join(', '), 'REINCARNATION_EXP_STEP_MULTS');
}
inline('formula', 'FIELD_BOOK_DROP_PCT = ', P('5-野外材料', '附魔書', 0), 'FIELD_BOOK_DROP_PCT');
inline('formula', 'FIELD_PART_DROP_PCT = ', P('5-野外材料', '自動機組零件', 0), 'FIELD_PART_DROP_PCT');
numCtx('formula', 'Math.floor((floor - 1) / ', ')', P('5-高塔獎勵', '零件階級', 0), '高塔-零件階級');
numCtx('formula', 'gold: Math.round(', ' * floor', P('5-高塔獎勵', '金幣', 0), '高塔-金幣');
numCtx('formula', 'Math.floor(floor / ', ')', P('5-高塔獎勵', '寶石', 0), '高塔-寶石');
numCtx('formula', 'essence: ', ' + floor', P('5-高塔獎勵', '附魔精華', 0), '高塔-附魔精華');
edits.push({ file: 'formula', re: /(itemLevel: )([\d.]+)( \+ floor)/, grp: 2, value: P('5-高塔獎勵', '裝備戰利品等級', 0), label: '高塔-裝備等級底' });
edits.push({ file: 'formula', re: /(itemLevel: [\d.]+ \+ floor \* )([\d.]+)/, grp: 2, value: P('5-高塔獎勵', '裝備戰利品等級', 1), label: '高塔-裝備等級係數' });
numCtx('formula', 's *= 1 + ', ' * it.godPassives.length', P('6-裝備', '戰力評分', 0), '戰力-神鑄每條');
numCtx('formula', 's *= 1 + it.rarity * ', ';', P('6-裝備', '戰力評分', 1), '戰力-稀有度');
numCtx('formula', 'return ', ' * n * n', P('7-容量', '背包擴充費用', 0), '背包擴充費用');
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
// 怪物固定戰鬥值（combat.js；玩家設定用 st.xxx 無數字，錨點只中怪物那行）
numCtx('combat', 'critRate: ', ',', P('3-戰鬥核心', '怪物固定戰鬥值', 0), '怪物-暴擊');
numCtx('combat', 'critDmg: ', ',', P('3-戰鬥核心', '怪物固定戰鬥值', 1), '怪物-暴傷');
// 怪物命中 fallback（monsterAtkCfg：hit: m.hit || c；實際命中率由「4-野外怪物/命中率」與「4-高塔BOSS/命中率」的 m.hit 驅動，此處僅為保底預設值）
numCtx('combat', 'hit: m.hit || ', ',', P('3-戰鬥核心', '怪物固定戰鬥值', 2), '怪物-命中');
// 野外菁英掉落倍率（formula.js 常數 ELITE_DROP_MULT；野外 rollFieldDrops 與離線收益共用）
scalar('formula', 'ELITE_DROP_MULT', '4-野外怪物', '野外菁英掉落倍率', 0);
// 寶石商店刷新週期（item.js，單一常數）
scalar('item', 'GEM_SHOP_REFRESH_HOURS', '8-寶石商店', '刷新週期', 0);
// 技能點總預算：a=初始(player.js)、b=每級(player.js)、c=上限(data.js 常數 SKILL_POINT_BUDGET_CAP，skills/save 引用)
numCtx('player', 'skillPointBudget: ', ',', P('1-成長經驗', '技能點總預算', 0), '技能點-初始');
numCtx('player', '(p.skillPointBudget || 0) + ', ';', P('1-成長經驗', '技能點總預算', 1), '技能點-每級');
scalar('data', 'SKILL_POINT_BUDGET_CAP', '1-成長經驗', '技能點總預算', 2);

/* ===========================================================================
   套用引擎
   =========================================================================== */
const srcCache = {};
function src(f) { return srcCache[f] || (srcCache[f] = fs.readFileSync(FILES[f], 'utf8')); }

const results = []; // {label, file, kind, old, new, changed, error}
// scopeVar: 將搜尋限制在某 var 區塊內（例如 SCORE_WEIGHTS）以避免同名欄位在他處誤中
function scopedText(file, scopeVar) {
  const t = src(file);
  if (!scopeVar) return { text: t, offset: 0 };
  const m = new RegExp('\\b' + esc(scopeVar) + '\\s*=\\s*[\\[{][\\s\\S]*?[\\]}];').exec(t);
  if (!m) return { text: t, offset: 0 };
  return { text: m[0], offset: m.index };
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
    const re = new RegExp(e.re.source, 'g');
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

function groupSpan(mm, gi) {
  // 計算群組在整段 match 中的位置（用 match 內搜尋群組字串一次）
  const whole = mm[0];
  const gtext = mm[gi];
  const rel = whole.indexOf(gtext, gi > 1 ? whole.indexOf(mm[gi - 1]) + mm[gi - 1].length : 0);
  return { start: mm.index + rel, end: mm.index + rel + gtext.length };
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
