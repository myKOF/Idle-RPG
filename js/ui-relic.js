'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
/* ============ 遺物頁 — 主執行緒 UI（2026-11-09） ============
   資料表 js/relic_data.js、等級與數值換算 js/relic.js（兩端共載）。
   本檔只讀 header 面板（player.relics／player.relicReturnUntil 隨 header.player 投影）並送 relic.upgrade，不碰 G。

   版面：頁首三顆膠囊（已收集、總等級、晨鐘加成剩餘）＋依分類分組的遺物卡。
   卡片：名稱、等級（未取得顯示「未取得」）、10 格等級點、目前效果（未取得顯示第 1 級預覽）、下一級效果、件數進度與升級按鈕。
   header 面板每拍都會更新（金幣在變），所以只在遺物資料或等待狀態真的變了才重畫（_relicUiSig）。 */

var _relicUiSig = '';
var _relicUiBound = false;

function relicUiPlayer() {
  var h = (typeof peekUiPanelData === 'function') ? peekUiPanelData('header') : null;
  return (h && h.player) || null;
}
function relicUiPending(id) {
  return typeof isUiCommandPending === 'function' && isUiCommandPending(nodePendingKey('relic:' + id));
}
function relicUiEsc(s) { return (typeof esc === 'function') ? esc(s) : String(s); }

function relicCardHTML(relic, store) {
  var cur = relicEntry(relic.id, store), max = relicMaxLevel(relic);
  var owned = cur.lv > 0, maxed = cur.lv >= max;
  var cost = owned && !maxed ? relic.levels[cur.lv].cost : 0;
  var pending = relicUiPending(relic.id);
  var cls = 'rl-card' + (owned ? ' is-owned' : ' is-locked') + (maxed ? ' is-max' : '') + (owned && !maxed && cur.n >= cost ? ' is-ready' : '');
  var pips = '';
  for (var i = 1; i <= max; i++) pips += '<i class="rl-pip' + (i <= cur.lv ? ' on' : '') + '"></i>';
  var h = '<div class="' + cls + '" data-relic-id="' + relic.id + '">';
  h += '<div class="rl-head"><span class="rl-name">' + relicUiEsc(relic.name) + '</span>' +
    '<span class="rl-lv">' + (owned ? STR(2463, cur.lv, max) : STR(2458)) + '</span></div>';
  h += '<div class="rl-pips">' + pips + '</div>';
  h += owned
    ? '<div class="rl-eff">' + relicUiEsc(relicDescAt(relic, cur.lv)) + '</div>'
    : '<div class="rl-eff is-preview">' + relicUiEsc(STR(2473, relicDescAt(relic, 1))) + '</div>';
  if (owned && !maxed) h += '<div class="rl-next">' + relicUiEsc(STR(2461, relicDescAt(relic, cur.lv + 1))) + '</div>';
  h += '<div class="rl-foot">';
  if (owned && !maxed) {
    var pct = Math.max(0, Math.min(100, cur.n / cost * 100));
    h += '<div class="rl-prog"><span class="rl-prog-fill" style="width:' + pct.toFixed(1) + '%"></span>' +
      '<span class="rl-prog-text">' + STR(2462, cur.n, cost) + '</span></div>';
    h += '<button type="button" class="btn rl-up" data-relic-up="' + relic.id + '"' + (cur.n >= cost && !pending ? '' : ' disabled') + '>' + STR(2459) + '</button>';
  } else if (maxed) {
    h += '<span class="rl-count">' + (cur.n > 0 ? STR(2474, cur.n) : '') + '</span><span class="rl-max">' + STR(2460) + '</span>';
  }
  h += '</div></div>';
  return h;
}

function renderRelics(force) {
  var list = $id('relic-list');
  if (!list || typeof RELICS === 'undefined') return;
  bindRelicUi();
  var p = relicUiPlayer();
  var store = (p && p.relics) || {};
  var until = Number(p && p.relicReturnUntil) || 0;
  var buffMin = until > Date.now() ? Math.ceil((until - Date.now()) / 60000) : 0;
  var pendingIds = RELICS.filter(function (r) { return relicUiPending(r.id); }).map(function (r) { return r.id; });
  var sig = JSON.stringify(store) + '|' + buffMin + '|' + pendingIds.join(',');
  if (!force && sig === _relicUiSig) return;
  _relicUiSig = sig;

  var ownedCount = 0, lvSum = 0, lvMax = 0;
  RELICS.forEach(function (r) {
    var lv = relicLevel(r.id, store);
    if (lv > 0) ownedCount++;
    lvSum += lv; lvMax += relicMaxLevel(r);
  });
  $id('relic-owned').textContent = ownedCount + '/' + RELICS.length;
  $id('relic-levels').textContent = lvSum + '/' + lvMax;
  var buffEl = $id('relic-buff');
  if (buffEl) {
    buffEl.hidden = !buffMin;
    buffEl.textContent = buffMin ? STR(2472, buffMin) : '';
  }

  var html = '';
  relicCategories().forEach(function (cat) {
    html += '<section class="rl-cat"><h3 class="rl-cat-title">' + relicUiEsc(cat.name) + '</h3><div class="rl-grid">';
    cat.list.forEach(function (r) { html += relicCardHTML(r, store); });
    html += '</div></section>';
  });
  list.innerHTML = html;
}

function bindRelicUi() {
  if (_relicUiBound) return;
  var list = $id('relic-list');
  if (!list) return;
  _relicUiBound = true;
  list.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-relic-up]') : null;
    if (!btn || btn.disabled) return;
    var id = Number(btn.getAttribute('data-relic-up'));
    if (!RELIC_BY_ID[id]) return;
    btn.disabled = true;
    sendGemUiCommand('relic.upgrade', { relicId: id }, 'relic:' + id, ['header', 'inv', 'tower']);
    renderRelics(true);
  });
}
