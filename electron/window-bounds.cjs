'use strict';
var fs = require('fs');
var path = require('path');

// 原生視窗使用 DIP 記錄，與遊戲的渲染解析度分開。
exports.create = function (file, screen, log) {
  var saved = null;
  function valid(bounds) {
    return bounds && ['x', 'y', 'width', 'height'].every(function (key) {
      return Number.isInteger(bounds[key]) && bounds[key] === (bounds[key] | 0);
    }) && bounds.width >= 640 && bounds.height >= 360;
  }
  try {
    var value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (valid(value)) saved = { x: value.x, y: value.y, width: value.width, height: value.height };
  } catch (error) {
    if (error.code !== 'ENOENT' && log) log('[desktop] 讀取視窗大小失敗：', error.message);
  }
  function initialBounds() {
    if (!saved) return { width: 1600, height: 900 };
    var area = screen.getDisplayMatching(saved).workArea;
    var width = Math.max(640, Math.min(saved.width, area.width));
    var height = Math.max(360, Math.min(saved.height, area.height));
    return {
      x: Math.max(area.x, Math.min(saved.x, area.x + Math.max(0, area.width - width))),
      y: Math.max(area.y, Math.min(saved.y, area.y + Math.max(0, area.height - height))),
      width: width, height: height
    };
  }
  function bind(win, canRemember) {
    var timer = null;
    function remember() {
      clearTimeout(timer); timer = null;
      if (win.isDestroyed() || win.isFullScreen() || win.isMaximized() || win.isMinimized() || !canRemember()) return;
      var bounds = win.getBounds();
      if (!valid(bounds) || saved && ['x', 'y', 'width', 'height'].every(function (key) { return saved[key] === bounds[key]; })) return;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + '.tmp', JSON.stringify(bounds));
        fs.renameSync(file + '.tmp', file);
        saved = bounds;
      } catch (error) { if (log) log('[desktop] 儲存視窗大小失敗：', error.message); }
    }
    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(remember, 250);
    }
    win.on('resize', schedule);
    win.on('move', schedule);
    win.on('close', remember);
    win.on('closed', function () { clearTimeout(timer); });
    return { remember: remember };
  }
  return { initialBounds: initialBounds, hasSaved: function () { return !!saved; }, bind: bind };
};
