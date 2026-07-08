'use strict';
/* ============ 裝備 / 物品生成 / 寶石 ============ */

/* ---- 寶石庫存（G.player.gems = { type: {1..5: count} }） ---- */
function gemCount(type, lv) {
  var t = G.player.gems[type];
  return (t && t[lv]) || 0;
}
function addGem(type, lv, n) {
  if (!G.player.gems[type]) {
    G.player.gems[type] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  }
  G.player.gems[type][lv] = Math.max(0, (G.player.gems[type][lv] || 0) + (n === undefined ? 1 : n));
  UI.dirty.header = true; UI.dirty.gems = true;
}
function randomGemType() { return pick(Object.keys(GEM_TYPES)); }
function totalGemsOfLevel(lv) {
  var sum = 0;
  for (var t in GEM_TYPES) sum += gemCount(t, lv);
  return sum;
}
function totalGemsAll() {
  var sum = 0;
  for (var t in GEM_TYPES) for (var lv = 1; lv <= GEM_MAX_LEVEL; lv++) sum += gemCount(t, lv);
  return sum;
}
// 消耗一顆指定等級的寶石（取存量最多的種類）；回傳種類或 null
function takeGemOfLevel(lv) {
  var best = null, bestN = 0;
  for (var t in GEM_TYPES) {
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

/* ================ 融合寶石（雙屬性，僅 5 階可融合） ================
   G.player.fusedGems = [ { id, stats:[{type,val}x1~2], level:5, fusions:n } ] */
function fusedGemStatText(fg) {
  return fg.stats.map(function (s) {
    var gt = GEM_TYPES[s.type];
    return gt.statName.replace('%', '') + ' +' + (gt.pct ? pctStr(s.val) : fmt(s.val));
  }).join('、');
}
function fusedGemLabel(fg) {
  var emojis = fg.stats.map(function (s) { return GEM_TYPES[s.type].emoji; }).join('');
  return emojis + '融合寶石（' + fusedGemStatText(fg) + '）';
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

// 融合素材參照 → 正規化 { stats, fusions, ref }；plain 需持有 5 階寶石
function normalizeFuseMaterial(ref) {
  if (!ref) return null;
  if (ref.kind === 'plain') {
    if (gemCount(ref.type, GEM_MAX_LEVEL) < 1) return null;
    return { stats: [{ type: ref.type, val: gemStatValue(ref.type, GEM_MAX_LEVEL) }], fusions: 0, ref: ref };
  }
  var fg = findFusedGem(ref.id);
  if (!fg) return null;
  return { stats: fg.stats, fusions: fg.fusions || 0, ref: ref };
}
// 融合成功率公式 gemFuseRate → js/formula.js §8
// 屬性相容：融合後屬性種類聯集不得超過 2（涵蓋規則 4 全部情境）
function gemFuseTypesOk(m1, m2) {
  var set = {};
  m1.stats.forEach(function (s) { set[s.type] = true; });
  m2.stats.forEach(function (s) { set[s.type] = true; });
  return Object.keys(set).length <= 2 ? Object.keys(set) : null;
}
// 消耗素材（成功時雙方都消耗；失敗時只消耗較弱方）
function consumeFuseMaterial(m) {
  if (m.ref.kind === 'plain') addGem(m.ref.type, GEM_MAX_LEVEL, -1);
  else removeFusedGem(m.ref.id);
}
// 失敗降解：4~8 顆 1 級或 2~4 顆 2 級同屬性寶石（各 50%）
function degradeFuseMaterial(m) {
  var type = pick(m.stats).type;
  var out;
  if (chance(50)) { out = { lv: 1, n: ri(4, 8) }; }
  else { out = { lv: 2, n: ri(2, 4) }; }
  addGem(type, out.lv, out.n);
  return { type: type, lv: out.lv, n: out.n };
}

/* 執行融合 v2；回傳 { err } 或 { success, result } 或 { success:false, degraded } */
function fuseGemsV2(ref1, ref2) {
  var m1 = normalizeFuseMaterial(ref1);
  var m2 = normalizeFuseMaterial(ref2);
  if (!m1 || !m2) return { err: '素材不足（僅限 5 階寶石）' };
  if (ref1.kind === 'plain' && ref2.kind === 'plain' && ref1.type === ref2.type && gemCount(ref1.type, GEM_MAX_LEVEL) < 2) {
    return { err: '同種寶石需要 2 顆' };
  }
  if (ref1.kind === 'fused' && ref2.kind === 'fused' && ref1.id === ref2.id) return { err: '不能與自己融合' };
  var unionTypes = gemFuseTypesOk(m1, m2);
  if (!unionTypes) return { err: '屬性不相容：融合後最多只能有 2 種屬性（雙屬性寶石只能與相同雙屬性、或含其屬性的單一寶石融合）' };

  var rate = gemFuseRate(m1, m2);
  if (chance(rate)) {
    // === 成功：雙方消耗，產出融合寶石 ===
    consumeFuseMaterial(m1);
    consumeFuseMaterial(m2);
    var stats = unionTypes.map(function (t) {
      var v1 = null, v2 = null;
      m1.stats.forEach(function (s) { if (s.type === t) v1 = s.val; });
      m2.stats.forEach(function (s) { if (s.type === t) v2 = s.val; });
      var v;
      if (v1 !== null && v2 !== null) {
        // 同屬性：介於兩者之間，上限為較大值的 2 倍
        v = rnd(Math.min(v1, v2), Math.max(v1, v2) * 2);
      } else {
        // 單方屬性：數值隨機（不一定更高）
        v = (v1 !== null ? v1 : v2) * rnd(0.5, 1.5);
      }
      return { type: t, val: Math.round(v * 10) / 10 };
    });
    var result = { id: uid(), stats: stats, level: GEM_MAX_LEVEL, fusions: m1.fusions + m2.fusions + 1 };
    if (!G.player.fusedGems) G.player.fusedGems = [];
    G.player.fusedGems.push(result);
    UI.dirty.gems = true; UI.dirty.header = true;
    return { success: true, result: result, rate: rate };
  }
  // === 失敗：較弱方降解（單屬性先於雙屬性；同為雙屬性比數值加總） ===
  var weaker;
  if (m1.stats.length !== m2.stats.length) {
    weaker = m1.stats.length < m2.stats.length ? m1 : m2;
  } else {
    var sum1 = m1.stats.reduce(function (a, s) { return a + s.val; }, 0);
    var sum2 = m2.stats.reduce(function (a, s) { return a + s.val; }, 0);
    weaker = sum1 <= sum2 ? m1 : m2;
  }
  consumeFuseMaterial(weaker);
  var deg = degradeFuseMaterial(weaker);
  UI.dirty.gems = true; UI.dirty.header = true;
  return { success: false, degraded: deg, rate: rate };
}

/* ================ 寶石商店 ================ */
function gemShop() {
  if (!G.player.gemShop) {
    G.player.gemShop = { items: [], refreshCount: 0, hourStart: Date.now() };
  }
  return G.player.gemShop;
}
function shopHourlyReset() {
  var s = gemShop();
  if (Date.now() - s.hourStart >= 3600 * 1000) {
    s.refreshCount = 0;
    s.hourStart = Date.now();
    rollGemShop();
    UI.dirty.gems = true;
  }
}
function shopResetCountdown() { // 秒
  return Math.max(0, Math.ceil((gemShop().hourStart + 3600 * 1000 - Date.now()) / 1000));
}
function rollGemShop() {
  var s = gemShop();
  s.items = [];
  for (var i = 0; i < GEM_SHOP_SIZE; i++) {
    var lv = wpick(GEM_SHOP_TABLE.map(function (t) { return [t.lv, t.w]; }));
    s.items.push({ type: randomGemType(), lv: lv, sold: false });
  }
  UI.dirty.gems = true;
}
// 刷新費用公式 shopRefreshCost → js/formula.js §8
// 手動刷新（消耗金幣，次數每小時重置）
function refreshGemShop() {
  shopHourlyReset();
  var cost = shopRefreshCost();
  if (G.player.gold < cost) return '金幣不足（需 ' + fmt(cost) + '）';
  G.player.gold -= cost;
  gemShop().refreshCount++;
  rollGemShop();
  UI.dirty.header = true;
  return null;
}
function buyShopGem(idx) {
  var s = gemShop();
  var item = s.items[idx];
  if (!item || item.sold) return '此寶石已售出';
  var price = gemShopPrice(item.lv);
  if (G.player.gold < price) return '金幣不足（需 ' + fmt(price) + '）';
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
    if (item.sold) continue;
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
// 補齊插槽陣列（舊存檔裝備 / 稀有度提升後）
function ensureSockets(it) {
  var n = socketCountFor(it.rarity);
  if (!it.sockets) it.sockets = [];
  while (it.sockets.length < n) it.sockets.push(null);
  return it.sockets;
}
// 鑲嵌：從庫存取一顆該種類最高等級的寶石放入第一個空槽
function socketGem(it, type) {
  ensureSockets(it);
  var idx = it.sockets.indexOf(null);
  if (idx < 0) return '插槽已滿';
  var lv = 0;
  for (var l = GEM_MAX_LEVEL; l >= 1; l--) { if (gemCount(type, l) > 0) { lv = l; break; } }
  if (!lv) return '沒有這種寶石';
  addGem(type, lv, -1);
  it.sockets[idx] = { type: type, level: lv };
  markStatsDirty();
  return null; // 成功
}
// 鑲嵌融合寶石（從 fusedGems 庫存移入插槽）
function socketFusedGem(it, fusedId) {
  ensureSockets(it);
  var idx = it.sockets.indexOf(null);
  if (idx < 0) return '插槽已滿';
  var fg = removeFusedGem(fusedId);
  if (!fg) return '找不到該融合寶石';
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

/* 稀有度擲骰 rollRarity、詞條數值 rollAffixValue、詞條區間 getAffixLimits → js/formula.js §5 / §6 */

function rollAffixes(count, itemLevel, rarityIdx, slot, luck) {
  var pool = [];
  for (var k in AFFIX_POOL) {
    var d = AFFIX_POOL[k];
    if (d.minR !== undefined && rarityIdx < d.minR) continue;          // 高階詞條限稀有度
    if (d.slots && slot && d.slots.indexOf(slot) < 0) continue;        // 部位專屬詞條
    pool.push([k, d.weight]);
  }
  var out = [], used = {};
  var guard = 0;
  while (out.length < count && guard++ < 300) {
    var key = wpick(pool);
    if (used[key]) continue;
    used[key] = true;
    var val = rollAffixValue(key, itemLevel, rarityIdx);
    // 幸運值：機率重骰一次取較佳值
    if (luck && chance(luck / 2)) {
      val = Math.max(val, rollAffixValue(key, itemLevel, rarityIdx));
    }
    out.push({ key: key, val: val });
  }
  return out;
}

function makeEquipment(stage, opts) {
  opts = opts || {};
  var slot = opts.slot || pick(ITEM_TYPES);
  var rarity = (opts.rarity !== undefined) ? opts.rarity : rollRarity(stage, opts.lootBonus);
  rarity = clamp(rarity, 0, RARITIES.length - 1);
  var lvl = Math.max(1, opts.level || (stage + ri(-1, 1)));
  var r = RARITIES[rarity];
  var affixCount = ri(r.affix[0], r.affix[1]);
  // 玩家屬性：幸運值（詞條取優）與詞條上限率（突破稀有度詞條數，至多 MAX_AFFIXES）
  var luck = 0;
  if (typeof G !== 'undefined' && G && G.player) {
    var pst = getStats();
    luck = pst.luck;
    if (pst.affixCap > 0 && affixCount < MAX_AFFIXES && chance(pst.affixCap)) affixCount++;
  }
  var it = {
    id: uid(),
    kind: 'equip',
    slot: slot,
    rarity: rarity,
    level: lvl,
    name: RARITY_PREFIX[rarity] + pick(SLOT_BASENAMES[slot]),
    affixes: rollAffixes(affixCount, lvl, rarity, slot, luck),
    passive: null,
    enchant: null,   // { key, val }
    sockets: [],     // 寶石插槽 [{type, level}|null, ...]
    upgrade: 0,
    synthesized: false,
    locked: false
  };
  ensureSockets(it);
  // 稀有級以上附帶特殊被動（數值公式 passiveValueFor → js/formula.js §6）
  if (rarity >= RARE_IDX) {
    var pk = pick(Object.keys(PASSIVE_POOL));
    it.passive = { key: pk, val: passiveValueFor(pk, rarity) };
  }
  return it;
}

/* 附魔威力/數值公式（enchantPower、enchantValueFor）→ js/formula.js §6 */

/* ---- 多附魔欄位 ----
   附魔數量依稀有度（普~稀有 1、獨特~傳說 2、神話/創世 3）。
   舊存檔單附魔（it.enchant）延遲轉換為 it.enchants 陣列。 */
function itemEnchants(it) {
  if (!it.enchants) {
    it.enchants = it.enchant ? [it.enchant] : [];
    delete it.enchant;
  }
  return it.enchants;
}

// 對裝備套用附魔：同類附魔取較高值；有空欄位則新增；全滿則覆蓋最後一欄
function applyEnchantTo(item, bookKey, gemLevel) {
  var ens = itemEnchants(item);
  var val = enchantValueFor(item, bookKey, gemLevel);
  for (var i = 0; i < ens.length; i++) {
    if (ens[i].key === bookKey) {
      ens[i].val = Math.max(ens[i].val, val);
      return item;
    }
  }
  if (ens.length < enchantCapFor(item)) ens.push({ key: bookKey, val: val });
  else ens[ens.length - 1] = { key: bookKey, val: val };
  return item;
}

/* ---- 手動附魔（裝備介面操作，比照寶石鑲嵌） ---- */
// 物品種類 → 可用附魔類別
function enchantCatForType(type) {
  if (type === 'weapon' || type === 'ring' || type === 'gloves') return 'atk';
  if (type === 'amulet' || type === 'boots') return 'util';
  return 'def'; // helmet / shoulder / chest / belt / legs
}
// 附魔：消耗 1 本書 + 精華；同類附魔僅可升級為更高數值。回傳 null=成功
function manualEnchant(it, bookKey) {
  var e = ENCHANTS[bookKey];
  if (!e) return '未知附魔書';
  if ((G.player.books[bookKey] || 0) < 1) return '沒有「' + e.name + '」書';
  var cat = enchantCatForType(it.slot);
  if (e.cat !== cat) {
    var catNames = { atk: '攻擊', def: '防禦', util: '功能' };
    return SLOT_INFO[it.slot].name + '只能使用' + catNames[cat] + '類附魔';
  }
  if (G.player.essence < ENCHANT_ESSENCE_COST) return '附魔精華不足（需 ' + ENCHANT_ESSENCE_COST + '）';
  var ens = itemEnchants(it);
  var same = null;
  for (var i = 0; i < ens.length; i++) if (ens[i].key === bookKey) { same = ens[i]; break; }
  if (same) {
    if (enchantValueFor(it, bookKey, 0) <= same.val) return '已有同類附魔且數值不會提升';
  } else if (ens.length >= enchantCapFor(it)) {
    return '附魔欄已滿（點擊既有附魔可取下）';
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

function affixLine(a) {
  var def = AFFIX_POOL[a.key];
  return def.name.replace('%', '') + ' +' + (def.pct ? pctStr(a.val) : fmt(a.val));
}

function passiveLine(p) {
  var d = PASSIVE_POOL[p.key];
  return '【' + d.name + '】' + d.desc.replace('{v}', fmt1(p.val));
}

function enchantLine(en) {
  var e = ENCHANTS[en.key];
  var vs = (e.cat === 'atk') ? '+' + fmt(en.val) : '+' + pctStr(en.val);
  return e.emoji + ' ' + e.name + ' ' + vs;
}

// 物品完整說明 HTML
function itemDetailHTML(it, cmp) {
  var r = RARITIES[it.rarity];
  
  var poolHtml = '<div class="it-pool-box" style="display:none;">';
  poolHtml += '<div class="it-pool-title">可能出現的詞條：</div>';
  for (var k in AFFIX_POOL) {
    var d = AFFIX_POOL[k];
    if (d.slots && d.slots.indexOf(it.slot) < 0 && d.slots.indexOf('all') < 0) continue;
    var reqRarity = d.minR ? ' <span style="font-size:10.5px;color:'+RARITIES[d.minR].color+'">('+RARITIES[d.minR].name+'+)</span>' : '';
    
    var baseVal = (d.base + d.base * d.lv * (it.level - 1)) * r.mult;
    var vMin = baseVal * 0.8;
    var vMax = baseVal * 1.2;
    var strMin = d.pct ? Math.round(vMin * 10)/10 + '%' : Math.round(vMin);
    var strMax = d.pct ? Math.round(vMax * 10)/10 + '%' : Math.round(vMax);

    poolHtml += '<div class="it-pool-item" style="display:flex; justify-content:space-between; gap:12px;">' +
      '<span>• ' + d.name + reqRarity + '</span>' + 
      '<span style="color:#71717a; font-size:11.5px; font-family:monospace;">[' + strMin + ' ~ ' + strMax + ']</span>' +
      '</div>';
  }
  poolHtml += '</div>';

  var h = '<div class="it-name" style="position:relative; color:' + r.color + '">' +
    SLOT_INFO[it.slot].emoji + ' ' + esc(it.name) +
    (it.upgrade ? ' <span class="it-up">+' + it.upgrade + '</span>' : '') +
    (it.synthesized ? ' <span class="it-syn">✦合成</span>' : '') +
    (it.locked ? ' 🔒' : '') +
    '<button class="btn-it-pool" onclick="var b=this.nextElementSibling; b.style.display=b.style.display===\'none\'?\'block\':\'none\'; event.stopPropagation();">!</button>' +
    poolHtml +
    '</div>';
  
  h += '<div class="it-sub">' + r.name + '・' + SLOT_INFO[it.slot].name + '・等級 ' + it.level;
  if (cmp && cmp.level !== it.level) {
    var ldiff = it.level - cmp.level;
    if (ldiff > 0) h += ' <span style="color: #4ade80">↑' + ldiff + '</span>';
    else if (ldiff < 0) h += ' <span style="color: #f87171">↓' + (-ldiff) + '</span>';
  }
  h += '</div>';

  h += '<div class="it-affixes">';
  var um = upgradeMult(it);
  var curMap = {};
  for (var i = 0; i < it.affixes.length; i++) {
    var a = it.affixes[i];
    curMap[a.key] = (curMap[a.key] || 0) + a.val * um;
  }
  var cmpMap = {};
  if (cmp) {
    var cum = upgradeMult(cmp);
    for (var i = 0; i < cmp.affixes.length; i++) {
      var a = cmp.affixes[i];
      cmpMap[a.key] = (cmpMap[a.key] || 0) + a.val * cum;
    }
  }
  
  var processedKeys = {};
  for (var i = 0; i < it.affixes.length; i++) {
    var k = it.affixes[i].key;
    if (processedKeys[k]) continue;
    processedKeys[k] = true;
    var baseVal = it.affixes[i].val;
    var vCur = curMap[k];
    var vCmp = cmpMap[k] || 0;
    var def = AFFIX_POOL[k];
    var name = esc(def.name.replace('%', ''));
    
    var limits = getAffixLimits(k, it.level, it.rarity);
    var isMax = baseVal >= limits.max - 0.01;
    var minDisplay = def.pct ? pctStr(limits.min * um) : fmt(limits.min * um);
    var maxDisplay = def.pct ? pctStr(limits.max * um) : fmt(limits.max * um);
    var limitTip = '洗煉區間：' + minDisplay + ' ~ ' + maxDisplay;
    
    var valColor = isMax ? '#fbbf24' : '';
    var valHtml = '<span' + (valColor ? ' style="color:' + valColor + ';font-weight:bold"' : '') + '>' + (def.pct ? pctStr(vCur) : fmt(vCur)) + '</span>';
    
    var rrCost = rerollCost(it);
    var rrGoldHtml = '<span' + (G.player.gold >= rrCost.gold ? '' : ' style="color:#fca5a5"') + '>💰 ' + fmt(rrCost.gold) + '</span>';
    var rrEssenceHtml = '<span' + (G.player.essence >= rrCost.essence ? '' : ' style="color:#fca5a5"') + '>🔮 ' + fmt(rrCost.essence) + '</span>';
    var rrTip = '<div style="color:var(--dim);margin-bottom:4px">單獨洗煉此屬性（改變種類與數值）</div>需要：' + rrGoldHtml + ' &nbsp;' + rrEssenceHtml;
    var rrBtn = ' <button class="btn act-btn-tooltip" style="padding: 1px 4px; font-size: 11px; vertical-align: middle; margin-left: 4px;" data-act="reroll-affix" data-affix="' + k + '">🎲<div class="btn-tip" style="text-align:left; font-size: 12px; line-height: 1.4; font-weight: normal;">' + rrTip + '</div></button>';
    
    var diffStr = '';
    if (vCmp !== 0) {
      var diff = vCur - vCmp;
      if (Math.abs(diff) > 0.05) {
        if (diff > 0) diffStr = ' <span style="color: #4ade80">↑' + (def.pct ? pctStr(diff) : fmt(diff)) + '</span>';
        else diffStr = ' <span style="color: #fca5a5">↓' + (def.pct ? pctStr(-diff) : fmt(-diff)) + '</span>';
      }
    }
    
    var lineStyle = (vCmp === 0 && cmp) ? 'color: #4ade80;' : '';
    h += '<div class="it-affix" style="' + lineStyle + '">' +
         '<span class="act-btn-tooltip" style="cursor:help;">◆ ' + name + ' +' + valHtml + '<div class="btn-tip" style="font-weight:normal;color:var(--text);">' + limitTip + '</div></span>' +
         diffStr + rrBtn + '</div>';
  }
  if (cmp) {
    for (var i = 0; i < cmp.affixes.length; i++) {
      var k = cmp.affixes[i].key;
      if (processedKeys[k]) continue;
      processedKeys[k] = true;
      var vCmp = cmpMap[k];
      var def = AFFIX_POOL[k];
      var name = esc(def.name.replace('%', ''));
      h += '<div class="it-affix" style="color: #f87171; text-decoration: line-through;">◆ ' + name + ' -' + (def.pct ? pctStr(vCmp) : fmt(vCmp)) + '</div>';
    }
  }
  h += '</div>';

  if (cmp && cmp.passive && (!it.passive || it.passive.key !== cmp.passive.key)) {
    h += '<div class="it-passive" style="color: #f87171; text-decoration: line-through;">' + esc(passiveLine(cmp.passive)) + '</div>';
  }
  if (it.passive) {
    if (!cmp) {
      h += '<div class="it-passive">' + esc(passiveLine(it.passive)) + '</div>';
    } else if (!cmp.passive || cmp.passive.key !== it.passive.key) {
      h += '<div class="it-passive" style="color: #4ade80">' + esc(passiveLine(it.passive)) + '</div>';
    } else {
      var diff = it.passive.val - cmp.passive.val;
      var diffStr = '';
      if (Math.abs(diff) > 0.05) {
        if (diff > 0) diffStr = ' <span style="color: #4ade80">↑' + fmt1(diff) + '</span>';
        else diffStr = ' <span style="color: #f87171">↓' + fmt1(-diff) + '</span>';
      }
      var p = it.passive;
      var d = PASSIVE_POOL[p.key];
      h += '<div class="it-passive">【' + esc(d.name) + '】' + esc(d.desc).replace('{v}', fmt1(p.val) + diffStr) + '</div>';
    }
  }

  // 附魔（多欄位，數量依稀有度）
  var itEns = itemEnchants(it);
  var cmpEns = cmp ? itemEnchants(cmp) : [];
  var enCap = enchantCapFor(it);
  var cmpEnMap = {};
  cmpEns.forEach(function (ce) { cmpEnMap[ce.key] = ce.val; });
  var itEnKeys = {};
  itEns.forEach(function (en2) { itEnKeys[en2.key] = true; });
  // 對方有而自己沒有的附魔（劃線顯示）
  cmpEns.forEach(function (ce) {
    if (!itEnKeys[ce.key] && ENCHANTS[ce.key]) {
      h += '<div class="it-enchant" style="color: #f87171; text-decoration: line-through;">' + esc(enchantLine(ce)) + '</div>';
    }
  });
  itEns.forEach(function (en, enIdx) {
    var e = ENCHANTS[en.key];
    if (!e) return;
    if (!cmp) {
      h += '<div class="it-enchant removable" data-enchant-remove="' + enIdx + '" title="點擊取下（返還附魔書，精華不退）">' + esc(enchantLine(en)) + '</div>';
    } else if (!(en.key in cmpEnMap)) {
      h += '<div class="it-enchant" style="color: #4ade80">' + esc(enchantLine(en)) + '</div>';
    } else {
      var ediff = en.val - cmpEnMap[en.key];
      var ediffStr = '';
      if (Math.abs(ediff) > 0.05) {
        var dfStr = (e.cat === 'atk') ? fmt(Math.abs(ediff)) : pctStr(Math.abs(ediff));
        ediffStr = ediff > 0
          ? ' <span style="color: #4ade80">↑' + dfStr + '</span>'
          : ' <span style="color: #f87171">↓' + dfStr + '</span>';
      }
      var vs = (e.cat === 'atk') ? '+' + fmt(en.val) : '+' + pctStr(en.val);
      h += '<div class="it-enchant">' + e.emoji + ' ' + esc(e.name) + ' ' + vs + ediffStr + '</div>';
    }
  });
  for (var enSlot = itEns.length; enSlot < enCap; enSlot++) {
    h += '<div class="it-enchant" style="color: var(--dim)">◇ 空附魔欄（' + (enSlot + 1) + '/' + enCap + '）</div>';
  }

  // 寶石插槽
  ensureSockets(it);
  if (it.sockets.length) {
    h += '<div class="it-sockets">';
    for (var si = 0; si < it.sockets.length; si++) {
      var g = it.sockets[si];
      if (g && g.fused) {
        h += '<span class="socket filled fused-socket" data-socket-remove="' + si + '" title="點擊取下">' +
          esc(fusedGemLabel(g.fused)) + '</span>';
      } else if (g && GEM_TYPES[g.type]) {
        var gt = GEM_TYPES[g.type];
        h += '<span class="socket filled" data-socket-remove="' + si + '" title="點擊取下">' +
          gt.emoji + ' ' + esc(GEM_NAMES[g.level] + gt.name) + '（' + esc(gt.statName.replace('%', '')) + ' +' +
          (gt.pct ? pctStr(gemStatValue(g.type, g.level)) : fmt(gemStatValue(g.type, g.level))) + '）</span>';
      } else {
        h += '<span class="socket empty">◇ 空插槽</span>';
      }
    }
    h += '</div>';
  }

  var curScore = itemScore(it);
  var cmpScore = cmp ? itemScore(cmp) : 0;
  var sdiffStr = '';
  if (cmp) {
    var diffScore = curScore - cmpScore;
    if (Math.abs(diffScore) > 0.5) {
      if (diffScore > 0) sdiffStr = ' <span style="color: #4ade80">↑' + fmt(diffScore) + '</span>';
      else sdiffStr = ' <span style="color: #f87171">↓' + fmt(-diffScore) + '</span>';
    }
  }
  h += '<div class="it-score">評分 ' + fmt(curScore) + sdiffStr + '</div>';
  return h;
}

/* ---- 裝備洗煉（隨機重骰所有詞條；費用公式 rerollCost → js/formula.js §7） ---- */
// 回傳 null=成功，否則錯誤訊息
function rerollItemAffixes(it) {
  var cost = rerollCost(it);
  if (G.player.gold < cost.gold || G.player.essence < cost.essence) {
    return '資源不足（需要金幣 ' + fmt(cost.gold) + '、精華 ' + cost.essence + '）';
  }
  G.player.gold -= cost.gold;
  G.player.essence -= cost.essence;
  var luck = getStats().luck;
  it.affixes = rollAffixes(it.affixes.length, it.level, it.rarity, it.slot, luck);
  markStatsDirty();
  UI.dirty.header = true; UI.dirty.equip = true; UI.dirty.inv = true;
  return null;
}

// 單獨重骰某一個屬性的種類與數值
function rerollSingleAffix(it, affixKey) {
  var cost = rerollCost(it);
  if (G.player.gold < cost.gold || G.player.essence < cost.essence) {
    return '資源不足（需要金幣 ' + fmt(cost.gold) + '、精華 ' + cost.essence + '）';
  }
  
  var targetIdx = -1;
  var used = {};
  for (var i = 0; i < it.affixes.length; i++) {
    if (it.affixes[i].key === affixKey) {
      targetIdx = i; 
    } else {
      used[it.affixes[i].key] = true;
    }
  }
  if (targetIdx < 0) return '找不到指定的屬性';
  
  var pool = [];
  for (var k in AFFIX_POOL) {
    var d = AFFIX_POOL[k];
    if (d.minR !== undefined && it.rarity < d.minR) continue;
    if (d.slots && it.slot && d.slots.indexOf(it.slot) < 0) continue;
    if (used[k]) continue;
    pool.push([k, d.weight]);
  }
  
  if (pool.length === 0) return '沒有其他可用的屬性';
  
  G.player.gold -= cost.gold;
  G.player.essence -= cost.essence;
  
  var luck = getStats().luck;
  var newKey = wpick(pool);
  var newVal = rollAffixValue(newKey, it.level, it.rarity);
  if (luck && chance(luck / 2)) {
    newVal = Math.max(newVal, rollAffixValue(newKey, it.level, it.rarity));
  }
  
  it.affixes[targetIdx] = { key: newKey, val: newVal };
  
  markStatsDirty();
  UI.dirty.header = true; UI.dirty.equip = true; UI.dirty.inv = true;
  return null;
}

// 自動機組零件生成
function makePart(tier) {
  tier = clamp(tier, 1, PART_MAX_TIER);
  var key = pick(Object.keys(PART_TYPES));
  var pt = PART_TYPES[key];
  return {
    id: uid(), kind: 'part', key: key, tier: tier,
    name: 'T' + tier + ' ' + pt.name, val: pt.perTier * tier
  };
}
function partDesc(p) {
  return PART_TYPES[p.key].desc.replace('{v}', fmt1(p.val));
}
