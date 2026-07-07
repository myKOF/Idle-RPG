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
});
