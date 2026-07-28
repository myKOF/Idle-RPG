'use strict';
/* ============ 模擬 Worker ============
   遊戲狀態 G 與主迴圈的唯一所在地。主執行緒只保留 DOM、事件、渲染與儲存 I/O。

   載入順序不可調換：
     protocol.js  訊息與指令契約
     shim.js      window / document / UI.dirty / blog / recordLoot* 替身
     模擬層 17 支 依照 index.html 原本的順序（有相依關係）

   模擬層檔案一律原封不動載入，不得在此改寫其行為——那 17 支同時是 116 支
   既有測試的受測對象。 */

importScripts('protocol.js', 'shim.js');
importScripts(
  '../util.js', '../data.js', '../formula.js', '../stats.js', '../item.js',
  '../skills.js', '../talents.js', '../player.js', '../special_rules.js',
  '../combat.js', '../legendary.js', '../potential.js', '../tower.js',
  '../factory.js', '../newforge.js', '../forge.js', '../save.js'
);
/* GM 指令執行層。面板留在主執行緒（js/gm.js），執行層必須在狀態所在的這一側。
   它自己會擋非本機 hostname；Worker 的 location 是本檔的 URL，判定結果與主執行緒一致。 */
importScripts('../gm_exec.js');

/* ---- 節奏參數（語意同 main.js，不得擅改）---- */
var TICK_MS = 100;          // 模擬步長
var TICK_EMIT_MS = 200;     // 對主執行緒送 tick 的間隔（5Hz）
var AUTOSAVE_SEC = 15;      // 自動存檔
var FOLDER_AUTOSAVE_SEC = 600;
var BG_SUSPEND_AFTER_MS = 60000;
var MAX_CATCHUP_SEC = 10;   // 單次最多補 10 秒，更長交給離線收益

var _booted = false;
var _loopTimer = 0;
var _lastTickAt = 0;
var _emitAcc = 0;
var _autosaveAcc = 0;
var _folderAcc = 0;
var _hiddenAt = 0;
var _persistSeq = 0;
var _pendingPersist = {};   // token -> kind，等主執行緒回 saveResult
/* 重新開局送出後到頁面真的重載之間，這顆 Worker 的 G 仍是「舊局」。
   期間任何一次自動存檔／關閉落地都會把舊局寫回同一個 auto_current，蓋掉新局。 */
var _restarting = false;
var _maxRunId = 1;          // 由 boot 帶入；重新開局時用來決定新局編號

/* ---- 訊息量測（P4 用，預設關閉）----
   量測本身會扭曲被量測的對象：為了算 payload 大小而做一次 JSON.stringify，
   成本可能比訊息本身還高。所以只在 Worker URL 帶 ?measure=1 時才啟用，
   平常完全不付這個代價。

   兩個數字量的是不同東西，不要混用：
   - bytes：JSON 位元組數，只是**規模的代理指標**。postMessage 走的是 structured
     clone，不是 JSON，實際成本與此不成正比。
   - postMs：postMessage 呼叫本身的耗時，包含 structured clone，這才是真實成本。 */
var MEASURE = (typeof location !== 'undefined') && /[?&]measure=1(&|$)/.test(location.search || '');
var MEASURE_STATS = Object.create(null);

function measureRecord(type, payload, postMs) {
  var s = MEASURE_STATS[type];
  if (!s) s = MEASURE_STATS[type] = { count: 0, bytes: 0, maxBytes: 0, postMs: 0, maxPostMs: 0 };
  s.count++;
  s.postMs += postMs;
  if (postMs > s.maxPostMs) s.maxPostMs = postMs;
  try {
    var bytes = JSON.stringify(payload).length;
    s.bytes += bytes;
    if (bytes > s.maxBytes) s.maxBytes = bytes;
  } catch (e) { /* 無法序列化就只記時間 */ }
}

function measureSnapshot() {
  if (!MEASURE) return null;
  var out = Object.create(null);
  for (var type in MEASURE_STATS) {
    var s = MEASURE_STATS[type];
    out[type] = {
      count: s.count,
      avgBytes: Math.round(s.bytes / s.count),
      maxBytes: s.maxBytes,
      avgPostMs: +(s.postMs / s.count).toFixed(3),
      maxPostMs: +s.maxPostMs.toFixed(3)
    };
  }
  return out;
}

function post(type, payload) {
  payload = payload || {};
  payload.type = type;
  if (!MEASURE) { self.postMessage(payload); return; }
  var t0 = performance.now();
  self.postMessage(payload);
  measureRecord(type, payload, performance.now() - t0);
}

function reportError(where, err) {
  post(MSG_OUT.ERROR, {
    where: where,
    message: err && err.message ? err.message : String(err),
    stack: err && err.stack ? String(err.stack) : ''
  });
}

/* ---- 背景休眠 ----
   Web Worker 不能豁免瀏覽器背景節流，所以 main.js 的補償語意必須原樣保留：
   隱藏未滿 60 秒維持即時模擬，逾時停止推進，回前景改由離線收益結算。

   迷你監控視窗（PiP）開著時不休眠——玩家是刻意開它來邊做別的事邊看戰鬥的，
   這時分頁雖然隱藏，但畫面確實在被觀看。PiP 是主執行緒狀態，由 bridge 隨
   visibility 訊息傳進來（見 js/bridge.js 的 miniMonitorActive）。 */
var _pipActive = false;

function backgroundSuspended() {
  if (_pipActive) return false; // PiP 觀戰中，維持即時模擬
  return _hiddenAt > 0 && (Date.now() - _hiddenAt) >= BG_SUSPEND_AFTER_MS;
}

/* ---- 由 ui.js 搬回 Worker 的狀態維護 ----
   這三段原本寫在渲染函式裡，等於「畫面更新時順便改存檔」。渲染有副作用本身就是問題：
   切到別的頁籤就不會發生，開了 PiP 又會重複發生。狀態維護屬於模擬層，搬回這裡。
   P3 請把 ui.js 對應的那幾段刪掉，只保留讀取。 */

/* 資源列首次顯示旗標：數量大於 0 就永久解鎖（原 ui.js renderHeader 內）。
   鍵名沿用 DOM id（r-essence…），因為既有存檔就是這樣存的，不能為了好看而破壞相容。 */
var SHOWN_RES_KEYS = [
  ['r-essence', 'essence'], ['r-dust', 'dust'], ['r-ancient-essence', 'ancientEssence'],
  ['r-soul-origin', 'soulOrigin'], ['r-demon-seed', 'demonSeed']
];

