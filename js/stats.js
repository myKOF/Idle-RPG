'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
/* ============ 統計面板（基本／掉落統計）============
   邏輯層：只負責累計統計數據與產生統計 HTML 字串，DOM 操作集中於 ui.js。
   統計為本次工作階段的記憶體資料，按「清理」歸零重計，不寫入存檔；離線收益不計入。
   傷害統計沿用 combat.js 的 RUN_STATS，不在此重複。 */

/* 材料顯示定義（依此順序輸出）：有專用圖示者用 icon，否則用 emoji */
var LOOT_MAT_DEFS = [
  { key: 'scrap',          name: '裝備碎片',     icon: 'images/icon_scrap.png' },
  { key: 'essence',        name: '附魔精華',     icon: 'images/icon_essence.png' },
  { key: 'ancientEssence', name: '太古精華',     icon: 'images/icon_ancient_essence.png' },
  { key: 'dust',           name: '魔塵',         emoji: '💫' },
  { key: 'soulOrigin',     name: '魔魂本源',     emoji: '🧿' },
  { key: 'book',           name: '附魔書',       icon: 'images/icon_books.png' },
  { key: 'part',           name: STR(385), emoji: '🔧' }
];

function newLootStatsBucket() {
  return { battles: 0, kills: 0, deaths: 0, dropRolls: 0, gold: 0, equip: {}, mats: {}, gems: {} };
}

function currentLootStats() {
  return window.LOOT_STATS;
}

function lootSourceBucket(source) {
  var st = currentLootStats();
  var key = source || 'other';
  if (!st.sources[key]) st.sources[key] = newLootStatsBucket();
  return st.sources[key];
}

window.LOOT_STATS = null;
function resetLootStats() {
  var st = newLootStatsBucket();
  st.start = Date.now();
  st.sources = {};
  window.LOOT_STATS = st;
}
resetLootStats();

function recordLootBattle(source) {
  currentLootStats().battles++;
  lootSourceBucket(source).battles++;
}
function recordLootKill(n, source) {
  if (typeof n === 'string') { source = n; n = 1; }
  n = n === undefined ? 1 : n;
  currentLootStats().kills += n;
  lootSourceBucket(source).kills += n;
}
function recordLootDeath(n, source) {
  if (typeof n === 'string') { source = n; n = 1; }
  n = n === undefined ? 1 : n;
  currentLootStats().deaths += n;
  lootSourceBucket(source).deaths += n;
}
function recordLootDrop(source) {
  currentLootStats().dropRolls++;
  lootSourceBucket(source).dropRolls++;
}
function recordLootGold(n, source) {
  if (!(n > 0)) return;
  currentLootStats().gold += n;
  lootSourceBucket(source).gold += n;
}
function recordLootEquip(rarity, n, source) {
  n = n === undefined ? 1 : n;
  var st = currentLootStats();
  st.equip[rarity] = (st.equip[rarity] || 0) + n;
  var sourceSt = lootSourceBucket(source);
  sourceSt.equip[rarity] = (sourceSt.equip[rarity] || 0) + n;
}
function recordLootMat(key, n, source) {
  if (!(n > 0)) return;
  var st = currentLootStats();
  st.mats[key] = (st.mats[key] || 0) + n;
  var sourceSt = lootSourceBucket(source);
  sourceSt.mats[key] = (sourceSt.mats[key] || 0) + n;
}
function recordLootGem(type, lv, n, source) {
  n = n === undefined ? 1 : n;
  var key = type + ':' + lv;
  var st = currentLootStats();
  st.gems[key] = (st.gems[key] || 0) + n;
  var sourceSt = lootSourceBucket(source);
  sourceSt.gems[key] = (sourceSt.gems[key] || 0) + n;
}

function statsSourceName(key) {
  return ({ field: STR(386), tower: '封魔塔', factory: STR(387), skill: '技能', other: '其他' })[key] || key;
}

function statsSourceHtml() {
  var st = currentLootStats();
  var html = '<div class="summary-card-title">' + STR(388) + '</div>';
  var keys = Object.keys(st.sources);
  keys.sort(function (a, b) {
    var order = { field: 0, factory: 1, tower: 2, skill: 3, other: 4 };
    return (order[a] === undefined ? 99 : order[a]) - (order[b] === undefined ? 99 : order[b]);
  });
  if (!keys.length) return html + '<div class="summary-card-row">' + STR(389) + '</div>';
  for (var i = 0; i < keys.length; i++) {
    var sourceSt = st.sources[keys[i]], details = [];
    if (sourceSt.battles) details.push(STR(390, fmtFull(sourceSt.battles)));
    if (sourceSt.kills) details.push(STR(391, fmtFull(sourceSt.kills)));
    if (sourceSt.deaths) details.push(STR(392, fmtFull(sourceSt.deaths)));
    if (sourceSt.dropRolls) details.push(STR(393, fmtFull(sourceSt.dropRolls)));
    if (sourceSt.gold) details.push('金幣 ' + fmtFull(sourceSt.gold));
    var equipTotal = Object.keys(sourceSt.equip).reduce(function (sum, key) { return sum + sourceSt.equip[key]; }, 0);
    var matTotal = Object.keys(sourceSt.mats).reduce(function (sum, key) { return sum + sourceSt.mats[key]; }, 0);
    var gemTotal = Object.keys(sourceSt.gems).reduce(function (sum, key) { return sum + sourceSt.gems[key]; }, 0);
    if (equipTotal) details.push(STR(394, fmtFull(equipTotal)));
    if (matTotal) details.push(STR(395, fmtFull(matTotal)));
    if (gemTotal) details.push(STR(396, fmtFull(gemTotal)));
    if (!details.length) continue;
    html += '<div class="summary-card-row"><span style="color:var(--accent)">' + statsSourceName(keys[i]) + '</span>：' + details.join('｜') + '</div>';
  }
  return html;
}

