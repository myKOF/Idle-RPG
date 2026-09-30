'use strict';
/* ============ 本機 GM 指令面板（僅供開發環境） ============
   只負責面板與鍵盤事件。指令解析與執行在 js/gm_exec.js，由 Worker 載入。
   一律送 gm.exec 指令，不在主執行緒直接執行——狀態的權威在 Worker。 */

(function () {
  var gmUi = null;

  /* 本機判定。gm_exec.js 也有同名函式，但 P5 起那支只由 Worker 載入，
     主執行緒拿不到——這裡是純環境檢查、沒有狀態，複製一份比為了它把
     577 行的指令實作載進主執行緒划算。兩邊的判定條件必須一致。 */
  function isGMHost() {
    var host = (typeof location !== 'undefined' && location.hostname) || '';
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }

  /* ---- 畫面端指令：只影響主執行緒的畫面，不碰遊戲狀態，所以不送 Worker ----
     「狀態的權威在 Worker」這條規則管的是遊戲狀態；顯示／隱藏一塊診斷文字不是狀態，
     送去 Worker 只會換來一個它無法處理的指令（Worker 拿不到 DOM）。
     和其他 GM 指令一樣不落地：重新整理後回到預設。
     指令名稱比對不分大小寫，與 gm_exec.js 一致。 */
  var CLIENT_COMMANDS = {
    /* Performance_Information [on|off]：戰鬥區 FPS 計數器下方的效能診斷文字（js/battle-perf.js）。
       預設隱藏；不帶參數＝切換，所以「再輸入一次就關」。 */
    performance_information: function (args) {
      var word = String(args[0] === undefined ? '' : args[0]).toLowerCase();
      if (typeof BattlePerf === 'undefined' || !BattlePerf.enabled) {
        return { ok: false, message: '效能資訊未啟用（網址帶了 ?perf=0，或不是內部版本）' };
      }
      var want;
      if (word === '') want = !BattlePerf.visible;
      else if (word === '1' || word === 'on' || word === 'show') want = true;
      else if (word === '0' || word === 'off' || word === 'hide') want = false;
      else return { ok: false, message: '格式：Performance_Information [on|off]（省略＝切換）' };
      BattlePerf.setVisible(want);
      return {
        ok: true,
        message: want ? '效能資訊：已顯示（再輸入一次 Performance_Information 關閉）' : '效能資訊：已隱藏（只留 FPS）'
      };
    }
  };

  /* 不是畫面端指令就回 null，交給 Worker。 */
  function runClientCommand(text) {
    if (!isGMHost()) return null;
    var parts = String(text || '').trim().split(/\s+/);
    var name = parts.shift().toLowerCase();
    var fn = Object.prototype.hasOwnProperty.call(CLIENT_COMMANDS, name) ? CLIENT_COMMANDS[name] : null;
    return fn ? fn(parts) : null;
  }

  /* 送出指令。遊戲狀態的權威在 Worker，所以一律送過去（畫面端指令除外，見上）；
     回覆到達前先顯示執行中。 */
  function submitGMCommand(text) {
    var local = runClientCommand(text);
    if (local) { setGMStatus(local.message, local.ok); return; }
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
    module.exports = { initGM: initGM, runClientCommand: runClientCommand };
  }
})();
