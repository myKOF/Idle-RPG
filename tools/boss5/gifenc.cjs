// Minimal dependency-free PNG decoder + GIF89a encoder (global median-cut palette, Bayer dither).
const zlib = require('zlib');
const fs = require('fs');

function decodePNG(buf) {
  let p = 8, w = 0, h = 0, bd = 0, ct = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IHDR') { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); bd = buf[p + 16]; ct = buf[p + 17]; }
    else if (type === 'IDAT') idat.push(buf.slice(p + 8, p + 8 + len));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8 || (ct !== 6 && ct !== 2)) throw new Error('unsupported png ' + bd + '/' + ct);
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const o = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const x = raw[o + i], a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      switch (f) {
        case 0: v = x; break; case 1: v = x + a; break; case 2: v = x + b; break; case 3: v = x + ((a + b) >> 1); break;
        default: { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) { out[(y * w + x) * 4] = cur[x * bpp]; out[(y * w + x) * 4 + 1] = cur[x * bpp + 1]; out[(y * w + x) * 4 + 2] = cur[x * bpp + 2]; out[(y * w + x) * 4 + 3] = 255; }
    const t = prev; prev = cur; cur = t;
  }
  return { w, h, rgba: out };
}

function buildPalette(frames, maxColors) {
  const hist = new Uint32Array(32768);
  for (const f of frames) { const d = f.rgba; for (let i = 0; i < d.length; i += 4 * 3) hist[((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)]++; }
  let boxes = [{ idx: [] }];
  for (let i = 0; i < 32768; i++) if (hist[i]) boxes[0].idx.push(i);
  const rgb = (i) => [(i >> 10) << 3 | 4, ((i >> 5) & 31) << 3 | 4, (i & 31) << 3 | 4];
  const stats = (b) => { let mn = [255, 255, 255], mx = [0, 0, 0], n = 0; for (const i of b.idx) { const c = rgb(i); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], c[k]); mx[k] = Math.max(mx[k], c[k]); } n += hist[i]; } b.mn = mn; b.mx = mx; b.n = n; b.range = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]); b.axis = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]].indexOf(b.range); };
  boxes.forEach(stats);
  while (boxes.length < maxColors) {
    let bi = -1, best = 0;
    boxes.forEach((b, i) => { const sc = b.n * Math.max(b.range, 1) * (b.idx.length > 1 ? 1 : 0); if (sc > best) { best = sc; bi = i; } });
    if (bi < 0) break;
    const b = boxes[bi], ax = b.axis;
    b.idx.sort((p, q) => rgb(p)[ax] - rgb(q)[ax]);
    let tot = 0; for (const i of b.idx) tot += hist[i];
    let acc = 0, cut = 1; for (let k = 0; k < b.idx.length; k++) { acc += hist[b.idx[k]]; if (acc >= tot / 2) { cut = Math.max(1, Math.min(b.idx.length - 1, k + 1)); break; } }
    const A = { idx: b.idx.slice(0, cut) }, B = { idx: b.idx.slice(cut) };
    stats(A); stats(B); boxes.splice(bi, 1, A, B);
  }
  const pal = boxes.map(b => { let r = 0, g = 0, bl = 0, n = 0; for (const i of b.idx) { const c = rgb(i), h = hist[i]; r += c[0] * h; g += c[1] * h; bl += c[2] * h; n += h; } return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)]; });
  while (pal.length < 256) pal.push([0, 0, 0]);
  const lut = new Uint8Array(32768);
  for (let i = 0; i < 32768; i++) { const c = rgb(i); let bd = 1e9, bk = 0; for (let k = 0; k < boxes.length; k++) { const p = pal[k]; const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; bk = k; } } lut[i] = bk; }
  return { pal, lut };
}

function lzw(indices, minCode) {
  const clear = 1 << minCode, eoi = clear + 1; let codeSize = minCode + 1, next = eoi + 1;
  const out = []; let cur = 0, nbits = 0;
  const put = (c) => { cur |= c << nbits; nbits += codeSize; while (nbits >= 8) { out.push(cur & 255); cur >>>= 8; nbits -= 8; } };
  const dict = new Map(); put(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 256 + k, v = dict.get(key);
    if (v !== undefined) { prefix = v; continue; }
    put(prefix);
    if (next < 4096) { dict.set(key, next++); if (next - 1 === (1 << codeSize) && codeSize < 12) codeSize++; }
    else { put(clear); dict.clear(); codeSize = minCode + 1; next = eoi + 1; }
    prefix = k;
  }
  put(prefix); put(eoi); if (nbits > 0) out.push(cur & 255);
  return out;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function encodeGIF(frames, delayCs, file, opts = {}) {
  const { w, h } = frames[0];
  const { pal, lut } = buildPalette(frames, 255);
  const bytes = [];
  const w16 = (v) => bytes.push(v & 255, (v >> 8) & 255);
  bytes.push(...Buffer.from('GIF89a')); w16(w); w16(h); bytes.push(0xF7, 0, 0);
  for (const c of pal) bytes.push(c[0], c[1], c[2]);
  bytes.push(0x21, 0xFF, 0x0B, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0);
  const amp = opts.dither === undefined ? 6 : opts.dither;
  for (const f of frames) {
    bytes.push(0x21, 0xF9, 4, 0x00, delayCs & 255, (delayCs >> 8) & 255, 0, 0);
    bytes.push(0x2C); w16(0); w16(0); w16(w); w16(h); bytes.push(0);
    const idx = new Uint8Array(w * h); const d = f.rgba;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, th = (BAYER[(y & 3) * 4 + (x & 3)] - 7.5) * amp / 7.5;
      const r = Math.max(0, Math.min(255, d[o] + th)), g = Math.max(0, Math.min(255, d[o + 1] + th)), b = Math.max(0, Math.min(255, d[o + 2] + th));
      idx[y * w + x] = lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
    }
    bytes.push(8);
    const data = lzw(idx, 8);
    for (let i = 0; i < data.length; i += 255) { const n = Math.min(255, data.length - i); bytes.push(n); for (let k = 0; k < n; k++) bytes.push(data[i + k]); }
    bytes.push(0);
  }
  bytes.push(0x3B);
  fs.writeFileSync(file, Buffer.from(bytes));
  return bytes.length;
}
module.exports = { decodePNG, encodeGIF };
