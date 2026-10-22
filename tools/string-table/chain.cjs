'use strict';
// 把 JS 原始碼切成 token，再把「用 + 串起來的字串運算式」合併成一條完整訊息，非字面值部分換成 {N} 並記錄原運算式
const CJK = /[㐀-鿿＀-￯　-〿]/;

function unescapeStr(raw) {
  return raw.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|[\s\S])/g, (m, g, a, b, c) => {
    if (a) return String.fromCodePoint(parseInt(a, 16));
    if (b) return String.fromCharCode(parseInt(b, 16));
    if (c) return String.fromCharCode(parseInt(c, 16));
    switch (m[1]) { case 'n': return '\n'; case 't': return '\t'; case 'r': return '\r'; case '\n': return ''; default: return m[1]; }
  });
}

const PUNCT3 = ['===', '!==', '...', '>>>', '**=', '<<=', '>>='];
const PUNCT2 = ['==', '!=', '<=', '>=', '=>', '&&', '||', '??', '++', '--', '+=', '-=', '*=', '/=', '%=', '|=', '&=', '^=', '**', '<<', '>>', '?.'];

function tokenize(src, baseLine) {
  const toks = [];
  let i = 0, line = baseLine || 1;
  const n = src.length;
  const last = () => toks[toks.length - 1];
  function regexAllowed() {
    const p = last();
    if (!p) return true;
    if (p.t === 'num' || p.t === 'str' || p.t === 'tpl' || p.t === 're') return false;
    if (p.t === 'id') return /^(return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(p.v);
    return !/^[)\]}]$/.test(p.v);
  }
  function readTpl(s) {
    let j = s + 1, buf = ''; const parts = []; const startLine = line;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { buf += c + src[j + 1]; if (src[j + 1] === '\n') line++; j += 2; continue; }
      if (c === '`') { parts.push({ text: buf }); return { end: j + 1, parts, line: startLine }; }
      if (c === '\n') line++;
      if (c === '$' && src[j + 1] === '{') {
        parts.push({ text: buf }); buf = '';
        let depth = 1, k = j + 2; const es = k;
        while (k < n && depth > 0) {
          const d = src[k];
          if (d === '{') depth++;
          else if (d === '}') { depth--; if (depth === 0) break; }
          else if (d === '"' || d === "'") { const q = d; k++; while (k < n && src[k] !== q) { if (src[k] === '\\') k++; k++; } }
          else if (d === '`') { const save = line; const r = readTpl(k); k = r.end - 1; line = save + 0; /* 行號稍後重算 */ }
          k++;
        }
        const expr = src.slice(es, k);
        parts.push({ expr, toks: tokenize(expr, line) });
        for (const ch of expr) if (ch === '\n') line++;
        j = k + 1; continue;
      }
      buf += c; j++;
    }
    return { end: n, parts, line: startLine };
  }
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2); const stop = e < 0 ? n : e + 2;
      for (let k = i; k < stop; k++) if (src[k] === '\n') line++;
      i = stop; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, raw = '';
      while (j < n && src[j] !== c) { if (src[j] === '\\') { raw += src[j] + src[j + 1]; if (src[j + 1] === '\n') line++; j += 2; continue; } if (src[j] === '\n') break; raw += src[j]; j++; }
      toks.push({ t: 'str', v: unescapeStr(raw), src: src.slice(i, j + 1), line, pos: i });
      i = j + 1; continue;
    }
    if (c === '`') {
      const r = readTpl(i);
      toks.push({ t: 'tpl', parts: r.parts, src: src.slice(i, r.end), line: r.line, pos: i });
      i = r.end; continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, inCls = false;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inCls = true; else if (src[j] === ']') inCls = false;
        else if (src[j] === '/' && !inCls) break; else if (src[j] === '\n') break;
        j++;
      }
      j++; while (j < n && /[a-z]/.test(src[j])) j++;
      toks.push({ t: 're', v: src.slice(i, j), src: src.slice(i, j), line, pos: i });
      i = j; continue;
    }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < n && /[\w$]/.test(src[j])) j++; toks.push({ t: 'id', v: src.slice(i, j), src: src.slice(i, j), line, pos: i }); i = j; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) { let j = i; while (j < n && /[\w.]/.test(src[j])) j++; toks.push({ t: 'num', v: src.slice(i, j), src: src.slice(i, j), line, pos: i }); i = j; continue; }
    let p = null;
    for (const q of PUNCT3) if (src.startsWith(q, i)) { p = q; break; }
    if (!p) for (const q of PUNCT2) if (src.startsWith(q, i)) { p = q; break; }
    if (!p) p = c;
    toks.push({ t: 'p', v: p, src: p, line, pos: i });
    i += p.length;
  }
  return toks;
}

const TERMINATORS = new Set([',', ';', '?', ':', '=', '=>', '&&', '||', '??', '==', '===', '!=', '!==', '<', '>', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '|=', '&=', '{', '}', '...']);
const OPEN = { '(': ')', '[': ']', '{': '}' };

