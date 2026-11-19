'use strict';
var path = require('path');

// 只有一份遊戲與 Worker；迷你視窗只顯示主頁提供的戰況。
exports.create = function (options) {
  var owner = options.owner, mini = null, pending = null, disposed = false;
  var previousThrottling = null;
  function restoreOwner() {
    if (owner.isDestroyed()) return;
    if (previousThrottling !== null) {
      owner.webContents.setBackgroundThrottling(previousThrottling);
      previousThrottling = null;
    }
    if (!disposed) {
      if (owner.isMinimized()) owner.restore();
      owner.show();
      owner.focus();
      owner.webContents.send('mini:closed');
    }
  }
  function close() { if (mini && !mini.isDestroyed()) mini.destroy(); }
  return {
    open: function (initial) {
      if (disposed) return Promise.reject(new Error('Game window is closing'));
      if (pending) return pending;
      if (mini && !mini.isDestroyed()) { mini.show(); mini.focus(); return Promise.resolve(); }
      var win = new options.BrowserWindow({
        width: 270, height: 250, minWidth: 238, minHeight: 220, useContentSize: true,
        show: false, alwaysOnTop: true, minimizable: false, maximizable: false,
        autoHideMenuBar: true, backgroundColor: '#0d1017',
        icon: path.join(__dirname, 'icons', 'app.ico'),
        webPreferences: {
          preload: path.join(__dirname, 'mini-preload.cjs'),
          contextIsolation: true, nodeIntegration: false, sandbox: true
        }
      });
      mini = win;
      win.initialMiniData = initial;
      var timeout, rejectReady;
      var ready = new Promise(function (resolve, reject) {
        win.miniReady = resolve;
        rejectReady = reject;
        timeout = setTimeout(function () { reject(new Error('Mini renderer initialization timed out')); }, 10000);
      });
      win.webContents.setWindowOpenHandler(function () { return { action: 'deny' }; });
      win.webContents.on('will-navigate', function (event) { event.preventDefault(); });
      win.webContents.on('render-process-gone', close);
      var loaded = false;
      win.on('closed', function () {
        rejectReady(new Error('Mini window closed while loading'));
        if (mini !== win) return;
        mini = null;
        if (loaded) restoreOwner();
      });
      pending = (async function () {
        try {
          await Promise.all([win.loadFile(path.join(__dirname, 'mini.html')), ready]);
          if (win.isDestroyed() || disposed || owner.isDestroyed()) throw new Error('Mini window closed while loading');
          previousThrottling = owner.webContents.getBackgroundThrottling();
          owner.webContents.setBackgroundThrottling(false);
          loaded = true;
          win.show();
          owner.hide();
          win.focus();
        } catch (error) {
          close();
          throw error;
        } finally { clearTimeout(timeout); pending = null; }
      })();
      return pending;
    },
    update: function (snapshot) {
      if (mini && !mini.isDestroyed()) mini.webContents.send('mini:update', snapshot);
    },
    accepts: function (event) {
      return !!mini && !mini.isDestroyed() && event.sender === mini.webContents &&
        event.senderFrame === mini.webContents.mainFrame;
    },
    initial: function () { return mini && mini.initialMiniData; },
    ready: function () { if (mini) mini.miniReady(); },
    restore: close,
    dispose: function () { disposed = true; close(); }
  };
};
