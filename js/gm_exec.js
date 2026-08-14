'use strict';
/* ============ GM 指令執行層（無 DOM 相依） ============
   原本與 GM 面板一起寫在 js/gm.js 的 IIFE 裡。指令會變更遊戲狀態，而狀態在 Worker，
   所以執行層必須能在 Worker 內載入——但面板是 DOM，只能留在主執行緒。因此拆成兩檔。

   本檔同時被主執行緒 <script> 與 Worker importScripts 載入，實作只有一份。
   ⚠️ Worker 模式下主執行緒**不得**呼叫本檔的函式：那會改到過期的鏡像狀態。
   由 js/gm.js 依 WorkerBridge.enabled() 決定走哪一邊。

   安全邊界不變：只接受本機 hostname，不依賴任何可被前端覆寫的旗標。 */

(function () {
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
    }
    return null;
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

  function gmGiveEquipment(rarity, level, slot, count) {
    var weaponType;
    if (slot === 'any' || slot === '*') slot = null;
    if (slot && typeof WEAPON_TYPES !== 'undefined' && WEAPON_TYPES[slot]) {
      weaponType = slot;
      slot = 'weapon';
    } else if (slot) {
      slot = slotTypeOf(slot);
    }
    if (slot && !SLOT_INFO[slot]) return '未知部位：' + slot;
    for (var i = 0; i < count; i++) {
      var itemRarity = rarity === 'any' ? Math.floor(Math.random() * RARITIES.length) : rarity;
      var item = makeEquipment(level, { rarity: itemRarity, level: level, slot: slot || undefined, weaponType: weaponType });
      item.locked = false;
      G.inventory.push(item);
    }
    gmDirty();
    return '增加裝備 ' + (rarity === 'any' ? '隨機品質' : RARITIES[rarity].name) + '、Lv.' + level +
      (slot ? '、' + ((SLOT_INFO[slot] && SLOT_INFO[slot].name) || slot) : '、隨機部位') + ' x' + count;
  }

  function gmGiveEquipmentSet(rarity, level) {
    if (!level) {
      level = (G.player && G.player.level) || (G.stage && G.stage.current) || 1;
    }
    var oneHandTypes = ['sword1h', 'dagger1h', 'wand1h', 'magicSword1h'];
    var offHandTypes = ['shield', 'focus', 'spellbook', 'orb', 'dagger1h'];

    var setPieces = [
      { slot: 'weapon', weaponType: typeof pick === 'function' ? pick(oneHandTypes) : oneHandTypes[Math.floor(Math.random() * oneHandTypes.length)], name: '主手' },
      { slot: 'weapon', weaponType: typeof pick === 'function' ? pick(offHandTypes) : offHandTypes[Math.floor(Math.random() * offHandTypes.length)], name: '副手' },
      { slot: 'helmet', name: '頭盔' },
      { slot: 'shoulder', name: '肩甲' },
      { slot: 'chest', name: '胸甲' },
      { slot: 'belt', name: '腰帶' },
      { slot: 'gloves', name: '護手' },
      { slot: 'wrist', name: '手腕' },
      { slot: 'legs', name: '護腿' },
      { slot: 'boots', name: '靴子' },
      { slot: 'ring', name: '戒指' },
      { slot: 'ring', name: '戒指Ⅱ' },
      { slot: 'amulet', name: '項鍊' }
    ];

    if (!G.inventory) G.inventory = [];

    for (var i = 0; i < setPieces.length; i++) {
      var piece = setPieces[i];
      var itemRarity = rarity === 'any' ? Math.floor(Math.random() * RARITIES.length) : rarity;
      var item = makeEquipment(level, {
        rarity: itemRarity,
        level: level,
        slot: piece.slot,
        weaponType: piece.weaponType
      });
      item.locked = false;
      G.inventory.push(item);
    }
    gmDirty();

    var rName = (rarity === 'any') ? '隨機品質' : ((typeof RARITIES !== 'undefined' && RARITIES[rarity] && RARITIES[rarity].name) || ('品質' + rarity));
    return '已發放【' + rName + '】Lv.' + level + ' 全身 13 件裝備套裝（主手、副手、頭盔、肩甲、胸甲、腰帶、護手、手腕、護腿、靴子、戒指x2、項鍊）';
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
    if (!G.tower) return { ok: false, message: '目前找不到高塔進度資料。' };
    if (G.tower.active) return { ok: false, message: '高塔戰鬥進行中，請先結束目前戰鬥。' };
    var before = Number(G.tower.highest) || 0;
    G.tower.highest = Math.max(before, maxFloor);
    gmTowerDirty();
    return {
      ok: true,
      message: towerName + '已通關至第 ' + G.tower.highest + ' 層（GM 不補發通關獎勵）'
    };
  }

  function gmResetTowerFrom(startFloor, towerName) {
    if (!G.tower) return { ok: false, message: '目前找不到高塔進度資料。' };
    if (G.tower.active) return { ok: false, message: '高塔戰鬥進行中，請先結束目前戰鬥。' };
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
    if (!G.tower) return { ok: false, message: '目前找不到高塔進度資料。' };
    if (G.tower.active) return { ok: false, message: '高塔戰鬥進行中，請先結束目前戰鬥。' };
    G.tower.highest = floor - 1;
    gmTowerDirty();
    return { ok: true, message: '已跳至高塔第 ' + floor + ' 層，之前的樓層視為已挑戰成功' };
  }

  function gmSetReincarnation(rawCount) {
    var count = gmNumber(rawCount, 0, REINCARNATION_MAX);
    if (count === null) return { ok: false, message: '格式：reincarnation 轉生次數（0~' + REINCARNATION_MAX + '）' };
    if (G.tower && G.tower.active) return { ok: false, message: '高塔戰鬥進行中，請先結束目前戰鬥。' };
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

  function executeGMCommand(raw) {
    if (!isGMHost()) return { ok: false, message: 'GM 指令僅能在本機開發環境使用。' };
    var text = String(raw || '').trim();
    if (!text) return { ok: false, message: '指令不可為空白。' };
    var args = text.split(/\s+/);
    var command = args.shift().toLowerCase();
    var amount, level, rarity, count, type, key, result, slot, node;

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
    if (command === 'scroll') {
      // 魔法卷軸（2026-07-30 技能融合材料）
      amount = gmSignedAmount(args[0], 1e300);
      if (amount === null) return { ok: false, message: '格式：scroll 數量（可為正負整數）' };
      return { ok: true, message: gmAddCurrency('magicScroll', amount) };
    }
    if (command === 'mat' || command === 'material') {
      key = String(args[0] || '').toLowerCase();
      if (key === 'magicscroll' || key === 'scroll') key = 'magicScroll';
      if (['gold', 'scrap', 'essence', 'dust', 'magicScroll'].indexOf(key) < 0) return { ok: false, message: '材料只能是 gold、scrap、essence、dust、scroll' };
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
    if (command === 'gem') {
      var rawType = String(args[0] || '');
      type = GEM_TYPES[rawType] ? rawType : (Object.keys(GEM_TYPES).find(function (k) { return k.toLowerCase() === rawType.toLowerCase(); }) || rawType);
      level = gmNumber(args[1], 1, GEM_FORGE_MAX_LEVEL);
      count = gmNumber(args[2], 1, 1e300);
      if (!GEM_TYPES[type] || level === null || count === null) return { ok: false, message: '格式：gem 寶石key 等級 數量' };
      addGem(type, level, count);
      return { ok: true, message: '增加 ' + gemLabel(type, level) + ' x' + (typeof fmt === 'function' ? fmt(count) : count) };
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
      if (rarity === null || level === null || count === null) return { ok: false, message: '格式：equip 稀有度 等級 [部位] [數量]' };
      if (!slot) slot = null;
      return { ok: true, message: gmGiveEquipment(rarity, level, slot, count) };
    }
    if (command === 'equipset' || command === 'equip_set' || command === 'set' || command === 'suit' || command === 'fullset' || command === 'full_set' || command === 'gearset' || command === 'gear_set') {
      if (!args[0]) {
        return { ok: false, message: '格式：equipset 品質 [等級]（例：equipset mythic 500 或 equipset 創世）' };
      }
      rarity = gmRarity(args[0], true);
      if (rarity === null) {
        return { ok: false, message: '無效的品質：' + args[0] + '（可填 0~' + ((typeof RARITIES !== 'undefined' && RARITIES.length) ? (RARITIES.length - 1) : 10) + '、common/mythic... 或 any）' };
      }
      level = args[1] ? gmNumber(args[1], 1, 100000) : null;
      if (args[1] && level === null) {
        return { ok: false, message: '無效的等級：' + args[1] + '（範圍 1~100000）' };
      }
      return { ok: true, message: gmGiveEquipmentSet(rarity, level) };
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
      var beforeLevel = Number(G.player.level) || 0;
      G.player.level = level;
      if (level < beforeLevel && typeof recheckSkillUnlocksForGMLevelChange === 'function') {
        recheckSkillUnlocksForGMLevelChange(beforeLevel, level);
      }
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
