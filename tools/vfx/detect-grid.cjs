'use strict';
/* ============================================================
   detect-grid.cjs — 猜出一張序列幀圖集的格線

   為什麼需要：素材包的圖集通常不會把格線寫進檔名。spritemancer 那批
   剛好有（`..._256x256.png`），所以 vfx-raster.gridOf 直接讀檔名就好；
   其他來源沒有，而「4x4 還是 8x8」用眼睛在縮圖上數是會數錯的
   （尤其動畫尾端有幾格是空的時候）。

   判定方式：**格線上不該有畫**。序列幀的每一格四周都留了邊，所以切對的
   時候，落在格線上的那幾條像素幾乎是全透明的；切錯的話會有筆畫橫跨過去。

   量的是「格線上的平均 alpha ÷ 全圖的平均 alpha」，愈小愈可能是對的。
   用比值而不是絕對值，才能跨圖比較（有的素材整體就比較濃）。

   ⚠️ 第一版量的是「每格內容有沒有置中」，那個訊號太弱：一段填滿畫面的
      動畫在任何格線下看起來都置中，於是 1x1 與 2x2 這種退化解永遠贏。
      「切對的格線上沒有畫」才是這件事真正的特徵。

   只考慮能整除圖片尺寸、長寬比在 3:1 以內的候選。
   一半以上格子是空的就排除：那是切太細。相鄰的候選（4x4 與 2x2，後者的
   格線是前者的子集）分數會很接近，這時取細的——粗的那個是把多格併成一格。

   用法：
     node tools/vfx/detect-grid.cjs <圖檔...> [--max 12]
   ============================================================ */

const fs = require('fs');
const path = require('path');
const raster = require('./vfx-raster.cjs');

const ALPHA_MIN = 8;

/* 一條垂直／水平線上的平均 alpha。 */
function lineAlpha(rgba, W, H, x, vertical) {
  let sum = 0, n = 0;
  if (vertical) {
    for (let y = 0; y < H; y++) { sum += rgba[(y * W + x) * 4 + 3]; n++; }
  } else {
    for (let c = 0; c < W; c++) { sum += rgba[(x * W + c) * 4 + 3]; n++; }
  }
  return sum / n;
}

function meanAlpha(rgba) {
  let sum = 0;
  for (let i = 3; i < rgba.length; i += 4) sum += rgba[i];
  return sum / (rgba.length / 4);
}

/* 候選格線的得分：格線上的墨 ÷ 全圖的墨。愈小愈好。
   同時回報有幾格是空的——尾端空格是序列幀的常態，但滿地空格代表切太細。 */
function score(img, cols, rows, mean) {
  const W = img.width, H = img.height;
  const cw = W / cols, ch = H / rows;
  let seam = 0, n = 0;
  for (let c = 1; c < cols; c++) {
    /* 取格線兩側各一條：只取一條的話，剛好落在留白上會高估。 */
    seam += lineAlpha(img.rgba, W, H, c * cw, true);
    seam += lineAlpha(img.rgba, W, H, c * cw - 1, true);
    n += 2;
  }
  for (let r = 1; r < rows; r++) {
    seam += lineAlpha(img.rgba, W, H, r * ch, false);
    seam += lineAlpha(img.rgba, W, H, r * ch - 1, false);
    n += 2;
  }
  if (!n) return null;                       // 1x1 沒有格線可量，不是候選
  let empty = 0;
  const stride = W * 4;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let any = false;
      for (let y = 0; y < ch && !any; y += 2) {
        for (let x = 0; x < cw; x += 2) {
          if (img.rgba[((r * ch + y) | 0) * stride + ((c * cw + x) | 0) * 4 + 3] >= ALPHA_MIN) { any = true; break; }
        }
      }
      if (!any) empty++;
    }
  }
  return {
    cols: cols, rows: rows, cellW: cw, cellH: ch,
    ratio: (seam / n) / (mean || 1), empty: empty, used: cols * rows - empty
  };
}

function detect(file, maxN) {
  const img = raster.decodePng(fs.readFileSync(file));
  const mean = meanAlpha(img.rgba);
  const cands = [];
  for (let cols = 1; cols <= maxN; cols++) {
    if (img.width % cols) continue;
    for (let rows = 1; rows <= maxN; rows++) {
      if (img.height % rows) continue;
      if (cols === 1 && rows === 1) continue;
      const cw = img.width / cols, ch = img.height / rows;
      /* 格子不必是正方形——直立的火焰、橫向的斬擊都會是長方格
         （Fire01 實際上是 8x4、每格 128x256）。但也不能太扁，
         否則會把整排併成一格。上限 3:1 涵蓋實務上看得到的比例。 */
      const ar = cw / ch;
      if (ar < 1 / 3 || ar > 3) continue;
      if (cw < 24 || ch < 24) continue;
      const s = score(img, cols, rows, mean);
      /* 一半以上是空格＝切太細了。 */
      if (s && s.empty <= (cols * rows) / 2) cands.push(s);
    }
  }
  cands.sort(function (a, b) {
    const d = a.ratio - b.ratio;
    if (Math.abs(d) > 0.06) return d;
    return (b.cols * b.rows) - (a.cols * a.rows);   // 相近時取細的
  });
  return { file: path.basename(file), size: img.width + 'x' + img.height, best: cands[0], all: cands.slice(0, 4) };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  let maxN = 12;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--max') maxN = +argv[++i];
    else files.push(argv[i]);
  }
  if (!files.length) { console.error('用法：node tools/vfx/detect-grid.cjs <圖檔...>'); process.exit(2); }
  files.forEach(function (f) {
    const r = detect(f, maxN);
    if (!r.best) { console.log('  ' + r.file + '  ' + r.size + '  ✗ 判不出來'); return; }
    const b = r.best;
    console.log('  ' + r.file.padEnd(24) + r.size.padStart(9) + '  → ' +
      (b.cols + 'x' + b.rows).padStart(5) + ' 格 ' + b.cellW + 'x' + b.cellH +
      '  用 ' + b.used + '（空 ' + b.empty + '）' +
      '  格線含墨比 ' + b.ratio.toFixed(3));
    const alt = r.all.slice(1).map(function (a) {
      return a.cols + 'x' + a.rows + '(' + a.ratio.toFixed(3) + ')';
    }).join('  ');
    if (alt) console.log('      次佳：' + alt);
  });
}

module.exports = { detect: detect, score: score };
