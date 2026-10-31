'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js

/* 僅持有地圖選取／彈窗狀態；關卡與解鎖以既有 Worker battle.zones 為準。 */
var WorldMapUI = (function () {
  var locations = {
    desert: { x: 56.5, y: 70.0, width: 8.5 },
    Icefield: { x: 57.1, y: 15.5, width: 8.0 },
    mist_forest: { x: 80.8, y: 34.5, width: 12.0 },
    lava_mountain: { x: 38.8, y: 54.6, width: 9.0 },
    swamp: { x: 80.7, y: 66.6, width: 12.0 },
    thunder_peak: { x: 60.0, y: 54.5, width: 9.0 },
    undead_mountains: { x: 56.2, y: 34.7, width: 12.0 },
    god_battlefield: { x: 36.0, y: 48.5, width: 12.0 },
    god_chaos: { x: 66.0, y: 64.5, width: 10.0 },
    god_sanctuary: { x: 80.7, y: 35.0, width: 12.0 }
  };
  var state = { open: false, realm: 'human', selected: null, hovered: null, pending: null,
    acknowledged: false, error: '', signature: '', returnFocus: null, bound: false, transition: null };
  var REALM_TRANSITION_MS = 2500;
  var transitionTimers = [], transitionToken = 0;

  function el(id) { return document.getElementById(id); }
  function currentZone() {
    var header = peekUiPanelData('header') || {};
    return (header.stage && header.stage.zone) || 'desert';
  }
  function zoneState(key) {
    var battle = peekUiPanelData('battle') || {};
    var header = peekUiPanelData('header') || {};
    var rows = battle.zones || [];
    var row = rows.filter(function (entry) { return entry.key === key; })[0];
    var def = ZONES[key];
    if (!def) return null;
    var active = currentZone() === key;
    var stage = active && header.stage ? header.stage : row;
    var max = Math.max(1, Number(row && row.maxStage) || Number(def.maxStage) || 1);
    var unlocked = !!(row && row.unlocked);
    return { key: key, name: def.name, active: active, ready: !!row,
      unlocked: unlocked, max: max,
      best: unlocked ? Math.min(max, Math.max(0, Number(stage && stage.best) || 0)) : 0,
      current: unlocked ? Math.min(max, Math.max(0, Number(stage && stage.current) || 0)) : 0 };
  }
  function lockReason(key) {
    var def = ZONES[key];
    var parts = [];
    if (def.reqZone && ZONES[def.reqZone]) parts.push(STR(2100, ZONES[def.reqZone].name, def.reqStage));
    if (def.reqReincarnation) parts.push(STR(2101, def.reqReincarnation));
    return parts.length ? STR(2103, parts.join(STR(2102))) : STR(2104);
  }
  function place(node, point) {
    node.style.left = point.x + '%';
    node.style.top = point.y + '%';
    if (point.width) node.style.width = point.width + '%';
  }
  function humanWorldCleared() {
    var keys = Object.keys(ZONES).filter(function (key) { return ZONES[key].realm === 'human'; });
    var highest = keys.reduce(function (max, key) { return Math.max(max, Number(ZONES[key].maxStage) || 0); }, 0);
    var battle = peekUiPanelData('battle') || {};
    // best到達上限仍不代表通關；只讀既有權威cleared，不從best推算末關勝利。
    return highest > 0 && keys.filter(function (key) { return Number(ZONES[key].maxStage) === highest; }).every(function (key) {
      var info = zoneState(key), progress = battle.zoneProgress && battle.zoneProgress[key];
      return info && info.ready && progress && Number(progress.cleared) >= highest;
    });
  }
  function showCard(key, selected) {
    var info = zoneState(key);
    var card = el('world-map-info');
    if (!info || !card) return;
    card.hidden = false;
    el('world-map-scene-name').textContent = info.name;
    el('world-map-progress').textContent = info.ready ? STR(2123, info.best, info.max) : STR(2105);
    el('world-map-scene-status').textContent = state.error || (!info.ready ? STR(2106) :
      (!info.unlocked ? lockReason(key) : (info.active ? STR(2107) : STR(2108, (info.current || 1)))));
    var go = el('world-map-go');
    go.hidden = !selected;
    go.disabled = !info.ready || !info.unlocked || info.active || !!state.pending || !!state.transition;
    go.textContent = state.pending ? STR(2109) : STR(2110);
    if (locations[key]) {
      var point = locations[key];
      card.style.left = 'clamp(min(143px, 50%), ' + point.x + '%, max(calc(100% - 143px), 50%))';
      card.style.top = 'calc(' + point.y + '% + max(2.6cqw, 20px))';
    } else {
      var node = document.querySelector('[data-world-zone="' + key + '"]');
      var canvas = el('world-map-canvas');
      var bounds = canvas.getBoundingClientRect(), anchor = node.getBoundingClientRect();
      var scaleX = bounds.width ? canvas.clientWidth / bounds.width : 1;
      var scaleY = bounds.height ? canvas.clientHeight / bounds.height : 1;
      card.style.left = 'clamp(min(143px, 50%), ' + ((anchor.left + anchor.width / 2 - bounds.left) * scaleX) + 'px, max(calc(100% - 143px), 50%))';
      card.style.top = ((anchor.bottom - bounds.top) * scaleY + 8) + 'px';
    }
  }
  function select(key) {
    if (state.pending || state.transition) return;
    state.selected = key;
    state.hovered = null;
    state.error = '';
    state.signature = '';
    refresh();
  }
  function renderRealm() {
    var human = state.realm === 'human';
    el('world-map-human').hidden = !human;
    el('world-map-god').hidden = human;
    el('world-map-modal').setAttribute('data-world-realm', state.realm);
    el('world-map-title').setAttribute('data-str', human ? '2124' : '212');
    el('world-map-title').textContent = human ? STR(2124) : STR(212);
    var portalVisible = humanWorldCleared();
    el('world-map-god-portal').hidden = !portalVisible;
    var busy = !!state.pending || !!state.transition;
    el('world-map-god-portal').disabled = busy;
    el('world-map-human-portal').disabled = busy;
    var point = locations[currentZone()];
    ['world-map-marker', 'world-map-god-marker'].forEach(function (id) {
      var marker = el(id);
      var markerRealm = id === 'world-map-marker' ? 'human' : 'god';
      marker.hidden = state.realm !== markerRealm || !point || ZONES[currentZone()].realm !== markerRealm;
      if (point) {
        place(marker, { x: point.x, y: point.y - 3.5 });
        marker.setAttribute('aria-label', STR(2111, ZONES[currentZone()].name));
      }
    });
  }
  function refresh() {
    if (!state.open) return;
    if (state.pending && state.acknowledged && currentZone() === state.pending) { close(); return; }
    if (state.pending && state.acknowledged && !isUiCommandPending(nodePendingKey('zone'))) {
      state.pending = null;
      state.error = STR(2112);
    }
    var signature = [currentZone(), state.realm, state.selected, state.hovered, state.pending, state.error, state.transition];
    Object.keys(ZONES).forEach(function (key) { signature.push(JSON.stringify(zoneState(key))); });
    var header = peekUiPanelData('header') || {};
    signature.push(header.player && header.player.reincarnations);
    signature.push(humanWorldCleared());
    signature = signature.join('|');
    if (signature === state.signature) return;
    state.signature = signature;
    renderRealm();
    document.querySelectorAll('[data-world-zone]').forEach(function (node) {
      var key = node.getAttribute('data-world-zone'), info = zoneState(key);
      if (!info) return;
      node.disabled = !!state.transition;
      node.classList.toggle('is-current', info.active);
      node.classList.toggle('is-locked', !info.unlocked);
      node.classList.toggle('is-selected', state.selected === key);
      var progress = el('world-map-level-' + key);
      if (progress) {
        progress.hidden = !info.unlocked;
        progress.textContent = info.unlocked ? STR(2144, info.best, info.max) : '';
      }
      node.setAttribute('aria-pressed', state.selected === key ? 'true' : 'false');
      node.setAttribute('aria-label', info.name + (info.unlocked ? STR(2144, info.best, info.max) : '') + (info.active ? STR(2113) : '') +
        (info.ready ? STR(2114, info.best, info.max) : STR(2115)) +
        (info.ready && !info.unlocked ? STR(2116) : ''));
    });
    var key = state.selected || state.hovered;
    if (key) showCard(key, !!state.selected);
    else el('world-map-info').hidden = true;
  }
  function close() {
    if (!state.open) return;
    cancelRealmTransition();
    state.open = false;
    state.pending = null;
    var modal = el('world-map-modal');
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('world-map-open');
    if (state.returnFocus && state.returnFocus.isConnected) state.returnFocus.focus();
  }
  function open() {
    if (state.open) return;
    init();
    state.returnFocus = document.activeElement;
    state.open = true;
    state.selected = null; state.hovered = null; state.pending = null;
    state.error = ''; state.signature = '';
    state.realm = ZONES[currentZone()].realm === 'god' ? 'god' : 'human';
    var modal = el('world-map-modal');
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('world-map-open');
    requestPanelData('battle', true);
    refresh();
    el('world-map-close').focus();
  }
  function go() {
    var key = state.selected, info = zoneState(key);
    if (!info || !info.unlocked || info.active || state.pending || state.transition) return;
    state.pending = key; state.acknowledged = false; state.error = ''; state.signature = '';
    refresh();
    sendUiCommand('stage.switchZone', { zoneKey: key }, {
      keys: [nodePendingKey('zone')], panels: ['battle', 'header']
    }).then(function (result) {
      if (!state.open || state.pending !== key) return;
      var error = uiCommandResultError(result, 'stage.switchZone');
      state.acknowledged = true;
      if (error) { state.pending = null; state.error = STR(2117); }
      refresh();
    }).catch(function (error) {
      if (!state.open || state.pending !== key) return;
      state.pending = null; state.error = STR(2117);
      reportUiCommandFailure(STR(2118), error, ['battle', 'header']);
      refresh();
    });
  }
  function applyRealm(realm) {
    state.realm = realm; state.selected = null; state.hovered = null;
    state.error = ''; state.signature = ''; refresh();
  }
  function cancelRealmTransition() {
    transitionToken++;
    transitionTimers.forEach(function (timer) { clearTimeout(timer); });
    transitionTimers = [];
    state.transition = null;
    var layer = el('world-map-transition');
    layer.hidden = true;
    layer.classList.remove('is-running');
    el('world-map-modal').setAttribute('aria-busy', 'false');
    state.signature = '';
  }
  function setRealm(realm) {
    if (!state.open || state.pending || state.transition || state.realm === realm) return;
    var source = el(state.realm === 'human' ? 'world-map-god-portal' : 'world-map-human-portal');
    if (source.hidden) return;
    var bounds = el('world-map-canvas').getBoundingClientRect(), anchor = source.getBoundingClientRect();
    var layer = el('world-map-transition');
    var x = bounds.width ? (anchor.left + anchor.width / 2 - bounds.left) / bounds.width * 100 : 50;
    var y = bounds.height ? (anchor.top + anchor.height / 2 - bounds.top) / bounds.height * 100 : 50;
    layer.style.setProperty('--wm-portal-x', Math.max(0, Math.min(100, x)) + '%');
    layer.style.setProperty('--wm-portal-y', Math.max(0, Math.min(100, y)) + '%');
    layer.style.setProperty('--wm-transit-duration', REALM_TRANSITION_MS + 'ms');
    layer.setAttribute('data-destination', realm);
    // 預先載入目標圖，切頁時仍沿用原圖錯誤提示與既有快照。
    el(realm === 'god' ? 'world-map-god-image' : 'world-map-image').setAttribute('loading', 'eager');
    state.transition = realm;
    state.selected = null; state.hovered = null; state.error = ''; state.signature = '';
    el('world-map-modal').setAttribute('aria-busy', 'true');
    layer.hidden = false;
    layer.classList.remove('is-running');
    void layer.offsetWidth;
    layer.classList.add('is-running');
    refresh();
    el('world-map-close').focus();
    var token = ++transitionToken;
    // 遮蔽中央才換地圖；完成後才恢復互動。關閉會取消兩個回呼。
    transitionTimers.push(setTimeout(function () {
      if (!state.open || token !== transitionToken) return;
      applyRealm(realm);
    }, REALM_TRANSITION_MS / 2));
    transitionTimers.push(setTimeout(function () {
      if (!state.open || token !== transitionToken) return;
      cancelRealmTransition();
      refresh();
      var destination = el(realm === 'god' ? 'world-map-human-portal' : 'world-map-god-portal');
      (destination.hidden ? el('world-map-close') : destination).focus();
    }, REALM_TRANSITION_MS));
  }
  function init() {
    if (state.bound || !el('world-map-modal')) return;
    state.bound = true;
    Object.keys(ZONES).forEach(function (key) {
      var node = document.createElement('button');
      node.type = 'button';
      node.setAttribute('data-world-zone', key);
      node.setAttribute('aria-label', ZONES[key].name);
      if (locations[key]) {
        node.className = 'world-map-hotspot';
        place(node, locations[key]);
        // 原名稱烘焙於母圖；覆片獨立於文字熱區，移動文字時仍蓋住原字。
        // 覆片母圖1672px寬，裁切寬度=字數*22+24、高42px；cqw沿母圖容器等比縮放。
        var coverWidth = (ZONES[key].name.length * 22 + 24) / 1672 * 100;
        if (ZONES[key].realm === 'human') {
          var cover = document.createElement('img');
          cover.className = 'world-map-label-cover';
          cover.setAttribute('src', 'images/world-map/label-cover-' + key.toLowerCase() + '.png?v=1');
          cover.setAttribute('alt', ''); cover.setAttribute('aria-hidden', 'true');
          place(cover, key === 'thunder_peak' ? { x: 63.7, y: 57.7 } : locations[key]);
          cover.style.width = coverWidth + 'cqw'; cover.style.height = '2.51196cqw';
          el('world-map-hotspots').appendChild(cover);
        }
        node.innerHTML = '<span class="world-map-hover-name" aria-hidden="true">' + esc(ZONES[key].name) + '</span>';
        el(ZONES[key].realm === 'human' ? 'world-map-hotspots' : 'world-map-god-zones').appendChild(node);
      } else {
        node.className = 'world-map-god-scene';
        node.innerHTML = zoneIconHtml(key, ZONES[key]) + ' <span class="world-map-hover-name" aria-hidden="true">' + esc(ZONES[key].name) + '</span>';
        el('world-map-god-zones').appendChild(node);
      }
      var progress = document.createElement('span');
      progress.setAttribute('id', 'world-map-level-' + key);
      progress.className = 'world-map-level';
      progress.hidden = true;
      progress.setAttribute('aria-hidden', 'true');
      node.appendChild(progress);
      node.addEventListener('pointerenter', function () {
        if (state.selected || state.transition) return;
        state.hovered = key; state.signature = ''; refresh();
      });
      node.addEventListener('pointerleave', function () {
        if (state.selected || state.transition) return;
        state.hovered = null; state.signature = ''; refresh();
      });
      node.addEventListener('focus', function () {
        if (state.selected || state.transition) return;
        state.hovered = key; state.signature = ''; refresh();
      });
      node.addEventListener('blur', function () {
        if (state.selected || state.transition) return;
        state.hovered = null; state.signature = ''; refresh();
      });
      node.addEventListener('click', function () { select(key); });
    });
    el('btn-world-map').addEventListener('click', open);
    el('world-map-close').addEventListener('click', close);
    el('world-map-go').addEventListener('click', go);
    el('world-map-god-portal').addEventListener('click', function () {
      if (humanWorldCleared() && !state.pending) {
        setRealm('god');
      }
    });
    el('world-map-human-portal').addEventListener('click', function () {
      if (state.pending) return;
      setRealm('human');
    });
    window.addEventListener('resize', function () {
      if (state.open && (state.selected || state.hovered)) showCard(state.selected || state.hovered, !!state.selected);
    });
    el('world-map-god').addEventListener('scroll', function () {
      if (state.open && state.realm === 'god' && (state.selected || state.hovered)) showCard(state.selected || state.hovered, !!state.selected);
    });
    el('world-map-modal').addEventListener('click', function (event) {
      if (event.target === this) close();
      else if (event.target === el('world-map-image') || event.target === el('world-map-human') ||
        event.target === el('world-map-god-image') || event.target === el('world-map-god')) {
        state.selected = null; state.hovered = null; state.signature = ''; refresh();
      }
    });
    var image = el('world-map-image');
    image.addEventListener('error', function () { el('world-map-image-error').hidden = false; });
    image.addEventListener('load', function () { el('world-map-image-error').hidden = true; });
    var godImage = el('world-map-god-image');
    godImage.addEventListener('error', function () { el('world-map-god-image-error').hidden = false; });
    godImage.addEventListener('load', function () { el('world-map-god-image-error').hidden = true; });
    document.addEventListener('keydown', function (event) {
      if (!state.open) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); close(); return;
      }
      if (event.key !== 'Tab') return;
      var nodes = Array.prototype.filter.call(el('world-map-modal').querySelectorAll('button'), function (node) {
        return !node.disabled && node.getClientRects().length > 0;
      });
      if (!nodes.length) return;
      var first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }, true);
  }
  return { init: init, open: open, close: close, refresh: refresh, zoneState: zoneState };
})();
