'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
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
  playerPos: null,    // 我方戰場座標（＝ bfPlayerPos() 的參照，見 placeTowerCombatants）
  introCd: 0,         // 登場倒數（秒）：轉場期間戰鬥不開始、限時不走（見 TOWER_INTRO_SEC）
  result: null,       // 結束後的結算資料（顯示用）
  showingResult: false,
  auto: null,         // 連續挑戰 { floor, total, done, wins }；null = 未啟用
  autoNextCd: 0       // 連續挑戰下一場倒數（秒）
};
var TOWER_AUTO_DELAY = 1.0;   // 連續挑戰場與場之間的間隔（秒）
var TOWER_AUTO_RESULT_DELAY = 3.0; // 連續挑戰結果畫面停留秒數
var TOWER_AUTO_MAX = 999;     // 連續挑戰次數上限
/* 開場時 BOSS 站在我方正前方（+x）多遠（座標單位，見 js/battlefield.js）。
   塔戰改走野外的即時戰場後，雙方要先走到射程內才打得到；
   野外的生成距離 BF_SPAWN_DIST（440）會讓限時 60 秒白白燒掉近一秒，
   這裡取近一點：我方 300／BOSS 210 對衝，約 0.35 秒接戰，仍看得到 BOSS 逼近。 */
var TOWER_BOSS_SPAWN_DIST = 260;
/* 野外 ⇄ 魔王戰的轉場（js/battle-renderer.js 的黑圈收合：收 1.0 秒、全黑 0.35 秒、展開 1.05 秒）。
   模擬是即時的，畫面黑掉的那段戰鬥若照跑，60 秒限時會被吃掉、開場也看不到——
   所以塔戰開場先有一段「登場」：計時不走、雙方不動，長度對齊整段轉場，黑圈展開完才開打。
   回到野外時同理，出怪延後同樣長度，黑幕中不會被偷打。兩個數字改了，渲染器的轉場要一起改。 */
var TOWER_INTRO_SEC = 2.4;
var TOWER_EXIT_SPAWN_HOLD_SEC = 2.4;

