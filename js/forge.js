'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
/* 四功能神鑄。素材入槽時移出庫存；神性之石只預選，執行時才扣除。 */
function forgeMigrateState(data) {
  var f = data.forge;
  if (f && f.version === 2) {
    if (f.unlocked === undefined) f.unlocked = !!f.unlockNotified;
    return f;
  }
  // 舊製作尚未扣款，取消並完整退回素材，包括滿背包。
  ((f && f.slots) || []).forEach(function (it) {
    if (!it) return;
    if (it.kind === 'gem') {
      var gems = data.player.gems || (data.player.gems = {});
      var byLv = gems[it.type] || (gems[it.type] = {});
      byLv[it.level] = (Number(byLv[it.level]) || 0) + 1;
    } else (data.inventory || (data.inventory = [])).push(it);
  });
  return data.forge = { version: 2, operation: 'equip', slots: [null, null, null, null, null, null],
    stones: 0, result: null, log: [], unlocked: !!(f && (f.unlocked || f.unlockNotified)),
    unlockNotified: !!(f && f.unlockNotified) };
}
function forgeState() { return forgeMigrateState(G); }
function forgeUnlocked() {
  if (!G || !G.player) return false;
  var f = forgeState();
  if (G.player.level >= FORGE_UNLOCK_LEVEL && reincarnationCount() >= FORGE_UNLOCK_REINCARNATION) f.unlocked = true;
  return !!f.unlocked;
}
function forgeOperationUnlocked(mode) {
  return !!DIVINE_FORGE_MODES[mode] && forgeUnlocked() && reincarnationCount() >= divineForgeUnlock(mode);
}
function forgeLog(msg, cls) {
  var f = forgeState();
  f.log.unshift({ msg: msg, cls: cls || '' });
  f.log.length = Math.min(f.log.length, 25);
  UI.dirty.forge = true;
}
function forgeMode() { return forgeState().operation; }
function forgeItemCount() { return forgeState().slots.filter(Boolean).length; }
function forgeRarity() {
  var first = forgeState().slots.filter(Boolean)[0];
  return first && first.kind !== 'gem' ? first.rarity : null;
}
function forgeSetOperation(mode) {
  if (!forgeOperationUnlocked(mode)) return STR(2160, divineForgeUnlock(mode));
  forgeUnloadAll();
  forgeState().operation = mode;
  forgeState().result = null;
  UI.dirty.forge = true;
  return null;
}
function forgeRateInfo() { return divineForgeRateInfo(forgeState(), G.player.dust); }
function forgeDustCount() {
  var f = forgeState(), info = forgeRateInfo();
  f.stones = info ? info.stones : 0;
  return f.stones;
}
function forgeSetStones(count) {
  if (!Number.isInteger(count) || count < 0) return STR(2161);
  forgeState().stones = count;
  forgeDustCount();
  UI.dirty.forge = true;
  return null;
}
function forgePlaceItem(id) {
  var f = forgeState();
  if (!forgeOperationUnlocked(f.operation)) return STR(2160, divineForgeUnlock(f.operation));
  if (f.operation === 'gem') return STR(2162);
  var index = G.inventory.findIndex(function (it) { return it.id === id; });
  if (index < 0) return STR(1243);
  var it = G.inventory[index];
  if (it.locked) return STR(2163);
  if (!divineForgeItemEligible(it, f.operation)) return STR(2164);
  if (f.operation === 'equip' && forgeRarity() !== null && forgeRarity() !== it.rarity) return STR(2165, DIVINE_FORGE.equipCount);
  var slot = f.slots.indexOf(null);
  if (slot < 0 || slot >= divineForgeSlotCount(f.operation)) return STR(1247);
  f.slots[slot] = G.inventory.splice(index, 1)[0];
  f.result = null;
  forgeDustCount();
  UI.dirty.forge = UI.dirty.inv = true;
  return null;
}
function forgePlaceGem(type, level) {
  var f = forgeState();
  if (!forgeOperationUnlocked(f.operation)) return STR(2160, divineForgeUnlock(f.operation));
  if (f.operation !== 'gem' || level !== GEM_FORGE_MAX_LEVEL || !GEM_TYPES[type] || !isGemEnabled(type)) return STR(2166, GEM_FORGE_MAX_LEVEL, DIVINE_FORGE.gemPerType);
  var counts = {};
  f.slots.filter(Boolean).forEach(function (g) { counts[g.type] = (counts[g.type] || 0) + 1; });
  if ((counts[type] || 0) >= DIVINE_FORGE.gemPerType || (!counts[type] && Object.keys(counts).length >= 2)) return STR(2166, GEM_FORGE_MAX_LEVEL, DIVINE_FORGE.gemPerType);
  if (gemCount(type, level) < 1) return STR(44, gemLabel(type, level));
  var slot = f.slots.indexOf(null);
  if (slot < 0) return STR(1247);
  addGem(type, level, -1);
  f.slots[slot] = { kind: 'gem', type: type, level: level };
  f.result = null;
  forgeDustCount();
  UI.dirty.forge = true;
  return null;
}
function forgeReturnItem(it) {
  G.inventory.push(it);
  UI.dirty.inv = true;
}
function forgeRemoveItem(index) {
  var f = forgeState();
  if (!Number.isInteger(index) || index < 0 || index >= FORGE_SLOTS) return STR(2161);
  var it = f.slots[index];
  if (!it) return null;
  f.slots[index] = null;
  if (it.kind === 'gem') addGem(it.type, it.level, 1);
  else forgeReturnItem(it);
  forgeDustCount();
  UI.dirty.forge = true;
  return null;
}
function forgeUnloadAll() {
  var n = forgeItemCount();
  for (var i = 0; i < FORGE_SLOTS; i++) forgeRemoveItem(i);
  forgeState().stones = 0;
  UI.dirty.forge = true;
  return n;
}
function forgeApplyImprint(it, stones) {
  delete it.imprint;
  var kinds = ['sacredAffix', 'ancientAffix', 'sacredSocket', 'extraAffix', 'extraAncient', 'legendary', 'refund'];
  var kind = wpick(kinds.map(function (key) { return [key, DIVINE_FORGE[key + 'Weight']]; }));
  var candidates = [], imprint = { kind: kind };
  if (kind === 'sacredAffix' || kind === 'ancientAffix') {
    it.affixes.forEach(function (a, i) { if (!!a.ancient === (kind === 'sacredAffix')) candidates.push(i); });
  } else if (kind === 'sacredSocket') {
    (it.sockets || []).forEach(function (_, i) { candidates.push(i); });
  }
  // 不可套用的結果仍保留原權重；無效果且撤回舊刻印。
  if (kind === 'sacredAffix' || kind === 'ancientAffix' || kind === 'sacredSocket') {
    if (candidates.length) imprint.index = pick(candidates);
    else imprint.inactive = true;
  } else if (kind === 'extraAffix' || kind === 'extraAncient') {
    imprint.affix = rollAffixes(1, it.rarity === 11 ? 6 : it.rarity, it.slot, kind === 'extraAncient' ? { 0: true } : {}, undefined, it.level)[0];
    if (!imprint.affix) imprint.inactive = true;
  } else if (kind === 'legendary') {
    var keys = passiveKeysForItem(it).filter(function (key) { return !it.passive || key !== it.passive.key; });
    if (keys.length) imprint.passive = { key: pick(keys) };
    else imprint.inactive = true;
  } else {
    imprint.refund = Math.floor(stones * DIVINE_FORGE.refundRate);
    G.player.dust += imprint.refund;
  }
  if (imprint.inactive) {
    imprint = { kind: 'refund', refund: Math.floor(stones * DIVINE_FORGE.refundRate) };
    G.player.dust += imprint.refund;
  }
  it.imprint = imprint;
  return imprint;
}
function doForge() {
  var f = forgeState(), mode = f.operation;
  if (!forgeOperationUnlocked(mode)) return STR(2160, divineForgeUnlock(mode));
  var items = f.slots.filter(Boolean), counts = {};
  if (items.length !== divineForgeSlotCount(mode)) return STR(2167);
  if (mode === 'gem') {
    if (items.some(function (g) { return g.kind !== 'gem' || g.level !== GEM_FORGE_MAX_LEVEL || !GEM_TYPES[g.type] || !isGemEnabled(g.type); })) return STR(2166, GEM_FORGE_MAX_LEVEL, DIVINE_FORGE.gemPerType);
    items.forEach(function (g) { counts[g.type] = (counts[g.type] || 0) + 1; });
    if (Object.keys(counts).length !== 2 || Object.keys(counts).some(function (t) { return counts[t] !== DIVINE_FORGE.gemPerType; })) return STR(2166, GEM_FORGE_MAX_LEVEL, DIVINE_FORGE.gemPerType);
  } else if (items.some(function (it) { return it.locked || !divineForgeItemEligible(it, mode) || (mode === 'equip' && it.rarity !== items[0].rarity); })) return STR(2164);
  var info = forgeRateInfo();
  if (!info || f.stones !== info.stones || (G.player.dust || 0) < info.stones) return STR(2168);
  if (G.player.gold < info.cost) return STR(1267, fmt(info.cost), fmt(G.player.gold));
  G.player.gold -= info.cost;
  G.player.dust = (G.player.dust || 0) - info.stones;
  f.slots = [null, null, null, null, null, null];
  f.stones = 0; f.result = null;
  var success = chance(info.total), message;
  if (success) {
    if (mode === 'equip') {
      var maxLevel = Math.max.apply(null, items.map(function (it) { return it.level; }));
      var out = makeEquipment(maxLevel, { rarity: divineForgeOutputRarity(items[0].rarity), level: maxLevel });
      forgeReturnItem(out);
      f.result = { name: out.name, rarity: out.rarity, slot: out.slot, level: out.level };
      message = STR(2169, out.name);
    } else if (mode === 'gem') {
      var fg = { id: uid(), divine: true, level: GEM_FORGE_MAX_LEVEL,
        stats: Object.keys(counts).map(function (type) { return { type: type, divine: true }; }) };
      (G.player.fusedGems || (G.player.fusedGems = [])).push(fg);
      f.result = { kind: 'divineGem', gem: fg };
      message = STR(2170, fusedGemStatText(fg));
    } else {
      var item = items[0];
      if (mode === 'ancient') {
        var a = pick(divineForgeAncientCandidates(item));
        a.ancient = true; a.roll = STRENGTH_ROLL_MAX;
        if (item.imprint && item.imprint.affix === a) item.imprint.kind = 'extraAncient';
      } else forgeApplyImprint(item, info.stones);
      forgeReturnItem(item);
      f.result = { name: item.name, rarity: item.rarity, slot: item.slot, level: item.level };
      message = STR(2169, item.name);
      if (mode === 'imprint' && item.imprint) {
        var ip = item.imprint;
        var kindIndex = ['sacredAffix','ancientAffix','sacredSocket','extraAffix','extraAncient','legendary','refund'].indexOf(ip.kind);
        message += ' · ' + (ip.kind === 'refund' ? STR(2201, ip.refund) : STR(2177, STR(2178 + kindIndex)));
      }
    }
  } else if (mode === 'equip') {
    var remaining = items.slice(), lost = ri(DIVINE_FORGE.failMin, DIVINE_FORGE.failMax);
    for (var n = 0; n < lost; n++) remaining.splice(ri(0, remaining.length - 1), 1);
    remaining.forEach(forgeReturnItem);
    message = STR(2171, lost, remaining.length);
  } else message = STR(2172);
  forgeLog(message, success ? 'good' : 'bad');
  blog(message, success ? 'good' : 'warn', 'factory');
  if (typeof markStatsDirty === 'function') markStatsDirty();
  UI.dirty.header = UI.dirty.inv = UI.dirty.gems = UI.dirty.equip = UI.dirty.forge = true;
  return null;
}
// 模擬生命週期接點；新版沒有計時或自動執行。
function forgeTick() { if (G.forge && G.forge.version !== 2) forgeState(); }
