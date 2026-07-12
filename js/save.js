'use strict';
/* ============ 存檔 / 讀檔 / 離線收益 ============ */

var SAVE_KEY = 'infinite_conquest_save_v1';
// 重置/匯入後重新整理前，須阻止 beforeunload 自動存檔把舊狀態寫回去
var _saveSuppressed = false;

/* ============ 存檔記錄系統（多存檔 + 每局自動存檔） ============
   - 目前遊戲：SAVE_KEY（開機讀取點，永遠是「正在玩」的狀態）
   - 存檔記錄：索引存 SAVE_INDEX_KEY，各筆內容存 ic_save_<id>
       kind 'auto'   = ⚡ 即時自動存檔（每局一個檔，15 秒自動更新，檔名標注局數）
       kind 'manual' = 💾 手動「立即存檔」（最多保留 5 筆，新的擠掉最舊的）
   - 重新開局（restartGame）：runId +1 → 新局自動存檔為另一個檔案，舊記錄全數保留 */
var SAVE_INDEX_KEY = 'ic_save_index_v1';
var SAVE_REC_PREFIX = 'ic_save_';
var MAX_MANUAL_SAVES = 5;   // 手動存檔記錄上限
var MAX_AUTO_SAVES = 5;     // 自動存檔（每局一筆）最多保留局數

function saveIndex() {
  try { return JSON.parse(localStorage.getItem(SAVE_INDEX_KEY)) || []; }
  catch (e) { return []; }
}
function writeSaveIndex(list) {
  try { localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(list)); } catch (e) {}
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function saveStamp(ts) {
  var d = new Date(ts);
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' +
    pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}
function saveRecName(rec) {
  return rec.kind === 'auto' ? '⚡ 自動存檔' : '💾 手動存檔';
}
// 清理索引外的孤兒資料，避免舊版匯入／刪除異常長期佔用 localStorage。
function removeUnindexedSaveRecords(list) {
  var known = {};
  list.forEach(function (r) { known[SAVE_REC_PREFIX + r.id] = true; });
  for (var i = localStorage.length - 1; i >= 0; i--) {
    var key = localStorage.key(i);
    if (key && key !== SAVE_INDEX_KEY && key.indexOf(SAVE_REC_PREFIX) === 0 && !known[key]) {
      try { localStorage.removeItem(key); } catch (e) {}
    }
  }
}

// 依記錄上限修剪最舊存檔；回傳修剪後索引。
function pruneSaveRecords(inputList) {
  var list = inputList || saveIndex();
  removeUnindexedSaveRecords(list);
  var manual = list.filter(function (r) { return r.kind === 'manual'; });
  var autos = list.filter(function (r) { return r.kind === 'auto'; });
  manual.sort(function (a, b) { return b.savedAt - a.savedAt; });
  autos.sort(function (a, b) { return b.savedAt - a.savedAt; });
  var curRun = (typeof G !== 'undefined' && G) ? (G.runId || 1) : -1;
  var toRemove = manual.slice(MAX_MANUAL_SAVES)
    .concat(autos.slice(MAX_AUTO_SAVES).filter(function (r) { return r.runId !== curRun; }));
  toRemove.forEach(function (r) {
    try { localStorage.removeItem(SAVE_REC_PREFIX + r.id); } catch (e) {}
    list = list.filter(function (x) { return x.id !== r.id; });
  });
  writeSaveIndex(list);
  // 一併刪除已無記錄使用的資料夾實體檔（避免孤兒檔下次同步被匯入復活）
  toRemove.forEach(function (r) {
    if (!list.some(function (x) { return x.fname === r.fname; })) removeFolderFile(r.fname);
  });
  return list;
}

// 儲存空間不足時，逐筆釋放最舊記錄，讓最新存檔有重試機會。
function removeOldestSaveRecord() {
  var list = saveIndex().slice().sort(function (a, b) { return (a.savedAt || 0) - (b.savedAt || 0); });
  if (!list.length) return false;
  var victim = list[0];
  try { localStorage.removeItem(SAVE_REC_PREFIX + victim.id); } catch (e) {}
  var next = saveIndex().filter(function (r) { return r.id !== victim.id; });
  writeSaveIndex(next);
  if (victim.fname && !next.some(function (r) { return r.fname === victim.fname; })) removeFolderFile(victim.fname);
  return true;
}

// 多份完整遊戲快照容易塞滿 localStorage；清理瀏覽器內的副本時不碰目前主存檔，
// 本地資料夾中的實體檔仍保留，之後可重新掃描匯入。
function compactSaveRecordStorage() {
  for (var i = localStorage.length - 1; i >= 0; i--) {
    var key = localStorage.key(i);
    if (key && key !== SAVE_INDEX_KEY && key.indexOf(SAVE_REC_PREFIX) === 0) {
      try { localStorage.removeItem(key); } catch (e) {}
    }
  }
  try { localStorage.removeItem(SAVE_INDEX_KEY); } catch (e2) {}
}

// 先正常寫入；失敗時清理並逐筆刪除最舊記錄後重試。
function setSaveStorage(key, json) {
  try {
    localStorage.setItem(key, json);
    return true;
  } catch (e) {
    pruneSaveRecords();
    try {
      localStorage.setItem(key, json);
      return true;
    } catch (e2) {
      compactSaveRecordStorage();
      try {
        localStorage.setItem(key, json);
        return true;
      } catch (eCompact) {}
      var attempts = saveIndex().length;
      for (var i = 0; i < attempts; i++) {
        if (!removeOldestSaveRecord()) break;
        try {
          localStorage.setItem(key, json);
          return true;
        } catch (e3) {}
      }
      return false;
    }
  }
}

// 寫入/更新一筆存檔記錄，並依上限修剪最舊的記錄。
function putSaveRecord(rec, json) {
  var list = saveIndex();
  var found = false;
  for (var i = 0; i < list.length; i++) if (list[i].id === rec.id) { list[i] = rec; found = true; break; }
  if (!found) list.unshift(rec);
  list = pruneSaveRecords(list);
  writeSaveIndex(list);
  if (!setSaveStorage(SAVE_REC_PREFIX + rec.id, json)) return false;
  // 寫入過程可能清掉最舊索引，確保剛成功的記錄仍保留在清單中。
  list = saveIndex();
  if (!list.some(function (r) { return r.id === rec.id; })) list.unshift(rec);
  writeSaveIndex(list);
  return true;
}
function saveRecMeta(kind, id, fname) {
  return {
    id: id, kind: kind, runId: G.runId || 1, savedAt: Date.now(), fname: fname,
    level: G.player.level, stage: (G.stage && G.stage.current) || 1,
    zone: (G.stage && G.stage.zone) || 'plains'
  };
}

