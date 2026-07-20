'use strict';
/* ============ 遊戲入口 / 主迴圈 ============ */

var TICK_MS = 100;
var _autosaveTimer = 0;
var _folderAutosaveTimer = 0;
var _lastTickAt = Date.now();

function stepGame(dt) {
  var combatPaused = typeof isCombatPaused === 'function' && isCombatPaused();
  if (!combatPaused) GT += dt;
  if (typeof forgeTick === 'function') forgeTick(Date.now());
  if (!combatPaused) {
    fieldTick(dt);
    towerTick(dt);
  }
  factoryTick(dt);
  if (typeof newForgeTick === 'function') newForgeTick(dt);
  _autosaveTimer += dt;
  if (_autosaveTimer >= 15) { _autosaveTimer = 0; saveGame(); }
  _folderAutosaveTimer += dt;
  if (_folderAutosaveTimer >= 600) { _folderAutosaveTimer = 0; syncSaveFolder(); }
}

function updateContentFingerprint(text) {
  var hash = 2166136261;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16) + ':' + text.length;
}

function checkForUpdates() {
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

// 以實際經過時間切片模擬（背景分頁被瀏覽器節流時仍維持正常遊戲速度）
function gameTick() {
  var now = Date.now();
  var elapsed = (now - _lastTickAt) / 1000;
  _lastTickAt = now;
  // 單次最多補 10 秒（更長的間隔由離線收益機制處理）
  elapsed = Math.min(elapsed, 10);
  while (elapsed > 0.0001) {
    var dt = Math.min(elapsed, TICK_MS / 1000);
    stepGame(dt);
    elapsed -= dt;
  }
}

document.addEventListener('DOMContentLoaded', function () {
  var localLoaded = loadGame();
  loadLatestFolderSave(function (folderSave) {
  var loaded = localLoaded;
  if (folderSave && (!loaded || (folderSave.savedAt || 0) > (loaded.savedAt || 0))) {
    loaded = folderSave.data;
  }
  G = loaded || newGameState();
  markStatsDirty();
  initUI();
  if (typeof initGM === 'function') initGM();
  initFieldPlayer();

  if (loaded) {
    // 清理存檔資料夾「自匯入」bug 產生的同檔名重複記錄
    var dupRemoved = (typeof dedupeSaveIndex === 'function') ? dedupeSaveIndex() : 0;
    if (dupRemoved > 0) blog('🧹 已清理 ' + dupRemoved + ' 筆重複的存檔記錄（存檔資料夾自匯入問題已修正）', 'info');
    blog('📖 歡迎回來，冒險者！讀取存檔成功。', 'good');
    // 技能點異常修復公告（migrateSave 偵測到超支重置時設定）
    if (G._skillResetNotice) {
      blog('🛠️ 偵測到技能點異常：已使用 ' + G._skillResetNotice +
        '，已重置所有技能並發還初始技能。技能點已依等級全額退還（可用 ' + availableSkillPoints() +
        ' 點），請重新配點；之後升級將正常獲得技能點。', 'warn');
      delete G._skillResetNotice;
    }
    if (G._skillPointRepairNotice) {
      blog('🧮 ' + G._skillPointRepairNotice + '；目前可用技能點 ' + availableSkillPoints() + ' 點。', 'info');
      delete G._skillPointRepairNotice;
    }
    // 天賦系統 V2 改版公告（migrateSave 一次性重置退點時設定）
    if (G._talentRespecNotice) {
      blog('🌟 ' + G._talentRespecNotice + '，請至【天賦】頁重新配點（新制成本＝天賦轉數+9／級，Lv.51 起每級加倍）。', 'warn');
      delete G._talentRespecNotice;
    }
    /* ONE-TIME MIGRATION: talentTreesV2RespecV1（登錄於 ONE_TIME_MIGRATIONS.md）
       外部玩家已 1 轉且曾升級任一天賦 → 改版一次性二次確認窗；顯示後即刪旗標，不會再次彈出。 */
    if (G._talentRespecConfirm) {
      if (typeof showConfirmDialog === 'function') {
        showConfirmDialog('天賦系統已重新改造，請重新配置！', null, { title: '天賦系統改版', okText: '我知道了', cancelText: '關閉' });
      }
      delete G._talentRespecConfirm;
    }
    // 背包超量提示（修正超量收納漏洞前的遺留）
    var invCapNow = typeof inventoryCapacityWithTalents === 'function' ? inventoryCapacityWithTalents() : INVENTORY_CAP + (G.player.invUpgrades || 0);
    if (G.inventory.length > invCapNow) {
      blog('⚠️ 背包超出容量（' + G.inventory.length + '/' + invCapNow + '）。今後滿載時將維持上限：新裝備與包內未鎖定最弱者「捨弱留強」擇一保留（上鎖裝備不受影響）。超出的部分可用「分解設定」批次清理。', 'warn');
    }
    applyOfflineProgress();
    // 熔爐系統合併改版：舊存檔第一次載入顯示公告彈窗＋熔爐頁籤閃爍（migrateSave 設旗標）
    if (typeof showForgeRebuildNotice === 'function') showForgeRebuildNotice();
  } else {
    blog('⚔️ 歡迎來到《無限征途：合成之巔》！', 'good');
    blog('你的角色會自動戰鬥。掉落的裝備會流進【熔爐】，記得去勾選各熔爐要拆解的品質！', 'info');
    blog('💡 提示：預設普通~傳說品質會自動拆解成碎片與精華，未勾選品質會保留入包。', 'info');
    flog('🏭 熔爐已啟動。掉落裝備會依各熔爐勾選的品質自動拆解或保留。', 'info');
  }

  setInterval(gameTick, TICK_MS);
  setInterval(uiTick, 200);
  window.addEventListener('beforeunload', function () {
    if (typeof showLoadingScreen === 'function') showLoadingScreen();
    saveGame();
  });
  
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
});
