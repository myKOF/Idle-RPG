'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
/* 只讀 header.player；Worker 原子扣件。選取與昇華演出為本機暫態。 */
var _relicUiSig = '', _relicUiBound = false, _relicUiSelected = 0;
var _relicUiBusy = {}, _relicCelebrationTimer = 0, _relicCelebrationReturn = 0;
function relicUiPlayer() {
  var h = typeof peekUiPanelData === 'function' ? peekUiPanelData('header') : null;
  return (h && h.player) || null;
}
function relicUiPending(id) {
  return !!_relicUiBusy[id] || (typeof isUiCommandPending === 'function' && isUiCommandPending(nodePendingKey('relic:' + id)));
}
function relicUiEsc(s) { return esc(String(s)); }
function relicIconPath(id) { return 'images/relics/relic-' + String(id).padStart(2, '0') + '.webp?v=20261109-v1'; }
function relicIconHTML(relic) {
  return '<span class="rl-icon"><img src="' + relicIconPath(relic.id) + '" alt="" width="256" height="256" draggable="false"></span>';
}
function relicTooltipDesc(relic, store) {
  var cur = relicEntry(relic.id, store), max = relicMaxLevel(relic);
  var html = relicUiEsc(cur.lv ? relicDescAt(relic, cur.lv) : STR(2473, relicDescAt(relic, 1)));
  if (cur.lv && cur.lv < max) html += '<hr><span class="rl-tip-next">' + relicUiEsc(STR(2461, relicDescAt(relic, cur.lv + 1))) + '</span>';
  if (!cur.lv) html += '<hr>' + relicUiEsc(STR(2481));
  return html;
}
function relicTooltipHTML(relic, store) {
  return '<div class="skt-name">' + relicUiEsc(relic.name) + '</div><div class="skt-desc">' + relicTooltipDesc(relic, store) + '</div>';
}
function relicShowTooltip(anchor) {
  var relic = RELIC_BY_ID[Number(anchor.getAttribute('data-relic-select'))];
  if (!relic) return;
  var p = relicUiPlayer();
  showSkillTooltipHTML($id('sk-tooltip'), relicTooltipHTML(relic, (p && p.relics) || {}), anchor);
}
function relicCardHTML(relic, store) {
  var cur = relicEntry(relic.id, store), max = relicMaxLevel(relic), selected = _relicUiSelected === relic.id;
  var owned = cur.lv > 0, maxed = cur.lv >= max, cost = relicNextCost(relic.id, store);
  var pending = relicUiPending(relic.id), ready = owned && !maxed && cur.n >= cost;
  var cls = 'rl-card' + (owned ? ' is-owned' : ' is-locked') + (maxed ? ' is-max' : '') + (ready ? ' is-ready' : '') + (selected ? ' is-selected' : '');
  var h = '<article class="' + cls + '" data-relic-id="' + relic.id + '">';
  h += '<button type="button" class="rl-select" data-relic-select="' + relic.id + '" aria-expanded="' + selected + '" aria-controls="rl-actions-' + relic.id + '" data-tt-title="' + relicUiEsc(relicUiEsc(relic.name)) + '" data-tt-desc="' + relicUiEsc(relicTooltipDesc(relic, store)) + '">';
  h += relicIconHTML(relic) + '<span class="rl-name">' + relicUiEsc(relic.name) + '</span>';
  h += '<span class="rl-lv">' + relicUiEsc(owned ? STR(2463, cur.lv, max) : STR(2476, max)) + '</span></button>';
  h += '<div class="rl-actions" id="rl-actions-' + relic.id + '"' + (selected ? '' : ' hidden') + '>';
  if (owned && !maxed) {
    h += '<button type="button" class="btn rl-up" data-relic-up="' + relic.id + '"' + (ready && !pending ? '' : ' disabled') + '>' + STR(2459) + '</button>';
    h += '<span class="rl-requirement' + (ready ? ' is-enough' : '') + '">' + relicUiEsc(STR(2475, cur.n, cost)) + '</span>';
  } else {
    h += '<button type="button" class="btn rl-up" disabled>' + STR(maxed ? 2460 : 2459) + '</button>';
    h += '<span class="rl-requirement">' + relicUiEsc(maxed ? STR(2474, cur.n) : STR(2481)) + '</span>';
  }
  return h + '</div></article>';
}
function renderRelics(force) {
  var list = $id('relic-list');
  if (!list || typeof RELICS === 'undefined') return;
  bindRelicUi();
  var p = relicUiPlayer(), store = (p && p.relics) || {}, until = Number(p && p.relicReturnUntil) || 0;
  var buffMin = until > Date.now() ? Math.ceil((until - Date.now()) / 60000) : 0;
  var sig = JSON.stringify(store) + '|' + buffMin + '|' + _relicUiSelected + '|' + RELICS.filter(function (r) { return relicUiPending(r.id); }).map(function (r) { return r.id; }).join(',');
  if (!force && sig === _relicUiSig) return;
  _relicUiSig = sig;
  var owned = 0, sum = 0, max = 0;
  RELICS.forEach(function (r) { var lv = relicLevel(r.id, store); if (lv) owned++; sum += lv; max += relicMaxLevel(r); });
  $id('relic-owned').textContent = owned + '/' + RELICS.length;
  $id('relic-levels').textContent = sum + '/' + max;
  var buff = $id('relic-buff');
  if (buff) { buff.hidden = !buffMin; buff.textContent = buffMin ? STR(2472, buffMin) : ''; }
  var focus = document.activeElement, focusId = focus && (focus.getAttribute('data-relic-select') || focus.getAttribute('data-relic-up'));
  var focusKind = focus && focus.hasAttribute('data-relic-up') ? 'up' : 'select';
  var tipAnchor = UI.tooltipAnchor, tipId = tipAnchor && tipAnchor.getAttribute('data-relic-select');
  if (tipId) hideTooltip();
  list.innerHTML = '<div class="rl-grid">' + RELICS.map(function (r) { return relicCardHTML(r, store); }).join('') + '</div>';
  if (focusId) {
    var restore = list.querySelector('[data-relic-' + focusKind + '="' + focusId + '"]');
    if (!restore || restore.disabled) restore = list.querySelector('[data-relic-select="' + focusId + '"]');
    if (restore) restore.focus({ preventScroll: true });
  }
  if (tipId) {
    var anchor = list.querySelector('[data-relic-select="' + tipId + '"]');
    if (anchor && anchor.matches(':hover')) relicShowTooltip(anchor);
  }
}
function relicCloseCelebration() {
  clearTimeout(_relicCelebrationTimer);
  var el = $id('relic-celebration');
  if (!el || el.hidden) return;
  el.hidden = true;
  var anchor = $id('relic-list').querySelector('[data-relic-select="' + _relicCelebrationReturn + '"]');
  if (anchor && UI.tab === 'relics') anchor.focus({ preventScroll: true });
}
function relicCelebrate(relic, before) {
  if (UI.tab !== 'relics' || document.hidden) return;
  hideTooltip();
  var overlay = $id('relic-celebration');
  if (!overlay) {
    overlay = document.createElement('div'); overlay.id = 'relic-celebration'; overlay.className = 'rl-celebration'; overlay.hidden = true;
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'rl-celebration-title');
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay || e.target.closest('[data-relic-dismiss]')) relicCloseCelebration(); });
    overlay.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); relicCloseCelebration(); } if (e.key === 'Tab') { e.preventDefault(); overlay.querySelector('button').focus(); } });
  }
  clearTimeout(_relicCelebrationTimer); _relicCelebrationReturn = relic.id;
  overlay.innerHTML = '<div class="rl-ascension"><span class="rl-ascension-title" id="rl-celebration-title">' + STR(2477) + '</span>' +
    '<div class="rl-ascension-art"><span class="rl-halo"></span><span class="rl-orbit"></span><span class="rl-rays"></span>' + relicIconHTML(relic) + '</div>' +
    '<h3>' + relicUiEsc(relic.name) + '</h3><div class="rl-level-rise">' + relicUiEsc(STR(2478, before, before + 1)) + '</div>' +
    '<div class="rl-effect-before">' + relicUiEsc(STR(2479, relicDescAt(relic, before))) + '</div>' +
    '<div class="rl-effect-after">' + relicUiEsc(STR(2480, relicDescAt(relic, before + 1))) + '</div>' +
    '<button type="button" class="btn" data-relic-dismiss>' + STR(155) + '</button></div>';
  overlay.hidden = false;
  overlay.querySelector('button').focus({ preventScroll: true });
  _relicCelebrationTimer = setTimeout(relicCloseCelebration, 4500);
}
function bindRelicUi() {
  if (_relicUiBound) return;
  var list = $id('relic-list'); if (!list) return;
  _relicUiBound = true;
  list.addEventListener('click', function (e) {
    var up = e.target.closest('[data-relic-up]');
    if (up) {
      var id = Number(up.getAttribute('data-relic-up')), relic = RELIC_BY_ID[id];
      if (!relic || up.disabled || relicUiPending(id)) return;
      var p = relicUiPlayer(), before = relicLevel(id, (p && p.relics) || {});
      _relicUiBusy[id] = true;
      var action = sendGemUiCommand('relic.upgrade', { relicId: id }, 'relic:' + id, ['header', 'inv', 'tower'], function () {
        if (typeof UISound !== 'undefined') UISound.relicUpgraded();
        relicCelebrate(relic, before);
      });
      renderRelics(true);
      Promise.resolve(action).finally(function () { delete _relicUiBusy[id]; renderRelics(true); });
      return;
    }
    var select = e.target.closest('[data-relic-select]');
    if (select) { var selected = Number(select.getAttribute('data-relic-select')); _relicUiSelected = selected === _relicUiSelected ? 0 : selected; renderRelics(true); }
  });
  // 滑鼠沿用 ui.js 的 data-tt-* 委派；避免通用按鈕分支將自訂 pointerover 提示收起。
  list.addEventListener('focusin', function (e) { if (e.target.matches('[data-relic-select]')) relicShowTooltip(e.target); });
  list.addEventListener('focusout', function (e) { if (e.target.matches('[data-relic-select]')) hideTooltip(); });
  list.addEventListener('scroll', function () { if (UI.tooltipAnchor && UI.tooltipAnchor.hasAttribute('data-relic-select')) hideTooltip(); }, { passive: true });
}
