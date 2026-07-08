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
// 取下指定插槽的寶石回到庫存
function unsocketGem(it, idx) {
  if (!it.sockets || !it.sockets[idx]) return false;
  var g = it.sockets[idx];
  addGem(g.type, g.level, 1);
  it.sockets[idx] = null;
  markStatsDirty();
  return true;
}

// 依階段擲稀有度（lootBonus 為額外掉寶加成 %，略微上移品質）
function rollRarity(stage, lootBonus) {
  var s = stage || 1;
  var b = 1 + (lootBonus || 0) / 200 + s * 0.006;
  var w = [
    [0, 55],
    [1, 25 * Math.min(b, 2)],
    [2, 12 * Math.min(b, 2.5)],
    [3, 5.5 * Math.min(b, 3)],                       // 獨特（紫）
    [4, (s >= 8 ? 1.8 : 0) * Math.min(b, 3.5)],      // 史詩（金）
    [5, (s >= 15 ? 0.35 : 0) * Math.min(b, 4)],      // 傳說（橘）
    [6, (s >= 25 ? 0.08 : 0) * Math.min(b, 4.5)],    // 神話（紅）
    [7, (s >= 40 ? 0.015 : 0) * Math.min(b, 5)]      // 創世（暗金）
  ];
  return wpick(w);
}

function rollAffixValue(key, itemLevel, rarityIdx) {
  var def = AFFIX_POOL[key];
  var r = RARITIES[rarityIdx];
  var v = (def.base + def.base * def.lv * (itemLevel - 1)) * r.mult * rnd(0.8, 1.2);
  return def.pct ? Math.round(v * 10) / 10 : Math.round(v);
}

function getAffixLimits(key, itemLevel, rarityIdx) {
  var def = AFFIX_POOL[key];
  var r = RARITIES[rarityIdx];
  var baseV = (def.base + def.base * def.lv * (itemLevel - 1)) * r.mult;
  var minV = def.pct ? Math.round(baseV * 0.8 * 10) / 10 : Math.round(baseV * 0.8);
  var maxV = def.pct ? Math.round(baseV * 1.2 * 10) / 10 : Math.round(baseV * 1.2);
  return { min: minV, max: maxV };
}

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
  // 稀有級以上附帶特殊被動
  if (rarity >= RARE_IDX) {
    var pk = pick(Object.keys(PASSIVE_POOL));
    var pd = PASSIVE_POOL[pk];
    it.passive = { key: pk, val: Math.round((pd.base + pd.perR * (rarity - RARE_IDX)) * 10) / 10 };
  }
  return it;
}

// 附魔威力（依裝備稀有度與等級）
function enchantPower(item, gemLevel) {
  var r = RARITIES[item.rarity];
  var v = (5 + item.level * 1.2) * r.mult * (1 + 0.15 * (gemLevel || 0));
  return Math.round(v);
}

// 附魔數值試算（不改動裝備）；atk 類為附加元素傷害，def/util 類為百分比
function enchantValueFor(item, bookKey, gemLevel) {
  var e = ENCHANTS[bookKey];
  if (e.cat === 'atk') {
    var v = enchantPower(item, gemLevel);
    if (bookKey === 'fire') v = Math.round(v * 1.25); // 火焰：純高額傷害
    return v;
  }
  // 抗性 / 功能類：百分比，隨稀有度與寶石成長，設定上限
  var val = Math.round((8 + item.rarity * 4 + (gemLevel || 0) * 3) * 10) / 10;
  return Math.min(val, 60);
}

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

// 升級後詞條倍率
function upgradeMult(item) { return 1 + 0.05 * (item.upgrade || 0); }

