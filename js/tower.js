'use strict';
/* ============ BOSS 高塔（試煉之塔／地獄之塔／煉獄之塔） ============ */

var TOWER = {
  floor: 0,
  boss: null,        // 戰鬥實體
  player: null,
  elapsed: 0,
  enrageChecked: false,
  enraged: false,
  specialCd: 8,
  dmgDealt: 0,
  bossDmgDealt: 0,
  result: null,       // 結束後的結算資料（顯示用）
  showingResult: false,
  auto: null,         // 連續挑戰 { floor, total, done, wins }；null = 未啟用
  autoNextCd: 0       // 連續挑戰下一場倒數（秒）
};
var TOWER_AUTO_DELAY = 1.0;   // 連續挑戰場與場之間的間隔（秒）
var TOWER_AUTO_RESULT_DELAY = 3.0; // 連續挑戰結果畫面停留秒數
var TOWER_AUTO_MAX = 999;     // 連續挑戰次數上限

function makeBoss(floor) {
  var bd = BOSS_LIST[(floor - 1) % BOSS_LIST.length];
  var bs = bossStatsFor(floor);              // BOSS 數值公式 → formula.js §4
  var b = {
    name: '第' + floor + '層・' + bd.name, emoji: bd.emoji, img: bd.img,
    hell: !!bs.hell,
    purgatory: !!bs.purgatory,
    level: bs.level,
    maxHp: bs.hp, hp: bs.hp,
    atk: bs.atk, def: bs.def, mdef: bs.mdef,
    magic: !!bd.elem,                        // 元素 BOSS 以魔法攻擊（對玩家魔防）
    aspd: bs.aspd, dodge: bs.dodge, hit: bs.hit, // 命中率 = 基礎值 + 樓層×每層值 → formula.js §4
    atkCd: 1.5, effects: {}, ctrlRes: bs.ctrlRes,
    elite: false, isBoss: true, xp: bs.xp,
    elem: bd.elem, attr: bd.attr || bd.elem || null, elemAtk: null, resist: {}, stunCount: 0,
    poisonUntil: 0, poisonDps: 0, shield: 0
  };
  if (bd.elem) {
    b.elemAtk = {};
    ELEMENTS.forEach(function (e) { b.elemAtk[e] = 0; });
    b.elemAtk[bd.elem] = bs.elemAtkVal;
  }
  return b;
}

function startTowerFight(floor) {
  if (G.tower.active) return;
  if (floor < 1 || floor > TOWER_MAX_FLOOR) {
    blog('⚠️ 目前僅開放第 1～' + TOWER_MAX_FLOOR + ' 層高塔。', 'warn');
    return;
  }
  if (floor > G.tower.highest + 1) { blog('⚠️ 需先通過前面的樓層！', 'warn'); return; }
  // 挑戰金幣消耗 = 100000 × 高塔樓層^2.6（towerChallengeCost → formula.js §5）
  var cost = towerChallengeCost(floor);
  if (G.player.gold < cost) {
    blog('⚠️ 金幣不足！挑戰第 ' + floor + ' 層需要 ' + fmt(cost) + ' 金幣（持有 ' + fmt(G.player.gold) + '）。', 'warn');
    return;
  }
  G.player.gold -= cost;
  UI.dirty.header = true;
  blog('💰 支付高塔挑戰費用 ' + fmt(cost) + ' 金幣。', 'info');
  var st = getStats();
  G.tower.active = true;
  TOWER.floor = floor;
  TOWER.boss = makeBoss(floor);
  TOWER.player = newPlayerEntity(st);
  TOWER.player.atkCd = 0.3;
  TOWER.elapsed = 0;
  TOWER.enrageChecked = false;
  TOWER.enraged = false;
  TOWER.specialCd = 8;
  TOWER.dmgDealt = 0;
  TOWER.bossDmgDealt = 0;
  TOWER.result = null;
  TOWER.showingResult = false;
  if (typeof clearTowerFloatLayers === 'function') clearTowerFloatLayers();
  var bossElemName = TOWER.boss.elem && ENCHANTS[TOWER.boss.elem] ? ENCHANTS[TOWER.boss.elem].name : TOWER.boss.elem;
  blog('👹 BOSS資訊：' + TOWER.boss.name + '｜Lv.' + TOWER.boss.level +
    '｜生命 ' + fmt(TOWER.boss.maxHp) + '｜攻擊 ' + fmt(TOWER.boss.atk) +
    '｜物防 ' + fmt(TOWER.boss.def) + '｜魔防 ' + fmt(TOWER.boss.mdef) +
    '｜命中 ' + fmt1(TOWER.boss.hit) + '%｜閃避 ' + fmt1(TOWER.boss.dodge) + '%' +
    (bossElemName ? '｜屬性 ' + bossElemName : '') + '｜控制免疫：暈眩、緩速', 'info', 'boss');
  var towerName = TOWER.boss.purgatory ? '煉獄之塔' : (TOWER.boss.hell ? '地獄之塔' : '試煉之塔');
  blog('🗼 挑戰' + towerName + '第 ' + floor + ' 層：' + TOWER.boss.name + '（限時 60 秒）', 'info');
  UI.dirty.tower = true; UI.dirty.battle = true;
}

