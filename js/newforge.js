'use strict';
/* ============ 新熔爐（測試版 V2：傳送帶/生產線） ============
   與舊生產線（factory.js）並行運作，遵循無損搬移：並行建置 → 路由切換。
   路由：pushConveyor 頂端掛勾 newForgeTryIntake——「導入新裝備」開啟時新掉落
   改流入 G.newForge.queue；關閉（或佇列滿載）時回退舊輸送帶，舊機制零改動。

   V2 模型（企劃書：熔爐改造V2）：每座熔爐最多 NEW_FORGE_LINES_MAX 條傳送帶，
   每條傳送帶設定篩選器後自動篩選相應原材料上帶（裝載時即扣資源），
   物品由右至左流入熔爐（每 NEW_FORGE_INTERVAL 秒入爐 1 批）後消失並產出。
   帶上批次＝「在途」資源：移除線/改篩選器/移除熔爐時全額退回。
   資料表（材料/產出/配方/篩選器）→ js/data.js；擲量公式 newForgeRollAmount → js/formula.js §7。 */

var _nfBypass = false; // 佇列退回舊輸送帶期間暫時繞過攔截，避免遞迴

function nflog(msg, cls) {
  if (typeof addLog === 'function') addLog('newforge-log', msg, cls, 50);
}

function newForgeState() { return G && G.newForge; }

/* ---- 路由攔截（factory.js pushConveyor 呼叫）：收下回 true ---- */
function newForgeTryIntake(item) {
  if (_nfBypass) return false;
  var nf = newForgeState();
  if (!nf || !nf.intake) return false;
  if (nf.queue.length >= NEW_FORGE_QUEUE_CAP) return false; // 滿載 → 回退舊輸送帶
  nf.queue.push(item);
  UI.dirty.newforge = true;
  return true;
}

/* ---- 佇列退回舊輸送帶（手動；例如想改回舊流程時清空積壓） ---- */
function newForgeReturnQueueToConveyor() {
  var nf = newForgeState();
  if (!nf) return 0;
  var n = 0;
  _nfBypass = true;
  try {
    while (nf.queue.length) {
      if (!pushConveyor(nf.queue[0])) break; // 舊輸送帶滿載即停，裝備不丟失
      nf.queue.shift();
      n++;
    }
  } finally {
    _nfBypass = false;
  }
  UI.dirty.newforge = true;
  UI.dirty.factory = true;
  return n;
}

/* ---- 主迴圈：每條傳送帶獨立計時，每 NEW_FORGE_INTERVAL 秒 tick 一次 ---- */
function newForgeTick(dt) {
  var nf = newForgeState();
  if (!nf || !nf.furnaces || !nf.furnaces.length) return;
  for (var i = 0; i < nf.furnaces.length; i++) {
    var fu = nf.furnaces[i];
    if (!fu.lines) continue;
    for (var j = 0; j < fu.lines.length; j++) {
      var line = fu.lines[j];
      line.timer -= dt;
      if (line.timer > 0) continue;
      line.timer = NEW_FORGE_INTERVAL;
      newForgeLineTick(fu, line);
    }
  }
}

// 篩選器是否可運作（wip＝企劃書尚未提供配方）
function newForgeFilterDef(ftype, filterKey) {
  var filters = NEW_FORGE_FILTERS[ftype] || [];
  for (var i = 0; i < filters.length; i++) if (filters[i].key === filterKey) return filters[i];
  return null;
}

/* ---- 傳送帶 tick：先入爐 1 批，再依篩選器裝載 ---- */
function newForgeLineTick(fu, line) {
  if (!line.enabled) return;
  var def = newForgeFilterDef(fu.ftype, line.filter);
  if (!def || def.wip) return; // 尚未開放的篩選器不動作
  newForgeLineConsume(line);
  newForgeLineLoad(line);
}

// 入爐：帶頭（最左）批次進熔爐產出
function newForgeLineConsume(line) {
  if (!line.belt.length) return;
  var e = line.belt.shift();
  UI.dirty.newforge = true;
  if (e.kind === 'salv') {
    newForgeSalvage(e.item);
  } else if (e.kind === 'craft') {
    newForgeCraftOutput(e.recipe, e.item);
  } else if (e.kind === 'smelt') {
    var mats = G.player.forgeMats;
    mats[e.product] = (mats[e.product] || 0) + 1;
    G.newForge.stats.smelted++;
    nflog('🫕 熔煉完成：' + NEW_FORGE_MATERIALS[e.product].emoji + NEW_FORGE_MATERIALS[e.product].name + ' +1');
  }
}

