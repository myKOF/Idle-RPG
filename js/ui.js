'use strict';
/* ============ UI 渲染與互動 ============ */

var UI = {
  dirty: { header: true, battle: true, equip: true, inv: true, factory: true, forge: true, tower: true, gems: true, skills: true },
  sel: null,           // { id, source: 'inv' | 'equip' }
  tab: 'equip'
};

/* ---- 日誌 ---- */
function addLog(elId, msg, cls, cap, cat) {
  var box = $id(elId);
  if (!box) return;
  var div = document.createElement('div');
  div.className = 'log-line ' + (cls || '');
  if (cat) div.setAttribute('data-cat', cat);
  div.innerHTML = msg;
  box.insertBefore(div, box.firstChild);
  while (box.children.length > (cap || 150)) box.removeChild(box.lastChild);
}
function blog(msg, cls, cat) {
  if (!cat) {
    if (msg.includes('高塔') || msg.includes('狂暴') || msg.includes('重擊') || msg.includes('撤出')) cat = 'boss';
    else if (msg.includes('戰利品') || msg.includes('獲得') || msg.includes('掉落')) cat = 'loot';
    else if (msg.includes('強化') || msg.includes('換裝') || msg.includes('資源不足') || msg.includes('背包已滿') || msg.includes('暫存區已滿')) cat = 'factory';
    else if (msg.includes('推進') || msg.includes('退回') || msg.includes('復活') || msg.includes('擊倒') || msg.includes('遭遇')) cat = 'combat';
    else cat = 'system';
  }

  // 若處於高塔BOSS戰期間，將戰鬥與掉落日誌轉向到 boss 分類
  if (window.G && G.tower && G.tower.active && (cat === 'combat' || cat === 'loot')) {
    cat = 'boss';
  }

  if (cat === 'boss') {
    addLog('boss-log', msg, cls, 150, cat);
  } else {
    addLog('battle-log', msg, cls, 150, cat);
  }
}
function flog(msg, cls) { addLog('factory-log', msg, cls, 50); }

/* ---- 漂浮傷害字 ---- */
function floatText(elId, text, cls) {
  var layer = $id(elId);
  if (!layer || layer.offsetParent === null) return; // 不可見時略過
  if (layer.children.length > 12) layer.removeChild(layer.firstChild);
  var sp = document.createElement('span');
  sp.className = 'float-txt ' + (cls || '');
  sp.textContent = text;
  sp.style.left = (15 + Math.random() * 70) + '%';
  sp.style.marginTop = (Math.random() * 30 - 15) + 'px';
  layer.appendChild(sp);
  setTimeout(function () { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 950);
}

/* ---- 分頁 ---- */
function switchTab(name) {
  UI.tab = name;
  document.querySelectorAll('.tab-btn').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-tab') === name);
  });
  document.querySelectorAll('.tab').forEach(function (s) {
    s.classList.toggle('active', s.id === 'tab-' + name);
  });
  if (name === 'settings') renderSaveList(); // 進入設定分頁時刷新存檔記錄
  if (name === 'tower') UI._scrollTower = true;
}

/* ---- 存檔記錄列表（設定分頁） ---- */
function saveTimeStr(ts) {
  var t = new Date(ts);
  return t.getFullYear() + '/' + pad2(t.getMonth() + 1) + '/' + pad2(t.getDate()) + ' ' +
    pad2(t.getHours()) + ':' + pad2(t.getMinutes()) + ':' + pad2(t.getSeconds());
}
function renderSaveList() {
  var box = $id('save-list');
  if (!box) return;
  var curRun = (G && G.runId) || 1;
  var list = saveIndex().slice().sort(function (a, b) {
    // 本局的即時自動存檔置頂，其餘依時間新 → 舊
    var ac = (a.kind === 'auto' && a.runId === curRun) ? 1 : 0;
    var bc = (b.kind === 'auto' && b.runId === curRun) ? 1 : 0;
    if (ac !== bc) return bc - ac;
    return b.savedAt - a.savedAt;
  });
  if (!list.length) {
    box.innerHTML = '<div class="hint">尚無存檔記錄 — 按「💾 立即存檔」建立第一筆（自動存檔會在 15 秒內出現）</div>';
    return;
  }
  box.innerHTML = list.map(function (r) {
    var cur = r.kind === 'auto' && r.runId === curRun;
    return '<div class="save-row' + (r.kind === 'auto' ? ' auto' : '') + '">' +
      '<div class="save-info">' +
        '<div class="save-name">' + saveRecName(r) + (cur ? ' <span class="save-cur">目前遊戲</span>' : '') + '</div>' +
        '<div class="save-file">' + esc(r.fname) + '　<span class="save-time">' + saveTimeStr(r.savedAt) + '</span></div>' +
        '<div class="save-meta">Lv.' + r.level + '｜' + (ZONES[r.zone] ? ZONES[r.zone].emoji + ZONES[r.zone].name : '') + ' 第 ' + r.stage + ' 階｜第 ' + (r.runId || 1) + ' 局</div>' +
      '</div>' +
      '<div style="display:flex; gap:8px;">' +
        '<button class="btn sm" data-load-save="' + r.id + '">📥 讀取</button>' +
        '<button class="btn sm" data-dl-save="' + r.id + '">⬇️ 下載</button>' +
        '<button class="btn sm" style="color:var(--danger, #f87171); border-color:var(--danger, #f87171);" data-del-save="' + r.id + '">🗑️ 刪除</button>' +
      '</div>' +
      '</div>';
  }).join('');
}

/* ---- 頂部資源 / 屬性 ---- */
function renderHeader() {
  var p = G.player, st = getStats();
  $id('r-gold').textContent = fmt(p.gold);
  $id('r-scrap').textContent = fmt(p.scrap);
  $id('r-essence').textContent = fmt(p.essence);
  if ($id('r-dust')) $id('r-dust').textContent = fmt(p.dust || 0);
  // 神鑄頁籤：達到開放等級才顯示
  var forgeTabBtn = document.querySelector('.tab-btn[data-tab="forge"]');
  if (forgeTabBtn) forgeTabBtn.style.display = forgeUnlocked() ? '' : 'none';
  var gemTip = [];
  for (var gt in GEM_TYPES) {
    var tn = 0;
    for (var lv = 1; lv <= GEM_FORGE_MAX_LEVEL; lv++) tn += gemCount(gt, lv);
    if (tn) gemTip.push(GEM_TYPES[gt].emoji + GEM_TYPES[gt].name + ' x' + tn);
  }
  $id('r-gems').textContent = fmt(totalGemsAll());
  $id('r-gems').parentNode.title = gemTip.join('、') || '尚無寶石';
  var bookTotal = 0, bookTip = [];
  for (var bk in p.books) {
    bookTotal += p.books[bk];
    if (p.books[bk]) bookTip.push(ENCHANTS[bk].name + ' x' + p.books[bk]);
  }
  $id('r-books').textContent = fmt(bookTotal);
  $id('r-books').parentNode.title = bookTip.join('、') || '尚無附魔書';

  $id('toggle-compare').checked = !!G.settings.compareEq;
  $id('p-level').textContent = 'Lv.' + p.level;
  if ($id('pv-level')) $id('pv-level').textContent = 'Lv.' + p.level;
  if ($id('tp-level')) $id('tp-level').textContent = 'Lv.' + p.level;
  var need = xpForLevel(p.level);
  $id('xp-fill').style.width = clamp(p.xp / need * 100, 0, 100) + '%';
  $id('xp-bar').title = '經驗 ' + fmt(p.xp) + ' / ' + fmt(need);

  renderAttrPanel(st);

  // 更新側欄硬編碼的屬性
  if ($id('s-hp')) {
    $id('s-hp').textContent = fmt(st.hp);
    $id('s-atk').textContent = fmt(st.atk);
    $id('s-def').textContent = fmt(st.def);
    $id('s-aspd').textContent = fmt1(st.aspd);
    $id('s-crit').textContent = (st.critRate * 100).toFixed(1) + '%';
    $id('s-ls').textContent = (st.lifesteal * 100).toFixed(1) + '%';
    $id('s-hit').textContent = (st.hit * 100).toFixed(1) + '%';
    $id('s-loot').textContent = (st.lootBonus * 100).toFixed(1) + '%';
  }

  var dpsEl = $id('s-dps');
  if (dpsEl) dpsEl.textContent = fmt(currentDps());
}

/* ---- 側欄 50+ 屬性面板（分組摺疊） ---- */
var _attrPanelBuilt = false;
function renderAttrPanel(st) {
  var panel = $id('attr-panel');
  if (!panel) return;
  if (!_attrPanelBuilt) {
    // 首次建立骨架（前兩組預設展開）
    var h = '';
    STAT_GROUPS.forEach(function (g, gi) {
      h += '<details class="attr-group"' + (gi < 2 ? ' open' : '') + '><summary>' + esc(g.title) + '</summary>';
      g.rows.forEach(function (row, ri) {
        var descStr = typeof row[2] === 'function' ? row[2](st) : row[2];
        var tip = descStr ? ' data-tt-title="' + esc(row[0].replace(/<[^>]+>/g, '')) + '" data-tt-desc="' + esc(descStr) + '"' : '';
        h += '<div class="stat-row"' + tip + '><span>' + row[0] + '</span><b data-attr="' + gi + '-' + ri + '"></b></div>';
      });
      h += '</details>';
    });
    h += '<div class="stat-divider"></div>' +
      '<div class="stat-row" title="近 10 秒 DPS"><span>📈 實時 DPS</span><b id="s-dps">0</b></div>';
    panel.innerHTML = h;
    _attrPanelBuilt = true;
  }
  // 更新數值
  STAT_GROUPS.forEach(function (g, gi) {
    g.rows.forEach(function (row, ri) {
      var el = panel.querySelector('[data-attr="' + gi + '-' + ri + '"]');
      if (el) {
        el.innerHTML = row[1](st);
        if (typeof row[2] === 'function') {
          var p = el.parentElement;
          if (p) p.setAttribute('data-tt-desc', row[2](st));
        }
      }
    });
  });
}

/* ---- 戰鬥畫面 ---- */
function entStatus(ent) {
  if (!ent) return '';
  var s = [];
  if (effectActive(ent, 'stun')) s.push('😵暈眩');
  if (effectActive(ent, 'slow')) s.push('🐌減速');
  if (poisonActive(ent)) s.push('☠️中毒');
  if (ent.dots) {
    for (var i = 0; i < ent.dots.length; i++) {
      if (ent.dots[i].until > GT) s.push('🩸' + ent.dots[i].name);
    }
  }
  var bks = activeBuffKeys(ent);
  for (var b = 0; b < bks.length; b++) {
    var k = bks[b];
    if (k === 'atkDown' || k === 'defDown') s.push('📉' + buffLabel(k) + '↓');
    else s.push('💪' + buffLabel(k) + '↑');
  }
  return s.join(' ');
}
// MP 條與裝載技能狀態（prefix: 'pv' 野外 / 'tp' 高塔）
function renderMpSkill(pEnt, prefix) {
  var st = getStats();
  var mpFill = $id(prefix + '-mp'), mpText = $id(prefix + '-mptext'), skillEl = $id(prefix + '-skill');
  if (mpFill) mpFill.style.width = clamp(pEnt.mp / st.mp * 100, 0, 100) + '%';
  if (mpText) mpText.textContent = fmt(Math.floor(pEnt.mp)) + ' / ' + fmt(st.mp);
  if (skillEl) {
    var lo = G.player.loadout || [];
    if (!lo.length) {
      skillEl.innerHTML = '<div style="grid-column:1/-1;color:var(--dim);text-align:center;font-size:12px;margin-top:4px;">（未裝備）</div>';
      return;
    }

    var arr = [];
    for (var i = 0; i < lo.length; i++) {
      var sk = skillDef(lo[i]);
      if (!sk) continue;
      var cd = (pEnt.skillCds && pEnt.skillCds[lo[i]]) || 0;
      arr.push({ sk: sk, cd: cd, cost: sk.cost || 0 });
    }

    arr.sort(function (a, b) {
      return a.cd - b.cd;
    });

    arr = arr.slice(0, 12);

    var h = '';
    for (var i = 0; i < arr.length; i++) {
      var it = arr[i];
      var txt = '';
      var cls = '';
      if (it.cd > 0) { txt = fmt1(Math.max(0, it.cd)) + 's'; cls = 'on-cd'; }
      else if (pEnt.mp < it.cost) { txt = '🚫'; cls = 'no-mp'; }
      else { txt = '✓'; cls = 'ready'; }
      h += '<div class="sk-run-item ' + cls + '">' + it.sk.emoji + ' <span>' + txt + '</span></div>';
    }
    skillEl.innerHTML = h;
  }
}
// 場景最高階段（當前場景以即時值為準）
function zoneBestOf(z) {
  if (G.stage.zone === z) return G.stage.best;
  return (G.zoneProgress && G.zoneProgress[z] && G.zoneProgress[z].best) || 1;
}
function renderZoneBar() {
  var cur = G.stage.zone || 'plains';
  document.querySelectorAll('.zone-btn').forEach(function (b) {
    var z = b.getAttribute('data-zone');
    var zd = ZONES[z];
    var locked = false;
    if (zd && zd.reqZone) {
      if (zoneBestOf(zd.reqZone) < zd.reqStage) locked = true;
    }

    if (locked) {
      b.classList.add('locked');
      b.classList.remove('active');
      b.disabled = true;
      b.style.opacity = '0.5';
      b.style.cursor = 'not-allowed';
      var badge = b.querySelector('.zone-best');
      if (badge) badge.innerHTML = '🔒需' + ZONES[zd.reqZone].name + ' ' + zd.reqStage + '級';
    } else {
      b.classList.remove('locked');
      b.classList.toggle('active', z === cur);
      b.disabled = false;
      b.style.opacity = '1';
      b.style.cursor = 'pointer';
      var badge = b.querySelector('.zone-best');
      if (badge) badge.textContent = '(' + fmt(zoneBestOf(z)) + ')';
    }
  });
}
function renderBattle() {
  var st = getStats();
  var stg = G.stage;
  renderZoneBar();
  var znd = currentZoneDef();
  $id('stage-label').textContent = znd.emoji + ' 第 ' + stg.current + ' 階段';
  $id('stage-best').textContent = '最高 ' + stg.best;
  $id('st-auto').checked = stg.autoAdvance;

  var p = FIELD.player;
  if (p) {
    var php = clamp(p.hp / st.hp * 100, 0, 100);
    $id('pv-hp').style.width = php + '%';
    var pSh = (p.shield > 0.5) ? '<span style="color:var(--info)">+' + fmt(Math.max(0, p.shield)) + '</span>' : '';
    $id('pv-hptext').innerHTML = fmt(Math.max(0, p.hp)) + pSh + ' / ' + fmt(st.hp);
    $id('pv-status').textContent = FIELD.reviveCd > 0 ? ('💀 復活中 ' + fmt1(FIELD.reviveCd) + 's') : entStatus(p);
    renderMpSkill(p, 'pv');
  }
  var m = FIELD.monster;
  if (m) {
        if (m.img && !m.imgFailed) {
      var iconClass = m.isBoss ? 'cb-icon boss' : 'cb-icon monster';
      var mvImg = $id('mv-emoji').querySelector('img');
      var targetSrc = 'images/' + m.img;
      if (!mvImg) {
        $id('mv-emoji').innerHTML = '<img src="' + targetSrc + '" class="' + iconClass + '" data-src="' + targetSrc + '">';
        mvImg = $id('mv-emoji').querySelector('img');
        if (mvImg) mvImg.onerror = function () { m.imgFailed = true; };
      } else {
        if (mvImg.getAttribute('data-src') !== targetSrc) {
          mvImg.setAttribute('data-src', targetSrc);
          mvImg.setAttribute('src', targetSrc);
          mvImg.onerror = function () { m.imgFailed = true; };
        }
        if (mvImg.className !== iconClass) mvImg.className = iconClass;
      }
    } else {
      $id('mv-emoji').innerHTML = '<span style="font-size:48px;">' + (m.emoji || '👾') + '</span>';
    }
    $id('mv-name').textContent = m.name;
    if ($id('mv-level')) $id('mv-level').textContent = 'Lv.' + m.level;
    $id('mv-name').classList.toggle('elite', m.elite);
    var mhp = clamp(m.hp / m.maxHp * 100, 0, 100);
    $id('mv-hp').style.width = mhp + '%';
    $id('mv-hp').parentNode.style.visibility = 'visible';
    var mSh = (m.shield > 0.5) ? '<span style="color:var(--info)">+' + fmt(Math.max(0, m.shield)) + '</span>' : '';
    $id('mv-hptext').innerHTML = fmt(Math.max(0, m.hp)) + mSh + ' / ' + fmt(m.maxHp);
    $id('mv-status').textContent = entStatus(m);
  } else {
$id('mv-emoji').innerHTML = '<span style="font-size:48px;">🔍</span>';
    $id('mv-name').textContent = G.tower.active ? '（高塔戰鬥中…）' : '搜索敵人中…';
    if ($id('mv-level')) $id('mv-level').textContent = '';
    $id('mv-hp').style.width = '0%';
    $id('mv-hp').parentNode.style.visibility = 'hidden';
    $id('mv-hptext').textContent = '';
    $id('mv-status').textContent = '';
  }
}

