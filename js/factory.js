'use strict';
/* ============ 自動生產線（Automation Line） ============ */

/* ---- 零件加成查詢 ---- */
function partBonus(node, key) {
  var f = G.factory;
  var ids = f.installed[node] || [];
  var sum = 0;
  ids.forEach(function (id) {
    var p = findPart(id);
    if (p && p.key === key) sum += p.val;
  });
  return sum;
}
function findPart(id) {
  var f = G.factory;
  for (var i = 0; i < f.parts.length; i++) if (f.parts[i].id === id) return f.parts[i];
  return null;
}
function isInstalled(id) {
  var inst = G.factory.installed;
  for (var node in inst) if (inst[node].indexOf(id) >= 0) return true;
  return false;
}
function installPart(id, node) {
  var p = findPart(id);
  if (!p) return false;
  if (PART_TYPES[p.key].node !== node) { flog('⚠️ ' + p.name + ' 無法安裝到' + NODE_NAMES[node], 'warn'); return false; }
  if (isInstalled(id)) return false;
  var arr = G.factory.installed[node];
  if (arr.length >= PART_SLOTS_PER_NODE) {
    arr.shift(); // 擠掉最舊的（回到零件庫，本來就都在 parts 陣列中）
  }
  arr.push(id);
  flog('🔧 已安裝 ' + p.name + ' 至 ' + NODE_NAMES[node], 'good');
  UI.dirty.factory = true;
  return true;
}
function uninstallPart(node, id) {
  var arr = G.factory.installed[node];
  var idx = arr.indexOf(id);
  if (idx >= 0) { arr.splice(idx, 1); UI.dirty.factory = true; }
}

/* ---- 容量（受「負重上限」屬性擴充） ---- */
function conveyorCap() { return CONVEYOR_CAP + getStats().weight; }
function synthBufCap() { return SYNTH_BUFFER_CAP + Math.floor(getStats().weight / 2); }

/* ---- 輸送帶 ---- */
function pushConveyor(item) {
  var f = G.factory;
  if (f.conveyor.length >= conveyorCap()) {
    // 溢出：直接分解最舊一件
    var old = f.conveyor.shift();
    var res = doSalvage(old, true);
    flog('⚠️ 輸送帶滿載，強制分解 ' + rarityTag(old) + ' → 碎片x' + res.scrap, 'warn');
  }
  f.conveyor.push(item);
  UI.dirty.factory = true;
}

/* ---- 篩選節點 ---- */
function decideFilter(it) {
  var f = G.factory;
  if (it.locked) return 'keep';
  // 智慧分解：比已裝備差 → 分解
  if (f.filter.smartSalvage) {
    var cur = G.equipment[it.slot];
    if (cur && itemScore(it) <= itemScore(cur)) return 'salvage';
  }
  return f.filter.actions[it.rarity] || 'keep';
}

/* ---- 分解槽 ---- */
// 精粹提取率 = 基礎 + 分解高產率屬性 + 幸運值/3
function extractChanceNow() {
  var st = getStats();
  return ESSENCE_EXTRACT_CHANCE + st.decomposeYield + st.luck / 3;
}
function doSalvage(it, silent) {
  var res = salvageResult(it, extractChanceNow());
  G.player.scrap += res.scrap;
  G.player.gold += res.gold;
  if (res.extracted) {
    G.player.essence += res.essence;
    if (res.gem) G.player.gems[1] += res.gem;
    G.factory.stats.extracted++;
    if (!silent) flog('✨ 精粹提取！' + rarityTag(it) + ' → 碎片x' + res.scrap + '、精華x' + res.essence + (res.gem ? '、寶石x1' : ''), 'good');
  } else {
    if (res.essence) G.player.essence += res.essence;
    if (!silent) flog('⚒️ 分解 ' + rarityTag(it) + ' → 碎片x' + res.scrap, '');
  }
  G.factory.stats.salvaged++;
  UI.dirty.header = true;
  return res;
}