/* ---- 連續挑戰 ----
   同一樓層自動重複挑戰 count 場，場與場之間間隔 TOWER_AUTO_DELAY 秒；
   金幣不足或次數用完自動停止並回到野外；戰鬥中按「撤退」立即中止。 */
function startTowerAuto(floor, count) {
  if (G.tower.active) return;
  count = Math.floor(count);
  if (!(count >= 1)) { blog('⚠️ 請先在高塔分頁上方輸入有效的連續挑戰次數（1 以上）', 'warn'); return; }
  if (count > TOWER_AUTO_MAX) count = TOWER_AUTO_MAX;
  TOWER.auto = { floor: floor, total: count, done: 0, wins: 0 };
  TOWER.autoNextCd = 0;
  blog('🔁 開始連續挑戰第 ' + floor + ' 層，共 ' + count + ' 場（戰鬥中按「撤退」可中止）', 'info', 'boss');
  startTowerFight(floor);
  if (!G.tower.active) TOWER.auto = null; // 開場失敗（金幣不足 / 樓層未解鎖）
}

function towerTick(dt) {
  // 連續挑戰：上一場結束後倒數，自動開始下一場
  if (!G.tower.active && TOWER.auto && TOWER.autoNextCd > 0) {
    TOWER.autoNextCd -= dt;
    if (TOWER.autoNextCd <= 0) {
      TOWER.autoNextCd = 0;
      var auto = TOWER.auto;
      startTowerFight(auto.floor);
      if (!G.tower.active) { // 意外無法開場（金幣被其他系統消耗等）
        blog('🔁 無法開始下一場，連續挑戰停止（已挑戰 ' + auto.done + '/' + auto.total + ' 場，勝 ' + auto.wins + '）', 'warn', 'boss');
        TOWER.auto = null;
      }
    }
    return;
  }
  if (!G.tower.active || TOWER.showingResult) return;
  var st = getStats();
  var p = TOWER.player, b = TOWER.boss;
  TOWER.elapsed += dt;

  // 限時判定
  if (TOWER.elapsed >= towerTimeLimitWithTalents()) { endTowerFight(false, 'timeout'); return; }

  // 狂暴判定：40 秒時血量高於門檻（50% + 玩家「狂暴閾值」屬性）則狂暴
  if (!TOWER.enrageChecked && TOWER.elapsed >= TOWER_ENRAGE_TIME) {
    TOWER.enrageChecked = true;
    if (b.hp / b.maxHp * 100 > TOWER_ENRAGE_HP + st.enrageThreshold) {
      TOWER.enraged = true;
      blog('🔥 ' + b.name + ' 進入狂暴狀態！傷害增加 200%！', 'log-enemy-buff');
    }
  }

  // 回復與冷卻（含再生增益）
  p.mp = Math.min(st.mp, p.mp + st.mpRegen * dt);
  var hot = buffVal(p, 'hot');
  if ((st.hpRegen > 0 || hot > 0) && p.hp < st.hp) {
    p.hp = Math.min(st.hp, p.hp + (st.hpRegen + st.hp * hot / 100) * dt);
  }
  tickSkillCds(p, dt);

  // 持續傷害
  if (tickPoison(p, dt) || tickDots(p, dt)) { endTowerFight(false, 'death'); return; }
  if (tickPoison(b, dt) || tickDots(b, dt)) { endTowerFight(true); return; }

  // 玩家行動（減速 -30%；攻速增益加速）
  if (!effectActive(p, 'stun')) {
    var sres = pickAndCastSkill(p, b, 'tb-float');
    if (sres) {
      // 使用攻擊結果的實際輸出，包含護盾吸收與擊殺時超出生命的溢出傷害。
      TOWER.dmgDealt += Math.max(0, (sres.dmg || 0));
      if (sres.killed) { endTowerFight(true); return; }
      if (p.hp <= 0) { endTowerFight(false, 'death'); return; } // 自傷技能
    }
    p.atkCd -= dt * slowFactor(p) * (1 + buffVal(p, 'aspdUp') / 100);
    if (p.atkCd <= 0) {
      var res = doPlayerAttack(p, b, 'tb-float');
      TOWER.dmgDealt += Math.max(0, (res.dmg || 0));
      p.atkCd += 1 / st.aspd;
      if (res.killed) { endTowerFight(true); return; }
    }
  }

  // BOSS 攻擊（死亡的 BOSS 不得再行動）
  if (b.hp <= 0) { endTowerFight(true); return; }
  if (!effectActive(b, 'stun')) {
    var mult = TOWER.enraged ? TOWER_ENRAGE_MULT : 1;
    b.atkCd -= dt * slowFactor(b);
    if (b.atkCd <= 0) {
      var bossHit = doMonsterAttack(b, p, 'tp-float', mult);
      // 使用攻擊結果的實際輸出，包含護盾吸收與擊殺時超出生命的溢出傷害。
      TOWER.bossDmgDealt += Math.max(0, (bossHit.dmg || 0));
      b.atkCd += 1 / b.aspd;
      if (p.hp <= 0) { endTowerFight(false, 'death'); return; }
      if (b.hp <= 0) { endTowerFight(true); return; } // 反震擊殺
    }
    // 特殊技：每 8 秒重擊
    TOWER.specialCd -= dt;
    if (TOWER.specialCd <= 0 && p.hp > 0) {
      TOWER.specialCd = 8;
      var bossSpecialHit = doMonsterAttack(b, p, 'tp-float', 2.2 * mult, '蓄力重擊');
      TOWER.bossDmgDealt += Math.max(0, (bossSpecialHit.dmg || 0));
      if (p.hp <= 0) { endTowerFight(false, 'death'); return; }
      if (b.hp <= 0) { endTowerFight(true); return; }
    }
  }
}

