'use strict';
/* ============ 熔爐（正式版：品質勾選路由） ============
   原「新熔爐（測試版）」合併取代舊生產線的輸送帶/篩選節點/分解槽：
   掉落裝備一律經 pushConveyor（factory.js）進入 G.newForge.queue，
   依各熔爐勾選的品質自動送入傳送帶拆解（由右至左入爐），未勾選/上鎖/神鑄創世＝保留入包。

   拆解規則沿用舊分解槽（factory.js doSalvage：碎片/金幣/附魔精華/太古精華與各零件事件），
   零件加成改由「該熔爐零件格」的快照提供（newForgePartBonus）。
   熔爐可設數量與轉生連動（formula.js newForgeMaxFurnaces）；每爐零件格 3~8，
   金幣逐格解鎖（formula.js newForgePartSlotCost）。全服開放（原本地服限定已解除）。 */

function nflog(msg, cls) {
  if (typeof addLog === 'function') addLog('newforge-log', msg, cls, 50);
}

function newForgeState() { return G && G.newForge; }

/* ---- 裝備導入（factory.js pushConveyor 呼叫）：收下回 true；佇列滿載回 false（丟棄） ---- */
function newForgeTryIntake(item) {
  var nf = newForgeState();
  if (!nf) return false;
  if (nf.queue.length >= NEW_FORGE_QUEUE_CAP) return false;
  nf.queue.push(item);
  UI.dirty.newforge = true;
  return true;
}

/* ---- 主迴圈：路由（分派佇列）＋各熔爐入爐，皆以 NEW_FORGE_INTERVAL 為週期 ---- */
function newForgeTick(dt) {
  var nf = newForgeState();
  if (!nf) return;
  nf.routeTimer = (Number(nf.routeTimer) || 0) - dt;
  if (nf.routeTimer <= 0) {
    nf.routeTimer = NEW_FORGE_INTERVAL;
    newForgeRouteQueue();
  }
  for (var i = 0; i < nf.furnaces.length; i++) {
    var fu = nf.furnaces[i];
    fu.timer -= dt * newForgeFurnaceSpeed(fu); // 加速齒輪：縮短入爐間隔
    if (fu.timer > 0) continue;
    fu.timer = NEW_FORGE_INTERVAL;
    newForgeConsumeOne(fu);
  }
}

/* ---- 路由：佇列逐件分派——勾選品質→符合中「帶上件數最少」的熔爐上帶（平均分流）；
   未勾/上鎖/神鑄創世→保留入包；勾選但全部帶滿→留佇列等待（保持順序）。
   平均分流取代先前「第一座優先」：多爐同設定時前面的熔爐會吃光路由額度，
   後面的熔爐長期空帶（佇列卻顯示 +999 大排長龍）。 ---- */
function newForgeAcceptingFurnace(rarity) {
  var nf = newForgeState();
  var best = null, full = false;
  for (var i = 0; i < nf.furnaces.length; i++) {
    var fu = nf.furnaces[i];
    if (!fu.enabled || !fu.qualities[rarity]) continue;
    if (fu.belt.length >= NEW_FORGE_BELT_CAP) { full = true; continue; }
    if (!best || fu.belt.length < best.belt.length) best = fu;
  }
  if (best) return { furnace: best };
  return full ? { wait: true } : null;
}
function newForgeRouteQueue() {
  var nf = newForgeState();
  if (!nf || !nf.queue.length) return;
  var budget = NEW_FORGE_ROUTE_PER_TICK * Math.max(1, nf.furnaces.length);
  var n = 0;
  while (n < budget && nf.queue.length) {
    var it = nf.queue.shift();
    n++;
    UI.dirty.newforge = true;
    if (G.factory && G.factory.autoEquip && tryAutoEquip(it)) continue; // 換下的舊裝經 pushConveyor 回流
    if (!it.locked && it.rarity < GODFORGED_IDX) {
      var hit = newForgeAcceptingFurnace(it.rarity);
      if (hit && hit.furnace) { hit.furnace.belt.push(it); continue; }
      if (hit && hit.wait) { nf.queue.unshift(it); break; } // 帶滿等待，維持先進先出
    }
    // 未勾選/上鎖/神鑄創世 → 保留入包（滿載時 addToInventory 可能改走自動分解，不計入保留）
    if (addToInventory(it)) nf.stats.kept++;
  }
}