/* ---- 生產線主迴圈：處理輸送帶 ---- */
function factoryTick(dt) {
  var f = G.factory;
  // 處理速度：加速齒輪
  var speedUp = 1 + partBonus('salvage', 'speedGear') / 100;
  f.procTimer -= dt * speedUp;
  if (f.procTimer <= 0) {
    f.procTimer = FACTORY_BASE_INTERVAL;
    processOneConveyorItem();
  }
  // 合成節點
  if (f.synth.enabled) synthTick();
  // 附魔節點（每 3 秒）
  f.enchTimer -= dt;
  if (f.enchTimer <= 0) { f.enchTimer = 3; if (f.enchant.enabled) enchantTick(); }
  // 強化節點（每 2 秒）
  f.upTimer -= dt;
  if (f.upTimer <= 0) { f.upTimer = 2; if (f.upgrade.enabled) upgradeTick(); }
}

function processOneConveyorItem() {
  var f = G.factory;
  if (!f.conveyor.length) return;
  var it = f.conveyor.shift();
  UI.dirty.factory = true;

  // 自動換裝優先（合成優先度概念：撿到就比較）
  if (f.autoEquip && tryAutoEquip(it)) return;

  var act = decideFilter(it);
  if (act === 'salvage') {
    doSalvage(it);
  } else if (act === 'synth') {
    if (f.synthBuffer.length >= synthBufCap()) {
      var old = f.synthBuffer.shift();
      doSalvage(old, true);
      flog('⚠️ 合成暫存區滿載，分解最舊素材', 'warn');
    }
    f.synthBuffer.push(it);
    flog('🧪 ' + rarityTag(it) + ' 送入合成暫存區', '');
  } else {
    addToInventory(it);
  }
}

/* ---- 合成節點 ---- */
function synthTick() {
  var f = G.factory;
  // 寶石合成：3 顆同級 → 1 顆下一級
  if (f.synth.gemMerge) {
    for (var lv = 1; lv < GEM_MAX_LEVEL; lv++) {
      if (G.player.gems[lv] >= 3) {
        G.player.gems[lv] -= 3;
        G.player.gems[lv + 1] += 1;
        flog('💎 寶石合成：' + GEM_NAMES[lv] + ' x3 → ' + GEM_NAMES[lv + 1], 'info');
        UI.dirty.header = true;
        break; // 每 tick 只合一次
      }
    }
  }
  // 混合合成優先，其次品質合成
  if (f.synth.hybridEnabled && tryHybridSynthesis()) return;
  if (f.synth.mergeEnabled) tryRarityMerge();
}

// 混合合成：[裝備(任何)] + [寶石(X等級)] + [附魔書(特定)] = 特殊裝備（賦予附魔）
function tryHybridSynthesis() {
  var f = G.factory;
  if (!f.synthBuffer.length) return false;
  // 找可用寶石（滿足最低等級設定，用最低可用等級以節約高級寶石）
  var gemLv = 0;
  for (var lv = f.synth.minGemLevel; lv <= GEM_MAX_LEVEL; lv++) {
    if (G.player.gems[lv] > 0) { gemLv = lv; break; }
  }
  if (!gemLv) return false;
  // 找附魔書
  var bookKey = null;
  if (f.synth.bookChoice === 'any') {
    for (var k in G.player.books) { if (G.player.books[k] > 0) { bookKey = k; break; } }
  } else if (G.player.books[f.synth.bookChoice] > 0) {
    bookKey = f.synth.bookChoice;
  }
  if (!bookKey) return false;

  // 取暫存區中評分最高的裝備
  var bestIdx = 0;
  for (var i = 1; i < f.synthBuffer.length; i++) {
    if (itemScore(f.synthBuffer[i]) > itemScore(f.synthBuffer[bestIdx])) bestIdx = i;
  }
  var it = f.synthBuffer.splice(bestIdx, 1)[0];
  var st = getStats();
  G.player.gems[gemLv]--;
  G.player.books[bookKey]--;
  UI.dirty.header = true; UI.dirty.factory = true;

  // 大成功：稀有度 +1（幸運核心 + 幸運值加成）
  var greatChance = SYNTH_GREAT_BASE + partBonus('synth', 'luckCore') + st.luck / 2;
  var great = chance(greatChance);
  if (great && it.rarity < RARITIES.length - 1) {
    it.rarity++;
    it.name = RARITY_PREFIX[it.rarity] + it.name.replace(/^(粗糙的|堅實的|精工的|大師級|傳世的|神鑄的)/, '');
    // 升稀有度補被動
    if (it.rarity >= RARE_IDX && !it.passive) {
      var pk = pick(Object.keys(PASSIVE_POOL));
      var pd = PASSIVE_POOL[pk];
      it.passive = { key: pk, val: Math.round((pd.base + pd.perR * (it.rarity - RARE_IDX)) * 10) / 10 };
    }
  }
  // 詞條重骰（重骰模組）：每條詞條重骰一次取較佳值
  var rerollChance = partBonus('synth', 'rerollModule');
  if (rerollChance > 0 && chance(rerollChance)) {
    it.affixes = it.affixes.map(function (a) {
      var nv = rollAffixValue(a.key, it.level, it.rarity);
      return { key: a.key, val: Math.max(a.val, nv) };
    });
    flog('🎲 重骰模組發動！詞條取較佳值', 'good');
  }
  // 寶石鑲嵌效率：提高寶石對附魔威力的貢獻
  var effGemLv = gemLv * (1 + st.gemEff / 100);
  applyEnchantTo(it, bookKey, effGemLv);
  // 混合合成變異：附魔威力 x1.5 並追加一條詞條
  var mutated = st.hybridMutation > 0 && chance(st.hybridMutation);
  if (mutated) {
    it.enchant.val = Math.round(it.enchant.val * 1.5 * 10) / 10;
    if (it.affixes.length < MAX_AFFIXES) {
      it.affixes = it.affixes.concat(rollAffixes(1, it.level, it.rarity, it.slot, st.luck)
        .filter(function (na) { return !it.affixes.some(function (a) { return a.key === na.key; }); }));
    }
    G.factory.stats.mutated = (G.factory.stats.mutated || 0) + 1;
  }
  it.synthesized = true;
  G.factory.stats.synthesized++;
  flog((great ? '🌟 大成功！' : '🔮 ') + (mutated ? '🧬 變異！' : '') + '混合合成：' + rarityTag(it) + ' 獲得 ' + ENCHANTS[bookKey].name, (great || mutated) ? 'good' : 'info');

  // 合成優先度：自動將舊裝備替換為新合成的裝備
  if (G.factory.autoEquip && tryAutoEquip(it)) return true;
  addToInventory(it);
  return true;
}

