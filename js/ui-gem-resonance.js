'use strict';
/* ============ 寶石共鳴頁（寶石分頁的「共鳴」工具） ============
   資料表在 js/gem_resonance_data.js、規則與屬性算法在 js/gem_resonance.js（兩端共載，純函式）。
   本檔只讀面板快照（gems 面板的 resonance 欄位、庫存 gems）並送指令，不碰 G。
   版面：49 個六角孔以 SVG 畫成「六個外圍區環繞中央區」，點孔後右側顯示該孔的鑲嵌與升級操作。 */

var GRES_CELL = 22;                                    // 六角孔外接圓半徑（SVG 單位）
var GRES_SPACING = Math.sqrt(3) * GRES_CELL;           // 相鄰孔中心距
var GRES_REGION_DIST = GRES_SPACING * 3.15;            // 外圍區中心到中央區中心的距離（略大於三格，區與區之間留縫）
var GRES_LABEL_DIST = GRES_REGION_DIST + GRES_SPACING + GRES_CELL + 12;
var GRES_VIEW = 236;                                   // viewBox 為 [-GRES_VIEW, GRES_VIEW]
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
      h += '<g class="gres-hole' + (slot.gems.length ? ' is-filled' : '') + (on ? ' is-sel' : '') + '" data-gres-hole="' + r + ':' + hole + '" style="--h:' + hue + '">' +
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
      var anchor = lc.x > 8 ? 'start' : (lc.x < -8 ? 'end' : 'middle');
      h += '<text class="gres-region" style="--h:' + hue + '" x="' + lc.x.toFixed(1) + '" y="' + (lc.y + 4).toFixed(1) + '" text-anchor="' + anchor + '">' + esc(reg.name) + '</text>';
    }
  });
  return h + '</svg>';
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
  } else if (!slot.gems.length) {
    h += '<div class="gres-cost">鑲入寶石後才能升級（升級消耗該孔寶石種類的寶石）</div>';
  } else {
    var type = slot.gems[0].type;
    var have = gemsViewCount(snapshot, type, cost.gemLv);
    var player = headerSnapshot && headerSnapshot.player;
    var gold = player ? player.gold : 0;
    var ok = gold >= cost.gold && have >= cost.gemCount;
    h += '<div class="gres-cost">升到 Lv.' + (slot.lv + 1) + '：<span class="' + (gold >= cost.gold ? '' : 'is-short') + '"><img src="images/icon_gold.png" class="res-icon">' + fmt(cost.gold) + '</span>＋' +
      '<span class="' + (have >= cost.gemCount ? '' : 'is-short') + '">' + gemIconHTML(type, cost.gemLv, 'gi-inline') + esc(GEM_NAMES[cost.gemLv] + GEM_TYPES[type].name) +
      ' ×' + cost.gemCount + '（持有 ' + fmt(have) + '）</span></div>' +
      '<button type="button" class="btn" data-gres-upgrade="1"' + (ok ? '' : ' disabled') + '>⬆️ 升級此孔</button>';
  }

  if (slot.gems.length < cap) {
    var list = gresCandidates(snapshot, region, hole);
    h += '<div class="sec-sub">放入寶石（點擊鑲入）</div><div class="gres-pool">';
    h += list.length ? list.map(function (c) {
      return '<button type="button" class="gres-chip" data-gres-put="' + c.type + ':' + c.lv + '" style="--c:' + GEM_TIER_COLORS[c.lv] + '" data-tip="' +
        esc(GEM_NAMES[c.lv] + GEM_TYPES[c.type].name + '｜' + gemAbilityText(c.type, c.lv)) + '">' +
        gemIconHTML(c.type, c.lv, 'gi-chip') + '<span>×' + (c.n > 99 ? '99+' : c.n) + '</span></button>';
    }).join('') : '<div class="gres-empty">沒有符合的寶石（需 ' + esc(GEM_NAMES[min]) + '以上' + (reg.types ? '、限本區種類' : '') + '）</div>';
    h += '</div>';
  }
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
  var hint = $id('gres-hint');
  if (hint && !hint._set) {
    hint._set = true;
    hint.innerHTML = '把寶石鑲進共鳴孔：孔內寶石<b>直接提供自己的能力</b>；升級孔，還會額外獲得<b>相鄰孔寶石</b>的能力（每級 +' +
      GEM_RESONANCE_SETTINGS.perLevelPct + '%，最高 +' + GEM_RESONANCE_SETTINGS.maxPct + '%）。外圍六區各限定寶石種類，中央區不限；孔上的數字是該孔要求的最低寶石階級。點孔查看與操作。';
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
  var board = $id('gres-board');
  var detail = $id('gres-detail');
  if (board) {
    board.addEventListener('click', function (e) {
      var hole = e.target.closest ? e.target.closest('[data-gres-hole]') : null;
      if (!hole) return;
      var parts = hole.getAttribute('data-gres-hole').split(':');
      UI.gemBrowse.resHole = [parseInt(parts[0], 10), parseInt(parts[1], 10)];
      renderGemResonance();
    });
  }
  if (detail) {
    detail.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var sel = gresSelected();
      var base = { region: sel[0], hole: sel[1] };
      var put = t.closest('[data-gres-put]');
      if (put) {
        var pk = put.getAttribute('data-gres-put').split(':');
        sendGemUiCommand('gem.resonanceSocket', { region: base.region, hole: base.hole, type: pk[0], level: parseInt(pk[1], 10) }, 'gem-resonance');
        return;
      }
      var take = t.closest('[data-gres-take]');
      if (take) {
        sendGemUiCommand('gem.resonanceUnsocket', { region: base.region, hole: base.hole, index: parseInt(take.getAttribute('data-gres-take'), 10) }, 'gem-resonance');
        return;
      }
      if (t.closest('[data-gres-upgrade]')) sendGemUiCommand('gem.resonanceUpgrade', base, 'gem-resonance');
    });
  }
}