// 裝載：篩選器自動篩選相應原材料放入輸送帶（裝載時即扣資源）
function newForgeLineLoad(line) {
  var nf = newForgeState();
  var mats = G.player.forgeMats;
  var loaded = 0, k;
  if (line.filter === 'salvage') {
    // 自佇列逐件判定：分解→上帶（帶滿放回佇列頭）、保留→直接入包（不佔帶位）
    while (loaded < NEW_FORGE_LINE_LOAD_PER_TICK && nf.queue.length) {
      var it = nf.queue.shift();
      loaded++;
      UI.dirty.newforge = true;
      if (G.factory && G.factory.autoEquip && tryAutoEquip(it)) continue; // 換下舊裝經 pushConveyor 回流
      if (newForgeDecide(line, it) === 'salvage') {
        if (line.belt.length >= NEW_FORGE_BELT_CAP) { nf.queue.unshift(it); break; }
        line.belt.push({ kind: 'salv', item: it });
      } else {
        // 滿載時 addToInventory 可能改走舊自動分解（回傳 false），此時不計入「保留」
        if (addToInventory(it)) nf.stats.kept++;
      }
    }
  } else if (line.filter === 'craft') {
    var rc = NEW_FORGE_CRAFT_RECIPES[line.craft.recipe];
    if (!rc) return;
    var cap = INVENTORY_CAP + (G.player.invUpgrades || 0);
    while (loaded < NEW_FORGE_LINE_LOAD_PER_TICK && line.belt.length < NEW_FORGE_BELT_CAP) {
      if (G.inventory.length >= cap) break; // 背包滿載時停止裝載，避免產物擠爆背包
      if (!newForgeCanAfford(rc.mats)) break;
      var idx = -1;
      for (var i = 0; i < nf.queue.length; i++) {
        var x = nf.queue[i];
        if (x && x.rarity === rc.inputRarity && !x.locked) { idx = i; break; }
      }
      if (idx < 0) break;
      for (k in rc.mats) mats[k] -= rc.mats[k];
      line.belt.push({ kind: 'craft', item: nf.queue.splice(idx, 1)[0], recipe: line.craft.recipe });
      loaded++;
      UI.dirty.newforge = true;
    }
  } else if (line.filter === 'smelt') {
    var src = NEW_FORGE_SMELT_RECIPES[line.smelt.product];
    if (!src) return;
    while (loaded < NEW_FORGE_LINE_LOAD_PER_TICK && line.belt.length < NEW_FORGE_BELT_CAP && newForgeCanAfford(src)) {
      for (k in src) mats[k] -= src[k];
      line.belt.push({ kind: 'smelt', product: line.smelt.product });
      loaded++;
      UI.dirty.newforge = true;
    }
  }
}

function newForgeCanAfford(cost) {
  var mats = G.player.forgeMats;
  for (var k in cost) if ((mats[k] || 0) < cost[k]) return false;
  return true;
}

/* ---- 拆解判定：上鎖/神鑄創世一律保留；動作＋等級條件（不符＝保留） ---- */
function newForgeCondMatch(cond, level) {
  if (!cond || cond.op === 'any') return true;
  var lv = Math.max(1, Math.floor(Number(cond.lv) || 0));
  if (cond.op === 'lte') return level <= lv;
  if (cond.op === 'gte') return level >= lv;
  return true;
}
function newForgeDecide(line, it) {
  if (it.locked) return 'keep';
  if (it.rarity >= NEW_FORGE_SALVAGE_YIELD.length) return 'keep'; // 神鑄創世不在企劃表
  var act = line.salvage.actions[it.rarity] || 'keep';
  if (act !== 'salvage') return 'keep';
  return newForgeCondMatch(line.salvage.conds[it.rarity], it.level) ? 'salvage' : 'keep';
}