function updateShownRes() {
  var p = G && G.player;
  if (!p) return;
  if (!p.shownRes) p.shownRes = {};
  for (var i = 0; i < SHOWN_RES_KEYS.length; i++) {
    if ((p[SHOWN_RES_KEYS[i][1]] || 0) > 0) p.shownRes[SHOWN_RES_KEYS[i][0]] = true;
  }
  if (typeof totalGemsAll === 'function' && totalGemsAll() > 0) p.shownRes['r-gems'] = true;
  var books = 0;
  for (var bk in p.books) books += p.books[bk] || 0;
  if (books > 0) p.shownRes['r-books'] = true;
}

/* 鑲孔補齊：舊存檔的裝備可能缺 sockets 欄位。原本靠 ui.js 渲染詳情時才補
   （`ensureSockets(it)`），代表沒點開過的裝備永遠不會被補到，鑲孔數也就時有時無。
   改在讀檔後一次補齊全部裝備。 */
function backfillItemSockets() {
  if (typeof ensureSockets !== 'function' || !G) return;
  var seen = [];
  function walk(list) {
    if (!list) return;
    for (var k in list) {
      var it = list[k];
      if (it && it.id && seen.indexOf(it) === -1) { seen.push(it); ensureSockets(it); }
    }
  }
  walk(G.inventory);
  walk(G.equipment);
  if (Array.isArray(G.equipmentSets)) G.equipmentSets.forEach(walk);
}

/* 寶石商店維護：首次鋪貨與 8 小時定時重置。
   原本由 UI 呼叫 rollGemShop / shopHourlyReset（兩者都在 INTERNAL_ONLY 名單上），
   等於「有沒有打開寶石頁」決定商店會不會刷新。移到這裡由模擬層自己維護。

   首次鋪貨的條件是 items 為空。買光不會讓它變空——buyShopGem 是設 item.sold = true
   而非移除項目（item.js:318），所以不會出現免費重刷。 */
function maintainGemShop() {
  if (typeof gemShop !== 'function') return;
  if (typeof shopHourlyReset === 'function') shopHourlyReset();
  var s = gemShop();
  if (typeof rollGemShop === 'function' && (!s.items || !s.items.length)) {
    rollGemShop();
    UI.dirty.gems = true;
  }
}

/* 神鑄開放公告：原本由 uiTick 偵測並寫旗標。改由 Worker 在解鎖當下設旗標並送一次事件，
   UI 只負責顯示。旗標寫在存檔裡，所以只會提示一次。 */
function checkForgeUnlockNotice() {
  if (typeof forgeUnlocked !== 'function' || !forgeUnlocked()) return;
  var fs = forgeState();
  if (fs.unlockNotified) return;
  fs.unlockNotified = true;
  UI.dirty.header = true;
  shimPushEvent('notice', { key: 'forgeUnlocked', modal: true });
}

function simStep(dt) {
  var combatPaused = typeof isCombatPaused === 'function' && isCombatPaused();
  if (!combatPaused) GT += dt;
  if (typeof forgeTick === 'function') forgeTick(Date.now());
  if (!combatPaused) {
    if (typeof fieldTick === 'function') fieldTick(dt);
    if (typeof towerTick === 'function') towerTick(dt);
  }
  if (typeof factoryTick === 'function') factoryTick(dt);
  if (typeof newForgeTick === 'function') newForgeTick(dt);
}

function loop() {
  if (!_booted) return;
  try {
    var now = Date.now();
    if (backgroundSuspended()) { _lastTickAt = now; return; }
    var elapsed = (now - _lastTickAt) / 1000;
    _lastTickAt = now;
    elapsed = Math.min(elapsed, MAX_CATCHUP_SEC);
    var stepped = 0;
    while (elapsed > 0.0001) {
      var dt = Math.min(elapsed, TICK_MS / 1000);
      simStep(dt);
      elapsed -= dt;
      stepped += dt;
    }

    _emitAcc += stepped;
    if (_emitAcc >= TICK_EMIT_MS / 1000) {
      _emitAcc = 0;
      updateShownRes();
      maintainGemShop();
      checkForgeUnlockNotice();
      emitTick();
    }

    _autosaveAcc += stepped;
    if (_autosaveAcc >= AUTOSAVE_SEC) { _autosaveAcc = 0; requestPersist(PERSIST_KINDS.AUTO); }

    _folderAcc += stepped;
    if (_folderAcc >= FOLDER_AUTOSAVE_SEC) { _folderAcc = 0; requestPersist(PERSIST_KINDS.FOLDER); }
  } catch (e) {
    reportError('loop', e);
  }
}

/* ---- 高頻視圖 ----
   只放 TICK_VIEW_KEYS 列出的純量。背包、技能樹等大型結構一律走 panel。 */
function buildView() {
  var p = (G && G.player) || {};
  var st = (G && G.stage) || {};
  var fp = (typeof FIELD !== 'undefined' && FIELD) ? FIELD.player : null;
  var stats = (typeof getStats === 'function') ? getStats() : null;
  // 附魔書在狀態裡是每種一格的物件；頂欄只顯示總數，別把整個物件塞進高頻視圖
  var bookTotal = 0;
  for (var bk in p.books) bookTotal += p.books[bk] || 0;
  return {
    gold: p.gold || 0,
    scrap: p.scrap || 0,
    essence: p.essence || 0,
    dust: p.dust || 0,
    ancientEssence: p.ancientEssence || 0,
    soulOrigin: p.soulOrigin || 0,
    demonSeed: p.demonSeed || 0,
    gems: (typeof totalGemsAll === 'function') ? totalGemsAll() : 0,
    books: bookTotal,
    level: p.level || 0,
    xp: p.xp || 0,
    xpMax: (typeof xpForLevel === 'function') ? xpForLevel(p.level || 1) : 0,
    hp: fp ? fp.hp : 0,
    hpMax: stats ? stats.hp : 0,
    mp: fp ? fp.mp : 0,
    mpMax: stats ? stats.mp : 0,
    shield: fp ? fp.shield : 0,
    stage: st.current || 0,
    zone: st.zone || '',
    gt: GT,
    paused: typeof isCombatPaused === 'function' ? !!isCombatPaused() : false,
    towerActive: !!(G && G.tower && G.tower.active),
    forgeBusy: typeof forgeIsBusy === 'function' ? !!forgeIsBusy() : false
  };
}

function emitTick() {
  post(MSG_OUT.TICK, {
    view: buildView(),
    dirty: shimDrainDirty(),
    events: shimDrainEvents(),
    diag: shimDiagSnapshot(),
    measure: measureSnapshot()
  });
}

/* ---- 面板資料 ----
   P4 會依實測結果再裁切；目前先給該面板需要的狀態切片，不整份丟。 */
/* ---- 背包投影 ----
   背包格子只用到 7 個直接欄位，加上 itemEnchants() 的 enchant/enchants
   與 ancientStarBadgeHTML() 需要的太古詞條數。詞條本身不送：
   實測後期存檔 800 件完整資料 305 KB，投影後 122 KB（少 60%），
   而保留 affixes 只能少 17%——詞條就是主體。

   需要完整資料的地方（詳情面板、格子 tooltip）改用 params.detailIds 按需索取。 */
