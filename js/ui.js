'use strict';
/* ============ UI 渲染與互動 ============ */

var UI = {
  dirty: { header: true, battle: true, equip: true, inv: true, factory: true, newforge: true, forge: true, tower: true, gems: true, skills: true, talents: true },
  sel: null,           // { id, source: 'inv' | 'equip' } 或 { source: 'equip-slot', slot }
  tab: 'equip',
  saveNoticeId: null,
  tooltipAnchor: null,
  affixPoolSource: null,
  towerTimerRaf: 0,
  towerTimerAnchor: null,
  stageHold: { startTimer: null, repeatTimer: null, suppressClick: false, suppressTimer: null, pointerId: null }
};

var STAGE_HOLD_START_MS = 300;
var STAGE_HOLD_REPEAT_MS = 50;

/* ---- 日誌 ---- */
var DETAIL_LOG_HISTORY = [];
var DETAIL_LOG_CAP = 500;
var NEWFORGE_LOG_HISTORY = [];
window.newForgeLogPaused = false;

function detailLogCategoryLabel(cat) {
  return ({ combat: '戰鬥', boss: '高塔', factory: '裝備', loot: '掉落', system: '系統' })[cat] || '其他';
}

function renderDetailLog() {
  var box = $id('detail-log-content');
  if (!box) return;
  var filterEl = $id('detail-log-filter');
  var filter = filterEl ? filterEl.value : 'all';
  var rows = DETAIL_LOG_HISTORY.filter(function (entry) {
    if (filter === 'all') return entry.cat !== 'factory';
    return entry.cat === filter;
  });
  if (!rows.length) {
    box.innerHTML = '<div class="detail-log-empty">目前沒有符合條件的日誌</div>';
    return;
  }
  box.innerHTML = rows.map(function (entry) {
    var label = entry.cat ? '[' + detailLogCategoryLabel(entry.cat) + '] ' : '';
    return '<div class="detail-log-line ' + (entry.cls || '') + '">' +
      '<span class="detail-log-time">' + esc(entry.time) + '</span>' +
      '<span class="detail-log-category">' + esc(label) + '</span>' + entry.msg + '</div>';
  }).join('');
}

/* ---- 熔爐日誌統計狀態與函式 ---- */
var newForgeLogStartTime = null;
var newForgeLogStatsInterval = null;
var newForgeCumulativeStats = {
  logCount: 0,
  scrap: 0,
  essence: 0,
  ancientEssence: 0,
  books: {},
  parts: {}
};

function accumulateNewForgeLog(msg) {
  newForgeCumulativeStats.logCount++;

  var scrapMatch = msg.match(/碎片x(\d+)/);
  if (scrapMatch) newForgeCumulativeStats.scrap += parseInt(scrapMatch[1], 10);

  var essenceMatch = msg.match(/附魔精華x(\d+)/);
  if (essenceMatch) newForgeCumulativeStats.essence += parseInt(essenceMatch[1], 10);

  var ancientMatch = msg.match(/太古精華x(\d+)/);
  if (ancientMatch) newForgeCumulativeStats.ancientEssence += parseInt(ancientMatch[1], 10);

  var bookRegex = /📖([^（）x、，\s\>]+)/g;
  var bookMatch;
  while ((bookMatch = bookRegex.exec(msg)) !== null) {
    var bookName = bookMatch[1];
    newForgeCumulativeStats.books[bookName] = (newForgeCumulativeStats.books[bookName] || 0) + 1;
  }

  var partRegex = /⛏️([^（）x、，\>]+)/g;
  var partMatch;
  while ((partMatch = partRegex.exec(msg)) !== null) {
    var partName = partMatch[1].trim();
    var foundKey = null;
    var nameKeys = Object.keys(PART_TYPES);
    for (var j = 0; j < nameKeys.length; j++) {
      var k = nameKeys[j];
      if (partName.indexOf(PART_TYPES[k].name) === 0) {
        foundKey = k;
        break;
      }
    }
    newForgeCumulativeStats.parts[partName] = {
      count: ((newForgeCumulativeStats.parts[partName] && newForgeCumulativeStats.parts[partName].count) || 0) + 1,
      key: foundKey
    };
  }
}

function resetNewForgeCumulativeStats() {
  newForgeCumulativeStats = {
    logCount: 0,
    scrap: 0,
    essence: 0,
    ancientEssence: 0,
    books: {},
    parts: {}
  };
}

function getNewForgeLogStats() {
  var stats = {
    duration: 0,
    mats: {
      scrap: newForgeCumulativeStats.scrap,
      essence: newForgeCumulativeStats.essence,
      ancientEssence: newForgeCumulativeStats.ancientEssence,
      books: newForgeCumulativeStats.books,
      parts: newForgeCumulativeStats.parts
    }
  };

  if (newForgeLogStartTime && newForgeCumulativeStats.logCount > 0) {
    stats.duration = Math.floor((Date.now() - newForgeLogStartTime) / 1000);
  }
  return stats;
}

function getInstalledPartsStats() {
  var counts = {};
  var nf = typeof newForgeState === 'function' ? newForgeState() : (G && G.newForge);
  if (nf && nf.furnaces) {
    for (var i = 0; i < nf.furnaces.length; i++) {
      var fu = nf.furnaces[i];
      if (fu && fu.parts) {
        for (var j = 0; j < fu.parts.length; j++) {
          var p = fu.parts[j];
          if (p && p.key) {
            counts[p.key] = (counts[p.key] || 0) + 1;
          }
        }
      }
    }
  }
  return counts;
}

function formatDuration(sec) {
  if (sec <= 0) return '0 秒';
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  var str = '';
  if (h > 0) str += h + ' 小時 ';
  if (m > 0 || h > 0) str += m + ' 分 ';
  str += s + ' 秒';
  return str;
}

function renderNewForgeLogStats() {
  var container = $id('newforge-detail-log-stats');
  if (!container) return;

  var stats = getNewForgeLogStats();
  var partCounts = getInstalledPartsStats();

  var html = '';

  // 1. 統計時長
  html += '<div class="stats-sec">';
  html += '  <div class="stats-sec-title">⏳ 統計資訊</div>';
  html += '  <div class="stats-row">';
  html += '    <span>統計時長</span>';
  html += '    <span class="stats-value">' + formatDuration(stats.duration) + '</span>';
  html += '  </div>';
  html += '  <div class="stats-row">';
  html += '    <span>累計日誌筆數</span>';
  html += '    <span class="stats-value">' + newForgeCumulativeStats.logCount + ' 筆</span>';
  html += '  </div>';
  html += '</div>';

  // 2. 當前所有熔爐零件類型裝置數量
  html += '<div class="stats-sec">';
  html += '  <div class="stats-sec-title">🔧 熔爐零件配置 (所有總值)</div>';
  var partKeys = Object.keys(PART_TYPES).filter(function(k) { return PART_TYPES[k].node === 'salvage'; });
  var hasParts = false;
  for (var i = 0; i < partKeys.length; i++) {
    var k = partKeys[i];
    var pt = PART_TYPES[k];
    var count = partCounts[k] || 0;
    if (count > 0) {
      hasParts = true;
      html += '  <div class="stats-row">';
      html += '    <span style="display:flex; align-items:center; gap:4px;">' + partIconHTML(k) + esc(pt.name) + '</span>';
      html += '    <span class="stats-value">x ' + count + '</span>';
      html += '  </div>';
    }
  }
  if (!hasParts) {
    html += '  <div class="hint" style="text-align:center; padding: 8px 0; color: var(--dim)">當前所有熔爐均未安裝零件</div>';
  }
  html += '</div>';

  // 3. 各材料獲得數量
  html += '<div class="stats-sec">';
  html += '  <div class="stats-sec-title">📦 材料獲得統計</div>';
  html += '  <div class="stats-mats-grid">';
  
  html += '    <div class="stats-mat-card">';
  html += '      <span class="stats-mat-name"><img src="images/icon_scrap.png" class="res-icon" alt="">裝備碎片</span>';
  html += '      <span class="stats-mat-val">' + fmt(stats.mats.scrap) + '</span>';
  html += '    </div>';
  
  html += '    <div class="stats-mat-card">';
  html += '      <span class="stats-mat-name"><img src="images/icon_essence.png" class="res-icon" alt="">附魔精華</span>';
  html += '      <span class="stats-mat-val">' + fmt(stats.mats.essence) + '</span>';
  html += '    </div>';
  
  html += '    <div class="stats-mat-card">';
  html += '      <span class="stats-mat-name"><img src="images/icon_ancient_essence.png" class="res-icon" alt="">太古精華</span>';
  html += '      <span class="stats-mat-val">' + fmt(stats.mats.ancientEssence) + '</span>';
  html += '    </div>';

  html += '  </div>';

  var bookNames = Object.keys(stats.mats.books);
  var partNames = Object.keys(stats.mats.parts);
  
  if (bookNames.length > 0 || partNames.length > 0) {
    html += '  <div class="stats-sec-title" style="margin-top: 12px; font-size: 12px;">✨ 額外回收項目</div>';
    
    for (var b = 0; b < bookNames.length; b++) {
      var bn = bookNames[b];
      html += '  <div class="stats-row">';
      html += '    <span style="display:flex; align-items:center; gap:4px;"><img src="images/icon_books.png" class="res-icon" alt="" style="margin-right:2px; width:18px; height:18px;">附魔書：' + esc(bn) + '</span>';
      html += '    <span class="stats-value">x ' + stats.mats.books[bn] + '</span>';
      html += '  </div>';
    }
    
    for (var p = 0; p < partNames.length; p++) {
      var pn = partNames[p];
      var partData = stats.mats.parts[pn];
      var iconHtml = partData.key ? partIconHTML(partData.key) : '';
      html += '  <div class="stats-row">';
      html += '    <span style="display:flex; align-items:center; gap:4px;">' + iconHtml + '零件：' + esc(pn) + '</span>';
      html += '    <span class="stats-value">x ' + partData.count + '</span>';
      html += '  </div>';
    }
  }

  html += '</div>';

  container.innerHTML = html;
}

function renderNewForgeDetailLog() {
  var box = $id('newforge-detail-log-content');
  if (!box) return;
  var rows = NEWFORGE_LOG_HISTORY;
  if (!rows.length) {
    box.innerHTML = '<div class="detail-log-empty">目前沒有熔爐日誌</div>';
  } else {
    box.innerHTML = rows.map(function (entry) {
      return '<div class="detail-log-line ' + (entry.cls || '') + '">' +
        '<span class="detail-log-time">' + esc(entry.time) + '</span>' + entry.msg + '</div>';
    }).join('');
  }
  renderNewForgeLogStats();
}

function refreshNewForgeMainLog() {
  var box = $id('newforge-log');
  if (!box) return;
  box.innerHTML = '';
  var displayLogs = NEWFORGE_LOG_HISTORY.slice(0, 50);
  displayLogs.forEach(function (entry) {
    var div = document.createElement('div');
    div.className = 'log-line ' + (entry.cls || '');
    div.innerHTML = entry.msg;
    box.appendChild(div);
  });
}

function addLog(elId, msg, cls, cap, cat) {
  if (elId === 'newforge-log') {
    var now = new Date();
    if (!newForgeLogStartTime) {
      newForgeLogStartTime = Date.now();
    }
    accumulateNewForgeLog(msg);
    NEWFORGE_LOG_HISTORY.unshift({
      msg: msg,
      cls: cls || '',
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });
    if (NEWFORGE_LOG_HISTORY.length > 250) NEWFORGE_LOG_HISTORY.pop();
    if (window.newForgeLogPaused) return;
  }

  var box = $id(elId);
  if (!box) return;
  var div = document.createElement('div');
  div.className = 'log-line ' + (cls || '');
  if (cat) div.setAttribute('data-cat', cat);
  div.innerHTML = msg;
  box.insertBefore(div, box.firstChild);
  while (box.children.length > (cap || 150)) box.removeChild(box.lastChild);
  if (elId === 'battle-log' || elId === 'boss-log') {
    var now = new Date();
    DETAIL_LOG_HISTORY.unshift({
      msg: msg,
      cls: cls || '',
      cat: cat || 'system',
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });
    if (DETAIL_LOG_HISTORY.length > DETAIL_LOG_CAP) DETAIL_LOG_HISTORY.pop();
    var detailModal = $id('detail-log-modal');
    if (detailModal && detailModal.style && detailModal.style.display !== 'none') renderDetailLog();
  } else if (elId === 'newforge-log') {
    var nfDetailModal = $id('newforge-detail-log-modal');
    if (nfDetailModal && nfDetailModal.style && nfDetailModal.style.display !== 'none') renderNewForgeDetailLog();
  }
}
function blog(msg, cls, cat) {
  if (!cat) {
    if (msg.includes('高塔') || msg.includes('狂暴') || msg.includes('重擊') || msg.includes('撤出')) cat = 'boss';
    else if (msg.includes('📦 戰利品：') || msg.includes('敵人掉落')) cat = 'loot';
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
// 舊生產線頁已併入熔爐頁：flog 統一寫入熔爐紀錄（與 nflog 同一面板）
function flog(msg, cls) { addLog('newforge-log', msg, cls, 50); }

/* ---- 漂浮傷害字 ----
   位置先隨機落點，再依實際文字寬度夾取在戰鬥面板（.combatant）可視範圍內：
   多人戰鬥的小卡片允許數字跨出頭像範圍，但不會超出面板 overflow 邊界被裁切。 */
function isEnemyHitFloat(elId, cls) {
  var isEnemyLayer = elId === 'tb-float' || (elId && elId.indexOf('mv-float') === 0);
  var tokens = (cls || '').split(/\s+/);
  return isEnemyLayer && (tokens.indexOf('dmg') >= 0 || tokens.indexOf('mdmg') >= 0 ||
    tokens.indexOf('crit') >= 0 || tokens.indexOf('skill') >= 0);
}

var FLOAT_TEXT_LIFETIME_MS = 2000;
var ENEMY_DAMAGE_FLOAT_WINDOW_MS = 4000;
var ENEMY_DAMAGE_FLOAT_MAX_HITS = 20;
var PLAYER_RECOVERY_FLOAT_MAX_HITS = 20;

function enemyDamageFloatKey(cls) {
  var tokens = (cls || '').split(/\s+/);
  var source = tokens.indexOf('enemy-skill') >= 0 ? 'skill' :
    (tokens.indexOf('enemy-attack') >= 0 ? 'attack' : '');
  if (!source) return '';
  return source + ':' + (tokens.indexOf('crit') >= 0 ? 'crit' : 'normal');
}

function enemyDamageFloatInfo(text, value) {
  if (typeof value !== 'number' || !isFinite(value) || value <= 0 || typeof fmt !== 'function') return null;
  var formatted = fmt(value);
  var numberAt = text.lastIndexOf(formatted);
  if (numberAt < 0) return null;
  return { prefix: text.slice(0, numberAt) };
}

function playerRecoveryFloatKey(elId, cls) {
  if (elId !== 'pv-float' && elId !== 'tp-float') return '';
  var tokens = (cls || '').split(/\s+/);
  if (tokens.indexOf('heal') >= 0) return 'hp';
  if (tokens.indexOf('mp') >= 0 || tokens.indexOf('mana') >= 0) return 'mp';
  return '';
}

function playerRecoveryFloatInfo(elId, cls, text, value) {
  var key = playerRecoveryFloatKey(elId, cls);
  if (!key || typeof value !== 'number' || !isFinite(value) || value <= 0 || typeof fmt !== 'function') return null;
  var formatted = fmt(value);
  var numberAt = text.lastIndexOf(formatted);
  if (numberAt < 0) return null;
  return { key: key, prefix: text.slice(0, numberAt) };
}

function scheduleFloatTextRemoval(sp, lifetimeMs) {
  if (sp._floatRemovalTimer) clearTimeout(sp._floatRemovalTimer);
  sp._floatRemovalTimer = setTimeout(function () {
    if (sp.parentNode) sp.parentNode.removeChild(sp);
  }, lifetimeMs || FLOAT_TEXT_LIFETIME_MS);
}

function clearFloatLayer(elId) {
  var layer = $id(elId);
  if (!layer) return;
  var floats = layer.querySelectorAll('.float-txt');
  for (var i = 0; i < floats.length; i++) {
    if (floats[i]._floatRemovalTimer) clearTimeout(floats[i]._floatRemovalTimer);
  }
  layer.innerHTML = '';
  layer.removeAttribute('data-last-miss-at');
}

function clearTowerFloatLayers() {
  clearFloatLayer('tp-float');
  clearFloatLayer('tb-float');
}

/* 敵方傷害浮字優先找不與現有文字重疊的位置，真的沒有空間時才接受重疊。 */
function placeFloatAvoidingOverlap(sp, layer, selector, randomTop, randomRange, gridRows, gridStep) {
  var lr = layer.getBoundingClientRect();
  if (!lr.width || !lr.height) return;

  var existingRects = [];
  var existingFloats = layer.querySelectorAll(selector);
  for (var ei = 0; ei < existingFloats.length; ei++) {
    var existing = existingFloats[ei];
    if (existing === sp) continue;
    var opacity = parseFloat(window.getComputedStyle(existing).opacity);
    if (isFinite(opacity) && opacity <= 0.05) continue;
    var existingRect = existing.getBoundingClientRect();
    if (existingRect.width && existingRect.height) existingRects.push(existingRect);
  }

  var oldAnimation = sp.style.animation;
  sp.style.animation = 'none';
  var candidates = [{
    left: 8 + Math.random() * 84,
    top: randomTop + Math.random() * randomRange
  }];
  gridRows = gridRows || 6;
  gridStep = gridStep || 10;
  for (var ci = 0; ci < 48; ci++) {
    var col = ci % 8;
    var row = Math.floor(ci / 8) % gridRows;
    candidates.push({
      left: 10 + col * 11 + (row % 2 ? 3 : 0),
      top: Math.max(10, randomTop - 4) + row * gridStep
    });
  }

  var best = null;
  var bestOverlap = Infinity;
  for (var pi = 0; pi < candidates.length; pi++) {
    var candidate = candidates[pi];
    sp.style.left = candidate.left + '%';
    sp.style.top = candidate.top + '%';
    sp.style.marginTop = '0px';
    var candidateRect = sp.getBoundingClientRect();
    var overlap = 0;
    for (var ri = 0; ri < existingRects.length; ri++) {
      var occupied = existingRects[ri];
      var horizontal = Math.max(0, Math.min(candidateRect.right, occupied.right + 4) -
        Math.max(candidateRect.left, occupied.left - 4));
      var vertical = Math.max(0, Math.min(candidateRect.bottom, occupied.bottom + 4) -
        Math.max(candidateRect.top, occupied.top - 4));
      overlap += horizontal * vertical;
    }
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      best = candidate;
    }
    if (overlap === 0) break;
  }
  if (best) {
    sp.style.left = best.left + '%';
    sp.style.top = best.top + '%';
    sp.style.marginTop = '0px';
  }
  sp.style.animation = oldAnimation;
}

function placeEnemyDamageFloat(sp, layer) {
  placeFloatAvoidingOverlap(sp, layer, '.float-txt.enemy-hit-float', 28, 44);
}

function placePlayerRecoveryFloat(sp, layer) {
  // 回復值只在玩家血條／魔力條附近飄動，不跑到頭像、名稱或狀態列。
  placeFloatAvoidingOverlap(sp, layer, '.float-txt', 48, 18, 3, 8);
}

function floatText(elId, text, cls, damageValue) {
  if (elId === 'tb-float' && text === 'MISS' && cls === 'miss') {
    elId = 'tp-float';
    text = '閃避!';
    cls = 'player-event dodge defend';
  }
  var layer = $id(elId);
  if (!layer || layer.offsetParent === null) return; // 不可見時略過
  if (elId === 'tb-float' && text === 'MISS' && cls && cls.indexOf('enemy-dodge') >= 0) {
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var lastMissAt = parseFloat(layer.getAttribute('data-last-miss-at') || '-9999');
    if (now - lastMissAt < 300) return;
    layer.setAttribute('data-last-miss-at', String(now));
  }
  // 戰鬥中會持續產生傷害/事件浮字；一般浮字的數量上限不能提前刪除
  // 尚未播完的玩家事件（增益、閃避、護盾、格擋等）。玩家事件由自身
  // 的動畫結束清理，避免「只有戰鬥中約 0.5 秒、停戰後才有 2 秒」的差異。
  var isPlayerEvent = (cls || '').split(/\s+/).indexOf('player-event') >= 0;
  if (!isPlayerEvent) {
    var normalFloats = layer.querySelectorAll('.float-txt:not(.player-event)');
    if (normalFloats.length >= 50) {
      normalFloats[0].parentNode.removeChild(normalFloats[0]);
    }
  }
  var enemyHitFloat = isEnemyHitFloat(elId, cls);
  var damageInfo = enemyHitFloat ? enemyDamageFloatInfo(text, damageValue) : null;
  var damageKey = damageInfo ? enemyDamageFloatKey(cls) : '';
  var recoveryInfo = playerRecoveryFloatInfo(elId, cls, text, damageValue);
  var recoveryKey = recoveryInfo ? recoveryInfo.key : '';
  if (damageKey) {
    var damageFloats = layer.querySelectorAll('.float-txt.enemy-hit-float');
    for (var di = damageFloats.length - 1; di >= 0; di--) {
      var existing = damageFloats[di];
      if (existing._damageFloatKey !== damageKey || existing._damageFloatHits >= ENEMY_DAMAGE_FLOAT_MAX_HITS) continue;
      existing._damageFloatTotal += damageValue;
      existing._damageFloatHits++;
      existing.textContent = existing._damageFloatPrefix + fmt(existing._damageFloatTotal);
      scheduleFloatTextRemoval(existing, FLOAT_TEXT_LIFETIME_MS);
      return;
    }
  }
  if (recoveryKey) {
    var recoveryFloats = layer.querySelectorAll('.float-txt.player-recovery-float');
    for (var ri = recoveryFloats.length - 1; ri >= 0; ri--) {
      var recoveryExisting = recoveryFloats[ri];
      if (recoveryExisting._recoveryFloatKey !== recoveryKey || recoveryExisting._recoveryFloatHits >= PLAYER_RECOVERY_FLOAT_MAX_HITS) continue;
      recoveryExisting._recoveryFloatTotal += damageValue;
      recoveryExisting._recoveryFloatHits++;
      recoveryExisting.textContent = recoveryExisting._recoveryFloatPrefix + fmt(recoveryExisting._recoveryFloatTotal);
      scheduleFloatTextRemoval(recoveryExisting, FLOAT_TEXT_LIFETIME_MS);
      return;
    }
  }
  var sp = document.createElement('span');
  sp.className = 'float-txt ' + (cls || '');
  if (enemyHitFloat) sp.className += ' enemy-hit-float';
  sp.textContent = text;
  var pct = enemyHitFloat ? 8 + Math.random() * 84 : 15 + Math.random() * 70;
  sp.style.left = pct + '%';
  if (enemyHitFloat) sp.style.top = (28 + Math.random() * 44) + '%';
  sp.style.marginTop = (enemyHitFloat ? (Math.random() * 24 - 12) : (Math.random() * 30 - 15)) + 'px';
  if (damageKey) {
    sp.className += ' damage-aggregate';
    sp._damageFloatKey = damageKey;
    sp._damageFloatTotal = damageValue;
    sp._damageFloatHits = 1;
    sp._damageFloatPrefix = damageInfo.prefix;
  }
  if (recoveryKey) {
    sp.className += ' player-recovery-float player-recovery-aggregate';
    sp._recoveryFloatKey = recoveryKey;
    sp._recoveryFloatTotal = damageValue;
    sp._recoveryFloatHits = 1;
    sp._recoveryFloatPrefix = recoveryInfo.prefix;
  }
  layer.appendChild(sp);
  if (enemyHitFloat) placeEnemyDamageFloat(sp, layer);
  if (recoveryKey) placePlayerRecoveryFloat(sp, layer);
  var panel = layer.closest('.combatant');
  // 敵方傷害浮字允許超出敵方框線；玩家事件與其他浮字仍維持在面板範圍內。
  if (panel && !enemyHitFloat) {
    var lr = layer.getBoundingClientRect();
    if (lr.width > 0) {
      var pr = panel.getBoundingClientRect();
      // overflow:hidden 以 padding box 裁切：面板可視範圍 = 邊框內側
      var clipLeft = pr.left + panel.clientLeft;
      var clipRight = clipLeft + panel.clientWidth;
      var w = sp.offsetWidth;
      var centerX = lr.left + lr.width * pct / 100;
      var minC = clipLeft + w / 2 + 1;
      var maxC = clipRight - w / 2 - 1;
      if (maxC < minC) { minC = maxC = (clipLeft + clipRight) / 2; } // 面板比字窄時置中
      var clamped = Math.min(maxC, Math.max(minC, centerX));
      if (Math.abs(clamped - centerX) > 0.5) {
        sp.style.left = ((clamped - lr.left) / lr.width * 100) + '%';
      }
    }
  }
  scheduleFloatTextRemoval(sp, FLOAT_TEXT_LIFETIME_MS);
}

/* ---- 分頁 ---- */
function switchTab(name) {
  if (name === 'talents' && typeof talentSystemUnlocked === 'function' && !talentSystemUnlocked()) name = 'equip';
  UI.tab = name;
  document.querySelectorAll('.tab-btn').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-tab') === name);
  });
  document.querySelectorAll('.tab').forEach(function (s) {
    s.classList.toggle('active', s.id === 'tab-' + name);
  });
  if (name !== 'settings') UI.saveNoticeId = null;
  // 熔爐改版公告：玩家切到熔爐分頁後停止頁籤閃爍
  if (name === 'newforge' && window.G && G.newForge && G.newForge.tabSeen === false) {
    G.newForge.tabSeen = true;
    updateForgeTabGlow();
  }
  if (name === 'settings') {
    if (typeof scanManualMetadataV2 === 'function' && typeof _saveDir !== 'undefined' && _saveDir) {
      scanManualMetadataV2().then(function () {
        renderSaveList();
        refreshSaveFolderFilesV2();
      }).catch(function () {
        renderSaveList();
        refreshSaveFolderFilesV2();
      });
    } else {
      renderSaveList();
      refreshSaveFolderFilesV2();
    }
  }
  if (name === 'tower') UI._scrollTower = true;
}

