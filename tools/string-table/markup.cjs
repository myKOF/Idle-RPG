'use strict';
/* 字串內嵌標記的整理（build_string_csv.cjs 與 migrate.cjs 共用）：保留 br／b／變色 span，結構性標籤當斷點，屬性值（tooltip 等）獨立成條。 */
const IDEO = /[㐀-鿿぀-ヿ가-힯]/;
const INLINE_OK = /^(b|i|u|em|strong|small|code|br|sub|sup)$/i;
function parseMarkup(s) {
  const parts = []; const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+|<)/g; let m;
  while ((m = re.exec(s))) {
    if (m[5] !== undefined) parts.push({ text: m[5] });
    else parts.push({ tag: m[2].toLowerCase(), close: !!m[1], attrs: m[3] || '', raw: m[0] });
  }
  return parts;
}
function simpleInline(parts) {
  for (const p of parts) {
    if (!p.tag) continue;
    if (INLINE_OK.test(p.tag)) { if (p.attrs.trim() && !/^\s*$/.test(p.attrs)) return false; continue; }
    if (p.tag === 'span') {
      if (p.close) continue;
      const a = p.attrs.trim();
      if (/^style="color:\s*[^";]+;?"$/.test(a) || /^class="[\w\- ]+"$/.test(a)) continue;
      return false;
    }
    return false;
  }
  return true;
}
const ATTR_TEXT = /\s?(?:data-tip|data-tt-title|data-tt-desc|data-tt-[\w-]+|title|aria-label|alt|placeholder|label)="([^"]*)"/g;
const decodeEnt = t => t.replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
function keepTag(p) {
  if (INLINE_OK.test(p.tag)) return !p.attrs.trim();
  if (p.tag === 'span') {
    if (p.close) return true;
    const a = p.attrs.trim();
    return /^style="color:\s*[^";]+;?"$/.test(a) || /^class="[\w\- ]+"$/.test(a);
  }
  return false;
}
// 去掉沒有配對的標籤（片段式拼接常讓開頭／結尾標籤落單）
function balance(s) {
  const parts = parseMarkup(s); const stack = []; const drop = new Set();
  parts.forEach((p, i) => {
    if (!p.tag || p.tag === 'br') return;
    if (!p.close) stack.push(i);
    else {
      let k = stack.length - 1;
      while (k >= 0 && parts[stack[k]].tag !== p.tag) k--;
      if (k < 0) drop.add(i); else { for (let q = stack.length - 1; q > k; q--) drop.add(stack[q]); stack.length = k; }
    }
  });
  for (const i of stack) drop.add(i);
  return parts.map((p, i) => drop.has(i) ? '' : (p.tag ? p.raw : p.text)).join('');
}
/* 找出沒有配對的標籤（片段式拼接常讓開頭／結尾標籤落單）的索引 */
function orphanSet(parts) {
  const stack = []; const drop = new Set();
  parts.forEach((p, i) => {
    if (!p.tag || p.tag === 'br') return;
    if (!p.close) stack.push(i);
    else {
      let k = stack.length - 1;
      while (k >= 0 && parts[stack[k]].tag !== p.tag) k--;
      if (k < 0) drop.add(i); else { for (let q = stack.length - 1; q > k; q--) drop.add(stack[q]); stack.length = k; }
    }
  });
  for (const i of stack) drop.add(i);
  return drop;
}
const hasIdeo = (t) => IDEO.test(t.replace(/<[^>]*>/g, ''));
const onlyPlaceholders = (t) => /^(\s|\{\d+\})*$/.test(t);

/* 頂層節點：{text} 或 {el, text(純文字)}，片段已配對所以只靠深度就能分 */
function topNodes(parts) {
  const nodes = []; let depth = 0, cur = null;
  for (const p of parts) {
    const isBr = p.tag === 'br';
    if (!p.tag || isBr) {
      const raw = p.tag ? p.raw : p.text;
      if (depth === 0) nodes.push({ el: false, raw });
      else cur.raw += raw;
      continue;
    }
    if (!p.close) { if (depth === 0) cur = { el: true, raw: '' }; cur.raw += p.raw; depth++; }
    else { cur.raw += p.raw; depth--; if (depth === 0) { nodes.push(cur); cur = null; } }
  }
  return nodes;
}
/* 去掉頭尾「沒有漢字的元素」與緊貼它們的 {N}：這些是版面結構，不是要翻譯的句子 */
function stripEdges(seg) {
  const nodes = topNodes(seg);
  let l = 0, r = nodes.length;
  while (l < r) {
    const n = nodes[l];
    if (n.el && !hasIdeo(n.raw)) l++;
    else if (!n.el && onlyPlaceholders(n.raw) && l + 1 < r && nodes[l + 1].el && !hasIdeo(nodes[l + 1].raw)) l++;
    else break;
  }
  while (r > l) {
    const n = nodes[r - 1];
    if (n.el && !hasIdeo(n.raw)) r--;
    else if (!n.el && onlyPlaceholders(n.raw) && r - 2 >= l && nodes[r - 2].el && !hasIdeo(nodes[r - 2].raw)) r--;
    else break;
  }
  return nodes.slice(l, r).map(n => n.raw).join('');
}
/* 一段累積的內嵌標記字串 → 句子們：落單標籤當斷點（不刪除，所以句子一定是原字串的連續片段） */
function finalize(buf) {
  const out = [];
  const parts = parseMarkup(buf);
  const drop = orphanSet(parts);
  const segs = []; let seg = [];
  parts.forEach((p, i) => { if (drop.has(i)) { segs.push(seg); seg = []; } else seg.push(p); });
  segs.push(seg);
  for (const sg of segs) {
    const t = stripEdges(sg).replace(/\s+/g, ' ').trim();
    if (t && hasIdeo(t)) out.push(t);
  }
  return out;
}

/* 屬性值（tooltip、title…）整段就是一條字串：解開實體、空白收成一個、去頭尾 */
const attrValue = (v) => decodeEnt(v).replace(/\s+/g, ' ').trim();

function splitMarkup(text, fromHtmlAttr) {
  const out = [];
  if (fromHtmlAttr) text = decodeEnt(text);
  const BRK = '\u0000';
  // A. 帶 tooltip／title 屬性的標籤：屬性值獨立成條，整個標籤當斷點
  let rest = text.replace(/<([a-zA-Z][\w-]*)([^<>]*)>/g, (all, tag, attrs) => {
    let had = false;
    attrs.replace(ATTR_TEXT, (m, v) => { had = true; if (IDEO.test(v)) out.push(attrValue(v)); return ''; });
    return had ? BRK : all;
  });
  // 沒有標籤包住的殘缺屬性片段（' disabled data-tip="…">文字'）
  rest = rest.replace(ATTR_TEXT, (m, v) => { if (IDEO.test(v)) out.push(attrValue(v)); return BRK; });
  rest = rest.replace(/\u0000[^<>\u0000\u3400-\u9fff{}]*>/g, BRK);
  // B. 其餘文字節點；結構性標籤當斷點，格式標籤（br／b／變色或樣式 span）保留
  let buf = '';
  const flush = () => { out.push(...finalize(buf)); buf = ''; };
  for (const p of parseMarkup(rest)) {
    if (!p.tag) {
      const chunks = p.text.split(BRK);
      chunks.forEach((c, i) => { if (i) flush(); buf += c; });
      continue;
    }
    if (keepTag(p)) buf += p.raw; else flush();
  }
  flush();
  return out;
}

module.exports = { IDEO, INLINE_OK, parseMarkup, keepTag, balance, splitMarkup, decodeEnt, ATTR_TEXT, orphanSet, attrValue };