function saveGame(opts) {
  if (_saveSuppressed) return;
  try {
    G.savedAt = Date.now();
    var json = JSON.stringify(G);
    var primarySaved = setSaveStorage(SAVE_KEY, json);
    // 即時自動存檔記錄（每局固定同一個檔，特別標注）
    var runId = G.runId || 1;
    var autoRec = saveRecMeta('auto', 'auto_run' + runId, 'IC_autosave_run' + runId + '.json');
    var recordSaved = putSaveRecord(autoRec, json);
    if (recordSaved) {
      if (!(opts && opts.skipFolderSync)) syncSaveFolder(); // 已連接存檔資料夾時，順帶寫出檔案（靜默）
    } else if (_saveDir) {
      // localStorage 配額不足時，將自動存檔直接落地本地資料夾，索引只保留 metadata。
      writeManualSaveToFolder(autoRec, json).catch(function () {});
    }
    // 主存檔是防回檔的必要資料；歷史自動存檔副本寫不進去時，不應覆蓋主存檔成功。
    return primarySaved;
  } catch (e) { /* 儲存空間滿或隱私模式 */ return false; }
}

// 手動「立即存檔」：另存一筆記錄；回傳記錄（失敗 null）
function manualSave(label, opts) {
  opts = opts || {};
  saveGame({ skipFolderSync: !!opts.skipFolderSync }); // 目前遊戲存檔點同步更新
  G.savedAt = Date.now();
  var id = 'm' + Date.now().toString(36) + ri(100, 999);
  var prefix = label ? String(label).replace(/[^a-z0-9_-]+/ig, '_') : 'manual';
  var rec = saveRecMeta('manual', id, 'IC_' + prefix + '_' + saveStamp(Date.now()) + '.json');
  var manualJson = JSON.stringify(G);
  // 已連接本地資料夾時，避免先嘗試寫入完整 localStorage 快照而清掉既有 metadata。
  if (opts.allowFolderOnly && opts.skipFolderSync && _saveDir) {
    rec._folderOnly = true;
    rec._folderJson = manualJson;
    return rec;
  }
  if (!putSaveRecord(rec, manualJson)) {
    if (opts.allowFolderOnly && _saveDir) {
      rec._folderOnly = true;
      rec._folderJson = manualJson;
      return rec;
    }
    return null;
  }
  if (!opts.skipFolderSync) syncSaveFolder(); // 已連接存檔資料夾時，順帶寫出檔案（靜默）
  return rec;
}

// 刪除存檔記錄（一併刪除已無其他記錄使用的資料夾實體檔）
function deleteSaveRecord(id) {
  var rec = null;
  saveIndex().forEach(function (x) { if (x.id === id) rec = x; });
  try { localStorage.removeItem(SAVE_REC_PREFIX + id); } catch (e) {}
  var list = saveIndex().filter(function (x) { return x.id !== id; });
  try { localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(list)); } catch (e) {
    compactSaveRecordStorage();
    try { localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(list)); } catch (e2) {}
  }
  if (rec && rec.fname && !list.some(function (x) { return x.fname === rec.fname; })) {
    removeFolderFile(rec.fname);
  }
}

// 依檔名去重：清理「自匯入」bug 產生的同檔名複本，每檔名保留 savedAt 最新一筆；回傳清掉筆數
function dedupeSaveIndex() {
  var list = saveIndex();
  var bestByName = {};
  list.forEach(function (r) {
    var cur = bestByName[r.fname];
    if (!cur || (r.savedAt || 0) > (cur.savedAt || 0)) bestByName[r.fname] = r;
  });
  var keep = [], removed = 0;
  list.forEach(function (r) {
    if (bestByName[r.fname] === r) {
      keep.push(r); // 每檔名僅保留最新一筆（複本共用同一實體檔，不刪資料夾檔）
    } else {
      try { localStorage.removeItem(SAVE_REC_PREFIX + r.id); } catch (e) {}
      removed++;
    }
  });
  if (removed > 0) writeSaveIndex(keep);
  return removed;
}


function findSaveRecord(id) {
  var found = null;
  saveIndex().forEach(function (r) { if (r.id === id) found = r; });
  return found;
}

function readFolderSaveRecord(rec) {
  if (!_saveDir || !rec || !rec.fname) return Promise.reject(new Error('尚未連接存檔資料夾'));
  return _saveDir.getFileHandle(rec.fname, { create: false })
    .then(function (fh) { return fh.getFile(); })
    .then(function (file) { return file.text(); });
}

function applyLoadedSaveRaw(raw) {
  try {
    var d = JSON.parse(raw);
    if (!d || d.version !== 1) return '存檔格式錯誤';
  } catch (e) { return '存檔格式錯誤'; }
  saveGame(); // 目前進度先寫入本局的自動存檔
  _saveSuppressed = true; // 防止 beforeunload 把舊狀態蓋回去
  if (!setSaveStorage(SAVE_KEY, raw)) return '目前瀏覽器空間不足，無法切換主存檔';
  location.reload();
  return null;
}

// 讀取存檔記錄（覆蓋目前遊戲並重新整理）；本地資料夾存檔回傳 Promise
function loadSaveRecord(id) {
  var rec = findSaveRecord(id);
  var raw = localStorage.getItem(SAVE_REC_PREFIX + id);
  if (raw) return applyLoadedSaveRaw(raw);
  if (rec && rec.folderOnly && _saveDir) {
    return readFolderSaveRecord(rec).then(function (text) { return applyLoadedSaveRaw(text); })
      .catch(function (e) { return '讀取本地存檔失敗：' + (e && e.message ? e.message : e); });
  }
  return '找不到存檔資料';
}

function loadGame() {
  try {
    var raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    var data = JSON.parse(raw);
    if (!data || data.version !== 1) return null;
    return migrateSave(data);
  } catch (e) { return null; }
}

