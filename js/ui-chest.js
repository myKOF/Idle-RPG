'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
/* ============ 熔爐寶箱區（主執行緒） ============
   熔爐頁上方的置頂寶箱列（index.html #nf-chests）。只讀 newforge 面板的 chests（{ 編號: { lv, xp, n, on } }）
   與 header 面板的金幣；定義、升級費用、掉落機率用兩端共載的 js/chest.js 純函式算，與 Worker 扣款同一支。
   開啟／升級送 chest.open／chest.upgrade，獎勵以全畫面彈窗顯示。
   版面：寶箱結構（解鎖、等級、存滿）改變才整段重建；經驗條、數量、按鈕狀態每次快照定點更新，
   避免拆解每 2 秒改一次經驗就把滑鼠底下的提示整個換掉。
   寶箱圖依品質載入透明 WebP；未解鎖時本體置灰並疊上鎖鏈與掛鎖。 */

var CHEST_UI = { bound: false, sig: '', results: [] };

var CHEST_ART_FILES = {
  common: 'bronze',
  rare: 'fine',
  epic: 'epic',
  legendary: 'legendary',
  mythic: 'mythic'
};

function chestUiEsc(s) { return esc(String(s)); }
function chestUiPendingKey(id) { return nodePendingKey('chest:' + id); }
function chestUiPending(id) { return typeof isUiCommandPending === 'function' && isUiCommandPending(chestUiPendingKey(id)); }

/* ---- 未解鎖的鎖鏈與掛鎖 ---- */
function chestLockSVG(id) {
  var gradientId = 'nfc-chain-' + id;
  var paint = 'url(#' + gradientId + ')';
  // 沿對角線排列交錯的鏈環。
  var chainLinks = function (x1, y1, x2, y2) {
    var out = '', steps = 9, ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    for (var i = 0; i <= steps; i++) {
      var x = x1 + (x2 - x1) * i / steps, y = y1 + (y2 - y1) * i / steps;
      out += i % 2
        ? '<rect x="' + (x - 6).toFixed(1) + '" y="' + (y - 1.6).toFixed(1) + '" width="12" height="3.2" rx="1.6" fill="' + paint + '" stroke="#202328" stroke-width=".8" transform="rotate(' + ang.toFixed(1) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1) + ')"/>'
        : '<ellipse cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" rx="6.5" ry="3.8" fill="none" stroke="' + paint + '" stroke-width="2.6" transform="rotate(' + ang.toFixed(1) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1) + ')"/>';
    }
    return out;
  };
  return '<svg class="nfc-art-lock" viewBox="0 0 120 84" aria-hidden="true" focusable="false">' +
    '<defs><linearGradient id="' + gradientId + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#d7dbe2"/><stop offset=".5" stop-color="#8b9099"/><stop offset="1" stop-color="#3c4048"/>' +
    '</linearGradient></defs>' +
    chainLinks(14, 18, 106, 69) + chainLinks(106, 18, 14, 69) +
    '<path d="M51 44V37A9 9 0 0 1 69 37V44" fill="none" stroke="#2b2e34" stroke-width="6"/>' +
    '<path d="M51 44V37A9 9 0 0 1 69 37V44" fill="none" stroke="' + paint + '" stroke-width="3.6"/>' +
    '<rect x="45" y="43" width="30" height="24" rx="4" fill="' + paint + '" stroke="#1d2025" stroke-width="1.4"/>' +
    '<circle cx="60" cy="52" r="3" fill="#15171b"/><path d="M58.6 53.5H61.4L62.2 60H57.8Z" fill="#15171b"/>' +
    '</svg>';
}

/* ---- 提示 ---- */
function chestDropTipHTML(def, st) {
  var row = chestLevelDef(def, st.lv);
  if (!row) return '';
  var html = '<div class="nfc-tip-head">' + chestUiEsc(STR(2511, st.lv, row.rolls)) + '</div>';
  html += chestDropOdds(row).map(function (o) {
    var pct = o.pct >= 10 ? o.pct.toFixed(1) : o.pct >= 1 ? o.pct.toFixed(2) : o.pct.toFixed(3);
    return '<div class="nfc-tip-row"><span>' + chestUiEsc(chestDropText(o.drop)) + '</span><b>' + pct + '%</b></div>';
  }).join('');
  var next = chestLevelDef(def, st.lv + 1);
  if (next && st.lv < chestMaxLevel(def)) html += '<hr><div class="nfc-tip-note">' + chestUiEsc(STR(2512, st.lv + 1, next.rolls)) + '</div>';
  return html;
}

