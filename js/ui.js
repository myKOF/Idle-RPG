'use strict';
/* ============ UI 渲染與互動 ============ */

var UI = {
  dirty: { header: true, battle: true, equip: true, inv: true, factory: true, tower: true },
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
    if (msg.includes('強化') || msg.includes('換裝') || msg.includes('獲得') || msg.includes('資源不足') || msg.includes('背包已滿') || msg.includes('暫存區已滿')) cat = 'factory';
    else if (msg.includes('推進') || msg.includes('退回') || msg.includes('高塔') || msg.includes('狂暴') || msg.includes('撤出') || msg.includes('復活') || msg.includes('重擊') || msg.includes('擊倒')) cat = 'combat';
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
  sp.style.left = (20 + Math.random() * 60) + '%';
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
  var gemTotal = 0, gemTip = [];
  for (var lv = 1; lv <= GEM_MAX_LEVEL; lv++) {
    gemTotal += p.gems[lv];
    if (p.gems[lv]) gemTip.push(GEM_NAMES[lv] + ' x' + p.gems[lv]);
  }
  $id('r-gems').textContent = fmt(gemTotal);
  $id('r-gems').parentNode.title = gemTip.join('、') || '尚無寶石';
  var bookTotal = 0, bookTip = [];
  for (var bk in p.books) {
    bookTotal += p.books[bk];
    if (p.books[bk]) bookTip.push(ENCHANTS[bk].name + ' x' + p.books[bk]);
  }
  $id('r-books').textContent = fmt(bookTotal);
  $id('r-books').parentNode.title = bookTip.join('、') || '尚無附魔書';

  $id('p-level').textContent = 'Lv.' + p.level;
  var need = xpForLevel(p.level);
  $id('xp-fill').style.width = clamp(p.xp / need * 100, 0, 100) + '%';
  $id('xp-bar').title = '經驗 ' + fmt(p.xp) + ' / ' + fmt(need);

  renderAttrPanel(st);
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
        h += '<div class="stat-row"><span>' + row[0] + '</span><b data-attr="' + gi + '-' + ri + '"></b></div>';
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
      if (el) el.textContent = row[1](st);
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
  if (ent.shield && ent.shield > 0.5) s.push('🫧護盾' + fmt(ent.shield));
  return s.join(' ');
}
// MP 條與技能狀態（prefix: 'pv' 野外 / 'tp' 高塔）
function renderMpSkill(pEnt, prefix) {
  var st = getStats();
  var mpFill = $id(prefix + '-mp'), mpText = $id(prefix + '-mptext'), skillEl = $id(prefix + '-skill');
  if (mpFill) mpFill.style.width = clamp(pEnt.mp / st.mp * 100, 0, 100) + '%';
  if (mpText) mpText.textContent = fmt(Math.floor(pEnt.mp)) + ' / ' + fmt(st.mp);
  if (skillEl) {
    if (pEnt.skillCd > 0) skillEl.textContent = SKILL.emoji + ' ' + SKILL.name + '：冷卻 ' + fmt1(Math.max(0, pEnt.skillCd)) + 's';
    else if (pEnt.mp < SKILL.cost) skillEl.textContent = SKILL.emoji + ' ' + SKILL.name + '：法力不足（需 ' + SKILL.cost + '）';
    else skillEl.textContent = SKILL.emoji + ' ' + SKILL.name + '：蓄勢待發！';
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
  return '<div class="item-cell" data-id="' + it.id + '" data-src="' + source + '" data-slot="' + it.slot + '" ' +
    'style="border-color:' + r.color + ';box-shadow:inset 0 0 12px ' + r.color + '33">' +
    '<span class="ic-emoji">' + SLOT_INFO[it.slot].emoji + '</span>' +
    (it.upgrade ? '<span class="ic-up">+' + it.upgrade + '</span>' : '') +
    (it.enchant ? '<span class="ic-enc">' + ENCHANTS[it.enchant.key].emoji + '</span>' : '') +
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
      h += '<div class="eq-slot filled" data-id="' + it.id + '" data-src="equip" data-slot="' + slot + '" style="border-color:' + r.color + '">' +
        '<div class="eq-emoji">' + info.emoji + '</div>' +
        '<div class="eq-name" style="color:' + r.color + '">' + esc(it.name) + (it.upgrade ? ' +' + it.upgrade : '') + '</div>' +
        '<div class="eq-sub">' + info.name + '・Lv.' + it.level +
        (it.enchant ? ' ' + ENCHANTS[it.enchant.key].emoji : '') + '</div></div>';
    } else {
      h += '<div class="eq-slot empty"><div class="eq-emoji dim">' + info.emoji + '</div>' +
        '<div class="eq-sub">' + info.name + '（未裝備）</div></div>';
    }
  });
  box.innerHTML = h;
  renderDetail();
}

