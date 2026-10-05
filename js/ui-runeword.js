'use strict';
/* ============ 符文頁（符文之語）— 主執行緒 UI ============
   資料表在 js/runeword_data.js、判定與說明文字在 js/runeword.js（兩端共載，純函式）。
   本檔只讀面板快照（gems 面板的 runes 欄位、equip 面板的裝備）並送指令，不碰 G。

   兩個工具頁：
     符文庫        33 種符文的持有量、合成／拆解、這顆符文用在哪些符文之語
     符文之語圖鑑  全部配方、需要的鑲孔、適用裝備與效果；標出材料已齊全與穿戴中成形的 */

var RUNE_TOOLS = ['library', 'codex'];

function runeUiState() {
  if (!UI.runeBrowse) UI.runeBrowse = { tool: 'library', sel: 'r01', tier: 0, ready: false };
  return UI.runeBrowse;
}

function runesViewCount(snapshot, id) {
  var r = snapshot && snapshot.runes;
  return Math.max(0, Math.floor(Number(r && r[id]) || 0));
}
function runesViewTotal(snapshot) {
  var n = 0;
  for (var i = 0; i < RUNES.length; i++) n += runesViewCount(snapshot, RUNES[i].id);
  return n;
}

/* 穿戴中（檢視中那套）已成形的符文之語 id 清單。 */
function runeUiWornWords() {
  var out = {};
  var snap = (typeof uiEquipPanelSnapshot === 'function') ? uiEquipPanelSnapshot() : null;
  var eq = snap ? equipViewEquipment(snap) : null;
  if (!eq) return out;
  for (var k in eq) {
    var act = eq[k] ? rwActiveWord(eq[k]) : null;
    if (act) out[act.word.id] = true;
  }
  return out;
}

/* 這組配方的材料是否齊全（同一種符文要的數量要算進去）。 */
function runeUiRecipeNeeds(word) {
  var need = {};
  for (var i = 0; i < word.runes.length; i++) need[word.runes[i]] = (need[word.runes[i]] || 0) + 1;
  return need;
}
function runeUiRecipeReady(word, snapshot) {
  var need = runeUiRecipeNeeds(word);
  for (var id in need) if (runesViewCount(snapshot, id) < need[id]) return false;
  return true;
}

function runeUiChipHTML(id, snapshot, need) {
  var r = RUNE_BY_ID[id];
  var have = runesViewCount(snapshot, id);
  var enough = have >= (need || 1);
  return '<button type="button" class="rx-chip' + (enough ? ' has' : '') + '" data-rune-goto="' + id + '" style="--c:' + r.color +
    '" data-tip="' + esc(r.name + '符文（第 ' + r.tier + ' 階）｜持有 ' + have + (need > 1 ? '，此配方需要 ' + need : '') + '｜點擊查看') + '">' +
    '<span class="rx-chip-g">' + r.glyph + '</span>' + esc(r.name) + (need > 1 ? '<i>×' + need + '</i>' : '') + '</button>';
}

function runeUiLibraryHTML(snapshot, sel) {
  var h = '';
  for (var i = 0; i < RUNES.length; i++) {
    var r = RUNES[i];
    var n = runesViewCount(snapshot, r.id);
    h += '<button type="button" class="rx-card' + (r.id === sel ? ' is-sel' : '') + (n ? '' : ' is-empty') +
      '" data-rune-pick="' + r.id + '" style="--c:' + r.color + '">' +
      '<span class="rx-glyph">' + r.glyph + '</span>' +
      '<span class="rx-card-name">' + esc(r.name) + '</span>' +
      '<span class="rx-card-tier">第 ' + r.tier + ' 階</span>' +
      '<span class="rx-card-count">×' + fmt(n) + '</span></button>';
  }
  return h;
}

function runeUiStatLine(side, spec) {
  var def = AFFIX_POOL[spec[0]];
  var name = def ? def.name.replace(/%$/, '') : spec[0];
  return '<div class="rx-stat"><b>' + side + '</b>' + esc(name) + '<span>（約一條滿值詞條的 ' + Math.round(spec[1] * 100) + '%）</span></div>';
}

