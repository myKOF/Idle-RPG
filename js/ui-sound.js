'use strict';
/* 使用者核准的UI及成就音效；不參與模擬／存檔。 */
var UISound = (function () {
  var ASSETS = {
    hover: 'audio/ui-preview/01-hover.wav?v=411211856bdc',
    click: 'audio/ui-preview/hover-options-v5/H10.wav?v=338a16bc9ce9',
    success: 'audio/ui-preview/05-success.wav?v=4821e4b49aad',
    achievement: 'audio/achievements/mixkit-game-level-completed-2059.wav?v=8da83b49ceb5'
  };
  // 操作能力決定是否播放：有tips的按鈕／選取項目仍播，純tips不列入操作目標。
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
  var context = null, initialized = false, generation = 0;
  var buffers = {}, loading = {}, sources = {}, lastPlayed = {};
  var pointerX = null, pointerY = null, focusTarget = null, focusAt = -Infinity;

  function now() { return performance.now(); }
  function stopAll() {
    generation++;
    Object.keys(sources).forEach(function (kind) {
      try { sources[kind].stop(); } catch (_) {}
      delete sources[kind];
    });
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
    try {
      if (!context) {
        var AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        context = new AudioContextClass();
      }
      if (context.state === 'suspended') Promise.resolve(context.resume()).catch(function () {});
      load('hover');
      load('click');
      load('success');
      load('achievement');
    } catch (_) { /* 沒有音訊裝置時仍可正常使用UI。 */ }
  }
  function play(kind) {
    if (!ASSETS[kind] || !context || document.hidden) return;
    var at = now(), epoch = generation;
    var notification = kind === 'success' || kind === 'achievement';
    if (at - (lastPlayed[kind] === undefined ? -Infinity : lastPlayed[kind]) < (notification ? 120 : 80)) return;
    lastPlayed[kind] = at;
    // 冷載入只等待這一次短期互動，切頁或背景返回不補播過期聲音。
    load(kind).then(function (buffer) {
      if (!buffer || document.hidden || generation !== epoch || context.state !== 'running' ||
          now() - at > (notification ? 900 : 180)) return;
      try {
        if (sources[kind]) sources[kind].stop();
        var source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = function () {
          source.disconnect();
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
  function hover(event) {
    if (!event.isTrusted || event.pointerType === 'touch' || event.buttons || document.hidden) return;
    var samePosition = event.clientX === pointerX && event.clientY === pointerY;
    pointerX = event.clientX; pointerY = event.clientY;
    if (samePosition) return; // 游標未移動的DOM更換／版面位移不能觸發聲音。
    if (typeof UI !== 'undefined' && event.target && event.target.closest &&
        ((UI.panelScrolling && event.target.closest('#workspace-area main')) ||
         (UI.inventoryScrolling && event.target.closest('#inventory-grid')))) return;
    var anchor = target(event.target);
    if (!anchor || anchor === target(event.relatedTarget) || (focusTarget === anchor && now() - focusAt < 120)) return;
    play('hover');
  }
  function focus(event) {
    if (!event.isTrusted || document.hidden) return;
    var anchor = target(event.target);
    if (!anchor || anchor === target(event.relatedTarget)) return;
    // 滑鼠點擊造成的focus不另播；鍵盤導覽仍有觸碰回饋。
    if (!keyboardFocus) return;
    focusTarget = anchor; focusAt = now();
    play('hover');
  }
  var keyboardFocus = false;
  function pointerDown(event) {
    if (!event.isTrusted) return;
    keyboardFocus = false;
    unlock(event);
    if (event.pointerType === 'touch' && target(event.target)) play('hover');
  }
  function keyDown(event) {
    if (!event.isTrusted) return;
    keyboardFocus = true;
    unlock(event);
  }
  function click(event) {
    if (!event.isTrusted || event.button > 0 || document.hidden || !target(event.target)) return;
    unlock(event);
    play('click');
  }
  function commandResult(name, result) {
    var value = result && Object.prototype.hasOwnProperty.call(result, 'result') ? result.result : result;
    if ((name === 'item.upgrade' && value === 'ok') || (name === 'item.rerollAffix' && value === null)) play('success');
  }
  function init() {
    if (initialized || typeof document === 'undefined') return;
    initialized = true;
    document.addEventListener('pointerover', hover, true);
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', keyDown, true);
    document.addEventListener('focusin', focus, true);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stopAll(); focusTarget = null; pointerX = pointerY = null; }
    });
    window.addEventListener('pagehide', stopAll);
  }
  init();
  return { commandResult: commandResult, achievementUnlocked: function () { play('achievement'); } };
})();
