'use strict';
if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
/* ============ 技能共用執行期 ============
   新版技能群組由 js/skills2.js 提供；本檔管理熟練度、裝載、冷卻與施法排程。 */

/* 自動施放的預設施放硬直由 formula.js 的 SKILL_CAST_LOCK 讀取參數表；
   就緒監視器只負責讓 CD 歸零且條件成立的技能立即進入施放，不再因裝載欄長度延後。
   每技能自身最短施放間隔同樣由公式層讀取參數表；個別技能仍可用 castTime 覆寫。 */
var SKILL_CAST_DEFAULT_SEC = (typeof SKILL_CAST_LOCK === 'number' &&
  isFinite(SKILL_CAST_LOCK) && SKILL_CAST_LOCK >= 0) ? SKILL_CAST_LOCK : 0;
var SKILL_CAST_RT = [];

/* 執行期狀態重置（戰鬥／關卡切換、死亡、轉生與讀檔進入點呼叫）。
   施法中的技能會被中斷：吟唱開始時已先把技能從就緒佇列移除，但冷卻要等施法完成才寫入，
   戰鬥重置／死亡若在這裡中斷吟唱，若不補回就緒項，該技能會以「無冷卻、
   卻永遠不在佇列」的狀態永久失效；長時間掛機反覆死亡後可能逐一耗盡所有技能。 */
function resetSkillRT() {
  for (var castI = 0; castI < SKILL_CAST_RT.length; castI++) {
    var interrupted = SKILL_CAST_RT[castI];
    if (!interrupted || !interrupted.pEnt) continue;
    requeueSkillAfterFailedCast(interrupted.pEnt, interrupted.loadoutKey || interrupted.skillId);
    interrupted.pEnt._skillCastRemaining = 0;
    interrupted.pEnt._skillCastId = '';
    interrupted.pEnt._skillHold = 0;
  }
  SKILL_CAST_RT = [];
  if (typeof resetLegendaryRT === 'function') resetLegendaryRT();
  if (typeof resetSkill2RT === 'function') resetSkill2RT(); // 新版技能系統（js/skills2.js）：重置時機完全跟隨本函式
}
resetSkillRT(); // 載入即建立初始狀態

/* ---- 共用排程器 ----
   由 combat.js fieldTick 與 tower.js towerTick 兩處鏡射呼叫（野外與高塔）。
   ctx = { pEnt 玩家實體, getEnemies() 回傳當前存活敵人陣列, floatSel 浮字層, onDeaths 擊殺後結算回呼,
           onDamage(d) 可選——排程結算傷害回報（塔戰輸出統計用） }。 */
function tickSkillSchedulers(dt, ctx) {
  if (typeof tickSkill2 === 'function') tickSkill2(dt, ctx); // 新版技能（js/skills2.js）：暴風之舞自動施放、場域與環繞體結算
}

function ensureSkillMastery() {
  var p = G.player;
  if (!p.skillMastery || typeof p.skillMastery !== 'object') p.skillMastery = { level: 0, xp: 0 };
  var m = p.skillMastery;
  m.level = Math.max(0, Math.min(SKILL_MASTERY_MAX_LEVEL, Math.floor(Number(m.level) || 0)));
  m.xp = Math.max(0, Math.floor(Number(m.xp) || 0));
  return m;
}

/* 技能熟練度經驗入帳：滿足需求即升級，滿級後不再累積。 */
function gainSkillMasteryXp(n) {
  n = Math.floor(Number(n) || 0);
  if (n <= 0) return;
  var m = ensureSkillMastery();
  if (m.level >= SKILL_MASTERY_MAX_LEVEL) { m.xp = 0; return; }
  m.xp += n;
  var leveled = 0;
  while (m.level < SKILL_MASTERY_MAX_LEVEL && m.xp >= skillMasteryXpForLevel(m.level)) {
    m.xp -= skillMasteryXpForLevel(m.level);
    m.level++;
    leveled++;
  }
  if (m.level >= SKILL_MASTERY_MAX_LEVEL) m.xp = 0;
  // 經驗未達升級門檻時也要刷新技能面板；否則降低獲得倍率後，進度條會長時間停在舊快照。
  UI.dirty.skills = true;
  if (leveled > 0) {
    blog(STR(673, m.level), 'good');
    UI.dirty.header = true;
  }
}

