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

  /* 使用 Gemini 將白話文自然語言轉為標準 GM 指令陣列 */
  function parseNaturalCommand(userPrompt, customKey) {
    if (!isInternal()) {
      return Promise.reject(new Error('自然語言 GM 功能僅限內測環境使用'));
    }
    var key = customKey || getApiKey();
    if (!key) {
      return Promise.reject(new Error('尚未設定 Gemini API 金鑰，請先在 Esc -> 設置中輸入'));
    }

    var systemInstruction =
      '你是一個 Idle-RPG 遊戲的 GM 指令翻譯官。請將玩家說的自然語言，精準轉換為遊戲底層支援的 GM 指令陣列。\n' +
      '你必須只輸出 JSON 字串陣列，格式為 ["command 1", "command 2"]，不可包含任何 markdown 標籤或解釋。\n\n' +
      '【支援的 GM 指令清單】\n' +
      '1. 貨幣與材料：\n' +
      '   - gold <數量>：加金幣（中文單位請換算為整數或科學記號，例如 1000億 -> 100000000000 或 1e11，10萬 -> 100000，負數為扣除）\n' +
      '   - scrap <數量>：加裝備碎片\n' +
      '   - essence <數量>：加附魔精華\n' +
      '   - dust <數量>：加魔塵\n' +
      '2. 裝備與套裝（全身 13 件裝備）：\n' +
      '   - equipset <品質> [裝備等級] [強化等級] [太古數] [wear/inv]\n' +
      '     * 品質：common(普通/0), uncommon(精良/1), rare(稀有/2), unique(獨特/3), epic(史詩/4), legendary(傳說/5), mythic(神話/6), creation(創世/7), godforge(神鑄創世/8)\n' +
      '     * 裝備等級：若玩家未指定，填 500\n' +
      '     * 強化等級：例如「強化+50」填 50，未提填 0\n' +
      '     * 太古數：例如「4太古」填 4，未提填 0\n' +
      '     * wear/inv：若提到「全身」、「穿戴」、「穿上」、「一套」或沒特別說要放背包，填 wear；若說放背包填 inv\n' +
      '   - equip <品質> <裝備等級> [部位] [數量] [強化等級] [太古數]：單件裝備\n' +
      '     * 部位：weapon, helmet, shoulder, chest, belt, gloves, wrist, legs, boots, ring, amulet\n' +
      '3. 角色等級與轉生：\n' +
      '   - level <等級>：設定角色等級（如 level 1000）\n' +
      '   - turn <次數>：設定轉生次數（如 turn 1）\n' +
      '4. 背包容量：\n' +
      '   - bag <容量>：例如 bag 2000\n' +
      '5. 技能與天賦：\n' +
      '   - skillmax all：所有新版技能群組滿級\n' +
      '   - skill_unlock：切換技能全解鎖（免除等級與封魔塔限制）\n' +
      '6. 寶石與符文：\n' +
      '   - gem <寶石key> <等級1~10> <數量>\n' +
      '   - rune all <數量> 或 rune <r01~r33> <數量>\n' +
      '   - runeword <符文真言名稱>\n\n' +
      '【轉換範例】\n' +
      '輸入：「加全身強化+50的神話裝備，並都是4太古的詞條」\n' +
      '輸出：["equipset mythic 500 50 4 wear"]\n\n' +
      '輸入：「加金幣1000億」\n' +
      '輸出：["gold 100000000000"]\n\n' +
      '輸入：「技能全部滿級，給我100萬碎片」\n' +
      '輸出：["skillmax all", "scrap 1000000"]\n';

    function resolveCandidateModels(targetKey) {
      var defaultList = [
        'gemini-2.0-flash',
        'gemini-1.5-flash',
        'gemini-2.0-flash-lite',
        'gemini-1.5-flash-8b',
        'gemini-1.5-pro'
      ];
      var listUrl = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(targetKey);
      return fetch(listUrl, { method: 'GET' })
        .then(function (res) {
          if (!res.ok) return defaultList;
          return res.json();
        })
        .then(function (data) {
          var models = (data && data.models) || [];
          var supported = models.filter(function (m) {
            var methods = m.supportedGenerationMethods || [];
            var name = (m.name || '').toLowerCase();
            return methods.indexOf('generateContent') >= 0 &&
              name.indexOf('embedding') === -1 &&
              name.indexOf('imagen') === -1 &&
              name.indexOf('aqa') === -1;
          }).map(function (m) {
            return (m.name || '').replace(/^models\//, '');
          }).filter(Boolean);

          if (!supported.length) return defaultList;

          // 排序：2.0-flash > 1.5-flash > 2.0-flash-lite > 1.5-flash-8b > 1.5-pro > 其他
          var ranked = [];
          ['2.0-flash', '1.5-flash', '2.0-flash-lite', '1.5-flash-8b', '1.5-pro', 'flash', 'pro'].forEach(function (kw) {
            supported.forEach(function (name) {
              if (name.indexOf(kw) >= 0 && ranked.indexOf(name) === -1) {
                ranked.push(name);
              }
            });
          });
          supported.forEach(function (name) {
            if (ranked.indexOf(name) === -1) ranked.push(name);
          });
          defaultList.forEach(function (name) {
            if (ranked.indexOf(name) === -1) ranked.push(name);
          });
          return ranked.length ? ranked : defaultList;
        })
        .catch(function () {
          return defaultList;
        });
    }

    return resolveCandidateModels(key).then(function (candidates) {
      var body = {
        contents: [
          {
            parts: [
              { text: systemInstruction + '\n玩家輸入：「' + userPrompt + '」\n輸出 JSON 陣列：' }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          response_mime_type: 'application/json'
        }
      };

      function callSingleModel(modelName) {
        var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(modelName) + ':generateContent?key=' + encodeURIComponent(key);
        return fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }).then(function (res) {
          if (!res.ok) {
            return res.json().catch(function () { return {}; }).then(function (data) {
              var msg = (data && data.error && data.error.message) || ('HTTP ' + res.status);
              throw new Error(msg);
            });
          }
          return res.json();
        }).then(function (data) {
          var candidate = data && data.candidates && data.candidates[0];
          var part = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0];
          var rawText = (part && part.text) || '';
          if (!rawText.trim()) throw new Error('AI 未回傳任何指令');
          var list = JSON.parse(rawText);
          if (!Array.isArray(list)) {
            if (typeof list === 'string') list = [list];
            else throw new Error('AI 回傳格式不正確');
          }
          return list.map(function (c) { return String(c).trim(); }).filter(Boolean);
        });
      }

      var lastError = null;
      function tryModel(index) {
        if (index >= candidates.length) {
          var detailMsg = lastError ? (lastError.message || String(lastError)) : '所有備用模型均無法回應';
          throw new Error('AI 解析失敗：Google Gemini 所有可用備用模型均處於尖峰或無法回應（' + detailMsg + '），請稍候 30 秒至 1 分鐘後再試。');
        }
        var modelName = candidates[index];
        return callSingleModel(modelName).catch(function (err) {
          lastError = new Error(modelName + ': ' + err.message);
          console.warn('[AI GM] 模型 ' + modelName + ' 回應異常 (' + err.message + ')，自動切換至下一個備用模型...');
          return tryModel(index + 1);
        });
      }

      return tryModel(0);
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
    parseNaturalCommand: parseNaturalCommand,
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
