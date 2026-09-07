'use strict';
/* ============================================================
   sheet-facts.cjs — 量測序列幀圖集，回答「這張圖集該怎麼用」

   做這支工具的原因：第一份序列幀 preset（burst-explosion-sheet）裡
   `size: 290` 是目測猜的，註解寫著「爆炸大約佔滿格子的七成」。
   一份猜得準不代表二十份都猜得準，而猜錯的後果是特效比場域小一圈或爆出邊界。
   同樣地，「這個特效能不能無縫循環」用眼睛看圖集是看不出來的——
   要看的是最後一格接回第一格會不會跳，那是兩張不相鄰的圖之間的差異。

   量四件事：

   1. 用幾格（usedFrames）
      60fps 版是 9x7＝63 格但只畫了 60 格，尾端三格全空。
      不扣掉的話動畫最後會定格三格的時間（約 0.05 秒的停頓）。

   2. 畫面佔格子多少（coverage）
      逐格取「非透明像素的外接矩形」，再取全部格子的聯集。
      preset 的 size 要照這個比例放大：想要畫面上 200px 寬，
      而素材只佔格子的 0.7，格子就要開到 200/0.7 = 286px。

   3. 重心漂移（drift）
      有些素材的動畫是往上竄的（火焰、煙），畫面重心並不在格子中心。
      這種素材直接置中會看起來浮在半空，要往下推 drift 的量。

   4. 循環接縫（seam）
      把每一格降到 16x16 的預乘簽章，量相鄰格之間的平均差異。
      「最後一格 → 第一格」的差異若與相鄰格差不多，就是接得上的循環；
      遠大於相鄰格，就是一次性動畫，硬循環會每輪跳一下。

      用預乘簽章而不是原始像素：透明處的 RGB 是垃圾值，
      不預乘的話兩張「同樣全透明」的圖可能算出很大的差異。

   用法：
     node tools/vfx/sheet-facts.cjs                       預設掃 spritemancer-vfx-256
     node tools/vfx/sheet-facts.cjs --package <name>
     node tools/vfx/sheet-facts.cjs --dir 30fps           只掃子資料夾
     node tools/vfx/sheet-facts.cjs --json                機器可讀輸出
   ============================================================ */

const fs = require('fs');
const path = require('path');
const raster = require('./vfx-raster.cjs');
const libraryRoot = require('./vfx-library-root.cjs');

const SIG = 16;            // 簽章邊長：夠粗糙到不被雜訊左右，夠細緻到看得出形狀變化
const ALPHA_MIN = 8;       // 低於這個 alpha 視為透明（PNG 的邊緣常有 1~2 的殘值）

/* ---------------- 逐格量測 ---------------- */

function measureFrame(rgba, stride, x0, y0, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  let alphaSum = 0, cx = 0, cy = 0;
  const sig = new Float64Array(SIG * SIG * 4);
  const sigCount = new Float64Array(SIG * SIG);
  for (let y = 0; y < h; y++) {
    const sy = ((y * SIG / h) | 0);
    for (let x = 0; x < w; x++) {
      const o = (y0 + y) * stride + (x0 + x) * 4;
      const a = rgba[o + 3];
      alphaSum += a;
      if (a >= ALPHA_MIN) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        cx += x * a; cy += y * a;
      }
      /* 預乘後累加：透明像素貢獻 0，不會把它的垃圾 RGB 混進簽章。 */
      const si = (sy * SIG + ((x * SIG / w) | 0)) * 4;
      sig[si] += rgba[o] * a / 255;
      sig[si + 1] += rgba[o + 1] * a / 255;
      sig[si + 2] += rgba[o + 2] * a / 255;
      sig[si + 3] += a;
      sigCount[si >> 2]++;
    }
  }
  for (let i = 0; i < SIG * SIG; i++) {
    const n = sigCount[i] || 1;
    sig[i * 4] /= n; sig[i * 4 + 1] /= n; sig[i * 4 + 2] /= n; sig[i * 4 + 3] /= n;
  }
  const empty = maxX < 0;
  return {
    empty: empty,
    meanAlpha: alphaSum / (w * h * 255),
    bounds: empty ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    /* 重心用 alpha 加權，單位是「距離格子中心的比例」（-0.5 ~ +0.5）。 */
    centroid: alphaSum > 0
      ? { x: cx / alphaSum / w - 0.5, y: cy / alphaSum / h - 0.5 }
      : { x: 0, y: 0 },
    sig: sig
  };
}

