'use strict';
/* 使用者核准的UI及成就音效；不參與模擬／存檔。 */
var UISound = (function () {
  var ASSETS = {
    click: 'audio/ui-preview/hover-options-v5/H10.wav?v=338a16bc9ce9',
    menuHover: 'audio/ui-preview/hover-10-moon-glow.wav?v=9b2ad705476a',
    success: 'audio/ui-preview/05-success.wav?v=4821e4b49aad',
    achievement: 'audio/achievements/mixkit-game-level-completed-2059.wav?v=8da83b49ceb5'
  };
  /* 2026-11-10 使用者要求音效整體縮成 65%；選單 hover 本來就很小聲，維持原音量 */
  var LEVELS = { click: 0.65, menuHover: 1, success: 0.65, achievement: 0.65 };
  var MENU_MUSIC = 'audio/start-menu/tutti-impact.mp3?v=3b01a74c3094';
  var TOWER_MUSIC = 'audio/zones/blades-of-the-rising-sun.mp3';
  // 有提示的可操作控制項仍有點擊音，純提示不列入操作目標。
  var HELP_TARGETS = '.pg-help, .forge-info-btn, #btn-enemy-tip, #btn-boss-tip, #btn-tower-result-boss-tip';
  // 委派至document，涵蓋重繪／彈窗的新節點。
  var TARGETS = [
    'button', 'a[href]', 'input:not([type="hidden"])', 'select', 'textarea', 'summary', 'label',
    '[role="button"]', '[role="tab"]', '[role="checkbox"]', '[role="switch"]',
    '[onclick]', '[draggable="true"]', '.btn', '.tab-btn', '.eq-slot', '.item-cell[data-id]',
    '#quest-bar', '#update-banner', '#summary-modal .summary-modal-header',
    '#skill-loadout .battle-skill-slot.equipped', '.loadout-slot.filled',
    '[data-act]', '[data-affix-pool-toggle]', '[data-eqset]', '[data-eqset-rename]',
    '[data-nf-partinstall-key]', '[data-nf-partupgrade]', '[data-nf-partsopen]', '[data-nf-partun]', '[data-nf-unlockslot]',
    '[data-reroll-pick]', '[data-socket-pick]', '[data-forge-slot]', '[data-forge-gem]',
    '[data-gem-socket]', '[data-gem-socket-fused]', '[data-socket-remove]', '[data-rune-socket]',
    '[data-rune-undraft]', '[data-rune-erase]', '[data-enchant-remove]', '[data-shop-buy]', '[data-book-enchant]',
    '[data-gem-filter]', '[data-gem-lv]', '[data-gem-pick]', '[data-gem-tool-btn]',
    '[data-gconv-slot]', '[data-gconv-gem]', '[data-gdis-gem]', '[data-gres-hole]', '[data-gres-gem]',
    '[data-gres-take]', '[data-gres-upgrade]', '[data-rune-pick]', '[data-rune-goto]', '[data-word-goto]',
    '[data-rune-tier]', '[data-rune-tool-btn]', '[data-rune-act]',
    '[data-sgb-filter]', '[data-sgb-group]', '[data-sgb-tier]', '[data-sgb-ult]',
    '[data-talent-select]', '[data-talent-turn]', '[data-tower-pick]', '[data-tower-tier]',
    '[data-load-save]', '[data-del-save]', '[data-quest-claim]'
  ].join(', ');
  var context = null, initialized = false, generation = 0, gestureReceived = false;
  var buffers = {}, loading = {}, sources = {}, lastPlayed = {};
  var menuVisible = false, menuEpoch = 0, startScreenActive = false, menuMusic = null;
  var sceneTracks = [], sceneIndex = 0, sceneMusic = null, pageActive = true;
  var sceneReady = false, sceneGapUntil = 0, sceneGapTimer = 0;
  var sceneView = null, towerChallengePending = false;
  var introActive = false;
  var SCENE_TRACK_GAP_MS = 10000;

  function now() { return performance.now(); }
  function stop(kind) {
    if (!sources[kind]) return;
    try { sources[kind].stop(); } catch (_) {}
    delete sources[kind];
  }
  function stopAll() {
    generation++;
    Object.keys(sources).forEach(stop);
  }
  function setIntroActive(value) {
    if (introActive === value) return;
    introActive = value;
    if (value) stopAll();
    syncMusic();
  }
  function sfxGain() { return typeof GameSettings === 'undefined' ? 1 : GameSettings.sfxGain(); }
  function prepareMenuMusic() {
    if (menuMusic) return;
    menuMusic = new window.Audio();
    menuMusic.preload = 'auto';
    menuMusic.loop = true;
    menuMusic.src = MENU_MUSIC;
  }
  function ensureContext() {
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!context && AudioContextClass) context = new AudioContextClass();
  }
  function preloadStartMenuAudio() {
    try { prepareMenuMusic(); } catch (_) { /* 無法預載時仍可進入選單。 */ }
    try {
      ensureContext();
      load('menuHover');
    } catch (_) { /* 沒有音訊裝置時仍可操作選單。 */ }
  }
  function syncMenuMusic() {
    var volume = typeof GameSettings === 'undefined' ? .5 :
      (GameSettings.get('mute') ? 0 : GameSettings.get('musicVolume') / 100);
    var shouldPlay = !introActive && pageActive && startScreenActive && volume > 0;
    try {
      if (shouldPlay) prepareMenuMusic();
      if (!menuMusic) return;
      menuMusic.volume = volume;
      // 自動播放受限時，由下一次真實操作重試。
      if (!shouldPlay) menuMusic.pause();
      else if (menuMusic.paused) Promise.resolve(menuMusic.play()).catch(function () {});
    } catch (_) { /* 播放裝置或音檔失效時仍可操作選單。 */ }
  }
  function setStartScreenActive(value) {
    if (startScreenActive === value) return;
    startScreenActive = value;
    if (value) finishTowerChallenge(false);
    syncMusic();
  }
  function syncSceneMusic() {
    var volume = typeof GameSettings === 'undefined' ? .5 :
      (GameSettings.get('mute') ? 0 : GameSettings.get('musicVolume') / 100);
    var shouldPlay = !introActive && pageActive && sceneReady && !startScreenActive &&
      sceneTracks.length > 0 && Date.now() >= sceneGapUntil && volume > 0;
    try {
      if (shouldPlay && !sceneMusic) {
        sceneMusic = new window.Audio();
        sceneMusic.preload = 'auto';
        sceneMusic.loop = false;
        sceneMusic.src = sceneTracks[sceneIndex];
        var audio = sceneMusic;
        audio.onended = function () {
          // 離場或換曲後才送達的舊事件，不得重新起播或再跳一首。
          if (sceneMusic !== audio || !audio.ended) return;
          sceneIndex = (sceneIndex + 1) % sceneTracks.length;
          audio.src = sceneTracks[sceneIndex];
          audio.currentTime = 0;
          var deadline = Date.now() + SCENE_TRACK_GAP_MS;
          sceneGapUntil = deadline;
          sceneGapTimer = setTimeout(function () {
            if (sceneMusic !== audio || sceneGapUntil !== deadline) return;
            sceneGapUntil = 0;
            sceneGapTimer = 0;
            syncSceneMusic();
          }, SCENE_TRACK_GAP_MS);
          syncSceneMusic();
        };
      }
      if (!sceneMusic) return;
      sceneMusic.volume = volume;
      if (!shouldPlay) sceneMusic.pause();
      else if (sceneMusic.paused) Promise.resolve(sceneMusic.play()).catch(function () {});
    } catch (_) { /* 音檔或播放裝置失效不影響遊戲。 */ }
  }
  function syncMusic() {
    // 先停止離開的畫面，避免兩首配樂同時播放。
    if (startScreenActive) { syncSceneMusic(); syncMenuMusic(); }
    else { syncMenuMusic(); syncSceneMusic(); }
  }
  function setSceneReady(value) {
    if (sceneReady === !!value) return;
    sceneReady = !!value;
    syncSceneMusic();
  }
  function setScene(view) {
    if (!view) return;
    sceneView = view;
    if (view.towerActive) towerChallengePending = false;
    var zone = typeof ZONES !== 'undefined' && ZONES[view.zone];
    var tracks = view.towerActive || towerChallengePending ? [TOWER_MUSIC] :
      (zone ? [zone.bgm, zone.bgm2].filter(Boolean) : []);
    if (tracks.length === sceneTracks.length && tracks.every(function (track, i) { return track === sceneTracks[i]; })) return;
    sceneTracks = tracks;
    sceneIndex = 0;
    clearTimeout(sceneGapTimer);
    sceneGapTimer = 0;
    sceneGapUntil = 0;
    if (sceneMusic) {
      try { sceneMusic.pause(); sceneMusic.currentTime = 0; } catch (_) {}
      sceneMusic = null;
    }
    syncSceneMusic();
  }
  function beginTowerChallenge() {
    towerChallengePending = true;
    setScene(sceneView || {});
  }
  function finishTowerChallenge(accepted) {
    towerChallengePending = false;
    // ACK之後的權威快照接管（連挑回傳void）；拒絕／斷線則立即回復最新場景。
    if (!accepted) setScene(sceneView || {});
  }
  function setStartMenuVisible(value) {
    if (menuVisible === value) return;
    menuVisible = value;
    menuEpoch++;
    if (value && !document.hidden && context) load('menuHover');
    if (!value) stop('menuHover');
  }
  function load(kind) {
    if (buffers[kind]) return Promise.resolve(buffers[kind]);
    if (loading[kind]) return loading[kind];
    if (!context || typeof fetch !== 'function') return Promise.resolve(null);
    loading[kind] = Promise.resolve().then(function () {
      return fetch(ASSETS[kind]);
    }).then(function (response) {
      if (!response.ok) throw new Error('UI audio HTTP ' + response.status);
      return response.arrayBuffer();
    }).then(function (bytes) { return context.decodeAudioData(bytes); }).then(function (buffer) {
      buffers[kind] = buffer;
      delete loading[kind];
      return buffer;
    }).catch(function () {
      // 音訊／網路失敗不影響操作；下次互動可重試，不保留失敗Promise。
      delete loading[kind];
      return null;
    });
    return loading[kind];
  }
  function unlock(event) {
    if (!event || !event.isTrusted || document.hidden) return;
    gestureReceived = true;
    syncMusic();
    try {
      ensureContext();
      if (!context) return;
      if (context.state === 'suspended') Promise.resolve(context.resume()).catch(function () {});
      load('click');
      load('success');
      load('achievement');
      if (menuVisible) load('menuHover');
    } catch (_) { /* 沒有音訊裝置時仍可正常使用UI。 */ }
  }
  function play(kind, stillCurrent) {
    if (introActive || !ASSETS[kind] || !context || document.hidden) return;
    if (kind !== 'menuHover' && !gestureReceived) return;
    // 設置→音訊：全體靜音／音效音量（50% ＝ 原音量）。
    if (sfxGain() <= 0) return;
    var at = now(), epoch = generation;
    var notification = kind === 'success' || kind === 'achievement';
    if (at - (lastPlayed[kind] === undefined ? -Infinity : lastPlayed[kind]) < (notification ? 120 : 80)) return;
    lastPlayed[kind] = at;
    // 冷載入只等待這一次短期互動，切頁或背景返回不補播過期聲音。
    load(kind).then(function (buffer) {
      var master = sfxGain();
      if (!buffer || document.hidden || generation !== epoch || context.state !== 'running' ||
          master <= 0 || (stillCurrent && !stillCurrent()) || now() - at > (notification ? 900 : 180)) return;
      try {
        if (sources[kind]) sources[kind].stop();
        var source = context.createBufferSource();
        source.buffer = buffer;
        var gain = context.createGain();
        gain.gain.value = master * (LEVELS[kind] == null ? 1 : LEVELS[kind]);
        source.connect(gain); gain.connect(context.destination);
        source.onended = function () {
          source.disconnect(); gain.disconnect();
          if (sources[kind] === source) delete sources[kind];
        };
        sources[kind] = source;
        source.start();
      } catch (_) { /* 播放失敗不回傳至遊戲指令Promise。 */ }
    });
  }
  function target(node) {
    if (!node || typeof node.closest !== 'function') return null;
    // aria-hidden常用於按鈕內的裝飾圖示，不能把可見的父控制項一併靜音。
    if (node.closest('[hidden], [inert]')) return null;
    var anchor = node.closest(TARGETS + ', ' + HELP_TARGETS);
    if (!anchor || anchor.disabled === true ||
        (anchor.matches && anchor.matches(':disabled, [aria-disabled="true"]'))) return null;
    // 點label的文字／軌道也會操作原生控制項；無控制項或停用時只算展示。
    if (anchor.tagName === 'LABEL') {
      if (!anchor.control || anchor.control.disabled ||
          (anchor.control.matches && anchor.control.matches(':disabled, [aria-disabled="true"]'))) return null;
      return anchor.control;
    }
    return anchor;
  }
  function click(event) {
    if (!event.isTrusted || event.button > 0 || document.hidden || !target(event.target)) return;
    unlock(event);
    play('click');
  }
  function menuPointerOver(event) {
    if (!menuVisible || !event.isTrusted || event.pointerType !== 'mouse' || event.buttons) return;
    var button = event.target && event.target.closest && event.target.closest('#start-menu .system-menu-actions button');
    if (!button || button.disabled || button.closest('[hidden], [inert]') ||
        (event.relatedTarget && button.contains(event.relatedTarget))) return;
    var epoch = menuEpoch;
    play('menuHover', function () { return menuVisible && menuEpoch === epoch; });
  }
  function commandResult(name, result) {
    var value = result && Object.prototype.hasOwnProperty.call(result, 'result') ? result.result : result;
    if ((name === 'item.upgrade' && value === 'ok') || (name === 'item.rerollAffix' && value === null)) play('success');
  }
  function init() {
    if (initialized || typeof document === 'undefined') return;
    initialized = true;
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('pointerup', unlock, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', unlock, true);
    document.addEventListener('pointerover', menuPointerOver, true);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopAll();
      else syncMusic();
    });
    window.addEventListener('pagehide', function () {
      pageActive = false;
      stopAll();
      if (menuMusic) menuMusic.pause();
      if (sceneMusic) sceneMusic.pause();
    });
    window.addEventListener('pageshow', function () { pageActive = true; syncMusic(); });
    if (typeof GameSettings !== 'undefined') {
      GameSettings.subscribe(function (name) {
        if (name === 'mute' || name === 'musicVolume') syncMusic();
        if (sfxGain() <= 0) stop('menuHover');
      });
    }
  }
  init();
  return { commandResult: commandResult, preloadStartMenuAudio: preloadStartMenuAudio,
    setIntroActive: setIntroActive,
    setScene: setScene, setSceneReady: setSceneReady,
    beginTowerChallenge: beginTowerChallenge, finishTowerChallenge: finishTowerChallenge,
    setStartScreenActive: setStartScreenActive, setStartMenuVisible: setStartMenuVisible,
    relicUpgraded: function () { play('success'); },
    achievementUnlocked: function () { play('achievement'); } };
})();
