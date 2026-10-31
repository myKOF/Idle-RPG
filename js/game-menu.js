'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
/* Esc暫停整體Worker與演出，設定返回仍保持暫停；存檔成功才允許離開。 */
var GameMenu = (function () {
  var bound = false, busy = false, previousFocus = null;
  var gamePaused = false;
  function pauseGame(value) {
    if (value === gamePaused) return;
    gamePaused = value;
    if (!value && document.body && document.body.classList) document.body.classList.remove('game-menu-paused');
    if (typeof GameClock !== 'undefined') GameClock.setPaused(value);
    if (typeof WorkerBridge !== 'undefined' && WorkerBridge.setMenuPaused) WorkerBridge.setMenuPaused(value);
    if (value && document.body && document.body.classList) document.body.classList.add('game-menu-paused');
  }
  function el(id) { return document.getElementById(id); }
  function visible(id) { var node = el(id); return !!node && node.style.display !== 'none'; }
  function show(id, value) {
    var node = el(id);
    if (!node) return;
    node.style.display = value ? 'flex' : 'none';
    node.setAttribute('aria-hidden', value ? 'false' : 'true');
  }
  function status(text) { var node = el('game-menu-status'); if (node) node.textContent = text; }
  function setBusy(value) {
    busy = value;
    var menu = el('game-menu');
    if (menu) {
      menu.setAttribute('aria-busy', value ? 'true' : 'false');
      menu.querySelectorAll('button').forEach(function (button) { button.disabled = value; });
    }
  }
  function open() {
    if (busy) return;
    pauseGame(true);
    if (!visible('game-menu') && !visible('settings-modal')) previousFocus = document.activeElement;
    show('settings-modal', false); closeAchievementsView();
    show('game-menu', true);
    status('');
    var title = el('game-menu-title'); if (title) { title.setAttribute('tabindex', '-1'); title.focus(); }
  }
  function close() {
    if (busy) return;
    show('game-menu', false); show('settings-modal', false); closeAchievementsView();
    pauseGame(false);
    if (previousFocus && typeof previousFocus.focus === 'function' && previousFocus.isConnected !== false) previousFocus.focus();
  }
  function openSettings() {
    if (busy) return;
    pauseGame(true);
    if (!visible('game-menu') && !visible('settings-modal')) previousFocus = document.activeElement;
    show('game-menu', false); show('settings-modal', true);
    if (typeof refreshSettingsPanel === 'function') refreshSettingsPanel();
    var button = el('settings-modal-close'); if (button) button.focus();
  }
  function closeSettings() { if (!busy) open(); }
  // 成就頁與設置頁同級：開著時遊戲維持暫停，返回回到菜單
  function achievementsVisible() { return typeof AchievementUI !== 'undefined' && AchievementUI.isOpen(); }
  function closeAchievementsView() { if (achievementsVisible()) AchievementUI.close(); }
  function openAchievements() {
    if (busy || typeof AchievementUI === 'undefined') return;
    pauseGame(true);
    if (!visible('game-menu') && !visible('settings-modal') && !achievementsVisible()) previousFocus = document.activeElement;
    show('game-menu', false); show('settings-modal', false);
    AchievementUI.open();
  }
  function closeAchievements() { if (!busy) open(); }
  function handleEscape() {
    if (busy) return true;
    if (achievementsVisible()) closeAchievements();
    else if (visible('settings-modal')) closeSettings();
    else if (visible('game-menu')) close();
    else open();
    return true;
  }
  function finishExit() {
    // 一般瀏覽器分頁可能拒絕window.close；轉空白頁確實結束遊戲及所有計時器。
    WorkerBridge.stop();
    try { window.close(); } catch (error) {}
    setTimeout(function () { if (!window.closed) location.replace('about:blank'); }, 150);
  }
  function runAction(action) {
    if (busy) return Promise.resolve(false);
    if (action === 'settings') { openSettings(); return Promise.resolve(true); }
    if (action === 'achievements') { openAchievements(); return Promise.resolve(true); }
    if (action !== 'reload' && action !== 'save' && action !== 'exit') return Promise.resolve(false);
    setBusy(true); status(STR(1941));
    return Promise.resolve().then(function () { return WorkerBridge.saveAutoNow(); }).then(function () {
      status(STR(1942));
      if (action === 'reload') { location.reload(); return true; }
      if (typeof renderSaveList === 'function') renderSaveList();
      if (action === 'exit') { finishExit(); return true; }
      setBusy(false);
      var button = el('game-menu-save'); if (button) button.focus();
      return true;
    }).catch(function (error) {
      setBusy(false); status(STR(1943, (error && error.message ? error.message : String(error))));
      var button = el('game-menu-save'); if (button) button.focus();
      return false;
    });
  }
  function init() {
    if (bound || !el('game-menu')) return;
    bound = true;
    ['reload', 'exit', 'save', 'settings'].forEach(function (action) {
      el('game-menu-' + action).addEventListener('click', function () { runAction(action); });
    });
    var achvButton = el('game-menu-achv');
    if (achvButton) achvButton.addEventListener('click', function () { runAction('achievements'); });
    var achvClose = el('achv-modal-close');
    if (achvClose) achvClose.addEventListener('click', closeAchievements);
    var achvModal = el('achv-modal');
    if (achvModal) achvModal.addEventListener('click', function (event) { if (event.target === achvModal) closeAchievements(); });
    el('game-menu-close').addEventListener('click', close);
    el('settings-modal-close').addEventListener('click', closeSettings);
    ['game-menu', 'settings-modal'].forEach(function (id) {
      el(id).addEventListener('click', function (event) {
        if (event.target === el(id)) { if (id === 'settings-modal') closeSettings(); else close(); }
      });
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Tab' || (typeof closeTopmostModalOrOverlay === 'undefined')) return;
      // 既有確認／輸入彈窗有自己的焦點處理，不能把焦點搶回設定視窗。
      var confirm = el('confirm-modal');
      if (confirm && confirm.style.display !== 'none') return;
      var modal = achievementsVisible() ? el('achv-modal') : visible('settings-modal') ? el('settings-modal') : visible('game-menu') ? el('game-menu') : null;
      if (!modal) return;
      var buttons = Array.prototype.filter.call(modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex]'), function (node) {
        return !node.disabled && node.tabIndex !== -1 && node.getClientRects().length > 0;
      });
      if (!buttons.length) { event.preventDefault(); return; }
      var index = buttons.indexOf(document.activeElement);
      var next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index + 1) % buttons.length;
      event.preventDefault(); buttons[next].focus();
    });
  }
  return { init: init, open: open, close: close, openSettings: openSettings, closeSettings: closeSettings,
    openAchievements: openAchievements, closeAchievements: closeAchievements, handleEscape: handleEscape, runAction: runAction, isSettingsOpen: function () { return visible('settings-modal'); } };
})();