function renderInventory() {
  var box = $id('inventory-grid');
  $id('inv-count').textContent = G.inventory.length + '/' + INVENTORY_CAP;
  if (!G.inventory.length) {
    box.innerHTML = '<div class="hint">背包是空的。戰鬥掉落的裝備會先進入生產線輸送帶，「保留」的會送到這裡。</div>';
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
  var h = itemDetailHTML(it);
  h += '<div class="detail-actions">';
  if (UI.sel.source === 'inv') {
    h += '<button class="btn" data-act="equip">裝備</button>';
    h += '<button class="btn warn" data-act="salvage">分解</button>';
    h += '<button class="btn" data-act="tosynth">送合成區</button>';
  } else {
    h += '<button class="btn" data-act="unequip">卸下</button>';
  }
  h += '<button class="btn" data-act="upgrade">強化（💰' + fmt(cost.gold) + ' 🔩' + fmt(cost.scrap) + '）</button>';
  h += '<button class="btn" data-act="lock">' + (it.locked ? '解鎖' : '鎖定') + '</button>';
  h += '</div>';
  pane.innerHTML = h;
}

function updateSelectionUI() {
  var selItem = findSelItem();
  document.querySelectorAll('.item-cell, .eq-slot').forEach(function (el) {
    el.classList.remove('selected', 'dimmed');
    if (!selItem) return;
    
    var elId = el.getAttribute('data-id');
    if (elId === selItem.id) {
      el.classList.add('selected');
    } else if (el.classList.contains('item-cell')) {
      var elSlot = el.getAttribute('data-slot');
      if (elSlot !== selItem.slot) {
        el.classList.add('dimmed');
      }
    }
  });
}

/* ---- 生產線與合成 ---- */
function detailAction(act) {
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
    if (G.inventory.length >= INVENTORY_CAP) { blog('⚠️ 背包已滿，無法卸下', 'warn'); return; }
    G.equipment[it.slot] = null;
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
    manualUpgrade(it); // 成功/失敗日誌由 manualUpgrade 記錄
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
  $id('enc-enabled').checked = f.enchant.enabled;
  $id('enc-overwrite').checked = f.enchant.overwrite;
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
      h += '<div class="tower-floor' + (cleared ? ' cleared' : '') + (unlocked ? '' : ' locked') + '">' +
        '<span class="tf-emoji">' + bd.emoji + '</span>' +
        '<span class="tf-name">第 ' + fl + ' 層・' + bd.name + (cleared ? ' ✅' : '') + '</span>' +
        '<span class="tf-hint">建議野外階段 ' + (4 + fl * 5) + '+</span>' +
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
  if (d.header) { renderHeader(); d.header = false; }
  renderBattle(); // Battle is always visible
  if (UI.tab === 'tower' && G.tower.active) renderTowerFight();
  d.battle = false;
  if (d.equip && UI.tab === 'equip') { renderEquip(); d.equip = false; }
  if (d.inv && UI.tab === 'equip') { renderInventory(); d.inv = false; }
  if (d.factory && UI.tab === 'factory') { renderFactory(); d.factory = false; }
  if (d.tower && UI.tab === 'tower') { renderTower(); d.tower = false; }
  if (UI.tab === 'settings') { /* No dynamic render for settings */ }
}

/* ---- 事件綁定 ---- */
function initUI() {
  // 分頁
  document.querySelectorAll('.tab-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      switchTab(b.getAttribute('data-tab'));
      UI.dirty.equip = true; UI.dirty.inv = true; UI.dirty.factory = true; UI.dirty.tower = true;
    });
  });

  // 日誌篩選
  var logFilter = $id('log-filter');
  if (logFilter) {
    logFilter.addEventListener('change', function (e) {
      var v = e.target.value;
      var b = $id('battle-log');
      if (b) b.className = 'log' + (v === 'all' ? '' : ' filter-' + v);
    });
  }

  // 階段控制
  $id('st-prev').addEventListener('click', function () { stageGo(-1); });
  $id('st-next').addEventListener('click', function () { stageGo(1); });
  $id('st-auto').addEventListener('change', function () { G.stage.autoAdvance = this.checked; });

  // 裝備 / 背包點擊（事件委派）
  document.addEventListener('click', function (e) {
    var cell = e.target.closest('.item-cell, .eq-slot.filled');
    if (cell) {
      var cid = cell.getAttribute('data-id');
      if (UI.sel && UI.sel.id === cid) {
        UI.sel = null;
      } else {
        UI.sel = { id: cid, source: cell.getAttribute('data-src') };
      }
      renderDetail();
      return;
    }
    var actBtn = e.target.closest('#detail-pane .btn');
    if (actBtn) { detailAction(actBtn.getAttribute('data-act')); return; }
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
  $id('inv-sort').addEventListener('click', function () {
    G.inventory.sort(function (a, b) {
      if (b.rarity !== a.rarity) return b.rarity - a.rarity;
      return a.level - b.level;
    });
    UI.dirty.inv = true;
    blog('🎒 背包已排序完成。', 'info', 'system');
  });
  $id('tw-flee').addEventListener('click', fleeTower);

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
  $id('enc-enabled').addEventListener('change', function () { G.factory.enchant.enabled = this.checked; });
  $id('enc-overwrite').addEventListener('change', function () { G.factory.enchant.overwrite = this.checked; });
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