// 鑲嵌寶石取回（與舊分解一致，不隨拆解/鍛造銷毀；含融合寶石）
function newForgeReclaimSockets(it) {
  if (!it.sockets) return;
  for (var si = 0; si < it.sockets.length; si++) {
    var sg = it.sockets[si];
    if (sg && sg.fused) {
      if (!G.player.fusedGems) G.player.fusedGems = [];
      G.player.fusedGems.push(sg.fused);
      nflog('💎 取回融合寶石：' + fusedGemLabel(sg.fused), 'info');
      it.sockets[si] = null;
    } else if (sg && GEM_TYPES[sg.type]) {
      addGem(sg.type, sg.level, 1);
      nflog('💎 取回鑲嵌寶石：' + gemLabel(sg.type, sg.level), 'info');
      it.sockets[si] = null;
    }
  }
}

/* ---- 拆解入爐：依品質產出表入帳 forgeMats（僅企劃表 8 種碎料） ---- */
function newForgeSalvage(it) {
  newForgeReclaimSockets(it);
  var yields = NEW_FORGE_SALVAGE_YIELD[it.rarity];
  var mats = G.player.forgeMats;
  var gained = [];
  if (yields) {
    for (var k in yields) {
      var n = newForgeRollAmount(yields[k]);
      if (n > 0) {
        mats[k] = (mats[k] || 0) + n;
        gained.push(NEW_FORGE_MATERIALS[k].emoji + NEW_FORGE_MATERIALS[k].name + 'x' + fmt(n));
      }
    }
  }
  G.newForge.stats.salvaged++;
  UI.dirty.newforge = true;
  nflog('⚒️ 拆解 ' + rarityTag(it) + (gained.length ? ' → ' + gained.join('、') : ' →（本次無材料）'), gained.length > 1 ? 'good' : '');
  return gained;
}

/* ---- 鍛造入爐：素材（材料已於裝載時扣除）→ 品質+1 新裝備（等級/部位同素材） ---- */
function newForgeCraftOutput(recipeIdx, src) {
  var rc = NEW_FORGE_CRAFT_RECIPES[recipeIdx];
  if (!rc || !src) return;
  newForgeReclaimSockets(src);
  var out = makeEquipment(src.level, { rarity: rc.target, level: src.level, slot: src.slot });
  G.newForge.stats.crafted++;
  UI.dirty.newforge = true;
  UI.dirty.inv = true;
  nflog('🔨 鍛造成功：' + rarityTag(src) + ' → ' + rarityTag(out), 'good');
  // 自動鍛造產物不走滿載自動分解（裝載時已檢查背包空位；此處直接入包避免產物蒸發）
  G.inventory.push(out);
}

/* ---- 帶上內容退回（移除線/改篩選器/移除熔爐時呼叫）：裝備→背包、材料→庫存 ---- */
function newForgeLineRefund(line) {
  if (!line || !Array.isArray(line.belt)) return;
  var mats = G.player.forgeMats;
  var k;
  while (line.belt.length) {
    var e = line.belt.shift();
    if (!e) continue;
    if (e.kind === 'salv' && e.item) {
      addToInventory(e.item);
    } else if (e.kind === 'craft' && e.item) {
      var rc = NEW_FORGE_CRAFT_RECIPES[e.recipe];
      if (rc) for (k in rc.mats) mats[k] = (mats[k] || 0) + rc.mats[k];
      addToInventory(e.item);
    } else if (e.kind === 'smelt') {
      var src = NEW_FORGE_SMELT_RECIPES[e.product];
      if (src) for (k in src) mats[k] = (mats[k] || 0) + src[k];
    }
  }
  UI.dirty.newforge = true;
}

/* ---- 傳送帶增刪與篩選器切換 ---- */
function addNewForgeLine(furnaceId, filterKey) {
  var fu = findNewForgeFurnace(furnaceId);
  if (!fu) return '找不到熔爐';
  if (fu.lines.length >= NEW_FORGE_LINES_MAX) return '傳送帶已達上限（每爐 ' + NEW_FORGE_LINES_MAX + ' 條）';
  fu.lines.push(newForgeDefaultLine(fu.ftype, filterKey));
  UI.dirty.newforge = true;
  return null;
}
function removeNewForgeLine(furnaceId, lineIdx) {
  var fu = findNewForgeFurnace(furnaceId);
  if (!fu || !fu.lines[lineIdx]) return false;
  newForgeLineRefund(fu.lines[lineIdx]);
  fu.lines.splice(lineIdx, 1);
  UI.dirty.newforge = true;
  return true;
}
function setNewForgeLineFilter(fu, line, filterKey) {
  if (!newForgeFilterDef(fu.ftype, filterKey) || line.filter === filterKey) return;
  newForgeLineRefund(line); // 改篩選器前先退回在途批次
  line.filter = filterKey;
  UI.dirty.newforge = true;
}

