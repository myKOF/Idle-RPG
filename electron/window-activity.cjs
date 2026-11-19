'use strict';

// 計時器保持運作；原生視窗狀態只控制顯示層。
function bindWindowActivity(win, options) {
  var alwaysActive = !!(options && options.alwaysActive);
  function get() {
    return { background: !alwaysActive && (!win.isVisible() || win.isMinimized() || !win.isFocused()) };
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
