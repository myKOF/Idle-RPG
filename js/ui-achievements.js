'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
/* ============ 成就頁（Esc 菜單 → 成就）— 主執行緒 UI ============
   定義表 ACHIEVEMENTS（名稱、圖示、條件文字）兩端共載（js/achievement_data.js）；
   本檔只讀 achv 面板快照（{ list: [{ id, at, prog, goal }], got }）畫畫面，不碰 G。
   進入／離開由 GameMenu 控制（成就頁與設置頁同級：開著時遊戲維持暫停，返回回到菜單）。
   解鎖時 Worker 送 notice 事件 achievementUnlocked → onUnlocked 在畫面上方浮出提示。 */
var ACH_ICON_VER = '1';

var AchievementUI = (function () {
  var filter = 'all', timer = null, toastQueue = [], toastShowing = false;

  function el(id) { return document.getElementById(id); }
  function byId() {
    var m = {};
    if (typeof ACHIEVEMENTS !== 'undefined') for (var i = 0; i < ACHIEVEMENTS.length; i++) m[ACHIEVEMENTS[i].id] = ACHIEVEMENTS[i];
    return m;
  }
  function iconHtml(def, cls) {
    return '<img class="' + cls + '" src="images/achievements/' + esc(def.icon) + '.png?v=' + ACH_ICON_VER +
      '" alt="" draggable="false" onerror="this.style.visibility=\'hidden\'">';
  }
  function dateText(at) {
    var d = new Date(at);
    return isNaN(d.getTime()) ? '' : d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }
  function pctOf(prog, goal) { return goal > 0 ? Math.max(0, Math.min(100, prog / goal * 100)) : 0; }

  function render() {
    var list = el('achv-list');
    if (!list || typeof ACHIEVEMENTS === 'undefined') return;
    var snap = (typeof peekUiPanelData === 'function') ? peekUiPanelData('achv') : null;
    var state = {};
    ((snap && snap.list) || []).forEach(function (s) { state[s.id] = s; });
    var got = snap ? snap.got : 0, html = '';
    for (var i = 0; i < ACHIEVEMENTS.length; i++) {
      var def = ACHIEVEMENTS[i], st = state[def.id] || { at: 0, prog: 0, goal: def.count };
      var done = !!st.at;
      if (filter === 'done' && !done) continue;
      if (filter === 'todo' && done) continue;
      var foot = done
        ? '<span class="achv-date">' + esc(STR(2233, dateText(st.at))) + '</span>'
        : '<span class="achv-bar"><i style="width:' + pctOf(st.prog, st.goal).toFixed(1) + '%"></i></span>' +
          '<span class="achv-prog">' + esc(STR(2236, fmt(st.prog), fmt(st.goal))) + '</span>';
      html += '<div class="achv-card ' + (done ? 'done' : 'todo') + '">' +
        '<div class="achv-icon">' + iconHtml(def, 'achv-img') + '</div>' +
        '<div class="achv-body"><div class="achv-name">' + esc(def.name) + '</div>' +
        '<div class="achv-desc">' + esc(def.desc) + '</div>' +
        '<div class="achv-foot">' + foot + '</div></div></div>';
    }
    setHtmlIfChanged(list, html);
    var sum = el('achv-summary');
    if (sum) {
      var total = ACHIEVEMENTS.length;
      sum.textContent = STR(2229, got, total);
      var bar = el('achv-total-bar');
      if (bar) bar.style.width = pctOf(got, total).toFixed(1) + '%';
    }
    ['all', 'done', 'todo'].forEach(function (k) {
      var b = el('achv-filter-' + k);
      if (b) b.classList.toggle('on', k === filter);
    });
  }

  function open() {
    var modal = el('achv-modal');
    if (!modal) return;
    UI.achvPanelOpen = true;
    if (typeof refreshUiPanelSubscriptions === 'function') refreshUiPanelSubscriptions();
    requestPanelData('achv', true);
    render();
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    // 遊戲暫停中也要看得到進度：開著期間每秒向 Worker 索取一次快照（狀態型進度沒有髒區訊號）
    if (timer) clearInterval(timer);
    timer = setInterval(function () { requestPanelData('achv', true); }, 1000);
    var btn = el('achv-modal-close'); if (btn) btn.focus();
  }
  function close() {
    var modal = el('achv-modal');
    if (modal) { modal.style.display = 'none'; modal.setAttribute('aria-hidden', 'true'); }
    if (timer) { clearInterval(timer); timer = null; }
    if (UI.achvPanelOpen) {
      UI.achvPanelOpen = false;
      if (typeof refreshUiPanelSubscriptions === 'function') refreshUiPanelSubscriptions();
    }
  }
  function isOpen() { var m = el('achv-modal'); return !!m && m.style.display !== 'none'; }
  function setFilter(key) { filter = key; render(); }

  /* ---- 解鎖提示：排隊逐則浮出，每則 3.6 秒 ---- */
  function nextToast() {
    var host = el('achv-toast');
    if (!host || !toastQueue.length) { toastShowing = false; return; }
    toastShowing = true;
    var def = toastQueue.shift();
    var node = document.createElement('div');
    node.className = 'achv-toast-item';
    node.innerHTML = iconHtml(def, 'achv-toast-img') + '<div><div class="achv-toast-head">' + esc(STR(2235)) +
      '</div><div class="achv-toast-name">' + esc(def.name) + '</div></div>';
    host.appendChild(node);
    setTimeout(function () {
      node.classList.add('out');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); nextToast(); }, 400);
    }, 3600);
  }
  function onUnlocked(data) {
    var def = byId()[data && data.id];
    if (!def) return;
    if (toastQueue.length < 8) toastQueue.push(def);
    if (!toastShowing) nextToast();
    if (isOpen()) requestPanelData('achv', true);
  }

  function init() {
    var modal = el('achv-modal');
    if (!modal || modal.getAttribute('data-bound')) return;
    modal.setAttribute('data-bound', '1');
    ['all', 'done', 'todo'].forEach(function (k) {
      var b = el('achv-filter-' + k);
      if (b) b.addEventListener('click', function () { setFilter(k); });
    });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }

  return { open: open, close: close, isOpen: isOpen, render: render, onUnlocked: onUnlocked, setFilter: setFilter, init: init };
})();
