'use strict';
/* =============================================================================
   build_string_csv.cjs — 掃描 js/*.js 與 index.html，產生 config/CSV/String.csv（字串表）
   -----------------------------------------------------------------------------
   範圍：寫死在程式與 HTML 裡、不在任何配置表（config/CSV 其他表）的玩家可見文字。
   做法：chain.cjs 把 `'第 ' + n + ' 階'` 這類 + 串接合併成一條 `第 {0} 階`，
        非字面值部分以 {N} 代替，原運算式寫進「替代字符參數說明」。
   排除：GM／錄製／延遲探針／VFX 驗證／效能診斷等內部工具；console／Error／比對用字面值；
        資料型檔案(data.js 等)中與配置表儲存格完全相同的字串（已在表內）。
   用法：node tools/string-table/build_string_csv.cjs [輸出路徑] [--force]
         node tools/string-table/build_string_csv.cjs --check     # 漏登記檢查：寫死又沒進 String 表的字串（有就非 0 結束）
   （預設輸出為 config/CSV/String.csv，已存在時需 --force；Excel 是來源，別隨手覆蓋）
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
const { scopeReason } = require('./scope.cjs');
const ex = { file: 0, fn: 0, callee: 0, cmp: 0, csv: 0, noText: 0, regex: 0 };
const kept = [];
for (const r of rows) {
  const why = scopeReason(r);
  if (why) { ex[why]++; continue; }
  if (DATA_FILES.test(r.file) && cells.has(r.text)) { ex.csv++; continue; }
  kept.push(r);
}

const { INLINE_OK, parseMarkup, keepTag, balance, splitMarkup, decodeEnt, attrValue } = require('./markup.cjs');

/* ---------- 類別／用途 ---------- */
/* ---------- 功能模塊 ---------- */
const MODULES = ['通用', '角色', '戰鬥', '技能', '威能', '裝備', '神鑄', '熔爐', '寶石', '符文', '封魔塔', '任務', '存檔與系統'];
const KEYWORDS = [
  [/符文/, '符文'], [/寶石|融合石|共鳴/, '寶石'], [/封魔塔|試煉之塔|地獄之塔|煉獄之塔|塔層|連挑/, '封魔塔'],
  [/熔爐|傳送帶|零件|輸送帶/, '熔爐'], [/神鑄|鑄造|魔塵/, '神鑄'], [/威能|天賦/, '威能'], [/任務/, '任務'],
  [/技能|施放|冷卻|熟練度|終極進化/, '技能'], [/存檔|資料夾|分頁|Worker|離線|瀏覽器|匯出|安全模式/, '存檔與系統'],
  [/裝備|背包|品質|詞條|套裝|穿戴|附魔|拆解|分解/, '裝備'], [/戰鬥|擊敗|傷害|敵人|BOSS|關卡|地圖|撤退|暴擊|爆擊/, '戰鬥'],
  [/屬性|轉生|等級|經驗|生命|法力/, '角色'],
];
const FN_RULES = [
  [/^nf[A-Z]|NewForge|newForge|Furnace|furnace|Belt|closeNfDetailLog/, '熔爐'],
  [/Forge|forge/, '神鑄'],
  [/Gem|gem|gres|Gres/, '寶石'], [/rune|Rune/, '符文'], [/[tT]ower/, '封魔塔'],
  [/sg[A-Z]|sgb|Skill|skill|MpSkill|SGB_/, '技能'], [/[tT]alent/, '威能'], [/[qQ]uest/, '任務'],
  [/[sS]ave|Folder|Worker|worker|Pip|MiniWindow|MINI_HTML|Fullscreen|[oO]ffline|[pP]erf|Damage(Toggle|Numbers)|Stall|Diag|resetStats/, '存檔與系統'],
  [/CharCore|CHAR_CORE|AttrPanel|DmgAbsorb|CombatRating|REINCARNATION|REALMS|STAT_GROUPS|primaryStat|statDesc|statFmt|capText|ReductionDesc|penetrationDesc|elementResistDesc|drainDesc|joinEffectParts|enemyTypeDmgRedDesc/, '角色'],
  [/updateResourceTip|ELEM_INFO|formatDuration|showConfirmDialog/, '通用'],
  [/[eE]quip|Inventory|inventory|sortInventory|renderDetail|salvage|AFFIX_POOL|PASSIVE_POOL|RARIT|SLOT_|WEAPON_|ENCHANT|enchant|twoHand|ancientStar|itemDetail|itemHeader|itemSocket|itemRune|rerollSingle|rerollResource|GODFORGE|EQUIP_SET|passiveLine/, '裝備'],
  [/[zZ]one|ZONES|[sS]tage|[bB]attle|[eE]nemy|[sS]ummary|classifyUiLogCategory|detailLog|DetailLog|Frenzy|floatText|HitRate|npc|CombatPause|BOSS_LIST|_POOL$/, '戰鬥'],
  [/TASKS/, '任務'], [/TALENT/, '威能'], [/GEM_|PART_TYPES|NEW_FORGE/, '熔爐'],
];
function moduleOf(file, ctx, key, text, line) {
  const base = file.replace(/^js\//, '');
  if (file === 'index.html') {
    const L = line;
    if (L < 102) return '通用'; if (L < 123) return '角色'; if (L < 248) return '裝備'; if (L < 285) return '熔爐';
    if (L < 340) return '神鑄'; if (L < 462) return '寶石'; if (L < 492) return '符文'; if (L < 508) return '技能';
    if (L < 512) return '威能'; if (L < 579) return '封魔塔'; if (L < 719) return '戰鬥'; if (L < 735) return '熔爐'; if (L < 750) return '存檔與系統';
    if (L < 842) return '存檔與系統'; if (L < 865) return '戰鬥'; if (L < 879) return '任務'; if (L < 891) return '通用';
    if (L < 915) return '封魔塔'; if (L < 932) return '熔爐'; return '裝備';
  }
  if (/^(ui-gem-resonance|ui-gem-workshop|gem_resonance|gem_resonance_data)\.js$/.test(base)) return '寶石';
  if (/^(ui-runeword|runeword|runeword_data)\.js$/.test(base)) return '符文';
  if (/^(tablock|save_origin|save|bridge|storage|param_autoreload|game-menu|main)\.js$/.test(base)) return '存檔與系統';
  if (base === 'tasks.js') return '任務';
  if (base === 'talents.js') return '威能';
  if (/^(skills|skills2|status)\.js$/.test(base)) return '技能';
  if (base === 'tower.js') return '封魔塔';
  if (/^(newforge|ui-newforge-visuals)\.js$/.test(base)) return '熔爐';
  if (base === 'forge.js') return '神鑄';
  if (/^(factory|legendary)\.js$/.test(base)) return '裝備';
  if (/^(combat|elite|elite_boss|elite_boss_recipes|battle-arena|battle-renderer|battlefield|special_rules|formula)\.js$/.test(base)) return '戰鬥';
  if (base === 'stats.js') return '角色';
  if (base === 'player.js') return /EQUIP/.test(ctx) ? '裝備' : '角色';
  if (base === 'item.js') {
    if (/Gem|gem|socketGem|convertGems|composeGems/.test(ctx)) return '寶石';
    if (/Rune/.test(ctx)) return '符文';
    return '裝備';
  }
  // ui.js、data.js、sim.worker.js 等混雜檔：UI_COMMAND_LABELS 看 key，其餘看函式／常數名，最後看字面關鍵字
  if (/UI_COMMAND_LABELS/.test(ctx) && key) {
    const k = key.toLowerCase();
    if (/^forge/.test(k)) return '神鑄'; if (/^gem/.test(k)) return '寶石'; if (/^rune/.test(k)) return '符文';
    if (/^tower/.test(k)) return '封魔塔'; if (/^skill/.test(k)) return '技能'; if (/^talent/.test(k)) return '威能';
    if (/^(nf|newforge|furnace)/.test(k)) return '熔爐'; if (/^(equip|item|inventory|enchant|affix)/.test(k)) return '裝備';
    if (/^(quest|task)/.test(k)) return '任務';
  }
  if (!/^(handlePauseClick|initUI|syncFullscreenButton|unlocked|fill|finish|stat|bar|COMMAND_IMPL|boot|onSaveResult|doSend|count|sendUiCommand|runCommand|loadIntoRunningSim|resolveItem|NODE_NAMES|capText)$/.test(ctx)) {
    for (const [re, m] of FN_RULES) if (re.test(ctx)) return m;
  }
  for (const [re, m] of KEYWORDS) if (re.test(text)) return m;
  return '通用';
}

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
function add(text, params, cat, where, kind, mod) {
  const vis = text.replace(/\{\w+\}/g, '').replace(/<[^>]*>/g, '');
  if (!IDEO.test(vis)) return;
  const ren = renumber(text, params);
  const key = ren.text;
  let e = entries.get(key);
  if (!e) { e = { text: ren.text, params: ren.params, cat, kinds: new Set(), where: [], mods: new Map() }; entries.set(key, e); }
  e.kinds.add(kind);
  e.mods.set(mod, (e.mods.get(mod) || 0) + 1);
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
    add(p, r.params, cat, where, kindOf(r, p), moduleOf(r.file, ctxName, r.key, p, r.line));
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
    if (t && IDEO.test(t)) for (const x of splitMarkup(t, true)) add(x, [], '主界面', `index.html:${bufLine}`, '界面文字', moduleOf('index.html', '', '', x, bufLine));
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
      while ((a = re.exec(' ' + attrs))) if (IDEO.test(a[2])) { const x = attrValue(a[2]); add(x, [], '主界面', `index.html:${line}`, '提示', moduleOf('index.html', '', '', x, line)); }
    }
    const fmtTag = /^(b|i|u|em|strong|small|code|br)$/i.test(tag);
    let inline = fmtTag && !/\sid=/.test(attrs);
    // 帶 id 的格式標籤（動態數字）不算內嵌，它的結尾標籤也要當斷點，否則 "0</b> 件" 會黏成一條
    if (fmtTag && !close && /\sid=/.test(attrs)) idStack.push(tag.toLowerCase());
    else if (fmtTag && close && idStack.length && idStack[idStack.length - 1] === tag.toLowerCase()) { idStack.pop(); inline = false; }
    if (inline) { buf += `<${close ? '/' : ''}${tag}>`; }
    else flush();
    line += nl;
  }
  flush();
}