var INV_CELL_FIELDS = ['id', 'rarity', 'slot', 'level', 'upgrade', 'synthesized',
                       'locked', 'name', 'weaponType', 'enchant', 'enchants', 'kind'];
var INV_DETAIL_MAX = 200; // 單次索取明細的上限，避免一次要回整包

function inventoryCellView(it) {
  var out = {};
  for (var i = 0; i < INV_CELL_FIELDS.length; i++) {
    var f = INV_CELL_FIELDS[i];
    if (it[f] !== undefined) out[f] = it[f];
  }
  /* getItemAncientCount 住在 item.js（importScripts 順序在本檔之前），直接呼叫。
     這裡傳的是真實物品（有 affixes、沒有 ancientCount），走的是逐條計數那條路徑；
     item.js 裡的 ancientCount 短路分支是給主執行緒讀投影用的。 */
  out.ancientCount = getItemAncientCount(it);
  return out;
}

function buildInventoryPanel(params) {
  var items = Array.isArray(G.inventory) ? G.inventory : [];
  var details = null;
  var i, j;

  /* params.full：一次要回全部裝備的完整資料。
     這是給關鍵字搜尋用的——它要比對詞條、傳奇特效、太古詞條，就是投影裁掉的那些。
     關鍵字篩選只在內網／本機出現（ui.js 的 isInternalServer()），正式環境的玩家
     看不到那個輸入框，所以這條路徑不會落到玩家身上。
     ⚠️ 不要為了搜尋把這些欄位加回投影：實測加回 affixes 後裁切效益從 56% 掉到 17%。 */
  if (params && params.full === true) {
    details = {};
    for (j = 0; j < items.length; j++) if (items[j]) details[items[j].id] = items[j];
  } else {
    var ids = params && params.detailIds;
    if (Array.isArray(ids) && ids.length) {
      details = {};
      var wanted = {};
      for (i = 0; i < ids.length && i < INV_DETAIL_MAX; i++) wanted[ids[i]] = true;
      for (j = 0; j < items.length; j++) {
        if (items[j] && wanted[items[j].id]) details[items[j].id] = items[j];
      }
    }
  }

  return {
    items: items.map(inventoryCellView),
    details: details,
    count: items.length,
    cap: inventoryCapacityNow(),
    settings: G.settings,                     // compareEq：詳情是否顯示與現有裝備的比較
    equipment: G.equipment,                   // 比較對象＝目前穿戴那套
    viewEquipment: (typeof viewedEquipment === 'function') ? viewedEquipment() : G.equipment
  };
}

function buildPanel(name, params) {
  if (!G) return null;
  var p = G.player || {};
  switch (name) {
    case 'header':
      /* stats 是使用中那套的屬性；viewStats 是面板檢視中那套（未穿上時的預覽）。
         兩者在檢視使用中那套時是同一份，getViewStats 內部會直接回 getStats。
         dps 取自 FIELD.dpsWindow（最多 10 筆），成本可忽略。 */
      return {
        player: p, stage: G.stage,
        stats: (typeof getStats === 'function') ? getStats() : null,
        viewStats: (typeof getViewStats === 'function') ? getViewStats() : null,
        dps: (typeof currentDps === 'function') ? currentDps() : 0,
        settings: G.settings,
        autoEquip: !!(G.factory && G.factory.autoEquip),
        equipView: G.equipView, equipActive: G.equipActive
      };
    case 'battle':
      return {
        field: (typeof FIELD !== 'undefined') ? FIELD : null,
        tower: (typeof TOWER !== 'undefined') ? TOWER : null,
        stage: G.stage, zoneProgress: G.zoneProgress,
        runStats: self.RUN_STATS || null, lootStats: self.LOOT_STATS || null
      };
    case 'equip':
      return {
        equipment: G.equipment, sets: G.equipmentSets, equipSetNames: G.equipSetNames,
        equipActive: G.equipActive, equipView: G.equipView,
        settings: G.settings,
        stats: (typeof getStats === 'function') ? getStats() : null,
        viewStats: (typeof getViewStats === 'function') ? getViewStats() : null
      };
    case 'inv':
      return buildInventoryPanel(params);
    case 'forge':
      return { forge: (typeof forgeState === 'function') ? forgeState() : G.forge };
    case 'newforge':
      return { newForge: G.newForge };
    case 'factory':
      return { factory: G.factory, salvageSettings: p.salvageSettings };
    case 'tower':
      return { tower: G.tower, runtime: (typeof TOWER !== 'undefined') ? TOWER : null };
    case 'gems':
      // 一般寶石是 { type: { lv: n } } 計數；融合寶石才是個別實體
      return {
        gems: p.gems, fusedGems: p.fusedGems,
        shop: (typeof gemShop === 'function') ? gemShop() : p.gemShop
      };
    case 'skills':
      return {
        skills: p.skills, unlocks: p.skillUnlocks, loadout: p.loadout,
        fusions: p.fusions, points: p.skillPoints, budget: p.skillPointBudget
      };
    case 'talents':
      // 天賦與潛能等級都在 player.talents 底下（levels / potentialLevels）
      return {
        talents: p.talents, reincarnations: p.reincarnations,
        talentPoints: p.reincarnationTalentPoints
      };
    default: return null;
  }
}

/* ---- 存檔 ----
   序列化在 Worker，落地在主執行緒。savedAt 只能在收到 saveResult{ok:true} 後才算數，
   否則寫入失敗時離線結算的基準會錯位，造成收益漏算或重複結算。 */
function requestPersist(kind, opts) {
  if (!G) return null;
  if (_restarting && kind !== PERSIST_KINDS.RESTART) return null;
  opts = opts || {};
  try {
    var token = 'p' + (++_persistSeq);
    var prevSavedAt = G.savedAt;
    var state = opts.state || G;
    if (state === G) G.savedAt = Date.now();
    var json = JSON.stringify(state);
    // meta 用模擬層既有的 saveRecMeta 產生（只讀 G、不碰儲存），主執行緒不必再自行推算
    var meta = opts.meta || saveRecMeta('auto', 'auto_current', AUTO_FOLDER_FILE_V2);
    _pendingPersist[token] = { kind: kind, savedAt: G.savedAt, prevSavedAt: prevSavedAt, rollback: state === G };
    post(MSG_OUT.PERSIST, { token: token, kind: kind, payload: { json: json, meta: meta } });
    return meta;
  } catch (e) {
    reportError('requestPersist', e);
    return null;
  }
}

