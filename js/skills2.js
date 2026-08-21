'use strict';
/* ============ 新版主動技能系統（2026-08-13 技能改造第一批） ============
   設計來源：神力之巔_記事錄.xlsx「技能」頁籤。
   8 個技能群組 × 7 階：同群組在前端顯示為「同一個技能」，玩家裝配群組後，
   透過升級各階持續強化該技能的效果（階＝效果模組，不是獨立技能）。
   （2026-08-14 第二批追加：counter 反擊＝被動群組，不裝載、不施放，受擊時觸發；
   bloodrage 嗜血狂怒＝主動爆發增益，效果全部只在持續期間生效。）
   （2026-08-16 第三批追加＝魔法系兩群組：fireball 火球術／firepillar 火龍捲。
   帶進三個新機制，皆為群組共用能力、不是這兩個技能的特例：
     1. 群組層 dmgType／elem：魔法傷害走魔攻與魔穿、本體傷害段歸屬火屬性（sgAtkCfg）
     2. 施法距離：各階 fx.castM（米）決定射程，取代「新版技能一律近戰起手」的寫死規則
        （skills2CastRangePx／skills2CanReach，js/skills.js 的施放閘門同步改吃這支）
     3. 地板場域（SKILL2_RT.grounds）：釘在座標上、按節拍反覆作用的區域，
        可重生；無座標時（高塔）退化為固定打主目標）
   （2026-08-16 第四批追加＝魔法系 firehunt 火狩。帶進第四個群組共用能力：
     4. 環繞場域（SKILL2_RT.orbits）：釘在玩家身上、持續旋轉的環繞體，
        以接觸判定命中（進入才算一次），可伴生、可因擊殺延長；
        無座標時（高塔）退化為每轉一圈打一次主目標）
   （2026-08-17 第五批追加＝地系三群組：rockarmor 岩甲術／mire 泥沼術／earthguard 大地守護。
    帶進第五～第九個群組共用能力，全部都是「引擎收斂點」而非這三個技能的特例：
      5. 我方防禦側乘區（skill2DamageTakenMultiplier）：受到的傷害額外乘算減免，
         獨立於神鑄【聖佑】的 dmgRed 上限，掛在 formula.js resolveHit 我方受擊段
      6. 護盾效率乘算（skill2ShieldEffFactor）：掛在 formula.js st.shieldEff 派生點，
         因此 applyShield／grantShield／溢出轉護盾三條路徑一體生效
      7. 可變緩速（sgMire 狀態＋skill2MireAspdFactor／skill2MoveSlowFactor）：
         舊 slow 是固定 -30% 攻速的控場；場域型緩速需要「同時降攻速與移速、強度可換代」，
         故走 stat 減益（不吃控場遞減——每 0.5 秒重塗一次的場域會被遞減歸零）
      8. 法力承傷（skills2ManaShieldAbsorb）：我方扣血前先由法力承擔一部分
      9. 復活攔截（skills2TryRebirth）：掛在野外／高塔兩個判死收斂點
   （2026-08-17 第六批追加＝雷系三群組：chainlightning 連鎖閃電／thunderstrike 落雷術／
    thunderorb 雷球。帶進第十～第十二個群組共用能力，同樣是引擎收斂點：
     10. 移動場域（sgSpawnGround 的 moveTo／speed／parkSec）：地板場域從「釘死在座標上」
         擴充為「可沿直線飛向落點、抵達後停駐」，雷球飛行途中的逐拍傷害因此與火龍捲
         共用同一套場域結算（含成長、退化與顯示層 area 協議）
     11. 天降打擊佇列泛用化（sgQueueMeteor 的 extra）：落地時刻結算的排程原本寫死火球術，
         改為帶 gid／特效變體／每目標傷害加成／落地回呼，落雷術與雷殞天落共用同一條時間軸
     12. 環繞場域泛用化（sgSpawnOrbitField 的 statusId／hitVfx／onStrike）：
         狀態鍵、命中特效與命中回呼改由呼叫端指定，環體電球與火狩共用同一套接觸判定
   （2026-08-17 第七批追加＝冰系三群組：icearrow 寒冰箭／waterball 水流彈／
    frostnova 冰霜新星。帶進第十三～第十六個群組共用能力，同樣是引擎收斂點：
     13. 寒霜狀態（sgApplyFrost／sgFrostStacks／sgTickFrost）：可疊層的緩速兼持續傷害，
         疊滿層數即凍結（凍結的行動限制沿用暈眩管線，因此完整吃 BOSS 免疫與控場遞減）。
         同時把「場域型緩速」收斂成 skill2SlowAspdFactor／skill2SlowMoveFactor 兩支，
         formula.js 與 battlefield.js 從此只認得通用緩速一個掛點（泥沼與寒霜相乘）
     14. 敵人屬性標籤強制改寫（skill2ForcedAttr，掛 combat.js monsterDefCfg 的 attr 欄）
         ＋單一屬性的受傷增幅（skill2IceAmpACfg，掛 resolveHit 既有的 skillElemAmp 乘區，
         與 totalDmgPct 分開，才不會把同一次攻擊的其他屬性段一起放大）
     15. 跟隨我方的地板場域（sgSpawnGround 的 follow）：圓心恆等於玩家當下座標，
         與環繞場域同一種錨定方式，差別只在形狀是地板矩形（暴風雪）
     16. 追擊場域（sgSpawnGround 的 chaseM ＋ contact）：抵達落點後改鎖範圍內的隨機敵人
         繼續飛，並採環繞場域的接觸判定（進入才算一次命中），追蹤冰箭因此不必另寫
         模擬迴圈，也不會退化成「每個節拍都全額命中」

   ---- 設計文檔用語對照（2026-08-17 補列於文檔上方）----
   物理傷害／火焰傷害／寒冰傷害／地系傷害／風系傷害（未實裝）／雷電傷害／毒性傷害／
   光系傷害／暗影傷害 ＝ phys／fire／ice／earth／(wind)／lightning／poison／light／dark。
   本檔的 desc 說明模板一律使用上列「說明用語」。

   ---- buff 規則對照（設計文檔 → 狀態表 stack 欄）----
     重上（持續時間內再次獲得＝時間重計）      → refresh（同值重塗）
     疊加（層數 +1 並重新計時，效果＝單層×層數）→ stack（maxStacks 為層數上限）
     取代（同類型不同強度＝新的覆蓋舊的並重計）→ refresh（後蓋前，不比大小）
   ⚠️ 既有持續傷害多為 strongest（取高並重新計時），與「取代」不同；本次不動既有狀態的
      疊加規則（會改變已調校完成的數值），新增狀態則依上表選規則。

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
/* ---- 超神進化（2026-08-19 第八批：技能第 8 階）----
   結構上**不是** tiers 的第 8 個元素：前 7 階是「循序解鎖、全部同時生效、各自獨立升級」，
   超神進化是「三選一、只有選中的那一個生效」，兩種語意混在同一個陣列裡會讓
   sgEffectiveLevels 的級聯、存檔正規化與參數表的階數校驗全部長出例外分支。
   因此資料放在群組層的 g.ult（三個選項），等級與選擇放在 G.player.skills2.ult，
   UI 只在「格位」這一層把它畫成第 8 格（ref 仍是 sg:<gid>:7）。
   解鎖條件：該群組前 7 階全部練滿（目前不另設等級／轉生門檻）。 */
var SG_ULT_SLOT = SG_TIER_COUNT;   // 超神進化在技能面板的格位索引（第 8 格）
var SG_ULT_OPTION_COUNT = 3;       // 三選一
var SG_FLYING_PROJECTILE_SPEED = 240;
/* 寒冰箭表定速度：30 米／秒；戰場座標固定為 10 單位／米。 */
var SG_ICEARROW_SPEED = 300;
/* 寒冰箭第 1 階（還沒變成貫穿）挑目標用的「前方正面」扇形。這一階是單體攻擊，
   一支箭咬一個敵人，箭道夾角不重要；變成貫穿之後就不再挑目標，故只用於該階。 */
var SG_ICEARROW_AIM_DEG = 45;
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
/* 同一次施放丟出多顆／多次時，各發之間的錯開時間（純顯示節奏；傷害在施放當下就結算完畢，
   延遲只用在飄字與特效的 delayMs，比照殞石的 SG_METEOR_INTERVAL_MS）。 */
var SG_WATERBALL_VOLLEY_MS = 220;   // 【三重流水】的第 2 顆之後每顆再錯開多久
var SG_FROSTNOVA_VOLLEY_MS = 260;   // 【三重新星】的第 2 次之後每次再錯開多久

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
var SG_PASSIVE = { counter: true, earthguard: true };
function skills2IsPassive(gid) { return !!SG_PASSIVE[gid]; }

/* 群組目前是否已學習（第 1 階至少 Lv.1）且已裝配在技能列。
   讀 G＝Worker 端唯一權威；主執行緒 UI 走面板快照自行判斷（js/ui.js）。
   主動群組也用得到：岩甲術【護盾增幅】是「主動技裡的主動型被動階」，
   生效前提同樣是佔著一個技能格。 */
function skills2Equipped(gid) {
  if (!skills2Castable(gid)) return false;
  var lo = (typeof G !== 'undefined' && G && G.player && G.player.loadout) ? G.player.loadout : null;
  return !!lo && lo.indexOf(SG_PREFIX + gid) >= 0;
}

/* 主動型被動目前是否生效：已學習且已裝配在技能列。 */
function skills2PassiveActive(gid) {
  return skills2IsPassive(gid) && skills2Equipped(gid);
}

/* ---- 群組定義表（撥離：config/CSV/Skills2.csv → 本字面值） ----
   群組欄位：name 名稱／emoji 圖標／range 初始涵蓋範圍（長*寬，米）／cd 冷卻秒數／cost 施法法力消耗
   階欄位：name 階段名稱／fx 效果參數／goldBase 升級金幣基數／goldGrow 升級金幣倍率
           （升級至下一級費用＝goldBase × goldGrow^目前等級，取整）／desc 效果說明模板
   fx 參數命名慣例：<鍵> 為不含升級效果的底值、<鍵>Per 為每級增量（值＝底值 + 增量×等級）。
   Lv.1 就已經吃到 1 級升級效果，練滿＝底值 + 增量×SG_TIER_MAX_LV；表值即依此設計，
   底值本身不是任何一個實際等級會出現的數字。
   desc 內的 {鍵} 於顯示時代入目前等級的計算值。 */
var SKILLS2 = {
  thrust: { name: '突刺', emoji: '🗡️', range: '12*3', cd: 5, cost: 25, tiers: [{ name: '突刺', unlock: { reinc: 0, lv: 1 }, cost: 25, fx: { pct: 150, pctPer: 15, count: 2 }, goldBase: 100000, goldGrow: 1.5, desc: '對前方敵人造成 {count} 次 {pct}% 物理傷害' }, { name: '連刺', unlock: { reinc: 0, lv: 1 }, cost: 40, fx: { chance: 25, chancePer: 2.5, count: 2 }, goldBase: 200000, goldGrow: 1.5, desc: '有 {chance}% 的機率再次進行 {count} 次突刺' }, { name: '傷害強化', unlock: { reinc: 0, lv: 50 }, cost: 60, fx: { pct: 20, pctPer: 3 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化突刺傷害，額外 +{pct}% 物理傷害（與第 1 階累加）' }, { name: '超連刺', unlock: { reinc: 0, lv: 100 }, cost: 80, fx: { count: 3, range: 20, rangePer: 2 }, goldBase: 800000, goldGrow: 1.5, desc: '每次能進行 {count} 道平行貫穿突刺，且突刺範圍提升 {range}%' }, { name: '擴散', unlock: { reinc: 0, lv: 150 }, cost: 100, fx: { pct: 20, pctPer: 2, count: 4 }, goldBase: 1500000, goldGrow: 1.5, desc: '突刺造成的傷害有 {pct}% 會擴散至周圍的 {count} 個敵人' }, { name: '貫穿突刺', unlock: { reinc: 0, lv: 200 }, cost: 140, fx: { m: 5, mPer: 0.5 }, goldBase: 3000000, goldGrow: 1.5, desc: '突刺會造成一直線的傷害，貫穿路徑上所有敵人，貫穿長度在原本長度上再增加 {m} 米' }, { name: '八方連刺', unlock: { reinc: 0, lv: 250 }, cost: 240, fx: { pct: 20, pctPer: 2, count: 3, directions: 8 }, goldBase: 5000000, goldGrow: 1.5, desc: '向八個方向同時進行 {count} 次突刺，且造成傷害額外 +{pct}%' }], ult: [{ id: 'phantomOcta', name: '幻影八方陣', cost: 300, fx: { m: 6, mPer: 0.6, dodge: 30, sec: 2 }, goldBase: 10000000, goldGrow: 1.5, desc: '突刺命中時，傷害同時擴散至該敵人周圍 {m} 米內的所有敵人；施放突刺後 {sec} 秒內，你有 {dodge}% 機率絕對閃避敵方攻擊' }, { id: 'shadowExecutioner', name: '暗影絕殺者', cost: 300, fx: { perStack: 1, perStackPer: 0.2, maxStacks: 100, pct: 100, pctPer: 20, dur: 30 }, goldBase: 10000000, goldGrow: 1.5, desc: '突刺命中時堆疊【靈魂撕裂】：每層使該敵人受到的傷害提高 {perStack}%，最多 {maxStacks} 層（疊滿＝+{pct}%）' }, { id: 'oneStrikeKill', name: '一擊必殺', cost: 300, fx: { mult: 4, multPer: 0.4 }, goldBase: 10000000, goldGrow: 1.5, desc: '【八方連刺】改為朝前方的 1 道突刺，但傷害改為 {mult} 倍，且可以立即殺死普通敵人' }] },
  cleave: { name: '迴旋斬', emoji: '🪓', range: '', cd: 8, cost: 25, tiers: [{ name: '迴旋斬', unlock: { reinc: 0, lv: 1 }, cost: 25, fx: { pct: 200, pctPer: 20 }, goldBase: 100000, goldGrow: 1.5, desc: '對範圍內的所有敵人造成 1 次 {pct}% 物理傷害' }, { name: '強化斬', unlock: { reinc: 0, lv: 1 }, cost: 40, fx: { range: 15, rangePer: 1.5 }, goldBase: 200000, goldGrow: 1.5, desc: '斬擊範圍擴大 {range}%（每級 +1.5% 範圍）' }, { name: '傷害強化', unlock: { reinc: 0, lv: 50 }, cost: 60, fx: { pct: 50, pctPer: 5 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化斬擊傷害，額外 +{pct}% 物理傷害' }, { name: '連斬', unlock: { reinc: 0, lv: 100 }, cost: 80, fx: { chance: 25, chancePer: 2.5, times: 2, timesPer: 0.25 }, goldBase: 800000, goldGrow: 1.5, desc: '斬擊時有 {chance}% 機率連續劈出共 {times} 次斬擊（不足 1 次的部分以機率觸發）' }, { name: '暈眩擊', unlock: { reinc: 0, lv: 150 }, cost: 100, fx: { chance: 25, chancePer: 1, sec: 1, secPer: 0.1 }, goldBase: 1500000, goldGrow: 1.5, desc: '斬擊時有 {chance}% 機率擊暈敵人 {sec} 秒' }, { name: '震碎斬', unlock: { reinc: 0, lv: 200 }, cost: 140, fx: { m: 12, mPer: 0.5 }, goldBase: 3000000, goldGrow: 1.5, desc: '斬擊會向前飛出 {m} 米距離，命中路徑上的敵人' }, { name: '迴身四方斬', unlock: { reinc: 0, lv: 250 }, cost: 240, fx: { pct: 50, pctPer: 5, times: 3, timesPer: 0 }, goldBase: 5000000, goldGrow: 1.5, desc: '同時朝前後左右四個方向各使出 {times} 次斬擊，且傷害額外 +{pct}%（每級 +5% 傷害；與原有傷害乘法計算）' }], ult: [{ id: 'voidShatter', name: '虛空碎裂斬', cost: 300, fx: { times: 1, timesPer: 0.2, pct: 50, pctPer: 5 }, goldBase: 10000000, goldGrow: 1.5, desc: '【迴身四方斬】的攻擊次數 +{times} 次，且物理傷害再額外 +{pct}%' }, { id: 'windChaser', name: '逐風者', cost: 300, fx: { hits: 4, hitsPer: 0.4, pct: 100, pctPer: 10, m: 4, gap: 0.4 }, goldBase: 10000000, goldGrow: 1.5, desc: '迴旋斬每命中 1 次，就在該敵人所在位置生成一道龍捲風：對半徑 {m} 米內的敵人造成 {hits} 段、每段 {pct}% 風系傷害' }, { id: 'stormGodSlash', name: '天霸風神斬', cost: 300, fx: { sec: 8, secPer: -0.5, range: 30 }, goldBase: 10000000, goldGrow: 1.5, desc: '迴旋斬範圍擴大 {range}%，並改為被動技能：不再主動施放，改為每 {sec} 秒自動施放 1 次（每級施放間隔 -0.5 秒，仍需裝配在技能列才生效）' }] },
  knife: { name: '飛刀', emoji: '🔪', range: '', cd: 8, cost: 25, tiers: [{ name: '飛刀', unlock: { reinc: 0, lv: 50 }, cost: 25, fx: { pct: 150, pctPer: 15, count: 3, deg: 60 }, goldBase: 100000, goldGrow: 1.5, desc: '朝前方 {deg} 度扇形內丟出 {count} 把飛刀，每把造成 {pct}% 物理傷害' }, { name: '強化飛刀', unlock: { reinc: 0, lv: 100 }, cost: 40, fx: { pct: 20, pctPer: 10 }, goldBase: 200000, goldGrow: 1.5, desc: '飛刀傷害進一步提升，額外 +{pct}% 物理傷害' }, { name: '彈射飛刀', unlock: { reinc: 0, lv: 150 }, cost: 60, fx: { pct: 30, pctPer: 5, count: 1 }, goldBase: 400000, goldGrow: 1.5, desc: '每把飛刀會在附近的 {count} 個敵人間彈跳，每次彈射造成 {pct}% 技能傷害' }, { name: '強化彈射', unlock: { reinc: 0, lv: 200 }, cost: 80, fx: { add: 1, addPer: 0.25 }, goldBase: 800000, goldGrow: 1.5, desc: '飛刀彈射的敵人數量額外 +{add}（不足 1 次的部分以機率觸發）' }, { name: '迴旋飛刀', unlock: { reinc: 0, lv: 250 }, cost: 100, fx: { count: 4, countPer: 0.2 }, goldBase: 1500000, goldGrow: 1.5, desc: '改為向周圍的 {count} 個敵人丟出飛刀（全圓形範圍鎖敵；不足 1 個的部分以機率觸發）' }, { name: '連鎖彈射', unlock: { reinc: 0, lv: 300 }, cost: 140, fx: { chance: 20, chancePer: 2, max: 4 }, goldBase: 3000000, goldGrow: 1.5, desc: '飛刀彈射後有 {chance}% 機率再次彈射，最多連續 {max} 次' }, { name: '神速飛刀', unlock: { reinc: 0, lv: 350 }, cost: 240, fx: { sec: 0.05, secPer: 0.01 }, goldBase: 5000000, goldGrow: 1.5, desc: '每把飛刀（含彈射）爆擊時，使飛刀技能冷卻時間 -{sec} 秒' }], ult: [{ id: 'petalStorm', name: '暴雨梨花', cost: 300, fx: { pct: 20, pctPer: 2 }, goldBase: 10000000, goldGrow: 1.5, desc: '每把飛刀（含彈射）都會對飛行路徑上的所有敵人造成 {pct}% 技能傷害' }, { id: 'deathReaper', name: '死亡收割者', cost: 300, fx: { pct: 25, pctPer: 2.5, maxStacks: 20, dur: 8 }, goldBase: 10000000, goldGrow: 1.5, desc: '飛刀殺死敵人時堆疊【死亡收割】：每層使你造成的傷害提高 {pct}%，最多 {maxStacks} 層，持續 {dur} 秒' }, { id: 'soulhunterBlade', name: '無限追魂刃', cost: 300, fx: { pct: 50, pctPer: 5, m: 30 }, goldBase: 10000000, goldGrow: 1.5, desc: '每次施放飛刀時額外射出 1 支無限飛刀，追擊周圍 {m} 米內的任意敵人：傷害提高 {pct}%，且彈射次數不受限制（場上每個敵人各被命中一次）' }] },
  gale: { name: '疾風斬', emoji: '💨', range: '', cd: 6, cost: 25, tiers: [{ name: '疾風斬', unlock: { reinc: 0, lv: 100 }, cost: 25, fx: { pct: 250, pctPer: 20, hits: 3 }, goldBase: 100000, goldGrow: 1.5, desc: '對敵人造成連續 {hits} 次 {pct}% 物理傷害（同一目標）' }, { name: '疾風連斬', unlock: { reinc: 0, lv: 150 }, cost: 40, fx: { add: 1, addPer: 0.2 }, goldBase: 200000, goldGrow: 1.5, desc: '斬擊次數額外 +{add}（不足 1 次的部分以機率觸發）' }, { name: '強化斬擊', unlock: { reinc: 0, lv: 200 }, cost: 60, fx: { pct: 15, pctPer: 4 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化斬擊傷害，額外 +{pct}% 物理傷害' }, { name: '擴散', unlock: { reinc: 0, lv: 250 }, cost: 80, fx: { pct: 50, pctPer: 5, m: 10 }, goldBase: 800000, goldGrow: 1.5, desc: '每次斬擊額外對 {m} 米內最近的 1 個敵人造成 {pct}% 技能傷害；附近沒有敵人時改對原目標造成' }, { name: '狂風斬', unlock: { reinc: 0, lv: 300 }, cost: 100, fx: { pct: 20, pctPer: 5, sec: 5 }, goldBase: 1500000, goldGrow: 1.5, desc: '施放疾風斬使你的攻速額外提高 {pct}%，持續 {sec} 秒（突破攻速上限，與自身攻速相乘）' }, { name: '極速斬', unlock: { reinc: 0, lv: 350 }, cost: 140, fx: { sec: 1, secPer: 0.3 }, goldBase: 3000000, goldGrow: 1.5, desc: '疾風斬的冷卻時間 -{sec} 秒' }, { name: '月牙斬', unlock: { reinc: 0, lv: 400 }, cost: 240, fx: { pct: 300, pctPer: 30, m: 5 }, goldBase: 5000000, goldGrow: 1.5, desc: '疾風斬的傷害由目標周圍 {m} 米內的所有敵人均分，且傷害額外 +{pct}%' }], ult: [{ id: 'thunderFlash', name: '霹靂一閃', cost: 300, fx: { mult: 5, multPer: 0.5, m: 6 }, goldBase: 10000000, goldGrow: 1.5, desc: '疾風斬的最後一斬會對你周圍 {m} 米內的敵人造成「單段傷害 × 連擊數 × {mult}」的傷害' }, { id: 'thunderGodSlash', name: '雷神斬', cost: 300, fx: { pct: 200, pctPer: 20, m: 8 }, goldBase: 10000000, goldGrow: 1.5, desc: '疾風斬附加雷電：每次斬擊命中時降下 1 道落雷，對命中處周圍 {m} 米內的敵人造成 {pct}% 閃電傷害' }, { id: 'chidori', name: '千鳥', cost: 300, fx: { pct: 50, pctPer: 5 }, goldBase: 10000000, goldGrow: 1.5, desc: '【月牙斬】不再由範圍內的敵人均分傷害，改為每個敵人都受到完整傷害，且傷害再額外 +{pct}%' }] },
  bloodblade: { name: '血刃斬', emoji: '🩸', range: '', cd: 8, cost: 25, tiers: [{ name: '血刃斬', unlock: { reinc: 0, lv: 200 }, cost: 25, fx: { pct: 200, pctPer: 15, dotPct: 30, dotSec: 5, dotGap: 1 }, goldBase: 100000, goldGrow: 1.5, desc: '對敵人造成 1 次 {pct}% 物理傷害，並附加流血：每 {dotGap} 秒造成技能傷害 {dotPct}% 的傷害，持續 {dotSec} 秒' }, { name: '強化流血', unlock: { reinc: 0, lv: 250 }, cost: 40, fx: { sec: 0.5, secPer: 0.1, gapPct: 10, gapPctPer: 1.5 }, goldBase: 200000, goldGrow: 1.5, desc: '流血持續時間 +{sec} 秒，且流血作用間隔縮短 {gapPct}%（跳得更快、總傷更高）' }, { name: '虛弱', unlock: { reinc: 0, lv: 300 }, cost: 60, fx: { pct: 10, pctPer: 2 }, goldBase: 400000, goldGrow: 1.5, desc: '流血中的敵人受到的傷害提高 {pct}%' }, { name: '血毒刃', unlock: { reinc: 0, lv: 350 }, cost: 80, fx: { dotPct: 25, dotPctPer: 3, dotSec: 6, dotGap: 0.5 }, goldBase: 800000, goldGrow: 1.5, desc: '敵人流血的同時也會中毒：每 {dotGap} 秒造成技能傷害 {dotPct}% 的毒屬性傷害，持續 {dotSec} 秒' }, { name: '毒霧感染', unlock: { reinc: 0, lv: 400 }, cost: 100, fx: { chance: 30, chancePer: 2, count: 2 }, goldBase: 1500000, goldGrow: 1.5, desc: '血毒刃的毒在每次作用時，有 {chance}% 機率傳染給附近的 {count} 個敵人' }, { name: '死亡屍爆', unlock: { reinc: 0, lv: 450 }, cost: 140, fx: { pct: 50, pctPer: 5, count: 2 }, goldBase: 3000000, goldGrow: 1.5, desc: '流血或中毒狀態的敵人死亡時爆炸，對附近 {count} 個敵人造成 {pct}% 技能傷害並傳染中毒' }, { name: '零日感染', unlock: { reinc: 0, lv: 500 }, cost: 240, fx: { chance: 20, chancePer: 2, pct: 40, pctPer: 4, m: 20, count: 1 }, goldBase: 5000000, goldGrow: 1.5, desc: '流血或中毒狀態在每次作用時有 {chance}% 機率立即造成剩餘的持續傷害；作用結束後將流血及中毒傳染給 {m} 米內的隨機 {count} 個敵人，且流血與中毒傷害 +{pct}%' }], ult: [{ id: 'slayerDomain', name: '殺神領域', cost: 300, fx: { pct: 2, pctPer: 0.2, healPct: 2, healPctPer: 0.2, m: 24, dur: 6, maxStacks: 100 }, goldBase: 10000000, goldGrow: 1.5, desc: '永久展開 {m} 米的殺神領域：領域內的敵人死亡時堆疊【殺神】，每層使你造成的傷害 +{pct}%，同時回復 {healPct}% 最大生命；最多 {maxStacks} 層，持續 {dur} 秒' }, { id: 'venomDomain', name: '萬毒血霧', cost: 300, fx: { pct: 100, pctPer: 10, m: 24, gap: 0.5, dur: 6, maxStacks: 10 }, goldBase: 10000000, goldGrow: 1.5, desc: '永久展開 {m} 米的萬毒領域：領域內的敵人每 {gap} 秒受到 {pct}% 中毒傷害，該中毒持續 {dur} 秒且可堆疊至 {maxStacks} 層' }, { id: 'disintegrate', name: '崩解', cost: 300, fx: { pct: 50, pctPer: 5, m: 6 }, goldBase: 10000000, goldGrow: 1.5, desc: '中毒與流血不再有持續時間，塗上的當下就結算完整傷害；結算後爆炸，對周圍 {m} 米內的敵人造成該效果 {pct}% 的傷害' }] },
  dualdance: { name: '雙刀亂舞', emoji: '⚔️', range: '', cd: 10, cost: 25, tiers: [{ name: '雙刀亂舞', unlock: { reinc: 0, lv: 250 }, cost: 25, fx: { pct: 300, pctPer: 25, count: 2 }, goldBase: 100000, goldGrow: 1.5, desc: '對附近 {count} 個敵人各造成 1 次 {pct}% 物理傷害（只有 1 個敵人時全部打向同一目標）' }, { name: '疾風亂舞', unlock: { reinc: 0, lv: 300 }, cost: 40, fx: { add: 1, addPer: 0.2 }, goldBase: 200000, goldGrow: 1.5, desc: '額外攻擊附近 {add} 個敵人（不足 1 個的部分以機率觸發）' }, { name: '強化雙刀', unlock: { reinc: 0, lv: 350 }, cost: 60, fx: { pct: 25, pctPer: 5 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化雙刀傷害，額外 +{pct}% 物理傷害' }, { name: '狂暴之舞', unlock: { reinc: 0, lv: 400 }, cost: 80, fx: { cr: 100, crPer: 10, add: 1, addPer: 0.1, sec: 6 }, goldBase: 800000, goldGrow: 1.5, desc: '讓你的暴擊率 +{cr}%、連擊數 +{add}，持續 {sec} 秒' }, { name: '鐵血之舞', unlock: { reinc: 0, lv: 450 }, cost: 100, fx: { pct: 3.5, pctPer: 0.35, sec: 3, gap: 0.35, m: 5 }, goldBase: 1500000, goldGrow: 1.5, desc: '施放雙刀亂舞時使你以及附近 {m} 米內的所有敵人流血：每 {gap} 秒造成最大生命值 {pct}% 傷害，持續 {sec} 秒' }, { name: '嗜血狂化', unlock: { reinc: 0, lv: 500 }, cost: 140, fx: { pct: 0.25, pctPer: 0.025, sec: 6 }, goldBase: 3000000, goldGrow: 1.5, desc: '施放雙刀亂舞後 {sec} 秒內，生命值或護盾每減少 1%，獲得 {pct}% 技能傷害提升' }, { name: '暴風亂舞', unlock: { reinc: 0, lv: 550 }, cost: 240, fx: { sec: 3, secPer: 0.3, gap: 0.35 }, goldBase: 5000000, goldGrow: 1.5, desc: '化身暴風在敵人間穿梭 {sec} 秒：每 {gap} 秒自動施放 1 次雙刀亂舞；期間無法普攻但可施放技能' }], ult: [{ id: 'doomDance', name: '毀滅之舞', cost: 300, fx: { hpPct: 10, hpPctPer: -0.5, pct: 200, pctPer: 20 }, goldBase: 10000000, goldGrow: 1.5, desc: '每施放 1 次雙刀亂舞就失去當下 {hpPct}% 生命值（不會致死），但雙刀亂舞的傷害提高 {pct}%' }, { id: 'flameKagura', name: '火之神樂', cost: 300, fx: { pct: 10, pctPer: 1, gap: 0.5, dur: 6, maxStacks: 20 }, goldBase: 10000000, goldGrow: 1.5, desc: '雙刀亂舞附加火焰：每次命中堆疊 1 層【神樂灼焰】，每層每 {gap} 秒造成 {pct}% 火屬性傷害，最多 {maxStacks} 層，持續 {dur} 秒' }, { id: 'asuraDance', name: '修羅亂舞', cost: 300, fx: { pct: 20, pctPer: 2 }, goldBase: 10000000, goldGrow: 1.5, desc: '讓你可以同時裝備兩把雙手武器（主手與副手各一把），且雙手武器的詞條效果提升 {pct}%' }] },
  counter: { name: '反擊', emoji: '🛡️', range: '', cd: 0, cost: 5, tiers: [{ name: '反擊', unlock: { reinc: 0, lv: 300 }, cost: 5, fx: { chance: 35, pct: 50, pctPer: 5 }, goldBase: 100000, goldGrow: 1.5, desc: '被動：受到傷害時有 {chance}% 機率對攻擊者反擊，造成 {pct}% 普攻傷害' }, { name: '招架', unlock: { reinc: 0, lv: 350 }, cost: 10, fx: { mult: 300, multPer: 30 }, goldBase: 200000, goldGrow: 1.5, desc: '格擋時必定對敵人反擊，造成「格擋減傷值 × {mult}%」的普攻傷害' }, { name: '強化反擊', unlock: { reinc: 0, lv: 400 }, cost: 20, fx: { pct: 30, pctPer: 5 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步提升反擊傷害，額外 +{pct}% 反擊普攻傷害' }, { name: '反擊盾', unlock: { reinc: 0, lv: 450 }, cost: 40, fx: { pct: 1, pctPer: 0.1 }, goldBase: 800000, goldGrow: 1.5, desc: '觸發反擊時，回復自身最大生命 {pct}% 的護盾' }, { name: '破甲擊', unlock: { reinc: 0, lv: 500 }, cost: 60, fx: { chance: 35, def: 15, sec: 4, secPer: 0.4, max: 4 }, goldBase: 1500000, goldGrow: 1.5, desc: '格擋時有 {chance}% 機率造成破甲：防禦 -{def}%，持續 {sec} 秒，最多疊 {max} 層（疊層時重置時間）' }, { name: '二次反擊', unlock: { reinc: 0, lv: 550 }, cost: 80, fx: { chance: 50, chancePer: 5, count: 2 }, goldBase: 3000000, goldGrow: 1.5, desc: '反擊時有 {chance}% 機率再追加 {count} 次反擊（追加反擊不會再觸發反擊）' }, { name: '狂化反殺', unlock: { reinc: 0, lv: 600 }, cost: 100, fx: { pct: 50, pctPer: 5, count: 2, m: 80 }, goldBase: 5000000, goldGrow: 1.5, desc: '每次反擊時，額外對 {m} 米內隨機 {count} 個敵人反擊，造成 {pct}% 普攻傷害（不會再觸發反擊）' }], ult: [{ id: 'holyBody', name: '神聖之體', cost: 300, fx: { count: 10, pct: 400, pctPer: 40, m: 8 }, goldBase: 10000000, goldGrow: 1.5, desc: '每 {count} 次反擊後朝目標射出一顆光彈，對其周圍 {m} 米內的敵人造成 {pct}% 神聖傷害' }, { id: 'indomitable', name: '不屈鬥魂', cost: 300, fx: { pct: 2000, pctPer: 200, m: 30, sec: 5, cd: 60 }, goldBase: 10000000, goldGrow: 1.5, desc: '死亡時對 {m} 米內的所有敵人造成 {pct}% 地系傷害，並在 {sec} 秒後原地復活繼續戰鬥（不算戰鬥失敗）；冷卻 {cd} 秒' }, { id: 'warGodBody', name: '戰神體', cost: 300, fx: { sec: 1, secPer: 0.1 }, goldBase: 10000000, goldGrow: 1.5, desc: '你在 {sec} 秒內損失的生命百分比，會在接下來 {sec} 秒內的反擊中一併附加到敵人身上' }] },
  bloodrage: { name: '嗜血狂怒', emoji: '💢', range: '', cd: 60, cost: 25, tiers: [{ name: '嗜血狂怒', unlock: { reinc: 0, lv: 400 }, cost: 25, fx: { pct: 20, pctPer: 2, sec: 8 }, goldBase: 100000, goldGrow: 1.5, desc: '攻速額外 +{pct}%（乘算，不受攻速上限限制），持續 {sec} 秒' }, { name: '狂暴', unlock: { reinc: 0, lv: 450 }, cost: 40, fx: { pct: 20, pctPer: 2 }, goldBase: 200000, goldGrow: 1.5, desc: '狂怒期間爆擊傷害額外 +{pct}%（乘算）' }, { name: '狂怒', unlock: { reinc: 0, lv: 500 }, cost: 60, fx: { pct: 20, pctPer: 2 }, goldBase: 400000, goldGrow: 1.5, desc: '狂怒期間總傷害額外 +{pct}%（乘算）' }, { name: '狂化連殺', unlock: { reinc: 0, lv: 550 }, cost: 80, fx: { add: 0.5, addPer: 0.1, kill: 0.1, killMax: 5 }, goldBase: 800000, goldGrow: 1.5, desc: '狂怒期間基礎連擊數 +{add}，且每擊殺 1 個敵人再 +{kill}（累計上限 +{killMax}；不足 1 次的部分以機率觸發）' }, { name: '嗜血反震', unlock: { reinc: 0, lv: 600 }, cost: 100, fx: { pct: 20, pctPer: 2 }, goldBase: 1500000, goldGrow: 1.5, desc: '狂怒期間反震傷害提高 {pct}%（乘算，可與其它反震加成疊加）' }, { name: '血飲術', unlock: { reinc: 0, lv: 650 }, cost: 140, fx: { pct: 30, pctPer: 3, self: 1, m: 80 }, goldBase: 3000000, goldGrow: 1.5, desc: '狂怒期間傷害額外提高 {pct}%（乘算），但 {m} 米內的敵人每次受傷都會使你損失最大生命 {self}%（直接扣血，無法被護盾吸收）' }, { name: '狂血盛宴', unlock: { reinc: 0, lv: 700 }, cost: 240, fx: { sec: 0.5, pct: 1, pctPer: 0.1, count: 1 }, goldBase: 5000000, goldGrow: 1.5, desc: '狂怒期間每擊殺 1 個敵人，持續時間延長 {sec} 秒；且生命值每減少 1%，傷害額外 +{pct}%（乘算，無限疊加），每 1 連擊數使普攻可同時攻擊 1 個敵人（無限疊加）' }], ult: [{ id: 'slayerAdvent', name: '殺神降臨', cost: 300, fx: { pct: 100, pctPer: 10, m: 8 }, goldBase: 10000000, goldGrow: 1.5, desc: '狂怒期間普攻傷害 +{pct}%，且同時對目標周圍 {m} 米內的所有敵人造成傷害' }, { id: 'warGodRoll', name: '戰神屠錄', cost: 300, fx: { pct: 4, maxStacks: 100, maxStacksPer: 10 }, goldBase: 10000000, goldGrow: 1.5, desc: '狂怒期間你無法獲得護盾，但每殺死 1 個敵人使你造成的所有傷害 +{pct}%，最多 {maxStacks} 層，持續到你死亡為止' }, { id: 'asuraFist', name: '阿修羅霸王拳', cost: 300, fx: { pct: 500, pctPer: 50, sec: 1, secPer: 0.1, gap: 10 }, goldBase: 10000000, goldGrow: 1.5, desc: '每 {gap} 秒，你造成的所有傷害 +{pct}%，持續 {sec} 秒' }] },
  fireball: { name: '火球術', emoji: '🔥', range: '', dmgType: 'magic', elem: 'fire', cd: 14, cost: 40, tiers: [{ name: '火球術', unlock: { reinc: 0, lv: 1 }, cost: 40, fx: { pct: 150, pctPer: 15, m: 6, castM: 30 }, goldBase: 100000, goldGrow: 1.5, desc: '射出一顆火球（射程 {castM} 米），命中時爆炸，對目標及 {m} 米內的敵人造成 {pct}% 火焰傷害' }, { name: '燃燒', unlock: { reinc: 0, lv: 1 }, cost: 60, fx: { dotPct: 20, dotPctPer: 2, dotSec: 5, dotGap: 0.5 }, goldBase: 200000, goldGrow: 1.5, desc: '被火球擊中的敵人陷入燃燒：每 {dotGap} 秒造成技能傷害 {dotPct}% 的火焰傷害，持續 {dotSec} 秒' }, { name: '火球爆裂', unlock: { reinc: 0, lv: 50 }, cost: 80, fx: { pct: 30, pctPer: 3, count: 3, m: 20 }, goldBase: 400000, goldGrow: 1.5, desc: '火球爆炸後分裂出 {count} 個小火球，射向目標 {m} 米內的敵人，每個造成原始火球 {pct}% 的傷害' }, { name: '強化燃燒', unlock: { reinc: 0, lv: 100 }, cost: 100, fx: { gap: 0.4, gapPer: -0.015 }, goldBase: 800000, goldGrow: 1.5, desc: '燃燒的作用間隔縮短至 {gap} 秒（跳得更快＝總傷更高）' }, { name: '爆燃', unlock: { reinc: 0, lv: 150 }, cost: 140, fx: { pct: 50, pctPer: 5, count: 2, m: 12 }, goldBase: 1500000, goldGrow: 1.5, desc: '燃燒結束或敵人死亡時爆炸，對我方 {m} 米內的 {count} 個敵人造成該敵人整段燃燒累積傷害 {pct}% 的傷害' }, { name: '火焰增幅', unlock: { reinc: 0, lv: 200 }, cost: 200, fx: { pct: 0.25, pctPer: 0.025, sec: 4, m: 20 }, goldBase: 3000000, goldGrow: 1.5, desc: '我方 {m} 米內每有 1 次燃燒作用，你的火焰傷害 +{pct}%，持續 {sec} 秒（無限疊加，每次疊加時重置時間）' }, { name: '殞石術', unlock: { reinc: 0, lv: 250 }, cost: 320, fx: { pct: 250, pctPer: 25, count: 3, m: 15, castM: 20 }, goldBase: 5000000, goldGrow: 1.5, desc: '改為召喚 {count} 顆巨大火殞石從天而降（射程 {castM} 米），每顆對目標 {m} 米內的敵人造成 {pct}% 火焰傷害，且殞石造成的燃燒傷害為 2 倍（第 2~6 階效果仍然生效）' }] },
  firepillar: { name: '火龍捲', emoji: '🌋', range: '', dmgType: 'magic', elem: 'fire', cd: 14, cost: 40, tiers: [{ name: '火龍捲', unlock: { reinc: 0, lv: 50 }, cost: 40, fx: { pct: 60, pctPer: 6, hits: 5, m: 3, castM: 30, sec: 2.5 }, goldBase: 100000, goldGrow: 1.5, desc: '在敵人腳下召喚一道火柱（射程 {castM} 米），對目標 {m} 米內的敵人連續造成 {hits} 段傷害，每段 {pct}% 火焰傷害（全程約 {sec} 秒）' }, { name: '龍捲噴發', unlock: { reinc: 0, lv: 100 }, cost: 60, fx: { pct: 10, pctPer: 2 }, goldBase: 200000, goldGrow: 1.5, desc: '火柱的傷害範圍擴大 {pct}%' }, { name: '雙重龍捲', unlock: { reinc: 0, lv: 150 }, cost: 80, fx: { count: 2, pct: 20, pctPer: 2, m: 20 }, goldBase: 400000, goldGrow: 1.5, desc: '可同時對 {m} 米內的 {count} 個目標施放火柱，且火焰傷害額外 +{pct}%' }, { name: '燃燒', unlock: { reinc: 0, lv: 200 }, cost: 100, fx: { chance: 20, chancePer: 2, dotPct: 20, dotSec: 4, dotGap: 0.5 }, goldBase: 800000, goldGrow: 1.5, desc: '火柱每次作用時有 {chance}% 機率使敵人燃燒：每 {dotGap} 秒造成技能傷害 {dotPct}% 的火焰傷害，持續 {dotSec} 秒' }, { name: '烈焰衝擊', unlock: { reinc: 0, lv: 250 }, cost: 140, fx: { pct: 100, pctPer: 10, m: 6 }, goldBase: 1500000, goldGrow: 1.5, desc: '火龍捲或火牆消失時，對周圍 {m} 米內的敵人造成 {pct}% 火焰傷害' }, { name: '重生', unlock: { reinc: 0, lv: 300 }, cost: 200, fx: { chance: 25, chancePer: 2.5, m: 20 }, goldBase: 3000000, goldGrow: 1.5, desc: '火柱消失後有 {chance}% 機率在我方 {m} 米內的敵人身上重生' }, { name: '無限火牆', unlock: { reinc: 0, lv: 350 }, cost: 320, fx: { count: 3, hits: 8, pct: 100, pctPer: 10, len: 18, wid: 6, respawn: 1 }, goldBase: 5000000, goldGrow: 1.5, desc: '改為施放 {count} 道火牆（橫向 {len}×{wid} 米），每道造成 {hits} 段 {pct}% 火焰傷害；每道火牆消失後再召喚 1 道（僅能再觸發一次；第 2~6 階效果仍然生效）' }] },
  firehunt: { name: '火狩', emoji: '☄️', range: '3*3', dmgType: 'magic', elem: 'fire', cd: 26, cost: 40, tiers: [{ name: '火狩', unlock: { reinc: 0, lv: 100 }, cost: 40, fx: { pct: 100, pctPer: 10, count: 2, sec: 4, m: 8, rps: 0.455, castM: 8 }, goldBase: 100000, goldGrow: 1.5, desc: '召喚 {count} 團火狩環繞自身（環繞半徑 {m} 米、每秒 {rps} 圈），碰到敵人即命中一次，每次造成 {pct}% 火焰傷害，持續 {sec} 秒' }, { name: '強化火狩', unlock: { reinc: 0, lv: 150 }, cost: 60, fx: { pct: 15, pctPer: 1.5 }, goldBase: 200000, goldGrow: 1.5, desc: '火狩的體積與環繞範圍同步擴大 {pct}%' }, { name: '伴生火狩', unlock: { reinc: 0, lv: 200 }, cost: 80, fx: { chance: 20, chancePer: 2, m: 1 }, goldBase: 400000, goldGrow: 1.5, desc: '火狩命中時有 {chance}% 機率在其後方 {m} 米處伴生一團火狩（每團只能伴生一次，伴生出的不再伴生）' }, { name: '三重火狩', unlock: { reinc: 0, lv: 250 }, cost: 100, fx: { count: 3, pct: 120, pctPer: 12, sec: 4 }, goldBase: 800000, goldGrow: 1.5, desc: '改為召喚 {count} 團火狩，每團造成 {pct}% 火焰傷害，持續 {sec} 秒' }, { name: '極速火狩', unlock: { reinc: 0, lv: 300 }, cost: 140, fx: { pct: 25, pctPer: 2.5 }, goldBase: 1500000, goldGrow: 1.5, desc: '火狩的旋轉速度 +{pct}%' }, { name: '再生', unlock: { reinc: 0, lv: 350 }, cost: 200, fx: { sec: 0.4, secPer: 0.04 }, goldBase: 3000000, goldGrow: 1.5, desc: '火狩每擊殺 1 個敵人，全部火狩的持續時間延長 {sec} 秒' }, { name: '狩神之舞', unlock: { reinc: 0, lv: 400 }, cost: 320, fx: { rings: 2, pct: 150, pctPer: 15, sec: 6, m: 6 }, goldBase: 5000000, goldGrow: 1.5, desc: '改為一次施放 {rings} 道火狩（外圈距內圈 {m} 米、兩道旋轉方向相反），每團造成 {pct}% 火焰傷害、出現時自帶伴生，持續 {sec} 秒' }] },
  rockarmor: { name: '岩甲術', emoji: '🪨', range: '', dmgType: 'magic', elem: 'earth', cd: 25, cost: 40, tiers: [{ name: '岩甲術', unlock: { reinc: 0, lv: 150 }, cost: 40, fx: { pct: 30, pctPer: 3, sec: 10, castM: 30 }, goldBase: 100000, goldGrow: 1.5, desc: '施放岩甲強化自身，獲得最大生命值 {pct}% 的岩甲護盾，持續 {sec} 秒' }, { name: '強化岩甲', unlock: { reinc: 0, lv: 200 }, cost: 40, fx: { pct: 20, pctPer: 2 }, goldBase: 200000, goldGrow: 1.5, desc: '進一步強化岩甲，額外獲得最大生命值 {pct}% 的岩甲護盾（與第 1 階累加）' }, { name: '岩甲尖刺', unlock: { reinc: 0, lv: 250 }, cost: 40, fx: { pct: 5, pctPer: 0.5 }, goldBase: 400000, goldGrow: 1.5, desc: '岩甲護盾存在期間，攻擊你的敵人會遭受你最大生命值 {pct}% 的地系傷害（獨立於反震，兩者各自結算）' }, { name: '護盾增幅', unlock: { reinc: 0, lv: 300 }, cost: 40, fx: { pct: 15, pctPer: 1.5 }, goldBase: 800000, goldGrow: 1.5, desc: '主動型被動（裝配到技能列即恆時生效）：你獲得的所有護盾效率額外 +{pct}%（乘算）' }, { name: '岩之再生', unlock: { reinc: 0, lv: 350 }, cost: 40, fx: { pct: 1, pctPer: 0.1 }, goldBase: 1500000, goldGrow: 1.5, desc: '岩甲護盾存在期間，你每減少 1% 生命值即獲得最大生命 {pct}% 的護盾' }, { name: '岩甲增幅', unlock: { reinc: 0, lv: 400 }, cost: 40, fx: { pct: 0.5, pctPer: 0.05, max: 30, sec: 3 }, goldBase: 3000000, goldGrow: 1.5, desc: '岩甲護盾存在期間，你每減少 1% 護盾即獲得 {pct}% 傷害增幅（乘算），最多疊 {max} 層，持續 {sec} 秒' }, { name: '天地逆返', unlock: { reinc: 0, lv: 450 }, cost: 40, fx: { pct: 30, pctPer: 3 }, goldBase: 5000000, goldGrow: 1.5, desc: '岩甲護盾存在期間，護盾剩餘量越低則傷害減免越高，護盾歸零時最高額外 +{pct}% 傷害減免（乘算）' }] },
  mire: { name: '泥沼術', emoji: '🟤', range: '12*12', dmgType: 'magic', elem: 'earth', cd: 18, cost: 40, tiers: [{ name: '泥沼術', unlock: { reinc: 0, lv: 200 }, cost: 40, fx: { sec: 4, secPer: 0.4, castM: 20, move: 30, aspd: 50 }, goldBase: 100000, goldGrow: 1.5, desc: '在敵人腳下召喚一片 12×12 米的沼澤（射程 {castM} 米），沼澤中的敵人陷入緩速（移動速度 -{move}%、攻速 -{aspd}%），持續 {sec} 秒' }, { name: '虛弱', unlock: { reinc: 0, lv: 250 }, cost: 40, fx: { pct: 15, pctPer: 1.5 }, goldBase: 200000, goldGrow: 1.5, desc: '受泥沼緩速影響的敵人，受到的傷害提高 {pct}%' }, { name: '毒沼術', unlock: { reinc: 0, lv: 300 }, cost: 40, fx: { dotPct: 25, dotPctPer: 2.5, dotGap: 0.5 }, goldBase: 400000, goldGrow: 1.5, desc: '沼澤持續放出毒氣：沼澤中的敵人每 {dotGap} 秒受到魔法攻擊 {dotPct}% 的毒性傷害' }, { name: '毒沼增生', unlock: { reinc: 0, lv: 350 }, cost: 40, fx: { add: 1, addPer: 0.1, m: 40 }, goldBase: 800000, goldGrow: 1.5, desc: '沼澤結束時傳染給 {m} 米內較近的敵人，最多傳染 {add} 次（不足 1 次的部分以機率觸發）' }, { name: '沼澤漫延', unlock: { reinc: 0, lv: 400 }, cost: 40, fx: { sec: 6, pct: 40, pctPer: 4, growSec: 4 }, goldBase: 1500000, goldGrow: 1.5, desc: '沼澤持續時間提高至 {sec} 秒，且在 {growSec} 秒內逐步擴大，最大擴增 {pct}%' }, { name: '重力泥沼', unlock: { reinc: 0, lv: 450 }, cost: 40, fx: { move: 50, aspd: 75, pct: 20, pctPer: 2 }, goldBase: 3000000, goldGrow: 1.5, desc: '緩速強化為移動速度 -{move}%、攻速 -{aspd}%，且受影響目標受到的傷害再提高 {pct}%（與第 2 階累加）' }, { name: '熔岩沼', unlock: { reinc: 0, lv: 500 }, cost: 40, fx: { sec: 8, pct: 20, pctPer: 2, dotPct: 70, dotPctPer: 7, dotGap: 0.4 }, goldBase: 5000000, goldGrow: 1.5, desc: '沼澤轉變為岩漿：持續時間提高至 {sec} 秒、範圍再擴增 {pct}%（與第 5 階累加），其中的目標每 {dotGap} 秒額外受到魔法攻擊 {dotPct}% 的火焰傷害' }] },
  earthguard: { name: '大地守護', emoji: '🌍', range: '', dmgType: 'magic', elem: 'earth', cd: 0, cost: 0, tiers: [{ name: '大地守護', unlock: { reinc: 0, lv: 250 }, fx: { pct: 10, pctPer: 1, hp: 20, hpPer: 2 }, goldBase: 100000, goldGrow: 1.5, desc: '主動型被動：自身傷害減免額外 +{pct}%、生命上限額外 +{hp}%（皆為乘算）' }, { name: '大地祝福', unlock: { reinc: 0, lv: 300 }, cost: 25, fx: { pct: 25, pctPer: 2.5 }, goldBase: 200000, goldGrow: 1.5, desc: '全屬性傷害額外 +{pct}%（與所有屬性增傷效果為額外的乘法計算）' }, { name: '生命再生', unlock: { reinc: 0, lv: 350 }, cost: 25, fx: { pct: 100, pctPer: 10, drain: 50, drainPer: 5 }, goldBase: 400000, goldGrow: 1.5, desc: '生命回復額外 +{pct}%、吸血額外 +{drain}%（皆與原屬性為額外的乘法計算）' }, { name: '魔力再生', unlock: { reinc: 0, lv: 400 }, cost: 25, fx: { pct: 100, pctPer: 10, drain: 50, drainPer: 5 }, goldBase: 800000, goldGrow: 1.5, desc: '法力回復額外 +{pct}%、吸魔額外 +{drain}%（皆與原屬性為額外的乘法計算）' }, { name: '魔法盾', unlock: { reinc: 0, lv: 450 }, cost: 25, fx: { pct: 30, pctPer: 3 }, goldBase: 1500000, goldGrow: 1.5, desc: '你的生命減少時，其中 {pct}% 改由消耗法力承擔（法力不足時只轉換付得起的部分，餘額仍扣生命）' }, { name: '生命反射之盾', unlock: { reinc: 0, lv: 500 }, cost: 25, fx: { pct: 1, pctPer: 0.1, m: 20, count: 1 }, goldBase: 3000000, goldGrow: 1.5, desc: '你每消耗 1% 生命或護盾，{m} 米內的 {count} 個敵人同步損失 {pct}% 最大生命' }, { name: '天地共生', unlock: { reinc: 0, lv: 550 }, cost: 25, fx: { pct: 20, pctPer: 8, sec: 5, cd: 60, cdPer: -3 }, goldBase: 5000000, goldGrow: 1.5, desc: '死亡時原地復活並回復 {pct}% 生命，復活後 {sec} 秒無敵；此招自身冷卻 {cd} 秒（顯示於技能格）' }] },
  chainlightning: { name: '連鎖閃電', emoji: '⚡', range: '', dmgType: 'magic', elem: 'lightning', cd: 18, cost: 40, tiers: [{ name: '連鎖閃電', unlock: { reinc: 0, lv: 300 }, cost: 40, fx: { pct: 150, pctPer: 15, count: 4, m: 30, castM: 30 }, goldBase: 100000, goldGrow: 1.5, desc: '丟出一道閃電鏈（射程 {castM} 米），在最多 {count} 個目標間彈射（每段彈射範圍 {m} 米），每擊造成 {pct}% 雷電傷害' }, { name: '強化閃電', unlock: { reinc: 0, lv: 350 }, cost: 40, fx: { pct: 50, pctPer: 5 }, goldBase: 200000, goldGrow: 1.5, desc: '強化閃電威力，閃電鏈傷害進一步 +{pct}% 雷電傷害' }, { name: '雷鳴術', unlock: { reinc: 0, lv: 400 }, cost: 40, fx: { add: 1, addPer: 0.1 }, goldBase: 400000, goldGrow: 1.5, desc: '被閃電鏈擊中的敵人額外再受到 {add} 次雷電傷害（不足 1 次的部分以機率觸發）' }, { name: '強化連鎖', unlock: { reinc: 0, lv: 450 }, cost: 40, fx: { add: 1, addPer: 0.2 }, goldBase: 800000, goldGrow: 1.5, desc: '閃電鏈的彈射數額外 +{add} 次（不足 1 次的部分以機率觸發）' }, { name: '電殛擴散', unlock: { reinc: 0, lv: 500 }, cost: 40, fx: { pct: 25, pctPer: 2.5, count: 1, m: 6 }, goldBase: 1500000, goldGrow: 1.5, desc: '閃電鏈每次彈射時，額外對 {m} 米內的 {count} 個敵人造成閃電鏈 {pct}% 的雷電傷害' }, { name: '雷幻身', unlock: { reinc: 0, lv: 550 }, cost: 40, fx: { pct: 50, pctPer: 5 }, goldBase: 3000000, goldGrow: 1.5, desc: '閃電鏈傷害額外 +{pct}% 雷電傷害；沒有其它彈射目標時可用自身當中繼點繼續彈射（彈到自身不消耗彈射數）' }, { name: '雷電暴風', unlock: { reinc: 0, lv: 600 }, cost: 40, fx: { count: 3, add: 1, addPer: 0.1, pct: 100, pctPer: 10, chance: 20 }, goldBase: 5000000, goldGrow: 1.5, desc: '同時發射 {count} 道閃電鏈，彈射數額外 +{add} 次，且閃電傷害額外 +{pct}%；每次彈射有 {chance}% 機率生成 1 條閃電鏈' }] },
  thunderstrike: { name: '落雷術', emoji: '🌩️', range: '', dmgType: 'magic', elem: 'lightning', cd: 14, cost: 40, tiers: [{ name: '落雷術', unlock: { reinc: 0, lv: 350 }, cost: 40, fx: { pct: 200, pctPer: 20, count: 2, gap: 0.2, castM: 30 }, goldBase: 100000, goldGrow: 1.5, desc: '對 {castM} 米內的 {count} 個目標降下落雷（每道間隔 {gap} 秒），每道造成 {pct}% 雷電傷害' }, { name: '落雷連鎖', unlock: { reinc: 0, lv: 400 }, cost: 40, fx: { add: 1, addPer: 0.1 }, goldBase: 200000, goldGrow: 1.5, desc: '攻擊目標額外 +{add} 個（不足 1 個的部分以機率觸發）' }, { name: '雙重落雷', unlock: { reinc: 0, lv: 450 }, cost: 40, fx: { add: 1, addPer: 0.1 }, goldBase: 400000, goldGrow: 1.5, desc: '對每個目標的攻擊次數額外 +{add} 次（不足 1 次的部分以機率觸發）' }, { name: '閃電增幅', unlock: { reinc: 0, lv: 500 }, cost: 40, fx: { pct: 100, pctPer: 10 }, goldBase: 800000, goldGrow: 1.5, desc: '進一步強化落雷傷害，額外 +{pct}% 雷電傷害' }, { name: '雷電脈衝', unlock: { reinc: 0, lv: 550 }, cost: 40, fx: { sec: 1.5, secPer: 0.15, count: 2, m: 6 }, goldBase: 1500000, goldGrow: 1.5, desc: '落雷落地時產生衝擊波，震暈目標本身與 {m} 米內共 {count} 個敵人 {sec} 秒' }, { name: '迅雷重生', unlock: { reinc: 0, lv: 600 }, cost: 40, fx: { chance: 20, chancePer: 2, max: 5 }, goldBase: 3000000, goldGrow: 1.5, desc: '每道落雷結束後有 {chance}% 機率再產生 1 道落雷（同一次施放最多再生 {max} 道）' }, { name: '殛道落電', unlock: { reinc: 0, lv: 650 }, cost: 40, fx: { mult: 2, pct: 50, pctPer: 5, m: 6 }, goldBase: 5000000, goldGrow: 1.5, desc: '落雷擊中時對目標 {m} 米內的所有敵人造成傷害；攻擊次數與目標數量 ×{mult}，且命中暈眩中的敵人時傷害額外 +{pct}%（與原傷害乘算）' }] },
  thunderorb: { name: '雷球', emoji: '🔵', range: '6*6', dmgType: 'magic', elem: 'lightning', cd: 20, cost: 40, tiers: [{ name: '雷球', unlock: { reinc: 0, lv: 400 }, cost: 40, fx: { pct: 50, pctPer: 5, count: 2, gap: 0.35, sec: 2, m: 3, speed: 6, castM: 30 }, goldBase: 100000, goldGrow: 1.5, desc: '召喚 {count} 個雷球緩慢飛向目標（射程 {castM} 米、飛行速度 {speed} 米/秒），途中每 {gap} 秒對半徑 {m} 米內的所有敵人造成 {pct}% 雷電傷害，抵達後停留 {sec} 秒才消散' }, { name: '擴增雷球', unlock: { reinc: 0, lv: 450 }, cost: 40, fx: { pct: 15, pctPer: 1.5 }, goldBase: 200000, goldGrow: 1.5, desc: '雷球的體積擴大 {pct}%' }, { name: '多重雷球', unlock: { reinc: 0, lv: 500 }, cost: 40, fx: { add: 1, addPer: 0.1 }, goldBase: 400000, goldGrow: 1.5, desc: '雷球數量額外 +{add} 個（不足 1 個的部分以機率觸發）' }, { name: '環體電球', unlock: { reinc: 0, lv: 550 }, cost: 40, fx: { count: 2, pct: 100, pctPer: 10, sec: 6, m: 8, rps: 0.7 }, goldBase: 800000, goldGrow: 1.5, desc: '額外召喚 {count} 個電球環繞自身（環繞半徑 {m} 米、每秒 {rps} 圈），碰到敵人即命中一次，每次造成 {pct}% 雷電傷害，持續 {sec} 秒' }, { name: '強化雷球', unlock: { reinc: 0, lv: 600 }, cost: 40, fx: { pct: 30, pctPer: 3 }, goldBase: 1500000, goldGrow: 1.5, desc: '所有雷球與電球的雷電傷害額外 +{pct}%' }, { name: '伴生雷球', unlock: { reinc: 0, lv: 650 }, cost: 40, fx: { chance: 15, chancePer: 1.5, sec: 2 }, goldBase: 3000000, goldGrow: 1.5, desc: '環體電球命中時有 {chance}% 機率在該處生成一個靜止雷球，持續 {sec} 秒（每次作用只判定一次機率）' }, { name: '雷殞天落', unlock: { reinc: 0, lv: 700 }, cost: 40, fx: { count: 2, pct: 300, pctPer: 30, m: 15, sec: 3 }, goldBase: 5000000, goldGrow: 1.5, desc: '額外召喚 {count} 個巨大雷球從天而降，各對 {m} 米內的敵人造成 {pct}% 雷電傷害，並以衝擊波擊暈 {sec} 秒' }] },
  icearrow: { name: '寒冰箭', emoji: '❄️', range: '', dmgType: 'magic', elem: 'ice', cd: 18, cost: 40, tiers: [{ name: '寒冰箭', unlock: { reinc: 0, lv: 450 }, cost: 40, fx: { pct: 250, pctPer: 25, count: 2, deg: 15, castM: 30, speed: 45 }, goldBase: 100000, goldGrow: 1.5, desc: '朝前方射出 {count} 支寒冰箭，每支箭夾角 {deg} 度（射程 {castM} 米、飛行速度 {speed} 米／秒），每支對 1 個敵人造成 {pct}% 寒冰傷害' }, { name: '寒霜箭', unlock: { reinc: 0, lv: 500 }, cost: 40, fx: { frostPct: 50, frostPctPer: 5, stacks: 1 }, goldBase: 200000, goldGrow: 1.5, desc: '被寒冰箭擊中的敵人附加 {stacks} 層寒霜狀態：每跳造成寒冰箭傷害 {frostPct}% 的寒冰傷害，每層使移動與攻速下降，疊滿層數時凍結' }, { name: '冰系強化', unlock: { reinc: 0, lv: 550 }, cost: 40, fx: { pct: 100, pctPer: 10 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化寒冰箭，額外 +{pct}% 寒冰傷害（與第 1 階累加）' }, { name: '貫穿冰箭', unlock: { reinc: 0, lv: 600 }, cost: 40, fx: { m: 10, mPer: 2 }, goldBase: 800000, goldGrow: 1.5, desc: '寒冰箭改為貫穿攻擊，貫穿路徑上的所有敵人，貫穿長度 {m} 米（不足以打到主目標時自動延長到主目標）' }, { name: '冰箭散射', unlock: { reinc: 0, lv: 650 }, cost: 40, fx: { add: 1, addPer: 0.1 }, goldBase: 1500000, goldGrow: 1.5, desc: '射出的寒冰箭數量額外 +{add} 支（不足 1 支的部分以機率觸發）' }, { name: '寒霜凍結', unlock: { reinc: 0, lv: 700 }, cost: 40, fx: { stacks: 1, stacksPer: 0.4 }, goldBase: 3000000, goldGrow: 1.5, desc: '寒冰箭射中帶寒霜狀態的敵人時，立即再疊 {stacks} 層寒霜，並造成該敵人寒霜剩餘的全部寒冰傷害（不足 1 層的部分以機率觸發）' }, { name: '寒冰爆裂箭', unlock: { reinc: 0, lv: 750 }, cost: 40, fx: { pct: 400, pctPer: 40, sec: 6, m: 6, chaseM: 30, bodyM: 1.5, gap: 0.1, waves: 3, waveGap: 0.3 }, goldBase: 5000000, goldGrow: 1.5, desc: '寒冰爆裂箭連射 {waves} 波，每波間隔 {waveGap} 秒；寒冰箭變為追蹤冰箭，在 {chaseM} 米內來回穿梭追擊敵人 {sec} 秒（碰到才算一次命中）；敵人的凍結結束時產生冰爆，對其周圍 {m} 米內的所有敵人造成 {pct}% 寒冰傷害' }] },
  waterball: { name: '水流彈', emoji: '💧', range: '', dmgType: 'magic', elem: 'ice', cd: 14, cost: 40, tiers: [{ name: '水流彈', unlock: { reinc: 0, lv: 500 }, cost: 40, fx: { pct: 200, pctPer: 20, castM: 30, arcM: 8 }, goldBase: 100000, goldGrow: 1.5, desc: '丟出一顆水彈砸向敵人（射程 {castM} 米、拋物線離地最高 {arcM} 米），造成 {pct}% 寒冰傷害' }, { name: '寒冰逆轉', unlock: { reinc: 0, lv: 550 }, cost: 40, fx: { pct: 20, pctPer: 2, sec: 6 }, goldBase: 200000, goldGrow: 1.5, desc: '被水流彈擊中的敵人強制轉變為寒冰屬性，且受到的寒冰傷害 +{pct}%，持續 {sec} 秒' }, { name: '寒流彈', unlock: { reinc: 0, lv: 600 }, cost: 40, fx: { frostPct: 50, frostPctPer: 20, stacks: 1 }, goldBase: 400000, goldGrow: 1.5, desc: '被水流彈擊中的敵人附加 {stacks} 層寒霜狀態：每跳造成水流彈傷害 {frostPct}% 的寒冰傷害' }, { name: '寒流爆散', unlock: { reinc: 0, lv: 650 }, cost: 40, fx: { m: 8, bounce: 2, bouncePer: 0.2 }, goldBase: 800000, goldGrow: 1.5, desc: '水流彈改為範圍攻擊，對目標 {m} 米內的所有敵人造成傷害，並再彈射 {bounce} 次（不足 1 次的部分以機率觸發）' }, { name: '寒霜擴散', unlock: { reinc: 0, lv: 700 }, cost: 40, fx: { chance: 25, chancePer: 2.5, m: 10, count: 1 }, goldBase: 1500000, goldGrow: 1.5, desc: '寒霜狀態每次作用時有 {chance}% 機率擴散至目標 {m} 米內的 {count} 個敵人' }, { name: '三重流水', unlock: { reinc: 0, lv: 750 }, cost: 40, fx: { add: 1, addPer: 0.2 }, goldBase: 3000000, goldGrow: 1.5, desc: '朝隨機目標額外丟出 {add} 顆水流彈（不足 1 顆的部分以機率觸發）' }, { name: '水龍捲', unlock: { reinc: 0, lv: 800 }, cost: 40, fx: { count: 4, hits: 6, pct: 100, pctPer: 10, m: 5, side: 10, frozen: 2, gap: 0.35 }, goldBase: 5000000, goldGrow: 1.5, desc: '額外在我方 {side}×{side} 米正方形的四個頂點召喚 {count} 道水龍捲（傷害半徑 {m} 米），每道造成連續 {hits} 段 {pct}% 寒冰傷害，且對凍結中的敵人傷害為 {frozen} 倍' }] },
  frostnova: { name: '冰霜新星', emoji: '🧊', range: '', dmgType: 'magic', elem: 'ice', cd: 20, cost: 40, tiers: [{ name: '冰霜新星', unlock: { reinc: 0, lv: 550 }, cost: 40, fx: { pct: 150, pctPer: 5, m: 12, castM: 12, stacks: 2, frostPct: 50 }, goldBase: 100000, goldGrow: 1.5, desc: '對周圍 {m} 米內的敵人釋放冰霜新星，造成 {pct}% 寒冰傷害並附加 {stacks} 層寒霜狀態（寒霜每跳造成新星傷害 {frostPct}% 的寒冰傷害）' }, { name: '冰霜衝擊', unlock: { reinc: 0, lv: 600 }, cost: 40, fx: { m: 13, mPer: 0.6, castM: 13, castMPer: 0.6, pct: 50, pctPer: 5 }, goldBase: 200000, goldGrow: 1.5, desc: '冰霜新星的範圍擴展至 {m} 米，且寒冰傷害額外 +{pct}%' }, { name: '寒冰體', unlock: { reinc: 0, lv: 650 }, cost: 40, fx: { stacks: 1 }, goldBase: 400000, goldGrow: 1.5, desc: '施放冰霜新星後的 6 秒內，攻擊你的敵人有 25% 機率被附加 {stacks} 層寒霜狀態' }, { name: '極致寒霜', unlock: { reinc: 0, lv: 700 }, cost: 40, fx: { dmgPct: 40, dmgPctPer: 4, durPct: 40, durPctPer: 4 }, goldBase: 800000, goldGrow: 1.5, desc: '所有來源的寒霜狀態傷害提高 {dmgPct}%，且持續時間增加 {durPct}%' }, { name: '三重新星', unlock: { reinc: 0, lv: 750 }, cost: 40, fx: { add: 1, addPer: 0.1, m: 3 }, goldBase: 1500000, goldGrow: 1.5, desc: '冰霜新星的施放次數額外 +{add} 次，且每次釋放的範圍再 +{m} 米（不足 1 次的部分以機率觸發）' }, { name: '死亡新星', unlock: { reinc: 0, lv: 800 }, cost: 40, fx: { chance: 35, chancePer: 6.5 }, goldBase: 3000000, goldGrow: 1.5, desc: '帶寒霜狀態的敵人死亡時有 {chance}% 機率再釋放 1 次冰霜新星' }, { name: '暴風雪', unlock: { reinc: 0, lv: 850 }, cost: 40, fx: { pct: 100, pctPer: 10, gap: 0.4, sec: 8, side: 24 }, goldBase: 5000000, goldGrow: 1.5, desc: '額外召喚 1 道暴風雪籠罩天空，對 {side}×{side} 米範圍內的敵人每 {gap} 秒造成 {pct}% 寒冰傷害，暴風雪跟隨我方移動，持續 {sec} 秒' }] },
  windblade: { name: '風刃', emoji: '🍃', range: '4*8', dmgType: 'magic', elem: 'wind', cd: 18, cost: 40, tiers: [{ name: '風刃', unlock: { reinc: 0, lv: 600 }, cost: 40, fx: { pct: 200, pctPer: 20, castM: 30, m: 80, speed: 18 }, goldBase: 100000, goldGrow: 1.5, desc: '朝前方射出一道弧形風刃（射程 {castM} 米、飛行速度 {speed} 米/秒），貫穿飛行路徑 {m} 米上的所有敵人，各造成 {pct}% 風系傷害' }, { name: '巨型風刃', unlock: { reinc: 0, lv: 650 }, cost: 40, fx: { size: 30, sizePer: 3 }, goldBase: 200000, goldGrow: 1.5, desc: '風刃的體積 +{size}%（判定範圍與特效同步放大）' }, { name: '雙重風刃', unlock: { reinc: 0, lv: 700 }, cost: 40, fx: { pct: 30, pctPer: 30 }, goldBase: 400000, goldGrow: 1.5, desc: '同時向前方與後方各射出一道風刃，且風刃傷害額外 +{pct}%（與第 1 階累加）' }, { name: '亂披風', unlock: { reinc: 0, lv: 750 }, cost: 40, fx: { pct: 30, pctPer: 3, deg: 30, lenM: 3, widthM: 6 }, goldBase: 800000, goldGrow: 1.5, desc: '風刃射出時同時朝其兩側各 {deg} 度發射 1 道小型風刃（體積 {lenM}×{widthM} 米、同樣貫穿全場），每道造成原風刃 {pct}% 的傷害' }, { name: '追跡風刃', unlock: { reinc: 0, lv: 800 }, cost: 40, fx: { sec: 4, secPer: 0.3, chaseM: 30, gap: 0.1 }, goldBase: 1500000, goldGrow: 1.5, desc: '小型風刃不再向前射出，改為在 {chaseM} 米內隨機追擊敵人 {sec} 秒，對路徑上的所有敵人造成傷害（碰到才算一次命中）' }, { name: '狂風碎裂', unlock: { reinc: 0, lv: 850 }, cost: 40, fx: { move: 60, gap: 0.6, gapPer: -0.03, pct: 50, m: 6 }, goldBase: 3000000, goldGrow: 1.5, desc: '風刃命中的敵人移動速度 -{move}%；風刃並在飛行途中每 {gap} 秒對半徑 {m} 米內的敵人造成風刃 {pct}% 的傷害（不含小型風刃）' }, { name: '暴風真空刃', unlock: { reinc: 0, lv: 900 }, cost: 40, fx: { pct: 40, pctPer: 40, count: 3, directions: 4, gap: 0.2 }, goldBase: 5000000, goldGrow: 1.5, desc: '改為朝前後左右 {directions} 個方向各連續射出 {count} 道風刃（每道間隔 {gap} 秒，小型風刃同步發射），且風刃傷害額外 +{pct}%' }] },
  vacuumslash: { name: '真空斬', emoji: '🌀', range: '', dmgType: 'magic', elem: 'wind', cd: 18, cost: 40, tiers: [{ name: '真空斬', unlock: { reinc: 0, lv: 650 }, cost: 40, fx: { pct: 250, pctPer: 25, count: 3, m: 6, castM: 6 }, goldBase: 100000, goldGrow: 1.5, desc: '朝前方 {m} 米範圍內的 {count} 名敵人揮出一道真空斬擊，造成 {pct}% 風系傷害' }, { name: '真空爆震', unlock: { reinc: 0, lv: 700 }, cost: 40, fx: { hits: 1, hitsPer: 0.1 }, goldBase: 200000, goldGrow: 1.5, desc: '真空斬會爆發出震波，額外造成 {hits} 次傷害（不足 1 次的部分以機率觸發）' }, { name: '風切', unlock: { reinc: 0, lv: 750 }, cost: 40, fx: { cutPct: 50, cutPctPer: 5, move: 80, hit: 50, sec: 4, gap: 0.5 }, goldBase: 400000, goldGrow: 1.5, desc: '被真空斬擊中的敵人附加風切狀態：移動速度 -{move}%、命中率 -{hit}%，且每 {gap} 秒受到真空斬傷害 {cutPct}% 的風系傷害，持續 {sec} 秒' }, { name: '迴旋斬', unlock: { reinc: 0, lv: 800 }, cost: 40, fx: { pct: 30, pctPer: 3, m: 6 }, goldBase: 800000, goldGrow: 1.5, desc: '真空斬改為對自身周圍 {m} 米內的所有敵人造成傷害，且造成的傷害額外 +{pct}%' }, { name: '迴旋三重奏', unlock: { reinc: 0, lv: 850 }, cost: 40, fx: { add: 2, addPer: 0.2, m: 6 }, goldBase: 1500000, goldGrow: 1.5, desc: '迴旋斬額外連續施展 {add} 次，每次的範圍再擴大 {m} 米（不足 1 次的部分以機率觸發）' }, { name: '無限風切', unlock: { reinc: 0, lv: 900 }, cost: 40, fx: { stacks: 3, pct: 50, pctPer: 5 }, goldBase: 3000000, goldGrow: 1.5, desc: '風切狀態可堆疊至 {stacks} 層，每多 1 層使風切每跳額外造成 {pct}% 的風系傷害' }, { name: '虛空斬', unlock: { reinc: 0, lv: 950 }, cost: 40, fx: { pct: 400, pctPer: 40, count: 4, sec: 6, m: 6, growM: 4, bodyM: 6, rps: 1 }, goldBase: 5000000, goldGrow: 1.5, desc: '額外斬出 {count} 道虛空斬擊：以自身為中心從半徑 {m} 米起每秒擴大 {growM} 米、{count} 道皆順時針繞行 {rps} 圈，對碰到的敵人造成 {pct}% 風系傷害，持續 {sec} 秒' }] },
  stormbarrier: { name: '暴風屏障', emoji: '🌪️', range: '', dmgType: 'magic', elem: 'wind', cd: 24, cost: 40, tiers: [{ name: '暴風屏障', unlock: { reinc: 0, lv: 700 }, cost: 40, fx: { shield: 1, shieldPer: 1, red: 10, redPer: 1, sec: 8, gap: 0.5, castM: 30 }, goldBase: 100000, goldGrow: 1.5, desc: '對自身施加暴風屏障：每 {gap} 秒獲得最大生命 {shield}% 的護盾，且傷害減免 +{red}%（乘算，只與風系類型的減免相加總），持續 {sec} 秒' }, { name: '暴風撕裂', unlock: { reinc: 0, lv: 750 }, cost: 40, fx: { pct: 50, pctPer: 5, m: 8 }, goldBase: 200000, goldGrow: 1.5, desc: '暴風屏障每次作用時，對自身半徑 {m} 米內的敵人造成 {pct}% 風系傷害' }, { name: '亂風切', unlock: { reinc: 0, lv: 800 }, cost: 40, fx: { count: 1, countPer: 0.1 }, goldBase: 400000, goldGrow: 1.5, desc: '暴風屏障每次作用時，對周圍的 {count} 個敵人附加風切狀態（不足 1 個的部分以機率觸發）' }, { name: '暴風之刃', unlock: { reinc: 0, lv: 850 }, cost: 40, fx: { chance: 15, chancePer: 1.5 }, goldBase: 800000, goldGrow: 1.5, desc: '暴風屏障作用中受到傷害時，有 {chance}% 機率射出 1 道貫穿風刃（【風刃】第 1 階的效果，不含其後續進化）' }, { name: '風切擴散', unlock: { reinc: 0, lv: 900 }, cost: 40, fx: { count: 1, countPer: 0.1, m: 10 }, goldBase: 1500000, goldGrow: 1.5, desc: '風切狀態結束後擴散至 {m} 米內的 {count} 個敵人（不足 1 個的部分以機率觸發）' }, { name: '颶風屏障', unlock: { reinc: 0, lv: 950 }, cost: 40, fx: { shield: 2, shieldPer: 0.2 }, goldBase: 3000000, goldGrow: 1.5, desc: '暴風屏障每次作用時額外獲得最大生命 {shield}% 的護盾（與第 1 階相加）' }, { name: '暴風神體', unlock: { reinc: 0, lv: 1000 }, cost: 40, fx: { red: 99, sec: 2, secPer: 0.2, pct: 100, pctPer: 10 }, goldBase: 5000000, goldGrow: 1.5, desc: '施放暴風屏障時同時召喚風暴之神附體：{sec} 秒內傷害減免 +{red}%，且自身的風系傷害額外 ×(1+{pct}%)' }] }
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
  if (SKILL2_RT && SKILL2_RT.rock && SKILL2_RT.rock.pEnt && SKILL2_RT.rock.pEnt.buffs) {
    delete SKILL2_RT.rock.pEnt.buffs.sgRockArmor;
    delete SKILL2_RT.rock.pEnt.buffs.sgRockAmp;
  }
  if (SKILL2_RT && SKILL2_RT.barrier && SKILL2_RT.barrier.pEnt && SKILL2_RT.barrier.pEnt.buffs) {
    delete SKILL2_RT.barrier.pEnt.buffs.sgStormBarrier;
    delete SKILL2_RT.barrier.pEnt.buffs.sgStormGod;
  }
  /* 超神【戰神屠錄】的疊層增益設計為「持續到死亡為止」，狀態表因此給了一個
     單場戰鬥走不完的持續時間——回收的唯一時機就是這裡（死亡／讀檔／進出塔）。
     少了這一段，玩家死一次之後那疊層會原封不動帶進下一場。 */
  if (SKILL2_RT && SKILL2_RT.warGod && SKILL2_RT.warGod.pEnt && SKILL2_RT.warGod.pEnt.buffs) {
    delete SKILL2_RT.warGod.pEnt.buffs.sgWarGodKill;
  }
  SKILL2_RT = {
    storm: null, // 暴風之舞化身狀態：{ until, nextAt, gap, tgt }（tgt 為當前衝鋒目標實體）
    projectiles: [], // 飛出斬擊／貫穿突刺的執行期飛行物（不入存檔）
    meteors: [], // 殞石落地佇列：{ at, victims, burnSpec, ... }（不入存檔）
    grounds: [], // 地板場域（火龍捲／火牆）的執行期實例（不入存檔）
    groundSeq: 0, // 給顯示層辨識同一道持續場域；不入存檔
    orbits: [], // 環繞場域（火狩）的執行期實例：釘在玩家身上、持續旋轉（不入存檔）
    rage: null,  // 嗜血狂怒爆發狀態：{ until, pEnt, killCombo }（pEnt＝施放時的玩家實體，
                 // 供血飲術反噬定位；killCombo＝期間擊殺累積的連擊數加成，結束歸零）
    frenzy: null, // 狂暴之舞狀態：{ until, pEnt, levels }
    rock: null,  // 岩甲術狀態：{ until, pEnt, base }（base＝施放當下的護盾總量＝T6／T7 的分母）
    barrier: null, // 暴風屏障狀態：{ until, pEnt, nextAt, gap, floatSel }（nextAt＝下一拍護盾／撕裂的時刻）
    ultAuto: {},  // 超神進化的自動施放節拍：{ <群組id>: 下一次自動施放的時刻 }（不入存檔）
    bloodDomain: { venomAt: 0, vfxAt: 0 }, // 血刃斬永久領域的節拍：作用時刻與範圍提示重畫時刻（不入存檔）
    deathDefer: null, // 傳奇【不屈之誓】的延後死亡：{ until }（不入存檔）
    counter: null,   // 反擊的累計器：{ hits, oath, wrath, holy, loss[] }
                     // loss＝超神【戰神體】的失血滑動視窗 [{ at, pct }]（不入存檔）
    lastStand: null, // 超神【不屈鬥魂】的倒地期：{ reviveAt, pEnt, done }（不入存檔）
    warGod: null,    // 超神【戰神屠錄】疊層增益的持有者：{ pEnt }
                     // ——那個增益「持續到死亡為止」，狂怒本身早就回收了也還在，
                     // 所以得另外記住掛在誰身上，resetSkill2RT 才收得回來
    asuraFist: 0     // 超神【阿修羅霸王拳】的下一次發動時刻（不入存檔）
  };
}
resetSkill2RT(); // 載入即建立初始狀態

/* ===========================================================================
   等級與狀態存取
   =========================================================================== */

/* ---- 階解鎖門檻（參數表 Skills2「解鎖轉生/等級」欄，格式「轉生次數|等級」）----
   進度比較是「轉生數優先，同轉生數才比等級」：轉生會把人物等級打回 1，
   若改用「兩者都要達標」比較，每次轉生都會把整份技能表重新鎖上。
   使用者決策 2026-08-16：達到 1 轉即視為 0 轉的門檻全部通過，2 轉視為 1 轉以前全通過，以此類推。
   要卡「1 轉之後才開放」的玄階，門檻就填 1|200。 */
function sgTierUnlockedBy(unlock, level, reinc) {
  if (!unlock) return true;                                    // 留白＝無門檻
  var needR = Math.max(0, Number(unlock.reinc) || 0);
  var r = Math.max(0, Number(reinc) || 0);
  if (r !== needR) return r > needR;
  return Math.max(0, Number(level) || 0) >= Math.max(0, Number(unlock.lv) || 0);
}

/* 解鎖門檻的顯示文字（升級失敗訊息與技能面板共用同一份措辭）。 */
function sgUnlockText(unlock) {
  if (!unlock) return '';
  var r = Math.max(0, Number(unlock.reinc) || 0);
  return (r > 0 ? r + ' 轉 ' : '') + Math.max(0, Number(unlock.lv) || 0) + ' 級';
}

/* 解鎖進度來源：Worker 端讀 G；主執行緒沒有 G，由呼叫端把面板快照裡的等級／轉生數傳進來。
   兩邊都取不到時回傳 null＝不套用門檻——寧可維持接線前的行為，也不要憑空把技能鎖住。 */
function sgUnlockProgress(prog) {
  if (prog && (prog.level !== undefined || prog.reinc !== undefined)) {
    return { level: Number(prog.level) || 0, reinc: Number(prog.reinc) || 0 };
  }
  /* 「進度不明」與「進度為 0」必須分開：讀不到等級時當成 0 級，會把整份技能表鎖死。
     正式流程的 G.player.level 一定存在（js/player.js 建檔就寫入），會走到這裡回 null 的
     只有還沒接上存檔的情境（部分測試替身、面板快照缺欄位）——那時維持不套門檻。 */
  if (typeof G !== 'undefined' && G && G.player &&
      (G.player.level !== undefined || G.player.reincarnations !== undefined)) {
    return { level: Number(G.player.level) || 0, reinc: Number(G.player.reincarnations) || 0 };
  }
  return null;
}

/* 生效等級（純函式，主執行緒 UI 與 Worker 共用）：
   raw ＝ 存檔的 levels 字典（G.player.skills2.levels 或面板快照），可為 null。
   prog ＝ 解鎖進度 { level, reinc }；主執行緒必須傳（面板快照的 skills2.progress），
          Worker 端可省略（自己讀 G）。
   正規化：整數、夾 0..上限、第 1 階恆至少 Lv.1、未達解鎖門檻的階視為 0、
   前一階未達 Lv.1 時後續階視為 0。
   ⚠️ 未解鎖只是「視為 Lv.0」，不會動到存檔裡已投入的等級：達到門檻就原樣回來。 */
function sgEffectiveLevels(raw, gid, prog) {
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
  /* 解鎖門檻先套：未解鎖的階一律歸 0，**含第 1 階的預設開啟**——
     否則每個群組都是一開局就 Lv.1 可施放，表上「突刺 0|1、火狩 0|100」就沒有意義了。 */
  var prg = sgUnlockProgress(prog);
  if (prg) {
    for (i = 0; i < out.length; i++) {
      if (!sgTierUnlockedBy(g.tiers[i] && g.tiers[i].unlock, prg.level, prg.reinc)) out[i] = 0;
    }
  }
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

/* ===========================================================================
   超神進化（第 8 格；三選一 × 10 級）
   ---------------------------------------------------------------------------
   純函式段落與 sgEffectiveLevels 同一個設計：主執行緒（UI）吃面板快照、
   Worker 端吃 G，兩邊呼叫同一支正規化，不會出現「畫面說可以、Worker 說不行」。
   =========================================================================== */

/* 這個群組的三個超神進化選項（沒有＝該群組尚未開放超神進化）。 */
function sgUltDefs(gid) {
  var g = SKILLS2[gid];
  return (g && Object.prototype.toString.call(g.ult) === '[object Array]' && g.ult.length) ? g.ult : null;
}
function sgUltOption(gid, idx) {
  var list = sgUltDefs(gid);
  idx = Math.floor(Number(idx));
  return (list && idx >= 0 && idx < list.length) ? list[idx] : null;
}
/* 選項 id → 索引（存檔存索引，程式判定用 id；表格改排序時只需一次性遷移）。 */
function sgUltIndexOfId(gid, id) {
  var list = sgUltDefs(gid);
  for (var i = 0; list && i < list.length; i++) if (list[i].id === id) return i;
  return -1;
}
/* 解鎖條件：前 7 階全部練滿。使用者決策（2026-08-19）：目前不另設等級／轉生門檻。 */
function sgUltUnlockedBy(gid, lvs) {
  var g = SKILLS2[gid];
  if (!g || !lvs || !sgUltDefs(gid)) return false;
  for (var i = 0; i < g.tiers.length; i++) if ((lvs[i] || 0) < SG_TIER_MAX_LV) return false;
  return true;
}
/* 存檔上「已選的那一個」（不看解鎖條件，UI 要用它顯示玩家選了什麼）。
   回傳 { idx, id, def, lv } 或 null；lv 已夾在 1..上限（存檔壞掉時視為沒選）。 */
function sgUltPickOf(raw, gid) {
  var list = sgUltDefs(gid);
  var rec = (raw && typeof raw === 'object') ? raw[gid] : null;
  if (!list || !rec) return null;
  var idx = Math.floor(Number(rec.pick));
  if (!(idx >= 0 && idx < list.length)) return null;
  var lv = Math.floor(Number(rec.lv) || 0);
  if (!isFinite(lv) || lv < 1) return null;
  return { idx: idx, id: list[idx].id, def: list[idx], lv: Math.min(SG_TIER_MAX_LV, lv) };
}
/* 生效中的超神進化：已選 ＋ 前 7 階仍然全滿（降級後自動失效，與存檔內容無關）。 */
function sgEffectiveUlt(raw, gid, lvs) {
  return sgUltUnlockedBy(gid, lvs) ? sgUltPickOf(raw, gid) : null;
}
/* Worker 端讀取（讀 G）。 */
function skills2Ult(gid) {
  var raw = (typeof G !== 'undefined' && G && G.player && G.player.skills2) ? G.player.skills2.ult : null;
  return sgEffectiveUlt(raw, gid, skills2Levels(gid));
}
/* 施放端的判定入口：這個群組現在生效的超神進化是不是指定的那一個。 */
function sgUlt(gid, id) {
  var u = skills2Ult(gid);
  return (u && u.id === id) ? u : null;
}
/* 超神進化的某個 fx 參數在目前等級的值（沒選中就回 0，呼叫端不必先判 null）。 */
function sgUltVal(u, key) {
  return u ? sgVal(u.def.fx, key, u.lv) : 0;
}
/* 格位索引是不是超神進化那一格（UI／指令共用；沒有超神進化的群組一律回 false）。 */
function sgIsUltSlot(gid, slot) {
  return Math.floor(Number(slot)) === SG_ULT_SLOT && !!sgUltDefs(gid);
}
/* 這個群組的技能面板總格數（7 或 8）。 */
function sgSlotCount(gid) {
  var g = SKILLS2[gid];
  if (!g) return 0;
  return g.tiers.length + (sgUltDefs(gid) ? 1 : 0);
}
/* 天霸風神斬：迴旋斬「改為被動技能」——選中並投資後就不再進入主動施放輪替，
   改由 sgTickUltAutoCast 每 N 秒自動施放。這一支是全專案唯一的判定入口。 */
function skills2ActsPassive(gid) {
  if (skills2IsPassive(gid)) return true;
  return !!sgUlt(gid, 'stormGodSlash');
}

/* 這個群組目前生效的傳奇特效參數（合併後的平坦物件）。
   未載入傳奇模組時（Node vm 單檔測試）回空物件＝沒有任何傳奇特效，行為與改造前相同。
   唯一權威在 js/legendary.js legendarySkill2Mods，本支只是施放端的短名字。 */
/* sgLegend 的「同一拍只算一次」快取。legendarySkill2Mods 會掃整個傳奇特效池、
   而且雙手補償會深拷貝整個 fx，放在 resolveHit／playerDefCfg 這種一拍呼叫數十次的
   路徑上太貴。同一個 GT 之內裝備不可能改變，因此以 GT 當鍵快取一拍即可；
   跨拍自動失效，另外再比一次屬性版本，連同一拍內換裝也會立刻失效（見下方 stamp）。
   施放端那種一拍只跑一次的冷路徑仍直接用 sgLegend，不必經過這裡。 */
var SG_LEGEND_TICK_CACHE = { at: -1, stamp: null, map: null };
function sgLegendTick(gid) {
  var st = (typeof getStats === 'function') ? getStats() : null;
  /* 版本印記＝目前屬性快取裡那個 legendaryEffects 物件本身。屬性一重算就換一個新物件，
     所以同一拍之內換裝也會立刻失效，不會回傳上一套裝備的合併結果。 */
  var stamp = st ? st.legendaryEffects : null;
  if (SG_LEGEND_TICK_CACHE.at !== GT || SG_LEGEND_TICK_CACHE.stamp !== stamp || !SG_LEGEND_TICK_CACHE.map) {
    SG_LEGEND_TICK_CACHE.at = GT;
    SG_LEGEND_TICK_CACHE.stamp = stamp;
    SG_LEGEND_TICK_CACHE.map = {};
  }
  var m = SG_LEGEND_TICK_CACHE.map;
  if (!m[gid]) m[gid] = sgLegend(gid);
  return m[gid];
}

function sgLegend(gid) {
  return ((typeof legendarySkill2Mods === 'function') ? legendarySkill2Mods(gid) : null) || {};
}

/* ---- 修羅亂舞（雙刀亂舞超神進化）：裝備規則的唯一判定入口 ----
   這是全專案唯一一個「技能狀態決定裝備規則」的效果，所以判定只寫在這裡：
   可裝欄位（js/data.js equipSlotsForItem）、副手佔用（slotBlockedByTwoHand）、
   穿戴互斥（js/player.js equipItem）與屬性聚合（js/formula.js computeStats）全部呼叫這一支。
   條件有二，缺一不可：
     ・雙刀亂舞的超神進化選的是修羅亂舞且仍生效（前 7 階全滿，降級即自動失效）
     ・雙刀亂舞**裝配在技能列上**——使用者決策 2026-08-20：卸下該技能後副手武器立刻不生效
   讀 G＝Worker 端權威。主執行緒沒有 G，面板一律自行以快照算好後傳參覆寫
  （js/data.js 的 asuraOverride 參數），不會出現「畫面說可以、Worker 說不行」。 */
function skills2AsuraDualWield() {
  return !!(skills2Equipped('dualdance') && sgUlt('dualdance', 'asuraDance'));
}
/* 修羅亂舞給雙手武器的詞條效果加成%（沒生效＝0）。 */
function skills2AsuraAffixPct() {
  var u = skills2AsuraDualWield() ? sgUlt('dualdance', 'asuraDance') : null;
  return u ? sgUltVal(u, 'pct') : 0;
}

/* ---- 新版技能狀態異動後的統一收尾 ----
   為什麼屬性快取也要失效：超神進化【修羅亂舞】的生效條件是「選了它 ＋ 前 7 階全滿 ＋
   裝配在技能列上」，因此**任何**一階的升降、選擇的增刪都可能開關它，進而改變 computeStats
  （副手的雙手武器計不計入、雙手詞條要不要加成）。與其在每個異動點各自判斷是不是 dualdance，
   一律失效最便宜，也最不會漏——這裡少一個呼叫點，症狀是「面板數字停在舊值」而且沒有任何錯誤訊息。 */
/* 目前這一場戰鬥的玩家實體。血刃斬在高塔一樣可以施放（技能排程器野外／高塔共用），
   寫死 FIELD.player 的話高塔裡會取到待命中的野外實體：扣的血不影響塔內玩家，
   還會在 finishTowerFight 被整個蓋掉——等於【毒血祭】的代價在高塔白拿。
   判定與 js/legendary.js legendaryCurrentPlayer 同一條：塔戰進行中優先取 TOWER.player。 */
function sgCurrentPlayerEnt() {
  if (typeof legendaryCurrentPlayer === 'function') return legendaryCurrentPlayer();
  if (typeof G !== 'undefined' && G && G.tower && G.tower.active &&
      typeof TOWER !== 'undefined' && TOWER.player) return TOWER.player;
  return (typeof FIELD !== 'undefined' && FIELD && FIELD.player) ? FIELD.player : null;
}

function sgAfterSkillChange() {
  if (typeof markStatsDirty === 'function') markStatsDirty();
  if (typeof UI !== 'undefined' && UI.dirty) { UI.dirty.skills = true; UI.dirty.header = true; }
}

/* ---- 「你造成的所有傷害提高」的唯一加總入口 ----
   目前四個來源：潛力【時空凝滯】allDmgUp、超神進化【死亡收割者】sgDeathReaper、
   超神進化【殺神領域】sgSlayerMark、傳奇【不屈之誓】sgDeathDefer。
   普攻（js/combat.js playerAtkCfg）與新版技能（sgAtkCfg）都讀這一支——
   兩邊各自列舉的話，下次新增來源必然會漏掉其中一邊。 */
function skills2AllDamageUpPct(pEnt) {
  if (!pEnt || typeof buffVal !== 'function') return 0;
  return buffVal(pEnt, 'allDmgUp') + buffVal(pEnt, 'sgDeathReaper') +
    buffVal(pEnt, 'sgSlayerMark') + buffVal(pEnt, 'sgDeathDefer') +
    buffVal(pEnt, 'sgCounterWrath') + buffVal(pEnt, 'sgBurnBlood') +
    buffVal(pEnt, 'sgWarGodKill') + buffVal(pEnt, 'sgAsuraFist');
}

/* fx 參數在指定等級的值：<鍵> + <鍵>Per × 等級。等級至少以 1 計。
   <鍵> 是「不含任何升級效果」的底值：Lv.1 就已經吃到 1 級升級效果，
   練滿 SG_TIER_MAX_LV 級＝底值 + 增量×SG_TIER_MAX_LV（設計文檔的滿級值即以此為準）。 */
function sgVal(fx, key, lv) {
  return (Number(fx[key]) || 0) + (Number(fx[key + 'Per']) || 0) * Math.max(1, Number(lv) || 1);
}

/* 群組初始矩形範圍：表格 range 使用「長*寬」（米）文字格式；
   後續升級倍率與追加距離仍由各技能程式控制。格式不合法時回傳 0，讓呼叫端使用既有退化值。 */
function sgRange(range) {
  var m = String(range == null ? '' : range).trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*\*\s*([0-9]+(?:\.[0-9]+)?)$/);
  if (!m) return { length: 0, width: 0 };
  return { length: Number(m[1]) || 0, width: Number(m[2]) || 0 };
}

/* 天霸風神斬：範圍倍率同時套用在施放閘門與迴旋斬的實際斬擊幾何，
   避免畫面顯示能打到、起手卻被近戰距離擋下，或只放大特效而沒有放大傷害路徑。 */
function skills2CleaveRangeScale(lvs) {
  var u = sgUlt('cleave', 'stormGodSlash');
  var pct = u ? sgUltVal(u, 'range') : 0;
  if (lvs && lvs[1] > 0 && SKILLS2.cleave && SKILLS2.cleave.tiers[1]) {
    pct += sgVal(SKILLS2.cleave.tiers[1].fx, 'range', lvs[1]);
  }
  return 1 + Math.max(0, Number(pct) || 0) / 100;
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
    var fx = g.tiers[i].fx;
    if (!fx || !(Number(fx.castM) > 0)) continue;
    /* 射程比照其他 fx 欄位支援每級成長（castMPer）：自身範圍型技能（冰霜新星）的
       施放距離就是它自己的作用半徑，而半徑會隨等級長大——若射程停在底值，
       高等級時會出現「範圍打得到、卻不准施放」的死角。
       既有群組都沒有定義 castMPer，sgVal 對它們的回傳值與改造前完全相同。 */
    var v = sgVal(fx, 'castM', lvs ? lvs[i] : 1);
    if (isFinite(v) && v > 0) m = v;
  }
  if (!(m > 0)) {
    var melee = (typeof bfMeleeRange === 'function') ? bfMeleeRange() : 0;
    return gid === 'cleave' ? melee * skills2CleaveRangeScale(lvs) : melee;
  }
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

/* 暈眩塗抹的唯一入口：BOSS 控場免疫與敵人韌性抗性都在這裡擋掉，
   各技能只負責決定「要不要暈、暈多久」。
   回傳**實際暈到的秒數**（0＝沒暈到）：控場遞減會在 applyEffect 內縮短時間，
   寒霜的凍結標記必須跟著這個實際值，否則會出現「標記著凍結卻早就能行動」的敵人。
   數值回傳對既有呼叫端相容（>0 為真、0 為假）。 */
function sgTryStun(target, sec) {
  if (!target || target.hp <= 0 || !(sec > 0)) return 0;
  if (typeof isBossControlImmune === 'function' && isBossControlImmune(target)) return 0;
  if (typeof resistCtrl === 'function' && typeof monsterDefCfg === 'function' &&
      resistCtrl(monsterDefCfg(target))) return 0;
  if (typeof applyStatus !== 'function') return 0;
  var applied = applyStatus(target, 'stun', { dur: sec });
  /* applyEffect 回傳實際持續秒數；遞減歸零時回 false。舊版狀態寫入器若回傳
     true（沒有秒數資訊）就沿用表定值，行為與改造前相同。 */
  if (applied === false || applied === 0) return 0;
  return (typeof applied === 'number' && applied > 0) ? applied : sec;
}

/* 這個目標現在正在暈眩嗎（殛道落雷的增傷判定）。 */
function sgIsStunned(target) {
  return !!(target && typeof effectActive === 'function' && effectActive(target, 'stun'));
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

/* 超神進化的升級費用：曲線與各階相同（goldBase × goldGrow^目前等級）。
   optIdx 留白＝取目前已選的那一個；還沒選時由呼叫端（選擇畫面）指定要試算哪一個。 */
function skills2UltCost(gid, optIdx, curLv) {
  var opt = sgUltOption(gid, optIdx);
  if (!opt) return 0;
  var grow = Number(opt.goldGrow) || 1;
  return Math.floor((Number(opt.goldBase) || 0) * Math.pow(grow, Math.max(0, Number(curLv) || 0)));
}

/* 群組總投資等級（前端「同一個技能不斷變強」的顯示用）。 */
function sgTotalLevel(lvs) {
  var s = 0;
  for (var i = 0; i < (lvs ? lvs.length : 0); i++) s += lvs[i];
  return s;
}

/* ---- 指令實作（Worker 端；回傳 null＝成功、字串＝拒絕原因） ---- */

/* 超神進化的存檔節點（惰性建立；沒有投資過的群組不佔存檔欄位）。 */
function sgUltStore() {
  if (!G.player.skills2) G.player.skills2 = { levels: {} };
  if (!G.player.skills2.ult || typeof G.player.skills2.ult !== 'object') G.player.skills2.ult = {};
  return G.player.skills2.ult;
}

/* 三選一：選定即視為學會 Lv.1（付第 1 級的金幣）。
   已經選過就不給改——要換選項必須先把它降回 Lv.0（skills2UltDowngrade 會清掉選擇）。 */
function skills2UltPick(group, optIdx) {
  var g = SKILLS2[group];
  if (!g) return '未知技能群組';
  if (!sgUltDefs(group)) return '此技能尚未開放超神進化';
  var lvs = skills2Levels(group);
  if (!sgUltUnlockedBy(group, lvs)) return '需先將前 ' + g.tiers.length + ' 階全部練滿才能選擇超神進化';
  if (sgUltPickOf(sgUltStore(), group)) return '已選擇超神進化；需先將其降至 Lv.0 才能重新選擇';
  optIdx = Math.floor(Number(optIdx));
  var opt = sgUltOption(group, optIdx);
  if (!opt) return '未知的超神進化選項';
  var cost = skills2UltCost(group, optIdx, 0);
  if ((G.player.gold || 0) < cost) return '金幣不足';
  G.player.gold -= cost;
  sgUltStore()[group] = { pick: optIdx, lv: 1 };
  /* 修羅亂舞會改變屬性聚合（副手雙手武器是否生效、雙手詞條加成幾%），
     因此超神進化的任何異動都必須讓屬性快取失效——不然玩家選／卸之後
     _statsCache 會沿用舊值，而且沒有任何機制會偵測到。 */
  if (typeof markStatsDirty === 'function') markStatsDirty();
  sgAfterSkillChange();
  return null;
}

/* 超神進化升級（第 8 格的「升級」；尚未選擇時要先走 skills2UltPick）。 */
function skills2UltLearn(group) {
  var g = SKILLS2[group];
  if (!g) return '未知技能群組';
  if (!sgUltDefs(group)) return '此技能尚未開放超神進化';
  var lvs = skills2Levels(group);
  if (!sgUltUnlockedBy(group, lvs)) return '需先將前 ' + g.tiers.length + ' 階全部練滿才能投資超神進化';
  var cur = sgUltPickOf(sgUltStore(), group);
  if (!cur) return '請先選擇一個超神進化效果';
  if (cur.lv >= SG_TIER_MAX_LV) return '此階已達等級上限';
  var cost = skills2UltCost(group, cur.idx, cur.lv);
  if ((G.player.gold || 0) < cost) return '金幣不足';
  G.player.gold -= cost;
  sgUltStore()[group] = { pick: cur.idx, lv: cur.lv + 1 };
  /* 修羅亂舞會改變屬性聚合（副手雙手武器是否生效、雙手詞條加成幾%），
     因此超神進化的任何異動都必須讓屬性快取失效——不然玩家選／卸之後
     _statsCache 會沿用舊值，而且沒有任何機制會偵測到。 */
  if (typeof markStatsDirty === 'function') markStatsDirty();
  sgAfterSkillChange();
  return null;
}

/* 超神進化降級；降到 Lv.0 就整個清掉選擇（＝可以重新三選一，比照各階「降級不退金幣」）。 */
function skills2UltDowngrade(group) {
  if (!SKILLS2[group]) return '未知技能群組';
  var cur = sgUltPickOf(sgUltStore(), group);
  if (!cur) return '尚未選擇超神進化';
  if (cur.lv <= 1) { delete sgUltStore()[group]; }
  else sgUltStore()[group] = { pick: cur.idx, lv: cur.lv - 1 };
  /* 修羅亂舞會改變屬性聚合（副手雙手武器是否生效、雙手詞條加成幾%），
     因此超神進化的任何異動都必須讓屬性快取失效——不然玩家選／卸之後
     _statsCache 會沿用舊值，而且沒有任何機制會偵測到。 */
  if (typeof markStatsDirty === 'function') markStatsDirty();
  sgAfterSkillChange();
  return null;
}

function skills2Learn(group, tier) {
  var g = SKILLS2[group];
  if (!g) return '未知技能群組';
  tier = Math.floor(Number(tier));
  if (sgIsUltSlot(group, tier)) return skills2UltLearn(group);
  if (!(tier >= 0 && tier < g.tiers.length)) return '未知階數';
  var lvs = skills2Levels(group);
  if (tier > 0 && lvs[tier - 1] < 1) return '前一階需至少 Lv.1 才能解鎖此階';
  /* 解鎖門檻排在循序解鎖之後：兩者都沒滿足時，「先去投前一階」比「先去練等」更可行。 */
  var unlock = g.tiers[tier].unlock;
  var prg = sgUnlockProgress(null);
  if (prg && !sgTierUnlockedBy(unlock, prg.level, prg.reinc)) {
    return '需達到 ' + sgUnlockText(unlock) + '才能解鎖此階';
  }
  if (lvs[tier] >= SG_TIER_MAX_LV) return '此階已達等級上限';
  var cost = skills2UpgradeCost(group, tier, lvs[tier]);
  if ((G.player.gold || 0) < cost) return '金幣不足';
  G.player.gold -= cost;
  lvs[tier]++;
  if (!G.player.skills2) G.player.skills2 = { levels: {} };
  if (!G.player.skills2.levels) G.player.skills2.levels = {};
  G.player.skills2.levels[group] = lvs;
  sgAfterSkillChange();
  return null;
}
function skills2Downgrade(group, tier) {
  var g = SKILLS2[group];
  if (!g) return '未知技能群組';
  tier = Math.floor(Number(tier));
  if (sgIsUltSlot(group, tier)) return skills2UltDowngrade(group);
  if (!(tier >= 0 && tier < g.tiers.length)) return '未知階數';
  var lvs = skills2Levels(group);
  if (tier === 0 && lvs[0] <= 1) return '第 1 階至少保持 Lv.1';
  if (lvs[tier] <= 0) return '此階尚未投資';
  if (lvs[tier] === 1 && tier + 1 < lvs.length && lvs[tier + 1] > 0) return '後續階數已投資，需先將其降至 Lv.0';
  /* 前 7 階任何一階離開滿級，超神進化就失去解鎖條件（sgEffectiveUlt 會自動失效）；
     等級與選擇一律保留在存檔裡，練回滿級就原樣回來——與各階「未達門檻視為 Lv.0」同一條規則。 */
  lvs[tier]--;
  if (!G.player.skills2) G.player.skills2 = { levels: {} };
  if (!G.player.skills2.levels) G.player.skills2.levels = {};
  G.player.skills2.levels[group] = lvs;
  sgAfterSkillChange();
  return null;
}

/* skills 面板投影（純讀取，不得寫入 G——建面板不能變成寫存檔）。 */
function skills2PanelView() {
  /* progress＝算這份等級時用的解鎖進度。主執行緒沒有 G，只能靠這一份；
     不送出去的話，UI 會以「沒有進度＝不套門檻」重算，畫面顯示已解鎖、Worker 卻擋著升級。 */
  var prg = sgUnlockProgress(null);
  var out = {
    tierMax: SG_TIER_MAX_LV, levels: {}, ult: {},
    progress: prg ? { level: prg.level, reinc: prg.reinc } : null
  };
  var ultRaw = (G && G.player && G.player.skills2) ? G.player.skills2.ult : null;
  for (var gid in SKILLS2) {
    out.levels[gid] = skills2Levels(gid);
    /* 超神進化送「存檔上的選擇」而不是「生效中的選擇」：解鎖條件由 UI 端以同一支
       sgUltUnlockedBy 重算，玩家把某一階降級時畫面才看得到「已選但暫時失效」。 */
    var pick = sgUltPickOf(ultRaw, gid);
    if (pick) out.ult[gid] = { pick: pick.idx, lv: pick.lv };
  }
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
/* 疊層型的「受到的傷害提高」：傳奇【千瘡百孔】與超神【暗影絕殺者】。
   兩者都是掛在敵人身上的增益鍵（值＝單層值 × 層數），因此直接讀 buffVal 即可，
   不必知道目前疊了幾層。 */
function skill2StackVulnPct(target) {
  if (!target || typeof buffVal !== 'function') return 0;
  return Math.max(0, buffVal(target, 'sgThrustVuln')) + Math.max(0, buffVal(target, 'sgSoulRend'));
}

function skill2VulnACfg(aCfg, target) {
  /* 「目標受到的傷害提高」目前有四個來源：血刃斬【虛弱】、泥沼術【虛弱／重力泥沼】、
     傳奇【千瘡百孔】與超神【暗影絕殺者】。全部加算進同一個 totalDmgPct，
     收斂在這一支——呼叫端（普攻 doPlayerAttack ／新版技能 sgAtkCfg）不必逐一補判。 */
  var pct = skill2VulnPct(target) +
    ((typeof skill2MireVulnPct === 'function') ? skill2MireVulnPct(target) : 0) +
    skill2StackVulnPct(target);
  if (pct > 0) aCfg.totalDmgPct = (aCfg.totalDmgPct || 0) + pct;
  /* 只針對「某一個屬性」的受傷增幅走另一條路：水流彈【寒冰逆轉】的 +X% 寒冰傷害
     不能混進 totalDmgPct（那會連同一次攻擊的火／雷段一起放大）。
     本支同時服務普攻端（combat.js doPlayerAttack）與新版技能端（sgAtkCfg），
     因此兩邊都認得這個增幅，不必各補一次。 */
  if (typeof skill2IceAmpACfg === 'function') aCfg = skill2IceAmpACfg(aCfg, target);
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
/* 狂怒的攻速加成％＝本體第 1 階 ＋ 傳奇【英勇氣概】。
   sgBloodrage 增益的效果值就是這個數字（skill2AspdFactor 直接讀增益），
   而這個增益有兩個寫入點：施放（sgCastBloodrage）與擊殺延時的刷新（sgRageOnKill）。
   兩邊都必須經過本支——只改其中一邊的話，狂怒期間第一次擊殺就會把傳奇加成刷掉。 */
function sgRageAspdPct(lvs) {
  var base = sgVal(SKILLS2.bloodrage.tiers[0].fx, 'pct', lvs[0]);
  return base + Math.max(0, Number(sgLegendTick('bloodrage').rageAspdPct) || 0);
}

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
    /* 傳奇【狂熱者】：用目前可用的連擊數放大【狂血盛宴】的「每 1% 失血」係數，
       而不是另外再乘一個乘區——設計文檔寫的是「提高狂血盛宴的傷害增加」。 */
    var perPct = sgVal(t[6].fx, 'pct', lvs[6]) * (1 + sgRageZealotBonus() / 100);
    if (missPct > 0) mult *= 1 + missPct * perPct / 100;
  }
  return mult;
}

/* 普攻的追加目標。兩個來源合併後去重（兩者的範圍會重疊，同一個敵人不得挨兩次）：
     ・狂血盛宴（第 7 階）：每 1 連擊數再從主目標附近選 1 個額外敵人。
       不設技能層上限，實際目標數受附近存活敵人限制。
     ・超神【殺神降臨】：主目標周圍 m 米內的所有敵人，數量只受半徑限制。
   主攻擊本身仍鎖定主目標。掛點：combat.js 野外普攻入口。 */
function skill2RageBasicAttackTargets(primary, enemies) {
  if (!primary || primary.hp <= 0 || !Array.isArray(enemies)) return primary ? [primary] : [];
  var lvs = skill2RageLevels();
  if (!lvs || typeof bfNearestOthers !== 'function') return [primary];
  var targets = [primary];
  /* 超神【殺神降臨】：目標周圍 m 米內的**所有**敵人都要吃到，不設數量上限
     ——上限交給半徑決定，所以 count 直接給敵群長度。 */
  var advent = sgUlt('bloodrage', 'slayerAdvent');
  if (advent) {
    var inRange = bfNearestOthers(primary, enemies, enemies.length, bfMeterPx(sgUltVal(advent, 'm')));
    for (var ai = 0; ai < inRange.length; ai++) targets.push(inRange[ai]);
  }
  if (lvs[6] > 0) {
    var st = getStats();
    var comboHits = Math.max(0, Number(st && st.comboHits) || 0);
    // 狂化連殺提供的期間連擊數也屬於玩家目前可用的連擊數。
    if (typeof skill2ComboBonus === 'function') comboHits += Math.max(0, Number(skill2ComboBonus()) || 0);
    if (typeof skill2FrenzyComboBonus === 'function') comboHits += Math.max(0, Number(skill2FrenzyComboBonus()) || 0);
    var perCombo = Number(SKILLS2.bloodrage.tiers[6].fx.count) || 1;
    var extras = Math.floor(comboHits * perCombo);
    if (extras > 0) {
      var nearbyGap = (typeof bfMeterPx === 'function') ? bfMeterPx(
        (typeof BF_MELEE_METERS === 'number' && BF_MELEE_METERS > 0) ? BF_MELEE_METERS : 5
      ) : 0;
      // 敘述是「每 1 連擊數使普攻可同時攻擊 1 個敵人」，沒有指定最近＝近戰範圍內隨機
      var feast = bfRandomOthers(primary, enemies, extras, nearbyGap, null);
      for (var fi = 0; fi < feast.length; fi++) {
        if (targets.indexOf(feast[fi]) < 0) targets.push(feast[fi]);   // 兩個效果的範圍會重疊，不得重複打
      }
    }
  }
  return targets;
}

/* 嗜血反震（第 5 階）：反震傷害乘算因子。掛點：combat.js playerDefCfg 的 thornsPct。 */
function skill2RageThornsFactor() {
  var lvs = skill2RageLevels();
  if (!lvs || lvs[4] < 1) return 1;
  var factor = 1 + sgVal(SKILLS2.bloodrage.tiers[4].fx, 'pct', lvs[4]) / 100;
  /* 傳奇【屠戮者】：期間每擊殺 1 個敵人疊 1 層，「使嗜血反震效果提高」＝再乘一層，
     不是加進本階的百分比裡（那樣層數會被本階等級稀釋掉）。 */
  var stack = (typeof buffVal === 'function' && SKILL2_RT.rage.pEnt)
    ? buffVal(SKILL2_RT.rage.pEnt, 'sgThornsRage') : 0;
  if (stack > 0) factor *= 1 + stack / 100;
  return factor;
}

/* 傳奇【狂熱者】：每 1 連擊數使【狂血盛宴】的失血係數再提高 rageZealotPct%。
   連擊數的口徑與【狂血盛宴】自己挑追加目標時完全一致（面板值 ＋ 狂化連殺 ＋ 狂暴之舞），
   否則會出現「多打到的目標數」與「加成」對不上的怪現象。 */
function sgRageZealotBonus() {
  var per = Number(sgLegendTick('bloodrage').rageZealotPct) || 0;
  if (!(per > 0)) return 0;
  var st = (typeof getStats === 'function') ? getStats() : null;
  var combo = Math.max(0, Number(st && st.comboHits) || 0);
  if (typeof skill2ComboBonus === 'function') combo += Math.max(0, Number(skill2ComboBonus()) || 0);
  if (typeof skill2FrenzyComboBonus === 'function') combo += Math.max(0, Number(skill2FrenzyComboBonus()) || 0);
  return combo * per;
}

/* 超神【戰神屠錄】：狂怒期間完全無法獲得護盾。
   兩條護盾入口都必須擋（js/formula.js 的 grantShield 直接給予、healPlayer 的溢出轉護盾）
   ——只擋其中一條的話，另一條會把這個代價整個繞過去。 */
function skills2ShieldBlocked() {
  return !!(skill2RageActive() && sgUlt('bloodrage', 'warGodRoll'));
}

/* 護盾封鎖的不變量掃描。上面那兩條入口（grantShield／healPlayer 的溢出）是「明確攔截」，
   讀程式的人一眼就知道代價掛在哪；但護盾在本專案沒有單一收斂點——狀態表的 shield 效果、
   傳奇【聖盾】／【光之護盾】、舊技能的護盾都是直接寫 pEnt.shield，一處一處補既碰不完，
   也擋不住之後新加的來源。所以這裡每拍再掃一次：狂怒期間身上就是不會有護盾。
   連「開狂怒之前先疊好的護盾」也一起清掉——不清的話，玩家只要在施放前把護盾疊滿就能
   整個繞過這個代價（狂血盛宴會讓狂怒隨擊殺無限延長，那層護盾等於一直有效）。 */
function sgTickWarGodShield(ctx) {
  if (!ctx.pEnt || !skills2ShieldBlocked() || !(ctx.pEnt.shield > 0)) return;
  ctx.pEnt.shield = 0;
  if (ctx.pEnt.buffs) delete ctx.pEnt.buffs.shield;   // 狀態表護盾的回收帳本一起清掉
  if (typeof refreshShieldMaxAfterGain === 'function') refreshShieldMaxAfterGain(ctx.pEnt, 0);
  if (typeof UI !== 'undefined' && UI.dirty) UI.dirty.battle = true;
}

/* 超神【殺神降臨】：狂怒期間的**普攻**傷害加成。只掛在 combat.js doPlayerAttack，
   不掛 playerAtkCfg——後者同時服務反擊與新版技能，掛在那裡就變成「所有傷害」了。 */
function skill2RageBasicAtkACfg(aCfg) {
  var u = skill2RageActive() ? sgUlt('bloodrage', 'slayerAdvent') : null;
  if (!u || !aCfg) return aCfg;
  var mult = 1 + sgUltVal(u, 'pct') / 100;
  var out = {};
  for (var k in aCfg) out[k] = aCfg[k];
  out.atk = (Number(out.atk) || 0) * mult;
  if (out.matk) out.matk = out.matk * mult;
  return out;
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
/* 全遊戲唯一的「敵人受傷」收斂點（js/formula.js applyEnemyHpDamage 與 resolveHit 都會呼叫）。
   這裡掛的兩件事互相獨立，任何一件的條件不成立都不得擋住另一件。 */
function skills2OnEnemyDamaged(ent, amount) {
  if (!(amount > 0) || !ent || ent._sgPreview) return; // 預覽命中（legendaryPreviewBasicAttack）不算受傷
  sgBloodrageBackfire(ent);   // 嗜血狂怒【血飲術】反噬
  sgBloodMistDrain(ent);      // 血刃斬傳奇【血霧】吸血
}

/* 嗜血狂怒【血飲術】（T6）：期間範圍內的敵人每次受傷，你也付出一點生命。 */
function sgBloodrageBackfire(ent) {
  var lvs = skill2RageLevels();
  if (!lvs || lvs[5] < 1) return;
  var pEnt = SKILL2_RT.rage.pEnt;
  if (!pEnt || pEnt.hp <= 0) return;
  var fx = SKILLS2.bloodrage.tiers[5].fx;
  if (typeof bfPos === 'function' && bfPos(ent) && typeof bfEntityDistance === 'function' &&
      bfEntityDistance(ent) > bfMeterPx(Number(fx.m) || 80)) return;
  var st = getStats();
  var lg = sgLegendTick('bloodrage');
  var selfDmg = st.hp * (Number(fx.self) || 0) / 100;
  /* 傳奇【血債償還】：代價打折。reducePct 刻意不吃雙手補償（見 js/data.js 的說明），
     因此這裡拿到的就是設計值，不會變成「降低 100%」把整個取捨抹掉。 */
  if (lg.rageSelfCut) {
    var cut = Math.min(100, Math.max(0, Number(lg.rageSelfCut.reducePct) || 0));
    selfDmg = selfDmg * (100 - cut) / 100;
  }
  selfDmg = Math.max(1, Math.round(selfDmg));
  var gmFloor = (typeof GM_TEST !== 'undefined' && GM_TEST && GM_TEST.god) ? 1 : 0;
  pEnt.hp = Math.max(gmFloor, pEnt.hp - selfDmg);
  /* 傳奇【燃血】：每一次生命損失疊 1 層。掛在扣血之後而不是之前，
     語意才是「造成了生命損失」——距離判定沒過的那些不算。 */
  if (lg.rageBurnBlood && typeof applyStatus === 'function') {
    applyStatus(pEnt, 'sgBurnBlood', {
      val: Number(lg.rageBurnBlood.pct) || 0,
      dur: Math.max(0.2, Number(lg.rageBurnBlood.sec) || 4),
      maxStacks: Math.max(1, Math.floor(Number(lg.rageBurnBlood.maxStacks) || 1))
    });
  }
}

/* 傳奇【血霧】：血霧內的敵人每次受傷都回復你的生命（占最大生命 healPct%）。
   掛在「敵人受傷」而不是「血刃斬命中」，是因為設計文檔寫的是「每次受傷」——
   持續傷害、反震、其他技能造成的傷害一律算數。溢出不轉護盾（noShield）：
   這是持續小額吸血，讓它堆成護盾等於白送一層無上限的減傷。 */
function sgBloodMistDrain(ent) {
  /* 效果值就是治療比例（在場域塗標記時定版），因此這裡不必再碰傳奇特效池。 */
  var pct = (typeof buffVal === 'function') ? buffVal(ent, 'sgBloodMist') : 0;
  if (!(pct > 0) || typeof getStats !== 'function' || typeof healPlayer !== 'function') return;
  var pEnt = sgCurrentPlayerEnt();
  if (!pEnt || pEnt.hp <= 0) return;
  var st = getStats();
  healPlayer(pEnt, st.hp * pct / 100, st, { noShield: true });
}

/* 實體身上某個增益鍵是否生效中。buffVal 回的是「數值」，效果值為 0 的純標記狀態
  （血霧壟罩）用它判斷會永遠是假，因此另開這一支只看在不在。 */
function sgHasBuff(ent, key) {
  return !!(ent && ent.buffs && ent.buffs[key] && ent.buffs[key].until > GT);
}

/* 傳奇【血霧】場域的一拍：只塗標記，不造成傷害。標記時間略長於一拍，
   敵人走出血霧後最多再殘留一拍就失效。 */
function sgBloodMistGroundTick(f, victims) {
  /* 地板場域的特效只有 sgGroundTick 尾端那一個發射點，而本分流在它之前就 return，
     所以要像泥沼池（sgMireGroundTick）一樣自己先發一次，否則血霧完全看不見。 */
  sgEmitVfx(f.gid, victims, f.floatSel, sgGroundVfxSpec(f));
  /* 把治療比例存進標記的效果值：吸血掛在「敵人受傷」這條全遊戲最熱的路徑上，
     在那裡重算 legendarySkill2Mods（掃整個特效池 ＋ 雙手補償深拷貝）太貴。
     順帶讓數值在血霧生成的當下定版，之後換裝也不會回頭改變已存在的血霧。 */
  var spec = sgLegend('bloodblade').bloodMistField;
  var healPct = spec ? Math.max(0, Number(spec.healPct) || 0) : 0;
  for (var i = 0; i < victims.length; i++) {
    applyStatus(victims[i], 'sgBloodMist', { val: healPct, dur: Math.max(0.2, f.gap * 1.2) });
  }
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
  /* 傳奇【毒血祭】：造成的中毒與流血傷害提高（生命代價那半在 sgApplyBloodbladeDot）。
     與零日感染的加成相乘而不是相加——兩者是不同來源的獨立乘區。 */
  var rite = sgLegend('bloodblade').bloodVenomRite;
  var riteBonus = rite ? 1 + (Number(rite.pct) || 0) / 100 : 1;
  if (sid === 'sgBleed') {
    var bleedGap = Math.max(0.1, (Number(tiers[0].fx.dotGap) || 1) *
      (1 - (lvs[1] > 0 ? sgVal(tiers[1].fx, 'gapPct', lvs[1]) : 0) / 100));
    return {
      dps: baseVal * sgVal(tiers[0].fx, 'dotPct', lvs[0]) / 100 * zeroBonus * riteBonus / bleedGap,
      dur: (Number(tiers[0].fx.dotSec) || 5) + (lvs[1] > 0 ? sgVal(tiers[1].fx, 'sec', lvs[1]) : 0),
      interval: bleedGap
    };
  }
  if (sid === 'sgPoison' && lvs[3] > 0) {
    var poisonGap = Math.max(0.1, Number(tiers[3].fx.dotGap) || 0.5);
    return {
      dps: baseVal * sgVal(tiers[3].fx, 'dotPct', lvs[3]) / 100 * zeroBonus * riteBonus / poisonGap,
      dur: Number(tiers[3].fx.dotSec) || 4,
      interval: poisonGap
    };
  }
  return null;
}

/* 血刃斬的 DOT 塗抹。三條路徑（初次塗抹／屍爆傳染／零日感染傳染）共用這一支，
   因此第三批的兩個效果都掛在這裡：
     超神進化【崩解】：把「持續時間」換成「當場結清 ＋ 爆炸」，狀態不會被建立
     傳奇【毒血祭】：每感染 1 個敵人付出自身生命
   ctx＝{ enemies, floatSel, out }，供崩解的爆炸使用；沒帶就只結清、不爆炸。 */
function sgApplyBloodbladeDot(ent, sid, spec, dur, ctx) {
  if (!ent || !spec) return;
  sgBloodVenomRiteCost(sid);
  var useDur = Math.max(0.2, Number(dur) || spec.dur);
  var ult = sgUlt('bloodblade', 'disintegrate');
  if (ult) { sgDisintegrate(ent, sid, spec, useDur, ult, ctx); return; }
  applyStatus(ent, sid, { dps: spec.dps, dur: useDur, interval: spec.interval });
}

/* 傳奇【毒血祭】：中毒每感染 1 個敵人就付出自身生命值。
   代價取「當下生命」的百分比並保底留 1 點——毒霧感染一次可以傳染好幾個，
   若取最大生命的固定比例或允許歸零，等於讓這個特效自殺。 */
function sgBloodVenomRiteCost(sid) {
  if (sid !== 'sgPoison') return;
  var rite = sgLegend('bloodblade').bloodVenomRite;
  var pct = rite ? Math.max(0, Number(rite.hpPct) || 0) : 0;
  if (!(pct > 0)) return;
  var pEnt = sgCurrentPlayerEnt();
  if (!pEnt || !(pEnt.hp > 1)) return;
  pEnt.hp = Math.max(1, pEnt.hp - Math.max(1, Math.round(pEnt.hp * pct / 100)));
}

/* 超神進化【崩解】：中毒與流血不再有持續時間，塗上的當下就把整段傷害結清，
   結清後對周圍爆炸。取值口徑與零日感染的引爆一致（dps × 持續秒數），
   並比照傳奇【燃燒法則】的即時引爆補上 legendaryDotDamageMultiplier——
   逐跳結算時 tickStatuses 會乘這個乘區，一次結清若少乘就會比讓它跳完更弱。 */
function sgDisintegrate(ent, sid, spec, dur, ult, ctx) {
  /* 流血結清很容易當場打死主目標；此時緊接著的中毒塗抹若照跑，sgDerivedHit 對屍體回 0，
     卻仍會用未打折的總量再炸周圍一次。已經死掉就不再結算第二次。 */
  if (!ent || ent.hp <= 0) return;
  var total = Math.max(0, spec.dps * dur);
  if (typeof legendaryDotDamageMultiplier === 'function') total *= legendaryDotDamageMultiplier(ent);
  if (!(total > 0)) return;
  var floatSel = (ctx && ctx.floatSel) || 'mv-float';
  var out = (ctx && ctx.out) || { killed: false, dmg: 0, crit: false };
  var poison = sid === 'sgPoison';
  sgDerivedHit(ent, total, 'bloodblade', floatSel, out, poison ? '☠️' : '🩸', 0);
  sgEmitVfx('bloodblade', [ent], floatSel, {
    fxKind: 'burst', variant: 'blood-explosion', elem: poison ? 'poison' : null
  });
  var boom = total * sgUltVal(ult, 'pct') / 100;
  var enemies = (ctx && ctx.enemies) || null;
  if (!(boom > 0) || !enemies || !enemies.length) return;
  var victims = bfNearestOthers(ent, enemies, enemies.length, bfMeterPx(sgUltVal(ult, 'm')));
  for (var i = 0; i < victims.length; i++) {
    sgDerivedHit(victims[i], boom, 'bloodblade', floatSel, out, '💥', sgStaggerMs(i));
  }
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
function sgAtkCfg(pEnt, st, dmgVal, target, bonusTotalPct, gid, elemOverride) {
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
    /* 「你造成的所有傷害提高」的四個來源由 skills2AllDamageUpPct 統一加總；
       普攻端（combat.js playerAtkCfg）讀同一支，兩邊必須一致。 */
    totalDmgPct: (st.totalDmgPct || 0) + skills2AllDamageUpPct(pEnt) + (bonusTotalPct || 0),
    dmgVsElem: st.dmgVsElem,
    isPlayer: true, isSkill: true
  };
  /* 屬性歸屬：預設吃群組層的 elem；elemOverride 給「某一段傷害改為別的屬性」用
     （逐風者的龍捲風、旋風劍舞的旋風＝物理群組打出風系段）。傷害類型仍由群組決定，
     因此物理群組的風系段依舊走物攻與物穿，只有屬性標籤與抗性選型改變。 */
  var elem = elemOverride || (g && g.elem) || null;
  if (elem) aCfg.skillElem = elem;
  if (typeof skill2WindAmpACfg === 'function') aCfg = skill2WindAmpACfg(aCfg, pEnt);
  return skill2VulnACfg(aCfg, target);
}

/* 一次獨立命中（走完整 resolveHit 傷害管線：防禦、爆擊、格擋、護盾、敵種倍率）。
   回傳 resolveHit 結果；同時記錄浮字／DPS／輸出統計並更新 out。 */
function sgHitOne(pEnt, st, target, dmgVal, gid, floatSel, out, delayMs, bonusTotalPct, elemOverride) {
  if (!target || target.hp <= 0 || !(dmgVal > 0)) return null;
  var g = SKILLS2[gid];
  var res = resolveHit(pEnt, target, sgAtkCfg(pEnt, st, dmgVal, target, bonusTotalPct, gid, elemOverride), monsterDefCfg(target));
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
    if (targets[i] && (targets[i].hp > 0 || (extra && extra.preserveDeadTargets))) {
      ids.push(enemyEventFloatTarget(targets[i], floatSel));
    }
  }
  var cat = sgVfxCat(g);
  var spec = {
    fxKind: (extra && extra.fxKind) || 'slash',
    glyph: g.emoji,
    color: (extra && extra.color) ||
      ((typeof VFX_CAT_COLORS !== 'undefined' && VFX_CAT_COLORS[cat]) || '#f97316'),
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
  if (extra && extra.rangeScale > 0) spec.rangeScale = Number(extra.rangeScale);
  if (extra && Array.isArray(extra.directionRanges)) {
    spec.directionRanges = extra.directionRanges.slice(0, 4).map(Number);
  }
  /* 風刃是「朝某個方位射出」而不是「射向某個目標」：路徑上可能一個敵人都沒有
     （四方向齊射），顯示層因此必須拿得到方位與刀身長度，不能從 targets 反推。 */
  if (extra && isFinite(extra.angle)) spec.angle = Number(extra.angle);
  if (extra && extra.bodyLength > 0) spec.bodyLength = Number(extra.bodyLength);
  /* 拋物線投射物的離地最高點（米，水流彈）：弧高是模擬層的表定值，
     顯示層不得自己另外挑一個固定值（AI_RULES 8.3：計算層與表現層共用同一個語意參數）。 */
  if (extra && extra.arcM > 0) spec.arcM = Number(extra.arcM);
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
  /* 延遲發射（暴風真空刃）：整條時間軸——起飛、路徑距離、抵達——一起往後推，
     只推 beginAt 的話後發的那幾道會在起飛的瞬間「補飛」完已經過去的時間。 */
  var begin = now + Math.max(0, Number(extra && extra.beginSec) || 0);
  var p = {
    pEnt: pEnt, st: st, gid: gid, dmgVal: dmgVal, origin: start,
    angle: Number(angle) || 0, length: Number(length), speed: speed,
    startAt: begin, lastAt: begin, lastDistance: 0, endAt: begin + travel,
    fallbackTargets: fallbackTargets || [], floatSel: floatSel,
    out: out, states: [], started: false,
    hitFn: extra && typeof extra.hitFn === 'function' ? extra.hitFn : null,
    rehit: !(extra && extra.singleHit),
    waitForEnd: !!(extra && extra.waitForEnd),
    targetOnly: !!(extra && extra.targetOnly),
    burnSpec: extra && extra.burnSpec || null,
    frostSpec: extra && extra.frostSpec || null,
    victims: extra && extra.victims || null,
    splitTargets: extra && extra.splitTargets || null,
    splitDmgVal: extra && Number(extra.splitDmgVal) > 0 ? Number(extra.splitDmgVal) : 0,
    spreadPct: extra && extra.spreadPct || 0,
    spreadCount: extra && extra.spreadCount || 0,
    halfWidthPx: extra && Number(extra.halfWidthPx) > 0 ? Number(extra.halfWidthPx) : 0,
    /* 迴身四方斬的每道飛行物是 60 度扇形，距離隨飛行物推進而增長；
       coneBaseAngle／coneIndex 固定四個方向的歸屬，避免邊界敵人被重複命中。 */
    coneDeg: extra && Number(extra.coneDeg) > 0 ? Number(extra.coneDeg) : 0,
    coneBaseAngle: extra && isFinite(extra.coneBaseAngle) ? Number(extra.coneBaseAngle) : 0,
    coneIndex: extra && Number(extra.coneIndex) >= 0 ? Math.floor(Number(extra.coneIndex)) : -1,
    coneCount: extra && Number(extra.coneCount) > 0 ? Math.floor(Number(extra.coneCount)) : 0,
    stunChance: extra && extra.stunChance || 0,
    stunSec: extra && extra.stunSec || 0,
    /* 延遲發射（暴風真空刃：同一個方向連續射出三道，每道間隔 0.2 秒）。
       時間軸掛在飛行物自己身上而不是呼叫端的 setTimeout——模擬層沒有 DOM，
       且離線追趕時所有時間都必須跟著 GT 走，setTimeout 會在追趕中整批塌成同一瞬間。 */
    beginAt: begin,
    /* 沿途脈衝（狂風碎裂）：飛行途中每 pulseGap 秒，以飛行物當下位置為圓心打一次範圍傷害。
       與地板場域的差別是圓心跟著飛行物走，因此不另外開一個場域實例。 */
    pulseGap: Math.max(0, Number(extra && extra.pulseGap) || 0),
    pulseRadius: Math.max(0, Number(extra && extra.pulseRadius) || 0),
    pulseDmg: Math.max(0, Number(extra && extra.pulseDmg) || 0),
    pulseVariant: (extra && extra.pulseVariant) || '',
    nextPulseAt: begin + Math.max(0.05, Number(extra && extra.pulseGap) || 0.5),
    /* 命中時附加的減益（狂風碎裂的移速下降）：狀態鍵與數值由呼叫端指定。 */
    slowStatus: (extra && extra.slowStatus) || '',
    slowPct: Math.max(0, Number(extra && extra.slowPct) || 0),
    /* 命中後掛鉤：與直接命中路徑共用同一支（傳奇特效／超神進化的命中觸發）。 */
    onHit: (extra && typeof extra.onHit === 'function') ? extra.onHit : null,
    /* 逐目標的總傷加成%（乘虛之斬對暈眩目標增傷）：命中的當下才算得準，
       因此存的是函式而不是數字。 */
    bonusPctFn: (extra && typeof extra.bonusPctFn === 'function') ? extra.bonusPctFn : null
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
    projectile.gid, projectile.floatSel, projectile.out, 0,
    projectile.bonusPctFn ? projectile.bonusPctFn(target) : 0);
  if (!res || res.miss) return;
  if (ctx.onDamage) ctx.onDamage(res.dmg);

  if (projectile.spreadPct > 0 && projectile.spreadCount > 0) {
    var live = ctx.getEnemies ? ctx.getEnemies() : [];
    // 突刺【擴散】：「擴散至周圍的 N 個敵人」沒有指定最近＝隨機（候選同原本＝整個戰場）
    var others = bfRandomOthers(target, live, projectile.spreadCount, 0, null);
    for (var i = 0; i < others.length; i++) {
      var wasAlive = others[i].hp > 0;
      var beforeSpread = projectile.out.dmg;
      sgDerivedHit(others[i], res.dmg * projectile.spreadPct / 100, projectile.gid,
        projectile.floatSel, projectile.out, SKILLS2[projectile.gid].emoji, 0);
      if (wasAlive && others[i].hp <= 0 && ctx.onDeaths) ctx.onDeaths();
      if (ctx.onDamage && projectile.out.dmg > beforeSpread) ctx.onDamage(projectile.out.dmg - beforeSpread);
    }
  }
  if (projectile.stunChance > 0 && chance(projectile.stunChance)) {
    sgTryStun(target, projectile.stunSec);
  }
  /* 命中時附加的減益（狂風碎裂的移速下降）：狀態鍵由呼叫端指定，
     因此不必為了一個減益再多寫一支 hitFn。 */
  if (projectile.slowStatus && projectile.slowPct > 0 && target.hp > 0 &&
      typeof applyStatus === 'function') {
    applyStatus(target, projectile.slowStatus, { val: projectile.slowPct });
  }
  /* 命中後掛鉤（2026-08-19 傳奇特效／超神進化）：貫穿型技能的傷害在飛行物這裡結算，
     直接命中的傷害在施放函式裡結算——兩條路徑共用同一支掛鉤，效果才不會只在其中一種
     形態下生效（突刺投資到第 4／6／7 階就整個改走飛行物）。 */
  if (projectile.onHit) projectile.onHit(target, res, ctx);
  if (res.killed && ctx.onDeaths) ctx.onDeaths();
}

/* 四方斬的四個方向中心相隔 90 度，但每道實際攻擊扇形為 60 度。
   bfConeTargets 的邊界是雙包含，這裡依「從前方方向開始、逆時針分配」固定方向歸屬，
   讓敵人即使落在方向分界附近，也只歸屬其中一道斬擊。 */
function sgFilterCleaveSectorTargets(targets, baseAngle, sectorIndex, sectorCount) {
  if (!Array.isArray(targets) || sectorIndex < 0 || !(sectorCount > 0) ||
      typeof bfAngleTo !== 'function') return targets || [];
  var step = Math.PI * 2 / sectorCount;
  var start = baseAngle - step / 2 + sectorIndex * step;
  var out = [];
  for (var i = 0; i < targets.length; i++) {
    var angle = bfAngleTo(targets[i]);
    var rel = angle - start;
    while (rel < 0) rel += Math.PI * 2;
    while (rel >= Math.PI * 2) rel -= Math.PI * 2;
    if (rel < step) out.push(targets[i]);
  }
  return out;
}

/* 飛行物的沿途脈衝（狂風碎裂）：以飛行物當下位置為圓心，對半徑內的所有敵人各打一段。
   節拍與位置都由飛行物自己推進，因此速度、體積與傷害全部只有一個來源。 */
function sgProjectilePulse(projectile, now, distance, enemies, ctx) {
  if (!(projectile.pulseGap > 0) || !(projectile.pulseDmg > 0) || !projectile.origin) return;
  if (typeof bfEnemiesInArea !== 'function' || typeof bfLiveList !== 'function') return;
  var guard = 0;
  while (projectile.nextPulseAt <= now && now <= projectile.endAt && guard < 10) {
    guard++;
    projectile.nextPulseAt += projectile.pulseGap;
    var cx = projectile.origin.x + Math.cos(projectile.angle) * distance;
    var cy = projectile.origin.y + Math.sin(projectile.angle) * distance;
    var victims = bfEnemiesInArea({ x: cx, y: cy, r: projectile.pulseRadius }, bfLiveList(enemies));
    sgEmitVfx(projectile.gid, victims, projectile.floatSel, {
      fxKind: 'burst', variant: projectile.pulseVariant || 'wind-burst',
      area: { x: cx, y: cy, r: projectile.pulseRadius }
    });
    if (!victims.length) continue;
    var before = projectile.out.dmg;
    for (var i = 0; i < victims.length; i++) {
      sgHitOne(projectile.pEnt, projectile.st, victims[i], projectile.pulseDmg,
        projectile.gid, projectile.floatSel, projectile.out, sgStaggerMs(i));
    }
    if (ctx && ctx.onDamage && projectile.out.dmg > before) ctx.onDamage(projectile.out.dmg - before);
    if (projectile.out.killed && ctx && ctx.onDeaths) ctx.onDeaths();
  }
}

function sgTickFlyingProjectiles(dt, ctx) {
  var list = SKILL2_RT.projectiles;
  if (!list || !list.length) return;
  var now = sgProjectileNow();
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  for (var pi = list.length - 1; pi >= 0; pi--) {
    var projectile = list[pi];
    if (projectile.beginAt > now) continue;   // 尚未發射（延遲發射的後續幾道）
    var distance = projectile.origin
      ? Math.min(projectile.length, Math.max(0, (now - projectile.startAt) * projectile.speed))
      : projectile.length;
    var crossed;
    if (projectile.origin && projectile.coneDeg > 0 && typeof bfConeTargets === 'function') {
      crossed = bfConeTargets(projectile.angle, projectile.coneDeg, distance, enemies);
      crossed = sgFilterCleaveSectorTargets(crossed, projectile.coneBaseAngle,
        projectile.coneIndex, projectile.coneCount);
    } else if (projectile.origin && typeof bfSegmentTargets === 'function') {
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
    sgProjectilePulse(projectile, now, distance, enemies, ctx);
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
    case 'rockarmor': sgCastRockarmor(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'mire': sgCastMire(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'chainlightning': sgCastChainlightning(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'thunderstrike': sgCastThunderstrike(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'thunderorb': sgCastThunderorb(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'icearrow': sgCastIcearrow(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'waterball': sgCastWaterball(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'frostnova': sgCastFrostnova(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'windblade': sgCastWindblade(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'vacuumslash': sgCastVacuumslash(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
    case 'stormbarrier': sgCastStormbarrier(pEnt, st, g, lvs, pool, primary, floatSel, out); break;
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

/* 普通敵人（非精英、非 BOSS、非高塔 BOSS）：超神進化【一擊必殺】的處決對象判定。
   旗標沿用 combat.js monsterDefCfg 的同一組欄位，不另建一套敵種分類。 */
function sgIsNormalEnemy(ent) {
  return !!ent && !ent.elite && !ent.isBoss && !ent.towerBoss;
}

/* 以某個敵人為圓心、半徑內的**其他**敵人（幻影八方陣的擴散、逐風者的龍捲風）。
   幾何交給 js/battlefield.js 的 bfTargetsAround（唯一權威），這裡只負責排除圓心本身；
   沒有座標時（高塔）回空陣列＝退化為純單體，與本系統其他幾何查詢的退化規則一致。 */
function sgEnemiesAround(center, enemies, radiusPx) {
  if (!center || !(radiusPx > 0) || typeof bfTargetsAround !== 'function') return [];
  if (typeof bfPos !== 'function' || !bfPos(center)) return [];
  var all = bfTargetsAround(center, enemies, radiusPx);
  var res = [];
  for (var i = 0; i < all.length; i++) if (all[i] !== center && all[i].hp > 0) res.push(all[i]);
  return res;
}

/* 突刺的「命中之後」掛鉤（傳奇特效 ＋ 超神進化）。
   突刺一旦投資到第 4／6／7 階就整個改走飛行物結算，因此直接命中與貫穿飛行物
   兩條路徑必須共用同一支掛鉤，效果才不會只在其中一種形態下生效。
   cfg 由 sgCastThrust 一次算好（純資料，不含幾何）。 */
function sgThrustOnHit(cfg, target, res, ctx) {
  if (!target || !res || res.miss) return;
  var enemies = (ctx && ctx.getEnemies) ? ctx.getEnemies() : cfg.pool;
  /* 傳奇【千瘡百孔】：命中疊層，使該敵人受到的傷害提高。 */
  if (cfg.vuln && target.hp > 0 && typeof applyStatus === 'function') {
    applyStatus(target, 'sgThrustVuln', {
      val: cfg.vuln.pct, dur: cfg.vuln.dur, maxStacks: cfg.vuln.maxStacks
    });
  }
  /* 超神【暗影絕殺者】：命中堆疊靈魂撕裂（每層使該敵人受到的傷害提高）。 */
  if (cfg.soulRend && target.hp > 0 && typeof applyStatus === 'function') {
    applyStatus(target, 'sgSoulRend', {
      val: cfg.soulRend.perStack, maxStacks: cfg.soulRend.maxStacks, dur: cfg.soulRend.dur
    });
  }
  /* 傳奇【穿心裂血】：附加流血（每跳量與間隔由特效參數決定，引擎以 dps 覆寫）。 */
  if (cfg.bleed && target.hp > 0 && typeof applyStatus === 'function') {
    applyStatus(target, 'sgThrustBleed', {
      dps: cfg.bleed.dps, dur: cfg.bleed.dur, interval: cfg.bleed.interval
    });
  }
  /* 傳奇【迅雷穿刺】：機率附加一道連鎖閃電（重用傳奇特效既有的連鎖排程器）。 */
  if (cfg.chain && chance(cfg.chain.chance) && typeof legendaryScheduleChain === 'function') {
    legendaryScheduleChain(cfg.pEnt, cfg.chain, cfg.floatSel);
  }
  /* 超神【幻影八方陣】：傷害同時擴散到該敵人周圍範圍內的所有敵人（衍生傷害，不再過防禦）。 */
  if (cfg.phantomPx > 0 && res.dmg > 0) {
    var around = sgEnemiesAround(target, enemies, cfg.phantomPx);
    for (var i = 0; i < around.length; i++) {
      var wasAlive = around[i].hp > 0;
      var before = cfg.out.dmg;
      sgDerivedHit(around[i], res.dmg, 'thrust', cfg.floatSel, cfg.out, cfg.emoji, 0);
      if (ctx && ctx.onDamage && cfg.out.dmg > before) ctx.onDamage(cfg.out.dmg - before);
      if (wasAlive && around[i].hp <= 0 && ctx && ctx.onDeaths) ctx.onDeaths();
    }
  }
  /* 超神【一擊必殺】：命中即刻殺死普通敵人（精英與 BOSS 不適用）。 */
  if (cfg.execNormal && target.hp > 0 && sgIsNormalEnemy(target)) {
    var beforeExec = cfg.out.dmg;
    sgDerivedHit(target, target.hp, 'thrust', cfg.floatSel, cfg.out, '💀', 0);
    if (ctx && ctx.onDamage && cfg.out.dmg > beforeExec) ctx.onDamage(cfg.out.dmg - beforeExec);
    if (target.hp <= 0 && ctx && ctx.onDeaths) ctx.onDeaths();
  }
}

function sgCastThrust(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  /* 傳奇特效（唯一入口 sgLegend）與超神進化（唯一入口 sgUlt）：
     兩者都只改寫參數，幾何與傷害管線仍是同一套。 */
  var lg = sgLegend('thrust');
  var ultPhantom = sgUlt('thrust', 'phantomOcta');
  var ultSoul = sgUlt('thrust', 'shadowExecutioner');
  var ultKill = sgUlt('thrust', 'oneStrikeKill');

  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[2] > 0) pct += sgVal(t[2].fx, 'pct', lvs[2]);
  if (lvs[6] > 0) pct += sgVal(t[6].fx, 'pct', lvs[6]);
  // 傳奇【凝鋒穿刺】＋【貫日之刺】的技能傷害提升（同鍵相加，見 legendarySkill2Mods）
  pct += Number(lg.skillDamagePct) || 0;

  // 說明中的次數要逐項累加：第 1 階兩次；第 7 階再加三次；第 2 階觸發時再加兩次。
  var thrustCount = Math.max(1, Math.floor(Number(t[0].fx.count) || 2));
  if (lvs[6] > 0) thrustCount += Math.max(1, Math.floor(Number(t[6].fx.count) || 3));
  if (lvs[1] > 0 && chance(sgVal(t[1].fx, 'chance', lvs[1]))) {
    thrustCount += Math.max(1, Math.floor(Number(t[1].fx.count) || 2));
  }

  var dmgVal = st.atk * pct / 100;
  // 超神【一擊必殺】：八方連刺改為前方 1 道，但整段傷害改為 N 倍
  if (ultKill && lvs[6] > 0) dmgVal *= Math.max(1, sgUltVal(ultKill, 'mult'));
  var baseAngle = (typeof bfAngleTo === 'function') ? bfAngleTo(primary) : null;
  var geomOk = baseAngle !== null;
  var baseRange = sgRange(g.range);
  var rangeScale = lvs[3] > 0 ? 1 + sgVal(t[3].fx, 'range', lvs[3]) / 100 : 1;
  // 傳奇【貫日之刺】：突刺範圍（長與寬同時）提升
  rangeScale *= 1 + (Number(lg.thrustRangePct) || 0) / 100;
  var lineLen = bfMeterPx(baseRange.length || 6) * rangeScale;
  if (lvs[5] > 0) lineLen += bfMeterPx(sgVal(t[5].fx, 'm', lvs[5]));
  var lineWidth = bfMeterPx(baseRange.width || 2) * rangeScale;
  /* 傳奇【凝鋒穿刺】：長度加成套在「含貫穿延長之後」的總長上（設計語意是整道突刺變長），
     寬度則獨立縮減；兩者都夾在正數，避免表值填成 -100% 時寬度歸零讓路徑選不到目標。 */
  lineLen = Math.max(1, lineLen * (1 + (Number(lg.thrustLenPct) || 0) / 100));
  lineWidth = Math.max(1, lineWidth * (1 + (Number(lg.thrustWidthPct) || 0) / 100));
  var isEightWay = lvs[6] > 0;
  /* 八方連刺「改為 1 道」：傳奇【貫日之刺】與超神【一擊必殺】各自都能把它改回單向，
     兩者同時存在時效果相同（方向數本來就只會是 1）。傷害加成仍照第 7 階計算。 */
  var octaSingle = isEightWay && (!!lg.octaToSingle || !!ultKill);
  // 第 4 階的三道平行路徑與第 7 階的八方方向可同時存在；高階效果不覆蓋低階效果。
  var isParallel = lvs[3] > 0;
  var directions = [0];
  var directionCount = (isEightWay && !octaSingle)
    ? Math.max(1, Math.floor(Number(t[6].fx.directions) || 8)) : 1;
  if (isEightWay && !octaSingle) {
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

  /* 巨型單道突刺（貫日之刺／一擊必殺）沿用 thrust-pierce：那是唯一會讀 lineLength／
     lineWidth 把刀光整條拉長的既有變體，「更長更粗」才看得出來。
     ⚠️ 不要在這裡發明新的 variant 字串——顯示層不認得的變體會退回「每個敵人身上一道
     隨機傾角小刀光」，長寬參數會被整個忽略。 */
  var thrustVariant = octaSingle ? 'thrust-pierce'
    : (isEightWay ? 'thrust-octagonal' : (isParallel ? 'thrust-parallel' :
      (lvs[5] > 0 ? 'thrust-pierce' : 'thrust')));
  sgEmitVfx('thrust', planned, floatSel, {
    fxKind: 'slash', variant: thrustVariant, count: Math.min(8, thrustCount), projectile: isPiercing,
    dur: 0.3,
    lineLength: lineLen, lineWidth: Math.max(28, lineWidth), laneOffsets: laneOffsets,
    directionCount: directionCount
  });

  /* 命中掛鉤的參數包：只在這裡算一次，直接命中與飛行物兩條路徑共用同一份。 */
  var hookCfg = {
    pEnt: pEnt, pool: pool, floatSel: floatSel, out: out, emoji: g.emoji,
    vuln: lg.thrustVuln || null,
    bleed: lg.thrustDot ? {
      // 每跳 tickPowerPct% 物攻、每 tickSec 秒一跳 → 狀態表以 dps 表述
      dps: st.atk * (Number(lg.thrustDot.tickPowerPct) || 0) / 100 /
        Math.max(0.1, Number(lg.thrustDot.tickSec) || 1),
      dur: Math.max(0.2, Number(lg.thrustDot.dur) || 0),
      interval: Math.max(0.1, Number(lg.thrustDot.tickSec) || 1)
    } : null,
    chain: lg.thrustChain || null,
    soulRend: ultSoul ? {
      perStack: sgUltVal(ultSoul, 'perStack'),
      maxStacks: Math.max(1, Math.floor(sgUltVal(ultSoul, 'maxStacks'))),
      dur: Math.max(1, sgUltVal(ultSoul, 'dur'))
    } : null,
    phantomPx: ultPhantom ? bfMeterPx(sgUltVal(ultPhantom, 'm')) : 0,
    execNormal: !!ultKill
  };
  var onThrustHit = function (target, res, ctx) { sgThrustOnHit(hookCfg, target, res, ctx); };

  /* 超神【幻影八方陣】：施放後短時間內的絕對閃避（與命中率無關的獨立擲骰，
     掛點在 combat.js playerDefCfg → formula.js resolveHit 的閃避段）。 */
  if (ultPhantom && typeof applyStatus === 'function') {
    applyStatus(pEnt, 'sgPhantomDodge', {
      val: sgUltVal(ultPhantom, 'dodge'), dur: sgUltVal(ultPhantom, 'sec')
    });
  }

  if (isPiercing) {
    var spreadPct = lvs[4] > 0 ? sgVal(t[4].fx, 'pct', lvs[4]) : 0;
    var spreadCount = lvs[4] > 0 ? Math.max(1, Math.floor(Number(t[4].fx.count) || 4)) : 0;
    for (var pr = 0; pr < thrustCount; pr++) {
      for (var pi = 0; pi < plans.length; pi++) {
        var plan = plans[pi];
        sgQueueFlyingProjectile(pEnt, st, 'thrust', dmgVal,
          plan.origin, plan.angle, lineLen, floatSel, plan.targets,
          { spreadPct: spreadPct, spreadCount: spreadCount, halfWidthPx: plan.halfWidth,
            onHit: onThrustHit }, out);
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
          // 「擴散至周圍的 N 個敵人」沒有指定最近＝隨機（候選同原本＝整個戰場）
          var others = bfRandomOthers(hitTargets[ti], pool,
            Math.max(1, Math.floor(Number(t[4].fx.count) || 4)), 0, null);
          for (var oi = 0; oi < others.length; oi++) {
            sgDerivedHit(others[oi], res.dmg * spreadPct2 / 100, 'thrust', floatSel, out, g.emoji, sgStaggerMs(hitIdx + 1));
          }
        }
        onThrustHit(hitTargets[ti], res, null);
      }
      hitIdx++;
    }
  }
}

/* ---- 迴旋斬 ---- */

/* 傳奇【旋風劍舞】：每一次斬擊同時在自身周圍捲起一道旋風。
   旋風是「即刻結算的範圍段」而不是場域（設計文檔沒有持續時間），
   因此直接走 sgHitOne＋屬性覆寫，一次斬擊一次。 */
function sgCleaveWhirlwind(pEnt, st, whirl, pool, floatSel, out, hitIdx) {
  if (!whirl || !(Number(whirl.powerPct) > 0)) return;
  var radius = bfMeterPx(Number(whirl.m) || 0);
  if (!(radius > 0)) return;
  var victims = (typeof bfEnemiesInArea === 'function' && typeof bfPlayerPos === 'function' &&
    typeof bfLiveList === 'function')
    ? bfEnemiesInArea({ x: bfPlayerPos().x, y: bfPlayerPos().y, r: radius }, bfLiveList(pool))
    : (pool || []).filter(function (e) { return e && e.hp > 0; });
  if (!victims.length) return;
  /* 特效沿用真空斬【迴旋斬】那一階的 wind-spin（圍繞周身的一整圈）：
     它掛在 fxKind 'slash' 的分派下，寫成 'aura' 會被兩個渲染器的
     「風系泛用 aura 一律不畫方框」守衛擋掉，變成完全沒有畫面。 */
  sgEmitVfx('cleave', victims, floatSel, {
    fxKind: 'slash', variant: 'wind-spin', elem: 'wind', dur: 0.35
  });
  var dmg = st.atk * Number(whirl.powerPct) / 100;
  for (var i = 0; i < victims.length; i++) {
    sgHitOne(pEnt, st, victims[i], dmg, 'cleave', floatSel, out, sgStaggerMs(hitIdx + i), 0, 'wind');
  }
}

/* 超神【逐風者】：命中處生成一道龍捲風（地板場域，逐段結算風系傷害）。 */
function sgCleaveTornado(pEnt, st, cfg, target, floatSel) {
  if (!cfg || typeof sgSpawnGround !== 'function') return;
  sgSpawnGround(pEnt, st, 'cleave', {
    tgt: target, floatSel: floatSel, kind: 'windtornado',
    radius: bfMeterPx(cfg.m), dmgVal: st.atk * cfg.pct / 100,
    hits: cfg.hits, gap: cfg.gap, hitElem: 'wind'
  });
}

/* 迴旋斬的「命中之後」掛鉤：直接命中與飛出斬擊兩條路徑共用（同突刺的理由）。 */
function sgCleaveOnHit(cfg, target, res, ctx) {
  if (!target || !res || res.miss) return;
  if (cfg.tornado) sgCleaveTornado(cfg.pEnt, cfg.st, cfg.tornado, target, cfg.floatSel);
}

function sgCastCleave(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var lg = sgLegend('cleave');
  var ultVoid = sgUlt('cleave', 'voidShatter');
  var ultWind = sgUlt('cleave', 'windChaser');

  /* 傳奇【聚敵旋渦】：先把範圍內的敵人拉到身邊，之後的目標挑選與飛出路徑
     才會看到拉近後的站位（座標改寫收斂在 js/battlefield.js）。 */
  if (lg.cleavePull && typeof bfPullEnemies === 'function') {
    bfPullEnemies(pool, bfMeterPx(Number(lg.cleavePull.m) || 0), bfMeterPx(Number(lg.cleavePull.toM) || 0));
  }

  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[2] > 0) pct += sgVal(t[2].fx, 'pct', lvs[2]);
  // 超神【虛空碎裂斬】：迴身四方斬的傷害再額外提高（沒投資第 7 階時不生效）
  if (ultVoid && lvs[6] > 0) pct += sgUltVal(ultVoid, 'pct');
  pct += Number(lg.skillDamagePct) || 0;
  var dmgVal = st.atk * pct / 100;
  // 迴身四方斬的額外傷害與原有傷害採乘法計算。
  if (lvs[6] > 0) dmgVal *= 1 + sgVal(t[6].fx, 'pct', lvs[6]) / 100;
  var targetCap = Math.floor(Number(t[0].fx.count) || 0);
  if (targetCap > 0 && lvs[1] > 0) {
    targetCap += sgRollCount(sgVal(t[1].fx, 'add', lvs[1]));
  }
  var slashes = 1;
  if (lvs[3] > 0 && chance(sgVal(t[3].fx, 'chance', lvs[3]))) {
    slashes = Math.max(1, sgRollCount(sgVal(t[3].fx, 'times', lvs[3])));
  }
  // 迴身四方斬：四個方向各至少完整斬出表定次數；若連斬同時觸發，保留較高次數。
  if (lvs[6] > 0) {
    var crossTimes = sgVal(t[6].fx, 'times', lvs[6]);
    // 超神【虛空碎裂斬】：迴身四方斬的攻擊次數 +N（小數部分依慣例以機率補一次）
    if (ultVoid) crossTimes += sgUltVal(ultVoid, 'times');
    slashes = Math.max(slashes, Math.max(1, sgRollCount(crossTimes)));
  }
  // 傳奇【連環迴旋】：斬擊次數直接 +N（與連斬、迴身四方斬相加，不是取高）
  slashes += Math.max(0, Math.floor(Number(lg.cleaveSlashAdd) || 0));
  var geomOk = (typeof bfPos === 'function') && !!bfPos(primary);
  var baseAngle = geomOk ? bfAngleTo(primary) : null;

  /* 飛出距離：第 6 階【震碎斬】只讓前方刀光飛出去；傳奇【裂空飛斬】是「向外飛出」，
     因此迴身四方斬的其餘三個方向也一起飛。兩者同時存在時各方向取較遠的那一個。 */
  var cleaveRangeScale = skills2CleaveRangeScale(lvs);
  var tierFlyPx = lvs[5] > 0 ? bfMeterPx(sgVal(t[5].fx, 'm', lvs[5])) * cleaveRangeScale : 0;
  var legendFlyPx = bfMeterPx(Number(lg.cleaveFlyM) || 0) * cleaveRangeScale;
  var frontFlyPx = Math.max(tierFlyPx, legendFlyPx);
  var sideFlyPx = legendFlyPx;
  // 迴身四方斬本身就是向外擴張的四道扇形；其他階段沒有飛出距離時仍須走飛行物時間軸。
  var isFlying = frontFlyPx > 0 || lvs[6] > 0;
  var meleeRangePx = ((typeof bfMeleeRange === 'function') ? bfMeleeRange() : bfMeterPx(5)) * cleaveRangeScale;
  // 第 7 階四個方向必須共用同一個最大半徑，不能讓第 6 階只把前方一道拉長。
  var crossRangePx = Math.max(frontFlyPx, sideFlyPx, meleeRangePx);

  var targets = [];
  var directionTargets = [];
  var directions = lvs[6] > 0 ? [0, Math.PI / 2, Math.PI, Math.PI * 1.5] : [0];
  if (lvs[6] > 0) {
    // 迴身四方斬：以玩家朝向為基準，四個方向各取 60 度扇形，中心仍相隔 90 度。
    for (var di = 0; di < directions.length; di++) {
      var dirFly = lvs[6] > 0 ? crossRangePx : ((di === 0) ? frontFlyPx : sideFlyPx);
      var dirRange = dirFly > 0
        ? dirFly
        : meleeRangePx;
      var dirTargets = geomOk && typeof bfConeTargets === 'function'
        ? bfConeTargets(baseAngle + directions[di], 60, dirRange, pool) : [primary];
      dirTargets = sgFilterCleaveSectorTargets(dirTargets, baseAngle, di, directions.length);
      if (targetCap > 0) dirTargets = dirTargets.slice(0, targetCap);
      if (di === 0 && geomOk && primary.hp > 0 && dirTargets.indexOf(primary) < 0) {
        dirTargets.unshift(primary);
        if (targetCap > 0 && dirTargets.length > targetCap) dirTargets.pop();
      }
      // 四個扇形首尾相接；同一敵人只保留在第一個分配到的方向，避免邊界重複傷害。
      var uniqueDirTargets = [];
      for (var dui = 0; dui < dirTargets.length; dui++) {
        if (targets.indexOf(dirTargets[dui]) < 0) uniqueDirTargets.push(dirTargets[dui]);
      }
      dirTargets = uniqueDirTargets;
      directionTargets.push(dirTargets);
      for (var dti = 0; dti < dirTargets.length; dti++) {
        if (targets.indexOf(dirTargets[dti]) < 0) targets.push(dirTargets[dti]);
      }
    }
  } else {
    if (targetCap <= 0 && geomOk && typeof bfEnemiesInArea === 'function' &&
        typeof bfPlayerPos === 'function' && typeof bfLiveList === 'function') {
      var cleaveCenter = bfPlayerPos();
      targets = bfEnemiesInArea({ x: cleaveCenter.x, y: cleaveCenter.y, r: meleeRangePx }, bfLiveList(pool));
      if (primary && primary.hp > 0 && targets.indexOf(primary) < 0) targets.unshift(primary);
    } else {
      // 有目標上限時：主目標＋其餘隨機（沒有任何敘述指定要挑最近的）。
      targets = [primary].concat(bfRandomOthers(primary, pool, Math.max(0, targetCap - 1), 0, null));
    }
    // 震碎斬／裂空飛斬：斬擊向前飛出，聯集路徑上的敵人
    if (frontFlyPx > 0 && geomOk) {
      var line = bfLineTargets(baseAngle, frontFlyPx, pool);
      for (var li = 0; li < line.length; li++) if (targets.indexOf(line[li]) < 0) targets.push(line[li]);
    }
    directionTargets.push(targets);
  }
  var cleaveVariant = lvs[6] > 0 ? (isFlying ? 'cleave-cross-shockwave' : 'cleave-cross')
    : (isFlying ? 'cleave-shockwave' : 'cleave');
  var directionRanges = [];
  for (var dri = 0; dri < directions.length; dri++) {
    var rangeFly = lvs[6] > 0 ? crossRangePx : ((dri === 0) ? frontFlyPx : sideFlyPx);
    directionRanges.push(rangeFly > 0 ? rangeFly : meleeRangePx);
  }
  var cleaveVfxRange = lvs[6] > 0 ? Math.max.apply(Math, directionRanges) : frontFlyPx;
  /* lineLength＝弧光實際要飛多遠（像素）。不帶的話兩個渲染器都會退回寫死的 120px，
     傳奇【裂空飛斬】的 60 米就只會飛出 1/5 的距離。 */
  sgEmitVfx('cleave', targets, floatSel, {
    fxKind: 'slash', variant: cleaveVariant, count: Math.min(5, slashes), projectile: isFlying,
    lineLength: cleaveVfxRange, directionRanges: lvs[6] > 0 ? directionRanges : null,
    rangeScale: cleaveRangeScale, color: '#60a5fa'
  });
  var stunChance = lvs[4] > 0 ? sgVal(t[4].fx, 'chance', lvs[4]) : 0;
  var stunSec = lvs[4] > 0 ? sgVal(t[4].fx, 'sec', lvs[4]) : 0;

  /* 傳奇【乘虛之斬】：對暈眩中的敵人額外增傷。走 sgHitOne 的總傷加成參數，
     因此仍完整經過防禦、抗性與爆擊（比照水龍捲對凍結目標的作法）。 */
  var stunnedBonusPct = Math.max(0, Number(lg.cleaveStunnedDmgPct) || 0);
  var bonusFor = function (target) {
    return (stunnedBonusPct > 0 && sgIsStunned(target)) ? stunnedBonusPct : 0;
  };
  var hookCfg = {
    pEnt: pEnt, st: st, floatSel: floatSel,
    tornado: ultWind ? {
      m: sgUltVal(ultWind, 'm'), pct: sgUltVal(ultWind, 'pct'),
      hits: Math.max(1, sgRollCount(sgUltVal(ultWind, 'hits'))),
      gap: Math.max(0.1, Number(ultWind.def.fx.gap) || 0.4)
    } : null
  };
  var onCleaveHit = function (target, res, ctx) { sgCleaveOnHit(hookCfg, target, res, ctx); };
  var whirl = lg.cleaveWhirl || null;

  if (isFlying) {
    for (var ps = 0; ps < slashes; ps++) {
      if (whirl) sgCleaveWhirlwind(pEnt, st, whirl, pool, floatSel, out, ps);
      for (var pdi2 = 0; pdi2 < directions.length; pdi2++) {
        var dirFly2 = lvs[6] > 0 ? crossRangePx : ((pdi2 === 0) ? frontFlyPx : sideFlyPx);
        var projectileLen = dirFly2 > 0
          ? dirFly2
          : meleeRangePx;
        sgQueueFlyingProjectile(pEnt, st, 'cleave', dmgVal,
          (typeof bfPlayerPos === 'function' && geomOk) ? bfPlayerPos() : null,
          geomOk ? baseAngle + directions[pdi2] : 0, projectileLen, floatSel,
          directionTargets[pdi2],
          { stunChance: stunChance, stunSec: stunSec, onHit: onCleaveHit, bonusPctFn: bonusFor,
            coneDeg: lvs[6] > 0 ? 60 : 0, coneBaseAngle: baseAngle,
            coneIndex: lvs[6] > 0 ? pdi2 : -1, coneCount: lvs[6] > 0 ? directions.length : 0 }, out);
      }
    }
    return;
  }
  for (var s = 0; s < slashes; s++) {
    if (whirl) sgCleaveWhirlwind(pEnt, st, whirl, pool, floatSel, out, s);
    for (var di2 = 0; di2 < directionTargets.length; di2++) {
      for (var ti = 0; ti < directionTargets[di2].length; ti++) {
        var victim = directionTargets[di2][ti];
        var res = sgHitOne(pEnt, st, victim, dmgVal, 'cleave', floatSel, out, sgStaggerMs(s), bonusFor(victim));
      // 暈眩擊：每次命中獨立判定（BOSS 免疫與控場遞減由低階寫入器負責）
        if (res && !res.miss && stunChance > 0 && chance(stunChance)) {
          if (!(typeof isBossControlImmune === 'function' && isBossControlImmune(victim)) &&
              !(typeof resistCtrl === 'function' && resistCtrl(monsterDefCfg(victim)))) {
            applyStatus(victim, 'stun', { dur: stunSec });
          }
        }
        onCleaveHit(victim, res, null);
      }
    }
  }
}

/* ---- 飛刀 ----
   飛刀有四種發射來源：主刀、彈射、傳奇【分裂者】的小刀、超神【無限追魂刃】。
   命中、彈射與命中後觸發全部收斂到 sgKnifeHit／sgKnifeBounceChain 兩支，
   效果才不會只在其中一種形態下生效（比照突刺／迴旋斬的共用掛鉤設計）。
   cfg 由 sgCastKnife 一次算好（純資料，不含幾何）。 */

var SG_KNIFE_PATH_HALF_M = 1;   // 超神【暴雨梨花】判定飛行路徑的半寬（米）
var SG_KNIFE_WALTZ_RPS = 1;     // 傳奇【輪舞刃】刀環每秒轉幾圈

/* 超神【暴雨梨花】：兩點之間的飛行路徑上，所有敵人各吃一段。
   起點與終點由呼叫端自己結算（終點吃的是完整傷害），這裡排除掉避免重複計算。
   無座標（高塔）時整段退化為不作用，與本系統其他幾何查詢的退化規則一致。 */
function sgKnifePathHit(cfg, fromEnt, toEnt, delayMs) {
  if (!(cfg.pathPct > 0) || typeof bfLineTargets !== 'function' || typeof bfPos !== 'function') return;
  var a = fromEnt ? bfPos(fromEnt) : ((typeof bfPlayerPos === 'function') ? bfPlayerPos() : null);
  var b = toEnt ? bfPos(toEnt) : null;
  if (!a || !b) return;
  var dx = b.x - a.x, dy = b.y - a.y;
  var len = Math.sqrt(dx * dx + dy * dy);
  if (!(len > 0)) return;
  var line = bfLineTargets(Math.atan2(dy, dx), len, cfg.pool, bfMeterPx(SG_KNIFE_PATH_HALF_M), a);
  var dmg = cfg.dmgVal * cfg.pathPct / 100;
  for (var i = 0; i < line.length; i++) {
    if (line[i] === toEnt || line[i] === fromEnt) continue;
    sgKnifeHit(cfg, line[i], dmg, delayMs, 0, true);
  }
}

/* 飛刀的一次命中（含命中後的所有觸發）。
   derived＝路徑貫穿／分裂刃造成的命中：仍計入死亡收割的擊殺，但不再往下分裂，
   否則「分裂刃殺人再分裂」會無限展開。 */
function sgKnifeHit(cfg, target, dmgVal, delayMs, bonusPct, derived) {
  if (!target || target.hp <= 0 || !(dmgVal > 0)) return null;
  var res = sgHitOne(cfg.pEnt, cfg.st, target, dmgVal, 'knife', cfg.floatSel, cfg.out, delayMs, bonusPct || 0);
  if (!res || res.miss) return res;
  if (res.crit && cfg.onCrit) cfg.onCrit();
  if (!res.killed) return res;
  /* 超神【死亡收割者】：飛刀每殺死 1 個敵人就疊 1 層「造成的所有傷害提高」。 */
  if (cfg.reaper && typeof applyStatus === 'function') {
    applyStatus(cfg.pEnt, 'sgDeathReaper', {
      val: cfg.reaper.pct, maxStacks: cfg.reaper.maxStacks, dur: cfg.reaper.dur
    });
  }
  /* 傳奇【分裂者】：擊殺處分裂出小型飛刀。 */
  if (cfg.split && !derived) sgKnifeSplit(cfg, target, delayMs);
  return res;
}

/* 下一個彈射目標：預設是本輪還沒彈過的敵人裡「隨機」一個——飛刀的敘述只寫
   「在附近的 N 個敵人間彈跳」，沒有規定範圍也沒有寫「最近」，因此候選是整個戰場、
   挑法是等機率隨機（彈射選法的唯一權威在 js/battlefield.js bfRandomOther）。
   傳奇【處刑者】是唯一的例外：它的敘述明寫「優先在生命值最高的目標間彈射」，
   屬於特別指定的規則，維持挑生命值最高者。都彈過就允許回跳。 */
function sgKnifeNextBounce(cfg, cur, visited) {
  if (cfg.execPct) {
    var near = bfNearestOthers(cur, cfg.pool, cfg.pool.length);
    var best = null;
    for (var i = 0; i < near.length; i++) {
      if (visited.indexOf(near[i]) >= 0) continue;
      if (!best || near[i].hp > best.hp) best = near[i];
    }
    if (best) return best;
  } else {
    var rnd = bfRandomOther(cur, cfg.pool, 0, visited);
    if (rnd) return rnd;
  }
  return (typeof bfRandomOther === 'function') ? bfRandomOther(cur, cfg.pool, 0, null) : null;
}

/* 彈射鏈：從 cur 出發連續彈射 bounces 次，所有飛刀來源共用這一支。
   chainMax／chainChance＝第 6 階【連鎖彈射】的機率追加（其餘來源傳 0）。 */
function sgKnifeBounceChain(cfg, cur, dmgVal, startDelay, bounces, chainMax, chainChance, derived, vfxVariant) {
  if (!(dmgVal > 0) || !(bounces > 0)) return;
  var visited = [cur];
  var delay = startDelay;
  var chained = 0;
  var b = 0;
  while (b < bounces) {
    b++;
    var next = sgKnifeNextBounce(cfg, cur, visited);
    // 允許 A→B→A，但任何自我彈射 A→A 都必須停止。
    if (!next || next === cur || next.hp <= 0) break;
    visited.push(next);
    var travel = (typeof bfTravelSeconds === 'function') ? Math.round(bfTravelSeconds(next) * 1000) : 0;
    sgEmitVfx('knife', [cur, next], cfg.floatSel, {
      fxKind: 'chain', variant: vfxVariant || 'knife-bounce', count: 1,
      delayMs: delay, travelMs: [0, travel]
    });
    sgKnifePathHit(cfg, cur, next, delay);
    var res = sgKnifeHit(cfg, next, dmgVal, delay + travel, cfg.execPct, derived);
    cur = next;
    delay += travel;
    // 連鎖彈射：本次彈射後有機率再彈一次（最多連續 chainMax 次）
    if (res && !res.miss && chained < chainMax && chainChance > 0 && chance(chainChance)) {
      bounces++;
      chained++;
    }
  }
}

/* 傳奇【分裂者】：擊殺處分裂出 N 把小型飛刀，各自再彈射固定次數。
   分裂刃一律以 derived 命中，因此不會再觸發分裂。 */
function sgKnifeSplit(cfg, from, delayMs) {
  var count = Math.max(1, Math.floor(Number(cfg.split.count) || 0));
  var dmg = cfg.dmgVal * (Number(cfg.split.pct) || 0) / 100;
  if (!(dmg > 0)) return;
  var bounces = Math.max(0, Math.floor(Number(cfg.split.bounces) || 0));
  // 【分裂者】的敘述沒有指定目標規則＝比照彈射，在整個戰場隨機挑（不是最近的 N 個）
  var near = bfRandomOthers(from, cfg.pool, count, 0, null);
  if (!near.length) return;
  for (var i = 0; i < count; i++) {
    var tgt = near[i % near.length];
    if (!tgt || tgt.hp <= 0) continue;
    var travel = (typeof bfTravelSeconds === 'function') ? Math.round(bfTravelSeconds(tgt) * 1000) : 0;
    sgEmitVfx('knife', [from, tgt], cfg.floatSel, {
      fxKind: 'chain', variant: 'knife-bounce', count: 1, delayMs: delayMs, travelMs: [0, travel]
    });
    sgKnifePathHit(cfg, from, tgt, delayMs);
    sgKnifeHit(cfg, tgt, dmg, delayMs + travel, cfg.execPct, true);
    sgKnifeBounceChain(cfg, tgt, dmg, delayMs + travel, bounces, 0, 0, true);
  }
}

/* 傳奇【輪舞刃】：第 1 把飛刀不再射出，改為圍繞自身旋轉的刀環。
   幾何與節拍的唯一權威是環繞場域 sgSpawnOrbitField（火狩／雷球／虛空斬同一套）。 */
function sgKnifeWaltz(pEnt, st, cfg, waltz) {
  if (typeof sgSpawnOrbitField !== 'function') return;
  var r = bfMeterPx(Number(waltz.m) || 0);
  if (!(r > 0)) return;
  sgSpawnOrbitField(pEnt, st, 'knife', {
    floatSel: cfg.floatSel, lifeSec: Math.max(0.5, Number(waltz.sec) || 0),
    dmgVal: cfg.dmgVal, bodyR: bfMeterPx(1), count: 1,
    rings: [{ r: r, spin: Math.PI * 2 * SG_KNIFE_WALTZ_RPS }],
    fieldKey: 'knife-waltz', statusId: 'sgKnifeWaltz',
    /* 沿用虛空斬的圓盤（同樣是「繞著自己轉的一圈刀刃」），屬性改物理＝配色轉為中性；
       另立新變體會在兩個渲染器都沒有對應分支時整個沒有畫面。 */
    auraVariant: 'void-disc', hitVariant: 'knife-strike', hitElem: 'phys'
  });
}

/* 超神【無限追魂刃】：額外射出 1 支追擊範圍內任意敵人的飛刀，傷害提高、彈射次數不受限制。
   「不受限制」以「場上每個敵人各被命中一次」收斂——彈射規則允許回跳（A→B→A），
   單純不設上限會讓迴圈永遠不結束。 */
function sgKnifeSoulhunter(cfg, ult) {
  var live = (typeof bfLiveList === 'function') ? bfLiveList(cfg.pool)
    : (cfg.pool || []).filter(function (e) { return e && e.hp > 0; });
  if (!live.length) return;
  var rPx = bfMeterPx(sgUltVal(ult, 'm'));
  var inRange = live;
  if (rPx > 0 && typeof bfEntityDistance === 'function') {
    var near = [];
    for (var i = 0; i < live.length; i++) {
      var d = bfEntityDistance(live[i]);
      // 無座標（高塔）的敵人距離為 null／NaN：一律視為在範圍內，退化為純單體追擊
      if (!(d > 0) || d <= rPx) near.push(live[i]);
    }
    if (near.length) inRange = near;
  }
  var first = inRange[Math.floor(Math.random() * inRange.length)];
  if (!first || first.hp <= 0) return;
  var dmg = cfg.dmgVal * (1 + sgUltVal(ult, 'pct') / 100);
  var travel = (typeof bfTravelSeconds === 'function') ? Math.round(bfTravelSeconds(first) * 1000) : 0;
  sgEmitVfx('knife', [first], cfg.floatSel, {
    fxKind: 'projectile', variant: 'knife-soulhunter', count: 1, travelMs: [travel]
  });
  sgKnifePathHit(cfg, null, first, 0);
  sgKnifeHit(cfg, first, dmg, travel, cfg.execPct, false);
  sgKnifeBounceChain(cfg, first, dmg, travel, Math.max(1, live.length - 1), 0, 0, false,
    'knife-soulhunter');
}

function sgCastKnife(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var lg = sgLegend('knife');
  var ultPetal = sgUlt('knife', 'petalStorm');
  var ultReaper = sgUlt('knife', 'deathReaper');
  var ultSoul = sgUlt('knife', 'soulhunterBlade');
  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[1] > 0) pct += sgVal(t[1].fx, 'pct', lvs[1]);
  pct += Number(lg.skillDamagePct) || 0;
  var dmgVal = st.atk * pct / 100;
  var geomOk = (typeof bfPos === 'function') && !!bfPos(primary);
  // 傳奇【影刃】：射出的飛刀數量 +N（扇形與全圓形兩種鎖敵型態都適用）
  var countAdd = Math.max(0, Math.floor(Number(lg.knifeCountAdd) || 0));
  var targets;
  var kCount;
  if (lvs[4] > 0) {
    // 迴旋飛刀：全圓形範圍鎖敵；敘述是「向周圍的 N 個敵人丟出飛刀」，沒有指定最近＝隨機
    kCount = Math.max(1, sgRollCount(sgVal(t[4].fx, 'count', lvs[4])) + countAdd);
    targets = bfRandomOthers(null, pool, kCount, 0, null);
  } else {
    kCount = Math.max(1, Math.floor(Number(t[0].fx.count) || 3) + countAdd);
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

  var bouncePct = lvs[2] > 0 ? sgVal(t[2].fx, 'pct', lvs[2]) : 0;
  var cdrSec = lvs[6] > 0 ? sgVal(t[6].fx, 'sec', lvs[6]) : 0;
  var cdKey = SG_PREFIX + 'knife';
  function onCrit() {
    if (cdrSec > 0 && pEnt.skillCds && pEnt.skillCds[cdKey] > 0) {
      pEnt.skillCds[cdKey] = Math.max(0, pEnt.skillCds[cdKey] - cdrSec);
    }
  }

  var cfg = {
    pEnt: pEnt, st: st, pool: pool, floatSel: floatSel, out: out, dmgVal: dmgVal, onCrit: onCrit,
    // 超神【暴雨梨花】：飛行路徑上的敵人各吃一段（占本體技能傷害的比例）
    pathPct: ultPetal ? sgUltVal(ultPetal, 'pct') : 0,
    // 超神【死亡收割者】：擊殺疊層的傷害增益
    reaper: ultReaper ? {
      pct: sgUltVal(ultReaper, 'pct'),
      maxStacks: Math.max(1, Math.floor(sgUltVal(ultReaper, 'maxStacks'))),
      dur: sgUltVal(ultReaper, 'dur')
    } : null,
    // 傳奇【分裂者】：擊殺分裂；【處刑者】：優先跳向生命值最高的目標並對其增傷
    split: lg.knifeSplit || null,
    execPct: lg.knifeExecutor ? (Number(lg.knifeExecutor.pct) || 0) : 0
  };

  /* 傳奇【輪舞刃】：第 1 把飛刀改為刀環（因此下面的迴圈跳過 index 0）。 */
  var waltz = lg.knifeOrbit || null;
  if (waltz) sgKnifeWaltz(pEnt, st, cfg, waltz);

  /* targets 一個代表一把刀；count 必須固定為 1，否則顯示層會把每把刀再複製 kCount 次。 */
  var flying = waltz ? knives.slice(1) : knives;
  if (flying.length) {
    sgEmitVfx('knife', flying, floatSel, {
      fxKind: 'projectile', variant: 'knife', count: 1,
      travelMs: travelMs ? travelMs.slice(waltz ? 1 : 0) : null
    });
  }

  for (var ki = waltz ? 1 : 0; ki < knives.length; ki++) {
    var delay = (travelMs && travelMs[ki]) || 0;
    sgKnifePathHit(cfg, null, knives[ki], 0);
    var res = sgKnifeHit(cfg, knives[ki], dmgVal, delay, 0, false);
    if (!res || res.miss || bouncePct <= 0) continue;
    // 彈射：基礎彈射數（第 3 階）＋強化彈射（第 4 階）＋傳奇【連鎖】；連鎖彈射（第 6 階）機率追加
    var bounces = Math.max(1, Math.floor(Number(t[2].fx.count) || 1)) +
      (lvs[3] > 0 ? sgRollCount(sgVal(t[3].fx, 'add', lvs[3])) : 0) +
      Math.max(0, Math.floor(Number(lg.knifeBounceAdd) || 0));
    var chainMax = lvs[5] > 0 ? Math.max(0, Math.floor(Number(t[5].fx.max) || 4)) : 0;
    var chainChance = lvs[5] > 0 ? sgVal(t[5].fx, 'chance', lvs[5]) : 0;
    // 首發飛到第一個目標的時間也是彈射鏈的起點；後續每段再接續前一段飛行時間。
    sgKnifeBounceChain(cfg, knives[ki], dmgVal * bouncePct / 100, delay, bounces, chainMax, chainChance, false);
  }

  if (ultSoul) sgKnifeSoulhunter(cfg, ultSoul);
}

/* ---- 疾風斬 ----
   本體斬擊、擴散、均分（月牙斬／千鳥）三條結算路徑共用同一支命中掛鉤 sgGaleOnHit，
   傳奇特效與超神進化才不會只在其中一種型態下生效（比照突刺／迴旋斬）。
   cfg 由 sgCastGale 一次算好（純資料，不含幾何）。 */

/* 傳奇【風捲殘雲】：命中處生成一道龍捲風（地板場域，逐段結算風系傷害）。
   與迴旋斬超神【逐風者】同一種場域，差別只在觸發條件與參數來源。 */
function sgGaleTornado(cfg, target) {
  if (typeof sgSpawnGround !== 'function') return;
  var spec = cfg.tornado;
  sgSpawnGround(cfg.pEnt, cfg.st, 'gale', {
    tgt: target, floatSel: cfg.floatSel, kind: 'windtornado',
    radius: bfMeterPx(Number(spec.m) || 0), dmgVal: cfg.dmgVal * (Number(spec.pct) || 0) / 100,
    hits: Math.max(1, Math.floor(Number(spec.hits) || 1)), gap: Number(spec.gap) || 0.4,
    hitElem: 'wind'
  });
}

/* 超神【雷神斬】：命中處降下 1 道落雷，對該處周圍範圍內的敵人造成閃電傷害。 */
function sgGaleThunderBolt(cfg, target) {
  var r = bfMeterPx(Number(cfg.bolt.m) || 0);
  var victims = sgEnemiesAround(target, cfg.pool, r);
  if (target.hp > 0) victims.push(target);
  if (!victims.length) return;
  sgEmitVfx('gale', victims, cfg.floatSel, {
    fxKind: 'rain', variant: 'thunder-strike', elem: 'lightning', count: 1,
    area: (typeof sgAreaAround === 'function') ? sgAreaAround(target, r) : null
  });
  var dmg = cfg.dmgVal * (Number(cfg.bolt.pct) || 0) / 100;
  for (var i = 0; i < victims.length; i++) {
    sgHitOne(cfg.pEnt, cfg.st, victims[i], dmg, 'gale', cfg.floatSel, cfg.out, 0, 0, 'lightning');
  }
}

/* 疾風斬的「命中之後」掛鉤。這裡的每一項都只由單次斬擊命中觸發，
   衍生命中（雙影的追加、雷神斬的落雷）一律不再回頭觸發本支，避免無限展開。 */
function sgGaleOnHit(cfg, target, res) {
  if (!target || !res || res.miss) return;
  /* 傳奇【神速斬】：每次命中使疾風斬的冷卻時間 -N 秒（沿用第 6 階【極速斬】的同一個冷卻鍵）。 */
  if (cfg.cdrSec > 0 && cfg.pEnt.skillCds && cfg.pEnt.skillCds[cfg.cdKey] > 0) {
    cfg.pEnt.skillCds[cfg.cdKey] = Math.max(0, cfg.pEnt.skillCds[cfg.cdKey] - cfg.cdrSec);
  }
  /* 傳奇【風捲殘雲】：機率在目標處形成龍捲風。 */
  if (cfg.tornado && chance(Number(cfg.tornado.chance) || 0)) sgGaleTornado(cfg, target);
  /* 傳奇【風行者】：附加風切狀態。移速／命中率折減與層數規則的唯一權威是
     sgApplyWindRend（真空斬與暴風屏障用的是同一支），這裡只提供每跳傷害。 */
  if (cfg.windRend && target.hp > 0 && typeof sgApplyWindRend === 'function') {
    sgApplyWindRend(target, cfg.windRend);
  }
  /* 超神【雷神斬】：命中處降下落雷。 */
  if (cfg.bolt) sgGaleThunderBolt(cfg, target);
  /* 傳奇【雙影】：機率額外對附近 1 個敵人造成傷害。 */
  if (cfg.twin && chance(Number(cfg.twin.chance) || 0)) {
    // 「額外對附近 1 個敵人造成傷害」沒有指定最近＝範圍內隨機
    var other = bfRandomOthers(target, cfg.pool, 1, bfMeterPx(Number(cfg.twin.m) || 0), null)[0];
    if (other && other.hp > 0) {
      sgHitOne(cfg.pEnt, cfg.st, other, cfg.dmgVal * (Number(cfg.twin.pct) || 0) / 100,
        'gale', cfg.floatSel, cfg.out, 0);
    }
  }
  /* 傳奇【斬殺】：機率立即殺死生命值門檻以下的非 BOSS 敵人。
     放在最後，前面的觸發才不會因為目標已死而整批跳過。 */
  if (cfg.execute && target.hp > 0 && !target.isBoss && !target.towerBoss &&
      target.maxHp > 0 && target.hp <= target.maxHp * (Number(cfg.execute.hpPct) || 0) / 100 &&
      chance(Number(cfg.execute.chance) || 0)) {
    sgDerivedHit(target, target.hp, 'gale', cfg.floatSel, cfg.out, '💀', 0);
  }
}

function sgCastGale(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var lg = sgLegend('gale');
  var ultFlash = sgUlt('gale', 'thunderFlash');
  var ultBolt = sgUlt('gale', 'thunderGodSlash');
  var ultChidori = sgUlt('gale', 'chidori');
  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[2] > 0) pct += sgVal(t[2].fx, 'pct', lvs[2]);
  pct += Number(lg.skillDamagePct) || 0;
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

  var cdKey = SG_PREFIX + 'gale';
  var cfg = {
    pEnt: pEnt, st: st, pool: pool, floatSel: floatSel, out: out, dmgVal: dmgVal, cdKey: cdKey,
    // 傳奇【神速斬】：每次命中的冷卻縮減秒數
    cdrSec: Math.max(0, Number(lg.galeCdrSec) || 0),
    // 傳奇【風捲殘雲】／【雙影】／【斬殺】
    tornado: lg.galeTornado || null,
    twin: lg.galeTwin || null,
    execute: lg.galeExecute || null,
    /* 傳奇【風行者】：風切的每跳傷害＝本體技能傷害 × cutPct%，換算成每秒量交給狀態引擎；
       移速 -80%／命中率 -50%／持續 4 秒全部沿用風切狀態表的既有數值。 */
    windRend: lg.galeWindRend ? {
      per: dmgVal * (Number(lg.galeWindRend.cutPct) || 0) / 100 / sgWindRendGap(),
      extra: 0, dur: sgWindRendDur(), interval: sgWindRendGap()
    } : null,
    // 超神【雷神斬】：每次斬擊命中附加的落雷
    bolt: ultBolt ? { pct: sgUltVal(ultBolt, 'pct'), m: sgUltVal(ultBolt, 'm') } : null
  };

  sgEmitVfx('gale', shareMode ? shareTargets : [primary], floatSel, {
    fxKind: 'slash', count: Math.min(5, hits), variant: 'gale-slashes'
  });
  for (var h = 0; h < hits; h++) {
    if (shareMode) {
      // 超神【千鳥】：月牙斬不再均分，改為每個敵人都吃完整傷害，且傷害再額外提高
      var total = dmgVal * (1 + sgVal(t[6].fx, 'pct', lvs[6]) / 100);
      if (ultChidori) total *= 1 + sgUltVal(ultChidori, 'pct') / 100;
      var alive = shareTargets.filter(function (e) { return e && e.hp > 0; });
      if (!alive.length) break;
      var share = ultChidori ? total : total / alive.length;
      for (var si = 0; si < alive.length; si++) {
        var sres = sgHitOne(pEnt, st, alive[si], share, 'gale', floatSel, out, sgStaggerMs(h));
        sgGaleOnHit(cfg, alive[si], sres);
      }
    } else {
      var pres = sgHitOne(pEnt, st, primary, dmgVal, 'gale', floatSel, out, sgStaggerMs(h));
      sgGaleOnHit(cfg, primary, pres);
    }
    // 擴散：每次斬擊額外打 10 米內最近的敵人；附近沒有敵人時改對原目標
    if (lvs[3] > 0) {
      var extra = bfNearestOthers(primary, pool, 1, bfMeterPx(sgVal(t[3].fx, 'm', lvs[3])))[0] || primary;
      var eres = sgHitOne(pEnt, st, extra, dmgVal * sgVal(t[3].fx, 'pct', lvs[3]) / 100, 'gale', floatSel, out, sgStaggerMs(h + 1));
      sgGaleOnHit(cfg, extra, eres);
    }
  }
  // 狂風斬：攻速增益（突破上限、與自身攻速相乘——掛點在戰鬥迴圈的乘算區）
  if (lvs[4] > 0) {
    applyStatus(pEnt, 'sgGale', { val: sgVal(t[4].fx, 'pct', lvs[4]), dur: sgVal(t[4].fx, 'sec', lvs[4]) });
  }
  /* 超神【霹靂一閃】：最後一斬改為對自身周圍範圍內的敵人打出「單段傷害 × 連擊數 × 倍率」。
     只在所有斬擊結算完之後打一次，因此不受 hits 迴圈影響。 */
  if (ultFlash) sgGaleThunderFlash(cfg, ultFlash, hits);
}

/* 超神【霹靂一閃】：疾風斬的最後一斬對自身周圍範圍內的敵人造成連擊數倍的傷害。 */
function sgGaleThunderFlash(cfg, ult, hits) {
  var r = bfMeterPx(sgUltVal(ult, 'm'));
  var victims = (typeof bfEnemiesInArea === 'function' && typeof bfPlayerPos === 'function' &&
    typeof bfLiveList === 'function')
    ? bfEnemiesInArea({ x: bfPlayerPos().x, y: bfPlayerPos().y, r: r }, bfLiveList(cfg.pool))
    : (cfg.pool || []).filter(function (e) { return e && e.hp > 0; });
  if (!victims.length) return;
  sgEmitVfx('gale', victims, cfg.floatSel, {
    fxKind: 'impact', variant: 'thunder-burst', elem: 'lightning', dur: 0.4
  });
  var dmg = cfg.dmgVal * Math.max(1, hits) * Math.max(0, sgUltVal(ult, 'mult'));
  for (var i = 0; i < victims.length; i++) {
    var res = sgHitOne(cfg.pEnt, cfg.st, victims[i], dmg, 'gale', cfg.floatSel, cfg.out,
      sgStaggerMs(hits), 0, 'lightning');
    sgGaleOnHit(cfg, victims[i], res);
  }
}

/* ---- 血刃斬 ---- */
/* 流血／中毒的每跳傷害＝技能傷害基準 × dotPct%；作用間隔可被第 2 階縮短（跳更快＝總傷更高），
   因此以 ctx.dps 直接指定每秒傷害（每跳量 ÷ 間隔），繞過狀態表「狀態傷害＝每秒量」的預設換算。

   ---- 第三批傳奇進化的接線（2026-08-20）----
   施放路徑本身只多兩件事：斬擊倍率（切割）與機率再揮一次（血影）。其餘四個都不在這裡：
     毒血祭     → sgBloodbladeDotSpec（傷害那半）＋ sgApplyBloodbladeDot（生命代價那半）
     毒爆／血霧 → skills2OnEnemyDeath（敵人死亡後才留下場域）
     崩解（超神）→ sgApplyBloodbladeDot（塗抹當下就結算完，狀態根本不會被建立）
   掛在塗抹函式而不是施放函式，是因為「初次塗抹／屍爆傳染／零日感染傳染」三條路徑
   共用同一支塗抹；掛在那裡三邊才會一起吃到，不必各自改寫。 */

var SG_BLOODBLADE_SECOND_MS = 160;   // 傳奇【血影】第 2 斬的飄字錯開（傷害仍在同一拍結算）

function sgCastBloodblade(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var lg = sgLegend('bloodblade');
  sgBloodbladeSlash(pEnt, st, g, lvs, pool, primary, floatSel, out, lg, 0);
  // 傳奇【血影】：機率揮出第 2 斬。第 2 斬與第 1 斬完全同規格（含流血／中毒塗抹）
  var second = lg.bloodSecondSlash;
  if (second && primary.hp > 0 && chance(Number(second.chance) || 0)) {
    sgBloodbladeSlash(pEnt, st, g, lvs, pool, primary, floatSel, out, lg, SG_BLOODBLADE_SECOND_MS);
  }
}

/* 單次斬擊：命中 → 塗流血 →（有第 4 階再）塗中毒。血影的第 2 斬重跑同一支。 */
function sgBloodbladeSlash(pEnt, st, g, lvs, pool, primary, floatSel, out, lg, delayMs) {
  var t = g.tiers;
  var baseVal = st.atk * sgVal(t[0].fx, 'pct', lvs[0]) / 100;
  /* 傳奇【切割】：只放大斬擊本體。流血／中毒的基準仍是未加成的技能傷害
     ——設計文檔寫的是「斬擊傷害 +100%」，不是「血刃斬的所有傷害 +100%」。 */
  var slashPct = Math.max(0, Number(lg.bloodSlashPct) || 0);
  sgEmitVfx('bloodblade', [primary], floatSel, { fxKind: 'slash' });
  var res = sgHitOne(pEnt, st, primary, baseVal, 'bloodblade', floatSel, out, delayMs, slashPct);
  if (!res || res.miss || primary.hp <= 0) return;

  var dotCtx = { enemies: pool, floatSel: floatSel, out: out };
  // 流血：每 dotGap 秒造成技能傷害 dotPct% 的傷害
  sgApplyBloodbladeDot(primary, 'sgBleed', sgBloodbladeDotSpec(st, lvs, t, 'sgBleed'), 0, dotCtx);
  sgEmitVfx('bloodblade', [primary], floatSel, { fxKind: 'curse', variant: 'bleed' });

  // 血毒刃：流血的同時中毒（毒屬性）
  if (lvs[3] > 0) {
    sgApplyBloodbladeDot(primary, 'sgPoison', sgBloodbladeDotSpec(st, lvs, t, 'sgPoison'), 0, dotCtx);
    sgEmitVfx('bloodblade', [primary], floatSel, {
      fxKind: 'curse', variant: 'poison', elem: 'poison'
    });
  }
}

/* ---- 雙刀亂舞 ---- */
/* ---- 第三批傳奇進化的接線（2026-08-20）----
     雙生刃   → 擊中目標數量 +2
     狂舞     → 暴風之舞期間每施放 1 次就把下一拍的間隔按比例縮短（改寫 SKILL2_RT.storm.gap）
     狂戰士   → 鐵血之舞的比例放大；生命損失與敵人流血同吃，因為兩者本來就是同一個 ironPct
     殺千刀   → 本次施放每殺 1 個敵人就延長暴風之舞
     不屈之誓 → 不在這裡：死亡攔截掛在 skills2TryDeathDefer（js/combat.js onPlayerFieldDeath）
   超神進化：
     毀滅之舞 → 施放代價（當下生命%）＋ 本次施放的總傷加成
     火之神樂 → 每次命中疊 1 層【神樂灼焰】
     修羅亂舞 → 不在施放路徑上：它改的是裝備規則（skills2AsuraDualWield） */
function sgCastDualdance(pEnt, st, g, lvs, pool, primary, floatSel, out, storm) {
  var t = g.tiers;
  var lg = sgLegend('dualdance');
  /* 化身是否「在這次施放之前」就已經在跑：狂舞與殺千刀都是「暴風之舞持續時間中」的效果，
     必須排除「這一次施放剛好把化身開起來」的那一拍，否則開場那次會白白吃到一次加成。 */
  var stormOn = !!(SKILL2_RT.storm && SKILL2_RT.storm.until > GT);
  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[2] > 0) pct += sgVal(t[2].fx, 'pct', lvs[2]);
  var dmgVal = st.atk * pct / 100;

  /* 超神進化【毀滅之舞】：每次施放都付出生命，換來本次施放的總傷加成。
     代價取「當下生命」的比例並保底留 1 點，因此暴風之舞的自動施放（每 gap 秒一次）
     會讓生命指數逼近 1 點而不會踏過死亡線——這也讓它與同群組 T6【嗜血狂化】
    （生命／護盾每少 1% 就加技能傷害）形成刻意的正回饋，而不是變成自殺鍵。
     加成走 sgHitOne 的 bonusTotalPct，完整經過防禦、抗性與爆擊。 */
  var doomPct = 0;
  var doom = sgUlt('dualdance', 'doomDance');
  if (doom) {
    doomPct = sgUltVal(doom, 'pct');
    var cost = Math.max(0, sgUltVal(doom, 'hpPct'));
    if (cost > 0 && pEnt.hp > 1) {
      pEnt.hp = Math.max(1, pEnt.hp - Math.max(1, Math.round(pEnt.hp * cost / 100)));
    }
  }

  var strikes = Math.max(1, Math.floor(Number(t[0].fx.count) || 2) +
    (lvs[1] > 0 ? sgRollCount(sgVal(t[1].fx, 'add', lvs[1])) : 0) +
    sgDanceTargetAdd(lg));
  // 「對附近 N 個敵人各造成 1 次」沒有指定最近＝隨機（候選同原本＝整個戰場）
  var targets = bfRandomOthers(null, pool, strikes, 0, null);
  if (!targets.length) targets = [primary];
  sgEmitVfx('dualdance', targets, floatSel, {
    fxKind: 'slash', count: Math.min(5, strikes), variant: storm ? 'dual-storm' : 'dual-slash'
  });
  var kaguraSpec = sgKaguraSpec(sgUlt('dualdance', 'flameKagura'), dmgVal);
  var kills = 0;
  for (var s = 0; s < strikes; s++) {
    var tgt = targets[s % targets.length];
    var res = sgHitOne(pEnt, st, tgt, dmgVal, 'dualdance', floatSel, out, sgStaggerMs(s), doomPct);
    if (!res || res.miss) continue;
    if (res.killed) { kills++; continue; }
    // 超神進化【火之神樂】：每命中 1 次疊 1 層灼焰（疊層規則由狀態表的 stack 處理）
    if (kaguraSpec) sgApplyKagura(tgt, kaguraSpec);
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
    /* 傳奇【狂戰士】：生命損失與傷害「同時」提高——兩者本來就共用這一個比例，
       放大它就同時放大兩邊，不必分開處理。 */
    var ironPct = sgVal(t[4].fx, 'pct', lvs[4]) * (1 + sgDanceIronAmpPct(lg) / 100);
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
  // 傳奇【狂舞】與【殺千刀】：兩者都只在「本次施放之前化身就已經在跑」時才作用。
  if (stormOn && SKILL2_RT.storm) sgDanceStormLegends(pEnt, lg, kills);
}

/* 暴風之舞期間的兩個傳奇效果。節拍器 sgTickStorm 每拍讀 stm.gap 與 stm.until，
   因此這裡直接改那兩個欄位就會反映在下一拍上。 */
function sgDanceStormLegends(pEnt, lg, kills) {
  var stm = SKILL2_RT.storm;
  // 狂舞：下一次的施放間隔按比例縮短（複利；下限由 sgTickStorm 的 Math.max(0.1, gap) 兜底）
  var gapPct = sgDanceStormGapPct(lg);
  if (gapPct > 0) stm.gap = Math.max(0.1, stm.gap * (1 - gapPct / 100));
  // 殺千刀：每殺 1 個敵人延長化身時間（依設計無上限），並同步刷新增益圖示的剩餘時間
  var killSec = sgDanceStormKillSec(lg);
  if (kills > 0 && killSec > 0) {
    stm.until += killSec * kills;
    applyBuff(pEnt, 'sgStorm', 1, Math.max(0.1, stm.until - GT), 'sgStorm');
  }
}

/* 傳奇【雙生刃】：擊中目標數量 +N。 */
function sgDanceTargetAdd(lg) {
  var spec = lg && lg.danceTargetAdd;
  return spec ? Math.max(0, Math.floor(Number(spec.count) || 0)) : 0;
}
/* 傳奇【狂戰士】：鐵血之舞的比例加成%。 */
function sgDanceIronAmpPct(lg) {
  var spec = lg && lg.danceIronAmp;
  return spec ? Math.max(0, Number(spec.pct) || 0) : 0;
}
/* 傳奇【狂舞】：暴風之舞每施放 1 次縮短的間隔比例%（夾在 90% 以內，避免一次歸零）。 */
function sgDanceStormGapPct(lg) {
  var spec = lg && lg.danceStormGap;
  return spec ? Math.max(0, Math.min(90, Number(spec.pct) || 0)) : 0;
}
/* 傳奇【殺千刀】：每殺 1 個敵人延長的化身秒數。 */
function sgDanceStormKillSec(lg) {
  var spec = lg && lg.danceStormKill;
  return spec ? Math.max(0, Number(spec.sec) || 0) : 0;
}

/* 超神進化【火之神樂】的灼焰規格：每層每 gap 秒造成技能傷害 pct%。
   疊層交給狀態表的 stack 規則（applyDot 會把 dps 換算成「單層值 × 層數」），
   因此這裡給的一律是**單層**的每秒量。沒選這個超神進化就回 null。 */
function sgKaguraSpec(ult, dmgVal) {
  if (!ult || !(dmgVal > 0)) return null;
  var gap = Math.max(0.1, sgUltVal(ult, 'gap') || 0.5);
  return {
    dps: dmgVal * sgUltVal(ult, 'pct') / 100 / gap,
    dur: Math.max(0.2, sgUltVal(ult, 'dur') || 6),
    interval: gap,
    maxStacks: Math.max(1, Math.floor(sgUltVal(ult, 'maxStacks') || 1))
  };
}
function sgApplyKagura(ent, spec) {
  if (!ent || !spec || ent.hp <= 0) return;
  applyStatus(ent, 'sgKagura', {
    dps: spec.dps, dur: spec.dur, interval: spec.interval, maxStacks: spec.maxStacks
  });
}

/* ---- 傳奇【不屈之誓】：暴風之舞期間的死亡延後 ----
   掛點與【天地共生】同一個：js/combat.js onPlayerFieldDeath——野外四條判死路徑
  （敵人攻擊、持續傷害、自傷技能、反震）唯一的共同出口。
   延後期間任何一次再死亡都只是把生命夾回 1 點；時間到了由 sgTickDeathDefer
   把生命歸零，讓戰鬥迴圈原本的判死流程接手**真正的**死亡。 */
function skills2TryDeathDefer(pEnt) {
  if (!pEnt || !SKILL2_RT) return false;
  var d = SKILL2_RT.deathDefer;
  if (d) {
    if (d.until > GT) { pEnt.hp = Math.max(1, pEnt.hp); return true; }
    return false;                       // 已經用過而且到期：這一次是真的死亡
  }
  if (!(SKILL2_RT.storm && SKILL2_RT.storm.until > GT)) return false;
  var spec = sgLegend('dualdance').danceDeathDefer;
  var sec = spec ? Math.max(0, Number(spec.sec) || 0) : 0;
  if (!(sec > 0)) return false;
  SKILL2_RT.deathDefer = { until: GT + sec };
  pEnt.hp = Math.max(1, pEnt.hp);
  applyStatus(pEnt, 'sgDeathDefer', { val: Math.max(0, Number(spec.pct) || 0), dur: sec });
  sgEmitPlayerVfx('dualdance', 'pv-float', { fxKind: 'aura', variant: 'cyclone', dur: Math.min(6, sec) });
  if (typeof floatPlayerEvent === 'function') floatPlayerEvent('pv-float', '不屈之誓!', 'buff');
  if (typeof blog === 'function') {
    blog('🕯️ 【不屈之誓】你的死亡被推遲 ' + sec + ' 秒——這段時間你造成的傷害大幅提高！', 'info');
  }
  if (typeof UI !== 'undefined' && UI.dirty) UI.dirty.battle = true;
  return true;
}

/* 延後期到了就把生命歸零：下一次戰鬥迴圈的判死會呼叫 onPlayerFieldDeath，
   此時 skills2TryDeathDefer 回 false，死亡如期生效（不會再延後第二次）。 */
function sgTickDeathDefer(ctx) {
  var d = SKILL2_RT.deathDefer;
  if (!d || d.until > GT || d.done) return;
  /* 只兌現一次。少了 done 旗標的話，只要這次死亡沒有真的成立（最典型是【天地共生】
     在延後期間冷卻結束、把玩家原地滿血復活並在 onPlayerFieldDeath 就 return，
     RT 因此不會被 resetSkillRT 重建），這裡就會每個 tick 把生命重新歸零＝直接鎖死。 */
  d.done = true;
  if (ctx.pEnt && ctx.pEnt.hp > 0) ctx.pEnt.hp = 0;
}

/* ---- 嗜血狂怒（純增益爆發；傷害為 0，訊息由 castSkill2 尾端統一處理） ---- */
function sgCastBloodrage(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var dur = Number(t[0].fx.sec) || 8;
  SKILL2_RT.rage = { until: GT + dur, pEnt: pEnt, killCombo: 0 };
  applyStatus(pEnt, 'sgBloodrage', { val: sgRageAspdPct(lvs), dur: dur });
  sgEmitVfx('bloodrage', pool, floatSel, { fxKind: 'aura', variant: 'bloodrage-aura', dur: Math.min(6, dur) });
}

/* ===========================================================================
   魔法系共用基建：燃燒（sgBurn）
   ---------------------------------------------------------------------------
   火球術第 2 階與火龍捲第 4 階塗的是**同一個**狀態，因此火球術第 5 階【爆燃】與
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
  var burnMultiplier = lvs[6] > 0 ? 2 : 1;
  var gap = Math.max(0.1, lvs[3] > 0
    ? sgVal(t[3].fx, 'gap', lvs[3])
    : (Number(t[1].fx.dotGap) || 0.5));
  return {
    dps: base * sgVal(t[1].fx, 'dotPct', lvs[1]) / 100 * burnMultiplier / gap,
    dur: Number(t[1].fx.dotSec) || 5,
    interval: gap
  };
}

/* 火龍捲的燃燒規格（第 4 階未投資＝不燃燒）。每跳量占的是火龍捲「每段」的技能傷害。 */
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

/* 我方周圍 radiusPx 內隨機 count 個存活敵人（不重複；count <= 0＝全取）。
   「範圍內挑 N 個」的通則：技能敘述沒有寫「最近」就是範圍內等機率隨機
   （規則說明見 js/battlefield.js 的 bfRandomOthers）。候選集合與 sgEnemiesNearPlayer
   完全相同（含「無座標的高塔實體視為在範圍內」），只有挑法不同。 */
function sgRandomEnemiesNearPlayer(enemies, radiusPx, exclude, count) {
  var cands = sgEnemiesNearPlayer(enemies, radiusPx, exclude, 0);
  for (var i = cands.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = cands[i]; cands[i] = cands[j]; cands[j] = tmp;
  }
  return (count > 0) ? cands.slice(0, count) : cands;
}

/* 我方周圍 radiusPx 內隨機 1 個存活敵人（火龍捲【重生】的落點規則：任意敵人，不是最近的）。 */
function sgRandomEnemyNearPlayer(enemies, radiusPx, exclude) {
  var picked = sgRandomEnemiesNearPlayer(enemies, radiusPx, exclude, 1);
  return picked.length ? picked[0] : null;
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
  // 「對我方 m 米內的 count 個敵人」沒有指定最近＝範圍內隨機
  var victims = sgRandomEnemiesNearPlayer(enemies, bfMeterPx(Number(fx.m) || 12), ent, count);
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
  /* 燃燒可能同時掛在整群敵人身上（火球爆炸＋分裂＋火龍捲），逐一送特效事件會把
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
   施放時只鎖定落點目標；victims 不在此建立，等待 at 到期後才重新查詢範圍。
   extra（選填）＝天降打擊佇列的泛用欄位：gid／特效變體／落地回呼／每目標傷害加成，
   讓落雷術與雷殞天落共用同一條「落地才結算」的時間軸，不必各自複製一份排程器。 */
function sgQueueMeteor(pEnt, st, dmgVal, target, pool, radius, burnSpec, floatSel, out, at, extra) {
  SKILL2_RT.meteors.push({
    at: at, target: target, pool: pool, radius: radius, pEnt: pEnt, st: st, dmgVal: dmgVal,
    burnSpec: burnSpec, floatSel: floatSel, out: out,
    gid: (extra && extra.gid) || 'fireball',
    variant: (extra && extra.variant) || 'meteor-impact',
    elem: (extra && extra.elem) || null,
    /* bonusPctFn(target)＝落地當下才決定的總傷加成%（殛道落雷要看目標是否正在暈眩）；
       onImpact(meteor, victims, ctx)＝落地後的附加效果（震暈、再生一道落雷）。 */
    bonusPctFn: (extra && extra.bonusPctFn) || null,
    onImpact: (extra && extra.onImpact) || null
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
    /* 只有這裡才讀取落點周圍的敵人；敵人若在落地前死亡或移出範圍，
       就不會被這一發扣血。radius ≤ 0＝單體落點（落雷術），不做範圍查詢：
       半徑 0 的圓仍會涵蓋「身體壓到落點中心」的旁邊敵人，那不是單體技能該有的行為。 */
    var victims = (m.radius > 0 && typeof bfTargetsAround === 'function')
      ? bfTargetsAround(m.target, m.pool || [], m.radius)
      : ((m.target && m.target.hp > 0) ? [m.target] : []);
    for (var vi = 0; vi < victims.length; vi++) {
      var target = victims[vi];
      if (!target || target.hp <= 0) continue;
      var bonusPct = m.bonusPctFn ? m.bonusPctFn(target) : 0;
      var res = sgHitOne(m.pEnt, m.st, target, m.dmgVal, m.gid, m.floatSel, m.out, 0, bonusPct);
      if (res && !res.miss && m.burnSpec) sgApplyBurn(target, m.burnSpec);
      if (res && res.killed) killed = true;
    }
    if (victims.length) {
      sgEmitVfx(m.gid, victims, m.floatSel, {
        fxKind: 'impact', variant: m.variant, elem: m.elem, area: sgAreaAround(m.target, m.radius)
      });
    }
    if (m.onImpact) m.onImpact(m, victims, ctx);
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
        // 「射向目標 m 米內的敵人」沒有指定最近＝範圍內隨機
        splitTargets = bfRandomOthers(primary, pool,
          Math.max(1, Math.floor(Number(splitFxPlan.count) || 3)),
          bfMeterPx(Number(splitFxPlan.m) || 20), null);
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
   火龍捲（firepillar）：地板場域
   ---------------------------------------------------------------------------
   火龍捲不是「一次結算完」的技能：它釘在地板上、按節拍反覆作用，還可能重生。
   因此建立執行期場域實例（SKILL2_RT.grounds，不入存檔），由 tickSkill2 推進。
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
  if (lvs[2] > 0) pct += sgVal(t[2].fx, 'pct', lvs[2]); // 雙重火龍捲：火屬性傷害額外加成
  var dmgVal = sgGroupBaseStat(g, st) * pct / 100;
  var hits = Math.max(1, Math.floor(Number(srcFx.hits) || 5));
  var lifeSec = Math.max(0.2, Number(t[0].fx.sec) || 2.5);
  var gap = lifeSec / hits;
  // 強化火龍捲：範圍擴大（火龍捲＝半徑、火牆＝長寬同步放大）
  var scale = lvs[1] > 0 ? 1 + sgVal(t[1].fx, 'pct', lvs[1]) / 100 : 1;
  var burnSpec = sgFirepillarBurnSpec(g, lvs, dmgVal);

  var count = wall
    ? Math.max(1, Math.floor(Number(t[6].fx.count) || 3))
    : (lvs[2] > 0 ? Math.max(1, Math.floor(Number(t[2].fx.count) || 2)) : 1);
  var spreadPx = lvs[2] > 0 ? bfMeterPx(Number(t[2].fx.m) || 20) : skills2CastRangePx('firepillar', lvs);
  var spots = [primary];
  // 「可同時對 m 米內的 count 個目標施放火柱」沒有指定最近＝範圍內隨機
  if (count > 1) spots = spots.concat(bfRandomOthers(primary, pool, count - 1, spreadPx, null));

  for (var i = 0; i < count; i++) {
    // 目標不足時多出來的火龍捲疊在主目標身上（比照雙刀亂舞「只有 1 個敵人就都打同一個」）
    var spot = spots[i % spots.length];
    sgSpawnGround(pEnt, st, 'firepillar', {
      kind: wall ? 'wall' : 'pillar', tgt: spot, floatSel: floatSel,
      radius: bfMeterPx(sgVal(t[0].fx, 'm', lvs[0])) * scale,
      length: bfMeterPx(Number(t[6].fx.len) || 18) * scale,
      width: bfMeterPx(Number(t[6].fx.wid) || 6) * scale,
      dmgVal: dmgVal, hits: hits, gap: gap,
      burnSpec: burnSpec, burnChance: lvs[3] > 0 ? sgVal(t[3].fx, 'chance', lvs[3]) : 0,
      respawnLeft: wall ? Math.max(0, Math.floor(Number(t[6].fx.respawn) || 0)) : 0,
      delaySec: i * gap * 0.2
    });
  }
}

/* 建立一個地板場域實例。pos 於此時定位（釘在地板上，之後與目標實體脫鉤——
   目標死了火龍捲也還在燒）。 */
function sgSpawnGround(pEnt, st, gid, cfg) {
  /* cfg.from＝指定出生座標（移動場域從玩家腳下出發、伴生雷球生在命中處）；
     留白＝比照火龍捲，出生在目標當下的位置。 */
  var p = (cfg.from && isFinite(cfg.from.x) && isFinite(cfg.from.y))
    ? { x: Number(cfg.from.x), y: Number(cfg.from.y) }
    : ((typeof bfPos === 'function' && cfg.tgt) ? bfPos(cfg.tgt) : null);
  var angle = (typeof bfAngleTo === 'function' && cfg.tgt) ? bfAngleTo(cfg.tgt) : null;
  var gap = Math.max(0.05, Number(cfg.gap) || 0.5);
  var startDelaySec = Math.max(0, Number(cfg.startDelaySec) || 0);
  SKILL2_RT.grounds.push({
    vfxId: 'sg-ground-' + (++SKILL2_RT.groundSeq),
    gid: gid, pEnt: pEnt, st: st, floatSel: cfg.floatSel, kind: cfg.kind,
    pos: p ? { x: p.x, y: p.y } : null,
    angle: (angle === null || angle === undefined) ? 0 : angle,
    radius: Math.max(0, Number(cfg.radius) || 0),
    length: Math.max(0, Number(cfg.length) || 0),
    width: Math.max(0, Number(cfg.width) || 0),
    dmgVal: Number(cfg.dmgVal) || 0,
    /* 場域傷害的屬性覆寫（比照環繞場域的 hitElem）：留白＝沿用群組層屬性。
       物理群組要打出風系段（逐風者的龍捲風）時就靠這一欄。 */
    hitElem: cfg.hitElem || null,
    hits: Math.max(1, Math.floor(Number(cfg.hits) || 1)),
    hitsLeft: Math.max(1, Math.floor(Number(cfg.hits) || 1)),
    gap: gap,
    startAt: GT + startDelaySec,
    wave: Math.max(0, Math.floor(Number(cfg.wave) || 0)),
    /* 預設第一拍在一個節拍之後（場域是「先出現、再開始作用」）；
       tickAtStart＝出生的那一刻就作用一次，給「由前一段飛行接手」的場域用
       （追蹤冰箭：貫穿箭消失的同一刻、同一個位置就要看到追擊的冰箭，
       中間不能空一個節拍的黑畫面）。總拍數由 hits 決定，因此不影響總傷害。 */
    nextAt: GT + startDelaySec + (cfg.tickAtStart ? 0 : gap) +
      Math.max(0, Number(cfg.delaySec) || 0),
    tgt: cfg.tgt || null,
    burnSpec: cfg.burnSpec || null,
    burnChance: Math.max(0, Number(cfg.burnChance) || 0),
    respawnLeft: Math.max(0, Math.floor(Number(cfg.respawnLeft) || 0)),
    /* 逐漸擴大的場域（泥沼術【沼澤漫延】）：尺寸的權威是「出生尺寸 × 當下成長倍率」，
       每跳重算一次；把成長寫進 length/width 本身會讓倍率被反覆複利。 */
    bornAt: GT,
    baseRadius: Math.max(0, Number(cfg.radius) || 0),
    baseLength: Math.max(0, Number(cfg.length) || 0),
    baseWidth: Math.max(0, Number(cfg.width) || 0),
    growTo: Math.max(1, Number(cfg.growTo) || 1),
    growSec: Math.max(0, Number(cfg.growSec) || 0),
    /* 移動場域（雷球）：沿直線飛向 dest，抵達後就地停駐到打完剩餘段數。
       速度以像素／秒表示；沒有 dest 或沒有座標＝原本的釘死在地板上。 */
    dest: (cfg.dest && isFinite(cfg.dest.x) && isFinite(cfg.dest.y))
      ? { x: Number(cfg.dest.x), y: Number(cfg.dest.y) } : null,
    speed: Math.max(0, Number(cfg.speed) || 0),
    /* 目前的飛行方向（弧度）：追擊場域沒有落點可追時沿著它直線飛出去。
       留白＝出生時未定，第一次朝落點移動才寫入；由前一段飛行接手的場域
       （追蹤冰箭承接貫穿段）則直接帶入當時的航向，才不會一出生就瞬間轉向。
       turnSide＝正後方迴轉時的慣用邊，依出生序號交替，不額外消耗亂數。 */
    moveAngle: (typeof cfg.moveAngle === 'number' && isFinite(cfg.moveAngle)) ? cfg.moveAngle : null,
    turnSide: (SKILL2_RT.groundSeq % 2) ? 1 : -1,
    /* 跟隨我方的場域（暴風雪）：圓心恆等於玩家當下座標，與環繞場域同一種錨定方式，
       差別只在形狀是地板矩形。留白＝原本的釘死在地板上。 */
    follow: !!cfg.follow,
    /* 追擊場域（追蹤冰箭）：抵達落點後改鎖 chaseM 米內的隨機敵人繼續飛。
       contact＝採環繞場域的接觸判定（進入才算一次命中、離開再進來才會再命中），
       否則以本場域的節拍頻率會變成「每個節拍全額命中一次」的傷害爆炸。 */
    chaseM: Math.max(0, Number(cfg.chaseM) || 0),
    contact: !!cfg.contact,
    contacts: [],
    /* 對凍結中的敵人的傷害倍率（水龍捲）；1＝沒有額外倍率。 */
    frozenMult: Math.max(1, Number(cfg.frozenMult) || 1),
    frostSpec: cfg.frostSpec || null,
    mire: cfg.mire || null
  });
}

/* 移動場域的一步：朝 dest 前進 speed × dt，抵達（或已無座標）就把 dest 清掉改為停駐。
   場域的傷害判定讀的就是 f.pos，因此位置一更新，這一拍的命中範圍就跟著走。
   三種移動方式共用這一支：跟隨我方（follow）、飛向落點後停駐（雷球）、
   抵達後改鎖隨機敵人繼續飛（chaseM＝追蹤冰箭）。 */
function sgGroundMove(f, dt, enemies) {
  if (f.startAt > GT) return;
  // 跟隨我方：位置的權威是玩家當下座標，不需要速度也不會停駐
  if (f.follow) {
    var pp = (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null;
    if (!pp) return;
    if (!f.pos) f.pos = { x: pp.x, y: pp.y };
    else { f.pos.x = pp.x; f.pos.y = pp.y; }
    return;
  }
  if (!f.pos || !(f.speed > 0) || !(dt > 0)) return;
  var step = f.speed * dt;
  if (f.chaseM > 0) sgGroundChaseStep(f, step, enemies);   // 追擊：有轉彎半徑的追蹤飛行
  else sgGroundFlyStep(f, step);                            // 直線飛向落點後停駐（雷球）
}

/* 追擊場域的轉彎半徑（像素）：子彈體積越大轉得越開（設計指定 4～8 米）。
   體積取場域自己的判定半徑——那就是這顆子彈實際的大小，不另外挑一組數字。 */
var SG_CHASE_TURN_MIN_M = 4;
var SG_CHASE_TURN_MAX_M = 8;
var SG_CHASE_TURN_BODY_REF_M = 5;   // 判定半徑到這個值就吃滿最大轉彎半徑
function sgGroundTurnRadiusPx(f) {
  var perM = (typeof bfMeterPx === 'function') ? bfMeterPx(1) : 10;
  if (!(perM > 0)) perM = 10;
  var bodyM = Math.max(0, Number(f.radius) || 0) / perM;
  var k = Math.max(0, Math.min(1, bodyM / SG_CHASE_TURN_BODY_REF_M));
  return (SG_CHASE_TURN_MIN_M + (SG_CHASE_TURN_MAX_M - SG_CHASE_TURN_MIN_M) * k) * perM;
}

/* 追擊場域的一步：方向以「最大轉彎速率」逼近落點，而不是每個 tick 直接對準它。
   一步能轉的角度＝這一步的弧長 ÷ 轉彎半徑，因此貫穿敵人之後不會原地掉頭水平折返，
   而是畫一個半徑 4～8 米的迴轉弧再繞回來。位移每個 tick 都是完整的 speed × dt。 */
function sgGroundChaseStep(f, step, enemies) {
  if (!f.dest) f.dest = sgGroundChaseDest(f, enemies);
  var turnR = sgGroundTurnRadiusPx(f);
  if (f.dest) {
    var dx = f.dest.x - f.pos.x, dy = f.dest.y - f.pos.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var want = Math.atan2(dy, dx);
    if (!isFinite(f.moveAngle)) f.moveAngle = want;
    var diff = Math.atan2(Math.sin(want - f.moveAngle), Math.cos(want - f.moveAngle));
    /* 正後方（差 180 度）時左轉右轉一樣近，交給場域出生時決定的慣用邊，
       同一批小風刃才不會整齊劃一地朝同一側轉。 */
    if (Math.abs(diff) > Math.PI - 1e-3) diff = (f.turnSide < 0 ? -1 : 1) * Math.PI;
    var maxTurn = turnR > 0 ? step / turnR : Math.PI;
    f.moveAngle += Math.max(-maxTurn, Math.min(maxTurn, diff));
    /* 換下一個落點：碰到了，或落點已經掉進自己的迴轉圈內又不在正前方——
       最小轉彎半徑限制下那種目標永遠繞不進去，硬追只會變成繞著它打轉。 */
    if (dist <= step || (dist <= turnR && Math.abs(diff) > Math.PI / 2)) {
      f.dest = sgGroundChaseDest(f, enemies);
    }
  }
  /* 沒有可追的目標（範圍內沒人、或只剩腳下那一個）時沿目前方向直線飛，不原地待命：
     追擊場域是接觸判定，停下來就等於不再命中任何東西。
     下一個 tick 仍會重新找落點，途中有敵人進入範圍就會轉回去追。 */
  if (!isFinite(f.moveAngle)) return;
  f.pos.x += Math.cos(f.moveAngle) * step;
  f.pos.y += Math.sin(f.moveAngle) * step;
}

/* 非追擊的移動場域（雷球）：直線飛向落點，抵達就地停駐到打完剩餘段數。 */
function sgGroundFlyStep(f, step) {
  if (!f.dest) return;
  var dx = f.dest.x - f.pos.x, dy = f.dest.y - f.pos.y;
  var dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > 1e-6) f.moveAngle = Math.atan2(dy, dx);
  if (dist <= step || dist <= 0.5) {
    f.pos.x = f.dest.x; f.pos.y = f.dest.y;
    f.dest = null;
    return;
  }
  f.pos.x += dx / dist * step;
  f.pos.y += dy / dist * step;
}

/* 追擊場域的下一個落點：以場域當下位置為圓心、chaseM 米內的隨機存活敵人
   （文檔：朝範圍內的隨機目標飛去——不是最近的）。
   **已經在自己判定圈內的敵人不算候選**：追擊場域是接觸判定，站在腳下的那一個
   早就結算過了，再把它挑成落點只會得到「距離 0 的目標」——場域就地停住、
   每個 tick 只跟著它抖幾個像素，那正是玩家看到的「小風刃一格一格移動」。
   全部候選都在腳下（或範圍內沒人）時回 null，交給 sgGroundMove 沿最後方向直線飛出去，
   飛出接觸圈後同一個敵人又會重新成為候選——來回穿梭因此是自然結果。 */
function sgGroundChaseDest(f, enemies) {
  if (!f.pos || typeof bfLiveList !== 'function' || typeof bfPos !== 'function') return null;
  var radius = bfMeterPx(f.chaseM);
  var near = Math.max(1, Number(f.radius) || 0);
  var live = bfLiveList(enemies || []);
  var cands = [];
  for (var i = 0; i < live.length; i++) {
    var p = bfPos(live[i]);
    if (!p) continue;
    var dx = p.x - f.pos.x, dy = p.y - f.pos.y;
    var d2 = dx * dx + dy * dy;
    if (d2 > radius * radius || d2 <= near * near) continue;
    cands.push(p);
  }
  if (!cands.length) return null;
  var pick = cands[Math.floor(Math.random() * cands.length)];
  return { x: pick.x, y: pick.y };
}

/* 場域當下的成長倍率（沒有設定成長＝恆為 1）。 */
function sgGroundGrowScale(f) {
  if (!(f.growTo > 1) || !(f.growSec > 0)) return f.growTo > 1 ? f.growTo : 1;
  var t = Math.max(0, Math.min(1, (GT - f.bornAt) / f.growSec));
  return 1 + (f.growTo - 1) * t;
}
function sgGroundApplyGrowth(f) {
  var s = sgGroundGrowScale(f);
  if (s === 1) return;
  f.radius = f.baseRadius * s;
  f.length = f.baseLength * s;
  f.width = f.baseWidth * s;
}

/* 矩形場域的長軸方位：火牆＝與我方視線垂直（橫向擋在面前）；
   泥沼＝軸對齊的正方形（一灘攤在地上的沼澤沒有「面向」）。 */
function sgGroundRectAxis(f) { return (f.kind === 'wall') ? f.angle + Math.PI / 2 : 0; }

/* 場域這一跳打到誰：火龍捲＝圓、火牆／泥沼＝矩形（以線段＋半寬表示）。
   無座標＝退化為固定打當初的目標。 */
function sgGroundVictims(f, enemies) {
  if (!f.pos) return (f.tgt && f.tgt.hp > 0) ? [f.tgt] : [];
  if (f.length > 0 && f.width > 0 && typeof bfSegmentTargets === 'function') {
    var axis = sgGroundRectAxis(f);
    var half = f.length / 2;
    var origin = { x: f.pos.x - Math.cos(axis) * half, y: f.pos.y - Math.sin(axis) * half };
    return bfSegmentTargets(origin, axis, 0, f.length, enemies, f.width / 2);
  }
  if (typeof bfEnemiesInArea !== 'function' || typeof bfLiveList !== 'function') return [];
  return bfEnemiesInArea({ x: f.pos.x, y: f.pos.y, r: f.radius }, bfLiveList(enemies));
}

/* 場域的一次作用：範圍內每個敵人各吃一段傷害，並依機率附加燃燒／寒霜。
   泥沼術本體不造成傷害（只給狀態），走各自的分支。 */
function sgGroundTick(f, enemies, ctx) {
  var victims = sgGroundVictims(f, enemies);
  if (f.kind === 'mire') { sgMireGroundTick(f, victims, ctx); return; }
  // 傳奇【血霧】：不造成傷害的場域，只把標記塗到範圍內的敵人身上（吸血在 skills2OnEnemyDamaged）
  if (f.kind === 'bloodmist') { sgBloodMistGroundTick(f, victims); return; }
  /* 接觸判定的場域（追蹤冰箭）：只結算「這一刻剛碰上」的敵人，離開後再碰到才會再命中。
     借用環繞場域的同一種語意，避免以節拍頻率反覆全額命中。 */
  if (f.contact) {
    var fresh = [];
    for (var ci = 0; ci < victims.length; ci++) {
      if (f.contacts.indexOf(victims[ci]) < 0) fresh.push(victims[ci]);
    }
    f.contacts = victims;
    victims = fresh;
  }
  sgEmitVfx(f.gid, victims, f.floatSel, sgGroundVfxSpec(f));
  if (!victims.length) return;
  var out = { killed: false, dmg: 0, crit: false };
  for (var i = 0; i < victims.length; i++) {
    /* 對凍結中的敵人的傷害倍率（水龍捲）：走 sgHitOne 的總傷加成參數，
       因此仍完整經過防禦、抗性與爆擊，不是事後再乘一次的獨立傷害。 */
    var bonusPct = (f.frozenMult > 1 && sgFrozenOn(victims[i])) ? (f.frozenMult - 1) * 100 : 0;
    var res = sgHitOne(f.pEnt, f.st, victims[i], f.dmgVal, f.gid, f.floatSel, out,
      sgStaggerMs(i), bonusPct, f.hitElem);
    if (!res || res.miss) continue;
    if (f.burnSpec && f.burnChance > 0 && chance(f.burnChance)) sgApplyBurn(victims[i], f.burnSpec);
    if (f.frostSpec && victims[i].hp > 0) sgApplyFrost(victims[i], f.frostSpec);
  }
  if (ctx && ctx.onDamage && out.dmg > 0) ctx.onDamage(out.dmg);
  if (out.killed && ctx && ctx.onDeaths) ctx.onDeaths();
}

/* 場域這一拍的特效規格：形狀決定畫法（火柱＝地面爆點、火牆＝直立牆、雷球＝球體），
   屬性交給 sgEmitVfx 由群組帶入，這裡不再寫死 fire。 */
function sgGroundVfxSpec(f) {
  var area = sgGroundArea(f);
  if (f.kind === 'wall') return { fxKind: 'aura', variant: 'firewall', elem: 'fire', dur: f.gap, area: area };
  if (f.kind === 'orb') return { fxKind: 'aura', variant: 'thunder-orb', dur: f.gap, area: area };
  if (f.kind === 'tornado') return { fxKind: 'aura', variant: 'water-tornado', elem: 'ice', dur: f.gap, area: area };
  /* 逐風者的龍捲風：沿用水龍捲的柱狀畫法，只換屬性配色（顯示層不認得 wind-tornado
     時會退回預設畫法，仍看得到範圍）。 */
  if (f.kind === 'windtornado') return { fxKind: 'aura', variant: 'wind-tornado', elem: 'wind', dur: f.gap, area: area };
  if (f.kind === 'blizzard') return { fxKind: 'aura', variant: 'blizzard', elem: 'ice', dur: f.gap, area: area };
  if (f.kind === 'icearrow') return { fxKind: 'aura', variant: 'ice-arrow-homing', elem: 'ice', dur: f.gap, area: area };
  if (f.kind === 'windblade') return { fxKind: 'aura', variant: 'wind-blade-homing', elem: 'wind', dur: f.gap, area: area };
  /* 毒爆／血霧留下的是一灘東西，語意與泥沼池相同，因此直接沿用 mire 的既有畫法；
     沿用既有 variant 而不是自創，是因為顯示層不認得的 variant 只會退回泛用光環。 */
  if (f.kind === 'poisonmist') return { fxKind: 'aura', variant: 'mire-poison', elem: 'poison', dur: f.gap, area: area };
  if (f.kind === 'bloodmist') return { fxKind: 'aura', variant: 'mire', elem: 'dark', dur: f.gap, area: area };
  return { fxKind: 'impact', variant: 'pillar', elem: 'fire', dur: f.gap, area: area };
}

/* 場域的地面範圍描述（顯示層用）。矩形場域帶 w/h/a 讓顯示層畫出方向正確的矩形；
   同時附上 r（外接圓半徑）讓不認得矩形的舊畫法仍有合理的退化尺寸。 */
function sgGroundArea(f) {
  if (!f.pos) return null;
  if (f.length > 0 && f.width > 0) {
    var rect = { id: f.vfxId, x: f.pos.x, y: f.pos.y, w: f.length, h: f.width,
      a: sgGroundRectAxis(f), r: Math.max(f.length, f.width) / 2 };
    /* 顯示層的跟隨／追蹤只讀這些欄位，不參與傷害幾何：
       暴風雪每幀直接貼玩家的畫面座標；冰箭／風刃只以 area.x/y
       在兩次模擬快照之間補間，destX／destY／speed 僅保留方向語意，
       不得由顯示層另建一條與傷害位置脫節的追擊路徑。 */
    if (f.follow) rect.follow = true;
    if ((f.kind === 'icearrow' || f.kind === 'windblade') && f.dest) {
      rect.destX = f.dest.x;
      rect.destY = f.dest.y;
      rect.speed = f.speed;
    }
    return rect;
  }
  var circle = { id: f.vfxId, x: f.pos.x, y: f.pos.y, r: f.radius };
  /* 泥沼池系列的畫法（毒爆／血霧沿用它）只讀 a.w／a.h，完全不讀 a.r：
     不補外接矩形的話，這兩種場域會被畫成固定尺寸，與實際判定範圍對不上。
     只補這兩種——其餘圓形場域（火柱／雷球／追蹤冰箭）的畫法都是讀 a.r，
     多給 w/h 反而可能改到已經調好的既有尺寸。 */
  if (f.kind === 'poisonmist' || f.kind === 'bloodmist') {
    circle.w = f.radius * 2;
    circle.h = f.radius * 2;
  }
  if (f.follow) circle.follow = true;
  if (f.kind === 'windblade' && f.dest) {
    circle.destX = f.dest.x;
    circle.destY = f.dest.y;
    circle.speed = f.speed;
  }
  if (f.kind === 'icearrow' && f.dest) {
    circle.destX = f.dest.x;
    circle.destY = f.dest.y;
    circle.speed = f.speed;
  }
  return circle;
}

/* 烈焰衝擊：場域消失時以場域當下位置為圓心重新查詢 6 米範圍。 */
function sgGroundImpactVictims(f, enemies, radius) {
  if (!f.pos) return (f.tgt && f.tgt.hp > 0) ? [f.tgt] : [];
  if (typeof bfEnemiesInArea !== 'function' || typeof bfLiveList !== 'function') return [];
  return bfEnemiesInArea({ x: f.pos.x, y: f.pos.y, r: radius }, bfLiveList(enemies));
}

/* 場域消失：火牆的再召喚（第 7 階，每道只能再觸發一次）與火龍捲的重生（第 6 階，
   機率成立就在我方範圍內的隨機敵人身上重來一次）；第 5 階烈焰衝擊也在此結算。 */
function sgGroundExpire(f, enemies, ctx) {
  if (f.kind === 'mire') { sgMireGroundExpire(f, enemies, ctx); return; }
  /* 下面整段是**火龍捲樹的階序**（第 5 階烈焰衝擊、第 6 階重生、火牆再召喚），
     因此改用白名單：只有火龍捲自己生出來的場域才跑，其餘群組的場域一律直接消散。
     原本寫成「排除雷球」的黑名單，追蹤冰箭與風刃場域會誤跑進來，
     以自己第 5／6 階的 fx 去讀 m／pct／chance（都不存在＝0），
     結果是「0 傷害卻照樣播一發火焰衝擊波特效」。 */
  if (f.kind !== 'pillar' && f.kind !== 'wall') return;
  var lvs = skills2Levels(f.gid);
  var t = SKILLS2[f.gid].tiers;
  if (lvs[4] > 0) {
    var impactRadius = bfMeterPx(sgVal(t[4].fx, 'm', lvs[4]));
    var impactVictims = sgGroundImpactVictims(f, enemies, impactRadius);
    var impactPct = sgVal(t[4].fx, 'pct', lvs[4]);
    if (lvs[2] > 0) impactPct += sgVal(t[2].fx, 'pct', lvs[2]);
    var impactDmg = sgGroupBaseStat(SKILLS2[f.gid], f.st) * impactPct / 100;
    var impactOut = { killed: false, dmg: 0, crit: false };
    /* 即使範圍內暫時沒有敵人，也要播出場域消失的爆炸衝擊波。 */
    sgEmitVfx(f.gid, impactVictims, f.floatSel, {
      fxKind: 'burst', variant: 'firepillar-impact', elem: 'fire',
      area: f.pos ? { x: f.pos.x, y: f.pos.y, r: impactRadius } : null
    });
    for (var ii = 0; ii < impactVictims.length; ii++) {
      sgHitOne(f.pEnt, f.st, impactVictims[ii], impactDmg, f.gid, f.floatSel,
        impactOut, sgStaggerMs(ii));
    }
    if (ctx && ctx.onDamage && impactOut.dmg > 0) ctx.onDamage(impactOut.dmg);
    if (impactOut.killed && ctx && ctx.onDeaths) ctx.onDeaths();
  }
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
    dmgVal: f.dmgVal, hits: f.hits, gap: f.gap,
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
    if (f.startAt > GT) continue;
    var guard = 0;
    sgGroundMove(f, dt, enemies);   // 移動／跟隨／追擊場域：作用前先推進到當下位置
    sgGroundApplyGrowth(f);   // 逐漸擴大的場域：作用前先更新到當下尺寸
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
   火狩與火龍捲同為「持續存在的場域」，差別只在錨點：火龍捲釘在地板座標上，
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
    hitElem: 'fire',
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
    /* 泛用欄位（火狩以外的群組用得到）：狀態鍵、環繞體與命中的特效變體、命中回呼。
       留白＝火狩原本的行為，因此既有呼叫端不必改。 */
    statusId: cfg.statusId || 'sgFirehunt',
    auraVariant: cfg.auraVariant || 'firehunt',
    hitVariant: cfg.hitVariant || 'fire-explosion',
    hitElem: cfg.hitElem || (SKILLS2[gid] && SKILLS2[gid].elem) || 'fire',
    onStrike: cfg.onStrike || null,
    /* 半徑成長（虛空斬）：環半徑每秒加長多少像素。0＝固定半徑（火狩／環體電球原本的行為）。
       成長是「平滑的」——每個 tick 依 dt 累加，不是每秒跳一次（設計文檔明列此要求）。 */
    growPxPerSec: Math.max(0, Number(cfg.growPxPerSec) || 0),
    startAng: Number(cfg.startAng) || 0,
    fieldKey: cfg.fieldKey || null,
    rings: [], orbs: [], vfxUntil: 0
  };
  var count = Math.max(1, Math.floor(Number(cfg.count) || 1));
  var startAng = f.startAng;
  for (var i = 0; i < cfg.rings.length; i++) {
    var ring = { r: Math.max(1, Number(cfg.rings[i].r) || 0), spin: Number(cfg.rings[i].spin) || 0 };
    f.rings.push(ring);
    for (var k = 0; k < count; k++) {
      var orb = sgOrbitOrb(startAng + Math.PI * 2 * k / count, ring);
      orb.ringIdx = i;
      f.orbs.push(orb);
      // 狩神之舞：出現時自帶伴生（母體與伴生體依規則都不可再伴生）
      if (cfg.bornWithCompanion) { orb.canSpawn = false; f.orbs.push(sgOrbitCompanion(f, orb)); }
    }
  }
  f.vfxUntil = f.until;
  SKILL2_RT.orbits.push(f);
  sgOrbitSyncStatus(pEnt, f.statusId);
  sgOrbitEmitVfx(f);
}

/* 環繞場域的剩餘時間掛成狀態（狀態表 sgFirehunt），玩家才看得到還剩幾秒——
   【再生】每擊殺一個敵人就把 until 往後推，累積後的總剩餘時間只有這裡看得出來。
   取這名玩家身上所有環繞場域中**最晚結束**的那一個：狀態列一個技能只呈現一格，
   多重施放時該顯示的當然是「火狩還會在場多久」，不是其中某一組的殘餘。
   狀態與場域共用同一個時鐘 GT，因此必定同時到期，不需要另外清除。 */
function sgOrbitSyncStatus(pEnt, statusId) {
  if (!pEnt) return;
  var sid = statusId || 'sgFirehunt';
  var list = SKILL2_RT.orbits, until = 0;
  for (var i = 0; i < list.length; i++) {
    /* 只比同一個狀態鍵的環繞場域：火狩與環體電球是兩個技能、兩格狀態，
       共用一個剩餘時間會讓其中一邊顯示成另一邊的秒數。 */
    if (list[i] && list[i].pEnt === pEnt && (list[i].statusId || 'sgFirehunt') === sid &&
        list[i].until > until) until = list[i].until;
  }
  if (until > GT) applyStatus(pEnt, sid, { dur: until - GT });
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
/* 環繞體此刻的世界座標（圓心＝當下的玩家座標）；無座標時回傳 null。 */
function sgOrbitPos(orb, center) {
  if (!center || !orb) return null;
  return { x: center.x + Math.cos(orb.ang) * orb.radius, y: center.y + Math.sin(orb.ang) * orb.radius };
}

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
  /* 半徑成長（虛空斬）：環半徑是權威，環繞體每一步都回頭讀自己那一環的當下半徑。 */
  if (f.growPxPerSec > 0 && dt > 0) {
    for (var gi = 0; gi < f.rings.length; gi++) f.rings[gi].r += f.growPxPerSec * dt;
    for (var oi = 0; oi < f.orbs.length; oi++) {
      var ring = f.rings[f.orbs[oi].ringIdx || 0];
      if (ring) f.orbs[oi].radius = ring.r;
    }
  }
  var out = { killed: false, dmg: 0, crit: false };
  var born = [];
  var struck = [];
  var extended = false;
  var strikes = [];
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
      /* 一顆環繞體這一拍只算「一次命中」（設計文檔：受擊一次可能命中多個敵人，
         但也只算一次命中機率）——伴生雷球的機率判定因此掛在這裡去重。 */
      if (f.onStrike && strikes.indexOf(orb) < 0) strikes.push(orb);
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
  if (extended) sgOrbitSyncStatus(f.pEnt, f.statusId);
  for (var si = 0; si < strikes.length; si++) f.onStrike(f, strikes[si], sgOrbitPos(strikes[si], center), ctx);
  if (struck.length) {
    sgEmitVfx(f.gid, struck, f.floatSel, {
      fxKind: 'impact', variant: f.hitVariant, elem: f.hitElem, dur: 0.35
    });
  }
  if (ctx && ctx.onDamage && out.dmg > 0) ctx.onDamage(out.dmg);
  if (out.killed && ctx && ctx.onDeaths) ctx.onDeaths();
}

/* 環繞特效：一道一則事件，帶上模擬層實際判定的環半徑、火狩體積、旋轉方向與角速度；
   圓心送出施放當下的玩家座標，顯示層以自己的玩家錨點逐幀跟隨（火狩跟著玩家跑）。 */
function sgOrbitEmitVfx(f) {
  var center = (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null;
  var dur = Math.max(0.5, f.until - GT);
  var perRing = Math.max(1, Math.round(f.orbs.length / Math.max(1, f.rings.length)));
  for (var i = 0; i < f.rings.length; i++) {
    sgEmitVfx(f.gid, f.tgt ? [f.tgt] : [], f.floatSel, {
      fxKind: 'aura', variant: f.auraVariant, elem: f.hitElem, dur: dur, count: perRing,
      area: {
        x: center ? center.x : 0, y: center ? center.y : 0, r: f.rings[i].r,
        orbR: f.bodyR, orbs: perRing, spin: f.rings[i].spin >= 0 ? 1 : -1,
        spinRate: f.rings[i].spin,
        startAng: f.startAng,
        id: f.fieldKey || null,
        /* 顯示層據此逐幀把環半徑補成連續的（模擬層只在建立時送一次事件）。 */
        grow: f.growPxPerSec || 0
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

/* 我方自身的特效事件（護盾光殼、復活光柱等）：sgEmitVfx 的目標一律走敵人定址，
   自身增益要用這一支才會畫在我方卡片上。 */
function sgEmitPlayerVfx(gid, floatSel, extra) {
  if (typeof playCombatVfx !== 'function') return;
  var g = SKILLS2[gid];
  if (!g) return;
  var sel = (typeof playerEventFloatTarget === 'function') ? playerEventFloatTarget(floatSel) : floatSel;
  var cat = sgVfxCat(g);
  var spec = {
    fxKind: (extra && extra.fxKind) || 'aura', glyph: g.emoji,
    color: (typeof VFX_CAT_COLORS !== 'undefined' && VFX_CAT_COLORS[cat]) || '#a3a3a3',
    cat: cat, elem: (extra && extra.elem) || g.elem || null,
    /* area＝以玩家為圓心的範圍提示（永久領域）。帶 id 時顯示層會把它當同一個場域重用節點，
       沒有 id 就會退化成以座標當快取鍵——領域跟著玩家走，那等於每次都新建一個。 */
    targets: [sel], area: (extra && extra.area) || null,
    dur: (extra && extra.dur) || 0.6, count: 1
  };
  if (extra && extra.variant) spec.variant = extra.variant;
  playCombatVfx(spec);
}

/* ===========================================================================
   岩甲術（rockarmor）：護盾爆發
   ---------------------------------------------------------------------------
   施放給自己一層占最大生命比例的護盾，並在護盾存在期間開啟一整組「以護盾為燃料」
   的效果。權威狀態＝SKILL2_RT.rock（until／base／pEnt），sgRockArmor 增益只是投影：
     - base ＝ 施放當下實際拿到的護盾量。T6 的「每減少 1% 護盾」與 T7 的「護盾剩餘量」
       都以它為分母，不能改用 pEnt.shieldMax——護盾被打光的那一刻 shieldMax 會歸零
       （formula.js refreshShieldMaxAfterGain），分母跟著消失，最後一段損失就漏算了。
   生效條件（使用者決策 2026-08-17）：
     - 第 4 階【護盾增幅】＝主動型被動，裝配在技能列即恆時生效（不必先放技能）
     - 第 3、5、6、7 階一律綁岩甲護盾：沒有護盾期間就沒有效果
       （否則第 7 階會變成「平時 0 護盾＝白拿滿額減傷、放了技能反而變弱」的反向設計）
   =========================================================================== */
function sgCastRockarmor(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[1] > 0) pct += sgVal(t[1].fx, 'pct', lvs[1]);   // 強化岩甲：與第 1 階累加
  var dur = Math.max(0.5, Number(t[0].fx.sec) || 10);
  var before = Math.max(0, pEnt.shield || 0);
  applyStatus(pEnt, 'shield', { val: pct, dur: dur, stats: st });
  applyStatus(pEnt, 'sgRockArmor', { val: pct, dur: dur });
  /* base 取「這次施放後的護盾總量」而不是增量：護盾是共用的一池（applyShield 取 max），
     分母用增量會在既有護盾較高時算出負數比例。 */
  SKILL2_RT.rock = {
    until: GT + dur, pEnt: pEnt,
    base: Math.max(1, Math.max(before, pEnt.shield || 0)), amp: 0
  };
  sgEmitPlayerVfx('rockarmor', floatSel, { fxKind: 'aura', variant: 'rock-armor', elem: 'earth', dur: Math.min(6, dur) });
  if (typeof floatPlayerEvent === 'function') {
    var pSel = (typeof playerEventFloatTarget === 'function') ? playerEventFloatTarget(floatSel) : floatSel;
    floatPlayerEvent(pSel, '🪨+' + fmt(Math.max(0, (pEnt.shield || 0) - before)), 'shield');
  }
}

/* 岩甲護盾是否生效中（RT 為權威；增益圖示只是投影）。 */
function skill2RockActive(pEnt) {
  var rt = SKILL2_RT && SKILL2_RT.rock;
  if (!rt || rt.until <= GT) return false;
  return !pEnt || pEnt === rt.pEnt;
}
/* 綁護盾的那幾階目前是否可用：回傳等級陣列或 null。 */
function skill2RockLevels(pEnt) {
  if (!skill2RockActive(pEnt)) return null;
  var lvs = skills2Levels('rockarmor');
  return (lvs && lvs[0] >= 1) ? lvs : null;
}
/* 護盾剩餘比例 0~1（岩甲期間才有意義）。 */
function skill2RockShieldRemain(pEnt) {
  var rt = SKILL2_RT && SKILL2_RT.rock;
  if (!rt || !(rt.base > 0) || !pEnt) return 0;
  return Math.max(0, Math.min(1, (pEnt.shield || 0) / rt.base));
}

/* 【護盾增幅】（T4，主動型被動）：對「護盾效率%」屬性的額外乘算增幅。
   掛點：formula.js st.shieldEff 派生點——一處收斂，applyShield／grantShield／
   溢出轉護盾三條路徑一體生效。 */
function skill2ShieldEffFactor() {
  if (!skills2Equipped('rockarmor')) return 1;
  var lvs = skills2Levels('rockarmor');
  if (!lvs || lvs[3] < 1) return 1;
  return 1 + sgVal(SKILLS2.rockarmor.tiers[3].fx, 'pct', lvs[3]) / 100;
}

/* 【岩甲增幅】（T6）目前的傷害增幅%。掛點：formula.js 我方輸出最終乘區。 */
function skill2RockAmpPct(pEnt) {
  if (!skill2RockActive(pEnt)) return 0;
  return (typeof buffVal === 'function') ? Math.max(0, buffVal(pEnt, 'sgRockAmp')) : 0;
}

/* 岩甲術的受擊結算（T3 尖刺反擊／T5 失血轉護盾／T6 失盾轉增幅）。 */
function sgRockOnPlayerDamaged(mEnt, pEnt, hpDamage, res, floatSel) {
  var lvs = skill2RockLevels(pEnt);
  if (!lvs) return;
  var t = SKILLS2.rockarmor.tiers;
  var st = getStats();
  var rt = SKILL2_RT.rock;
  var absorbed = Math.max(0, (res && res.absorbed) || 0);

  // T3 岩甲尖刺：獨立的一段地屬性反擊傷害（走完整傷害管線＝吃地屬性加成與敵人地抗）
  if (lvs[2] > 0 && mEnt && mEnt.hp > 0) {
    var spikeVal = st.hp * sgVal(t[2].fx, 'pct', lvs[2]) / 100;
    var eSel = (typeof THORN_FLOAT_MAP !== 'undefined' && THORN_FLOAT_MAP[floatSel]) || floatSel;
    var spikeOut = { killed: false, dmg: 0, crit: false };
    sgEmitVfx('rockarmor', [mEnt], eSel, { fxKind: 'impact', variant: 'rock-spike', elem: 'earth' });
    sgHitOne(pEnt, st, mEnt, spikeVal, 'rockarmor', eSel, spikeOut, 0);
    if (spikeOut.killed && typeof onFieldDeaths === 'function' &&
        typeof FIELD !== 'undefined' && FIELD && FIELD.player === pEnt) {
      onFieldDeaths();
    }
  }

  // T5 岩之再生：每減少 1% 生命 → 獲得最大生命 pct% 的護盾（pct=1 時等量換回）
  if (lvs[4] > 0 && hpDamage > 0 && st.hp > 0 && typeof grantShield === 'function') {
    var gain = grantShield(pEnt, hpDamage * sgVal(t[4].fx, 'pct', lvs[4]), st);
    if (gain > 0 && typeof floatPlayerEvent === 'function') {
      var pSel = (typeof playerEventFloatTarget === 'function') ? playerEventFloatTarget(floatSel) : floatSel;
      floatPlayerEvent(pSel, '🪨+' + fmt(gain), 'shield');
    }
  }

  /* T6 岩甲增幅：每減少 1% 護盾疊一層。層數上限與持續時間都在表上，
     但層值是引擎自己累加的總量（比照【火焰增幅】以「後蓋前」寫入單一數值）。 */
  if (lvs[5] > 0 && absorbed > 0 && rt.base > 0) {
    var per = sgVal(t[5].fx, 'pct', lvs[5]);
    var cap = per * Math.max(1, Math.floor(Number(t[5].fx.max) || 30));
    var add = absorbed / rt.base * 100 * per;
    var total = Math.min(cap, Math.max(0, buffVal(pEnt, 'sgRockAmp')) + add);
    if (total > 0) applyStatus(pEnt, 'sgRockAmp', { val: total, dur: Number(t[5].fx.sec) || 3 });
  }
}

/* ===========================================================================
   泥沼術（mire）：地板場域（減益型）
   ---------------------------------------------------------------------------
   與火龍捲共用 SKILL2_RT.grounds，差別在三點：
     1. 形狀是軸對齊的正方形（一灘沼澤沒有「面向」），且可隨時間長大（growTo／growSec）
     2. 本體不造成傷害——它只發三種狀態：緩速（sgMire）、中毒（sgMirePoison）、
        熔岩灼燒（sgMireLava）。設計文檔第 7 階註明「共會給予三種 debuff」，
        因此走狀態表而不是逐跳直接傷害
     3. 狀態是「站在裡面才有」：每跳重塗一次、持續時間只給兩跳，離開後很快自然消失
   為什麼緩速不用既有的 ctrl 'slow'：'slow' 是固定 -30% 攻速、且吃控場遞減與韌性；
   一個每 0.5 秒重塗的場域會被控場遞減瞬間打成 0 秒，而且本技能要同時降攻速與移速、
   強度還會被第 6 階換代。故另立 stat 減益，遞減與抗性不介入（＝場域一定生效）。
   =========================================================================== */
var SG_MIRE_TICK_SEC = 0.5;      // 場域節拍（＝狀態重塗頻率）

function sgCastMire(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  /* 持續時間取各改寫階的最大值：第 1 階本身每級 +0.4 秒，滿級 7.6 秒已超過
     第 5 階表定的 6 秒；直接覆寫會讓升級變成降級，故取 max 當作「地板」。 */
  var lifeSec = Math.max(0.5, sgVal(t[0].fx, 'sec', lvs[0]));
  if (lvs[4] > 0) lifeSec = Math.max(lifeSec, Number(t[4].fx.sec) || 6);
  if (lvs[6] > 0) lifeSec = Math.max(lifeSec, Number(t[6].fx.sec) || 8);
  var hits = Math.max(1, Math.round(lifeSec / SG_MIRE_TICK_SEC));
  var side = bfMeterPx(sgRange(g.range).length || 10);
  var growTo = 1;
  if (lvs[4] > 0) growTo += sgVal(t[4].fx, 'pct', lvs[4]) / 100;
  if (lvs[6] > 0) growTo += sgVal(t[6].fx, 'pct', lvs[6]) / 100;   // 熔岩沼：與第 5 階累加
  var spread = lvs[3] > 0 ? sgRollCount(sgVal(t[3].fx, 'add', lvs[3])) : 0;
  if (typeof recordRunDamage === 'function') {
    recordRunDamage(g.name, 0, 'skill2:mire', sgTotalLevel(lvs));
  }
  sgSpawnGround(pEnt, st, 'mire', {
    kind: 'mire', tgt: primary, floatSel: floatSel,
    length: side, width: side, dmgVal: 0,
    hits: hits, gap: SG_MIRE_TICK_SEC,
    growTo: growTo, growSec: lvs[4] > 0 ? Math.max(0.1, Number(t[4].fx.growSec) || 4) : 0,
    respawnLeft: spread,
    mire: sgMireSpec(g, lvs, st)
  });
}

/* 沼澤這一攤要發的三種狀態規格（施放當下定版，之後不隨屬性變動）。 */
function sgMireSpec(g, lvs, st) {
  var t = g.tiers;
  var base = sgGroupBaseStat(g, st);
  var gravity = lvs[5] > 0;                                   // 重力泥沼：緩速換代
  var poisonGap = Math.max(0.1, Number(t[2].fx.dotGap) || 0.5);
  var lavaGap = Math.max(0.1, Number(t[6].fx.dotGap) || 0.4);
  return {
    aspd: Number((gravity ? t[5].fx : t[0].fx).aspd) || 50,
    move: Number((gravity ? t[5].fx : t[0].fx).move) || 30,
    poisonDps: lvs[2] > 0 ? base * sgVal(t[2].fx, 'dotPct', lvs[2]) / 100 / poisonGap : 0,
    poisonGap: poisonGap,
    lavaDps: lvs[6] > 0 ? base * sgVal(t[6].fx, 'dotPct', lvs[6]) / 100 / lavaGap : 0,
    lavaGap: lavaGap,
    lava: lvs[6] > 0
  };
}

/* 沼澤的一次作用：不造成傷害，只對站在裡面的敵人重塗狀態。 */
function sgMireGroundTick(f, victims, ctx) {
  var m = f.mire || {};
  var poison = m.poisonDps > 0;
  var mireVariant = m.lava
    ? (poison ? 'mire-lava-poison' : 'mire-lava')
    : (poison ? 'mire-poison' : 'mire');
  sgEmitVfx('mire', victims, f.floatSel, {
    fxKind: 'aura', variant: mireVariant,
    elem: m.lava && !poison ? 'fire' : 'earth', dur: f.gap, area: sgGroundArea(f)
  });
  if (!victims.length) return;
  var hold = f.gap * 2;   // 只給兩跳：離開沼澤後最多再殘留一個節拍
  var mireSource = {
    sourceKey: 'skill2:mire',
    sourceName: (typeof SKILLS2 !== 'undefined' && SKILLS2.mire) ? SKILLS2.mire.name : '泥沼術',
    sourceLevel: (typeof skills2Levels === 'function' && typeof sgTotalLevel === 'function')
      ? sgTotalLevel(skills2Levels('mire')) : undefined
  };
  for (var i = 0; i < victims.length; i++) {
    var e = victims[i];
    if (!e || e.hp <= 0) continue;
    applyStatus(e, 'sgMire', { val: m.aspd || 0, dur: hold });
    if (m.poisonDps > 0) applyStatus(e, 'sgMirePoison', { dps: m.poisonDps, dur: hold, interval: m.poisonGap, source: mireSource });
    if (m.lavaDps > 0) applyStatus(e, 'sgMireLava', { dps: m.lavaDps, dur: hold, interval: m.lavaGap, source: mireSource });
  }
}

/* 【毒沼增生】（T4）：沼澤結束時在附近較近的敵人腳下重新長出一攤（可再傳染的次數遞減）。 */
function sgMireGroundExpire(f, enemies, ctx) {
  if (!(f.respawnLeft > 0)) return;
  var lvs = skills2Levels('mire');
  if (!lvs || lvs[3] < 1) return;
  var radius = bfMeterPx(Number(SKILLS2.mire.tiers[3].fx.m) || 40);
  var spot = sgMireSpreadTarget(f, enemies, radius);
  if (!spot) return;
  sgSpawnGround(f.pEnt, f.st, 'mire', {
    kind: 'mire', tgt: spot, floatSel: f.floatSel,
    length: f.baseLength, width: f.baseWidth, dmgVal: 0,
    hits: f.hits, gap: f.gap,
    growTo: f.growTo, growSec: f.growSec,
    respawnLeft: f.respawnLeft - 1,
    mire: f.mire
  });
}

/* 傳染落點：以沼澤當下位置為圓心、radius 內「較近」的存活敵人（設計文檔：優先選擇較近的目標）。 */
function sgMireSpreadTarget(f, enemies, radius) {
  var live = (typeof bfLiveList === 'function') ? bfLiveList(enemies) : (enemies || []);
  if (!f.pos || typeof bfPos !== 'function') return live.length ? live[0] : null;
  var best = null, bestD = Infinity;
  for (var i = 0; i < live.length; i++) {
    var p = bfPos(live[i]);
    if (!p) continue;
    var dx = p.x - f.pos.x, dy = p.y - f.pos.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > radius || d >= bestD) continue;
    best = live[i]; bestD = d;
  }
  return best;
}

/* ---- 泥沼緩速的兩個對外掛點 ----
   攻速：formula.js slowFactor（野外與高塔的敵人攻擊節拍共用）
   移速：battlefield.js bfTickApproach（敵人逼近速度）
   減速幅度的權威是「目前的技能等級」：攻速值另外存在狀態上供 UI 顯示，
   移速值不佔第二個狀態格（同一棵樹只會有一種泥沼，不需要分開記）。 */
function sgMireOn(ent) {
  return (typeof buffVal === 'function') ? Math.max(0, buffVal(ent, 'sgMire')) : 0;
}
function skill2MireMovePct() {
  var lvs = skills2Levels('mire');
  if (!lvs || lvs[0] < 1) return 0;
  var t = SKILLS2.mire.tiers;
  return Number((lvs[5] > 0 ? t[5].fx : t[0].fx).move) || 0;
}
function skill2MireAspdFactor(ent) {
  var v = sgMireOn(ent);
  return v > 0 ? Math.max(0.05, 1 - Math.min(95, v) / 100) : 1;
}
function skill2MoveSlowFactor(ent) {
  if (!(sgMireOn(ent) > 0)) return 1;
  return Math.max(0.05, 1 - Math.min(95, skill2MireMovePct()) / 100);
}
/* 【虛弱】（T2）＋【重力泥沼】（T6）：受泥沼影響的敵人受到的傷害提高（兩者累加）。 */
function skill2MireVulnPct(target) {
  if (!(sgMireOn(target) > 0)) return 0;
  var lvs = skills2Levels('mire');
  if (!lvs || lvs[0] < 1) return 0;
  var t = SKILLS2.mire.tiers;
  var pct = 0;
  if (lvs[1] > 0) pct += sgVal(t[1].fx, 'pct', lvs[1]);
  if (lvs[5] > 0) pct += sgVal(t[5].fx, 'pct', lvs[5]);
  return pct;
}

/* ===========================================================================
   大地守護（earthguard）：主動型被動
   ---------------------------------------------------------------------------
   七階全是「掛在既有收斂點上的乘區」，沒有任何主動施放：
     T1 傷害減免  → formula.js resolveHit 我方受擊段（skill2DamageTakenMultiplier）
     T1 生命上限  → formula.js st.hp 派生點（skill2MaxHpFactor）
     T2 全屬性傷害 → legendary.js legendaryElementDamageUp（全專案屬性傷害提升的唯一收斂點）
     T3 生命回復＋吸血 → formula.js playerHpRegenPerSec ／ lifestealHealAmount（兩個不同倍率）
     T4 法力回復＋吸魔 → formula.js playerMpRegenPerSec ／ manaStealAmount
     T5 魔法盾    → formula.js 我方扣血點（resolveHit ／ applyEnemyHpDamage）
     T6 生命反射  → combat.js doMonsterAttack 的受擊收斂點
     T7 天地共生  → 野外／高塔兩個判死收斂點（skills2TryRebirth）
   =========================================================================== */
function skill2EarthguardLevels() {
  if (!skills2PassiveActive('earthguard')) return null;
  var lvs = skills2Levels('earthguard');
  return (lvs && lvs[0] >= 1) ? lvs : null;
}

/* 我方受到的傷害乘區（岩甲【天地逆返】×大地守護【傷害減免】）。
   刻意不併進 dCfg.dmgRed：那條是神鑄【聖佑】的加算池、還夾著 50% 上限，
   兩個不同來源的減免混在一起會互相吃掉對方的空間。 */
function skill2DamageTakenMultiplier(pEnt) {
  var mult = 1;
  var eg = skill2EarthguardLevels();
  if (eg && eg[0] > 0) {
    mult *= 1 - Math.min(90, sgVal(SKILLS2.earthguard.tiers[0].fx, 'pct', eg[0])) / 100;
  }
  var rk = skill2RockLevels(pEnt);
  if (rk && rk[6] > 0) {
    var red = sgVal(SKILLS2.rockarmor.tiers[6].fx, 'pct', rk[6]) * (1 - skill2RockShieldRemain(pEnt));
    if (red > 0) mult *= 1 - Math.min(90, red) / 100;
  }
  /* 風系（暴風屏障【屏障】＋【暴風神體】）：兩者先相加成一個「風系減免」再整體乘算，
     依設計文檔註記——風系減免只與風系類型的減免相加總，對其他來源仍是額外乘算。
     上限 99% 是為了避免「屏障＋神體」加總破表變成完全免疫。 */
  var windRed = skill2WindDamageRedPct(pEnt);
  if (windRed > 0) mult *= 1 - Math.min(99, windRed) / 100;
  return mult;
}

/* 【大地守護】（T1）：生命上限的額外乘算倍率。
   掛點：formula.js 的 st.hp 派生點——一處收斂，護盾%、最大生命%持續傷害、
   反震與所有「占最大生命」的換算就都吃到同一個上限，不必逐處補判。
   ⚠️ 這一支會在 computeStats 途中被呼叫，因此**不得**再回頭呼叫 getStats()。 */
function skill2MaxHpFactor() {
  var lvs = skill2EarthguardLevels();
  if (!lvs || lvs[0] < 1) return 1;
  return 1 + sgVal(SKILLS2.earthguard.tiers[0].fx, 'hp', lvs[0]) / 100;
}

/* 【大地祝福】（T2）：全屬性傷害的額外乘算增幅%（0＝未生效）。 */
function skill2ElemDamageUpPct() {
  var lvs = skill2EarthguardLevels();
  if (!lvs || lvs[1] < 1) return 0;
  return sgVal(SKILLS2.earthguard.tiers[1].fx, 'pct', lvs[1]);
}

/* 【生命再生】／【魔力再生】（T3／T4）：同一階給兩個**不同倍率**的乘區——
   回復本身 +100%（pct），吸血／吸魔 +50%（drain）。因此吸血不能沿用被放大過的
   每秒回復去換算，兩者在 formula.js 各自從未加成的基準值出發。 */
function sgEarthguardRegenTier(kind) {
  var lvs = skill2EarthguardLevels();
  var idx = (kind === 'mp') ? 3 : 2;
  return (lvs && lvs[idx] >= 1) ? { fx: SKILLS2.earthguard.tiers[idx].fx, lv: lvs[idx] } : null;
}
function skill2RegenFactor(kind) {
  var t = sgEarthguardRegenTier(kind);
  return t ? 1 + sgVal(t.fx, 'pct', t.lv) / 100 : 1;
}
function skill2DrainFactor(kind) {
  var t = sgEarthguardRegenTier(kind);
  return t ? 1 + sgVal(t.fx, 'drain', t.lv) / 100 : 1;
}

/* 【魔法盾】（T5）：我方扣血前先由法力承擔一部分；回傳「改由法力付掉」的傷害量。
   使用者決策 2026-08-17：法力付得起多少就付多少，餘額仍照扣生命。 */
function skills2ManaShieldAbsorb(pEnt, dmg) {
  if (!pEnt || !(dmg > 0)) return 0;
  var lvs = skill2EarthguardLevels();
  if (!lvs || lvs[4] < 1) return 0;
  var want = dmg * sgVal(SKILLS2.earthguard.tiers[4].fx, 'pct', lvs[4]) / 100;
  var paid = Math.min(want, Math.max(0, Number(pEnt.mp) || 0));
  if (!(paid > 0)) return 0;
  pEnt.mp = Math.max(0, pEnt.mp - paid);
  return paid;
}

/* 【生命反射之盾】（T6）：你每消耗 1% 生命或護盾，附近敵人同步損失自身最大生命的一定比例。
   分母一律取最大生命——本專案的護盾量本來就以「占最大生命%」描述（岩甲護盾即 30% 最大生命），
   用 shieldMax 當分母會在護盾打光的那一刻歸零而漏算最後一段。 */
function sgEarthguardReflect(mEnt, pEnt, hpDamage, res, floatSel) {
  var lvs = skill2EarthguardLevels();
  if (!lvs || lvs[5] < 1) return;
  var st = getStats();
  if (!(st.hp > 0)) return;
  var lostPct = (Math.max(0, hpDamage) + Math.max(0, (res && res.absorbed) || 0)) / st.hp * 100;
  if (!(lostPct > 0)) return;
  var fx = SKILLS2.earthguard.tiers[5].fx;
  var enemies = (typeof combatFieldEnemies === 'function' && typeof FIELD !== 'undefined' &&
    FIELD && FIELD.player === pEnt) ? combatFieldEnemies() : [mEnt];
  var victims = sgEarthguardReflectTargets(mEnt, enemies, fx);
  if (!victims.length) return;
  var eSel = (typeof THORN_FLOAT_MAP !== 'undefined' && THORN_FLOAT_MAP[floatSel]) || floatSel;
  var pctOfMax = lostPct * sgVal(fx, 'pct', lvs[5]) / 100;
  var killed = false;
  sgEmitVfx('earthguard', victims, eSel, { fxKind: 'chain', variant: 'earth-reflect', elem: 'light' });
  for (var i = 0; i < victims.length; i++) {
    var e = victims[i];
    var amount = Math.max(1, Math.round((Number(e.maxHp) || 0) * pctOfMax / 100));
    var dealt = (typeof applyEnemyHpDamage === 'function') ? applyEnemyHpDamage(e, amount) : 0;
    if (dealt <= 0) continue;
    if (typeof floatEnemyEvent === 'function') floatEnemyEvent(e, eSel, '🌍' + fmt(dealt), 'enemy-skill', dealt, 0);
    if (typeof trackDps === 'function') trackDps(dealt);
    if (typeof recordRunDamage === 'function') {
      recordRunDamage(SKILLS2.earthguard.name, dealt, 'skill2:earthguard', sgTotalLevel(skills2Levels('earthguard')));
    }
    if (e.hp <= 0) { e.hp = 0; killed = true; }
  }
  if (killed && typeof onFieldDeaths === 'function' && typeof FIELD !== 'undefined' &&
      FIELD && FIELD.player === pEnt) {
    onFieldDeaths();
  }
}

/* 反射目標：範圍內任意 count 個；「除非只剩一個目標，否則避開當前攻擊者」。 */
function sgEarthguardReflectTargets(exclude, enemies, fx) {
  var radius = bfMeterPx(Number(fx.m) || 20);
  var count = Math.max(1, Math.floor(Number(fx.count) || 1));
  var others = [], self = [];
  for (var i = 0; i < (enemies || []).length; i++) {
    var e = enemies[i];
    if (!e || e.hp <= 0) continue;
    if (typeof bfPos === 'function' && bfPos(e) && typeof bfEntityDistance === 'function' &&
        bfEntityDistance(e) > radius) continue;
    (e === exclude ? self : others).push(e);
  }
  var pick = others.length ? others : self;
  for (var j = pick.length - 1; j > 0; j--) {
    var k = Math.floor(Math.random() * (j + 1));
    var tmp = pick[j]; pick[j] = pick[k]; pick[k] = tmp;
  }
  return pick.slice(0, count);
}

/* 【天地共生】（T7）：死亡攔截。掛在野外 onPlayerFieldDeath 與高塔 endTowerFight
   兩個判死收斂點的最前端——持續傷害、自傷技能與敵人攻擊都會經過那裡。
   冷卻寫進 pEnt.skillCds['sg:earthguard']，直接沿用技能格的通用冷卻顯示。 */
function skills2TryRebirth(pEnt) {
  if (!pEnt || typeof getStats !== 'function') return false;
  var lvs = skill2EarthguardLevels();
  if (!lvs || lvs[6] < 1) return false;
  if (!pEnt.skillCds) pEnt.skillCds = {};
  if ((pEnt.skillCds[SG_PREFIX + 'earthguard'] || 0) > 0) return false;
  var fx = SKILLS2.earthguard.tiers[6].fx;
  var st = getStats();
  if (typeof cleanse === 'function') cleanse(pEnt);   // 先淨化再上無敵，避免無敵被自己清掉
  pEnt.hp = Math.max(1, Math.round(st.hp * sgVal(fx, 'pct', lvs[6]) / 100));
  pEnt.skillCds[SG_PREFIX + 'earthguard'] = Math.max(1, sgVal(fx, 'cd', lvs[6]));
  applyStatus(pEnt, 'invuln', { dur: Math.max(0.5, Number(fx.sec) || 5) });
  sgEmitPlayerVfx('earthguard', 'pv-float', { fxKind: 'rain', variant: 'pillar', elem: 'light', dur: 1.2 });
  if (typeof floatPlayerEvent === 'function') floatPlayerEvent('pv-float', '天地共生!', 'buff');
  if (typeof blog === 'function') {
    blog('🌍 【天地共生】大地將你托起——你原地復活，回復 ' + fmt(pEnt.hp) + ' 生命並獲得無敵！', 'info');
  }
  if (typeof UI !== 'undefined' && UI.dirty) { UI.dirty.battle = true; UI.dirty.skills = true; }
  return true;
}

/* ===========================================================================
   連鎖閃電（chainlightning）
   ---------------------------------------------------------------------------
   一道在敵人之間逐跳彈射的閃電鏈：每一跳都接在前一跳的飛行時間之後，
   傷害飄字與特效因此與畫面同步（比照飛刀的彈射鏈）。
   彈射目標的選法：在「本輪還沒跳過、且在彈射範圍（30 米）內」的敵人裡隨機挑一個；
   都跳過了就結束——第 6 階【雷幻身】才是唯一的例外，它讓玩家自己當中繼點，
   把走訪紀錄清空並繼續彈射（中繼那一下不消耗彈射數，落到敵人身上才算一次）。
   因此單一敵人時整條鏈仍打得完（A→自身→A→…），不必為此另設「單體加成」。
   =========================================================================== */
function sgCastChainlightning(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[1] > 0) pct += sgVal(t[1].fx, 'pct', lvs[1]);   // 強化閃電
  if (lvs[5] > 0) pct += sgVal(t[5].fx, 'pct', lvs[5]);   // 雷幻身（使用者決策：整道鏈恆時增傷）
  if (lvs[6] > 0) pct += sgVal(t[6].fx, 'pct', lvs[6]);   // 雷電暴風
  var links = Math.max(1, Math.floor(Number(t[0].fx.count) || 4));
  if (lvs[3] > 0) links += sgRollCount(sgVal(t[3].fx, 'add', lvs[3]));
  if (lvs[6] > 0) links += sgRollCount(sgVal(t[6].fx, 'add', lvs[6]));
  var cfg = {
    dmgVal: sgGroupBaseStat(g, st) * pct / 100,
    links: links,
    hopPx: bfMeterPx(Number(t[0].fx.m) || 30),
    extraHits: lvs[2] > 0 ? sgRollCount(sgVal(t[2].fx, 'add', lvs[2])) : 0,
    splashPct: lvs[4] > 0 ? sgVal(t[4].fx, 'pct', lvs[4]) : 0,
    splashCount: Math.max(1, Math.floor(Number(t[4].fx.count) || 1)),
    splashPx: bfMeterPx(Number(t[4].fx.m) || 6),
    selfRelay: lvs[5] > 0
  };
  var bolts = lvs[6] > 0 ? Math.max(1, Math.floor(Number(t[6].fx.count) || 3)) : 1;
  var starts = sgChainStarts(primary, pool, bolts);
  /* 【雷電暴風】：每次彈射有機率排入一條從該彈射目標起手的獨立閃電鏈。
     生成鏈也沿用相同規則，因此每條鏈的彈射都能再次觸發；上限只作為極端
     連續觸發時的防爆量保護，不影響表定 20% 機率。 */
  cfg.spawnChance = lvs[6] > 0 ? sgVal(t[6].fx, 'chance', lvs[6]) : 0;
  cfg.spawnQueue = [];
  cfg.chainCount = 0;
  cfg.maxChains = 64;
  for (var i = 0; i < bolts; i++) {
    if (cfg.chainCount >= cfg.maxChains) break;
    cfg.spawnQueue.push(starts[i % starts.length]);
    cfg.chainCount++;
  }
  while (cfg.spawnQueue.length) {
    sgChainlightningBolt(pEnt, st, cfg, cfg.spawnQueue.shift(), pool, floatSel, out);
  }
}

/* 【雷電暴風】的三道鏈盡量從不同的敵人起手；敵人不夠時才輪流重用同一個起點。
   第 1 道從主目標起手，其餘在場上隨機挑（敘述只寫「同時發射 N 道」，沒有指定最近）。 */
function sgChainStarts(primary, pool, count) {
  var starts = [primary];
  var rest = (typeof bfRandomOthers === 'function') ? bfRandomOthers(null, pool, pool.length, 0, null) : [];
  for (var i = 0; i < rest.length && starts.length < count; i++) {
    if (starts.indexOf(rest[i]) < 0) starts.push(rest[i]);
  }
  return starts;
}

/* 下一個彈射目標：彈射範圍（表定 30 米）內、本輪還沒跳過的敵人裡「隨機」一個
   （沒有就回 null）。技能敘述只規定了範圍、沒有寫「最近」，所以範圍內等機率隨機。
   from 為 null＝從玩家（雷幻身中繼點）出發，範圍改以「離我方多遠」計算。 */
function sgChainNextTarget(from, pool, visited, hopPx) {
  return (typeof bfRandomOther === 'function') ? bfRandomOther(from, pool, hopPx, visited) : null;
}

function sgChainlightningBolt(pEnt, st, cfg, start, pool, floatSel, out) {
  if (!start || start.hp <= 0) return;
  var gid = 'chainlightning';
  var cur = start;
  var visited = [start];
  var isBounce = false;   // 起手那一擊不算彈射（電殛擴散只在彈射時追加）
  var linksLeft = cfg.links;
  var delayMs = (typeof bfTravelSeconds === 'function') ? Math.round(bfTravelSeconds(start) * 1000) : 0;
  sgEmitVfx(gid, [start], floatSel, {
    fxKind: 'chain', variant: 'lightning-chain', count: 1, travelMs: [delayMs],
    preserveDeadTargets: true
  });
  var guard = 0;
  while (linksLeft > 0 && cur && cur.hp > 0 && guard < 64) {
    guard++;
    linksLeft--;
    sgHitOne(pEnt, st, cur, cfg.dmgVal, gid, floatSel, out, delayMs);
    // 【雷鳴術】：被擊中的敵人再多吃幾次同樣的閃電傷害（不足 1 次的部分已於施放時擲骰）
    for (var e = 0; e < cfg.extraHits; e++) {
      sgHitOne(pEnt, st, cur, cfg.dmgVal, gid, floatSel, out, delayMs + sgStaggerMs(e + 1));
    }
    // 【電殛擴散】：每次彈射時劈向附近的敵人（不占彈射數、不繼續延伸鏈）
    if (isBounce && cfg.splashPct > 0) {
      // 「額外對 m 米內的 count 個敵人」沒有指定最近＝範圍內隨機
      var splash = (typeof bfRandomOthers === 'function')
        ? bfRandomOthers(cur, pool, cfg.splashCount, cfg.splashPx, null) : [];
      for (var s = 0; s < splash.length; s++) {
        sgHitOne(pEnt, st, splash[s], cfg.dmgVal * cfg.splashPct / 100, gid, floatSel, out,
          delayMs + sgStaggerMs(s + 1));
      }
      if (splash.length) {
        sgEmitVfx(gid, splash, floatSel, {
          fxKind: 'impact', variant: 'thunder-burst', elem: 'lightning', delayMs: delayMs, dur: 0.3
        });
      }
    }
    var next = sgChainNextTarget(cur, pool, visited, cfg.hopPx);
    if (!next && cfg.selfRelay) {
      /* 【雷幻身】：以自身當中繼點——清空走訪紀錄後重新找目標，
         中繼這一下不消耗彈射數（消耗的是落到敵人身上的那一擊）。 */
      visited = [];
      next = sgChainNextTarget(null, pool, visited, cfg.hopPx);
      if (next) {
        sgEmitPlayerVfx(gid, floatSel, { fxKind: 'aura', variant: 'lightning-relay', elem: 'lightning', dur: 0.35 });
      }
    }
    if (!next) break;
    visited.push(next);
    if (cfg.spawnChance > 0 && cfg.chainCount < cfg.maxChains &&
        chance(cfg.spawnChance)) {
      cfg.spawnQueue.push(next);
      cfg.chainCount++;
    }
    var hopMs = (typeof bfTravelSeconds === 'function') ? Math.round(bfTravelSeconds(next) * 1000) : 0;
    sgEmitVfx(gid, [cur, next], floatSel, {
      fxKind: 'chain', variant: 'lightning-chain', count: 1,
      delayMs: delayMs, travelMs: [0, hopMs], preserveDeadTargets: true
    });
    delayMs += hopMs;
    cur = next;
    isBounce = true;
  }
}

/* ===========================================================================
   落雷術（thunderstrike）
   ---------------------------------------------------------------------------
   每一道落雷都是一次「天降打擊」：施放當下只排程與播放落雷特效，
   傷害等到落地那一刻才結算（沿用殞石術的同一條佇列，見 sgQueueMeteor）。
   因此第 5 階【雷電脈衝】的暈眩塗在落地之後，第 7 階【殛道落雷】對
   「已經在暈眩中」的敵人加成才有意義——同一次施放的先落者暈住、後落者吃加成。
   =========================================================================== */
function sgCastThunderstrike(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[3] > 0) pct += sgVal(t[3].fx, 'pct', lvs[3]);   // 閃電增幅
  var dmgVal = sgGroupBaseStat(g, st) * pct / 100;
  var targetCount = Math.max(1, Math.floor(Number(t[0].fx.count) || 2));
  if (lvs[1] > 0) targetCount += sgRollCount(sgVal(t[1].fx, 'add', lvs[1]));
  var hitsPer = 1;
  if (lvs[2] > 0) hitsPer += sgRollCount(sgVal(t[2].fx, 'add', lvs[2]));
  if (lvs[6] > 0) {
    // 【殛道落雷】：攻擊次數與目標數同時乘倍（在第 2／3 階的追加之後才乘）
    var mult = Math.max(1, Math.floor(Number(t[6].fx.mult) || 2));
    targetCount *= mult;
    hitsPer *= mult;
  }
  var gapMs = Math.max(0, Number(t[0].fx.gap) || 0.2) * 1000;
  var targets = sgThunderTargets(primary, pool, lvs, targetCount);
  var boltIndex = 0;
  for (var i = 0; i < targets.length; i++) {
    for (var h = 0; h < hitsPer; h++) {
      sgQueueThunderBolt(pEnt, st, g, lvs, dmgVal, targets[i], pool, floatSel, out, boltIndex * gapMs, 0);
      boltIndex++;
    }
  }
}

/* 落雷的目標清單：射程內隨機取 count 個；敵人不足時輪流重用
   （表定是「對 castM 米內的 N 個目標降下落雷」，沒有指定最近＝射程內隨機；
   敵人少於 N 時全落在同一批人身上）。第 1 道固定落在施放的主目標身上。 */
function sgThunderTargets(primary, pool, lvs, count) {
  var rest = (typeof bfRandomOthers === 'function') ? bfRandomOthers(null, pool, pool.length, 0, null) : [];
  var inRange = [primary];
  for (var i = 0; i < rest.length; i++) {
    if (rest[i] !== primary && skills2CanReach('thunderstrike', rest[i], lvs)) inRange.push(rest[i]);
  }
  var out = [];
  for (var k = 0; k < count; k++) out.push(inRange[k % inRange.length]);
  return out;
}

/* 一道落雷：排程落地結算，並掛上【雷電脈衝】的暈眩與【迅雷重生】的再生。
   regenDone＝這一條落雷鏈已經再生過幾道（上限來自表格 max，避免無限接力）。 */
function sgQueueThunderBolt(pEnt, st, g, lvs, dmgVal, target, pool, floatSel, out, castDelayMs, regenDone) {
  if (!target || target.hp <= 0) return;
  var t = g.tiers;
  var timing = sgMeteorFallTiming();
  var stunSec = lvs[4] > 0 ? sgVal(t[4].fx, 'sec', lvs[4]) : 0;
  var stunCount = Math.max(1, Math.floor(Number(t[4].fx.count) || 2));
  var stunPx = bfMeterPx(Number(t[4].fx.m) || 6);
  var vulnPct = lvs[6] > 0 ? sgVal(t[6].fx, 'pct', lvs[6]) : 0;
  var impactRadius = lvs[6] > 0 ? bfMeterPx(Number(t[6].fx.m) || 6) : 0;
  var regenChance = lvs[5] > 0 ? sgVal(t[5].fx, 'chance', lvs[5]) : 0;
  var regenMax = Math.max(0, Math.floor(Number(t[5].fx.max) || 5));

  sgEmitVfx('thunderstrike', [target], floatSel, {
    fxKind: 'rain', variant: 'thunder-strike', elem: 'lightning', count: 1,
    delayMs: castDelayMs, travelMs: [timing.travelMs]
  });
  sgQueueMeteor(pEnt, st, dmgVal, target, pool, impactRadius, null, floatSel, out,
    GT + (castDelayMs + timing.fallMs) / 1000, {
      gid: 'thunderstrike', variant: 'thunder-impact', elem: 'lightning',
      /* 【殛道落雷】：加成在落地當下才判定——先落的雷把人暈住，後落的才吃得到。 */
      bonusPctFn: vulnPct > 0 ? function (tgt) { return sgIsStunned(tgt) ? vulnPct : 0; } : null,
      onImpact: function (m, victims, ctx) {
        if (stunSec > 0) {
          /* 表定範圍＝「目標本身以及 6 米內的任 1 個敵人」，共 stunCount 個。 */
          var stunned = (m.target && m.target.hp > 0) ? [m.target] : [];
          var extra = (typeof bfRandomOthers === 'function')
            ? bfRandomOthers(m.target, m.pool || [], Math.max(0, stunCount - stunned.length), stunPx, null) : [];
          for (var si = 0; si < extra.length; si++) stunned.push(extra[si]);
          for (var vi = 0; vi < stunned.length; vi++) sgTryStun(stunned[vi], stunSec);
        }
        // 【迅雷重生】：這一道結束後再生一道；目標死了就改劈另一個還活著的敵人（隨機）
        if (regenChance > 0 && regenDone < regenMax && chance(regenChance)) {
          var next = (m.target && m.target.hp > 0) ? m.target
            : ((typeof bfRandomOther === 'function') ? bfRandomOther(m.target, m.pool || [], 0, null) : null);
          if (next) {
            sgQueueThunderBolt(m.pEnt, m.st, SKILLS2.thunderstrike, skills2Levels('thunderstrike'),
              m.dmgVal, next, m.pool, m.floatSel, m.out, 0, regenDone + 1);
          }
        }
      }
    });
}

/* ===========================================================================
   雷球（thunderorb）
   ---------------------------------------------------------------------------
   三種形態共用同一套既有基建，因此不必為雷球另寫一個模擬迴圈：
     飛行雷球  → 地板場域＋移動（sgSpawnGround 的 dest／speed）：邊飛邊按節拍打範圍
     環體電球  → 環繞場域（sgSpawnOrbitField）：與火狩同一套接觸判定
     雷殞天落  → 天降打擊佇列（sgQueueMeteor）：與殞石術同一條落地時間軸
   第 7 階依使用者決策為「追加」而非「改為」：飛行雷球照常召喚，再額外降下巨雷球。
   =========================================================================== */
function sgCastThunderorb(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var ampPct = lvs[4] > 0 ? sgVal(t[4].fx, 'pct', lvs[4]) : 0;   // 【強化雷球】：所有形態共用
  var scale = lvs[1] > 0 ? 1 + sgVal(t[1].fx, 'pct', lvs[1]) / 100 : 1;
  var orbCfg = {
    dmgVal: sgGroupBaseStat(g, st) * (sgVal(t[0].fx, 'pct', lvs[0]) + ampPct) / 100,
    radius: bfMeterPx(Number(t[0].fx.m) || 3) * scale,
    gap: Math.max(0.05, Number(t[0].fx.gap) || 0.35),
    parkSec: Math.max(0, Number(t[0].fx.sec) || 2),
    speedPx: Math.max(1, bfMeterPx(Number(t[0].fx.speed) || 6))
  };
  var count = Math.max(1, Math.floor(Number(t[0].fx.count) || 2));
  if (lvs[2] > 0) count += sgRollCount(sgVal(t[2].fx, 'add', lvs[2]));
  /* 目標隨機挑（設計文檔：選目標的時候隨機選，不用特別選近的）；
     射程閘門已在施放入口擋過，這裡只從還活著的敵人裡抽。 */
  var live = (typeof bfLiveList === 'function') ? bfLiveList(pool) : [];
  for (var i = 0; i < count; i++) {
    var tgt = live.length ? live[Math.floor(Math.random() * live.length)] : primary;
    sgSpawnThunderOrb(pEnt, st, tgt, floatSel, orbCfg);
  }

  // 【環體電球】：環繞自身的電球，命中判定與火狩共用同一套接觸判定
  if (lvs[3] > 0) {
    var ofx = t[3].fx;
    var body = sgRange(g.range);
    var companionChance = lvs[5] > 0 ? sgVal(t[5].fx, 'chance', lvs[5]) : 0;
    var companionSec = Math.max(0.5, Number(t[5].fx.sec) || 2);
    sgSpawnOrbitField(pEnt, st, 'thunderorb', {
      tgt: primary, floatSel: floatSel,
      rings: [{ r: bfMeterPx(Number(ofx.m) || 8), spin: Math.PI * 2 * (Number(ofx.rps) || 0.7) }],
      count: Math.max(1, Math.floor(Number(ofx.count) || 2)),
      dmgVal: sgGroupBaseStat(g, st) * (sgVal(ofx, 'pct', lvs[3]) + ampPct) / 100,
      lifeSec: Math.max(0.5, Number(ofx.sec) || 6),
      bodyR: bfMeterPx(Math.max(body.length, body.width) / 2) * scale,
      statusId: 'sgThunderOrb', auraVariant: 'thunder-orbit',
      hitVariant: 'thunder-burst', hitElem: 'lightning',
      /* 【伴生雷球】：命中處留下一顆靜止雷球（傷害與體積比照飛行雷球）。 */
      onStrike: companionChance > 0 ? function (f, orb, pos) {
        if (!pos || !chance(companionChance)) return;
        sgSpawnStationaryThunderOrb(f.pEnt, f.st, f.floatSel, orbCfg, pos, companionSec);
      } : null
    });
  }

  // 【雷殞天落】：追加兩顆從天而降的巨大雷球（不取代飛行雷球）
  if (lvs[6] > 0) {
    var ffx = t[6].fx;
    var fallDmg = sgGroupBaseStat(g, st) * (sgVal(ffx, 'pct', lvs[6]) + ampPct) / 100;
    var fallRadius = bfMeterPx(Number(ffx.m) || 15);
    var fallCount = Math.max(1, Math.floor(Number(ffx.count) || 2));
    var fallStun = Math.max(0, Number(ffx.sec) || 3);
    var timing = sgMeteorFallTiming();
    var nextFallTarget = sgMeteorTargetBag(primary, pool, fallRadius);
    for (var f = 0; f < fallCount; f++) {
      var fallTarget = nextFallTarget();
      var castDelay = f * SG_METEOR_INTERVAL_MS;
      sgEmitVfx('thunderorb', [fallTarget], floatSel, {
        fxKind: 'rain', variant: 'thunder-fall', elem: 'lightning', count: 1,
        area: sgAreaAround(fallTarget, fallRadius), delayMs: castDelay, travelMs: [timing.travelMs]
      });
      sgQueueMeteor(pEnt, st, fallDmg, fallTarget, pool, fallRadius, null, floatSel, out,
        GT + (castDelay + timing.fallMs) / 1000, {
          gid: 'thunderorb', variant: 'thunder-fall-impact', elem: 'lightning',
          onImpact: function (m, victims) {
            for (var vi = 0; vi < victims.length; vi++) sgTryStun(victims[vi], fallStun);
          }
        });
    }
  }
}

/* 一顆飛行雷球：從玩家腳下出發、沿直線飛向目標當下的位置，抵達後停駐 parkSec 秒。
   總作用次數＝(飛行時間＋停駐時間) ÷ 節拍；無座標（高塔）時取射程一半的飛行時間，
   否則高塔會完全吃不到「飛行途中持續傷害」這一段。 */
function sgSpawnThunderOrb(pEnt, st, target, floatSel, cfg) {
  var from = (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null;
  var to = (typeof bfPos === 'function' && target) ? bfPos(target) : null;
  var flightSec;
  if (from && to) {
    var dx = to.x - from.x, dy = to.y - from.y;
    flightSec = Math.sqrt(dx * dx + dy * dy) / cfg.speedPx;
  } else {
    var lvs = skills2Levels('thunderorb');
    flightSec = skills2CastRangePx('thunderorb', lvs) / 2 / cfg.speedPx;
  }
  var hits = Math.max(1, Math.ceil((flightSec + cfg.parkSec) / cfg.gap));
  sgSpawnGround(pEnt, st, 'thunderorb', {
    kind: 'orb', tgt: target, floatSel: floatSel,
    from: from ? { x: from.x, y: from.y } : null,
    dest: (from && to) ? { x: to.x, y: to.y } : null,
    speed: cfg.speedPx, radius: cfg.radius,
    dmgVal: cfg.dmgVal, hits: hits, gap: cfg.gap
  });
}

/* 靜止雷球（【伴生雷球】）：生在環體電球的命中處，不移動，只按節拍打自己的範圍。 */
function sgSpawnStationaryThunderOrb(pEnt, st, floatSel, cfg, pos, lifeSec) {
  sgSpawnGround(pEnt, st, 'thunderorb', {
    kind: 'orb', tgt: null, floatSel: floatSel,
    from: { x: pos.x, y: pos.y }, dest: null, speed: 0,
    radius: cfg.radius, dmgVal: cfg.dmgVal,
    hits: Math.max(1, Math.ceil(lifeSec / cfg.gap)), gap: cfg.gap
  });
}

/* ===========================================================================
   反擊（counter）：主動型被動——受擊時觸發，需裝配技能列才生效、永不主動施放。
   掛點：combat.js doMonsterAttack（野外與高塔敵攻玩家的唯一收斂點）於
   legendaryOnPlayerDamaged 旁鏈結呼叫，簽名與其一致。
   規則：T1 受傷機率反擊、T2 格擋必反（同一擊可同時成立、各自結算）；
   T6 追加與 T7 範圍反殺「不會再觸發反擊」＝只增加打擊次數、不進入再判定。
   法力（2026-08-19）：每一階觸發時各自扣自己那一階的施法消耗（參數表每階一格，
   T1 5／T2 10／T4 40／T5 60／T6 80／T7 100），付不起的那一階這一次就不觸發，
   其餘階照常——所以低魔時會自然退化成「只剩便宜的階還在動」。
   扣魔順序＝結算順序（T5 破甲 → T1 → T2 → T6 → T7 → T4 護盾），先結算的先付。
   T3【強化反擊】是恆時傷害加成、沒有獨立觸發時機，不扣魔。
   致命一擊不反擊：與 resolveHit 反震段的既有規則一致（formula.js `!out.killed`）。
   這道防護不只是語意——本函式內部會呼叫 onFieldDeaths() 立即結算擊殺獎勵，
   死者反殺拿到的經驗若讓玩家升級（升級會回滿血），呼叫端的 hp<=0 判死就會失效，
   整個死亡流程被無聲取消。
   =========================================================================== */
/* ===========================================================================
   冰系三群組（2026-08-17 第七批）：寒冰箭 icearrow／水流彈 waterball／冰霜新星 frostnova
   ---------------------------------------------------------------------------
   三個群組全部是魔法傷害／寒冰屬性，並共用同一個核心狀態【寒霜】——設計文檔把
   寒霜的整段說明重複寫在三棵樹裡（寒霜箭 T2／寒流彈 T3／冰霜新星 T1），實際上是
   同一個狀態，因此寒霜一律寫在群組共用層，不掛在任何一個技能的施放流程裡。
   使用者於實作前的兩項決策（2026-08-17）：
     1. 寒霜的持續傷害**不隨層數提高**：層數只累積移動與攻速的下降，並在疊滿時凍結。
        （所以寒霜刻意拆成 sgFrost「層數＋緩速」與 sgFrostBite「傷害」兩筆狀態——
         若併成一筆走疊層規則，實際效果會變成「單層值 × 層數」而違反此決策。）
     2. 凍結**走既有控場管線**：BOSS 控場免疫、韌性折減與控場遞減全部適用。
   本批帶進四個群組共用能力（皆為引擎收斂點，不是這三個技能的特例）：
     13. 寒霜狀態（sgApplyFrost／sgFrostStacks／sgTickFrost ＋ 通用緩速收斂點
         skill2SlowAspdFactor／skill2SlowMoveFactor）：可疊層的緩速兼持續傷害，
         疊滿即凍結；formula.js 與 battlefield.js 從此只認得「通用緩速」一個掛點
     14. 敵人屬性標籤強制改寫（skill2ForcedAttr）＋每系受傷增幅（skill2IceAmpACfg）：
         掛在 combat.js monsterDefCfg 的 attr 欄與 resolveHit 既有的 skillElemAmp 乘區
     15. 跟隨我方的地板場域（sgSpawnGround 的 follow）：場域圓心恆等於玩家當下座標，
         與環繞場域同一種錨定方式，差別只在形狀是地板矩形（暴風雪）
     16. 追擊場域（sgSpawnGround 的 chaseM ＋ contact）：抵達落點後改鎖範圍內的隨機敵人
         繼續飛，並採環繞場域的接觸判定（進入才算一次命中），因此追蹤冰箭不必
         另寫一個模擬迴圈，也不會退化成「每個節拍都全額命中」的傷害爆炸
   =========================================================================== */

/* ---- 寒霜狀態的行為參數：權威在狀態表（js/status.js）----
   sgFrost.val＝單層的移動與攻速下降%／sgFrost.maxStacks＝層數上限（疊滿即凍結）／
   sgFrostBite.interval／dur＝跳動間隔與持續時間／sgFrozen.dur＝凍結秒數。
   本檔只決定「哪個群組、每跳打多少寒冰傷害、一次疊幾層」。 */
function sgStatusNum(sid, field, fallback) {
  var d = (typeof statusDef === 'function') ? statusDef(sid) : null;
  var v = Number(d && d[field]);
  return (isFinite(v) && v > 0) ? v : fallback;
}
function sgFrostMaxStacks() { return Math.max(1, Math.floor(sgStatusNum('sgFrost', 'maxStacks', 5))); }
function sgFrostSlowPerStack() { return sgStatusNum('sgFrost', 'val', 20); }
function sgFrostGap() { return sgStatusNum('sgFrostBite', 'interval', 0.5); }
function sgFrostBaseDur() { return sgStatusNum('sgFrostBite', 'dur', 5); }
function sgFrozenSec() { return sgStatusNum('sgFrozen', 'dur', 3); }

/* 增益／減益容器裡這一格是否生效。buffVal 讀的是效果值，而凍結標記的效果值為 0
   （它不加減任何屬性），因此不能用 buffVal 判斷有沒有掛上。 */
function sgBuffActive(ent, key) {
  var b = ent && ent.buffs && ent.buffs[key];
  return !!(b && b.until > GT);
}

/* 【極致寒霜】（冰霜新星 T4）：文檔寫的是「寒霜狀態的傷害／持續時間」，沒有限定
   是哪一棵樹塗上的，因此掛在寒霜共用層——三個群組塗出來的寒霜一起被放大。 */
function skill2FrostDmgFactor() {
  var lvs = skills2Levels('frostnova');
  if (!lvs || lvs[3] < 1) return 1;
  return 1 + sgVal(SKILLS2.frostnova.tiers[3].fx, 'dmgPct', lvs[3]) / 100;
}
function skill2FrostDurFactor() {
  var lvs = skills2Levels('frostnova');
  if (!lvs || lvs[3] < 1) return 1;
  return 1 + sgVal(SKILLS2.frostnova.tiers[3].fx, 'durPct', lvs[3]) / 100;
}

/* 某個群組現在塗出來的寒霜規格（施放當下定版，之後不隨屬性變動）。
   每跳量占「該群組的本體技能傷害」——與燃燒占火球傷害同源（sgFireballBurnSpec）。
   tierIdx＝該群組負責附加寒霜的那一階；沒點出來就回 null（＝這棵樹不塗寒霜）。
   stacksRaw 保留小數並延後到每個目標各自 sgRollCount，機率才是逐目標判定。 */
function sgFrostSpec(g, lvs, tierIdx, bodyDmg) {
  if (!lvs || lvs[tierIdx] < 1 || !(bodyDmg > 0)) return null;
  var fx = g.tiers[tierIdx].fx;
  var pct = sgVal(fx, 'frostPct', lvs[tierIdx]);
  if (!(pct > 0)) return null;
  var gap = sgFrostGap();
  return {
    dps: bodyDmg * pct / 100 * skill2FrostDmgFactor() / gap,
    dur: sgFrostBaseDur() * skill2FrostDurFactor(),
    interval: gap,
    stacksRaw: sgVal(fx, 'stacks', lvs[tierIdx])
  };
}

/* 目前的寒霜層數（權威在疊層狀態的 stacks 欄，由 combat.js stackStep 維護）。 */
function sgFrostStacks(ent) {
  if (!ent || !ent.buffs) return 0;
  var b = ent.buffs.sgFrost;
  return (b && b.until > GT) ? Math.max(0, Math.floor(b.stacks || 0)) : 0;
}
/* 「帶著寒霜狀態」＝層數還在，或凍傷還在跳（兩者同時到期，任一存在都算）。 */
function sgFrostOn(ent) { return sgFrostStacks(ent) > 0 || sgHasDot(ent, 'sgFrostBite'); }
function sgFrozenOn(ent) { return sgBuffActive(ent, 'sgFrozen'); }

/* 塗上寒霜。回傳實際增加的層數（0＝沒塗上）。
   疊滿層數的**那一次**才凍結：維持在滿層時的重塗不再重新凍結——否則每 0.5 秒
   重塗一次就是永久凍結，等於繞過使用者指定要走的控場遞減。 */
function sgApplyFrost(ent, spec, stacksOverride) {
  if (!ent || ent.hp <= 0 || !spec || typeof applyStatus !== 'function') return 0;
  var raw = (stacksOverride === undefined || stacksOverride === null)
    ? Number(spec.stacksRaw) : Number(stacksOverride);
  var want = sgRollCount(raw);
  if (want <= 0) return 0;
  var max = sgFrostMaxStacks();
  var before = sgFrostStacks(ent);
  for (var i = 0; i < want; i++) applyStatus(ent, 'sgFrost', { val: sgFrostSlowPerStack(), dur: spec.dur });
  if (spec.dps > 0) applyStatus(ent, 'sgFrostBite', { dps: spec.dps, dur: spec.dur, interval: spec.interval });
  var after = sgFrostStacks(ent);
  if (before < max && after >= max) sgFreezeTarget(ent);
  return after - before;
}

/* 疊滿層數的凍結：行動限制本身交給既有的暈眩管線（使用者決策：走既有控場管線），
   sgTryStun 已擋掉 BOSS 控場免疫與韌性抗性、applyEffect 再套控場遞減。
   凍結標記的長度必須用「實際暈到的秒數」而不是表定秒數——遞減後若標記比行動限制長，
   就會出現「標記著凍結卻早就能行動」的敵人，而【水龍捲】的增傷與冰爆的時機都讀這個標記。 */
function sgFreezeTarget(ent) {
  var sec = Number(sgTryStun(ent, sgFrozenSec()));
  if (!(sec > 0)) return 0;
  applyStatus(ent, 'sgFrozen', { val: 0, dur: sec });
  sgEmitVfx('frostnova', [ent], 'mv-float', { fxKind: 'burst', variant: 'frost-freeze', elem: 'ice', dur: sec });
  return sec;
}

/* ---- 寒霜緩速的兩個對外掛點（比照泥沼緩速）----
   攻速：formula.js slowFactor｜移速：battlefield.js bfEnemySpeedFactor。
   兩支檔案改吃通用收斂點，日後再增加第三種場域型緩速就不必再動它們。
   寒霜的移速與攻速同幅（文檔：每疊 1 層「移動及攻速」-20%），不必像泥沼分開兩個值。 */
function skill2FrostSlowPct(ent) {
  return (typeof buffVal === 'function') ? Math.max(0, buffVal(ent, 'sgFrost')) : 0;
}
function skill2FrostSlowFactor(ent) {
  var v = skill2FrostSlowPct(ent);
  return v > 0 ? Math.max(0.05, 1 - Math.min(95, v) / 100) : 1;
}
function skill2SlowAspdFactor(ent) { return skill2MireAspdFactor(ent) * skill2FrostSlowFactor(ent); }
function skill2SlowMoveFactor(ent) {
  return skill2MoveSlowFactor(ent) * skill2FrostSlowFactor(ent) * skill2WindMoveFactor(ent);
}

/* ---- 【寒冰逆轉】（水流彈 T2）：敵人屬性標籤強制改寫 ----
   掛點：combat.js monsterDefCfg 的 attr 欄——全專案「防守方屬性標籤」的唯一出口，
   因此攻方的「對屬性敵人傷害%」與守方的「對屬性敵人抗性%」兩條既有規則會一起
   認得這次改寫，不必在各傷害端各補一次判斷。 */
function skill2ForcedAttr(ent) { return sgBuffActive(ent, 'sgIceRevert') ? 'ice' : ''; }

/* 受到的寒冰傷害增幅：掛在 resolveHit 既有的 skillElemAmp（每系獨立乘區，原本服務
   舊技能的元素領域），因此只放大「技能屬性化為寒冰」的本體段，不會誤放大同一次
   攻擊的火／雷等其他屬性段。寒霜凍傷是施放當下定版的平坦 dps（比照燃燒，不走
   resolveHit），因此不吃這個增幅——與火焰增幅對燃燒的既有關係一致。 */
function skill2IceTakenPct(target) {
  return (typeof buffVal === 'function') ? Math.max(0, buffVal(target, 'sgIceRevert')) : 0;
}
function skill2IceAmpACfg(aCfg, target) {
  var pct = skill2IceTakenPct(target);
  if (!(pct > 0)) return aCfg;
  var amp = {};
  for (var k in (aCfg.skillElemAmp || {})) amp[k] = aCfg.skillElemAmp[k];
  amp.ice = (Number(amp.ice) || 1) * (1 + pct / 100);
  aCfg.skillElemAmp = amp;
  return aCfg;
}

/* 寒霜的節拍器：以本引擎自己的計時對齊各凍傷實例的作用間隔（時戳記在敵人實體上、
   純 JSON、隨實體自然回收），不去改動 tickStatuses 的通用結算——與 sgTickBurn 同一套做法。
   負責兩件事：【寒霜擴散】的逐跳擴散判定，以及凍結結束時的【寒冰爆裂箭】冰爆。 */
function sgTickFrost(dt, ctx) {
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  if (!enemies.length) return;
  var wbLvs = skills2Levels('waterball');
  var spreadLv = (wbLvs && wbLvs[0] > 0) ? wbLvs[4] : 0;
  var spreadFx = SKILLS2.waterball.tiers[4].fx;
  var iaLvs = skills2Levels('icearrow');
  var blastOn = !!(iaLvs && iaLvs[6] > 0);
  var tickedNow = null;
  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i];
    if (!e) continue;
    /* 凍結結束＝冰爆的時機。標記消失的那一幀才算結束，因此逐幀比對前一幀的狀態
       （敵人在凍結中死亡也是一種結束，此時以死亡當下的位置引爆）。 */
    var frozen = sgFrozenOn(e) && e.hp > 0;
    if (e._sgFrozenWatch && !frozen) {
      e._sgFrozenWatch = false;
      if (blastOn) {
        sgIceBlast(e, enemies, ctx);
        enemies = ctx.getEnemies ? ctx.getEnemies() : enemies;
      }
    } else if (frozen) e._sgFrozenWatch = true;
    var d = (e.hp > 0) ? sgFindDot(e, 'sgFrostBite') : null;
    if (!d) { if (e._sgAcc) e._sgAcc.sgFrostBite = 0; continue; }
    if (typeof GT === 'number' && e._sgDotSkipAt === GT) continue;
    if (!e._sgAcc) e._sgAcc = {};
    var acc = (e._sgAcc.sgFrostBite || 0) + dt;
    var gap = Math.max(0.1, d.interval || sgFrostGap());
    while (acc >= gap) {
      acc -= gap;
      if (!tickedNow) tickedNow = [];
      if (tickedNow.indexOf(e) < 0) tickedNow.push(e);
      // 【寒霜擴散】（水流彈 T5）：寒霜每次作用時有機率擴散給附近的敵人
      if (spreadLv > 0 && chance(sgVal(spreadFx, 'chance', spreadLv))) {
        sgSpreadFrost(e, enemies, spreadFx, d);
      }
    }
    e._sgAcc.sgFrostBite = acc;
  }
  /* 寒霜可能同時掛在整群敵人身上；同一幀跳動的敵人合併成一則特效事件送出
     （比照燃燒節拍器，避免事件量被放大成敵人數）。 */
  if (tickedNow) {
    sgEmitVfx('icearrow', tickedNow, ctx.floatSel, {
      fxKind: 'impact', variant: 'frost-tick', elem: 'ice'
    });
  }
}

/* 【寒霜擴散】：把「當下這一份寒霜」複製給附近的敵人（同樣的每跳量與剩餘時間，固定 1 層）。
   複製而不是重新計算：來源的凍傷可能已被【極致寒霜】放大過，重算會把它打回表定值。 */
function sgSpreadFrost(from, enemies, fx, dot) {
  var radius = bfMeterPx(Number(fx.m) || 10);
  var count = Math.max(1, Math.floor(Number(fx.count) || 1));
  // 「擴散至目標 m 米內的 count 個敵人」沒有指定最近＝範圍內隨機
  var victims = bfRandomOthers(from, enemies, count, radius, null);
  if (!victims.length) return;
  var spec = { dps: dot.dps, dur: Math.max(0.1, dot.until - GT), interval: dot.interval, stacksRaw: 1 };
  var spread = [];
  for (var i = 0; i < victims.length; i++) {
    if (sgApplyFrost(victims[i], spec, 1) > 0) spread.push(victims[i]);
  }
  if (spread.length) {
    sgEmitVfx('waterball', [from].concat(spread), 'mv-float', { fxKind: 'chain', variant: 'frost-spread', elem: 'ice', travelMs: [80] });
  }
}

/* 【寒冰爆裂箭】（寒冰箭 T7）的冰爆：敵人的凍結結束時，以該敵人為圓心炸開。
   走完整傷害管線（本體傷害段、寒冰屬性），不是衍生傷害——文檔給的是獨立的 400% 技能傷害。
   ctx 可省略（死亡呼叫點沒有 tick ctx），此時由 FIELD 取得玩家實體。 */
function sgIceBlast(ent, enemies, ctx) {
  var lvs = skills2Levels('icearrow');
  if (!lvs || lvs[6] < 1) return;
  var pEnt = (ctx && ctx.pEnt) || ((typeof FIELD !== 'undefined' && FIELD && FIELD.player) ? FIELD.player : null);
  if (!pEnt || pEnt.hp <= 0) return;
  var st = getStats();
  var fx = SKILLS2.icearrow.tiers[6].fx;
  var dmgVal = sgGroupBaseStat(SKILLS2.icearrow, st) * sgVal(fx, 'pct', lvs[6]) / 100;
  if (!(dmgVal > 0)) return;
  var radius = bfMeterPx(Number(fx.m) || 6);
  var victims = sgIceBlastVictims(ent, enemies, radius);
  var floatSel = (ctx && ctx.floatSel) || 'mv-float';
  sgEmitVfx('icearrow', [ent], floatSel, {
    fxKind: 'burst', variant: 'ice-blast', elem: 'ice',
    area: sgAreaAround(ent, radius), preserveDeadTargets: true
  });
  if (!victims.length) return;
  var out = { killed: false, dmg: 0, crit: false };
  for (var i = 0; i < victims.length; i++) {
    sgHitOne(pEnt, st, victims[i], dmgVal, 'icearrow', floatSel, out, sgStaggerMs(i));
  }
  if (ctx && ctx.onDamage && out.dmg > 0) ctx.onDamage(out.dmg);
  if (out.killed && ctx && ctx.onDeaths) ctx.onDeaths();
}

/* 冰爆的受害者：以凍結結束的那個敵人為圓心。該敵人自己若還活著也算在內
   （文檔：對附近的所有敵人造成傷害——凍結解除的本人就在最中心）。 */
function sgIceBlastVictims(ent, enemies, radius) {
  var p = (typeof bfPos === 'function') ? bfPos(ent) : null;
  if (!p) return (ent && ent.hp > 0) ? [ent] : [];
  if (typeof bfEnemiesInArea !== 'function' || typeof bfLiveList !== 'function') return [];
  return bfEnemiesInArea({ x: p.x, y: p.y, r: radius }, bfLiveList(enemies));
}

/* ===========================================================================
   寒冰箭（icearrow）
   ---------------------------------------------------------------------------
   三種形態，全部共用既有基建：
     單體冰箭（T1）  → 扇形挑目標＋逐箭直接結算（比照飛刀的第 1 階）
     貫穿冰箭（T4）  → 飛行投射物（bfSegmentTargets 的路徑命中，比照貫穿突刺）
     追蹤冰箭（T7）  → 同一支箭先貫穿飛完直線，抵達終點後才「換飛行模式」改為追擊
   第 7 階依文檔「寒冰箭變為追蹤冰箭」＝改為（不是追加）：貫穿那一段仍然發生，
   因為文檔的其它說明明寫「射出後會直接朝指定方向貫穿敵人後，再朝範圍內的隨機目標飛去」。
   **貫穿與追擊是同一個飛行物的前後兩段**，不是同時射出的兩發：追擊場域的出生點＝
   貫穿路徑的終點、出生時間＝那支箭飛完直線的時刻、初始航向＝貫穿的方向，
   因此畫面上只會有一顆冰箭，中途改變飛法而已。
   =========================================================================== */

/* 寒冰箭的瞄準：**只有還沒變成貫穿的第 1 階需要挑目標**——那一階是單體攻擊，
   一支箭鎖前方正面最近的一個敵人，目標不足時輪流分配（比照飛刀與雙刀亂舞的既有語意）。
   變成貫穿之後路徑上的敵人一律受傷，箭改為均等分散開，不再經過這裡。
   無座標時（高塔）沒有扇形可言，全部打主目標。 */
function sgIcearrowAim(primary, pool, count, deg, rangePx) {
  var picks = [primary];
  if (typeof bfPos === 'function' && bfPos(primary) &&
      typeof bfConeTargets === 'function' && typeof bfAngleTo === 'function') {
    var cone = bfConeTargets(bfAngleTo(primary), deg, rangePx, pool);
    for (var i = 0; i < cone.length && picks.length < count; i++) {
      if (cone[i] !== primary && cone[i].hp > 0) picks.push(cone[i]);
    }
  }
  var arrows = [];
  for (var k = 0; k < count; k++) arrows.push(picks[k % picks.length]);
  return arrows;
}

/* 貫穿之後的箭道：以主目標方位為中心均等分，相鄰兩支相隔 stepDeg 度。
   這是傷害幾何本身（顯示層用同一個角度），不是只給畫面看的。 */
function sgIcearrowLaneAngle(center, index, count, stepDeg) {
  var base = (center === null || center === undefined || !isFinite(center)) ? 0 : center;
  return base + (index - (count - 1) / 2) * stepDeg * Math.PI / 180;
}

function sgIcearrowTravelMs(ent) {
  var distance = (typeof bfTravelDistance === 'function') ? bfTravelDistance(ent) : 0;
  return Math.max(1, Math.round(Math.max(0, Number(distance) || 0) / sgIcearrowSpeed() * 1000));
}

function sgIcearrowSpeed() {
  var fx = SKILLS2.icearrow && SKILLS2.icearrow.tiers[0].fx;
  var metersPerSecond = fx && Number(fx.speed);
  if (!(metersPerSecond > 0)) return SG_ICEARROW_SPEED;
  return (typeof bfMeterPx === 'function') ? bfMeterPx(metersPerSecond) : metersPerSecond * 10;
}

/* 打得到某個敵人所需的行程（含它的體型半徑）；沒有座標時回 0。 */
function sgIcearrowReach(ent) {
  if (typeof bfTravelDistance !== 'function' || typeof bfPos !== 'function' || !bfPos(ent)) return 0;
  return bfTravelDistance(ent) + (typeof bfEntityRadius === 'function' ? bfEntityRadius(ent) : 0);
}

/* 貫穿長度：文檔的「10 米＋每級 2 米」是箭本身的行程。單看字面值會讓投資第 4 階
   變成降級（射程 30 米的技能只剩 12 米行程，遠處的主目標反而打不到），
   因此以「打得到主目標」為地板——與泥沼術持續時間取 max 的既有處理同一個理由。 */
function sgIcearrowPierceLen(lvs, fx, primary) {
  return Math.max(bfMeterPx(sgVal(fx, 'm', lvs[3])), sgIcearrowReach(primary));
}

function sgCastIcearrow(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  /* 本體每支傷害：第 1 階 ＋【冰系強化】（文檔明寫「與 1 階的傷害為累加效果」）。 */
  var pct = sgVal(t[0].fx, 'pct', lvs[0]) + (lvs[2] > 0 ? sgVal(t[2].fx, 'pct', lvs[2]) : 0);
  var dmgVal = sgGroupBaseStat(g, st) * pct / 100;
  // 【冰箭散射】：數量額外 +N 支（不足 1 支的部分以機率觸發）
  var count = Math.max(1, Math.floor(Number(t[0].fx.count) || 2) +
    (lvs[4] > 0 ? sgRollCount(sgVal(t[4].fx, 'add', lvs[4])) : 0));
  var frost = sgFrostSpec(g, lvs, 1, dmgVal);
  var pierce = lvs[3] > 0 || lvs[6] > 0;   // 追蹤冰箭同樣先貫穿一次
  var geomOk = (typeof bfAngleTo === 'function') && bfAngleTo(primary) !== null;
  var laneStepDeg = Number(t[0].fx.deg) || 15;
  var centerAngle = geomOk ? bfAngleTo(primary) : 0;

  /* 【寒冰爆裂箭】的連射：波數是第 7 階的性質，與有沒有座標無關，
     因此兩條分支（貫穿／無座標的單體）共用同一組波次參數。 */
  var homingFx = lvs[6] > 0 ? t[6].fx : null;
  var waveCount = homingFx ? Math.max(1, Math.floor(Number(homingFx.waves) || 3)) : 1;
  var waveGap = homingFx ? Math.max(0, Number(homingFx.waveGap) || 0.3) : 0;

  if (pierce && geomOk) {
    /* 貫穿之後就沒有「這支箭該對準誰」的問題了：路徑上的敵人一律受傷，
       所以箭只要均等分散開——以主目標方位為中心、相鄰夾角 deg 度。
       傷害幾何與畫面用的是同一個角度：這一段的終點就是追擊段的起點，
       兩者若不同角度，冰箭在轉入追擊的瞬間會憑空橫移一大段。 */
    var lineLen = sgIcearrowPierceLen(lvs, t[3].fx, primary);
    var origin = bfPlayerPos();
    var halfWidth = SG_FLYING_PROJECTILE_HALF_WIDTH;
    var flightSec = lineLen / sgIcearrowSpeed();
    for (var wave = 0; wave < waveCount; wave++) {
      var waveDelay = wave * waveGap;
      for (var ai = 0; ai < count; ai++) {
        var laneAngle = sgIcearrowLaneAngle(centerAngle, ai, count, laneStepDeg);
        var path = bfLineTargets(laneAngle, lineLen, pool, halfWidth, origin);
        /* 這條箭道上一個敵人都沒有也照樣送事件（targets 可以是空的）：
           畫面上那支箭仍要飛出去，方位與行程由 angle／lineLength 帶給顯示層。 */
        sgEmitVfx('icearrow', path, floatSel, {
          fxKind: 'projectile', variant: 'ice-arrow-pierce', elem: 'ice', count: 1,
          lineLength: lineLen, lineWidth: Math.max(20, halfWidth * 2), angle: laneAngle,
          delayMs: Math.round(waveDelay * 1000),
          travelMs: [Math.round(flightSec * 1000)]
        });
        sgQueueFlyingProjectile(pEnt, st, 'icearrow', dmgVal, origin, laneAngle, lineLen,
          floatSel, path, { halfWidthPx: halfWidth, hitFn: sgIcearrowProjectileHit,
            frostSpec: frost, speed: sgIcearrowSpeed(), beginSec: waveDelay }, out);
        // 這支箭飛完直線之後，就地從終點轉入追擊模式（同一個飛行物換飛法）
        if (homingFx) {
          sgSpawnIcearrowHoming(pEnt, st, homingFx, primary, dmgVal, frost, floatSel, {
            from: { x: origin.x + Math.cos(laneAngle) * lineLen,
              y: origin.y + Math.sin(laneAngle) * lineLen },
            moveAngle: laneAngle, wave: wave, startDelaySec: waveDelay + flightSec
          });
        }
      }
    }
  } else {
    /* 還沒變成貫穿的第 1 階是單體攻擊：挑前方正面最近的幾個敵人，一支箭咬一個，
       箭就直接飛向自己的目標（這裡沒有箭道扇形可言，夾角由目標位置決定）。 */
    var arrows = sgIcearrowAim(primary, pool, count, SG_ICEARROW_AIM_DEG,
      skills2CastRangePx('icearrow', lvs));
    for (var wv = 0; wv < waveCount; wv++) {
      var wvDelayMs = Math.round(wv * waveGap * 1000);
      for (var i = 0; i < arrows.length; i++) {
        var travelMs = sgIcearrowTravelMs(arrows[i]);
        var shotAngle = geomOk ? bfAngleTo(arrows[i]) : centerAngle;
        if (shotAngle === null || shotAngle === undefined) shotAngle = centerAngle;
        var lineLength = (typeof bfTravelDistance === 'function') ? bfTravelDistance(arrows[i]) : 0;
        sgEmitVfx('icearrow', [arrows[i]], floatSel, {
          fxKind: 'projectile', variant: 'ice-arrow', elem: 'ice', count: 1,
          angle: shotAngle, lineLength: lineLength, travelMs: [travelMs],
          delayMs: wvDelayMs
        });
        sgIcearrowHit(pEnt, st, arrows[i], dmgVal, frost, lvs, floatSel, out,
          wvDelayMs + travelMs, null);
        /* 無座標（高塔）時沒有幾何可言，但時序仍然成立：箭飛到目標身上才轉入追擊。 */
        if (homingFx) {
          sgSpawnIcearrowHoming(pEnt, st, homingFx, arrows[i], dmgVal, frost, floatSel, {
            wave: wv, startDelaySec: (wvDelayMs + travelMs) / 1000
          });
        }
      }
    }
  }
}

/* 【寒冰爆裂箭】的追擊段：由「這支箭飛完直線的那一刻、那個位置、那個航向」接手，
   在 chaseM 米內來回穿梭。opts 留白＝沒有座標的退化路徑（就地咬住原目標）。 */
function sgSpawnIcearrowHoming(pEnt, st, hfx, target, dmgVal, frost, floatSel, opts) {
  var lifeSec = Math.max(0.5, Number(hfx.sec) || 6);
  var gap = Math.max(0.05, Number(hfx.gap) || 0.1);
  var o = opts || {};
  sgSpawnGround(pEnt, st, 'icearrow', {
    kind: 'icearrow', tgt: target, floatSel: floatSel,
    from: o.from || null,
    /* dest 留白：出生點就是貫穿終點，下一個落點由追擊邏輯自己在範圍內挑，
       初始航向沿用貫穿方向，因此是「順著飛出去再彎回來」而不是原地轉向。 */
    moveAngle: o.moveAngle,
    radius: bfMeterPx(Number(hfx.bodyM) || 1.5),
    dmgVal: dmgVal, hits: Math.max(1, Math.round(lifeSec / gap)), gap: gap,
    speed: sgIcearrowSpeed(), chaseM: Number(hfx.chaseM) || 30,
    contact: true, frostSpec: frost, tickAtStart: true,
    wave: o.wave, startDelaySec: o.startDelaySec
  });
}

/* 一支冰箭命中一個敵人：本體傷害 → 寒霜 →【寒霜凍結】的追加層數與剩餘傷害引爆。
   順序是刻意的：先讓本體傷害結算完，再判斷「命中前」是否已帶寒霜——
   否則本次自己塗上的寒霜會讓第 6 階每一箭都必定觸發。 */
function sgIcearrowHit(pEnt, st, target, dmgVal, frost, lvs, floatSel, out, delayMs, ctx) {
  if (!target || target.hp <= 0) return null;
  var hadFrost = sgFrostOn(target);
  var res = sgHitOne(pEnt, st, target, dmgVal, 'icearrow', floatSel, out, delayMs);
  if (!res || res.miss) return res;
  if (hadFrost && lvs[5] > 0) sgFrostShatter(target, lvs, floatSel, out, ctx);
  if (frost && target.hp > 0) sgApplyFrost(target, frost);
  return res;
}

/* 【寒霜凍結】（寒冰箭 T6）：對已帶寒霜的敵人再疊 N 層，並「造成寒霜所剩餘的寒冰傷害」——
   把還沒跳完的凍傷一次結清（比照血刃斬【零日感染】的立即結算），結清後該筆凍傷就結束。
   追加層數在結清之後才塗：新塗上的那一份不該被同一次結算一起清掉。 */
function sgFrostShatter(target, lvs, floatSel, out, ctx) {
  var dot = sgFindDot(target, 'sgFrostBite');
  var fx = SKILLS2.icearrow.tiers[5].fx;
  if (dot && dot.dps > 0) {
    var remain = Math.max(0, dot.until - GT);
    var amount = dot.dps * remain;
    dot.until = GT;               // 剩餘傷害已一次結清：這筆凍傷到此為止
    if (amount > 0) {
      sgDerivedHit(target, amount, 'icearrow', floatSel, out, '🧊', 0);
      if (ctx && ctx.onDamage) ctx.onDamage(amount);
      if (target.hp <= 0 && ctx && ctx.onDeaths) ctx.onDeaths();
    }
  }
  if (target.hp <= 0) return;
  /* 只疊層、不帶傷害（dps 0）：剩餘凍傷剛剛已一次結清，緊接著呼叫端的第 2 階
     會用正確的每跳量重新塗上寒霜，這裡再算一份傷害只會被那一次覆蓋。
     層數與傷害是兩筆狀態，因此缺傷害不影響疊層。 */
  sgApplyFrost(target,
    { dps: 0, dur: sgFrostBaseDur() * skill2FrostDurFactor(), interval: sgFrostGap(), stacksRaw: 1 },
    sgVal(fx, 'stacks', lvs[5]));
}

/* 貫穿冰箭的路徑命中：與單體冰箭走同一支結算（含寒霜與寒霜凍結）。 */
function sgIcearrowProjectileHit(projectile, target, ctx) {
  var before = projectile.out.dmg;
  sgIcearrowHit(projectile.pEnt, projectile.st, target, projectile.dmgVal,
    projectile.frostSpec, skills2Levels('icearrow'), projectile.floatSel, projectile.out, 0, ctx);
  if (ctx && ctx.onDamage && projectile.out.dmg > before) ctx.onDamage(projectile.out.dmg - before);
  if (target.hp <= 0 && ctx && ctx.onDeaths) ctx.onDeaths();
}

/* ===========================================================================
   水流彈（waterball）
   ---------------------------------------------------------------------------
   本體是一顆拋物線水彈（射程 30 米，離地最高點由表定 arcM 決定，顯示層據此畫弧）。
   第 4 階【寒流爆散】把單體改為「範圍＋彈射」：一次爆散打目標周圍所有敵人，
   之後再彈到下一個目標繼續爆散（彈射次數不足 1 的部分以機率觸發）。
   第 7 階【水龍捲】依文檔未寫「改為」＝追加（比照雷殞天落的既有決策）：
   水流彈照常丟出，另外在我方正方形的四個頂點各召喚一道水龍捲（地板場域）。
   =========================================================================== */
function sgCastWaterball(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var dmgVal = sgGroupBaseStat(g, st) * sgVal(t[0].fx, 'pct', lvs[0]) / 100;
  var frost = sgFrostSpec(g, lvs, 2, dmgVal);
  var revertSec = lvs[1] > 0 ? Math.max(0.1, Number(t[1].fx.sec) || 6) : 0;
  var revertPct = lvs[1] > 0 ? sgVal(t[1].fx, 'pct', lvs[1]) : 0;
  var burstR = lvs[3] > 0 ? bfMeterPx(Number(t[3].fx.m) || 8) : 0;
  var bounces = lvs[3] > 0 ? sgRollCount(sgVal(t[3].fx, 'bounce', lvs[3])) : 0;
  // 【三重流水】：朝隨機目標額外丟出 N 顆（不足 1 顆的部分以機率觸發）
  var extra = lvs[5] > 0 ? sgRollCount(sgVal(t[5].fx, 'add', lvs[5])) : 0;
  var shots = [primary];
  for (var e = 0; e < extra; e++) {
    var rnd = sgRandomEnemyNearPlayer(pool, skills2CastRangePx('waterball', lvs), null);
    shots.push(rnd || primary);
  }
  var arcM = Number(t[0].fx.arcM) || 8;

  for (var si = 0; si < shots.length; si++) {
    sgWaterballShot(pEnt, st, g, lvs, pool, shots[si], floatSel, out, {
      dmgVal: dmgVal, frost: frost, revertSec: revertSec, revertPct: revertPct,
      burstR: burstR, bounces: bounces, arcM: arcM, delayMs: si * SG_WATERBALL_VOLLEY_MS
    });
  }

  // 【水龍捲】：追加四道地板場域，位置固定在我方正方形的四個頂點
  if (lvs[6] > 0) sgSpawnWaterTornadoes(pEnt, st, g, lvs, floatSel);
}

/* 一顆水流彈：飛行（拋物線，顯示層用 arcM 畫弧）→ 命中 → 爆散 → 彈射。
   彈射鏈的每一段都接在前一段的飛行時間之後，飄字與畫面才對得上。 */
function sgWaterballShot(pEnt, st, g, lvs, pool, target, floatSel, out, cfg) {
  if (!target || target.hp <= 0) return;
  var travelMs = (typeof bfTravelSeconds === 'function') ? Math.round(bfTravelSeconds(target) * 1000) : 0;
  var delay = cfg.delayMs + travelMs;
  sgEmitVfx('waterball', [target], floatSel, {
    fxKind: 'projectile', variant: 'waterball', elem: 'ice', count: 1,
    travelMs: [travelMs], delayMs: cfg.delayMs, arcM: cfg.arcM, projectile: true
  });
  var cur = target;
  var visited = [cur];
  var hops = cfg.bounces;
  var hopDelay = delay;
  for (var b = 0; ; b++) {
    var victims = (cfg.burstR > 0 && typeof bfTargetsAround === 'function')
      ? bfTargetsAround(cur, pool, cfg.burstR) : [cur];
    if (!victims.length) victims = [cur];
    if (cfg.burstR > 0) {
      sgEmitVfx('waterball', victims, floatSel, {
        fxKind: 'burst', variant: 'water-burst', elem: 'ice',
        area: sgAreaAround(cur, cfg.burstR), delayMs: hopDelay
      });
    }
    for (var vi = 0; vi < victims.length; vi++) {
      sgWaterballHit(pEnt, st, victims[vi], cfg, floatSel, out, hopDelay + sgStaggerMs(vi));
    }
    if (b >= hops) break;
    /* 【寒流爆散】的敘述沒有規定彈射範圍、也沒有寫「最近」＝整個戰場隨機挑一個
       還沒彈過的敵人；全部彈過之後才允許回跳（→ js/battlefield.js bfRandomOther）。 */
    var next = bfRandomOther(cur, pool, 0, visited) || bfRandomOther(cur, pool, 0, null);
    if (!next || next === cur || next.hp <= 0) break;
    visited.push(next);
    var hopTravelMs = (typeof bfTravelSeconds === 'function') ? Math.round(bfTravelSeconds(next) * 1000) : 0;
    sgEmitVfx('waterball', [cur, next], floatSel, {
      fxKind: 'chain', variant: 'water-bounce', elem: 'ice', count: 1,
      delayMs: hopDelay, travelMs: [0, hopTravelMs], arcM: cfg.arcM
    });
    cur = next;
    hopDelay += hopTravelMs;
  }
}

/* 水流彈命中一個敵人：本體傷害 →【寒冰逆轉】→ 寒霜。
   逆轉塗在傷害之後：本次命中不吃自己造成的受傷增幅，之後的每一次才吃到
   （與落雷術「暈眩塗在傷害之後、後落的雷才吃到增傷」同一個處理原則）。 */
function sgWaterballHit(pEnt, st, target, cfg, floatSel, out, delayMs) {
  if (!target || target.hp <= 0) return null;
  var res = sgHitOne(pEnt, st, target, cfg.dmgVal, 'waterball', floatSel, out, delayMs);
  if (!res || res.miss || target.hp <= 0) return res;
  if (cfg.revertSec > 0) {
    applyStatus(target, 'sgIceRevert', { val: cfg.revertPct, dur: cfg.revertSec });
  }
  if (cfg.frost) sgApplyFrost(target, cfg.frost);
  return res;
}

/* 【水龍捲】（水流彈 T7）：四道地板場域，位置是我方 side×side 米正方形的四個頂點。
   釘在地板上（不跟隨我方）：文檔只說位置在我方範圍的四個頂點，沒有說會跟著跑。 */
function sgSpawnWaterTornadoes(pEnt, st, g, lvs, floatSel) {
  var fx = g.tiers[6].fx;
  var p = (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null;
  var half = bfMeterPx(Number(fx.side) || 10) / 2;
  var radius = bfMeterPx(Number(fx.m) || 5);
  var gap = Math.max(0.05, Number(fx.gap) || 0.35);
  var hits = Math.max(1, Math.floor(Number(fx.hits) || 6));
  var dmgVal = sgGroupBaseStat(g, st) * sgVal(fx, 'pct', lvs[6]) / 100;
  var corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  var count = Math.max(1, Math.floor(Number(fx.count) || 4));
  for (var i = 0; i < count; i++) {
    var c = corners[i % corners.length];
    sgSpawnGround(pEnt, st, 'waterball', {
      kind: 'tornado', tgt: null, floatSel: floatSel,
      from: p ? { x: p.x + c[0] * half, y: p.y + c[1] * half } : null,
      radius: radius, dmgVal: dmgVal, hits: hits, gap: gap,
      frozenMult: Math.max(1, Number(fx.frozen) || 2),
      delaySec: i * gap * 0.15
    });
  }
}

/* ===========================================================================
   冰霜新星（frostnova）
   ---------------------------------------------------------------------------
   以自身為圓心的範圍爆發，是三棵樹裡唯一「不需要目標座標」的技能，因此高塔也能完整生效。
   第 2 階【冰霜衝擊】依文檔「範圍擴展至 13 米」＝改為（取代第 1 階的 12 米），
   但仍以 max 為地板，避免第 1 階練滿後投資第 2 階反而縮小範圍。
   第 5 階【三重新星】為多次施放，每次範圍再 +3 米（逐次累加，第 N 次＝基礎 + 3×N）。
   第 7 階【暴風雪】依文檔未寫「改為」＝追加：新星照常釋放，另外召喚一道跟隨我方的暴風雪。
   =========================================================================== */
function sgCastFrostnova(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var pct = sgVal(t[0].fx, 'pct', lvs[0]) + (lvs[1] > 0 ? sgVal(t[1].fx, 'pct', lvs[1]) : 0);
  var dmgVal = sgGroupBaseStat(g, st) * pct / 100;
  var baseM = Number(t[0].fx.m) || 12;
  if (lvs[1] > 0) baseM = Math.max(baseM, sgVal(t[1].fx, 'm', lvs[1]));
  var frost = sgFrostSpec(g, lvs, 0, dmgVal);
  // 【三重新星】：施放次數額外 +N 次（不足 1 次的部分以機率觸發），且每次範圍再 +m 米
  var casts = 1 + (lvs[4] > 0 ? sgRollCount(sgVal(t[4].fx, 'add', lvs[4])) : 0);
  var stepM = lvs[4] > 0 ? Number(t[4].fx.m) || 0 : 0;
  for (var i = 0; i < casts; i++) {
    sgFrostnovaBurst(pEnt, st, g, lvs, pool, floatSel, out, dmgVal, frost,
      bfMeterPx(baseM + stepM * i), i * SG_FROSTNOVA_VOLLEY_MS);
  }
  // 【暴風雪】：追加一道跟隨我方的地板場域
  if (lvs[6] > 0) sgSpawnBlizzard(pEnt, st, g, lvs, floatSel);
  // 【寒冰體】：冰霜新星 T3 只在施放後授予 6 秒的寒冰體狀態，受擊鉤子讀取該狀態判定窗口。
  if (lvs[2] > 0) applyStatus(pEnt, 'sgFrostbody');
}

/* 一次新星爆發：以我方為圓心的圓形範圍，範圍內每個敵人吃一次本體傷害並附加寒霜。
   無座標時（高塔）退化為「打得到的所有敵人」——與本系統其他範圍查詢的退化規則一致。 */
function sgFrostnovaBurst(pEnt, st, g, lvs, pool, floatSel, out, dmgVal, frost, radiusPx, delayMs) {
  var victims = sgEnemiesNearPlayer(pool, radiusPx, null, 0);
  var p = (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null;
  sgEmitVfx('frostnova', victims, floatSel, {
    fxKind: 'burst', variant: 'frost-nova', elem: 'ice', delayMs: delayMs,
    area: p ? { x: p.x, y: p.y, r: radiusPx } : null
  });
  if (!victims.length) return;
  for (var i = 0; i < victims.length; i++) {
    var res = sgHitOne(pEnt, st, victims[i], dmgVal, 'frostnova', floatSel, out, delayMs + sgStaggerMs(i));
    if (res && !res.miss && frost && victims[i].hp > 0) sgApplyFrost(victims[i], frost);
  }
}

/* 【暴風雪】（冰霜新星 T7）：跟隨我方的正方形地板場域（follow＝圓心恆等於玩家當下座標）。 */
function sgSpawnBlizzard(pEnt, st, g, lvs, floatSel) {
  var fx = g.tiers[6].fx;
  var side = bfMeterPx(Number(fx.side) || 20);
  var gap = Math.max(0.05, Number(fx.gap) || 0.4);
  var lifeSec = Math.max(0.5, Number(fx.sec) || 8);
  sgSpawnGround(pEnt, st, 'frostnova', {
    kind: 'blizzard', tgt: null, floatSel: floatSel,
    from: (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null,
    length: side, width: side,
    dmgVal: sgGroupBaseStat(g, st) * sgVal(fx, 'pct', lvs[6]) / 100,
    hits: Math.max(1, Math.round(lifeSec / gap)), gap: gap, follow: true
  });
}

/* 【死亡新星】（冰霜新星 T6）：帶寒霜的敵人死亡時有機率再釋放一次新星。
   掛在敵人死亡的收斂點（skills2OnEnemyDeath），不是新星自己的施放流程。
   釋放的是「一次爆發」而不是整個 castSkill2：不扣魔、不進冷卻、也不會再觸發
   第 5 階的多次施放與第 7 階的暴風雪（否則連鎖擊殺會遞迴放大）。 */
function sgDeathNova(deadEnt, enemies) {
  var lvs = skills2Levels('frostnova');
  if (!lvs || lvs[5] < 1) return;
  if (!sgFrostOn(deadEnt)) return;
  var t = SKILLS2.frostnova.tiers;
  if (!chance(sgVal(t[5].fx, 'chance', lvs[5]))) return;
  var pEnt = (typeof FIELD !== 'undefined' && FIELD && FIELD.player) ? FIELD.player : null;
  if (!pEnt || pEnt.hp <= 0) return;
  var g = SKILLS2.frostnova;
  var st = getStats();
  var pct = sgVal(t[0].fx, 'pct', lvs[0]) + (lvs[1] > 0 ? sgVal(t[1].fx, 'pct', lvs[1]) : 0);
  var dmgVal = sgGroupBaseStat(g, st) * pct / 100;
  var baseM = Number(t[0].fx.m) || 12;
  if (lvs[1] > 0) baseM = Math.max(baseM, sgVal(t[1].fx, 'm', lvs[1]));
  var out = { killed: false, dmg: 0, crit: false };
  sgFrostnovaBurst(pEnt, st, g, lvs, enemies || [], 'mv-float', out, dmgVal,
    sgFrostSpec(g, lvs, 0, dmgVal), bfMeterPx(baseM), 0);
}

/* 【寒冰體】（冰霜新星 T3）：冰霜新星施放後 6 秒內，攻擊玩家的敵人有 25% 機率被附加寒霜。
   掛在我方受擊收斂點（skills2OnPlayerDamaged），但只有施放時授予的 sgFrostbody 狀態有效才判定。 */
function sgFrostbodyOnPlayerDamaged(mEnt, pEnt, floatSel) {
  if (!pEnt || typeof statusActive !== 'function' || !statusActive(pEnt, 'sgFrostbody')) return;
  var lvs = skills2Levels('frostnova');
  if (!lvs || lvs[0] < 1 || lvs[2] < 1) return;
  if (!mEnt || mEnt.hp <= 0) return;
  var t = SKILLS2.frostnova.tiers;
  if (!chance(sgStatusNum('sgFrostbody', 'val', 25))) return;
  var g = SKILLS2.frostnova;
  var st = getStats();
  var pct = sgVal(t[0].fx, 'pct', lvs[0]) + (lvs[1] > 0 ? sgVal(t[1].fx, 'pct', lvs[1]) : 0);
  var spec = sgFrostSpec(g, lvs, 0, sgGroupBaseStat(g, st) * pct / 100);
  if (!spec) return;
  if (sgApplyFrost(mEnt, spec, sgVal(t[2].fx, 'stacks', lvs[2])) > 0) {
    sgEmitVfx('frostnova', [mEnt], floatSel || 'mv-float', {
      fxKind: 'impact', variant: 'frost-body', elem: 'ice'
    });
  }
}

/* ===========================================================================
   風系三群組（2026-08-18 技能改造第八批）
   ---------------------------------------------------------------------------
   風刃 windblade／真空斬 vacuumslash／暴風屏障 stormbarrier。
   帶進第十七～第二十個群組共用能力，同樣是「引擎收斂點」而不是這三個技能的特例：
     17. 飛行物的延遲發射與沿途脈衝（sgQueueFlyingProjectile 的 beginSec／pulse*）：
         暴風真空刃要同一方向連續射出三道（每道間隔 0.2 秒）、狂風碎裂要在飛行途中
         每 N 秒炸一次周圍——兩者都是飛行物自己的時間軸，不可由呼叫端用 setTimeout
         另開一條（模擬層沒有 DOM，且離線追趕時所有時間都必須跟著 GT 走）
     18. 命中率減益（skill2WindRendHitFactor）：掛在 combat.js monsterAtkCfg 的 hit 欄——
         全專案「攻擊方命中率」的唯一出口，風切一掛上，敵人的普攻與技能一體變不準
     19. 環繞場域的半徑成長（sgSpawnOrbitField 的 growPxPerSec ＋ startAng）：
         虛空斬是「半徑隨時間平滑擴增的螺旋」，與火狩／環體電球共用同一套接觸判定，
         不必另寫一個模擬迴圈
     20. 我方減免的第三個來源（skill2WindDamageRedPct）：暴風屏障與暴風神體依設計文檔
         註記「只與風系類型的減免相加總」，故**先在風系內相加**、再整體乘算——
         與岩甲／大地守護各自的乘區互不吃空間

   風切狀態（設計文檔在真空斬與暴風屏障底下寫的是同一段說明）拆成兩筆狀態，
   理由與寒霜相同（一筆狀態不能同時是 dot 與 stat）：
     sgWindRend 疊層減益（移速下降＋命中下降）｜sgWindCut 風系持續傷害
   與寒霜不同的是**傷害要隨層數提高**（【無限風切】明寫每多 1 層額外受到 50% 風系傷害），
   因此每跳量由引擎依當下層數重算後以 dps 覆寫。
   =========================================================================== */

var SG_VACUUM_WAVE_MS = 260;    // 【迴旋三重奏】第 2 圈之後每圈再錯開多久（純顯示節奏）

/* ---- 風切狀態：表定值 ---- */
function sgWindRendGap() { return Math.max(0.1, sgStatusNum('sgWindCut', 'interval', 0.5)); }
function sgWindRendDur() { return Math.max(0.5, sgStatusNum('sgWindCut', 'dur', 4)); }
/* 移速下降%：刻意讀狀態表的單層值而不是 buffVal——buffVal 對疊層狀態回傳的是
   「單層值 × 層數」，而設計文檔的疊層只加傷害，不會讓緩速跟著疊到 240%。 */
function sgWindRendMovePct() { return Math.max(0, sgStatusNum('sgWindRend', 'val', 80)); }
/* 命中下降%：狀態表只有一個 val 欄（已用於移速），故第二個數字放在技能表的 fx.hit。 */
function sgWindRendHitPct() { return Math.max(0, Number(SKILLS2.vacuumslash.tiers[2].fx.hit) || 0); }
/* 目前允許的層數上限：【無限風切】開放前恆為 1 層。 */
function sgWindRendMaxStacks() {
  var lvs = skills2Levels('vacuumslash');
  if (!lvs || lvs[0] < 1 || lvs[5] < 1) return 1;
  var tier = Math.floor(sgVal(SKILLS2.vacuumslash.tiers[5].fx, 'stacks', lvs[5]));
  return Math.max(1, Math.min(Math.floor(sgStatusNum('sgWindRend', 'maxStacks', 3)), tier));
}

/* 某個群組現在塗出來的風切規格（施放當下定版）。
   per＝1 層時的每秒傷害；extra＝每多 1 層再加的每秒傷害（【無限風切】）。
   tierIdx＝該群組負責附加風切的那一階；該階沒有 cutPct（暴風屏障【亂風切】）時
   採狀態表的預設每跳% ——設計文檔在那一階只寫「附加風切狀態」，沒有另給數值。 */
function sgWindRendSpec(g, lvs, tierIdx, bodyDmg) {
  if (!lvs || lvs[tierIdx] < 1 || !(bodyDmg > 0)) return null;
  var fx = g.tiers[tierIdx].fx;
  var pct = (fx.cutPct === undefined)
    ? Math.max(0, sgStatusNum('sgWindCut', 'dmg', 50))
    : sgVal(fx, 'cutPct', lvs[tierIdx]);
  if (!(pct > 0)) return null;
  var gap = sgWindRendGap();
  var vs = skills2Levels('vacuumslash');
  var extraPct = (vs && vs[0] > 0 && vs[5] > 0)
    ? sgVal(SKILLS2.vacuumslash.tiers[5].fx, 'pct', vs[5]) : 0;
  return {
    per: bodyDmg * pct / 100 / gap,
    extra: bodyDmg * extraPct / 100 / gap,
    dur: sgWindRendDur(), interval: gap
  };
}

/* 目前的風切層數（權威在疊層狀態的 stacks 欄，由 combat.js stackStep 維護）。 */
function sgWindRendStacks(ent) {
  if (!ent || !ent.buffs) return 0;
  var b = ent.buffs.sgWindRend;
  return (b && b.until > GT) ? Math.max(0, Math.floor(b.stacks || 0)) : 0;
}
function sgWindRendOn(ent) { return sgWindRendStacks(ent) > 0 || sgHasDot(ent, 'sgWindCut'); }

/* 狀態表的 maxStacks 是「這個狀態最多能到幾層」，當下允許幾層則由技能階數決定；
   applyStatus 只認得表上的上限，因此塗完之後在這裡把超出的層數收回
   （val 恆等於單層值 × 層數，兩者必須一起修正）。 */
function sgClampWindRendStacks(ent) {
  var b = ent && ent.buffs && ent.buffs.sgWindRend;
  if (!b || !(b.until > GT)) return;
  var max = sgWindRendMaxStacks();
  if (!(b.stacks > max)) return;
  b.stacks = max;
  b.val = (Number(b.unit) || sgWindRendMovePct()) * max;
}

/* 塗上風切。回傳實際增加的層數（0＝只有重新計時、沒有加層）。
   每次都會重新計時（設計文檔 buff 規則的「重上」），持續傷害則依塗完後的層數重算。 */
function sgApplyWindRend(ent, spec, stacksOverride) {
  if (!ent || ent.hp <= 0 || !spec || typeof applyStatus !== 'function') return 0;
  var want = Math.max(1, sgRollCount(
    (stacksOverride === undefined || stacksOverride === null) ? 1 : stacksOverride));
  var before = sgWindRendStacks(ent);
  for (var i = 0; i < want; i++) {
    applyStatus(ent, 'sgWindRend', { val: sgWindRendMovePct(), dur: spec.dur });
    sgClampWindRendStacks(ent);
  }
  var stacks = Math.max(1, sgWindRendStacks(ent));
  var dps = spec.per + Math.max(0, stacks - 1) * (spec.extra || 0);
  if (dps > 0) applyStatus(ent, 'sgWindCut', { dps: dps, dur: spec.dur, interval: spec.interval });
  /* 【風切擴散】要在風切**結束後**才複製這一份規格，但那時狀態實例已經不在了；
     故把當下這份快照掛在敵人實體上（純 JSON、隨實體自然回收，比照 _sgDotSkipAt）。 */
  ent._sgWindRendSpec = { per: spec.per, extra: spec.extra, dur: spec.dur, interval: spec.interval };
  return Math.max(0, sgWindRendStacks(ent) - before);
}

/* ---- 風切／狂風緩速的兩個對外掛點 ----
   命中率：combat.js monsterAtkCfg｜移速：battlefield.js bfEnemySpeedFactor（走 skill2SlowMoveFactor）。 */
function skill2WindRendHitFactor(ent) {
  if (!sgBuffActive(ent, 'sgWindRend')) return 1;
  var pct = Math.min(95, sgWindRendHitPct());
  return pct > 0 ? Math.max(0.05, 1 - pct / 100) : 1;
}
function skill2WindMoveFactor(ent) {
  var f = 1;
  if (sgBuffActive(ent, 'sgWindRend')) {
    f *= Math.max(0.05, 1 - Math.min(95, sgWindRendMovePct()) / 100);
  }
  var gale = (typeof buffVal === 'function') ? Math.max(0, buffVal(ent, 'sgWindSlow')) : 0;
  if (gale > 0) f *= Math.max(0.05, 1 - Math.min(95, gale) / 100);
  return f;
}

/* ---- 我方風系減免與風系增傷（暴風屏障 T1／T7）---- */
/* 風系類型的傷害減免%：屏障與神體**先相加**（設計文檔：只會與風系類型的傷害減免相加總），
   相加後才由 skill2DamageTakenMultiplier 當成一個獨立乘區套用。 */
function skill2WindDamageRedPct(pEnt) {
  if (!pEnt || typeof buffVal !== 'function') return 0;
  return Math.max(0, buffVal(pEnt, 'sgStormBarrier')) + Math.max(0, buffVal(pEnt, 'sgStormGod'));
}
/* 【暴風神體】：自身風系傷害的額外乘算（設計文檔明寫是乘算，不與其他風系增傷相加）。
   掛在 resolveHit 既有的 skillElemAmp 每系獨立乘區，因此只放大「技能屬性化為風」的本體段。 */
function skill2WindAmpACfg(aCfg, pEnt) {
  if (!aCfg || !pEnt || typeof buffVal !== 'function') return aCfg;
  if (!sgBuffActive(pEnt, 'sgStormGod')) return aCfg;
  var lvs = skills2Levels('stormbarrier');
  if (!lvs || lvs[6] < 1) return aCfg;
  var pct = sgVal(SKILLS2.stormbarrier.tiers[6].fx, 'pct', lvs[6]);
  if (!(pct > 0)) return aCfg;
  var amp = {};
  for (var k in (aCfg.skillElemAmp || {})) amp[k] = aCfg.skillElemAmp[k];
  amp.wind = (amp.wind || 1) * (1 + pct / 100);
  aCfg.skillElemAmp = amp;
  return aCfg;
}

/* ===========================================================================
   風刃（windblade）
   ---------------------------------------------------------------------------
   本體是一道貫穿全場的飛行風刃（射程只管「能不能起手」，飛行距離 80 米＝飛出戰鬥區）。
   體積來自群組 range（4*8 米）並被【巨型風刃】整體放大：判定半寬與特效寬度同一個來源。
   方向樹：第 3 階加後方一道；第 7 階改為前後左右四方向、每個方向連續三道（間隔 0.2 秒）。
   小型風刃（第 4 階）預設跟著主風刃射出；第 5 階起改為在場上隨機追擊（追擊場域，接觸判定）。
   =========================================================================== */
function sgWindbladeGeom(g, lvs) {
  var t = g.tiers;
  var body = sgRange(g.range);                                   // 4*8 米（長*寬）
  var scale = lvs[1] > 0 ? 1 + sgVal(t[1].fx, 'size', lvs[1]) / 100 : 1;
  return {
    scale: scale,
    lenPx: bfMeterPx(Math.max(1, Number(t[0].fx.m) || 80)),      // 飛行距離
    speedPx: bfMeterPx(Math.max(1, Number(t[0].fx.speed) || 18)),
    bodyLenPx: bfMeterPx((body.length || 4) * scale),
    halfWidthPx: bfMeterPx((body.width || 8) * scale) / 2,
    smallLenPx: bfMeterPx((Number(t[3].fx.lenM) || 3) * scale),
    smallHalfPx: bfMeterPx((Number(t[3].fx.widthM) || 6) * scale) / 2
  };
}

/* 射出一道風刃：傷害、幾何與特效走同一組參數，因此模擬層與顯示層不會走鐘。
   small＝小型風刃（體積較小、傷害為原風刃的一部分、不帶狂風碎裂的效果）。 */
function sgLaunchWindBlade(pEnt, st, gid, cfg, floatSel, out) {
  var geom = cfg.geom;
  var halfPx = cfg.small ? geom.smallHalfPx : geom.halfWidthPx;
  var bodyPx = cfg.small ? geom.smallLenPx : geom.bodyLenPx;
  var origin = (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null;
  var geomOk = cfg.geomOk && origin;
  var travelMs = Math.round(geom.lenPx / Math.max(1, geom.speedPx) * 1000);
  var path = geomOk
    ? bfLineTargets(cfg.angle, geom.lenPx, cfg.pool, halfPx, origin)
    : (cfg.fallback || []);
  sgEmitVfx(gid, path.length ? path : (cfg.fallback || []), floatSel, {
    fxKind: 'projectile', variant: cfg.small ? 'wind-blade-small' : 'wind-blade',
    elem: 'wind', count: 1, projectile: true,
    lineLength: geom.lenPx, lineWidth: Math.max(8, halfPx * 2),
    travelMs: [travelMs], delayMs: Math.round((cfg.beginSec || 0) * 1000),
    angle: cfg.angle, bodyLength: bodyPx
  });
  sgQueueFlyingProjectile(pEnt, st, gid, cfg.dmgVal, geomOk ? origin : null, cfg.angle,
    geom.lenPx, floatSel, cfg.fallback || [], {
      halfWidthPx: halfPx, speed: geom.speedPx, beginSec: cfg.beginSec || 0,
      slowStatus: cfg.slowPct > 0 ? 'sgWindSlow' : '', slowPct: cfg.slowPct || 0,
      pulseGap: cfg.pulseGap || 0, pulseRadius: cfg.pulseRadius || 0,
      pulseDmg: cfg.pulseDmg || 0, pulseVariant: 'wind-burst'
    }, out);
}

/* 【追跡風刃】：小型風刃改為在場上隨機追擊（追擊場域＋接觸判定，與追蹤冰箭同一套）。 */
function sgSpawnWindChaser(pEnt, st, g, lvs, angle, dmgVal, geom, floatSel) {
  var fx = g.tiers[4].fx;
  var lifeSec = Math.max(0.5, sgVal(fx, 'sec', lvs[4]));
  var gap = Math.max(0.05, Number(fx.gap) || 0.1);
  var from = (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null;
  var reach = bfMeterPx(Math.max(1, Number(fx.chaseM) || 30));
  sgSpawnGround(pEnt, st, 'windblade', {
    kind: 'windblade', tgt: null, floatSel: floatSel, from: from,
    dest: from ? { x: from.x + Math.cos(angle) * reach, y: from.y + Math.sin(angle) * reach } : null,
    radius: Math.max(4, geom.smallHalfPx),
    dmgVal: dmgVal, hits: Math.max(1, Math.round(lifeSec / gap)), gap: gap,
    speed: geom.speedPx, chaseM: Number(fx.chaseM) || 30, contact: true
  });
}

function sgCastWindblade(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  /* 本體傷害：第 1 階 ＋【雙重風刃】＋【暴風真空刃】的風刃傷害加成（設計文檔皆為「風刃傷害 +X%」＝累加）。 */
  var pct = sgVal(t[0].fx, 'pct', lvs[0])
    + (lvs[2] > 0 ? sgVal(t[2].fx, 'pct', lvs[2]) : 0)
    + (lvs[6] > 0 ? sgVal(t[6].fx, 'pct', lvs[6]) : 0);
  var dmgVal = sgGroupBaseStat(g, st) * pct / 100;
  var geom = sgWindbladeGeom(g, lvs);
  var baseAngle = (typeof bfAngleTo === 'function') ? bfAngleTo(primary) : null;
  var geomOk = (baseAngle !== null && baseAngle !== undefined);
  if (!geomOk) baseAngle = 0;

  /* 方向：預設只有正前方；【雙重風刃】加正後方；【暴風真空刃】改為前後左右四個方向。 */
  var dirs = [baseAngle];
  if (lvs[2] > 0) dirs.push(baseAngle + Math.PI);
  var volleys = 1;
  var volleyGap = 0;
  if (lvs[6] > 0) {
    var dc = Math.max(1, Math.floor(Number(t[6].fx.directions) || 4));
    dirs = [];
    for (var d = 0; d < dc; d++) dirs.push(baseAngle + Math.PI * 2 * d / dc);
    volleys = Math.max(1, Math.floor(Number(t[6].fx.count) || 3));
    volleyGap = Math.max(0, Number(t[6].fx.gap) || 0.2);
  }

  // 【狂風碎裂】：命中的敵人移速下降，且風刃沿途每 gap 秒炸一次周圍（只有主風刃有）
  var slowPct = lvs[5] > 0 ? Math.max(0, Number(t[5].fx.move) || 0) : 0;
  var pulseGap = lvs[5] > 0 ? Math.max(0.05, sgVal(t[5].fx, 'gap', lvs[5])) : 0;
  var pulseRadius = lvs[5] > 0 ? bfMeterPx(Number(t[5].fx.m) || 6) : 0;
  var pulseDmg = lvs[5] > 0 ? dmgVal * (Number(t[5].fx.pct) || 0) / 100 : 0;

  // 【亂披風】：小型風刃朝主風刃兩側各 deg 度；傷害為原風刃的一部分
  var smallDmg = lvs[3] > 0 ? dmgVal * sgVal(t[3].fx, 'pct', lvs[3]) / 100 : 0;
  var smallDeg = (Number(t[3].fx.deg) || 30) * Math.PI / 180;
  var chase = lvs[4] > 0;   // 【追跡風刃】：小型風刃改為追擊

  for (var di = 0; di < dirs.length; di++) {
    for (var vi = 0; vi < volleys; vi++) {
      var beginSec = vi * volleyGap;
      sgLaunchWindBlade(pEnt, st, 'windblade', {
        geom: geom, angle: dirs[di], dmgVal: dmgVal, pool: pool, geomOk: geomOk,
        fallback: [primary], beginSec: beginSec, slowPct: slowPct,
        pulseGap: pulseGap, pulseRadius: pulseRadius, pulseDmg: pulseDmg
      }, floatSel, out);
      if (smallDmg <= 0) continue;
      for (var side = -1; side <= 1; side += 2) {
        var ang = dirs[di] + side * smallDeg;
        if (chase) sgSpawnWindChaser(pEnt, st, g, lvs, ang, smallDmg, geom, floatSel);
        else {
          sgLaunchWindBlade(pEnt, st, 'windblade', {
            geom: geom, angle: ang, dmgVal: smallDmg, pool: pool, geomOk: geomOk,
            fallback: [primary], beginSec: beginSec, small: true
          }, floatSel, out);
        }
      }
    }
  }
}

/* ===========================================================================
   真空斬（vacuumslash）
   ---------------------------------------------------------------------------
   第 1 階＝前方範圍內的數名敵人各挨一道斬擊；【迴旋斬】依設計文檔「改為」＝
   改打自身周圍一整圈的所有敵人，【迴旋三重奏】再連續施展數圈、每圈半徑更大。
   【真空爆震】的追加次數對每個目標各結算一次（不足 1 次的部分以機率觸發）。
   第 7 階【虛空斬】依文檔未寫「改為」＝追加（比照雷殞天落／水龍捲／暴風雪的既有決策）：
   本體照常斬出，另外放出兩道反向旋轉、半徑逐秒擴大的虛空斬擊（環繞場域＋接觸判定）。
   =========================================================================== */
function sgVacuumWaveVictims(pool, primary, spin, radiusPx, count, baseAngle, geomOk) {
  if (!geomOk) return (primary && primary.hp > 0) ? [primary] : [];
  if (spin) {
    if (typeof bfEnemiesInArea !== 'function' || typeof bfPlayerPos !== 'function') return [primary];
    var c = bfPlayerPos();
    return bfEnemiesInArea({ x: c.x, y: c.y, r: radiusPx }, bfLiveList(pool));
  }
  /* 前方範圍：以主目標方位為中軸的前方半圓（設計文檔只寫「前方 6 米」，
     沒有給扇形角度，因此取半圓＝「面向的那一側」）。 */
  var cone = (typeof bfConeTargets === 'function') ? bfConeTargets(baseAngle, 180, radiusPx, pool) : [];
  var picks = [];
  for (var i = 0; i < cone.length && picks.length < count; i++) {
    if (cone[i] && cone[i].hp > 0) picks.push(cone[i]);
  }
  if (!picks.length && primary && primary.hp > 0) picks.push(primary);
  return picks;
}

function sgCastVacuumslash(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var pct = sgVal(t[0].fx, 'pct', lvs[0]) + (lvs[3] > 0 ? sgVal(t[3].fx, 'pct', lvs[3]) : 0);
  var dmgVal = sgGroupBaseStat(g, st) * pct / 100;
  // 【真空爆震】：額外造成 N 次傷害（不足 1 次的部分以機率觸發）
  var hits = 1 + (lvs[1] > 0 ? sgRollCount(sgVal(t[1].fx, 'hits', lvs[1])) : 0);
  var rend = sgWindRendSpec(g, lvs, 2, dmgVal);
  var baseAngle = (typeof bfAngleTo === 'function') ? bfAngleTo(primary) : null;
  var geomOk = (baseAngle !== null && baseAngle !== undefined);
  if (!geomOk) baseAngle = 0;

  var spin = lvs[3] > 0;                                   // 【迴旋斬】：改為自身周圍一整圈
  var baseM = spin ? (Number(t[3].fx.m) || 6) : (Number(t[0].fx.m) || 6);
  var waves = 1;
  var stepM = 0;
  if (spin && lvs[4] > 0) {                                // 【迴旋三重奏】
    waves += sgRollCount(sgVal(t[4].fx, 'add', lvs[4]));
    stepM = Number(t[4].fx.m) || 6;
  }
  var count = Math.max(1, Math.floor(Number(t[0].fx.count) || 3));

  for (var w = 0; w < waves; w++) {
    var radiusPx = bfMeterPx(baseM + stepM * w);
    var delayMs = w * SG_VACUUM_WAVE_MS;
    var victims = sgVacuumWaveVictims(pool, primary, spin, radiusPx, count, baseAngle, geomOk);
    sgEmitVfx('vacuumslash', victims, floatSel, {
      fxKind: 'slash', variant: spin ? 'wind-spin' : 'wind-slash', elem: 'wind',
      dur: 0.45, delayMs: delayMs, lineLength: radiusPx,
      area: (spin && geomOk && typeof bfPlayerPos === 'function')
        ? { x: bfPlayerPos().x, y: bfPlayerPos().y, r: radiusPx } : null
    });
    for (var i = 0; i < victims.length; i++) {
      var landed = false;
      for (var h = 0; h < hits; h++) {
        var res = sgHitOne(pEnt, st, victims[i], dmgVal, 'vacuumslash', floatSel, out,
          delayMs + sgStaggerMs(i + h));
        if (res && !res.miss) landed = true;
      }
      // 【風切】：命中才附加（同一個目標一次施放只塗一次，多段傷害不會多疊層）
      if (landed && rend && victims[i].hp > 0) sgApplyWindRend(victims[i], rend);
    }
  }

  if (lvs[6] > 0) sgSpawnVoidDiscs(pEnt, st, g, lvs, floatSel, baseAngle);
}

/* 【虛空斬】：四道以自身為圓心、半徑從 m 米起每秒擴大 growM 米的圓盤，
   每秒繞行 rps 圈，四道皆順時針並以 90 度間隔錯開。
   起始角取主目標方位（文檔：從前方目標出現後開始旋轉）。 */
function sgSpawnVoidDiscs(pEnt, st, g, lvs, floatSel, baseAngle) {
  var fx = g.tiers[6].fx;
  var dmgVal = sgGroupBaseStat(g, st) * sgVal(fx, 'pct', lvs[6]) / 100;
  if (!(dmgVal > 0)) return;
  var discs = Math.max(1, Math.floor(Number(fx.count) || 2));
  var lifeSec = Math.max(0.5, Number(fx.sec) || 6);
  var spin = Math.PI * 2 * (Number(fx.rps) || 1);
  var startR = bfMeterPx(Math.max(1, Number(fx.m) || 6));
  var grow = bfMeterPx(Math.max(0, Number(fx.growM) || 0));
  var bodyR = bfMeterPx(Math.max(1, Number(fx.bodyM) || 6)) / 2;
  for (var i = 0; i < discs; i++) {
    sgSpawnOrbitField(pEnt, st, 'vacuumslash', {
      floatSel: floatSel, lifeSec: lifeSec, dmgVal: dmgVal, bodyR: bodyR,
      count: 1, startAng: baseAngle + Math.PI * 2 * i / discs, growPxPerSec: grow,
      fieldKey: 'void-disc-' + i,
      rings: [{ r: startR, spin: spin }],
      statusId: 'sgVoidBlade', auraVariant: 'void-disc',
      hitVariant: 'wind-burst', hitElem: 'wind'
    });
  }
}

/* ===========================================================================
   暴風屏障（stormbarrier）
   ---------------------------------------------------------------------------
   施放後開啟一段有節拍的自身屏障：每 gap 秒給一次護盾（第 1＋6 階相加），
   期間並持續撕裂周圍（第 2 階）、附加風切（第 3 階）。
   權威狀態＝SKILL2_RT.barrier（until／pEnt／nextAt），sgStormBarrier 增益是投影，
   但**傷害減免直接讀增益值**——減免要在 resolveHit 我方受擊段取用，那裡沒有 RT 的情境。
   第 7 階【暴風神體】是「同時施放的另一個狀態」，因此另立 sgStormGod，
   兩者的減免先相加（文檔：只與風系類型的減免相加總）再整體乘算。
   =========================================================================== */
function sgCastStormbarrier(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var dur = Math.max(0.5, Number(t[0].fx.sec) || 8);
  var gap = Math.max(0.1, Number(t[0].fx.gap) || 0.5);
  applyStatus(pEnt, 'sgStormBarrier', { val: sgVal(t[0].fx, 'red', lvs[0]), dur: dur });
  SKILL2_RT.barrier = { until: GT + dur, pEnt: pEnt, nextAt: GT + gap, gap: gap, floatSel: floatSel };
  sgEmitPlayerVfx('stormbarrier', floatSel, {
    fxKind: 'aura', variant: 'storm-barrier', elem: 'wind', dur: Math.min(6, dur)
  });
  // 【暴風神體】：與屏障同時施放、分開結算的另一個狀態
  if (lvs[6] > 0) {
    var godSec = Math.max(0.1, sgVal(t[6].fx, 'sec', lvs[6]));
    applyStatus(pEnt, 'sgStormGod', { val: sgVal(t[6].fx, 'red', lvs[6]), dur: godSec });
    sgEmitPlayerVfx('stormbarrier', floatSel, {
      fxKind: 'aura', variant: 'storm-god', elem: 'wind', dur: godSec
    });
  }
  sgStormBarrierPulse(SKILL2_RT.barrier, lvs, null);   // 施放當下先給一拍，不必等 0.5 秒
}

/* 屏障是否生效中（RT 為權威；增益圖示只是投影）。 */
function skill2BarrierLevels(pEnt) {
  var rt = SKILL2_RT && SKILL2_RT.barrier;
  if (!rt || rt.until <= GT) return null;
  if (pEnt && rt.pEnt && pEnt !== rt.pEnt) return null;
  var lvs = skills2Levels('stormbarrier');
  return (lvs && lvs[0] >= 1) ? lvs : null;
}

/* 屏障的一拍：護盾（T1＋T6）→ 撕裂傷害（T2）→ 亂風切（T3）。 */
function sgStormBarrierPulse(rt, lvs, ctx) {
  if (!rt || !rt.pEnt || rt.pEnt.hp <= 0) return;
  var g = SKILLS2.stormbarrier;
  var t = g.tiers;
  var st = getStats();
  var floatSel = rt.floatSel;

  // 護盾：占最大生命%，走 grantShield（吃護盾效率與技能護盾上限）
  var shieldPct = sgVal(t[0].fx, 'shield', lvs[0]) + (lvs[5] > 0 ? sgVal(t[5].fx, 'shield', lvs[5]) : 0);
  if (shieldPct > 0 && typeof grantShield === 'function') {
    var gain = grantShield(rt.pEnt, st.hp * shieldPct / 100, st);
    if (gain > 0 && typeof floatPlayerEvent === 'function') {
      var pSel = (typeof playerEventFloatTarget === 'function') ? playerEventFloatTarget(floatSel) : floatSel;
      floatPlayerEvent(pSel, '🌪️+' + fmt(gain), 'shield');
    }
  }

  var enemies = (ctx && ctx.getEnemies) ? ctx.getEnemies()
    : ((typeof FIELD !== 'undefined' && FIELD && FIELD.enemies) ? FIELD.enemies : []);
  var radiusPx = bfMeterPx(Number(t[1].fx.m) || 8);

  // 【暴風撕裂】：每一拍對半徑內的敵人各打一段
  if (lvs[1] > 0) {
    var dmgVal = sgGroupBaseStat(g, st) * sgVal(t[1].fx, 'pct', lvs[1]) / 100;
    var victims = sgEnemiesNearPlayer(enemies, radiusPx, null, 0);
    sgEmitPlayerVfx('stormbarrier', floatSel, { fxKind: 'aura', variant: 'storm-rip', elem: 'wind', dur: rt.gap });
    if (dmgVal > 0 && victims.length) {
      var out = { killed: false, dmg: 0, crit: false };
      for (var i = 0; i < victims.length; i++) {
        sgHitOne(rt.pEnt, st, victims[i], dmgVal, 'stormbarrier', floatSel, out, sgStaggerMs(i));
      }
      if (ctx && ctx.onDamage && out.dmg > 0) ctx.onDamage(out.dmg);
      if (out.killed && ctx && ctx.onDeaths) ctx.onDeaths();
    }
  }

  // 【亂風切】：每一拍對周圍 N 個敵人附加風切（不足 1 個的部分以機率觸發）
  if (lvs[2] > 0) {
    var want = sgRollCount(sgVal(t[2].fx, 'count', lvs[2]));
    if (want > 0) {
      /* 每跳量占本群組的本體技能傷害＝【暴風撕裂】的每拍傷害；該階還沒投資時
         仍以其底值計，風切才不會因為「跳過第 2 階」而完全沒有傷害。 */
      var body = sgGroupBaseStat(g, st) * sgVal(t[1].fx, 'pct', Math.max(1, lvs[1])) / 100;
      var spec = sgWindRendSpec(g, lvs, 2, body);
      // 「對周圍的 count 個敵人附加風切」沒有指定最近＝範圍內隨機
      var picks = sgRandomEnemiesNearPlayer(enemies, radiusPx, null, want);
      var marked = [];
      for (var k = 0; k < picks.length; k++) {
        if (spec && sgApplyWindRend(picks[k], spec) >= 0) marked.push(picks[k]);
      }
      if (marked.length) {
        sgEmitVfx('stormbarrier', marked, floatSel, { fxKind: 'impact', variant: 'wind-rend', elem: 'wind' });
      }
    }
  }
}

function sgTickStormBarrier(dt, ctx) {
  var rt = SKILL2_RT.barrier;
  if (!rt) return;
  var lvs = skill2BarrierLevels(rt.pEnt);
  if (!lvs) { SKILL2_RT.barrier = null; return; }
  var guard = 0;
  while (rt.nextAt <= GT && guard < 20) {
    guard++;
    rt.nextAt += rt.gap;
    sgStormBarrierPulse(rt, lvs, ctx);
  }
}

/* 【暴風之刃】（T4）：屏障作用中受到傷害時，機率射出一道貫穿風刃。
   依設計文檔註記「就是【風刃】技能，但只限於風刃第 1 階、沒有後續進化」，
   因此傷害固定取風刃第 1 階的 Lv.1 表定值（不隨玩家的風刃投資變動），
   但基準攻擊力與傷害紀錄都歸暴風屏障這個群組——它才是這道刃的來源。 */
function sgStormbladeOnPlayerDamaged(mEnt, pEnt, floatSel) {
  var lvs = skill2BarrierLevels(pEnt);
  if (!lvs || lvs[3] < 1 || !mEnt || mEnt.hp <= 0) return;
  var t = SKILLS2.stormbarrier.tiers;
  if (!chance(sgVal(t[3].fx, 'chance', lvs[3]))) return;
  var st = getStats();
  var wb = SKILLS2.windblade;
  var wlvs = [1, 0, 0, 0, 0, 0, 0];
  var geom = sgWindbladeGeom(wb, wlvs);
  var dmgVal = sgGroupBaseStat(SKILLS2.stormbarrier, st) * sgVal(wb.tiers[0].fx, 'pct', 1) / 100;
  if (!(dmgVal > 0)) return;
  var angle = (typeof bfAngleTo === 'function') ? bfAngleTo(mEnt) : null;
  var geomOk = (angle !== null && angle !== undefined);
  var enemies = (typeof FIELD !== 'undefined' && FIELD && FIELD.enemies) ? FIELD.enemies : [mEnt];
  sgLaunchWindBlade(pEnt, st, 'stormbarrier', {
    geom: geom, angle: geomOk ? angle : 0, dmgVal: dmgVal, pool: enemies,
    geomOk: geomOk, fallback: [mEnt]
  }, floatSel || 'mv-float', { killed: false, dmg: 0, crit: false });
}

/* 【風切擴散】（T5）：風切結束（含帶著風切死亡）後擴散給附近的敵人。
   逐幀比對前一幀的狀態，與冰系「凍結結束＝冰爆」同一種寫法。 */
function sgTickWindRend(dt, ctx) {
  var lvs = skills2Levels('stormbarrier');
  var spreadOn = !!(lvs && lvs[0] > 0 && lvs[4] > 0);
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i];
    if (!e) continue;
    var on = sgWindRendOn(e) && e.hp > 0;
    if (e._sgWindWatch && !on) {
      e._sgWindWatch = false;
      if (spreadOn) {
        sgSpreadWindRend(e, enemies, lvs);
        enemies = ctx.getEnemies ? ctx.getEnemies() : enemies;
      }
    } else if (on) e._sgWindWatch = true;
  }
}

/* 擴散：複製「這一份風切」（同樣的每跳量與表定持續時間，固定 1 層），
   複製而不是重算——來源的每跳量可能來自真空斬，重算會用成暴風屏障的數字。 */
function sgSpreadWindRend(from, enemies, lvs) {
  var spec = from && from._sgWindRendSpec;
  if (!spec) return;
  var fx = SKILLS2.stormbarrier.tiers[4].fx;
  var count = sgRollCount(sgVal(fx, 'count', lvs[4]));
  if (count <= 0) return;
  // 「擴散至 m 米內的 count 個敵人」沒有指定最近＝範圍內隨機
  var victims = bfRandomOthers(from, enemies, count, bfMeterPx(Number(fx.m) || 10), null);
  var spread = [];
  for (var i = 0; i < victims.length; i++) {
    if (sgWindRendOn(victims[i])) continue;
    sgApplyWindRend(victims[i], spec, 1);
    spread.push(victims[i]);
  }
  if (spread.length) {
    sgEmitVfx('stormbarrier', [from].concat(spread), 'mv-float', {
      fxKind: 'chain', variant: 'wind-rend-spread', elem: 'wind', travelMs: [80],
      preserveDeadTargets: true
    });
  }
}

function skills2OnPlayerDamaged(mEnt, pEnt, hpDamage, blocked, res, floatSel) {
  if (!SKILL2_RT || !mEnt || !pEnt) return;
  if (res && (res.miss || res.invuln || res.killed)) return;
  if (!(pEnt.hp > 0)) return;
  /* 受擊收斂點現在服務四個群組；各自獨立判定，彼此不得互相短路。 */
  sgRockOnPlayerDamaged(mEnt, pEnt, hpDamage, res, floatSel);            // 岩甲術 T3／T5／T6
  sgEarthguardReflect(mEnt, pEnt, hpDamage, res, floatSel);              // 大地守護 T6
  /* 順序有意義：【戰神體】要把「這一下」也算進失血視窗，緊接著的反擊才吃得到，
     設計文檔寫的是「1 秒內所損失的生命…在接下來的反擊中一併附加」。 */
  sgWarGodBodyOnDamaged(hpDamage);                                       // 反擊超神【戰神體】
  sgCounterOnPlayerDamaged(mEnt, pEnt, hpDamage, blocked, res, floatSel); // 反擊
  sgFrostbodyOnPlayerDamaged(mEnt, pEnt, floatSel);                      // 冰霜新星 T3【寒冰體】
  sgStormbladeOnPlayerDamaged(mEnt, pEnt, floatSel);                     // 暴風屏障 T4【暴風之刃】
}

/* 哪些階會「觸發時扣魔」（1＝扣、0＝不扣）。這張表是程式端的接線：有沒有獨立的
   觸發時機是寫在程式裡的事實，不能靠參數表某一格有沒有填值去猜——
   例如大地守護全是恆時被動（沒有觸發時機），表上那幾格 25 只是舊的預設值。
   反擊 T3【強化反擊】是恆時傷害加成，依使用者決策（2026-08-19）不扣魔。 */
var SG_TRIGGER_MP_TIERS = { counter: [1, 1, 0, 1, 1, 1, 1] };
/* 某一階「觸發一次要付的法力」＝參數表「施法消耗」欄的該階列（tiers[i].cost）。
   這是扣魔與 UI 顯示的唯一來源，兩邊不得各算各的。
   沒有觸發時機的階、以及主動群組一律回 0——主動群組在 castSkill2 付群組層的 g.cost。 */
function skills2TierTriggerMp(gid, tierIdx) {
  var g = SKILLS2[gid];
  var mask = SG_TRIGGER_MP_TIERS[gid];
  if (!g || !mask || !mask[tierIdx]) return 0;
  var t = g.tiers[tierIdx];
  var c = t ? Number(t.cost) : 0;
  return c > 0 ? c : 0;
}
/* 付一階的觸發消耗：付得起就扣魔回 true，付不起回 false（＝該階這一次不觸發）。
   只在「效果確定要發生」的當下呼叫——機率沒中、沒有可打的目標都不該先扣魔。 */
function sgCounterPayMp(pEnt, tierIdx) {
  var cost = skills2TierTriggerMp('counter', tierIdx);
  if (cost <= 0) return true;
  if (!pEnt || !((pEnt.mp || 0) >= cost)) return false;
  pEnt.mp -= cost;
  return true;
}
/* 已投資的階裡最便宜的觸發消耗：法力低於這個值就整個被動都動不了，
   供 UI 把技能格畫成「無魔」（ui.js 快捷列與戰鬥技能列共用）。 */
function skills2PassiveMinMp(gid, levels) {
  var g = SKILLS2[gid];
  if (!g || !SG_TRIGGER_MP_TIERS[gid]) return 0;
  var lvs = levels || [];
  var min = 0;
  for (var i = 0; i < g.tiers.length; i++) {
    if (!(lvs[i] > 0)) continue;
    var c = skills2TierTriggerMp(gid, i);
    if (c > 0 && (min === 0 || c < min)) min = c;
  }
  return min;
}

function sgCounterOnPlayerDamaged(mEnt, pEnt, hpDamage, blocked, res, floatSel) {
  if (!skills2PassiveActive('counter')) return; // 主動型被動：沒裝在技能列就不生效
  var lvs = skills2Levels('counter');
  if (!lvs || lvs[0] < 1) return;
  var t = SKILLS2.counter.tiers;
  var st = getStats();
  var eSel = (typeof THORN_FLOAT_MAP !== 'undefined' && THORN_FLOAT_MAP[floatSel]) || floatSel;

  // 破甲擊（T5）：格擋時機率上破甲（敵方 defDown 減益、疊層重置時間；與反擊傷害判定各自獨立）
  if (blocked && lvs[4] > 0 && mEnt.hp > 0 && chance(Number(t[4].fx.chance) || 0) &&
      sgCounterPayMp(pEnt, 4)) {
    applyStatus(mEnt, 'sgArmorBrk', { val: Number(t[4].fx.def) || 0, dur: sgVal(t[4].fx, 'sec', lvs[4]) });
    sgEmitVfx('counter', [mEnt], eSel, { fxKind: 'impact', variant: 'armor-break' });
  }
  /* 攻擊者已死就沒有反擊可打——必須在扣魔之前先擋掉，否則會為了不會發生的
     反擊付魔（破甲那段自己有 hp>0 判定，不受影響）。 */
  if (mEnt.hp <= 0) return;

  // 反擊判定：pct＝普攻傷害%；強化反擊（T3）對所有反擊累加（恆時生效、不扣魔）
  var bonus = lvs[2] > 0 ? sgVal(t[2].fx, 'pct', lvs[2]) : 0;
  var strikes = [];
  var tookDamage = (hpDamage > 0) || !!(res && res.absorbed > 0);
  if (tookDamage && chance(Number(t[0].fx.chance) || 0) && sgCounterPayMp(pEnt, 0)) {
    strikes.push(sgVal(t[0].fx, 'pct', lvs[0]) + bonus);
  }
  if (blocked && lvs[1] > 0) {
    var blockRed = (typeof blockDmgReduction === 'function') ? blockDmgReduction(st.blockDmgRed || 0) : 0;
    var parryPct = blockRed * sgVal(t[1].fx, 'mult', lvs[1]) / 100;
    if (parryPct > 0 && sgCounterPayMp(pEnt, 1)) strikes.push(parryPct + bonus);
  }
  if (!strikes.length) return;

  // 二次反擊（T6）：每個成立的反擊各自機率追加 count 次（同傷害%、不再判定）
  var all = [];
  for (var i = 0; i < strikes.length; i++) {
    all.push(strikes[i]);
    if (lvs[5] > 0 && chance(sgVal(t[5].fx, 'chance', lvs[5])) && sgCounterPayMp(pEnt, 5)) {
      var extraN = Math.max(1, Math.floor(Number(t[5].fx.count) || 2));
      for (var xi = 0; xi < extraN; xi++) all.push(strikes[i]);
    }
  }

  // 野外才有敵群可反殺；高塔（單一 BOSS）反殺自然無目標
  var enemies = (typeof combatFieldEnemies === 'function' && typeof FIELD !== 'undefined' &&
    FIELD && FIELD.player === pEnt) ? combatFieldEnemies() : [mEnt];
  var out = { killed: false, dmg: 0, crit: false };
  var splashHit = [];
  /* 傳奇與超神的參數包：一個受擊事件只算一次，事件內所有斬擊共用同一份
     ——【戰神體】的失血視窗尤其不能每一斬各算一次（同一份失血會被重複計價）。 */
  var cfg = sgCounterLegendCfg(enemies);
  sgEmitVfx('counter', [mEnt], eSel, { fxKind: 'strike', variant: 'counter-riposte', count: Math.min(5, all.length) });
  var hitIdx = 0;
  /* 迴圈也要看玩家自己還活著：傳奇【以血還血】每一斬都扣自身生命，
     一輪反殺打完可能已經把自己打死，死後不該繼續揮刀。 */
  for (i = 0; i < all.length && mEnt.hp > 0 && pEnt.hp > 0; i++) {
    sgCounterStrike(pEnt, st, mEnt, all[i], eSel, out, sgStaggerMs(hitIdx++), cfg);
    /* 狂化反殺（T7）：每次反擊額外對範圍內隨機 count 個敵人反擊（不再判定）。
       先挑目標再扣魔——範圍內沒人可打時不該白付魔。 */
    /* 傳奇【以血還血】把自己打死之後就不該再揮：追加斬擊各自還要再付一次代價。 */
    if (lvs[6] > 0 && pEnt.hp > 0) {
      var victims = sgCounterSplashTargets(mEnt, enemies, t[6].fx);
      if (!victims.length || !sgCounterPayMp(pEnt, 6)) continue;
      for (var vi = 0; vi < victims.length; vi++) {
        sgCounterStrike(pEnt, st, victims[vi], sgVal(t[6].fx, 'pct', lvs[6]) + bonus, eSel, out, sgStaggerMs(hitIdx++), cfg);
        if (splashHit.indexOf(victims[vi]) < 0) splashHit.push(victims[vi]);
      }
    }
  }


  /* 反擊盾（T4）：每次反擊事件回復一次（吃護盾效率與技能護盾上限 → formula.js grantShield）。
     扣魔在 grantShield 之前——護盾已經滿到上限時 gained 會是 0，但那是「觸發了但沒得回」，
     仍然算一次觸發。 */
  if (lvs[3] > 0 && typeof grantShield === 'function' && sgCounterPayMp(pEnt, 3)) {
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
function sgCounterStrike(pEnt, st, target, pct, floatSel, out, delayMs, cfg) {
  if (!target || target.hp <= 0 || !(pct > 0)) return null;
  pct = sgCounterApplyLegends(pEnt, st, pct, cfg);
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
  sgCounterAfterStrike(pEnt, st, target, cfg, floatSel, out, delayMs);
  return res;
}

/* ---- 反擊的傳奇進化與超神進化（2026-08-21 第四批）----
   盾牌是副手（cat offHand），**沒有**雙手武器補償，因此 fx 寫多少就是多少。 */

/* 反擊的累計器。分開記每個效果的計數而不是共用一個總數，是因為門檻各自獨立
  （堅韌誓言／怒火 100 次、神聖之體 10 次），共用總數的話換裝之後會互相踩到。 */
function sgCounterRT() {
  if (!SKILL2_RT.counter) SKILL2_RT.counter = { hits: 0, oath: 0, wrath: 0, holy: 0, loss: [] };
  return SKILL2_RT.counter;
}

/* 超神【戰神體】：把最近 sec 秒內損失的生命（占最大生命的百分比）加到反擊傷害上。
   設計文檔給的升級效果只有「持續時間 +0.1 秒」，沒有任何傷害係數——
   這反過來證明效果的量級本來就等於失血百分比本身，因此直接當成 +lostPct% 的乘區
  （與【狂血盛宴】用失血百分比當乘區是同一套算法）。 */
function sgWarGodBodyPct() {
  var u = sgUlt('counter', 'warGodBody');
  if (!u) return 0;
  var rt = sgCounterRT();
  var sec = Math.max(0.1, sgUltVal(u, 'sec'));
  var total = 0;
  for (var i = rt.loss.length - 1; i >= 0; i--) {
    // 依時間遞增排列，往回掃到第一筆過期的就代表 0..i 全部過期，一次砍掉
    if (rt.loss[i].at < GT - sec) { rt.loss.splice(0, i + 1); break; }
    total += rt.loss[i].pct;
  }
  return total;
}

/* 失血視窗的唯一寫入點。只計「敵方造成的受擊傷害」——持續傷害與自傷技能
   不經過 skills2OnPlayerDamaged，這是刻意的範圍（與【反擊】本體的觸發條件一致：
   反擊反的就是攻擊者，沒有攻擊者的失血本來就沒有反擊可以附加）。 */
function sgWarGodBodyOnDamaged(hpDamage) {
  if (!(hpDamage > 0) || !SKILL2_RT || !skills2PassiveActive('counter')) return;
  if (!sgUlt('counter', 'warGodBody') || typeof getStats !== 'function') return;
  var st = getStats();
  if (!(st.hp > 0)) return;
  var rt = sgCounterRT();
  rt.loss.push({ at: GT, pct: Math.min(100, hpDamage / st.hp * 100) });
  // 護欄：多段傷害的極端情況下不得無限成長（視窗最長 2 秒，遠遠夠用）
  if (rt.loss.length > 400) rt.loss.splice(0, rt.loss.length - 400);
}

/* 一個反擊事件的傳奇／超神參數包。 */
function sgCounterLegendCfg(enemies) {
  /* 走每拍快取：反擊掛在「我方受擊」上，一拍可能被呼叫好幾次。 */
  var lg = sgLegendTick('counter');
  return {
    perfect: lg.counterPerfect || null,
    bloodPay: lg.counterBloodPay || null,
    wind: lg.counterWindBlade || null,
    oath: lg.counterOath || null,
    wrath: lg.counterWrath || null,
    holy: sgUlt('counter', 'holyBody'),
    warGodPct: sgWarGodBodyPct(),
    enemies: enemies || []
  };
}

/* 單次斬擊的傷害修正：三者互相獨立、各自一個乘區，也都不影響本體各階的加總。 */
function sgCounterApplyLegends(pEnt, st, pct, cfg) {
  if (!cfg) return pct;
  if (cfg.perfect && typeof chance === 'function' && chance(Number(cfg.perfect.chance) || 0)) {
    pct *= 1 + (Number(cfg.perfect.pct) || 0) / 100;   // 傳奇【完美姿態】
  }
  if (cfg.bloodPay) {
    pct *= 1 + (Number(cfg.bloodPay.pct) || 0) / 100;  // 傳奇【以血還血】
    /* 代價：每一斬各付一次（二次反擊與狂化反殺的追加斬擊都算），直接扣血、不吃護盾。
       扣到 0 由戰鬥迴圈既有的判死路徑接手，與【血飲術】反噬同一個口徑。 */
    var cost = Math.max(1, Math.round(st.hp * (Number(cfg.bloodPay.hpPct) || 0) / 100));
    var gmFloor = (typeof GM_TEST !== 'undefined' && GM_TEST && GM_TEST.god) ? 1 : 0;
    if (pEnt) pEnt.hp = Math.max(gmFloor, pEnt.hp - cost);
  }
  if (cfg.warGodPct > 0) pct *= 1 + cfg.warGodPct / 100;  // 超神【戰神體】
  return pct;
}

/* 每一次斬擊之後的累計與衍生效果。累計的是「斬擊次數」而不是「受擊事件次數」
   ——二次反擊與狂化反殺的追加斬擊都算，否則 100 次的門檻在實際節奏下幾乎達不到。 */
function sgCounterAfterStrike(pEnt, st, target, cfg, floatSel, out, delayMs) {
  if (!cfg || !pEnt) return;
  var rt = sgCounterRT();
  rt.hits++;
  if (cfg.wind && typeof chance === 'function' && chance(Number(cfg.wind.chance) || 0)) {
    sgCounterWindBlade(pEnt, st, target, cfg.wind, floatSel, out, delayMs);
  }
  if (cfg.oath) {
    rt.oath++;
    if (rt.oath >= Math.max(1, Math.floor(Number(cfg.oath.count) || 1))) {
      rt.oath = 0;
      applyStatus(pEnt, 'invuln', { dur: Math.max(0.2, Number(cfg.oath.sec) || 0) });
      if (typeof floatPlayerEvent === 'function') floatPlayerEvent('pv-float', '堅韌誓言!', 'buff');
    }
  }
  if (cfg.wrath) {
    rt.wrath++;
    if (rt.wrath >= Math.max(1, Math.floor(Number(cfg.wrath.count) || 1))) {
      rt.wrath = 0;
      applyStatus(pEnt, 'sgCounterWrath', {
        val: Number(cfg.wrath.pct) || 0, dur: Math.max(0.2, Number(cfg.wrath.sec) || 0)
      });
      if (typeof floatPlayerEvent === 'function') floatPlayerEvent('pv-float', '怒火!', 'buff');
    }
  }
  if (cfg.holy) {
    rt.holy++;
    if (rt.holy >= Math.max(1, Math.floor(sgUltVal(cfg.holy, 'count')))) {
      rt.holy = 0;
      sgCounterHolyOrb(pEnt, st, target, cfg, floatSel, out, delayMs);
    }
  }
}

/* 傳奇【風之體】：朝目標射出一道風刃。走 sgHitOne 的正規結算（可爆擊、吃屬性抗性），
   統計併入 skill2:counter；傷害基準是普攻攻擊力（反擊群組為物理群組）。 */
function sgCounterWindBlade(pEnt, st, target, spec, floatSel, out, delayMs) {
  if (!target || target.hp <= 0) return;
  var dmgVal = sgGroupBaseStat(SKILLS2.counter, st) * (Number(spec.powerPct) || 0) / 100;
  if (!(dmgVal > 0)) return;
  sgEmitVfx('counter', [target], floatSel, {
    fxKind: 'projectile', variant: 'wind-blade-homing', elem: 'wind', dur: 0.5
  });
  sgHitOne(pEnt, st, target, dmgVal, 'counter', floatSel, out, delayMs, 0, 'wind');
}

/* 超神【神聖之體】：每 count 次反擊射出一顆光彈，對目標周圍 m 米內的敵人造成神聖傷害。
   範圍以「目標」為圓心（設計文檔寫的是「射向目標，對周圍 8 米」），
   不是以玩家為圓心——狂化反殺會把反擊打到遠處的敵人身上，兩者差很多。 */
function sgCounterHolyOrb(pEnt, st, target, cfg, floatSel, out, delayMs) {
  var u = cfg.holy;
  var dmgVal = sgGroupBaseStat(SKILLS2.counter, st) * sgUltVal(u, 'pct') / 100;
  if (!(dmgVal > 0) || !target) return;
  var victims = [target];
  if (typeof bfNearestOthers === 'function' && cfg.enemies.length) {
    var near = bfNearestOthers(target, cfg.enemies, cfg.enemies.length, bfMeterPx(sgUltVal(u, 'm')));
    for (var i = 0; i < near.length; i++) victims.push(near[i]);
  }
  sgEmitVfx('counter', victims, floatSel, { fxKind: 'burst', elem: 'light', dur: 0.6 });
  for (var v = 0; v < victims.length; v++) {
    sgHitOne(pEnt, st, victims[v], dmgVal, 'counter', floatSel, out, (delayMs || 0) + sgStaggerMs(v), 0, 'light');
  }
}

/* 超神【不屈鬥魂】：死亡攔截。掛在 js/combat.js onPlayerFieldDeath——野外有多條判死路徑，
   那裡是它們唯一的共同出口（與【天地共生】同一個掛點）。
   兌現內容：地系全屏爆發 → 倒地 sec 秒（無敵、無法行動）→ 原地滿血復活，不算戰鬥失敗。
   冷卻沿用 pEnt.skillCds[SG_PREFIX + counter]（被動群組從不施放，這個鍵沒有別的用途），
   因此讀檔／離開戰鬥的清理與一般技能冷卻完全一致。 */
function skills2TryLastStand(pEnt) {
  if (!pEnt || !SKILL2_RT || typeof getStats !== 'function') return false;
  var u = sgUlt('counter', 'indomitable');
  if (!u || !skills2PassiveActive('counter')) return false;
  if (SKILL2_RT.lastStand) return false;      // 倒地期間又被判死＝這一次不再攔截
  if (!pEnt.skillCds) pEnt.skillCds = {};
  if ((pEnt.skillCds[SG_PREFIX + 'counter'] || 0) > 0) return false;
  var st = getStats();
  var sec = Math.max(0.5, sgUltVal(u, 'sec'));
  var radius = bfMeterPx(sgUltVal(u, 'm'));
  var enemies = (typeof combatFieldEnemies === 'function' && typeof FIELD !== 'undefined' &&
    FIELD && FIELD.player === pEnt) ? combatFieldEnemies() : [];
  var victims = [];
  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i];
    if (!e || e.hp <= 0) continue;
    if (typeof bfPos === 'function' && bfPos(e) && typeof bfEntityDistance === 'function' &&
        bfEntityDistance(e) > radius) continue;
    victims.push(e);
  }
  var out = { killed: false, dmg: 0, crit: false };
  if (victims.length) {
    sgEmitVfx('counter', victims, 'mv-float', { fxKind: 'burst', elem: 'earth', dur: 0.8 });
    var dmgVal = sgGroupBaseStat(SKILLS2.counter, st) * sgUltVal(u, 'pct') / 100;
    for (var v = 0; v < victims.length; v++) {
      sgHitOne(pEnt, st, victims[v], dmgVal, 'counter', 'mv-float', out, sgStaggerMs(v), 0, 'earth');
    }
  }
  /* 倒地：生命鎖在 1（不是 0——0 會被下一次判死再抓一次），期間無敵且無法行動。 */
  if (typeof cleanse === 'function') cleanse(pEnt);   // 先淨化再上無敵，避免無敵被自己清掉
  pEnt.hp = 1;
  applyStatus(pEnt, 'invuln', { dur: sec });
  pEnt.skillCds[SG_PREFIX + 'counter'] = Math.max(1, sgUltVal(u, 'cd'));
  SKILL2_RT.lastStand = { reviveAt: GT + sec, pEnt: pEnt, done: false };
  sgEmitPlayerVfx('counter', 'pv-float', { fxKind: 'aura', variant: 'rock-armor', elem: 'earth', dur: Math.min(6, sec) });
  if (typeof floatPlayerEvent === 'function') floatPlayerEvent('pv-float', '不屈鬥魂!', 'buff');
  if (typeof blog === 'function') {
    blog('🛡️ 【不屈鬥魂】你倒下的瞬間大地為之震動——' + Math.round(sec) + ' 秒後你將原地站起繼續戰鬥！', 'info');
  }
  if (typeof UI !== 'undefined' && UI.dirty) { UI.dirty.battle = true; UI.dirty.skills = true; }
  if (out.killed && typeof onFieldDeaths === 'function') onFieldDeaths();
  return true;
}

/* 倒地期間不能行動（普攻與技能一起擋）。掛點：combat.js 的玩家行動閘門。 */
function skill2DownedActive() {
  var ls = SKILL2_RT && SKILL2_RT.lastStand;
  return !!(ls && !ls.done && ls.reviveAt > GT);
}

/* 倒地期滿：原地滿血站起來。 */
function sgTickLastStand(ctx) {
  var ls = SKILL2_RT.lastStand;
  if (!ls || ls.done || ls.reviveAt > GT) return;
  ls.done = true;
  var pEnt = ls.pEnt || ctx.pEnt;
  SKILL2_RT.lastStand = null;   // 兌現完就歸還，之後只由 60 秒冷卻把關
  if (!pEnt || typeof getStats !== 'function') return;
  pEnt.hp = getStats().hp;
  sgEmitPlayerVfx('counter', 'pv-float', { fxKind: 'rain', variant: 'pillar', elem: 'earth', dur: 1.2 });
  if (typeof floatPlayerEvent === 'function') floatPlayerEvent('pv-float', '復活!', 'buff');
  if (typeof blog === 'function') blog('🛡️ 【不屈鬥魂】你站了起來，生命完全恢復！', 'good');
  if (typeof UI !== 'undefined' && UI.dirty) UI.dirty.battle = true;
}

/* 超神【阿修羅霸王拳】：每 gap 秒自動發動一次全傷害爆發。
   口徑與【殺神領域】一致——嗜血狂怒必須裝配在技能列上才生效，但不必在狂怒期間
  （設計文檔寫的是「每 10 秒」，沒有加上狂怒期間的限定）。 */
function sgTickAsuraFist(ctx) {
  var u = sgUlt('bloodrage', 'asuraFist');
  if (!u || !skills2Equipped('bloodrage')) { SKILL2_RT.asuraFist = 0; return; }
  var gap = Math.max(0.5, sgUltVal(u, 'gap'));
  if (!(SKILL2_RT.asuraFist > 0)) { SKILL2_RT.asuraFist = GT + gap; return; }
  if (SKILL2_RT.asuraFist > GT) return;
  SKILL2_RT.asuraFist = GT + gap;
  if (!ctx.pEnt || ctx.pEnt.hp <= 0) return;
  applyStatus(ctx.pEnt, 'sgAsuraFist', {
    val: sgUltVal(u, 'pct'), dur: Math.max(0.1, sgUltVal(u, 'sec'))
  });
  sgEmitPlayerVfx('bloodrage', 'pv-float', { fxKind: 'aura', variant: 'bloodrage-aura', dur: 1 });
  if (typeof floatPlayerEvent === 'function') floatPlayerEvent('pv-float', '阿修羅霸王拳!', 'buff');
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
  if (SKILL2_RT.rock && SKILL2_RT.rock.until <= GT) SKILL2_RT.rock = null; // 岩甲到期回收
  sgTickFlyingProjectiles(dt, ctx);
  sgTickMeteors(ctx);
  sgTickGrounds(dt, ctx);
  sgTickOrbits(dt, ctx);
  sgTickStorm(ctx);
  sgTickBloodDots(dt, ctx);
  sgTickBloodDomains(ctx);
  sgTickDeathDefer(ctx);
  sgTickLastStand(ctx);
  sgTickAsuraFist(ctx);
  sgTickWarGodShield(ctx);
  sgTickBurn(dt, ctx);
  sgTickFrost(dt, ctx);
  sgTickStormBarrier(dt, ctx);
  sgTickWindRend(dt, ctx);
  sgTickUltAutoCast(ctx);
}

/* 超神進化【天霸風神斬】：迴旋斬改為被動技能，每 N 秒自動施放 1 次。
   節拍記在 SKILL2_RT.ultAuto（執行期，絕不入存檔），寫法比照暴風之舞：
     ・沒裝配在技能列就不生效（與其他主動型被動同一條代價）
     ・暈眩中跳過該次，錯過的不補發
     ・法力不足就不觸發（比照反擊逐階扣魔的使用者決策）
   自動施放走 castSkill2 的正規路徑，因此扣魔、冷卻、傷害結算與手動施放完全一致。 */
function sgTickUltAutoCast(ctx) {
  if (!SKILL2_RT.ultAuto) SKILL2_RT.ultAuto = {};
  var u = sgUlt('cleave', 'stormGodSlash');
  if (!u || !skills2Equipped('cleave')) { delete SKILL2_RT.ultAuto.cleave; return; }
  var gap = Math.max(0.5, sgUltVal(u, 'sec'));
  var next = SKILL2_RT.ultAuto.cleave;
  if (!(next > 0)) { SKILL2_RT.ultAuto.cleave = GT + gap; return; }
  if (next > GT) return;
  SKILL2_RT.ultAuto.cleave = GT + gap;
  if (typeof effectActive === 'function' && effectActive(ctx.pEnt, 'stun')) return;
  var cost = Number(SKILLS2.cleave.cost) || 0;
  if (ctx.pEnt.mp < cost) return;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  var res = castSkill2(ctx.pEnt, enemies, 'cleave', ctx.floatSel);
  if (!res) return;
  if (ctx.onDamage) ctx.onDamage(res.dmg);
  if (res.killed && ctx.onDeaths) ctx.onDeaths();
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
          // 「傳染給附近的 count 個敵人」沒有指定最近＝隨機（候選同原本＝整個戰場）
          var near = bfRandomOthers(e, enemies, enemies.length, 0, null);
          var spreaded = 0;
          for (var ni = 0; ni < near.length; ni++) {
            if (near[ni].hp > 0 && !sgHasDot(near[ni], 'sgPoison')) {
              sgEmitVfx('bloodblade', [e, near[ni]], ctx.floatSel, {
                fxKind: 'chain', variant: 'poison-spread', elem: 'poison', count: 1
              });
              /* 毒霧感染也走共用塗抹：傳染同樣算「感染 1 個敵人」，要付【毒血祭】的生命代價；
                 崩解生效時中毒根本不會存在，這條分支自然不會被走到。 */
              sgApplyBloodbladeDot(near[ni], 'sgPoison',
                { dps: d.dps, dur: Math.max(0.2, d.until - GT), interval: gap },
                Math.max(0.2, d.until - GT),
                { enemies: enemies, floatSel: ctx.floatSel });
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

/* ===========================================================================
   血刃斬的兩個「永久領域」（超神進化：殺神領域／萬毒血霧）
   ---------------------------------------------------------------------------
   本專案的三套場域（SKILL2_RT.grounds／orbits／SKILL_RT.fields）全部以剩餘段數或
   到期時間收斂，沒有任何永久物；把 hits 設成無限會多出一條沒有回收路徑的分支。
   因此永久領域**不建立實例**，改成每個節拍直接以玩家為圓心做一次幾何查詢：
   領域的權威就是超神進化本身，卸下就自動消失，不需要任何清理程式碼。
   兩者都要求雙刀…不，要求血刃斬**裝配在技能列上**（比照主動型被動的代價）。
   =========================================================================== */

var SG_DOMAIN_VFX_SEC = 1;   // 永久領域的範圍提示重畫間隔（純顯示，與作用節拍無關）
/* 範圍提示的穩定識別鍵：兩個顯示層都以 area.id 當快取鍵，同一個 id ＝ 重用同一個節點。
   兩個永久領域一次只會有一個生效（三選一），因此共用一個 id 即可。 */
var SG_BLOOD_DOMAIN_VFX_ID = 'sg-blood-domain';

function sgTickBloodDomains(ctx) {
  var rt = SKILL2_RT.bloodDomain;
  var venom = sgUlt('bloodblade', 'venomDomain');
  var slayer = sgUlt('bloodblade', 'slayerDomain');
  if (!skills2Equipped('bloodblade') || (!venom && !slayer)) {
    rt.venomAt = 0; rt.vfxAt = 0; return;
  }
  var radius = bfMeterPx(sgUltVal(venom || slayer, 'm'));
  if (rt.vfxAt <= GT) {
    rt.vfxAt = GT + SG_DOMAIN_VFX_SEC;
    sgEmitBloodDomainAura(ctx, radius, !!venom);
  }
  if (!venom) { rt.venomAt = 0; return; }
  var gap = Math.max(0.1, sgUltVal(venom, 'gap') || 0.5);
  if (!(rt.venomAt > 0)) { rt.venomAt = GT + gap; return; }
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  var guard = 0;
  while (rt.venomAt <= GT && guard < 20) {
    guard++;
    rt.venomAt += gap;
    sgVenomDomainPulse(venom, enemies, ctx, radius, gap);
    enemies = ctx.getEnemies ? ctx.getEnemies() : enemies;
  }
}

/* 領域的範圍提示：以玩家當下座標為圓心的地面光環。沿用泥沼池的既有畫法
  （兩個顯示層都認得），毒領域走毒色、殺神領域走暗色。 */
function sgEmitBloodDomainAura(ctx, radius, poison) {
  var pp = (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null;
  if (!pp || !(radius > 0)) return;
  sgEmitPlayerVfx('bloodblade', ctx.floatSel, {
    fxKind: 'aura', variant: poison ? 'mire-poison' : 'mire',
    elem: poison ? 'poison' : 'dark', dur: SG_DOMAIN_VFX_SEC,
    area: { id: SG_BLOOD_DOMAIN_VFX_ID, x: pp.x, y: pp.y, r: radius, w: radius * 2, h: radius * 2 }
  });
}

/* 萬毒領域的一次作用：範圍內的每個敵人疊 1 層【萬毒侵蝕】。
   單層每秒量＝血刃斬本體技能傷害 × pct% ÷ 間隔；疊層與「每跳量＝單層 × 層數」
   由狀態表的 stack 規則處理（js/combat.js stackStep），這裡只給單層值。 */
function sgVenomDomainPulse(ult, enemies, ctx, radius, gap) {
  var lvs = skills2Levels('bloodblade');
  if (!lvs || lvs[0] < 1 || typeof getStats !== 'function') return;
  var st = getStats();
  var baseVal = st.atk * sgVal(SKILLS2.bloodblade.tiers[0].fx, 'pct', lvs[0]) / 100;
  var unit = baseVal * sgUltVal(ult, 'pct') / 100 / gap;
  if (!(unit > 0)) return;
  var victims = sgEnemiesNearPlayer(enemies, radius, null, 0);
  if (!victims.length) return;
  var dur = Math.max(gap, sgUltVal(ult, 'dur') || 6);
  var maxStacks = Math.max(1, Math.floor(sgUltVal(ult, 'maxStacks') || 1));
  for (var i = 0; i < victims.length; i++) {
    applyStatus(victims[i], 'sgVenomField', { dps: unit, dur: dur, interval: gap, maxStacks: maxStacks });
  }
  sgEmitVfx('bloodblade', victims, ctx.floatSel, { fxKind: 'curse', variant: 'poison', elem: 'poison' });
}

/* 超神進化【殺神領域】：領域內的敵人死亡時疊 1 層【殺神】並回復生命。
   掛在 skills2OnEnemyDeath，因此與屍爆等效果共用同一條既有邊界——
   那條鏈只由野外擊殺（js/combat.js onFieldKill）驅動，高塔沒有鏡射的死亡掛勾。 */
function sgSlayerDomainOnDeath(deadEnt) {
  var ult = sgUlt('bloodblade', 'slayerDomain');
  if (!ult || !skills2Equipped('bloodblade') || typeof getStats !== 'function') return;
  var pEnt = sgCurrentPlayerEnt();
  if (!pEnt || pEnt.hp <= 0) return;
  var radius = bfMeterPx(sgUltVal(ult, 'm'));
  if (typeof bfPos === 'function' && bfPos(deadEnt) && typeof bfEntityDistance === 'function' &&
      bfEntityDistance(deadEnt) > radius) return;
  var st = getStats();
  applyStatus(pEnt, 'sgSlayerMark', {
    val: sgUltVal(ult, 'pct'),
    dur: Math.max(0.2, sgUltVal(ult, 'dur') || 6),
    maxStacks: Math.max(1, Math.floor(sgUltVal(ult, 'maxStacks') || 1))
  });
  var heal = st.hp * sgUltVal(ult, 'healPct') / 100;
  if (heal > 0 && typeof healPlayer === 'function') healPlayer(pEnt, heal, st);
}

/* 傳奇【毒爆】／【血霧】：帶著血刃斬中毒／流血的敵人死亡後，在屍體位置留下一灘場域。
   兩者都走既有的地板場域（SKILL2_RT.grounds），差別只在毒霧會逐拍造成傷害，
   血霧不造成傷害、只塗標記（吸血在 skills2OnEnemyDamaged 結算）。
   ⚠️ 與超神進化【崩解】天生互斥：崩解讓中毒與流血當場結清，敵人死時身上不會有這兩個狀態，
   因此同時投資這兩邊時毒爆／血霧幾乎不會觸發——這是設計上的取捨，不是漏判。 */
function sgBloodFieldsOnDeath(deadEnt) {
  var lg = sgLegend('bloodblade');
  var mist = lg.bloodPoisonMist, blood = lg.bloodMistField;
  if (!mist && !blood) return;
  var pEnt = sgCurrentPlayerEnt();
  var lvs = skills2Levels('bloodblade');
  if (!pEnt || !lvs || lvs[0] < 1 || typeof getStats !== 'function') return;
  var st = getStats();
  var baseVal = st.atk * sgVal(SKILLS2.bloodblade.tiers[0].fx, 'pct', lvs[0]) / 100;
  if (mist && sgHasDot(deadEnt, 'sgPoison')) {
    var gap = Math.max(0.1, Number(mist.gap) || 0.5);
    var sec = Math.max(gap, Number(mist.sec) || 3);
    sgSpawnGround(pEnt, st, 'bloodblade', {
      kind: 'poisonmist', tgt: deadEnt, floatSel: 'mv-float',
      radius: bfMeterPx(Number(mist.m) || 6),
      dmgVal: baseVal * (Number(mist.pct) || 0) / 100,
      hits: Math.max(1, Math.round(sec / gap)), gap: gap, hitElem: 'poison'
    });
  }
  if (blood && sgHasDot(deadEnt, 'sgBleed')) {
    var bgap = SG_BLOOD_MIST_GAP;
    var bsec = Math.max(bgap, Number(blood.sec) || 4);
    sgSpawnGround(pEnt, st, 'bloodblade', {
      kind: 'bloodmist', tgt: deadEnt, floatSel: 'mv-float',
      radius: bfMeterPx(Number(blood.m) || 6),
      dmgVal: 0, hits: Math.max(1, Math.round(bsec / bgap)), gap: bgap
    });
  }
}

/* 血霧場域的重塗節拍。它不造成傷害，節拍只決定「敵人走進血霧後多久會被標記到」，
   因此取一個夠密的固定值即可，不需要另設參數。 */
var SG_BLOOD_MIST_GAP = 0.25;

/* ---- 敵人死亡掛勾（js/skills.js skillRtOnEnemyDeath 末端鏈結，野外擊殺時呼叫）---- */
function skills2OnEnemyDeath(deadEnt, enemies) {
  if (!SKILL2_RT || !deadEnt) return;
  sgRageOnKill();                 // 嗜血狂怒：狂化連殺疊連擊（T4）＋狂血盛宴延時（T7）
  sgDeathBoom(deadEnt, enemies);  // 血刃斬：死亡屍爆（T6）
  sgBurnBlast(deadEnt, enemies);  // 火球術：爆燃（T5）——死亡是燃燒的另一個結束時機
  sgDeathNova(deadEnt, enemies);  // 冰霜新星：死亡新星（T6）——帶寒霜的敵人死亡時機率再釋放
  sgBloodFieldsOnDeath(deadEnt);  // 血刃斬傳奇：毒爆／血霧（屍體留下場域）
  sgSlayerDomainOnDeath(deadEnt); // 血刃斬超神：殺神領域（領域內死亡才算）
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
        val: sgRageAspdPct(lvs), dur: Math.max(0.1, rt.until - GT)
      });
    }
  }
  if (!rt.pEnt) return;
  /* 傳奇【屠戮者】：狂怒期間每擊殺 1 個敵人疊 1 層反震加成。 */
  var lg = sgLegendTick('bloodrage');
  if (lg.rageThornsStack && typeof applyStatus === 'function') {
    applyStatus(rt.pEnt, 'sgThornsRage', {
      val: Number(lg.rageThornsStack.pct) || 0,
      dur: Math.max(0.2, Number(lg.rageThornsStack.sec) || 4),
      maxStacks: Math.max(1, Math.floor(Number(lg.rageThornsStack.maxStacks) || 1))
    });
  }
  /* 超神【戰神屠錄】：疊層一直留到死亡為止，因此另外記下持有者供 resetSkill2RT 回收。 */
  var wg = sgUlt('bloodrage', 'warGodRoll');
  if (wg && typeof applyStatus === 'function') {
    SKILL2_RT.warGod = { pEnt: rt.pEnt };
    applyStatus(rt.pEnt, 'sgWarGodKill', {
      val: sgUltVal(wg, 'pct'),
      dur: Number(STATUS.sgWarGodKill.dur) || 99999,
      maxStacks: Math.max(1, Math.floor(sgUltVal(wg, 'maxStacks')))
    });
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
  // 「對附近 count 個敵人造成傷害並傳染中毒」沒有指定最近＝隨機（候選同原本＝整個戰場）
  var victims = bfRandomOthers(deadEnt, enemies, count, 0, null);
  if (!victims.length) return;
  var pEnt = sgCurrentPlayerEnt();
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
        deadPoison ? deadPoison.until - GT : undefined,
        { enemies: enemies, floatSel: 'mv-float', out: out });
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

/* 超神進化某個選項的說明：與各階同一套 {鍵} 模板規則。lv<1 時以 Lv.1 預覽。 */
function describeSkill2Ult(gid, optIdx, lv) {
  var opt = sgUltOption(gid, optIdx);
  if (!opt) return '';
  var useLv = Math.max(1, Number(lv) || 0);
  return String(opt.desc || '').replace(/\{(\w+)\}/g, function (m, key) {
    var v = sgVal(opt.fx, key, useLv);
    return (Math.abs(v - Math.round(v)) < 1e-9) ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
  });
}

/* 群組整體說明（提示框用）：冷卻／消耗＋各階現況。levels 由呼叫端傳入（快照）。 */
function describeSkill2Group(gid, levels, ultRaw) {
  var g = SKILLS2[gid];
  if (!g) return '';
  var lvs = levels || sgEffectiveLevels(null, gid);
  var parts = [];
  for (var i = 0; i < g.tiers.length; i++) {
    var lv = lvs[i] || 0;
    var locked = i > 0 && (lvs[i - 1] || 0) < 1;
    var cls = lv > 0 ? 'sg-tier-on' : (locked ? 'sg-tier-locked' : 'sg-tier-off');
    var tierMp = skills2TierTriggerMp(gid, i); // 被動群組：每階自己的觸發消耗
    var head = '第' + (i + 1) + '階【' + g.tiers[i].name + '】' + (lv > 0 ? ' Lv.' + lv : (locked ? '（未解鎖）' : '（未投資）')) +
      (tierMp > 0 ? '　🔵' + tierMp + ' MP' : '');
    parts.push('<div class="' + cls + '"><b>' + head + '</b>　' + describeSkill2Tier(gid, i, lv) + '</div>');
  }
  /* 超神進化（第 8 格）：只在該群組有開放時才列。ultRaw＝存檔／快照上的選擇字典。 */
  if (sgUltDefs(gid)) {
    var pick = sgUltPickOf(ultRaw, gid);
    var ultOk = sgUltUnlockedBy(gid, lvs);
    var ultCls = pick ? (ultOk ? 'sg-tier-on' : 'sg-tier-locked') : (ultOk ? 'sg-tier-off' : 'sg-tier-locked');
    var ultHead = '第' + (g.tiers.length + 1) + '階【超神進化】' +
      (pick ? '（' + pick.def.name + '）Lv.' + pick.lv + (ultOk ? '' : '（前 ' + g.tiers.length + ' 階未滿級，暫時失效）')
        : (ultOk ? '（可三選一）' : '（需前 ' + g.tiers.length + ' 階全滿）'));
    parts.push('<div class="' + ultCls + '"><b>' + ultHead + '</b>　' +
      (pick ? describeSkill2Ult(gid, pick.idx, pick.lv) : '從三個效果中選擇一個，可再升至 Lv.' + SG_TIER_MAX_LV) + '</div>');
  }
  return parts.join('');
}