// 以預設狀態為底，深補缺漏欄位（存檔向前相容）
function migrateSave(data) {
  // 技能點總預算遷移：舊存檔沒有此欄位時，依轉生狀態補建。
  var hadSkillPointBudget = !!(data.player && data.player.skillPointBudget !== undefined);
  var hadZone = data.stage && data.stage.zone !== undefined; // 需在 mergeDefaults 前判斷
  var hadSkillDmgV2 = !!data.skillDmgV2;                     // 需在 mergeDefaults 前判斷（merge 會補 true）
  var hadSpecialBuffTrimV1 = !!data.specialBuffTrimV1;        // 一次性移除特殊技能第二增益
  var hadForgeUnlockNotice = !!(data.forge && data.forge.unlockNotified);
  var hadSalvageSlots = !!(data.factory && data.factory.salvageSlots !== undefined);
  var def = newGameState();
  
  // 防止玩家手動降級（刪除）的初始技能，在讀檔時被 mergeDefaults 誤判為缺漏而自動補回 1 級
  if (data.player && data.player.skills) {
    delete def.player.skills.powerSlash;
    delete def.player.skills.arcaneBurst;
  }
  
  mergeDefaults(data, def);
  if (!hadSalvageSlots) {
    var legacySalvageInstalled = data.factory && data.factory.installed && data.factory.installed.salvage;
    data.factory.salvageSlots = clamp(Math.max(SALVAGE_SLOT_LEGACY_DEFAULT, (legacySalvageInstalled || []).length), SALVAGE_SLOT_INITIAL, SALVAGE_SLOT_MAX);
  } else {
    data.factory.salvageSlots = clamp(Math.floor(Number(data.factory.salvageSlots) || SALVAGE_SLOT_INITIAL), SALVAGE_SLOT_INITIAL, SALVAGE_SLOT_MAX);
  }
  data.player.ancientEssence = Math.max(0, Math.floor(Number(data.player.ancientEssence) || 0));
  data.player.soulOrigin = Math.max(0, Math.floor(Number(data.player.soulOrigin) || 0));
  data.settings.useAncientEssence = !!data.settings.useAncientEssence;
  // 神鑄永久開放相容：舊存檔只有 unlockNotified，合併預設後補回永久解鎖旗標。
  if (hadForgeUnlockNotice && data.forge) data.forge.unlocked = true;
  // 轉生欄位相容：舊存檔視為 0 轉；等級上限固定為 9999。
  data.player.reincarnations = clamp(data.player.reincarnations || 0, 0, REINCARNATION_MAX);
  data.player.reincarnationTalentPoints = Math.max(0, Math.floor(Number(data.player.reincarnationTalentPoints) || 0));
  var expectedSkillBudget = data.player.reincarnations > 0 ? 10000 : Math.min(10000, Math.max(0, (data.player.level || 1) + 1));
  if (!hadSkillPointBudget || Number(data.player.skillPointBudget) < expectedSkillBudget) {
    data.player.skillPointBudget = expectedSkillBudget;
    data._skillPointRepairNotice = '技能點總預算已依規則補建為 ' + expectedSkillBudget + ' 點';
  } else {
    data.player.skillPointBudget = Math.max(0, Math.floor(Number(data.player.skillPointBudget) || 0));
  }
  if (data.player.level > REINCARNATION_LEVEL) {
    data.player.level = REINCARNATION_LEVEL;
    data.player.xp = 0;
  }
  // 寶石商店等級相容：舊存檔沒有 level 時沿用 Lv.1，並限制在 1~20 級。
  if (data.player && data.player.gemShop) {
    data.player.gemShop.level = clamp(data.player.gemShop.level || 1, 1, GEM_SHOP_MAX_LEVEL);
  }
  // 確保裝備槽位齊全
  SLOT_LIST.forEach(function (s) {
    if (data.equipment[s] === undefined) data.equipment[s] = null;
  });
  // 品質擴充至 8 階：篩選規則陣列補齊（新階預設保留）
  if (data.factory && data.factory.filter && data.factory.filter.actions) {
    while (data.factory.filter.actions.length < RARITIES.length) data.factory.filter.actions.push('keep');
    data.factory.filter.actions = data.factory.filter.actions.map(function (action) {
      return action === 'synth' ? 'keep' : action;
    });
  }
  // 合成節點暫停期間，即使舊存檔曾開啟也不可重新啟動。
  if (data.factory && data.factory.synth) data.factory.synth.enabled = false;
  // 舊版寶石（{1..5: 數量}）→ 轉換為隨機種類
  var gemTypeKeys = Object.keys(GEM_TYPES);
  for (var lv = 1; lv <= GEM_MAX_LEVEL; lv++) {
    var n = data.player.gems[lv];
    if (typeof n === 'number') {
      delete data.player.gems[lv];
      for (var i = 0; i < n; i++) {
        var t = gemTypeKeys[Math.floor(Math.random() * gemTypeKeys.length)];
        if (!data.player.gems[t]) data.player.gems[t] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        data.player.gems[t][lv] = (data.player.gems[t][lv] || 0) + 1;
      }
    }
  }
  // 戰鬥場景系統：舊存檔進度歸入「草原」
  if (!hadZone) {
    data.stage.zone = 'plains';
    data.zoneProgress.plains = { current: data.stage.current || 1, best: data.stage.best || 1 };
  }
  /* 2026-07-09 技能傷害全面重調：一般技能定義（SKILLS）已直接改數值，
     但玩家自創融合技的 fx 是存檔快照 → 一次性等比加成（越強加越多，最高 +300%）。 */
  if (!hadSkillDmgV2 && data.player.fusions && data.player.fusions.length) {
    data.player.fusions.forEach(function (fs) {
      if (!fs.fx || !fs.fx.base) return;
      var mult = fs.fx.base >= 700 ? 4 : (fs.fx.base >= 400 ? 3.5 : 3);
      fs.fx.base = Math.round(fs.fx.base * mult);
      if (fs.fx.per) fs.fx.per = Math.round(fs.fx.per * mult * 10) / 10;
    });
  }
  /* ---- 技能點回溯修復（每次讀檔檢查）----
     已使用點數以所有技能等級總和計算；轉生玩家總預算固定 10000。
     若舊存檔曾因 bug 超支，保留玩家技能資料，不再破壞性清除；可用點數會安全封頂為 0。 */
  var spSpent = 0;
  for (var skId in data.player.skills) spSpent += data.player.skills[skId] || 0;
  spSpent = Math.max(0, Math.floor(spSpent));
  var spTotal = Math.max(0, Math.floor(Number(data.player.skillPointBudget) || 0));
  if (spSpent > spTotal) {
    data._skillPointRepairNotice = '技能投入 ' + spSpent + ' 點超過總預算 ' + spTotal + ' 點，可用技能點已保護為 0；既有技能未刪除';
  }
  /* ONE-TIME MIGRATION: specialBuffTrimV1
     特殊技能已移除第二個增益效果；既有融合技的 fx 是存檔快照，
     只清理由這些特殊技能帶入的 buff2，不要求玩家重新消耗素材。 */
  if (!hadSpecialBuffTrimV1 && data.player.fusions && data.player.fusions.length) {
    var trimmedSpecialBuffs = 0;
    data.player.fusions.forEach(function (fs) {
      if (typeof trimLegacySpecialFusionBuff === 'function' && trimLegacySpecialFusionBuff(fs)) trimmedSpecialBuffs++;
    });
    data.specialBuffTrimV1 = true;
    if (trimmedSpecialBuffs) {
      data._specialBuffTrimNotice = '已清理 ' + trimmedSpecialBuffs + ' 個融合技能的特殊第二增益效果';
    }
  }
  /* ---- 融合寶石「融合次數」改為世代制（2026-07-09 修正）----
     舊定義 fusions = 融合事件總數（兩顆融合1次的再融合 → 3，玩家預期 2）。
     新定義 fusions = 世代（max+1），另補 leaves = 素材 5 階總數（拆解成本用）。
     以「有無 leaves 欄位」判斷是否已遷移（逐顆冪等，不需全域旗標）：
       leaves = 舊 fusions + 1（舊定義下事件數 n → 葉子 n+1，成本不變）
       fusions = ⌈log2(leaves)⌉（以平衡樹回推世代；1→1、3→2 符合玩家實例） */
  var fixFusedGem = function (fg) {
    if (!fg || fg.leaves !== undefined) return;
    var oldF = fg.fusions || 1;
    fg.leaves = oldF + 1;
    fg.fusions = Math.max(1, Math.ceil(Math.log(oldF + 1) / Math.LN2));
  };
  (data.player.fusedGems || []).forEach(fixFusedGem);
  var fixSockets = function (it) {
    if (it && it.sockets) it.sockets.forEach(function (g) { if (g && g.fused) fixFusedGem(g.fused); });
  };
  for (var eqk in data.equipment) fixSockets(data.equipment[eqk]);
  data.inventory.forEach(fixSockets);
  data.factory.conveyor.forEach(fixSockets);
  data.factory.synthBuffer.forEach(fixSockets);
  // 神鑄槽位內的裝備一併遷移（寶石槽位項目 kind:'gem' 無 sockets/name，跳過）
  ((data.forge && data.forge.slots) || []).forEach(function (it) { if (it && it.kind !== 'gem') fixSockets(it); });

  data.tower.active = false; // 讀檔時不可能處於高塔戰鬥
  if (!data.settings) data.settings = { compareEq: false };
  
  // 修正舊有裝備名稱前綴（「神鑄創世的」須排最前，避免被「神鑄的/創世的」截半）
  var fixName = function(it) {
    if (!it) return;
    it.name = RARITY_PREFIX[it.rarity] + it.name.replace(/^(神鑄創世的|粗糙的|堅實的|精工的|奇異的|大師級|傳世的|神鑄的|創世的|普通的|精良的|稀有的|獨特的|史詩的|傳說的|神話的)/, '');
  };
  for (var k in data.equipment) fixName(data.equipment[k]);
  data.inventory.forEach(fixName);
  data.factory.conveyor.forEach(fixName);
  data.factory.synthBuffer.forEach(fixName);
  ((data.forge && data.forge.slots) || []).forEach(function (it) { if (it && it.kind !== 'gem') fixName(it); });

  return data;
}
function mergeDefaults(target, def) {
  for (var k in def) {
    if (target[k] === undefined || target[k] === null) {
      if (def[k] !== null && typeof def[k] === 'object') {
        target[k] = JSON.parse(JSON.stringify(def[k]));
      } else if (target[k] === undefined) {
        target[k] = def[k];
      }
    } else if (typeof def[k] === 'object' && def[k] !== null && !Array.isArray(def[k]) &&
               typeof target[k] === 'object' && !Array.isArray(target[k])) {
      mergeDefaults(target[k], def[k]);
    }
  }
}

