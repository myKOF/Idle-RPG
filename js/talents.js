'use strict';
/* ============ 天堂威能與潛力：共用轉生威能點 ============ */

/* 升到目標等級的單級成本 = 目標等級。 */
function talentUpgradeCost(id, targetLv) {
  return clamp(Math.floor(Number(targetLv) || 0), 0, TALENT_MAX_LEVEL);
}

/* 升到 Lv.lv 的累計天賦點成本（清除退點與已投入點數計算用） */
function talentTotalCost(id, lv) {
  lv = clamp(Math.floor(Number(lv) || 0), 0, TALENT_MAX_LEVEL);
  return lv * (lv + 1) / 2;
}

/* 天賦節點清單（轉數 + 定義）。內容只由 TALENT_TREES 與 TALENT_IMPLEMENTED_REINCARNATIONS
   決定，兩者都是 js/data.js 的靜態設定表（參數表是改寫 data.js 後整頁重載，
   見 js/param_autoreload.js:52，沒有執行期改寫路徑），所以整份清單建一次就好。

   為什麼要快取：talentStatBonuses 每次 computeStats 都會呼叫它，而 talentDef /
   talentTurn 還會各自再建一份再 filter 一次。實測 headless 模擬器裡光是天賦查找
   就佔總 CPU 的 17%——評估器每次規劃要跑約 47 次 computeStats，每一次都把
   80 個節點的清單重建一遍。

   ⚠️ 回傳的是同一個陣列，呼叫端不得就地改它（現行 8 個呼叫點都是 forEach/filter/map）。 */
var _TALENT_LIST_CACHE = null;
function talentList() {
  if (_TALENT_LIST_CACHE) return _TALENT_LIST_CACHE;
  var list = [];
  for (var turn = 1; turn <= TALENT_IMPLEMENTED_REINCARNATIONS; turn++) {
    (TALENT_TREES[turn] || []).forEach(function (def) {
      list.push({ turn: turn, def: def });
    });
  }
  _TALENT_LIST_CACHE = list;
  return list;
}

function talentDef(id) {
  var found = talentList().filter(function (entry) { return entry.def.id === id; })[0];
  return found ? found.def : null;
}

function talentTurn(id) {
  var found = talentList().filter(function (entry) { return entry.def.id === id; })[0];
  return found ? found.turn : 0;
}

function potentialDef(id) {
  for (var i = 0; i < POTENTIAL_TALENTS.length; i++) {
    if (POTENTIAL_TALENTS[i].id === id) return POTENTIAL_TALENTS[i];
  }
  return null;
}

function talentState() {
  if (!G.player.talents || typeof G.player.talents !== 'object') G.player.talents = {};
  if (!G.player.talents.levels || typeof G.player.talents.levels !== 'object') G.player.talents.levels = {};
  if (!G.player.talents.potentialLevels || typeof G.player.talents.potentialLevels !== 'object') G.player.talents.potentialLevels = {};
  return G.player.talents;
}

/* 等級取用的唯一一份規則。拆成「吃 levels 表」的版本，是為了讓每次
   computeStats 只取一次 talentState()——talentStatBonuses 一輪要查約 160 次等級，
   每次都走 talentState() 的初始化檢查是白付的。規則本身仍然只有這一份。 */
function talentLevelIn(levels, id) {
  return clamp(Math.floor(Number(levels ? levels[id] : 0) || 0), 0, TALENT_MAX_LEVEL);
}

function talentLevel(id) {
  return talentLevelIn(talentState().levels, id);
}

function potentialLevel(id) {
  var max = potentialSkillMaxLv(id);
  var v = talentState().potentialLevels[id];
  return clamp(Math.floor(Number(v) || 0), 0, max);
}

function reincarnationCountSafe() {
  return typeof reincarnationCount === 'function' ? reincarnationCount() : Math.max(0, Math.floor(Number(G.player.reincarnations) || 0));
}

function talentUnlocked(id) {
  var turn = talentTurn(id);
  return turn > 0 && turn <= TALENT_IMPLEMENTED_REINCARNATIONS && reincarnationCountSafe() >= turn;
}

