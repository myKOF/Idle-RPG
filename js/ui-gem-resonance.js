'use strict';
/* ============ 寶石共鳴頁（寶石分頁的「共鳴」工具） ============
   資料表在 js/gem_resonance_data.js、規則與屬性算法在 js/gem_resonance.js（兩端共載，純函式）。
   本檔只讀面板快照（gems 面板的 resonance 欄位、庫存 gems）並送指令，不碰 G。
   版面：49 個六角孔以 SVG 畫成「六個外圍區環繞中央區」，左側按孔位篩選寶石類型，從上方十階列點擊／拖曳鑲入。 */

var GRES_CELL = 22;                                    // 六角孔外接圓半徑（SVG 單位）
var GRES_SPACING = Math.sqrt(3) * GRES_CELL;           // 相鄰孔中心距
var GRES_REGION_DIST = GRES_SPACING * 3.15;            // 外圍區中心到中央區中心的距離（略大於三格，區與區之間留縫）
var GRES_BOARD_SCALE = 1.18;                            // 孔位盤面等比放大，填入底板內緣。
var GRES_VIEW = 273;                                   // 母圖在共用座標中的半邊長，不隨顯示範圍改動。
var GRES_VIEW_BOX = '-257 -230 514 450';                 // 收去母圖外透明留白，四邊保留安全距離。
var GRES_REGION_COLORS = [266, 214, 176, 37, 132, 355, 46]; // 各區色相（與區域順序一致）

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
function gresHexPoints(c, radius) {
  if (radius == null) radius = GRES_CELL;
  var pts = [];
  for (var j = 0; j < 6; j++) {
    var a = j * Math.PI / 3;
    pts.push((c.x + radius * Math.cos(a)).toFixed(1) + ',' + (c.y + radius * Math.sin(a)).toFixed(1));
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
function gresMaterialDefs() {
  var h = '<defs><linearGradient id="gres-metal" x1="0" y1="0" x2=".65" y2="1">' +
    '<stop stop-color="#d9d8c6"/><stop offset=".22" stop-color="#5e665e"/><stop offset=".46" stop-color="#2a302e"/>' +
    '<stop offset=".72" stop-color="#777c69"/><stop offset="1" stop-color="#222a28"/></linearGradient>' +
    '<linearGradient id="gres-sheen" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="white" stop-opacity=".35"/>' +
    '<stop offset=".38" stop-color="white" stop-opacity=".03"/><stop offset=".6" stop-color="white" stop-opacity="0"/>' +
    '<stop offset="1" stop-color="white" stop-opacity=".08"/></linearGradient>';
  GRES_REGION_COLORS.forEach(function (hue, r) {
    h += '<radialGradient id="gres-body-' + r + '" cx=".28" cy=".15" r=".95">' +
      '<stop stop-color="hsl(' + hue + ' 58% 43%)"/><stop offset=".43" stop-color="hsl(' + hue + ' 52% 21%)"/>' +
      '<stop offset=".8" stop-color="hsl(' + hue + ' 62% 12%)"/><stop offset="1" stop-color="hsl(' + hue + ' 60% 25%)"/></radialGradient>' +
      '<linearGradient id="gres-face-' + r + '" x1=".15" y1="0" x2=".85" y2="1">' +
      '<stop stop-color="hsl(' + hue + ' 50% 31%)"/><stop offset=".42" stop-color="hsl(' + hue + ' 50% 15%)"/>' +
      '<stop offset=".75" stop-color="hsl(' + hue + ' 65% 10%)"/><stop offset="1" stop-color="hsl(' + hue + ' 58% 23%)"/></linearGradient>';
  });
  return h + '</defs>';
}

function gresSocketArt(c, region) {
  var outer = gresHexPoints(c, 19.7).split(' '), inner = gresHexPoints(c, 15).split(' ');
  var light = [0.15, 0.04, 0.12, 0.34, 0.44, 0.24];
  var h = '<g class="gres-art" aria-hidden="true">' +
    '<polygon class="gres-socket-shadow" points="' + gresHexPoints({ x: c.x, y: c.y + 1.1 }, 21.8) + '"/>' +
    '<polygon class="gres-socket-frame" points="' + gresHexPoints(c, 21.3) + '"/>' +
    '<polygon class="gres-socket-body" points="' + gresHexPoints(c, 20.05) + '" fill="url(#gres-body-' + region + ')"/>';
  for (var i = 0; i < 6; i++) {
    h += '<polygon points="' + [outer[i], outer[(i + 1) % 6], inner[(i + 1) % 6], inner[i]].join(' ') +
      '" fill="' + ((i === 1 || i === 2) ? '#000a16' : '#dbefff') + '" opacity="' + light[i] + '"/>';
  }
  return h + '<polygon class="gres-face" points="' + gresHexPoints(c, 15) + '" fill="url(#gres-face-' + region + ')"/>' +
    '<polygon points="' + [outer[4], outer[5], inner[0], inner[3]].join(' ') + '" fill="url(#gres-sheen)" opacity=".65"/>' +
    '<path class="gres-rim-light" d="M ' + [outer[3], outer[4], outer[5], outer[0]].join(' L ') + '"/>' +
    '<path class="gres-inner-light" d="M ' + [inner[2], inner[1], inner[0]].join(' L ') + '"/></g>';
}

/* 多顆寶石在同一孔內分區；每顆維持完整縮圖，裁切僅限制在孔內與自己的區塊。 */
function gresHoleGemsHTML(c, gems, region, hole) {
  if (gems.length === 1) return '<image href="' + gemIconSrc(gems[0].type, gems[0].level) + '" x="' + (c.x - 14).toFixed(1) + '" y="' + (c.y - 15).toFixed(1) + '" width="28" height="28"/>';
  var id = 'gres-gems-' + region + '-' + hole;
  var h = '<g class="gres-gems" aria-hidden="true"><defs><clipPath id="' + id + '" clipPathUnits="userSpaceOnUse"><polygon points="' + gresHexPoints(c, 19) + '"/></clipPath></defs><g clip-path="url(#' + id + ')">';
  gems.forEach(function (gem, i) {
    var count = gems.length;
    var angle = count === 2 ? Math.PI * (1 - i) : -Math.PI / 2 + i * Math.PI * 2 / count;
    var half = Math.PI / count, radius = 45;
    var a = angle - half, b = angle + half;
    var sector = 'M ' + c.x.toFixed(1) + ' ' + c.y.toFixed(1) + ' L ' +
      (c.x + Math.cos(a) * radius).toFixed(1) + ' ' + (c.y + Math.sin(a) * radius).toFixed(1) +
      ' A ' + radius + ' ' + radius + ' 0 0 1 ' + (c.x + Math.cos(b) * radius).toFixed(1) + ' ' + (c.y + Math.sin(b) * radius).toFixed(1) + ' Z';
    var size = count === 2 ? 15 : (count === 3 ? 13 : 10);
    var offset = count === 2 ? 9 : 10.5;
    var x = c.x + Math.cos(angle) * offset - size / 2, y = c.y + Math.sin(angle) * offset - size / 2;
    var part = id + '-' + i;
    h += '<defs><clipPath id="' + part + '" clipPathUnits="userSpaceOnUse"><path d="' + sector + '"/></clipPath></defs>' +
      '<g class="gres-gem-part" clip-path="url(#' + part + ')"><path class="gres-gem-section" d="' + sector + '"/>' +
      '<image href="' + gemIconSrc(gem.type, gem.level) + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + size + '" height="' + size + '"/></g>';
  });
  return h + '</g></g>';
}

function gresBoardHTML(state, sel) {
  var h = '<svg viewBox="' + GRES_VIEW_BOX + '" class="gres-svg" role="group" aria-label="寶石共鳴盤面">';
  h += gresMaterialDefs() + '<image class="gres-backplate" aria-hidden="true" href="images/ui/gem-resonance/hex-backplate.png" x="' + (-GRES_VIEW) + '" y="' + (-GRES_VIEW) + '" width="' + (GRES_VIEW * 2) + '" height="' + (GRES_VIEW * 2) + '"/>';
  h += '<g class="gres-sockets" transform="scale(' + GRES_BOARD_SCALE + ')">';
  GEM_RESONANCE_REGIONS.forEach(function (reg, r) {
    var hue = GRES_REGION_COLORS[r % GRES_REGION_COLORS.length];
    for (var hole = 0; hole < RESONANCE_HOLE_COUNT; hole++) {
      var c = gresHoleCenter(r, hole);
      var slot = resonanceHoleState(state, r, hole);
      var min = resonanceHoleMinLevel(r, hole);
      var on = sel[0] === r && sel[1] === hole;
      h += '<g class="gres-hole' + (slot.gems.length ? ' is-filled' : '') + (on ? ' is-sel' : '') + '" data-gres-hole="' + r + ':' + hole + '" role="button" tabindex="0" aria-pressed="' + on + '" aria-label="' + esc(reg.name + '區' + (hole === 0 ? '中心孔' : '外圈孔 ' + hole)) + '" style="--h:' + hue + '">' +
        gresSocketArt(c, r);
      if (slot.gems.length) {
        h += gresHoleGemsHTML(c, slot.gems, r, hole);
      } else {
        h += '<text class="gres-min" x="' + c.x.toFixed(1) + '" y="' + (c.y + 5).toFixed(1) + '">' + min + '</text>';
      }
      if (slot.lv) h += '<text class="gres-lv' + (slot.gems.length > 2 ? ' is-center' : '') + '" x="' + c.x.toFixed(1) + '" y="' + (c.y + (slot.gems.length > 2 ? 2 : 16)).toFixed(1) + '">Lv' + slot.lv + '</text>';
      // 最上層透明命中面覆蓋切面與寶石，整個孔都沿同一個互動入口。
      h += '<polygon class="gres-hit" points="' + gresHexPoints(c) + '"/></g>';
    }
  });
  // 最後才畫選中框，避免相鄰孔的填色蓋住共用邊；此層不攔截點擊或拖放。
  return h + '<polygon class="gres-selection-outline" aria-hidden="true" points="' + gresHexPoints(gresHoleCenter(sel[0], sel[1])) + '"/></g></svg>';
}

/* ---- 類型選取與十階列鑲嵌：共用同一份可用性判斷 ---- */
function gresSocketBlockReason(snapshot, region, hole, gem) {
  if (!snapshot || !resonanceValidHole(region, hole)) return '尚未取得共鳴孔資料';
  if (!gem || !GEM_TYPES[gem.type]) return '請先選擇寶石類型';
  if (!isGemEnabled(gem.type) || !resonanceTypeAllowed(region, gem.type)) return '此孔無法鑲入這個寶石類型';
  var min = resonanceHoleMinLevel(region, hole);
  if (!Number.isInteger(gem.level) || gem.level < min || gem.level > GEM_FORGE_MAX_LEVEL) return '此孔需要' + GEM_NAMES[min] + '以上寶石';
  if (gemsViewCount(snapshot, gem.type, gem.level) <= 0) return '尚未持有這一階寶石';
  if (resonanceHoleState(gresSnapshotState(snapshot), region, hole).gems.length >= resonanceHoleCap(region, hole)) return '此孔已滿，請先取下寶石';
  return '';
}

function gresCanSocket(snapshot, region, hole, gem) {
  return !gresSocketBlockReason(snapshot, region, hole, gem);
}

function gresRenderLibrary(snapshot, box, totals) {
  var sel = gresSelected(), st = UI.gemBrowse, filter = st.resFilter || 'all';
  var note = $id('gres-library-note');
  if (note) {
    note.hidden = false;
    note.textContent = GEM_RESONANCE_REGIONS[sel[0]].name + '區・' + (sel[1] ? '外圈孔 ' + sel[1] : '中心孔') + '｜' + GEM_NAMES[resonanceHoleMinLevel(sel[0], sel[1])] + '以上';
  }
  // 拖曳完成前保留類型與來源階級，最新庫存仍會在放開時重新驗證。
  if (st.resDrag) return;
  var types = Object.keys(GEM_TYPES).filter(function (type) {
    return isGemEnabled(type) && resonanceTypeAllowed(sel[0], type) && (filter === 'all' || gemCategoryOf(type) === filter);
  });
  var h = '', visible = [];
  types.forEach(function (type) {
    var total = totals ? totals[type] || 0 : 0;
    if (!totals) for (var lv = 1; lv <= GEM_FORGE_MAX_LEVEL; lv++) total += gemsViewCount(snapshot, type, lv);
    if (st.ownedOnly && !total) return;
    visible.push({ type: type, total: total });
  });
  // 先決定選中類型，才畫出一致的 is-sel 狀態。
  if (!visible.some(function (item) { return item.type === st.sel; })) st.sel = visible.length ? visible[0].type : null;
  visible.forEach(function (item) {
    h += gemLibItemHTML(snapshot, item.type, item.total);
  });
  if (!h) h = '<div class="gx-empty">目前沒有符合此孔與分類的寶石類型</div>';
  if (box._lastH !== h) { box._lastH = h; box.innerHTML = h; }
}

function gresSelectHole(region, hole) {
  if (!resonanceValidHole(region, hole)) return;
  UI.gemBrowse.resHole = [region, hole];
  UI.gemBrowse.resFilter = 'all';
  renderGems();
}

function gresSocketGem(gem, region, hole) {
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
    ? '左側選擇寶石類型，再點擊上方十階列鑲入，或拖曳至盤面孔位。'
    : '此孔已滿；點擊孔內寶石取下，或選擇其他孔位。') + '</div>';
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
  var board = $id('gres-board'), detail = $id('gres-detail'), focus = $id('gem-focus');
  function holeAt(e) { return e.target && e.target.closest ? e.target.closest('[data-gres-hole]') : null; }
  function clearDrop() {
    if (board) board.querySelectorAll('.is-drop, .is-reject').forEach(function (n) { n.classList.remove('is-drop', 'is-reject'); });
  }
  function stopDrag() { UI.gemBrowse.resDrag = null; clearDrop(); renderGems(); }
  function selectHole(hole) {
    if (!hole) return;
    var parts = hole.getAttribute('data-gres-hole').split(':');
    gresSelectHole(Number(parts[0]), Number(parts[1]));
  }
  if (focus) {
    focus.addEventListener('click', function (e) {
      var source = e.target.closest ? e.target.closest('[data-gres-gem]') : null;
      if (!source || UI.gemBrowse.tool !== 'resonance') return;
      var key = source.getAttribute('data-gres-gem').split(':'), sel = gresSelected();
      gresSocketGem({ type: key[0], level: Number(key[1]) }, sel[0], sel[1]);
    });
    focus.addEventListener('dragstart', function (e) {
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
    focus.addEventListener('dragend', stopDrag);
  }
  if (board) {
    board.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.isPrimary === false) return;
      selectHole(holeAt(e));
    });
    board.addEventListener('click', function (e) {
      // 實體指標在按下時已選孔；保留輔助工具的無指標 click。
      if (e.detail === 0) selectHole(holeAt(e));
    });
    board.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && holeAt(e)) { e.preventDefault(); selectHole(holeAt(e)); }
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
        if (gresSocketGem(gem, Number(parts[0]), Number(parts[1]))) {
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
