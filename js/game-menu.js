'use strict';
/* Esc選單只負責介面與導覽；完整進度由Worker產生，寫入成功才允許離開。 */
var GameMenu = (function () {
  var bound = false, busy = false, previousFocus = null;
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
    if (!visible('game-menu') && !visible('settings-modal')) previousFocus = document.activeElement;
    show('settings-modal', false);
    show('game-menu', true);
    status('');
    var first = el('game-menu-reload'); if (first) first.focus();
  }
  function close() {
    if (busy) return;
    show('game-menu', false); show('settings-modal', false);
    if (previousFocus && typeof previousFocus.focus === 'function' && previousFocus.isConnected !== false) previousFocus.focus();
  }
  function openSettings() {
    if (busy) return;
    if (!visible('game-menu') && !visible('settings-modal')) previousFocus = document.activeElement;
    show('game-menu', false); show('settings-modal', true);
    if (typeof refreshSettingsPanel === 'function') refreshSettingsPanel();
    var button = el('settings-modal-close'); if (button) button.focus();
  }
  function closeSettings() { if (!busy) open(); }
  function handleEscape() {
    if (busy) return true;
    if (visible('settings-modal')) closeSettings();
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
    if (action === 'reload') { location.reload(); return Promise.resolve(true); }
    if (action !== 'save' && action !== 'exit') return Promise.resolve(false);
    setBusy(true); status('正在儲存…');
    return Promise.resolve().then(function () { return WorkerBridge.saveAutoNow(); }).then(function () {
      status('已儲存至自動存檔');
      if (typeof renderSaveList === 'function') renderSaveList();
      if (action === 'exit') { finishExit(); return true; }
      setBusy(false);
      var button = el('game-menu-save'); if (button) button.focus();
      return true;
    }).catch(function (error) {
      setBusy(false); status('存檔失敗：' + (error && error.message ? error.message : String(error)));
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
      var modal = visible('settings-modal') ? el('settings-modal') : visible('game-menu') ? el('game-menu') : null;
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
    handleEscape: handleEscape, runAction: runAction, isSettingsOpen: function () { return visible('settings-modal'); } };
})();
