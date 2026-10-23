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
const decodeEnt = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
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
function splitMarkup(text, fromHtmlAttr) {
  const out = [];
  if (fromHtmlAttr) text = decodeEnt(text);
  // A. 屬性值（tooltip／title…）獨立成條
  let rest = text.replace(ATTR_TEXT, (m, v) => { if (IDEO.test(v)) out.push(...splitMarkup(v, true)); return ' '; });
  if (rest !== text) rest = rest.replace(/^[^<>\u3400-\u9fff]*>/, '');
  // B. 其餘文字節點；結構性標籤當斷點，格式標籤（br／b／變色 span）保留
  let buf = '';
  const flush = () => { const t = balance(buf).replace(/\s+/g, ' ').replace(/\s+>/g, '>').trim(); if (t && IDEO.test(t.replace(/<[^>]*>/g, ''))) out.push(t); buf = ''; };
  for (const p of parseMarkup(rest)) {
    if (!p.tag) { buf += p.text; continue; }
    if (keepTag(p)) buf += p.raw; else flush();
  }
  flush();
  return out;
}


module.exports = { IDEO, INLINE_OK, parseMarkup, keepTag, balance, splitMarkup, decodeEnt, ATTR_TEXT };
