'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
/* ============ 裝備 / 物品生成 / 寶石 ============ */

/* ---- 寶石庫存（G.player.gems = { type: {1..5: count} }） ---- */
function gemCount(type, lv) {
  var t = G.player.gems[type];
  return (t && t[lv]) || 0;
}
function addGem(type, lv, n) {
  if (!GEM_TYPES[type]) return; // 空開放池不產生物品；取下／退回舊寶石仍可使用本函式。
  if (!G.player.gems[type]) {
    G.player.gems[type] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  }
  G.player.gems[type][lv] = Math.max(0, (G.player.gems[type][lv] || 0) + (n === undefined ? 1 : n));
  UI.dirty.header = true; UI.dirty.gems = true;
}
function randomGemType() { return pick(Object.keys(GEM_TYPES).filter(isGemEnabled)) || null; }
function totalGemsOfLevel(lv) {
  var sum = 0;
  for (var t in GEM_TYPES) if (isGemEnabled(t)) sum += gemCount(t, lv);
  return sum;
}
function totalGemsAll() {
  var sum = 0;
  for (var t in GEM_TYPES) for (var lv = 1; lv <= GEM_FORGE_MAX_LEVEL; lv++) sum += gemCount(t, lv);
  return sum;
}
// 消耗一顆指定等級的寶石（取存量最多的種類）；回傳種類或 null
function takeGemOfLevel(lv) {
  var best = null, bestN = 0;
  for (var t in GEM_TYPES) {
    if (!isGemEnabled(t)) continue;
    var n = gemCount(t, lv);
    if (n > bestN) { best = t; bestN = n; }
  }
  if (!best) return null;
  addGem(best, lv, -1);
  return best;
}
function gemLabel(type, lv) {
  return GEM_TYPES[type].emoji + GEM_NAMES[lv] + GEM_TYPES[type].name;
}

/* ================ 寶石合成 / 轉換 / 拆解（2026-07-09 改版） ================ */

function fuseableGemTypesAtLevel(lv) {
  var types = [];
  var needed = gemComposeInputCount(lv);
  if (!needed) return types;
  for (var type in GEM_TYPES) {
    if (isGemEnabled(type) && gemCount(type, lv) >= needed) types.push(type);
  }
  return types;
}

// 寶石合成：依階級配方消耗同種同級素材與金幣，產出同種下一級。回傳 null=成功。
// 選擇全部類型時，每次挑選一種目前足夠的寶石，絕不混合種類。
function composeGems(type, lv) {
  var needed = gemComposeInputCount(lv);
  if (!needed) return lv === GEM_FORGE_MAX_LEVEL ? STR(1517) : STR(1469);
  if (type === GEM_TYPE_ALL) {
    var availableTypes = fuseableGemTypesAtLevel(lv);
    if (!availableTypes.length) return STR(1518);
    return composeGems(availableTypes[0], lv);
  }
  if (!GEM_TYPES[type]) return STR(43);
  if (!isGemEnabled(type)) return STR(1519);
  if (gemCount(type, lv) < needed) return STR(1476, GEM_NAMES[lv], GEM_TYPES[type].name, needed);
  var cost = FUSE_GOLD_COST[lv];
  if (G.player.gold < cost) return STR(42, fmt(cost));
  G.player.gold -= cost;
  addGem(type, lv, -needed);
  addGem(type, lv + 1, 1);
  // 任務進度：累計合成次數（與 upgraded / enchanted 同住 factory.stats）
  if (G.factory && G.factory.stats) G.factory.stats.gemComposed = (G.factory.stats.gemComposed || 0) + 1;
  UI.dirty.header = true; UI.dirty.gems = true;
  return null;
}

/* 寶石轉換（九宮格）：多組 {type, lv, n} 一次性轉換為目標種類
   規則：同階任意兩顆換一顆指定種類，未成組不扣；每格同種同級，融合寶石不可轉換。
   回傳 null=成功，否則錯誤訊息 */
function convertGems(slots, targetType) {
  if (!Object.prototype.hasOwnProperty.call(GEM_TYPES, targetType)) return STR(1520);
  if (!isGemEnabled(targetType)) return STR(1521);
  if (!Array.isArray(slots) || !slots.length) return STR(1522);
  if (slots.length > GEM_CONVERT_SLOTS) return STR(1523, GEM_CONVERT_SLOTS);
  var requested = {};
  for (var i = 0; i < slots.length; i++) {
    var s = slots[i];
    if (!s || !Object.prototype.hasOwnProperty.call(GEM_TYPES, s.type)) return STR(43);
    if (!isGemEnabled(s.type)) return STR(1524);
    if (!Number.isInteger(s.lv) || s.lv < 1 || s.lv > GEM_FORGE_MAX_LEVEL) return STR(1525, GEM_FORGE_MAX_LEVEL);
    if (!Number.isInteger(s.n) || s.n < 1 || s.n > GEM_CONVERT_STACK) return STR(1526, GEM_CONVERT_STACK);
    var key = s.type + ':' + s.lv;
    requested[key] = (requested[key] || 0) + s.n;
    if (gemCount(s.type, s.lv) < requested[key]) return STR(1527, GEM_NAMES[s.lv], GEM_TYPES[s.type].name);
  }
  var plan = gemConvertPlan(slots);
  if (!plan.consumed.length) return STR(1528, GEM_CONVERT_INPUT_COUNT);
  plan.consumed.forEach(function (s) {
    addGem(s.type, s.lv, -s.n);
  });
  Object.keys(plan.outputs).forEach(function (lv) { addGem(targetType, Number(lv), plan.outputs[lv]); });
  UI.dirty.gems = true; UI.dirty.header = true;
  return null;
}

// 九宮格普通寶石拆解：原子驗證所有初始庫存，免費無損拆回前一階。
function dismantleGems(slots) {
  if (!Array.isArray(slots) || !slots.length) return { err: STR(1522) };
  if (slots.length > GEM_CONVERT_SLOTS) return { err: STR(1523, GEM_CONVERT_SLOTS) };
  var requested = {};
  for (var i = 0; i < slots.length; i++) {
    var s = slots[i];
    if (!s || !Object.prototype.hasOwnProperty.call(GEM_TYPES, s.type)) return { err: STR(43) };
    if (!isGemEnabled(s.type)) return { err: STR(1529) };
    if (!Number.isInteger(s.lv) || s.lv < 2 || s.lv > GEM_FORGE_MAX_LEVEL) return { err: STR(1530) };
    if (!Number.isInteger(s.n) || s.n < 1 || s.n > GEM_CONVERT_STACK) return { err: STR(1526, GEM_CONVERT_STACK) };
    var key = s.type + ':' + s.lv;
    requested[key] = (requested[key] || 0) + s.n;
    if (gemCount(s.type, s.lv) < requested[key]) return { err: STR(1527, GEM_NAMES[s.lv], GEM_TYPES[s.type].name) };
  }
  var plan = gemDismantlePlan(slots);
  slots.forEach(function (s) { addGem(s.type, s.lv, -s.n); });
  plan.outputs.forEach(function (s) { addGem(s.type, s.lv, s.n); });
  UI.dirty.gems = true; UI.dirty.header = true;
  return plan;
}

// 舊單顆／全部指令相容，同樣使用無損前一階規則。
function dismantleGem(type, lv) {
  var result = dismantleGems([{ type: type, lv: lv, n: 1 }]);
  return result.err ? result : { n: result.outputs[0].n, level: lv - 1 };
}

