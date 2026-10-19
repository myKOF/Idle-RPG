'use strict';
/* ============ 內測專用：AI 自然語言 GM 金鑰管理模組 ============
   只有在內測服環境（isInternalServer / isGMHost）才允許顯示與操作。
   金鑰只儲存於瀏覽器 localStorage，不進任何存檔或伺服器。 */

(function () {
  var STORAGE_KEY = 'idle_rpg_gemini_api_key';

  function isInternal() {
    if (typeof isInternalServer === 'function') {
      try { return isInternalServer(); } catch (e) {}
    }
    var loc = (typeof window !== 'undefined' && window.location) || (typeof location !== 'undefined' && location);
    if (!loc) return false;
    var host = loc.hostname || '';
    var proto = loc.protocol || '';
    if (proto === 'file:') return true;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === '[::1]') return true;
    if (/^192\.168\.\d+\.\d+$/.test(host) || /^10\.\d+\.\d+\.\d+$/.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
    if (host.endsWith('.local') || host.endsWith('.test')) return true;
    return false;
  }

  function getApiKey() {
    if (!isInternal()) return '';
    try {
      return (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) || '';
    } catch (e) {
      return '';
    }
  }

  function setApiKey(key) {
    if (!isInternal()) return false;
    var trimmed = String(key || '').trim();
    try {
      if (typeof localStorage !== 'undefined') {
        if (trimmed) {
          localStorage.setItem(STORAGE_KEY, trimmed);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
        return true;
      }
    } catch (e) {}
    return false;
  }

  function clearApiKey() {
    return setApiKey('');
  }

  function maskKey(key) {
    if (!key || key.length < 8) return '****';
    return key.slice(0, 6) + '...' + key.slice(-4);
  }

  /* 測試金鑰是否可用 */
  function testApiKey(key) {
    var targetKey = key || getApiKey();
    if (!targetKey) {
      return Promise.reject(new Error('尚未輸入或儲存金鑰'));
    }
    var url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(targetKey);
    return fetch(url, { method: 'GET' })
      .then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            var msg = (data && data.error && data.error.message) || ('HTTP ' + res.status);
            throw new Error(msg);
          });
        }
        return res.json();
      })
      .then(function (data) {
        return { ok: true, modelsCount: data.models ? data.models.length : 0 };
      });
  }

  function updateStatusText(statusEl, inputEl) {
    if (!statusEl) return;
    var currentKey = getApiKey();
    if (currentKey) {
      statusEl.innerHTML = '<span style="color:#4ade80;">🟢 已設定金鑰 (' + maskKey(currentKey) + ')，可正常使用自然語言 GM。</span>';
      if (inputEl && !inputEl.value) {
        inputEl.placeholder = '金鑰已儲存 (' + maskKey(currentKey) + ')，輸入可替換';
      }
    } else {
      statusEl.innerHTML = '<span style="color:var(--dim);">⚪ 尚未設定金鑰，請先貼上 Google Gemini API Key。</span>';
      if (inputEl && !inputEl.value) {
        inputEl.placeholder = '貼上 API Key (AIzaSy...)';
      }
    }
  }

  function initUI() {
    if (!isInternal()) return;

    var panel = document.getElementById('ai-gm-key-panel');
    var gameMenuBtn = document.getElementById('game-menu-ai-key');
    var input = document.getElementById('input-ai-gemini-key');
    var toggleVisBtn = document.getElementById('btn-ai-toggle-key-vis');
    var saveBtn = document.getElementById('btn-ai-save-key');
    var testBtn = document.getElementById('btn-ai-test-key');
    var clearBtn = document.getElementById('btn-ai-clear-key');
    var status = document.getElementById('ai-key-status');

    if (panel) panel.style.display = 'block';
    if (gameMenuBtn) {
      gameMenuBtn.style.display = 'block';
      gameMenuBtn.addEventListener('click', function () {
        if (typeof GameMenu !== 'undefined' && typeof GameMenu.openSettings === 'function') {
          GameMenu.openSettings();
        }
        setTimeout(function () {
          if (input) input.focus();
        }, 100);
      });
    }

    updateStatusText(status, input);

    if (toggleVisBtn && input) {
      toggleVisBtn.addEventListener('click', function () {
        input.type = input.type === 'password' ? 'text' : 'password';
        toggleVisBtn.textContent = input.type === 'password' ? '👁️' : '🙈';
      });
    }

    if (saveBtn && input) {
      saveBtn.addEventListener('click', function () {
        var val = input.value.trim();
        if (!val) {
          if (status) status.innerHTML = '<span style="color:#f87171;">❌ 請先輸入金鑰內容</span>';
          return;
        }
        setApiKey(val);
        input.value = '';
        input.type = 'password';
        if (toggleVisBtn) toggleVisBtn.textContent = '👁️';
        if (status) status.innerHTML = '<span style="color:#4ade80;">✅ 金鑰已成功儲存至本機！</span>';
        setTimeout(function () {
          updateStatusText(status, input);
        }, 1500);
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        clearApiKey();
        if (input) input.value = '';
        if (status) status.innerHTML = '<span style="color:#f87171;">🗑️ 已清除本地儲存的金鑰。</span>';
        setTimeout(function () {
          updateStatusText(status, input);
        }, 1500);
      });
    }

    if (testBtn) {
      testBtn.addEventListener('click', function () {
        var keyToTest = (input && input.value.trim()) || getApiKey();
        if (!keyToTest) {
          if (status) status.innerHTML = '<span style="color:#f87171;">❌ 請先輸入或保存金鑰後再測試</span>';
          return;
        }
        testBtn.disabled = true;
        if (status) status.innerHTML = '<span style="color:#38bdf8;">⏳ 連線測試中，請稍候…</span>';
        testApiKey(keyToTest).then(function () {
          testBtn.disabled = false;
          if (status) status.innerHTML = '<span style="color:#4ade80;">🎉 連線成功！Gemini API 金鑰有效且可用。</span>';
        }).catch(function (err) {
          testBtn.disabled = false;
          if (status) status.innerHTML = '<span style="color:#f87171;">❌ 連線失敗：' + (err && err.message ? err.message : String(err)) + '</span>';
        });
      });
    }
  }

  var AiKeySetting = {
    STORAGE_KEY: STORAGE_KEY,
    isInternal: isInternal,
    getApiKey: getApiKey,
    setApiKey: setApiKey,
    clearApiKey: clearApiKey,
    maskKey: maskKey,
    testApiKey: testApiKey,
    initUI: initUI
  };

  if (typeof window !== 'undefined') {
    window.AiKeySetting = AiKeySetting;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initUI);
    } else {
      initUI();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AiKeySetting;
  }
})();
