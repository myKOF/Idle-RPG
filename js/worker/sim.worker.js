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
var _maxRunId = 1;          // 由 boot 帶入；重新開局時用來決定新局編號

function post(type, payload) {
  payload = payload || {};
  payload.type = type;
  self.postMessage(payload);
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
   隱藏未滿 60 秒維持即時模擬，逾時停止推進，回前景改由離線收益結算。 */
function backgroundSuspended() {
  return _hiddenAt > 0 && (Date.now() - _hiddenAt) >= BG_SUSPEND_AFTER_MS;
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
    if (_emitAcc >= TICK_EMIT_MS / 1000) { _emitAcc = 0; emitTick(); }

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
    diag: shimDiagSnapshot()
  });
}

/* ---- 面板資料 ----
   P4 會依實測結果再裁切；目前先給該面板需要的狀態切片，不整份丟。 */
function buildPanel(name) {
  if (!G) return null;
  switch (name) {
    case 'header': return { player: G.player, stage: G.stage };
    case 'battle': return { field: typeof FIELD !== 'undefined' ? FIELD : null, stage: G.stage };
    case 'equip': return { equipment: G.equipment, equipSetNames: G.equipSetNames, sets: G.equipmentSets };
    case 'inv': return { inventory: G.inventory };
    case 'forge': return { forge: typeof forgeState === 'function' ? forgeState() : G.forge };
    case 'newforge': return { newForge: G.newForge };
    case 'factory': return { factory: G.factory, salvageSettings: G.player && G.player.salvageSettings };
    case 'tower': return { tower: G.tower };
    case 'gems': return { gems: G.gems, shop: typeof gemShop === 'function' ? gemShop() : null };
    case 'skills': return { skills: G.player && G.player.skills, loadout: G.player && G.player.loadout, fusions: G.fusions };
    case 'talents': return { talents: G.talents, potentials: G.potentials };
    default: return null;
  }
}

/* ---- 存檔 ----
   序列化在 Worker，落地在主執行緒。savedAt 只能在收到 saveResult{ok:true} 後才算數，
   否則寫入失敗時離線結算的基準會錯位，造成收益漏算或重複結算。 */
function requestPersist(kind, opts) {
  if (!G) return null;
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

  self.manualSave = function (label) {
    var prefix = label ? String(label).replace(/[^a-z0-9_-]+/ig, '_') : 'manual';
    var meta = saveRecMeta('manual', 'manual_' + Date.now().toString(36) + '_' + ri(100, 999),
      'IC_' + prefix + '_' + saveStamp(Date.now()) + '.json');
    requestPersist(PERSIST_KINDS.MANUAL, { meta: meta });
    return meta;
  };
  self.createManualSaveToFolderV2 = self.manualSave;

  self.restartGame = function () {
    requestPersist(PERSIST_KINDS.AUTO); // 舊局進度先保底
    var fresh = newGameState();
    fresh.runId = Math.max(_maxRunId, G.runId || 1) + 1; // 新局另一個檔，不蓋掉舊局
    fresh.savedAt = Date.now();
    var meta = saveRecMeta('auto', 'auto_current', AUTO_FOLDER_FILE_V2);
    meta.runId = fresh.runId;
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
var OBJECT_ARG_KEYS = { itemId: 1, gemId: 1, gemId1: 1, gemId2: 1, partId: 1 };

function resolveItem(id) {
  if (!id || !G) return null;
  var i;
  if (Array.isArray(G.inventory)) {
    for (i = 0; i < G.inventory.length; i++) if (G.inventory[i] && G.inventory[i].id === id) return G.inventory[i];
  }
  var eq = G.equipment || {};
  for (var s in eq) if (eq[s] && eq[s].id === id) return eq[s];
  if (Array.isArray(G.gems)) {
    for (i = 0; i < G.gems.length; i++) if (G.gems[i] && G.gems[i].id === id) return G.gems[i];
  }
  return null;
}

/* 協議中 fn 為 null 的指令，由 Worker 這邊自行實作。
   P2 先補齊存檔三條（原本錯誤地宣告直接呼叫會碰 I/O 的函式），其餘 UI 搬遷項目在 P3。 */
var COMMAND_IMPL = {
  'save.manual': function (args) { return manualSave(args && args.label); },
  'save.toFolder': function (args) { return manualSave(args && args.label); },
  'save.restart': function () { return restartGame(); }
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

  var params = [];
  for (var key in spec.args) {
    if (!Object.prototype.hasOwnProperty.call(spec.args, key)) continue;
    var v = args ? args[key] : undefined;
    if (OBJECT_ARG_KEYS[key] && typeof v === 'string') {
      var obj = resolveItem(v);
      if (!obj) return { ok: false, error: 'item not found: ' + v };
      v = obj;
    }
    params.push(v);
  }
  try {
    return { ok: true, result: fn.apply(null, params) };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
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
  if (typeof markStatsDirty === 'function') markStatsDirty();
  if (typeof initFieldPlayer === 'function') initFieldPlayer();

  if (loaded && typeof applyOfflineProgress === 'function') {
    offlineSummary = applyOfflineProgress() || null;
  }

  // migrateSave 會把改版公告掛在 G 上，交給主執行緒顯示後刪除旗標
  ['_skillResetNotice', '_skillPointRepairNotice', '_talentRespecNotice', '_talentRespecConfirm'].forEach(function (k) {
    if (G[k]) { notices.push({ key: k, text: G[k] }); delete G[k]; }
  });

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
  if (msg.hidden) {
    _hiddenAt = msg.at || Date.now();
    requestPersist(PERSIST_KINDS.SHUTDOWN);
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
        post(MSG_OUT.PANEL, { name: msg.name, data: buildPanel(msg.name) });
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