/* ---- 熔爐增刪 ---- */
function addNewForgeFurnace(ftype) {
  var nf = newForgeState();
  if (!NEW_FORGE_TYPES[ftype]) return '未知熔爐類型';
  if (nf.furnaces.length >= NEW_FORGE_MAX) return '熔爐數量已達上限（' + NEW_FORGE_MAX + ' 座）';
  nf.furnaces.push(newForgeDefaultFurnace(nf.nextId++, ftype));
  UI.dirty.newforge = true;
  return null;
}
function removeNewForgeFurnace(id) {
  var nf = newForgeState();
  for (var i = 0; i < nf.furnaces.length; i++) {
    if (nf.furnaces[i].id === id) {
      (nf.furnaces[i].lines || []).forEach(newForgeLineRefund);
      nf.furnaces.splice(i, 1);
      UI.dirty.newforge = true;
      return true;
    }
  }
  return false;
}
function findNewForgeFurnace(id) {
  var nf = newForgeState();
  if (!nf) return null;
  for (var i = 0; i < nf.furnaces.length; i++) if (nf.furnaces[i].id === id) return nf.furnaces[i];
  return null;
}

/* ---- 存檔修正輔助：佇列＋各傳送帶上的裝備（save.js fixSockets/fixName 用） ---- */
function newForgeAllQueuedItems(data) {
  var out = [];
  var nf = data && data.newForge;
  if (!nf) return out;
  (nf.queue || []).forEach(function (it) { if (it) out.push(it); });
  (nf.furnaces || []).forEach(function (fu) {
    (fu && fu.lines || []).forEach(function (line) {
      (line && line.belt || []).forEach(function (e) {
        if (e && (e.kind === 'salv' || e.kind === 'craft') && e.item) out.push(e.item);
      });
    });
  });
  return out;
}

/* ---- 存檔遷移淨化（save.js migrateSave 呼叫；mergeDefaults 已補頂層預設）
   含 V1（furnace.mode 形狀）→ V2（furnace.lines 傳送帶）的一次性形狀轉換。 ---- */
