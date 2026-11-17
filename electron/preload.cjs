'use strict';
/* ============ 桌面外殼暴露給遊戲頁面的 API：window.ApexHost ============
   名稱沿用 js/ui.js 既有的約定（存檔頁「開啟存檔資料夾」按鈕在
   window.ApexHost.openSaveFolder 存在時才顯示），不另立第二套。

   遊戲程式以「有沒有這個函式」判斷桌面功能，網頁版不受影響。 */

var electron = require('electron');
var ipc = electron.ipcRenderer;

// 頁面與 preload 是不同的 world：型別用 isView／標籤判斷，不用 instanceof
function toBytes(data) {
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') return new Uint8Array(data);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  throw new Error('存檔內容格式不支援');
}

electron.contextBridge.exposeInMainWorld('ApexHost', {
  isDesktop: true,
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  // 關閉遊戲：走主行程的關窗流程，一樣會先存檔
  quit: function () { ipc.send('apexhost:quit'); },
  // 用檔案總管打開存檔資料夾（userData/saves，固定位置、不可自選）
  openSaveFolder: function () { return ipc.invoke('saves:open-folder'); },
  /* 存檔檔案：js/desktop-save-dir.js 把它包成 File System Access 的目錄把手。
     檔名限單層 *.json（主行程再驗一次）；寫入是原子的（暫存檔＋rename）。 */
  /* Steam（任務 D）：沒接 Steam 時一樣存在，status().enabled 為 false、解鎖成就回傳空結果 */
  steam: {
    status: function () { return ipc.invoke('steam:status'); },
    activateAchievements: function (names) {
      return ipc.invoke('steam:activate-achievements', Array.isArray(names) ? names.map(String) : []);
    }
  },
  saves: {
    list: function () { return ipc.invoke('saves:list'); },
    read: function (name) { return ipc.invoke('saves:read', String(name)); },
    write: function (name, data) { return ipc.invoke('saves:write', String(name), toBytes(data)); },
    remove: function (name) { return ipc.invoke('saves:remove', String(name)); }
  }
});