/* ---- 重新開局：開新角色重玩（runId +1），所有舊存檔記錄保留 ---- */
function restartGame() {
  saveGame(); // 目前進度保底寫入本局自動存檔
  var maxRun = G.runId || 1;
  saveIndex().forEach(function (r) { if ((r.runId || 1) > maxRun) maxRun = r.runId; });
  var fresh = newGameState();
  fresh.runId = maxRun + 1; // 新局的自動存檔是另一個檔案，不會蓋掉舊局
  _saveSuppressed = true;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(fresh)); } catch (e) {}
  location.reload();
}

/* ---- 存檔資料夾（File System Access API；Chrome / Edge） ----
   連接本機資料夾後，所有存檔記錄會寫成實體 .json 檔案 —
   直接把檔案傳給別人即可分享；把別人的 .json 放進資料夾後
   再按一次「打開存檔資料夾」，會自動匯入為手動存檔記錄。      */
var _saveDir = null; // 本次瀏覽期間已連接的資料夾把手

function idbKV(cb) {
  try {
    var req = indexedDB.open('ic_fs_kv', 1);
    req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
    req.onsuccess = function () { cb(req.result); };
    req.onerror = function () { cb(null); };
  } catch (e) { cb(null); }
}
function idbSetDir(handle) {
  idbKV(function (db) {
    if (!db) return;
    try { db.transaction('kv', 'readwrite').objectStore('kv').put(handle, 'saveDir'); } catch (e) {}
  });
}
function idbGetDir(cb) {
  idbKV(function (db) {
    if (!db) return cb(null);
    try {
      var r = db.transaction('kv', 'readonly').objectStore('kv').get('saveDir');
      r.onsuccess = function () { cb(r.result || null); };
      r.onerror = function () { cb(null); };
    } catch (e) { cb(null); }
  });
}

// 啟動時讀取已授權資料夾內最新的有效存檔，避免 localStorage 配額不足時回到舊快照。
function loadLatestFolderSave(cb) {
  cb = cb || function () {};
  if (!window.showDirectoryPicker) { cb(null); return; }
  idbGetDir(function (stored) {
    if (!stored) { cb(null); return; }
    stored.requestPermission({ mode: 'readwrite' }).then(function (perm) {
      if (perm !== 'granted') { cb(null); return; }
      _saveDir = stored;
      return (async function () {
        var best = null;
        for await (var ent of stored.values()) {
          if (ent.kind !== 'file' || !/\.json$/i.test(ent.name)) continue;
          try {
            var raw = await (await ent.getFile()).text();
            var data = JSON.parse(raw);
            if (!data || data.version !== 1) continue;
            var ts = Number(data.savedAt) || 0;
            if (!best || ts > best.savedAt) best = { data: data, savedAt: ts, fname: ent.name };
          } catch (e) {}
        }
        if (best) best.data = migrateSave(best.data);
        cb(best);
      })();
    }).catch(function () { cb(null); });
  });
}

// 開啟/連接存檔資料夾 → 寫出所有記錄 + 掃描匯入新檔案；cb(err, {wrote, imported, dirName})
function openSaveFolder(cb, forceOpen) {
  cb = cb || function () {};
  if (!window.showDirectoryPicker) {
    downloadAllSaves(); // 不支援 File System Access：改為逐檔下載到「下載」資料夾
    cb(null, { fallback: true });
    return;
  }
  idbGetDir(function (stored) {
    var doSync = function(dir) {
      _saveDir = dir;
      idbSetDir(dir);
      var wroteN = 0;
      return cleanupFolderSwapFiles().then(function () { return writeAllToFolder(); }).then(function (w) { wroteN = w; return importUnknownFromFolder(); })
        .then(function (imp) { return { wrote: wroteN.wrote, skipped: wroteN.skipped, total: wroteN.total, imported: imp, dirName: _saveDir.name }; });
    };

    var chooseFolder = function () {
      return window.showDirectoryPicker({ id: 'idle_rpg_saves', mode: 'readwrite' }).then(doSync);
    };

    if (stored && !forceOpen) {
      stored.requestPermission({ mode: 'readwrite' }).then(function (perm) {
        if (perm !== 'granted') throw new Error('repick');
        return stored;
      }).catch(function () { return chooseFolder(); })
      .then(doSync).then(function(res){ cb(null, res); }).catch(function(e){ cb('未選擇資料夾或無存取權限' + (e && e.name ? '（' + e.name + '）' : '')); });
    } else if (forceOpen) {
      // 使用者主動按下「打開」時，每次都叫出資料夾選擇器，避免只在背景同步而沒有開啟動作。
      chooseFolder().then(function(res){ cb(null, res); }).catch(function(e){
        if (e && e.name === 'AbortError') {
          cb(null, { wrote: 0, imported: 0, dirName: stored ? stored.name : '', viewOnly: true });
        } else {
          cb('未選擇資料夾或無存取權限' + (e && e.name ? '（' + e.name + '）' : ''));
        }
      });
    } else {
      chooseFolder()
        .then(function(res){ cb(null, res); })
        .catch(function(e){ cb('未選擇資料夾或無存取權限' + (e && e.name ? '（' + e.name + '）' : '')); });
    }
  });
}

