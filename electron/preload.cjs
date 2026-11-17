'use strict';
/* ============ 桌面外殼暴露給遊戲頁面的 API：window.ApexHost ============
   名稱沿用 js/ui.js 既有的約定（存檔頁「開啟存檔資料夾」按鈕在
   window.ApexHost.openSaveFolder 存在時才顯示），不另立第二套。

   遊戲程式以「有沒有這個函式」判斷桌面功能，網頁版不受影響。
   openSaveFolder 刻意還沒提供：桌面存檔後端（任務 C）完成前，
   userData 裡沒有存檔檔案，打開只會是空資料夾。 */

var electron = require('electron');

electron.contextBridge.exposeInMainWorld('ApexHost', {
  isDesktop: true,
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  // 關閉遊戲：走主行程的關窗流程，一樣會先存檔
  quit: function () { electron.ipcRenderer.send('apexhost:quit'); }
});