/* ---- 裝備分頁 ---- */
function itemCellHTML(it, source, extraClass) {
  var r = RARITIES[it.rarity];
  var effClass = (it.rarity === 6) ? ' eff-mythic' : (it.rarity >= GODFORGED_IDX ? ' eff-godforged' : (it.rarity === 7 ? ' eff-genesis' : ''));
  var info = SLOT_INFO[it.slot];
  var iconHtml = info.icon ? '<img src="images/' + info.icon + '" class="item-icon">' : '<span class="ic-emoji">' + info.emoji + '</span>';
  return '<div class="item-cell' + effClass + (extraClass || '') + '" data-id="' + it.id + '" data-src="' + source + '" data-slot="' + it.slot + '" ' +
    'style="border-color:' + r.color + ';box-shadow:inset 0 0 12px ' + r.color + '33">' +
    iconHtml +
    (it.upgrade ? '<span class="ic-up">+' + it.upgrade + '</span>' : '') +
    (itemEnchants(it).length ? '<span class="ic-enc">' + (ENCHANTS[itemEnchants(it)[0].key] || {}).emoji +
      (itemEnchants(it).length > 1 ? '×' + itemEnchants(it).length : '') + '</span>' : '') +
    (it.locked ? '<span class="ic-lock">🔒</span>' : '') +
    (it.synthesized ? '<span class="ic-syn">✦</span>' : '') +
    '<span class="ic-lv">' + it.level + '</span>' +
    '</div>';
}

function renderEquip() {
  var box = $id('equip-grid');
  var h = '';
  SLOT_LIST.forEach(function (slot) {
    var it = G.equipment[slot];
    var info = SLOT_INFO[slot];
    if (it) {
      var r = RARITIES[it.rarity];
      var effClass = (it.rarity === 6) ? ' eff-mythic' : (it.rarity >= GODFORGED_IDX ? ' eff-godforged' : (it.rarity === 7 ? ' eff-genesis' : ''));
      var iconHtml = info.icon ? '<img src="images/' + info.icon + '" class="eq-icon">' : '<div class="eq-emoji">' + info.emoji + '</div>';
      h += '<div class="eq-slot filled' + effClass + ' slot-' + slot + '" data-id="' + it.id + '" data-src="equip" data-slot="' + slot + '" style="border-color:' + r.color + '; box-shadow: inset 0 0 15px ' + r.color + '40">' +
        iconHtml + '</div>';
    } else {
      var iconHtml = info.icon ? '<img src="images/' + info.icon + '" class="eq-icon dim">' : '<div class="eq-emoji dim">' + info.emoji + '</div>';
      h += '<div class="eq-slot empty slot-' + slot + '" data-slot="' + slot + '">' + iconHtml + '</div>';
    }
  });
  box.innerHTML = h;
  renderDetail();
}

function renderInventory() {
  var cap = INVENTORY_CAP + (G.player.invUpgrades || 0);
  var cost = 10000 + (G.player.invUpgrades || 0) * 1000;
  var btn = $id('inv-expand');
  if (btn) btn.textContent = '➕ 擴充 (' + cost + 'G)';

  var box = $id('inventory-grid');
  $id('inv-count').textContent = G.inventory.length + '/' + cap;
  if (!G.inventory.length) {
    box.innerHTML = '<div class="hint" style="grid-column: 1 / -1; padding: 10px;">背包是空的。戰鬥掉落的裝備會先進入生產線輸送帶，「保留」的會送到這裡。</div>';
  } else {
    box.innerHTML = G.inventory.map(function (it) { return itemCellHTML(it, 'inv'); }).join('');
  }
  renderDetail();
}

/* 僅搜尋背包與裝備欄。刻意不含神鑄法陣槽位：detailAction 的操作（裝備/強化/洗煉）
   以此為來源依據，若涵蓋法陣槽位，殘留的 UI.sel 會讓槽內裝備被再次穿上造成複製。 */
function findItemById(id) {
  if (!id) return null;
  for (var i = 0; i < G.inventory.length; i++) if (G.inventory[i].id === id) return G.inventory[i];
  for (var s in G.equipment) if (G.equipment[s] && G.equipment[s].id === id) return G.equipment[s];
  return null;
}

function findSelItem() {
  if (!UI.sel) return null;
  return findItemById(UI.sel.id);
}

function renderDetail() {
  var pane = $id('detail-pane');
  var it = findSelItem();
  updateSelectionUI();
  if (!it) {
    pane.innerHTML = '<div class="hint">點選裝備查看詳情</div>';
    pane.classList.remove('has-detail');
    var actionBar = $id('equip-action-bar');
    if (actionBar) {
      actionBar.innerHTML = '';
      actionBar.style.display = 'none';
    }
    return;
  }
  var cost = upgradeCost(it);
  var compareItem = null;
  var tc = $id('toggle-compare');
  if (tc && tc.checked && UI.sel.source === 'inv') {
    var key = equipTargetSlot(it);
    compareItem = G.equipment[key];
  }
  var h = itemDetailHTML(it, compareItem);
  var actionsHtml = '';
  if (UI.sel.source === 'inv') {
    actionsHtml += '<button class="btn" data-act="equip">裝備</button>';
    actionsHtml += '<button class="btn warn" data-act="salvage">分解</button>';
    if (SYNTHESIS_ENABLED) actionsHtml += '<button class="btn" data-act="tosynth">送合成區</button>';
  } else {
    actionsHtml += '<button class="btn" data-act="unequip">卸下</button>';
  }
  var enoughUpGold = G.player.gold >= cost.gold;
  var enoughUpScrap = G.player.scrap >= cost.scrap;
  var upGoldHtml = '<span' + (enoughUpGold ? '' : ' style="color:#fca5a5"') + '><img src="images/icon_gold.png" class="res-icon"> ' + fmt(cost.gold) + '</span>';
  var upScrapHtml = '<span' + (enoughUpScrap ? '' : ' style="color:#fca5a5"') + '><img src="images/icon_scrap.png" class="res-icon"> ' + fmt(cost.scrap) + '</span>';
  var upTip = '需要：' + upGoldHtml + ' &nbsp;' + upScrapHtml;
  actionsHtml += '<button class="btn act-btn-tooltip" data-act="upgrade" data-tip="' + esc(upTip) + '">強化</button>';

  actionsHtml += '<button class="btn" data-act="lock">' + (it.locked ? '解鎖' : '鎖定') + '</button>';
  // 鑲嵌選擇（有空插槽時列出持有寶石）
  ensureSockets(it);
  if (it.sockets.indexOf(null) >= 0) {
    var chips = [];
    for (var gt in GEM_TYPES) {
      var total = 0, hi = 0;
      for (var lv = GEM_FORGE_MAX_LEVEL; lv >= 1; lv--) {
        var n = gemCount(gt, lv);
        total += n;
        if (n && !hi) hi = lv;
      }
      if (total) {
        chips.push('<span class="gem-chip" data-gem-socket="' + gt + '" data-tip="鑲嵌 ' + esc(GEM_NAMES[hi] + GEM_TYPES[gt].name) + '">' +
          GEM_TYPES[gt].emoji + esc(GEM_TYPES[gt].name) + ' L' + hi + '×' + gemCount(gt, hi) + '</span>');
      }
    }
    (G.player.fusedGems || []).forEach(function (fg) {
      chips.push('<span class="gem-chip fused-chip" data-gem-socket-fused="' + fg.id + '" data-tip="鑲嵌雙屬性融合寶石">' +
        esc(fusedGemLabel(fg)) + '</span>');
    });
    h += '<div class="sec-sub">💎 鑲嵌寶石（點擊鑲入空插槽，自動取最高等級；🧬 為融合寶石）</div>' +
      '<div class="gem-picker">' + (chips.length ? chips.join('') : '<span class="hint">尚無寶石庫存</span>') + '</div>';
  }
  // 附魔書選擇（有空附魔欄時列出此部位可用的書；點擊既有附魔可取下）
  var itEns2 = itemEnchants(it);
  if (itEns2.length < enchantCapFor(it)) {
    var cat2 = enchantCatForType(it.slot);
    var bookChips2 = [];
    for (var bk2 in ENCHANTS) {
      if (ENCHANTS[bk2].cat !== cat2) continue;
      var bn2 = G.player.books[bk2] || 0;
      if (!bn2) continue;
      var owned = itEns2.some(function (en2) { return en2.key === bk2; });
      bookChips2.push('<span class="gem-chip' + (owned ? ' dim-chip' : '') + '" data-book-enchant="' + bk2 + '" data-tip="' +
        esc(ENCHANTS[bk2].desc) + (owned ? '（已附魔，僅可升級數值）' : '') + '">' +
        ENCHANTS[bk2].emoji + esc(ENCHANTS[bk2].name) + ' ×' + bn2 + '</span>');
    }
    var catNames2 = { atk: '攻擊', def: '防禦', util: '功能' };
    h += '<div class="sec-sub">✨ 附魔（' + catNames2[cat2] + '類，每次消耗 1 書＋🔮' + ENCHANT_ESSENCE_COST +
      ' 精華，庫存 ' + fmt(G.player.essence) + '）</div>' +
      '<div class="gem-picker">' + (bookChips2.length ? bookChips2.join('') : '<span class="hint">沒有此部位可用的附魔書（階段 8+ 掉落 / 高塔獎勵）</span>') + '</div>';
  }
  pane.innerHTML = h;
  pane.classList.add('has-detail');
  var actionBar = $id('equip-action-bar');
  if (actionBar) {
    actionBar.innerHTML = actionsHtml;
    actionBar.style.display = 'flex';
  }
}

function updateSelectionUI() {
  var selItem = findSelItem();
  var targetSlot = null;
  if (selItem && UI.sel.source === 'inv') {
    targetSlot = equipTargetSlot(selItem);
  }

  document.querySelectorAll('.item-cell, .eq-slot').forEach(function (el) {
    el.classList.remove('selected', 'dimmed');

    if (targetSlot && el.classList.contains('eq-slot') && el.getAttribute('data-slot') === targetSlot) {
      el.classList.add('selected');
    }

    if (!selItem) return;

    var elId = el.getAttribute('data-id');
    if (elId && elId === selItem.id) {
      el.classList.add('selected');
    } else if (el.classList.contains('item-cell')) {
      var elSlot = el.getAttribute('data-slot');
      if (elSlot !== selItem.slot) {
        el.classList.add('dimmed');
      }
    }
  });
}

