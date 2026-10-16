'use strict';
/* ============================================================
   elite_data.js — 敵人專用技能：Skills2 表（類別＝enemy）→ 引擎用的技能定義
   ------------------------------------------------------------
   資料的唯一來源是 config/Excel/Skills2.xlsx 的敵人列（回寫成 js/skills2.js 的 ENEMY_SKILLS2）；
   這支檔案不放任何數字，只把那份資料整理成 js/elite.js（Worker）與 js/battle-elite.js（顯示）好用的形狀。
   每種敵人帶哪些技能在 NPC 表（專屬技能＝群組ID、隨機技能＝從 pool＝random 的技能中抽幾個）。

   定義形狀 ELITE_AFFIXES[id]：
     id／name／emoji／color（光環與日誌用色）／elem／dmgType／desc
     kind    active＝定時施放｜passive＝常駐或被動觸發
     arch    行為原型（js/elite.js 的 ELITE_CASTERS／ELITE_PASSIVE_ARCHS 要有對應）
     pool    random＝隨機技能池｜exclusive＝專屬技能
     cd      [最短, 最長] 冷卻秒數（被動＝[0,0]）
     v       畫面角色 → Preset：cast／attack／proj／hit／ground／field（本體六欄）
                              attack2／proj2／hit2／ground2／field2（觸發五欄）
     其餘     效果參數(JSON) 的鍵；距離類的鍵在表上是「米」，這裡換成座標單位（1 米＝10）
   ⚠️ preset id 只寫在 Skills2 表（USAGE：配置表填入），這裡與 js/elite.js 都不得另寫字串。
   ============================================================ */

var ELITE_METER = 10;   // 1 米＝10 座標單位（同 js/battlefield.js BF_SYSTEM_UNITS_PER_METER）
/* 表上以「米」填寫的參數鍵（換成座標單位）。速度類（speed／move／expand）是「米／秒」，同樣乘 10。 */
var ELITE_METER_KEYS = ['r', 'spread', 'w2', 'h2', 'len', 'wid', 'width', 'dist', 'drift', 'hitR', 'speed', 'pull', 'pullR', 'minPull', 'push', 'bodyD',
  'burstR', 'trailGap', 'back', 'throwRange', 'coreR', 'minRange', 'thick', 'ballR', 'ballGap', 'move', 'expand', 'arcH', 'arc'];
var ELITE_ROLE_OF = {
  cast: 'cast', attack: 'attack', projectile: 'proj', hit: 'hit', ground: 'ground', field: 'field'
};
var ELITE_TRIGGER_ROLE_OF = {
  attack: 'attack2', projectile: 'proj2', hit: 'hit2', ground: 'ground2', field: 'field2'
};

var ELITE_AFFIXES = {};
var ELITE_AFFIX_ORDER = [];

function eliteBuildDef(id, src) {
  var fx = src.fx || {};
  var d = {};
  Object.keys(fx).forEach(function (k) {
    var v = fx[k];
    if (ELITE_METER_KEYS.indexOf(k) >= 0 && typeof v === 'number') v = Math.round(v * ELITE_METER * 100) / 100;
    d[k] = v;
  });
  d.id = id;
  d.name = src.name;
  d.emoji = src.emoji;
  d.elem = src.elem || null;
  d.dmgType = src.dmgType || null;
  d.desc = src.desc || '';
  d.status = src.status || null;   // { self:[{id,dur…}], enemy:[…] }：我方狀態＝施放者自己身上、敵方狀態＝玩家身上（Skills2 的狀態欄）
  d.color = fx.color || '#ffffff';
  d.kind = fx.kind || 'active';
  d.pool = fx.pool || 'exclusive';
  d.cd = Array.isArray(src.cd) ? src.cd.slice() : [0, 0];
  d.v = {};
  Object.keys(src.vfx || {}).forEach(function (k) { if (ELITE_ROLE_OF[k]) d.v[ELITE_ROLE_OF[k]] = src.vfx[k]; });
  Object.keys(src.triggerVfx || {}).forEach(function (k) { if (ELITE_TRIGGER_ROLE_OF[k]) d.v[ELITE_TRIGGER_ROLE_OF[k]] = src.triggerVfx[k]; });
  return d;
}
function eliteSkillsInit() {
  ELITE_AFFIXES = {};
  ELITE_AFFIX_ORDER = [];
  if (typeof ENEMY_SKILLS2 === 'undefined' || !ENEMY_SKILLS2) return;
  Object.keys(ENEMY_SKILLS2).forEach(function (id) {
    ELITE_AFFIXES[id] = eliteBuildDef(id, ENEMY_SKILLS2[id]);
    ELITE_AFFIX_ORDER.push(id);
  });
  if (typeof BSK_PREFIX === 'string') bskRegisterDefs();   // 重建時封魔塔 BOSS 的玩家技能定義跟著回來（首次載入由檔尾登記）
}
eliteSkillsInit();

function eliteAffixDef(id) { return ELITE_AFFIXES[id] || null; }
function eliteAffixLabel(id) {
  var d = ELITE_AFFIXES[id];
  return d ? (d.emoji + d.name) : String(id);
}
/* 某個池子的全部技能 id：random＝隨機技能池、exclusive＝專屬技能。 */
function eliteSkillIds(pool) {
  return ELITE_AFFIX_ORDER.filter(function (id) { return !pool || ELITE_AFFIXES[id].pool === pool; });
}

