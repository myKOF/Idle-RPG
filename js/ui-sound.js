'use strict';
/* 僅接入使用者核准的觸碰與成功WAV；不參與模擬／存檔，也不合成其他音色。 */
var UISound = (function () {
  var ASSETS = {
    hover: 'audio/ui-preview/01-hover.wav?v=411211856bdc',
    success: 'audio/ui-preview/05-success.wav?v=4821e4b49aad'
  };
  // 說明圖示是tips靜音的唯一例外；先判例外，再擋tips，最後辨識操作UI。
  var HELP_TARGETS = '.pg-help, .forge-info-btn, #btn-enemy-tip, #btn-boss-tip, #btn-tower-result-boss-tip';
  var SILENT_TIPS = [
    '[data-tip]', '[data-tt-title]', '[data-tt-desc]', '[title]:not([title=""])',
    '[data-sk]', '[data-buff-tip]', '[data-enemy-buff-tip]', '[data-talent-tip]',
    '.item-cell', '.eq-slot.filled', '.forge-slot.filled', '.act-btn-tooltip',
    '.gem-inventory-cell', '.gem-chip', '.socket.filled', '.loadout-slot.filled', '.gconv-slot.filled',
    '.gres-gem', '.gres-hole', '.equip-material-icon', '.sgb-item', '.gx-item', '.gx-chip',
    '.rx-card', '.rx-use', '.talent-icon', '.battle-buff-badge'
  ].join(', ');
  // 委派至document，涵蓋重繪／彈窗的新節點。
  var TARGETS = [
    'button', 'a[href]', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
    '[role="button"]', '[role="tab"]', '[role="checkbox"]', '[role="switch"]',
    '[data-tip]', '[data-tt-title]', '[data-tt-desc]', '[title]:not([title=""])',
    '[data-sk]', '[data-buff-tip]', '[data-enemy-buff-tip]', '[data-talent-tip]',
    '.btn', '.tab-btn', '.dropdown', '.input', '.info-btn', '.fs-btn', '.damage-toggle-btn',
    '.zone-btn', '.item-cell', '.eq-slot.filled', '.forge-slot', '.forge-dust', '.forge-btn',
    '.forge-info-btn', '#forge-crystal-float', '.gem-inventory-cell', '.gem-chip',
    '.socket.filled', '.socket-remove', '.loadout-slot.filled', '.gconv-slot.filled', '.gres-hole',
    '.eqset-tab', '.eqset-rename', '.equip-material-icon', '.it-enchant.removable', '.act-btn-tooltip',
    '.it-affix-row.is-reroll-pickable .it-affix-text', '.part-expand-chip', '.btn-it-lock', '.btn-it-pool',
    '.skill-row', '.summary-skill-block', '.battle-skill-slot', '.battle-buff-badge', '.char-core-tile',
    '.sgb-chip', '.sgb-item', '.sgb-tier-row', '.pg-help', '.gx-chip', '.gx-item', '.gx-tab',
    '.rx-tab', '.rx-card', '.rx-use', '.tlx-tier', '.talent-icon', '.tower-floor', '.shop-card',
    '.nf-part-upgrade-card', '.nf-part-upgrade-button', '.nf-qchip', '.nf-pu-row', '.save-row',
    '.fam-opt', '.realm-btn', '#quest-bar', '#update-banner', '#summary-modal .summary-modal-header'
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
      load('success');
    } catch (_) { /* 沒有音訊裝置時仍可正常使用UI。 */ }
  }
  function play(kind) {
    if (!ASSETS[kind] || !context || document.hidden) return;
    var at = now(), epoch = generation;
    if (at - (lastPlayed[kind] === undefined ? -Infinity : lastPlayed[kind]) < (kind === 'hover' ? 80 : 120)) return;
    lastPlayed[kind] = at;
    // 冷載入只等待這一次短期互動，切頁或背景返回不補播過期聲音。
    load(kind).then(function (buffer) {
      if (!buffer || document.hidden || generation !== epoch || context.state !== 'running' ||
          now() - at > (kind === 'hover' ? 180 : 900)) return;
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
    var help = node.closest(HELP_TARGETS);
    if (help) return help;
    // 包含原生button造型的寶石／符文及tips內部圖示，不讓上層控制項繞過靜音。
    if (node.closest(SILENT_TIPS)) return null;
    return node.closest(TARGETS);
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
  function commandResult(name, result) {
    var value = result && Object.prototype.hasOwnProperty.call(result, 'result') ? result.result : result;
    if ((name === 'item.upgrade' && value === 'ok') || (name === 'item.rerollAffix' && value === null)) play('success');
  }
  function init() {
    if (initialized || typeof document === 'undefined') return;
    initialized = true;
    document.addEventListener('pointerover', hover, true);
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('keydown', keyDown, true);
    document.addEventListener('focusin', focus, true);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stopAll(); focusTarget = null; pointerX = pointerY = null; }
    });
    window.addEventListener('pagehide', stopAll);
  }
  init();
  return { commandResult: commandResult };
})();