/** 回傳 [{text, params:[expr...], line, ctx:{callee, key, prev}}] */
function extract(src) {
  const all = tokenize(src, 1);
  const out = [];
  const fnStack = []; // 簡化：不追蹤

  // 預先算出每個 token 所屬的最近 function 名稱
  const fnAt = new Array(all.length).fill('');
  {
    let cur = '';
    for (let i = 0; i < all.length; i++) {
      const t = all[i];
      if (t.t === 'id' && t.v === 'function' && all[i + 1] && all[i + 1].t === 'id') cur = all[i + 1].v;
      else if (t.t === 'id' && all[i + 1] && all[i + 1].v === ':' && all[i + 2] && all[i + 2].v === 'function') cur = t.v;
      else if (t.t === 'id' && /^(const|let|var)$/.test(t.v) && all[i + 1] && all[i + 1].t === 'id' && all[i + 2] && all[i + 2].v === '=' && all[i + 3] && (all[i + 3].v === 'function' || (all[i + 3].v === '(' ) || all[i + 3].t === 'id')) {
        // const foo = (…) => ，粗略
        const look = all.slice(i + 3, i + 40).map(x => x.v).join(' ');
        if (/^(function|\(.*\) =>|\w+ =>|async)/.test(look)) cur = all[i + 1].v;
      }
      fnAt[i] = cur;
    }
  }
  const idx = new Map(all.map((t, i) => [t, i]));
  const topAt = new Array(all.length).fill('');
  {
    let depth = 0, cur = '';
    for (let i = 0; i < all.length; i++) {
      const t = all[i];
      if (t.t === 'p') {
        if (t.v === '(' || t.v === '[' || t.v === '{') depth++;
        else if (t.v === ')' || t.v === ']' || t.v === '}') depth--;
      }
      if (depth === 0 && t.t === 'id' && /^(var|let|const)$/.test(t.v) && all[i + 1] && all[i + 1].t === 'id') cur = all[i + 1].v;
      if (depth === 0 && t.t === 'id' && t.v === 'function' && all[i + 1] && all[i + 1].t === 'id') cur = all[i + 1].v;
      topAt[i] = cur;
    }
  }

  function fnOf(tok) { return fnAt[idx.get(tok)] || ''; }

  // 取出 toks[lo..hi) 內到對應右括號的 index
  function matchClose(toks, i) {
    const open = toks[i].v, close = OPEN[open]; let d = 0;
    for (let k = i; k < toks.length; k++) {
      if (toks[k].t !== 'p') continue;
      if (toks[k].v === open) d++;
      else if (toks[k].v === close) { d--; if (d === 0) return k; }
    }
    return toks.length - 1;
  }

  function exprSrc(toks) {
    if (!toks.length) return '';
    return toks.map(t => t.t === 'tpl' || t.t === 'str' ? t.src : t.src || t.v).join(' ').replace(/\s*([.()\[\],])\s*/g, '$1').replace(/\s+/g, ' ');
  }

  function processSeq(toks, ctx) {
    // 1) 依 depth-0 終止符切 group，同時遞迴處理括號內部
    let i = 0;
    let group = []; // tokens of current group
    let groupPrev = null; // terminator token before group
    let prevTok = null;
    const flush = () => {
      if (group.length) processGroup(group, ctx, groupPrev);
      group = [];
    };
    while (i < toks.length) {
      const t = toks[i];
      if (t.t === 'p' && (t.v === '(' || t.v === '[')) {
        const close = matchClose(toks, i);
        const inner = toks.slice(i + 1, close);
        let callee = '';
        const pt = toks[i - 1];
        if (t.v === '(' && pt && pt.t === 'id') {
          callee = pt.v;
          // a.b.c( → 取最後兩段
          let k = i - 1; const segs = [pt.v];
          while (k >= 2 && toks[k - 1].v === '.' && toks[k - 2].t === 'id') { segs.unshift(toks[k - 2].v); k -= 2; }
          callee = segs.slice(-2).join('.');
        }
        // 內部作為子序列（含自己的終止符處理）
        processSeq(inner, { callee: t.v === '(' ? callee : (ctx.callee || ''), arrayOf: t.v === '[' ? true : false, parentCallee: ctx.callee });
        if (t.v === '(' && pt && pt.t === 'id' && /^(if|while|for|switch|catch)$/.test(pt.v)) {
          // 條件式括號：不屬於後面的字串運算式
          flush(); groupPrev = null; i = close + 1; continue;
        }
        // 整個括號組當作 group 內的一個 operand（保留 token 以便做 placeholder 表示）
        for (let k = i; k <= close; k++) group.push(toks[k]);
        i = close + 1; continue;
      }
      if (t.t === 'p' && t.v === '{') {
        // 物件字面值或區塊：內部遞迴；視為終止符（兩側各自成 group）
        const close = matchClose(toks, i);
        flush();
        processSeq(toks.slice(i + 1, close), { callee: '', objOf: ctx.callee || ctx.objOf || '', isObj: true });
        groupPrev = toks[close] || t;
        i = close + 1; continue;
      }
      if (t.t === 'p' && TERMINATORS.has(t.v)) {
        flush(); groupPrev = t; i++; continue;
      }
      if (t.t === 'id' && /^(return|case|throw|else|typeof|new|var|let|const|in|of|if|while|for)$/.test(t.v) && group.length === 0) {
        // 關鍵字作為 group 的前導，記錄但不放進 operand
        groupPrev = t; i++; continue;
      }
      group.push(t); i++;
    }
    flush();
  }

  function keyBefore(prevTerm, groupToks) {
    return null;
  }

  function processGroup(gtoks, ctx, prevTerm) {
    // 把 gtoks 以 depth-0 的 + 切 operand
    const ops = [];
    let cur = [];
    for (let i = 0; i < gtoks.length; i++) {
      const t = gtoks[i];
      if (t.t === 'p' && (t.v === '(' || t.v === '[')) {
        const close = matchClose(gtoks, i);
        for (let k = i; k <= close; k++) cur.push(gtoks[k]);
        i = close; continue;
      }
      if (t.t === 'p' && t.v === '+') { ops.push(cur); cur = []; continue; }
      cur.push(t);
    }
    ops.push(cur);
    const hasLit = ops.some(o => o.length === 1 && (o[0].t === 'str' || o[0].t === 'tpl'));
    // 非串接情境：operand 裡含 tpl/str 但被其他運算包住（例如 'a'.repeat(3)）也要處理單獨字面值
    if (!hasLit) {
      for (const o of ops) for (const t of o) if (t.t === 'tpl') handleTpl(t, ctx, prevTerm, true);
      // 單獨出現在 operand 內的 str（例如 x.replace('a','b') 已由括號遞迴處理）
      for (const o of ops) if (o.length > 1 && o.some(t => t.t === 'str' && CJK.test(t.v)) && !o.some(t => t.v === '(')) {
        for (const t of o) if (t.t === 'str' && CJK.test(t.v)) emit(t.v, [], t, ctx, prevTerm, o);
      }
      return;
    }
    let text = '';
    const params = [];
    let firstTok = null;
    for (const o of ops) {
      if (o.length === 1 && o[0].t === 'str') { text += o[0].v; firstTok = firstTok || o[0]; }
      else if (o.length === 1 && o[0].t === 'tpl') {
        const r = tplToText(o[0], params);
        text += r; firstTok = firstTok || o[0];
        // 樣板內 ${} 的子運算式也要遞迴
        for (const p of o[0].parts) if (p.toks) processSeq(p.toks, { callee: '', inTpl: true });
      } else if (o.length === 0) { /* 空 */ }
      else {
        params.push(exprSrc(o));
        text += '{' + (params.length - 1) + '}';
        // 非字面 operand 內如果有 tpl 也要處理
        for (const t of o) if (t.t === 'tpl') for (const p of t.parts) if (p.toks) processSeq(p.toks, { callee: '', inTpl: true });
      }
    }
    if (!CJK.test(text.replace(/\{\d+\}/g, ''))) return;
    emit(text, params, firstTok, ctx, prevTerm, gtoks);
  }

  function tplToText(tok, params) {
    let s = '';
    for (const p of tok.parts) {
      if (p.text !== undefined) s += unescapeStr(p.text);
      else { params.push(p.expr.replace(/\s+/g, ' ').trim()); s += '{' + (params.length - 1) + '}'; }
    }
    return s;
  }
  function handleTpl(tok, ctx, prevTerm) {
    const params = [];
    const text = tplToText(tok, params);
    for (const p of tok.parts) if (p.toks) processSeq(p.toks, { callee: '', inTpl: true });
    if (CJK.test(text.replace(/\{\d+\}/g, ''))) emit(text, params, tok, ctx, prevTerm, [tok]);
  }

  function emit(text, params, tok, ctx, prevTerm, gtoks) {
    // 找 key：groupPrev 是 ':' 時，其前一個 id/str 就是 key
    let key = '';
    if (prevTerm && prevTerm.v === ':') {
      const pi = idx.get(prevTerm);
      const kt = all[pi - 1];
      if (kt && (kt.t === 'id' || kt.t === 'str')) key = kt.v;
    }
    const gi = idx.get(gtoks[0]);
    // 前一個非終止符的 token（用來判斷 === / includes）
    out.push({
      text, params, line: tok.line, fn: fnAt[gi >= 0 ? gi : 0] || '', top: topAt[gi >= 0 ? gi : 0] || '', callee: ctx.callee || '', objOf: ctx.objOf || '', key,
      prev: prevTerm ? prevTerm.v : '', isArr: !!ctx.arrayOf,
    });
  }

  processSeq(all, { callee: '' });
  return out;
}

module.exports = { extract, tokenize, CJK };