function makeBoss(floor) {
  var bd = BOSS_LIST[(floor - 1) % BOSS_LIST.length];
  var bs = bossStatsFor(floor);              // BOSS 數值公式 → formula.js §4
  var b = {
    name: STR(1821, floor, bd.name), emoji: bd.emoji, img: bd.img,
    hell: !!bs.hell,
    purgatory: !!bs.purgatory,
    level: bs.level,
    _powerLevelBonus: typeof monsterPowerLevelBonus === 'function' ? monsterPowerLevelBonus() : 0,
    maxHp: bs.hp, hp: bs.hp,
    atk: bs.atk, def: bs.def, mdef: bs.mdef,
    magic: !!bd.elem,                        // 元素 BOSS 以魔法攻擊（對玩家魔防）
    aspd: bs.aspd, dodge: bs.dodge, hit: bs.hit, // 命中率 = 基礎值 + 樓層×每層值 → formula.js §4
    atkCd: 1.5, effects: {}, ctrlRes: bs.ctrlRes,
    sightRange: npcSightRange(bd, 'tower_boss'),
    _alerted: false,
    elite: false, isBoss: true, towerBoss: true, xp: bs.xp,
    /* 浮字／特效定址沿用塔戰原有的 tb-float（我方是 tp-float）；
       Canvas 戰場也用它當這隻 BOSS 的實體 id（js/battle-renderer.js）。 */
    floatSel: 'tb-float',
    elem: bd.elem, attr: bd.attr || bd.elem || null, elemAtk: null, resist: {}, stunCount: 0,
    shield: 0, buffs: {}, dots: []
  };
  if (typeof eliteEquip === 'function' && typeof eliteRollSkills === 'function') {
    var towerIdx = (floor - 1) % BOSS_LIST.length;
    /* 玩家技能（js/elite_data.js bskPickForFloor）：這層解鎖的超神進化技能固定帶上；沒解鎖的 BOSS 額外多抽 NPC 隨機技能，101 層起每場隨機抽玩家技能。 */
    var psk = (typeof bskPickForFloor === 'function') ? bskPickForFloor(floor) : { ids: [], extraNpc: 0 };
    var towerIds = eliteRollSkills(bd, 'tower', { stage: floor, group: 1, tower: true, atkRange: 0, extraRnd: psk.extraNpc });
    towerIds = towerIds.concat(psk.ids);
    eliteEquip(b, towerIds, { tier: 'tower', towerIdx: towerIdx, towerCount: BOSS_LIST.length });
  }
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
    blog(STR(1822, TOWER_MAX_FLOOR), 'warn');
    return;
  }
  if (floor > G.tower.highest + 1) { blog(STR(1823), 'warn'); return; }
  // 挑戰金幣消耗 = round(a × 高塔樓層^b)，a/b 依樓層分層（towerChallengeCost → formula.js §5）
  var cost = towerChallengeCost(floor);
  if (G.player.gold < cost) {
    blog(STR(1824, floor, fmt(cost), fmt(G.player.gold)), 'warn');
    return;
  }
  G.player.gold -= cost;
  UI.dirty.header = true;
  blog(STR(1825, fmt(cost)), 'info');
  var st = getStats();
  G.tower.active = true;
  TOWER.floor = floor;
  TOWER.boss = makeBoss(floor);
  TOWER.boss._spawnAt = GT;
  TOWER.player = newPlayerEntity(st);
  placeTowerCombatants(TOWER.boss);
  if (typeof eliteReset === 'function') eliteReset();
  // 塔戰玩家實體全新建立＝新一場戰鬥，清空技能執行期狀態（比照 skillCds 全新重置）
  if (typeof resetSkillRT === 'function') resetSkillRT();
  TOWER.player.atkCd = 0.3;
  TOWER.elapsed = 0;
  TOWER.introCd = TOWER_INTRO_SEC;
  TOWER.enrageChecked = false;
  TOWER.enraged = false;
  TOWER.specialCd = towerBossCfg(floor).chargePeriod;
  TOWER.dmgDealt = 0;
  TOWER.bossDmgDealt = 0;
  TOWER.result = null;
  TOWER.showingResult = false;
  if (typeof clearTowerFloatLayers === 'function') clearTowerFloatLayers();
  var bossElemName = TOWER.boss.elem && ENCHANTS[TOWER.boss.elem] ? ENCHANTS[TOWER.boss.elem].name : TOWER.boss.elem;
  blog(STR(1826, TOWER.boss.name, TOWER.boss.level, fmt(TOWER.boss.maxHp), fmt(TOWER.boss.atk), fmt(TOWER.boss.def), fmt(TOWER.boss.mdef), fmt1(TOWER.boss.hit), fmt1(TOWER.boss.dodge), (bossElemName ? STR(1827, bossElemName) : '')), 'info', 'boss');
  var towerName = TOWER.boss.purgatory ? STR(1828) : (TOWER.boss.hell ? STR(1829) : STR(1830));
  blog(STR(1831, towerName, floor, TOWER.boss.name, towerTimeLimitWithTalents(floor)), 'info');
  UI.dirty.tower = true; UI.dirty.battle = true;
}

/* ---- 戰場站位 ----
   塔戰與野外共用同一個戰場座標系（js/battlefield.js）：我方就是 BF_PLAYER 本人，
   BOSS 放在我方正前方。我方不歸零——野外在塔戰期間是凍結的，結束時整批清怪重來
   （finishTowerFight），沿用當下位置可以讓鏡頭不跳。
   TOWER.playerPos 與 FIELD.playerPos 同一個參照，面板序列化時自然帶到最新值。
   沒載入 battlefield.js 的環境（部分單元測試）維持舊的無座標行為：
   bfPos 回 null ⇒ 射程判定一律放行、技能幾何退化成單體。 */
