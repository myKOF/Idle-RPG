'use strict';
/* ============ 新版主動技能系統（2026-08-13 技能改造第一批） ============
   設計來源：神力之巔_記事錄.xlsx「技能」頁籤。
   6 個技能群組 × 7 階：同群組在前端顯示為「同一個技能」，玩家裝配群組後，
   透過升級各階持續強化該技能的效果（階＝效果模組，不是獨立技能）。

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

/* ---- 群組定義表（撥離：config/CSV/Skills2.csv → 本字面值） ----
   群組欄位：name 名稱／emoji 圖標／cd 冷卻秒數／cost 施法法力消耗
   階欄位：name 階段名稱／fx 效果參數／goldBase 升級金幣基數／goldGrow 升級金幣倍率
           （升級至下一級費用＝goldBase × goldGrow^目前等級，取整）／desc 效果說明模板
   fx 參數命名慣例：<鍵> 為 Lv.1 基準值、<鍵>Per 為每級增量（值＝基準 + 增量×(等級-1)）。
   desc 內的 {鍵} 於顯示時代入目前等級的計算值。 */
var SKILLS2 = {
  thrust: { name: '突刺', emoji: '🗡️', cd: 5, cost: 25, tiers: [{ name: '突刺', fx: { pct: 300, pctPer: 30 }, goldBase: 100000, goldGrow: 1.5, desc: '對敵人造成 1 次 {pct}% 物理傷害' }, { name: '連刺', fx: { chance: 10, chancePer: 5 }, goldBase: 200000, goldGrow: 1.5, desc: '有 {chance}% 的機率造成 2 次突刺' }, { name: '傷害強化', fx: { pct: 30, pctPer: 10 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化突刺傷害，額外 +{pct}% 物理傷害（與第 1 階累加）' }, { name: '超連刺', fx: { add: 1, addPer: 0.25 }, goldBase: 800000, goldGrow: 1.5, desc: '突刺次數額外 +{add} 次（不足 1 次的部分以機率觸發）' }, { name: '擴散', fx: { pct: 20, pctPer: 5, count: 2 }, goldBase: 1500000, goldGrow: 1.5, desc: '突刺造成的傷害有 {pct}% 會擴散至周圍的 {count} 個敵人' }, { name: '貫穿突刺', fx: { m: 7, mPer: 0.5 }, goldBase: 3000000, goldGrow: 1.5, desc: '突刺造成一直線傷害，貫穿路徑上所有敵人，貫穿距離 {m} 米' }, { name: '終極突刺', fx: { pct: 10, pctPer: 5, deg: 30 }, goldBase: 5000000, goldGrow: 1.5, desc: '向 3 個方向（正前與左右各 {deg} 度）同時突刺，且物理傷害額外 +{pct}%' }] },
  cleave: { name: '迴旋斬', emoji: '🪓', cd: 8, cost: 30, tiers: [{ name: '迴旋斬', fx: { pct: 200, pctPer: 20, count: 3 }, goldBase: 100000, goldGrow: 1.5, desc: '對前方 {count} 個敵人造成 1 次 {pct}% 物理傷害' }, { name: '強化斬', fx: { add: 1, addPer: 0.5 }, goldBase: 200000, goldGrow: 1.5, desc: '斬擊的敵人數量額外 +{add} 個（不足 1 個的部分以機率觸發）' }, { name: '傷害強化', fx: { pct: 20, pctPer: 8 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化斬擊傷害，額外 +{pct}% 物理傷害' }, { name: '連斬', fx: { chance: 25, chancePer: 2.5, times: 2, timesPer: 0.25 }, goldBase: 800000, goldGrow: 1.5, desc: '斬擊時有 {chance}% 機率連續劈出共 {times} 次斬擊（不足 1 次的部分以機率觸發）' }, { name: '暈眩擊', fx: { chance: 25, chancePer: 1, sec: 1, secPer: 0.1 }, goldBase: 1500000, goldGrow: 1.5, desc: '斬擊時有 {chance}% 機率擊暈敵人 {sec} 秒' }, { name: '震碎斬', fx: { m: 12, mPer: 0.5 }, goldBase: 3000000, goldGrow: 1.5, desc: '斬擊會向前飛出 {m} 米距離，命中路徑上的敵人' }, { name: '迴身雙連斬', fx: { pct: 10, pctPer: 5 }, goldBase: 5000000, goldGrow: 1.5, desc: '同時朝後方 180 度使出順劈斬，且物理傷害額外 +{pct}%' }] },
  knife: { name: '飛刀', emoji: '🔪', cd: 4, cost: 28, tiers: [{ name: '飛刀', fx: { pct: 250, pctPer: 25, count: 3, deg: 60 }, goldBase: 100000, goldGrow: 1.5, desc: '朝前方 {deg} 度扇形內丟出 {count} 把飛刀，每把造成 {pct}% 物理傷害' }, { name: '強化飛刀', fx: { pct: 20, pctPer: 10 }, goldBase: 200000, goldGrow: 1.5, desc: '飛刀傷害進一步提升，額外 +{pct}% 物理傷害' }, { name: '彈射飛刀', fx: { pct: 30, pctPer: 5, count: 1 }, goldBase: 400000, goldGrow: 1.5, desc: '每把飛刀會在附近的 {count} 個敵人間彈跳，每次彈射造成 {pct}% 技能傷害' }, { name: '強化彈射', fx: { add: 1, addPer: 0.25 }, goldBase: 800000, goldGrow: 1.5, desc: '飛刀彈射的敵人數量額外 +{add}（不足 1 次的部分以機率觸發）' }, { name: '迴旋飛刀', fx: { count: 5, countPer: 0.25 }, goldBase: 1500000, goldGrow: 1.5, desc: '改為向周圍的 {count} 個敵人丟出飛刀（全圓形範圍鎖敵；不足 1 個的部分以機率觸發）' }, { name: '連鎖彈射', fx: { chance: 20, chancePer: 2, max: 4 }, goldBase: 3000000, goldGrow: 1.5, desc: '飛刀彈射後有 {chance}% 機率再次彈射，最多連續 {max} 次' }, { name: '神速飛刀', fx: { sec: 0.1, secPer: 0.02 }, goldBase: 5000000, goldGrow: 1.5, desc: '每把飛刀（含彈射）爆擊時，使本技能冷卻時間 -{sec} 秒' }] },
  gale: { name: '疾風斬', emoji: '💨', cd: 6, cost: 30, tiers: [{ name: '疾風斬', fx: { pct: 250, pctPer: 20, hits: 2 }, goldBase: 100000, goldGrow: 1.5, desc: '對敵人造成連續 {hits} 次 {pct}% 物理傷害（同一目標）' }, { name: '疾風連斬', fx: { add: 1, addPer: 0.2 }, goldBase: 200000, goldGrow: 1.5, desc: '斬擊次數額外 +{add}（不足 1 次的部分以機率觸發）' }, { name: '強化斬擊', fx: { pct: 15, pctPer: 4 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化斬擊傷害，額外 +{pct}% 物理傷害' }, { name: '擴散', fx: { pct: 50, pctPer: 5, m: 10 }, goldBase: 800000, goldGrow: 1.5, desc: '每次斬擊額外對 {m} 米內最近的 1 個敵人造成 {pct}% 技能傷害；附近沒有敵人時改對原目標造成' }, { name: '狂風斬', fx: { pct: 20, pctPer: 5, sec: 5 }, goldBase: 1500000, goldGrow: 1.5, desc: '施放疾風斬使你的攻速額外提高 {pct}%，持續 {sec} 秒（突破攻速上限，與自身攻速相乘）' }, { name: '極速斬', fx: { sec: 1, secPer: 0.3 }, goldBase: 3000000, goldGrow: 1.5, desc: '疾風斬的冷卻時間 -{sec} 秒' }, { name: '超神斬', fx: { pct: 200, pctPer: 20, m: 5 }, goldBase: 5000000, goldGrow: 1.5, desc: '疾風斬的傷害由目標周圍 {m} 米內的所有敵人均分，且傷害額外 +{pct}%' }] },
  bloodblade: { name: '血刃斬', emoji: '🩸', cd: 8, cost: 40, tiers: [{ name: '血刃斬', fx: { pct: 200, pctPer: 15, dotPct: 30, dotSec: 5, dotGap: 1 }, goldBase: 100000, goldGrow: 1.5, desc: '對敵人造成 1 次 {pct}% 物理傷害，並附加流血：每 {dotGap} 秒造成技能傷害 {dotPct}% 的傷害，持續 {dotSec} 秒' }, { name: '強化流血', fx: { sec: 0.5, secPer: 0.1, gapPct: 10, gapPctPer: 1.5 }, goldBase: 200000, goldGrow: 1.5, desc: '流血持續時間 +{sec} 秒，且流血作用間隔縮短 {gapPct}%（跳得更快、總傷更高）' }, { name: '虛弱', fx: { pct: 10, pctPer: 2 }, goldBase: 400000, goldGrow: 1.5, desc: '流血中的敵人受到的傷害提高 {pct}%' }, { name: '血毒刃', fx: { dotPct: 25, dotPctPer: 3, dotSec: 4, dotGap: 0.5 }, goldBase: 800000, goldGrow: 1.5, desc: '敵人流血的同時也會中毒：每 {dotGap} 秒造成技能傷害 {dotPct}% 的毒屬性傷害，持續 {dotSec} 秒' }, { name: '毒霧感染', fx: { chance: 10, chancePer: 1 }, goldBase: 1500000, goldGrow: 1.5, desc: '血毒刃的毒在每次作用時，有 {chance}% 機率傳染給附近的 1 個敵人' }, { name: '死亡屍爆', fx: { pct: 50, pctPer: 5, count: 2 }, goldBase: 3000000, goldGrow: 1.5, desc: '流血或中毒狀態的敵人死亡時爆炸，對附近 {count} 個敵人造成 {pct}% 技能傷害' }, { name: '零日感染', fx: { chance: 20, chancePer: 2, pct: 20, pctPer: 2 }, goldBase: 5000000, goldGrow: 1.5, desc: '流血與中毒在每次作用時有 {chance}% 機率立即造成剩餘的持續傷害並清除該狀態，且流血與中毒傷害 +{pct}%' }] },
  dualdance: { name: '雙刀亂舞', emoji: '⚔️', cd: 10, cost: 35, tiers: [{ name: '雙刀亂舞', fx: { pct: 300, pctPer: 25, count: 2 }, goldBase: 100000, goldGrow: 1.5, desc: '對附近 {count} 個敵人各造成 1 次 {pct}% 物理傷害（只有 1 個敵人時全部打向同一目標）' }, { name: '疾風亂舞', fx: { add: 1, addPer: 0.2 }, goldBase: 200000, goldGrow: 1.5, desc: '額外攻擊附近 {add} 個敵人（不足 1 個的部分以機率觸發）' }, { name: '強化雙刀', fx: { pct: 25, pctPer: 5 }, goldBase: 400000, goldGrow: 1.5, desc: '進一步強化雙刀傷害，額外 +{pct}% 物理傷害' }, { name: '狂暴之舞', fx: { cr: 50, crPer: 10, cd: 200, cdPer: 40, sec: 6 }, goldBase: 800000, goldGrow: 1.5, desc: '施放後爆擊率 +{cr}%、爆擊傷害 +{cd}%，持續 {sec} 秒' }, { name: '鐵血之舞', fx: { pct: 3.5, pctPer: 0.35, sec: 3, gap: 0.35, m: 5 }, goldBase: 1500000, goldGrow: 1.5, desc: '施放時使你與 {m} 米內的所有敵人流血：每 {gap} 秒造成最大生命 {pct}% 的傷害，持續 {sec} 秒（自身流血直接扣生命，無法被護盾吸收）' }, { name: '嗜血狂化', fx: { pct: 2, pctPer: 0.2 }, goldBase: 3000000, goldGrow: 1.5, desc: '施放時生命值或護盾每減少 1%，本次技能傷害提升 {pct}%（無護盾時視為護盾 -100%）' }, { name: '暴風之舞', fx: { sec: 3, secPer: 0.3, gap: 0.35 }, goldBase: 5000000, goldGrow: 1.5, desc: '化身暴風在敵人間穿梭 {sec} 秒：每 {gap} 秒自動施放 1 次雙刀亂舞；期間無法普攻但可施放技能' }] }
};

/* ---- 執行期狀態（絕不掛 G＝保證不入存檔） ----
   由 js/skills.js 的 resetSkillRT() 鏈結重置（比照 resetLegendaryRT），
   重置時機（開戰／死亡／讀檔／塔戰進出）與舊系統完全一致。 */
var SKILL2_RT = null;
function resetSkill2RT() {
  SKILL2_RT = {
    storm: null // 暴風之舞化身狀態：{ until, nextAt, gap, tgt }（tgt 為當前衝鋒目標實體）
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

/* fx 參數在指定等級的值：<鍵> + <鍵>Per ×（等級-1）。等級至少以 1 計。 */
function sgVal(fx, key, lv) {
  return (Number(fx[key]) || 0) + (Number(fx[key + 'Per']) || 0) * (Math.max(1, Number(lv) || 1) - 1);
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

/* 狂風斬（疾風斬第 5 階）攻速乘算因子：突破攻速上限、與自身攻速相乘。
   掛點：combat.js／tower.js 的普攻頻率乘算區（potentialVelocityFactor 旁）。 */
function skill2AspdFactor(pEnt) {
  if (typeof buffVal !== 'function') return 1;
  return 1 + Math.max(0, buffVal(pEnt, 'sgGale')) / 100;
}

/* 暴風之舞化身中：無法普攻（可施放技能）。掛點：combat.js／tower.js 普攻閘門。 */
function skill2StormActive() {
  return !!(SKILL2_RT && SKILL2_RT.storm && SKILL2_RT.storm.until > GT);
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

/* 物理攻擊組態（比照 castSkill 的技能傷害段規格：命中地板 100、含裝備元素攻擊、
   神鑄被動與敵種加成；另計本系統的狂暴爆擊增益與虛弱增傷）。 */
function sgAtkCfg(pEnt, st, dmgVal, target, bonusTotalPct) {
  var aCfg = {
    atk: dmgVal, dmgType: 'phys', level: st.level,
    critRate: st.critRate + (typeof buffVal === 'function' ? buffVal(pEnt, 'sgCritUp') : 0),
    critDmg: st.critDmg + (typeof buffVal === 'function' ? buffVal(pEnt, 'sgCritDmgUp') : 0),
    hit: Math.max(100, st.hit),
    pen: (typeof effectivePPen === 'function') ? effectivePPen(st, pEnt) : 0,
    sunder: (st.passives && st.passives.sunder) || 0,
    trueDmgPct: (st.passives && st.passives.trueDmg) || 0,
    annihilate: (st.passives && st.passives.annihilate) || 0,
    elemAtk: st.elemAtk || null, elemDmgPct: st.elemDmgPct,
    elemDmgUp: (typeof legendaryElementDamageUp === 'function') ? legendaryElementDamageUp(st, pEnt) : st.elemDmgUp,
    eliteDmg: st.eliteDmg, bossDmg: st.bossDmg, normalDmg: st.normalDmg,
    totalDmgPct: (st.totalDmgPct || 0) + (typeof buffVal === 'function' ? buffVal(pEnt, 'allDmgUp') : 0) + (bonusTotalPct || 0),
    dmgVsElem: st.dmgVsElem,
    isPlayer: true
  };
  return skill2VulnACfg(aCfg, target);
}

/* 一次獨立命中（走完整 resolveHit 傷害管線：防禦、爆擊、格擋、護盾、敵種倍率）。
   回傳 resolveHit 結果；同時記錄浮字／DPS／輸出統計並更新 out。 */
function sgHitOne(pEnt, st, target, dmgVal, gid, floatSel, out, delayMs, bonusTotalPct) {
  if (!target || target.hp <= 0 || !(dmgVal > 0)) return null;
  var g = SKILLS2[gid];
  var res = resolveHit(pEnt, target, sgAtkCfg(pEnt, st, dmgVal, target, bonusTotalPct), monsterDefCfg(target));
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
  var dealt = applyEnemyHpDamage(target, Math.max(1, Math.round(amount)));
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
  var spec = {
    fxKind: (extra && extra.fxKind) || 'slash',
    glyph: g.emoji,
    color: (typeof VFX_CAT_COLORS !== 'undefined' && VFX_CAT_COLORS.phys) || '#f97316',
    cat: 'phys', elem: (extra && extra.elem) || null,
    targets: ids, area: (extra && extra.area) || null,
    dur: (extra && extra.dur) || 0.5,
    count: Math.max(1, Math.min(5, (extra && extra.count) || 1))
  };
  if (extra && extra.variant) spec.variant = extra.variant;
  if (extra && extra.travelMs) spec.travelMs = extra.travelMs;
  playCombatVfx(spec);
}

var SG_HIT_STAGGER_SEC_FALLBACK = 0.09;
function sgStaggerMs(hitIndex) {
  var s = (typeof VFX_HIT_STAGGER_SEC === 'number') ? VFX_HIT_STAGGER_SEC : SG_HIT_STAGGER_SEC_FALLBACK;
  return Math.round(Math.max(0, hitIndex || 0) * s * 1000);
}

/* ---- 施放總入口 ----
   pEnt 玩家戰鬥實體、target 為敵人陣列（野外）或單一實體（高塔）、gid 群組 id。
   opts.storm＝暴風之舞自動施放（不扣魔、不進自身冷卻、不重複觸發暴風）。
   回傳 { killed, dmg, crit } 或 null（無法施放）。 */
function castSkill2(pEnt, target, gid, floatSel, opts) {
  var g = SKILLS2[gid];
  if (!g || !skills2Castable(gid)) return null;
  var st = getStats();
  var lvs = skills2Levels(gid);
  var storm = !!(opts && opts.storm);
  var rawPool = Array.isArray(target)
    ? target.filter(function (e) { return e && e.hp > 0; })
    : ((target && target.hp > 0) ? [target] : []);
  /* 所有新版主動技能都以普攻近戰距離起手；但 pool 必須保留完整敵群，讓
     貫穿 7 米、範圍擴散與周圍敵人等階段仍能命中近戰線段外的目標。 */
  if (!rawPool.length) return null;
  var reachable = rawPool.filter(function (e) {
    return typeof bfPlayerCanReach !== 'function' || bfPlayerCanReach(e);
  });
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
    default: return null;
  }
  if (!storm && typeof floatPlayerSkillCast === 'function') {
    floatPlayerSkillCast(floatSel, { emoji: g.emoji, name: g.name }, out.dmg);
  }
  if (typeof blog === 'function' && !storm) {
    blog(g.emoji + ' 你施放【' + g.name + ' Lv.' + sgTotalLevel(lvs) + '】，造成 ' + fmt(out.dmg) + ' 傷害');
  }
  return out;
}

/* ---- 突刺 ---- */
function sgCastThrust(pEnt, st, g, lvs, pool, primary, floatSel, out) {
  var t = g.tiers;
  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  if (lvs[2] > 0) pct += sgVal(t[2].fx, 'pct', lvs[2]);
  if (lvs[6] > 0) pct += sgVal(t[6].fx, 'pct', lvs[6]);
  var reps = 1 + (lvs[3] > 0 ? sgRollCount(sgVal(t[3].fx, 'add', lvs[3])) : 0);
  if (lvs[1] > 0 && chance(sgVal(t[1].fx, 'chance', lvs[1]))) reps *= 2;
  var dmgVal = st.atk * pct / 100;
  var baseAngle = (typeof bfAngleTo === 'function') ? bfAngleTo(primary) : null;
  var geomOk = baseAngle !== null;
  var pierceLen = lvs[5] > 0 ? bfMeterPx(sgVal(t[5].fx, 'm', lvs[5])) : 0;
  var dirs = [0];
  if (lvs[6] > 0 && geomOk) {
    var dg = (Number(t[6].fx.deg) || 30) * Math.PI / 180;
    dirs = [0, -dg, dg];
  }
  var lineLen = pierceLen > 0 ? pierceLen : bfMeterPx(BF_MELEE_METERS);
  var planned = [primary];
  if (geomOk && (pierceLen > 0 || dirs.length > 1)) {
    for (var pdi = 0; pdi < dirs.length; pdi++) {
      var preview = bfLineTargets(baseAngle + dirs[pdi], lineLen, pool);
      for (var pti = 0; pti < preview.length; pti++) {
        if (planned.indexOf(preview[pti]) < 0) planned.push(preview[pti]);
      }
    }
  }
  var thrustVariant = dirs.length > 1 ? 'thrust-triple' : (pierceLen > 0 ? 'thrust-pierce' : 'thrust');
  sgEmitVfx('thrust', planned, floatSel, {
    fxKind: 'slash', variant: thrustVariant, count: Math.min(5, reps)
  });
  var hitIdx = 0;
  for (var r = 0; r < reps; r++) {
    for (var di = 0; di < dirs.length; di++) {
      var hitTargets;
      if (geomOk && (pierceLen > 0 || dirs.length > 1)) {
        hitTargets = bfLineTargets(baseAngle + dirs[di], lineLen, pool);
        // 主方向保證命中主目標（突刺為指向性技能，不做距離落空）
        if (di === 0 && primary.hp > 0 && hitTargets.indexOf(primary) < 0) hitTargets.unshift(primary);
      } else {
        hitTargets = [primary];
      }
      for (var ti = 0; ti < hitTargets.length; ti++) {
        var res = sgHitOne(pEnt, st, hitTargets[ti], dmgVal, 'thrust', floatSel, out, sgStaggerMs(hitIdx));
        if (res && !res.miss && lvs[4] > 0) {
          var spreadPct = sgVal(t[4].fx, 'pct', lvs[4]);
          var others = bfNearestOthers(hitTargets[ti], pool, Math.max(1, Math.floor(Number(t[4].fx.count) || 2)));
          for (var oi = 0; oi < others.length; oi++) {
            sgDerivedHit(others[oi], res.dmg * spreadPct / 100, 'thrust', floatSel, out, g.emoji, sgStaggerMs(hitIdx + 1));
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
  var geomOk = (typeof bfPos === 'function') && !!bfPos(primary);
  var baseAngle = geomOk ? bfAngleTo(primary) : null;

  // 前方目標：主目標＋離主目標最近的其他敵人
  var targets = [primary].concat(bfNearestOthers(primary, pool, count - 1));
  // 震碎斬：斬擊向前飛出，聯集路徑上的敵人
  if (lvs[5] > 0 && geomOk) {
    var line = bfLineTargets(baseAngle, bfMeterPx(sgVal(t[5].fx, 'm', lvs[5])), pool);
    for (var li = 0; li < line.length; li++) if (targets.indexOf(line[li]) < 0) targets.push(line[li]);
  }
  // 迴身雙連斬：朝後方 180 度同時斬出
  if (lvs[6] > 0 && geomOk) {
    var back = bfConeTargets(baseAngle + Math.PI, 180, 0, pool);
    for (var bi = 0; bi < back.length && bi < count; bi++) {
      if (targets.indexOf(back[bi]) < 0) targets.push(back[bi]);
    }
  }
  var cleaveVariant = (lvs[5] > 0 && lvs[6] > 0) ? 'cleave-dual'
    : (lvs[5] > 0 ? 'cleave-shockwave' : (lvs[6] > 0 ? 'cleave-back' : 'cleave'));
  sgEmitVfx('cleave', targets, floatSel, {
    fxKind: 'slash', variant: cleaveVariant, count: Math.min(5, slashes)
  });
  var stunChance = lvs[4] > 0 ? sgVal(t[4].fx, 'chance', lvs[4]) : 0;
  var stunSec = lvs[4] > 0 ? sgVal(t[4].fx, 'sec', lvs[4]) : 0;
  for (var s = 0; s < slashes; s++) {
    for (var ti = 0; ti < targets.length; ti++) {
      var res = sgHitOne(pEnt, st, targets[ti], dmgVal, 'cleave', floatSel, out, sgStaggerMs(s));
      // 暈眩擊：每次命中獨立判定（BOSS 免疫與控場遞減由低階寫入器負責）
      if (res && !res.miss && stunChance > 0 && chance(stunChance)) {
        if (!(typeof isBossControlImmune === 'function' && isBossControlImmune(targets[ti])) &&
            !(typeof resistCtrl === 'function' && resistCtrl(monsterDefCfg(targets[ti])))) {
          applyStatus(targets[ti], 'stun', { dur: stunSec });
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
      if (!next || next.hp <= 0) break;
      visited.push(next);
      sgEmitVfx('knife', [cur, next], floatSel, {
        fxKind: 'chain', variant: 'knife-bounce', count: 1,
        travelMs: [0, (typeof bfTravelSeconds === 'function')
          ? Math.round(bfTravelSeconds(next) * 1000) : 0]
      });
      var bres = sgHitOne(pEnt, st, next, dmgVal * bouncePct / 100, 'knife', floatSel, out,
        delay + sgStaggerMs(b));
      if (bres && bres.crit) onCrit();
      cur = next;
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
  var pct = sgVal(t[0].fx, 'pct', lvs[0]);
  var baseVal = st.atk * pct / 100;
  sgEmitVfx('bloodblade', [primary], floatSel, { fxKind: 'slash' });
  var res = sgHitOne(pEnt, st, primary, baseVal, 'bloodblade', floatSel, out, 0);
  if (!res || res.miss || primary.hp <= 0) return;

  var zeroBonus = lvs[6] > 0 ? 1 + sgVal(t[6].fx, 'pct', lvs[6]) / 100 : 1;
  // 流血：每 dotGap 秒造成技能傷害 dotPct% 的傷害
  var bleedGap = Math.max(0.1, (Number(t[0].fx.dotGap) || 1) *
    (1 - (lvs[1] > 0 ? sgVal(t[1].fx, 'gapPct', lvs[1]) : 0) / 100));
  var bleedDur = (Number(t[0].fx.dotSec) || 5) + (lvs[1] > 0 ? sgVal(t[1].fx, 'sec', lvs[1]) : 0);
  var bleedTick = baseVal * sgVal(t[0].fx, 'dotPct', lvs[0]) / 100 * zeroBonus;
  applyStatus(primary, 'sgBleed', { dps: bleedTick / bleedGap, dur: bleedDur, interval: bleedGap });
  sgEmitVfx('bloodblade', [primary], floatSel, { fxKind: 'curse', variant: 'bleed' });

  // 血毒刃：流血的同時中毒（毒屬性）
  if (lvs[3] > 0) {
    var pGap = Math.max(0.1, Number(t[3].fx.dotGap) || 0.5);
    var pTick = baseVal * sgVal(t[3].fx, 'dotPct', lvs[3]) / 100 * zeroBonus;
    applyStatus(primary, 'sgPoison', { dps: pTick / pGap, dur: Number(t[3].fx.dotSec) || 4, interval: pGap });
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
  // 嗜血狂化：生命／護盾每減少 1% → 本次技能傷害提升該階數值%（生命與護盾損失百分比相加）
  if (lvs[5] > 0) {
    var hpLost = Math.max(0, 1 - pEnt.hp / Math.max(1, st.hp)) * 100;
    var shieldLost = (pEnt.shieldMax > 0) ? Math.max(0, 1 - (pEnt.shield || 0) / pEnt.shieldMax) * 100 : 100;
    dmgVal *= 1 + (hpLost + shieldLost) * sgVal(t[5].fx, 'pct', lvs[5]) / 100;
  }
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
  // 狂暴之舞：爆擊率＋爆擊傷害增益
  if (lvs[3] > 0) {
    var frenzyDur = Number(t[3].fx.sec) || 6;
    applyStatus(pEnt, 'sgFrenzyCr', { val: sgVal(t[3].fx, 'cr', lvs[3]), dur: frenzyDur });
    applyStatus(pEnt, 'sgFrenzyCd', { val: sgVal(t[3].fx, 'cd', lvs[3]), dur: frenzyDur });
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

/* ===========================================================================
   每 tick 排程（由 js/skills.js tickSkillSchedulers 末端鏈結呼叫，
   野外與高塔兩處鏡射掛點自然生效；必須在空場提前返回之前執行）
   ctx = { pEnt, getEnemies(), floatSel, onDeaths, onDamage? }
   =========================================================================== */
function tickSkill2(dt, ctx) {
  if (!SKILL2_RT || !ctx || !ctx.pEnt) return;
  sgTickStorm(ctx);
  sgTickBloodDots(dt, ctx);
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
   隨實體自然回收），不去改動 tickStatuses 的通用結算。 */
function sgTickBloodDots(dt, ctx) {
  var lvs = skills2Levels('bloodblade');
  var spreadLv = lvs[4], zeroLv = lvs[6];
  if (spreadLv < 1 && zeroLv < 1) return;
  var t = SKILLS2.bloodblade.tiers;
  var enemies = ctx.getEnemies ? ctx.getEnemies() : [];
  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i];
    if (!e || e.hp <= 0) continue;
    var sids = ['sgBleed', 'sgPoison'];
    for (var si = 0; si < sids.length; si++) {
      var d = sgFindDot(e, sids[si]);
      if (!d) continue;
      if (!e._sgAcc) e._sgAcc = {};
      var acc = (e._sgAcc[sids[si]] || 0) + dt;
      var gap = Math.max(0.1, d.interval || 1);
      while (acc >= gap) {
        acc -= gap;
        // 毒霧感染：毒每次作用時，機率傳染給附近 1 個尚未中毒的敵人（複製剩餘時值）
        if (sids[si] === 'sgPoison' && spreadLv > 0 && chance(sgVal(t[4].fx, 'chance', spreadLv))) {
          var near = bfNearestOthers(e, enemies, enemies.length);
          for (var ni = 0; ni < near.length; ni++) {
            if (near[ni].hp > 0 && !sgHasDot(near[ni], 'sgPoison')) {
              sgEmitVfx('bloodblade', [e, near[ni]], ctx.floatSel, {
                fxKind: 'chain', variant: 'poison-spread', elem: 'poison', count: 1
              });
              applyStatus(near[ni], 'sgPoison', { dps: d.dps, dur: Math.max(0.2, d.until - GT), interval: gap });
              break;
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

/* ---- 敵人死亡掛勾（js/skills.js skillRtOnEnemyDeath 末端鏈結，野外擊殺時呼叫）----
   死亡屍爆：流血或中毒狀態的敵人死亡時爆炸，對附近敵人造成血刃斬技能傷害的一部分。
   爆炸若再擊殺敵人，由 onFieldDeaths 的統一清算掃描接手（_rewarded 防重複）。 */
function skills2OnEnemyDeath(deadEnt, enemies) {
  if (!SKILL2_RT || !deadEnt) return;
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
  var out = { killed: false, dmg: 0, crit: false };
  sgEmitVfx('bloodblade', [deadEnt], 'mv-float', {
    fxKind: 'burst', variant: 'blood-explosion', elem: 'poison'
  });
  for (var i = 0; i < victims.length; i++) {
    sgHitOne(pEnt, st, victims[i], boomVal, 'bloodblade', 'mv-float', out, sgStaggerMs(i));
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
