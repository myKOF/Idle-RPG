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
    name: '第' + floor + '層・' + bd.name, emoji: bd.emoji, img: bd.img,
    hell: !!bs.hell,
    purgatory: !!bs.purgatory,
    level: bs.level,
    maxHp: bs.hp, hp: bs.hp,
    atk: bs.atk, def: bs.def, mdef: bs.mdef,
    magic: !!bd.elem,                        // 元素 BOSS 以魔法攻擊（對玩家魔防）
    aspd: bs.aspd, dodge: bs.dodge, hit: bs.hit, // 命中率 = 基礎值 + 樓層×每層值 → formula.js §4
    atkCd: 1.5, effects: {}, ctrlRes: bs.ctrlRes,
    elite: false, isBoss: true, towerBoss: true, xp: bs.xp,
    /* 浮字／特效定址沿用塔戰原有的 tb-float（我方是 tp-float）；
       Canvas 戰場也用它當這隻 BOSS 的實體 id（js/battle-renderer.js）。 */
    floatSel: 'tb-float',
    elem: bd.elem, attr: bd.attr || bd.elem || null, elemAtk: null, resist: {}, stunCount: 0,
    shield: 0, buffs: {}, dots: []
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
    blog('⚠️ 目前僅開放第 1～' + TOWER_MAX_FLOOR + ' 層封魔塔。', 'warn');
    return;
  }
  if (floor > G.tower.highest + 1) { blog('⚠️ 需先通過前面的樓層！', 'warn'); return; }
  // 挑戰金幣消耗 = round(a × 高塔樓層^b)，a/b 依樓層分層（towerChallengeCost → formula.js §5）
  var cost = towerChallengeCost(floor);
  if (G.player.gold < cost) {
    blog('⚠️ 金幣不足！挑戰第 ' + floor + ' 層需要 ' + fmt(cost) + ' 金幣（持有 ' + fmt(G.player.gold) + '）。', 'warn');
    return;
  }
  G.player.gold -= cost;
  UI.dirty.header = true;
  blog('💰 支付封魔塔挑戰費用 ' + fmt(cost) + ' 金幣。', 'info');
  var st = getStats();
  G.tower.active = true;
  TOWER.floor = floor;
  TOWER.boss = makeBoss(floor);
  TOWER.boss._spawnAt = GT;
  TOWER.player = newPlayerEntity(st);
  placeTowerCombatants(TOWER.boss);
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
  blog('👹 BOSS資訊：' + TOWER.boss.name + '｜Lv.' + TOWER.boss.level +
    '｜生命 ' + fmt(TOWER.boss.maxHp) + '｜攻擊 ' + fmt(TOWER.boss.atk) +
    '｜物防 ' + fmt(TOWER.boss.def) + '｜魔防 ' + fmt(TOWER.boss.mdef) +
    '｜命中 ' + fmt1(TOWER.boss.hit) + '%｜閃避 ' + fmt1(TOWER.boss.dodge) + '%' +
    (bossElemName ? '｜屬性 ' + bossElemName : '') + '｜控制免疫：暈眩、緩速', 'info', 'boss');
  var towerName = TOWER.boss.purgatory ? '煉獄之塔' : (TOWER.boss.hell ? '地獄之塔' : '試煉之塔');
  blog('🗼 挑戰' + towerName + '第 ' + floor + ' 層：' + TOWER.boss.name + '（限時 ' + towerTimeLimitWithTalents(floor) + ' 秒）', 'info');
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
  if (!(count >= 1)) { blog('⚠️ 請先在封魔塔分頁的「連挑次數」輸入有效的次數（1 以上）', 'warn'); return; }
  if (count > TOWER_AUTO_MAX) count = TOWER_AUTO_MAX;
  TOWER.auto = { floor: floor, total: count, done: 0, wins: 0 };
  TOWER.autoNextCd = 0;
  blog('🔁 開始連續挑戰第 ' + floor + ' 層，共 ' + count + ' 場（戰鬥中按「撤退」可中止）', 'info', 'boss');
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
        blog('🔁 無法開始下一場，連續挑戰停止（已挑戰 ' + auto.done + '/' + auto.total + ' 場，勝 ' + auto.wins + '）', 'warn', 'boss');
        TOWER.auto = null;
      }
    }
    return;
  }
  if (!G.tower.active || TOWER.showingResult) return;
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
      blog('🔥 ' + b.name + ' 進入狂暴狀態！傷害增加 ' + Math.round((bcfg.enrageMult - 1) * 100) + '%！', 'log-enemy-buff');
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
  tickSkillCds(p, dt); // 潛力技能冷卻共用 skillCds（鍵 'potential:<id>'），一併在此遞減

  // 持續傷害
  var towerPlayerDotDeath = tickStatuses(p, dt);
  var towerBossDotDeath = towerPlayerDotDeath ? false : tickStatuses(b, dt);
  /* 狀態跳動特效的緩衝每步都要送出（Canvas 戰場與野外一樣播 Preset），
     否則這一批目標會殘留到下一個模擬步驟才送出去。 */
  if (typeof statusTickVfxFlush === 'function') statusTickVfxFlush();
  if (towerPlayerDotDeath) { endTowerFight(false, 'death'); return; }
  if (towerBossDotDeath) { endTowerFight(true); return; }

  // 潛力【聖療逆轉】溢出傷害（持續效果）
  if (typeof tickPotentialRegen === 'function' && tickPotentialRegen(p, st, dt, [b], 'tb-float')) { endTowerFight(true); return; }

  // 潛力【雷霆過載】持續轟擊（增益期間每 1 秒一輪）
  if (typeof tickPotentialOverdrive === 'function') {
    var odRes = tickPotentialOverdrive(p, [b], 'tb-float');
    if (odRes) {
      TOWER.dmgDealt += Math.max(0, odRes.dmg || 0);
      if (odRes.killed) { endTowerFight(true); return; }
    }
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

  // 玩家行動（減速 -30%；攻速增益加速）
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
    // 潛力【極速之力】：施放期間以倍率放大攻擊頻率（突破 5 次/秒上限）
    // 新版技能【狂風斬】攻速乘算：與 combat.js 野外掛點鏡射
    p.atkCd -= dt * slowFactor(p) * (1 + buffVal(p, 'aspdUp') / 100) *
      (typeof potentialVelocityFactor === 'function' ? potentialVelocityFactor(p, st) : 1) *
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
  if (!effectActive(b, 'stun')) {
    var mult = TOWER.enraged ? bcfg.enrageMult : 1;
    b.atkCd -= dt * slowFactor(b);
    /* 打不到就不打（同野外 fieldMonsterAttack）：冷卻停在 ready，進射程當下出手。 */
    var bossInRange = typeof bfInAttackRange !== 'function' || bfInAttackRange(b);
    if (b.atkCd <= 0 && !bossInRange) {
      b.atkCd = 0;
    } else if (b.atkCd <= 0) {
      var bossTarget = (typeof legendaryChooseEnemyAttackTarget === 'function')
        ? legendaryChooseEnemyAttackTarget(p) : p;
      var bossHit = doMonsterAttack(b, bossTarget, 'tp-float', mult);
      // 使用攻擊結果的實際輸出，包含護盾吸收與擊殺時超出生命的溢出傷害。
      TOWER.bossDmgDealt += Math.max(0, (bossHit.dmg || 0));
      // 潛力【時間結界】：敵攻速降低 → 拉長攻擊間隔。
      b.atkCd += (1 / b.aspd) * (1 + buffVal(b, 'enemyAspdDown') / 100);
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
      var bossSpecialHit = doMonsterAttack(b, bossSpecialTarget, 'tp-float', 2.2 * mult, '蓄力重擊');
      TOWER.bossDmgDealt += Math.max(0, (bossSpecialHit.dmg || 0));
      if (p.hp <= 0) { endTowerFight(false, 'death'); return; }
      if (b.hp <= 0) { endTowerFight(true); return; }
    }
  }
}

