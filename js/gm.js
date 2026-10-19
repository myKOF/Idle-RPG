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

  function syncTestFlags(res) {
    if (res && res.skillUnlock !== undefined && typeof window !== 'undefined') {
      if (!window.GM_TEST) window.GM_TEST = {};
      window.GM_TEST.skillUnlock = res.skillUnlock;
      if (typeof UI !== 'undefined' && UI.dirty) {
        UI.dirty.skills = true;
        UI.dirty.battle = true;
      }
    }
  }

  function executeCommandSequence(commands, originPrompt) {
    setGMStatus('🤖 AI 解析為：[' + commands.join('; ') + ']，執行中…', true);
    var index = 0;
    var results = [];

    function next() {
      if (index >= commands.length) {
        var allOk = results.every(function (r) { return r.ok; });
        var summary = results.map(function (r) { return r.message; }).join(' | ');
        setGMStatus('🤖 已執行 [' + commands.join('; ') + ']：' + summary, allOk);
        if (typeof blog === 'function') {
          blog('🤖 [AI GM] ' + originPrompt + ' ➔ ' + commands.join('; '), allOk ? 'good' : 'bad');
        }
        return;
      }
      var cmd = commands[index++];
      WorkerBridge.send('gm.exec', { line: cmd }).then(function (res) {
        syncTestFlags(res);
        results.push({ ok: !!(res && res.ok), message: res && res.message ? res.message : '成功' });
        next();
      }).catch(function (err) {
        results.push({ ok: false, message: err && err.message ? err.message : '失敗' });
        next();
      });
    }
    next();
  }

  function executeSingleWorkerCommand(text) {
    setGMStatus('執行中…', true);
    WorkerBridge.send('gm.exec', { line: text }).then(function (res) {
      syncTestFlags(res);
      setGMStatus(res && res.message ? res.message : '已執行', !!(res && res.ok));
    }).catch(function (err) {
      setGMStatus(err && err.message ? err.message : '指令執行失敗', false);
    });
  }

  /* 送出指令。若為自然語言且本機具備 Gemini Key，透過 AI 轉譯後執行。 */
  function submitGMCommand(text) {
    var rawText = String(text || '').trim();
    if (!rawText) return;

    var local = runClientCommand(rawText);
    if (local) { setGMStatus(local.message, local.ok); return; }

    var hasChinese = /[^\x00-\x7F]/.test(rawText);
    var firstWord = rawText.split(/\s+/)[0].toLowerCase();
    var isKnownEnglishCmd = /^(gold|g|scrap|essence|dust|mat|material|gem|rune|runeword|book|equip|equipment|equipset|equip_set|set|suit|fullset|full_set|gearset|gear_set|part|bag|inv_cap|invcap|inv_size|invsize|inv_expand|bag_expand|expand_inv|stage_jump|stage|set_stage|setstage|stage_set|stageset|zone_jump|zone|kill|multikill|mk|k|reincarnation|reincarnate|turn|level|lv|skillxp|masterylv|skill2max|skillmax|skills2max|skill_unlock|tower_trial_clear|tower_hell_clear|tower_purgatory_clear|tower_trial_reset|tower_hell_reset|tower_purgatory_reset|tower_jump|god|spawn|spawnelite|clear|help|\?)$/i.test(firstWord);

    if (hasChinese && !isKnownEnglishCmd) {
      if (typeof AiKeySetting !== 'undefined' && typeof AiKeySetting.parseNaturalCommand === 'function') {
        var apiKey = AiKeySetting.getApiKey();
        if (!apiKey) {
          setGMStatus('⚠️ 檢測到白話指令，但尚未設定 Gemini 金鑰。請按 Esc ➔ 設置貼上金鑰。', false);
          return;
        }
        setGMStatus('🤖 AI 正在理解指令中…', true);
        AiKeySetting.parseNaturalCommand(rawText).then(function (cmdList) {
          if (!cmdList || !cmdList.length) {
            setGMStatus('❌ AI 無法識別該指令，請換個說法試試。', false);
            return;
          }
          executeCommandSequence(cmdList, rawText);
        }).catch(function (err) {
          setGMStatus('❌ AI 解析失敗：' + (err && err.message ? err.message : String(err)), false);
        });
        return;
      }
    }

    executeSingleWorkerCommand(rawText);
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
    var input = document.createElement('textarea');
    input.rows = 3;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'GM 指令（可輸入白話文，例：加全身強化+50神話4太古裝備、加金幣1000億）';
    var status = document.createElement('div');
    status.className = 'gm-status';
    panel.appendChild(input);
    panel.appendChild(status);
    document.body.appendChild(panel);

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
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