function talentSystemUnlocked() {
  return reincarnationCountSafe() >= 1;
}

function talentLevelValue(def, lv) {
  if (!def) return 0;
  lv = clamp(Math.floor(Number(lv) || 0), 0, TALENT_MAX_LEVEL);
  return lv * (Number(def.per) || 0);
}

/* 首次點亮只計一次威脅；純讀取，UI 可以傳入 Worker 的 levels 快照。 */
function talentThreatTotal(levels) {
  var source = levels || (typeof G !== 'undefined' && G && G.player && G.player.talents && G.player.talents.levels) || {};
  return talentList().reduce(function (sum, entry) {
    return sum + (!entry.def.disabled && talentLevelIn(source, entry.def.id) > 0 ? Math.max(0, Number(entry.def.threat) || 0) : 0);
  }, 0);
}

function monsterPowerLevelBonus() {
  return Math.floor(talentThreatTotal() / 10);
}

/* ONE-TIME MIGRATION powerThreatV1：在新上限夾限前，按舊制退還投入。 */
function migratePowerSave(data) {
  if (data.powerThreatV1) return;
  var p = data.player;
  var state = p.talents || { levels: {}, potentialLevels: {} };
  var refund = 0, goldRefund = 0;
  talentList().forEach(function (entry) {
    var lv = clamp(Math.floor(Number((state.levels || {})[entry.def.id]) || 0), 0, 100);
    refund += (Math.min(lv, 50) + Math.max(0, lv - 50) * 2) * (entry.turn + 9);
  });
  var oldMax = skillMaxLvForRc(p.reincarnations || 0);
  POTENTIAL_TALENTS.forEach(function (def) {
    var lv = clamp(Math.floor(Number((state.potentialLevels || {})[def.id]) || 0), 0, oldMax);
    for (var i = 0; i < lv; i++) goldRefund += skillUpgradeCost(i);
  });
  p.reincarnationTalentPoints = Math.max(0, Number(p.reincarnationTalentPoints) || 0) + refund;
  p.gold = Math.max(0, Number(p.gold) || 0) + goldRefund;
  p.talents = { levels: {}, potentialLevels: {} };
  p.loadout = (p.loadout || []).filter(function (ref) { return typeof ref !== 'string' || ref.indexOf('potential:') !== 0; });
  data.powerThreatV1 = true;
  if (refund || goldRefund) {
    data._talentRespecNotice = '威能改造：已退還 ' + refund + ' 點威能點與 ' + goldRefund + ' 金幣，舊威能與潛力已重置';
    data._talentRespecConfirm = true;
  }
}

/* levels 可省略（省略＝當場取）。傳進來是給 talentStatBonuses 用的：
   它一輪要問 10 個轉數，每個都重取一次 levels 表沒有意義。 */
function talentTreeComplete(turn, levels) {
  var tree = (TALENT_TREES[turn] || []).filter(function (def) { return !def.disabled; });
  // 節點數不再寫死 8：5/6/8/9 轉在 2026-08-07 各補了一個地屬性節點而成為 9 個。
  // 這個判斷只是「這一轉有節點、且全部滿級」，節點數量本身不該是條件。
  if (!tree.length) return false;
  var lv = levels || talentState().levels;
  for (var i = 0; i < tree.length; i++) {
    if (talentLevelIn(lv, tree[i].id) < TALENT_MAX_LEVEL) return false;
  }
  return true;
}

function talentCompleteMultiplier(turn, levels) {
  return talentTreeComplete(turn, levels) ? 2 : 1;
}

function potentialUnlockedCount() {
  return POTENTIAL_TALENTS.filter(function (def) {
    return !potentialTemporarilyDisabled(def.id);
  }).length;
}

function potentialTemporarilyDisabled(id) {
  var def = potentialDef(id);
  return !!(def && def.disabled);
}

function potentialUnlockLimit() {
  return POTENTIAL_TALENTS.length;
}

function talentSkillPointBonus() {
  return 0;
}

