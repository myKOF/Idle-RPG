'use strict';
/* ============================================================
   vfx-image-facts.cjs — 影像「事實層」量測（VFX 專用，無外部相依）

   只回報可由像素客觀計算的數值，不做任何語意判斷
   （不猜 fire／smoke／spark／recommendedUsage——那是後續 AI 階段的事）。

   PNG 以純 Node（zlib）解碼，支援 colorType 0/2/3/4/6 與 bitDepth 1/2/4/8/16。
   交錯（Adam7）PNG 不解碼，只回報標頭事實並標記 pixelsAnalyzed=false，
   避免產生假精確的統計值。
   ============================================================ */

const zlib = require('zlib');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const COLOR_MODEL_BY_COLOR_TYPE = { 0: 'gray', 2: 'rgb', 3: 'palette', 4: 'grayAlpha', 6: 'rgba' };
/* PNG 規格允許的 colorType → bitDepth 組合。不在表內即為損毀或非法檔案。 */
const VALID_BIT_DEPTHS = {
  0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16]
};
/* 像素數上限：超過即拒絕解碼，避免異常尺寸的檔案造成記憶體壓力。
   64M 像素 ≈ 8192×8192，遠高於任何合理的 VFX 素材。 */
const MAX_PIXELS = 64 * 1024 * 1024;

/* SVG 絕對長度單位 → 像素（CSS 參考像素，1in = 96px）。
   表內沒有的單位（%、em、rem…）無從換算成像素，一律回 null 而不是當成數值用。 */
const UNIT_TO_PX = { '': 1, px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };

const CRC_TABLE = (function () {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* 數值一律四捨五入到固定位數：避免浮點尾差在 index 產生無意義 diff */
function round4(v) {
  return Math.round(v * 10000) / 10000;
}

/* ---------------- PNG 結構 ---------------- */

function readPngChunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('不是 PNG（簽章不符）');
  }
  const chunks = { idat: [], plte: null, trns: null, ihdr: null, sawIend: false };
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    // 截斷不再靜默略過：損毀的檔案要失敗，不能產生「看起來正常」的事實
    if (dataEnd + 4 > buf.length) throw new Error('PNG 截斷：chunk ' + type + ' 超出檔案長度');
    const declaredCrc = buf.readUInt32BE(dataEnd);
    if (crc32(buf.subarray(offset + 4, dataEnd)) !== declaredCrc) {
      throw new Error('PNG chunk ' + type + ' CRC 不符（檔案可能損毀）');
    }
    if (type === 'IHDR') chunks.ihdr = buf.subarray(dataStart, dataEnd);
    else if (type === 'PLTE') chunks.plte = buf.subarray(dataStart, dataEnd);
    else if (type === 'tRNS') chunks.trns = buf.subarray(dataStart, dataEnd);
    else if (type === 'IDAT') chunks.idat.push(buf.subarray(dataStart, dataEnd));
    else if (type === 'IEND') {
      if (length !== 0) throw new Error('PNG IEND 長度應為 0，實際 ' + length);
      chunks.sawIend = true;
      break;
    }
    offset = dataEnd + 4;                             // 跳過 CRC
  }
  if (!chunks.ihdr || chunks.ihdr.length < 13) throw new Error('PNG 缺少 IHDR');
  if (!chunks.sawIend) throw new Error('PNG 缺少 IEND（檔案不完整）');
  if (!chunks.idat.length) throw new Error('PNG 缺少 IDAT');
  return chunks;
}