/* ---- 卡片 ---- */
function chestCardHTML(def, st) {
  var locked = !st.on, maxed = st.lv >= chestMaxLevel(def);
  var quality = Object.hasOwn(CHEST_ART_FILES, def.quality) ? def.quality : 'common';
  var cls = 'nfc-card q-' + quality + (locked ? ' is-locked' : '') + (maxed ? ' is-max' : '');
  var h = '<article class="' + cls + '" data-chest-id="' + def.id + '">';
  h += '<div class="nfc-art"' + (locked ? '' : ' data-tt-title="' + chestUiEsc(def.name) + '" data-tt-desc="' + chestUiEsc(chestDropTipHTML(def, st)) + '"') + '>' +
    '<img class="nfc-art-chest" src="images/chests/' + CHEST_ART_FILES[quality] + '.webp" alt="">' +
    (locked ? chestLockSVG(def.id) : '') +
    (locked ? '' : '<span class="nfc-count" data-nfc-count></span>') + '</div>';
  h += '<div class="nfc-title"><span class="nfc-name">' + chestUiEsc(def.name) + '</span>' +
    (locked ? '' : '<span class="nfc-lv">Lv.' + st.lv + '</span>') + '</div>';
  if (locked) {
    var r = chestUnlockRarity(def);
    h += '<div class="nfc-locked-hint">' + chestUiEsc(r >= 0 && RARITIES[r] ? STR(2506, RARITIES[r].name) : STR(2505)) + '</div>';
    return h + '</article>';
  }
  h += '<div class="nfc-bar" data-nfc-bar><i data-nfc-fill></i><span data-nfc-xp></span></div>';
  h += '<div class="nfc-btns">' +
    '<button type="button" class="btn sm nfc-open" data-chest-open="' + def.id + '" data-chest-count="1">' + chestUiEsc(STR(2502)) + '</button>' +
    '<button type="button" class="btn sm nfc-open" data-chest-open="' + def.id + '" data-chest-count="all">' + chestUiEsc(STR(2503)) + '</button>' +
    (maxed
      ? '<span class="nfc-max">' + chestUiEsc(STR(2504)) + '</span>'
      : '<button type="button" class="btn sm nfc-up" data-chest-upgrade="' + def.id + '"><span class="nfc-up-arrow">⬆</span><img src="images/icon_gold.png" class="res-icon" alt=""><span data-nfc-cost></span></button>') +
    '</div>';
  return h + '</article>';
}

/* 每次快照的定點更新：數量、經驗條、按鈕可用狀態與費用 */
function chestUpdateCard(card, def, st, gold) {
  if (!st.on) return;
  var row = chestLevelDef(def, st.lv), need = Number(row.need) || 1, full = st.n >= CHEST_MAX_COUNT;
  var pending = chestUiPending(def.id);
  var count = card.querySelector('[data-nfc-count]');
  if (count) {
    setTextIfChanged(count, '×' + fmtFull(st.n));
    setAttrIfChanged(count, 'data-tip', STR(2507, fmtFull(st.n), fmtFull(CHEST_MAX_COUNT)));
  }
  var bar = card.querySelector('[data-nfc-bar]');
  if (bar) {
    var shown = Math.min(need, Math.floor(st.xp));
    var fill = bar.querySelector('[data-nfc-fill]');
    var pct = full ? 100 : Math.max(0, Math.min(100, st.xp / need * 100));
    var width = pct.toFixed(1) + '%';
    if (fill && fill.style.width !== width) fill.style.width = width;
    bar.classList.toggle('is-full', full);
    setTextIfChanged(bar.querySelector('[data-nfc-xp]'), full ? STR(2508) : fmt(shown) + ' / ' + fmt(need));
    setAttrIfChanged(bar, 'data-tip', full ? STR(2509, fmtFull(CHEST_MAX_COUNT)) : STR(2510, fmtFull(shown), fmtFull(need), fmtFull(Math.max(0, Math.ceil(need - st.xp)))));
  }
  card.querySelectorAll('[data-chest-open]').forEach(function (btn) {
    var dis = pending || st.n <= 0;
    if (btn.disabled !== dis) btn.disabled = dis;
    var all = btn.getAttribute('data-chest-count') === 'all';
    setAttrIfChanged(btn, 'data-tip', all ? STR(2513, fmtFull(st.n)) : STR(2514));
  });
  var up = card.querySelector('[data-chest-upgrade]');
  if (up) {
    var cost = chestUpgradeCost(def, st.lv);
    if (up.disabled !== pending) up.disabled = pending;
    up.classList.toggle('nf-part-poor', cost !== null && gold < cost);
    setTextIfChanged(up.querySelector('[data-nfc-cost]'), cost === null ? '' : fmt(cost));
    setAttrIfChanged(up, 'data-tip', cost === null ? '' : STR(2515, st.lv + 1, fmtFull(cost)));
  }
}

