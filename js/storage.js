'use strict';
/* ============ 存檔落地層（主執行緒）============
   Worker 沒有 localStorage、IndexedDB 之外的儲存管道，也拿不到 File System Access
   的目錄把手，所以「序列化在 Worker、落地在主執行緒」。本檔就是落地端。

   ---- 為什麼不直接呼叫 save.js 的既有函式 ----
   `saveGameV2` / `createManualSaveToFolderV2` 這些函式都是從主執行緒的 `G` 現場
   序列化。但在 Worker 架構下，主執行緒的 `G` 只是過期鏡像，拿它存檔會回檔。
   所以這裡改成「接收 Worker 給的 json 與 meta」，底層仍**重用** save.js 既有的
   `idbSetAutoV2` / `writeRawToFolder` / `writeAutoMetaV2` / `saveFolderMetaV2`，
   存檔格式與檔名規則因此完全不變，向後相容既有存檔。 */

var SaveStorage = (function () {

  /* 讀出開機用的存檔：資料夾與 IndexedDB 快取取較新者。
     刻意**不呼叫 migrateSave**——遷移是 Worker 的職責，兩邊都做會讓一次性遷移跑兩次。 */
  function readBootSave(cb) {
    var finish = function (folderBest) {
      idbGetAutoV2(function (raw) {
        var cacheBest = null;
        var data = parseSaveTextV2(raw);
        if (data) cacheBest = { data: data, savedAt: Number(data.savedAt) || 0 };
        var best = chooseNewestSaveV2(folderBest, cacheBest);
        cb(best ? best.data : null);
      });
    };
    if (!window.showDirectoryPicker) { finish(null); return; }
    idbGetDir(function (stored) {
      if (!stored || !isValidSaveDirectoryV2(stored)) { finish(null); return; }
      stored.requestPermission({ mode: 'readwrite' }).then(function (perm) {
        if (perm !== 'granted') { finish(null); return; }
        _saveDir = stored;
        scanManualMetadataV2()
          .then(function () { readFolderAutoV2(finish); })
          .catch(function () { readFolderAutoV2(finish); });
      }).catch(function () { finish(null); });
    });
  }

  /* 目前已知的最大局號。重新開局要 +1 才不會蓋掉舊局的自動存檔檔案，
     而存檔索引在主執行緒，所以開機時一併告訴 Worker。 */
  function maxRunId() {
    var maxRun = 1;
    try {
      var auto = autoSaveMetaV2();
      if (auto && (auto.runId || 1) > maxRun) maxRun = auto.runId;
    } catch (e) {}
    try {
      saveIndexV2().forEach(function (r) { if ((r.runId || 1) > maxRun) maxRun = r.runId; });
    } catch (e) {}
    return maxRun;
  }

  /* 自動存檔：完整快照只進 IndexedDB，localStorage 僅留小型 metadata
     （與 saveGameV2 相同策略，避免配額阻塞索引）。 */
  function writeAuto(json, meta, done) {
    try {
      if (_saveDir && typeof removeLegacyRecordPayloadsV2 === 'function' && !_legacyPayloadsCompactedV2) {
        removeLegacyRecordPayloadsV2();
      }
      try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
      idbSetAutoV2(json, function () {
        if (!_saveDir) writeAutoMetaV2(meta);
        done(null);
      });
    } catch (e) { done(e); }
  }

  /* 存檔資料夾同步：把最新快照寫成實體檔案 */
  function writeFolderAuto(json, meta, done) {
    if (!_saveDir) { done(null); return; } // 未連接資料夾不算失敗
    writeRawToFolder(AUTO_FOLDER_FILE_V2, json).then(function (info) {
      var m = {};
      for (var k in meta) m[k] = meta[k];
      m.id = 'auto_current';
      m.kind = 'auto';
      m.fname = AUTO_FOLDER_FILE_V2;
      m.savedAt = Number(info && info.lastModified) || m.savedAt || Date.now();
      writeAutoMetaV2(m);
      done(null);
    }).catch(function (e) { done(e); });
  }

  /* 手動存檔：寫檔 + 更新索引（索引只放 metadata，不放快照） */
  function writeManual(json, meta, done) {
    if (!_saveDir) { done(new Error('尚未選擇本地存檔資料夾')); return; }
    writeRawToFolder(meta.fname, json).then(function (info) {
      var m = {};
      for (var k in meta) m[k] = meta[k];
      m.savedAt = Number(info && info.lastModified) || m.savedAt || Date.now();
      saveFolderMetaV2(m);
      done(null);
    }).catch(function (e) { done(e); });
  }

  /* 重新開局：先把新局狀態落地，再重新載入頁面 */
  function writeRestart(json, meta, done) {
    writeAuto(json, meta, function (err) {
      done(err);
      if (!err) {
        if (typeof showLoadingScreen === 'function') showLoadingScreen();
        location.reload();
      }
    });
  }

  var WRITERS = {
    auto: writeAuto,
    shutdown: writeAuto,
    folder: writeFolderAuto,
    manual: writeManual,
    restart: writeRestart
  };

  /* Worker 送來的 persist 一律走這裡。done(err) 的結果會回報成 saveResult，
     Worker 靠它決定 savedAt 要不要退回——寫入失敗卻回報成功，會讓離線收益漏算。 */
  function persist(kind, json, meta, done) {
    var writer = WRITERS[kind];
    if (!writer) { done(new Error('unknown persist kind: ' + kind)); return; }
    try { writer(json, meta, done); }
    catch (e) { done(e); }
  }

  return {
    readBootSave: readBootSave,
    maxRunId: maxRunId,
    persist: persist
  };
})();
