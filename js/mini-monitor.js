'use strict';
/* 網頁 PiP 與桌面迷你視窗共用同一份戰況渲染；資料來自主遊戲快照。 */
var MiniMonitor = {
  render: function (d, s) {
    var text = { 'm-stage': s.stage, 'm-lv': s.lv, 'm-ptext': s.pHpText,
      'm-mtext': s.pMpText, 'm-ename': s.eName, 'm-etext': s.eHpText, 'm-info': s.info };
    Object.keys(text).forEach(function (id) { d.getElementById(id).textContent = text[id]; });
    d.getElementById('m-php').style.width = s.pHp + '%';
    d.getElementById('m-pmp').style.width = s.pMp + '%';
    d.getElementById('m-ehp').style.width = s.eHp + '%';
    var log = d.getElementById('m-log');
    log.textContent = '';
    s.logs.forEach(function (line, i) {
      if (i) log.appendChild(d.createElement('br'));
      log.appendChild(d.createTextNode(line));
    });
  }
};

if (window.ApexMini) {
  window.ApexMini.initial().then(function (data) {
    var style = document.createElement('style');
    style.textContent = data.css +
      'button{background:#24463c;color:#e1e9df;border:1px solid #9b7953;padding:3px 10px;cursor:pointer}' +
      '.m-toolbar{display:flex;justify-content:flex-end;margin-bottom:4px}';
    document.head.appendChild(style);
    document.title = data.title;
    document.body.innerHTML = data.html;
    var toolbar = document.createElement('div'), restore = document.createElement('button');
    toolbar.className = 'm-toolbar';
    restore.id = 'm-restore';
    restore.textContent = data.restoreLabel;
    restore.title = data.restoreTip;
    restore.onclick = window.ApexMini.restore;
    toolbar.appendChild(restore);
    document.body.prepend(toolbar);
    document.addEventListener('keydown', function (event) {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 ||
          event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !document.hasFocus()) return;
      if (event.key === 'Escape' || (event.key === 'Enter' && data.enterShortcut)) {
        event.preventDefault();
        window.ApexMini.restore();
      }
    });
    MiniMonitor.render(document, data.snapshot);
    window.ApexMini.onUpdate(function (snapshot) { MiniMonitor.render(document, snapshot); });
    return window.ApexMini.ready();
  });
}
