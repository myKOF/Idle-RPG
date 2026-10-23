'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
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
var GRES_BACKPLATE_SRC = 'images/ui/gem-resonance/hex-backplate.png';
var GRES_BACKPLATE_IMAGE = null;

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
function gresDefaultHole() {
  for (var r = 0; r < GEM_RESONANCE_REGIONS.length; r++) {
    if (GEM_RESONANCE_REGIONS[r].id === 'phys') return [r, 6];
  }
  return [0, 6];
}
function gresResetSelection() {
  UI.gemBrowse.resHole = gresDefaultHole();
  UI.gemBrowse.resFilter = 'all';
}
function gresSelected() {
  var sel = UI.gemBrowse.resHole;
  return (sel && resonanceValidHole(sel[0], sel[1])) ? sel : gresDefaultHole();
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

function gresBoardHTML(state, sel, socketsHTML) {
  var h = '<svg viewBox="' + GRES_VIEW_BOX + '" class="gres-svg" role="group" aria-label="' + STR(1549) + '">';
  h += gresMaterialDefs() + '<image class="gres-backplate" aria-hidden="true" href="' + GRES_BACKPLATE_SRC + '" x="' + (-GRES_VIEW) + '" y="' + (-GRES_VIEW) + '" width="' + (GRES_VIEW * 2) + '" height="' + (GRES_VIEW * 2) + '"/>';
  h += '<g class="gres-sockets" transform="scale(' + GRES_BOARD_SCALE + ')">';
  return h + (socketsHTML == null ? gresSocketsHTML(state, sel) : socketsHTML) + '</g></svg>';
}

/* 背板與材質defs固定保留，選孔／鑲入／升級只更新孔位，避免重新建立圖片。 */
function gresSocketsHTML(state, sel) {
  var h = '';
  GEM_RESONANCE_REGIONS.forEach(function (reg, r) {
    var hue = GRES_REGION_COLORS[r % GRES_REGION_COLORS.length];
    var unlocked = resonanceRegionUnlocked(state, r);
    for (var hole = 0; hole < RESONANCE_HOLE_COUNT; hole++) {
      var c = gresHoleCenter(r, hole);
      var slot = resonanceHoleState(state, r, hole);
      var on = sel[0] === r && sel[1] === hole;
      h += '<g class="gres-hole' + (slot.gems.length ? ' is-filled' : '') + (!unlocked ? ' is-locked' : '') + (unlocked && r === sel[0] ? ' is-region-active' : '') + (on ? ' is-sel' : '') + '" data-gres-hole="' + r + ':' + hole + '" role="button" tabindex="0" aria-pressed="' + on + '" aria-label="' + esc(STR(1552, reg.name, (hole === 0 ? STR(1550) : STR(1551, hole)), (unlocked ? '' : STR(95)))) + '" style="--h:' + hue + '">' +
        gresSocketArt(c, r);
      if (slot.gems.length) {
        h += gresHoleGemsHTML(c, slot.gems, r, hole);
      }
      if (slot.lv) h += '<text class="gres-lv' + (!slot.gems.length || slot.gems.length > 2 ? ' is-center' : '') + '" x="' + c.x.toFixed(1) + '" y="' + (c.y + (!slot.gems.length || slot.gems.length > 2 ? 4 : 16)).toFixed(1) + '">' + slot.lv + '</text>';
      // 最上層透明命中面覆蓋切面與寶石，整個孔都沿同一個互動入口。
      h += '<polygon class="gres-hit" points="' + gresHexPoints(c) + '"/></g>';
    }
  });
  // 最後才畫選中框，避免相鄰孔的填色蓋住共用邊；此層不攔截點擊或拖放。
  return h + '<polygon class="gres-selection-outline' + (resonanceRegionUnlocked(state, sel[0]) ? '' : ' is-locked') + '" aria-hidden="true" points="' + gresHexPoints(gresHoleCenter(sel[0], sel[1])) + '"/>';
}

/* ---- 類型選取與十階列鑲嵌：共用同一份可用性判斷 ---- */
function gresSocketBlockReason(snapshot, region, hole, gem) {
  if (!snapshot || !resonanceValidHole(region, hole)) return STR(1553);
  var locked = resonanceRegionLockReason(gresSnapshotState(snapshot), region);
  if (locked) return locked;
  if (!gem || !GEM_TYPES[gem.type]) return STR(1554);
  if (!isGemEnabled(gem.type) || !resonanceTypeAllowed(region, gem.type)) return STR(1555);
  var min = resonanceHoleMinLevel(region, hole);
  if (!Number.isInteger(gem.level) || gem.level < min || gem.level > GEM_FORGE_MAX_LEVEL) return STR(1556, GEM_NAMES[min]);
  if (gemsViewCount(snapshot, gem.type, gem.level) <= 0) return STR(1557);
  if (resonanceHoleState(gresSnapshotState(snapshot), region, hole).gems.length >= resonanceHoleCap(region, hole)) return STR(1472);
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
    note.textContent = resonanceRegionLockReason(gresSnapshotState(snapshot), sel[0]) || STR(1558, GEM_RESONANCE_REGIONS[sel[0]].name, (sel[1] ? STR(1551, sel[1]) : STR(1550)), GEM_NAMES[resonanceHoleMinLevel(sel[0], sel[1])]);
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
  if (!h) h = '<div class="gx-empty">' + STR(1559) + '</div>';
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
  var locked = resonanceRegionLockReason(state, region);
  var bonusPct = locked || !slot.gems.length ? 0 : Math.round(resonanceBonusMult(slot.lv) * 100);
  var h = '<div class="gres-summary"><div class="gres-title">' + STR(1562, esc(reg.name + (reg.types ? STR(1560) : STR(1561))), min) + '</div><div class="gres-level">' + STR(1563, slot.lv) + '</div><div class="gres-bonus">' + STR(1564, bonusPct) + '</div></div>';

  h += '<div class="gres-slots">';
  for (var i = 0; i < cap; i++) {
    var g = slot.gems[i];
    h += g
      ? '<button type="button" class="gres-gem" data-gres-take="' + i + '" aria-label="' + esc(STR(1565, GEM_NAMES[g.level] + GEM_TYPES[g.type].name)) +
        '" data-tt-title="' + esc(GEM_NAMES[g.level] + GEM_TYPES[g.type].name) + '" data-tt-desc="' + esc(STR(1566, gresStatText(g.type, gemStatValue(g.type, g.level)))) + '">' + gemIconHTML(g.type, g.level, 'gi-slot') +
        '<span class="gres-gem-info"><span class="gres-gem-name">' + esc(GEM_NAMES[g.level] + GEM_TYPES[g.type].name) + '</span>' +
        '<span class="gres-gem-stat">' + gresStatText(g.type, gemStatValue(g.type, g.level)) + '</span></span></button>'
      : '<div class="gres-gem is-empty">' + STR(1567) + '</div>';
  }
  h += '</div>';

  var cost = resonanceUpgradeCost(slot.lv);
  var ok = false, upgradeTip = locked || STR(1568);
  if (cost) {
    var count = function (t, lv) { return gemsViewCount(snapshot, t, lv); };
    var type = resonanceUpgradePayType(region, slot, cost, count);
    var player = headerSnapshot && headerSnapshot.player;
    var gold = player ? player.gold : 0;
    var have = type ? count(type, cost.gemLv) : 0;
    ok = !locked && gold >= cost.gold && !!type && have >= cost.gemCount;
    var gemText = type
      ? STR(1569, GEM_NAMES[cost.gemLv] + GEM_TYPES[type].name, cost.gemCount, fmt(have))
      : STR(1570, GEM_NAMES[cost.gemLv], cost.gemCount);
    upgradeTip = STR(1571, (locked ? esc(locked) + '<br>' : ''), fmt(cost.gold), fmt(gold), esc(gemText));
    if (!locked && !ok) upgradeTip += STR(1572);
  }
  return '' + h + '<div class="gres-upgrade" tabindex="0" data-gres-upgrade-tip="1" data-tt-title="' + STR(1573) + '" data-tt-desc="' + esc(upgradeTip) + '"><button type="button" class="btn" data-gres-upgrade="1"' + (ok ? '' : ' disabled') + '>' + STR(1573) + '</button></div>';
}

/* 所選孔的相鄰額外加成依能力合併，不含自身寶石與其他孔位。 */
function gresTotalHTML(state, sel) {
  sel = sel || gresSelected();
  var sums = {}, order = [];
  resonanceHoleBonusEntries(state, sel[0], sel[1]).forEach(function (e) {
    var gt = GEM_TYPES[e.type];
    if (!gt) return;
    if (!(e.type in sums)) { sums[e.type] = 0; order.push(e.type); }
    sums[e.type] += gemStatValue(e.type, e.level) * e.mult;
  });
  return '<div class="sec-sub">' + STR(1574) + '</div><div class="gres-list">' +
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
    help.setAttribute('data-tt-desc', STR(1575));
  }
  var state = gresSnapshotState(gemsSnapshot);
  var sel = gresSelected();
  var socketsH = gresSocketsHTML(state, sel);
  if (board._lastH !== socketsH) {
    var sockets = board.querySelector('.gres-sockets');
    if (sockets) sockets.innerHTML = socketsH;
    else board.innerHTML = gresBoardHTML(state, sel, socketsH);
    board._lastH = socketsH;
  }
  var detail = $id('gres-detail');
  var detailH = gresDetailHTML(gemsSnapshot, headerSnapshot, state, sel);
  if (detail && detail._lastH !== detailH) { detail._lastH = detailH; detail.innerHTML = detailH; }
  var total = $id('gres-total');
  var totalH = gresTotalHTML(state, sel);
  if (total && total._lastH !== totalH) { total._lastH = totalH; total.innerHTML = totalH; }
}