function chestUiState(store, def) { return chestEntry(def, store && store[def.id]); }

function renderNewForgeChests(nfSnapshot, headerSnapshot) {
  var box = $id('nf-chests');
  if (!box || typeof CHESTS === 'undefined') return;
  chestUiBind(box);
  var store = (nfSnapshot && nfSnapshot.chests) || {};
  var gold = Number(headerSnapshot && headerSnapshot.player && headerSnapshot.player.gold) || 0;
  var row = box.querySelector('.nfc-row');
  // 結構簽章：解鎖、等級、滿級、遺物機率倍率（影響提示內的掉落機率）改變才重建
  var sig = String(chestRelicMult()) + '|' + CHESTS.map(function (def) {
    var st = chestUiState(store, def);
    return def.id + ':' + (st.on ? 1 : 0) + ':' + st.lv;
  }).join(',');
  if (!row || CHEST_UI.sig !== sig) {
    CHEST_UI.sig = sig;
    var help = '<button type="button" class="pg-help nfc-help" data-tt-title="' + chestUiEsc(STR(2483)) + '" data-tt-desc="' + chestUiEsc(STR(2484, fmtFull(CHEST_MAX_COUNT), CHEST_MAX_LEVEL)) + '">?</button>';
    box.innerHTML = '<div class="nfc-head"><span class="nfc-head-title">' + chestUiEsc(STR(2483)) + '</span>' + help + '</div>' +
      '<div class="nfc-row">' + CHESTS.map(function (def) { return chestCardHTML(def, chestUiState(store, def)); }).join('') + '</div>';
    row = box.querySelector('.nfc-row');
  }
  CHESTS.forEach(function (def) {
    var card = row.querySelector('[data-chest-id="' + def.id + '"]');
    if (card) chestUpdateCard(card, def, chestUiState(store, def), gold);
  });
}

/* ---- 開箱獎勵 ---- */
var CHEST_RESULT_PRIORITY = { relic: 0, rune: 1, gem: 3, equip: 4 };

function chestResultImage(src) {
  return '<img src="' + chestUiEsc(src) + '" alt="" draggable="false" decoding="async">';
}

function chestRewardIconHTML(rw) {
  switch (rw.k) {
    case 'gold': return chestResultImage('images/icon_gold.png');
    case 'scrap': return chestResultImage('images/icon_scrap.png');
    case 'essence': return chestResultImage('images/icon_essence.png');
    case 'ancientEssence': return chestResultImage('images/icon_ancient_essence.png');
    case 'dust': return chestResultImage('images/icon_divine_stone.png');
    case 'soulOrigin': return '🧿';
    case 'invitation': return '🎟';
    case 'skillXp': return '📘';
    case 'xp': return '⭐';
    case 'gem': return gemIconHTML(rw.type, rw.lv);
    case 'rune': return chestResultImage(runeStoneSrc(rw.id));
    case 'relic': return relicIconHTML(rw);
  }
  return '';
}

function chestEquipmentBadgesHTML(item) {
  var stars = item.ancientCount > 7
    ? '<span class="nfc-res-ancient-count"><span class="ancient-star">✡</span>×' + item.ancientCount + '</span>'
    : ancientStarBadgeHTML(item);
  return '<span class="nfc-res-badges" aria-hidden="true">' + stars + '<span class="ic-lv">' + item.level + '</span></span>';
}