// 裝備戰力評分（自動換裝比較用；未列出的詞條以 1 計）
var SCORE_WEIGHTS = {
  atkFlat: 1.0, atkPct: 2.6, matkFlat: 1.0, matkPct: 2.6,
  hpFlat: 0.16, hpPct: 2.2, hpRegen: 0.6,
  defFlat: 0.9, defPct: 1.8, mdefFlat: 0.9,
  mpFlat: 0.25, mpRegen: 2.0,
  str: 1.8, agi: 1.8, int: 1.8, vit: 1.8,
  aspd: 2.8, critRate: 2.4, critDmg: 0.9,
  pPen: 2.2, mPen: 2.2, hit: 1.2, cdr: 2.0, castSpeed: 1.4,
  lifesteal: 2.2, manaSteal: 1.4, eliteDmg: 1.2, bossDmg: 1.2, aoeDmg: 1.4,
  blockRate: 2.0, blockDmgRed: 1.2, evasion: 2.2, tenacity: 1.2, shieldEff: 1.0,
  pRes: 2.0, mRes: 2.0,
  resFire: 0.8, resIce: 0.8, resLightning: 0.8, resPoison: 0.8, resLight: 0.8, resDark: 0.8,
  ccRed: 1.2, moveSpeed: 1.5, loot: 0.8, xpBonus: 0.8, goldBonus: 0.8,
  luck: 1.5, weight: 0.8, enhanceSuccess: 0.8, decomposeYield: 0.8,
  hybridMutation: 1.2, enrageThreshold: 1.0, affixCap: 1.2, gemEff: 1.0
};
function itemScore(it) {
  if (!it) return 0;
  var s = 0, um = upgradeMult(it);
  for (var i = 0; i < it.affixes.length; i++) {
    var a = it.affixes[i];
    s += (SCORE_WEIGHTS[a.key] || 1) * a.val * um;
  }
  // 鑲嵌的寶石計入評分（避免自動換裝丟棄鑲嵌裝備）
  if (it.sockets) {
    for (var j = 0; j < it.sockets.length; j++) {
      var g = it.sockets[j];
      if (g && GEM_TYPES[g.type]) s += gemStatValue(g.type, g.level) * (SCORE_WEIGHTS[GEM_TYPES[g.type].stat] || 1);
    }
  }
  if (it.passive) s *= 1.15;
  var ens = itemEnchants(it);
  for (var ei = 0; ei < ens.length; ei++) {
    var e = ENCHANTS[ens[ei].key];
    if (e) s += (e.cat === 'atk') ? ens[ei].val * 1.2 : ens[ei].val * 2;
  }
  s *= 1 + it.rarity * 0.06;
  return s;
}

// 分解產出（extractChance 可由呼叫端帶入「分解高產率」等加成）
function salvageResult(it, extractChance) {
  var r = RARITIES[it.rarity];
  var out = {
    scrap: Math.max(1, Math.round((2 + it.level * 0.6) * r.salv * rnd(0.85, 1.15))),
    gold: Math.round((3 + it.level) * r.salv * 0.5),
    essence: 0, gem: 0, extracted: false
  };
  // 精粹提取：基礎 10% 機率產出高階材料
  if (chance(extractChance === undefined ? ESSENCE_EXTRACT_CHANCE : extractChance)) {
    out.extracted = true;
    out.essence = ri(1, 2) + Math.floor(it.rarity / 2);
    if (chance(30)) out.gem = 1; // 額外一級寶石
  }
  out.essence += itemEnchants(it).length; // 每個附魔回收 1 額外精華
  return out;
}

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
  var h = '<div class="it-name" style="color:' + r.color + '">' +
    SLOT_INFO[it.slot].emoji + ' ' + esc(it.name) +
    (it.upgrade ? ' <span class="it-up">+' + it.upgrade + '</span>' : '') +
    (it.synthesized ? ' <span class="it-syn">✦合成</span>' : '') +
    (it.locked ? ' 🔒' : '') + '</div>';
  
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
      if (g && GEM_TYPES[g.type]) {
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

/* ---- 裝備洗煉（隨機重骰所有詞條） ---- */
function rerollCost(it) {
  return {
    gold: Math.round(40 * Math.pow(1.7, it.rarity) * (1 + it.level * 0.15)),
    essence: 1 + it.rarity
  };
}
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
