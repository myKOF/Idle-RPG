'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
/* 合成及無損前一階拆解：共用既有聖光、權威確認與兩秒展示。 */
function gemWorkshopBusy(tool) {
  return !!((tool === 'compose' && UI.gemComposeFx) || (tool === 'dismantle' && UI.gemDismantleFx));
}

function gemWorkshopLight(el, active) {
  if (!el) return;
  if (el.style.setProperty) el.style.setProperty('--gconv-fx-duration', GEM_CONVERT_FX_MS + 'ms');
  el.classList.toggle('is-converting', !!active);
}

function startGemWorkshop(kind, command, args, details) {
  var fxKey = kind === 'compose' ? 'gemComposeFx' : 'gemDismantleFx';
  var successKey = kind === 'compose' ? 'gemComposeSuccess' : 'gemDismantleSuccess';
  if (UI[fxKey]) return Promise.resolve(null);
  var fx = details;
  fx.acknowledged = false;
  fx.elapsed = false;
  UI[fxKey] = fx;
  UI[successKey] = false;
  renderGems();
  function finish() {
    if (UI[fxKey] !== fx || !fx.elapsed || !fx.acknowledged) return;
    UI[fxKey] = null;
    UI[successKey] = true;
    blog(kind === 'compose' ? STR(1576) : STR(1577), 'good', 'factory');
    renderGems();
  }
  fx.timer = UI_GAME_TIMING.setTimeout(function () {
    if (UI[fxKey] !== fx) return;
    fx.elapsed = true;
    finish();
  }, GEM_CONVERT_FX_MS);
  return sendGemUiCommand(command, args, 'gem-' + kind, ['gems', 'header'], function () {
    if (UI[fxKey] !== fx) return;
    fx.acknowledged = true;
    if (kind === 'dismantle') UI.gemDismantleSlots = [];
    finish();
  }).then(function (result) {
    if (UI[fxKey] === fx && !fx.acknowledged) {
      UI_GAME_TIMING.clearTimeout(fx.timer);
      UI[fxKey] = null;
      renderGems();
    }
    return result;
  });
}

function runGemCompose(all) {
  if (UI.gemComposeFx) return Promise.resolve(null);
  var type = UI.gemBrowse.sel, lv = UI.gemBrowse.fuseLv || 1;
  if (!isGemEnabled(type) || !gemComposeInputCount(lv)) return Promise.resolve(null);
  return startGemWorkshop('compose', all ? 'gem.composeAll' : 'gem.compose', { type: type, level: lv }, {
    type: type, lv: lv, recipe: fuseRecipeHTML(type, lv)
  });
}

// 回傳true時保留本次配方／資訊，避免權威快照先到使光效中途重建。
function renderGemComposeWorkshop() {
  var fx = UI.gemComposeFx, recipe = $id('fuse-recipe'), status = $id('fuse-status');
  if (fx && recipe && recipe._lastH !== fx.recipe) { recipe._lastH = fx.recipe; recipe.innerHTML = fx.recipe; }
  gemWorkshopLight(recipe, fx);
  if (status) setTextIfChanged(status, UI.gemComposeSuccess ? STR(1578) : '');
  if (fx) ['fuse-btn', 'fuse-all-btn'].forEach(function (id) { var el = $id(id); if (el) el.disabled = true; });
  return !!fx;
}

function gemDismantlePlaced(type, lv) {
  return (UI.gemDismantleSlots || []).reduce(function (n, s) { return n + (s.type === type && s.lv === lv ? s.n : 0); }, 0);
}

function gemDismantleBlockReason(snapshot, type, lv) {
  if (UI.gemDismantleFx) return STR(1579);
  if (!GEM_TYPES[type] || !isGemEnabled(type)) return STR(1580);
  if (!gemDismantleYield(lv)) return STR(1581);
  var placed = gemDismantlePlaced(type, lv);
  if (gemsViewCount(snapshot, type, lv) <= placed) return STR(1582);
  if (placed >= GEM_CONVERT_STACK) return STR(1583);
  if (!placed && (UI.gemDismantleSlots || []).length >= GEM_CONVERT_SLOTS) return STR(1584);
  return '';
}

function stageGemDismantle(type, lv, single) {
  var snapshot = uiGemsPanelSnapshot();
  if (!snapshot || UI.gemBrowse.tool !== 'dismantle') return false;
  var reason = gemDismantleBlockReason(snapshot, type, lv);
  if (reason) { blog('⚠️ ' + reason, 'warn'); return false; }
  var next = adjustGemConvertPool(UI.gemDismantleSlots, type, lv, gemsViewCount(snapshot, type, lv), single, GEM_CONVERT_STACK, GEM_CONVERT_SLOTS);
  if (!next.ok) return false;
  UI.gemDismantleSlots = next.slots;
  UI.gemDismantleSuccess = false;
  renderGems();
  return true;
}

function gemDismantleCell(s, index) {
  var tip = GEM_NAMES[s.lv] + GEM_TYPES[s.type].name + '｜' + gemAbilityText(s.type, s.lv) + '｜×' + s.n;
  return '<button type="button" class="gconv-slot filled"' + (index === undefined ? ' tabindex="-1"' : ' data-gdis-slot="' + index + '"') +
    ' style="--c:' + GEM_TIER_COLORS[s.lv] + '" data-tip="' + esc(tip + (index === undefined ? '' : STR(1585))) + '">' +
    gemIconHTML(s.type, s.lv, 'gi-conv') + '<span class="gconv-n">×' + s.n + '</span><span class="gconv-level">' + s.lv + '</span></button>';
}