// 品質合成：3 件同稀有度素材 → 1 件更高稀有度隨機裝備
function tryRarityMerge() {
  var f = G.factory;
  if (f.synthBuffer.length < 3) return false;
  var byRarity = {};
  for (var i = 0; i < f.synthBuffer.length; i++) {
    var r = f.synthBuffer[i].rarity;
    (byRarity[r] = byRarity[r] || []).push(i);
  }
  for (var rr = 0; rr < RARITIES.length - 1; rr++) {
    var idxs = byRarity[rr];
    if (idxs && idxs.length >= 3) {
      var mats = [];
      // 由後往前移除避免位移
      for (var j = 2; j >= 0; j--) mats.push(f.synthBuffer.splice(idxs[j], 1)[0]);
      var avgLv = Math.max(1, Math.round((mats[0].level + mats[1].level + mats[2].level) / 3));
      var greatChance = SYNTH_GREAT_BASE + partBonus('synth', 'luckCore') + getStats().luck / 2;
      var great = chance(greatChance);
      var newRarity = clamp(rr + 1 + (great ? 1 : 0), 0, RARITIES.length - 1);
      var it = makeEquipment(avgLv, { rarity: newRarity, level: avgLv });
      // 重骰模組
      var rerollChance = partBonus('synth', 'rerollModule');
      if (rerollChance > 0 && chance(rerollChance)) {
        it.affixes = it.affixes.map(function (a) {
          var nv = rollAffixValue(a.key, it.level, it.rarity);
          return { key: a.key, val: Math.max(a.val, nv) };
        });
      }
      G.factory.stats.synthesized++;
      flog((great ? '🌟 大成功！' : '⚗️ ') + '品質合成：' + RARITIES[rr].name + 'x3 → ' + rarityTag(it), great ? 'good' : 'info');
      if (G.factory.autoEquip && tryAutoEquip(it)) return true;
      addToInventory(it);
      return true;
    }
  }
  return false;
}