// 融合寶石拆解：依融合次數推算 1 階總成本 × 0.7，依其屬性種類均分（餘數給第一種）
function dismantleFusedGem(id) {
  var fg = findFusedGem(id);
  if (!fg) return { err: STR(1531) };
  if (!isFusedGemEnabled(fg)) return { err: STR(1532) };
  if (fg.divine) return { err: STR(2185) };
  var total = fusedGemDismantleYield(fg);
  removeFusedGem(id);
  var types = fg.stats.map(function (s) { return s.type; });
  var per = Math.floor(total / types.length);
  var got = [];
  types.forEach(function (t, i) {
    var n = per + (i === 0 ? total - per * types.length : 0);
    if (n > 0) { addGem(t, 1, n); got.push({ type: t, n: n }); }
  });
  UI.dirty.gems = true; UI.dirty.header = true;
  return { got: got, total: total };
}

/* ================ 融合寶石（雙屬性，僅 5 階可融合） ================
   G.player.fusedGems = [ { id, stats:[{type,mult}x1~2], level:5, fusions:n, leaves:m } ]
   mult   = 「相當於幾顆 5 階寶石」的倍率；數值 = 5 階寶石數值 × mult（fusedStatValue →
            js/formula.js §8）。存倍率而不存數值，寶石 base／曲線一改就會等比跟著變。
   fusions = 融合世代（次數）：兩顆一般寶石 → 1；兩顆融合 1 次的再融合 → 2
             （取雙方較大值 +1，用於顯示與成功率遞減）
   leaves  = 素材 5 階寶石總數（融合樹的葉子數，雙方相加）：拆解成本推算用 */
function fusedGemStatText(fg) {
  return fg.stats.map(function (s) {
    var gt = GEM_TYPES[s.type];
    var v = fusedStatValue(s);
    return gt.statName.replace('%', '') + ' +' + (gt.pct ? pctStr(v) : fmt(v));
  }).join('、');
}
/* 寶石圖（js/data.js 的 gemIconSrc）。cls＝各處用來定尺寸的 class（css/gems.css）。
   融合寶石是兩種屬性的合體：兩顆 5 階寶石圖斜疊成一個圖示（同屬性融合只有一種，就單顆）。 */
function gemIconHTML(type, level, cls) {
  if (!GEM_TYPES[type]) return '';
  return '<img class="gem-ico' + (cls ? ' ' + cls : '') + '" src="' + gemIconSrc(type, level) + '" alt="" draggable="false" decoding="async">';
}
function fusedGemIconHTML(fg, cls) {
  var stats = fg.stats || [];
  var two = stats.length > 1;
  return '<span class="gem-ico-fused' + (two ? ' is-pair' : '') + (cls ? ' ' + cls : '') + '">' +
    stats.map(function (s) { return gemIconHTML(s.type, fg.level || GEM_MAX_LEVEL, 'gem-ico-part'); }).join('') + '</span>';
}
function fusedGemLabel(fg) {
  if (fg.divine) return STR(2203, fusedGemStatText(fg));
  var emojis = fg.stats.map(function (s) { return GEM_TYPES[s.type].emoji; }).join('');
  return STR(1533, emojis, fusedGemStatText(fg));
}
function findFusedGem(id) {
  var list = G.player.fusedGems || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
function removeFusedGem(id) {
  var list = G.player.fusedGems || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) { return list.splice(i, 1)[0]; }
  }
  return null;
}


/* ================ 寶石商店 ================ */
function gemShop() {
  if (!G.player.gemShop) {
    G.player.gemShop = { level: 1, items: [], refreshCount: 0, hourStart: Date.now() };
  }
  var s = G.player.gemShop;
  s.level = clamp(s.level || 1, 1, GEM_SHOP_MAX_LEVEL);
  return s;
}
var GEM_SHOP_REFRESH_HOURS = 8;   // 寶石商店自動刷新週期（小時）
function shopHourlyReset() {
  var s = gemShop();
  if (Date.now() - s.hourStart >= GEM_SHOP_REFRESH_HOURS * 3600 * 1000) {
    s.refreshCount = 0;
    s.hourStart = Date.now();
    rollGemShop();
    UI.dirty.gems = true;
  }
}
function shopResetCountdown() { // 秒
  return Math.max(0, Math.ceil((gemShop().hourStart + GEM_SHOP_REFRESH_HOURS * 3600 * 1000 - Date.now()) / 1000));
}
function rollGemShop() {
  var s = gemShop();
  s.items = [];
  var level = s.level;
  var countPairs = GEM_SHOP_COUNT_TABLE[level - 1] || GEM_SHOP_COUNT_TABLE[0];
  var tierPairs = GEM_SHOP_TIER_TABLE[level - 1] || GEM_SHOP_TIER_TABLE[0];
  var size = wpick(countPairs);
  for (var i = 0; i < size; i++) {
    var lv = wpick(tierPairs);
    var type = randomGemType();
    if (!type) break;
    s.items.push({ type: type, lv: lv, sold: false });
  }
  UI.dirty.gems = true;
}
// 刷新費用公式 shopRefreshCost → js/formula.js §8
// 手動刷新（消耗金幣，次數每小時重置）
function refreshGemShop() {
  shopHourlyReset();
  var cost = shopRefreshCost();
  if (G.player.gold < cost) return STR(1539, fmt(cost));
  G.player.gold -= cost;
  gemShop().refreshCount++;
  rollGemShop();
  UI.dirty.header = true;
  return null;
}
// 升級寶石商店：扣除金幣後立即依新等級重刷商品
function upgradeGemShop() {
  var s = gemShop();
  shopHourlyReset();
  if (s.level >= GEM_SHOP_MAX_LEVEL) return STR(1540);
  var cost = gemShopUpgradeCost(s.level);
  if (G.player.gold < cost) return STR(1539, fmt(cost));
  G.player.gold -= cost;
  s.level++;
  rollGemShop();
  UI.dirty.header = true; UI.dirty.gems = true;
  return null;
}
function buyShopGem(idx) {
  var s = gemShop();
  var item = s.items[idx];
  if (!item || item.sold) return STR(1541);
  if (!isGemEnabled(item.type)) return STR(1542);
  var price = gemShopPrice(item.lv);
  if (G.player.gold < price) return STR(1539, fmt(price));
  G.player.gold -= price;
  item.sold = true;
  addGem(item.type, item.lv, 1);
  UI.dirty.gems = true; UI.dirty.header = true;
  return null;
}
function buyAllShopGems() {
  var s = gemShop();
  var bought = 0, spent = 0;
  for (var i = 0; i < s.items.length; i++) {
    var item = s.items[i];
    if (item.sold || !isGemEnabled(item.type)) continue;
    var price = gemShopPrice(item.lv);
    if (G.player.gold < price) break;
    G.player.gold -= price;
    item.sold = true;
    addGem(item.type, item.lv, 1);
    bought++;
    spent += price;
  }
  UI.dirty.gems = true; UI.dirty.header = true;
  return { bought: bought, spent: spent };
}

/* ---- 裝備插槽 ---- */
function getItemAncientCount(it) {
  if (it && Number.isFinite(Number(it.ancientCount))) {
    return Math.max(0, Math.floor(Number(it.ancientCount)));
  }
  if (!it || !Array.isArray(it.affixes)) return 0;
  var c = 0;
  for (var i = 0; i < it.affixes.length; i++) {
    if (it.affixes[i] && it.affixes[i].ancient) c++;
  }
  if (it.imprint && !it.imprint.inactive && it.imprint.affix && it.imprint.affix.ancient && it.imprint.affix.ancientForgeOrder) c++;
  return c;
}

