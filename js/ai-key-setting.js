'use strict';
/* ============ 內測專用：AI 自然語言 GM 金鑰管理模組 ============
   只有在內測服環境（isInternalServer / isGMHost）才允許顯示與操作。
   金鑰只儲存於瀏覽器 localStorage，不進任何存檔或伺服器。 */

(function () {
  var STORAGE_KEY = 'idle_rpg_gemini_api_key';
  var MODELS_CACHE_KEY = 'idle_rpg_gemini_models';

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

        // 排序優先度：包含 flash 的優先（極速），其次 2.0、1.5、pro
        var ranked = [];
        ['2.0-flash', '1.5-flash', 'flash', '2.0', '1.5', 'pro'].forEach(function (kw) {
          supported.forEach(function (name) {
            if (name.toLowerCase().indexOf(kw) >= 0 && ranked.indexOf(name) === -1) {
              ranked.push(name);
            }
          });
        });
        supported.forEach(function (name) {
          if (ranked.indexOf(name) === -1) ranked.push(name);
        });

        if (ranked.length && typeof localStorage !== 'undefined') {
          try { localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(ranked)); } catch (e) {}
        }
        return ranked;
      });
  }

  /* 取得候選模型：若本機已有快取則 0ms 立即回傳；無快取才連線發現一次 */
  function getCandidateModels(targetKey) {
    try {
      if (typeof localStorage !== 'undefined') {
        var cached = JSON.parse(localStorage.getItem(MODELS_CACHE_KEY) || 'null');
        if (Array.isArray(cached) && cached.length > 0) {
          return Promise.resolve(cached);
        }
      }
    } catch (e) {}

    return fetchAvailableModels(targetKey).catch(function () {
      return ['gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-flash', 'gemini-2.5-flash'];
    });
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

  /* ============ 本地高速直譯通道（Fast-Path，0ms 無延遲直譯） ============ */
  function parseChineseNum(str) {
    if (!str) return null;
    var s = String(str).trim();
    var sign = 1;
    if (s.charAt(0) === '+') s = s.slice(1).trim();
    else if (s.charAt(0) === '-') { sign = -1; s = s.slice(1).trim(); }

    var m = s.match(/^(\d+(?:\.\d+)?)\s*([億萬千kmb]?)$/i);
    if (!m) return null;
    var val = parseFloat(m[1]);
    var unit = (m[2] || '').toLowerCase();
    if (unit === '億') val *= 1e8;
    else if (unit === '萬') val *= 1e4;
    else if (unit === '千' || unit === 'k') val *= 1e3;
    else if (unit === 'm') val *= 1e6;
    else if (unit === 'b') val *= 1e9;
    return sign * Math.round(val);
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
    var s = String(rawClause || '').trim();
    if (!s) return null;

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
    var trimmed = String(userPrompt).trim();
    if (!trimmed) return null;

    // 將白話文句按分隔符分割成子句
    var parts = trimmed.split(/(?:[，,、;；\n]+|然後|並且|再把|再加|接著)/);
    var clauses = parts.map(function (p) { return p.trim(); }).filter(Boolean);
    if (!clauses.length) return null;

    var resultCmds = [];
    for (var i = 0; i < clauses.length; i++) {
      var cmd = parseSingleFastClause(clauses[i]);
      if (!cmd) {
        return null; // 若有任何一個子句無法完全由本機直譯，交回 Gemini LLM
      }
      resultCmds.push(cmd);
    }
    return resultCmds.length ? resultCmds : null;
  }

  /* 使用 Gemini 將白話文自然語言轉為標準 GM 指令陣列 */
  function parseNaturalCommand(userPrompt, customKey) {
    if (!isInternal()) {
      return Promise.reject(new Error('自然語言 GM 功能僅限內測環境使用'));
    }

    // 優先執行 0ms 本地高速直譯
    var fastResult = parseFastPath(userPrompt);
    if (fastResult && fastResult.length) {
      return Promise.resolve(fastResult);
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
      '   - modequip [目標] <屬性> <數值> [ancient|normal]：直接修改裝備詞條、數值或太古\n' +
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

    return getCandidateModels(key).then(function (candidates) {
      if (AiKeySetting._lastWorkingModel && candidates.indexOf(AiKeySetting._lastWorkingModel) >= 0) {
        candidates = [AiKeySetting._lastWorkingModel].concat(candidates.filter(function (m) { return m !== AiKeySetting._lastWorkingModel; }));
      }

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
          maxOutputTokens: 256,
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
          AiKeySetting._lastWorkingModel = modelName;
          return list.map(function (c) { return String(c).trim(); }).filter(Boolean);
        });
      }

      var lastError = null;
      function tryModel(index) {
        if (index >= candidates.length) {
          try {
            if (typeof localStorage !== 'undefined') localStorage.removeItem(MODELS_CACHE_KEY);
          } catch (e) {}
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
    parseFastPath: parseFastPath,
    parseNaturalCommand: parseNaturalCommand,
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
