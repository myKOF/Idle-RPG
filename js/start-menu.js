'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網

/* 開場與開始選單只讀存檔。玩家選好本局後，才交給 Worker 遷移、結算與寫入。 */
var StartMenu = (function () {
  var active = true, ready = false, busy = false, modes = false;
  var startGame, bootSave = null, bootInfo = {}, folderAuto = null;
  var returnFocus = null, folderCheck = 0, backdrop = null;

  function el(id) { return document.getElementById(id); }
  function button(name) { return el('start-menu-' + name); }
  function showMenu(value) {
    el('start-menu').style.display = value ? 'flex' : 'none';
    el('start-menu').setAttribute('aria-hidden', value ? 'false' : 'true');
  }
  function setStatus(id) {
    var node = el('start-menu-status');
    node.hidden = !id;
    node.textContent = id ? STR(id) : '';
  }
  function setBusy(value) {
    busy = value;
    el('start-menu').inert = value;
    el('settings-modal').inert = value;
  }
  function showModes(value) {
    modes = value;
    el('start-menu-actions').hidden = value;
    el('start-menu-modes').hidden = !value;
    button('mode').setAttribute('aria-expanded', String(value));
    (value ? button('hard') : button('mode')).focus();
  }
  function trustedSave() {
    return bootInfo.source === 'legacy' || bootInfo.source === 'foreign' ? bootInfo.fallback : bootSave;
  }
  function autoRecord() {
    if (folderAuto) return folderAuto;
    var save = trustedSave();
    if (!save) return null;
    return {
      id: 'auto_current', kind: 'auto', runId: save.runId || 1,
      fname: AUTO_FOLDER_FILE_V2, savedAt: save.savedAt || 0,
      level: save.player && save.player.level || 1,
      stage: save.stage && save.stage.current || 1,
      zone: save.stage && save.stage.zone || 'desert'
    };
  }
  function updateFolderAvailability() {
    var check = ++folderCheck;
    Promise.resolve(bootInfo.manualScan).then(listSaveFolderFilesV2).then(function (files) {
      if (!active || check !== folderCheck) return;
      var names = new Set(files.map(function (file) { return file.name; }));
      folderAuto = bootInfo.folderAuto && names.has(bootInfo.folderAuto.fname) ? bootInfo.folderAuto : null;
      button('load').disabled = !folderAuto && !saveIndexV2().some(function (rec) {
        return rec.folderOnly && names.has(rec.fname);
      });
    }).catch(function () {
      if (!active || check !== folderCheck) return;
      folderAuto = null;
      button('load').disabled = true;
    });
  }
  function show() {
    if (!active || !ready || busy) return;
    button('continue').hidden = !bootSave;
    showMenu(true);
    updateFolderAvailability();
    var focus = returnFocus;
    returnFocus = null;
    if (!focus || focus.disabled || focus.hidden) focus = button(bootSave ? 'continue' : 'new');
    focus.focus();
  }
  function begin(save, maxRunId) {
    if (!startGame(save, maxRunId)) {
      setBusy(false);
      setStatus(2430);
      return false;
    }
    active = false;
    setBusy(false);
    showMenu(false);
    if (backdrop) {
      backdrop.destroy();
      backdrop = null;
    }
    var settings = el('settings-modal');
    settings.style.display = 'none';
    settings.setAttribute('aria-hidden', 'true');
    el('btn-save').disabled = false;
    el('btn-export-save').disabled = false;
    bootSave = null;
    bootInfo = {};
    folderAuto = null;
    return true;
  }
  function continueGame() {
    if (busy || !bootSave) return;
    setBusy(true);
    SaveStorage.readBootSave(function (save, info) {
      bootSave = save;
      bootInfo = info;
      SaveOrigin.gate(save, info, function (approved) {
        if (approved && begin(approved, SaveStorage.maxRunId())) return;
        bootSave = approved;
        if (!approved) setStatus(2432);
        setBusy(false);
        show();
      });
    });
  }
  function newGame() {
    var start = function () {
      setBusy(true);
      var hasPriorRun = bootSave || saveIndexV2().length;
      var maxRunId = Math.max(SaveStorage.maxRunId(), Number(bootSave && bootSave.runId) || 1);
      begin(null, maxRunId + (hasPriorRun ? 1 : 0));
    };
    if (bootSave) showConfirmDialog(STR(2429), start, { title: STR(2422), okText: STR(2422), danger: true });
    else start();
  }
  function loadRecord(rec) {
    if (!active || busy) return Promise.resolve(null);
    setBusy(true);
    return Promise.resolve().then(function () {
      if (rec === folderAuto) {
        return readFolderAutoFileV2(rec.fname).then(function (file) { return file && file.data; });
      }
      if (rec.kind === 'auto') return trustedSave();
      return readSaveRawV2(rec).then(parseSaveTextV2);
    }).then(function (save) {
      if (!save) throw new Error(STR(2432));
      if (!begin(save, SaveStorage.maxRunId())) throw new Error(STR(2430));
      return null;
    }).finally(function () { setBusy(false); });
  }
  function openPanel(name, open) {
    returnFocus = button(name);
    showMenu(false);
    open();
  }
  function init(start) {
    startGame = start;
    el('btn-save').disabled = true;
    el('btn-export-save').disabled = true;
    button('continue').addEventListener('click', continueGame);
    button('new').addEventListener('click', newGame);
    button('mode').addEventListener('click', function () { showModes(true); });
    button('hard').addEventListener('click', function () { showModes(false); });
    button('back').addEventListener('click', function () { showModes(false); });
    button('load').addEventListener('click', function () {
      openPanel('load', function () { GameMenu.openSettings('save'); });
    });
    button('achv').addEventListener('click', function () {
      var save = trustedSave();
      openPanel('achv', function () { GameMenu.openAchievements(save && save.achv && save.achv.got || {}); });
    });
    button('settings').addEventListener('click', function () { openPanel('settings', GameMenu.openSettings); });
    button('exit').addEventListener('click', function () { location.reload(); });

    var deterministic = WorkerBridge.isDeterministicTest();
    function prepare(save, info) {
      bootSave = save;
      bootInfo = info;
      folderAuto = info.folderAuto;
      if (info.resume && begin(save, SaveStorage.maxRunId())) return;
      function reveal() {
        ready = true;
        if (deterministic && begin(null, 1)) return;
        show();
        hideLoadingScreen();
      }
      if (typeof IntroPlayer !== 'undefined') {
        try {
          if (IntroPlayer.startupBegin({ hasSave: !!save })) {
            IntroPlayer.release();
            IntroPlayer.whenIdle(reveal);
            return;
          }
        } catch (error) { console.error('[intro] 起播失敗', error); }
      }
      reveal();
    }
    if (deterministic) prepare(null, {});
    else {
      if (typeof StartMenuBackground !== 'undefined') backdrop = StartMenuBackground.mount(el('start-menu'));
      SaveStorage.readBootSave(prepare, true);
    }
  }

  return {
    init: init, show: show, autoRecord: autoRecord, loadRecord: loadRecord,
    isActive: function () { return active; },
    isBusy: function () { return busy; },
    handleEscape: function () { if (modes) showModes(false); }
  };
})();
