'use strict';
/* ============ 技能共用執行期 ============
   舊版技能系統（SKILLS 表、融合技、45 機制族）已於 2026-09-29 整批移除；
   技能本體全部由 js/skills2.js（新版技能群組 'sg:<群組id>'）與 js/potential.js（潛力技能 'potential:<id>'）提供。
   本檔只保留兩者共用的部分：
     - 冷卻／就緒佇列／施法硬直（pickAndCastSkill、beginSkillCast、tickSkillCast、tickSkillCds）
     - 裝載欄（equipSkillToLoadout／unequipSkillFromLoadout）
     - 技能點（技能熟練度＋天賦加成，目前只用於潛力技能）
     - 潛力技能資料表 POTENTIAL_TALENTS（來源 config/CSV/Skills.csv）
     - 技能特效事件組裝（skillVfxSpec／emitSkillVfx，潛力技能使用）
   數值公式（loadoutSize、skillUpgradeCost、skillMaxLvForRc、skillCdFor…）→ js/formula.js §9 */

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

/* ---- 技能系別判定 ----
   帶標籤（tags[0]）即算該系；無標籤＝null（維持純物理／純魔法）。
   目前由 skillVfxSpec 取系別配色，潛力技能經由這裡。 */
function skillElemOf(sk) {
  return (sk && Array.isArray(sk.tags) && sk.tags.length) ? sk.tags[0] : null;
}

/* ---- 潛力技能（V3；主動＝需裝入裝載欄施放、被動＝學會即常駐；經 3/4/7/10 轉「潛力」天賦節點解鎖）----
   定義來源＝config/Excel/Skills.xlsx（→ config/CSV/Skills.csv，只剩 系統分類=potential 的列）；
   欄位：type active/passive/passiveTrigger；cd 冷卻秒；base 起始值；per 每級增量（無數值上限，等級上限查轉生對照表 skillMaxLvForRc）；
   dmgType 傷害類型；dur 主動增益持續秒；mech 對應戰鬥機制（js/potential.js / formula.js / skills.js 依此分派）。
   數值來源＝天賦V3.xlsx 第 2 頁；戰鬥公式與詮釋見 game_formula.md §潛力技能。 */
