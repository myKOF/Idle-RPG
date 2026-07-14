'use strict';
/* ============ 共用工具 ============ */
var G = null;          // 全域遊戲狀態（main.js 初始化）
var GT = 0;            // 遊戲時鐘（秒，隨 tick 累加）

function rnd(a, b) { return a + Math.random() * (b - a); }
function ri(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
function chance(p) { return Math.random() * 100 < p; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

function playerEventFloatTarget(floatSel) {
  return (floatSel === 'tp-float' || floatSel === 'tb-float') ? 'tp-float' : 'pv-float';
}

function floatPlayerEvent(floatSel, text, cls) {
  if (typeof floatText !== 'function') return;
  var extra = cls ? (' ' + cls) : '';
  floatText(playerEventFloatTarget(floatSel), text, 'player-event' + extra);
}

function enemyEventFloatTarget(ent, floatSel) {
  if (ent && ent.floatSel) return ent.floatSel;
  if (floatSel === 'tb-float') return 'tb-float';
  if (floatSel && floatSel.indexOf('mv-float-') === 0) return floatSel;
  return 'mv-float-0';
}

function floatEnemyEvent(ent, floatSel, text, cls) {
  if (typeof floatText !== 'function') return;
  floatText(enemyEventFloatTarget(ent, floatSel), text, cls);
}

var _uid = 0;
function uid() { return 'i' + (Date.now().toString(36)) + (_uid++).toString(36); }

// 權重挑選：[[value, weight], ...]
function wpick(pairs) {
  var total = 0, i;
  for (i = 0; i < pairs.length; i++) total += pairs[i][1];
  var r = Math.random() * total;
  for (i = 0; i < pairs.length; i++) {
    r -= pairs[i][1];
    if (r <= 0) return pairs[i][0];
  }
  return pairs[pairs.length - 1][0];
}

// 大數字格式化
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  n = Math.floor(n);
  if (n < 0) return '-' + fmt(-n);
  if (n < 1000) return String(n);
  var units = ['k', 'M', 'B', 'T', 'Q', 'Qi', 'Sx', 'Sp', 'O', 'N', 'D', 'Ud'];
  var u = Math.floor(Math.log10(n) / 3) - 1;
  if (u < 0) u = 0;
  if (u > units.length - 1) u = units.length - 1;
  var x = n / Math.pow(1000, u + 1);
  if (x >= 100) return Math.floor(x).toString() + units[u];
  if (x >= 10) return (Math.floor(x * 10) / 10).toFixed(1) + units[u];
  return (Math.floor(x * 100) / 100).toFixed(2) + units[u];
}
// 顯示完整整數，不使用 K/M/B 等縮寫（用於資源提示）。
function fmtFull(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Math.floor(n).toLocaleString('en-US');
}
function fmt1(n) { // 保留一位小數
  if (n === null || n === undefined || isNaN(n)) return '0';
  return (Math.round(n * 10) / 10).toString();
}
function pctStr(n) { return fmt1(n) + '%'; }

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function $id(id) { return document.getElementById(id); }
