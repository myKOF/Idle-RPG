'use strict';
/* ============ 狀態系統（Status） ============
   技能／狀態分工（2026-08-11 技能及狀態改造）：
     - 技能（js/skills.js）＝「一次性效果」：本體傷害、治療、護盾、法力、金幣…施放當下結算完畢。
     - 狀態（本檔）＝「有持續時間的效果」：持續傷害、持續回復、控場、增益／減益。
   例：火球術 ＝ 一次性魔法火屬性傷害 ＋「燃燒」狀態（火屬性持續傷害）。

   ---- 唯一定義來源 ----
   所有狀態的身分（ID／名稱／圖標）與行為（效果／傷害／持續時間／作用間隔）一律寫在下方
   STATUS 表；表由 config/Excel/Status.xlsx ↔ config/CSV/Status.csv 撥離管理
   （→ tools/config_tables.cjs SCHEMAS.Status，與其他六表同一顆「套用參數.bat」）。
   程式端不得再有第二份狀態定義：UI 的圖示與名稱、戰鬥日誌、技能說明文字全部讀這張表。

   ---- 技能如何引用狀態 ----
   技能 fx 以 status 陣列引用：
     "status": [ { "id": "burn", "dmg": 20, "dur": 4 } ]
   id 以外的欄位皆為選填；沒填就吃狀態表的預設值（使用者決策 2026-08-11：
   狀態表定義預設值，技能可覆寫——保留火球／隕石／里程碑各自的成長曲線）。

   ---- 物理儲存 ----
   狀態實例仍存放在實體既有的三個容器（dots／buffs／effects），但一律由本檔的
   applyStatus 寫入，且每筆實例都帶 sid 指回狀態表；容器只是「索引」，不是第二套系統。
   低階寫入器 applyDot／applyBuff／applyEffect 留在 js/combat.js（控場遞減、無敵免疫等
   戰鬥規則在那裡），本檔負責「狀態是什麼、數值多少、多久跳一次」。 */

/* 作用間隔預設值：狀態表沒填時採用。0＝不分段（連續結算，等同改造前的行為）。 */
var STATUS_DEFAULT_INTERVAL = 1;

/* ---- 狀態表（撥離：config/CSV/Status.csv → 本字面值） ----
   欄位語意：
     name        狀態名稱（戰鬥日誌與 UI 顯示）
     icon        狀態圖標
     kind        狀態分類：buff＝增益／debuff＝減益／ctrl＝控場（決定 UI 配色與淨化範圍）
     effect      狀態效果：dot＝持續傷害／hot＝持續回復／stat＝屬性增減／ctrl＝行動限制
     key         效果鍵值：stat→增益鍵（atkUp…）；ctrl→效果鍵（stun/slow/invuln）；dot/hot 留空
     elem        傷害屬性（fire/ice/lightning/poison/light/dark；空＝無屬性）
     dmgSource   傷害來源：skill＝占技能傷害%／maxHp＝占目標最大生命%／value＝直接數值
     dmg         狀態傷害：每次作用的量，依 dmgSource 解讀（stat/ctrl 不使用）
     capStat     傷害上限參照屬性（空＝無上限），capMult＝倍率；上限＝施法者該屬性 × 倍率
     val         效果數值：stat 的增減幅度%（dot/hot/ctrl 不使用）
     dur         持續時間（秒）
     interval    作用間隔時間（秒）；0＝不分段
     stack       疊加規則：refresh＝重新計時／strongest＝取高並重新計時／stack＝疊層
     maxStacks   最大疊層（stack 規則用）
     desc        說明 */