function statsFieldBasicHtml() {
  var sourceSt = currentLootStats().sources.field || newLootStatsBucket();
  return '<div class="summary-card-title">' + STR(397) + '</div>' +
    statsCardRow(STR(398), fmtFull(sourceSt.battles)) +
    statsCardRow(STR(399), fmtFull(sourceSt.kills)) +
    statsCardRow(STR(400), fmtFull(sourceSt.dropRolls));
}

/* 統計時間：毫秒 → X時X分X秒（小時不進位成天，即時累加顯示） */
function statsDurationStr(ms) {
  var s = Math.max(0, Math.floor(ms / 1000));
  return STR(401, Math.floor(s / 3600), Math.floor((s % 3600) / 60), (s % 60));
}

function statsCardRow(label, value) {
  return '<div class="summary-card-row"><span style="color:var(--accent)">' + label + '</span>：' + value + '</div>';
}

/* 基本統計卡片內容（統計時間由 ui.js 每秒重繪達成即時更新） */
function statsBasicHtml() {
  var st = currentLootStats();
  return '<div class="summary-card-title">' + STR(402) + '</div>' +
    statsCardRow(STR(403), statsDurationStr(Date.now() - st.start)) +
    statsCardRow(STR(398), fmtFull(st.battles)) +
    statsCardRow(STR(399), fmtFull(st.kills)) +
    statsCardRow(STR(404), fmtFull(st.deaths));
}

/* 掉落物統計卡片內容：裝備（品質色）→ 材料（圖示）→ 寶石 → 金幣（完整數字） */
function statsLootHtml() {
  var st = currentLootStats();
  var html = '<div class="summary-card-title">' + STR(405) + '</div>';
  // 各品質裝備數量：每品質一行，文字與品質顏色一致
  var hasEquip = false;
  for (var r = 0; r < RARITIES.length; r++) {
    if (!st.equip[r]) continue;
    hasEquip = true;
    html += '<div class="summary-card-row">' + STR(406, RARITIES[r].color, RARITIES[r].name, fmtFull(st.equip[r])) + '</div>';
  }
  if (!hasEquip) html += '<div class="summary-card-row">' + STR(407) + '</div>';
  // 材料統計：依定義順序，有專用圖示者名稱前加圖示
  for (var i = 0; i < LOOT_MAT_DEFS.length; i++) {
    var def = LOOT_MAT_DEFS[i];
    if (!st.mats[def.key]) continue;
    var iconHtml = def.icon
      ? '<img src="' + def.icon + '" class="res-icon" alt="' + def.name + '">'
      : def.emoji;
    html += '<div class="summary-card-row">' + iconHtml +
      '<span style="color:var(--accent)">' + def.name + '</span>：' + fmtFull(st.mats[def.key]) + '</div>';
  }
  // 寶石統計：階級低→高，同階依寶石種類定義順序；emoji 即其專用圖示
  var typeOrder = Object.keys(GEM_TYPES);
  var gemKeys = Object.keys(st.gems);
  gemKeys.sort(function (a, b) {
    var pa = a.split(':'), pb = b.split(':');
    if (+pa[1] !== +pb[1]) return +pa[1] - +pb[1];
    return typeOrder.indexOf(pa[0]) - typeOrder.indexOf(pb[0]);
  });
  for (var g = 0; g < gemKeys.length; g++) {
    var parts = gemKeys[g].split(':');
    var gt = GEM_TYPES[parts[0]];
    if (!gt) continue;
    html += '<div class="summary-card-row">' + gemIconHTML(parts[0], +parts[1], 'gi-inline') + '<span style="color:var(--accent)">' + GEM_NAMES[+parts[1]] + gt.name + '</span>' + STR(408, fmtFull(st.gems[gemKeys[g]])) + '</div>';
  }
  // 金幣統計：完整數字（千分位），不使用簡寫
  html += '<div class="summary-card-row"><img src="images/icon_gold.png" class="res-icon" alt="' + STR(105) + '">' + STR(409, fmtFull(st.gold)) + '</div>';
  return html;
}
