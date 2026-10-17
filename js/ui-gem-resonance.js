'use strict';
/* ============ 寶石共鳴頁（寶石分頁的「共鳴」工具） ============
   資料表在 js/gem_resonance_data.js、規則與屬性算法在 js/gem_resonance.js（兩端共載，純函式）。
   本檔只讀面板快照（gems 面板的 resonance 欄位、庫存 gems）並送指令，不碰 G。
   版面：49 個六角孔以 SVG 畫成「六個外圍區環繞中央區」，點孔後篩選左側庫存，點擊／拖曳鑲入，右側只顯示孔內寶石與升級操作。 */

var GRES_CELL = 22;                                    // 六角孔外接圓半徑（SVG 單位）
var GRES_SPACING = Math.sqrt(3) * GRES_CELL;           // 相鄰孔中心距
var GRES_REGION_DIST = GRES_SPACING * 3.15;            // 外圍區中心到中央區中心的距離（略大於三格，區與區之間留縫）
var GRES_LABEL_DIST = GRES_REGION_DIST + GRES_SPACING + GRES_CELL + 12;
var GRES_VIEW = 206;                                   // viewBox 為 [-GRES_VIEW, GRES_VIEW]
var GRES_REGION_COLORS = [260, 215, 175, 35, 120, 0, 48]; // 各區色相（與區域順序一致）

/* 方位 i（0＝正上方，順時針每 60°）的單位向量。 */
function gresDir(i) {
  var a = i * Math.PI / 3;
  return { x: Math.sin(a), y: -Math.cos(a) };
}
function gresRegionCenter(region) {
  if (region >= 6) return { x: 0, y: 0 };
  var d = gresDir(region);
  return { x: d.x * GRES_REGION_DIST, y: d.y * GRES_REGION_DIST };
}
function gresHoleCenter(region, hole) {
  var c = gresRegionCenter(region);
  if (hole === 0) return c;
  var d = gresDir(hole - 1);
  return { x: c.x + d.x * GRES_SPACING, y: c.y + d.y * GRES_SPACING };
}
function gresHexPoints(c) {
  var pts = [];
  for (var j = 0; j < 6; j++) {
    var a = j * Math.PI / 3;
    pts.push((c.x + GRES_CELL * Math.cos(a)).toFixed(1) + ',' + (c.y + GRES_CELL * Math.sin(a)).toFixed(1));
  }
  return pts.join(' ');
}

function gresSnapshotState(snapshot) {
  return (snapshot && snapshot.resonance) || { holes: {} };
}
function gresSelected() {
  var sel = UI.gemBrowse.resHole;
  return (sel && resonanceValidHole(sel[0], sel[1])) ? sel : [GEM_RESONANCE_REGIONS.length - 1, 0];
}

function gresStatText(type, value) {
  var gt = GEM_TYPES[type];
  return esc(gt.statName.replace(/%/g, '')) + ' +' + (gt.pct ? pctStr(value) : fmt(value));
}