var POTENTIAL_TALENTS = [
  { id: 'velocityForce', name: '極速之力', tags: [], unlockLv: 1, en: 'Velocity Force', emoji: '⚡', cat: 'potential', type: 'active', cd: 60, base: 0, per: 5, dur: 6, mech: 'aspd', desc: '在 6 秒內突破速度極限——你的攻速在此刻可以突破 5 次/秒的限制、直抵無限，至於能達到什麼程度，得看你的領悟了。每級 +5% 攻速加成。', flavor: '突破速度極限，攻速掙脫 5 次/秒的枷鎖，能達到什麼程度端看你的領悟。' },
  { id: 'lightningOverdrive', name: '雷霆過載', tags: ['lightning'], unlockLv: 1, en: 'Lightning Overdrive', emoji: '🌩️', cat: 'potential', type: 'active', cd: 45, base: 100, per: 5, atkBase: 70000, atkPer: 4000, bounces: 5, dmgType: 'magic', dur: 8, mech: 'chainLightning', desc: '雷霆過載，萬雷臨世——凝聚過載雷能轟落敵陣，造成大量電屬性魔法傷害並於敵群間彈跳撕裂，持續時間內每一秒皆再度轟落；其間雷能縈繞不散，雷電傷害大幅提升，愈戰愈烈、生生不息。', flavor: '過載的雷能在敵群間肆意跳躍，愈是激烈愈難止息。' },
  { id: 'chronoCollapse', name: '時間坍縮', tags: [], unlockLv: 1, en: 'Chronostasis', emoji: '🕳️', cat: 'potential', type: 'active', cd: 75, base: 0, per: 0.2, dur: 3, mech: 'cdrUncap', desc: '打破時空的禁錮——冷卻縮減自此突破 60% 的天塹，所有技能的冷卻如坍縮的星辰般急速消融，持續 3 秒。每級額外 −0.2% 冷卻。（不縮減自身冷卻，但仍受一般冷卻縮減加成）', flavor: '此技能對自身冷卻不生效，但冷卻縮減仍可作用於它。' },
  { id: 'absoluteSanctuary', name: '絕對領域', tags: [], unlockLv: 1, en: 'Absolute Sanctuary', emoji: '🛡️', cat: 'potential', type: 'active', cd: 75, base: 0.5, per: 0.025, mech: 'invuln', desc: '降臨絕對的領域，展開無敵結界——其間免疫一切傷害與負面效果，任何攻擊都無法觸及你分毫。基礎 0.5 秒，每級 +0.025 秒。', flavor: '在絕對的領域中，任何傷害都無法觸及你分毫。' },
  { id: 'lastStandUndying', name: '不屈意志', tags: [], unlockLv: 1, en: 'Last Undying Stand', emoji: '💀', cat: 'potential', type: 'passiveTrigger', cd: 90, base: 0, per: 0.4, mech: 'undyingGuard', desc: '意志不屈者，縱使命懸一線亦絕不倒下——受到致命傷害時免除死亡，並獲得 1 秒無敵。觸發後進入冷卻，每級 −0.4 秒。（不受冷卻縮減影響）', flavor: '意志不屈者，縱使命懸一線也絕不倒下。（此技能不受冷卻縮減影響）' },
  { id: 'timeBarrier', name: '時間結界', tags: [], unlockLv: 1, en: 'Time Barrier', emoji: '⏱️', cat: 'potential', type: 'active', cd: 45, base: 0, per: 1, dur: 8, mech: 'enemySlow', desc: '編織拖曳時光的結界，敵人的動作被無情延緩，攻速大幅降低，持續 8 秒。每級敵人攻速 −1%。（敵降低後攻速 = 原攻速 /(1+降低%)）', flavor: '結界之內，敵人的時間被無情拖曳。' },
  { id: 'dualCoreFusion', name: '混沌雙修', tags: [], unlockLv: 1, en: 'Dual-Core Fusion', emoji: '☯️', cat: 'potential', type: 'passive', base: 0, per: 0.6, mech: 'crossCore', desc: '雙核交融，物理與魔法的界限就此崩解——雷霆過載的雷擊額外承載物攻之威。每級 +0.6%。', flavor: '雙核交融，物理與魔法在你手中不再涇渭分明。' },
  { id: 'omegaImpact', name: '必殺一擊', tags: [], unlockLv: 1, en: 'Omega Impact', emoji: '🎯', cat: 'potential', type: 'active', cd: 60, base: 100, per: 3, dmgType: 'phys', mech: 'omega', desc: '凝聚全身之力於一擊，依你的爆擊率轟出毀天滅地的必殺——造成「爆擊率% × 必殺傷害加成%」的物理傷害；爆擊率愈高，此擊愈是無可匹敵。必殺傷害加成 = 100% + 每級 +3%。', flavor: '爆擊率愈高，這一擊便愈是毀天滅地。' },
  { id: 'sacredInversion', name: '聖療逆轉', tags: ['light'], unlockLv: 1, en: 'Sacred Inversion', emoji: '✨', cat: 'potential', type: 'active', cd: 45, base: 0, per: 0.5, dur: 6, mech: 'sacredInvert', desc: '聖療之光賜福於身，生命與法力回復大幅提升；滿溢的療癒之力逆轉為裁決，化作同等傷害傾瀉於敵，持續 6 秒。每級 +0.5%。', flavor: '滿溢的聖光既能療癒自身，亦能化為裁決敵人的利刃。' },
  { id: 'chronosStasis', name: '時空凝滯', tags: [], unlockLv: 1, en: 'Chronos Stasis', emoji: '🌀', cat: 'potential', type: 'active', cd: 120, base: 40, per: 0.5, dur: 8, mech: 'timeStop', desc: '封鎖周遭的時空，令萬物靜止——唯有承神之賜福者能自由行動；凝滯之間你的所有傷害大幅提升，敵人動彈不得，持續 8 秒。每級 +0.5% 所有傷害。', flavor: '唯有獲得神之賜福者，方能在凝滯的時空中行動自如。' }
];