// 補齊插槽陣列（舊存檔裝備 / 稀有度提升後）；雙手武器鑲孔數 ×1.75 捨去（socketCountFor）
function ensureSockets(it) {
  var n = socketCountFor(it.rarity, it);
  if (!it.sockets) it.sockets = [];
  while (it.sockets.length < n) it.sockets.push(null);
  return it.sockets;
}

/* 雙手武器數量補齊（2026-08-05 雙手改造：詞條 +1、鑲孔 ×1.75 捨去）。
   舊存檔的既有雙手武器由 migrateSave 逐件呼叫（js/save.js fixLoadedItem）：
   詞條不足補至「稀有度固定條數＋加成」——只補不刪（舊版表若曾給更多條就保留），
   補的詞條照一般產出擲骰、不與現有詞條重複、一律非太古（太古位置產出時定終身）；
   鑲孔走 ensureSockets 只加不減。冪等：數量已達標即 no-op。
   附魔欄位數與詞條/特效數值倍率都是讀取時當場算（enchantCapFor／affixValue），無須遷移。 */
function normalizeTwoHandItemCounts(it) {
  if (typeof isTwoHandItem !== 'function' || !isTwoHandItem(it)) return it;
  ensureSockets(it);
  var r = RARITIES[clamp(it.rarity, 0, RARITIES.length - 1)];
  if (!r || !Array.isArray(it.affixes)) return it;
  var target = r.affix[0] + TWO_HAND_BONUS_AFFIXES;
  var guard = 0;
  while (it.affixes.length < target && guard++ < 50) {
    var added = rollAffixes(1, it.rarity, it.slot, undefined, undefined, it.level).filter(function (na) {
      return !it.affixes.some(function (a) { return a.key === na.key; });
    });
    if (added.length) it.affixes = it.affixes.concat(added);
  }
  return it;
}
// 鑲嵌：從庫存取一顆該種類最高等級的寶石放入第一個空槽（含 6~10 階神鑄寶石）
function socketGem(it, type, index, level) {
  if (!isGemEnabled(type)) return STR(1467);
  ensureSockets(it);
  var idx = index == null ? it.sockets.indexOf(null) : index;
  if (!Number.isInteger(idx) || idx < 0 || idx >= it.sockets.length) return STR(1543);
  if (it.sockets[idx] !== null) return STR(1544);
  if (!GEM_TYPES[type]) return STR(1545);
  var lv = 0;
  if (level != null) {
    if (!Number.isInteger(level) || level < 1 || level > GEM_FORGE_MAX_LEVEL) return STR(1469);
    if (gemCount(type, level) > 0) lv = level;
  } else {
    for (var l = GEM_FORGE_MAX_LEVEL; l >= 1; l--) { if (gemCount(type, l) > 0) { lv = l; break; } }
  }
  if (!lv) return STR(1545);
  addGem(type, lv, -1);
  it.sockets[idx] = { type: type, level: lv };
  markStatsDirty();
  return null; // 成功
}
// 鑲嵌融合寶石（從 fusedGems 庫存移入插槽）
function socketFusedGem(it, fusedId, index) {
  if (!isFusedGemEnabled(findFusedGem(fusedId))) return STR(1546);
  ensureSockets(it);
  var idx = index == null ? it.sockets.indexOf(null) : index;
  if (!Number.isInteger(idx) || idx < 0 || idx >= it.sockets.length) return STR(1543);
  if (it.sockets[idx] !== null) return STR(1544);
  var fg = removeFusedGem(fusedId);
  if (!fg) return STR(1531);
  it.sockets[idx] = { fused: fg };
  markStatsDirty();
  UI.dirty.gems = true;
  return null;
}

// 取下指定插槽的寶石回到庫存（一般 / 融合皆可）
function unsocketGem(it, idx) {
  if (!it.sockets || !it.sockets[idx]) return false;
  var g = it.sockets[idx];
  if (g.fused) {
    if (!G.player.fusedGems) G.player.fusedGems = [];
    G.player.fusedGems.push(g.fused);
    UI.dirty.gems = true;
  } else {
    addGem(g.type, g.level, 1);
  }
  it.sockets[idx] = null;
  markStatsDirty();
  return true;
}

/* 稀有度擲骰 rollRarity、詞條強度值 rollAffixStrength、詞條數值 affixValue、
   詞條區間 getAffixLimits → js/formula.js §5 / §6 */

// ancientSet：太古位置集合（{索引:true}）。太古改版（2026-07-23）：太古與否只看位置，
// 產出時由 pickAncientPositions 決定、洗煉時沿用原位置；太古位置數值必為滿值。
// 只擲「強度值」不算數值：數值一律由 affixValue 當場算（詞條存檔改造 → formula.js §6），
// 所以這裡不需要裝備等級來算值，rarityIdx 只用於過濾高階詞條池（minR）。
// itemLevel：裝備等級，只用來過濾「等級前不出現」的詞條（AFFIX_LEVEL_GATES → data.js）；
// 不傳（undefined）＝不過濾，呼叫端手上沒有裝備時維持舊行為。
function rollAffixes(count, rarityIdx, slot, ancientSet, affixCap, itemLevel) {
  var pool = [];
  for (var k in AFFIX_POOL) {
    var d = AFFIX_POOL[k];
    if (typeof affixIsAllLocked === 'function' && affixIsAllLocked(k)) continue;
    if (d.minR !== undefined && rarityIdx < d.minR) continue;          // 高階詞條限稀有度
    if (d.slots && slot && d.slots.indexOf(slot) < 0) continue;        // 部位專屬詞條
    if (typeof affixAvailableAtLevel === 'function' && !affixAvailableAtLevel(k, itemLevel)) continue;  // 等級前不出現
    pool.push([k, d.weight]);
  }
  var out = [], used = {};
  var guard = 0;
  while (out.length < count && guard++ < 300) {
    var key = wpick(pool);
    if (used[key]) continue;
    used[key] = true;
    var ancient = !!(ancientSet && ancientSet[out.length]);
    // 太古位置的強度值記為滿值（affixValue 另乘太古倍率），一般位置照 affixCap 擲骰
    out.push({ key: key, roll: ancient ? STRENGTH_ROLL_MAX : rollAffixStrength(affixCap), ancient: ancient });
  }
  return out;
}

// 裝備產出時從 n 個詞條位置隨機挑 k 個作為太古位置（回傳 {索引:true}）
function pickAncientPositions(n, k) {
  var idx = [], set = {};
  for (var i = 0; i < n; i++) idx.push(i);
  for (var j = 0; j < k && idx.length; j++) {
    set[idx.splice(Math.floor(Math.random() * idx.length), 1)[0]] = true;
  }
  return set;
}