function placeTowerCombatants(boss) {
  if (typeof bfPlayerPos !== 'function') { TOWER.playerPos = null; return; }
  var home = bfPlayerPos();
  TOWER.playerPos = home;
  if (boss) boss.pos = { x: home.x + TOWER_BOSS_SPAWN_DIST, y: home.y };
}

/* ---- 連續挑戰 ----
   同一樓層自動重複挑戰 count 場，場與場之間間隔 TOWER_AUTO_DELAY 秒；
   金幣不足或次數用完自動停止並回到野外；戰鬥中按「撤退」立即中止。 */
function startTowerAuto(floor, count) {
  if (G.tower.active) return;
  count = Math.floor(count);
  if (!(count >= 1)) { blog(STR(1832), 'warn'); return; }
  if (count > TOWER_AUTO_MAX) count = TOWER_AUTO_MAX;
  TOWER.auto = { floor: floor, total: count, done: 0, wins: 0 };
  TOWER.autoNextCd = 0;
  blog(STR(1833, floor, count), 'info', 'boss');
  startTowerFight(floor);
  if (!G.tower.active) TOWER.auto = null; // 開場失敗（金幣不足 / 樓層未解鎖）
}

function towerTick(dt) {
  if (!(TOWER.player && TOWER.player._sgRevival && TOWER.player._sgRevival.mode === 'earthguard') &&
      typeof tickDeferredEnemyAttackRetaliations === 'function') tickDeferredEnemyAttackRetaliations();
  // 連續挑戰：上一場結束後倒數，自動開始下一場
  if (!G.tower.active && TOWER.auto && TOWER.autoNextCd > 0) {
    TOWER.autoNextCd -= dt;
    if (TOWER.autoNextCd <= 0) {
      TOWER.autoNextCd = 0;
      var auto = TOWER.auto;
      startTowerFight(auto.floor);
      if (!G.tower.active) { // 意外無法開場（金幣被其他系統消耗等）
        blog(STR(1834, auto.done, auto.total, auto.wins), 'warn', 'boss');
        TOWER.auto = null;
      }
    }
    return;
  }
  if (!G.tower.active || TOWER.showingResult) return;
  tickEnemyFrenzy(TOWER.boss ? [TOWER.boss] : [], GT);
  // 登場：轉場黑圈還沒展開，計時、冷卻、雙方行動全部不動
  if (TOWER.introCd > 0) { TOWER.introCd = Math.max(0, TOWER.introCd - dt); return; }
  var st = getStats();
  var p = TOWER.player, b = TOWER.boss;
  if (p && p._sgRevival && p._sgRevival.mode === 'earthguard') {
    tickSkillCds(p, dt);
    sgTickEarthguardRevival(p);
    if (typeof UI !== 'undefined' && UI.dirty) UI.dirty.battle = true;
    return;
  }
  var bcfg = towerBossCfg(TOWER.floor);   // 該塔戰鬥規則（限時/狂暴/蓄力）
  TOWER.elapsed += dt;

  // 限時判定
  if (TOWER.elapsed >= towerTimeLimitWithTalents(TOWER.floor)) { endTowerFight(false, 'timeout'); return; }

  // 狂暴判定：該塔狂暴檢查秒數時血量高於門檻（50% + 玩家「狂暴閾值」屬性）則狂暴
  if (!TOWER.enrageChecked && TOWER.elapsed >= bcfg.enrageTime) {
    TOWER.enrageChecked = true;
    if (b.hp / b.maxHp * 100 > TOWER_ENRAGE_HP + st.enrageThreshold) {
      TOWER.enraged = true;
      blog(STR(1835, b.name, Math.round((bcfg.enrageMult - 1) * 100)), 'log-enemy-buff');
    }
  }

  // 回復與冷卻（含再生增益）
  /* 高塔沒有每秒基礎生命回復（formula.js BASE_HP_REGEN 只作用於野外），
     因此這裡不能直接改用 playerHpRegenPerSec；新版技能【生命再生】／【魔力再生】
     （大地守護 T3／T4）的乘算則兩邊都要吃，故單獨乘在屬性值上。 */
  var regenHpMul = (typeof skill2RegenFactor === 'function') ? skill2RegenFactor('hp') : 1;
  var regenMpMul = (typeof skill2RegenFactor === 'function') ? skill2RegenFactor('mp') : 1;
  /* 入帳一律走 formula.js 的收斂點（夾上限的行為與改版前相同），溢出量才有地方可以接
     ——大地守護的傳奇【生命滋養】【魔力滋養】與超神【光耀之堂】吃的就是這一份。 */
  gainPlayerMana(p, st.mpRegen * regenMpMul * dt, st);
  var hot = buffVal(p, 'hot');
  if (st.hpRegen > 0 || hot > 0) {
    healPlayer(p, (st.hpRegen * regenHpMul + st.hp * hot / 100) * dt, st, { noShield: true });
  }
  tickSkillCds(p, dt);

  // 持續傷害
  var towerPlayerDotDeath = tickStatuses(p, dt);
  var towerBossDotDeath = towerPlayerDotDeath ? false : tickStatuses(b, dt);
  /* 狀態跳動特效的緩衝每步都要送出（Canvas 戰場與野外一樣播 Preset），
     否則這一批目標會殘留到下一個模擬步驟才送出去。 */
  if (typeof statusTickVfxFlush === 'function') statusTickVfxFlush();
  if (towerPlayerDotDeath) { endTowerFight(false, 'death'); return; }
  if (towerBossDotDeath) { endTowerFight(true); return; }

  /* 高級敵人技能（js/elite.js）：封魔塔 BOSS 與野外共用同一套引擎，這裡只負責「驅動它、處理它的後果」。
     玩家被技能打死 → 失敗；BOSS 被反震等打死 → 勝利。 */
  if (typeof eliteTick === 'function') {
    if (eliteTick(dt)) { endTowerFight(false, 'death'); return; }
    if (b.hp <= 0) { endTowerFight(true); return; }
  }
  // 技能排程器（js/skills2.js tickSkill2；鏡射 combat.js fieldTick 掛點）
  if (typeof tickSkillSchedulers === 'function') {
    tickSkillSchedulers(dt, {
      pEnt: p,
      getEnemies: function () { return (TOWER.boss && TOWER.boss.hp > 0) ? [TOWER.boss] : []; },
      floatSel: 'tb-float',
      onDeaths: function () { if (TOWER.boss && TOWER.boss.hp <= 0 && G.tower.active && !TOWER.showingResult) endTowerFight(true); },
      onDamage: function (d) { TOWER.dmgDealt += Math.max(0, d || 0); } // 排程結算傷害計入輸出統計
    });
    if (!G.tower.active || TOWER.showingResult) return; // 排程結算若擊殺 BOSS（後棒填入）即結束本場
    if (p.hp <= 0) { endTowerFight(false, 'death'); return; }
  }
  if (typeof tickLegendaryEffects === 'function') {
    var legendaryTick = tickLegendaryEffects(dt, {
      pEnt: p,
      getEnemies: function () { return (TOWER.boss && TOWER.boss.hp > 0) ? [TOWER.boss] : []; },
      floatSel: 'tb-float',
      onDeaths: function () {
        if (TOWER.boss && TOWER.boss.hp <= 0 && G.tower.active && !TOWER.showingResult) endTowerFight(true);
      },
      onDamage: function (d) { TOWER.dmgDealt += Math.max(0, d || 0); }
    });
    if (!G.tower.active || TOWER.showingResult) return;
    if (legendaryTick && legendaryTick.playerKilled) { endTowerFight(false, 'death'); return; }
  }

  // 玩家行動：控制狀態不降低攻速或禁止出手，攻速增益照常。
  var skillCastTick = (typeof tickSkillCast === 'function') ? tickSkillCast(p, dt) : null;
  if (skillCastTick && skillCastTick.completed) {
    TOWER.dmgDealt += Math.max(0, skillCastTick.dmg || 0);
    if (skillCastTick.killed) { endTowerFight(true); return; }
    if (p.hp <= 0) { endTowerFight(false, 'death'); return; }
  }

  /* 走位（→ js/battlefield.js，與野外 fieldTick 同一組呼叫）：
     我方朝 BOSS 跑、施放硬直中站定；BOSS 朝我方逼近，近戰貼身、元素 BOSS 進射程就能開火。
     位移只在模擬層產生，Canvas 戰場只負責畫（見 battlefield.js bfTickPlayer 的說明）。 */
  var playerMoveDt = dt;
  if (skillCastTick && skillCastTick.casting) playerMoveDt = 0;
  else if (skillCastTick && skillCastTick.completed) playerMoveDt = skillCastTick.remainingDt;
  if (!p._sgRevival && typeof bfTickPlayer === 'function') bfTickPlayer([b], playerMoveDt, b, p);
  if (typeof eliteStepMotion === 'function') eliteStepMotion([b], dt);   // 衝鋒位移
  if (typeof bfTickApproach === 'function') bfTickApproach([b], dt);

  if (!playerActionControlBlocked(p, false) &&
      (typeof skillCastInProgress !== 'function' || !skillCastInProgress(p))) {
    var sres = pickAndCastSkill(p, b, 'tb-float');
    if (sres) {
      // 使用攻擊結果的實際輸出，包含護盾吸收與擊殺時超出生命的溢出傷害。
      TOWER.dmgDealt += Math.max(0, (sres.dmg || 0));
      if (sres.killed) { endTowerFight(true); return; }
      if (p.hp <= 0) { endTowerFight(false, 'death'); return; } // 自傷技能
    }
    // 新版技能【狂風斬】攻速乘算：與 combat.js 野外掛點鏡射
    p.atkCd -= dt * slowFactor(p) * (1 + buffVal(p, 'aspdUp') / 100) *
      (typeof legendaryAttackSpeedMultiplier === 'function' ? legendaryAttackSpeedMultiplier(p, st) : 1) *
      (typeof skill2AspdFactor === 'function' ? skill2AspdFactor(p) : 1);
    /* 普攻是近戰：還沒走到 BOSS 面前就不出手，冷卻只保持在 ready、不累積欠債，
       走進距離的那一刻立刻補上這一擊（與野外同一條規則）。 */
    if (p.atkCd <= 0 && typeof bfPlayerCanReach === 'function' && !bfPlayerCanReach(b)) {
      p.atkCd = 0;
    } else if (p.atkCd <= 0) {
      var res = doPlayerAttack(p, b, 'tb-float');
      TOWER.dmgDealt += Math.max(0, (res.dmg || 0));
      p.atkCd += 1 / st.aspd;
      if (res.killed) { endTowerFight(true); return; }
      // 普攻期間的自傷（新版技能【血飲術】反噬）也可能致死：與上方自傷技能同樣補判
      if (p.hp <= 0) { endTowerFight(false, 'death'); return; }
    }
  }

  // BOSS 攻擊（死亡的 BOSS 不得再行動）
  if (b.hp <= 0) { endTowerFight(true); return; }
  if (!ccActionLocked(b)) {
    var mult = TOWER.enraged ? bcfg.enrageMult : 1;
    b.atkCd -= dt * slowFactor(b);
    /* 打不到就不打（同野外 fieldMonsterAttack）：冷卻停在 ready，進射程當下出手。 */
    /* 技能施放中（js/elite.js eliteLocked）站著不普攻：當作還沒進射程，冷卻停在 ready，施放完立刻出手。 */
    var bossInRange = (typeof bfInAttackRange !== 'function' || bfInAttackRange(b)) &&
      !(typeof eliteLocked === 'function' && eliteLocked(b));
    if (b.atkCd <= 0 && !bossInRange) {
      b.atkCd = 0;
    } else if (b.atkCd <= 0) {
      var bossTarget = (typeof legendaryChooseEnemyAttackTarget === 'function')
        ? legendaryChooseEnemyAttackTarget(p) : p;
      var bossHit = doMonsterAttack(b, bossTarget, 'tp-float', mult);
      // 使用攻擊結果的實際輸出，包含護盾吸收與擊殺時超出生命的溢出傷害。
      TOWER.bossDmgDealt += Math.max(0, (bossHit.dmg || 0));
      b.atkCd += (1 / b.aspd);
      if (p.hp <= 0) { endTowerFight(false, 'death'); return; }
      if (b.hp <= 0) { endTowerFight(true); return; } // 反震擊殺
    }
    // 特殊技：每「蓄力周期」秒重擊（各塔獨立）
    TOWER.specialCd -= dt;
    if (TOWER.specialCd <= 0 && !bossInRange) TOWER.specialCd = 0;   // 蓄滿了等進射程再砸
    if (TOWER.specialCd <= 0 && bossInRange && p.hp > 0) {
      TOWER.specialCd = bcfg.chargePeriod;
      var bossSpecialTarget = (typeof legendaryChooseEnemyAttackTarget === 'function')
        ? legendaryChooseEnemyAttackTarget(p) : p;
      var bossSpecialHit = doMonsterAttack(b, bossSpecialTarget, 'tp-float', 2.2 * mult, STR(1836));
      TOWER.bossDmgDealt += Math.max(0, (bossSpecialHit.dmg || 0));
      if (p.hp <= 0) { endTowerFight(false, 'death'); return; }
      if (b.hp <= 0) { endTowerFight(true); return; }
    }
  }
}

