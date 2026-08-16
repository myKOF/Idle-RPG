'use strict';
/* ============ 新版主動技能系統（2026-08-13 技能改造第一批） ============
   設計來源：神力之巔_記事錄.xlsx「技能」頁籤。
   8 個技能群組 × 7 階：同群組在前端顯示為「同一個技能」，玩家裝配群組後，
   透過升級各階持續強化該技能的效果（階＝效果模組，不是獨立技能）。
   （2026-08-14 第二批追加：counter 反擊＝被動群組，不裝載、不施放，受擊時觸發；
   bloodrage 嗜血狂怒＝主動爆發增益，效果全部只在持續期間生效。）
   （2026-08-16 第三批追加＝魔法系兩群組：fireball 火球術／firepillar 火柱。
   帶進三個新機制，皆為群組共用能力、不是這兩個技能的特例：
     1. 群組層 dmgType／elem：魔法傷害走魔攻與魔穿、本體傷害段歸屬火屬性（sgAtkCfg）
     2. 施法距離：各階 fx.castM（米）決定射程，取代「新版技能一律近戰起手」的寫死規則
        （skills2CastRangePx／skills2CanReach，js/skills.js 的施放閘門同步改吃這支）
     3. 地板場域（SKILL2_RT.grounds）：釘在座標上、按節拍反覆作用的區域，
        可移動（追擊）、可重生；無座標時（高塔）退化為固定打主目標）
   （2026-08-16 第四批追加＝魔法系 firehunt 火狩。帶進第四個群組共用能力：
     4. 環繞場域（SKILL2_RT.orbits）：釘在玩家身上、持續旋轉的環繞體，
        以接觸判定命中（進入才算一次），可伴生、可因擊殺延長；
        無座標時（高塔）退化為每轉一圈打一次主目標）

   規則：
     - 每階上限 SG_TIER_MAX_LV 級，固定不隨轉生提高
     - 前一階至少 Lv.1 才可投資下一階；第 1 階預設開啟（恆視為至少 Lv.1）
     - 裝載欄鍵前綴 'sg:<群組id>'（比照潛力技能 'potential:' 的並行前例）
     - 舊技能系統（js/skills.js SKILLS）完全不動；調教完成後另案刪除

   分工：
     - 數值 SSOT：下方 SKILLS2 純資料 literal
       （config/Excel/Skills2.xlsx ↔ config/CSV/Skills2.csv → tools/config_tables.cjs 回寫，
       與其他七表同一顆「套用參數.bat」；引擎不寫死任何技能數值）
     - 幾何（直線貫穿／扇形／最近 N 敵）→ js/battlefield.js（唯一權威）
     - 持續效果（流血／中毒／增益）→ js/status.js 狀態表 ＋ applyStatus
     - 執行期狀態 → 模組級 SKILL2_RT（絕不掛 G＝保證不入存檔），
       由 resetSkillRT()（js/skills.js）鏈結重置，重置時機與舊系統完全一致

   本檔必須能在三種環境載入且行為一致（主執行緒 <script>／Worker importScripts／
   Node vm 測試），因此只用 ES5 語法、只掛全域、不碰 DOM。 */

/* ---- 常數 ---- */
var SG_PREFIX = 'sg:';
var SG_TIER_MAX_LV = 10;      // 每階等級上限（固定，不隨轉生提高）
var SG_TIER_COUNT = 7;        // 每群組階數
var SG_FLYING_PROJECTILE_SPEED = 240;
var SG_FLYING_PROJECTILE_HALF_WIDTH = 8;
var SG_FLYING_PROJECTILE_REHIT_SEC = 0.5;
var SG_METEOR_INTERVAL_MS = 350;
var SG_METEOR_SPEED_MULTIPLIER = (typeof VFX_METEOR_SPEED_MULTIPLIER === 'number' && VFX_METEOR_SPEED_MULTIPLIER > 0)
  ? VFX_METEOR_SPEED_MULTIPLIER : 0.70;
var SG_METEOR_DROP_DISTANCE = (typeof VFX_METEOR_DROP_DISTANCE === 'number' && VFX_METEOR_DROP_DISTANCE > 0)
  ? VFX_METEOR_DROP_DISTANCE : 360;
var SG_METEOR_FALL_SPEED = (typeof VFX_METEOR_FALL_SPEED === 'number' && VFX_METEOR_FALL_SPEED > 0)
  ? VFX_METEOR_FALL_SPEED : 360;
var SG_METEOR_MAX_TRAVEL_MS = (typeof VFX_METEOR_RAW_TRAVEL_MS === 'number' && VFX_METEOR_RAW_TRAVEL_MS > 0)
  ? VFX_METEOR_RAW_TRAVEL_MS : 700;
/* 環繞場域（火狩）：伴生已由「每團只能伴生一個、伴生體不可再伴生」自然收斂，
   這個上限只是防呆（環繞體數量若失控，每個 tick 的接觸判定會跟著失控）。 */
var SG_ORBIT_MAX_ORBS = 32;
var SG_ORBIT_VFX_REFRESH_SEC = 2;   // 持續時間被【再生】延長多久才值得補送一次環繞特效

/* 殞石的傷害時刻必須和落地時刻相同：先算天空到地面的距離，
   再除以殞石實際落下速度；travelMs 是顯示層套用 0.70 慢速倍率前的時間。 */
function sgMeteorFallTiming() {
  var distance = SG_METEOR_DROP_DISTANCE;
  var speed = SG_METEOR_FALL_SPEED;
  var fallMs = Math.max(1, Math.round(distance / speed * 1000));
  var travelMs = Math.max(1, Math.round(fallMs * SG_METEOR_SPEED_MULTIPLIER));
  return { travelMs: Math.min(SG_METEOR_MAX_TRAVEL_MS, travelMs), fallMs: fallMs };
}
/* 主動型被動群組（2026-08-14 技能類型擴充；引擎接線，不入參數表）：
   效果被動觸發、永遠不會被主動施放（不佔出手節奏、無冷卻無耗魔），
   但**必須裝配到技能列才生效**——佔用一個技能格就是這類技能的代價。
   與純被動的差別在此：學了不等於生效，卸下即失效。 */
var SG_PASSIVE = { counter: true };
function skills2IsPassive(gid) { return !!SG_PASSIVE[gid]; }

/* 主動型被動目前是否生效：已學習（第 1 階至少 Lv.1）且已裝配在技能列。
   讀 G＝Worker 端唯一權威；主執行緒 UI 走面板快照自行判斷（js/ui.js）。 */
function skills2PassiveActive(gid) {
  if (!skills2IsPassive(gid) || !skills2Castable(gid)) return false;
  var lo = (typeof G !== 'undefined' && G && G.player && G.player.loadout) ? G.player.loadout : null;
  return !!lo && lo.indexOf(SG_PREFIX + gid) >= 0;
}

/* ---- 群組定義表（撥離：config/CSV/Skills2.csv → 本字面值） ----
   群組欄位：name 名稱／emoji 圖標／range 初始涵蓋範圍（長*寬，米）／cd 冷卻秒數／cost 施法法力消耗
   階欄位：name 階段名稱／fx 效果參數／goldBase 升級金幣基數／goldGrow 升級金幣倍率
           （升級至下一級費用＝goldBase × goldGrow^目前等級，取整）／desc 效果說明模板
   fx 參數命名慣例：<鍵> 為 Lv.1 基準值、<鍵>Per 為每級增量（值＝基準 + 增量×(等級-1)）。
   desc 內的 {鍵} 於顯示時代入目前等級的計算值。 */
