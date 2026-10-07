'use strict';
/* ============ 符文頁（符文真言）— 主執行緒 UI ============
   資料表在 js/runeword_data.js、判定與說明文字在 js/runeword.js（兩端共載，純函式）。
   本檔只讀面板快照（gems 面板的 runes／runewordSeen 欄位、equip 面板的裝備）並送指令，不碰 G。

   兩個工具頁：
     符文庫        33 種符文的持有量、合成／拆解、這顆符文用在哪些符文真言
     符文真言圖鑑  全部配方、需要的鑲孔、適用裝備與效果；標出材料已齊全與穿戴中成形的

   ---- 說明隱藏（2026-10-07）----
   符文真言要「成形過一次」（快照 runewordSeen）才顯示配方與效果；在那之前：
     圖鑑卡片    名稱、品質、需要的孔數、適用裝備、風味文字照常顯示；配方的符文只留品質色外框、內容是「？」；
                 每條效果換成一行 8 個問號；材料齊全的提示也不給（否則等於洩漏配方）
     符文庫      「用在這些符文真言」的名稱換成問號，顏色是該真言的品質色，也不能點進圖鑑
     裝備詳情    「再鑲入…即可成形」的提示同樣遮起來（js/item.js 透過 runeUiWordRevealed 詢問）
   內測版（isInternalServer）頁首有一顆「詳細說明」開關：開＝全部攤開（改版前的樣子）、關＝與正式版相同；
   正式版沒有開關，永遠是「關」。開關只管畫面，不影響存檔裡的激活記錄。 */

var RUNE_TOOLS = ['library', 'codex'];

var RUNE_DETAIL_KEY = 'idle-rpg.runeDetail.v1';
var RUNE_UNKNOWN_LINE = '？？？？？？？？';   // 未激活的一條效果：8 個問號

function runeUiState() {
  if (!UI.runeBrowse) UI.runeBrowse = { tool: 'library', sel: 'r01', tier: 0, ready: false, detail: null };
  return UI.runeBrowse;
}