/* ---- 盤面 ---- */
function gresBoardHTML(state, sel) {
  var h = '<svg viewBox="' + (-GRES_VIEW) + ' ' + (-GRES_VIEW) + ' ' + (GRES_VIEW * 2) + ' ' + (GRES_VIEW * 2) + '" class="gres-svg" role="group" aria-label="寶石共鳴盤面">';
  GEM_RESONANCE_REGIONS.forEach(function (reg, r) {
    var hue = GRES_REGION_COLORS[r % GRES_REGION_COLORS.length];
    for (var hole = 0; hole < RESONANCE_HOLE_COUNT; hole++) {
      var c = gresHoleCenter(r, hole);
      var slot = resonanceHoleState(state, r, hole);
      var min = resonanceHoleMinLevel(r, hole);
      var on = sel[0] === r && sel[1] === hole;
      h += '<g class="gres-hole' + (slot.gems.length ? ' is-filled' : '') + (on ? ' is-sel' : '') + '" data-gres-hole="' + r + ':' + hole + '" role="button" tabindex="0" aria-label="' + esc(reg.name + '區' + (hole === 0 ? '中心孔' : '外圈孔 ' + hole)) + '" style="--h:' + hue + '">' +
        '<polygon points="' + gresHexPoints(c) + '"/>';
      if (slot.gems.length) {
        var g = slot.gems[0];
        h += '<image href="' + gemIconSrc(g.type, g.level) + '" x="' + (c.x - 14).toFixed(1) + '" y="' + (c.y - 15).toFixed(1) + '" width="28" height="28"/>';
        if (resonanceHoleCap(r, hole) > 1) h += '<text class="gres-cap" x="' + (c.x + 12).toFixed(1) + '" y="' + (c.y - 9).toFixed(1) + '">' + slot.gems.length + '/' + resonanceHoleCap(r, hole) + '</text>';
      } else {
        h += '<text class="gres-min" x="' + c.x.toFixed(1) + '" y="' + (c.y + 5).toFixed(1) + '">' + min + '</text>';
      }
      if (slot.lv) h += '<text class="gres-lv" x="' + c.x.toFixed(1) + '" y="' + (c.y + 16).toFixed(1) + '">Lv' + slot.lv + '</text>';
      h += '</g>';
    }
    var lc;
    if (r >= 6) lc = { x: 0, y: 0 };
    else { var d = gresDir(r); lc = { x: d.x * GRES_LABEL_DIST, y: d.y * GRES_LABEL_DIST }; }
    if (r < 6) {
      var anchor = 'middle';
      h += '<text class="gres-region" style="--h:' + hue + '" x="' + lc.x.toFixed(1) + '" y="' + (lc.y + 4).toFixed(1) + '" text-anchor="' + anchor + '">' + esc(reg.name) + '</text>';
    }
  });
  // 最後才畫選中框，避免相鄰孔的填色蓋住共用邊；此層不攔截點擊或拖放。
  return h + '<polygon class="gres-selection-outline" aria-hidden="true" points="' + gresHexPoints(gresHoleCenter(sel[0], sel[1])) + '"/>' + '</svg>';
}

/* ---- 右側：選中孔的詳情與操作 ---- */
function gresCandidates(snapshot, region, hole) {
  var reg = GEM_RESONANCE_REGIONS[region];
  var min = resonanceHoleMinLevel(region, hole);
  var out = [];
  Object.keys(GEM_TYPES).forEach(function (type) {
    if (!isGemEnabled(type) || (reg.types && reg.types.indexOf(type) === -1)) return;
    for (var lv = min; lv <= GEM_FORGE_MAX_LEVEL; lv++) {
      var n = gemsViewCount(snapshot, type, lv);
      if (n > 0) out.push({ type: type, lv: lv, n: n });
    }
  });
  return out;
}

/* 左側只列出選中孔可用的確切階級，沿用同一份庫存與共鳴規則。 */
function gresCanSocket(snapshot, region, hole, gem) {
  if (!snapshot || !gem || !resonanceValidHole(region, hole) || !GEM_TYPES[gem.type] || !isGemEnabled(gem.type)) return false;
  if (!Number.isInteger(gem.level) || gem.level < resonanceHoleMinLevel(region, hole) || gem.level > GEM_FORGE_MAX_LEVEL) return false;
  if (!resonanceTypeAllowed(region, gem.type) || gemsViewCount(snapshot, gem.type, gem.level) <= 0) return false;
  return resonanceHoleState(gresSnapshotState(snapshot), region, hole).gems.length < resonanceHoleCap(region, hole);
}

