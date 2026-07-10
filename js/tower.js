'use strict';
/* ============ BOSS 高塔（試煉之塔） ============ */

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
  showingResult: false
};

function makeBoss(floor) {
  var bd = BOSS_LIST[(floor - 1) % BOSS_LIST.length];
  var bs = bossStatsFor(floor);              // BOSS 數值公式 → formula.js §4
  var b = {
    name: '第' + floor + '層・' + bd.name, emoji: bd.emoji, img: bd.img,
    level: bs.level,
    maxHp: bs.hp, hp: bs.hp,
    atk: bs.atk, def: bs.def, mdef: bs.mdef,
    magic: !!bd.elem,                        // 元素 BOSS 以魔法攻擊（對玩家魔防）
    aspd: bs.aspd, dodge: bs.dodge,
    atkCd: 1.5, effects: {}, ctrlRes: bs.ctrlRes,
    elite: false, isBoss: true,
    elem: bd.elem, elemAtk: null, resist: {}, stunCount: 0,
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
  if (floor > G.tower.highest + 1) { blog('⚠️ 需先通過前面的樓層！', 'warn'); return; }
  // 挑戰金幣消耗 = 100000 + BOSS等級 × 200000（towerChallengeCost → formula.js §5）
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
  blog('🗼 挑戰高塔第 ' + floor + ' 層：' + TOWER.boss.name + '（限時 60 秒）', 'info');
  UI.dirty.tower = true; UI.dirty.battle = true;
}

function towerTick(dt) {
  if (!G.tower.active || TOWER.showingResult) return;
  var st = getStats();
  var p = TOWER.player, b = TOWER.boss;
  TOWER.elapsed += dt;

  // 限時判定
  if (TOWER.elapsed >= TOWER_TIME_LIMIT) { endTowerFight(false, 'timeout'); return; }

  // 狂暴判定：40 秒時血量高於門檻（50% + 玩家「狂暴閾值」屬性）則狂暴
  if (!TOWER.enrageChecked && TOWER.elapsed >= TOWER_ENRAGE_TIME) {
    TOWER.enrageChecked = true;
    if (b.hp / b.maxHp * 100 > TOWER_ENRAGE_HP + st.enrageThreshold) {
      TOWER.enraged = true;
      blog('🔥 ' + b.name + ' 進入狂暴狀態！傷害增加 200%！', 'bad');
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
    var before0 = b.hp;
    var sres = pickAndCastSkill(p, b, 'tb-float');
    if (sres) {
      TOWER.dmgDealt += (before0 - b.hp);
      if (sres.killed) { endTowerFight(true); return; }
      if (p.hp <= 0) { endTowerFight(false, 'death'); return; } // 自傷技能
    }
    p.atkCd -= dt * slowFactor(p) * (1 + buffVal(p, 'aspdUp') / 100);
    if (p.atkCd <= 0) {
      var before = b.hp;
      var res = doPlayerAttack(p, b, 'tb-float');
      TOWER.dmgDealt += (before - b.hp);
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
      var beforeHp = p.hp;
      doMonsterAttack(b, p, 'tp-float', mult);
      // 不朽觸發時血量回升，避免統計被倒扣為負
      TOWER.bossDmgDealt += Math.max(0, beforeHp - p.hp);
      b.atkCd += 1 / b.aspd;
      if (p.hp <= 0) { endTowerFight(false, 'death'); return; }
      if (b.hp <= 0) { endTowerFight(true); return; } // 反震擊殺
    }
    // 特殊技：每 8 秒重擊
    TOWER.specialCd -= dt;
    if (TOWER.specialCd <= 0 && p.hp > 0) {
      TOWER.specialCd = 8;
      blog('💢 ' + b.name + ' 蓄力重擊！', 'warn');
      var beforeHp2 = p.hp;
      doMonsterAttack(b, p, 'tp-float', 2.2 * mult);
      TOWER.bossDmgDealt += Math.max(0, beforeHp2 - p.hp);
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
  var needDps = b ? b.maxHp / TOWER_TIME_LIMIT : 0;
  TOWER.showingResult = true;

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
    if (chance(rw.partChance)) {
      var part = makePart(rw.partTier);
      G.factory.parts.push(part);
      trimFactoryParts(); // 收斂零件庫存，防無限成長
      result.rewards.push(PART_TYPES[part.key].emoji + ' ' + part.name + '（' + partDesc(part) + '）');
      flog('🔩 獲得自動機組零件：' + part.name, 'good');
    }
    // 裝備戰利品：依「BOSS 掉落表」各品質獨立擲骰（>100% 必掉 + 餘數機率）
    var st2 = getStats();
    var bossRates = dropRatesFor(BOSS_DROP_TABLE, floor);
    var bossMult = 1 + st2.loot / 100;
    var lootCounts = [];
    for (var br = 0; br < bossRates.length; br++) {
      if (!bossRates[br]) continue;
      var bn = rollDropCount(bossRates[br] * bossMult);
      if (!bn) continue;
      for (var bk2 = 0; bk2 < bn; bk2++) {
        pushConveyor(makeEquipment(rw.itemLevel, { rarity: br, level: rw.itemLevel }));
      }
      lootCounts.push('&nbsp;&nbsp;<span style="color:' + RARITIES[br].color + '">' + RARITIES[br].name + '裝備*' + bn + '</span>');
    }
    if (lootCounts.length) {
      result.rewards.push('⚔️ 裝備戰利品（已送入生產線）：');
      for (var i = 0; i < lootCounts.length; i++) {
        result.rewards.push(lootCounts[i]);
      }
    }
    G.player.gold += rw.gold;
    result.rewards.push('💰 金幣 x' + fmt(rw.gold));
    var gt1 = randomGemType(), gt2 = randomGemType();
    addGem(gt1, rw.gemLevel, 1); addGem(gt2, rw.gemLevel, 1);
    result.rewards.push('💎 ' + gemLabel(gt1, rw.gemLevel) + '、' + gemLabel(gt2, rw.gemLevel));
    var bk = pick(Object.keys(ENCHANTS));
    G.player.books[bk] += 2;
    result.rewards.push('📖 ' + ENCHANTS[bk].name + '書 x2');
    G.player.essence += rw.essence;
    result.rewards.push('🔮 附魔精華 x' + rw.essence);
    // 魔塵（神鑄材料）：掉落率 = min(15%, 2% + BOSS等級 × 0.2%)（bossDustRate → formula.js §5）
    if (b && chance(bossDustRate(b.level))) {
      G.player.dust = (G.player.dust || 0) + 1;
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
  
  if (typeof showTowerResultModal === 'function') {
    showTowerResultModal(result, TOWER.player, TOWER.boss, TOWER.dmgDealt, TOWER.bossDmgDealt);
  }
}

function finishTowerFight() {
  TOWER.showingResult = false;
  G.tower.active = false;
  TOWER.boss = null;
  TOWER.player = null;
  // 野外重生
  if (FIELD.player) FIELD.player.hp = getStats().hp;
  FIELD.monster = null; FIELD.respawnCd = 0.5;
  UI.dirty.tower = true; UI.dirty.battle = true; UI.dirty.header = true; UI.dirty.factory = true;
}

function fleeTower() {
  if (!G.tower.active) return;
  endTowerFight(false, 'flee');
}
