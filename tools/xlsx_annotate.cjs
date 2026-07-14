'use strict';
/* =============================================================================
   xlsx_annotate.cjs — 為 game_parameters.xlsx 指定列的「中文說明」附加註記。
   本檔的 xlsx 為雙表結構：計算表(sheet2)＝資料源(共享字串)，game_parameters(sheet1)
   ＝以 =計算表!Fn 公式鏡像並快取結果。故：
     ① 改「計算表」F 格的共享字串索引（真正資料源）；
     ② 同步「game_parameters」F 格公式的快取 <v>（讓 xlsx_to_csv 與未重算時也正確）。
   純 Node，store(不壓縮) 重建 ZIP。呼叫端請先備份原檔。
   ============================================================================= */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const XLSX = process.env.PARAMS_XLSX || path.join(ROOT, 'config', 'Excel', 'game_parameters.xlsx');
const OUT = process.env.PARAMS_XLSX_OUT || XLSX;

const NOTES = {
  '2-屬性上限||全局減傷 上限': '此列與「2-屬性派生/全局減傷」重複，實際上限由該列控制，本列不生效。',
  '6-裝備||太古詞條數值': '實際由「5-太古詞條/太古詞條數值倍率」控制，本列不生效。',
  '7-分解速度||分解處理速度': '＝生產線處理間隔，由「7-容量/生產線處理間隔」控制，本列不生效。',
  '8-寶石||寶石拆解(融合)': '與「寶石拆解(一般)」共用保留率，本列不生效。',
  '9-融合||融合技能法力消耗': '與「9-技能/一般技能法力消耗」共用公式，本列不生效。',
  '3-元素特效||暗影 特效': '寫死：100%觸發、汲取元素傷害25%回復生命，無獨立可調參數。',
  '5-掉落通則||掉落件數規則(>100%)': '規則寫死：機率整數部分必掉，餘數再擲一次。',
  '7-強化||失敗懲罰': '寫死：失敗消耗半數費用。',
  '8-寶石||寶石融合數值': '結構寫死：同屬性 rnd(小,大×2)、異屬性 原值×rnd(0.5,1.5)。',
  '9-技能||多敵人技能傷害': '規則寫死：原始傷害×(1+範圍傷害%)÷目標數。',
  '9-技能||實際冷卻': '規則寫死：技能CD×(1-冷卻縮減%)。',
  '9-技能||等級上限': '寫死：一般 20+轉生×10、被動 30+轉生×10、融合 素材加總+轉生×20。',
  '9-融合||DoT/控場/增益合併': '結構寫死：DoT×0.7、控場×0.8、增益×0.8，增益/減益各最多2種。',
  '3-戰鬥核心||護盾上限(技能給予)': '寫死：技能直接給予的護盾上限＝最大生命 50%(skills.js)。',
  '7-合成||品質合成': '合成功能已停用(SYNTHESIS_ENABLED=false)，本列未生效。',
  '7-合成||混合合成': '合成功能已停用，本列未生效。',
  '7-合成||合成變異': '合成功能已停用，本列未生效。',
  '8-寶石||寶石升階(工廠自動)': '合成功能已停用，本列未生效。',
  '表-固定參數||合成節點槽位': '合成功能已停用，本列未生效。',
  '1-轉生對照表||轉生 0 次': '基準列：倍率與經驗基礎增加值固定為0；階級名稱/技能上限由程式陣列控制。',
  '6-裝備||詞條數值': '指標列：base/lv 見「表-詞條池」，稀有度倍率見「表-稀有度」。',
  '6-裝備||特殊被動數值': '指標列：base/perR 見「表-特殊被動」。',
  '6-裝備||神鑄特效數值': '指標列：base 見「表-神鑄特效」。',
  '10-離線||期望暴擊倍率': '衍生估算值，非可調參數(離線收益計算用)。',
  '10-離線||估算 DPS': '衍生估算值，非可調參數(離線收益計算用)。',
  '10-離線||單殺耗時': '衍生估算值，非可調參數(離線收益計算用)。',
  '10-離線||裝備收益': '衍生：離線最多實體化30件裝備，其餘折算碎片(寫死於 save.js)。'
};
const NOTE_SEP = '　※';