/* ---- 儲存 I/O 攔截 ----
   模擬層有 53 處 localStorage 呼叫，全部集中在 save.js 這幾個函式裡。
   Worker 不能碰儲存，但也不該去改 save.js（那 17 支是 116 支既有測試的受測對象）。
   作法：載入後就地換掉這幾個全域函式，讓它們改發 persist 訊息。
   模擬層其他地方照常呼叫 saveGame()，行為維持不變，只是落地端換人。

   沒被攔截到的漏網路徑會撞上 shim.js 的 localStorage 陷阱並拋出明確錯誤，
   不會靜靜寫進一個不會落地的地方。 */
function installStorageGuards() {
  self.saveGame = function () {
    requestPersist(PERSIST_KINDS.AUTO);
    return true;
  };

  self.syncSaveFolder = function () {
    requestPersist(PERSIST_KINDS.FOLDER);
    return Promise.resolve(true);
  };

  function buildManualMeta(label) {
    var prefix = label ? String(label).replace(/[^a-z0-9_-]+/ig, '_') : 'manual';
    return saveRecMeta('manual', 'manual_' + Date.now().toString(36) + '_' + ri(100, 999),
      'IC_' + prefix + '_' + saveStamp(Date.now()) + '.json');
  }

  /* 一般手動存檔：未連接資料夾時仍要落地（舊路徑是寫進瀏覽器存檔記錄）。
     一鍵分解前的保護存檔走的就是這條，不能因為沒接資料夾就靜靜消失。 */
  self.manualSave = function (label) {
    var meta = buildManualMeta(label);
    requestPersist(PERSIST_KINDS.MANUAL, { meta: meta });
    return meta;
  };

  /* 明確「另存到資料夾」：沒接資料夾就該失敗，不要偷偷存到別的地方 */
  self.createManualSaveToFolderV2 = function (label) {
    var meta = buildManualMeta(label);
    requestPersist(PERSIST_KINDS.MANUAL_FOLDER, { meta: meta });
    return meta;
  };

  /* 重新開局。
     ⚠️ 這裡刻意「不」先存一次舊局：舊局與新局的落地目標是同一個 auto_current
     （IndexedDB 同一個 key、資料夾同一個 IC_autosave.json），先存舊局並不會保住它，
     只會和新局的寫入賽跑——實測舊局的非同步寫入在新局完成後 7ms 才落地，直接蓋掉新局，
     玩家按下重新開局後重載回來看到的仍是舊存檔。 */
  self.restartGame = function () {
    _restarting = true;
    var fresh = newGameState();
    fresh.runId = Math.max(_maxRunId, G.runId || 1) + 1; // 新局換一個局號，舊局的手動存檔不受影響
    fresh.savedAt = Date.now();
    /* saveRecMeta 是從 G 現場取值，而此刻 G 仍是舊局——直接沿用會讓存檔索引
       標成「等級 13、第 7 關」卻配著一份全新存檔。meta 必須描述 fresh。 */
    var meta = saveRecMeta('auto', 'auto_current', AUTO_FOLDER_FILE_V2);
    meta.runId = fresh.runId;
    meta.savedAt = fresh.savedAt;
    meta.level = fresh.player.level;
    meta.stage = (fresh.stage && fresh.stage.current) || 1;
    meta.zone = (fresh.stage && fresh.stage.zone) || 'plains';
    requestPersist(PERSIST_KINDS.RESTART, { state: fresh, meta: meta });
    return true;
  };

  // 讀檔一律由主執行緒讀出後以 boot / load 訊息送進來
  self.loadGame = function () { return null; };
  self.loadLatestFolderSave = function (cb) { if (cb) cb(null); };
}

function onSaveResult(msg) {
  var rec = _pendingPersist[msg.token];
  if (!rec) return;
  delete _pendingPersist[msg.token];
  /* 重新開局寫入失敗時不會 reload，這顆 Worker 得繼續活下去——
     若不解除 _restarting，之後的自動存檔會全部被靜靜丟掉。 */
  if (rec.kind === PERSIST_KINDS.RESTART && !msg.ok) {
    _restarting = false;
    shimPushEvent('log', { msg: '⚠️ 重新開局失敗：' + (msg.error || '未知原因'), cls: 'warn' });
  }
  if (!msg.ok && G && rec.rollback) {
    // 落地失敗：把 savedAt 退回上一次成功的值，讓下次離線結算仍以真正落地的時間點為準
    G.savedAt = rec.prevSavedAt;
    shimPushEvent('log', { msg: '⚠️ 存檔寫入失敗：' + (msg.error || '未知原因'), cls: 'warn' });
  }
}

/* ---- 指令 ----
   跨執行緒不能傳物件參考，所以 itemId / gemId / partId 在此解析回物件後，
   再呼叫模擬層原本的函式。

   ⚠️ P3 注意：以下用「spec.args 的鍵順序 = 原函式參數順序」做通用派送。
   多數指令成立，但吃 eq、ref 等特殊參數的（equipItem、fuseGemsV2、
   forgePlaceItem、newForgeInstallPart…）必須逐一核對簽章後補上專屬轉接，
   不要假設通用路徑一定對。 */
/* 由 id 找出物件。搜尋範圍刻意限定「背包 + 目前穿戴的裝備欄」，與 ui.js 的
   findItemById 一致（不含神鑄法陣槽位——那邊要用 slotIndex 取回）。

   存檔會同時序列化 G.equipment 與 active 的 G.equipmentSets，同一件裝備可能有兩份
   同 id 的複本。命中多個代表兩端指的不是同一個物件，這種情況一律拒絕執行，
   不猜——猜錯會複製或吃掉玩家的裝備。 */
function resolveItem(id) {
  if (!id || !G) return { err: 'bad item id' };
  var hits = [];
  var i;
  if (Array.isArray(G.inventory)) {
    for (i = 0; i < G.inventory.length; i++) {
      if (G.inventory[i] && G.inventory[i].id === id) hits.push(G.inventory[i]);
    }
  }
  var eq = G.equipment || {};
  for (var s in eq) if (eq[s] && eq[s].id === id) hits.push(eq[s]);

  if (!hits.length) return { err: 'item not found: ' + id };
  for (i = 1; i < hits.length; i++) {
    // 同一個物件被兩處參考（背包與裝備欄指向同一份）不算歧義
    if (hits[i] !== hits[0]) return { err: 'ambiguous item id: ' + id + '（命中 ' + hits.length + ' 個）' };
  }
  return { item: hits[0] };
}

/* ============ fn:null 指令的 Worker 端實作 ============
   協議裡 fn 為 null 的指令，代表沒有一個既有函式可以直接呼叫：邏輯目前散在 ui.js 裡，
   而且多半不只一步（裝備要先從背包移除、換下來的要退回背包）。這些必須搬進 Worker
   成為單一原子操作，否則指令中途的狀態會被下一個 tick 看見。

   實作原則：
   - 行為與 ui.js 現況**逐行對齊**，這是遷移不是改版；發現可疑之處記錄下來，不順手改
   - 只做狀態轉移，畫面回饋（浮動文字、彈窗）留給主執行緒依 ack 與事件處理
   - 領域層面的拒絕（背包滿、金幣不足）回傳 { err }，不丟例外；
     丟例外保留給協議層面的錯誤（找不到物件、參數非法） */