var SKILLS2 = {
  thrust: { name: '突刺', emoji: '🗡️', range: '12*3', cd: 5, cost: 25, tiers: [{ name: '突刺', fx: { pct: 150, pctPer: 15, count: 2 }, goldBase: 100000, goldGrow: 1.5, desc: '對前方敵人造成 {count} 次 {pct}% 物理傷害' }, { name: '連刺', fx: { chance: 25, chancePer: 2.5, count: 2 }, goldBase: 200000, goldGrow: 1.5, desc: '有 {chance}% 的機率再次進行 {count} 次突刺' }, { name: '傷害強化', fx: { pct: 20, pctPer: 3 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化突刺傷害，額外 +{pct}% 物理傷害（與第 1 階累加）' }, { name: '超連刺', fx: { count: 3, range: 20, rangePer: 2 }, goldBase: 800000, goldGrow: 1.5, desc: '每次能進行 {count} 道平行貫穿突刺，且突刺範圍提升 {range}%' }, { name: '擴散', fx: { pct: 20, pctPer: 2, count: 4 }, goldBase: 1500000, goldGrow: 1.5, desc: '突刺造成的傷害有 {pct}% 會擴散至周圍的 {count} 個敵人' }, { name: '貫穿突刺', fx: { m: 5, mPer: 0.5 }, goldBase: 3000000, goldGrow: 1.5, desc: '突刺會造成一直線的傷害，貫穿路徑上所有敵人，貫穿長度在原本長度上再增加 {m} 米' }, { name: '八方突刺', fx: { pct: 20, pctPer: 2, count: 3, directions: 8 }, goldBase: 5000000, goldGrow: 1.5, desc: '向八個方向同時進行 {count} 次突刺，且造成傷害額外 +{pct}%' }] },
  cleave: { name: '迴旋斬', emoji: '🪓', range: '', cd: 8, cost: 30, tiers: [{ name: '迴旋斬', fx: { pct: 200, pctPer: 20, count: 6 }, goldBase: 100000, goldGrow: 1.5, desc: '對前方 {count} 個敵人造成 1 次 {pct}% 物理傷害' }, { name: '強化斬', fx: { add: 1, addPer: 0.25 }, goldBase: 200000, goldGrow: 1.5, desc: '斬擊的敵人數量額外 +{add} 個（不足 1 個的部分以機率觸發）' }, { name: '傷害強化', fx: { pct: 50, pctPer: 5 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化斬擊傷害，額外 +{pct}% 物理傷害' }, { name: '連斬', fx: { chance: 25, chancePer: 2.5, times: 2, timesPer: 0.25 }, goldBase: 800000, goldGrow: 1.5, desc: '斬擊時有 {chance}% 機率連續劈出共 {times} 次斬擊（不足 1 次的部分以機率觸發）' }, { name: '暈眩擊', fx: { chance: 25, chancePer: 1, sec: 1, secPer: 0.1 }, goldBase: 1500000, goldGrow: 1.5, desc: '斬擊時有 {chance}% 機率擊暈敵人 {sec} 秒' }, { name: '震碎斬', fx: { m: 12, mPer: 0.5 }, goldBase: 3000000, goldGrow: 1.5, desc: '斬擊會向前飛出 {m} 米距離，命中路徑上的敵人' }, { name: '迴身雙連斬', fx: { pct: 50, pctPer: 5, times: 3, timesPer: 0 }, goldBase: 5000000, goldGrow: 1.5, desc: '同時朝前後左右四個方向各使出 {times} 次迴旋斬，且物理傷害額外 +{pct}%' }] },
  knife: { name: '飛刀', emoji: '🔪', range: '', cd: 8, cost: 28, tiers: [{ name: '飛刀', fx: { pct: 150, pctPer: 15, count: 3, deg: 60 }, goldBase: 100000, goldGrow: 1.5, desc: '朝前方 {deg} 度扇形內丟出 {count} 把飛刀，每把造成 {pct}% 物理傷害' }, { name: '強化飛刀', fx: { pct: 20, pctPer: 10 }, goldBase: 200000, goldGrow: 1.5, desc: '飛刀傷害進一步提升，額外 +{pct}% 物理傷害' }, { name: '彈射飛刀', fx: { pct: 30, pctPer: 5, count: 1 }, goldBase: 400000, goldGrow: 1.5, desc: '每把飛刀會在附近的 {count} 個敵人間彈跳，每次彈射造成 {pct}% 技能傷害' }, { name: '強化彈射', fx: { add: 1, addPer: 0.25 }, goldBase: 800000, goldGrow: 1.5, desc: '飛刀彈射的敵人數量額外 +{add}（不足 1 次的部分以機率觸發）' }, { name: '迴旋飛刀', fx: { count: 4, countPer: 0.2 }, goldBase: 1500000, goldGrow: 1.5, desc: '改為向周圍的 {count} 個敵人丟出飛刀（全圓形範圍鎖敵；不足 1 個的部分以機率觸發）' }, { name: '連鎖彈射', fx: { chance: 20, chancePer: 2, max: 4 }, goldBase: 3000000, goldGrow: 1.5, desc: '飛刀彈射後有 {chance}% 機率再次彈射，最多連續 {max} 次' }, { name: '神速飛刀', fx: { sec: 0.05, secPer: 0.01 }, goldBase: 5000000, goldGrow: 1.5, desc: '每把飛刀（含彈射）爆擊時，使飛刀技能冷卻時間 -{sec} 秒' }] },
  gale: { name: '疾風斬', emoji: '💨', range: '', cd: 6, cost: 30, tiers: [{ name: '疾風斬', fx: { pct: 250, pctPer: 20, hits: 3 }, goldBase: 100000, goldGrow: 1.5, desc: '對敵人造成連續 {hits} 次 {pct}% 物理傷害（同一目標）' }, { name: '疾風連斬', fx: { add: 1, addPer: 0.2 }, goldBase: 200000, goldGrow: 1.5, desc: '斬擊次數額外 +{add}（不足 1 次的部分以機率觸發）' }, { name: '強化斬擊', fx: { pct: 15, pctPer: 4 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化斬擊傷害，額外 +{pct}% 物理傷害' }, { name: '擴散', fx: { pct: 50, pctPer: 5, m: 10 }, goldBase: 800000, goldGrow: 1.5, desc: '每次斬擊額外對 {m} 米內最近的 1 個敵人造成 {pct}% 技能傷害；附近沒有敵人時改對原目標造成' }, { name: '狂風斬', fx: { pct: 20, pctPer: 5, sec: 5 }, goldBase: 1500000, goldGrow: 1.5, desc: '施放疾風斬使你的攻速額外提高 {pct}%，持續 {sec} 秒（突破攻速上限，與自身攻速相乘）' }, { name: '極速斬', fx: { sec: 1, secPer: 0.3 }, goldBase: 3000000, goldGrow: 1.5, desc: '疾風斬的冷卻時間 -{sec} 秒' }, { name: '超神斬', fx: { pct: 300, pctPer: 30, m: 5 }, goldBase: 5000000, goldGrow: 1.5, desc: '疾風斬的傷害由目標周圍 {m} 米內的所有敵人均分，且傷害額外 +{pct}%' }] },
  bloodblade: { name: '血刃斬', emoji: '🩸', range: '', cd: 8, cost: 40, tiers: [{ name: '血刃斬', fx: { pct: 200, pctPer: 15, dotPct: 30, dotSec: 5, dotGap: 1 }, goldBase: 100000, goldGrow: 1.5, desc: '對敵人造成 1 次 {pct}% 物理傷害，並附加流血：每 {dotGap} 秒造成技能傷害 {dotPct}% 的傷害，持續 {dotSec} 秒' }, { name: '強化流血', fx: { sec: 0.5, secPer: 0.1, gapPct: 10, gapPctPer: 1.5 }, goldBase: 200000, goldGrow: 1.5, desc: '流血持續時間 +{sec} 秒，且流血作用間隔縮短 {gapPct}%（跳得更快、總傷更高）' }, { name: '虛弱', fx: { pct: 10, pctPer: 2 }, goldBase: 400000, goldGrow: 1.5, desc: '流血中的敵人受到的傷害提高 {pct}%' }, { name: '血毒刃', fx: { dotPct: 25, dotPctPer: 3, dotSec: 6, dotGap: 0.5 }, goldBase: 800000, goldGrow: 1.5, desc: '敵人流血的同時也會中毒：每 {dotGap} 秒造成技能傷害 {dotPct}% 的毒屬性傷害，持續 {dotSec} 秒' }, { name: '毒霧感染', fx: { chance: 30, chancePer: 2, count: 2 }, goldBase: 1500000, goldGrow: 1.5, desc: '血毒刃的毒在每次作用時，有 {chance}% 機率傳染給附近的 {count} 個敵人' }, { name: '死亡屍爆', fx: { pct: 50, pctPer: 5, count: 2 }, goldBase: 3000000, goldGrow: 1.5, desc: '流血或中毒狀態的敵人死亡時爆炸，對附近 {count} 個敵人造成 {pct}% 技能傷害並傳染中毒' }, { name: '零日感染', fx: { chance: 20, chancePer: 2, pct: 40, pctPer: 4, m: 20, count: 1 }, goldBase: 5000000, goldGrow: 1.5, desc: '流血或中毒狀態在每次作用時有 {chance}% 機率立即造成剩餘的持續傷害；作用結束後將流血及中毒傳染給 {m} 米內的隨機 {count} 個敵人，且流血與中毒傷害 +{pct}%' }] },
  dualdance: { name: '雙刀亂舞', emoji: '⚔️', range: '', cd: 10, cost: 35, tiers: [{ name: '雙刀亂舞', fx: { pct: 300, pctPer: 25, count: 2 }, goldBase: 100000, goldGrow: 1.5, desc: '對附近 {count} 個敵人各造成 1 次 {pct}% 物理傷害（只有 1 個敵人時全部打向同一目標）' }, { name: '疾風亂舞', fx: { add: 1, addPer: 0.2 }, goldBase: 200000, goldGrow: 1.5, desc: '額外攻擊附近 {add} 個敵人（不足 1 個的部分以機率觸發）' }, { name: '強化雙刀', fx: { pct: 25, pctPer: 5 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化雙刀傷害，額外 +{pct}% 物理傷害' }, { name: '狂暴之舞', fx: { cr: 100, crPer: 10, add: 1, addPer: 0.1, sec: 6 }, goldBase: 800000, goldGrow: 1.5, desc: '讓你的暴擊率 +{cr}%、連擊數 +{add}，持續 {sec} 秒' }, { name: '鐵血之舞', fx: { pct: 3.5, pctPer: 0.35, sec: 3, gap: 0.35, m: 5 }, goldBase: 1500000, goldGrow: 1.5, desc: '施放雙刀亂舞時使你以及附近 {m} 米內的所有敵人流血：每 {gap} 秒造成最大生命值 {pct}% 傷害，持續 {sec} 秒' }, { name: '嗜血狂化', fx: { pct: 0.25, pctPer: 0.025, sec: 6 }, goldBase: 3000000, goldGrow: 1.5, desc: '施放雙刀亂舞後 {sec} 秒內，生命值或護盾每減少 1%，獲得 {pct}% 技能傷害提升' }, { name: '暴風亂舞', fx: { sec: 3, secPer: 0.3, gap: 0.35 }, goldBase: 5000000, goldGrow: 1.5, desc: '化身暴風在敵人間穿梭 {sec} 秒：每 {gap} 秒自動施放 1 次雙刀亂舞；期間無法普攻但可施放技能' }] },
  counter: { name: '反擊', emoji: '🛡️', range: '', cd: 0, cost: 0, tiers: [{ name: '反擊', fx: { chance: 35, pct: 50, pctPer: 5 }, goldBase: 100000, goldGrow: 1.5, desc: '被動：受到傷害時有 {chance}% 機率對攻擊者反擊，造成 {pct}% 普攻傷害' }, { name: '招架', fx: { mult: 300, multPer: 30 }, goldBase: 200000, goldGrow: 1.5, desc: '格擋時必定對敵人反擊，造成「格擋減傷值 × {mult}%」的普攻傷害' }, { name: '強化反擊', fx: { pct: 30, pctPer: 5 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步提升反擊傷害，額外 +{pct}% 反擊普攻傷害' }, { name: '反擊盾', fx: { pct: 1, pctPer: 0.1 }, goldBase: 800000, goldGrow: 1.5, desc: '觸發反擊時，回復自身最大生命 {pct}% 的護盾' }, { name: '破甲擊', fx: { chance: 35, def: 15, sec: 4, secPer: 0.4, max: 4 }, goldBase: 1500000, goldGrow: 1.5, desc: '格擋時有 {chance}% 機率造成破甲：防禦 -{def}%，持續 {sec} 秒，最多疊 {max} 層（疊層時重置時間）' }, { name: '二次反擊', fx: { chance: 50, chancePer: 5, count: 2 }, goldBase: 3000000, goldGrow: 1.5, desc: '反擊時有 {chance}% 機率再追加 {count} 次反擊（追加反擊不會再觸發反擊）' }, { name: '狂化反殺', fx: { pct: 50, pctPer: 5, count: 2, m: 80 }, goldBase: 5000000, goldGrow: 1.5, desc: '每次反擊時，額外對 {m} 米內隨機 {count} 個敵人反擊，造成 {pct}% 普攻傷害（不會再觸發反擊）' }] },
  bloodrage: { name: '嗜血狂怒', emoji: '💢', range: '', cd: 60, cost: 50, tiers: [{ name: '嗜血狂怒', fx: { pct: 20, pctPer: 2, sec: 8 }, goldBase: 100000, goldGrow: 1.5, desc: '攻速額外 +{pct}%（乘算，不受攻速上限限制），持續 {sec} 秒' }, { name: '狂暴', fx: { pct: 20, pctPer: 2 }, goldBase: 200000, goldGrow: 1.5, desc: '狂怒期間爆擊傷害額外 +{pct}%（乘算）' }, { name: '狂怒', fx: { pct: 20, pctPer: 2 }, goldBase: 400000, goldGrow: 1.5, desc: '狂怒期間總傷害額外 +{pct}%（乘算）' }, { name: '狂化連殺', fx: { add: 0.5, addPer: 0.1, kill: 0.1, killMax: 5 }, goldBase: 800000, goldGrow: 1.5, desc: '狂怒期間基礎連擊數 +{add}，且每擊殺 1 個敵人再 +{kill}（累計上限 +{killMax}；不足 1 次的部分以機率觸發）' }, { name: '嗜血反震', fx: { pct: 20, pctPer: 2 }, goldBase: 1500000, goldGrow: 1.5, desc: '狂怒期間反震傷害提高 {pct}%（乘算，可與其它反震加成疊加）' }, { name: '血飲術', fx: { pct: 30, pctPer: 3, self: 1, m: 80 }, goldBase: 3000000, goldGrow: 1.5, desc: '狂怒期間傷害額外提高 {pct}%（乘算），但 {m} 米內的敵人每次受傷都會使你損失最大生命 {self}%（直接扣血，無法被護盾吸收）' }, { name: '狂血盛宴', fx: { sec: 0.5, pct: 1, pctPer: 0.1, count: 1 }, goldBase: 5000000, goldGrow: 1.5, desc: '狂怒期間每擊殺 1 個敵人，持續時間延長 {sec} 秒；且生命值每減少 1%，傷害額外 +{pct}%（乘算，無限疊加），每 1 連擊數使普攻可同時攻擊 1 個敵人（無限疊加）' }] },
  fireball: { name: '火球術', emoji: '🔥', range: '', dmgType: 'magic', elem: 'fire', cd: 14, cost: 45, tiers: [{ name: '火球術', fx: { pct: 150, pctPer: 15, m: 6, castM: 30 }, goldBase: 100000, goldGrow: 1.5, desc: '射出一顆火球（射程 {castM} 米），命中時爆炸，對目標及 {m} 米內的敵人造成 {pct}% 火屬性傷害' }, { name: '燃燒', fx: { dotPct: 20, dotPctPer: 2, dotSec: 5, dotGap: 0.5 }, goldBase: 200000, goldGrow: 1.5, desc: '被火球擊中的敵人陷入燃燒：每 {dotGap} 秒造成技能傷害 {dotPct}% 的火屬性傷害，持續 {dotSec} 秒' }, { name: '火球爆裂', fx: { pct: 30, pctPer: 3, count: 3, m: 20 }, goldBase: 400000, goldGrow: 1.5, desc: '火球爆炸後分裂出 {count} 個小火球，射向目標 {m} 米內的敵人，每個造成原始火球 {pct}% 的傷害' }, { name: '強化燃燒', fx: { gap: 0.4, gapPer: -0.015 }, goldBase: 800000, goldGrow: 1.5, desc: '燃燒的作用間隔縮短至 {gap} 秒（跳得更快＝總傷更高）' }, { name: '爆燃', fx: { pct: 50, pctPer: 5, count: 2, m: 12 }, goldBase: 1500000, goldGrow: 1.5, desc: '燃燒結束或敵人死亡時爆炸，對我方 {m} 米內的 {count} 個敵人造成該敵人整段燃燒累積傷害 {pct}% 的傷害' }, { name: '火焰增幅', fx: { pct: 0.25, pctPer: 0.025, sec: 4, m: 20 }, goldBase: 3000000, goldGrow: 1.5, desc: '我方 {m} 米內每有 1 次燃燒作用，你的火屬性傷害 +{pct}%，持續 {sec} 秒（無限疊加，每次疊加時重置時間）' }, { name: '殞石術', fx: { pct: 200, pctPer: 20, count: 3, m: 15, castM: 20 }, goldBase: 5000000, goldGrow: 1.5, desc: '改為召喚 {count} 顆巨大火殞石從天而降（射程 {castM} 米），每顆對目標 {m} 米內的敵人造成 {pct}% 火屬性傷害（第 2~6 階效果仍然生效）' }] },
  firepillar: { name: '火柱', emoji: '🌋', range: '', dmgType: 'magic', elem: 'fire', cd: 14, cost: 40, tiers: [{ name: '火柱', fx: { pct: 60, pctPer: 6, hits: 5, m: 3, castM: 30, sec: 2.5 }, goldBase: 100000, goldGrow: 1.5, desc: '在敵人腳下召喚一道火柱（射程 {castM} 米），對目標 {m} 米內的敵人連續造成 {hits} 段傷害，每段 {pct}% 火屬性傷害（全程約 {sec} 秒）' }, { name: '強化火柱', fx: { pct: 10, pctPer: 2 }, goldBase: 200000, goldGrow: 1.5, desc: '火柱的傷害範圍擴大 {pct}%' }, { name: '雙重火柱', fx: { count: 2, pct: 20, pctPer: 2, m: 20 }, goldBase: 400000, goldGrow: 1.5, desc: '可同時對 {m} 米內的 {count} 個目標施放火柱，且火屬性傷害額外 +{pct}%' }, { name: '燃燒', fx: { chance: 20, chancePer: 2, dotPct: 20, dotSec: 4, dotGap: 0.5 }, goldBase: 800000, goldGrow: 1.5, desc: '火柱每次作用時有 {chance}% 機率使敵人燃燒：每 {dotGap} 秒造成技能傷害 {dotPct}% 的火屬性傷害，持續 {dotSec} 秒' }, { name: '追擊', fx: { m: 6, mPer: 0.6 }, goldBase: 1500000, goldGrow: 1.5, desc: '火柱會以每秒 {m} 米的速度追擊目標' }, { name: '重生', fx: { chance: 25, chancePer: 2.5, m: 20 }, goldBase: 3000000, goldGrow: 1.5, desc: '火柱消失後有 {chance}% 機率在我方 {m} 米內的敵人身上重生' }, { name: '無限火牆', fx: { count: 3, hits: 8, pct: 60, pctPer: 6, len: 18, wid: 6, respawn: 1 }, goldBase: 5000000, goldGrow: 1.5, desc: '改為施放 {count} 道火牆（橫向 {len}×{wid} 米），每道造成 {hits} 段 {pct}% 火屬性傷害；每道火牆消失後再召喚 1 道（僅能再觸發一次；第 2~6 階效果仍然生效）' }] },
  firehunt: { name: '火狩', emoji: '☄️', range: '3*3', dmgType: 'magic', elem: 'fire', cd: 26, cost: 50, tiers: [{ name: '火狩', fx: { pct: 120, pctPer: 12, count: 2, sec: 4, m: 8, rps: 0.65, castM: 8 }, goldBase: 100000, goldGrow: 1.5, desc: '召喚 {count} 團火狩環繞自身（環繞半徑 {m} 米、每秒 {rps} 圈），碰到敵人即命中一次，每次造成 {pct}% 火屬性傷害，持續 {sec} 秒' }, { name: '強化火狩', fx: { pct: 15, pctPer: 1.5 }, goldBase: 200000, goldGrow: 1.5, desc: '火狩的體積與環繞範圍同步擴大 {pct}%' }, { name: '伴生火狩', fx: { chance: 20, chancePer: 2, m: 1 }, goldBase: 400000, goldGrow: 1.5, desc: '火狩命中時有 {chance}% 機率在其後方 {m} 米處伴生一團火狩（每團只能伴生一次，伴生出的不再伴生）' }, { name: '三重火狩', fx: { count: 3, pct: 150, pctPer: 15, sec: 4 }, goldBase: 800000, goldGrow: 1.5, desc: '改為召喚 {count} 團火狩，每團造成 {pct}% 火屬性傷害，持續 {sec} 秒' }, { name: '極速火狩', fx: { pct: 25, pctPer: 2.5 }, goldBase: 1500000, goldGrow: 1.5, desc: '火狩的旋轉速度 +{pct}%' }, { name: '再生', fx: { sec: 0.4, secPer: 0.04 }, goldBase: 3000000, goldGrow: 1.5, desc: '火狩每擊殺 1 個敵人，全部火狩的持續時間延長 {sec} 秒' }, { name: '狩神之舞', fx: { rings: 2, pct: 200, pctPer: 20, sec: 6, m: 6 }, goldBase: 5000000, goldGrow: 1.5, desc: '改為一次施放 {rings} 道火狩（外圈距內圈 {m} 米、兩道旋轉方向相反），每團造成 {pct}% 火屬性傷害、出現時自帶伴生，持續 {sec} 秒' }] }
};

/* ---- 執行期狀態（絕不掛 G＝保證不入存檔） ----
   由 js/skills.js 的 resetSkillRT() 鏈結重置（比照 resetLegendaryRT），
   重置時機（開戰／死亡／讀檔／塔戰進出）與舊系統完全一致。 */
var SKILL2_RT = null;
function resetSkill2RT() {
  /* 先把「跟隨 RT 的增益」從實體上撤掉再清狀態：RT 是權威、增益只是投影，
     兩者不同步時玩家會在狂怒早已結束後仍帶著圖示與增益值（死亡復活保留同一個
     戰鬥實體、提前離塔亦然；cleanse 只清減益，不會動到它）。 */
  if (SKILL2_RT && SKILL2_RT.rage && SKILL2_RT.rage.pEnt && SKILL2_RT.rage.pEnt.buffs) {
    delete SKILL2_RT.rage.pEnt.buffs.sgBloodrage;
  }
  if (SKILL2_RT && SKILL2_RT.frenzy && SKILL2_RT.frenzy.pEnt && SKILL2_RT.frenzy.pEnt.buffs) {
    delete SKILL2_RT.frenzy.pEnt.buffs.sgFrenzyCr;
    delete SKILL2_RT.frenzy.pEnt.buffs.sgFrenzyCd;
  }
  SKILL2_RT = {
    storm: null, // 暴風之舞化身狀態：{ until, nextAt, gap, tgt }（tgt 為當前衝鋒目標實體）
    projectiles: [], // 飛出斬擊／貫穿突刺的執行期飛行物（不入存檔）
    meteors: [], // 殞石落地佇列：{ at, victims, burnSpec, ... }（不入存檔）
    grounds: [], // 地板場域（火柱／火牆）的執行期實例（不入存檔）
    orbits: [], // 環繞場域（火狩）的執行期實例：釘在玩家身上、持續旋轉（不入存檔）
    rage: null,  // 嗜血狂怒爆發狀態：{ until, pEnt, killCombo }（pEnt＝施放時的玩家實體，
                 // 供血飲術反噬定位；killCombo＝期間擊殺累積的連擊數加成，結束歸零）
    frenzy: null // 狂暴之舞狀態：{ until, pEnt, levels }
  };
}
resetSkill2RT(); // 載入即建立初始狀態

/* ===========================================================================
   等級與狀態存取
   =========================================================================== */

/* 生效等級（純函式，主執行緒 UI 與 Worker 共用）：
   raw ＝ 存檔的 levels 字典（G.player.skills2.levels 或面板快照），可為 null。
   正規化：整數、夾 0..上限、第 1 階恆至少 Lv.1、前一階未達 Lv.1 時後續階視為 0。 */
function sgEffectiveLevels(raw, gid) {
  var g = SKILLS2[gid];
  if (!g) return null;
  var src = raw ? raw[gid] : null;
  var out = [];
  for (var i = 0; i < g.tiers.length; i++) {
    var v = src && src[i] !== undefined ? Math.floor(Number(src[i])) : 0;
    if (!isFinite(v)) v = 0;
    out.push(Math.max(0, Math.min(SG_TIER_MAX_LV, v)));
  }
  if (out[0] < 1) out[0] = 1; // 第 1 階預設開啟
  for (i = 1; i < out.length; i++) if (out[i - 1] < 1) out[i] = 0;
  return out;
}

/* Worker 端讀取（讀 G）。 */
function skills2Levels(gid) {
  var raw = (typeof G !== 'undefined' && G && G.player && G.player.skills2) ? G.player.skills2.levels : null;
  return sgEffectiveLevels(raw, gid);
}
function skills2Castable(gid) {
  var l = skills2Levels(gid);
  return !!l && l[0] >= 1;
}
/* 火球術第 7 階是「改為」殞石術：自動施法時不再讓舊技能 fireball 併發。 */
function skills2FireballIsMeteor() {
  var l = skills2Levels('fireball');
  return !!l && l[6] > 0;
}

/* fx 參數在指定等級的值：<鍵> + <鍵>Per ×（等級-1）。等級至少以 1 計。 */
function sgVal(fx, key, lv) {
  return (Number(fx[key]) || 0) + (Number(fx[key + 'Per']) || 0) * (Math.max(1, Number(lv) || 1) - 1);
}

/* 群組初始矩形範圍：表格 range 使用「長*寬」（米）文字格式；
   後續升級倍率與追加距離仍由各技能程式控制。格式不合法時回傳 0，讓呼叫端使用既有退化值。 */
function sgRange(range) {
  var m = String(range == null ? '' : range).trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*\*\s*([0-9]+(?:\.[0-9]+)?)$/);
  if (!m) return { length: 0, width: 0 };
  return { length: Number(m[1]) || 0, width: Number(m[2]) || 0 };
}

/* ---- 群組傷害類型與屬性（表格欄位；未填＝物理、無屬性，維持既有八個武技群組的行為）---- */
function sgIsMagic(g) { return !!g && g.dmgType === 'magic'; }
/* 傷害基準屬性：魔法群組吃魔攻、其餘吃物攻。 */
function sgGroupBaseStat(g, st) {
  return sgIsMagic(g) ? (Number(st && st.matk) || 0) : (Number(st && st.atk) || 0);
}
/* 特效分類鍵（顏色與畫法）：與傷害類型同源，不另外設一欄。 */
function sgVfxCat(g) { return sgIsMagic(g) ? 'magic' : 'phys'; }

/* 群組目前的施法距離（像素）：由各階 fx.castM（米）決定——
   基準取第 1 階，之後每個「已投資且有定義 castM」的階可覆寫（殞石術把射程改成 20 米）。
   全部階都沒定義＝近戰技能，退回普攻近戰距離（既有八個武技群組即屬此類）。 */
function skills2CastRangePx(gid, lvs) {
  var g = SKILLS2[gid];
  if (!g) return 0;
  var m = 0;
  for (var i = 0; i < g.tiers.length; i++) {
    if (i > 0 && (!lvs || lvs[i] < 1)) continue;
    var v = Number(g.tiers[i].fx && g.tiers[i].fx.castM);
    if (isFinite(v) && v > 0) m = v;
  }
  if (!(m > 0)) return (typeof bfMeleeRange === 'function') ? bfMeleeRange() : 0;
  return (typeof bfMeterPx === 'function') ? bfMeterPx(m) : 0;
}

/* 這個群組現在打得到這個目標嗎——施放閘門（js/skills.js）與起手主目標篩選的唯一判定。
   無座標的實體（高塔 BOSS）沿用戰場既有規則：不擋。 */
function skills2CanReach(gid, ent, lvs) {
  if (!ent || ent.hp <= 0) return false;
  if (typeof bfPos !== 'function' || !bfPos(ent)) return true;
  if (typeof bfEntityDistance !== 'function') return true;
  return bfEntityDistance(ent) <= skills2CastRangePx(gid, lvs || skills2Levels(gid));
}

/* 火焰增幅（火球術第 6 階）目前的火屬性傷害提升%。
   掛點：js/legendary.js legendaryElementDamageUp——全專案「屬性傷害提升」的唯一收斂點，
   因此普攻的元素附傷、舊技能與新技能一體生效，不必在各傷害端各掛一次。 */
function skill2FireAmpPct(pEnt) {
  return (typeof buffVal === 'function') ? Math.max(0, buffVal(pEnt, 'sgFireAmp')) : 0;
}

/* 小數次數 → 實際次數：整數部分保底，小數部分為額外 1 次的機率。 */
function sgRollCount(x) {
  var n = Math.floor(Math.max(0, Number(x) || 0));
  var frac = Math.max(0, Number(x) || 0) - n;
  if (frac > 0 && typeof chance === 'function' && chance(frac * 100)) n++;
  return n;
}

/* 升級費用（純函式）：goldBase × goldGrow^目前等級，取整。 */
function skills2UpgradeCost(gid, tierIdx, curLv) {
  var g = SKILLS2[gid];
  var t = g && g.tiers[tierIdx];
  if (!t) return 0;
  var grow = Number(t.goldGrow) || 1;
  return Math.floor((Number(t.goldBase) || 0) * Math.pow(grow, Math.max(0, Number(curLv) || 0)));
}

/* 群組總投資等級（前端「同一個技能不斷變強」的顯示用）。 */
function sgTotalLevel(lvs) {
  var s = 0;
  for (var i = 0; i < (lvs ? lvs.length : 0); i++) s += lvs[i];
  return s;
}

/* ---- 指令實作（Worker 端；回傳 null＝成功、字串＝拒絕原因） ---- */
function skills2Learn(group, tier) {
  var g = SKILLS2[group];
  if (!g) return '未知技能群組';
  tier = Math.floor(Number(tier));
  if (!(tier >= 0 && tier < g.tiers.length)) return '未知階數';
  var lvs = skills2Levels(group);
  if (tier > 0 && lvs[tier - 1] < 1) return '前一階需至少 Lv.1 才能解鎖此階';
  if (lvs[tier] >= SG_TIER_MAX_LV) return '此階已達等級上限';
  var cost = skills2UpgradeCost(group, tier, lvs[tier]);
  if ((G.player.gold || 0) < cost) return '金幣不足';
  G.player.gold -= cost;
  lvs[tier]++;
  if (!G.player.skills2) G.player.skills2 = { levels: {} };
  if (!G.player.skills2.levels) G.player.skills2.levels = {};
  G.player.skills2.levels[group] = lvs;
  UI.dirty.skills = true;
  UI.dirty.header = true;
  return null;
}
function skills2Downgrade(group, tier) {
  var g = SKILLS2[group];
  if (!g) return '未知技能群組';
  tier = Math.floor(Number(tier));
  if (!(tier >= 0 && tier < g.tiers.length)) return '未知階數';
  var lvs = skills2Levels(group);
  if (tier === 0 && lvs[0] <= 1) return '第 1 階至少保持 Lv.1';
  if (lvs[tier] <= 0) return '此階尚未投資';
  if (lvs[tier] === 1 && tier + 1 < lvs.length && lvs[tier + 1] > 0) return '後續階數已投資，需先將其降至 Lv.0';
  lvs[tier]--;
  if (!G.player.skills2) G.player.skills2 = { levels: {} };
  if (!G.player.skills2.levels) G.player.skills2.levels = {};
  G.player.skills2.levels[group] = lvs;
  UI.dirty.skills = true;
  UI.dirty.header = true;
  return null;
}

/* skills 面板投影（純讀取，不得寫入 G——建面板不能變成寫存檔）。 */
function skills2PanelView() {
  var out = { tierMax: SG_TIER_MAX_LV, levels: {} };
  for (var gid in SKILLS2) out.levels[gid] = skills2Levels(gid);
  return out;
}

/* ===========================================================================
   施放引擎
   =========================================================================== */

/* 本群組目前冷卻秒數：基礎冷卻（極速斬先扣固定秒數）→ 全域 CDR（skillCdFor，含 90% 上限）
   → 套用該技能自身的最低施放間隔。 */
function skills2Cooldown(gid, lvs, pEnt) {
  var g = SKILLS2[gid];
  var base = Number(g.cd) || 10;
  if (gid === 'gale' && lvs[5] > 0) base = Math.max(1, base - sgVal(g.tiers[5].fx, 'sec', lvs[5]));
  var cd = (typeof skillCdFor === 'function')
    ? skillCdFor({ cd: base }, (typeof buffVal === 'function' ? buffVal(pEnt, 'chronoCdr') : 0))
    : base;
  return (typeof skillCooldownWithMinimum === 'function')
    ? skillCooldownWithMinimum(cd) : Math.max(0.4, cd);
}

/* 虛弱（血刃斬第 3 階）：流血中的敵人受到的傷害提高。
   掛點：普攻與技能傷害的攻擊組態（doPlayerAttack／castSkill／本引擎自身）。 */
function skill2VulnPct(target) {
  if (!target || !target.dots || !target.dots.length) return 0;
  var lvs = skills2Levels('bloodblade');
  if (!lvs || lvs[2] < 1) return 0;
  if (!sgHasDot(target, 'sgBleed')) return 0;
  return sgVal(SKILLS2.bloodblade.tiers[2].fx, 'pct', lvs[2]);
}
function skill2VulnACfg(aCfg, target) {
  var pct = skill2VulnPct(target);
  if (pct > 0) aCfg.totalDmgPct = (aCfg.totalDmgPct || 0) + pct;
  return aCfg;
}

/* 狂風斬（疾風斬第 5 階）與嗜血狂怒（bloodrage 第 1 階）攻速乘算因子：
   突破攻速上限、與自身攻速相乘（兩者並存時再彼此相乘）。
   掛點：combat.js／tower.js 的普攻頻率乘算區（potentialVelocityFactor 旁）。 */
function skill2AspdFactor(pEnt) {
  if (typeof buffVal !== 'function') return 1;
  // 狂怒的攻速以 RT 為權威（增益只是投影）：殘留的增益不得繼續給值
  var rage = skill2RageActive() ? Math.max(0, buffVal(pEnt, 'sgBloodrage')) : 0;
  return (1 + Math.max(0, buffVal(pEnt, 'sgGale')) / 100) * (1 + rage / 100);
}

/* 暴風之舞化身中：無法普攻（可施放技能）。掛點：combat.js／tower.js 普攻閘門。 */
function skill2StormActive() {
  return !!(SKILL2_RT && SKILL2_RT.storm && SKILL2_RT.storm.until > GT);
}

/* ===========================================================================
   嗜血狂怒（bloodrage）：爆發增益。權威狀態＝SKILL2_RT.rage（until／killCombo），
   sgBloodrage 增益圖示與攻速值跟隨 rt.until 刷新；各階效果只在持續期間生效。
   =========================================================================== */
function skill2RageActive() {
  return !!(SKILL2_RT && SKILL2_RT.rage && SKILL2_RT.rage.until > GT);
}
function skill2RageLevels() {
  return skill2RageActive() ? skills2Levels('bloodrage') : null;
}

function skill2FrenzyActive() {
  return !!(SKILL2_RT && SKILL2_RT.frenzy && SKILL2_RT.frenzy.until > GT);
}
function skill2FrenzyLevels() {
  return skill2FrenzyActive() ? SKILL2_RT.frenzy.levels : null;
}
function skill2FrenzyComboBonus() {
  var lvs = skill2FrenzyLevels();
  if (!lvs || lvs[3] < 1) return 0;
  return sgVal(SKILLS2.dualdance.tiers[3].fx, 'add', lvs[3]);
}
function skill2FrenzySkillDamageMultiplier(attacker) {
  var lvs = skill2FrenzyLevels();
  if (!lvs || lvs[5] < 1) return 1;
  var rt = SKILL2_RT.frenzy;
  var pEnt = (attacker && attacker === rt.pEnt) ? attacker : rt.pEnt;
  if (!pEnt) return 1;
  var st = getStats();
  var hpLost = st.hp > 0 ? Math.max(0, 1 - Math.max(0, pEnt.hp) / st.hp) * 100 : 0;
  var shieldLost = pEnt.shieldMax > 0
    ? Math.max(0, 1 - Math.max(0, pEnt.shield || 0) / pEnt.shieldMax) * 100 : 0;
  var lossPct = hpLost + shieldLost;
  return 1 + lossPct * sgVal(SKILLS2.dualdance.tiers[5].fx, 'pct', lvs[5]) / 100;
}

/* 狂暴（第 2 階）：爆擊傷害乘算因子。掛點：combat.js playerAtkCfg 與本引擎 sgAtkCfg
   的 critDmg 欄（舊技能 castSkill 依「舊系統不動」原則不套用）。 */
function skill2RageCritDmgFactor() {
  var lvs = skill2RageLevels();
  if (!lvs || lvs[1] < 1) return 1;
  return 1 + sgVal(SKILLS2.bloodrage.tiers[1].fx, 'pct', lvs[1]) / 100;
}

/* 狂怒（第 3 階）×血飲術（第 6 階）×狂血盛宴（第 7 階，依目前失血比例動態計算）
   的最終輸出乘區。掛點：formula.js resolveHit 的傳奇最終乘區旁（僅玩家攻擊端），
   因此普攻、舊技能與新技能一體生效；持續傷害不經 resolveHit、不吃此乘區。 */
function skill2RageDamageMultiplier(attacker) {
  var lvs = skill2RageLevels();
  if (!lvs) return 1;
  var t = SKILLS2.bloodrage.tiers;
  var mult = 1;
  if (lvs[2] > 0) mult *= 1 + sgVal(t[2].fx, 'pct', lvs[2]) / 100;
  if (lvs[5] > 0) mult *= 1 + sgVal(t[5].fx, 'pct', lvs[5]) / 100;
  if (lvs[6] > 0 && attacker) {
    var st = getStats();
    var missPct = st.hp > 0 ? Math.max(0, (1 - Math.max(0, attacker.hp) / st.hp) * 100) : 0;
    if (missPct > 0) mult *= 1 + missPct * sgVal(t[6].fx, 'pct', lvs[6]) / 100;
  }
  return mult;
}

/* 狂血盛宴（第 7 階）：主攻擊仍鎖定主目標；每 1 連擊數再從主目標附近
   選 1 個額外敵人承受一次普攻傷害。不設技能層上限，實際目標數受附近存活敵人限制。
   掛點：combat.js 野外普攻入口。 */
function skill2RageBasicAttackTargets(primary, enemies) {
  if (!primary || primary.hp <= 0 || !Array.isArray(enemies)) return primary ? [primary] : [];
  var lvs = skill2RageLevels();
  if (!lvs || lvs[6] < 1 || typeof bfNearestOthers !== 'function') return [primary];
  var st = getStats();
  var comboHits = Math.max(0, Number(st && st.comboHits) || 0);
  // 狂化連殺提供的期間連擊數也屬於玩家目前可用的連擊數。
  if (typeof skill2ComboBonus === 'function') comboHits += Math.max(0, Number(skill2ComboBonus()) || 0);
  if (typeof skill2FrenzyComboBonus === 'function') comboHits += Math.max(0, Number(skill2FrenzyComboBonus()) || 0);
  var perCombo = Number(SKILLS2.bloodrage.tiers[6].fx.count) || 1;
  var extras = Math.floor(comboHits * perCombo);
  if (extras <= 0) return [primary];
  var nearbyGap = (typeof bfMeterPx === 'function') ? bfMeterPx(
    (typeof BF_MELEE_METERS === 'number' && BF_MELEE_METERS > 0) ? BF_MELEE_METERS : 5
  ) : 0;
  return [primary].concat(bfNearestOthers(primary, enemies, extras, nearbyGap));
}

/* 嗜血反震（第 5 階）：反震傷害乘算因子。掛點：combat.js playerDefCfg 的 thornsPct。 */
function skill2RageThornsFactor() {
  var lvs = skill2RageLevels();
  if (!lvs || lvs[4] < 1) return 1;
  return 1 + sgVal(SKILLS2.bloodrage.tiers[4].fx, 'pct', lvs[4]) / 100;
}

/* 狂化連殺（第 4 階）：連擊數加成＝基準值＋期間擊殺累積（killCombo）。
   掛點：combat.js 普攻的連擊數擲骰（rollComboHits）。 */
function skill2ComboBonus() {
  var lvs = skill2RageLevels();
  if (!lvs || lvs[3] < 1) return 0;
  return sgVal(SKILLS2.bloodrage.tiers[3].fx, 'add', lvs[3]) + (SKILL2_RT.rage.killCombo || 0);
}

/* 血飲術（第 6 階）反噬：狂怒期間，範圍內的敵人每次受傷都使你損失最大生命的
   一定比例（直接扣血、不吃護盾；GM 鎖血仍鎖 1；高塔敵人無座標＝一律視為在範圍內）。
   掛點：formula.js 的敵方扣血點（resolveHit 主傷害段／反震段、applyEnemyHpDamage）。 */
function skills2OnEnemyDamaged(ent, amount) {
  if (!(amount > 0) || !ent || ent._sgPreview) return; // 預覽命中（legendaryPreviewBasicAttack）不算受傷
  var lvs = skill2RageLevels();
  if (!lvs || lvs[5] < 1) return;
  var pEnt = SKILL2_RT.rage.pEnt;
  if (!pEnt || pEnt.hp <= 0) return;
  var fx = SKILLS2.bloodrage.tiers[5].fx;
  if (typeof bfPos === 'function' && bfPos(ent) && typeof bfEntityDistance === 'function' &&
      bfEntityDistance(ent) > bfMeterPx(Number(fx.m) || 80)) return;
  var st = getStats();
  var selfDmg = Math.max(1, Math.round(st.hp * (Number(fx.self) || 0) / 100));
  var gmFloor = (typeof GM_TEST !== 'undefined' && GM_TEST && GM_TEST.god) ? 1 : 0;
  pEnt.hp = Math.max(gmFloor, pEnt.hp - selfDmg);
}

function sgHasDot(ent, sid) {
  if (!ent || !ent.dots) return false;
  for (var i = 0; i < ent.dots.length; i++) {
    var d = ent.dots[i];
    if (d && d.sid === sid && d.until > GT) return true;
  }
  return false;
}
function sgFindDot(ent, sid) {
  if (!ent || !ent.dots) return null;
  for (var i = 0; i < ent.dots.length; i++) {
    var d = ent.dots[i];
    if (d && d.sid === sid && d.until > GT) return d;
  }
  return null;
}

/* 血刃斬的流血／中毒規格集中在這裡，供初次塗抹、屍爆傳染與零日感染傳染共用。
   零日感染的傷害加成直接乘在 dps，讓每跳傷害、剩餘傷害與後續傳染維持同一個數值。 */
function sgBloodbladeDotSpec(st, lvs, tiers, sid) {
  var baseVal = st.atk * sgVal(tiers[0].fx, 'pct', lvs[0]) / 100;
  var zeroBonus = lvs[6] > 0 ? 1 + sgVal(tiers[6].fx, 'pct', lvs[6]) / 100 : 1;
  if (sid === 'sgBleed') {
    var bleedGap = Math.max(0.1, (Number(tiers[0].fx.dotGap) || 1) *
      (1 - (lvs[1] > 0 ? sgVal(tiers[1].fx, 'gapPct', lvs[1]) : 0) / 100));
    return {
      dps: baseVal * sgVal(tiers[0].fx, 'dotPct', lvs[0]) / 100 * zeroBonus / bleedGap,
      dur: (Number(tiers[0].fx.dotSec) || 5) + (lvs[1] > 0 ? sgVal(tiers[1].fx, 'sec', lvs[1]) : 0),
      interval: bleedGap
    };
  }
  if (sid === 'sgPoison' && lvs[3] > 0) {
    var poisonGap = Math.max(0.1, Number(tiers[3].fx.dotGap) || 0.5);
    return {
      dps: baseVal * sgVal(tiers[3].fx, 'dotPct', lvs[3]) / 100 * zeroBonus / poisonGap,
      dur: Number(tiers[3].fx.dotSec) || 4,
      interval: poisonGap
    };
  }
  return null;
}

function sgApplyBloodbladeDot(ent, sid, spec, dur) {
  if (!ent || !spec) return;
  applyStatus(ent, sid, {
    dps: spec.dps,
    dur: Math.max(0.2, Number(dur) || spec.dur),
    interval: spec.interval
  });
}

/* 零日感染的接收者是範圍內隨機 1 個，不沿用「最近 N 個」的幾何選擇規則。 */
function sgRandomBloodbladeTarget(from, enemies, fx, lv) {
  var radius = bfMeterPx(sgVal(fx, 'm', lv) || 80);
  var live = [];
  for (var i = 0; i < (enemies || []).length; i++) {
    var e = enemies[i];
    if (!e || e === from || e.hp <= 0) continue;
    if (typeof bfPos === 'function' && bfPos(from) && bfPos(e) &&
        typeof bfEntityGap === 'function' && bfEntityGap(from, e) > radius) continue;
    live.push(e);
  }
  if (!live.length) return null;
  return live[Math.floor(Math.random() * live.length)];
}

/* 零日感染結束時同時傳染兩種狀態；來源缺少其中一種時，以血刃斬的技能規格補上。 */
function sgSpreadBloodbladeDots(source, enemies, st, lvs, tiers) {
  var zeroFx = tiers[6].fx;
  var target = sgRandomBloodbladeTarget(source, enemies, zeroFx, lvs[6]);
  if (!target) return null;
  var specs = { sgBleed: sgBloodbladeDotSpec(st, lvs, tiers, 'sgBleed'),
    sgPoison: sgBloodbladeDotSpec(st, lvs, tiers, 'sgPoison') };
  var sourceBleed = sgFindDot(source, 'sgBleed');
  var sourcePoison = sgFindDot(source, 'sgPoison');
  if (sourceBleed) sgApplyBloodbladeDot(target, 'sgBleed', sourceBleed, sourceBleed.until - GT);
  else sgApplyBloodbladeDot(target, 'sgBleed', specs.sgBleed);
  if (sourcePoison) sgApplyBloodbladeDot(target, 'sgPoison', sourcePoison, sourcePoison.until - GT);
  else sgApplyBloodbladeDot(target, 'sgPoison', specs.sgPoison);
  // 新感染的狀態不得在同一個 tick 立刻再作用，避免一次傳染遞迴成整群連鎖。
  target._sgDotSkipAt = GT;
  return target;
}

/* 攻擊組態（比照 castSkill 的技能傷害段規格：命中地板 100、含裝備元素攻擊、
   神鑄被動與敵種加成；另計本系統的狂暴爆擊增益與虛弱增傷）。
   傷害類型與屬性由群組決定：魔法群組走魔攻／魔穿，並把整段本體傷害歸屬該屬性
   （skillElem，比照 js/skills.js skillElemApplyACfg 的技能屬性化規則）。 */
function sgAtkCfg(pEnt, st, dmgVal, target, bonusTotalPct, gid) {
  var g = SKILLS2[gid];
  var magic = sgIsMagic(g);
  var aCfg = {
    atk: dmgVal, dmgType: magic ? 'magic' : 'phys', level: st.level,
    critRate: st.critRate + (typeof buffVal === 'function' ? buffVal(pEnt, 'sgCritUp') : 0),
    // 嗜血狂怒【狂暴】：爆擊傷害乘算（與狂暴之舞的加算增益疊乘）
    critDmg: (st.critDmg + (typeof buffVal === 'function' ? buffVal(pEnt, 'sgCritDmgUp') : 0)) * skill2RageCritDmgFactor(),
    hit: Math.max(100, st.hit),
    pen: magic
      ? ((typeof effectiveMPen === 'function') ? effectiveMPen(st, pEnt) : 0)
      : ((typeof effectivePPen === 'function') ? effectivePPen(st, pEnt) : 0),
    sunder: (st.passives && st.passives.sunder) || 0,
    trueDmgPct: (st.passives && st.passives.trueDmg) || 0,
    annihilate: (st.passives && st.passives.annihilate) || 0,
    elemAtk: st.elemAtk || null, elemDmgPct: st.elemDmgPct,
    elemDmgUp: (typeof legendaryElementDamageUp === 'function') ? legendaryElementDamageUp(st, pEnt) : st.elemDmgUp,
    eliteDmg: st.eliteDmg, bossDmg: st.bossDmg, normalDmg: st.normalDmg,
    totalDmgPct: (st.totalDmgPct || 0) + (typeof buffVal === 'function' ? buffVal(pEnt, 'allDmgUp') : 0) + (bonusTotalPct || 0),
    dmgVsElem: st.dmgVsElem,
    isPlayer: true, isSkill: true
  };
  if (g && g.elem) aCfg.skillElem = g.elem;
  return skill2VulnACfg(aCfg, target);
}

/* 一次獨立命中（走完整 resolveHit 傷害管線：防禦、爆擊、格擋、護盾、敵種倍率）。
   回傳 resolveHit 結果；同時記錄浮字／DPS／輸出統計並更新 out。 */
function sgHitOne(pEnt, st, target, dmgVal, gid, floatSel, out, delayMs, bonusTotalPct) {
  if (!target || target.hp <= 0 || !(dmgVal > 0)) return null;
  var g = SKILLS2[gid];
  var res = resolveHit(pEnt, target, sgAtkCfg(pEnt, st, dmgVal, target, bonusTotalPct, gid), monsterDefCfg(target));
  if (typeof applySkillFinalDamageMultiplier === 'function') applySkillFinalDamageMultiplier(target, res, false);
  if (!res.miss) {
    out.dmg += res.dmg;
    if (res.crit) out.crit = true;
    var s = fmt(res.dmg);
    if (res.crit) s = '爆擊 ' + s;
    if (res.blocked) s = '格擋 ' + s;
    if (typeof floatEnemyEvent === 'function') {
      floatEnemyEvent(target, floatSel, g.emoji + s,
        (typeof combatDamageFloatClass === 'function') ? combatDamageFloatClass('enemy-skill', res) : 'enemy-skill',
        res.dmg, delayMs);
    }
    if (typeof trackDps === 'function') trackDps(res.dmg);
    if (typeof recordRunDamage === 'function') recordRunDamage(g.name, res.dmg, 'skill2:' + gid, sgTotalLevel(skills2Levels(gid)));
  } else if (typeof floatEnemyEvent === 'function') {
    floatEnemyEvent(target, floatSel, 'MISS', 'miss enemy-dodge', undefined, delayMs);
  }
  if (res.killed) out.killed = true;
  return res;
}

/* 衍生傷害（占「已造成傷害」比例的擴散等）：不再過防禦與爆擊，直接扣血。 */
function sgDerivedHit(target, amount, gid, floatSel, out, label, delayMs) {
  if (!target || target.hp <= 0 || !(amount > 0)) return 0;
  var skillMult = (typeof skill2FrenzySkillDamageMultiplier === 'function')
    ? skill2FrenzySkillDamageMultiplier() : 1;
  var dealt = applyEnemyHpDamage(target, Math.max(1, Math.round(amount * skillMult)));
  if (dealt <= 0) return 0;
  out.dmg += dealt;
  if (typeof floatEnemyEvent === 'function') {
    floatEnemyEvent(target, floatSel, label + fmt(dealt), 'enemy-skill', dealt, delayMs);
  }
  if (typeof trackDps === 'function') trackDps(dealt);
  if (typeof recordRunDamage === 'function') {
    var g = SKILLS2[gid];
    recordRunDamage(g ? g.name : gid, dealt, 'skill2:' + gid, sgTotalLevel(skills2Levels(gid)));
  }
  if (target.hp <= 0) { target.hp = 0; out.killed = true; }
  return dealt;
}

/* 特效事件（協議 v17 既有 fxKind／variant，顯示層不認得的變體會退回預設畫法）。 */
function sgEmitVfx(gid, targets, floatSel, extra) {
  if (typeof playCombatVfx !== 'function' || typeof enemyEventFloatTarget !== 'function') return;
  var g = SKILLS2[gid];
  var ids = [];
  for (var i = 0; i < targets.length && ids.length < 8; i++) {
    if (targets[i] && targets[i].hp > 0) ids.push(enemyEventFloatTarget(targets[i], floatSel));
  }
  var cat = sgVfxCat(g);
  var spec = {
    fxKind: (extra && extra.fxKind) || 'slash',
    glyph: g.emoji,
    color: (typeof VFX_CAT_COLORS !== 'undefined' && VFX_CAT_COLORS[cat]) || '#f97316',
    cat: cat, elem: (extra && extra.elem) || g.elem || null,
    targets: ids, area: (extra && extra.area) || null,
    dur: (extra && extra.dur) || 0.5,
    count: Math.max(1, Math.min(5, (extra && extra.count) || 1))
  };
  if (extra && extra.variant) spec.variant = extra.variant;
  if (extra && extra.travelMs) spec.travelMs = extra.travelMs;
  if (extra && extra.delayMs > 0) spec.delayMs = Number(extra.delayMs);
  if (extra && extra.projectile) spec.projectile = true;
  if (extra && extra.lineLength) spec.lineLength = Number(extra.lineLength);
  if (extra && extra.lineWidth) spec.lineWidth = Number(extra.lineWidth);
  if (extra && extra.laneOffsets) spec.laneOffsets = extra.laneOffsets.slice(0, 3);
  if (extra && extra.directionCount) spec.directionCount = Number(extra.directionCount);
  playCombatVfx(spec);
}

var SG_HIT_STAGGER_SEC_FALLBACK = 0.09;
function sgStaggerMs(hitIndex) {
  var s = (typeof VFX_HIT_STAGGER_SEC === 'number') ? VFX_HIT_STAGGER_SEC : SG_HIT_STAGGER_SEC_FALLBACK;
  return Math.round(Math.max(0, hitIndex || 0) * s * 1000);
}

function sgProjectileNow() {
  return typeof GT === 'number' ? GT : 0;
}

/* 飛行物只保存執行期資料；命中仍走既有完整傷害管線。 */
function sgQueueFlyingProjectile(pEnt, st, gid, dmgVal, origin, angle, length, floatSel, fallbackTargets, extra, out) {
  if (!(length > 0)) return;
  var now = sgProjectileNow();
  var start = origin && isFinite(origin.x) && isFinite(origin.y)
    ? { x: Number(origin.x), y: Number(origin.y) } : null;
  var speed = extra && Number(extra.speed) > 0 ? Number(extra.speed) : SG_FLYING_PROJECTILE_SPEED;
  var travel = extra && Number(extra.travelMs) > 0
    ? Math.max(0.05, Number(extra.travelMs) / 1000)
    : Math.max(0.05, Number(length) / speed);
  var p = {
    pEnt: pEnt, st: st, gid: gid, dmgVal: dmgVal, origin: start,
    angle: Number(angle) || 0, length: Number(length), speed: speed,
    startAt: now, lastAt: now, lastDistance: 0, endAt: now + travel,
    fallbackTargets: fallbackTargets || [], floatSel: floatSel,
    out: out, states: [], started: false,
    hitFn: extra && typeof extra.hitFn === 'function' ? extra.hitFn : null,
    rehit: !(extra && extra.singleHit),
    waitForEnd: !!(extra && extra.waitForEnd),
    targetOnly: !!(extra && extra.targetOnly),
    burnSpec: extra && extra.burnSpec || null,
    victims: extra && extra.victims || null,
    splitTargets: extra && extra.splitTargets || null,
    splitDmgVal: extra && Number(extra.splitDmgVal) > 0 ? Number(extra.splitDmgVal) : 0,
    spreadPct: extra && extra.spreadPct || 0,
    spreadCount: extra && extra.spreadCount || 0,
    halfWidthPx: extra && Number(extra.halfWidthPx) > 0 ? Number(extra.halfWidthPx) : 0,
    stunChance: extra && extra.stunChance || 0,
    stunSec: extra && extra.stunSec || 0
  };
  out._pendingProjectiles = (out._pendingProjectiles || 0) + 1;
  SKILL2_RT.projectiles.push(p);
}

/* 飛行物技能的總傷害在路徑命中完成前尚未確定；技能字要等所有同一施放
   建立的飛行物結束後才送出，避免只顯示技能名稱或顯示 0 傷害。 */
function sgFinishSkillCastFloat(out) {
  if (!out) return;
  out._pendingProjectiles = Math.max(0, (out._pendingProjectiles || 0) - 1);
  if (out._pendingProjectiles > 0 || !out._skillFloatPending) return;
  var pending = out._skillFloatPending;
  out._skillFloatPending = null;
  if (typeof floatPlayerSkillCast === 'function') {
    floatPlayerSkillCast(pending.floatSel, pending.skill, out.dmg);
  }
}

function sgProjectileState(projectile, target) {
  for (var i = 0; i < projectile.states.length; i++) {
    if (projectile.states[i].ent === target) return projectile.states[i];
  }
  return null;
}

function sgProjectileHit(projectile, target, ctx) {
  if (!target || target.hp <= 0) return;
  if (projectile.hitFn) {
    projectile.hitFn(projectile, target, ctx);
    return;
  }
  var res = sgHitOne(projectile.pEnt, projectile.st, target, projectile.dmgVal,
    projectile.gid, projectile.floatSel, projectile.out, 0);
  if (!res || res.miss) return;
  if (ctx.onDamage) ctx.onDamage(res.dmg);

  if (projectile.spreadPct > 0 && projectile.spreadCount > 0) {
    var live = ctx.getEnemies ? ctx.getEnemies() : [];
    var others = bfNearestOthers(target, live, projectile.spreadCount);
    for (var i = 0; i < others.length; i++) {
      var wasAlive = others[i].hp > 0;
      var beforeSpread = projectile.out.dmg;
      sgDerivedHit(others[i], res.dmg * projectile.spreadPct / 100, projectile.gid,
        projectile.floatSel, projectile.out, SKILLS2[projectile.gid].emoji, 0);
      if (wasAlive && others[i].hp <= 0 && ctx.onDeaths) ctx.onDeaths();
      if (ctx.onDamage && projectile.out.dmg > beforeSpread) ctx.onDamage(projectile.out.dmg - beforeSpread);
    }
  }
  if (projectile.stunChance > 0 && chance(projectile.stunChance) &&
      !(typeof isBossControlImmune === 'function' && isBossControlImmune(target)) &&
      !(typeof resistCtrl === 'function' && resistCtrl(monsterDefCfg(target)))) {
    applyStatus(target, 'stun', { dur: projectile.stunSec });
  }
  if (res.killed && ctx.onDeaths) ctx.onDeaths();
}

function sgTickFlyingProjectiles(dt, ctx) {
  var list = SKILL2_RT.projectiles;
  if (!list || !list.length) return;
  var now = sgProjectileNow();
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  for (var pi = list.length - 1; pi >= 0; pi--) {
    var projectile = list[pi];
    var distance = projectile.origin
      ? Math.min(projectile.length, Math.max(0, (now - projectile.startAt) * projectile.speed))
      : projectile.length;
    var crossed;
    if (projectile.origin && typeof bfSegmentTargets === 'function') {
      crossed = bfSegmentTargets(projectile.origin, projectile.angle,
        projectile.lastDistance, distance, enemies,
        Math.max(SG_FLYING_PROJECTILE_HALF_WIDTH, projectile.halfWidthPx || 0));
    } else if (!projectile.started && (!projectile.waitForEnd || now >= projectile.endAt)) {
      crossed = projectile.fallbackTargets.slice();
    } else {
      crossed = [];
    }
    if (projectile.targetOnly) {
      crossed = (now >= projectile.endAt && projectile.fallbackTargets.length)
        ? [projectile.fallbackTargets[0]] : [];
    }
    for (var ci = 0; ci < crossed.length; ci++) {
      if (sgProjectileState(projectile, crossed[ci])) continue;
      var state = { ent: crossed[ci], nextAt: now + SG_FLYING_PROJECTILE_REHIT_SEC,
        repeated: !projectile.rehit };
      projectile.states.push(state);
      sgProjectileHit(projectile, crossed[ci], ctx);
    }
    for (var si = 0; si < projectile.states.length; si++) {
      var hitState = projectile.states[si];
      if (hitState.repeated || hitState.nextAt > now) continue;
      if (hitState.ent && hitState.ent.hp > 0) sgProjectileHit(projectile, hitState.ent, ctx);
      hitState.repeated = true;
    }
    projectile.lastDistance = distance;
    projectile.lastAt = now;
    projectile.started = true;
    var pathDone = !projectile.origin || distance >= projectile.length;
    var allRepeated = true;
    for (var ri = 0; ri < projectile.states.length; ri++) {
      if (!projectile.states[ri].repeated) { allRepeated = false; break; }
    }
    if (pathDone && allRepeated && now >= projectile.endAt) {
      list.splice(pi, 1);
      sgFinishSkillCastFloat(projectile.out);
    }
  }
}

/* ---- 施放總入口 ----
   pEnt 玩家戰鬥實體、target 為敵人陣列（野外）或單一實體（高塔）、gid 群組 id。
   opts.storm＝暴風之舞自動施放（不扣魔、不進自身冷卻、不重複觸發暴風）。
   回傳 { killed, dmg, crit } 或 null（無法施放）。 */
function castSkill2(pEnt, target, gid, floatSel, opts) {
  var g = SKILLS2[gid];
  if (!g || !skills2Castable(gid)) return null;
  if (skills2IsPassive(gid)) return null; // 被動群組（反擊）不可施放
  var st = getStats();
  var lvs = skills2Levels(gid);
  var storm = !!(opts && opts.storm);
  var rawPool = Array.isArray(target)
    ? target.filter(function (e) { return e && e.hp > 0; })
    : ((target && target.hp > 0) ? [target] : []);
  /* 起手主目標必須在群組的施法距離內（武技＝普攻近戰距離、魔法＝表定射程）；
     但 pool 必須保留完整敵群，讓貫穿、範圍擴散與周圍敵人等階段仍能命中射程外的目標。 */
  if (!rawPool.length) return null;
  var reachable = rawPool.filter(function (e) { return skills2CanReach(gid, e, lvs); });
  if (!reachable.length) return null;
  /* 後續幾何與範圍技能仍需看到完整存活敵群；只有起手主目標用 reachable。 */
  var pool = rawPool;
  var primary = (typeof bfPickPrimary === 'function')
    ? bfPickPrimary(reachable, pEnt._lockTarget) : reachable[0];
  if (!primary) return null;

  if (!storm) {
    pEnt.mp = Math.max(0, pEnt.mp - (Number(g.cost) || 0));
    if (!pEnt.skillCds) pEnt.skillCds = {};
    pEnt.skillCds[SG_PREFIX + gid] = skills2Cooldown(gid, lvs, pEnt);
  }

  var out = { killed: false, dmg: 0, crit: false };
  switch (gid) {
    case 'thrust': sgCastThrust(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'cleave': sgCastCleave(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'knife': sgCastKnife(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'gale': sgCastGale(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'bloodblade': sgCastBloodblade(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'dualdance': sgCastDualdance(pEnt, st, g, lvs, pool, primary, floatSel, out, storm); break;
    case 'bloodrage': sgCastBloodrage(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'fireball': sgCastFireball(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'firepillar': sgCastFirepillar(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'firehunt': sgCastFirehunt(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    default: return null;
  }
  if (!storm && typeof floatPlayerSkillCast === 'function') {
    var skillFloat = { emoji: g.emoji, name: g.name };
    if (out._pendingProjectiles > 0) {
      out._skillFloatPending = { floatSel: floatSel, skill: skillFloat };
    } else {
      floatPlayerSkillCast(floatSel, skillFloat, out.dmg);
    }
  }
  if (typeof blog === 'function' && !storm) {
    blog(g.emoji + ' 你施放【' + g.name + ' Lv.' + sgTotalLevel(lvs) + '】' +
      (out.dmg > 0 ? '，造成 ' + fmt(out.dmg) + ' 傷害' : ''));
  }
  return out;
}

/* ---- 突刺 ---- */
function sgThrustOffsetOrigin(angle, offsetPx) {
  var p = (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null;
  if (!p || !offsetPx) return p;
  var side = angle + Math.PI / 2;
  return { x: p.x + Math.cos(side) * offsetPx, y: p.y + Math.sin(side) * offsetPx };
}

function sgCastThrust(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[2] > 0) pct += sgVal(t[2].fx, 'pct', lvs[2]);
  if (lvs[6] > 0) pct += sgVal(t[6].fx, 'pct', lvs[6]);

  // 說明中的次數要逐項累加：第 1 階兩次；第 7 階再加三次；第 2 階觸發時再加兩次。
  var thrustCount = Math.max(1, Math.floor(Number(t[0].fx.count) || 2));
  if (lvs[6] > 0) thrustCount += Math.max(1, Math.floor(Number(t[6].fx.count) || 3));
  if (lvs[1] > 0 && chance(sgVal(t[1].fx, 'chance', lvs[1]))) {
    thrustCount += Math.max(1, Math.floor(Number(t[1].fx.count) || 2));
  }

  var dmgVal = st.atk * pct / 100;
  var baseAngle = (typeof bfAngleTo === 'function') ? bfAngleTo(primary) : null;
  var geomOk = baseAngle !== null;
  var baseRange = sgRange(g.range);
  var rangeScale = lvs[3] > 0 ? 1 + sgVal(t[3].fx, 'range', lvs[3]) / 100 : 1;
  var lineLen = bfMeterPx(baseRange.length || 6) * rangeScale;
  if (lvs[5] > 0) lineLen += bfMeterPx(sgVal(t[5].fx, 'm', lvs[5]));
  var lineWidth = bfMeterPx(baseRange.width || 2) * rangeScale;
  var isEightWay = lvs[6] > 0;
  // 第 4 階的三道平行路徑與第 7 階的八方方向可同時存在；高階效果不覆蓋低階效果。
  var isParallel = lvs[3] > 0;
  var directions = [0];
  var directionCount = isEightWay ? Math.max(1, Math.floor(Number(t[6].fx.directions) || 8)) : 1;
  if (isEightWay) {
    directions = [];
    for (var di = 0; di < directionCount; di++) directions.push(di * Math.PI * 2 / directionCount);
  }
  var laneOffsets = isParallel ? [-lineWidth / 2, 0, lineWidth / 2] : [0];
  var laneHalfWidth = isParallel ? lineWidth / 6 : lineWidth / 2;
  var isPiercing = lvs[3] > 0 || lvs[5] > 0 || lvs[6] > 0;
  var plans = [];
  var planned = [];

  if (geomOk) {
    for (var pdi = 0; pdi < directions.length; pdi++) {
      var pathAngle = baseAngle + directions[pdi];
      for (var pli = 0; pli < laneOffsets.length; pli++) {
        var laneOffset = laneOffsets[pli];
        var pathOrigin = sgThrustOffsetOrigin(pathAngle, laneOffset) || bfPlayerPos();
        var pathWidth = isPiercing ? laneHalfWidth : lineWidth / 2;
        var pathTargets = bfLineTargets(pathAngle, lineLen, pool, pathWidth, pathOrigin);
        if (pdi === 0 && pli === Math.floor(laneOffsets.length / 2) &&
            primary.hp > 0 && pathTargets.indexOf(primary) < 0) pathTargets.unshift(primary);
        plans.push({ angle: pathAngle, origin: pathOrigin, targets: pathTargets, halfWidth: pathWidth });
        for (var pti = 0; pti < pathTargets.length; pti++) {
          if (planned.indexOf(pathTargets[pti]) < 0) planned.push(pathTargets[pti]);
        }
      }
    }
  } else {
    plans.push({ angle: 0, origin: null, targets: [primary], halfWidth: 0 });
    planned.push(primary);
  }

  var thrustVariant = isEightWay ? 'thrust-octagonal' : (isParallel ? 'thrust-parallel' :
    (lvs[5] > 0 ? 'thrust-pierce' : 'thrust'));
  sgEmitVfx('thrust', planned, floatSel, {
    fxKind: 'slash', variant: thrustVariant, count: Math.min(8, thrustCount), projectile: isPiercing,
    dur: 0.3,
    lineLength: lineLen, lineWidth: Math.max(28, lineWidth), laneOffsets: laneOffsets,
    directionCount: directionCount
  });

  if (isPiercing) {
    var spreadPct = lvs[4] > 0 ? sgVal(t[4].fx, 'pct', lvs[4]) : 0;
    var spreadCount = lvs[4] > 0 ? Math.max(1, Math.floor(Number(t[4].fx.count) || 4)) : 0;
    for (var pr = 0; pr < thrustCount; pr++) {
      for (var pi = 0; pi < plans.length; pi++) {
        var plan = plans[pi];
        sgQueueFlyingProjectile(pEnt, st, 'thrust', dmgVal,
          plan.origin, plan.angle, lineLen, floatSel, plan.targets,
          { spreadPct: spreadPct, spreadCount: spreadCount, halfWidthPx: plan.halfWidth }, out);
      }
    }
    return;
  }

  var hitIdx = 0;
  for (var r = 0; r < thrustCount; r++) {
    for (var pi2 = 0; pi2 < plans.length; pi2++) {
      var hitTargets = plans[pi2].targets;
      for (var ti = 0; ti < hitTargets.length; ti++) {
        var res = sgHitOne(pEnt, st, hitTargets[ti], dmgVal, 'thrust', floatSel, out, sgStaggerMs(hitIdx));
        if (res && !res.miss && lvs[4] > 0) {
          var spreadPct2 = sgVal(t[4].fx, 'pct', lvs[4]);
          var others = bfNearestOthers(hitTargets[ti], pool, Math.max(1, Math.floor(Number(t[4].fx.count) || 4)));
          for (var oi = 0; oi < others.length; oi++) {
            sgDerivedHit(others[oi], res.dmg * spreadPct2 / 100, 'thrust', floatSel, out, g.emoji, sgStaggerMs(hitIdx + 1));
          }
        }
      }
      hitIdx++;
    }
  }
}

/* ---- 迴旋斬 ---- */
function sgCastCleave(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[2] > 0) pct += sgVal(t[2].fx, 'pct', lvs[2]);
  if (lvs[6] > 0) pct += sgVal(t[6].fx, 'pct', lvs[6]);
  var dmgVal = st.atk * pct / 100;
  var count = Math.max(1, Math.floor(Number(t[0].fx.count) || 3) +
    (lvs[1] > 0 ? sgRollCount(sgVal(t[1].fx, 'add', lvs[1])) : 0));
  var slashes = 1;
  if (lvs[3] > 0 && chance(sgVal(t[3].fx, 'chance', lvs[3]))) {
    slashes = Math.max(1, sgRollCount(sgVal(t[3].fx, 'times', lvs[3])));
  }
  // 迴身雙連斬：前後兩個方向各至少完整斬出表定次數；若連斬同時觸發，保留較高次數。
  if (lvs[6] > 0) {
    slashes = Math.max(slashes, Math.max(1, sgRollCount(sgVal(t[6].fx, 'times', lvs[6]))));
  }
  var geomOk = (typeof bfPos === 'function') && !!bfPos(primary);
  var baseAngle = geomOk ? bfAngleTo(primary) : null;

  var targets = [];
  var directionTargets = [];
  var directions = lvs[6] > 0 ? [0, Math.PI / 2, Math.PI, Math.PI * 1.5] : [0];
  if (lvs[6] > 0) {
    // 迴身雙連斬：以玩家朝向為基準，分別取前、右、後、左四個十字方向的目標。
    for (var di = 0; di < directions.length; di++) {
      var dirRange = (di === 0 && lvs[5] > 0)
        ? bfMeterPx(sgVal(t[5].fx, 'm', lvs[5]))
        : ((typeof bfMeleeRange === 'function') ? bfMeleeRange() : bfMeterPx(5));
      var dirTargets = geomOk ? bfLineTargets(baseAngle + directions[di], dirRange, pool).slice(0, count) : [primary];
      if (di === 0 && geomOk && primary.hp > 0 && dirTargets.indexOf(primary) < 0) {
        dirTargets.unshift(primary);
        if (dirTargets.length > count) dirTargets.pop();
      }
      // 震碎斬的前方延伸仍套用在十字斬的前方刀光上。
      if (di === 0 && lvs[5] > 0 && geomOk) {
        var crossLine = bfLineTargets(baseAngle, bfMeterPx(sgVal(t[5].fx, 'm', lvs[5])), pool);
        for (var cli = 0; cli < crossLine.length; cli++) {
          if (dirTargets.indexOf(crossLine[cli]) < 0) dirTargets.push(crossLine[cli]);
        }
      }
      directionTargets.push(dirTargets);
      for (var dti = 0; dti < dirTargets.length; dti++) {
        if (targets.indexOf(dirTargets[dti]) < 0) targets.push(dirTargets[dti]);
      }
    }
  } else {
    // 前方目標：主目標＋離主目標最近的其他敵人
    targets = [primary].concat(bfNearestOthers(primary, pool, count - 1));
    // 震碎斬：斬擊向前飛出，聯集路徑上的敵人
    if (lvs[5] > 0 && geomOk) {
      var line = bfLineTargets(baseAngle, bfMeterPx(sgVal(t[5].fx, 'm', lvs[5])), pool);
      for (var li = 0; li < line.length; li++) if (targets.indexOf(line[li]) < 0) targets.push(line[li]);
    }
    directionTargets.push(targets);
  }
  var cleaveVariant = lvs[6] > 0 ? (lvs[5] > 0 ? 'cleave-cross-shockwave' : 'cleave-cross')
    : (lvs[5] > 0 ? 'cleave-shockwave' : 'cleave');
  sgEmitVfx('cleave', targets, floatSel, {
    fxKind: 'slash', variant: cleaveVariant, count: Math.min(5, slashes), projectile: lvs[5] > 0
  });
  var stunChance = lvs[4] > 0 ? sgVal(t[4].fx, 'chance', lvs[4]) : 0;
  var stunSec = lvs[4] > 0 ? sgVal(t[4].fx, 'sec', lvs[4]) : 0;
  if (lvs[5] > 0) {
    for (var ps = 0; ps < slashes; ps++) {
      for (var pdi2 = 0; pdi2 < directions.length; pdi2++) {
        var projectileLen = (pdi2 === 0)
          ? bfMeterPx(sgVal(t[5].fx, 'm', lvs[5]))
          : ((typeof bfMeleeRange === 'function') ? bfMeleeRange() : bfMeterPx(5));
        sgQueueFlyingProjectile(pEnt, st, 'cleave', dmgVal,
          (typeof bfPlayerPos === 'function' && geomOk) ? bfPlayerPos() : null,
          geomOk ? baseAngle + directions[pdi2] : 0, projectileLen, floatSel,
          directionTargets[pdi2], { stunChance: stunChance, stunSec: stunSec }, out);
      }
    }
    return;
  }
  for (var s = 0; s < slashes; s++) {
    for (var di2 = 0; di2 < directionTargets.length; di2++) {
      for (var ti = 0; ti < directionTargets[di2].length; ti++) {
        var res = sgHitOne(pEnt, st, directionTargets[di2][ti], dmgVal, 'cleave', floatSel, out, sgStaggerMs(s));
      // 暈眩擊：每次命中獨立判定（BOSS 免疫與控場遞減由低階寫入器負責）
        if (res && !res.miss && stunChance > 0 && chance(stunChance)) {
          if (!(typeof isBossControlImmune === 'function' && isBossControlImmune(directionTargets[di2][ti])) &&
              !(typeof resistCtrl === 'function' && resistCtrl(monsterDefCfg(directionTargets[di2][ti])))) {
            applyStatus(directionTargets[di2][ti], 'stun', { dur: stunSec });
          }
        }
      }
    }
  }
}

/* ---- 飛刀 ---- */
function sgCastKnife(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[1] > 0) pct += sgVal(t[1].fx, 'pct', lvs[1]);
  var dmgVal = st.atk * pct / 100;
  var geomOk = (typeof bfPos === 'function') && !!bfPos(primary);
  var targets;
  var kCount;
  if (lvs[4] > 0) {
    // 迴旋飛刀：全圓形範圍，鎖定周圍最近的 N 個敵人
    kCount = Math.max(1, sgRollCount(sgVal(t[4].fx, 'count', lvs[4])));
    targets = bfSortedTargets(pool).slice(0, kCount);
  } else {
    kCount = Math.max(1, Math.floor(Number(t[0].fx.count) || 3));
    if (geomOk) {
      // 以主目標為中軸的扇形，隨機挑選其餘目標
      var cone = bfConeTargets(bfAngleTo(primary), Number(t[0].fx.deg) || 60,
        (typeof bfMeleeRange === 'function') ? bfMeleeRange() : 0, pool);
      var cands = [];
      for (var ci = 0; ci < cone.length; ci++) if (cone[ci] !== primary) cands.push(cone[ci]);
      // 洗牌取前 kCount-1 個
      for (var x = cands.length - 1; x > 0; x--) {
        var j = Math.floor(Math.random() * (x + 1));
        var tmp = cands[x]; cands[x] = cands[j]; cands[j] = tmp;
      }
      targets = [primary].concat(cands.slice(0, kCount - 1));
    } else {
      targets = [primary];
    }
  }
  if (!targets.length) return;
  // 每把飛刀的實際目標（目標不足時輪流分配，比照雙刀亂舞「都打同一敵人」語意）
  var knives = [];
  for (var k = 0; k < kCount; k++) knives.push(targets[k % targets.length]);
  var travelMs = (typeof bfTravelSeconds === 'function')
    ? knives.map(function (e) { return Math.round(bfTravelSeconds(e) * 1000); })
    : null;
  /* targets 一個代表一把刀；count 必須固定為 1，否則顯示層會把每把刀再複製 kCount 次。 */
  sgEmitVfx('knife', knives, floatSel, {
    fxKind: 'projectile', variant: 'knife', count: 1, travelMs: travelMs
  });

  var bouncePct = lvs[2] > 0 ? sgVal(t[2].fx, 'pct', lvs[2]) : 0;
  var cdrSec = lvs[6] > 0 ? sgVal(t[6].fx, 'sec', lvs[6]) : 0;
  var cdKey = SG_PREFIX + 'knife';
  function onCrit() {
    if (cdrSec > 0 && pEnt.skillCds && pEnt.skillCds[cdKey] > 0) {
      pEnt.skillCds[cdKey] = Math.max(0, pEnt.skillCds[cdKey] - cdrSec);
    }
  }
  for (var ki = 0; ki < knives.length; ki++) {
    var delay = (travelMs && travelMs[ki]) || 0;
    var res = sgHitOne(pEnt, st, knives[ki], dmgVal, 'knife', floatSel, out, delay);
    if (res && res.crit) onCrit();
    if (!res || res.miss || bouncePct <= 0) continue;
    // 彈射：基礎彈射數（第 3 階）＋強化彈射（第 4 階）；連鎖彈射（第 6 階）機率追加
    var bounces = Math.max(1, Math.floor(Number(t[2].fx.count) || 1)) +
      (lvs[3] > 0 ? sgRollCount(sgVal(t[3].fx, 'add', lvs[3])) : 0);
    var chainMax = lvs[5] > 0 ? Math.max(0, Math.floor(Number(t[5].fx.max) || 4)) : 0;
    var chainChance = lvs[5] > 0 ? sgVal(t[5].fx, 'chance', lvs[5]) : 0;
    var chained = 0;
    var cur = knives[ki];
    var visited = [cur];
    // 首發飛到第一個目標的時間也是彈射鏈的起點；後續每段再接續前一段飛行時間。
    var chainStartDelay = delay;
    var b = 0;
    while (b < bounces) {
      b++;
      // 優先跳向本輪還沒彈過的最近敵人；都彈過就允許回跳
      var next = null;
      var near = bfNearestOthers(cur, pool, pool.length);
      for (var ni = 0; ni < near.length; ni++) {
        if (visited.indexOf(near[ni]) < 0) { next = near[ni]; break; }
      }
      if (!next) next = (typeof bfNearestOther === 'function') ? bfNearestOther(cur, pool) : null;
      // 允許 A→B→A，但任何自我彈射 A→A 都必須停止。
      if (!next || next === cur || next.hp <= 0) break;
      visited.push(next);
      var bounceTravelMs = (typeof bfTravelSeconds === 'function')
        ? Math.round(bfTravelSeconds(next) * 1000) : 0;
      sgEmitVfx('knife', [cur, next], floatSel, {
        fxKind: 'chain', variant: 'knife-bounce', count: 1,
        delayMs: chainStartDelay, travelMs: [0, bounceTravelMs]
      });
      var bres = sgHitOne(pEnt, st, next, dmgVal * bouncePct / 100, 'knife', floatSel, out,
        chainStartDelay + bounceTravelMs);
      if (bres && bres.crit) onCrit();
      cur = next;
      chainStartDelay += bounceTravelMs;
      // 連鎖彈射：本次彈射後有機率再彈一次（最多連續 chainMax 次）
      if (bres && !bres.miss && chained < chainMax && chainChance > 0 && chance(chainChance)) {
        bounces++;
        chained++;
      }
    }
  }
}

/* ---- 疾風斬 ---- */
function sgCastGale(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[2] > 0) pct += sgVal(t[2].fx, 'pct', lvs[2]);
  var hits = Math.max(1, Math.floor(Number(t[0].fx.hits) || 2) +
    (lvs[1] > 0 ? sgRollCount(sgVal(t[1].fx, 'add', lvs[1])) : 0));
  var dmgVal = st.atk * pct / 100;
  var geomOk = (typeof bfPos === 'function') && !!bfPos(primary);
  var shareMode = lvs[6] > 0;
  var shareTargets = null;
  if (shareMode) {
    shareTargets = geomOk ? bfTargetsAround(primary, pool, bfMeterPx(sgVal(t[6].fx, 'm', lvs[6]))) : [primary];
    if (!shareTargets.length) shareTargets = [primary];
  }
  sgEmitVfx('gale', shareMode ? shareTargets : [primary], floatSel, {
    fxKind: 'slash', count: Math.min(5, hits), variant: 'gale-slashes'
  });
  for (var h = 0; h < hits; h++) {
    if (shareMode) {
      // 超神斬：本段傷害 ×(1+加成) 後由範圍內敵人均分
      var total = dmgVal * (1 + sgVal(t[6].fx, 'pct', lvs[6]) / 100);
      var alive = shareTargets.filter(function (e) { return e && e.hp > 0; });
      if (!alive.length) break;
      var share = total / alive.length;
      for (var si = 0; si < alive.length; si++) {
        sgHitOne(pEnt, st, alive[si], share, 'gale', floatSel, out, sgStaggerMs(h));
      }
    } else {
      sgHitOne(pEnt, st, primary, dmgVal, 'gale', floatSel, out, sgStaggerMs(h));
    }
    // 擴散：每次斬擊額外打 10 米內最近的敵人；附近沒有敵人時改對原目標
    if (lvs[3] > 0) {
      var extra = bfNearestOthers(primary, pool, 1, bfMeterPx(sgVal(t[3].fx, 'm', lvs[3])))[0] || primary;
      sgHitOne(pEnt, st, extra, dmgVal * sgVal(t[3].fx, 'pct', lvs[3]) / 100, 'gale', floatSel, out, sgStaggerMs(h + 1));
    }
  }
  // 狂風斬：攻速增益（突破上限、與自身攻速相乘——掛點在戰鬥迴圈的乘算區）
  if (lvs[4] > 0) {
    applyStatus(pEnt, 'sgGale', { val: sgVal(t[4].fx, 'pct', lvs[4]), dur: sgVal(t[4].fx, 'sec', lvs[4]) });
  }
}

/* ---- 血刃斬 ---- */
/* 流血／中毒的每跳傷害＝技能傷害基準 × dotPct%；作用間隔可被第 2 階縮短（跳更快＝總傷更高），
   因此以 ctx.dps 直接指定每秒傷害（每跳量 ÷ 間隔），繞過狀態表「狀態傷害＝每秒量」的預設換算。 */
function sgCastBloodblade(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var baseVal = st.atk * sgVal(t[0].fx, 'pct', lvs[0]) / 100;
  sgEmitVfx('bloodblade', [primary], floatSel, { fxKind: 'slash' });
  var res = sgHitOne(pEnt, st, primary, baseVal, 'bloodblade', floatSel, out, 0);
  if (!res || res.miss || primary.hp <= 0) return;

  // 流血：每 dotGap 秒造成技能傷害 dotPct% 的傷害
  sgApplyBloodbladeDot(primary, 'sgBleed', sgBloodbladeDotSpec(st, lvs, t, 'sgBleed'));
  sgEmitVfx('bloodblade', [primary], floatSel, { fxKind: 'curse', variant: 'bleed' });

  // 血毒刃：流血的同時中毒（毒屬性）
  if (lvs[3] > 0) {
    sgApplyBloodbladeDot(primary, 'sgPoison', sgBloodbladeDotSpec(st, lvs, t, 'sgPoison'));
    sgEmitVfx('bloodblade', [primary], floatSel, {
      fxKind: 'curse', variant: 'poison', elem: 'poison'
    });
  }
}

/* ---- 雙刀亂舞 ---- */
function sgCastDualdance(pEnt, st, g, lvs, pool, primary, floatSel, out, storm) {
  var t = g.tiers;
  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[2] > 0) pct += sgVal(t[2].fx, 'pct', lvs[2]);
  var dmgVal = st.atk * pct / 100;
  var strikes = Math.max(1, Math.floor(Number(t[0].fx.count) || 2) +
    (lvs[1] > 0 ? sgRollCount(sgVal(t[1].fx, 'add', lvs[1])) : 0));
  var targets = bfSortedTargets(pool).slice(0, strikes);
  if (!targets.length) targets = [primary];
  sgEmitVfx('dualdance', targets, floatSel, {
    fxKind: 'slash', count: Math.min(5, strikes), variant: storm ? 'dual-storm' : 'dual-slash'
  });
  for (var s = 0; s < strikes; s++) {
    var tgt = targets[s % targets.length];
    sgHitOne(pEnt, st, tgt, dmgVal, 'dualdance', floatSel, out, sgStaggerMs(s));
  }
  // 狂暴之舞／嗜血狂化：建立同一個 6 秒執行期狀態；技能傷害增幅依當下生命／護盾動態計算。
  if (lvs[3] > 0 || lvs[5] > 0) {
    var frenzyDur = lvs[3] > 0 ? (Number(t[3].fx.sec) || 6) : (Number(t[5].fx.sec) || 6);
    SKILL2_RT.frenzy = { until: GT + frenzyDur, pEnt: pEnt, levels: lvs.slice() };
    if (lvs[3] > 0) {
      applyStatus(pEnt, 'sgFrenzyCr', { val: sgVal(t[3].fx, 'cr', lvs[3]), dur: frenzyDur });
    }
  }
  // 鐵血之舞：自身與附近所有敵人流血（占最大生命比例；自身流血直接扣生命、不吃護盾）
  if (lvs[4] > 0) {
    var ironPct = sgVal(t[4].fx, 'pct', lvs[4]);
    var ironDur = Number(t[4].fx.sec) || 3;
    var ironGap = Math.max(0.1, Number(t[4].fx.gap) || 0.35);
    var ironR = bfMeterPx(Number(t[4].fx.m) || 5);
    applyDot(pEnt, st.hp * ironPct / 100 / ironGap, ironDur, '鐵血裂傷', 'sgIronBleed', ironGap);
    for (var ei = 0; ei < pool.length; ei++) {
      var e = pool[ei];
      if (!e || e.hp <= 0) continue;
      var p = (typeof bfPos === 'function') ? bfPos(e) : null;
      if (p && typeof bfEntityDistance === 'function' && bfEntityDistance(e) > ironR) continue;
      applyStatus(e, 'sgIronBleed', { dps: (e.maxHp || 0) * ironPct / 100 / ironGap, dur: ironDur, interval: ironGap });
    }
  }
  // 暴風之舞：化身狀態（自動施放由 tickSkill2 驅動；不可由化身內的自動施放再觸發）
  if (lvs[6] > 0 && !storm) {
    var stormDur = sgVal(t[6].fx, 'sec', lvs[6]);
    var stormGap = Math.max(0.1, Number(t[6].fx.gap) || 0.35);
    SKILL2_RT.storm = { until: GT + stormDur, nextAt: GT + stormGap, gap: stormGap, tgt: null };
    applyBuff(pEnt, 'sgStorm', 1, stormDur, 'sgStorm');
    sgEmitVfx('dualdance', targets, floatSel, {
      fxKind: 'aura', variant: 'cyclone', dur: Math.min(6, stormDur)
    });
  }
}

/* ---- 嗜血狂怒（純增益爆發；傷害為 0，訊息由 castSkill2 尾端統一處理） ---- */
function sgCastBloodrage(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var dur = Number(t[0].fx.sec) || 8;
  SKILL2_RT.rage = { until: GT + dur, pEnt: pEnt, killCombo: 0 };
  applyStatus(pEnt, 'sgBloodrage', { val: sgVal(t[0].fx, 'pct', lvs[0]), dur: dur });
  sgEmitVfx('bloodrage', pool, floatSel, { fxKind: 'aura', variant: 'bloodrage-aura', dur: Math.min(6, dur) });
}

/* ===========================================================================
   魔法系共用基建：燃燒（sgBurn）
   ---------------------------------------------------------------------------
   火球術第 2 階與火柱第 4 階塗的是**同一個**狀態，因此火球術第 5 階【爆燃】與
   第 6 階【火焰增幅】對兩者一視同仁——兩棵樹同時投資時的交互作用是刻意的，
   不是漏判：狀態表只有一種「燃燒」，引擎就不該憑來源分成兩種。
   每跳量＝技能傷害基準 × dotPct%，間隔可被【強化燃燒】縮短（跳更快＝總傷更高），
   因此以 dps（每跳量 ÷ 間隔）指定，繞過狀態表「狀態傷害＝每秒量」的預設換算
   ——與血刃斬的流血採同一套算法。
   =========================================================================== */

/* 火球術的燃燒規格（第 2 階未投資＝不燃燒）。傷害基準跟著本體傷害走：
   學了殞石術之後本體改由第 7 階定義，燃燒也跟著變強。 */
function sgFireballBurnSpec(st, g, lvs) {
  if (lvs[1] < 1) return null;
  var t = g.tiers;
  var baseFx = lvs[6] > 0 ? t[6].fx : t[0].fx;
  var baseLv = lvs[6] > 0 ? lvs[6] : lvs[0];
  var base = sgGroupBaseStat(g, st) * sgVal(baseFx, 'pct', baseLv) / 100;
  var gap = Math.max(0.1, lvs[3] > 0
    ? sgVal(t[3].fx, 'gap', lvs[3])
    : (Number(t[1].fx.dotGap) || 0.5));
  return {
    dps: base * sgVal(t[1].fx, 'dotPct', lvs[1]) / 100 / gap,
    dur: Number(t[1].fx.dotSec) || 5,
    interval: gap
  };
}

/* 火柱的燃燒規格（第 4 階未投資＝不燃燒）。每跳量占的是火柱「每段」的技能傷害。 */
function sgFirepillarBurnSpec(g, lvs, segmentDmg) {
  if (lvs[3] < 1) return null;
  var fx = g.tiers[3].fx;
  var gap = Math.max(0.1, Number(fx.dotGap) || 0.5);
  return {
    dps: segmentDmg * (Number(fx.dotPct) || 0) / 100 / gap,
    dur: Number(fx.dotSec) || 4,
    interval: gap
  };
}

/* 塗上燃燒，並留下【爆燃】要用的規格快照。
   快照是必要的：DoT 實例在燃燒結束的當下就被 tickStatuses 回收，
   之後再想回頭算「整段燃燒總共造成多少」已經沒有資料可讀。 */
function sgApplyBurn(ent, spec) {
  if (!ent || ent.hp <= 0 || !spec || !(spec.dps > 0)) return false;
  applyStatus(ent, 'sgBurn', { dps: spec.dps, dur: spec.dur, interval: spec.interval });
  var d = sgFindDot(ent, 'sgBurn');
  if (!d) return false;
  // 疊加規則為 strongest：實際生效的可能是原本更強的那一份，故一律以塗抹後的實例為準。
  ent._sgBurnWatch = { dps: d.dps, dur: Math.max(0, d.until - GT), until: d.until };
  return true;
}

/* 這段燃燒到目前為止累積造成的傷害（燃燒結束＝全額；中途死亡＝已經跳完的部分）。 */
function sgBurnDealtSoFar(ent) {
  var w = ent && ent._sgBurnWatch;
  if (!w || !(w.dps > 0)) return 0;
  var served = Math.max(0, w.dur - Math.max(0, w.until - GT));
  return w.dps * served;
}

/* 我方周圍 radiusPx 內的存活敵人（排除 exclude），最多 count 個、由近而遠。
   無座標的實體（高塔）視為在範圍內，與本系統其他範圍查詢一致。 */
function sgEnemiesNearPlayer(enemies, radiusPx, exclude, count) {
  var out = [];
  var live = (typeof bfLiveList === 'function') ? bfLiveList(enemies) : (enemies || []);
  var deco = [];
  for (var i = 0; i < live.length; i++) {
    var e = live[i];
    if (!e || e === exclude || e.hp <= 0) continue;
    var d = 0;
    if (typeof bfPos === 'function' && bfPos(e) && typeof bfEntityDistance === 'function') {
      d = bfEntityDistance(e);
      if (radiusPx > 0 && d > radiusPx) continue;
    }
    deco.push({ ent: e, d: d, r: Math.random() });
  }
  deco.sort(function (a, b) { return (a.d - b.d) || (a.r - b.r); });
  for (var j = 0; j < deco.length && (!(count > 0) || out.length < count); j++) out.push(deco[j].ent);
  return out;
}

/* 我方周圍 radiusPx 內隨機 1 個存活敵人（火柱【重生】的落點規則：任意敵人，不是最近的）。 */
function sgRandomEnemyNearPlayer(enemies, radiusPx, exclude) {
  var cands = sgEnemiesNearPlayer(enemies, radiusPx, exclude, 0);
  return cands.length ? cands[Math.floor(Math.random() * cands.length)] : null;
}

/* 【爆燃】（火球術第 5 階）：燃燒結束或敵人死亡時引爆，對我方範圍內數個敵人造成
   該敵人整段燃燒累積傷害的一定比例。衍生傷害不再過防禦與爆擊（比照擴散／零日感染）。
   ctx 可省略（敵人死亡的呼叫點沒有 tick ctx），此時由 FIELD 取得玩家實體。 */
function sgBurnBlast(ent, enemies, ctx) {
  if (!ent) return;
  var amount = sgBurnDealtSoFar(ent);
  ent._sgBurnWatch = null;
  var lvs = skills2Levels('fireball');
  if (!lvs || lvs[4] < 1 || !(amount > 0)) return;
  var fx = SKILLS2.fireball.tiers[4].fx;
  var count = Math.max(1, Math.floor(Number(fx.count) || 2));
  var victims = sgEnemiesNearPlayer(enemies, bfMeterPx(Number(fx.m) || 12), ent, count);
  if (!victims.length) return;
  var out = { killed: false, dmg: 0, crit: false };
  var per = amount * sgVal(fx, 'pct', lvs[4]) / 100;
  sgEmitVfx('fireball', victims, (ctx && ctx.floatSel) || 'mv-float', {
    fxKind: 'burst', variant: 'fire-blast', elem: 'fire'
  });
  for (var i = 0; i < victims.length; i++) {
    sgDerivedHit(victims[i], per, 'fireball', (ctx && ctx.floatSel) || 'mv-float', out, '💥', 0);
  }
  if (ctx && ctx.onDamage && out.dmg > 0) ctx.onDamage(out.dmg);
  if (out.killed && ctx && ctx.onDeaths) ctx.onDeaths();
}

/* 燃燒節拍器：以本引擎自己的計時對齊各燃燒實例的作用間隔（時戳記在敵人實體上、純 JSON、
   隨實體自然回收），不去改動 tickStatuses 的通用結算——與 sgTickBloodDots 同一套做法。
   負責兩件事：每次作用時疊【火焰增幅】、燃燒自然結束時觸發【爆燃】。 */
function sgTickBurn(dt, ctx) {
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  if (!enemies.length) return;
  var fbLvs = skills2Levels('fireball');
  var ampLv = fbLvs ? fbLvs[5] : 0;
  var ampFx = SKILLS2.fireball.tiers[5].fx;
  var ampRange = bfMeterPx(Number(ampFx.m) || 20);
  /* 燃燒可能同時掛在整群敵人身上（火球爆炸＋分裂＋火柱），逐一送特效事件會把
     同一個 tick 的事件量放大成敵人數；同一幀跳動的敵人合併成一則事件送出。 */
  var tickedNow = null;
  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i];
    if (!e) continue;
    var d = (e.hp > 0) ? sgFindDot(e, 'sgBurn') : null;
    if (!d) {
      // 燃燒自然結束（實例已被回收）：這是【爆燃】的其中一個觸發時機
      if (e._sgBurnWatch) sgBurnBlast(e, enemies, ctx);
      if (e._sgAcc) e._sgAcc.sgBurn = 0;
      continue;
    }
    if (typeof GT === 'number' && e._sgDotSkipAt === GT) continue;
    if (!e._sgAcc) e._sgAcc = {};
    var acc = (e._sgAcc.sgBurn || 0) + dt;
    var gap = Math.max(0.1, d.interval || 0.5);
    while (acc >= gap) {
      acc -= gap;
      if (!tickedNow) tickedNow = [];
      if (tickedNow.indexOf(e) < 0) tickedNow.push(e);
      /* 火焰增幅：範圍內每有 1 次燃燒作用就疊一層。層數無上限，因此不用狀態表的
         疊層規則（有 maxStacks），改由引擎自己把總量算好後以「後蓋前」寫入。 */
      if (ampLv > 0 && ctx.pEnt && ctx.pEnt.hp > 0) {
        var inRange = !(typeof bfPos === 'function' && bfPos(e) &&
          typeof bfEntityDistance === 'function' && bfEntityDistance(e) > ampRange);
        if (inRange) {
          applyStatus(ctx.pEnt, 'sgFireAmp', {
            val: skill2FireAmpPct(ctx.pEnt) + sgVal(ampFx, 'pct', ampLv),
            dur: Number(ampFx.sec) || 4
          });
        }
      }
    }
    e._sgAcc.sgBurn = acc;
  }
  if (tickedNow) {
    sgEmitVfx('fireball', tickedNow, ctx.floatSel, {
      fxKind: 'impact', variant: 'burn-tick', elem: 'fire'
    });
  }
}

/* 殞石落地時才結算命中，讓 Worker 的血量快照、血條與傷害飄字同時更新。
   施放時只鎖定落點目標；victims 不在此建立，等待 at 到期後才重新查詢範圍。 */
function sgQueueMeteor(pEnt, st, dmgVal, target, pool, radius, burnSpec, floatSel, out, at) {
  SKILL2_RT.meteors.push({
    at: at, target: target, pool: pool, radius: radius, pEnt: pEnt, st: st, dmgVal: dmgVal,
    burnSpec: burnSpec, floatSel: floatSel, out: out
  });
  out._pendingProjectiles = (out._pendingProjectiles || 0) + 1;
}

function sgTickMeteors(ctx) {
  var list = SKILL2_RT.meteors;
  if (!list || !list.length) return;
  var keep = [];
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    if (!m || m.at > GT) { if (m) keep.push(m); continue; }
    var before = m.out.dmg;
    var killed = false;
    /* 只有這裡才讀取殞石落點周圍的敵人；敵人若在落地前死亡或移出範圍，
       就不會被這顆殞石扣血。 */
    var victims = (typeof bfTargetsAround === 'function')
      ? bfTargetsAround(m.target, m.pool || [], m.radius) :
      (m.target && m.target.hp > 0 ? [m.target] : []);
    for (var vi = 0; vi < victims.length; vi++) {
      var target = victims[vi];
      if (!target || target.hp <= 0) continue;
      var res = sgHitOne(m.pEnt, m.st, target, m.dmgVal, 'fireball', m.floatSel, m.out, 0);
      if (res && !res.miss && m.burnSpec) sgApplyBurn(target, m.burnSpec);
      if (res && res.killed) killed = true;
    }
    if (victims.length) {
      sgEmitVfx('fireball', victims, m.floatSel, {
        fxKind: 'impact', variant: 'meteor-impact', elem: 'fire', area: sgAreaAround(m.target, m.radius)
      });
    }
    if (ctx.onDamage && m.out.dmg > before) ctx.onDamage(m.out.dmg - before);
    if (killed && ctx.onDeaths) ctx.onDeaths();
    sgFinishSkillCastFloat(m.out);
  }
  SKILL2_RT.meteors = keep;
}

/* 隨機袋抽樣：同一輪先不重複抽，附近有多名敵人時不會三顆全砸同一人；
   候選不足時才重建袋子，讓敵人數少於殞石數時自然重複。 */
function sgMeteorTargetBag(primary, pool, radius) {
  var candidates = (typeof bfTargetsAround === 'function')
    ? bfTargetsAround(primary, pool, radius) : [primary];
  if (!candidates.length) candidates = [primary];
  var bag = [];
  function refill() {
    bag = candidates.slice();
    for (var i = bag.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var swap = bag[i]; bag[i] = bag[j]; bag[j] = swap;
    }
  }
  refill();
  return function () {
    if (!bag.length) refill();
    return bag.pop();
  };
}

/* ===========================================================================
   火球術（fireball）
   ---------------------------------------------------------------------------
   一般火球仍在施放當下結算，只有第 7 階殞石術使用逐顆落地排程。
   第 7 階殞石術依設計文檔「改為」召喚三顆殞石：本體傷害%與範圍改讀第 7 階，
   第 2~6 階的進化效果照舊生效。
   =========================================================================== */
function sgFireballProjectilePlan(target) {
  var geomOk = (typeof bfPos === 'function') && !!bfPos(target) &&
    (typeof bfPlayerPos === 'function') && (typeof bfTravelDistance === 'function');
  var origin = geomOk ? bfPlayerPos() : null;
  var length = geomOk ? Math.max(1, bfTravelDistance(target)) : 1;
  var angle = geomOk && typeof bfAngleTo === 'function' ? bfAngleTo(target) : 0;
  /* 一般火球直接沿用普攻遠程投射物的距離／速度計算；不使用殞石的 0.70 慢速倍率。 */
  var travelMs = geomOk && typeof bfTravelSeconds === 'function'
    ? Math.round(bfTravelSeconds(target) * 1000)
    : (geomOk ? Math.max(100, Math.round(length / SG_FLYING_PROJECTILE_SPEED * 1000)) : 260);
  var speed = geomOk && travelMs > 0 ? length / (travelMs / 1000) : SG_FLYING_PROJECTILE_SPEED;
  return { origin: origin, length: length, angle: angle, travelMs: travelMs,
    speed: speed, waitForEnd: !geomOk };
}

function sgFireballSplitProjectileHit(projectile, target, ctx) {
  var before = projectile.out.dmg;
  var res = sgHitOne(projectile.pEnt, projectile.st, target, projectile.dmgVal,
    'fireball', projectile.floatSel, projectile.out, 0);
  if (res && !res.miss && projectile.burnSpec) sgApplyBurn(target, projectile.burnSpec);
  if (ctx.onDamage && projectile.out.dmg > before) ctx.onDamage(projectile.out.dmg - before);
}

function sgFireballProjectileHit(projectile, target, ctx) {
  var before = projectile.out.dmg;
  var victims = projectile.victims && projectile.victims.length ? projectile.victims : [target];
  for (var i = 0; i < victims.length; i++) {
    var victim = victims[i];
    if (!victim || victim.hp <= 0) continue;
    var res = sgHitOne(projectile.pEnt, projectile.st, victim, projectile.dmgVal,
      'fireball', projectile.floatSel, projectile.out, 0);
    if (res && !res.miss && projectile.burnSpec) sgApplyBurn(victim, projectile.burnSpec);
  }
  if (ctx.onDamage && projectile.out.dmg > before) ctx.onDamage(projectile.out.dmg - before);

  /* 火球爆裂必須在本體飛到並爆炸後才生成下一批一般小火球。 */
  var splits = projectile.splitTargets || [];
  for (var si = 0; si < splits.length; si++) {
    var plan = sgFireballProjectilePlan(splits[si]);
    sgEmitVfx('fireball', [splits[si]], projectile.floatSel, {
      fxKind: 'projectile', variant: 'fireball-small', elem: 'fire', count: 1,
      travelMs: [plan.travelMs], projectile: true
    });
    sgEmitVfx('fireball', [splits[si]], projectile.floatSel, {
      fxKind: 'burst', variant: 'fire-explosion', elem: 'fire', delayMs: plan.travelMs
    });
    sgQueueFlyingProjectile(projectile.pEnt, projectile.st, 'fireball', projectile.splitDmgVal,
      plan.origin, plan.angle, plan.length, projectile.floatSel, [splits[si]], {
        singleHit: true, targetOnly: true, waitForEnd: plan.waitForEnd,
        travelMs: plan.travelMs, speed: plan.speed, hitFn: sgFireballSplitProjectileHit,
        burnSpec: projectile.burnSpec
      }, projectile.out);
  }
}

function sgCastFireball(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var meteor = lvs[6] > 0;
  var srcFx = meteor ? t[6].fx : t[0].fx;
  var srcLv = meteor ? lvs[6] : lvs[0];
  var dmgVal = sgGroupBaseStat(g, st) * sgVal(srcFx, 'pct', srcLv) / 100;
  var radius = bfMeterPx(sgVal(srcFx, 'm', srcLv));
  var volleys = meteor ? Math.max(1, Math.floor(Number(t[6].fx.count) || 3)) : 1;
  /* 一般火球只建立標準平射飛行物計畫；殞石的落地計時完全走另一個分支。 */
  var fireballPlan = meteor ? null : sgFireballProjectilePlan(primary);
  var travelMs = 0;
  var meteorFallMs = 0;
  if (meteor) {
    var meteorTiming = sgMeteorFallTiming();
    travelMs = meteorTiming.travelMs;
    /* 每顆只錯開 350ms；不再使用玩家到目標的普通投射物距離。 */
    meteorFallMs = meteorTiming.fallMs;
  }
  var burnSpec = sgFireballBurnSpec(st, g, lvs);
  var nextMeteorTarget = meteor ? sgMeteorTargetBag(primary, pool, radius) : null;

  for (var v = 0; v < volleys; v++) {
    var meteorTarget = meteor ? nextMeteorTarget() : primary;
    var targetGeomOk = (typeof bfPos === 'function') && !!bfPos(meteorTarget);
    var castDelay = meteor ? v * SG_METEOR_INTERVAL_MS : 0;
    var hitDelay = castDelay + meteorFallMs;
    var victims = meteor ? null
      : ((targetGeomOk && radius > 0) ? bfTargetsAround(meteorTarget, pool, radius) : [meteorTarget]);
    if (!meteor && !victims.length) victims = [meteorTarget];
    var area = targetGeomOk ? sgAreaAround(meteorTarget, radius) : null;

    if (meteor) {
      sgEmitVfx('fireball', [meteorTarget], floatSel, {
        fxKind: 'rain', variant: 'meteor', elem: 'fire', count: 1,
        area: area, delayMs: castDelay, travelMs: [travelMs]
      });
    } else {
      sgEmitVfx('fireball', [primary], floatSel, {
        fxKind: 'projectile', variant: 'fireball-small', elem: 'fire', count: 1,
        travelMs: [fireballPlan.travelMs], projectile: true
      });
      sgEmitVfx('fireball', victims, floatSel, {
        fxKind: 'burst', variant: 'fire-explosion', elem: 'fire',
        area: area, delayMs: hitDelay
      });
    }

    if (meteor) {
      sgQueueMeteor(pEnt, st, dmgVal, meteorTarget, pool, radius, burnSpec, floatSel, out,
        GT + hitDelay / 1000);
    } else {
      var splitTargets = [];
      var splitDmgVal = 0;
      if (lvs[2] > 0) {
        var splitFxPlan = t[2].fx;
        splitTargets = bfNearestOthers(primary, pool,
          Math.max(1, Math.floor(Number(splitFxPlan.count) || 3)),
          bfMeterPx(Number(splitFxPlan.m) || 20));
        splitDmgVal = dmgVal * sgVal(splitFxPlan, 'pct', lvs[2]) / 100;
      }
      sgQueueFlyingProjectile(pEnt, st, 'fireball', dmgVal,
        fireballPlan.origin, fireballPlan.angle, fireballPlan.length, floatSel, [primary], {
          singleHit: true, targetOnly: true, waitForEnd: fireballPlan.waitForEnd,
          travelMs: fireballPlan.travelMs, speed: fireballPlan.speed, hitFn: sgFireballProjectileHit,
          victims: victims, splitTargets: splitTargets, splitDmgVal: splitDmgVal, burnSpec: burnSpec
        }, out);
    }
  }
}

/* 以某實體為圓心的區域描述（顯示層的地面範圍標記；無座標時回傳 null）。 */
function sgAreaAround(ent, rPx) {
  var p = (typeof bfPos === 'function') ? bfPos(ent) : null;
  if (!p || !(rPx > 0)) return null;
  return { x: p.x, y: p.y, r: rPx };
}

/* ===========================================================================
   火柱（firepillar）：地板場域
   ---------------------------------------------------------------------------
   火柱不是「一次結算完」的技能：它釘在地板上、按節拍反覆作用，還可能移動（追擊）
   與重生。因此建立執行期場域實例（SKILL2_RT.grounds，不入存檔），由 tickSkill2 推進。
   無座標時（高塔 BOSS）退化為「固定打主目標」——與本系統其他幾何查詢的退化規則一致。
   第 7 階【無限火牆】依設計文檔「改為」火牆：形狀改為橫向矩形、段數與傷害%改讀第 7 階，
   第 2~6 階的進化效果照舊生效。
   =========================================================================== */
function sgCastFirepillar(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var wall = lvs[6] > 0;
  var srcFx = wall ? t[6].fx : t[0].fx;
  var srcLv = wall ? lvs[6] : lvs[0];
  var pct = sgVal(srcFx, 'pct', srcLv);
  if (lvs[2] > 0) pct += sgVal(t[2].fx, 'pct', lvs[2]); // 雙重火柱：火屬性傷害額外加成
  var dmgVal = sgGroupBaseStat(g, st) * pct / 100;
  var hits = Math.max(1, Math.floor(Number(srcFx.hits) || 5));
  var lifeSec = Math.max(0.2, Number(t[0].fx.sec) || 2.5);
  var gap = lifeSec / hits;
  // 強化火柱：範圍擴大（火柱＝半徑、火牆＝長寬同步放大）
  var scale = lvs[1] > 0 ? 1 + sgVal(t[1].fx, 'pct', lvs[1]) / 100 : 1;
  var burnSpec = sgFirepillarBurnSpec(g, lvs, dmgVal);
  var speed = lvs[4] > 0 ? bfMeterPx(sgVal(t[4].fx, 'm', lvs[4])) : 0;

  var count = wall
    ? Math.max(1, Math.floor(Number(t[6].fx.count) || 3))
    : (lvs[2] > 0 ? Math.max(1, Math.floor(Number(t[2].fx.count) || 2)) : 1);
  var spreadPx = lvs[2] > 0 ? bfMeterPx(Number(t[2].fx.m) || 20) : skills2CastRangePx('firepillar', lvs);
  var spots = [primary];
  if (count > 1) spots = spots.concat(bfNearestOthers(primary, pool, count - 1, spreadPx));

  for (var i = 0; i < count; i++) {
    // 目標不足時多出來的火柱疊在主目標身上（比照雙刀亂舞「只有 1 個敵人就都打同一個」）
    var spot = spots[i % spots.length];
    sgSpawnGround(pEnt, st, 'firepillar', {
      kind: wall ? 'wall' : 'pillar', tgt: spot, floatSel: floatSel,
      radius: bfMeterPx(sgVal(t[0].fx, 'm', lvs[0])) * scale,
      length: bfMeterPx(Number(t[6].fx.len) || 18) * scale,
      width: bfMeterPx(Number(t[6].fx.wid) || 6) * scale,
      dmgVal: dmgVal, hits: hits, gap: gap, speed: speed,
      burnSpec: burnSpec, burnChance: lvs[3] > 0 ? sgVal(t[3].fx, 'chance', lvs[3]) : 0,
      respawnLeft: wall ? Math.max(0, Math.floor(Number(t[6].fx.respawn) || 0)) : 0,
      delaySec: i * gap * 0.2
    });
  }
}

/* 建立一個地板場域實例。pos 於此時定位（釘在地板上，之後與目標實體脫鉤——
   目標死了火柱也還在燒），tgt 只用於追擊時的移動方向。 */
function sgSpawnGround(pEnt, st, gid, cfg) {
  var p = (typeof bfPos === 'function' && cfg.tgt) ? bfPos(cfg.tgt) : null;
  var angle = (typeof bfAngleTo === 'function' && cfg.tgt) ? bfAngleTo(cfg.tgt) : null;
  SKILL2_RT.grounds.push({
    gid: gid, pEnt: pEnt, st: st, floatSel: cfg.floatSel, kind: cfg.kind,
    pos: p ? { x: p.x, y: p.y } : null,
    angle: (angle === null || angle === undefined) ? 0 : angle,
    radius: Math.max(0, Number(cfg.radius) || 0),
    length: Math.max(0, Number(cfg.length) || 0),
    width: Math.max(0, Number(cfg.width) || 0),
    dmgVal: Number(cfg.dmgVal) || 0,
    hits: Math.max(1, Math.floor(Number(cfg.hits) || 1)),
    hitsLeft: Math.max(1, Math.floor(Number(cfg.hits) || 1)),
    gap: Math.max(0.05, Number(cfg.gap) || 0.5),
    nextAt: GT + Math.max(0.05, Number(cfg.gap) || 0.5) + Math.max(0, Number(cfg.delaySec) || 0),
    speed: Math.max(0, Number(cfg.speed) || 0),
    tgt: cfg.tgt || null,
    burnSpec: cfg.burnSpec || null,
    burnChance: Math.max(0, Number(cfg.burnChance) || 0),
    respawnLeft: Math.max(0, Math.floor(Number(cfg.respawnLeft) || 0))
  });
}

/* 場域這一跳打到誰：火柱＝圓、火牆＝以我方視線為法線的橫向矩形（以線段＋半寬表示）。
   無座標＝退化為固定打當初的目標。 */
function sgGroundVictims(f, enemies) {
  if (!f.pos) return (f.tgt && f.tgt.hp > 0) ? [f.tgt] : [];
  if (f.kind === 'wall' && typeof bfSegmentTargets === 'function' && f.length > 0) {
    var axis = f.angle + Math.PI / 2;                 // 橫向＝與我方視線垂直
    var half = f.length / 2;
    var origin = { x: f.pos.x - Math.cos(axis) * half, y: f.pos.y - Math.sin(axis) * half };
    return bfSegmentTargets(origin, axis, 0, f.length, enemies, f.width / 2);
  }
  if (typeof bfEnemiesInArea !== 'function' || typeof bfLiveList !== 'function') return [];
  return bfEnemiesInArea({ x: f.pos.x, y: f.pos.y, r: f.radius }, bfLiveList(enemies));
}

/* 追擊：朝目標移動；目標死亡就改追離我方最近的敵人。 */
function sgGroundChase(f, enemies, dt) {
  if (!f.pos || !(f.speed > 0)) return;
  if (!f.tgt || f.tgt.hp <= 0 || !(typeof bfPos === 'function' && bfPos(f.tgt))) {
    f.tgt = (typeof bfNearestOther === 'function') ? bfNearestOther(null, enemies) : null;
  }
  var p = (typeof bfPos === 'function' && f.tgt) ? bfPos(f.tgt) : null;
  if (!p) return;
  var dx = p.x - f.pos.x, dy = p.y - f.pos.y;
  var d = Math.sqrt(dx * dx + dy * dy);
  if (d <= 0.0001) return;
  var step = Math.min(d, f.speed * dt);
  f.pos.x += (dx / d) * step;
  f.pos.y += (dy / d) * step;
  if (typeof bfAngleTo === 'function' && f.tgt) {
    var a = bfAngleTo(f.tgt);
    if (a !== null && a !== undefined) f.angle = a;
  }
}

/* 場域的一次作用：範圍內每個敵人各吃一段傷害，並依機率附加燃燒。 */
function sgGroundTick(f, enemies, ctx) {
  var victims = sgGroundVictims(f, enemies);
  sgEmitVfx(f.gid, victims, f.floatSel, f.kind === 'wall'
    ? { fxKind: 'aura', variant: 'firewall', elem: 'fire', dur: f.gap, area: sgGroundArea(f) }
    : { fxKind: 'impact', variant: 'pillar', elem: 'fire', dur: f.gap, area: sgGroundArea(f) });
  if (!victims.length) return;
  var out = { killed: false, dmg: 0, crit: false };
  for (var i = 0; i < victims.length; i++) {
    var res = sgHitOne(f.pEnt, f.st, victims[i], f.dmgVal, f.gid, f.floatSel, out, sgStaggerMs(i));
    if (res && !res.miss && f.burnSpec && f.burnChance > 0 && chance(f.burnChance)) {
      sgApplyBurn(victims[i], f.burnSpec);
    }
  }
  if (ctx && ctx.onDamage && out.dmg > 0) ctx.onDamage(out.dmg);
  if (out.killed && ctx && ctx.onDeaths) ctx.onDeaths();
}

/* 場域的地面範圍描述（顯示層用）。火牆帶 w/h/a 讓顯示層畫出方向正確的矩形；
   同時附上 r（外接圓半徑）讓不認得矩形的舊畫法仍有合理的退化尺寸。 */
function sgGroundArea(f) {
  if (!f.pos) return null;
  if (f.kind === 'wall') {
    return { x: f.pos.x, y: f.pos.y, w: f.length, h: f.width,
      a: f.angle + Math.PI / 2, r: Math.max(f.length, f.width) / 2 };
  }
  return { x: f.pos.x, y: f.pos.y, r: f.radius };
}

/* 場域消失：火牆的再召喚（第 7 階，每道只能再觸發一次）與火柱的重生（第 6 階，
   機率成立就在我方範圍內的隨機敵人身上重來一次）。 */
function sgGroundExpire(f, enemies, ctx) {
  var lvs = skills2Levels(f.gid);
  var t = SKILLS2[f.gid].tiers;
  var respawn = f.respawnLeft > 0;
  var rebirth = lvs[5] > 0 && chance(sgVal(t[5].fx, 'chance', lvs[5]));
  if (!respawn && !rebirth) return;
  // 重生有表定的落點範圍；火牆的再召喚沒有，改用技能自身的射程當落點上限。
  var radius = rebirth ? bfMeterPx(Number(t[5].fx.m) || 20) : skills2CastRangePx(f.gid, lvs);
  var spot = sgRandomEnemyNearPlayer(enemies, radius, null) ||
    ((f.tgt && f.tgt.hp > 0) ? f.tgt : null);
  if (!spot) return;
  sgSpawnGround(f.pEnt, f.st, f.gid, {
    kind: f.kind, tgt: spot, floatSel: f.floatSel,
    radius: f.radius, length: f.length, width: f.width,
    dmgVal: f.dmgVal, hits: f.hits, gap: f.gap, speed: f.speed,
    burnSpec: f.burnSpec, burnChance: f.burnChance,
    respawnLeft: respawn ? f.respawnLeft - 1 : 0
  });
}

/* 每個 tick 推進所有場域：先移動、再依節拍作用、打完就消失（並處理再召喚／重生）。 */
function sgTickGrounds(dt, ctx) {
  var list = SKILL2_RT.grounds;
  if (!list || !list.length) return;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  for (var i = list.length - 1; i >= 0; i--) {
    var f = list[i];
    sgGroundChase(f, enemies, dt);
    var guard = 0;
    while (f.hitsLeft > 0 && f.nextAt <= GT && guard < 20) {
      guard++;
      f.nextAt += f.gap;
      f.hitsLeft--;
      sgGroundTick(f, enemies, ctx);
      enemies = ctx.getEnemies ? ctx.getEnemies() : enemies;
    }
    if (f.hitsLeft > 0) continue;
    list.splice(i, 1);
    sgGroundExpire(f, enemies, ctx);
  }
}

/* ===========================================================================
   火狩（firehunt）：環繞場域
   ---------------------------------------------------------------------------
   火狩與火柱同為「持續存在的場域」，差別只在錨點：火柱釘在地板座標上，
   火狩釘在玩家身上——圓心永遠取當下的玩家座標，所以天生跟著玩家移動。
   命中採**接觸判定**（進入才算一次）：一團火狩掃過同一個敵人只結算一次，
   離開後再碰到才會再命中，正好等於設計文檔的「環繞過程中碰到敵人即命中一次」；
   由此得出的命中頻率就是旋轉速度本身，不需要另外設一個再命中間隔。
   無座標時（高塔 BOSS）退化為「每轉一圈打一次主目標」——與本系統其他幾何查詢
   的退化規則一致（沒有座標就沒有幾何，只剩單體語意）。
   第 4 階【三重火狩】與第 7 階【狩神之舞】依設計文檔「改為」：團數、傷害%與
   持續時間改讀該階，其餘階的進化效果照舊生效。
   =========================================================================== */
function sgCastFirehunt(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var dance = lvs[6] > 0;
  var triple = lvs[3] > 0;
  // 傷害%與持續時間取「最高的改寫階」，團數則由三重火狩決定（狩神之舞只加道數）
  var srcFx = dance ? t[6].fx : (triple ? t[3].fx : t[0].fx);
  var srcLv = dance ? lvs[6] : (triple ? lvs[3] : lvs[0]);
  var dmgVal = sgGroupBaseStat(g, st) * sgVal(srcFx, 'pct', srcLv) / 100;
  var lifeSec = Math.max(0.5, Number(srcFx.sec) || Number(t[0].fx.sec) || 4);
  var count = Math.max(1, Math.floor(Number((triple ? t[3].fx : t[0].fx).count) || 2));
  // 強化火狩：體積與環繞範圍同步擴大
  var scale = lvs[1] > 0 ? 1 + sgVal(t[1].fx, 'pct', lvs[1]) / 100 : 1;
  var radius = bfMeterPx(Number(t[0].fx.m) || 8) * scale;
  var body = sgRange(g.range); // 群組 range＝火狩體積（長*寬，米）
  var bodyR = bfMeterPx(Math.max(body.length, body.width) / 2) * scale;
  // 極速火狩：旋轉速度（圈/秒 → 弧度/秒），正值＝順時針
  var spin = Math.PI * 2 * (Number(t[0].fx.rps) || 1) *
    (lvs[4] > 0 ? 1 + sgVal(t[4].fx, 'pct', lvs[4]) / 100 : 1);

  /* 狩神之舞：兩道火狩，外圈距內圈 m 米、旋轉方向相反；
     且每團出現時自帶伴生（不必等命中判定；伴生體本身仍不可再伴生）。 */
  var rings = [{ r: radius, spin: spin }];
  if (dance) {
    var ringCount = Math.max(1, Math.floor(Number(t[6].fx.rings) || 2));
    for (var ri = 1; ri < ringCount; ri++) {
      rings.push({ r: radius + bfMeterPx(Number(t[6].fx.m) || 6) * ri, spin: (ri % 2) ? -spin : spin });
    }
  }

  sgSpawnOrbitField(pEnt, st, 'firehunt', {
    tgt: primary, floatSel: floatSel, rings: rings, count: count,
    dmgVal: dmgVal, lifeSec: lifeSec, bodyR: bodyR,
    companionChance: lvs[2] > 0 ? sgVal(t[2].fx, 'chance', lvs[2]) : 0,
    companionPx: bfMeterPx(Number(t[2].fx.m) || 1),
    bornWithCompanion: dance,
    extendSec: lvs[5] > 0 ? sgVal(t[5].fx, 'sec', lvs[5]) : 0
  });
}

/* 建立一次施放的環繞場域：每一道（ring）平均散開 count 團火狩。
   持續時間由整組共用（設計文檔：時間結束時所有火狩一起消失，含伴生出來的）。 */
function sgSpawnOrbitField(pEnt, st, gid, cfg) {
  var f = {
    gid: gid, pEnt: pEnt, st: st, floatSel: cfg.floatSel, tgt: cfg.tgt || null,
    until: GT + Math.max(0.5, Number(cfg.lifeSec) || 0),
    dmgVal: Number(cfg.dmgVal) || 0,
    bodyR: Math.max(1, Number(cfg.bodyR) || 0),
    companionChance: Math.max(0, Number(cfg.companionChance) || 0),
    companionPx: Math.max(0, Number(cfg.companionPx) || 0),
    extendSec: Math.max(0, Number(cfg.extendSec) || 0),
    rings: [], orbs: [], vfxUntil: 0
  };
  var count = Math.max(1, Math.floor(Number(cfg.count) || 1));
  for (var i = 0; i < cfg.rings.length; i++) {
    var ring = { r: Math.max(1, Number(cfg.rings[i].r) || 0), spin: Number(cfg.rings[i].spin) || 0 };
    f.rings.push(ring);
    for (var k = 0; k < count; k++) {
      var orb = sgOrbitOrb(Math.PI * 2 * k / count, ring);
      f.orbs.push(orb);
      // 狩神之舞：出現時自帶伴生（母體與伴生體依規則都不可再伴生）
      if (cfg.bornWithCompanion) { orb.canSpawn = false; f.orbs.push(sgOrbitCompanion(f, orb)); }
    }
  }
  f.vfxUntil = f.until;
  SKILL2_RT.orbits.push(f);
  sgOrbitSyncStatus(pEnt);
  sgOrbitEmitVfx(f);
}

/* 環繞場域的剩餘時間掛成狀態（狀態表 sgFirehunt），玩家才看得到還剩幾秒——
   【再生】每擊殺一個敵人就把 until 往後推，累積後的總剩餘時間只有這裡看得出來。
   取這名玩家身上所有環繞場域中**最晚結束**的那一個：狀態列一個技能只呈現一格，
   多重施放時該顯示的當然是「火狩還會在場多久」，不是其中某一組的殘餘。
   狀態與場域共用同一個時鐘 GT，因此必定同時到期，不需要另外清除。 */
function sgOrbitSyncStatus(pEnt) {
  if (!pEnt) return;
  var list = SKILL2_RT.orbits, until = 0;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].pEnt === pEnt && list[i].until > until) until = list[i].until;
  }
  if (until > GT) applyStatus(pEnt, 'sgFirehunt', { dur: until - GT });
}

function sgOrbitOrb(ang, ring) {
  return { ang: ang, spin: ring.spin, radius: ring.r, lap: 0, canSpawn: true, contacts: [] };
}

/* 伴生火狩：生在母體的正後方（沿環繞路徑往回 companionPx，弧長換算成弧度）。
   母體與伴生體都不可再伴生（設計文檔：每一個火狩只能伴生一個，伴生出的不可再伴生）。 */
function sgOrbitCompanion(f, orb) {
  var back = orb.radius > 0 ? f.companionPx / orb.radius : 0;
  return {
    ang: orb.ang - (orb.spin >= 0 ? back : -back), spin: orb.spin,
    radius: orb.radius, lap: 0, canSpawn: false, contacts: []
  };
}

/* 這一團火狩現在碰到誰：火狩的體積圓對敵人的身體圓做接觸判定。
   無座標的敵人不參與幾何（改由 sgOrbitLapTarget 以每圈一次的節拍退化處理）。 */
function sgOrbitVictims(f, orb, center, live) {
  var hit = [];
  if (!center) return hit;
  var ox = center.x + Math.cos(orb.ang) * orb.radius;
  var oy = center.y + Math.sin(orb.ang) * orb.radius;
  for (var i = 0; i < live.length; i++) {
    var p = (typeof bfPos === 'function') ? bfPos(live[i]) : null;
    if (!p) continue;
    var r = f.bodyR + ((typeof bfEntityRadius === 'function') ? bfEntityRadius(live[i]) : 0);
    var dx = p.x - ox, dy = p.y - oy;
    if (dx * dx + dy * dy <= r * r) hit.push(live[i]);
  }
  return hit;
}

/* 無座標（高塔）退化目標：轉滿一圈打一次當初的主目標，主目標不在了就換下一個。 */
function sgOrbitLapTarget(f, live) {
  var noPos = function (e) { return !(typeof bfPos === 'function' && bfPos(e)); };
  if (f.tgt && f.tgt.hp > 0 && noPos(f.tgt)) return f.tgt;
  for (var i = 0; i < live.length; i++) {
    if (live[i] && live[i].hp > 0 && noPos(live[i])) return live[i];
  }
  return null;
}

/* 一個 tick 的推進：每團火狩先轉再判接觸，只有「這一刻剛碰上」的敵人才結算。 */
function sgOrbitStep(f, enemies, dt, ctx) {
  var live = (typeof bfLiveList === 'function') ? bfLiveList(enemies) : [];
  var center = (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null;
  var out = { killed: false, dmg: 0, crit: false };
  var born = [];
  var struck = [];
  var extended = false;
  for (var i = 0; i < f.orbs.length; i++) {
    var orb = f.orbs[i];
    orb.ang += orb.spin * dt;
    orb.lap += Math.abs(orb.spin) * dt;
    var lapDone = false;
    if (orb.lap >= Math.PI * 2) { orb.lap -= Math.PI * 2; lapDone = true; }
    var touching = sgOrbitVictims(f, orb, center, live);
    var fresh = [];
    for (var v = 0; v < touching.length; v++) {
      if (orb.contacts.indexOf(touching[v]) < 0) fresh.push(touching[v]);
    }
    orb.contacts = touching;
    if (lapDone) {
      var solo = sgOrbitLapTarget(f, live);
      if (solo && fresh.indexOf(solo) < 0) fresh.push(solo);
    }
    for (var h = 0; h < fresh.length; h++) {
      var res = sgHitOne(f.pEnt, f.st, fresh[h], f.dmgVal, f.gid, f.floatSel, out, sgStaggerMs(struck.length));
      if (!res || res.miss) continue;
      struck.push(fresh[h]);
      // 再生：擊殺延長整組火狩的持續時間（狀態列的剩餘時間同步往後推）
      if (res.killed && f.extendSec > 0) { f.until += f.extendSec; extended = true; }
      // 伴生火狩：命中才判定，且母體從此不再伴生
      if (orb.canSpawn && f.companionChance > 0 && chance(f.companionChance) &&
          f.orbs.length + born.length < SG_ORBIT_MAX_ORBS) {
        orb.canSpawn = false;
        born.push(sgOrbitCompanion(f, orb));
      }
    }
  }
  if (born.length) f.orbs = f.orbs.concat(born);
  if (extended) sgOrbitSyncStatus(f.pEnt);
  if (struck.length) {
    sgEmitVfx(f.gid, struck, f.floatSel, { fxKind: 'impact', variant: 'fire-explosion', elem: 'fire', dur: 0.35 });
  }
  if (ctx && ctx.onDamage && out.dmg > 0) ctx.onDamage(out.dmg);
  if (out.killed && ctx && ctx.onDeaths) ctx.onDeaths();
}

/* 環繞特效：一道一則事件，帶上模擬層實際判定的環半徑、火狩體積與旋轉方向；
   圓心送出施放當下的玩家座標，顯示層以自己的玩家錨點逐幀跟隨（火狩跟著玩家跑）。 */
function sgOrbitEmitVfx(f) {
  var center = (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null;
  var dur = Math.max(0.5, f.until - GT);
  var perRing = Math.max(1, Math.round(f.orbs.length / Math.max(1, f.rings.length)));
  for (var i = 0; i < f.rings.length; i++) {
    sgEmitVfx(f.gid, f.tgt ? [f.tgt] : [], f.floatSel, {
      fxKind: 'aura', variant: 'firehunt', elem: 'fire', dur: dur, count: perRing,
      area: {
        x: center ? center.x : 0, y: center ? center.y : 0, r: f.rings[i].r,
        orbR: f.bodyR, orbs: perRing, spin: f.rings[i].spin >= 0 ? 1 : -1
      }
    });
  }
}

/* 再生延長的是實際持續時間，但特效是施放當下一次廣播完的：延長累積到超過
   已廣播的長度時補送一次，畫面才不會在火狩還在打的時候就先消失。 */
function sgOrbitRefreshVfx(f) {
  if (f.until <= f.vfxUntil + SG_ORBIT_VFX_REFRESH_SEC) return;
  f.vfxUntil = f.until;
  sgOrbitEmitVfx(f);
}

/* 每個 tick 推進所有環繞場域；到期就整組消失（含伴生出來的）。 */
function sgTickOrbits(dt, ctx) {
  var list = SKILL2_RT.orbits;
  if (!list || !list.length) return;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  for (var i = list.length - 1; i >= 0; i--) {
    var f = list[i];
    if (f.until <= GT) { list.splice(i, 1); continue; }
    sgOrbitStep(f, enemies, dt, ctx);
    sgOrbitRefreshVfx(f);
    enemies = ctx.getEnemies ? ctx.getEnemies() : enemies;
  }
}

/* ===========================================================================
   反擊（counter）：主動型被動——受擊時觸發，需裝配技能列才生效、永不主動施放。
   掛點：combat.js doMonsterAttack（野外與高塔敵攻玩家的唯一收斂點）於
   legendaryOnPlayerDamaged 旁鏈結呼叫，簽名與其一致。
   規則：T1 受傷機率反擊、T2 格擋必反（同一擊可同時成立、各自結算）；
   T6 追加與 T7 範圍反殺「不會再觸發反擊」＝只增加打擊次數、不進入再判定。
   致命一擊不反擊：與 resolveHit 反震段的既有規則一致（formula.js `!out.killed`）。
   這道防護不只是語意——本函式內部會呼叫 onFieldDeaths() 立即結算擊殺獎勵，
   死者反殺拿到的經驗若讓玩家升級（升級會回滿血），呼叫端的 hp<=0 判死就會失效，
   整個死亡流程被無聲取消。
   =========================================================================== */
function skills2OnPlayerDamaged(mEnt, pEnt, hpDamage, blocked, res, floatSel) {
  if (!SKILL2_RT || !mEnt || !pEnt) return;
  if (res && (res.miss || res.invuln || res.killed)) return;
  if (!(pEnt.hp > 0)) return;
  if (!skills2PassiveActive('counter')) return; // 主動型被動：沒裝在技能列就不生效
  var lvs = skills2Levels('counter');
  if (!lvs || lvs[0] < 1) return;
  var t = SKILLS2.counter.tiers;
  var st = getStats();
  var eSel = (typeof THORN_FLOAT_MAP !== 'undefined' && THORN_FLOAT_MAP[floatSel]) || floatSel;

  // 破甲擊（T5）：格擋時機率上破甲（敵方 defDown 減益、疊層重置時間；與反擊傷害判定各自獨立）
  if (blocked && lvs[4] > 0 && mEnt.hp > 0 && chance(Number(t[4].fx.chance) || 0)) {
    applyStatus(mEnt, 'sgArmorBrk', { val: Number(t[4].fx.def) || 0, dur: sgVal(t[4].fx, 'sec', lvs[4]) });
    sgEmitVfx('counter', [mEnt], eSel, { fxKind: 'impact', variant: 'armor-break' });
  }

  // 反擊判定：pct＝普攻傷害%；強化反擊（T3）對所有反擊累加
  var bonus = lvs[2] > 0 ? sgVal(t[2].fx, 'pct', lvs[2]) : 0;
  var strikes = [];
  var tookDamage = (hpDamage > 0) || !!(res && res.absorbed > 0);
  if (tookDamage && chance(Number(t[0].fx.chance) || 0)) {
    strikes.push(sgVal(t[0].fx, 'pct', lvs[0]) + bonus);
  }
  if (blocked && lvs[1] > 0) {
    var blockRed = (typeof blockDmgReduction === 'function') ? blockDmgReduction(st.blockDmgRed || 0) : 0;
    var parryPct = blockRed * sgVal(t[1].fx, 'mult', lvs[1]) / 100;
    if (parryPct > 0) strikes.push(parryPct + bonus);
  }
  if (!strikes.length || mEnt.hp <= 0) return;

  // 二次反擊（T6）：每個成立的反擊各自機率追加 count 次（同傷害%、不再判定）
  var all = [];
  for (var i = 0; i < strikes.length; i++) {
    all.push(strikes[i]);
    if (lvs[5] > 0 && chance(sgVal(t[5].fx, 'chance', lvs[5]))) {
      var extraN = Math.max(1, Math.floor(Number(t[5].fx.count) || 2));
      for (var xi = 0; xi < extraN; xi++) all.push(strikes[i]);
    }
  }

  // 野外才有敵群可反殺；高塔（單一 BOSS）反殺自然無目標
  var enemies = (typeof combatFieldEnemies === 'function' && typeof FIELD !== 'undefined' &&
    FIELD && FIELD.player === pEnt) ? combatFieldEnemies() : [mEnt];
  var out = { killed: false, dmg: 0, crit: false };
  var splashHit = [];
  sgEmitVfx('counter', [mEnt], eSel, { fxKind: 'strike', variant: 'counter-riposte', count: Math.min(5, all.length) });
  var hitIdx = 0;
  for (i = 0; i < all.length && mEnt.hp > 0; i++) {
    sgCounterStrike(pEnt, st, mEnt, all[i], eSel, out, sgStaggerMs(hitIdx++));
    // 狂化反殺（T7）：每次反擊額外對範圍內隨機 count 個敵人反擊（不再判定）
    if (lvs[6] > 0) {
      var victims = sgCounterSplashTargets(mEnt, enemies, t[6].fx);
      for (var vi = 0; vi < victims.length; vi++) {
        sgCounterStrike(pEnt, st, victims[vi], sgVal(t[6].fx, 'pct', lvs[6]) + bonus, eSel, out, sgStaggerMs(hitIdx++));
        if (splashHit.indexOf(victims[vi]) < 0) splashHit.push(victims[vi]);
      }
    }
  }
  if (splashHit.length) {
    sgEmitVfx('counter', splashHit, eSel, { fxKind: 'chain', variant: 'counter-sweep' });
  }

  // 反擊盾（T4）：每次反擊事件回復一次（吃護盾效率與技能護盾上限 → formula.js grantShield）
  if (lvs[3] > 0 && typeof grantShield === 'function') {
    var gained = grantShield(pEnt, st.hp * sgVal(t[3].fx, 'pct', lvs[3]) / 100, st);
    if (gained > 0 && typeof floatPlayerEvent === 'function') {
      var pSel = (typeof playerEventFloatTarget === 'function') ? playerEventFloatTarget(floatSel) : floatSel;
      floatPlayerEvent(pSel, '🛡️+' + fmt(gained), 'shield');
    }
  }

  // 反殺若擊殺了攻擊者以外的敵人，由統一清算掃描收尾（_rewarded 防重複；
  // 攻擊者本身由呼叫端 fieldMonsterAttack／tower 的既有死亡判定接手）
  if (out.killed && typeof onFieldDeaths === 'function' && typeof FIELD !== 'undefined' &&
      FIELD && FIELD.player === pEnt) {
    onFieldDeaths();
  }
}

/* 一次反擊命中：普攻攻擊組態 × pct%，走完整 resolveHit（可爆擊、可未命中、吃虛弱
   與狂怒乘區）；統計歸入 skill2:counter。 */
function sgCounterStrike(pEnt, st, target, pct, floatSel, out, delayMs) {
  if (!target || target.hp <= 0 || !(pct > 0)) return null;
  var aCfg = (typeof playerAtkCfg === 'function') ? playerAtkCfg(pEnt) : null;
  if (!aCfg) return null;
  aCfg.atk = (aCfg.atk || 0) * pct / 100;
  if (aCfg.matk) aCfg.matk = aCfg.matk * pct / 100;
  aCfg = skill2VulnACfg(aCfg, target);
  var res = resolveHit(pEnt, target, aCfg, monsterDefCfg(target));
  if (typeof applySkillFinalDamageMultiplier === 'function') applySkillFinalDamageMultiplier(target, res, false);
  var g = SKILLS2.counter;
  if (!res.miss) {
    out.dmg += res.dmg;
    if (res.crit) out.crit = true;
    var s = fmt(res.dmg);
    if (res.crit) s = '爆擊 ' + s;
    if (res.blocked) s = '格擋 ' + s;
    if (typeof floatEnemyEvent === 'function') {
      floatEnemyEvent(target, floatSel, g.emoji + '反擊 ' + s,
        (typeof combatDamageFloatClass === 'function') ? combatDamageFloatClass('enemy-skill', res) : 'enemy-skill',
        res.dmg, delayMs);
    }
    if (typeof trackDps === 'function') trackDps(res.dmg);
    if (typeof recordRunDamage === 'function') {
      recordRunDamage(g.name, res.dmg, 'skill2:counter', sgTotalLevel(skills2Levels('counter')));
    }
  } else if (typeof floatEnemyEvent === 'function') {
    floatEnemyEvent(target, floatSel, 'MISS', 'miss enemy-dodge', undefined, delayMs);
  }
  if (res.killed) out.killed = true;
  return res;
}

/* 狂化反殺目標挑選：範圍內（米換算；無座標＝視為在範圍內）、排除攻擊者本身，
   隨機挑 count 個（每次反擊各自重挑）。 */
function sgCounterSplashTargets(exclude, enemies, fx) {
  var radius = bfMeterPx(Number(fx.m) || 80);
  var count = Math.max(1, Math.floor(Number(fx.count) || 2));
  var poolT = [];
  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i];
    if (!e || e.hp <= 0 || e === exclude) continue;
    if (typeof bfPos === 'function' && bfPos(e) && typeof bfEntityDistance === 'function' &&
        bfEntityDistance(e) > radius) continue;
    poolT.push(e);
  }
  for (var j = poolT.length - 1; j > 0; j--) {
    var k = Math.floor(Math.random() * (j + 1));
    var tmp = poolT[j]; poolT[j] = poolT[k]; poolT[k] = tmp;
  }
  return poolT.slice(0, count);
}

/* ===========================================================================
   每 tick 排程（由 js/skills.js tickSkillSchedulers 末端鏈結呼叫，
   野外與高塔兩處鏡射掛點自然生效；必須在空場提前返回之前執行）
   ctx = { pEnt, getEnemies(), floatSel, onDeaths, onDamage? }
   =========================================================================== */
function tickSkill2(dt, ctx) {
  if (!SKILL2_RT || !ctx || !ctx.pEnt) return;
  if (SKILL2_RT.rage && SKILL2_RT.rage.until <= GT) SKILL2_RT.rage = null; // 狂怒到期回收
  sgTickFlyingProjectiles(dt, ctx);
  sgTickMeteors(ctx);
  sgTickGrounds(dt, ctx);
  sgTickOrbits(dt, ctx);
  sgTickStorm(ctx);
  sgTickBloodDots(dt, ctx);
  sgTickBurn(dt, ctx);
}

/* 暴風之舞：每 gap 秒自動施放 1 次雙刀亂舞；每次作用時挑一個敵方目標衝過去，
   到達（可近戰）或目標死亡前不換目標。 */
function sgTickStorm(ctx) {
  var stm = SKILL2_RT.storm;
  if (!stm) return;
  if (stm.until <= GT || skills2Levels('dualdance')[6] < 1) { SKILL2_RT.storm = null; return; }
  /* 化身期間普攻是「取消」不是「延後」（2026-08-14 審查修正）：
     戰鬥迴圈的普攻閘門只擋出手、計時器仍在倒數，若放任累積欠帳，
     化身結束後會以 tick 頻率把整段欠帳連發出去（遠超攻速上限），
     等於退還「期間無法普攻」的設計代價。每 tick 夾回 0，結束後從頭起算。 */
  if (ctx.pEnt.atkCd < 0) ctx.pEnt.atkCd = 0;
  /* 暈眩中不揮舞（比照一般技能施放被暈眩擋下）；節拍照走、錯過的不補發。 */
  var stunned = (typeof effectActive === 'function') && effectActive(ctx.pEnt, 'stun');
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  if (!stm.tgt || stm.tgt.hp <= 0 ||
      (typeof bfPos === 'function' && bfPos(stm.tgt) && typeof bfPlayerCanReach === 'function' && bfPlayerCanReach(stm.tgt))) {
    var live = enemies.filter(function (e) { return e && e.hp > 0; });
    stm.tgt = live.length ? live[Math.floor(Math.random() * live.length)] : null;
  }
  if (stm.tgt) ctx.pEnt._lockTarget = stm.tgt;
  var guard = 0;
  while (stm.nextAt <= GT && stm.until > GT && guard < 50) {
    guard++;
    stm.nextAt += Math.max(0.1, stm.gap);
    if (stunned) continue;
    var res = castSkill2(ctx.pEnt, enemies, 'dualdance', ctx.floatSel, { storm: true });
    if (res) {
      if (ctx.onDamage) ctx.onDamage(res.dmg);
      if (res.killed && ctx.onDeaths) ctx.onDeaths();
      enemies = ctx.getEnemies ? ctx.getEnemies() : enemies;
    }
  }
}

/* 血刃斬第 5／7 階：毒霧感染與零日感染都是「每次作用時」的機率判定。
   以本引擎自己的節拍器對齊各 DoT 實例的作用間隔（時戳記在敵人實體上，純 JSON、
   隨實體自然回收），不去改動 tickStatuses 的通用結算；零日感染結束時再傳染兩種 DoT。 */
function sgTickBloodDots(dt, ctx) {
  var lvs = skills2Levels('bloodblade');
  var spreadLv = lvs[4], zeroLv = lvs[6];
  if (spreadLv < 1 && zeroLv < 1) return;
  var t = SKILLS2.bloodblade.tiers;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i];
    if (!e || e.hp <= 0) continue;
    if (typeof GT === 'number' && e._sgDotSkipAt === GT) continue;
    var sids = ['sgBleed', 'sgPoison'];
    for (var si = 0; si < sids.length; si++) {
      var d = sgFindDot(e, sids[si]);
      if (!d) continue;
      if (!e._sgAcc) e._sgAcc = {};
      var acc = (e._sgAcc[sids[si]] || 0) + dt;
      var gap = Math.max(0.1, d.interval || 1);
      while (acc >= gap) {
        acc -= gap;
        // 毒霧感染：毒每次作用時，機率傳染給附近 count 個尚未中毒的敵人（複製剩餘時值）
        if (sids[si] === 'sgPoison' && spreadLv > 0 && chance(sgVal(t[4].fx, 'chance', spreadLv))) {
          var spreadCount = Math.max(1, Math.floor(sgVal(t[4].fx, 'count', spreadLv)));
          var near = bfNearestOthers(e, enemies, enemies.length);
          var spreaded = 0;
          for (var ni = 0; ni < near.length; ni++) {
            if (near[ni].hp > 0 && !sgHasDot(near[ni], 'sgPoison')) {
              sgEmitVfx('bloodblade', [e, near[ni]], ctx.floatSel, {
                fxKind: 'chain', variant: 'poison-spread', elem: 'poison', count: 1
              });
              applyStatus(near[ni], 'sgPoison', { dps: d.dps, dur: Math.max(0.2, d.until - GT), interval: gap });
              near[ni]._sgDotSkipAt = GT;
              spreaded++;
              if (spreaded >= spreadCount) break;
            }
          }
        }
        sgEmitVfx('bloodblade', [e], ctx.floatSel, {
          fxKind: 'impact', variant: sids[si] === 'sgPoison' ? 'poison-tick' : 'bleed-tick',
          elem: sids[si] === 'sgPoison' ? 'poison' : null
        });
        // 零日感染：每次作用時，機率立即造成剩餘持續傷害並清除該狀態
        // 剩餘值含 tickStatuses 已累積、尚未跳出的殘額（d.acc 秒），與到期補跳的總量守恆一致
        if (zeroLv > 0 && chance(sgVal(t[6].fx, 'chance', zeroLv))) {
          var remain = Math.max(0, d.dps * ((d.until - GT) + (d.acc || 0)));
          if (remain > 0) {
            var zOut = { killed: false, dmg: 0, crit: false };
            sgDerivedHit(e, remain, 'bloodblade', ctx.floatSel, zOut, '💥', 0);
            sgSpreadBloodbladeDots(e, enemies, getStats(), lvs, t);
            if (ctx.onDamage) ctx.onDamage(zOut.dmg);
            if (zOut.killed && ctx.onDeaths) ctx.onDeaths();
            sgEmitVfx('bloodblade', [e], ctx.floatSel, {
              fxKind: 'burst', variant: 'zero-infection', elem: 'poison'
            });
          }
          // 直接移除實例（剩餘值已立即生效；不走到期流程，避免補跳殘餘）
          var di2 = e.dots.indexOf(d);
          if (di2 >= 0) e.dots.splice(di2, 1);
          acc = 0;
          break;
        }
      }
      e._sgAcc[sids[si]] = acc;
    }
  }
}

/* ---- 敵人死亡掛勾（js/skills.js skillRtOnEnemyDeath 末端鏈結，野外擊殺時呼叫）---- */
function skills2OnEnemyDeath(deadEnt, enemies) {
  if (!SKILL2_RT || !deadEnt) return;
  sgRageOnKill();                 // 嗜血狂怒：狂化連殺疊連擊（T4）＋狂血盛宴延時（T7）
  sgDeathBoom(deadEnt, enemies);  // 血刃斬：死亡屍爆（T6）
  sgBurnBlast(deadEnt, enemies);  // 火球術：爆燃（T5）——死亡是燃燒的另一個結束時機
}

/* 嗜血狂怒的擊殺效果：期間每殺 1 敵——T4 連擊數累加、T7 延長持續時間並同步刷新
   sgBloodrage 增益（權威在 SKILL2_RT.rage.until，增益圖示與攻速值跟隨）。
   T7 的延時依需求無上限；T4 的 killCombo 仍沿用自身技能階段的累積上限。 */
function sgRageOnKill() {
  var lvs = skill2RageLevels();
  if (!lvs) return;
  var rt = SKILL2_RT.rage;
  var t = SKILLS2.bloodrage.tiers;
  if (lvs[3] > 0) {
    var comboMax = Number(t[3].fx.killMax) || 0;
    rt.killCombo = (rt.killCombo || 0) + (Number(t[3].fx.kill) || 0);
    if (comboMax > 0) rt.killCombo = Math.min(rt.killCombo, comboMax);
  }
  if (lvs[6] > 0) {
    rt.until += Number(t[6].fx.sec) || 0;
    if (rt.pEnt) {
      applyStatus(rt.pEnt, 'sgBloodrage', {
        val: sgVal(t[0].fx, 'pct', lvs[0]), dur: Math.max(0.1, rt.until - GT)
      });
    }
  }
}

/* 死亡屍爆：流血或中毒狀態的敵人死亡時爆炸，對附近敵人造成血刃斬技能傷害的一部分並傳染中毒。
   爆炸若再擊殺敵人，由 onFieldDeaths 的統一清算掃描接手（_rewarded 防重複）。 */
function sgDeathBoom(deadEnt, enemies) {
  var lvs = skills2Levels('bloodblade');
  if (lvs[5] < 1) return;
  if (!sgHasDot(deadEnt, 'sgBleed') && !sgHasDot(deadEnt, 'sgPoison')) return;
  var t = SKILLS2.bloodblade.tiers;
  var st = getStats();
  var baseVal = st.atk * sgVal(t[0].fx, 'pct', lvs[0]) / 100;
  var boomVal = baseVal * sgVal(t[5].fx, 'pct', lvs[5]) / 100;
  var count = Math.max(1, Math.floor(Number(t[5].fx.count) || 2));
  var victims = bfNearestOthers(deadEnt, enemies, count);
  if (!victims.length) return;
  var pEnt = (typeof FIELD !== 'undefined' && FIELD && FIELD.player) ? FIELD.player : null;
  if (!pEnt) return;
  var poisonSpec = sgBloodbladeDotSpec(st, lvs, t, 'sgPoison');
  var deadPoison = sgFindDot(deadEnt, 'sgPoison');
  var out = { killed: false, dmg: 0, crit: false };
  sgEmitVfx('bloodblade', [deadEnt], 'mv-float', {
    fxKind: 'burst', variant: 'blood-explosion', elem: 'poison'
  });
  for (var i = 0; i < victims.length; i++) {
    var victim = victims[i];
    sgHitOne(pEnt, st, victim, boomVal, 'bloodblade', 'mv-float', out, sgStaggerMs(i));
    if (victim.hp > 0) {
      // 屍爆固定傳染中毒；若死者本身帶毒則保留其剩餘強度與時間，否則用技能規格補上。
      sgApplyBloodbladeDot(victim, 'sgPoison', deadPoison || poisonSpec,
        deadPoison ? deadPoison.until - GT : undefined);
    }
  }
}

/* ===========================================================================
   說明文字（純函式——主執行緒沒有 G，一律以傳入的等級陣列運算）
   =========================================================================== */

/* 單一階的說明：以 desc 模板代入該等級的計算值。lv<1 時以 Lv.1 預覽。 */
function describeSkill2Tier(gid, tierIdx, lv) {
  var g = SKILLS2[gid];
  var t = g && g.tiers[tierIdx];
  if (!t) return '';
  var useLv = Math.max(1, Number(lv) || 0);
  return String(t.desc || '').replace(/\{(\w+)\}/g, function (m, key) {
    var v = sgVal(t.fx, key, useLv);
    return (Math.abs(v - Math.round(v)) < 1e-9) ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
  });
}

/* 群組整體說明（提示框用）：冷卻／消耗＋各階現況。levels 由呼叫端傳入（快照）。 */
function describeSkill2Group(gid, levels) {
  var g = SKILLS2[gid];
  if (!g) return '';
  var lvs = levels || sgEffectiveLevels(null, gid);
  var parts = [];
  for (var i = 0; i < g.tiers.length; i++) {
    var lv = lvs[i] || 0;
    var locked = i > 0 && (lvs[i - 1] || 0) < 1;
    var cls = lv > 0 ? 'sg-tier-on' : (locked ? 'sg-tier-locked' : 'sg-tier-off');
    var head = '第' + (i + 1) + '階【' + g.tiers[i].name + '】' + (lv > 0 ? ' Lv.' + lv : (locked ? '（未解鎖）' : '（未投資）'));
    parts.push('<div class="' + cls + '"><b>' + head + '</b>　' + describeSkill2Tier(gid, i, lv) + '</div>');
  }
  return parts.join('');
}