function potentialUnlocked(id) {
  if (typeof GM_TEST !== 'undefined' && GM_TEST && GM_TEST.skillUnlock) return true;
  var idx = POTENTIAL_TALENTS.map(function (def) { return def.id; }).indexOf(id);
  return idx >= 0 && idx < potentialUnlockLimit() && !potentialTemporarilyDisabled(id);
}

/* 潛力與威能共用等級上限。 */
function potentialSkillMaxLv() {
  return TALENT_MAX_LEVEL;
}

/* 潛力技能當前生效數值 = base + per × 等級（等級已夾在 0~上限；不再另設數值上限）。 */
function potentialSkillValue(idOrDef, lvArg) {
  var def = (idOrDef && typeof idOrDef === 'object') ? idOrDef : potentialDef(idOrDef);
  if (!def) return 0;
  var lv = (lvArg === undefined) ? potentialLevel(def.id) : clamp(Math.floor(Number(lvArg) || 0), 0, potentialSkillMaxLv());
  return (Number(def.base) || 0) + (Number(def.per) || 0) * lv;
}

/* 潛力技能是否已學會且已解鎖（供戰鬥模組與 computeStats 判定被動效果生效）。 */
function potentialSkillActive(id) {
  return potentialLevel(id) > 0 && potentialUnlocked(id) && !potentialTemporarilyDisabled(id);
}

/* GM 直接切換轉生次數時沒有完整的歷史升級紀錄，
   以前置轉生都已升到可轉生等級、目前轉生依目前等級計算，重建可用天賦點。 */
function resetTalentsForReincarnationGM(count) {
  var state = talentState();
  talentList().forEach(function (entry) { state.levels[entry.def.id] = 0; });
  POTENTIAL_TALENTS.forEach(function (def) { state.potentialLevels[def.id] = 0; });

  var turns = Math.max(0, Math.floor(Number(count) || 0));
  var reincarnationLevel = Math.max(1, Math.floor(Number(REINCARNATION_LEVEL) || 1));
  var currentLevel = clamp(Math.floor(Number(G.player.level) || 1), 1, reincarnationLevel);
  var completedTurnPoints = Math.max(0, turns - 1) * Math.max(0, reincarnationLevel - 1);
  var currentTurnPoints = turns > 0 ? currentLevel - 1 : 0;
  G.player.reincarnationTalentPoints = completedTurnPoints + currentTurnPoints;
  talentRefresh();
}

function talentSpentPoints() {
  var spent = 0;
  talentList().forEach(function (entry) {
    spent += talentTotalCost(entry.def.id, talentLevel(entry.def.id));
  });
  POTENTIAL_TALENTS.forEach(function (def) { spent += talentTotalCost(def.id, potentialLevel(def.id)); });
  return spent;
}

function potentialSpentSkillPoints() {
  return 0;
}

/* ⚠️ 這份範本同時是「白名單」：talentStatBonuses 只累加 out[stat] !== undefined 的欄位，
   所以漏一個鍵＝那個天賦節點點了也沒有效果，而且不會噴任何錯。
   元素三族（elemX / dmgVsX / resVsX）因此改由 ELEMENTS 生成，新增屬性時不必回頭補這裡。 */
function talentBonusesTemplate() {
  var t = {
    strPct: 0, agiPct: 0, intPct: 0, vitPct: 0, defPct: 0, mdefPct: 0,
    pRes: 0, mRes: 0, elemRes: 0, globalDmgRed: 0, critRate: 0,
    critDmg: 0, evasion: 0, hit: 0, hpPct: 0, shieldEff: 0, normalDmg: 0,
    eliteDmg: 0, bossDmg: 0, normalDmgRed: 0, eliteDmgRed: 0, bossDmgRed: 0,
    patkPct: 0, matkPct: 0, totalDmgPct: 0, gemEff: 0, skillPhys: 0,
    skillMagic: 0, skillDef: 0, skillSpecial: 0, skillPassive: 0
  };
  for (var i = 0; i < ELEMENTS.length; i++) {
    var suffix = ELEMENTS[i].charAt(0).toUpperCase() + ELEMENTS[i].slice(1);
    t['elem' + suffix] = 0;
    t['dmgVs' + suffix] = 0;
    t['resVs' + suffix] = 0;
  }
  return t;
}