/* ---- 結算與失敗分析 ---- */
function endTowerFight(win, reason) {
  var b = TOWER.boss;
  var floor = TOWER.floor;
  var hpPct = b ? (b.hp / b.maxHp * 100) : 0;
  var myDps = TOWER.elapsed > 0.5 ? TOWER.dmgDealt / TOWER.elapsed : 0;
  var needDps = b ? b.maxHp / towerTimeLimitWithTalents() : 0;
  TOWER.showingResult = true;
  if (window.recordLootBattle) window.recordLootBattle('tower'); // 每次高塔挑戰算一場戰鬥
  if (win && window.recordLootKill) window.recordLootKill(undefined, 'tower'); // 擊敗 BOSS 計入殺敵數
  if (!win && window.recordLootDeath) window.recordLootDeath('tower');

  var result = {
    win: win, floor: floor, reason: reason || null,
    bossHpPct: Math.round(hpPct), myDps: myDps, needDps: needDps,
    enraged: TOWER.enraged, analysis: [], rewards: []
  };

  if (win) {
    var firstClear = floor > G.tower.highest;
    if (firstClear) G.tower.highest = floor;
    blog('🏆 通關高塔第 ' + floor + ' 層！', 'good');
    // 獎勵：自動機組零件 + 資源（獎勵公式 towerRewardFor → formula.js §5）
    var rw = towerRewardFor(floor, firstClear);
    var st2 = getStats();
    var xpGain = Math.round((b.xp || 0) * (1 + st2.xpBonus / 100));
    gainXp(xpGain);
    UI.dirty.header = true;
    result.rewards.push('✨ 經驗 x' + fmt(xpGain));
    var soulOriginRate = hellSoulOriginDropChance(floor);
    if (soulOriginRate > 0 && chance(soulOriginRate)) {
      G.player.soulOrigin = (G.player.soulOrigin || 0) + 1;
      if (window.recordLootMat) window.recordLootMat('soulOrigin', 1, 'tower');
      result.rewards.push('🧿 魔魂本源 x1');
      UI.dirty.header = true;
    }
    if (chance(rw.partChance)) {
      var part = makePart(rw.partTier);
      if (part) {
        G.factory.parts.push(part);
        if (window.recordLootMat) window.recordLootMat('part', 1, 'tower');
        trimFactoryParts(); // 收斂零件庫存，防無限成長
        result.rewards.push(PART_TYPES[part.key].emoji + ' ' + part.name + '（' + partDesc(part) + '）');
        flog('🔩 獲得自動機組零件：' + part.name, 'good');
      }
    }
    // 裝備戰利品：依「BOSS 掉落表」各品質獨立擲骰（>100% 必掉 + 餘數機率）
    var bossRates = dropRatesFor(BOSS_DROP_TABLE, floor);
    var bossMult = 1 + st2.loot / 100;
    var lootCounts = [];
    for (var br = 0; br < bossRates.length; br++) {
      if (!bossRates[br]) continue;
      var bn = rollDropCount(bossRates[br] * bossMult);
      if (!bn) continue;
      for (var bk2 = 0; bk2 < bn; bk2++) {
        pushConveyor(makeEquipment(rw.itemLevel, {
          rarity: br,
          level: rw.itemLevel,
          ancientRate: ancientBossAffixChanceForBoss(floor)
        }));
      }
      if (window.recordLootEquip) window.recordLootEquip(br, bn, 'tower');
      lootCounts.push('&nbsp;&nbsp;<span style="color:' + RARITIES[br].color + '">' + RARITIES[br].name + '裝備*' + bn + '</span>');
    }
    if (lootCounts.length) {
      result.rewards.push('⚔️ 裝備戰利品（已送入生產線）：');
      for (var i = 0; i < lootCounts.length; i++) {
        result.rewards.push(lootCounts[i]);
      }
    }
    G.player.gold += rw.gold;
    if (window.recordLootGold) window.recordLootGold(rw.gold, 'tower');
    result.rewards.push('💰 金幣 x' + fmt(rw.gold));
    var gt1 = randomGemType(), gt2 = randomGemType();
    addGem(gt1, rw.gemLevel, 1); addGem(gt2, rw.gemLevel, 1);
    if (window.recordLootGem) {
      window.recordLootGem(gt1, rw.gemLevel, 1, 'tower');
      window.recordLootGem(gt2, rw.gemLevel, 1, 'tower');
    }
    result.rewards.push('💎 ' + gemLabel(gt1, rw.gemLevel) + '、' + gemLabel(gt2, rw.gemLevel));
    var bk = pick(Object.keys(ENCHANTS));
    G.player.books[bk] += 2;
    if (window.recordLootMat) window.recordLootMat('book', 2, 'tower');
    result.rewards.push('📖 ' + ENCHANTS[bk].name + '書 x2');
    G.player.essence += rw.essence;
    if (window.recordLootMat) window.recordLootMat('essence', rw.essence, 'tower');
    result.rewards.push('🔮 附魔精華 x' + rw.essence);
    // 太古精華（40 層以上；獨立機率，不受掉寶率影響）
    var ancientEssenceRate = ancientEssenceDropChanceForBoss(floor);
    if (ancientEssenceRate > 0 && chance(ancientEssenceRate)) {
      G.player.ancientEssence = (G.player.ancientEssence || 0) + 1;
      if (window.recordLootMat) window.recordLootMat('ancientEssence', 1, 'tower');
      result.rewards.push('<img src="images/icon_ancient_essence.png" class="res-icon" alt="太古精華"> 太古精華 x1');
      UI.dirty.header = true;
    }
    // 魔塵（神鑄材料）：掉落率 = min(30%, 2% + 樓層 × 0.2%)（bossDustRate → formula.js §5）
    if (chance(bossDustRate(floor))) {
      G.player.dust = (G.player.dust || 0) + 1;
      if (window.recordLootMat) window.recordLootMat('dust', 1, 'tower');
      result.rewards.push('💫 魔塵 x1（神鑄材料）');
      UI.dirty.forge = true;
    }

    blog('🎁 高塔通關獎勵：' + result.rewards.join('、'), 'good', 'boss');
  } else if (reason === 'flee') {
    blog('🏃 你撤出了高塔挑戰。', 'warn');
    result.analysis.push('已撤退。可隨時再次挑戰。');
  } else {
    blog('💀 高塔挑戰失敗（第 ' + floor + ' 層）', 'bad');
    // 失敗分析系統
    if (reason === 'death') {
      result.analysis.push('【生存過低】你在 ' + Math.round(TOWER.elapsed) + ' 秒時被擊倒。建議提升生命值 / 防禦力詞條、吸血，或附魔對應抗性。');
      if (b && b.elem) result.analysis.push('此 BOSS 帶有' + ENCHANTS[b.elem === 'fire' ? 'fireRes' : (b.elem === 'ice' ? 'iceRes' : 'ctrlRes')].name.slice(0, 2) + '屬性攻擊，可在防具上附魔對應抗性。');
      if (TOWER.enraged) result.analysis.push('BOSS 已狂暴（傷害 +200%）。若能在 40 秒前將其血量壓到 50% 以下，即可避免狂暴。');
    } else {
      if (hpPct > 50) {
        result.analysis.push('【傷害不足】60 秒僅造成 ' + Math.round(100 - hpPct) + '% 傷害。你的 DPS 為 ' + fmt(myDps) + '，需要約 ' + fmt(needDps) + '。建議提升攻擊力 / 爆擊詞條，或用生產線合成攻擊附魔裝備。');
      } else {
        result.analysis.push('【輸出略缺】只差 ' + Math.round(hpPct) + '% 就能擊倒 BOSS！建議微調攻速 / 爆擊傷害詞條，或強化現有裝備。');
      }
      if (TOWER.enraged) result.analysis.push('BOSS 於 40 秒時血量仍高於 50%，觸發狂暴。優先堆疊前期爆發輸出可避免。');
      result.analysis.push('提示：調整生產線篩選與合成配比，讓更強的裝備自動換上。');
    }
    result.analysis.forEach(function (a) { blog('📋 ' + a, 'warn'); });
  }

  TOWER.result = result;

  // 連續挑戰：不彈結算視窗，自動接續下一場；撤退 / 次數用完 / 金幣不足則停止並回到野外
  if (TOWER.auto) {
    var auto = TOWER.auto;
    auto.done++;
    if (win) auto.wins++;
    result.autoTotal = auto.total;
    result.autoDone = auto.done;
    result.autoWins = auto.wins;
    result.autoLosses = auto.done - auto.wins;
    result.autoCountdown = reason !== 'flee';
    result.autoContinue = false;
    var tail = '共挑戰 ' + auto.done + '/' + auto.total + ' 場，勝 ' + auto.wins + ' 敗 ' + (auto.done - auto.wins);
    if (reason === 'flee') {
      blog('🔁 已中止連續挑戰第 ' + auto.floor + ' 層：' + tail + '，回到野外繼續戰鬥。', 'warn', 'boss');
      TOWER.auto = null;
    } else if (auto.done >= auto.total) {
      blog('🔁 連續挑戰第 ' + auto.floor + ' 層結束：' + tail + '，回到野外繼續戰鬥。', 'good', 'boss');
      TOWER.auto = null;
    } else if (G.player.gold < towerChallengeCost(auto.floor)) {
      blog('🔁 金幣不足（下一場需 ' + fmt(towerChallengeCost(auto.floor)) + '），連續挑戰自動停止：' + tail + '，回到野外繼續戰鬥。', 'warn', 'boss');
      TOWER.auto = null;
    } else {
      result.autoContinue = true;
    }
    if (typeof showTowerResultModal === 'function') {
      showTowerResultModal(result, TOWER.player, TOWER.boss, TOWER.dmgDealt, TOWER.bossDmgDealt, {
        autoCountdown: result.autoCountdown,
        countdown: TOWER_AUTO_RESULT_DELAY
      });
    } else {
      confirmTowerResult();
    }
    return;
  }

  if (typeof showTowerResultModal === 'function') {
    showTowerResultModal(result, TOWER.player, TOWER.boss, TOWER.dmgDealt, TOWER.bossDmgDealt);
  }
}

