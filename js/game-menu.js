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
  function atStartMenu() { return typeof StartMenu !== 'undefined' && StartMenu.isActive(); }
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
    if (atStartMenu()) {
      show('settings-modal', false);
      closeAchievementsView();
      StartMenu.show();
      return;
    }
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
  /* ---- 設置視窗：遊戲設定／音訊／存檔 三個頁籤 ----
     自己保存的偏好（輪廓、鏡頭鎖定、音訊）在 GameSettings；其餘四項轉接各自原本的開關（見 js/game-settings.js 開頭），
     所以每次開啟都從來源重新讀一次勾選狀態，不另存一份。 */
  var SETTINGS_TABS = ['game', 'audio', 'save', 'help'];
  var SETTINGS_PANES = { game: 'settings-pane-game', audio: 'settings-pane-audio', save: 'tab-settings', help: 'settings-pane-help' };
  function selectSettingsTab(name, focusTab) {
    if (SETTINGS_TABS.indexOf(name) < 0) name = 'game';
    SETTINGS_TABS.forEach(function (key) {
      var tab = el('settings-tab-' + key), pane = el(SETTINGS_PANES[key]), on = key === name;
      if (tab) {
        tab.classList.toggle('active', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
        if (on && focusTab) tab.focus();
      }
      if (pane) pane.hidden = !on;
    });
    if (name === 'save' && typeof refreshSettingsPanel === 'function') refreshSettingsPanel();   // 存檔列表只在看得到時才讀
  }
  function checkbox(id) { return el(id); }
  function syncSettingsControls() {
    var gs = typeof GameSettings !== 'undefined' ? GameSettings : null;
    function put(id, value) { var node = checkbox(id); if (node) node.checked = !!value; }
    if (gs) {
      put('set-outline', gs.get('outline'));
      put('set-camera-lock', gs.get('cameraLock'));
      put('set-mute', gs.get('mute'));
      put('set-ally-sfx', gs.get('allyAttackSfx'));
      put('set-enemy-sfx', gs.get('enemyAttackSfx'));
      [['set-music-volume', 'musicVolume'], ['set-sfx-volume', 'sfxVolume']].forEach(function (pair) {
        var slider = el(pair[0]), value = gs.get(pair[1]);
        if (slider) slider.value = value;
        var out = el(pair[0] + '-value'); if (out) out.textContent = value + '%';
      });
    }
    // 轉接項：讀原本開關的目前狀態
    if (typeof setPerfModeEnabled === 'function' && typeof isPerfModeEnabled === 'function') put('set-reduce-fx', isPerfModeEnabled());
    if (typeof isDamageNumbersEnabled === 'function') put('set-damage-numbers', isDamageNumbersEnabled());
    var autoEquip = el('toggle-autoequip'), compare = el('toggle-compare');
    if (autoEquip) put('set-auto-equip', autoEquip.checked);
    var autoEquipSetting = el('set-auto-equip');
    if (autoEquipSetting) autoEquipSetting.disabled = atStartMenu();
    if (compare) put('set-compare-equip', compare.checked);
    syncAudioGroupState();
  }
  function syncAudioGroupState() {
    var muted = !!(el('set-mute') && el('set-mute').checked);
    var group = el('settings-audio-group');
    if (!group) return;
    group.classList.toggle('is-disabled', muted);
    group.setAttribute('aria-disabled', muted ? 'true' : 'false');
    Array.prototype.forEach.call(group.querySelectorAll('input'), function (input) { input.disabled = muted; });
  }
  function bindSettingsControls() {
    var gs = typeof GameSettings !== 'undefined' ? GameSettings : null;
    SETTINGS_TABS.forEach(function (key, index) {
      var tab = el('settings-tab-' + key);
      if (!tab) return;
      tab.addEventListener('click', function () { selectSettingsTab(key); });
      tab.addEventListener('keydown', function (event) {   // 左右鍵在頁籤間移動（WAI-ARIA tablist）
        var step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        selectSettingsTab(SETTINGS_TABS[(index + step + SETTINGS_TABS.length) % SETTINGS_TABS.length], true);
      });
    });
    function onChange(id, handler) { var node = el(id); if (node) node.addEventListener('change', function () { handler(this); }); }
    function proxy(sourceId) {   // 轉接到裝備頁原本的核取方塊：改它的 checked 再觸發它的 change，沿用既有的指令與回報
      return function (box) {
        var source = el(sourceId);
        if (!source) return;
        source.checked = box.checked;
        source.dispatchEvent(new Event('change', { bubbles: true }));
      };
    }
    if (gs) {
      onChange('set-outline', function (box) { gs.set('outline', box.checked); });
      onChange('set-camera-lock', function (box) {
        gs.set('cameraLock', box.checked);
        if (typeof BattleRenderer !== 'undefined' && BattleRenderer.setCameraLocked) BattleRenderer.setCameraLocked();
      });
      onChange('set-mute', function (box) { gs.set('mute', box.checked); syncAudioGroupState(); });
      onChange('set-ally-sfx', function (box) { gs.set('allyAttackSfx', box.checked); });
      onChange('set-enemy-sfx', function (box) { gs.set('enemyAttackSfx', box.checked); });
      [['set-music-volume', 'musicVolume'], ['set-sfx-volume', 'sfxVolume']].forEach(function (pair) {
        var slider = el(pair[0]);
        if (!slider) return;
        slider.addEventListener('input', function () {
          gs.set(pair[1], slider.value);
          var out = el(pair[0] + '-value'); if (out) out.textContent = gs.get(pair[1]) + '%';
        });
      });
    }
    onChange('set-reduce-fx', function (box) { if (typeof setPerfModeEnabled === 'function') setPerfModeEnabled(box.checked, true); });
    onChange('set-damage-numbers', function (box) { if (typeof setDamageNumbersEnabled === 'function') setDamageNumbersEnabled(box.checked, true); });
    onChange('set-auto-equip', proxy('toggle-autoequip'));
    onChange('set-compare-equip', proxy('toggle-compare'));
  }
  /* 視窗高度固定為「遊戲設定」頁籤的高度：切到較長的頁籤（存檔）時內容在視窗內捲動，視窗本身不變高。
     每次開啟與視窗縮放時重新量：先放掉舊高度、切到第一頁籤量，再切回原頁籤。 */
  function lockSettingsHeight() {
    var modal = el('settings-modal');
    var card = modal && typeof modal.querySelector === 'function' ? modal.querySelector('.system-settings-card') : null;
    if (!card || !visible('settings-modal')) return;
    var current = null;
    SETTINGS_TABS.forEach(function (key) { var tab = el('settings-tab-' + key); if (tab && tab.classList.contains('active')) current = key; });
    card.style.height = '';
    selectSettingsTab('game');
    var height = card.offsetHeight;
    if (height > 0) card.style.height = height + 'px';
    if (current && current !== 'game') selectSettingsTab(current);
  }
  function openSettings(tab) {
    if (busy) return;
    if (!atStartMenu()) pauseGame(true);
    if (!visible('game-menu') && !visible('settings-modal')) previousFocus = document.activeElement;
    show('game-menu', false); show('settings-modal', true);
    syncSettingsControls();
    selectSettingsTab(typeof tab === 'string' ? tab : 'game');
    lockSettingsHeight();
    var button = el('settings-modal-close'); if (button) button.focus();
  }
  function closeSettings() { if (!busy) open(); }
  // 成就頁與設置頁同級：開著時遊戲維持暫停，返回回到菜單
  function achievementsVisible() { return typeof AchievementUI !== 'undefined' && AchievementUI.isOpen(); }
  function closeAchievementsView() { if (achievementsVisible()) AchievementUI.close(); }
  function openAchievements(savedAchievements) {
    if (busy || typeof AchievementUI === 'undefined') return;
    if (!atStartMenu()) pauseGame(true);
    if (!visible('game-menu') && !visible('settings-modal') && !achievementsVisible()) previousFocus = document.activeElement;
    show('game-menu', false); show('settings-modal', false);
    AchievementUI.open(savedAchievements);
  }
  function closeAchievements() { if (!busy) open(); }
  function handleEscape() {
    if (busy || (atStartMenu() && StartMenu.isBusy())) return true;
    if (achievementsVisible()) closeAchievements();
    else if (visible('settings-modal')) closeSettings();
    else if (atStartMenu()) StartMenu.handleEscape();
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
    bindSettingsControls();
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', lockSettingsHeight);
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
      var confirming = confirm && confirm.style.display !== 'none';
      if (confirming && !atStartMenu()) return;
      var modal = achievementsVisible() ? el('achv-modal') : visible('settings-modal') ? el('settings-modal') :
        visible('game-menu') ? el('game-menu') : visible('start-menu') ? el('start-menu') : null;
      if (confirming) modal = confirm;
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
