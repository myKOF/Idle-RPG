'use strict';
/* ============ GM 指令執行層（無 DOM 相依） ============
   原本與 GM 面板一起寫在 js/gm.js 的 IIFE 裡。指令會變更遊戲狀態，而狀態在 Worker，
   所以執行層必須能在 Worker 內載入——但面板是 DOM，只能留在主執行緒。因此拆成兩檔。

   本檔同時被主執行緒 <script> 與 Worker importScripts 載入，實作只有一份。
   ⚠️ Worker 模式下主執行緒**不得**呼叫本檔的函式：那會改到過期的鏡像狀態。
   由 js/gm.js 依 WorkerBridge.enabled() 決定走哪一邊。

   安全邊界不變：只接受本機 hostname，不依賴任何可被前端覆寫的旗標。 */

(function () {
  /* ---- GM 測試旗標（2026-08-14 技能檢驗流程規範）----
     掛全域讓 js/formula.js 的掛點（鎖血下限、屬性覆寫）能以 typeof 讀到。
     執行期狀態、不入存檔：重新整理（Worker 重建）即全部清除。 */
  var GM_GLOBAL = (typeof self !== 'undefined') ? self
    : ((typeof window !== 'undefined') ? window : globalThis);
  if (!GM_GLOBAL.GM_TEST) GM_GLOBAL.GM_TEST = {
    god: false, hpLock: false, mpLock: false, statOverride: null, skillUnlock: false
  };

  // 安全邊界：不依賴「是否為開發模式」等可被前端變數覆寫的旗標，只接受本機 hostname。
  function isGMHost() {
    var loc = (typeof window !== 'undefined' && window.location) ||
      (typeof location !== 'undefined' && location);
    var host = loc && loc.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }

  function gmNumber(raw, min, max) {
    var str = String(raw || '').trim();
    if (!/^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(str)) return null;
    var value = Number(str);
    if (!Number.isFinite(value) || value < min || value > max) return null;
    return value;
  }

  function gmSignedAmount(raw, max) {
    var str = String(raw || '').trim();
    if (!/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(str)) return null;
    var value = Number(str);
    if (!Number.isFinite(value) || value < -max || value > max) return null;
    return value;
  }

  function gmDirty() {
    if (typeof UI === 'undefined' || !UI.dirty) return;
    UI.dirty.header = true;
    UI.dirty.inv = true;
    UI.dirty.equip = true;
    UI.dirty.factory = true;
    UI.dirty.gems = true;
    UI.dirty.skills = true;
    UI.dirty.talents = true;
    UI.dirty.battle = true;
  }

  function gmRarity(raw, allowAny) {
    var key = String(raw || '').trim().toLowerCase();
    if (allowAny && (key === 'any' || key === '*')) return 'any';
    var n = gmNumber(key, 0, RARITIES.length - 1);
    if (n !== null) return n;
    for (var i = 0; i < RARITIES.length; i++) {
      if (String(RARITIES[i].key || '').toLowerCase() === key) return i;
      if (RARITIES[i].name === raw || (RARITIES[i].name && RARITIES[i].name.toLowerCase() === key)) return i;
    }
    var aliases = {
      'godforge': 8,
      'godforged': 8,
      '神鑄': 8,
      '神鑄創世': 8,
      'genesis': 7,
      '創世': 7,
      'chaos': 9,
      '混沌': 9,
      'chaosgodforged': 10,
      'chaos_godforged': 10,
      'godforge_chaos': 10,
      'godforged_chaos': 10,
      'godforgechaos': 10,
      '神鑄混沌': 10
    };
    if (aliases[key] !== undefined) return aliases[key];
    return null;
  }

  function gmSocketAll(rawGemLv, rawRune) {
    if (!G || !G.equipment) return { ok: false, message: '目前找不到玩家裝備資料。' };
    var gemLv = rawGemLv !== undefined ? gmNumber(rawGemLv, 1, 10) : 10;
    if (gemLv === null) return { ok: false, message: '寶石等級範圍需為 1~10' };

    var eqKeys = Object.keys(G.equipment);
    var equippedCount = 0;
    var socketCount = 0;
    var runeCount = 0;

    var validGemTypes = [];
    if (typeof GEM_TYPES !== 'undefined' && GEM_TYPES) {
      for (var gk in GEM_TYPES) {
        if (GEM_TYPES[gk] && GEM_TYPES[gk].enabled !== false) validGemTypes.push(gk);
      }
    }
    if (!validGemTypes.length) {
      validGemTypes = ['ruby', 'sapphire', 'topaz', 'emerald', 'diamond', 'amethyst', 'garnet', 'opal'];
    }

    var validRunes = [];
    if (typeof RUNES !== 'undefined' && Array.isArray(RUNES)) {
      validRunes = RUNES.map(function (r) { return r.id; }).filter(Boolean);
    }

    for (var i = 0; i < eqKeys.length; i++) {
      var it = G.equipment[eqKeys[i]];
      if (!it || typeof it !== 'object') continue;
      equippedCount++;

      // 1. 寶石插槽
      var maxSockets = 0;
      if (typeof RARITIES !== 'undefined' && RARITIES[it.rarity]) {
        maxSockets = Number(RARITIES[it.rarity].sockets) || 0;
      }
      if (maxSockets <= 0 && Array.isArray(it.sockets) && it.sockets.length > 0) {
        maxSockets = it.sockets.length;
      }
      if (maxSockets > 0) {
        if (!Array.isArray(it.sockets)) it.sockets = [];
        while (it.sockets.length < maxSockets) it.sockets.push(null);
        for (var si = 0; si < it.sockets.length; si++) {
          var pickedGem = validGemTypes[Math.floor(Math.random() * validGemTypes.length)];
          it.sockets[si] = { type: pickedGem, level: gemLv };
          socketCount++;
        }
      }

      // 2. 符文插槽
      var maxRunes = 0;
      if (typeof RARITIES !== 'undefined' && RARITIES[it.rarity]) {
        maxRunes = Number(RARITIES[it.rarity].runeSlots) || 0;
      }
      if (maxRunes > 0 && validRunes.length > 0) {
        if (!Array.isArray(it.runes)) it.runes = [];
        while (it.runes.length < maxRunes) it.runes.push(null);
        for (var ri = 0; ri < it.runes.length; ri++) {
          var pickedRune = validRunes[Math.floor(Math.random() * validRunes.length)];
          it.runes[ri] = pickedRune;
          runeCount++;
        }
      }
    }

    if (equippedCount === 0) {
      return { ok: false, message: '玩家身上尚未穿戴任何裝備，請先穿戴裝備（或使用 equipset）。' };
    }

    if (typeof markStatsDirty === 'function') markStatsDirty();
    gmDirty();
    if (typeof UI !== 'undefined' && UI.dirty) {
      UI.dirty.equip = true;
      UI.dirty.gems = true;
    }
    return {
      ok: true,
      message: '已將全身 ' + equippedCount + ' 件裝備全數鑲滿（共鑲嵌 ' + socketCount + ' 顆 Lv.' + gemLv + ' 寶石' + (runeCount > 0 ? '、' + runeCount + ' 枚高階符文' : '') + '）'
    };
  }

  function gmAddCurrency(key, amount) {
    var before = Number(G.player[key] || 0);
    var after = Math.max(0, before + amount);
    G.player[key] = after;
    gmDirty();
    var delta = Math.abs(before - after);
    var fmtAmt = typeof fmt === 'function' ? fmt(delta) : delta.toLocaleString('en-US');
    if (amount < 0) return '扣除 ' + fmtAmt + ' ' + key;
    return '增加 ' + fmtAmt + ' ' + key;
  }

  /* 武器類型鍵的大小寫不敏感比對：指令參數在解析時一律轉小寫，
     但 WEAPON_TYPES 的鍵是駝峰（magicSword1h…），直接查表會查不到。 */
  function gmWeaponTypeKey(raw) {
    if (typeof WEAPON_TYPES === 'undefined') return null;
    var key = String(raw || '').trim().toLowerCase();
    if (!key) return null;
    for (var k in WEAPON_TYPES) {
      if (k.toLowerCase() === key) return k;
      if (WEAPON_TYPES[k].name === raw) return k;   // 也接受中文名（單手魔劍…）
    }
    return null;
  }

  function gmGiveEquipment(rarity, level, slot, count, upgrade, ancientCount) {
    var weaponType;
    if (slot === 'any' || slot === '*') slot = null;
    var wt = slot ? gmWeaponTypeKey(slot) : null;
    if (wt) {
      weaponType = wt;
      slot = 'weapon';
    } else if (slot) {
      slot = slotTypeOf(slot);
    }
    if (slot && !SLOT_INFO[slot]) return '未知部位：' + slot;
    upgrade = (typeof upgrade === 'number' && upgrade > 0) ? upgrade : 0;
    ancientCount = (typeof ancientCount === 'number' && ancientCount > 0) ? ancientCount : 0;
    for (var i = 0; i < count; i++) {
      var itemRarity = rarity === 'any' ? Math.floor(Math.random() * RARITIES.length) : rarity;
      var opts = { rarity: itemRarity, level: level, slot: slot || undefined, weaponType: weaponType };
      if (ancientCount > 0) opts.ancientCount = ancientCount;
      var item = makeEquipment(level, opts);
      item.locked = false;
      if (upgrade > 0) item.upgrade = upgrade;
      G.inventory.push(item);
    }
    gmDirty();
    var extra = '';
    if (upgrade > 0) extra += ' 強化+' + upgrade;
    if (ancientCount > 0) extra += ' ' + ancientCount + '太古';
    return '增加裝備 ' + (rarity === 'any' ? '隨機品質' : RARITIES[rarity].name) + extra + '、Lv.' + level +
      (slot ? '、' + ((SLOT_INFO[slot] && SLOT_INFO[slot].name) || slot) : '、隨機部位') + ' x' + count;
  }

  function gmGiveEquipmentSet(rarity, level, upgrade, ancientCount, autoWear) {
    if (!level) {
      level = (G.player && G.player.level) || (G.stage && G.stage.current) || 1;
    }
    upgrade = (typeof upgrade === 'number' && upgrade > 0) ? upgrade : 0;
    ancientCount = (typeof ancientCount === 'number' && ancientCount > 0) ? ancientCount : 0;

    var oneHandTypes = ['sword1h', 'dagger1h', 'wand1h', 'magicSword1h'];
    var offHandTypes = ['shield', 'focus', 'spellbook', 'orb', 'dagger1h'];

    var setPieces = [
      { targetKey: 'weapon', slot: 'weapon', weaponType: typeof pick === 'function' ? pick(oneHandTypes) : oneHandTypes[Math.floor(Math.random() * oneHandTypes.length)], name: '主手' },
      { targetKey: 'weapon2', slot: 'weapon', weaponType: typeof pick === 'function' ? pick(offHandTypes) : offHandTypes[Math.floor(Math.random() * offHandTypes.length)], name: '副手' },
      { targetKey: 'helmet', slot: 'helmet', name: '頭盔' },
      { targetKey: 'shoulder', slot: 'shoulder', name: '肩甲' },
      { targetKey: 'chest', slot: 'chest', name: '胸甲' },
      { targetKey: 'belt', slot: 'belt', name: '腰帶' },
      { targetKey: 'gloves', slot: 'gloves', name: '護手' },
      { targetKey: 'wrist', slot: 'wrist', name: '手腕' },
      { targetKey: 'legs', slot: 'legs', name: '護腿' },
      { targetKey: 'boots', slot: 'boots', name: '靴子' },
      { targetKey: 'ring', slot: 'ring', name: '戒指' },
      { targetKey: 'ring2', slot: 'ring', name: '戒指Ⅱ' },
      { targetKey: 'amulet', slot: 'amulet', name: '項鍊' }
    ];

    if (!G.inventory) G.inventory = [];

    for (var i = 0; i < setPieces.length; i++) {
      var piece = setPieces[i];
      var itemRarity = rarity === 'any' ? Math.floor(Math.random() * RARITIES.length) : rarity;
      var opts = {
        rarity: itemRarity,
        level: level,
        slot: piece.slot,
        weaponType: piece.weaponType
      };
      if (ancientCount > 0) {
        opts.ancientCount = ancientCount;
      }
      var item = makeEquipment(level, opts);
      item.locked = false;
      if (upgrade > 0) {
        item.upgrade = upgrade;
      }
      if (autoWear && typeof equipItem === 'function') {
        equipItem(item, piece.targetKey);
      } else {
        G.inventory.push(item);
      }
    }
    gmDirty();
    if (typeof markStatsDirty === 'function') markStatsDirty();

    var rName = (rarity === 'any') ? '隨機品質' : ((typeof RARITIES !== 'undefined' && RARITIES[rarity] && RARITIES[rarity].name) || ('品質' + rarity));
    var extraDesc = '';
    if (upgrade > 0) extraDesc += ' 強化+' + upgrade;
    if (ancientCount > 0) extraDesc += ' ' + ancientCount + '太古';
    var actionDesc = autoWear ? '已自動替換並穿戴全身' : '已發放至背包';
    return actionDesc + '【' + rName + extraDesc + '】Lv.' + level + ' 全身 13 件裝備套裝（主手、副手、頭盔、肩甲、胸甲、腰帶、護手、手腕、護腿、靴子、戒指x2、項鍊）';
  }

  /* ============ 裝備直接修改 GM 指令（modequip / 改裝備） ============ */
  var GM_SLOT_NAMES = {
    weapon: 'weapon', weapon1: 'weapon', main: 'weapon', mainhand: 'weapon', '主手': 'weapon', '主手武器': 'weapon', '武器': 'weapon',
    weapon2: 'weapon2', sub: 'weapon2', offhand: 'weapon2', '副手': 'weapon2', '副手裝備': 'weapon2', '盾牌': 'weapon2',
    helmet: 'helmet', helm: 'helmet', head: 'helmet', '頭盔': 'helmet', '頭': 'helmet',
    shoulder: 'shoulder', '肩甲': 'shoulder', '護肩': 'shoulder', '肩膀': 'shoulder',
    chest: 'chest', body: 'chest', armor: 'chest', '胸甲': 'chest', '衣服': 'chest', '鎧甲': 'chest',
    belt: 'belt', waist: 'belt', '腰帶': 'belt',
    gloves: 'gloves', glove: 'gloves', hand: 'gloves', '護手': 'gloves', '手套': 'gloves',
    wrist: 'wrist', wrists: 'wrist', bracer: 'wrist', '手腕': 'wrist', '護腕': 'wrist',
    legs: 'legs', leg: 'legs', pants: 'legs', '護腿': 'legs', '褲子': 'legs', '腿部': 'legs',
    boots: 'boots', boot: 'boots', feet: 'boots', shoes: 'boots', '靴子': 'boots', '鞋子': 'boots',
    ring: 'ring', ring1: 'ring', '戒指': 'ring', '戒指1': 'ring', '戒指i': 'ring', '戒指Ⅰ': 'ring',
    ring2: 'ring2', '戒指2': 'ring2', '戒指ii': 'ring2', '戒指Ⅱ': 'ring2',
    amulet: 'amulet', neck: 'amulet', necklace: 'amulet', '項鍊': 'amulet'
  };

  function gmResolveSlotKey(raw) {
    if (!raw) return null;
    var str = String(raw).trim().toLowerCase();
    if (GM_SLOT_NAMES[str]) return GM_SLOT_NAMES[str];
    if (GM_SLOT_NAMES[raw]) return GM_SLOT_NAMES[raw];
    var n = Number(str);
    if (Number.isInteger(n) && n >= 1 && typeof SLOT_LIST !== 'undefined' && n <= SLOT_LIST.length) {
      return SLOT_LIST[n - 1];
    }
    return null;
  }

  function gmSlotLabel(slotKey) {
    if (typeof SLOT_INFO !== 'undefined' && SLOT_INFO[slotKey] && SLOT_INFO[slotKey].name) {
      return SLOT_INFO[slotKey].name;
    }
    return slotKey || '裝備';
  }

  var GM_AFFIX_ALIASES = {
    atk: 'atkFlat', '物攻': 'atkFlat', '攻擊': 'atkFlat', '物理攻擊': 'atkFlat',
    matk: 'matkFlat', '魔攻': 'matkFlat', '魔法攻擊': 'matkFlat',
    hp: 'hpFlat', '生命': 'hpFlat', '生命值': 'hpFlat', '血量': 'hpFlat',
    def: 'defFlat', '物防': 'defFlat', '防禦': 'defFlat', '物理防禦': 'defFlat',
    mdef: 'mdefFlat', '魔防': 'mdefFlat', '魔法防禦': 'mdefFlat',
    crit: 'critRate', '暴擊': 'critRate', '暴擊率': 'critRate', '爆擊': 'critRate', '爆擊率': 'critRate',
    critdmg: 'critDmg', '暴擊傷害': 'critDmg', '爆擊傷害': 'critDmg', '爆傷': 'critDmg', '暴傷': 'critDmg',
    aspd: 'aspd', '攻速': 'aspd', '攻擊速度': 'aspd',
    cdr: 'cdr', '冷卻': 'cdr', '冷卻縮減': 'cdr',
    pen: 'pPen', ppen: 'pPen', '物穿': 'pPen', '物理穿透': 'pPen',
    mpen: 'mPen', '魔穿': 'mPen', '魔法穿透': 'mPen',
    hit: 'hit', '命中': 'hit', '命中率': 'hit',
    aoe: 'aoeDmg', aoedmg: 'aoeDmg', '範圍傷害': 'aoeDmg', '範圍': 'aoeDmg',
    block: 'blockRate', blockrate: 'blockRate', '格擋': 'blockRate', '格擋率': 'blockRate',
    blockred: 'blockDmgRed', blockdmgred: 'blockDmgRed', '格擋減傷': 'blockDmgRed',
    eva: 'evasion', evasion: 'evasion', '閃避': 'evasion', '閃避率': 'evasion',
    str: 'str', '力量': 'str',
    agi: 'agi', '敏捷': 'agi',
    int: 'int', '智力': 'int',
    vit: 'vit', '體質': 'vit',
    luck: 'luck', '幸運': 'luck', '幸運值': 'luck',
    movespeed: 'moveSpeed', '移速': 'moveSpeed', '移動速度': 'moveSpeed',
    loot: 'loot', '掉寶': 'loot', '掉寶率': 'loot',
    xpbonus: 'xpBonus', '經驗加成': 'xpBonus',
    // 寶石鑲嵌效率
    gemeff: 'gemEff',
    gemsocketrate: 'gemEff',
    gemrate: 'gemEff',
    gemsocketeff: 'gemEff',
    gemsocketefficiency: 'gemEff',
    gemefficiency: 'gemEff',
    gemsocket: 'gemEff',
    '寶石鑲嵌效率': 'gemEff',
    '寶石鑲嵌': 'gemEff',
    '寶石效率': 'gemEff',
    '寶石加成': 'gemEff',
    '鑲嵌效率': 'gemEff',
    // 吸血 / 吸魔
    lifesteal: 'lifesteal',
    '吸血': 'lifesteal',
    manasteal: 'manaSteal',
    '吸魔': 'manaSteal',
    '法力吸取': 'manaSteal',
    // 回血 / 回魔
    hpregen: 'hpRegen',
    '生命恢復': 'hpRegen',
    '回血': 'hpRegen',
    mpregen: 'mpRegen',
    '法力恢復': 'mpRegen',
    '回魔': 'mpRegen',
    // 詞條上限 / 強化成功率 / 分解高產率
    affixcap: 'affixCap',
    '詞條上限': 'affixCap',
    '詞條上限率': 'affixCap',
    enhancesuccess: 'enhanceSuccess',
    '強化成功率': 'enhanceSuccess',
    '強化成功': 'enhanceSuccess',
    decomposeyield: 'decomposeYield',
    '分解高產率': 'decomposeYield',
    '分解產率': 'decomposeYield',
    hybridmutation: 'hybridMutation',
    '合成變異率': 'hybridMutation',
    enragethreshold: 'enrageThreshold',
    '狂暴閾值': 'enrageThreshold',
    // 減傷 / 抗性
    globaldmgred: 'globalDmgRed',
    '全局減傷': 'globalDmgRed',
    '減傷': 'globalDmgRed',
    normaldmgred: 'normalDmgRed',
    '普通減傷': 'normalDmgRed',
    '普通敵人傷害抗性': 'normalDmgRed',
    elitedmgred: 'eliteDmgRed',
    '菁英減傷': 'eliteDmgRed',
    '菁英傷害抗性': 'eliteDmgRed',
    bossdmgred: 'bossDmgRed',
    'boss減傷': 'bossDmgRed',
    'boss傷害抗性': 'bossDmgRed',
    elitedmg: 'eliteDmg',
    '菁英傷害': 'eliteDmg',
    bossdmg: 'bossDmg',
    'boss傷害': 'bossDmg',
    normaldmg: 'normalDmg',
    '普通傷害': 'normalDmg',
    shieldeff: 'shieldEff',
    '護盾效率': 'shieldEff',
    tenacity: 'tenacity',
    '韌性': 'tenacity',
    ccred: 'ccRed',
    '控制縮減': 'ccRed',
    '控制時間縮減': 'ccRed',
    pres: 'pRes',
    '物抗': 'pRes',
    '物理抗性': 'pRes',
    mres: 'mRes',
    '魔抗': 'mRes',
    '魔法抗性': 'mRes',
    resall: 'resAll',
    '全抗': 'resAll',
    '全屬性抗性': 'resAll'
  };

  function gmResolveAffixKey(raw) {
    if (!raw) return null;
    var str = String(raw).trim();
    if (typeof AFFIX_POOL !== 'undefined') {
      if (AFFIX_POOL[str]) return str;
      var lower = str.toLowerCase();
      for (var k in AFFIX_POOL) {
        if (k.toLowerCase() === lower) return k;
        if (AFFIX_POOL[k].name === str || AFFIX_POOL[k].name.toLowerCase() === lower) return k;
        var cleanName = AFFIX_POOL[k].name.replace(/%/g, '');
        if (cleanName === str || cleanName.toLowerCase() === lower) return k;
      }
    }
    var alias = GM_AFFIX_ALIASES[str] || GM_AFFIX_ALIASES[str.toLowerCase()];
    if (alias) return alias;
    return null;
  }

  function isWearAllToken(raw) {
    if (!raw) return false;
    var s = String(raw).trim().toLowerCase();
    return s === 'wear' || s === 'all' || s === 'full' || s === '全身' || s === '身上' || s === '穿戴' || s === '裝備' || s === 'body';
  }

  function resolveMultiEquip(setIdx) {
    var targetSet = (G.equipmentSets && G.equipmentSets[setIdx]) || G.equipment || {};
    var slots = (typeof SLOT_LIST !== 'undefined' && Array.isArray(SLOT_LIST))
      ? SLOT_LIST
      : ['weapon', 'weapon2', 'helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'ring2', 'amulet'];
    var list = [];
    slots.forEach(function (sk) {
      if (targetSet[sk]) {
        list.push({ item: targetSet[sk], slotKey: sk, desc: '第 ' + (setIdx + 1) + ' 套【' + gmSlotLabel(sk) + '】' });
      }
    });
    if (!list.length) {
      return { error: '❌ 第 ' + (setIdx + 1) + ' 套穿戴欄位目前沒有任何裝備。' };
    }
    return {
      isMulti: true,
      items: list,
      setIdx: setIdx,
      desc: '第 ' + (setIdx + 1) + ' 套全身穿戴裝備（共 ' + list.length + ' 件）'
    };
  }

  function gmResolveEquipItem(args, selContext) {
    if (!args || !args.length) {
      if (selContext && selContext.source === 'inv' && selContext.id) {
        var invItem = (G.inventory || []).find(function (it) { return it && it.id === selContext.id; });
        if (invItem) return { item: invItem, desc: '背包選中裝備【' + invItem.name + '】', isEquip: false };
      }
      if (selContext && (selContext.source === 'equip' || selContext.source === 'equip-slot') && selContext.slot) {
        var eqItem = (G.equipment || {})[selContext.slot];
        return { item: eqItem, desc: '穿戴部位【' + gmSlotLabel(selContext.slot) + '】', isEquip: true, slotKey: selContext.slot };
      }
      var defSet = (typeof G.equipActive === 'number') ? G.equipActive : 0;
      var defItem = ((G.equipmentSets && G.equipmentSets[defSet]) || G.equipment || {})['weapon'];
      return { item: defItem, desc: '第 ' + (defSet + 1) + ' 套【' + gmSlotLabel('weapon') + '】（未指定部位）', isEquip: true, slotKey: 'weapon' };
    }

    var token = String(args[0]).toLowerCase();

    // 1) 顯式指定背包裝備 inv / bag / 背包
    if (token === 'inv' || token === 'bag' || token === '背包') {
      args.shift();
      if (!selContext || selContext.source !== 'inv' || !selContext.id) {
        return { error: '❌ 背包裝備請先在背包清單中點擊選中該裝備。' };
      }
      var invTarget = (G.inventory || []).find(function (it) { return it && it.id === selContext.id; });
      if (!invTarget) return { error: '❌ 找不到選中的背包裝備（可能已被分解或出售）。' };
      return { item: invTarget, desc: '背包選中裝備【' + invTarget.name + '】', isEquip: false };
    }

    // 2) 顯式指定當前選中裝備 sel / selected / 選中
    if (token === 'sel' || token === 'selected' || token === '選中' || token === 'this') {
      args.shift();
      if (!selContext) return { error: '❌ 目前尚未在畫面上選中任何裝備或穿戴部位。' };
      if (selContext.source === 'inv') {
        var selInv = (G.inventory || []).find(function (it) { return it && it.id === selContext.id; });
        if (!selInv) return { error: '❌ 找不到選中的背包裝備。' };
        return { item: selInv, desc: '背包選中裝備【' + selInv.name + '】', isEquip: false };
      }
      var selSlot = selContext.slot || 'weapon';
      var selEq = (G.equipment || {})[selSlot];
      return { item: selEq, desc: '選中部位【' + gmSlotLabel(selSlot) + '】', isEquip: true, slotKey: selSlot };
    }

    // 3) 指定第幾套：set1~set3 / 套1~套3 / 1~3 (若後面跟著部位或 wear/all)
    var setMatch = token.match(/^(?:set|套)?([1-3])$/i);
    if (setMatch) {
      var setIdx = Number(setMatch[1]) - 1;
      if (args.length >= 2) {
        if (isWearAllToken(args[1])) {
          args.shift(); // 消耗 set
          args.shift(); // 消耗 wear/all
          return resolveMultiEquip(setIdx);
        }
        var possibleSlot = gmResolveSlotKey(args[1]);
        if (possibleSlot) {
          args.shift(); // 消耗 set
          args.shift(); // 消耗 slot
          var targetSet = (G.equipmentSets && G.equipmentSets[setIdx]) || G.equipment;
          return { item: targetSet[possibleSlot], desc: '第 ' + (setIdx + 1) + ' 套【' + gmSlotLabel(possibleSlot) + '】', isEquip: (setIdx === (G.equipActive || 0)), slotKey: possibleSlot, setIdx: setIdx };
        }
      }
      if (/^(?:set|套)[1-3]$/i.test(token)) {
        args.shift();
        var defaultSlot = (selContext && selContext.slot) ? selContext.slot : 'weapon';
        var setObj = (G.equipmentSets && G.equipmentSets[setIdx]) || G.equipment;
        return { item: setObj[defaultSlot], desc: '第 ' + (setIdx + 1) + ' 套【' + gmSlotLabel(defaultSlot) + '】', isEquip: (setIdx === (G.equipActive || 0)), slotKey: defaultSlot, setIdx: setIdx };
      }
    }

    // 4) 顯式指定全身 wear / all / full / 全身 / 身上（作用於當前使用中套裝）
    if (isWearAllToken(token)) {
      args.shift();
      var curActiveSetIdx = (typeof G.equipView === 'number') ? G.equipView : (G.equipActive || 0);
      return resolveMultiEquip(curActiveSetIdx);
    }

    // 5) 直接指定部位名稱或部位序號 1~13（作用於當前檢視/使用中套裝）
    var directSlot = gmResolveSlotKey(token);
    if (directSlot) {
      args.shift();
      var activeSet = (typeof G.equipView === 'number') ? G.equipView : (G.equipActive || 0);
      var activeSetObj = (G.equipmentSets && G.equipmentSets[activeSet]) || G.equipment;
      return { item: activeSetObj[directSlot], desc: '第 ' + (activeSet + 1) + ' 套【' + gmSlotLabel(directSlot) + '】', isEquip: (activeSet === (G.equipActive || 0)), slotKey: directSlot, setIdx: activeSet };
    }

    // 5) 沒有指定部位或套裝：若畫面上選中了背包裝備或穿戴部位，優先作用於選中對象！
    if (selContext && selContext.source === 'inv' && selContext.id) {
      var autoInv = (G.inventory || []).find(function (it) { return it && it.id === selContext.id; });
      if (autoInv) return { item: autoInv, desc: '背包選中裝備【' + autoInv.name + '】', isEquip: false };
    }
    if (selContext && (selContext.source === 'equip' || selContext.source === 'equip-slot') && selContext.slot) {
      var autoEq = (G.equipment || {})[selContext.slot];
      return { item: autoEq, desc: '選中部位【' + gmSlotLabel(selContext.slot) + '】', isEquip: true, slotKey: selContext.slot };
    }

    // 6) 都沒有則預設使用中套裝的主手武器
    var curActive = (typeof G.equipActive === 'number') ? G.equipActive : 0;
    var curActiveSet = (G.equipmentSets && G.equipmentSets[curActive]) || G.equipment;
    return { item: curActiveSet['weapon'], desc: '第 ' + (curActive + 1) + ' 套【' + gmSlotLabel('weapon') + '】（預設主手）', isEquip: true, slotKey: 'weapon', setIdx: curActive };
  }

  function gmFinishEquipMod() {
    if (typeof markStatsDirty === 'function') markStatsDirty();
    gmDirty();
    if (typeof UI !== 'undefined' && UI.dirty) {
      UI.dirty.equip = true;
      UI.dirty.inv = true;
      UI.dirty.header = true;
    }
  }

  function gmItemInfoText(item, targetDesc) {
    var rName = (typeof RARITIES !== 'undefined' && RARITIES[item.rarity]) ? RARITIES[item.rarity].name : ('品質' + item.rarity);
    var text = targetDesc + '【' + (item.name || '裝備') + '】（' + rName + ' Lv.' + (item.level || 1) + (item.upgrade ? (' +' + item.upgrade) : '') + '）\n';
    text += '太古詞條數：' + ((typeof getItemAncientCount === 'function') ? getItemAncientCount(item) : (item.ancientCount || 0)) + '\n';
    text += '詞條列表（' + (item.affixes ? item.affixes.length : 0) + ' 條）：\n';
    if (!item.affixes || !item.affixes.length) {
      text += '  (無詞條)\n';
    } else {
      for (var i = 0; i < item.affixes.length; i++) {
        var a = item.affixes[i];
        var val = (typeof affixValue === 'function') ? affixValue(item, a) : (Number(a.roll) || 0);
        var def = (typeof AFFIX_POOL !== 'undefined') ? AFFIX_POOL[a.key] : null;
        var n = def ? def.name : a.key;
        var tag = a.ancient ? '✡ 太古' : '◆ 一般';
        text += '  ' + (i + 1) + '. [' + tag + '] ' + n + ' +' + val + (def && def.pct ? '%' : '') + '\n';
      }
    }
    return text.trim();
  }

  function gmModSingleEquip(item, targetDesc, args) {
    if (!item) return { ok: false, message: targetDesc + ' 目前沒有裝備，無法修改屬性。' };

    var op = String(args[0]).toLowerCase();

    // ---- 太古操作 ----
    if (op === 'ancient' || op === '太古') {
      args.shift();
      var sub = String(args[0] || 'all').toLowerCase();
      if (sub === 'all' || sub === '全部' || sub === '*') {
        if (!item.affixes || !item.affixes.length) return { ok: false, message: targetDesc + ' 沒有任何詞條可設為太古。' };
        item.affixes.forEach(function (a) {
          a.ancient = true;
          a.roll = (typeof STRENGTH_ROLL_MAX !== 'undefined') ? STRENGTH_ROLL_MAX : 1000;
        });
        item.ancientCount = item.affixes.length;
        gmFinishEquipMod();
        return { ok: true, message: targetDesc + '：已將全部 ' + item.ancientCount + ' 條詞條設為【太古】✡（滿值屬性）' };
      }
      if (sub === 'none' || sub === 'clear' || sub === '非太古') {
        if (!item.affixes) item.affixes = [];
        item.affixes.forEach(function (a) { a.ancient = false; });
        item.ancientCount = 0;
        gmFinishEquipMod();
        return { ok: true, message: targetDesc + '：已將全部詞條設為【非太古】◆' };
      }
      var countNum = gmNumber(sub, 0, (item.affixes ? item.affixes.length : 10));
      if (countNum !== null && args.length === 1) {
        var n = Math.floor(countNum);
        for (var ai = 0; ai < (item.affixes || []).length; ai++) {
          item.affixes[ai].ancient = (ai < n);
          if (ai < n) item.affixes[ai].roll = (typeof STRENGTH_ROLL_MAX !== 'undefined') ? STRENGTH_ROLL_MAX : 1000;
        }
        item.ancientCount = n;
        gmFinishEquipMod();
        return { ok: true, message: targetDesc + '：已設定前 ' + n + ' 條詞條為【太古】✡，其餘為【非太古】◆' };
      }
      args.shift();
      var flag = args[0] ? String(args[0]).toLowerCase() : 'on';
      var wantAncient = (flag === 'on' || flag === '1' || flag === 'true' || flag === '太古');
      var targetAffix = null;
      var idxNum = Number(sub);
      if (Number.isInteger(idxNum) && idxNum >= 1 && idxNum <= (item.affixes || []).length) {
        targetAffix = item.affixes[idxNum - 1];
      } else {
        var wantedKey = gmResolveAffixKey(sub);
        if (wantedKey && item.affixes) {
          targetAffix = item.affixes.find(function (a) { return a.key === wantedKey; });
        }
      }
      if (!targetAffix) return { ok: false, message: '找不到指定詞條：' + sub + '（可指定 1~' + (item.affixes ? item.affixes.length : 0) + ' 或屬性名稱）' };
      targetAffix.ancient = wantAncient;
      if (wantAncient) targetAffix.roll = (typeof STRENGTH_ROLL_MAX !== 'undefined') ? STRENGTH_ROLL_MAX : 1000;
      item.ancientCount = (item.affixes || []).filter(function (a) { return a && a.ancient; }).length;
      gmFinishEquipMod();
      var aName = (typeof AFFIX_POOL !== 'undefined' && AFFIX_POOL[targetAffix.key] && AFFIX_POOL[targetAffix.key].name) || targetAffix.key;
      return { ok: true, message: targetDesc + '：已將【' + aName + '】設為' + (wantAncient ? '【太古】✡' : '【非太古】◆') };
    }

    // ---- 強化等級 upgrade / +N ----
    if (op === 'upgrade' || op === '強化' || op.charAt(0) === '+') {
      var upVal = (op.charAt(0) === '+') ? Number(op.slice(1)) : Number(args[1]);
      if (isNaN(upVal) || upVal < 0 || upVal > 1000) return { ok: false, message: '強化等級範圍需為 0~1000' };
      item.upgrade = Math.floor(upVal);
      gmFinishEquipMod();
      return { ok: true, message: targetDesc + '：強化等級已設定為 +' + item.upgrade };
    }

    // ---- 裝備等級 level / lv ----
    if (op === 'level' || op === 'lv' || op === '等級') {
      var lvVal = Number(args[1]);
      if (isNaN(lvVal) || lvVal < 1 || lvVal > 100000) return { ok: false, message: '裝備等級範圍需為 1~100000' };
      item.level = Math.floor(lvVal);
      gmFinishEquipMod();
      return { ok: true, message: targetDesc + '：裝備等級已設定為 Lv.' + item.level };
    }

    // ---- 品質 rarity ----
    if (op === 'rarity' || op === '品質') {
      var rVal = gmRarity(args[1]);
      if (rVal === null) return { ok: false, message: '無效的品質：' + args[1] };
      item.rarity = rVal;
      if (typeof ensureSockets === 'function') ensureSockets(item);
      gmFinishEquipMod();
      return { ok: true, message: targetDesc + '：品質已設定為 ' + (RARITIES[rVal] ? RARITIES[rVal].name : rVal) };
    }

    // ---- 清空詞條 clear ----
    if (op === 'clear' || op === '清空') {
      item.affixes = [];
      item.ancientCount = 0;
      gmFinishEquipMod();
      return { ok: true, message: targetDesc + '：所有詞條已清空' };
    }

    // ---- 刪除指定詞條 del / delete / 刪除 ----
    if (op === 'del' || op === 'delete' || op === '刪除') {
      var delTarget = String(args[1] || '');
      var delIdx = Number(delTarget);
      if (Number.isInteger(delIdx) && delIdx >= 1 && delIdx <= (item.affixes || []).length) {
        var removed = item.affixes.splice(delIdx - 1, 1)[0];
        item.ancientCount = (item.affixes || []).filter(function (a) { return a && a.ancient; }).length;
        gmFinishEquipMod();
        return { ok: true, message: targetDesc + '：已刪除第 ' + delIdx + ' 條詞條【' + (AFFIX_POOL[removed.key] ? AFFIX_POOL[removed.key].name : removed.key) + '】' };
      }
      var delKey = gmResolveAffixKey(delTarget);
      if (delKey && item.affixes) {
        var foundIdx = item.affixes.findIndex(function (a) { return a.key === delKey; });
        if (foundIdx >= 0) {
          item.affixes.splice(foundIdx, 1);
          item.ancientCount = (item.affixes || []).filter(function (a) { return a && a.ancient; }).length;
          gmFinishEquipMod();
          return { ok: true, message: targetDesc + '：已刪除詞條【' + (AFFIX_POOL[delKey] ? AFFIX_POOL[delKey].name : delKey) + '】' };
        }
      }
      return { ok: false, message: '找不到要刪除的詞條：' + delTarget };
    }

    // ---- 詞條數值修改 / 新增 ----
    if (op === 'stat' || op === 'affix' || op === '詞條' || op === '屬性') args.shift();
    if (!args.length) return { ok: false, message: '請指定要修改的屬性與數值，例如：modequip atkFlat 50000 [ancient]' };

    var affixIndex = null;
    var rawFirst = String(args[0]).trim();
    var numIdx = Number(rawFirst);
    if (Number.isInteger(numIdx) && numIdx >= 1 && numIdx <= ((item.affixes || []).length + 1)) {
      affixIndex = numIdx - 1;
      args.shift();
    }

    var targetAffixKey = null;
    var targetValue = null;
    var wantAncientOpt = null;

    if (args.length > 0) {
      var possibleKey = gmResolveAffixKey(args[0]);
      if (possibleKey) {
        targetAffixKey = possibleKey;
        args.shift();
      } else if (affixIndex !== null && item.affixes && item.affixes[affixIndex]) {
        targetAffixKey = item.affixes[affixIndex].key;
      }
    } else if (affixIndex !== null && item.affixes && item.affixes[affixIndex]) {
      targetAffixKey = item.affixes[affixIndex].key;
    }

    if (!targetAffixKey) {
      return { ok: false, message: '未知屬性名稱或詞條序號：' + rawFirst + '（可輸入 atkFlat, matkFlat, hpFlat, critRate, aspd, cdr...）' };
    }

    if (args.length > 0) {
      var vNum = gmNumber(args[0], -1e300, 1e300);
      if (vNum !== null) {
        targetValue = vNum;
        args.shift();
      }
    }

    if (args.length > 0) {
      var ancToken = String(args[0]).toLowerCase();
      if (ancToken === 'ancient' || ancToken === '太古' || ancToken === '1' || ancToken === 'on' || ancToken === 'true') {
        wantAncientOpt = true;
      } else if (ancToken === 'normal' || ancToken === '非太古' || ancToken === '0' || ancToken === 'off' || ancToken === 'false') {
        wantAncientOpt = false;
      }
    }

    if (!item.affixes) item.affixes = [];
    var existingAffix = null;
    if (affixIndex !== null && item.affixes[affixIndex]) {
      existingAffix = item.affixes[affixIndex];
      existingAffix.key = targetAffixKey;
    } else {
      existingAffix = item.affixes.find(function (a) { return a.key === targetAffixKey; });
    }

    var rawBaseV = (typeof affixBaseValue === 'function') ? affixBaseValue(targetAffixKey, item.level, item.rarity) : 1;
    var twoHandMult = (typeof isTwoHandItem === 'function' && isTwoHandItem(item) && typeof TWO_HAND_AFFIX_VALUE_MULT === 'number')
      ? TWO_HAND_AFFIX_VALUE_MULT : 1;
    var baseV = rawBaseV * twoHandMult;
    var actionDesc = '';

    if (existingAffix) {
      if (wantAncientOpt !== null) existingAffix.ancient = wantAncientOpt;
      if (targetValue !== null) {
        if (existingAffix.ancient && wantAncientOpt === null) existingAffix.ancient = false;
        existingAffix.roll = (baseV > 0 && typeof strengthFromValue === 'function')
          ? strengthFromValue(targetValue, baseV)
          : Math.round(targetValue);
      } else if (existingAffix.ancient) {
        existingAffix.roll = (typeof STRENGTH_ROLL_MAX !== 'undefined') ? STRENGTH_ROLL_MAX : 1000;
      }
      actionDesc = '已修改詞條';
    } else {
      var isAnc = (wantAncientOpt === true);
      var rollVal = isAnc
        ? ((typeof STRENGTH_ROLL_MAX !== 'undefined') ? STRENGTH_ROLL_MAX : 1000)
        : ((targetValue !== null && baseV > 0 && typeof strengthFromValue === 'function') ? strengthFromValue(targetValue, baseV) : 500);
      existingAffix = {
        key: targetAffixKey,
        roll: rollVal,
        ancient: isAnc
      };
      item.affixes.push(existingAffix);
      actionDesc = '已追加詞條';
    }

    item.ancientCount = (item.affixes || []).filter(function (a) { return a && a.ancient; }).length;
    gmFinishEquipMod();

    var finalV = (typeof affixValue === 'function') ? affixValue(item, existingAffix) : (targetValue || 0);
    var defInfo = (typeof AFFIX_POOL !== 'undefined') ? AFFIX_POOL[targetAffixKey] : null;
    var aNameLabel = (defInfo && defInfo.name) || targetAffixKey;
    var ancTag = existingAffix.ancient ? '【太古】✡' : '【一般】◆';
    return {
      ok: true,
      message: targetDesc + '：' + actionDesc + ' ' + ancTag + ' ' + aNameLabel + ' = ' + finalV + ((defInfo && defInfo.pct) ? '%' : '')
    };
  }

  function gmModEquip(args, selContext) {
    if (!G) return { ok: false, message: '遊戲狀態尚未載入。' };
    var resolved = gmResolveEquipItem(args, selContext);
    if (resolved.error) return { ok: false, message: resolved.error };

    if (resolved.isMulti) {
      if (!args.length || args[0] === 'info' || args[0] === 'show' || args[0] === '資訊') {
        var summaryList = resolved.items.map(function (itEntry) {
          var it = itEntry.item;
          var rName = (typeof RARITIES !== 'undefined' && RARITIES[it.rarity]) ? RARITIES[it.rarity].name : ('品質' + it.rarity);
          var ancCnt = (typeof getItemAncientCount === 'function') ? getItemAncientCount(it) : (it.ancientCount || 0);
          return itEntry.desc + '【' + (it.name || '裝備') + '】' + rName + ' +' + (it.upgrade || 0) + ' (' + ancCnt + '太古)';
        });
        return { ok: true, message: resolved.desc + '：\n' + summaryList.join('\n') };
      }

      var successCount = 0;
      var lastMsg = '';
      for (var mi = 0; mi < resolved.items.length; mi++) {
        var itEntry = resolved.items[mi];
        var singleRes = gmModSingleEquip(itEntry.item, itEntry.desc, args.slice());
        if (!singleRes.ok) {
          return singleRes;
        }
        successCount++;
        lastMsg = singleRes.message;
      }
      gmFinishEquipMod();
      var colonIdx = lastMsg.indexOf('：');
      var opDesc = colonIdx >= 0 ? lastMsg.slice(colonIdx + 1) : lastMsg;
      return {
        ok: true,
        message: resolved.desc + '：批次成功（共 ' + successCount + ' 件） -> ' + opDesc
      };
    }

    var item = resolved.item;
    var targetDesc = resolved.desc;
    if (!item) return { ok: false, message: targetDesc + ' 目前沒有裝備，無法修改屬性。' };

    if (!args.length || args[0] === 'info' || args[0] === 'show' || args[0] === '資訊') {
      return { ok: true, message: gmItemInfoText(item, targetDesc) };
    }

    return gmModSingleEquip(item, targetDesc, args);
  }

  function gmGivePart(tier, node, count) {
    var keys = Object.keys(PART_TYPES).filter(function (key) { return !node || PART_TYPES[key].node === node; });
    if (!keys.length) return '此節點目前關閉或不存在：' + (node || '未知');
    ensurePartLevels(G.factory);
    keys.forEach(function (key) { G.factory.partLevels[key] = Math.max(G.factory.partLevels[key], tier); });
    gmDirty();
    return '設定自動機組零件至 T' + tier + (node ? '（' + node + '）' : '');
  }

  function gmTowerDirty() {
    if (typeof UI === 'undefined' || !UI.dirty) return;
    UI.dirty.tower = true;
    UI.dirty.header = true;
  }

  function gmClearTowerTo(maxFloor, towerName) {
    if (!G.tower) return { ok: false, message: '目前找不到封魔塔進度資料。' };
    if (G.tower.active) return { ok: false, message: '封魔塔戰鬥進行中，請先結束目前戰鬥。' };
    var before = Number(G.tower.highest) || 0;
    G.tower.highest = Math.max(before, maxFloor);
    gmTowerDirty();
    return {
      ok: true,
      message: towerName + '已通關至第 ' + G.tower.highest + ' 層（GM 不補發通關獎勵）'
    };
  }

  function gmResetTowerFrom(startFloor, towerName) {
    if (!G.tower) return { ok: false, message: '目前找不到封魔塔進度資料。' };
    if (G.tower.active) return { ok: false, message: '封魔塔戰鬥進行中，請先結束目前戰鬥。' };
    var before = Number(G.tower.highest) || 0;
    G.tower.highest = Math.min(before, startFloor - 1);
    gmTowerDirty();
    return {
      ok: true,
      message: '已清除' + towerName + '的已挑戰標記，目前最高通關第 ' + G.tower.highest + ' 層'
    };
  }

  function gmJumpTowerTo(rawFloor) {
    var floor = gmNumber(rawFloor, 1, TOWER_MAX_FLOOR);
    if (floor === null) {
      return { ok: false, message: '格式：tower_jump 樓層（1~' + TOWER_MAX_FLOOR + '）' };
    }
    if (!G.tower) return { ok: false, message: '目前找不到封魔塔進度資料。' };
    if (G.tower.active) return { ok: false, message: '封魔塔戰鬥進行中，請先結束目前戰鬥。' };
    G.tower.highest = floor - 1;
    gmTowerDirty();
    return { ok: true, message: '已跳至封魔塔第 ' + floor + ' 層，之前的樓層視為已挑戰成功' };
  }

  function gmSetReincarnation(rawCount) {
    var count = gmNumber(rawCount, 0, REINCARNATION_MAX);
    if (count === null) return { ok: false, message: '格式：reincarnation 轉生次數（0~' + REINCARNATION_MAX + '）' };
    if (G.tower && G.tower.active) return { ok: false, message: '封魔塔戰鬥進行中，請先結束目前戰鬥。' };
    var before = Number(G.player.reincarnations) || 0;
    G.player.reincarnations = count;
    if (before !== count && typeof resetTalentsForReincarnationGM === 'function') {
      resetTalentsForReincarnationGM(count);
    }
    if (typeof markStatsDirty === 'function') markStatsDirty();
    gmDirty();
    return { ok: true, message: '玩家轉生次數已由 ' + before + ' 轉切換為 ' + count + ' 轉' };
  }

  function gmJumpStage(raw1, raw2) {
    if (typeof ZONES === 'undefined' || !ZONES) return { ok: false, message: '目前找不到關卡進度資料。' };
    var zoneKeys = (typeof ZONE_LIST !== 'undefined' && ZONE_LIST) ? ZONE_LIST : Object.keys(ZONES);
    var sceneStr = null;
    var stageStr = null;

    if (raw1 && String(raw1).indexOf('/') >= 0) {
      var parts = String(raw1).split('/');
      sceneStr = parts[0];
      stageStr = parts[1];
    } else if (raw1 !== undefined && raw2 !== undefined) {
      sceneStr = raw1;
      stageStr = raw2;
    } else if (raw1 !== undefined) {
      var parsedZ = gmParseScene(raw1);
      if (parsedZ) {
        sceneStr = raw1;
        stageStr = '1';
      } else {
        sceneStr = (G && G.stage && G.stage.zone) || 'desert';
        stageStr = raw1;
      }
    } else {
      return { ok: false, message: '格式：stage_jump [場景] <關卡>（例：stage_jump 1 50 或 stage_jump desert 100）' };
    }

    var targetZone = gmParseScene(sceneStr);
    if (!targetZone) {
      return { ok: false, message: '無效的場景名稱或編號：' + sceneStr + '（支援 1~' + zoneKeys.length + ' 或 desert/Icefield/swamp...）' };
    }

    var maxS = zoneMaxStage(targetZone);
    var targetStage = gmNumber(stageStr, 1, maxS);
    if (targetStage === null) {
      return { ok: false, message: '無效的關卡數字：' + stageStr + '（【' + ZONES[targetZone].name + '】關卡範圍 1~' + maxS + '）' };
    }

    var targetIdx = zoneKeys.indexOf(targetZone);
    if (targetIdx < 0) targetIdx = 0;

    if (!G) G = {};
    if (!G.zoneProgress) G.zoneProgress = {};

    for (var i = 0; i < zoneKeys.length; i++) {
      var zk = zoneKeys[i];
      var zDef = ZONES[zk];
      var zMax = zDef ? Math.max(1, Math.floor(Number(zDef.maxStage) || 1)) : 1;
      if (i < targetIdx) {
        G.zoneProgress[zk] = { current: zMax, best: zMax, cleared: zMax };
      } else if (i === targetIdx) {
        var clearedVal = Math.max(0, targetStage - 1);
        G.zoneProgress[zk] = { current: targetStage, best: targetStage, cleared: clearedVal };
      } else {
        G.zoneProgress[zk] = { current: 1, best: 1, cleared: 0 };
      }
    }

    if (!G.stage) G.stage = { zone: 'desert', current: 1, best: 1, kills: 0 };
    G.stage.zone = targetZone;
    G.stage.current = targetStage;
    G.stage.best = targetStage;
    G.stage.kills = 0;

    var reqReinc = (ZONES[targetZone] && ZONES[targetZone].reqReincarnation) || 0;
    if (reqReinc > 0 && (!G.player || (G.player.reincarnations || 0) < reqReinc)) {
      if (!G.player) G.player = {};
      G.player.reincarnations = reqReinc;
    }

    if (typeof FIELD !== 'undefined' && FIELD) {
      FIELD.monster = null;
      FIELD.monsters = [];
      FIELD._waveClearPending = false;
      FIELD.mapComplete = false;
      FIELD.spawnCd = 0.5;
    }

    gmDirty();
    if (typeof UI !== 'undefined' && UI.dirty) {
      UI.dirty.battle = true;
      UI.dirty.header = true;
    }

    var zn = ZONES[targetZone];
    return {
      ok: true,
      message: '已將最高關卡指定為【' + (zn.emoji || '') + zn.name + '】第 ' + targetStage + ' 階（後續場景與關卡已鎖定）'
    };
  }


  function gmParseScene(raw) {
    var s = String(raw || '').trim().toLowerCase();
    if (typeof ZONES === 'undefined' || !ZONES) return null;
    /* 數字場景編號必須跟 UI／自動推進共用 ZONE_LIST；Object.keys(ZONES)
       只是物件插入順序，地圖改名或工具重生資料時不保證與設計順序一致。 */
    var zoneKeys = (typeof ZONE_LIST !== 'undefined' && Array.isArray(ZONE_LIST))
      ? ZONE_LIST : Object.keys(ZONES);
    if (/^\d+$/.test(s)) {
      var idx = parseInt(s, 10) - 1;
      if (idx >= 0 && idx < zoneKeys.length) return zoneKeys[idx];
    }
    if (ZONES[s]) return s;
    /* 地圖識別碼不保證全小寫（例如 Icefield），但 GM 指令允許使用者隨手打小寫，
       所以英文 key 一律不分大小寫比對；上面的 ZONES[s] 先走完全相符的快路徑。 */
    for (var k in ZONES) {
      if (k.toLowerCase() === s) return k;
      if (ZONES[k].name === raw || (ZONES[k].name && ZONES[k].name.toLowerCase() === s)) return k;
    }
    return null;
  }

  function itemMatchesSlot(item, targetSlot) {
    if (!targetSlot || !item) return true;
    var normTarget = typeof slotTypeOf === 'function' ? slotTypeOf(targetSlot) : targetSlot;
    var normItemSlot = typeof slotTypeOf === 'function' ? slotTypeOf(item.slot || '') : (item.slot || '');

    // 1. 若指定的是具體武器/副手類型（如 shield, staff2h, sword1h）
    if (typeof WEAPON_TYPES !== 'undefined' && WEAPON_TYPES[targetSlot]) {
      return item.weaponType === targetSlot || item.slot === targetSlot;
    }
    // 2. 若指定的是主要部位（如 weapon, helmet, ring, chest...）
    return normItemSlot === normTarget || item.slot === targetSlot;
  }

  function gmParseSlot(raw) {
    if (!raw) return null;
    var str = String(raw).trim().toLowerCase();
    if (typeof SLOT_INFO !== 'undefined' && SLOT_INFO[str]) return str;
    if (typeof WEAPON_TYPES !== 'undefined' && WEAPON_TYPES[str]) return str;
    if (typeof slotTypeOf === 'function') {
      var st = slotTypeOf(str);
      if (typeof SLOT_INFO !== 'undefined' && SLOT_INFO[st]) return st;
    }
    var slotNameMap = {
      '武器': 'weapon', '主武器': 'weapon',
      '副手': 'weapon2', '頭盔': 'helmet', '肩甲': 'shoulder', '肩': 'shoulder',
      '胸甲': 'chest', '衣服': 'chest', '上衣': 'chest',
      '腰帶': 'belt', '手套': 'gloves', '護腕': 'wrist',
      '護腿': 'legs', '褲子': 'legs', '鞋子': 'boots', '鞋': 'boots',
      '戒指': 'ring', '項鍊': 'amulet',
      '單手劍': 'sword1h', '單手匕首': 'dagger1h', '匕首': 'dagger1h',
      '單手魔杖': 'wand1h', '魔杖': 'wand1h', '單手魔劍': 'magicSword1h',
      '雙手大劍': 'greatsword2h', '雙手斧': 'axe2h', '雙手法杖': 'staff2h',
      '雙手魔劍': 'magicSword2h', '盾牌': 'shield', '法器': 'focus',
      '魔法書': 'spellbook', '水晶球': 'orb'
    };
    if (slotNameMap[raw] || slotNameMap[str]) return slotNameMap[raw] || slotNameMap[str];
    return null;
  }

  function gmExecuteMultiKill(zoneKey, stage, count, filterRarity, filterSlot) {
    if (typeof ZONES === 'undefined' || !ZONES[zoneKey]) return { ok: false, message: '無效的場景名稱或編號。' };
    var zn = ZONES[zoneKey];
    /* 敵種判定與出怪同規格（→ js/combat.js spawnFieldMonster）：BOSS 階段優先於菁英，名稱不加階級前綴；
       打過的 BOSS 關同樣退回菁英，GM 連殺才不會在已通關的關卡發出實際打不到的 BOSS 掉落。 */
    var boss = typeof isFieldBossStage === 'function' && isFieldBossStage(stage) &&
      !(typeof isFieldBossDefeated === 'function' && isFieldBossDefeated(zoneKey, stage));
    var elite = !boss && (typeof isEliteStage === 'function' ? isEliteStage(stage) : false);
    var base = typeof monsterStatsFor === 'function' ? monsterStatsFor(stage, elite, boss) : { level: stage, hp: 100, gold: 10, xp: 10 };
    var mtype = (zn.pool && zn.pool.length) ? zn.pool[0] : { name: '怪物' };
    var m = {
      name: mtype.name,
      level: base.level,
      elite: elite,
      isBoss: boss,
      gold: (base.gold || 10) * (zn.rewardMult || 1),
      xp: (base.xp || 10) * (zn.rewardMult || 1)
    };

    var st = typeof getStats === 'function' ? getStats() : { goldBonus: 0, xpBonus: 0 };
    var perGold = Math.round(m.gold * (1 + (st.goldBonus || 0) / 100));
    var perXp = Math.round(m.xp * (1 + (st.xpBonus || 0) / 100));
    var totalGold = perGold * count;
    var totalXp = perXp * count;

    G.player.gold += totalGold;
    if (typeof gainXp === 'function') gainXp(totalXp);
    else G.player.xp = (G.player.xp || 0) + totalXp;

    if (typeof window !== 'undefined') {
      if (window.recordLootGold) window.recordLootGold(totalGold, 'field');
      if (window.recordLootKill) window.recordLootKill(count, 'field');
    }

    var totalDrops = 0;
    var equipKeptInv = 0;
    var equipQueuedForge = 0;
    var equipSalvaged = 0;
    var equipFilteredDiscarded = 0;
    var scrapGainFromOverflow = 0;

    var invCapNow = typeof inventoryCapacityWithTalents === 'function' ? inventoryCapacityWithTalents() : ((typeof INVENTORY_CAP !== 'undefined' ? INVENTORY_CAP : 50) + (G.player.invUpgrades || 0));
    var originalPushConveyor = typeof window !== 'undefined' ? window.pushConveyor : (typeof pushConveyor === 'function' ? pushConveyor : null);

    var hasQualityFilter = filterRarity !== undefined && filterRarity !== null;
    var hasSlotFilter = filterSlot !== undefined && filterSlot !== null;

    var customPushConveyor = function (item) {
      if (!item) return false;

      var matchQuality = !hasQualityFilter || item.rarity === filterRarity;
      var matchSlot = !hasSlotFilter || itemMatchesSlot(item, filterSlot);

      // 若品質或部位不符合指定篩選條件：自動過濾拆解
      if (!matchQuality || !matchSlot) {
        equipFilteredDiscarded++;
        if (typeof doSalvage === 'function') {
          var sres = doSalvage(item, true);
          if (sres && sres.scrap) scrapGainFromOverflow += sres.scrap;
        }
        return true;
      }

      // 符合品質與部位標的（或未設定篩選）：
      // 1. 優先填滿玩家背包剩餘空間
      if (G.inventory && G.inventory.length < invCapNow) {
        item.locked = false;
        G.inventory.push(item);
        equipKeptInv++;
        return true;
      }
      // 2. 次要填滿熔爐佇列剩餘空間
      if (typeof newForgeTryIntake === 'function' && G.newForge && typeof newForgeTotalQueued === 'function' && typeof NEW_FORGE_QUEUE_CAP !== 'undefined') {
        if (newForgeTotalQueued() < NEW_FORGE_QUEUE_CAP) {
          if (newForgeTryIntake(item)) {
            equipQueuedForge++;
            return true;
          }
        }
      }
      // 3. 剩餘裝備溢出：自動拆解並將碎片發放給玩家
      if (typeof doSalvage === 'function') {
        var res = doSalvage(item, true);
        equipSalvaged++;
        if (res && res.scrap) scrapGainFromOverflow += res.scrap;
        return true;
      }
      equipSalvaged++;
      return true;
    };

    if (typeof window !== 'undefined') window.pushConveyor = customPushConveyor;

    try {
      if (typeof rollFieldDrops === 'function') {
        for (var i = 0; i < count; i++) {
          var dr = rollFieldDrops(m);
          totalDrops += (dr ? dr.length : 0);
        }
      }
    } finally {
      if (typeof window !== 'undefined' && originalPushConveyor) window.pushConveyor = originalPushConveyor;
    }

    if (typeof specialGrantsOnKill === 'function') specialGrantsOnKill(m);

    gmDirty();
    var fmtGold = typeof fmt === 'function' ? fmt(totalGold) : totalGold.toLocaleString('en-US');
    var fmtXp = typeof fmt === 'function' ? fmt(totalXp) : totalXp.toLocaleString('en-US');
    var fmtCount = typeof fmt === 'function' ? fmt(count) : count.toLocaleString('en-US');

    var filterName = hasQualityFilter && typeof RARITIES !== 'undefined' && RARITIES[filterRarity] ? RARITIES[filterRarity].name : '';
    var slotName = hasSlotFilter ? (typeof SLOT_INFO !== 'undefined' && SLOT_INFO[filterSlot] ? SLOT_INFO[filterSlot].name : (typeof WEAPON_TYPES !== 'undefined' && WEAPON_TYPES[filterSlot] ? WEAPON_TYPES[filterSlot].name : filterSlot)) : '';

    var filterTag = '';
    if (hasQualityFilter && hasSlotFilter) filterTag = '【' + filterName + '・' + slotName + '】';
    else if (hasQualityFilter) filterTag = '【' + filterName + '】';
    else if (hasSlotFilter) filterTag = '【' + slotName + '】';

    var msg = '連殺【' + (zn.emoji || '') + zn.name + '】第 ' + stage + ' 階怪物 x' + fmtCount +
      '！一次性獲得 💰' + fmtGold + ' 金幣、💡' + fmtXp + ' 經驗值。';

    var lootParts = [];
    if (hasQualityFilter || hasSlotFilter) {
      if (equipKeptInv > 0) lootParts.push('💎篩選保留' + filterTag + '裝備 x' + (typeof fmt === 'function' ? fmt(equipKeptInv) : equipKeptInv) + ' 入包');
      if (equipQueuedForge > 0) lootParts.push('🏭篩選保留' + filterTag + '裝備 x' + (typeof fmt === 'function' ? fmt(equipQueuedForge) : equipQueuedForge) + ' 入熔爐');
      if (equipFilteredDiscarded > 0) lootParts.push('🧹過濾非' + filterTag + '裝備 x' + (typeof fmt === 'function' ? fmt(equipFilteredDiscarded) : equipFilteredDiscarded));
      if (equipSalvaged > 0) lootParts.push('⚒️容量滿載溢出拆解 x' + (typeof fmt === 'function' ? fmt(equipSalvaged) : equipSalvaged));
      if (scrapGainFromOverflow > 0) lootParts.push('（拆解共獲碎片 x' + (typeof fmt === 'function' ? fmt(scrapGainFromOverflow) : scrapGainFromOverflow) + '）');
    } else {
      if (equipKeptInv > 0) lootParts.push('🎒填滿背包裝備 x' + (typeof fmt === 'function' ? fmt(equipKeptInv) : equipKeptInv));
      if (equipQueuedForge > 0) lootParts.push('🏭填滿熔爐佇列 x' + (typeof fmt === 'function' ? fmt(equipQueuedForge) : equipQueuedForge));
      if (equipSalvaged > 0) lootParts.push('⚒️溢出拆解裝備 x' + (typeof fmt === 'function' ? fmt(equipSalvaged) : equipSalvaged) + (scrapGainFromOverflow > 0 ? '（獲碎片 x' + (typeof fmt === 'function' ? fmt(scrapGainFromOverflow) : scrapGainFromOverflow) + '）' : ''));
    }

    if (lootParts.length > 0) {
      msg += ' 戰利品處理：' + lootParts.join('、') + '。';
    }

    if (typeof blog === 'function') blog('⚡ [GM] ' + msg, 'good', 'loot');
    return { ok: true, message: msg };
  }

  function gmSetInventoryCap(rawArg, relativeAddOnly) {
    var str = String(rawArg || '').trim();
    if (!str) return { ok: false, message: '格式：bag 容量（例：bag 2000 或 bag +500）' };
    
    var currentCap = typeof inventoryCapacityWithTalents === 'function' ? inventoryCapacityWithTalents() : ((typeof INVENTORY_CAP !== 'undefined' ? INVENTORY_CAP : 100) + (G.player.invUpgrades || 0));
    var baseCap = typeof INVENTORY_CAP !== 'undefined' ? INVENTORY_CAP : 100;
    
    var targetCap = 0;
    if (relativeAddOnly) {
      var delta = gmSignedAmount(str, 1e6);
      if (delta === null) return { ok: false, message: '格式：inv_expand 增加數量（正負整數）' };
      targetCap = currentCap + delta;
    } else if (str.charAt(0) === '+' || str.charAt(0) === '-') {
      var delta = gmSignedAmount(str, 1e6);
      if (delta === null) return { ok: false, message: '格式：bag +增加量 或 -減少量' };
      targetCap = currentCap + delta;
    } else {
      var val = gmNumber(str, 1, 1000000);
      if (val === null) return { ok: false, message: '格式：bag 目標容量（如 2000）' };
      targetCap = val;
    }

    targetCap = Math.max(10, Math.round(targetCap));
    G.player.invUpgrades = Math.max(0, targetCap - baseCap);
    gmDirty();

    var finalCap = typeof inventoryCapacityWithTalents === 'function' ? inventoryCapacityWithTalents() : (baseCap + G.player.invUpgrades);
    var fmtCap = typeof fmt === 'function' ? fmt(finalCap) : finalCap.toLocaleString('en-US');
    return { ok: true, message: '背包容量已設定為 ' + fmtCap + ' 格（基礎 ' + baseCap + ' + 擴充 ' + G.player.invUpgrades + '）' };
  }

  function gmMaxSkill2(gidRaw) {
    if (!isGMHost()) return { ok: false, message: 'GM 指令僅能在本機開發環境使用。' };
    var gid = String(gidRaw || '').trim().toLowerCase();
    if (!gid) return { ok: false, message: '請指定技能群組代碼（或 all）。' };
    var maxLv = (typeof SG_TIER_MAX_LV === 'number') ? SG_TIER_MAX_LV : 10;
    if (!G.player.skills2) G.player.skills2 = { levels: {} };
    if (!G.player.skills2.levels) G.player.skills2.levels = {};

    if (gid === 'all') {
      if (typeof SKILLS2 !== 'undefined') {
        for (var k in SKILLS2) {
          var arr = [];
          for (var t = 0; t < SKILLS2[k].tiers.length; t++) arr.push(maxLv);
          G.player.skills2.levels[k] = arr;
        }
      }
      gmDirty();
      return { ok: true, message: '所有新版技能群組已升至滿級（Lv.' + maxLv + '）' };
    }

    var g = (typeof SKILLS2 !== 'undefined') ? SKILLS2[gid] : null;
    if (!g) return { ok: false, message: '找不到技能群組：' + gid };
    var arr = [];
    for (var i = 0; i < g.tiers.length; i++) arr.push(maxLv);
    G.player.skills2.levels[gid] = arr;
    gmDirty();
    return { ok: true, message: '【' + g.name + '】全階層已升至滿級（Lv.' + maxLv + '）' };
  }

  function executeGMCommand(raw, selOverride) {
    if (!isGMHost()) return { ok: false, message: 'GM 指令僅能在本機開發環境使用。' };
    var text = String(raw || '').trim();
    if (!text) return { ok: false, message: '指令不可為空白。' };

    var selContext = selOverride || null;
    var selMatch = text.match(/\s+@sel:([^\s]+)/);
    if (selMatch) {
      text = text.replace(/\s+@sel:[^\s]+/, '').trim();
      var selParts = selMatch[1].split(':');
      selContext = {
        source: selParts[0],
        target: selParts[1],
        id: selParts[2] || (selParts[0] === 'inv' ? selParts[1] : null),
        slot: (selParts[0] === 'equip' || selParts[0] === 'equip-slot') ? selParts[1] : null
      };
    }

    var args = text.split(/\s+/);
    var command = args.shift().toLowerCase();
    var amount, level, rarity, count, type, key, result, slot, node;

    if (command === 'skill2max' || command === 'skillmax' || command === 'skills2max') {
      return gmMaxSkill2(args[0]);
    }

    if (command === 'help' || command === '?') {
      return { ok: true, message: '指令說明請查看根目錄 GM_command.md' };
    }

    if (command === 'bag' || command === 'inv_cap' || command === 'invcap' || command === 'inv_size' || command === 'invsize' || command === 'bag_cap' || command === 'bagcap' || command === 'capacity') {
      return gmSetInventoryCap(args[0], false);
    }
    if (command === 'inv_expand' || command === 'bag_expand' || command === 'expand_inv') {
      return gmSetInventoryCap(args[0], true);
    }

    if (command === 'stage_jump' || command === 'stage' || command === 'set_stage' || command === 'setstage' || command === 'stage_set' || command === 'stageset' || command === 'zone_jump' || command === 'zone') {
      return gmJumpStage(args[0], args[1]);
    }

    if (command === 'socketall' || command === 'fillgems' || command === 'fillgem' || command === 'gemsocket' || command === 'sockets' || command === 'gemall') {
      return gmSocketAll(args[0], args[1]);
    }

    var isSlashPattern = text.indexOf('/') >= 0;
    var isKillAlias = command === 'kill' || command === 'multikill' || command === 'mk' || command === 'k';

    if (isSlashPattern || isKillAlias) {
      var scStr, stStr, cntStr, param4, param5;

      if (text.indexOf('/') >= 0) {
        var slashToken = isKillAlias ? (args[0] || '') : (command.indexOf('/') >= 0 ? command : (args[0] || ''));
        var parts = slashToken.split('/');
        if (parts.length >= 3) {
          scStr = parts[0]; stStr = parts[1]; cntStr = parts[2];
          if (parts.length >= 4) param4 = parts[3];
          if (parts.length >= 5) param5 = parts[4];
        }
        var remainingArgs = isKillAlias ? args.slice(1) : args;
        if (!param4 && remainingArgs.length >= 1) param4 = remainingArgs[0];
        if (!param5 && remainingArgs.length >= 2) param5 = remainingArgs[1];
      } else if (args.length >= 2) {
        scStr = isKillAlias ? args[0] : command;
        stStr = isKillAlias ? args[1] : args[0];
        cntStr = isKillAlias ? args[2] : args[1];
        param4 = isKillAlias ? args[3] : args[2];
        param5 = isKillAlias ? args[4] : args[3];
      }

      if (scStr && stStr && cntStr) {
        var zoneKey = gmParseScene(scStr);
        var stage = gmNumber(stStr, 1, 100000);
        var count = gmNumber(cntStr, 1, 100000);

        var filterRarity = null;
        var filterSlot = null;

        var resolveFilterParam = function(p) {
          if (!p) return null;
          var r = gmRarity(p);
          if (r !== null && filterRarity === null) {
            filterRarity = r;
            return null;
          }
          var s = gmParseSlot(p);
          if (s !== null && filterSlot === null) {
            filterSlot = s;
            return null;
          }
          if (p === 'all' || p === 'any' || p === '*') return null;
          return p;
        };

        var err4 = resolveFilterParam(param4);
        var err5 = resolveFilterParam(param5);

        if (err4 || err5) {
          var badParam = err4 || err5;
          return { ok: false, message: '無效的篩選參數：' + badParam + '（品質：common/mythic/0~8，部位：weapon/helmet/ring/shield...）' };
        }

        if (zoneKey && stage !== null && count !== null) {
          return gmExecuteMultiKill(zoneKey, stage, count, filterRarity, filterSlot);
        }
      }
      return { ok: false, message: '格式：場景/關卡數/擊殺數 [品質] [部位] (例：1/200/100 mythic weapon 或 kill 1 200 100 mythic ring)' };
    }

    if (command === 'gold' || command === 'g' || command === 'scrap' || command === 'essence' || command === 'dust') {
      amount = gmSignedAmount(args[0], 1e300);
      if (amount === null) return { ok: false, message: '格式：' + command + ' 數量（可為正負整數）' };
      return { ok: true, message: gmAddCurrency(command === 'g' ? 'gold' : command, amount) };
    }
    if (command === 'mat' || command === 'material') {
      key = String(args[0] || '').toLowerCase();
      if (['gold', 'scrap', 'essence', 'dust'].indexOf(key) < 0) return { ok: false, message: '材料只能是 gold、scrap、essence、dust' };
      amount = gmSignedAmount(args[1], 1e300);
      if (amount === null) return { ok: false, message: '格式：mat 材料 數量（可為正負整數）' };
      return { ok: true, message: gmAddCurrency(key, amount) };
    }
    if (command === 'skillxp') {
      // 技能熟練度經驗（2026-07-30）
      amount = gmNumber(args[0], 1, 1e300);
      if (amount === null) return { ok: false, message: '格式：skillxp 數量（正整數）' };
      if (typeof gainSkillMasteryXp === 'function') gainSkillMasteryXp(amount);
      gmDirty();
      return { ok: true, message: '增加技能經驗 x' + (typeof fmt === 'function' ? fmt(amount) : amount) };
    }
    if (command === 'masterylv') {
      // 直接設定技能熟練度等級（0~SKILL_MASTERY_MAX_LEVEL）
      level = gmNumber(args[0], 0, (typeof SKILL_MASTERY_MAX_LEVEL !== 'undefined') ? SKILL_MASTERY_MAX_LEVEL : 1000);
      if (level === null) return { ok: false, message: '格式：masterylv 等級（0~' + ((typeof SKILL_MASTERY_MAX_LEVEL !== 'undefined') ? SKILL_MASTERY_MAX_LEVEL : 1000) + '）' };
      if (typeof ensureSkillMastery === 'function') {
        var mMastery = ensureSkillMastery();
        mMastery.level = level;
        mMastery.xp = 0;
      } else {
        G.player.skillMastery = { level: level, xp: 0 };
      }
      gmDirty();
      return { ok: true, message: '技能熟練度設定為 Lv.' + level };
    }
    if (command === 'skill_point' || command === 'skillpoint' || command === 'skillpoints' || command === 'skill_points' || command === 'sp') {
      amount = gmSignedAmount(args[0], 1e9);
      if (amount === null) return { ok: false, message: '格式：' + command + ' 數量（可為正負整數）' };
      if (!G.player.skills2) G.player.skills2 = { levels: {} };
      var currentCredit = (typeof skills2LegacyPointCredit === 'function')
        ? skills2LegacyPointCredit()
        : Math.max(0, Math.floor(Number(G.player.skills2.legacyPointCredit) || 0));
      var nextCredit = Math.max(0, currentCredit + amount);
      G.player.skills2.legacyPointCredit = nextCredit;
      gmDirty();
      var pts = (typeof skills2PointView === 'function') ? skills2PointView() : null;
      var info = pts ? ('（目前可用：' + pts.available + '，總計：' + pts.total + '）') : ('（保留額度已設為 ' + nextCredit + '）');
      if (amount >= 0) {
        return { ok: true, message: '增加技能點 x' + (typeof fmt === 'function' ? fmt(amount) : amount) + info };
      } else {
        return { ok: true, message: '扣除技能點 x' + (typeof fmt === 'function' ? fmt(Math.abs(amount)) : Math.abs(amount)) + info };
      }
    }
    if (command === 'gem') {
      // gem all [等級|all] 數量：所有開放種類 × 指定等級（省略或 all＝1~10 階）各給 N 顆
      if (String(args[0] || '').toLowerCase() === 'all') {
        var allLvArg = args.length >= 3 ? String(args[1]).toLowerCase() : 'all';
        var allCntArg = args.length >= 3 ? args[2] : args[1];
        count = gmNumber(allCntArg, 1, 1e300);
        var lvFrom = 1, lvTo = GEM_FORGE_MAX_LEVEL;
        if (allLvArg !== 'all') {
          lvFrom = lvTo = gmNumber(allLvArg, 1, GEM_FORGE_MAX_LEVEL);
        }
        if (count === null || lvFrom === null) return { ok: false, message: '格式：gem all [等級|all] 數量（例：gem all 100、gem all 10 100）' };
        var gemKinds = Object.keys(GEM_TYPES).filter(isGemEnabled);
        gemKinds.forEach(function (k) {
          for (var gl = lvFrom; gl <= lvTo; gl++) addGem(k, gl, count);
        });
        return { ok: true, message: '全部 ' + gemKinds.length + ' 種寶石 ' + (lvFrom === lvTo ? 'Lv.' + lvFrom : 'Lv.1~' + lvTo) + ' 各 +' + (typeof fmt === 'function' ? fmt(count) : count) };
      }
      var rawType = String(args[0] || '');
      type = GEM_TYPES[rawType] ? rawType : (Object.keys(GEM_TYPES).find(function (k) { return k.toLowerCase() === rawType.toLowerCase(); }) || rawType);
      level = gmNumber(args[1], 1, GEM_FORGE_MAX_LEVEL);
      count = gmNumber(args[2], 1, 1e300);
      if (!GEM_TYPES[type] || level === null || count === null) return { ok: false, message: '格式：gem 寶石key 等級 數量' };
      addGem(type, level, count);
      return { ok: true, message: '增加 ' + gemLabel(type, level) + ' x' + (typeof fmt === 'function' ? fmt(count) : count) };
    }
    if (command === 'rune') {
      // rune <符文id|all> [數量]：r01～r33；all＝每種各給 N 顆
      var runeKey = String(args[0] || '').toLowerCase();
      count = gmNumber(args[1] === undefined ? '1' : args[1], 1, 1e9);
      if (count === null) return { ok: false, message: '格式：rune 符文id(r01~r33|all) 數量' };
      if (runeKey === 'all') {
        RUNES.forEach(function (r) { addRune(r.id, count); });
        return { ok: true, message: '全部 ' + RUNES.length + ' 種符文各 +' + count };
      }
      if (!RUNE_BY_ID[runeKey]) return { ok: false, message: '格式：rune 符文id(r01~r33|all) 數量' };
      addRune(runeKey, count);
      return { ok: true, message: '增加 ' + runeLabel(runeKey) + ' x' + count };
    }
    if (command === 'runeword') {
      // runeword <符文真言id|list>：把該組配方的符文放進庫存（拿去鑲嵌即成形）
      var wordKey = String(args[0] || '');
      if (wordKey === 'list' || !wordKey) {
        return { ok: true, message: RUNEWORDS.map(function (w) { return w.id + '（' + w.name + '）'; }).join('、') };
      }
      var wd = RUNEWORD_BY_ID[wordKey];
      if (!wd) return { ok: false, message: '找不到符文真言：' + wordKey + '（runeword list 可列出全部）' };
      wd.runes.forEach(function (rid) { addRune(rid, 1); });
      return { ok: true, message: '已給【' + wd.name + '】配方符文：' + rwRecipeText(wd) };
    }
    if (command === 'book') {
      key = String(args[0] || '').toLowerCase();
      count = gmNumber(args[1], 1, 1e300);
      if (!ENCHANTS[key] || count === null) return { ok: false, message: '格式：book 附魔key 數量' };
      G.player.books[key] = (G.player.books[key] || 0) + count;
      gmDirty();
      return { ok: true, message: '增加 ' + ENCHANTS[key].name + ' x' + (typeof fmt === 'function' ? fmt(count) : count) };
    }
    if (command === 'equip' || command === 'equipment') {
      rarity = gmRarity(args[0], true);
      level = gmNumber(args[1], 1, 100000);
      slot = String(args[2] || '').toLowerCase();
      count = gmNumber(args[3] || '1', 1, 1000);
      var equipUpgrade = args[4] ? gmNumber(args[4], 0, 1000) : 0;
      var equipAncient = args[5] ? gmNumber(args[5], 0, 10) : 0;
      if (rarity === null || level === null || count === null) return { ok: false, message: '格式：equip 稀有度 等級 [部位] [數量] [強化等級] [太古數]' };
      if (!slot || slot === 'all' || slot === '*') slot = null;
      return { ok: true, message: gmGiveEquipment(rarity, level, slot, count, equipUpgrade, equipAncient) };
    }
    if (command === 'equipset' || command === 'equip_set' || command === 'set' || command === 'suit' || command === 'fullset' || command === 'full_set' || command === 'gearset' || command === 'gear_set') {
      if (!args[0]) {
        return { ok: false, message: '格式：equipset 品質 [等級] [強化等級] [太古數] [wear/inv]（例：equipset mythic 500 50 4 wear）' };
      }
      rarity = gmRarity(args[0], true);
      if (rarity === null) {
        return { ok: false, message: '無效的品質：' + args[0] + '（可填 0~' + ((typeof RARITIES !== 'undefined' && RARITIES.length) ? (RARITIES.length - 1) : 10) + '、common/mythic... 或 any）' };
      }
      level = args[1] ? gmNumber(args[1], 1, 100000) : null;
      if (args[1] && level === null) {
        return { ok: false, message: '無效的等級：' + args[1] + '（範圍 1~100000）' };
      }
      var setUpgrade = args[2] ? gmNumber(args[2], 0, 1000) : 0;
      var setAncient = args[3] ? gmNumber(args[3], 0, 10) : 0;
      var autoWear = args[4] === 'wear' || args[4] === 'equip' || args[4] === 'on' || args[4] === 'true' || args[4] === '1';
      return { ok: true, message: gmGiveEquipmentSet(rarity, level, setUpgrade, setAncient, autoWear) };
    }
    if (command === 'modequip' || command === 'editequip' || command === 'equipmod' ||
        command === 'setequip' || command === 'itemmod' || command === 'meq' || command === '改裝備') {
      return gmModEquip(args, selContext);
    }
    if (command === 'part') {
      level = gmNumber(args[0], 1, PART_MAX_TIER);
      node = String(args[1] || '').toLowerCase();
      count = gmNumber(args[2] || '1', 1, 1000);
      if (level === null || count === null) return { ok: false, message: '格式：part 階級 [節點] [數量]' };
      if (!node || /^\d+$/.test(node)) { count = node ? gmNumber(node, 1, 1000) : count; node = null; }
      if (node && ['salvage', 'synth'].indexOf(node) < 0) return { ok: false, message: '節點只能是 salvage 或 synth' };
      result = gmGivePart(level, node, count);
      return { ok: result.indexOf('此節點目前關閉') !== 0, message: result };
    }
    if (command === 'tower_trial_clear') {
      return gmClearTowerTo(TOWER_TRIAL_MAX_FLOOR, '試煉之塔');
    }
    if (command === 'tower_hell_clear') {
      return gmClearTowerTo(TOWER_HELL_MAX_FLOOR, '地獄之塔');
    }
    if (command === 'tower_purgatory_clear') {
      return gmClearTowerTo(TOWER_PURGATORY_MAX_FLOOR, '煉獄之塔');
    }
    if (command === 'tower_trial_reset') {
      return gmResetTowerFrom(1, '試煉之塔');
    }
    if (command === 'tower_hell_reset') {
      return gmResetTowerFrom(TOWER_TRIAL_MAX_FLOOR + 1, '地獄之塔');
    }
    if (command === 'tower_purgatory_reset') {
      return gmResetTowerFrom(TOWER_HELL_MAX_FLOOR + 1, '煉獄之塔');
    }
    if (command === 'tower_jump') {
      return gmJumpTowerTo(args[0]);
    }
    if (command === 'reincarnation' || command === 'reincarnate' || command === 'turn') {
      return gmSetReincarnation(args[0]);
    }
    if (command === 'level' || command === 'lv') {
      level = gmNumber(args[0], 1, 100000);
      if (level === null) return { ok: false, message: '格式：level 等級' };
      G.player.level = level;
      if (typeof markStatsDirty === 'function') markStatsDirty();
      gmDirty();
      return { ok: true, message: '玩家等級設定為 Lv.' + level };
    }
    if (command === 'xp') {
      amount = gmNumber(args[0], 1, 1e300);
      if (amount === null) return { ok: false, message: '格式：xp 數量（正整數）' };
      if (typeof gainXp === 'function') gainXp(amount);
      else G.player.xp = (G.player.xp || 0) + amount;
      gmDirty();
      return { ok: true, message: '增加經驗值 x' + (typeof fmt === 'function' ? fmt(amount) : amount) };
    }
    if (command === 'shop') {
      level = gmNumber(args[0], 1, GEM_SHOP_MAX_LEVEL);
      if (level === null) return { ok: false, message: '格式：shop 商店等級（1~20）' };
      var shop = gemShop();
      shop.level = level;
      rollGemShop();
      gmDirty();
      return { ok: true, message: '寶石商店設定為 Lv.' + level + ' 並重新刷店' };
    }
    if (command === 'save') {
      if (typeof saveGame === 'function') saveGame();
      return { ok: true, message: '已要求立即存檔' };
    }
    if (command === 'task') {
      if (typeof TASKS === 'undefined') return { ok: false, message: '任務表（TASKS）未載入' };
      var tMax = TASKS.length;
      var tNum = gmNumber(args[0], 0, 100000);
      if (tNum === null) return { ok: false, message: '格式：task 數字（0=重置全部，N=設置至第N個任務，≥' + tMax + '=全部完成）' };
      if (typeof taskState !== 'function') return { ok: false, message: 'taskState 未載入' };
      var tSt = taskState();
      if (tNum === 0) {
        tSt.idx = 0;
        gmDirty();
        if (typeof UI !== 'undefined' && UI.dirty) UI.dirty.task = true;
        return { ok: true, message: '所有任務已重置（idx=0）' };
      }
      // N >= tMax → 全部完成
      var newIdx = Math.min(tNum, tMax);
      tSt.idx = newIdx;
      gmDirty();
      if (typeof UI !== 'undefined' && UI.dirty) UI.dirty.task = true;
      if (newIdx >= tMax) {
        return { ok: true, message: '所有任務設為已完成（idx=' + newIdx + '/' + tMax + '）' };
      }
      return { ok: true, message: '任務設置至第 ' + newIdx + ' 個（前 ' + newIdx + ' 個已完成，目前進行中：「' + TASKS[newIdx].name + '」）' };
    }
    /* ---- 技能測試指令（2026-08-14 技能檢驗流程規範 → docs/SKILL_TEST_SPEC.md）---- */
    if (command === 'god' || command === 'lockhp') {
      var godRaw = String(args[0] === undefined ? '1' : args[0]).toLowerCase();
      if (['1', '0', 'on', 'off', 'true', 'false'].indexOf(godRaw) < 0) {
        return { ok: false, message: '格式：god [1|0]（鎖血開關；省略參數＝開）' };
      }
      GM_GLOBAL.GM_TEST.god = (godRaw === '1' || godRaw === 'on' || godRaw === 'true');
      return { ok: true, message: GM_GLOBAL.GM_TEST.god ? '鎖血開啟：我方生命最低保留 1，不會死亡' : '鎖血關閉' };
    }
    if (command === 'hp_lock') {
      GM_GLOBAL.GM_TEST.hpLock = !GM_GLOBAL.GM_TEST.hpLock;
      return {
        ok: true,
        message: GM_GLOBAL.GM_TEST.hpLock ? 'HP 鎖定開啟：我方不再扣血' : 'HP 鎖定解除'
      };
    }
    if (command === 'mp_lock') {
      GM_GLOBAL.GM_TEST.mpLock = !GM_GLOBAL.GM_TEST.mpLock;
      return {
        ok: true,
        message: GM_GLOBAL.GM_TEST.mpLock ? 'MP 鎖定開啟：不扣魔且技能可免費使用' : 'MP 鎖定解除'
      };
    }
    if (command === 'skill_unlock' || command === 'skillunlock' || command === 'skills_unlock' || command === 'skillsunlock') {
      var rawSkillOpt = String(args[0] === undefined ? '' : args[0]).toLowerCase();
      if (rawSkillOpt === 'on' || rawSkillOpt === '1' || rawSkillOpt === 'true') {
        GM_GLOBAL.GM_TEST.skillUnlock = true;
      } else if (rawSkillOpt === 'off' || rawSkillOpt === '0' || rawSkillOpt === 'false') {
        GM_GLOBAL.GM_TEST.skillUnlock = false;
      } else if (!rawSkillOpt) {
        GM_GLOBAL.GM_TEST.skillUnlock = !GM_GLOBAL.GM_TEST.skillUnlock;
      } else {
        return { ok: false, message: '格式：skill_unlock [on|off]（省略參數為重複切換）' };
      }
      if (typeof clearSkills2LevelsCache === 'function') clearSkills2LevelsCache();
      if (typeof markStatsDirty === 'function') markStatsDirty();
      gmDirty();
      return {
        ok: true,
        skillUnlock: GM_GLOBAL.GM_TEST.skillUnlock,
        message: GM_GLOBAL.GM_TEST.skillUnlock
          ? '全技能限制已解鎖：無需達到指定等級或封魔塔層級即可升級與使用（再次輸入可恢復正常）'
          : '已恢復技能正常限制條件'
      };
    }
    if (command === 'statset' || command === 'stat') {
      // 屬性基準覆寫：套在 computeStats 所有上限夾制之後（固定值，不受裝備影響）
      var STAT_KEYS = {
        aspd: 'aspd', cdr: 'cdr', atk: 'atk', matk: 'matk', hit: 'hit',
        crit: 'critRate', critrate: 'critRate', critdmg: 'critDmg', aoe: 'aoeDmg', aoedmg: 'aoeDmg',
        // 反擊測試（2026-08-14 技能第二批）：招架／破甲擊依賴格擋觸發
        block: 'blockRate', blockrate: 'blockRate', blockred: 'blockDmgRed'
      };
      key = String(args[0] || '').trim().toLowerCase();
      if (key === 'clear' || key === 'off') {
        GM_GLOBAL.GM_TEST.statOverride = null;
        if (typeof markStatsDirty === 'function') markStatsDirty();
        gmDirty();
        return { ok: true, message: '屬性覆寫已全部清除（恢復裝備計算值）' };
      }
      if (!STAT_KEYS[key]) {
        return { ok: false, message: '格式：statset 欄位 數值｜statset clear（欄位：' + Object.keys(STAT_KEYS).join('/') + '）' };
      }
      var statVal = gmNumber(args[1], 0, 1e300);
      if (statVal === null) return { ok: false, message: '格式：statset ' + key + ' 數值（非負數）' };
      if (!GM_GLOBAL.GM_TEST.statOverride) GM_GLOBAL.GM_TEST.statOverride = {};
      GM_GLOBAL.GM_TEST.statOverride[STAT_KEYS[key]] = statVal;
      if (typeof markStatsDirty === 'function') markStatsDirty();
      gmDirty();
      return { ok: true, message: '屬性覆寫：' + STAT_KEYS[key] + ' = ' + statVal + '（statset clear 可清除）' };
    }
    if (command === 'maxstats' || command === 'testmode') {
      // 技能測試基準組：攻速頂到上限、冷卻縮減頂到屬性上限、命中拉滿去除 MISS 噪音
      var msAspd = (typeof ASPD_CAP === 'number') ? ASPD_CAP : 5;
      var msCdr = (typeof STAT_CAPS !== 'undefined' && STAT_CAPS && Number(STAT_CAPS.cdr) > 0) ? Number(STAT_CAPS.cdr) : 90;
      if (!GM_GLOBAL.GM_TEST.statOverride) GM_GLOBAL.GM_TEST.statOverride = {};
      GM_GLOBAL.GM_TEST.statOverride.aspd = msAspd;
      GM_GLOBAL.GM_TEST.statOverride.cdr = msCdr;
      GM_GLOBAL.GM_TEST.statOverride.hit = 999;
      if (typeof markStatsDirty === 'function') markStatsDirty();
      gmDirty();
      return { ok: true, message: '測試基準組：攻速 ' + msAspd + '（上限）、冷卻縮減 ' + msCdr + '%（上限）、命中 999（statset clear 可清除）' };
    }
    if (command === 'spawn' || command === 'arena') {
      var spawnFirst = String(args[0] || '').toLowerCase();
      if (spawnFirst === 'off' || spawnFirst === 'clear' || spawnFirst === '0') {
        if (typeof gmArenaOff !== 'function') return { ok: false, message: '戰鬥模組未載入（gmArenaOff）' };
        gmArenaOff();
        return { ok: true, message: '演武場關閉：已清場並恢復自然出怪' };
      }
      count = gmNumber(args[0], 1, 32);
      if (count === null) return { ok: false, message: '格式：spawn 數量(1~32) [small|elite|boss] [血量倍率]｜spawn off' };
      var kindRaw = String(args[1] || 'small').toLowerCase();
      var kind = { small: 'small', normal: 'small', mob: 'small', '小怪': 'small', elite: 'elite', '菁英': 'elite', boss: 'boss' }[kindRaw];
      if (!kind) return { ok: false, message: '敵種只能是 small、elite 或 boss' };
      var spawnHpx = args[2] !== undefined ? gmNumber(args[2], 0.01, 1e6) : 1;
      if (spawnHpx === null) return { ok: false, message: '血量倍率範圍 0.01~1000000' };
      if (typeof gmArenaSpawn !== 'function') return { ok: false, message: '戰鬥模組未載入（gmArenaSpawn）' };
      if (G.tower && G.tower.active) return { ok: false, message: '封魔塔戰鬥中不可使用演武場出怪' };
      var spawned = gmArenaSpawn(count, kind, spawnHpx);
      return { ok: true, message: '演武場：生成 ' + spawned + ' 隻' + (kind === 'boss' ? 'BOSS' : (kind === 'elite' ? '菁英' : '小怪')) +
        '（血量 ×' + spawnHpx + '；自然出怪與過關結算已暫停，spawn off 恢復）' };
    }
    if (command === 'elite') {
      // 高級敵人演武場：elite list｜elite 群數 [技能,技能…|all] [每群隻數] [血量倍率] [elite|adv|boss]
      // 技能 id 是 Skills2 表敵人技能的群組ID（e_ 開頭，輸入時 e_ 可省略）；all＝依 NPC 表隨機配
      if (typeof ELITE_AFFIXES === 'undefined' || typeof gmArenaSpawnElite !== 'function') {
        return { ok: false, message: '菁英模組未載入（ELITE_AFFIXES／gmArenaSpawnElite）' };
      }
      if (String(args[0] || '').toLowerCase() === 'list') {
        return { ok: true, message: '敵人技能（' + ELITE_AFFIX_ORDER.length + '，隨機池 ' + eliteSkillIds('random').length + '／專屬 ' + eliteSkillIds('exclusive').length + '）：' +
          ELITE_AFFIX_ORDER.map(function (id) {
            return id.replace(/^e_/, '') + '＝' + ELITE_AFFIXES[id].name + (ELITE_AFFIXES[id].pool === 'random' ? '（隨機池）' : '');
          }).join('、') +
          // 封魔塔 BOSS 的玩家技能（終極進化）：id 要寫完整的 ps_ 開頭，例 ps_petalStorm
          (typeof bskOptionList === 'function' ? '｜玩家技能（' + bskOptionList().length + '，id 含 ps_ 前綴）：' +
            bskOptionList().map(function (o) { return bskIdOf(o.ult.id) + '＝' + o.ult.name; }).join('、') : '') };
      }
      if (G.tower && G.tower.active) return { ok: false, message: '封魔塔戰鬥中不可使用演武場出怪' };
      var eliteGroups = args[0] === undefined ? 1 : gmNumber(args[0], 1, 8);
      if (eliteGroups === null) return { ok: false, message: '格式：elite 群數(1~8) [技能,技能…|all] [每群隻數(1~6)] [血量倍率] [elite|adv|boss]｜elite list' };
      var eliteIds = [];
      var eliteRaw = String(args[1] || 'all').trim();
      if (eliteRaw !== 'all') {
        var eliteWanted = eliteRaw.split(',');
        for (var ei = 0; ei < eliteWanted.length; ei++) {
          var eliteKey = ELITE_AFFIXES[eliteWanted[ei]] ? eliteWanted[ei] : 'e_' + eliteWanted[ei];
          if (!ELITE_AFFIXES[eliteKey]) return { ok: false, message: '未知技能：' + eliteWanted[ei] + '（elite list 看清單）' };
          eliteIds.push(eliteKey);
        }
      }
      var eliteSize = args[2] === undefined ? 2 : gmNumber(args[2], 1, 6);
      var eliteHpx = args[3] === undefined ? 1 : gmNumber(args[3], 0.01, 1e6);
      if (eliteSize === null || eliteHpx === null) return { ok: false, message: '每群隻數 1~6、血量倍率 0.01~1000000' };
      var eliteTierRaw = String(args[4] || 'elite').toLowerCase();
      var eliteTier = { elite: 'elite', adv: 'elite_adv', elite_adv: 'elite_adv', boss: 'boss' }[eliteTierRaw];
      if (!eliteTier) return { ok: false, message: '類型只能是 elite、adv 或 boss' };
      var eliteSpawned = gmArenaSpawnElite(eliteGroups, eliteIds, eliteSize, eliteHpx, eliteTier);
      return { ok: true, message: '演武場：生成 ' + eliteGroups + ' 群' + (eliteTier === 'boss' ? 'BOSS' : (eliteTier === 'elite_adv' ? '高級菁英' : '菁英')) + '共 ' + eliteSpawned + ' 隻（' +
        (eliteIds.length ? eliteIds.map(eliteAffixLabel).join('、') : '依 NPC 表隨機配技能') + '；自然出怪暫停，spawn off 恢復）' };
    }
    if (command === 'sglv') {
      // 新版技能群組等級直設（測試用，不扣金幣；正規化沿用 sgEffectiveLevels 的循序解鎖規則）
      if (typeof SKILLS2 === 'undefined' || typeof sgEffectiveLevels !== 'function') {
        return { ok: false, message: '新版技能模組未載入（SKILLS2）' };
      }
      var sgTarget = String(args[0] || '').trim();
      var sgLvRaw = String(args[1] || '').trim().toLowerCase();
      var sgGids = sgTarget === 'all' ? Object.keys(SKILLS2) : [sgTarget];
      if (sgTarget !== 'all' && !SKILLS2[sgTarget]) {
        return { ok: false, message: '未知群組：' + sgTarget + '（可用：all、' + Object.keys(SKILLS2).join('、') + '）' };
      }
      var sgMax = (typeof SG_TIER_MAX_LV === 'number') ? SG_TIER_MAX_LV : 10;
      var sgArr = null;
      if (sgLvRaw === 'max') {
        sgArr = null; // 逐群組以階數展開全滿
      } else if (/^\d+(,\d+)*$/.test(sgLvRaw)) {
        sgArr = sgLvRaw.split(',').map(function (x) { return Math.max(0, Math.min(sgMax, Math.floor(Number(x) || 0))); });
      } else {
        return { ok: false, message: '格式：sglv 群組|all 等級（單一數字＝各階同值、逗號列表＝逐階、max＝全滿）' };
      }
      if (!G.player.skills2) G.player.skills2 = { levels: {} };
      if (!G.player.skills2.levels) G.player.skills2.levels = {};
      var sgMsgs = [];
      for (var sgI = 0; sgI < sgGids.length; sgI++) {
        var sgGid = sgGids[sgI];
        var tierCount = SKILLS2[sgGid].tiers.length;
        var raw;
        if (sgArr === null) {
          raw = []; for (var tI = 0; tI < tierCount; tI++) raw.push(sgMax);
        } else if (sgArr.length === 1) {
          raw = []; for (var tJ = 0; tJ < tierCount; tJ++) raw.push(sgArr[0]);
        } else {
          raw = sgArr.slice(0, tierCount);
        }
        var rawMap = {}; rawMap[sgGid] = raw;
        var normalized = sgEffectiveLevels(rawMap, sgGid); // 循序解鎖與上限正規化
        G.player.skills2.levels[sgGid] = normalized;
        sgMsgs.push(SKILLS2[sgGid].name + ' [' + normalized.join(',') + ']');
      }
      if (typeof markStatsDirty === 'function') markStatsDirty();
      gmDirty();
      return { ok: true, message: '新版技能等級設定：' + sgMsgs.join('；') };
    }
    if (command === 'sgult') {
      /* 終極進化（第 8 階）直設（測試用，不扣金幣）。
         選擇本身是玩家決策，因此 maxskill2／sglv 一律不碰它——要測就用這一支。
         格式：sgult 群組|all 1|2|3|off [等級|max] */
      if (typeof SKILLS2 === 'undefined' || typeof sgUltDefs !== 'function') {
        return { ok: false, message: '新版技能模組未載入（SKILLS2）' };
      }
      var ulTarget = String(args[0] || '').trim();
      var ulOptRaw = String(args[1] || '').trim().toLowerCase();
      var ulLvRaw = String(args[2] || 'max').trim().toLowerCase();
      if (!ulTarget || !ulOptRaw) {
        return { ok: false, message: '格式：sgult 群組|all 1|2|3|off [等級|max]' };
      }
      if (ulTarget !== 'all' && !SKILLS2[ulTarget]) {
        return { ok: false, message: '未知群組：' + ulTarget };
      }
      var ulGids = ulTarget === 'all' ? Object.keys(SKILLS2) : [ulTarget];
      var ulMax = (typeof SG_TIER_MAX_LV === 'number') ? SG_TIER_MAX_LV : 10;
      var ulLv = ulLvRaw === 'max' ? ulMax : Math.max(0, Math.min(ulMax, Math.floor(Number(ulLvRaw) || 0)));
      if (!G.player.skills2) G.player.skills2 = { levels: {} };
      if (!G.player.skills2.ult) G.player.skills2.ult = {};
      var ulMsgs = [];
      for (var ulI = 0; ulI < ulGids.length; ulI++) {
        var ulGid = ulGids[ulI];
        var ulList = sgUltDefs(ulGid);
        if (!ulList) continue;                       // 尚未開放終極進化的群組直接略過
        if (ulOptRaw === 'off' || ulLv < 1) {
          delete G.player.skills2.ult[ulGid];
          ulMsgs.push(SKILLS2[ulGid].name + ' 已清除');
          continue;
        }
        var ulIdx = Math.floor(Number(ulOptRaw)) - 1; // 指令用 1-based，存檔用 0-based
        if (!(ulIdx >= 0 && ulIdx < ulList.length)) {
          return { ok: false, message: '選項需為 1~' + ulList.length + '（或 off）' };
        }
        G.player.skills2.ult[ulGid] = { pick: ulIdx, lv: ulLv };
        ulMsgs.push(SKILLS2[ulGid].name + '【' + ulList[ulIdx].name + '】Lv.' + ulLv);
      }
      if (!ulMsgs.length) return { ok: false, message: '指定的群組尚未開放終極進化' };
      if (typeof markStatsDirty === 'function') markStatsDirty();
      gmDirty();
      return { ok: true, message: '終極進化設定：' + ulMsgs.join('；') };
    }
    return { ok: false, message: '未知指令：' + command + '（輸入 help 查看文件）' };
  }

  var _global = (typeof self !== 'undefined') ? self
    : ((typeof window !== 'undefined') ? window : null);
  if (_global) {
    _global.isGMHost = isGMHost;
    _global.executeGMCommand = executeGMCommand;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isGMHost: isGMHost, executeGMCommand: executeGMCommand };
  }
})();
