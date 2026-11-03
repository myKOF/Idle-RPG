'use strict';
/* 只投影 Worker header 的未讀解鎖；已讀跟隨存檔，主端不另存一份進度。 */
var SYSTEM_UNLOCK_PENDING = Object.create(null);

function refreshSystemUnlockHints() {
  var header = uiHeaderPanelSnapshot(), snapshot = header && header.systemUnlocks;
  var available = snapshot && snapshot.available || [], seen = snapshot && snapshot.seen || [];
  var pendingTabs = Object.create(null);
  systemUnlockEntries().forEach(function (entry) {
    var unread = available.indexOf(entry.id) >= 0 && seen.indexOf(entry.id) < 0;
    if (unread) pendingTabs[entry.tab] = true;
    document.querySelectorAll(entry.selector).forEach(function (button) {
      button.classList.toggle('unlock-tab-pending', unread);
    });
  });
  document.querySelectorAll('#tabs .tab-btn').forEach(function (button) {
    button.classList.toggle('unlock-nav-pending', !!pendingTabs[button.getAttribute('data-tab')]);
  });
}

function markSystemUnlockSeen(id) {
  if (SYSTEM_UNLOCK_PENDING[id]) return;
  SYSTEM_UNLOCK_PENDING[id] = true;
  sendUiCommand('ui.markUnlockSeen', { id: id }, { silentResultError: true, keys: ['unlockSeen:' + id], panels: ['header'] })
    .catch(function () { /* 失敗時不清提示；下次點選可重試。 */ })
    .finally(function () { delete SYSTEM_UNLOCK_PENDING[id]; });
}

document.addEventListener('click', function (event) {
  if (!event.target || !event.target.closest) return;
  var header = uiHeaderPanelSnapshot(), snapshot = header && header.systemUnlocks;
  if (!snapshot) return;
  systemUnlockEntries().some(function (entry) {
    var button = event.target.closest(entry.selector);
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true' || UI.tab !== entry.tab) return false;
    if (snapshot.available.indexOf(entry.id) < 0 || snapshot.seen.indexOf(entry.id) >= 0) return false;
    markSystemUnlockSeen(entry.id);
    return true;
  });
}, true);