function makeEquipment(stage, opts) {
  opts = opts || {};
  var slot = opts.slot || pick(ITEM_TYPES);
  var rarity = (opts.rarity !== undefined) ? opts.rarity : rollRarity(stage, opts.lootBonus);
  rarity = clamp(rarity, 0, RARITIES.length - 1);
  // 裝備等級分段（equipmentTierLevel → formula.js §6）：1~49 關掉 1 級裝、50~99 關掉 50 級裝、100~149 關掉 100 級裝…
  var lvl = equipmentTierLevel(opts.level || stage);
  var r = RARITIES[rarity];
  // 武器：決定武器類型（12 種；opts.weaponType 可指定，否則均等隨機）。
  // 必須先於詞條數決定——雙手武器詞條數 +1（TWO_HAND_BONUS_AFFIXES → data.js）。
  var weaponType = null;
  if (slot === 'weapon') {
    weaponType = (opts.weaponType && WEAPON_TYPES[opts.weaponType]) ? opts.weaponType : pick(Object.keys(WEAPON_TYPES));
  }
  var twoHand = !!(weaponType && WEAPON_TYPES[weaponType].cat === 'twoHand');
  var affixCount = ri(r.affix[0], r.affix[1]) + (twoHand ? TWO_HAND_BONUS_AFFIXES : 0);
  // 玩家屬性：幸運值（洗煉數值取優）；詞條上限率只在洗煉時偏重高數值段
  var luck = 0;
  if (typeof G !== 'undefined' && G && G.player) {
    var pst = getStats();
    luck = pst.luck;
  }
  // 太古詞條：產出時依詞條數量擲骰條數（rollAncientAffixCount → formula.js §6），位置隨機後永久固定。
  // opts.ancientCount 可指定條數（任務獎勵「任意2太古史詩裝備」用；超過詞條數自然截到上限）
  var ancientWant = (typeof opts.ancientCount === 'number')
    ? Math.max(0, Math.floor(opts.ancientCount))
    : rollAncientAffixCount(affixCount, luck);
  var ancientSet = pickAncientPositions(affixCount, ancientWant);
  var it = {
    id: uid(),
    kind: 'equip',
    slot: slot,
    rarity: rarity,
    level: lvl,
    name: RARITY_PREFIX[rarity] + pick(weaponType ? WEAPON_TYPES[weaponType].basenames : SLOT_BASENAMES[slot]),
    affixes: rollAffixes(affixCount, rarity === 11 ? 6 : rarity, slot, ancientSet, undefined, lvl),
    passive: null,
    enchant: null,   // { key, val }
    sockets: [],     // 寶石插槽 [{type, level}|null, ...]
    upgrade: 0,
    synthesized: false,
    locked: false
  };
  if (weaponType) {
    it.weaponType = weaponType;
    it.weaponAbility = null; // 武器專屬特殊能力（預留欄位；之後由 WEAPON_ABILITY_POOL 發放）
  }
  ensureSockets(it);
  // 傳說級以上附帶傳奇特效；帶 weaponTypes 的效果只會進入對應武器類型池。
  if (rarity >= PASSIVE_MIN_RARITY) {
    var passiveKeys = passiveKeysForItem(it);
    if (passiveKeys.length) {
      // 只存 key：傳奇特效數值完全由 key + 稀有度決定（passiveValue → formula.js §6）
      it.passive = { key: pick(passiveKeys) };
    }
  }
  return it;
}

/* 附魔威力/數值公式（enchantPower、enchantValueFor）→ js/formula.js §6 */

/* ---- 多附魔欄位 ----
   附魔數量依稀有度（普通 0、精良~獨特 1、史詩~神話 2、創世/神鑄創世 3）。
   舊存檔單附魔（it.enchant）延遲轉換為 it.enchants 陣列。 */
function itemEnchants(it) {
  /* 附魔功能關閉時（data.js ENCHANT_ENABLED）一律視為沒有附魔：屬性、評分、顯示都不計。
     回傳新陣列、不改動 it——it.enchants／舊的 it.enchant 原樣留著，改回 true 即恢復。 */
  if (!ENCHANT_ENABLED) return [];
  if (!it.enchants) {
    it.enchants = it.enchant ? [it.enchant] : [];
    delete it.enchant;
  }
  return it.enchants;
}

/* 對裝備套用附魔：同類附魔取較高值；有空欄位則新增；全滿則覆蓋最後一欄。
   存的是「附魔當下的寶石等級」而非數值（enchantValue → js/formula.js §6），
   所以「取較高」是比算出來的數值——既有那條可能帶變異倍率，不能只比寶石等級。 */
function applyEnchantTo(item, bookKey, gemLevel) {
  if (!ENCHANT_ENABLED) return item;
  var ens = itemEnchants(item);
  var gemLv = Math.max(0, Number(gemLevel) || 0);
  var val = enchantValueFor(item, bookKey, gemLv);
  for (var i = 0; i < ens.length; i++) {
    if (ens[i].key === bookKey) {
      if (val > enchantValue(item, ens[i])) ens[i] = { key: bookKey, gemLv: gemLv };
      return item;
    }
  }
  if (ens.length < enchantCapFor(item)) ens.push({ key: bookKey, gemLv: gemLv });
  else ens[ens.length - 1] = { key: bookKey, gemLv: gemLv };
  return item;
}

/* ---- 手動附魔（裝備介面操作，比照寶石鑲嵌） ---- */
// 物品種類 → 可用附魔類別
function enchantCatForType(type) {
  type = slotTypeOf(type);
  if (type === 'weapon' || type === 'ring' || type === 'gloves' || type === 'wrist') return 'atk';
  if (type === 'amulet' || type === 'boots') return 'util';
  return 'def'; // helmet / shoulder / chest / belt / legs
}
// 附魔：消耗 1 本書 + 精華；同類附魔僅可升級為更高數值。回傳 null=成功
function manualEnchant(it, bookKey) {
  if (!ENCHANT_ENABLED) return STR(1121);
  var e = ENCHANTS[bookKey];
  if (!e) return STR(1122);
  if ((G.player.books[bookKey] || 0) < 1) return STR(1123, e.name);
  var cat = enchantCatForType(it.slot);
  if (e.cat !== cat) {
    var catNames = { atk: STR(71), def: STR(72), util: STR(1124) };
    return STR(1125, SLOT_INFO[it.slot].name, catNames[cat]);
  }
  if (G.player.essence < ENCHANT_ESSENCE_COST) return STR(1126, ENCHANT_ESSENCE_COST);
  var ens = itemEnchants(it);
  var same = null;
  for (var i = 0; i < ens.length; i++) if (ens[i].key === bookKey) { same = ens[i]; break; }
  if (same) {
    if (enchantValueFor(it, bookKey, 0) <= enchantValue(it, same)) return STR(1127);
  } else if (ens.length >= enchantCapFor(it)) {
    return STR(1128);
  }
  G.player.books[bookKey]--;
  G.player.essence -= ENCHANT_ESSENCE_COST;
  applyEnchantTo(it, bookKey, 0);
  G.factory.stats.enchanted++;
  markStatsDirty();
  UI.dirty.equip = true; UI.dirty.inv = true; UI.dirty.header = true;
  return null;
}
// 取下附魔：返還 1 本附魔書（精華不退）
function removeEnchantAt(it, idx) {
  if (!ENCHANT_ENABLED) return false;
  var ens = itemEnchants(it);
  var en = ens[idx];
  if (!en) return false;
  ens.splice(idx, 1);
  G.player.books[en.key] = (G.player.books[en.key] || 0) + 1;
  markStatsDirty();
  UI.dirty.equip = true; UI.dirty.inv = true; UI.dirty.header = true;
  return true;
}

/* 強化倍率 upgradeMult、戰力評分 itemScore（含 SCORE_WEIGHTS 權重表）、
   分解產出 salvageResult → js/formula.js §6 */