/* 操作對象是「檢視中那套」裝備，與 ui.js 的 viewedEquipment() 同語意。
   G.equipView 存在狀態裡，所以 Worker 這邊有完整保真度。 */
function targetEquipment(setIndex) {
  if (typeof setIndex === 'number' && typeof equipmentSetAt === 'function') {
    return equipmentSetAt(setIndex);
  }
  return (typeof viewedEquipment === 'function') ? viewedEquipment() : G.equipment;
}

function mustResolve(id) {
  var r = resolveItem(id);
  if (r.err) throw new Error(r.err);
  return r.item;
}

function inventoryCapacityNow() {
  return (typeof inventoryCapacityWithTalents === 'function')
    ? inventoryCapacityWithTalents()
    : INVENTORY_CAP + (G.player.invUpgrades || 0);
}

var COMMAND_IMPL = {
  /* ---- 關卡 ---- */
  'stage.setAutoAdvance': function (a) {
    G.stage.autoAdvance = !!a.on;
    UI.dirty.battle = true;
    return true;
  },

  /* ---- 裝備、背包 ---- */
  'item.equip': function (a) {
    var it = mustResolve(a.itemId);
    var eq = targetEquipment(a.setIndex);
    var idx = G.inventory.indexOf(it);
    if (idx >= 0) G.inventory.splice(idx, 1);
    var old = equipItem(it, a.slotKey || null, eq);
    if (old) { old.locked = false; addToInventory(old); } // 換下來的解鎖後退回背包
    UI.dirty.inv = true; UI.dirty.equip = true; UI.dirty.header = true;
    return { equipped: it.id, replaced: old ? old.id : null };
  },

  'item.unequip': function (a) {
    var it = mustResolve(a.itemId);
    if (G.inventory.length >= inventoryCapacityNow()) {
      blog('⚠️ 背包已滿，無法卸下', 'warn');
      return { err: '背包已滿' };
    }
    var eq = targetEquipment();
    // 依 id 找出實際佔用的欄位：武器與戒指有主副兩欄，不能只看 slotKey
    for (var sk in eq) {
      if (eq[sk] && eq[sk].id === it.id) { eq[sk] = null; break; }
    }
    if (eq === G.equipment) markStatsDirty(); // 只有動到使用中那套才需要重算
    addToInventory(it);
    UI.dirty.inv = true; UI.dirty.equip = true; UI.dirty.header = true;
    return { unequipped: it.id };
  },

  'item.setLock': function (a) {
    var it = mustResolve(a.itemId);
    it.locked = !!a.locked;
    UI.dirty.inv = true; UI.dirty.equip = true;
    return { id: it.id, locked: it.locked };
  },

  'item.salvage': function (a) {
    var it = mustResolve(a.itemId);
    var idx = G.inventory.indexOf(it);
    if (idx < 0) return { err: '該裝備不在背包中' };
    G.inventory.splice(idx, 1);
    var res = doSalvage(it);
    UI.dirty.inv = true;
    return res;
  },

  /* 一鍵分解。整段邏輯原本寫在 ui.js:2119 salvageAllUnlocked，含分解前自動存檔。
     分解前存檔是刻意的保護，搬過來時必須保留。 */
  'item.salvageBulk': function (a) {
    var maxRarity = a.maxRarity, maxLevel = a.maxLevel, maxAncient = a.maxAncient;
    var hasRarityLimit = typeof maxRarity === 'number' && !isNaN(maxRarity) && maxRarity >= 0;
    var hasLevelLimit = typeof maxLevel === 'number' && !isNaN(maxLevel) && maxLevel > 0;
    var hasAncientLimit = typeof maxAncient === 'number' && !isNaN(maxAncient) && maxAncient >= 0;
    var kept = [], targets = [], count = 0, scrap = 0;

    G.inventory.forEach(function (it) {
      if (it.locked) { kept.push(it); return; }
      if (hasRarityLimit && it.rarity > maxRarity) { kept.push(it); return; }
      if (hasLevelLimit && it.level > maxLevel) { kept.push(it); return; }
      if (hasAncientLimit && getItemAncientCount(it) > maxAncient) { kept.push(it); return; }
      targets.push(it);
    });

    if (targets.length) {
      var rec = manualSave('before_bulk_salvage'); // 已被 installStorageGuards 導向 persist
      if (rec) flog('💾 已建立拆解前存檔：' + rec.fname, 'info');
    }
    targets.forEach(function (it) {
      var res = doSalvage(it, true);
      scrap += res.scrap;
      count++;
    });
    G.inventory = kept;
    if (count) flog('⚒️ 一鍵分解 ' + count + ' 件 → 碎片x' + fmt(scrap), 'info');
    UI.dirty.inv = true;
    return { count: count, scrap: scrap };
  },

  /* ---- 角色 ---- */
  'player.renameEquipSet': function (a) {
    if (!Array.isArray(G.equipmentSets)) return { err: '沒有裝備套資料' };
    var idx = clamp(Math.floor(Number(a.index) || 0), 0, G.equipmentSets.length - 1);
    if (!equipmentSetUnlocked(idx)) return { err: '該裝備套尚未解鎖' };
    if (!Array.isArray(G.equipSetNames)) G.equipSetNames = [];
    G.equipSetNames[idx] = String(a.name == null ? '' : a.name).trim().slice(0, 12); // 上限 12 字
    UI.dirty.equip = true;
    return { index: idx, name: G.equipSetNames[idx] };
  },

  'player.buyInvUpgrade': function () {
    var upg = G.player.invUpgrades || 0;
    if (INVENTORY_CAP + upg >= INVENTORY_MAX) {
      blog('❌ 背包已達最大容量 ' + INVENTORY_MAX + ' 格，無法再擴充', 'warn', 'system');
      return { err: '已達最大容量' };
    }
    var cost = inventoryExpandCost(upg);
    if (G.player.gold < cost) {
      blog('❌ 金幣不足，擴充需要 ' + fmt(cost) + ' 金幣', 'warn', 'system');
      return { err: '金幣不足' };
    }
    G.player.gold -= cost;
    G.player.invUpgrades = upg + 1;
    blog('✅ 背包容量已擴充至 ' + (INVENTORY_CAP + G.player.invUpgrades), 'good', 'system');
    UI.dirty.inv = true; UI.dirty.header = true;
    return { cap: INVENTORY_CAP + G.player.invUpgrades, cost: cost };
  },

  /* 排序模式索引存在存檔裡，但模式清單是 UI 的知識，所以由主執行緒指定索引 */
  'player.setInvSort': function (a) {
    G._invSortIdx = Math.max(0, Math.floor(a.index));
    UI.dirty.inv = true;
    return { index: G._invSortIdx };
  },

  /* ---- 技能 ---- */
  'skill.reorderLoadout': function (a) {
    var lo = G.player.loadout || [];
    var from = a.from, to = a.to;
    if (from < 0 || from >= lo.length || from === to) return { err: '位置無效' };
    var moved = lo.splice(from, 1)[0];
    if (to >= lo.length) lo.push(moved);
    else lo.splice(to, 0, moved);
    G.player.loadout = lo;
    UI.dirty.skills = true; UI.dirty.battle = true;
    return { loadout: lo.slice() };
  },

  /* ---- 神鑄 ---- */
  'forge.setAuto': function (a) {
    forgeState()[a.key] = !!a.on; // key 已由協議的 enum 白名單擋過
    UI.dirty.forge = true;
    return true;
  },

  'forge.setAutoFill': function (a) {
    var fst = forgeState();
    if (a.kind === 'clear') {
      fst.autoFill = null;
      blog('🔁 神鑄自動放入已取消', 'info');
      UI.dirty.forge = true;
      return { autoFill: null };
    }
    var pick = (a.kind === 'gem')
      ? { kind: 'gem', type: a.gemType, level: a.gemLevel }
      : { kind: 'equip', rarity: a.rarity };
    if (forgeItemCount() > 0) forgeUnloadAll(); // 先清空法陣再放入指定素材
    fst.autoFill = pick;
    var err = forgeAutoFillApply();
    if (err) {
      fst.autoFill = null;
      blog('⚠️ 神鑄自動放入：' + err, 'warn');
      UI.dirty.forge = true;
      return { err: err };
    }
    blog('🔁 神鑄自動放入已啟用：' + forgeAutoFillLabel() +
      '（每次鑄造後自動補放 6 件，數量不足自動停止）', 'good');
    UI.dirty.forge = true;
    return { autoFill: pick };
  },

  /* ---- 熔爐 ---- */
  'newforge.setQuality': function (a) {
    var fu = findNewForgeFurnace(a.furnaceId);
    if (!fu) return { err: '找不到熔爐 ' + a.furnaceId };
    if (a.rarity < 0 || a.rarity >= GODFORGED_IDX) return { err: '品質索引超出範圍' };
    fu.qualities[a.rarity] = !!a.on;
    newForgeReturnUnroutable(fu); // 取消勾選的品質自專屬佇列退回總佇列重新派發
    UI.dirty.newforge = true;
    return true;
  },

  'newforge.setEnabled': function (a) {
    var fu = findNewForgeFurnace(a.furnaceId);
    if (!fu) return { err: '找不到熔爐 ' + a.furnaceId };
    fu.enabled = !!a.on;
    newForgeReturnUnroutable(fu); // 停用：專屬佇列退回總佇列
    UI.dirty.newforge = true;
    return true;
  },

  'newforge.markTabSeen': function () {
    var nf = newForgeState();
    nf.tabSeen = true;
    UI.dirty.header = true;
    return true;
  },

  'newforge.markNoticeShown': function () {
    newForgeState().noticeShown = true;
    return true;
  },

  /* ---- 分解設定 ---- */
  'factory.setSalvageSettings': function (a) {
    G.player.salvageSettings = G.player.salvageSettings || {};
    G.player.salvageSettings.maxRarity = (typeof a.maxRarity === 'number') ? a.maxRarity : -1;
    G.player.salvageSettings.maxLevel = (typeof a.maxLevel === 'number' && a.maxLevel > 0) ? a.maxLevel : null;
    G.player.salvageSettings.maxAncient = (typeof a.maxAncient === 'number') ? a.maxAncient : -1;
    UI.dirty.factory = true;
    return G.player.salvageSettings;
  },

  'factory.setAutoEquip': function (a) {
    G.factory.autoEquip = !!a.on;
    UI.dirty.factory = true;
    return true;
  },

  /* ---- 寶石批次 ----
     行為對齊 ui.js 的同步迴圈，上限也照抄：跨執行緒逐次往返不可行，一次跑完再回報。 */
  'gem.composeAll': function (a) {
    var made = 0, err = null;
    while (made < 2500 && !(err = composeGems(a.type, a.level))) made++;
    if (made > 0) {
      blog('♻️ 全部合成：' + gemLabel(a.type, a.level) + ' ×' + (made * GEM_COMPOSE_INPUT_COUNT) +
        ' → ' + gemLabel(a.type, a.level + 1) + ' ×' + made, 'good', 'factory');
    }
    UI.dirty.gems = true;
    return { made: made, err: made > 0 ? null : err };
  },

  'gem.dismantleAll': function (a) {
    var count = 0, gain = 0, r = null;
    while (count < 999) {
      r = dismantleGem(a.type, a.level);
      if (r.err) break;
      count++; gain += r.n;
    }
    if (count > 0) {
      blog('⛏️ 全部拆解：' + gemLabel(a.type, a.level) + ' ×' + count + ' → ' +
        gemLabel(a.type, 1) + ' ×' + gain, 'good', 'factory');
    }
    UI.dirty.gems = true;
    return { count: count, gain: gain, err: count > 0 ? null : (r && r.err) };
  },

  /* ---- 高塔 ----
     手動挑戰同時代表「取消等待中的連挑」；ui.js 現行是先清 TOWER.auto 再開打，
     兩步必須在同一個指令內完成。 */
  'tower.start': function (a) {
    TOWER.auto = null;
    TOWER.autoNextCd = 0;
    startTowerFight(a.floor);
    UI.dirty.tower = true; UI.dirty.battle = true;
    return { active: !!(G.tower && G.tower.active) };
  },

  /* ---- 統計 ---- */
  'stats.reset': function () {
    if (self.RUN_STATS) {
      RUN_STATS.skills = {};
      RUN_STATS.maxStage = (G && G.stage) ? G.stage.current : 1;
    }
    if (typeof resetLootStats === 'function') resetLootStats();
    UI.dirty.battle = true;
    return true;
  },

  /* ---- 設定 ---- */
  'settings.set': function (a) {
    G.settings = G.settings || {};
    G.settings[a.key] = a.value; // key 已由協議的 enum 白名單擋過
    UI.dirty.header = true; UI.dirty.inv = true; UI.dirty.equip = true;
    return true;
  },

  /* ---- 存檔 ---- */
  'save.manual': function (a) { return manualSave(a && a.label); },
  'save.toFolder': function (a) { return createManualSaveToFolderV2(a && a.label); },
  'save.restart': function () { return restartGame(); },

  /* ---- 分頁交接（v8）----
     另一個分頁要接管，這顆 Worker 從此不再是權威。先停迴圈再落地，順序不能反：
     反過來的話，落地與停迴圈之間仍可能插進一次自動存檔，而那正是要避免的多寫入。
     落地用 SHUTDOWN（語意就是「這個分頁要收工了」），主執行緒等它寫完才放開鎖。 */
  'app.handoff': function () {
    if (_loopTimer) { clearInterval(_loopTimer); _loopTimer = 0; }
    _booted = false;
    requestPersist(PERSIST_KINDS.SHUTDOWN);
    return true;
  },

  /* ---- GM ----
     執行層在 js/gm_exec.js（主執行緒與 Worker 共用同一份實作）。
     回傳 { ok, message }，面板依此顯示結果。 */
  'gm.exec': function (a) {
    if (typeof executeGMCommand !== 'function') {
      return { ok: false, message: 'GM 執行層未載入' };
    }
    return executeGMCommand(a.line);
  }
};

