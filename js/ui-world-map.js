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
    thunder_peak: { x: 63.7, y: 57.7, width: 9.0 },
    undead_mountains: { x: 56.2, y: 34.7, width: 12.0 }
  };
  var state = { open: false, realm: 'human', selected: null, hovered: null, pending: null,
    acknowledged: false, error: '', signature: '', returnFocus: null, bound: false };

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
    go.disabled = !info.ready || !info.unlocked || info.active || !!state.pending;
    go.textContent = state.pending ? STR(2109) : STR(2110);
    if (state.realm === 'human' && locations[key]) {
      var point = locations[key];
      // 右側場景提示向左展開，上方場景提示向下展開，避免越界。
      card.style.left = Math.max(2, Math.min(72, point.x - (point.x > 70 ? 21 : 5))) + '%';
      card.style.top = (point.y > 60 ? point.y - 24 : point.y + 5) + '%';
    } else {
      card.style.left = '50%'; card.style.top = '58%';
    }
  }
  function select(key) {
    if (state.pending) return;
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
    el('world-map-realm-human').setAttribute('aria-pressed', human ? 'true' : 'false');
    el('world-map-realm-god').setAttribute('aria-pressed', human ? 'false' : 'true');
    var header = peekUiPanelData('header') || {};
    var hasGodProgress = (REALMS.god.zones || []).some(function (key) {
      var info = zoneState(key); return info && (info.active || info.unlocked);
    });
    var showRealms = hasGodProgress || Number(header.player && header.player.reincarnations) >= 11;
    el('world-map-realm-god').hidden = !showRealms;
    el('world-map-realm-human').hidden = !showRealms;
    var marker = el('world-map-marker');
    var point = locations[currentZone()];
    marker.hidden = !human || !point;
    if (point) {
      place(marker, { x: point.x, y: point.y - 3.5 });
      marker.setAttribute('aria-label', STR(2111, ZONES[currentZone()].name));
    }
  }
  function refresh() {
    if (!state.open) return;
    if (state.pending && state.acknowledged && currentZone() === state.pending) { close(); return; }
    if (state.pending && state.acknowledged && !isUiCommandPending(nodePendingKey('zone'))) {
      state.pending = null;
      state.error = STR(2112);
    }
    var signature = [currentZone(), state.realm, state.selected, state.hovered, state.pending, state.error];
    Object.keys(ZONES).forEach(function (key) { signature.push(JSON.stringify(zoneState(key))); });
    var header = peekUiPanelData('header') || {};
    signature.push(header.player && header.player.reincarnations);
    signature = signature.join('|');
    if (signature === state.signature) return;
    state.signature = signature;
    renderRealm();
    document.querySelectorAll('[data-world-zone]').forEach(function (node) {
      var key = node.getAttribute('data-world-zone'), info = zoneState(key);
      if (!info) return;
      node.classList.toggle('is-current', info.active);
      node.classList.toggle('is-locked', !info.unlocked);
      node.classList.toggle('is-selected', state.selected === key);
      var progress = el('world-map-level-' + key);
      if (progress) {
        progress.hidden = !info.unlocked;
        progress.textContent = info.unlocked ? STR(2130, info.current, info.max) : '';
      }
      node.setAttribute('aria-pressed', state.selected === key ? 'true' : 'false');
      node.setAttribute('aria-label', info.name + (info.unlocked ? STR(2130, info.current, info.max) : '') + (info.active ? STR(2113) : '') +
        (info.ready ? STR(2114, info.best, info.max) : STR(2115)) +
        (info.ready && !info.unlocked ? STR(2116) : ''));
    });
    var key = state.selected || state.hovered;
    if (key) showCard(key, !!state.selected);
    else el('world-map-info').hidden = true;
  }
  function close() {
    if (!state.open) return;
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
    if (!info || !info.unlocked || info.active || state.pending) return;
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
  function setRealm(realm) {
    if (state.pending) return;
    state.realm = realm; state.selected = null; state.hovered = null;
    state.error = ''; state.signature = ''; refresh();
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
        // 原名稱烘焙於母圖；常駐無字地貌覆片，讓名稱能反映解鎖狀態。
        // 覆片母圖1672px寬，裁切寬度=字數*22+24、高42px；cqw沿母圖容器等比縮放。
        var coverWidth = (ZONES[key].name.length * 22 + 24) / 1672 * 100;
        node.innerHTML = '<img class="world-map-label-cover" src="images/world-map/label-cover-' + key.toLowerCase() + '.png?v=1" alt="" aria-hidden="true" style="width:' + coverWidth + 'cqw;height:2.51196cqw">' +
          '<span class="world-map-hover-name" aria-hidden="true">' + esc(ZONES[key].name) + '</span>';
        el('world-map-hotspots').appendChild(node);
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
        if (state.selected) return;
        state.hovered = key; state.signature = ''; refresh();
      });
      node.addEventListener('pointerleave', function () {
        if (state.selected) return;
        state.hovered = null; state.signature = ''; refresh();
      });
      node.addEventListener('focus', function () {
        if (state.selected) return;
        state.hovered = key; state.signature = ''; refresh();
      });
      node.addEventListener('blur', function () {
        if (state.selected) return;
        state.hovered = null; state.signature = ''; refresh();
      });
      node.addEventListener('click', function () { select(key); });
    });
    el('btn-world-map').addEventListener('click', open);
    el('world-map-close').addEventListener('click', close);
    el('world-map-go').addEventListener('click', go);
    el('world-map-realm-human').addEventListener('click', function () { setRealm('human'); });
    el('world-map-realm-god').addEventListener('click', function () { setRealm('god'); });
    el('world-map-modal').addEventListener('click', function (event) {
      if (event.target === this) close();
      else if (event.target === el('world-map-image') || event.target === el('world-map-human')) {
        state.selected = null; state.hovered = null; state.signature = ''; refresh();
      }
    });
    var image = el('world-map-image');
    image.addEventListener('error', function () { el('world-map-image-error').hidden = false; });
    image.addEventListener('load', function () { el('world-map-image-error').hidden = true; });
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