function parseIhdr(ihdr) {
  return {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    bitDepth: ihdr[8],
    colorType: ihdr[9],
    compression: ihdr[10],
    filter: ihdr[11],
    interlace: ihdr[12]
  };
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/* 反濾波：回傳去掉 filter byte 的 scanline 資料 */
function unfilter(raw, width, height, bitDepth, channels) {
  const bitsPerPixel = bitDepth * channels;
  const bytesPerLine = Math.ceil((bitsPerPixel * width) / 8);
  const filterUnit = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const expected = height * (bytesPerLine + 1);
  if (raw.length !== expected) {
    // 多出來的位元組同樣可疑：代表寬高或色彩格式與資料不一致
    throw new Error('PNG 解壓後長度不符：預期 ' + expected + '，實際 ' + raw.length);
  }
  const out = Buffer.alloc(bytesPerLine * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[pos++];
    const lineStart = y * bytesPerLine;
    const prevStart = lineStart - bytesPerLine;
    for (let x = 0; x < bytesPerLine; x++) {
      const value = raw[pos + x];
      const left = x >= filterUnit ? out[lineStart + x - filterUnit] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft = (y > 0 && x >= filterUnit) ? out[prevStart + x - filterUnit] : 0;
      let result;
      switch (filterType) {
        case 0: result = value; break;
        case 1: result = value + left; break;
        case 2: result = value + up; break;
        case 3: result = value + ((left + up) >> 1); break;
        case 4: result = value + paethPredictor(left, up, upLeft); break;
        default: throw new Error('未知的 PNG filter type：' + filterType);
      }
      out[lineStart + x] = result & 0xff;
    }
    pos += bytesPerLine;
  }
  return { data: out, bytesPerLine: bytesPerLine };
}

/* 解碼成單一 RGBA 平面緩衝區（每像素 4 bytes）。
   一次展開後續統計全部走同一份資料，不再逐像素解位元。 */
function decodeToRgba(header, chunks) {
  const channels = CHANNELS_BY_COLOR_TYPE[header.colorType];
  const { width, height, bitDepth, colorType } = header;
  const lines = unfilter(zlib.inflateSync(Buffer.concat(chunks.idat)),
    width, height, bitDepth, channels);
  const src = lines.data;
  const bytesPerLine = lines.bytesPerLine;
  const rgba = new Uint8Array(width * height * 4);

  const perByte = bitDepth < 8 ? 8 / bitDepth : 0;
  const mask = bitDepth < 8 ? (1 << bitDepth) - 1 : 0;

  /* 原始樣本值（0 .. 2^bitDepth-1）。tRNS 比對必須用原始值，不能用正規化後的值。 */
  function rawSample(lineStart, index) {
    if (bitDepth === 8) return src[lineStart + index];
    if (bitDepth === 16) return (src[lineStart + index * 2] << 8) | src[lineStart + index * 2 + 1];
    const byte = src[lineStart + Math.floor(index / perByte)];
    const shift = 8 - bitDepth * ((index % perByte) + 1);
    return (byte >> shift) & mask;
  }
  /* 正規化到 0..255。16-bit 取完整值再換算，只取高位元組會讓 <1/256 的
     非零 alpha 被誤判為完全透明。 */
  function toByte(raw) {
    if (bitDepth === 8) return raw;
    if (bitDepth === 16) return Math.round(raw * 255 / 65535);
    return Math.round(raw * 255 / mask);
  }
  /* alpha 專用量化：原始值非零就至少回 1。
     16-bit 的 raw alpha 1～128 經一般四捨五入會變成 0，
     那會讓「幾乎全透明」被當成「完全透明」，連帶算錯
     visibleRatio、contentBounds 與背景分類。 */
  function toAlphaByte(raw) {
    if (raw === 0) return 0;
    return Math.max(1, toByte(raw));
  }

  const plte = chunks.plte;
  const trns = chunks.trns;
  const paletteEntries = plte ? Math.floor(plte.length / 3) : 0;
  /* colorType 0／2 的 tRNS 是「色鍵」：符合該值的像素才透明。 */
  const keyGray = (colorType === 0 && trns && trns.length >= 2) ? trns.readUInt16BE(0) : null;
  const keyRgb = (colorType === 2 && trns && trns.length >= 6)
    ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)]
    : null;
  for (let y = 0; y < height; y++) {
    const lineStart = y * bytesPerLine;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      switch (colorType) {
        case 0: {
          const raw = rawSample(lineStart, x);
          rgba[o] = rgba[o + 1] = rgba[o + 2] = toByte(raw);
          rgba[o + 3] = (keyGray !== null && raw === keyGray) ? 0 : 255;
          break;
        }
        case 2: {
          const rRaw = rawSample(lineStart, x * 3);
          const gRaw = rawSample(lineStart, x * 3 + 1);
          const bRaw = rawSample(lineStart, x * 3 + 2);
          rgba[o] = toByte(rRaw);
          rgba[o + 1] = toByte(gRaw);
          rgba[o + 2] = toByte(bRaw);
          rgba[o + 3] = (keyRgb && rRaw === keyRgb[0] && gRaw === keyRgb[1] && bRaw === keyRgb[2]) ? 0 : 255;
          break;
        }
        case 3: {
          const idx = rawSample(lineStart, x);
          if (idx >= paletteEntries) {
            throw new Error('palette 索引越界：' + idx + ' >= ' + paletteEntries + ' 個色彩');
          }
          const p = idx * 3;
          rgba[o] = plte[p];
          rgba[o + 1] = plte[p + 1];
          rgba[o + 2] = plte[p + 2];
          rgba[o + 3] = (trns && idx < trns.length) ? trns[idx] : 255;
          break;
        }
        case 4: {
          rgba[o] = rgba[o + 1] = rgba[o + 2] = toByte(rawSample(lineStart, x * 2));
          rgba[o + 3] = toAlphaByte(rawSample(lineStart, x * 2 + 1));
          break;
        }
        default: {
          rgba[o] = toByte(rawSample(lineStart, x * 4));
          rgba[o + 1] = toByte(rawSample(lineStart, x * 4 + 1));
          rgba[o + 2] = toByte(rawSample(lineStart, x * 4 + 2));
          rgba[o + 3] = toAlphaByte(rawSample(lineStart, x * 4 + 3));
          break;
        }
      }
    }
  }
  return rgba;
}