function rerollResourceError(cost) {
  var missing = [];
  if (G.player.gold < cost.gold) missing.push(STR(73, fmt(cost.gold)));
  if (G.player.essence < cost.essence) missing.push(STR(1129, cost.essence));
  return missing.length ? STR(1130, missing.join('、')) : null;
}
function consumeRerollResources(cost) {
  G.player.gold -= cost.gold;
  G.player.essence -= cost.essence;
  // 任務進度：累計洗煉次數。整件洗與單條洗都經過這裡，各計 1 次
  if (G.factory && G.factory.stats) G.factory.stats.rerolled = (G.factory.stats.rerolled || 0) + 1;
}

// 傳奇數值由 passiveValue 讀固定基礎值；裝備參數僅保留呼叫相容。
function passiveLine(it, p) {
  var d = PASSIVE_POOL[p.key];
  var val = passiveValue(it, p);
  var desc = d.desc.replace(/\{v\}/g, fmt1(val));
  if (d.fx && d.fx.stagger) desc = desc.replace('{tick}', fmt1(val / d.fx.stagger.sec));
  return '【' + d.name + '】' + desc;
}

// it：附魔數值需要裝備等級與稀有度才能算（enchantValue → js/formula.js §6）
function enchantLine(it, en) {
  var e = ENCHANTS[en.key];
  var raw = enchantValue(it, en);
  var val = en.key === 'loot' ? effectiveDropRateEffect(raw) : raw;
  // 六系抗性附魔＝獨立乘區，顯示為「XX屬性抗性額外+N%」
  if (ENCHANT_RES_MAP[en.key]) {
    return STR(1131, e.emoji, e.name.replace('抗性', '屬性抗性'), pctStr(val));
  }
  var vs = (e.cat === 'atk') ? '+' + fmt(val) : '+' + pctStr(val);
  return e.emoji + ' ' + e.name + ' ' + vs;
}

/* 物品完整說明 HTML。

   ⚠️ 這是**純函式**：不得讀取 G，也不得改動傳入的物品。
   主執行緒（Worker 架構下沒有 G）與 Worker 兩邊都要能呼叫，讀 G 會讓 ui.js 用不了它，
   而 ui.js 用不了它的結果，就是那邊再長出一份簡化重寫的第二套實作，然後兩份慢慢分歧。

   洗煉模式只渲染屬性選取，費用與執行按鈕由 UI 裝備操作列處理。 */
function itemSocketHTML(it, mode) {
  var sockets = Array.isArray(it.sockets) ? it.sockets : [];
  var h = '<div class="it-sockets">' + (mode ? '' : '<div class="it-sockets-title">' + STR(1132) + '</div>');
  for (var si = 0; si < sockets.length; si++) {
    var g = sockets[si], text;
    var socketMult = divineSocketMultiplier(it, si);
    if (g && g.fused) text = (si + 1) + '. ' + fusedGemIconHTML(g.fused, 'gi-inline') + ' ' + esc(STR(1133, g.fused.stats.map(function (s) { var def = GEM_TYPES[s.type], v = fusedStatValue(s) * socketMult; return def.statName + ' +' + (def.pct ? pctStr(v) : fmt(v)); }).join('、')));
    else if (g && GEM_TYPES[g.type]) {
      var gt = GEM_TYPES[g.type];
      text = '<span class="sk-name">' + (si + 1) + '. ' + gemIconHTML(g.type, g.level, 'gi-inline') + ' ' + esc(GEM_NAMES[g.level] + gt.name) + '</span>' +
        '<span class="sk-val">' + esc(gt.statName.replace('%', '')) + ' +' +
        (gt.pct ? pctStr(gemStatValue(g.type, g.level) * socketMult) : fmt(gemStatValue(g.type, g.level) * socketMult)) + '</span>';
    } else text = STR(1134, (si + 1));
    var cls = 'socket ' + (socketMult > 1 ? 'sacred-socket ' : '') + (g ? 'filled' + (g.fused ? ' fused-socket' : '') : 'empty');
    if (mode) {
      h += '<div class="' + cls + ' socket-row' + (mode.selIdx === si ? ' is-socket-selected' : '') + '">' +
        '<button type="button" class="socket-pick" data-socket-pick="' + si + '" aria-pressed="' + (mode.selIdx === si) + '"' +
        (mode.pending ? ' disabled' : '') + '>' + text + '</button>';
      if (g) h += '<button type="button" class="socket-remove" data-socket-remove="' + si + '" aria-label="' + STR(1135, (si + 1)) + '"' + (mode.pending ? ' disabled' : '') + '>' + STR(74) + '</button>';
      h += '</div>';
    } else {
      h += '<span class="' + cls + '">' + text + '</span>';
    }
  }
  if (!sockets.length) h += '<div class="equip-material-empty">' + STR(1136) + '</div>';
  return h + '</div>';
}

/* 符文石圖（js/runeword_data.js 的 runeStoneSrc）。cls＝各處用來定尺寸與位置的 class。
   主執行緒的符文頁、裝備符文面板、背包角標與裝備詳情共用這一個入口。 */
function runeStoneHTML(id, cls) {
  if (!RUNE_BY_ID[id]) return '';
  return '<img class="rune-stone' + (cls ? ' ' + cls : '') + '" src="' + runeStoneSrc(id) + '" alt="" draggable="false" decoding="async">';
}

/* 符文孔區塊（取代原本附魔欄位的位置；符文與符文真言 → js/runeword.js）。
   純函式（不讀 G、不改 it）。mode＝符文鑲嵌頁（與 itemSocketHTML 的 mode 同形，{ selIdx, pending, draft }）：
   每孔變成可選取的列（data-socket-pick）；已刻印的符文右側是「抹除」（data-rune-erase，提示列出費用，符文不退還）；
   draft＝{ 孔索引: 符文id }，還沒刻印的暫放符文，列上是「取消」（data-rune-undraft），按下方「刻印」才真的鑲上；省略 mode 時只是唯讀顯示。
   構成目前符文真言的那幾顆，圖示底下有旋轉光暈（.rs-halo）。
   符文真言成形時列出名稱與全部效果；未成形時不給任何提示（不說差哪幾顆，讓玩家自己探索）。
   沒有符文孔的裝備（普通品質）：唯讀顯示不輸出任何東西；鑲嵌頁輸出一行說明。 */
