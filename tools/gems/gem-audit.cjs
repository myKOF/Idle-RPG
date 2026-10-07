#!/usr/bin/env node
'use strict';
/* 顏色撞色檢查：每種寶石渲染一張（預設第 8 階），量兩兩調色盤距離（量法見 gem-palette.cjs），列出最像的幾對。
     node tools/gems/gem-audit.cjs [--tier 8] [--top 24] [--limit 12]
   --limit：低於此值視為「太像」（預設 PALETTE_MIN_DISTANCE），有任何一對就以退出碼 1 結束。
   輸出的第二個數字是平均色 ΔE，只作參考。 */
const core = require('./gem-core.cjs');
const defs = require('./gem-defs.cjs');
const palette = require('./gem-palette.cjs');

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; }
const tier = +arg('--tier', 8), top = +arg('--top', 24), limit = +arg('--limit', palette.PALETTE_MIN_DISTANCE);

const sigs = {};
Object.keys(defs).forEach(function (k) { sigs[k] = palette.signature(core.renderGem(defs[k], tier, 1)); });
const pairs = palette.closestPairs(sigs);
console.log('第 ' + tier + ' 階，' + Object.keys(sigs).length + ' 種；最像的 ' + top + ' 對（調色盤距離 / 平均色 ΔE）：');
pairs.slice(0, top).forEach(function (p) { console.log((p.d < limit ? '✗ ' : '  ') + p.a + ' ~ ' + p.b + '  ' + p.d.toFixed(1) + ' / ' + p.m.toFixed(1)); });
const bad = pairs.filter(function (p) { return p.d < limit; });
console.log(bad.length ? '太像（<' + limit + '）：' + bad.length + ' 對' : '沒有低於 ' + limit + ' 的組合');
process.exit(bad.length ? 1 : 0);