/* ---------- 排序＆輸出 ---------- */
const list = [...entries.values()];
for (const e of list) e.module = e.mods.size === 1 ? [...e.mods.keys()][0] : '通用'; // 跨模塊共用的詞歸通用
list.sort((a, b) => {
  const c = MODULES.indexOf(a.module) - MODULES.indexOf(b.module);
  if (c) return c;
  const fa = a.where[0].split(':')[0], fb = b.where[0].split(':')[0];
  if (fa !== fb) return fa < fb ? -1 : 1;
  return parseInt(a.where[0].split(':')[1]) - parseInt(b.where[0].split(':')[1]);
});
function csvCell(v) { v = String(v ?? ''); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
const header = ['編號', '功能模塊', '用途說明', '替代字符參數說明', '繁體中文', '簡體中文', '英文'];
const lines = [header.map(csvCell).join(',')];
list.forEach((e, i) => {
  const kinds = [...e.kinds].join('/');
  const locs = e.where.slice(0, 3).join('、') + (e.where.length > 3 ? `…等${e.where.length}處` : '');
  const use = `${kinds}｜${locs}`;
  lines.push([i + 1, e.module, use, describeRepl(e.text, e.params), e.text.replace(/\r?\n/g, '\\n'), '', ''].map(csvCell).join(','));
});
/* --check：漏登記檢查（AI_RULES 8.10）。只看程式裡「仍寫死」的字串：
   已登記＝表裡有這句，只是程式還沒改成 STR()（待遷移）；未登記＝新寫死又沒進表，視為違規，以非 0 結束。 */
if (process.argv.includes('--check')) {
  const { csvParse } = require('./apply_strings.cjs');
  const trows = csvParse(fs.readFileSync(path.join(root, 'config', 'CSV', 'String.csv'), 'utf8'));
  const twCol = trows[0].indexOf('繁體中文');
  const registered = new Set(trows.slice(1).map(r => (r[twCol] || '').replace(/\n/g, '\n')));
  const unreg = list.filter(e => !registered.has(e.text.replace(/\r?\n/g, '\n')));
  const migrate = list.length - unreg.length;
  console.log(`程式中仍寫死的顯示文字：${list.length} 條（已登記待遷移 ${migrate}、未登記 ${unreg.length}）`);
  const byMod2 = {};
  for (const e of list) { const m = byMod2[e.module] ||= { pending: 0, unreg: 0 }; if (registered.has(e.text)) m.pending++; else m.unreg++; }
  for (const m of MODULES) if (byMod2[m]) console.log(`  ${m}：待遷移 ${byMod2[m].pending}、未登記 ${byMod2[m].unreg}`);
  const listMod = process.argv.includes('--module') ? process.argv[process.argv.indexOf('--module') + 1] : null;
  if (listMod) {
    console.log('\n[' + listMod + '] 仍寫死的字串：');
    list.filter(e => e.module === listMod).forEach(e => console.log('  ' + e.text.slice(0, 90).split('\n').join('\\n') + '  ←  ' + e.where.slice(0, 3).join('、')));
  }
  if (unreg.length) {
    console.error('\n以下字串寫死在程式裡且沒有登記在 String 表（AI_RULES 8.10）：');
    unreg.slice(0, 40).forEach(e => console.error(`  [${e.module}] ${e.text.slice(0, 60)}  ←  ${e.where[0]}`));
    process.exit(3);
  }
  process.exit(0);
}
const outPath = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(root, 'config', 'CSV', 'String.csv');
if (!process.argv.includes('--force') && !process.argv.slice(2).some(a => !a.startsWith('--')) && fs.existsSync(outPath)) {
  console.error('config/CSV/String.csv 已存在；Excel（config/Excel/String.xlsx）才是來源，重新產生會洗掉翻譯。\n要輸出到別處請帶路徑，確定要覆蓋請加 --force。');
  process.exit(1);
}
fs.writeFileSync(outPath, '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
console.log('excluded', ex, 'kept', kept.length, 'entries', list.length);
const byMod = {}; list.forEach(e => byMod[e.module] = (byMod[e.module] || 0) + 1); console.log(byMod);
