'use strict';
/* ============ 裝備 / 物品生成 ============ */

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
  var slot = opts.slot || pick(SLOT_LIST);
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
    upgrade: 0,
    synthesized: false,
    locked: false
  };
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
function itemDetailHTML(it) {
  var r = RARITIES[it.rarity];
  var um = upgradeMult(it);
  var h = '<div class="it-name" style="color:' + r.color + '">' +
    SLOT_INFO[it.slot].emoji + ' ' + esc(it.name) +
    (it.upgrade ? ' <span class="it-up">+' + it.upgrade + '</span>' : '') +
    (it.synthesized ? ' <span class="it-syn">✦合成</span>' : '') +
    (it.locked ? ' 🔒' : '') + '</div>';
  h += '<div class="it-sub">' + r.name + '・' + SLOT_INFO[it.slot].name + '・等級 ' + it.level + '</div>';
  h += '<div class="it-affixes">';
  for (var i = 0; i < it.affixes.length; i++) {
    var a = it.affixes[i];
    var def = AFFIX_POOL[a.key];
    var v = a.val * um;
    h += '<div class="it-affix">◆ ' + esc(def.name.replace('%', '')) + ' +' +
      (def.pct ? pctStr(v) : fmt(v)) + '</div>';
  }
  h += '</div>';
  if (it.passive) h += '<div class="it-passive">' + esc(passiveLine(it.passive)) + '</div>';
  if (it.enchant) h += '<div class="it-enchant">' + esc(enchantLine(it.enchant)) + '</div>';
  h += '<div class="it-score">評分 ' + fmt(itemScore(it)) + '</div>';
  return h;
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
