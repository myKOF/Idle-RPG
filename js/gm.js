'use strict';
/* ============ 本機 GM 指令工具（僅供開發環境） ============ */

(function () {
  var gmUi = null;

  // 安全邊界：不依賴「是否為開發模式」等可被前端變數覆寫的旗標，只接受本機 hostname。
  function isGMHost() {
    var loc = (typeof window !== 'undefined' && window.location) ||
      (typeof location !== 'undefined' && location);
    var host = loc && loc.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }

  function gmNumber(raw, min, max) {
    if (!/^\d+$/.test(String(raw || ''))) return null;
    var value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) return null;
    return value;
  }

  function gmSignedAmount(raw, max) {
    if (!/^-?\d+$/.test(String(raw || ''))) return null;
    var value = Number(raw);
    if (!Number.isSafeInteger(value) || value < -max || value > max) return null;
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

  function gmRarity(raw) {
    var n = gmNumber(raw, 0, RARITIES.length - 1);
    if (n !== null) return n;
    for (var i = 0; i < RARITIES.length; i++) {
      if (RARITIES[i].key === raw) return i;
    }
    return null;
  }

  function gmAddCurrency(key, amount) {
    var before = Number(G.player[key] || 0);
    var after = Math.max(0, before + amount);
    G.player[key] = after;
    gmDirty();
    if (amount < 0) return '扣除 ' + (before - after).toLocaleString() + ' ' + key;
    return '增加 ' + amount.toLocaleString() + ' ' + key;
  }

  function gmGiveEquipment(rarity, level, slot, count) {
    if (slot && !SLOT_INFO[slot]) return '未知部位：' + slot;
    for (var i = 0; i < count; i++) {
      var item = makeEquipment(level, { rarity: rarity, level: level, slot: slot || undefined });
      item.locked = false;
      // GM 發放不走一般背包滿載時的自動分解流程，避免測試物品被意外銷毀。
      G.inventory.push(item);
    }
    gmDirty();
    return '增加裝備 ' + RARITIES[rarity].name + '、Lv.' + level + ' x' + count;
  }

  function gmGivePart(tier, node, count) {
    for (var i = 0; i < count; i++) {
      var part = makePart(tier, node || undefined);
      if (!part) return '此節點目前關閉或不存在：' + (node || '未知');
      G.factory.parts.push(part);
    }
    gmDirty();
    return '增加自動機組零件 T' + tier + (node ? '（' + node + '）' : '') + ' x' + count;
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
    if (command === 'gold' || command === 'g' || command === 'scrap' || command === 'essence' || command === 'dust') {
      amount = gmSignedAmount(args[0], 1000000000000);
      if (amount === null) return { ok: false, message: '格式：' + command + ' 數量（可為正負整數）' };
      return { ok: true, message: gmAddCurrency(command === 'g' ? 'gold' : command, amount) };
    }
    if (command === 'mat' || command === 'material') {
      key = String(args[0] || '').toLowerCase();
      if (['gold', 'scrap', 'essence', 'dust'].indexOf(key) < 0) return { ok: false, message: '材料只能是 gold、scrap、essence、dust' };
      amount = gmSignedAmount(args[1], 1000000000000);
      if (amount === null) return { ok: false, message: '格式：mat 材料 數量（可為正負整數）' };
      return { ok: true, message: gmAddCurrency(key, amount) };
    }
    if (command === 'nfmat') {
      // 新熔爐材料（js/data.js NEW_FORGE_MATERIALS）；key 不分大小寫，all＝全部材料一起加
      var nfRaw = String(args[0] || '').toLowerCase();
      amount = gmSignedAmount(args[1], 1000000000000);
      if (amount === null) return { ok: false, message: '格式：nfmat 材料key|all 數量（可為正負整數）' };
      if (!G.player.forgeMats) G.player.forgeMats = {};
      var nfKeys = Object.keys(NEW_FORGE_MATERIALS).filter(function (k) {
        return nfRaw === 'all' || k.toLowerCase() === nfRaw;
      });
      if (!nfKeys.length) return { ok: false, message: '未知材料：' + nfRaw + '（可用：all、' + Object.keys(NEW_FORGE_MATERIALS).join('、') + '）' };
      nfKeys.forEach(function (k) {
        G.player.forgeMats[k] = Math.max(0, (Number(G.player.forgeMats[k]) || 0) + amount);
      });
      gmDirty();
      UI.dirty.newforge = true;
      return { ok: true, message: (amount >= 0 ? '增加' : '扣除') + ' 新熔爐材料 ' + (nfRaw === 'all' ? '全部 15 種' : NEW_FORGE_MATERIALS[nfKeys[0]].name) + ' x' + Math.abs(amount).toLocaleString() };
    }
    if (command === 'gem') {
      type = String(args[0] || '').toLowerCase();
      level = gmNumber(args[1], 1, GEM_FORGE_MAX_LEVEL);
      count = gmNumber(args[2], 1, 1000000000);
      if (!GEM_TYPES[type] || level === null || count === null) return { ok: false, message: '格式：gem 寶石key 等級 數量' };
      addGem(type, level, count);
      return { ok: true, message: '增加 ' + gemLabel(type, level) + ' x' + count };
    }
    if (command === 'book') {
      key = String(args[0] || '').toLowerCase();
      count = gmNumber(args[1], 1, 1000000000);
      if (!ENCHANTS[key] || count === null) return { ok: false, message: '格式：book 附魔key 數量' };
      G.player.books[key] = (G.player.books[key] || 0) + count;
      gmDirty();
      return { ok: true, message: '增加 ' + ENCHANTS[key].name + ' x' + count };
    }
    if (command === 'equip' || command === 'equipment') {
      rarity = gmRarity(args[0]);
      level = gmNumber(args[1], 1, 100000);
      slot = String(args[2] || '').toLowerCase();
      count = gmNumber(args[3] || '1', 1, 1000);
      if (rarity === null || level === null || count === null) return { ok: false, message: '格式：equip 稀有度 等級 [部位] [數量]' };
      if (!slot) slot = null;
      return { ok: true, message: gmGiveEquipment(rarity, level, slot, count) };
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
      amount = gmNumber(args[0], 1, 1000000000000);
      if (amount === null) return { ok: false, message: '格式：xp 數量（正整數）' };
      if (typeof gainXp === 'function') gainXp(amount);
      else G.player.xp = (G.player.xp || 0) + amount;
      gmDirty();
      return { ok: true, message: '增加經驗值 x' + amount };
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
    return { ok: false, message: '未知指令：' + command + '（輸入 help 查看文件）' };
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
    gmUi = { panel: panel, input: input, status: status };

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeGM();
        return;
      }
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      if (!input.value.trim()) {
        closeGM();
        return;
      }
      var result = executeGMCommand(input.value);
      setGMStatus(result.message, result.ok);
      if (typeof blog === 'function') blog((result.ok ? '🛠️ GM：' : '⚠️ GM：') + result.message, result.ok ? 'info' : 'warn', 'system');
    });

    document.addEventListener('keydown', function (event) {
      if (!isGMHost()) return;
      if (event.key === 'Escape' && gmUi.panel.style.display !== 'none') {
        event.preventDefault();
        closeGM();
        return;
      }
      if (event.key !== 'Enter' || event.target === input) return;
      var target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      event.preventDefault();
      openGM();
    });
  }

  // 只有初始化入口暴露給 main.js；真正的解析器保留在閉包內，且每次執行仍會再次檢查 hostname。
  if (typeof window !== 'undefined') window.initGM = initGM;
})();
