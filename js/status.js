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
     effect      狀態效果：dot＝持續傷害／hot＝持續回復／stat＝屬性增減／ctrl＝行動限制／shield＝吸收護盾
     key         效果鍵值：stat→增益鍵（atkUp…）；ctrl→效果鍵（stun/slow/invuln）；hot→hot；shield→shield；dot 留空
     elem        傷害屬性（fire/ice/lightning/poison/light/dark；空＝無屬性）
     dmgSource   傷害來源：skill＝占技能傷害%／maxHp＝占最大生命%（護盾＝占施法者最大生命%）／value＝直接數值
     dmg         狀態傷害：每次作用的量，依 dmgSource 解讀（stat/ctrl 不使用）
     capStat     傷害上限參照屬性（空＝無上限），capMult＝倍率；上限＝施法者該屬性 × 倍率
     val         效果數值：stat 的增減幅度%（dot/hot/ctrl 不使用）
     dur         持續時間（秒）
     interval    作用間隔時間（秒）；0＝不分段
     stack       疊加規則：refresh＝重新計時（後蓋前）／strongest＝取高並重新計時／
                 stack＝疊層（單層值取高、層數 +1 至上限，實際效果＝單層值 × 層數）
     maxStacks   最大疊層（stack 規則用；其餘規則填 1）
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
  invuln: { name: '無敵結界（免疫一切傷害與負面效果）', icon: '✨', kind: 'buff', effect: 'ctrl', key: 'invuln', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 3, interval: 0, stack: 'refresh', maxStacks: 1, desc: '免疫一切傷害與負面狀態。' },

  regen: { name: '再生', icon: '💚', kind: 'buff', effect: 'hot', key: 'hot', elem: '', dmgSource: 'maxHp', dmg: 2.5, capStat: '', capMult: 0, val: 0, dur: 6, interval: 0, stack: 'strongest', maxStacks: 1, desc: '每秒回復最大生命的一定比例。' },
  shield: { name: '護盾', icon: '🛡️', kind: 'buff', effect: 'shield', key: 'shield', elem: '', dmgSource: 'maxHp', dmg: 18, capStat: '', capMult: 0, val: 0, dur: 15, interval: 0, stack: 'strongest', maxStacks: 1, desc: '吸收傷害的屏障，占施法者最大生命一定比例；被打完或時間到就消失（時間到時未用完的部分一併消失）。' },

  atkUp: { name: '攻擊', icon: '⚔️', kind: 'buff', effect: 'stat', key: 'atkUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 15, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '攻擊力提高。' },
  defUp: { name: '防禦', icon: '🛡️', kind: 'buff', effect: 'stat', key: 'defUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 40, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '防禦力提高。' },
  aspdUp: { name: '攻速', icon: '⚡', kind: 'buff', effect: 'stat', key: 'aspdUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 25, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '攻擊速度提高。' },
  evasionUp: { name: '閃避', icon: '🌀', kind: 'buff', effect: 'stat', key: 'evasionUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 25, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '閃避提高。' },
  critDmgUp: { name: '爆傷', icon: '💥', kind: 'buff', effect: 'stat', key: 'critDmgUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 40, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '爆擊傷害提高。' },
  blockUp: { name: '格擋', icon: '🔰', kind: 'buff', effect: 'stat', key: 'blockUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 12, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '格擋率提高。' },
  thornsUp: { name: '反震', icon: '🌵', kind: 'buff', effect: 'stat', key: 'thornsUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 15, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '反震傷害提高。' },
  lootUp: { name: '掉寶', icon: '🎁', kind: 'buff', effect: 'stat', key: 'lootUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 15, dur: 10, interval: 0, stack: 'refresh', maxStacks: 1, desc: '掉寶率提高。' },
  penUp: { name: '物理/魔法穿透', icon: '🗡️', kind: 'buff', effect: 'stat', key: 'penUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 25, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '物理與魔法穿透提高。' },
  allDmgUp: { name: '時空凝滯·所有傷害', icon: '🌌', kind: 'buff', effect: 'stat', key: 'allDmgUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '潛力【時空凝滯】：所有傷害提高。' },
  velocitySurge: { name: '極速之力·攻速', icon: '💨', kind: 'buff', effect: 'stat', key: 'velocitySurge', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '潛力【極速之力】：攻速提高。' },
  lightningOverload: { name: '雷霆過載·雷電傷害', icon: '🌩️', kind: 'buff', effect: 'stat', key: 'lightningOverload', elem: 'lightning', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '潛力【雷霆過載】：雷電傷害提高。' },
  chronoCdr: { name: '時間坍縮·冷卻縮減', icon: '⏱️', kind: 'buff', effect: 'stat', key: 'chronoCdr', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '潛力【時間坍縮】：冷卻縮減。' },
  sacredInvert: { name: '聖療逆轉·回復/溢傷', icon: '🕊️', kind: 'buff', effect: 'stat', key: 'sacredInvert', elem: 'light', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '潛力【聖療逆轉】：回復與溢傷轉換。' },
  legendaryDarkUp: { name: '暗影強化', icon: '🌑', kind: 'buff', effect: 'stat', key: 'legendaryDarkUp', elem: 'dark', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '傳奇特效：暗屬性傷害提高。' },
  legendaryGuardRed: { name: '守護減傷', icon: '🛡️', kind: 'buff', effect: 'stat', key: 'legendaryGuardRed', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '傳奇特效：受到的傷害降低。' },
  legendaryLightShieldRed: { name: '聖盾減傷', icon: '🔆', kind: 'buff', effect: 'stat', key: 'legendaryLightShieldRed', elem: 'light', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '傳奇特效：受到的傷害降低。' },

  atkDown: { name: '攻擊', icon: '⚔️', kind: 'debuff', effect: 'stat', key: 'atkDown', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 18, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '目標攻擊力下降。' },
  defDown: { name: '防禦', icon: '🛡️', kind: 'debuff', effect: 'stat', key: 'defDown', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '目標防禦力下降（舊存檔融合技快照相容保留，新設計改用穿透提升）。' },
  enemyAspdDown: { name: '時間結界·攻速', icon: '⏳', kind: 'debuff', effect: 'stat', key: 'enemyAspdDown', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '潛力【時間結界】：目標攻擊速度下降。' },

  sgBleed: { name: '血刃流血', icon: '🩸', kind: 'debuff', effect: 'dot', key: '', elem: '', dmgSource: 'skill', dmg: 30, capStat: '', capMult: 0, val: 0, dur: 5, interval: 1, stack: 'strongest', maxStacks: 1, desc: '新版技能【血刃斬】：每次作用造成技能傷害一定比例的傷害；每跳量與間隔由技能各階決定（引擎以 dps 覆寫）。' },
  sgPoison: { name: '血刃劇毒', icon: '☠️', kind: 'debuff', effect: 'dot', key: '', elem: 'poison', dmgSource: 'skill', dmg: 25, capStat: '', capMult: 0, val: 0, dur: 4, interval: 0.5, stack: 'strongest', maxStacks: 1, desc: '新版技能【血毒刃】：毒屬性持續傷害；每跳量與間隔由技能各階決定（引擎以 dps 覆寫）。' },
  sgIronBleed: { name: '鐵血裂傷', icon: '🗡️', kind: 'debuff', effect: 'dot', key: '', elem: '', dmgSource: 'maxHp', dmg: 3.5, capStat: '', capMult: 0, val: 0, dur: 3, interval: 0.35, stack: 'refresh', maxStacks: 1, desc: '新版技能【鐵血之舞】：占最大生命比例的流血；自身流血直接扣生命、不吃護盾。' },
  sgGale: { name: '狂風', icon: '💨', kind: 'buff', effect: 'stat', key: 'sgGale', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 20, dur: 5, interval: 0, stack: 'refresh', maxStacks: 1, desc: '新版技能【狂風斬】：攻速額外提高（突破攻速上限、與自身攻速相乘）。' },
  sgFrenzyCr: { name: '狂暴·爆擊率', icon: '🔥', kind: 'buff', effect: 'stat', key: 'sgCritUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 50, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '新版技能【狂暴之舞】：爆擊率提高。' },
  sgFrenzyCd: { name: '狂暴·爆擊傷害', icon: '💥', kind: 'buff', effect: 'stat', key: 'sgCritDmgUp', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 200, dur: 6, interval: 0, stack: 'refresh', maxStacks: 1, desc: '新版技能【狂暴之舞】：爆擊傷害提高。' },
  sgStorm: { name: '暴風化身', icon: '🌪️', kind: 'buff', effect: 'stat', key: 'sgStorm', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 3, interval: 0, stack: 'refresh', maxStacks: 1, desc: '新版技能【暴風之舞】：化身暴風，期間自動施放雙刀亂舞、無法普攻。' },
  sgBloodrage: { name: '嗜血狂怒', icon: '💢', kind: 'buff', effect: 'stat', key: 'sgBloodrage', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 20, dur: 8, interval: 0, stack: 'refresh', maxStacks: 1, desc: '新版技能【嗜血狂怒】：攻速乘算提高（突破攻速上限）；期間各階狂怒效果生效。' },
  sgArmorBrk: { name: '破甲', icon: '⚒️', kind: 'debuff', effect: 'stat', key: 'sgDefBrk', elem: '', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 25, dur: 4, interval: 0, stack: 'stack', maxStacks: 4, desc: '新版技能【破甲擊】：防禦降低（可疊層，疊層時重置時間；獨立鍵、與舊 defDown 減益加總計算）。' },
  sgBurn: { name: '烈焰燃燒', icon: '🔥', kind: 'debuff', effect: 'dot', key: '', elem: 'fire', dmgSource: 'skill', dmg: 20, capStat: '', capMult: 0, val: 0, dur: 5, interval: 0.5, stack: 'strongest', maxStacks: 1, desc: '新版技能【火球術／火柱】：火屬性持續傷害；每跳量與間隔由技能各階決定（引擎以 dps 覆寫）。' },
  sgFireAmp: { name: '火焰增幅', icon: '🔥', kind: 'buff', effect: 'stat', key: 'sgFireAmp', elem: 'fire', dmgSource: '', dmg: 0, capStat: '', capMult: 0, val: 0, dur: 4, interval: 0, stack: 'refresh', maxStacks: 1, desc: '新版技能【火焰增幅】：火屬性傷害提升（層數由引擎累加成單一數值，故用後蓋前並重置時間）。' }
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
/* 疊加規則傳給低階寫入器；未指定＝維持各容器原本的行為（持續傷害取高、增益後蓋前）。 */
function statusStackCfg(def) {
  if (!def || def.stack !== 'stack') return def ? { rule: def.stack } : null;
  return { rule: 'stack', max: Math.max(1, Math.floor(Number(def.maxStacks) || 1)) };
}
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
      return applyBuff(ent, def.key, statusNum(ctx.val, def.effect === 'hot' ? def.dmg : def.val) * mult, dur, sid,
        statusStackCfg(def));
    case 'ctrl':
      return applyEffect(ent, def.key, dur, sid);
    case 'shield':
      // 護盾量＝施法者最大生命 × 效果值%（吃護盾效率與技能護盾上限，規則在 js/combat.js）
      return applyShield(ent, statusNum(ctx.val, def.dmg) * mult, dur, sid,
        ctx.stats, statusStackCfg(def));
  }
  return false;
}

/* ---- 統一列舉：實體身上生效中的所有狀態 ----
   UI 的狀態列、提示框與戰鬥日誌一律用這支，圖標與名稱直接來自狀態表。
   回傳 [{ sid, name, icon, kind, effect, until, remain, val, dps }]，順序：控場 → 持續傷害 → 增益／減益。 */
function statusEntries(ent) {
  var out = [];
  if (!ent) return out;
  var k, sid, def;
  // 護盾：以剩餘吸收量顯示；打完了就不列（時間還沒到也一樣）
  if (ent.buffs && ent.buffs.shield && ent.buffs.shield.until > GT && (ent.shield || 0) > 0) {
    def = statusDef('shield');
    out.push({ sid: 'shield', name: def.name, icon: def.icon, kind: def.kind, effect: 'shield',
      until: ent.buffs.shield.until, remain: ent.buffs.shield.until - GT, dur: ent.buffs.shield.dur || (def && def.dur) || 0,
      val: Math.max(0, ent.shield || 0), dps: 0, stacks: 1 });
  }
  if (ent.effects) {
    for (k in ent.effects) {
      if (!((ent.effects[k] || 0) > GT)) continue;
      sid = statusIdByKey(k);
      def = statusDef(sid);
      out.push({ sid: sid, name: def ? def.name : k, icon: def ? def.icon : '❗',
        kind: def ? def.kind : 'ctrl', effect: def ? def.effect : 'ctrl',
        until: ent.effects[k], remain: ent.effects[k] - GT, dur: (def && def.dur) || (ent.effects[k] - GT), val: 0, dps: 0, stacks: 1 });
    }
  }
  if (ent.dots) {
    for (var i = 0; i < ent.dots.length; i++) {
      var d = ent.dots[i];
      if (!d || !(d.until > GT)) continue;
      sid = d.sid || statusIdByName(d.name);
      def = statusDef(sid);
      out.push({ sid: sid, name: def ? def.name : (d.name || '持續傷害'), icon: def ? def.icon : '🩸',
        kind: def ? def.kind : 'debuff', effect: 'dot',
        until: d.until, remain: d.until - GT, dur: d.dur || (def && def.dur) || (d.until - GT), val: 0, dps: d.dps || 0, stacks: d.stacks || 1 });
    }
  }
  if (ent.buffs) {
    for (k in ent.buffs) {
      var b = ent.buffs[k];
      if (!b || !(b.until > GT)) continue;
      if (k === 'shield') continue; // 護盾已在上方以剩餘吸收量列出
      sid = b.sid || statusIdByKey(k);
      def = statusDef(sid);
      out.push({ sid: sid, name: def ? def.name : k, icon: def ? def.icon : '💪',
        kind: def ? def.kind : 'buff', effect: def ? def.effect : 'stat',
        until: b.until, remain: b.until - GT, dur: b.dur || (def && def.dur) || (b.until - GT), val: b.val || 0, dps: 0, stacks: b.stacks || 1 });
    }
  }
  return out;
}

/* 指定狀態是否生效中（不分容器）。 */
function statusActive(ent, sid) {
  var def = statusDef(sid);
  if (!ent || !def) return false;
  if (def.effect === 'ctrl') return (ent.effects && (ent.effects[def.key] || 0) > GT) || false;
  if (def.effect === 'shield') {
    var sb = ent.buffs && ent.buffs.shield;
    return !!(sb && sb.until > GT && (ent.shield || 0) > 0);
  }
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

/* ===========================================================================
   技能 ↔ 狀態的橋接：把技能 fx 解析成一份「狀態引用清單」
   ---------------------------------------------------------------------------
   授權格式（Skills 表的「基礎fx(JSON)」）：
     "status": [ { "id": "burn", "base": 35, "dur": 5 },
                 { "id": "atkUp", "base": 12, "per": 4, "dur": 6 } ]
     id       狀態表的狀態ID（必填）
     base     覆寫狀態表的預設效果值——dot＝每次作用占技能傷害%（或占目標最大生命%）、
              hot＝每秒回復最大生命%、stat＝增減幅度%；未填＝吃狀態表
     per      每技能等級的增量（沿用全專案 scaleAt 語意：base + per×(等級-1)）
     dur      覆寫持續時間（秒）；未填＝吃狀態表
     interval 覆寫作用間隔（秒）；未填＝吃狀態表
   欄位刻意與技能 fx 既有的 {base, per, dur} 慣例一致，讓引用本身就能當增益定義用。

   舊格式（dot／dotList／maxHpDotPct／stunDur／slowDur／buff／buff2／buffList／
   debuff／debuff2／debuffList／hotPct／shieldPctMax）仍能讀，統一在這裡翻成同一份清單——
   結算、說明文字與融合技都只認這份，不留第二條結算路徑。
   =========================================================================== */

/* 舊格式的增益／減益項 → 狀態引用（key 即狀態表的效果鍵值）。 */
function statusRefFromBuff(entry, self) {
  if (!entry || !entry.key) return null;
  return { id: statusIdByKey(entry.key), key: entry.key, base: entry.base, per: entry.per,
    dur: entry.dur, self: self };
}

function skillStatusRefs(fx) {
  if (!fx) return [];
  if (Array.isArray(fx.status)) {
    // 補上效果鍵值：既有呼叫端（增益結算、說明文字、融合池）以 key 辨識增益種類
    for (var n = 0; n < fx.status.length; n++) {
      var r = fx.status[n];
      if (r && !r.key) { var rd = statusDef(r.id); if (rd && rd.key) r.key = rd.key; }
    }
    return fx.status;
  }
  var out = [];
  var i;
  if (fx.dot) out.push({ id: statusIdByName(fx.dot.name), name: fx.dot.name, base: fx.dot.pct, dur: fx.dot.dur });
  if (Array.isArray(fx.dotList)) {
    for (i = 0; i < fx.dotList.length; i++) {
      out.push({ id: statusIdByName(fx.dotList[i].name), name: fx.dotList[i].name,
        base: fx.dotList[i].pct, dur: fx.dotList[i].dur });
    }
  }
  if (fx.maxHpDotPct) out.push({ id: 'deathCurse', base: fx.maxHpDotPct.base, per: fx.maxHpDotPct.per, dur: fx.dotDur });
  if (fx.stunDur) out.push({ id: 'stun', dur: fx.stunDur });
  if (fx.slowDur) out.push({ id: 'slow', dur: fx.slowDur });
  if (fx.hotPct) out.push({ id: 'regen', key: 'hot', base: fx.hotPct.base, per: fx.hotPct.per, dur: fx.hotDur, self: true });
  if (fx.shieldPctMax) out.push({ id: 'shield', key: 'shield', base: fx.shieldPctMax.base, per: fx.shieldPctMax.per, self: true });
  var buffs = [fx.buff, fx.buff2].concat(Array.isArray(fx.buffList) ? fx.buffList : []);
  for (i = 0; i < buffs.length; i++) { var b = statusRefFromBuff(buffs[i], true); if (b) out.push(b); }
  var debuffs = [fx.debuff, fx.debuff2].concat(Array.isArray(fx.debuffList) ? fx.debuffList : []);
  for (i = 0; i < debuffs.length; i++) { var d = statusRefFromBuff(debuffs[i], false); if (d) out.push(d); }
  return out;
}

/* 引用指向的狀態定義；查無定義（融合技隨機命名的臨時 DoT）補一份臨時定義，
   讓結算流程不必到處判斷 null。 */
function statusRefDef(ref) {
  var def = statusDef(ref && ref.id);
  if (def) return def;
  return { name: (ref && ref.name) || '持續傷害', icon: '🩸', kind: 'debuff', effect: 'dot',
    key: (ref && ref.key) || '', elem: '', dmgSource: 'skill', dmg: 0, capStat: '', capMult: 0,
    val: 0, dur: 0, interval: 0, stack: 'strongest', maxStacks: 1, desc: '' };
}
function statusRefEffect(ref) { return statusRefDef(ref).effect; }
function statusRefKey(ref) { return (ref && ref.key) || statusRefDef(ref).key; }
function statusRefName(ref) { return statusRefDef(ref).name; }
function statusRefIcon(ref) { return statusRefDef(ref).icon; }
/* 作用對象：狀態表分類為增益＝施法者自身，其餘（減益／控場）＝敵方；
   引用可用 self 欄強制指定（相容舊格式的解析結果）。 */
function statusRefIsSelf(ref) {
  if (ref && ref.self !== undefined) return !!ref.self;
  return statusRefDef(ref).kind === 'buff';
}
/* 引用的 Lv.1 效果值（未覆寫就吃狀態表：dot／hot 取「狀態傷害」、stat 取「效果數值」）。 */
function statusRefBase(ref) {
  var def = statusRefDef(ref);
  var base = ref && ref.base;
  if (base === undefined || base === null || base === '') base = (def.effect === 'stat') ? def.val : def.dmg;
  return Number(base) || 0;
}
/* 引用指向的狀態是否可疊層（供技能說明文字標示）。 */
function statusRefMaxStacks(ref) {
  var def = statusRefDef(ref);
  return def.stack === 'stack' ? Math.max(1, Math.floor(Number(def.maxStacks) || 1)) : 1;
}
/* 指定技能等級下的效果值（沿用 scaleAt 語意）。 */
function statusRefAmount(ref, lv) {
  return statusRefBase(ref) + (Number(ref && ref.per) || 0) * (Math.max(1, Number(lv) || 1) - 1);
}
function statusRefDur(ref) {
  var d = ref && ref.dur;
  if (d === undefined || d === null || d === '') d = statusRefDef(ref).dur;
  return Number(d) || 0;
}

/* 依引用授予狀態；效果值與持續時間由引用（技能）覆寫、其餘一律吃狀態表。
   ctx：{ base：本次技能傷害（dot 換算基準）、mult：效果倍率、stats：施法者屬性 }。 */
function applyStatusRef(ent, ref, lv, ctx) {
  if (!ent || !ref) return false;
  ctx = ctx || {};
  var def = statusRefDef(ref);
  var amount = statusRefAmount(ref, lv);
  var dur = statusRefDur(ref);
  if (!(dur > 0)) return false;
  if (!statusDef(ref.id)) {
    // 狀態表上沒有的臨時持續傷害（融合技隨機命名）：沿用舊行為以名稱塗抹、連續結算
    if (def.effect !== 'dot') return false;
    return applyDot(ent, statusNum(ctx.base, 0) * amount / 100 * statusNum(ctx.mult, 1),
      dur, def.name, '', ref.interval);
  }
  var sub = { base: ctx.base, mult: ctx.mult, stats: ctx.stats, dur: dur, interval: ref.interval };
  if (def.effect === 'stat' || def.effect === 'hot' || def.effect === 'shield') sub.val = amount;
  else sub.dmg = amount;
  return applyStatus(ent, ref.id, sub);
}