function chestResultSlots(rewards) {
  var sorted = rewards.slice().sort(function (a, b) {
    var diff = (CHEST_RESULT_PRIORITY[a.k] ?? 2) - (CHEST_RESULT_PRIORITY[b.k] ?? 2);
    return diff || (a.k === 'equip' ? b.r - a.r : 0);
  });
  var slots = [], end = 0;
  function add(rw, item) {
    var rarity = rw.k === 'equip' ? RARITIES[rw.r] : rw.k === 'gem' ? RARITIES[rw.lv - 1] : null;
    var color = rarity ? ' style="--nfc-rarity:' + rarity.color + '"' : '';
    var cls = 'nfc-res-slot' + (rw.k === 'relic' ? ' is-relic' : '');
    var label = chestRewardName(rw), icon, badge = '';
    if (item) {
      label += ' ' + STR(1146, item.level) + ' ' + STR(1184, item.ancientCount);
      icon = item.icon ? chestResultImage('images/' + item.icon) : '⚔';
      badge = chestEquipmentBadgesHTML(item);
    } else {
      label = STR(2495, label, fmtFull(rw.n));
      icon = chestRewardIconHTML(rw);
      if (rw.n > 1) badge = '<b aria-hidden="true">×' + fmt(rw.n) + '</b>';
    }
    end += item ? item.n : 1;
    slots.push({ end: end, html: '<li class="' + cls + '"' + color + ' aria-label="' + chestUiEsc(label) + '">' +
      '<span class="nfc-res-ico" aria-hidden="true">' + icon + '</span>' + badge + '</li>' });
  }
  sorted.forEach(function (rw) {
    if (rw.k === 'equip') rw.items.forEach(function (item) { add(rw, item); });
    else add(rw);
  });
  return { slots: slots, total: end };
}

/* 只建立捲動位置附近的格子，全開也能逐件查看。 */
function chestBindResultGrid(viewport, rewards) {
  var grid = viewport.querySelector('.nfc-res-list');
  var track = grid.parentNode;
  var slots = rewards.slots, total = rewards.total;
  var columns = 1, stride = 1, first = -1, last = -1;
  viewport.style.setProperty('--nfc-count', Math.max(1, total));

  function render() {
    var startRow = Math.max(0, Math.floor(viewport.scrollTop / stride) - 1);
    var start = startRow * columns;
    var end = Math.min(total, Math.ceil((viewport.scrollTop + viewport.clientHeight) / stride + 1) * columns);
    if (start === first && end === last) return;
    first = start;
    last = end;
    grid.classList.remove('is-revealing');
    var html = '';
    for (var i = 0; i < slots.length && start < end; i++) {
      var slot = slots[i];
      var count = Math.min(end, slot.end) - start;
      if (count <= 0) continue;
      html += slot.html.repeat(count);
      start += count;
    }
    grid.style.top = (startRow * stride) + 'px';
    grid.innerHTML = html;
  }

  function resize() {
    var style = getComputedStyle(grid);
    var gap = parseFloat(style.rowGap);
    var nextStride = parseFloat(style.gridAutoRows) + gap;
    var nextColumns = style.gridTemplateColumns.split(' ').length;
    if (stride !== nextStride || columns !== nextColumns) first = -1;
    stride = nextStride;
    columns = nextColumns;
    track.style.height = Math.max(0, Math.ceil(total / columns) * stride - gap) + 'px';
    viewport.classList.toggle('is-scrollable', viewport.scrollHeight > viewport.clientHeight);
    render();
  }

  var drag = null;
  viewport.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse' || (e.button !== 0 && e.button !== 1) || viewport.scrollHeight <= viewport.clientHeight) return;
    e.preventDefault();
    drag = { id: e.pointerId, y: e.clientY, top: viewport.scrollTop };
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add('is-dragging');
  });
  viewport.addEventListener('pointermove', function (e) {
    if (drag && e.pointerId === drag.id) viewport.scrollTop = drag.top + drag.y - e.clientY;
  });
  viewport.addEventListener('lostpointercapture', function () {
    drag = null;
    viewport.classList.remove('is-dragging');
  });
  viewport.addEventListener('scroll', function () {
    grid.classList.remove('is-revealing');
    render();
  }, { passive: true });
  resize();
  var visible = Math.min(total, Math.ceil(viewport.clientHeight / stride) * columns);
  var step = Math.min(55, 1800 / Math.max(1, visible - 1));
  for (var i = 0; i < visible; i++) grid.children[i].style.setProperty('--nfc-reveal-delay', (i * step) + 'ms');
  grid.classList.add('is-revealing');
  var observer = new ResizeObserver(resize);
  observer.observe(viewport);
  return observer;
}