function showFloatingText(btn, text, color) {
  var rect = btn.getBoundingClientRect();
  var el = document.createElement('div');
  el.textContent = text;
  el.style.position = 'fixed';
  el.style.left = (rect.left + rect.width / 2) + 'px';
  el.style.top = rect.top + 'px';
  el.style.transform = 'translate(-50%, -100%)';
  el.style.color = color;
  el.style.fontWeight = 'bold';
  el.style.textShadow = '0 0 4px #000';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '9999';
  el.style.transition = 'all 0.8s ease-out';
  document.body.appendChild(el);

  el.offsetHeight; // force reflow

  el.style.top = (rect.top - 40) + 'px';
  el.style.opacity = '0';

  setTimeout(function () {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 800);
}

/* ---- 生產線與合成 ---- */
function detailAction(act, actBtn) {
  var it = findSelItem();
  if (!it) return;
  var idx;
  if (act === 'equip') {
    idx = G.inventory.indexOf(it);
    if (idx >= 0) G.inventory.splice(idx, 1);
    var old = equipItem(it);
    if (old) { old.locked = false; addToInventory(old); }
    UI.sel = { id: it.id, source: 'equip' };
    UI.dirty.inv = true; UI.dirty.equip = true;
  } else if (act === 'unequip') {
    var cap = INVENTORY_CAP + (G.player.invUpgrades || 0);
    if (G.inventory.length >= cap) { blog('⚠️ 背包已滿，無法卸下', 'warn'); return; }
    // 依物品 id 找出實際佔用的欄位（武器/戒指有主副兩欄）
    for (var sk2 in G.equipment) {
      if (G.equipment[sk2] && G.equipment[sk2].id === it.id) { G.equipment[sk2] = null; break; }
    }
    markStatsDirty();
    addToInventory(it);
    UI.sel = { id: it.id, source: 'inv' };
    UI.dirty.inv = true; UI.dirty.equip = true; UI.dirty.header = true;
  } else if (act === 'salvage') {
    idx = G.inventory.indexOf(it);
    if (idx >= 0) {
      G.inventory.splice(idx, 1);
      var res = doSalvage(it);
      UI.sel = null;
      UI.dirty.inv = true;
    }
  } else if (act === 'tosynth') {
    if (!SYNTHESIS_ENABLED) { blog('⚠️ 合成節點目前暫時關閉', 'warn'); return; }
    idx = G.inventory.indexOf(it);
    if (idx >= 0) {
      if (G.factory.synthBuffer.length >= synthBufCap()) { blog('⚠️ 合成暫存區已滿', 'warn'); return; }
      G.inventory.splice(idx, 1);
      it.locked = false;
      G.factory.synthBuffer.push(it);
      flog('🧪 手動送入合成暫存區：' + rarityTag(it), '');
      UI.sel = null;
      UI.dirty.inv = true; UI.dirty.factory = true;
    }
  } else if (act === 'upgrade') {
    var upResult = manualUpgrade(it);
    if (actBtn && upResult === 'ok') {
      showFloatingText(actBtn, '強化成功！', '#7dd3fc');
    } else if (actBtn && upResult === 'fail') {
      showFloatingText(actBtn, '強化失敗！', '#fca5a5');
    } else if (actBtn && upResult === 'poor') {
      showFloatingText(actBtn, '材料不足', '#fbbf24');
    }
  } else if (act === 'reroll-affix') {
    var affixKey = actBtn.getAttribute('data-affix');
    if (affixKey) {
      var rerr = rerollSingleAffix(it, affixKey);
      if (rerr) {
        showFloatingText(actBtn, '材料不足', '#fbbf24');
        blog('⚠️ 洗煉失敗：' + rerr, 'warn');
      } else {
        showFloatingText(actBtn, '洗煉完成', '#4ade80');
        blog('🎲 洗煉完成：' + rarityTag(it) + ' 的詞條已重骰！', 'good');
      }
    }
  } else if (act === 'lock') {
    it.locked = !it.locked;
    UI.dirty.inv = true; UI.dirty.equip = true;
  }
  renderDetail();
}

function salvageAllUnlocked(maxRarity) {
  var kept = [], targets = [], count = 0, scrap = 0;
  var hasRarityLimit = typeof maxRarity === 'number' && !isNaN(maxRarity);
  G.inventory.forEach(function (it) {
    if (it.locked) { kept.push(it); return; }
    if (hasRarityLimit && it.rarity > maxRarity) { kept.push(it); return; }
    targets.push(it);
  });
  if (targets.length && typeof manualSave === 'function') {
    var rec = manualSave('before_bulk_salvage');
    if (rec) flog('💾 已建立拆解前存檔：' + rec.fname, 'info');
  }
  targets.forEach(function (it) {
    var res = doSalvage(it, true);
    scrap += res.scrap;
    count++;
  });
  G.inventory = kept;
  if (count) flog('⚒️ 一鍵分解 ' + count + ' 件 → 碎片x' + fmt(scrap), 'info');
  UI.sel = null;
  UI.dirty.inv = true;
}

/* ---- 生產線分頁 ---- */
function renderFactory() {
  var f = G.factory;
  // 輸送帶
  var conv = $id('conveyor-items');
  var show = f.conveyor.slice(0, 18);
  conv.innerHTML = show.map(function (it) {
    var r = RARITIES[it.rarity];
    return '<span class="conv-chip" style="border-color:' + r.color + ';color:' + r.color + '" data-tip="' +
      esc(rarityTag(it)) + '">' + SLOT_INFO[it.slot].emoji + '</span>';
  }).join('') + (f.conveyor.length > 18 ? '<span class="conv-more">+' + (f.conveyor.length - 18) + '</span>' : '');
  $id('conveyor-count').textContent = f.conveyor.length + '/' + conveyorCap();

  // 分解槽資訊（精粹提取率含分解高產/幸運加成）
  var speedUp = 1 + partBonus('salvage', 'speedGear') / 100;
  $id('salv-info').textContent = '處理速度 ' + fmt1(speedUp) + 'x｜精粹提取率 ' + fmt1(extractChanceNow()) +
    '%｜已分解 ' + fmt(f.stats.salvaged) + '｜精粹提取 ' + fmt(f.stats.extracted) + ' 次';

  // 合成節點資訊（大成功率含幸運值加成）
  if (SYNTHESIS_ENABLED) {
    var greatChance = SYNTH_GREAT_BASE + partBonus('synth', 'luckCore') + getStats().luck / 2;
    var reroll = partBonus('synth', 'rerollModule');
    $id('syn-info').textContent = '大成功率 ' + fmt1(greatChance) + '%｜重骰率 ' + fmt1(reroll) +
      '%｜變異率 ' + fmt1(getStats().hybridMutation) + '%｜已合成 ' + fmt(f.stats.synthesized) + ' 件' +
      (f.stats.mutated ? '（變異 ' + fmt(f.stats.mutated) + '）' : '');
  } else {
    $id('syn-info').textContent = '合成節點目前暫時關閉';
  }
  var buf = $id('synth-buffer');
  buf.innerHTML = f.synthBuffer.length
    ? f.synthBuffer.slice(0, 12).map(function (it) {
      var r = RARITIES[it.rarity];
      return '<span class="conv-chip" style="border-color:' + r.color + ';color:' + r.color + '" data-tip="' +
        esc(rarityTag(it)) + '">' + SLOT_INFO[it.slot].emoji + '</span>';
    }).join('') + (f.synthBuffer.length > 12 ? '<span class="conv-more">+' + (f.synthBuffer.length - 12) + '</span>' : '')
    : '<span class="hint">合成節點目前暫時關閉</span>';

  // 附魔節點資訊
  var bookChips = [];
  for (var bk in G.player.books) {
    if (G.player.books[bk] > 0) bookChips.push('<span class="book-chip">' + ENCHANTS[bk].emoji + esc(ENCHANTS[bk].name) + ' x' + G.player.books[bk] + '</span>');
  }
  $id('enc-books').innerHTML = bookChips.length ? bookChips.join('') : '<span class="hint">尚無附魔書（階段 8+ 掉落 / 高塔獎勵）</span>';
  $id('enc-info').textContent = '精華庫存 ' + fmt(G.player.essence) + '（每次消耗 ' + ENCHANT_ESSENCE_COST + '）｜已附魔 ' + fmt(f.stats.enchanted) + ' 次';

  // 強化節點
  $id('up-info').textContent = '已自動強化 ' + fmt(f.stats.upgraded) + ' 次' +
    (f.stats.upgradeFailed ? '｜失敗 ' + fmt(f.stats.upgradeFailed) + ' 次' : '') +
    '｜+5 後有失敗風險（可堆「強化成功率」屬性）';

  // 已安裝零件
  renderInstalledParts('salvage', 'salv-parts');
  renderInstalledParts('synth', 'syn-parts');
  var salvLbl = $id('salv-slot-label'); // 分解槽格數隨等級成長，即時顯示
  if (salvLbl) salvLbl.textContent = '（' + slotsForNode('salvage') + ' 格，每 ' + SALVAGE_SLOT_PER_LEVEL + ' 級 +1，上限 ' + SALVAGE_SLOT_MAX + '）';
  renderAvailableParts('salvage', 'salv-avail-parts');
  renderAvailableParts('synth', 'syn-avail-parts');
}

function renderInstalledParts(node, elId) {
  if (!isFactoryNodeEnabled(node)) { $id(elId).innerHTML = ''; return; }
  var ids = G.factory.installed[node] || [];
  var h = ids.map(function (id) {
    var p = findPart(id);
    if (!p) return '';
    return '<span class="part-chip" style="cursor:pointer; border-color:var(--good);" data-part-uninstall="' + p.id + '" data-tip="【點擊卸下】 ' + esc(partDesc(p)) + '">' + PART_TYPES[p.key].emoji + esc(p.name) + '</span>';
  }).join('');
  for (var i = ids.length; i < slotsForNode(node); i++) h += '<span class="part-chip empty">空槽</span>';
  $id(elId).innerHTML = h;
}

function renderAvailableParts(node, elId) {
  if (!isFactoryNodeEnabled(node)) { $id(elId).innerHTML = ''; return; }
  var avail = G.factory.parts.filter(function (p) {
    var pt = PART_TYPES[p.key];
    return pt && pt.node === node && !isInstalled(p.id);
  });
  if (!avail.length) {
    $id(elId).innerHTML = '<span class="hint" style="font-size:12px;">尚無可用零件</span>';
  } else {
    $id(elId).innerHTML = avail.map(function (p) {
      var pt = PART_TYPES[p.key];
      return '<span class="part-chip" style="cursor:pointer; border-color:var(--accent);" data-part-install="' + p.id + '" data-tip="【點擊安裝】 ' + esc(partDesc(p)) + '">' + pt.emoji + esc(p.name) + '</span>';
    }).join('');
  }
}

// 將工廠設定同步到輸入元件（初始化 / 讀檔後）
function syncFactoryInputs() {
  var f = G.factory;
  document.querySelectorAll('.flt-sel').forEach(function (sel) {
    var r = parseInt(sel.getAttribute('data-rarity'), 10);
    sel.value = f.filter.actions[r];
  });
  $id('flt-autoequip').checked = f.autoEquip;
  $id('syn-hybrid').checked = f.synth.hybridEnabled;
  $id('syn-merge').checked = f.synth.mergeEnabled;
  $id('syn-gem').checked = f.synth.gemMerge;
  $id('syn-mingem').value = String(f.synth.minGemLevel);
  $id('syn-book').value = f.synth.bookChoice;
  // 附魔已改為裝備介面手動操作（無自動附魔設定）
  $id('up-enabled').checked = f.upgrade.enabled;
  $id('up-cap').value = String(f.upgrade.cap);
}

/* ---- 神鑄分頁 ----
   六芒星以 Hexagram.png 為底，槽位/魔塵符位以百分比座標絕對定位
  （座標對應法陣星角，順時針自頂點起）。邏輯層 → js/forge.js。 */
var FORGE_SLOT_POS = [
  { x: 50, y: 21 }, { x: 63, y: 36 }, { x: 63, y: 64 },
  { x: 50, y: 79 }, { x: 37, y: 64 }, { x: 37, y: 36 }
];
var FORGE_DUST_POS = [
  { x: 50, y: 7 }, { x: 70.5, y: 28.5 }, { x: 70.5, y: 71.5 },
  { x: 50, y: 93 }, { x: 29.5, y: 71.5 }, { x: 29.5, y: 28.5 }
];

function renderForge() {
  var hex = $id('forge-hex');
  if (!hex) return;
  var f = forgeState();
  var h = '';
  // 六個素材槽（裝備或寶石，二擇一模式）
  for (var i = 0; i < FORGE_SLOTS; i++) {
    var p = FORGE_SLOT_POS[i];
    var it = f.slots[i];
    var style = 'left:' + p.x + '%;top:' + p.y + '%;';
    if (it && it.kind === 'gem') {
      var gcol = GEM_TIER_COLORS[it.level] || '#f5c542';
      h += '<div class="forge-slot filled" data-forge-slot="' + i + '" data-tip="' + esc(gemLabel(it.type, it.level)) + '（點擊取回）" ' +
        'style="' + style + 'border-color:' + gcol + ';box-shadow:0 0 14px ' + gcol + 'aa, inset 0 0 10px ' + gcol + '55">' +
        '<span class="ic-emoji">' + GEM_TYPES[it.type].emoji + '</span><span class="ic-lv">' + it.level + '</span></div>';
    } else if (it) {
      var r = RARITIES[it.rarity];
      var info = SLOT_INFO[it.slot];
      var iconHtml = info.icon ? '<img src="images/' + info.icon + '" class="item-icon">' : '<span class="ic-emoji">' + info.emoji + '</span>';
      h += '<div class="forge-slot filled" data-forge-slot="' + i + '" data-id="' + it.id + '" data-tip="' + esc(it.name) + '（點擊取回背包）" ' +
        'style="' + style + 'border-color:' + r.color + ';box-shadow:0 0 14px ' + r.color + 'aa, inset 0 0 10px ' + r.color + '55">' +
        iconHtml + '<span class="ic-lv">' + it.level + '</span></div>';
    } else {
      h += '<div class="forge-slot empty" data-forge-slot="' + i + '" data-tip="點擊下方背包中的裝備（傳說/神話/創世）或寶石（五階以上）放入" style="' + style + '"></div>';
    }
  }
  // 六個魔塵符位（各自獨立：點哪格亮哪格）
  var dustN = forgeDustCount();
  for (var di = 0; di < FORGE_SLOTS; di++) {
    var dp = FORGE_DUST_POS[di];
    var lit = !!f.dustSlots[di];
    h += '<div class="forge-dust' + (lit ? ' lit' : '') + '" data-forge-dust="' + di + '" data-tip="' +
      (lit ? '點擊取下魔塵' : '點擊放入魔塵（+' + FORGE_DUST_RATE + '% 成功率）') + '" style="left:' + dp.x + '%;top:' + dp.y + '%;">💫</div>';
  }
  // 中央產物（上次鑄造成功的裝備或寶石）
  if (f.result && f.result.kind === 'gem' && GEM_TYPES[f.result.type]) {
    var gc = GEM_TIER_COLORS[f.result.level] || '#f5c542';
    var gname = gemLabel(f.result.type, f.result.level);
    h += '<div class="forge-center" data-tip="上次鑄造產物：' + esc(gname) + '（已放入寶石庫存）" ' +
      'style="border-color:' + gc + ';box-shadow:0 0 25px ' + gc + 'cc, inset 0 0 14px ' + gc + '66">' +
      '<span class="ic-emoji" style="font-size:26px">' + GEM_TYPES[f.result.type].emoji + '</span>' +
      '<div class="forge-center-name" style="color:' + gc + '">' + esc(gname) + '</div></div>';
  } else if (f.result && RARITIES[f.result.rarity] && SLOT_INFO[f.result.slot]) {
    var rr = RARITIES[f.result.rarity];
    var rInfo = SLOT_INFO[f.result.slot];
    var rIcon = rInfo.icon ? '<img src="images/' + rInfo.icon + '" class="item-icon">' : '<span class="ic-emoji">' + rInfo.emoji + '</span>';
    h += '<div class="forge-center" data-tip="上次鑄造產物：' + esc(f.result.name) + '（Lv.' + f.result.level + '，已放入背包）" ' +
      'style="border-color:' + rr.color + ';box-shadow:0 0 25px ' + rr.color + 'cc, inset 0 0 14px ' + rr.color + '66">' + rIcon +
      '<div class="forge-center-name" style="color:' + rr.color + '">' + esc(f.result.name) + '</div></div>';
  } else {
    h += '<div class="forge-center empty" data-tip="鑄造成功的裝備/寶石會顯示在此"></div>';
  }
  hex.innerHTML = h;
  // 成功率與金幣消耗（依模式：裝備 / 寶石）
  var rate = forgeRateInfo();
  var rateEl = $id('forge-rate');
  if (rate) {
    rateEl.innerHTML = (rate.mode === 'gem' ? '💎 寶石' : '') + '鑄造成功率：<b style="color:#ffd700">' + fmt1(rate.base) + '%</b>' +
      (rate.dust > 0 ? ' <b style="color:#4ade80">+ ' + fmt1(rate.dust) + '%</b>' : '') +
      '　<span class="dim-text">金幣消耗：<img src="images/icon_gold.png" class="res-icon">' + fmt(rate.cost) + '</span>';
  } else {
    rateEl.innerHTML = '<span class="dim-text">放入 6 件相同品質的裝備（傳說 55%｜神話 40%｜創世 25%）或 6 顆同種同階寶石（五階 45% ~ 九階 5%）</span>';
  }
  // 法陣紀錄
  $id('forge-log').innerHTML = f.log.map(function (l) {
    return '<div class="forge-log-line ' + l.cls + '">' + esc(l.msg) + '</div>';
  }).join('');
  // 自動魔塵與持有量
  $id('forge-autodust').checked = !!f.autoDust;
  $id('forge-dust-own').textContent = '持有魔塵 ' + fmt(G.player.dust || 0) + ' 個｜已放置 ' + dustN + '/' + FORGE_SLOTS;
  // 背包（裝備 / 寶石切頁；不符資格者以灰階顯示）
  var invTab = UI.forgeInvTab || 'items';
  var tabItemsBtn = $id('forge-invtab-items'), tabGemsBtn = $id('forge-invtab-gems');
  if (tabItemsBtn) tabItemsBtn.classList.toggle('active', invTab === 'items');
  if (tabGemsBtn) tabGemsBtn.classList.toggle('active', invTab === 'gems');
  var grid = $id('forge-inventory-grid');
  if (invTab === 'gems') {
    $id('forge-inv-count').textContent = fmt(totalGemsAll());
    var gh = '';
    for (var glv = GEM_FORGE_MAX_LEVEL; glv >= 1; glv--) {
      for (var gt2 in GEM_TYPES) {
        var gn = gemCount(gt2, glv);
        if (!gn) continue;
        var gok = glv >= GEM_MAX_LEVEL && glv < GEM_FORGE_MAX_LEVEL;
        var gcol2 = GEM_TIER_COLORS[glv] || '#f5c542';
        var gdef = GEM_TYPES[gt2];
        var gval = gdef.pct ? pctStr(gemStatValue(gt2, glv)) : fmt(gemStatValue(gt2, glv));
        gh += '<div class="item-cell forge-gem-cell' + (gok ? '' : ' forge-na') + '" data-forge-gem="' + gt2 + ':' + glv + '" ' +
          'data-tip="' + esc(gemLabel(gt2, glv) + '｜' + gdef.statName.replace('%', '') + ' +' + gval + '｜持有 ' + gn + ' 顆' +
            (gok ? '（點擊放入法陣）' : (glv < GEM_MAX_LEVEL ? '（五階以上才可鑄造）' : '（十階已是最高階級）'))) + '" ' +
          'style="border-color:' + gcol2 + ';box-shadow:inset 0 0 12px ' + gcol2 + '33">' +
          '<span class="ic-emoji">' + gdef.emoji + '</span>' +
          '<span class="ic-lv">' + glv + '</span>' +
          '<span class="gem-cnt">x' + fmt(gn) + '</span></div>';
      }
    }
    grid.innerHTML = gh || '<div class="hint" style="grid-column: 1 / -1; padding: 10px;">尚無寶石。戰鬥掉落與寶石商店可取得寶石。</div>';
  } else {
    var cap = INVENTORY_CAP + (G.player.invUpgrades || 0);
    $id('forge-inv-count').textContent = G.inventory.length + '/' + cap;
    if (!G.inventory.length) {
      grid.innerHTML = '<div class="hint" style="grid-column: 1 / -1; padding: 10px;">背包是空的。戰鬥掉落的裝備會先進入生產線輸送帶，「保留」的會送到這裡。</div>';
    } else {
      grid.innerHTML = G.inventory.map(function (it2) {
        var ok = it2.rarity >= FORGE_MIN_RARITY && it2.rarity < GODFORGED_IDX;
        return itemCellHTML(it2, 'forgeinv', ok ? '' : ' forge-na');
      }).join('');
    }
  }
}

/* ---- 高塔分頁 ---- */
function renderTower() {
  var fightBox = $id('tower-fight');
  var listBox = $id('tower-list-wrap');
  if (G.tower.active) {
    fightBox.style.display = '';
    listBox.style.display = 'none';
    // 動態部分由 renderTowerFight 處理
  } else {
    fightBox.style.display = 'none';
    listBox.style.display = '';
    var h = '';
    var maxShow = G.tower.highest + 3;
    for (var fl = 1; fl <= maxShow; fl++) {
      var unlocked = fl <= G.tower.highest + 1;
      var cleared = fl <= G.tower.highest;
      var bd = BOSS_LIST[(fl - 1) % BOSS_LIST.length];

            var bossIcon = (bd.img && !bd.imgFailed) ? 'images/' + bd.img : null;
      var bossIdx = (fl - 1) % BOSS_LIST.length;
      var iconHtml = bossIcon
        ? '<img src="' + bossIcon + '" style="width:32px;height:32px;vertical-align:middle;border-radius:4px;box-shadow:0 0 5px #000;" onerror="BOSS_LIST[' + bossIdx + '].imgFailed=true; this.outerHTML=\'<span style=&quot;font-size:24px;vertical-align:middle;&quot;>\' + (bd.emoji || \'👾\') + \'</span>\';">'
        : '<span style="font-size:24px;vertical-align:middle;">' + (bd.emoji || '👾') + '</span>';

      var twCost = towerChallengeCost(fl);
      h += '<div class="tower-floor' + (cleared ? ' cleared' : '') + (unlocked ? '' : ' locked') + '" data-tower-tip="' + fl + '">' +
        '<span class="tf-emoji" style="margin-right:12px;">' + iconHtml + '</span>' +
        '<span class="tf-name" style="vertical-align:middle;">第 ' + fl + ' 層・' + bd.name + (cleared ? ' ✅' : '') + '</span>' +
        '<span class="tf-hint" style="margin-left:auto; margin-right:10px;">建議野外階段 ' + (4 + fl * 5) + '+｜挑戰費 <span style="color:' + (G.player.gold >= twCost ? '#ffd700' : '#fca5a5') + '">💰' + fmt(twCost) + '</span></span>' +
        (unlocked ? '<button class="btn sm" data-tower-floor="' + fl + '">挑戰</button>' : '<span class="tf-lock">🔒</span>') +
        '</div>';
    }
    $id('tower-floors').innerHTML = h;
    // 上次結果
    var rbox = $id('tower-result');
    var r = TOWER.result;
    if (r) {
      var rh = '<div class="tr-title ' + (r.win ? 'good' : 'bad') + '">' +
        (r.win ? '🏆 通關第 ' + r.floor + ' 層！' : '💀 第 ' + r.floor + ' 層挑戰失敗') + '</div>';
      if (r.win) {
        rh += '<div class="tr-sub">獲得獎勵：</div>' + r.rewards.map(function (x) { return '<div class="tr-line">' + x + '</div>'; }).join('');
      } else {
        rh += '<div class="tr-sub">戰鬥數據：DPS ' + fmt(r.myDps) + '（通關需求約 ' + fmt(r.needDps) + '）｜BOSS 剩餘血量 ' + r.bossHpPct + '%</div>';
        rh += '<div class="tr-sub">失敗分析：</div>' + r.analysis.map(function (x) { return '<div class="tr-line">📋 ' + esc(x) + '</div>'; }).join('');
      }
      rbox.innerHTML = rh;
      rbox.style.display = '';
    } else {
      rbox.style.display = 'none';
    }
    if (UI._scrollTower) {
      UI._scrollTower = false;
      setTimeout(function() {
        var el = document.querySelector('.tower-floor[data-tower-tip="' + (G.tower.highest + 1) + '"]');
        if (el) el.scrollIntoView({ behavior: 'auto', block: 'center' });
      }, 10);
    }
  }
}

// 高塔戰鬥動態渲染（每 tick）
function renderTowerFight() {
  if (!G.tower.active) return;
  var st = getStats();
  var b = TOWER.boss, p = TOWER.player;
  if (!b || !p) return;
  var remain = Math.max(0, TOWER_TIME_LIMIT - TOWER.elapsed);
  $id('tw-timer').textContent = fmt1(remain) + 's';
  $id('tw-timer').classList.toggle('urgent', remain < 15);
  $id('tw-enrage').style.display = TOWER.enraged ? '' : 'none';
  if (b.img && !b.imgFailed) {
    var bossImgSrc = 'images/' + b.img;
    var tbImg = $id('tb-emoji').querySelector('img');
    if (!tbImg) {
      $id('tb-emoji').innerHTML = '<img src="' + bossImgSrc + '" class="cb-icon boss" data-src="' + bossImgSrc + '">';
      tbImg = $id('tb-emoji').querySelector('img');
      if (tbImg) tbImg.onerror = function () { b.imgFailed = true; };
    } else {
      if (tbImg.getAttribute('data-src') !== bossImgSrc) {
        tbImg.setAttribute('data-src', bossImgSrc);
        tbImg.setAttribute('src', bossImgSrc);
        tbImg.onerror = function () { b.imgFailed = true; };
      }
      if (tbImg.className !== 'cb-icon boss') tbImg.className = 'cb-icon boss';
    }
  } else {
    $id('tb-emoji').innerHTML = '<span style="font-size:48px;">' + (b.emoji || '👾') + '</span>';
  }
  $id('tb-name').innerHTML = b.name;
  if ($id('tb-level')) $id('tb-level').textContent = 'Lv.' + b.level;
  $id('tb-hp').style.width = clamp(b.hp / b.maxHp * 100, 0, 100) + '%';
  var bSh = (b.shield > 0.5) ? '<span style="color:var(--info)">+' + fmt(Math.max(0, b.shield)) + '</span>' : '';
  $id('tb-hptext').innerHTML = fmt(Math.max(0, b.hp)) + bSh + ' / ' + fmt(b.maxHp) + '（' + Math.round(b.hp / b.maxHp * 100) + '%）';
  $id('tb-status').innerHTML = entStatus(b) + (b.elem ? ' 屬性:' + ENCHANTS[b.elem].emoji : '');
  $id('tp-hp').style.width = clamp(p.hp / st.hp * 100, 0, 100) + '%';
  var pSh2 = (p.shield > 0.5) ? '<span style="color:var(--info)">+' + fmt(Math.max(0, p.shield)) + '</span>' : '';
  $id('tp-hptext').innerHTML = fmt(Math.max(0, p.hp)) + pSh2 + ' / ' + fmt(st.hp);
  $id('tp-status').textContent = entStatus(p);
  renderMpSkill(p, 'tp');
  $id('tw-dps').textContent = 'DPS ' + fmt(TOWER.elapsed > 1 ? TOWER.dmgDealt / TOWER.elapsed : 0) +
    '（需求 ' + fmt(b.maxHp / TOWER_TIME_LIMIT) + '）';
}

function uiTick() {
  var d = UI.dirty;
  // 分頁標題戰況（每秒更新一次即可）
  _titleTimer += 0.2;
  if (_titleTimer >= 1) { _titleTimer = 0; updateLiveTitle(); }
  // 神鑄系統開放通知（達標後僅提示一次，涵蓋升級當下與讀檔已達標兩種情況）
  if (forgeUnlocked() && !forgeState().unlockNotified) {
    forgeState().unlockNotified = true;
    UI.dirty.header = true; // 立即顯示神鑄頁籤
    blog('🔯 <span class="log-hl-good">神鑄系統已開啟！</span>角色達到 ' + FORGE_UNLOCK_LEVEL + ' 級，可於「神鑄」分頁鑄造更高品質的裝備。', 'good');
    showConfirmDialog('神鑄系統已開啟！\n\n將 6 件相同品質的裝備（傳說/神話/創世）放入六芒星法陣，即可鑄造下一品質的裝備。是否前往查看？', function () {
      switchTab('forge');
      UI.dirty.forge = true;
    }, { title: '🔯 神鑄系統', okText: '前往神鑄', cancelText: '稍後再說' });
  }
  if (d.header) { renderHeader(); d.header = false; }
  renderBattle(); // Battle is always visible
  if (UI.tab === 'tower' && G.tower.active) renderTowerFight();
  d.battle = false;
  if (d.equip && UI.tab === 'equip') { renderEquip(); d.equip = false; }
  if (d.inv && UI.tab === 'equip') { renderInventory(); d.inv = false; }
  if (d.factory && UI.tab === 'factory') { renderFactory(); d.factory = false; }
  if ((d.forge || d.inv) && UI.tab === 'forge') { renderForge(); d.forge = false; d.inv = false; }
  if (d.tower && UI.tab === 'tower') { renderTower(); d.tower = false; }
  if (d.gems && UI.tab === 'gems') { renderGems(); d.gems = false; }
  if (UI.tab === 'gems') updateShopCountdown(); // 商店重置倒數即時更新
  if (d.skills && UI.tab === 'skills') { renderSkills(); d.skills = false; }
}

/* ---- 技能分頁（技能樹 + 融合） ---- */
UI.selSkill = null;      // 目前選取的技能 id
UI.fuseSlots = [];       // 融合素材槽（最多 4）

function skillCellHTML(id) {
  var sk = skillDef(id);
  if (!sk) return '';
  var lv = skillLevel(id);
  var lock = tierLockReason(id);
  var inLoadout = (G.player.loadout || []).indexOf(id) >= 0;
  var maxLv = skillMaxLv(sk);
  var cls = 'tree-cell' + (lv > 0 ? ' learned' : '') + (lock ? ' locked' : '') +
    (UI.selSkill === id ? ' selected' : '') + (inLoadout ? ' equipped' : '');
  return '<div class="' + cls + '" data-sk="' + id + '">' +
    '<span class="tc-emoji">' + sk.emoji + '</span>' +
    (lv > 0 ? '<span class="tc-lv' + (lv >= maxLv ? ' max-lv' : '') + '">' + lv + '</span>' : (lock ? '<span class="tc-lock">🔒</span>' : '')) +
    (inLoadout ? '<span class="tc-eq">⚔</span>' : '') +
    '</div>';
}

function renderSkills() {
  var treesBox = $id('skill-trees');
  if (!treesBox) return;
  var p = G.player;
  $id('sp-count').textContent = availableSkillPoints() + '（等級 ' + p.level + ' 共 ' + totalSkillPoints() + ' 點，已用 ' + spentSkillPoints() + '）';

  // 裝載欄（每 20 級 +1 格）
  var loBox = $id('skill-loadout');
  var lo = p.loadout || [];
  var cap = loadoutSize();
  $id('loadout-cap').textContent = lo.length + '/' + cap + ' 格（角色每 20 級 +1 格）';
  var lh = '';
  for (var i = 0; i < cap; i++) {
    var id0 = lo[i];
    var d0 = id0 ? skillDef(id0) : null;
    if (d0) {
      lh += '<span class="loadout-slot filled" draggable="true" data-index="' + i + '" data-skill-unequip="' + id0 + '" data-sk="' + id0 + '">' +
        d0.emoji + ' ' + esc(d0.name) + ' Lv.' + skillLevel(id0) + '</span>';
    } else {
      lh += '<span class="loadout-slot" data-index="' + i + '">空欄位</span>';
    }
  }
  loBox.innerHTML = lh;

  // 融合技（置頂區）
  var fuList = $id('fusion-skill-list');
  var fusions = p.fusions || [];
  fuList.innerHTML = fusions.length
    ? fusions.map(function (f) { return skillCellHTML(f.id); }).join('')
    : '<span class="hint">尚無融合技 — 使用下方「技能融合」創造你的專屬奧義！</span>';

  // 技能樹（每系一棵，4 個一階；階層需投入點數解鎖）
  var h = '';
  for (var cat in SKILL_CATS) {
    var cells = [];
    for (var id in SKILLS) {
      if (SKILLS[id].cat === cat) cells.push(skillCellHTML(id));
    }
    var rows = '';
    for (var r = 0; r < cells.length; r += 4) {
      rows += '<div class="tree-row">' + cells.slice(r, r + 4).join('') + '</div>' +
        (r + 4 < cells.length ? '<div class="tree-gate">▼ 第 ' + (r / 4 + 2) + ' 階（需投入 ' + ((r / 4 + 1) * TIER_GATE_POINTS) + ' 點）</div>' : '');
    }
    h += '<div class="tree-panel"><div class="tree-title">' + SKILL_CATS[cat].emoji + ' ' + SKILL_CATS[cat].name +
      ' <span class="dim-text">已投入 ' + catSpentPoints(cat) + ' 點</span></div>' + rows + '</div>';
  }
  treesBox.innerHTML = h;

  renderSkillModal();
  renderFusionPanel();
}

/* ---- 技能升級彈窗 ---- */
function openSkillModal(id) {
  UI.selSkill = id;
  hideTooltip();
  var overlay = $id('skill-modal');
  if (overlay) overlay.style.display = 'flex';
  renderSkillModal();
}
function closeSkillModal() {
  var overlay = $id('skill-modal');
  if (overlay) overlay.style.display = 'none';
  UI.selSkill = null;
}
function renderSkillModal() {
  var body = $id('skill-modal-body');
  var overlay = $id('skill-modal');
  if (!body || !overlay || overlay.style.display === 'none') return;
  var id = UI.selSkill;
  var sk = id ? skillDef(id) : null;
  if (!sk) { closeSkillModal(); return; }
  var lv = skillLevel(id);
  var maxLv = skillMaxLv(sk);
  var lock = tierLockReason(id);
  var inLoadout = (G.player.loadout || []).indexOf(id) >= 0;
  var isFusion = sk.cat === 'fusion';
  var h = '<div class="skd-head"><span class="skd-emoji">' + sk.emoji + '</span><b>' + esc(sk.name) + '</b> ' +
    '<span class="dim-text">Lv.' + lv + '/' + maxLv + '｜' + (SKILL_CATS[sk.cat] ? SKILL_CATS[sk.cat].name : '融合技') + '</span>' +
    (sk.cat !== 'passive' ? '<span class="sk-meta">🔵 ' + sk.cost + ' MP　⏱️ ' + sk.cd + 's</span>' : '') + '</div>';
  h += '<div class="sk-desc">' + describeSkill(id, Math.max(1, lv)) + '</div>';
  if (lv > 0 && lv < maxLv) {
    h += '<div class="skd-next dim-text">下一級：' + describeSkill(id, lv + 1) + '</div>';
  }
  if (sk.flavor) h += '<div class="sk-flavor">' + esc(sk.flavor) + '</div>';
  if (lock) h += '<div class="hint">🔒 ' + esc(lock) + '</div>';

  h += '<div style="text-align: right; margin-top: 12px; color: #facc15; font-size: 14px; font-weight: bold;">技能點：' + availableSkillPoints() + '</div>';
  h += '<div class="detail-actions" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px;">';
  if (lv < maxLv && !lock) {
    var cost = skillUpgradeCost(lv);
    h += '<button class="btn sm" data-skill-learn="' + id + '" data-tip="花費 ' + fmt(cost) + ' 金幣"' + (G.player.gold < cost ? ' disabled' : '') + '>' +
      (lv === 0 ? '📖 學習' : '⬆️ 升級') + '</button>';
  } else if (lv >= maxLv) {
    h += '<div style="text-align:center; padding: 4px; color: var(--good); font-size: 12px;">已滿級</div>';
  } else {
    h += '<div></div>'; // empty grid cell
  }

  if (lv > 0) {
    h += '<button class="btn sm warn" data-skill-downgrade="' + id + '" data-tip="退回 1 技能點（不退還金幣）">⬇️ 降級</button>';
  } else {
    h += '<div></div>'; // empty grid cell
  }

  if (sk.cat !== 'passive' && lv > 0) {
    h += inLoadout
      ? '<button class="btn sm warn" data-skill-unequip="' + id + '">卸下</button>'
      : '<button class="btn sm" data-skill-equip="' + id + '">⚔️ 裝備</button>';
  } else {
    h += '<div></div>'; // empty grid cell
  }

  if (!isFusion && sk.cat !== 'passive' && lv > 0) {
    h += '<button class="btn sm" data-skill-fuse-add="' + id + '">⚗️ 加入融合</button>';
  } else {
    h += '<div></div>';
  }

  if (isFusion) {
    h += '<button class="btn sm danger" data-fusion-delete="' + id + '">🗑️ 刪除</button>';
  } else {
    h += '<div></div>';
  }

  h += '</div>';
  body.innerHTML = h;
}

/* ---- 技能懸停提示 ---- */
function showSkillTooltip(id, anchorEl) {
  var tip = $id('sk-tooltip');
  if (!tip) return;
  var sk = skillDef(id);
  if (!sk) return;
  var lv = skillLevel(id);
  var lock = tierLockReason(id);
  var h = '<div class="skt-name">' + sk.emoji + ' ' + esc(sk.name) +
    ' <span class="dim-text">Lv.' + lv + '/' + skillMaxLv(sk) + '</span></div>';
  if (sk.cat !== 'passive') h += '<div class="skt-meta">🔵 ' + sk.cost + ' MP　⏱️ ' + sk.cd + 's</div>';
  h += '<div class="skt-desc">' + describeSkill(id, Math.max(1, lv)) + '</div>';
  if (lock) h += '<div class="skt-lock">🔒 ' + esc(lock) + '</div>';
  h += '<div class="skt-hint">點擊開啟升級面板</div>';
  tip.innerHTML = h;
  tip.style.display = 'block';
  // 定位：優先顯示在圖示右側，貼邊時翻到左側/上方
  var r = anchorEl.getBoundingClientRect();
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var x = r.right + 10, y = r.top;
  if (x + tw > window.innerWidth - 8) x = r.left - tw - 10;
  if (x < 8) x = 8;
  if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
  if (y < 8) y = 8;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function showStatTooltip(title, desc, anchorEl) {
  var tip = $id('sk-tooltip');
  if (!tip) return;
  var h = '<div class="skt-name">' + title + '</div>';
  h += '<div class="skt-desc">' + desc + '</div>';
  tip.innerHTML = h;
  tip.style.display = 'block';
  var r = anchorEl.getBoundingClientRect();
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var x = r.right + 10, y = r.top;
  if (x + tw > window.innerWidth - 8) x = r.left - tw - 10;
  if (y < 8) y = 8;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function showItemTooltip(it, anchorEl) {
  var tip = $id('sk-tooltip');
  if (!tip) return;
  var h = itemDetailHTML(it, null);
  tip.innerHTML = '<div style="padding: 6px; min-width: 220px;">' + h + '</div>';
  tip.style.display = 'block';
  var r = anchorEl.getBoundingClientRect();
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var x = r.right + 10, y = r.top;
  if (x + tw > window.innerWidth - 8) x = r.left - tw - 10;
  if (x < 8) x = 8;
  if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
  if (y < 8) y = 8;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function showTowerTooltip(flStr, anchorEl) {
  var tip = $id('sk-tooltip');
  if (!tip) return;
  var fl = parseInt(flStr, 10);
  if (!fl) return;

  var dropTip = '<div class="skt-name" style="margin-bottom:6px;">【挑戰費用】</div>' +
    '<div class="skt-desc" style="text-align:left;">💰 ' + fmt(towerChallengeCost(fl)) +
    ' 金幣 <span style="color:var(--dim)">(100000 + 樓層 x 200000)</span></div>' +
    '<div class="skt-name" style="margin:6px 0;">【可能掉落物】</div>' +
    '<div class="skt-desc" style="text-align:left;">' +
    '💰 金幣 x' + fmt(200 * fl) + ' <span style="color:var(--dim)">(首通雙倍)</span><br>' +
    '🔮 附魔精華 x' + (3 + fl) + ' <span style="color:var(--dim)">(100%)</span><br>' +
    '💎 隨機寶石 x2 <span style="color:var(--dim)">(100%)</span><br>' +
    '📖 隨機附魔書 x2 <span style="color:var(--dim)">(100%)</span><br>' +
    '💫 魔塵 <span style="color:var(--dim)">(' + fmt1(bossDustRate(fl)) + '%，神鑄材料)</span><br>' +
    '🔩 機組零件 <span style="color:var(--dim)">(首通必掉 / 之後30%)</span>';

  var bossRates = dropRatesFor(BOSS_DROP_TABLE, fl);
  var equipStrs = [];
  for (var br = bossRates.length - 1; br >= 0; br--) {
    if (!bossRates[br]) continue;
    var rate = bossRates[br];
    var rateStr = '';
    if (rate >= 100) {
      rateStr = '必定' + Math.floor(rate / 100) + '件';
      var rem = rate % 100;
      if (rem > 0) rateStr += ' + ' + rem + '%再1件';
    } else {
      rateStr = '機率' + rate + '%';
    }
    equipStrs.push('⚔️ <span style="color:' + RARITIES[br].color + '; font-weight:bold;">' + RARITIES[br].name + '裝備</span> <span style="color:var(--dim)">(' + rateStr + ')</span>');
  }
  if (equipStrs.length) {
    dropTip += '<br>' + equipStrs.join('<br>');
  }

  dropTip += '</div>';
  tip.innerHTML = dropTip;
  tip.style.display = 'block';
  var r = anchorEl.getBoundingClientRect();
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var x = r.left + 20, y = r.bottom + 8;
  if (x + tw > window.innerWidth - 8) x = window.innerWidth - tw - 8;
  if (x < 8) x = 8;
  if (y + th > window.innerHeight - 8) y = r.top - th - 8;
  if (y < 8) y = 8;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function showEnemyTooltip(anchorEl) {
  var tip = $id('sk-tooltip');
  if (!tip) return;
  var m = G.tower.active ? (typeof TOWER_FIGHT !== 'undefined' && TOWER_FIGHT ? TOWER_FIGHT.monster : null) : (typeof FIELD !== 'undefined' && FIELD ? FIELD.monster : null);
  if (!m || m.hp <= 0) return;

  var dropTip = '<div class="skt-name" style="margin-bottom:6px;">【敵人情報】</div>' +
    '<div class="skt-desc" style="text-align:left;">' +
    '⚔️ 攻擊力：' + fmt(m.atk) + '<br>' +
    '⚡ 攻擊速度：' + fmt1(m.aspd) + ' 次/秒<br>' +
    '🛡️ 物理防禦：' + fmt(m.def) + '<br>' +
    '🔮 魔法防禦：' + fmt(m.mdef || m.def * 0.75) + '<br>' +
    '❤️ 最大生命：' + fmt(m.maxHp) + '</div>';

  var rates = dropRatesFor(FIELD_DROP_TABLE, m.level);
  var equipStrs = [];
  for (var r = rates.length - 1; r >= 0; r--) {
    if (!rates[r]) continue;
    var rate = rates[r];
    var rateStr = rate + '%';
    equipStrs.push('⚔️ <span style="color:' + RARITIES[r].color + '; font-weight:bold;">' + RARITIES[r].name + '裝備</span> <span style="color:var(--dim)">(' + rateStr + ')</span>');
  }

  if (equipStrs.length) {
    dropTip += '<div class="skt-name" style="margin:8px 0 6px;">【可能掉落】</div>' +
      '<div class="skt-desc" style="text-align:left;">' +
      '💰 金幣 x' + fmt(m.gold) + ' <span style="color:var(--dim)">(基礎)</span><br>' +
      '✨ 經驗 x' + fmt(m.xp) + ' <span style="color:var(--dim)">(基礎)</span><br>' +
      equipStrs.join('<br>') + '</div>';
  }

  tip.innerHTML = dropTip;
  tip.style.display = 'block';
  var rRect = anchorEl.getBoundingClientRect();
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var x = rRect.right + 10, y = rRect.top;
  if (x + tw > window.innerWidth - 8) x = rRect.left - tw - 10;
  if (x < 8) x = 8;
  if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
  if (y < 8) y = 8;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function hideTooltip() {
  var tip = $id('sk-tooltip');
  if (tip) tip.style.display = 'none';
}

// 融合面板
function renderFusionPanel() {
  var slotBox = $id('fusion-slots');
  if (!slotBox) return;
  var h = '';
  for (var i = 0; i < 4; i++) {
    var id = UI.fuseSlots[i];
    var d = id ? SKILLS[id] : null;
    if (d) {
      h += '<span class="loadout-slot filled" data-fuse-remove="' + id + '" data-tip="點擊移出">' +
        d.emoji + ' ' + esc(d.name) + ' Lv.' + skillLevel(id) + '</span>';
    } else {
      h += '<span class="loadout-slot">素材 ' + (i + 1) + '</span>';
    }
  }
  slotBox.innerHTML = h;
  var info = $id('fusion-preview');
  if (UI.fuseSlots.length >= 2) {
    var sum = 0;
    UI.fuseSlots.forEach(function (id2) { sum += skillLevel(id2); });
    info.textContent = '融合後初始等級 Lv.' + sum + '（上限 Lv.' + (sum + 20) + '）｜變異機率 ' +
      fmt1(Math.min(100, FUSION_MUTATION_CHANCE + getStats().luck / 3)) + '%｜素材技能將歸零（點數轉移至融合技）';
  } else {
    info.textContent = '請從技能詳情按「⚗️ 加入融合」放入 2~4 個已學習的主動技能。';
  }
}

/* ---- 寶石分頁 ---- */
function renderGems() {
  var box = $id('gem-table');
  if (!box) return;
  var h = '<table class="gem-tbl"><tr><th>寶石</th><th>鑲嵌能力</th>';
  for (var lv = 1; lv <= GEM_FORGE_MAX_LEVEL; lv++) h += '<th>' + GEM_NAMES[lv] + '</th>';
  h += '</tr>';
  for (var t in GEM_TYPES) {
    var gt = GEM_TYPES[t];
    var v1 = gemStatValue(t, 1), vMax = gemStatValue(t, GEM_FORGE_MAX_LEVEL);
    h += '<tr><td class="gem-name">' + gt.emoji + ' ' + esc(gt.name) + '</td>' +
      '<td class="dim-text">' + esc(gt.statName.replace('%', '')) + '（L1 +' + (gt.pct ? pctStr(v1) : fmt(v1)) +
      ' ～ L' + GEM_FORGE_MAX_LEVEL + ' +' + (gt.pct ? pctStr(vMax) : fmt(vMax)) + '）</td>';
    for (var lv2 = 1; lv2 <= GEM_FORGE_MAX_LEVEL; lv2++) {
      var n = gemCount(t, lv2);
      h += '<td class="gem-cnt' + (n ? ' has' : '') + '">' + (n || '－') + '</td>';
    }
    h += '</tr>';
  }
  h += '</table>';
  box.innerHTML = h;
  var gmToggle = $id('gem-merge-toggle');
  if (gmToggle) gmToggle.checked = !!(G.factory.synth && G.factory.synth.gemMerge);
  fillGemTypeSelect($id('fuse-type'));
  fillGemTypeSelect($id('gconv-target'));
  fillGemTypeSelect($id('gdis-type'));
  renderFuseInfo();
  renderGemConvert();
  renderGemDismantle();
  renderGemFusion();
  renderGemShop();
}

function gemAbilityText(type, lv) {
  var gt = GEM_TYPES[type];
  if (!gt) return '';
  var val = gemStatValue(type, lv);
  return gt.statName.replace(/%/g, '') + ' +' + (gt.pct ? pctStr(val) : fmt(val));
}

// 寶石種類下拉選單（18 種；只填一次，保留玩家選擇）
function fillGemTypeSelect(sel) {
  if (!sel || sel.options.length) return;
  var h = '';
  for (var t in GEM_TYPES) {
    h += '<option value="' + t + '">' + GEM_TYPES[t].emoji + ' ' + esc(GEM_TYPES[t].name) + '（' + esc(GEM_TYPES[t].statName.replace('%', '')) + '）</option>';
  }
  sel.innerHTML = h;
}
/* ---- 寶石合成（2 顆同種同級 → 下一階） ---- */
function renderFuseInfo() {
  var selT = $id('fuse-type'), selL = $id('fuse-level');
  var info = $id('fuse-info');
  if (!selT || !selL || !info) return;
  var t = selT.value, lv = parseInt(selL.value, 10) || 1;
  if (!GEM_TYPES[t]) return;
  var n = gemCount(t, lv);
  info.innerHTML = '「' + GEM_TYPES[t].emoji + esc(GEM_NAMES[lv] + GEM_TYPES[t].name) + '」庫存 ' + fmt(n) +
    ' 顆｜每次消耗 2 顆＋<img src="images/icon_gold.png" class="res-icon">' + fmt(FUSE_GOLD_COST[lv]) +
    ' → 1 顆' + esc(GEM_NAMES[lv + 1] + GEM_TYPES[t].name) + '｜目前可合成 ' + Math.floor(n / 2) + ' 次';
}

/* ---- 寶石轉換（九宮格；UI.convertSlots = [{type,lv,n}]，轉換時才實際扣庫存） ---- */
function renderGemConvert() {
  var grid = $id('gconv-grid');
  if (!grid) return;
  if (!UI.convertSlots) UI.convertSlots = [];
  var h = '';
  for (var i = 0; i < GEM_CONVERT_SLOTS; i++) {
    var s = UI.convertSlots[i];
    if (s) {
      h += '<div class="gconv-slot filled" data-gconv-slot="' + i + '" title="點擊取出">' +
        '<div class="gconv-emoji">' + GEM_TYPES[s.type].emoji + '</div>' +
        '<div class="gconv-label">' + esc(GEM_NAMES[s.lv] + GEM_TYPES[s.type].name) + '</div>' +
        '<div class="gconv-n">×' + s.n + '</div></div>';
    } else {
      h += '<div class="gconv-slot"></div>';
    }
  }
  grid.innerHTML = h;
  // 轉換結果預覽
  var targetSel = $id('gconv-target');
  var target = targetSel ? targetSel.value : null;
  var info = $id('gconv-info');
  if (info) {
    if (UI.convertSlots.length && target && GEM_TYPES[target]) {
      var byLv = {};
      UI.convertSlots.forEach(function (s2) { byLv[s2.lv] = (byLv[s2.lv] || 0) + s2.n; });
      var parts = Object.keys(byLv).sort().map(function (lv2) { return esc(GEM_NAMES[lv2]) + ' ×' + byLv[lv2]; });
      info.innerHTML = '轉換結果預覽：' + GEM_TYPES[target].emoji + esc(GEM_TYPES[target].name) + '（' + parts.join('、') + '）— 同階轉換、數量不變';
    } else {
      info.textContent = '點下方庫存寶石放入九宮格，選擇目標種類後按「一鍵轉換」。';
    }
  }
  // 庫存池（顯示尚可放入的數量）
  var pool = $id('gconv-pool');
  if (!pool) return;
  var chips = [];
  for (var t in GEM_TYPES) {
    for (var lv = 1; lv <= GEM_FORGE_MAX_LEVEL; lv++) {
      var have = gemCount(t, lv);
      if (!have) continue;
      var placed = 0;
      for (var ci = 0; ci < UI.convertSlots.length; ci++) {
        if (UI.convertSlots[ci].type === t && UI.convertSlots[ci].lv === lv) placed = UI.convertSlots[ci].n;
      }
      var left = have - placed;
      var tip = esc(GEM_NAMES[lv] + GEM_TYPES[t].name + '｜' + gemAbilityText(t, lv) + '｜可放入 ' + left + ' 顆｜點擊放入九宮格');
      chips.push('<span class="gem-chip gem-inventory-cell' + (left > 0 ? '' : ' dim') + '" data-gconv-pick="' + t + ':' + lv + '" data-tip="' + tip + '">' +
        '<span class="gem-chip-count">×' + left + '</span>' +
        '<span class="gem-chip-emoji">' + GEM_TYPES[t].emoji + '</span>' +
        '<span class="gem-chip-level">' + lv + '</span></span>');
    }
  }
  pool.innerHTML = chips.length ? chips.join('') : '<span class="hint">沒有寶石庫存</span>';
}

/* ---- 寶石拆解 ---- */
function renderGemDismantle() {
  var selT = $id('gdis-type'), selL = $id('gdis-level'), info = $id('gdis-info');
  if (!selT || !selL || !info) return;
  var t = selT.value, lv = parseInt(selL.value, 10) || 2;
  if (GEM_TYPES[t]) {
    var n = gemCount(t, lv);
    info.innerHTML = '「' + GEM_TYPES[t].emoji + esc(GEM_NAMES[lv] + GEM_TYPES[t].name) + '」庫存 ' + fmt(n) +
      ' 顆｜每顆拆解 → <b>' + gemDismantleYield(lv) + '</b> 顆一級' + esc(GEM_TYPES[t].name) +
      '（合成成本 ' + gemL1Worth(lv) + ' 顆一級 × 70%）';
  }
  var fl = $id('gdis-fused');
  if (fl) {
    var chips = (G.player.fusedGems || []).map(function (fg) {
      return '<span class="gem-chip fused-chip" data-gdis-fused="' + fg.id + '" title="融合 ' + ((fg.fusions || 0)) + ' 次 → 成本 ' + fusedGemL1Worth(fg) + ' 顆一級 × 70%">' +
        esc(fusedGemLabel(fg)) + ' → ⛏️' + fusedGemDismantleYield(fg) + ' 顆</span>';
    });
    fl.innerHTML = chips.length ? chips.join('') : '<span class="hint">尚無融合寶石</span>';
  }
}
// 拆解結果訊息區（保留最近 3 筆，新訊息在最上）
function gdisShow(msg, warn) {
  var box = $id('gdis-result');
  if (!box) return;
  if (!UI.gdisMsgs) UI.gdisMsgs = [];
  UI.gdisMsgs.unshift({ t: msg, w: !!warn });
  if (UI.gdisMsgs.length > 3) UI.gdisMsgs.length = 3;
  box.innerHTML = UI.gdisMsgs.map(function (m) {
    return '<span class="gr-line' + (m.w ? ' warn' : '') + '">' + m.t + '</span>';
  }).join('');
}

/* ---- 寶石融合 v2（雙屬性，5 階以上寶石均可） ---- */
function renderGemFusion() {
  var slotBox = $id('gfuse-slots');
  if (!slotBox) return;
  if (!UI.gemFuseSlots) UI.gemFuseSlots = [null, null];
  var h = '';
  for (var i = 0; i < 2; i++) {
    var ref = UI.gemFuseSlots[i];
    if (ref) {
      var label = ref.kind === 'plain'
        ? gemLabel(ref.type, ref.lv || GEM_MAX_LEVEL)
        : (findFusedGem(ref.id) ? fusedGemLabel(findFusedGem(ref.id)) : '（已消失）');
      h += '<span class="loadout-slot filled" data-gfuse-remove="' + i + '" data-tip="點擊移出">' + esc(label) + '</span>';
    } else {
      h += '<span class="loadout-slot">素材 ' + (i + 1) + '（5 階以上寶石）</span>';
    }
  }
  slotBox.innerHTML = h;
  // 資訊列
  var info = $id('gfuse-info');
  var m1 = UI.gemFuseSlots[0] ? normalizeFuseMaterial(UI.gemFuseSlots[0]) : null;
  var m2 = UI.gemFuseSlots[1] ? normalizeFuseMaterial(UI.gemFuseSlots[1]) : null;
  if (m1 && m2) {
    var types = gemFuseTypesOk(m1, m2);
    if (types) {
      info.textContent = '成功率 ' + gemFuseRate(m1, m2) + '%｜融合後屬性：' +
        types.map(function (t) { return GEM_TYPES[t].statName.replace('%', ''); }).join('＋') +
        '｜失敗時較弱方降解為低階寶石';
    } else {
      info.textContent = '⚠️ 屬性不相容：融合後最多只能有 2 種屬性';
    }
  } else {
    info.textContent = '請放入 2 顆素材（5 階以上一般寶石或融合寶石；融合寶石無法用於神鑄）';
  }
  // 素材池（5 階以上一般寶石，高階神鑄寶石一併列出）
  var pool = $id('gfuse-pool');
  var chips = [];
  for (var flv = GEM_MAX_LEVEL; flv <= GEM_FORGE_MAX_LEVEL; flv++) {
    for (var t in GEM_TYPES) {
      var n = gemCount(t, flv);
      if (n > 0) {
        var fcol = GEM_TIER_COLORS[flv] || '#ffd700';
        chips.push('<span class="gem-chip gem-inventory-cell" data-gfuse-pick="plain:' + t + ':' + flv + '" style="border-color:' + fcol + '" ' +
          'data-tip="' + esc(gemLabel(t, flv) + '｜' + GEM_TYPES[t].statName.replace('%', '') + ' +' +
            (GEM_TYPES[t].pct ? pctStr(gemStatValue(t, flv)) : fmt(gemStatValue(t, flv))) + '｜點擊放入融合槽') + '">' +
          '<span class="gem-chip-count">×' + fmt(n) + '</span>' +
          '<span class="gem-chip-emoji">' + GEM_TYPES[t].emoji + '</span>' +
          '<span class="gem-chip-level">' + flv + '</span></span>');
      }
    }
  }
  (G.player.fusedGems || []).forEach(function (fg) {
    chips.push('<span class="gem-chip fused-chip" data-gfuse-pick="fused:' + fg.id + '" data-tip="已成功融合 ' + (fg.fusions || 0) + ' 次（下次成功率遞減）">' +
      esc(fusedGemLabel(fg)) + '</span>');
  });
  pool.innerHTML = chips.length ? chips.join('') : '<span class="hint">沒有 5 階以上寶石 — 可透過寶石升階、寶石合成、商店或神鑄取得</span>';
  // 持有融合寶石清單
  var fl = $id('fused-gem-list');
  var fchips = (G.player.fusedGems || []).map(function (fg) {
    return '<span class="gem-chip fused-chip">' + esc(fusedGemLabel(fg)) +
      ((fg.fusions || 0) > 1 ? '〔融合×' + fg.fusions + '〕' : '') + '</span>';
  });
  fl.innerHTML = fchips.length ? fchips.join('') : '<span class="hint">尚無融合寶石 — 融合成功後會出現在這裡，可至裝備分頁鑲嵌</span>';
}

/* ---- 寶石商店 ---- */
var GEM_TIER_COLORS = {
  1: '#9aa5b1', 2: '#4ade80', 3: '#38bdf8', 4: '#c084fc', 5: '#ffd700',
  // 6~10 階：神鑄寶石（僅能由神鑄法陣合成）
  6: '#fb923c', 7: '#f87171', 8: '#b8860b', 9: '#f5c542', 10: '#7df9ff'
};
function renderGemShop() {
  var grid = $id('gem-shop-grid');
  if (!grid) return;
  shopHourlyReset();
  var s = gemShop();
  if (!s.items.length) rollGemShop(); // 首次免費鋪貨
  grid.innerHTML = s.items.map(function (item, i) {
    var gt = GEM_TYPES[item.type];
    var c = GEM_TIER_COLORS[item.lv];
    return '<div class="shop-card' + (item.sold ? ' sold' : '') + '" style="border-color:' + c + '">' +
      '<div class="shop-emoji">' + gt.emoji + '</div>' +
      '<div class="shop-name" style="color:' + c + '">' + esc(GEM_NAMES[item.lv] + gt.name) + '</div>' +
      '<div class="shop-stat">' + esc(gt.statName.replace('%', '')) + ' +' +
      (gt.pct ? pctStr(gemStatValue(item.type, item.lv)) : fmt(gemStatValue(item.type, item.lv))) + '</div>' +
      (item.sold
        ? '<div class="shop-sold">已售出</div>'
        : '<button class="btn sm" data-shop-buy="' + i + '"><img src="images/icon_gold.png" class="res-icon"> ' + fmt(gemShopPrice(item.lv)) + '</button>') +
      '</div>';
  }).join('');
  var total = 0;
  s.items.forEach(function (it2) { if (!it2.sold) total += gemShopPrice(it2.lv); });
  var buyAllBtn = $id('shop-buy-all');
  if (buyAllBtn) buyAllBtn.innerHTML = '🛒 一鍵全購買（<img src="images/icon_gold.png" class="res-icon">' + fmt(total) + '）';
  var refBtn = $id('shop-refresh');
  if (refBtn) refBtn.innerHTML = '🔄 手動刷新（<img src="images/icon_gold.png" class="res-icon">' + fmt(shopRefreshCost()) + '）';
  updateShopCountdown();
}
function updateShopCountdown() {
  var el = $id('shop-reset-cd');
  if (!el) return;
  var before = gemShop().refreshCount;
  shopHourlyReset();
  if (gemShop().refreshCount !== before) UI.dirty.gems = true; // 重置時刷新按鈕費用
  var sec = shopResetCountdown();
  var mm = Math.floor(sec / 60), ss = sec % 60;
  el.textContent = '本小時已刷新 ' + gemShop().refreshCount + ' 次｜次數重置倒數 ' + mm + ':' + (ss < 10 ? '0' : '') + ss;
}

/* ============ 迷你監控視窗（子母畫面 PiP） ============
   Chrome 會暫停被遮蔽視窗的繪製（工作列縮圖因此凍結），
   改用永遠置頂的 PiP 迷你視窗即時顯示戰況。               */
var MINI = { win: null, canvas: null, video: null, timer: null };

var MINI_CSS = 'body{margin:0;background:#0d1017;color:#d7deed;font-family:"Microsoft JhengHei",sans-serif;font-size:11px;padding:6px 8px;overflow:hidden}' +
  '.m-head{display:flex;justify-content:space-between;color:#f5b942;font-weight:bold;font-size:11.5px;margin-bottom:3px}' +
  '.m-name{font-size:11px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
  '.m-bar{position:relative;height:13px;background:#0a0d14;border:1px solid #2c3654;border-radius:7px;overflow:hidden;margin-top:2px}' +
  '.m-fill{height:100%;transition:width .3s}' +
  '.m-fill.hp{background:linear-gradient(90deg,#16a34a,#4ade80)}' +
  '.m-fill.mp{background:linear-gradient(90deg,#1d4ed8,#38bdf8)}' +
  '.m-fill.enemy{background:linear-gradient(90deg,#b91c1c,#f87171)}' +
  '.m-bar span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;text-shadow:0 1px 2px #000}' +
  '.m-vs{text-align:center;color:#7d89a6;font-size:9.5px;margin-top:3px}' +
  '.m-info{color:#38bdf8;font-size:10.5px;margin-top:3px;white-space:nowrap;overflow:hidden}' +
  '.m-log{color:#7d89a6;font-size:10px;margin-top:2px;line-height:1.45;max-height:30px;overflow:hidden}';

var MINI_HTML = '<div class="m-head"><span id="m-stage"></span><span id="m-lv"></span></div>' +
  '<div class="m-name" id="m-pname">🧝 冒險者</div>' +
  '<div class="m-bar"><div class="m-fill hp" id="m-php"></div><span id="m-ptext"></span></div>' +
  '<div class="m-bar"><div class="m-fill mp" id="m-pmp"></div><span id="m-mtext"></span></div>' +
  '<div class="m-vs" id="m-vs">⚔️ VS ⚔️</div>' +
  '<div class="m-name" id="m-ename"></div>' +
  '<div class="m-bar"><div class="m-fill enemy" id="m-ehp"></div><span id="m-etext"></span></div>' +
  '<div class="m-info" id="m-info"></div>' +
  '<div class="m-log" id="m-log"></div>';

// 蒐集目前戰況（野外 / 高塔通用）
function miniSnapshot() {
  var st = getStats();
  var s = { stage: '', lv: 'Lv.' + G.player.level, pHp: 0, pHpText: '', pMp: 0, pMpText: '', eName: '', eHp: 0, eHpText: '', info: '', logs: [] };
  var p, enemy;
  if (G.tower.active && TOWER.boss) {
    p = TOWER.player; enemy = TOWER.boss;
    s.stage = '🗼 高塔第 ' + TOWER.floor + ' 層';
    s.info = '⏱️ 剩餘 ' + fmt1(Math.max(0, TOWER_TIME_LIMIT - TOWER.elapsed)) + 's' + (TOWER.enraged ? '　🔥狂暴中' : '');
  } else {
    p = FIELD.player; enemy = FIELD.monster;
    s.stage = currentZoneDef().emoji + currentZoneDef().name + ' 第 ' + G.stage.current + ' 階段';
    s.info = '📈 DPS ' + fmt(currentDps()) + '　<img src="images/icon_gold.png" class="res-icon">' + fmt(G.player.gold);
  }
  if (p) {
    s.pHp = clamp(p.hp / st.hp * 100, 0, 100);
    s.pHpText = fmt(Math.max(0, p.hp)) + ' / ' + fmt(st.hp);
    s.pMp = clamp(p.mp / st.mp * 100, 0, 100);
    s.pMpText = fmt(Math.floor(p.mp)) + ' / ' + fmt(st.mp);
  }
  if (enemy) {
    s.eName = (enemy.emoji || '👾') + ' ' + (enemy.name || '') + ' Lv.' + enemy.level;
    s.eHp = clamp(enemy.hp / enemy.maxHp * 100, 0, 100);
    s.eHpText = fmt(Math.max(0, enemy.hp)) + ' / ' + fmt(enemy.maxHp);
  } else {
    s.eName = '⏳ 搜索敵人中…';
  }
  var activeLogId = 'battle-log';
  var bossLog = $id('boss-log');
  if (bossLog && bossLog.style.display === 'block') activeLogId = 'boss-log';
  var lines = document.querySelectorAll('#' + activeLogId + ' .log-line');
  for (var i = 0; i < Math.min(2, lines.length); i++) s.logs.push(lines[i].textContent);
  return s;
}

function renderMiniWindow() {
  if (!MINI.win) return;
  try {
    var d = MINI.win.document;
    var s = miniSnapshot();
    d.getElementById('m-stage').textContent = s.stage;
    d.getElementById('m-lv').textContent = s.lv;
    d.getElementById('m-php').style.width = s.pHp + '%';
    d.getElementById('m-ptext').textContent = s.pHpText;
    d.getElementById('m-pmp').style.width = s.pMp + '%';
    d.getElementById('m-mtext').textContent = s.pMpText;
    d.getElementById('m-ename').textContent = s.eName;
    d.getElementById('m-ehp').style.width = s.eHp + '%';
    d.getElementById('m-etext').textContent = s.eHpText;
    d.getElementById('m-info').textContent = s.info;
    d.getElementById('m-log').innerHTML = s.logs.map(function (l) { return esc(l); }).join('<br>');
  } catch (e) { MINI.win = null; }
}

function openMiniWindow() {
  if (MINI.win) { blog('📺 迷你視窗已經開啟中', 'info'); return; }
  // 主方案：Document Picture-in-Picture（Chrome 116+）
  if (window.documentPictureInPicture && documentPictureInPicture.requestWindow) {
    // 防呆：若 3 秒內沒有任何結果（極少數環境會懸置），改走影片 PiP
    var settled = false;
    setTimeout(function () { if (!settled && !MINI.win) openVideoPip(); }, 3000);
    documentPictureInPicture.requestWindow({ width: 238, height: 210 }).then(function (pip) {
      settled = true;
      MINI.win = pip;
      var d = pip.document;
      var style = d.createElement('style');
      style.textContent = MINI_CSS;
      d.head.appendChild(style);
      d.title = '無限征途：戰況監控';
      d.body.innerHTML = MINI_HTML;
      pip.addEventListener('pagehide', function () { MINI.win = null; });
      // 在 PiP 視窗內建立計時器：不受主視窗背景節流影響，更新流暢
      pip.setInterval(renderMiniWindow, 300);
      renderMiniWindow();
      blog('📺 迷你監控視窗已開啟（永遠置頂，可拖曳/縮放）', 'good');
    }).catch(function () { settled = true; openVideoPip(); });
  } else {
    openVideoPip();
  }
}

/* ---- 分頁標題即時戰況（工作列懸停提示也會顯示） ---- */
var _titleTimer = 0;
function updateLiveTitle() {
  var st = getStats();
  var t;
  if (G.tower.active && TOWER.boss) {
    t = '🗼' + TOWER.floor + '層 ' + Math.round(TOWER.boss.hp / TOWER.boss.maxHp * 100) + '%｜' +
      Math.ceil(Math.max(0, TOWER_TIME_LIMIT - TOWER.elapsed)) + 's';
  } else {
    var p = FIELD.player;
    var hpPct = p ? Math.round(p.hp / st.hp * 100) : 100;
    t = currentZoneDef().emoji + '第' + G.stage.current + '階段 Lv.' + G.player.level + ' ❤️' + hpPct + '%';
  }
  document.title = t + '｜無限征途';
}

// 後備方案：Canvas → 影片子母畫面（相容較舊瀏覽器）
function drawMiniCanvas() {
  var c = MINI.canvas, ctx = c.getContext('2d');
  var s = miniSnapshot();
  ctx.fillStyle = '#0d1017'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#f5b942'; ctx.font = 'bold 12px "Microsoft JhengHei"';
  ctx.fillText(s.stage, 8, 18);
  ctx.fillText(s.lv, c.width - 44, 18);
  function bar(y, pct, color, text) {
    ctx.fillStyle = '#0a0d14'; ctx.fillRect(8, y, c.width - 16, 14);
    ctx.fillStyle = color; ctx.fillRect(8, y, (c.width - 16) * pct / 100, 14);
    ctx.fillStyle = '#fff'; ctx.font = '9px "Microsoft JhengHei"';
    ctx.textAlign = 'center'; ctx.fillText(text, c.width / 2, y + 10); ctx.textAlign = 'left';
  }
  ctx.fillStyle = '#d7deed'; ctx.font = '11px "Microsoft JhengHei"';
  ctx.fillText('🧝 冒險者', 8, 36);
  bar(41, s.pHp, '#4ade80', s.pHpText);
  bar(58, s.pMp, '#38bdf8', s.pMpText);
  ctx.fillStyle = '#d7deed'; ctx.fillText(s.eName.slice(0, 18), 8, 92);
  bar(97, s.eHp, '#f87171', s.eHpText);
  ctx.fillStyle = '#38bdf8'; ctx.font = '10px "Microsoft JhengHei"';
  ctx.fillText(s.info, 8, 130);
  ctx.fillStyle = '#7d89a6'; ctx.font = '9.5px "Microsoft JhengHei"';
  for (var i = 0; i < s.logs.length; i++) ctx.fillText(s.logs[i].slice(0, 26), 8, 146 + i * 13);
}
function openVideoPip() {
  try {
    if (!MINI.canvas) {
      MINI.canvas = document.createElement('canvas');
      MINI.canvas.width = 238; MINI.canvas.height = 175;
      MINI.video = document.createElement('video');
      MINI.video.muted = true;
      MINI.video.playsInline = true;
      MINI.video.srcObject = MINI.canvas.captureStream(4);
      MINI.video.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;';
      document.body.appendChild(MINI.video);
      MINI.video.addEventListener('leavepictureinpicture', function () {
        if (MINI.timer) { clearInterval(MINI.timer); MINI.timer = null; }
      });
    }
    drawMiniCanvas();
    MINI.video.play().then(function () {
      return MINI.video.requestPictureInPicture();
    }).then(function () {
      if (MINI.timer) clearInterval(MINI.timer);
      MINI.timer = setInterval(drawMiniCanvas, 500);
      blog('📺 迷你監控視窗已開啟（影片模式）', 'good');
    }).catch(function (e) {
      blog('⚠️ 無法開啟迷你視窗：' + (e && e.message ? e.message : '瀏覽器不支援'), 'warn');
    });
  } catch (e2) {
    blog('⚠️ 此瀏覽器不支援子母畫面功能', 'warn');
  }
}

/* ---- 事件綁定 ---- */
function showConfirmDialog(message, onConfirm, options) {
  var modal = $id('confirm-modal');
  var msg = $id('confirm-message');
  var ok = $id('confirm-ok');
  var cancel = $id('confirm-cancel');
  var title = $id('confirm-title');
  options = options || {};

  if (!modal || !msg || !ok || !cancel) {
    blog('⚠️ 確認彈窗初始化失敗，操作已取消。', 'warn');
    return;
  }

  if (title) title.textContent = options.title || '操作確認';
  msg.textContent = message || '';
  ok.textContent = options.okText || '確定';
  cancel.textContent = options.cancelText || '取消';
  ok.className = 'btn' + (options.danger ? ' danger' : '');
  cancel.className = 'btn';
  modal.style.display = 'flex';

  function close() {
    modal.style.display = 'none';
    ok.onclick = null;
    cancel.onclick = null;
    modal.onclick = null;
  }

  ok.onclick = function () {
    close();
    if (typeof onConfirm === 'function') onConfirm();
  };
  cancel.onclick = close;
  modal.onclick = function (e) {
    if (e.target === modal) close();
  };
}

function initUI() {
  // 分頁
  document.querySelectorAll('.tab-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      switchTab(b.getAttribute('data-tab'));
      UI.dirty.equip = true; UI.dirty.inv = true; UI.dirty.factory = true; UI.dirty.forge = true; UI.dirty.tower = true; UI.dirty.gems = true; UI.dirty.skills = true;
    });
  });

  // 技能：學習/升級/裝載/融合（事件委派）
  document.addEventListener('click', function (e) {
    var ln = e.target.closest('[data-skill-learn]');
    if (ln) {
      var lerr = learnOrUpgradeSkill(ln.getAttribute('data-skill-learn'));
      if (lerr) blog('⚠️ ' + lerr, 'warn');
      renderSkills();
      return;
    }
    var eq = e.target.closest('[data-skill-equip]');
    if (eq) {
      var eerr = equipSkillToLoadout(eq.getAttribute('data-skill-equip'));
      if (eerr) blog('⚠️ ' + eerr, 'warn');
      renderSkills();
      return;
    }
    var uq = e.target.closest('[data-skill-unequip]');
    if (uq) {
      unequipSkillFromLoadout(uq.getAttribute('data-skill-unequip'));
      renderSkills();
      return;
    }
    // 點擊技能樹節點 → 開啟升級彈窗
    var cell = e.target.closest('[data-sk]');
    if (cell) {
      openSkillModal(cell.getAttribute('data-sk'));
      return;
    }
    // 敵人情報 Tooltip（手機點擊支援）
    var etip = e.target.closest('#btn-enemy-tip');
    if (etip) {
      var tip = $id('sk-tooltip');
      if (tip && tip.style.display === 'block') hideTooltip();
      else showEnemyTooltip(etip);
      return;
    }
    // 降級
    var dg = e.target.closest('[data-skill-downgrade]');
    if (dg) {
      var dgerr = downgradeSkill(dg.getAttribute('data-skill-downgrade'));
      if (dgerr) blog('⚠️ ' + dgerr, 'warn');
      renderSkills();
      return;
    }
    // 融合素材：加入 / 移出
    var fa = e.target.closest('[data-skill-fuse-add]');
    if (fa) {
      var fid = fa.getAttribute('data-skill-fuse-add');
      if (UI.fuseSlots.indexOf(fid) >= 0) blog('⚠️ 此技能已在融合槽中', 'warn');
      else if (UI.fuseSlots.length >= 4) blog('⚠️ 融合槽已滿（最多 4 個）', 'warn');
      else UI.fuseSlots.push(fid);
      renderSkills();
      return;
    }
    var fr = e.target.closest('[data-fuse-remove]');
    if (fr) {
      var rid = fr.getAttribute('data-fuse-remove');
      var ri2 = UI.fuseSlots.indexOf(rid);
      if (ri2 >= 0) UI.fuseSlots.splice(ri2, 1);
      renderSkills();
      return;
    }
    // 刪除融合技
    var fd = e.target.closest('[data-fusion-delete]');
    if (fd) {
      showConfirmDialog('確定刪除此融合技？所有投入的技能點將全數歸還。', function () {
        var derr = deleteFusion(fd.getAttribute('data-fusion-delete'));
        if (derr) blog('⚠️ ' + derr, 'warn');
        UI.selSkill = null;
        renderSkills();
      }, { title: '融合技刪除確認', danger: true });
      return;
    }
  });

  // 屏蔽瀏覽器右鍵選單（輸入框除外，保留貼上存檔碼的能力）
  document.addEventListener('contextmenu', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
  });

  // 技能彈窗：右上 X / 點擊遮罩關閉
  var skModal = $id('skill-modal');
  if (skModal) {
    skModal.addEventListener('click', function (e) {
      if (e.target === skModal) closeSkillModal();
    });
    $id('skill-modal-close').addEventListener('click', closeSkillModal);
  }

  // 技能拖曳排序
  var loBox = $id('skill-loadout');
  if (loBox) {
    loBox.addEventListener('dragstart', function (e) {
      var slot = e.target.closest('.loadout-slot.filled');
      if (!slot) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', slot.getAttribute('data-index'));
      e.dataTransfer.effectAllowed = 'move';
      slot.classList.add('dragging');
    });
    loBox.addEventListener('dragover', function (e) {
      e.preventDefault();
      var target = e.target.closest('.loadout-slot');
      if (target) target.classList.add('drag-over');
    });
    loBox.addEventListener('dragleave', function (e) {
      var target = e.target.closest('.loadout-slot');
      if (target) target.classList.remove('drag-over');
    });
    loBox.addEventListener('drop', function (e) {
      e.preventDefault();
      var target = e.target.closest('.loadout-slot');
      if (target) {
        target.classList.remove('drag-over');
        var fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        var toIndex = parseInt(target.getAttribute('data-index'), 10);
        if (!isNaN(fromIndex) && !isNaN(toIndex) && fromIndex !== toIndex) {
          var lo = G.player.loadout || [];
          if (fromIndex >= 0 && fromIndex < lo.length) {
            if (toIndex >= lo.length) {
              var id = lo.splice(fromIndex, 1)[0];
              lo.push(id);
            } else {
              var item = lo.splice(fromIndex, 1)[0];
              lo.splice(toIndex, 0, item);
            }
            G.player.loadout = lo;
            renderSkills();
          }
        }
      }
    });
    loBox.addEventListener('dragend', function (e) {
      var slot = e.target.closest('.loadout-slot.filled');
      if (slot) slot.classList.remove('dragging');
      loBox.querySelectorAll('.drag-over').forEach(function (el) { el.classList.remove('drag-over'); });
    });
  }

  // 懸停提示（事件委派）
  document.addEventListener('mouseover', function (e) {
    var tipBtn = e.target.closest('[data-tip]');
    if (tipBtn) { showStatTooltip('', tipBtn.getAttribute('data-tip'), tipBtn); return; }

    var eqCell = e.target.closest('.item-cell[data-id]') || e.target.closest('.eq-slot.filled[data-id]');
    if (eqCell) {
      var it = findItemById(eqCell.getAttribute('data-id'));
      if (it) { showItemTooltip(it, eqCell); return; }
    }

    if (e.target.closest('button') || e.target.closest('.btn')) {
      hideTooltip();
      return;
    }
    var cell = e.target.closest('[data-sk]');
    if (cell) { showSkillTooltip(cell.getAttribute('data-sk'), cell); return; }
    var statRow = e.target.closest('.stat-row[data-tt-title]');
    if (statRow) { showStatTooltip(statRow.getAttribute('data-tt-title'), statRow.getAttribute('data-tt-desc'), statRow); return; }
    var tf = e.target.closest('[data-tower-tip]');
    if (tf) { showTowerTooltip(tf.getAttribute('data-tower-tip'), tf); return; }
    var etip = e.target.closest('#btn-enemy-tip');
    if (etip) { showEnemyTooltip(etip); return; }
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target.closest('[data-sk]') || e.target.closest('.stat-row[data-tt-title]') ||
      e.target.closest('[data-tower-tip]') || e.target.closest('#btn-enemy-tip') ||
      e.target.closest('[data-tip]') || e.target.closest('.item-cell[data-id]') ||
      e.target.closest('.eq-slot.filled[data-id]')) {
      hideTooltip();
    }
  });

  // 執行融合 / 清空
  var fuseBtn2 = $id('btn-fuse');
  if (fuseBtn2) {
    fuseBtn2.addEventListener('click', function () {
      var ferr = fuseSkills(UI.fuseSlots.slice());
      if (ferr) blog('⚠️ 融合失敗：' + ferr, 'warn');
      else UI.fuseSlots = [];
      renderSkills();
    });
    $id('btn-fuse-clear').addEventListener('click', function () {
      UI.fuseSlots = [];
      renderFusionPanel();
    });
  }

  // 寶石合成（2 顆同種同級 → 同種下一階）
  var fuseBtn = $id('fuse-btn');
  if (fuseBtn) {
    fuseBtn.addEventListener('click', function () {
      var t = $id('fuse-type').value;
      var lv = parseInt($id('fuse-level').value, 10) || 1;
      var err = composeGems(t, lv);
      if (err) blog('⚠️ 合成失敗：' + err, 'warn');
      else blog('🔀 寶石合成：' + gemLabel(t, lv) + ' ×2 → ' + gemLabel(t, lv + 1), 'info');
      renderGems();
    });
    $id('fuse-all-btn').addEventListener('click', function () {
      var t = $id('fuse-type').value;
      var lv = parseInt($id('fuse-level').value, 10) || 1;
      var made = 0, err = null;
      while (made < 500 && !(err = composeGems(t, lv))) made++;
      if (made > 0) blog('♻️ 全部合成：' + gemLabel(t, lv) + ' ×' + (made * 2) + ' → ' + gemLabel(t, lv + 1) + ' ×' + made, 'good');
      else blog('⚠️ 合成失敗：' + err, 'warn');
      renderGems();
    });
    $id('fuse-level').addEventListener('change', renderFuseInfo);
    $id('fuse-type').addEventListener('change', renderFuseInfo);
  }

  // 寶石轉換（九宮格）
  var gconvPool = $id('gconv-pool');
  if (gconvPool) {
    gconvPool.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-gconv-pick]');
      if (!chip) return;
      var pk = chip.getAttribute('data-gconv-pick').split(':');
      var t = pk[0], lv = parseInt(pk[1], 10);
      if (!UI.convertSlots) UI.convertSlots = [];
      var slot = null;
      UI.convertSlots.forEach(function (s) { if (s.type === t && s.lv === lv) slot = s; });
      var placed = slot ? slot.n : 0;
      var can = Math.min(GEM_CONVERT_STACK - placed, gemCount(t, lv) - placed);
      if (can <= 0) { blog('⚠️ 該格已達上限（' + GEM_CONVERT_STACK + ' 顆）或庫存已放完', 'warn'); return; }
      if (slot) slot.n += can;
      else {
        if (UI.convertSlots.length >= GEM_CONVERT_SLOTS) { blog('⚠️ 九宮格已滿（最多 ' + GEM_CONVERT_SLOTS + ' 種）', 'warn'); return; }
        UI.convertSlots.push({ type: t, lv: lv, n: can });
      }
      renderGemConvert();
    });
    $id('gconv-grid').addEventListener('click', function (e) {
      var el = e.target.closest('[data-gconv-slot]');
      if (!el) return;
      UI.convertSlots.splice(parseInt(el.getAttribute('data-gconv-slot'), 10), 1);
      renderGemConvert();
    });
    $id('gconv-btn').addEventListener('click', function () {
      var target = $id('gconv-target').value;
      var slots = (UI.convertSlots || []).slice();
      var resBox = $id('gconv-result');
      var err = convertGems(slots, target);
      if (err) {
        if (resBox) resBox.innerHTML = '<span class="gr-line warn">⚠️ ' + err + '</span>';
        blog('⚠️ 轉換失敗：' + err, 'warn');
        return;
      }
      // 各階明細（方便對帳）
      var byLv = {};
      slots.forEach(function (s) { byLv[s.lv] = (byLv[s.lv] || 0) + s.n; });
      var lvKeys = Object.keys(byLv).sort();
      var detail = lvKeys.map(function (lv) { return GEM_NAMES[lv] + esc(GEM_TYPES[target].name) + '×' + byLv[lv]; }).join('、');
      if (resBox) {
        resBox.innerHTML = '<span class="gr-line">✅ 轉換完成，獲得：</span>' +
          lvKeys.map(function (lv) {
            return '<span class="gr-line">' + GEM_TYPES[target].emoji + ' ' + esc(GEM_NAMES[lv] + GEM_TYPES[target].name) + ' ×' + byLv[lv] + '</span>';
          }).join('') +
          (G.factory.synth && G.factory.synth.gemMerge
            ? '<span class="gr-line" style="color:var(--dim)">⚙️ 寶石升階自動化開啟中，湊滿 3 顆會被自動升階</span>' : '');
      }
      blog('🔄 寶石轉換完成：獲得 ' + GEM_TYPES[target].emoji + detail + '（同階轉換）', 'good');
      UI.convertSlots = [];
      renderGems();
    });
    $id('gconv-clear').addEventListener('click', function () { UI.convertSlots = []; renderGemConvert(); });
    $id('gconv-target').addEventListener('change', renderGemConvert);
  }

  // 寶石拆解
  var gdisBtn = $id('gdis-btn');
  if (gdisBtn) {
    gdisBtn.addEventListener('click', function () {
      var t = $id('gdis-type').value;
      var lv = parseInt($id('gdis-level').value, 10) || 2;
      var r = dismantleGem(t, lv);
      if (r.err) {
        gdisShow('⚠️ ' + r.err, true);
        blog('⚠️ 拆解失敗：' + r.err, 'warn');
      } else {
        gdisShow('⛏️ 拆解 ' + gemLabel(t, lv) + ' → 獲得 ' + gemLabel(t, 1) + ' ×' + r.n);
        blog('⛏️ 拆解 ' + gemLabel(t, lv) + ' → ' + gemLabel(t, 1) + ' ×' + r.n, 'info');
      }
      renderGems();
    });
    $id('gdis-all-btn').addEventListener('click', function () {
      var t = $id('gdis-type').value;
      var lv = parseInt($id('gdis-level').value, 10) || 2;
      var cnt = 0, gain = 0, r = null;
      while (cnt < 999) {
        r = dismantleGem(t, lv);
        if (r.err) break;
        cnt++; gain += r.n;
      }
      if (cnt > 0) {
        gdisShow('⛏️ 全部拆解 ' + gemLabel(t, lv) + ' ×' + cnt + ' → 獲得 ' + gemLabel(t, 1) + ' ×' + gain);
        blog('⛏️ 全部拆解：' + gemLabel(t, lv) + ' ×' + cnt + ' → ' + gemLabel(t, 1) + ' ×' + gain, 'good');
      } else {
        gdisShow('⚠️ ' + r.err, true);
        blog('⚠️ 拆解失敗：' + r.err, 'warn');
      }
      renderGems();
    });
    $id('gdis-type').addEventListener('change', renderGemDismantle);
    $id('gdis-level').addEventListener('change', renderGemDismantle);
    $id('gdis-fused').addEventListener('click', function (e) {
      var el = e.target.closest('[data-gdis-fused]');
      if (!el) return;
      var fid = el.getAttribute('data-gdis-fused');
      var fg = findFusedGem(fid);
      if (!fg) return;
      showConfirmDialog('確定拆解「' + fusedGemLabel(fg) + '」？\n將獲得 ' + fusedGemDismantleYield(fg) + ' 顆 1 階寶石（依屬性均分），此操作無法復原。', function () {
        var r = dismantleFusedGem(fid);
        if (r.err) { gdisShow('⚠️ ' + r.err, true); blog('⚠️ 拆解失敗：' + r.err, 'warn'); return; }
        var gotStr = r.got.map(function (g) { return gemLabel(g.type, 1) + ' ×' + g.n; }).join('、');
        gdisShow('⛏️ 融合寶石拆解 → 獲得 ' + gotStr);
        blog('⛏️ 融合寶石拆解 → ' + gotStr, 'good');
        renderGems();
      }, { title: '寶石拆解確認', danger: true });
    });
  }

  // 寶石融合 v2（雙屬性）
  var gfuseBtn = $id('gfuse-btn');
  if (gfuseBtn) {
    gfuseBtn.addEventListener('click', function () {
      if (!UI.gemFuseSlots || !UI.gemFuseSlots[0] || !UI.gemFuseSlots[1]) {
        blog('⚠️ 請先放入 2 顆 5 階寶石素材', 'warn');
        return;
      }
      var res = fuseGemsV2(UI.gemFuseSlots[0], UI.gemFuseSlots[1]);
      if (res.err) {
        blog('⚠️ 無法融合：' + res.err, 'warn');
      } else if (res.success) {
        blog('🧬 <span class="log-hl-good">寶石融合成功！</span>獲得 ' + fusedGemLabel(res.result) + '（成功率 ' + res.rate + '%）', 'good');
        UI.gemFuseSlots = [null, null];
      } else {
        blog('💥 寶石融合失敗（成功率 ' + res.rate + '%）…較弱的寶石降解為 ' + res.degraded.n + ' 顆 ' +
          gemLabel(res.degraded.type, res.degraded.lv), 'warn');
        UI.gemFuseSlots = [null, null];
      }
      renderGems();
    });
    $id('gfuse-clear').addEventListener('click', function () {
      UI.gemFuseSlots = [null, null];
      renderGemFusion();
    });
  }

  // 寶石商店
  var shopBuyAll = $id('shop-buy-all');
  if (shopBuyAll) {
    shopBuyAll.addEventListener('click', function () {
      var r = buyAllShopGems();
      if (r.bought > 0) blog('🛒 一鍵購買 ' + r.bought + ' 顆寶石，花費 <img src="images/icon_gold.png" class="res-icon">' + fmt(r.spent), 'good');
      else blog('⚠️ 沒有可購買的寶石（金幣不足或已售罄）', 'warn');
      renderGems();
    });
    $id('shop-refresh').addEventListener('click', function () {
      var err = refreshGemShop();
      if (err) blog('⚠️ 刷新失敗：' + err, 'warn');
      else blog('🔄 寶石商店已刷新（本小時第 ' + gemShop().refreshCount + ' 次）', 'info');
      renderGems();
    });
  }

  // 日誌篩選
  var logFilter = $id('log-filter');
  if (logFilter) {
    logFilter.addEventListener('change', function (e) {
      var v = e.target.value;
      var b = $id('battle-log');
      var bossLog = $id('boss-log');
      if (v === 'boss') {
        if (b) b.style.display = 'none';
        if (bossLog) {
          bossLog.style.display = 'block';
          bossLog.className = 'log';
        }
      } else {
        if (bossLog) bossLog.style.display = 'none';
        if (b) {
          b.style.display = 'block';
          b.className = 'log' + (v === 'all' ? '' : ' filter-' + v);
        }
      }
    });
  }

  // 迷你監控視窗
  var pipBtn = $id('btn-pip');
  if (pipBtn) pipBtn.addEventListener('click', openMiniWindow);

  // 戰鬥場景切換
  document.querySelectorAll('.zone-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      switchZone(b.getAttribute('data-zone'));
      renderZoneBar();
    });
  });

  // 階段控制
  $id('st-prev').addEventListener('click', function () { stageGo(-1); });
  $id('st-next').addEventListener('click', function () { stageGo(1); });
  $id('st-auto').addEventListener('change', function () { G.stage.autoAdvance = this.checked; });

  // 裝備 / 背包點擊（事件委派）
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.it-pool-box')) {
      var pools = document.querySelectorAll('.it-pool-box');
      for (var i = 0; i < pools.length; i++) pools[i].style.display = 'none';
    }
    // 神鑄：法陣槽位（點擊取回）/ 魔塵符位（點擊放入或取下）
    var fslot = e.target.closest('[data-forge-slot]');
    if (fslot) {
      if (fslot.classList.contains('filled')) {
        forgeRemoveItem(parseInt(fslot.getAttribute('data-forge-slot'), 10));
      }
      return;
    }
    var fdust = e.target.closest('[data-forge-dust]');
    if (fdust) {
      var derr = forgeToggleDust(parseInt(fdust.getAttribute('data-forge-dust'), 10));
      if (derr) blog('⚠️ 神鑄：' + derr, 'warn');
      return;
    }
    // 神鑄寶石頁：點擊寶石放入法陣
    var fgem = e.target.closest('[data-forge-gem]');
    if (fgem) {
      var gp = fgem.getAttribute('data-forge-gem').split(':');
      var gperr = forgePlaceGem(gp[0], parseInt(gp[1], 10));
      if (gperr) blog('⚠️ 神鑄：' + gperr, 'warn');
      return;
    }
    var cell = e.target.closest('.item-cell, .eq-slot');
    if (cell) {
      // 神鑄背包：點擊裝備直接放入法陣（成功後清除殘留選取，防止跨分頁誤操作）
      if (cell.getAttribute('data-src') === 'forgeinv') {
        var fid = cell.getAttribute('data-id');
        var perr = forgePlaceItem(fid);
        if (perr) blog('⚠️ 神鑄：' + perr, 'warn');
        else if (UI.sel && UI.sel.id === fid) UI.sel = null;
        return;
      }
      if (cell.classList.contains('empty')) {
        UI.sel = null;
        UI.lastEquipSlot = cell.getAttribute('data-slot');
      } else {
        var cid = cell.getAttribute('data-id');
        if (UI.sel && UI.sel.id === cid) {
          UI.sel = null;
        } else {
          UI.sel = { id: cid, source: cell.getAttribute('data-src') };
          if (UI.sel.source === 'equip') {
            UI.lastEquipSlot = cell.getAttribute('data-slot');
          }
        }
      }
      renderDetail();
      return;
    }
    var actBtn = e.target.closest('#detail-pane .btn, #equip-action-bar .btn');
    if (actBtn) { detailAction(actBtn.getAttribute('data-act'), actBtn); return; }
    // 寶石鑲嵌 / 取下
    var gs = e.target.closest('[data-gem-socket]');
    if (gs) {
      var sit = findSelItem();
      if (sit) {
        var serr = socketGem(sit, gs.getAttribute('data-gem-socket'));
        if (serr) blog('⚠️ 鑲嵌失敗：' + serr, 'warn');
        else blog('💎 鑲嵌成功！', 'good');
        UI.dirty.header = true; UI.dirty.gems = true; UI.dirty.equip = true; UI.dirty.inv = true;
        renderDetail();
      }
      return;
    }
    var sr = e.target.closest('[data-socket-remove]');
    if (sr) {
      var uit = findSelItem();
      if (uit && unsocketGem(uit, parseInt(sr.getAttribute('data-socket-remove'), 10))) {
        blog('💎 已取下寶石', 'info');
        UI.dirty.header = true; UI.dirty.gems = true;
        renderDetail();
      }
      return;
    }
    // 寶石融合 v2：素材放入 / 移出
    var gfp = e.target.closest('[data-gfuse-pick]');
    if (gfp) {
      if (!UI.gemFuseSlots) UI.gemFuseSlots = [null, null];
      var pv = gfp.getAttribute('data-gfuse-pick').split(':');
      var pref = pv[0] === 'plain'
        ? { kind: 'plain', type: pv[1], lv: parseInt(pv[2], 10) || GEM_MAX_LEVEL }
        : { kind: 'fused', id: pv[1] };
      // 融合寶石不可重複放入；一般寶石同種同階需有足夠數量
      var dupFused = pref.kind === 'fused' && UI.gemFuseSlots.some(function (r) { return r && r.kind === 'fused' && r.id === pref.id; });
      if (dupFused) { blog('⚠️ 這顆融合寶石已在融合槽中', 'warn'); return; }
      var slotIdx = UI.gemFuseSlots[0] ? (UI.gemFuseSlots[1] ? -1 : 1) : 0;
      if (slotIdx < 0) { blog('⚠️ 融合槽已滿（點擊素材可移出）', 'warn'); return; }
      if (pref.kind === 'plain') {
        var sameCnt = UI.gemFuseSlots.filter(function (r) { return r && r.kind === 'plain' && r.type === pref.type && (r.lv || GEM_MAX_LEVEL) === pref.lv; }).length;
        if (gemCount(pref.type, pref.lv) < sameCnt + 1) { blog('⚠️ 此種同階寶石數量不足', 'warn'); return; }
      }
      UI.gemFuseSlots[slotIdx] = pref;
      renderGemFusion();
      return;
    }
    var gfr = e.target.closest('[data-gfuse-remove]');
    if (gfr) {
      UI.gemFuseSlots[parseInt(gfr.getAttribute('data-gfuse-remove'), 10)] = null;
      renderGemFusion();
      return;
    }
    // 寶石商店：單顆購買
    var sb = e.target.closest('[data-shop-buy]');
    if (sb) {
      var sbErr = buyShopGem(parseInt(sb.getAttribute('data-shop-buy'), 10));
      if (sbErr) blog('⚠️ 購買失敗：' + sbErr, 'warn');
      renderGems();
      return;
    }
    // 融合寶石鑲嵌
    var gsf = e.target.closest('[data-gem-socket-fused]');
    if (gsf) {
      var fsit = findSelItem();
      if (fsit) {
        var fserr = socketFusedGem(fsit, gsf.getAttribute('data-gem-socket-fused'));
        if (fserr) blog('⚠️ 鑲嵌失敗：' + fserr, 'warn');
        else blog('🧬 融合寶石鑲嵌成功！', 'good');
        UI.dirty.header = true; UI.dirty.gems = true; UI.dirty.equip = true; UI.dirty.inv = true;
        renderDetail();
      }
      return;
    }
    // 手動附魔 / 取下附魔
    var be = e.target.closest('[data-book-enchant]');
    if (be) {
      var eit = findSelItem();
      if (eit) {
        var bkey = be.getAttribute('data-book-enchant');
        var eerr2 = manualEnchant(eit, bkey);
        if (eerr2) blog('⚠️ 附魔失敗：' + eerr2, 'warn');
        else blog('✨ 附魔成功：' + rarityTag(eit) + ' 獲得 ' + ENCHANTS[bkey].name + '（' + itemEnchants(eit).length + '/' + enchantCapFor(eit) + ' 欄）', 'good');
        UI.dirty.header = true;
        renderDetail();
      }
      return;
    }
    var er = e.target.closest('[data-enchant-remove]');
    if (er) {
      var rit = findSelItem();
      if (rit) {
        var rIdx = parseInt(er.getAttribute('data-enchant-remove'), 10);
        var rEn = itemEnchants(rit)[rIdx];
        if (rEn && removeEnchantAt(rit, rIdx)) {
          blog('↩️ 已取下附魔「' + ENCHANTS[rEn.key].name + '」，返還 1 本附魔書', 'info');
          UI.dirty.header = true;
          renderDetail();
        }
      }
      return;
    }
    var pin = e.target.closest('[data-part-install]');
    if (pin) {
      var pid = pin.getAttribute('data-part-install');
      var part = findPart(pid);
      if (part) installPart(pid, PART_TYPES[part.key].node);
      UI.dirty.factory = true;
      return;
    }
    var pun = e.target.closest('[data-part-uninstall]');
    if (pun) {
      var pid2 = pun.getAttribute('data-part-uninstall');
      var part2 = findPart(pid2);
      if (part2) uninstallPart(PART_TYPES[part2.key].node, pid2);
      flog('🔧 已卸下 ' + part2.name, '');
      return;
    }
    var tf = e.target.closest('[data-tower-floor]');
    if (tf) {
      startTowerFight(parseInt(tf.getAttribute('data-tower-floor'), 10));
      switchTab('tower');
      return;
    }
  });

  var btnSalvageSettings = $id('btn-salvage-settings');
  var salvagePanel = $id('salvage-settings-panel');
  if (btnSalvageSettings && salvagePanel) {
    btnSalvageSettings.addEventListener('click', function (e) {
      e.stopPropagation();
      salvagePanel.style.display = (salvagePanel.style.display === 'none' || !salvagePanel.style.display) ? 'flex' : 'none';
    });

    document.addEventListener('click', function (e) {
      if (!salvagePanel.contains(e.target) && e.target !== btnSalvageSettings) {
        salvagePanel.style.display = 'none';
      }
    });

    $id('btn-salvage-confirm').addEventListener('click', function (e) {
      e.stopPropagation();
      var maxRarity = parseInt($id('salvage-rarity-select').value, 10);
      var rName = RARITIES[maxRarity].name;

      if (maxRarity >= 5) {
        showConfirmDialog('確定要分解所有「' + rName + '及以下」的未鎖定裝備嗎？\n此操作無法復原。', function () {
          salvageAllUnlocked(maxRarity);
          salvagePanel.style.display = 'none';
        }, { title: '裝備拆解確認', danger: true });
      } else {
        salvageAllUnlocked(maxRarity);
        salvagePanel.style.display = 'none';
      }
    });
  }
  $id('inv-expand').addEventListener('click', function () {
    var upg = G.player.invUpgrades || 0;
    var cost = 10000 + upg * 1000;
    if (G.player.gold < cost) {
      blog('❌ 金幣不足，擴充需要 ' + cost + ' 金幣', 'warn', 'system');
      return;
    }
    G.player.gold -= cost;
    G.player.invUpgrades = upg + 1;
    blog('✅ 背包容量已擴充至 ' + (INVENTORY_CAP + G.player.invUpgrades), 'good', 'system');
    UI.dirty.inv = true;
    UI.dirty.header = true;
  });
  $id('inv-sort').addEventListener('click', function () {
    G.inventory.sort(function (a, b) {
      if (b.level !== a.level) return b.level - a.level;
      return b.rarity - a.rarity;
    });
    UI.dirty.inv = true;
    blog('🎒 背包已排序完成。', 'info', 'system');
  });
  $id('tw-flee').addEventListener('click', fleeTower);

  // 神鑄：鑄造 / 全卸下 / 自動使用魔塵
  var forgeGoBtn = $id('forge-go');
  if (forgeGoBtn) {
    forgeGoBtn.addEventListener('click', function () {
      var err = doForge();
      if (err) {
        forgeLog(err, 'bad');
        blog('⚠️ 神鑄：' + err, 'warn');
      }
    });
    $id('forge-unload').addEventListener('click', function () {
      var n = forgeUnloadAll();
      if (n) blog('↩️ 神鑄：已取回 ' + n + ' 件裝備', 'info');
    });
    $id('forge-autodust').addEventListener('change', function () {
      var f = forgeState();
      f.autoDust = this.checked;
      if (f.autoDust && forgeItemCount() > 0) forgeAutoFillDust();
      UI.dirty.forge = true;
    });
    // 背包 / 寶石切頁
    $id('forge-invtab-items').addEventListener('click', function () {
      UI.forgeInvTab = 'items'; UI.dirty.forge = true;
    });
    $id('forge-invtab-gems').addEventListener('click', function () {
      UI.forgeInvTab = 'gems'; UI.dirty.forge = true;
    });
  }
  $id('toggle-compare').addEventListener('change', function () {
    G.settings.compareEq = this.checked;
    renderDetail();
  });

  // 生產線設定
  document.querySelectorAll('.flt-sel').forEach(function (sel) {
    sel.addEventListener('change', function () {
      var r = parseInt(sel.getAttribute('data-rarity'), 10);
      G.factory.filter.actions[r] = (sel.value === 'synth' && !SYNTHESIS_ENABLED) ? 'keep' : sel.value;
      flog('🔀 篩選規則更新：' + RARITIES[r].name + ' → ' + ({ keep: '保留', salvage: '分解', smart: '比已裝備弱則分解' })[sel.value], 'info');
    });
  });
  $id('flt-autoequip').addEventListener('change', function () { G.factory.autoEquip = this.checked; });
  $id('syn-hybrid').addEventListener('change', function () { G.factory.synth.hybridEnabled = this.checked; });
  $id('syn-merge').addEventListener('change', function () { G.factory.synth.mergeEnabled = this.checked; });
  $id('syn-gem').addEventListener('change', function () {
    G.factory.synth.gemMerge = this.checked;
    UI.dirty.gems = true; // 寶石分頁的「寶石升階」開關同步顯示
  });
  // 寶石分頁的「寶石升階」快速開關（與熔爐頁 syn-gem 同步）
  var gemMergeToggle = $id('gem-merge-toggle');
  if (gemMergeToggle) {
    gemMergeToggle.addEventListener('change', function () {
      G.factory.synth.gemMerge = this.checked;
      var synGem = $id('syn-gem');
      if (synGem) synGem.checked = this.checked;
      blog(this.checked ? '⚙️ 已開啟熔爐自動「寶石升階」（3 顆同種同級 → 高一級）' : '⚙️ 已關閉熔爐自動「寶石升階」，寶石庫存不會再被自動合成', 'info');
    });
  }
  $id('syn-mingem').addEventListener('change', function () { G.factory.synth.minGemLevel = parseInt(this.value, 10) || 1; });
  $id('syn-book').addEventListener('change', function () { G.factory.synth.bookChoice = this.value; });
  // 附魔已改為裝備介面手動操作（無自動附魔設定）
  $id('up-enabled').addEventListener('change', function () { G.factory.upgrade.enabled = this.checked; });
  $id('up-cap').addEventListener('change', function () {
    G.factory.upgrade.cap = clamp(parseInt(this.value, 10) || 0, 0, 30);
    this.value = String(G.factory.upgrade.cap);
  });

  // 設定分頁：存檔管理
  $id('btn-save').addEventListener('click', function () {
    var rec = manualSave();
    var m = $id('save-msg');
    if (rec) {
      blog('💾 已建立存檔記錄：' + rec.fname, 'good');
      if (m) m.textContent = '💾 已建立存檔記錄：' + rec.fname;
    } else {
      blog('⚠️ 存檔失敗（儲存空間可能已滿）', 'bad');
      if (m) m.textContent = '⚠️ 存檔失敗（儲存空間可能已滿）';
    }
    renderSaveList();
  });
  $id('btn-folder').addEventListener('click', function () {
    var m = $id('save-msg');
    if (m) m.textContent = '⏳ 連接存檔資料夾中…（請在跳出的視窗選擇資料夾）';
    openSaveFolder(function (err, res) {
      var text;
      if (err) text = '⚠️ ' + err;
      else if (res.fallback) text = '📥 此瀏覽器不支援存檔資料夾，已改為下載 .json 存檔（見「下載」資料夾）';
      else text = '✅ 已同步資料夾「' + res.dirName + '」：寫出 ' + res.wrote + ' 個存檔檔案' +
        (res.imported ? '、匯入 ' + res.imported + ' 個新存檔' : '') + '。可直接把資料夾中的 .json 檔傳給別人分享。';
      if (m) m.textContent = text;
      blog((err ? '⚠️ ' : '📂 ') + text, err ? 'warn' : 'good');
      renderSaveList();
    });
  });
  $id('btn-restart').addEventListener('click', function () {
    showConfirmDialog('確定要重新開局嗎？將開一個全新角色從頭重玩。\n目前進度已保留在「⚡ 即時自動存檔（第 ' + (G.runId || 1) + ' 局）」，所有存檔記錄都不會刪除，隨時可以讀回來。', function () {
      restartGame();
    }, { title: '重新開局確認', okText: '重新開局', danger: true });
  });
  // 讀取/下載/刪除存檔（每列右側按鈕，需二次確認）
  $id('save-list').addEventListener('click', function (e) {
    var loadBtn = e.target.closest('[data-load-save]');
    var dlBtn = e.target.closest('[data-dl-save]');
    var delBtn = e.target.closest('[data-del-save]');
    if (!loadBtn && !dlBtn && !delBtn) return;

    var id = loadBtn ? loadBtn.getAttribute('data-load-save')
           : dlBtn ? dlBtn.getAttribute('data-dl-save')
           : delBtn.getAttribute('data-del-save');
    var rec = null;
    saveIndex().forEach(function (r) { if (r.id === id) rec = r; });
    if (!rec) return;

    if (loadBtn) {
      showConfirmDialog('確定要讀取「' + saveRecName(rec) + '」嗎？\n檔名：' + rec.fname + '\n時間：' + saveTimeStr(rec.savedAt) +
        '\n\n目前進度會先寫入本局的自動存檔，再切換為此存檔。', function () {
        var err = loadSaveRecord(id);
        if (err) blog('⚠️ 讀取存檔失敗：' + err, 'bad');
      }, { title: '讀取存檔確認', okText: '讀取存檔', danger: true });
    } else if (dlBtn) {
      downloadSingleSave(id, rec.fname);
      blog('⬇️ 存檔已下載：' + rec.fname, 'good');
    } else if (delBtn) {
      showConfirmDialog('確定要刪除「' + saveRecName(rec) + '」嗎？\n檔名：' + rec.fname + '\n時間：' + saveTimeStr(rec.savedAt) +
        '\n\n刪除後無法恢復，是否繼續？', function () {
        deleteSaveRecord(id);
        blog('🗑️ 存檔已刪除：' + rec.fname);
        renderSaveList();
      }, { title: '刪除存檔確認', okText: '刪除存檔', danger: true });
    }
  });
  renderSaveList();

  syncFactoryInputs();

  // 戰鬥結算日誌彈窗
  var btnSummary = $id('btn-summary');
  if (btnSummary) {
    btnSummary.addEventListener('click', function () {
      var modal = $id('summary-modal');
      if (modal) modal.style.display = 'flex';
    });
  }
  var summaryModal = $id('summary-modal');
  if (summaryModal) {
    summaryModal.addEventListener('click', function (e) {
      if (e.target === summaryModal) {
        summaryModal.style.display = 'none';
      }
    });
    var summaryClose = $id('summary-modal-close');
    if (summaryClose) {
      summaryClose.addEventListener('click', function () {
        summaryModal.style.display = 'none';
      });
    }
  }
}

