'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網

var QuestGuide = (function () {
  var introStorageKey = null, introObserver = null;
  var highlightObserver = null, highlighted = null;
  var highlightInputEvents = ['pointerdown', 'click', 'keydown', 'wheel'];
  var destinations = {
    equipSlots: { tab: 'equip' },
    upgradeCount: { tab: 'equip', target: '[data-act="upgrade"]' },
    rerollCount: { tab: 'equip', target: '[data-act="toggle-reroll"], [data-act="reroll-affix"]' },
    socketCount: { tab: 'equip', target: '[data-act="toggle-socket"]' },
    runeSocketCount: { tab: 'equip', target: '[data-act="toggle-rune"]' },
    skillEquipCount: { tab: 'skills', target: '[data-skill-equip]' },
    skillUpgradeCount: { tab: 'skills', target: '[data-skill2-learn]' },
    forgeParts: { tab: 'newforge', target: '[data-nf-partsopen]' },
    forgeFineAuto: { tab: 'newforge', target: 'label:has([data-nf-qual="1"]:enabled)' },
    chestOpenCount: { tab: 'newforge', target: '[data-chest-open][data-chest-count="1"]' },
    composeCount: { tab: 'gems', target: '#fuse-btn' },
    relicCount: { tab: 'relics' },
    maxHp: { tab: 'char' }
  };

  function start(save, runId) {
    var key = 'ir_quest_guide_pending_run:' + ((save ? save.runId : runId) || 1);
    var show = !save;
    try {
      if (show) localStorage.setItem(key, '1');
      else show = localStorage.getItem(key) === '1';
    } catch (error) { /* 儲存空間停用時，仍顯示本次新局的導引。 */ }
    if (!show) return;

    introStorageKey = key;
    var bar = $id('quest-bar'), guide = $id('quest-guide');
    function placeIntro() {
      var rect = window.UiCanvas.rect(bar);
      guide.hidden = !rect.width || !rect.height;
      if (guide.hidden) return;
      var below = rect.left < 360;
      guide.classList.toggle('quest-guide-below', below);
      guide.style.left = (below ? rect.left + rect.width / 2 : rect.left) + 'px';
      guide.style.top = (below ? rect.bottom : rect.top + rect.height / 2) + 'px';
    }

    introObserver = new ResizeObserver(placeIntro);
    introObserver.observe(bar);
    introObserver.observe(bar.parentElement);
    bar.classList.add('quest-guide-intro-target');
    bar.setAttribute('aria-describedby', 'quest-guide-message');
    placeIntro();
  }

  function dismissIntro() {
    if (!introObserver) return;
    introObserver.disconnect();
    introObserver = null;
    $id('quest-guide').hidden = true;
    var bar = $id('quest-bar');
    bar.classList.remove('quest-guide-intro-target');
    bar.removeAttribute('aria-describedby');
    try { localStorage.removeItem(introStorageKey); } catch (error) { /* 本頁的導引已結束。 */ }
    introStorageKey = null;
  }

  function isOperable(node) {
    return node && node.getClientRects().length && getComputedStyle(node).visibility === 'visible' &&
      !node.matches(':disabled') && !node.closest('[inert], [aria-disabled="true"], .is-locked');
  }

  function clearHighlight() {
    if (!highlightObserver) return;
    highlightObserver.disconnect();
    if (highlighted) highlighted.classList.remove('quest-guide-highlight');
    highlightInputEvents.forEach(function (type) {
      window.removeEventListener(type, dismissHighlightOnInput, true);
    });
    highlightObserver = highlighted = null;
  }

  function dismissHighlightOnInput(event) {
    // 長按 Enter 開啟任務時，重複的 keydown 仍屬於同一次操作。
    if (event.isTrusted && !event.repeat) clearHighlight();
  }

  function highlight(scope, selector) {
    if (!scope || !selector) return;
    var scrolled = false;
    function update() {
      if (scope.hidden) { clearHighlight(); return; }
      var target = Array.from(scope.querySelectorAll(selector)).find(isOperable);
      if (target === highlighted) return;
      if (highlighted) highlighted.classList.remove('quest-guide-highlight');
      highlighted = target;
      if (!target) return;
      target.classList.add('quest-guide-highlight');
      if (!scrolled) {
        scrolled = true;
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    highlightObserver = new MutationObserver(update);
    highlightObserver.observe(scope, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'hidden']
    });
    // 任務列的 click 已通過捕獲階段，接下來才開始接收玩家輸入。
    highlightInputEvents.forEach(function (type) {
      window.addEventListener(type, dismissHighlightOnInput, { capture: true, passive: true });
    });
    update();
  }

  function showLocked(trigger, event) {
    var point = event.detail ? window.UiCanvas.point(event.clientX, event.clientY) : null;
    showFloatingText(trigger, STR(2566), '#ffcc68', point);
  }

  function follow(def, trigger, event) {
    clearHighlight();
    if (def.type === 'stageClear') {
      if (!isOperable($id('btn-world-map'))) { showLocked(trigger, event); return; }
      closeQuestModal();
      if (WorldMapUI.openForQuest(def.param)) highlight($id('world-map-modal'), '#world-map-go');
      return;
    }
    var destination = destinations[def.type];
    if (!destination) return;
    if ($id('ui-shell').classList.contains('battle-fullscreen')) setBattleFullscreen(false);
    var tabButton = document.querySelector('.tab-btn[data-tab="' + destination.tab + '"]');
    if (!isOperable(tabButton)) { showLocked(trigger, event); return; }
    closeQuestModal();
    switchTab(destination.tab);
    if (def.type === 'composeCount') setGemTool('compose');
    tabButton.focus({ preventScroll: true });
    highlight($id('tab-' + destination.tab), destination.target);
  }

  return { start: start, dismissIntro: dismissIntro, follow: follow, clearHighlight: clearHighlight };
})();
