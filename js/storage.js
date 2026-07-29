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

  /* 開機存檔的來歷。開機流程用它決定要不要先問過玩家（見 js/save_origin.js）：
       own     這個 origin 自己的自動存檔，或瀏覽器本機快取 → 直接用
       legacy  資料夾裡的舊檔名或更舊的保底檔 → 可能是別的網址留下的，要確認
       foreign 檔名是自己的，但內容標記著別的 origin → 要確認
     fallback 是玩家拒絕接手時的替代品：瀏覽器本機快取那一份（null 代表只能開新遊戲）。
     本機快取（IndexedDB）永遠不必確認——它的作用域就是 origin，不可能是別人寫的。 */
  function bootSaveInfo(best, folderBest, cacheBest) {
    var info = {
      source: 'none', fname: null, savedBy: null, fallback: null,
      originTag: (typeof SAVE_ORIGIN_TAG_V2 === 'string') ? SAVE_ORIGIN_TAG_V2 : ''
    };
    if (!best) return info;
    info.savedBy = (best.data && best.data.savedBy) || null;
    if (best !== folderBest) { info.source = 'own'; return info; }
    info.fname = folderBest.fname || null;
    info.fallback = cacheBest ? cacheBest.data : null;
    info.source = (folderBest.source === 'legacy') ? 'legacy' : 'own';
    if (info.source === 'own' && info.savedBy && info.savedBy !== info.originTag) info.source = 'foreign';
    return info;
  }

  /* 讀出開機用的存檔：資料夾與 IndexedDB 快取取較新者。
     刻意**不呼叫 migrateSave**——遷移是 Worker 的職責，兩邊都做會讓一次性遷移跑兩次。 */
  function readBootSave(cb) {
    var finish = function (folderBest) {
      idbGetAutoV2(function (raw) {
        var cacheBest = null;
        var data = parseSaveTextV2(raw);
        if (data) cacheBest = { data: data, savedAt: Number(data.savedAt) || 0 };
        var best = chooseNewestSaveV2(folderBest, cacheBest);
        cb(best ? best.data : null, bootSaveInfo(best, folderBest, cacheBest));
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

  /* 明確「另存到資料夾」：寫檔 + 更新索引（索引只放 metadata，不放快照）。
     沒接資料夾就該失敗——使用者按的是「存到資料夾」，偷偷存到別處等於騙人。 */
  function writeManualFolder(json, meta, done) {
    if (!_saveDir) { done(new Error('尚未選擇本地存檔資料夾')); return; }
    writeRawToFolder(meta.fname, json).then(function (info) {
      var m = {};
      for (var k in meta) m[k] = meta[k];
      m.savedAt = Number(info && info.lastModified) || m.savedAt || Date.now();
      saveFolderMetaV2(m);
      done(null);
    }).catch(function (e) { done(e); });
  }

  /* 一般手動存檔：與舊路徑的 manualSave 同語意——先寫瀏覽器存檔記錄，
     寫不進去（配額不足）且已連接資料夾時才落地資料夾。

     這條路徑不能要求資料夾：一鍵分解前的保護存檔走的就是它，
     多數玩家沒有連接資料夾，若在此失敗，那份保護存檔就等於不存在。 */
  function writeManual(json, meta, done) {
    var stored = false;
    try { stored = putSaveRecord(meta, json); } catch (e) { stored = false; }
    if (stored) { done(null); return; }
    if (!_saveDir) { done(new Error('瀏覽器儲存空間不足，且未連接存檔資料夾')); return; }
    writeManualFolder(json, meta, done);
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
    manualFolder: writeManualFolder,
    restart: writeRestart
  };

  /* ---- 落地時機 ----
     實測（後期存檔 800 件、JSON 約 400 KB）：一次自動存檔在主執行緒佔用約 5.9 ms，
     其中約 2.5 ms 是 gzip 前的 Blob 建立、2.7 ms 是 IndexedDB 寫入的同步部分。
     每 15 秒一次，落在 16.7 ms 的畫格預算裡是三分之一格。

     這些成本本身無法在主執行緒消除（壓縮與 IndexedDB API 都只能在這裡做），
     但可以不要卡在畫格中間——自動存檔沒有時效性，晚幾毫秒落地沒有任何差別。

     ⚠️ 只有 auto 與 folder 可以延後。shutdown 是分頁要關了、restart 會接著 reload、
     manual 是使用者按下去等結果——這三種延後就等於可能不會發生。 */
  var DEFERRABLE = { auto: true, folder: true };

  function runWhenIdle(fn) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(fn, { timeout: 2000 }); // 逾時強制執行，不能無限延後
      return;
    }
    setTimeout(fn, 0);
  }

  /* ---- 同種類寫入的合併 ----
     auto 與 folder 都是「最新狀態整份覆蓋前一份」的寫入，排隊把舊的依序寫完沒有任何意義：
     每一份都會被下一份蓋掉，中間那些純粹是白花的 gzip 與磁碟 I/O。

     原本這裡沒有任何合併，Worker 送一則就寫一次。平常 15 秒才一則，看不出問題；
     一旦上游短時間內連送多則（補進度時曾放大到每 0.1 秒一則），requestIdleCallback 的
     2 秒 timeout 一定逾時，於是全部擠成連續寫入，主執行緒被塞滿。
     這裡是第二道保險：即使上游又出問題，落地端也只會寫最新的一份。

     被合併掉的請求仍然要回報結果，不能靜靜丟掉——bridge.js 靠這個回呼遞減 _pendingWrites
     （分頁交接要等它歸零），Worker 靠 saveResult 決定 savedAt 要不要退回。
     回報的是「取代它的那次寫入」的真實結果：若那次也失敗就一起退回，
     savedAt 才不會停在一個從未落地的時間點上。

     ⚠️ shutdown 走的雖然也是 writeAuto，但它不可延後、也不進這個佇列（見 DEFERRABLE）。
     它與已在飛行中的 auto 寫入之間的先後順序不受此處保護，維持既有行為。 */
  var _writeSlots = {};   // kind -> { running, next:{json,meta}, waiters:[done] }

  function coalescedPersist(kind, writer, json, meta, done) {
    var slot = _writeSlots[kind];
    if (!slot) slot = _writeSlots[kind] = { running: false, next: null, waiters: [] };
    slot.next = { json: json, meta: meta };   // 後到的直接取代待寫那筆
    slot.waiters.push(done);
    if (slot.running) return;                 // 飛行中：等它寫完後由 pump 接續最新的一筆
    slot.running = true;

    var pump = function () {
      var job = slot.next;
      var waiters = slot.waiters;
      slot.next = null;
      slot.waiters = [];
      if (!job) { slot.running = false; return; }
      var finish = function (err) {
        for (var i = 0; i < waiters.length; i++) {
          try { waiters[i](err); } catch (e) {}
        }
        pump();   // 寫入期間若又有新的請求進來，這裡接著寫最新那份
      };
      runWhenIdle(function () {
        try { writer(job.json, job.meta, finish); }
        catch (e) { finish(e); }
      });
    };
    pump();
  }

  /* Worker 送來的 persist 一律走這裡。done(err) 的結果會回報成 saveResult，
     Worker 靠它決定 savedAt 要不要退回——寫入失敗卻回報成功，會讓離線收益漏算。 */
  function persist(kind, json, meta, done) {
    var writer = WRITERS[kind];
    if (!writer) { done(new Error('unknown persist kind: ' + kind)); return; }
    if (DEFERRABLE[kind]) { coalescedPersist(kind, writer, json, meta, done); return; }
    try { writer(json, meta, done); }
    catch (e) { done(e); }
  }

  return {
    readBootSave: readBootSave,
    maxRunId: maxRunId,
    persist: persist
  };
})();