function initGemResonanceUi() {
  // 消費主頁的低優先預載並提前解碼，不等切入寶石頁；不阻塞遊戲開機。
  if (typeof Image === 'function' && !GRES_BACKPLATE_IMAGE) {
    GRES_BACKPLATE_IMAGE = new Image();
    GRES_BACKPLATE_IMAGE.decoding = 'async';
    GRES_BACKPLATE_IMAGE.src = GRES_BACKPLATE_SRC;
    if (typeof GRES_BACKPLATE_IMAGE.decode === 'function') GRES_BACKPLATE_IMAGE.decode().catch(function () {});
  }
  var board = $id('gres-board'), detail = $id('gres-detail'), focus = $id('gem-focus');
  var dragImage = null;
  function clearDragImage() {
    if (dragImage) { dragImage.remove(); dragImage = null; }
  }
  function setDragIcon(source, transfer) {
    clearDragImage();
    var icon = source.querySelector('img.gem-ico');
    if (!icon) return;
    var rect = icon.getBoundingClientRect();
    // 用同尺寸的透明容器拍攝圖片，避免 IMG 原始尺寸或卡片文字進入原生拖曳影像。
    dragImage = document.createElement('div');
    dragImage.setAttribute('aria-hidden', 'true');
    dragImage.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;padding:0;margin:0;border:0;background:transparent;box-shadow:none;pointer-events:none;z-index:2147483647';
    var image = icon.cloneNode(false);
    image.style.cssText = 'display:block;width:100%;height:100%;margin:0;border:0;background:transparent;box-shadow:none;object-fit:contain';
    dragImage.appendChild(image);
    document.body.appendChild(dragImage);
    transfer.setDragImage(dragImage, rect.width / 2, rect.height / 2);
  }
  function holeAt(e) { return e.target && e.target.closest ? e.target.closest('[data-gres-hole]') : null; }
  function clearDrop() {
    if (board) board.querySelectorAll('.is-drop, .is-reject').forEach(function (n) { n.classList.remove('is-drop', 'is-reject'); });
  }
  function stopDrag() { clearDragImage(); UI.gemBrowse.resDrag = null; clearDrop(); renderGems(); }
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
      setDragIcon(source, e.dataTransfer);
      if (typeof hideTooltip === 'function') hideTooltip();
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
    detail.addEventListener('focusin', function (e) {
      var tip = e.target && e.target.closest ? e.target.closest('[data-gres-upgrade-tip]') : null;
      if (tip && typeof showStatTooltip === 'function') showStatTooltip(tip.getAttribute('data-tt-title'), tip.getAttribute('data-tt-desc'), tip);
    });
    detail.addEventListener('focusout', function (e) {
      if (e.target && e.target.closest && e.target.closest('[data-gres-upgrade-tip]') && typeof hideTooltip === 'function') hideTooltip();
    });
    detail.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var sel = gresSelected(), base = { region: sel[0], hole: sel[1] };
      var take = t.closest('[data-gres-take]');
      if (take) {
        sendGemUiCommand('gem.resonanceUnsocket', { region: base.region, hole: base.hole, index: parseInt(take.getAttribute('data-gres-take'), 10) }, 'gem-resonance');
        return;
      }
      if (t.closest('[data-gres-upgrade]') && resonanceRegionUnlocked(gresSnapshotState(uiGemsPanelSnapshot()), sel[0])) sendGemUiCommand('gem.resonanceUpgrade', base, 'gem-resonance');
    });
  }
}