function itemRuneHTML(it, mode) {
  if (typeof rwSlots !== 'function') return '';
  var slots = rwSlots(it);
  if (!slots.length) {
    return mode ? '<div class="it-sockets it-runes"><div class="equip-material-empty">' + STR(1642, rwRegularMaxSlots()) + '</div></div>' : '';
  }
  var rwAct = rwActiveWord(it);
  var filled = slots.filter(Boolean).length;
  var h = '<div class="it-sockets it-runes">' + (mode ? '' : '<div class="it-sockets-title">' + STR(1643, filled, slots.length) + '</div>');
  for (var i = 0; i < slots.length; i++) {
    var id = slots[i];
    var draftId = (!id && mode && mode.draft && mode.draft[i] && RUNE_BY_ID[mode.draft[i]]) ? mode.draft[i] : null;
    var shown = id || draftId;
    var inWord = !!id && !!rwAct && i >= rwAct.start && i < rwAct.start + rwAct.word.runes.length;
    var icon = runeStoneHTML(shown, 'rs-row');
    if (inWord) icon = '<span class="rs-halo">' + icon + '</span>';
    var text = shown
      ? '<span class="sk-name">' + (i + 1) + '. ' + icon + ' ' + esc(runeLabel(shown)) + '</span>' +
        '<span class="sk-val">' + esc(rwRuneStatLine(it, shown)) + '</span>'
      : STR(1644, (i + 1));
    var cls = 'socket ' + (shown ? 'filled rune-socket' + (inWord ? ' runeword-socket' : '') + (draftId ? ' is-draft' : '') : 'empty');
    if (!mode) {
      h += '<span class="' + cls + '">' + text + '</span>';
      continue;
    }
    h += '<div class="' + cls + ' socket-row' + (mode.selIdx === i ? ' is-socket-selected' : '') + '">' +
      '<button type="button" class="socket-pick" data-socket-pick="' + i + '" aria-pressed="' + (mode.selIdx === i) + '"' +
      (mode.pending ? ' disabled' : '') + '>' + text + '</button>';
    if (id) {
      var cost = runeEraseCost(it, id);
      h += '<button type="button" class="socket-remove" data-rune-erase="' + i + '" aria-label="' + STR(1645, (i + 1)) + '" data-tip="' + esc(STR(1646, runeEraseCostText(cost))) + '"' + (mode.pending ? ' disabled' : '') + '>' + STR(75) + '</button>';
    } else if (draftId) {
      h += '<button type="button" class="socket-remove" data-rune-undraft="' + i + '" aria-label="' + STR(1647, (i + 1)) + '"' + (mode.pending ? ' disabled' : '') + '>' + STR(76) + '</button>';
    }
    h += '</div>';
  }
  if (rwAct) {
    h += '<div class="it-runeword" style="--rw-c:' + RUNEWORD_TIER_COLORS[rwAct.word.tier] + '"><div class="it-runeword-name">' + STR(1648, esc(rwAct.word.name)) + '<span class="it-runeword-tier">' + esc(RUNEWORD_TIER_NAMES[rwAct.word.tier]) + '</span></div>';
    rwDescribeEntries(rwAct.word, it).forEach(function (e) {
      h += '<div class="it-runeword-line"' + (e.color ? ' style="color:' + e.color + '"' : '') + '>' + esc(e.text) + '</div>';
    });
    h += '</div>';
  }   // 沒成形時不給任何提示：符文真言要玩家自己探索
  return h + '</div>';
}

/* 裝備功能與懸停詳情共用標題，僅讀取傳入的物品與選項。 */
function itemHeaderHTML(it, opts) {
  opts = opts || {};
  var showAffixReroll = opts.showAffixReroll !== false;
  var r = RARITIES[it.rarity];
  var levelRarity = RARITIES[equipmentLevelRarityIndex(it.level)] || r;
  var curScore = itemScore(it);

  // 詞條池內容保留為隱藏模板，點擊按鈕時會搬到 body 層的獨立浮層，避免被詳情捲軸裁切。
  var poolHtml = '<div class="it-pool-box" aria-hidden="true">';
  poolHtml += '<div class="it-pool-title">' + STR(1137) + '</div>';
  for (var k in AFFIX_POOL) {
    var d = AFFIX_POOL[k];
    if (typeof affixIsAllLocked === 'function' && affixIsAllLocked(k)) continue;
    if (d.minR !== undefined && it.rarity < d.minR) continue;
    if (d.slots && d.slots.indexOf(it.slot) < 0 && d.slots.indexOf('all') < 0) continue;
    if (typeof affixAvailableAtLevel === 'function' && !affixAvailableAtLevel(k, it.level)) continue;   // 等級前不出現
    var reqRarity = d.minR ? ' <span style="font-size:10.5px;color:' + RARITIES[d.minR].color + '">(' + RARITIES[d.minR].name + '+)</span>' : '';

    var baseVal = affixBaseValue(k, it.level, it.rarity);
    if (typeof isTwoHandItem === 'function' && isTwoHandItem(it)) baseVal *= TWO_HAND_AFFIX_VALUE_MULT;
    var vMin = baseVal * 0.8;
    var vMax = baseVal * AFFIX_MAX_VALUE_MULT;
    var strMin = d.pct ? Math.round(vMin * 10) / 10 + '%' : Math.round(vMin);
    var strMax = d.pct ? Math.round(vMax * 10) / 10 + '%' : Math.round(vMax);

    poolHtml += '<div class="it-pool-item" style="display:flex; justify-content:space-between; gap:12px;">' +
      '<span>• ' + d.name + reqRarity + '</span>' +
      '<span style="color:#71717a; font-size:11.5px; font-family:monospace;">[' + strMin + ' ~ ' + strMax + ']</span>' +
      '</div>';
  }
  poolHtml += '</div>';

  var wdet = (typeof weaponDef === 'function') ? weaponDef(it) : null; // 武器類型（非武器＝null）
  var lockBtnHtml = '<button type="button" class="btn btn-it-lock' + (it.locked ? ' locked' : '') + '" data-act="lock" title="' + (it.locked ? STR(1138) : STR(1139)) + '" aria-label="' + (it.locked ? STR(1140) : STR(1141)) + '">' +
    '<svg viewBox="0 0 24 24" class="it-lock-svg" aria-hidden="true">' +
    '<rect x="4" y="10" width="16" height="12" rx="2" ry="2"></rect>' +
    '<path d="' + (it.locked ? 'M7 10V7a5 5 0 0 1 10 0v3' : 'M7 10V7a5 5 0 0 1 9.5-2.2') + '"></path>' +
    '</svg>' +
    '</button>';
  var headActionsHtml = '<span class="it-head-actions">' +
    (opts.isEquipped ? STR(1142) : '') +
    lockBtnHtml +
    (showAffixReroll ? '<button type="button" class="btn-it-pool" data-affix-pool-toggle aria-label="' + STR(1143) + '">!</button>' + poolHtml : '') +
    '</span>';

  var h = '<div class="it-name" style="position:relative; color:' + r.color + '">' +
    (equipIconFile(it) ? '<img class="it-name-icon" src="images/' + equipIconFile(it) + '" alt="">' : (wdet ? wdet.emoji : SLOT_INFO[it.slot].emoji) + ' ') + esc(it.name) +
    (it.upgrade ? ' <span class="it-up' + ((opts && opts.justUpgraded) ? ' upgrade-pop' : '') + '">+' + it.upgrade + '</span>' : '') +
    (it.synthesized ? ' ' + STR(1144) : '') +
    headActionsHtml +
    '</div>';

  h += '<div class="it-sub"><span>' + STR(1145, r.name, ((typeof itemTypeLabel === 'function') ? itemTypeLabel(it) : SLOT_INFO[it.slot].name)) + '<span class="it-level" style="color:' + levelRarity.color + '">' + STR(1146, it.level) + '</span>';
  return '' + h + '</span>' + STR(1147, fmt(curScore)) + '</div>';
}

