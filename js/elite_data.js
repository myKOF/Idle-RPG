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