// 清理 Chromium 寫入中斷留下的暫存檔；只處理已知的 .crswap 檔，不碰其他使用者檔案。
function cleanupFolderSwapFiles() {
  if (!_saveDir) return Promise.resolve();
  return (async function () {
    var stale = [];
    for await (var ent of _saveDir.values()) {
      if (ent.kind === 'file' && /\.crswap$/i.test(ent.name)) stale.push(ent.name);
    }
    for (var i = 0; i < stale.length; i++) {
      try { await _saveDir.removeEntry(stale[i]); } catch (e) {}
    }
  })();
}

/* ---- 資料夾同步：拆分「寫出」與「掃描匯入」（根治自匯入重複記錄）----
   舊版把「寫出所有記錄」與「掃描未知檔匯入」綁在同一函式，且 saveGame/manualSave
   會並發觸發兩次；先啟動者的 known 快照過期，會把後啟動者剛寫出的檔當外部檔匯入，
   產生同檔名同時間的複本。改為：靜默同步只「寫出」；「掃描匯入」僅在使用者主動
   開啟資料夾時單次執行，並以檔名去重。 */
var _folderWriting = false, _folderPending = false; // 寫出中/待重跑旗標：避免並發重複寫，又不漏寫最新記錄

// 刪除資料夾內對應的實體存檔檔（避免孤兒檔在下次匯入時復活）
function removeFolderFile(fname) {
  if (!_saveDir || !fname) return;
  try { _saveDir.removeEntry(fname).catch(function () {}); } catch (e) {}
}

// 只把目前所有存檔記錄寫成資料夾實體檔（不掃描、不匯入）
function writeAllToFolder() {
  if (!_saveDir) return Promise.resolve({ wrote: 0, skipped: 0, total: 0 });
  if (_folderWriting) { _folderPending = true; return Promise.resolve({ wrote: 0, skipped: 0, total: 0 }); } // 寫出中：標記待重跑，完成後補寫最新 index
  _folderWriting = true;
  var list = saveIndex();
  var wrote = 0;
  var skipped = 0;
  var entries = list.slice();
  // 索引遺失時仍保留目前遊戲進度，避免使用者選定資料夾後得到空資料夾。
  if (!entries.length && localStorage.getItem(SAVE_KEY)) {
    entries.push({ id: null, fname: 'IC_current.json', kind: 'current' });
  }
  var total = entries.length;
  var writeEntry = function (r) {
    var raw = r.kind === 'current' ? localStorage.getItem(SAVE_KEY) : localStorage.getItem(SAVE_REC_PREFIX + r.id);
    // 自動存檔內容若因舊版異常遺失，使用目前存檔回填，至少保住最新進度。
    if (!raw && r.kind === 'auto') raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { skipped++; return Promise.resolve(); }
    return writeRawToFolder(r.fname, raw).then(function () { wrote++; });
  };
  var chain = Promise.resolve();
  entries.forEach(function (r) {
    chain = chain.then(function () { return writeEntry(r); });
  });
  return chain.then(function () {
    _folderWriting = false;
    if (_folderPending) { _folderPending = false; return writeAllToFolder(); } // 期間有新記錄 → 補寫一次
    return { wrote: wrote, skipped: skipped, total: total };
  }, function (e) { _folderWriting = false; _folderPending = false; throw e; });
}

// 單檔安全寫入：失敗時中止暫存寫入，避免資料夾留下 0 KB .crswap 假檔。
function writeRawToFolder(fname, raw) {
  if (!_saveDir) return Promise.reject(new Error('尚未連接存檔資料夾'));
  var writer = null;
  return _saveDir.getFileHandle(fname, { create: true })
    .then(function (fh) { return fh.createWritable({ keepExistingData: false }); })
    .then(function (w) {
      writer = w;
      return writer.write(raw);
    })
    .then(function () { return writer.close(); })
    .catch(function (e) {
      if (writer) {
        try { return writer.abort().catch(function () {}).then(function () { throw e; }); }
        catch (abortErr) {}
      }
      throw e;
    });
}

// 手動存檔在 localStorage 配額不足時，直接把快照落地資料夾，再補回小型索引。
function writeManualSaveToFolder(rec, raw) {
  return writeRawToFolder(rec.fname, raw).then(function () {
    // 索引只保存小型 metadata，絕不能把 5 MB 快照中的 _folderJson 一起寫進 localStorage。
    var meta = {
      id: rec.id, kind: rec.kind, runId: rec.runId, savedAt: rec.savedAt,
      fname: rec.fname, level: rec.level, stage: rec.stage, zone: rec.zone,
      folderOnly: true
    };
    var list = saveIndex();
    if (!list.some(function (x) { return x.id === rec.id; })) list.unshift(meta);
    try { localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(list)); } catch (e) {
      compactSaveRecordStorage();
      try { localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify([meta])); } catch (e2) {}
    }
    return { wrote: 1, skipped: 0, total: 1 };
  });
}

// 掃描資料夾把「index 尚無的檔名」匯入為手動記錄；僅在使用者主動開啟資料夾時呼叫（單次、無並發）
function importUnknownFromFolder() {
  if (!_saveDir) return Promise.resolve(0);
  return (async function () {
    var known = {};
    saveIndex().forEach(function (r) { known[r.fname] = true; });
    var files = [];
    for await (var ent of _saveDir.values()) {
      if (ent.kind === 'file' && /\.json$/i.test(ent.name) && !known[ent.name]) files.push(ent);
    }
    var imported = 0;
    for (var i = 0; i < files.length; i++) {
      // 二次防護：匯入當下若 index 已有同檔名則跳過，杜絕同名複本
      var dup = false;
      saveIndex().forEach(function (r) { if (r.fname === files[i].name) dup = true; });
      if (dup) continue;
      try {
        var text = await (await files[i].getFile()).text();
        var d = JSON.parse(text);
        if (!d || d.version !== 1) continue; // 非本遊戲存檔，跳過
        var folderRec = {
          id: 'm' + Date.now().toString(36) + 'f' + i,
          kind: 'manual', runId: d.runId || 1, savedAt: d.savedAt || Date.now(),
          fname: files[i].name,
          level: (d.player && d.player.level) || 1,
          stage: (d.stage && d.stage.current) || 1,
          zone: (d.stage && d.stage.zone) || 'plains'
        };
        if (!putSaveRecord(folderRec, text)) {
          // 配額不足時只登記本地檔案 metadata，實際內容留在資料夾。
          folderRec.folderOnly = true;
          var metaList = saveIndex();
          metaList.unshift(folderRec);
          try { localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(metaList)); } catch (e3) {
            compactSaveRecordStorage();
            try { localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify([folderRec])); } catch (e4) {}
          }
        }
        imported++;
      } catch (e) { /* 壞檔跳過 */ }
    }
    return imported;
  })();
}