function sanitizeNewForge(data) {
  if (!data) return;
  if (!data.newForge || typeof data.newForge !== 'object') data.newForge = newGameState().newForge;
  var nf = data.newForge;
  nf.intake = !!nf.intake;
  if (!Array.isArray(nf.queue)) nf.queue = [];
  if (nf.queue.length > NEW_FORGE_QUEUE_CAP) nf.queue.length = NEW_FORGE_QUEUE_CAP;
  if (!Array.isArray(nf.furnaces)) nf.furnaces = [];
  if (nf.furnaces.length > NEW_FORGE_MAX) nf.furnaces.length = NEW_FORGE_MAX;
  var maxId = 0;
  for (var i = 0; i < nf.furnaces.length; i++) {
    var fu = nf.furnaces[i];
    if (!fu || typeof fu !== 'object') { fu = nf.furnaces[i] = newForgeDefaultFurnace(i + 1, 'smith'); }
    fu.id = Math.max(1, Math.floor(Number(fu.id) || (i + 1)));
    if (!NEW_FORGE_TYPES[fu.ftype]) fu.ftype = 'smith';
    // V1 → V2：mode/salvage/craft/smelt 形狀 → 1 條對應篩選器的傳送帶（保留品質設定與熔煉產品）
    if (!Array.isArray(fu.lines)) {
      var line0 = newForgeDefaultLine(fu.ftype, (fu.mode === 'craft' || fu.mode === 'smelt') ? fu.mode : 'salvage');
      if (fu.salvage && Array.isArray(fu.salvage.actions)) line0.salvage.actions = fu.salvage.actions;
      if (fu.salvage && Array.isArray(fu.salvage.conds)) line0.salvage.conds = fu.salvage.conds;
      if (fu.smelt && NEW_FORGE_SMELT_RECIPES[fu.smelt.product]) line0.smelt.product = fu.smelt.product;
      fu.lines = [line0];
      delete fu.mode; delete fu.salvage; delete fu.craft; delete fu.smelt; delete fu.timer;
    }
    if (fu.lines.length > NEW_FORGE_LINES_MAX) fu.lines.length = NEW_FORGE_LINES_MAX;
    for (var j = 0; j < fu.lines.length; j++) {
      var line = fu.lines[j];
      if (!line || typeof line !== 'object') { line = fu.lines[j] = newForgeDefaultLine(fu.ftype); }
      if (typeof line.id !== 'string' || !line.id) line.id = uid();
      if (!newForgeFilterDef(fu.ftype, line.filter)) line.filter = (NEW_FORGE_FILTERS[fu.ftype] || NEW_FORGE_FILTERS.smith)[0].key;
      line.enabled = line.enabled !== false;
      if (!line.salvage || typeof line.salvage !== 'object') line.salvage = newForgeDefaultLine('smith').salvage;
      if (!Array.isArray(line.salvage.actions)) line.salvage.actions = newForgeDefaultLine('smith').salvage.actions;
      if (!Array.isArray(line.salvage.conds)) line.salvage.conds = [];
      for (var r = 0; r < RARITIES.length; r++) {
        var act = line.salvage.actions[r];
        if (act !== 'salvage' && act !== 'keep') line.salvage.actions[r] = r <= 5 ? 'salvage' : 'keep';
        var cond = line.salvage.conds[r];
        if (!cond || typeof cond !== 'object' || ['any', 'lte', 'gte'].indexOf(cond.op) < 0) {
          line.salvage.conds[r] = { op: 'any', lv: 200 };
        } else {
          cond.lv = Math.max(1, Math.floor(Number(cond.lv) || 200));
        }
      }
      line.salvage.actions.length = RARITIES.length;
      line.salvage.conds.length = RARITIES.length;
      if (!line.craft || typeof line.craft !== 'object') line.craft = { recipe: 0 };
      line.craft.recipe = clamp(Math.floor(Number(line.craft.recipe) || 0), 0, NEW_FORGE_CRAFT_RECIPES.length - 1);
      if (!line.smelt || typeof line.smelt !== 'object') line.smelt = { product: 'ironIngot' };
      if (!NEW_FORGE_SMELT_RECIPES[line.smelt.product]) line.smelt.product = 'ironIngot';
      if (!Array.isArray(line.belt)) line.belt = [];
      line.belt = line.belt.filter(function (e) {
        if (!e || typeof e !== 'object') return false;
        if (e.kind === 'salv') return !!(e.item && typeof e.item === 'object');
        if (e.kind === 'craft') {
          if (!(e.item && typeof e.item === 'object')) return false;
          e.recipe = clamp(Math.floor(Number(e.recipe) || 0), 0, NEW_FORGE_CRAFT_RECIPES.length - 1);
          return true;
        }
        if (e.kind === 'smelt') return !!NEW_FORGE_SMELT_RECIPES[e.product];
        return false;
      });
      if (line.belt.length > NEW_FORGE_BELT_CAP) line.belt.length = NEW_FORGE_BELT_CAP;
      line.timer = Number(line.timer) || 0;
    }
    if (fu.id > maxId) maxId = fu.id;
  }
  nf.nextId = Math.max(Math.floor(Number(nf.nextId) || 1), maxId + 1);
  if (!nf.stats || typeof nf.stats !== 'object') nf.stats = { salvaged: 0, kept: 0, crafted: 0, smelted: 0 };
  ['salvaged', 'kept', 'crafted', 'smelted'].forEach(function (k) {
    nf.stats[k] = Math.max(0, Math.floor(Number(nf.stats[k]) || 0));
  });
  // 材料計數淨化：只留註冊表內的 key，缺漏補 0
  var srcMats = (data.player && data.player.forgeMats && typeof data.player.forgeMats === 'object') ? data.player.forgeMats : {};
  var clean = {};
  for (var mk in NEW_FORGE_MATERIALS) clean[mk] = Math.max(0, Math.floor(Number(srcMats[mk]) || 0));
  if (data.player) data.player.forgeMats = clean;
}
