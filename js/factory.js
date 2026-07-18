'use strict';
/* ============ 自動生產線（Automation Line） ============ */

/* ---- 零件加成查詢 ---- */
function partBonus(node, key) {
  if (!isFactoryNodeEnabled(node)) return 0;
  var f = G.factory;
  var ids = f.installed[node] || [];
  var sum = 0;
  ids.forEach(function (id) {
    var p = findPart(id);
    if (p && p.key === key) sum += effectiveFactoryPartValue(p.key, p.val);
  });
  return sum;
}
function effectivePartBonus(node, key) {
  return effectivePartEffectValue(key, partBonus(node, key));
}
function findPart(id) {
  var f = G.factory;
  for (var i = 0; i < f.parts.length; i++) if (f.parts[i].id === id) return f.parts[i];
  return null;
}
function bestAvailablePartForInstall(node, key) {
  var best = null;
  G.factory.parts.forEach(function (p) {
    if (!p || p.key !== key || !PART_TYPES[p.key] || PART_TYPES[p.key].node !== node || isInstalled(p.id)) return;
    if (!best || p.tier > best.tier || (p.tier === best.tier && p.val > best.val)) best = p;
  });
  return best;
}
function isInstalled(id) {
  var inst = G.factory.installed;
  for (var node in inst) if (inst[node].indexOf(id) >= 0) return true;
  return false;
}
function installPart(id, node) {
  if (!isFactoryNodeEnabled(node)) return false;
  var p = findPart(id);
  if (!p) return false;
  if (!PART_TYPES[p.key] || PART_TYPES[p.key].node !== node) { flog('⚠️ ' + p.name + ' 無法安裝到' + NODE_NAMES[node], 'warn'); return false; }
  if (isInstalled(id)) return false;
  var arr = G.factory.installed[node];
  if (arr.length >= slotsForNode(node)) {
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

// 分解槽擴充：依目前已解鎖格數支付金幣，最多 20 格。
function expandSalvageSlot() {
  var current = salvageSlotCount();
  if (current >= SALVAGE_SLOT_MAX) return '分解槽已達上限（' + SALVAGE_SLOT_MAX + ' 格）';
  var cost = salvageSlotUnlockCost(current);
  if (G.player.gold < cost) return '金幣不足（需要 ' + fmt(cost) + '）';
  G.player.gold -= cost;
  G.factory.salvageSlots = current + 1;
  UI.dirty.header = true;
  UI.dirty.factory = true;
  flog('🔓 分解槽已擴充至 ' + G.factory.salvageSlots + '/' + SALVAGE_SLOT_MAX + ' 格，消耗金幣 ' + fmt(cost), 'good');
  return null;
}

/* ---- 零件庫存收斂 ----
   G.factory.parts 是全遊戲唯一無容量上限的集合，長期前景掛機（野外/高塔/探礦核心
   持續掉零件）會無限成長，拖慢工廠渲染、膨脹存檔並逼近 localStorage 上限。
   每種零件只有最高階最有用，故：已安裝者一律保留；未安裝者依（階級→數值）由高至低
   保留 PART_KEEP_PER_KEY 顆，其餘靜默分解為少量碎片。於各零件掉落點呼叫。 */
function trimFactoryParts() {
  var f = G.factory;
  var byKey = {};
  f.parts.forEach(function (p) { (byKey[p.key] || (byKey[p.key] = [])).push(p); });
  var keep = [], scrapGain = 0;
  Object.keys(byKey).forEach(function (k) {
    var installedParts = byKey[k].filter(function (p) { return isInstalled(p.id); });
    var loose = byKey[k].filter(function (p) { return !isInstalled(p.id); })
      .sort(function (a, b) { return (b.tier - a.tier) || (b.val - a.val); });
    keep = keep.concat(installedParts, loose.slice(0, PART_KEEP_PER_KEY));
    loose.slice(PART_KEEP_PER_KEY).forEach(function (p) { scrapGain += p.tier * 2; });
  });
  if (keep.length === f.parts.length) return; // 未超量，無需重建
  f.parts = keep;
  if (scrapGain) { G.player.scrap += scrapGain; UI.dirty.header = true; }
  UI.dirty.factory = true;
}

/* ---- 容量公式（conveyorCap、synthBufCap）→ js/formula.js §7 ---- */

/* ---- 裝備導入 ---- */
function pushConveyor(item) {
  // 熔爐合併版：掉落裝備一律進入熔爐佇列（newforge.js），佇列滿載即丟棄（同舊輸送帶滿載規則）。
  if (typeof newForgeTryIntake === 'function' && G.newForge) {
    if (newForgeTryIntake(item)) return true;
    flog('⚠️ 熔爐佇列已達 ' + fmt(NEW_FORGE_QUEUE_CAP) + ' 件上限，新裝備已丟棄', 'warn');
    UI.dirty.newforge = true;
    return false;
  }
  // 後備：熔爐模組未載入（部分測試環境）時維持舊輸送帶流程。
  var f = G.factory;
  if (f.conveyor.length >= conveyorCap()) {
    flog('⚠️ 輸送帶已達 ' + conveyorCap() + ' 件上限，新裝備已丟棄', 'warn');
    UI.dirty.factory = true;
    return false;
  }
  f.conveyor.push(item);
  UI.dirty.factory = true;
  return true;
}

/* ---- 篩選節點 ---- */
function decideFilter(it) {
  var f = G.factory;
  if (it.locked) return 'keep';
  
  var action = f.filter.actions[it.rarity] || 'keep';
  
  // 智慧分解：比（較弱的那件）已裝備差 → 分解，否則保留
  if (action === 'smart') {
    var cur = G.equipment[equipTargetSlot(it)];
    if (cur && itemScore(it) <= itemScore(cur)) {
      return 'salvage';
    } else {
      return 'keep';
    }
  }
  
  return action;
}

/* ---- 分解（附魔精華與太古精華公式 → js/formula.js §7）----
   bonus：零件加成來源 function(key)→數值。熔爐拆解傳入該爐零件格加成（newforge.js
   newForgePartBonus）；省略時沿用舊分解槽安裝表（partBonus，節點移除後恆為 0，
   即手動「一鍵分解」不吃零件加成）。 */
function doSalvage(it, silent, bonus) {
  var raw = bonus || function (key) { return partBonus('salvage', key); };
  var eff = function (key) { return effectivePartEffectValue(key, raw(key)); };
  // 鑲嵌的寶石先取回，不隨分解銷毀（含融合寶石）
  if (it.sockets) {
    for (var si = 0; si < it.sockets.length; si++) {
      var sg = it.sockets[si];
      if (sg && sg.fused) {
        if (!G.player.fusedGems) G.player.fusedGems = [];
        G.player.fusedGems.push(sg.fused);
        if (!silent) flog('💎 取回融合寶石：' + fusedGemLabel(sg.fused), 'info');
        it.sockets[si] = null;
      } else if (sg && GEM_TYPES[sg.type]) {
        addGem(sg.type, sg.level, 1);
        if (!silent) flog('💎 取回鑲嵌寶石：' + gemLabel(sg.type, sg.level), 'info');
        it.sockets[si] = null;
      }
    }
  }
  // 基礎分解產出（精粹透鏡：提高附魔精華產出率）
  var res = salvageResult(it,
    eff('ancientEssenceRate'),
    raw('extractLens'));

  // 產量倍率：碎片熔煉爐 / 淘金濾網
  res.scrap = Math.max(1, Math.round(res.scrap * (1 + raw('scrapForge') / 100)));
  res.gold = Math.round(res.gold * (1 + raw('goldSluice') / 100));
  var extras = []; // 額外掉落 / 事件（記入日誌）
  // 複製處理艙：碎片＋金幣翻倍
  var dupC = eff('duplicator');
  if (dupC > 0 && chance(dupC)) { res.scrap *= 2; res.gold *= 2; extras.push('♻️翻倍'); }
  // 幸運晶片：大豐收（碎片/金幣/精華 ×3）
  var fc = eff('fortuneChip');
  if (fc > 0 && chance(fc)) { res.scrap *= 3; res.gold *= 3; res.essence *= 3; extras.push('🎰大豐收×3'); }

  // 入帳
  G.player.scrap += res.scrap;
  G.player.gold += res.gold;
  if (window.recordLootMat) window.recordLootMat('scrap', res.scrap, 'factory');
  if (window.recordLootGold) window.recordLootGold(res.gold, 'factory');
  if (res.essence) {
    G.player.essence += res.essence;
    if (window.recordLootMat) window.recordLootMat('essence', res.essence, 'factory');
  }
  if (res.ancientEssence) {
    G.player.ancientEssence = (G.player.ancientEssence || 0) + res.ancientEssence;
    if (window.recordLootMat) window.recordLootMat('ancientEssence', res.ancientEssence, 'factory');
    extras.push('<img src="images/icon_ancient_essence.png" class="res-icon" alt="太古精華">太古精華x' + res.ancientEssence);
  }

  // 拓本回收臂：回收附魔書
  var bookB = eff('bookScavenger');
  if (bookB > 0 && chance(bookB)) {
    var bk = pick(Object.keys(ENCHANTS));
    G.player.books[bk] = (G.player.books[bk] || 0) + 1;
    if (window.recordLootMat) window.recordLootMat('book', 1, 'factory');
    extras.push('📖' + ENCHANTS[bk].name);
  }
  // 知識回收器：分解取得經驗
  var arch = raw('archivist');
  if (arch > 0 && chance(arch)) {
    var xpG = Math.max(1, Math.round(it.level * 25));
    gainXp(xpG);
    extras.push('📚經驗+' + fmt(xpG));
  }
  // 探礦核心：額外掉落自動機組零件
  var pros = eff('prospector');
  if (pros > 0 && chance(pros)) {
    var np = makePart(clamp(1 + Math.floor(it.rarity / 2), 1, PART_MAX_TIER));
    G.factory.parts.push(np);
    if (window.recordLootMat) window.recordLootMat('part', 1, 'factory');
    trimFactoryParts(); // 收斂零件庫存，防無限成長
    extras.push('⛏️' + np.name);
    UI.dirty.factory = true;
  }

  G.factory.stats.salvaged++;
  UI.dirty.header = true;
  if (!silent) {
    var tail = extras.length ? '（' + extras.join('、') + '）' : '';
    if (res.essence) {
      flog('🔮 附魔精華回收！' + rarityTag(it) + ' → 碎片x' + res.scrap +
        '、附魔精華x' + res.essence + tail, 'good');
    } else {
      flog('⚒️ 分解 ' + rarityTag(it) + ' → 碎片x' + res.scrap + tail, extras.length ? 'good' : '');
    }
  }
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
  if (SYNTHESIS_ENABLED && f.synth.enabled) synthTick();
  // 附魔節點（每 3 秒）
  f.enchTimer -= dt;
  if (f.enchTimer <= 0) { f.enchTimer = 3; /* 附魔已改為裝備介面手動操作 */ }
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
  if (act === 'synth' && !SYNTHESIS_ENABLED) act = 'keep';
  if (act === 'salvage') {
    if (isAutoSalvageProtected(it)) {
      flog('🛡️ 自動分解保護：已保留 ' + rarityTag(it), 'warn');
      addToInventory(it);
    } else {
      doSalvage(it);
    }
  } else if (act === 'synth') {
    if (f.synthBuffer.length >= synthBufCap()) {
      var old = takeAutoSalvageCandidate(f.synthBuffer);
      if (old) {
        var res = doSalvage(old, true);
        flog('⚠️ 合成暫存區滿載，自動分解較低品質素材 ' + rarityTag(old) + ' → 碎片x' + res.scrap, 'warn');
      } else if (!isAutoSalvageProtected(it)) {
        var ires = doSalvage(it, true);
        flog('⚠️ 合成暫存區滿載，為保留高品質素材，自動分解新進 ' + rarityTag(it) + ' → 碎片x' + ires.scrap, 'warn');
        return;
      } else {
        flog('🛡️ 合成暫存區滿載，已保留高品質素材 ' + rarityTag(it) + '（目前超出容量）', 'warn');
      }
    }
    f.synthBuffer.push(it);
    flog('🧪 ' + rarityTag(it) + ' 送入合成暫存區', '');
  } else {
    addToInventory(it);
  }
}

/* ---- 合成節點 ---- */
function synthTick() {
  if (!SYNTHESIS_ENABLED) return;
  var f = G.factory;
  // 寶石合成：3 顆同種同級 → 1 顆同種下一級
  if (f.synth.gemMerge) {
    var merged = false;
    for (var gt in GEM_TYPES) {
      for (var lv = 1; lv < GEM_MAX_LEVEL; lv++) {
        if (gemCount(gt, lv) >= 3) {
          addGem(gt, lv, -3);
          addGem(gt, lv + 1, 1);
          flog('💎 寶石升階：' + gemLabel(gt, lv) + ' x3 → ' + gemLabel(gt, lv + 1), 'info');
          merged = true;
          break; // 每 tick 只合一次
        }
      }
      if (merged) break;
    }
  }
  // 混合合成優先，其次品質合成
  if (f.synth.hybridEnabled && tryHybridSynthesis()) return;
  if (f.synth.mergeEnabled) tryRarityMerge();
}

// 混合合成：[裝備(任何)] + [寶石(X等級)] + [附魔書(特定)] = 特殊裝備（賦予附魔）
function tryHybridSynthesis() {
  if (!SYNTHESIS_ENABLED) return false;
  var f = G.factory;
  if (!f.synthBuffer.length) return false;
  // 找可用寶石（滿足最低等級設定，用最低可用等級以節約高級寶石；不限種類）
  var gemLv = 0;
  for (var lv = f.synth.minGemLevel; lv <= GEM_MAX_LEVEL; lv++) {
    if (totalGemsOfLevel(lv) > 0) { gemLv = lv; break; }
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
  takeGemOfLevel(gemLv);
  G.player.books[bookKey]--;
  UI.dirty.header = true; UI.dirty.factory = true;

  // 大成功：稀有度 +1（機率公式 synthGreatChanceNow → formula.js §7）
  // 上限鎖定創世：神鑄創世僅能由神鑄系統產出
  var great = chance(synthGreatChanceNow());
  if (great && it.rarity < GODFORGED_IDX - 1) {
    it.rarity++;
    ensureSockets(it); // 稀有度提升 → 插槽數同步增加
    it.name = RARITY_PREFIX[it.rarity] + it.name.replace(/^(神鑄創世的|粗糙的|堅實的|精工的|奇異的|大師級|傳世的|神鑄的|創世的|普通的|精良的|稀有的|獨特的|史詩的|傳說的|神話的)/, '');
    // 升稀有度補被動
    if (it.rarity >= RARE_IDX && !it.passive) {
      var pk = pick(Object.keys(PASSIVE_POOL));
      it.passive = { key: pk, val: passiveValueFor(pk, it.rarity) };
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
  // 混合合成變異：本次附魔威力 x1.5 並追加一條詞條
  var mutated = st.hybridMutation > 0 && chance(st.hybridMutation);
  if (mutated) {
    var mens = itemEnchants(it);
    for (var mi = 0; mi < mens.length; mi++) {
      if (mens[mi].key === bookKey) { mens[mi].val = Math.round(mens[mi].val * 1.5 * 10) / 10; break; }
    }
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
  if (!SYNTHESIS_ENABLED) return false;
  var f = G.factory;
  if (f.synthBuffer.length < 3) return false;
  var byRarity = {};
  for (var i = 0; i < f.synthBuffer.length; i++) {
    var r = f.synthBuffer[i].rarity;
    (byRarity[r] = byRarity[r] || []).push(i);
  }
  // 上限鎖定創世（GODFORGED_IDX - 1）：神鑄創世僅能由神鑄系統產出
  for (var rr = 0; rr < GODFORGED_IDX - 1; rr++) {
    var idxs = byRarity[rr];
    if (idxs && idxs.length >= 3) {
      var mats = [];
      // 由後往前移除避免位移
      for (var j = 2; j >= 0; j--) mats.push(f.synthBuffer.splice(idxs[j], 1)[0]);
      var avgLv = Math.max(1, Math.round((mats[0].level + mats[1].level + mats[2].level) / 3));
      var great = chance(synthGreatChanceNow());
      var newRarity = clamp(rr + 1 + (great ? 1 : 0), 0, GODFORGED_IDX - 1);
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

/* ---- 寶石合成已改版（2 顆同種同級 → 下一級）：composeGems → item.js ---- */

/* （附魔節點已移除：附魔改為裝備介面手動操作，見 item.js manualEnchant） */

/* ---- 強化節點：自動強化已裝備裝備 ----
   費用/成功率公式（upgradeCost、upgradeSuccessChance）→ js/formula.js §7 */

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
  return r;
}