/* ---- 裝載 ---- */
function equipSkillToLoadout(id) {
  var cap = loadoutSize();
  var lo = G.player.loadout || [];
  if (lo.indexOf(id) >= 0) return STR(674);

  // 新版技能群組（'sg:<群組id>'，js/skills2.js）：第 1 階預設開啟即可裝載。
  if (typeof id === 'string' && id.indexOf('sg:') === 0) {
    var sgId = id.slice(3);
    if (typeof SKILLS2 === 'undefined' || !SKILLS2[sgId]) return STR(675);
    if (typeof skills2Castable === 'function' && !skills2Castable(sgId)) return STR(676);
  } else {
    return STR(677);
  }

  var firstEmpty = -1;
  for (var i = 0; i < cap; i++) {
    if (!lo[i]) { firstEmpty = i; break; }
  }
  if (firstEmpty < 0) return STR(678, cap);

  lo[firstEmpty] = id;
  /* 修羅亂舞的生效條件包含「雙刀亂舞裝配在技能列上」，因此裝載欄異動會改變屬性
    （副手雙手武器是否計入）。裝載欄異動很罕見，一律讓屬性快取失效即可，
     不必在這裡認得是哪一個技能。 */
  if (typeof markStatsDirty === 'function') markStatsDirty();
  UI.dirty.skills = true;
  return null;
}
function unequipSkillFromLoadout(id) {
  var lo = G.player.loadout;
  if (!lo) return;
  var i = lo.indexOf(id);
  if (i >= 0) {
    lo[i] = null;
    while (lo.length > 0 && !lo[lo.length - 1]) {
      lo.pop();
    }
    /* 修羅亂舞的生效條件包含「雙刀亂舞裝配在技能列上」，因此裝載欄異動會改變屬性
      （副手雙手武器是否計入）。裝載欄異動很罕見，一律讓屬性快取失效即可，
       不必在這裡認得是哪一個技能。 */
    if (typeof markStatsDirty === 'function') markStatsDirty();
    UI.dirty.skills = true;
  }
}

/* 技能就緒監視器（執行期狀態，不入存檔）：
   每個技能的冷卻獨立倒數；歸零時只把該技能加入就緒佇列。
   施放前不再解析／排序整個裝載欄，條件不成立的技能也不會阻塞後面的就緒技能。 */
function ensureSkillReadyOrder(pEnt) {
  if (!pEnt._skillReadyOrder) pEnt._skillReadyOrder = {};
  if (typeof pEnt._skillReadySeq !== 'number' || !isFinite(pEnt._skillReadySeq)) pEnt._skillReadySeq = 0;
  if (!pEnt._skillReadyQueue) pEnt._skillReadyQueue = [];
  if (!pEnt._skillReadyQueued) pEnt._skillReadyQueued = {};

  var lo = (G && G.player && G.player.loadout) || [];
  var signature = lo.join('\u0001');
  if (pEnt._skillReadyLoadoutSignature === signature) return;
  pEnt._skillReadyLoadoutSignature = signature;

  var queue = [];
  pEnt._skillReadyQueued = {};
  for (var i = 0; i < lo.length; i++) {
    var id = lo[i];
    if (pEnt._skillReadyOrder[id] === undefined) pEnt._skillReadyOrder[id] = pEnt._skillReadySeq++;
    if ((pEnt.skillCds && pEnt.skillCds[id] || 0) <= 0) {
      queue.push(id);
      pEnt._skillReadyQueued[id] = true;
    }
  }
  pEnt._skillReadyQueue = queue;
}

function queueSkillReady(pEnt, id) {
  if (!pEnt || id === undefined || id === null) return;
  ensureSkillReadyOrder(pEnt);
  if (pEnt._skillReadyQueued[id]) return;
  var lo = (G && G.player && G.player.loadout) || [];
  if (lo.indexOf(id) < 0) return;
  pEnt._skillReadyQueue.push(id);
  pEnt._skillReadyQueued[id] = true;
}

function dequeueSkillReady(pEnt, id) {
  if (!pEnt || !pEnt._skillReadyQueued || !pEnt._skillReadyQueued[id]) return;
  pEnt._skillReadyQueued[id] = false;
  var queue = pEnt._skillReadyQueue || [];
  var index = queue.indexOf(id);
  if (index >= 0) queue.splice(index, 1);
}

/* 施法鎖定期間目標可能被其他傷害清掉，導致 executeSkillCastJob 回傳 null。
   這種失敗沒有寫入冷卻，但 beginSkillCast 已先移除就緒項；必須把仍可施放的技能補回佇列，
   否則它會呈現「沒有冷卻卻永久不再施放」。 */
function requeueSkillAfterFailedCast(pEnt, id) {
  if (!pEnt || id === undefined || id === null) return;
  if (pEnt.skillCds && (pEnt.skillCds[id] || 0) > 0) return;
  queueSkillReady(pEnt, id);
}

function markSkillReady(pEnt, id) {
  ensureSkillReadyOrder(pEnt);
  pEnt._skillReadyOrder[id] = pEnt._skillReadySeq++;
  queueSkillReady(pEnt, id);
}