/* ---- 高塔結算彈窗 ---- */
function showTowerResultModal(r, p, b, myDmg, bDmg) {
  var modal = $id('tower-result-modal');
  var title = $id('trm-title');

  if (r.win) {
    title.innerHTML = '🏆 挑戰成功！通關第 ' + r.floor + ' 層';
    title.className = 'tr-title good';
  } else {
    title.innerHTML = '💀 挑戰失敗（第 ' + r.floor + ' 層）';
    title.className = 'tr-title bad';
  }

  var st = getStats();
  var pMax = st.hp;
  var pHp = p ? p.hp : 0;
  var bMax = b ? b.maxHp : 1;
  var bHp = b ? b.hp : 0;

  var pPct = Math.max(0, Math.round(pHp / pMax * 100));
  var bPct = Math.max(0, Math.round(bHp / bMax * 100));

  var hpStatsHtml =
    '<div style="display:flex; justify-content:space-between; margin-bottom: 4px;"><span>冒險者：</span><span>' + fmt(Math.max(0, pHp)) + ' / ' + fmt(pMax) + ' (' + pPct + '%)</span></div>' +
    '<div style="display:flex; justify-content:space-between;"><span>' + (b ? b.name : 'BOSS') + '：</span><span>' + fmt(Math.max(0, bHp)) + ' / ' + fmt(bMax) + ' (' + bPct + '%)</span></div>';
  $id('trm-hp-stats').innerHTML = hpStatsHtml;

  var dmgStatsHtml =
    '<div style="display:flex; justify-content:space-between; margin-bottom: 4px;"><span>我方造成：</span><span>' + fmt(myDmg) + '</span></div>' +
    '<div style="display:flex; justify-content:space-between;"><span>敵方造成：</span><span>' + fmt(bDmg) + '</span></div>';
  $id('trm-dmg-stats').innerHTML = dmgStatsHtml;

  if (r.win) {
    $id('trm-rewards').innerHTML = r.rewards.map(function (x) { return '<div style="margin-bottom:4px;">' + x + '</div>'; }).join('');
  } else {
    $id('trm-rewards').innerHTML = r.analysis.map(function (x) { return '<div style="margin-bottom:4px; color:#ffb366;">📋 ' + esc(x) + '</div>'; }).join('');
  }

  modal.style.display = 'flex';
}

if ($id('trm-confirm')) {
  $id('trm-confirm').onclick = function () {
    $id('tower-result-modal').style.display = 'none';
    if (typeof finishTowerFight === 'function') finishTowerFight();
  };
}
