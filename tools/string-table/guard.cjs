'use strict';
/* 每支用到 STR() 的 js 檔開頭都要有一行安全網：單獨載入（無頭模擬、工具腳本、單檔測試）時 STR 還沒被 js/strings.js 定義，
   沒有這行會在載入或第一次呼叫時丟 ReferenceError；有了它會回傳 [#編號]，strings.js 載入後再由真正的實作覆蓋。
   migrate.cjs 會自動補；tests/string-table.test.cjs 會檢查沒有漏。 */
const fs = require('fs');
const path = require('path');
const fsx = require('./fsx.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const MARK = 'STR 安全網';
const GUARD = "if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // " + MARK + '：單檔載入時的備援，真正的實作在 js/strings.js';

function withGuard(src) {
  if (!/\bSTR\(/.test(src) || src.includes(MARK)) return src;
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const m = /^(?:﻿)?'use strict';[ \t]*\r?\n/.exec(src);
  if (!m) return GUARD + nl + src;
  return src.slice(0, m[0].length) + GUARD + nl + src.slice(m[0].length);
}

function jsFiles() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); } else if (e.name.endsWith('.js')) out.push(p);
    }
  })(path.join(ROOT, 'js'));
  return out.filter(f => !/[\\/]strings(_data)?\.js$/.test(f));
}

function applyAll() {
  const done = [];
  for (const f of jsFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    const next = withGuard(src);
    if (next !== src) { fsx.write(f, next); done.push(path.relative(ROOT, f).split(path.sep).join('/')); }
  }
  return done;
}

module.exports = { withGuard, applyAll, jsFiles, MARK, GUARD };

if (require.main === module) {
  const done = applyAll();
  console.log('[guard] 補上安全網 ' + done.length + ' 支' + (done.length ? '：' + done.join('、') : ''));
}
