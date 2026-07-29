'use strict';
/* ============ 跨 origin 存檔接手確認（主執行緒）============
   ---- 為什麼需要 ----
   存檔資料夾是實體目錄，不分 origin；瀏覽器的 IndexedDB、localStorage、navigator.locks
   則全部以 origin 為界。這個落差就是 2026-07-29 事故的結構性成因：
   127.0.0.1:5500 與 localhost:8341 各自以為自己是唯一的玩家，卻共用同一個 Saves 資料夾。

   自動存檔改成一個 origin 一個檔名之後（見 js/save.js 的 AUTO_FOLDER_FILE_V2），
   互相覆寫已經不會再發生。但還有一條路徑會讓一個網址靜靜接手另一個網址的角色：
   **找不到自己的檔案時回退讀舊檔名 `IC_autosave.json`**。這條回退是必要的
   （既有玩家升級後第一次開機就靠它），但它讀到的那份可能是別的網址寫的。

   所以回退接手一律先問過玩家。開機流程原本是「讀出最新的存檔就直接開機」，
   中間沒有任何人有機會表示意見——存檔覆蓋是不可逆的，不該由時間戳大小自己決定。

   ---- 為什麼遮罩寫在這裡而不是 ui.js ----
   與 js/tablock.js 同樣的理由：這個決定必須在 initUI() 之前、Worker 開機之前做完，
   那時 UI 還沒有任何東西可用。樣式沿用 tablock.js 的同一套視覺語言，不另立一套。 */

var SaveOrigin = (function () {
  var _overlay = null;

  function describe(save) {
    var lv = (save && save.player && save.player.level) || 1;
    var stage = (save && save.stage && save.stage.current) || 1;
    var at = Number(save && save.savedAt) || 0;
    var when = at ? new Date(at).toLocaleString() : '存檔時間不明';
    return 'Lv.' + lv + '　第 ' + stage + ' 關　　' + when;
  }

  function reason(info) {
    if (info.source === 'foreign') {
      return '資料夾裡這份自動存檔（' + (info.fname || '檔名不明') + '）標記的來源是「' +
        info.savedBy + '」，與目前的網址「' + info.originTag + '」不同。';
    }
    return '找不到這個網址自己的自動存檔，資料夾裡只有舊檔名的那一份（' +
      (info.fname || '檔名不明') + '）。存檔資料夾不分網址，它有可能是另一個網址的遊戲留下的。';
  }

  function removeOverlay() {
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;
  }

  function showConfirm(save, info, decide) {
    var overlay = document.createElement('div');
    overlay.id = 'save-origin-notice';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100001;display:flex;align-items:center;' +
      'justify-content:center;padding:24px;background:rgba(3,7,18,.92);';

    var card = document.createElement('div');
    card.style.cssText = 'width:min(560px,100%);padding:24px;border:1px solid #f59e0b;border-radius:14px;' +
      'background:#111827;color:#f9fafb;box-shadow:0 20px 60px rgba(0,0,0,.55);text-align:center;';

    var title = document.createElement('h2');
    title.style.cssText = 'margin:0 0 12px;color:#fcd34d;';
    title.textContent = '⚠️ 要接手這份存檔嗎？';

    var desc = document.createElement('p');
    desc.style.cssText = 'margin:0 0 14px;line-height:1.65;text-align:left;';
    desc.textContent = reason(info);

    var detail = document.createElement('p');
    detail.style.cssText = 'margin:0 0 14px;padding:10px 12px;border-radius:8px;background:#0b1220;' +
      'font-family:ui-monospace,monospace;line-height:1.6;';
    detail.textContent = describe(save);

    var hint = document.createElement('p');
    hint.style.cssText = 'margin:0 0 18px;line-height:1.65;text-align:left;color:#cbd5e1;font-size:.94em;';
    hint.textContent = '接手後，這個網址會改用自己的檔名（' + AUTO_FOLDER_FILE_V2 +
      '）繼續存檔，不會再和其他網址互相覆蓋。' +
      (info.fallback
        ? '選擇不接手的話，會改用這個網址自己的瀏覽器存檔繼續。'
        : '選擇不接手的話，會開始新的一局——原本那份檔案不會被刪除或覆寫。');

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;';

    var finish = function (accepted) {
      removeOverlay();
      decide(accepted);
    };

    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'btn';
    yes.textContent = '接手這份存檔';
    yes.addEventListener('click', function () { finish(true); });

    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'btn';
    no.textContent = info.fallback ? '不接手，用本機的存檔' : '不接手，開新的一局';
    no.addEventListener('click', function () { finish(false); });

    row.appendChild(yes);
    row.appendChild(no);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(detail);
    card.appendChild(hint);
    card.appendChild(row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    _overlay = overlay;
    yes.focus();

    // Loading 動畫留在遮罩底下會一直轉，玩家會以為還在載入
    if (typeof hideLoadingScreen === 'function') hideLoadingScreen();
  }

  /* 開機流程的關卡。`info` 由 SaveStorage.readBootSave 提供。
     只有「回退讀到的舊檔名」與「標記著別的 origin」兩種來源需要確認；
     自己的檔案與瀏覽器本機快取一律直接放行，正式環境的玩家永遠不會看到這個視窗。 */
  function gate(save, info, next) {
    info = info || {};
    if (!save || (info.source !== 'legacy' && info.source !== 'foreign')) { next(save); return; }
    if (typeof document === 'undefined' || !document.body) { next(save); return; }
    showConfirm(save, info, function (accepted) {
      next(accepted ? save : (info.fallback || null));
    });
  }

  return {
    gate: gate,
    /* 測試與除錯用 */
    _internal: { describe: describe, reason: reason }
  };
})();