function gresRenderLibrary(snapshot, box) {
  var sel = gresSelected(), state = gresSnapshotState(snapshot);
  var full = resonanceHoleState(state, sel[0], sel[1]).gems.length >= resonanceHoleCap(sel[0], sel[1]);
  var list = full ? [] : gresCandidates(snapshot, sel[0], sel[1]);
  var filter = UI.gemBrowse.resFilter || 'all';
  list = list.filter(function (g) { return filter === 'all' || gemCategoryOf(g.type) === filter; });
  var note = $id('gres-library-note');
  if (note) {
    note.hidden = false;
    note.textContent = GEM_RESONANCE_REGIONS[sel[0]].name + '區・' + (sel[1] ? '外圈孔 ' + sel[1] : '中心孔') + '｜' + GEM_NAMES[resonanceHoleMinLevel(sel[0], sel[1])] + '以上';
  }
  // 原生拖曳持有來源節點；即時掉落不得在拖曳中替換它。
  if (UI.gemBrowse.resDrag) return;
  var keys = [], htmls = [];
  list.forEach(function (g) {
    var key = g.type + ':' + g.lv;
    keys.push(key);
    htmls.push('<button type="button" class="gx-item gres-library-gem" data-gres-gem="' + key + '" draggable="true" aria-label="鑲入' + esc(GEM_NAMES[g.lv] + GEM_TYPES[g.type].name) + '">' +
      '<span class="gx-ico" style="--c:' + GEM_TIER_COLORS[g.lv] + '">' + gemIconHTML(g.type, g.lv, 'gi-lib') + '</span><span class="gx-item-main">' +
      '<span class="gx-item-top"><b>' + esc(GEM_NAMES[g.lv] + GEM_TYPES[g.type].name) + '</b><span class="gx-item-total">×' + fmt(g.n) + '</span></span>' +
      '<span class="gx-item-stat">' + esc(gemAbilityText(g.type, g.lv)) + '</span></span></button>');
  });
  if (!list.length) {
    keys.push('resonance-empty');
    htmls.push('<div class="gx-empty">' + (full ? '此孔已滿，請先取下寶石或選擇其他孔位' : '目前沒有符合此孔與分類的寶石') + '</div>');
  }
  box._lastH = null;
  syncItemGridCells(box, keys, htmls);
}

function gresSelectHole(region, hole) {
  if (!resonanceValidHole(region, hole)) return;
  UI.gemBrowse.resHole = [region, hole];
  UI.gemBrowse.resFilter = 'all';
  renderGems();
}

function gresSocketFromLibrary(gem, region, hole) {
  if (!gresCanSocket(uiGemsPanelSnapshot(), region, hole, gem)) return false;
  UI.gemBrowse.sel = gem.type;
  UI.gemBrowse.fuseLv = gem.level;
  sendGemUiCommand('gem.resonanceSocket', { region: region, hole: hole, type: gem.type, level: gem.level }, 'gem-resonance');
  return true;
}

function gresDetailHTML(snapshot, headerSnapshot, state, sel) {
  var region = sel[0], hole = sel[1];
  var reg = GEM_RESONANCE_REGIONS[region];
  var slot = resonanceHoleState(state, region, hole);
  var cap = resonanceHoleCap(region, hole);
  var min = resonanceHoleMinLevel(region, hole);
  var s = GEM_RESONANCE_SETTINGS;
  var h = '<div class="gres-title"><b>' + esc(reg.name) + '區</b>・' + (hole === 0 ? '中心孔' : '外圈孔 ' + hole) +
    '<span class="gres-sub">需 ' + esc(GEM_NAMES[min]) + '以上｜容量 ' + cap + '</span></div>';
  h += '<div class="gres-types">' + (reg.types ? reg.types.filter(isGemEnabled).map(function (t) { return esc(GEM_TYPES[t].name); }).join('、') : '不限寶石種類') + '</div>';

  h += '<div class="gres-slots">';
  for (var i = 0; i < cap; i++) {
    var g = slot.gems[i];
    h += g
      ? '<button type="button" class="gres-gem" data-gres-take="' + i + '" data-tip="點擊取下">' + gemIconHTML(g.type, g.level, 'gi-slot') +
        '<span>' + esc(GEM_NAMES[g.level] + GEM_TYPES[g.type].name) + '<small>' + gresStatText(g.type, gemStatValue(g.type, g.level)) + '</small></span></button>'
      : '<div class="gres-gem is-empty">空孔</div>';
  }
  h += '</div>';

  var bonusPct = Math.round(resonanceBonusMult(slot.lv) * 100);
  h += '<div class="gres-lvrow"><b>孔等級 Lv.' + slot.lv + ' / ' + resonanceMaxHoleLevel() + '</b>' +
    '<span>相鄰加成 +' + bonusPct + '%（上限 ' + s.maxPct + '%）</span></div>';
  var cost = resonanceUpgradeCost(slot.lv);
  if (!cost) {
    h += '<div class="gres-cost">已達等級上限</div>';
  } else {
    var count = function (t, lv) { return gemsViewCount(snapshot, t, lv); };
    var type = resonanceUpgradePayType(region, slot, cost, count);
    var player = headerSnapshot && headerSnapshot.player;
    var gold = player ? player.gold : 0;
    var have = type ? count(type, cost.gemLv) : 0;
    var ok = gold >= cost.gold && !!type && have >= cost.gemCount;
    var gemText = type
      ? gemIconHTML(type, cost.gemLv, 'gi-inline') + esc(GEM_NAMES[cost.gemLv] + GEM_TYPES[type].name) + ' ×' + cost.gemCount + '（持有 ' + fmt(have) + '）'
      : esc(GEM_NAMES[cost.gemLv]) + '本區寶石 ×' + cost.gemCount + '（任一種，目前不足）';
    h += '<div class="gres-cost">升到 Lv.' + (slot.lv + 1) + '：<span class="' + (gold >= cost.gold ? '' : 'is-short') + '"><img src="images/icon_gold.png" class="res-icon">' + fmt(cost.gold) + '</span>＋' +
      '<span class="' + (type && have >= cost.gemCount ? '' : 'is-short') + '">' + gemText + '</span></div>' +
      '<button type="button" class="btn" data-gres-upgrade="1"' + (ok ? '' : ' disabled') + '>⬆️ 升級此孔</button>';
  }

  h += '<div class="gres-library-hint">' + (slot.gems.length < cap
    ? '左側已篩選可鑲寶石；點擊直接鑲入，或拖曳至盤面孔位。'
    : '此孔已滿；點擊上方寶石取下，或選擇其他孔位。') + '</div>';
  return h;
}