function renderGemDismantleWorkshop(snapshot) {
  var grid = $id('gdis-grid');
  if (!grid) return;
  snapshot = resolveGemsPanelSnapshot(snapshot);
  if (!snapshot) return;
  var fx = UI.gemDismantleFx;
  if (!fx) UI.gemDismantleSlots = (UI.gemDismantleSlots || []).map(function (s) {
    return { type: s.type, lv: s.lv, n: Math.min(s.n, gemsViewCount(snapshot, s.type, s.lv)) };
  }).filter(function (s) { return s.n > 0 && isGemEnabled(s.type) && gemDismantleYield(s.lv); });
  var slots = fx ? fx.slots : UI.gemDismantleSlots, keys = [], cells = [];
  for (var i = 0; i < GEM_CONVERT_SLOTS; i++) {
    keys.push('gdis:' + i);
    cells.push(slots[i] ? gemDismantleCell(slots[i], i) : '<div class="gconv-slot"></div>');
  }
  syncItemGridCells(grid, keys, cells);
  grid.querySelectorAll('[data-gdis-slot]').forEach(function (n) { n.disabled = !!fx; });
  var outputs = gemDismantlePlan(slots).outputs.sort(function (a, b) { return a.lv - b.lv || a.type.localeCompare(b.type); });
  var output = $id('gdis-output'), html = outputs.map(function (s) { return gemDismantleCell(s); }).join('');
  if (output && output._lastH !== html) { output._lastH = html; output.innerHTML = html; }
  var btn = $id('gdis-btn'), clear = $id('gdis-clear'), status = $id('gdis-status');
  if (btn) btn.disabled = !!fx || !outputs.length;
  if (clear) clear.disabled = !!fx;
  if (status) setTextIfChanged(status, UI.gemDismantleSuccess ? STR(1586) : '');
  gemWorkshopLight(grid, fx);
  gemWorkshopLight(output, fx);
}

function runGemDismantle() {
  if (UI.gemDismantleFx) return Promise.resolve(null);
  var slots = copyGemConvertSlots(UI.gemDismantleSlots);
  if (!slots.length) return Promise.resolve(null);
  return startGemWorkshop('dismantle', 'gem.dismantleSlots', { slots: slots }, { slots: slots });
}

function initGemWorkshopUi() {
  var grid = $id('gdis-grid'), focus = $id('gem-focus');
  if (!grid) return;
  var dragImage = null;
  function stopDrag() {
    if (dragImage) { dragImage.remove(); dragImage = null; }
    UI.gemBrowse.dismantleDrag = null;
    grid.classList.remove('is-drop');
    renderGems();
  }
  if (focus) {
    focus.addEventListener('dragstart', function (e) {
      var source = e.target.closest && e.target.closest('[data-gdis-gem]');
      if (!source || UI.gemBrowse.tool !== 'dismantle' || !e.dataTransfer) return;
      if (typeof bossFightConfigLocked === 'function' && bossFightConfigLocked()) { e.preventDefault(); return; }
      var key = source.getAttribute('data-gdis-gem').split(':'), type = key[0], lv = Number(key[1]);
      if (gemDismantleBlockReason(uiGemsPanelSnapshot(), type, lv)) { e.preventDefault(); return; }
      UI.gemBrowse.dismantleDrag = { type: type, lv: lv };
      e.dataTransfer.setData('application/x-idle-rpg-gem-dismantle', JSON.stringify(UI.gemBrowse.dismantleDrag));
      e.dataTransfer.effectAllowed = 'move';
      var icon = source.querySelector('img.gem-ico');
      if (icon) {
        var rect = icon.getBoundingClientRect();
        dragImage = document.createElement('div');
        dragImage.setAttribute('aria-hidden', 'true');
        dragImage.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;padding:0;margin:0;border:0;background:transparent;box-shadow:none;pointer-events:none;z-index:2147483647';
        var image = icon.cloneNode(false);
        image.style.cssText = 'display:block;width:100%;height:100%;margin:0;border:0;background:transparent;box-shadow:none;object-fit:contain';
        dragImage.appendChild(image);
        document.body.appendChild(dragImage);
        e.dataTransfer.setDragImage(dragImage, rect.width / 2, rect.height / 2);
      }
      if (typeof hideTooltip === 'function') hideTooltip();
    });
    focus.addEventListener('dragend', stopDrag);
  }
  grid.addEventListener('dragover', function (e) {
    var gem = UI.gemBrowse.dismantleDrag;
    if (UI.gemBrowse.tool !== 'dismantle' || !gem || gemDismantleBlockReason(uiGemsPanelSnapshot(), gem.type, gem.lv)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    grid.classList.add('is-drop');
  });
  grid.addEventListener('dragleave', function (e) { if (!grid.contains(e.relatedTarget)) grid.classList.remove('is-drop'); });
  grid.addEventListener('drop', function (e) {
    var gem = UI.gemBrowse.dismantleDrag;
    e.preventDefault();
    if (gem) stageGemDismantle(gem.type, gem.lv, e.shiftKey);
    stopDrag();
  });
  grid.addEventListener('click', function (e) {
    if (UI.gemDismantleFx) return;
    var cell = e.target.closest('[data-gdis-slot]');
    if (!cell) return;
    var result = removeGemConvertSlot(UI.gemDismantleSlots, Number(cell.getAttribute('data-gdis-slot')), e.shiftKey);
    if (!result.ok) return;
    UI.gemDismantleSlots = result.slots;
    UI.gemDismantleSuccess = false;
    renderGems();
  });
  $id('gdis-clear').addEventListener('click', function () {
    if (UI.gemDismantleFx) return;
    UI.gemDismantleSlots = [];
    UI.gemDismantleSuccess = false;
    renderGems();
  });
  $id('gdis-btn').addEventListener('click', runGemDismantle);
}