/* ⚠️ 這一支在 computeStats 裡，而 computeStats 是全遊戲最熱的路徑
   （每次屬性刷新、模擬器的每個評估探針各一次）。所以三件事都提到迴圈外：
   levels 表取一次、節點清單取一次、每一轉的「全滿倍率」算一次。

   改造前每個節點都各自呼叫一次 talentCompleteMultiplier，而它內部要查 8 個節點的
   等級——80 個節點就是 640 次等級查找，其中 632 次是重複的。
   輸出逐欄相同（tests/talents-perf-equivalence 以整份 bonuses 與 getStats 反證）。 */
function talentStatBonuses() {
  var out = talentBonusesTemplate();
  var levels = talentState().levels;
  var list = talentList();
  var multByTurn = {};
  for (var i = 0; i < list.length; i++) {
    var turn = list[i].turn;
    if (multByTurn[turn] === undefined) multByTurn[turn] = talentCompleteMultiplier(turn, levels);
  }
  for (var j = 0; j < list.length; j++) {
    var def = list[j].def;
    var value = def.disabled ? 0 : talentLevelValue(def, talentLevelIn(levels, def.id)) * multByTurn[list[j].turn];
    if (def.stat !== 'potentialUnlock' && out[def.stat] !== undefined) out[def.stat] += value;
  }
  // 潛力技能 V3 不再透過 talentStatBonuses 提供被動數值；
  // 其被動效果（極速之力攻速／混沌雙修）於 computeStats 直接併入，主動效果由 js/potential.js 於戰鬥中施放。
  return out;
}

function talentRefresh() {
  refreshMonsterPower();
  if (typeof markStatsDirty === 'function') markStatsDirty();
  if (typeof UI !== 'undefined' && UI.dirty) {
    UI.dirty.header = true; UI.dirty.talents = true; UI.dirty.skills = true; UI.dirty.battle = true; UI.dirty.tower = true;
  }
}

/* 配點時同步已在場敵人的強度；保持血量比例、階級、站位與戰鬥進度。 */
function refreshMonsterPower() {
  var bonus = monsterPowerLevelBonus();
  var enemies = typeof fieldEnemyList === 'function' ? fieldEnemyList() : [];
  if (typeof TOWER !== 'undefined' && TOWER.boss) enemies = enemies.concat([TOWER.boss]);
  enemies.forEach(function (enemy) {
    if (!enemy || enemy.hp <= 0 || enemy._powerLevelBonus === bonus) return;
    var oldBonus = Number(enemy._powerLevelBonus) || 0;
    var before, after;
    if (enemy.towerBoss) {
      before = bossStatsFor(TOWER.floor, oldBonus);
      after = bossStatsFor(TOWER.floor, bonus);
    } else if (enemy._stage) {
      before = monsterStatsFor(enemy._stage, false, false, oldBonus);
      after = monsterStatsFor(enemy._stage, false, false, bonus);
    } else return;
    var hpRatio = enemy.hp / enemy.maxHp;
    enemy.maxHp *= after.hp / before.hp;
    enemy.hp = enemy.maxHp * hpRatio;
    ['atk', 'def', 'mdef'].forEach(function (key) { enemy[key] *= after[key] / before[key]; });
    if (enemy.towerBoss && enemy.elemAtk && enemy.elem) enemy.elemAtk[enemy.elem] *= after.elemAtkVal / before.elemAtkVal;
    enemy.hit += after.hit - before.hit;
    enemy.dodge += after.dodge - before.dodge;
    enemy.level += bonus - oldBonus;
    enemy._powerLevelBonus = bonus;
  });
}