// 依各技能獨立就緒順序挑一個可施放的技能（每 tick 至多一個）
/* 自動技能預設套用參數表的施放硬直；個別技能／觸發技仍可用 castTime 或 noCastLock 覆寫。 */
function skillCastTimeFor(def, opts) {
  if (opts && opts.noCastLock) return 0;
  if (!def || def.castTime === undefined) return SKILL_CAST_DEFAULT_SEC;
  var sec = Number(def.castTime);
  return isFinite(sec) && sec >= 0 ? sec : SKILL_CAST_DEFAULT_SEC;
}

/* 技能放出之後角色再站定一小段（SKILL_CAST_HOLD，參數表「施放硬直」參數b）：3D 技能動作要播完才繼續移動。
   只影響走位（bfTickPlayer 讀 _skillHold），技能放出的時間與普攻 atkCd 都不變。 */
function skillCastHoldStart(pEnt) {
  if (!pEnt) return;
  var hold = (typeof SKILL_CAST_HOLD === 'number' && isFinite(SKILL_CAST_HOLD) && SKILL_CAST_HOLD > 0) ? SKILL_CAST_HOLD : 0;
  if (hold > 0) pEnt._skillHold = hold;
}

function skillCastJobFor(pEnt) {
  for (var i = 0; i < SKILL_CAST_RT.length; i++) {
    if (SKILL_CAST_RT[i] && SKILL_CAST_RT[i].pEnt === pEnt) return SKILL_CAST_RT[i];
  }
  return null;
}

function skillCastInProgress(pEnt) {
  var job = skillCastJobFor(pEnt);
  return !!(job && job.remaining > 0);
}

function executeSkillCastJob(job) {
  if (!job) return null;
  if (job.kind === 'skill2') return castSkill2(job.pEnt, job.target, job.skillId, job.floatSel, job.opts);
  return null;
}

/* 施法動作（協議 v36 act:'cast'，2026-09-22 主角換成有施法動作的騎士）。
   在這裡送而不是在各技能裡送：技能經過 beginSkillCast，而且只有這裡知道硬直多長。
   顯示層據此面向目標、播施法姿勢，並把「釋放」那一幀對到硬直結束（技能真的放出去、特效出現）的那一刻。
   主要目標與 castSkill2 同一套挑法（先看鎖定目標），只用來決定面向。 */
function skillCastActEmit(job, lockSec) {
  if (typeof emitPlayerAct !== 'function' || !job) return;
  var t = job.target;
  var live = Array.isArray(t) ? t.filter(function (e) { return e && e.hp > 0; }) : ((t && t.hp > 0) ? [t] : []);
  var primary = null;
  if (live.length) {
    primary = (typeof bfPickPrimary === 'function') ? bfPickPrimary(live, job.pEnt && job.pEnt._lockTarget) : null;
    if (!primary) primary = live[0];
  }
  emitPlayerAct('cast', job.floatSel, primary, lockSec);
}

function beginSkillCast(job) {
  var pEnt = job && job.pEnt;
  if (!pEnt || skillCastInProgress(pEnt)) return null;
  var readyKey = job.loadoutKey || job.skillId;
  dequeueSkillReady(pEnt, readyKey);
  var sec = skillCastTimeFor(job.def, job.opts);
  if (!(sec > 0)) {
    var immediate = executeSkillCastJob(job);
    if (!immediate) requeueSkillAfterFailedCast(pEnt, readyKey);
    else { skillCastActEmit(job, 0); skillCastHoldStart(pEnt); }   // 沒有硬直：技能已經放出去了，確定成功才播
    return immediate;
  }
  skillCastActEmit(job, sec);

  var entry = {
    pEnt: pEnt,
    remaining: sec,
    kind: job.kind,
    target: job.target,
    skillId: job.skillId,
    floatSel: job.floatSel,
    def: job.def,
    loadoutKey: job.loadoutKey,
    opts: job.opts
  };
  SKILL_CAST_RT.push(entry);
  pEnt._skillCastRemaining = sec;
  pEnt._skillCastId = job.skillId || (job.loadoutKey || '');
  return { casting: true, castTime: sec, skillId: pEnt._skillCastId, killed: false, dmg: 0 };
}

function tickSkillCast(pEnt, dt) {
  var entry = skillCastJobFor(pEnt);
  if (!entry) {
    if (pEnt) {
      pEnt._skillCastRemaining = 0;
      pEnt._skillCastId = '';
    }
    return null;
  }
  var elapsed = Math.max(0, Number(dt) || 0);
  var before = entry.remaining;
  entry.remaining -= elapsed;
  if (entry.remaining > 1e-6) {
    pEnt._skillCastRemaining = entry.remaining;
    return { casting: true, castTime: entry.remaining, skillId: pEnt._skillCastId };
  }

  var index = SKILL_CAST_RT.indexOf(entry);
  if (index >= 0) SKILL_CAST_RT.splice(index, 1);
  pEnt._skillCastRemaining = 0;
  pEnt._skillCastId = '';
  var result = executeSkillCastJob(entry);
  if (!result) requeueSkillAfterFailedCast(pEnt, entry.loadoutKey || entry.skillId);
  else skillCastHoldStart(pEnt);
  result = result || { killed: false, dmg: 0 };
  return {
    completed: true,
    result: result,
    killed: !!result.killed,
    dmg: Number(result.dmg) || 0,
    remainingDt: Math.max(0, elapsed - before)
  };
}

