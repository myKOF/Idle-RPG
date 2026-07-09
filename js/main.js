'use strict';
/* ============ 遊戲入口 / 主迴圈 ============ */

var TICK_MS = 100;
var _autosaveTimer = 0;
var _lastTickAt = Date.now();

function stepGame(dt) {
  GT += dt;
  fieldTick(dt);
  towerTick(dt);
  factoryTick(dt);
  _autosaveTimer += dt;
  if (_autosaveTimer >= 15) { _autosaveTimer = 0; saveGame(); }
}

function checkForUpdates() {
  var url = location.href.split('#')[0];
  url += (url.indexOf('?') === -1 ? '?' : '&') + '_t=' + Date.now();
  fetch(url, { method: 'HEAD' })
    .then(function(res) {
      var hash = res.headers.get('Last-Modified') || res.headers.get('ETag');
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
  var loaded = loadGame();
  G = loaded || newGameState();
  markStatsDirty();
  initUI();
  initFieldPlayer();

  if (loaded) {
    blog('📖 歡迎回來，冒險者！讀取存檔成功。', 'good');
    // 技能點異常修復公告（migrateSave 偵測到超支重置時設定）
    if (G._skillResetNotice) {
      blog('🛠️ 偵測到技能點異常：已使用 ' + G._skillResetNotice +
        '，已重置所有技能並發還初始技能。技能點已依等級全額退還（可用 ' + availableSkillPoints() +
        ' 點），請重新配點；之後升級將正常獲得技能點。', 'warn');
      delete G._skillResetNotice;
    }
    applyOfflineProgress();
  } else {
    blog('⚔️ 歡迎來到《無限征途：合成之巔》！', 'good');
    blog('你的角色會自動戰鬥。掉落的裝備會流進【生產線】，記得去設定篩選 / 分解 / 合成規則！', 'info');
    blog('💡 提示：預設「普通」品質會自動分解成碎片，撿到更強的裝備會自動換上。', 'info');
    flog('🏭 生產線已啟動。試著把某個稀有度的處置改成「合成素材」，就能開始自動合成！', 'info');
  }

  setInterval(gameTick, TICK_MS);
  setInterval(uiTick, 200);
  window.addEventListener('beforeunload', saveGame);
  
  // 檢查新版本 (每 3 分鐘)
  setTimeout(checkForUpdates, 3000);
  setInterval(checkForUpdates, 3 * 60000);

  // 啟動時自動重新連接上次使用的存檔資料夾（靜默、不跳視窗）
  if (window.showDirectoryPicker) {
    idbGetDir(function (stored) {
      if (stored) {
        stored.requestPermission({ mode: 'readwrite' }).then(function (perm) {
          if (perm !== 'granted') {
            // 需要使用者重新授權，顯示提示 Banner
            var bn = document.getElementById('save-folder-banner');
            if (bn) bn.style.display = 'block';
            return;
          }
          _saveDir = stored;
          syncSaveFolder();
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
          text = '✅ 已連接「' + res.dirName + '」，之後每次存檔都會自動同步到這個資料夾！';
        }
        if (m) m.textContent = text;
        blog('📂 ' + text, err ? 'warn' : 'good');
        if (typeof renderSaveList === 'function') renderSaveList();
      });
    });
  }
});