function confirmTowerResult() {
  var result = TOWER.result;
  var auto = TOWER.auto;
  var shouldStartNext = !!(result && result.autoContinue && auto);
  finishTowerFight();
  if (!shouldStartNext) return;
  startTowerFight(auto.floor);
  if (!G.tower.active) {
    blog('⚠️ 連續挑戰下一場啟動失敗，已停止。', 'warn', 'boss');
    TOWER.auto = null;
  }
}

function stopTowerAutoFromResult() {
  if (TOWER.result) {
    TOWER.result.autoContinue = false;
    TOWER.result.autoCountdown = false;
  }
  if (TOWER.auto) blog('⏹ 已終止連續挑戰，本場結果保留，確認後返回野外。', 'warn', 'boss');
  TOWER.auto = null;
  TOWER.autoNextCd = 0;
}

function finishTowerFight() {
  TOWER.showingResult = false;
  G.tower.active = false;
  TOWER.boss = null;
  TOWER.player = null;
  // 野外重生
  if (FIELD.player) FIELD.player.hp = getStats().hp;
  FIELD.monster = null; FIELD.monsters = []; FIELD._waveClearPending = false; FIELD.respawnCd = 0.5;
  UI.dirty.tower = true; UI.dirty.battle = true; UI.dirty.header = true; UI.dirty.factory = true;
}

function fleeTower() {
  if (!G.tower.active) return;
  endTowerFight(false, 'flee');
}