var STATUS = {
  bleed: { name: '流血', icon: '🩸', kind: 'debuff', effect: 'dot', key: '', elem: '', dmgSource: 'skill', dmg: 25, capStat: '', capMult: 0, val: 0, dur: 5, interval: 1, stack: 'strongest', maxStacks: 1, desc: '傷口持續失血，每次作用造成技能傷害的一部分。' },
  burn: { name: '燃燒', icon: '🔥', kind: 'debuff', effect: 'dot', key: '', elem: 'fire', dmgSource: 'skill', dmg: 20, capStat: '', capMult: 0, val: 0, dur: 4, interval: 1, stack: 'strongest', maxStacks: 1, desc: '火焰持續灼燒，每次作用造成火屬性傷害。' },
  poison: { name: '中毒', icon: '☠️', kind: 'debuff', effect: 'dot', key: '', elem: 'poison', dmgSource: 'skill', dmg: 40, capStat: '', capMult: 0, val: 0, dur: 6, interval: 1, stack: 'strongest', maxStacks: 1, desc: '毒素侵蝕血脈，每次作用造成毒屬性傷害。' },
  corrode: { name: '侵蝕', icon: '🕳️', kind: 'debuff', effect: 'dot', key: '', elem: 'dark', dmgSource: 'skill', dmg: 25, capStat: '', capMult: 0, val: 0, dur: 4, interval: 1, stack: 'strongest', maxStacks: 1, desc: '暗影侵蝕軀體，每次作用造成暗屬性傷害。' },
  plague: { name: '瘟疫', icon: '🦠', kind: 'debuff', effect: 'dot', key: '', elem: 'poison', dmgSource: 'skill', dmg: 40, capStat: '', capMult: 0, val: 0, dur: 6, interval: 1, stack: 'strongest', maxStacks: 1, desc: '疫病蔓延，每次作用造成毒屬性傷害。' },
  deathCurse: { name: '詛咒', icon: '💀', kind: 'debuff', effect: 'dot', key: '', elem: 'dark', dmgSource: 'maxHp', dmg: 2.4, capStat: 'matk', capMult: 6, val: 0, dur: 5, interval: 1, stack: 'strongest', maxStacks: 1, desc: '每次作用造成目標最大生命一定比例的傷害，總量受施法者魔攻上限限制。' },

  stun: { name: '暈眩', icon: '😵', kind: 'ctrl', effect: 'ctrl', key: 'stun', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 1, interval: 0, stack: 'refresh', maxStacks: 1, desc: '無法行動；持續時間受控場遞減與韌性影響。' },
  slow: { name: '減速', icon: '🐌', kind: 'ctrl', effect: 'ctrl', key: 'slow', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 3, interval: 0, stack: 'refresh', maxStacks: 1, desc: '攻擊速度下降；持續時間受控場遞減與韌性影響。' },
  invuln: { name: '無敵', icon: '✨', kind: 'buff', effect: 'ctrl', key: 'invuln', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 3, interval: 0, stack: 'refresh', maxStacks: 1, desc: '免疫一切傷害與負面狀態。' },

  regen: { name: '再生', icon: '💚', kind: 'buff', effect: 'hot', key: 'hot', elem: '', dmgSource: 'maxHp', dmg: 2.5, capStat: '', capMult: 0, val: 0, dur: 6, interval: 0, stack: 'strongest', maxStacks: 1, desc: '每秒回復最大生命的一定比例。' },

  atkUp: { name: '攻擊提升', icon: '⚔️', kind: 'buff', effect: 'stat', key: 'atkUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 15, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '攻擊力提高。' },
  defUp: { name: '防禦提升', icon: '🛡️', kind: 'buff', effect: 'stat', key: 'defUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 40, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '防禦力提高。' },
  aspdUp: { name: '攻速提升', icon: '⚡', kind: 'buff', effect: 'stat', key: 'aspdUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 25, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '攻擊速度提高。' },
  evasionUp: { name: '閃避提升', icon: '🌀', kind: 'buff', effect: 'stat', key: 'evasionUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 25, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '閃避提高。' },
  critDmgUp: { name: '爆傷提升', icon: '💥', kind: 'buff', effect: 'stat', key: 'critDmgUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 40, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '爆擊傷害提高。' },
  blockUp: { name: '格擋提升', icon: '🔰', kind: 'buff', effect: 'stat', key: 'blockUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 12, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '格擋率提高。' },
  thornsUp: { name: '反震提升', icon: '🌵', kind: 'buff', effect: 'stat', key: 'thornsUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 15, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '反震傷害提高。' },
  lootUp: { name: '掉寶提升', icon: '🎁', kind: 'buff', effect: 'stat', key: 'lootUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 15, dur: 10, interval: 0, stack: 'refresh', maxStacks: 1, desc: '掉寶率提高。' },
  penUp: { name: '穿透提升', icon: '🗡️', kind: 'buff', effect: 'stat', key: 'penUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 25, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '物理與魔法穿透提高。' },
  allDmgUp: { name: '所有傷害提升', icon: '🌌', kind: 'buff', effect: 'stat', key: 'allDmgUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '潛力【時空凝滯】：所有傷害提高。' },
  velocitySurge: { name: '極速之力', icon: '💨', kind: 'buff', effect: 'stat', key: 'velocitySurge', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '潛力【極速之力】：攻速提高。' },
  lightningOverload: { name: '雷霆過載', icon: '🌩️', kind: 'buff', effect: 'stat', key: 'lightningOverload', elem: 'lightning', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '潛力【雷霆過載】：雷電傷害提高。' },
  chronoCdr: { name: '時間坍縮', icon: '⏱️', kind: 'buff', effect: 'stat', key: 'chronoCdr', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '潛力【時間坍縮】：冷卻縮減。' },
  sacredInvert: { name: '聖療逆轉', icon: '🕊️', kind: 'buff', effect: 'stat', key: 'sacredInvert', elem: 'light', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '潛力【聖療逆轉】：回復與溢傷轉換。' },
  legendaryDarkUp: { name: '暗影強化', icon: '🌑', kind: 'buff', effect: 'stat', key: 'legendaryDarkUp', elem: 'dark', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '傳奇特效：暗屬性傷害提高。' },
  legendaryGuardRed: { name: '守護減傷', icon: '🛡️', kind: 'buff', effect: 'stat', key: 'legendaryGuardRed', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '傳奇特效：受到的傷害降低。' },
  legendaryLightShieldRed: { name: '聖盾減傷', icon: '🔆', kind: 'buff', effect: 'stat', key: 'legendaryLightShieldRed', elem: 'light', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '傳奇特效：受到的傷害降低。' },

  atkDown: { name: '攻擊下降', icon: '⚔️', kind: 'debuff', effect: 'stat', key: 'atkDown', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 18, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '目標攻擊力下降。' },
  defDown: { name: '防禦下降', icon: '🛡️', kind: 'debuff', effect: 'stat', key: 'defDown', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '目標防禦力下降（舊存檔融合技快照相容保留，新設計改用穿透提升）。' },
  enemyAspdDown: { name: '攻速下降', icon: '⏳', kind: 'debuff', effect: 'stat', key: 'enemyAspdDown', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '潛力【時間結界】：目標攻擊速度下降。' }
};

/* ---- 反查索引 ----
   舊有呼叫點（元素特效、傳奇特效、融合技快照）不帶 sid，改由鍵值／名稱反查補上，
   讓每一筆狀態實例都能連回狀態表拿到圖標與名稱。 */
var STATUS_BY_KEY = {};
var STATUS_BY_NAME = {};
(function buildStatusIndex() {
  for (var sid in STATUS) {
    var d = STATUS[sid];
    if (d.key) STATUS_BY_KEY[d.key] = sid;
    if (d.name && !STATUS_BY_NAME[d.name]) STATUS_BY_NAME[d.name] = sid;
  }
})();

function statusDef(sid) { return (sid && STATUS[sid]) || null; }
function statusIdByKey(key) { return STATUS_BY_KEY[key] || (STATUS[key] ? key : ''); }
function statusIdByName(name) { return STATUS_BY_NAME[name] || ''; }
function statusName(sid, fallback) { var d = statusDef(sid); return d ? d.name : (fallback || ''); }
function statusIcon(sid, fallback) { var d = statusDef(sid); return d ? d.icon : (fallback || '✨'); }
function statusIsDebuff(sid) { var d = statusDef(sid); return !!d && d.kind === 'debuff'; }

/* 狀態表數值取用：ctx 沒給就吃表上的預設值。 */
function statusNum(ctxVal, defVal) {
  var v = Number(ctxVal);
  return (ctxVal === undefined || ctxVal === null || ctxVal === '' || !isFinite(v)) ? Number(defVal) || 0 : v;
}

/* 依「傷害來源」把狀態傷害換算成每秒傷害（dps）。
   儲存採 dps 而非「每跳量」，是為了讓既有的 DoT 引爆（剩餘總值＝dps×剩餘秒數）、
   DoT 轉移與延長等機制不必改算法；每跳實際傷害＝dps×作用間隔（tickStatuses）。
   ctx：
     base   技能傷害基準（dmgSource='skill' 用）
     dps    直接指定每秒傷害（元素特效／傳奇／融合快照用，優先於 dmgSource）
     dmg    覆寫狀態表的「狀態傷害」
     mult   效果倍率（技能天賦加成等）
     stats  施法者屬性（解算傷害上限 capStat×capMult 用） */
function statusDps(ent, def, ctx) {
  var mult = statusNum(ctx.mult, 1);
  if (ctx.dps !== undefined && ctx.dps !== null) return Number(ctx.dps) * mult;
  var amount = statusNum(ctx.dmg, def.dmg);
  var per;
  if (def.dmgSource === 'maxHp') per = (Number(ent && ent.maxHp) || 0) * amount / 100;
  else if (def.dmgSource === 'value') per = amount;
  else per = statusNum(ctx.base, 0) * amount / 100;
  if (def.capStat && def.capMult > 0 && ctx.stats) {
    var cap = (Number(ctx.stats[def.capStat]) || 0) * def.capMult;
    if (cap > 0) per = Math.min(per, cap);
  }
  return per * mult;
}

/* ---- 唯一的狀態授予入口 ----
   ent  目標實體（玩家戰鬥實體或敵人）
   sid  狀態ID（狀態表的鍵）
   ctx  覆寫值與情境：{ base, dps, dmg, val, dur, interval, mult, stats }
   回傳：ctrl 類回傳實際生效秒數（控場遞減後）／其餘回傳 true；未生效回傳 false。
   控場遞減、BOSS 控制免疫、無敵免疫等戰鬥規則仍由 js/combat.js 的低階寫入器負責。 */
function applyStatus(ent, sid, ctx) {
  var def = statusDef(sid);
  if (!ent || !def) return false;
  ctx = ctx || {};
  var dur = statusNum(ctx.dur, def.dur);
  if (!(dur > 0)) return false;
  var mult = statusNum(ctx.mult, 1);
  switch (def.effect) {
    case 'dot':
      return applyDot(ent, statusDps(ent, def, ctx), dur, def.name, sid,
        statusNum(ctx.interval, def.interval));
    case 'hot':
    case 'stat':
      return applyBuff(ent, def.key, statusNum(ctx.val, def.effect === 'hot' ? def.dmg : def.val) * mult, dur, sid);
    case 'ctrl':
      return applyEffect(ent, def.key, dur, sid);
  }
  return false;
}

/* ---- 統一列舉：實體身上生效中的所有狀態 ----
   UI 的狀態列、提示框與戰鬥日誌一律用這支，圖標與名稱直接來自狀態表。
   回傳 [{ sid, name, icon, kind, until, remain, val, dps }]，順序：控場 → 持續傷害 → 增益／減益。 */
function statusEntries(ent) {
  var out = [];
  if (!ent) return out;
  var k, sid, def;
  if (ent.effects) {
    for (k in ent.effects) {
      if (!((ent.effects[k] || 0) > GT)) continue;
      sid = statusIdByKey(k);
      def = statusDef(sid);
      out.push({ sid: sid, name: def ? def.name : k, icon: def ? def.icon : '❗',
        kind: def ? def.kind : 'ctrl', until: ent.effects[k], remain: ent.effects[k] - GT, val: 0, dps: 0 });
    }
  }
  if (ent.dots) {
    for (var i = 0; i < ent.dots.length; i++) {
      var d = ent.dots[i];
      if (!d || !(d.until > GT)) continue;
      sid = d.sid || statusIdByName(d.name);
      def = statusDef(sid);
      out.push({ sid: sid, name: def ? def.name : (d.name || '持續傷害'), icon: def ? def.icon : '🩸',
        kind: def ? def.kind : 'debuff', until: d.until, remain: d.until - GT, val: 0, dps: d.dps || 0 });
    }
  }
  if (ent.buffs) {
    for (k in ent.buffs) {
      var b = ent.buffs[k];
      if (!b || !(b.until > GT)) continue;
      sid = b.sid || statusIdByKey(k);
      def = statusDef(sid);
      out.push({ sid: sid, name: def ? def.name : k, icon: def ? def.icon : '💪',
        kind: def ? def.kind : 'buff', until: b.until, remain: b.until - GT, val: b.val || 0, dps: 0 });
    }
  }
  return out;
}

/* 指定狀態是否生效中（不分容器）。 */
function statusActive(ent, sid) {
  var def = statusDef(sid);
  if (!ent || !def) return false;
  if (def.effect === 'ctrl') return (ent.effects && (ent.effects[def.key] || 0) > GT) || false;
  if (def.effect === 'stat' || def.effect === 'hot') {
    var b = ent.buffs && ent.buffs[def.key];
    return !!(b && b.until > GT);
  }
  if (!ent.dots) return false;
  for (var i = 0; i < ent.dots.length; i++) {
    var d = ent.dots[i];
    if (d && d.until > GT && (d.sid === sid || (!d.sid && d.name === def.name))) return true;
  }
  return false;
}

/* 指定狀態的剩餘秒數（0＝未生效）。 */
function statusRemain(ent, sid) {
  var list = statusEntries(ent);
  for (var i = 0; i < list.length; i++) if (list[i].sid === sid) return Math.max(0, list[i].remain);
  return 0;
}
