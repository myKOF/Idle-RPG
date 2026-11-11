'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
/* ============ 熔爐寶箱區（主執行緒） ============
   熔爐頁上方的置頂寶箱列（index.html #nf-chests）。只讀 newforge 面板的 chests（{ 編號: { lv, xp, n, on } }）
   與 header 面板的金幣；定義、升級費用、掉落機率用兩端共載的 js/chest.js 純函式算，與 Worker 扣款同一支。
   開啟／升級送 chest.open／chest.upgrade，開啟結果以浮層列出。
   版面：寶箱結構（解鎖、等級、存滿）改變才整段重建；經驗條、數量、按鈕狀態每次快照定點更新，
   避免拆解每 2 秒改一次經驗就把滑鼠底下的提示整個換掉。
   寶箱圖是程序化 SVG（本檔 chestArtSVG），依品質換配色；未解鎖時本體置灰並加鎖鏈與掛鎖。 */

var CHEST_UI = { bound: false, sig: '', resultTimer: 0 };

/* 品質配色：body＝箱體木料、metal＝金屬包邊、glow＝背光 */
var CHEST_ART_PALETTES = {
  common:    { body: ['#8a5a2e', '#4e2f14'], lid: ['#9c6834', '#5a3517'], metal: ['#f0b77a', '#b87333', '#6e4420'], glow: '#d98a3d', gem: null },
  rare:      { body: ['#2f5aa8', '#16295a'], lid: ['#3b6cc4', '#1b3370'], metal: ['#eef4ff', '#9fb2cf', '#55657f'], glow: '#38bdf8', gem: '#7dd3fc' },
  epic:      { body: ['#6b3fa0', '#2e1550'], lid: ['#7d4bbb', '#371a60'], metal: ['#f1e6ff', '#b79be6', '#6b4f99'], glow: '#c084fc', gem: '#e879f9' },
  legendary: { body: ['#c2541a', '#5e2207'], lid: ['#d8662a', '#6d290a'], metal: ['#fff0b8', '#e3a83a', '#8a5a12'], glow: '#fb923c', gem: '#fde047' },
  mythic:    { body: ['#3a2c10', '#120d04'], lid: ['#4a3814', '#171006'], metal: ['#fff3c4', '#f5c542', '#7a5a0c'], glow: '#f5c542', gem: '#ef4444' }
};

function chestUiEsc(s) { return esc(String(s)); }
function chestUiPendingKey(id) { return nodePendingKey('chest:' + id); }
function chestUiPending(id) { return typeof isUiCommandPending === 'function' && isUiCommandPending(chestUiPendingKey(id)); }

