'use strict';
/* ============ 共用工具 ============ */
var G = null;          // 全域遊戲狀態（main.js 初始化）
var GT = 0;            // 遊戲時鐘（秒，隨 tick 累加）

function rnd(a, b) { return a + Math.random() * (b - a); }
function ri(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
function chance(p) { return Math.random() * 100 < p; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
// 屬性上限套用：上限 cap 為 0（或負）代表「無上限」，僅保留下限 0；否則夾在 [0, cap]。
function capValue(v, cap) { return cap > 0 ? clamp(v, 0, cap) : Math.max(0, v); }

function playerEventFloatTarget(floatSel) {
  return (floatSel === 'tp-float' || floatSel === 'tb-float') ? 'tp-float' : 'pv-float';
}

function floatPlayerEvent(floatSel, text, cls, value) {
  if (typeof floatText !== 'function') return;
  var extra = cls ? (' ' + cls) : '';
  floatText(playerEventFloatTarget(floatSel), text, 'player-event' + extra, value);
}

/* 技能施放提示只傳既有 float 事件欄位，不另開一套 UI 通道。
   方向在模擬層決定，讓 DOM 與 Canvas 顯示同一個左右結果。 */
function floatPlayerSkillCast(floatSel, skill, totalDamage) {
  if (typeof floatText !== 'function' || !skill) return;
  var direction = Math.random() < 0.5 ? 'left' : 'right';
  var damage = Number(totalDamage);
  var text = (skill.emoji || '✨') + (skill.name || '');
  if (isFinite(damage) && damage > 0) text += ' ' + fmt(damage);
  floatText(playerEventFloatTarget(floatSel), text,
    'player-event skill-cast skill-cast-total skill-cast-' + direction,
    isFinite(damage) && damage > 0 ? damage : undefined);
}

function enemyEventFloatTarget(ent, floatSel) {
  if (ent && ent.floatSel) return ent.floatSel;
  if (floatSel === 'tb-float') return 'tb-float';
  if (floatSel && floatSel.indexOf('mv-float-') === 0) return floatSel;
  return 'mv-float-0';
}

/* 普攻／技能的暴擊浮字共用分類；高隨機倍率暴擊額外掛上特殊顯示標記。 */
function combatDamageFloatClass(source, result, forceCrit) {
  var isCrit = !!forceCrit || !!(result && result.crit);
  var cls = (isCrit ? 'crit ' : 'dmg ') + source;
  var threshold = (typeof CRIT_HIGH_RANDOM_MULTIPLIER === 'number')
    ? CRIT_HIGH_RANDOM_MULTIPLIER : 1.195;
  var isHighCrit = !!(result && result.highCritRandomRoll) ||
    !!(result && result.crit && result.randomDamageMultiplier >= threshold - 1e-12);
  if (isCrit && isHighCrit) {
    cls += ' crit-high-roll';
  }
  return cls;
}

/* delayMs（可選）：把浮字延後顯示，讓「數字跳出來」對齊「打到人」那一刻——
   投射物要飛、多段技一段一段打，但模擬層是一瞬間結算完的。純顯示用，不影響戰鬥結果。
   位置放在最後：floatText 的第 5、6 個參數是既有的 ent／battleSnapshot，不能佔用。 */
function floatEnemyEvent(ent, floatSel, text, cls, damageValue, delayMs) {
  if (typeof floatText !== 'function') return;
  floatText(enemyEventFloatTarget(ent, floatSel), text, cls, damageValue, ent, undefined, delayMs);
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
  var units = ['K', 'M', 'B', 'T', 'P', 'E', 'Z', 'Y', 'R', 'Q'];
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

// 為數值簡寫單位著色
function colorizeUnit(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/(\d+(?:\.\d+)?)(K|M|B|T|P|E|Z|Y|R|Q)\b/gi, function(match, num, unit) {
    var upperUnit = unit.toUpperCase();
    var cls = '';
    if (upperUnit === 'K') {
      cls = 'unit-k';
    } else if (upperUnit === 'M') {
      cls = 'unit-m';
    } else if (upperUnit === 'B') {
      cls = 'unit-b';
    } else if (upperUnit === 'T') {
      cls = 'unit-t';
    } else {
      cls = 'unit-p';
    }
    return num + '<span class="' + cls + '">' + upperUnit + '</span>';
  });
}
