'use strict';
var electron = require('electron');
var ipc = electron.ipcRenderer;
function installTitleBar() {
  if (process.platform !== 'win32' || document.getElementById('mini-titlebar')) return;
  var bar = document.createElement('div');
  bar.id = 'mini-titlebar';
  bar.style.cssText = 'height:32px;margin:-6px -8px 6px;background:#0d1017;user-select:none;touch-action:none;-webkit-app-region:no-drag';
  var label = document.createElement('div');
  label.style.cssText = 'width:env(titlebar-area-width,calc(100% - 138px));height:100%;display:flex;align-items:center;gap:6px;padding:0 8px;box-sizing:border-box;pointer-events:none';
  var icon = document.createElement('img');
  icon.src = 'icons/app.png';
  icon.alt = '';
  icon.style.cssText = 'width:16px;height:16px;flex:none';
  var title = document.createElement('span');
  title.textContent = document.title;
  title.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px';
  label.append(icon, title);
  bar.appendChild(label);
  document.body.prepend(bar);
  var pointer = null;
  function finish(event) {
    if (pointer === null || (event.pointerId !== undefined && event.pointerId !== pointer)) return;
    var id = pointer;
    pointer = null;
    ipc.send('mini:drag', 'end');
    if (bar.hasPointerCapture(id)) bar.releasePointerCapture(id);
  }
  bar.addEventListener('pointerdown', function (event) {
    if (event.button !== 0 || event.isPrimary === false || pointer !== null) return;
    event.preventDefault();
    bar.setPointerCapture(event.pointerId);
    pointer = event.pointerId;
    ipc.send('mini:drag', 'start', { x: event.clientX, y: event.clientY });
  });
  bar.addEventListener('pointermove', function (event) {
    if (event.pointerId !== pointer) return;
    if (!(event.buttons & 1) && event.pointerType !== 'touch') { finish(event); return; }
    ipc.send('mini:drag', 'move');
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (name) { bar.addEventListener(name, finish); });
  window.addEventListener('blur', finish);
  bar.addEventListener('dblclick', function () { ipc.send('mini:restore'); });
}
// 迷你頁沒有存檔、Steam、顯示設定或一般主視窗權限。
electron.contextBridge.exposeInMainWorld('ApexMini', {
  initial: function () { return ipc.invoke('mini:initial'); },
  ready: function () { installTitleBar(); return ipc.invoke('mini:ready'); },
  restore: function () { ipc.send('mini:restore'); },
  onUpdate: function (fn) { ipc.on('mini:update', function (_event, snapshot) { fn(snapshot); }); }
});