// 已連接資料夾時的靜默同步：只寫出、不掃描匯入（杜絕自匯入重複記錄）
function syncSaveFolder() {
  if (!_saveDir) return;
  writeAllToFolder().catch(function () {});
}

// 後備方案：不支援 File System Access 時，逐檔下載 .json
function downloadAllSaves() {
  saveIndex().forEach(function (r) {
    downloadSingleSave(r.id, r.fname);
  });
}

function downloadRawSave(raw, fname) {
  if (!fname) {
    if (!fname) fname = 'save.json';
  }
  var url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  var a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
}

function downloadSingleSave(id, fname) {
  var raw = localStorage.getItem(SAVE_REC_PREFIX + id);
  if (raw) { downloadRawSave(raw, fname); return Promise.resolve(true); }
  var rec = findSaveRecord(id);
  if (rec && rec.folderOnly && _saveDir) {
    return readFolderSaveRecord(rec).then(function (text) {
      downloadRawSave(text, fname || rec.fname);
      return true;
    }).catch(function () { return false; });
  }
  return Promise.resolve(false);
}

/* ---- 離線收益（時間上限與擊殺估算公式 → js/formula.js §10） ---- */
function applyOfflineProgress() {
  if (!G.savedAt) return;
  var elapsed = (Date.now() - G.savedAt) / 1000;
  if (elapsed < 60) return; // 一分鐘內不計
  elapsed = Math.min(elapsed, OFFLINE_MAX_HOURS * 3600);

  var st = getStats();
  var est = offlineKillEstimate(elapsed);
  var kills = est.kills, m = est.monster, s = est.stage;
  if (kills < 1) return;

  var gold = Math.round(m.gold * kills * (1 + st.goldBonus / 100));
  var xp = Math.round(m.xp * kills * (1 + st.xpBonus / 100));
  G.player.gold += gold;
  gainXp(xp);
  // 掉落：依「物品掉落表」計算各品質期望件數（高品質優先實體化，最多 30 件，其餘折算碎片）
  var rates = dropRatesFor(FIELD_DROP_TABLE, s);
  var lootMult = 1 + st.loot / 100;
  var realDrops = 0, scrapExtra = 0, slotsLeft = 30;
  for (var r = rates.length - 1; r >= 0; r--) {
    if (!rates[r]) continue;
    var cnt = Math.floor(kills * rates[r] * lootMult / 100);
    if (chance((kills * rates[r] * lootMult) % 100)) cnt++;
    var real = Math.min(cnt, slotsLeft);
    for (var i = 0; i < real; i++) pushConveyor(makeEquipment(s, {
      rarity: r,
      ancientRate: ancientAffixChanceForEnemy(m.level)
    }));
    slotsLeft -= real;
    realDrops += real;
    scrapExtra += Math.max(0, cnt - real) * Math.round(3 * RARITIES[r].salv);
  }
  G.player.scrap += scrapExtra;
  var ancientEssenceRate = ancientEssenceDropChanceForEnemy(m.level);
  var ancientEssenceCount = 0;
  if (ancientEssenceRate > 0) {
    var ancientEssencePoints = ancientEssenceRate * kills;
    ancientEssenceCount = Math.floor(ancientEssencePoints / 100);
    if (chance(ancientEssencePoints % 100)) ancientEssenceCount++;
    G.player.ancientEssence += ancientEssenceCount;
  }

  var hrs = Math.floor(elapsed / 3600), mins = Math.floor((elapsed % 3600) / 60);
  blog('🌙 離線收益（' + (hrs ? hrs + ' 小時 ' : '') + mins + ' 分鐘）：擊殺 ' + fmt(kills) +
    '、金幣 +' + fmt(gold) + '、經驗 +' + fmt(xp) +
    '、裝備 x' + realDrops + ' 已送入輸送帶' + (scrapExtra ? '、碎片 +' + fmt(scrapExtra) : '') +
    (ancientEssenceCount ? '、<img src="images/icon_ancient_essence.png" class="res-icon" alt="太古精華">太古精華 +' + fmt(ancientEssenceCount) : ''), 'good');
}

/* ============ 存檔機制 V2：單一自動快取＋本地手動歷史 ============ */
var AUTO_CACHE_KEY_V2 = 'ic_auto_cache_v2';
var AUTO_META_KEY_V2 = 'ic_auto_meta_v2';
var AUTO_FOLDER_FILE_V2 = 'IC_autosave.json';
var MAX_MANUAL_SAVES_V2 = 10;
var _legacyPayloadsCompactedV2 = false;

function removeLegacyRecordPayloadsV2() {
  for (var i = localStorage.length - 1; i >= 0; i--) {
    var key = localStorage.key(i);
    if (key && key !== SAVE_INDEX_KEY && key.indexOf(SAVE_REC_PREFIX) === 0) {
      try { localStorage.removeItem(key); } catch (e) {}
    }
  }
  _legacyPayloadsCompactedV2 = true;
}

function idbSetAutoV2(raw, done) {
  idbKV(function (db) {
    if (!db) { if (done) done(); return; }
    try {
      var tx = db.transaction('kv', 'readwrite');
      tx.oncomplete = function () { if (done) done(); };
      tx.onerror = function () { if (done) done(); };
      tx.onabort = function () { if (done) done(); };
      tx.objectStore('kv').put(raw, AUTO_CACHE_KEY_V2);
    } catch (e) { if (done) done(); }
  });
}

function idbGetAutoV2(cb) {
  idbKV(function (db) {
    if (!db) return cb(null);
    try {
      var req = db.transaction('kv', 'readonly').objectStore('kv').get(AUTO_CACHE_KEY_V2);
      req.onsuccess = function () { cb(req.result || null); };
      req.onerror = function () { cb(null); };
    } catch (e) { cb(null); }
  });
}

