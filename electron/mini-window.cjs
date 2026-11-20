'use strict';
var path = require('path');
var fs = require('fs');

// 只有一份遊戲與 Worker；迷你視窗只顯示主頁提供的戰況。
exports.create = function (options) {
  var owner = options.owner, mini = null, pending = null, disposed = false;
  var previousThrottling = null;
  var lastPosition = null;
  var dragOffset = null;
  var dragSize = null;
  function validPosition(value) {
    return value && Number.isInteger(value.x) && Number.isInteger(value.y) &&
      value.x === (value.x | 0) && value.y === (value.y | 0);
  }
  if (options.positionFile) {
    try {
      var saved = JSON.parse(fs.readFileSync(options.positionFile, 'utf8'));
      if (validPosition(saved)) lastPosition = { x: saved.x, y: saved.y };
    } catch (error) {
      if (error.code !== 'ENOENT' && options.log) options.log('[mini] 讀取位置失敗：', error.message);
    }
  }
  function rememberPosition(win) {
    if (win.isDestroyed()) return;
    var bounds = win.isMinimized() || win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    if (lastPosition && lastPosition.x === bounds.x && lastPosition.y === bounds.y) return;
    lastPosition = { x: bounds.x, y: bounds.y };
    if (!options.positionFile) return;
    try {
      fs.mkdirSync(path.dirname(options.positionFile), { recursive: true });
      fs.writeFileSync(options.positionFile + '.tmp', JSON.stringify(lastPosition));
      fs.renameSync(options.positionFile + '.tmp', options.positionFile);
    } catch (error) {
      if (options.log) options.log('[mini] 儲存位置失敗：', error.message);
    }
  }
  function placeWindow(win) {
    var bounds = win.getBounds();
    var target = lastPosition ? Object.assign({}, bounds, lastPosition) : owner.getBounds();
    var area = options.screen.getDisplayMatching(target).workArea;
    var x = lastPosition ? lastPosition.x : Math.round(area.x + (area.width - bounds.width) / 2);
    var y = lastPosition ? lastPosition.y : Math.round(area.y + (area.height - bounds.height) / 2);
    // 螢幕拔除、工作區或 DPI 改變後，把舊位置限制在目前可操作範圍。
    win.setPosition(Math.max(area.x, Math.min(x, area.x + Math.max(0, area.width - bounds.width))),
      Math.max(area.y, Math.min(y, area.y + Math.max(0, area.height - bounds.height))));
  }
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
  function moveDrag() {
    if (!dragOffset || !mini || mini.isDestroyed() || mini.isMinimized() || mini.isMaximized()) return;
    // Electron screen 與視窗座標同為 DIP，跨螢幕時不混用 renderer 的 CSS／實體像素。
    var cursor = options.screen.getCursorScreenPoint();
    var x = cursor.x - dragOffset.x, y = cursor.y - dragOffset.y;
    var bounds = mini.getBounds();
    // 固定拖曳起始尺寸，避免 Windows 小數 DPI 每次取整造成視窗逐步變大並失去指標捕捉。
    if (bounds.x !== x || bounds.y !== y) mini.setBounds({ x: x, y: y, width: dragOffset.width, height: dragOffset.height });
  }
  function endDrag() {
    if (!dragOffset) return;
    dragOffset = null;
    if (mini && !mini.isDestroyed()) rememberPosition(mini);
  }
  function close() {
    endDrag();
    if (mini && !mini.isDestroyed()) {
      if (mini.positionReady) rememberPosition(mini);
      mini.destroy();
    }
  }
  return {
    open: function (initial) {
      if (disposed) return Promise.reject(new Error('Game window is closing'));
      if (pending) return pending;
      if (mini && !mini.isDestroyed()) { mini.show(); mini.focus(); return Promise.resolve(); }
      var win = new options.BrowserWindow({
        width: 270, height: 250, minWidth: 238, minHeight: 220, useContentSize: true,
        show: false, alwaysOnTop: true, minimizable: true, maximizable: true,
        autoHideMenuBar: true, backgroundColor: '#0d1017',
        titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
        titleBarOverlay: process.platform === 'win32' ? { color: '#0d1017', symbolColor: '#d7deed', height: 32 } : false,
        icon: path.join(__dirname, 'icons', 'app.ico'),
        webPreferences: {
          preload: path.join(__dirname, 'mini-preload.cjs'),
          contextIsolation: true, nodeIntegration: false, sandbox: true
        }
      });
      mini = win;
      dragSize = null;
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
      // 原生標題列的方框回主遊戲；不要儲存最大化後的螢幕原點。
      win.on('maximize', function () { setImmediate(function () { if (mini === win) close(); }); });
      win.on('minimize', function () { endDrag(); if (loaded) rememberPosition(win); });
      win.on('blur', endDrag);
      win.on('resized', function () { dragSize = null; });
      win.on('restore', function () { win.setAlwaysOnTop(true, 'pop-up-menu'); });
      win.on('moved', function () { if (loaded && !dragOffset) rememberPosition(win); });
      win.on('close', function () { if (loaded) rememberPosition(win); });
      win.on('closed', function () {
        dragOffset = null;
        rejectReady(new Error('Mini window closed while loading'));
        if (mini !== win) return;
        mini = null;
        if (loaded) restoreOwner();
      });
      pending = (async function () {
        try {
          await Promise.all([win.loadFile(path.join(__dirname, 'mini.html')), ready]);
          if (win.isDestroyed() || disposed || owner.isDestroyed()) throw new Error('Mini window closed while loading');
          placeWindow(win);
          win.positionReady = true;
          previousThrottling = owner.webContents.getBackgroundThrottling();
          owner.webContents.setBackgroundThrottling(false);
          loaded = true;
          owner.hide();
          win.show();
          win.setAlwaysOnTop(true, 'pop-up-menu');
          win.focus();
          // Windows 隱藏全螢幕主窗時會重排 Z-order，待原生事件完成後再確認置頂。
          setImmediate(function () { if (mini === win && !win.isDestroyed()) win.setAlwaysOnTop(true, 'pop-up-menu'); });
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
    drag: function (phase, point) {
      if (!mini || mini.isDestroyed() || !mini.positionReady || !mini.isFocused() || mini.isMinimized() || mini.isMaximized()) {
        endDrag();
        return;
      }
      if (phase === 'start' && !dragOffset) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
        var bounds = mini.getBounds(), content = mini.getContentBounds();
        var zoom = mini.webContents.getZoomFactor();
        // 原生尺寸經 DIP 取整後可能差一個像素，跨次拖曳仍使用同一份要求尺寸。
        if (!dragSize) dragSize = { width: bounds.width, height: bounds.height };
        // 按下時的內容區座標隨事件送來，避免 IPC 抵達時滑鼠已移到下一個位置。
        dragOffset = { x: Math.round(point.x * zoom + content.x - bounds.x),
          y: Math.round(point.y * zoom + content.y - bounds.y), width: dragSize.width, height: dragSize.height };
      } else if (phase === 'move' || phase === 'end') {
        moveDrag();
        if (phase === 'end') endDrag();
      }
    },
    restore: close,
    dispose: function () { disposed = true; close(); }
  };
};
