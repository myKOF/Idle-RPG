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
var SG_MULTI_ATTACK_GAP_SEC = 0.2; // 未另訂節奏的多段／多次攻擊預設間隔
var SG_CLEAVE_WAVE_GAP_SEC = 0.3; // 迴旋斬各道刀波共用的傷害與特效間隔
var SG_THRUST_PROJECTILE_SPEED = SG_FLYING_PROJECTILE_SPEED * 2;
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
/* ---- 超神【地爆天星】的節奏（2026-08-24 使用者指定）----
   落下前 WARN 秒地板先出現黑影並擴大到全場；殞石體積 SIZE 倍、下墜速度是一般殞石的一半
   （＝下墜時間 FALL 倍）。三個值都是**顯示與模擬共用**的語意參數：預警秒數決定黑影動畫多長，
   下墜倍率決定殞石特效要從多早開始播，因此不能只寫在顯示層（AI_RULES 8.3）。 */
var SG_STARFALL_WARN_SEC = 5;
var SG_STARFALL_SIZE_MULT = 3;
var SG_STARFALL_FALL_MULT = 2;
var SG_WATERBALL_VOLLEY_MS = 220;   // 【三重流水】的第 2 顆之後每顆再錯開多久
var SG_FROSTNOVA_VOLLEY_MS = 260;   // 【三重新星】的第 2 次之後每次再錯開多久

/* 殞石的傷害時刻必須和落地時刻相同：先算天空到地面的距離，
   再除以殞石實際落下速度；travelMs 是顯示層套用 0.70 慢速倍率前的時間。 */
function sgConfiguredFlightSpeed(gid, tier, fallbackPx) {
  var g = SKILLS2[gid], t = g && g.tiers && g.tiers[(tier || 1) - 1];
  var speed = t && t.fx && sgGeometryNumber(t.fx, 'speed');
  return speed > 0 ? bfMeterPx(speed) : fallbackPx;
}
// Preserve the existing near/far travel clamps while allowing each skill to tune its speed.
function sgConfiguredTravelSeconds(gid, target) {
  var base = (typeof bfTravelSeconds === 'function') ? bfTravelSeconds(target) : 0;
  var nominal = ((typeof VFX_PROJECTILE_SPEED_CELLS === 'number') ? VFX_PROJECTILE_SPEED_CELLS : 8.4) * bfUnit();
  return base * nominal / sgConfiguredFlightSpeed(gid, 1, nominal);
}
function sgMeteorFallTiming() {
  var distance = SG_METEOR_DROP_DISTANCE;
  var speed = SG_METEOR_FALL_SPEED;
  var fallMs = Math.max(1, Math.round(distance / speed * 1000));
  var travelMs = Math.max(1, Math.round(fallMs * SG_METEOR_SPEED_MULTIPLIER));
  return { travelMs: Math.min(SG_METEOR_MAX_TRAVEL_MS, travelMs), fallMs: fallMs };
}
function sgFireMeteorFallTiming() {
  var ms = Math.round(sgMeteorFallTiming().travelMs / 0.7 * SG_METEOR_FALL_SPEED /
    sgConfiguredFlightSpeed('fireball', 7, SG_METEOR_FALL_SPEED));
  return { travelMs: ms, fallMs: ms };
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
  thrust: { name: '突刺', emoji: '🗡️', range: '12*3', cd: 15, cost: 25, tiers: [{ name: '突刺', unlock: { reinc: 0, lv: 1 }, cost: 25, fx: { pct: 150, pctPer: 15, count: 2, speed: 48 }, goldBase: 100000, goldGrow: 1.5, desc: '對前方敵人造成 {count} 次 {pct}% 物理傷害', vfx: { attack: 'slash-thrust-lance', hit: 'hit-phys' } }, { name: '連刺', unlock: { reinc: 0, lv: 1 }, cost: 40, fx: { chance: 25, chancePer: 2.5, count: 2 }, goldBase: 200000, goldGrow: 1.5, desc: '有 {chance}% 的機率再次進行 {count} 次突刺' }, { name: '傷害強化', unlock: { reinc: 0, lv: 50 }, cost: 60, fx: { pct: 20, pctPer: 3 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化突刺傷害，額外 +{pct}% 物理傷害（與第 1 階累加）', vfx: { attack: 'slash-thrust-empowered', hit: 'hit-phys' } }, { name: '超連刺', unlock: { reinc: 0, lv: 100 }, cost: 80, fx: { count: 3, range: 20, rangePer: 2 }, goldBase: 800000, goldGrow: 1.5, desc: '每次能進行 {count} 道平行貫穿突刺，且突刺範圍提升 {range}%', vfx: { attack: 'slash-thrust-empowered', hit: 'hit-phys' } }, { name: '擴散', unlock: { reinc: 0, lv: 150 }, cost: 100, fx: { pct: 20, pctPer: 2, count: 4 }, goldBase: 1500000, goldGrow: 1.5, desc: '突刺造成的傷害有 {pct}% 會擴散至周圍的 {count} 個敵人', vfx: { attack: 'slash-thrust-scatter', hit: 'hit-phys' } }, { name: '貫穿突刺', unlock: { reinc: 0, lv: 200 }, cost: 140, fx: { m: 5, mPer: 0.5 }, goldBase: 3000000, goldGrow: 1.5, desc: '突刺會造成一直線的傷害，貫穿路徑上所有敵人，貫穿長度在原本長度上再增加 {m} 米', vfx: { attack: 'slash-thrust-scatter', hit: 'hit-phys' } }, { name: '八方連刺', unlock: { reinc: 0, lv: 250 }, cost: 240, fx: { pct: 20, pctPer: 2, count: 3, directions: 8 }, goldBase: 5000000, goldGrow: 1.5, desc: '向八個方向同時進行 {count} 次突刺，且造成傷害額外 +{pct}%', vfx: { attack: 'slash-thrust-scatter', hit: 'hit-phys' } }], ult: [{ id: 'phantomOcta', name: '幻影八方陣', cost: 300, fx: { dodge: 30, sec: 2, m: 6, mPer: 0.6 }, goldBase: 10000000, goldGrow: 1.5, desc: '突刺命中時，傷害同時擴散至該敵人周圍 {m} 米內的所有敵人；施放突刺後 {sec} 秒內，你有 {dodge}% 機率絕對閃避敵方攻擊', vfx: { attack: 'slash-thrust-scatter-blue', hit: 'hit-phys' }, status: { self: [{ id: 'sgPhantomDodge' }] } }, { id: 'shadowExecutioner', name: '暗影絕殺者', cost: 300, fx: { perStack: 1, perStackPer: 0.2, maxStacks: 100, pct: 100, pctPer: 20, dur: 30 }, goldBase: 10000000, goldGrow: 1.5, desc: '突刺命中時堆疊【靈魂撕裂】：每層使該敵人受到的傷害提高 {perStack}%，最多 {maxStacks} 層（疊滿＝+{pct}%）', vfx: { attack: 'slash-thrust-scatter-red', hit: 'hit-phys' }, status: { enemy: [{ id: 'sgSoulRend' }] } }, { id: 'oneStrikeKill', name: '一擊必殺', cost: 300, fx: { mult: 4, multPer: 0.4 }, goldBase: 10000000, goldGrow: 1.5, desc: '【八方連刺】改為朝前方的 1 道突刺，但傷害改為 {mult} 倍，且可以立即殺死普通敵人', vfx: { attack: 'slash-thrust-scatter-super', hit: 'hit-phys' } }] },
  cleave: { name: '迴旋斬', emoji: '🪓', range: '', cd: 20, cost: 25, tiers: [{ name: '迴旋斬', unlock: { reinc: 0, lv: 1 }, cost: 25, fx: { pct: 200, pctPer: 20, radiusCurve: [[0, 0.12], [0.25, 0.48], [0.65, 0.86], [1, 1]], castM: 8, speed: 24, m: 8 }, goldBase: 100000, goldGrow: 1.5, desc: '對自身周圍 {m} 米內的所有敵人造成 1 次 {pct}% 物理傷害', vfx: { attack: 'slash-cleave-ring-warm', hit: 'hit-phys' } }, { name: '擴增', unlock: { reinc: 0, lv: 1 }, cost: 40, fx: { range: 15, rangePer: 1.5 }, goldBase: 200000, goldGrow: 1.5, desc: '斬擊範圍擴大 {range}%' }, { name: '強化', unlock: { reinc: 0, lv: 50 }, cost: 60, fx: { pct: 20, pctPer: 8 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化斬擊傷害，額外 +{pct}% 物理傷害' }, { name: '連斬', unlock: { reinc: 0, lv: 100 }, cost: 80, fx: { times: 1, timesPer: 0.1 }, goldBase: 800000, goldGrow: 1.5, desc: '額外劈出 {times} 次斬擊（不足 1 次的部分以機率觸發）' }, { name: '暈眩擊', unlock: { reinc: 0, lv: 150 }, cost: 100, fx: { chance: 25, chancePer: 1, sec: 1, secPer: 0.1 }, goldBase: 1500000, goldGrow: 1.5, desc: '斬擊時有 {chance}% 機率擊暈敵人 {sec} 秒', status: { enemy: [{ id: 'stun' }] } }, { name: '震碎斬', unlock: { reinc: 0, lv: 200 }, cost: 140, fx: { m: 12, mPer: 0.5 }, goldBase: 3000000, goldGrow: 1.5, desc: '圓形刀波向外擴張至 {m} 米，對擴張路徑上的所有敵人造成傷害', vfx: { projectile: 'slash-cleave-ring-blue', hit: 'hit-phys' } }, { name: '迴身四方斬', unlock: { reinc: 0, lv: 250 }, cost: 240, fx: { pct: 50, pctPer: 5, times: 3, timesPer: 0 }, goldBase: 5000000, goldGrow: 1.5, desc: '額外使出 {times} 次圓形斬擊，且傷害額外 +{pct}%（與原有傷害乘法計算）', vfx: { projectile: 'proj-cleave-ring-tricolor', hit: 'hit-phys' } }], ult: [{ id: 'voidShatter', name: '虛空碎裂斬', cost: 300, fx: { times: 1, timesPer: 0.2, pct: 50, pctPer: 5 }, goldBase: 10000000, goldGrow: 1.5, desc: '【迴身四方斬】的攻擊次數 +{times} 次，且物理傷害再額外 +{pct}%', vfx: { projectile: 'proj-cleave-ring-tricolor-08' } }, { id: 'windChaser', name: '逐風者', cost: 300, fx: { hits: 4, hitsPer: 0.4, pct: 100, pctPer: 10, gap: 0.4, m: 4 }, goldBase: 10000000, goldGrow: 1.5, desc: '迴旋斬每命中 1 次，就在該敵人所在位置生成一道龍捲風：對半徑 {m} 米內的敵人造成 {hits} 段、每段 {pct}% 風系傷害', vfx: { projectile: 'proj-cleave-ring-tricolor-09' }, triggerVfx: { ground: 'slash-cleave-ring-warm-09-hit' } }, { id: 'stormGodSlash', name: '天霸風神斬', cost: 300, fx: { sec: 8, secPer: -0.5, range: 30 }, goldBase: 10000000, goldGrow: 1.5, desc: '迴旋斬範圍擴大 {range}%，並改為被動技能：不再主動施放，改為每 {sec} 秒自動施放 1 次（每級施放間隔 -0.5 秒，仍需裝配在技能列才生效）' }] },
  knife: { name: '飛刀', emoji: '🔪', range: '', cd: 15, cost: 25, tiers: [{ name: '飛刀', unlock: { reinc: 0, lv: 50 }, cost: 25, fx: { pct: 150, pctPer: 15, count: 3, deg: 60, speed: 50.4 }, goldBase: 100000, goldGrow: 1.5, desc: '朝前方 {deg} 度扇形內丟出 {count} 把飛刀，每把造成 {pct}% 物理傷害', vfx: { projectile: 'proj-knife', hit: 'hit-phys' } }, { name: '強化飛刀', unlock: { reinc: 0, lv: 100 }, cost: 40, fx: { pct: 20, pctPer: 10 }, goldBase: 200000, goldGrow: 1.5, desc: '飛刀傷害進一步提升，額外 +{pct}% 物理傷害' }, { name: '彈射飛刀', unlock: { reinc: 0, lv: 150 }, cost: 60, fx: { pct: 30, pctPer: 5, count: 1, m: 20 }, goldBase: 400000, goldGrow: 1.5, desc: '每把飛刀會在範圍20米內的 {count} 個敵人間彈跳，每次彈射造成 {pct}% 技能傷害', vfx: { projectile: 'proj-knife', hit: 'hit-phys' } }, { name: '強化彈射', unlock: { reinc: 0, lv: 200 }, cost: 80, fx: { add: 1, addPer: 0.25 }, goldBase: 800000, goldGrow: 1.5, desc: '飛刀彈射的敵人數量額外 +{add}（不足 1 次的部分以機率觸發）' }, { name: '迴旋飛刀', unlock: { reinc: 0, lv: 250 }, cost: 100, fx: { count: 4, countPer: 0.2 }, goldBase: 1500000, goldGrow: 1.5, desc: '改為向周圍的 {count} 個敵人丟出飛刀（全圓形範圍鎖敵；不足 1 個的部分以機率觸發）' }, { name: '連鎖彈射', unlock: { reinc: 0, lv: 300 }, cost: 140, fx: { chance: 20, chancePer: 2, max: 4 }, goldBase: 3000000, goldGrow: 1.5, desc: '飛刀彈射後有 {chance}% 機率再次彈射，最多連續 {max} 次' }, { name: '神速飛刀', unlock: { reinc: 0, lv: 350 }, cost: 240, fx: { sec: 0.05, secPer: 0.01 }, goldBase: 5000000, goldGrow: 1.5, desc: '每把飛刀（含彈射）爆擊時，使飛刀技能冷卻時間 -{sec} 秒' }], ult: [{ id: 'petalStorm', name: '暴雨梨花', cost: 300, fx: { pct: 20, pctPer: 2 }, goldBase: 10000000, goldGrow: 1.5, desc: '每把飛刀（含彈射）都會對飛行路徑上的所有敵人造成 {pct}% 技能傷害', vfx: { projectile: 'proj-knife-gold-08-cri-rain', hit: 'hit-phys' } }, { id: 'deathReaper', name: '死亡收割者', cost: 300, fx: { pct: 25, pctPer: 2.5, maxStacks: 20, dur: 8 }, goldBase: 10000000, goldGrow: 1.5, desc: '飛刀殺死敵人時堆疊【死亡收割】：每層使你造成的傷害提高 {pct}%，最多 {maxStacks} 層，持續 {dur} 秒', vfx: { projectile: 'proj-knife-gold-09-die', hit: 'hit-phys' }, status: { self: [{ id: 'sgDeathReaper' }] } }, { id: 'soulhunterBlade', name: '無限追魂刃', cost: 300, fx: { pct: 4, pctPer: 0.4, sec: 10, m: 40 }, goldBase: 10000000, goldGrow: 1.5, desc: '每次施放飛刀時額外射出 1 支無限飛刀，追擊自身周圍 {m} 米內的任意敵人。每次彈射使該支飛刀傷害額外提高 {pct}%（累加），最多存在 {sec} 秒。無敵人時在自身周圍環繞待機，單一敵人時飛離後折返攻擊', vfx: { projectile: 'proj-knife-gold', hit: 'hit-phys' } }] },
  gale: { name: '疾風迅雷', emoji: '💨', range: '', cd: 15, cost: 25, tiers: [{ name: '疾風迅雷', unlock: { reinc: 0, lv: 100 }, cost: 25, fx: { pct: 250, pctPer: 20, hits: 3, castM: 5, gap: 0.35, m: 10 }, goldBase: 100000, goldGrow: 1.5, desc: '對目標周圍 {m} 米內的敵人造成連續 {hits} 次 {pct}% 物理傷害；目標死亡後仍在原座標完成剩餘段數', vfx: { attack: 'hit-gale-burst', hit: 'hit-phys' } }, { name: '連擊', unlock: { reinc: 0, lv: 150 }, cost: 40, fx: { add: 2, addPer: 0.2 }, goldBase: 200000, goldGrow: 1.5, desc: '打擊次數額外 +{add}（不足 1 次的部分以機率觸發）' }, { name: '強化重擊', unlock: { reinc: 0, lv: 200 }, cost: 60, fx: { pct: 15, pctPer: 4 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化打擊傷害，額外 +{pct}% 物理傷害' }, { name: '爆散', unlock: { reinc: 0, lv: 250 }, cost: 80, fx: { pct: 50, pctPer: 5, count: 2, countPer: 0.2, m: 12 }, goldBase: 800000, goldGrow: 1.5, desc: '每次打擊額外對自身周圍 {m} 米內隨機 {count} 個其他敵人造成 {pct}% 技能傷害；附近沒有其他敵人時改為攻擊原目標（目標數不足 1 個的部分以機率觸發）', vfx: { attack: 'hit-gale-burst-diffusion', hit: 'hit-phys' } }, { name: '狂風破', unlock: { reinc: 0, lv: 300 }, cost: 100, fx: { pct: 20, pctPer: 5, sec: 5 }, goldBase: 1500000, goldGrow: 1.5, desc: '施放疾風迅雷使你的攻速額外提高 {pct}%，持續 {sec} 秒（突破攻速上限，與自身攻速相乘）', status: { self: [{ id: 'sgGale' }] } }, { name: '縮地', unlock: { reinc: 0, lv: 350 }, cost: 140, fx: { sec: 2, secPer: 0.4 }, goldBase: 3000000, goldGrow: 1.5, desc: '疾風迅雷的冷卻時間 -{sec} 秒' }, { name: '疾風月牙閃', unlock: { reinc: 0, lv: 400 }, cost: 240, fx: { pct: 500, pctPer: 50, castM: 10, m: 10 }, goldBase: 5000000, goldGrow: 1.5, desc: '疾風迅雷的傷害由目標周圍 {m} 米內的所有敵人均分，且傷害額外 +{pct}%', vfx: { attack: 'hit-gale-burst-07-moon' } }], ult: [{ id: 'thunderFlash', name: '霹靂一閃', cost: 300, fx: { pct: 300, pctPer: 30, count: 3, rise: 0.08, gap: 0.2, m: 12, len: 100, wid: 10 }, goldBase: 10000000, goldGrow: 1.5, desc: '疾風迅雷最後一擊觸發 {count}＋角色連擊數道貫穿雷電，每道造成 {pct}% 雷電傷害；每隔 {gap} 秒重新選擇自身周圍 {m} 米內敵人，無敵人即停止；沿自身與目標連線，以自身為中心貫穿長 {len} 米、寬 {wid} 米的範圍', triggerVfx: { attack: 'beam-gale-thunder-flash' } }, { id: 'thunderGodSlash', name: '雷神之怒', cost: 300, fx: { pct: 100, pctPer: 10, m: 8 }, goldBase: 10000000, goldGrow: 1.5, desc: '疾風迅雷附加雷電：每次命中時降下 1 道落雷，對命中處周圍 {m} 米內的敵人造成 {pct}% 閃電傷害', triggerVfx: { attack: 'bolt-sky-purple' } }, { id: 'chidori', name: '千鳥', cost: 300, fx: { pct: 100, pctPer: 10, scatterPct: 50, scatterPctPer: 5 }, goldBase: 10000000, goldGrow: 1.5, desc: '疾風月牙閃不再由範圍內的敵人均分傷害，改為每個敵人都受到完整傷害；爆散效果提高 {scatterPct}%（技能傷害係數與隨機目標數同時提高），且本體與爆散傷害再額外 +{pct}%', vfx: { attack: 'hit-gale-burst-10-bird' } }] },
  bloodblade: { name: '血刃斬', emoji: '🩸', range: '', cd: 15, cost: 25, tiers: [{ name: '血刃斬', unlock: { reinc: 0, lv: 200 }, cost: 25, fx: { pct: 200, pctPer: 15, dotPct: 30, dotSec: 5, dotGap: 1 }, goldBase: 100000, goldGrow: 1.5, desc: '對敵人造成 1 次 {pct}% 物理傷害，並附加流血：每 {dotGap} 秒造成技能傷害 {dotPct}% 的傷害，持續 {dotSec} 秒', vfx: { attack: 'hit-bloodblade-burst' }, status: { enemy: [{ id: 'sgBleed' }] } }, { name: '強化流血', unlock: { reinc: 0, lv: 250 }, cost: 40, fx: { sec: 0.5, secPer: 0.1, gapPct: 10, gapPctPer: 1.5 }, goldBase: 200000, goldGrow: 1.5, desc: '流血持續時間 +{sec} 秒，且流血作用間隔縮短 {gapPct}%（跳得更快、總傷更高）' }, { name: '虛弱', unlock: { reinc: 0, lv: 300 }, cost: 60, fx: { pct: 10, pctPer: 2 }, goldBase: 400000, goldGrow: 1.5, desc: '流血中的敵人受到的傷害提高 {pct}%' }, { name: '血毒刃', unlock: { reinc: 0, lv: 350 }, cost: 80, fx: { dotPct: 25, dotPctPer: 3, dotSec: 6, dotGap: 0.5 }, goldBase: 800000, goldGrow: 1.5, desc: '敵人流血的同時也會中毒：每 {dotGap} 秒造成技能傷害 {dotPct}% 的毒屬性傷害，持續 {dotSec} 秒', status: { enemy: [{ id: 'sgPoison' }] } }, { name: '毒霧感染', unlock: { reinc: 0, lv: 400 }, cost: 100, fx: { chance: 30, chancePer: 2, count: 2, speed: 50 }, goldBase: 1500000, goldGrow: 1.5, desc: '血毒刃的毒在每次作用時，有 {chance}% 機率傳染給附近的 {count} 個敵人', triggerVfx: { projectile: 'proj-poison-drop', hit: 'hit-poison' } }, { name: '死亡屍爆', unlock: { reinc: 0, lv: 450 }, cost: 140, fx: { pct: 50, pctPer: 5, count: 2 }, goldBase: 3000000, goldGrow: 1.5, desc: '流血或中毒狀態的敵人死亡時爆炸，對附近 {count} 個敵人造成 {pct}% 技能傷害並傳染中毒', triggerVfx: { attack: 'burst-blood' } }, { name: '零日感染', unlock: { reinc: 0, lv: 500 }, cost: 240, fx: { chance: 20, chancePer: 2, pct: 40, pctPer: 4, count: 1, m: 20 }, goldBase: 5000000, goldGrow: 1.5, desc: '流血或中毒狀態在每次作用時有 {chance}% 機率立即造成剩餘的持續傷害；作用結束後將流血及中毒傳染給 {m} 米內的隨機 {count} 個敵人，且流血與中毒傷害 +{pct}%', triggerVfx: { attack: 'burst-zero-infection' } }], ult: [{ id: 'slayerDomain', name: '殺神領域', cost: 300, fx: { pct: 2, pctPer: 0.2, healPct: 2, healPctPer: 0.2, dur: 6, maxStacks: 100, m: 24 }, goldBase: 10000000, goldGrow: 1.5, desc: '永久展開 {m} 米的殺神領域：領域內的敵人死亡時堆疊【殺神】，每層使你造成的傷害 +{pct}%，同時回復 {healPct}% 最大生命；最多 {maxStacks} 層，持續 {dur} 秒', status: { self: [{ id: 'sgSlayerMark' }, { id: 'sgSlayerDomain' }] } }, { id: 'venomDomain', name: '萬毒血霧', cost: 300, fx: { pct: 100, pctPer: 10, dur: 6, maxStacks: 10, gap: 0.5, m: 24 }, goldBase: 10000000, goldGrow: 1.5, desc: '永久展開 {m} 米的萬毒領域：領域內的敵人每 {gap} 秒受到 {pct}% 中毒傷害，該中毒持續 {dur} 秒且可堆疊至 {maxStacks} 層', triggerVfx: { hit: 'hit-poison' }, status: { self: [{ id: 'sgVenomDomain' }], enemy: [{ id: 'sgVenomField' }] } }, { id: 'disintegrate', name: '崩解', cost: 300, fx: { pct: 50, pctPer: 5, gapPct: 40, gapPctPer: 4, speed: 50, m: 6 }, goldBase: 10000000, goldGrow: 1.5, desc: '中毒與流血作用間隔時間縮短 {gapPct}%，每次結算後爆炸，對周圍 {m} 米內的敵人造成該效果完整持續時間總傷害 {pct}% 的技能傷害', triggerVfx: { attack: 'burst-blood', projectile: 'proj-poison-drop-10' } }] },
  dualdance: { name: '雙刀亂舞', emoji: '⚔️', range: '', cd: 15, cost: 25, tiers: [{ name: '雙刀亂舞', unlock: { reinc: 0, lv: 250 }, cost: 25, fx: { pct: 300, pctPer: 25, count: 2 }, goldBase: 100000, goldGrow: 1.5, desc: '在當前攻擊範圍內隨機選敵斬擊 {count} 次，每次造成 {pct}% 物理傷害；可重複選中同一目標，只有 1 個敵人時全部斬擊打向它', vfx: { attack: 'slash-dual' } }, { name: '疾風亂舞', unlock: { reinc: 0, lv: 300 }, cost: 40, fx: { add: 1, addPer: 0.2 }, goldBase: 200000, goldGrow: 1.5, desc: '額外增加 {add} 次斬擊，每次從當前攻擊範圍內隨機選敵，可重複選中同一目標（不足 1 次的部分以機率觸發）' }, { name: '強化雙刀', unlock: { reinc: 0, lv: 350 }, cost: 60, fx: { pct: 25, pctPer: 5 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化雙刀傷害，額外 +{pct}% 物理傷害' }, { name: '狂暴之舞', unlock: { reinc: 0, lv: 400 }, cost: 80, fx: { cr: 100, crPer: 10, add: 1, addPer: 0.1, sec: 6 }, goldBase: 800000, goldGrow: 1.5, desc: '讓你的暴擊率 +{cr}%、連擊數 +{add}，持續 {sec} 秒', status: { self: [{ id: 'sgFrenzyCr' }] } }, { name: '鐵血之舞', unlock: { reinc: 0, lv: 450 }, cost: 100, fx: { pct: 1, pctPer: 0.1, sec: 3, gap: 0.35, m: 5 }, goldBase: 1500000, goldGrow: 1.5, desc: '施放雙刀亂舞時使你以及附近 {m} 米內的所有敵人流血：每 {gap} 秒造成最大生命值 {pct}% 傷害，持續 {sec} 秒', vfx: { attack: 'slash-dual-red' }, status: { self: [{ id: 'sgIronBleed' }], enemy: [{ id: 'sgIronBleed' }] } }, { name: '嗜血狂化', unlock: { reinc: 0, lv: 500 }, cost: 140, fx: { pct: 0.25, pctPer: 0.025, sec: 6 }, goldBase: 3000000, goldGrow: 1.5, desc: '施放雙刀亂舞後 {sec} 秒內，生命值或護盾每減少 1%，獲得 {pct}% 技能傷害提升' }, { name: '暴風亂舞', unlock: { reinc: 0, lv: 550 }, cost: 240, fx: { sec: 3, secPer: 0.3, gap: 0.35 }, goldBase: 5000000, goldGrow: 1.5, desc: '化身暴風在敵人間穿梭 {sec} 秒：每 {gap} 秒自動施放 1 次雙刀亂舞；期間可以普攻及施放技能', vfx: { attack: 'slash-dual' }, status: { self: [{ id: 'sgStorm' }] } }], ult: [{ id: 'doomDance', name: '毀滅之舞', cost: 300, fx: { hpPct: 10, hpPctPer: -0.5, pct: 200, pctPer: 20, add: 3 }, goldBase: 10000000, goldGrow: 1.5, desc: '每施放 1 次雙刀亂舞就失去當下 {hpPct}% 生命值（不會致死），但雙刀亂舞的傷害提高 {pct}%，且額外 +{add} 個攻擊目標（每刀在當前攻擊範圍內隨機選敵，可重複命中同一目標）', vfx: { attack: 'slash-dual-08' } }, { id: 'flameKagura', name: '火之神樂', cost: 300, fx: { pct: 20, pctPer: 2, dur: 10, maxStacks: 20, gap: 0.5 }, goldBase: 10000000, goldGrow: 1.5, desc: '雙刀亂舞附加火焰：每次命中堆疊 1 層【神樂灼焰】，每層每 {gap} 秒造成 {pct}% 火屬性傷害，最多 {maxStacks} 層，持續 {dur} 秒', vfx: { attack: 'slash-dual-fire-09' }, status: { enemy: [{ id: 'sgKagura' }] } }, { id: 'asuraDance', name: '修羅亂舞', cost: 300, fx: { pct: 20, pctPer: 2 }, goldBase: 10000000, goldGrow: 1.5, desc: '讓你可以同時裝備兩把雙手武器（主手與副手各一把），且雙手武器的詞條效果提升 {pct}%', vfx: { attack: 'slash-dual-10' } }] },
  counter: { name: '反擊', emoji: '🛡️', range: '', cd: 0, cost: 5, tiers: [{ name: '反擊', unlock: { reinc: 0, lv: 300 }, cost: 5, fx: { chance: 35, pct: 50, pctPer: 5 }, goldBase: 100000, goldGrow: 1.5, desc: '被動：受到傷害時有 {chance}% 機率對攻擊者反擊，造成 {pct}% 普攻傷害', vfx: { projectile: 'proj-counter-ripple', hit: 'hit-phys' } }, { name: '招架', unlock: { reinc: 0, lv: 350 }, cost: 10, fx: { mult: 300, multPer: 30 }, goldBase: 200000, goldGrow: 1.5, desc: '格擋時必定對敵人反擊，造成「格擋減傷值 × {mult}%」的普攻傷害' }, { name: '強化反擊', unlock: { reinc: 0, lv: 400 }, cost: 20, fx: { pct: 30, pctPer: 5 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步提升反擊傷害，額外 +{pct}% 反擊普攻傷害' }, { name: '反擊盾', unlock: { reinc: 0, lv: 450 }, cost: 40, fx: { pct: 1, pctPer: 0.1 }, goldBase: 800000, goldGrow: 1.5, desc: '觸發反擊時，回復自身最大生命 {pct}% 的護盾' }, { name: '破甲擊', unlock: { reinc: 0, lv: 500 }, cost: 60, fx: { chance: 35, def: 15, sec: 4, secPer: 0.4, max: 4 }, goldBase: 1500000, goldGrow: 1.5, desc: '格擋時有 {chance}% 機率造成破甲：防禦 -{def}%，持續 {sec} 秒，最多疊 {max} 層（疊層時重置時間）', vfx: { hit: 'hit-earth' }, status: { enemy: [{ id: 'sgArmorBrk' }] } }, { name: '二次反擊', unlock: { reinc: 0, lv: 550 }, cost: 80, fx: { chance: 25, chancePer: 2.5, count: 1 }, goldBase: 3000000, goldGrow: 1.5, desc: '反擊時有 {chance}% 機率再追加 {count} 次反擊（追加反擊不會再觸發反擊）' }, { name: '狂化反殺', unlock: { reinc: 0, lv: 600 }, cost: 100, fx: { pct: 50, pctPer: 5, count: 1, m: 80 }, goldBase: 5000000, goldGrow: 1.5, desc: '每次反擊時，額外對 {m} 米內隨機 {count} 個敵人反擊，造成 {pct}% 普攻傷害（不會再觸發反擊）' }], ult: [{ id: 'holyBody', name: '神聖之體', cost: 300, fx: { count: 10, pct: 300, pctPer: 30, m: 8 }, goldBase: 10000000, goldGrow: 1.5, desc: '每 {count} 次反擊後朝目標射出一顆光彈，對其周圍 {m} 米內的敵人造成 {pct}% 神聖傷害', triggerVfx: { attack: 'burst-holy', projectile: 'proj-light-orb' } }, { id: 'indomitable', name: '不屈鬥魂', cost: 300, fx: { pct: 2000, pctPer: 200, sec: 5, cd: 60, gap: 0.5, m: 30 }, goldBase: 10000000, goldGrow: 1.5, desc: '反擊系列所有傷害轉為地屬性；受到致命傷害時保持站姿升空，在 {sec} 秒內無敵且生命由 0 逐漸回滿；每 {gap} 秒對 {m} 米內敵人造成一次地系傷害，期間總傷害為（物攻＋魔攻）的 {pct}%；不算死亡、不清場，結束後繼續戰鬥；冷卻 {cd} 秒', vfx: { attack: 'burst-earth', hit: 'hit-earth' }, triggerVfx: { ground: 'pillar-indomitable' }, status: { self: [{ id: 'invuln' }] } }, { id: 'warGodBody', name: '戰神體', cost: 300, fx: { sec: 2, hpPct: 1, mult: 2, gap: 0.5 }, goldBase: 10000000, goldGrow: 1.5, desc: '你每 {gap} 秒流失最大生命的 {hpPct}%；每 {sec} 秒累計損失的生命百分比，以 {mult} 倍加成套用至接下來 {sec} 秒內的反擊傷害' }] },
  bloodrage: { name: '嗜血狂怒', emoji: '💢', range: '', cd: 60, cost: 25, tiers: [{ name: '嗜血狂怒', unlock: { reinc: 0, lv: 400 }, cost: 25, fx: { pct: 20, pctPer: 2, sec: 8 }, goldBase: 100000, goldGrow: 1.5, desc: '攻速額外 +{pct}%（乘算，不受攻速上限限制），持續 {sec} 秒', triggerVfx: { attack: 'burst-detonate' }, status: { self: [{ id: 'sgBloodrage' }] } }, { name: '狂暴', unlock: { reinc: 0, lv: 450 }, cost: 40, fx: { pct: 20, pctPer: 2 }, goldBase: 200000, goldGrow: 1.5, desc: '狂怒期間爆擊傷害額外 +{pct}%（乘算）', triggerVfx: {  } }, { name: '狂怒', unlock: { reinc: 0, lv: 500 }, cost: 60, fx: { pct: 20, pctPer: 2 }, goldBase: 400000, goldGrow: 1.5, desc: '狂怒期間總傷害額外 +{pct}%（乘算）', triggerVfx: {  } }, { name: '狂化連殺', unlock: { reinc: 0, lv: 550 }, cost: 80, fx: { add: 0.5, addPer: 0.1, kill: 0.1, killMax: 5 }, goldBase: 800000, goldGrow: 1.5, desc: '狂怒期間基礎連擊數 +{add}，且每擊殺 1 個敵人再 +{kill}（累計上限 +{killMax}；不足 1 次的部分以機率觸發）', triggerVfx: {  } }, { name: '嗜血反震', unlock: { reinc: 0, lv: 600 }, cost: 100, fx: { pct: 20, pctPer: 2 }, goldBase: 1500000, goldGrow: 1.5, desc: '狂怒期間反震傷害提高 {pct}%（乘算，可與其它反震加成疊加）', triggerVfx: {  } }, { name: '血飲術', unlock: { reinc: 0, lv: 650 }, cost: 140, fx: { pct: 30, pctPer: 3, self: 1, m: 80 }, goldBase: 3000000, goldGrow: 1.5, desc: '狂怒期間傷害額外提高 {pct}%（乘算），但 {m} 米內的敵人每次受傷都會使你損失最大生命 {self}%（直接扣血，無法被護盾吸收）', triggerVfx: {  } }, { name: '狂血盛宴', unlock: { reinc: 0, lv: 700 }, cost: 240, fx: { sec: 0.5, pct: 1, pctPer: 0.1, count: 1 }, goldBase: 5000000, goldGrow: 1.5, desc: '狂怒期間每擊殺 1 個敵人，持續時間延長 {sec} 秒；且生命值每減少 1%，傷害額外 +{pct}%（乘算，無限疊加），每 1 連擊數使普攻可同時攻擊 1 個敵人（無限疊加）', triggerVfx: { attack: 'burst-detonate-phys' } }], ult: [{ id: 'slayerAdvent', name: '殺神降臨', cost: 300, fx: { pct: 100, pctPer: 10, m: 8 }, goldBase: 10000000, goldGrow: 1.5, desc: '狂怒期間普攻傷害 +{pct}%，且同時對目標周圍 {m} 米內的所有敵人造成傷害', triggerVfx: { attack: 'burst-detonate-phys-08' } }, { id: 'warGodRoll', name: '戰神屠錄', cost: 300, fx: { pct: 2, pctPer: 0.2, maxStacks: 200, drain: 100, drainPer: 10 }, goldBase: 10000000, goldGrow: 1.5, desc: '狂怒期間你無法獲得護盾，但每殺死 1 個敵人使你造成的所有傷害 +{pct}%，最多 {maxStacks} 層；施放狂怒後吸血效果提升 {drain}%（與當前吸血乘算，不隨擊殺疊層），增傷層數與吸血加成持續到你死亡為止', triggerVfx: { attack: 'burst-detonate-dark-09' }, status: { self: [{ id: 'sgWarGodKill' }] } }, { id: 'asuraFist', name: '阿修羅霸王拳', cost: 300, fx: { pct: 500, pctPer: 50, sec: 1.5, secPer: 0.15, killSec: 0.2, gap: 10 }, goldBase: 10000000, goldGrow: 1.5, desc: '每 {gap} 秒，你造成的所有傷害 +{pct}%，持續 {sec} 秒；效果期間每擊殺 1 個敵人，持續時間延長 {killSec} 秒', triggerVfx: { attack: 'burst-detonate-dark' }, status: { self: [{ id: 'sgAsuraFist' }] } }] },
  fireball: { name: '火球術', emoji: '🔥', range: '', dmgType: 'magic', elem: 'fire', cd: 15, cost: 40, tiers: [{ name: '火球術', unlock: { reinc: 0, lv: 1 }, cost: 40, fx: { pct: 150, pctPer: 15, castM: 30, speed: 65.52, m: 6 }, goldBase: 100000, goldGrow: 1.5, desc: '射出一顆火球（射程 {castM} 米），命中時爆炸，對目標及 {m} 米內的敵人造成 {pct}% 火焰傷害', vfx: { cast: 'cast-magic', attack: 'hit-fireball-rupture', projectile: 'proj-dragon-devour' } }, { name: '燃燒', unlock: { reinc: 0, lv: 1 }, cost: 60, fx: { dotPct: 20, dotPctPer: 2, dotSec: 5, dotGap: 0.5 }, goldBase: 200000, goldGrow: 1.5, desc: '被火球擊中的敵人陷入燃燒：每 {dotGap} 秒造成技能傷害 {dotPct}% 的火焰傷害，持續 {dotSec} 秒', status: { enemy: [{ id: 'sgBurn' }] } }, { name: '火球爆裂', unlock: { reinc: 0, lv: 50 }, cost: 80, fx: { pct: 30, pctPer: 3, count: 3, m: 20 }, goldBase: 400000, goldGrow: 1.5, desc: '火球爆炸後分裂出 {count} 個小火球，射向目標 {m} 米內的敵人，每個造成原始火球 {pct}% 的傷害', vfx: { attack: 'hit-fireball-rupture', projectile: 'proj-dragon-devour', hit: 'hit-fireball-rupture' } }, { name: '強化燃燒', unlock: { reinc: 0, lv: 100 }, cost: 100, fx: { gap: 0.4, gapPer: -0.015 }, goldBase: 800000, goldGrow: 1.5, desc: '燃燒的作用間隔縮短至 {gap} 秒（跳得更快＝總傷更高）' }, { name: '爆燃', unlock: { reinc: 0, lv: 150 }, cost: 140, fx: { pct: 50, pctPer: 5, count: 2, m: 12 }, goldBase: 1500000, goldGrow: 1.5, desc: '燃燒結束或敵人死亡時爆炸，對我方 {m} 米內的 {count} 個敵人造成該敵人整段燃燒累積傷害 {pct}% 的傷害', vfx: { attack: 'burst-fire', hit: 'hit-fire' } }, { name: '火焰增幅', unlock: { reinc: 0, lv: 200 }, cost: 200, fx: { pct: 0.25, pctPer: 0.025, sec: 4, m: 20 }, goldBase: 3000000, goldGrow: 1.5, desc: '我方 {m} 米內每有 1 次燃燒作用，你的火焰傷害 +{pct}%，持續 {sec} 秒（無限疊加，每次疊加時重置時間）', status: { self: [{ id: 'sgFireAmp' }] } }, { name: '殞石術', unlock: { reinc: 0, lv: 250 }, cost: 320, fx: { pct: 250, pctPer: 25, count: 3, castM: 20, speed: 36, m: 15 }, goldBase: 5000000, goldGrow: 1.5, desc: '改為召喚 {count} 顆巨大火殞石從天而降（射程 {castM} 米），每顆對目標 {m} 米內的敵人造成 {pct}% 火焰傷害，且殞石造成的燃燒傷害為 2 倍（第 2~6 階效果仍然生效）', vfx: { attack: 'burst-fire', projectile: 'proj-meteor-inferno', hit: 'burst-meteor-inferno', ground: 'mark-red' } }], ult: [{ id: 'meteorFall', name: '火殞天落', cost: 300, fx: { count: 8, size: 30, pct: 50, pctPer: 5 }, goldBase: 10000000, goldGrow: 1.5, desc: '殞石的體積 +{size}%、造成的傷害 +{pct}%，且每次施放額外連續落下 {count} 顆巨大殞石' }, { id: 'starfallCataclysm', name: '地爆天星', cost: 300, fx: { normal: 90, elite: 40, boss: 20, gap: 50, gapPer: -3 }, goldBase: 10000000, goldGrow: 1.5, desc: '每 {gap} 秒，天空落下一顆超巨型殞石：普通敵人 -{normal}% 生命、菁英 -{elite}% 生命、BOSS -{boss}% 生命', vfx: { projectile: 'proj-starfall', hit: 'burst-fire', ground: 'ground-starfall-shadow' }, triggerVfx: { attack: 'burst-fire-shockwave' }, status: { self: [{ id: 'sgStarfall' }] } }, { id: 'phoenixPrairie', name: '火鳳遼原', cost: 300, fx: { count: 1, balls: 3, ballsPer: 0.3, pct: 30, pctPer: 3 }, goldBase: 10000000, goldGrow: 1.5, desc: '殞石數量 +{count} 顆，且每顆殞石落下時伴隨 {balls} 顆火球一同落下；火球與殞石造成的傷害 +{pct}%', vfx: { projectile: 'proj-dragon-devour', hit: 'hit-fire-explosion' } }] },
  firepillar: { name: '火龍捲', emoji: '🌋', range: '', dmgType: 'magic', elem: 'fire', cd: 15, cost: 40, tiers: [{ name: '火龍捲', unlock: { reinc: 0, lv: 50 }, cost: 40, fx: { pct: 60, pctPer: 6, hits: 6, sec: 3, castM: 30, m: 3 }, goldBase: 100000, goldGrow: 1.5, desc: '在敵人腳下召喚一道火柱（射程 {castM} 米），對目標 {m} 米內的敵人連續造成 {hits} 段傷害，每段 {pct}% 火焰傷害（全程約 {sec} 秒）', vfx: { hit: 'hit-fire', field: 'fire-tornado-inferno' } }, { name: '龍捲噴發', unlock: { reinc: 0, lv: 100 }, cost: 60, fx: { pct: 10, pctPer: 2 }, goldBase: 200000, goldGrow: 1.5, desc: '火柱的傷害範圍擴大 {pct}%' }, { name: '雙重龍捲', unlock: { reinc: 0, lv: 150 }, cost: 80, fx: { count: 2, pct: 20, pctPer: 2, m: 20 }, goldBase: 400000, goldGrow: 1.5, desc: '可同時對 {m} 米內的 {count} 個目標施放火柱，且火焰傷害額外 +{pct}%' }, { name: '燃燒', unlock: { reinc: 0, lv: 200 }, cost: 100, fx: { chance: 20, chancePer: 2, dotPct: 20, dotSec: 4, dotGap: 0.5 }, goldBase: 800000, goldGrow: 1.5, desc: '火柱每次作用時有 {chance}% 機率使敵人燃燒：每 {dotGap} 秒造成技能傷害 {dotPct}% 的火焰傷害，持續 {dotSec} 秒', status: { enemy: [{ id: 'sgBurn' }] } }, { name: '烈焰衝擊', unlock: { reinc: 0, lv: 250 }, cost: 140, fx: { pct: 100, pctPer: 10, m: 12 }, goldBase: 1500000, goldGrow: 1.5, desc: '火龍捲消失時，對周圍 {m} 米內的敵人造成 {pct}% 火焰傷害', vfx: { hit: 'hit-fire' }, triggerVfx: { attack: 'burst-fire-shockwave', hit: 'hit-fire' } }, { name: '重生', unlock: { reinc: 0, lv: 300 }, cost: 200, fx: { chance: 25, chancePer: 2.5, m: 20 }, goldBase: 3000000, goldGrow: 1.5, desc: '火柱消失後有 {chance}% 機率在我方 {m} 米內的敵人身上重生' }, { name: '無限火龍', unlock: { reinc: 0, lv: 350 }, cost: 320, fx: { hitsAdd: 6, pct: 100, pctPer: 10, respawn: 1, sec: 6, speed: 6 }, goldBase: 5000000, goldGrow: 1.5, desc: '火龍捲持續 {sec} 秒，傷害段數 +{hitsAdd} 段，每段 {pct}% 火焰傷害；以每秒 {speed} 米持續隨機追敵，單一敵人時在其附近移動；消散後再召喚 {respawn} 次（再召喚不可連鎖），火焰轉為暗紅色', vfx: { hit: 'hit-fire', field: 'fire-tornado-infinite' } }], ult: [{ id: 'infernoTempest', name: '烈焰暴風', cost: 300, fx: { pct: 200, pctPer: 20, count: 1, m: 6, searchM: 36, gap: 0.33, speed: 36 }, goldBase: 10000000, goldGrow: 1.5, desc: '火龍捲每 {gap} 秒向 {searchM} 米內每次重新隨機選取最多 {count} 名敵人發射追蹤必中火球，命中後爆炸，對周圍 {m} 米內的敵人造成 {pct}% 火焰傷害', triggerVfx: { attack: 'burst-fire', projectile: 'proj-dragon-devour' } }, { id: 'eternalInferno', name: '永劫火獄', cost: 300, fx: { pct: 200, pctPer: 20, sec: 6, gap: 0.5, m: 20 }, goldBase: 10000000, goldGrow: 1.5, desc: '火龍捲會在附近 {m} 米內隨機游走，並在移動軌跡上留下火池：每 {gap} 秒造成 {pct}% 火焰傷害，持續 {sec} 秒', triggerVfx: { ground: 'ground-mire-lava' } }, { id: 'dragonDevour', name: '融火之心', cost: 300, fx: { pct: 200, pctPer: 20, sec: 8, ballPct: 400, ballM: 6, ballMin: 2, ballMax: 4, ballSec: 0.9, m: 15, pullM: 35, ballRange: 20, arcM: 12, gap: 0.35 }, goldBase: 10000000, goldGrow: 1.5, desc: '改為召喚一個半徑 {m} 米的巨型火漩渦（新施放取代舊漩渦），每 {gap} 秒造成 {pct}% 火焰傷害，持續聚攏 {pullM} 米內的敵人，持續 {sec} 秒。每秒隨機噴出 {ballMin}～{ballMax} 顆小火球，以拋物線飛向 {ballRange} 米內的隨機地面，落地對半徑 {ballM} 米造成 {ballPct}% 火焰傷害。', vfx: { projectile: 'proj-dragon-devour', field: 'field-dragon-devour' }, triggerVfx: { attack: 'burst-dragon-devour' } }] },
  firehunt: { name: '火狩', emoji: '☄️', range: '3*3', dmgType: 'magic', elem: 'fire', cd: 15, cost: 40, tiers: [{ name: '火狩', unlock: { reinc: 0, lv: 100 }, cost: 40, fx: { pct: 100, pctPer: 10, count: 2, sec: 4, rps: 0.455, castM: 8, m: 8 }, goldBase: 100000, goldGrow: 1.5, desc: '召喚 {count} 團火狩環繞自身（環繞半徑 {m} 米、每秒 {rps} 圈），碰到敵人即命中一次，每次造成 {pct}% 火焰傷害，持續 {sec} 秒', vfx: { attack: 'burst-fire', projectile: 'orb-firehunt', hit: 'hit-fire-explosion', ground: 'ground-orbit-ring-fire' }, status: { self: [{ id: 'sgFirehunt' }] } }, { name: '強化火狩', unlock: { reinc: 0, lv: 150 }, cost: 60, fx: { pct: 15, pctPer: 1.5 }, goldBase: 200000, goldGrow: 1.5, desc: '火狩的體積與環繞範圍同步擴大 {pct}%' }, { name: '伴生火狩', unlock: { reinc: 0, lv: 200 }, cost: 80, fx: { chance: 20, chancePer: 2, m: 1 }, goldBase: 400000, goldGrow: 1.5, desc: '火狩命中時有 {chance}% 機率在母體外緣後方留 {m} 米間隙伴生一團火狩（每團只能伴生一次，伴生出的不再伴生）', vfx: { projectile: 'orb-firehunt-companion' } }, { name: '三重火狩', unlock: { reinc: 0, lv: 250 }, cost: 100, fx: { count: 3, pct: 120, pctPer: 12, sec: 4 }, goldBase: 800000, goldGrow: 1.5, desc: '改為召喚 {count} 團火狩，每團造成 {pct}% 火焰傷害，持續 {sec} 秒' }, { name: '極速火狩', unlock: { reinc: 0, lv: 300 }, cost: 140, fx: { pct: 25, pctPer: 2.5 }, goldBase: 1500000, goldGrow: 1.5, desc: '火狩的旋轉速度 +{pct}%' }, { name: '再生', unlock: { reinc: 0, lv: 350 }, cost: 200, fx: { sec: 0.4, secPer: 0.04 }, goldBase: 3000000, goldGrow: 1.5, desc: '火狩每擊殺 1 個敵人，全部火狩的持續時間延長 {sec} 秒' }, { name: '狩神之舞', unlock: { reinc: 0, lv: 400 }, cost: 320, fx: { rings: 2, pct: 150, pctPer: 15, sec: 6, m: 6 }, goldBase: 5000000, goldGrow: 1.5, desc: '改為一次施放 {rings} 道火狩（外圈距內圈 {m} 米、兩道旋轉方向相反），每團造成 {pct}% 火焰傷害、出現時自帶伴生，持續 {sec} 秒' }], ult: [{ id: 'solarRing', name: '烈陽星環', cost: 300, fx: { count: 1, grow: 60, growSec: 4, spin: 30, pct: 50, pctPer: 10 }, goldBase: 10000000, goldGrow: 1.5, desc: '火狩數量 +{count} 團，體積在 {growSec} 秒內逐漸增大最多 {grow}%，環繞速度 +{spin}%，且造成傷害 +{pct}%' }, { id: 'infiniteRing', name: '無限星環', cost: 300, fx: { count: 10, countPer: 1, m: 40 }, goldBase: 10000000, goldGrow: 1.5, desc: '火狩改為從自身中心呈螺旋狀向外擴散（在 {m} 米處達到最外圈），並於持續時間內不斷放出火狩，最多額外 +{count} 團' }, { id: 'fireGodDescend', name: '火神降臨', cost: 300, fx: { pct: 300, pctPer: 30, orbs: 3, orbsPer: 0.3, rps: 0.5, gap: 0.5, speed: 24, m: 6, flyM: 50, orbitM: 8 }, goldBase: 10000000, goldGrow: 1.5, desc: '你的身體被火焰包裹：每 {gap} 秒對周圍 {m} 米內的敵人造成 {pct}% 火焰傷害；普攻同時朝目標射出 {orbs} 顆火狩星環，以半徑 {orbitM} 米組成圓環，每秒順時針旋轉 {rps} 圈，整組以 {speed} 米／秒貫穿飛行 {flyM} 米', vfx: { projectile: 'proj-firehunt-ring', hit: 'hit-fire' }, status: { self: [{ id: 'sgFireGodBody' }] } }] },
  rockarmor: { name: '岩甲術', emoji: '🪨', range: '', dmgType: 'magic', elem: 'earth', cd: 15, cost: 40, tiers: [{ name: '岩甲術', unlock: { reinc: 0, lv: 150 }, cost: 40, fx: { pct: 30, pctPer: 3, sec: 10, castM: 30 }, goldBase: 100000, goldGrow: 1.5, desc: '施放岩甲強化自身，獲得最大生命值 {pct}% 的岩甲護盾，持續 {sec} 秒', vfx: { ground: 'aura-rockarmor-stone' }, status: { self: [{ id: 'shield' }, { id: 'sgRockArmor' }] } }, { name: '強化岩甲', unlock: { reinc: 0, lv: 200 }, cost: 40, fx: { pct: 20, pctPer: 2 }, goldBase: 200000, goldGrow: 1.5, desc: '進一步強化岩甲，額外獲得最大生命值 {pct}% 的岩甲護盾（與第 1 階累加）' }, { name: '岩甲尖刺', unlock: { reinc: 0, lv: 250 }, cost: 40, fx: { pct: 5, pctPer: 0.5 }, goldBase: 400000, goldGrow: 1.5, desc: '岩甲護盾存在期間，攻擊你的敵人會遭受你最大生命值 {pct}% 的地系傷害（獨立於反震，兩者各自結算）', vfx: { hit: 'hit-earth' } }, { name: '護盾增幅', unlock: { reinc: 0, lv: 300 }, cost: 40, fx: { pct: 15, pctPer: 1.5 }, goldBase: 800000, goldGrow: 1.5, desc: '主動型被動（裝配到技能列即恆時生效）：你獲得的所有護盾效率額外 +{pct}%（乘算）' }, { name: '岩之再生', unlock: { reinc: 0, lv: 350 }, cost: 40, fx: { pct: 1, pctPer: 0.1 }, goldBase: 1500000, goldGrow: 1.5, desc: '岩甲護盾存在期間，你每減少 1% 生命值即獲得最大生命 {pct}% 的護盾' }, { name: '岩甲增幅', unlock: { reinc: 0, lv: 400 }, cost: 40, fx: { pct: 0.5, pctPer: 0.05, max: 30, sec: 3 }, goldBase: 3000000, goldGrow: 1.5, desc: '岩甲護盾存在期間，你每減少 1% 護盾即獲得 {pct}% 傷害增幅（乘算），最多疊 {max} 層，持續 {sec} 秒', status: { self: [{ id: 'sgRockAmp' }] } }, { name: '天地逆返', unlock: { reinc: 0, lv: 450 }, cost: 40, fx: { pct: 30, pctPer: 3 }, goldBase: 5000000, goldGrow: 1.5, desc: '岩甲護盾存在期間，護盾剩餘量越低則傷害減免越高，護盾歸零時最高額外 +{pct}% 傷害減免（乘算）', vfx: { ground: 'aura-earth-reversal' } }], ult: [{ id: 'superRockArt', name: '超重岩之術', cost: 300, fx: { sec: 4, pct: 400, pctPer: 40, m: 24 }, goldBase: 10000000, goldGrow: 1.5, desc: '施放時將巨岩之力壓縮到極致，使 {m} 米內的敵人石化 {sec} 秒：無法行動，且受到的土系傷害額外 +{pct}%', vfx: { attack: 'burst-rock-petrify', hit: 'hit-earth' }, status: { self: [{ id: 'sgPetrifyDomain' }], enemy: [{ id: 'stun' }, { id: 'sgPetrify' }] } }, { id: 'adamantBody', name: '金剛不壞', cost: 300, fx: { red: 45, redPer: 0.5, hp: 50, hpPer: 5, spike: 100 }, goldBase: 10000000, goldGrow: 1.5, desc: '岩甲護盾存在期間額外獲得 +{red}% 傷害減免（乘算），生命上限與岩甲護盾 +{hp}%，且【岩甲尖刺】的效果額外提高 {spike}%' }, { id: 'gravityField', name: '超重力場', cost: 300, fx: { pct: 300, pctPer: 30, stiff: 65, stiffSec: 5, m: 24 }, goldBase: 10000000, goldGrow: 1.5, desc: '施放岩甲術時同時扭曲 {m} 米內的重力場，使敵人僵化（移動、攻速與傷害 -{stiff}%，持續 {stiffSec} 秒）；岩甲護盾存在期間你的土系傷害額外 +{pct}%', vfx: { attack: 'burst-gravity', hit: 'hit-earth' }, status: { self: [{ id: 'sgGravityDomain' }], enemy: [{ id: 'sgStiffen' }] } }] },
  mire: { name: '泥沼術', emoji: '🟤', range: '12*12', dmgType: 'magic', elem: 'earth', cd: 15, cost: 40, tiers: [{ name: '泥沼術', unlock: { reinc: 0, lv: 200 }, cost: 40, fx: { sec: 4, secPer: 0.4, move: 30, aspd: 50, castM: 20 }, goldBase: 100000, goldGrow: 1.5, desc: '在敵人腳下召喚一片 12×12 米的沼澤（射程 {castM} 米），沼澤中的敵人陷入緩速（移動速度 -{move}%、攻速 -{aspd}%），持續 {sec} 秒', vfx: { ground: 'ground-mire-earth' }, status: { enemy: [{ id: 'sgMire' }] } }, { name: '虛弱', unlock: { reinc: 0, lv: 250 }, cost: 40, fx: { pct: 15, pctPer: 1.5 }, goldBase: 200000, goldGrow: 1.5, desc: '受泥沼緩速影響的敵人，受到的傷害提高 {pct}%' }, { name: '毒沼術', unlock: { reinc: 0, lv: 300 }, cost: 40, fx: { dotPct: 25, dotPctPer: 2.5, dotGap: 0.5 }, goldBase: 400000, goldGrow: 1.5, desc: '沼澤持續放出毒氣：沼澤中的敵人每 {dotGap} 秒受到魔法攻擊 {dotPct}% 的毒性傷害', vfx: { ground: 'ground-mire-venom' }, status: { enemy: [{ id: 'sgMirePoison' }] } }, { name: '毒沼增生', unlock: { reinc: 0, lv: 350 }, cost: 40, fx: { add: 1, addPer: 0.1, m: 40 }, goldBase: 800000, goldGrow: 1.5, desc: '沼澤結束時傳染給 {m} 米內較近的敵人，最多傳染 {add} 次（不足 1 次的部分以機率觸發）' }, { name: '沼澤漫延', unlock: { reinc: 0, lv: 400 }, cost: 40, fx: { sec: 6, pct: 40, pctPer: 4, growSec: 4 }, goldBase: 1500000, goldGrow: 1.5, desc: '沼澤持續時間提高至 {sec} 秒，且在 {growSec} 秒內逐步擴大，最大擴增 {pct}%' }, { name: '重力泥沼', unlock: { reinc: 0, lv: 450 }, cost: 40, fx: { move: 50, aspd: 75, pct: 20, pctPer: 2 }, goldBase: 3000000, goldGrow: 1.5, desc: '緩速強化為移動速度 -{move}%、攻速 -{aspd}%，且受影響目標受到的傷害再提高 {pct}%（與第 2 階累加）' }, { name: '熔岩沼', unlock: { reinc: 0, lv: 500 }, cost: 40, fx: { sec: 8, pct: 20, pctPer: 2, dotPct: 70, dotPctPer: 7, dotGap: 0.4 }, goldBase: 5000000, goldGrow: 1.5, desc: '沼澤轉變為岩漿：持續時間提高至 {sec} 秒、範圍再擴增 {pct}%（與第 5 階累加），其中的目標每 {dotGap} 秒額外受到魔法攻擊 {dotPct}% 的火焰傷害', vfx: { ground: 'ground-mire-magma' }, status: { enemy: [{ id: 'sgMireLava' }] } }], ult: [{ id: 'plagueMire', name: '惡疫魔沼', cost: 300, fx: { pct: 200, pctPer: 20, amp: 100, ampPer: 10, sec: 8, gap: 0.35 }, goldBase: 10000000, goldGrow: 1.5, desc: '沼澤範圍內的敵人染上【瘟疫】：每 {gap} 秒受到魔法攻擊 {pct}% 的毒性傷害，且受到的毒性傷害額外 +{amp}%；離開沼澤後仍持續 {sec} 秒', status: { enemy: [{ id: 'sgPlague' }] } }, { id: 'abyssInferno', name: '深淵火獄', cost: 300, fx: { hits: 8, pct: 100, pctPer: 10, sec: 8, gap: 2, m: 6 }, goldBase: 10000000, goldGrow: 1.5, desc: '熔岩沼每 {gap} 秒對範圍內的敵人噴出 1 道火龍捲（半徑 {m} 米、{hits} 段、每段 {pct}% 火焰傷害），並將命中的敵人屬性改變為火屬性，持續 {sec} 秒', vfx: { hit: 'hit-fire', ground: 'ground-tornado-fire' }, status: { enemy: [{ id: 'sgInferno' }] } }, { id: 'netherMire', name: '黃泉沼', cost: 300, fx: { hpPct: 30, chance: 0.5, chancePer: 0.05, add: 0.5, addPer: 0.05 }, goldBase: 10000000, goldGrow: 1.5, desc: '沼澤範圍內生命值 {hpPct}% 以下的敵人，每次受到傷害有 {chance}% 機率直接被斬殺，且該機率每次受傷再累加 {add}%' }] },
  earthguard: { name: '大地守護', emoji: '🌍', range: '', dmgType: 'magic', elem: 'earth', cd: 0, cost: 0, tiers: [{ name: '大地守護', unlock: { reinc: 0, lv: 250 }, fx: { pct: 10, pctPer: 1, hp: 20, hpPer: 2 }, goldBase: 100000, goldGrow: 1.5, desc: '主動型被動：自身傷害減免額外 +{pct}%、生命上限額外 +{hp}%（皆為乘算）' }, { name: '大地祝福', unlock: { reinc: 0, lv: 300 }, cost: 25, fx: { pct: 25, pctPer: 2.5 }, goldBase: 200000, goldGrow: 1.5, desc: '全屬性傷害額外 +{pct}%（與所有屬性增傷效果為額外的乘法計算）' }, { name: '生命再生', unlock: { reinc: 0, lv: 350 }, cost: 25, fx: { pct: 100, pctPer: 10, drain: 50, drainPer: 5 }, goldBase: 400000, goldGrow: 1.5, desc: '生命回復額外 +{pct}%、吸血額外 +{drain}%（皆與原屬性為額外的乘法計算）' }, { name: '魔力再生', unlock: { reinc: 0, lv: 400 }, cost: 25, fx: { pct: 100, pctPer: 10, drain: 50, drainPer: 5 }, goldBase: 800000, goldGrow: 1.5, desc: '法力回復額外 +{pct}%、吸魔額外 +{drain}%（皆與原屬性為額外的乘法計算）' }, { name: '魔法盾', unlock: { reinc: 0, lv: 450 }, cost: 25, fx: { pct: 30, pctPer: 3, manaRed: 30, manaRedPer: 5 }, goldBase: 1500000, goldGrow: 1.5, desc: '你的生命減少時，其中 {pct}% 改由消耗法力承擔，承擔的法力降低 {manaRed}%（法力不足時只轉換付得起的部分，餘額仍扣生命）' }, { name: '生命反射之盾', unlock: { reinc: 0, lv: 500 }, cost: 25, fx: { pct: 1, pctPer: 0.1, count: 1, m: 20 }, goldBase: 3000000, goldGrow: 1.5, desc: '你每消耗 1% 生命或護盾，{m} 米內的 {count} 個敵人同步損失 {pct}% 最大生命', vfx: { attack: 'beam-light', hit: 'hit-light' } }, { name: '天地共生', unlock: { reinc: 0, lv: 550 }, cost: 25, fx: { pct: 20, pctPer: 8, sec: 5, cd: 60, cdPer: -3 }, goldBase: 5000000, goldGrow: 1.5, desc: '死亡時原地復活並回復 {pct}% 生命，復活後 {sec} 秒無敵；此招自身冷卻 {cd} 秒（顯示於技能格）', vfx: { attack: 'pillar-light', hit: 'hit-light' }, status: { self: [{ id: 'invuln' }] } }], ult: [{ id: 'hallOfRadiance', name: '光耀之堂', cost: 300, fx: { pct: 250, pctPer: 25, conv: 100, convPer: 10 }, goldBase: 10000000, goldGrow: 1.5, desc: '生命與法力回復額外 +{pct}%（乘算），且溢出的生命與法力以 {conv}% 轉為你的生命護盾' }, { id: 'worldRebirth', name: '天地再造', cost: 300, fx: { chance: 15, chancePer: 15, hp: 80, hpPer: -5 }, goldBase: 10000000, goldGrow: 1.5, desc: '被你殺死的普通與菁英敵人有 {chance}% 機率（上限 100%）以 {hp}% 生命重生（同一個敵人只會重生一次）', vfx: { attack: 'pillar-earth', hit: 'hit-earth' } }, { id: 'fateReversal', name: '逆轉乾坤', cost: 300, fx: { max: 2, maxPer: 0.1 }, goldBase: 10000000, goldGrow: 1.5, desc: '【天地共生】的冷卻結束後可累積復活次數，最多累積 {max} 次（小數四捨五入取整）' }] },
  chainlightning: { name: '連鎖閃電', emoji: '⚡', range: '', dmgType: 'magic', elem: 'lightning', cd: 15, cost: 40, tiers: [{ name: '連鎖閃電', unlock: { reinc: 0, lv: 300 }, cost: 40, fx: { pct: 150, pctPer: 15, count: 4, castM: 40, m: 40 }, goldBase: 100000, goldGrow: 1.5, desc: '丟出一道閃電鏈（射程 {castM} 米），在最多 {count} 個目標間彈射（每段彈射範圍 {m} 米），每擊造成 {pct}% 雷電傷害', vfx: { cast: 'cast-magic', hit: 'hit-lightning' } }, { name: '強化閃電', unlock: { reinc: 0, lv: 350 }, cost: 40, fx: { pct: 50, pctPer: 5 }, goldBase: 200000, goldGrow: 1.5, desc: '強化閃電威力，閃電鏈傷害進一步 +{pct}% 雷電傷害' }, { name: '雷鳴術', unlock: { reinc: 0, lv: 400 }, cost: 40, fx: { add: 1, addPer: 0.1 }, goldBase: 400000, goldGrow: 1.5, desc: '被閃電鏈擊中的敵人額外再受到 {add} 次雷電傷害（不足 1 次的部分以機率觸發）' }, { name: '強化連鎖', unlock: { reinc: 0, lv: 450 }, cost: 40, fx: { add: 1, addPer: 0.2 }, goldBase: 800000, goldGrow: 1.5, desc: '閃電鏈的彈射數額外 +{add} 次（不足 1 次的部分以機率觸發）' }, { name: '電殛擴散', unlock: { reinc: 0, lv: 500 }, cost: 40, fx: { pct: 25, pctPer: 2.5, count: 1, m: 6 }, goldBase: 1500000, goldGrow: 1.5, desc: '閃電鏈每次彈射時，額外對 {m} 米內的 {count} 個敵人造成閃電鏈 {pct}% 的雷電傷害', vfx: { hit: 'hit-lightning' } }, { name: '雷幻身', unlock: { reinc: 0, lv: 550 }, cost: 40, fx: { pct: 50, pctPer: 5 }, goldBase: 3000000, goldGrow: 1.5, desc: '閃電鏈傷害額外 +{pct}% 雷電傷害；沒有可彈射的敵人時立即終止', vfx: { ground: 'aura-lightning-relay' } }, { name: '雷電暴風', unlock: { reinc: 0, lv: 600 }, cost: 40, fx: { count: 3, add: 1, addPer: 0.1, pct: 100, pctPer: 10, chance: 20 }, goldBase: 5000000, goldGrow: 1.5, desc: '同時發射 {count} 道閃電鏈，彈射數額外 +{add} 次，且閃電傷害額外 +{pct}%；每次彈射有 {chance}% 機率生成 1 條閃電鏈' }], ult: [{ id: 'skyThunderArray', name: '天地雷鎖陣', cost: 300, fx: { sec: 3, secPer: 0.3, gap: 1, gapPer: -0.05 }, goldBase: 10000000, goldGrow: 1.5, desc: '施放連鎖閃電後每 {gap} 秒自動再施放 1 次，持續 {sec} 秒（自動施放不扣法力、不進冷卻）' }, { id: 'eternalSuperconductor', name: '永恒超導體', cost: 300, fx: { pct: 2, pctPer: 0.2, maxStacks: 100, m: 30 }, goldBase: 10000000, goldGrow: 1.5, desc: '額外射出 1 道無限彈射的閃電鏈：在自身與 {m} 米內的任意敵人之間往返彈射，每經過自身 1 次使你的雷電傷害 +{pct}%，最多 {maxStacks} 層（持續到你死亡為止）', vfx: { projectile: 'bolt-chain-lightning', hit: 'hit-lightning', ground: 'aura-lightning-relay' }, status: { self: [{ id: 'sgSuperconduct' }] } }, { id: 'flyingThunderGod', name: '飛雷神', cost: 300, fx: { count: 3, pct: 200, pctPer: 20, sec: 6, gap: 0.35, m: 30, r: 12 }, goldBase: 10000000, goldGrow: 1.5, desc: '施放後每 {gap} 秒放出 {count} 道閃電，分別打向 {m} 米內最遠的 {count} 個敵人，各對命中處 {r} 米內的所有敵人造成 {pct}% 雷電傷害，持續 {sec} 秒', vfx: { projectile: 'bolt-chain-lightning', hit: 'hit-lightning' } }] },
  thunderstrike: { name: '落雷術', emoji: '🌩️', range: '', dmgType: 'magic', elem: 'lightning', cd: 15, cost: 40, tiers: [{ name: '落雷術', unlock: { reinc: 0, lv: 350 }, cost: 40, fx: { pct: 200, pctPer: 20, count: 2, castM: 30, gap: 0.2 }, goldBase: 100000, goldGrow: 1.5, desc: '對 {castM} 米內的 {count} 個目標降下落雷（每道間隔 {gap} 秒），每道造成 {pct}% 雷電傷害', vfx: { cast: 'cast-magic', attack: 'bolt-thunderstrike-bluewhite' } }, { name: '落雷連鎖', unlock: { reinc: 0, lv: 400 }, cost: 40, fx: { add: 1, addPer: 0.1 }, goldBase: 200000, goldGrow: 1.5, desc: '攻擊目標額外 +{add} 個（不足 1 個的部分以機率觸發）' }, { name: '雙重落雷', unlock: { reinc: 0, lv: 450 }, cost: 40, fx: { add: 1, addPer: 0.1 }, goldBase: 400000, goldGrow: 1.5, desc: '對每個目標的攻擊次數額外 +{add} 次（不足 1 次的部分以機率觸發）' }, { name: '閃電增幅', unlock: { reinc: 0, lv: 500 }, cost: 40, fx: { pct: 100, pctPer: 10 }, goldBase: 800000, goldGrow: 1.5, desc: '進一步強化落雷傷害，額外 +{pct}% 雷電傷害' }, { name: '雷電脈衝', unlock: { reinc: 0, lv: 550 }, cost: 40, fx: { sec: 1.5, secPer: 0.15, count: 2, m: 6 }, goldBase: 1500000, goldGrow: 1.5, desc: '落雷落地時產生衝擊波，震暈目標本身與 {m} 米內共 {count} 個敵人 {sec} 秒', status: { enemy: [{ id: 'stun' }] } }, { name: '迅雷重生', unlock: { reinc: 0, lv: 600 }, cost: 40, fx: { chance: 20, chancePer: 2, max: 5 }, goldBase: 3000000, goldGrow: 1.5, desc: '每道落雷結束後有 {chance}% 機率再產生 1 道落雷（同一次施放最多再生 {max} 道）' }, { name: '殛道落電', unlock: { reinc: 0, lv: 650 }, cost: 40, fx: { mult: 2, pct: 50, pctPer: 5, m: 6 }, goldBase: 5000000, goldGrow: 1.5, desc: '落雷擊中時對目標 {m} 米內的所有敵人造成傷害；攻擊次數與目標數量 ×{mult}，且命中暈眩中的敵人時傷害額外 +{pct}%（與原傷害乘算）' }], ult: [{ id: 'thunderMatrix', name: '雷電矩陣', cost: 300, fx: { count: 2, countPer: 0.2, pct: 300, pctPer: 30, speed: 30, wid: 3 }, goldBase: 10000000, goldGrow: 1.5, desc: '施放落雷術時同時召喚橫向與直向各 {count} 道雷幕橫掃全場（每道寬 {wid} 米、{speed} 米／秒，相鄰兩道由反方向交錯掃過），對掃過的所有敵人各造成 1 次 {pct}% 雷電傷害', vfx: { attack: 'bolt-curtain-lightning', ground: 'ground-thunder-curtain' } }, { id: 'heavenTribulation', name: '雷霆天劫', cost: 300, fx: { pct: 400, pctPer: 40, gap: 0.35, m: 30 }, goldBase: 10000000, goldGrow: 1.5, desc: '額外召喚 1 道永久持續的天劫雷電：每 {gap} 秒追擊 {m} 米內生命值最低的敵人，造成 {pct}% 雷電傷害', vfx: { attack: 'bolt-sky-purple', hit: 'hit-thunder-purple' } }, { id: 'eternalThunderPrison', name: '永恒雷獄', cost: 300, fx: { sec: 3, secPer: 0.3, gap: 1, gapPer: -0.05 }, goldBase: 10000000, goldGrow: 1.5, desc: '施放落雷術後每 {gap} 秒自動再施放 1 次，持續 {sec} 秒（自動施放不扣法力、不進冷卻）' }] },
  thunderorb: { name: '雷球', emoji: '🔵', range: '6*6', dmgType: 'magic', elem: 'lightning', cd: 15, cost: 40, tiers: [{ name: '雷球', unlock: { reinc: 0, lv: 400 }, cost: 40, fx: { pct: 50, pctPer: 5, count: 2, sec: 2, castM: 30, gap: 0.35, speed: 6, m: 4 }, goldBase: 100000, goldGrow: 1.5, desc: '召喚 {count} 個雷球緩慢飛向目標（射程 {castM} 米、飛行速度 {speed} 米/秒），途中每 {gap} 秒對半徑 {m} 米內的所有敵人造成 {pct}% 雷電傷害，抵達後停留 {sec} 秒才消散', vfx: { cast: 'cast-magic', hit: 'hit-lightning', field: 'lightning-orb-field' } }, { name: '擴增雷球', unlock: { reinc: 0, lv: 450 }, cost: 40, fx: { pct: 15, pctPer: 1.5 }, goldBase: 200000, goldGrow: 1.5, desc: '雷球的體積擴大 {pct}%' }, { name: '多重雷球', unlock: { reinc: 0, lv: 500 }, cost: 40, fx: { add: 1, addPer: 0.1 }, goldBase: 400000, goldGrow: 1.5, desc: '雷球數量額外 +{add} 個（不足 1 個的部分以機率觸發）' }, { name: '環體電球', unlock: { reinc: 0, lv: 550 }, cost: 40, fx: { count: 2, pct: 100, pctPer: 10, sec: 6, rps: 0.7, m: 8 }, goldBase: 800000, goldGrow: 1.5, desc: '額外召喚 {count} 個電球環繞自身（環繞半徑 {m} 米、每秒 {rps} 圈），碰到敵人即命中一次，每次造成 {pct}% 雷電傷害，持續 {sec} 秒', vfx: { projectile: 'orb-thunder', hit: 'hit-lightning', ground: 'ground-orbit-ring-lightning' }, status: { self: [{ id: 'sgThunderOrb' }] } }, { name: '強化雷球', unlock: { reinc: 0, lv: 600 }, cost: 40, fx: { pct: 30, pctPer: 3 }, goldBase: 1500000, goldGrow: 1.5, desc: '所有雷球與電球的雷電傷害額外 +{pct}%' }, { name: '伴生雷球', unlock: { reinc: 0, lv: 650 }, cost: 40, fx: { chance: 15, chancePer: 1.5, sec: 2 }, goldBase: 3000000, goldGrow: 1.5, desc: '環體電球命中時有 {chance}% 機率在該處生成一個靜止雷球，持續 {sec} 秒（每次作用只判定一次機率）', vfx: { hit: 'hit-lightning', field: 'lightning-orb-field' } }, { name: '雷殞天落', unlock: { reinc: 0, lv: 700 }, cost: 40, fx: { count: 2, pct: 300, pctPer: 30, sec: 3, m: 15 }, goldBase: 5000000, goldGrow: 1.5, desc: '額外召喚 {count} 個巨大雷球從天而降，各對 {m} 米內的敵人造成 {pct}% 雷電傷害，並以衝擊波擊暈 {sec} 秒', vfx: { attack: 'hit-thunderfall-impact', projectile: 'proj-thunderfall-sky', hit: 'hit-thunderfall-impact', ground: 'mark-blue' }, status: { enemy: [{ id: 'stun' }] } }], ult: [{ id: 'criticalThunderbolt', name: '臨界雷劫', cost: 300, fx: { count: 4, chanceMult: 2, pct: 50, pctPer: 5 }, goldBase: 10000000, goldGrow: 1.5, desc: '【伴生雷球】改為一次生成 {count} 顆、觸發機率 ×{chanceMult}，且所有雷球與電球的傷害額外 +{pct}%' }, { id: 'thunderBurst', name: '雷爆', cost: 300, fx: { chance: 15, chancePer: 0.15, bounces: 4, pct: 100, pctPer: 10, m: 12 }, goldBase: 10000000, goldGrow: 1.5, desc: '每次被雷球命中的敵人有 {chance}% 機率觸發 1 顆小型雷球，在附近 {m} 米範圍內彈射 {bounces} 次，每次造成 {pct}% 雷電傷害', vfx: { hit: 'hit-lightning' } }, { id: 'thunderfallShatter', name: '雷殞天地碎', cost: 300, fx: { scale: 50, pct: 200, pctPer: 20, gap: 1 }, goldBase: 10000000, goldGrow: 1.5, desc: '【雷殞天落】的雷殞石體積增大 {scale}%、傷害額外 +{pct}%，並額外每 {gap} 秒不斷再降下 1 顆' }] },
  icearrow: { name: '寒冰箭', emoji: '❄️', range: '', dmgType: 'magic', elem: 'ice', cd: 15, cost: 40, tiers: [{ name: '寒冰箭', unlock: { reinc: 0, lv: 450 }, cost: 40, fx: { pct: 250, pctPer: 25, count: 2, castM: 30, deg: 15, speed: 58.5 }, goldBase: 100000, goldGrow: 1.5, desc: '朝前方射出 {count} 支寒冰箭，每支箭夾角 {deg} 度（射程 {castM} 米、飛行速度 {speed} 米／秒），每支對 1 個敵人造成 {pct}% 寒冰傷害', vfx: { cast: 'cast-magic', projectile: 'proj-icearrow-frost', hit: 'hit-icearrow-shatter' } }, { name: '寒霜箭', unlock: { reinc: 0, lv: 500 }, cost: 40, fx: { frostPct: 50, frostPctPer: 5, stacks: 1 }, goldBase: 200000, goldGrow: 1.5, desc: '被寒冰箭擊中的敵人附加 {stacks} 層寒霜狀態：每跳造成寒冰箭傷害 {frostPct}% 的寒冰傷害，每層使移動與攻速下降，疊滿層數時凍結', status: { enemy: [{ id: 'sgFrost' }, { id: 'sgFrostBite' }, { id: 'sgFrozen' }, { id: 'stun' }] } }, { name: '冰系強化', unlock: { reinc: 0, lv: 550 }, cost: 40, fx: { pct: 100, pctPer: 10 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化寒冰箭，額外 +{pct}% 寒冰傷害（與第 1 階累加）' }, { name: '貫穿冰箭', unlock: { reinc: 0, lv: 600 }, cost: 40, fx: { m: 10, mPer: 2 }, goldBase: 800000, goldGrow: 1.5, desc: '寒冰箭改為貫穿攻擊，貫穿路徑上的所有敵人，貫穿長度 {m} 米（不足以打到主目標時自動延長到主目標）', vfx: { projectile: 'proj-icearrow-frost', hit: 'hit-icearrow-shatter' } }, { name: '冰箭散射', unlock: { reinc: 0, lv: 650 }, cost: 40, fx: { add: 1, addPer: 0.1 }, goldBase: 1500000, goldGrow: 1.5, desc: '射出的寒冰箭數量額外 +{add} 支（不足 1 支的部分以機率觸發）' }, { name: '寒霜凍結', unlock: { reinc: 0, lv: 700 }, cost: 40, fx: { stacks: 1, stacksPer: 0.4 }, goldBase: 3000000, goldGrow: 1.5, desc: '寒冰箭射中帶寒霜狀態的敵人時，立即再疊 {stacks} 層寒霜，並造成該敵人寒霜剩餘的全部寒冰傷害（不足 1 層的部分以機率觸發）' }, { name: '寒冰爆裂箭', unlock: { reinc: 0, lv: 750 }, cost: 40, fx: { pct: 400, pctPer: 40, sec: 6, waves: 3, waveGap: 0.3, gap: 0.1, m: 6, chaseM: 30, bodyM: 1.5 }, goldBase: 5000000, goldGrow: 1.5, desc: '寒冰爆裂箭連射 {waves} 波，每波間隔 {waveGap} 秒；寒冰箭變為追蹤冰箭，在 {chaseM} 米內來回穿梭追擊敵人 {sec} 秒（碰到才算一次命中）；敵人的凍結結束時產生冰爆，對其周圍 {m} 米內的所有敵人造成 {pct}% 寒冰傷害', vfx: { attack: 'burst-icearrow-crystal', hit: 'hit-ice', ground: 'ground-icearrow-frost' } }], ult: [{ id: 'absoluteZeroBurst', name: '極寒冰爆', cost: 300, fx: { waves: 10, waveGap: 0.35, pct: 50, pctPer: 5 }, goldBase: 10000000, goldGrow: 1.5, desc: '【寒冰爆裂箭】改為每 {waveGap} 秒連射 {waves} 波，且寒冰箭傷害額外 +{pct}%' }, { id: 'infiniteIceRift', name: '無限冰裂', cost: 300, fx: { sec: 0.1, count: 4, countPer: 0.4 }, goldBase: 10000000, goldGrow: 1.5, desc: '寒冰箭每造成 1 次傷害就使寒冰箭的冷卻時間 -{sec} 秒，且每次發射的寒冰箭數量額外 +{count} 支（不足 1 支的部分以機率觸發）' }, { id: 'tearsOfIce', name: '冰之淚', cost: 300, fx: { waves: 10, pct: 200, pctPer: 20, gap: 0.35, m: 30 }, goldBase: 10000000, goldGrow: 1.5, desc: '施放寒冰箭時同時召喚 {waves} 波寒冰箭雨從天射下（每波間隔 {gap} 秒），每波對我方 {m} 米內的所有敵人造成 {pct}% 寒冰傷害', vfx: { projectile: 'proj-icearrow-frost', hit: 'hit-icearrow-shatter' } }] },
  waterball: { name: '水流彈', emoji: '💧', range: '', dmgType: 'magic', elem: 'ice', cd: 15, cost: 40, tiers: [{ name: '水流彈', unlock: { reinc: 0, lv: 500 }, cost: 40, fx: { pct: 200, pctPer: 20, castM: 30, speed: 57.96, m: 6, arcM: 8 }, goldBase: 100000, goldGrow: 1.5, desc: '朝敵人起飛時的座標拋出水彈（射程 {castM} 米、弧高 {arcM} 米），途中不追蹤；落地時對落點半徑 {m} 米內的所有敵人造成 {pct}% 寒冰傷害', vfx: { cast: 'cast-magic', projectile: 'proj-waterball-flow', hit: 'hit-waterball-splash' } }, { name: '寒冰逆轉', unlock: { reinc: 0, lv: 550 }, cost: 40, fx: { pct: 20, pctPer: 2, sec: 6 }, goldBase: 200000, goldGrow: 1.5, desc: '被水流彈擊中的敵人強制轉變為寒冰屬性，且受到的寒冰傷害 +{pct}%，持續 {sec} 秒', status: { enemy: [{ id: 'sgIceRevert' }] } }, { name: '寒流彈', unlock: { reinc: 0, lv: 600 }, cost: 40, fx: { frostPct: 50, frostPctPer: 20, stacks: 1 }, goldBase: 400000, goldGrow: 1.5, desc: '被水流彈擊中的敵人附加 {stacks} 層寒霜狀態：每跳造成水流彈傷害 {frostPct}% 的寒冰傷害', status: { enemy: [{ id: 'sgFrost' }, { id: 'sgFrostBite' }, { id: 'sgFrozen' }, { id: 'stun' }] } }, { name: '寒流爆散', unlock: { reinc: 0, lv: 650 }, cost: 40, fx: { bounce: 2, bouncePer: 0.2, m: 6 }, goldBase: 800000, goldGrow: 1.5, desc: '水流彈落地後再彈射 {bounce} 次（不足 1 次以機率觸發）；每次起飛重新鎖定敵人當下座標，途中不追蹤，落地造成半徑 {m} 米範圍傷害', vfx: { attack: 'burst-frost-nova', projectile: 'proj-waterball-flow', hit: 'hit-waterball-splash' } }, { name: '寒霜擴散', unlock: { reinc: 0, lv: 700 }, cost: 40, fx: { chance: 25, chancePer: 2.5, count: 1, m: 10 }, goldBase: 1500000, goldGrow: 1.5, desc: '寒霜狀態每次作用時有 {chance}% 機率擴散至目標 {m} 米內的 {count} 個敵人', vfx: { projectile: 'proj-ice-shard', hit: 'hit-ice' } }, { name: '三重流水', unlock: { reinc: 0, lv: 750 }, cost: 40, fx: { add: 1, addPer: 0.2 }, goldBase: 3000000, goldGrow: 1.5, desc: '朝隨機目標額外丟出 {add} 顆水流彈（不足 1 顆的部分以機率觸發）' }, { name: '水龍捲', unlock: { reinc: 0, lv: 800 }, cost: 40, fx: { count: 4, hits: 6, pct: 100, pctPer: 10, frozen: 2, gap: 0.35, m: 5, side: 10, sideWidth: 10 }, goldBase: 5000000, goldGrow: 1.5, desc: '額外在我方 {side}×{side} 米正方形的四個頂點召喚 {count} 道水龍捲（傷害半徑 {m} 米），每道造成連續 {hits} 段 {pct}% 寒冰傷害，且對凍結中的敵人傷害為 {frozen} 倍', vfx: { field: 'field-water-tornado' } }], ult: [{ id: 'waterPrisonFall', name: '水牢天瀑', cost: 300, fx: { atkRed: 50, vuln: 100, vulnPer: 10, sec: 6, m: 20 }, goldBase: 10000000, goldGrow: 1.5, desc: '施放水流彈時在周圍 {m} 米圍起一圈水牢獄：擋下由圈外射進來的遠程攻擊，圈內的敵人攻擊力 -{atkRed}%、受到的傷害 +{vuln}%，持續 {sec} 秒', status: { self: [{ id: 'sgWaterPrisonDomain' }], enemy: [{ id: 'atkDown' }, { id: 'sgWaterPrison' }] } }, { id: 'ragingTide', name: '怒海狂濤', cost: 300, fx: { need: 10, hits: 20, pct: 100, pctPer: 10, m: 20 }, goldBase: 10000000, goldGrow: 1.5, desc: '場上同時有 {need} 道水龍捲時，在它們的中央再生成 1 道巨大水龍捲，對 {m} 米內的所有敵人造成連續 {hits} 段 {pct}% 寒冰傷害', vfx: { ground: 'ground-tornado-water' } }, { id: 'abyssBurial', name: '海淵葬界', cost: 300, fx: { stacks: 10, stacksPer: 1, gap: 0.35, m: 30 }, goldBase: 10000000, goldGrow: 1.5, desc: '在周圍 {m} 米展開一道永久的水之領域：每 {gap} 秒對領域內的敵人施加寒霜狀態，且領域內的敵人可額外再疊 {stacks} 層寒霜', vfx: { hit: 'st-tick-ice' }, status: { self: [{ id: 'sgAbyssDomain' }] } }] },
  frostnova: { name: '冰霜新星', emoji: '🧊', range: '', dmgType: 'magic', elem: 'ice', cd: 15, cost: 40, tiers: [{ name: '冰霜新星', unlock: { reinc: 0, lv: 550 }, cost: 40, fx: { pct: 150, pctPer: 5, stacks: 2, frostPct: 50, castM: 12, m: 12 }, goldBase: 100000, goldGrow: 1.5, desc: '對周圍 {m} 米內的敵人釋放冰霜新星，造成 {pct}% 寒冰傷害並附加 {stacks} 層寒霜狀態（寒霜每跳造成新星傷害 {frostPct}% 的寒冰傷害）', vfx: { cast: 'cast-magic', attack: 'burst-frost-nova', hit: 'hit-ice' }, status: { enemy: [{ id: 'sgFrost' }, { id: 'sgFrostBite' }, { id: 'sgFrozen' }, { id: 'stun' }] } }, { name: '冰霜衝擊', unlock: { reinc: 0, lv: 600 }, cost: 40, fx: { pct: 50, pctPer: 5, castM: 13, castMPer: 0.6, m: 13, mPer: 0.6 }, goldBase: 200000, goldGrow: 1.5, desc: '冰霜新星的範圍擴展至 {m} 米，且寒冰傷害額外 +{pct}%' }, { name: '寒冰體', unlock: { reinc: 0, lv: 650 }, cost: 40, fx: { stacks: 1 }, goldBase: 400000, goldGrow: 1.5, desc: '施放冰霜新星後的 6 秒內，攻擊你的敵人有 25% 機率被附加 {stacks} 層寒霜狀態', vfx: { hit: 'hit-ice' }, status: { self: [{ id: 'sgFrostbody' }] } }, { name: '極致寒霜', unlock: { reinc: 0, lv: 700 }, cost: 40, fx: { dmgPct: 40, dmgPctPer: 4, durPct: 40, durPctPer: 4 }, goldBase: 800000, goldGrow: 1.5, desc: '所有來源的寒霜狀態傷害提高 {dmgPct}%，且持續時間增加 {durPct}%', vfx: { attack: 'burst-frost-freeze', hit: 'hit-ice' } }, { name: '三重新星', unlock: { reinc: 0, lv: 750 }, cost: 40, fx: { add: 1, addPer: 0.1, m: 3 }, goldBase: 1500000, goldGrow: 1.5, desc: '冰霜新星的施放次數額外 +{add} 次，且每次釋放的範圍再 +{m} 米（不足 1 次的部分以機率觸發）' }, { name: '死亡新星', unlock: { reinc: 0, lv: 800 }, cost: 40, fx: { chance: 35, chancePer: 6.5 }, goldBase: 3000000, goldGrow: 1.5, desc: '帶寒霜狀態的敵人死亡時有 {chance}% 機率再釋放 1 次冰霜新星' }, { name: '暴風雪', unlock: { reinc: 0, lv: 850 }, cost: 40, fx: { pct: 100, pctPer: 10, sec: 8, gap: 0.4, side: 24, sideWidth: 24 }, goldBase: 5000000, goldGrow: 1.5, desc: '額外召喚 1 道暴風雪籠罩天空，對 {side}×{side} 米範圍內的敵人每 {gap} 秒造成 {pct}% 寒冰傷害，暴風雪跟隨我方移動，持續 {sec} 秒', vfx: { ground: 'ground-blizzard' } }], ult: [{ id: 'infiniteNova', name: '無限新星', cost: 300, fx: { pct: 50, pctPer: 5, gap: 1 }, goldBase: 10000000, goldGrow: 1.5, desc: '每隔 {gap} 秒自動施放 1 次冰霜新星（不扣法力、不進冷卻），且冰霜新星傷害額外 +{pct}%' }, { id: 'crystalResonance', name: '極致之冰', cost: 300, fx: { pct: 200, pctPer: 20, gap: 0.4, m: 8 }, goldBase: 10000000, goldGrow: 1.5, desc: '凍結中的敵人形成冰晶共鳴：每 {gap} 秒對相距 {m} 米內的其他凍結敵人造成 {pct}% 寒冰傷害', vfx: { projectile: 'proj-ice-shard', hit: 'hit-ice' } }, { id: 'iceKingDomain', name: '冰皇領域', cost: 300, fx: { scale: 50, min: 2, max: 8, hits: 4, pct: 200, pctPer: 20, gap: 1, m: 8 }, goldBase: 10000000, goldGrow: 1.5, desc: '暴風雪的範圍擴大 {scale}%，且每 {gap} 秒在範圍內隨機 {min}～{max} 個目標的地面昇起冰錐，每根冰錐對周圍 {m} 米內的敵人造成連續 {hits} 段 {pct}% 寒冰傷害', vfx: { ground: 'ground-tornado-water' } }] },
  windblade: { name: '風刃', emoji: '🍃', range: '4*8', dmgType: 'magic', elem: 'wind', cd: 15, cost: 40, tiers: [{ name: '風刃', unlock: { reinc: 0, lv: 600 }, cost: 40, fx: { pct: 200, pctPer: 20, castM: 30, speed: 18, m: 80 }, goldBase: 100000, goldGrow: 1.5, desc: '朝前方射出一道弧形風刃（射程 {castM} 米、飛行速度 {speed} 米/秒），貫穿飛行路徑 {m} 米上的所有敵人，各造成 {pct}% 風系傷害', vfx: { cast: 'cast-magic', projectile: 'proj-wind-crescent', hit: 'hit-wind' } }, { name: '巨型風刃', unlock: { reinc: 0, lv: 650 }, cost: 40, fx: { size: 30, sizePer: 3 }, goldBase: 200000, goldGrow: 1.5, desc: '風刃的體積 +{size}%（判定範圍與特效同步放大）' }, { name: '雙重風刃', unlock: { reinc: 0, lv: 700 }, cost: 40, fx: { pct: 30, pctPer: 30 }, goldBase: 400000, goldGrow: 1.5, desc: '同時向前方與後方各射出一道風刃，且風刃傷害額外 +{pct}%（與第 1 階累加）' }, { name: '亂披風', unlock: { reinc: 0, lv: 750 }, cost: 40, fx: { pct: 30, pctPer: 3, deg: 30, lenM: 3, widthM: 6 }, goldBase: 800000, goldGrow: 1.5, desc: '風刃射出時同時朝其一側 {deg} 度發射 1 道小型風刃（體積 {lenM}×{widthM} 米、同樣貫穿全場），造成原風刃 {pct}% 的傷害', vfx: { projectile: 'proj-wind-crescent', hit: 'hit-wind' } }, { name: '追跡風刃', unlock: { reinc: 0, lv: 800 }, cost: 40, fx: { sec: 4, secPer: 0.3, gap: 0.1, chaseM: 30 }, goldBase: 1500000, goldGrow: 1.5, desc: '小型風刃不再向前射出，改為在 {chaseM} 米內隨機追擊敵人 {sec} 秒，對路徑上的所有敵人造成傷害（碰到才算一次命中）', vfx: { hit: 'hit-wind', ground: 'ground-homing-wind-crescent' } }, { name: '狂風碎裂', unlock: { reinc: 0, lv: 850 }, cost: 40, fx: { move: 60, pct: 50, gap: 0.6, gapPer: -0.03, m: 6 }, goldBase: 3000000, goldGrow: 1.5, desc: '風刃命中的敵人移動速度 -{move}%；風刃並在飛行途中每 {gap} 秒對半徑 {m} 米內的敵人造成風刃 {pct}% 的傷害（不含小型風刃）', vfx: { attack: 'burst-wind', hit: 'hit-wind' }, status: { enemy: [{ id: 'sgWindSlow' }] } }, { name: '暴風真空刃', unlock: { reinc: 0, lv: 900 }, cost: 40, fx: { pct: 40, pctPer: 40, count: 2, directions: 4, gap: 0.2 }, goldBase: 5000000, goldGrow: 1.5, desc: '改為朝前後左右 {directions} 個方向各連續射出 {count} 道風刃（每道間隔 {gap} 秒，小型風刃同步發射），且風刃傷害額外 +{pct}%' }], ult: [{ id: 'stormMyriad', name: '暴風萬刃', cost: 300, fx: { pct: 50, pctPer: 5, add: 1, sec: 4, chaseM: 60 }, goldBase: 10000000, goldGrow: 1.5, desc: '大型風刃改為在 {chaseM} 米內持續追擊敵人 {sec} 秒，【暴風真空刃】每個方向再多射出 {add} 道風刃，且風刃傷害額外 +{pct}%', vfx: { hit: 'hit-wind', ground: 'ground-homing-wind-crescent' } }, { id: 'stormMountain', name: '嵐之山', cost: 300, fx: { pct: 100, pctPer: 10, directions: 4, scale: 100 }, goldBase: 10000000, goldGrow: 1.5, desc: '【暴風真空刃】改為把該次所有大型與小型風刃融合，朝 {directions} 個方向各射出 1 道體積 +{scale}% 的巨型風刃，每道傷害為所融合風刃總和的 {pct}%', vfx: { projectile: 'proj-wind-crescent', hit: 'hit-wind' } }, { id: 'skyCollapse', name: '天穹崩裂', cost: 300, fx: { chance: 20, pct: 50, pctPer: 5 }, goldBase: 10000000, goldGrow: 1.5, desc: '風刃改為被動技能：受到攻擊時有 {chance}% 機率朝攻擊者射出一道風刃，且其傷害額外 +{pct}%' }] },
  vacuumslash: { name: '真空斬', emoji: '🌀', range: '', dmgType: 'magic', elem: 'wind', cd: 15, cost: 40, tiers: [{ name: '真空斬', unlock: { reinc: 0, lv: 650 }, cost: 40, fx: { pct: 250, pctPer: 25, count: 3, castM: 6, m: 6 }, goldBase: 100000, goldGrow: 1.5, desc: '朝前方 {m} 米範圍內的 {count} 名敵人揮出一道真空斬擊，造成 {pct}% 風系傷害', vfx: { cast: 'cast-magic', attack: 'slash-wind-crescent', hit: 'hit-wind' } }, { name: '真空爆震', unlock: { reinc: 0, lv: 700 }, cost: 40, fx: { hits: 1, hitsPer: 0.1 }, goldBase: 200000, goldGrow: 1.5, desc: '真空斬會爆發出震波，額外造成 {hits} 次傷害（不足 1 次的部分以機率觸發）', vfx: { attack: 'burst-vacuum-shockwave' } }, { name: '風切', unlock: { reinc: 0, lv: 750 }, cost: 40, fx: { cutPct: 50, cutPctPer: 5, move: 80, hit: 50, sec: 4, gap: 0.5 }, goldBase: 400000, goldGrow: 1.5, desc: '被真空斬擊中的敵人附加風切狀態：移動速度 -{move}%、命中率 -{hit}%，且每 {gap} 秒受到真空斬傷害 {cutPct}% 的風系傷害，持續 {sec} 秒', status: { enemy: [{ id: 'sgWindRend' }, { id: 'sgWindCut' }] } }, { name: '真空迴旋', unlock: { reinc: 0, lv: 800 }, cost: 40, fx: { pct: 30, pctPer: 3, m: 6 }, goldBase: 800000, goldGrow: 1.5, desc: '真空斬改為對自身周圍 {m} 米內的所有敵人造成傷害，且造成的傷害額外 +{pct}%', vfx: { attack: 'slash-wind-spin', hit: 'hit-wind' } }, { name: '真空三重奏', unlock: { reinc: 0, lv: 850 }, cost: 40, fx: { add: 2, addPer: 0.2, m: 6 }, goldBase: 1500000, goldGrow: 1.5, desc: '迴旋斬額外連續施展 {add} 次，每次的範圍再擴大 {m} 米（不足 1 次的部分以機率觸發）' }, { name: '無限風切', unlock: { reinc: 0, lv: 900 }, cost: 40, fx: { stacks: 3, pct: 50, pctPer: 5 }, goldBase: 3000000, goldGrow: 1.5, desc: '風切狀態可堆疊至 {stacks} 層，每多 1 層使風切每跳額外造成 {pct}% 的風系傷害' }, { name: '虛空斬', unlock: { reinc: 0, lv: 950 }, cost: 40, fx: { pct: 400, pctPer: 40, count: 4, sec: 6, rps: 1, m: 6, bodyM: 6, growM: 4 }, goldBase: 5000000, goldGrow: 1.5, desc: '額外斬出 {count} 道虛空斬擊：以自身為中心從半徑 {m} 米起每秒擴大 {growM} 米、{count} 道皆順時針繞行 {rps} 圈，對碰到的敵人造成 {pct}% 風系傷害，持續 {sec} 秒', vfx: { attack: 'burst-wind', projectile: 'orb-void-disc', hit: 'hit-wind', ground: 'ground-orbit-ring-wind' }, status: { self: [{ id: 'sgVoidBlade' }] } }], ult: [{ id: 'vacuumOmen', name: '萬象風劫', cost: 300, fx: { chance: 15, chancePer: 1.5, pct: 100, sec: 3, grow: 2, gap: 0.25 }, goldBase: 10000000, goldGrow: 1.5, desc: '真空斬命中時有 {chance}% 機率在該處留下一道靜止的真空斬：持續 {sec} 秒、半徑隨時間擴大為 {grow} 倍，對碰到的敵人造成 {pct}% 風系傷害', vfx: { hit: 'hit-wind', ground: 'ground-homing-wind-crescent' } }, { id: 'voidAnnihilation', name: '虛空滅界', cost: 300, fx: { pct: 100, pctPer: 10, gap: 2 }, goldBase: 10000000, goldGrow: 1.5, desc: '每 {gap} 秒自動斬出 1 道【虛空斬】，且虛空斬傷害額外 +{pct}%' }, { id: 'spacetimeCollapse', name: '時空崩解', cost: 300, fx: { pct: 50, pctPer: 5, m: 12 }, goldBase: 10000000, goldGrow: 1.5, desc: '【虛空斬】不再向外擴展，改為全部固定在你周圍 {m} 米環繞，且持續時間額外 +{pct}%' }] },
  stormbarrier: { name: '暴風屏障', emoji: '🌪️', range: '', dmgType: 'magic', elem: 'wind', cd: 15, cost: 40, tiers: [{ name: '暴風屏障', unlock: { reinc: 0, lv: 700 }, cost: 40, fx: { shield: 1, shieldPer: 1, red: 10, redPer: 1, sec: 8, castM: 30, gap: 0.5 }, goldBase: 100000, goldGrow: 1.5, desc: '對自身施加暴風屏障：每 {gap} 秒獲得最大生命 {shield}% 的護盾，且傷害減免 +{red}%（乘算，只與風系類型的減免相加總），持續 {sec} 秒', status: { self: [{ id: 'sgStormBarrier' }] } }, { name: '暴風撕裂', unlock: { reinc: 0, lv: 750 }, cost: 40, fx: { pct: 50, pctPer: 5, m: 8 }, goldBase: 200000, goldGrow: 1.5, desc: '暴風屏障每次作用時，對自身半徑 {m} 米內的敵人造成 {pct}% 風系傷害', vfx: { hit: 'hit-wind', ground: 'ground-storm-rip' } }, { name: '亂風切', unlock: { reinc: 0, lv: 800 }, cost: 40, fx: { count: 1, countPer: 0.1 }, goldBase: 400000, goldGrow: 1.5, desc: '暴風屏障每次作用時，對周圍的 {count} 個敵人附加風切狀態（不足 1 個的部分以機率觸發）', vfx: { hit: 'hit-wind' }, status: { enemy: [{ id: 'sgWindRend' }, { id: 'sgWindCut' }] } }, { name: '暴風之刃', unlock: { reinc: 0, lv: 850 }, cost: 40, fx: { chance: 15, chancePer: 1.5 }, goldBase: 800000, goldGrow: 1.5, desc: '暴風屏障作用中受到傷害時，有 {chance}% 機率射出 1 道貫穿風刃（【風刃】第 1 階的效果，不含其後續進化）', vfx: { projectile: 'proj-wind-crescent', hit: 'hit-wind' } }, { name: '風切擴散', unlock: { reinc: 0, lv: 900 }, cost: 40, fx: { count: 1, countPer: 0.1, m: 10 }, goldBase: 1500000, goldGrow: 1.5, desc: '風切狀態結束後擴散至 {m} 米內的 {count} 個敵人（不足 1 個的部分以機率觸發）', vfx: { projectile: 'proj-wind-crescent', hit: 'hit-wind' } }, { name: '颶風屏障', unlock: { reinc: 0, lv: 950 }, cost: 40, fx: { shield: 2, shieldPer: 0.2 }, goldBase: 3000000, goldGrow: 1.5, desc: '暴風屏障每次作用時額外獲得最大生命 {shield}% 的護盾（與第 1 階相加）' }, { name: '暴風神體', unlock: { reinc: 0, lv: 1000 }, cost: 40, fx: { red: 99, sec: 2, secPer: 0.2, pct: 100, pctPer: 10 }, goldBase: 5000000, goldGrow: 1.5, desc: '施放暴風屏障時同時召喚風暴之神附體：{sec} 秒內傷害減免 +{red}%，且自身的風系傷害額外 ×(1+{pct}%)', status: { self: [{ id: 'sgStormGod' }] } }], ult: [{ id: 'valgrForce', name: '瓦爾格之力', cost: 300, fx: { sec: 50, secPer: 5, red: 0.1, redPer: 0.1, pct: 50, pctPer: 5 }, goldBase: 10000000, goldGrow: 1.5, desc: '召喚風之神祇降臨：【暴風神體】的持續時間 +{sec}%、傷害減免再 +{red}%，且自身風系傷害額外 +{pct}%' }, { id: 'skyfallStars', name: '天穹崩裂', cost: 300, fx: { min: 1, max: 3, maxPer: 0.3, pct: 400, pctPer: 40, gap: 2, m: 8 }, goldBase: 10000000, goldGrow: 1.5, desc: '每 {gap} 秒從天上落下 {min}～{max} 個召喚星體（巨大風刃／雷殞石／火殞石隨機，不足 1 個的部分以機率觸發），每個對落點 {m} 米內的敵人造成 {pct}% 傷害', vfx: { attack: 'burst-fire-shockwave', projectile: 'proj-meteor', hit: 'hit-fire-explosion', ground: 'mark-red' } }, { id: 'myriadPhenomena', name: '森羅萬象', cost: 300, fx: { pct: 50, pctPer: 5 }, goldBase: 10000000, goldGrow: 1.5, desc: '施放暴風屏障時同時打出【暴風真空刃】與【虛空斬】，且這兩者的傷害額外 +{pct}%', vfx: { attack: 'burst-wind', projectile: 'orb-void-disc', hit: 'hit-wind', ground: 'ground-orbit-ring-wind' } }] }
};

/* ---- 執行期狀態（絕不掛 G＝保證不入存檔） ----
   由 js/skills.js 的 resetSkillRT() 鏈結重置（比照 resetLegendaryRT），
   重置時機（開戰／死亡／讀檔／塔戰進出）與舊系統完全一致。 */
var SKILL2_RT = null;
function resetSkill2RT() {
  if (SKILL2_RT && SKILL2_RT.lastStand && SKILL2_RT.lastStand.pEnt) delete SKILL2_RT.lastStand.pEnt._sgRevival;
  /* 先把「跟隨 RT 的增益」從實體上撤掉再清狀態：RT 是權威、增益只是投影，
     兩者不同步時玩家會在狂怒早已結束後仍帶著圖示與增益值（死亡復活保留同一個
     戰鬥實體、提前離塔亦然；cleanse 只清減益，不會動到它）。 */
  /* 增益容器以效果鍵索引，而施加哪一個狀態由 Skills2「我方狀態」欄決定，所以回收一律照角色的鍵撤掉。 */
  if (SKILL2_RT && SKILL2_RT.rage) sgDropRoleBuffs(SKILL2_RT.rage.pEnt, ['bloodrage']);
  if (SKILL2_RT && SKILL2_RT.frenzy) sgDropRoleBuffs(SKILL2_RT.frenzy.pEnt, ['frenzyCrit']);
  if (SKILL2_RT && SKILL2_RT.rock) sgDropRoleBuffs(SKILL2_RT.rock.pEnt, ['rockArmor', 'rockAmp']);
  /* 超神【金剛不壞】的生命上限倍率是 RT 的投影：RT 一被清掉那個 +50% 就該消失，
     但屬性是快取的——不主動作廢的話會一路留到下一次換裝才被重算（tickSkill2 的
     到期回收是另一半）。 */
  if (SKILL2_RT && SKILL2_RT.rock && typeof markStatsDirty === 'function') markStatsDirty();
  if (SKILL2_RT && SKILL2_RT.barrier) sgDropRoleBuffs(SKILL2_RT.barrier.pEnt, ['stormBarrier', 'stormGod']);
  /* 超神【戰神屠錄】的疊層增益設計為「持續到死亡為止」，狀態表因此給了一個
     單場戰鬥走不完的持續時間——回收的唯一時機就是這裡（死亡／讀檔／進出塔）。
     少了這一段，玩家死一次之後那疊層會原封不動帶進下一場。 */
  if (SKILL2_RT && SKILL2_RT.warGod) sgDropRoleBuffs(SKILL2_RT.warGod.pEnt, ['warGodKill']);
  /* 超神【地爆天星】的倒數狀態同樣是 RT 的投影：排程被清掉之後那個倒數就是假的，
     不撤掉的話玩家會看著一個永遠不會落下的倒數（死亡復活保留同一個戰鬥實體、提前離塔亦然）。 */
  if (SKILL2_RT && SKILL2_RT.starfall) sgDropRoleBuffs(SKILL2_RT.starfall.pEnt, ['starfall']);
  /* 超神【永恒超導體】的疊層增益同樣是「持續到死亡為止」（狀態表給了一個單場戰鬥
     走不完的持續時間），回收的唯一時機就是這裡——比照【戰神屠錄】。 */
  if (SKILL2_RT && SKILL2_RT.superconduct) sgDropRoleBuffs(SKILL2_RT.superconduct.pEnt, ['superconduct']);
  // 以玩家為中心的領域狀態（火神降臨、海淵葬界…）：只撤掉自己掛上去的那幾個
  if (SKILL2_RT && SKILL2_RT.domains) {
    for (var dRole in SKILL2_RT.domains) {
      if (Object.prototype.hasOwnProperty.call(SKILL2_RT.domains, dRole)) sgDropRoleBuffs(SKILL2_RT.domains[dRole], [dRole]);
    }
  }
  SKILL2_RT = {
    storm: null, // 暴風之舞化身狀態：{ until, nextAt, gap, tgt }（tgt 為當前衝鋒目標實體）
    projectiles: [], // 飛出斬擊／貫穿突刺的執行期飛行物（不入存檔）
    galeStrikes: [], // 疾風斬逐段結算，換場時隨 Runtime 重建
    thunderLaunches: [], // 每道落雷到發動時才選敵，換場隨 Runtime 清除
    waterballs: [], // 固定落點水彈：起飛與落地分開處理，落地才查詢敵人
    meteors: [], // 殞石落地佇列：{ at, victims, burnSpec, ... }（不入存檔）
    grounds: [], // 地板場域（火龍捲／火牆）的執行期實例（不入存檔）
    groundSeq: 0, // 給顯示層辨識同一道持續場域；不入存檔
    orbitSeq: 0,  // 同一拍多次火狩施放亦各有獨立身份；不入存檔
    orbits: [], // 環繞場域（火狩）的執行期實例：釘在玩家身上、持續旋轉（不入存檔）
    rage: null,  // 嗜血狂怒爆發狀態：{ until, pEnt, killCombo }（pEnt＝施放時的玩家實體，
                 // 供血飲術反噬定位；killCombo＝期間擊殺累積的連擊數加成，結束歸零）
    frenzy: null, // 狂暴之舞狀態：{ until, pEnt, levels }
    rock: null,  // 岩甲術狀態：{ until, pEnt, base }（base＝施放當下的護盾總量＝T6／T7 的分母）
    barrier: null, // 暴風屏障狀態：{ until, pEnt, nextAt, gap, floatSel }（nextAt＝下一拍護盾／撕裂的時刻）
    ultAuto: {},  // 超神進化的自動施放節拍：{ <群組id>: 下一次自動施放的時刻 }（不入存檔）
    earthguardVfxAt: 0,
    bloodDomain: { venomAt: 0 }, // 血刃斬永久領域的節拍：萬毒的作用時刻（不入存檔）
    domains: {},     // 領域狀態的持有者：{ 角色: pEnt }——掛上去的才由我們撤掉（見 sgSyncDomainStatus）
    deathDefer: null, // 傳奇【不屈之誓】的延後死亡：{ until }（不入存檔）
    counter: null,   // 反擊的累計器：{ hits, oath, wrath, holy, loss[] }
                     // warBody＝超神【戰神體】的分段失血與返還狀態（不入存檔）
    lastStand: null, // 超神【不屈鬥魂】復甦排程（不入存檔）
    warGod: null,    // 超神【戰神屠錄】疊層增益的持有者：{ pEnt }
                     // ——那個增益「持續到死亡為止」，狂怒本身早就回收了也還在，
                     // 所以得另外記住掛在誰身上，resetSkill2RT 才收得回來
    asuraFist: 0,    // 超神【阿修羅霸王拳】的下一次發動時刻（不入存檔）
    starfall: null,  // 超神【地爆天星】的落下排程：{ at, fallSec, warned, dropped, pEnt }（不入存檔）
    hunt: null,      // 火狩兩個節拍型傳奇的時刻：{ launchAt, ampAt }（【伴生併發】【烈火狩】，不入存檔）
    fireGodAt: 0,    // 超神【火神降臨】領域的下一拍時刻（不入存檔）
    rockHeartAt: 0,  // 傳奇【大地之心】的內部冷卻到期時刻（不入存檔）
    rebirth: null,   // 超神【逆轉乾坤】累積的復活次數：{ charges }（不入存檔）
    rebirthInvuln: 0, // 【天地共生】給的那一段無敵的到期時刻（傳奇【不滅意志】只延長這一段）
    ultRepeat: {},   // 超神「持續 N 秒內每 gap 秒自動再施放 1 次」的節拍：
                     // { <群組id>: { until, nextAt, gap } }（【天地雷鎖陣】【永恒雷獄】，不入存檔）
    superconduct: null, // 超神【永恒超導體】疊層增益的持有者：{ pEnt }
                        // ——那個增益「持續到死亡為止」，所以得另外記住掛在誰身上（比照 warGod）
    flyThunder: null,   // 超神【飛雷神】的放電期：{ until, nextAt }（不入存檔）
    tribulationAt: 0, // 超神【雷霆天劫】那道永久雷電的下一拍時刻（不入存檔）
    thunderfallAt: 0, // 超神【雷殞天地碎】那串不斷落下的雷殞石的下一拍時刻（不入存檔）
    waterPrison: null, // 超神【水牢天瀑】的水牢：{ until, radius, atkRed, vuln, nextAt, floatSel }（不入存檔）
    tideArmed: true,   // 超神【怒海狂濤】的邊緣觸發旗標：水龍捲道數跌回門檻以下才重新武裝（不入存檔）
    abyssAt: 0,        // 超神【海淵葬界】領域的下一拍時刻（不入存檔）
    infiniteNovaAt: 0, // 超神【無限新星】自動施放的下一次時刻（不入存檔）
    resonanceAt: 0,    // 超神【極致之冰】冰晶共鳴的下一拍時刻（不入存檔）
    iceKingAt: 0,      // 超神【冰皇領域】昇起冰錐的下一拍時刻（不入存檔）
    voidAnnihilateAt: 0, // 超神【虛空滅界】自動斬出虛空斬的下一次時刻（不入存檔）
    skyfallAt: 0        // 超神【天穹崩裂】召喚星體落下的下一次時刻（不入存檔）
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
/* 當階消耗不是累加；表格留白／0 代表免費。UI 傳入快照，模擬端省略參數讀 G。 */
function skills2TierManaCost(gid, tierIdx, ultId) {
  var g = SKILLS2[gid];
  if (!g) return 0;
  var row = ultId ? (g.ult || []).filter(function (u) { return u.id === ultId; })[0] : g.tiers[tierIdx];
  return Math.max(0, Number(row && row.cost) || 0);
}
function skills2ManaCost(gid, lvs, ultRaw) {
  var g = SKILLS2[gid];
  if (!g || skills2IsPassive(gid)) return 0;
  if (!lvs) {
    lvs = skills2Levels(gid);
    ultRaw = typeof G !== 'undefined' && G.player && G.player.skills2 ? G.player.skills2.ult : null;
  }
  var u = sgEffectiveUlt(ultRaw, gid, lvs);
  if (u) return skills2TierManaCost(gid, 0, u.id);
  for (var i = g.tiers.length - 1; i >= 0; i--) if (lvs[i] > 0) return skills2TierManaCost(gid, i);
  return 0;
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
/* 「被超神進化改為被動技能」的查表。這一支是全專案唯一的判定入口。
     cleave／天霸風神斬     ：改由 sgTickUltAutoCast 每 N 秒自動施放
     windblade／天穹崩裂    ：沒有節拍，觸發時機是受到攻擊（sgSkyCollapseOnPlayerDamaged）
   ⚠️ 用「群組 → 選項 id」的查表而不是逐一 sgUlt(gid, id)：暴風屏障也有一個叫
   【天穹崩裂】的超神（設計文檔如此命名，id 是 skyfallStars），只比對 id 的寫法
   遲早會被下一個同名選項踩到——那會讓暴風屏障安靜地退出主動輪替。 */
var SG_ULT_PASSIVE = { cleave: 'stormGodSlash', windblade: 'skyCollapse' };
function skills2ActsPassive(gid) {
  if (skills2IsPassive(gid)) return true;
  var id = SG_ULT_PASSIVE[gid];
  return !!(id && sgUlt(gid, id));
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

/* 「次數／個數 +N」型傳奇規格的取值：值放在 LEGENDARY_FX_NON_VALUE_KEYS 的保護鍵裡
   （count／hits／sec…），沒有裝備該特效時規格物件不存在＝回 0。
   收斂成一支的理由：這種讀法在施放端會重複十幾次，各自寫一串 Math.max(0, Math.floor(...))
   遲早會有一處漏掉取整或漏掉 null 保護。 */
function sgLegendCount(spec, key) {
  if (!spec) return 0;
  return Math.max(0, Math.floor(Number(spec[key || 'count']) || 0));
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
function sgRange(range, lv) {
  var parts=String(range||'').split(','), shape=/^\s*(\d+(?:\.\d+)?)\s*\*\s*(\d+(?:\.\d+)?)\s*$/;
  var base=parts[0].match(shape), per=parts.length>1?parts[1].match(/^\s*([+-]?\d+(?:\.\d+)?)\s*\*\s*([+-]?\d+(?:\.\d+)?)\s*$/):null;
  if(!base)return {length:0,width:0};
  var level=Math.max(1,Number(lv)||1);
  return {length:Number(base[1])+(per?Number(per[1])*level:0),width:Number(base[2])+(per?Number(per[2])*level:0)};
}

// 原有直接讀取底值的幾何路徑也必須吃到逗號後的每級增量。
// 只有配置表 fx 物件會算等級；已解析的事件／場域副本保持原值，避免重複成長。
var SG_GEOMETRY_OWNERS = null, SG_GEOMETRY_SOURCE = null;
function sgGeometryNumber(fx, key) {
  if(!fx)return 0;
  if(!Number(fx[key+'Per']))return Number(fx[key])||0;
  if(!SG_GEOMETRY_OWNERS || SG_GEOMETRY_SOURCE!==SKILLS2){
    SG_GEOMETRY_SOURCE=SKILLS2;SG_GEOMETRY_OWNERS=new WeakMap();
    Object.keys(SKILLS2).forEach(function(gid){
      var g=SKILLS2[gid];
      (g.tiers||[]).forEach(function(t,i){if(t.fx)SG_GEOMETRY_OWNERS.set(t.fx,{gid:gid,tier:i});});
      (g.ult||[]).forEach(function(t){if(t.fx)SG_GEOMETRY_OWNERS.set(t.fx,{gid:gid,id:t.id});});
    });
  }
  var owner=SG_GEOMETRY_OWNERS.get(fx);
  if(!owner)return Number(fx[key])||0;
  var lv;
  if(owner.id){var u=skills2Ult(owner.gid);lv=u&&u.def&&u.def.id===owner.id?u.lv:1;}
  else lv=skills2Levels(owner.gid)[owner.tier];
  return sgVal(fx,key,lv);
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

/* ===========================================================================
   技能附加狀態（Skills2「我方狀態／敵方狀態」欄；2026-09-18 狀態表格化）
   ---------------------------------------------------------------------------
   每一列（階或超神選項）可帶 row.status = { self: [條目], enemy: [條目] }：
     self   我方狀態：施放（被動技能＝觸發）時套在自己身上
     enemy  敵方狀態：這個技能命中敵人時附加
   條目＝{ id: 狀態ID, <參數>: 數字或本列效果參數的鍵名 }，參數：
     val 效果數值／dmg 狀態傷害／dur 持續秒數／gap 作用間隔／max 層數上限／
     chance 機率%／stacks 一次疊幾層
   鍵名以本列目前等級取值（sgVal：底值＋增量×等級），因此跟著升級成長。
   唯一來源：config/CSV/Skills2.csv 的「我方狀態」「敵方狀態」欄（tools/config_tables.cjs 回寫）。

   ---- 兩種條目 ----
   1. 登記位置（SKILL2_STATUS_SLOTS）：技能原有的施加點。觸發時機與數值公式仍由技能邏輯決定
      （例：血刃斬的流血＝技能傷害 × dotPct%），表格決定「施加哪一個狀態」；條目上填的參數
      覆寫公式算出的同名欄位。每個位置帶一個角色（role）：後續各階查詢「敵人身上有沒有流血」
      一律問角色，角色的狀態＝所有登記為該角色的格子裡填的狀態——換掉格子裡的狀態，後續各階跟著換。
   2. 超出登記數量的條目（附加條目）：我方＝施放時、敵方＝本技能每次命中時（sgHitOne）。
      沒有登記的列，整格都是附加條目。

   ---- 計時類狀態 ----
   火狩、環體電球、虛空斬、暴風化身、地爆天星等「技能持續期間」的狀態也登記在表上
   （使用者原則 2026-09-18：除了飛行子彈，有持續時間的效果都是狀態）。這些技能本身仍由
   SKILL2_RT 計時，狀態只是投影給玩家看的剩餘時間，因此換成別的狀態只影響顯示與該狀態的效果鍵。
   傳奇特效施加的狀態由裝備決定，不屬於 Skills2 的任何一列，仍寫在各自的施加點。

   ---- 狀態自己的效果 vs. 技能對狀態的額外效果 ----
   狀態表說明裡寫的效果（泥沼緩速的攻速／移速下降、寒冰逆轉的屬性改寫、寒霜的緩速…）
   跟著狀態的效果鍵走，仍以鍵讀取；技能各階與傳奇「對帶著某狀態的敵人」的額外效果
   （虛弱、爆燃、火焰增幅、泥沼中的增傷、凍結冰爆…）一律以角色查詢，跟著表格上填的狀態走。

   ---- 登記表格式 ----
   鍵＝'<群組ID>.<階數或超神ID>.<self|enemy>'，值＝依格子內順序的位置陣列：
     role    角色（查詢用；可跨列共用，例：火球與火龍捲的「燃燒」）
     effect  必要的狀態效果類型（選填）：後續機制需要讀持續傷害實例或疊層數時才限制，
             tools/config_tables.cjs 同步時據此擋下型別不符的狀態
     label   給編表者看的位置說明（參數表「欄位定義」頁自動列出）
   本字面值同時被 tools/config_tables.cjs 讀取（驗證與說明頁），必須維持純資料。 */
var SKILL2_STATUS_SLOTS = {
  'thrust.phantomOcta.self': [{ role: 'phantomDodge', label: '施放突刺後的絕對閃避' }],
  'thrust.shadowExecutioner.enemy': [{ role: 'soulRend', label: '突刺命中疊層' }],
  'cleave.5.enemy': [{ role: 'cleaveStun', label: '斬擊機率擊暈' }],
  'knife.deathReaper.self': [{ role: 'deathReaper', label: '飛刀擊殺時疊層' }],
  'gale.5.self': [{ role: 'gale', label: '施放時的攻速提升' }],
  'bloodblade.1.enemy': [{ role: 'bleed', effect: 'dot', label: '流血' }],
  'bloodblade.4.enemy': [{ role: 'poison', effect: 'dot', label: '中毒' }],
  'bloodblade.slayerDomain.self': [{ role: 'slayerMark', label: '領域內敵人死亡時疊層' },
    { role: 'slayerDomain', effect: 'stat', label: '領域本身（跟著玩家；持續特效依領域半徑縮放）' }],
  'bloodblade.venomDomain.self': [{ role: 'venomDomain', effect: 'stat', label: '領域本身（跟著玩家；持續特效依領域半徑縮放）' }],
  'bloodblade.venomDomain.enemy': [{ role: 'venomField', label: '領域內每拍疊層' }],
  'dualdance.4.self': [{ role: 'frenzyCrit', label: '爆擊率提升' }],
  'dualdance.5.self': [{ role: 'ironBleedSelf', label: '自身流血' }],
  'dualdance.5.enemy': [{ role: 'ironBleed', label: '周圍敵人流血' }],
  'dualdance.7.self': [{ role: 'storm', label: '暴風化身期間（化身本身由技能邏輯計時）' }],
  'dualdance.flameKagura.enemy': [{ role: 'kagura', label: '命中疊層灼燒' }],
  'counter.5.enemy': [{ role: 'armorBreak', label: '格擋時機率破甲' }],
  'counter.indomitable.self': [{ role: 'lastStandInvuln', label: '站姿升空復甦期間（由復甦狀態保護免死）' }],
  'bloodrage.1.self': [{ role: 'bloodrage', label: '狂怒' }],
  'bloodrage.warGodRoll.self': [{ role: 'warGodKill', label: '狂怒期間擊殺疊層' }],
  'bloodrage.asuraFist.self': [{ role: 'asuraFist', label: '定時爆發' }],
  'fireball.2.enemy': [{ role: 'burn', effect: 'dot', label: '燃燒' }],
  'fireball.starfallCataclysm.self': [{ role: 'starfall', label: '距離下一顆超巨型殞石落下的倒數' }],
  'fireball.6.self': [{ role: 'fireAmp', effect: 'stat', label: '燃燒作用時累加的火焰增幅' }],
  'firepillar.4.enemy': [{ role: 'burn', effect: 'dot', label: '機率燃燒' }],
  'rockarmor.1.self': [{ role: 'rockShield', label: '岩甲護盾' }, { role: 'rockArmor', label: '岩甲護盾存在期間的計時' }],
  'rockarmor.6.self': [{ role: 'rockAmp', effect: 'stat', label: '損失護盾累加的傷害增幅' }],
  'rockarmor.superRockArt.self': [{ role: 'petrifyDomain', effect: 'stat', label: '岩甲護盾存在期間的領域本身（持續特效依領域半徑縮放）' }],
  'rockarmor.gravityField.self': [{ role: 'gravityDomain', effect: 'stat', label: '岩甲護盾存在期間的領域本身（持續特效依領域半徑縮放）' }],
  'rockarmor.superRockArt.enemy': [{ role: 'petrifyLock', label: '石化的行動限制' }, { role: 'petrify', label: '石化' }],
  'rockarmor.gravityField.enemy': [{ role: 'stiffen', label: '僵化' }],
  'firehunt.1.self': [{ role: 'firehuntOrbit', label: '火狩環繞期間（火狩本身由技能邏輯計時）' }],
  'firehunt.fireGodDescend.self': [{ role: 'fireGodBody', effect: 'stat', label: '火焰纏身的領域本身（跟著玩家；持續特效依作用半徑縮放）' }],
  'mire.1.enemy': [{ role: 'mireSlow', effect: 'stat', label: '沼澤中持續重塗的緩速' }],
  'mire.3.enemy': [{ role: 'mirePoison', effect: 'dot', label: '沼澤毒性' }],
  'mire.7.enemy': [{ role: 'mireLava', effect: 'dot', label: '岩漿灼燒' }],
  'mire.plagueMire.enemy': [{ role: 'plague', effect: 'dot', label: '瘟疫' }],
  'mire.abyssInferno.enemy': [{ role: 'inferno', label: '改為火屬性的烙印' }],
  'earthguard.7.self': [{ role: 'rebirthInvuln', label: '復活後無敵' }],
  'chainlightning.eternalSuperconductor.self': [{ role: 'superconduct', label: '閃電鏈經過自身時疊層' }],
  'thunderstrike.5.enemy': [{ role: 'thunderStun', label: '衝擊波暈眩' }],
  'thunderorb.4.self': [{ role: 'thunderOrbit', label: '環體電球環繞期間（電球本身由技能邏輯計時）' }],
  'thunderorb.7.enemy': [{ role: 'thunderfallStun', label: '雷殞衝擊波暈眩' }],
  'icearrow.2.enemy': [{ role: 'frost', effect: 'stat', label: '寒霜層數與緩速' }, { role: 'frostBite', effect: 'dot', label: '寒霜凍傷' },
    { role: 'frozen', effect: 'stat', label: '疊滿時的凍結標記' }, { role: 'frozenLock', effect: 'ctrl', label: '凍結的行動限制' }],
  'waterball.2.enemy': [{ role: 'iceRevert', label: '改為寒冰屬性並提高寒冰受傷' }],
  'waterball.3.enemy': [{ role: 'frost', effect: 'stat', label: '寒霜層數與緩速' }, { role: 'frostBite', effect: 'dot', label: '寒霜凍傷' },
    { role: 'frozen', effect: 'stat', label: '疊滿時的凍結標記' }, { role: 'frozenLock', effect: 'ctrl', label: '凍結的行動限制' }],
  'waterball.waterPrisonFall.self': [{ role: 'waterPrisonDomain', effect: 'stat', label: '水牢本身（持續期間跟著玩家；持續特效依水牢半徑縮放）' }],
  'waterball.abyssBurial.self': [{ role: 'abyssDomain', effect: 'stat', label: '水之領域本身（跟著玩家；持續特效依領域半徑縮放）' }],
  'waterball.waterPrisonFall.enemy': [{ role: 'prisonAtkDown', label: '水牢內攻擊力下降' }, { role: 'waterPrison', label: '水牢內受到的傷害提高' }],
  'frostnova.1.enemy': [{ role: 'frost', effect: 'stat', label: '寒霜層數與緩速' }, { role: 'frostBite', effect: 'dot', label: '寒霜凍傷' },
    { role: 'frozen', effect: 'stat', label: '疊滿時的凍結標記' }, { role: 'frozenLock', effect: 'ctrl', label: '凍結的行動限制' }],
  'frostnova.3.self': [{ role: 'frostbody', label: '寒冰體（攻擊者機率被附加寒霜）' }],
  'windblade.6.enemy': [{ role: 'windSlow', label: '風刃命中緩速' }],
  'vacuumslash.3.enemy': [{ role: 'windRend', effect: 'stat', label: '風切層數與緩速' }, { role: 'windCut', effect: 'dot', label: '風切割裂' }],
  'vacuumslash.7.self': [{ role: 'voidBlade', label: '虛空斬繞行期間（斬擊本身由技能邏輯計時）' }],
  'stormbarrier.1.self': [{ role: 'stormBarrier', label: '暴風屏障' }],
  'stormbarrier.3.enemy': [{ role: 'windRend', effect: 'stat', label: '風切層數與緩速' }, { role: 'windCut', effect: 'dot', label: '風切割裂' }],
  'stormbarrier.7.self': [{ role: 'stormGod', label: '暴風神體' }]
};

/* 列：tierKey＝'1'..'7'（階）或超神選項 id。 */
function sgStatusRow(gid, tierKey) {
  var g = SKILLS2[gid];
  if (!g) return null;
  var n = Number(tierKey);
  if (n >= 1 && Math.floor(n) === n) return (g.tiers || [])[n - 1] || null;
  var ult = g.ult || [];
  for (var i = 0; i < ult.length; i++) if (ult[i] && ult[i].id === tierKey) return ult[i];
  return null;
}
function sgStatusEntries(gid, tierKey, side) {
  var row = sgStatusRow(gid, tierKey);
  var list = row && row.status && row.status[side];
  return Object.prototype.toString.call(list) === '[object Array]' ? list : [];
}
function sgStatusSlotDefs(gid, tierKey, side) {
  return SKILL2_STATUS_SLOTS[gid + '.' + tierKey + '.' + side] || [];
}
/* 格子裡第 idx 個條目（狀態表查無此 ID＝視為空格）。 */
function sgSlotEntry(gid, tierKey, side, idx) {
  var e = sgStatusEntries(gid, tierKey, side)[idx];
  return (e && e.id && typeof statusDef === 'function' && statusDef(e.id)) ? e : null;
}
function sgSlotSid(gid, tierKey, side, idx) {
  var e = sgSlotEntry(gid, tierKey, side, idx);
  return e ? e.id : '';
}

/* ---- 角色 → 狀態 ----
   同一幀會被查很多次（燃燒節拍器逐個敵人查），所以依 SKILLS2 物件快取；
   表格回寫會整頁重載，測試若就地改了 row.status 要呼叫 sgStatusSlotsReset。 */
var SG_STATUS_ROLE_CACHE = { src: null, roles: null, extras: null };
function sgStatusSlotsReset() { SG_STATUS_ROLE_CACHE = { src: null, roles: null, extras: null }; }
function sgStatusCache() {
  if (SG_STATUS_ROLE_CACHE.src === SKILLS2 && SG_STATUS_ROLE_CACHE.roles) return SG_STATUS_ROLE_CACHE;
  var roles = {}, key;
  for (key in SKILL2_STATUS_SLOTS) {
    if (!Object.prototype.hasOwnProperty.call(SKILL2_STATUS_SLOTS, key)) continue;
    var parts = key.split('.');
    var defs = SKILL2_STATUS_SLOTS[key];
    for (var i = 0; i < defs.length; i++) {
      var r = roles[defs[i].role] || (roles[defs[i].role] = { sids: [], keys: [], gid: parts[0] });
      var sid = sgSlotSid(parts[0], parts[1], parts[2], i);
      if (!sid || r.sids.indexOf(sid) >= 0) continue;
      r.sids.push(sid);
      var def = statusDef(sid);
      var bkey = (def.effect === 'shield') ? 'shield' : def.key;
      if (bkey && r.keys.indexOf(bkey) < 0) r.keys.push(bkey);
    }
  }
  /* 附加條目索引：沒有任何附加條目的群組，命中與施放時一次查表就結束（sgHitOne 是熱路徑）。 */
  var extras = {};
  for (var gid in SKILLS2) {
    if (!Object.prototype.hasOwnProperty.call(SKILLS2, gid)) continue;
    var g = SKILLS2[gid], rows = [], t;
    for (t = 0; t < (g.tiers || []).length; t++) rows.push(String(t + 1));
    for (t = 0; t < (g.ult || []).length; t++) if (g.ult[t]) rows.push(g.ult[t].id);
    ['self', 'enemy'].forEach(function (side) {
      for (var ri = 0; ri < rows.length; ri++) {
        if (sgStatusEntries(gid, rows[ri], side).length > sgStatusSlotDefs(gid, rows[ri], side).length) {
          (extras[gid] || (extras[gid] = {}))[side] = true;
          return;
        }
      }
    });
  }
  SG_STATUS_ROLE_CACHE = { src: SKILLS2, roles: roles, extras: extras };
  return SG_STATUS_ROLE_CACHE;
}
var SG_EMPTY_LIST = [];
/* 角色目前對應的所有狀態ID（跨列去重；格子全空＝空陣列）。 */
function sgRoleSids(role) {
  var r = sgStatusCache().roles[role];
  return r ? r.sids : SG_EMPTY_LIST;
}
/* 角色的代表狀態：登記表中第一個填了狀態的格子（讀狀態表預設值用）。 */
function sgRoleSid(role) { return sgRoleSids(role)[0] || ''; }
function sgRoleHasSid(role, sid) { return !!sid && sgRoleSids(role).indexOf(sid) >= 0; }
/* 角色狀態的效果鍵（增益容器 ent.buffs 以鍵索引；護盾固定為 shield）。 */
function sgRoleKeys(role) {
  var r = sgStatusCache().roles[role];
  return r ? r.keys : SG_EMPTY_LIST;
}
function sgRoleActive(ent, role) {
  if (!ent || typeof statusActive !== 'function') return false;
  var sids = sgRoleSids(role);
  for (var i = 0; i < sids.length; i++) if (statusActive(ent, sids[i])) return true;
  return false;
}
/* 角色狀態目前的效果值（多個狀態同時在身上就加總；讀增益容器，dot 不適用）。 */
function sgRoleBuffVal(ent, role) {
  if (!ent || typeof buffVal !== 'function') return 0;
  var keys = sgRoleKeys(role), sum = 0;
  for (var i = 0; i < keys.length; i++) sum += Math.max(0, buffVal(ent, keys[i]));
  return sum;
}
/* 延長角色狀態目前的實例（不重新計算數值），回傳延長後最晚的到期時刻（0＝身上沒有）。
   傳奇【不滅意志】延長天地共生給的那一段無敵就走這裡：那一段是哪個狀態由表格決定。 */
function sgRoleExtend(ent, role, sec) {
  var sids = sgRoleSids(role), until = 0;
  if (!ent || !(sec > 0)) return 0;
  for (var i = 0; i < sids.length; i++) {
    var def = statusDef(sids[i]);
    if (def.effect === 'ctrl') {
      if (ent.effects && ent.effects[def.key] > GT) {
        ent.effects[def.key] += sec;
        until = Math.max(until, ent.effects[def.key]);
      }
      continue;
    }
    var b = ent.buffs && ent.buffs[def.effect === 'shield' ? 'shield' : def.key];
    if (def.effect !== 'dot' && b && b.until > GT) {
      b.until += sec;
      until = Math.max(until, b.until);
    }
  }
  return until;
}
/* ---- 以玩家為中心的領域（2026-09-18 領域類光環）----
   使用者原則：除了飛行子彈，有持續時間的效果都是狀態——「展開一個永久持續的領域」就是持續時間永久的狀態。
   領域存在與否仍由技能邏輯決定（超神選項、裝配、RT 計時）；這裡讓代表它的狀態跟著在不在，並把權威半徑
   記在狀態實例上（vfxR），畫面交給狀態表的「持續特效」依半徑縮放、跟著玩家走（js/vfx-runtime.js syncStatuses）。
   dur 省略＝吃狀態表（永久領域填 99999，實際由這裡撤掉）。
   只撤自己掛上去的：格子被換成通用增益（例 atkUp）時，不能在領域不在的每一拍把別的來源的同名增益一起刪掉。 */
var SG_DOMAIN_SLOTS = {
  slayerDomain: { gid: 'bloodblade', tier: 'slayerDomain', idx: 1 },
  venomDomain: { gid: 'bloodblade', tier: 'venomDomain', idx: 0 },
  fireGodBody: { gid: 'firehunt', tier: 'fireGodDescend', idx: 0 },
  petrifyDomain: { gid: 'rockarmor', tier: 'superRockArt', idx: 0 },
  gravityDomain: { gid: 'rockarmor', tier: 'gravityField', idx: 0 },
  waterPrisonDomain: { gid: 'waterball', tier: 'waterPrisonFall', idx: 0 },
  abyssDomain: { gid: 'waterball', tier: 'abyssBurial', idx: 0 }
};
function sgSyncDomainStatus(pEnt, role, radiusPx, dur) {
  var slot = SG_DOMAIN_SLOTS[role];
  if (!pEnt || !slot || !(pEnt.hp > 0)) return;
  var sid = sgSlotSid(slot.gid, slot.tier, 'self', slot.idx);
  var def = sid ? statusDef(sid) : null;
  if (!def) return;
  var inst = (def.effect === 'stat' || def.effect === 'hot') ? (pEnt.buffs && pEnt.buffs[def.key]) : null;
  var want = dur > 0 ? GT + dur : 0;
  // 已經掛著、半徑沒變、到期時刻也對：不重塗（永久領域每一拍都會走到這裡）
  if (inst && inst.until > GT && inst.vfxR === radiusPx && (!want || Math.abs(inst.until - want) < 0.05)) return;
  sgApplySlot(pEnt, slot.gid, slot.tier, 'self', slot.idx, dur > 0 ? { dur: dur, vfxR: radiusPx } : { vfxR: radiusPx });
  SKILL2_RT.domains[role] = pEnt;
}
function sgEndDomainStatus(role) {
  var holder = SKILL2_RT && SKILL2_RT.domains && SKILL2_RT.domains[role];
  if (!holder) return;
  delete SKILL2_RT.domains[role];
  sgDropRoleBuffs(holder, [role]);
}
/* 撤掉角色狀態的增益實例（RT 被清掉時，投影出去的增益要跟著消失）。 */
function sgDropRoleBuffs(ent, roles) {
  if (!ent || !ent.buffs) return;
  for (var r = 0; r < roles.length; r++) {
    var keys = sgRoleKeys(roles[r]);
    for (var i = 0; i < keys.length; i++) if (keys[i] !== 'shield') delete ent.buffs[keys[i]];
  }
}
function sgRoleBuffActive(ent, role) {
  var keys = sgRoleKeys(role);
  for (var i = 0; i < keys.length; i++) if (sgBuffActive(ent, keys[i])) return true;
  return false;
}
/* 反查：某個狀態被登記成哪個角色（第一個命中者）。供 js/combat.js 的持續傷害歸屬使用。 */
function skills2StatusRoleOf(sid) {
  if (!sid) return null;
  var roles = sgStatusCache().roles;
  for (var role in roles) {
    if (Object.prototype.hasOwnProperty.call(roles, role) && roles[role].sids.indexOf(sid) >= 0) {
      return { role: role, gid: roles[role].gid };
    }
  }
  return null;
}
function skills2StatusRoleHas(role, sid) { return sgRoleHasSid(role, sid); }

/* ---- 條目參數 ---- */
/* 列目前的等級：階＝該階等級；超神選項＝選中時的等級，沒選中為 0。 */
function sgStatusRowLevel(gid, tierKey) {
  var n = Number(tierKey);
  if (n >= 1 && Math.floor(n) === n) return (skills2Levels(gid) || [])[n - 1] || 0;
  var u = skills2Ult(gid);
  return (u && u.id === tierKey) ? u.lv : 0;
}
/* 數字＝定值；字串＝本列效果參數的鍵名（依本列目前等級取值）；沒填回 undefined。 */
function sgStatusParam(entry, key, gid, tierKey) {
  var v = entry ? entry[key] : undefined;
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') return isFinite(v) ? v : undefined;
  var row = sgStatusRow(gid, tierKey);
  return (row && row.fx) ? sgVal(row.fx, String(v), sgStatusRowLevel(gid, tierKey)) : undefined;
}
/* 登記位置的參數（技能公式在施加前需要知道的值，例如寒霜一次疊幾層）。 */
function sgSlotParam(gid, tierKey, side, idx, key) {
  return sgStatusParam(sgSlotEntry(gid, tierKey, side, idx), key, gid, tierKey);
}
/* 技能自己擲機率的位置（斬擊擊暈、機率燃燒…）：格子填了 chance 就以格子為準，否則用技能公式的值。
   擲完後施加時帶 noChance，避免同一個機率被擲兩次。 */
function sgSlotChance(gid, tierKey, side, idx, fallback) {
  var v = sgSlotParam(gid, tierKey, side, idx, 'chance');
  return v === undefined ? fallback : v;
}

/* ---- 施加 ---- */
/* 敵方控場的共同門檻：BOSS 控場免疫與敵人韌性抗性（暈眩、石化、凍結全部走這裡）。 */
function sgCtrlBlocked(ent) {
  if (typeof isBossControlImmune === 'function' && isBossControlImmune(ent)) return true;
  return typeof resistCtrl === 'function' && typeof monsterDefCfg === 'function' &&
    !!resistCtrl(monsterDefCfg(ent));
}
/* 依條目施加一個狀態。spec＝技能公式算好的數值（{ dps, base, val, dur, interval, maxStacks, stats, source }，
   皆選填），條目參數覆寫同名欄位，兩者都沒有的欄位吃狀態表。
   回傳 applyStatus 的結果（ctrl 類為實際秒數；false／0＝沒生效）。 */
function sgApplyStatusEntry(ent, entry, gid, tierKey, side, spec) {
  if (!ent || !entry || typeof applyStatus !== 'function' || !(ent.hp > 0)) return false;
  var def = (typeof statusDef === 'function') ? statusDef(entry.id) : null;
  if (!def) return false;
  /* noChance＝技能自己已經擲過機率（格子的 chance 由呼叫端經 sgSlotChance 讀走），不再擲第二次。 */
  var ch = (spec && spec.noChance) ? undefined : sgStatusParam(entry, 'chance', gid, tierKey);
  if (ch !== undefined && !chance(ch)) return false;
  if (side === 'enemy' && def.effect === 'ctrl' && def.kind !== 'buff' && sgCtrlBlocked(ent)) return false;
  var ctx = {}, k, v;
  if (spec) for (k in spec) if (Object.prototype.hasOwnProperty.call(spec, k)) ctx[k] = spec[k];
  if ((v = sgStatusParam(entry, 'val', gid, tierKey)) !== undefined) ctx.val = v;
  if ((v = sgStatusParam(entry, 'dmg', gid, tierKey)) !== undefined) { ctx.dmg = v; delete ctx.dps; }
  if ((v = sgStatusParam(entry, 'dur', gid, tierKey)) !== undefined) ctx.dur = v;
  if ((v = sgStatusParam(entry, 'gap', gid, tierKey)) !== undefined) ctx.interval = v;
  if ((v = sgStatusParam(entry, 'max', gid, tierKey)) !== undefined) ctx.maxStacks = v;
  /* stacks：一次疊幾層（逐層施加，疊層規則由狀態表決定）。寒霜自己算層數，呼叫端以 oneStack 關掉。 */
  var times = (spec && spec.oneStack) ? 1 : Math.max(1, Math.floor(sgStatusParam(entry, 'stacks', gid, tierKey) || 1));
  var res = false;
  for (var i = 0; i < times; i++) {
    var r = applyStatus(ent, entry.id, ctx);
    if (r) res = r;
  }
  return res;
}
function sgApplySlot(ent, gid, tierKey, side, idx, spec) {
  return sgApplyStatusEntry(ent, sgSlotEntry(gid, tierKey, side, idx), gid, tierKey, side, spec);
}
/* 附加條目：群組各生效列超出登記數量的條目。
   我方在 castSkill2（被動＝觸發點）呼叫、敵方在 sgHitOne 呼叫。 */
function sgApplyExtraStatuses(ent, gid, side, spec) {
  var ex = sgStatusCache().extras[gid];
  if (!ex || !ex[side] || !ent || !(ent.hp > 0)) return;
  var g = SKILLS2[gid];
  var lvs = skills2Levels(gid) || [];
  for (var i = 0; i < g.tiers.length; i++) {
    if (lvs[i] > 0) sgApplyRowExtras(ent, gid, String(i + 1), side, spec);
  }
  var u = skills2Ult(gid);
  if (u) sgApplyRowExtras(ent, gid, u.id, side, spec);
}
function sgHasExtraStatuses(gid, side) {
  var ex = sgStatusCache().extras[gid];
  return !!(ex && ex[side]);
}
/* 本技能一次命中後的附加條目（敵方）。base＝這一下的技能傷害（未過防禦），
   持續傷害類以它換算（狀態表「傷害來源」＝skill 時）。sgHitOne 與不走 sgHitOne 的反擊共用。 */
function sgApplyHitStatuses(target, gid, base, st) {
  if (!target || !(target.hp > 0) || !sgHasExtraStatuses(gid, 'enemy')) return;
  sgApplyExtraStatuses(target, gid, 'enemy', { base: base, stats: st, source: sgStatusSource(gid) });
}
function sgApplyRowExtras(ent, gid, tierKey, side, spec) {
  var list = sgStatusEntries(gid, tierKey, side);
  for (var i = sgStatusSlotDefs(gid, tierKey, side).length; i < list.length; i++) {
    if (ent.hp > 0) sgApplyStatusEntry(ent, list[i], gid, tierKey, side, spec);
  }
}
/* 附加條目的持續傷害歸屬：記在施放它的技能底下（DPS 統計與戰鬥日誌）。 */
function sgStatusSource(gid) {
  var g = SKILLS2[gid];
  return { sourceKey: 'skill2:' + gid, sourceName: g ? g.name : gid,
    sourceLevel: sgTotalLevel(skills2Levels(gid) || []) };
}

/* ---- 群組傷害類型與屬性（表格欄位；未填＝物理、無屬性，維持既有八個武技群組的行為）---- */
function sgIsMagic(g) { return !!g && g.dmgType === 'magic'; }
/* 傷害基準屬性：魔法群組吃魔攻、其餘吃物攻。 */
function sgGroupBaseStat(g, st) {
  return sgIsMagic(g) ? (Number(st && st.matk) || 0) : (Number(st && st.atk) || 0);
}
/* 特效分類鍵（顏色與畫法）：與傷害類型同源，不另外設一欄。 */
function sgVfxCat(g) { return sgIsMagic(g) ? 'magic' : 'phys'; }

/* ---- 特效欄位（2026-09-03 VFX Preset 化）----
   每一階（tiers[i].vfx）與每一個超神選項（ult[i].vfx）各自持有一組角色 → preset id：
     { cast 施放, attack 攻擊本體, projectile 飛行物, hit 受擊, ground 地板, field 持續場域 }
   （唯一來源：config/CSV/Skills2.csv 的六個特效欄，由 config_tables.cjs 回寫）。
   發送端以 extra 標明「這一發屬於表上的哪一列」：
     vfxTier  1..7   第幾階引入的獨立效果（留白＝目前生效的最高階）
     vfxUlt   超神 id 超神選項那一列
     vfxGid   借用另一個群組的列（例：迴旋斬的傳奇【旋風劍舞】借真空斬第 4 階的真空迴旋畫面）
     vfxRoles 直接指定角色表（狀態每跳的作用特效由狀態表提供，見 statusVfxRoles）
   技能本體逐角色向前繼承；超神空欄從第七階找，不跨互斥選項。
   triggerVfx 只供明確指定該列的附加事件使用，角色留白不繼承。
   空物件代表整條鏈沒有特效，禁止退回舊版程式畫法。 */
function sgVfxRoles(gid, extra) {
  if (extra && extra.vfxRoles) return extra.vfxRoles;
  var sourceGid = (extra && extra.vfxGid) || gid;
  var g = SKILLS2[sourceGid];
  if (!g) return {};
  var tiers = g.tiers || [], roles = {}, selected = null;
  // 明確指定的獨立事件只讀本列觸發角色；空物件也代表已接線且不播放。
  var triggerRow = extra && (extra.vfxUlt || extra.vfxTier > 0)
    ? sgStatusRow(sourceGid, extra.vfxUlt || String(Math.floor(extra.vfxTier))) : null;
  if (!(extra && extra.vfxBase) && triggerRow && triggerRow.triggerVfx) {
    var triggerRoles = {};
    for (var role in triggerRow.triggerVfx) {
      var id = triggerRow.triggerVfx[role];
      if (typeof id === 'string' && id.trim()) triggerRoles[role] = id.trim();
    }
    return triggerRoles;
  }
  var tier = (extra && extra.vfxTier > 0) ? Math.floor(extra.vfxTier) : 0;
  if (extra && extra.vfxUlt) {
    var ult = g.ult || [];
    for (var i = 0; i < ult.length; i++) {
      if (ult[i] && ult[i].id === extra.vfxUlt) { selected = ult[i]; break; }
    }
    if (!selected) return roles;
    tier = tiers.length;
  } else {
    // 借用技能的獨立效果只讀指定階；不可套用被借用技能的玩家超神選擇。
    var active = sourceGid === gid && !(extra && extra.vfxBase) ? skills2Ult(gid) : null;
    if (active) selected = active.def;
    if (!tier) {
      var levels = skills2Levels(sourceGid);
      tier = 1;
      for (var li = 0; levels && li < tiers.length; li++) if (levels[li] > 0) tier = li + 1;
    }
  }
  var keys = ['cast', 'attack', 'projectile', 'hit', 'ground', 'field'];
  function overlay(row) {
    var vfx = row && row.vfx;
    if (!vfx || typeof vfx !== 'object') return;
    for (var k = 0; k < keys.length; k++) {
      var value = vfx[keys[k]];
      if (typeof value === 'string' && value.trim()) roles[keys[k]] = value.trim();
    }
  }
  // 已選超神的空欄必須由第七階繼承，即使呼叫端仍帶一般階級標記。
  if (selected) tier = tiers.length;
  for (var ti = 0; ti < Math.min(tier, tiers.length); ti++) {
    overlay(tiers[ti]);
  }
  overlay(selected);
  return roles;
}

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
  if (gid === 'cleave') {
    var levels = lvs || skills2Levels(gid);
    var legend = sgLegend('cleave');
    m = Math.max(m, levels[5] > 0 ? sgVal(g.tiers[5].fx,'m',levels[5]) : 0, Number(legend.cleaveFlyM) || 0);
    return bfMeterPx(m) * skills2CleaveRangeScale(levels);
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
   數值回傳對既有呼叫端相容（>0 為真、0 為假）。
   slot＝{ gid, tier, idx }：施加哪一個狀態由 Skills2「敵方狀態」該格決定（預設填 stun）；
   BOSS 免疫與韌性抗性由 sgApplyStatusEntry 對敵方控場一律把關。 */
function sgTryStun(target, sec, slot) {
  if (!target || target.hp <= 0 || !(sec > 0) || !slot) return 0;
  var applied = sgApplySlot(target, slot.gid, slot.tier, 'enemy', slot.idx || 0, { dur: sec, noChance: true });
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
  if (!sgHasDot(target, sgRoleSids('bleed'))) return 0;
  return sgVal(SKILLS2.bloodblade.tiers[2].fx, 'pct', lvs[2]);
}
/* 疊層型的「受到的傷害提高」：傳奇【千瘡百孔】與超神【暗影絕殺者】。
   兩者都是掛在敵人身上的增益鍵（值＝單層值 × 層數），因此直接讀 buffVal 即可，
   不必知道目前疊了幾層。 */
function skill2StackVulnPct(target) {
  if (!target || typeof buffVal !== 'function') return 0;
  return Math.max(0, buffVal(target, 'sgThrustVuln')) + Math.max(0, buffVal(target, 'sgSoulRend'));
}

/* 傳奇【震雷】：被落雷術擊中的敵人在「暈眩中」才吃這一份增傷。
   兩個條件都必須成立——雷痕（狀態）是「被落雷打過」的證明，暈眩是設計文檔寫明的前提。 */
function skill2ThunderQuakeVulnPct(target) {
  if (!target || typeof buffVal !== 'function') return 0;
  var pct = Math.max(0, buffVal(target, 'sgThunderQuake'));
  return (pct > 0 && sgIsStunned(target)) ? pct : 0;
}

function skill2VulnACfg(aCfg, target) {
  /* 「目標受到的傷害提高」目前有七個來源：血刃斬【虛弱】、泥沼術【虛弱／重力泥沼】、
     傳奇【千瘡百孔】、超神【暗影絕殺者】、傳奇【震雷】、超神【水牢天瀑】與傳奇【風蝕】。
     全部加算進同一個 totalDmgPct，收斂在這一支——呼叫端（普攻 doPlayerAttack ／
     新版技能 sgAtkCfg）不必逐一補判。 */
  var pct = skill2VulnPct(target) +
    ((typeof skill2MireVulnPct === 'function') ? skill2MireVulnPct(target) : 0) +
    skill2StackVulnPct(target) + skill2ThunderQuakeVulnPct(target) +
    /* 水牢與風蝕都沒有附加條件：狀態在身上就算數（與【震雷】要同時暈眩中不同）。 */
    ((typeof buffVal === 'function')
      ? Math.max(0, buffVal(target, 'sgWaterPrison')) + Math.max(0, buffVal(target, 'sgWindErode'))
      : 0);
  if (pct > 0) aCfg.totalDmgPct = (aCfg.totalDmgPct || 0) + pct;
  /* 只針對「某一個屬性」的受傷增幅走另一條路：水流彈【寒冰逆轉】的 +X% 寒冰傷害
     不能混進 totalDmgPct（那會連同一次攻擊的火／雷段一起放大）。
     本支同時服務普攻端（combat.js doPlayerAttack）與新版技能端（sgAtkCfg），
     因此兩邊都認得這個增幅，不必各補一次。 */
  if (typeof skill2IceAmpACfg === 'function') aCfg = skill2IceAmpACfg(aCfg, target);
  // 超神【超重岩之術】的石化：同樣是「只針對一個屬性」的受傷增幅，走同一條路
  if (typeof skill2PetrifyACfg === 'function') aCfg = skill2PetrifyACfg(aCfg, target);
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

/* 暴風亂舞化身是否仍在持續期間。 */
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
function skill2BloodfeastVfx(primary) {
  if (!skills2Equipped('bloodrage')) return null;
  var ult = skills2Ult('bloodrage');
  var p = sgCurrentPlayerEnt();
  var asuraActive = ult && ult.id === 'asuraFist' && p && buffVal(p, 'sgAsuraFist') > 0;
  if (!skill2RageActive() && !asuraActive) return null;
  var lvs = skills2Levels('bloodrage'), roles = {};
  function overlay(row) {
    var vfx = row && row.triggerVfx;
    ['attack', 'hit'].forEach(function (role) { if (vfx && vfx[role]) roles[role] = vfx[role]; });
  }
  for (var i=0; i<7; i++) if (lvs[i]>0) overlay(SKILLS2.bloodrage.tiers[i]);
  if (ult) overlay(ult.def);
  if (!roles.attack && !roles.hit) return null;
  var radius = bfMeterPx((typeof BF_MELEE_METERS === 'number' && BF_MELEE_METERS > 0) ? BF_MELEE_METERS : 5);
  var advent = sgUlt('bloodrage', 'slayerAdvent');
  if (advent) radius = Math.max(radius, bfMeterPx(sgUltVal(advent, 'm')));
  return { roles: roles, area: skill2RageActive() && (lvs[6]>0 || advent) ? sgAreaAround(primary, radius) : null };
}
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
  sgNetherMireOnDamaged(ent); // 泥沼術超神【黃泉沼】斬殺判定（只立旗標，斬殺在 tickSkill2）
}

/* 嗜血狂怒【血飲術】（T6）：期間範圍內的敵人每次受傷，你也付出一點生命；HP_lock 時免除代價。 */
function sgBloodrageBackfire(ent) {
  var lvs = skill2RageLevels();
  if (!lvs || lvs[5] < 1) return;
  var pEnt = SKILL2_RT.rage.pEnt;
  if (!pEnt || pEnt.hp <= 0) return;
  var fx = SKILLS2.bloodrage.tiers[5].fx;
  if (typeof bfPos === 'function' && bfPos(ent) && typeof bfEntityDistance === 'function' &&
      bfEntityDistance(ent) > bfMeterPx(sgGeometryNumber(fx, 'm') || 80)) return;
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
  if (typeof gmHpLockActive === 'function' && gmHpLockActive(pEnt)) return;
  var gmFloor = (typeof GM_TEST !== 'undefined' && GM_TEST && GM_TEST.god) ? 1 : 0;
  var hpBeforeRage = pEnt.hp;
  pEnt.hp = Math.max(gmFloor, pEnt.hp - selfDmg);
  sgWarGodBodyOnDamaged(hpBeforeRage - pEnt.hp, pEnt);
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

/* sid 可以是單一狀態ID，或角色的狀態ID陣列（sgRoleSids）——後者讓「敵人身上有沒有流血」
   跟著表格上填的狀態走。 */
function sgSidMatch(sid, want) {
  return typeof want === 'string' ? sid === want : !!(want && sid && want.indexOf(sid) >= 0);
}
function sgHasDot(ent, sid) {
  return !!sgFindDot(ent, sid);
}
function sgFindDot(ent, sid) {
  if (!ent || !ent.dots) return null;
  for (var i = 0; i < ent.dots.length; i++) {
    var d = ent.dots[i];
    if (d && sgSidMatch(d.sid, sid) && d.until > GT) return d;
  }
  return null;
}

/* 血刃斬的流血／中毒規格集中在這裡，供初次塗抹、屍爆傳染與零日感染傳染共用。
   零日感染的傷害加成直接乘在 dps，讓每跳傷害、剩餘傷害與後續傳染維持同一個數值。
   role＝'bleed'／'poison'（狀態角色）；實際施加哪一個狀態由 Skills2 第 1／4 階的「敵方狀態」決定。 */
function sgBloodbladeDotSpec(st, lvs, tiers, role) {
  var baseVal = st.atk * sgVal(tiers[0].fx, 'pct', lvs[0]) / 100;
  var zeroBonus = lvs[6] > 0 ? 1 + sgVal(tiers[6].fx, 'pct', lvs[6]) / 100 : 1;
  /* 傳奇【毒血祭】：造成的中毒與流血傷害提高（生命代價那半在 sgApplyBloodbladeDot）。
     與零日感染的加成相乘而不是相加——兩者是不同來源的獨立乘區。 */
  var rite = sgLegend('bloodblade').bloodVenomRite;
  var riteBonus = rite ? 1 + (Number(rite.pct) || 0) / 100 : 1;
  var disintegrate = sgUlt('bloodblade', 'disintegrate');
  var gapFactor = Math.max(0, 1 - sgUltVal(disintegrate, 'gapPct') / 100);
  if (role === 'bleed') {
    var bleedGap = Math.max(0.1, (Number(tiers[0].fx.dotGap) || 1) *
      (1 - (lvs[1] > 0 ? sgVal(tiers[1].fx, 'gapPct', lvs[1]) : 0) / 100) * gapFactor);
    return {
      dps: baseVal * sgVal(tiers[0].fx, 'dotPct', lvs[0]) / 100 * zeroBonus * riteBonus / bleedGap,
      dur: (Number(tiers[0].fx.dotSec) || 5) + (lvs[1] > 0 ? sgVal(tiers[1].fx, 'sec', lvs[1]) : 0),
      interval: bleedGap
    };
  }
  if (role === 'poison' && lvs[3] > 0) {
    var poisonGap = Math.max(0.1, (Number(tiers[3].fx.dotGap) || 0.5) * gapFactor);
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
     超神進化【崩解】：縮短間隔已在來源規格計算，傳染不得再次縮短
     傳奇【毒血祭】：每感染 1 個敵人付出自身生命
   保留完整持續狀態；爆炸由 tickStatuses 的實際結算觸發。
   role＝'bleed'／'poison'：流血填在第 1 階、中毒填在第 4 階的「敵方狀態」第一格。 */
var SG_BLOODBLADE_DOT_SLOTS = { bleed: '1', poison: '4' };
function sgApplyBloodbladeDot(ent, role, spec, dur, ctx) {
  if (!ent || !spec || !SG_BLOODBLADE_DOT_SLOTS[role]) return;
  sgBloodVenomRiteCost(role);
  var useDur = Math.max(0.2, Number(dur) || spec.dur);
  sgApplySlot(ent, 'bloodblade', SG_BLOODBLADE_DOT_SLOTS[role], 'enemy', 0,
    { dps: spec.dps, dur: useDur, interval: spec.interval });
}

/* 傳奇【毒血祭】：中毒每感染 1 個敵人就付出自身生命值。
   代價取「當下生命」的百分比並保底留 1 點——毒霧感染一次可以傳染好幾個，
   若取最大生命的固定比例或允許歸零，等於讓這個特效自殺。 */
function sgBloodVenomRiteCost(role) {
  if (role !== 'poison') return;
  var rite = sgLegend('bloodblade').bloodVenomRite;
  var pct = rite ? Math.max(0, Number(rite.hpPct) || 0) : 0;
  if (!(pct > 0)) return;
  var pEnt = sgCurrentPlayerEnt();
  if (!pEnt || !(pEnt.hp > 1)) return;
  if (typeof gmHpLockActive === 'function' && gmHpLockActive(pEnt)) return;
  var hpBeforeRite = pEnt.hp;
  pEnt.hp = Math.max(1, pEnt.hp - Math.max(1, Math.round(pEnt.hp * pct / 100)));
  sgWarGodBodyOnDamaged(hpBeforeRite - pEnt.hp, pEnt);
}

/* 崩解：每次實際跳傷後爆炸，基準為該狀態完整持續時間的總傷，不取剩餘時間。
   主目標可以剛被跳傷打死，仍從其位置爆炸；不再次扣主目標的持續傷害。 */
function sgQueueBloodFlight(from, target, extra, payload, ctx) {
  var roles = sgVfxRoles('bloodblade', extra);
  if (!roles.projectile) return false;
  var a = bfPos(from), b = bfPos(target);
  var speed = extra.vfxUlt ? sgUltVal(sgUlt('bloodblade', extra.vfxUlt), 'speed') : 0;
  speed = speed > 0 ? bfMeterPx(speed) : sgConfiguredFlightSpeed('bloodblade', extra.vfxTier || 1, SG_FLYING_PROJECTILE_SPEED);
  var travel = a && b ? Math.max(.05, Math.hypot(b.x-a.x,b.y-a.y)/speed) : Math.max(.05,sgConfiguredTravelSeconds('bloodblade',target));
  var area = a && b ? {bloodFlight:true,sourceX:a.x,sourceY:a.y,x:b.x,y:b.y} : null;
  sgEmitVfx('bloodblade',[target],ctx && ctx.floatSel || 'mv-float',{
    fxKind:'projectile',variant:'blood-flight',area:area,travelMs:[travel*1000],hit:false,
    vfxRoles:{projectile:roles.projectile}
  });
  SKILL2_RT.projectiles.push({bloodFlight:true,target:target,endAt:sgProjectileNow()+travel,
    payload:payload,roles:roles,floatSel:ctx && ctx.floatSel || 'mv-float'});
  if(payload.poison)target._sgPoisonFlightUntil=sgProjectileNow()+travel;
  return true;
}

function sgResolveBloodFlight(p, ctx) {
  var target=p.target;
  if (!target || target.hp<=0) return;
  if (ctx.getEnemies && ctx.getEnemies().indexOf(target)<0) return;
  var out={killed:false,dmg:0,crit:false};
  if(p.payload.damage>0) sgDerivedHit(target,p.payload.damage,'bloodblade',p.floatSel,out,'💥',0);
  if(target.hp>0 && p.payload.poison) {
    sgApplyBloodbladeDot(target,'poison',p.payload.poison,p.payload.poison.dur);
    target._sgDotSkipAt=GT;
  }
  sgEmitVfx('bloodblade',[target],p.floatSel,{fxKind:'burst',variant:'blood-arrival',preserveDeadTargets:true,
    vfxRoles:p.payload.poison ? {attack:p.roles.attack,hit:p.roles.hit} : {hit:p.roles.hit}});
  if(out.dmg && ctx.onDamage)ctx.onDamage(out.dmg);
  if(out.killed && ctx.onDeaths)ctx.onDeaths();
}

function sgDisintegrate(ent, sid, spec, dur, ult, ctx) {
  if (!ent) return;
  var total = Math.max(0, spec.dps * dur);
  if (typeof legendaryDotDamageMultiplier === 'function') total *= legendaryDotDamageMultiplier(ent);
  if (typeof skill2DotElemFactor === 'function') total *= skill2DotElemFactor(ent, sid);
  if (!(total > 0)) return;
  var floatSel = (ctx && ctx.floatSel) || 'mv-float';
  var out = (ctx && ctx.out) || { killed: false, dmg: 0, crit: false };
  var poison = sgRoleHasSid('poison', sid);
  var radius = bfMeterPx(sgUltVal(ult, 'm'));
  var roles = Object.assign({},sgVfxRoles('bloodblade',{vfxUlt:'disintegrate'}));
  delete roles.projectile;delete roles.hit;
  sgEmitVfx('bloodblade', [ent], floatSel, {
    fxKind: 'burst', variant: 'blood-explosion', elem: poison ? 'poison' : null,
    vfxRoles: roles, preserveDeadTargets: true, area: sgAreaAround(ent, radius)
  });
  var boom = total * sgUltVal(ult, 'pct') / 100;
  var enemies = (ctx && ctx.enemies) || null;
  if (!(boom > 0) || !enemies || !enemies.length) return;
  var victims = bfNearestOthers(ent, enemies, enemies.length, radius);
  for (var i = 0; i < victims.length; i++) {
    if(sgQueueBloodFlight(ent,victims[i],{vfxUlt:'disintegrate'},{damage:boom},ctx))continue;
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
  var specs = { bleed: sgBloodbladeDotSpec(st, lvs, tiers, 'bleed'),
    poison: sgBloodbladeDotSpec(st, lvs, tiers, 'poison') };
  var sourceBleed = sgFindDot(source, sgRoleSids('bleed'));
  var sourcePoison = sgFindDot(source, sgRoleSids('poison'));
  if (sourceBleed) sgApplyBloodbladeDot(target, 'bleed', sourceBleed, sourceBleed.until - GT);
  else sgApplyBloodbladeDot(target, 'bleed', specs.bleed);
  if (sourcePoison) sgApplyBloodbladeDot(target, 'poison', sourcePoison, sourcePoison.until - GT);
  else sgApplyBloodbladeDot(target, 'poison', specs.poison);
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
  var elem = gid === 'counter' && sgUlt('counter', 'indomitable') ? 'earth' : (elemOverride || (g && g.elem) || null);
  if (elem) aCfg.skillElem = elem;
  if (typeof skill2WindAmpACfg === 'function') aCfg = skill2WindAmpACfg(aCfg, pEnt);
  return skill2VulnACfg(aCfg, target);
}

/* 一次獨立命中（走完整 resolveHit 傷害管線：防禦、爆擊、格擋、護盾、敵種倍率）。
   回傳 resolveHit 結果；同時記錄浮字／DPS／輸出統計並更新 out。 */
function sgHitOne(pEnt, st, target, dmgVal, gid, floatSel, out, delayMs, bonusTotalPct, elemOverride, guaranteedHit) {
  if (!target || target.hp <= 0 || !(dmgVal > 0)) return null;
  var g = SKILLS2[gid];
  var atkCfg = sgAtkCfg(pEnt, st, dmgVal, target, bonusTotalPct, gid, elemOverride), defCfg = monsterDefCfg(target);
  if (guaranteedHit) { atkCfg.hit = 100; defCfg.dodge = 0; defCfg.absDodge = 0; }
  var res = resolveHit(pEnt, target, atkCfg, defCfg);
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
  if (!res.miss && SG_ULT_HIT_CDR[gid]) sgUltHitCdr(pEnt, gid);
  // Skills2「敵方狀態」的附加條目：本技能每次命中都附加（登記位置的條目由各技能自己的施加點處理）
  if (!res.miss) sgApplyHitStatuses(target, gid, dmgVal, st);
  return res;
}

/* ---- 超神「每造成 1 次傷害就把自己的冷卻往回扣」的共用掛點 ----
   目前唯一的使用者是寒冰箭【無限冰裂】。掛在 sgHitOne 而不是各形態各寫一次，
   是因為那是寒冰箭所有形態（單體／貫穿／追擊場域／冰爆／分裂箭）唯一的共同結算點；
   查表命中才進函式，沒有這種超神的群組只多一次物件查詢。 */
var SG_ULT_HIT_CDR = { icearrow: { id: 'infiniteIceRift', key: 'sec' } };
function sgUltHitCdr(pEnt, gid) {
  var spec = SG_ULT_HIT_CDR[gid];
  var u = sgUlt(gid, spec.id);
  if (!u) return;
  sgReduceSkillCooldownOnHit(pEnt, SG_PREFIX + gid, sgUltVal(u, spec.key));
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
  if (extra && typeof extra.hit === 'boolean') spec.hit = extra.hit;
  if (extra && extra.variant) spec.variant = extra.variant;
  if (extra && extra.travelMs) spec.travelMs = extra.travelMs;
  if (extra && extra.delayMs > 0) spec.delayMs = Number(extra.delayMs);
  if (extra && extra.preserveDeadTargets) spec.preserveDeadTargets = true;
  if (extra && extra.loopReturn) spec.loopReturn = true;
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
  /* 空角色表也必須送出，表示繼承鏈沒有特效，禁止顯示層自行補舊畫法。 */
  var roles = sgVfxRoles(gid, extra);
  if (roles) spec.vfx = roles;
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
  var speed = extra && Number(extra.speed) > 0 ? Number(extra.speed) : sgConfiguredFlightSpeed(gid, 1, SG_FLYING_PROJECTILE_SPEED);
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
    radialCurve: extra && extra.radialCurve || null,
    onStart: extra && extra.onStart || null,
    rehit: !(extra && extra.singleHit),
    waitForEnd: !!(extra && extra.waitForEnd),
    targetOnly: !!(extra && extra.targetOnly),
    rectangularBeam: !!(extra && extra.rectangularBeam),
    burnSpec: extra && extra.burnSpec || null,
    /* 傳奇【烈焰之心】對燃燒中敵人的增傷%，與傳奇【火池】爆點留下的火池規格。
       白名單式設定物件：沒有列在這裡的欄位不會被帶到飛行物上。 */
    burnBonusPct: extra && Number(extra.burnBonusPct) > 0 ? Number(extra.burnBonusPct) : 0,
    poolSpec: extra && extra.poolSpec || null,
    frostSpec: extra && extra.frostSpec || null,
    /* 寒冰箭的傳奇附加規格（【冰裂箭】的分裂箭與【深度凍結】的控場增傷）：
       貫穿段的每一次命中都要拿得到，因此掛在飛行物上而不是每次重算。 */
    iceSpec: extra && extra.iceSpec || null,
    victims: extra && extra.victims || null,
    splitTargets: extra && extra.splitTargets || null,
    splitDmgVal: extra && Number(extra.splitDmgVal) > 0 ? Number(extra.splitDmgVal) : 0,
    spreadPct: extra && extra.spreadPct || 0,
    spreadCount: extra && extra.spreadCount || 0,
    flightOrbit: extra && extra.flightOrbit || null,
    halfWidthPx: extra && Number(extra.halfWidthPx) > 0 ? Number(extra.halfWidthPx) : 0,
    /* 迴身四方斬的每道飛行物是 60 度扇形，距離隨飛行物推進而增長；
       coneBaseAngle／coneIndex 固定四個方向的歸屬，避免邊界敵人被重複命中。 */
    coneDeg: extra && Number(extra.coneDeg) > 0 ? Number(extra.coneDeg) : 0,
    coneBaseAngle: extra && isFinite(extra.coneBaseAngle) ? Number(extra.coneBaseAngle) : 0,
    coneIndex: extra && Number(extra.coneIndex) >= 0 ? Math.floor(Number(extra.coneIndex)) : -1,
    coneCount: extra && Number(extra.coneCount) > 0 ? Math.floor(Number(extra.coneCount)) : 0,
    stunChance: extra && extra.stunChance || 0,
    stunSec: extra && extra.stunSec || 0,
    stunSlot: (extra && extra.stunSlot) || null,
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
    slowSlot: (extra && extra.slowSlot) || null,
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
    sgTryStun(target, projectile.stunSec, projectile.stunSlot);
  }
  /* 命中時附加的減益（狂風碎裂的移速下降）：施加哪一個狀態由呼叫端指定的表格位置決定，
     因此不必為了一個減益再多寫一支 hitFn。 */
  if (projectile.slowSlot && projectile.slowPct > 0 && target.hp > 0) {
    sgApplySlot(target, projectile.slowSlot.gid, projectile.slowSlot.tier, 'enemy', projectile.slowSlot.idx || 0,
      { val: projectile.slowPct });
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
      area: { x: cx, y: cy, r: projectile.pulseRadius },
      vfxGid: 'windblade', vfxTier: 6
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
    if (projectile.tempestFlight) {
      var arrived=false, targetPoint=bfPos(projectile.target);
      if(projectile.position && targetPoint){
        var flightStep=projectileHomingStep(projectile.position,projectile.previousTarget,targetPoint,
          projectile.speed,Math.max(0,now-projectile.lastAt));
        projectile.position={x:flightStep.x,y:flightStep.y};
        projectile.previousTarget={x:targetPoint.x,y:targetPoint.y};projectile.lastAt=now;
        arrived=flightStep.hit;
      } else arrived=now>=projectile.endAt;
      if (arrived) { list.splice(pi, 1); sgResolveInfernoTempest(projectile, ctx); }
      continue;
    }
    if (projectile.counterHolyFlight) {
      if (now >= projectile.endAt) { list.splice(pi, 1); sgResolveCounterHolyOrb(projectile, ctx); }
      continue;
    }
    if (projectile.bloodFlight) {
      if(now>=projectile.endAt){list.splice(pi,1);sgResolveBloodFlight(projectile,ctx);}
      continue;
    }
    if (projectile.soulController) {
      if (sgTickSoulhunter(projectile, now, ctx)) {
        list.splice(pi, 1);
        sgFinishSkillCastFloat(projectile.out);
      }
      continue;
    }
    if (projectile.knifeFlight) {
      if (sgTickKnifeFlight(projectile, now, ctx)) {
        list.splice(pi, 1);
        sgFinishSkillCastFloat(projectile.out);
      }
      continue;
    }
    if (projectile.beginAt > now) continue;   // 尚未發射（延遲發射的後續幾道）
    if (!projectile.started && projectile.onStart) projectile.onStart(projectile, ctx);
    var distance = projectile.origin
      ? Math.min(projectile.length, Math.max(0, (now - projectile.startAt) * projectile.speed))
      : projectile.length;
    if (projectile.radialCurve) {
      distance = projectile.length * sgCleaveRadiusAt(projectile.radialCurve,
        (now - projectile.startAt) / (projectile.endAt - projectile.startAt));
    }
    var crossed;
    if (projectile.flightOrbit && projectile.origin) {
      // 掃過每拍實際旋轉弧，不拿中心直線代替；每段最多 7.5 度，避免低 tick 漏掉圓弧（8 米半徑時弦誤差 <0.18 世界單位）。
      var orbit = projectile.flightOrbit;
      var t0 = Math.max(0, (projectile.lastAt || projectile.startAt) - projectile.startAt);
      var t1 = Math.min(now - projectile.startAt, orbit.length / orbit.speed);
      var steps = Math.max(1, Math.ceil((t1 - t0) * Math.abs(orbit.spin) / (Math.PI / 24)));
      var previous = projectileOrbitPoint(orbit, t0);
      crossed = [];
      for (var oi = 1; oi <= steps; oi++) {
        var point = projectileOrbitPoint(orbit, t0 + (t1 - t0) * oi / steps);
        var dx = point.x - previous.x, dy = point.y - previous.y;
        var touched = bfSegmentTargets(previous, Math.atan2(dy, dx), 0, Math.hypot(dx, dy), enemies, projectile.halfWidthPx);
        for (var ti = 0; ti < touched.length; ti++) if (crossed.indexOf(touched[ti]) < 0) crossed.push(touched[ti]);
        previous = point;
      }
    } else if (projectile.rectangularBeam && projectile.origin) {
      var ux = Math.cos(projectile.angle), uy = Math.sin(projectile.angle);
      crossed = enemies.filter(function (e) {
        var pos = bfPos(e);
        if (!pos || !(e.hp > 0)) return false;
        var dx = pos.x - projectile.origin.x, dy = pos.y - projectile.origin.y;
        var along = dx * ux + dy * uy, across = Math.abs(-dx * uy + dy * ux);
        var ex = Math.max(0, -along, along - distance);
        var ey = Math.max(0, across - projectile.halfWidthPx);
        var r = bfEntityRadius(e);
        return ex * ex + ey * ey <= r * r;
      });
    } else if (projectile.radialCurve && projectile.origin && typeof bfEnemiesInArea === 'function') {
      crossed = bfEnemiesInArea({x:projectile.origin.x,y:projectile.origin.y,r:distance}, enemies);
      // 只掃過本 Tick 新擴張的環帶，已留在刀波內的敵人不會被補打。
      crossed = crossed.filter(function(e) {
        var pos = typeof bfPos === 'function' ? bfPos(e) : null;
        if (!pos || !projectile.started) return true;
        var dx=pos.x-projectile.origin.x, dy=pos.y-projectile.origin.y;
        var bodyR = typeof bfEntityRadius === 'function' ? bfEntityRadius(e) : 0;
        return Math.sqrt(dx*dx+dy*dy) + bodyR >= projectile.lastDistance;
      });
    } else if (projectile.origin && projectile.coneDeg > 0 && typeof bfConeTargets === 'function') {
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
   opts.repeat＝超神進化的重複施放（【天地雷鎖陣】【永恒雷獄】）：同樣不扣魔、不進冷卻，
   且不再重新起算重複節拍——否則第一次施放就會把自己續成無限迴圈。
   回傳 { killed, dmg, crit } 或 null（無法施放）。 */
function skills2DefensivePrecast(gid) {
  return gid === 'rockarmor' || gid === 'stormbarrier';
}
function castSkill2(pEnt, target, gid, floatSel, opts) {
  var g = SKILLS2[gid];
  if (!g || !skills2Castable(gid)) return null;
  if (skills2IsPassive(gid)) return null; // 被動群組（反擊）不可施放
  var st = getStats();
  var lvs = skills2Levels(gid);
  var storm = !!(opts && opts.storm);
  /* 兩種「不是玩家自己按下去」的施放共用同一組代價豁免：暴風之舞的化身與超神的重複施放。
     storm 仍單獨留著，因為雙刀亂舞另有「化身期間才生效」的分支要區分。 */
  var freeCast = storm || !!(opts && opts.repeat);
  var rawPool = Array.isArray(target)
    ? target.filter(function (e) { return e && e.hp > 0; })
    : ((target && target.hp > 0) ? [target] : []);
  /* 自身防禦只需敵人已生成；攻擊起手主目標必須在群組施法距離內（武技＝普攻近戰距離、魔法＝表定射程）；
     但 pool 必須保留完整敵群，讓貫穿、範圍擴散與周圍敵人等階段仍能命中射程外的目標。 */
  if (!rawPool.length) return null;
  var defensive = skills2DefensivePrecast(gid);
  var reachable = defensive ? rawPool : rawPool.filter(function (e) { return skills2CanReach(gid, e, lvs); });
  if (!reachable.length) return null;
  /* 防禦附帶攻擊仍排除進場中的敵人；其他技能保留完整存活敵群供後續幾何選取。 */
  var pool = defensive && typeof fieldCombatReady === 'function'
    ? rawPool.filter(fieldCombatReady) : rawPool;
  var primary = defensive ? reachable[0] : (typeof bfPickPrimary === 'function')
    ? bfPickPrimary(reachable, pEnt._lockTarget) : reachable[0];
  if (!primary) return null;

  var manaCost = skills2ManaCost(gid);
  if (!freeCast && pEnt.mp < manaCost && !(typeof gmMpLockActive === 'function' && gmMpLockActive(pEnt))) return null;
  if (!freeCast) {
    if (!(typeof gmMpLockActive === 'function' && gmMpLockActive(pEnt))) {
      pEnt.mp = Math.max(0, pEnt.mp - manaCost);
    }
    if (!pEnt.skillCds) pEnt.skillCds = {};
    pEnt.skillCds[SG_PREFIX + gid] = skills2Cooldown(gid, lvs, pEnt);
    sgArmUltRepeat(gid);
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
  // Skills2「我方狀態」的附加條目：每次施放（含自動施放）套在自己身上
  if (sgHasExtraStatuses(gid, 'self')) {
    sgApplyExtraStatuses(pEnt, gid, 'self', { stats: st, source: sgStatusSource(gid) });
  }
  if (!freeCast && typeof recordRunSkillCast === 'function') {
    recordRunSkillCast(g.name, 'skill2:' + gid, sgTotalLevel(lvs));
  }
  if (!freeCast && typeof floatPlayerSkillCast === 'function') {
    var skillFloat = { emoji: g.emoji, name: g.name };
    if (out._pendingProjectiles > 0) {
      out._skillFloatPending = { floatSel: floatSel, skill: skillFloat };
    } else {
      floatPlayerSkillCast(floatSel, skillFloat, out.dmg);
    }
  }
  if (typeof blog === 'function' && !freeCast) {
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
  /* 超神【暗影絕殺者】：命中堆疊靈魂撕裂（每層使該敵人受到的傷害提高；狀態由該超神列「敵方狀態」決定）。 */
  if (cfg.soulRend && target.hp > 0) {
    sgApplySlot(target, 'thrust', 'shadowExecutioner', 'enemy', 0, {
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
  var baseRange = sgRange(g.range, lvs[0]);
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

  /* 變體沿用既有名稱；本體尺寸和行進距離由獨立欄位傳遞。 */
  var thrustVariant = octaSingle ? 'thrust-pierce'
    : (isEightWay ? 'thrust-octagonal' : (isParallel ? 'thrust-parallel' :
      (lvs[5] > 0 ? 'thrust-pierce' : 'thrust')));
  // 每波一則事件；出手延遲和執行期飛行物共用，平行／八方向在同一波同步。
  var thrustWaveGap = SG_MULTI_ATTACK_GAP_SEC;
  var thrustVisualTier = 1;
  for (var vi = 0; vi < lvs.length; vi++) if (lvs[vi] > 0) thrustVisualTier = vi + 1;
  for (var wave = 0; wave < thrustCount; wave++) {
    sgEmitVfx('thrust', planned, floatSel, {
      fxKind: 'slash', variant: thrustVariant, count: 1, projectile: isPiercing,
      dur: 0.3, delayMs: Math.round(wave * thrustWaveGap * 1000),
      angle: geomOk ? baseAngle : undefined,
      lineLength: lineLen, lineWidth: lineWidth, laneOffsets: laneOffsets,
      bodyLength: laneHalfWidth * 2 * 4,
      travelMs: [Math.max(50, lineLen / sgConfiguredFlightSpeed('thrust', 1, SG_THRUST_PROJECTILE_SPEED) * 1000)],
      directionCount: directionCount, vfxTier: thrustVisualTier
    });
  }

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
  if (ultPhantom) {
    sgApplySlot(pEnt, 'thrust', 'phantomOcta', 'self', 0, {
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
            beginSec: pr * thrustWaveGap, speed: sgConfiguredFlightSpeed('thrust', 1, SG_THRUST_PROJECTILE_SPEED),
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
        var res = sgHitOne(pEnt, st, hitTargets[ti], dmgVal, 'thrust', floatSel, out, Math.round(r * thrustWaveGap * 1000));
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
    fxKind: 'slash', variant: 'wind-spin', elem: 'wind', dur: 0.35,
    vfxGid: 'vacuumslash', vfxTier: 4
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
    hits: cfg.hits, gap: cfg.gap, hitElem: 'wind',
    vfxUlt: 'windChaser'
  });
}

/* 迴旋斬的「命中之後」掛鉤：直接命中與飛出斬擊兩條路徑共用（同突刺的理由）。 */
function sgCleaveOnHit(cfg, target, res, ctx) {
  if (!target || !res || res.miss) return;
  if (cfg.tornado) sgCleaveTornado(cfg.pEnt, cfg.st, cfg.tornado, target, cfg.floatSel);
}

// 刀波與製作工具共用配置曲線；進度以權威起飛／抵達時間正規化。
function sgCleaveRadiusAt(curve, progress) {
  var p = Math.max(0, Math.min(1, progress));
  for (var i = 1; i < curve.length; i++) {
    if (p <= curve[i][0]) {
      var a = curve[i - 1], b = curve[i];
      return a[1] + (b[1] - a[1]) * (p - a[0]) / (b[0] - a[0]);
    }
  }
  return curve[curve.length - 1][1];
}

function sgCastCleave(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers, lg = sgLegend('cleave');
  var ultVoid = sgUlt('cleave', 'voidShatter'), ultWind = sgUlt('cleave', 'windChaser');
  if (lg.cleavePull && typeof bfPullEnemies === 'function') {
    bfPullEnemies(pool, bfMeterPx(Number(lg.cleavePull.m) || 0), bfMeterPx(Number(lg.cleavePull.toM) || 0));
  }
  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[2] > 0) pct += sgVal(t[2].fx, 'pct', lvs[2]);
  if (ultVoid && lvs[6] > 0) pct += sgUltVal(ultVoid, 'pct');
  pct += Number(lg.skillDamagePct) || 0;
  var dmgVal = st.atk * pct / 100;
  if (lvs[6] > 0) dmgVal *= 1 + sgVal(t[6].fx, 'pct', lvs[6]) / 100;
  var slashes = 1;
  if (lvs[3] > 0) slashes += sgRollCount(sgVal(t[3].fx, 'times', lvs[3]));
  if (lvs[6] > 0) {
    slashes += sgRollCount(sgVal(t[6].fx, 'times', lvs[6]) + (ultVoid ? sgUltVal(ultVoid, 'times') : 0));
  }
  slashes += Math.max(0, Math.floor(Number(lg.cleaveSlashAdd) || 0));
  var rangeScale = skills2CleaveRangeScale(lvs);
  var baseM = sgVal(t[0].fx, 'm', lvs[0]);
  var tierM = lvs[5] > 0 ? sgVal(t[5].fx, 'm', lvs[5]) : 0;
  var flyM = Math.max(tierM, Number(lg.cleaveFlyM) || 0);
  var flying = flyM > 0;
  var radius = bfMeterPx(flying ? flyM : baseM) * rangeScale;
  var travel = flying ? Math.max(0.05, radius / sgConfiguredFlightSpeed('cleave', 1, SG_FLYING_PROJECTILE_SPEED)) : 0.42;
  var origin = typeof bfPlayerPos === 'function' ? bfPlayerPos() : null;
  var curve = t[0].fx.radiusCurve;
  var targets = pool.filter(function(e) { return e && e.hp > 0; });
  var roles = Object.assign({}, sgVfxRoles('cleave'));
  // 六階起本體轉為飛行角色；攻擊欄仍保留供非飛行形態繼承。
  // 裂空飛斬若在六階前啟用，沿用該階攻擊刀波作為飛行本體。
  if (flying) { roles.projectile = roles.projectile || roles.attack; delete roles.attack; }
  else delete roles.projectile;
  var stunnedBonusPct = Math.max(0, Number(lg.cleaveStunnedDmgPct) || 0);
  var bonusFor = function(target) { return stunnedBonusPct > 0 && sgIsStunned(target) ? stunnedBonusPct : 0; };
  var hookCfg = { pEnt:pEnt, st:st, floatSel:floatSel, tornado:ultWind ? {
    m:sgUltVal(ultWind,'m'), pct:sgUltVal(ultWind,'pct'), hits:Math.max(1,sgRollCount(sgUltVal(ultWind,'hits'))),
    gap:Math.max(0.1,sgGeometryNumber(ultWind.def.fx, 'gap')||0.4)
  } : null };
  var onHit = function(target,res,ctx) { sgCleaveOnHit(hookCfg,target,res,ctx); };
  var hasGeometry = typeof bfPos === 'function' && !!bfPos(primary);
  function emitWave(at) {
    sgEmitVfx('cleave', [], floatSel, {
      fxKind:flying ? 'projectile' : 'slash', variant:'cleave-ring', projectile:true,
      travelMs:[travel*1000], dur:travel,
      area:{x:at ? at.x : 0,y:at ? at.y : 0,r:radius},
      lineLength:radius, vfxRoles:roles, hit:false
    });
  }
  for (var wave = 0; wave < slashes; wave++) {
    var delay = wave * SG_CLEAVE_WAVE_GAP_SEC;
    if (wave === 0) emitWave(origin);
    (function(delayed) {
      sgQueueFlyingProjectile(pEnt,st,'cleave',dmgVal,hasGeometry ? origin : null,0,radius,floatSel,targets,{
        radialCurve:curve, travelMs:travel*1000, singleHit:true, beginSec:delay,
        stunChance:lvs[4]>0 ? sgSlotChance('cleave','5','enemy',0,sgVal(t[4].fx,'chance',lvs[4])) : 0,
        stunSec:lvs[4]>0 ? sgVal(t[4].fx,'sec',lvs[4]) : 0, stunSlot:{gid:'cleave',tier:'5'},
        onHit:onHit, bonusPctFn:bonusFor,
        onStart:function(projectile,ctx) {
          var livePool = ctx.getEnemies ? ctx.getEnemies() : pool;
          if (delayed) {
            // 每一道在真正起飛時取玩家位置；已飛出的刀波保留自己的發射中心。
            var at = typeof bfPlayerPos === 'function' ? bfPlayerPos() : null;
            projectile.origin = hasGeometry && at ? {x:at.x,y:at.y} : null;
            projectile.fallbackTargets = livePool.filter(function(e) {return e && e.hp>0;});
            // 模擬跨過預定起飛點時，畫面與傷害仍從同一個實際起點開始。
            projectile.startAt = sgProjectileNow();
            projectile.endAt = projectile.startAt + travel;
            emitWave(at);
          }
          if(lg.cleaveWhirl)sgCleaveWhirlwind(pEnt,st,lg.cleaveWhirl,livePool,floatSel,out,0);
        }
      },out);
    })(wave > 0);
  }
}

/* ---- 飛刀 ----
   飛刀有四種發射來源：主刀、彈射、傳奇【分裂者】的小刀、超神【無限追魂刃】。
   命中、彈射與命中後觸發全部收斂到 sgKnifeHit／sgKnifeBounceChain 兩支，
   效果才不會只在其中一種形態下生效（比照突刺／迴旋斬的共用掛鉤設計）。
   cfg 由 sgCastKnife 一次算好（純資料，不含幾何）。 */

var SG_KNIFE_PATH_HALF_M = 1;   // 超神【暴雨梨花】判定飛行路徑的半寬（米）
var SG_KNIFE_WALTZ_RPS = 1;     // 傳奇【輪舞刃】刀環每秒轉幾圈

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
  if (cfg.reaper) {
    sgApplySlot(cfg.pEnt, 'knife', 'deathReaper', 'self', 0, {
      val: cfg.reaper.pct, maxStacks: cfg.reaper.maxStacks, dur: cfg.reaper.dur
    });
  }
  /* 傳奇【分裂者】：擊殺處分裂出小型飛刀。 */
  if (cfg.split && !derived) sgKnifeSplit(cfg, target, delayMs);
  return res;
}

/* 下一個彈射目標：先用彈射範圍（表定 m＝20 米）篩掉範圍外的敵人，範圍外一律不跳；
   範圍內的挑法是「本輪還沒彈過的敵人裡隨機一個」——飛刀的敘述規定了範圍、
   但沒有寫「最近」，依選敵通則就是規定範圍內等機率隨機
   （選法的唯一權威在 js/battlefield.js bfRandomOther）。
   傳奇【處刑者】是唯一的例外：它的敘述明寫「優先在生命值最高的目標間彈射」，
   屬於特別指定的規則，維持挑範圍內生命值最高者。
   都彈過之後允許在範圍內回跳；範圍內沒有任何目標時回 null，不得跨距離找人。 */
/* 命中型冷卻縮減可能在 tickSkillCds 之外把冷卻直接扣到 0。
   這時必須同步通知技能排程器，否則 UI 會顯示「無冷卻」，但 ready queue 仍沒有該技能。 */
function sgReduceSkillCooldownOnHit(pEnt, cdKey, amount) {
  if (!pEnt || !pEnt.skillCds || !(Number(amount) > 0)) return;
  var before = Number(pEnt.skillCds[cdKey]) || 0;
  if (!(before > 0)) return;
  var after = Math.max(0, before - Number(amount));
  pEnt.skillCds[cdKey] = after;
  if (!(after > 0) && typeof markSkillReady === 'function') markSkillReady(pEnt, cdKey);
}
function sgKnifeNextBounce(cfg, cur, visited, maxGapPx, poolOverride) {
  var pool = poolOverride || cfg.pool;
  if (cfg.execPct) {
    var near = bfNearestOthers(cur, pool, pool.length, maxGapPx);
    var best = null;
    for (var i = 0; i < near.length; i++) {
      if (visited.indexOf(near[i]) >= 0) continue;
      if (!best || near[i].hp > best.hp) best = near[i];
    }
    if (best) return best;
    return near.length ? near[0] : null;
  }
  var rnd = bfRandomOther(cur, pool, maxGapPx, visited);
  if (rnd) return rnd;
  return (typeof bfRandomOther === 'function') ? bfRandomOther(cur, pool, maxGapPx, null) : null;
}

/* 每一段在既有飛行物佇列執行；死亡的目標仍保留實體最後座標。
   area 帶發射點與曲線控制點，Worker 與顯示層共用同一條路徑。 */
function sgQueueKnifeFlight(cfg, from, target, dmg, bonus, derived, variant, arrival, enterAngle, loopReturn, soul) {
  if (!target) return;
  var a = from ? bfPos(from) : bfPlayerPos(), b = bfPos(target);
  a = a ? {x:a.x,y:a.y} : null;
  b = b ? {x:b.x,y:b.y} : null;
  var ctrl = null, distance = a && b ? Math.hypot(b.x-a.x,b.y-a.y) : 0;
  if (a && b && isFinite(enterAngle) && distance > 0) {
    var heading=Math.atan2(b.y-a.y,b.x-a.x);
    var delta=Math.atan2(Math.sin(enterAngle-heading),Math.cos(enterAngle-heading));
    var tangent=heading+Math.max(-Math.PI*2/3,Math.min(Math.PI*2/3,delta));
    ctrl={x:a.x+Math.cos(tangent)*distance*0.55,y:a.y+Math.sin(tangent)*distance*0.55};
  }
  if (loopReturn && a && b) {
    var angle=isFinite(enterAngle)?enterAngle:0;
    ctrl={x:a.x+Math.cos(angle)*bfMeterPx(4),y:a.y+Math.sin(angle)*bfMeterPx(4)};
    distance=bfMeterPx(4);
  }
  if(ctrl && a && b) {
    var prior=a,plan={origin:a,control:ctrl};
    distance=0;
    for(var sample=1;sample<=16;sample++) {
      var point=sgKnifeFlightPoint(plan,b,sample/16);
      distance+=Math.hypot(point.x-prior.x,point.y-prior.y);prior=point;
    }
  }
  var travel = a && b ? Math.max(0.05,distance/sgConfiguredFlightSpeed('knife',1,SG_FLYING_PROJECTILE_SPEED))
    : Math.max(0.05,sgConfiguredTravelSeconds('knife',target));
  var area=a && b ? {knifeFlight:true,sourceX:a.x,sourceY:a.y,x:b.x,y:b.y,
    controlX:ctrl?ctrl.x:null,controlY:ctrl?ctrl.y:null} : null;
  var isSoul=variant==='knife-soulhunter';
  var roles=sgVfxRoles('knife',{vfxTier:from?3:0,vfxUlt:isSoul?'soulhunterBlade':'',
    vfxBase:!isSoul&&!!sgUlt('knife','soulhunterBlade')});
  if (soul) {
    area=area||{};
    area.soulId=soul.id;area.soulMode='flight';area.soulLife=Math.max(0,soul.until-sgProjectileNow());
    if(target._soulAnchor){area.soulReturn=true;area.orbitAngle=target.orbitAngle;area.orbitR=soul.orbitR;}
  }
  var eventTargets=target._soulAnchor?[]:from&&!loopReturn&&!from._soulAnchor?[from,target]:[target];
  sgEmitVfx('knife',eventTargets,cfg.floatSel,{
    fxKind:from?'chain':'projectile',variant:variant||'knife',count:1,
    travelMs:eventTargets.length>=2?[0,travel*1000]:[travel*1000],area:area,loopReturn:!!loopReturn,
    preserveDeadTargets:true,hit:false,vfxRoles:roles
  });
  cfg.out._pendingProjectiles=(cfg.out._pendingProjectiles||0)+1;
  SKILL2_RT.projectiles.push({knifeFlight:true,cfg:cfg,out:cfg.out,target:target,from:from,
    origin:a,lastPoint:a,to:b,control:ctrl,startAt:sgProjectileNow(),endAt:sgProjectileNow()+travel,
    dmg:dmg,bonus:bonus,derived:derived,variant:variant,roles:roles,arrival:arrival,seen:[],lastK:0,
    soul:soul||null});
}
function sgKnifeFlightPoint(p,to,k) {
  if (!p.control) return {x:p.origin.x+(to.x-p.origin.x)*k,y:p.origin.y+(to.y-p.origin.y)*k};
  var u=1-k,c=p.control;
  return {x:u*u*p.origin.x+2*u*k*c.x+k*k*to.x,y:u*u*p.origin.y+2*u*k*c.y+k*k*to.y};
}
function sgKnifeFlightHit(p,target,damage,derived,ctx,bonus) {
  var res=sgKnifeHit(p.cfg,target,damage,0,bonus===undefined?p.bonus:bonus,derived);
  if (res && !res.miss) {
    var pos=bfPos(target);
    sgEmitVfx('knife',[target],p.cfg.floatSel,{fxKind:'impact',variant:'knife-strike',
      preserveDeadTargets:true,vfxRoles:p.roles,area:pos?{x:pos.x,y:pos.y,knifeImpact:true}:null});
    if (ctx.onDamage) ctx.onDamage(res.dmg);
  }
  return res;
}
function sgTickKnifeFlight(p,now,ctx) {
  if (!(p.cfg.pEnt.hp>0) || (p.soul && now>=p.soul.until)) return true;
  if(p.target._soulAnchor) {
    var centre=bfPlayerPos();
    p.target.pos={x:centre.x+Math.cos(p.target.orbitAngle)*p.soul.orbitR,y:centre.y+Math.sin(p.target.orbitAngle)*p.soul.orbitR};
  }
  var k=Math.max(0,Math.min(1,(now-p.startAt)/(p.endAt-p.startAt)));
  var to=bfPos(p.target)||p.to, killed=false;
  var pool=ctx.getEnemies?ctx.getEnemies():p.cfg.pool;
  p.cfg.pool=pool;
  if (p.origin && to && p.cfg.pathPct>0) {
    // 小段掃描同一條貝茲曲線，沿途敵人到刀刃經過時才受傷，每段每敵一次。
    for (var step=1;step<=4;step++) {
      var t=p.lastK+(k-p.lastK)*step/4, point=sgKnifeFlightPoint(p,to,t);
      var dx=point.x-p.lastPoint.x,dy=point.y-p.lastPoint.y;
      var targets=bfSegmentTargets(p.lastPoint,Math.atan2(dy,dx),0,Math.hypot(dx,dy),pool,bfMeterPx(SG_KNIFE_PATH_HALF_M));
      for(var i=0;i<targets.length;i++) {
        var e=targets[i];
        if(e===p.target||e===p.from||p.seen.indexOf(e)>=0)continue;
        p.seen.push(e);
        var hit=sgKnifeFlightHit(p,e,p.cfg.dmgVal*p.cfg.pathPct/100,true,ctx,0);
        if(hit&&hit.killed)killed=true;
      }
      p.lastPoint=point;
    }
  }
  p.lastK=k;
  if(k>=1) {
    var res=sgKnifeFlightHit(p,p.target,p.dmg,p.derived,ctx);
    if(res&&res.killed)killed=true;
    var tail=p.control||p.origin;
    var angle=tail&&to?Math.atan2(to.y-tail.y,to.x-tail.x):NaN;
    // 即使目標在途中被別人殺死，仍抵達其最後位置，再決定下一跳。
    if(p.arrival)p.arrival(res,angle);
  }
  if(killed&&ctx.onDeaths)ctx.onDeaths();
  return k>=1;
}
/* 只有上一段到達才選下一跳；startDelay 保留呼叫介面，不再預排整條鏈。
   chainMax／chainChance 是第六階的額外彈射機率與上限。 */
function sgKnifeBounceChain(cfg, cur, dmgVal, startDelay, bounces, chainMax, chainChance, derived, vfxVariant, maxGapPx, poolOverride, enterAngle) {
  if (!(dmgVal>0)||!(bounces>0))return;
  var visited=[cur],chained=0;
  function nextHop(origin,remaining,angle) {
    if(!(remaining>0))return;
    var next=sgKnifeNextBounce(cfg,origin,visited,maxGapPx===undefined?cfg.bounceRangePx:maxGapPx,
      typeof poolOverride==='function'?poolOverride():poolOverride);
    if(!next||next===origin||next.hp<=0)return;
    visited.push(next);
    sgQueueKnifeFlight(cfg,origin,next,dmgVal,cfg.execPct,derived,vfxVariant||'knife-bounce',function(res,heading){
      var left=remaining-1;
      if(res&&!res.miss&&chained<chainMax&&chainChance>0&&chance(chainChance)){left++;chained++;}
      nextHop(next,left,heading);
    },angle);
  }
  nextHop(cur,bounces,enterAngle);
}

/* 分裂刃同樣在擊殺位置出發、到達後才命中；衍生傷害不再分裂。 */
function sgKnifeSplit(cfg, from, delayMs) {
  var count=Math.max(1,Math.floor(Number(cfg.split.count)||0));
  var dmg=cfg.dmgVal*(Number(cfg.split.pct)||0)/100;
  if(!(dmg>0))return;
  var bounces=Math.max(0,Math.floor(Number(cfg.split.bounces)||0));
  var near=bfRandomOthers(from,cfg.pool,count,0,null);
  if(!near.length)return;
  for(var i=0;i<count;i++)(function(target){
    sgQueueKnifeFlight(cfg,from,target,dmg,cfg.execPct,true,'knife-bounce',function(res,angle){
      sgKnifeBounceChain(cfg,target,dmg,0,bounces,0,0,true,undefined,undefined,undefined,angle);
    });
  })(near[i%near.length]);
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
    auraVariant: 'void-disc', hitVariant: 'knife-strike', hitElem: 'phys',
    vfxGid: 'vacuumslash', vfxTier: 7
  });
}

/* 每次施放只有一個追魂刃控制器；飛行、回返、環繞共用同一身份與到期時間。 */
var SG_SOULHUNTER_SERIAL = 0;
var SG_SOULHUNTER_ORBIT_M = 12;
var SG_SOULHUNTER_ORBIT_RPS = 1;
function sgSoulPoint(s,now) {
  var centre=bfPlayerPos(),angle=s.orbitAngle+(now-s.orbitAt)*Math.PI*2*SG_SOULHUNTER_ORBIT_RPS;
  return {x:centre.x+Math.cos(angle)*s.orbitR,y:centre.y+Math.sin(angle)*s.orbitR};
}
function sgSoulEmit(s,mode) {
  var centre=bfPlayerPos();
  sgEmitVfx('knife',[],s.cfg.floatSel,{fxKind:'projectile',variant:'knife-soulhunter',hit:false,
    dur:Math.max(.001,s.until-sgProjectileNow()),vfxRoles:s.roles,
    area:{soulId:s.id,soulMode:mode,x:centre.x,y:centre.y,orbitR:s.orbitR,
      orbitAngle:s.orbitAngle,orbitSpin:Math.PI*2*SG_SOULHUNTER_ORBIT_RPS}});
}
function sgSoulIdle(s,from,angle) {
  var now=sgProjectileNow();
  if(now>=s.until)return;
  if(!from || !bfPos(from)) {
    s.mode='orbit';s.orbitAt=now;s.orbitAngle=0;sgSoulEmit(s,'orbit');return;
  }
  var centre=bfPlayerPos(),pos=bfPos(from);
  s.orbitAngle=Math.atan2(pos.y-centre.y,pos.x-centre.x);
  var anchor={hp:0,_soulAnchor:true,orbitAngle:s.orbitAngle,
    pos:{x:centre.x+Math.cos(s.orbitAngle)*s.orbitR,y:centre.y+Math.sin(s.orbitAngle)*s.orbitR}};
  s.mode='flight';
  sgQueueKnifeFlight(s.cfg,from,anchor,0,0,true,'knife-soulhunter',function(){
    s.mode='orbit';s.orbitAt=sgProjectileNow();sgSoulEmit(s,'orbit');
  },angle,false,s);
}
function sgSoulLaunch(s,from,angle) {
  if(sgProjectileNow()>=s.until)return;
  // 範圍中心永遠是玩家；沒有範圍內目標時不得退回整個戰場。
  var candidates=s.cfg.pool.filter(function(e){return e&&e.hp>0&&!(bfEntityDistance(e)>s.range);});
  var others=candidates.filter(function(e){return e!==from;});
  var pool=others.length?others:candidates;
  if(!pool.length){sgSoulIdle(s,from,angle);return;}
  var next=pool[Math.floor(Math.random()*pool.length)];
  if(s.attacks>0)s.bounces++;
  s.attacks++;s.mode='flight';
  var damage=s.cfg.dmgVal*(1+s.gain*s.bounces/100);
  sgQueueKnifeFlight(s.cfg,from,next,damage,s.cfg.execPct,false,'knife-soulhunter',function(res,heading){
    sgSoulLaunch(s,next,heading);
  },angle,next===from,s);
}
function sgTickSoulhunter(s,now,ctx) {
  if(now>=s.until || !(s.cfg.pEnt.hp>0)) {sgSoulEmit(s,'stop');return true;}
  s.cfg.pool=ctx.getEnemies?ctx.getEnemies():s.cfg.pool;
  if(s.mode==='orbit') {
    var any=s.cfg.pool.some(function(e){return e&&e.hp>0&&!(bfEntityDistance(e)>s.range);});
    if(any) {
      var angle=s.orbitAngle+(now-s.orbitAt)*Math.PI*2*SG_SOULHUNTER_ORBIT_RPS;
      sgSoulLaunch(s,{hp:1,_soulAnchor:true,pos:sgSoulPoint(s,now)},angle+Math.PI/2);
    }
  }
  return false;
}
function sgKnifeSoulhunter(cfg,ult) {
  var now=sgProjectileNow();
  var s={soulController:true,id:'soulhunter-'+(++SG_SOULHUNTER_SERIAL),cfg:cfg,out:cfg.out,
    until:now+sgUltVal(ult,'sec'),range:bfMeterPx(sgUltVal(ult,'m')),gain:sgUltVal(ult,'pct'),
    attacks:0,bounces:0,mode:'flight',orbitAt:now,orbitAngle:0,orbitR:bfMeterPx(SG_SOULHUNTER_ORBIT_M),
    roles:sgVfxRoles('knife',{vfxUlt:'soulhunterBlade'})};
  cfg.out._pendingProjectiles=(cfg.out._pendingProjectiles||0)+1;
  SKILL2_RT.projectiles.push(s);
  sgSoulLaunch(s,null,NaN);
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
      var cone = bfConeTargets(bfAngleTo(primary), sgGeometryNumber(t[0].fx, 'deg') || 60,
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
  var bouncePct = lvs[2] > 0 ? sgVal(t[2].fx, 'pct', lvs[2]) : 0;
  var bounceRangePx = lvs[2] > 0 ? bfMeterPx(sgGeometryNumber(t[2].fx, 'm') || 20) : 0;
  var cdrSec = lvs[6] > 0 ? sgVal(t[6].fx, 'sec', lvs[6]) : 0;
  var cdKey = SG_PREFIX + 'knife';
  function onCrit() {
    sgReduceSkillCooldownOnHit(pEnt, cdKey, cdrSec);
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
    execPct: lg.knifeExecutor ? (Number(lg.knifeExecutor.pct) || 0) : 0,
    bounceRangePx: bounceRangePx
  };

  /* 傳奇【輪舞刃】：第 1 把飛刀改為刀環（因此下面的迴圈跳過 index 0）。 */
  var waltz = lg.knifeOrbit || null;
  if (waltz) sgKnifeWaltz(pEnt, st, cfg, waltz);

  for(var ki=waltz?1:0;ki<knives.length;ki++)(function(target){
    sgQueueKnifeFlight(cfg,null,target,dmgVal,0,false,'knife',function(res,angle){
      if((res&&res.miss)||bouncePct<=0)return;
      var bounces=Math.max(1,Math.floor(Number(t[2].fx.count)||1))+
        (lvs[3]>0?sgRollCount(sgVal(t[3].fx,'add',lvs[3])):0)+Math.max(0,Math.floor(Number(lg.knifeBounceAdd)||0));
      var chainMax=lvs[5]>0?Math.max(0,Math.floor(Number(t[5].fx.max)||4)):0;
      var chainChance=lvs[5]>0?sgVal(t[5].fx,'chance',lvs[5]):0;
      sgKnifeBounceChain(cfg,target,dmgVal*bouncePct/100,0,bounces,chainMax,chainChance,false,
        undefined,undefined,undefined,angle);
    });
  })(knives[ki]);

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
    hitElem: 'wind',
    vfxGid: 'cleave', vfxUlt: 'windChaser'
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
    area: (typeof sgAreaAround === 'function') ? sgAreaAround(target, r) : null,
    vfxUlt: 'thunderGodSlash'
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
  sgReduceSkillCooldownOnHit(cfg.pEnt, cfg.cdKey, cfg.cdrSec);
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
  var configuredGap = sgVal(t[0].fx, 'gap', lvs[0]);
  var waveGap = configuredGap > 0 ? configuredGap : SG_MULTI_ATTACK_GAP_SEC;
  var lg = sgLegend('gale');
  var ultFlash = sgUlt('gale', 'thunderFlash');
  var ultBolt = sgUlt('gale', 'thunderGodSlash');
  var ultChidori = sgUlt('gale', 'chidori');
  var chidoriDamageFactor = 1 + sgUltVal(ultChidori, 'pct') / 100;
  var chidoriScatterFactor = 1 + sgUltVal(ultChidori, 'scatterPct') / 100;
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

  var impact = geomOk ? { pos: { x: bfPos(primary).x, y: bfPos(primary).y } } : primary;
  var impactFrozen = false;
  function strike(ctx) {
    if (!primary) return;
    if (ctx && ctx.getEnemies) { pool = ctx.getEnemies(); cfg.pool = pool; }
    // 死亡時保留最後座標；後續即使屍體移動或移除也不改變落點。
    if (geomOk && !impactFrozen) {
      var pos = bfPos(primary);
      if (pos) impact.pos = { x: pos.x, y: pos.y };
      if (primary.hp <= 0) impactFrozen = true;
    }
    var radius = bfMeterPx(sgVal(shareMode ? t[6].fx : t[0].fx, 'm', shareMode ? lvs[6] : lvs[0]));
    shareTargets = geomOk ? bfTargetsAround(impact, pool, radius) : [primary];
    sgEmitVfx('gale', geomOk ? [] : [primary], floatSel, {
      fxKind: 'slash', count: 1, variant: shareMode ? 'gale-moon' : 'gale-burst',
      area: geomOk ? sgAreaAround(impact, radius) : null,
      // 主打擊沿用目前進化的逐欄繼承；不可固定讀第一階而略過爆散配置。
      preserveDeadTargets: true
    });
    if (shareMode) {
      // 超神【千鳥】：月牙斬不再均分，改為每個敵人都吃完整傷害，且傷害再額外提高
      var total = dmgVal * (1 + sgVal(t[6].fx, 'pct', lvs[6]) / 100);
      total *= chidoriDamageFactor;
      var alive = shareTargets.filter(function (e) { return e && e.hp > 0; });
      var share = ultChidori ? total : (alive.length ? total / alive.length : 0);
      for (var si = 0; si < alive.length; si++) {
        var sres = sgHitOne(pEnt, st, alive[si], share, 'gale', floatSel, out, 0);
        sgGaleOnHit(cfg, alive[si], sres);
      }
    } else {
      for (var bi = 0; bi < shareTargets.length; bi++) {
        if (!shareTargets[bi] || shareTargets[bi].hp <= 0) continue;
        var pres = sgHitOne(pEnt, st, shareTargets[bi], dmgVal, 'gale', floatSel, out, 0);
        sgGaleOnHit(cfg, shareTargets[bi], pres);
      }
    }
    if (primary.hp <= 0) impactFrozen = true;
  }
  for (var h = 0; h < hits; h++) {
    if (h === 0) strike();
    else SKILL2_RT.galeStrikes.push({ at: sgProjectileNow() + h * waveGap, run: strike, out: out });
  }
  // 爆散獨立於本體節拍：保留每段的追加次數，逐下以 0.2 秒選敵及命中。
  // 同段已命中的其他目標不重複；沒有其他活目標時才回打原目標。
  if (lvs[3] > 0) {
    var scatterIndex = 0, scatterStart = sgProjectileNow();
    function scatterStrike(used, ctx) {
      if (ctx && ctx.getEnemies) { pool = ctx.getEnemies(); cfg.pool = pool; }
      var others = pool.filter(function (e) { return e !== primary; });
      var candidates = bfRandomOthers(null, others,
        others.length, bfMeterPx(sgVal(t[3].fx, 'm', lvs[3])));
      var extra = candidates.find(function (e) { return used.indexOf(e) < 0; });
      if (!candidates.length && primary.hp > 0) extra = primary;
      if (!extra || extra.hp <= 0) return;
      used.push(extra);
      sgEmitVfx('gale', [extra], floatSel, {
        fxKind: 'slash', variant: 'gale-burst', count: 1
      });
      var eres = sgHitOne(pEnt, st, extra, dmgVal * chidoriDamageFactor * sgVal(t[3].fx, 'pct', lvs[3]) / 100 * chidoriScatterFactor, 'gale', floatSel, out, 0);
      sgGaleOnHit(cfg, extra, eres);
    }
    for (var sh = 0; sh < hits; sh++) {
      var used = [];
      // 先放大完整目標數，再對小數擲骰；不可先取整而吃掉千鳥的成長。
      var extraCount = sgRollCount(sgVal(t[3].fx, 'count', lvs[3]) * chidoriScatterFactor);
      for (var ei = 0; ei < extraCount; ei++) {
        var runScatter = scatterStrike.bind(null, used);
        if (scatterIndex === 0) runScatter();
        else SKILL2_RT.galeStrikes.push({
          at: scatterStart + scatterIndex * SG_MULTI_ATTACK_GAP_SEC, run: runScatter, out: out
        });
        scatterIndex++;
      }
    }
  }
  // 狂風斬：攻速增益（突破上限、與自身攻速相乘——掛點在戰鬥迴圈的乘算區）
  if (lvs[4] > 0) {
    sgApplySlot(pEnt, 'gale', '5', 'self', 0, { val: sgVal(t[4].fx, 'pct', lvs[4]), dur: sgVal(t[4].fx, 'sec', lvs[4]) });
  }
  // 最後一擊觸發表定基礎次數＋角色連擊數道雷電；技能自身打擊次數只決定開始時間。
  if (ultFlash) {
    var flashCombo = Math.max(0, Number(st.comboHits) || 0);
    flashCombo += Math.max(0, Number(skill2ComboBonus()) || 0);
    flashCombo += Math.max(0, Number(skill2FrenzyComboBonus()) || 0);
    var flashCount = sgUltVal(ultFlash, 'count') + sgRollCount(flashCombo);
    var flashSequence = { stopped: false, primary: primary, first: true };
    for (var fi = 0; fi < flashCount; fi++) SKILL2_RT.galeStrikes.push({
      at: sgProjectileNow() + (hits - 1) * waveGap + fi * sgUltVal(ultFlash, 'gap'),
      run: function (ctx) { sgGaleThunderFlash(cfg, ultFlash, flashSequence, ctx); }, out: out
    });
  }
  // 只在新增排程時排序，避免每個模擬 Tick 重排；補跑時仍按原命中時間結算。
  SKILL2_RT.galeStrikes.sort(function (a, b) { return a.at - b.at; });
}

function sgTickGaleStrikes(ctx) {
  var now = sgProjectileNow(), keep = [];
  (SKILL2_RT.galeStrikes || []).forEach(function (wave) {
    if (wave.at > now + 1e-9) { keep.push(wave); return; }
    var before = wave.out.dmg;
    var priorKilled = wave.out.killed;
    wave.out.killed = false;
    wave.run(ctx);
    var killedNow = wave.out.killed;
    wave.out.killed = priorKilled || killedNow;
    if (ctx.onDamage && wave.out.dmg > before) ctx.onDamage(wave.out.dmg - before);
    if (killedNow && ctx.onDeaths) ctx.onDeaths();
    sgFinishSkillCastFloat(wave.out);
  });
  SKILL2_RT.galeStrikes = keep;
}

/* 霹靂一閃：鎖定本次發射位置，矩形雷電沿權威時間向前伸展。 */
function sgGaleThunderFlash(cfg, ult, sequence, ctx) {
  if (sequence.stopped) return;
  if (ctx && ctx.getEnemies) cfg.pool = ctx.getEnemies();
  var choices = bfRandomOthers(null, cfg.pool || [], (cfg.pool || []).length,
    bfMeterPx(sgUltVal(ult, 'm')));
  var target = sequence.first && choices.indexOf(sequence.primary) >= 0 ? sequence.primary : choices[0];
  sequence.first = false;
  if (!target) { sequence.stopped = true; return; }
  var home = bfPlayerPos(), pos = bfPos(target);
  if (!pos) { sequence.stopped = true; return; }
  var angle = Math.atan2(pos.y - home.y, pos.x - home.x);
  var length = bfMeterPx(sgUltVal(ult, 'len')), width = bfMeterPx(sgUltVal(ult, 'wid'));
  var origin = { x: home.x - Math.cos(angle) * length / 2, y: home.y - Math.sin(angle) * length / 2 };
  var rise = sgUltVal(ult, 'rise');
  var roles = sgVfxRoles('gale', { vfxUlt: 'thunderFlash' });
  sgEmitVfx('gale', [], cfg.floatSel, {
    fxKind: 'slash', variant: 'gale-thunder-flash', elem: 'lightning', hit: false,
    area: { x: origin.x, y: origin.y, w: length, h: width, a: angle },
    travelMs: [rise * 1000], vfxRoles: roles
  });
  sgQueueFlyingProjectile(cfg.pEnt, cfg.st, 'gale', cfg.st.atk * sgUltVal(ult, 'pct') / 100,
    origin, angle, length, cfg.floatSel, [], {
      speed: length / rise, travelMs: rise * 1000, halfWidthPx: width / 2,
      singleHit: true, rectangularBeam: true,
      hitFn: function (projectile, enemy, hitCtx) {
        var before = cfg.out.dmg;
        var res = sgHitOne(cfg.pEnt, cfg.st, enemy, projectile.dmgVal, 'gale', cfg.floatSel, cfg.out, 0, 0, 'lightning');
        sgGaleOnHit(cfg, enemy, res);
        if (hitCtx.onDamage && cfg.out.dmg > before) hitCtx.onDamage(cfg.out.dmg - before);
        if (res && res.killed && hitCtx.onDeaths) hitCtx.onDeaths();
        if (roles.hit) sgEmitVfx('gale', [enemy], cfg.floatSel, {
          fxKind: 'impact', preserveDeadTargets: true, vfxRoles: { hit: roles.hit }, elem: 'lightning'
        });
      }
    }, cfg.out);
}

/* ---- 血刃斬 ---- */
/* 流血／中毒的每跳傷害＝技能傷害基準 × dotPct%；作用間隔可被第 2 階縮短（跳更快＝總傷更高），
   因此以 ctx.dps 直接指定每秒傷害（每跳量 ÷ 間隔），繞過狀態表「狀態傷害＝每秒量」的預設換算。

   ---- 第三批傳奇進化的接線（2026-08-20）----
   施放路徑本身只多兩件事：斬擊倍率（切割）與機率再揮一次（血影）。其餘四個都不在這裡：
     毒血祭     → sgBloodbladeDotSpec（傷害那半）＋ sgApplyBloodbladeDot（生命代價那半）
     毒爆／血霧 → skills2OnEnemyDeath（敵人死亡後才留下場域）
     崩解（超神）→ sgBloodbladeDotSpec縮短間隔，tickStatuses實際結算後爆炸
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
  // 流血與中毒上身的畫面由狀態表的「施加特效」負責（狀態第一次出現在目標身上時播），這裡不另外畫。
  sgApplyBloodbladeDot(primary, 'bleed', sgBloodbladeDotSpec(st, lvs, t, 'bleed'), 0, dotCtx);

  // 血毒刃：流血的同時中毒（毒屬性）
  if (lvs[3] > 0) {
    sgApplyBloodbladeDot(primary, 'poison', sgBloodbladeDotSpec(st, lvs, t, 'poison'), 0, dotCtx);
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
     毀滅之舞 → 施放代價（當下生命%）＋ 本次施放的總傷加成與追加攻擊
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
    if (cost > 0 && pEnt.hp > 1 &&
        !(typeof gmHpLockActive === 'function' && gmHpLockActive(pEnt))) {
      var hpBeforeDoom = pEnt.hp;
      pEnt.hp = Math.max(1, pEnt.hp - Math.max(1, Math.round(pEnt.hp * cost / 100)));
      sgWarGodBodyOnDamaged(hpBeforeDoom - pEnt.hp, pEnt);
    }
  }

  var strikes = Math.max(1, Math.floor(Number(t[0].fx.count) || 2) +
    (lvs[1] > 0 ? sgRollCount(sgVal(t[1].fx, 'add', lvs[1])) : 0) +
    sgDanceTargetAdd(lg) + (doom ? Math.max(0, Math.floor(sgUltVal(doom, 'add'))) : 0));
  var kaguraSpec = sgKaguraSpec(sgUlt('dualdance', 'flameKagura'), dmgVal);
  var kills = 0;
  for (var s = 0; s < strikes; s++) {
    // 每刀獨立抽取當前可及的存活敵人，可重複；不把剩餘斬擊浪費在已死亡目標上。
    var targets = pool.filter(function (e) { return skills2CanReach('dualdance', e, lvs); });
    if (!targets.length) break;
    var tgt = targets[Math.floor(Math.random() * targets.length)];
    var danceDelayMs = Math.round(s * SG_MULTI_ATTACK_GAP_SEC * 1000);
    sgEmitVfx('dualdance', [tgt], floatSel, {
      fxKind: 'slash', count: 1, variant: storm ? 'dual-storm' : 'dual-slash',
      vfxTier: storm ? 7 : 1, delayMs: danceDelayMs, angle: s % 2 ? 1.5 : 0
    });
    var res = sgHitOne(pEnt, st, tgt, dmgVal, 'dualdance', floatSel, out, danceDelayMs, doomPct);
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
      sgApplySlot(pEnt, 'dualdance', '4', 'self', 0, { val: sgVal(t[3].fx, 'cr', lvs[3]), dur: frenzyDur });
    }
  }
  // 鐵血之舞：自身與附近所有敵人流血（占最大生命比例；自身流血直接扣生命、不吃護盾）
  if (lvs[4] > 0) {
    /* 傳奇【狂戰士】：生命損失與傷害「同時」提高——兩者本來就共用這一個比例，
       放大它就同時放大兩邊，不必分開處理。 */
    var ironPct = sgVal(t[4].fx, 'pct', lvs[4]) * (1 + sgDanceIronAmpPct(lg) / 100);
    var ironDur = Number(t[4].fx.sec) || 3;
    var ironGap = Math.max(0.1, sgGeometryNumber(t[4].fx, 'gap') || 0.35);
    var ironR = bfMeterPx(sgGeometryNumber(t[4].fx, 'm') || 5);
    sgApplySlot(pEnt, 'dualdance', '5', 'self', 0, { dps: st.hp * ironPct / 100 / ironGap, dur: ironDur, interval: ironGap });
    for (var ei = 0; ei < pool.length; ei++) {
      var e = pool[ei];
      if (!e || e.hp <= 0) continue;
      var p = (typeof bfPos === 'function') ? bfPos(e) : null;
      if (p && typeof bfEntityDistance === 'function' && bfEntityDistance(e) > ironR) continue;
      sgApplySlot(e, 'dualdance', '5', 'enemy', 0, { dps: (e.maxHp || 0) * ironPct / 100 / ironGap, dur: ironDur, interval: ironGap });
    }
  }
  // 暴風之舞：化身狀態（自動施放由 tickSkill2 驅動；不可由化身內的自動施放再觸發）
  if (lvs[6] > 0 && !storm) {
    var stormDur = sgVal(t[6].fx, 'sec', lvs[6]);
    var stormGap = Math.max(0.1, sgGeometryNumber(t[6].fx, 'gap') || 0.35);
    SKILL2_RT.storm = { until: GT + stormDur, nextAt: GT + stormGap, gap: stormGap, tgt: null };
    // 化身的旋風是暴風化身這個狀態的「持續特效」（狀態表），化身多久就轉多久，這裡不另外畫。
    sgApplySlot(pEnt, 'dualdance', '7', 'self', 0, { val: 1, dur: stormDur });
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
    sgApplySlot(pEnt, 'dualdance', '7', 'self', 0, { val: 1, dur: Math.max(0.1, stm.until - GT) });
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
  sgApplySlot(ent, 'dualdance', 'flameKagura', 'enemy', 0, {
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
    if (d.until > GT) {
      if (!(typeof gmHpLockActive === 'function' && gmHpLockActive(pEnt))) pEnt.hp = Math.max(1, pEnt.hp);
      return true;
    }
    return false;                       // 已經用過而且到期：這一次是真的死亡
  }
  if (!(SKILL2_RT.storm && SKILL2_RT.storm.until > GT)) return false;
  var spec = sgLegend('dualdance').danceDeathDefer;
  var sec = spec ? Math.max(0, Number(spec.sec) || 0) : 0;
  if (!(sec > 0)) return false;
  SKILL2_RT.deathDefer = { until: GT + sec };
  if (!(typeof gmHpLockActive === 'function' && gmHpLockActive(pEnt))) pEnt.hp = Math.max(1, pEnt.hp);
  // 延後死亡期間的旋風是【不屈之誓】狀態的「持續特效」（狀態表）
  applyStatus(pEnt, 'sgDeathDefer', { val: Math.max(0, Number(spec.pct) || 0), dur: sec });
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
  if (ctx.pEnt && ctx.pEnt.hp > 0 &&
      !(typeof gmHpLockActive === 'function' && gmHpLockActive(ctx.pEnt))) ctx.pEnt.hp = 0;
}

/* ---- 嗜血狂怒（純增益爆發；傷害為 0，訊息由 castSkill2 尾端統一處理） ---- */
function sgCastBloodrage(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var dur = Number(t[0].fx.sec) || 8;
  SKILL2_RT.rage = { until: GT + dur, pEnt: pEnt, killCombo: 0 };
  var warGod = sgUlt('bloodrage', 'warGodRoll');
  if (warGod) SKILL2_RT.warGod = { pEnt: pEnt, drainPct: sgUltVal(warGod, 'drain') };
  // 狂怒的光殼是狂怒狀態的「持續特效」（狀態表），跟著狀態的剩餘時間（含【狂血盛宴】的延長）走。
  sgApplySlot(pEnt, 'bloodrage', '1', 'self', 0, { val: sgRageAspdPct(lvs), dur: dur });
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
  /* 傳奇【燃燼】：火球術造成的燃燒效果傷害提高（與殞石術的 2 倍相乘）。
     只放大火球術這一棵樹塗的燃燒；火龍捲塗的那一份由 sgFirepillarBurnSpec 各自決定。 */
  var burnMultiplier = (lvs[6] > 0 ? 2 : 1) *
    (1 + Math.max(0, Number(sgLegend('fireball').fireballBurnDmgPct) || 0) / 100);
  var gap = Math.max(0.1, lvs[3] > 0
    ? sgVal(t[3].fx, 'gap', lvs[3])
    : (Number(t[1].fx.dotGap) || 0.5));
  return {
    dps: base * sgVal(t[1].fx, 'dotPct', lvs[1]) / 100 * burnMultiplier / gap,
    dur: Number(t[1].fx.dotSec) || 5,
    interval: gap,
    slot: SG_FIREBALL_BURN_SLOT
  };
}

/* 燃燒塗哪一個狀態：火球術第 2 階與火龍捲第 4 階各自的「敵方狀態」第一格（角色 burn）。
   火球術後續各階（爆燃、火焰增幅、殞石 2 倍燃燒）與傳奇【爆燃】都以角色 burn 查詢，
   兩格填同一個狀態時兩棵技能樹共用同一份燃燒，與改造前相同。 */
var SG_FIREBALL_BURN_SLOT = { gid: 'fireball', tier: '2' };
var SG_FIREPILLAR_BURN_SLOT = { gid: 'firepillar', tier: '4' };

/* 火龍捲的燃燒規格（第 4 階未投資＝不燃燒）。每跳量占的是火龍捲「每段」的技能傷害。 */
function sgFirepillarBurnSpec(g, lvs, segmentDmg) {
  if (lvs[3] < 1) return null;
  var fx = g.tiers[3].fx;
  var gap = Math.max(0.1, Number(fx.dotGap) || 0.5);
  return {
    dps: segmentDmg * (Number(fx.dotPct) || 0) / 100 / gap,
    dur: Number(fx.dotSec) || 4,
    interval: gap,
    slot: SG_FIREPILLAR_BURN_SLOT
  };
}

/* 塗上燃燒，並留下【爆燃】要用的規格快照。
   快照是必要的：DoT 實例在燃燒結束的當下就被 tickStatuses 回收，
   之後再想回頭算「整段燃燒總共造成多少」已經沒有資料可讀。 */
function sgApplyBurn(ent, spec) {
  if (!ent || ent.hp <= 0 || !spec || !(spec.dps > 0)) return false;
  /* 未放大的規格快照：傳奇【爆燃】每疊 1 層就要以同一份規格重算一次放大後的每跳量，
     直接讀已寫入的實例會把上一次的放大倍率再乘一次（複利）。 */
  ent._sgBurnSpec = { dps: spec.dps, dur: spec.dur, interval: spec.interval, slot: spec.slot };
  return sgWriteBurn(ent, spec, 0);
}

/* 傳奇【爆燃】目前使該敵人的燃燒傷害提高多少%（層數由引擎累加成單一數值）。 */
function sgBurnAmpPct(ent) {
  return (ent && typeof buffVal === 'function') ? Math.max(0, buffVal(ent, 'sgBurnAmp')) : 0;
}

/* 實際寫入燃燒實例（含【爆燃】的傷害放大）。
   carry＝這一份燃燒在改寫前已經跳掉的累積傷害，交由 _sgBurnWatch 帶著走，
   否則【爆燃】每重寫一次就會把火球術第 5 階【爆燃】要引爆的累積量歸零。
   durOverride>0＝沿用剩餘時間（重新放大不該順便續期）。 */
function sgWriteBurn(ent, spec, carry, durOverride) {
  var amp = 1 + sgBurnAmpPct(ent) / 100;
  var dur = (durOverride > 0) ? durOverride : spec.dur;
  var slot = spec.slot || SG_FIREBALL_BURN_SLOT;
  // 機率（火龍捲第 4 階）由呼叫端先擲，這裡不再擲一次
  sgApplySlot(ent, slot.gid, slot.tier, 'enemy', 0,
    { dps: spec.dps * amp, dur: dur, interval: spec.interval, noChance: true });
  var d = sgFindDot(ent, sgSlotSid(slot.gid, slot.tier, 'enemy', 0));
  if (!d) return false;
  // 疊加規則為 strongest：實際生效的可能是原本更強的那一份，故一律以塗抹後的實例為準。
  ent._sgBurnWatch = { dps: d.dps, dur: Math.max(0, d.until - GT), until: d.until,
    carry: Math.max(0, Number(carry) || 0) };
  return true;
}

/* 傳奇【爆燃】：火龍捲每造成 1 段傷害就疊 1 層，使該敵人受到的燃燒傷害提高。
   層數無上限（設計文檔未設上限），因此比照【火焰增幅】由引擎累加成單一數值後「後蓋前」，
   不使用狀態表的疊層規則。疊層後立刻以未放大的規格重寫已在燒的那一份，
   讓正在燒的燃燒當場變強——但沿用剩餘時間，不順便續期。 */
function sgApplyBurnAmp(ent, spec) {
  if (!ent || ent.hp <= 0 || !spec || !(spec.pct > 0) || typeof applyStatus !== 'function') return;
  applyStatus(ent, 'sgBurnAmp', {
    val: sgBurnAmpPct(ent) + spec.pct, dur: Math.max(0.5, Number(spec.dur) || 4)
  });
  var live = sgFindDot(ent, sgRoleSids('burn'));
  if (!live || !ent._sgBurnSpec) return;
  sgWriteBurn(ent, ent._sgBurnSpec, sgBurnDealtSoFar(ent), Math.max(0, live.until - GT));
}

/* 這段燃燒到目前為止累積造成的傷害（燃燒結束＝全額；中途死亡＝已經跳完的部分）。 */
function sgBurnDealtSoFar(ent) {
  var w = ent && ent._sgBurnWatch;
  if (!w) return 0;
  var carry = Math.max(0, Number(w.carry) || 0);
  if (!(w.dps > 0)) return carry;
  var served = Math.max(0, w.dur - Math.max(0, w.until - GT));
  return carry + w.dps * served;
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
  var victims = sgRandomEnemiesNearPlayer(enemies, bfMeterPx(sgGeometryNumber(fx, 'm') || 12), ent, count);
  if (!victims.length) return;
  var out = { killed: false, dmg: 0, crit: false };
  var per = amount * sgVal(fx, 'pct', lvs[4]) / 100;
  sgEmitVfx('fireball', victims, (ctx && ctx.floatSel) || 'mv-float', {
    fxKind: 'burst', variant: 'fire-blast', elem: 'fire',
    vfxTier: 5
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
  var ampRange = bfMeterPx(sgGeometryNumber(ampFx, 'm') || 20);
  /* 燃燒以角色查詢（Skills2 火球術第 2 階／火龍捲第 4 階的「敵方狀態」）；
     每跳的作用特效由 js/combat.js tickStatuses 依狀態表送出，這裡不另外畫。 */
  var burnSids = sgRoleSids('burn');
  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i];
    if (!e) continue;
    var d = (e.hp > 0) ? sgFindDot(e, burnSids) : null;
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
      /* 火焰增幅：範圍內每有 1 次燃燒作用就疊一層。層數無上限，因此不用狀態表的
         疊層規則（有 maxStacks），改由引擎自己把總量算好後以「後蓋前」寫入。 */
      if (ampLv > 0 && ctx.pEnt && ctx.pEnt.hp > 0) {
        var inRange = !(typeof bfPos === 'function' && bfPos(e) &&
          typeof bfEntityDistance === 'function' && bfEntityDistance(e) > ampRange);
        if (inRange) {
          sgApplySlot(ctx.pEnt, 'fireball', '6', 'self', 0, {
            val: sgRoleBuffVal(ctx.pEnt, 'fireAmp') + sgVal(ampFx, 'pct', ampLv),
            dur: Number(ampFx.sec) || 4
          });
        }
      }
    }
    e._sgAcc.sgBurn = acc;
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
    onImpact: (extra && extra.onImpact) || null,
    /* 特效欄位的列標記（見 sgVfxRoles）：落地爆點要讀「發出這一顆的那一階」的受擊特效。 */
    vfxTier: (extra && extra.vfxTier) || 0,
    vfxBase: !!(extra && extra.vfxBase),
    vfxUlt: (extra && extra.vfxUlt) || '',
    vfxGid: (extra && extra.vfxGid) || ''
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
        fxKind: 'impact', variant: m.variant, elem: m.elem, area: sgAreaAround(m.target, m.radius),
        vfxTier: m.vfxTier, vfxUlt: m.vfxUlt, vfxGid: m.vfxGid, vfxBase: m.vfxBase, preserveDeadTargets: true
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
var SG_FIREBALL_SPEED_MULT = 1.3;
function sgFireballProjectilePlan(target) {
  var geomOk = (typeof bfPos === 'function') && !!bfPos(target) &&
    (typeof bfPlayerPos === 'function') && (typeof bfTravelDistance === 'function');
  var origin = geomOk ? bfPlayerPos() : null;
  var length = geomOk ? Math.max(1, bfTravelDistance(target)) : 1;
  var angle = geomOk && typeof bfAngleTo === 'function' ? bfAngleTo(target) : 0;
  /* 火球以普通遠程投射物為基準加速，飛行時間與模擬速度使用同一倍率。 */
  var travelMs = geomOk && typeof bfTravelSeconds === 'function'
    ? Math.round(bfTravelSeconds(target) * 1000)
    : (geomOk ? Math.max(100, Math.round(length / SG_FLYING_PROJECTILE_SPEED * 1000)) : 260);
  var nominalSpeed = VFX_PROJECTILE_SPEED_CELLS * bfUnit();
  var configuredSpeed = sgConfiguredFlightSpeed('fireball', 1, nominalSpeed * SG_FIREBALL_SPEED_MULT);
  travelMs = Math.max(1, Math.round(travelMs * nominalSpeed / configuredSpeed));
  var speed = geomOk && travelMs > 0 ? length / (travelMs / 1000) : SG_FLYING_PROJECTILE_SPEED * SG_FIREBALL_SPEED_MULT;
  return { origin: origin, length: length, angle: angle, travelMs: travelMs,
    speed: speed, waitForEnd: !geomOk };
}

/* 火球爆裂的共用投射佇列：一般火球在本體命中後呼叫，殞石則在落地回呼中呼叫。
   兩者都必須先建立飛行物，不能在爆炸／落地的同一拍直接結算小火球傷害。 */
function sgQueueFireballSplitProjectiles(pEnt, st, splitTargets, splitDmgVal,
  floatSel, out, burnSpec, burnBonusPct) {
  if (!Array.isArray(splitTargets) || !(splitDmgVal > 0)) return;
  for (var si = 0; si < splitTargets.length; si++) {
    var target = splitTargets[si];
    if (!target) continue;
    var plan = sgFireballProjectilePlan(target);
    sgEmitVfx('fireball', [target], floatSel, {
      fxKind: 'projectile', variant: 'fireball-small', elem: 'fire', count: 1,
      travelMs: [plan.travelMs], projectile: true,
      vfxTier: 3
    });
    sgEmitVfx('fireball', [target], floatSel, {
      fxKind: 'burst', variant: 'fire-explosion', elem: 'fire', delayMs: plan.travelMs,
      vfxTier: 3
    });
    sgQueueFlyingProjectile(pEnt, st, 'fireball', splitDmgVal,
      plan.origin, plan.angle, plan.length, floatSel, [target], {
        singleHit: true, targetOnly: true, waitForEnd: plan.waitForEnd,
        travelMs: plan.travelMs, speed: plan.speed, hitFn: sgFireballSplitProjectileHit,
        burnSpec: burnSpec, burnBonusPct: burnBonusPct
      }, out);
  }
}

/* 殞石落地後才挑選附近目標，避免把分裂目標在施法當下鎖死。 */
function sgFireballMeteorSplit(meteor, spec, burnBonusPct) {
  if (!meteor || !spec || !(spec.count > 0) || !(spec.radius > 0) ||
      !(spec.dmgVal > 0) || typeof bfRandomOthers !== 'function') return;
  var targets = bfRandomOthers(meteor.target, meteor.pool || [],
    spec.count, spec.radius, null);
  sgQueueFireballSplitProjectiles(meteor.pEnt, meteor.st, targets, spec.dmgVal,
    meteor.floatSel, meteor.out, meteor.burnSpec, burnBonusPct);
}

function sgFireballSplitProjectileHit(projectile, target, ctx) {
  var before = projectile.out.dmg;
  var res = sgHitOne(projectile.pEnt, projectile.st, target, projectile.dmgVal,
    'fireball', projectile.floatSel, projectile.out, 0, sgFireballBurnBonus(projectile, target));
  if (res && !res.miss && projectile.burnSpec) sgApplyBurn(target, projectile.burnSpec);
  if (ctx.onDamage && projectile.out.dmg > before) ctx.onDamage(projectile.out.dmg - before);
}

/* 傳奇【烈焰之心】：對正在燃燒的敵人的額外總傷加成%。走 sgHitOne 的總傷參數，
   因此仍完整經過防禦、抗性與爆擊，不是事後再乘一次的獨立傷害。
   src＝任何帶著 burnBonusPct 的載體（飛行物設定或殞石設定），呼叫端不必各自判空。 */
function sgFireballBurnBonus(src, target) {
  var pct = Number(src && src.burnBonusPct) || 0;
  return (pct > 0 && sgHasDot(target, sgRoleSids('burn'))) ? pct : 0;
}

function sgFireballProjectileHit(projectile, target, ctx) {
  var before = projectile.out.dmg;
  sgEmitVfx('fireball', [target], projectile.floatSel, {
    fxKind: 'burst', variant: 'fire-explosion', elem: 'fire', count: 1,
    area: sgAreaAround(target, projectile.blastRadius), vfxTier: 1
  });
  var victims = projectile.victims && projectile.victims.length ? projectile.victims : [target];
  for (var i = 0; i < victims.length; i++) {
    var victim = victims[i];
    if (!victim || victim.hp <= 0) continue;
    var res = sgHitOne(projectile.pEnt, projectile.st, victim, projectile.dmgVal,
      'fireball', projectile.floatSel, projectile.out, 0, sgFireballBurnBonus(projectile, victim));
    if (res && !res.miss && projectile.burnSpec) sgApplyBurn(victim, projectile.burnSpec);
  }
  if (ctx.onDamage && projectile.out.dmg > before) ctx.onDamage(projectile.out.dmg - before);

  /* 傳奇【火池】：火球爆炸後在爆點留下一灘火。爆點以目標當下的位置為準——
     火池釘在地板上，之後與目標實體脫鉤（比照火龍捲）。 */
  if (projectile.poolSpec) {
    sgSpawnFirePool(projectile.pEnt, projectile.st, 'fireball', projectile.poolSpec,
      projectile.floatSel, target, null);
  }

  /* 火球爆裂必須在本體飛到並爆炸後才生成下一批一般小火球。 */
  var splits = projectile.splitTargets || [];
  sgQueueFireballSplitProjectiles(projectile.pEnt, projectile.st, splits,
    projectile.splitDmgVal, projectile.floatSel, projectile.out, projectile.burnSpec,
    projectile.burnBonusPct);
}

/* 超神【火鳳遼原】：每顆殞石落下時，附近伴隨數顆火球一同落下。
   走與殞石相同的「落地才結算」時間軸（sgQueueMeteor），傷害、燃燒與飄字時序才會一致。
   傷害基準取火球術**第 1 階**的本體：第 7 階把本體「改為」殞石之後，
   這棵樹裡還叫得上「火球」的就只有第 1 階那一段，不能拿殞石的傷害當火球用。 */
function sgFireballPhoenixBalls(m, spec, poolSpec) {
  if (!m || !spec || !(spec.dmgVal > 0)) return;
  var n = sgRollCount(spec.count);
  if (n <= 0) return;
  var timing = sgMeteorFallTiming();
  var onImpact = poolSpec ? function (mm) {
    sgSpawnFirePool(mm.pEnt, mm.st, 'fireball', poolSpec, mm.floatSel, mm.target, null);
  } : null;
  for (var i = 0; i < n; i++) {
    // 「殞石附近」＝殞石自己的爆炸範圍內隨機一個敵人；沒有別人時就跟著砸同一個
    var tgt = (typeof bfRandomOthers === 'function')
      ? (bfRandomOthers(m.target, m.pool || [], 1, spec.radius, null)[0] || m.target)
      : m.target;
    if (!tgt || tgt.hp <= 0) tgt = m.target;
    if (!tgt || tgt.hp <= 0) continue;
    sgEmitVfx('fireball', [tgt], m.floatSel, {
      fxKind: 'rain', variant: 'fireball-small', elem: 'fire', count: 1,
      area: sgAreaAround(tgt, spec.blastPx), travelMs: [timing.travelMs],
      vfxUlt: 'phoenixPrairie'
    });
    sgQueueMeteor(m.pEnt, m.st, spec.dmgVal, tgt, m.pool, spec.blastPx, m.burnSpec,
      m.floatSel, m.out, GT + timing.fallMs / 1000, {
        variant: 'fire-explosion', bonusPctFn: m.bonusPctFn, onImpact: onImpact,
        vfxUlt: 'phoenixPrairie'
      });
  }
}

function sgCastFireball(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var lg = sgLegend('fireball');
  var ultFall = sgUlt('fireball', 'meteorFall');
  var ultPhoenix = sgUlt('fireball', 'phoenixPrairie');
  var meteor = lvs[6] > 0;
  var srcFx = meteor ? t[6].fx : t[0].fx;
  var srcLv = meteor ? lvs[6] : lvs[0];
  /* 超神的本體增傷採乘算（三選一，因此實際上只會有一個生效）：
     【火殞天落】只寫「殞石」，故僅殞石型態吃；【火鳳遼原】明寫「火球及殞石」，兩種型態都吃。 */
  var bodyMult = 1;
  if (ultFall && meteor) bodyMult *= 1 + sgUltVal(ultFall, 'pct') / 100;
  if (ultPhoenix) bodyMult *= 1 + sgUltVal(ultPhoenix, 'pct') / 100;
  var dmgVal = sgGroupBaseStat(g, st) * sgVal(srcFx, 'pct', srcLv) / 100 * bodyMult;
  var radius = bfMeterPx(sgVal(srcFx, 'm', srcLv));
  // 超神【火殞天落】：殞石體積 +N%（判定範圍與顯示範圍同步放大）
  if (ultFall && meteor) radius *= 1 + sgUltVal(ultFall, 'size') / 100;
  /* 數量：傳奇【連珠火】火球與殞石都 +N；超神【火鳳遼原】殞石 +N；
     超神【火殞天落】再額外連續落下 N 顆（後兩者都只在殞石型態成立）。 */
  var countAdd = Math.max(0, Math.floor(Number(lg.fireballCountAdd && lg.fireballCountAdd.count) || 0));
  var volleys = (meteor ? Math.max(1, Math.floor(Number(t[6].fx.count) || 3)) : 1) + countAdd;
  if (meteor && ultPhoenix) volleys += Math.max(0, sgRollCount(sgUltVal(ultPhoenix, 'count')));
  if (meteor && ultFall) volleys += Math.max(0, Math.floor(sgUltVal(ultFall, 'count')));
  /* 一般火球只建立標準平射飛行物計畫；殞石的落地計時完全走另一個分支。 */
  var fireballPlan = meteor ? null : sgFireballProjectilePlan(primary);
  var travelMs = 0;
  var meteorFallMs = 0;
  if (meteor) {
    var meteorTiming = sgFireMeteorFallTiming();
    travelMs = meteorTiming.travelMs;
    /* 每顆只錯開 350ms；不再使用玩家到目標的普通投射物距離。 */
    meteorFallMs = meteorTiming.fallMs;
  }
  var burnSpec = sgFireballBurnSpec(st, g, lvs);
  // 傳奇【烈焰之心】：對燃燒中的敵人增傷；傳奇【火池】：爆點留下一灘火
  var burnBonusPct = Math.max(0, Number(lg.fireballBurningDmgPct) || 0);
  var poolSpec = sgFirePoolSpec(lg, dmgVal);
  var bonusFn = burnBonusPct > 0
    ? function (tg) { return sgHasDot(tg, sgRoleSids('burn')) ? burnBonusPct : 0; } : null;
  // 傳奇【爆裂】：火球爆裂額外產生 N 個小火球（沒投資第 3 階＝沒有爆裂可加）
  var splitCount = Math.max(1, Math.floor(Number(t[2].fx.count) || 3) +
    Math.max(0, Math.floor(Number(lg.fireballSplitAdd && lg.fireballSplitAdd.count) || 0)));
  var nextMeteorTarget = meteor ? sgMeteorTargetBag(primary, pool, radius) : null;
  var meteorSplitSpec = (meteor && lvs[2] > 0) ? {
    count: splitCount,
    radius: bfMeterPx(sgGeometryNumber(t[2].fx, 'm') || 20),
    dmgVal: dmgVal * sgVal(t[2].fx, 'pct', lvs[2]) / 100
  } : null;
  var phoenixSpec = (meteor && ultPhoenix) ? {
    count: sgUltVal(ultPhoenix, 'balls'),
    radius: radius,                                    // 「殞石附近」＝殞石自己的爆炸範圍
    blastPx: bfMeterPx(sgVal(t[0].fx, 'm', lvs[0])),   // 伴生火球用火球自己的爆炸範圍
    dmgVal: sgGroupBaseStat(g, st) * sgVal(t[0].fx, 'pct', lvs[0]) / 100 *
      (1 + sgUltVal(ultPhoenix, 'pct') / 100)
  } : null;
  /* 落地後的附加效果全部收在同一支（迴圈不變量，因此整批共用一個閉包）。 */
  var onMeteorImpact = (meteorSplitSpec || poolSpec || phoenixSpec) ? function (m) {
    if (meteorSplitSpec) sgFireballMeteorSplit(m, meteorSplitSpec, burnBonusPct);
    if (poolSpec) sgSpawnFirePool(m.pEnt, m.st, 'fireball', poolSpec, m.floatSel, m.target, null);
    if (phoenixSpec) sgFireballPhoenixBalls(m, phoenixSpec, poolSpec);
  } : null;
  /* 殞石＝第 7 階那一列的畫面，落地爆點要讀同一列的受擊特效，因此列標記一律帶上。 */
  var meteorExtra = { bonusPctFn: bonusFn, onImpact: onMeteorImpact, vfxTier: 7,
    vfxBase: !!(ultPhoenix || sgUlt('fireball', 'starfallCataclysm')) };

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
      // 攻擊欄也可能填落地爆炸；起飛只派送施法、彈體與落點標記。
      var meteorRoles = sgVfxRoles('fireball', { vfxTier: 7, vfxBase: meteorExtra.vfxBase });
      sgEmitVfx('fireball', [meteorTarget], floatSel, {
        fxKind: 'rain', variant: 'meteor', elem: 'fire', count: 1,
        area: area, delayMs: castDelay, travelMs: [travelMs], angle: Math.PI / 3,
        vfxTier: 7, hit: false,
        vfxRoles: { cast: meteorRoles.cast, projectile: meteorRoles.projectile,
          ground: meteorRoles.ground, field: meteorRoles.field }
      });
    } else {
      sgEmitVfx('fireball', [primary], floatSel, {
        fxKind: 'projectile', variant: 'fireball-small', elem: 'fire', count: 1,
        travelMs: [fireballPlan.travelMs], projectile: true
      });
    }

    if (meteor) {
      sgQueueMeteor(pEnt, st, dmgVal, meteorTarget, pool, radius, burnSpec, floatSel, out,
        GT + hitDelay / 1000, meteorExtra);
    } else {
      var splitTargets = [];
      var splitDmgVal = 0;
      if (lvs[2] > 0) {
        var splitFxPlan = t[2].fx;
        // 「射向目標 m 米內的敵人」沒有指定最近＝範圍內隨機
        splitTargets = bfRandomOthers(primary, pool, splitCount,
          bfMeterPx(sgGeometryNumber(splitFxPlan, 'm') || 20), null);
        splitDmgVal = dmgVal * sgVal(splitFxPlan, 'pct', lvs[2]) / 100;
      }
      sgQueueFlyingProjectile(pEnt, st, 'fireball', dmgVal,
        fireballPlan.origin, fireballPlan.angle, fireballPlan.length, floatSel, [primary], {
          singleHit: true, targetOnly: true, waitForEnd: fireballPlan.waitForEnd,
          travelMs: fireballPlan.travelMs, speed: fireballPlan.speed, hitFn: sgFireballProjectileHit,
          victims: victims, blastRadius: radius, splitTargets: splitTargets, splitDmgVal: splitDmgVal, burnSpec: burnSpec,
          burnBonusPct: burnBonusPct, poolSpec: poolSpec
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
   第 7 階【無限火龍】依設計文檔「改為」火牆：增加本體段數、傷害%改讀第 7 階，
   第 2~6 階的進化效果照舊生效。
   =========================================================================== */
function sgCastFirepillar(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var lg = sgLegend('firepillar');
  var ultTempest = sgUlt('firepillar', 'infernoTempest');
  var ultInferno = sgUlt('firepillar', 'eternalInferno');
  var ultDevour = sgUlt('firepillar', 'dragonDevour');
  if (ultDevour) {
    sgCastDragonDevour(pEnt, st, g, ultDevour, primary, floatSel);
    return;
  }
  var infinite = lvs[6] > 0;
  var srcFx = infinite ? t[6].fx : t[0].fx;
  var srcLv = infinite ? lvs[6] : lvs[0];
  var pct = sgVal(srcFx, 'pct', srcLv);
  if (lvs[2] > 0) pct += sgVal(t[2].fx, 'pct', lvs[2]); // 雙重火龍捲：火屬性傷害額外加成
  var dmgVal = sgGroupBaseStat(g, st) * pct / 100;
  /* 段數＝本體 ＋ 傳奇【火焰爆衝】。
     壽命固定不變，段數變多＝節拍變密，因此多出來的段數就是實打實的多幾段傷害。 */
  var hits = Math.max(1, Math.floor(Number(t[0].fx.hits) || 5) +
    (infinite ? Math.max(0, Math.floor(Number(t[6].fx.hitsAdd) || 0)) : 0) +
    Math.max(0, Math.floor(Number(lg.firepillarHitsAdd && lg.firepillarHitsAdd.hits) || 0)));
  var lifeSec = Math.max(0.2, (infinite && Number(t[6].fx.sec)) || Number(t[0].fx.sec) || 2.5);
  var gap = lifeSec / hits;
  // 強化火龍捲：範圍擴大（火龍捲＝半徑、火牆＝長寬同步放大）；傳奇【火龍擴散】再乘上去
  var scale = lvs[1] > 0 ? 1 + sgVal(t[1].fx, 'pct', lvs[1]) / 100 : 1;
  scale *= 1 + Math.max(0, Number(lg.firepillarScalePct) || 0) / 100;
  var burnSpec = sgFirepillarBurnSpec(g, lvs, dmgVal);

  var count = lvs[2] > 0 ? Math.max(1, Math.floor(Number(t[2].fx.count) || 2)) : 1;
  var tempest = ultTempest ? {
    gap: Number(ultTempest.def.fx.gap), count: Number(ultTempest.def.fx.count),
    range: bfMeterPx(ultTempest.def.fx.searchM), radius: bfMeterPx(ultTempest.def.fx.m),
    speed: bfMeterPx(ultTempest.def.fx.speed),
    dmgVal: sgGroupBaseStat(g, st) * sgUltVal(ultTempest, 'pct') / 100,
    roles: sgVfxRoles('firepillar', { vfxUlt: 'infernoTempest' })
  } : null;
  var spreadPx = lvs[2] > 0 ? bfMeterPx(sgGeometryNumber(t[2].fx, 'm') || 20) : skills2CastRangePx('firepillar', lvs);
  var spots = [primary];
  // 「可同時對 m 米內的 count 個目標施放火柱」沒有指定最近＝範圍內隨機
  if (count > 1) spots = spots.concat(bfRandomOthers(primary, pool, count - 1, spreadPx, null));

  /* 移動：傳奇【追蹤烈焰】追著敵人跑；超神【永劫火獄】在附近隨機游走並沿路留下火池。
     兩者同時成立時以追蹤為準——追蹤是更明確的行為指定，而火池只看「移動軌跡」，
     不論走的是追蹤路徑還是游走路徑都照留。 */
  var chase = lg.firepillarChase || null;
  var chasePx = chase ? bfMeterPx(sgGeometryNumber(chase, 'm') || 30) : 0;
  var wanderPx = ultInferno ? bfMeterPx(sgUltVal(ultInferno, 'm')) : 0;
  /* 游走速度設計文檔沒有指定，取「一個壽命剛好走完一次游走半徑」＝ 游走半徑 ÷ 壽命，
     不另外發明一個數字；追蹤有明確的 12 米／秒就直接用它。 */
  var speedPx = chase ? bfMeterPx(Number(chase.mps) || 0)
    : infinite ? bfMeterPx(sgGeometryNumber(t[6].fx, 'speed') || 6)
    : (wanderPx > 0 ? wanderPx / lifeSec : 0);
  var trailSpec = ultInferno ? {
    radiusPx: bfMeterPx(sgVal(t[0].fx, 'm', lvs[0])) * scale,  // 火池大小＝火龍捲自己的判定範圍
    gap: sgGeometryNumber(ultInferno.def.fx, 'gap') || 0.5,
    sec: sgUltVal(ultInferno, 'sec'),
    dmgVal: dmgVal * sgUltVal(ultInferno, 'pct') / 100,
    vfxUlt: 'eternalInferno'
  } : null;
  // 傳奇【爆燃】：每段傷害使該敵人受到的燃燒傷害提高（放大量由特效參數決定）
  var burnAmp = (lg.firepillarBurnAmp && Number(lg.firepillarBurnAmp.pct) > 0) ? {
    pct: Number(lg.firepillarBurnAmp.pct),
    dur: burnSpec ? burnSpec.dur : (Number(t[3].fx.dotSec) || 4)
  } : null;

  for (var i = 0; i < count; i++) {
    // 目標不足時多出來的火龍捲疊在主目標身上（比照雙刀亂舞「只有 1 個敵人就都打同一個」）
    var spot = spots[i % spots.length];
    sgSpawnGround(pEnt, st, 'firepillar', {
      kind: 'pillar', tgt: spot, floatSel: floatSel, vfxTier: infinite ? 7 : 1,
      from: null,
      radius: bfMeterPx(sgVal(t[0].fx, 'm', lvs[0])) * scale,
      // 火柱只帶圓形半徑；否則顯示與命中查詢都會誤用火牆的矩形。
      length: 0, width: 0,
      dmgVal: dmgVal, hits: hits, gap: gap,
      burnSpec: burnSpec, burnChance: lvs[3] > 0 ? sgSlotChance('firepillar', '4', 'enemy', 0, sgVal(t[3].fx, 'chance', lvs[3])) : 0,
      respawnLeft: infinite ? Math.max(0, Math.floor(Number(t[6].fx.respawn) || 0)) : 0,
      delaySec: i * gap * 0.2,
      fireHunt: infinite, chaseM: chasePx, wanderM: chasePx > 0 ? 0 : wanderPx, speed: speedPx,
      trail: trailSpec, burnAmp: burnAmp, tempest: tempest
    });
  }
}

/* 烈焰暴風：每道龍捲獨立計時；飛行中追蹤目標，抵達才查當下爆炸範圍。 */
function sgTickInfernoTempest(f, enemies) {
  var t = f.tempest;
  if (!t || !f.pEnt || f.pEnt.hp <= 0) return;
  var endAt = f.startAt + f.hits * f.gap;
  while (t.nextAt <= GT && t.nextAt <= endAt) {
    t.nextAt += t.gap;
    var targets = bfLiveList(enemies).filter(function (e) {
      var p = bfPos(e);
      if (e._enterCd > 0) return false;
      return f.pos && p ? Math.hypot(p.x-f.pos.x,p.y-f.pos.y) <= t.range : !p && e === f.tgt;
    });
    // 每輪重新隨機選不同目標，不沿用上一輪，也不依距離排序。
    bfRandomOthers(null, targets, t.count, 0, null).forEach(function(target) {
      var p=bfPos(target),start=f.pos,end=p?{x:p.x,y:p.y}:null;
      var travel=start&&end?Math.max(.05,Math.hypot(end.x-start.x,end.y-start.y)/t.speed):.26;
      var area=start&&end?{x:end.x,y:end.y,r:t.radius,sourceX:start.x,sourceY:start.y,homingFlight:true,homingSpeed:t.speed}:null;
      sgEmitVfx('firepillar',[target],f.floatSel,{fxKind:'projectile',variant:'inferno-tempest-ball',
        projectile:true,hit:false,arcM:0,travelMs:[travel*1000],area:area,
        vfxRoles:{projectile:t.roles.projectile}});
      SKILL2_RT.projectiles.push({tempestFlight:true,pEnt:f.pEnt,st:f.st,target:target,
        position:start?{x:start.x,y:start.y}:null,previousTarget:end,speed:t.speed,lastAt:sgProjectileNow(),
        area:area,endAt:sgProjectileNow()+travel,dmgVal:t.dmgVal,roles:t.roles,floatSel:f.floatSel});
    });
  }
}

function sgResolveInfernoTempest(shot, ctx) {
  if (!shot.pEnt || shot.pEnt.hp <= 0) return;
  var targetPos = bfPos(shot.target);
  if (shot.area && targetPos) { shot.area.x = targetPos.x; shot.area.y = targetPos.y; }
  var enemies=bfLiveList(ctx.getEnemies?ctx.getEnemies():[]);
  var victims=shot.area?bfEnemiesInArea(shot.area,enemies):enemies.filter(function(e){return e===shot.target;});
  sgEmitVfx('firepillar',shot.area?[]:victims,shot.floatSel,{fxKind:'burst',variant:'inferno-tempest-impact',
    area:shot.area,hit:false,vfxRoles:{attack:shot.roles.attack}});
  var out={killed:false,dmg:0,crit:false};
  victims.forEach(function(e){sgHitOne(shot.pEnt,shot.st,e,shot.dmgVal,'firepillar',shot.floatSel,out,0,0,'fire',e===shot.target);});
  if(out.dmg>0&&ctx.onDamage)ctx.onDamage(out.dmg);
  if(out.killed&&ctx.onDeaths)ctx.onDeaths();
}

/* 吞噬替換整個火龍捲本體：固定地面漩渦，噴射不參與搜敵。
   小火球沿用延後啟動的一次性場域，落地才查詢當時的敵人。 */
function sgCastDragonDevour(pEnt, st, g, u, primary, floatSel) {
  // 新施放取代舊漩渦；已離開漩渦的火球繼續完成飛行與落地。
  SKILL2_RT.grounds = SKILL2_RT.grounds.filter(function (f) { return f.kind !== 'devour'; });
  var fx = u.def.fx, center = bfPos(pEnt) || bfPlayerPos();
  var roles = sgVfxRoles('firepillar', { vfxUlt: u.id, vfxBase: true });
  var trigger = sgVfxRoles('firepillar', { vfxUlt: u.id });
  var gap = Number(fx.gap), sec = Number(fx.sec);
  sgSpawnGround(pEnt, st, 'firepillar', {
    kind: 'devour', from: center, tgt: primary, floatSel: floatSel,
    radius: bfMeterPx(fx.m), dmgVal: sgGroupBaseStat(g, st) * sgUltVal(u, 'pct') / 100,
    gap: gap, hits: Math.floor(sec / gap), lifeSec: sec,
    devour: { fx: fx, roles: roles, trigger: trigger, nextShotAt: GT,
      shotIndex: 0, shotCount: 0, secondAt: GT,
      ballDmg: sgGroupBaseStat(g, st) * Number(fx.ballPct) / 100 }
  });
  var f = SKILL2_RT.grounds[SKILL2_RT.grounds.length - 1];
  sgEmitVfx('firepillar', [], floatSel, { fxKind: 'aura', variant: 'dragon-devour',
    dur: sec, area: sgGroundArea(f), vfxRoles: { field: roles.field }, hit: false });
}

function sgTickDragonDevour(f, dt, enemies) {
  if (!f.pEnt || f.pEnt.hp <= 0) { f.hitsLeft = 0; f.expiresAt = 0; return; }
  var d = f.devour, fx = d.fx, until = Math.min(GT, f.expiresAt);
  while (d.nextShotAt <= until && d.nextShotAt < f.expiresAt) {
    if (d.shotIndex >= d.shotCount) {
      d.secondAt = d.nextShotAt;
      d.shotCount = Number(fx.ballMin) + Math.floor(Math.random() * (Number(fx.ballMax) - Number(fx.ballMin) + 1));
      d.shotIndex = 0;
    }
    var a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * bfMeterPx(fx.ballRange);
    var end = { x: f.pos.x + Math.cos(a) * r, y: f.pos.y + Math.sin(a) * r };
    var travel = Number(fx.ballSec), radius = bfMeterPx(fx.ballM);
    sgEmitVfx('firepillar', [], f.floatSel, {
      fxKind: 'projectile', variant: 'dragon-devour-ball', projectile: true, hit: false,
      travelMs: [travel * 1000], arcM: Number(fx.arcM),
      area: { x: end.x, y: end.y, sourceX: f.pos.x, sourceY: f.pos.y, fixedLanding: true },
      vfxRoles: { projectile: d.roles.projectile }
    });
    sgSpawnGround(f.pEnt, f.st, 'firepillar', {
      kind: 'devourblast', from: end, tgt: f.tgt, floatSel: f.floatSel,
      radius: radius, dmgVal: d.ballDmg, gap: travel, hits: 1,
      devour: null
    });
    var ball = SKILL2_RT.grounds[SKILL2_RT.grounds.length - 1];
    ball.devourRoles = d.trigger;
    d.shotIndex++;
    d.nextShotAt = d.secondAt + d.shotIndex / d.shotCount;
  }
}

// 每拍只聚攏傷害圈外的敵人；體型邊緣已接觸範圍者保持原位。
function sgPullDragonDevour(f, enemies) {
  var pullR = bfMeterPx(f.devour.fx.pullM);
  for (var i = 0; i < enemies.length; i++) {
    var enemy = enemies[i], p = bfPos(enemy);
    if (!p || enemy.hp <= 0 || enemy._enterCd > 0) continue;
    var dx = p.x - f.pos.x, dy = p.y - f.pos.y, dist = Math.hypot(dx, dy);
    var stop = bfEntityRadius(enemy);
    if (dist <= f.radius + stop || dist > pullR) continue;
    p.x = f.pos.x + dx / dist * stop;
    p.y = f.pos.y + dy / dist * stop;
  }
}

function sgDevourDamage(f, enemies, ctx) {
  if (!f.pEnt || f.pEnt.hp <= 0) return;
  if (f.kind === 'devour') sgPullDragonDevour(f, enemies);
  // 高塔沒有世界座標，沿既有技能規則退化為固定的單一主目標。
  var victims = f.tgt && !bfPos(f.tgt) ? (f.tgt.hp > 0 ? [f.tgt] : []) : sgGroundVictims(f, enemies);
  var out = { killed: false, dmg: 0, crit: false };
  if (f.kind === 'devourblast') {
    sgEmitVfx('firepillar', [], f.floatSel, { fxKind: 'burst', variant: 'dragon-devour-impact',
      area: sgGroundArea(f), vfxRoles: { attack: f.devourRoles.attack }, hit: false });
  }
  for (var i = 0; i < victims.length; i++) {
    sgHitOne(f.pEnt, f.st, victims[i], f.dmgVal, 'firepillar', f.floatSel, out, 0, 0, 'fire');
  }
  if (ctx && ctx.onDamage && out.dmg > 0) ctx.onDamage(out.dmg);
  if (out.killed && ctx && ctx.onDeaths) ctx.onDeaths();
}

/* ---- 火池（地板上的一灘火）----
   兩個來源共用同一種場域，只有參數來源不同：
     ・傳奇【火池】：火球／殞石爆炸後留在爆點
     ・超神【永劫火獄】：火龍捲游走時沿路留下
   命中採一般的節拍判定（站在裡面就每 gap 吃一段），不塗燃燒——設計文檔只寫傷害。
   顯示層沿用熔岩沼的既有畫法（不認得的 variant 只會退回泛用光環，等於看不出範圍）。 */
function sgSpawnFirePool(pEnt, st, gid, spec, floatSel, tgt, from) {
  if (typeof sgSpawnGround !== 'function' || !spec || !(spec.dmgVal > 0)) return;
  var gap = Math.max(0.1, Number(spec.gap) || 0.5);
  var sec = Math.max(gap, Number(spec.sec) || 4);
  sgSpawnGround(pEnt, st, gid, {
    kind: 'firepool', tgt: tgt || null, from: from || null, floatSel: floatSel,
    radius: Number(spec.radiusPx) > 0 ? Number(spec.radiusPx) : bfMeterPx(Number(spec.m) || 6),
    dmgVal: spec.dmgVal, hits: Math.max(1, Math.round(sec / gap)), gap: gap,
    hitElem: 'fire',
    vfxUlt: spec.vfxUlt || '',
    /* 特效欄位跟著「畫法的擁有者」走：超神【永劫火獄】那一列自己有地板特效，
       傳奇【火池】沒有——它掛在火球術／殞石術底下，而那些列的地板欄是空的。
       傳奇火池明確借用熔岩沼配置，不依賴空欄時補舊畫法。
       借的是熔岩沼那一列，與上面「顯示層沿用熔岩沼」的決定同一個來源。 */
    vfxGid: spec.vfxUlt ? '' : 'mire', vfxTier: spec.vfxUlt ? 0 : 7
  });
}

/* 傳奇【火池】目前的規格（沒有這個特效＝null）。dmgVal 以施放當下的本體傷害定版。 */
function sgFirePoolSpec(lg, dmgVal) {
  var p = lg && lg.firePool;
  if (!p || !(dmgVal > 0)) return null;
  return { m: sgGeometryNumber(p, 'm') || 6, gap: sgGeometryNumber(p, 'gap') || 0.5, sec: Number(p.sec) || 4,
    dmgVal: dmgVal * (Number(p.pct) || 0) / 100 };
}

/* 建立一個地板場域實例。pos 於此時定位（釘在地板上，之後與目標實體脫鉤——
   目標死了火龍捲也還在燒）。 */
function sgSpawnGround(pEnt, st, gid, cfg) {
  /* cfg.from＝指定出生座標（移動場域從玩家腳下出發、伴生雷球生在命中處）；
     留白＝比照火龍捲，出生在目標當下的位置。 */
  var p = (cfg.from && isFinite(cfg.from.x) && isFinite(cfg.from.y))
    ? { x: Number(cfg.from.x), y: Number(cfg.from.y) }
    : ((typeof bfPos === 'function' && cfg.tgt) ? bfPos(cfg.tgt) : null);
  /* cfg.angle＝直接指定朝向（雷電矩陣的雷幕要沿指定方位橫掃，沒有「目標」可以推算）；
     留白＝比照火牆，朝向目標當下的方位。 */
  var angle = (typeof cfg.angle === 'number' && isFinite(cfg.angle)) ? cfg.angle
    : ((typeof bfAngleTo === 'function' && cfg.tgt) ? bfAngleTo(cfg.tgt) : null);
  var gap = Math.max(0.05, sgGeometryNumber(cfg, 'gap') || 0.5);
  var startDelaySec = Math.max(0, Number(cfg.startDelaySec) || 0);
  SKILL2_RT.grounds.push({
    vfxId: 'sg-ground-' + (++SKILL2_RT.groundSeq),
    gid: gid, pEnt: pEnt, st: st, floatSel: cfg.floatSel, kind: cfg.kind,
    /* 特效欄位的列標記（見 sgVfxRoles）：這片場域是表上哪一階／哪個超神引入的。 */
    vfxTier: cfg.vfxTier || 0, vfxUlt: cfg.vfxUlt || '', vfxGid: cfg.vfxGid || '',
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
    speed: Math.max(0, sgGeometryNumber(cfg, 'speed') || 0),
    spiralCentre: cfg.spiralCentre || null,
    fireHunt: !!cfg.fireHunt,
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
    chaseM: Math.max(0, sgGeometryNumber(cfg, 'chaseM') || 0),
    contact: !!cfg.contact,
    contacts: [],
    /* 對凍結中的敵人的傷害倍率（水龍捲）；1＝沒有額外倍率。 */
    frozenMult: Math.max(1, Number(cfg.frozenMult) || 1),
    /* 對「暈眩或凍結中」的敵人的額外傷害百分點（傳奇【深度凍結】）。
       與 frozenMult 分開是因為那一支只認凍結、而且是倍率不是百分點；
       兩者同時存在時各自加總（都走 sgHitOne 的總傷加成，仍完整過防禦與爆擊）。 */
    ctrlPct: Math.max(0, Number(cfg.ctrlPct) || 0),
    /* 命中後的附加效果，每個受害者各呼叫一次：onHit(f, victim, enemies, out, ctx)。
       語意比照環繞場域的 onStrike——超神【雷爆】的小型雷球與傳奇【冰裂箭】的分裂箭
       都掛在這裡，不必為每一種形態再開一個場域旗標。 */
    onHit: cfg.onHit || null,
    /* ---- 傳奇進化第十一批（風刃）----
       ramp＝「每命中 1 次就再強一點」的累加器（傳奇【裂風】）：加成在命中前讀、
             命中後才累加，因此套用在**後續**的命中上（與飛行物那條路同一種語意）。
       slowSlot／slowPct＝命中時附加的減益（第 6 階【狂風碎裂】的移速下降；狀態由表格位置決定）。
       pulse*＝沿途脈衝：以場域當下位置為圓心每 pulseGap 秒炸一次周圍。
             欄位與飛行物的 pulse 同名同義——超神【暴風萬刃】把大型風刃從飛行物改成
             追擊場域之後，第 6 階的沿途爆炸得跟著換這條路走，不能安靜地消失。 */
    ramp: cfg.ramp || null,
    slowSlot: cfg.slowSlot || null,
    slowPct: Math.max(0, Number(cfg.slowPct) || 0),
    pulseGap: Math.max(0, Number(cfg.pulseGap) || 0),
    pulseRadius: Math.max(0, Number(cfg.pulseRadius) || 0),
    pulseDmg: Math.max(0, Number(cfg.pulseDmg) || 0),
    pulseVariant: cfg.pulseVariant || '',
    nextPulseAt: GT + startDelaySec + Math.max(0.05, Number(cfg.pulseGap) || 0.5),
    frostSpec: cfg.frostSpec || null,
    /* ---- 傳奇進化第五批（火龍捲）----
       wanderM＝超神【永劫火獄】的隨機游走半徑（以 home 為圓心；chaseM 優先，兩者不並用）
       home＝游走的圓心（出生座標的快照，之後 pos 會一直變）
       trail＝移動軌跡上要留下的火池規格（每一拍留一灘）
       burnAmp＝傳奇【爆燃】每段命中要疊的燃燒傷害放大
       pullM＝超神【火龍之吞噬】每一拍把敵人拉向我方中心的半徑 */
    wanderM: Math.max(0, Number(cfg.wanderM) || 0),
    home: p ? { x: p.x, y: p.y } : null,
    trail: cfg.trail || null,
    burnAmp: cfg.burnAmp || null,
    pullM: Math.max(0, Number(cfg.pullM) || 0),
    mire: cfg.mire || null,
    devour: cfg.devour || null,
    tempest: cfg.tempest ? Object.assign({}, cfg.tempest, {nextAt:GT+startDelaySec+cfg.tempest.gap}) : null,
    expiresAt: cfg.lifeSec > 0 ? GT + cfg.lifeSec : 0
  });
}

/* 場域實例的總量上限：超神【永劫火獄】是「每一拍留一灘火池」，
   多道火龍捲同時留下軌跡可能使場域數量失控。
   這是防呆上限（超過就不再生成軌跡火池），不是設計數值。 */
var SG_GROUND_MAX_FIELDS = 96;

/* 傳奇【火龍共鳴】：場上每存在 1 道火龍捲（含火牆），所有火龍捲的傷害提高。
   只數火龍捲本體——火池、毒霧那種衍生場域不是「一道火龍捲」。 */
function sgFirepillarResonancePct(lg) {
  var per = Number(lg && lg.firepillarResonancePct) || 0;
  if (!(per > 0) || !SKILL2_RT || !SKILL2_RT.grounds) return 0;
  var n = 0;
  for (var i = 0; i < SKILL2_RT.grounds.length; i++) {
    var f = SKILL2_RT.grounds[i];
    if (f && f.gid === 'firepillar' && (f.kind === 'pillar' || f.kind === 'wall')) n++;
  }
  return per * n;
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
  if (f.spiralCentre) {
    var dx = f.pos.x - f.spiralCentre.x, dy = f.pos.y - f.spiralCentre.y;
    var r = Math.max(1, Math.hypot(dx, dy));
    var a = Math.atan2(dy, dx);
    var nextR = r + step / 3;
    var nextA = a - Math.sqrt(8) * Math.log(nextR / r);
    f.pos.x = f.spiralCentre.x + nextR * Math.cos(nextA);
    f.pos.y = f.spiralCentre.y + nextR * Math.sin(nextA);
    f.moveAngle = nextA - Math.atan(Math.sqrt(8));
    f.turnRate = -f.speed * Math.sqrt(8) / (3 * nextR);
    return;
  }
  if (f.fireHunt) { sgFireDragonMove(f, step, enemies); return; }
  if (f.chaseM > 0) sgGroundChaseStep(f, step, enemies);   // 追擊：有轉彎半徑的追蹤飛行
  else if (f.wanderM > 0) sgGroundWanderStep(f, step);     // 游走：抵達就在圓內重抽落點
  else sgGroundFlyStep(f, step);                            // 直線飛向落點後停駐（雷球）
}

/* 追擊場域的轉彎半徑（像素）：子彈體積越大轉得越開（設計指定 4～8 米）。
   體積取場域自己的判定半徑——那就是這顆子彈實際的大小，不另外挑一組數字。 */
var SG_CHASE_TURN_MIN_M = 4;
var SG_CHASE_TURN_MAX_M = 8;
var SG_CHASE_TURN_BODY_REF_M = 5;   // 判定半徑到這個值就吃滿最大轉彎半徑
/* 無限火龍持續追敵，單敵時在附近選落點；弧線與顯示層使用相同轉速。 */
function sgFireDragonMove(f, step, enemies) {
  var live = bfLiveList(enemies || []).filter(function (e) { return !!bfPos(e); });
  var target = f.huntTarget;
  if (!target || live.indexOf(target) < 0 || !f.dest || f.huntUntil <= GT) {
    target = live.length ? live[Math.floor(Math.random() * live.length)] : null;
    f.huntTarget = target;
    var p = target ? bfPos(target) : (f.home || f.pos);
    var a = Math.random() * Math.PI * 2;
    var r = Math.max(bfMeterPx(1), f.radius * 0.5);
    f.huntOffset = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    f.huntUntil = GT + r * 2 / f.speed;
    f.dest = { x: p.x + f.huntOffset.x, y: p.y + f.huntOffset.y };
  }
  if (target) {
    var pos = bfPos(target);
    f.dest.x = pos.x + f.huntOffset.x; f.dest.y = pos.y + f.huntOffset.y;
  }
  var dx = f.dest.x - f.pos.x, dy = f.dest.y - f.pos.y;
  var want = Math.atan2(dy, dx);
  var before = typeof f.moveAngle === 'number' ? f.moveAngle : want;
  var diff = Math.atan2(Math.sin(want - before), Math.cos(want - before));
  var turnR = Math.max(bfMeterPx(1), f.radius * 0.5);
  var turn = Math.max(-step / turnR, Math.min(step / turnR, diff));
  f.moveAngle = before + turn;
  f.turnRate = turn * f.speed / step;
  if (Math.abs(turn) > 1e-8) {
    var radius = step / turn;
    f.pos.x += radius * (Math.sin(f.moveAngle) - Math.sin(before));
    f.pos.y += radius * (Math.cos(before) - Math.cos(f.moveAngle));
  } else {
    f.pos.x += Math.cos(before) * step; f.pos.y += Math.sin(before) * step;
  }
  if (Math.hypot(dx, dy) <= step) f.dest = null;
}

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
  var startAngle = f.moveAngle;
  f.turnRate = 0;
  if (!f.dest) f.dest = sgGroundChaseDest(f, enemies);
  var turnR = sgGroundTurnRadiusPx(f);
  if (f.dest) {
    var dx = f.dest.x - f.pos.x, dy = f.dest.y - f.pos.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var want = Math.atan2(dy, dx);
    if (!isFinite(f.moveAngle)) f.moveAngle = want;
    if (!isFinite(startAngle)) startAngle = f.moveAngle;
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
  if ((f.kind === 'icearrow' || f.kind === 'windblade') && isFinite(startAngle) && step > 0) {
    var turn = f.moveAngle - startAngle;
    f.turnRate = turn * f.speed / step;
    if (Math.abs(turn) > 1e-8) {
      var radius = step / turn;
      f.pos.x += radius * (Math.sin(f.moveAngle) - Math.sin(startAngle));
      f.pos.y += radius * (Math.cos(startAngle) - Math.cos(f.moveAngle));
      return;
    }
  }
  f.pos.x += Math.cos(f.moveAngle) * step;
  f.pos.y += Math.sin(f.moveAngle) * step;
}

/* 游走場域（超神【永劫火獄】）：在出生點半徑 wanderM 的圓內隨機挑落點，
   抵達（或落點失效）就重抽一個，因此不會像雷球那樣抵達後停駐。
   圓心固定為出生座標而不是當下位置，才不會隨機漫步漂到範圍之外。

   轉彎與追擊場域共用同一條規則（sgGroundChaseStep）：一步能轉的角度＝
   這一步的弧長 ÷ 轉彎半徑。直接把方向對準新落點的話，火龍捲會在每個落點
   原地折一次角——那是實際判定位置的硬轉彎，顯示層再平滑也補不出一個本來
   就不存在的弧（AI_RULES 8.3.1）。 */
function sgGroundWanderStep(f, step) {
  if (!f.home) f.home = { x: f.pos.x, y: f.pos.y };
  if (!f.dest) f.dest = sgGroundWanderDest(f);
  var dx = f.dest.x - f.pos.x, dy = f.dest.y - f.pos.y;
  var dist = Math.sqrt(dx * dx + dy * dy);
  var want = Math.atan2(dy, dx);
  if (!isFinite(f.moveAngle)) f.moveAngle = want;
  var turnR = sgGroundTurnRadiusPx(f);
  var diff = Math.atan2(Math.sin(want - f.moveAngle), Math.cos(want - f.moveAngle));
  var maxTurn = turnR > 0 ? step / turnR : Math.PI;
  f.moveAngle += Math.max(-maxTurn, Math.min(maxTurn, diff));
  /* 換下一個落點：走到了，或落點已經掉進自己的迴轉圈內又不在正前方——
     最小轉彎半徑限制下那種落點永遠繞不進去，硬追只會變成繞著它打轉。 */
  if (dist <= step || dist <= 0.5 || (dist <= turnR && Math.abs(diff) > Math.PI / 2)) {
    f.dest = sgGroundWanderDest(f);
  }
  f.pos.x += Math.cos(f.moveAngle) * step;
  f.pos.y += Math.sin(f.moveAngle) * step;
}

/* 圓內均勻取點（sqrt 是為了讓面積均勻，否則會擠在圓心）。 */
function sgGroundWanderDest(f) {
  var a = Math.random() * Math.PI * 2;
  var r = f.wanderM * Math.sqrt(Math.random());
  return { x: f.home.x + Math.cos(a) * r, y: f.home.y + Math.sin(a) * r };
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
/* 矩形場域的**牆身**軸向：牆型場域（火牆／雷幕）的牆身垂直於朝向，其餘（泥沼／暴風雪）
   是與座標軸對齊的地板矩形。⚠️ 這一支同時決定傷害矩形（sgGroundVictims）與顯示矩形
   （sgGroundArea）——漏掉某一種牆型場域的話，牆身會沿著行進方向躺平，
   變成「一條跟著自己跑的長條」而不是一道橫掃過去的牆。 */
function sgGroundRectAxis(f) {
  // 方形地面沿菱形地磚鋪設；判定與 sgGroundArea 共用同一個方向。
  if (f.kind === 'mire' || f.kind === 'blizzard') return Math.PI / 4;
  return (f.kind === 'wall' || f.kind === 'thunderwall') ? f.angle + Math.PI / 2 : 0;
}

/* 場域這一跳打到誰：火龍捲＝圓、火牆／泥沼＝矩形（以線段＋半寬表示）。
   無座標＝退化為固定打當初的目標。 */
function sgGroundVictims(f, enemies) {
  if (!f.pos) return (f.tgt && f.tgt.hp > 0) ? [f.tgt] : [];
  if (f.length > 0 && f.width > 0 && typeof bfSegmentTargets === 'function') {
    var axis = sgGroundRectAxis(f);
    if (f.kind === 'mire' || f.kind === 'blizzard') {
      // 地面方形必須用矩形邊界；線段加半寬是膠囊，兩端會超出圖上的邊長。
      var co = Math.cos(axis), si = Math.sin(axis);
      return bfLiveList(enemies).filter(function (enemy) {
        var p = bfPos(enemy);
        if (!p) return false;
        var dx = p.x - f.pos.x, dy = p.y - f.pos.y;
        var ex = Math.max(0, Math.abs(dx * co + dy * si) - f.length / 2);
        var ey = Math.max(0, Math.abs(-dx * si + dy * co) - f.width / 2);
        var body = bfEntityRadius(enemy);
        return ex * ex + ey * ey <= body * body;
      });
    }
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
  if (f.kind === 'devour' || f.kind === 'devourblast') {
    sgDevourDamage(f, enemies, ctx);
    return;
  }
  /* 超神【火龍之吞噬】：每一拍先把範圍內的敵人拉向我方中心，再查詢這一拍的命中對象——
     先拉再打才是「聚攏起來一起燒」。bfPullEnemies 會夾在各自的停止距離上，
     因此同一拍多道火龍捲重複呼叫不會把敵人疊成一點。 */
  if (f.pullM > 0 && typeof bfPullEnemies === 'function') bfPullEnemies(enemies, f.pullM, 0);
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
  /* 超神【永劫火獄】：移動軌跡上留下火池（每一拍在當下位置放一灘）。
     沒有敵人時照留——火池是留在地上的，不是打在敵人身上的。 */
  if (f.trail && f.pos && SKILL2_RT.grounds.length < SG_GROUND_MAX_FIELDS) {
    sgSpawnFirePool(f.pEnt, f.st, f.gid, f.trail, f.floatSel, null, f.pos);
  }
  sgEmitVfx(f.gid, victims, f.floatSel, sgGroundVfxSpec(f));
  if (!victims.length) return;
  var out = { killed: false, dmg: 0, crit: false };
  /* 傳奇【火龍共鳴】：場上每存在 1 道火龍捲，所有火龍捲的傷害提高。
     每一拍重算（場上道數隨生滅改變），只有火龍捲本體吃得到。 */
  var resonancePct = (f.gid === 'firepillar' && (f.kind === 'pillar' || f.kind === 'wall'))
    ? sgFirepillarResonancePct(sgLegendTick(f.gid)) : 0;
  for (var i = 0; i < victims.length; i++) {
    /* 對凍結中的敵人的傷害倍率（水龍捲）：走 sgHitOne 的總傷加成參數，
       因此仍完整經過防禦、抗性與爆擊，不是事後再乘一次的獨立傷害。 */
    var bonusPct = ((f.frozenMult > 1 && sgFrozenOn(victims[i])) ? (f.frozenMult - 1) * 100 : 0) +
      resonancePct + sgRampPct(f.ramp) +
      ((f.ctrlPct > 0 && sgIceControlled(victims[i])) ? f.ctrlPct : 0);
    var res = sgHitOne(f.pEnt, f.st, victims[i], f.dmgVal, f.gid, f.floatSel, out,
      sgStaggerMs(i), bonusPct, f.hitElem);
    if (!res || res.miss) continue;
    /* 傳奇【裂風】：命中後才累加，因此這一次命中吃到的仍是累加前的加成。 */
    if (f.ramp) f.ramp.n++;
    /* 第 6 階【狂風碎裂】：追擊型風刃的移速下降（與飛行物那條路同一個狀態鍵）。 */
    if (f.slowSlot && f.slowPct > 0 && victims[i].hp > 0) {
      sgApplySlot(victims[i], f.slowSlot.gid, f.slowSlot.tier, 'enemy', f.slowSlot.idx || 0, { val: f.slowPct });
    }
    if (f.burnSpec && f.burnChance > 0 && chance(f.burnChance)) sgApplyBurn(victims[i], f.burnSpec);
    /* 傳奇【爆燃】：每造成 1 段傷害就使該敵人受到的燃燒傷害提高（疊完才塗燃燒也算數，
       因為 sgApplyBurnAmp 會把已經在燒的那一份就地重寫成放大後的每跳量）。 */
    if (f.burnAmp && victims[i].hp > 0) sgApplyBurnAmp(victims[i], f.burnAmp);
    if (f.frostSpec && victims[i].hp > 0) sgApplyFrost(victims[i], f.frostSpec);
    if (f.onHit) f.onHit(f, victims[i], enemies, out, ctx);
  }
  if (ctx && ctx.onDamage && out.dmg > 0) ctx.onDamage(out.dmg);
  if (out.killed && ctx && ctx.onDeaths) ctx.onDeaths();
}

/* 場域這一拍的特效規格：形狀決定畫法（火柱＝地面爆點、火牆＝直立牆、雷球＝球體），
   屬性交給 sgEmitVfx 由群組帶入，這裡不再寫死 fire。
   sgGroundVfxSpec 在形狀之外再帶上特效欄位的列標記（vfxTier／vfxUlt／vfxGid），
   讓顯示層能讀到「這片場域是哪一階引入的」那一列的地板特效。 */
function sgGroundVfxSpec(f) {
  var spec = sgGroundVfxShape(f);
  spec.vfxTier = f.vfxTier || 0;
  spec.vfxUlt = f.vfxUlt || '';
  spec.vfxGid = f.vfxGid || '';
  return spec;
}
function sgGroundVfxShape(f) {
  var area = sgGroundArea(f);
  if (f.kind === 'wall') return { fxKind: 'aura', variant: 'firewall', elem: 'fire', dur: f.gap, area: area };
  /* 雷電矩陣的雷幕：一排從天而降的落雷沿著判定矩形排開、隨矩形橫掃過去。
     ⚠️ 不能沿用 firewall：那一支的火焰色是寫死在多邊形裡的（theme 只影響少數幾層），
     換成 elem lightning 畫出來還是一道火牆——2026-08-26 使用者實機回報的就是這個。
     kind 用 thunderwall 而不是 wall：wall 會讓 sgGroundExpire 去跑火龍捲樹的第 5／6 階。 */
  if (f.kind === 'thunderwall') return { fxKind: 'aura', variant: 'thunder-curtain', elem: 'lightning', dur: f.gap, area: area };
  if (f.kind === 'orb') return { fxKind: 'aura', variant: 'thunder-orb', dur: f.gap, area: area };
  if (f.kind === 'tornado') return { fxKind: 'aura', variant: 'water-tornado', elem: 'ice', dur: f.gap, area: area };
  /* 超神【怒海狂濤】的巨大水龍捲：畫法就是水龍捲，只有尺寸不同（area 已帶著半徑）。
     kind 之所以分開，是因為它不能算進【怒海狂濤】自己的生成門檻。 */
  if (f.kind === 'tidetornado') return { fxKind: 'aura', variant: 'water-tornado', elem: 'ice', dur: f.gap, area: area };
  /* 冰錐（傳奇【寒冰衝擊】／超神【冰皇領域】）：從地面昇起的柱狀物，語意與水龍捲同一種
     「立在地上的柱子」，因此沿用它的既有畫法，不自創顯示層不認得的變體。 */
  if (f.kind === 'icespike') return { fxKind: 'aura', variant: 'water-tornado', elem: 'ice', dur: f.gap, area: area };
  /* 逐風者的龍捲風：沿用水龍捲的柱狀畫法，只換屬性配色（顯示層不認得 wind-tornado
     時會退回預設畫法，仍看得到範圍）。 */
  if (f.kind === 'windtornado') return { fxKind: 'aura', variant: 'wind-tornado', elem: 'wind', dur: f.gap, area: area };
  /* 火池（傳奇【火池】／超神【永劫火獄】）：地板上的一灘火，語意與熔岩沼相同，
     因此沿用 mire-lava 的既有畫法，不自創顯示層不認得的 variant。 */
  if (f.kind === 'firepool') return { fxKind: 'aura', variant: 'mire-lava', elem: 'fire', dur: f.gap, area: area };
  if (f.kind === 'blizzard') return { fxKind: 'aura', variant: 'blizzard', elem: 'ice', dur: f.gap, area: area };
  if (f.kind === 'icearrow') return { fxKind: 'aura', variant: 'ice-arrow-homing', elem: 'ice', dur: f.gap, area: area };
  /* 超神【冰之淚】的箭雨：從天而降的一片箭，語意就是既有的 rain。
     不自創顯示層不認得的 variant——兩個渲染器對 rain 都有泛用分支（Canvas 的
     spawnRain 與 DOM 的範圍矩形），因此不必為它各補一支畫法。 */
  if (f.kind === 'icerain') return { fxKind: 'rain', variant: 'ice-rain', elem: 'ice', dur: f.gap, area: area };
  if (f.kind === 'windblade') return { fxKind: 'aura', variant: 'wind-blade-homing', elem: 'wind', dur: f.gap, area: area };
  /* 超神【萬象風劫】留在原地的真空斬：語意就是「一道停在地上的風刃」，
     因此沿用追擊風刃的既有畫法（兩個渲染器都認得，且尺寸跟著 area 走），
     不自創顯示層不認得的 variant。kind 之所以分開，是為了不跑進風刃自己的
     追擊／落點欄位（它不會移動，也沒有 dest）。 */
  if (f.kind === 'vacuumfield') return { fxKind: 'aura', variant: 'wind-blade-homing', elem: 'wind', dur: f.gap, area: area };
  /* 毒爆／血霧留下的是一灘東西，語意與泥沼池相同，因此直接沿用 mire 的既有畫法；
     沿用既有 variant 而不是自創，是因為顯示層不認得的 variant 只會退回泛用光環。 */
  if (f.kind === 'poisonmist') return { fxKind: 'aura', variant: 'mire-poison', elem: 'poison', dur: f.gap, area: area };
  if (f.kind === 'bloodmist') return { fxKind: 'aura', variant: 'mire', elem: 'dark', dur: f.gap, area: area };
  return { fxKind: 'impact', variant: 'pillar', elem: 'fire', dur: f.gap, area: area };
}

/* 這一拍場域到底有沒有在動。sgGroundMove 的三條分支各有各的「停」：
   追擊沒有落點時仍沿最後方向直線飛（停下來就等於不再命中任何東西）；
   飛向落點與游走則是沒有落點＝已經停駐。 */
function sgGroundMoving(f) {
  if (!f.pos || !(f.speed > 0)) return false;
  if (f.fireHunt || f.chaseM > 0 || f.spiralCentre) return true;
  return !!f.dest;
}

/* 移動場域的運動語意（顯示層專用，不參與傷害幾何）。
   AI_RULES 8.3.1：事件必須帶足以重現這段連續運動的資料，否則顯示層只拿得到
   一串離散座標，畫出來就是一格一格。三個欄位各有職責：
     speed  模擬層當下的移動速度        moveA  當下的航向（追擊是有轉彎半徑的）
     destX/destY  落點（等速直線飛向落點的場域抵達後就停駐，畫面要跟著停）
   顯示層據此在兩則事件之間自走，再把殘差連續修正回 area.x/y——
   不得由顯示層另建一條與傷害位置脫節的路徑。 */
function sgGroundMotionFields(f, out) {
  if (!sgGroundMoving(f)) return out;
  out.speed = f.speed;
  if (isFinite(f.moveAngle)) out.moveA = f.moveAngle;
  if (f.fireHunt || f.kind === 'icearrow' || f.kind === 'windblade' || f.spiralCentre) out.turnRate = Number(f.turnRate) || 0;
  if (f.dest && !f.fireHunt && f.kind !== 'windblade') {
    out.destX = f.dest.x;
    out.destY = f.dest.y;
  }
  return out;
}

/* 場域的地面範圍描述（顯示層用）。矩形場域帶 w/h/a 讓顯示層畫出方向正確的矩形；
   同時附上 r（外接圓半徑）讓不認得矩形的舊畫法仍有合理的退化尺寸。 */
function sgGroundArea(f) {
  if (!f.pos) return null;
  if (f.length > 0 && f.width > 0) {
    var rect = { id: f.vfxId, x: f.pos.x, y: f.pos.y, w: f.length, h: f.width,
      a: sgGroundRectAxis(f), r: Math.max(f.length, f.width) / 2 };
    /* 跟隨我方的場域（暴風雪）圓心恆等於玩家座標：顯示層每幀直接貼玩家錨點，
       不必也不該補間。 */
    if (f.follow) rect.follow = true;
    return sgGroundMotionFields(f, rect);
  }
  var circle = { id: f.vfxId, x: f.pos.x, y: f.pos.y, r: f.radius };
  /* 泥沼池系列的畫法（毒爆／血霧沿用它）只讀 a.w／a.h，完全不讀 a.r：
     不補外接矩形的話，這兩種場域會被畫成固定尺寸，與實際判定範圍對不上。
     只補這兩種——其餘圓形場域（火柱／雷球／追蹤冰箭）的畫法都是讀 a.r，
     多給 w/h 反而可能改到已經調好的既有尺寸。 */
  if (f.kind === 'poisonmist' || f.kind === 'bloodmist' || f.kind === 'firepool') {
    circle.w = f.radius * 2;
    circle.h = f.radius * 2;
  }
  if (f.follow) circle.follow = true;
  return sgGroundMotionFields(f, circle);
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
      area: f.pos ? { x: f.pos.x, y: f.pos.y, r: impactRadius } : null,
      vfxTier: 5
    });
    for (var ii = 0; ii < impactVictims.length; ii++) {
      sgHitOne(f.pEnt, f.st, impactVictims[ii], impactDmg, f.gid, f.floatSel,
        impactOut, sgStaggerMs(ii));
    }
    if (ctx && ctx.onDamage && impactOut.dmg > 0) ctx.onDamage(impactOut.dmg);
    if (impactOut.killed && ctx && ctx.onDeaths) ctx.onDeaths();
  }
  var respawn = f.respawnLeft > 0;
  var rebirth = !(f.fireHunt && f.respawnLeft <= 0) && lvs[5] > 0 && chance(sgVal(t[5].fx, 'chance', lvs[5]));
  if (!respawn && !rebirth) return;
  // 重生有表定的落點範圍；火牆的再召喚沒有，改用技能自身的射程當落點上限。
  var radius = rebirth ? bfMeterPx(sgGeometryNumber(t[5].fx, 'm') || 20) : skills2CastRangePx(f.gid, lvs);
  var spot = sgRandomEnemyNearPlayer(enemies, radius, null) ||
    ((f.tgt && f.tgt.hp > 0) ? f.tgt : null);
  if (!spot) return;
  sgSpawnGround(f.pEnt, f.st, f.gid, {
    kind: f.kind, tgt: spot, floatSel: f.floatSel,
    radius: f.radius, length: f.length, width: f.width,
    dmgVal: f.dmgVal, hits: f.hits, gap: f.gap,
    burnSpec: f.burnSpec, burnChance: f.burnChance,
    respawnLeft: respawn ? f.respawnLeft - 1 : 0,
    /* 重生／再召喚出來的那一道與原本那道是同一個技能的同一次施放，
       因此移動、軌跡火池、燃燒放大與拉近全部原樣帶過去。 */
    fireHunt: f.fireHunt, chaseM: f.chaseM, wanderM: f.wanderM, speed: f.speed,
    trail: f.trail, burnAmp: f.burnAmp, pullM: f.pullM, tempest: f.tempest,
    vfxTier: f.vfxTier, vfxUlt: f.vfxUlt, vfxGid: f.vfxGid
  });
}

/* 每個 tick 推進所有場域：先移動、再依節拍作用、打完就消失（並處理再召喚／重生）。 */
/* 場域的沿途脈衝：語意與飛行物的 pulse 完全相同——以場域當下位置為圓心，
   每 pulseGap 秒對半徑內的敵人各打一段。節拍與場域自己的命中節拍是兩回事
  （追擊風刃是 0.1 秒一次接觸判定、脈衝是 0.6 秒一次範圍爆炸），因此各記各的時刻。 */
function sgGroundPulse(f, enemies, ctx) {
  if (!(f.pulseGap > 0) || !(f.pulseDmg > 0) || !f.pos) return;
  if (typeof bfEnemiesInArea !== 'function' || typeof bfLiveList !== 'function') return;
  var guard = 0;
  while (f.nextPulseAt <= GT && guard < 10) {
    guard++;
    f.nextPulseAt += f.pulseGap;
    var area = { x: f.pos.x, y: f.pos.y, r: f.pulseRadius };
    var victims = bfEnemiesInArea(area, bfLiveList(enemies));
    sgEmitVfx(f.gid, victims, f.floatSel, {
      fxKind: 'burst', variant: f.pulseVariant || 'wind-burst', area: area,
      vfxGid: 'windblade', vfxTier: 6
    });
    if (!victims.length) continue;
    var out = { killed: false, dmg: 0, crit: false };
    for (var i = 0; i < victims.length; i++) {
      sgHitOne(f.pEnt, f.st, victims[i], f.pulseDmg, f.gid, f.floatSel, out, sgStaggerMs(i));
    }
    if (ctx && ctx.onDamage && out.dmg > 0) ctx.onDamage(out.dmg);
    if (out.killed && ctx && ctx.onDeaths) ctx.onDeaths();
  }
}

function sgTickGrounds(dt, ctx) {
  var list = SKILL2_RT.grounds;
  if (!list || !list.length) return;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  for (var i = list.length - 1; i >= 0; i--) {
    var f = list[i];
    if (f.startAt > GT) continue;
    if (f.devour) sgTickDragonDevour(f, dt, enemies);
    var guard = 0;
    sgGroundMove(f, dt, enemies);   // 移動／跟隨／追擊場域：作用前先推進到當下位置
    if (f.tempest) sgTickInfernoTempest(f, enemies);
    sgGroundApplyGrowth(f);   // 逐漸擴大的場域：作用前先更新到當下尺寸
    sgGroundPulse(f, enemies, ctx); // 沿途脈衝：節拍與命中節拍分開，因此在命中之前先結算
    enemies = ctx.getEnemies ? ctx.getEnemies() : enemies;
    while (f.hitsLeft > 0 && f.nextAt <= GT && guard < 20) {
      guard++;
      f.nextAt += f.gap;
      f.hitsLeft--;
      sgGroundTick(f, enemies, ctx);
      enemies = ctx.getEnemies ? ctx.getEnemies() : enemies;
    }
    if (f.hitsLeft > 0 || (f.expiresAt > GT)) continue;
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
  var lg = sgLegend('firehunt');
  var ultSolar = sgUlt('firehunt', 'solarRing');
  var ultInfinite = sgUlt('firehunt', 'infiniteRing');
  var dance = lvs[6] > 0;
  var triple = lvs[3] > 0;
  // 傷害%與持續時間取「最高的改寫階」，團數則由三重火狩決定（狩神之舞只加道數）
  var srcFx = dance ? t[6].fx : (triple ? t[3].fx : t[0].fx);
  var srcLv = dance ? lvs[6] : (triple ? lvs[3] : lvs[0]);
  var dmgPct = sgVal(srcFx, 'pct', srcLv);
  /* 兩個額外傷害乘區，各自獨立相乘：
       ・傳奇【狩獵者】＝拿數量換威力，兩者必須同時套用才是原本的交換
       ・超神【烈陽星環】＝直給的傷害提升 */
  var hunter = lg.firehuntHunter;
  if (hunter && Number(hunter.pct) > 0) dmgPct *= 1 + Number(hunter.pct) / 100;
  if (ultSolar) dmgPct *= 1 + sgUltVal(ultSolar, 'pct') / 100;
  var dmgVal = sgGroupBaseStat(g, st) * dmgPct / 100;
  var lifeSec = Math.max(0.5, Number(srcFx.sec) || Number(t[0].fx.sec) || 4);
  var count = Math.max(1, Math.floor(Number((triple ? t[3].fx : t[0].fx).count) || 2));
  if (ultSolar) count += Math.max(0, Math.floor(sgUltVal(ultSolar, 'count')));
  // 狩獵者：數量減半（無條件進位、至少 1 團），代價換上面那個傷害乘區
  if (hunter) count = Math.max(1, Math.ceil(count / 2));
  // 強化火狩（T2）×【增焰】（傳奇）：體積與環繞範圍同步擴大
  var scale = (lvs[1] > 0 ? 1 + sgVal(t[1].fx, 'pct', lvs[1]) / 100 : 1) *
    (1 + Math.max(0, Number(lg.firehuntScalePct) || 0) / 100);
  var radius = bfMeterPx(sgGeometryNumber(t[0].fx, 'm') || 8) * scale;
  var body = sgRange(g.range, lvs[0]); // 群組 range＝火狩體積（長*寬，米）
  var bodyR = bfMeterPx(Math.max(body.length, body.width) / 2) * scale;
  // 極速火狩（T5）×【烈陽星環】（超神）：旋轉速度（圈/秒 → 弧度/秒），正值＝順時針
  var spin = Math.PI * 2 * (Number(t[0].fx.rps) || 1) *
    (lvs[4] > 0 ? 1 + sgVal(t[4].fx, 'pct', lvs[4]) / 100 : 1) *
    (ultSolar ? 1 + sgUltVal(ultSolar, 'spin') / 100 : 1);

  /* 狩神之舞：兩道火狩，外圈距內圈 m 米、旋轉方向相反；
     且每團出現時自帶伴生（不必等命中判定；伴生體本身仍不可再伴生）。
     ⚠️ 圈距要跟著**火狩體積**一起放大（使用者決策 2026-08-26）：體積 +30% 圈距就 +30%。
     圈距不動的話，火狩一變大兩圈就會互相重疊、看起來黏成一團。
     這裡吃的是 scale（第 2 階【強化火狩】×傳奇【增焰】）；超神【烈陽星環】那種
     「隨時間長大」的部分是逐幀的，交給 sgOrbitStep continue 放大。 */
  var ringGapPx = bfMeterPx(sgGeometryNumber(t[6].fx, 'm') || 6) * scale;
  var rings = [{ r: radius, spin: spin }];
  if (dance) {
    var ringCount = Math.max(1, Math.floor(Number(t[6].fx.rings) || 2));
    for (var ri = 1; ri < ringCount; ri++) {
      rings.push({ r: radius + ringGapPx * ri, spin: (ri % 2) ? -spin : spin });
    }
  }

  var cfg = {
    tgt: primary, floatSel: floatSel, rings: rings, count: count, ringGapPx: ringGapPx,
    // 母體屬於第一階；第三階的伴生體由 companionPreset 獨立讀表。
    vfxTier: 1,
    dmgVal: dmgVal, lifeSec: lifeSec, bodyR: bodyR,
    hitElem: 'fire',
    companionChance: lvs[2] > 0 ? sgVal(t[2].fx, 'chance', lvs[2]) : 0,
    companionPx: bfMeterPx(sgGeometryNumber(t[2].fx, 'm') || 1),
    bornWithCompanion: dance,
    extendSec: lvs[5] > 0 ? sgVal(t[5].fx, 'sec', lvs[5]) : 0
  };
  /* 傳奇【炎爆】：命中計數滿了就爆。傷害基準與火狩本體同一個（群組基礎值×%），
     在施放當下定版，因此不會被之後的換裝改寫。 */
  var det = lg.firehuntDetonate;
  if (det && Number(det.hits) > 0 && Number(det.pct) > 0) {
    cfg.detonate = {
      hits: Math.max(1, Math.floor(Number(det.hits))),
      px: bfMeterPx(Math.max(0, Number(det.m) || 0)),
      dmgVal: sgGroupBaseStat(g, st) * Number(det.pct) / 100
    };
  }
  /* 【烈陽星環】：長大的是**火狩本身的體積**，不是環半徑（環半徑成長是虛空斬那條路）。
     兩者是不同的幾何量，共用一個欄位會讓「星環越轉越大」變成「星環越飛越遠」。 */
  if (ultSolar) {
    cfg.bodyGrowTo = 1 + Math.max(0, sgUltVal(ultSolar, 'grow')) / 100;
    cfg.bodyGrowSec = Math.max(0.1, Number(ultSolar.def.fx.growSec) || 4);
  }
  /* 【無限星環】：改為「從中心向外的螺旋」——每一團火狩各自從圓心起算半徑並持續外推
     （spiral＝半徑掛在環繞體上而不是環上），同時在持續時間內分批再放出新的火狩。
     新放出的那幾團同樣從圓心起算，因此畫面上是一條連續往外長的螺旋而不是同心圓。 */
  if (ultInfinite) {
    var maxPx = bfMeterPx(Math.max(1, sgGeometryNumber(ultInfinite.def.fx, 'm') || 20));
    var extra = Math.max(0, Math.floor(sgUltVal(ultInfinite, 'count')));
    cfg.rings = [{ r: Math.max(1, bodyR), spin: spin }];   // 從圓心（＝一個火狩的半徑）起算
    cfg.spiral = true;
    cfg.spiralMaxPx = maxPx;
    cfg.growPxPerSec = maxPx / lifeSec;
    cfg.spawnLeft = extra;
    cfg.spawnGap = lifeSec / (extra + 1);
    cfg.fieldKey = 'firehunt-spiral';
  }
  sgSpawnOrbitField(pEnt, st, 'firehunt', cfg);
}

/* 建立一次施放的環繞場域：每一道（ring）平均散開 count 團火狩。
   持續時間由整組共用（設計文檔：時間結束時所有火狩一起消失，含伴生出來的）。 */
function sgSpawnOrbitField(pEnt, st, gid, cfg) {
  var f = {
    gid: gid, pEnt: pEnt, st: st, floatSel: cfg.floatSel, tgt: cfg.tgt || null,
    /* 特效欄位的列標記（見 sgVfxRoles）：環繞體與軌道環讀這一列的飛行子彈／地板特效。 */
    vfxTier: cfg.vfxTier || 0, vfxUlt: cfg.vfxUlt || '', vfxGid: cfg.vfxGid || '',
    until: GT + Math.max(0.5, Number(cfg.lifeSec) || 0),
    dmgVal: Number(cfg.dmgVal) || 0,
    bodyR: Math.max(1, Number(cfg.bodyR) || 0),
    companionChance: Math.max(0, Number(cfg.companionChance) || 0),
    companionPx: Math.max(0, Number(cfg.companionPx) || 0),
    extendSec: Math.max(0, Number(cfg.extendSec) || 0),
    /* 泛用欄位（火狩以外的群組用得到）：狀態鍵、環繞體與命中的特效變體、命中回呼。
       留白＝火狩原本的行為，因此既有呼叫端不必改。 */
    statusId: cfg.statusId || 'sgFirehunt',
    /* 剩餘時間投影成哪個狀態：火狩（沒指定 statusId）預設讀火狩第 1 階的「我方狀態」。 */
    statusSlot: cfg.statusSlot || (cfg.statusId ? null : { gid: 'firehunt', tier: '1' }),
    auraVariant: cfg.auraVariant || 'firehunt',
    hitVariant: cfg.hitVariant || 'fire-explosion',
    hitElem: cfg.hitElem || (SKILLS2[gid] && SKILLS2[gid].elem) || 'fire',
    onStrike: cfg.onStrike || null,
    /* 半徑成長（虛空斬）：環半徑每秒加長多少像素。0＝固定半徑（火狩／環體電球原本的行為）。
       成長是「平滑的」——每個 tick 依 dt 累加，不是每秒跳一次（設計文檔明列此要求）。 */
    growPxPerSec: Math.max(0, Number(cfg.growPxPerSec) || 0),
    /* 螺旋（超神【無限星環】）：半徑改掛在**每一團**環繞體上，各自從圓心往外長。
       與 growPxPerSec 的差別是「誰在成長」：那條長的是整個環（同心圓一起變大），
       這條長的是各團自己（先出現的在外圈、後放出的在內圈＝一條螺旋）。 */
    spiral: !!cfg.spiral,
    spiralMaxPx: Math.max(0, Number(cfg.spiralMaxPx) || 0),
    spawnLeft: Math.max(0, Math.floor(Number(cfg.spawnLeft) || 0)),
    spawnGap: Math.max(0.05, Number(cfg.spawnGap) || 1),
    spawnAt: 0, spawnSeq: 0,
    /* 傳奇【炎爆】：{ hits, px, dmgVal }。規格在施放當下定版（傷害值要吃施放時的魔攻），
       之後不隨屬性變動，與其他場域型效果一致。 */
    detonate: cfg.detonate || null,
    /* 體積成長（超神【烈陽星環】）：bodyR 由 bodyR0 逐幀重算，不是每秒跳一次。
       bornAt 是這一組的出生時刻，成長曲線只認它，因此【再生】延長持續時間
       不會把已經長滿的體積重新縮回去。 */
    bodyR0: Math.max(1, Number(cfg.bodyR) || 0),
    bodyGrowTo: Math.max(1, Number(cfg.bodyGrowTo) || 1),
    bodyGrowSec: Math.max(0.1, Number(cfg.bodyGrowSec) || 1),
    /* 圈與圈的基準間距（px）。體積隨時間長大時，圈距要照同一個比例跟著拉開——
       否則外圈的火狩會長進內圈裡。0＝只有一圈（或呼叫端沒提供），不做這件事。 */
    ringGapPx: Math.max(0, Number(cfg.ringGapPx) || 0),
    ringR0: [],
    bornAt: GT,
    startAng: Number(cfg.startAng) || 0,
    fieldKey: cfg.fieldKey || null,
    rings: [], orbs: [], vfxUntil: 0, orbSeq: 0,
    vfxKey: 'sg-orbit-' + (++SKILL2_RT.orbitSeq)
  };
  f.spawnAt = f.spawnLeft > 0 ? GT + f.spawnGap : 0;
  var count = Math.max(1, Math.floor(Number(cfg.count) || 1));
  var startAng = f.startAng;
  for (var i = 0; i < cfg.rings.length; i++) {
    var ring = { r: Math.max(1, sgGeometryNumber(cfg.rings[i], 'r') || 0), spin: Number(cfg.rings[i].spin) || 0 };
    f.rings.push(ring);
    f.ringR0.push(ring.r);   // 出生半徑：圈距成長與特效事件的合併鍵都以它為基準
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
  sgOrbitSyncStatus(pEnt, f.statusId, f.statusSlot);
  sgOrbitEmitVfx(f);
}

/* 環繞場域的剩餘時間掛成狀態（狀態表 sgFirehunt），玩家才看得到還剩幾秒——
   【再生】每擊殺一個敵人就把 until 往後推，累積後的總剩餘時間只有這裡看得出來。
   取這名玩家身上所有環繞場域中**最晚結束**的那一個：狀態列一個技能只呈現一格，
   多重施放時該顯示的當然是「火狩還會在場多久」，不是其中某一組的殘餘。
   狀態與場域共用同一個時鐘 GT，因此必定同時到期，不需要另外清除。
   statusSlot＝{ gid, tier }：投影成哪一個狀態由該列「我方狀態」決定（statusId 仍是分組鍵）；
   沒有 statusSlot 的（傳奇【輪舞刃】）直接用 statusId。 */
function sgOrbitSyncStatus(pEnt, statusId, statusSlot) {
  if (!pEnt) return;
  var sid = statusId || 'sgFirehunt';
  var list = SKILL2_RT.orbits, until = 0;
  for (var i = 0; i < list.length; i++) {
    /* 只比同一個狀態鍵的環繞場域：火狩與環體電球是兩個技能、兩格狀態，
       共用一個剩餘時間會讓其中一邊顯示成另一邊的秒數。 */
    if (list[i] && list[i].pEnt === pEnt && (list[i].statusId || 'sgFirehunt') === sid &&
        list[i].until > until) until = list[i].until;
  }
  if (!(until > GT)) return;
  if (statusSlot) sgApplySlot(pEnt, statusSlot.gid, statusSlot.tier, 'self', statusSlot.idx || 0, { dur: until - GT });
  else applyStatus(pEnt, sid, { dur: until - GT });
}

function sgOrbitOrb(ang, ring) {
  return { ang: ang, spin: ring.spin, radius: ring.r, lap: 0, canSpawn: true, companion: false, contacts: [] };
}

/* 伴生火狩：中心沿軌落後「兩團半徑＋間隙」，避免伴生疊進母體內。
   母體與伴生體都不可再伴生（設計文檔：每一個火狩只能伴生一個，伴生出的不可再伴生）。 */
function sgOrbitCompanion(f, orb) {
  var back = orb.radius > 0 ? (f.bodyR * 2 + f.companionPx) / orb.radius : 0;
  return {
    ang: orb.ang - (orb.spin >= 0 ? back : -back), spin: orb.spin,
    // 保留母子身份供伴生消耗與畫面逐團同步，ringIdx 同步外圈成長。
    radius: orb.radius, ringIdx: orb.ringIdx || 0, parent: orb,
    lap: 0, canSpawn: false, companion: true, contacts: []
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
  var orbitChanged = false;
  var live = (typeof bfLiveList === 'function') ? bfLiveList(enemies) : [];
  var center = (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null;
  /* 體積成長（超神【烈陽星環】）：bodyR 是接觸判定的權威，逐幀由「出生時刻」重算，
     不是每秒跳一次；也因此【再生】把持續時間往後推不會讓已經長滿的體積縮回去。 */
  if (f.bodyGrowTo > 1) {
    var gp = Math.max(0, Math.min(1, (GT - f.bornAt) / f.bodyGrowSec));
    var bodyGrow = 1 + (f.bodyGrowTo - 1) * gp;
    f.bodyR = f.bodyR0 * bodyGrow;
    /* 圈距同步放大（使用者決策 2026-08-26）：最內圈的半徑不動，只把「圈與圈的間距」
       照體積的同一個比例拉開，火狩變大時兩圈才不會疊在一起。
       螺旋（無限星環）只有一圈、而且半徑掛在每一團身上，不走這條。 */
    if (!f.spiral && f.ringGapPx > 0 && f.rings.length > 1) {
      for (var ri2 = 1; ri2 < f.rings.length; ri2++) {
        f.rings[ri2].r = f.ringR0[0] + f.ringGapPx * bodyGrow * ri2;
      }
      for (var oi2 = 0; oi2 < f.orbs.length; oi2++) {
        var ringNow = f.rings[f.orbs[oi2].ringIdx || 0];
        if (ringNow) f.orbs[oi2].radius = ringNow.r;
      }
    }
  }
  /* 半徑成長：環半徑是權威（虛空斬）；螺旋（無限星環）則改由每一團自己往外長。 */
  if (f.growPxPerSec > 0 && dt > 0) {
    if (f.spiral) {
      var cap = f.spiralMaxPx > 0 ? f.spiralMaxPx : Infinity;
      for (var pi = 0; pi < f.orbs.length; pi++) {
        f.orbs[pi].radius = Math.min(cap, f.orbs[pi].radius + f.growPxPerSec * dt);
      }
    } else {
      for (var gi = 0; gi < f.rings.length; gi++) f.rings[gi].r += f.growPxPerSec * dt;
      for (var oi = 0; oi < f.orbs.length; oi++) {
        var ring = f.rings[f.orbs[oi].ringIdx || 0];
        if (ring) f.orbs[oi].radius = ring.r;
      }
    }
  }
  /* 分批放出（超神【無限星環】）：每 spawnGap 秒從圓心再放一團。
     角度用黃金角遞增而不是亂數——螺旋要看得出是同一條線往外長，亂數會散成一團。 */
  if (f.spawnLeft > 0 && f.spawnAt > 0 && GT >= f.spawnAt) {
    f.spawnAt = (f.spawnLeft > 1) ? GT + f.spawnGap : 0;
    f.spawnLeft--;
    if (f.orbs.length < SG_ORBIT_MAX_ORBS) {
      f.spawnSeq++;
      var seed = f.rings[0] || { r: 1, spin: 0 };
      var fresh = sgOrbitOrb(f.startAng + Math.PI * 2 * 0.618034 * f.spawnSeq, seed);
      fresh.ringIdx = 0;
      fresh.radius = Math.max(1, f.bodyR);   // 從圓心（＝一個火狩的半徑）重新起算
      fresh.canSpawn = false;                // 螺旋放出的那幾團不再走伴生規則
      f.orbs.push(fresh);
      orbitChanged = true;                  // 本拍移動結束後才送相位
    }
  }
  var out = { killed: false, dmg: 0, crit: false };
  var born = [];
  var struck = [];
  var blasts = [];
  var extended = false;
  var strikes = [];
  for (var i = 0; i < f.orbs.length; i++) {
    var orb = f.orbs[i];
    orb.ang += orb.spin * dt;
    if (orb.companion && orb.parent && f.orbs.indexOf(orb.parent) >= 0) {
      orb.radius = orb.parent.radius;
      var back = (f.bodyR * 2 + f.companionPx) / Math.max(1, orb.radius);
      orb.ang = orb.parent.ang - (orb.spin >= 0 ? back : -back);
    }
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
      /* 傳奇【炎爆】：同一個敵人被火狩命中滿 N 次就爆炸。計數掛在敵人實體上
         （純數字、隨實體自然回收），與 sgBurn／sgFrost 的每敵累加器同一套做法。 */
      if (f.detonate && fresh[h].hp > 0) {
        fresh[h]._sgHuntHits = (Number(fresh[h]._sgHuntHits) || 0) + 1;
        if (fresh[h]._sgHuntHits >= f.detonate.hits) {
          fresh[h]._sgHuntHits = 0;
          if (blasts.indexOf(fresh[h]) < 0) blasts.push(fresh[h]);
        }
      }
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
  if (f.gid === 'firehunt' && (born.length || orbitChanged)) sgOrbitEmitVfx(f);
  for (var bi = 0; bi < blasts.length; bi++) sgFirehuntDetonate(f, blasts[bi], live, out);
  if (extended) sgOrbitSyncStatus(f.pEnt, f.statusId, f.statusSlot);
  for (var si = 0; si < strikes.length; si++) f.onStrike(f, strikes[si], sgOrbitPos(strikes[si], center), ctx);
  if (struck.length) {
    sgEmitVfx(f.gid, struck, f.floatSel, {
      fxKind: 'impact', variant: f.hitVariant, elem: f.hitElem, dur: 0.35,
      vfxTier: f.vfxTier, vfxUlt: f.vfxUlt, vfxGid: f.vfxGid
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
  var detailed = f.gid === 'firehunt';
  var age = Math.max(0, GT - f.bornAt);
  if (detailed) f.orbs.forEach(function (orb) { if (!orb.vfxId) orb.vfxId = ++f.orbSeq; });
  var companionRoles = detailed ? sgVfxRoles(f.gid, { vfxTier: 3 }) : null;
  for (var i = 0; i < f.rings.length; i++) {
    var members = detailed ? f.orbs.filter(function (orb) { return (orb.ringIdx || 0) === i; }).map(function (orb) {
      return { id: orb.vfxId, phase: orb.ang - orb.spin * age,
        radiusBase: orb.radius - (f.spiral ? f.growPxPerSec * age : 0),
        companion: !!orb.companion, parentId: orb.parent ? orb.parent.vfxId : null };
    }) : null;
    var ringCount = detailed ? members.length : perRing;
    /* 圈距成長（烈陽星環）：事件送的是**出生半徑**而不是當下半徑——
       顯示層的節點合併鍵含半徑，送當下值會讓每次補送都被當成另一道環而多畫一圈。
       成長本身交給 rGrowTo／rGrowSec，顯示層照同一條曲線補。 */
    var r0 = f.ringR0[i] || f.rings[i].r;
    var rGrowTo = (f.bodyGrowTo > 1 && !f.spiral && f.ringGapPx > 0 && i > 0)
      ? (f.ringR0[0] + f.ringGapPx * f.bodyGrowTo * i) / r0 : 1;
    sgEmitVfx(f.gid, f.tgt ? [f.tgt] : [], f.floatSel, {
      fxKind: 'aura', variant: f.auraVariant, elem: f.hitElem, dur: dur, count: ringCount,
      vfxTier: f.vfxTier, vfxUlt: f.vfxUlt, vfxGid: f.vfxGid,
      area: {
        x: center ? center.x : 0, y: center ? center.y : 0, r: r0,
        rGrowTo: rGrowTo, rGrowSec: f.bodyGrowSec,
        orbR: detailed ? f.bodyR0 : f.bodyR, orbs: ringCount, spin: f.rings[i].spin >= 0 ? 1 : -1,
        spinRate: f.rings[i].spin,
        members: members, orbitAge: age, companionGap: f.companionPx,
        companionPreset: companionRoles && companionRoles.projectile || '',
        startAng: f.startAng,
        id: detailed ? f.vfxKey + ':' + i : f.fieldKey || null,
        /* 顯示層據此逐幀把環半徑補成連續的（模擬層只在建立時送一次事件）。 */
        grow: f.growPxPerSec || 0,
        /* 螺旋（超神【無限星環】）與體積成長（超神【烈陽星環】）：
           這兩個是**顯示與模擬共用的語意參數**（AI_RULES 8.3），不能只寫在其中一邊——
           模擬層的接觸判定就是照這組數字在跑，畫面照同一組畫才對得起來。
             growMax  ＝ 螺旋外擴的上限半徑（px）
             spiral   ＝ 每一團各自從圓心往外長（1）還是整環一起長（0）
             spiralLag＝ 相鄰兩團的出生間隔（秒），決定螺旋張得多開
             orbGrowTo／orbGrowSec ＝ 火狩體積在幾秒內長到幾倍 */
        growMax: f.spiralMaxPx || 0,
        spiral: f.spiral ? 1 : 0,
        spiralLag: f.spiral ? f.spawnGap : 0,
        orbGrowTo: f.bodyGrowTo || 1,
        orbGrowSec: f.bodyGrowSec || 1
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

/* ---------------------------------------------------------------------------
   火狩的傳奇特效與超神進化（2026-08-25 第六批）
   ---------------------------------------------------------------------------
   三個「不在環繞判定裡」的效果各自獨立：
     ・【炎爆】跟著命中走，因此掛在 sgOrbitStep 的命中段（爆炸結算在本段下方）
     ・【伴生併發】【烈火狩】是節拍，掛在 sgTickFirehuntLegend（每 tick 一次）
     ・【火神降臨】是常駐領域＋普攻附加，與火狩本體是否在場無關
   共同前提：這些都是「火狩」這個群組的效果，因此一律先確認群組有裝配
   （skills2Equipped）——沒裝在技能列就不該生效，與其他主動型被動同一條代價。
   --------------------------------------------------------------------------- */

/* 傳奇【炎爆】：被火狩命中滿 N 次的敵人爆炸，對其周圍 m 米內的敵人造成火焰傷害。
   範圍以「那個敵人」為圓心（設計文檔：對其周圍 6 米），不是以玩家為圓心。 */
function sgFirehuntDetonate(f, victim, live, out) {
  var spec = f.detonate;
  if (!spec || !(spec.dmgVal > 0) || !victim) return;
  var victims = [victim];
  if (typeof bfNearestOthers === 'function' && live && live.length) {
    var near = bfNearestOthers(victim, live, live.length, spec.px);
    for (var i = 0; i < near.length; i++) if (victims.indexOf(near[i]) < 0) victims.push(near[i]);
  }
  sgEmitVfx('firehunt', victims, f.floatSel, {
    fxKind: 'burst', variant: 'firehunt-detonate', elem: 'fire', dur: 0.5,
    vfxTier: 1
  });
  for (var v = 0; v < victims.length; v++) {
    sgHitOne(f.pEnt, f.st, victims[v], spec.dmgVal, 'firehunt', f.floatSel, out, sgStaggerMs(v));
  }
}

/* 目前場上還有沒有「這名玩家的火狩」（【伴生併發】【烈火狩】的共同前提）。
   空掉的場域不算——【伴生併發】會把環繞體一團一團消耗掉。 */
function sgFirehuntFieldActive(pEnt) {
  var list = SKILL2_RT && SKILL2_RT.orbits;
  for (var i = 0; list && i < list.length; i++) {
    if (list[i] && list[i].gid === 'firehunt' && list[i].pEnt === pEnt && list[i].until > GT &&
        list[i].orbs.length) return true;
  }
  return false;
}

/* 【伴生併發】的「消耗一團」（使用者決策 2026-08-25：飛出去的那一團會從場上消失）。
   取用順序：**先找伴生體**（設計文字是「你的 1 個併生火狩會飛出」），整個場上都沒有伴生體時
   才退而拿一般的火狩——否則沒投資第 3 階【伴生火狩】的人整條特效永遠不會生效。
   回傳有沒有真的消耗掉一團。 */
function sgFirehuntConsumeOrb(pEnt) {
  var list = (SKILL2_RT && SKILL2_RT.orbits) || [];
  var mine = [];
  for (var i = 0; i < list.length; i++) {
    var f = list[i];
    if (f && f.gid === 'firehunt' && f.pEnt === pEnt && f.until > GT && f.orbs.length) mine.push(f);
  }
  if (!mine.length) return null;
  /* 兩輪：第一輪只找伴生體（跨所有場域），找不到才在第二輪拿第一團。
     一輪內就決定的話，第一個場域剛好沒有伴生體時就會誤拿母體，
     即使下一個場域還有伴生體可用。 */
  var field = null, idx = -1;
  for (var m = 0; m < mine.length && !field; m++) {
    for (var k = 0; k < mine[m].orbs.length; k++) {
      if (mine[m].orbs[k].companion) { field = mine[m]; idx = k; break; }
    }
  }
  if (!field) { field = mine[0]; idx = 0; }
  field.orbs.splice(idx, 1);
  sgOrbitEmitVfx(field); // 空 members 也送出，讓畫面立即清除被消耗的環繞體。
  /* 整組被消耗光就地收掉：留著一個沒有環繞體的空場域只會讓狀態列的剩餘時間
     與實際畫面對不上（畫面上一團都沒有，狀態卻還在倒數）。 */
  if (!field.orbs.length) {
    var at = list.indexOf(field);
    if (at >= 0) list.splice(at, 1);
    sgOrbitSyncStatus(pEnt, field.statusId, field.statusSlot);
  }
  return true;
}

/* 火狩兩個「節拍型」傳奇特效。兩者都只在火狩還在場上時才走，因此共用同一個前提判定；
   節拍存在 SKILL2_RT.hunt（執行期，絕不入存檔），火狩不在場時歸零＝下一次施放重新起算。 */
function sgTickFirehuntLegend(ctx, dt) {
  if (!SKILL2_RT.hunt) SKILL2_RT.hunt = { launchAt: 0, ampAt: 0 };
  var rt = SKILL2_RT.hunt;
  if (!skills2Equipped('firehunt') || !sgFirehuntFieldActive(ctx.pEnt)) {
    rt.launchAt = 0; rt.ampAt = 0;
    return;
  }
  // 死亡／倒地：節拍往後推，剩餘時間不變（與超神自動施放同一條規則）
  if (skills2AutoCastBlocked(ctx.pEnt)) {
    rt.launchAt = sgPauseSchedule(rt.launchAt, dt);
    rt.ampAt = sgPauseSchedule(rt.ampAt, dt);
    return;
  }
  /* 每個 tick 都會走到，因此用一拍快取（sgLegend 會掃整個傳奇特效池並深拷貝 fx）。 */
  var lg = sgLegendTick('firehunt');

  /* 【烈火狩】：火狩在場期間每 gap 秒把火焰傷害再堆高一層。
     層數無上限，因此比照【火焰增幅】由引擎累加成單一數值後「後蓋前」寫入 sgFireAmp；
     持續時間只給兩拍，火狩消失後就自然退場（設計文檔：只在火狩持續時間內）。 */
  var amp = lg.firehuntFireAmp;
  if (amp && Number(amp.pct) > 0) {
    var ampGap = Math.max(0.1, sgGeometryNumber(amp, 'gap') || 0.5);
    if (!(rt.ampAt > 0)) rt.ampAt = GT + ampGap;
    else if (GT >= rt.ampAt) {
      rt.ampAt = GT + ampGap;
      applyStatus(ctx.pEnt, 'sgFireAmp', {
        val: skill2FireAmpPct(ctx.pEnt) + Number(amp.pct), dur: ampGap * 2
      });
    }
  } else rt.ampAt = 0;

  /* 【伴生併發】：每 gap 秒放一團火狩飛出去，對半徑 m 米內的一個敵人及其 aoeM 米內
     的所有敵人造成傷害。挑目標以玩家為圓心（設計文檔：飛出攻擊半徑 20 米內的敵人）。 */
  var lc = lg.firehuntLaunch;
  if (lc && Number(lc.pct) > 0) {
    var gap = Math.max(0.1, sgGeometryNumber(lc, 'gap') || 1);
    if (!(rt.launchAt > 0)) { rt.launchAt = GT + gap; return; }
    if (GT < rt.launchAt) return;
    rt.launchAt = GT + gap;
    /* 先確認消耗得到再結算：沒有可消耗的火狩就這一拍不發動（節拍照走，錯過的不補發）。
       ⚠️ 消耗要**無條件**發生，不能等「有沒有打得到的敵人」——否則空場時
       節拍會一直空轉，敵人一出現就變成連續發動。 */
    if (sgFirehuntConsumeOrb(ctx.pEnt)) sgFirehuntLaunch(ctx, lc);
  } else rt.launchAt = 0;
}

/* 【伴生併發】的一次飛出：挑一個玩家 m 米內的敵人，對它與周圍 aoeM 米內的敵人結算。
   呼叫端已經先消耗掉一團火狩（sgFirehuntConsumeOrb），本支只負責結算與特效。 */
function sgFirehuntLaunch(ctx, spec) {
  var st = (typeof getStats === 'function') ? getStats() : null;
  var dmgVal = sgGroupBaseStat(SKILLS2.firehunt, st) * Number(spec.pct) / 100;
  if (!(dmgVal > 0)) return;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  var live = (typeof bfLiveList === 'function') ? bfLiveList(enemies) : (enemies || []);
  var reach = bfMeterPx(Math.max(0, Number(spec.m) || 0));
  /* 射程內的敵群先篩出來，再交給既有的選敵規則挑主目標——
     直接取陣列第一個會變成「永遠打最早生成的那隻」，與其他技能的選敵行為不一致。 */
  var inRange = [];
  for (var i = 0; i < live.length; i++) {
    var e = live[i];
    if (!e || e.hp <= 0) continue;
    if (typeof bfPos === 'function' && bfPos(e) && typeof bfEntityDistance === 'function' &&
        bfEntityDistance(e) > reach) continue;
    inRange.push(e);
  }
  if (!inRange.length) return;
  var tgt = (typeof bfPickPrimary === 'function') ? bfPickPrimary(inRange, null) : inRange[0];
  if (!tgt) tgt = inRange[0];
  var victims = [tgt];
  if (typeof bfNearestOthers === 'function' && live.length) {
    var near = bfNearestOthers(tgt, live, live.length, bfMeterPx(Math.max(0, Number(spec.aoeM) || 0)));
    for (var n = 0; n < near.length; n++) if (victims.indexOf(near[n]) < 0) victims.push(near[n]);
  }
  /* 「飛出去」要看得見：比照火球，先送一則投射物、再送一則爆點（爆點延到抵達那一刻）。
     傷害仍在當下結算完畢，delayMs 只用在飄字與特效的時序上。 */
  var travelMs = (typeof bfTravelSeconds === 'function' && typeof bfPos === 'function' && bfPos(tgt))
    ? Math.max(1, Math.round(bfTravelSeconds(tgt) * 1000)) : 0;
  sgEmitVfx('firehunt', [tgt], ctx.floatSel, {
    fxKind: 'projectile', variant: 'fireball-small', elem: 'fire', count: 1,
    travelMs: [travelMs], projectile: true,
    vfxGid: 'fireball', vfxTier: 3
  });
  sgEmitVfx('firehunt', victims, ctx.floatSel, {
    fxKind: 'burst', variant: 'fire-explosion', elem: 'fire', dur: 0.5, delayMs: travelMs,
    vfxGid: 'fireball', vfxTier: 3
  });
  var out = { killed: false, dmg: 0, crit: false };
  for (var v = 0; v < victims.length; v++) {
    sgHitOne(ctx.pEnt, st, victims[v], dmgVal, 'firehunt', ctx.floatSel, out, travelMs + sgStaggerMs(v));
  }
  if (ctx.onDamage && out.dmg > 0) ctx.onDamage(out.dmg);
  if (out.killed && ctx.onDeaths) ctx.onDeaths();
}

/* 超神【火神降臨】：常駐的火焰纏身領域，每 gap 秒對周圍 m 米內的敵人造成火焰傷害。
   與火狩本體是否在場無關（設計文檔：你的身體被火焰包裹），因此節拍不看 orbits，
   只看「有沒有裝配 ＋ 有沒有選這個超神進化」——與血刃斬的永久領域同一套語意。 */
function sgTickFireGod(ctx, dt) {
  var u = sgUlt('firehunt', 'fireGodDescend');
  if (!u || !skills2Equipped('firehunt')) { SKILL2_RT.fireGodAt = 0; sgEndDomainStatus('fireGodBody'); return; }
  var radius = bfMeterPx(Math.max(0, sgGeometryNumber(u.def.fx, 'm') || 6));
  /* 火焰纏身是玩家身上的永久狀態：範圍的畫面是它的「持續特效」，依作用半徑縮放、逐幀跟著玩家
    （以前是每秒重送一次 follow-aura 地板事件）。 */
  if (radius > 0) sgSyncDomainStatus(ctx.pEnt, 'fireGodBody', radius);
  if (skills2AutoCastBlocked(ctx.pEnt)) {
    SKILL2_RT.fireGodAt = sgPauseSchedule(SKILL2_RT.fireGodAt, dt);
    return;
  }
  var gap = Math.max(0.1, sgGeometryNumber(u.def.fx, 'gap') || 0.5);
  if (!(SKILL2_RT.fireGodAt > 0)) { SKILL2_RT.fireGodAt = GT + gap; return; }
  if (GT < SKILL2_RT.fireGodAt) return;
  SKILL2_RT.fireGodAt = GT + gap;
  var st = (typeof getStats === 'function') ? getStats() : null;
  var dmgVal = sgGroupBaseStat(SKILLS2.firehunt, st) * sgUltVal(u, 'pct') / 100;
  if (!(dmgVal > 0)) return;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  var live = (typeof bfLiveList === 'function') ? bfLiveList(enemies) : (enemies || []);
  var victims = [];
  for (var i = 0; i < live.length; i++) {
    var e = live[i];
    if (!e || e.hp <= 0) continue;
    if (typeof bfPos === 'function' && bfPos(e) && typeof bfEntityDistance === 'function' &&
        bfEntityDistance(e) > radius) continue;
    victims.push(e);
  }
  if (!victims.length) return;
  var out = { killed: false, dmg: 0, crit: false };
  for (var v = 0; v < victims.length; v++) {
    sgHitOne(ctx.pEnt, st, victims[v], dmgVal, 'firehunt', ctx.floatSel, out, sgStaggerMs(v));
  }
  if (ctx.onDamage && out.dmg > 0) ctx.onDamage(out.dmg);
  if (out.killed && ctx.onDeaths) ctx.onDeaths();
}

/* 超神【火神降臨】的另一半：普攻朝目標發射 N 顆火狩星環。
   掛在普攻的收斂點（js/combat.js doPlayerAttack 的 depth 0 段），
   與【殺神降臨】的普攻加成同一個位置——那裡才分得出「主攻擊」與「追加攻擊」。
   不足 1 顆的部分以機率補（sgRollCount），與其他小數數量的既有決策一致。 */
function skills2OnBasicAttack(pEnt, target, floatSel, st) {
  var u = sgUlt('firehunt', 'fireGodDescend');
  if (!u || !skills2Equipped('firehunt') || !target || target.hp <= 0) return 0;
  var lvs = skills2Levels('firehunt');
  if (!lvs || lvs[0] < 1) return 0;
  var orbs = sgRollCount(sgUltVal(u, 'orbs'));
  if (orbs <= 0) return 0;
  /* 星環的威力＝火狩在**第 6 階**時的每次命中傷害（使用者決策 2026-08-25）。
     火狩只有第 1／4／7 三階改寫傷害（第 5、6 階不動傷害），所以「第 6 階的火狩」
     ＝有投資第 4 階【三重火狩】就取第 4 階，否則取第 1 階；
     刻意**不取**第 7 階【狩神之舞】——那是第 7 階才有的威力。 */
  var t = SKILLS2.firehunt.tiers;
  var srcFx = lvs[3] > 0 ? t[3].fx : t[0].fx;
  var srcLv = lvs[3] > 0 ? lvs[3] : lvs[0];
  var dmgVal = sgGroupBaseStat(SKILLS2.firehunt, st) * sgVal(srcFx, 'pct', srcLv) / 100;
  if (!(dmgVal > 0)) return 0;
  /* 星環是**貫穿型的飛行投射物**（使用者決策 2026-08-26）：朝目標方向射出，
     以表定 mps 米／秒一路飛 flyM 米，**沿途碰到的每個敵人都打一次**（不是打到目標就停）。
     因此：
       ・不帶 targetOnly——那是「只結算主目標」的單體投射物語意
       ・length 取表定飛行距離而不是「到目標的距離」，射程外的敵人才吃得到
       ・singleHit：同一顆星環對同一個敵人只算一次（貫穿不是滯留連擊）
     傷害在飛行途中由 sgTickFlyingProjectiles 結算，因此**不計入這一次普攻的傷害合計**
     （ctx.onDamage 與擊殺回呼都由飛行物的 tick 負責）。 */
  var speed = bfMeterPx(Math.max(1, sgGeometryNumber(u.def.fx, 'speed') || Number(u.def.fx.mps) || 12));
  var flyPx = bfMeterPx(Math.max(1, sgGeometryNumber(u.def.fx, 'flyM') || 40));
  var geomOk = (typeof bfPos === 'function') && !!bfPos(target) &&
    (typeof bfPlayerPos === 'function') && (typeof bfAngleTo === 'function');
  var origin = geomOk ? bfPlayerPos() : null;
  var angle = geomOk ? bfAngleTo(target) : 0;
  var travelMs = Math.max(1, Math.round(flyPx / speed * 1000));
  var ringRoles = sgVfxRoles('firehunt', { vfxUlt: 'fireGodDescend', vfxBase: true });
  var out = { killed: false, dmg: 0, crit: false };
  for (var i = 0; i < orbs; i++) {
    var beginSec = 0;
    var flightOrbit = { origin: origin ? { x: origin.x, y: origin.y } : null,
      heading: angle, speed: speed, length: flyPx, radius: bfMeterPx(sgGeometryNumber(u.def.fx, 'orbitM') || 8),
      phase: -Math.PI / 2 + i * Math.PI * 2 / orbs, spin: (Number(u.def.fx.rps) || 1.5) * Math.PI * 2 };
    sgQueueFlyingProjectile(pEnt, st, 'firehunt', dmgVal, origin, angle, flyPx, floatSel, [target], {
      /* 無座標（高塔）時退化成「時間到打當初的目標」——與其他飛行物的既有退化規則一致。 */
      singleHit: true, waitForEnd: !geomOk, targetOnly: !geomOk,
      speed: speed, travelMs: travelMs, beginSec: beginSec,
      halfWidthPx: SG_FLYING_PROJECTILE_HALF_WIDTH, flightOrbit: flightOrbit,
      onHit: function (enemy) {
        sgEmitVfx('firehunt', [enemy], floatSel, {
          fxKind: 'impact', variant: 'firehunt-ring-hit', preserveDeadTargets: true,
          vfxRoles: { hit: ringRoles.hit }
        });
      }
    }, out);
    /* 使用者決策 2026-08-26：星環要畫成「丟出去的旋轉圓環」，不是小火球。
       共同中心依 angle／lineLength 前進；flightOrbit 讓每枚沿同一旋轉曲線飛行與命中；
       firehunt-ring 兩個顯示層各有專屬畫法，不被認得時才退回泛用投射物。 */
    sgEmitVfx('firehunt', [target], floatSel, {
      fxKind: 'projectile', variant: 'firehunt-ring', elem: 'fire', count: 1,
      travelMs: [travelMs], projectile: true, delayMs: Math.round(beginSec * 1000),
      angle: angle, lineLength: flyPx,
      lineWidth: SG_FLYING_PROJECTILE_HALF_WIDTH * 2, area: { flightOrbit: flightOrbit },
      // 發射只播表定星環；不可帶入普通火狩的爆炸與地板角色。
      hit: false, vfxRoles: { projectile: ringRoles.projectile }
    });
  }
  return orbs;
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
  /* 地爆天星的殞石不掛在任何敵人身上（打的是全場），因此飛行時間與體積倍率
     必須由這一支帶出去——顯示層要靠 travelMs 對齊落地時刻。 */
  if (extra && extra.travelMs > 0) spec.travelMs = [Number(extra.travelMs)];
  if (extra && extra.sizeMult > 0) spec.sizeMult = Number(extra.sizeMult);
  var roles = sgVfxRoles(gid, extra);
  if (roles) spec.vfx = roles;
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
  var lg = sgLegend('rockarmor');
  var ultAdamant = sgUlt('rockarmor', 'adamantBody');
  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[1] > 0) pct += sgVal(t[1].fx, 'pct', lvs[1]);   // 強化岩甲：與第 1 階累加
  /* 護盾的兩個乘區：傳奇【重岩甲】與超神【金剛不壞】。兩者都是「岩甲術獲得的護盾」，
     因此乘在這個 pct 上而不是全域護盾效率（那條是 T4【護盾增幅】的位置）。 */
  pct *= (1 + Math.max(0, Number(lg.rockShieldPct) || 0) / 100);
  if (ultAdamant) pct *= 1 + sgUltVal(ultAdamant, 'hp') / 100;
  var dur = Math.max(0.5, Number(t[0].fx.sec) || 10);
  var before = Math.max(0, pEnt.shield || 0);
  /* ⚠️ 順序有意義：RT 必須**先**成立，`skill2RockMaxHpFactor` 才看得到岩甲已經生效；
     否則【金剛不壞】的 +生命上限會慢一拍，這一次的護盾（＝最大生命的 pct%）
     仍照舊上限計算，下一次施放才吃得到——玩家看到的是「第一次放沒效」。
     base 先給 1 佔位，等護盾真的塗上去之後再改寫成真值。 */
  SKILL2_RT.rock = { until: GT + dur, pEnt: pEnt, base: 1, amp: 0, inside: null, auraAt: 0 };
  if (ultAdamant && typeof markStatsDirty === 'function') {
    var hpMaxBefore = Math.max(1, Number(st && st.hp) || 0);
    markStatsDirty();
    st = (typeof getStats === 'function') ? getStats() : st;
    /* 使用者決策（2026-08-25）：生命上限與**當前生命**一起提升，維持原本的生命百分比。
       只拉上限不補血的話，施放瞬間百分比會掉（1000/1000 → 1000/1550），
       低血增傷／低血保命類的效果會被誤觸；到期時再按同一個比例縮回去（見 tickSkill2），
       因此整個循環下來玩家不會白賺任何一點相對生命。 */
    skill2RockScaleHp(pEnt, (Number(st && st.hp) || hpMaxBefore) / hpMaxBefore, st);
  }
  // 岩甲術第 1 階「我方狀態」：第一格＝岩甲護盾、第二格＝護盾存在期間的計時（岩甲本身由 RT 計時）
  sgApplySlot(pEnt, 'rockarmor', '1', 'self', 0, { val: pct, dur: dur, stats: st });
  sgApplySlot(pEnt, 'rockarmor', '1', 'self', 1, { val: pct, dur: dur });
  /* base 取「這次施放後的護盾總量」而不是增量：護盾是共用的一池（applyShield 取 max），
     分母用增量會在既有護盾較高時算出負數比例。 */
  SKILL2_RT.rock.base = Math.max(1, Math.max(before, pEnt.shield || 0));
  sgRockArmorAura(floatSel);   // 光殼：施放當下先畫一次，之後由顯示節拍續命（見該函式）
  if (typeof floatPlayerEvent === 'function') {
    var pSel = (typeof playerEventFloatTarget === 'function') ? playerEventFloatTarget(floatSel) : floatSel;
    floatPlayerEvent(pSel, '🪨+' + fmt(Math.max(0, (pEnt.shield || 0) - before)), 'shield');
  }
  /* 兩個領域型超神進化（三選一、互斥）：施放當下先對範圍內的敵人作用一次，
     之後由 sgTickRockField 接手「進入範圍就作用」。 */
  sgRockFieldCast(pEnt, st, pool, floatSel);
}

/* 岩甲光殼（環繞石板／【天地逆返】的藍紋石板）的重送。
   ⚠️ 施放當下畫一次是不夠的：顯示層的場域壽命是「事件的 dur × 容錯倍數」，
   與岩甲的實際剩餘時間無關——原本一發 dur 6 秒的事件會在畫面上活 15 秒，
   護盾（10 秒）早就結束了石板還在繞，玩家死亡時更明顯（RT 在判死那一刻就被
   resetSkillRT 清掉，畫面卻要等壽命走完）。
   改成比照領域範圍提示的作法：每個顯示節拍重送一次（同一份 preset ＝ 續期同一個
   節點，不會疊出第二層），dur 取「岩甲剩餘時間」與節拍的較小值，於是 RT 一消失
   就沒有人再續命，畫面跟著收。倒地當下的立即回收由顯示層負責
   （js/battle-renderer.js clearPlayerFields）——模擬層跑在 Worker 內，叫不到顯示層。 */
function sgRockArmorAura(floatSel) {
  var rt = SKILL2_RT && SKILL2_RT.rock;
  if (!rt) return;
  rt.auraAt = GT + SG_DOMAIN_VFX_SEC;
  var lvs = skills2Levels('rockarmor');
  var left = Math.max(0.1, Math.min(SG_DOMAIN_VFX_SEC, rt.until - GT));
  sgEmitPlayerVfx('rockarmor', floatSel, { fxKind: 'aura', variant: 'rock-armor', elem: 'earth', dur: left, vfxTier: (lvs && lvs[6] > 0) ? 7 : 1 });
}

/* 岩甲光殼的每 tick 續命（節拍到了才送，與領域範圍提示同一個顯示節奏）。 */
function sgTickRockArmorAura(ctx) {
  var rt = SKILL2_RT && SKILL2_RT.rock;
  if (!rt || rt.until <= GT || (rt.pEnt && rt.pEnt !== ctx.pEnt)) return;
  if ((rt.auraAt || 0) > GT) return;
  sgRockArmorAura(ctx.floatSel);
}

/* ---------------------------------------------------------------------------
   岩甲術的傳奇特效與超神進化（2026-08-25 第六批）
   ---------------------------------------------------------------------------
   收斂點沿用岩甲術本來那一套：權威是 SKILL2_RT.rock（施放期），增益只是投影。
     ・【重岩甲】【金剛不壞】的護盾量 → 施放當下換算（sgCastRockarmor）
     ・【尖刺甲】【金剛不壞】的尖刺   → sgRockOnPlayerDamaged 的 T3 段
     ・【巨岩增幅】的層數上限         → sgRockOnPlayerDamaged 的 T6 段
     ・【輕飛甲】的移速               → js/battlefield.js bfPlayerSpeedFactor（我方移動的唯一乘區）
     ・【大地之心】的無敵             → sgRockOnPlayerDamaged 末端（護盾剛好被打光的那一下）
     ・【金剛不壞】的減傷             → skill2DamageTakenMultiplier
     ・【超重力場】的土系增傷         → legendaryElementDamageUp（屬性傷害提升的唯一收斂點）
   --------------------------------------------------------------------------- */

/* 施放時 m 米內的敵人一律進入「這一招的範圍」（兩個超神爆發共用）。
   敵群取施放端傳進來的 pool（＝完整敵群），不另外回頭問戰場——高塔與野外共用同一支。 */
function sgRockBurstVictims(pool, m) {
  var radius = bfMeterPx(Math.max(0, Number(m) || 0));
  var live = (typeof bfLiveList === 'function') ? bfLiveList(pool || []) : (pool || []);
  var out = [];
  for (var i = 0; i < live.length; i++) {
    var e = live[i];
    if (!e || e.hp <= 0) continue;
    if (typeof bfPos === 'function' && bfPos(e) && typeof bfEntityDistance === 'function' &&
        bfEntityDistance(e) > radius) continue;
    out.push(e);
  }
  return out;
}

/* 目前生效中的岩甲領域是哪一個超神進化（兩者三選一、互斥）；沒有就回 null。 */
function sgRockFieldUlt() {
  if (!skills2Equipped('rockarmor')) return null;
  return sgUlt('rockarmor', 'superRockArt') || sgUlt('rockarmor', 'gravityField');
}

/* 對這一批敵人套用【超重岩之術】的石化。 */
function sgRockPetrifyApply(victims, u, floatSel) {
  if (!victims || !victims.length) return;
  var sec = Math.max(0.5, Number(u.def.fx.sec) || 4);
  var pct = Math.max(0, sgUltVal(u, 'pct'));
  sgEmitVfx('rockarmor', victims, floatSel, {
    fxKind: 'burst', variant: 'rock-petrify', elem: 'earth', dur: 0.8,
    vfxUlt: 'superRockArt'
  });
  for (var i = 0; i < victims.length; i++) {
    /* 石化標記照塗（增傷不是控場，不受控場免疫影響）；行動限制則交給暈眩，
       BOSS 擋得掉的是後者——這正是設計上「BOSS 不會被定住但仍會變脆」的差別。 */
    sgApplySlot(victims[i], 'rockarmor', 'superRockArt', 'enemy', 1, { val: pct, dur: sec });
    sgTryStun(victims[i], sec, { gid: 'rockarmor', tier: 'superRockArt', idx: 0 });
  }
}

/* 對這一批敵人套用【超重力場】的僵化。 */
function sgRockGravityApply(victims, u, floatSel) {
  if (!victims || !victims.length) return;
  var sec = Math.max(0.5, Number(u.def.fx.stiffSec) || 5);
  var pct = Math.max(0, Math.min(95, Number(u.def.fx.stiff) || 0));
  sgEmitVfx('rockarmor', victims, floatSel, {
    fxKind: 'burst', variant: 'gravity-field', elem: 'earth', dur: 0.8,
    vfxUlt: 'gravityField'
  });
  for (var i = 0; i < victims.length; i++) sgApplySlot(victims[i], 'rockarmor', 'gravityField', 'enemy', 0, { val: pct, dur: sec });
}

/* 岩甲領域的每 tick 推進（使用者決策 2026-08-26）：
   兩個超神進化不是「施放瞬間打一次就結束」，而是**在岩甲護盾存在期間持續成立的領域**——
   施放當下範圍內的敵人受作用，之後**進入**範圍的敵人也立即受作用。
   採「進入偵測」而不是「每拍重塗」：
     ・每拍重塗會讓站著不動的敵人被永久定住（石化含暈眩），控場遞減也會把它打成 0 秒
     ・只在施放當下算一次，則後來生成／走進來的敵人完全不受影響——那正是要修的問題
   因此記住「上一拍在範圍內的是誰」，只對 外→內 這個轉換套用；離開再回來會再吃一次。 */
function sgTickRockField(ctx, dt) {
  var rt = SKILL2_RT && SKILL2_RT.rock;
  if (!rt || rt.until <= GT || (rt.pEnt && rt.pEnt !== ctx.pEnt)) {
    sgEndDomainStatus('petrifyDomain'); sgEndDomainStatus('gravityDomain'); return;
  }
  var u = sgRockFieldUlt();
  if (!u) { rt.inside = null; sgEndDomainStatus('petrifyDomain'); sgEndDomainStatus('gravityDomain'); return; }
  var radius = bfMeterPx(Math.max(0, sgGeometryNumber(u.def.fx, 'm') || 0));
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  var live = (typeof bfLiveList === 'function') ? bfLiveList(enemies) : (enemies || []);
  var was = rt.inside || [];
  var now = [];
  var fresh = [];
  for (var i = 0; i < live.length; i++) {
    var e = live[i];
    if (!e || e.hp <= 0) continue;
    if (typeof bfPos === 'function' && bfPos(e) && typeof bfEntityDistance === 'function' &&
        bfEntityDistance(e) > radius) continue;
    now.push(e);
    if (was.indexOf(e) < 0) fresh.push(e);
  }
  rt.inside = now;
  /* 領域本身是玩家身上的狀態，持續到岩甲護盾結束；範圍內剛好沒有敵人時也看得見（畫面＝狀態表的持續特效）。
     兩個超神互斥，換選項時撤掉另一個。 */
  var domRole = u.id === 'superRockArt' ? 'petrifyDomain' : 'gravityDomain';
  sgSyncDomainStatus(ctx.pEnt, domRole, radius, Math.max(0.1, rt.until - GT));
  sgEndDomainStatus(domRole === 'petrifyDomain' ? 'gravityDomain' : 'petrifyDomain');
  if (!fresh.length) return;
  if (u.id === 'superRockArt') sgRockPetrifyApply(fresh, u, ctx.floatSel);
  else sgRockGravityApply(fresh, u, ctx.floatSel);
}

/* 超神【超重岩之術】：施放時石化 m 米內的敵人。
   「無法行動」沿用暈眩承擔（因此完整吃 BOSS 控場免疫、韌性折減與控場遞減），
   sgPetrify 本身只負責「受到的土系傷害額外提高」——與寒霜的【凍結】同一套拆法。 */
function sgRockFieldCast(pEnt, st, pool, floatSel) {
  var u = sgRockFieldUlt();
  if (!u) return;
  var radius = bfMeterPx(Math.max(0, sgGeometryNumber(u.def.fx, 'm') || 0));
  var victims = sgRockBurstVictims(pool, sgUltVal(u, 'm'));
  /* 記住「施放當下已經在裡面的是誰」：不記的話，下一拍的進入偵測會把他們全部
     當成剛進來而再作用一次（石化那條會馬上吃到控場遞減，等於白白折損一次）。 */
  if (SKILL2_RT.rock) {
    SKILL2_RT.rock.inside = victims.slice();
    // 領域本身是玩家身上的狀態，持續到岩甲護盾結束（畫面＝狀態表的持續特效，依領域半徑縮放）
    sgSyncDomainStatus(pEnt, u.id === 'superRockArt' ? 'petrifyDomain' : 'gravityDomain', radius,
      Math.max(0.1, SKILL2_RT.rock.until - GT));
  }
  if (u.id === 'superRockArt') sgRockPetrifyApply(victims, u, floatSel);
  else sgRockGravityApply(victims, u, floatSel);
}

/* 【石化】：這個敵人受到的土系傷害額外提高%（0＝沒有）。
   與【寒冰逆轉】同一條路：只針對單一屬性的受傷增幅走 skillElemAmp，
   不能混進 totalDmgPct（那會連同一次攻擊的其他屬性段一起放大）。 */
function skill2PetrifyEarthPct(target) {
  return (typeof buffVal === 'function') ? Math.max(0, buffVal(target, 'sgPetrify')) : 0;
}
function skill2PetrifyACfg(aCfg, target) {
  var pct = skill2PetrifyEarthPct(target);
  if (!(pct > 0)) return aCfg;
  var amp = {};
  for (var k in (aCfg.skillElemAmp || {})) amp[k] = aCfg.skillElemAmp[k];
  amp.earth = (Number(amp.earth) || 1) * (1 + pct / 100);
  aCfg.skillElemAmp = amp;
  return aCfg;
}

/* 【僵化】：三個下降共用同一個效果值。
     攻速 → formula.js slowFactor（skill2SlowAspdFactor）
     移速 → battlefield.js bfEnemySpeedFactor（skill2SlowMoveFactor）
     傷害 → combat.js doMonsterAttack 的攻擊力乘區（skill2EnemyDamageFactor） */
function sgStiffenOn(ent) {
  return (typeof buffVal === 'function') ? Math.max(0, buffVal(ent, 'sgStiffen')) : 0;
}
function skill2StiffenFactor(ent) {
  var v = sgStiffenOn(ent);
  return v > 0 ? Math.max(0.05, 1 - Math.min(95, v) / 100) : 1;
}
/* 敵人造成的傷害乘區（【僵化】與泥沼傳奇【削弱】，兩個獨立來源相乘）。
   掛點：js/combat.js doMonsterAttack。 */
function skill2EnemyDamageFactor(ent) {
  return skill2StiffenFactor(ent) *
    ((typeof skill2MireWeakenFactor === 'function') ? skill2MireWeakenFactor(ent) : 1);
}

/* 超神【超重力場】：岩甲護盾存在期間，你的土系傷害額外提高%。
   掛點：js/legendary.js legendaryElementDamageUp——全專案屬性傷害提升的唯一收斂點。 */
function skill2RockEarthDamageUpPct(pEnt) {
  var u = sgUlt('rockarmor', 'gravityField');
  if (!u || !skill2RockActive(pEnt)) return 0;
  return Math.max(0, sgUltVal(u, 'pct'));
}

/* 傳奇【輕飛甲】：岩甲護盾存在期間的我方移動速度乘區（沒生效＝1）。
   掛點：js/battlefield.js bfPlayerSpeedFactor——我方移動速度的唯一乘區。 */
function skill2PlayerMoveFactor(pEnt) {
  if (!skill2RockActive(pEnt)) return 1;
  /* 每個 tick 都會問一次（我方移動），因此走一拍快取而不是每次掃整個傳奇特效池。 */
  var pct = Math.max(0, Number(sgLegendTick('rockarmor').rockMoveSpeedPct) || 0);
  return pct > 0 ? 1 + pct / 100 : 1;
}

/* 超神【金剛不壞】：岩甲期間的生命上限倍率（沒生效＝1）。
   ⚠️ 這一支會在 computeStats 途中被呼叫，因此**不得**回頭呼叫 getStats()；
   skill2RockActive 只讀 SKILL2_RT，安全。屬性快取由施放與到期兩處各 markStatsDirty 一次。 */
function skill2RockMaxHpFactor() {
  var rt = SKILL2_RT && SKILL2_RT.rock;
  if (!rt || rt.until <= GT) return 1;
  var u = sgUlt('rockarmor', 'adamantBody');
  return u ? 1 + sgUltVal(u, 'hp') / 100 : 1;
}

/* 【金剛不壞】的生命上限倍率變動時，把當前生命按同一個比例帶著走（維持生命百分比）。
   夾在 1..新上限之間：活著的人不會因為縮回去而被除成 0（那會變成「技能到期把自己殺了」）。 */
function skill2RockScaleHp(pEnt, ratio, st) {
  if (!pEnt || !(pEnt.hp > 0) || !(ratio > 0) || ratio === 1) return;
  var cap = Math.max(1, Number(st && st.hp) || 0);
  pEnt.hp = Math.max(1, Math.min(cap, pEnt.hp * ratio));
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

  /* 受擊是每秒數次的路徑，因此走一拍快取（sgLegend 會掃整個傳奇特效池並深拷貝 fx）。 */
  var lg = sgLegendTick('rockarmor');
  var ultAdamant = sgUlt('rockarmor', 'adamantBody');

  // T3 岩甲尖刺：獨立的一段地屬性反擊傷害（走完整傷害管線＝吃地屬性加成與敵人地抗）
  if (lvs[2] > 0 && mEnt && mEnt.hp > 0) {
    /* 【尖刺甲】與【金剛不壞】都寫「岩甲尖刺的效果提高 X%」——同一種語意，故相加成一個乘區。 */
    var spikeUp = Math.max(0, Number(lg.rockSpikePct) || 0) +
      (ultAdamant ? Math.max(0, sgUltVal(ultAdamant, 'spike')) : 0);
    var spikeVal = st.hp * sgVal(t[2].fx, 'pct', lvs[2]) / 100 * (1 + spikeUp / 100);
    var eSel = (typeof THORN_FLOAT_MAP !== 'undefined' && THORN_FLOAT_MAP[floatSel]) || floatSel;
    var spikeOut = { killed: false, dmg: 0, crit: false };
    sgEmitVfx('rockarmor', [mEnt], eSel, { fxKind: 'impact', variant: 'rock-spike', elem: 'earth', vfxTier: 3 });
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
    // 傳奇【巨岩增幅】：可疊層數 +N（層數是保護鍵，不吃雙手補償的數值放大）
    var maxStacks = Math.max(1, Math.floor(Number(t[5].fx.max) || 30)) +
      Math.max(0, Math.floor(Number(lg.rockAmpStacksAdd && lg.rockAmpStacksAdd.maxStacks) || 0));
    var cap = per * maxStacks;
    var add = absorbed / rt.base * 100 * per;
    var total = Math.min(cap, sgRoleBuffVal(pEnt, 'rockAmp') + add);
    if (total > 0) sgApplySlot(pEnt, 'rockarmor', '6', 'self', 0, { val: total, dur: Number(t[5].fx.sec) || 3 });
  }

  /* 傳奇【大地之心】：護盾剛好在這一下被打光就給無敵，內部冷卻 cd 秒。
     判定點放在這裡而不是每個 tick 掃一次——「降至 0」是一個事件，
     每 tick 輪詢會在護盾長時間為 0 的整段期間反覆觸發。 */
  var heart = lg.rockHeartInvuln;
  if (heart && Number(heart.sec) > 0 && absorbed > 0 && !(pEnt.shield > 0) &&
      GT >= (SKILL2_RT.rockHeartAt || 0)) {
    SKILL2_RT.rockHeartAt = GT + Math.max(0, Number(heart.cd) || 0);
    applyStatus(pEnt, 'invuln', { dur: Number(heart.sec) });
    if (typeof floatPlayerEvent === 'function') {
      var hSel = (typeof playerEventFloatTarget === 'function') ? playerEventFloatTarget(floatSel) : floatSel;
      floatPlayerEvent(hSel, '🪨無敵!', 'buff');
    }
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
  /* 傳奇【蔓延】：範圍提高。乘在**出生尺寸**上而不是併進 growTo——
     growTo 是第 5／7 階「隨時間逐步擴大」的目標倍率，把一個立即生效的放大
     塞進去會變成「一開始沒有變大、四秒後才長到 +25%」。 */
  var mireShape = sgRange(g.range, lvs[0]);
  var side = bfMeterPx(mireShape.length || 10) *
    (1 + Math.max(0, Number(sgLegend('mire').mireScalePct) || 0) / 100);
  var growTo = 1;
  if (lvs[4] > 0) growTo += sgVal(t[4].fx, 'pct', lvs[4]) / 100;
  if (lvs[6] > 0) growTo += sgVal(t[6].fx, 'pct', lvs[6]) / 100;   // 熔岩沼：與第 5 階累加
  var spread = lvs[3] > 0 ? sgRollCount(sgVal(t[3].fx, 'add', lvs[3])) : 0;
  sgSpawnGround(pEnt, st, 'mire', {
    kind: 'mire', tgt: primary, floatSel: floatSel,
    length: side, width: side * (mireShape.width || 10) / (mireShape.length || 10), dmgVal: 0,
    hits: hits, gap: SG_MIRE_TICK_SEC,
    growTo: growTo, growSec: lvs[4] > 0 ? Math.max(0.1, Number(t[4].fx.growSec) || 4) : 0,
    respawnLeft: spread,
    mire: sgMireSpec(g, lvs, st),
    vfxTier: lvs[6] > 0 ? 7 : (lvs[2] > 0 ? 3 : 1)
  });
}

/* 沼澤這一攤要發的狀態規格（施放當下定版，之後不隨屬性變動）。
   【毒沼增生】傳染出去的那幾攤直接沿用同一份（見 sgMireGroundExpire），
   因此傳奇與超神的規格也一併帶過去，不必在傳染路徑再算一次。 */
function sgMireSpec(g, lvs, st) {
  var t = g.tiers;
  var base = sgGroupBaseStat(g, st);
  var lg = sgLegend('mire');
  var gravity = lvs[5] > 0;                                   // 重力泥沼：緩速換代
  var poisonGap = Math.max(0.1, Number(t[2].fx.dotGap) || 0.5);
  var lavaGap = Math.max(0.1, Number(t[6].fx.dotGap) || 0.4);
  /* 傳奇【熔火】：熔岩沼的火焰傷害提高（乘在施放當下的每跳量上，
     與第 7 階自身的每級成長相乘）。 */
  var lavaMult = 1 + Math.max(0, Number(lg.mireLavaPct) || 0) / 100;
  return {
    aspd: Number((gravity ? t[5].fx : t[0].fx).aspd) || 50,
    move: Number((gravity ? t[5].fx : t[0].fx).move) || 30,
    poisonDps: lvs[2] > 0 ? base * sgVal(t[2].fx, 'dotPct', lvs[2]) / 100 / poisonGap : 0,
    poisonGap: poisonGap,
    lavaDps: lvs[6] > 0 ? base * sgVal(t[6].fx, 'dotPct', lvs[6]) / 100 * lavaMult / lavaGap : 0,
    lavaGap: lavaGap,
    lava: lvs[6] > 0,
    bleed: sgMireBleedSpec(lg, st),
    plague: sgMirePlagueSpec(base),
    inferno: sgMireInfernoSpec(lvs, base)
  };
}

/* 傳奇【侵蝕】：泥沼附加的流血規格（沒有這個特效＝null）。
   基準取**物攻**——設計文檔寫的是「物理傷害」，與突刺的【穿心裂血】同一個口徑；
   泥沼術本身是魔法群組（吃魔攻），但這一段流血不是泥沼的本體傷害。 */
function sgMireBleedSpec(lg, st) {
  var b = lg && lg.mireBleed;
  if (!b || !(Number(b.tickPowerPct) > 0)) return null;
  var gap = Math.max(0.1, Number(b.tickSec) || 0.5);
  return {
    dps: (Number(st && st.atk) || 0) * Number(b.tickPowerPct) / 100 / gap,
    interval: gap,
    dur: Math.max(gap, Number(b.dur) || 5)
  };
}

/* 超神【惡疫魔沼】：沼澤塗上的惡疫規格（沒選中＝null）。
   與泥沼的其他狀態不同，它「離開後仍會存在 sec 秒」，因此持續時間不是 f.gap × 2，
   而是超神進化自己的 sec；每一拍重塗只是把剩餘時間推回滿值。 */
function sgMirePlagueSpec(base) {
  var u = sgUlt('mire', 'plagueMire');
  if (!u) return null;
  var gap = Math.max(0.05, sgGeometryNumber(u.def.fx, 'gap') || 0.35);
  return {
    dps: base * sgUltVal(u, 'pct') / 100 / gap,
    interval: gap,
    dur: Math.max(gap, Number(u.def.fx.sec) || 8)
  };
}

/* 超神【深淵火獄】：熔岩沼每隔一段時間噴出的火龍捲規格（沒選中或還沒練到熔岩沼＝null）。
   dmgVal 是**每一段**的傷害；段數與壽命的關係比照火龍捲本體（壽命 ÷ 段數＝節拍）。 */
function sgMireInfernoSpec(lvs, base) {
  var u = sgUlt('mire', 'abyssInferno');
  if (!u || !(lvs[6] > 0)) return null;
  return {
    gap: Math.max(0.2, sgGeometryNumber(u.def.fx, 'gap') || 2),
    hits: Math.max(1, Math.floor(Number(u.def.fx.hits) || 8)),
    dmgVal: base * sgUltVal(u, 'pct') / 100,
    radiusPx: bfMeterPx(Math.max(1, sgGeometryNumber(u.def.fx, 'm') || 6)),
    brandSec: Math.max(0.5, Number(u.def.fx.sec) || 8)
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
    elem: m.lava && !poison ? 'fire' : 'earth', dur: f.gap, area: sgGroundArea(f),
    vfxTier: m.lava ? 7 : (poison ? 3 : 1)
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
    // 泥沼術第 1／3／7 階與超神【惡疫魔沼】的「敵方狀態」：緩速／毒性／岩漿／瘟疫各一格
    sgApplySlot(e, 'mire', '1', 'enemy', 0, { val: m.aspd || 0, dur: hold });
    if (m.poisonDps > 0) sgApplySlot(e, 'mire', '3', 'enemy', 0, { dps: m.poisonDps, dur: hold, interval: m.poisonGap, source: mireSource });
    if (m.lavaDps > 0) sgApplySlot(e, 'mire', '7', 'enemy', 0, { dps: m.lavaDps, dur: hold, interval: m.lavaGap, source: mireSource });
    /* 傳奇【侵蝕】與超神【惡疫魔沼】：兩者都是「離開沼澤後仍走完自己的持續時間」，
       因此持續時間用各自的規格，而不是上面那個只給兩跳的 hold。 */
    if (m.bleed) applyStatus(e, 'sgMireBleed', { dps: m.bleed.dps, dur: m.bleed.dur, interval: m.bleed.interval, source: mireSource });
    if (m.plague) sgApplySlot(e, 'mire', 'plagueMire', 'enemy', 0, { dps: m.plague.dps, dur: m.plague.dur, interval: m.plague.interval, source: mireSource });
  }
  // 超神【深淵火獄】：熔岩沼每隔一段時間噴出一道火龍捲（自己的節拍，不跟著沼澤每一拍）
  sgMireInfernoTick(f, victims);
}

/* 超神【深淵火獄】的節拍：熔岩沼每 gap 秒在範圍內的一個敵人腳下噴出一道火龍捲，
   並把該敵人的屬性標籤改寫為火屬性。節拍時刻記在場域實例上（執行期物件，不入存檔），
   因此每一攤沼澤（含【毒沼增生】傳染出去的）各自獨立計時。 */
function sgMireInfernoTick(f, victims) {
  var spec = f.mire && f.mire.inferno;
  if (!spec) return;
  if (!(f.infernoAt > 0)) { f.infernoAt = GT + spec.gap; return; }   // 出生後先等一個節拍再噴
  if (GT < f.infernoAt) return;
  f.infernoAt = GT + spec.gap;
  if (!victims.length) return;
  var spot = victims[Math.floor(Math.random() * victims.length)];
  if (!spot || spot.hp <= 0) return;
  /* 屬性改寫塗在「被噴到的那個敵人」身上：火龍捲本身是場域，之後打到誰由幾何決定，
     在這裡對整片沼澤全塗會讓一道火龍捲的效果擴散成整片，與設計文字不符。 */
  sgApplySlot(spot, 'mire', 'abyssInferno', 'enemy', 0, { dur: spec.brandSec });
  /* kind 刻意不用 'pillar'：sgGroundExpire 對 pillar／wall 會去跑**火龍捲樹**的
     第 5／6 階（烈焰衝擊、重生），而這一道的 gid 是 mire——那兩階在泥沼術的表上
     是完全不同的東西，會讀出一組沒有意義的數字並照樣播一發衝擊波特效。
     顯示層不認得 'lavapillar'，會落到 sgGroundVfxSpec 的預設分支（火柱畫法），
     正好就是我們要的那一道火龍捲。 */
  sgSpawnGround(f.pEnt, f.st, 'mire', {
    kind: 'lavapillar', tgt: spot, floatSel: f.floatSel,
    radius: spec.radiusPx,
    dmgVal: spec.dmgVal, hits: spec.hits, gap: spec.gap / spec.hits,
    hitElem: 'fire',
    vfxUlt: 'abyssInferno'
  });
}

/* 【毒沼增生】（T4）：沼澤結束時在附近較近的敵人腳下重新長出一攤（可再傳染的次數遞減）。 */
function sgMireGroundExpire(f, enemies, ctx) {
  if (!(f.respawnLeft > 0)) return;
  var lvs = skills2Levels('mire');
  if (!lvs || lvs[3] < 1) return;
  var radius = bfMeterPx(sgGeometryNumber(SKILLS2.mire.tiers[3].fx, 'm') || 40);
  var spot = sgMireSpreadTarget(f, enemies, radius);
  if (!spot) return;
  sgSpawnGround(f.pEnt, f.st, 'mire', {
    kind: 'mire', tgt: spot, floatSel: f.floatSel,
    length: f.baseLength, width: f.baseWidth, dmgVal: 0,
    hits: f.hits, gap: f.gap,
    growTo: f.growTo, growSec: f.growSec,
    respawnLeft: f.respawnLeft - 1,
    mire: f.mire,
    vfxTier: f.vfxTier, vfxUlt: f.vfxUlt, vfxGid: f.vfxGid
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
/* 「站在泥沼裡」：泥沼術第 1 階「敵方狀態」塗的那個狀態在身上。
   上面兩個掛點是 sgMire 這個狀態自己的效果（攻速／移速下降），跟著效果鍵走；
   下面這些是泥沼術各階與傳奇「對泥沼中的敵人」的額外效果，跟著表格上的狀態走。 */
function sgInMire(ent) {
  return sgRoleActive(ent, 'mireSlow');
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
/* 【虛弱】（T2）＋【重力泥沼】（T6）＋傳奇【腐化】：
   受泥沼影響的敵人受到的傷害提高（三者累加，走 skill2VulnACfg 的 totalDmgPct）。 */
function skill2MireVulnPct(target) {
  if (!sgInMire(target)) return 0;
  var lvs = skills2Levels('mire');
  if (!lvs || lvs[0] < 1) return 0;
  var t = SKILLS2.mire.tiers;
  var pct = 0;
  if (lvs[1] > 0) pct += sgVal(t[1].fx, 'pct', lvs[1]);
  if (lvs[5] > 0) pct += sgVal(t[5].fx, 'pct', lvs[5]);
  /* 傳奇【腐化】：只對「泥沼範圍內**且**正在被控場」的敵人生效。
     控場的判定沿用全專案既有的口徑（暈眩／減速，凍結與石化的行動限制也走暈眩管線），
     與傳奇【崩山裂地者】完全同一條規則，不另立一套「什麼算控場」。 */
  var corrupt = Number(sgLegendTick('mire').mireCorruptPct) || 0;
  if (corrupt > 0 && typeof effectActive === 'function' &&
      (effectActive(target, 'stun') || effectActive(target, 'slow'))) {
    pct += corrupt;
  }
  return pct;
}

/* 傳奇【削弱】：泥沼範圍中的敵人造成的傷害降低（乘區，掛在 skill2EnemyDamageFactor）。
   與【僵化】相乘而不是相加——兩者是不同來源的獨立減益。 */
function skill2MireWeakenFactor(ent) {
  if (!sgInMire(ent)) return 1;
  var w = sgLegendTick('mire').mireWeaken;
  var cut = w ? Math.max(0, Math.min(95, Number(w.reducePct) || 0)) : 0;
  return cut > 0 ? 1 - cut / 100 : 1;
}

/* 超神【惡疫魔沼】：中了【惡疫】的敵人，受到的**毒屬性**持續傷害額外提高。
   掛點：js/combat.js tickStatuses 的每一跳（依狀態表的「傷害屬性」欄分流）。
   走這裡而不是 resolveHit 既有的 skillElemAmp，是因為本專案的持續傷害一律是
   「施放當下定版的平坦 dps」、根本不經過 resolveHit——與【火焰增幅】對燃燒
   的既有關係一致。放大量的權威是**目前的超神進化等級**（不存在狀態值上），
   與【泥沼緩速】同一種做法。 */
function skill2DotElemFactor(ent, sid) {
  var u = sgUlt('mire', 'plagueMire');
  if (!u || !ent || !sid || !sgHasDot(ent, sgRoleSids('plague'))) return 1;
  var def = (typeof statusDef === 'function') ? statusDef(sid) : null;
  if (!def || def.elem !== 'poison') return 1;
  return 1 + Math.max(0, sgUltVal(u, 'amp')) / 100;
}

/* ---- 超神【黃泉沼】：沼澤內的低血敵人每次受傷都有機率被直接斬殺 ----
   機率逐次累加，計數與旗標掛在敵人實體上（純數字／布林，隨實體自然回收、不入存檔）。
   ⚠️ 判定掛在 skills2OnEnemyDamaged（「每次受到傷害」的唯一收斂點），
   但**不在那裡扣血**：那支是 resolveHit／applyEnemyHpDamage 中途呼叫的，
   在裡面再打一次會遞迴，而且致死分支（out.killed）當下已經算完，
   殺掉也不會有人去跑死亡結算。因此那裡只立旗標，實際斬殺留到 tickSkill2
   的排程——那裡才有 ctx.onDeaths 可以收尾。 */
function sgNetherMireOnDamaged(ent) {
  var u = sgUlt('mire', 'netherMire');
  if (!u || !ent || ent.hp <= 0 || ent._sgNetherKill) return;
  // 比照傳奇【斬殺】：BOSS 不吃斬殺
  if (ent.isBoss || ent.towerBoss || !(ent.maxHp > 0)) return;
  if (!sgInMire(ent)) return;
  var hpPct = Math.max(0, Math.min(100, Number(u.def.fx.hpPct) || 30));
  if (ent.hp > ent.maxHp * hpPct / 100) return;
  var stacks = Math.max(0, Number(ent._sgNetherStacks) || 0);
  var pct = sgUltVal(u, 'chance') + stacks * sgUltVal(u, 'add');
  ent._sgNetherStacks = stacks + 1;
  if (chance(pct)) ent._sgNetherKill = true;
}

function sgTickNetherMire(ctx) {
  if (!sgUlt('mire', 'netherMire')) return;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  var out = { killed: false, dmg: 0, crit: false };
  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i];
    if (!e || e.hp <= 0 || !e._sgNetherKill) continue;
    e._sgNetherKill = false;
    var before = out.dmg;
    sgDerivedHit(e, e.hp, 'mire', ctx.floatSel, out, '💀', 0);
    if (ctx.onDamage && out.dmg > before) ctx.onDamage(out.dmg - before);
  }
  if (out.killed && ctx.onDeaths) ctx.onDeaths();
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
// 常駐法陣只在已裝備且存活時續命；穩定 area.id 保持動畫時鐘。
function sgTickEarthguardAura(ctx) {
  var lvs = skill2EarthguardLevels();
  if (!lvs || !(ctx.pEnt.hp > 0)) { SKILL2_RT.earthguardVfxAt = 0; return; }
  if (SKILL2_RT.earthguardVfxAt > GT) return;
  SKILL2_RT.earthguardVfxAt = GT + 0.25;
  var tier = lvs[6] > 0 ? 7 : lvs[3] > 0 ? 4 : lvs[2] > 0 ? 3 : 1;
  var pp = (typeof bfPlayerPos === 'function' && bfPlayerPos()) || { x: 0, y: 0 };
  sgEmitPlayerVfx('earthguard', 'pv-float', {
    fxKind: 'aura', variant: 'earthguard', elem: 'light', dur: 0.25, vfxTier: tier,
    area: { id: 'sg-earthguard-aura', x: pp.x, y: pp.y, r: bfMeterPx(tier === 7 ? 10 : 8), follow: true }
  });
}

function skill2EarthguardLevels() {
  if (!skills2PassiveActive('earthguard')) return null;
  var lvs = skills2Levels('earthguard');
  return (lvs && lvs[0] >= 1) ? lvs : null;
}

/* 我方受到的傷害乘區（岩甲【天地逆返】×大地守護【傷害減免】）。
   刻意不併進 dCfg.dmgRed：那條是神鑄【聖佑】的加算池、還夾著 50% 上限，
   兩個不同來源的減免混在一起會互相吃掉對方的空間。 */
function skill2PassiveDamageTakenMultiplier() {
  var eg = skill2EarthguardLevels();
  return eg && eg[0] > 0 ? 1 - Math.min(90, sgVal(SKILLS2.earthguard.tiers[0].fx, 'pct', eg[0])) / 100 : 1;
}
function skill2DamageTakenMultiplier(pEnt) {
  var mult = skill2PassiveDamageTakenMultiplier();
  var rk = skill2RockLevels(pEnt);
  if (rk && rk[6] > 0) {
    var red = sgVal(SKILLS2.rockarmor.tiers[6].fx, 'pct', rk[6]) * (1 - skill2RockShieldRemain(pEnt));
    if (red > 0) mult *= 1 - Math.min(90, red) / 100;
  }
  /* 超神【金剛不壞】：岩甲期間的額外減傷。獨立乘區（與 T7 相乘而非相加），
     上限 99% 是為了避免滿級的 99% 與其他來源疊成完全免疫。 */
  if (rk) {
    var adamant = sgUlt('rockarmor', 'adamantBody');
    if (adamant) mult *= 1 - Math.min(99, Math.max(0, sgUltVal(adamant, 'red'))) / 100;
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
  var mult = t ? 1 + sgVal(t.fx, 'pct', t.lv) / 100 : 1;
  /* 超神【光耀之堂】：生命與法力回復再提高。獨立乘區（與 T3／T4 相乘而不是相加），
     且只放大「回復」——設計文字沒有提到吸血／吸魔，那兩個仍只吃 T3／T4 的 drain 倍率。
     ⚠️ 不看 sgEarthguardRegenTier：沒投資 T3／T4 時本效果照樣要生效。 */
  var u = skill2EarthguardLevels() ? sgUlt('earthguard', 'hallOfRadiance') : null;
  if (u) mult *= 1 + Math.max(0, sgUltVal(u, 'pct')) / 100;
  return mult;
}

/* ---- 溢出的生命／法力：大地守護三個效果共用的收斂點 ----
   掛點：formula.js 的 healPlayer（生命）與 gainPlayerMana（法力）——本專案
   「我方資源入帳」的唯二出口，每秒回復、吸血、吸魔、過關回復全部經過它們。
     ・傳奇【魔力滋養】：溢出法力的 pct% → 生命護盾
     ・傳奇【生命滋養】：溢出生命的 pct% → 法力
     ・超神【光耀之堂】：溢出的生命**與**法力各以 conv% → 生命護盾
   護盾一律走 grantShield（護盾的唯一入口，因此吃護盾效率、技能護盾上限
   與【戰神屠錄】的封鎖）。 */
function skills2OnResourceOverflow(pEnt, st, kind, over) {
  if (!pEnt || !st || !(over > 0)) return;
  if (!skill2EarthguardLevels()) return;          // 沒裝配／沒投資大地守護＝零成本
  var lg = sgLegendTick('earthguard');
  var shield = 0;
  if (kind === 'mp') {
    var mf = lg.egManaOverflowShield;
    if (mf) shield += over * Math.max(0, Number(mf.pct) || 0) / 100;
  } else {
    var hf = lg.egHpOverflowMana;
    if (hf) {
      /* 直接寫 mp 而不是再呼叫一次 gainPlayerMana：那會讓
         「生命溢出 → 法力溢出 → 生命護盾」互相餵食成一個迴圈。
         這一條路上的法力溢出直接捨棄。 */
      var toMana = over * Math.max(0, Number(hf.pct) || 0) / 100;
      if (toMana > 0) pEnt.mp = Math.min(Number(st.mp) || 0, (Number(pEnt.mp) || 0) + toMana);
    }
  }
  var u = sgUlt('earthguard', 'hallOfRadiance');
  if (u) shield += over * Math.max(0, sgUltVal(u, 'conv')) / 100;
  if (shield > 0 && typeof grantShield === 'function') grantShield(pEnt, shield, st);
}
function skill2DrainFactor(kind) {
  var t = sgEarthguardRegenTier(kind);
  var factor = t ? 1 + sgVal(t.fx, 'drain', t.lv) / 100 : 1;
  var warGod = SKILL2_RT && SKILL2_RT.warGod;
  if (kind === 'hp' && warGod && warGod.pEnt && warGod.pEnt.hp > 0) {
    factor *= 1 + Math.max(0, Number(warGod.drainPct) || 0) / 100;
  }
  return factor;
}

/* 【魔法盾】（T5）：我方扣血前先由法力承擔一部分。
   回傳同時保留「轉換的生命傷害量」與「實際扣除的法力量」兩個口徑：
   manaRed 只降低 MP 成本，不降低被法力承擔的生命傷害；法力不足時，
   以剩餘 MP ÷ 每點生命傷害的 MP 成本反推可轉換的傷害量。 */
function skills2ManaShieldResult(pEnt, dmg) {
  var empty = { damage: 0, mana: 0 };
  if (!pEnt || !(dmg > 0)) return empty;
  if (typeof gmMpLockActive === 'function' && gmMpLockActive(pEnt)) return empty;
  var lvs = skill2EarthguardLevels();
  if (!lvs || lvs[4] < 1) return empty;

  var fx = SKILLS2.earthguard.tiers[4].fx;
  var convertPct = Math.max(0, Math.min(100, sgVal(fx, 'pct', lvs[4])));
  var want = dmg * convertPct / 100;
  if (!(want > 0)) return empty;

  var manaRedPct = Math.max(0, Math.min(100, sgVal(fx, 'manaRed', lvs[4])));
  var manaPerDamage = 1 - manaRedPct / 100;
  if (manaPerDamage <= 0) return { damage: want, mana: 0 };

  var available = Math.max(0, Number(pEnt.mp) || 0);
  if (!(available > 0)) return empty;
  var damage = Math.min(want, available / manaPerDamage);
  var mana = damage * manaPerDamage;
  if (!(damage > 0)) return empty;
  pEnt.mp = Math.max(0, available - mana);
  return { damage: damage, mana: mana };
}

/* 舊呼叫點只需要知道「少扣多少生命」，保留這個純數值包裝器。 */
function skills2ManaShieldAbsorb(pEnt, dmg) {
  return skills2ManaShieldResult(pEnt, dmg).damage;
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
  sgEmitVfx('earthguard', victims, eSel, { fxKind: 'chain', variant: 'earth-reflect', elem: 'light', vfxTier: 6 });
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

/* 反射目標：範圍內任意 count 個；「除非只剩一個目標，否則避開當前攻擊者」。
   傳奇【靈魂連結】：可作用的敵人數 +count。 */
function sgEarthguardReflectTargets(exclude, enemies, fx) {
  var radius = bfMeterPx(sgGeometryNumber(fx, 'm') || 20);
  var link = sgLegendTick('earthguard').egReflectAdd;
  var count = Math.max(1, Math.floor(Number(fx.count) || 1) +
    Math.max(0, Math.floor(Number(link && link.count) || 0)));
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

/* ---- 【天地共生】的復活次數（超神【逆轉乾坤】）----
   沒選【逆轉乾坤】時上限＝1，語意與改造前完全相同（「冷卻好了就是可以復活一次」）。
   選了以後多出來的那幾次記在 SKILL2_RT.rebirth.charges（執行期，絕不入存檔）：
     可用次數 ＝（冷卻已結束？1：0）＋ charges，上限為 cap。
   充能規則：冷卻歸零時若還沒滿，charges +1 並重新起算冷卻；滿了就讓冷卻停在 0。
   ⚠️ 上限用 Math.round 取整：表定「最多 2 次、每級 +0.1 次」＝ Lv.5 起變 3 次。
   容量是一個**要能被看見**的整數，不適合像「不足 1 次以機率補」那樣每次擲骰。 */
function skills2RebirthMaxCharges() {
  var u = sgUlt('earthguard', 'fateReversal');
  return u ? Math.max(1, Math.round(sgUltVal(u, 'max'))) : 1;
}
function sgRebirthCdSec(lvs) {
  return Math.max(1, sgVal(SKILLS2.earthguard.tiers[6].fx, 'cd', lvs[6]));
}
/* 每 tick 的充能（掛在 tickSkill2）。沒選【逆轉乾坤】時直接返回＝零成本。 */
function sgTickRebirthCharge(pEnt) {
  var cap = skills2RebirthMaxCharges();
  if (cap <= 1) { SKILL2_RT.rebirth = null; return; }
  var lvs = skill2EarthguardLevels();
  if (!lvs || lvs[6] < 1 || !pEnt) { SKILL2_RT.rebirth = null; return; }
  if (!SKILL2_RT.rebirth) SKILL2_RT.rebirth = { charges: cap - 1 };   // 進場即滿
  var rt = SKILL2_RT.rebirth;
  rt.charges = Math.max(0, Math.min(cap - 1, Math.floor(Number(rt.charges) || 0)));
  if (!pEnt.skillCds) pEnt.skillCds = {};
  if ((pEnt.skillCds[SG_PREFIX + 'earthguard'] || 0) > 0) return;
  if (rt.charges >= cap - 1) return;                                  // 已經滿了：冷卻停在 0
  rt.charges++;
  pEnt.skillCds[SG_PREFIX + 'earthguard'] = sgRebirthCdSec(lvs);
  if (typeof UI !== 'undefined' && UI.dirty) UI.dirty.skills = true;
}

/* 【天地共生】（T7）：死亡攔截。掛在野外 onPlayerFieldDeath 與高塔 endTowerFight
   兩個判死收斂點的最前端——持續傷害、自傷技能與敵人攻擊都會經過那裡。
   冷卻寫進 pEnt.skillCds['sg:earthguard']，直接沿用技能格的通用冷卻顯示。 */
function skills2TryRebirth(pEnt) {
  if (!pEnt || typeof getStats !== 'function') return false;
  var lvs = skill2EarthguardLevels();
  if (!lvs || lvs[6] < 1) return false;
  if (!pEnt.skillCds) pEnt.skillCds = {};
  var ready = !((pEnt.skillCds[SG_PREFIX + 'earthguard'] || 0) > 0);
  var stored = (SKILL2_RT.rebirth && skills2RebirthMaxCharges() > 1)
    ? Math.max(0, Math.floor(Number(SKILL2_RT.rebirth.charges) || 0)) : 0;
  if (!ready && stored <= 0) return false;
  var fx = SKILLS2.earthguard.tiers[6].fx;
  var st = getStats();
  if (typeof cleanse === 'function') cleanse(pEnt);   // 先淨化再上無敵，避免無敵被自己清掉
  pEnt.hp = Math.max(1, Math.round(st.hp * sgVal(fx, 'pct', lvs[6]) / 100));
  /* 先花掉「冷卻已結束」的那一次，累積的次數留到最後——這樣冷卻才會立刻開始跑，
     不會出現「還有存量所以冷卻一直停在 0」的無限復活。 */
  if (ready) pEnt.skillCds[SG_PREFIX + 'earthguard'] = sgRebirthCdSec(lvs);
  else SKILL2_RT.rebirth.charges = stored - 1;
  var invulnSec = Math.max(0.5, Number(fx.sec) || 5);
  sgApplySlot(pEnt, 'earthguard', '7', 'self', 0, { dur: invulnSec });
  /* 傳奇【不滅意志】要知道「這段無敵是天地共生給的」——玩家身上的無敵可能來自
     潛力、神鑄或【大地之心】，那幾種不該被擊殺延長。 */
  SKILL2_RT.rebirthInvuln = GT + invulnSec;
  sgEmitPlayerVfx('earthguard', 'pv-float', { fxKind: 'rain', variant: 'pillar', elem: 'light', dur: 1.2, vfxTier: 7 });
  if (typeof floatPlayerEvent === 'function') floatPlayerEvent('pv-float', '天地共生!', 'buff');
  if (typeof blog === 'function') {
    var left = (SKILL2_RT.rebirth && skills2RebirthMaxCharges() > 1)
      ? '（剩餘累積復活 ' + Math.max(0, Math.floor(Number(SKILL2_RT.rebirth.charges) || 0)) + ' 次）' : '';
    blog('🌍 【天地共生】大地將你托起——你原地復活，回復 ' + fmt(pEnt.hp) + ' 生命並獲得無敵！' + left, 'info');
  }
  if (typeof UI !== 'undefined' && UI.dirty) { UI.dirty.battle = true; UI.dirty.skills = true; }
  return true;
}

/* ===========================================================================
   新版技能的擊殺掛點（js/combat.js onFieldKill）
   ---------------------------------------------------------------------------
   目前三個來源全部屬於大地守護：
     傳奇【地之心】   → 【天地共生】的復活冷卻 -sec 秒
     傳奇【不滅意志】 → 天地共生的無敵期間，每殺 1 個敵人無敵 +sec 秒
     超神【天地再造】 → 普通／菁英敵人機率原地重生
   回傳 true ＝「這隻敵人要重生」，實際把牠放回戰鬥的欄位由 combat.js 負責
  （`_rewarded`／`_deathClearCd` 那幾個是野外戰鬥自己的簿記，不該由技能層去動）。
   高塔沒有掛這一支：那邊的擊殺只有「BOSS 死了＝戰鬥結束」一種，
   三個效果沒有一個在那個時間點還有意義。 */
function skills2OnEnemyKill(pEnt, mEnt, floatSel) {
  var lvs = skill2EarthguardLevels();
  if (!lvs) return false;
  var lg = sgLegendTick('earthguard');
  sgEarthguardKillCdr(pEnt, lvs, lg);
  sgEarthguardKillInvuln(pEnt, lg);
  return sgEarthguardRebirthEnemy(mEnt, floatSel);
}

/* 傳奇【地之心】：每殺 1 個敵人，【天地共生】的復活冷卻縮短。 */
function sgEarthguardKillCdr(pEnt, lvs, lg) {
  var c = lg.egKillCdr;
  if (!c || !pEnt || lvs[6] < 1) return;
  var sec = Math.max(0, Number(c.sec) || 0);
  if (!(sec > 0) || !pEnt.skillCds) return;
  var cd = Number(pEnt.skillCds[SG_PREFIX + 'earthguard']) || 0;
  if (!(cd > 0)) return;
  pEnt.skillCds[SG_PREFIX + 'earthguard'] = Math.max(0, cd - sec);
  if (typeof UI !== 'undefined' && UI.dirty) UI.dirty.skills = true;
}

/* 傳奇【不滅意志】：天地共生的無敵期間，每殺 1 個敵人無敵時間延長。
   只延長**天地共生給的那一段**（SKILL2_RT.rebirthInvuln 是它的時戳），
   其他來源的無敵（潛力、神鑄、【大地之心】）不受影響。 */
function sgEarthguardKillInvuln(pEnt, lg) {
  var w = lg.egKillInvuln;
  if (!w || !pEnt) return;
  var sec = Math.max(0, Number(w.sec) || 0);
  if (!(sec > 0) || !(SKILL2_RT.rebirthInvuln > GT)) return;
  var until = sgRoleExtend(pEnt, 'rebirthInvuln', sec);
  if (until > 0) SKILL2_RT.rebirthInvuln = until;
}

/* 超神【天地再造】：被殺死的普通／菁英敵人機率以一定比例的生命重生。
   `_sgReborn` 掛在敵人實體上（隨實體回收、不入存檔），因此**同一隻只會重生一次**——
   滿級機率會被夾到 100%，沒有這道閘門就是無限刷怪。 */
function sgEarthguardRebirthEnemy(mEnt, floatSel) {
  var u = sgUlt('earthguard', 'worldRebirth');
  if (!u || !mEnt || mEnt._sgReborn) return false;
  if (mEnt.isBoss || mEnt.towerBoss || !(Number(mEnt.maxHp) > 0)) return false;
  if (!chance(Math.min(100, sgUltVal(u, 'chance')))) return false;
  var hpPct = Math.max(1, Math.min(100, sgUltVal(u, 'hp')));
  mEnt._sgReborn = true;
  mEnt.hp = Math.max(1, Math.round(mEnt.maxHp * hpPct / 100));
  mEnt._sgNetherKill = false;   // 上一條命留下的斬殺旗標不帶到新的一條命
  /* preserveDeadTargets：這一刻牠的 hp 已經被寫回去了，但顯示層那一側仍在播死亡動畫，
     特效必須指名這隻屍體才看得到「牠被重新塑形」。 */
  sgEmitVfx('earthguard', [mEnt], floatSel || 'mv-float', {
    fxKind: 'rain', variant: 'pillar', elem: 'earth', dur: 1, preserveDeadTargets: true,
    vfxUlt: 'worldRebirth'
  });
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
  var lg = sgLegend('chainlightning');
  var links = Math.max(1, Math.floor(Number(t[0].fx.count) || 4));
  if (lvs[3] > 0) links += sgRollCount(sgVal(t[3].fx, 'add', lvs[3]));
  if (lvs[6] > 0) links += sgRollCount(sgVal(t[6].fx, 'add', lvs[6]));
  links += sgLegendCount(lg.chainLinkAdd);           // 傳奇【電荷連鎖】
  var splashPct = lvs[4] > 0 ? sgVal(t[4].fx, 'pct', lvs[4]) : 0;
  var cfg = {
    dmgVal: sgGroupBaseStat(g, st) * pct / 100,
    links: links,
    hopPx: bfMeterPx(sgGeometryNumber(t[0].fx, 'm') || 30),
    extraHits: lvs[2] > 0 ? sgRollCount(sgVal(t[2].fx, 'add', lvs[2])) : 0,
    // 傳奇【雷散落】：擴散的傷害提高（乘算在該階自己的比例上），且多打 1 個敵人
    splashPct: splashPct * (1 + Math.max(0, Number(lg.chainSplashPct) || 0) / 100),
    splashCount: Math.max(1, Math.floor(Number(t[4].fx.count) || 1)) + sgLegendCount(lg.chainSplashAdd),
    splashPx: bfMeterPx(sgGeometryNumber(t[4].fx, 'm') || 6),
    selfRelay: lvs[5] > 0,
    // 傳奇【超導】：同一道鏈每彈射 1 次，之後每一擊的傷害再加一份（加算，不複利）
    bouncePct: Math.max(0, Number(lg.chainBouncePct) || 0),
    // 傳奇【過載】：同一個敵人被閃電鏈打滿 N 次就炸開一次（計數掛在敵人實體上，隨實體回收）
    overload: lg.chainOverload || null,
    overloadDmg: lg.chainOverload
      ? sgGroupBaseStat(g, st) * (Number(lg.chainOverload.pct) || 0) / 100 : 0,
    overloadPx: lg.chainOverload ? bfMeterPx(Number(lg.chainOverload.m) || 0) : 0,
    pool: pool, floatSel: floatSel, out: out, pEnt: pEnt, st: st
  };
  var bolts = lvs[6] > 0 ? Math.max(1, Math.floor(Number(t[6].fx.count) || 3)) : 1;
  bolts += sgLegendCount(lg.chainBoltAdd);           // 傳奇【電擊】
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
  // 超神【永恒超導體】：另外一道只在「自身 ↔ 敵人」之間往返的閃電鏈
  sgChainSuperconductor(pEnt, st, cfg, pool, floatSel, out);
  // 超神【飛雷神】：施放後進入放電期，節拍由 sgTickFlyingThunder 驅動
  sgArmFlyingThunder();
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
  var bounces = 0;        // 這一道鏈已經彈射幾次（傳奇【超導】的傷害成長）
  var linksLeft = cfg.links;
  var arrivalMs = 183; // 與電弧圖集前端抵達時刻一致
  var delayMs = arrivalMs;
  sgEmitVfx(gid, [start], floatSel, {
    fxKind: 'chain', variant: 'lightning-chain', count: 1, travelMs: [0],
    preserveDeadTargets: true
  });
  var guard = 0;
  while (linksLeft > 0 && cur && cur.hp > 0 && guard < 64) {
    guard++;
    linksLeft--;
    /* 傳奇【超導】：每彈射 1 次，這一道鏈之後每一擊的傷害就多一份（加算而非複利——
       設計文檔寫的是「每彈射 1 次傷害 +10%」，複利會讓長鏈的尾段爆炸成完全不同的量級）。 */
    var hopDmg = cfg.dmgVal * (1 + cfg.bouncePct * bounces / 100);
    sgHitOne(pEnt, st, cur, hopDmg, gid, floatSel, out, delayMs);
    sgChainOverload(cfg, cur, pool, delayMs);
    // 【雷鳴術】：被擊中的敵人再多吃幾次同樣的閃電傷害（不足 1 次的部分已於施放時擲骰）
    for (var e = 0; e < cfg.extraHits; e++) {
      sgHitOne(pEnt, st, cur, hopDmg, gid, floatSel, out, delayMs + sgStaggerMs(e + 1));
    }
    // 【電殛擴散】：每次彈射時劈向附近的敵人（不占彈射數、不繼續延伸鏈）
    if (isBounce && cfg.splashPct > 0) {
      // 「額外對 m 米內的 count 個敵人」沒有指定最近＝範圍內隨機
      var splash = (typeof bfRandomOthers === 'function')
        ? bfRandomOthers(cur, pool, cfg.splashCount, cfg.splashPx, null) : [];
      for (var s = 0; s < splash.length; s++) {
        sgHitOne(pEnt, st, splash[s], hopDmg * cfg.splashPct / 100, gid, floatSel, out,
          delayMs + sgStaggerMs(s + 1));
      }
      if (splash.length) {
        sgEmitVfx(gid, splash, floatSel, {
          fxKind: 'impact', variant: 'thunder-burst', elem: 'lightning', delayMs: delayMs, dur: 0.3,
          vfxTier: 5
        });
      }
    }
    if (linksLeft <= 0) break;
    var next = sgChainNextTarget(cur, pool, visited, cfg.hopPx);
    if (!next) break;
    visited.push(next);
    if (cfg.spawnChance > 0 && cfg.chainCount < cfg.maxChains &&
        chance(cfg.spawnChance)) {
      cfg.spawnQueue.push(next);
      cfg.chainCount++;
    }
    var hopMs = 300;
    sgEmitVfx(gid, [cur, next], floatSel, {
      fxKind: 'chain', variant: 'lightning-chain', count: 1,
      delayMs: delayMs + hopMs - arrivalMs, travelMs: [0, 0], preserveDeadTargets: true
    });
    delayMs += hopMs;
    cur = next;
    isBounce = true;
    bounces++;
  }
}

/* 傳奇【過載】：同一個敵人被閃電鏈打滿 N 次就在牠身上炸開一次，計數隨即歸零重算。
   計數掛在敵人實體上（純 JSON、隨實體自然回收），因此跨施放也會累積——
   設計文檔寫的是「1 個敵人受到 5 次彈射效果後」，沒有限定同一次施放。
   爆炸傷害是衍生傷害（sgDerivedHit）：它不是一次攻擊，不再過命中與爆擊。 */
function sgChainOverload(cfg, target, pool, delayMs) {
  if (!cfg.overload || !target || target.hp <= 0) return;
  var need = Math.max(1, Math.floor(Number(cfg.overload.hits) || 0));
  target._sgChainHits = (Number(target._sgChainHits) || 0) + 1;
  if (target._sgChainHits < need) return;
  target._sgChainHits -= need;
  if (!(cfg.overloadDmg > 0)) return;
  var victims = sgEnemiesAround(target, pool, cfg.overloadPx);
  if (!victims.length) return;
  sgEmitVfx('chainlightning', victims, cfg.floatSel, {
    fxKind: 'impact', variant: 'thunder-burst', elem: 'lightning', delayMs: delayMs, dur: 0.4,
    vfxTier: 5
  });
  for (var i = 0; i < victims.length; i++) {
    sgDerivedHit(victims[i], cfg.overloadDmg, 'chainlightning', cfg.floatSel, cfg.out, '⚡',
      delayMs + sgStaggerMs(i));
  }
}

/* 超神【永恒超導體】：一道只在「自身 ↔ 敵人」之間往返的閃電鏈。
   「無限彈射」比照【無限追魂刃】的既有裁定＝範圍內每個敵人各命中一次
   （真的不設上限會在敵人一多時變成單次施放無限迴圈）。
   每經過自身一次就疊 1 層超導電荷，該增益提高你的雷電傷害（見 skill2LightningDamageUpPct）。 */
function sgChainSuperconductor(pEnt, st, cfg, pool, floatSel, out) {
  var u = sgUlt('chainlightning', 'eternalSuperconductor');
  if (!u) return;
  var rPx = bfMeterPx(sgUltVal(u, 'm'));
  var live = (typeof bfLiveList === 'function') ? bfLiveList(pool)
    : (pool || []).filter(function (e) { return e && e.hp > 0; });
  var inRange = [];
  for (var i = 0; i < live.length; i++) {
    var d = (typeof bfEntityDistance === 'function') ? bfEntityDistance(live[i]) : null;
    // 無座標（高塔）的敵人距離為 null／NaN：一律視為在範圍內，退化為純單體往返
    if (!(d > 0) || d <= rPx) inRange.push(live[i]);
  }
  if (!inRange.length) return;
  // 「範圍內的任意敵人」＝隨機順序（設計文檔沒有指定最近）
  var order = (typeof bfRandomOthers === 'function')
    ? bfRandomOthers(null, inRange, inRange.length, 0, null) : inRange.slice();
  if (!order.length) order = inRange.slice();
  var perStack = sgUltVal(u, 'pct');
  var maxStacks = Math.max(1, Math.floor(Number(u.def.fx.maxStacks) || 100));
  var delayMs = 0;
  sgEmitPlayerVfx('chainlightning', floatSel,
    { fxKind: 'aura', variant: 'lightning-relay', elem: 'lightning', dur: 0.35, vfxUlt: 'eternalSuperconductor' });
  for (var k = 0; k < order.length; k++) {
    var tgt = order[k];
    if (!tgt || tgt.hp <= 0) continue;
    var hopMs = (typeof bfTravelSeconds === 'function') ? Math.round(bfTravelSeconds(tgt) * 1000) : 0;
    /* 每一跳都是「自身 → 敵人」，因此特效恆是單目標的雷鏈（起點就是玩家）。 */
    sgEmitVfx('chainlightning', [tgt], floatSel, {
      fxKind: 'chain', variant: 'lightning-chain', count: 1,
      delayMs: delayMs, travelMs: [hopMs], preserveDeadTargets: true,
      vfxUlt: 'eternalSuperconductor'
    });
    delayMs += hopMs;
    sgHitOne(pEnt, st, tgt, cfg.dmgVal, 'chainlightning', floatSel, out, delayMs);
    sgSuperconductStack(pEnt, perStack, maxStacks);   // 彈回自身＝疊 1 層
  }
}

/* 超導電荷的疊層：層數上限與單層值都來自參數表，引擎只負責疊。
   持有者記在 RT，死亡／讀檔／進出塔時由 resetSkill2RT 收回（比照【戰神屠錄】）。 */
function sgSuperconductStack(pEnt, perStack, maxStacks) {
  if (!pEnt || !(perStack > 0)) return;
  sgApplySlot(pEnt, 'chainlightning', 'eternalSuperconductor', 'self', 0, { val: perStack, maxStacks: maxStacks });
  SKILL2_RT.superconduct = { pEnt: pEnt };
}

/* 超神【永恒超導體】的雷電傷害增幅（掛在 legendary.js legendaryElementDamageUp——
   全專案「屬性傷害提升%」的唯一收斂點，普攻與新舊技能因此一體生效）。 */
function skill2LightningDamageUpPct(pEnt) {
  var pct = (pEnt && typeof buffVal === 'function') ? Math.max(0, buffVal(pEnt, 'sgSuperconduct')) : 0;
  // 傳奇【超載】（雷球）：場上每有 1 個雷球就再加一份，走同一個收斂點
  return pct + sgThunderorbFieldAmpPct();
}

/* 超神【飛雷神】：施放連鎖閃電後進入放電期，期間每 gap 秒放出 count 道閃電。
   節拍記在 RT（不入存檔）；重複施放會直接重新起算整段持續時間。
   放電對象與飄字都由 tickSkill2 的 ctx 提供，因此這裡只需要時刻。 */
function sgArmFlyingThunder() {
  var u = sgUlt('chainlightning', 'flyingThunderGod');
  if (!u) return;
  var sec = sgUltVal(u, 'sec');
  if (!(sec > 0)) return;
  SKILL2_RT.flyThunder = { until: GT + sec, nextAt: GT };
}

/* 放電期的每一拍：打向範圍內「最遠」的 count 個敵人，各自再炸開一個半徑 r 的範圍。
   最遠而不是最近＝這一招的用意是把打不到的遠處敵人一起收掉，因此距離由遠到近排序。 */
function sgTickFlyingThunder(ctx, dt) {
  var ft = SKILL2_RT.flyThunder;
  if (!ft) return;
  var u = sgUlt('chainlightning', 'flyingThunderGod');
  if (!u || ft.until <= GT || !skills2Equipped('chainlightning')) { SKILL2_RT.flyThunder = null; return; }
  // 死亡／倒地：整段放電期與下一拍一起往後推，剩餘時間不變
  if (skills2AutoCastBlocked(ctx.pEnt)) {
    ft.until = sgPauseSchedule(ft.until, dt);
    ft.nextAt = sgPauseSchedule(ft.nextAt, dt);
    return;
  }
  var gap = Math.max(0.05, sgUltVal(u, 'gap'));
  if (GT < ft.nextAt) return;
  ft.nextAt = GT + gap;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  var farthest = sgFarthestEnemies(enemies, bfMeterPx(sgUltVal(u, 'm')),
    Math.max(1, Math.floor(Number(u.def.fx.count) || 3)));
  if (!farthest.length) return;
  var st = (typeof getStats === 'function') ? getStats() : null;
  if (!st) return;
  var dmgVal = sgGroupBaseStat(SKILLS2.chainlightning, st) * sgUltVal(u, 'pct') / 100;
  var burstPx = bfMeterPx(sgGeometryNumber(u.def.fx, 'r') || 0);
  var out = { killed: false, dmg: 0, crit: false };
  for (var i = 0; i < farthest.length; i++) {
    /* 「目標範圍 r 米內的所有敵人」包含被打中的那一個，因此用 bfTargetsAround（含中心）
       而不是 sgEnemiesAround（排除中心）。無座標（高塔）時退化為只打該目標。 */
    var victims = (typeof bfTargetsAround === 'function' && burstPx > 0)
      ? bfTargetsAround(farthest[i], enemies, burstPx) : [];
    if (!victims.length) victims = [farthest[i]];
    sgEmitVfx('chainlightning', [farthest[i]], ctx.floatSel, {
      fxKind: 'chain', variant: 'lightning-chain', count: 1, delayMs: sgStaggerMs(i),
      preserveDeadTargets: true,
      vfxUlt: 'flyingThunderGod'
    });
    sgEmitVfx('chainlightning', victims, ctx.floatSel, {
      fxKind: 'impact', variant: 'thunder-burst', elem: 'lightning',
      delayMs: sgStaggerMs(i), dur: 0.3, area: sgAreaAround(farthest[i], burstPx),
      vfxUlt: 'flyingThunderGod'
    });
    for (var v = 0; v < victims.length; v++) {
      sgHitOne(ctx.pEnt, st, victims[v], dmgVal, 'chainlightning', ctx.floatSel, out, sgStaggerMs(i));
    }
  }
  if (ctx.onDamage && out.dmg > 0) ctx.onDamage(out.dmg);
  if (out.killed && ctx.onDeaths) ctx.onDeaths();
}

/* 範圍內距離我方「最遠」的 count 個敵人（無座標者排在最後，因為算不出距離）。 */
function sgFarthestEnemies(enemies, rPx, count) {
  var live = (typeof bfLiveList === 'function') ? bfLiveList(enemies)
    : (enemies || []).filter(function (e) { return e && e.hp > 0; });
  var deco = [];
  for (var i = 0; i < live.length; i++) {
    var d = (typeof bfEntityDistance === 'function') ? bfEntityDistance(live[i]) : null;
    if (!(d > 0)) d = 0;                      // 高塔（無座標）：距離視為 0，仍納入候選
    if (rPx > 0 && d > rPx) continue;
    deco.push({ ent: live[i], d: d });
  }
  deco.sort(function (a, b) { return b.d - a.d; });
  var out = [];
  for (var k = 0; k < deco.length && out.length < count; k++) out.push(deco[k].ent);
  return out;
}

/* ===========================================================================
   落雷術（thunderstrike）
   ---------------------------------------------------------------------------
   每一道落雷都是一次「天降打擊」：施放當下只排程與播放落雷特效，
   傷害等到落地那一刻才結算（沿用殞石術的同一條佇列，見 sgQueueMeteor）。
   因此第 5 階【雷電脈衝】的暈眩塗在落地之後，第 7 階【殛道落雷】對
   「已經在暈眩中」的敵人加成才有意義——同一次施放的先落者暈住、後落者吃加成。
   =========================================================================== */
/* 落雷的暈眩：第 5 階【雷電脈衝】的「敵方狀態」第一格（傳奇【震雷】加的暈眩秒數同樣塗這一格）。 */
var SG_THUNDER_STUN_SLOT = { gid: 'thunderstrike', tier: '5' };
function sgCastThunderstrike(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[3] > 0) pct += sgVal(t[3].fx, 'pct', lvs[3]);   // 閃電增幅
  var dmgVal = sgGroupBaseStat(g, st) * pct / 100;
  var lg = sgLegend('thunderstrike');
  var targetCount = Math.max(1, Math.floor(Number(t[0].fx.count) || 2));
  if (lvs[1] > 0) targetCount += sgRollCount(sgVal(t[1].fx, 'add', lvs[1]));
  targetCount += sgLegendCount(lg.thunderTargetAdd);   // 傳奇【雷鎖】
  var hitsPer = 1;
  if (lvs[2] > 0) hitsPer += sgRollCount(sgVal(t[2].fx, 'add', lvs[2]));
  /* 傳奇【三重雷】：直接加在「每個目標的攻擊次數」這個計數上。
     不以【雙重落雷】是否已學為前提——它加的是計數本身（底值 1），
     與【雷之再生】那種「把某一階的機率改寫成 100%」的效果性質不同。 */
  hitsPer += sgLegendCount(lg.thunderHitAdd);
  if (lvs[6] > 0) {
    // 【殛道落雷】：攻擊次數與目標數同時乘倍（在第 2／3 階的追加之後才乘）
    var mult = Math.max(1, Math.floor(Number(t[6].fx.mult) || 2));
    targetCount *= mult;
    hitsPer *= mult;
  }
  var gapMs = Math.max(0, sgGeometryNumber(t[0].fx, 'gap') || 0.2) * 1000;
  for (var boltIndex = 0; boltIndex < targetCount * hitsPer; boltIndex++) {
    if (boltIndex === 0) {
      var first = sgThunderTargets(null, pool, lvs, 1, lg)[0];
      if (first) sgQueueThunderBolt(pEnt, st, g, lvs, dmgVal, first, pool, floatSel, out, 0, 0);
    } else {
      SKILL2_RT.thunderLaunches.push({ at: GT + boltIndex * gapMs / 1000, pEnt: pEnt, st: st,
        g: g, lvs: lvs.slice(), dmgVal: dmgVal, pool: pool, floatSel: floatSel, out: out });
      out._pendingProjectiles = (out._pendingProjectiles || 0) + 1;
    }
  }
  // 超神【雷電矩陣】：與落雷同時橫掃全場的十字雷幕
  sgThunderMatrix(pEnt, st, g, pool, floatSel, out);
}

/* 每道發動時重新取得射程內存活目標；引雷針保留低生命優先規則。 */
function sgThunderTargets(primary, pool, lvs, count, lg) {
  var live = (pool || []).filter(function (e) { return e && e.hp > 0 && skills2CanReach('thunderstrike', e, lvs); });
  var rod = sgThunderRodSpec(lg);
  var priority = rod ? sgThunderRodTargets(live, rod) : [];
  var result = [];
  for (var i = 0; i < count && live.length; i++) {
    result.push(priority.length ? priority[i % priority.length] : live[Math.floor(Math.random() * live.length)]);
  }
  return result;
}

function sgTickThunderLaunches(ctx) {
  var jobs = SKILL2_RT.thunderLaunches;
  for (var i = 0; i < jobs.length;) {
    var job = jobs[i];
    if (job.at > GT) { i++; continue; }
    jobs.splice(i, 1);
    var pool = ctx.getEnemies ? ctx.getEnemies() : job.pool;
    var target = job.pEnt.hp > 0 ? sgThunderTargets(null, pool, job.lvs, 1, sgLegend('thunderstrike'))[0] : null;
    if (target) sgQueueThunderBolt(job.pEnt, job.st, job.g, job.lvs, job.dmgVal, target, pool, job.floatSel, job.out, 0, 0);
    sgFinishSkillCastFloat(job.out);
  }
}

/* 傳奇【引雷針】的規格（沒裝就是 null）。 */
function sgThunderRodSpec(lg) {
  var spec = lg && lg.thunderRod;
  return (spec && Number(spec.m) > 0) ? spec : null;
}

/* 引雷針的候選：我方 m 米內的存活敵人，依「目前生命值」由低到高排序。
   無座標（高塔）的敵人一律視為在範圍內，否則高塔會整個選不到目標。 */
function sgThunderRodTargets(pool, spec) {
  var live = (typeof bfLiveList === 'function') ? bfLiveList(pool)
    : (pool || []).filter(function (e) { return e && e.hp > 0; });
  var rPx = bfMeterPx(Number(spec.m) || 0);
  var picked = [];
  for (var i = 0; i < live.length; i++) {
    var d = (typeof bfEntityDistance === 'function') ? bfEntityDistance(live[i]) : null;
    if (!(d > 0) || d <= rPx) picked.push(live[i]);
  }
  picked.sort(function (a, b) { return (Number(a.hp) || 0) - (Number(b.hp) || 0); });
  return picked;
}

/* 引雷針的加傷：落地當下才判定「這個目標還在不在引雷範圍內」，
   與【殛道落雷】的暈眩加成同一個掛點，因此【迅雷重生】再生出來的落雷也吃得到。
   加成給「範圍內的敵人」而不是只給生命值最低的那一個：選目標本來就已經把範圍內
   最弱的挑出來了，再收斂到單一實體會讓多目標時的加成幾乎全部落空。 */
function sgThunderRodBonusPct(target, spec) {
  if (!spec || !target) return 0;
  var d = (typeof bfEntityDistance === 'function') ? bfEntityDistance(target) : null;
  if (d > 0 && d > bfMeterPx(Number(spec.m) || 0)) return 0;
  return Math.max(0, Number(spec.pct) || 0);
}

/* 一道落雷：排程落地結算，並掛上【雷電脈衝】的暈眩與【迅雷重生】的再生。
   regenDone＝這一條落雷鏈已經再生過幾道（上限來自表格 max，避免無限接力）。 */
function sgQueueThunderBolt(pEnt, st, g, lvs, dmgVal, target, pool, floatSel, out, castDelayMs, regenDone) {
  if (!target || target.hp <= 0) return;
  var t = g.tiers;
  var lg = sgLegend('thunderstrike');
  var fallMs = Math.round(420 * 0.4 / 1.3);
  var timing = { travelMs: fallMs, fallMs: fallMs };
  /* 傳奇【震雷】：暈眩時間 +N 秒。第 5 階沒學時仍會暈——它加的是「被落雷擊中的敵人
     的暈眩時間」這個量本身；但同時暈眩的顆數退回 1（表定的 2 顆屬於【雷電脈衝】）。 */
  var stunSec = (lvs[4] > 0 ? sgVal(t[4].fx, 'sec', lvs[4]) : 0) +
    Math.max(0, Number(lg.thunderStunAdd && lg.thunderStunAdd.sec) || 0);
  var stunCount = lvs[4] > 0 ? Math.max(1, Math.floor(Number(t[4].fx.count) || 2)) : 1;
  var stunPx = bfMeterPx(sgGeometryNumber(t[4].fx, 'm') || 6);
  var quakeVulnPct = Math.max(0, Number(lg.thunderStunnedVulnPct) || 0);
  var vulnPct = lvs[6] > 0 ? sgVal(t[6].fx, 'pct', lvs[6]) : 0;
  var impactRadius = lvs[6] > 0 ? bfMeterPx(sgGeometryNumber(t[6].fx, 'm') || 6) : 0;
  /* 傳奇【雷之再生】：把【迅雷重生】的機率改寫成表定值（提高「至」，不是加上去）。
     只在該階已學時生效——它改寫的是那一階的機率，那一階不存在就沒有東西可以改。 */
  var regenChance = lvs[5] > 0 ? sgVal(t[5].fx, 'chance', lvs[5]) : 0;
  if (lvs[5] > 0 && lg.thunderRegenTo) {
    regenChance = Math.max(regenChance, Math.max(0, Number(lg.thunderRegenTo.chance) || 0));
  }
  var regenMax = Math.max(0, Math.floor(Number(t[5].fx.max) || 5));
  var rod = sgThunderRodSpec(lg);

  sgEmitVfx('thunderstrike', [target], floatSel, {
    fxKind: 'rain', variant: 'thunder-strike', elem: 'lightning', count: 1,
    delayMs: castDelayMs, travelMs: [timing.travelMs]
  });
  sgQueueMeteor(pEnt, st, dmgVal, target, pool, impactRadius, null, floatSel, out,
    GT + (castDelayMs + timing.fallMs) / 1000, {
      gid: 'thunderstrike', variant: 'thunder-impact', elem: 'lightning',
      /* 【殛道落雷】：加成在落地當下才判定——先落的雷把人暈住，後落的才吃得到。
         傳奇【引雷針】的加傷走同一條路（同樣是落地當下的狀態決定）。 */
      bonusPctFn: (vulnPct > 0 || rod) ? function (tgt) {
        return (vulnPct > 0 && sgIsStunned(tgt) ? vulnPct : 0) + sgThunderRodBonusPct(tgt, rod);
      } : null,
      onImpact: function (m, victims, ctx) {
        /* 傳奇【震雷】：被落雷擊中的敵人留下雷痕，暈眩中受到的傷害提高。
           塗在「所有被這道雷打到的敵人」身上，而不是只有被暈的那幾個——
           設計文檔寫的是「受到落雷術擊中的敵人」。 */
        if (quakeVulnPct > 0 && typeof applyStatus === 'function') {
          for (var qi = 0; qi < victims.length; qi++) {
            if (victims[qi] && victims[qi].hp > 0) applyStatus(victims[qi], 'sgThunderQuake', { val: quakeVulnPct });
          }
        }
        if (stunSec > 0) {
          /* 表定範圍＝「目標本身以及 6 米內的任 1 個敵人」，共 stunCount 個。 */
          var stunned = (m.target && m.target.hp > 0) ? [m.target] : [];
          var extra = (typeof bfRandomOthers === 'function')
            ? bfRandomOthers(m.target, m.pool || [], Math.max(0, stunCount - stunned.length), stunPx, null) : [];
          for (var si = 0; si < extra.length; si++) stunned.push(extra[si]);
          for (var vi = 0; vi < stunned.length; vi++) sgTryStun(stunned[vi], stunSec, SG_THUNDER_STUN_SLOT);
        }
        // 【迅雷重生】：每次再生也從當下射程內重新選敵。
        if (regenChance > 0 && regenDone < regenMax && chance(regenChance)) {
          var nextPool = ctx.getEnemies ? ctx.getEnemies() : m.pool;
          var next = sgThunderTargets(null, nextPool, skills2Levels('thunderstrike'), 1, sgLegend('thunderstrike'))[0];
          if (next) {
            sgQueueThunderBolt(m.pEnt, m.st, SKILLS2.thunderstrike, skills2Levels('thunderstrike'),
              m.dmgVal, next, nextPool, m.floatSel, m.out, 0, regenDone + 1);
          }
        }
      }
    });
}

/* ---- 超神【雷電矩陣】（2026-08-26 使用者裁定）----
   橫向與直向各 count 道**移動的雷幕**，各自從場地一側掃到另一側（不是釘在原地的一條線）。
   每一道都橫貫整個戰場：牆身垂直於行進方向、長度蓋滿全場，厚度＝表定的「每道寬」。
   方向交錯：橫向的第 1／3 道由左向右、第 2／4 道由右向左（直向同理），
   因此相鄰兩道會迎面交錯而過。
   幾何、移動與顯示全部走既有的移動場域（`sgSpawnGround` 的牆型場域 ＋ dest／speed），
   本檔不自己算「誰在牆上」，也不另外捏一條顯示用的路徑（AI_RULES 8.3／8.3.1）。 */
/* 掃描起訖點超出出怪環的倍率：雷幕要從場外進場、掃到場外才算「橫掃全場」，
   停在最外圈的敵人身上會看起來像半途消失。 */
var SG_MATRIX_SPAN_MULT = 1.2;
/* 同一軸向上相鄰兩道的起掃間隔（純節奏；四道同時起跑會疊成一道，看不出有四道）。 */
var SG_MATRIX_STAGGER_SEC = 0.12;
/* 模擬步長的上限（秒），鏡射 js/worker/sim.worker.js 的 TICK_MS——那支載入不進本檔
   （本檔要能在主執行緒、Worker 與 Node vm 三種環境跑），因此只能寫一份保守值：
   低估只會讓下面的速度天花板更嚴格，不會讓雷幕漏打。 */
var SG_SIM_MAX_STEP_SEC = 0.1;

function sgThunderMatrix(pEnt, st, g, pool, floatSel, out) {
  var u = sgUlt('thunderstrike', 'thunderMatrix');
  if (!u) return;
  var lines = Math.max(1, Math.round(sgUltVal(u, 'count')));
  var dmgVal = sgGroupBaseStat(g, st) * sgUltVal(u, 'pct') / 100;
  if (!(dmgVal > 0)) return;
  var center = (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null;
  if (!center) { sgThunderMatrixNoField(pEnt, st, pool, floatSel, out, dmgVal, lines); return; }
  var widthPx = bfMeterPx(Math.max(0.5, sgGeometryNumber(u.def.fx, 'wid') || 3));
  /* 一個模擬步長最多只能前進「一個牆厚」，否則雷幕會整個跳過站在中間的敵人
     （接觸判定只看「這一刻誰在牆裡」）。速度因此有一個由每道寬決定的天花板：
     要掃得更快，就得把牆加厚——這兩個值本來就是同一件事的兩面。
     表定值（30 米／秒 × 3 米寬）剛好落在天花板上，正常情況下不會被夾到。 */
  var speedPx = Math.min(bfMeterPx(Math.max(1, sgGeometryNumber(u.def.fx, 'speed') || Number(u.def.fx.mps) || 30)),
    widthPx / SG_SIM_MAX_STEP_SEC);
  var half = ((typeof bfSpawnDist === 'function') ? bfSpawnDist() : 440) * SG_MATRIX_SPAN_MULT;
  /* 節拍必須密到「一拍推進不超過半個牆厚」，否則快速移動的雷幕會從敵人身上跳過去。
     這是計算層與表現層共用的語意參數：厚度或速度一改，節拍自己跟著變。 */
  var gap = Math.max(0.02, Math.min(0.1, widthPx / speedPx / 2));
  var hits = Math.ceil(half * 2 / (speedPx * gap)) + 1;
  var axes = [0, Math.PI / 2];          // 橫向、直向
  for (var a = 0; a < axes.length; a++) {
    for (var i = 0; i < lines; i++) {
      // 第 1／3 道順向、第 2／4 道逆向（使用者指定：相鄰兩道交錯而過）
      var angle = axes[a] + ((i % 2) ? Math.PI : 0);
      var ux = Math.cos(angle), uy = Math.sin(angle);
      sgSpawnGround(pEnt, st, 'thunderstrike', {
        kind: 'thunderwall', floatSel: floatSel, angle: angle,
        from: { x: center.x - ux * half, y: center.y - uy * half },
        dest: { x: center.x + ux * half, y: center.y + uy * half },
        speed: speedPx,
        length: half * 2, width: widthPx,
        dmgVal: dmgVal,
        /* 接觸判定：同一道雷幕掃過去，每個敵人只結算一次
           （否則以這個節拍頻率會變成「每一拍全額命中」的傷害爆炸）。 */
        contact: true,
        gap: gap, hits: hits, tickAtStart: true,
        startDelaySec: i * SG_MATRIX_STAGGER_SEC,
        vfxUlt: 'thunderMatrix'
      });
    }
  }
}

/* 無座標（高塔）時的退化：沒有場地可以掃，改為每一道各命中場上的敵人一次。
   比照其他場域型效果的既有退化方式（無座標＝固定打當初的目標）。 */
function sgThunderMatrixNoField(pEnt, st, pool, floatSel, out, dmgVal, lines) {
  var live = (typeof bfLiveList === 'function') ? bfLiveList(pool)
    : (pool || []).filter(function (e) { return e && e.hp > 0; });
  for (var i = 0; i < lines * 2; i++) {
    for (var v = 0; v < live.length; v++) {
      sgHitOne(pEnt, st, live[v], dmgVal, 'thunderstrike', floatSel, out, sgStaggerMs(i));
    }
  }
}

/* 超神【雷霆天劫】：一道永久存在的雷電，每 gap 秒自己找 m 米內生命值最低的敵人劈下去。
   「永久持續」＝只要落雷術還裝配在技能列上就一直跑（比照【殺神領域】的永久領域），
   因此節拍記在 RT、由 tickSkill2 驅動，而不是綁在某一次施放上。 */
function sgTickHeavenTribulation(ctx, dt) {
  var u = sgUlt('thunderstrike', 'heavenTribulation');
  if (!u || !skills2Equipped('thunderstrike')) { SKILL2_RT.tribulationAt = 0; return; }
  // 死亡／倒地：節拍往後推，剩餘時間不變（見 skills2AutoCastBlocked）
  if (skills2AutoCastBlocked(ctx.pEnt)) {
    SKILL2_RT.tribulationAt = sgPauseSchedule(SKILL2_RT.tribulationAt, dt);
    return;
  }
  var gap = Math.max(0.05, sgUltVal(u, 'gap'));
  if (!(SKILL2_RT.tribulationAt > 0)) { SKILL2_RT.tribulationAt = GT + gap; return; }
  if (GT < SKILL2_RT.tribulationAt) return;
  SKILL2_RT.tribulationAt = GT + gap;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  // 目標規則與傳奇【引雷針】相同（範圍內生命值最低），因此直接沿用同一支選目標
  var candidates = sgThunderRodTargets(enemies, { m: sgUltVal(u, 'm') });
  var target = candidates[0];
  if (!target || target.hp <= 0) return;
  var st = (typeof getStats === 'function') ? getStats() : null;
  if (!st) return;
  var out = { killed: false, dmg: 0, crit: false };
  sgEmitVfx('thunderstrike', [target], ctx.floatSel, {
    fxKind: 'rain', variant: 'thunder-strike', elem: 'lightning', count: 1, dur: 0.35,
    vfxUlt: 'heavenTribulation'
  });
  sgHitOne(ctx.pEnt, st, target,
    sgGroupBaseStat(SKILLS2.thunderstrike, st) * sgUltVal(u, 'pct') / 100,
    'thunderstrike', ctx.floatSel, out, 0);
  if (ctx.onDamage && out.dmg > 0) ctx.onDamage(out.dmg);
  if (out.killed && ctx.onDeaths) ctx.onDeaths();
}

/* ---- 超神「持續 N 秒內每 gap 秒自動再施放 1 次」的共用節拍（2026-08-26）----
   目前兩個使用者：連鎖閃電【天地雷鎖陣】與落雷術【永恒雷獄】——設計文檔的敘述
   一字不差（每隔 X 秒不斷施放，持續 Y 秒），因此收斂成一支而不是各寫一份。
   手動施放時起算（castSkill2 的付費分支），重複施放走 opts.repeat：
   不扣魔、不進冷卻、也不會再把自己續下去。 */
var SG_ULT_REPEAT_IDS = { chainlightning: 'skyThunderArray', thunderstrike: 'eternalThunderPrison' };
function sgArmUltRepeat(gid) {
  var id = SG_ULT_REPEAT_IDS[gid];
  if (!id) return;
  var u = sgUlt(gid, id);
  if (!u) return;
  var sec = sgUltVal(u, 'sec');
  if (!(sec > 0)) return;
  var gap = Math.max(0.1, sgUltVal(u, 'gap'));
  if (!SKILL2_RT.ultRepeat) SKILL2_RT.ultRepeat = {};
  SKILL2_RT.ultRepeat[gid] = { until: GT + sec, nextAt: GT + gap, gap: gap };
}

function sgTickUltRepeat(ctx, dt) {
  if (!SKILL2_RT.ultRepeat) { SKILL2_RT.ultRepeat = {}; return; }
  for (var gid in SKILL2_RT.ultRepeat) {
    var rp = SKILL2_RT.ultRepeat[gid];
    if (!rp || rp.until <= GT || !sgUlt(gid, SG_ULT_REPEAT_IDS[gid]) || !skills2Equipped(gid)) {
      delete SKILL2_RT.ultRepeat[gid];
      continue;
    }
    /* 死亡／倒地：整段持續時間與下一拍一起往後推，剩餘時間不變（比照暴風之舞）。 */
    if (skills2AutoCastBlocked(ctx.pEnt)) {
      rp.until = sgPauseSchedule(rp.until, dt);
      rp.nextAt = sgPauseSchedule(rp.nextAt, dt);
      continue;
    }
    var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
    var guard = 0;
    while (rp.nextAt <= GT && rp.until > GT && guard < 50) {
      guard++;
      rp.nextAt += Math.max(0.1, rp.gap);
      // 暈眩中跳過該次，錯過的不補發（比照暴風之舞與【天霸風神斬】）
      if (typeof effectActive === 'function' && effectActive(ctx.pEnt, 'stun')) continue;
      var res = castSkill2(ctx.pEnt, enemies, gid, ctx.floatSel, { repeat: true });
      if (!res) continue;
      if (ctx.onDamage) ctx.onDamage(res.dmg);
      if (res.killed && ctx.onDeaths) ctx.onDeaths();
      enemies = ctx.getEnemies ? ctx.getEnemies() : enemies;
    }
  }
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
  var lg = sgLegend('thunderorb');
  var ultCritical = sgUlt('thunderorb', 'criticalThunderbolt');
  var ampPct = lvs[4] > 0 ? sgVal(t[4].fx, 'pct', lvs[4]) : 0;   // 【強化雷球】：所有形態共用
  /* 超神【臨界雷劫】的「傷害 +50%」是獨立乘區（比照【烈陽星環】的既有裁定），
     與 T5 那個加算的百分點不是同一種量，因此各自套用而不是併進 ampPct。 */
  var ultMult = ultCritical ? 1 + sgUltVal(ultCritical, 'pct') / 100 : 1;
  /* 體積：T2【擴增雷球】×傳奇【雷核】。兩者都是「體積 +N%」，因此相乘
     （比照火狩的 T2【強化火狩】×傳奇【增焰】）。 */
  var scale = (lvs[1] > 0 ? 1 + sgVal(t[1].fx, 'pct', lvs[1]) / 100 : 1) *
    (1 + Math.max(0, Number(lg.thunderorbScalePct) || 0) / 100);
  var burst = sgThunderorbBurstSpec(g, st);   // 超神【雷爆】：命中後觸發的小型雷球
  var orbCfg = {
    dmgVal: sgGroupBaseStat(g, st) * (sgVal(t[0].fx, 'pct', lvs[0]) + ampPct) / 100 * ultMult,
    radius: bfMeterPx(sgGeometryNumber(t[0].fx, 'm') || 3) * scale,
    gap: Math.max(0.05, sgGeometryNumber(t[0].fx, 'gap') || 0.35),
    parkSec: Math.max(0, Number(t[0].fx.sec) || 2),
    speedPx: Math.max(1, bfMeterPx(sgGeometryNumber(t[0].fx, 'speed') || 6)),
    burst: burst
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
    var body = sgRange(g.range, lvs[0]);
    /* 【伴生雷球】的機率、顆數與持續時間：
         傳奇【感電核心】→ 持續時間 +100%
         超神【臨界雷劫】→ 顆數改為 N 顆、機率乘上倍率（「提高 1 倍」＝×2） */
    var companionChance = lvs[5] > 0 ? sgVal(t[5].fx, 'chance', lvs[5]) : 0;
    if (ultCritical) companionChance *= Math.max(1, sgUltVal(ultCritical, 'chanceMult'));
    var companionSec = Math.max(0.5, Number(t[5].fx.sec) || 2) *
      (1 + Math.max(0, Number(lg.thunderorbCompanionSecPct) || 0) / 100);
    var companionCount = ultCritical ? Math.max(1, Math.floor(sgUltVal(ultCritical, 'count'))) : 1;
    sgSpawnOrbitField(pEnt, st, 'thunderorb', {
      tgt: primary, floatSel: floatSel,
      rings: [{ r: bfMeterPx(sgGeometryNumber(ofx, 'm') || 8), spin: Math.PI * 2 * (Number(ofx.rps) || 0.7) }],
      count: Math.max(1, Math.floor(Number(ofx.count) || 2)),
      dmgVal: sgGroupBaseStat(g, st) * (sgVal(ofx, 'pct', lvs[3]) + ampPct) / 100 * ultMult,
      lifeSec: Math.max(0.5, Number(ofx.sec) || 6),
      bodyR: bfMeterPx(Math.max(body.length, body.width) / 2) * scale,
      statusId: 'sgThunderOrb', statusSlot: { gid: 'thunderorb', tier: '4' }, auraVariant: 'thunder-orbit', vfxTier: 4,
      hitVariant: 'thunder-burst', hitElem: 'lightning',
      /* 【伴生雷球】：命中處留下靜止雷球（傷害與體積比照飛行雷球）。 */
      onStrike: companionChance > 0 ? function (f, orb, pos) {
        if (!pos || !chance(companionChance)) return;
        for (var c = 0; c < companionCount; c++) {
          sgSpawnStationaryThunderOrb(f.pEnt, f.st, f.floatSel, orbCfg, pos, companionSec);
        }
      } : null
    });
  }

  // 【雷殞天落】：追加從天而降的巨大雷球（不取代飛行雷球）
  if (lvs[6] > 0) {
    var fallSpec = sgThunderfallSpec(g, st, lvs, lg,
      sgUlt('thunderorb', 'thunderfallShatter'), ultMult, burst);
    sgDropThunderfall(pEnt, st, fallSpec, fallSpec.count, pool, primary, floatSel, out);
  }
}

/* 【雷殞天落】的一次降下規格。施放時的降下與超神【雷殞天地碎】的永久節拍共用這一支，
   規格因此只寫一次，兩條路徑不會漂移。 */
function sgThunderfallSpec(g, st, lvs, lg, ultShatter, ultMult, burst) {
  var ffx = g.tiers[6].fx;
  var ampPct = lvs[4] > 0 ? sgVal(g.tiers[4].fx, 'pct', lvs[4]) : 0;
  var pct = sgVal(ffx, 'pct', lvs[6]) + ampPct;
  var scale = 1;
  if (ultShatter) {
    pct *= 1 + sgUltVal(ultShatter, 'pct') / 100;   // 「雷殞石傷害 +200%」＝乘區（比照【烈陽星環】）
    scale = 1 + sgUltVal(ultShatter, 'scale') / 100;
  }
  /* 傳奇【雷殞震】：擊中的敵人「會暈眩 4 秒」。表定本來就會暈（衝擊波 3 秒），
     因此取兩者的高者——直接覆寫會讓這個特效在表定值更長時反而變成降級。 */
  var stunSec = Math.max(0, Number(ffx.sec) || 3);
  var stunTo = lg.thunderorbFallStunTo;
  if (stunTo && Number(stunTo.sec) > 0) stunSec = Math.max(stunSec, Number(stunTo.sec));
  return {
    dmgVal: sgGroupBaseStat(g, st) * pct / 100 * (ultMult || 1),
    radius: bfMeterPx(sgGeometryNumber(ffx, 'm') || 15) * scale,
    // 【雷殞落】：降下的顆數 +N
    count: Math.max(1, Math.floor(Number(ffx.count) || 2) + sgLegendCount(lg.thunderorbFallAdd)),
    stunSec: stunSec,
    burst: burst || null
  };
}

/* 降下 n 顆巨大雷球（施放時與【雷殞天地碎】的永久節拍共用同一支）。 */
function sgDropThunderfall(pEnt, st, spec, n, pool, primary, floatSel, out) {
  // Preset 直接使用 travelMs；雷殞降速 50%，落地結算共用同一時間。
  var thunderTravelMs = sgMeteorFallTiming().travelMs * 2;
  var timing = { travelMs: thunderTravelMs, fallMs: thunderTravelMs };
  var nextTarget = sgMeteorTargetBag(primary, pool, spec.radius);
  for (var f = 0; f < n; f++) {
    var target = nextTarget();
    var castDelay = f * SG_METEOR_INTERVAL_MS;
    sgEmitVfx('thunderorb', [target], floatSel, {
      fxKind: 'rain', variant: 'thunder-fall', elem: 'lightning', count: 1,
      area: sgAreaAround(target, spec.radius), delayMs: castDelay, travelMs: [timing.travelMs],
      vfxTier: 7
    });
    sgQueueMeteor(pEnt, st, spec.dmgVal, target, pool, spec.radius, null, floatSel, out,
      GT + (castDelay + timing.fallMs) / 1000, {
        gid: 'thunderorb', variant: 'thunder-fall-impact', elem: 'lightning', vfxTier: 7,
        onImpact: function (m, victims) {
          for (var vi = 0; vi < victims.length; vi++) {
            sgTryStun(victims[vi], spec.stunSec, { gid: 'thunderorb', tier: '7' });
            /* 雷殞石也是「雷球」，因此超神【雷爆】同樣由它的命中觸發
               （沒選那個超神時 spec.burst 為 null，整段不進判定）。 */
            sgThunderorbBurst(m.pEnt, m.st, m.floatSel, spec.burst, victims[vi], m.pool, m.out);
          }
        }
      });
  }
}

/* 超神【雷殞天地碎】：雷殞石不再只在施放時降下，而是每 gap 秒不斷再落下 1 顆。
   「不斷落下」＝只要雷球還裝配在技能列上就一直跑（比照【雷霆天劫】那道永久雷電），
   因此節拍記在 RT、由 tickSkill2 驅動，而不是綁在某一次施放上。
   超神要前 7 階全滿才選得起，所以這裡不必再確認【雷殞天落】有沒有點出來。 */
function sgTickThunderfallShatter(ctx, dt) {
  var u = sgUlt('thunderorb', 'thunderfallShatter');
  if (!u || !skills2Equipped('thunderorb')) { SKILL2_RT.thunderfallAt = 0; return; }
  // 死亡／倒地：節拍往後推，剩餘時間不變（見 skills2AutoCastBlocked）
  if (skills2AutoCastBlocked(ctx.pEnt)) {
    SKILL2_RT.thunderfallAt = sgPauseSchedule(SKILL2_RT.thunderfallAt, dt);
    return;
  }
  var gap = Math.max(0.1, sgUltVal(u, 'gap'));
  if (!(SKILL2_RT.thunderfallAt > 0)) { SKILL2_RT.thunderfallAt = GT + gap; return; }
  if (GT < SKILL2_RT.thunderfallAt) return;
  SKILL2_RT.thunderfallAt = GT + gap;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  var live = (typeof bfLiveList === 'function') ? bfLiveList(enemies) : enemies;
  if (!live.length) return;
  var st = (typeof getStats === 'function') ? getStats() : null;
  if (!st) return;
  var g = SKILLS2.thunderorb;
  /* 落點隨機（設計沒有指定目標規則，比照飛行雷球的「隨機選」）。
     ultMult 固定為 1：一個群組同時只有一個超神生效，【臨界雷劫】不可能同時在。 */
  var primary = live[Math.floor(Math.random() * live.length)];
  var spec = sgThunderfallSpec(g, st, skills2Levels('thunderorb'), sgLegend('thunderorb'),
    u, 1, sgThunderorbBurstSpec(g, st));
  sgDropThunderfall(ctx.pEnt, st, spec, 1, enemies, primary, ctx.floatSel,
    { killed: false, dmg: 0, crit: false });
}

/* 超神【雷爆】的規格：被雷球命中的敵人有機率觸發一顆會彈射的小型雷球。
   傷害基準在施放當下定版（比照傳奇【炎爆】），因此不會被之後的換裝改寫。 */
function sgThunderorbBurstSpec(g, st) {
  var u = sgUlt('thunderorb', 'thunderBurst');
  if (!u) return null;
  var chancePct = sgUltVal(u, 'chance');
  var dmgVal = sgGroupBaseStat(g, st) * sgUltVal(u, 'pct') / 100;
  if (!(chancePct > 0) || !(dmgVal > 0)) return null;
  return {
    chance: chancePct,
    bounces: Math.max(1, Math.floor(sgUltVal(u, 'bounces'))),
    px: bfMeterPx(sgUltVal(u, 'm')),
    dmgVal: dmgVal
  };
}

/* 一顆小型雷球的彈射：從被命中的那個敵人身上開始，在 m 米內逐一跳過去，
   總共命中 bounces 次。第一次就打在觸發它的敵人身上（而不是強制先跳走）——
   否則場上只剩一個 BOSS 時這個超神完全不會生效。
   下一個目標的選法沿用連鎖閃電的既有裁定（設計只規定範圍、沒有寫「最近」＝範圍內隨機）。 */
function sgThunderorbBurst(pEnt, st, floatSel, spec, victim, enemies, out) {
  if (!spec || !victim || victim.hp <= 0 || !chance(spec.chance)) return;
  var live = (typeof bfLiveList === 'function') ? bfLiveList(enemies) : (enemies || []);
  var cur = victim;
  var visited = [victim];
  var delayMs = 0;
  for (var i = 0; i < spec.bounces && cur && cur.hp > 0; i++) {
    sgEmitVfx('thunderorb', [cur], floatSel, {
      fxKind: 'impact', variant: 'thunder-burst', elem: 'lightning', delayMs: delayMs, dur: 0.3,
      vfxUlt: 'thunderBurst'
    });
    sgHitOne(pEnt, st, cur, spec.dmgVal, 'thunderorb', floatSel, out, delayMs, 0, 'lightning');
    var next = sgChainNextTarget(cur, live, visited, spec.px);
    if (!next) break;
    visited.push(next);
    delayMs += sgStaggerMs(i + 1);
    cur = next;
  }
}

/* 傳奇【超載】：場上每存在 1 個雷球，你的雷電傷害就提高一份。
   只數地板場域裡 gid thunderorb、kind orb 的那些＝飛行雷球與伴生雷球——
   環繞的那些在設計文檔裡叫「電球」（見 T4【環體電球】與 T5「所有雷球與電球」），
   不是這一條說的「雷球」。比照傳奇【火龍共鳴】只數火龍捲本體。
   掛點：js/legendary.js legendaryElementDamageUp（屬性傷害提升% 的唯一收斂點）。 */
function sgThunderorbFieldAmpPct() {
  if (!SKILL2_RT || !SKILL2_RT.grounds || !SKILL2_RT.grounds.length) return 0;
  var per = Number(sgLegendTick('thunderorb').thunderorbFieldAmpPct) || 0;
  if (!(per > 0)) return 0;
  var n = 0;
  for (var i = 0; i < SKILL2_RT.grounds.length; i++) {
    var f = SKILL2_RT.grounds[i];
    if (f && f.gid === 'thunderorb' && f.kind === 'orb') n++;
  }
  return per * n;
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
    kind: 'orb', tgt: target, floatSel: floatSel, vfxTier: 1,
    from: from ? { x: from.x, y: from.y } : null,
    dest: (from && to) ? { x: to.x, y: to.y } : null,
    speed: cfg.speedPx, radius: cfg.radius,
    dmgVal: cfg.dmgVal, hits: hits, gap: cfg.gap,
    onHit: sgThunderorbBurstHook(cfg.burst)
  });
}

/* 靜止雷球（【伴生雷球】）：生在環體電球的命中處，不移動，只按節拍打自己的範圍。 */
function sgSpawnStationaryThunderOrb(pEnt, st, floatSel, cfg, pos, lifeSec) {
  sgSpawnGround(pEnt, st, 'thunderorb', {
    kind: 'orb', tgt: null, floatSel: floatSel, vfxTier: 6,
    from: { x: pos.x, y: pos.y }, dest: null, speed: 0,
    radius: cfg.radius, dmgVal: cfg.dmgVal,
    hits: Math.max(1, Math.ceil(lifeSec / cfg.gap)), gap: cfg.gap,
    onHit: sgThunderorbBurstHook(cfg.burst)
  });
}

/* 兩種雷球場域共用的命中後回呼（沒選【雷爆】就是 null＝完全不進判定）。 */
function sgThunderorbBurstHook(burst) {
  if (!burst) return null;
  return function (f, victim, enemies, out) {
    sgThunderorbBurst(f.pEnt, f.st, f.floatSel, burst, victim, enemies, out);
  };
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
   使用者於 2026-08-28 更新的規則：
     1. 寒霜凍傷每跳量依「該次施放的本體傷害 B × 寒霜共用倍率 × 疊層增傷倍率」計算。
        疊層增傷倍率＝(50×目前寒霜總層數＋該來源寒霜階的每級增量×該階等級)%。
        目前水流彈【寒流彈】的每級增量是 20%，且總層數包含所有技能來源的寒霜層數。
     2. 寒霜的移速下降維持加總；攻速下降改為每層乘上 (1−單層下降%)。
     3. 凍結**走既有控場管線**：BOSS 控場免疫、韌性折減與控場遞減全部適用。
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
   本檔只決定「哪個群組、每跳打多少寒冰傷害、一次疊幾層」。
   塗哪四個狀態（層數與緩速／凍傷／凍結標記／凍結的行動限制）由 Skills2「敵方狀態」決定：
   寒冰箭第 2 階、水流彈第 3 階、冰霜新星第 1 階各有一組（slot＝{ gid, tier }，見 SKILL2_STATUS_SLOTS），
   各項預設值讀該格狀態的狀態表欄位；層數、凍傷、凍結的查詢一律走角色，三棵樹塗的寒霜因此共用。 */
function sgStatusNum(sid, field, fallback) {
  var d = (typeof statusDef === 'function') ? statusDef(sid) : null;
  var v = Number(d && d[field]);
  return (isFinite(v) && v > 0) ? v : fallback;
}
var SG_FROST_IDX = { frost: 0, frostBite: 1, frozen: 2, frozenLock: 3 };
var SG_FROST_DEFAULT_SLOT = { gid: 'icearrow', tier: '2' };
function sgFrostSlotSid(slot, role) {
  var s = slot || SG_FROST_DEFAULT_SLOT;
  return sgSlotSid(s.gid, s.tier, 'enemy', SG_FROST_IDX[role]);
}
function sgFrostMaxStacks(slot) { return Math.max(1, Math.floor(sgStatusNum(sgFrostSlotSid(slot, 'frost'), 'maxStacks', 5))); }
/* 單層緩速是 sgFrost 這個狀態自己的效果（攻速下降的乘冪），跟著效果鍵走。 */
function sgFrostSlowPerStack() { return sgStatusNum('sgFrost', 'val', 20); }
function sgFrostGap(slot) { return sgStatusNum(sgFrostSlotSid(slot, 'frostBite'), 'interval', 0.5); }
function sgFrostBaseDur(slot) { return sgStatusNum(sgFrostSlotSid(slot, 'frostBite'), 'dur', 5); }
function sgFrozenSec(slot) { return sgStatusNum(sgFrostSlotSid(slot, 'frozen'), 'dur', 3); }
/* 群組物件 → 群組ID（寒霜規格要記得自己是哪一列塗的）。 */
function sgGroupIdOf(g) {
  for (var gid in SKILLS2) if (Object.prototype.hasOwnProperty.call(SKILLS2, gid) && SKILLS2[gid] === g) return gid;
  return '';
}

/* 增益／減益容器裡這一格是否生效。buffVal 讀的是效果值，而凍結標記的效果值為 0
   （它不加減任何屬性），因此不能用 buffVal 判斷有沒有掛上。 */
function sgBuffActive(ent, key) {
  var b = ent && ent.buffs && ent.buffs[key];
  return !!(b && b.until > GT);
}

/* 【極致寒霜】（冰霜新星 T4）：文檔寫的是「寒霜狀態的傷害／持續時間」，沒有限定
   是哪一棵樹塗上的，因此掛在寒霜共用層——三個群組塗出來的寒霜一起被放大。 */
/* 傳奇【凜冬寒霜】的「寒霜狀態傷害 +N%」同樣沒有限定是哪一棵樹塗上的，
   因此掛在同一個共用層（比照上面【極致寒霜】的既有裁定），兩者相乘。 */
function skill2FrostDmgFactor() {
  var lvs = skills2Levels('frostnova');
  var tier = (lvs && lvs[3] >= 1) ? 1 + sgVal(SKILLS2.frostnova.tiers[3].fx, 'dmgPct', lvs[3]) / 100 : 1;
  var lg = sgLegendTick('frostnova');
  return tier * (1 + Math.max(0, Number(lg.frostnovaFrostDmgPct) || 0) / 100);
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
  var level = Math.max(0, Number(lvs[tierIdx]) || 0);
  var basePct = Number(fx.frostPct);
  if (!(basePct > 0)) basePct = 50;
  var perLevelPct = Math.max(0, Number(fx.frostPctPer) || 0);
  var slot = { gid: sgGroupIdOf(g), tier: String(tierIdx + 1) };
  var gap = sgFrostGap(slot);
  var frostMult = skill2FrostDmgFactor();
  var oneStackPct = basePct + perLevelPct * level;
  return {
    dps: bodyDmg * oneStackPct / 100 * frostMult / gap,
    dur: sgFrostBaseDur(slot) * skill2FrostDurFactor(),
    interval: gap,
    stacksRaw: sgVal(fx, 'stacks', lvs[tierIdx]),
    slot: slot,
    bodyDmg: bodyDmg,
    frostMult: frostMult,
    frostFormula: { basePct: basePct, perLevelPct: perLevelPct, level: level }
  };
}

/* 目前的寒霜層數（權威在疊層狀態的 stacks 欄，由 combat.js stackStep 維護）。
   以角色加總：三棵樹的寒霜格子填不同狀態時，層數仍算在一起。 */
function sgFrostStacks(ent) {
  if (!ent || !ent.buffs) return 0;
  var keys = sgRoleKeys('frost'), n = 0;
  for (var i = 0; i < keys.length; i++) {
    var b = ent.buffs[keys[i]];
    if (b && b.until > GT) n += Math.max(0, Math.floor(b.stacks || 1));
  }
  return n;
}
/* 「帶著寒霜狀態」＝層數還在，或凍傷還在跳（兩者同時到期，任一存在都算）。 */
function sgFrostOn(ent) { return sgFrostStacks(ent) > 0 || sgHasDot(ent, sgRoleSids('frostBite')); }
function sgFrozenOn(ent) { return sgRoleBuffActive(ent, 'frozen'); }
/* 傳奇【深度凍結】的判定對象：「暈眩或凍結中」的敵人。兩者都是控場管線的產物
   （凍結是寒霜疊滿塗上的標記、暈眩走 sgTryStun），因此不必另外記一筆狀態。 */
function sgIceControlled(ent) { return sgFrozenOn(ent) || sgIsStunned(ent); }

/* 依目前總寒霜層數重算這一份凍傷的 DPS。
   每個來源保留自己的 B 與寒霜階等級；層數則讀目標身上的共用 sgFrost，
   因此【海淵葬界】及其他技能塗上的層數都會進入同一個倍率。 */
function sgFrostDps(spec, stacks) {
  if (!spec || !(spec.bodyDmg > 0) || !spec.frostFormula) return Number(spec && spec.dps) || 0;
  var f = spec.frostFormula;
  var pct = Math.max(0, Number(f.basePct) || 50) * Math.max(0, Math.floor(Number(stacks) || 0)) +
    Math.max(0, Number(f.perLevelPct) || 0) * Math.max(0, Number(f.level) || 0);
  var gap = Math.max(0.05, Number(spec.interval) || sgFrostGap());
  var mult = Number(spec.frostMult);
  if (!(mult > 0)) mult = skill2FrostDmgFactor();
  return spec.bodyDmg * pct / 100 * mult / gap;
}

/* 塗上寒霜。回傳實際增加的層數（0＝沒塗上）。
   疊滿層數的**那一次**才凍結：維持在滿層時的重塗不再重新凍結——否則每 0.5 秒
   重塗一次就是永久凍結，等於繞過使用者指定要走的控場遞減。
   ⚠️ 疊層上限與凍結門檻是兩個數字：門檻恆為狀態表的 maxStacks（疊到就凍結），
   上限則可以被兩個來源往上放寬——傳奇【寒霜湧動】（只放寬水流彈自己塗的那一份，
   規格帶著 over）與超神【海淵葬界】（放寬領域內的每一份，不分來源）。
   上限再以「目前層數」為地板：上限比較低的來源重塗時不得把已經疊上去的層數壓回來。 */
function sgApplyFrost(ent, spec, stacksOverride) {
  if (!ent || ent.hp <= 0 || !spec) return 0;
  var slot = spec.slot || SG_FROST_DEFAULT_SLOT;
  // 一次疊幾層：呼叫端指定＞格子填的 stacks＞技能公式（stacksRaw）
  var cellStacks = sgSlotParam(slot.gid, slot.tier, 'enemy', SG_FROST_IDX.frost, 'stacks');
  var raw = (stacksOverride !== undefined && stacksOverride !== null) ? Number(stacksOverride)
    : (cellStacks !== undefined ? cellStacks : Number(spec.stacksRaw));
  var want = sgRollCount(raw);
  if (want <= 0) return 0;
  var max = sgFrostMaxStacks(slot);
  var before = sgFrostStacks(ent);
  var cap = Math.max(max + Math.max(0, Math.floor(Number(spec.over) || 0)) + sgAbyssOverStacks(ent), before);
  // 單層緩速不帶值：吃該格狀態的狀態表「效果數值」
  for (var i = 0; i < want; i++) {
    sgApplySlot(ent, slot.gid, slot.tier, 'enemy', SG_FROST_IDX.frost, { dur: spec.dur, maxStacks: cap, oneStack: true });
  }
  var after = sgFrostStacks(ent);
  var frostDps = sgFrostDps(spec, after);
  if (frostDps > 0) {
    sgApplySlot(ent, slot.gid, slot.tier, 'enemy', SG_FROST_IDX.frostBite, {
      dps: frostDps, dur: spec.dur, interval: spec.interval,
      bodyDmg: spec.bodyDmg, frostMult: spec.frostMult, frostFormula: spec.frostFormula
    });
  }
  if (before < max && after >= max) sgFreezeTarget(ent, slot);
  return after - before;
}

/* 疊滿層數的凍結：行動限制本身交給既有的暈眩管線（使用者決策：走既有控場管線），
   sgTryStun 已擋掉 BOSS 控場免疫與韌性抗性、applyEffect 再套控場遞減。
   凍結標記的長度必須用「實際暈到的秒數」而不是表定秒數——遞減後若標記比行動限制長，
   就會出現「標記著凍結卻早就能行動」的敵人，而【水龍捲】的增傷與冰爆的時機都讀這個標記。 */
function sgFreezeTarget(ent, slot) {
  var s = slot || SG_FROST_DEFAULT_SLOT;
  var sec = Number(sgTryStun(ent, sgFrozenSec(s), { gid: s.gid, tier: s.tier, idx: SG_FROST_IDX.frozenLock }));
  if (!(sec > 0)) return 0;
  sgApplySlot(ent, s.gid, s.tier, 'enemy', SG_FROST_IDX.frozen, { val: 0, dur: sec });
  sgEmitVfx('frostnova', [ent], 'mv-float', { fxKind: 'burst', variant: 'frost-freeze', elem: 'ice', dur: sec, vfxTier: 4 });
  return sec;
}

/* ---- 寒霜緩速的兩個對外掛點（比照泥沼緩速）----
   攻速：formula.js slowFactor｜移速：battlefield.js bfEnemySpeedFactor。
   兩支檔案改吃通用收斂點，日後再增加第三種場域型緩速就不必再動它們。
   寒霜的移速與攻速單層幅度相同，但兩者的疊加運算不同。 */
function skill2FrostSlowPct(ent) {
  return (typeof buffVal === 'function') ? Math.max(0, buffVal(ent, 'sgFrost')) : 0;
}
function skill2FrostMoveFactor(ent) {
  var v = skill2FrostSlowPct(ent);
  return v > 0 ? Math.max(0.05, 1 - Math.min(95, v) / 100) : 1;
}
function skill2FrostAspdFactor(ent) {
  // sgFrost 這個狀態自己的效果：只算它自己的層數（其他狀態填進寒霜格子時，緩速跟著那個狀態的效果鍵走）
  var fb = ent && ent.buffs && ent.buffs.sgFrost;
  var stacks = (fb && fb.until > GT) ? Math.max(0, Math.floor(fb.stacks || 0)) : 0;
  if (!(stacks > 0)) return 1;
  var per = Math.max(0, Math.min(100, sgFrostSlowPerStack())) / 100;
  return Math.max(0.05, Math.pow(1 - per, stacks));
}
function skill2FrostSlowFactor(ent) {
  return skill2FrostMoveFactor(ent);
}
function skill2SlowAspdFactor(ent) { return skill2MireAspdFactor(ent) * skill2FrostAspdFactor(ent) * skill2StiffenFactor(ent); }
function skill2SlowMoveFactor(ent) {
  return skill2MoveSlowFactor(ent) * skill2FrostMoveFactor(ent) * skill2WindMoveFactor(ent) *
    skill2StiffenFactor(ent);
}

/* ---- 【寒冰逆轉】（水流彈 T2）：敵人屬性標籤強制改寫 ----
   掛點：combat.js monsterDefCfg 的 attr 欄——全專案「防守方屬性標籤」的唯一出口，
   因此攻方的「對屬性敵人傷害%」與守方的「對屬性敵人抗性%」兩條既有規則會一起
   認得這次改寫，不必在各傷害端各補一次判斷。 */
/* 超神【深淵火獄】的【火獄烙印】走同一個掛點：屬性改寫只有一個出口，
   兩個來源同時成立時以火獄烙印為準（它是更晚加入、且是超神進化的效果）。 */
function skill2ForcedAttr(ent) {
  if (sgBuffActive(ent, 'sgInferno')) return 'fire';
  return sgBuffActive(ent, 'sgIceRevert') ? 'ice' : '';
}

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
  var biteSids = sgRoleSids('frostBite');
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
    var d = (e.hp > 0) ? sgFindDot(e, biteSids) : null;
    if (!d) { if (e._sgAcc) e._sgAcc.sgFrostBite = 0; continue; }
    if (typeof GT === 'number' && e._sgDotSkipAt === GT) continue;
    if (!e._sgAcc) e._sgAcc = {};
    var acc = (e._sgAcc.sgFrostBite || 0) + dt;
    var gap = Math.max(0.1, d.interval || sgFrostGap());
    while (acc >= gap) {
      acc -= gap;
      // 【寒霜擴散】（水流彈 T5）：寒霜每次作用時有機率擴散給附近的敵人
      if (spreadLv > 0 && chance(sgVal(spreadFx, 'chance', spreadLv))) {
        sgSpreadFrost(e, enemies, spreadFx, d);
      }
    }
    e._sgAcc.sgFrostBite = acc;
  }
  // 每跳的作用特效由 js/combat.js tickStatuses 依狀態表送出，這裡不另外畫。
}

/* 【寒霜擴散】：把「當下這一份寒霜」複製給附近的敵人（固定 1 層）。
   保留來源的 B／共用倍率設定，但在新目標疊層後重新計算，讓目標自己的寒霜總層數生效。 */
function sgSpreadFrost(from, enemies, fx, dot) {
  var radius = bfMeterPx(sgGeometryNumber(fx, 'm') || 10);
  var count = Math.max(1, Math.floor(Number(fx.count) || 1));
  // 「擴散至目標 m 米內的 count 個敵人」沒有指定最近＝範圍內隨機
  var victims = bfRandomOthers(from, enemies, count, radius, null);
  if (!victims.length) return;
  var spec = {
    dps: dot.dps, dur: Math.max(0.1, dot.until - GT), interval: dot.interval, stacksRaw: 1,
    bodyDmg: dot.bodyDmg, frostMult: dot.frostMult, frostFormula: dot.frostFormula,
    slot: { gid: 'waterball', tier: '3' }   // 【寒霜擴散】是水流彈的階，塗水流彈那一組
  };
  var spread = [];
  for (var i = 0; i < victims.length; i++) {
    if (sgApplyFrost(victims[i], spec, 1) > 0) spread.push(victims[i]);
  }
  if (spread.length) {
    sgEmitVfx('waterball', [from].concat(spread), 'mv-float', { fxKind: 'chain', variant: 'frost-spread', elem: 'ice', travelMs: [80], vfxTier: 5 });
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
  var radius = bfMeterPx(sgGeometryNumber(fx, 'm') || 6);
  var victims = sgIceBlastVictims(ent, enemies, radius);
  var floatSel = (ctx && ctx.floatSel) || 'mv-float';
  sgEmitVfx('icearrow', [ent], floatSel, {
    fxKind: 'burst', variant: 'ice-blast', elem: 'ice',
    area: sgAreaAround(ent, radius), preserveDeadTargets: true,
    vfxTier: 7
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
  var metersPerSecond = fx && sgGeometryNumber(fx, 'speed');
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
  var lg = sgLegend('icearrow');
  var ultBurst = sgUlt('icearrow', 'absoluteZeroBurst');
  var ultRift = sgUlt('icearrow', 'infiniteIceRift');
  /* 本體每支傷害：第 1 階 ＋【冰系強化】（文檔明寫「與 1 階的傷害為累加效果」），
     再乘上兩個獨立乘區——傳奇【冰封】與超神【極寒冰爆】的「寒冰箭傷害 +N%」。 */
  var pct = sgVal(t[0].fx, 'pct', lvs[0]) + (lvs[2] > 0 ? sgVal(t[2].fx, 'pct', lvs[2]) : 0);
  var dmgVal = sgGroupBaseStat(g, st) * pct / 100 *
    (1 + Math.max(0, Number(lg.icearrowDamagePct) || 0) / 100) *
    (ultBurst ? 1 + sgUltVal(ultBurst, 'pct') / 100 : 1);
  /* 支數：表定 ＋【冰箭散射】＋ 傳奇【連射】＋ 超神【無限冰裂】
     （後兩者的「不足 1 支的部分」同樣以機率觸發，比照【冰箭散射】）。 */
  var count = Math.max(1, Math.floor(Number(t[0].fx.count) || 2) +
    (lvs[4] > 0 ? sgRollCount(sgVal(t[4].fx, 'add', lvs[4])) : 0) +
    sgLegendCount(lg.icearrowCountAdd) +
    (ultRift ? sgRollCount(sgUltVal(ultRift, 'count')) : 0));
  // 傳奇【凜冬侵蝕】：這棵樹塗出來的寒霜，每跳量與持續時間一起放大
  var frost = sgIcearrowWinterFrost(sgFrostSpec(g, lvs, 1, dmgVal), lg);
  // 傳奇【冰裂箭】與【深度凍結】：每一次命中共用同一份規格（施放當下定版）
  var iceSpec = sgIcearrowLegendSpec(g, st, lvs, lg, pool);
  var pierce = lvs[3] > 0 || lvs[6] > 0;   // 追蹤冰箭同樣先貫穿一次
  var geomOk = (typeof bfAngleTo === 'function') && bfAngleTo(primary) !== null;
  var laneStepDeg = sgGeometryNumber(t[0].fx, 'deg') || 15;
  var centerAngle = geomOk ? bfAngleTo(primary) : 0;

  // 超神【冰之淚】：與本體同時召喚的箭雨（與下面的連射彼此獨立）
  sgCastIceTears(pEnt, st, g, floatSel, primary);

  /* 【寒冰爆裂箭】的連射：波數是第 7 階的性質，與有沒有座標無關，
     因此兩條分支（貫穿／無座標的單體）共用同一組波次參數。
     超神【極寒冰爆】把波數與間隔一起改寫（10 波 / 0.35 秒）。 */
  var homingFx = lvs[6] > 0 ? t[6].fx : null;
  var waveCount = homingFx ? Math.max(1, Math.floor(Number(homingFx.waves) || 3)) : 1;
  var waveGap = homingFx ? Math.max(0, Number(homingFx.waveGap) || 0.3) : 0;
  if (homingFx && ultBurst) {
    waveCount = Math.max(1, Math.floor(sgUltVal(ultBurst, 'waves')));
    waveGap = Math.max(0, sgUltVal(ultBurst, 'waveGap'));
  }

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
          travelMs: [Math.round(flightSec * 1000)],
          vfxTier: 4
        });
        sgQueueFlyingProjectile(pEnt, st, 'icearrow', dmgVal, origin, laneAngle, lineLen,
          floatSel, path, { halfWidthPx: halfWidth, hitFn: sgIcearrowProjectileHit,
            frostSpec: frost, iceSpec: iceSpec, speed: sgIcearrowSpeed(), beginSec: waveDelay }, out);
        // 這支箭飛完直線之後，就地從終點轉入追擊模式（同一個飛行物換飛法）
        if (homingFx) {
          sgSpawnIcearrowHoming(pEnt, st, homingFx, primary, dmgVal, frost, floatSel, {
            from: { x: origin.x + Math.cos(laneAngle) * lineLen,
              y: origin.y + Math.sin(laneAngle) * lineLen },
            moveAngle: laneAngle, wave: wave, startDelaySec: waveDelay + flightSec,
            iceSpec: iceSpec
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
          wvDelayMs + travelMs, null, iceSpec, pool);
        /* 無座標（高塔）時沒有幾何可言，但時序仍然成立：箭飛到目標身上才轉入追擊。 */
        if (homingFx) {
          sgSpawnIcearrowHoming(pEnt, st, homingFx, arrows[i], dmgVal, frost, floatSel, {
            wave: wv, startDelaySec: (wvDelayMs + travelMs) / 1000, iceSpec: iceSpec
          });
        }
      }
    }
  }
}

/* 傳奇【凜冬侵蝕】：寒冰箭塗出來的寒霜，每跳量與持續時間一起 +N%。
   只放大這棵樹的那一份——共用層的【極致寒霜】（冰霜新星 T4）是三個群組一起吃的，
   兩者各自相乘，語意上不衝突。 */
function sgIcearrowWinterFrost(spec, lg) {
  var pct = Math.max(0, Number(lg.icearrowFrostPct) || 0);
  if (!spec || !(pct > 0)) return spec;
  var mult = 1 + pct / 100;
  return Object.assign({}, spec, {
    dps: spec.dps * mult, dur: spec.dur * mult,
    frostMult: (Number(spec.frostMult) || skill2FrostDmgFactor()) * mult
  });
}

/* 寒冰箭這一次施放的傳奇附加規格（【冰裂箭】的分裂箭與【深度凍結】的控場增傷）。
   施放當下定版，之後每一次命中共用同一份；兩個特效都沒裝時回 null＝完全不進判定。
   分裂箭的「150% 寒冰傷害」比照技能樹的既有寫法＝群組基礎值的百分比，
   不是「本體這一箭傷害的 150%」——後者會讓它跟著 T1／T3 的投資一起複利。 */
function sgIcearrowLegendSpec(g, st, lvs, lg, pool) {
  var split = null;
  var sp = lg.icearrowSplit;
  if (sp && Number(sp.count) > 0 && Number(sp.pct) > 0) {
    split = {
      count: Math.max(1, Math.floor(Number(sp.count))),
      dmgVal: sgGroupBaseStat(g, st) * Number(sp.pct) / 100,
      lenPx: skills2CastRangePx('icearrow', lvs),
      pool: pool || null
    };
  }
  var ctrlPct = Math.max(0, Number(lg.icearrowControlPct) || 0);
  return (split || ctrlPct > 0) ? { split: split, ctrlPct: ctrlPct } : null;
}

/* 傳奇【冰裂箭】：一支寒冰箭命中之後，從該敵人身上再往前分裂出 n 支小箭。
   「前方」＝我方→該敵人的方位（箭本來就是朝那個方向飛的），路徑長度取寒冰箭
   表定射程，不另外發明一個距離。小箭一支咬一個，目標不足時輪流分配
   （比照飛刀與寒冰箭第 1 階的既有語意）。
   前方沒有敵人、或沒有座標（高塔）時就落在原目標身上——那裡沒有前後可言。 */
function sgIcearrowSplit(pEnt, st, spec, victim, enemies, floatSel, out, angleHint) {
  if (!spec || !spec.split || !victim) return;
  var n = spec.split.count;
  var dmgVal = spec.split.dmgVal;
  if (!(n > 0) || !(dmgVal > 0)) return;
  var pool = (enemies && enemies.length) ? enemies : spec.split.pool;
  var from = (typeof bfPos === 'function') ? bfPos(victim) : null;
  var ang = (typeof angleHint === 'number' && isFinite(angleHint)) ? angleHint
    : ((typeof bfAngleTo === 'function') ? bfAngleTo(victim) : null);
  var picks = [];
  if (from && ang !== null && ang !== undefined && typeof bfLineTargets === 'function' && pool) {
    var path = bfLineTargets(ang, spec.split.lenPx, pool, SG_FLYING_PROJECTILE_HALF_WIDTH, from);
    for (var i = 0; i < path.length && picks.length < n; i++) {
      if (path[i] !== victim && path[i].hp > 0) picks.push(path[i]);
    }
  }
  if (!picks.length) picks = [victim];
  sgEmitVfx('icearrow', picks, floatSel, {
    fxKind: 'projectile', variant: 'ice-arrow', elem: 'ice', count: picks.length, dur: 0.25
  });
  for (var k = 0; k < n; k++) {
    sgHitOne(pEnt, st, picks[k % picks.length], dmgVal, 'icearrow', floatSel, out, sgStaggerMs(k + 1));
  }
}

/* 超神【冰之淚】：施放寒冰箭時同時召喚 N 波箭雨從天射下。
   走既有的「跟隨我方的地板場域」（暴風雪那一條路）：圓心恆等於我方當下座標、
   每一拍對範圍內的所有敵人各打一次，波數＝拍數、波距＝節拍。
   「範圍 30 米內」沒有指定圓心，取我方——這是施放者放出來的箭雨，
   錨定方式與【火神降臨】的領域一致。
   顯示層用既有的 rain 泛用畫法（見 sgGroundVfxSpec 的 icerain）。 */
function sgCastIceTears(pEnt, st, g, floatSel, primary) {
  var u = sgUlt('icearrow', 'tearsOfIce');
  if (!u) return;
  var waves = Math.max(1, Math.floor(sgUltVal(u, 'waves')));
  var dmgVal = sgGroupBaseStat(g, st) * sgUltVal(u, 'pct') / 100;
  if (!(dmgVal > 0)) return;
  sgSpawnGround(pEnt, st, 'icearrow', {
    kind: 'icerain', tgt: primary, floatSel: floatSel, follow: true,
    from: (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null,
    radius: bfMeterPx(sgUltVal(u, 'm')),
    dmgVal: dmgVal, hits: waves, gap: Math.max(0.05, sgUltVal(u, 'gap')),
    tickAtStart: true,
    vfxUlt: 'tearsOfIce'
  });
}

/* 【寒冰爆裂箭】的追擊段：由「這支箭飛完直線的那一刻、那個位置、那個航向」接手，
   在 chaseM 米內來回穿梭。opts 留白＝沒有座標的退化路徑（就地咬住原目標）。 */
function sgSpawnIcearrowHoming(pEnt, st, hfx, target, dmgVal, frost, floatSel, opts) {
  var lifeSec = Math.max(0.5, Number(hfx.sec) || 6);
  var gap = Math.max(0.05, sgGeometryNumber(hfx, 'gap') || 0.1);
  var o = opts || {};
  var ice = o.iceSpec || null;
  sgSpawnGround(pEnt, st, 'icearrow', {
    kind: 'icearrow', tgt: target, floatSel: floatSel,
    from: o.from || null,
    /* dest 留白：出生點就是貫穿終點，下一個落點由追擊邏輯自己在範圍內挑，
       初始航向沿用貫穿方向，因此是「順著飛出去再彎回來」而不是原地轉向。 */
    moveAngle: o.moveAngle,
    radius: bfMeterPx(sgGeometryNumber(hfx, 'bodyM') || 1.5),
    dmgVal: dmgVal, hits: Math.max(1, Math.round(lifeSec / gap)), gap: gap,
    speed: sgIcearrowSpeed(), chaseM: sgGeometryNumber(hfx, 'chaseM') || 30,
    contact: true, frostSpec: frost, tickAtStart: true,
    /* 追擊段同樣是「寒冰箭擊中敵人」，因此兩個傳奇特效照樣生效：
       【深度凍結】走場域的控場增傷、【冰裂箭】走場域的命中後回呼。 */
    ctrlPct: ice ? ice.ctrlPct : 0,
    onHit: (ice && ice.split) ? function (f, victim, enemies, o2) {
      sgIcearrowSplit(f.pEnt, f.st, ice, victim, enemies, f.floatSel, o2, f.moveAngle);
    } : null,
    wave: o.wave, startDelaySec: o.startDelaySec,
    vfxTier: 7
  });
}

/* 一支冰箭命中一個敵人：本體傷害 → 寒霜 →【寒霜凍結】的追加層數與剩餘傷害引爆。
   順序是刻意的：先讓本體傷害結算完，再判斷「命中前」是否已帶寒霜——
   否則本次自己塗上的寒霜會讓第 6 階每一箭都必定觸發。
   iceSpec＝這一次施放的傳奇附加規格（【深度凍結】的增傷在命中前套、
   【冰裂箭】的分裂箭在命中後放），沒裝那兩個特效時為 null。 */
function sgIcearrowHit(pEnt, st, target, dmgVal, frost, lvs, floatSel, out, delayMs, ctx, iceSpec, pool) {
  if (!target || target.hp <= 0) return null;
  var hadFrost = sgFrostOn(target);
  // 傳奇【深度凍結】：擊中暈眩或凍結中的敵人時增傷（走 sgHitOne 的總傷加成，仍過防禦與爆擊）
  var bonusPct = (iceSpec && iceSpec.ctrlPct > 0 && sgIceControlled(target)) ? iceSpec.ctrlPct : 0;
  var res = sgHitOne(pEnt, st, target, dmgVal, 'icearrow', floatSel, out, delayMs, bonusPct);
  if (!res || res.miss) return res;
  if (hadFrost && lvs[5] > 0) sgFrostShatter(target, lvs, floatSel, out, ctx);
  if (frost && target.hp > 0) sgApplyFrost(target, frost);
  if (iceSpec && iceSpec.split) sgIcearrowSplit(pEnt, st, iceSpec, target, pool, floatSel, out);
  return res;
}

/* 【寒霜凍結】（寒冰箭 T6）：對已帶寒霜的敵人再疊 N 層，並「造成寒霜所剩餘的寒冰傷害」——
   把還沒跳完的凍傷一次結清（比照血刃斬【零日感染】的立即結算），結清後該筆凍傷就結束。
   追加層數在結清之後才塗：新塗上的那一份不該被同一次結算一起清掉。 */
function sgFrostShatter(target, lvs, floatSel, out, ctx) {
  var dot = sgFindDot(target, sgRoleSids('frostBite'));
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
    { dps: 0, dur: sgFrostBaseDur(SG_FROST_DEFAULT_SLOT) * skill2FrostDurFactor(), interval: sgFrostGap(SG_FROST_DEFAULT_SLOT),
      stacksRaw: 1, slot: SG_FROST_DEFAULT_SLOT },
    sgVal(fx, 'stacks', lvs[5]));
}

/* 貫穿冰箭的路徑命中：與單體冰箭走同一支結算（含寒霜與寒霜凍結）。 */
function sgIcearrowProjectileHit(projectile, target, ctx) {
  var before = projectile.out.dmg;
  sgIcearrowHit(projectile.pEnt, projectile.st, target, projectile.dmgVal,
    projectile.frostSpec, skills2Levels('icearrow'), projectile.floatSel, projectile.out, 0, ctx,
    projectile.iceSpec, ctx && ctx.getEnemies ? ctx.getEnemies() : null);
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
   傳奇進化第十批（2026-08-28）掛在這棵樹上的五個特效全部沿用既有形態，
   沒有為任何一個另開模擬迴圈：顆數與彈射數走既有的兩個計數、爆散改為冰霜新星
   只換層數與畫法、【水龍勢】捲起來的就是一道【水龍捲】場域。
   =========================================================================== */
function sgCastWaterball(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var lg = sgLegend('waterball');
  var dmgVal = sgGroupBaseStat(g, st) * sgVal(t[0].fx, 'pct', lvs[0]) / 100;
  // 傳奇【寒霜湧動】：這棵樹塗出來的寒霜可以疊過凍結門檻；凍傷倍率走共用總層數公式
  var frost = sgWaterballFrostSpec(sgFrostSpec(g, lvs, 2, dmgVal), lg);
  var revertSec = lvs[1] > 0 ? Math.max(0.1, Number(t[1].fx.sec) || 6) : 0;
  var revertPct = lvs[1] > 0 ? sgVal(t[1].fx, 'pct', lvs[1]) : 0;
  /* 傳奇【冰霜擴散】：爆散改為冰霜新星。放大的是**爆散自己的**半徑
     （設計文字接在「擴散爆炸」後面），不是換成冰霜新星那一棵樹的表定半徑。 */
  var nova = lvs[3] > 0 ? sgWaterballNovaSpec(lg) : null;
  var burstR = bfMeterPx(sgGeometryNumber(t[0].fx, 'm') || 6) * (nova ? nova.scale : 1);
  /* 彈射次數＝表定 ＋ 傳奇【激流】。傳奇那一份不以第 4 階已學為前提
     （比照【電擊】的既有裁定：彈射是水流彈自己的行為，沒學第 4 階時底值是 0 次）。 */
  var bounces = (lvs[3] > 0 ? sgRollCount(sgVal(t[3].fx, 'bounce', lvs[3])) : 0) +
    sgLegendCount(lg.waterballBounceAdd);
  // 【三重流水】＋ 傳奇【水流連彈】：朝隨機目標額外丟出 N 顆（不足 1 顆的部分以機率觸發）
  var extra = (lvs[5] > 0 ? sgRollCount(sgVal(t[5].fx, 'add', lvs[5])) : 0) +
    sgLegendCount(lg.waterballShotAdd);
  var shots = [primary];
  for (var e = 0; e < extra; e++) {
    var rnd = sgRandomEnemyNearPlayer(pool, skills2CastRangePx('waterball', lvs), null);
    shots.push(rnd || primary);
  }
  var arcM = sgGeometryNumber(t[0].fx, 'arcM') || 8;
  // 傳奇【激流】：彈射速度 +N% ＝ 每一段彈射的飛行時間 ÷(1+N%)
  var bounceSpeed = 1 + Math.max(0, Number(lg.waterballBounceSpeedPct) || 0) / 100;
  // 傳奇【水龍勢】：命中時機率捲起一道水龍捲（規格於施放當下定版，比照傳奇【炎爆】）
  var tornado = sgWaterballTornadoSpec(g, st, lg);

  for (var si = 0; si < shots.length; si++) {
    sgWaterballShot(pEnt, st, g, lvs, pool, shots[si], floatSel, out, {
      dmgVal: dmgVal, frost: frost, revertSec: revertSec, revertPct: revertPct,
      burstR: burstR, bounces: bounces, arcM: arcM, nova: nova,
      bounceSpeed: bounceSpeed, tornado: tornado,
      delayMs: si * SG_WATERBALL_VOLLEY_MS
    });
  }

  // 【水龍捲】：由我方正方形四個頂點出發，沿逆時針螺旋向外移動。
  if (lvs[6] > 0) sgSpawnWaterTornadoes(pEnt, st, g, lvs, floatSel);
  // 超神【水牢天瀑】：在我方周圍圍起一圈水牢
  sgCastWaterPrison(pEnt, floatSel);
}

/* 傳奇【冰霜擴散】的規格：爆散改為冰霜新星。比照【暴風之刃】借用【風刃】第 1 階的
   既有裁定——借的是「冰霜新星長什麼樣子」（第 1 階 Lv.1 的寒霜層數與新星畫法），
   傷害與傷害紀錄仍歸水流彈這個群組，因此沒有投資冰霜新星的人一樣拿得到完整效果。 */
function sgWaterballNovaSpec(lg) {
  var n = lg && lg.waterballBurstNova;
  if (!n) return null;
  return {
    scale: 1 + Math.max(0, Number(n.scalePct) || 0) / 100,
    stacks: Math.max(1, sgVal(SKILLS2.frostnova.tiers[0].fx, 'stacks', 1))
  };
}

/* 傳奇【寒霜湧動】：水流彈塗出來的寒霜可以疊過凍結門檻再多 5 層。
   凍傷倍率已統一由 sgApplyFrost 依目標的寒霜總層數計算；超神【海淵葬界】的額外層數
   同樣掛在疊層上限的共用層，因此不分來源都會進入該倍率。 */
function sgWaterballFrostSpec(spec, lg) {
  var o = lg && lg.waterballFrostOver;
  if (!spec || !o) return spec;
  return Object.assign({}, spec, {
    over: Math.max(0, Math.floor(Number(o.count) || 0))
  });
}

/* 傳奇【水龍勢】的規格：捲起來的就是一道【水龍捲】，因此半徑、節拍與對凍結敵人的
   倍率沿用第 7 階的表定值，只有段數與傷害% 由特效自己給（比照【暴風之刃】借形態）。 */
function sgWaterballTornadoSpec(g, st, lg) {
  var p = lg && lg.waterballTornadoProc;
  if (!p || !(Number(p.chance) > 0)) return null;
  var dmgVal = sgGroupBaseStat(g, st) * (Number(p.pct) || 0) / 100;
  if (!(dmgVal > 0)) return null;
  var fx = g.tiers[6].fx;
  return {
    chance: Number(p.chance),
    hits: Math.max(1, Math.floor(Number(p.hits) || 1)),
    dmgVal: dmgVal,
    radius: bfMeterPx(sgGeometryNumber(fx, 'm') || 5),
    gap: Math.max(0.05, sgGeometryNumber(fx, 'gap') || 0.35),
    frozenMult: Math.max(1, Number(fx.frozen) || 2)
  };
}

/* 一顆水流彈：飛行（拋物線，顯示層用 arcM 畫弧）→ 命中 → 爆散 → 彈射。
   彈射鏈的每一段都接在前一段的飛行時間之後，飄字與畫面才對得上。 */
function sgWaterballShot(pEnt, st, g, lvs, pool, target, floatSel, out, cfg) {
  if (!target || target.hp <= 0) return;
  var shot={pEnt:pEnt,st:st,pool:pool,target:target,floatSel:floatSel,out:out,cfg:cfg,
    at:GT+Math.max(0,cfg.delayMs||0)/1000,phase:'launch',hops:cfg.bounces,visited:[target],origin:null};
  SKILL2_RT.waterballs.push(shot);
  out._pendingProjectiles=(out._pendingProjectiles||0)+1;
  if(shot.at<=GT) sgLaunchWaterball(shot);
}
function sgLaunchWaterball(shot) {
  var start=shot.origin||bfPos(shot.pEnt),end=bfPos(shot.target);
  shot.noCoordinates=!start||!end;
  if(shot.noCoordinates){start={x:0,y:0};end={x:0,y:0};}
  shot.origin={x:start.x,y:start.y};shot.landing={x:end.x,y:end.y};
  var speed=sgConfiguredFlightSpeed('waterball',1,504)*(shot.bounced?shot.cfg.bounceSpeed:1);
  var travelMs=shot.noCoordinates ? Math.max(1,Math.round(sgConfiguredTravelSeconds('waterball',shot.target)*1000/(shot.bounced?shot.cfg.bounceSpeed:1))) : Math.max(1,Math.round(Math.hypot(end.x-start.x,end.y-start.y)/speed*1000));
  shot.at=GT+travelMs/1000;shot.phase='landing';
  sgEmitVfx('waterball',shot.noCoordinates?[shot.target]:[],shot.floatSel,{fxKind:'projectile',variant:'waterball',
    travelMs:[travelMs],arcM:shot.cfg.arcM,projectile:true,vfxTier:1,
    area:shot.noCoordinates?null:{x:end.x,y:end.y,r:shot.cfg.burstR,sourceX:start.x,sourceY:start.y,fixedLanding:true}});
  return true;
}
function sgTickWaterballs(ctx) {
  var list=SKILL2_RT.waterballs||[];SKILL2_RT.waterballs=[];
  for(var i=0;i<list.length;i++){
    var shot=list[i],pool=ctx.enemies||shot.pool||[];
    if(!shot.pEnt||shot.pEnt.hp<=0){sgFinishSkillCastFloat(shot.out);continue;}
    if(shot.at>GT){SKILL2_RT.waterballs.push(shot);continue;}
    if(shot.phase==='launch'){
      if(shot.target.hp<=0) shot.target=sgRandomEnemyNearPlayer(pool,0,null);
      if(shot.target&&sgLaunchWaterball(shot)) SKILL2_RT.waterballs.push(shot);
      else sgFinishSkillCastFloat(shot.out);
      continue;
    }
    var centre={pos:shot.landing},victims=shot.noCoordinates?(shot.target.hp>0&&pool.indexOf(shot.target)>=0?[shot.target]:[]):bfTargetsAround(centre,pool,shot.cfg.burstR);
    var before=shot.out.dmg,killed=false;
    if(shot.cfg.nova) sgEmitVfx('waterball',victims,shot.floatSel,{fxKind:'burst',variant:'frost-nova',area:shot.noCoordinates?null:sgAreaAround(centre,shot.cfg.burstR),vfxTier:4});
    sgEmitVfx('waterball',shot.noCoordinates?victims:[],shot.floatSel,{fxKind:'impact',variant:'water-impact',elem:'ice',
      area:shot.noCoordinates?null:{x:shot.landing.x,y:shot.landing.y,r:shot.cfg.burstR},vfxTier:1});
    for(var v=0;v<victims.length;v++){
      var res=sgWaterballHit(shot.pEnt,shot.st,victims[v],shot.cfg,shot.floatSel,shot.out,0);
      if(res&&res.killed)killed=true;
    }
    if(ctx.onDamage&&shot.out.dmg>before)ctx.onDamage(shot.out.dmg-before);
    if(killed&&ctx.onDeaths)ctx.onDeaths();
    var next=shot.hops>0?(bfRandomOther(shot.target,pool,0,shot.visited)||bfRandomOther(shot.target,pool,0,null)):null;
    if(next&&next.hp>0){
      shot.hops--;shot.visited.push(next);shot.target=next;shot.origin=shot.landing;shot.bounced=true;
      if(sgLaunchWaterball(shot)){SKILL2_RT.waterballs.push(shot);continue;}
    }
    sgFinishSkillCastFloat(shot.out);
  }
}

/* 水流彈命中一個敵人：本體傷害 →【寒冰逆轉】→ 寒霜 →【水龍勢】。
   逆轉塗在傷害之後：本次命中不吃自己造成的受傷增幅，之後的每一次才吃到
   （與落雷術「暈眩塗在傷害之後、後落的雷才吃到增傷」同一個處理原則）。 */
function sgWaterballHit(pEnt, st, target, cfg, floatSel, out, delayMs) {
  if (!target || target.hp <= 0) return null;
  var res = sgHitOne(pEnt, st, target, cfg.dmgVal, 'waterball', floatSel, out, delayMs);
  if (!res || res.miss || target.hp <= 0) return res;
  if (cfg.revertSec > 0) {
    sgApplySlot(target, 'waterball', '2', 'enemy', 0, { val: cfg.revertPct, dur: cfg.revertSec });
  }
  /* 傳奇【冰霜擴散】讓爆散改為冰霜新星：塗上去的層數改用新星第 1 階的層數，
     每跳量仍是水流彈自己的那一份（換的是形態，不是傷害來源）。 */
  if (cfg.frost) sgApplyFrost(target, cfg.frost, cfg.nova ? cfg.nova.stacks : undefined);
  // 傳奇【水龍勢】：命中時機率在該敵人腳下捲起一道水龍捲
  if (cfg.tornado && chance(cfg.tornado.chance)) {
    sgSpawnWaterTornadoAt(pEnt, st, cfg.tornado, target, floatSel);
  }
  return res;
}

/* 【水龍捲】（水流彈 T7）：以施放位置為固定中心，從正方形四頂點逆時針向外螺旋。
   徑向分量占速率三分之一，其餘為切向分量，總路徑速度保持等速。 */
function sgSpawnWaterTornadoes(pEnt, st, g, lvs, floatSel) {
  var fx = g.tiers[6].fx;
  var p = (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null;
  var half = bfMeterPx(sgGeometryNumber(fx, 'side') || 10) / 2;
  var halfWidth = bfMeterPx(sgGeometryNumber(fx, 'sideWidth') || sgGeometryNumber(fx, 'side') || 10) / 2;
  var radius = bfMeterPx(sgGeometryNumber(fx, 'm') || 5);
  var gap = Math.max(0.05, sgGeometryNumber(fx, 'gap') || 0.35);
  var hits = Math.max(1, Math.floor(Number(fx.hits) || 6));
  var dmgVal = sgGroupBaseStat(g, st) * sgVal(fx, 'pct', lvs[6]) / 100;
  var corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  var count = Math.max(1, Math.floor(Number(fx.count) || 4));
  for (var i = 0; i < count; i++) {
    var c = corners[i % corners.length];
    sgSpawnGround(pEnt, st, 'waterball', {
      kind: 'tornado', tgt: null, floatSel: floatSel,
      from: p ? { x: p.x + c[0] * half, y: p.y + c[1] * halfWidth } : null,
      spiralCentre: p ? { x: p.x, y: p.y } : null,
      speed: bfMeterPx(3),
      moveAngle: Math.atan2(c[1], c[0]) - Math.atan(Math.sqrt(8)),
      radius: radius, dmgVal: dmgVal, hits: hits, gap: gap,
      frozenMult: Math.max(1, Number(fx.frozen) || 2),
      delaySec: i * gap * 0.15,
      vfxTier: 7
    });
  }
}

/* 傳奇【水龍勢】捲起來的那一道：釘在被命中的敵人當下的位置（不跟著它走，
   比照【水龍捲】的既有裁定）。場域總量上限只是防呆——一次爆散可以打十幾個敵人，
   每一個都判定一次，不擋的話場上的場域數會被機率放大到失控。 */
function sgSpawnWaterTornadoAt(pEnt, st, spec, target, floatSel) {
  if (!SKILL2_RT || SKILL2_RT.grounds.length >= SG_GROUND_MAX_FIELDS) return;
  sgSpawnGround(pEnt, st, 'waterball', {
    kind: 'tornado', tgt: target, floatSel: floatSel,
    radius: spec.radius, dmgVal: spec.dmgVal, hits: spec.hits, gap: spec.gap,
    frozenMult: spec.frozenMult,
    vfxTier: 7
  });
}

/* ---- 超神【水牢天瀑】：施放時在我方周圍圍起一圈水牢 ----
   權威是 SKILL2_RT.waterPrison（執行期，絕不入存檔）：範圍與到期時刻都在那裡，
   遠程封鎖（js/combat.js fieldMonsterAttack）與逐拍重塗讀的是同一份。
   減益本身不另建一套：攻擊力下降沿用既有的 atkDown，受到的傷害提高走
   skill2VulnACfg 的同一個 totalDmgPct（新增的 sgWaterPrison 只是那個百分點的容器）。 */
var SG_WATER_PRISON_GAP = 0.5;   // 水牢重塗減益的節拍（秒）：只決定「走進水牢後多久被關住」
function sgCastWaterPrison(pEnt, floatSel) {
  var u = sgUlt('waterball', 'waterPrisonFall');
  if (!u) return;
  var sec = Math.max(0.1, Number(u.def.fx.sec) || 6);
  SKILL2_RT.waterPrison = {
    until: GT + sec, radius: bfMeterPx(sgUltVal(u, 'm')),
    atkRed: sgUltVal(u, 'atkRed'), vuln: sgUltVal(u, 'vuln'),
    nextAt: 0, floatSel: floatSel || 'mv-float'
  };
}

/* 水牢的一拍：把範圍內的敵人重新關進去。減益的長度＝水牢自己的剩餘時間，
   因此牢一消失，裡面的敵人也同時脫離（不會有「牢沒了還被關著」的殘留）。 */
function sgTickWaterPrison(ctx, dt) {
  var wp = SKILL2_RT && SKILL2_RT.waterPrison;
  if (!wp) { sgEndDomainStatus('waterPrisonDomain'); return; }
  if (wp.until <= GT || !sgUlt('waterball', 'waterPrisonFall')) {
    SKILL2_RT.waterPrison = null; sgEndDomainStatus('waterPrisonDomain'); return;
  }
  // 死亡／倒地：整段持續時間與下一拍一起往後推，剩餘時間不變（見 skills2AutoCastBlocked）
  var blocked = skills2AutoCastBlocked(ctx.pEnt);
  if (blocked) {
    wp.until = sgPauseSchedule(wp.until, dt);
    wp.nextAt = sgPauseSchedule(wp.nextAt, dt);
  }
  /* 水牢是玩家身上的狀態，持續到水牢結束：範圍的畫面是它的「持續特效」，依水牢半徑縮放、逐幀跟著玩家
     （水牢是「周圍 20 米」，跟著人走才對得上判定）。倒地時也要同步，狀態的到期時刻才會跟著水牢往後推。 */
  if (wp.radius > 0) sgSyncDomainStatus(ctx.pEnt, 'waterPrisonDomain', wp.radius, wp.until - GT);
  if (blocked) return;
  if (wp.nextAt > GT) return;
  wp.nextAt = GT + SG_WATER_PRISON_GAP;
  var victims = sgEnemiesNearPlayer(ctx.getEnemies ? ctx.getEnemies() : [], wp.radius, null, 0);
  if (!victims.length) return;
  var dur = Math.max(0.2, wp.until - GT);
  for (var i = 0; i < victims.length; i++) {
    if (wp.atkRed > 0) sgApplySlot(victims[i], 'waterball', 'waterPrisonFall', 'enemy', 0, { val: wp.atkRed, dur: dur });
    if (wp.vuln > 0) sgApplySlot(victims[i], 'waterball', 'waterPrisonFall', 'enemy', 1, { val: wp.vuln, dur: dur });
  }
}

/* 水牢擋下由圈外射進來的遠程攻擊。
   掛點：js/combat.js fieldMonsterAttack——那是野外敵人「這一次攻擊成不成立」的唯一閘門。
   只擋圈外：近戰敵人得貼到近戰距離才打得到，那時候牠早就站在牢裡了，因此
   「距離大於牢的半徑」這一條同時就是「這是一次遠程攻擊」的判斷，不必另認敵種。
   沒有座標（高塔）＝不擋，與本系統其他幾何判定的退化規則一致。 */
function skill2WaterPrisonBlocks(ent) {
  var wp = SKILL2_RT && SKILL2_RT.waterPrison;
  if (!wp || wp.until <= GT || !(wp.radius > 0) || !ent) return false;
  if (typeof bfPos !== 'function' || !bfPos(ent) || typeof bfEntityDistance !== 'function') return false;
  return bfEntityDistance(ent) > wp.radius;
}

/* ---- 超神【怒海狂濤】：場上的水龍捲一達到門檻，就在它們的中央再生成一道巨大水龍捲 ----
   邊緣觸發（道數跌回門檻以下才重新武裝）：不這麼做的話，只要維持著門檻以上的道數，
   每一拍都會再生一道。巨大的那一道自己不算進門檻（kind 另外分開），否則會自我續命。 */
function sgTickRagingTide(ctx) {
  var u = sgUlt('waterball', 'ragingTide');
  if (!u || !skills2Equipped('waterball')) { SKILL2_RT.tideArmed = true; return; }
  var need = Math.max(1, Math.floor(Number(u.def.fx.need) || 10));
  var spots = [];
  for (var i = 0; i < SKILL2_RT.grounds.length; i++) {
    var f = SKILL2_RT.grounds[i];
    if (f && f.gid === 'waterball' && f.kind === 'tornado' && f.pos) spots.push(f.pos);
  }
  if (spots.length < need) { SKILL2_RT.tideArmed = true; return; }
  if (!SKILL2_RT.tideArmed) return;
  SKILL2_RT.tideArmed = false;
  var st = (typeof getStats === 'function') ? getStats() : null;
  if (!st) return;
  var g = SKILLS2.waterball;
  var dmgVal = sgGroupBaseStat(g, st) * sgUltVal(u, 'pct') / 100;
  if (!(dmgVal > 0)) return;
  // 「中央」＝那幾道水龍捲的重心；節拍沿用【水龍捲】的表定值（設計只給了段數）
  var cx = 0, cy = 0;
  for (var k = 0; k < spots.length; k++) { cx += spots[k].x; cy += spots[k].y; }
  var gap = Math.max(0.05, sgGeometryNumber(g.tiers[6].fx, 'gap') || 0.35);
  sgSpawnGround(ctx.pEnt, st, 'waterball', {
    kind: 'tidetornado', tgt: null, floatSel: ctx.floatSel,
    from: { x: cx / spots.length, y: cy / spots.length },
    radius: bfMeterPx(sgUltVal(u, 'm')), dmgVal: dmgVal,
    hits: Math.max(1, Math.floor(Number(u.def.fx.hits) || 1)), gap: gap,
    frozenMult: Math.max(1, Number(g.tiers[6].fx.frozen) || 2), tickAtStart: true,
    vfxUlt: 'ragingTide'
  });
}

/* ---- 超神【海淵葬界】：永久的水之領域 ----
   比照血刃斬的永久領域：**不建立場域實例**，每一拍直接以玩家為圓心做一次幾何查詢，
   領域的權威就是超神進化本身，卸下就自動消失，不需要任何清理程式碼。
   每一拍塗的是水流彈自己那一份寒霜（與施放端共用 sgFrostSpec，數值不會漂移）。 */
function sgTickAbyssDomain(ctx, dt) {
  var u = sgUlt('waterball', 'abyssBurial');
  if (!u || !skills2Equipped('waterball')) { SKILL2_RT.abyssAt = 0; sgEndDomainStatus('abyssDomain'); return; }
  var radius = bfMeterPx(sgUltVal(u, 'm'));
  // 水之領域是玩家身上的永久狀態：範圍的畫面是它的「持續特效」（依領域半徑縮放、逐幀跟著玩家）
  if (radius > 0) sgSyncDomainStatus(ctx.pEnt, 'abyssDomain', radius);
  // 死亡／倒地：節拍往後推，剩餘時間不變（見 skills2AutoCastBlocked）
  if (skills2AutoCastBlocked(ctx.pEnt)) {
    SKILL2_RT.abyssAt = sgPauseSchedule(SKILL2_RT.abyssAt, dt);
    return;
  }
  var gap = Math.max(0.05, sgGeometryNumber(u.def.fx, 'gap') || 0.35);
  if (!(SKILL2_RT.abyssAt > 0)) { SKILL2_RT.abyssAt = GT + gap; return; }
  if (GT < SKILL2_RT.abyssAt) return;
  SKILL2_RT.abyssAt = GT + gap;
  var lvs = skills2Levels('waterball');
  var st = (typeof getStats === 'function') ? getStats() : null;
  if (!lvs || lvs[0] < 1 || !st) return;
  var g = SKILLS2.waterball;
  var dmgVal = sgGroupBaseStat(g, st) * sgVal(g.tiers[0].fx, 'pct', lvs[0]) / 100;
  var spec = sgWaterballFrostSpec(sgFrostSpec(g, lvs, 2, dmgVal), sgLegendTick('waterball'));
  if (!spec) return;
  var victims = sgEnemiesNearPlayer(ctx.getEnemies ? ctx.getEnemies() : [], radius, null, 0);
  var frosted = [];
  for (var i = 0; i < victims.length; i++) {
    if (sgApplyFrost(victims[i], spec) > 0) frosted.push(victims[i]);
  }
  if (frosted.length) {
    // 領域每拍施加寒霜的畫面是超神【海淵葬界】這一列的受擊特效（寒霜本身每跳的畫面由狀態表負責）
    sgEmitVfx('waterball', frosted, ctx.floatSel, {
      fxKind: 'impact', variant: 'frost-tick', elem: 'ice',
      vfxUlt: 'abyssBurial'
    });
  }
}

/* 超神【海淵葬界】：領域內的敵人，寒霜可以額外再疊 N 層。
   不分是哪一棵樹塗的（設計寫的是「在領域內該敵人寒霜狀態可額外疊加 N 層」），
   因此掛在疊層上限的共用層而不是某一份寒霜規格上。
   ⚠️ 本支掛在 sgApplyFrost＝每一次塗寒霜都會走到（三個群組共用），因此先用一個
   便宜的存檔查詢擋掉絕大多數情況，不讓每一次塗寒霜都跑完整的超神生效判定。 */
function sgAbyssOverStacks(ent) {
  var raw = (typeof G !== 'undefined' && G && G.player && G.player.skills2) ? G.player.skills2.ult : null;
  if (!raw || !raw.waterball) return 0;
  var u = sgUlt('waterball', 'abyssBurial');
  if (!u || !skills2Equipped('waterball') || !ent) return 0;
  if (typeof bfPos === 'function' && bfPos(ent) && typeof bfEntityDistance === 'function' &&
      bfEntityDistance(ent) > bfMeterPx(sgUltVal(u, 'm'))) return 0;
  return Math.max(0, Math.floor(sgUltVal(u, 'stacks')));
}

/* ===========================================================================
   冰霜新星（frostnova）
   ---------------------------------------------------------------------------
   以自身為圓心的範圍爆發，是三棵樹裡唯一「不需要目標座標」的技能，因此高塔也能完整生效。
   第 2 階【冰霜衝擊】依文檔「範圍擴展至 13 米」＝改為（取代第 1 階的 12 米），
   但仍以 max 為地板，避免第 1 階練滿後投資第 2 階反而縮小範圍。
   第 5 階【三重新星】為多次施放，每次範圍再 +3 米（逐次累加，第 N 次＝基礎 + 3×N）。
   第 7 階【暴風雪】依文檔未寫「改為」＝追加：新星照常釋放，另外召喚一道跟隨我方的暴風雪。
   傳奇進化第十批（2026-08-28）的五個特效與三個超神全部收斂在三支共用函式上：
   本體傷害（sgFrostnovaBodyDamage）、範圍（sgFrostnovaBaseM × sgFrostnovaScale）
   與一次命中（sgFrostnovaHit）——施放、死亡新星、再爆發走的都是它們。
   =========================================================================== */
/* 冰霜新星的本體每次傷害：第 1 階 ＋【冰霜衝擊】的加算百分點，再乘上超神【無限新星】
   的獨立乘區（比照【極寒冰爆】的既有裁定：那是乘區，不是加算的百分點）。
   三條釋放路徑（施放／死亡新星／寒冰體的寒霜規格）共用這一支，否則會各自漂移。 */
function sgFrostnovaBodyDamage(g, st, lvs) {
  var t = g.tiers;
  var pct = sgVal(t[0].fx, 'pct', lvs[0]) + (lvs[1] > 0 ? sgVal(t[1].fx, 'pct', lvs[1]) : 0);
  var u = sgUlt('frostnova', 'infiniteNova');
  return sgGroupBaseStat(g, st) * pct / 100 * (u ? 1 + sgUltVal(u, 'pct') / 100 : 1);
}
/* 新星的基礎半徑（米）：第 1 階與【冰霜衝擊】取高。 */
function sgFrostnovaBaseM(g, lvs) {
  var m = sgGeometryNumber(g.tiers[0].fx, 'm') || 12;
  if (lvs[1] > 0) m = Math.max(m, sgVal(g.tiers[1].fx, 'm', lvs[1]));
  return m;
}
/* 傳奇【碎冰】：冰霜新星的攻擊範圍 +N%（乘在最終半徑上，因此【三重新星】
   逐次加大的那幾米一起被放大——設計文字說的是「冰霜新星的攻擊範圍」）。 */
function sgFrostnovaScale(lg) {
  return 1 + Math.max(0, Number(lg && lg.frostnovaScalePct) || 0) / 100;
}
/* 傳奇【雙冰爆】＋【寒潮】：兩個特效的敘述一字不差（只有機率不同），因此視為
   同一種效果的兩份機率，同時裝上時機率相加（比照同名參數鍵的既有合併規則）。 */
function sgFrostnovaEchoSpec(lg) {
  var a = Number(lg && lg.frostnovaTwinBurst && lg.frostnovaTwinBurst.chance) || 0;
  var b = Number(lg && lg.frostnovaColdTide && lg.frostnovaColdTide.chance) || 0;
  var chancePct = Math.max(0, a) + Math.max(0, b);
  return chancePct > 0 ? { chance: chancePct } : null;
}
/* 再爆發只發生一層：設計寫的是「再爆發 1 次冰霜新星」，沒有寫爆出來的那一次還會再爆，
   因此爆出來的新星命中帶寒霜的敵人時不再判定（也順便擋掉自我引爆的指數成長）。 */
var SG_FROSTNOVA_ECHO_MAX_DEPTH = 1;

function sgCastFrostnova(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var lg = sgLegend('frostnova');
  var dmgVal = sgFrostnovaBodyDamage(g, st, lvs);
  var baseM = sgFrostnovaBaseM(g, lvs);
  var scale = sgFrostnovaScale(lg);
  var frost = sgFrostSpec(g, lvs, 0, dmgVal);
  // 【三重新星】：施放次數額外 +N 次（不足 1 次的部分以機率觸發），且每次範圍再 +m 米
  var casts = 1 + (lvs[4] > 0 ? sgRollCount(sgVal(t[4].fx, 'add', lvs[4])) : 0);
  var stepM = lvs[4] > 0 ? sgGeometryNumber(t[4].fx, 'm') || 0 : 0;
  var opts = {
    echo: sgFrostnovaEchoSpec(lg),                        // 傳奇【雙冰爆】【寒潮】
    spike: sgIceSpikeSpec(g, st, lg.frostnovaKillSpike),  // 傳奇【寒冰衝擊】
    radiusPx: bfMeterPx(baseM) * scale, depth: 0
  };
  for (var i = 0; i < casts; i++) {
    sgFrostnovaBurst(pEnt, st, pool, floatSel, out, dmgVal, frost,
      bfMeterPx(baseM + stepM * i) * scale, i * SG_FROSTNOVA_VOLLEY_MS, opts);
  }
  // 【暴風雪】：追加一道跟隨我方的地板場域
  if (lvs[6] > 0) sgSpawnBlizzard(pEnt, st, g, lvs, floatSel, lg);
  // 【寒冰體】：冰霜新星 T3 只在施放後授予 6 秒的寒冰體狀態，受擊鉤子讀取該狀態判定窗口。
  if (lvs[2] > 0) sgApplySlot(pEnt, 'frostnova', '3', 'self', 0, null);
}

/* 一次新星爆發：以我方為圓心的圓形範圍，範圍內每個敵人吃一次本體傷害並附加寒霜。
   無座標時（高塔）退化為「打得到的所有敵人」——與本系統其他範圍查詢的退化規則一致。
   opts＝這一次施放的傳奇附加規格（再爆發／冰錐／再爆發的遞迴深度），可省略。 */
function sgFrostnovaBurst(pEnt, st, pool, floatSel, out, dmgVal, frost, radiusPx, delayMs, opts) {
  var victims = sgEnemiesNearPlayer(pool, radiusPx, null, 0);
  var p = (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null;
  sgEmitVfx('frostnova', victims, floatSel, {
    fxKind: 'burst', variant: 'frost-nova', elem: 'ice', delayMs: delayMs,
    area: p ? { x: p.x, y: p.y, r: radiusPx } : null
  });
  if (!victims.length) return;
  for (var i = 0; i < victims.length; i++) {
    sgFrostnovaHit(pEnt, st, victims[i], dmgVal, frost, floatSel, out,
      delayMs + sgStaggerMs(i), opts, pool);
  }
}

/* 新星命中一個敵人：本體傷害 → 寒霜 → 傳奇的兩個後續（再爆發／冰錐）。
   兩個傳奇的判定都用**命中前**的狀態：本次自己塗上的寒霜會讓【雙冰爆】每一擊必中，
   而凍結標記在死亡後仍留在實體上，所以擊殺的那一刻要看的也是打之前的凍結狀態。 */
function sgFrostnovaHit(pEnt, st, target, dmgVal, frost, floatSel, out, delayMs, opts, pool) {
  if (!target || target.hp <= 0) return null;
  var hadFrost = sgFrostOn(target);
  var wasFrozen = sgFrozenOn(target);
  var res = sgHitOne(pEnt, st, target, dmgVal, 'frostnova', floatSel, out, delayMs);
  if (!res || res.miss) return res;
  if (target.hp <= 0) {
    // 傳奇【寒冰衝擊】：新星殺死凍結中的敵人時，在屍體位置昇起一根冰錐
    if (opts && opts.spike && wasFrozen) {
      sgSpawnIceSpike(pEnt, st, 'frostnova', opts.spike, floatSel, target);
    }
    return res;
  }
  if (frost) sgApplyFrost(target, frost);
  // 傳奇【雙冰爆】【寒潮】：擊中命中前就帶著寒霜的敵人時，機率在牠身上再爆一次新星
  if (opts && opts.echo && hadFrost && (opts.depth || 0) < SG_FROSTNOVA_ECHO_MAX_DEPTH &&
      chance(opts.echo.chance)) {
    sgFrostnovaEcho(pEnt, st, target, dmgVal, frost, floatSel, out, delayMs, opts, pool);
  }
  return res;
}

/* 傳奇【雙冰爆】【寒潮】的再爆發：圓心是**被命中的那個敵人**（設計寫的是「在目標處」），
   不是我方，因此不能沿用以玩家為圓心的 sgFrostnovaBurst。半徑取新星的基礎半徑
  （不含【三重新星】逐次加大的那幾米——那是「第幾次施放」的性質，再爆發不是一次施放）。 */
function sgFrostnovaEcho(pEnt, st, center, dmgVal, frost, floatSel, out, delayMs, opts, pool) {
  var radiusPx = opts.radiusPx;
  var victims = (center.hp > 0) ? [center] : [];
  victims = victims.concat(sgEnemiesAround(center, pool, radiusPx));
  sgEmitVfx('frostnova', victims.length ? victims : [center], floatSel, {
    fxKind: 'burst', variant: 'frost-nova', elem: 'ice', delayMs: delayMs,
    area: sgAreaAround(center, radiusPx), preserveDeadTargets: true
  });
  var next = { echo: opts.echo, spike: opts.spike, radiusPx: radiusPx, depth: (opts.depth || 0) + 1 };
  for (var i = 0; i < victims.length; i++) {
    sgFrostnovaHit(pEnt, st, victims[i], dmgVal, frost, floatSel, out,
      delayMs + sgStaggerMs(i), next, pool);
  }
}

/* ---- 冰錐：從地面昇起、對周圍造成連續數段寒冰傷害的柱狀場域 ----
   兩個來源共用同一支（傳奇【寒冰衝擊】的擊殺昇起、超神【冰皇領域】的暴風雪內昇起），
   走既有的地板場域；顯示層沿用水龍捲的柱狀畫法（同樣是「立在地上的柱子」，
   elem ice 本來就是冰霧配色），不自創兩個渲染器都不認得的變體。 */
var SG_ICE_SPIKE_GAP = 0.35;   // 冰錐每一段的間隔（秒）：設計文檔只給段數，沒有給節拍
function sgIceSpikeSpec(g, st, src) {
  if (!src || !st) return null;
  var dmgVal = sgGroupBaseStat(g, st) * (Number(src.pct) || 0) / 100;
  if (!(dmgVal > 0)) return null;
  return {
    dmgVal: dmgVal,
    hits: Math.max(1, Math.floor(Number(src.hits) || 1)),
    radius: bfMeterPx(sgGeometryNumber(src, 'm') || 8)
  };
}
function sgSpawnIceSpike(pEnt, st, gid, spec, floatSel, tgt, from) {
  if (!spec || !SKILL2_RT || SKILL2_RT.grounds.length >= SG_GROUND_MAX_FIELDS) return;
  sgSpawnGround(pEnt, st, gid, {
    kind: 'icespike', tgt: tgt || null, from: from || null, floatSel: floatSel,
    radius: spec.radius, dmgVal: spec.dmgVal, hits: spec.hits, gap: SG_ICE_SPIKE_GAP,
    tickAtStart: true,
    vfxUlt: 'iceKingDomain'
  });
}

/* 【暴風雪】（冰霜新星 T7）：跟隨我方的正方形地板場域（follow＝圓心恆等於玩家當下座標）。
   超神【冰皇領域】把邊長放大；傳奇【凜冬寒霜】讓它每一拍順便塗寒霜——
   塗的是這棵樹自己那一份寒霜規格（與施放端共用 sgFrostSpec，數值不會漂移）。 */
function sgSpawnBlizzard(pEnt, st, g, lvs, floatSel, lg) {
  var fx = g.tiers[6].fx;
  var u = sgUlt('frostnova', 'iceKingDomain');
  var side = bfMeterPx(sgGeometryNumber(fx, 'side') || 20) * (u ? 1 + sgUltVal(u, 'scale') / 100 : 1);
  var gap = Math.max(0.05, sgGeometryNumber(fx, 'gap') || 0.4);
  var lifeSec = Math.max(0.5, Number(fx.sec) || 8);
  sgSpawnGround(pEnt, st, 'frostnova', {
    kind: 'blizzard', tgt: null, floatSel: floatSel,
    from: (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null,
    length: side, width: side * (sgGeometryNumber(fx, 'sideWidth') || sgGeometryNumber(fx, 'side') || 20) / (sgGeometryNumber(fx, 'side') || 20),
    dmgVal: sgGroupBaseStat(g, st) * sgVal(fx, 'pct', lvs[6]) / 100,
    hits: Math.max(1, Math.round(lifeSec / gap)), gap: gap, follow: true,
    frostSpec: (lg && lg.frostnovaBlizzardFrost)
      ? sgFrostSpec(g, lvs, 0, sgFrostnovaBodyDamage(g, st, lvs)) : null,
    vfxTier: 7
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
  var lg = sgLegendTick('frostnova');
  var dmgVal = sgFrostnovaBodyDamage(g, st, lvs);
  var radiusPx = bfMeterPx(sgFrostnovaBaseM(g, lvs)) * sgFrostnovaScale(lg);
  var out = { killed: false, dmg: 0, crit: false };
  sgFrostnovaBurst(pEnt, st, enemies || [], 'mv-float', out, dmgVal,
    sgFrostSpec(g, lvs, 0, dmgVal), radiusPx, 0, {
      echo: sgFrostnovaEchoSpec(lg), spike: sgIceSpikeSpec(g, st, lg.frostnovaKillSpike),
      radiusPx: radiusPx, depth: 0
    });
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
  var spec = sgFrostSpec(g, lvs, 0, sgFrostnovaBodyDamage(g, st, lvs));
  if (!spec) return;
  if (sgApplyFrost(mEnt, spec, sgVal(t[2].fx, 'stacks', lvs[2])) > 0) {
    sgEmitVfx('frostnova', [mEnt], floatSel || 'mv-float', {
      fxKind: 'impact', variant: 'frost-body', elem: 'ice',
      vfxTier: 3
    });
  }
}

/* ---- 超神【極致之冰】：凍結中的敵人之間的冰晶共鳴 ----
   只要冰霜新星裝配在技能列上就永久運轉（比照【雷霆天劫】的永久節拍）。
   每一拍：每個凍結中的敵人，被距離內的其他凍結敵人各共鳴一次。
   每個受害者一拍最多吃 SG_ICE_RESONANCE_MAX_LINKS 份——凍住的敵人擠成一團時
   配對數是平方成長，這是防呆上限，不是設計數值。 */
var SG_ICE_RESONANCE_MAX_LINKS = 4;
function sgTickCrystalResonance(ctx, dt) {
  var u = sgUlt('frostnova', 'crystalResonance');
  if (!u || !skills2Equipped('frostnova')) { SKILL2_RT.resonanceAt = 0; return; }
  // 死亡／倒地：節拍往後推，剩餘時間不變（見 skills2AutoCastBlocked）
  if (skills2AutoCastBlocked(ctx.pEnt)) {
    SKILL2_RT.resonanceAt = sgPauseSchedule(SKILL2_RT.resonanceAt, dt);
    return;
  }
  var gap = Math.max(0.05, sgGeometryNumber(u.def.fx, 'gap') || 0.4);
  if (!(SKILL2_RT.resonanceAt > 0)) { SKILL2_RT.resonanceAt = GT + gap; return; }
  if (GT < SKILL2_RT.resonanceAt) return;
  SKILL2_RT.resonanceAt = GT + gap;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  var live = (typeof bfLiveList === 'function') ? bfLiveList(enemies) : (enemies || []);
  var frozen = [];
  for (var i = 0; i < live.length; i++) {
    if (live[i] && live[i].hp > 0 && sgFrozenOn(live[i])) frozen.push(live[i]);
  }
  if (frozen.length < 2) return;
  var st = (typeof getStats === 'function') ? getStats() : null;
  if (!st) return;
  var dmgVal = sgGroupBaseStat(SKILLS2.frostnova, st) * sgUltVal(u, 'pct') / 100;
  if (!(dmgVal > 0)) return;
  var radius = bfMeterPx(sgUltVal(u, 'm'));
  var out = { killed: false, dmg: 0, crit: false };
  var resonators = [];
  for (var v = 0; v < frozen.length; v++) {
    var victim = frozen[v];
    if (victim.hp <= 0) continue;
    /* 共鳴來源＝距離內**其他**的凍結敵人。bfTargetsAround 以受害者為圓心，
       候選清單只放凍結中的敵人，因此回傳裡除了自己以外都是有效來源。 */
    var near = (typeof bfTargetsAround === 'function') ? bfTargetsAround(victim, frozen, radius) : [];
    var links = Math.min(SG_ICE_RESONANCE_MAX_LINKS, Math.max(0, near.length - 1));
    if (links <= 0) continue;
    resonators.push(victim);
    for (var k = 0; k < links && victim.hp > 0; k++) {
      sgHitOne(ctx.pEnt, st, victim, dmgVal, 'frostnova', ctx.floatSel, out, sgStaggerMs(k));
    }
  }
  /* 同一拍參與共鳴的敵人合併成一則特效事件送出（比照寒霜節拍器的既有做法），
     否則事件量會被放大成凍結中的敵人數。 */
  if (resonators.length) {
    sgEmitVfx('frostnova', resonators, ctx.floatSel, {
      fxKind: 'chain', variant: 'frost-spread', elem: 'ice', travelMs: [80],
      vfxUlt: 'crystalResonance'
    });
  }
  if (ctx.onDamage && out.dmg > 0) ctx.onDamage(out.dmg);
  if (out.killed && ctx.onDeaths) ctx.onDeaths();
}

/* ---- 超神【無限新星】：每 gap 秒自動施放 1 次冰霜新星 ----
   走 castSkill2 的 opts.repeat（不扣法力、不進冷卻）而不是【天霸風神斬】那條付費路徑：
   節拍比冷卻短一個數量級，付費路徑等於每一拍扣一次施法法力，而且冷卻會被永遠重設。
   其餘規則比照既有的自動施放：沒裝配在技能列不生效、暈眩中跳過該次且不補發、
   死亡／倒地時節拍往後推。 */
function sgTickInfiniteNova(ctx, dt) {
  var u = sgUlt('frostnova', 'infiniteNova');
  if (!u || !skills2Equipped('frostnova')) { SKILL2_RT.infiniteNovaAt = 0; return; }
  if (skills2AutoCastBlocked(ctx.pEnt)) {
    SKILL2_RT.infiniteNovaAt = sgPauseSchedule(SKILL2_RT.infiniteNovaAt, dt);
    return;
  }
  var gap = Math.max(0.1, sgUltVal(u, 'gap'));
  if (!(SKILL2_RT.infiniteNovaAt > 0)) { SKILL2_RT.infiniteNovaAt = GT + gap; return; }
  if (GT < SKILL2_RT.infiniteNovaAt) return;
  SKILL2_RT.infiniteNovaAt = GT + gap;
  if (typeof effectActive === 'function' && effectActive(ctx.pEnt, 'stun')) return;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  var res = castSkill2(ctx.pEnt, enemies, 'frostnova', ctx.floatSel, { repeat: true });
  if (!res) return;
  if (ctx.onDamage) ctx.onDamage(res.dmg);
  if (res.killed && ctx.onDeaths) ctx.onDeaths();
}

/* ---- 超神【冰皇領域】：暴風雪範圍內每 gap 秒昇起一批冰錐 ----
   節拍與暴風雪自己的節拍（每 0.4 秒一段傷害）是兩回事，因此不掛在場域的節拍上，
   改成獨立的一支：場上有幾道暴風雪就各自昇起一批。範圍取暴風雪自己的判定矩形
  （與它的傷害幾何同一支 sgGroundVictims），不會出現「畫面在裡面、判定在外面」。 */
function sgTickIceKing(ctx, dt) {
  var u = sgUlt('frostnova', 'iceKingDomain');
  if (!u || !skills2Equipped('frostnova')) { SKILL2_RT.iceKingAt = 0; return; }
  if (skills2AutoCastBlocked(ctx.pEnt)) {
    SKILL2_RT.iceKingAt = sgPauseSchedule(SKILL2_RT.iceKingAt, dt);
    return;
  }
  var gap = Math.max(0.1, sgGeometryNumber(u.def.fx, 'gap') || 1);
  if (!(SKILL2_RT.iceKingAt > 0)) { SKILL2_RT.iceKingAt = GT + gap; return; }
  if (GT < SKILL2_RT.iceKingAt) return;
  SKILL2_RT.iceKingAt = GT + gap;
  var fields = [];
  for (var i = 0; i < SKILL2_RT.grounds.length; i++) {
    var f = SKILL2_RT.grounds[i];
    if (f && f.gid === 'frostnova' && f.kind === 'blizzard') fields.push(f);
  }
  if (!fields.length) return;
  var st = (typeof getStats === 'function') ? getStats() : null;
  var spec = sgIceSpikeSpec(SKILLS2.frostnova, st, {
    pct: sgUltVal(u, 'pct'), hits: u.def.fx.hits, m: sgUltVal(u, 'm')
  });
  if (!spec) return;
  var lo = Math.max(1, Math.floor(Number(u.def.fx.min) || 1));
  var hi = Math.max(lo, Math.floor(Number(u.def.fx.max) || lo));
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  for (var fi = 0; fi < fields.length; fi++) {
    var victims = sgGroundVictims(fields[fi], enemies);
    if (!victims.length) continue;
    // 「隨機目標之地面」＝範圍內隨機挑目標，目標不足時可重複挑（同一個腳下昇起多根）
    var n = lo + Math.floor(Math.random() * (hi - lo + 1));
    for (var k = 0; k < n; k++) {
      sgSpawnIceSpike(ctx.pEnt, st, 'frostnova', spec, ctx.floatSel,
        victims[Math.floor(Math.random() * victims.length)]);
    }
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
var SG_VOID_DISC_SEQ = 0;       // 虛空斬給顯示層辨識同一道圓盤的序號（純顯示，不入存檔）

/* ---- 傳奇進化第十一批（2026-08-28）的兩個共用掛點 ----
   1) sgRampPct／sgWindbladeRamp：「每命中 1 次就再強一點」的累加器。
      一道風刃各持有一個，命中**後**才累加，因此加成套在後續的命中上——
      與連鎖閃電【超導】的「每彈射 1 次傷害 +10%」同一種語意。
      飛行物走 bonusPctFn、地板場域走 f.ramp，兩條路讀的都是這一支。
   2) sgWindErodeSpec／sgApplyWindErode：傳奇【風蝕】。效果值是「受到的傷害提高%」，
      因此走 skill2VulnACfg 的同一個 totalDmgPct，不另建一條增傷路徑。 */
function sgRampPct(ramp) {
  if (!ramp) return 0;
  return Math.min(Math.max(0, ramp.max || 0), Math.max(0, ramp.per || 0) * Math.max(0, ramp.n || 0));
}
function sgWindbladeRamp(lg) {
  var spec = lg && lg.windbladeRamp;
  if (!spec) return null;
  var per = Math.max(0, Number(spec.pct) || 0);
  var max = Math.max(0, Number(spec.max) || 0);
  return (per > 0 && max > 0) ? { per: per, max: max, n: 0 } : null;
}
function sgWindErodeSpec(lg) {
  var spec = lg && lg.windbladeErode;
  var pct = spec ? Math.max(0, Number(spec.pct) || 0) : 0;
  return pct > 0 ? { pct: pct, sec: Math.max(0.5, Number(spec.sec) || 4) } : null;
}
function sgApplyWindErode(ent, spec) {
  if (!ent || ent.hp <= 0 || !spec || typeof applyStatus !== 'function') return;
  applyStatus(ent, 'sgWindErode', { val: spec.pct, dur: spec.sec });
}
/* 一道風刃的命中後掛鉤。兩條路的簽章不同，因此拆成兩支薄包裝：
   飛行物那條由掛鉤自己累加（飛行物沒有 ramp 欄位），
   地板場域那條的累加由場域自己做（bonusPct 要在命中前讀得到），掛鉤只塗風蝕。
   ⚠️ 兩條都要接：投資到第 5 階（小型風刃改為追擊）或選了【暴風萬刃】之後，
   風刃的主要形態就是場域，只接飛行物的話那兩個傳奇會安靜地失效。 */
/* 第 6 階【狂風碎裂】的命中緩速：施加哪一個狀態由 Skills2 第 6 階「敵方狀態」第一格決定，
   飛行物與追擊場域兩條路共用同一個位置。 */
var SG_WINDBLADE_SLOW_SLOT = { gid: 'windblade', tier: '6' };
function sgWindbladeProjectileHit(ramp, erode) {
  if (!ramp && !erode) return null;
  return function (target) {
    if (ramp) ramp.n++;
    if (erode) sgApplyWindErode(target, erode);
  };
}
function sgWindbladeGroundHit(erode) {
  if (!erode) return null;
  return function (f, victim) { sgApplyWindErode(victim, erode); };
}

/* ---- 風切狀態：表定值 ----
   塗哪兩個狀態（層數與緩速／割裂）由 Skills2「敵方狀態」決定：真空斬第 3 階與暴風屏障第 3 階各有一組
   （slot＝{ gid, tier }）；層數與割裂的查詢一律走角色 windRend／windCut，兩棵樹塗的風切因此共用。 */
var SG_WIND_IDX = { windRend: 0, windCut: 1 };
var SG_WIND_DEFAULT_SLOT = { gid: 'vacuumslash', tier: '3' };
function sgWindSlotSid(slot, role) {
  var s = slot || SG_WIND_DEFAULT_SLOT;
  return sgSlotSid(s.gid, s.tier, 'enemy', SG_WIND_IDX[role]);
}
function sgWindRendGap(slot) { return Math.max(0.1, sgStatusNum(sgWindSlotSid(slot, 'windCut'), 'interval', 0.5)); }
function sgWindRendDur(slot) { return Math.max(0.5, sgStatusNum(sgWindSlotSid(slot, 'windCut'), 'dur', 4)); }
/* 移速下降%：刻意讀狀態表的單層值而不是 buffVal——buffVal 對疊層狀態回傳的是
   「單層值 × 層數」，而設計文檔的疊層只加傷害，不會讓緩速跟著疊到 240%。 */
function sgWindRendMovePct() { return Math.max(0, sgStatusNum('sgWindRend', 'val', 80)); }
/* 命中下降%：狀態表只有一個 val 欄（已用於移速），故第二個數字放在技能表的 fx.hit。 */
function sgWindRendHitPct() { return Math.max(0, Number(SKILLS2.vacuumslash.tiers[2].fx.hit) || 0); }
/* 目前允許的層數上限：【無限風切】開放前恆為 1 層，傳奇【裂痕】再往上加。
   狀態表的 maxStacks 只是天花板（applyStatus 認的就是它），實際允許幾層由這裡決定。
   ⚠️【裂痕】不以第 6 階已學為前提（比照【電擊】的既有裁定），因此沒有【無限風切】時
   上限是 1＋3 層。多出來的層數在那個情況下不會變成傷害——每層的額外每跳量由
   【無限風切】提供，沒學就是 0（見 sgWindRendSpec 的 extraPct）。 */
function sgWindRendMaxStacks() {
  var lvs = skills2Levels('vacuumslash');
  if (!lvs) return 1;
  var add = sgLegendCount(sgLegendTick('vacuumslash').vacuumRendStacks, 'maxStacks');
  var tier = (lvs[5] >= 1)
    ? Math.floor(sgVal(SKILLS2.vacuumslash.tiers[5].fx, 'stacks', lvs[5])) : 1;
  return Math.max(1, Math.min(Math.floor(sgStatusNum(sgRoleSid('windRend') || 'sgWindRend', 'maxStacks', 6)), tier + add));
}

/* 某個群組現在塗出來的風切規格（施放當下定版）。
   per＝1 層時的每秒傷害；extra＝每多 1 層再加的每秒傷害（【無限風切】）。
   tierIdx＝該群組負責附加風切的那一階；該階沒有 cutPct（暴風屏障【亂風切】）時
   採狀態表的預設每跳% ——設計文檔在那一階只寫「附加風切狀態」，沒有另給數值。 */
function sgWindRendSpec(g, lvs, tierIdx, bodyDmg) {
  if (!lvs || lvs[tierIdx] < 1 || !(bodyDmg > 0)) return null;
  var fx = g.tiers[tierIdx].fx;
  var slot = { gid: sgGroupIdOf(g), tier: String(tierIdx + 1) };
  var pct = (fx.cutPct === undefined)
    ? Math.max(0, sgStatusNum(sgWindSlotSid(slot, 'windCut'), 'dmg', 50))
    : sgVal(fx, 'cutPct', lvs[tierIdx]);
  if (!(pct > 0)) return null;
  var gap = sgWindRendGap(slot);
  var vs = skills2Levels('vacuumslash');
  var extraPct = (vs && vs[0] > 0 && vs[5] > 0)
    ? sgVal(SKILLS2.vacuumslash.tiers[5].fx, 'pct', vs[5]) : 0;
  /* 傳奇【逆風切】：只放大**暴風屏障【亂風切】**塗出來的那一份（設計文檔明寫是那一階），
     真空斬自己塗的那一份不受影響。每層都放大，因此連同【無限風切】的額外每跳量一起乘。 */
  var cutMult = (g === SKILLS2.stormbarrier)
    ? 1 + Math.max(0, Number(sgLegendTick('stormbarrier').stormRendDmgPct) || 0) / 100 : 1;
  return {
    per: bodyDmg * pct / 100 / gap * cutMult,
    extra: bodyDmg * extraPct / 100 / gap * cutMult,
    dur: sgWindRendDur(slot), interval: gap, slot: slot
  };
}

/* 目前的風切層數（權威在疊層狀態的 stacks 欄，由 combat.js stackStep 維護；以角色加總）。 */
function sgWindRendStacks(ent) {
  if (!ent || !ent.buffs) return 0;
  var keys = sgRoleKeys('windRend'), n = 0;
  for (var i = 0; i < keys.length; i++) {
    var b = ent.buffs[keys[i]];
    if (b && b.until > GT) n += Math.max(0, Math.floor(b.stacks || 1));
  }
  return n;
}
function sgWindRendOn(ent) { return sgWindRendStacks(ent) > 0 || sgHasDot(ent, sgRoleSids('windCut')); }

/* 狀態表的 maxStacks 是「這個狀態最多能到幾層」，當下允許幾層則由技能階數決定；
   applyStatus 只認得表上的上限，因此塗完之後在這裡把超出的層數收回
   （val 恆等於單層值 × 層數，兩者必須一起修正）。 */
function sgClampWindRendStacks(ent) {
  var keys = sgRoleKeys('windRend');
  var max = sgWindRendMaxStacks();
  for (var i = 0; i < keys.length; i++) {
    var b = ent && ent.buffs && ent.buffs[keys[i]];
    if (!b || !(b.until > GT) || !(b.stacks > max)) continue;
    b.stacks = max;
    b.val = (Number(b.unit) || sgWindRendMovePct()) * max;
  }
}

/* 塗上風切。回傳實際增加的層數（0＝只有重新計時、沒有加層）。
   每次都會重新計時（設計文檔 buff 規則的「重上」），持續傷害則依塗完後的層數重算。 */
function sgApplyWindRend(ent, spec, stacksOverride) {
  if (!ent || ent.hp <= 0 || !spec) return 0;
  var slot = spec.slot || SG_WIND_DEFAULT_SLOT;
  var cellStacks = sgSlotParam(slot.gid, slot.tier, 'enemy', SG_WIND_IDX.windRend, 'stacks');
  var want = Math.max(1, sgRollCount((stacksOverride !== undefined && stacksOverride !== null) ? stacksOverride
    : (cellStacks !== undefined ? cellStacks : 1)));
  var before = sgWindRendStacks(ent);
  // 單層緩速不帶值：吃該格狀態的狀態表「效果數值」
  for (var i = 0; i < want; i++) {
    sgApplySlot(ent, slot.gid, slot.tier, 'enemy', SG_WIND_IDX.windRend, { dur: spec.dur, oneStack: true });
    sgClampWindRendStacks(ent);
  }
  var stacks = Math.max(1, sgWindRendStacks(ent));
  var dps = spec.per + Math.max(0, stacks - 1) * (spec.extra || 0);
  if (dps > 0) sgApplySlot(ent, slot.gid, slot.tier, 'enemy', SG_WIND_IDX.windCut, { dps: dps, dur: spec.dur, interval: spec.interval });
  /* 【風切擴散】要在風切**結束後**才複製這一份規格，但那時狀態實例已經不在了；
     故把當下這份快照掛在敵人實體上（純 JSON、隨實體自然回收，比照 _sgDotSkipAt）。 */
  ent._sgWindRendSpec = { per: spec.per, extra: spec.extra, dur: spec.dur, interval: spec.interval, slot: slot };
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
  /* 超神【瓦爾格之力】的「風系傷害 +50%」是**獨立乘區**（比照【極寒冰爆】的既有裁定），
     與第 7 階自己的乘區相乘，不與它的百分點相加。 */
  var valgr = sgUlt('stormbarrier', 'valgrForce');
  var mult = (pct > 0 ? 1 + pct / 100 : 1) * (valgr ? 1 + sgUltVal(valgr, 'pct') / 100 : 1);
  if (!(mult > 1)) return aCfg;
  var amp = {};
  for (var k in (aCfg.skillElemAmp || {})) amp[k] = aCfg.skillElemAmp[k];
  amp.wind = (amp.wind || 1) * mult;
  aCfg.skillElemAmp = amp;
  return aCfg;
}

/* 傳奇【風之壁】：暴風屏障作用中，我方物理與魔法防禦的額外乘算倍率（1＝沒生效）。
   掛在 js/combat.js playerDefCfg 的 defMul——那是我方防禦的唯一出口，野外與高塔一體生效。
   ⚠️ 刻意不走既有的 defUp 增益：那一格是「取代」規則的共用鍵（舊技能【鐵壁】也在用），
   每 0.5 秒重塗一次會把玩家的鐵壁數值蓋成屏障這一份。 */
function skill2DefFactor(pEnt) {
  if (!skill2BarrierLevels(pEnt)) return 1;
  var pct = Math.max(0, Number(sgLegendTick('stormbarrier').stormbarrierDefPct) || 0);
  return pct > 0 ? 1 + pct / 100 : 1;
}

/* ===========================================================================
   風刃（windblade）
   ---------------------------------------------------------------------------
   本體是一道貫穿全場的飛行風刃（射程只管「能不能起手」，飛行距離 80 米＝飛出戰鬥區）。
   體積來自群組 range（4*8 米）並被【巨型風刃】整體放大：判定半寬與特效寬度同一個來源。
   方向樹：第 3 階加後方一道；第 7 階改為前後左右四方向、每個方向連續三道（間隔 0.2 秒）。
   小型風刃（第 4 階）預設跟著主風刃射出；第 5 階起改為在場上隨機追擊（追擊場域，接觸判定）。
   =========================================================================== */
function sgWindbladeGeom(g, lvs, lg) {
  var t = g.tiers;
  var body = sgRange(g.range, lvs[0]);                                   // 4*8 米（長*寬）
  /* 傳奇【增壓】：體積與飛行速度各自乘算（體積與第 2 階【巨型風刃】相乘，
     兩者都是「體積 +N%」；判定半寬與特效寬度仍只有 geom 這一個來源）。 */
  var sizePct = Math.max(0, Number(lg && lg.windbladeSizePct) || 0);
  var speedPct = Math.max(0, Number(lg && lg.windbladeSpeedPct) || 0);
  var scale = (lvs[1] > 0 ? 1 + sgVal(t[1].fx, 'size', lvs[1]) / 100 : 1) * (1 + sizePct / 100);
  return {
    scale: scale,
    lenPx: bfMeterPx(Math.max(1, sgGeometryNumber(t[0].fx, 'm') || 80)),      // 飛行距離
    speedPx: bfMeterPx(Math.max(1, sgGeometryNumber(t[0].fx, 'speed') || 18) * (1 + speedPct / 100)),
    bodyLenPx: bfMeterPx((body.length || 4) * scale),
    halfWidthPx: bfMeterPx((body.width || 8) * scale) / 2,
    smallLenPx: bfMeterPx((sgGeometryNumber(t[3].fx, 'lenM') || 3) * scale),
    smallHalfPx: bfMeterPx((sgGeometryNumber(t[3].fx, 'widthM') || 6) * scale) / 2
  };
}

/* 射出一道風刃：傷害、幾何與特效走同一組參數，因此模擬層與顯示層不會走鐘。
   small＝小型風刃（體積較小、傷害為原風刃的一部分、不帶狂風碎裂的效果）。 */
function sgLaunchWindBlade(pEnt, st, gid, cfg, floatSel, out) {
  var geom = cfg.geom;
  /* sizeMult＝超神【嵐之山】融合出來的巨型風刃倍率（1＝原本的體積）。 */
  var sizeMult = Math.max(0.1, Number(cfg.sizeMult) || 1);
  var halfPx = (cfg.small ? geom.smallHalfPx : geom.halfWidthPx) * sizeMult;
  var bodyPx = (cfg.small ? geom.smallLenPx : geom.bodyLenPx) * sizeMult;
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
    angle: cfg.angle, bodyLength: bodyPx,
    vfxTier: cfg.vfxTier || (cfg.small ? 4 : 1), vfxGid: cfg.vfxGid || '', vfxUlt: cfg.vfxUlt || ''
  });
  sgQueueFlyingProjectile(pEnt, st, gid, cfg.dmgVal, geomOk ? origin : null, cfg.angle,
    geom.lenPx, floatSel, cfg.fallback || [], {
      halfWidthPx: halfPx, speed: geom.speedPx, beginSec: cfg.beginSec || 0,
      slowSlot: cfg.slowPct > 0 ? SG_WINDBLADE_SLOW_SLOT : null, slowPct: cfg.slowPct || 0,
      pulseGap: cfg.pulseGap || 0, pulseRadius: cfg.pulseRadius || 0,
      pulseDmg: cfg.pulseDmg || 0, pulseVariant: 'wind-burst',
      /* 傳奇【裂風】的加成在命中前讀、【風蝕】與累加在命中後做。 */
      bonusPctFn: cfg.ramp ? function () { return sgRampPct(cfg.ramp); } : null,
      onHit: cfg.onHit || null
    }, out);
}

/* 【追跡風刃】：小型風刃改為在場上隨機追擊（追擊場域＋接觸判定，與追蹤冰箭同一套）。
   超神【暴風萬刃】把大型風刃也送進這一支（opts 覆寫體積、壽命與追擊半徑，
   並帶上第 6 階【狂風碎裂】的緩速與沿途脈衝）——兩種風刃的追擊行為因此只有一份實作。 */
function sgSpawnWindChaser(pEnt, st, g, lvs, angle, dmgVal, geom, floatSel, opts) {
  opts = opts || {};
  var fx = g.tiers[4].fx;
  var lifeSec = Math.max(0.5, Number(opts.sec) > 0 ? Number(opts.sec) : sgVal(fx, 'sec', lvs[4]));
  var gap = Math.max(0.05, sgGeometryNumber(fx, 'gap') || 0.1);
  var from = (typeof bfPlayerPos === 'function') ? bfPlayerPos() : null;
  var chaseM = Math.max(1, sgGeometryNumber(opts, 'chaseM') > 0 ? sgGeometryNumber(opts, 'chaseM') : (sgGeometryNumber(fx, 'chaseM') || 30));
  var reach = bfMeterPx(chaseM);
  sgSpawnGround(pEnt, st, 'windblade', {
    kind: 'windblade', tgt: null, floatSel: floatSel, from: from,
    dest: from ? { x: from.x + Math.cos(angle) * reach, y: from.y + Math.sin(angle) * reach } : null,
    radius: Math.max(4, Number(opts.radius) > 0 ? Number(opts.radius) : geom.smallHalfPx),
    dmgVal: dmgVal, hits: Math.max(1, Math.round(lifeSec / gap)), gap: gap,
    speed: geom.speedPx, chaseM: chaseM, contact: true,
    ramp: opts.ramp || null, onHit: opts.onHit || null,
    slowSlot: (opts.slowPct > 0) ? SG_WINDBLADE_SLOW_SLOT : null, slowPct: opts.slowPct || 0,
    pulseGap: opts.pulseGap || 0, pulseRadius: opts.pulseRadius || 0,
    pulseDmg: opts.pulseDmg || 0, pulseVariant: 'wind-burst',
    vfxTier: 5, vfxUlt: (opts && opts.vfxUlt) || ''
  });
}

/* 風刃的本體傷害%：第 1 階 ＋【雙重風刃】＋【暴風真空刃】＋傳奇【斷空刃】——
   設計文檔對這幾個寫的都是「風刃傷害 +X%」＝**累加**（與階數同一個池子）。 */
function sgWindbladeDmgPct(g, lvs, lg) {
  var t = g.tiers;
  return sgVal(t[0].fx, 'pct', lvs[0])
    + (lvs[2] > 0 ? sgVal(t[2].fx, 'pct', lvs[2]) : 0)
    + (lvs[6] > 0 ? sgVal(t[6].fx, 'pct', lvs[6]) : 0)
    + Math.max(0, Number(lg && lg.windbladeDmgPct) || 0);
}

/* 風刃的本體傷害。兩個超神的傷害加成都是**獨立乘區**（比照【極寒冰爆】【無限新星】的
   既有裁定：階數本身已經累加到上千個百分點，超神那一份若也丟進同一個池子，
   實際增幅會只剩個位數%）：
     【暴風萬刃】：風刃傷害 +50%
     【天穹崩裂】：被動射出的那一道傷害 +50%——選了它之後，風刃退出主動輪替，
                  唯一的出手方式就是那一道，因此直接掛在本體傷害上就等同「那一道的加成」，
                  不必再為單一形態另闢一條乘區（也就不會有「哪條路忘了乘」的漏洞）
   施放、追擊與被動射出共用這一支。 */
function sgWindbladeBodyDamage(g, st, lvs, lg) {
  var myriad = sgUlt('windblade', 'stormMyriad');
  var collapse = sgUlt('windblade', 'skyCollapse');
  return sgGroupBaseStat(g, st) * sgWindbladeDmgPct(g, lvs, lg) / 100
    * (myriad ? 1 + sgUltVal(myriad, 'pct') / 100 : 1)
    * (collapse ? 1 + sgUltVal(collapse, 'pct') / 100 : 1);
}

/* 射出一道大型風刃。超神【暴風萬刃】把它改成全場追擊的場域，其餘情況照舊直線飛出；
   兩條路都帶著第 6 階【狂風碎裂】的緩速與沿途脈衝，以及傳奇【裂風】【風蝕】的掛鉤。 */
function sgFireWindBlade(pEnt, st, g, lvs, cfg, floatSel, out) {
  var ramp = sgWindbladeRamp(cfg.lg);
  if (cfg.myriad) {
    sgSpawnWindChaser(pEnt, st, g, lvs, cfg.angle, cfg.dmgVal, cfg.geom, floatSel, {
      sec: sgUltVal(cfg.myriad, 'sec'), chaseM: sgUltVal(cfg.myriad, 'chaseM'),
      radius: cfg.geom.halfWidthPx, ramp: ramp, onHit: sgWindbladeGroundHit(cfg.erode),
      slowPct: cfg.slowPct, pulseGap: cfg.pulseGap,
      pulseRadius: cfg.pulseRadius, pulseDmg: cfg.pulseDmg,
      vfxUlt: 'stormMyriad'
    });
    return;
  }
  sgLaunchWindBlade(pEnt, st, 'windblade', {
    geom: cfg.geom, angle: cfg.angle, dmgVal: cfg.dmgVal, pool: cfg.pool, geomOk: cfg.geomOk,
    fallback: [cfg.primary], beginSec: cfg.beginSec || 0, slowPct: cfg.slowPct,
    pulseGap: cfg.pulseGap, pulseRadius: cfg.pulseRadius, pulseDmg: cfg.pulseDmg,
    sizeMult: cfg.sizeMult, ramp: ramp, onHit: sgWindbladeProjectileHit(ramp, cfg.erode)
  }, floatSel, out);
}

function sgCastWindblade(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var lg = sgLegend('windblade');
  var myriad = sgUlt('windblade', 'stormMyriad');
  var mountain = sgUlt('windblade', 'stormMountain');
  var erode = sgWindErodeSpec(lg);                          // 傳奇【風蝕】
  var dmgVal = sgWindbladeBodyDamage(g, st, lvs, lg);
  var geom = sgWindbladeGeom(g, lvs, lg);
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
    volleys = Math.max(1, Math.floor(Number(t[6].fx.count) || 2));
    /* 傳奇【斷空刃】：每個方向「連續射出 3 道」＝改寫**至**（Math.max），
       不是再加 3 道——表定值日後調得更高時，這個特效不該反而變成降級。 */
    var voidCut = sgLegendCount(lg.windbladeVolleyTo, 'count');
    if (voidCut > volleys) volleys = voidCut;
    // 超神【暴風萬刃】：每個方向再多射出 N 道
    if (myriad) volleys += Math.max(0, Math.floor(sgUltVal(myriad, 'add')));
    volleyGap = Math.max(0, sgGeometryNumber(t[6].fx, 'gap') || 0.2);
  }

  // 【狂風碎裂】：命中的敵人移速下降，且風刃沿途每 gap 秒炸一次周圍（只有主風刃有）
  var slowPct = lvs[5] > 0 ? Math.max(0, Number(t[5].fx.move) || 0) : 0;
  var pulseGap = lvs[5] > 0 ? Math.max(0.05, sgVal(t[5].fx, 'gap', lvs[5])) : 0;
  var pulseRadius = lvs[5] > 0 ? bfMeterPx(sgGeometryNumber(t[5].fx, 'm') || 6) : 0;
  var pulseDmg = lvs[5] > 0 ? dmgVal * (Number(t[5].fx.pct) || 0) / 100 : 0;

  /* 【亂披風】：小型風刃朝主風刃一側 deg 度；傷害為原風刃的一部分。
     傳奇【風之痕】：另一側再補一道（sides），且小型風刃傷害獨立乘算。 */
  var smallDmg = lvs[3] > 0
    ? dmgVal * sgVal(t[3].fx, 'pct', lvs[3]) / 100
      * (1 + Math.max(0, Number(lg.windbladeSmallDmgPct) || 0) / 100)
    : 0;
  var smallDeg = (sgGeometryNumber(t[3].fx, 'deg') || 30) * Math.PI / 180;
  var sides = [1];
  if (sgLegendCount(lg.windbladeSmallMirror, 'count') > 0) sides.push(-1);
  var chase = lvs[4] > 0;   // 【追跡風刃】：小型風刃改為追擊

  /* 超神【嵐之山】：暴風真空刃改為「融合」——把該次每個方向本來要射出的所有
     大型與小型風刃的傷害加總成一道體積放大的巨型風刃。融合的是**同一個方向**那一疊，
     方向數仍由第 7 階決定（設計寫的四個方向與表定 directions 相同）。 */
  if (mountain && lvs[6] > 0) {
    var fused = (dmgVal + smallDmg * sides.length) * volleys * sgUltVal(mountain, 'pct') / 100;
    var sizeMult = 1 + Math.max(0, Number(mountain.def.fx.scale) || 0) / 100;
    for (var mi = 0; mi < dirs.length; mi++) {
      sgFireWindBlade(pEnt, st, g, lvs, {
        geom: geom, angle: dirs[mi], dmgVal: fused, pool: pool, geomOk: geomOk,
        primary: primary, slowPct: slowPct, pulseGap: pulseGap,
        pulseRadius: pulseRadius, pulseDmg: pulseDmg,
        sizeMult: sizeMult, lg: lg, erode: erode
      }, floatSel, out);
    }
    return;
  }

  for (var di = 0; di < dirs.length; di++) {
    for (var vi = 0; vi < volleys; vi++) {
      var beginSec = vi * volleyGap;
      sgFireWindBlade(pEnt, st, g, lvs, {
        geom: geom, angle: dirs[di], dmgVal: dmgVal, pool: pool, geomOk: geomOk,
        primary: primary, beginSec: beginSec, slowPct: slowPct,
        pulseGap: pulseGap, pulseRadius: pulseRadius, pulseDmg: pulseDmg,
        lg: lg, erode: erode, myriad: myriad
      }, floatSel, out);
      if (smallDmg <= 0) continue;
      for (var si = 0; si < sides.length; si++) {
        var ang = dirs[di] + smallDeg * sides[si];
        var smallRamp = sgWindbladeRamp(lg);
        if (chase) {
          sgSpawnWindChaser(pEnt, st, g, lvs, ang, smallDmg, geom, floatSel, {
            ramp: smallRamp, onHit: sgWindbladeGroundHit(erode)
          });
        } else {
          sgLaunchWindBlade(pEnt, st, 'windblade', {
            geom: geom, angle: ang, dmgVal: smallDmg, pool: pool, geomOk: geomOk,
            fallback: [primary], beginSec: beginSec, small: true,
            ramp: smallRamp, onHit: sgWindbladeProjectileHit(smallRamp, erode)
          }, floatSel, out);
        }
      }
    }
  }
}

/* 超神【天穹崩裂】：風刃改為被動技能——受到攻擊時機率朝攻擊者射出一道風刃。
   「一道風刃」＝**照玩家當下的風刃進化情況完整施放一次**（使用者決策 2026-08-28）：
   七階全滿就是七階的形態（四方向連射、小型追擊風刃、狂風碎裂的沿途脈衝都在），
   連帶吃到風刃自己的傳奇特效。因此走 castSkill2 的 opts.repeat（不扣法力、不進冷卻），
   而不是在這裡自己複製一份施放流程——複製的話，風刃日後每加一階或一個傳奇，
   這裡就會漏掉一個。傷害的 +50% 掛在 sgWindbladeBodyDamage（見那一支的說明）。
   與暴風屏障【暴風之刃】的差別：那一道固定取風刃第 1 階的 Lv.1 表定值，這一道是本尊。 */
function sgSkyCollapseOnPlayerDamaged(mEnt, pEnt, floatSel) {
  var u = sgUlt('windblade', 'skyCollapse');
  if (!u || !skills2Equipped('windblade') || !mEnt || mEnt.hp <= 0) return;
  if (!chance(sgUltVal(u, 'chance'))) return;
  var enemies = (typeof FIELD !== 'undefined' && FIELD && FIELD.enemies) ? FIELD.enemies : [mEnt];
  /* 「向**目標**發射」＝朝攻擊者：castSkill2 的主目標取 pEnt._lockTarget（bfPickPrimary），
     因此暫時把鎖定指向攻擊者、射完立刻還原，不影響玩家原本的追擊目標。
     傳進去的仍是完整敵群，貫穿路徑上的其他敵人照樣打得到。 */
  var prevLock = pEnt._lockTarget;
  pEnt._lockTarget = mEnt;
  castSkill2(pEnt, enemies, 'windblade', floatSel || 'mv-float', { repeat: true });
  pEnt._lockTarget = prevLock;
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
  var lg = sgLegend('vacuumslash');
  var omen = sgUlt('vacuumslash', 'vacuumOmen');
  var pct = sgVal(t[0].fx, 'pct', lvs[0]) + (lvs[3] > 0 ? sgVal(t[3].fx, 'pct', lvs[3]) : 0);
  var dmgVal = sgGroupBaseStat(g, st) * pct / 100;
  /* 【真空爆震】＋傳奇【共振】：額外造成 N 次傷害（不足 1 次的部分以機率觸發）。
     【共振】不以第 2 階已學為前提（比照【電擊】的既有裁定：多打一次是真空斬自己的行為）。 */
  var hits = 1 + (lvs[1] > 0 ? sgRollCount(sgVal(t[1].fx, 'hits', lvs[1])) : 0)
    + sgLegendCount(lg.vacuumBurstAdd, 'hits');
  var rend = sgWindRendSpec(g, lvs, 2, dmgVal);
  var baseAngle = (typeof bfAngleTo === 'function') ? bfAngleTo(primary) : null;
  var geomOk = (baseAngle !== null && baseAngle !== undefined);
  if (!geomOk) baseAngle = 0;

  var spin = lvs[3] > 0;                                   // 【迴旋斬】：改為自身周圍一整圈
  var baseM = spin ? (sgGeometryNumber(t[3].fx, 'm') || 6) : (sgGeometryNumber(t[0].fx, 'm') || 6);
  var waves = 1;
  var stepM = 0;
  if (spin && lvs[4] > 0) {                                // 【迴旋三重奏】
    waves += sgRollCount(sgVal(t[4].fx, 'add', lvs[4]));
    stepM = sgGeometryNumber(t[4].fx, 'm') || 6;
  }
  var count = Math.max(1, Math.floor(Number(t[0].fx.count) || 3));
  // 傳奇【空間澎脹】：真空斬的體積（＝判定半徑與特效尺寸的同一個來源）整體放大
  var scale = 1 + Math.max(0, Number(lg.vacuumScalePct) || 0) / 100;

  for (var w = 0; w < waves; w++) {
    var radiusPx = bfMeterPx(baseM + stepM * w) * scale;
    var delayMs = w * SG_VACUUM_WAVE_MS;
    var victims = sgVacuumWaveVictims(pool, primary, spin, radiusPx, count, baseAngle, geomOk);
    sgEmitVfx('vacuumslash', victims, floatSel, {
      fxKind: 'slash', variant: spin ? 'wind-spin' : 'wind-slash', elem: 'wind',
      dur: 0.45, delayMs: delayMs, lineLength: radiusPx, vfxTier: spin ? 4 : 1,
      area: (spin && geomOk && typeof bfPlayerPos === 'function')
        ? { x: bfPlayerPos().x, y: bfPlayerPos().y, r: radiusPx } : null
    });
    if (!spin && lvs[1] > 0) sgEmitVfx('vacuumslash', victims, floatSel, {
      fxKind: 'slash', variant: 'vacuum-shock', elem: 'wind', vfxTier: 2,
      angle: baseAngle, delayMs: delayMs, dur: 0.6, lineLength: radiusPx
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
      /* 超神【萬象風劫】：命中才判定，機率成立就在該敵人腳下留下一道靜止的真空斬。
         機率是**逐個受害者**判定的（設計寫的是「命中敵人時」）。 */
      if (landed && omen) sgSpawnStaticVacuum(pEnt, st, omen, victims[i], floatSel, dmgVal, radiusPx);
    }
  }

  // 傳奇【真空風刃】：每次施放額外射出 N 道小型風刃
  sgVacuumSmallBlades(pEnt, st, lg, dmgVal, pool, primary, baseAngle, geomOk, floatSel, out);
  if (lvs[6] > 0) sgSpawnVoidDiscs(pEnt, st, g, lvs, floatSel, baseAngle);
}

/* 傳奇【真空風刃】：每次施放真空斬額外射出 N 道小型風刃。
   體積與傷害比例借【風刃】第 4 階【亂披風】的 Lv.1 表定值（比照暴風屏障【暴風之刃】
   借用【風刃】第 1 階的既有裁定——沒有投資風刃的人一樣拿得到完整效果），
   但基準攻擊力與傷害紀錄都歸真空斬：它才是這幾道刃的來源。
   方向：以主目標方位為中軸、朝兩側依序張開（設計沒有指定方向）。 */
function sgVacuumSmallBlades(pEnt, st, lg, dmgVal, pool, primary, baseAngle, geomOk, floatSel, out) {
  var n = sgLegendCount(lg.vacuumSmallBlades, 'count');
  if (n <= 0 || !(dmgVal > 0)) return;
  var wb = SKILLS2.windblade;
  var wlvs = [1, 0, 0, 1, 0, 0, 0];
  var geom = sgWindbladeGeom(wb, wlvs, null);
  var small = dmgVal * sgVal(wb.tiers[3].fx, 'pct', 1) / 100;
  if (!(small > 0)) return;
  var deg = (sgGeometryNumber(wb.tiers[3].fx, 'deg') || 30) * Math.PI / 180;
  for (var i = 0; i < n; i++) {
    var step = Math.floor(i / 2) + 1;
    var ang = baseAngle + deg * step * ((i % 2) ? -1 : 1);
    sgLaunchWindBlade(pEnt, st, 'vacuumslash', {
      geom: geom, angle: ang, dmgVal: small, pool: pool, geomOk: geomOk,
      fallback: [primary], small: true, vfxGid: 'windblade'
    }, floatSel, out);
  }
}

/* 超神【萬象風劫】：在命中處留下一道靜止的真空斬。
   走既有的地板場域＋**接觸判定**：半徑隨時間長大為 grow 倍，因此「擴大」這件事
   本身就是它的命中方式（掃過去的敵人各挨一次），不會每一拍對圈內的人全額重打。 */
function sgSpawnStaticVacuum(pEnt, st, u, victim, floatSel, bodyDmg, radiusPx) {
  if (!victim || victim.hp <= 0 || !SKILL2_RT) return;
  if (SKILL2_RT.grounds.length >= SG_GROUND_MAX_FIELDS) return;
  if (!chance(sgUltVal(u, 'chance'))) return;
  var dmgVal = bodyDmg * (Number(u.def.fx.pct) || 100) / 100;
  if (!(dmgVal > 0)) return;
  var lifeSec = Math.max(0.5, Number(u.def.fx.sec) || 3);
  var gap = Math.max(0.05, sgGeometryNumber(u.def.fx, 'gap') || 0.5);
  var grow = Math.max(1, Number(u.def.fx.grow) || 2);
  sgSpawnGround(pEnt, st, 'vacuumslash', {
    kind: 'vacuumfield', tgt: victim, floatSel: floatSel,
    from: (typeof bfPos === 'function') ? bfPos(victim) : null,
    radius: Math.max(4, radiusPx), dmgVal: dmgVal,
    hits: Math.max(1, Math.round(lifeSec / gap)), gap: gap,
    growTo: grow, growSec: lifeSec, contact: true, tickAtStart: true,
    vfxUlt: 'vacuumOmen'
  });
}

/* 【虛空斬】：四道以自身為圓心、半徑從 m 米起每秒擴大 growM 米的圓盤，
   每秒繞行 rps 圈，四道皆順時針並以 90 度間隔錯開。
   起始角取主目標方位（文檔：從前方目標出現後開始旋轉）。 */
function sgSpawnVoidDiscs(pEnt, st, g, lvs, floatSel, baseAngle, opts) {
  opts = opts || {};
  var fx = g.tiers[6].fx;
  /* opts.plain＝這一組是「被別的技能借去的形態」（超神【森羅萬象】），
     因此不吃玩家在真空斬上的傳奇與超神，也不歸真空斬記帳（gid／dmgVal 由呼叫端指定）。 */
  var plain = !!opts.plain;
  var gid = opts.gid || 'vacuumslash';
  var lg = plain ? {} : sgLegendTick('vacuumslash');
  var annihilate = plain ? null : sgUlt('vacuumslash', 'voidAnnihilation');
  var collapse = plain ? null : sgUlt('vacuumslash', 'spacetimeCollapse');
  // 超神【虛空滅界】：虛空斬傷害額外 +N%（獨立乘區，比照【極寒冰爆】）
  var dmgVal = (Number(opts.dmgVal) > 0) ? Number(opts.dmgVal)
    : sgGroupBaseStat(g, st) * sgVal(fx, 'pct', lvs[6]) / 100
      * (annihilate ? 1 + sgUltVal(annihilate, 'pct') / 100 : 1);
  if (!(dmgVal > 0)) return;
  var discs = Math.max(1, Math.floor(Number(opts.discs) > 0 ? opts.discs : (Number(fx.count) || 2)));
  // 傳奇【虛空漲落】：持續時間 +N 秒；超神【時空崩解】：再額外 +N%
  var lifeSec = Math.max(0.5, Number(fx.sec) || 6) + sgLegendCount(lg.vacuumVoidSec, 'sec');
  if (collapse) lifeSec *= 1 + sgUltVal(collapse, 'pct') / 100;
  var spin = Math.PI * 2 * (Number(fx.rps) || 1);
  /* 超神【時空崩解】：不再向外擴展，改為固定圍繞在我方周圍 m 米（成長歸零）。 */
  var startR = bfMeterPx(collapse
    ? Math.max(1, sgUltVal(collapse, 'm')) : Math.max(1, sgGeometryNumber(fx, 'm') || 6));
  var grow = collapse ? 0 : bfMeterPx(Math.max(0, sgGeometryNumber(fx, 'growM') || 0));
  var bodyR = bfMeterPx(Math.max(1, sgGeometryNumber(fx, 'bodyM') || 6)) / 2;
  var keyBase = opts.keyPrefix || 'void-disc-';
  for (var i = 0; i < discs; i++) {
    sgSpawnOrbitField(pEnt, st, gid, {
      floatSel: floatSel, lifeSec: lifeSec, dmgVal: dmgVal, bodyR: bodyR,
      count: 1, startAng: baseAngle + Math.PI * 2 * i / discs, growPxPerSec: grow,
      fieldKey: keyBase + i,
      rings: [{ r: startR, spin: spin }],
      statusId: 'sgVoidBlade', statusSlot: { gid: 'vacuumslash', tier: '7' }, auraVariant: 'void-disc',
      hitVariant: 'wind-burst', hitElem: 'wind',
      vfxTier: 7, vfxUlt: (opts && opts.vfxUlt) || ''
    });
  }
}

/* ---- 超神【天穹崩裂】（暴風屏障）：每 gap 秒從天上落下 1~3 個召喚星體 ----
   三種星體共用同一份傷害規格（設計只寫了「星體可能為…」，沒有分別給數值），
   差別只在形態與屬性：雷殞石與火殞石走既有的殞石佇列（從天而降＋落點範圍傷害），
   巨大風刃走風刃自己的既有畫法（放大的貫穿刃）——那是兩個渲染器都認得的變體，
   硬要它「落下」只會退回泛用雨點畫法，反而看不出來那是一道風刃。
   ⚠️ 這一個超神與風刃的【天穹崩裂】同名不同物（設計文檔就是這樣命名的），
   id 是 skyfallStars；風刃那一個是 skyCollapse，兩者沒有任何共用程式。 */
var SG_SKYFALL_KINDS = ['blade', 'thunder', 'fire'];
var SG_SKYFALL_BLADE_SCALE = 2;   // 「巨大風刃」的體積倍率（設計只寫「巨大」）

function sgDropSkyfallBlade(pEnt, st, dmgVal, target, pool, floatSel, out) {
  var wb = SKILLS2.windblade;
  var angle = (typeof bfAngleTo === 'function') ? bfAngleTo(target) : null;
  var geomOk = (angle !== null && angle !== undefined);
  sgLaunchWindBlade(pEnt, st, 'stormbarrier', {
    geom: sgWindbladeGeom(wb, [1, 0, 0, 0, 0, 0, 0], null),
    angle: geomOk ? angle : 0, dmgVal: dmgVal, pool: pool,
    geomOk: geomOk, fallback: [target], sizeMult: SG_SKYFALL_BLADE_SCALE,
    vfxGid: 'windblade'
  }, floatSel, out);
}

function sgTickSkyfallStars(ctx, dt) {
  var u = sgUlt('stormbarrier', 'skyfallStars');
  if (!u || !skills2Equipped('stormbarrier')) { SKILL2_RT.skyfallAt = 0; return; }
  // 死亡／倒地：節拍往後推，剩餘時間不變（見 skills2AutoCastBlocked）
  if (skills2AutoCastBlocked(ctx.pEnt)) {
    SKILL2_RT.skyfallAt = sgPauseSchedule(SKILL2_RT.skyfallAt, dt);
    return;
  }
  var gap = Math.max(0.1, sgGeometryNumber(u.def.fx, 'gap') || 2);
  if (!(SKILL2_RT.skyfallAt > 0)) { SKILL2_RT.skyfallAt = GT + gap; return; }
  if (GT < SKILL2_RT.skyfallAt) return;
  SKILL2_RT.skyfallAt = GT + gap;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  var live = (typeof bfLiveList === 'function') ? bfLiveList(enemies) : (enemies || []);
  if (!live.length) return;
  var st = (typeof getStats === 'function') ? getStats() : null;
  if (!st) return;
  var dmgVal = sgGroupBaseStat(SKILLS2.stormbarrier, st) * sgUltVal(u, 'pct') / 100;
  if (!(dmgVal > 0)) return;
  var lo = Math.max(1, Math.floor(Number(u.def.fx.min) || 1));
  // 顆數上限隨等級成長（不足 1 個的部分以機率觸發，比照其他「+N 個」的既有做法）
  var hi = Math.max(lo, sgRollCount(sgUltVal(u, 'max')));
  var n = lo + Math.floor(Math.random() * (hi - lo + 1));
  var radius = bfMeterPx(Math.max(1, sgGeometryNumber(u.def.fx, 'm') || 8));
  var timing = sgMeteorFallTiming();
  var out = { killed: false, dmg: 0, crit: false };
  for (var i = 0; i < n; i++) {
    var target = live[Math.floor(Math.random() * live.length)];
    var kind = SG_SKYFALL_KINDS[Math.floor(Math.random() * SG_SKYFALL_KINDS.length)];
    if (kind === 'blade') {
      sgDropSkyfallBlade(ctx.pEnt, st, dmgVal, target, enemies, ctx.floatSel, out);
      continue;
    }
    var bolt = (kind === 'thunder');
    var castDelay = i * SG_METEOR_INTERVAL_MS;
    sgEmitVfx('stormbarrier', [target], ctx.floatSel, {
      fxKind: 'rain', variant: bolt ? 'thunder-fall' : 'meteor',
      elem: bolt ? 'lightning' : 'fire', count: 1,
      area: sgAreaAround(target, radius), delayMs: castDelay, travelMs: [timing.travelMs],
      vfxUlt: 'skyfallStars'
    });
    sgQueueMeteor(ctx.pEnt, st, dmgVal, target, enemies, radius, null, ctx.floatSel, out,
      GT + (castDelay + timing.fallMs) / 1000, {
        gid: 'stormbarrier',
        variant: bolt ? 'thunder-fall-impact' : 'meteor-impact',
        elem: bolt ? 'lightning' : 'fire',
        vfxUlt: 'skyfallStars'
      });
  }
}

/* ---- 超神【虛空滅界】：每 gap 秒自動斬出 1 道虛空斬 ----
   不走 castSkill2——設計寫的是「自動施放 1 道虛空斬」而不是再施放一次真空斬，
   因此直接呼叫第 7 階自己的生成函式（傷害乘區也在那一支，兩條路不會漂移）。
   其餘規則比照既有的自動施放：沒裝配在技能列不生效、倒地時節拍往後推。
   顯示層的合併鍵另外給序號，否則每一道都會被當成同一道而只延長既有圓盤的壽命。 */
function sgTickVoidAnnihilation(ctx, dt) {
  var u = sgUlt('vacuumslash', 'voidAnnihilation');
  if (!u || !skills2Equipped('vacuumslash')) { SKILL2_RT.voidAnnihilateAt = 0; return; }
  if (skills2AutoCastBlocked(ctx.pEnt)) {
    SKILL2_RT.voidAnnihilateAt = sgPauseSchedule(SKILL2_RT.voidAnnihilateAt, dt);
    return;
  }
  var gap = Math.max(0.1, sgGeometryNumber(u.def.fx, 'gap') || 2);
  if (!(SKILL2_RT.voidAnnihilateAt > 0)) { SKILL2_RT.voidAnnihilateAt = GT + gap; return; }
  if (GT < SKILL2_RT.voidAnnihilateAt) return;
  SKILL2_RT.voidAnnihilateAt = GT + gap;
  if (typeof effectActive === 'function' && effectActive(ctx.pEnt, 'stun')) return;
  var lvs = skills2Levels('vacuumslash');
  var st = (typeof getStats === 'function') ? getStats() : null;
  if (!lvs || lvs[6] < 1 || !st) return;
  sgSpawnVoidDiscs(ctx.pEnt, st, SKILLS2.vacuumslash, lvs, ctx.floatSel, 0, {
    discs: 1, keyPrefix: 'void-anni-' + (++SG_VOID_DISC_SEQ) + '-'
  });
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
  var lg = sgLegend('stormbarrier');
  var valgr = sgUlt('stormbarrier', 'valgrForce');
  var dur = Math.max(0.5, Number(t[0].fx.sec) || 8);
  var gap = Math.max(0.1, sgGeometryNumber(t[0].fx, 'gap') || 0.5);
  // 傳奇【吸收】：屏障的傷害減免加算（與第 1 階同一個池子，之後才整體乘算）
  var red = sgVal(t[0].fx, 'red', lvs[0]) + Math.max(0, Number(lg.stormbarrierRedPct) || 0);
  // 屏障的光殼是暴風屏障狀態的「持續特效」（狀態表），屏障多久就轉多久
  sgApplySlot(pEnt, 'stormbarrier', '1', 'self', 0, { val: red, dur: dur });
  SKILL2_RT.barrier = { until: GT + dur, pEnt: pEnt, nextAt: GT + gap, gap: gap, floatSel: floatSel };
  // 【暴風神體】：與屏障同時施放、分開結算的另一個狀態
  if (lvs[6] > 0) {
    /* 持續時間的兩個延長是**相乘**：傳奇【風暴核心】與超神【瓦爾格之力】各是一個
       「+50%」，兩者都寫成獨立的百分比，相加會讓兩個滿級來源直接變成 ×2 的線性堆疊。 */
    var godSec = Math.max(0.1, sgVal(t[6].fx, 'sec', lvs[6]))
      * (1 + Math.max(0, Number(lg.stormGodSecPct) || 0) / 100)
      * (valgr ? 1 + sgUltVal(valgr, 'sec') / 100 : 1);
    // 超神【瓦爾格之力】：神體的傷害減免再加一點（與屏障那一份一起走風系的加總）
    var godRed = sgVal(t[6].fx, 'red', lvs[6]) + (valgr ? sgUltVal(valgr, 'red') : 0);
    // 神體附身的畫面是暴風神體狀態的「持續特效」（狀態表）
    sgApplySlot(pEnt, 'stormbarrier', '7', 'self', 0, { val: godRed, dur: godSec });
  }
  // 超神【森羅萬象】：同時打出【暴風真空刃】與【虛空斬】兩個形態
  var myriad = sgUlt('stormbarrier', 'myriadPhenomena');
  if (myriad) sgCastMyriadPhenomena(pEnt, st, myriad, pool, primary, floatSel, out);
  sgStormBarrierPulse(SKILL2_RT.barrier, lvs, null);   // 施放當下先給一拍，不必等 0.5 秒
}

/* 超神【森羅萬象】：施放暴風屏障時同時打出【暴風真空刃】與【虛空斬】兩個形態。
   比照【暴風之刃】的既有裁定——借的是**形態**而不是玩家在那兩棵樹上的投資：
   幾何、道數與持續時間取那兩階的 Lv.1 表定值，基準攻擊力與傷害紀錄都歸暴風屏障
   （它才是這些刃的來源，因此沒有投資風刃／真空斬的人一樣拿得到完整效果）。 */
function sgCastMyriadPhenomena(pEnt, st, u, pool, primary, floatSel, out) {
  var mult = 1 + sgUltVal(u, 'pct') / 100;
  var baseAngle = (typeof bfAngleTo === 'function') ? bfAngleTo(primary) : null;
  var geomOk = (baseAngle !== null && baseAngle !== undefined);
  if (!geomOk) baseAngle = 0;
  /* ① 暴風真空刃＝風刃第 1＋7 階的 Lv.1 形態（不含第 4／5 階的小型風刃與追擊，
     那兩階不在設計文字裡）。 */
  var wb = SKILLS2.windblade;
  var wlvs = [1, 0, 0, 0, 0, 0, 1];
  var t7 = wb.tiers[6].fx;
  var bladeDmg = sgGroupBaseStat(SKILLS2.stormbarrier, st)
    * sgWindbladeDmgPct(wb, wlvs, null) / 100 * mult;
  if (bladeDmg > 0) {
    var geom = sgWindbladeGeom(wb, wlvs, null);
    var dirs = Math.max(1, Math.floor(Number(t7.directions) || 4));
    var volleys = Math.max(1, Math.floor(Number(t7.count) || 2));
    var volleyGap = Math.max(0, sgGeometryNumber(t7, 'gap') || 0.2);
    for (var d = 0; d < dirs; d++) {
      for (var v = 0; v < volleys; v++) {
        sgLaunchWindBlade(pEnt, st, 'stormbarrier', {
          geom: geom, angle: baseAngle + Math.PI * 2 * d / dirs, dmgVal: bladeDmg,
          pool: pool, geomOk: geomOk, fallback: [primary], beginSec: v * volleyGap,
          vfxGid: 'windblade'
        }, floatSel, out);
      }
    }
  }
  // ② 虛空斬＝真空斬第 7 階的 Lv.1 形態（plain＝不吃玩家在真空斬上的傳奇與超神）
  var vs = SKILLS2.vacuumslash;
  var discDmg = sgGroupBaseStat(SKILLS2.stormbarrier, st)
    * sgVal(vs.tiers[6].fx, 'pct', 1) / 100 * mult;
  if (discDmg > 0) {
    sgSpawnVoidDiscs(pEnt, st, vs, [1, 1, 1, 1, 1, 1, 1], floatSel, baseAngle, {
      plain: true, gid: 'stormbarrier', dmgVal: discDmg,
      keyPrefix: 'void-myriad-' + (++SG_VOID_DISC_SEQ) + '-',
      vfxUlt: 'myriadPhenomena'
    });
  }
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
  var radiusPx = bfMeterPx(sgGeometryNumber(t[1].fx, 'm') || 8);

  // 【暴風撕裂】：每一拍對半徑內的敵人各打一段
  if (lvs[1] > 0) {
    var dmgVal = sgGroupBaseStat(g, st) * sgVal(t[1].fx, 'pct', lvs[1]) / 100;
    var victims = sgEnemiesNearPlayer(enemies, radiusPx, null, 0);
    sgEmitPlayerVfx('stormbarrier', floatSel, { fxKind: 'aura', variant: 'storm-rip', elem: 'wind', dur: rt.gap, vfxTier: 2 });
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
        sgEmitVfx('stormbarrier', marked, floatSel, { fxKind: 'impact', variant: 'wind-rend', elem: 'wind', vfxTier: 3 });
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
  // 傳奇【暴風反射】：射出風刃的機率加算
  var chancePct = sgVal(t[3].fx, 'chance', lvs[3])
    + sgLegendCount(sgLegendTick('stormbarrier').stormbladeChanceAdd, 'chance');
  if (!chance(chancePct)) return;
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
    geomOk: geomOk, fallback: [mEnt], vfxTier: 4
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
  var victims = bfRandomOthers(from, enemies, count, bfMeterPx(sgGeometryNumber(fx, 'm') || 10), null);
  var spread = [];
  for (var i = 0; i < victims.length; i++) {
    if (sgWindRendOn(victims[i])) continue;
    sgApplyWindRend(victims[i], spec, 1);
    spread.push(victims[i]);
  }
  if (spread.length) {
    sgEmitVfx('stormbarrier', [from].concat(spread), 'mv-float', {
      fxKind: 'chain', variant: 'wind-rend-spread', elem: 'wind', travelMs: [80],
      preserveDeadTargets: true,
      vfxTier: 5
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
  // 戰神體失血在實際扣血點記錄，避免受擊通知重複計數。
  sgCounterOnPlayerDamaged(mEnt, pEnt, hpDamage, blocked, res, floatSel); // 反擊
  sgFrostbodyOnPlayerDamaged(mEnt, pEnt, floatSel);                      // 冰霜新星 T3【寒冰體】
  sgStormbladeOnPlayerDamaged(mEnt, pEnt, floatSel);                     // 暴風屏障 T4【暴風之刃】
  sgSkyCollapseOnPlayerDamaged(mEnt, pEnt, floatSel);                    // 風刃超神【天穹崩裂】
}

/* 反擊每階都提供升到該階後的基本耗魔；大地守護維持恆時被動，不收觸發費。 */
var SG_TRIGGER_MP_TIERS = { counter: [1, 1, 1, 1, 1, 1, 1] };
/* 階段消耗預覽與追加費用共用參數表；基本反擊由 skills2PassiveMinMp 選最高階。 */
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
  // 無階段索引＝本體反擊；追加效果才指定自身階段（T6／T7）。
  var cost = tierIdx === undefined ? skills2PassiveMinMp('counter') : skills2TierTriggerMp('counter', tierIdx);
  if (cost <= 0) return true;
  if (typeof gmMpLockActive === 'function' && gmMpLockActive(pEnt)) return true;
  if (!pEnt || !((pEnt.mp || 0) >= cost)) return false;
  pEnt.mp -= cost;
  return true;
}
/* 基本反擊的最低起手法力：最高已學習階段，超神生效時優先；各階不累加。
   UI 傳入完整快照；模擬端省略參數時讀 G。 */
function skills2PassiveMinMp(gid, levels, ultRaw) {
  var g = SKILLS2[gid];
  if (!g || !SG_TRIGGER_MP_TIERS[gid]) return 0;
  var lvs = levels;
  if (!lvs) {
    lvs = skills2Levels(gid);
    ultRaw = typeof G !== 'undefined' && G.player && G.player.skills2 ? G.player.skills2.ult : null;
  }
  var u = sgEffectiveUlt(ultRaw, gid, lvs);
  if (u) return skills2TierManaCost(gid, 0, u.id);
  for (var i = g.tiers.length - 1; i >= 0; i--) {
    if (lvs[i] > 0) return skills2TierManaCost(gid, i);
  }
  return 0;
}

function sgCounterOnPlayerDamaged(mEnt, pEnt, hpDamage, blocked, res, floatSel) {
  if (!skills2PassiveActive('counter')) return; // 主動型被動：沒裝在技能列就不生效
  var lvs = skills2Levels('counter');
  if (!lvs || lvs[0] < 1) return;
  var t = SKILLS2.counter.tiers;
  var st = getStats();
  var eSel = (typeof THORN_FLOAT_MAP !== 'undefined' && THORN_FLOAT_MAP[floatSel]) || floatSel;

  /* 攻擊者已死就沒有反擊可打——必須在扣魔之前先擋掉，否則會為了不會發生的
     反擊付魔（破甲那段自己有 hp>0 判定，不受影響）。 */
  if (mEnt.hp <= 0) return;

  // 反擊判定：pct＝普攻傷害%；強化反擊（T3）對所有反擊累加（恆時生效、不扣魔）
  var bonus = lvs[2] > 0 ? sgVal(t[2].fx, 'pct', lvs[2]) : 0;
  var strikes = [];
  var tookDamage = (hpDamage > 0) || !!(res && res.absorbed > 0);
  if (tookDamage && chance(Number(t[0].fx.chance) || 0) && sgCounterPayMp(pEnt)) {
    strikes.push(sgVal(t[0].fx, 'pct', lvs[0]) + bonus);
  }
  if (blocked && lvs[1] > 0) {
    var blockRed = (typeof blockDmgReduction === 'function') ? blockDmgReduction(st.blockDmgRed || 0) : 0;
    var parryPct = blockRed * sgVal(t[1].fx, 'mult', lvs[1]) / 100;
    if (parryPct > 0 && sgCounterPayMp(pEnt)) strikes.push(parryPct + bonus);
  }
  if (!strikes.length) return;
  // 破甲與反擊盾已包含在本體費用中，成功反擊才套用，不再額外扣魔。
  if (blocked && lvs[4] > 0 && chance(sgSlotChance('counter', '5', 'enemy', 0, Number(t[4].fx.chance) || 0))) {
    sgApplySlot(mEnt, 'counter', '5', 'enemy', 0, { val: Number(t[4].fx.def) || 0, dur: sgVal(t[4].fx, 'sec', lvs[4]), noChance: true });
    sgEmitVfx('counter', [mEnt], eSel, { fxKind: 'impact', variant: 'armor-break', vfxTier: 5 });
  }
  // Skills2「我方狀態」的附加條目：被動技能以「觸發一次反擊」當作施放
  if (sgHasExtraStatuses('counter', 'self')) {
    sgApplyExtraStatuses(pEnt, 'counter', 'self', { stats: st, source: sgStatusSource('counter') });
  }

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
  var hitIdx = 0;
  /* 迴圈也要看玩家自己還活著：傳奇【以血還血】每一斬都扣自身生命，
     一輪反殺打完可能已經把自己打死，死後不該繼續揮刀。 */
  for (i = 0; i < all.length && mEnt.hp > 0 && pEnt.hp > 0; i++) {
    sgCounterStrike(pEnt, st, mEnt, all[i], eSel, out, 200 * hitIdx++, cfg);
    /* 狂化反殺（T7）：每次反擊額外對範圍內隨機 count 個敵人反擊（不再判定）。
       先挑目標再扣魔——範圍內沒人可打時不該白付魔。 */
    /* 傳奇【以血還血】把自己打死之後就不該再揮：追加斬擊各自還要再付一次代價。 */
    if (lvs[6] > 0 && pEnt.hp > 0) {
      var victims = sgCounterSplashTargets(mEnt, enemies, t[6].fx);
      if (!victims.length || !sgCounterPayMp(pEnt, 6)) continue;
      for (var vi = 0; vi < victims.length; vi++) {
        sgCounterStrike(pEnt, st, victims[vi], sgVal(t[6].fx, 'pct', lvs[6]) + bonus, eSel, out, 200 * hitIdx++, cfg);
        if (splashHit.indexOf(victims[vi]) < 0) splashHit.push(victims[vi]);
      }
    }
  }


  /* 反擊盾（T4）：每次反擊事件回復一次，費用已包含於本體反擊。 */
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
function sgCounterStrike(pEnt, st, target, pct, floatSel, out, delayMs, cfg) {
  if (!target || target.hp <= 0 || !(pct > 0)) return null;
  pct = sgCounterApplyLegends(pEnt, st, pct, cfg);
  var aCfg = (typeof playerAtkCfg === 'function') ? playerAtkCfg(pEnt) : null;
  if (!aCfg) return null;
  sgEmitVfx('counter', [target], floatSel, { fxKind: 'strike', variant: 'counter-riposte', delayMs: delayMs || 0, travelMs: [200] });
  aCfg.atk = (aCfg.atk || 0) * pct / 100;
  if (aCfg.matk) aCfg.matk = aCfg.matk * pct / 100;
  // 不屈鬥魂：所有反擊共用此入口，保留普攻基礎與倍率，將本體段轉為地屬性。
  if (sgUlt('counter', 'indomitable')) aCfg.skillElem = 'earth';
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
  // 反擊不走 sgHitOne，附加條目在這裡補上（基準＝這一下的普攻攻擊值 × pct%）
  if (!res.miss) sgApplyHitStatuses(target, 'counter', Math.max(Number(aCfg.atk) || 0, Number(aCfg.matk) || 0), st);
  sgCounterAfterStrike(pEnt, st, target, cfg, floatSel, out, delayMs);
  return res;
}

/* ---- 反擊的傳奇進化與超神進化（2026-08-21 第四批）----
   盾牌是副手（cat offHand），**沒有**雙手武器補償，因此 fx 寫多少就是多少。 */

/* 反擊的累計器。分開記每個效果的計數而不是共用一個總數，是因為門檻各自獨立
  （堅韌誓言／怒火 100 次、神聖之體 10 次），共用總數的話換裝之後會互相踩到。 */
function sgCounterRT() {
  if (!SKILL2_RT.counter) SKILL2_RT.counter = { hits: 0, oath: 0, wrath: 0, holy: 0, warBody: null };
  return SKILL2_RT.counter;
}

/* 戰神體：本段收集失血、下一段返還。只記錄實際扣除的生命，不計護盾與治療。 */
function sgWarGodBodyState(pEnt, startAt) {
  var u = sgUlt('counter', 'warGodBody');
  if (!SKILL2_RT) return null;
  var rt = sgCounterRT();
  pEnt = pEnt || sgCurrentPlayerEnt();
  if (!u || !skills2PassiveActive('counter') || !pEnt || !(pEnt.hp > 0)) {
    rt.warBody = null;
    return null;
  }
  var sec = Math.max(0.1, sgUltVal(u, 'sec')), gap = Math.max(0.05, sgUltVal(u, 'gap'));
  var body = rt.warBody;
  if (!body || body.pEnt !== pEnt || body.sec !== sec || body.gap !== gap) {
    var at = Number.isFinite(startAt) ? startAt : GT;
    body = rt.warBody = { pEnt: pEnt, sec: sec, gap: gap, nextDrain: at + gap,
      nextWindow: at + sec, collected: 0, bonus: 0 };
  }
  // 依事件時間補足節拍；恰好落在段尾的定期扣血歸入剛結束的段。
  while (Math.min(body.nextDrain, body.nextWindow) <= GT + 1e-9) {
    if (body.nextDrain <= body.nextWindow + 1e-9) {
      var st = getStats(), before = pEnt.hp;
      if (!(typeof gmHpLockActive === 'function' && gmHpLockActive(pEnt))) {
        var floor = (typeof GM_TEST !== 'undefined' && GM_TEST && GM_TEST.god) ? 1 : 0;
        pEnt.hp = Math.max(floor, before - st.hp * Math.max(0, sgUltVal(u, 'hpPct')) / 100);
      }
      if (st.hp > 0) body.collected += Math.max(0, before - pEnt.hp) / st.hp * 100;
      body.nextDrain += gap;
      if (!(pEnt.hp > 0)) { rt.warBody = null; return null; }
    } else {
      body.bonus = body.collected * Math.max(0, sgUltVal(u, 'mult'));
      body.collected = 0;
      body.nextWindow += sec;
    }
  }
  return body;
}

function sgWarGodBodyPct() {
  var body = sgWarGodBodyState();
  return body ? body.bonus : 0;
}

function sgWarGodBodyOnDamaged(hpDamage, pEnt) {
  if (!(hpDamage > 0) || !SKILL2_RT || typeof getStats !== 'function') return;
  var body = sgWarGodBodyState(pEnt), st = getStats();
  if (body && st.hp > 0) body.collected += hpDamage / st.hp * 100;
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
    if (pEnt && !(typeof gmHpLockActive === 'function' && gmHpLockActive(pEnt))) {
      var hpBeforeCounter = pEnt.hp;
      pEnt.hp = Math.max(gmFloor, pEnt.hp - cost);
      sgWarGodBodyOnDamaged(hpBeforeCounter - pEnt.hp, pEnt);
    }
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
    fxKind: 'projectile', variant: 'wind-blade-homing', elem: 'wind', dur: 0.5,
    vfxGid: 'windblade', vfxTier: 1
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
  var roles = sgVfxRoles('counter', { vfxUlt: 'holyBody' });
  var start = bfPlayerPos(), end = bfPos(target);
  var radius = bfMeterPx(sgUltVal(u, 'm'));
  // 原反擊爆炸以敵人邊緣間距判定；圓心半徑需包含主目標體型，保留原命中邊界。
  var areaRadius = radius + (end ? bfEntityRadius(target) : 0);
  // 鎖定本次目標的位置；目標死亡仍飛到同一落點，不把爆炸搬回玩家身上。
  var area = end ? { x: end.x, y: end.y, sourceX: start.x, sourceY: start.y, fixedLanding: true } : null;
  var speed = sgUltVal(u, 'speed');
  var travel = speed > 0 && end ? Math.hypot(end.x - start.x, end.y - start.y) / bfMeterPx(speed)
    : sgConfiguredTravelSeconds('counter', target);
  travel = Math.max(0.05, travel || 0.2);
  var delay = Math.max(0, Number(delayMs) || 0);
  sgEmitVfx('counter', [target], floatSel, {
    fxKind: 'projectile', variant: 'counter-holy-flight', elem: 'light', hit: false,
    area: area, preserveDeadTargets: true, delayMs: delay, travelMs: [travel * 1000],
    vfxRoles: { projectile: roles.projectile }
  });
  SKILL2_RT.projectiles.push({ counterHolyFlight: true, pEnt: pEnt, st: st, target: target,
    area: end ? { x: end.x, y: end.y, r: areaRadius } : null,
    endAt: sgProjectileNow() + delay / 1000 + travel, dmgVal: dmgVal,
    roles: roles, floatSel: floatSel });
}

function sgResolveCounterHolyOrb(shot, ctx) {
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  var victims = shot.area ? bfEnemiesInArea(shot.area, enemies)
    : enemies.filter(function (e) { return e === shot.target && e.hp > 0; });
  var out = { killed: false, dmg: 0, crit: false };
  // 只有落點的一次範圍演出；不附帶 projectile／hit，避免重射或逐受害者重播。
  sgEmitVfx('counter', shot.area ? [] : victims, shot.floatSel, {
    fxKind: 'burst', variant: 'counter-holy-impact', elem: 'light', area: shot.area,
    vfxRoles: { attack: shot.roles.attack }
  });
  for (var i = 0; i < victims.length; i++) {
    sgHitOne(shot.pEnt, shot.st, victims[i], shot.dmgVal, 'counter', shot.floatSel, out, 0, 0, 'light');
  }
  if (out.dmg && ctx.onDamage) ctx.onDamage(out.dmg);
  if (out.killed && ctx.onDeaths) ctx.onDeaths();
}

/* 超神【不屈鬥魂】：死亡攔截。掛在 js/combat.js onPlayerFieldDeath——野外有多條判死路徑，
   那裡是它們唯一的共同出口（與【天地共生】同一個掛點）。
   兌現內容：站姿升空 sec 秒、線性回血、分段地系傷害，結束繼續原戰鬥。
   冷卻沿用 pEnt.skillCds[SG_PREFIX + counter]（被動群組從不施放，這個鍵沒有別的用途），
   因此讀檔／離開戰鬥的清理與一般技能冷卻完全一致。 */
function skills2TryLastStand(pEnt) {
  if (!pEnt || !SKILL2_RT || typeof getStats !== 'function') return false;
  if (SKILL2_RT.lastStand && SKILL2_RT.lastStand.pEnt === pEnt) return true;
  var u = sgUlt('counter', 'indomitable');
  if (!u || !skills2PassiveActive('counter') || pEnt.hp > 0) return false;
  if (!pEnt.skillCds) pEnt.skillCds = {};
  if ((pEnt.skillCds[SG_PREFIX + 'counter'] || 0) > 0) return false;
  var st = getStats(), sec = Math.max(0.5, sgUltVal(u, 'sec'));
  var gap = Math.max(0.05, sgUltVal(u, 'gap') || 0.5);
  var ticks = Math.max(1, Math.ceil(sec / gap));
  if (typeof cleanse === 'function') cleanse(pEnt);
  pEnt.hp = 0;
  pEnt._skillCastRemaining = 0;
  pEnt._skillCastId = '';
  pEnt._sgRevival = { startAt: GT, endAt: GT + sec };
  sgApplySlot(pEnt, 'counter', 'indomitable', 'self', 0, { dur: sec });
  pEnt.skillCds[SG_PREFIX + 'counter'] = Math.max(1, sgUltVal(u, 'cd'));
  SKILL2_RT.lastStand = { startAt: GT, reviveAt: GT + sec, pEnt: pEnt, done: false,
    gap: gap, ticks: ticks, emitted: 0, st: st, radius: bfMeterPx(sgUltVal(u, 'm')),
    dmgVal: ((Number(st.atk) || 0) + (Number(st.matk) || 0)) * sgUltVal(u, 'pct') / 100 / ticks };
  sgEmitPlayerVfx('counter', 'pv-float', { fxKind: 'aura', variant: 'indomitable-revival',
    elem: 'earth', dur: sec, vfxUlt: 'indomitable' });
  if (typeof floatPlayerEvent === 'function') floatPlayerEvent('pv-float', '不屈鬥魂!', 'buff');
  if (typeof UI !== 'undefined' && UI.dirty) { UI.dirty.battle = true; UI.dirty.skills = true; }
  return true;
}

/* 倒地期間不能行動（普攻與技能一起擋）。掛點：combat.js 的玩家行動閘門。 */
function skill2DownedActive() {
  var ls = SKILL2_RT && SKILL2_RT.lastStand;
  return !!(ls && !ls.done && ls.reviveAt > GT);
}

/* ---- 自動施放的共同閘門（2026-08-24 使用者決策）----
   「每隔 N 秒自動發動」的效果，在角色**死亡或倒地期間一律暫停**——
   自動不等於不受角色狀態限制：人倒下了，他的技能就不該繼續打。
   涵蓋【地爆天星】【天霸風神斬】【阿修羅霸王拳】【暴風之舞】與傳奇的三個自動觸發。

   為什麼是「暫停」而不是「跳過這一拍」（暈眩走的是後者）：
     ・跳過的話，倒地期間到期的那一發會消失，但【地爆天星】的黑影預警可能已經播完，
       畫面上會出現「殞石照樣落下卻沒有任何傷害」的鬼影
     ・排程若原封不動，復活的瞬間會把倒地期間累積的節拍一次補發（等效免費爆發）
   往後推 dt 同時解決兩者：剩餘時間完全不動，倒地本身就是代價。

   這是全專案自動施放的唯一判定入口——新增自動施放效果時呼叫這一支就好。
   注意 hp<=0 也算：傳奇【不屈之誓】期間生命被夾在 1（>0），因此那 10 秒仍會照常施放，
   與該特效「期間傷害 +100%」的設計一致。 */
function skills2AutoCastBlocked(pEnt) {
  if (!pEnt || pEnt.hp <= 0) return true;
  return skill2DownedActive();
}

/* 把一條「絕對時刻」排程往後推 dt（剩餘時間因此完全不變）。 */
function sgPauseSchedule(at, dt) {
  var step = Math.max(0, Number(dt) || 0);
  return (at > 0) ? at + step : at;
}

/* 復甦排程：血量依時間推進，傷害按 gap 分段；最後一跳後才解除免死。 */
function sgTickLastStand(ctx) {
  var ls = SKILL2_RT.lastStand;
  if (!ls || ls.done) return;
  var pEnt = ls.pEnt || ctx.pEnt;
  if (!pEnt || !pEnt._sgRevival) { SKILL2_RT.lastStand = null; return; }
  var elapsed = Math.max(0, Math.min(GT, ls.reviveAt) - ls.startAt);
  pEnt.hp = getStats().hp * elapsed / (ls.reviveAt - ls.startAt);
  var due = GT + 1e-8 >= ls.reviveAt ? ls.ticks : Math.min(ls.ticks, Math.floor((elapsed + 1e-8) / ls.gap));
  while (ls.emitted < due) {
    ls.emitted++;
    var enemies = ctx.getEnemies ? ctx.getEnemies() : combatFieldEnemies();
    var out = { killed: false, dmg: 0, crit: false };
    for (var i = 0; i < enemies.length; i++) {
      var target = enemies[i];
      if (!target || target.hp <= 0 || (bfPos(target) && bfEntityDistance(target) > ls.radius)) continue;
      sgHitOne(pEnt, ls.st, target, ls.dmgVal, 'counter', ctx.floatSel || 'mv-float', out, 0, 0, 'earth');
    }
    if (out.killed && ctx.onDeaths) ctx.onDeaths();
  }
  // 傷害衍生治療不改變復甦進度，最後一跳結算後才解除免死。
  pEnt.hp = getStats().hp * elapsed / (ls.reviveAt - ls.startAt);
  if (GT + 1e-8 < ls.reviveAt) return;
  ls.done = true;
  pEnt.hp = getStats().hp;
  delete pEnt._sgRevival;
  SKILL2_RT.lastStand = null;
  if (typeof floatPlayerEvent === 'function') floatPlayerEvent('pv-float', '復甦完成!', 'buff');
  if (typeof UI !== 'undefined' && UI.dirty) UI.dirty.battle = true;
}

/* 超神【阿修羅霸王拳】：每 gap 秒自動發動一次全傷害爆發。
   口徑與【殺神領域】一致——嗜血狂怒必須裝配在技能列上才生效，但不必在狂怒期間
  （設計文檔寫的是「每 10 秒」，沒有加上狂怒期間的限定）。 */
function sgTickAsuraFist(ctx, dt) {
  var u = sgUlt('bloodrage', 'asuraFist');
  if (!u || !skills2Equipped('bloodrage')) { SKILL2_RT.asuraFist = 0; return; }
  // 死亡／倒地：節拍往後推，剩餘時間不變（見 skills2AutoCastBlocked）
  if (skills2AutoCastBlocked(ctx.pEnt)) {
    SKILL2_RT.asuraFist = sgPauseSchedule(SKILL2_RT.asuraFist, dt);
    return;
  }
  var gap = Math.max(0.5, sgUltVal(u, 'gap'));
  if (!(SKILL2_RT.asuraFist > 0)) { SKILL2_RT.asuraFist = GT + gap; return; }
  if (SKILL2_RT.asuraFist > GT) return;
  SKILL2_RT.asuraFist = GT + gap;
  if (!ctx.pEnt || ctx.pEnt.hp <= 0) return;
  // 爆發期間的光殼是該狀態的「持續特效」（狀態表）
  var activeSid = sgSlotSid('bloodrage', 'asuraFist', 'self', 0);
  var activeBuff = ctx.pEnt.buffs && ctx.pEnt.buffs[activeSid];
  var remaining = activeBuff ? Math.max(0, activeBuff.until - GT) : 0;
  sgApplySlot(ctx.pEnt, 'bloodrage', 'asuraFist', 'self', 0, {
    val: sgUltVal(u, 'pct'), dur: Math.max(0.1, sgUltVal(u, 'sec'), remaining)
  });
  if (typeof floatPlayerEvent === 'function') floatPlayerEvent('pv-float', '阿修羅霸王拳!', 'buff');
}

/* 狂化反殺目標挑選：範圍內（米換算；無座標＝視為在範圍內）、排除攻擊者本身，
   隨機挑 count 個（每次反擊各自重挑）。 */
function sgCounterSplashTargets(exclude, enemies, fx) {
  var radius = bfMeterPx(sgGeometryNumber(fx, 'm') || 80);
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
  sgTickLastStand(ctx);
  sgWarGodBodyState(ctx.pEnt, GT - Math.max(0, Number(dt) || 0));
  if (!(ctx.pEnt.hp > 0)) return;
  if (SKILL2_RT.rage && SKILL2_RT.rage.until <= GT) SKILL2_RT.rage = null; // 狂怒到期回收
  if (SKILL2_RT.rock && SKILL2_RT.rock.until <= GT) {
    /* 【金剛不壞】的生命上限倍率跟著岩甲走：到期不重算屬性的話，那 +55% 會一直留著。
       順序有意義——倍率要在 RT 還在時先讀出來，清掉之後就讀不到了。
       當前生命按同一個比例縮回去（施放時漲多少、到期就掉多少），整個循環不白賺相對生命。 */
    var adamantEnt = SKILL2_RT.rock.pEnt;
    /* ⚠️ 不能用 skill2RockMaxHpFactor()：那一支本身就以「岩甲還在不在」為前提，
       到期這一刻它已經回 1 了。倍率要直接從超神進化的參數重算。 */
    var adamantU = (typeof markStatsDirty === 'function') ? sgUlt('rockarmor', 'adamantBody') : null;
    var adamantRatio = adamantU ? 1 + sgUltVal(adamantU, 'hp') / 100 : 1;
    /* 岩甲到期回收。顯示層那一側不必也不能在這裡通知：模擬層跑在 Worker 內，
       BattleRenderer 不存在於該環境（原本的 clearFollowAura 呼叫因此從未執行過）。
       光殼與領域範圍提示都改由「RT 還在才續命」收斂——沒有人續命就自然到期。 */
    SKILL2_RT.rock = null;
    if (adamantRatio > 1) {
      markStatsDirty();
      var afterSt = (typeof getStats === 'function') ? getStats() : null;
      skill2RockScaleHp(adamantEnt, 1 / adamantRatio, afterSt);
    }
  }
  sgTickFlyingProjectiles(dt, ctx);
  sgTickGaleStrikes(ctx);
  sgTickThunderLaunches(ctx);
  sgTickMeteors(ctx);
  sgTickWaterballs(ctx);
  sgTickGrounds(dt, ctx);
  sgTickOrbits(dt, ctx);
  sgTickStorm(ctx, dt);
  sgTickBloodDots(dt, ctx);
  sgTickBloodDomains(ctx);
  sgTickDeathDefer(ctx);
  sgTickAsuraFist(ctx, dt);
  sgTickWarGodShield(ctx);
  sgTickBurn(dt, ctx);
  sgTickFrost(dt, ctx);
  sgTickStormBarrier(dt, ctx);
  sgTickWindRend(dt, ctx);
  sgTickUltAutoCast(ctx, dt);
  sgTickStarfall(ctx, dt);
  sgTickFirehuntLegend(ctx, dt);
  sgTickFireGod(ctx, dt);
  sgTickRockField(ctx, dt);
  sgTickRockArmorAura(ctx);
  sgTickNetherMire(ctx);
  sgTickRebirthCharge(ctx.pEnt);
  sgTickEarthguardAura(ctx);
  sgTickUltRepeat(ctx, dt);
  sgTickFlyingThunder(ctx, dt);
  sgTickHeavenTribulation(ctx, dt);
  sgTickThunderfallShatter(ctx, dt);
  sgTickWaterPrison(ctx, dt);
  sgTickRagingTide(ctx);
  sgTickAbyssDomain(ctx, dt);
  sgTickInfiniteNova(ctx, dt);
  sgTickCrystalResonance(ctx, dt);
  sgTickIceKing(ctx, dt);
  sgTickVoidAnnihilation(ctx, dt);
  sgTickSkyfallStars(ctx, dt);
}

/* 超神進化【地爆天星】：每隔一段時間，天空落下一顆超巨型殞石，
   對全場敵人依敵種扣掉一定比例的**最大生命**。
   節拍記在 SKILL2_RT.ultAuto（執行期，絕不入存檔），規則比照【天霸風神斬】：
     ・沒裝配在技能列就不生效
     ・不扣魔、不進冷卻——這不是一次施放，是超神進化的常駐節拍
   扣血走 sgDerivedHit：這是「直接扣掉 N% 生命」而不是一次攻擊，因此不過防禦與爆擊；
   高塔 BOSS 的單次扣血上限由 applyEnemyHpDamage 自動接手（設計的 BOSS -20% 正好同值）。 */
function sgStarfallArea(ctx, follow) {
  var centre = bfPos(ctx.pEnt) || bfPlayerPos();
  var area = { x: centre.x, y: centre.y, r: bfSpawnDist() };
  if (follow) area.follow = true;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  for (var i=0; area && i<enemies.length; i++) {
    var pos = bfPos(enemies[i]);
    if (pos && enemies[i].hp>0) area.r = Math.max(area.r, Math.hypot(pos.x-area.x,pos.y-area.y)+bfBodyRadius());
  }
  return area;
}
function sgTickStarfall(ctx, dt) {
  var u = sgUlt('fireball', 'starfallCataclysm');
  if (!u || !skills2Equipped('fireball')) {
    var old = SKILL2_RT.starfall;
    if (old) sgDropRoleBuffs(old.pEnt, ['starfall']);
    SKILL2_RT.starfall = null;
    return;
  }
  /* 死亡／倒地：整條排程與倒數狀態一起往後推，剩餘時間不變。
     倒數狀態是排程的投影，只推其中一邊會讓面板顯示與實際落下時刻對不上。 */
  if (skills2AutoCastBlocked(ctx.pEnt)) {
    var held = SKILL2_RT.starfall;
    if (held) {
      held.at = sgPauseSchedule(held.at, dt);
      var fallKeys = sgRoleKeys('starfall');
      for (var fk = 0; fk < fallKeys.length; fk++) {
        var buff = held.pEnt && held.pEnt.buffs && held.pEnt.buffs[fallKeys[fk]];
        if (buff && buff.until > 0) buff.until += Math.max(0, Number(dt) || 0);
      }
    }
    return;
  }
  /* 間隔至少要容得下預警：間隔被升級縮到比預警還短的話，黑影會來不及擴完就砸下來。 */
  var gap = Math.max(SG_STARFALL_WARN_SEC + 1, sgUltVal(u, 'gap'));
  var st = SKILL2_RT.starfall;
  // 第一次進場只起算節拍，不立刻砸——開戰瞬間白送一發不是設計的意思
  if (!st || !(st.at > 0)) { SKILL2_RT.starfall = sgStarfallSchedule(ctx, gap); return; }

  /* 落下前 SG_STARFALL_WARN_SEC 秒：地板黑影開始擴大到全場。 */
  if (!st.warned && GT >= st.at - SG_STARFALL_WARN_SEC) {
    st.warned = true;
    sgEmitPlayerVfx('fireball', ctx.floatSel, {
      fxKind: 'aura', variant: 'starfall-shadow', elem: 'fire',
      dur: Math.max(0.1, st.at - GT),
      area: sgStarfallArea(ctx, true),
      vfxUlt: 'starfallCataclysm',
      vfxRoles: { ground: sgVfxRoles('fireball', { vfxUlt: 'starfallCataclysm', vfxBase: true }).ground }
    });
    if (typeof floatPlayerEvent === 'function') floatPlayerEvent('pv-float', '地爆天星!', 'buff');
  }
  /* 殞石開始下墜：下墜時間已經是一般殞石的 SG_STARFALL_FALL_MULT 倍（＝速度一半）。
     顯示層要靠 travelMs 對齊落地時刻，因此這裡送的是「從現在到落地還有多久」。 */
  if (!st.dropped && GT >= st.at - st.fallSec) {
    st.dropped = true;
    sgEmitPlayerVfx('fireball', ctx.floatSel, {
      fxKind: 'rain', variant: 'meteor-starfall', elem: 'fire',
      dur: Math.max(0.1, st.at - GT), travelMs: Math.max(1, Math.round((st.at - GT) * 1000)),
      sizeMult: SG_STARFALL_SIZE_MULT,
      vfxUlt: 'starfallCataclysm',
      vfxRoles: { projectile: sgVfxRoles('fireball', { vfxUlt: 'starfallCataclysm', vfxBase: true }).projectile }
    });
  }
  if (GT < st.at) return;
  sgStarfallImpact(ctx, u);
  SKILL2_RT.starfall = sgStarfallSchedule(ctx, gap);
}

/* 排下一次落下，並把倒數投影成玩家身上的狀態——設計要求「可由該狀態看出下次落下時間」，
   因此狀態的剩餘時間就是權威顯示，數值本身沒有意義（比照【暴風化身】【火狩】的純計時狀態）。 */
function sgStarfallSchedule(ctx, gap) {
  var timing = sgMeteorFallTiming();
  if (ctx && ctx.pEnt && ctx.pEnt.hp > 0) {
    sgApplySlot(ctx.pEnt, 'fireball', 'starfallCataclysm', 'self', 0, { val: 0, dur: gap });
  }
  return {
    at: GT + gap,
    fallSec: timing.fallMs / 1000 * SG_STARFALL_FALL_MULT,
    warned: false, dropped: false,
    // 持有者：resetSkill2RT 要靠它把倒數狀態從實體上撤掉
    pEnt: (ctx && ctx.pEnt) || null
  };
}

/* 落地結算：對全場敵人依敵種扣掉最大生命的固定比例。 */
function sgStarfallImpact(ctx, u) {
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  var live = (typeof bfLiveList === 'function') ? bfLiveList(enemies) : (enemies || []);
  var victims = [];
  for (var i = 0; i < live.length; i++) if (live[i] && live[i].hp > 0) victims.push(live[i]);
  if (!victims.length) return;
  var normalPct = sgUltVal(u, 'normal');
  var elitePct = sgUltVal(u, 'elite');
  var bossPct = sgUltVal(u, 'boss');
  var roles = sgVfxRoles('fireball', { vfxUlt: 'starfallCataclysm', vfxBase: true });
  var trigger = sgVfxRoles('fireball', { vfxUlt: 'starfallCataclysm' });
  sgEmitPlayerVfx('fireball', ctx.floatSel, {
    fxKind: 'burst', variant: 'starfall-burst', elem: 'fire',
    area: sgStarfallArea(ctx), vfxRoles: { attack: trigger.attack }
  });
  var out = { killed: false, dmg: 0, crit: false };
  for (var v = 0; v < victims.length; v++) {
    var e = victims[v];
    sgEmitVfx('fireball', [e], ctx.floatSel, {
      fxKind: 'impact', variant: 'starfall-impact', elem: 'fire',
      vfxRoles: { hit: roles.hit }, preserveDeadTargets: true
    });
    // 敵種旗標沿用 monsterDefCfg 的同一組欄位（比照 sgIsNormalEnemy），不另建分類
    var pct = (e.isBoss || e.towerBoss) ? bossPct : (e.elite ? elitePct : normalPct);
    var amount = Math.max(0, Number(e.maxHp) || 0) * pct / 100;
    if (amount > 0) sgDerivedHit(e, amount, 'fireball', ctx.floatSel, out, '☄️', sgStaggerMs(v));
  }
  if (ctx.onDamage && out.dmg > 0) ctx.onDamage(out.dmg);
  if (out.killed && ctx.onDeaths) ctx.onDeaths();
}

/* 超神進化【天霸風神斬】：迴旋斬改為被動技能，每 N 秒自動施放 1 次。
   節拍記在 SKILL2_RT.ultAuto（執行期，絕不入存檔），寫法比照暴風之舞：
     ・沒裝配在技能列就不生效（與其他主動型被動同一條代價）
     ・暈眩中跳過該次，錯過的不補發
     ・法力不足就不觸發（比照反擊逐階扣魔的使用者決策）
   自動施放走 castSkill2 的正規路徑，因此扣魔、冷卻、傷害結算與手動施放完全一致。 */
function sgTickUltAutoCast(ctx, dt) {
  if (!SKILL2_RT.ultAuto) SKILL2_RT.ultAuto = {};
  var u = sgUlt('cleave', 'stormGodSlash');
  if (!u || !skills2Equipped('cleave')) { delete SKILL2_RT.ultAuto.cleave; return; }
  // 死亡／倒地：節拍往後推，剩餘時間不變（見 skills2AutoCastBlocked）
  if (skills2AutoCastBlocked(ctx.pEnt)) {
    SKILL2_RT.ultAuto.cleave = sgPauseSchedule(SKILL2_RT.ultAuto.cleave, dt);
    return;
  }
  var gap = Math.max(0.5, sgUltVal(u, 'sec'));
  var next = SKILL2_RT.ultAuto.cleave;
  if (!(next > 0)) { SKILL2_RT.ultAuto.cleave = GT + gap; return; }
  if (next > GT) return;
  SKILL2_RT.ultAuto.cleave = GT + gap;
  if (typeof effectActive === 'function' && effectActive(ctx.pEnt, 'stun')) return;
  var cost = skills2ManaCost('cleave');
  if (ctx.pEnt.mp < cost && !(typeof gmMpLockActive === 'function' && gmMpLockActive(ctx.pEnt))) return;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  var res = castSkill2(ctx.pEnt, enemies, 'cleave', ctx.floatSel);
  if (!res) return;
  if (ctx.onDamage) ctx.onDamage(res.dmg);
  if (res.killed && ctx.onDeaths) ctx.onDeaths();
}

/* 暴風之舞：每 gap 秒自動施放 1 次雙刀亂舞；每次作用時挑一個敵方目標衝過去，
   到達（可近戰）或目標死亡前不換目標。 */
function sgTickStorm(ctx, dt) {
  var stm = SKILL2_RT.storm;
  if (!stm) return;
  if (stm.until <= GT || skills2Levels('dualdance')[6] < 1) { SKILL2_RT.storm = null; return; }
  /* 死亡／倒地：連同化身的**剩餘時間**一起往後推，否則倒地那幾秒會白白吃掉化身時間，
     復活後還要面對一次補發的連續揮舞（見 skills2AutoCastBlocked）。 */
  if (skills2AutoCastBlocked(ctx.pEnt)) {
    stm.until = sgPauseSchedule(stm.until, dt);
    stm.nextAt = sgPauseSchedule(stm.nextAt, dt);
    return;
  }
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

var SG_BLOOD_DOT_ROLES = ['bleed', 'poison'];
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
    /* 流血／中毒以角色查詢：Skills2 第 1／4 階「敵方狀態」換成別的持續傷害，這裡跟著換。
       每跳的作用特效由 js/combat.js tickStatuses 依狀態表送出，這裡不另外畫。 */
    var roles = SG_BLOOD_DOT_ROLES;
    for (var si = 0; si < roles.length; si++) {
      var d = sgFindDot(e, sgRoleSids(roles[si]));
      if (!d) continue;
      if (!e._sgAcc) e._sgAcc = {};
      var acc = (e._sgAcc[roles[si]] || 0) + dt;
      var gap = Math.max(0.1, d.interval || 1);
      while (acc >= gap) {
        acc -= gap;
        // 毒霧感染：毒每次作用時，機率傳染給附近 count 個尚未中毒的敵人（複製剩餘時值）
        if (roles[si] === 'poison' && spreadLv > 0 && chance(sgVal(t[4].fx, 'chance', spreadLv))) {
          var spreadCount = Math.max(1, Math.floor(sgVal(t[4].fx, 'count', spreadLv)));
          // 「傳染給附近的 count 個敵人」沒有指定最近＝隨機（候選同原本＝整個戰場）
          var near = bfRandomOthers(e, enemies, enemies.length, 0, null);
          var spreaded = 0;
          for (var ni = 0; ni < near.length; ni++) {
            if (near[ni].hp > 0 && !sgHasDot(near[ni], sgRoleSids('poison')) && !(near[ni]._sgPoisonFlightUntil>GT)) {
              var poisonCopy={dps:d.dps,dur:Math.max(.2,d.until-GT),interval:gap};
              if(sgQueueBloodFlight(e,near[ni],{vfxTier:5},{poison:poisonCopy},ctx)) {
                spreaded++;
                if(spreaded>=spreadCount)break;
                continue;
              }
              sgEmitVfx('bloodblade', [e, near[ni]], ctx.floatSel, {
                fxKind: 'chain', variant: 'poison-spread', elem: 'poison', count: 1,
                vfxTier: 5
              });
              /* 毒霧感染也走共用塗抹：傳染同樣算「感染 1 個敵人」，要付【毒血祭】的生命代價。
                 複製已加速的間隔，不再次套用崩解。 */
              sgApplyBloodbladeDot(near[ni], 'poison',
                { dps: d.dps, dur: Math.max(0.2, d.until - GT), interval: gap },
                Math.max(0.2, d.until - GT),
                { enemies: enemies, floatSel: ctx.floatSel });
              near[ni]._sgDotSkipAt = GT;
              spreaded++;
              if (spreaded >= spreadCount) break;
            }
          }
        }
        // 零日感染：每次作用時，機率立即造成剩餘持續傷害並清除該狀態
        // 剩餘值含 tickStatuses 已累積、尚未跳出的殘額（d.acc 秒），與到期補跳的總量守恆一致
        if (zeroLv > 0 && chance(sgVal(t[6].fx, 'chance', zeroLv))) {
          var remain = Math.max(0, d.dps * ((d.until - GT) + (d.acc || 0)));
          if (remain > 0) {
            var zOut = { killed: false, dmg: 0, crit: false };
            sgDerivedHit(e, remain, 'bloodblade', ctx.floatSel, zOut, '💥', 0);
            var disintegrate = sgUlt('bloodblade', 'disintegrate');
            if (disintegrate) sgDisintegrate(e, d.sid, d, d.dur, disintegrate,
              { enemies: enemies, floatSel: ctx.floatSel, out: zOut });
            sgSpreadBloodbladeDots(e, enemies, getStats(), lvs, t);
            if (ctx.onDamage) ctx.onDamage(zOut.dmg);
            if (zOut.killed && ctx.onDeaths) ctx.onDeaths();
            sgEmitVfx('bloodblade', [e], ctx.floatSel, {
              fxKind: 'burst', variant: 'zero-infection', elem: 'poison',
              vfxTier: 7
            });
          }
          // 直接移除實例（剩餘值已立即生效；不走到期流程，避免補跳殘餘）
          var di2 = e.dots.indexOf(d);
          if (di2 >= 0) e.dots.splice(di2, 1);
          acc = 0;
          break;
        }
      }
      e._sgAcc[roles[si]] = acc;
    }
  }
}

/* ===========================================================================
   血刃斬的兩個「永久領域」（超神進化：殺神領域／萬毒血霧）
   ---------------------------------------------------------------------------
   本專案的三套場域（SKILL2_RT.grounds／orbits／SKILL_RT.fields）全部以剩餘段數或
   到期時間收斂，沒有任何永久物；把 hits 設成無限會多出一條沒有回收路徑的分支。
   因此永久領域**不建立實例**，改成每個節拍直接以玩家為圓心做一次幾何查詢：
   領域的權威就是超神進化本身；玩家身上代表領域的狀態（畫面＝狀態表的持續特效）
   由 sgSyncDomainStatus／sgEndDomainStatus 跟著它掛上與撤掉。
   兩者都要求血刃斬**裝配在技能列上**（比照主動型被動的代價）。
   =========================================================================== */

var SG_DOMAIN_VFX_SEC = 1;   // 岩甲光殼的重畫間隔（純顯示，與作用節拍無關）

function sgTickBloodDomains(ctx) {
  var rt = SKILL2_RT.bloodDomain;
  var venom = sgUlt('bloodblade', 'venomDomain');
  var slayer = sgUlt('bloodblade', 'slayerDomain');
  if (!skills2Equipped('bloodblade') || (!venom && !slayer)) {
    rt.venomAt = 0;
    sgEndDomainStatus('slayerDomain'); sgEndDomainStatus('venomDomain');
    return;
  }
  var radius = bfMeterPx(sgUltVal(venom || slayer, 'm'));
  /* 領域本身是玩家身上的永久狀態：範圍的畫面是它的「持續特效」（依領域半徑縮放、逐幀跟著玩家）。
     兩個領域三選一，換超神時撤掉另一個。 */
  sgSyncDomainStatus(ctx.pEnt, venom ? 'venomDomain' : 'slayerDomain', radius);
  sgEndDomainStatus(venom ? 'slayerDomain' : 'venomDomain');
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
    sgApplySlot(victims[i], 'bloodblade', 'venomDomain', 'enemy', 0, { dps: unit, dur: dur, interval: gap, maxStacks: maxStacks });
  }
  sgEmitVfx('bloodblade', victims, ctx.floatSel, { fxKind: 'curse', variant: 'poison', elem: 'poison', vfxUlt: 'venomDomain' });
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
  sgApplySlot(pEnt, 'bloodblade', 'slayerDomain', 'self', 0, {
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
   崩解仍保留持續狀態，可正常觸發這兩種死亡場域。 */
function sgBloodFieldsOnDeath(deadEnt) {
  var lg = sgLegend('bloodblade');
  var mist = lg.bloodPoisonMist, blood = lg.bloodMistField;
  if (!mist && !blood) return;
  var pEnt = sgCurrentPlayerEnt();
  var lvs = skills2Levels('bloodblade');
  if (!pEnt || !lvs || lvs[0] < 1 || typeof getStats !== 'function') return;
  var st = getStats();
  var baseVal = st.atk * sgVal(SKILLS2.bloodblade.tiers[0].fx, 'pct', lvs[0]) / 100;
  if (mist && sgHasDot(deadEnt, sgRoleSids('poison'))) {
    var gap = Math.max(0.1, Number(mist.gap) || 0.5);
    var sec = Math.max(gap, Number(mist.sec) || 3);
    sgSpawnGround(pEnt, st, 'bloodblade', {
      kind: 'poisonmist', tgt: deadEnt, floatSel: 'mv-float',
      radius: bfMeterPx(Number(mist.m) || 6),
      dmgVal: baseVal * (Number(mist.pct) || 0) / 100,
      hits: Math.max(1, Math.round(sec / gap)), gap: gap, hitElem: 'poison',
      vfxGid: 'mire', vfxTier: 3
    });
  }
  if (blood && sgHasDot(deadEnt, sgRoleSids('bleed'))) {
    var bgap = SG_BLOOD_MIST_GAP;
    var bsec = Math.max(bgap, Number(blood.sec) || 4);
    sgSpawnGround(pEnt, st, 'bloodblade', {
      kind: 'bloodmist', tgt: deadEnt, floatSel: 'mv-float',
      radius: bfMeterPx(Number(blood.m) || 6),
      dmgVal: 0, hits: Math.max(1, Math.round(bsec / bgap)), gap: bgap,
      vfxGid: 'mire', vfxTier: 1
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
  // 霸王拳獨立於狂怒週期；只有仍在生效的增益可獲得擊殺延時。
  var asura = sgUlt('bloodrage', 'asuraFist');
  var pEnt = sgCurrentPlayerEnt();
  if (asura && skills2Equipped('bloodrage') && pEnt && pEnt.hp > 0) {
    var sid = sgSlotSid('bloodrage', 'asuraFist', 'self', 0);
    var buff = pEnt.buffs && pEnt.buffs[sid];
    if (buff && buff.until > GT) {
      sgApplySlot(pEnt, 'bloodrage', 'asuraFist', 'self', 0, {
        val: sgUltVal(asura, 'pct'), dur: buff.until - GT + Math.max(0, sgUltVal(asura, 'killSec'))
      });
    }
  }
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
      sgApplySlot(rt.pEnt, 'bloodrage', '1', 'self', 0, {
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
  if (wg) {
    SKILL2_RT.warGod = { pEnt: rt.pEnt, drainPct: sgUltVal(wg, 'drain') };
    // 持續時間吃狀態表（設計為「持續到死亡為止」，由 resetSkill2RT 回收）
    sgApplySlot(rt.pEnt, 'bloodrage', 'warGodRoll', 'self', 0, {
      val: sgUltVal(wg, 'pct'),
      maxStacks: Math.max(1, Math.floor(sgUltVal(wg, 'maxStacks')))
    });
  }
}

/* 死亡屍爆：流血或中毒狀態的敵人死亡時爆炸，對附近敵人造成血刃斬技能傷害的一部分並傳染中毒。
   爆炸若再擊殺敵人，由 onFieldDeaths 的統一清算掃描接手（_rewarded 防重複）。 */
function sgDeathBoom(deadEnt, enemies) {
  var lvs = skills2Levels('bloodblade');
  if (lvs[5] < 1) return;
  if (!sgHasDot(deadEnt, sgRoleSids('bleed')) && !sgHasDot(deadEnt, sgRoleSids('poison'))) return;
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
  var poisonSpec = sgBloodbladeDotSpec(st, lvs, t, 'poison');
  var deadPoison = sgFindDot(deadEnt, sgRoleSids('poison'));
  var out = { killed: false, dmg: 0, crit: false };
  sgEmitVfx('bloodblade', [deadEnt], 'mv-float', {
    fxKind: 'burst', variant: 'blood-explosion', elem: 'poison',
    vfxTier: 6
  });
  for (var i = 0; i < victims.length; i++) {
    var victim = victims[i];
    sgHitOne(pEnt, st, victim, boomVal, 'bloodblade', 'mv-float', out, sgStaggerMs(i));
    if (victim.hp > 0) {
      // 屍爆固定傳染中毒；若死者本身帶毒則保留其剩餘強度與時間，否則用技能規格補上。
      sgApplyBloodbladeDot(victim, 'poison', deadPoison || poisonSpec,
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