/* ---- 技能點（2026-07-30 技能熟練度制）----
   技能點不再隨角色升級發放：總預算 = 基礎 3 點
   + 技能熟練度等級（每級 1 點）+ 潛力解鎖天賦加成。
   已使用：潛力技能等級總和；可用 = 總預算 - 已使用。 */
var SKILL_POINT_BASE = 3; // 固定基礎點數（歷史上等於開局自帶的 3 個 1 級技能；舊技能移除後保留為基礎預算，與參數表「技能點總預算」a 同步）

function ensureSkillMastery() {
  var p = G.player;
  if (!p.skillMastery || typeof p.skillMastery !== 'object') p.skillMastery = { level: 0, xp: 0 };
  var m = p.skillMastery;
  m.level = Math.max(0, Math.min(SKILL_MASTERY_MAX_LEVEL, Math.floor(Number(m.level) || 0)));
  m.xp = Math.max(0, Math.floor(Number(m.xp) || 0));
  return m;
}

/* 技能熟練度經驗入帳：滿足需求即升級（每級 1 技能點），滿級後不再累積。 */
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
    blog('📚 技能熟練度提升至 Lv.' + m.level + '（獲得 ' + leveled + ' 技能點）', 'good');
    UI.dirty.header = true;
  }
}

function totalSkillPoints() {
  var m = ensureSkillMastery();
  var talentBonus = typeof talentSkillPointBonus === 'function' ? talentSkillPointBonus() : 0;
  return Math.max(0, SKILL_POINT_BASE + m.level + talentBonus);
}
function spentSkillPoints() {
  // 潛力是技能分類，沿用同一份技能點預算，不建立額外點數。
  var spent = (typeof potentialSpentSkillPoints === 'function') ? potentialSpentSkillPoints() : 0;
  return Math.max(0, Math.floor(spent));
}
function availableSkillPoints() {
  var available = Math.max(0, totalSkillPoints() - spentSkillPoints());
  G.player.skillPoints = available;
  return available;
}