function chestShowResult(res) {
  var def = res && CHEST_BY_ID[res.chestId];
  if (!def) return;
  if ($id('nfc-result')) { CHEST_UI.results.push(res); return; }
  var summary = [STR(2518, def.name, fmtFull(res.opened))];
  if (res.doubled) summary.push(STR(2516, fmtFull(res.doubled)));
  var eq = res.equip || {};
  if (eq.forge || eq.inv || eq.salvaged) summary.push(STR(2517, fmtFull(eq.forge || 0), fmtFull(eq.inv || 0), fmtFull(eq.salvaged || 0)));
  var rewards = chestResultSlots(res.rewards);
  var el = document.createElement('dialog');
  el.id = 'nfc-result';
  el.className = 'nfc-result';
  el.setAttribute('aria-label', summary.join(' '));
  el.innerHTML = '<div class="nfc-res-content"><div class="nfc-res-art">' +
    chestResultImage('images/chests/' + (CHEST_ART_FILES[def.quality] || CHEST_ART_FILES.common) + '.webp') + '</div>' +
    '<div class="nfc-res-scroll" tabindex="0"' + (rewards.total ? '' : ' hidden') + '><div class="nfc-res-track">' +
    '<ul class="nfc-res-list" role="list"></ul></div></div>' +
    '<button type="button" class="btn primary nfc-res-confirm" autofocus>' + chestUiEsc(STR(149)) + '</button></div>';
  hideTooltip();
  ($id('ui-stage') || document.body).appendChild(el);
  el.showModal();
  var observer = rewards.total ? chestBindResultGrid(el.querySelector('.nfc-res-scroll'), rewards) : null;
  function dismiss() {
    if (observer) observer.disconnect();
    el.close();
    el.remove();
    if (CHEST_UI.results.length) chestShowResult(CHEST_UI.results.shift());
  }
  el.addEventListener('cancel', function (e) {
    e.preventDefault();
    dismiss();
  });
  el.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (!e.repeat && !e.isComposing) dismiss();
  });
  el.querySelector('.nfc-res-confirm').addEventListener('click', dismiss);
}

/* ---- 事件委派（容器本身不重建，只綁一次） ---- */
function chestUiBind(box) {
  if (CHEST_UI.bound) return;
  CHEST_UI.bound = true;
  box.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var open = t.closest('[data-chest-open]');
    if (open) {
      var id = parseInt(open.getAttribute('data-chest-open'), 10);
      if (chestUiPending(id)) return;
      var snap = typeof uiNewForgePanelSnapshot === 'function' ? uiNewForgePanelSnapshot() : null;
      var st = chestEntry(CHEST_BY_ID[id], snap && snap.chests && snap.chests[id]);
      var count = open.getAttribute('data-chest-count') === 'all' ? Math.min(CHEST_MAX_COUNT, Math.max(1, st.n)) : 1;
      sendUiCommand('chest.open', { chestId: id, count: count }, {
        keys: [chestUiPendingKey(id)], panels: ['newforge', 'header']
      }).then(function (res) {
        if (res && typeof res === 'object' && res.rewards) chestShowResult(res);
      }).catch(function (error) { reportUiCommandFailure(STR(2519), error, ['newforge']); });
      return;
    }
    var up = t.closest('[data-chest-upgrade]');
    if (up) {
      var uid2 = parseInt(up.getAttribute('data-chest-upgrade'), 10);
      if (chestUiPending(uid2)) return;
      sendUiCommand('chest.upgrade', { chestId: uid2 }, {
        keys: [chestUiPendingKey(uid2)], panels: ['newforge', 'header']
      }).catch(function (error) { reportUiCommandFailure(STR(2520), error, ['newforge', 'header']); });
    }
  });
}
