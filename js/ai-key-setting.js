'use strict';
/* ============ 內測專用：AI 自然語言 GM 金鑰管理模組 ============
   只有在內測服環境（isInternalServer / isGMHost）才允許顯示與操作。
   金鑰只儲存於瀏覽器 localStorage，不進任何存檔或伺服器。 */

(function () {
  var STORAGE_KEY = 'idle_rpg_gemini_api_key';
  var MODELS_CACHE_KEY = 'idle_rpg_gemini_models';
  var MODELS_CACHE_VERSION = 2;
  var MODELS_CACHE_TTL_MS = 86400000;
  // 官方 generateContent thinking 文件：3.x 用 level，2.5 Flash 用 budget；不採用 Pro／媒體專用模型。
  var FAST_MODEL_PROFILES = [
    { name: 'gemini-3.5-flash-lite', thinkingConfig: { thinkingLevel: 'minimal', includeThoughts: false } },
    { name: 'gemini-3.8-flash', thinkingConfig: { thinkingLevel: 'low', includeThoughts: false } },
    { name: 'gemini-3.1-flash-lite', thinkingConfig: { thinkingLevel: 'minimal', includeThoughts: false } },
    { name: 'gemini-3.6-flash', thinkingConfig: { thinkingLevel: 'minimal', includeThoughts: false } },
    { name: 'gemini-2.5-flash-lite', thinkingConfig: { thinkingBudget: 0, includeThoughts: false } },
    { name: 'gemini-2.5-flash', thinkingConfig: { thinkingBudget: 0, includeThoughts: false } }
  ];
  var TRANSLATIONS_KEY = 'idle_rpg_gm_translations';
  // GM指令契約／翻譯規則變動時升版，避免重用舊語意。
  var TRANSLATIONS_VERSION = 2;
  var TRANSLATIONS_TTL_MS = 7 * 86400000;
  var TRANSLATIONS_LIMIT = 32;
  var translationMemory = [];
  var translationStorageUnavailable = false;
  var NATURAL_ATTEMPT_TIMEOUT_MS = 30000;
  var NATURAL_MAX_RETRIES = 3;
  var NATURAL_TIMEOUT_MS = NATURAL_ATTEMPT_TIMEOUT_MS * (NATURAL_MAX_RETRIES + 1);
  var activeNaturalRequest = null;

  function cancelNaturalCommand() {
    if (activeNaturalRequest) activeNaturalRequest.cancel();
  }

  // 整輪重試共用總期限；每個模型請求另有獨立期限與AbortController。
  function createNaturalRequest() {
    var controller = new AbortController();
    var deadline = Date.now() + NATURAL_TIMEOUT_MS;
    var stopped = null;
    var rejectStopped;
    var timer;
    var request = {
      signal: controller.signal,
      stopped: new Promise(function (_, reject) { rejectStopped = reject; }),
      check: function () {
        if (!stopped && Date.now() >= deadline) stop(true);
        if (stopped) throw stopped;
      },
      cancel: function () { stop(false); },
      finish: function () {
        clearTimeout(timer);
        if (activeNaturalRequest === request) activeNaturalRequest = null;
      }
    };
    function stop(timedOut) {
      if (stopped) return;
      stopped = new Error(timedOut ? '雲端解析已達等待上限（每次30秒、最多重試3次），已取消，指令未執行。' : '已取消本次雲端解析，指令未執行。');
      stopped.name = timedOut ? 'TimeoutError' : 'AbortError';
      rejectStopped(stopped);
      controller.abort();
    }
    timer = setTimeout(function () { stop(true); }, NATURAL_TIMEOUT_MS);
    activeNaturalRequest = request;
    return request;
  }

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
        localStorage.removeItem(MODELS_CACHE_KEY);
        clearNaturalCommandCache();
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

  function rankFastModels(names) {
    return FAST_MODEL_PROFILES.filter(function (profile) {
      return names.indexOf(profile.name) >= 0;
    }).slice(0, 2).map(function (profile) { return profile.name; });
  }

  /* 查詢 Google API 獲取該金鑰真正支援的可用生成模型，並快取至本機 */
  function fetchAvailableModels(targetKey) {
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

        var ranked = rankFastModels(supported);
        if (!ranked.length) throw new Error('此金鑰未提供支援的快速文字模型，請確認 Gemini 模型權限。');

        if (ranked.length && typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify({
              version: MODELS_CACHE_VERSION, savedAt: Date.now(), models: ranked
            }));
          } catch (e) {}
        }
        return ranked;
      });
  }

  /* 解析關鍵路徑不查詢模型清單；設定中的「測試金鑰」可更新可用快速模型。 */
  function getCandidateModels(request) {
    if (request) request.check();
    try {
      if (typeof localStorage !== 'undefined') {
        var cached = JSON.parse(localStorage.getItem(MODELS_CACHE_KEY) || 'null');
        if (cached && cached.version === MODELS_CACHE_VERSION && Array.isArray(cached.models) &&
            Number.isFinite(cached.savedAt) && Date.now() >= cached.savedAt && Date.now() - cached.savedAt < MODELS_CACHE_TTL_MS) {
          var ranked = rankFastModels(cached.models);
          if (ranked.length) return Promise.resolve(ranked);
        }
      }
    } catch (e) {}

    return Promise.resolve(FAST_MODEL_PROFILES.slice(0, 2).map(function (profile) { return profile.name; }));
  }

  /* 測試金鑰是否可用並更新本機模型快取 */
  function testApiKey(key) {
    var targetKey = key || getApiKey();
    if (!targetKey) {
      return Promise.reject(new Error('尚未輸入或儲存金鑰'));
    }
    return fetchAvailableModels(targetKey).then(function (models) {
      return { ok: true, modelsCount: models.length, topModel: models[0] || '無' };
    });
  }

  /* 目前開放的寶石 key＋中文名，讓 AI 能把「紅寶石」對到 ruby；資料表沒載入時退回空字串 */
  function gemKeyHint() {
    if (typeof GEM_TYPES === 'undefined' || !GEM_TYPES) return '（見 GM_command.md）';
    return Object.keys(GEM_TYPES).filter(function (k) {
      return GEM_TYPES[k] && GEM_TYPES[k].enabled !== false;
    }).map(function (k) { return k + '(' + GEM_TYPES[k].name + ')'; }).join('、');
  }

  function translationSignature() {
    return TRANSLATIONS_VERSION + ':' + gemKeyHint();
  }

  function cacheablePrompt(prompt) {
    return prompt.length > 0 && prompt.length <= 2000 &&
      !/目前|現在|當前|剛才|上次|上一|再|多一|少一|隨機|適合|足夠|最好|最強|剩[下餘]|依照|根據/.test(prompt);
  }

  function cacheableCommands(commands) {
    return Array.isArray(commands) && commands.length > 0 && commands.length <= 32 && commands.every(function (line) {
      return typeof line === 'string' && line.length <= 256 && !/[\r\n]|@sel:|@gm-batch:/i.test(line) &&
        /^(gold|scrap|essence|dust|equipset|equip|modequip|socketall|stage|level|turn|bag|skillmax|skill_unlock|skill_point|skillxp|masterylv|gem|rune|runeword|xp|mat|part)\s+\S/.test(line);
    });
  }

  function allowsAffixOverflow(prompt) {
    var text = String(prompt || '');
    if (/(?:不(?:要|可|准|允許|需要|必|能|想|打算)?|禁止|別|沒有|沒|未|無需|無須|毋須)[^，,。；;\n]{0,12}突破/.test(text)) return false;
    if (/如果|假如|除非|是否|能否|先問|先詢問|先確認|確認後|需要時|才允許|才能|[嗎呢？?]/.test(text)) return false;
    return /(?:^|[，,。；;（(\n]|且|並)\s*(?:(?:本次|這次)?(?:我(?:明確)?允許|允許|請允許|請(?:幫我)?|幫我)\s*)?突破詞條(?:數量)?上限/.test(text);
  }

  // 突破權限只取自原始人類輸入；不採信AI自行加的旗標，也不保存內部批次標記。
  function applyAffixOverflowPolicy(commands, prompt) {
    var allowed = allowsAffixOverflow(prompt);
    return commands.map(function (line) {
      var clean = line.replace(/(?:^|\s)--allow-overcap(?=\s|$)/g, ' ')
        .replace(/\s+@gm-batch:[^\s]+/g, '').trim();
      if (allowed && /^(modequip|editequip|equipmod|setequip|itemmod|meq|改裝備)\s/i.test(clean)) {
        clean += ' --allow-overcap';
      }
      return clean;
    });
  }

  function readTranslationCache() {
    var entries = translationMemory;
    try {
      if (typeof localStorage !== 'undefined' && !translationStorageUnavailable) {
        var raw = localStorage.getItem(TRANSLATIONS_KEY);
        var data = raw && raw.length <= 300000 ? JSON.parse(raw) : null;
        entries = data && data.version === TRANSLATIONS_VERSION && Array.isArray(data.entries) ? data.entries : [];
      }
    } catch (e) { translationStorageUnavailable = true; }
    var signature = translationSignature();
    return entries.slice(-TRANSLATIONS_LIMIT).filter(function (entry) {
      return entry && entry.signature === signature && typeof entry.prompt === 'string' && cacheablePrompt(entry.prompt) &&
        Number.isFinite(entry.savedAt) && Date.now() >= entry.savedAt && Date.now() - entry.savedAt < TRANSLATIONS_TTL_MS &&
        cacheableCommands(entry.commands);
    });
  }

  function writeTranslationCache(entries) {
    translationMemory = entries;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(TRANSLATIONS_KEY, JSON.stringify({ version: TRANSLATIONS_VERSION, entries: entries }));
        translationStorageUnavailable = false;
      }
    } catch (e) { translationStorageUnavailable = true; }
  }

  function getCachedNaturalCommand(prompt) {
    if (!isInternal()) return null;
    var text = String(prompt || '').trim();
    var entries = readTranslationCache();
    for (var i = entries.length - 1; i >= 0; i--) {
      if (entries[i].prompt === text) return applyAffixOverflowPolicy(entries[i].commands, text);
    }
    return null;
  }

  // 由GM面板在整批Worker操作成功後呼叫；不保存選取ID或遊戲狀態。
  function rememberNaturalCommand(prompt, commands) {
    var text = String(prompt || '').trim();
    if (!isInternal() || !cacheablePrompt(text) || !cacheableCommands(commands)) return;
    commands = applyAffixOverflowPolicy(commands, text);
    var entries = readTranslationCache().filter(function (entry) { return entry.prompt !== text; });
    entries.push({ prompt: text, signature: translationSignature(), commands: commands.slice(), savedAt: Date.now() });
    writeTranslationCache(entries.slice(-TRANSLATIONS_LIMIT));
  }

  function forgetNaturalCommand(prompt) {
    if (!isInternal()) return;
    var text = String(prompt || '').trim();
    writeTranslationCache(readTranslationCache().filter(function (entry) { return entry.prompt !== text; }));
  }

  function clearNaturalCommandCache() {
    if (!isInternal()) return;
    translationMemory = [];
    translationStorageUnavailable = false;
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(TRANSLATIONS_KEY); }
    catch (e) { translationStorageUnavailable = true; }
  }

  function getNaturalPresets() {
    if (!isInternal()) return [];
    return [
      { label: '常用材料', prompt: '金幣、裝備碎片、附魔精華、魔塵各加1000億個' },
      { label: '神話全套', prompt: '加全身強化+50神話4太古裝備' },
      { label: '鑲滿10級', prompt: '全身鑲滿10級寶石' },
      { label: '技能滿級', prompt: '技能全部滿級' }
    ];
  }

  /* ============ 本地高速直譯通道（Fast-Path，0ms 無延遲直譯） ============ */
  function parseChineseNum(str, allowFraction) {
    if (!str) return null;
    var s = String(str).trim();
    var sign = 1;
    if (s.charAt(0) === '+') s = s.slice(1).trim();
    else if (s.charAt(0) === '-') { sign = -1; s = s.slice(1).trim(); }

    var m = s.match(/^(\d+(?:\.\d+)?)\s*([兆億萬千百kmb]?)$/i);
    if (!m) return null;
    var val = parseFloat(m[1]);
    var unit = (m[2] || '').toLowerCase();
    if (unit === '兆') val *= 1e12;
    else if (unit === '億') val *= 1e8;
    else if (unit === '萬') val *= 1e4;
    else if (unit === '千' || unit === 'k') val *= 1e3;
    else if (unit === 'm') val *= 1e6;
    else if (unit === 'b') val *= 1e9;
    else if (unit === '百') val *= 1e2;
    if (!Number.isFinite(val)) return null;
    return sign * (allowFraction ? val : Math.round(val));
  }

  function normalizeFastClause(text) {
    return String(text || '').trim().replace(/^(?:(?:請|麻煩|幫我|幫忙)\s*)+/, '')
      .replace(/[。！!]+$/, '').replace(/(?:吧|謝謝)$/, '').trim();
  }

  // 僅完整匹配已知資源名稱，避免數字以外的需求被忽略。
  function parseFastResources(text) {
    var s = normalizeFastClause(text);
    var names = '(?:金幣|錢|裝備碎片|碎片|附魔精華|精華|魔塵|gold|scrap|essence|dust)';
    var amount = '([+-]?\\d+(?:\\.\\d+)?\\s*[兆億萬千百kmb]?)';
    var list = '(' + names + '(?:\\s*[、和與及,，]\\s*' + names + ')*)';
    var m = s.match(new RegExp('^(加|增加|給我|獲得|扣除|減少|扣)?\\s*' + list + '\\s*(?:各)?\\s*(加|增加|扣除|減少|扣)?\\s*' + amount + '\\s*(?:個|枚|份)?$', 'i'));
    var resources, raw, verb;
    if (m) { resources = m[2]; raw = m[4]; verb = (m[1] || '') + (m[3] || ''); }
    else {
      m = s.match(new RegExp('^(加|增加|給我|獲得|扣除|減少|扣)?\\s*' + amount + '\\s*(?:個|枚|份)?\\s*' + list + '$', 'i'));
      if (!m) return null;
      resources = m[3]; raw = m[2]; verb = m[1] || '';
    }
    var value = parseChineseNum(raw);
    if (value === null) return null;
    if (/扣|減少/.test(verb)) {
      if (value < 0 || /加|增加/.test(verb)) return null;
      value = -value;
    }
    return resources.split(/\s*[、和與及,，]\s*/).map(function (name) {
      var key = /^(金幣|錢|gold)$/i.test(name) ? 'gold' : /^(裝備碎片|碎片|scrap)$/i.test(name) ? 'scrap' :
        /^(附魔精華|精華|essence)$/i.test(name) ? 'essence' : 'dust';
      return key + ' ' + value;
    });
  }

  function parseFastEquipMod(s) {
    var m = s.match(/^(?:把)?(全身(?:的)?裝備|身上(?:的)?裝備|選中(?:的)?裝備|這件裝備|全身|身上|選中|這件|主手武器|主手|副手|武器|頭盔|肩甲|胸甲|腰帶|手套|護腕|護腿|靴子|戒指1|戒指2|戒指|項鍊|項鏈)(?:的)?\s*(.+)$/);
    if (!m) return null;
    var targets = { 主手武器: 'weapon', 主手: 'weapon', 武器: 'weapon', 副手: 'weapon2', 頭盔: 'helmet', 肩甲: 'shoulder', 胸甲: 'chest', 腰帶: 'belt', 手套: 'gloves', 護腕: 'wrist', 護腿: 'legs', 靴子: 'boots', 戒指1: 'ring', 戒指: 'ring', 戒指2: 'ring2', 項鍊: 'amulet', 項鏈: 'amulet' };
    var target = /^(全身|身上)/.test(m[1]) ? 'wear' : targets[m[1]] || 'sel';
    var prefix = 'modequip ' + target + ' ';
    var rest = m[2].trim();
    if (/^(?:全部|都)?(?:改成|設為|變成)?(?:全|全部)?太古$/.test(rest)) return prefix + 'ancient all';
    if (/^(?:全部|都)?(?:改成|設為|變成)?(?:非太古|普通詞條)$/.test(rest)) return prefix + 'ancient none';
    var up = rest.match(/^(?:強化\s*(?:設為|改成|到)?\s*\+?|\+)(\d+)$/);
    if (up) return prefix + '+' + up[1];
    var affix = rest.match(/^(?:加上|增加|新增)?(物理攻擊|物攻|魔法攻擊|魔攻|生命|吸血|吸魔|寶石鑲嵌效率|暴擊率|暴傷|冷卻縮減|攻速)\s*(?:設為|改成|改為|到)?\s*([+-]?\d+(?:\.\d+)?\s*[兆億萬千百kmb]?)\s*(%|％)?\s*(?:(?:且|並)?(?:為|設為)?(太古|非太古))?$/i);
    if (!affix) return null;
    if (affix[3] && /^(物理攻擊|物攻|魔法攻擊|魔攻|生命)$/.test(affix[1])) return null;
    var keys = { 物理攻擊: 'atkFlat', 物攻: 'atkFlat', 魔法攻擊: 'matkFlat', 魔攻: 'matkFlat', 生命: 'hpFlat', 吸血: 'lifesteal', 吸魔: 'manaSteal', 寶石鑲嵌效率: 'gemEff', 暴擊率: 'critRate', 暴傷: 'critDmg', 冷卻縮減: 'cdr', 攻速: 'aspd' };
    var value = parseChineseNum(affix[2], true);
    if (value === null) return null;
    return prefix + keys[affix[1]] + ' ' + value + (affix[4] ? (affix[4] === '太古' ? ' ancient' : ' normal') : '');
  }

  var FAST_RARITY_MAP = {
    '神鑄混沌': 'chaosGodforged', '神鑄混沌裝備': 'chaosGodforged', 'chaosgodforged': 'chaosGodforged',
    '混沌': 'chaos', '混沌裝備': 'chaos', 'chaos': 'chaos',
    '神鑄創世': 'godforged', '神鑄創世裝備': 'godforged', '神鑄': 'godforged', 'godforged': 'godforged',
    '創世': 'genesis', '創世裝備': 'genesis', 'genesis': 'genesis',
    '神話': 'mythic', '神話裝備': 'mythic', 'mythic': 'mythic',
    '傳說': 'legendary', '傳說裝備': 'legendary', 'legendary': 'legendary',
    '史詩': 'epic', '史詩裝備': 'epic', 'epic': 'epic',
    '獨特': 'unique', '獨特裝備': 'unique', 'unique': 'unique',
    '稀有': 'rare', '稀有裝備': 'rare', 'rare': 'rare',
    '精良': 'uncommon', '精良裝備': 'uncommon', 'uncommon': 'uncommon',
    '普通': 'common', '普通裝備': 'common', 'common': 'common'
  };

  function parseSingleFastClause(rawClause) {
    var s = normalizeFastClause(rawClause);
    if (!s) return null;
    var modification = parseFastEquipMod(s);
    if (modification) return modification;
    s = s.replace(/(\d)\s*(?:個|顆|點)$/, '$1');

    // 1. 貨幣與材料：金幣 / 碎片 / 精華 / 魔塵
    var mGold = s.match(/^(?:加|增加|給我|獲得)?\s*(?:金幣|錢|gold)\s*([+-]?\d+[\w億萬千kmb]*)$/i) ||
                s.match(/^(?:加|增加|給我|獲得)?\s*([+-]?\d+[\w億萬千kmb]*)\s*(?:金幣|錢|gold)$/i);
    if (mGold) {
      var gVal = parseChineseNum(mGold[1]);
      if (gVal !== null) return 'gold ' + gVal;
    }

    var mScrap = s.match(/^(?:加|增加|給我|獲得)?\s*(?:裝備碎片|碎片|scrap)\s*([+-]?\d+[\w億萬千kmb]*)$/i) ||
                 s.match(/^(?:加|增加|給我|獲得)?\s*([+-]?\d+[\w億萬千kmb]*)\s*(?:裝備碎片|碎片|scrap)$/i);
    if (mScrap) {
      var scVal = parseChineseNum(mScrap[1]);
      if (scVal !== null) return 'scrap ' + scVal;
    }

    var mEssence = s.match(/^(?:加|增加|給我|獲得)?\s*(?:附魔精華|精華|essence)\s*([+-]?\d+[\w億萬千kmb]*)$/i) ||
                   s.match(/^(?:加|增加|給我|獲得)?\s*([+-]?\d+[\w億萬千kmb]*)\s*(?:附魔精華|精華|essence)$/i);
    if (mEssence) {
      var esVal = parseChineseNum(mEssence[1]);
      if (esVal !== null) return 'essence ' + esVal;
    }

    var mDust = s.match(/^(?:加|增加|給我|獲得)?\s*(?:魔塵|dust)\s*([+-]?\d+[\w億萬千kmb]*)$/i) ||
                s.match(/^(?:加|增加|給我|獲得)?\s*([+-]?\d+[\w億萬千kmb]*)\s*(?:魔塵|dust)$/i);
    if (mDust) {
      var duVal = parseChineseNum(mDust[1]);
      if (duVal !== null) return 'dust ' + duVal;
    }

    // 2. equipset 全身整套裝備發放（例如「加全身強化+50神話4太古裝備」或「全身換500級神鑄混沌裝備」）
    if (/裝備|套裝|全身|穿戴/i.test(s)) {
      var qMatch = null;
      var qKeys = Object.keys(FAST_RARITY_MAP);
      for (var qi = 0; qi < qKeys.length; qi++) {
        var qWord = qKeys[qi];
        if (s.indexOf(qWord) >= 0) {
          qMatch = FAST_RARITY_MAP[qWord];
          break;
        }
      }

      if (qMatch) {
        // 發放裝備必須吃完整句；不能把修改單件、未知附加要求當成發放全套。
        var remainder = s.replace(qWord, ' ').replace(/\d+\s*級|(?:強化\s*\+?|\+)\d+|\d+\s*太古|全太古/g, '')
          .replace(/^(?:加|增加|給我|獲得|穿上|換上|換成)/, '')
          .replace(/^全身換(?:成|上)?/, '全身')
          .replace(/全身|套裝|裝備|穿戴|放入背包|放背包|進背包|到背包|的/g, '').trim();
        if (remainder || !/全身|套裝/.test(s) && !/^(?:加|增加|給我|獲得|穿上|換上|換成)/.test(s)) return null;
        if ((s.match(/\d+\s*級/g) || []).length > 1 ||
            (s.match(/(?:強化\s*\+?|\+)\d+/g) || []).length > 1 ||
            (s.match(/\d+\s*太古|全太古/g) || []).length > 1) return null;
        var lvMatch = s.match(/(\d+)\s*級/);
        var setLv = lvMatch ? parseInt(lvMatch[1], 10) : 500;
        var upMatch = s.match(/(?:\+|強化\s*\+?)(\d+)/);
        var setUp = upMatch ? parseInt(upMatch[1], 10) : 0;
        var ancMatch = s.match(/(\d+)\s*太古/);
        var setAnc = ancMatch ? parseInt(ancMatch[1], 10) : (/全太古/.test(s) ? 4 : 0);
        var isWear = !/放背包|進背包|到背包|放入背包/.test(s);
        return 'equipset ' + qMatch + ' ' + setLv + ' ' + setUp + ' ' + setAnc + (isWear ? ' wear' : ' inv');
      }
    }

    // 3. 全身裝備直接修改（modequip wear）
    // 3a) 太古
    if (/^(?:把)?(?:身上|全身|當前)?(?:的)?(?:裝備)?(?:全部|都)?(?:改成|設為|變)?(?:全|全部)?太古$/i.test(s) ||
        /^(?:全身|身上)太古$/i.test(s) || /^(?:全身|身上)全太古$/i.test(s)) {
      return 'modequip wear ancient all';
    }
    if (/^(?:把)?(?:選中|當前|這個)?(?:的)?裝備(?:全部|都)?(?:改成|設為)?(?:全|全部)?太古$/i.test(s)) {
      return 'modequip sel ancient all';
    }

    // 3b) 強化
    var mWearUp = s.match(/^(?:把)?(?:身上|全身|當前)?(?:的)?裝備強化\s*(?:設為|改成)?\+?(\d+)$/i) ||
                  s.match(/^(?:全身|身上)\s*\+(\d+)$/i) ||
                  s.match(/^(?:全身|身上)強化\s*\+?(\d+)$/i);
    if (mWearUp) {
      return 'modequip wear +' + mWearUp[1];
    }
    var mSelUp = s.match(/^(?:把)?(?:選中|當前|這個)?(?:的)?裝備強化\s*(?:設為|改成)?\+?(\d+)$/i) ||
                 s.match(/^(?:選中|當前)\s*\+(\d+)$/i);
    if (mSelUp) {
      return 'modequip sel +' + mSelUp[1];
    }

    // 4. 全身孔位鑲滿寶石與符文（socketall）
    var mSocket = s.match(/^(?:把)?(?:全身|所有裝備|孔位)?(?:都)?(?:鑲滿|插滿)\s*(\d+)?\s*(?:級|階)?(?:寶石)?(?:與符文)?$/i) ||
                  s.match(/^(?:把)?(?:全身|所有裝備|孔位)?(?:都)?寶石(?:都)?(?:鑲滿|插滿)$/i);
    if (mSocket) {
      var sLv = (mSocket[1] && parseInt(mSocket[1], 10)) || 10;
      return 'socketall ' + sLv;
    }

    // 5. 技能滿級與解鎖
    if (/^(?:全)?技能(?:全部)?(?:升至)?滿級$/i.test(s) || /^技能全滿$/i.test(s) || /^技能滿$/i.test(s) || /^技能全部滿級$/i.test(s)) {
      return 'skillmax all';
    }
    if (/^(?:全)?技能(?:全部)?解鎖$/i.test(s) || /^解鎖(?:全|全部)?技能$/i.test(s)) {
      return 'skill_unlock on';
    }
    var mSkillPointSub = s.match(/^(?:扣除|減少|扣)\s*技能點(?:數)?\s*(\d+)\s*(?:點)?$/i);
    if (mSkillPointSub) {
      return 'skill_point -' + mSkillPointSub[1];
    }
    var mSkillPoint = s.match(/^(?:加|增加|獲得|給我)?\s*技能點(?:數)?\s*([+-]?\d+)\s*(?:點)?$/i) ||
                      s.match(/^技能點(?:數)?\s*([+-]?\d+)\s*(?:點)?$/i);
    if (mSkillPoint) {
      return 'skill_point ' + mSkillPoint[1];
    }

    // 6. 等級與轉生
    var mLv = s.match(/^(?:角色)?等級(?:設為|升到|提升至)?\s*(\d+)$/i) || s.match(/^等級\s*(\d+)$/i) || s.match(/^升到\s*(\d+)\s*級$/i);
    if (mLv) {
      return 'level ' + mLv[1];
    }
    var mTurn = s.match(/^(?:設定)?轉生\s*(\d+)\s*次?$/i) || s.match(/^(\d+)\s*轉$/i);
    if (mTurn) {
      return 'turn ' + mTurn[1];
    }

    // 7. 背包容量
    var mBag = s.match(/^背包(?:容量)?(?:擴充到|設為)?\s*(\d+)$/i);
    if (mBag) {
      return 'bag ' + mBag[1];
    }

    // 8. 跳關
    var mStage = s.match(/^跳關(?:到)?\s*([^\s\d]+)\s*(\d+)(?:關|階)?$/i);
    if (mStage) {
      return 'stage ' + mStage[1] + ' ' + mStage[2];
    }

    // 9. 寶石與符文發放
    var mGemAll = s.match(/^(?:加|給我|獲得)?\s*(?:所有|全部)寶石(?:各)?\s*(\d+)\s*(?:個|顆)?$/i);
    if (mGemAll) {
      return 'gem all ' + mGemAll[1];
    }
    var mRuneAll = s.match(/^(?:加|給我|獲得)?\s*(?:所有|全部)符文(?:各)?\s*(\d+)\s*(?:個|顆)?$/i);
    if (mRuneAll) {
      return 'rune all ' + mRuneAll[1];
    }

    // 10. 鎖血 / 無敵
    if (/^(?:開啟)?(?:無敵|鎖血)$/i.test(s)) {
      return 'god 1';
    }
    if (/^關閉(?:無敵|鎖血)$/i.test(s)) {
      return 'god 0';
    }

    return null;
  }

  function parseFastPath(userPrompt) {
    if (!userPrompt) return null;
    var trimmed = normalizeFastClause(userPrompt);
    if (!trimmed) return null;
    if (allowsAffixOverflow(userPrompt)) {
      trimmed = trimmed.replace(/(?:且|並且|並)?\s*(?:[（(]\s*)?(?:允許)?突破詞條(?:數量)?上限(?:\s*[）)])?/g, '').trim();
    }

    var resources = parseFastResources(trimmed);
    if (resources) return resources;

    // 將白話文句按分隔符分割成子句
    var parts = trimmed.split(/(?:[，,、;；\n。]+|然後|並且|而且|再把|再加|接著)/);
    var clauses = parts.map(function (p) { return p.trim(); }).filter(Boolean);
    if (!clauses.length) return null;

    var resultCmds = [];
    for (var i = 0; i < clauses.length; i++) {
      var resourceCmds = parseFastResources(clauses[i]);
      if (resourceCmds) {
        resultCmds = resultCmds.concat(resourceCmds);
        continue;
      }
      var cmd = parseSingleFastClause(clauses[i]);
      if (!cmd) {
        return null; // 若有任何一個子句無法完全由本機直譯，交回 Gemini LLM
      }
      resultCmds.push(cmd);
    }
    return resultCmds.length ? applyAffixOverflowPolicy(resultCmds, userPrompt) : null;
  }

  /* 使用 Gemini 將白話文自然語言轉為標準 GM 指令陣列 */
  function parseNaturalCommand(userPrompt, customKey, onProgress) {
    if (!isInternal()) {
      return Promise.reject(new Error('自然語言 GM 功能僅限內測環境使用'));
    }
    cancelNaturalCommand();

    // 優先執行 0ms 本地高速直譯
    var fastResult = parseFastPath(userPrompt);
    if (fastResult && fastResult.length) {
      return Promise.resolve(fastResult);
    }
    var cachedResult = getCachedNaturalCommand(userPrompt);
    if (cachedResult) return Promise.resolve(cachedResult);

    var key = customKey || getApiKey();
    if (!key) {
      return Promise.reject(new Error('尚未設定 Gemini API 金鑰，請先在 Esc -> 設置中輸入'));
    }

    var systemInstruction =
      '你是一個 Idle-RPG 遊戲的 GM 指令翻譯官。請將玩家說的自然語言，精準轉換為遊戲底層支援的 GM 指令陣列。\n' +
      '你必須只輸出 JSON 字串陣列，格式為 ["command 1", "command 2"]，不可包含任何 markdown 標籤或解釋。\n\n' +
      '【支援的 GM 指令清單】\n' +
      '1. 貨幣與材料：\n' +
      '   - gold <數量>：加金幣（中文單位請換算為整數，例如 1000億 -> 100000000000，10萬 -> 100000，負數為扣除）\n' +
      '   - scrap <數量>：加裝備碎片（例如 1000億 -> 100000000000）\n' +
      '   - essence <數量>：加附魔精華\n' +
      '   - dust <數量>：加魔塵\n' +
      '2. 裝備與套裝（全身 13 件部位）：\n' +
      '   - equipset <品質> [裝備等級] [強化等級] [太古數] [wear/inv]\n' +
      '     * 品質 key：common(普通/0), uncommon(精良/1), rare(稀有/2), unique(獨特/3), epic(史詩/4), legendary(傳說/5), mythic(神話/6), genesis(創世/7), godforged(神鑄創世/8), chaos(混沌/9), chaosGodforged(神鑄混沌/10)\n' +
      '     * 裝備等級：若玩家未指定填 500\n' +
      '     * 強化等級：例如「+100」填 100，「+50」填 50，未提填 0\n' +
      '     * 太古數：例如「4太古」填 4，未提填 0\n' +
      '     * wear/inv：提到換裝、穿上、全身或套裝一律填 wear；放背包填 inv\n' +
      '   - equip <品質> <裝備等級> [部位] [數量] [強化等級] [太古數]：單件裝備\n' +
      '   - modequip [目標] <屬性> <數值> [ancient|normal]：修改已有詞條；不存在時替換現有詞條，不增加條數\n' +
      '     * 一般裝備詞條數必須維持品質正常數量，雙手武器依正常加成；全太古只改既有詞條。創世胸甲是7條，不能因指定吸血／吸魔變成9條。\n' +
      '     * 同句多個屬性用多條modequip依序設定，系統會保護本批次先前指定的詞條；超過現有槽數須報錯，不能自行突破。\n' +
      '     * 只有玩家原句明確說「突破詞條上限」時，才能加 --allow-overcap 允許追加；單純「加上／增加屬性」不代表突破，禁止自行加旗標。\n' +
      '     * 目標：wear（全身 13 件穿戴裝備批次修改）、sel / 省略（選中裝備）、inv（背包選中裝備）、set1 weapon（第1套主手）、1 1（第1套第1部位）、weapon、helmet、amulet 等\n' +
      '     * 太古操作：modequip wear ancient all（全身裝備全部變太古）、modequip [目標] ancient all、ancient none（全部變非太古）、ancient 4（前4條太古）\n' +
      '     * 強化操作：modequip wear +100（全身強化設為+100）、modequip [目標] +100\n' +
      '     * 重要屬性 key：寶石鑲嵌效率為 gemEff，吸血為 lifesteal，吸魔為 manaSteal，物攻為 atkFlat，魔攻為 matkFlat，生命為 hpFlat，暴擊率為 critRate，暴傷為 critDmg，冷卻縮減為 cdr，攻速為 aspd\n' +
      '3. 全身鑲滿寶石與符文：\n' +
      '   - socketall [等級1~10]：全身 13 件裝備所有孔位鑲滿指定等級隨機寶石與高階符文（例：socketall 10）\n' +
      '4. 場景與關卡跳關：\n' +
      '   - stage <場景名稱或編號> <關卡數>：例如「跳關到亡靈山脈240關」-> stage 亡靈山脈 240\n' +
      '5. 角色等級與轉生：\n' +
      '   - level <等級>：設定角色等級（如 level 1000）\n' +
      '   - turn <次數>：設定轉生次數（如 turn 1）\n' +
      '6. 背包容量：\n' +
      '   - bag <容量>：例如 bag 2000\n' +
      '7. 技能與天賦：\n' +
      '   - skillmax all：所有新版技能群組滿級\n' +
      '   - skill_unlock：切換技能全解鎖\n' +
      '   - skill_point <數量>：增加或扣除技能點數（可為正負整數）\n' +
      '   - skillxp <數量>：加技能熟練度經驗；masterylv <等級>：設定熟練度等級\n' +
      '8. 寶石（等級 1~10，數量為整數）：\n' +
      '   - gem all <數量>：所有寶石種類、1~10 階全部各加 N 顆（玩家說「所有寶石」「全部寶石」且沒指定等級時用這個）\n' +
      '   - gem all <等級> <數量>：所有寶石種類的指定等級各加 N 顆（例：「所有 10 級寶石各 100 個」）\n' +
      '   - gem <寶石key> <等級> <數量>：單一種類寶石。可用 key：' + gemKeyHint() + '\n' +
      '9. 符文與符文真言：\n' +
      '   - rune all <數量>：33 種符文各加 N 顆；rune <r01~r33> <數量>：單一符文\n' +
      '   - runeword list：列出符文真言；runeword <id>：發放該組配方符文\n' +
      '10. 其他：\n' +
      '   - xp <數量>：加角色經驗；mat <gold|scrap|essence|dust> <數量>：同貨幣指令\n' +
      '   - part <階級> [salvage|synth] [數量]：加零件\n\n' +
      '【規則】\n' +
      '- 玩家說「所有／全部」某類東西且未指定細項，就用該類的 all 指令，不要拒絕或回傳空陣列。\n' +
      '- 數量一律換算成純整數（「100個」->100，「1000億」->100000000000）。\n' +
      '- 只有完全與遊戲無關時才回傳 []；只要有任何指令可近似，就輸出最接近的指令。\n\n' +
      '【轉換範例】\n' +
      '輸入：「把身上的裝備改成全太古」\n' +
      '輸出：["modequip wear ancient all"]\n\n' +
      '輸入：「把選中的裝備改成全太古且強化+100」\n' +
      '輸出：["modequip sel ancient all", "modequip sel +100"]\n\n' +
      '輸入：「把項鍊加上吸血、吸魔、寶石鑲嵌效率100且為太古」\n' +
      '輸出：["modequip amulet lifesteal 100 ancient", "modequip amulet manaSteal 100 ancient", "modequip amulet gemEff 100 ancient"]\n\n' +
      '輸入：「把第一套主手武器物攻改成50000且為太古」\n' +
      '輸出：["modequip 1 1 atkFlat 50000 ancient"]\n\n' +
      '輸入：「把全身裝備換成+100神鑄混沌裝備，要500級裝備，而且寶石跟符文都要鑲滿10級寶石，寶石種類隨意就行，然後再把金幣、裝備碎片、附魔精華各加1000億個，最後幫我跳關到亡靈山脈240關」\n' +
      '輸出：["equipset chaosGodforged 500 100 4 wear", "socketall 10", "gold 100000000000", "scrap 100000000000", "essence 100000000000", "stage 亡靈山脈 240"]\n\n' +
      '輸入：「加全身強化+50的神話裝備，並都是4太古的詞條」\n' +
      '輸出：["equipset mythic 500 50 4 wear"]\n\n' +
      '輸入：「加金幣1000億」\n' +
      '輸出：["gold 100000000000"]\n\n' +
      '輸入：「技能全部滿級，給我100萬碎片」\n' +
      '輸出：["skillmax all", "scrap 1000000"]\n\n' +
      '輸入：「加所有寶石100個」\n' +
      '輸出：["gem all 100"]\n\n' +
      '輸入：「紅寶石10級給我50顆，符文每種10個」\n' +
      '輸出：["gem ruby 10 50", "rune all 10"]\n';

    var request = createNaturalRequest();
    var parsing = Promise.resolve().then(function () {
      return getCandidateModels(request);
    }).then(function (candidates) {
      request.check();
      candidates = candidates.slice(0, 2);

      var body = {
        contents: [
          {
            parts: [
              { text: systemInstruction + '\n玩家輸入：「' + userPrompt + '」\n輸出 JSON 陣列：' }
            ]
          }
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 1024,
          response_mime_type: 'application/json'
        }
      };

      function callSingleModel(modelName) {
        request.check();
        var controller = new AbortController();
        var deadline = Date.now() + NATURAL_ATTEMPT_TIMEOUT_MS;
        var stopped = null;
        var rejectStopped;
        var attemptStopped = new Promise(function (_, reject) { rejectStopped = reject; });
        function stopAttempt(error) {
          if (stopped) return;
          stopped = error;
          rejectStopped(error);
          controller.abort();
        }
        function timeoutError() {
          var error = new Error('已超過30秒無回應');
          error.name = 'AttemptTimeoutError';
          return error;
        }
        function checkAttempt() {
          request.check();
          if (!stopped && Date.now() >= deadline) stopAttempt(timeoutError());
          if (stopped) throw stopped;
        }
        function cancelAttempt() {
          try { request.check(); } catch (error) { stopAttempt(error); }
        }
        var timer = setTimeout(function () { stopAttempt(timeoutError()); }, NATURAL_ATTEMPT_TIMEOUT_MS);
        request.signal.addEventListener('abort', cancelAttempt, { once: true });
        function finishAttempt() {
          clearTimeout(timer);
          request.signal.removeEventListener('abort', cancelAttempt);
        }
        var profile = FAST_MODEL_PROFILES.find(function (item) { return item.name === modelName; });
        var modelBody = Object.assign({}, body, {
          generationConfig: Object.assign({}, body.generationConfig, { thinkingConfig: profile.thinkingConfig })
        });
        var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(modelName) + ':generateContent?key=' + encodeURIComponent(key);
        var work = Promise.resolve().then(function () {
          checkAttempt();
          return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify(modelBody)
          });
        }).then(function (res) {
          checkAttempt();
          if (!res.ok) {
            return res.json().catch(function () { return {}; }).then(function (data) {
              var msg = (data && data.error && data.error.message) || ('HTTP ' + res.status);
              throw new Error(msg);
            });
          }
          return res.json();
        }).then(function (data) {
          checkAttempt();
          var candidate = data && data.candidates && data.candidates[0];
          if (candidate && candidate.finishReason && candidate.finishReason !== 'STOP') {
            throw new Error('AI 指令回應未完整結束');
          }
          var parts = candidate && candidate.content && candidate.content.parts || [];
          var rawText = parts.filter(function (part) { return part && !part.thought && typeof part.text === 'string'; })
            .map(function (part) { return part.text; }).join('');
          if (!rawText.trim()) throw new Error('AI 未回傳任何指令');
          var list = JSON.parse(rawText);
          if (!Array.isArray(list)) {
            if (typeof list === 'string') list = [list];
            else throw new Error('AI 回傳格式不正確');
          }
          checkAttempt();
          AiKeySetting._lastWorkingModel = modelName;
          if (!list.every(function (c) { return typeof c === 'string' && c.trim() && !/[\r\n]/.test(c); })) {
            throw new Error('AI 回傳的指令格式不正確');
          }
          return applyAffixOverflowPolicy(list.map(function (c) { return c.trim(); }), userPrompt);
        });
        return Promise.race([work, attemptStopped]).then(function (commands) {
          checkAttempt();
          return commands;
        }).then(function (commands) {
          finishAttempt();
          return commands;
        }, function (error) {
          finishAttempt();
          throw error;
        });
      }

      var lastError = null;
      function tryModel(index, previousError) {
        request.check();
        if (!candidates.length || index > NATURAL_MAX_RETRIES) {
          try {
            if (typeof localStorage !== 'undefined') localStorage.removeItem(MODELS_CACHE_KEY);
          } catch (e) {}
          var detailMsg = lastError ? (lastError.message || String(lastError)) : '所有備用模型均無法回應';
          throw new Error('雲端解析失敗，最多重試3次已用完，指令未執行（' + detailMsg + '）。');
        }
        var modelName = candidates[index % candidates.length];
        if (typeof onProgress === 'function') onProgress({
          model: modelName, attempt: index + 1, retry: index,
          reason: previousError && previousError.name === 'AttemptTimeoutError' ? 'timeout' : index ? 'error' : 'start'
        });
        return callSingleModel(modelName).catch(function (err) {
          request.check();
          lastError = new Error(modelName + ': ' + err.message);
          return tryModel(index + 1, err);
        });
      }

      return tryModel(0);
    });
    return Promise.race([parsing, request.stopped]).then(function (commands) {
      request.check();
      request.finish();
      return commands;
    }).catch(function (err) {
      request.finish();
      throw err;
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
    parseFastPath: parseFastPath,
    parseNaturalCommand: parseNaturalCommand,
    cancelNaturalCommand: cancelNaturalCommand,
    getCachedNaturalCommand: getCachedNaturalCommand,
    rememberNaturalCommand: rememberNaturalCommand,
    forgetNaturalCommand: forgetNaturalCommand,
    clearNaturalCommandCache: clearNaturalCommandCache,
    getNaturalPresets: getNaturalPresets,
    applyAffixOverflowPolicy: applyAffixOverflowPolicy,
    getNaturalTiming: function () {
      return { attemptTimeoutMs: NATURAL_ATTEMPT_TIMEOUT_MS, maxRetries: NATURAL_MAX_RETRIES, totalTimeoutMs: NATURAL_TIMEOUT_MS };
    },
    initUI: initUI
  };

  if (typeof window !== 'undefined') {
    window.AiKeySetting = AiKeySetting;
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUI);
      } else {
        initUI();
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AiKeySetting;
  }
})();