function pickAndCastSkill(pEnt, target, floatSel, opts) {
  if (!pEnt.skillCds) pEnt.skillCds = {};
  if (skillCastInProgress(pEnt)) return null;
  ensureSkillReadyOrder(pEnt);
  var lo = G.player.loadout || [];
  var readyQueue = pEnt._skillReadyQueue || [];
  for (var qi = 0; qi < readyQueue.length; qi++) {
    var id = readyQueue[qi];
    if (opts && opts.defensiveOnly) {
      var defensiveGroup = typeof id === 'string' && id.indexOf('sg:') === 0;
      if (!(defensiveGroup && typeof skills2DefensivePrecast === 'function' && skills2DefensivePrecast(id.slice(3)))) continue;
    }
    if (!pEnt._skillReadyQueued[id] || (pEnt.skillCds[id] || 0) > 0 || lo.indexOf(id) < 0) {
      dequeueSkillReady(pEnt, id);
      qi--;
      continue;
    }
    // 新版技能群組（裝載欄鍵 'sg:<群組id>'，js/skills2.js）：依冷卻／法力／存活目標施放，沿用同一套排序。
    // 前綴用字面值——本檔可能在未載入 skills2.js 的測試環境單獨執行。
    if (typeof id === 'string' && id.indexOf('sg:') === 0) {
      if ((pEnt.skillCds[id] || 0) > 0) continue;
      var sgId = id.slice(3);
      var sgDef = (typeof SKILLS2 !== 'undefined') ? SKILLS2[sgId] : null;
      if (!sgDef || typeof castSkill2 !== 'function' ||
          typeof skills2Castable !== 'function' || !skills2Castable(sgId)) continue;
      /* 主動型被動（反擊）：裝在技能列只為生效，永不主動施放、不佔用出手節奏。
         超神進化【天霸風神斬】會把迴旋斬也變成這一類，因此判定走 skills2ActsPassive
         （表定被動 ∪ 被超神進化改為被動）——這裡不得只認 SG_PASSIVE。 */
      if (typeof skills2ActsPassive === 'function' ? skills2ActsPassive(sgId)
        : (typeof skills2IsPassive === 'function' && skills2IsPassive(sgId))) continue;
      var sgLive = Array.isArray(target)
        ? target.some(function (ent) { return ent && ent.hp > 0; })
        : !!(target && target.hp > 0);
      if (!sgLive) continue;
      /* 施法距離內已有目標時才開始吟唱，否則讓 battlefield.js 繼續驅動玩家追擊，
         避免遠距離先鎖住施法而停在原地。距離由群組自己決定（武技＝普攻近戰距離、
         魔法＝表定射程），判定收斂在 skills2CanReach——這裡不得再有第二套距離規則。 */
      var sgCanReach = function (ent) {
        if (typeof skills2CanReach === 'function') return skills2CanReach(sgId, ent);
        return typeof bfPlayerCanReach !== 'function' || bfPlayerCanReach(ent);
      };
      var sgReachable = Array.isArray(target)
        ? target.some(function (ent) { return ent && ent.hp > 0 && sgCanReach(ent); })
        : sgCanReach(target);
      if (!sgReachable && !(typeof skills2DefensivePrecast === 'function' && skills2DefensivePrecast(sgId))) continue;
      if (pEnt.mp < skills2ManaCost(sgId) * ((typeof rwManaCostFactor === 'function') ? rwManaCostFactor() : 1) &&
          !(typeof gmMpLockActive === 'function' && gmMpLockActive(pEnt))) continue;
      return beginSkillCast({
        kind: 'skill2', pEnt: pEnt, target: target, skillId: sgId,
        floatSel: floatSel, def: (typeof SKILLS2 !== 'undefined') ? SKILLS2[sgId] : null,
        // ready queue uses the loadout key ('sg:<id>'); keep the bare id for castSkill2,
        // but dequeue the exact key so the skill can re-enter when its cooldown ends.
        loadoutKey: id
      });
    }
  }
  return null;
}

function tickSkillCds(pEnt, dt) {
  if (pEnt.skillCds) {
    for (var k in pEnt.skillCds) {
      if (pEnt.skillCds[k] > 0) {
        var before = pEnt.skillCds[k];
        pEnt.skillCds[k] = Math.max(0, before - dt);
        if (pEnt.skillCds[k] === 0) markSkillReady(pEnt, k);
      }
    }
  }
}

