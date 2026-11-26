'use strict';

// 計時器保持運作；只有最小化／隱藏才停止顯示，可見但失焦時仍繼續繪圖。
function bindWindowActivity(win, options) {
  var alwaysActive = !!(options && options.alwaysActive);
  function get() {
    return { background: !alwaysActive && (!win.isVisible() || win.isMinimized()) };
  }
  function publish() {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('activity:change', get());
    }
  }
  ['focus', 'blur', 'minimize', 'restore', 'show', 'hide'].forEach(function (name) { win.on(name, publish); });
  win.webContents.on('did-finish-load', publish);
  return { get: get };
}

module.exports = { bindWindowActivity: bindWindowActivity };
