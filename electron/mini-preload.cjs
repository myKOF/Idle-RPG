'use strict';
var electron = require('electron');
var ipc = electron.ipcRenderer;
// 迷你頁沒有存檔、Steam、顯示設定或一般主視窗權限。
electron.contextBridge.exposeInMainWorld('ApexMini', {
  initial: function () { return ipc.invoke('mini:initial'); },
  ready: function () { return ipc.invoke('mini:ready'); },
  restore: function () { ipc.send('mini:restore'); },
  onUpdate: function (fn) { ipc.on('mini:update', function (_event, snapshot) { fn(snapshot); }); }
});
