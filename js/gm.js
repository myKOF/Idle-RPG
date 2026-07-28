'use strict';
/* ============ 本機 GM 指令面板（僅供開發環境） ============
   只負責面板與鍵盤事件。指令解析與執行在 js/gm_exec.js，由 Worker 載入。
   一律送 gm.exec 指令，不在主執行緒直接執行——狀態的權威在 Worker。 */

(function () {
  var gmUi = null;

  /* 送出指令。狀態的權威在 Worker，所以一律送過去；回覆到達前先顯示執行中。 */
  function submitGMCommand(text) {
    setGMStatus('執行中…', true);
    WorkerBridge.send('gm.exec', { line: text }).then(function (res) {
      setGMStatus(res && res.message ? res.message : '已執行', !!(res && res.ok));
    }).catch(function (err) {
      setGMStatus(err && err.message ? err.message : '指令執行失敗', false);
    });
  }

  function setGMStatus(message, ok) {
    if (!gmUi || !gmUi.status) return;
    gmUi.status.textContent = message;
    gmUi.status.className = ok ? 'gm-status good' : 'gm-status bad';
  }

  function closeGM() {
    if (!gmUi) return;
    gmUi.panel.style.display = 'none';
  }

  function openGM() {
    if (!gmUi || !isGMHost()) return;
    gmUi.panel.style.display = 'block';
    gmUi.input.value = '';
    setGMStatus('', true);
    gmUi.input.focus();
  }

  function initGM() {
    if (!isGMHost() || gmUi || typeof document === 'undefined') return;
    var panel = document.createElement('div');
    panel.id = 'gm-command-panel';
    panel.style.display = 'none';
    var input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'GM 指令（help 查看）';
    var status = document.createElement('div');
    status.className = 'gm-status';
    panel.appendChild(input);
    panel.appendChild(status);
    document.body.appendChild(panel);

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        var val = input.value;
        if (!val.trim()) {
          closeGM();
          return;
        }
        submitGMCommand(val);
        input.value = '';
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeGM();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (!gmUi || gmUi.panel.style.display === 'none') && isGMHost()) {
        var ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        e.preventDefault();
        openGM();
      }
    });

    gmUi = { panel: panel, input: input, status: status };
  }

  if (typeof window !== 'undefined') {
    window.initGM = initGM;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initGM);
    } else {
      initGM();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initGM: initGM };
  }
})();
