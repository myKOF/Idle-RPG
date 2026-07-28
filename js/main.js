'use strict';
/* ============ 遊戲入口 ============
   P5 起模擬與存檔的權威**只在 Worker**，主執行緒不再持有 G。

   在此之前，這支檔案不分模式都會 loadGame() → G = loaded → applyOfflineProgress()
   → saveGame()，等於主執行緒揹著一份完整但凍結的重複狀態：存檔讀兩次、migrate 跑兩次、
   離線結算算兩次（其中一次算完就丟）、後期存檔的背包在記憶體裡有兩份。
   那些現在全部由 Worker 負責，開機訊息也改由 Worker 隨 BOOTED 的 notices 送出——
   「可用 N 點」「背包超出容量 X/Y」這類補充值只有握著 G 的那一側算得出來。

   主執行緒剩下的職責：把 UI 跑起來、轉發存檔資料夾授權、檢查新版本。 */

/* 主執行緒永不寫存檔：save.js 的所有寫入路徑一律短路，避免與 Worker 搶權威造成回檔。 */
_saveSuppressed = true;

function updateContentFingerprint(text) {
  var hash = 2166136261;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16) + ':' + text.length;
}

function checkForUpdates() {
  if (typeof document !== 'undefined' && document.hidden) return; // 背景分頁不檢查新版本
  var url = location.href.split('#')[0];
  url += (url.indexOf('?') === -1 ? '?' : '&') + '_t=' + Date.now();
  fetch(url, { cache: 'no-store' })
    .then(function(res) {
      return res.ok ? res.text() : null;
    })
    .then(function(body) {
      if (body == null) return;
      var hash = updateContentFingerprint(body);
      if (!hash) return;
      if (!window._appVersionHash) window._appVersionHash = hash;
      else if (window._appVersionHash !== hash) {
        var banner = document.getElementById('update-banner');
        if (banner) banner.style.display = 'block';
      }
    })
    .catch(function(e){});
}

document.addEventListener('DOMContentLoaded', function () {
  initUI();
  if (typeof initGM === 'function') initGM();

  /* 清理存檔資料夾「自匯入」bug 產生的同檔名重複記錄。
     這件事操作的是主執行緒的存檔索引（localStorage），不需要 G，留在這裡。 */
  var dupRemoved = (typeof dedupeSaveIndex === 'function') ? dedupeSaveIndex() : 0;
  if (dupRemoved > 0) blog('🧹 已清理 ' + dupRemoved + ' 筆重複的存檔記錄（存檔資料夾自匯入問題已修正）', 'info');

  setInterval(uiTick, 200);

  // 檢查新版本 (每 3 分鐘)
  setTimeout(checkForUpdates, 3000);
  setInterval(checkForUpdates, 3 * 60000);

  // 啟動時自動重新連接上次使用的存檔資料夾（靜默、不跳視窗）
  if (window.showDirectoryPicker) {
    idbGetDir(function (stored) {
      if (stored) {
        if (typeof isValidSaveDirectoryV2 === 'function' && !isValidSaveDirectoryV2(stored)) {
          var invalidBn = document.getElementById('save-folder-banner');
          if (invalidBn) invalidBn.style.display = 'block';
          return;
        }
        stored.requestPermission({ mode: 'readwrite' }).then(function (perm) {
          if (perm !== 'granted') {
            // 需要使用者重新授權，顯示提示 Banner
            var bn = document.getElementById('save-folder-banner');
            if (bn) bn.style.display = 'block';
            return;
          }
          _saveDir = stored;
          // 已連接，隱藏 Banner
          var bn = document.getElementById('save-folder-banner');
          if (bn) bn.style.display = 'none';
        }).catch(function () {
          var bn = document.getElementById('save-folder-banner');
          if (bn) bn.style.display = 'block';
        });
      } else {
        // 從未設定過資料夾，顯示引導 Banner
        var bn = document.getElementById('save-folder-banner');
        if (bn) bn.style.display = 'block';
      }
    });
  }

  // Banner 上的按鈕 (與 btn-folder 共用邏輯)
  var btnFolderBanner = document.getElementById('btn-folder-banner');
  if (btnFolderBanner) {
    btnFolderBanner.addEventListener('click', function () {
      var m = document.getElementById('save-msg');
      if (m) m.textContent = '⏳ 請在跳出的視窗中選擇存檔資料夾…';
      openSaveFolder(function (err, res) {
        var text;
        if (err) {
          text = '⚠️ ' + err;
        } else {
          var bn = document.getElementById('save-folder-banner');
          if (bn) bn.style.display = 'none';
          text = '✅ 已選定存檔資料夾「' + res.dirName + '」；自動存檔將每 10 分鐘同步一次。';
        }
        if (m) m.textContent = text;
        blog(text, err ? 'warn' : 'good');
        if (res && res.files && typeof renderSaveFolderFilesV2 === 'function') renderSaveFolderFilesV2(res.files);
        if (typeof renderSaveList === 'function') renderSaveList();
      }, true);
    });
  }
  if (typeof hideLoadingScreen === 'function') hideLoadingScreen();
});