function itemDetailHTML(it, cmp, opts) {
  cmp = null; // 裝備比較改版：不再在單個 tips 中進行屬性差值比較
  opts = opts || {};
  var h = itemHeaderHTML(it, opts);
  if (opts.socket && opts.socket.active) return '<div class="equip-socket-header">' + h + '</div><div class="equip-socket-page">' + itemSocketHTML(it, opts.socket) + '</div>';
  var showAffixReroll = opts.showAffixReroll !== false;
  /* selIdx 是 it.affixes 的索引；洗完保留選取位置，執行入口在下方操作列。 */
  var reroll = opts.reroll || null;
  var rerollActive = !!(reroll && reroll.active);
  var rerollSelIdx = rerollActive ? reroll.selIdx : -1;

  h += '<div class="it-affixes' + (rerollActive ? ' is-reroll-mode' : '') + '">';
  var um = upgradeMult(it);
  var curMap = {};
  for (var i = 0; i < it.affixes.length; i++) {
    var a = it.affixes[i], av = affixValue(it, a);
    curMap[a.key] = (curMap[a.key] || 0) + (a.key === 'loot' ? effectiveDropRateEffect(av) : av) * um;
  }
  var cmpMap = {};
  if (cmp) {
    var cum = upgradeMult(cmp);
    for (var i = 0; i < cmp.affixes.length; i++) {
      var a = cmp.affixes[i], cav = affixValue(cmp, a);
      cmpMap[a.key] = (cmpMap[a.key] || 0) + (a.key === 'loot' ? effectiveDropRateEffect(cav) : cav) * cum;
    }
  }

  var processedKeys = {};
  for (var i = 0; i < it.affixes.length; i++) {
    var k = it.affixes[i].key;
    if (processedKeys[k]) continue;
    processedKeys[k] = true;
    var vCur = curMap[k];
    var vCmp = cmpMap[k] || 0;
    var def = AFFIX_POOL[k];
    if (!def) continue;   // 已從參數表下架的詞條：不渲染（數值仍以凍結值計入屬性與評分）
    var name = esc(def.name.replace('%', ''));

    var limits = getAffixLimits(k, it.level, it.rarity, it);
    // 滿值高亮改看強度值（精確判定，不再靠 0.01 容差比對數值）；太古位置恆視為滿值
    var isMax = !!it.affixes[i].ancient || (Number(it.affixes[i].roll) || 0) >= STRENGTH_ROLL_MAX;
    var limitMult = k === 'loot' ? DROP_RATE_EFFECT_MULT : 1;
    var minDisplay = def.pct ? pctStr(limits.min * um * limitMult) : fmt(limits.min * um * limitMult);
    var maxDisplay = def.pct ? pctStr(limits.max * um * limitMult) : fmt(limits.max * um * limitMult);
    var isImprinted = it.imprint && !it.imprint.inactive && it.imprint.index === i && (it.imprint.kind === 'sacredAffix' || it.imprint.kind === 'ancientAffix');
    var isAncient = !!it.affixes[i].ancient || !!isImprinted;
    var limitTip = isAncient
      ? STR(1148)
      : STR(1149, minDisplay, maxDisplay);

    var forgedClass = isAncient ? ancientForgeAffixClass(it.affixes[i].ancientForgeOrder) : '';
    var valColor = forgedClass ? 'var(--ancient-forge-color)' : isImprinted ? '#60a5fa' : isMax ? '#fbbf24' : '';
    var valHtml = '<span' + (valColor ? ' style="color:' + valColor + ';font-weight:bold"' : '') + '>' + (def.pct ? pctStr(vCur) : fmt(vCur)) + '</span>';

    var rrSelected = rerollActive && i === rerollSelIdx;

    var diffStr = '';
    if (vCmp !== 0) {
      var diff = vCur - vCmp;
      if (Math.abs(diff) > 0.05) {
        if (diff > 0) diffStr = ' <span style="color: #4ade80">↑' + (def.pct ? pctStr(diff) : fmt(diff)) + '</span>';
        else diffStr = ' <span style="color: #fca5a5">↓' + (def.pct ? pctStr(-diff) : fmt(-diff)) + '</span>';
      }
    }

    var lineStyle = isImprinted ? 'color:#60a5fa;' : (vCmp === 0 && cmp && !isAncient) ? 'color: #4ade80;' : '';
    var catClass = ' afx-' + affixCat(k);   // 詞條分類分色（基礎紫/進攻粉/防禦青/功能綠）
    if (isAncient) catClass += ' ancient-affix';
    if (isImprinted) catClass += ' sacred-affix';
    catClass += forgedClass;
    var marker = isAncient ? '<span class="ancient-star" aria-label="' + STR(1150) + '">✡</span>' : '◆';
    if (showAffixReroll) {
      var rowClass = rerollActive ? ' is-reroll-pickable' + (rrSelected ? ' is-reroll-selected' : '') : '';
      h += '<div class="it-affix-row it-affix' + catClass + rowClass + '" style="' + lineStyle + '">' +
        '<div class="it-affix-text"' + (rerollActive ? ' data-reroll-pick="' + i + '"' : '') + '><span class="act-btn-tooltip" style="cursor:help;" data-tip="' + esc(limitTip) + '"><span class="afx-label">' + marker + ' ' + name + '</span><span class="afx-val">+' + valHtml + '</span></span>' +
        diffStr + '</div></div>';
    } else {
      h += '<div class="it-affix' + catClass + '" style="' + lineStyle + '"><span class="act-btn-tooltip" style="cursor:help;" data-tip="' + esc(limitTip) + '"><span class="afx-label">' + marker + ' ' + name + '</span><span class="afx-val">+' + valHtml + '</span></span>' +
        diffStr + '</div>';
    }
  }
  if (cmp) {
    for (var i = 0; i < cmp.affixes.length; i++) {
      var k = cmp.affixes[i].key;
      if (processedKeys[k]) continue;
      processedKeys[k] = true;
      var vCmp = cmpMap[k];
      var def = AFFIX_POOL[k];
      var name = esc(def.name.replace('%', ''));
      var cmpMarker = cmp.affixes[i].ancient ? '<span class="ancient-star">✡</span>' : '◆';
      h += '<div class="it-affix' + (cmp.affixes[i].ancient ? ' ancient-affix' : '') + '" style="color: #f87171; text-decoration: line-through;">' + cmpMarker + ' ' + name + ' -' + (def.pct ? pctStr(vCmp) : fmt(vCmp)) + '</div>';
    }
  }
  h += '</div>';

  if (cmp && cmp.passive && (!it.passive || it.passive.key !== cmp.passive.key)) {
    h += '<div class="it-passive" style="color: #f87171; text-decoration: line-through;">' + esc(passiveLine(cmp, cmp.passive)) + '</div>';
  }
  if (it.passive) {
    if (equippedPassiveRepeated(it, opts.equipment, opts.asuraOn)) {
      h += '<div class="it-passive it-passive-repeated" style="color: #6b7280">' + esc(passiveLine(it, it.passive) + STR(2145)) + '</div>';
    } else if (!cmp) {
      h += '<div class="it-passive">' + esc(passiveLine(it, it.passive)) + '</div>';
    } else if (!cmp.passive || cmp.passive.key !== it.passive.key) {
      h += '<div class="it-passive" style="color: #4ade80">' + esc(passiveLine(it, it.passive)) + '</div>';
    } else {
      h += '<div class="it-passive">' + esc(passiveLine(it, it.passive)) + '</div>';
    }
  }

  if (it.imprint) {
    var ip = it.imprint;
    h += '<div class="it-imprint" style="color:#60a5fa">' + esc(STR(2177, STR(2178 + ['sacredAffix','ancientAffix','sacredSocket','extraAffix','extraAncient','legendary','refund'].indexOf(ip.kind), DIVINE_FORGE.refundRate * 100))) + '</div>';
    if (ip.affix && AFFIX_POOL[ip.affix.key]) {
      var def = AFFIX_POOL[ip.affix.key], value = affixValue(it, ip.affix) * um;
      var ipForgedClass = ip.affix.ancient ? ancientForgeAffixClass(ip.affix.ancientForgeOrder) : '';
      h += '<div class="it-imprint' + ipForgedClass + '" style="color:#60a5fa">' + (ipForgedClass ? '<span class="ancient-star">✡</span> ' : '') + esc(def.name) + ' +' + (def.pct ? pctStr(value) : fmt(value)) + '</div>';
    }
    if (ip.passive) h += '<div class="it-imprint" style="color:#60a5fa">' + esc(passiveLine(it, ip.passive)) + '</div>';
  }

  // 附魔與寶石區塊可移至裝備頁右側；懸停提示仍保留完整效果。
  if (!rerollActive && opts.showEnhancements !== false) {
    // 附魔（多欄位，數量依稀有度）
    var itEns = itemEnchants(it);
    var cmpEns = cmp ? itemEnchants(cmp) : [];
    var cmpEnMap = {};
    cmpEns.forEach(function (ce) { cmpEnMap[ce.key] = enchantValue(cmp, ce); });
    var itEnKeys = {};
    itEns.forEach(function (en2) { itEnKeys[en2.key] = true; });
    // 對方有而自己沒有的附魔（劃線顯示）
    cmpEns.forEach(function (ce) {
      if (!itEnKeys[ce.key] && ENCHANTS[ce.key]) {
        h += '<div class="it-enchant" style="color: #f87171; text-decoration: line-through;">' + esc(enchantLine(cmp, ce)) + '</div>';
      }
    });
    itEns.forEach(function (en, enIdx) {
      var e = ENCHANTS[en.key];
      if (!e) return;
      if (!cmp) {
        var canRemove = !!(opts.enchant && opts.enchant.active);
        var removeAttrs = canRemove ? ' data-enchant-remove="' + enIdx + '" data-tip="' + STR(1152) + '"' : '';
        h += '<div class="it-enchant' + (canRemove ? ' removable' : '') + '"' + removeAttrs + '>' + esc(enchantLine(it, en)) + '</div>';
      } else if (!(en.key in cmpEnMap)) {
        h += '<div class="it-enchant" style="color: #4ade80">' + esc(enchantLine(it, en)) + '</div>';
      } else {
        var ediff = enchantValue(it, en) - cmpEnMap[en.key];
        var ediffStr = '';
        if (Math.abs(ediff) > 0.05) {
          var dfStr = (e.cat === 'atk') ? fmt(Math.abs(ediff)) : pctStr(Math.abs(ediff));
          ediffStr = ediff > 0
            ? ' <span style="color: #4ade80">↑' + dfStr + '</span>'
            : ' <span style="color: #f87171">↓' + dfStr + '</span>';
        }
        var env = enchantValue(it, en);
        var vs = (e.cat === 'atk') ? '+' + fmt(env) : '+' + pctStr(env);
        h += '<div class="it-enchant">' + e.emoji + ' ' + esc(e.name) + ' ' + vs + ediffStr + '</div>';
      }
    });

    // 符文孔：接在附魔原本的位置（附魔功能關閉後，上面的附魔迴圈不會輸出任何東西）
    h += itemRuneHTML(it, null);

    /* 寶石插槽。
       這裡刻意不呼叫 ensureSockets(it)——渲染函式不該改狀態。鑲孔補齊已由 Worker 在
       開機與讀檔時統一處理（sim.worker.js 的 backfillItemSockets），在這裡再補一次，
       碰到的還是 UI 端的快照複本，改了也不會回到權威狀態，只是白費而且誤導。 */
    if (Array.isArray(it.sockets) && it.sockets.length) h += itemSocketHTML(it, null);
  }
  return h;
}