/* 共鳴總加成：把所有貢獻依能力合併顯示（未計寶石鑲嵌效率，實際數值以屬性面板為準）。 */
function gresTotalHTML(state) {
  var sums = {}, order = [];
  resonanceEntries(state).forEach(function (e) {
    var gt = GEM_TYPES[e.type];
    if (!gt) return;
    if (!(e.type in sums)) { sums[e.type] = 0; order.push(e.type); }
    sums[e.type] += gemStatValue(e.type, e.level) * e.mult;
  });
  if (!order.length) return '<div class="gres-empty">尚未鑲入任何寶石</div>';
  return '<div class="sec-sub">共鳴總加成（未計鑲嵌效率）</div><div class="gres-list">' +
    order.map(function (t) { return '<div>' + gresStatText(t, sums[t]) + '</div>'; }).join('') + '</div>';
}

function renderGemResonance(gemsSnapshot, headerSnapshot) {
  var board = $id('gres-board');
  if (!board) return;
  gemsSnapshot = resolveGemsPanelSnapshot(gemsSnapshot);
  headerSnapshot = headerSnapshot || uiHeaderPanelSnapshot();
  if (!gemsSnapshot) return;
  var help = $id('gres-help');
  if (help && !help._set) {
    help._set = true;
    help.setAttribute('data-tt-desc', '把寶石鑲進共鳴孔：孔內寶石直接提供自己的能力；升級孔，還會額外獲得相鄰孔寶石的能力（每級 +' +
      GEM_RESONANCE_SETTINGS.perLevelPct + '%，最高 +' + GEM_RESONANCE_SETTINGS.maxPct + '%）。外圍六區各限定寶石種類，中央區不限；孔上的數字是該孔要求的最低寶石階級。孔不需要鑲寶石也能升級。點孔查看與操作。');
  }
  var state = gresSnapshotState(gemsSnapshot);
  var sel = gresSelected();
  var boardH = gresBoardHTML(state, sel);
  if (board._lastH !== boardH) { board._lastH = boardH; board.innerHTML = boardH; }
  var detail = $id('gres-detail');
  var detailH = gresDetailHTML(gemsSnapshot, headerSnapshot, state, sel);
  if (detail && detail._lastH !== detailH) { detail._lastH = detailH; detail.innerHTML = detailH; }
  var total = $id('gres-total');
  var totalH = gresTotalHTML(state);
  if (total && total._lastH !== totalH) { total._lastH = totalH; total.innerHTML = totalH; }
}