function saveManualMetaListV2(list) {
  var seen = {}, clean = [];
  // V2 的完整自動快照由 IndexedDB 保存；先移除舊版 localStorage 大快照，
  // 確保這份小型手動檔索引能正常寫入。
  try { localStorage.removeItem(SAVE_KEY); } catch (e0) {}
  (list || []).forEach(function (r) {
    if (!r || r.kind !== 'manual' || !r.fname || seen[r.fname]) return;
    seen[r.fname] = true;
    clean.push({
      id: r.id, kind: 'manual', runId: r.runId || 1, savedAt: r.savedAt || 0,
      fname: r.fname, level: r.level || 1, stage: r.stage || 1,
      zone: r.zone || 'plains', folderOnly: true
    });
  });
  clean.sort(function (a, b) { return b.savedAt - a.savedAt; });
  clean = clean.slice(0, MAX_MANUAL_SAVES_V2);
  try { localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(clean)); }
  catch (e) {
    compactSaveRecordStorage();
    try { localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(clean)); } catch (e2) {}
  }
  return clean;
}

function saveIndexV2() {
  var list = [];
  try { list = JSON.parse(localStorage.getItem(SAVE_INDEX_KEY)) || []; } catch (e) {}
  return list.filter(function (r) { return r && r.kind === 'manual' && r.fname; })
    .sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); })
    .slice(0, MAX_MANUAL_SAVES_V2);
}

function autoSaveMetaV2() {
  var m = null;
  try { m = JSON.parse(localStorage.getItem(AUTO_META_KEY_V2)); } catch (e) {}
  if (m && m.kind === 'auto') return m;
  return {
    id: 'auto_current', kind: 'auto', runId: (typeof G !== 'undefined' && G ? G.runId || 1 : 1),
    savedAt: (typeof G !== 'undefined' && G ? G.savedAt || Date.now() : Date.now()),
    fname: AUTO_FOLDER_FILE_V2,
    level: (typeof G !== 'undefined' && G && G.player ? G.player.level : 1),
    stage: (typeof G !== 'undefined' && G && G.stage ? G.stage.current : 1),
    zone: (typeof G !== 'undefined' && G && G.stage ? G.stage.zone : 'plains')
  };
}

function writeAutoMetaV2(meta) {
  try { localStorage.setItem(AUTO_META_KEY_V2, JSON.stringify(meta)); } catch (e) {}
}

function readRawTextV2(handle) {
  return handle.getFile().then(function (file) { return file.text(); });
}

function parseSaveTextV2(raw) {
  try {
    var data = JSON.parse(raw);
    if (!data || data.version !== 1) return null;
    return data;
  } catch (e) { return null; }
}

function readFolderAutoV2(cb) {
  if (!_saveDir) { cb(null); return; }
  _saveDir.getFileHandle(AUTO_FOLDER_FILE_V2, { create: false })
    .then(readRawTextV2).then(function (raw) {
      var data = parseSaveTextV2(raw);
      cb(data ? { data: data, savedAt: Number(data.savedAt) || 0 } : null);
    }).catch(function () {
      // 相容舊版保底檔，但只接受自動存檔命名，不把手動存檔當成目前進度。
      (async function () {
        var best = null;
        for await (var ent of _saveDir.values()) {
          if (ent.kind !== 'file' || !/^(IC_current|IC_autosave_run[^.]*)[^/]*\.json$/i.test(ent.name)) continue;
          try {
            var data = parseSaveTextV2(await (await ent.getFile()).text());
            if (!data) continue;
            var ts = Number(data.savedAt) || 0;
            if (!best || ts > best.savedAt) best = { data: data, savedAt: ts };
          } catch (e) {}
        }
        cb(best);
      })().catch(function () { cb(null); });
    });
}