/* ---- 結算與失敗分析 ---- */
function endTowerFight(win, reason) {
  if (!win && reason === 'death' && TOWER.player && TOWER.player.hp > 0) return;
  // 玩家技能【不屈鬥魂】【天地再造】【逆轉乾坤】（js/elite_boss.js）：BOSS 致命傷時保命／復活，戰鬥繼續，呼叫端本來就會 return
  if (win && typeof eliteBossUndying === 'function' && eliteBossUndying(TOWER.boss)) return;
  // 致命傷免死先於復活／挑戰結算，不清BOSS、不記死亡、不停止挑戰。
  if (!win && reason === 'death' && typeof skills2TryLastStand === 'function' && TOWER.player &&
      skills2TryLastStand(TOWER.player, TOWER.boss ? [TOWER.boss] : [], 'tb-float')) return;
  /* 新版技能【天地共生】（大地守護 T7，js/skills2.js）：死亡攔截。
     高塔有十來處 `p.hp <= 0 → endTowerFight(false, 'death')`，這裡是它們的共同出口；
     啟動五秒復甦演出後保留目前 BOSS 與挑戰；呼叫端 return，演出期間由 towerTick 暫停戰鬥。 */
  if (!win && reason === 'death' && typeof skills2TryRebirth === 'function' &&
      TOWER.player && skills2TryRebirth(TOWER.player)) {
    return;
  }
  // 符文真言【輪迴】（js/runeword.js）：死亡攔截；復活後戰鬥繼續，呼叫端本來就會 return
  if (!win && reason === 'death' && typeof rwTryRevive === 'function' &&
      TOWER.player && rwTryRevive(TOWER.player)) {
    return;
  }
  var b = TOWER.boss;
  var floor = TOWER.floor;
  var hpPct = b ? (b.hp / b.maxHp * 100) : 0;
  var myDps = TOWER.elapsed > 0.5 ? TOWER.dmgDealt / TOWER.elapsed : 0;
  var needDps = b ? b.maxHp / towerTimeLimitWithTalents(floor) : 0;
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
    if (firstClear) {
      G.tower.highest = floor;
      if (typeof sgAfterSkillChange === 'function') sgAfterSkillChange();
    }
    blog(STR(1837, floor), 'good');
    if (typeof rwUnlockTowerWords === 'function') {
      var unlockedWords = rwUnlockTowerWords(G.tower.highest);
      if (unlockedWords) result.rewards.push(STR(1838, unlockedWords));
    }
    // 獎勵：資源（零件改由熔爐升級取得）
    var rw = towerRewardFor(floor, firstClear);
    var st2 = getStats();
    var xpGain = Math.round((b.xp || 0) * (1 + st2.xpBonus / 100));
    gainXp(xpGain);
    // 技能熟練度經驗（2026-07-30）：高塔通關比照野外擊殺
    if (typeof gainSkillMasteryXp === 'function') gainSkillMasteryXp(Math.round(xpGain * SKILL_MASTERY_XP_RATE / 100));
    UI.dirty.header = true;
    result.rewards.push(STR(106, fmt(xpGain)));
    var soulOriginRate = hellSoulOriginDropChance(floor);
    if (soulOriginRate > 0 && chance(soulOriginRate)) {
      G.player.soulOrigin = (G.player.soulOrigin || 0) + 1;
      if (window.recordLootMat) window.recordLootMat('soulOrigin', 1, 'tower');
      result.rewards.push(STR(1839));
      UI.dirty.header = true;
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
          level: rw.itemLevel
        }));
      }
      if (window.recordLootEquip) window.recordLootEquip(br, bn, 'tower');
      lootCounts.push(STR(1840, RARITIES[br].color, RARITIES[br].name, bn));
    }
    if (lootCounts.length) {
      result.rewards.push(STR(1841));
      for (var i = 0; i < lootCounts.length; i++) {
        result.rewards.push(lootCounts[i]);
      }
    }
    var gt1 = randomGemType(), gt2 = randomGemType();
    addGem(gt1, rw.gemLevel, 1); addGem(gt2, rw.gemLevel, 1);
    if (gt1 && window.recordLootGem) {
      window.recordLootGem(gt1, rw.gemLevel, 1, 'tower');
      window.recordLootGem(gt2, rw.gemLevel, 1, 'tower');
    }
    if (gt1) result.rewards.push('💎 ' + gemLabel(gt1, rw.gemLevel) + '、' + gemLabel(gt2, rw.gemLevel));
    if (ENCHANT_ENABLED) {
      var bk = pick(Object.keys(ENCHANTS));
      G.player.books[bk] += 2;
      if (window.recordLootMat) window.recordLootMat('book', 2, 'tower');
      result.rewards.push(STR(1842, ENCHANTS[bk].name));
    }
    G.player.essence += rw.essence;
    if (window.recordLootMat) window.recordLootMat('essence', rw.essence, 'tower');
    result.rewards.push(STR(1843, rw.essence));
    // 符文（符文真言的素材）：樓層越高階數越高（js/runeword.js）
    if (typeof rwRollTowerRuneDrop === 'function') {
      var towerRunes = rwRollTowerRuneDrop(floor, st2.loot);
      if (towerRunes.length) {
        result.rewards.push('🔷 ' + towerRunes.map(function (rid) { return runeLabel(rid); }).join('、'));
      }
    }
    // 太古精華（40 層以上；獨立機率，不受掉寶率影響）
    var ancientEssenceRate = ancientEssenceDropChanceForBoss(floor);
    if (ancientEssenceRate > 0 && chance(ancientEssenceRate)) {
      G.player.ancientEssence = (G.player.ancientEssence || 0) + 1;
      if (window.recordLootMat) window.recordLootMat('ancientEssence', 1, 'tower');
      result.rewards.push('<img src="images/icon_ancient_essence.png" class="res-icon" alt="' + STR(13) + '"> ' + STR(1844));
      UI.dirty.header = true;
    }
    // 魔種：僅煉獄之塔 BOSS，獨立判定 1 個
    var demonSeedRate = demonSeedDropChanceForBoss(floor);
    if (demonSeedRate > 0 && chance(demonSeedRate)) {
      G.player.demonSeed = (G.player.demonSeed || 0) + 1;
      if (window.recordLootMat) window.recordLootMat('demonSeed', 1, 'tower');
      result.rewards.push(STR(1845));
      UI.dirty.header = true;
    }
    // 魔塵（神鑄材料）：掉落率 = min(30%, 2% + 樓層 × 0.2%)（bossDustRate → formula.js §5）
    if (chance(bossDustRate(floor))) {
      G.player.dust = (G.player.dust || 0) + 1;
      if (window.recordLootMat) window.recordLootMat('dust', 1, 'tower');
      result.rewards.push(STR(1846));
      UI.dirty.forge = true;
    }

    blog(STR(1847, result.rewards.join('、')), 'good', 'boss');
  } else if (reason === 'flee') {
    blog(STR(1848), 'warn');
    result.analysis.push(STR(1849));
  } else {
    blog(STR(1850, floor), 'bad');
    // 失敗分析系統
    if (reason === 'death') {
      result.analysis.push(STR(1851, Math.round(TOWER.elapsed)));
      if (b && b.elem) result.analysis.push(STR(1852, ENCHANTS[b.elem === 'fire' ? 'fireRes' : (b.elem === 'ice' ? 'iceRes' : 'ctrlRes')].name.slice(0, 2)));
      if (TOWER.enraged) result.analysis.push(STR(1853));
    } else {
      if (hpPct > 50) {
        result.analysis.push(STR(1854, Math.round(100 - hpPct), fmt(myDps), fmt(needDps)));
      } else {
        result.analysis.push(STR(1855, Math.round(hpPct)));
      }
      if (TOWER.enraged) result.analysis.push(STR(1856));
      result.analysis.push(STR(1857));
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
    var tail = STR(1858, auto.done, auto.total, auto.wins, (auto.done - auto.wins));
    if (reason === 'flee') {
      blog(STR(1859, auto.floor, tail), 'warn', 'boss');
      TOWER.auto = null;
    } else if (auto.done >= auto.total) {
      blog(STR(1860, auto.floor, tail), 'good', 'boss');
      TOWER.auto = null;
    } else if (G.player.gold < towerChallengeCost(auto.floor)) {
      blog(STR(1861, fmt(towerChallengeCost(auto.floor)), tail), 'warn', 'boss');
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
    blog(STR(1862), 'warn', 'boss');
    TOWER.auto = null;
  }
}

function stopTowerAutoFromResult() {
  if (TOWER.result) {
    TOWER.result.autoContinue = false;
    TOWER.result.autoCountdown = false;
  }
  if (TOWER.auto) blog(STR(1863), 'warn', 'boss');
  TOWER.auto = null;
  TOWER.autoNextCd = 0;
}

function finishTowerFight() {
  TOWER.showingResult = false;
  G.tower.active = false;
  if (typeof eliteReset === 'function') eliteReset();
  TOWER.boss = null;
  TOWER.player = null;
  TOWER.playerPos = null;
  // 45 新技能：塔戰結束回野外＝場景切換，清空技能執行期狀態（避免塔內殘留排程打進野外）
  if (typeof resetSkillRT === 'function') resetSkillRT();
  /* 野外重生：生命與法力一起補滿——與野外死亡復活（js/combat.js fieldTick 的 reviveCd 出口）
     同一條規則。塔戰失敗＝死亡，回到野外時只回血不回魔會讓玩家一落地就沒法力可放技能。 */
  if (FIELD.player) {
    var fieldSt = getStats();
    FIELD.player.hp = fieldSt.hp;
    FIELD.player.mp = fieldSt.mp;
  }
  FIELD.monster = null; FIELD.monsters = []; FIELD._waveClearPending = false;
  holdFieldSpawn(TOWER_EXIT_SPAWN_HOLD_SEC);   // 回野外的轉場期間不出怪（見 TOWER_INTRO_SEC 的說明）
  UI.dirty.tower = true; UI.dirty.battle = true; UI.dirty.header = true; UI.dirty.factory = true;
}

function fleeTower() {
  if (!G.tower.active) return;
  endTowerFight(false, 'flee');
}