/* ---- 附魔節點：自動將附魔書用於已裝備裝備 ---- */
function enchantTick() {
  var f = G.factory;
  if (G.player.essence < ENCHANT_ESSENCE_COST) return;
  // 找有庫存的書
  for (var bk in G.player.books) {
    if (G.player.books[bk] <= 0) continue;
    var cat = ENCHANTS[bk].cat;
    var slots = ENCHANT_SLOTS[cat];
    for (var i = 0; i < slots.length; i++) {
      var it = G.equipment[slots[i]];
      if (!it) continue;
      if (it.enchant) {
        if (!f.enchant.overwrite) continue;
        // 覆蓋僅在數值嚴格更高時執行（避免同類書互相洗掉、燒光資源）
        if (enchantValueFor(it, bk, 0) <= it.enchant.val) continue;
      }
      // 執行附魔
      G.player.books[bk]--;
      G.player.essence -= ENCHANT_ESSENCE_COST;
      applyEnchantTo(it, bk, 0);
      G.factory.stats.enchanted++;
      markStatsDirty();
      flog('✨ 自動附魔：' + rarityTag(it) + ' 獲得 ' + ENCHANTS[bk].name + '（精華 -' + ENCHANT_ESSENCE_COST + '）', 'good');
      UI.dirty.equip = true; UI.dirty.header = true;
      return;
    }
  }
}

/* ---- 強化節點：自動強化已裝備裝備 ---- */
function upgradeCost(it) {
  var lv = it.upgrade || 0;
  return {
    gold: Math.round(25 * Math.pow(1.45, lv) * (1 + it.level * 0.08)),
    scrap: Math.round(8 * Math.pow(1.35, lv) * (1 + it.level * 0.04))
  };
}
// 強化成功率 = 基礎（+5 內必成，之後遞減）+「強化成功率」屬性
function upgradeSuccessChance(it) {
  var next = (it.upgrade || 0) + 1;
  return Math.min(100, upgradeSuccessBase(next) + getStats().enhanceSuccess);
}

// 執行一次強化嘗試；失敗時消耗半數資源。回傳 'ok' | 'fail' | 'poor'
function tryUpgrade(it) {
  var cost = upgradeCost(it);
  if (G.player.gold < cost.gold || G.player.scrap < cost.scrap) return 'poor';
  if (chance(upgradeSuccessChance(it))) {
    G.player.gold -= cost.gold;
    G.player.scrap -= cost.scrap;
    it.upgrade = (it.upgrade || 0) + 1;
    G.factory.stats.upgraded++;
    markStatsDirty();
    UI.dirty.equip = true; UI.dirty.inv = true; UI.dirty.header = true;
    return 'ok';
  }
  // 失敗：消耗半數資源，強化等級不變
  G.player.gold -= Math.floor(cost.gold / 2);
  G.player.scrap -= Math.floor(cost.scrap / 2);
  G.factory.stats.upgradeFailed = (G.factory.stats.upgradeFailed || 0) + 1;
  UI.dirty.header = true;
  return 'fail';
}

function upgradeTick() {
  var f = G.factory;
  var cap = f.upgrade.cap;
  // 找強化等級最低且未達上限的已裝備裝備
  var target = null;
  SLOT_LIST.forEach(function (s) {
    var it = G.equipment[s];
    if (!it || (it.upgrade || 0) >= cap) return;
    if (!target || (it.upgrade || 0) < (target.upgrade || 0)) target = it;
  });
  if (!target) return;
  var cost = upgradeCost(target);
  var r = tryUpgrade(target);
  if (r === 'ok') {
    flog('⬆️ 自動強化：' + rarityTag(target) + ' +' + target.upgrade + '（金幣-' + fmt(cost.gold) + ' 碎片-' + cost.scrap + '）', '');
  } else if (r === 'fail') {
    flog('💥 自動強化失敗：' + rarityTag(target) + '（成功率 ' + fmt1(upgradeSuccessChance(target)) + '%，損失半數材料）', 'warn');
  }
}

/* ---- 手動強化（裝備詳情按鈕用），自行記錄日誌 ---- */
function manualUpgrade(it) {
  var r = tryUpgrade(it);
  if (r === 'poor') {
    var cost = upgradeCost(it);
    blog('⚠️ 資源不足（需要金幣 ' + fmt(cost.gold) + '、碎片 ' + cost.scrap + '）', 'warn');
  } else if (r === 'ok') {
    blog('⬆️ 強化成功：' + rarityTag(it) + ' +' + it.upgrade, 'good');
  } else {
    blog('💥 強化失敗！損失半數材料（成功率 ' + fmt1(upgradeSuccessChance(it)) + '%，可堆「強化成功率」屬性）', 'warn');
  }
  return r === 'ok';
}