/* 兩格之間的差異：簽章的平均絕對差，正規化到 0..1。 */
function sigDelta(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length / 255;
}

function median(values) {
  if (!values.length) return 0;
  const s = values.slice().sort(function (x, y) { return x - y; });
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ---------------- 單張圖集 ---------------- */

function factsFor(filePath) {
  const buf = fs.readFileSync(filePath);
  const img = raster.decodePng(buf);
  const grid = raster.gridOf(path.basename(filePath), img.width, img.height);
  if (!grid) return { error: '檔名沒有格尺寸，或格尺寸除不盡圖片尺寸' };

  const stride = img.width * 4;
  const frames = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      frames.push(measureFrame(img.rgba, stride,
        c * grid.cellW, r * grid.cellH, grid.cellW, grid.cellH));
    }
  }

  /* 尾端的空格不算數。中間的空格要留著——那可能是刻意的閃爍。 */
  let used = frames.length;
  while (used > 1 && frames[used - 1].empty) used--;
  const live = frames.slice(0, used);

  /* 內容範圍取全部格子的聯集：動畫過程中最大的那一刻決定了要開多大。 */
  let ux0 = grid.cellW, uy0 = grid.cellH, ux1 = 0, uy1 = 0;
  live.forEach(function (f) {
    if (!f.bounds) return;
    ux0 = Math.min(ux0, f.bounds.x); uy0 = Math.min(uy0, f.bounds.y);
    ux1 = Math.max(ux1, f.bounds.x + f.bounds.w);
    uy1 = Math.max(uy1, f.bounds.y + f.bounds.h);
  });
  const hasContent = ux1 > ux0;

  const alphas = live.map(function (f) { return f.meanAlpha; });
  const peakAlpha = Math.max.apply(null, alphas);

  const deltas = [];
  for (let i = 0; i + 1 < used; i++) deltas.push(sigDelta(live[i].sig, live[i + 1].sig));
  const seam = used > 1 ? sigDelta(live[used - 1].sig, live[0].sig) : 0;
  const interiorMed = median(deltas);
  /* 相鄰格差異接近 0（幾乎靜止的動畫）時，比值會爆掉而失去意義；
     用 peakAlpha 的一個小比例當地板，讓「兩者都幾乎沒差」判成接得上。 */
  const floorDelta = Math.max(interiorMed, peakAlpha * 0.01, 1e-4);
  const seamRatio = seam / floorDelta;

  /* 端點是否為空：一次性動畫（無 → 有 → 無）即使接縫比值很低，
     循環起來也是「一閃一閃」而不是「持續流動」。兩者要分開報告。 */
  const endAlpha = Math.max(alphas[0], alphas[used - 1]);
  const endRatio = peakAlpha > 0 ? endAlpha / peakAlpha : 0;

  let loop;
  if (seamRatio <= 1.6) loop = endRatio < 0.15 ? 'pulse' : 'clean';
  else if (seamRatio <= 3) loop = 'soft';
  else loop = 'cut';

  const drift = {
    x: median(live.map(function (f) { return f.centroid.x; })),
    y: median(live.map(function (f) { return f.centroid.y; }))
  };

  return {
    file: path.basename(filePath),
    grid: { cols: grid.cols, rows: grid.rows, cellW: grid.cellW, cellH: grid.cellH },
    count: grid.count,
    used: used,
    coverage: hasContent
      ? { x: (ux1 - ux0) / grid.cellW, y: (uy1 - uy0) / grid.cellH }
      : { x: 0, y: 0 },
    /* 內容矩形的中心相對於格子中心的偏移（比例）。素材沒有置中時要靠這個補。 */
    offset: hasContent
      ? { x: (ux0 + ux1) / 2 / grid.cellW - 0.5, y: (uy0 + uy1) / 2 / grid.cellH - 0.5 }
      : { x: 0, y: 0 },
    drift: drift,
    peakAlpha: peakAlpha,
    peakFrame: alphas.indexOf(peakAlpha),
    endRatio: endRatio,
    seam: seam,
    interiorMedian: interiorMed,
    seamRatio: seamRatio,
    loop: loop
  };
}