function runeUiFocusHTML(snapshot, id) {
  var r = RUNE_BY_ID[id];
  if (!r) return '';
  var n = runesViewCount(snapshot, id);
  var canCompose = n >= RUNE_COMPOSE_COUNT && r.tier < RUNE_COMPOSE_MAX_TIER;
  var canDismantle = n >= 1 && r.tier > 1;
  var next = r.tier < RUNES.length ? RUNES[r.tier] : null;
  var lower = r.tier > 1 ? RUNES[r.tier - 2] : null;
  var h = '<div class="rx-focus-head" style="--c:' + r.color + '">' +
    '<span class="rx-focus-glyph">' + r.glyph + '</span>' +
    '<div><div class="rx-focus-name">' + esc(r.name) + '符文<small>第 ' + r.tier + ' 階</small></div>' +
    '<div class="rx-focus-sub">持有 <b>' + fmt(n) + '</b> 顆</div></div></div>';
  h += '<div class="rx-stats">' +
    runeUiStatLine('⚔ 鑲在武器', r.w) + runeUiStatLine('🛡 鑲在防具・飾品・副手', r.a) +
    '<div class="rx-stat-note">數值隨裝備等級、稀有度與強化成長（與詞條同一套算法）；單獨鑲著就有效，組成符文之語時另有符文之語加成。</div></div>';
  h += '<div class="rx-actions">' +
    '<button type="button" class="btn" data-rune-act="compose"' + (canCompose ? '' : ' disabled') + '>合成（' + RUNE_COMPOSE_COUNT + ' → 1）</button>' +
    '<button type="button" class="btn" data-rune-act="composeAll"' + (canCompose ? '' : ' disabled') + '>全部合成</button>' +
    '<button type="button" class="btn warn" data-rune-act="dismantle"' + (canDismantle ? '' : ' disabled') + '>拆解（1 → ' + RUNE_DISMANTLE_YIELD + '）</button></div>';
  var note = [];
  if (next && r.tier < RUNE_COMPOSE_MAX_TIER) note.push('合成：' + RUNE_COMPOSE_COUNT + ' 顆「' + r.name + '」→ 1 顆「' + next.name + '」');
  else if (r.tier >= RUNE_COMPOSE_MAX_TIER) note.push('第 ' + RUNE_COMPOSE_MAX_TIER + ' 階以上的符文無法合成，只能靠擊殺與封魔塔掉落');
  if (lower) note.push('拆解：1 顆 → ' + RUNE_DISMANTLE_YIELD + ' 顆「' + lower.name + '」（合成 3 → 1 再拆解 1 → 2，所以拆解是虧的）');
  h += '<div class="rx-note">' + esc(note.join('；')) + '</div>';
  var uses = [];
  for (var i = 0; i < RUNEWORDS.length; i++) {
    if (RUNEWORDS[i].runes.indexOf(id) >= 0) uses.push(RUNEWORDS[i]);
  }
  h += '<div class="rx-uses"><div class="rx-sec">用在這些符文之語（' + uses.length + '）</div><div class="rx-use-list">';
  uses.forEach(function (w) {
    h += '<button type="button" class="rx-use" data-word-goto="' + w.id + '" style="--c:' + RUNEWORD_TIER_COLORS[w.tier] + '">' +
      esc(w.name) + '<i>' + esc(RUNEWORD_TIER_NAMES[w.tier]) + '</i></button>';
  });
  return h + '</div></div>';
}

function runeUiWordHTML(w, snapshot, worn) {
  var ready = runeUiRecipeReady(w, snapshot);
  var need = runeUiRecipeNeeds(w);
  var h = '<div class="rx-word' + (worn[w.id] ? ' is-worn' : '') + (ready ? ' is-ready' : '') + '" id="rxw-' + w.id + '" style="--c:' + RUNEWORD_TIER_COLORS[w.tier] + '">';
  h += '<div class="rx-word-head"><b>' + esc(w.name) + '</b><span class="rx-badge">' + esc(RUNEWORD_TIER_NAMES[w.tier]) + '</span>' +
    '<span class="rx-need">' + esc(rwSocketNeedText(w)) + '</span>' +
    (worn[w.id] ? '<span class="rx-flag worn">穿戴中・已成形</span>' : (ready ? '<span class="rx-flag ready">材料齊全</span>' : '')) + '</div>';
  h += '<div class="rx-recipe">';
  for (var i = 0; i < w.runes.length; i++) {
    if (i) h += '<span class="rx-arrow">→</span>';
    h += runeUiChipHTML(w.runes[i], snapshot, need[w.runes[i]]);
  }
  h += '</div>';
  h += '<div class="rx-bases">適用：' + esc(rwBasesText(w)) + '</div>';
  h += '<ul class="rx-lines">';
  rwDescribeLines(w).forEach(function (l) { h += '<li>' + esc(l) + '</li>'; });
  h += '</ul>';
  if (w.flavor) h += '<div class="rx-flavor">「' + esc(w.flavor) + '」</div>';
  return h + '</div>';
}

function runeUiTierChipsHTML(active) {
  var h = '';
  for (var t = 0; t <= 4; t++) {
    h += '<button type="button" class="gx-chip rx-tierchip' + (active === t ? ' is-on' : '') + '" data-rune-tier="' + t + '"' +
      (t ? ' style="--c:' + RUNEWORD_TIER_COLORS[t] + '"' : '') + '>' + (t ? esc(RUNEWORD_TIER_NAMES[t]) : '全部') + '</button>';
  }
  return h;
}