/* ---------------- 像素統計 ---------------- */

/* 單次掃描算出所有統計值。全部是量測結果，沒有任何語意判定。 */
function analysePixels(rgba, width, height) {
  let visible = 0;
  let alphaSum = 0;
  let lumaSum = 0;
  let lumaMax = 0;
  let satSum = 0;
  let satMax = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  let borderAlphaSum = 0;
  let borderLumaSum = 0;
  let borderCount = 0;
  let borderNearBlack = 0;
  let borderNearWhite = 0;

  for (let y = 0; y < height; y++) {
    const isEdgeRow = (y === 0 || y === height - 1);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2], alpha = rgba[o + 3];
      const a = alpha / 255;
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (isEdgeRow || x === 0 || x === width - 1) {
        borderAlphaSum += a;
        borderLumaSum += luma;
        borderCount++;
        if (luma <= 0.02) borderNearBlack++;
        if (luma >= 0.98) borderNearWhite++;
      }
      alphaSum += a;
      if (alpha > 0) {
        visible++;
        lumaSum += luma;
        if (luma > lumaMax) lumaMax = luma;
        const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
        const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        satSum += sat;
        if (sat > satMax) satMax = sat;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  const total = width * height;
  const bounds = maxX < 0
    ? { x: 0, y: 0, width: 0, height: 0 }
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };

  return {
    alpha: {
      mean: round4(alphaSum / total),
      visibleRatio: round4(visible / total),
      borderMean: round4(borderCount ? borderAlphaSum / borderCount : 0)
    },
    luminance: {
      mean: round4(visible ? lumaSum / visible : 0),
      max: round4(lumaMax),
      borderMean: round4(borderCount ? borderLumaSum / borderCount : 0),
      // 邊框中近黑／近白像素的比例。用比例而非平均值判定背景，
      // 才不會因為圖形（例如錐狀光）碰到某一邊而整張被誤判。
      borderNearBlackRatio: round4(borderCount ? borderNearBlack / borderCount : 0),
      borderNearWhiteRatio: round4(borderCount ? borderNearWhite / borderCount : 0)
    },
    saturation: {
      mean: round4(visible ? satSum / visible : 0),
      max: round4(satMax)
    },
    contentBounds: bounds,
    // 內容是否貼齊四邊（＝素材已被裁邊）。定義寫在此處，index 使用者可稽核。
    trimmed: width > 0 && bounds.width === width && bounds.height === height
  };
}