function readZip(buf) {
  const entries = []; let i = 0;
  while (i + 4 <= buf.length) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break;
    const method = buf.readUInt16LE(i + 8), compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26), extraLen = buf.readUInt16LE(i + 28);
    const name = buf.toString('utf8', i + 30, i + 30 + nameLen);
    const ds = i + 30 + nameLen + extraLen, raw = buf.slice(ds, ds + compSize);
    entries.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : raw });
    i = ds + compSize;
  }
  return entries;
}
function writeZip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const e of entries) {
    const nb = Buffer.from(e.name, 'utf8'), crc = zlib.crc32(e.data) >>> 0, size = e.data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(size, 18); lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(nb.length, 26);
    locals.push(lh, nb, e.data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(size, 20); cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nb.length, 28); cd.writeUInt32LE(offset, 42);
    centrals.push(cd, nb);
    offset += lh.length + nb.length + e.data.length;
  }
  let cdSize = 0; centrals.forEach(b => cdSize += b.length);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}
function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10))).replace(/&amp;/g, '&');
}
function encodeXml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function colIndex(ref) { const m = /^([A-Z]+)/.exec(ref)[1]; let n = 0; for (const c of m) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; }

function resolveSheets(entries) {
  const wb = entries.find(e => e.name === 'xl/workbook.xml').data.toString('utf8');
  const rels = entries.find(e => e.name === 'xl/_rels/workbook.xml.rels').data.toString('utf8');
  const relMap = {}; rels.replace(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g, (m, id, t) => { relMap[id] = t; return ''; });
  const byName = {};
  wb.replace(/<sheet\b[^>]*\/>/g, tag => {
    const nm = decodeXml((/name="([^"]*)"/.exec(tag) || [])[1] || '');
    const rid = (/r:id="([^"]+)"/.exec(tag) || [])[1];
    if (relMap[rid]) byName[nm] = 'xl/' + relMap[rid].replace(/^\/?xl\//, '');
    return '';
  });
  return byName;
}
// 解析工作表 → { rowNumberByCatName: {'cat||name': N}, fIdxByRow: {N: sharedIdx}, fCachedByRow:{N:text} }
function parseSheet(xml, shared) {
  const rowNum = {}, fIdx = {}, fCache = {};
  xml.replace(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g, (m, rn, inner) => {
    const cells = {};
    inner.replace(/<c\s+r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g, (mm, col, attr, body) => {
      const t = (attr.match(/t="([^"]+)"/) || [])[1] || '';
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      cells[colIndex(col + '1')] = { t, v };
      return '';
    });
    const txt = c => c ? (c.t === 's' ? shared[+c.v] : decodeXml(c.v || '')) : '';
    const cat = txt(cells[2]), name = txt(cells[3]);
    if (cat && name) rowNum[cat + '||' + name] = rn;
    if (cells[5]) { fIdx[rn] = cells[5].t === 's' ? +cells[5].v : null; fCache[rn] = txt(cells[5]); }
    return '';
  });
  return { rowNum, fIdx, fCache };
}