/* 開關只在內測版出現（與背包關鍵字篩選、屬性隱藏零值同一個判斷）；正式版 false。 */
function runeUiCanToggle() {
  return typeof isInternalServer === 'function' && isInternalServer();
}
/* 說明是否全部攤開。正式版恆為 false；內測版預設 true，選擇存在 localStorage。 */
function runeUiDetailOn() {
  if (!runeUiCanToggle()) return false;
  var st = runeUiState();
  if (st.detail === null || st.detail === undefined) {
    st.detail = true;
    try { if (localStorage.getItem(RUNE_DETAIL_KEY) === '0') st.detail = false; } catch (e) { }
  }
  return !!st.detail;
}
function runeUiSetDetail(on) {
  runeUiState().detail = !!on;
  try { localStorage.setItem(RUNE_DETAIL_KEY, on ? '1' : '0'); } catch (e) { }
}
/* 這組符文真言的內容（配方、效果、用途）現在要不要顯示：開關攤開，或成形過一次。 */
function runeUiRevealed(snapshot, wordId) {
  if (runeUiDetailOn()) return true;
  var seen = snapshot && snapshot.runewordSeen;
  return !!(seen && seen[wordId]);
}
/* 給 js/item.js 的配方提示用（那邊沒有快照可讀）；快照還沒到時一律當作未激活。 */
function runeUiWordRevealed(wordId) {
  return runeUiRevealed((typeof uiGemsPanelSnapshot === 'function') ? uiGemsPanelSnapshot() : null, wordId);
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

/* 穿戴中（檢視中那套）已成形的符文真言 id 清單。 */
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

/* 未激活的配方符文：只留品質色外框，內容是問號（不給名稱、階數與持有量，連提示都不能洩漏）。 */
function runeUiUnknownChipHTML(id) {
  var r = RUNE_BY_ID[id];
  return '<span class="rx-chip is-unknown" style="--c:' + r.color + '" data-tip="尚未成形過，配方未知">' +
    '<span class="rx-chip-g">？</span></span>';
}

function runeUiChipHTML(id, snapshot, need) {
  var r = RUNE_BY_ID[id];
  var have = runesViewCount(snapshot, id);
  var enough = have >= (need || 1);
  return '<button type="button" class="rx-chip' + (enough ? ' has' : '') + '" data-rune-goto="' + id + '" style="--c:' + r.color +
    '" data-tip="' + esc(r.name + '符文（第 ' + r.tier + ' 階）｜持有 ' + have + (need > 1 ? '，此配方需要 ' + need : '') + '｜點擊查看') + '">' +
    '<span class="rx-chip-g">' + runeStoneHTML(id, 'rs-chip') + '</span>' + esc(r.name) + (need > 1 ? '<i>×' + need + '</i>' : '') + '</button>';
}

function runeUiLibraryHTML(snapshot, sel) {
  var h = '';
  for (var i = 0; i < RUNES.length; i++) {
    var r = RUNES[i];
    var n = runesViewCount(snapshot, r.id);
    h += '<button type="button" class="rx-card' + (r.id === sel ? ' is-sel' : '') + (n ? '' : ' is-empty') +
      '" data-rune-pick="' + r.id + '" style="--c:' + r.color + '">' +
      '<span class="rx-glyph">' + runeStoneHTML(r.id, 'rs-card') + '</span>' +
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
    '<span class="rx-focus-glyph">' + runeStoneHTML(r.id, 'rs-focus') + '</span>' +
    '<div><div class="rx-focus-name">' + esc(r.name) + '符文<small>第 ' + r.tier + ' 階</small></div>' +
    '<div class="rx-focus-sub">持有 <b>' + fmt(n) + '</b> 顆</div></div></div>';
  h += '<div class="rx-stats">' +
    runeUiStatLine('⚔ 鑲在武器', r.w) + runeUiStatLine('🛡 鑲在防具・飾品・副手', r.a) +
    '<div class="rx-stat-note">數值隨裝備等級、稀有度與強化成長（與詞條同一套算法）；單獨鑲著就有效，組成符文真言時另有符文真言加成。</div></div>';
  h += '<div class="rx-actions">' +
    '<button type="button" class="btn" data-rune-act="compose"' + (canCompose ? '' : ' disabled') + '>合成（' + RUNE_COMPOSE_COUNT + ' → 1）</button>' +
    '<button type="button" class="btn" data-rune-act="composeAll"' + (canCompose ? '' : ' disabled') + '>全部合成</button>' +
    '<button type="button" class="btn warn" data-rune-act="dismantle"' + (canDismantle ? '' : ' disabled') + '>拆解（1 → ' + RUNE_DISMANTLE_YIELD + '）</button></div>';
  var note = [];
  if (next && r.tier < RUNE_COMPOSE_MAX_TIER) note.push('合成：' + RUNE_COMPOSE_COUNT + ' 顆「' + r.name + '」→ 1 顆「' + next.name + '」');
  else if (r.tier >= RUNE_COMPOSE_MAX_TIER) note.push('第 ' + RUNE_COMPOSE_MAX_TIER + ' 階以上的符文無法合成，只能靠擊殺與封魔塔掉落');
  if (lower) note.push('拆解：1 顆 → ' + RUNE_DISMANTLE_YIELD + ' 顆「' + lower.name + '」（合成 ' + RUNE_COMPOSE_COUNT + ' → 1、拆解 1 → ' + RUNE_DISMANTLE_YIELD + '：只能降階頂替、不會變多）');
  h += '<div class="rx-note">' + esc(note.join('；')) + '</div>';
  var uses = [];
  for (var i = 0; i < RUNEWORDS.length; i++) {
    if (RUNEWORDS[i].runes.indexOf(id) >= 0) uses.push(RUNEWORDS[i]);
  }
  h += '<div class="rx-uses"><div class="rx-sec">用在這些符文真言（' + uses.length + '）</div><div class="rx-use-list">';
  uses.forEach(function (w) {
    if (!runeUiRevealed(snapshot, w.id)) {
      // 未激活：名稱換成問號、顏色是該真言的品質色；不能點進圖鑑（點進去會把「這顆符文屬於哪一組」洩漏出去）
      h += '<span class="rx-use is-unknown" style="--c:' + RUNEWORD_TIER_COLORS[w.tier] + '" data-tip="尚未成形過，用途未知">？？？</span>';
      return;
    }
    h += '<button type="button" class="rx-use" data-word-goto="' + w.id + '" style="--c:' + RUNEWORD_TIER_COLORS[w.tier] + '">' +
      esc(w.name) + '<i>' + esc(RUNEWORD_TIER_NAMES[w.tier]) + '</i></button>';
  });
  return h + '</div></div>';
}

function runeUiWordHTML(w, snapshot, worn) {
  var revealed = runeUiRevealed(snapshot, w.id);
  var ready = revealed && runeUiRecipeReady(w, snapshot);   // 未激活時連「材料齊全」都不給，否則等於洩漏配方
  var need = runeUiRecipeNeeds(w);
  var h = '<div class="rx-word' + (worn[w.id] ? ' is-worn' : '') + (ready ? ' is-ready' : '') + '" id="rxw-' + w.id + '" style="--c:' + RUNEWORD_TIER_COLORS[w.tier] + '">';
  h += '<div class="rx-word-head"><b>' + esc(w.name) + '</b><span class="rx-badge">' + esc(RUNEWORD_TIER_NAMES[w.tier]) + '</span>' +
    '<span class="rx-need">' + esc(rwSocketNeedText(w)) + '</span>' +
    (worn[w.id] ? '<span class="rx-flag worn">穿戴中・已成形</span>' : (ready ? '<span class="rx-flag ready">材料齊全</span>' : '')) + '</div>';
  h += '<div class="rx-recipe">';
  for (var i = 0; i < w.runes.length; i++) {
    if (i) h += '<span class="rx-arrow">→</span>';
    h += revealed ? runeUiChipHTML(w.runes[i], snapshot, need[w.runes[i]]) : runeUiUnknownChipHTML(w.runes[i]);
  }
  h += '</div>';
  h += '<div class="rx-bases">適用：' + esc(rwBasesText(w)) + '</div>';
  h += '<ul class="rx-lines">';
  rwDescribeLines(w).forEach(function (l) {
    h += revealed ? '<li>' + esc(l) + '</li>' : '<li class="rx-unknown">' + RUNE_UNKNOWN_LINE + '</li>';
  });
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
  runeUiSyncToggle();
  var readyOnly = $id('rune-ready-only');
  if (readyOnly) readyOnly.checked = !!st.ready;
  var list = $id('runeword-list');
  if (list) {
    var h = '', shown = 0;
    for (var i = 0; i < RUNEWORDS.length; i++) {
      var w = RUNEWORDS[i];
      if (st.tier && w.tier !== st.tier) continue;
      if (st.ready && !worn[w.id] && !(runeUiRevealed(snapshot, w.id) && runeUiRecipeReady(w, snapshot))) continue;
      h += runeUiWordHTML(w, snapshot, worn);
      shown++;
    }
    if (!h) h = '<div class="gx-empty">沒有符合條件的符文真言</div>';
    if (list._lastH !== h) { list._lastH = h; list.innerHTML = h; }
    setTextIfChanged($id('rune-codex-count'), '顯示 ' + shown + ' / ' + RUNEWORDS.length + ' 組');
  }
  setRuneTool(st.tool);
}

/* 頁首的「詳細說明」開關：只有內測版顯示；文字與按下狀態跟著目前設定走。 */
function runeUiSyncToggle() {
  var btn = $id('rune-detail-toggle');
  if (!btn) return;
  var can = runeUiCanToggle();
  if (btn.hidden !== !can) btn.hidden = !can;
  if (!can) return;
  var on = runeUiDetailOn();
  setTextIfChanged(btn, on ? '詳細說明：開' : '詳細說明：關');
  if (btn.getAttribute('aria-pressed') !== String(on)) btn.setAttribute('aria-pressed', String(on));
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

/* 說明按鈕的文字：孔數與合成數量都讀設定（RUNE_SETTINGS），表一改說明就跟著變。 */
function runeUiHelpText() {
  var by = {}, order = [];
  for (var i = 0; i < RARITIES.length; i++) {
    var n = Number(RUNE_SETTINGS.slotsByRarity[i]) || 0;
    if (!n) continue;
    if (!by[n]) { by[n] = []; order.push(n); }
    by[n].push(RARITIES[i].name);
  }
  var slotText = order.map(function (n) {
    var names = by[n];
    return (names.length > 1 ? names[0] + '～' + names[names.length - 1] : names[0]) + ' ' + n + ' 孔';
  }).join('、');
  return '符文鑲在裝備專屬的符文孔裡（取代原本的附魔位置，與寶石鑲孔分開，一般裝備最多 ' + Math.max.apply(null, RUNE_SETTINGS.slotsByRarity) + ' 孔' + (RUNE_SETTINGS.twoHandBonusSlots > 0 ? '、雙手武器多 ' + RUNE_SETTINGS.twoHandBonusSlots + ' 孔' : '') + '；在裝備頁按「符文」鑲入）。' +
    '把「指定的符文、依指定順序」鑲進連續的符文孔，且裝備類型符合，就會成形為符文真言，獲得額外屬性與特殊威能；拆下任何一顆就失效，換回來又恢復。' +
    '每組符文真言要成形過一次，圖鑑才會顯示它的配方與效果；沒成形過的只看得到名稱、品質、需要的孔數與適用裝備。' +
    '符文從野外擊殺與封魔塔通關掉落，' + RUNE_COMPOSE_COUNT + ' 顆同種可合成為下一階（第 ' + RUNE_COMPOSE_MAX_TIER + ' 階以上只能掉落）。' +
    '符文孔數由稀有度決定：' + slotText + '。';
}

/* 一次性綁定（由 ui.js 的初始化流程呼叫）。 */
function initRuneUi() {
  var tab = $id('tab-runes');
  if (!tab || !tab.addEventListener || tab._runeUiBound) return;
  tab._runeUiBound = true;
  var helpBtn = tab.querySelector ? tab.querySelector('.pg-help') : null;
  if (helpBtn && helpBtn.setAttribute) helpBtn.setAttribute('data-tt-desc', runeUiHelpText());
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
  var detailBtn = $id('rune-detail-toggle');
  if (detailBtn && runeUiCanToggle()) {
    runeUiSyncToggle();
    detailBtn.addEventListener('click', function () {
      runeUiSetDetail(!runeUiDetailOn());
      if (UI.dirty) UI.dirty.equip = true;   // 裝備詳情的配方提示也跟著開關
      renderRunes();
    });
  }
  var readyOnly = $id('rune-ready-only');
  if (readyOnly) {
    readyOnly.addEventListener('change', function () {
      runeUiState().ready = !!readyOnly.checked;
      renderRunes();
    });
  }
}