function renderRunes() {
  var box = $id('rune-grid');
  if (!box) return;
  var snapshot = (typeof uiGemsPanelSnapshot === 'function') ? uiGemsPanelSnapshot() : null;
  if (!snapshot) return;
  var st = runeUiState();
  if (!RUNE_BY_ID[st.sel]) st.sel = 'r01';
  var worn = runeUiWornWords();
  var wornCount = Object.keys(worn).length;
  setTextIfChanged($id('rune-total'), fmtFull(runesViewTotal(snapshot)));
  setTextIfChanged($id('rune-worn'), String(wornCount));

  var gridH = runeUiLibraryHTML(snapshot, st.sel);
  if (box._lastH !== gridH) { box._lastH = gridH; box.innerHTML = gridH; }
  var focus = $id('rune-focus');
  var focusH = runeUiFocusHTML(snapshot, st.sel);
  if (focus && focus._lastH !== focusH) { focus._lastH = focusH; focus.innerHTML = focusH; }

  var chips = $id('rune-tier-filter');
  var chipsH = runeUiTierChipsHTML(st.tier);
  if (chips && chips._lastH !== chipsH) { chips._lastH = chipsH; chips.innerHTML = chipsH; }
  var readyOnly = $id('rune-ready-only');
  if (readyOnly) readyOnly.checked = !!st.ready;
  var list = $id('runeword-list');
  if (list) {
    var h = '', shown = 0;
    for (var i = 0; i < RUNEWORDS.length; i++) {
      var w = RUNEWORDS[i];
      if (st.tier && w.tier !== st.tier) continue;
      if (st.ready && !runeUiRecipeReady(w, snapshot) && !worn[w.id]) continue;
      h += runeUiWordHTML(w, snapshot, worn);
      shown++;
    }
    if (!h) h = '<div class="gx-empty">沒有符合條件的符文之語</div>';
    if (list._lastH !== h) { list._lastH = h; list.innerHTML = h; }
    setTextIfChanged($id('rune-codex-count'), '顯示 ' + shown + ' / ' + RUNEWORDS.length + ' 組');
  }
  setRuneTool(st.tool);
}

function setRuneTool(tool) {
  if (RUNE_TOOLS.indexOf(tool) < 0) return;
  runeUiState().tool = tool;
  var sec = $id('tab-runes');
  if (sec && sec.setAttribute) sec.setAttribute('data-rune-tool', tool);
  if (sec && sec.querySelectorAll) {
    sec.querySelectorAll('[data-rune-tool-btn]').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.getAttribute('data-rune-tool-btn') === tool));
    });
  }
}

function selectRune(id) {
  if (!RUNE_BY_ID[id]) return;
  runeUiState().sel = id;
  renderRunes();
}

function runeUiAction(act) {
  var id = runeUiState().sel;
  var r = RUNE_BY_ID[id];
  if (!r) return;
  var cmd = act === 'compose' ? 'rune.compose' : (act === 'composeAll' ? 'rune.composeAll' : 'rune.dismantle');
  sendGemUiCommand(cmd, { runeId: id }, 'rune:' + id, ['gems', 'header'], function (result) {
    if (act === 'compose') {
      blog('🔷 符文合成：' + runeLabel(id) + ' ×' + RUNE_COMPOSE_COUNT + ' → ' + runeLabel(RUNES[r.tier].id), 'info', 'factory');
    } else if (act === 'dismantle' && result && result.id) {
      blog('🔷 符文拆解：' + runeLabel(id) + ' → ' + runeLabel(result.id) + ' ×' + result.n, 'info', 'factory');
    }
  });
}

/* 一次性綁定（由 ui.js 的初始化流程呼叫）。 */
function initRuneUi() {
  var tab = $id('tab-runes');
  if (!tab || !tab.addEventListener || tab._runeUiBound) return;
  tab._runeUiBound = true;
  tab.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var toolBtn = t.closest('[data-rune-tool-btn]');
    if (toolBtn) { setRuneTool(toolBtn.getAttribute('data-rune-tool-btn')); return; }
    var pick = t.closest('[data-rune-pick]');
    if (pick) { selectRune(pick.getAttribute('data-rune-pick')); return; }
    var go = t.closest('[data-rune-goto]');
    if (go) { setRuneTool('library'); selectRune(go.getAttribute('data-rune-goto')); return; }
    var wordGo = t.closest('[data-word-goto]');
    if (wordGo) {
      var wid = wordGo.getAttribute('data-word-goto');
      var st = runeUiState();
      st.tier = 0; st.ready = false;
      setRuneTool('codex');
      renderRunes();
      var el = $id('rxw-' + wid);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
      return;
    }
    var tier = t.closest('[data-rune-tier]');
    if (tier) { runeUiState().tier = parseInt(tier.getAttribute('data-rune-tier'), 10) || 0; renderRunes(); return; }
    var actBtn = t.closest('[data-rune-act]');
    if (actBtn && !actBtn.disabled) runeUiAction(actBtn.getAttribute('data-rune-act'));
  });
  var readyOnly = $id('rune-ready-only');
  if (readyOnly) {
    readyOnly.addEventListener('change', function () {
      runeUiState().ready = !!readyOnly.checked;
      renderRunes();
    });
  }
}