/* 對邊連續度：1 = 左右／上下完全吻合，0 = 完全不吻合。
   ⚠️ 這是「量測值」不是「可平鋪判定」：整圈透明的孤立素材同樣會得到 1.0。
   是否 seamless 需要額外條件，v1 刻意不下判定（見 VFX_ASSET_SCHEMA.md）。 */
function measureEdgeContinuity(rgba, width, height) {
  if (width < 2 || height < 2) return { u: null, v: null };
  const at = function (x, y) { return (y * width + x) * 4; };
  const diff = function (i, j) {
    return (Math.abs(rgba[i] - rgba[j]) + Math.abs(rgba[i + 1] - rgba[j + 1]) +
      Math.abs(rgba[i + 2] - rgba[j + 2]) + Math.abs(rgba[i + 3] - rgba[j + 3])) / (4 * 255);
  };
  let uSum = 0;
  for (let y = 0; y < height; y++) uSum += diff(at(0, y), at(width - 1, y));
  let vSum = 0;
  for (let x = 0; x < width; x++) vSum += diff(at(x, 0), at(x, height - 1));
  return { u: round4(1 - uSum / height), v: round4(1 - vSum / width) };
}

/* 背景型態：只由 alpha 與邊界亮度量測而來，規則明確可稽核。
     非全不透明                   → transparent（形狀由 alpha 承載）
     全不透明 ＋ 邊框九成以上近黑 → blackBackground（加法混合可直接用）
     全不透明 ＋ 邊框九成以上近白 → whiteBackground
     其他                         → opaqueOther

   用「近黑像素比例」而不是「邊框平均亮度」：光錐之類的圖形會碰到其中一邊，
   平均值被拉高就會把整張黑底圖誤判成 opaqueOther。 */
const BORDER_RATIO_THRESHOLD = 0.9;

function classifyBackground(stats) {
  if (stats.alpha.mean < 0.999) return 'transparent';
  if (stats.luminance.borderNearBlackRatio >= BORDER_RATIO_THRESHOLD) return 'blackBackground';
  if (stats.luminance.borderNearWhiteRatio >= BORDER_RATIO_THRESHOLD) return 'whiteBackground';
  return 'opaqueOther';
}

/* ---------------- 對外 ---------------- */

function pngFacts(buf) {
  const chunks = readPngChunks(buf);
  const header = parseIhdr(chunks.ihdr);
  const channels = CHANNELS_BY_COLOR_TYPE[header.colorType];
  if (!channels) throw new Error('非法的 PNG colorType：' + header.colorType);
  if (VALID_BIT_DEPTHS[header.colorType].indexOf(header.bitDepth) < 0) {
    throw new Error('colorType ' + header.colorType + ' 不允許 bitDepth ' + header.bitDepth);
  }
  if (!header.width || !header.height) throw new Error('PNG 尺寸為 0');
  if (header.compression !== 0) throw new Error('未知的 PNG 壓縮方法：' + header.compression);
  if (header.filter !== 0) throw new Error('未知的 PNG 濾波方法：' + header.filter);
  // 像素上限先於交錯判斷：Schema 宣告「超過上限即硬錯誤」，不因交錯而例外
  if (header.width * header.height > MAX_PIXELS) {
    throw new Error('PNG 像素數超過上限（' + header.width + '×' + header.height + '）');
  }
  if (header.colorType === 3) {
    if (!chunks.plte) throw new Error('palette PNG 缺少 PLTE');
    if (chunks.plte.length % 3 !== 0 || chunks.plte.length === 0 || chunks.plte.length > 768) {
      throw new Error('PLTE 長度不合法：' + chunks.plte.length);
    }
  } else if (chunks.plte && header.colorType !== 2 && header.colorType !== 6) {
    throw new Error('colorType ' + header.colorType + ' 不得帶 PLTE');
  }
  if (chunks.trns) {
    const trnsLimits = { 0: 2, 2: 6, 3: chunks.plte ? chunks.plte.length / 3 : 0 };
    if (!(header.colorType in trnsLimits)) {
      throw new Error('colorType ' + header.colorType + ' 不得帶 tRNS');
    }
    const expected = trnsLimits[header.colorType];
    const ok = header.colorType === 3
      ? (chunks.trns.length >= 1 && chunks.trns.length <= expected)
      : chunks.trns.length === expected;
    if (!ok) throw new Error('tRNS 長度不合法：' + chunks.trns.length);
  }

  const facts = {
    dimensions: { width: header.width, height: header.height },
    colorModel: COLOR_MODEL_BY_COLOR_TYPE[header.colorType],
    bitDepth: header.bitDepth,
    // tRNS 對 colorType 0／2 是色鍵透明，同樣算有 alpha
    hasAlphaChannel: header.colorType === 4 || header.colorType === 6 ||
      ((header.colorType === 0 || header.colorType === 2 || header.colorType === 3) && !!chunks.trns),
    pixelsAnalyzed: false
  };
  // 交錯 PNG：只給標頭事實，不解碼、不產生假統計
  if (header.interlace !== 0) return facts;

  const rgba = decodeToRgba(header, chunks);
  const stats = analysePixels(rgba, header.width, header.height);
  facts.pixelsAnalyzed = true;
  facts.alpha = stats.alpha;
  facts.luminance = stats.luminance;
  facts.saturation = stats.saturation;
  facts.contentBounds = stats.contentBounds;
  facts.trimmed = stats.trimmed;
  facts.edgeContinuity = measureEdgeContinuity(rgba, header.width, header.height);
  facts.backgroundVariant = classifyBackground(stats);
  return facts;
}

