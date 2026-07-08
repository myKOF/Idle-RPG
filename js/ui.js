'use strict';
/* ============ UI 渲染與互動 ============ */

var UI = {
  dirty: { header: true, battle: true, equip: true, inv: true, factory: true, tower: true, gems: true, skills: true },
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
    if (msg.includes('戰利品') || msg.includes('獲得') || msg.includes('掉落')) cat = 'loot';
    else if (msg.includes('強化') || msg.includes('換裝') || msg.includes('資源不足') || msg.includes('背包已滿') || msg.includes('暫存區已滿')) cat = 'factory';
    else if (msg.includes('推進') || msg.includes('退回') || msg.includes('高塔') || msg.includes('狂暴') || msg.includes('撤出') || msg.includes('復活') || msg.includes('重擊') || msg.includes('擊倒') || msg.includes('遭遇')) cat = 'combat';
    else cat = 'system';
  }
  addLog('battle-log', msg, cls, 150, cat);
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
}

/* ---- 頂部資源 / 屬性 ---- */
function renderHeader() {
  var p = G.player, st = getStats();
  $id('r-gold').textContent = fmt(p.gold);
  $id('r-scrap').textContent = fmt(p.scrap);
  $id('r-essence').textContent = fmt(p.essence);
  var gemTip = [];
  for (var gt in GEM_TYPES) {
    var tn = 0;
    for (var lv = 1; lv <= GEM_MAX_LEVEL; lv++) tn += gemCount(gt, lv);
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
  if (ent.shield && ent.shield > 0.5) s.push('🫧護盾' + fmt(ent.shield));
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
    
    arr.sort(function(a, b) {
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
function renderBattle() {
  var st = getStats();
  var stg = G.stage;
  $id('stage-label').textContent = '第 ' + stg.current + ' 階段';
  $id('stage-best').textContent = '最高 ' + stg.best;
  $id('kill-count').textContent = '擊殺 ' + stg.kills + '/' + KILLS_PER_STAGE;
  $id('st-auto').checked = stg.autoAdvance;

  var p = FIELD.player;
  if (p) {
    var php = clamp(p.hp / st.hp * 100, 0, 100);
    $id('pv-hp').style.width = php + '%';
    $id('pv-hptext').textContent = fmt(Math.max(0, p.hp)) + ' / ' + fmt(st.hp);
    $id('pv-status').textContent = FIELD.reviveCd > 0 ? ('💀 復活中 ' + fmt1(FIELD.reviveCd) + 's') : entStatus(p);
    renderMpSkill(p, 'pv');
  }
  var m = FIELD.monster;
  if (m) {
    $id('mv-emoji').textContent = m.emoji;
    $id('mv-name').textContent = m.name + ' Lv.' + m.level;
    $id('mv-name').classList.toggle('elite', m.elite);
    var mhp = clamp(m.hp / m.maxHp * 100, 0, 100);
    $id('mv-hp').style.width = mhp + '%';
    $id('mv-hptext').textContent = fmt(Math.max(0, m.hp)) + ' / ' + fmt(m.maxHp);
    $id('mv-status').textContent = entStatus(m);
  } else {
    $id('mv-emoji').textContent = '⏳';
    $id('mv-name').textContent = G.tower.active ? '（高塔戰鬥中…）' : '搜索敵人中…';
    $id('mv-hp').style.width = '0%';
    $id('mv-hptext').textContent = '';
    $id('mv-status').textContent = '';
  }
}

/* ---- 裝備分頁 ---- */
function itemCellHTML(it, source) {
  var r = RARITIES[it.rarity];
  var effClass = (it.rarity === 6) ? ' eff-mythic' : (it.rarity >= 7 ? ' eff-genesis' : '');
  return '<div class="item-cell' + effClass + '" data-id="' + it.id + '" data-src="' + source + '" data-slot="' + it.slot + '" ' +
    'style="border-color:' + r.color + ';box-shadow:inset 0 0 12px ' + r.color + '33">' +
    '<span class="ic-emoji">' + SLOT_INFO[it.slot].emoji + '</span>' +
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
      var effClass = (it.rarity === 6) ? ' eff-mythic' : (it.rarity >= 7 ? ' eff-genesis' : '');
      h += '<div class="eq-slot filled' + effClass + '" data-id="' + it.id + '" data-src="equip" data-slot="' + slot + '" style="border-color:' + r.color + '">' +
        '<div class="eq-emoji">' + info.emoji + '</div>' +
        '<div class="eq-name" style="color:' + r.color + '">' + esc(it.name) + (it.upgrade ? ' +' + it.upgrade : '') + '</div>' +
        '<div class="eq-sub">' + info.name + '・Lv.' + it.level +
        (itemEnchants(it).length ? ' ' + itemEnchants(it).map(function (en) { return (ENCHANTS[en.key] || {}).emoji || ''; }).join('') : '') + '</div></div>';
    } else {
      h += '<div class="eq-slot empty"><div class="eq-emoji dim">' + info.emoji + '</div>' +
        '<div class="eq-sub">' + info.name + '（未裝備）</div></div>';
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

function findSelItem() {
  if (!UI.sel) return null;
  if (UI.sel.source === 'inv') {
    for (var i = 0; i < G.inventory.length; i++) if (G.inventory[i].id === UI.sel.id) return G.inventory[i];
  } else {
    for (var s in G.equipment) if (G.equipment[s] && G.equipment[s].id === UI.sel.id) return G.equipment[s];
  }
  return null;
}

function renderDetail() {
  var pane = $id('detail-pane');
  var it = findSelItem();
  updateSelectionUI();
  if (!it) {
    pane.innerHTML = '<div class="hint">點選裝備查看詳情</div>';
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
  h += '<div class="detail-actions">';
  if (UI.sel.source === 'inv') {
    h += '<button class="btn" data-act="equip">裝備</button>';
    h += '<button class="btn warn" data-act="salvage">分解</button>';
    h += '<button class="btn" data-act="tosynth">送合成區</button>';
  } else {
    h += '<button class="btn" data-act="unequip">卸下</button>';
  }
  var enoughUpGold = G.player.gold >= cost.gold;
  var enoughUpScrap = G.player.scrap >= cost.scrap;
  var upGoldHtml = '<span' + (enoughUpGold ? '' : ' style="color:#fca5a5"') + '>💰 ' + fmt(cost.gold) + '</span>';
  var upScrapHtml = '<span' + (enoughUpScrap ? '' : ' style="color:#fca5a5"') + '>🔩 ' + fmt(cost.scrap) + '</span>';
  var upTip = '需要：' + upGoldHtml + ' &nbsp;' + upScrapHtml;
  h += '<button class="btn act-btn-tooltip" data-act="upgrade">強化<div class="btn-tip">' + upTip + '</div></button>';

  h += '<button class="btn" data-act="lock">' + (it.locked ? '解鎖' : '鎖定') + '</button>';
  h += '</div>';
  // 鑲嵌選擇（有空插槽時列出持有寶石）
  ensureSockets(it);
  if (it.sockets.indexOf(null) >= 0) {
    var chips = [];
    for (var gt in GEM_TYPES) {
      var total = 0, hi = 0;
      for (var lv = GEM_MAX_LEVEL; lv >= 1; lv--) {
        var n = gemCount(gt, lv);
        total += n;
        if (n && !hi) hi = lv;
      }
      if (total) {
        chips.push('<span class="gem-chip" data-gem-socket="' + gt + '" title="鑲嵌 ' + esc(GEM_NAMES[hi] + GEM_TYPES[gt].name) + '">' +
          GEM_TYPES[gt].emoji + esc(GEM_TYPES[gt].name) + ' L' + hi + '×' + gemCount(gt, hi) + '</span>');
      }
    }
    (G.player.fusedGems || []).forEach(function (fg) {
      chips.push('<span class="gem-chip fused-chip" data-gem-socket-fused="' + fg.id + '" title="鑲嵌雙屬性融合寶石">' +
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
      bookChips2.push('<span class="gem-chip' + (owned ? ' dim-chip' : '') + '" data-book-enchant="' + bk2 + '" title="' +
        esc(ENCHANTS[bk2].desc) + (owned ? '（已附魔，僅可升級數值）' : '') + '">' +
        ENCHANTS[bk2].emoji + esc(ENCHANTS[bk2].name) + ' ×' + bn2 + '</span>');
    }
    var catNames2 = { atk: '攻擊', def: '防禦', util: '功能' };
    h += '<div class="sec-sub">✨ 附魔（' + catNames2[cat2] + '類，每次消耗 1 書＋🔮' + ENCHANT_ESSENCE_COST +
      ' 精華，庫存 ' + fmt(G.player.essence) + '）</div>' +
      '<div class="gem-picker">' + (bookChips2.length ? bookChips2.join('') : '<span class="hint">沒有此部位可用的附魔書（階段 8+ 掉落 / 高塔獎勵）</span>') + '</div>';
  }
  pane.innerHTML = h;
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
  
  setTimeout(function() {
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

function salvageAllUnlocked() {
  var kept = [], count = 0, scrap = 0;
  G.inventory.forEach(function (it) {
    if (it.locked) { kept.push(it); return; }
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
    return '<span class="conv-chip" style="border-color:' + r.color + ';color:' + r.color + '" title="' +
      esc(rarityTag(it)) + '">' + SLOT_INFO[it.slot].emoji + '</span>';
  }).join('') + (f.conveyor.length > 18 ? '<span class="conv-more">+' + (f.conveyor.length - 18) + '</span>' : '');
  $id('conveyor-count').textContent = f.conveyor.length + '/' + conveyorCap();

  // 分解槽資訊（精粹提取率含分解高產/幸運加成）
  var speedUp = 1 + partBonus('salvage', 'speedGear') / 100;
  $id('salv-info').textContent = '處理速度 ' + fmt1(speedUp) + 'x｜精粹提取率 ' + fmt1(extractChanceNow()) +
    '%｜已分解 ' + fmt(f.stats.salvaged) + '｜精粹提取 ' + fmt(f.stats.extracted) + ' 次';

  // 合成節點資訊（大成功率含幸運值加成）
  var greatChance = SYNTH_GREAT_BASE + partBonus('synth', 'luckCore') + getStats().luck / 2;
  var reroll = partBonus('synth', 'rerollModule');
  $id('syn-info').textContent = '大成功率 ' + fmt1(greatChance) + '%｜重骰率 ' + fmt1(reroll) +
    '%｜變異率 ' + fmt1(getStats().hybridMutation) + '%｜已合成 ' + fmt(f.stats.synthesized) + ' 件' +
    (f.stats.mutated ? '（變異 ' + fmt(f.stats.mutated) + '）' : '');
  var buf = $id('synth-buffer');
  buf.innerHTML = f.synthBuffer.length
    ? f.synthBuffer.slice(0, 12).map(function (it) {
        var r = RARITIES[it.rarity];
        return '<span class="conv-chip" style="border-color:' + r.color + ';color:' + r.color + '" title="' +
          esc(rarityTag(it)) + '">' + SLOT_INFO[it.slot].emoji + '</span>';
      }).join('') + (f.synthBuffer.length > 12 ? '<span class="conv-more">+' + (f.synthBuffer.length - 12) + '</span>' : '')
    : '<span class="hint">（空）篩選規則設為「合成素材」的裝備會進到這裡</span>';

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

  // 零件庫
  var plist = $id('parts-list');
  if (!f.parts.length) {
    plist.innerHTML = '<div class="hint">尚無自動機組零件 — 通關 BOSS 高塔可獲得！</div>';
  } else {
    plist.innerHTML = f.parts.map(function (p) {
      var inst = isInstalled(p.id);
      var pt = PART_TYPES[p.key];
      return '<div class="part-row' + (inst ? ' installed' : '') + '">' +
        '<span class="part-name">' + pt.emoji + ' ' + esc(p.name) + '</span>' +
        '<span class="part-desc">' + esc(partDesc(p)) + '（' + NODE_NAMES[pt.node] + '）</span>' +
        (inst
          ? '<button class="btn sm" data-part-uninstall="' + p.id + '">卸下</button>'
          : '<button class="btn sm" data-part-install="' + p.id + '">安裝</button>') +
        '</div>';
    }).join('');
  }
}

function renderInstalledParts(node, elId) {
  var ids = G.factory.installed[node] || [];
  var h = ids.map(function (id) {
    var p = findPart(id);
    if (!p) return '';
    return '<span class="part-chip" title="' + esc(partDesc(p)) + '">' + PART_TYPES[p.key].emoji + esc(p.name) + '</span>';
  }).join('');
  for (var i = ids.length; i < PART_SLOTS_PER_NODE; i++) h += '<span class="part-chip empty">空槽</span>';
  $id(elId).innerHTML = h;
}

// 將工廠設定同步到輸入元件（初始化 / 讀檔後）
function syncFactoryInputs() {
  var f = G.factory;
  document.querySelectorAll('.flt-sel').forEach(function (sel) {
    var r = parseInt(sel.getAttribute('data-rarity'), 10);
    sel.value = f.filter.actions[r];
  });
  $id('flt-smart').checked = f.filter.smartSalvage;
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
        
      h += '<div class="tower-floor' + (cleared ? ' cleared' : '') + (unlocked ? '' : ' locked') + '" data-tower-tip="' + fl + '">' +
        '<span class="tf-emoji">' + bd.emoji + '</span>' +
        '<span class="tf-name">第 ' + fl + ' 層・' + bd.name + (cleared ? ' ✅' : '') + '</span>' +
        '<span class="tf-hint" style="margin-left:auto; margin-right:10px;">建議野外階段 ' + (4 + fl * 5) + '+</span>' +
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
        rh += '<div class="tr-sub">獲得獎勵：</div>' + r.rewards.map(function (x) { return '<div class="tr-line">' + esc(x) + '</div>'; }).join('');
      } else {
        rh += '<div class="tr-sub">戰鬥數據：DPS ' + fmt(r.myDps) + '（通關需求約 ' + fmt(r.needDps) + '）｜BOSS 剩餘血量 ' + r.bossHpPct + '%</div>';
        rh += '<div class="tr-sub">失敗分析：</div>' + r.analysis.map(function (x) { return '<div class="tr-line">📋 ' + esc(x) + '</div>'; }).join('');
      }
      rbox.innerHTML = rh;
      rbox.style.display = '';
    } else {
      rbox.style.display = 'none';
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
  $id('tb-emoji').textContent = b.emoji;
  $id('tb-name').textContent = b.name + ' Lv.' + b.level;
  $id('tb-hp').style.width = clamp(b.hp / b.maxHp * 100, 0, 100) + '%';
  $id('tb-hptext').textContent = fmt(Math.max(0, b.hp)) + ' / ' + fmt(b.maxHp) + '（' + Math.round(b.hp / b.maxHp * 100) + '%）';
  $id('tb-status').textContent = entStatus(b) + (b.elem ? ' 屬性:' + ENCHANTS[b.elem].emoji : '');
  $id('tp-hp').style.width = clamp(p.hp / st.hp * 100, 0, 100) + '%';
  $id('tp-hptext').textContent = fmt(Math.max(0, p.hp)) + ' / ' + fmt(st.hp);
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
  if (d.header) { renderHeader(); d.header = false; }
  renderBattle(); // Battle is always visible
  if (UI.tab === 'tower' && G.tower.active) renderTowerFight();
  d.battle = false;
  if (d.equip && UI.tab === 'equip') { renderEquip(); d.equip = false; }
  if (d.inv && UI.tab === 'equip') { renderInventory(); d.inv = false; }
  if (d.factory && UI.tab === 'factory') { renderFactory(); d.factory = false; }
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
  var cls = 'tree-cell' + (lv > 0 ? ' learned' : '') + (lock ? ' locked' : '') +
    (UI.selSkill === id ? ' selected' : '') + (inLoadout ? ' equipped' : '');
  return '<div class="' + cls + '" data-sk="' + id + '">' +
    '<span class="tc-emoji">' + sk.emoji + '</span>' +
    (lv > 0 ? '<span class="tc-lv">' + lv + '</span>' : (lock ? '<span class="tc-lock">🔒</span>' : '')) +
    (inLoadout ? '<span class="tc-eq">⚔</span>' : '') +
    '</div>';
}

function renderSkills() {
  var treesBox = $id('skill-trees');
  if (!treesBox) return;
  var p = G.player;
  $id('sp-count').textContent = availableSkillPoints() + '（等級 ' + p.level + ' 共 ' + totalSkillPoints() + ' 點，已用 ' + spentSkillPoints() + '）';

  // 裝載欄（每 10 級 +1 格）
  var loBox = $id('skill-loadout');
  var lo = p.loadout || [];
  var cap = loadoutSize();
  $id('loadout-cap').textContent = lo.length + '/' + cap + ' 格（角色每 10 級 +1 格）';
  var lh = '';
  for (var i = 0; i < cap; i++) {
    var id0 = lo[i];
    var d0 = id0 ? skillDef(id0) : null;
    if (d0) {
      lh += '<span class="loadout-slot filled" data-skill-unequip="' + id0 + '">' +
        d0.emoji + ' ' + esc(d0.name) + ' Lv.' + skillLevel(id0) + '</span>';
    } else {
      lh += '<span class="loadout-slot">空欄位</span>';
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
  h += '<div class="detail-actions">';
  if (lv < maxLv && !lock) {
    h += '<button class="btn sm" data-skill-learn="' + id + '"' + (availableSkillPoints() < 1 ? ' disabled' : '') + '>' +
      (lv === 0 ? '📖 學習' : '⬆️ 升級') + '（1 點）</button>';
  } else if (lv >= maxLv) {
    h += '<span class="sk-max">已滿級</span>';
  }
  if (lv > 0) {
    h += '<button class="btn sm warn" data-skill-downgrade="' + id + '">⬇️ 降級（還 1 點）</button>';
  }
  if (sk.cat !== 'passive' && lv > 0) {
    h += inLoadout
      ? '<button class="btn sm warn" data-skill-unequip="' + id + '">卸下</button>'
      : '<button class="btn sm" data-skill-equip="' + id + '">⚔️ 裝備</button>';
  }
  if (!isFusion && sk.cat !== 'passive' && lv > 0) {
    h += '<button class="btn sm" data-skill-fuse-add="' + id + '">⚗️ 加入融合</button>';
  }
  if (isFusion) {
    h += '<button class="btn sm danger" data-fusion-delete="' + id + '">🗑️ 刪除（歸還全部點數）</button>';
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
  
  var dropTip = '<div class="skt-name" style="margin-bottom:6px;">【可能掉落物】</div>' +
    '<div class="skt-desc" style="text-align:left;">' +
    '💰 金幣 x' + fmt(200 * fl) + ' <span style="color:var(--dim)">(首通雙倍)</span><br>' +
    '🔮 附魔精華 x' + (3 + fl) + ' <span style="color:var(--dim)">(100%)</span><br>' +
    '💎 隨機寶石 x2 <span style="color:var(--dim)">(100%)</span><br>' +
    '📖 隨機附魔書 x2 <span style="color:var(--dim)">(100%)</span><br>' +
    '🔩 機組零件 <span style="color:var(--dim)">(首通必掉 / 之後30%)</span>';
  
  var bossRates = dropRatesFor(BOSS_DROP_TABLE, fl);
  var equipStrs = [];
  for (var br = bossRates.length - 1; br >= 0; br--) {
    if (!bossRates[br]) continue;
    var rate = bossRates[br];
    var rateStr = '';
    if (rate >= 100) {
      rateStr = '必定' + Math.floor(rate/100) + '件';
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
    '🛡️ 物理防禦：' + fmt(m.def) + '<br>' +
    '🔮 魔法防禦：' + fmt(m.mdef || m.def*0.75) + '<br>' +
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
      h += '<span class="loadout-slot filled" data-fuse-remove="' + id + '" title="點擊移出">' +
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
  for (var lv = 1; lv <= GEM_MAX_LEVEL; lv++) h += '<th>' + GEM_NAMES[lv] + '</th>';
  h += '</tr>';
  for (var t in GEM_TYPES) {
    var gt = GEM_TYPES[t];
    var v1 = gemStatValue(t, 1), v5 = gemStatValue(t, GEM_MAX_LEVEL);
    h += '<tr><td class="gem-name">' + gt.emoji + ' ' + esc(gt.name) + '</td>' +
      '<td class="dim-text">' + esc(gt.statName.replace('%', '')) + '（L1 +' + (gt.pct ? pctStr(v1) : fmt(v1)) +
      ' ～ L5 +' + (gt.pct ? pctStr(v5) : fmt(v5)) + '）</td>';
    for (var lv2 = 1; lv2 <= GEM_MAX_LEVEL; lv2++) {
      var n = gemCount(t, lv2);
      h += '<td class="gem-cnt' + (n ? ' has' : '') + '">' + (n || '－') + '</td>';
    }
    h += '</tr>';
  }
  h += '</table>';
  box.innerHTML = h;
  renderFuseInfo();
  renderGemFusion();
  renderGemShop();
}
function renderFuseInfo() {
  var sel = $id('fuse-level');
  var info = $id('fuse-info');
  if (!sel || !info) return;
  var lv = parseInt(sel.value, 10) || 1;
  info.textContent = '該等級庫存 ' + fmt(totalGemsOfLevel(lv)) + ' 顆｜費用 💰' + fmt(FUSE_GOLD_COST[lv]) +
    '｜昇華機率 ' + fmt1(Math.min(100, FUSE_UPGRADE_CHANCE + getStats().luck / 2)) + '%（幸運值加成）';
}

/* ---- 寶石融合 v2（雙屬性，僅限 5 階） ---- */
function renderGemFusion() {
  var slotBox = $id('gfuse-slots');
  if (!slotBox) return;
  if (!UI.gemFuseSlots) UI.gemFuseSlots = [null, null];
  var h = '';
  for (var i = 0; i < 2; i++) {
    var ref = UI.gemFuseSlots[i];
    if (ref) {
      var label = ref.kind === 'plain'
        ? gemLabel(ref.type, GEM_MAX_LEVEL)
        : (findFusedGem(ref.id) ? fusedGemLabel(findFusedGem(ref.id)) : '（已消失）');
      h += '<span class="loadout-slot filled" data-gfuse-remove="' + i + '" title="點擊移出">' + esc(label) + '</span>';
    } else {
      h += '<span class="loadout-slot">素材 ' + (i + 1) + '（5 階寶石）</span>';
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
    info.textContent = '請放入 2 顆素材（僅限 5 階一般寶石或融合寶石）';
  }
  // 素材池
  var pool = $id('gfuse-pool');
  var chips = [];
  for (var t in GEM_TYPES) {
    var n = gemCount(t, GEM_MAX_LEVEL);
    if (n > 0) {
      chips.push('<span class="gem-chip" data-gfuse-pick="plain:' + t + '">' +
        GEM_TYPES[t].emoji + esc(GEM_TYPES[t].name) + ' L5 ×' + n + '</span>');
    }
  }
  (G.player.fusedGems || []).forEach(function (fg) {
    chips.push('<span class="gem-chip fused-chip" data-gfuse-pick="fused:' + fg.id + '" title="已成功融合 ' + (fg.fusions || 0) + ' 次（下次成功率遞減）">' +
      esc(fusedGemLabel(fg)) + '</span>');
  });
  pool.innerHTML = chips.length ? chips.join('') : '<span class="hint">沒有 5 階寶石 — 可透過寶石升階、寶石合成或商店取得</span>';
  // 持有融合寶石清單
  var fl = $id('fused-gem-list');
  var fchips = (G.player.fusedGems || []).map(function (fg) {
    return '<span class="gem-chip fused-chip">' + esc(fusedGemLabel(fg)) +
      ((fg.fusions || 0) > 1 ? '〔融合×' + fg.fusions + '〕' : '') + '</span>';
  });
  fl.innerHTML = fchips.length ? fchips.join('') : '<span class="hint">尚無融合寶石 — 融合成功後會出現在這裡，可至裝備分頁鑲嵌</span>';
}

/* ---- 寶石商店 ---- */
var GEM_TIER_COLORS = { 1: '#9aa5b1', 2: '#4ade80', 3: '#38bdf8', 4: '#c084fc', 5: '#ffd700' };
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
        : '<button class="btn sm" data-shop-buy="' + i + '">💰 ' + fmt(gemShopPrice(item.lv)) + '</button>') +
      '</div>';
  }).join('');
  var total = 0;
  s.items.forEach(function (it2) { if (!it2.sold) total += gemShopPrice(it2.lv); });
  var buyAllBtn = $id('shop-buy-all');
  if (buyAllBtn) buyAllBtn.textContent = '🛒 一鍵全購買（💰' + fmt(total) + '）';
  var refBtn = $id('shop-refresh');
  if (refBtn) refBtn.textContent = '🔄 手動刷新（💰' + fmt(shopRefreshCost()) + '）';
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
    s.stage = '🚩 第 ' + G.stage.current + ' 階段（' + G.stage.kills + '/' + KILLS_PER_STAGE + '）';
    s.info = '📈 DPS ' + fmt(currentDps()) + '　💰 ' + fmt(G.player.gold);
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
  var lines = document.querySelectorAll('#battle-log .log-line');
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
    t = '⚔️第' + G.stage.current + '階段 Lv.' + G.player.level + ' ❤️' + hpPct + '%';
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
function initUI() {
  // 分頁
  document.querySelectorAll('.tab-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      switchTab(b.getAttribute('data-tab'));
      UI.dirty.equip = true; UI.dirty.inv = true; UI.dirty.factory = true; UI.dirty.tower = true; UI.dirty.gems = true; UI.dirty.skills = true;
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
      if (confirm('確定刪除此融合技？所有投入的技能點將全數歸還。')) {
        var derr = deleteFusion(fd.getAttribute('data-fusion-delete'));
        if (derr) blog('⚠️ ' + derr, 'warn');
        UI.selSkill = null;
        renderSkills();
      }
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

  // 懸停提示（事件委派）
  document.addEventListener('mouseover', function (e) {
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
    if (e.target.closest('[data-sk]') || e.target.closest('.stat-row[data-tt-title]') || e.target.closest('[data-tower-tip]') || e.target.closest('#btn-enemy-tip')) hideTooltip();
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

  // 寶石合成（原融合改名）
  var fuseBtn = $id('fuse-btn');
  if (fuseBtn) {
    fuseBtn.addEventListener('click', function () {
      var lv = parseInt($id('fuse-level').value, 10) || 1;
      var err = fuseGems(lv);
      if (err) blog('⚠️ 合成失敗：' + err, 'warn');
      renderGems();
    });
    $id('fuse-level').addEventListener('change', renderFuseInfo);
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
      if (r.bought > 0) blog('🛒 一鍵購買 ' + r.bought + ' 顆寶石，花費 💰' + fmt(r.spent), 'good');
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
      if (b) b.className = 'log' + (v === 'all' ? '' : ' filter-' + v);
    });
  }

  // 迷你監控視窗
  var pipBtn = $id('btn-pip');
  if (pipBtn) pipBtn.addEventListener('click', openMiniWindow);

  // 階段控制
  $id('st-prev').addEventListener('click', function () { stageGo(-1); });
  $id('st-next').addEventListener('click', function () { stageGo(1); });
  $id('st-auto').addEventListener('change', function () { G.stage.autoAdvance = this.checked; });

  // 裝備 / 背包點擊（事件委派）
  document.addEventListener('click', function (e) {
    var cell = e.target.closest('.item-cell, .eq-slot');
    if (cell) {
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
    var actBtn = e.target.closest('#detail-pane .btn');
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
      var pref = pv[0] === 'plain' ? { kind: 'plain', type: pv[1] } : { kind: 'fused', id: pv[1] };
      // 融合寶石不可重複放入；一般寶石同種需有 2 顆
      var dupFused = pref.kind === 'fused' && UI.gemFuseSlots.some(function (r) { return r && r.kind === 'fused' && r.id === pref.id; });
      if (dupFused) { blog('⚠️ 這顆融合寶石已在融合槽中', 'warn'); return; }
      var slotIdx = UI.gemFuseSlots[0] ? (UI.gemFuseSlots[1] ? -1 : 1) : 0;
      if (slotIdx < 0) { blog('⚠️ 融合槽已滿（點擊素材可移出）', 'warn'); return; }
      if (pref.kind === 'plain') {
        var sameCnt = UI.gemFuseSlots.filter(function (r) { return r && r.kind === 'plain' && r.type === pref.type; }).length;
        if (gemCount(pref.type, GEM_MAX_LEVEL) < sameCnt + 1) { blog('⚠️ 此種 5 階寶石數量不足', 'warn'); return; }
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

  $id('inv-salvage-all').addEventListener('click', salvageAllUnlocked);
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
  $id('toggle-compare').addEventListener('change', function () {
    G.settings.compareEq = this.checked;
    renderDetail();
  });

  // 生產線設定
  document.querySelectorAll('.flt-sel').forEach(function (sel) {
    sel.addEventListener('change', function () {
      var r = parseInt(sel.getAttribute('data-rarity'), 10);
      G.factory.filter.actions[r] = sel.value;
      flog('🔀 篩選規則更新：' + RARITIES[r].name + ' → ' + ({ keep: '保留', salvage: '分解', synth: '合成素材' })[sel.value], 'info');
    });
  });
  $id('flt-smart').addEventListener('change', function () { G.factory.filter.smartSalvage = this.checked; });
  $id('flt-autoequip').addEventListener('change', function () { G.factory.autoEquip = this.checked; });
  $id('syn-hybrid').addEventListener('change', function () { G.factory.synth.hybridEnabled = this.checked; });
  $id('syn-merge').addEventListener('change', function () { G.factory.synth.mergeEnabled = this.checked; });
  $id('syn-gem').addEventListener('change', function () { G.factory.synth.gemMerge = this.checked; });
  $id('syn-mingem').addEventListener('change', function () { G.factory.synth.minGemLevel = parseInt(this.value, 10) || 1; });
  $id('syn-book').addEventListener('change', function () { G.factory.synth.bookChoice = this.value; });
  // 附魔已改為裝備介面手動操作（無自動附魔設定）
  $id('up-enabled').addEventListener('change', function () { G.factory.upgrade.enabled = this.checked; });
  $id('up-cap').addEventListener('change', function () {
    G.factory.upgrade.cap = clamp(parseInt(this.value, 10) || 0, 0, 30);
    this.value = String(G.factory.upgrade.cap);
  });

  // 設定分頁
  $id('btn-save').addEventListener('click', function () { saveGame(); blog('💾 已存檔', 'good'); });
  $id('btn-export').addEventListener('click', function () {
    $id('save-io').value = exportSave();
    $id('save-io').select();
    blog('📤 存檔已匯出至下方文字框', 'info');
  });
  $id('btn-import').addEventListener('click', function () {
    if (!importSave($id('save-io').value)) blog('⚠️ 匯入失敗：存檔格式錯誤', 'bad');
  });
  $id('btn-reset').addEventListener('click', function () {
    if (confirm('確定要刪除存檔重新開始嗎？此操作無法復原！')) resetGame();
  });

  syncFactoryInputs();
}