/* ============================================================
   封魔塔 BOSS 的玩家技能（Skills2 超神進化選項 → 敵人技能定義）
   ------------------------------------------------------------
   資料的唯一來源仍是 Skills2 的超神進化列：選項的「封魔塔層級」門檻就是「這一層的 BOSS 解鎖它」，
   所以該層 BOSS 固定使用它（不另開一份對照表）；效果參數、特效 Preset、狀態都直接讀玩家技能那一列。
   這裡只做資料整理（主執行緒與 Worker 共用，顯示層要拿名稱／圖示／屬性）；施放行為在 js/elite_boss.js（Worker）。
   定義 id＝ps_<超神ID>，放進 ELITE_AFFIXES（pool＝player），但不進 ELITE_AFFIX_ORDER，
   所以隨機技能池（eliteSkillIds）與「敵人技能表」的核對測試都不受影響。
   ============================================================ */
var BSK_PREFIX = 'ps_';
var BSK_RANDOM_FROM_FLOOR = 101;   // 這一層起沒有解鎖技能的 BOSS 改為每場隨機抽玩家技能
var BSK_RANDOM_PLAYER_COUNT = 2;   // 隨機抽幾個玩家技能
var BSK_EXTRA_NPC_COUNT = 2;       // 沒有解鎖技能的 BOSS 額外多抽幾個 NPC 隨機技能

function bskLevel() { return (typeof SG_TIER_MAX_LV === 'number' && SG_TIER_MAX_LV > 0) ? SG_TIER_MAX_LV : 10; }
function bskIdOf(ultId) { return BSK_PREFIX + ultId; }
function bskIsId(id) { return typeof id === 'string' && id.indexOf(BSK_PREFIX) === 0; }

/* 全部超神進化選項（依群組、選項順序）：{ gid, idx, ult, g }。 */
function bskOptionList() {
  var out = [];
  if (typeof SKILLS2 === 'undefined' || !SKILLS2) return out;
  Object.keys(SKILLS2).forEach(function (gid) {
    var g = SKILLS2[gid];
    (g.ult || []).forEach(function (u, idx) { out.push({ gid: gid, idx: idx, ult: u, g: g }); });
  });
  return out;
}
/* 該層 BOSS 解鎖的選項（可能同一層解鎖好幾個）。 */
function bskFixedOptions(floor) {
  var f = Math.floor(Number(floor) || 0);
  if (!(f > 0)) return [];
  return bskOptionList().filter(function (o) { return o.ult.unlock && Number(o.ult.unlock.tower) === f; });
}
/* 這一場 BOSS 要帶的玩家技能與額外 NPC 隨機技能數：{ ids: [ps_…], extraNpc: n }。
   解鎖技能的 BOSS＝固定專屬；沒解鎖：101 層以前額外 NPC 隨機技能，101 層起每場隨機抽玩家技能。 */
function bskPickForFloor(floor) {
  var fixed = bskFixedOptions(floor);
  if (fixed.length) return { ids: fixed.map(function (o) { return bskIdOf(o.ult.id); }), extraNpc: 0, fixed: true };
  if (Math.floor(Number(floor) || 0) >= BSK_RANDOM_FROM_FLOOR) {
    var pool = bskOptionList().map(function (o) { return bskIdOf(o.ult.id); });
    var ids = [];
    var n = Math.min(BSK_RANDOM_PLAYER_COUNT, pool.length);
    while (ids.length < n) {
      var k = Math.floor(Math.random() * pool.length);
      ids.push(pool.splice(k, 1)[0]);
    }
    return { ids: ids, extraNpc: 0, fixed: false };
  }
  return { ids: [], extraNpc: BSK_EXTRA_NPC_COUNT, fixed: false };
}

/* 玩家技能那一列的畫面角色：本體六欄（含從第 1 階起逐欄向前繼承）與觸發五欄。 */
function bskVfxRoles(opt) {
  var v = {};
  var body = (typeof sgVfxRoles === 'function') ? sgVfxRoles(opt.gid, { vfxUlt: opt.ult.id, vfxBase: true }) : {};
  Object.keys(body || {}).forEach(function (k) { if (ELITE_ROLE_OF[k]) v[ELITE_ROLE_OF[k]] = body[k]; });
  var trig = opt.ult.triggerVfx || {};
  Object.keys(trig).forEach(function (k) {
    if (ELITE_TRIGGER_ROLE_OF[k] && typeof trig[k] === 'string' && trig[k].trim()) v[ELITE_TRIGGER_ROLE_OF[k]] = trig[k].trim();
  });
  return v;
}
function bskBuildDef(opt) {
  var g = opt.g, u = opt.ult;
  var elem = g.elem || (u.fx && u.fx.elem) || null;
  var d = {
    id: bskIdOf(u.id), name: u.name, emoji: g.emoji || '✨', elem: elem || 'phys', dmgType: g.dmgType || 'phys',
    desc: (typeof describeSkill2Ult === 'function') ? describeSkill2Ult(opt.gid, opt.idx, bskLevel()) : String(u.desc || ''),
    color: '#ffe9a8', kind: 'active', pool: 'player', cd: [10, 16], arch: 'psk',
    gid: opt.gid, ultId: u.id, ultIdx: opt.idx, groupName: g.name, status: u.status || null,
    v: bskVfxRoles(opt)
  };
  return d;
}
function bskRegisterDefs() {
  bskOptionList().forEach(function (opt) { ELITE_AFFIXES[bskIdOf(opt.ult.id)] = bskBuildDef(opt); });
}
bskRegisterDefs();