/* ---- 寶箱圖（SVG） ---- */
function chestArtSVG(def, locked) {
  var q = CHEST_ART_PALETTES[def.quality] ? def.quality : 'common', pal = CHEST_ART_PALETTES[q];
  var id = 'nfc-' + q; // 同品質的漸層定義相同，重複出現無妨
  var m = pal.metal;
  var defs = '<defs>' +
    '<linearGradient id="' + id + '-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + pal.body[0] + '"/><stop offset="1" stop-color="' + pal.body[1] + '"/></linearGradient>' +
    '<linearGradient id="' + id + '-lid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + pal.lid[0] + '"/><stop offset="1" stop-color="' + pal.lid[1] + '"/></linearGradient>' +
    '<linearGradient id="' + id + '-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + m[0] + '"/><stop offset=".45" stop-color="' + m[1] + '"/><stop offset="1" stop-color="' + m[2] + '"/></linearGradient>' +
    '<radialGradient id="' + id + '-glow" cx=".5" cy=".55" r=".5"><stop offset="0" stop-color="' + pal.glow + '" stop-opacity=".55"/><stop offset="1" stop-color="' + pal.glow + '" stop-opacity="0"/></radialGradient>' +
    '<clipPath id="' + id + '-lidclip"><path d="M16 47V34Q16 15 60 15Q104 15 104 34V47Z"/></clipPath>' +
    '<linearGradient id="nfc-chain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d7dbe2"/><stop offset=".5" stop-color="#8b9099"/><stop offset="1" stop-color="#3c4048"/></linearGradient>' +
    '</defs>';
  var lid = 'url(#' + id + '-lid)', body = 'url(#' + id + '-body)', metal = 'url(#' + id + '-metal)';
  var chest = '<g class="nfc-art-chest">' +
    (locked ? '' : '<ellipse class="nfc-art-glow" cx="60" cy="54" rx="60" ry="46" fill="url(#' + id + '-glow)"/>') +
    '<ellipse cx="60" cy="92" rx="46" ry="5" fill="#000" opacity=".5"/>' +
    // 箱體＋木板紋
    '<rect x="16" y="47" width="88" height="41" rx="3" fill="' + body + '" stroke="#0b0805" stroke-width="1.5"/>' +
    '<path d="M18 61H102M18 75H102" stroke="#000" stroke-opacity=".32" stroke-width="1.2"/>' +
    // 箱蓋＋木板紋（以箱蓋形狀裁切包邊）
    '<path d="M16 47V34Q16 15 60 15Q104 15 104 34V47Z" fill="' + lid + '" stroke="#0b0805" stroke-width="1.5"/>' +
    '<g clip-path="url(#' + id + '-lidclip)">' +
    '<path d="M16 30Q60 20 104 30M16 39Q60 31 104 39" stroke="#000" stroke-opacity=".3" stroke-width="1.1" fill="none"/>' +
    '<rect x="27" y="10" width="9" height="40" fill="' + metal + '"/><rect x="84" y="10" width="9" height="40" fill="' + metal + '"/>' +
    '<path d="M22 24Q60 12 98 24" stroke="#fff" stroke-opacity=".22" stroke-width="3" fill="none"/>' +
    '</g>' +
    // 包邊：箱口、底緣、直條、角釘
    '<rect x="27" y="50" width="9" height="36" fill="' + metal + '"/><rect x="84" y="50" width="9" height="36" fill="' + metal + '"/>' +
    '<rect x="13" y="44" width="94" height="7" rx="2" fill="' + metal + '" stroke="#0b0805" stroke-width="1"/>' +
    '<rect x="13" y="84" width="94" height="6" rx="2" fill="' + metal + '" stroke="#0b0805" stroke-width="1"/>' +
    '<circle cx="31.5" cy="58" r="1.6" fill="#1a1208"/><circle cx="31.5" cy="78" r="1.6" fill="#1a1208"/>' +
    '<circle cx="88.5" cy="58" r="1.6" fill="#1a1208"/><circle cx="88.5" cy="78" r="1.6" fill="#1a1208"/>' +
    // 鎖扣與鑰匙孔
    '<path d="M49 39H71V58Q71 64 60 66Q49 64 49 58Z" fill="' + metal + '" stroke="#0b0805" stroke-width="1.2"/>' +
    (pal.gem ? '<circle cx="60" cy="45" r="3.2" fill="' + pal.gem + '" stroke="#0b0805" stroke-width=".8"/><circle cx="59" cy="44" r="1" fill="#fff" opacity=".8"/>' : '') +
    '<circle cx="60" cy="53" r="2.6" fill="#140d05"/><path d="M58.8 54.5H61.2L62 60H58Z" fill="#140d05"/>' +
    '</g>';
  var lock = '';
  if (locked) {
    // 兩條交叉鎖鏈：沿對角線排列交錯的鏈環
    var chainLinks = function (x1, y1, x2, y2) {
      var out = '', steps = 9, ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      for (var i = 0; i <= steps; i++) {
        var x = x1 + (x2 - x1) * i / steps, y = y1 + (y2 - y1) * i / steps;
        out += i % 2
          ? '<rect x="' + (x - 6).toFixed(1) + '" y="' + (y - 1.6).toFixed(1) + '" width="12" height="3.2" rx="1.6" fill="url(#nfc-chain)" stroke="#202328" stroke-width=".8" transform="rotate(' + ang.toFixed(1) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1) + ')"/>'
          : '<ellipse cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" rx="6.5" ry="3.8" fill="none" stroke="url(#nfc-chain)" stroke-width="2.6" transform="rotate(' + ang.toFixed(1) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1) + ')"/>';
      }
      return out;
    };
    lock = '<g class="nfc-art-lock">' + chainLinks(10, 26, 110, 84) + chainLinks(110, 26, 10, 84) +
      '<path d="M51 55V48A9 9 0 0 1 69 48V55" fill="none" stroke="#2b2e34" stroke-width="6"/>' +
      '<path d="M51 55V48A9 9 0 0 1 69 48V55" fill="none" stroke="url(#nfc-chain)" stroke-width="3.6"/>' +
      '<rect x="45" y="54" width="30" height="24" rx="4" fill="url(#nfc-chain)" stroke="#1d2025" stroke-width="1.4"/>' +
      '<circle cx="60" cy="63" r="3" fill="#15171b"/><path d="M58.6 64.5H61.4L62.2 71H57.8Z" fill="#15171b"/>' +
      '</g>';
  }
  return '<svg class="nfc-art-svg" viewBox="0 0 120 100" aria-hidden="true" focusable="false">' + defs + chest + lock + '</svg>';
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
  var cls = 'nfc-card q-' + (CHEST_ART_PALETTES[def.quality] ? def.quality : 'common') + (locked ? ' is-locked' : '') + (maxed ? ' is-max' : '');
  var h = '<article class="' + cls + '" data-chest-id="' + def.id + '">';
  h += '<div class="nfc-art"' + (locked ? '' : ' data-tt-title="' + chestUiEsc(def.name) + '" data-tt-desc="' + chestUiEsc(chestDropTipHTML(def, st)) + '"') + '>' +
    chestArtSVG(def, locked) +
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
    var keepResult = box.querySelector('.nfc-result');
    box.innerHTML = '<div class="nfc-head"><span class="nfc-head-title">' + chestUiEsc(STR(2483)) + '</span>' + help + '</div>' +
      '<div class="nfc-row">' + CHESTS.map(function (def) { return chestCardHTML(def, chestUiState(store, def)); }).join('') + '</div>';
    if (keepResult) box.appendChild(keepResult);
    row = box.querySelector('.nfc-row');
  }
  CHESTS.forEach(function (def) {
    var card = row.querySelector('[data-chest-id="' + def.id + '"]');
    if (card) chestUpdateCard(card, def, chestUiState(store, def), gold);
  });
}