function runCommand(name, args) {
  var spec = commandSpec(name);
  if (!spec) return { ok: false, error: 'unknown command: ' + name };
  var invalid = validateCommand(name, args);
  if (invalid) return { ok: false, error: invalid };
  if (COMMAND_IMPL[name]) {
    try {
      return { ok: true, result: COMMAND_IMPL[name](args) };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }
  if (!spec.fn) {
    // 協議中 fn 為 null 的 13 條：邏輯目前仍在 ui.js，P3 搬進 Worker 後才實作
    return { ok: false, error: 'not implemented until P3: ' + name };
  }
  var fn = self[spec.fn];
  if (typeof fn !== 'function') return { ok: false, error: 'missing sim function: ' + spec.fn };

  var needResolve = resolveKeys(name);
  var params = [];
  for (var key in spec.args) {
    if (!Object.prototype.hasOwnProperty.call(spec.args, key)) continue;
    var v = args ? args[key] : undefined;
    if (needResolve.indexOf(key) !== -1) {
      var r = resolveItem(v);
      if (r.err) return { ok: false, error: r.err };
      v = r.item;
    }
    params.push(v);
  }
  try {
    return { ok: true, result: fn.apply(null, params) };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
}

/* 由 1 號熔爐實際勾選的品質產生新手提示文案。
   連續區間縮寫成「普通~史詩」，不連續則逐項列出，一個都沒勾則改寫成另一句。 */
function defaultSalvageHintText() {
  var furnace = G && G.player && G.player.newForge &&
    Array.isArray(G.player.newForge.furnaces) ? G.player.newForge.furnaces[0] : null;
  var flags = furnace && Array.isArray(furnace.qualities) ? furnace.qualities : [];
  var picked = [];
  for (var r = 0; r < RARITIES.length; r++) {
    if (flags[r] && RARITIES[r]) picked.push(r);
  }
  if (!picked.length) {
    return '💡 提示：預設不自動拆解任何品質，掉落裝備會全部保留入包。' +
      '到【熔爐】勾選品質後，該品質才會自動拆解成碎片與精華。';
  }
  var contiguous = picked[picked.length - 1] - picked[0] === picked.length - 1;
  var label;
  if (picked.length === 1) {
    label = RARITIES[picked[0]].name;
  } else if (contiguous) {
    label = RARITIES[picked[0]].name + '~' + RARITIES[picked[picked.length - 1]].name;
  } else {
    label = picked.map(function (r) { return RARITIES[r].name; }).join('、');
  }
  return '💡 提示：預設「' + label + '」品質會自動拆解成碎片與精華，未勾選品質會保留入包。';
}

/* ---- 開機 ---- */
function boot(msg) {
  var loaded = null;
  var notices = [];
  var offlineSummary = null;

  installStorageGuards();
  _maxRunId = msg.maxRunId || 1;

  if (msg.save) {
    loaded = (typeof migrateSave === 'function') ? migrateSave(msg.save) : msg.save;
  }
  G = loaded || newGameState();
  backfillItemSockets();
  updateShownRes();
  if (typeof markStatsDirty === 'function') markStatsDirty();
  if (typeof initFieldPlayer === 'function') initFieldPlayer();

  /* 安全模式跳過離線結算。這是開機流程裡最會爆的一段——它要讀存檔裡的時間戳、
     重跑一段模擬、再結算獎勵，任何一環碰到異常資料都會拋錯，而拋錯就等於開不了機。
     跳過它的代價只是「這次不補離線收益」，換來的是玩家進得去、匯得出存檔。 */
  if (loaded && msg.safeMode) {
    notices.push({ key: '_safeModeNotice', text: '已以安全模式開機：本次略過離線結算，離線期間的收益不會補發。建議先匯出存檔備份。' });
  } else if (loaded && typeof applyOfflineProgress === 'function') {
    offlineSummary = applyOfflineProgress() || null;
  }

  /* migrateSave 會把改版公告掛在 G 上，交給主執行緒顯示後刪除旗標。
     P5 起文案在這裡組完整：那些「可用 N 點」之類的補充值只有 Worker 算得出來，
     主執行緒沒有 G，不可能自己接上去。 */
  if (G._skillResetNotice) {
    notices.push({ key: '_skillResetNotice', text: '🛠️ 偵測到技能點異常：已使用 ' + G._skillResetNotice +
      '，已重置所有技能並發還初始技能。技能點已依等級全額退還（可用 ' +
      (typeof availableSkillPoints === 'function' ? availableSkillPoints() : 0) +
      ' 點），請重新配點；之後升級將正常獲得技能點。', cls: 'warn' });
    delete G._skillResetNotice;
  }
  if (G._skillPointRepairNotice) {
    notices.push({ key: '_skillPointRepairNotice', text: '🧮 ' + G._skillPointRepairNotice + '；目前可用技能點 ' +
      (typeof availableSkillPoints === 'function' ? availableSkillPoints() : 0) + ' 點。', cls: 'info' });
    delete G._skillPointRepairNotice;
  }
  if (G._talentRespecNotice) {
    notices.push({ key: '_talentRespecNotice', text: '🌟 ' + G._talentRespecNotice +
      '，請至【天賦】頁重新配點（新制成本＝天賦轉數+9／級，Lv.51 起每級加倍）。', cls: 'warn' });
    delete G._talentRespecNotice;
  }
  /* 帶 modal 的公告要彈窗，不是寫進日誌，UI 端據此分辨。
     ⚠️ 2026-07-28 移除全部一次性遷移後，目前只有 _skillPointRepairNotice 還有產生者；
     其餘三個旗標暫時沒有人設定。這段傳輸機制刻意保留——日後若再需要開機公告，
     直接在 migrateSave 設旗標即可，不必重接一次管線。 */
  if (G._talentRespecConfirm) {
    notices.push({ key: '_talentRespecConfirm', text: '天賦系統已重新改造，請重新配置！', modal: true });
    delete G._talentRespecConfirm;
  }

  /* 開機提示。P5 之前這幾則寫在 main.js，靠主執行緒自己那份 G 產生；
     主執行緒不再持有 G 之後，只有這裡算得出來。 */
  /* 新手提示的品質範圍必須跟著實際預設走，不能寫死。
     原文寫「預設普通~傳說品質會自動拆解」，但 newForgeDefaultFurnace 只勾普通
     （player.js 的 `qualities.push(r === 0)`），玩家照著訊息做就會滿包。
     文案與預設值分屬兩個檔案，寫死等於保證日後再次不同步。 */
  if (loaded) {
    notices.push({ key: 'welcomeBack', text: '📖 歡迎回來，冒險者！讀取存檔成功。', cls: 'good' });
    var invCapNow = (typeof inventoryCapacityWithTalents === 'function')
      ? inventoryCapacityWithTalents()
      : INVENTORY_CAP + (G.player.invUpgrades || 0);
    if (G.inventory.length > invCapNow) {
      notices.push({ key: 'inventoryOverCap', cls: 'warn',
        text: '⚠️ 背包超出容量（' + G.inventory.length + '/' + invCapNow +
          '）。今後滿載時將維持上限：新裝備與包內未鎖定最弱者「捨弱留強」擇一保留（上鎖裝備不受影響）。' +
          '超出的部分可用「分解設定」批次清理。' });
    }
  } else {
    notices.push({ key: 'welcomeNew', cls: 'good', text: '⚔️ 歡迎來到《無限征途：合成之巔》！' });
    notices.push({ key: 'welcomeNew2', cls: 'info', text: '你的角色會自動戰鬥。掉落的裝備會流進【熔爐】，記得去勾選各熔爐要拆解的品質！' });
    notices.push({ key: 'welcomeNew3', cls: 'info', text: defaultSalvageHintText() });
    flog('🏭 熔爐已啟動。掉落裝備會依各熔爐勾選的品質自動拆解或保留。', 'info');
  }

  /* 開機時把所有面板標記為髒。正常開機這是多餘的（UI 本來就會索取），
     但自動重啟後主執行緒手上是上一個 Worker 的快取，必須全部換掉。 */
  for (var pi = 0; pi < PANEL_KEYS.length; pi++) UI.dirty[PANEL_KEYS[pi]] = true;

  _booted = true;
  _lastTickAt = Date.now();
  _emitAcc = _autosaveAcc = _folderAcc = 0;
  if (_loopTimer) clearInterval(_loopTimer);
  _loopTimer = setInterval(loop, TICK_MS);

  post(MSG_OUT.BOOTED, {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    snapshot: { view: buildView(), fresh: !loaded },
    offlineSummary: offlineSummary,
    notices: notices,
    events: shimDrainEvents()
  });
}

/* ---- 執行中讀檔（v2 新增）----
   舊路徑的做法是寫進 localStorage 後 location.reload()，靠重新載入換掉整份狀態。
   Worker 架構下不需要重載：主執行緒讀出存檔內容送進來，這裡直接替換 G。
   讀檔前先把目前進度落地，避免玩家切換存檔時弄丟當前這局。 */
function loadIntoRunningSim(msg) {
  if (!msg.save) { reportError('load', new Error('load 訊息沒有帶存檔內容')); return; }
  requestPersist(PERSIST_KINDS.AUTO); // 目前進度先保底
  G = (typeof migrateSave === 'function') ? migrateSave(msg.save) : msg.save;
  backfillItemSockets();
  updateShownRes();
  if (typeof markStatsDirty === 'function') markStatsDirty();
  if (typeof initFieldPlayer === 'function') initFieldPlayer();
  if (typeof applyOfflineProgress === 'function') applyOfflineProgress();
  _lastTickAt = Date.now();
  _autosaveAcc = _folderAcc = 0;
  PANEL_KEYS.forEach(function (k) { UI.dirty[k] = true; });
  post(MSG_OUT.FULL, { snapshot: { view: buildView() }, events: shimDrainEvents() });
  requestPersist(PERSIST_KINDS.AUTO); // 換檔後立刻鎖定 savedAt 基準
}

/* ---- 分頁顯示狀態 ----
   判定與結算一律在 Worker；主執行緒只負責通知，不得自行決定要不要結算，
   否則兩邊各判一次就會重複領取離線收益。 */
function onVisibility(msg) {
  _pipActive = !!msg.pip;
  if (msg.hidden) {
    /* PiP 開著時不落地 SHUTDOWN：那是「分頁要關了」的語意，
       而 PiP 觀戰期間模擬照跑，15 秒一次的自動存檔就夠了。 */
    _hiddenAt = msg.at || Date.now();
    if (!_pipActive) requestPersist(PERSIST_KINDS.SHUTDOWN);
    return;
  }
  var settle = _hiddenAt > 0 && (Date.now() - _hiddenAt) >= BG_SUSPEND_AFTER_MS;
  _hiddenAt = 0;
  _lastTickAt = Date.now();
  if (settle && typeof applyOfflineProgress === 'function') {
    var summary = applyOfflineProgress();
    if (summary) shimPushEvent('notice', { key: 'offlineSummary', data: summary });
    requestPersist(PERSIST_KINDS.AUTO);
  }
}

self.onmessage = function (e) {
  var msg = e.data || {};
  try {
    switch (msg.type) {
      case MSG_IN.BOOT:
        boot(msg);
        break;
      case MSG_IN.LOAD:
        loadIntoRunningSim(msg);
        break;
      case MSG_IN.CMD:
        var r = runCommand(msg.name, msg.args);
        post(MSG_OUT.ACK, { id: msg.id, ok: r.ok, result: r.result, error: r.error });
        if (r.ok) emitTick(); // 指令有結果就立刻推一次，不必等下個 tick
        break;
      case MSG_IN.PANEL:
        if (!isPanelKey(msg.name)) { reportError('panel', new Error('unknown panel: ' + msg.name)); break; }
        post(MSG_OUT.PANEL, { name: msg.name, data: buildPanel(msg.name, msg.params) });
        break;
      case MSG_IN.VISIBILITY:
        onVisibility(msg);
        break;
      case MSG_IN.SAVE_RESULT:
        onSaveResult(msg);
        break;
      case MSG_IN.PING:
        post(MSG_OUT.PONG, { t: msg.t, booted: _booted });
        break;
      default:
        reportError('onmessage', new Error('unknown message type: ' + msg.type));
    }
  } catch (err) {
    reportError('onmessage:' + msg.type, err);
  }
};

self.onerror = function (message, filename, lineno) {
  post(MSG_OUT.ERROR, { where: 'worker', message: String(message), stack: filename + ':' + lineno });
};
