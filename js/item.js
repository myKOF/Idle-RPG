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
    [3, 5.5 * Math.min(b, 3)],
    [4, (s >= 8 ? 1.8 : 0) * Math.min(b, 3.5)],
    [5, (s >= 15 ? 0.35 : 0) * Math.min(b, 4)]
  ];
  return wpick(w);
}

function rollAffixValue(key, itemLevel, rarityIdx) {
  var def = AFFIX_POOL[key];
  var r = RARITIES[rarityIdx];
  var v = (def.base + def.base * def.lv * (itemLevel - 1)) * r.mult * rnd(0.8, 1.2);
  return def.pct ? Math.round(v * 10) / 10 : Math.round(v);
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

// 對裝備套用附魔
function applyEnchantTo(item, bookKey, gemLevel) {
  item.enchant = { key: bookKey, val: enchantValueFor(item, bookKey, gemLevel) };
  return item;
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
  if (it.enchant) {
    var e = ENCHANTS[it.enchant.key];
    s += (e.cat === 'atk') ? it.enchant.val * 1.2 : it.enchant.val * 2;
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
  if (it.enchant) out.essence += 1; // 已附魔裝備回收額外精華
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
    var vCur = curMap[k];
    var vCmp = cmpMap[k] || 0;
    var def = AFFIX_POOL[k];
    var name = esc(def.name.replace('%', ''));
    if (vCmp === 0) {
      if (cmp) {
        h += '<div class="it-affix" style="color: #4ade80">◆ ' + name + ' +' + (def.pct ? pctStr(vCur) : fmt(vCur)) + '</div>';
      } else {
        h += '<div class="it-affix">◆ ' + name + ' +' + (def.pct ? pctStr(vCur) : fmt(vCur)) + '</div>';
      }
    } else {
      var diff = vCur - vCmp;
      var diffStr = '';
      if (Math.abs(diff) > 0.05) {
        if (diff > 0) diffStr = ' <span style="color: #4ade80">↑' + (def.pct ? pctStr(diff) : fmt(diff)) + '</span>';
        else diffStr = ' <span style="color: #f87171">↓' + (def.pct ? pctStr(-diff) : fmt(-diff)) + '</span>';
      }
      h += '<div class="it-affix">◆ ' + name + ' +' + (def.pct ? pctStr(vCur) : fmt(vCur)) + diffStr + '</div>';
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

  if (cmp && cmp.enchant && (!it.enchant || it.enchant.key !== cmp.enchant.key)) {
    h += '<div class="it-enchant" style="color: #f87171; text-decoration: line-through;">' + esc(enchantLine(cmp.enchant)) + '</div>';
  }
  if (it.enchant) {
    if (!cmp) {
      h += '<div class="it-enchant">' + esc(enchantLine(it.enchant)) + '</div>';
    } else if (!cmp.enchant || cmp.enchant.key !== it.enchant.key) {
      h += '<div class="it-enchant" style="color: #4ade80">' + esc(enchantLine(it.enchant)) + '</div>';
    } else {
      var diff = it.enchant.val - cmp.enchant.val;
      var diffStr = '';
      if (Math.abs(diff) > 0.05) {
        var e = ENCHANTS[it.enchant.key];
        var dfStr = (e.cat === 'atk') ? fmt(diff) : pctStr(diff);
        if (diff > 0) diffStr = ' <span style="color: #4ade80">↑' + dfStr + '</span>';
        else diffStr = ' <span style="color: #f87171">↓' + ((e.cat === 'atk') ? fmt(-diff) : pctStr(-diff)) + '</span>';
      }
      var en = it.enchant;
      var e = ENCHANTS[en.key];
      var vs = (e.cat === 'atk') ? '+' + fmt(en.val) : '+' + pctStr(en.val);
      h += '<div class="it-enchant">' + e.emoji + ' ' + esc(e.name) + ' ' + vs + diffStr + '</div>';
    }
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