/* ---- 開啟結果浮層 ---- */
function chestRewardIconHTML(rw) {
  var img = function (src) { return '<img src="' + src + '" class="res-icon" alt="">'; };
  switch (rw.k) {
    case 'gold': return img('images/icon_gold.png');
    case 'scrap': return img('images/icon_scrap.png');
    case 'essence': return img('images/icon_essence.png');
    case 'ancientEssence': return img('images/icon_ancient_essence.png');
    case 'dust': return img('images/icon_divine_stone.png');
    case 'soulOrigin': return '🧿';
    case 'invitation': return '🎟';
    case 'skillXp': return '📘';
    case 'xp': return '⭐';
    case 'gem': return typeof gemIconHTML === 'function' ? gemIconHTML(rw.type, rw.lv, 'nfc-res-gem') : '💎';
    case 'rune': return typeof runeStoneSrc === 'function' ? img(runeStoneSrc(rw.id)) : '🔹';
    case 'relic': return typeof relicIconPath === 'function' ? img(relicIconPath(rw.id)) : '🏺';
    case 'equip': return '<span class="nfc-res-eq" style="color:' + (RARITIES[rw.r] ? RARITIES[rw.r].color : '#ccc') + '">⚔</span>';
  }
  return '';
}
function chestShowResult(res) {
  var box = $id('nf-chests');
  var def = res && CHEST_BY_ID[res.chestId];
  if (!box || !def) return;
  var old = box.querySelector('.nfc-result');
  if (old) old.parentNode.removeChild(old);
  var rows = (res.rewards || []).map(function (rw) {
    var style = rw.k === 'equip' && RARITIES[rw.r] ? ' style="color:' + RARITIES[rw.r].color + '"' : '';
    return '<li><span class="nfc-res-ico">' + chestRewardIconHTML(rw) + '</span><span class="nfc-res-name"' + style + '>' + chestUiEsc(chestRewardName(rw)) + '</span><b>×' + fmtFull(rw.n) + '</b></li>';
  }).join('');
  var notes = '';
  if (res.doubled) notes += '<div class="nfc-res-note">' + chestUiEsc(STR(2516, fmtFull(res.doubled))) + '</div>';
  var eq = res.equip || {};
  if (eq.forge || eq.inv || eq.salvaged) notes += '<div class="nfc-res-note">' + chestUiEsc(STR(2517, fmtFull(eq.forge || 0), fmtFull(eq.inv || 0), fmtFull(eq.salvaged || 0))) + '</div>';
  var el = document.createElement('div');
  el.className = 'nfc-result q-' + def.quality;
  el.setAttribute('role', 'status');
  el.innerHTML = '<div class="nfc-res-head"><b>' + chestUiEsc(STR(2518, def.name, fmtFull(res.opened))) + '</b>' +
    '<button type="button" class="modal-x nfc-res-close" data-chest-result-close="1" aria-label="' + chestUiEsc(STR(155)) + '">✕</button></div>' +
    '<ul class="nfc-res-list">' + rows + '</ul>' + notes;
  box.appendChild(el);
  clearTimeout(CHEST_UI.resultTimer);
  CHEST_UI.resultTimer = setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 8000);
}

/* ---- 事件委派（容器本身不重建，只綁一次） ---- */
function chestUiBind(box) {
  if (CHEST_UI.bound) return;
  CHEST_UI.bound = true;
  box.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var close = t.closest('[data-chest-result-close]');
    if (close) { var r = close.closest('.nfc-result'); if (r) r.parentNode.removeChild(r); return; }
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