/* ---- 裝備洗煉（隨機重骰所有詞條；費用公式 rerollCost → js/formula.js §7） ---- */
// 回傳 null=成功，否則錯誤訊息
function rerollItemAffixes(it) {
  var cost = rerollCost(it);
  var err = rerollResourceError(cost);
  if (err) return err;
  consumeRerollResources(cost);
  var affixCap = getStats().affixCap;
  // 太古位置永久固定：洗煉沿用原太古位置（必滿值換種類），非太古位置永不洗出太古
  var ancientSet = {};
  var forgedOrders = it.affixes.map(function (a) { return a.ancientForgeOrder; });
  for (var ai = 0; ai < it.affixes.length; ai++) {
    if (it.affixes[ai].ancient) ancientSet[ai] = true;
  }
  it.affixes = rollAffixes(it.affixes.length, it.rarity, it.slot, ancientSet, affixCap, it.level);
  it.affixes.forEach(function (a, i) { if (a.ancient && forgedOrders[i]) a.ancientForgeOrder = forgedOrders[i]; });
  markStatsDirty();
  UI.dirty.header = true; UI.dirty.equip = true; UI.dirty.inv = true;
  return null;
}

// 單獨重骰某一個屬性的種類與數值；太古位置維持太古（必滿值，只換種類）
function rerollSingleAffix(it, affixKey) {
  var cost = rerollCost(it);
  var err = rerollResourceError(cost);
  if (err) return err;

  var targetIdx = -1;
  var used = {};
  for (var i = 0; i < it.affixes.length; i++) {
    if (it.affixes[i].key === affixKey) {
      targetIdx = i;
    } else {
      used[it.affixes[i].key] = true;
    }
  }
  if (targetIdx < 0) return STR(1153);

  var pool = [];
  for (var k in AFFIX_POOL) {
    var d = AFFIX_POOL[k];
    if (typeof affixIsAllLocked === 'function' && affixIsAllLocked(k)) continue;
    if (d.minR !== undefined && it.rarity < d.minR) continue;
    if (d.slots && it.slot && d.slots.indexOf(it.slot) < 0) continue;
    if (typeof affixAvailableAtLevel === 'function' && !affixAvailableAtLevel(k, it.level)) continue;   // 等級前不出現
    if (used[k]) continue;
    pool.push([k, d.weight]);
  }

  if (pool.length === 0) return STR(1154);

  consumeRerollResources(cost);

  var affixCap = getStats().affixCap;
  var newKey = wpick(pool);
  // 太古與否只看位置：太古位置洗煉必為滿值、只變換詞條種類；非太古位置永不洗出太古
  var isAncient = !!it.affixes[targetIdx].ancient;
  var forgedOrder = it.affixes[targetIdx].ancientForgeOrder;
  it.affixes[targetIdx] = {
    key: newKey,
    roll: isAncient ? STRENGTH_ROLL_MAX : rollAffixStrength(affixCap),
    ancient: isAncient
  };
  if (isAncient && forgedOrder) it.affixes[targetIdx].ancientForgeOrder = forgedOrder;

  markStatsDirty();
  UI.dirty.header = true; UI.dirty.equip = true; UI.dirty.inv = true;
  return null;
}

// 自動機組零件生成（node 未指定時「依節點均衡」挑選，避免分解零件過多稀釋合成零件）
function makePart(tier, node) { return null; }
function partDesc(p) {
  // 小於 1 的機率值保留兩位小數（如 0.15%），其餘一位
  var val = effectivePartEffectValue(p.key, partValue(p));
  var vs = (val < 1) ? String(Math.round(val * 100) / 100) : fmt1(val);
  return PART_TYPES[p.key].desc.replace('{v}', vs);
}