/* ---- 裝載 ---- */
function equipSkillToLoadout(id) {
  var cap = loadoutSize();
  var lo = G.player.loadout || [];
  if (lo.indexOf(id) >= 0) return '已在裝載欄';

  // 新版技能群組（'sg:<群組id>'，js/skills2.js）：第 1 階預設開啟即可裝載。
  if (typeof id === 'string' && id.indexOf('sg:') === 0) {
    var sgId = id.slice(3);
    if (typeof SKILLS2 === 'undefined' || !SKILLS2[sgId]) return '未知技能群組';
    if (typeof skills2Castable === 'function' && !skills2Castable(sgId)) return '尚未學習';
  } else if (typeof id === 'string' && id.indexOf('potential:') === 0) {
    var pid = id.slice(10);
    var pdef = (typeof potentialDef === 'function') ? potentialDef(pid) : null;
    if (!pdef) return '未知技能';
    if (typeof potentialEquippable !== 'function' || !potentialEquippable(pdef)) return '被動潛力技能學會即常駐，無需裝備';
    if (!potentialLevel(pid)) return '尚未學習';
    if (typeof potentialSkillActive === 'function' && !potentialSkillActive(pid)) return '潛力節點尚未解鎖';
  } else {
    return '未知技能';
  }

  var firstEmpty = -1;
  for (var i = 0; i < cap; i++) {
    if (!lo[i]) { firstEmpty = i; break; }
  }
  if (firstEmpty < 0) return '裝載欄已滿（' + cap + ' 格，依參數表計算）';

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

/* ---- 技能特效事件（潛力技能使用）----
   模擬層只負責「發生了什麼」，畫法在 js/vfx.js。特效種類不逐一手寫，而是由範圍決定形狀、
   系統分類與屬性決定顏色、技能自己的 emoji 當投射物圖案。
   實際播放的 Preset 只來自表格欄位（sk.vfx = { cast, attack, projectile, hit, ground }）；
   沒有配置特效就是空表，不得讓顯示層自行補畫法。 */
function skillVfxColor(sk, fx) {
  var elem = skillElemOf(sk);
  if (elem && typeof ELEM_INFO !== 'undefined' && ELEM_INFO[elem]) return ELEM_INFO[elem].color;
  var cat = (sk && sk.cat) || 'phys';
  if (typeof VFX_CAT_COLORS !== 'undefined' && VFX_CAT_COLORS[cat]) return VFX_CAT_COLORS[cat];
  return '#ffffff';
}

/* 由技能資料推導特效原型：
     沒有傷害段（純增益／治療／護盾）          → selfBuff（我方身上的光暈）
     全場                                      → rain（天降）
     一直線（1*N 或 N*1）                      → beam（貫穿）
     方框（N*M 皆 >1）                         → burst（爆發）
     單體：物理系 → slash（斬擊）、其餘 → projectile（投射物） */
function skillVfxKind(sk, fx, shape) {
  if (!fx || !fx.dmgType) return 'selfBuff';
  var sp = (typeof bfParseShape === 'function') ? bfParseShape(shape) : { kind: 'single', w: 1, h: 1 };
  if (sp.kind === 'all') return 'rain';
  if (sp.kind === 'box') {
    if (sp.w > 1 && sp.h > 1) return 'burst';
    return 'beam';
  }
  return (sk && sk.cat === 'phys') ? 'slash' : 'projectile';
}

/* 回傳可直接送上協議的特效事件內容（純資料，不含實體參照）。
   targetIds 由呼叫端以 enemyEventFloatTarget 解析完成；area 為範圍落點的圓（非區域類傳 null）。 */
function skillVfxSpec(sk, fx, shape, targetIds, area, extra) {
  var spec = {
    fxKind: skillVfxKind(sk, fx, shape),
    glyph: (sk && sk.emoji) || '✨',
    color: skillVfxColor(sk, fx),
    // 屬性與分類（協議 v17）：顯示層據此挑選元素化畫法與受擊特效；缺欄位時退回 color 單色畫法。
    elem: skillElemOf(sk),
    cat: (sk && sk.cat) || null,
    targets: targetIds || [],
    area: area || null,
    dur: 0.5,
    count: Math.max(1, Math.min(5, (fx && fx.hits) || 1))
  };
  if (extra) for (var k2 in extra) spec[k2] = extra[k2];
  spec.vfx = (sk && sk.vfx && typeof sk.vfx === 'object') ? sk.vfx : {};
  if (spec.fxKind === 'rain') spec.dur = 0.75;
  return spec;
}

/* 送出特效事件；Worker 端由 shim 轉成協議事件，Node 測試環境沒有這支就靜靜略過。 */
function emitSkillVfx(spec) {
  if (spec && typeof playCombatVfx === 'function') playCombatVfx(spec);
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
  if (job.kind === 'potential') {
    return castPotentialSkill(job.pEnt, job.target, job.def, job.floatSel, job.loadoutKey);
  }
  return null;
}

/* 施法動作（協議 v36 act:'cast'，2026-09-22 主角換成有施法動作的騎士）。
   在這裡送而不是在各技能裡送：新版與潛力技能都經過 beginSkillCast，而且只有這裡知道硬直多長。
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
    else skillCastActEmit(job, 0);   // 沒有硬直：技能已經放出去了，確定成功才播
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
    // 前綴用字面值（比照 'potential:'）——本檔可能在未載入 skills2.js 的測試環境單獨執行。
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
    // 潛力技能（裝載欄鍵 'potential:<id>'）：無法力消耗，依冷卻與存活目標施放，其餘沿用同一套排序。
    // 其他鍵（不屬於 sg: 或 potential:）一律略過——存檔讀入時已清除，這裡只是防呆。
    if (typeof id === 'string' && id.indexOf('potential:') === 0) {
      if ((pEnt.skillCds[id] || 0) > 0) continue;
      var pDef = (typeof potentialDef === 'function') ? potentialDef(id.slice(10)) : null;
      if (!pDef || typeof potentialSkillActive !== 'function' || !potentialSkillActive(pDef.id)) continue;
      var hasLiveTarget = Array.isArray(target)
        ? target.some(function (ent) { return ent && ent.hp > 0; })
        : !!(target && target.hp > 0);
      if (!hasLiveTarget) continue;
      return beginSkillCast({
        kind: 'potential', pEnt: pEnt, target: target, skillId: id,
        floatSel: floatSel, def: pDef, loadoutKey: id
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