/* ---- 各熔爐「尚未進輸送帶」件數：各爐獨立計數——啟用且勾選該品質即計入
  （同一件可同時計入多爐，語意＝排隊等著能進此爐的件數）。
   全量精確計數：顯示端封頂 +9999、tooltip 恆為精確數；
   最壞情況 20,000 件 × 12 爐的掃描遠低於 1ms，無需提前終止。 ---- */
function newForgePendingCounts() {
  var nf = newForgeState();
  var counts = {};
  if (!nf) return counts;
  for (var i = 0; i < nf.queue.length; i++) {
    var it = nf.queue[i];
    if (!it || it.locked || it.rarity >= GODFORGED_IDX) continue;
    for (var j = 0; j < nf.furnaces.length; j++) {
      var fu = nf.furnaces[j];
      if (!fu.enabled || !fu.qualities[it.rarity]) continue;
      counts[fu.id] = (counts[fu.id] || 0) + 1;
    }
  }
  return counts;
}

/* ---- 入爐：帶頭裝備拆解（舊分解槽規則＋該爐零件加成） ---- */
function newForgeConsumeOne(fu) {
  if (!fu.enabled || !fu.belt.length) return;
  var it = fu.belt.shift();
  UI.dirty.newforge = true;
  newForgeSalvage(it, fu);
}

/* ---- 拆解：沿用舊分解槽 doSalvage（碎片/金幣/附魔精華/太古精華、鑲嵌寶石取回、
   零件事件），零件加成以該熔爐零件格快照計算。 ---- */
function newForgeSalvage(it, fu) {
  var res = doSalvage(it, false, function (key) { return newForgePartBonus(fu, key); });
  var nf = newForgeState();
  if (nf) nf.stats.salvaged++;
  UI.dirty.newforge = true;
  return res;
}

/* ---- 帶上裝備退回背包（移除熔爐時呼叫） ---- */
function newForgeBeltRefund(fu) {
  if (!fu || !Array.isArray(fu.belt)) return;
  while (fu.belt.length) {
    var it = fu.belt.shift();
    if (it) addToInventory(it);
  }
  UI.dirty.newforge = true;
}