function initGemResonanceUi() {
  var board = $id('gres-board'), detail = $id('gres-detail'), library = $id('gem-table');
  function holeAt(e) { return e.target && e.target.closest ? e.target.closest('[data-gres-hole]') : null; }
  function clearDrop() {
    if (board) board.querySelectorAll('.is-drop, .is-reject').forEach(function (n) { n.classList.remove('is-drop', 'is-reject'); });
  }
  function stopDrag() { UI.gemBrowse.resDrag = null; clearDrop(); renderGems(); }
  if (library) {
    library.addEventListener('click', function (e) {
      var source = e.target.closest ? e.target.closest('[data-gres-gem]') : null;
      if (!source || UI.gemBrowse.tool !== 'resonance') return;
      var key = source.getAttribute('data-gres-gem').split(':'), sel = gresSelected();
      gresSocketFromLibrary({ type: key[0], level: Number(key[1]) }, sel[0], sel[1]);
    });
    library.addEventListener('dragstart', function (e) {
      var source = e.target.closest ? e.target.closest('[data-gres-gem]') : null;
      if (!source || UI.gemBrowse.tool !== 'resonance' || !e.dataTransfer) return;
      if (typeof bossFightConfigLocked === 'function' && bossFightConfigLocked()) { e.preventDefault(); return; }
      var key = source.getAttribute('data-gres-gem').split(':'), sel = gresSelected();
      var gem = { type: key[0], level: Number(key[1]) };
      if (!gresCanSocket(uiGemsPanelSnapshot(), sel[0], sel[1], gem)) { e.preventDefault(); return; }
      UI.gemBrowse.resDrag = gem;
      e.dataTransfer.setData('application/x-idle-rpg-gem', JSON.stringify(gem));
      e.dataTransfer.effectAllowed = 'move';
    });
    library.addEventListener('dragend', stopDrag);
  }
  if (board) {
    board.addEventListener('click', function (e) {
      var hole = holeAt(e);
      if (!hole) return;
      var parts = hole.getAttribute('data-gres-hole').split(':');
      gresSelectHole(Number(parts[0]), Number(parts[1]));
    });
    board.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && holeAt(e)) { e.preventDefault(); holeAt(e).dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    });
    board.addEventListener('dragover', function (e) {
      var hole = holeAt(e), gem = UI.gemBrowse.resDrag;
      clearDrop();
      if (!hole || !gem) return;
      var parts = hole.getAttribute('data-gres-hole').split(':');
      var ok = gresCanSocket(uiGemsPanelSnapshot(), Number(parts[0]), Number(parts[1]), gem);
      hole.classList.add(ok ? 'is-drop' : 'is-reject');
      if (ok) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
    });
    board.addEventListener('dragleave', function (e) { if (!board.contains(e.relatedTarget)) clearDrop(); });
    board.addEventListener('drop', function (e) {
      var hole = holeAt(e), gem = UI.gemBrowse.resDrag;
      e.preventDefault();
      if (hole && gem) {
        var parts = hole.getAttribute('data-gres-hole').split(':');
        if (gresSocketFromLibrary(gem, Number(parts[0]), Number(parts[1]))) {
          UI.gemBrowse.resHole = [Number(parts[0]), Number(parts[1])];
          UI.gemBrowse.resFilter = 'all';
        }
      }
      stopDrag();
    });
  }
  if (detail) {
    detail.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var sel = gresSelected(), base = { region: sel[0], hole: sel[1] };
      var take = t.closest('[data-gres-take]');
      if (take) {
        sendGemUiCommand('gem.resonanceUnsocket', { region: base.region, hole: base.hole, index: parseInt(take.getAttribute('data-gres-take'), 10) }, 'gem-resonance');
        return;
      }
      if (t.closest('[data-gres-upgrade]')) sendGemUiCommand('gem.resonanceUpgrade', base, 'gem-resonance');
    });
  }
}
