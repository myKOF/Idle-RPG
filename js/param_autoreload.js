'use strict';
/* ============ 參數自動重載（僅本機開發環境） ============
   雙擊「套用參數.bat」套用 game_parameters.csv 後，apply_params 會更新根目錄的
   params_version.txt；本監看器每 2 秒讀一次該檔，內容一有變動就自動重新整理頁面，
   讓新數值立即生效，不必手動 F5。
   - 只在 localhost / 127.0.0.1 / ::1 運作；外部玩家不受影響（也不會有這支輪詢）。 */
(function () {
  var h = location.hostname;
  if (h !== 'localhost' && h !== '127.0.0.1' && h !== '::1') return;

  /* params_version.txt 由「套用參數.bat」產生，而且被 .gitignore 排除（.gitignore:48），
     所以**沒跑過那支批次檔的工作副本根本沒有這個檔**。以固定 2 秒輪詢一個不存在的檔案，
     結果是 console 每 2 秒被瀏覽器記一筆 404，而且永遠不會自己好——真正的錯誤訊息
     會被淹沒在裡面。fetch 的 catch 攔不掉那筆記錄：404 是成功的 HTTP 往返，
     瀏覽器仍會記；唯一能少噴的辦法就是少發請求。

     所以讀不到時退避成慢速探測，檔案一出現立刻回到 2 秒。功能不變，
     只是在「這個副本沒在用參數表」的情況下安靜下來。 */
  var FAST_MS = 2000;
  var SLOW_MS = 30000;

  var last = null;
  var timer = 0;
  var period = 0;
  var warned = false;

  function schedule(ms) {
    if (period === ms) return;
    period = ms;
    if (timer) clearInterval(timer);
    timer = setInterval(poll, ms);
  }

  function poll() {
    if (document.hidden) return; // 背景分頁不輪詢
    fetch('params_version.txt?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (v) {
        if (v == null) {
          if (!warned) {
            warned = true;
            console.info('[params] 找不到 params_version.txt，參數自動重載改為 ' +
              (SLOW_MS / 1000) + ' 秒探測一次。執行「套用參數.bat」產生該檔後會自動恢復即時偵測。');
          }
          schedule(SLOW_MS);
          return;
        }
        warned = false;
        schedule(FAST_MS);
        v = v.trim();
        if (last === null) { last = v; return; } // 首次只記錄，不重載
        if (v !== last) { last = v; location.reload(); }
      })
      .catch(function () { schedule(SLOW_MS); }); // 伺服器沒起來也不必猛敲
  }
  schedule(FAST_MS);
  poll();
})();