/* ---- 熔爐改版公告：頁籤閃爍＋一次性彈窗（合併版遷移，migrateSave 設旗標） ---- */
function updateForgeTabGlow() {
  var btn = document.querySelector('.tab-btn[data-tab="newforge"]');
  if (!btn) return;
  btn.classList.toggle('nf-glow', !!(window.G && G.newForge && G.newForge.tabSeen === false));
}
function showForgeRebuildNotice() {
  if (!window.G || !G.newForge || G.newForge.noticeShown !== false) return;
  var modal = $id('forge-rebuild-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  updateForgeTabGlow();
}

function updateTalentTabVisibility() {
  var btn = document.querySelector('.tab-btn[data-tab="talents"]');
  if (!btn) return;
  var unlocked = typeof talentSystemUnlocked !== 'function' || talentSystemUnlocked();
  btn.style.display = unlocked ? '' : 'none';
  btn.setAttribute('aria-hidden', unlocked ? 'false' : 'true');
  if (!unlocked && UI.tab === 'talents') switchTab('equip');
}

/* ---- 存檔記錄列表（設定分頁） ---- */
function saveTimeStr(ts) {
  var t = new Date(ts);
  return t.getFullYear() + '/' + pad2(t.getMonth() + 1) + '/' + pad2(t.getDate()) + ' ' +
    pad2(t.getHours()) + ':' + pad2(t.getMinutes()) + ':' + pad2(t.getSeconds());
}

function saveFileSizeStr(size) {
  if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
  if (size >= 1024) return Math.round(size / 1024) + ' KB';
  return size + ' B';
}

function renderSaveFolderFilesV2(files) {
  var box = $id('save-folder-files');
  var listBox = $id('save-folder-files-list');
  if (!box || !listBox) return;
  box.hidden = false;
  if (!files || !files.length) {
    listBox.innerHTML = '<div class="hint">目前資料夾沒有檔案。</div>';
    return;
  }
  listBox.innerHTML = files.map(function (f) {
    return '<div class="save-folder-file-row"><span class="save-folder-file-name" title="' + esc(f.name) + '">' + esc(f.name) +
      '</span><span class="save-folder-file-size">' + saveFileSizeStr(f.size) + '</span><span class="save-folder-file-time">' + saveTimeStr(f.lastModified) + '</span></div>';
  }).join('');
}

function refreshSaveFolderFilesV2(files) {
  if (files) { renderSaveFolderFilesV2(files); return; }
  var box = $id('save-folder-files');
  if (!box) return;
  if (typeof listSaveFolderFilesV2 !== 'function' || typeof _saveDir === 'undefined' || !_saveDir) {
    box.hidden = true;
    return;
  }
  listSaveFolderFilesV2().then(renderSaveFolderFilesV2).catch(function () { box.hidden = true; });
}

function renderSaveList() {
  var box = $id('save-list');
  if (!box) return;
  var curRun = (G && G.runId) || 1;
  var auto = (typeof autoSaveMetaV2 === 'function') ? autoSaveMetaV2() : {
    id: 'auto_current', kind: 'auto', runId: curRun, savedAt: G.savedAt || Date.now(),
    fname: 'IC_autosave.json', level: G.player.level, stage: G.stage.current, zone: G.stage.zone
  };
  var list = [auto].concat(saveIndex().slice().sort(function (a, b) { return b.savedAt - a.savedAt; }).slice(0, 10));
  box.innerHTML = list.map(function (r) {
    var cur = r.kind === 'auto' && r.runId === curRun;
    var newNotice = UI.saveNoticeId === r.id ? '<div class="save-new-notice">✅ 已新增存檔！</div>' : '';
    return '<div class="save-row' + (r.kind === 'auto' ? ' auto' : '') + '">' +
      '<div class="save-info">' +
      '<div class="save-name">' + saveRecName(r) + (cur ? ' <span class="save-cur">目前遊戲</span>' : '') + '</div>' +
      '<div class="save-file">' + esc(r.fname) + '　<span class="save-time">' + saveTimeStr(r.savedAt) + '</span></div>' +
      '<div class="save-meta">Lv.' + r.level + '｜' + (ZONES[r.zone] ? ZONES[r.zone].emoji + ZONES[r.zone].name : '') + ' 第 ' + r.stage + ' 階｜第 ' + (r.runId || 1) + ' 局</div>' +
      newNotice +
      '</div>' +
      '<div style="display:flex; gap:8px;">' +
      '<button class="btn sm" data-load-save="' + r.id + '">📥 讀取</button>' +
      '<button class="btn sm" style="color:var(--danger, #f87171); border-color:var(--danger, #f87171);" data-del-save="' + r.id + '">🗑️ 刪除</button>' +
      '</div>' +
      '</div>';
  }).join('');
}

/* ---- 頂部資源 / 屬性 ---- */
function applyReincarnationTitleClass(el, count) {
  if (!el) return;
  for (var i = 0; i <= REINCARNATION_MAX; i++) el.classList.remove('reinc-title-' + i);
  var c = Math.max(0, Math.min(Number(count) || 0, REINCARNATION_MAX));
  el.classList.add('reinc-title-' + c);
}

function renderHeader() {
  var p = G.player, st = getStats();
  updateTalentTabVisibility();
  function updateResourceTip(id, title, desc) {
    var valueEl = $id(id);
    if (!valueEl || !valueEl.parentNode) return;
    valueEl.parentNode.setAttribute('data-tt-title', title);
    valueEl.parentNode.setAttribute('data-tt-desc', desc);
    valueEl.parentNode.removeAttribute('title');
  }
  updateResourceTip('r-gold', '金幣', '目前持有：' + fmtFull(p.gold));
  updateResourceTip('r-scrap', '裝備碎片', '目前持有：' + fmtFull(p.scrap));
  updateResourceTip('r-essence', '附魔精華', '目前持有：' + fmtFull(p.essence));
  updateResourceTip('r-dust', '魔塵', '神鑄材料，可提升鑄造成功率。｜目前持有：' + fmtFull(p.dust || 0));
  updateResourceTip('r-ancient-essence', '太古精華', '洗煉時依裝備品質消耗（品質越高消耗越多）；每個詞條有 ' + ANCIENT_REROLL_CHANCE + '% 機率成為太古詞條。｜目前持有：' + fmtFull(p.ancientEssence || 0));
  updateResourceTip('r-soul-origin', '魔魂本源', '用於本源覺醒的道具。｜目前持有：' + fmtFull(p.soulOrigin || 0));
  $id('r-gold').textContent = fmt(p.gold);
  $id('r-scrap').textContent = fmt(p.scrap);
  $id('r-essence').textContent = fmt(p.essence);
  if ($id('r-dust')) $id('r-dust').textContent = fmt(p.dust || 0);
  if ($id('r-ancient-essence')) $id('r-ancient-essence').textContent = fmt(p.ancientEssence || 0);
  if ($id('r-soul-origin')) $id('r-soul-origin').textContent = fmt(p.soulOrigin || 0);
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
  updateResourceTip('r-gems', '寶石', gemTip.join('、') || '尚無寶石');
  var bookTotal = 0, bookTip = [];
  for (var bk in p.books) {
    bookTotal += p.books[bk];
    if (p.books[bk]) bookTip.push(ENCHANTS[bk].name + ' x' + p.books[bk]);
  }
  $id('r-books').textContent = fmt(bookTotal);
  updateResourceTip('r-books', '附魔書', bookTip.join('、') || '尚無附魔書');
  refreshOpenResourceTooltip();

  $id('toggle-compare').checked = !!G.settings.compareEq;
  var ancientToggle = $id('toggle-ancient-essence');
  if (ancientToggle) ancientToggle.checked = !!G.settings.useAncientEssence;
  $id('p-level').textContent = 'Lv.' + p.level;
  if ($id('pv-level')) $id('pv-level').textContent = 'Lv.' + p.level;
  if ($id('tp-level')) $id('tp-level').textContent = 'Lv.' + p.level;
  var reinc = reincarnationCount();
  var rank = reincarnationRankName(reinc);
  var classEl = $id('p-class');
  if (classEl) { classEl.textContent = rank; applyReincarnationTitleClass(classEl, reinc); }
  if ($id('p-reincarnation')) $id('p-reincarnation').textContent = '轉生：' + reinc + '/' + REINCARNATION_MAX;
  var pvName = $id('pv-name');
  var tpName = $id('tp-name');
  if (pvName) { pvName.textContent = rank + '（你）'; applyReincarnationTitleClass(pvName, reinc); }
  if (tpName) { tpName.textContent = rank + '（你）'; applyReincarnationTitleClass(tpName, reinc); }
  var reincBtn = $id('btn-reincarnate');
  if (reincBtn) {
    var canReincarnate = p.level >= REINCARNATION_LEVEL && reinc < REINCARNATION_MAX;
    reincBtn.classList.toggle('reincarnate-ready', canReincarnate);
    reincBtn.setAttribute('data-tip', reinc >= REINCARNATION_MAX
      ? '已達最高 ' + REINCARNATION_MAX + ' 轉'
      : (canReincarnate ? '目前可進行轉生' : '等級達到 ' + REINCARNATION_LEVEL + ' 級可使用'));
    reincBtn.removeAttribute('title');
  }
  var need = xpForLevel(p.level);
  $id('xp-fill').style.width = clamp(p.xp / need * 100, 0, 100) + '%';
  var xpBar = $id('xp-bar');
  xpBar.setAttribute('data-tt-title', '角色經驗');
  xpBar.setAttribute('data-tt-desc', '當前經驗值：' + fmt(p.xp) + ' / 升級經驗值：' + fmt(need));
  xpBar.removeAttribute('title');

  // 屬性面板顯示「檢視中」裝備套的預覽屬性（切頁即變，不需確定切換）；header 其他區塊維持穿著中數值
  renderAttrPanel(typeof getViewStats === 'function' ? getViewStats() : st);

  // 更新側欄硬編碼的屬性
  if ($id('s-hp')) {
    $id('s-hp').textContent = fmt(st.hp);
    $id('s-atk').textContent = fmt(st.atk);
    $id('s-def').textContent = fmt(st.def);
    $id('s-aspd').textContent = fmt1(st.aspd);
    $id('s-crit').textContent = (st.critRate * 100).toFixed(1) + '%';
    $id('s-ls').textContent = (st.lifesteal * 100).toFixed(1) + '%';
    $id('s-hit').textContent = (st.hit * 100).toFixed(1) + '%';
    $id('s-loot').textContent = (st.loot * 100).toFixed(1) + '%';
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
    var h = '<div id="attr-preview-note" class="attr-preview-note" hidden></div>';
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
      '<div class="stat-row" data-tt-title="實時 DPS" data-tt-desc="近 10 秒的平均每秒傷害"><span>📈 實時 DPS</span><b id="s-dps">0</b></div>' +
      '<div id="active-buffs" class="active-buffs"></div>';
    panel.innerHTML = h;
    _attrPanelBuilt = true;
  }
  // 預覽提示：檢視非穿著中的裝備套時，標明面板為該套的預覽屬性
  var previewNote = $id('attr-preview-note');
  if (previewNote) {
    var previewing = typeof isViewingActiveSet === 'function' && !isViewingActiveSet();
    previewNote.hidden = !previewing;
    if (previewing) {
      previewNote.textContent = '👁 屬性預覽：' +
        (typeof equipSetLabel === 'function' ? equipSetLabel(G.equipView) : '檢視中裝備套') +
        '（尚未穿上，戰鬥仍用' + (typeof equipSetLabel === 'function' ? equipSetLabel(G.equipActive) : '穿著中那套') + '）';
    }
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
  var activeBuffsEl = $id('active-buffs');
  if (activeBuffsEl) activeBuffsEl.innerHTML = activeBuffsHtml();
}

var BUFF_TIP_EMOJI = {
  atkUp: '⚔️',
  defUp: '🛡️',
  aspdUp: '⚡',
  evasionUp: '🌀',
  critDmgUp: '💥',
  blockUp: '🔰',
  thornsUp: '🌵',
  lootUp: '🎁',
  hot: '💚',
  atkDown: '⚔️',
  defDown: '🛡️'
};

function currentCombatPlayerEntity() {
  if (typeof G !== 'undefined' && G.tower && G.tower.active && typeof TOWER !== 'undefined' && TOWER.player) return TOWER.player;
  return (typeof FIELD !== 'undefined' && FIELD) ? FIELD.player : null;
}

function buffSignedValueHtml(val, colorVar) {
  var n = Number(val) || 0;
  var text = (n >= 0 ? '+' : '') + fmt1(n) + '%';
  if (!colorVar || colorVar === 'var(--good)') return '<span class="buff-val" style="color:var(--good)">' + text + '</span>';
  return '<span class="buff-val" style="color:' + colorVar + '">' + text + '</span>';
}

function buffRemainHtml(remain) {
  return '<span class="buff-remain">' + Math.max(0, Math.ceil(remain || 0)) + 's</span>';
}

function activeBuffsHtml() {
  var buffs = activePlayerBuffs(currentCombatPlayerEntity());
  var h = '<div class="active-buffs-title">目前技能增益</div>';
  if (!buffs.length) return h + '<div class="active-buffs-empty">無</div>';
  for (var i = 0; i < buffs.length; i++) {
    var b = buffs[i];
    var label = buffLabel(b.key);
    h += '<div class="active-buff-row"><span class="active-buff-main">' +
      (BUFF_TIP_EMOJI[b.key] || '💪') + ' ' + esc(label) + '</span><span class="active-buff-side">' +
      buffSignedValueHtml(b.val) + ' ' + buffRemainHtml(b.remain) + '</span></div>';
  }
  return h;
}

function buffTooltipDesc() {
  var buffs = activePlayerBuffs(currentCombatPlayerEntity());
  if (!buffs.length) return '<span class="dim-text">目前沒有技能增益</span>';
  var rows = [];
  for (var i = 0; i < buffs.length; i++) {
    var b = buffs[i];
    rows.push('<div class="buff-tip-row"><span>' + (BUFF_TIP_EMOJI[b.key] || '💪') + ' ' +
      esc(buffLabel(b.key)) + '</span><span>' + buffSignedValueHtml(b.val) + ' ' +
      buffRemainHtml(b.remain) + '</span></div>');
  }
  return rows.join('');
}

function currentCombatEnemyEntity(anchorEl) {
  if (typeof G !== 'undefined' && G.tower && G.tower.active && typeof TOWER !== 'undefined' && TOWER.boss) return TOWER.boss;
  var enemies = [];
  if (typeof visibleFieldEnemies === 'function') enemies = visibleFieldEnemies();
  else if (typeof liveFieldEnemies === 'function') enemies = liveFieldEnemies();
  else if (typeof fieldEnemyList === 'function') {
    enemies = fieldEnemyList().filter(function (enemy) { return enemy && enemy.hp > 0; });
  } else if (typeof FIELD !== 'undefined' && FIELD && FIELD.monster && FIELD.monster.hp > 0) {
    enemies = [FIELD.monster];
  }
  var idx = NaN;
  if (anchorEl && anchorEl.getAttribute) idx = parseInt(anchorEl.getAttribute('data-enemy-index'), 10);
  if (isNaN(idx) && anchorEl && anchorEl.closest) {
    var card = anchorEl.closest('.enemy-card');
    if (card && card.parentNode) {
      var cards = Array.prototype.slice.call(card.parentNode.querySelectorAll('.enemy-card'));
      idx = cards.indexOf(card);
    }
  }
  if (!isNaN(idx) && enemies[idx]) return enemies[idx];
  return enemies[0] || null;
}

function combatStatusRemain(until) {
  return Math.max(0, Math.ceil((until || 0) - GT));
}

function combatStatusRow(icon, label, valueHtml, remain) {
  return '<div class="buff-tip-row"><span>' + icon + ' ' + esc(label) + '</span><span>' +
    (valueHtml || '') + (remain ? ' ' + buffRemainHtml(remain) : '') + '</span></div>';
}

function enemyBuffTooltipDesc(anchorEl) {
  var ent = currentCombatEnemyEntity(anchorEl);
  if (!ent) return '<span class="dim-text">目前沒有狀態</span>';
  var rows = [];
  if (ent.effects && effectActive(ent, 'stun')) rows.push(combatStatusRow('😵', '暈眩', '', combatStatusRemain(ent.effects.stun)));
  if (ent.effects && effectActive(ent, 'slow')) rows.push(combatStatusRow('🐌', '減速', '', combatStatusRemain(ent.effects.slow)));
  if (poisonActive(ent)) rows.push(combatStatusRow('☠️', '中毒', '', combatStatusRemain(ent.poisonUntil)));
  if (ent.dots) {
    for (var i = 0; i < ent.dots.length; i++) {
      var dot = ent.dots[i];
      if (dot && dot.until > GT) rows.push(combatStatusRow('🩸', dot.name || '持續傷害', '', combatStatusRemain(dot.until)));
    }
  }
  var keys = activeBuffKeys(ent);
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    var buff = ent.buffs && ent.buffs[key];
    if (!buff || buff.until <= GT) continue;
    var down = key === 'atkDown' || key === 'defDown';
    rows.push(combatStatusRow(BUFF_TIP_EMOJI[key] || (down ? '📉' : '💪'), buffLabel(key) + (down ? '↓' : '↑'),
      buffSignedValueHtml(buff.val, down ? 'var(--danger)' : 'var(--good)'), combatStatusRemain(buff.until)));
  }
  return rows.length ? rows.join('') : '<span class="dim-text">目前沒有狀態</span>';
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
      var lv = skillLevel(lo[i]);
      arr.push({ sk: sk, lv: lv, cd: cd, cost: skillManaCost(sk, lv) });
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
function refreshStageDisplay() {
  if (!G || !G.stage) return;
  var stg = G.stage;
  var znd = currentZoneDef();
  var label = $id('stage-label');
  var best = $id('stage-best');
  var auto = $id('st-auto');
  if (label) label.textContent = znd.emoji + ' 第 ' + stg.current + ' 階段';
  if (best) best.textContent = '最高' + stg.best + '關';
  if (auto) auto.checked = stg.autoAdvance;
}
function refreshCombatPauseButton() {
  var btn = $id('btn-combat-pause');
  var detailBtn = $id('btn-detail-combat-pause');
  var paused = typeof isCombatPaused === 'function' && isCombatPaused();
  [btn, detailBtn].forEach(function (el) {
    if (!el) return;
    el.setAttribute('aria-pressed', paused ? 'true' : 'false');
    el.textContent = paused ? '▶ 繼續戰鬥' : '⏸ 暫停戰鬥';
    el.setAttribute('data-tt-title', '戰鬥控制');
    el.setAttribute('data-tt-desc', paused ? '繼續野外與高塔戰鬥' : '暫停野外與高塔戰鬥');
    el.classList.toggle('active', paused);
  });
}
function currentShieldSkillCap(stats) {
  if (!stats || !(stats.hp > 0)) return 0;
  var cap = stats.hp * 20;
  if (typeof G === 'undefined' || !G.player || !Array.isArray(G.player.loadout)) return cap;
  if (typeof mergedSkillFx !== 'function' || typeof scaleAt !== 'function') return cap;
  for (var i = 0; i < G.player.loadout.length; i++) {
    var id = G.player.loadout[i];
    var lv = (G.player.skills && G.player.skills[id]) || 0;
    if (!id || lv <= 0) continue;
    var fx = mergedSkillFx(id);
    if (!fx || !fx.shieldPctMax) continue;
    var pct = scaleAt(fx.shieldPctMax, lv) * (1 + (stats.shieldEff || 0) / 100);
    cap = Math.max(cap, stats.hp * (1 + pct / 100));
  }
  return cap;
}
function playerShieldMax(entity, stats) {
  if (!entity) return 0;
  var shield = Math.max(0, entity.shield || 0);
  if (shield <= 0) return 0;
  var version = (typeof SHIELD_MAX_VERSION === 'number') ? SHIELD_MAX_VERSION : 2;
  if (entity.shieldMaxVersion !== version) {
    var cap = currentShieldSkillCap(stats);
    if (cap > 0 && shield > cap) {
      entity.shield = cap;
      shield = cap;
    }
    entity.shieldMax = shield;
    entity.shieldMaxVersion = version;
    entity.shieldSkillBase = 0;
    entity.shieldSkillPct = 0;
    return shield;
  }
  var shieldMax = Math.max(0, entity.shieldMax || 0);
  if (!(shieldMax > 0) || shieldMax < shield) {
    entity.shieldMax = shield;
    entity.shieldMaxVersion = version;
    return shield;
  }
  return shieldMax;
}
function renderPlayerShieldBar(prefix, entity, stats) {
  var shieldBar = $id(prefix + '-shield');
  if (!shieldBar || !entity || !stats) return;
  var shield = Math.max(0, entity.shield || 0);
  var shieldMax = playerShieldMax(entity, stats);
  if (shield > 0.5 && shieldMax > 0) {
    shieldBar.style.display = 'block';
    shieldBar.style.width = clamp(shield / shieldMax * 100, 0, 100) + '%';
  } else {
    shieldBar.style.display = 'none';
    shieldBar.style.width = '0%';
  }
}
function playerShieldText(entity) {
  var shield = entity ? Math.max(0, entity.shield || 0) : 0;
  return shield > 0.5 ? '<span style="color:var(--info)">+' + fmt(shield) + '</span>' : '';
}

// 多敵人時名稱維持單行，寬度不足就縮小字體，不使用省略號截斷。
function fitEnemyNames(party) {
  if (!party) return;
  var names = party.querySelectorAll('.enemy-name');
  for (var ni = 0; ni < names.length; ni++) {
    var nameEl = names[ni];
    var card = nameEl.closest ? nameEl.closest('.enemy-card') : null;
    if (!card) continue;
    nameEl.style.fontSize = '';
    var available = Math.max(1, card.clientWidth - 6);
    var baseSize = parseFloat(window.getComputedStyle(nameEl).fontSize) || 10;
    var naturalWidth = nameEl.scrollWidth;
    if (naturalWidth > available) {
      nameEl.style.fontSize = Math.max(6, baseSize * available / naturalWidth) + 'px';
    }
  }
}

function renderBattle() {
  var st = getStats();
  renderZoneBar();
  refreshStageDisplay();
  refreshCombatPauseButton();

  var p = FIELD.player;
  if (p) {
    var php = clamp(p.hp / st.hp * 100, 0, 100);
    $id('pv-hp').style.width = php + '%';
    renderPlayerShieldBar('pv', p, st);
    $id('pv-hptext').innerHTML = fmt(Math.max(0, p.hp)) + playerShieldText(p) + ' / ' + fmt(st.hp);
    $id('pv-status').textContent = FIELD.reviveCd > 0 ? ('💀 復活中 ' + fmt1(FIELD.reviveCd) + 's') : entStatus(p);
    renderMpSkill(p, 'pv');
  }
  // 與戰鬥引擎共用敵人集合，避免相容欄位仍有目標時畫面誤判為空。
  var enemies = (typeof visibleFieldEnemies === 'function')
    ? visibleFieldEnemies()
    : (typeof fieldEnemyList === 'function' ? fieldEnemyList() : (FIELD.monster ? [FIELD.monster] : []))
      .filter(function (enemy) { return enemy && enemy.hp > 0; });
  var party = $id('mv-party');
  if (!party) return;
  var scene = party.closest ? party.closest('.battle-scene') : null;
  if (scene) scene.classList.toggle('multi-enemy', enemies.length > 1);
  if (scene) scene.classList.toggle('multi-enemy-layout', enemies.length > 2); // 3 隻以上才左移我方、加寬敵方
  party.className = 'enemy-party enemy-count-' + enemies.length;
  if (!enemies.length) {
    if (party.getAttribute('data-enemy-signature') !== 'empty') {
      party.innerHTML = '<div class="enemy-empty">' + (G.tower.active ? '（高塔戰鬥中…）' : '🔍 搜索敵人中…') + '</div>';
      party.setAttribute('data-enemy-signature', 'empty');
    }
    return;
  }
  var enemySignature = enemies.map(function (enemy, index) {
    return index + ':' + enemy.name + ':' + enemy.level;
  }).join('|');
  var partyHtml = '';
  for (var ei = 0; ei < enemies.length; ei++) {
    var enemy = enemies[ei];
    var icon = (enemy.img && !enemy.imgFailed)
      ? '<img src="images/' + enemy.img + '" class="cb-icon monster" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline\';">' +
      '<span class="enemy-emoji-fallback" style="display:none;">' + (enemy.emoji || '👾') + '</span>'
      : '<span class="enemy-emoji-fallback">' + (enemy.emoji || '👾') + '</span>';
    var enemyHp = clamp(enemy.hp / enemy.maxHp * 100, 0, 100);
    var enemyShield = enemy.shield > 0.5 ? '<span class="enemy-shield">+' + fmt(Math.max(0, enemy.shield)) + '</span>' : '';
    partyHtml += '<div class="enemy-card' + (enemy.elite ? ' elite' : '') + '">' +
      '<div class="float-layer" id="mv-float-' + ei + '"></div>' +
      '<div class="cb-level">Lv.' + enemy.level + '</div>' + icon +
      '<div class="enemy-name">' + (enemy.attr && ELEM_INFO[enemy.attr] ? ELEM_INFO[enemy.attr].emoji : '') + enemy.name + '</div>' +
      '<div class="enemy-hp hp-bar"><div class="hp-fill monster" style="width:' + enemyHp + '%"></div><span class="hp-text">' + fmt(Math.max(0, enemy.hp)) + enemyShield + ' / ' + fmt(enemy.maxHp) + '</span></div>' +
      '<div class="enemy-status" data-enemy-buff-tip data-enemy-index="' + ei + '">' + entStatus(enemy) + '</div></div>';
  }
  // 只有換波、敵人數量或敵人身分變化時才重建 DOM；避免刪除尚未播完的傷害浮字。
  if (party.getAttribute('data-enemy-signature') !== enemySignature) {
    party.innerHTML = partyHtml;
    party.setAttribute('data-enemy-signature', enemySignature);
  }
  fitEnemyNames(party);
  var cards = party.querySelectorAll('.enemy-card');
  for (var ci = 0; ci < cards.length && ci < enemies.length; ci++) {
    var card = cards[ci];
    var liveEnemy = enemies[ci];
    var fill = card.querySelector('.enemy-hp .hp-fill');
    var hpText = card.querySelector('.enemy-hp .hp-text');
    var status = card.querySelector('.enemy-status');
    if (fill) fill.style.width = clamp(liveEnemy.hp / liveEnemy.maxHp * 100, 0, 100) + '%';
    if (hpText) hpText.innerHTML = fmt(Math.max(0, liveEnemy.hp)) + (liveEnemy.shield > 0.5 ? '<span class="enemy-shield">+' + fmt(Math.max(0, liveEnemy.shield)) + '</span>' : '') + ' / ' + fmt(liveEnemy.maxHp);
    if (status) {
      status.setAttribute('data-enemy-index', String(ci));
      status.innerHTML = entStatus(liveEnemy);
    }
    // 死亡清除延遲期間：頭像與血條在 FIELD_ENEMY_DEATH_CLEAR_DELAY 秒內由不透明線性淡出至約 10%
    var deathDelay = (typeof FIELD_ENEMY_DEATH_CLEAR_DELAY === 'number' && FIELD_ENEMY_DEATH_CLEAR_DELAY > 0) ? FIELD_ENEMY_DEATH_CLEAR_DELAY : 1;
    var fadeOpacity = (liveEnemy.hp <= 0)
      ? (0.1 + 0.9 * clamp((liveEnemy._deathClearCd || 0) / deathDelay, 0, 1))
      : 1;
    var fadeEls = card.querySelectorAll('.cb-icon, .enemy-emoji-fallback, .enemy-hp');
    for (var di = 0; di < fadeEls.length; di++) fadeEls[di].style.opacity = (fadeOpacity < 1 ? String(fadeOpacity) : '');
  }
}

/* ---- 裝備分頁 ---- */
function ancientStarBadgeHTML(it) {
  var count = (it && Array.isArray(it.affixes))
    ? it.affixes.filter(function (a) { return a && a.ancient; }).length
    : 0;
  if (!count) return '';
  var shown = Math.min(7, count);
  var stars = '';
  for (var i = 0; i < shown; i++) stars += '<span class="ancient-star">✡</span>';
  var overlapClass = shown > 4 ? ' overlap' : '';
  return '<span class="ancient-star-badge' + overlapClass + '" aria-label="太古詞條 ' + count + ' 條">' + stars + '</span>';
}
function itemCellHTML(it, source, extraClass) {
  var r = RARITIES[it.rarity];
  var effClass = (it.rarity === 6) ? ' eff-mythic' : (it.rarity >= GODFORGED_IDX ? ' eff-godforged' : (it.rarity === 7 ? ' eff-genesis' : ''));
  var info = SLOT_INFO[it.slot];
  var iconHtml = info.icon ? '<img src="images/' + info.icon + '" class="item-icon">' : '<span class="ic-emoji">' + info.emoji + '</span>';
  return '<div class="item-cell' + effClass + (extraClass || '') + '" data-id="' + it.id + '" data-src="' + source + '" data-slot="' + it.slot + '" ' +
    'style="border-color:' + r.color + ';box-shadow:inset 0 0 12px ' + r.color + '33">' +
    iconHtml +
    ancientStarBadgeHTML(it) +
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
  var eq = (typeof viewedEquipment === 'function') ? viewedEquipment() : G.equipment; // 面板顯示「檢視中」那套
  SLOT_LIST.forEach(function (slot) {
    var it = eq[slot];
    var info = SLOT_INFO[slot];
    if (it) {
      var r = RARITIES[it.rarity];
      var effClass = (it.rarity === 6) ? ' eff-mythic' : (it.rarity >= GODFORGED_IDX ? ' eff-godforged' : (it.rarity === 7 ? ' eff-genesis' : ''));
      var iconHtml = info.icon ? '<img src="images/' + info.icon + '" class="eq-icon">' : '<div class="eq-emoji">' + info.emoji + '</div>';
      h += '<div class="eq-slot filled' + effClass + ' slot-' + slot + '" data-id="' + it.id + '" data-src="equip" data-slot="' + slot + '" style="border-color:' + r.color + '; box-shadow: inset 0 0 15px ' + r.color + '40">' +
        iconHtml + ancientStarBadgeHTML(it) + '</div>';
    } else {
      var iconHtml = info.icon ? '<img src="images/' + info.icon + '" class="eq-icon dim">' : '<div class="eq-emoji dim">' + info.emoji + '</div>';
      h += '<div class="eq-slot empty slot-' + slot + '" data-slot="' + slot + '">' + iconHtml + '</div>';
    }
  });
  box.innerHTML = h;
  renderEquipSetTabs();
  renderDetail();
}

// 裝備欄下方三套切頁＋確定切換
function renderEquipSetTabs() {
  var box = $id('equip-set-tabs');
  if (!box) return;
  if (!Array.isArray(G.equipmentSets)) { box.innerHTML = ''; return; }
  var active = G.equipActive || 0;
  var view = (typeof G.equipView === 'number') ? G.equipView : active;
  var h = '<div class="eqset-tabrow">';
  for (var i = 0; i < G.equipmentSets.length; i++) {
    var cls = 'eqset-tab' + (i === view ? ' viewing' : '') + (i === active ? ' active' : '');
    var defName = (typeof equipSetName === 'function') ? equipSetName(i) : ('第' + (i + 1) + '套');
    var custom = (Array.isArray(G.equipSetNames) && G.equipSetNames[i]) ? String(G.equipSetNames[i]).trim() : '';
    h += '<div class="eqset-tabwrap">' +
      '<div class="eqset-name"' + (custom ? '' : ' data-empty="1"') + '>' + esc(custom) + '</div>' +
      '<button class="' + cls + '" data-eqset="' + i + '">' + defName +
        (i === active ? '<span class="eqset-badge">使用中</span>' : '') + '</button>' +
      '<span class="eqset-rename" data-eqset-rename="' + i + '" title="為這套改名稱">✏️</span>' +
    '</div>';
  }
  h += '</div>';
  var same = view === active;
  var viewLabel = (typeof equipSetLabel === 'function') ? equipSetLabel(view) : ('第' + (view + 1) + '套');
  h += '<button id="eqset-confirm" class="btn eqset-confirm"' + (same ? ' disabled' : '') + '>' +
    (same ? '目前使用中' : ('確定切換到「' + esc(viewLabel) + '」')) + '</button>';
  box.innerHTML = h;
}

// 為某一套裝備改名稱（留空恢復預設「第X套」）；用遊戲通用彈窗（帶輸入框）
function renameEquipSet(idx) {
  if (!Array.isArray(G.equipmentSets)) return;
  idx = clamp(Math.floor(Number(idx) || 0), 0, G.equipmentSets.length - 1);
  if (!Array.isArray(G.equipSetNames)) G.equipSetNames = [];
  var defName = (typeof equipSetName === 'function') ? equipSetName(idx) : ('第' + (idx + 1) + '套');
  var cur = G.equipSetNames[idx] || '';
  showConfirmDialog('為「' + defName + '」設定自訂名稱（留空恢復預設）：', function (val) {
    var name = String(val == null ? '' : val).trim().slice(0, 12); // 上限 12 字
    G.equipSetNames[idx] = name;
    UI.dirty.equip = true;
    renderEquip();
  }, { title: '裝備套改名', okText: '確定', cancelText: '取消',
       input: { value: cur, placeholder: '例：輸出套（留空恢復預設）', maxLength: 12 } });
}

function renderInventory() {
  var cap = typeof inventoryCapacityWithTalents === 'function' ? inventoryCapacityWithTalents() : INVENTORY_CAP + (G.player.invUpgrades || 0);
  var btn = $id('inv-expand');
  if (btn) {
    if (cap >= INVENTORY_MAX) {
      btn.textContent = '➕ 已達上限 (' + INVENTORY_MAX + ')';
      btn.disabled = true;
    } else {
      btn.innerHTML = '➕ 擴充 (' + fmt(inventoryExpandCost(G.player.invUpgrades || 0)) + '<img src="images/icon_gold.png" class="res-icon">)';
      btn.disabled = false;
    }
  }

  var box = $id('inventory-grid');
  $id('inv-count').textContent = G.inventory.length + '/' + cap;
  if (!G.inventory.length) {
    box.innerHTML = '<div class="hint" style="grid-column: 1 / -1; padding: 10px;">背包是空的。戰鬥掉落的裝備會先進入生產線輸送帶，「保留」的會送到這裡。</div>';
  } else {
    var filterSelect = $id('inv-rarity-filter');
    var filterRarity = filterSelect ? filterSelect.value : '';
    var displayedItems = G.inventory;
    if (filterRarity !== '') {
      var rVal = parseInt(filterRarity, 10);
      displayedItems = G.inventory.filter(function (it) {
        return it.rarity === rVal;
      });
    }
    if (!displayedItems.length) {
      box.innerHTML = '<div class="hint" style="grid-column: 1 / -1; padding: 10px;">沒有符合篩選條件的裝備。</div>';
    } else {
      box.innerHTML = displayedItems.map(function (it) { return itemCellHTML(it, 'inv'); }).join('');
    }
  }
  renderDetail();
}

/* 僅搜尋背包與裝備欄。刻意不含神鑄法陣槽位：detailAction 的操作（裝備/強化/洗煉）
   以此為來源依據，若涵蓋法陣槽位，殘留的 UI.sel 會讓槽內裝備被再次穿上造成複製。 */
function findItemById(id) {
  if (!id) return null;
  for (var i = 0; i < G.inventory.length; i++) if (G.inventory[i].id === id) return G.inventory[i];
  var eq = (typeof viewedEquipment === 'function') ? viewedEquipment() : G.equipment; // 面板操作對象＝檢視中那套
  for (var s in eq) if (eq[s] && eq[s].id === id) return eq[s];
  return null;
}

function findSelItem() {
  if (!UI.sel) return null;
  return findItemById(UI.sel.id);
}

function renderDetail() {
  hideAffixPool();
  var pane = $id('detail-pane');
  var it = findSelItem();
  updateSelectionUI();
  if (!it) {
    pane.innerHTML = '<div class="hint">點選裝備查看詳情</div>';
    pane.classList.remove('has-detail');
    var actionBar = $id('equip-action-bar');
    if (actionBar) {
      // 保留按鈕列高度（min-height），避免選取/取消選取時背包區上下跳動
      actionBar.innerHTML = '';
      actionBar.style.display = 'flex';
    }
    var matPanelEmpty = $id('equip-material-panel');
    if (matPanelEmpty) matPanelEmpty.innerHTML = '';
    return;
  }
  var cost = upgradeCost(it);
  var compareItem = null;
  var tc = $id('toggle-compare');
  if (tc && tc.checked && UI.sel.source === 'inv') {
    var cmpEq = (typeof viewedEquipment === 'function') ? viewedEquipment() : G.equipment; // 與檢視中那套比較
    var key = equipTargetSlot(it, cmpEq);
    compareItem = cmpEq[key];
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
  // 右側素材面板：可用寶石／附魔書改為小圖示，完整名稱、數值與持有量由滑鼠提示顯示
  var matHtml = '';
  ensureSockets(it);
  if (it.sockets.indexOf(null) >= 0) {
    var gemIcons = [];
    for (var gt in GEM_TYPES) {
      var total = 0, hi = 0;
      for (var lv = GEM_FORGE_MAX_LEVEL; lv >= 1; lv--) {
        var n = gemCount(gt, lv);
        total += n;
        if (n && !hi) hi = lv;
      }
      if (!total) continue;
      var gdef = GEM_TYPES[gt];
      var gv = gdef.pct ? pctStr(gemStatValue(gt, hi)) : fmt(gemStatValue(gt, hi));
      gemIcons.push('<button class="equip-material-icon" data-gem-socket="' + gt + '" data-tip="' +
        esc(GEM_NAMES[hi] + gdef.name + ' ×' + gemCount(gt, hi) + '｜' + gdef.statName.replace('%', '') + ' +' + gv +
          '｜點擊鑲入空插槽（自動取最高等級）') + '">' + gdef.emoji + '</button>');
    }
    (G.player.fusedGems || []).forEach(function (fg) {
      gemIcons.push('<button class="equip-material-icon" data-gem-socket-fused="' + fg.id + '" data-tip="' +
        esc(fusedGemLabel(fg) + '｜雙屬性融合寶石，點擊鑲入空插槽') + '">🧬</button>');
    });
    matHtml += '<div class="equip-material-section">' +
      '<div class="equip-material-title">💎 可用寶石（點擊鑲嵌）</div>' +
      (gemIcons.length ? '<div class="equip-material-grid">' + gemIcons.join('') + '</div>'
        : '<div class="equip-material-empty">尚無寶石庫存</div>') +
      '</div>';
  }
  var itEns2 = itemEnchants(it);
  if (itEns2.length < enchantCapFor(it)) {
    var cat2 = enchantCatForType(it.slot);
    var bookIcons = [];
    for (var bk2 in ENCHANTS) {
      if (ENCHANTS[bk2].cat !== cat2) continue;
      var bn2 = G.player.books[bk2] || 0;
      if (!bn2) continue;
      var owned = itEns2.some(function (en2) { return en2.key === bk2; });
      bookIcons.push('<button class="equip-material-icon' + (owned ? ' dim-chip' : '') + '" data-book-enchant="' + bk2 + '" data-tip="' +
        esc(ENCHANTS[bk2].name + ' ×' + bn2 + '｜' + ENCHANTS[bk2].desc +
          '｜消耗 1 書＋🔮' + ENCHANT_ESSENCE_COST + ' 精華（庫存 ' + fmt(G.player.essence) + '）' +
          (owned ? '｜已附魔，僅可升級數值' : '')) + '">' + ENCHANTS[bk2].emoji + '</button>');
    }
    var catNames2 = { atk: '攻擊', def: '防禦', util: '功能' };
    matHtml += '<div class="equip-material-section">' +
      '<div class="equip-material-title">✨ 可用附魔書（點擊附魔）</div>' +
      '<div class="equip-material-subtitle">' + catNames2[cat2] + '類部位' +
      (bookIcons.length ? '' : '｜沒有可用的書（階段 8+ 掉落 / 高塔獎勵）') + '</div>' +
      (bookIcons.length ? '<div class="equip-material-grid">' + bookIcons.join('') + '</div>' : '') +
      '</div>';
  }
  pane.innerHTML = h;
  pane.classList.add('has-detail');
  var matPanel = $id('equip-material-panel');
  if (matPanel) matPanel.innerHTML = matHtml;
  var actionBar = $id('equip-action-bar');
  if (actionBar) {
    actionBar.innerHTML = actionsHtml;
    actionBar.style.display = 'flex';
  }
}

function equipSlotType(slot) {
  return (typeof slotTypeOf === 'function') ? slotTypeOf(slot) : slot;
}

function equipSlotMatches(itemSlot, equipSlot) {
  return !!itemSlot && !!equipSlot && equipSlotType(itemSlot) === equipSlotType(equipSlot);
}

function selectionSlotForItem(selItem) {
  if (UI.sel && (UI.sel.source === 'equip-slot' || UI.sel.source === 'equip')) {
    return UI.sel.slot || null;
  }
  if (selItem && UI.sel && UI.sel.source === 'inv') {
    return equipTargetSlot(selItem);
  }
  return null;
}

function updateSelectionUI() {
  var selItem = findSelItem();
  var selectedSlot = selectionSlotForItem(selItem);
  var highlightInventoryBySlot = !!(UI.sel && (UI.sel.source === 'equip-slot' || UI.sel.source === 'equip'));

  document.querySelectorAll('.item-cell, .eq-slot').forEach(function (el) {
    el.classList.remove('selected', 'dimmed');

    if (selectedSlot && el.classList.contains('eq-slot') && el.getAttribute('data-slot') === selectedSlot) {
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

  if (!highlightInventoryBySlot || !selectedSlot) return;
  document.querySelectorAll('.item-cell').forEach(function (el) {
    var elSlot = el.getAttribute('data-slot');
    if (equipSlotMatches(elSlot, selectedSlot)) {
      el.classList.add('selected');
    } else {
      el.classList.add('dimmed');
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
  var panelEq = (typeof viewedEquipment === 'function') ? viewedEquipment() : G.equipment; // 面板操作對象＝檢視中那套
  if (act === 'equip') {
    idx = G.inventory.indexOf(it);
    if (idx >= 0) G.inventory.splice(idx, 1);
    var old = equipItem(it, null, panelEq); // 裝入檢視中那套（若＝使用中會一併重算屬性）
    if (old) { old.locked = false; addToInventory(old); }
    UI.sel = { id: it.id, source: 'equip' };
    UI.dirty.inv = true; UI.dirty.equip = true;
  } else if (act === 'unequip') {
    var cap = typeof inventoryCapacityWithTalents === 'function' ? inventoryCapacityWithTalents() : INVENTORY_CAP + (G.player.invUpgrades || 0);
    if (G.inventory.length >= cap) { blog('⚠️ 背包已滿，無法卸下', 'warn'); return; }
    // 依物品 id 找出實際佔用的欄位（武器/戒指有主副兩欄）
    for (var sk2 in panelEq) {
      if (panelEq[sk2] && panelEq[sk2].id === it.id) { panelEq[sk2] = null; break; }
    }
    if (panelEq === G.equipment) markStatsDirty(); // 只有動到使用中那套才重算屬性
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
/* 附魔書庫存＋強化節點（原生產線頁面板，已搬入熔爐分頁；renderNewForge 呼叫） */
function renderForgeExtras() {
  var f = G.factory;
  var encBooks = $id('enc-books');
  if (encBooks) {
    var bookChips = [];
    for (var bk in G.player.books) {
      if (G.player.books[bk] > 0) bookChips.push('<span class="book-chip">' + ENCHANTS[bk].emoji + esc(ENCHANTS[bk].name) + ' x' + G.player.books[bk] + '</span>');
    }
    encBooks.innerHTML = bookChips.length ? bookChips.join('') : '<span class="hint">尚無附魔書（階段 8+ 掉落 / 高塔獎勵）</span>';
  }
  var encInfo = $id('enc-info');
  if (encInfo) encInfo.textContent = '精華庫存 ' + fmt(G.player.essence) + '（每次消耗 ' + ENCHANT_ESSENCE_COST + '）｜已附魔 ' + fmt(f.stats.enchanted) + ' 次';

}

function partIconHTML(key) {
  var iconMap = {
    scrapForge: ['icon_scrap.png'],
    goldSluice: ['icon_gold.png'],
    extractLens: ['icon_essence.png'],
    bookScavenger: ['icon_books.png'],
    duplicator: ['icon_scrap.png', 'icon_gold.png'],
    fortuneChip: ['icon_scrap.png', 'icon_gold.png', 'icon_essence.png'],
    ancientEssenceRate: ['icon_ancient_essence.png']
  };
  var icons = iconMap[key];
  if (!icons) return PART_TYPES[key] ? PART_TYPES[key].emoji : '';
  return icons.map(function (name) {
    return '<img src="images/' + name + '" class="part-material-icon" alt="">';
  }).join('');
}

// 將工廠設定同步到輸入元件（初始化 / 讀檔後）
// 舊生產線頁的篩選/合成節點已移除；僅剩熔爐頁上的自動換裝與強化節點。
function syncFactoryInputs() {
  var f = G.factory;
  var autoEq = $id('nf-autoequip');
  if (autoEq) autoEq.checked = !!f.autoEquip;

}

/* ---- 熔爐分頁（正式版：品質勾選路由）----
   邏輯層 → js/newforge.js；資料表 → js/data.js。
   熔爐清單以整段 innerHTML 重建，僅在內容變動且未聚焦互動元件時覆寫；
   帶視覺由 nfUpdateBelts 定點更新，批次流動不擊穿快取。 */

// 品質勾選摘要（面板收合時顯示）：列出會拆解的品質（0 普通 ~ 7 創世；神鑄創世恆保留）
function nfQualitySummary(fu) {
  var salv = [];
  for (var r = 0; r < GODFORGED_IDX; r++) {
    if (fu.qualities[r]) salv.push('<span style="color:' + RARITIES[r].color + '">' + RARITIES[r].name + '</span>');
  }
  return salv.length ? '分解：' + salv.join('、') + '（其餘保留）' : '未勾選任何品質（全部保留）';
}

// 品質勾選面板（圖2）：勾選＝該品質裝備自動入帶拆解；未勾＝保留
function nfQualityPanelHTML(fu) {
  var rows = '';
  for (var r = 0; r < GODFORGED_IDX; r++) {
    rows += '<label class="nf-qual-row"><input type="checkbox" data-nf-fid="' + fu.id + '" data-nf-qual="' + r + '"' +
      (fu.qualities[r] ? ' checked' : '') + '> <span style="color:' + RARITIES[r].color + '">' + RARITIES[r].name + '</span></label>';
  }
  return '<div class="nf-qual-panel">' + rows +
    '<div class="hint">勾選品質的裝備會自動進入傳送帶拆解；未勾選＝保留入包。上鎖與神鑄創世永遠保留。</div></div>';
}

// 傳送帶批次圖示（帶頭在左＝即將入爐；與原版輸送帶樣式一致，縮小尺寸多顯示件數）。
// 帶尾另有固定寬度的 +N 區（nf-belt-more，由 nfUpdateBelts 更新），版面不隨數字增減變動。
function nfBeltChipsHTML(fu) {
  var show = fu.belt.slice(0, NEW_FORGE_BELT_SHOW);
  var chips = show.map(function (it) {
    var r = RARITIES[it.rarity];
    return '<span class="conv-chip" style="border-color:' + r.color + ';color:' + r.color + '" data-tip="' +
      esc(rarityTag(it)) + '">' + SLOT_INFO[it.slot].emoji + '</span>';
  }).join('');
  return chips || '<span class="nf-belt-empty dim-text">（傳送帶空）</span>';
}

// 零件置入格列：已裝＝零件晶片（點擊卸下）、空格＝零件N（點擊開啟零件列表）、
// 下一格＝🔒解鎖（顯示金幣成本）、其餘＝🔒
function nfPartSlotsHTML(fu) {
  var nf = G.newForge;
  var cells = '';
  for (var s = 0; s < NEW_FORGE_PART_SLOTS_MAX; s++) {
    if (s < fu.partSlots) {
      var p = fu.parts[s]; // 快照 {key,tier,val,name}
      if (p && PART_TYPES[p.key]) {
        // 已裝＝正方形小圖示（全稱在 tooltip；點擊依格位索引卸下）
        cells += '<button class="nf-part-slot nf-part-filled nf-part-ico" data-nf-fid="' + fu.id + '" data-nf-partun="' + s + '"' +
          ' data-tip="【點擊卸下】' + esc(partDesc(p)) + '">' + partIconHTML(p.key) + '</button>';
      } else {
        cells += '<button class="nf-part-slot" data-nf-fid="' + fu.id + '" data-nf-partsopen="1"' +
          ' data-tip="【點擊選擇零件】開啟零件列表，可連續安裝">零件' + (s + 1) + '</button>';
      }
    } else if (s === fu.partSlots) {
      var cost = newForgePartSlotCost(reincarnationCount(), fu.partSlots, nf.furnaces.length);
      var ok = G.player.gold >= cost;
      cells += '<button class="nf-part-slot nf-part-lock' + (ok ? '' : ' nf-part-poor') + '" data-nf-fid="' + fu.id + '" data-nf-unlockslot="1"' +
        ' data-tip="解鎖第 ' + (s + 1) + ' 格零件格：金幣 ' + fmtFull(cost) + '">🔒 ' + fmt(cost) + '</button>';
    } else {
      cells += '<span class="nf-part-slot nf-part-lock">🔒</span>';
    }
  }
  return '<div class="nf-parts-row">' + cells + '</div>';
}

// 零件選擇列表（點擊零件格開啟；出現在該熔爐卡片下方）：
// 與舊分解槽相同操作——依種類分組、點擊安裝最高階數值者，列表保持開啟可連續裝滿。
function nfPartsListHTML(fu) {
  // 自由裝配：列出持有的所有分解槽零件類型（不論是否已裝於他處），安裝為最高階數值快照
  var owned = G.factory.parts.filter(function (p) {
    var pt = p && PART_TYPES[p.key];
    return pt && pt.node === 'salvage';
  });
  var chips;
  if (!owned.length) {
    chips = '<span class="hint" style="font-size:12px;">尚無可用零件（野外/高塔掉落自動機組零件）</span>';
  } else {
    var byKey = {};
    owned.forEach(function (p) { (byKey[p.key] || (byKey[p.key] = [])).push(p); });
    chips = Object.keys(byKey).map(function (key) {
      var group = byKey[key];
      var best = group.slice().sort(function (a, b) { return (b.tier - a.tier) || (b.val - a.val); })[0];
      return '<span class="part-chip" style="cursor:pointer; border-color:var(--accent);" data-nf-fid="' + fu.id +
        '" data-nf-partinstall-key="' + key + '" data-tip="【點擊裝配】取最高階數值：' + esc(partDesc(best)) +
        '｜同類型可重複裝配、不佔用零件庫">' + partIconHTML(key) + esc(best.name) + '</span>';
    }).join('');
  }
  return '<div class="nf-parts-list"><div class="nf-parts-list-head">🔧 選擇零件（熔爐 #' + fu.id + '，' +
    fu.parts.length + '/' + fu.partSlots + '）<button class="btn sm" data-nf-fid="' + fu.id + '" data-nf-partsopen="1">收起</button></div>' +
    '<div class="chip-row">' + chips + '</div>' +
    '<div class="hint">完全自由裝配：同類型可重複、連續點擊可一次裝滿，不佔用也不消耗零件庫存；點擊已裝格卸下。全部 10 種分解槽零件皆對該熔爐生效（速度/產量/精華/額外掉落）。</div></div>';
}

// 熔爐卡片（圖1）：左側大圖＋右側傳送帶（品質設定/啟用/摘要/帶視覺）＋零件格
function nfFurnaceHTML(fu) {
  var head = '<div class="node-title">' + NEW_FORGE_EMOJI + ' ' + esc(NEW_FORGE_NAME) +
    ' <span class="node-badge">#' + fu.id + '</span>' +
    '<button class="btn sm warn nf-remove" data-nf-remove="' + fu.id + '">移除熔爐</button></div>';
  var open = UI.nfCfgOpen && UI.nfCfgOpen[fu.id];
  var beltRow = '<div class="nf-line-head">' +
    '<span class="nf-line-no">傳送帶</span>' +
    '<button class="btn sm" data-nf-fid="' + fu.id + '" data-nf-cfg="1">⚙ 品質設定</button>' +
    '<label class="chk"><input type="checkbox" data-nf-fid="' + fu.id + '" data-nf-on="1"' + (fu.enabled ? ' checked' : '') + '> 啟用</label>' +
    '</div>' +
    (open ? nfQualityPanelHTML(fu) : '<div class="nf-line-sum">' + nfQualitySummary(fu) + '</div>') +
    '<div class="nf-belt"><span class="nf-belt-mouth" data-tip="熔爐入口：帶頭裝備由此入爐拆解">' + NEW_FORGE_EMOJI + '</span>' +
    '<span class="nf-belt-items" data-nf-belt="' + fu.id + '"></span>' +
    '<span class="nf-belt-more" data-nf-more="' + fu.id + '"></span></div>' +
    nfPartSlotsHTML(fu) +
    (UI.nfPartsOpen && UI.nfPartsOpen[fu.id] ? nfPartsListHTML(fu) : '');
  return '<div class="panel node-card nf-furnace' + (fu.enabled ? '' : ' nf-line-off') + '">' + head +
    '<div class="nf-furnace-body">' +
    '<div class="nf-furnace-left"><img class="nf-furnace-img" src="' + NEW_FORGE_IMAGE + '" alt="' + esc(NEW_FORGE_NAME) + '">' +
    '<div class="nf-furnace-caption dim-text">' + esc(NEW_FORGE_DESC) + '</div></div>' +
    '<div class="nf-lines">' + beltRow + '</div>' +
    '</div></div>';
}

function renderNewForge() {
  var nf = G.newForge;
  if (!nf) return;
  var qc = $id('nf-queue-count');
  if (qc) qc.textContent = fmtFull(nf.queue.length); // 佇列顯示完整數字，不用簡寫
  var autoEq = $id('nf-autoequip');
  if (autoEq && document.activeElement !== autoEq) autoEq.checked = !!(G.factory && G.factory.autoEquip);
  renderForgeExtras(); // 附魔書庫存＋強化節點（搬入本頁的面板）
  var cnt = $id('nf-count');
  if (cnt) {
    var allowed = newForgeMaxFurnaces(reincarnationCount());
    cnt.textContent = nf.furnaces.length + '/' + allowed + ' 座（轉生+1 座，上限 ' + NEW_FORGE_MAX + '）｜已拆解 ' + fmt(nf.stats.salvaged) +
      '・保留 ' + fmt(nf.stats.kept);
  }
  var list = $id('nf-furnaces');
  if (list) {
    var html = nf.furnaces.map(nfFurnaceHTML).join('') ||
      '<div class="panel"><div class="hint">尚無熔爐——請於下方添加。</div></div>';
    if (UI._nfFurnacesHTML !== html) {
      // 焦點防衛：使用者正聚焦清單內的下拉/輸入框時延後整段重建（帶視覺另行定點更新）
      var ae = document.activeElement;
      var interacting = ae && list.contains(ae) && (ae.tagName === 'SELECT' || ae.tagName === 'INPUT');
      if (!interacting) {
        UI._nfFurnacesHTML = html;
        list.innerHTML = html;
      }
    }
    nfUpdateBelts(list);
  }
}

// 傳送帶批次定點更新（每輪執行；容器內無互動元件，覆寫不影響操作）
function nfUpdateBelts(list) {
  var nodes = list.querySelectorAll('[data-nf-belt]');
  if (!nodes.length) return;
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    var fu = findNewForgeFurnace(parseInt(node.getAttribute('data-nf-belt'), 10));
    if (!fu) continue;
    var html = nfBeltChipsHTML(fu);
    if (node._nfBeltHTML !== html) {
      node._nfBeltHTML = html;
      node.innerHTML = html;
    }
  }
  // 帶尾固定 +N 區：只換文字，空間恆定不變動版面。
  // +N＝該爐「專屬佇列」真實件數（各爐獨立，非共用計數；顯示封頂 +9999、tooltip 精確）。
  var mores = list.querySelectorAll('[data-nf-more]');
  for (var m = 0; m < mores.length; m++) {
    var moreNode = mores[m];
    var moreFu = findNewForgeFurnace(parseInt(moreNode.getAttribute('data-nf-more'), 10));
    var wait = (moreFu && moreFu.queue) ? moreFu.queue.length : 0;
    var text = wait > 0 ? '+' + (wait > 9999 ? '9999' : wait) : '';
    if (moreNode._nfMoreText !== text) {
      moreNode._nfMoreText = text;
      moreNode.textContent = text;
      if (wait > 0) moreNode.setAttribute('data-tip', '此熔爐專屬佇列：' + fmtFull(wait) + ' 件（自總佇列派發，等待進入傳送帶）');
      else moreNode.removeAttribute('data-tip');
    } else if (wait > 0) {
      moreNode.setAttribute('data-tip', '此熔爐專屬佇列：' + fmtFull(wait) + ' 件（自總佇列派發，等待進入傳送帶）');
    }
  }
}

// 熔爐分頁事件委派（initUI 呼叫一次；清單 innerHTML 重建不影響委派）
function bindNewForgeEvents() {
  var tab = $id('tab-newforge');
  if (!tab) return;
  tab.addEventListener('change', function (e) {
    var el = e.target;
    if (!el || !el.getAttribute) return;
    if (el.id === 'nf-autoequip') {
      G.factory.autoEquip = el.checked;
      nflog(el.checked ? '🎽 已開啟更強自動換裝：路由時撿到更強裝備自動穿上' : '🎽 已關閉更強自動換裝', 'info');
      return;
    }

    var fu = findNewForgeFurnace(parseInt(el.getAttribute('data-nf-fid'), 10));
    if (!fu) return;
    if (el.hasAttribute('data-nf-qual')) {
      var r = parseInt(el.getAttribute('data-nf-qual'), 10);
      if (r >= 0 && r < GODFORGED_IDX) fu.qualities[r] = el.checked;
      newForgeReturnUnroutable(fu); // 取消勾選的品質自專屬佇列退回總佇列重新派發
      UI.dirty.newforge = true;
    } else if (el.hasAttribute('data-nf-on')) {
      fu.enabled = el.checked;
      newForgeReturnUnroutable(fu); // 停用：專屬佇列退回總佇列
      UI.dirty.newforge = true;
    }
  });
  tab.addEventListener('click', function (e) {
    // 零件裝配晶片（span）：點擊依類型裝配最高階數值快照，列表保持開啟可連續裝滿
    var chip = e.target && e.target.closest ? e.target.closest('[data-nf-partinstall-key]') : null;
    if (chip) {
      var cfu = findNewForgeFurnace(parseInt(chip.getAttribute('data-nf-fid'), 10));
      if (cfu) {
        var ierr = newForgeInstallPart(cfu.id, chip.getAttribute('data-nf-partinstall-key'));
        if (ierr) nflog('⚠️ ' + ierr, 'warn');
      }
      return;
    }
    var el = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!el) return;
    if (el.hasAttribute('data-nf-add')) {
      var err = addNewForgeFurnace();
      if (err) nflog('⚠️ ' + err, 'warn');
      else nflog('🏗️ 已添加' + NEW_FORGE_NAME, 'good');
      return;
    }
    if (el.hasAttribute('data-nf-remove')) {
      var rid = parseInt(el.getAttribute('data-nf-remove'), 10);
      if (removeNewForgeFurnace(rid)) nflog('🗑️ 已移除熔爐 #' + rid + '（傳送帶裝備已退回背包）', 'info');
      return;
    }
    var fu = findNewForgeFurnace(parseInt(el.getAttribute('data-nf-fid'), 10));
    if (!fu) return;
    if (el.hasAttribute('data-nf-cfg')) {
      if (!UI.nfCfgOpen) UI.nfCfgOpen = {};
      UI.nfCfgOpen[fu.id] = !UI.nfCfgOpen[fu.id];
      UI.dirty.newforge = true;
      return;
    }
    if (el.hasAttribute('data-nf-unlockslot')) {
      var uerr = unlockNewForgePartSlot(fu.id);
      if (uerr) nflog('⚠️ ' + uerr, 'warn');
      return;
    }
    if (el.hasAttribute('data-nf-partsopen')) {
      if (!UI.nfPartsOpen) UI.nfPartsOpen = {};
      UI.nfPartsOpen[fu.id] = !UI.nfPartsOpen[fu.id];
      UI.dirty.newforge = true;
      return;
    }
    if (el.hasAttribute('data-nf-partun')) {
      newForgeUninstallPart(fu.id, parseInt(el.getAttribute('data-nf-partun'), 10));
      return;
    }
  });
  // 點擊零件界面外任意處收起零件列表：零件列表本體與零件格列（開啟/卸下/解鎖）內的
  // 點擊不收起（保留連續安裝操作），其餘一律關閉所有已開啟的列表。
  document.addEventListener('click', function (e) {
    if (!UI.nfPartsOpen) return;
    var anyOpen = false;
    for (var k in UI.nfPartsOpen) if (UI.nfPartsOpen[k]) { anyOpen = true; break; }
    if (!anyOpen) return;
    var t = e.target;
    if (t && t.closest && (t.closest('.nf-parts-list') || t.closest('.nf-parts-row'))) return;
    UI.nfPartsOpen = {};
    UI.dirty.newforge = true;
  });
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

function forgeInventoryTab() {
  var c = forgeState().crafting;
  if (c && c.mode === 'gem') return 'gems';
  if (c && c.mode === 'equip') return 'items';
  return UI.forgeInvTab || 'items';
}

/* 神鑄「自動放入」選單：依目前背包切頁列出可選素材。
   裝備頁＝三種品質（品質色字）；寶石頁＝所有持有的五～九階寶石（emoji 小圖示＋屬性）。
   持有不足 6 者半透明不可選；UI.forgeAutoPick 為選單中的暫選項。 */
function renderForgeAutoMenu() {
  var menu = $id('forge-auto-menu');
  if (!menu) return;
  // 重建前記住素材清單卷軸位置：自動鑄造運行中觸發的同步重繪不可把清單刷回頂部
  var prevList = menu.querySelector('.fam-list');
  var prevScrollTop = prevList ? prevList.scrollTop : 0;
  var invTab = forgeInventoryTab();
  menu.classList.toggle('fam-gem-mode', invTab === 'gems');
  var pick = UI.forgeAutoPick;
  var title = '';
  var rows = '';
  if (invTab === 'gems') {
    title = '💎 自動放入寶石（五～九階）';
    var gemOptions = [];
    for (var lv = GEM_FORGE_MAX_LEVEL - 1; lv >= GEM_MAX_LEVEL; lv--) {
      for (var t in GEM_TYPES) {
        var n = gemCount(t, lv);
        if (!n) continue;
        gemOptions.push({ type: t, level: lv, count: n, canForge: n >= FORGE_SLOTS });
      }
    }
    // 可直接放滿六個鑄造槽的寶石優先，接著依階級由高到低排列。
    gemOptions.sort(function (a, b) {
      return b.canForge - a.canForge || b.level - a.level || String(a.type).localeCompare(String(b.type));
    });
    for (var gi = 0; gi < gemOptions.length; gi++) {
      var gem = gemOptions[gi];
      var gd = GEM_TYPES[gem.type];
      var val = gd.pct ? pctStr(gemStatValue(gem.type, gem.level)) : fmt(gemStatValue(gem.type, gem.level));
      var gPicked = pick && pick.kind === 'gem' && pick.type === gem.type && pick.level === gem.level;
      var col = GEM_TIER_COLORS[gem.level] || '#f5c542';
      rows += '<div class="fam-opt' + (gem.canForge ? '' : ' fam-dim') + (gPicked ? ' picked' : '') + '"' +
        ' data-fam-gem="' + gem.type + ':' + gem.level + '"' +
        ' style="color:' + col + '">' +
        '<span>' + gd.emoji + '</span>' +
        '<span>' + esc(GEM_NAMES[gem.level] + gd.name) + '（' + esc(gd.statName.replace('%', '')) + ' +' + val + '）</span>' +
        '<span class="fam-cnt">×' + fmt(gem.count) + (gem.canForge ? '' : '｜不足6') + '</span></div>';
    }
  } else {
    title = '🎒 自動放入裝備（取未上鎖、評分最低 6 件）';
    for (var r = FORGE_MIN_RARITY; r < GODFORGED_IDX; r++) {
      var cnt = 0;
      for (var i = 0; i < G.inventory.length; i++) {
        var it = G.inventory[i];
        if (it && it.rarity === r && !it.locked) cnt++;
      }
      var rok = cnt >= FORGE_SLOTS;
      var rPicked = pick && pick.kind === 'equip' && pick.rarity === r;
      rows += '<div class="fam-opt' + (rok ? '' : ' fam-dim') + (rPicked ? ' picked' : '') + '"' +
        ' data-fam-equip="' + r + '"' +
        ' style="color:' + RARITIES[r].color + '">' +
        '<span>' + esc(RARITIES[r].name) + '裝備</span>' +
        '<span class="fam-cnt">持有 ' + cnt + (rok ? '' : '｜不足6') + '</span></div>';
    }
  }
  var emptyText = invTab === 'gems'
    ? '沒有五階以上的寶石（十階已是最高，不可鑄造）'
    : '目前沒有可自動放入的裝備';
  menu.innerHTML = '<div class="fam-title">' + title + '</div>' +
    '<div class="fam-list">' + (rows || '<div class="fam-empty">' + emptyText + '</div>') + '</div>' +
    '<div class="fam-foot">' +
    '<button id="fam-confirm" class="btn sm"' + (pick ? '' : ' disabled') + '>確定</button>' +
    (forgeState().autoFill ? '<button id="fam-stop" class="btn sm warn">取消自動放入</button>' : '') +
    '<button id="fam-close" class="btn sm">關閉</button></div>';
  // 法陣區為 overflow:hidden：選單往上展開的最大高度以「按鈕底～法陣頂」為限，
  // 超出改由素材清單內卷軸承接，標題與操作列不隨清單移動。
  var stage = $id('forge-stage');
  if (stage && menu.parentElement) {
    var avail = menu.parentElement.getBoundingClientRect().bottom - stage.getBoundingClientRect().top - 10;
    var menuHeight = Math.max(160, Math.min(400, Math.floor(avail)));
    menu.style.maxHeight = menuHeight + 'px';
    // 寶石清單使用明確高度，確保 footer 不會被素材內容擠出選單。
    menu.style.height = invTab === 'gems' ? menuHeight + 'px' : '';
    var famList = menu.querySelector('.fam-list');
    if (famList && invTab === 'gems') {
      var famTitle = menu.querySelector('.fam-title');
      var famFoot = menu.querySelector('.fam-foot');
      var menuCss = window.getComputedStyle(menu);
      var titleCss = window.getComputedStyle(famTitle);
      var footCss = window.getComputedStyle(famFoot);
      var verticalPadding = (parseFloat(menuCss.paddingTop) || 0) + (parseFloat(menuCss.paddingBottom) || 0);
      var titleMargin = parseFloat(titleCss.marginBottom) || 0;
      var footMargin = parseFloat(footCss.marginTop) || 0;
      var measuredHeight = menu.clientHeight
        ? menu.clientHeight - verticalPadding - famTitle.offsetHeight - titleMargin - famFoot.offsetHeight - footMargin
        : menuHeight - 100;
      famList.style.flex = '0 0 auto';
      famList.style.height = Math.max(40, Math.floor(measuredHeight)) + 'px';
    } else if (famList) {
      famList.style.flex = '';
      famList.style.height = '';
    }
  }
  // 還原重建前的卷軸位置（clamp 交由瀏覽器處理，超出時自動停在最底）
  var newList = menu.querySelector('.fam-list');
  if (newList && prevScrollTop > 0) newList.scrollTop = prevScrollTop;
}

/* 點選素材時就地更新高亮與確定鈕，不重建選單（保留清單卷軸位置）。 */
function famApplyPickHighlight(menu) {
  var pick = UI.forgeAutoPick;
  var opts = menu.querySelectorAll('.fam-opt');
  for (var i = 0; i < opts.length; i++) {
    var el = opts[i];
    var isPicked = false;
    if (pick) {
      if (pick.kind === 'equip') {
        isPicked = el.getAttribute('data-fam-equip') === String(pick.rarity);
      } else {
        isPicked = el.getAttribute('data-fam-gem') === pick.type + ':' + pick.level;
      }
    }
    el.classList.toggle('picked', isPicked);
  }
  var confirmBtn = menu.querySelector('#fam-confirm');
  if (confirmBtn) confirmBtn.disabled = !pick;
}

function renderForgeProgress() {
  var box = $id('forge-progress');
  if (!box) return;
  var c = forgeState().crafting;
  var fill = $id('forge-progress-fill');
  if (!c) {
    box.style.display = 'none';
    if (fill) {
      fill.style.animationName = 'none';
      fill.style.transform = 'scaleX(0)';
      delete fill.dataset.forgeAnimation;
    }
    return;
  }
  var duration = Math.max(1, Number(c.durationMs) || 1);
  var elapsed = clamp(Date.now() - Number(c.startedAt), 0, duration);
  var remain = Math.max(0, duration - elapsed);
  box.style.display = '';
  $id('forge-progress-status').textContent = '鑄造中....';
  // 目前素材可再鑄造次數 = 剩餘庫存 ÷ 6 取整（內容無變化時不觸碰 DOM）
  var remainEl = $id('forge-progress-remain');
  if (remainEl) {
    var ri = forgeRemainInfo();
    var remainText = ri ? ri.label + ' 可再鑄造 ' + fmt(Math.floor(ri.count / FORGE_SLOTS)) + ' 次' : '';
    if (remainEl.textContent !== remainText) remainEl.textContent = remainText;
  }
  $id('forge-progress-countdown').textContent = (remain / 1000).toFixed(1) + ' 秒';
  if (fill) {
    var animationKey = String(c.startedAt) + '/' + duration;
    if (fill.dataset.forgeAnimation !== animationKey) {
      // 自動鑄造換輪會沿用同一個 DOM；先強制結束上一輪，確保新輪次從正確進度重播。
      fill.style.animationName = 'none';
      void fill.offsetWidth;
      fill.dataset.forgeAnimation = animationKey;
      fill.style.animationName = 'forge-progress-fill';
      fill.style.animationDuration = duration + 'ms';
      fill.style.animationDelay = '-' + Math.min(elapsed, duration) + 'ms';
      fill.style.animationTimingFunction = 'linear';
      fill.style.animationFillMode = 'forwards';
      fill.style.animationPlayState = 'running';
    }
  }
}

function renderForge() {
  var hex = $id('forge-hex');
  if (!hex) return;
  var f = forgeState();
  var forgeBusy = forgeIsBusy();
  var h = '';
  // 六個素材槽（裝備或寶石，二擇一模式）
  for (var i = 0; i < FORGE_SLOTS; i++) {
    var p = FORGE_SLOT_POS[i];
    var it = f.slots[i];
    var style = 'left:' + p.x + '%;top:' + p.y + '%;';
    if (it && it.kind === 'gem') {
      var gcol = GEM_TIER_COLORS[it.level] || '#f5c542';
      var gdefS = GEM_TYPES[it.type];
      var gvalS = gdefS.pct ? pctStr(gemStatValue(it.type, it.level)) : fmt(gemStatValue(it.type, it.level));
      h += '<div class="forge-slot filled" data-forge-slot="' + i + '" data-tip="' +
        esc(gemLabel(it.type, it.level) + '｜' + gdefS.statName.replace('%', '') + ' +' + gvalS + '｜點擊取回') + '" ' +
        'style="' + style + 'border-color:' + gcol + ';box-shadow:0 0 14px ' + gcol + 'aa, inset 0 0 10px ' + gcol + '55">' +
        '<span class="ic-emoji">' + GEM_TYPES[it.type].emoji + '</span><span class="ic-lv">' + it.level + '</span></div>';
    } else if (it) {
      var r = RARITIES[it.rarity];
      var info = SLOT_INFO[it.slot];
      var iconHtml = info.icon ? '<img src="images/' + info.icon + '" class="item-icon">' : '<span class="ic-emoji">' + info.emoji + '</span>';
      // 裝備槽不掛 data-tip：滑過改由 mouseover 委派顯示完整裝備詳情 tooltip
      h += '<div class="forge-slot filled" data-forge-slot="' + i + '" data-id="' + it.id + '" ' +
        'style="' + style + 'border-color:' + r.color + ';box-shadow:0 0 14px ' + r.color + 'aa, inset 0 0 10px ' + r.color + '55">' +
        iconHtml + ancientStarBadgeHTML(it) + '<span class="ic-lv">' + it.level + '</span></div>';
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
      '　<span class="dim-text">金幣消耗：<img src="images/icon_gold.png" class="res-icon">' + fmt(rate.cost) + '｜失敗獲得魔塵 x1</span>';
  } else {
    rateEl.innerHTML = '<span class="dim-text">放入 6 件相同品質的裝備（傳說 55%｜神話 40%｜創世 25%）或 6 顆同種同階寶石（五階 45% ~ 九階 5%）</span>';
  }
  // 法陣紀錄
  $id('forge-log').innerHTML = f.log.map(function (l) {
    return '<div class="forge-log-line ' + l.cls + '">' + esc(l.msg) + '</div>';
  }).join('');
  // 自動魔塵與持有量
  var autoDustInput = $id('forge-autodust');
  var autoForgeInput = $id('forge-autoforge');
  autoDustInput.checked = !!f.autoDust;
  autoForgeInput.checked = !!f.autoForge;
  autoDustInput.parentElement.classList.toggle('is-active', autoDustInput.checked);
  autoForgeInput.parentElement.classList.toggle('is-active', autoForgeInput.checked);
  $id('forge-dust-own').textContent = '持有魔塵 ' + fmt(G.player.dust || 0) + ' 個｜已放置 ' + dustN + '/' + FORGE_SLOTS;
  renderForgeProgress();
  $id('forge-unload').disabled = forgeBusy;
  $id('forge-autodust').disabled = forgeBusy;
  var goBtn = $id('forge-go');
  if (goBtn) {
    if (forgeBusy || forgeItemCount() < FORGE_SLOTS) {
      goBtn.disabled = true;
      goBtn.style.background = '#4b5563';
      goBtn.style.color = '#d1d5db';
      goBtn.style.border = '1px solid #374151';
      goBtn.style.opacity = '1';
      goBtn.style.filter = 'none';
    } else {
      goBtn.disabled = false;
      goBtn.style.background = '';
      goBtn.style.color = '';
      goBtn.style.border = '';
      goBtn.style.opacity = '';
      goBtn.style.filter = '';
    }
  }
  // 自動放入按鈕狀態（已設定時亮起）與開啟中的選單同步刷新
  var afBtn = $id('forge-autofill');
  if (afBtn) {
    afBtn.disabled = forgeBusy;
    var afLabel = forgeAutoFillLabel();
    afBtn.classList.toggle('afk-on', !!afLabel);
    afBtn.setAttribute('data-tip', afLabel
      ? '自動放入中：' + afLabel + '（每次鑄造後自動補放 6 件，數量不足自動停止；點擊變更）'
      : '選擇素材後立即放入 6 件，之後每次鑄造自動補放同一素材');
  }
  var famMenuSync = $id('forge-auto-menu');
  if (forgeBusy && famMenuSync) {
    famMenuSync.style.display = 'none';
    UI.forgeAutoPick = null;
  } else if (famMenuSync && famMenuSync.style.display !== 'none') renderForgeAutoMenu();
  // 背包（裝備 / 寶石切頁；不符資格者以灰階顯示）
  var invTab = forgeInventoryTab();
  UI.forgeInvTab = invTab;
  var tabItemsBtn = $id('forge-invtab-items'), tabGemsBtn = $id('forge-invtab-gems');
  if (tabItemsBtn) tabItemsBtn.classList.toggle('active', invTab === 'items');
  if (tabGemsBtn) tabGemsBtn.classList.toggle('active', invTab === 'gems');
  if (tabItemsBtn) tabItemsBtn.disabled = forgeBusy;
  if (tabGemsBtn) tabGemsBtn.disabled = forgeBusy;
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
    var cap = typeof inventoryCapacityWithTalents === 'function' ? inventoryCapacityWithTalents() : INVENTORY_CAP + (G.player.invUpgrades || 0);
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
    var maxShow = Math.min(TOWER_MAX_FLOOR, G.tower.highest + 3);
    for (var fl = 1; fl <= maxShow; fl++) {
      var unlocked = fl <= G.tower.highest + 1;
      var cleared = fl <= G.tower.highest;
      var bd = BOSS_LIST[(fl - 1) % BOSS_LIST.length];
      var hell = isHellTowerFloor(fl);
      var purgatory = isPurgatoryTowerFloor(fl);
      var towerClass = purgatory ? 'purgatory' : (hell ? 'hell' : 'trial');
      if (fl === 1 || fl === TOWER_TRIAL_MAX_FLOOR + 1 || fl === TOWER_HELL_MAX_FLOOR + 1) {
        var sectionName = purgatory ? '煉獄之塔' : (hell ? '地獄之塔' : '試煉之塔');
        var sectionStart = purgatory ? TOWER_HELL_MAX_FLOOR + 1 : (hell ? TOWER_TRIAL_MAX_FLOOR + 1 : 1);
        var sectionEnd = purgatory ? TOWER_PURGATORY_MAX_FLOOR : (hell ? TOWER_HELL_MAX_FLOOR : TOWER_TRIAL_MAX_FLOOR);
        h += '<div class="tower-section-title ' + towerClass + '">🗼 ' +
          sectionName + '<span>第 ' + sectionStart + '～' + sectionEnd + ' 層</span></div>';
      }

      var bossIcon = (bd.img && !bd.imgFailed) ? 'images/' + bd.img : null;
      var bossIdx = (fl - 1) % BOSS_LIST.length;
      var iconHtml = bossIcon
        ? '<img src="' + bossIcon + '" style="width:32px;height:32px;vertical-align:middle;border-radius:4px;box-shadow:0 0 5px #000;" onerror="BOSS_LIST[' + bossIdx + '].imgFailed=true; this.outerHTML=\'<span style=&quot;font-size:24px;vertical-align:middle;&quot;>\' + (bd.emoji || \'👾\') + \'</span>\';">'
        : '<span style="font-size:24px;vertical-align:middle;">' + (bd.emoji || '👾') + '</span>';

      var twCost = towerChallengeCost(fl);
      h += '<div class="tower-floor ' + towerClass + (cleared ? ' cleared' : '') + (unlocked ? '' : ' locked') + '" data-tower-tip="' + fl + '">' +
        '<span class="tf-emoji" style="margin-right:12px;">' + iconHtml + '</span>' +
        '<span class="tf-name' + (purgatory ? ' purgatory-boss' : '') + '" style="vertical-align:middle;">第 ' + fl + ' 層・' + bd.name + (cleared ? ' ✅' : '') + '</span>' +
        '<span class="tf-hint" style="margin-left:auto; margin-right:10px;">建議野外階段 ' + (4 + fl * 5) + '+｜挑戰費 <span style="color:' + (G.player.gold >= twCost ? '#ffd700' : '#fca5a5') + '">💰' + fmt(twCost) + '</span></span>' +
        (unlocked
          ? '<button class="btn sm" data-tower-floor="' + fl + '">挑戰</button>' +
          '<button class="btn sm" data-tower-auto="' + fl + '" data-tip="連續挑戰此層（次數見上方設定）：金幣不足或次數用完自動停止並回到野外">🔁 連挑</button>'
          : '<span class="tf-lock">🔒</span>') +
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
      setTimeout(function () {
        var el = document.querySelector('.tower-floor[data-tower-tip="' + (G.tower.highest + 1) + '"]');
        if (el) el.scrollIntoView({ behavior: 'auto', block: 'center' });
      }, 10);
    }
  }
}

function towerTimerNow() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
}

function stopTowerTimerAnimation() {
  if (UI.towerTimerRaf) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(UI.towerTimerRaf);
    else clearTimeout(UI.towerTimerRaf);
    UI.towerTimerRaf = 0;
  }
  UI.towerTimerAnchor = null;
}

function scheduleTowerTimerFrame() {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(renderTowerTimerFrame);
  return setTimeout(renderTowerTimerFrame, 50);
}

function formatTowerTimerSeconds(seconds) {
  return Math.max(0, Number(seconds) || 0).toFixed(1);
}

function renderTowerTimerFrame() {
  if (!G.tower.active || UI.tab !== 'tower' || !TOWER.boss) {
    stopTowerTimerAnimation();
    return;
  }
  var paused = typeof isCombatPaused === 'function' && isCombatPaused();
  if (paused) UI.towerTimerAnchor = null;
  var anchor = UI.towerTimerAnchor;
  var remain = !paused && anchor
    ? Math.max(0, towerTimeLimitWithTalents() - (anchor.elapsed + (towerTimerNow() - anchor.at) / 1000))
    : Math.max(0, towerTimeLimitWithTalents() - TOWER.elapsed);
  var timerEl = $id('tw-timer');
  if (timerEl) {
    timerEl.textContent = formatTowerTimerSeconds(remain) + 's';
    timerEl.classList.toggle('urgent', remain < 15);
  }
  if (paused) {
    UI.towerTimerRaf = 0;
    return;
  }
  UI.towerTimerRaf = scheduleTowerTimerFrame();
}

// 高塔戰鬥動態渲染（每 tick）；倒數文字另外以逐幀動畫更新
function renderTowerFight() {
  if (!G.tower.active || UI.tab !== 'tower') {
    stopTowerTimerAnimation();
    return;
  }
  var st = getStats();
  var b = TOWER.boss, p = TOWER.player;
  if (!b || !p) {
    stopTowerTimerAnimation();
    return;
  }
  var paused = typeof isCombatPaused === 'function' && isCombatPaused();
  if (paused) {
    stopTowerTimerAnimation();
    renderTowerTimerFrame();
  } else {
    if (!UI.towerTimerAnchor || UI.towerTimerAnchor.elapsed !== TOWER.elapsed) {
      UI.towerTimerAnchor = { elapsed: TOWER.elapsed, at: towerTimerNow() };
    }
    if (!UI.towerTimerRaf) renderTowerTimerFrame();
  }
  $id('tw-enrage').style.display = TOWER.enraged ? '' : 'none';
  // 連續挑戰進度（第 X/Y 場）
  var autoEl = $id('tw-auto-status');
  if (autoEl) {
    if (TOWER.auto) {
      autoEl.style.display = '';
      autoEl.textContent = '🔁 連挑 第 ' + (TOWER.auto.done + 1) + '/' + TOWER.auto.total + ' 場（勝 ' + TOWER.auto.wins + '）';
    } else {
      autoEl.style.display = 'none';
    }
  }
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
  $id('tb-name').className = 'cb-name' + (b.purgatory ? ' purgatory-boss' : '');
  $id('tb-name').innerHTML = b.name;
  if ($id('tb-level')) {
    $id('tb-level').className = 'cb-level' + (b.purgatory ? ' purgatory-boss' : '');
    $id('tb-level').textContent = 'Lv.' + b.level;
  }
  $id('tb-hp').style.width = clamp(b.hp / b.maxHp * 100, 0, 100) + '%';
  var bSh = (b.shield > 0.5) ? '<span style="color:var(--info)">+' + fmt(Math.max(0, b.shield)) + '</span>' : '';
  $id('tb-hptext').innerHTML = fmt(Math.max(0, b.hp)) + bSh + ' / ' + fmt(b.maxHp) + '（' + Math.round(b.hp / b.maxHp * 100) + '%）';
  $id('tb-status').innerHTML = entStatus(b) + (b.attr && ELEM_INFO[b.attr] ? ' 屬性:' + ELEM_INFO[b.attr].emoji + ELEM_INFO[b.attr].name : (b.elem ? ' 屬性:' + ENCHANTS[b.elem].emoji : ''));
  $id('tp-hp').style.width = clamp(p.hp / st.hp * 100, 0, 100) + '%';
  renderPlayerShieldBar('tp', p, st);
  $id('tp-hptext').innerHTML = fmt(Math.max(0, p.hp)) + playerShieldText(p) + ' / ' + fmt(st.hp);
  $id('tp-status').textContent = entStatus(p);
  renderMpSkill(p, 'tp');
  $id('tw-dps').textContent = 'DPS ' + fmt(TOWER.elapsed > 1 ? TOWER.dmgDealt / TOWER.elapsed : 0) +
    '（需求 ' + fmt(b.maxHp / towerTimeLimitWithTalents()) + '）';
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
  refreshBuffTooltip();
  if (UI.tab === 'tower' && G.tower.active) renderTowerFight();
  d.battle = false;
  if (d.equip && UI.tab === 'equip') { renderEquip(); d.equip = false; }
  if (d.inv && UI.tab === 'equip') { renderInventory(); d.inv = false; }
  // 舊生產線頁已移除；零件庫/附魔書/強化統計變動（dirty.factory）一併驅動熔爐頁重繪
  if ((d.newforge || d.inv || d.factory) && UI.tab === 'newforge') { renderNewForge(); d.newforge = false; d.factory = false; }
  if ((d.forge || d.inv) && UI.tab === 'forge') { renderForge(); d.forge = false; d.inv = false; }
  if (UI.tab === 'forge' && forgeIsBusy()) renderForgeProgress();
  // 神鑄頁籤運行中小圖標：鑄造進行時旋轉顯示（不論目前所在分頁）
  var runInd = $id('forge-run-ind');
  if (runInd) {
    var forgeRunning = forgeIsBusy();
    if (forgeRunning !== (runInd.style.display !== 'none')) {
      runInd.style.display = forgeRunning ? '' : 'none';
    }
  }
  if (d.tower && UI.tab === 'tower') { renderTower(); d.tower = false; }
  if (d.gems && UI.tab === 'gems') { renderGems(); d.gems = false; }
  if (UI.tab === 'gems') updateShopCountdown(); // 商店重置倒數即時更新
  if (d.skills && UI.tab === 'skills') { renderSkills(); d.skills = false; }
  if (d.talents && UI.tab === 'talents') { renderTalents(); d.talents = false; }

  // 本地測試服承傷顯示實時更新
  var host = window.location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLocal) {
    updateDmgAbsorb();
  }
}

// 本地測試服：實時更新物理與魔法總承傷及明細提示 (Tooltip)
function updateDmgAbsorb() {
  var physEl = $id('r-phys-absorb');
  var magicEl = $id('r-magic-absorb');
  if (!physEl || !magicEl) return;

  var p = G.player, st = getStats();
  var pEnt = (typeof FIELD !== 'undefined' && FIELD) ? FIELD.player : null;
  var hp = (pEnt && typeof pEnt.hp === 'number') ? pEnt.hp : st.hp;
  var shield = (pEnt && typeof pEnt.shield === 'number') ? pEnt.shield : 0;
  
  var dCfg = playerDefCfg(pEnt);
  var attackerLevel = st.level || 1;

  // 各類減傷率
  var rPhysDef = defReduction(dCfg.def || 0, attackerLevel);
  var rMagicDef = defReduction(dCfg.mdef || 0, attackerLevel);
  var rPhysRes = physicalResistanceReduction(dCfg.pRes || 0, attackerLevel);
  var rMagicRes = magicResistanceReduction(dCfg.mRes || 0, attackerLevel);
  var rSanctuary = dCfg.dmgRed ? (clamp(dCfg.dmgRed, 0, 50) / 100) : 0;
  var rGlobal = globalDamageReduction(dCfg.globalDmgRed || 0);

  var rNormal = enemyTypeDamageReduction(dCfg.normalDmgRed || 0, attackerLevel);
  var rElite = enemyTypeDamageReduction(dCfg.eliteDmgRed || 0, attackerLevel);
  var rBoss = enemyTypeDamageReduction(dCfg.bossDmgRed || 0, attackerLevel);
  var rTypeMax = Math.max(rNormal, rElite, rBoss);

  // 剩餘比例 (1 - 減傷)
  var physMult = (1 - rPhysDef) * (1 - rPhysRes) * (1 - rSanctuary) * (1 - rGlobal) * (1 - rTypeMax);
  var magicMult = (1 - rMagicDef) * (1 - rMagicRes) * (1 - rSanctuary) * (1 - rGlobal) * (1 - rTypeMax);

  var physAbsorb = physMult > 0 ? (hp + shield) / physMult : Infinity;
  var magicAbsorb = magicMult > 0 ? (hp + shield) / magicMult : Infinity;

  // 更新 UI：顯示完整數值及簡寫，例如 999,999,999 (999M)
  physEl.textContent = physAbsorb === Infinity ? '∞' : fmtFull(physAbsorb) + ' (' + fmt(physAbsorb) + ')';
  magicEl.textContent = magicAbsorb === Infinity ? '∞' : fmtFull(magicAbsorb) + ' (' + fmt(magicAbsorb) + ')';

  // 更新 tooltip
  var physParent = physEl.parentNode;
  var magicParent = magicEl.parentNode;
  if (physParent) {
    physParent.setAttribute('data-tt-title', '物理總承傷');
    var physDesc = '角色能承受的一次性最大物理傷害值。<br>' +
                   '公式：(血量+護盾)/(1-各類減傷)<br><br>' +
                   '<span style="color:#4ade80">當前血量：</span>' + fmtFull(hp) + '<br>' +
                   '<span style="color:#4ade80">當前護盾：</span>' + fmtFull(shield) + '<br>' +
                   '<span style="color:#ffd700">物理防禦減傷：</span>' + (rPhysDef * 100).toFixed(4) + '%<br>' +
                   '<span style="color:#ffd700">物理抗性減傷：</span>' + (rPhysRes * 100).toFixed(4) + '%<br>' +
                   '<span style="color:#ffd700">聖佑被動減傷：</span>' + (rSanctuary * 100).toFixed(2) + '%<br>' +
                   '<span style="color:#ffd700">全局減傷：</span>' + (rGlobal * 100).toFixed(4) + '%<br>' +
                   '<span style="color:#ffd700">敵種最大減傷：</span>' + (rTypeMax * 100).toFixed(4) + '%<br><br>' +
                   '<span style="color:#ffd700">物理承傷總值：</span>' + (physAbsorb === Infinity ? '無窮大' : fmtFull(physAbsorb));
    physParent.setAttribute('data-tt-desc', physDesc);
    physParent.removeAttribute('title');
  }
  if (magicParent) {
    magicParent.setAttribute('data-tt-title', '魔法總承傷');
    var magicDesc = '角色能承受的一次性最大魔法傷害值。<br>' +
                    '公式：(血量+護盾)/(1-各類減傷)<br><br>' +
                    '<span style="color:#4ade80">當前血量：</span>' + fmtFull(hp) + '<br>' +
                    '<span style="color:#4ade80">當前護盾：</span>' + fmtFull(shield) + '<br>' +
                    '<span style="color:#ffd700">魔法防禦減傷：</span>' + (rMagicDef * 100).toFixed(4) + '%<br>' +
                    '<span style="color:#ffd700">魔法抗性減傷：</span>' + (rMagicRes * 100).toFixed(4) + '%<br>' +
                    '<span style="color:#ffd700">聖佑被動減傷：</span>' + (rSanctuary * 100).toFixed(2) + '%<br>' +
                    '<span style="color:#ffd700">全局減傷：</span>' + (rGlobal * 100).toFixed(4) + '%<br>' +
                    '<span style="color:#ffd700">敵種最大減傷：</span>' + (rTypeMax * 100).toFixed(4) + '%<br><br>' +
                    '<span style="color:#ffd700">魔法承傷總值：</span>' + (magicAbsorb === Infinity ? '無窮大' : fmtFull(magicAbsorb));
    magicParent.setAttribute('data-tt-desc', magicDesc);
    magicParent.removeAttribute('title');
  }
}

function talentNodeHTML(def, turn) {
  var lv = talentLevel(def.id);
  var unlocked = talentUnlocked(def.id);
  var disabled = !!def.disabled;
  var lockText = disabled ? (def.disabledReason || '目前暫不開放升級') : (reincarnationCountSafe() < turn ? '需 ' + turn + ' 轉' : '尚未開放');
  var locked = !unlocked || disabled;
  var aria = def.name + (disabled ? '（' + lockText + '）' : '');
  return '<button type="button" class="talent-icon' + (lv > 0 ? ' learned' : '') + (lv >= TALENT_MAX_LEVEL ? ' maxed' : '') + (locked ? ' locked' : '') + (disabled ? ' temporarily-disabled' : '') + '" data-talent-select="talent:' + def.id + '" data-talent-tip="' + def.id + '" aria-label="' + esc(aria) + '">' +
    '<span class="talent-icon-glyph">' + def.emoji + '</span>' +
    '<span class="talent-icon-level">Lv.' + lv + '/' + TALENT_MAX_LEVEL + '</span>' +
    (locked ? '<span class="talent-icon-lock">🔒 ' + lockText + '</span>' : '') +
    '</button>';
}

function potentialNodeHTML(def, index) {
  var lv = potentialLevel(def.id);
  var unlocked = potentialUnlocked(def.id);
  var max = potentialSkillMaxLv();
  var disabled = potentialTemporarilyDisabled(def.id);
  var cls = 'tree-cell potential-icon' + (lv > 0 ? ' learned' : '') + (!unlocked || disabled ? ' locked' : '') + (disabled ? ' temporarily-disabled' : '');
  var aria = def.name + (disabled ? '（' + (def.disabledReason || '目前暫不開放升級') + '）' : '');
  return '<div class="' + cls + '" data-talent-select="potential:' + def.id + '" data-talent-tip="potential:' + def.id + '" aria-label="' + esc(aria) + '">' +
    '<span class="tc-emoji">' + def.emoji + '</span>' +
    (lv > 0 ? '<span class="tc-lv' + (lv >= max ? ' max-lv' : '') + '">' + lv + '</span>' : (!unlocked ? '<span class="tc-lock">🔒</span>' : '')) +
    (disabled ? '<span class="tc-lock">🔒 暫不開放</span>' : '') +
    '</div>';
}

function talentEffectLabel(def, value) {
  if (def.stat === 'potentialUnlock') return fmt(value) + ' 個潛力節點';
  var elementTalentNames = {
    elemFire: '火焰', elemIce: '寒冰', elemLightning: '雷電',
    elemPoison: '劇毒', elemLight: '聖光', elemDark: '暗影'
  };
  // 天賦每級可能是小數（元素附傷 0.25%、傷害偏折 0.5%），fmt 會捨去小數 → 一律保留至多 2 位小數
  if (elementTalentNames[def.stat]) return String(Math.round(value * 100) / 100) + '%' + elementTalentNames[def.stat] + '傷害';
  return String(Math.round(value * 100) / 100) + (def.stat.indexOf('Pct') >= 0 || /Dmg|Res|Rate|DmgRed|skill|evasion|hit|crit/.test(def.stat) ? '%' : '');
}

function talentEffectDescription(def, value) {
  if (def.cat === 'potential') {
    var current = Math.max(0, Number(value) || 0);
    if (def.stat === 'potentialCdr') return '每級使所有技能冷卻時間額外縮短 1%；目前額外縮短：' + fmt(current) + '%';
    if (def.stat === 'potentialRevive') return '每場戰鬥第一次受到致命傷害時復活，恢復最大生命值的 ' + fmt(Math.min(100, current * 20)) + '%';
    if (def.stat === 'potentialLootDup') return '每級使掉落物數量額外增加 5%；目前額外掉落加成：' + fmt(current) + '%';
    if (def.stat === 'potentialInvCap') return '每級增加 100 格背包容量；目前額外容量：' + fmt(current) + ' 格';
    if (def.stat === 'potentialElemAtk') return '每級使所有元素附加傷害額外提高 2%；目前額外提高：' + fmt(current) + '%';
    if (def.stat === 'potentialExecute') return '目標生命低於 20% 時，每級使造成的傷害額外提高 2%；目前額外提高：' + fmt(current) + '%';
    if (def.stat === 'potentialShieldOverflow') return '每級將溢出護盾的 5% 轉換為生命回復；目前轉換比例：' + fmt(current) + '%';
    if (def.stat === 'potentialManaRefund') return '技能命中敵人後，每級返還技能消耗法力的 2%；目前返還比例：' + fmt(current) + '%';
    if (def.stat === 'potentialTowerTime') return '每級增加高塔挑戰限時 1 秒；目前額外時間：' + fmt(current) + ' 秒';
    if (def.stat === 'potentialOffline') return '每級使離線收益額外提高 5%；目前額外提高：' + fmt(current) + '%';
  }
  if (def.id === 't4_potential') return '解鎖新類型技能「潛力」三個並給予' + fmt(value) + '點技能點。';
  if (def.id === 't5_potential') return '解鎖新類型技能「潛力」兩個並給予' + fmt(value) + '點技能點。';
  return esc(def.desc) + talentEffectLabel(def, value);
}

function talentDescriptionValue(def, level, turn) {
  var lv = Math.max(1, Math.floor(Number(level) || 0));
  if (def.id === 't4_potential' || def.id === 't5_potential') return talentLevelValue(def, lv);
  return def.stat === 'potentialUnlock'
    ? potentialCountForLevel(def, lv)
    : talentLevelValue(def, lv) * talentCompleteMultiplier(turn);
}

function talentTreeLevelTotal(turn) {
  return (TALENT_TREES[turn] || []).reduce(function (sum, def) { return sum + talentLevel(def.id); }, 0);
}

function openTalentModal(kind, id) {
  if (kind === 'potential') {
    UI.selTalent = null;
    openSkillModal('potential:' + id);
    return;
  }
  UI.selTalent = { kind: kind, id: id };
  hideTooltip();
  var overlay = $id('talent-modal');
  if (overlay) overlay.style.display = 'flex';
  renderTalentModal();
}

function closeTalentModal() {
  var overlay = $id('talent-modal');
  if (overlay) overlay.style.display = 'none';
  UI.selTalent = null;
}

/* ---- 離線收益確認彈窗（applyOfflineProgress → save.js 呼叫；收益已入帳，此處為確認展示） ---- */
function showOfflineSummary(sum) {
  var overlay = $id('offline-modal'), body = $id('offline-modal-body');
  if (!overlay || !body || !sum) return;
  var hrs = Math.floor(sum.seconds / 3600), mins = Math.floor((sum.seconds % 3600) / 60);
  var h = '<div class="talent-modal-head"><span class="talent-modal-icon">🌙</span><b>離線收益</b> ' +
    '<span class="dim-text">離線 ' + (hrs ? hrs + ' 小時 ' : '') + mins + ' 分鐘</span></div>';
  h += '<div class="offline-sum-row">⚔️ 擊殺：Lv.' + fmt(sum.stage) + ' ' + esc(sum.zoneName || '') + '菁英怪 ×' + fmt(sum.kills) + '</div>';
  h += '<div class="offline-sum-row">💡 經驗 +' + fmt(sum.xp) + '　💰 金幣 +' + fmt(sum.gold) + '</div>';
  var loot = [];
  for (var r = 0; r < RARITIES.length; r++) {
    if (sum.equips && sum.equips[r]) {
      loot.push('<span style="color:' + RARITIES[r].color + '">' + esc(RARITIES[r].name) + '裝備</span>×' + fmt(sum.equips[r]));
    }
  }
  if (sum.gems) {
    for (var glv = 1; glv <= 5; glv++) {
      if (sum.gems[glv]) loot.push('💎Lv.' + glv + ' 寶石×' + fmt(sum.gems[glv]));
    }
  }
  if (sum.books) loot.push('📖附魔書×' + fmt(sum.books));
  if (sum.essence) loot.push('<img src="images/icon_ancient_essence.png" class="res-icon" alt="太古精華">太古精華×' + fmt(sum.essence));
  if (sum.dust) loot.push('💫魔塵×' + fmt(sum.dust));
  if (sum.parts) loot.push('🔧自動機組零件×' + fmt(sum.parts));
  if (sum.scrap) loot.push('🔩碎片×' + fmt(sum.scrap) + '（輸送帶滿載折算）');
  h += '<div class="offline-sum-title">📦 掉落明細（裝備已送入輸送帶）</div>';
  h += '<div class="offline-sum-loot">' + (loot.length ? loot.join('　') : '（無掉落）') + '</div>';
  body.innerHTML = h;
  overlay.style.display = 'flex';
}

function closeOfflineSummary() {
  var overlay = $id('offline-modal');
  if (overlay) overlay.style.display = 'none';
}

function renderTalentModal() {
  var body = $id('talent-modal-body');
  var overlay = $id('talent-modal');
  if (!body || !overlay || overlay.style.display === 'none') return;
  var sel = UI.selTalent;
  if (!sel) return;
  var def = talentDef(sel.id);
  if (!def) { closeTalentModal(); return; }
  var turn = talentTurn(sel.id);
  var lv = talentLevel(sel.id);
  var maxLv = TALENT_MAX_LEVEL;
  var unlocked = talentUnlocked(sel.id);
  var disabled = !!def.disabled;
  // 0 級尚未產生實際加成，但說明要先讓玩家看到升到 1 級後會得到的效果。
  var descriptionLv = Math.max(1, lv);
  var current = talentDescriptionValue(def, descriptionLv, turn);
  var next = talentDescriptionValue(def, lv + 1, turn);
  var points = G.player.reincarnationTalentPoints || 0;
  var title = turn + ' 轉天賦';
  var upgradeAttr = 'data-talent-up="' + def.id + '"';
  var maxAttr = 'data-talent-max="' + def.id + '"';
  var downAttr = 'data-talent-down="' + def.id + '"';
  var deleteAttr = 'data-talent-delete="' + def.id + '"';
  var cost = lv + 1;
  var maxed = lv >= maxLv;
  var disabledNotice = disabled ? '<div class="hint">🔒 目前暫不開放升級</div>' : '';
  var h = '<div class="talent-modal-head"><span class="talent-modal-icon">' + def.emoji + '</span><b>' + esc(def.name) + '</b> <span class="dim-text">Lv.' + lv + '/' + maxLv + '｜' + title + '</span>' +
    (maxed ? '<span class="talent-modal-complete">已滿級！</span>' : '') + '</div>';
  h += '<div class="talent-modal-desc"><b>' + talentEffectDescription(def, current) + '</b></div>' + disabledNotice;
  h += '<div class="talent-modal-copy' + (maxed ? ' talent-modal-copy-maxed' : '') + '">';
  if (!maxed && !disabled) {
    h += '<div>下一級：<b>' + talentEffectDescription(def, next) + '</b></div>';
    h += '<div>消耗天賦點：' + cost + '</div>';
  }
  if (talentCompleteMultiplier(turn) > 1) h += '<div class="talent-modal-complete">該轉 8 個天賦已全滿，效果 ×2</div>';
  if (!unlocked) h += '<div class="hint">🔒 需要達到 ' + turn + ' 轉</div>';
  h += '</div><div class="talent-modal-points">轉生天賦點：' + fmtFull(points) + '</div>';
  h += '<div class="talent-modal-actions">';
  if (!disabled && unlocked && lv < maxLv) {
    h += '<button class="btn sm" ' + upgradeAttr + '>⬆️ 升級</button>';
    h += '<button class="btn sm" ' + maxAttr + '>⚡ 一鍵升滿</button>';
  } else { h += '<div></div><div></div>'; }
  if (lv > 0) h += '<button class="btn sm warn" ' + downAttr + '>⬇️ 降 1 級</button><button class="btn sm danger" ' + deleteAttr + '>清除</button>';
  else h += '<div></div><div></div>';
  h += '</div>';
  body.innerHTML = h;
}

function renderTalents() {
  var root = $id('talent-root');
  if (!root) return;
  var rc = reincarnationCountSafe();
  var h = '<div class="panel talent-summary"><div class="sec-title">🌟 天賦系統</div>' +
    '<div class="hint">1 轉後開放；天賦使用轉生天賦點，升級成本為目標等級。潛力是新的技能分類，與特殊、被動共用技能點，不另設潛力點。</div>' +
    '<div class="talent-point-line">轉生天賦點：<b>' + fmtFull(G.player.reincarnationTalentPoints || 0) + '</b></div></div>';
  if (rc < 1) h += '<div class="panel talent-locked-banner">🔒 天賦系統將於完成 1 轉後開放。</div>';
  for (var turn = 1; turn <= REINCARNATION_MAX; turn++) {
    var tree = TALENT_TREES[turn];
    if (!tree) {
      h += '<div class="panel talent-tree-panel locked"><div class="sec-title">' + turn + ' 轉天賦</div><div class="talent-locked-banner">🔒 本版本尚未開放</div></div>';
      continue;
    }
    var treeTotal = talentTreeLevelTotal(turn);
    var treeStatus = rc >= turn ? '已開啟' : '未開啟';
    var treeMax = TALENT_MAX_LEVEL * 8;
    var treeComplete = treeTotal >= treeMax;
    var treeCount = treeComplete ? '<span class="talent-tree-count">' + treeTotal + '/' + treeMax + '</span>' : treeTotal + '/' + treeMax;
    var treeNotice = treeComplete
      ? '<span class="talent-tree-complete">' + turn + '轉天賦全滿效果已加倍！</span>'
      : turn + '轉所有技能升至全滿時此列所有技能效果加倍';
    h += '<div class="panel talent-tree-panel"><div class="sec-title">' + turn + '轉天賦 <span class="dim-text">' + treeStatus + '　(' + treeCount + ')　' + treeNotice + '</span></div><div class="talent-grid">';
    h += tree.map(function (def) { return talentNodeHTML(def, turn); }).join('') + '</div></div>';
  }
  // 潛力屬於技能分類，天賦頁只保留轉生天賦點摘要。
  root.innerHTML = h;
  renderTalentModal();
}

/* ---- 技能分頁（技能樹 + 融合） ---- */
UI.selSkill = null;      // 目前選取的技能 id
UI.selTalent = null;     // { kind: 'talent'|'potential', id }
UI.fuseSlots = [];       // 融合素材槽（最多 4）

function skillCellHTML(id) {
  var sk = skillDef(id);
  if (!sk) return '';
  var lv = skillLevel(id);
  var lock = tierLockReason(id);
  var inLoadout = (G.player.loadout || []).indexOf(id) >= 0;
  var maxLv = skillMaxLv(sk);
  var inFusion = (UI.fuseSlots || []).indexOf(id) >= 0;
  var cls = 'tree-cell' + (lv > 0 ? ' learned' : '') + (lock ? ' locked' : '') +
    (UI.selSkill === id ? ' selected' : '') + (inLoadout ? ' equipped' : '') +
    (inFusion ? ' fusion-selected' : '');
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
  var potentialCells = POTENTIAL_TALENTS.map(function (def, index) { return potentialNodeHTML(def, index); });
  var potentialRows = '';
  for (var pr = 0; pr < potentialCells.length; pr += 4) {
    potentialRows += '<div class="tree-row">' + potentialCells.slice(pr, pr + 4).join('') + '</div>';
  }
  h += '<div class="tree-panel potential-skill-panel"><div class="tree-title">✨ 潛力 <span class="dim-text">技能分類；使用技能點與金幣　已解鎖 ' + potentialUnlockedCount() + '/' + POTENTIAL_NODE_COUNT + '</span></div>' + potentialRows + '</div>';
  treesBox.innerHTML = h;

  renderSkillModal();
  renderFusionPanel();
}

/* ---- 技能升級彈窗 ---- */
function potentialSkillId(ref) {
  if (typeof ref !== 'string' || ref.indexOf('potential:') !== 0) return null;
  return ref.slice('potential:'.length);
}

function openSkillModal(id) {
  UI.selSkill = id;
  UI.selTalent = null;
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
  var ref = UI.selSkill;
  var potentialId = potentialSkillId(ref);
  var isPotential = potentialId !== null;
  var id = isPotential ? potentialId : ref;
  var sk = id ? (isPotential ? potentialDef(id) : skillDef(id)) : null;
  if (!sk) { closeSkillModal(); return; }
  var lv = isPotential ? potentialLevel(id) : skillLevel(id);
  var maxLv = isPotential ? potentialSkillMaxLv() : skillMaxLv(sk);
  var lock = isPotential
    ? (potentialTemporarilyDisabled(id) ? '此潛力技能目前暫不開放升級' : (potentialUnlocked(id) ? null : '潛力節點尚未解鎖'))
    : tierLockReason(id);
  var inLoadout = !isPotential && (G.player.loadout || []).indexOf(id) >= 0;
  var isFusion = !isPotential && sk.cat === 'fusion';
  var description = function (level) {
    return isPotential ? talentEffectDescription(sk, level * sk.per) : describeSkill(id, level);
  };
  var category = isPotential ? '潛力' : (SKILL_CATS[sk.cat] ? SKILL_CATS[sk.cat].name : '融合技');
  var h = '<div class="skd-head"><span class="skd-emoji">' + sk.emoji + '</span><b>' + esc(sk.name) + '</b> ' +
    '<span class="dim-text">Lv.' + lv + '/' + maxLv + '｜' + category + '</span>' +
    (!isPotential && sk.cat !== 'passive' ? '<span class="sk-meta">🔵 ' + skillManaCost(sk, Math.max(1, lv)) + ' MP　⏱️ ' + sk.cd + 's</span>' : '') + '</div>';
  h += '<div class="sk-desc">' + description(Math.max(1, lv)) + '</div>';
  if (lv > 0 && lv < maxLv) {
    h += '<div class="skd-next dim-text">下一級：' + description(lv + 1) + '</div>';
  }
  if (sk.flavor) h += '<div class="sk-flavor">' + esc(sk.flavor) + '</div>';
  if (lock) h += '<div class="hint">🔒 ' + esc(lock) + '</div>';

  h += '<div style="text-align: right; margin-top: 12px; color: #facc15; font-size: 14px; font-weight: bold;">技能點：' + availableSkillPoints() + '</div>';
  h += '<div class="detail-actions skill-modal-actions">';
  if (lv < maxLv && !lock) {
    var cost = skillUpgradeCost(lv);
    var skillRef = isPotential ? 'potential:' + id : id;
    h += '<button class="btn sm" data-skill-learn="' + skillRef + '" data-tip="花費 ' + fmt(cost) + ' 金幣"' + (G.player.gold < cost ? ' disabled' : '') + '>' +
      (lv === 0 ? '📖 學習' : '⬆️ 升級') + '</button>';
    h += '<button class="btn sm" data-skill-max="' + skillRef + '" data-tip="自動消耗技能點與金幣，升到目前技能上限">⚡ 一鍵滿級</button>';
  } else if (lv >= maxLv) {
    h += '<div style="text-align:center; padding: 4px; color: var(--good); font-size: 12px;">已滿級</div>';
    h += '<div></div>'; // 保留一鍵滿級欄位，讓後方按鈕位置固定
  } else {
    h += '<div></div><div></div>'; // 升級與一鍵滿級欄位
  }

  if (lv > 0) {
    h += '<button class="btn sm warn" data-skill-downgrade="' + (isPotential ? 'potential:' + id : id) + '" data-tip="退回 1 技能點（不退還金幣）">⬇️ 降級</button>';
  } else {
    h += '<div></div>'; // empty grid cell
  }

  if (!isPotential && sk.cat !== 'passive' && lv > 0) {
    h += inLoadout
      ? '<button class="btn sm warn" data-skill-unequip="' + id + '">卸下</button>'
      : '<button class="btn sm" data-skill-equip="' + id + '">⚔️ 裝備</button>';
  } else {
    h += '<div></div>'; // empty grid cell
  }

  if (!isPotential && !isFusion && sk.cat !== 'passive' && lv > 0) {
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
  if (sk.cat !== 'passive') h += '<div class="skt-meta">🔵 ' + skillManaCost(sk, Math.max(1, lv)) + ' MP　⏱️ ' + sk.cd + 's</div>';
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
function showTalentTooltip(ref, anchorEl) {
  var tip = $id('sk-tooltip');
  if (!tip || !anchorEl || typeof ref !== 'string') return;
  var isPotential = ref.indexOf('potential:') === 0;
  var id = isPotential ? ref.slice('potential:'.length) : ref;
  var def = isPotential ? potentialDef(id) : talentDef(id);
  if (!def) return;
  var lv = isPotential ? potentialLevel(id) : talentLevel(id);
  var maxLv = isPotential ? potentialSkillMaxLv() : TALENT_MAX_LEVEL;
  var turn = isPotential ? 0 : talentTurn(id);
  var displayLv = Math.max(1, lv);
  var current = isPotential ? displayLv * def.per : talentDescriptionValue(def, displayLv, turn);
  var next = isPotential
    ? (lv < maxLv ? (lv + 1) * def.per : current)
    : talentDescriptionValue(def, lv + 1, turn);
  var title = isPotential ? '潛力技能' : turn + ' 轉天賦';
  var h = '<div class="skt-name">' + def.emoji + ' ' + esc(def.name) +
    ' <span class="dim-text">Lv.' + lv + '/' + maxLv + '｜' + title + '</span></div>';
  h += '<div class="skt-desc">' + (isPotential ? talentEffectDescription(def, current) : talentEffectDescription(def, current)) + '</div>';
  if (lv < maxLv) h += '<div class="skt-desc">下一級：' + talentEffectDescription(def, next) + '</div>';
  if (!isPotential && !talentUnlocked(id)) h += '<div class="skt-lock">🔒 需要達到 ' + turn + ' 轉</div>';
  if (isPotential && potentialTemporarilyDisabled(id)) h += '<div class="skt-lock">🔒 此潛力技能目前暫不開放升級</div>';
  else if (isPotential && !potentialUnlocked(id)) h += '<div class="skt-lock">🔒 潛力節點尚未解鎖</div>';
  h += '<div class="skt-hint">點擊開啟升級面板</div>';
  tip.innerHTML = h;
  tip.style.display = 'block';
  UI.tooltipAnchor = anchorEl;
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
  UI.tooltipAnchor = anchorEl;
  var h = '<div class="skt-name">' + title + '</div>';
  h += '<div class="skt-desc">' + desc + '</div>';
  tip.innerHTML = h;
  tip.style.display = 'block';
  var r = anchorEl.getBoundingClientRect();
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var placement = anchorEl.getAttribute('data-tip-placement');
  var x = r.right + 10, y = r.top;
  if (placement === 'stage-left') {
    x = r.left - tw - 10;
    y = r.bottom + 8;
    if (y + th > window.innerHeight - 8) y = r.top - th - 8;
  } else if (placement === 'stage-right') {
    x = r.right + 10;
    y = r.bottom + 8;
    if (y + th > window.innerHeight - 8) y = r.top - th - 8;
  } else if (x + tw > window.innerWidth - 8) {
    x = r.left - tw - 10;
  }
  if (x + tw > window.innerWidth - 8) x = window.innerWidth - tw - 8;
  if (x < 8) x = 8;
  if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
  if (y < 8) y = 8;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function showBuffTooltip(anchorEl) {
  var tip = $id('sk-tooltip');
  if (!tip || !anchorEl) return;
  UI.tooltipAnchor = anchorEl;
  tip.innerHTML = '<div class="skt-name">💪 目前技能增益</div>' +
    '<div class="skt-desc" style="text-align:left;">' + buffTooltipDesc() + '</div>';
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
function showEnemyBuffTooltip(anchorEl) {
  var tip = $id('sk-tooltip');
  if (!tip || !anchorEl) return;
  UI.tooltipAnchor = anchorEl;
  tip.innerHTML = '<div class="skt-name">💪 目前狀態詳情</div>' +
    '<div class="skt-desc" style="text-align:left;">' + enemyBuffTooltipDesc(anchorEl) + '</div>';
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
function refreshOpenResourceTooltip() {
  var tip = $id('sk-tooltip');
  var anchorEl = UI.tooltipAnchor;
  if (!tip || tip.style.display !== 'block' || !anchorEl || !anchorEl.classList ||
    !anchorEl.classList.contains('res') || !document.documentElement.contains(anchorEl)) return;
  showStatTooltip(anchorEl.getAttribute('data-tt-title') || '', anchorEl.getAttribute('data-tt-desc') || '', anchorEl);
}
function refreshBuffTooltip() {
  var tip = $id('sk-tooltip');
  var anchor = UI.tooltipAnchor;
  if (!tip || tip.style.display !== 'block' || !anchor || !document.documentElement.contains(anchor)) return;
  var descEl = tip.querySelector('.skt-desc');
  if (!descEl || !anchor.closest) return;
  if (anchor.closest('[data-buff-tip]')) descEl.innerHTML = buffTooltipDesc();
  else if (anchor.closest('[data-enemy-buff-tip]')) descEl.innerHTML = enemyBuffTooltipDesc(anchor);
}
function showItemTooltip(it, anchorEl, opts) {
  var tip = $id('sk-tooltip');
  if (!tip) return;
  // 滑過提示為純資訊模式：不顯示洗煉與可能詞條說明按鈕（僅裝備詳情介面可操作）
  var h = itemDetailHTML(it, null, { showAffixReroll: false });
  if (opts && opts.hint) h += '<div class="skt-hint">' + opts.hint + '</div>';
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
  var hell = isHellTowerFloor(fl);
  var bossStats = bossStatsFor(fl);
  var bossXp = bossStats.xp;
  var soulRate = hellSoulOriginDropChance(fl);
  var ancientEssenceRate = ancientEssenceDropChanceForBoss(fl);

  var dropTip = '<div class="skt-name" style="margin-bottom:6px;">【挑戰費用】</div>' +
    '<div class="skt-desc" style="text-align:left;">💰 ' + fmt(towerChallengeCost(fl)) +
    ' 金幣</div>' +
    '<div class="skt-name" style="margin:6px 0;">【可能掉落物】</div>' +
    '<div class="skt-desc" style="text-align:left;">' +
    '💰 金幣 x' + fmt(200 * fl) + ' <span style="color:var(--dim)">(首通雙倍)</span><br>' +
    '✨ 經驗 x' + fmt(bossXp) + ' <span style="color:var(--dim)">(基礎，另加經驗加成)</span><br>' +
    '🔮 附魔精華 x' + (3 + fl) + ' <span style="color:var(--dim)">(100%)</span><br>' +
    '💎 隨機寶石 x2 <span style="color:var(--dim)">(100%)</span><br>' +
    '📖 隨機附魔書 x2 <span style="color:var(--dim)">(100%)</span><br>' +
    '💫 魔塵 <span style="color:var(--dim)">(' + fmt1(bossDustRate(fl)) + '%，神鑄材料)</span>' +
    '<br><img src="images/icon_ancient_essence.png" class="res-icon" alt="太古精華"> 太古精華 <span style="color:var(--dim)">(' + fmt1(ancientEssenceRate) + '%)</span>' +
    (hell ? '<br>🧿 魔魂本源 <span style="color:var(--dim)">(' + fmt1(soulRate) + '%，地獄之塔限定)</span>' : '') + '<br>' +
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

  var isBossTip = (anchorEl.id === 'btn-boss-tip' || anchorEl.id === 'btn-tower-result-boss-tip');
  var m = null;
  if (isBossTip) {
    m = TOWER.boss || (TOWER.floor ? makeBoss(TOWER.floor) : null);
  } else if (G.tower.active) {
    m = TOWER.boss || (TOWER.floor ? makeBoss(TOWER.floor) : null);
  } else {
    m = (typeof FIELD !== 'undefined' && FIELD ? FIELD.monster : null);
    if (!m) {
      var s = G.stage.current;
      var elite = isEliteStage(s);
      var base = monsterStatsFor(s, elite);
      var zn = currentZoneDef();
      var mtype = (zn && zn.pool && zn.pool.length) ? zn.pool[0] : { name: '未知怪物', emoji: '👾' };
      var mAspd = base.aspd * zn.aspdMult;
      m = {
        name: (elite ? '菁英・' : '') + mtype.name, emoji: mtype.emoji,
        level: base.level,
        maxHp: base.hp * zn.hpMult, hp: base.hp * zn.hpMult,
        atk: base.atk * zn.atkMult,
        def: base.def * zn.defMult, mdef: base.mdef * zn.defMult,
        magic: !!mtype.magic,
        aspd: mAspd, dodge: base.dodge, hit: base.hit,
        elite: elite, isBoss: false,
        gold: base.gold * zn.rewardMult, xp: base.xp * zn.rewardMult,
        ctrlRes: 0, elem: mtype.elem, attr: mtype.attr || null
      };
    }
  }

  if (!m) return;

  var title = isBossTip ? (m.name || '高塔 BOSS') : '敵人情報';
  var dropTip = '<div class="skt-name" style="margin-bottom:6px;">【' + title + '】</div>' +
    '<div class="skt-desc" style="text-align:left;">' +
    (m.magic ? '🔮 魔法攻擊力：' : '⚔️ 物理攻擊力：') + fmt(m.atk) + '<br>' +
    '⚡ 攻擊速度：' + fmt1(m.aspd) + ' 次/秒<br>' +
    '🛡️ 物理防禦：' + fmt(m.def) + '<br>' +
    '🔮 魔法防禦：' + fmt(m.mdef || m.def * 0.75) + '<br>' +
    '❤️ 最大生命：' + fmt(m.maxHp) + '<br>' +
    '🎯 命中率：' + (m.hit || 100) + '%<br>' +
    '🌀 閃避率：' + (m.dodge || 0) + '%<br>' +
    '🧠 控制抵抗：' + (m.ctrlRes || 0) + '%';

  // 屬性標籤（每個敵人必有）：顯示六大屬性，並受玩家「對X屬性傷害」加成影響
  var mAttr = m.attr || m.elem || null;
  if (mAttr && ELEM_INFO[mAttr]) {
    dropTip += '<br>🌌 屬性：' + ELEM_INFO[mAttr].emoji + ' ' + ELEM_INFO[mAttr].name +
      '<span style="color:var(--dim)">（受「對' + ELEM_INFO[mAttr].name + '屬性傷害」加成影響）</span>';
  }
  dropTip += '</div>';

  if (isBossTip) {
    var floor = TOWER.floor || 1;
    var rw = towerRewardFor(floor, false);
    var dustRate = bossDustRate(floor);
    var soulOriginRate = hellSoulOriginDropChance(floor);
    var ancientEssenceRate = ancientEssenceDropChanceForBoss(floor);

    var rewardLines = [];
    rewardLines.push('💰 金幣 x' + fmt(rw.gold));
    rewardLines.push('✨ 經驗 x' + fmt(m.xp));
    rewardLines.push('💎 寶石 等級 ' + rw.gemLevel + ' x2 顆');
    rewardLines.push('🔮 附魔精華 x' + rw.essence + '（另附魔書 x2）');
    if (dustRate > 0) rewardLines.push('💫 魔塵 (' + fmt1(dustRate) + '%)');
    if (soulOriginRate > 0) rewardLines.push('🧿 魔魂本源 (' + fmt1(soulOriginRate) + '%)');
    if (ancientEssenceRate > 0) rewardLines.push('🧿 太古精華 (' + fmt1(ancientEssenceRate) + '%)');
    if (rw.partChance > 0) rewardLines.push('⚙️ T' + rw.partTier + ' 零件 (' + rw.partChance + '%)');

    dropTip += '<div class="skt-name" style="margin:8px 0 6px;">【可能掉落】</div>' +
      '<div class="skt-desc" style="text-align:left;">' +
      rewardLines.join('<br>') + '</div>';
  } else {
    var rates = dropRatesFor(FIELD_DROP_TABLE, m.level);
    var equipStrs = [];
    for (var r = rates.length - 1; r >= 0; r--) {
      if (!rates[r]) continue;
      var rate = rates[r];
      var rateStr = rate + '%';
      equipStrs.push('⚔️ <span style="color:' + RARITIES[r].color + '; font-weight:bold;">' + RARITIES[r].name + '裝備</span> <span style="color:var(--dim)">(' + rateStr + ')</span>');
    }

    var dustLine = '';
    if (!G.tower.active) {
      var dustRate = fieldDustRate(m.level);
      if (dustRate > 0) dustLine = '💫 魔塵 <span style="color:var(--dim)">(' + fmt1(dustRate) + '%，神鑄材料)</span>';
    }

    if (equipStrs.length || dustLine) {
      dropTip += '<div class="skt-name" style="margin:8px 0 6px;">【可能掉落】</div>' +
        '<div class="skt-desc" style="text-align:left;">' +
        '💰 金幣 x' + fmt(m.gold) + ' <span style="color:var(--dim)">(基礎)</span><br>' +
        '✨ 經驗 x' + fmt(m.xp) + ' <span style="color:var(--dim)">(基礎)</span><br>' +
        (dustLine ? dustLine + (equipStrs.length ? '<br>' : '') : '') +
        equipStrs.join('<br>') + '</div>';
    }
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
  UI.tooltipAnchor = null;
}

function hideAffixPool() {
  var overlay = $id('affix-pool-overlay');
  if (!overlay) return;
  overlay.style.display = 'none';
  overlay.innerHTML = '';
  UI.affixPoolSource = null;
}

function toggleAffixPool(anchorEl) {
  var overlay = $id('affix-pool-overlay');
  var source = anchorEl && anchorEl.nextElementSibling;
  if (!overlay || !source) return;
  if (UI.affixPoolSource === source && overlay.style.display !== 'none') {
    hideAffixPool();
    return;
  }
  overlay.innerHTML = source.innerHTML;
  overlay.style.display = 'block';
  UI.affixPoolSource = source;

  var r = anchorEl.getBoundingClientRect();
  var tw = overlay.offsetWidth, th = overlay.offsetHeight;
  var x = r.right - tw, y = r.bottom + 8;
  if (x < 8) x = r.left;
  if (x + tw > window.innerWidth - 8) x = window.innerWidth - tw - 8;
  if (y + th > window.innerHeight - 8) y = r.top - th - 8;
  if (y < 8) y = 8;
  overlay.style.left = x + 'px';
  overlay.style.top = y + 'px';
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
      var lv = skillLevel(id);
      h += '<div class="tree-cell fusion-selected" data-fuse-remove="' + id + '" data-tip="點擊移出" style="margin:0 4px; cursor:pointer;">' +
        '<span class="tc-emoji">' + d.emoji + '</span>' +
        '<span class="tc-lv">' + lv + '</span>' +
        '</div>';
    } else {
      h += '<div class="tree-cell" style="margin:0 4px; border:2px dashed var(--border); background:transparent; opacity:0.5; color:var(--dim); font-size:11px; cursor:default;">素材 ' + (i + 1) + '</div>';
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
  fillGemTypeSelect($id('fuse-type'), true);
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
function fillGemTypeSelect(sel, includeAll) {
  if (!sel || sel.options.length) return;
  var h = '';
  if (includeAll) {
    h += '<option value="' + GEM_TYPE_ALL + '" style="color:#f5c542;font-weight:bold" selected>💎 全部類型寶石</option>';
  }
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
  if (t === GEM_TYPE_ALL) {
    var total = 0, available = 0;
    for (var allType in GEM_TYPES) {
      var allCount = gemCount(allType, lv);
      total += allCount;
      available += Math.floor(allCount / 2);
    }
    info.innerHTML = '「💎 全部類型寶石」' + GEM_NAMES[lv] + '庫存總計 ' + fmt(total) +
      ' 顆｜每次消耗同種類 2 顆＋<img src="images/icon_gold.png" class="res-icon">' + fmt(FUSE_GOLD_COST[lv]) +
      ' → 1 顆下一階寶石｜目前可合成 ' + available + ' 次';
    return;
  }
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
      var emojis = fg.stats.map(function (s) { return GEM_TYPES[s.type].emoji; }).join('');
      var yieldAmt = fusedGemDismantleYield(fg);
      var tip = esc(fusedGemLabel(fg)) + '｜融合 ' + (fg.fusions || 0) + ' 次｜拆解可得 ⛏️ ' + yieldAmt + ' 顆｜成本 ' + fusedGemL1Worth(fg) + ' 顆一級 × 70%';
      return '<span class="gem-chip fused-chip gem-inventory-cell" data-gdis-fused="' + fg.id + '" data-tip="' + tip + '">' +
        '<span class="gem-chip-count">×1</span>' +
        '<span class="gem-chip-emoji">' + emojis + '</span>' +
        '<span class="gem-chip-level" style="color:#f0abfc">融' + (fg.fusions || 0) + '</span></span>';
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

function gfuseShow(msg, type) {
  var box = $id('gfuse-result');
  if (!box) return;
  if (!UI.gfuseMsgs) UI.gfuseMsgs = [];
  UI.gfuseMsgs.unshift({ t: msg, c: type });
  if (UI.gfuseMsgs.length > 3) UI.gfuseMsgs.length = 3;
  box.innerHTML = UI.gfuseMsgs.map(function (m) {
    var cls = m.c === 'yellow' ? ' yellow' : (m.c === 'warn' ? ' warn' : '');
    return '<span class="gr-line' + cls + '">' + m.t + '</span>';
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
      if (ref.kind === 'plain') {
        var t = ref.type, flv = ref.lv || GEM_MAX_LEVEL;
        var fcol = GEM_TIER_COLORS[flv] || '#ffd700';
        h += '<span class="gem-chip gem-inventory-cell" data-gfuse-remove="' + i + '" style="border-color:' + fcol + '" data-tip="' + esc(gemLabel(t, flv)) + '｜點擊移出">' +
          '<span class="gem-chip-count">×1</span>' +
          '<span class="gem-chip-emoji">' + GEM_TYPES[t].emoji + '</span>' +
          '<span class="gem-chip-level">' + flv + '</span></span>';
      } else {
        var fg = findFusedGem(ref.id);
        if (fg) {
          var emojis = fg.stats.map(function (s) { return GEM_TYPES[s.type].emoji; }).join('');
          h += '<span class="gem-chip fused-chip gem-inventory-cell" data-gfuse-remove="' + i + '" data-tip="' + esc(fusedGemLabel(fg)) + '｜點擊移出">' +
            '<span class="gem-chip-count">×1</span>' +
            '<span class="gem-chip-emoji">' + emojis + '</span>' +
            '<span class="gem-chip-level" style="color:#f0abfc">融' + (fg.fusions || 0) + '</span></span>';
        } else {
          h += '<span class="loadout-slot filled" data-gfuse-remove="' + i + '">（已消失）</span>';
        }
      }
    } else {
      h += '<span class="loadout-slot" style="display:inline-flex;align-items:center;height:48px;box-sizing:border-box;vertical-align:top;">素材 ' + (i + 1) + '（5階以上）</span>';
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
    var emojis = fg.stats.map(function (s) { return GEM_TYPES[s.type].emoji; }).join('');
    chips.push('<span class="gem-chip fused-chip gem-inventory-cell" data-gfuse-pick="fused:' + fg.id + '" data-tip="' + esc(fusedGemLabel(fg)) + '｜已成功融合 ' + (fg.fusions || 0) + ' 次（下次成功率遞減）">' +
      '<span class="gem-chip-count">×1</span>' +
      '<span class="gem-chip-emoji">' + emojis + '</span>' +
      '<span class="gem-chip-level" style="color:#f0abfc">融' + (fg.fusions || 0) + '</span></span>');
  });
  pool.innerHTML = chips.length ? chips.join('') : '<span class="hint">沒有 5 階以上寶石 — 可透過寶石升階、寶石合成、商店或神鑄取得</span>';
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
  var levelEl = $id('gem-shop-level');
  if (levelEl) levelEl.textContent = '商店 Lv.' + s.level;
  var upgradeBtn = $id('shop-upgrade');
  if (upgradeBtn) {
    if (s.level >= GEM_SHOP_MAX_LEVEL) {
      upgradeBtn.textContent = '✅ 已滿級';
      upgradeBtn.disabled = true;
      upgradeBtn.removeAttribute('data-tip');
    } else {
      upgradeBtn.innerHTML = '⬆️ 升級（<img src="images/icon_gold.png" class="res-icon">' + fmt(gemShopUpgradeCost(s.level)) + '）';
      upgradeBtn.disabled = G.player.gold < gemShopUpgradeCost(s.level);
    }
  }
  var htmls = s.items.map(function (item, i) {
    var gt = GEM_TYPES[item.type];
    var c = GEM_TIER_COLORS[item.lv];
    return '<div class="shop-card' + (item.sold ? ' sold' : '') + '" style="border-color:' + c + '">' +
      '<div class="shop-emoji">' + gt.emoji + '</div>' +
      '<div class="shop-name" style="color:' + c + '">' + esc(GEM_NAMES[item.lv] + gt.name) + '</div>' +
      '<div class="shop-stat">' + esc(gt.statName.replace('%', '')) + ' +' +
      (gt.pct ? pctStr(gemStatValue(item.type, item.lv)) : fmt(gemStatValue(item.type, item.lv))) + '</div>' +
      (item.sold
        ? '<div class="shop-sold">已購買</div>'
        : '<button class="btn sm" data-shop-buy="' + i + '"><img src="images/icon_gold.png" class="res-icon"> ' + fmt(gemShopPrice(item.lv)) + '</button>') +
      '</div>';
  });
  for (var i = htmls.length; i < 20; i++) {
    htmls.push('<div class="shop-card empty" style="border-color:transparent;background:transparent;"></div>');
  }
  grid.innerHTML = htmls.join('');
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
  var hh = Math.floor(sec / 3600);
  var mm = Math.floor((sec % 3600) / 60);
  var ss = sec % 60;
  el.textContent = '本週期已刷新 ' + gemShop().refreshCount + ' 次｜重置倒數 ' + hh + ':' + (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
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
    s.info = '⏱️ 剩餘 ' + fmt1(Math.max(0, towerTimeLimitWithTalents() - TOWER.elapsed)) + 's' + (TOWER.enraged ? '　🔥狂暴中' : '');
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
      Math.ceil(Math.max(0, towerTimeLimitWithTalents() - TOWER.elapsed)) + 's';
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
  if (options.title === '轉生成功' && typeof reincarnationCount === 'function' && reincarnationCount() === 1) {
    var talentUnlockNotice = document.createElement('div');
    talentUnlockNotice.className = 'confirm-highlight';
    talentUnlockNotice.textContent = '已解鎖天賦系統！';
    msg.appendChild(talentUnlockNotice);
  }
  ok.textContent = options.okText || '確定';
  cancel.textContent = options.cancelText || '取消';
  ok.className = 'btn' + (options.danger ? ' danger' : '');
  cancel.className = 'btn';

  // 可選文字輸入框（options.input）：改名等需要輸入的操作用；未指定則維持純是/否確認
  var input = $id('confirm-input');
  var useInput = !!(options.input && input);
  if (input) {
    if (useInput) {
      input.style.display = '';
      input.value = (options.input.value != null) ? String(options.input.value) : '';
      input.placeholder = options.input.placeholder || '';
      if (options.input.maxLength) input.maxLength = options.input.maxLength; else input.removeAttribute('maxlength');
    } else {
      input.style.display = 'none';
      input.value = '';
      input.onkeydown = null;
    }
  }
  modal.style.display = 'flex';
  if (useInput) setTimeout(function () { try { input.focus(); input.select(); } catch (e) {} }, 0);

  function close() {
    modal.style.display = 'none';
    ok.onclick = null;
    cancel.onclick = null;
    modal.onclick = null;
    if (input) input.onkeydown = null;
  }
  function doConfirm() {
    var val = useInput && input ? input.value : undefined;
    close();
    if (typeof onConfirm === 'function') onConfirm(val);
  }

  ok.onclick = doConfirm;
  cancel.onclick = close;
  modal.onclick = function (e) {
    if (e.target === modal) close();
  };
  if (useInput && input) {
    input.onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doConfirm(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
  }
}

function stopStageHoldRepeat(btn) {
  clearTimeout(UI.stageHold.startTimer);
  clearInterval(UI.stageHold.repeatTimer);
  UI.stageHold.startTimer = null;
  UI.stageHold.repeatTimer = null;
  if (btn && UI.stageHold.pointerId !== null && btn.hasPointerCapture && btn.hasPointerCapture(UI.stageHold.pointerId)) {
    btn.releasePointerCapture(UI.stageHold.pointerId);
  }
  UI.stageHold.pointerId = null;
  if (UI.stageHold.suppressClick) {
    clearTimeout(UI.stageHold.suppressTimer);
    UI.stageHold.suppressTimer = setTimeout(function () {
      UI.stageHold.suppressClick = false;
      UI.stageHold.suppressTimer = null;
    }, 120);
  }
}

function stepStageButton(delta) {
  stageGo(delta);
  refreshStageDisplay();
}

function bindStageHoldButton(id, delta) {
  var btn = $id(id);
  if (!btn) return;
  btn.addEventListener('click', function (e) {
    if (UI.stageHold.suppressClick) {
      e.preventDefault();
      return;
    }
    stepStageButton(delta);
  });
  btn.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stopStageHoldRepeat(btn);
    clearTimeout(UI.stageHold.suppressTimer);
    UI.stageHold.suppressTimer = null;
    UI.stageHold.suppressClick = false;
    UI.stageHold.pointerId = e.pointerId;
    if (btn.setPointerCapture) btn.setPointerCapture(e.pointerId);
    UI.stageHold.startTimer = setTimeout(function () {
      UI.stageHold.suppressClick = true;
      stepStageButton(delta);
      UI.stageHold.repeatTimer = setInterval(function () {
        stepStageButton(delta);
      }, STAGE_HOLD_REPEAT_MS);
    }, STAGE_HOLD_START_MS);
  });
  btn.addEventListener('pointerup', function () { stopStageHoldRepeat(btn); });
  btn.addEventListener('pointercancel', function () { stopStageHoldRepeat(btn); });
  btn.addEventListener('lostpointercapture', function () { stopStageHoldRepeat(btn); });
}

function initUI() {
  updateTalentTabVisibility();
  
  // 本地測試服承傷顯示初始化：顯示在全螢幕按鈕右側
  var host = window.location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLocal) {
    var fsBtn = $id('btn-fullscreen');
    if (fsBtn && !$id('r-phys-absorb')) {
      var wrap = document.createElement('span');
      wrap.id = 'test-only-dmg-wrap';
      wrap.style.marginLeft = '14px';
      wrap.style.display = 'inline-flex';
      wrap.style.gap = '10px';
      wrap.style.verticalAlign = 'middle';
      wrap.style.fontSize = '13px';
      wrap.style.fontWeight = 'bold';
      wrap.style.color = '#4ade80';
      wrap.innerHTML = 
        '<span id="r-phys-span" style="cursor: pointer;">🛡️ 物承: <b id="r-phys-absorb" style="color: #4ade80;">0</b></span>' +
        '<span id="r-magic-span" style="cursor: pointer;">🔮 魔承: <b id="r-magic-absorb" style="color: #4ade80;">0</b></span>';
      fsBtn.parentNode.insertBefore(wrap, fsBtn.nextSibling);
    }
  }
  // 分頁
  document.querySelectorAll('.tab-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      switchTab(b.getAttribute('data-tab'));
      UI.dirty.equip = true; UI.dirty.inv = true; UI.dirty.factory = true; UI.dirty.newforge = true; UI.dirty.forge = true; UI.dirty.tower = true; UI.dirty.gems = true; UI.dirty.skills = true; UI.dirty.talents = true;
    });
  });

  // 熔爐分頁事件（委派一次）＋改版公告頁籤閃爍狀態
  bindNewForgeEvents();
  updateForgeTabGlow();

  // 熔爐改版公告彈窗：確認後不再顯示（頁籤閃爍持續到玩家切到熔爐分頁）
  var forgeRebuildOk = $id('forge-rebuild-ok');
  if (forgeRebuildOk) {
    forgeRebuildOk.addEventListener('click', function () {
      var modal = $id('forge-rebuild-modal');
      if (modal) modal.style.display = 'none';
      if (window.G && G.newForge) G.newForge.noticeShown = true;
    });
  }

  // 轉生按鈕：先顯示效果確認，只有按下確認後才執行。
  var reincBtn = $id('btn-reincarnate');
  if (reincBtn) {
    reincBtn.addEventListener('click', function () {
      var count = reincarnationCount();
      if (G.player.level < REINCARNATION_LEVEL || count >= REINCARNATION_MAX) {
        blog('⚠️ ' + (count >= REINCARNATION_MAX
          ? '已達最高 ' + REINCARNATION_MAX + ' 轉'
          : '等級達到 ' + REINCARNATION_LEVEL + ' 級後才能轉生'), 'warn');
        return;
      }
      var nextCount = count + 1;
      showConfirmDialog(
        '轉生效果：\n' +
        '・人物等級回到 1 級，經驗歸零。\n' +
        '・生命、法力及力量、敏捷、耐力、智力變為 ×' + reincarnationTotalMultiplier(nextCount) + '。\n' +
        '・不再獲得技能點，改獲得轉生天賦點。\n' +
        '・一般技能上限 +10 級，融合技能上限 +20 級。\n' +
        '・裝備、技能、資源與關卡進度保留。\n\n確定要進行轉生嗎？',
        function () {
          var err = reincarnate();
          if (err) { blog('⚠️ ' + err, 'warn'); return; }
          renderHeader();
          renderSkills();
          renderBattle();
          showConfirmDialog('恭喜轉生成功！目前為 ' + reincarnationCount() + ' 轉。', function () { }, {
            title: '轉生成功', okText: '確認', singleAction: true
          });
        },
        { title: '轉生確認', okText: '確定轉生' }
      );
    });
  }

  // 技能：學習/升級/裝載/融合（事件委派）
  document.addEventListener('click', function (e) {
    var talentSelect = e.target.closest('[data-talent-select]');
    if (talentSelect) {
      var talentParts = talentSelect.getAttribute('data-talent-select').split(':');
      openTalentModal(talentParts[0], talentParts.slice(1).join(':'));
      return;
    }
    var talentModalClose = e.target.closest('[data-talent-modal-close]');
    if (talentModalClose) { closeTalentModal(); return; }
    var talentUp = e.target.closest('[data-talent-up]');
    if (talentUp) { var talentErr = talentUpgrade(talentUp.getAttribute('data-talent-up')); if (talentErr) blog('⚠️ ' + talentErr, 'warn'); renderTalents(); return; }
    var talentMaxBtn = e.target.closest('[data-talent-max]');
    if (talentMaxBtn) { var talentMaxErr = talentMax(talentMaxBtn.getAttribute('data-talent-max')); if (talentMaxErr) blog('⚠️ ' + talentMaxErr, 'warn'); renderTalents(); return; }
    var talentDown = e.target.closest('[data-talent-down]');
    if (talentDown) { var talentDownErr = talentDowngrade(talentDown.getAttribute('data-talent-down')); if (talentDownErr) blog('⚠️ ' + talentDownErr, 'warn'); renderTalents(); return; }
    var talentDeleteBtn = e.target.closest('[data-talent-delete]');
    if (talentDeleteBtn) { var talentDeleteErr = talentDelete(talentDeleteBtn.getAttribute('data-talent-delete')); if (talentDeleteErr) blog('⚠️ ' + talentDeleteErr, 'warn'); renderTalents(); return; }
    // 裝備三套切頁：改名按鈕須在切頁判斷之前處理（避免同時觸發切換檢視）
    var eqRename = e.target.closest('[data-eqset-rename]');
    if (eqRename) {
      if (typeof renameEquipSet === 'function') renameEquipSet(parseInt(eqRename.getAttribute('data-eqset-rename'), 10));
      return;
    }
    // 裝備三套切頁：點切頁只切換「檢視」，點「確定切換」才換穿
    var eqTab = e.target.closest('[data-eqset]');
    if (eqTab) {
      if (typeof setEquipView === 'function') setEquipView(parseInt(eqTab.getAttribute('data-eqset'), 10));
      renderEquip(); renderInventory();
      return;
    }
    var eqConfirm = e.target.closest('#eqset-confirm');
    if (eqConfirm) {
      if (!eqConfirm.disabled && typeof switchToEquipSet === 'function') {
        switchToEquipSet(G.equipView || 0);
        blog('🎽 已換穿' + (typeof equipSetName === 'function' ? equipSetName(G.equipActive) : '該套') + '裝備', 'good');
        renderEquip(); renderInventory();
      }
      return;
    }
    var mx = e.target.closest('[data-skill-max]');
    if (mx) {
      var maxRef = mx.getAttribute('data-skill-max');
      var maxPotentialId = potentialSkillId(maxRef);
      var merr = maxPotentialId !== null ? potentialMax(maxPotentialId) : maxUpgradeSkill(maxRef);
      if (merr) blog('⚠️ ' + merr, 'warn');
      renderSkills();
      return;
    }
    var ln = e.target.closest('[data-skill-learn]');
    if (ln) {
      var learnRef = ln.getAttribute('data-skill-learn');
      var learnPotentialId = potentialSkillId(learnRef);
      var lerr = learnPotentialId !== null ? potentialUpgrade(learnPotentialId) : learnOrUpgradeSkill(learnRef);
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
    var etip = e.target.closest('#btn-enemy-tip') || e.target.closest('#btn-boss-tip') || e.target.closest('#btn-tower-result-boss-tip');
    if (etip) {
      var tip = $id('sk-tooltip');
      if (tip && tip.style.display === 'block') hideTooltip();
      else showEnemyTooltip(etip);
      return;
    }
    var btip = e.target.closest('[data-buff-tip]');
    if (btip) {
      var btipEl = $id('sk-tooltip');
      if (btipEl && btipEl.style.display === 'block' && UI.tooltipAnchor === btip) hideTooltip();
      else showBuffTooltip(btip);
      return;
    }
    var ebtip = e.target.closest('[data-enemy-buff-tip]');
    if (ebtip) {
      var ebtipEl = $id('sk-tooltip');
      if (ebtipEl && ebtipEl.style.display === 'block' && UI.tooltipAnchor === ebtip) hideTooltip();
      else showEnemyBuffTooltip(ebtip);
      return;
    }
    // 降級
    var dg = e.target.closest('[data-skill-downgrade]');
    if (dg) {
      var downRef = dg.getAttribute('data-skill-downgrade');
      var downPotentialId = potentialSkillId(downRef);
      var dgerr = downPotentialId !== null ? potentialDowngrade(downPotentialId) : downgradeSkill(downRef);
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

  // 屏蔽遊戲畫面文字反白；輸入框、文字區與可編輯元素保留正常選取功能。
  document.addEventListener('selectstart', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();
  });

  // 神鑄寶石自動放入清單：捲動只作用於清單，不冒泡到主畫面。
  var forgeAutoMenuWheel = $id('forge-auto-menu');
  if (forgeAutoMenuWheel) {
    forgeAutoMenuWheel.addEventListener('wheel', function (e) {
      var list = e.target.closest('.fam-list');
      if (!list) return;
      if (list.scrollHeight > list.clientHeight) {
        list.scrollTop += e.deltaY;
        e.preventDefault();
      }
      e.stopPropagation();
    }, { passive: false });
  }

  // 技能彈窗：右上 X / 點擊遮罩關閉
  var skModal = $id('skill-modal');
  if (skModal) {
    skModal.addEventListener('click', function (e) {
      if (e.target === skModal) closeSkillModal();
    });
    $id('skill-modal-close').addEventListener('click', closeSkillModal);
  }

  // 天賦彈窗：右上 X / 點擊遮罩關閉
  var talentModal = $id('talent-modal');
  if (talentModal) {
    talentModal.addEventListener('click', function (e) {
      if (e.target === talentModal) closeTalentModal();
    });
    $id('talent-modal-close').addEventListener('click', closeTalentModal);
  }

  // 離線收益彈窗：確認 / 右上 X / 點擊遮罩關閉
  var offlineModal = $id('offline-modal');
  if (offlineModal) {
    offlineModal.addEventListener('click', function (e) {
      if (e.target === offlineModal) closeOfflineSummary();
    });
    $id('offline-modal-close').addEventListener('click', closeOfflineSummary);
    $id('offline-modal-confirm').addEventListener('click', closeOfflineSummary);
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
    var buffTipHover = e.target.closest('[data-buff-tip]');
    if (buffTipHover) { showBuffTooltip(buffTipHover); return; }
    var enemyBuffTipHover = e.target.closest('[data-enemy-buff-tip]');
    if (enemyBuffTipHover) { showEnemyBuffTooltip(enemyBuffTipHover); return; }
    var talentTipHover = e.target.closest('[data-talent-tip]');
    if (talentTipHover) { showTalentTooltip(talentTipHover.getAttribute('data-talent-tip'), talentTipHover); return; }

    // 神鑄法陣裝備槽：顯示完整裝備詳情（寶石槽走上方 data-tip 分支）
    var fSlotEl = e.target.closest('.forge-slot.filled[data-forge-slot]');
    if (fSlotEl) {
      var fSlotIt = forgeState().slots[parseInt(fSlotEl.getAttribute('data-forge-slot'), 10)];
      if (fSlotIt && fSlotIt.kind !== 'gem') {
        showItemTooltip(fSlotIt, fSlotEl, { hint: '點擊取回背包' });
        return;
      }
    }

    var eqCell = e.target.closest('.item-cell[data-id]') || e.target.closest('.eq-slot.filled[data-id]');
    if (eqCell) {
      var it = findItemById(eqCell.getAttribute('data-id'));
      if (it) { showItemTooltip(it, eqCell); return; }
    }

    var genericTip = e.target.closest('[data-tt-title]');
    if (genericTip) {
      showStatTooltip(genericTip.getAttribute('data-tt-title'), genericTip.getAttribute('data-tt-desc') || '', genericTip);
      return;
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
    var etip = e.target.closest('#btn-enemy-tip') || e.target.closest('#btn-boss-tip') || e.target.closest('#btn-tower-result-boss-tip');
    if (etip) { showEnemyTooltip(etip); return; }
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target.closest('[data-sk]') || e.target.closest('.stat-row[data-tt-title]') ||
      e.target.closest('[data-tt-title]') ||
      e.target.closest('[data-talent-tip]') ||
      e.target.closest('[data-tower-tip]') || e.target.closest('#btn-enemy-tip') ||
      e.target.closest('#btn-boss-tip') || e.target.closest('#btn-tower-result-boss-tip') ||
      e.target.closest('[data-tip]') || e.target.closest('[data-buff-tip]') ||
      e.target.closest('[data-enemy-buff-tip]') || e.target.closest('.item-cell[data-id]') ||
      e.target.closest('.eq-slot.filled[data-id]') ||
      e.target.closest('.forge-slot.filled[data-forge-slot]')) {
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
      else blog('🔀 寶石合成：' + (t === GEM_TYPE_ALL ? '全部類型寶石' : gemLabel(t, lv)) + ' ×2 → ' +
        (t === GEM_TYPE_ALL ? GEM_NAMES[lv + 1] + '下一階寶石' : gemLabel(t, lv + 1)), 'info', 'factory');
      renderGems();
    });
    $id('fuse-all-btn').addEventListener('click', function () {
      var t = $id('fuse-type').value;
      var lv = parseInt($id('fuse-level').value, 10) || 1;
      var made = 0, err = null;
      while (made < 2500 && !(err = composeGems(t, lv))) made++;
      if (made > 0) blog('♻️ 全部合成：' + (t === GEM_TYPE_ALL ? '全部類型寶石' : gemLabel(t, lv)) + ' ×' + (made * 2) +
        ' → ' + (t === GEM_TYPE_ALL ? GEM_NAMES[lv + 1] + '下一階寶石' : gemLabel(t, lv + 1)) + ' ×' + made, 'good', 'factory');
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
      blog('🔄 寶石轉換完成：獲得 ' + GEM_TYPES[target].emoji + detail + '（同階轉換）', 'good', 'factory');
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
        blog('⛏️ 拆解 ' + gemLabel(t, lv) + ' → ' + gemLabel(t, 1) + ' ×' + r.n, 'info', 'factory');
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
        blog('⛏️ 全部拆解：' + gemLabel(t, lv) + ' ×' + cnt + ' → ' + gemLabel(t, 1) + ' ×' + gain, 'good', 'factory');
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
        blog('⛏️ 融合寶石拆解 → ' + gotStr, 'good', 'factory');
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
        gfuseShow('⚠️ ' + res.err, 'warn');
      } else if (res.success) {
        var msgStr = '🧬 寶石融合成功！獲得 ' + fusedGemLabel(res.result) + '（成功率 ' + res.rate + '%）';
        blog('🧬 <span class="log-hl-good">寶石融合成功！</span>獲得 ' + fusedGemLabel(res.result) + '（成功率 ' + res.rate + '%）', 'good', 'factory');
        gfuseShow(msgStr, 'yellow');
        UI.gemFuseSlots = [null, null];
      } else {
        var msgStr = '💥 寶石融合失敗（成功率 ' + res.rate + '%）…較弱的寶石降解為 ' + res.degraded.n + ' 顆 ' + gemLabel(res.degraded.type, res.degraded.lv);
        blog('💥 寶石融合失敗（成功率 ' + res.rate + '%）…較弱的寶石降解為 ' + res.degraded.n + ' 顆 ' + gemLabel(res.degraded.type, res.degraded.lv), 'warn', 'factory');
        gfuseShow(msgStr, 'warn');
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
      if (r.bought > 0) blog('🛒 一鍵購買 ' + r.bought + ' 顆寶石，花費 <img src="images/icon_gold.png" class="res-icon">' + fmt(r.spent), 'good', 'factory');
      else blog('⚠️ 沒有可購買的寶石（金幣不足或已售罄）', 'warn');
      renderGems();
    });
    $id('shop-refresh').addEventListener('click', function () {
      var err = refreshGemShop();
      if (err) blog('⚠️ 刷新失敗：' + err, 'warn');
      else blog('🔄 寶石商店已刷新（本週期第 ' + gemShop().refreshCount + ' 次）', 'info', 'factory');
      renderGems();
    });
    var upgradeBtn = $id('shop-upgrade');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', function () {
        var err = upgradeGemShop();
        if (err) blog('⚠️ 升級失敗：' + err, 'warn');
        else blog('⬆️ 寶石商店升級至 Lv.' + gemShop().level, 'good', 'factory');
        renderGems();
      });
    }
  }

  // 日誌篩選
  var logFilter = $id('log-filter');
  if (logFilter) {
    function applyLogFilter(v) {
      var b = $id('battle-log');
      var bossLog = $id('boss-log');
      if (v === 'boss') {
        if (b) b.style.display = 'none';
        if (bossLog) {
          bossLog.style.display = 'block';
          bossLog.className = 'log';
        }
      } else {
        // 「全部」必須同時顯示一般戰鬥與BOSS戰紀錄；否則BOSS紀錄會被獨立容器隱藏。
        if (bossLog) {
          bossLog.style.display = v === 'all' ? 'block' : 'none';
          bossLog.className = 'log' + (v === 'all' ? '' : ' filter-' + v);
        }
        if (b) {
          b.style.display = 'block';
          b.className = 'log' + (v === 'all' ? '' : ' filter-' + v);
        }
      }
    }
    logFilter.addEventListener('change', function (e) { applyLogFilter(e.target.value); });
    applyLogFilter(logFilter.value || 'all');
  }

  // 迷你監控視窗
  var detailLogBtn = $id('btn-detail-log');
  var detailLogModal = $id('detail-log-modal');
  var detailLogClose = $id('detail-log-close');
  var detailLogFilter = $id('detail-log-filter');
  var detailLogClear = $id('detail-log-clear');
  function closeDetailLog() {
    if (!detailLogModal) return;
    detailLogModal.style.display = 'none';
    detailLogModal.setAttribute('aria-hidden', 'true');
  }
  if (detailLogBtn && detailLogModal) {
    detailLogBtn.addEventListener('click', function () {
      var mainFilter = $id('log-filter');
      if (detailLogFilter) detailLogFilter.value = mainFilter ? mainFilter.value : 'all';
      renderDetailLog();
      detailLogModal.style.display = 'flex';
      detailLogModal.setAttribute('aria-hidden', 'false');
    });
    if (detailLogClose) detailLogClose.addEventListener('click', closeDetailLog);
    detailLogModal.addEventListener('click', function (e) {
      if (e.target === detailLogModal) closeDetailLog();
    });
    if (detailLogFilter) detailLogFilter.addEventListener('change', renderDetailLog);
    if (detailLogClear) detailLogClear.addEventListener('click', function () {
      DETAIL_LOG_HISTORY.length = 0;
      renderDetailLog();
    });
  }

  // 熔爐詳細日誌視窗
  var nfDetailLogBtn = $id('btn-newforge-log-detail');
  var nfDetailLogModal = $id('newforge-detail-log-modal');
  var nfDetailLogClose = $id('newforge-detail-log-close');
  var nfDetailLogClear = $id('newforge-detail-log-clear');
  var nfDetailLogPause = $id('btn-newforge-log-pause');

  function closeNfDetailLog() {
    if (!nfDetailLogModal) return;
    nfDetailLogModal.style.display = 'none';
    nfDetailLogModal.setAttribute('aria-hidden', 'true');
    if (newForgeLogStatsInterval) {
      clearInterval(newForgeLogStatsInterval);
      newForgeLogStatsInterval = null;
    }
  }

  if (nfDetailLogBtn && nfDetailLogModal) {
    nfDetailLogBtn.addEventListener('click', function () {
      if (!newForgeLogStartTime && NEWFORGE_LOG_HISTORY.length > 0) {
        newForgeLogStartTime = Date.now();
      }
      renderNewForgeDetailLog();
      nfDetailLogModal.style.display = 'flex';
      nfDetailLogModal.setAttribute('aria-hidden', 'false');

      if (newForgeLogStatsInterval) clearInterval(newForgeLogStatsInterval);
      newForgeLogStatsInterval = setInterval(function () {
        renderNewForgeLogStats();
      }, 1000);
    });
    if (nfDetailLogClose) nfDetailLogClose.addEventListener('click', closeNfDetailLog);
    nfDetailLogModal.addEventListener('click', function (e) {
      if (e.target === nfDetailLogModal) closeNfDetailLog();
    });
    if (nfDetailLogClear) {
      nfDetailLogClear.addEventListener('click', function () {
        NEWFORGE_LOG_HISTORY.length = 0;
        newForgeLogStartTime = null;
        resetNewForgeCumulativeStats();
        var box = $id('newforge-log');
        if (box) box.innerHTML = '';
        renderNewForgeDetailLog();
      });
    }
    if (nfDetailLogPause) {
      nfDetailLogPause.addEventListener('click', function () {
        window.newForgeLogPaused = !window.newForgeLogPaused;
        if (window.newForgeLogPaused) {
          nfDetailLogPause.textContent = '▶ 恢復日誌更新';
          nfDetailLogPause.classList.remove('warn');
          nfDetailLogPause.classList.add('good');
        } else {
          nfDetailLogPause.textContent = '⏸ 暫停日誌更新';
          nfDetailLogPause.classList.remove('good');
          nfDetailLogPause.classList.add('warn');
          refreshNewForgeMainLog();
          renderNewForgeDetailLog();
        }
      });
    }
  }

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
  var handlePauseClick = function () {
    toggleCombatPaused();
    refreshCombatPauseButton();
  };
  var combatPauseBtn = $id('btn-combat-pause');
  if (combatPauseBtn) combatPauseBtn.addEventListener('click', handlePauseClick);
  var detailCombatPauseBtn = $id('btn-detail-combat-pause');
  if (detailCombatPauseBtn) detailCombatPauseBtn.addEventListener('click', handlePauseClick);
  bindStageHoldButton('st-prev', -1);
  bindStageHoldButton('st-next', 1);
  $id('st-max').addEventListener('click', function () { stageGoMax(); });
  $id('st-auto').addEventListener('change', function () { G.stage.autoAdvance = this.checked; });

  // 裝備 / 背包點擊（事件委派）
  document.addEventListener('click', function (e) {
    var poolBtn = e.target.closest('[data-affix-pool-toggle]');
    if (poolBtn) {
      toggleAffixPool(poolBtn);
      return;
    }
    if (!e.target.closest('#affix-pool-overlay')) hideAffixPool();
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
    // 神鑄自動放入選單（選取 / 確定 / 取消 / 外點關閉）
    var famMenu = $id('forge-auto-menu');
    if (famMenu && famMenu.style.display !== 'none') {
      var famOptE = e.target.closest('[data-fam-equip]');
      if (famOptE) {
        UI.forgeAutoPick = { kind: 'equip', rarity: parseInt(famOptE.getAttribute('data-fam-equip'), 10) };
        famApplyPickHighlight(famMenu);   // 就地更新高亮，不重建選單、不動卷軸位置
        return;
      }
      var famOptG = e.target.closest('[data-fam-gem]');
      if (famOptG) {
        var famG = famOptG.getAttribute('data-fam-gem').split(':');
        UI.forgeAutoPick = { kind: 'gem', type: famG[0], level: parseInt(famG[1], 10) };
        famApplyPickHighlight(famMenu);
        return;
      }
      if (e.target.closest('#fam-confirm')) {
        if (UI.forgeAutoPick) {
          var fst = forgeState();
          if (forgeItemCount() > 0) forgeUnloadAll();  // 先清空法陣，再放入指定素材
          fst.autoFill = UI.forgeAutoPick;
          var famErr = forgeAutoFillApply();
          if (famErr) {
            fst.autoFill = null;
            blog('⚠️ 神鑄自動放入：' + famErr, 'warn');
          } else {
            blog('🔁 神鑄自動放入已啟用：' + forgeAutoFillLabel() +
              '（每次鑄造後自動補放 6 件，數量不足自動停止）', 'good');
          }
          famMenu.style.display = 'none';
          UI.forgeAutoPick = null;
          UI.dirty.forge = true;
        }
        return;
      }
      if (e.target.closest('#fam-stop')) {
        forgeState().autoFill = null;
        blog('🔁 神鑄自動放入已取消', 'info');
        famMenu.style.display = 'none';
        UI.forgeAutoPick = null;
        UI.dirty.forge = true;
        return;
      }
      if (e.target.closest('#fam-close')) {
        famMenu.style.display = 'none';
        UI.forgeAutoPick = null;
        return;
      }
      if (e.target.closest('.forge-auto-wrap')) return;  // 點在選單其他區域不動作
      famMenu.style.display = 'none';                    // 外點關閉，後續處理照常進行
      UI.forgeAutoPick = null;
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
        var emptySlot = cell.getAttribute('data-slot');
        if (UI.sel && UI.sel.source === 'equip-slot' && UI.sel.slot === emptySlot) {
          UI.sel = null;
        } else {
          UI.sel = { source: 'equip-slot', slot: emptySlot };
        }
        UI.lastEquipSlot = emptySlot;
      } else {
        var cid = cell.getAttribute('data-id');
        if (UI.sel && UI.sel.id === cid) {
          UI.sel = null;
        } else {
          UI.sel = { id: cid, source: cell.getAttribute('data-src') };
          if (UI.sel.source === 'equip') {
            UI.lastEquipSlot = cell.getAttribute('data-slot');
            UI.sel.slot = cell.getAttribute('data-slot');
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
    var tf = e.target.closest('[data-tower-floor]');
    if (tf) {
      TOWER.auto = null; TOWER.autoNextCd = 0; // 手動挑戰視為取消等待中的連挑
      startTowerFight(parseInt(tf.getAttribute('data-tower-floor'), 10));
      switchTab('tower');
      return;
    }
    // 高塔連續挑戰（次數取自 #tw-auto-count 輸入框）
    var ta = e.target.closest('[data-tower-auto]');
    if (ta) {
      var taInput = $id('tw-auto-count');
      startTowerAuto(parseInt(ta.getAttribute('data-tower-auto'), 10), taInput ? parseInt(taInput.value, 10) : 0);
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
    if (INVENTORY_CAP + upg >= INVENTORY_MAX) {
      blog('❌ 背包已達最大容量 ' + INVENTORY_MAX + ' 格，無法再擴充', 'warn', 'system');
      return;
    }
    var cost = inventoryExpandCost(upg);
    if (G.player.gold < cost) {
      blog('❌ 金幣不足，擴充需要 ' + fmt(cost) + ' 金幣', 'warn', 'system');
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
  var rarityFilter = $id('inv-rarity-filter');
  if (rarityFilter) {
    rarityFilter.addEventListener('change', function () {
      renderInventory();
    });
  }
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
    // 自動放入：開關選單（點擊時依目前切頁重建內容）
    var afToggleBtn = $id('forge-autofill');
    if (afToggleBtn) {
      afToggleBtn.addEventListener('click', function (e) {
        var menu = $id('forge-auto-menu');
        if (!menu) return;
        if (menu.style.display === 'none') {
          UI.forgeAutoPick = null;
          menu.style.display = 'block';
          renderForgeAutoMenu();
        } else {
          menu.style.display = 'none';
          UI.forgeAutoPick = null;
        }
        e.stopPropagation();
      });
    }
    $id('forge-autodust').addEventListener('change', function () {
      var f = forgeState();
      f.autoDust = this.checked;
      if (f.autoDust && forgeItemCount() > 0) forgeAutoFillDust();
      UI.dirty.forge = true;
    });
    $id('forge-autoforge').addEventListener('change', function () {
      var f = forgeState();
      f.autoForge = this.checked;
      if (this.checked) blog('🔁 自動鑄造已啟用，請先按一次「鑄造」開始', 'info');
      else blog('⏹️ 自動鑄造已停用', 'info');
      UI.dirty.forge = true;
      UI.dirty.inv = true;
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
  var ancientToggle = $id('toggle-ancient-essence');
  if (ancientToggle) ancientToggle.addEventListener('change', function () {
    // itemDetailHTML 會以 ancient-affix 樣式標示本次洗煉產生的太古詞條。
    G.settings.useAncientEssence = this.checked;
    UI.dirty.header = true;
    UI.dirty.equip = true;
    UI.dirty.inv = true;
    renderDetail();
  });

  // 頂欄網頁全螢幕切換；瀏覽器 F11 屬於瀏覽器層級，網頁無法代替 F11 退出
  function isBrowserFullscreen() {
    var screenObj = typeof screen !== 'undefined' ? screen : null;
    if (!screenObj || document.fullscreenElement) return false;
    var firefoxF11 = typeof window.fullScreen === 'boolean' && window.fullScreen;
    var sizeF11 = window.outerWidth >= screenObj.width && window.outerHeight >= screenObj.height;
    return !!(firefoxF11 || sizeF11);
  }
  var fsBtn = $id('btn-fullscreen');
  if (fsBtn) {
    function syncFullscreenButton() {
      var pageFullscreen = !!document.fullscreenElement;
      var browserFullscreen = !pageFullscreen && isBrowserFullscreen();
      fsBtn.classList.toggle('active', pageFullscreen || browserFullscreen);
      fsBtn.setAttribute('data-tip', pageFullscreen
        ? '離開網頁全螢幕（Esc）'
        : (browserFullscreen ? '目前為瀏覽器 F11 全螢幕，請按 F11 返回' : '進入網頁全螢幕'));
    }
    fsBtn.addEventListener('click', function () {
      if (document.fullscreenElement) {
        // 第二次按下：離開全螢幕恢復正常
        document.exitFullscreen().catch(function () { });
      } else if (isBrowserFullscreen()) {
        blog('⚠️ 目前是瀏覽器 F11 全螢幕，網頁無法代替瀏覽器退出，請再按 F11 返回', 'warn', 'system');
      } else {
        document.documentElement.requestFullscreen().catch(function () {
          blog('⚠️ 瀏覽器拒絕進入網頁全螢幕，請使用 F11', 'warn', 'system');
        });
      }
    });
    document.addEventListener('fullscreenchange', function () {
      syncFullscreenButton();
    });
    window.addEventListener('resize', syncFullscreenButton);
    syncFullscreenButton();
  }

  // 熔爐頁設定（舊生產線的篩選/合成節點已移除）
  // 寶石分頁的「寶石升階」快速開關
  var gemMergeToggle = $id('gem-merge-toggle');
  if (gemMergeToggle) {
    gemMergeToggle.addEventListener('change', function () {
      G.factory.synth.gemMerge = this.checked;
      blog(this.checked ? '⚙️ 已開啟熔爐自動「寶石升階」（3 顆同種同級 → 高一級）' : '⚙️ 已關閉熔爐自動「寶石升階」，寶石庫存不會再被自動合成', 'info');
    });
  }


  // 設定分頁：存檔管理
  $id('btn-save').addEventListener('click', function () {
    var m = $id('save-msg');
    if (m) m.textContent = '⏳ 正在確認本地存檔資料夾…';
    ensureSaveFolderV2(function (err, folderRes) {
      if (err || !folderRes) {
        var reason = '⚠️ 未建立手動存檔：' + (err || '尚未選擇本地資料夾');
        if (m) m.textContent = reason;
        blog(reason, 'warn');
        return;
      }
      createManualSaveToFolderV2().then(function (rec) {
        UI.saveNoticeId = rec.id;
        var text = '✅ 手動存檔已寫入本地資料夾「' + folderRes.dirName + '」：' + rec.fname;
        if (m) m.textContent = text;
        blog(text, 'good');
        renderSaveList();
        refreshSaveFolderFilesV2();
      }).catch(function (e) {
        var detail = e && e.message ? e.message : String(e);
        var text = '⚠️ 手動存檔寫入失敗：' + detail;
        if (m) m.textContent = text;
        blog(text, 'bad');
      });
    });
  });
  $id('btn-folder').addEventListener('click', function () {
    var m = $id('save-msg');
    if (m) m.textContent = '⏳ 請選擇或更新存檔資料夾…';
    openSaveFolder(function (err, res) {
      var text = '';
      if (err) {
        text = '⚠️ ' + err;
      } else if (res && res.selected) {
        text = '✅ 已選定存檔資料夾「' + res.dirName + '」；目前共有 ' + ((res.files || []).length) + ' 個檔案。';
        refreshSaveFolderFilesV2(res.files || []);
      }
      if (text) {
        if (m) m.textContent = text;
        blog(text, err ? 'warn' : 'good');
      }
      renderSaveList();
    }, true);
  });
  var bannerFolderBtn = $id('btn-folder-banner');
  if (bannerFolderBtn) bannerFolderBtn.addEventListener('click', function () { $id('btn-folder').click(); });
  // 重新掃描：用「已授權」的資料夾重新同步＋匯入新存檔並刷新清單，不重新彈出資料夾選擇器（原本漏綁 handler → 點了沒反應）
  var folderRefreshBtn = $id('btn-folder-refresh');
  if (folderRefreshBtn) folderRefreshBtn.addEventListener('click', function () {
    var m = $id('save-msg');
    if (typeof _saveDir === 'undefined' || !_saveDir) {
      var hint = '⚠️ 尚未連接存檔資料夾，請先按「選擇 / 更新存檔資料夾」授權。';
      if (m) m.textContent = hint;
      blog(hint, 'warn');
      return;
    }
    if (m) m.textContent = '⏳ 重新掃描存檔資料夾…';
    openSaveFolder(function (err, res) {
      var text = err ? ('⚠️ 重新掃描失敗：' + err)
        : ('✅ 已重新掃描' + (res && res.dirName ? '「' + res.dirName + '」' : '') +
          (res && res.imported ? '，新匯入 ' + res.imported + ' 筆存檔' : '，沒有新存檔'));
      if (m) m.textContent = text;
      blog(text, err ? 'warn' : 'good');
      refreshSaveFolderFilesV2(); // 無參數 → 從已授權資料夾重新列出檔案
      renderSaveList();
    }, false); // false = 使用已授權資料夾、不重新彈選擇器
  });
  $id('btn-restart').addEventListener('click', function () {
    showConfirmDialog('確定要重新開局嗎？將開一個全新角色從頭重玩。\n目前進度已保留在「⚡ 即時自動存檔（第 ' + (G.runId || 1) + ' 局）」，所有存檔記錄都不會刪除，隨時可以讀回來。', function () {
      restartGame();
    }, { title: '重新開局確認', okText: '重新開局', danger: true });
  });
  // 讀取/刪除本地存檔（每列右側按鈕，需二次確認）
  $id('save-list').addEventListener('click', function (e) {
    var loadBtn = e.target.closest('[data-load-save]');
    var delBtn = e.target.closest('[data-del-save]');
    if (!loadBtn && !delBtn) return;

    var id = loadBtn ? loadBtn.getAttribute('data-load-save')
      : delBtn.getAttribute('data-del-save');
    var rec = typeof findSaveRecordV2 === 'function' ? findSaveRecordV2(id) : null;
    if (!rec) return;

    if (loadBtn) {
      showConfirmDialog('確定要讀取「' + saveRecName(rec) + '」嗎？\n檔名：' + rec.fname + '\n時間：' + saveTimeStr(rec.savedAt) +
        '\n\n目前進度會先寫入本局的自動存檔，再切換為此存檔。', function () {
          Promise.resolve(loadSaveRecord(id)).then(function (err) {
            if (err) blog('⚠️ 讀取存檔失敗：' + err, 'bad');
          }).catch(function (e) {
            blog('⚠️ 讀取存檔失敗：' + (e && e.message ? e.message : e), 'bad');
          });
        }, { title: '讀取存檔確認', okText: '讀取存檔', danger: true });
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

  // 統計面板彈窗
  var btnSummary = $id('btn-summary');
  if (btnSummary) {
    btnSummary.addEventListener('click', function () {
      var modal = $id('summary-modal');
      if (modal) {
        renderStatsPanel();
        modal.style.display = 'flex';
        startStatsPanelTimer();
      }
    });
  }
  var summaryModal = $id('summary-modal');
  if (summaryModal) {
    summaryModal.addEventListener('click', function (e) {
      if (e.target === summaryModal) {
        summaryModal.style.display = 'none';
        stopStatsPanelTimer();
      }
    });
    var summaryClose = $id('summary-modal-close');
    if (summaryClose) {
      summaryClose.addEventListener('click', function () {
        summaryModal.style.display = 'none';
        stopStatsPanelTimer();
      });
    }
    var btnSummaryClear = $id('btn-summary-clear');
    if (btnSummaryClear) {
      btnSummaryClear.addEventListener('click', function () {
        if (window.RUN_STATS) {
          window.RUN_STATS.skills = {};
          window.RUN_STATS.maxStage = typeof G !== 'undefined' && G.stage ? G.stage.current : 1;
        }
        if (typeof resetLootStats === 'function') resetLootStats(); // 掉落統計歸零重計
        var list = $id('battle-summary-list');
        if (list) list.innerHTML = '';
        renderStatsPanel();
      });
    }
  }
}

/* ---- 高塔結算彈窗 ---- */
function clearTowerResultCountdown() {
  if (UI.towerResultCountdownTimer) {
    clearInterval(UI.towerResultCountdownTimer);
    UI.towerResultCountdownTimer = null;
  }
}
function confirmTowerResultModal() {
  clearTowerResultCountdown();
  var modal = $id('tower-result-modal');
  var confirmBtn = $id('trm-confirm');
  var stopAutoBtn = $id('trm-stop-auto');
  if (confirmBtn) confirmBtn.disabled = false;
  if (stopAutoBtn) {
    stopAutoBtn.disabled = false;
    stopAutoBtn.style.display = 'none';
  }
  if (modal) modal.style.display = 'none';
  if (typeof confirmTowerResult === 'function') confirmTowerResult();
  else if (typeof finishTowerFight === 'function') finishTowerFight();
}
function stopTowerAutoFromResultModal() {
  clearTowerResultCountdown();
  if (typeof stopTowerAutoFromResult === 'function') stopTowerAutoFromResult();
  var confirmBtn = $id('trm-confirm');
  var stopAutoBtn = $id('trm-stop-auto');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = '確定';
  }
  if (stopAutoBtn) {
    stopAutoBtn.disabled = true;
    stopAutoBtn.style.display = 'none';
  }
}
function showTowerResultModal(r, p, b, myDmg, bDmg, options) {
  var modal = $id('tower-result-modal');
  var title = $id('trm-title');
  var confirmBtn = $id('trm-confirm');
  var stopAutoBtn = $id('trm-stop-auto');
  clearTowerResultCountdown();

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

  if (confirmBtn) {
    var countdown = options && options.autoCountdown ? Math.ceil(options.countdown || 3) : 0;
    confirmBtn.disabled = countdown > 0;
    confirmBtn.textContent = countdown > 0 ? '確定（' + countdown + '）' : '確定';
    if (stopAutoBtn) {
      var canStopAuto = countdown > 0 && r && r.autoContinue;
      stopAutoBtn.style.display = canStopAuto ? 'inline-block' : 'none';
      stopAutoBtn.disabled = !canStopAuto;
    }
    if (countdown > 0) {
      UI.towerResultCountdownTimer = setInterval(function () {
        countdown--;
        if (confirmBtn) confirmBtn.textContent = countdown > 0 ? '確定（' + countdown + '）' : '確定';
        if (countdown <= 0) {
          if (confirmBtn) confirmBtn.disabled = false;
          confirmTowerResultModal();
        }
      }, 1000);
    }
  }
  modal.style.display = 'flex';
}

if ($id('trm-confirm')) {
  $id('trm-confirm').onclick = confirmTowerResultModal;
}
if ($id('trm-stop-auto')) {
  $id('trm-stop-auto').onclick = stopTowerAutoFromResultModal;
}
/* ---- 統計面板：基本統計與掉落物統計（HTML 由 js/stats.js 產生） ---- */
var statsPanelTimer = null;
function renderStatsPanel() {
  var basic = $id('stats-basic-card');
  var source = $id('stats-source-card');
  var loot = $id('stats-loot-card');
  if (basic && typeof statsBasicHtml === 'function') basic.innerHTML = statsBasicHtml();
  if (source && typeof statsSourceHtml === 'function') source.innerHTML = statsSourceHtml();
  if (loot && typeof statsLootHtml === 'function') loot.innerHTML = statsLootHtml();
  if (typeof renderCurrentSummary === 'function') renderCurrentSummary(); // 目前戰鬥傷害卡片同步刷新
}
// 面板開啟期間每秒重繪，統計時間與掉落數量即時更新；關閉即停止，避免閒置耗損。
function startStatsPanelTimer() {
  stopStatsPanelTimer();
  statsPanelTimer = setInterval(renderStatsPanel, 1000);
}
function stopStatsPanelTimer() {
  if (statsPanelTimer) { clearInterval(statsPanelTimer); statsPanelTimer = null; }
}

// 開啟結算彈窗時，將目前尚未死亡結算的戰鬥統計更新到最上方。
function renderCurrentSummary() {
  var list = $id('battle-summary-list');
  if (!list) return;
  var old = list.querySelector('[data-summary-current]');
  if (old) old.remove();
  var html = typeof generateSummaryHtml === 'function' ? generateSummaryHtml(true) : '';
  if (!html) {
    var empty = document.createElement('div');
    empty.className = 'summary-card';
    empty.setAttribute('data-summary-current', 'true');
    empty.innerHTML = '<div class="summary-card-title">目前戰鬥（即時統計）</div><div class="summary-card-row">尚未產生傷害統計</div>';
    list.insertBefore(empty, list.firstChild);
    return;
  }
  var holder = document.createElement('div');
  holder.innerHTML = html;
  list.insertBefore(holder.firstChild, list.firstChild);
}

