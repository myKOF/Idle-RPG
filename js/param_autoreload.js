'use strict';
/* ============ 參數自動重載（僅本機開發環境） ============
   雙擊「套用參數.bat」套用 game_parameters.csv 後，apply_params 會更新根目錄的
   params_version.txt；本監看器每 2 秒讀一次該檔，內容一有變動就自動重新整理頁面，
   讓新數值立即生效，不必手動 F5。
   - 只在 localhost / 127.0.0.1 / ::1 運作；外部玩家不受影響（也不會有這支輪詢）。 */
(function () {
  var h = location.hostname;
  if (h !== 'localhost' && h !== '127.0.0.1' && h !== '::1') return;

  var last = null;
  function poll() {
    fetch('params_version.txt?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (v) {
        if (v == null) return;
        v = v.trim();
        if (last === null) { last = v; return; } // 首次只記錄，不重載
        if (v !== last) { last = v; location.reload(); }
      })
      .catch(function () { /* 檔案暫時讀不到就略過，下次再試 */ });
  }
  setInterval(poll, 2000);
  poll();
})();