/* SVG：只取尺寸事實，不點陣化。width/height 缺少時退回 viewBox。 */
function svgFacts(buf) {
  const text = buf.toString('utf8', 0, Math.min(buf.length, 8192));
  const tag = /<svg\b[^>]*>/i.exec(text);
  // 明確的 null 而非缺欄位：讓「這格式量不到」與「還沒量」在索引裡可以區分。
  // Kenney 的 SVG 沒有 width/height/viewBox，dimensions 會是 null，這是事實不是解析失敗。
  const facts = {
    dimensions: null,
    dimensionsSource: null,
    colorModel: null,
    bitDepth: null,
    hasAlphaChannel: null,
    pixelsAnalyzed: false
  };
  if (!tag) throw new Error('不是 SVG（找不到 <svg> 根元素）');
  const attr = function (name) {
    const m = new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i').exec(tag[0]) ||
      new RegExp(name + "\\s*=\\s*'([^']*)'", 'i').exec(tag[0]);
    return m ? m[1].trim() : null;
  };
  /* 只接受可換算成像素的正數。百分比、em/rem 等相對單位無法換算 → 回 null，不猜。 */
  const toNumber = function (v) {
    if (!v) return null;
    const m = /^(-?\d*\.?\d+)\s*([a-z%]*)$/i.exec(v.trim());
    if (!m) return null;
    const unit = m[2].toLowerCase();
    // 百分比與 em/rem 等相對單位無從換算成像素 → 回 null，不猜
    if (!Object.prototype.hasOwnProperty.call(UNIT_TO_PX, unit)) return null;
    const n = Number(m[1]) * UNIT_TO_PX[unit];
    return (Number.isFinite(n) && n > 0) ? n : null;
  };
  let width = toNumber(attr('width'));
  let height = toNumber(attr('height'));
  let source = (width !== null && height !== null) ? 'attributes' : null;
  if (width === null || height === null) {
    const viewBox = attr('viewBox');
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts.every(function (n) { return Number.isFinite(n); }) &&
          parts[2] > 0 && parts[3] > 0) {
        width = parts[2];
        height = parts[3];
        source = 'viewBox';
      }
    }
  }
  if (width !== null && height !== null) {
    facts.dimensions = { width: round4(width), height: round4(height) };
    facts.dimensionsSource = source;
  }
  return facts;
}

module.exports = {
  pngFacts: pngFacts,
  svgFacts: svgFacts,
  round4: round4,
  _internal: {
    classifyBackground: classifyBackground,
    measureEdgeContinuity: measureEdgeContinuity,
    decodeToRgba: decodeToRgba,
    readPngChunks: readPngChunks,
    parseIhdr: parseIhdr
  }
};