/* ---- 熔爐增刪（可設數量與轉生連動） ---- */
function addNewForgeFurnace() {
  var nf = newForgeState();
  var allowed = newForgeMaxFurnaces(reincarnationCount());
  if (nf.furnaces.length >= allowed) {
    return nf.furnaces.length >= NEW_FORGE_MAX
      ? '熔爐數量已達上限（' + NEW_FORGE_MAX + ' 座）'
      : '目前轉生可設 ' + allowed + ' 座熔爐（每 1 轉 +1 座，上限 ' + NEW_FORGE_MAX + '）';
  }
  nf.furnaces.push(newForgeDefaultFurnace(nf.nextId++));
  UI.dirty.newforge = true;
  return null;
}
function removeNewForgeFurnace(id) {
  var nf = newForgeState();
  for (var i = 0; i < nf.furnaces.length; i++) {
    if (nf.furnaces[i].id === id) {
      newForgeBeltRefund(nf.furnaces[i]);
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

/* ---- 零件自由裝配（快照式）----
   依「類型」安裝：取玩家持有的該類型最高階零件，複製數值快照 {key,tier,val,name}
   進零件格——不佔用、不消耗零件庫存，同類型可重複裝滿、多座熔爐可共用同一批零件，
   僅零件格數（partSlots，上限 8）為上限。
   全部 10 種分解槽零件皆對該熔爐生效：加速齒輪（入爐速度）走 newForgeFurnaceSpeed，
   其餘產量/事件類經 newForgeSalvage → doSalvage 套用。 ---- */
function newForgeBestOwnedPart(key) {
  var best = null;
  for (var i = 0; i < G.factory.parts.length; i++) {
    var p = G.factory.parts[i];
    if (!p || p.key !== key) continue;
    if (!best || p.tier > best.tier || (p.tier === best.tier && p.val > best.val)) best = p;
  }
  return best;
}
function newForgeInstallPart(furnaceId, partKey) {
  var fu = findNewForgeFurnace(furnaceId);
  if (!fu) return '找不到熔爐';
  if (fu.parts.length >= fu.partSlots) return '零件格已滿（' + fu.parts.length + '/' + fu.partSlots + '，可用金幣解鎖）';
  var pt = PART_TYPES[partKey];
  if (!pt || pt.node !== 'salvage') return '此零件無法安裝到熔爐（僅限分解槽零件）';
  var best = newForgeBestOwnedPart(partKey);
  if (!best) return '尚無此類型零件（野外/高塔掉落自動機組零件）';
  fu.parts.push({ key: best.key, tier: best.tier, val: best.val, name: best.name });
  UI.dirty.newforge = true;
  nflog('🔧 已裝配 ' + best.name + ' 至熔爐 #' + fu.id, 'good');
  return null;
}
function newForgeUninstallPart(furnaceId, slotIdx) {
  var fu = findNewForgeFurnace(furnaceId);
  if (!fu || !fu.parts[slotIdx]) return false;
  var removed = fu.parts.splice(slotIdx, 1)[0];
  UI.dirty.newforge = true;
  nflog('🔧 已卸下 ' + (removed.name || removed.key) + '（熔爐 #' + fu.id + '）', 'info');
  return true;
}
// 該熔爐零件加成：同類型快照堆疊（同舊分解槽 partBonus 計算方式）
function newForgePartBonus(fu, key) {
  var sum = 0;
  for (var i = 0; i < fu.parts.length; i++) {
    var p = fu.parts[i];
    if (p && p.key === key) sum += effectiveFactoryPartValue(p.key, p.val);
  }
  return sum;
}
// 熔爐入爐速度倍率：加速齒輪堆疊
function newForgeFurnaceSpeed(fu) {
  return 1 + newForgePartBonus(fu, 'speedGear') / 100;
}

/* ---- 零件格解鎖：金幣 = 50000×轉生² + 10000×(已解鎖-1)^(4＋熔爐數) ---- */
function unlockNewForgePartSlot(furnaceId) {
  var nf = newForgeState();
  var fu = findNewForgeFurnace(furnaceId);
  if (!fu) return '找不到熔爐';
  if (fu.partSlots >= NEW_FORGE_PART_SLOTS_MAX) return '零件格已達上限（' + NEW_FORGE_PART_SLOTS_MAX + ' 格）';
  var cost = newForgePartSlotCost(reincarnationCount(), fu.partSlots, nf.furnaces.length);
  if (G.player.gold < cost) return '金幣不足（需要 ' + fmt(cost) + '）';
  G.player.gold -= cost;
  fu.partSlots++;
  UI.dirty.header = true;
  UI.dirty.newforge = true;
  nflog('🔓 熔爐 #' + fu.id + ' 零件格已擴充至 ' + fu.partSlots + '/' + NEW_FORGE_PART_SLOTS_MAX + '，消耗金幣 ' + fmt(cost), 'good');
  return null;
}

/* ---- 存檔修正輔助：佇列＋各熔爐帶上裝備（save.js fixSockets/fixName 用） ---- */
function newForgeAllQueuedItems(data) {
  var out = [];
  var nf = data && data.newForge;
  if (!nf) return out;
  (nf.queue || []).forEach(function (it) { if (it) out.push(it); });
  (nf.furnaces || []).forEach(function (fu) {
    (fu && fu.belt || []).forEach(function (it) { if (it) out.push(it); });
  });
  return out;
}

/* ---- 存檔遷移淨化（save.js migrateSave 呼叫；mergeDefaults 已補頂層預設）
   含 V1（furnace.mode）/V2（furnace.lines）→ V3（品質勾選單帶）的一次性形狀轉換，
   以及合併版遷移：舊輸送帶滯留裝備併入佇列、專屬材料/導入開關欄位移除。 ---- */
function sanitizeNewForge(data) {
  if (!data) return;
  if (!data.newForge || typeof data.newForge !== 'object') data.newForge = newGameState().newForge;
  var nf = data.newForge;
  delete nf.intake; // 導入開關已移除：一律導入熔爐
  if (!Array.isArray(nf.queue)) nf.queue = [];
  if (!Array.isArray(nf.furnaces)) nf.furnaces = [];
  var maxId = 0, i, j;

  // V1/V2 → V3 形狀轉換：帶上裝備回佇列、品質承接拆解設定
  //（材料系統已移除，craft/smelt 在途材料不再退款、smelt 批次直接捨棄）
  function qualitiesFromActions(actions) {
    var q = [];
    for (var r = 0; r < RARITIES.length; r++) q.push(Array.isArray(actions) ? actions[r] === 'salvage' : r <= 5);
    return q;
  }
  for (i = 0; i < nf.furnaces.length; i++) {
    var fu = nf.furnaces[i];
    if (!fu || typeof fu !== 'object') { nf.furnaces[i] = newForgeDefaultFurnace(i + 1); continue; }
    if (!Array.isArray(fu.qualities)) {
      var v3 = newForgeDefaultFurnace(Math.max(1, Math.floor(Number(fu.id) || (i + 1))));
      var oldBelt = [];
      if (Array.isArray(fu.lines)) {
        // V2：多傳送帶 → 取第一條拆解線設定；各線帶上裝備拆包回佇列
        var salvLine = null;
        for (j = 0; j < fu.lines.length; j++) {
          var ln = fu.lines[j];
          if (!ln || typeof ln !== 'object') continue;
          if (!salvLine && ln.filter === 'salvage') salvLine = ln;
          (Array.isArray(ln.belt) ? ln.belt : []).forEach(function (e) {
            if (e && typeof e === 'object' && e.item && typeof e.item === 'object') oldBelt.push(e.item);
          });
        }
        if (salvLine && salvLine.salvage) {
          v3.qualities = qualitiesFromActions(salvLine.salvage.actions);
          v3.enabled = salvLine.enabled !== false;
        }
      } else if (fu.salvage && Array.isArray(fu.salvage.actions)) {
        // V1：mode 形狀
        v3.qualities = qualitiesFromActions(fu.salvage.actions);
      }
      // 舊帶上裝備回佇列（重新路由）
      for (j = 0; j < oldBelt.length; j++) nf.queue.push(oldBelt[j]);
      nf.furnaces[i] = v3;
      fu = v3;
    }
    // V3 淨化
    fu.id = Math.max(1, Math.floor(Number(fu.id) || (i + 1)));
    fu.enabled = fu.enabled !== false;
    if (!Array.isArray(fu.qualities)) fu.qualities = newForgeDefaultFurnace(fu.id).qualities;
    for (var r = 0; r < RARITIES.length; r++) fu.qualities[r] = fu.qualities[r] === true;
    fu.qualities[RARITIES.length - 1] = false; // 神鑄創世恆不入帶
    fu.qualities.length = RARITIES.length;
    if (!Array.isArray(fu.belt)) fu.belt = [];
    fu.belt = fu.belt.filter(function (it) { return it && typeof it === 'object' && it.slot && it.rarity !== undefined; });
    if (fu.belt.length > NEW_FORGE_BELT_CAP) {
      while (fu.belt.length > NEW_FORGE_BELT_CAP) nf.queue.push(fu.belt.pop());
    }
    fu.timer = Number(fu.timer) || 0;
    fu.partSlots = clamp(Math.floor(Number(fu.partSlots) || NEW_FORGE_PART_SLOTS_INITIAL), NEW_FORGE_PART_SLOTS_INITIAL, NEW_FORGE_PART_SLOTS_MAX);
    if (!Array.isArray(fu.parts)) fu.parts = [];
    if (fu.id > maxId) maxId = fu.id;
  }
  // 零件快照清理：舊版 id 字串轉快照（查零件池，失效剔除）、壞快照剔除、超量截斷
  (function sanitizeParts() {
    var poolById = {};
    ((data.factory && data.factory.parts) || []).forEach(function (p) { if (p && p.id) poolById[p.id] = p; });
    for (var i2 = 0; i2 < nf.furnaces.length; i2++) {
      var fu2 = nf.furnaces[i2];
      fu2.parts = fu2.parts.map(function (e) {
        if (typeof e === 'string') { // 舊實例制存檔：id → 快照
          var src = poolById[e];
          return src ? { key: src.key, tier: src.tier, val: src.val, name: src.name } : null;
        }
        return e;
      }).filter(function (e) {
        if (!e || typeof e !== 'object') return false;
        var pt = PART_TYPES[e.key];
        if (!pt || pt.node !== 'salvage') return false;
        e.tier = clamp(Math.floor(Number(e.tier) || 1), 1, PART_MAX_TIER);
        e.val = Math.max(0, Number(e.val) || 0);
        e.name = typeof e.name === 'string' ? e.name : (pt.name + ' T' + e.tier);
        return true;
      });
      if (fu2.parts.length > fu2.partSlots) fu2.parts.length = fu2.partSlots;
    }
  })();
  // 可設數量與轉生連動：超額熔爐（含硬上限）自尾端裁減，帶上裝備回佇列
  var reinc = Math.max(0, Math.floor(Number(data.player && data.player.reincarnations) || 0));
  var allowed = newForgeMaxFurnaces(reinc);
  while (nf.furnaces.length > allowed) {
    var drop = nf.furnaces.pop();
    (drop && drop.belt || []).forEach(function (it) { if (it) nf.queue.push(it); });
  }
  // 舊輸送帶已關閉：滯留裝備併入熔爐佇列（超出佇列上限的尾端捨棄，同舊滿載規則）
  if (data.factory && Array.isArray(data.factory.conveyor)) {
    while (data.factory.conveyor.length) nf.queue.push(data.factory.conveyor.shift());
  }
  if (nf.queue.length > NEW_FORGE_QUEUE_CAP) nf.queue.length = NEW_FORGE_QUEUE_CAP;
  // 舊分解槽節點已移除：解除其上零件安裝（零件本就留在零件庫，改由各熔爐零件格提供加成）
  if (data.factory && data.factory.installed && Array.isArray(data.factory.installed.salvage)) {
    data.factory.installed.salvage.length = 0;
  }
  nf.nextId = Math.max(Math.floor(Number(nf.nextId) || 1), maxId + 1);
  nf.routeTimer = Number(nf.routeTimer) || 0;
  if (!nf.stats || typeof nf.stats !== 'object') nf.stats = {};
  nf.stats = {
    salvaged: Math.max(0, Math.floor(Number(nf.stats.salvaged) || 0)),
    kept: Math.max(0, Math.floor(Number(nf.stats.kept) || 0))
  };
  // 專屬材料系統已移除：清除舊材料計數欄位
  if (data.player && data.player.forgeMats !== undefined) delete data.player.forgeMats;
  // 改版公告旗標（migrateSave 對合併前存檔另行設為 false → 彈窗＋頁籤閃爍）
  nf.noticeShown = nf.noticeShown === true;
  nf.tabSeen = nf.tabSeen === true;
}