/* ---------------- CLI ---------------- */

const LOOP_LABEL = {
  clean: '可循環', pulse: '一閃一閃', soft: '小跳', cut: '硬切'
};

function run(opts) {
  const root = libraryRoot.resolveLibraryRoot({ root: opts.root }).root;
  const base = path.join(root, opts.package, opts.dir || '');
  if (!fs.existsSync(base)) throw new Error('找不到資料夾：' + base);

  const files = [];
  (function walk(rel) {
    const dir = path.join(base, rel);
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(r);
      else if (/\.png$/i.test(e.name)) files.push(r);
    });
  })('');
  files.sort();

  const out = files.map(function (rel) {
    const f = factsFor(path.join(base, rel));
    f.rel = rel;
    return f;
  });

  if (opts.json) { console.log(JSON.stringify(out, null, 1)); return out; }

  console.log('圖集量測：' + opts.package + (opts.dir ? '/' + opts.dir : '') +
    '　（' + out.length + ' 張）\n');
  console.log('名稱                          格線   用格  佔格XY      偏移XY      重心Y   接縫比  循環判定');
  console.log('─'.repeat(104));
  out.forEach(function (f) {
    if (f.error) { console.log('  ' + f.rel + '  ✗ ' + f.error); return; }
    const name = f.rel.replace(/\.png$/i, '').replace(/^.*\//, '').replace(/_1_\d+x\d+$/, '');
    console.log(
      name.padEnd(28) +
      (f.grid.cols + 'x' + f.grid.rows).padStart(6) +
      String(f.used).padStart(6) + ' ' +
      (f.coverage.x.toFixed(2) + '/' + f.coverage.y.toFixed(2)).padStart(11) +
      (fmt(f.offset.x) + '/' + fmt(f.offset.y)).padStart(13) +
      fmt(f.drift.y).padStart(8) +
      f.seamRatio.toFixed(1).padStart(8) + '  ' +
      LOOP_LABEL[f.loop]);
  });
  console.log('\n佔格 = 內容外接矩形佔格子的比例。preset 的 size 要除以它才會得到想要的畫面尺寸。');
  console.log('偏移 = 內容矩形中心相對格子中心（正 = 右／下）。非 0 時要在 preset 裡反向平移。');
  console.log('接縫比 = 末格接回首格的差異 ÷ 相鄰格差異中位數。≤1.6 接得上，>3 是一次性動畫。');
  return out;
}

function fmt(v) {
  const s = (v >= 0 ? '+' : '') + v.toFixed(2);
  return s === '+0.00' || s === '-0.00' ? ' 0.00' : s;
}

function parseArgs(argv) {
  const opts = { package: 'spritemancer-vfx-256', dir: '30fps', json: false, root: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--package') opts.package = argv[++i];
    else if (a === '--dir') opts.dir = argv[++i];
    else if (a === '--root') opts.root = argv[++i];
    else if (a === '--json') opts.json = true;
    else if (a === '--all') opts.dir = '';
    else throw new Error('不認得的參數：' + a);
  }
  return opts;
}

if (require.main === module) {
  try {
    run(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error('[ERROR] ' + e.message);
    process.exit(2);
  }
}

module.exports = { factsFor: factsFor, run: run, _internal: { sigDelta: sigDelta, measureFrame: measureFrame } };