function talentUpgrade(id) {
  var def = talentDef(id);
  if (!def) return '找不到威能';
  if (def.disabled) return def.disabledReason || '此威能目前暫不開放升級';
  if (!talentUnlocked(id)) return reincarnationCountSafe() < talentTurn(id) ? '尚未達到 ' + talentTurn(id) + ' 轉' : '此威能尚未開放';
  var lv = talentLevel(id);
  if (lv >= TALENT_MAX_LEVEL) return '已達最高等級';
  var cost = talentUpgradeCost(id, lv + 1);
  if ((G.player.reincarnationTalentPoints || 0) < cost) return '轉生威能點不足，需要 ' + cost + ' 點';
  G.player.reincarnationTalentPoints -= cost;
  talentState().levels[id] = lv + 1;
  talentRefresh();
  return null;
}

function talentMax(id) {
  var start = talentLevel(id), changed = false;
  while (talentLevel(id) < TALENT_MAX_LEVEL && talentUpgrade(id) === null) changed = true;
  if (changed) return null;
  return start >= TALENT_MAX_LEVEL ? '已達最高等級' : '轉生威能點不足';
}

function talentDowngrade(id) {
  var def = talentDef(id);
  if (!def) return '找不到威能';
  var lv = talentLevel(id);
  if (!lv) return '威能目前是 0 級';
  talentState().levels[id] = lv - 1;
  G.player.reincarnationTalentPoints = (G.player.reincarnationTalentPoints || 0) + talentUpgradeCost(id, lv);
  talentRefresh();
  return null;
}

function talentDelete(id) {
  var def = talentDef(id);
  if (!def) return '找不到威能';
  var lv = talentLevel(id);
  talentState().levels[id] = 0;
  G.player.reincarnationTalentPoints = (G.player.reincarnationTalentPoints || 0) + talentTotalCost(id, lv);
  talentRefresh();
  return null;
}

function potentialUpgrade(id) {
  var def = potentialDef(id);
  if (!def) return '找不到潛力技能';
  if (potentialTemporarilyDisabled(id)) return '此潛力技能目前暫不開放升級';
  if (!potentialUnlocked(id)) return '潛力節點尚未解鎖';
  var lv = potentialLevel(id);
  if (lv >= potentialSkillMaxLv(id)) return '已達最高等級';
  var cost = talentUpgradeCost(id, lv + 1);
  if ((G.player.reincarnationTalentPoints || 0) < cost) return '轉生威能點不足，需要 ' + cost + ' 點';
  G.player.reincarnationTalentPoints -= cost;
  talentState().potentialLevels[id] = lv + 1;
  talentRefresh();
  return null;
}

function potentialMax(id) {
  var start = potentialLevel(id), changed = false;
  while (potentialLevel(id) < potentialSkillMaxLv(id) && potentialUpgrade(id) === null) changed = true;
  return changed ? null : (start >= potentialSkillMaxLv(id) ? '已達最高等級' : '轉生威能點不足');
}

function potentialDowngrade(id) {
  if (!potentialDef(id)) return '找不到潛力技能';
  var lv = potentialLevel(id);
  if (!lv) return '潛力技能目前是 0 級';
  talentState().potentialLevels[id] = lv - 1;
  G.player.reincarnationTalentPoints = (G.player.reincarnationTalentPoints || 0) + talentUpgradeCost(id, lv);
  if (lv - 1 <= 0 && typeof unequipSkillFromLoadout === 'function') unequipSkillFromLoadout('potential:' + id); // 遺忘 → 卸下裝載
  talentRefresh();
  return null;
}

function potentialDelete(id) {
  if (!potentialDef(id)) return '找不到潛力技能';
  G.player.reincarnationTalentPoints = (G.player.reincarnationTalentPoints || 0) + talentTotalCost(id, potentialLevel(id));
  talentState().potentialLevels[id] = 0;
  if (typeof unequipSkillFromLoadout === 'function') unequipSkillFromLoadout('potential:' + id); // 刪除 → 卸下裝載
  talentRefresh();
  return null;
}

function inventoryCapacityWithTalents(base) {
  // 潛力技能 V3 起，潛力不再提供背包容量加成（舊 potentialInvCap 已移除）。
  return (base === undefined ? INVENTORY_CAP + (G.player.invUpgrades || 0) : base);
}