function folderNameHashV2(name) {
  var h = 2166136261;
  for (var i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return 'folder_' + (h >>> 0).toString(36);
}

// 只讀取本地手動檔 metadata，不複製大型 JSON 到瀏覽器。
function scanManualMetadataV2() {
  if (!_saveDir) return Promise.resolve();
  return (async function () {
    var list = saveIndexV2();
    var byName = {};
    list.forEach(function (r) { byName[r.fname] = r; });
    for await (var ent of _saveDir.values()) {
      if (ent.kind !== 'file' || !/^IC_(manual|before_bulk_salvage)_.*\.json$/i.test(ent.name)) continue;
      if (byName[ent.name]) continue;
      try {
        var data = parseSaveTextV2(await (await ent.getFile()).text());
        if (!data) continue;
        list.push({
          id: folderNameHashV2(ent.name), kind: 'manual', runId: data.runId || 1,
          savedAt: Number(data.savedAt) || Date.now(), fname: ent.name,
          level: data.player && data.player.level || 1,
          stage: data.stage && data.stage.current || 1,
          zone: data.stage && data.stage.zone || 'plains', folderOnly: true
        });
      } catch (e) {}
    }
    saveManualMetaListV2(list);
  })();
}

function chooseNewestSaveV2(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (b.savedAt || 0) > (a.savedAt || 0) ? b : a;
}

function loadLatestFolderSaveV2(cb) {
  cb = cb || function () {};
  var finish = function (folderBest) {
    idbGetAutoV2(function (raw) {
      var cacheBest = null;
      var data = parseSaveTextV2(raw);
      if (data) cacheBest = { data: data, savedAt: Number(data.savedAt) || 0 };
      var best = chooseNewestSaveV2(folderBest, cacheBest);
      if (best) best.data = migrateSave(best.data);
      cb(best);
    });
  };
  if (!window.showDirectoryPicker) { finish(null); return; }
  idbGetDir(function (stored) {
    if (!stored || !isValidSaveDirectoryV2(stored)) { finish(null); return; }
    stored.requestPermission({ mode: 'readwrite' }).then(function (perm) {
      if (perm !== 'granted') { finish(null); return; }
      _saveDir = stored;
      scanManualMetadataV2().then(function () { readFolderAutoV2(finish); }).catch(function () { readFolderAutoV2(finish); });
    }).catch(function () { finish(null); });
  });
}

function saveGameV2(opts) {
  if (_saveSuppressed || typeof G === 'undefined' || !G) return false;
  try {
    G.savedAt = Date.now();
    var raw = JSON.stringify(G);
    if (_saveDir && !_legacyPayloadsCompactedV2) removeLegacyRecordPayloadsV2();
    // 大型完整快照只放 IndexedDB，localStorage 僅保留小型 metadata，避免配額阻塞索引。
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    idbSetAutoV2(raw);
    var meta = saveRecMeta('auto', 'auto_current', AUTO_FOLDER_FILE_V2);
    writeAutoMetaV2(meta);
    return true;
  } catch (e3) { return false; }
}

function ensureSaveFolderV2(cb) {
  if (_saveDir && isValidSaveDirectoryV2(_saveDir)) { cb(null, { dirName: _saveDir.name }); return; }
  openSaveFolderV2(function (err, res) { cb(err, res); }, false);
}

function saveFolderMetaV2(rec) {
  var list = saveIndexV2();
  list.unshift(rec);
  return saveManualMetaListV2(list);
}

function createManualSaveToFolderV2(label) {
  if (!_saveDir) return Promise.reject(new Error('尚未選擇本地存檔資料夾'));
  var rec = saveRecMeta('manual', 'manual_' + Date.now().toString(36) + '_' + ri(100, 999),
    'IC_manual_' + saveStamp(Date.now()) + '.json');
  return new Promise(function (resolve) {
    idbGetAutoV2(function (cachedRaw) {
      var raw = cachedRaw;
      if (!raw) {
        try { raw = JSON.stringify(G); } catch (e) { raw = null; }
      }
      resolve(raw);
    });
  }).then(function (raw) {
    if (!raw) throw new Error('找不到可複製的瀏覽器自動存檔快取');
    return writeRawToFolder(rec.fname, raw).then(function () {
      saveFolderMetaV2(rec);
      return rec;
    });
  });
}

function syncAutoSaveToFolderV2() {
  if (!_saveDir) return Promise.resolve(false);
  return new Promise(function (resolve) {
    idbGetAutoV2(function (raw) {
      var data = parseSaveTextV2(raw) || parseSaveTextV2(localStorage.getItem(SAVE_KEY));
      if (!data) { resolve(false); return; }
      writeRawToFolder(AUTO_FOLDER_FILE_V2, JSON.stringify(data)).then(function () {
        writeAutoMetaV2(saveRecMeta('auto', 'auto_current', AUTO_FOLDER_FILE_V2));
        resolve(true);
      }).catch(function () { resolve(false); });
    });
  });
}

function normalizeSaveDirectoryV2(dir) {
  if (!dir) return Promise.reject(new Error('未選擇資料夾'));
  if (dir.name === 'Idle-RPG') {
    return Promise.reject(new Error('目前選到的是遊戲專案根目錄，請改選 Documents 或 Save 資料夾'));
  }
  if (dir.name === 'Documents') {
    return dir.getDirectoryHandle('Idle_RPG', { create: true })
      .then(function (idle) { return idle.getDirectoryHandle('Save', { create: true }); });
  }
  if (dir.name === 'Idle_RPG') return dir.getDirectoryHandle('Save', { create: true });
  return Promise.resolve(dir);
}

function isValidSaveDirectoryV2(dir) {
  return !!dir && dir.name !== 'Idle-RPG';
}

function listSaveFolderFilesV2() {
  if (!_saveDir) return Promise.resolve([]);
  return (async function () {
    var files = [];
    for await (var ent of _saveDir.values()) {
      if (ent.kind !== 'file') continue;
      try {
        var file = await ent.getFile();
        files.push({ name: ent.name, size: file.size, lastModified: file.lastModified });
      } catch (e) {}
    }
    files.sort(function (a, b) { return (b.lastModified || 0) - (a.lastModified || 0); });
    return files;
  })();
}

function openSaveFolderV2(cb, forceOpen) {
  cb = cb || function () {};
  if (!window.showDirectoryPicker) { cb('此瀏覽器不支援本地資料夾存取'); return; }
  idbGetDir(function (stored) {
    var source;
    if (stored && isValidSaveDirectoryV2(stored) && !forceOpen) {
      source = stored.requestPermission({ mode: 'readwrite' }).then(function (perm) {
        if (perm !== 'granted') throw new Error('需要重新選擇資料夾');
        return stored;
      });
    } else {
      source = window.showDirectoryPicker({ id: 'idle_rpg_save_folder', startIn: 'documents', mode: 'readwrite' });
    }
    source.then(normalizeSaveDirectoryV2).then(function (dir) {
      _saveDir = dir;
      idbSetDir(dir);
      return scanManualMetadataV2().then(function () { return listSaveFolderFilesV2(); }).then(function (files) {
        cb(null, { selected: true, dirName: dir.name, files: files });
      });
    }).catch(function (e) {
      cb(e && e.name === 'AbortError' ? '已取消資料夾選擇' : (e.message || '無法連接存檔資料夾'));
    });
  });
}

function readSaveRawV2(rec) {
  if (rec && rec.kind === 'auto') {
    if (_saveDir) return _saveDir.getFileHandle(AUTO_FOLDER_FILE_V2, { create: false }).then(readRawTextV2);
    return new Promise(function (resolve) { idbGetAutoV2(function (raw) { resolve(raw || localStorage.getItem(SAVE_KEY)); }); });
  }
  if (rec && rec.fname && _saveDir) return _saveDir.getFileHandle(rec.fname, { create: false }).then(readRawTextV2);
  var raw = rec ? localStorage.getItem(SAVE_REC_PREFIX + rec.id) : null;
  return raw ? Promise.resolve(raw) : Promise.reject(new Error('找不到本地存檔檔案'));
}

function findSaveRecordV2(id) {
  if (id === 'auto_current') return autoSaveMetaV2();
  var found = null;
  saveIndexV2().forEach(function (r) { if (r.id === id) found = r; });
  return found;
}

function loadSaveRecordV2(id) {
  var rec = findSaveRecordV2(id);
  if (!rec) return Promise.reject(new Error('找不到存檔記錄'));
  return readSaveRawV2(rec).then(function (raw) {
    var data = parseSaveTextV2(raw);
    if (!data) throw new Error('存檔格式錯誤');
    // 讀檔後把載入內容視為目前快取，並更新時間，避免重新整理時被較新的舊自動檔覆蓋。
    data = migrateSave(data);
    data.savedAt = Date.now();
    raw = JSON.stringify(data);
    _saveSuppressed = true;
    writeAutoMetaV2({
      id: 'auto_current', kind: 'auto', runId: data.runId || 1, savedAt: data.savedAt,
      fname: AUTO_FOLDER_FILE_V2,
      level: data.player && data.player.level || 1,
      stage: data.stage && data.stage.current || 1,
      zone: data.stage && data.stage.zone || 'plains'
    });
    idbSetAutoV2(raw, function () { location.reload(); });
    return null;
  });
}

function deleteSaveRecordV2(id) {
  var rec = findSaveRecordV2(id);
  if (!rec) return false;
  var fname = rec.kind === 'auto' ? AUTO_FOLDER_FILE_V2 : rec.fname;
  if (_saveDir) removeFolderFile(fname);
  if (rec.kind !== 'auto') saveManualMetaListV2(saveIndexV2().filter(function (r) { return r.id !== id; }));
  return true;
}

// 新機制入口；舊函式保留供既有存檔格式相容，但不再參與新流程。
MAX_MANUAL_SAVES = MAX_MANUAL_SAVES_V2;
saveIndex = saveIndexV2;
writeSaveIndex = saveManualMetaListV2;
saveGame = saveGameV2;
openSaveFolder = openSaveFolderV2;
syncSaveFolder = syncAutoSaveToFolderV2;
loadLatestFolderSave = loadLatestFolderSaveV2;
loadSaveRecord = loadSaveRecordV2;
deleteSaveRecord = deleteSaveRecordV2;