function main() {
  if (!fs.existsSync(XLSX)) { console.error('找不到 xlsx：' + XLSX); process.exit(2); }
  const entries = readZip(fs.readFileSync(XLSX));
  const sheets = resolveSheets(entries);
  const dataPath = sheets['計算表'], viewPath = sheets['game_parameters'];
  if (!dataPath || !viewPath) { console.error('缺少工作表（計算表/game_parameters）'); process.exit(2); }
  const dataE = entries.find(e => e.name === dataPath), viewE = entries.find(e => e.name === viewPath);
  const ssE = entries.find(e => e.name === 'xl/sharedStrings.xml');

  let ssXml = ssE.data.toString('utf8');
  const shared = [];
  ssXml.replace(/<si>([\s\S]*?)<\/si>/g, (m, inner) => { let t = ''; inner.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (a, b) => { t += b; return ''; }); shared.push(decodeXml(t)); return ''; });
  const origCount = shared.length;

  const dataP = parseSheet(dataE.data.toString('utf8'), shared);
  let dataXml = dataE.data.toString('utf8');
  let viewXml = viewE.data.toString('utf8');
  const newStrings = []; let done = 0; const miss = [];

  Object.keys(NOTES).forEach(key => {
    const rn = dataP.rowNum[key];
    if (!rn) { miss.push(key + '(計算表找不到列)'); return; }
    const old = dataP.fCache[rn] || '';
    if (old.indexOf(NOTES[key]) >= 0) { done++; return; }        // 已有註記
    // 空白說明（Excel 填成 "0"）直接以註記為說明；否則附加在原說明後。
    const isEmpty = old === '' || old === '0';
    const newText = isEmpty ? NOTES[key] : (old + NOTE_SEP + NOTES[key]);
    const newIdx = origCount + newStrings.length;

    // ① 計算表 F 格：t="s" → 改索引；數字(空白) → 轉為 t="s" 並指到新字串
    let dataOk = false;
    if (dataP.fIdx[rn] != null) {
      const reS = new RegExp('(<c\\s+r="F' + rn + '"[^>]*t="s"[^>]*>\\s*<v>)\\d+(</v>)');
      if (reS.test(dataXml)) { dataXml = dataXml.replace(reS, '$1' + newIdx + '$2'); dataOk = true; }
    } else {
      const reN = new RegExp('<c\\s+r="F' + rn + '"[^>]*>[\\s\\S]*?</c>');
      if (reN.test(dataXml)) {                         // F 格存在但為數字(空白填0)→ 轉共享字串
        dataXml = dataXml.replace(reN, '<c r="F' + rn + '" t="s"><v>' + newIdx + '</v></c>'); dataOk = true;
      } else {                                          // F 格不存在（空白略過）→ 於該列尾插入（讀取端依 r 定位，順序不拘）
        const reRow = new RegExp('(<row\\s+r="' + rn + '"[^>]*>[\\s\\S]*?)(</row>)');
        if (reRow.test(dataXml)) { dataXml = dataXml.replace(reRow, '$1<c r="F' + rn + '" t="s"><v>' + newIdx + '</v></c>$2'); dataOk = true; }
      }
    }
    if (!dataOk) { miss.push(key + '(計算表 F 格式非預期)'); return; }
    newStrings.push(newText);

    // ② game_parameters F 格：存在則重建為 t="str"（保留樣式與 <f> 公式）；不存在則於列尾插入靜態字串
    const reV = new RegExp('<c\\s+r="F' + rn + '"([^>]*)>(<f[^>]*>[\\s\\S]*?</f>)?<v>[\\s\\S]*?</v></c>');
    if (reV.test(viewXml)) {
      viewXml = viewXml.replace(reV, (m, attrs, f) => {
        const clean = attrs.replace(/\s*t="[^"]*"/, '');
        return '<c r="F' + rn + '"' + clean + ' t="str">' + (f || '') + '<v>' + encodeXml(newText) + '</v></c>';
      });
    } else {
      const reVR = new RegExp('(<row\\s+r="' + rn + '"[^>]*>[\\s\\S]*?)(</row>)');
      if (reVR.test(viewXml)) viewXml = viewXml.replace(reVR, '$1<c r="F' + rn + '" t="str"><v>' + encodeXml(newText) + '</v></c>$2');
    }
    done++;
  });

  if (newStrings.length) {
    const add = newStrings.map(t => '<si><t xml:space="preserve">' + encodeXml(t) + '</t></si>').join('');
    ssXml = ssXml.replace('</sst>', add + '</sst>')
      .replace(/count="\d+"/, 'count="' + (origCount + newStrings.length) + '"')
      .replace(/uniqueCount="\d+"/, 'uniqueCount="' + (origCount + newStrings.length) + '"');
  }
  ssE.data = Buffer.from(ssXml, 'utf8');
  dataE.data = Buffer.from(dataXml, 'utf8');
  viewE.data = Buffer.from(viewXml, 'utf8');
  fs.writeFileSync(OUT, writeZip(entries));
  console.log('[xlsx_annotate] 附加註記 ' + newStrings.length + ' 列（命中 ' + done + '/' + Object.keys(NOTES).length + '）→ ' + path.relative(ROOT, OUT));
  if (miss.length) console.log('  ⚠️ ' + miss.join('；'));
}
main();