/* ---- 結算與失敗分析 ---- */
function endTowerFight(win, reason) {
  /* 新版技能【天地共生】（大地守護 T7，js/skills2.js）：死亡攔截。
     高塔有十來處 `p.hp <= 0 → endTowerFight(false, 'death')`，這裡是它們的共同出口；
     啟動五秒復甦演出後保留目前 BOSS 與挑戰；呼叫端 return，演出期間由 towerTick 暫停戰鬥。 */
  if (!win && reason === 'death' && typeof skills2TryRebirth === 'function' &&
      TOWER.player && skills2TryRebirth(TOWER.player)) {
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
    if (firstClear) G.tower.highest = floor;
    blog('🏆 通關封魔塔第 ' + floor + ' 層！', 'good');
    // 獎勵：資源（零件改由熔爐升級取得）
    var rw = towerRewardFor(floor, firstClear);
    var st2 = getStats();
    var xpGain = Math.round((b.xp || 0) * (1 + st2.xpBonus / 100));
    gainXp(xpGain);
    // 技能熟練度經驗（2026-07-30）：高塔通關比照野外擊殺
    if (typeof gainSkillMasteryXp === 'function') gainSkillMasteryXp(Math.round(xpGain * SKILL_MASTERY_XP_RATE / 100));
    UI.dirty.header = true;
    result.rewards.push('✨ 經驗 x' + fmt(xpGain));
    var soulOriginRate = hellSoulOriginDropChance(floor);
    if (soulOriginRate > 0 && chance(soulOriginRate)) {
      G.player.soulOrigin = (G.player.soulOrigin || 0) + 1;
      if (window.recordLootMat) window.recordLootMat('soulOrigin', 1, 'tower');
      result.rewards.push('🧿 魔魂本源 x1');
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
    // 魔種：僅煉獄之塔 BOSS，獨立判定 1 個
    var demonSeedRate = demonSeedDropChanceForBoss(floor);
    if (demonSeedRate > 0 && chance(demonSeedRate)) {
      G.player.demonSeed = (G.player.demonSeed || 0) + 1;
      if (window.recordLootMat) window.recordLootMat('demonSeed', 1, 'tower');
      result.rewards.push('🌱 魔種 x1');
      UI.dirty.header = true;
    }
    // 魔塵（神鑄材料）：掉落率 = min(30%, 2% + 樓層 × 0.2%)（bossDustRate → formula.js §5）
    if (chance(bossDustRate(floor))) {
      G.player.dust = (G.player.dust || 0) + 1;
      if (window.recordLootMat) window.recordLootMat('dust', 1, 'tower');
      result.rewards.push('💫 魔塵 x1（神鑄材料）');
      UI.dirty.forge = true;
    }

    blog('🎁 封魔塔通關獎勵：' + result.rewards.join('、'), 'good', 'boss');
  } else if (reason === 'flee') {
    blog('🏃 你撤出了封魔塔挑戰。', 'warn');
    result.analysis.push('已撤退。可隨時再次挑戰。');
  } else {
    blog('💀 封魔塔挑戰失敗（第 ' + floor + ' 層）', 'bad');
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
