'use strict';
/* ============================================================
   shrink-sheets.cjs — 把序列幀圖集降到合理的格子尺寸

   為什麼需要這一步：PNG 是壓縮格式，上了 GPU 就是未壓縮的 RGBA。
   一張 3102×2585 的圖集在硬碟上是 2.7 MB，在 VRAM 裡是 **32 MB**。
   22 個特效全部常駐是 362 MB——目前整套 VFX 素材才 85 MB。

   而每格 517px 的解析度也用不到：這些特效在遊戲裡最多播到 300px
   （範圍技能的直徑 120～800px，受擊只有 60～96px）。格子降到 256px
   之後 VRAM 掉到八分之一，畫面上看不出差別。

   ------------------------------------------------------------
   設計決定

   1. 產生**衍生素材**，不就地覆蓋原檔。
      原始高解析度留在素材庫裡（那是母帶），衍生檔另存成一個 package
      （`<來源>-<格子尺寸>`）。preset 引用衍生檔，匯出照抄，不必在匯出路徑
      裡塞轉檔邏輯——那會讓「repo 裡的檔案」與「素材庫裡的檔案」不再是同一張圖，
      日後對不上時極難查。

   2. **逐格重取樣**，不是整張一起縮。
      一開始寫成「整張圖乘上一個整數倍率」，結果 517、305 這種格尺寸幾乎只能
      被 1 整除，全部被判成「已經夠小」而原封不動。改成每一格獨立縮到目標尺寸：
      比例可以是任意值，而且格與格之間絕不互相取樣——整張一起縮時，落在格線上
      的目標像素會同時吃到兩格的內容，畫面上是每一格邊緣都帶著隔壁格的一條線。

   3. 縮放前先**預乘 alpha**。
      透明像素的 RGB 通常是黑的（甚至是垃圾值）。直接平均 RGB 會把黑色混進
      邊緣，結果是所有半透明邊緣都變暗一圈——那正是「縮圖之後特效邊緣有黑框」
      的成因。預乘之後再平均、最後還原，邊緣才乾淨。

   4. 用 box filter（區塊平均）而不是取樣。
      降解析時區塊平均就是正解：每個目標像素涵蓋 k×k 個來源像素，全部算進去。
      取樣（最近鄰／雙線性）會丟掉大部分來源像素，細節變成雜訊。

   用法：
     node tools/vfx/shrink-sheets.cjs                     全部縮到 256px 格
     node tools/vfx/shrink-sheets.cjs --cell 128          指定格子尺寸
     node tools/vfx/shrink-sheets.cjs --package <name>    只處理某個 package
     node tools/vfx/shrink-sheets.cjs --dry               只報告，不寫檔
   ============================================================ */

const fs = require('fs');
const path = require('path');
const libraryRoot = require('./vfx-library-root.cjs');
const raster = require('./vfx-raster.cjs');

/* 解碼／重取樣／編碼在 vfx-raster.cjs——contact-sheet 與 sheet-facts 也用同一份。 */
const { decodePng, pngSize, encodePng, resampleCell, targetCell } = raster;

/* 檔名把每格尺寸寫在後面：`Effect_X_1_517x517.png`。縮完要跟著改，
   否則 preset 端算格線時會用錯的格尺寸去除。 */
const NAME_RE = raster.CELL_IN_NAME;

function run(opts) {
  const resolved = libraryRoot.resolveLibraryRoot({ root: opts.root });
  const root = resolved.root;
  const target = opts.cell;
  const srcPkg = opts.package;
  const srcDir = path.join(root, srcPkg);
  if (!fs.existsSync(srcDir)) throw new Error('找不到 package：' + srcDir);
  const outPkg = srcPkg + '-' + target;
  const outRoot = path.join(root, outPkg);

  const jobs = [];
  (function walk(rel) {
    const dir = path.join(srcDir, rel);
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) return walk(r);
      if (!/\.png$/i.test(e.name)) return;
      jobs.push(r);
    });
  })('');

  let savedVram = 0, newVram = 0, oldBytes = 0, newBytes = 0, skipped = 0;
  jobs.forEach(function (rel) {
    const srcPath = path.join(srcDir, rel);
    const m = NAME_RE.exec(path.basename(rel));
    if (!m) { console.warn('  略過（檔名沒有格尺寸）：' + rel); skipped++; return; }
    const cellW = +m[2], cellH = +m[3];
    const buf = fs.readFileSync(srcPath);
    const size = pngSize(buf);
    oldBytes += buf.length;
    const oldV = size.width * size.height * 4;
    const cols = size.width / cellW, rows = size.height / cellH;
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
      console.warn('  略過（' + size.width + 'x' + size.height + ' 除不盡格 ' +
        cellW + 'x' + cellH + '）：' + rel);
      skipped++; newVram += oldV; newBytes += buf.length;
      writeOut(outRoot, rel, buf, opts.dry);
      return;
    }
    const tc = targetCell(cellW, cellH, target);
    if (!tc) {
      console.log('  ' + rel + ' 已經夠小（格 ' + cellW + 'x' + cellH + '），照抄');
      newVram += oldV; newBytes += buf.length;
      writeOut(outRoot, rel, buf, opts.dry);
      return;
    }
    const rgba = decodePng(buf).rgba;
    const dw = cols * tc.w, dh = rows * tc.h;
    const dst = new Uint8Array(dw * dh * 4);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        resampleCell(rgba, size.width * 4, c * cellW, r * cellH, cellW, cellH,
          tc.w, tc.h, dst, dw * 4, c * tc.w, r * tc.h);
      }
    }
    const outName = (path.dirname(rel) === '.' ? '' : path.dirname(rel) + '/') +
      m[1] + '_' + tc.w + 'x' + tc.h + '.png';
    const png = encodePng(dst, dw, dh);
    writeOut(outRoot, outName, png, opts.dry);
    const nv = dw * dh * 4;
    newVram += nv; savedVram += oldV - nv; newBytes += png.length;
    console.log('  ' + rel.padEnd(46) + ' 格 ' + cellW + 'x' + cellH + ' → ' + tc.w + 'x' + tc.h +
      '   VRAM ' + (oldV / 1048576).toFixed(1) + ' → ' + (nv / 1048576).toFixed(1) + ' MB');
  });

  console.log('');
  console.log('來源 package : ' + srcPkg + '（' + jobs.length + ' 張' + (skipped ? '，略過 ' + skipped : '') + '）');
  console.log('輸出 package : ' + outPkg + (opts.dry ? '（--dry，未寫檔）' : ''));
  console.log('硬碟         : ' + (oldBytes / 1048576).toFixed(1) + ' → ' + (newBytes / 1048576).toFixed(1) + ' MB');
  console.log('全部常駐VRAM : ' + ((newVram + savedVram) / 1048576).toFixed(0) + ' → ' + (newVram / 1048576).toFixed(0) + ' MB');
  console.log('');
  console.log('⚠️ 記得重跑 asset-scanner，衍生素材才會進索引。');
}

function writeOut(outRoot, rel, buf, dry) {
  if (dry) return;
  const p = path.join(outRoot, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (name, def) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
  };
  try {
    run({
      root: arg('root', null),
      package: arg('package', 'spritemancer-vfx'),
      cell: Number(arg('cell', 256)),
      dry: argv.includes('--dry')
    });
  } catch (e) {
    console.error('失敗：' + e.message);
    process.exit(2);
  }
}

module.exports = { encodePng: encodePng, resampleCell: resampleCell, targetCell: targetCell, run: run };
