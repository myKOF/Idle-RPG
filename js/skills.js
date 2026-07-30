'use strict';
/* ============ 技能系統 ============
   - 主動技能：消耗 MP、依強度有冷卻（受 CDR 影響），戰鬥中依裝載順序自動施放
   - 被動技能：學會即永久生效（計入屬性）
   - 學習/升級：轉生前每升 1 級獲得 1 技能點；轉生後改獲得轉生天賦點，上限隨轉生提高 */

/* 技能數值公式（loadoutSize、
   skillUpgradeCost、skillMaxLv、skillValue、skillCdFor、scaleAt、
   融合參數 FUSE_FACTOR / FUSION_MUTATION_CHANCE 等）→ js/formula.js §9 */

/* ============ 45 新技能 × 11 機制族：共用執行期狀態 SKILL_RT ============
   玩家側新戰鬥狀態一律放這個「模組級」物件（比照 skillCds 慣例，絕不掛在 G 上＝保證不入存檔）；
   敵人側印記等狀態掛敵人實體（純 JSON 資料、until 時戳自然過期）；
   時間基準沿用 applyBuff/applyDot 同一時鐘 GT（js/util.js 遊戲時鐘，秒）。
   欄位一律由 resetSkillRT() 重建，戰鬥/關卡切換與讀檔進入點呼叫（比照 skillCds 重置位置）。 */
var SKILL_RT = null;
function resetSkillRT() {
  SKILL_RT = {
    amps: [],         // skillAmp 族：{scope,pct,until,uses,refundPct,perCdSec,cap,cdrPct,srcId} 待消耗增幅清單
    charges: {},      // stackCharge 族：name → {stacks,max,until,burst,srcId} 疊層狀態
    echoQueue: [],    // echo/procCast 族：{at,resolve} 延遲結算佇列（at=GT 時戳，到期由 tickSkillSchedulers 出列）
    fields: [],       // periodicField 族：{name,until,tickSec,nextAt,onTick,onExpire,elem,takenAmpPct,cellSet,snapshot} 領域清單
    dmgWindows: [],   // echo 傷害快照窗：{until,pct,acc,resolve}（窗內玩家全部傷害累計、期滿一次轟出）
    healWindows: [],  // healEcho 治療回響窗：{until,pct,acc,resolve}（窗內所受傷害累計、期滿回療）
    nthCastCount: 0,  // freeCast 族（零式節律/passiveNthFree）：技能施放計數
    recentBest: [],   // procCast replayBest：最近技能施放傷害快照 [{id,lv,dmg,at}]（保留 REPLAY_BEST_TRACK_SEC 秒、至多 RECENT_BEST_MAX_ENTRIES 筆）
    icd: {},          // 各觸發內部冷卻：key → 下次可觸發的 GT 時戳（擊殺類觸發皆須設 icd）
    combo: null,      // skillAmp comboWindow 連段窗：{until,pct,count}（斷檔失效）
    feedback: null,   // passiveDefFeedback 守勢反哺：{stacks,until,srcId}
    stigma: null,     // brand stigmaCycle 聖痕輪迴：{stored,cap,until}（儲所受傷、引爆換真傷＋護盾）
    freeCasts: null,  // freeCast freeNext/flowSurge：{count,until,scope,ampPct,noGcd,cdHalf}
    overhealWin: null // resourceConvert 溢流聖罰 M4 轉傷窗：{until,pct}（窗內其他治療技的溢出比照轉真傷）
  };
  if (typeof resetLegendaryRT === 'function') resetLegendaryRT();
}
resetSkillRT(); // 載入即建立初始狀態

/* ---- 共用排程器：echoQueue／fields／dmgWindows／healWindows 的到期結算 ----
   由 combat.js fieldTick（tickPotentialOverdrive 旁）與 tower.js towerTick 兩處鏡射呼叫。
   ctx = { pEnt 玩家實體, getEnemies() 回傳當前存活敵人陣列, floatSel 浮字層, onDeaths 擊殺後結算回呼,
           onDamage(d) 可選——排程結算傷害回報（塔戰輸出統計用） }。
   各項 resolve/onTick 結算細節由 B 組機制族（echo／periodicField／stigmaCycle）於入列/開窗/開領域時以閉包提供。 */
function tickSkillSchedulers(dt, ctx) {
  if (!SKILL_RT) return;
  var i, keep;
  // 1) 回響佇列：到期出列結算（resolve 由 echo/procCast 族在入列時提供）
  if (SKILL_RT.echoQueue.length) {
    keep = [];
    for (i = 0; i < SKILL_RT.echoQueue.length; i++) {
      var q = SKILL_RT.echoQueue[i];
      if (q && q.at <= GT) {
        if (typeof q.resolve === 'function') q.resolve(ctx);
      } else if (q) keep.push(q);
    }
    SKILL_RT.echoQueue = keep;
  }
  // 2) 領域：每 tickSec 觸發一次 onTick，期滿呼叫 onExpire 後移除
  if (SKILL_RT.fields.length) {
    keep = [];
    for (i = 0; i < SKILL_RT.fields.length; i++) {
      var f = SKILL_RT.fields[i];
      if (!f) continue;
      while (f.nextAt !== undefined && f.nextAt <= GT && f.nextAt <= f.until) {
        if (typeof f.onTick === 'function') f.onTick(ctx);
        f.nextAt += Math.max(0.1, f.tickSec || 1); // 下限 0.1 秒防死迴圈
      }
      if (f.until > GT) keep.push(f);
      else if (typeof f.onExpire === 'function') f.onExpire(ctx);
    }
    SKILL_RT.fields = keep;
  }
  // 3) 傷害快照窗：期滿以 resolve 一次結算（acc 累計值由傷害結算端寫入）後移除
  if (SKILL_RT.dmgWindows.length) {
    keep = [];
    for (i = 0; i < SKILL_RT.dmgWindows.length; i++) {
      var w = SKILL_RT.dmgWindows[i];
      if (!w) continue;
      if (w.until > GT) keep.push(w);
      else if (typeof w.resolve === 'function') w.resolve(ctx);
    }
    SKILL_RT.dmgWindows = keep;
  }
  // 4) 治療回響窗：期滿以 resolve 回療（acc 由受擊分發器 onPlayerHitTaken 累計）後移除
  if (SKILL_RT.healWindows.length) {
    keep = [];
    for (i = 0; i < SKILL_RT.healWindows.length; i++) {
      var hw = SKILL_RT.healWindows[i];
      if (!hw) continue;
      if (hw.until > GT) keep.push(hw);
      else if (typeof hw.resolve === 'function') hw.resolve(ctx);
    }
    SKILL_RT.healWindows = keep;
  }
  // 5) 聖痕（brand 族 stigmaCycle）：期滿自動引爆（儲傷 × 倍率真傷＋等額護盾）；儲 0 靜默清除
  if (SKILL_RT.stigma && SKILL_RT.stigma.until <= GT) {
    var sg = SKILL_RT.stigma;
    SKILL_RT.stigma = null;
    if (sg.stored > 0 && ctx && ctx.pEnt) {
      skillRtStigmaDetonate(ctx.pEnt, sg, ctx.getEnemies ? ctx.getEnemies() : [], ctx.floatSel, null, null, ctx);
    }
  }
}

/* ---- 受擊觸發統一入口（野外與高塔「玩家被敵人命中結算」兩處呼叫）----
   dmg=實際受到傷害（含護盾吸收前總值）、blocked=是否格擋、pEnt=玩家戰鬥實體、floatSel=玩家浮字層、
   absorbed=本次護盾吸收量（可選；破盾判定用，呼叫端傳 res.absorbed）。
   已接線：healWindows 受傷累計、stackCharge source:'hitTaken'（蓄怒之盾疊層）、cdOnHitTaken（壁壘迴環扣冷卻）、
   stigmaCycle 儲傷（brand 族——所受傷 × storePct% 蓄能至上限）。 */
function onPlayerHitTaken(dmg, blocked, pEnt, floatSel, absorbed) {
  if (!SKILL_RT) return;
  // healEcho 窗：累計窗內所受傷害（期滿由 tickSkillSchedulers 以 pct 回療）
  for (var i = 0; i < SKILL_RT.healWindows.length; i++) {
    var hw = SKILL_RT.healWindows[i];
    if (hw && hw.until > GT) hw.acc = (hw.acc || 0) + Math.max(0, Number(dmg) || 0);
  }
  // stackCharge 族：source:'hitTaken' 疊層（蓄怒之盾——被打疊 add、格擋疊 addBlock）
  skillRtChargeInput('hitTaken', blocked ? 'block' : 'hit');
  // cdFlow 族：cdOnHitTaken（壁壘迴環——護盾存續被打/格擋扣其他技冷卻；破盾一次追加）
  if (pEnt && typeof getStats === 'function') {
    skillRtCdOnHitTaken(pEnt, getStats(), blocked, Math.max(0, Number(absorbed) || 0));
  }
  // brand 族：stigmaCycle（聖痕輪迴）儲傷——受擊蓄能（所受傷 × storePct%，封頂 cap＝最大生命%）
  var sg = SKILL_RT.stigma;
  if (sg && sg.until > GT) {
    sg.stored = Math.min(sg.cap, sg.stored + Math.max(0, Number(dmg) || 0) * (sg.storePct || 0) / 100);
  }
}

/* ============ 45 新技能 × 11 機制族：A 組引擎 ============
   本區實作 skillAmp／stackCharge／resourceConvert／cdFlow／freeCast／buffExtend／dotSynergy
   七族的引擎邏輯（含各自被動觸發鍵消費，讀 getStats().skillTriggers）。
   數值 SSOT：全部讀技能 fx JSON（經 fxVal/fxResolveDeep 解析）＋ js/data.js 通用上限常數，
   引擎本身不寫死任何技能專屬數值。掛點：castSkill（施放前置/乘算區/施放後結算）、
   doPlayerAttack（普攻命中/擊殺）、onPlayerHitTaken（受擊）、tickDots（跳速）、onFieldKill（濺射）。 */

/* ---- 內部冷卻（icd）小工具：時戳存 SKILL_RT.icd，擊殺類觸發皆須經此 ---- */
function skillRtIcdReady(key) {
  return !SKILL_RT || (SKILL_RT.icd[key] || 0) <= GT;
}
function skillRtIcdSet(key, sec) {
  if (SKILL_RT) SKILL_RT.icd[key] = GT + Math.max(0, sec || 0);
}

/* ---- 技能系別判定統一（§3.5 屬性標籤）----
   fx.elemOverride 最優先（特規改屬性，如傳奇【死亡領域】）；其次 tags[0]（帶標籤即算該系）；
   再 fallback fx.elems 最大權重元素；皆無＝null（無系別，維持純物理/純魔法）。
   雷霆過載「雷電系技能」增幅／連鎖判定與 skillAmp 'elem:' scope 比對一律走此。 */
function skillElemOf(sk, fx) {
  if (fx && fx.elemOverride) return fx.elemOverride;
  if (sk && Array.isArray(sk.tags) && sk.tags.length) return sk.tags[0];
  if (fx && fx.elems) {
    var best = null, bestP = 0;
    for (var e in fx.elems) if (fx.elems[e] > bestP) { bestP = fx.elems[e]; best = e; }
    return best;
  }
  return null;
}

/* ---- 技能屬性化：把技能的屬性歸屬寫進 aCfg（2026-07-26 傷害公式改造）----
   規則：技能標籤（或 elemOverride／融合技 elems）決定屬性，本體傷害段整段即為該屬性傷害；
   由 resolveHit 於防禦/物魔抗之後、浮動與暴擊之前套元素抗性與屬性傷害提升%。
   無標籤（物理技能）＝不寫入任何欄位，維持純物理結算。
   elemOverride 會蓋掉融合技的多屬性混合（特規優先）。 */
function skillElemApplyACfg(aCfg, sk, fx) {
  if (!aCfg || !fx) return aCfg;
  if (!fx.elemOverride && fx.elems) {
    var mix = null;
    for (var e in fx.elems) { if (fx.elems[e] > 0) { if (!mix) mix = {}; mix[e] = fx.elems[e]; } }
    if (mix) { aCfg.skillElemMix = mix; return aCfg; }
  }
  var elem = skillElemOf(sk, fx);
  if (elem) aCfg.skillElem = elem;
  return aCfg;
}

/* ---- scope 比對（skillAmp／freeCast 共用）----
   'all'/'next'/未填＝不限；'cat:xxx'＝技能分類；'elem:xxx'＝系別標籤（skillElemOf）或含該元素占比；
   'multiHit'＝多段技（hits>1）。 */
function skillRtScopeMatch(scope, sk, fx) {
  if (!scope || scope === 'all' || scope === 'next') return true;
  if (scope.indexOf('cat:') === 0) return !!(sk && sk.cat === scope.slice(4));
  if (scope.indexOf('elem:') === 0) {
    var e = scope.slice(5);
    // §3.5 系別判定統一：帶該系標籤即算；保留融合技多屬性權重比對（無標籤來源）
    return skillElemOf(sk, fx) === e || !!(fx && fx.elems && fx.elems[e]);
  }
  if (scope === 'multiHit') return !!(fx && (fx.hits || 1) > 1);
  return false;
}

/* ---- 目標身上有效 DoT 數（dotAmpPer 用；含中毒） ---- */
function skillRtCountDots(ent) {
  if (!ent) return 0;
  var n = 0;
  if (ent.dots) for (var i = 0; i < ent.dots.length; i++) if (ent.dots[i].until > GT) n++;
  if (typeof poisonActive === 'function' && poisonActive(ent)) n++;
  return n;
}

/* ---- cdFlow 族：對「其他技能」冷卻扣秒 ----
   scope 篩選（null＝全部其他技能）；extraPct＝扣秒後再削剩餘的百分比（追擊號令 M8）；
   歸零即立即可施放（比照 tickSkillCds 補 markSkillReady 維持就緒排序）；回傳被歸零的技能 id 陣列。
   潛力技能（'potential:' 鍵）不在冷卻操縱範圍。 */
function skillRtShiftOthers(pEnt, selfId, sec, extraPct, scope) {
  var zeroed = [];
  if (!pEnt || !pEnt.skillCds) return zeroed;
  for (var cid in pEnt.skillCds) {
    if (cid === selfId) continue;
    if (cid.indexOf('potential:') === 0) continue;
    if ((pEnt.skillCds[cid] || 0) <= 0) continue;
    var d = skillDef(cid);
    if (!d) continue;
    if (scope && scope.indexOf('cat:') === 0 && d.cat !== scope.slice(4)) continue;
    var v = pEnt.skillCds[cid] - Math.max(0, sec || 0);
    if (v > 0 && extraPct > 0) v *= 1 - extraPct / 100;
    if (v <= 1e-9) {
      v = 0;
      zeroed.push(cid);
      markSkillReady(pEnt, cid);
    }
    pEnt.skillCds[cid] = v;
  }
  return zeroed;
}

/* ---- cdFlow 族：cdShift 主入口（追擊號令／凜冬迴潮／竊時者）----
   cfg = { scope, sec:{base,per}, extraPct, focus:'longest', zeroSelfCdrPct, onKillRepeat:{icdSec} }。
   focus:'longest'＝全部秒數灌給剩餘冷卻最長的技能（竊時者）；
   zeroSelfCdrPct＝被灌技歸零時本技冷卻再 −N%（竊時者 M8）。 */
function skillRtShiftCds(pEnt, selfId, cfg, lv) {
  if (!cfg || !pEnt || !pEnt.skillCds) return;
  var sec = fxVal(cfg.sec, lv) || 0;
  if (cfg.focus === 'longest') {
    var bestId = null, bestCd = 0;
    for (var cid in pEnt.skillCds) {
      if (cid === selfId || cid.indexOf('potential:') === 0) continue;
      if ((pEnt.skillCds[cid] || 0) > bestCd && skillDef(cid)) {
        bestCd = pEnt.skillCds[cid];
        bestId = cid;
      }
    }
    if (bestId) {
      var nv = Math.max(0, bestCd - sec);
      pEnt.skillCds[bestId] = nv;
      if (nv <= 0) {
        markSkillReady(pEnt, bestId);
        // 竊時者 M8：被灌技歸零時，本技剩餘冷卻 −zeroSelfCdrPct%
        if (cfg.zeroSelfCdrPct && (pEnt.skillCds[selfId] || 0) > 0) {
          pEnt.skillCds[selfId] *= 1 - cfg.zeroSelfCdrPct / 100;
        }
      }
    }
    return;
  }
  skillRtShiftOthers(pEnt, selfId, sec, cfg.extraPct || 0, cfg.scope);
}

/* ---- cdFlow 族：擊殺觸發統一結算 ----
   技能擊殺（id＝技能 id）與普攻擊殺（id＝null，由 doPlayerAttack 呼叫）共用；
   passiveKillCd（死神節拍）：技能擊殺恆可觸發、普攻擊殺需 inclBasic，兩者共用同一 icd（PLAN M8「共用 icd」）；
   cdResetOnKill／cdResetOnKill2（凜冬迴潮 M4/M8）：兩鍵共用 'cdKill:'+id 內部冷卻；
   cdShift.onKillRepeat（竊時者 M4）：擊殺再執行一次 cdShift（獨立 icd）。 */
function skillRtOnKillTriggers(pEnt, id, fx, lv, st) {
  if (!SKILL_RT || !pEnt || !pEnt.skillCds) return;
  st = st || getStats();
  var trig = st.skillTriggers || {};
  var pk = trig.passiveKillCd;
  if (pk && (id || pk.inclBasic) && skillRtIcdReady('passiveKillCd')) {
    skillRtShiftOthers(pEnt, id, pk.sec || 0, 0, null);
    // M4：機率重置擊殺技自身（普攻擊殺無「該技」可言）
    if (id && pk.selfResetPct && chance(pk.selfResetPct)) {
      pEnt.skillCds[id] = 0;
      markSkillReady(pEnt, id);
    }
    skillRtIcdSet('passiveKillCd', pk.icdSec || 0);
  }
  if (!id || !fx) return;
  if (fx.cdResetOnKill || fx.cdResetOnKill2) {
    var key = 'cdKill:' + id;
    if (skillRtIcdReady(key)) {
      var icdSec = 0, c1 = fx.cdResetOnKill, c2 = fx.cdResetOnKill2;
      if (c1) {
        icdSec = Math.max(icdSec, c1.icdSec || 0);
        // 擊殺機率重置本技冷卻（selfReset）
        if (c1.selfReset && (c1.pct === undefined || chance(c1.pct))) {
          pEnt.skillCds[id] = 0;
          markSkillReady(pEnt, id);
        }
      }
      if (c2) {
        icdSec = Math.max(icdSec, c2.icdSec || 0);
        // 第二道：擊殺時其他技扣秒／削剩餘%（凜冬迴潮 M8）
        if (c2.pct === undefined || chance(c2.pct)) {
          if (c2.sec) skillRtShiftOthers(pEnt, id, fxVal(c2.sec, lv) || 0, 0, c2.scope);
          if (c2.othersPct) skillRtShiftOthers(pEnt, id, 0, c2.othersPct, c2.scope);
        }
      }
      skillRtIcdSet(key, icdSec);
    }
  }
  if (fx.cdShift && fx.cdShift.onKillRepeat) {
    var kk = 'cdShiftKill:' + id;
    if (skillRtIcdReady(kk)) {
      skillRtShiftCds(pEnt, id, fx.cdShift, lv);
      skillRtIcdSet(kk, fx.cdShift.onKillRepeat.icdSec || 0);
    }
  }
}

/* ---- cdFlow 族：cdOnHitTaken（壁壘迴環）----
   迭代裝載欄已學技能的 fx.cdOnHitTaken：護盾存續被打（本次有吸收或仍有護盾）或格擋 → 其他技冷卻 −sec（icd）；
   onBreak：本次吸收耗盡護盾（破盾）→ 一次追加扣秒（破盾天然低頻，不另設 icd）。 */
function skillRtCdOnHitTaken(pEnt, st, blocked, absorbed) {
  if (!SKILL_RT || !G || !G.player) return;
  var lo = G.player.loadout || [];
  for (var i = 0; i < lo.length; i++) {
    var id = lo[i];
    if (typeof id !== 'string' || id.indexOf('potential:') === 0) continue;
    var sk = skillDef(id);
    var lv = skillLevel(id);
    if (!sk || !lv || !sk.fx) continue;
    var fx = effectiveFx(id, sk, lv);
    if (!fx.cdOnHitTaken) continue;
    var cfg = fx.cdOnHitTaken;
    var shieldNow = Math.max(0, pEnt.shield || 0);
    if (absorbed > 0 || shieldNow > 0 || blocked) {
      var icdKey = 'cdOnHit:' + id;
      if (skillRtIcdReady(icdKey)) {
        skillRtShiftOthers(pEnt, id, fxVal(cfg.sec, lv) || 0, 0, cfg.scope);
        skillRtIcdSet(icdKey, cfg.icdSec || 0);
      }
    }
    // M8 破盾：本次有吸收且護盾已歸零＝這一下把盾打破
    if (cfg.onBreak && absorbed > 0 && shieldNow <= 0) {
      skillRtShiftOthers(pEnt, id, fxVal(cfg.onBreak, lv) || 0, 0, cfg.scope);
    }
  }
}

/* ---- stackCharge 族：疊層輸入源分發 ----
   source='attackHit'（普攻命中，doPlayerAttack 呼叫）／'hitTaken'（被打，onPlayerHitTaken 呼叫）；
   kind='hit'/'crit'/'block'——addCrit（鬥氣輪轉 M4 暴擊疊 2）、addBlock（蓄怒之盾 M4 格擋疊 2）覆蓋預設 add。
   僅在引擎存續期間（施放來源技後 until 未過期）疊層；source='cast' 的疊層走 skillRtChargeOnCast。 */
function skillRtChargeInput(source, kind) {
  if (!SKILL_RT) return;
  for (var name in SKILL_RT.charges) {
    var ch = SKILL_RT.charges[name];
    if (!ch) continue;
    if (ch.until <= GT) { delete SKILL_RT.charges[name]; continue; } // 期滿清層
    if (ch.source !== source) continue;
    var add = ch.add || 0;
    if (kind === 'crit' && ch.addCrit !== undefined) add = ch.addCrit;
    if (kind === 'block' && ch.addBlock !== undefined) add = ch.addBlock;
    if (add > 0) ch.stacks = Math.min(ch.max, ch.stacks + add);
  }
}

// addRange:[a,b] 隨機整數枚數（賭徒籌碼）；否則固定 add
function skillRtChargeRollAdd(cfg) {
  if (Array.isArray(cfg.addRange) && cfg.addRange.length >= 2) {
    return ri(cfg.addRange[0], cfg.addRange[1]);
  }
  return cfg.add || 0;
}

/* ---- stackCharge 族：施放來源技時建立/刷新疊層（burst 設定隨層數存入 SKILL_RT.charges）---- */
function skillRtChargeOnCast(cfg, id, lv) {
  if (!cfg || !SKILL_RT) return;
  var name = cfg.name || id;
  var ch = SKILL_RT.charges[name];
  if (!ch || ch.until <= GT) ch = SKILL_RT.charges[name] = { stacks: 0 };
  ch.srcId = id;
  ch.source = cfg.source || 'cast';
  ch.max = Math.max(1, Math.round(fxVal(cfg.max, lv) || 1));
  ch.until = GT + (fxVal(cfg.dur, lv) || 0);
  ch.add = cfg.add;
  ch.addRange = cfg.addRange;
  ch.addCrit = cfg.addCrit;
  ch.addBlock = cfg.addBlock;
  // 引爆設定快照（隨施放等級定值；消耗時直接讀存入值）
  ch.burst = cfg.burst ? {
    multPct: fxVal(cfg.burst.multPct, lv) || 0,
    scope: cfg.burst.scope || 'self',
    stunDur: cfg.burst.stunDur || 0,
    keepStacks: cfg.burst.keepStacks || 0,
    anyMultPct: cfg.burst.anyMultPct !== undefined ? (fxVal(cfg.burst.anyMultPct, lv) || 0) : undefined
  } : null;
  if (ch.source === 'cast') {
    // 疊滿引爆時機修正：本次施放的疊層若已於傷害乘算區先行計入並隨引爆消耗（pendingCastConsumed），
    // 此處不再重複疊入（否則引爆那次的疊層會被計兩次）
    if (ch.pendingCastConsumed) delete ch.pendingCastConsumed;
    else ch.stacks = Math.min(ch.max, ch.stacks + skillRtChargeRollAdd(cfg));
  }
}

/* ---- skillAmp 族：授予增幅（skillAmp／skillAmp2 → SKILL_RT.amps）----
   perCdSec＝依受惠技冷卻秒數×係數的動態增幅（上限 cap）；uses 未填＝時限內不限次數；
   cdrPct＝受惠技施放後冷卻 −N%（cdrMinCd：受惠技原始 CD 達門檻才生效，破軍先聲 M8）。 */
function skillRtPushAmp(cfg, srcId, lv) {
  if (!cfg || !SKILL_RT) return;
  SKILL_RT.amps.push({
    scope: cfg.scope || 'next',
    pct: fxVal(cfg.pct, lv) || 0,
    until: GT + (fxVal(cfg.dur, lv) || 9999),
    uses: cfg.uses !== undefined ? Math.max(1, Math.round(fxVal(cfg.uses, lv) || 1)) : undefined,
    refundPct: cfg.refundPct || 0,
    perCdSec: cfg.perCdSec !== undefined ? (fxVal(cfg.perCdSec, lv) || 0) : undefined,
    cap: cfg.cap !== undefined ? (fxVal(cfg.cap, lv) || 0) : undefined,
    cdrPct: cfg.cdrPct || 0,
    cdrMinCd: cfg.cdrMinCd,
    srcId: srcId
  });
}

/* ---- freeCast 族：施放是否會免費（唯讀預判，供 pickAndCastSkill 略過 MP 檢查）---- */
function skillRtWouldBeFree(sk, fx, st) {
  if (!SKILL_RT) return false;
  var fc = SKILL_RT.freeCasts;
  if (fc && fc.count > 0 && fc.until > GT && skillRtScopeMatch(fc.scope, sk, fx)) return true;
  var nth = st && st.skillTriggers && st.skillTriggers.passiveNthFree;
  if (nth && nth.n > 0 && SKILL_RT.nthCastCount + 1 >= nth.n) return true;
  return false;
}

/* ---- 施放前置（castSkill 開頭、扣魔與寫入冷卻前呼叫）----
   回傳 { free 免耗魔, ampPct 全效果增幅%（併入 fxMult）, comboPct 連段增傷%（乘算區）, noGcd, cdHalf }。
   處理：freeNext 次數制扣減（freeCast 族）、passiveNthFree 計數（零式節律）、comboWindow 連段窗判定＋重開。 */
function skillRtPreCast(pEnt, sk, fx, id, lv, st) {
  var pre = { free: false, ampPct: 0, comboPct: 0, noGcd: false, cdHalf: false };
  if (!SKILL_RT) return pre;
  // freeNext：接下來 N 個技能 0 耗魔（scope 篩選；到期/用罄自動清除）
  // 0 耗魔技能不消耗免費次數也不標記 free（免費對其無收益——心流湧動不被回春氣息等 0 耗技白吃）
  var fc = SKILL_RT.freeCasts;
  if (fc && (fc.until <= GT || fc.count <= 0)) { SKILL_RT.freeCasts = null; fc = null; }
  if (fc && skillManaCost(sk, lv) > 0 && skillRtScopeMatch(fc.scope, sk, fx)) {
    fc.count--;
    if (fc.count <= 0) SKILL_RT.freeCasts = null;
    pre.free = true;
    if (fc.ampPct) pre.ampPct += fc.ampPct;
    if (fc.noGcd) pre.noGcd = true;
    if (fc.cdHalf) pre.cdHalf = true;
  }
  // passiveNthFree（零式節律）：每第 n 次施放免費＋增幅（計數存 SKILL_RT，任何技能施放皆累計）
  var nth = st.skillTriggers && st.skillTriggers.passiveNthFree;
  if (nth && nth.n > 0) {
    SKILL_RT.nthCastCount++;
    if (SKILL_RT.nthCastCount >= nth.n) {
      SKILL_RT.nthCastCount = 0;
      pre.free = true;
      if (nth.ampPct) pre.ampPct += nth.ampPct;
      if (nth.noGcd) pre.noGcd = true;
    }
  }
  // comboWindow 連段窗（連環戰訣）：窗內施放→增傷並重開新窗；斷檔（過期）自動失效
  var cw = SKILL_RT.combo;
  if (cw && cw.until <= GT) { SKILL_RT.combo = null; cw = null; }
  if (cw) {
    pre.comboPct = cw.pct || 0;
    if (cw.noGcd) pre.noGcd = true;
    cw.until = GT + (cw.dur || 0); // 連段成立：重開新窗
    cw.count = (cw.count || 0) + 1;
  }
  return pre;
}

/* ---- 傷害乘算統一區（castSkill baseVal 段、lightningOverdrive 增幅旁呼叫）----
   回傳 { mult 乘算倍率, flat 追加固定傷害 }；呼叫端 baseVal = baseVal × mult ＋ flat（flat 另行分攤）。
   處理順序：skillAmp 消耗 → 連段窗 → 守勢反哺 → stackCharge 疊滿引爆 → resourceConvert（mpDump／
   shieldBurst／hpSacrifice）→ dotAmpPer。全部乘算統一於此、不散落。 */
function skillRtApplyDamageAmps(pEnt, sk, fx, id, lv, st, targets, pre, parts, floatSel) {
  var res = { mult: 1, flat: 0 };
  if (!SKILL_RT) return res;
  var i;
  // --- skillAmp 族：比對 scope 乘算並扣 uses（多道增幅乘算疊乘）---
  if (SKILL_RT.amps.length) {
    var keep = [];
    for (i = 0; i < SKILL_RT.amps.length; i++) {
      var a = SKILL_RT.amps[i];
      if (!a || a.until <= GT) continue; // 過期清除
      if (!skillRtScopeMatch(a.scope, sk, fx)) { keep.push(a); continue; }
      var pct = a.pct || 0;
      // perCdSec：增幅＝受惠技原始冷卻秒數 × 係數（上限 cap；破軍先聲）
      if (a.perCdSec !== undefined) {
        pct = (sk.cd || 0) * a.perCdSec;
        if (a.cap !== undefined) pct = Math.min(pct, a.cap);
      }
      if (pct) {
        res.mult *= 1 + pct / 100;
        parts.push('<span class="log-hl-good">增幅 +' + fmt1(pct) + '%</span>');
      }
      // refundPct：受惠技施放後返還其魔耗的 N%（星辰引導）
      if (a.refundPct) {
        pEnt.mp = Math.min(st.mp, pEnt.mp + skillManaCost(sk, lv) * a.refundPct / 100);
      }
      // cdrPct：受惠技施放後冷卻 −N%（cdrMinCd＝受惠技原始 CD 門檻；冷卻已於施放開頭寫入，直接乘算削減）
      if (a.cdrPct && (a.cdrMinCd === undefined || (sk.cd || 0) >= a.cdrMinCd)) {
        if ((pEnt.skillCds[id] || 0) > 0) pEnt.skillCds[id] *= 1 - a.cdrPct / 100;
      }
      if (a.uses !== undefined) {
        a.uses--;
        if (a.uses > 0) keep.push(a);
      } else keep.push(a);
    }
    SKILL_RT.amps = keep;
  }
  // --- comboWindow 連段增傷（判定與重開窗在 skillRtPreCast）---
  if (pre && pre.comboPct) {
    res.mult *= 1 + pre.comboPct / 100;
    parts.push('<span class="log-hl-good">連段 +' + fmt1(pre.comboPct) + '%</span>');
  }
  // --- passiveDefFeedback（守勢反哺）消耗：下一個傷害技增幅；M8 消耗時來源 def 技冷卻返還 ---
  var fb = SKILL_RT.feedback;
  if (fb && fb.until <= GT) { SKILL_RT.feedback = null; fb = null; }
  if (fb && fb.stacks > 0) {
    fb.stacks--;
    if (fb.pct) res.mult *= 1 + fb.pct / 100;
    if (fb.cdRefund && fb.srcId && (pEnt.skillCds[fb.srcId] || 0) > 0) {
      pEnt.skillCds[fb.srcId] = Math.max(0, pEnt.skillCds[fb.srcId] - fb.cdRefund);
      if (pEnt.skillCds[fb.srcId] <= 0) markSkillReady(pEnt, fb.srcId);
    }
    if (fb.stacks <= 0) SKILL_RT.feedback = null;
    parts.push('<span class="log-hl-good">守勢反哺！</span>');
  }
  // --- stackCharge 族：疊滿引爆（scope self＝本技／next＝下一個傷害技；anyMultPct＝任意技引爆折扣倍率，蓄怒之盾 M8）---
  for (var cn in SKILL_RT.charges) {
    var ch = SKILL_RT.charges[cn];
    if (!ch) continue;
    if (ch.until <= GT) { delete SKILL_RT.charges[cn]; continue; }
    if (!ch.burst) continue;
    // source:'cast'＋scope:'self' 且本技即來源技（霜晶共鳴）：本次施放將疊的層數先行計入判滿——
    // 「疊到第 4 層的那一次施放」即引爆（PLAN §3「4 層時該次消耗全部」語意），不必多等一次施放；
    // 引爆時以 pendingCastConsumed 旗標通知施放後的 skillRtChargeOnCast：本次疊層已隨引爆消耗、不再重複疊入
    var pendAdd = 0;
    if (ch.source === 'cast' && ch.burst.scope === 'self' && ch.srcId === id &&
        fx.charge && (fx.charge.name || id) === cn) {
      pendAdd = skillRtChargeRollAdd(fx.charge);
    }
    if (Math.min(ch.max, ch.stacks + pendAdd) < ch.max) continue;
    var bm = 0;
    if (ch.burst.scope === 'next' || ch.srcId === id) bm = ch.burst.multPct;
    else if (ch.burst.anyMultPct !== undefined) bm = ch.burst.anyMultPct;
    if (!(bm > 0)) continue;
    res.mult *= 1 + bm / 100;
    // 引爆附帶暈眩（霜晶共鳴 M8 凍結）：對所有存活目標套用（走標準控場遞減/免疫檢查）
    if (ch.burst.stunDur > 0 && targets) {
      for (i = 0; i < targets.length; i++) {
        var bt = targets[i];
        if (bt && bt.hp > 0 && !isBossControlImmune(bt) && !resistCtrl(monsterDefCfg(bt))) {
          applyEffect(bt, 'stun', ch.burst.stunDur);
        }
      }
    }
    ch.stacks = Math.min(ch.max - 1, Math.max(0, ch.burst.keepStacks || 0)); // 引爆留層（鬥氣輪轉 M8）
    if (pendAdd > 0) ch.pendingCastConsumed = true; // 本次施放的疊層已計入引爆消耗（施放後不再疊入）
    parts.push('<span class="log-hl-good">疊滿引爆 +' + fmt1(bm) + '%！</span>');
  }
  // --- resourceConvert：mpDump（奧能梭哈）——耗盡全部剩餘 MP，每 10 點被耗 MP 增傷 ---
  if (fx.mpDump) {
    var dumped = Math.max(0, pEnt.mp || 0);
    if (dumped > 0) {
      pEnt.mp = 0;
      var dumpPct = dumped / 10 * (fxVal(fx.mpDump.pctPer10Mp, lv) || 0);
      if (dumpPct > 0) {
        res.mult *= 1 + dumpPct / 100;
        parts.push('<span class="log-hl-good">耗盡 ' + fmt(dumped) + ' 法力增傷 +' + fmt1(dumpPct) + '%</span>');
      }
    }
  }
  // --- resourceConvert：shieldBurst（聖盾崩華）——引爆當前護盾 N% 化追加傷害（上限 matk×倍數、護盾消耗）---
  if (fx.shieldBurst) {
    var sbAmt = Math.max(0, pEnt.shield || 0) * (fxVal(fx.shieldBurst.convertPct, lv) || 0) / 100;
    if (sbAmt > 0) {
      var beforeBurstShield = Math.max(0, pEnt.shield || 0);
      pEnt.shield = Math.max(0, beforeBurstShield - sbAmt);
      if (typeof refreshShieldMaxAfterGain === 'function') refreshShieldMaxAfterGain(pEnt, beforeBurstShield);
      var sbCapMult = Math.min(fx.shieldBurst.capAtkMult || SHIELD_BURST_ATK_MULT_CAP, SHIELD_BURST_ATK_MULT_CAP);
      res.flat += Math.min(sbAmt, (st.matk || 0) * sbCapMult);
      // 聖盾崩華 M8：護盾引爆附帶暈眩——對所有存活目標套用（標準控場遞減/免疫檢查）
      if (fx.shieldBurst.stunDur > 0 && targets) {
        for (i = 0; i < targets.length; i++) {
          var sbT = targets[i];
          if (sbT && sbT.hp > 0 && !isBossControlImmune(sbT) && !resistCtrl(monsterDefCfg(sbT))) {
            applyEffect(sbT, 'stun', fx.shieldBurst.stunDur);
          }
        }
      }
      parts.push('<span class="log-hl-good">護盾引爆！</span>');
    }
  }
  // --- resourceConvert：hpSacrifice（瀝血狂濤）——獻祭當前生命換增傷（不致死：至少留 1 點生命）---
  if (fx.hpSacrifice) {
    var hs = fx.hpSacrifice;
    var sac = Math.max(0, (pEnt.hp || 0) * (hs.hpPct || 0) / 100);
    sac = Math.min(sac, Math.max(0, pEnt.hp - 1));
    if (sac > 0) {
      pEnt.hp -= sac;
      if (typeof legendaryOnHealthLost === 'function') legendaryOnHealthLost(pEnt, sac, floatSel);
      var sacAmp = fxVal(hs.ampPct, lv) || 0;
      if (sacAmp > 0) res.mult *= 1 + sacAmp / 100;
      // M4：獻祭生命以 HoT 返還（不覆蓋更強的既有再生增益）
      if (hs.hotRefundPct) {
        var hotDur = hs.hotDur || 6;
        var perSecPct = st.hp > 0 ? sac * hs.hotRefundPct / 100 / hotDur / st.hp * 100 : 0;
        if (perSecPct > buffVal(pEnt, 'hot')) applyBuff(pEnt, 'hot', perSecPct, hotDur);
      }
      parts.push('獻祭 ' + fmt(sac) + ' 生命');
    }
  }
  // --- dotSynergy：dotAmpPer——主要目標身上每個 DoT 增傷 N%（技能鍵＋被動觸發鍵相加；多目標以第一個存活目標計）---
  var perDot = (fxVal(fx.dotAmpPer, lv) || 0) + ((st.skillTriggers && st.skillTriggers.dotAmpPer) || 0);
  if (perDot > 0 && targets && targets.length) {
    var dotCount = skillRtCountDots(targets[0]);
    if (dotCount > 0) res.mult *= 1 + perDot * dotCount / 100;
  }
  return res;
}

/* ---- dotSynergy 族：DoT 引爆／額外跳動／跳速標記 ----
   有傷害技於命中後（fx.dot 塗抹「之前」，避免引爆剛塗上的 DoT）呼叫；
   無傷害技（萬創崩裂）比照 maxHpDotPct 走非傷害分支呼叫。回傳追加傷害總量（呼叫端自行併入 totalDmg/out.dmg）。 */
function skillRtApplyDotOps(targets, fx, lv, st, floatSel, parts, out) {
  if (!fx.dotDetonate && !fx.dotPulse && !fx.dotHaste) return 0;
  var extra = 0;
  for (var i = 0; i < (targets ? targets.length : 0); i++) {
    var t = targets[i];
    if (!t || t.hp <= 0 || effectActive(t, 'invuln')) continue;
    // dotDetonate：引爆結清——剩餘 DoT 總值 × pct% 真傷直扣（比照 comboDetonate；pct ≤ DOT_DETONATE_CAP_PCT）
    if (fx.dotDetonate && t.dots && t.dots.length) {
      var dcfg = fx.dotDetonate;
      var dPct = Math.min(fxVal(dcfg.pct, lv) || 0,
        Math.min(dcfg.cap !== undefined ? dcfg.cap : DOT_DETONATE_CAP_PCT, DOT_DETONATE_CAP_PCT));
      var sum = 0, cleared = [];
      for (var d = 0; d < t.dots.length; d++) {
        var dd = t.dots[d];
        if (dd.until > GT) { sum += dd.dps * (dd.until - GT); cleared.push(dd); }
      }
      if (sum > 0 && dPct > 0) {
        var boom = Math.max(1, Math.round(sum * dPct / 100));
        t.hp -= boom;
        extra += boom;
        floatEnemyEvent(t, floatSel, '💥' + fmt(boom), 'crit enemy-skill', boom);
        trackDps(boom);
        t.dots = []; // 結清：清空全部 DoT
        // reapplyPct（疫爆術 M8）：引爆後以 N% 強度、原始持續重新點燃
        if (dcfg.reapplyPct) {
          for (var r = 0; r < cleared.length; r++) {
            applyDot(t, cleared[r].dps * dcfg.reapplyPct / 100, cleared[r].dur || 1, cleared[r].name);
          }
        }
        // 引爆附帶暈眩（疫爆術 M4）：標準控場遞減/免疫檢查
        if (dcfg.stunDur && !isBossControlImmune(t) && !resistCtrl(monsterDefCfg(t))) {
          applyEffect(t, 'stun', dcfg.stunDur);
        }
        parts.push('<span class="log-hl-good">引爆 DoT ' + fmt(boom) + '！</span>');
        if (t.hp <= 0) { t.hp = 0; out.killed = true; }
      }
    }
    // dotPulse（萬創崩裂）：全部 DoT 立即額外跳 ticks 次、每跳 powerPct%（不清空、不耗秒；比照 tick 吃全局減傷）
    if (fx.dotPulse && t.hp > 0 && t.dots && t.dots.length) {
      var pcfg = fx.dotPulse;
      var ticks = Math.max(0, Math.round(fxVal(pcfg.ticks, lv) || 0));
      var power = fxVal(pcfg.powerPct, lv) || 0;
      var dpsSum = 0;
      for (var p2 = 0; p2 < t.dots.length; p2++) if (t.dots[p2].until > GT) dpsSum += t.dots[p2].dps;
      var pulse = Math.round(dpsSum * ticks * power / 100 * globalDamageMultiplierForEntity(t));
      if (pulse > 0) {
        t.hp -= pulse;
        extra += pulse;
        floatEnemyEvent(t, floatSel, '🩸' + fmt(pulse), 'dmg enemy-skill', pulse);
        trackDps(pulse);
        parts.push('<span class="log-hl-good">DoT 額外跳動 ' + fmt(pulse) + '</span>');
        if (t.hp <= 0) { t.hp = 0; out.killed = true; }
      }
    }
    // dotHaste（萬創崩裂 M8）：目標 DoT 跳速標記（tickDots 讀取；掛敵人實體、時戳自然過期）
    if (fx.dotHaste) {
      t._dotHasteMult = fx.dotHaste.mult || 1;
      t._dotHasteUntil = GT + (fx.dotHaste.dur || 0);
    }
  }
  return extra;
}

/* ---- resourceConvert 族：overhealDmg（溢流聖罰）----
   v1 單次結算：本技治療量超出缺口的溢出 × pct%（≤ OVERHEAL_DMG_CAP_PCT）轉真傷，
   直扣第一個存活目標（比照 comboDetonate 真傷直扣）。於 healPlayer 之「前」以當下缺口計算。 */
function skillRtOverhealToDmg(pEnt, fx, lv, st, healAmt, targets, floatSel, parts, out) {
  var cfg = fx.overhealDmg;
  if (!cfg) return;
  var overflow = Math.max(0, healAmt - Math.max(0, st.hp - Math.max(0, pEnt.hp)));
  if (overflow <= 0) return;
  var pct = Math.min(fxVal(cfg.pct, lv) || 0,
    Math.min(cfg.cap !== undefined ? cfg.cap : OVERHEAL_DMG_CAP_PCT, OVERHEAL_DMG_CAP_PCT));
  if (pct <= 0) return;
  var t = null;
  for (var i = 0; i < (targets ? targets.length : 0); i++) {
    if (targets[i] && targets[i].hp > 0) { t = targets[i]; break; }
  }
  if (!t || effectActive(t, 'invuln')) return;
  var dmg = Math.max(1, Math.round(overflow * pct / 100));
  t.hp -= dmg;
  out.dmg = (out.dmg || 0) + dmg;
  floatEnemyEvent(t, floatSel, '⛲' + fmt(dmg), 'crit enemy-skill', dmg);
  trackDps(dmg);
  parts.push('<span class="log-hl-good">溢療轉傷 ' + fmt(dmg) + '！</span>');
  if (t.hp <= 0) { t.hp = 0; out.killed = true; }
}

/* ---- resourceConvert 族：溢流聖罰 M4 轉傷窗 ----
   窗（SKILL_RT.overhealWin）存續期間，「其他」治療技（無自帶 overhealDmg 者）的本次溢出
   比照本體以窗內比例轉真傷；比例於開窗時即以本體當級數值夾上限凍結。 */
function skillRtOverhealWinToDmg(pEnt, st, healAmt, targets, floatSel, parts, out) {
  if (!SKILL_RT) return;
  var w = SKILL_RT.overhealWin;
  if (!w) return;
  if (w.until <= GT) { SKILL_RT.overhealWin = null; return; }
  if (!(w.pct > 0)) return;
  // 借用 skillRtOverhealToDmg 核心：以窗內凍結比例組一份純量 cfg（pct 已夾過上限）
  skillRtOverhealToDmg(pEnt, { overhealDmg: { pct: w.pct } }, 1, st, healAmt, targets, floatSel, parts, out);
}

/* ---- resourceConvert 族：傷害段後結算（hpSacrifice M8 傷害轉護盾）---- */
function skillRtAfterDamage(pEnt, fx, lv, st, totalDmg, floatSel, parts) {
  if (fx.hpSacrifice && fx.hpSacrifice.dmgToShieldPct && totalDmg > 0) {
    var gain = totalDmg * fx.hpSacrifice.dmgToShieldPct / 100;
    var before = Math.max(0, pEnt.shield || 0);
    // 沿用技能護盾上限（最大生命 × SHIELD_SKILL_CAP_PCT%）；既有護盾已超上限則不再增加
    var cap = st.hp * (SHIELD_SKILL_CAP_PCT / 100);
    pEnt.shield = Math.min(Math.max(before, cap), before + gain);
    if (typeof refreshShieldMaxAfterGain === 'function') refreshShieldMaxAfterGain(pEnt, before);
    var gained = Math.max(0, pEnt.shield - before);
    if (gained > 0) {
      floatPlayerEvent(floatSel, '🛡️+' + fmt(gained), 'shield');
      parts.push('<span class="log-hl-good">傷害轉護盾 ' + fmt(gained) + '</span>');
    }
  }
}

/* ---- buffExtend 族：延長單筆增益/DoT ----
   累計延長 ≤ 原始持續 × BUFF_EXTEND_CAP_PCT%（用 applyBuff/applyDot 補存的 dur/ext 計）；
   low2x＝剩餘低於 BUFF_EXTEND_LOW_REMAIN_SEC 秒時延長加倍（流光永續 M8）。 */
function skillRtExtendEntry(entry, sec, low2x) {
  var dur = Math.max(0, entry.dur || 0);
  if (dur <= 0 || !(sec > 0)) return;
  var give = sec;
  if (low2x && entry.until - GT < BUFF_EXTEND_LOW_REMAIN_SEC) give *= 2;
  var allow = dur * BUFF_EXTEND_CAP_PCT / 100 - (entry.ext || 0);
  give = Math.min(give, Math.max(0, allow));
  if (give <= 0) return;
  entry.until += give;
  entry.ext = (entry.ext || 0) + give;
}
// 延長自身所有生效中增益（scope:'selfBuffs'）
function skillRtExtendSelfBuffs(pEnt, sec, low2x) {
  if (!(sec > 0) || !pEnt || !pEnt.buffs) return;
  for (var k in pEnt.buffs) {
    var b = pEnt.buffs[k];
    if (b && b.until > GT) skillRtExtendEntry(b, sec, low2x);
  }
}
// 延長目標身上所有生效中 DoT（scope:'targetDots'）
function skillRtExtendTargetDots(targets, sec, low2x) {
  if (!(sec > 0)) return;
  for (var i = 0; i < (targets ? targets.length : 0); i++) {
    var t = targets[i];
    if (!t || t.hp <= 0 || !t.dots) continue;
    for (var d = 0; d < t.dots.length; d++) {
      var dd = t.dots[d];
      if (dd.until > GT) skillRtExtendEntry(dd, sec, low2x);
    }
  }
}

/* ---- 敵人死亡分發（dotSynergy 濺射＋brand 印記轉移）----
   dotSplashOnKill（蝕骨頻率 M8）：死亡敵人身上每個生效中 DoT，以剩餘強度 × pct% 濺射到
   隨機另一存活敵人（剩餘秒數照搬）。
   passiveBrandAmp.transferOnKill（獵殺烙印 M8）：死亡敵人身上生效中的印記整批轉移到
   隨機另一存活敵人（同名合併：儲能相加、層數相加後夾原上限已不可考，直接以純累加處理）。
   掛點：combat.js onFieldKill（野外；高塔單體 BOSS 無轉移/濺射對象，自然不觸發）。 */
function skillRtOnEnemyDeath(deadEnt, liveEnemies) {
  if (!deadEnt) return;
  var st = typeof getStats === 'function' ? getStats() : null;
  var trig = (st && st.skillTriggers) || {};
  var pool = [];
  for (var i = 0; i < (liveEnemies ? liveEnemies.length : 0); i++) {
    var e = liveEnemies[i];
    if (e && e !== deadEnt && e.hp > 0) pool.push(e);
  }
  if (!pool.length) return;
  // 接收者一律取「離死者最近」的敵人（同距離隨機）：印記轉移與 DoT 濺射都是往旁邊擴散，
  // 不再從全場隨機挑一隻 → js/battlefield.js bfNearestOther
  var nearestRecv = (typeof bfNearestOther === 'function') ? bfNearestOther(deadEnt, pool) : null;
  // brand 族：印記死亡轉移（獵殺烙印 M8）——同名印記儲能/層數併入接收者
  if (trig.passiveBrandAmp && trig.passiveBrandAmp.transferOnKill && deadEnt.brands && deadEnt.brands.length) {
    var recv = nearestRecv || pick(pool);
    if (!recv.brands) recv.brands = [];
    for (var b = 0; b < deadEnt.brands.length; b++) {
      var be = deadEnt.brands[b];
      if (!be || be.until <= GT) continue;
      var merged = null;
      for (var m = 0; m < recv.brands.length; m++) {
        if (recv.brands[m].name === be.name && recv.brands[m].until > GT) { merged = recv.brands[m]; break; }
      }
      if (merged) {
        merged.stored += be.stored;
        merged.stacks += be.stacks;
        merged.until = Math.max(merged.until, be.until);
      } else {
        recv.brands.push({ name: be.name, stored: be.stored, stacks: be.stacks, until: be.until });
      }
    }
    deadEnt.brands = [];
  }
  // dotSynergy 族：DoT 濺射（蝕骨頻率 M8）
  var pct = trig.dotSplashOnKill || 0;
  if (!(pct > 0) || !deadEnt.dots || !deadEnt.dots.length) return;
  for (var d = 0; d < deadEnt.dots.length; d++) {
    var dd = deadEnt.dots[d];
    if (dd.until <= GT) continue;
    applyDot(nearestRecv || pick(pool), dd.dps * pct / 100, Math.max(0.5, dd.until - GT), dd.name);
  }
}

/* ---- 施放後統一結算（castSkill 尾端呼叫）----
   機制授予（skillAmp/comboWindow/charge/freeNext）、buffExtend 族、passiveCastExtend（流光永續）、
   passiveDefFeedback 反哺層授予（守勢反哺）、cdShift 冷卻操縱、擊殺觸發（cdFlow 族）。 */
function skillRtOnSkillCast(pEnt, sk, fx, id, lv, st, out, targets, floatSel, parts, pre) {
  if (!SKILL_RT) return;
  var trig = st.skillTriggers || {};
  // --- skillAmp 族授予：skillAmp／skillAmp2（雙 scope 用第二鍵）---
  skillRtPushAmp(fx.skillAmp, id, lv);
  skillRtPushAmp(fx.skillAmp2, id, lv);
  // --- comboWindow（連環戰訣）：開新連段窗（窗內施放的重開在 skillRtPreCast）---
  if (fx.comboWindow) {
    var cwDur = fxVal(fx.comboWindow.dur, lv) || 0;
    SKILL_RT.combo = {
      until: GT + cwDur, dur: cwDur,
      pct: fxVal(fx.comboWindow.pct, lv) || 0,
      noGcd: !!fx.comboWindow.noGcd,
      count: SKILL_RT.combo ? SKILL_RT.combo.count || 0 : 0
    };
  }
  // --- stackCharge 族：建立/刷新疊層引擎（source:'cast' 同時疊層）---
  if (fx.charge) skillRtChargeOnCast(fx.charge, id, lv);
  // --- freeCast 族：freeNext 授予（心流湧動／連禱聖言／奧能梭哈 M8）---
  if (fx.freeNext) {
    var fn = fx.freeNext;
    SKILL_RT.freeCasts = {
      count: Math.max(1, Math.round(fxVal(fn.count, lv) || 1)),
      until: GT + (fxVal(fn.dur, lv) || 9999),
      scope: fn.scope,
      ampPct: fxVal(fn.ampPct, lv) || 0,
      noGcd: !!fn.noGcd,
      cdHalf: !!fn.cdHalf
    };
  }
  // --- buffExtend 族：本技的延長鍵（續光聖詠／時之錨；buffExtend2＝目標 DoT）---
  if (fx.buffExtend) skillRtExtendSelfBuffs(pEnt, fxVal(fx.buffExtend.sec, lv) || 0, !!fx.buffExtend.lowThreshold2x);
  if (fx.buffExtend2) skillRtExtendTargetDots(targets, fxVal(fx.buffExtend2.sec, lv) || 0, !!fx.buffExtend2.lowThreshold2x);
  // --- passiveCastExtend（流光永續）：每次施放「傷害技」延長自身增益（alsoDots＝同時延長目標 DoT 的秒數）---
  if (fx.dmgType && trig.passiveCastExtend) {
    var pce = trig.passiveCastExtend;
    skillRtExtendSelfBuffs(pEnt, pce.sec || 0, !!pce.lowThreshold2x);
    if (pce.alsoDots) skillRtExtendTargetDots(targets, pce.alsoDots, !!pce.lowThreshold2x);
  }
  // --- passiveDefFeedback（守勢反哺）：施放 def 技後掛 1 層反哺（消耗在傷害乘算區）---
  if (sk.cat === 'def' && trig.passiveDefFeedback) {
    var dfb = trig.passiveDefFeedback;
    var fb = SKILL_RT.feedback;
    if (!fb || fb.until <= GT) fb = SKILL_RT.feedback = { stacks: 0 };
    fb.stacks = Math.min(Math.max(1, dfb.stacks || 1), (fb.stacks || 0) + 1);
    fb.until = GT + (dfb.dur || DEF_FEEDBACK_DUR_SEC);
    fb.pct = dfb.pct || 0;
    fb.cdRefund = dfb.cdRefund || 0;
    fb.srcId = id; // M8 消耗返還冷卻的對象＝最近一次授予層的 def 技
  }
  // --- resourceConvert 族：overhealDmg.windowSec（溢流聖罰 M4）——開 N 秒轉傷窗；
  //     窗內其他治療技的溢出以「本體當級比例（夾上限後凍結）」轉真傷 ---
  if (fx.overhealDmg && fx.overhealDmg.windowSec > 0) {
    var ovCfg = fx.overhealDmg;
    var ovPct = Math.min(fxVal(ovCfg.pct, lv) || 0,
      Math.min(ovCfg.cap !== undefined ? ovCfg.cap : OVERHEAL_DMG_CAP_PCT, OVERHEAL_DMG_CAP_PCT));
    SKILL_RT.overhealWin = { until: GT + ovCfg.windowSec, pct: ovPct };
  }
  // --- cdFlow 族：cdShift（追擊號令／凜冬迴潮／竊時者）---
  if (fx.cdShift) skillRtShiftCds(pEnt, id, fx.cdShift, lv);
  // --- B 組機制族（brand 聖痕／procCast／echo 變體／periodicField）：施放後統一結算 ---
  // 置於擊殺觸發之前：重播/引動/幻影段等追加傷害造成的擊殺一併計入 out.killed
  skillRtOnCastMechB(pEnt, sk, fx, id, lv, st, out, targets, floatSel, parts);
  // --- cdFlow 族：本次施放有擊殺 → 擊殺觸發統一結算 ---
  if (out && out.killed) skillRtOnKillTriggers(pEnt, id, fx, lv, st);
}

/* ============ 45 新技能 × 11 機制族：B 組引擎 ============
   本區實作 brand（含 stigmaCycle 聖痕）／procCast／echo（含 dmgWindow／healEcho）／periodicField
   四族的引擎邏輯（含 passiveBrandAmp／passiveProc／passiveEcho／passiveExtraHit 被動觸發鍵消費）。
   共同核心＝skillRtSimpleCast「簡化傷害段」：自組 aCfg 比照 js/potential.js firePotentialLightning
   的寫法（爆擊/命中/穿透/破甲/真傷/破滅/元素附加/敵種/屬性/總傷全規格），絕不重入 castSkill——
   免耗魔、不進冷卻、不塗 DoT、不掛增益、不吸血、不引發任何 proc（天然斷遞迴），
   深度另以 SKILL_PROC_DEPTH_MAX 封頂。 */

/* ---- echo 族：dmgWindow 快照窗累計 ----
   「窗內玩家全部傷害」統一寫入端：castSkill 施放後（out.dmg 總量，含折入的引動/重播傷害）、
   doPlayerAttack depth 0（普攻含連擊折入值）、排程器結算（回響/領域跳傷/聖痕/快照窗轟出）、
   敵方 DoT 跳動（combat.js tickDots）、潛力技能（castPotentialSkill 本體／雷霆過載連鎖與
   持續轟擊／聖療逆轉溢傷，js/potential.js）各一次。 */
function skillRtAccWindowDamage(dmg) {
  if (!SKILL_RT || !SKILL_RT.dmgWindows.length) return;
  var v = Math.max(0, Number(dmg) || 0);
  if (!v) return;
  for (var i = 0; i < SKILL_RT.dmgWindows.length; i++) {
    var w = SKILL_RT.dmgWindows[i];
    if (w && w.until > GT) w.acc = (w.acc || 0) + v;
  }
}

/* ---- periodicField 族：領域內敵人受指定類型傷害增幅（takenAmpPct）----
   ampKey 為 'phys'/'magic' 時放大對應傷害類型的攻擊基準（普攻 dmgType 'both' 依鍵放大 atk/matk）；
   為元素鍵（fire 等）時放大該系的「技能屬性化本體段」（skillElemAmp）與固定值元素攻擊。
   僅玩家對敵傷害生效（aCfg.isPlayer）；
   領域為全場快照，所有存活敵人皆視為域內。套用端：castSkill 傷害段／doPlayerAttack／
   skillRtSimpleCast／領域跳傷四處共用同一函式，野外與高塔自然鏡射。
   注意：aCfg.elemAtk 可能直接引用 getStats() 快取（playerAtkCfg），放大前先淺拷貝防污染。 */
function skillRtFieldAmpACfg(aCfg, target) {
  if (!SKILL_RT || !SKILL_RT.fields.length || !aCfg || !aCfg.isPlayer) return aCfg;
  for (var i = 0; i < SKILL_RT.fields.length; i++) {
    var f = SKILL_RT.fields[i];
    if (!f || !(f.takenAmpPct > 0) || f.until <= GT) continue;
    // 增幅只對「站在領域裡」的敵人生效；未帶目標（呼叫端沒有單一受擊者）時維持原本的無條件增幅
    if (target && f.cellSet && typeof bfEntityInCells === 'function' && !bfEntityInCells(target, f.cellSet)) continue;
    var m = 1 + f.takenAmpPct / 100;
    var k = f.ampKey;
    if (k === 'phys' || k === 'magic') {
      if (aCfg.dmgType === k) aCfg.atk = (aCfg.atk || 0) * m;
      else if (aCfg.dmgType === 'both') {
        if (k === 'phys') aCfg.atk = (aCfg.atk || 0) * m;
        else aCfg.matk = (aCfg.matk || 0) * m;
      }
    } else if (k) {
      // 技能屬性化本體段：技能屬於該系時整段放大（skillElemAmp 為 resolveHit 的每系獨立乘區）
      if (aCfg.skillElem === k || (aCfg.skillElemMix && aCfg.skillElemMix[k])) {
        var amp = {};
        for (var ak in (aCfg.skillElemAmp || {})) amp[ak] = aCfg.skillElemAmp[ak];
        amp[k] = (amp[k] || 1) * m;
        aCfg.skillElemAmp = amp;
      }
      if (aCfg.elemAtk && aCfg.elemAtk[k]) {
        var cloned = {};
        for (var ek in aCfg.elemAtk) cloned[ek] = aCfg.elemAtk[ek];
        cloned[k] *= m;
        aCfg.elemAtk = cloned;
      }
    }
  }
  return aCfg;
}

/* ---- 簡化傷害段（echo／procCast／replayBest／passiveExtraHit 共用重放器）----
   以技能當級數值 × powerPct% 威力結算：混沌雙修/AOE 分攤/技能效果天賦倍率/神怒/雷霆過載照吃，
   之後走 resolveHit 全規格（真傷技能比照 castSkill 直扣分支）。
   opts = { hits 段數覆蓋, neverMiss 必中, prefix 浮字前綴, tag 傷害統計名, depth 遞迴深度 }；
   回傳 { dmg, killed, crit }。本函式不寫入 dmgWindow 累計（由呼叫端統一決定，避免重複計入）。 */
function skillRtSimpleCast(pEnt, sk, fx, lv, powerPct, targets, floatSel, opts) {
  var out = { dmg: 0, killed: false, crit: false };
  opts = opts || {};
  if ((opts.depth || 0) > SKILL_PROC_DEPTH_MAX) return out; // 遞迴深度封頂（防連鎖引動）
  if (!sk || !fx || !fx.dmgType || !(powerPct > 0)) return out;
  // 回響／重放／引動：重放的是同一支技能，命中範圍比照該技能的傷害範圍設定
  var live = skillResolveTargets(pEnt, targets, sk, fx, opts);
  if (!live.length) return out;
  var st = getStats();
  // 攻擊基準：比照 castSkill——互補加成（混沌雙修）→ AOE 分攤 → 技能效果天賦倍率 → 神怒 → 雷霆過載 → 威力%
  var atkStat;
  if (fx.dmgType === 'both') {
    atkStat = ((st.atk || 0) + (st.matk || 0)) * FUSION_BOTH_STAT_FACTOR; // 融合技雙屬性（比照 castSkill）
  } else {
    atkStat = (st[fx.stat] || st.atk);
    if ((st.crossCore || 0) > 0) atkStat += ((fx.stat === 'atk') ? (st.matk || 0) : (st.atk || 0)) * st.crossCore / 100;
  }
  var baseVal = skillDamageShare(((fx.base || 0) + (fx.per || 0) * (lv - 1)) / 100 * atkStat, st.aoeDmg || 0, live.length);
  baseVal *= skillEffectTalentMultiplier(sk);
  if ((st.passives.godWrath || 0) > 0 && pEnt.hp < st.hp * 0.3) baseVal *= 1 + st.passives.godWrath / 100;
  // §3.5 系別判定統一：雷電系＝skillElemOf（帶 lightning 標籤即算，即使無元素成分）
  var loBoost = (skillElemOf(sk, fx) === 'lightning' || (fx.elems && fx.elems.lightning))
    ? buffVal(pEnt, 'lightningOverload') : 0;
  if (loBoost > 0) baseVal *= 1 + loBoost / 100;
  baseVal *= powerPct / 100;
  var hits = opts.hits !== undefined ? opts.hits : (fx.hits || 1);
  var prefix = opts.prefix || sk.emoji;
  var tag = opts.tag || (sk.name + '·回響');
  for (var h = 0; h < hits; h++) {
    for (var ti = 0; ti < live.length; ti++) {
      var t = live[ti];
      if (t.hp <= 0) continue;
      var res;
      if (fx.dmgType === 'true') {
        // 真實傷害：無視防禦/抗性/格擋（比照 castSkill 真傷分支）
        var td = Math.max(1, Math.round(baseVal * rnd(0.95, 1.05)));
        t.hp -= td;
        res = { dmg: td, killed: t.hp <= 0, miss: false, crit: false };
        if (res.killed) t.hp = 0;
      } else {
        // 裝備固定值元素攻擊：與 castSkill 同規格附加（雷電系於雷霆過載期間同步乘算）
        var elemAtk = null;
        if (st.elemAtk) {
          for (var ea in st.elemAtk) {
            if (!st.elemAtk[ea]) continue;
            if (!elemAtk) elemAtk = {};
            var eaVal = st.elemAtk[ea];
            if (ea === 'lightning' && loBoost > 0) eaVal *= 1 + loBoost / 100;
            elemAtk[ea] = eaVal;
          }
        }
        var aCfg = {
          atk: baseVal, dmgType: fx.dmgType, level: st.level,
          critRate: st.critRate + (fx.critBonus || 0), critDmg: st.critDmg,
          hit: (fx.neverMiss || opts.neverMiss) ? 999 : Math.max(100, st.hit),
          pen: fx.dmgType === 'magic' ? effectiveMPen(st, pEnt) : effectivePPen(st, pEnt),
          sunder: st.passives.sunder || 0,
          trueDmgPct: st.passives.trueDmg || 0,
          annihilate: st.passives.annihilate || 0,
          elemAtk: elemAtk, elemDmgPct: st.elemDmgPct, elemDmgUp: st.elemDmgUp,
          eliteDmg: st.eliteDmg, bossDmg: st.bossDmg, normalDmg: st.normalDmg,
          totalDmgPct: (st.totalDmgPct || 0) + buffVal(pEnt, 'allDmgUp'),
          dmgVsElem: st.dmgVsElem, isPlayer: true
        };
        if (fx.dmgType === 'both') {
          // 融合技雙屬性：比照 castSkill 拆回物攻/魔攻兩段、雙穿透齊備
          var bothSum = (st.atk || 0) + (st.matk || 0);
          var bothRatio = bothSum > 0 ? (st.atk || 0) / bothSum : 0.5;
          aCfg.atk = baseVal * bothRatio;
          aCfg.matk = baseVal * (1 - bothRatio);
          aCfg.pen = effectivePPen(st, pEnt);
          aCfg.mPen = effectiveMPen(st, pEnt);
        }
        skillElemApplyACfg(aCfg, sk, fx); // 技能屬性化：本體傷害段整段歸屬技能屬性
        // 處決：低血量加成（重放/引動同樣適用）
        if (fx.execBelow && t.hp / t.maxHp * 100 < fx.execBelow) {
          aCfg.atk *= (fx.execMult || 2);
          if (aCfg.matk) aCfg.matk *= (fx.execMult || 2);
        }
        aCfg = skillRtFieldAmpACfg(aCfg, t); // periodicField 族：領域增幅（只對站在領域裡的目標）
        res = resolveHit(pEnt, t, aCfg, monsterDefCfg(t));
      }
      if (!res.miss) {
        out.dmg += res.dmg;
        if (res.crit) out.crit = true;
        floatEnemyEvent(t, floatSel, prefix + (res.crit ? '爆擊 ' : '') + fmt(res.dmg), (res.crit ? 'crit ' : 'dmg ') + 'enemy-skill', res.dmg);
        trackDps(res.dmg);
        if (typeof recordRunDamage === 'function') recordRunDamage(tag, res.dmg);
      } else {
        floatEnemyEvent(t, floatSel, 'MISS', 'miss enemy-dodge');
      }
      if (res.killed) out.killed = true;
    }
  }
  return out;
}

/* ---- brand 族：印記引爆（detonate）＋ 塗印（brand）----
   資料模型：敵實體 ent.brands = [{name, stored, stacks, until}]（純 JSON、until 時戳自然過期）。
   儲能端 storePct 固定值不隨級（里程碑覆蓋除外）；引爆端 multPct 走 {base,per} 小幅成長。
   passiveBrandAmp（獵殺烙印）：storeBonus 儲能加成%／keepPct 引爆不消耗機率／transferOnKill 死亡轉移。
   順序＝先引爆再塗印（萬象烙印「先引爆目標全部印記，再烙萬象印」）；引爆真傷直扣比照
   comboDetonate（不吃全局減傷）；chainPct 餘波＝每層以（該印記儲能÷層數）×N% 彈向隨機另一
   存活敵（塔內單體無彈跳對象時略過）。回傳追加傷害總量（呼叫端併入 totalDmg）。 */
function skillRtApplyBrandOps(pEnt, sk, fx, lv, st, targets, floatSel, parts, out, castDmg) {
  if (!fx.detonate && !fx.brand) return 0;
  var trig = st.skillTriggers || {};
  var pba = trig.passiveBrandAmp || null;
  var extra = 0;
  var live = (targets || []).filter(function (m) { return m && m.hp > 0; });
  // --- 引爆（detonate）：brand:'any'＝吃任何印記，指定名稱＝只吃同名 ---
  if (fx.detonate) {
    var dcfg = fx.detonate;
    var mult = fxVal(dcfg.multPct, lv) || 0;
    for (var i = 0; i < live.length; i++) {
      var t = live[i];
      if (t.hp <= 0 || effectActive(t, 'invuln') || !t.brands || !t.brands.length) continue;
      var matched = [], remain = [], sum = 0, stacksTotal = 0;
      for (var b = 0; b < t.brands.length; b++) {
        var be = t.brands[b];
        if (!be || be.until <= GT) continue; // 過期殘欄一併清除
        if (dcfg.brand === 'any' || !dcfg.brand || be.name === dcfg.brand) {
          matched.push(be); sum += be.stored; stacksTotal += be.stacks;
        } else remain.push(be);
      }
      if (!matched.length || !(sum > 0) || !(mult > 0)) continue;
      // 真傷直扣（比照 comboDetonate，不吃全局減傷）
      var boom = Math.max(1, Math.round(sum * mult / 100));
      t.hp -= boom;
      extra += boom;
      floatEnemyEvent(t, floatSel, '💥' + fmt(boom), 'crit enemy-skill', boom);
      trackDps(boom);
      if (typeof recordRunDamage === 'function') recordRunDamage(sk.name + '·引爆', boom);
      parts.push('<span class="log-hl-good">引爆印記 ' + fmt(boom) + '（' + stacksTotal + ' 層）！</span>');
      if (t.hp <= 0) { t.hp = 0; out.killed = true; }
      // 每層回復最大生命%（碎印湮滅 M8）
      if (dcfg.healPctMaxPerStack > 0 && stacksTotal > 0) {
        var perStackHeal = st.hp * dcfg.healPctMaxPerStack / 100 * stacksTotal;
        healPlayer(pEnt, perStackHeal, st);
        floatPlayerEvent(floatSel, '+' + fmt(perStackHeal), 'heal', perStackHeal);
      }
      // 引爆固定自療（萬象烙印 M8：自療最大生命%）
      if (dcfg.healPctMax > 0) {
        healPlayer(pEnt, st.hp * dcfg.healPctMax / 100, st);
        floatPlayerEvent(floatSel, '+' + fmt(st.hp * dcfg.healPctMax / 100), 'heal');
      }
      // 引爆附帶暈眩：標準控場遞減/免疫檢查
      if (dcfg.stunDur && t.hp > 0 && !isBossControlImmune(t) && !resistCtrl(monsterDefCfg(t))) {
        applyEffect(t, 'stun', dcfg.stunDur);
      }
      // chainPct 儲能餘波：每層以（該印記儲能÷層數）×N% 由近而遠彈向其他存活敵（真傷直扣）。
      // 彈跳對象取自整個戰場而不是本次技能的 targets——技能改成單體之後，
      // 若只在 targets 裡找，餘波會因為沒有第二個目標而完全打不出去。
      if (dcfg.chainPct > 0) {
        for (var mi = 0; mi < matched.length; mi++) {
          var me = matched[mi];
          var wave = Math.round((me.stacks > 0 ? me.stored / me.stacks : 0) * dcfg.chainPct / 100);
          if (!(wave > 0)) continue;
          var field = skillRtActiveEnemies(targets);
          var pool = [];
          for (var pi = 0; pi < field.length; pi++) {
            var pe = field[pi];
            if (pe && pe !== t && pe.hp > 0 && !effectActive(pe, 'invuln')) pool.push(pe);
          }
          if (!pool.length) continue; // 塔內單體 BOSS：無彈跳對象時略過
          var chain = (typeof bfChainOrder === 'function') ? bfChainOrder(t, pool, me.stacks) : [];
          for (var sw = 0; sw < me.stacks; sw++) {
            var recvT = chain[sw] || pool[sw % pool.length];
            if (!recvT || recvT.hp <= 0) continue;
            recvT.hp -= wave;
            extra += wave;
            floatEnemyEvent(recvT, floatSel, '🌊' + fmt(wave), 'dmg enemy-skill', wave);
            trackDps(wave);
            if (typeof recordRunDamage === 'function') recordRunDamage(sk.name + '·餘波', wave);
            if (recvT.hp <= 0) { recvT.hp = 0; out.killed = true; }
          }
        }
      }
      // resetCd：成功引爆後機率重置指定技能冷卻（斷罪引爆 → 烙魂連斬）
      if (dcfg.resetCd && dcfg.resetCd.id && chance(dcfg.resetCd.pct || 0)) {
        if ((pEnt.skillCds[dcfg.resetCd.id] || 0) > 0) {
          pEnt.skillCds[dcfg.resetCd.id] = 0;
          markSkillReady(pEnt, dcfg.resetCd.id);
          parts.push('<span class="log-hl-good">冷卻重置！</span>');
        }
      }
      // 消耗：keepPct（獵殺烙印）機率引爆不消耗層數；否則移除被引爆的印記
      if (!(pba && pba.keepPct > 0 && chance(pba.keepPct))) t.brands = remain;
    }
  }
  // --- 塗印（brand）：儲存本次技能總傷 × storePct%（每個存活目標儲「總傷 ÷ 目標數」的分攤份額；storeBonus 加成）---
  // 多目標分攤修正：全場儲能總量固定＝本次總傷 × storePct%，不隨敵數超線性放大
  //（PLAN §0「印記儲能端固定值」防失衡條款精神；單體時與原行為完全相同）
  if (fx.brand && castDmg > 0) {
    var bcfg = fx.brand;
    var amount = castDmg / Math.max(1, live.length) * (bcfg.storePct || 0) / 100;
    if (pba && pba.storeBonus > 0) amount *= 1 + pba.storeBonus / 100;
    if (amount > 0) {
      var maxStacks = Math.max(1, Math.round(fxVal(bcfg.maxStacks, lv) || 1));
      var bDur = fxVal(bcfg.dur, lv) || 0;
      var branded = false;
      for (var bi = 0; bi < live.length; bi++) {
        var bt = live[bi];
        if (bt.hp <= 0) continue;
        if (!bt.brands) bt.brands = [];
        var found = null;
        for (var fj = 0; fj < bt.brands.length; fj++) {
          if (bt.brands[fj].name === bcfg.name && bt.brands[fj].until > GT) { found = bt.brands[fj]; break; }
        }
        if (found) {
          // 疊層未滿：+1 層並累加儲能；已疊滿：只刷新持續（儲能封頂於滿層時的累計值，防無限堆積）
          if (found.stacks < maxStacks) { found.stacks++; found.stored += amount; }
          found.until = GT + bDur;
        } else {
          bt.brands = bt.brands.filter(function (x) { return x.until > GT; }); // 清掉過期殘欄
          bt.brands.push({ name: bcfg.name, stored: amount, stacks: 1, until: GT + bDur });
        }
        branded = true;
      }
      if (branded) parts.push('烙印【' + bcfg.name + '】');
    }
  }
  return extra;
}

/* ---- brand 族：stigmaCycle（聖痕輪迴）引爆 ----
   sg＝SKILL_RT.stigma 快照 {stored, cap, until, storePct, multPct, shieldPct, stunDur, srcId}。
   真傷＝儲傷 × multPct%（直扣第一個存活敵、比照 comboDetonate 不吃全局減傷）；
   護盾＝真傷 × shieldPct%（預設 100＝等額；沿用技能護盾上限 SHIELD_SKILL_CAP_PCT）。
   施放路徑帶 parts/out（傷害折入 out.dmg，快照窗累計由施放端統一寫入）；
   期滿路徑帶 ctx（tickSkillSchedulers 呼叫，自行寫入快照窗與 onDamage/onDeaths）。 */
function skillRtStigmaDetonate(pEnt, sg, enemies, floatSel, parts, out, ctx) {
  if (!sg || !(sg.stored > 0)) return;
  var st = getStats();
  var dmg = Math.max(1, Math.round(sg.stored * (sg.multPct || 0) / 100));
  // 引爆對象改挑「離我方最近」的敵人（原本是取陣列第一個，等同看出怪順序）
  var stigmaPool = [];
  for (var i = 0; i < (enemies ? enemies.length : 0); i++) {
    if (enemies[i] && enemies[i].hp > 0 && !effectActive(enemies[i], 'invuln')) stigmaPool.push(enemies[i]);
  }
  var t = (typeof bfPickPrimary === 'function') ? bfPickPrimary(stigmaPool, pEnt && pEnt._lockTarget)
    : (stigmaPool.length ? stigmaPool[0] : null);
  var killed = false;
  if (t) {
    t.hp -= dmg;
    floatEnemyEvent(t, floatSel, '🪬' + fmt(dmg), 'crit enemy-skill', dmg);
    trackDps(dmg);
    if (typeof recordRunDamage === 'function') recordRunDamage('聖痕引爆', dmg);
    if (t.hp <= 0) { t.hp = 0; killed = true; }
    // 引爆附帶暈眩（M8）：標準控場遞減/免疫檢查
    if (sg.stunDur && t.hp > 0 && !isBossControlImmune(t) && !resistCtrl(monsterDefCfg(t))) {
      applyEffect(t, 'stun', sg.stunDur);
    }
  }
  // 等額護盾（M8 130%）：沿用技能護盾上限（最大生命 × SHIELD_SKILL_CAP_PCT%）；無敵人時仍給盾
  var gain = dmg * (sg.shieldPct === undefined ? 100 : sg.shieldPct) / 100;
  var before = Math.max(0, pEnt.shield || 0);
  var cap = st.hp * (SHIELD_SKILL_CAP_PCT / 100);
  pEnt.shield = Math.min(Math.max(before, cap), before + gain);
  if (typeof refreshShieldMaxAfterGain === 'function') refreshShieldMaxAfterGain(pEnt, before);
  var gained = Math.max(0, pEnt.shield - before);
  if (gained > 0) floatPlayerEvent(floatSel, '🛡️+' + fmt(gained), 'shield');
  if (parts) parts.push('<span class="log-hl-good">聖痕引爆 ' + fmt(dmg) + (gained > 0 ? '＋護盾 ' + fmt(gained) : '') + '！</span>');
  if (out) {
    if (t) out.dmg = (out.dmg || 0) + dmg;
    if (killed) out.killed = true;
  } else {
    // 期滿路徑（排程器）：自行寫入快照窗累計與傷害/擊殺回報
    if (t) {
      skillRtAccWindowDamage(dmg);
      if (ctx && typeof ctx.onDamage === 'function') ctx.onDamage(dmg);
    }
    if (killed && ctx && typeof ctx.onDeaths === 'function') ctx.onDeaths();
  }
}

/* ---- procCast 族：recentBest 傷害快照（replayBest 昔日重演的重播來源）----
   每次 castSkill 直接傷害結算後記錄 {id,lv,dmg,at}；保留 REPLAY_BEST_TRACK_SEC 秒內、
   至多 RECENT_BEST_MAX_ENTRIES 筆（消費端於各自 window 內取單次傷害最高者）。 */
function skillRtRecordRecentBest(id, lv, dmg) {
  if (!SKILL_RT || !(dmg > 0)) return;
  if (!Array.isArray(SKILL_RT.recentBest)) SKILL_RT.recentBest = [];
  var list = SKILL_RT.recentBest;
  list.push({ id: id, lv: lv, dmg: dmg, at: GT });
  var keep = [];
  for (var i = Math.max(0, list.length - RECENT_BEST_MAX_ENTRIES); i < list.length; i++) {
    if (GT - list[i].at <= REPLAY_BEST_TRACK_SEC) keep.push(list[i]);
  }
  SKILL_RT.recentBest = keep;
}
// 於 windowSec 秒內取單次傷害最高的快照（無則 null）
function skillRtPickRecentBest(windowSec) {
  if (!SKILL_RT || !Array.isArray(SKILL_RT.recentBest)) return null;
  var best = null;
  for (var i = 0; i < SKILL_RT.recentBest.length; i++) {
    var r = SKILL_RT.recentBest[i];
    if (GT - r.at > windowSec) continue;
    if (!best || r.dmg > best.dmg) best = r;
  }
  return best;
}

/* ---- echo 族：以快照入列（免耗魔不進冷卻；到期走簡化傷害段重現，不再引發回響）----
   onDone(ctx, r)：結算完成回呼（殘響法則 M8 追加第二響用；第二響不帶 onDone＝不再連鎖）。 */
function skillRtQueueEcho(sk, fx, lv, powerPct, atTime, prefix, tag, onDone) {
  if (!SKILL_RT) return;
  SKILL_RT.echoQueue.push({
    at: atTime,
    resolve: function (ctx) {
      var live = ctx.getEnemies ? ctx.getEnemies() : [];
      if (!live.length) return;
      var r = skillRtSimpleCast(ctx.pEnt, sk, fx, lv, powerPct, live, ctx.floatSel, { prefix: prefix, tag: tag, depth: 1 });
      if (r.dmg > 0) {
        skillRtAccWindowDamage(r.dmg);
        if (typeof ctx.onDamage === 'function') ctx.onDamage(r.dmg);
      }
      if (r.killed && typeof ctx.onDeaths === 'function') ctx.onDeaths();
      if (typeof onDone === 'function') onDone(ctx, r);
    }
  });
}

/* ---- procCast 族：隨機挑一個已學、含傷害段（fx.dmgType）的其他主動技（含融合技；被動除外，
   潛力技能不在 G.player.skills、自然排除）。回傳 {sk, fx, lv} 或 null。 ---- */
function skillRtPickRandomDamageSkill(excludeId) {
  var pool = [];
  for (var sid in G.player.skills) {
    if (sid === excludeId) continue;
    var lv = G.player.skills[sid];
    if (!lv) continue;
    var d = skillDef(sid);
    if (!d || d.cat === 'passive') continue;
    var f = effectiveFx(sid, d, lv);
    if (!f || !f.dmgType) continue;
    pool.push({ sk: d, fx: f, lv: lv });
  }
  return pool.length ? pick(pool) : null;
}

/* ---- procCast 族：單一 proc 設定擲骰（proc／proc2 共用）----
   on：'hit'＝本次有造成傷害／'crit'＝任一段爆擊／'kill'＝本次施放有擊殺；
   do：'recast' 以 powerPct% 重放本技／'freeAttack' 引動免費普攻（depth 1、noProc、不佔攻速條）／
       'castRandom' 隨機引動一個已學含傷害段的其他主動技（powerPct% 簡化結算）。
   追加傷害/擊殺折入 out（快照窗累計由施放端統一寫入 out.dmg，避免重複計入）。 */
function skillRtRollProc(pEnt, sk, fx, id, lv, st, out, targets, floatSel, parts, cfg) {
  if (!cfg || !fx.dmgType) return;
  var on = cfg.on || 'hit';
  var condOk = on === 'kill' ? !!out.killed : (on === 'crit' ? !!out.crit : out.dmg > 0);
  if (!condOk || !chance(fxVal(cfg.pct, lv) || 0)) return;
  var powerPct = fxVal(cfg.powerPct, lv) || 0;
  var r = null, i;
  if (cfg.do === 'recast') {
    r = skillRtSimpleCast(pEnt, sk, fx, lv, powerPct, targets, floatSel, { prefix: '🔁' + sk.emoji, tag: sk.name + '·重放', depth: 1 });
    if (r.dmg > 0) parts.push('<span class="log-hl-good">重放！</span>');
  } else if (cfg.do === 'freeAttack') {
    var t = null;
    for (i = 0; i < (targets ? targets.length : 0); i++) {
      if (targets[i] && targets[i].hp > 0) { t = targets[i]; break; }
    }
    if (t) {
      r = doPlayerAttack(pEnt, t, floatSel, 1, { noProc: true, forceCrit: !!cfg.forceCrit });
      parts.push('<span class="log-hl-good">引動普攻！</span>');
    }
  } else if (cfg.do === 'castRandom') {
    var pk2 = skillRtPickRandomDamageSkill(id);
    if (pk2) {
      r = skillRtSimpleCast(pEnt, pk2.sk, pk2.fx, pk2.lv, powerPct, targets, floatSel, { prefix: '🎰' + pk2.sk.emoji, tag: pk2.sk.name + '·引動', depth: 1 });
      if (r.dmg > 0) parts.push('<span class="log-hl-good">引動【' + pk2.sk.name + '】！</span>');
    }
  }
  if (r) {
    out.dmg += r.dmg || 0;
    if (r.killed) out.killed = true;
  }
}

/* ---- periodicField 族：開領域（同名領域重新施放＝取代刷新，不疊多份）----
   快照＝施放當下的每跳攻擊值（本次施放最終 baseVal × tickPct%）與攻擊組態（爆擊/穿透/元素等定格）；
   之後每 tickSec 由 tickSkillSchedulers 以快照對「站在領域覆蓋格子裡」的存活敵各結算一次
   resolveHit（真傷技能直扣）；覆蓋格子取自 out.areaCells（castSkill 的範圍落點）。
   takenAmpPct 由 skillRtFieldAmpACfg 於各傷害端套用；ampKey＝field.elem（元素領域）或技能 dmgType。 */
function skillRtOpenField(pEnt, sk, fx, id, lv, st, out) {
  var fcfg = fx.field;
  var tickAtk = ((out && out.baseVal) || 0) * (fxVal(fcfg.tickPct, lv) || 0) / 100;
  var fDur = fxVal(fcfg.dur, lv) || 0;
  var tickSec = Math.max(0.1, fxVal(fcfg.tickSec, lv) || 1);
  var name = fcfg.name || id;
  // 屬性歸屬沿用技能本體（skillElemApplyACfg）：每跳整段即為該屬性傷害（與 castSkill 同規格）
  var snapACfg = {
    atk: tickAtk, dmgType: fx.dmgType, level: st.level,
    critRate: st.critRate + (fx.critBonus || 0), critDmg: st.critDmg,
    hit: fx.neverMiss ? 999 : Math.max(100, st.hit),
    pen: fx.dmgType === 'magic' ? effectiveMPen(st, pEnt) : effectivePPen(st, pEnt),
    sunder: st.passives.sunder || 0, trueDmgPct: st.passives.trueDmg || 0,
    annihilate: st.passives.annihilate || 0,
    elemDmgPct: st.elemDmgPct, elemDmgUp: st.elemDmgUp,
    eliteDmg: st.eliteDmg, bossDmg: st.bossDmg, normalDmg: st.normalDmg,
    totalDmgPct: (st.totalDmgPct || 0) + buffVal(pEnt, 'allDmgUp'),
    dmgVsElem: st.dmgVsElem, isPlayer: true
  };
  skillElemApplyACfg(snapACfg, sk, fx); // 技能屬性化：領域每跳同樣整段歸屬技能屬性
  var snapElem = null;
  if (st.elemAtk) {
    for (var ea in st.elemAtk) {
      if (!st.elemAtk[ea]) continue;
      if (!snapElem) snapElem = {};
      snapElem[ea] = st.elemAtk[ea];
    }
  }
  var entry = {
    name: name,
    until: GT + fDur,
    tickSec: tickSec,
    nextAt: GT + tickSec,
    elem: fcfg.elem || null,
    takenAmpPct: fcfg.takenAmpPct || 0,
    ampKey: fcfg.elem || fx.dmgType, // takenAmpPct 增幅的傷害類型鍵（元素鍵或 phys/magic）
    // 領域是「打在地上的一塊區域」：施放當下記住覆蓋的格子，之後每跳打站在那些格子裡的敵人。
    // 沒有格位資訊（高塔單體 BOSS、未載入格位模組）時 cellSet 為 null＝不設限，維持原本的全場語意。
    cellSet: (out && out.areaCells && typeof bfCellSet === 'function') ? bfCellSet(out.areaCells) : null,
    snapshot: { aCfg: snapACfg, elemAtk: snapElem, emoji: sk.emoji, tag: sk.name + '·領域', dmgType: fx.dmgType, trueTick: fx.dmgType === 'true' ? tickAtk : 0 }
  };
  entry.onTick = function (ctx) {
    var all = ctx.getEnemies ? ctx.getEnemies() : [];
    var live = entry.cellSet
      ? all.filter(function (e) { return bfEntityInCells(e, entry.cellSet); })
      : all;
    if (!live.length) return;
    var total = 0, killed = false;
    for (var i = 0; i < live.length; i++) {
      var t = live[i];
      if (!t || t.hp <= 0) continue;
      var res;
      if (entry.snapshot.dmgType === 'true') {
        // 真傷領域：直扣（比照 castSkill 真傷分支）
        var td = Math.max(1, Math.round(entry.snapshot.trueTick * rnd(0.95, 1.05)));
        t.hp -= td;
        res = { dmg: td, killed: t.hp <= 0, miss: false, crit: false };
        if (res.killed) t.hp = 0;
      } else {
        // 每跳重建一份快照組態（領域增幅會改寫欄位，避免污染快照本體）
        var aCfg = {};
        for (var k in entry.snapshot.aCfg) aCfg[k] = entry.snapshot.aCfg[k];
        if (entry.snapshot.elemAtk) {
          var em = {};
          for (var e3 in entry.snapshot.elemAtk) em[e3] = entry.snapshot.elemAtk[e3];
          aCfg.elemAtk = em;
        }
        aCfg = skillRtFieldAmpACfg(aCfg, t); // 領域增幅對領域跳傷同樣生效
        res = resolveHit(ctx.pEnt, t, aCfg, monsterDefCfg(t));
      }
      if (!res.miss) {
        total += res.dmg;
        floatEnemyEvent(t, ctx.floatSel, entry.snapshot.emoji + fmt(res.dmg), (res.crit ? 'crit ' : 'dmg ') + 'enemy-skill', res.dmg);
        trackDps(res.dmg);
        if (typeof recordRunDamage === 'function') recordRunDamage(entry.snapshot.tag, res.dmg);
      }
      if (res.killed) killed = true;
    }
    if (total > 0) {
      skillRtAccWindowDamage(total);
      if (typeof ctx.onDamage === 'function') ctx.onDamage(total);
    }
    if (killed && typeof ctx.onDeaths === 'function') ctx.onDeaths();
  };
  // 同名領域重新施放＝取代（刷新持續與快照）
  var keep = [];
  for (var fi = 0; fi < SKILL_RT.fields.length; fi++) {
    if (SKILL_RT.fields[fi] && SKILL_RT.fields[fi].name !== name) keep.push(SKILL_RT.fields[fi]);
  }
  keep.push(entry);
  SKILL_RT.fields = keep;
  // 領域特效：蓋在覆蓋到的格子上，持續時間與領域本身一致（同名重放＝重新開一次）
  emitSkillVfx(skillVfxSpec(sk, fx, null, [], (out && out.areaCells) || null,
    { fxKind: 'aura', dur: fDur }));
}

/* ---- B 組：施放後統一結算（skillRtOnSkillCast 內、擊殺觸發前呼叫）----
   順序：replayBest（先用既有快照，避免重播到本次施放）→ recentBest 記錄 → 聖痕引爆/展開 →
   proc/proc2/passiveProc/passiveExtraHit（用 out.dmg/out.crit/out.killed 聚合值擲骰）→
   echo/passiveEcho 入列 → dmgWindow/healEcho 開窗 → periodicField 開領域 →
   最後將本次施放全部傷害（含折入的追加傷害）一次寫入 dmgWindow 快照窗累計。 */
function skillRtOnCastMechB(pEnt, sk, fx, id, lv, st, out, targets, floatSel, parts) {
  if (!SKILL_RT) return;
  var trig = st.skillTriggers || {};
  var i, r;
  // --- replayBest（昔日重演）：重播最近 window 秒內單次傷害最高的技能（powerPct% 威力快照）---
  if (fx.replayBest) {
    var rb = fx.replayBest;
    var best = skillRtPickRecentBest(fxVal(rb.window, lv) || 0);
    if (best) {
      var bsk = skillDef(best.id);
      var bfx = bsk ? effectiveFx(best.id, bsk, best.lv) : null;
      if (bsk && bfx && bfx.dmgType) {
        var reps = Math.max(1, Math.round(fxVal(rb.repeat, lv) || 1));
        for (i = 0; i < reps; i++) {
          r = skillRtSimpleCast(pEnt, bsk, bfx, best.lv, fxVal(rb.powerPct, lv) || 0, targets, floatSel, { prefix: '📽️' + bsk.emoji, tag: bsk.name + '·重演', depth: 1 });
          out.dmg += r.dmg;
          if (r.killed) out.killed = true;
        }
        parts.push('<span class="log-hl-good">重演【' + bsk.name + '】×' + reps + '</span>');
      }
    }
  }
  // --- recentBest 記錄：本次施放的直接傷害快照（重放/引動不經 castSkill、不再記錄）---
  if (fx.dmgType && out.dmg > 0) skillRtRecordRecentBest(id, lv, out.dmg);
  // --- stigmaCycle（聖痕輪迴）：再施放先引爆既有聖痕，再以本次等級快照展開新聖痕 ---
  if (fx.stigma) {
    var scfg = fx.stigma;
    var sgOld = SKILL_RT.stigma;
    if (sgOld && sgOld.until > GT && sgOld.stored > 0) {
      skillRtStigmaDetonate(pEnt, sgOld, targets, floatSel, parts, out, null);
    }
    SKILL_RT.stigma = {
      stored: 0,
      cap: st.hp * ((fxVal(scfg.capMaxHpPct, lv) || 0) / 100),
      until: GT + (fxVal(scfg.dur, lv) || 0),
      storePct: scfg.storePct || 0,
      multPct: fxVal(scfg.multPct, lv) || 0,
      shieldPct: scfg.shieldPct === undefined ? 100 : scfg.shieldPct,
      stunDur: scfg.stunDur || 0,
      srcId: id
    };
    parts.push('<span class="log-hl-good">聖痕展開</span>');
  }
  // --- procCast：proc／proc2 擲骰（on hit/crit/kill × do recast/freeAttack/castRandom）---
  skillRtRollProc(pEnt, sk, fx, id, lv, st, out, targets, floatSel, parts, fx.proc);
  skillRtRollProc(pEnt, sk, fx, id, lv, st, out, targets, floatSel, parts, fx.proc2);
  // --- passiveProc（殺陣反射）：技能暴擊引動免費普攻（M4 必爆）；M8 機率改為重放本技 ---
  if (fx.dmgType && trig.passiveProc && out.crit) {
    var pp = trig.passiveProc;
    if ((pp.on || 'crit') === 'crit' && chance(pp.pct || 0)) {
      if (pp.recastPct && chance(pp.recastPct)) {
        r = skillRtSimpleCast(pEnt, sk, fx, lv, pp.recastPowerPct || 0, targets, floatSel, { prefix: '🥷' + sk.emoji, tag: sk.name + '·反射重放', depth: 1 });
        out.dmg += r.dmg;
        if (r.killed) out.killed = true;
        parts.push('<span class="log-hl-good">殺陣反射·重放！</span>');
      } else {
        var pt = null;
        for (i = 0; i < targets.length; i++) {
          if (targets[i] && targets[i].hp > 0) { pt = targets[i]; break; }
        }
        if (pt) {
          var ar = doPlayerAttack(pEnt, pt, floatSel, 1, { noProc: true, forceCrit: !!pp.forceCrit });
          if (ar) {
            out.dmg += ar.dmg || 0;
            if (ar.killed) out.killed = true;
          }
          parts.push('<span class="log-hl-good">殺陣反射！</span>');
        }
      }
    }
  }
  // --- passiveExtraHit（幻影連鋒）：多段技（hits ≥ minHits）追加幻影段（每段 powerPct% 威力、M4 必中）---
  if (fx.dmgType && trig.passiveExtraHit && out.dmg > 0) {
    var pe = trig.passiveExtraHit;
    if ((fx.hits || 1) >= (pe.minHits || 2)) {
      var pcnt = Math.max(1, Math.round(pe.count || 1));
      for (i = 0; i < pcnt; i++) {
        r = skillRtSimpleCast(pEnt, sk, fx, lv, pe.powerPct || 0, targets, floatSel, { hits: 1, neverMiss: !!pe.neverMiss, prefix: '👥' + sk.emoji, tag: sk.name + '·幻影', depth: 1 });
        out.dmg += r.dmg;
        if (r.killed) out.killed = true;
      }
    }
  }
  // --- echo（燼焰回響）：delay×1..repeat 秒後以快照威力重現（M8 回響 2 次＝2/4 秒）---
  if (fx.dmgType && fx.echo) {
    var ec = fx.echo;
    var eReps = Math.max(1, Math.round(fxVal(ec.repeat, lv) || 1));
    var ePow = fxVal(ec.powerPct, lv) || 0;
    var eDelay = Math.max(0.1, fxVal(ec.delay, lv) || 1);
    for (i = 1; i <= eReps; i++) {
      skillRtQueueEcho(sk, fx, lv, ePow, GT + eDelay * i, '🎆' + sk.emoji, sk.name + '·回響');
    }
  }
  // --- passiveEcho（殘響法則）：傷害技施放後機率入列；M8 結算成功時機率追加第二響（不再連鎖）---
  if (fx.dmgType && trig.passiveEcho && chance(trig.passiveEcho.pct || 0)) {
    (function () {
      var pec = trig.passiveEcho;
      var pDelay = Math.max(0.1, pec.delay || 2);
      skillRtQueueEcho(sk, fx, lv, pec.powerPct || 0, GT + pDelay, '🔁' + sk.emoji, sk.name + '·殘響', function (ctx2, r2) {
        if (r2 && r2.dmg > 0 && pec.secondPct && chance(pec.secondPct)) {
          skillRtQueueEcho(sk, fx, lv, pec.secondPowerPct || 0, GT + pDelay, '🔁' + sk.emoji, sk.name + '·殘響');
        }
      });
    })();
  }
  // --- dmgWindow（殘影迴斬）：開快照窗；期滿以 acc × pct% 一次轟出（真傷直扣第一個存活敵）---
  if (fx.dmgWindow) {
    (function () {
      var entry = { until: GT + (fxVal(fx.dmgWindow.dur, lv) || 0), pct: fxVal(fx.dmgWindow.pct, lv) || 0, acc: 0 };
      var wEmoji = sk.emoji, wName = sk.name;
      entry.resolve = function (ctx) {
        var boom = Math.round((entry.acc || 0) * entry.pct / 100);
        if (!(boom > 0)) return;
        var live2 = ctx.getEnemies ? ctx.getEnemies() : [];
        var winPool = [];
        for (var j = 0; j < live2.length; j++) {
          if (live2[j] && live2[j].hp > 0 && !effectActive(live2[j], 'invuln')) winPool.push(live2[j]);
        }
        // 轟出對象改挑最近的敵人（原本取陣列第一個）
        var tgt = (typeof bfPickPrimary === 'function')
          ? bfPickPrimary(winPool, ctx.pEnt && ctx.pEnt._lockTarget)
          : (winPool.length ? winPool[0] : null);
        if (!tgt) return;
        tgt.hp -= boom;
        floatEnemyEvent(tgt, ctx.floatSel, wEmoji + '🌒' + fmt(boom), 'crit enemy-skill', boom);
        trackDps(boom);
        if (typeof recordRunDamage === 'function') recordRunDamage(wName + '·快照窗', boom);
        skillRtAccWindowDamage(boom);
        if (typeof ctx.onDamage === 'function') ctx.onDamage(boom);
        if (tgt.hp <= 0) {
          tgt.hp = 0;
          if (typeof ctx.onDeaths === 'function') ctx.onDeaths();
        }
      };
      SKILL_RT.dmgWindows.push(entry);
      parts.push('<span class="log-hl-good">快照窗開啟</span>');
    })();
  }
  // --- healEcho（汲魂回響）：開治療回響窗；期滿以窗內所受傷害 × pct% 回療（溢出比照治療轉護盾）---
  if (fx.healEcho) {
    (function () {
      var entry = { until: GT + (fxVal(fx.healEcho.dur, lv) || 0), pct: fxVal(fx.healEcho.pct, lv) || 0, acc: 0 };
      entry.resolve = function (ctx) {
        var heal = (entry.acc || 0) * entry.pct / 100;
        if (!(heal > 0) || !ctx.pEnt) return;
        var st2 = getStats();
        var before = Math.max(0, ctx.pEnt.shield || 0);
        healPlayer(ctx.pEnt, heal, st2);
        floatPlayerEvent(ctx.floatSel, '🔔+' + fmt(heal), 'heal', heal);
        var gainedS = Math.max(0, (ctx.pEnt.shield || 0) - before);
        if (gainedS > 0) floatPlayerEvent(ctx.floatSel, '🛡️+' + fmt(gainedS), 'shield');
      };
      SKILL_RT.healWindows.push(entry);
    })();
  }
  // --- periodicField（劍域千鋒／焚世領域）：以施放快照開領域 ---
  if (fx.field && fx.dmgType) {
    skillRtOpenField(pEnt, sk, fx, id, lv, st, out);
    parts.push('<span class="log-hl-good">領域展開！</span>');
  }
  // --- dmgWindow 快照窗累計：本次施放全部傷害一次寫入（開窗在前＝本技自身傷害也計入自己的窗）---
  skillRtAccWindowDamage(out.dmg);
}

var SKILL_CATS = {
  phys:    { name: '物理', emoji: '⚔️' },
  magic:   { name: '魔法', emoji: '🔮' },
  def:     { name: '防禦與治療', emoji: '🛡️' },
  special: { name: '特殊', emoji: '✨' },
  passive: { name: '被動', emoji: '📿' }
};

// 技能定義查詢（含玩家自創的融合技）
/* fusions 可由呼叫端傳入（技能面板快照就有），省略才回頭讀 G。

   為什麼要能傳入：靜態的 SKILLS 表查不到時才需要融合技記錄，而那份記錄只在 G 裡。
   Worker 架構下主執行緒沒有 G，於是 `ui.js` 整個放棄呼叫 describeSkill，改用一行風味
   文字充當技能說明——**所有技能**的傷害數值、加成與「下一級」全部消失，而真正需要 G
   的其實只有融合技這一種。傳入 fusions 之後，主執行緒也能產生完整說明。

   保留 G 後備是為了不動模擬層既有呼叫點與那 116 支測試。 */
function skillDef(id, fusions) {
  if (SKILLS[id]) return SKILLS[id];
  var fs = fusions ||
    ((typeof G !== 'undefined' && G && G.player) ? G.player.fusions : null) || [];
  for (var i = 0; i < fs.length; i++) if (fs[i].id === id) return resolveFusionRecord(fs[i]);
  return null;
}
// skillMaxLv → js/formula.js §9

/* fx 欄位說明（主動）：
   dmgType phys/magic/true、stat atk/matk、base+per=傷害%（每級 per）、hits 段數
   傷害屬性由 sk.tags[0] 決定（技能屬性化，整段傷害皆為該屬性）；
   elems:{元素:權重} 融合技多屬性權重（合計 1）、elemOverride 強制改屬性（特規）
   dot:{pct,dur,name} 以技能值為基準的每秒跳傷
   stunDur/slowDur、selfDmgPct、healPctOfDmg、healPctMax、hotPct+hotDur
   shieldPctMax、buff/debuff:{key,base,per,dur}、goldPer、mpRestore
   neverMiss、critBonus、execBelow+execMult、maxHpDotPct（詛咒）
   ai：施放條件 hurt30/50/70、debuffed、always（預設有敵人就放）
   被動：fx.passive = { 屬性桶: 每級數值 }、fx.elemMult = 每級元素傷% */
var SKILLS = {
  powerSlash: { name: '強力斬', emoji: '🗡️', cat: 'phys', tags: [], unlockLv: 1, cost: 15, cd: 6, flavor: '蓄力揮出沉重的一擊。', fx: { dmgType: 'phys', stat: 'atk', base: 360, per: 80 } },
  doubleStrike: { name: '二連擊', emoji: '⚔️', cat: 'phys', tags: [], unlockLv: 1, cost: 20, cd: 8, flavor: '快速的兩段斬擊。', fx: { dmgType: 'phys', stat: 'atk', base: 210, per: 44, hits: 2 } },
  whirlwind: { name: '旋風斬', emoji: '🌪️', cat: 'phys', tags: [], unlockLv: 1, cost: 25, cd: 10, shape: '3*3', flavor: '旋轉身軀橫掃周遭。', fx: { dmgType: 'phys', stat: 'atk', base: 505, per: 110 } },
  armorBreak: { name: '破甲擊', emoji: '🔨', cat: 'phys', tags: [], unlockLv: 1, cost: 20, cd: 12, flavor: '重擊敵人的護甲弱點。', fx: { dmgType: 'phys', stat: 'atk', base: 300, per: 60, buff: { key: 'penUp', base: 25, per: 5, dur: 5 } } },
  executeStrike: { name: '處決', emoji: '💀', cat: 'phys', tags: [], unlockLv: 20, cost: 30, cd: 15, flavor: '對瀕死敵人給予終結。', fx: { dmgType: 'phys', stat: 'atk', base: 500, per: 110, execBelow: 30, execMult: 2 } },
  rendWound: { name: '撕裂', emoji: '🩸', cat: 'phys', tags: [], unlockLv: 20, cost: 18, cd: 10, flavor: '造成難以癒合的傷口。', fx: { dmgType: 'phys', stat: 'atk', base: 240, per: 50, dot: { pct: 25, dur: 5, name: '流血' } } },
  stunBlow: { name: '震盪重擊', emoji: '💫', cat: 'phys', tags: [], unlockLv: 20, cost: 25, cd: 14, flavor: '猛擊敵人使其暈眩。', fx: { dmgType: 'phys', stat: 'atk', base: 320, per: 65, stunDur: 1.5 } },
  berserkStrike: { name: '狂暴打擊', emoji: '😤', cat: 'phys', tags: [], unlockLv: 20, cost: 20, cd: 12, flavor: '不顧自身安危的猛攻。', fx: { dmgType: 'phys', stat: 'atk', base: 840, per: 170, selfDmgPct: 5 } },
  preciseThrust: { name: '精準突刺', emoji: '🎯', cat: 'phys', tags: [], unlockLv: 50, cost: 15, cd: 8, flavor: '絕不落空的致命突刺。', fx: { dmgType: 'phys', stat: 'atk', base: 300, per: 65, neverMiss: true, critBonus: 30 } },
  heavySmash: { name: '泰山壓頂', emoji: '🪨', cat: 'phys', tags: [], unlockLv: 50, cost: 28, cd: 13, flavor: '沉重的壓制性打擊。', fx: { dmgType: 'phys', stat: 'atk', base: 600, per: 130, slowDur: 3 } },
  swiftCuts: { name: '疾風連斬', emoji: '🍃', cat: 'phys', tags: [], unlockLv: 50, cost: 32, cd: 16, shape: '3*3', flavor: '化作疾風的三段斬。', fx: { dmgType: 'phys', stat: 'atk', base: 165, per: 35, hits: 3 } },
  counterStance: { name: '反擊架勢', emoji: '🔄', cat: 'phys', tags: [], unlockLv: 100, cost: 22, cd: 18, flavor: '擺出以牙還牙的架勢。', fx: { buff: { key: 'thornsUp', base: 12, per: 4, dur: 6 } } },
  soulBrandFlurry: { name: '烙魂連斬', emoji: '🪓', cat: 'phys', tags: [], unlockLv: 100, cost: 28, cd: 12, flavor: '三連斬光落下，將敵人的魂魄烙上戰印。', fx: { dmgType: 'phys', stat: 'atk', base: 145, per: 32, hits: 3, brand: { name: '魂痕', storePct: 30, dur: 8, maxStacks: 3 } } },
  sinDetonate: { name: '斷罪引爆', emoji: '🧨', cat: 'phys', tags: [], unlockLv: 100, cost: 36, cd: 16, flavor: '一擊定罪，引爆所有烙印的宿命。', fx: { dmgType: 'phys', stat: 'atk', base: 560, per: 110, detonate: { brand: 'any', multPct: { base: 120, per: 3 }, resetCd: { id: 'soulBrandFlurry', pct: 25 } } } },
  echoBlade: { name: '殘影迴斬', emoji: '🌒', cat: 'phys', tags: [], unlockLv: 150, cost: 32, cd: 15, shape: '2*2', flavor: '斬擊的殘影在剎那之後追上真實。', fx: { dmgType: 'phys', stat: 'atk', base: 520, per: 100, dmgWindow: { dur: 2, pct: 35 } } },
  warSpiritEngine: { name: '鬥氣輪轉', emoji: '🥊', cat: 'phys', tags: [], unlockLv: 150, cost: 12, cd: 5, flavor: '鬥氣隨戰意輪轉，蓄滿之刻便是爆發之時。', fx: { charge: { name: '鬥氣', add: 1, max: 3, dur: 15, source: 'attackHit', burst: { multPct: { base: 120, per: 5 }, scope: 'next' } } } },
  pursuitDecree: { name: '追擊號令', emoji: '📯', cat: 'phys', tags: [], unlockLv: 150, cost: 18, cd: 14, flavor: '號令一出，萬刃爭先。', fx: { cdShift: { scope: 'cat:phys', sec: { base: 1.5, per: 0.1 } } } },
  warOverture: { name: '破軍先聲', emoji: '⚜️', cat: 'phys', tags: [], unlockLv: 200, cost: 22, cd: 16, flavor: '先聲奪人，為最沉重的一擊鋪路。', fx: { skillAmp: { scope: 'next', dur: 8, uses: 1, perCdSec: { base: 4, per: 0.1 }, cap: 120 } } },
  woundCollapse: { name: '萬創崩裂', emoji: '💔', cat: 'phys', tags: [], unlockLv: 200, cost: 20, cd: 12, flavor: '讓所有傷口在同一瞬間崩裂。', fx: { dotPulse: { ticks: 2, powerPct: { base: 100, per: 3 } }, requiresTargetDot: true } },
  mindflowChain: { name: '連環戰訣', emoji: '🔗', cat: 'phys', tags: [], unlockLv: 300, cost: 10, cd: 15, flavor: '招式相連，戰意不絕。', fx: { comboWindow: { dur: 3, pct: { base: 25, per: 1 } } } },
  swordDomain: { name: '劍域千鋒', emoji: '🗡️', cat: 'phys', tags: [], unlockLv: 300, cost: 30, cd: 18, flavor: '千鋒出鞘，方圓皆為劍之領域。', fx: { dmgType: 'phys', stat: 'atk', base: 220, per: 45, field: { name: '劍域', dur: 6, tickSec: 1, tickPct: 25 } } },
  arcaneBurst: { name: '奧術衝擊', emoji: '🌠', cat: 'magic', tags: ['light'], unlockLv: 1, cost: 30, cd: 10, flavor: '釋放純粹的奧術能量。', fx: { dmgType: 'magic', stat: 'matk', base: 330, per: 75 } },
  fireball: { name: '火球術', emoji: '🔥', cat: 'magic', tags: ['fire'], unlockLv: 1, cost: 25, cd: 9, flavor: '投出灼熱的火球並點燃敵人。', fx: { dmgType: 'magic', stat: 'matk', base: 360, per: 80, dot: { pct: 20, dur: 4, name: '燃燒' } } },
  iceLance: { name: '寒冰槍', emoji: '❄️', cat: 'magic', tags: ['ice'], unlockLv: 1, cost: 25, cd: 9, shape: '1*3', flavor: '冰冷的長槍刺穿敵人。', fx: { dmgType: 'magic', stat: 'matk', base: 330, per: 70, slowDur: 3 } },
  chainLightning: { name: '連鎖閃電', emoji: '⚡', cat: 'magic', tags: ['lightning'], unlockLv: 1, cost: 28, cd: 11, flavor: '躍動的閃電連續劈落。', fx: { dmgType: 'magic', stat: 'matk', base: 190, per: 40, hits: 2 } },
  venomCloud: { name: '劇毒雲霧', emoji: '☠️', cat: 'magic', tags: ['poison'], unlockLv: 20, cost: 26, cd: 12, flavor: '瀰漫的毒霧侵蝕敵人。', fx: { dmgType: 'magic', stat: 'matk', base: 200, per: 40, dot: { pct: 40, dur: 6, name: '中毒' } } },
  holySmite: { name: '聖光審判', emoji: '🌟', cat: 'magic', tags: ['light'], unlockLv: 20, cost: 25, cd: 10, flavor: '聖光降下裁決並潔淨己身。', fx: { dmgType: 'magic', stat: 'matk', base: 340, per: 70, selfCleanse: true } },
  shadowBolt: { name: '暗影箭', emoji: '🌑', cat: 'magic', tags: ['dark'], unlockLv: 20, cost: 25, cd: 10, flavor: '汲取生命的暗影之矢。', fx: { dmgType: 'magic', stat: 'matk', base: 320, per: 70, healPctOfDmg: 30 } },
  arcaneBarrage: { name: '奧術彈幕', emoji: '💫', cat: 'magic', tags: ['light'], unlockLv: 20, cost: 40, cd: 15, flavor: '傾瀉四發奧術飛彈。', fx: { dmgType: 'magic', stat: 'matk', base: 135, per: 30, hits: 4 } },
  meteor: { name: '隕石術', emoji: '☄️', cat: 'magic', tags: ['fire'], unlockLv: 50, cost: 60, cd: 25, shape: 'all', flavor: '呼喚天降隕石毀滅一切。', fx: { dmgType: 'magic', stat: 'matk', base: 1260, per: 255 } },
  manaBurn: { name: '法力灼燒', emoji: '🔮', cat: 'magic', tags: ['light'], unlockLv: 50, cost: 20, cd: 8, flavor: '以法力引發劇烈爆燃，爆擊時返還法力。', fx: { dmgType: 'magic', stat: 'matk', base: 320, per: 70, mpOnCrit: 20 } },
  frostNova: { name: '霜之新星', emoji: '🧊', cat: 'magic', tags: ['ice'], unlockLv: 50, cost: 30, cd: 14, flavor: '迸發的冰環凍結敵人。', fx: { dmgType: 'magic', stat: 'matk', base: 260, per: 55, stunDur: 1 } },
  voidRift: { name: '虛空裂隙', emoji: '🕳️', cat: 'magic', tags: ['dark'], unlockLv: 100, cost: 45, cd: 18, flavor: '撕開無視一切防禦的虛空。', fx: { dmgType: 'true', stat: 'matk', base: 325, per: 70 } },
  stormSigil: { name: '雷紋刻印', emoji: '⛈️', cat: 'magic', tags: ['lightning'], unlockLv: 100, cost: 24, cd: 9, flavor: '雷紋入體，蓄勢待鳴。', fx: { dmgType: 'magic', stat: 'matk', base: 260, per: 55, brand: { name: '雷印', storePct: 35, dur: 8, maxStacks: 1 } } },
  runeShatter: { name: '碎印湮滅', emoji: '💥', cat: 'magic', tags: ['dark'], unlockLv: 100, cost: 30, cd: 12, flavor: '碎印之刻，湮滅隨行。', fx: { dmgType: 'magic', stat: 'matk', base: 300, per: 65, detonate: { brand: 'any', multPct: { base: 150, per: 3 }, chainPct: 60 } } },
  emberEcho: { name: '燼焰回響', emoji: '🎆', cat: 'magic', tags: ['fire'], unlockLv: 150, cost: 32, cd: 13, shape: '3*3', flavor: '燼焰未熄，烈火再臨。', fx: { dmgType: 'magic', stat: 'matk', base: 330, per: 70, echo: { delay: 2, powerPct: 40, repeat: 1 } } },
  infernoDomain: { name: '焚世領域', emoji: '🌋', cat: 'magic', tags: ['fire'], unlockLv: 150, cost: 45, cd: 20, flavor: '焚世之火，燎盡八荒。', fx: { dmgType: 'magic', stat: 'matk', base: 240, per: 50, field: { name: '焚世領域', dur: 6, tickSec: 1, tickPct: 25, elem: 'fire', takenAmpPct: 15 } } },
  plagueBurst: { name: '疫爆術', emoji: '🦠', cat: 'magic', tags: ['poison'], unlockLv: 150, cost: 28, cd: 14, flavor: '讓蔓延的疫病在一瞬間齊聲炸裂。', fx: { dmgType: 'magic', stat: 'matk', base: 200, per: 42, dotDetonate: { pct: { base: 80, per: 1 }, cap: 100 }, dot: { pct: 40, dur: 6, name: '瘟疫' }, requiresTargetDot: true } },
  frostResonance: { name: '霜晶共鳴', emoji: '🌨️', cat: 'magic', tags: ['ice'], unlockLv: 200, cost: 22, cd: 8, flavor: '霜晶共鳴，凜冬將至。', fx: { dmgType: 'magic', stat: 'matk', base: 240, per: 50, charge: { name: '霜晶', add: 1, max: 4, dur: 20, source: 'cast', burst: { multPct: 180, scope: 'self' } } } },
  astralConduit: { name: '星辰引導', emoji: '🔯', cat: 'magic', tags: ['light'], unlockLv: 200, cost: 20, cd: 15, flavor: '引導星辰之力，注入下一式。', fx: { skillAmp: { scope: 'next', pct: { base: 30, per: 3 }, dur: 8, uses: 1, refundPct: 40 } } },
  bloodSurge: { name: '瀝血狂濤', emoji: '🩸', cat: 'magic', tags: ['dark'], unlockLv: 300, cost: 25, cd: 16, flavor: '以血為潮，掀起狂濤。', fx: { dmgType: 'magic', stat: 'matk', base: 300, per: 65, hpSacrifice: { hpPct: 15, ampPct: { base: 80, per: 2 } } } },
  rimeTide: { name: '凜冬迴潮', emoji: '🌬️', cat: 'magic', tags: ['ice'], unlockLv: 300, cost: 26, cd: 12, flavor: '凜冬迴潮，捲回流逝的時間。', fx: { dmgType: 'magic', stat: 'matk', base: 260, per: 55, cdShift: { sec: { base: 1.5, per: 0.1 } } } },
  healWound: { name: '治癒術', emoji: '💚', cat: 'def', tags: [], unlockLv: 1, cost: 30, cd: 12, ai: 'hurt70', flavor: '溫暖的光輝癒合傷口。', fx: { healPctMax: { base: 15, per: 4 } } },
  regenerate: { name: '再生術', emoji: '🌿', cat: 'def', tags: [], unlockLv: 1, cost: 28, cd: 15, ai: 'hurt80', flavor: '持續再生的自然之力。', fx: { hotPct: { base: 2.5, per: 0.7 }, hotDur: 6 } },
  manaBarrier: { name: '魔法屏障', emoji: '🛡️', cat: 'def', tags: [], unlockLv: 1, cost: 30, cd: 15, ai: 'shield', flavor: '展開吸收傷害的屏障。', fx: { shieldPctMax: { base: 18, per: 4 } } },
  ironWall: { name: '鐵壁', emoji: '🏰', cat: 'def', tags: [], unlockLv: 1, cost: 25, cd: 18, ai: 'hurt50', flavor: '硬化全身抵禦攻擊。', fx: { buff: { key: 'defUp', base: 40, per: 10, dur: 6 } } },
  purify: { name: '淨化術', emoji: '✨', cat: 'def', tags: [], unlockLv: 20, cost: 15, cd: 10, ai: 'debuffed', flavor: '洗去身上的負面狀態。', fx: { selfCleanse: true, healPctMax: { base: 5, per: 1.5 } } },
  lifeLink: { name: '生命汲取', emoji: '🧛', cat: 'def', tags: ['dark'], unlockLv: 20, cost: 22, cd: 10, flavor: '奪取敵人的生命力。', fx: { dmgType: 'magic', stat: 'matk', base: 220, per: 50, healPctOfDmg: 100 } },
  sanctuary: { name: '庇護所', emoji: '⛪', cat: 'def', tags: [], unlockLv: 20, cost: 30, cd: 20, ai: 'hurt40', flavor: '神聖領域護佑己身。', fx: { buff: { key: 'evasionUp', base: 25, per: 5, dur: 5 } } },
  secondWind: { name: '回春氣息', emoji: '💨', cat: 'def', tags: [], unlockLv: 20, cost: 0, cd: 25, ai: 'hurt30', flavor: '危急時的求生本能（不耗魔）。', fx: { healPctMax: { base: 10, per: 3 }, mpRestore: 20 } },
  reflectShield: { name: '反射護盾', emoji: '🪞', cat: 'def', tags: [], unlockLv: 50, cost: 28, cd: 18, flavor: '反彈傷害的光盾。', fx: { buff: { key: 'thornsUp', base: 15, per: 5, dur: 6 }, buff2: { key: 'blockUp', base: 12, per: 4, dur: 6 } } },
  lastStand: { name: '背水一戰', emoji: '🚩', cat: 'def', tags: [], unlockLv: 50, cost: 35, cd: 30, ai: 'hurt25', flavor: '絕境中爆發的鬥志。', fx: { healPctMax: { base: 20, per: 5 }, buff: { key: 'atkUp', base: 15, per: 5, dur: 6 } } },
  aegisBurst: { name: '聖盾崩華', emoji: '💠', cat: 'def', tags: ['light'], unlockLv: 50, cost: 26, cd: 14, flavor: '聖盾崩華之瞬，守護化為鋒芒。', fx: { dmgType: 'magic', stat: 'matk', base: 180, per: 40, shieldBurst: { convertPct: 60, capAtkMult: 10 } } },
  overflowVerdict: { name: '溢流聖罰', emoji: '⛲', cat: 'def', tags: ['light'], unlockLv: 100, cost: 30, cd: 16, flavor: '滿溢的聖光，即是裁罰。', fx: { healPctMax: { base: 12, per: 3 }, overhealDmg: { pct: { base: 40, per: 2 }, cap: 90 } } },
  stigmaCycle: { name: '聖痕輪迴', emoji: '🪬', cat: 'def', tags: ['light'], unlockLv: 100, cost: 24, cd: 9, flavor: '承受的苦難，終將輪迴為裁決。', fx: { dmgType: 'magic', stat: 'matk', base: 200, per: 45, stigma: { storePct: 35, dur: 8, capMaxHpPct: 20, multPct: 130 } } },
  soulEcho: { name: '汲魂回響', emoji: '🔔', cat: 'def', tags: ['dark'], unlockLv: 100, cost: 24, cd: 12, flavor: '傷痛的回響，化作汲魂的甘露。', fx: { dmgType: 'magic', stat: 'matk', base: 200, per: 45, healPctOfDmg: 60, healEcho: { dur: 2, pct: { base: 40, per: 2 } } } },
  holyLitany: { name: '連禱聖言', emoji: '📜', cat: 'def', tags: ['light'], unlockLv: 150, cost: 20, cd: 18, flavor: '聖言連禱，為守護者開路。', fx: { healPctMax: { base: 6, per: 1.5 }, freeNext: { count: 1, dur: 6, scope: 'cat:def', ampPct: { base: 30, per: 2 } } } },
  sustainHymn: { name: '續光聖詠', emoji: '🎐', cat: 'def', tags: ['light'], unlockLv: 150, cost: 22, cd: 15, flavor: '聖詠不歇，恩澤長存。', fx: { healPctMax: { base: 5, per: 1.2 }, buffExtend: { sec: 2 } } },
  bastionCycle: { name: '壁壘迴環', emoji: '♻️', cat: 'def', tags: [], unlockLv: 150, cost: 28, cd: 20, ai: 'shield', flavor: '壁壘每一次震響，都是反攻的號角。', fx: { shieldPctMax: { base: 10, per: 2.5 }, cdOnHitTaken: { sec: 0.4, icdSec: 0.5 } } },
  martyrCharge: { name: '蓄怒之盾', emoji: '😤', cat: 'def', tags: [], unlockLv: 200, cost: 16, cd: 7, flavor: '承受吧——怒火終將百倍奉還。', fx: { dmgType: 'phys', stat: 'atk', base: 140, per: 30, charge: { name: '蓄怒', add: 1, max: 4, dur: 15, source: 'hitTaken', burst: { multPct: { base: 200, per: 6 }, scope: 'self' } } } },
  sanctify: { name: '聖化禱言', emoji: '🙏', cat: 'def', tags: ['light'], unlockLv: 200, cost: 25, cd: 22, flavor: '受聖化的禱言，讓守護亦能傷人。', fx: { healPctMax: { base: 8, per: 2 }, skillAmp: { scope: 'cat:def', pct: { base: 20, per: 4 }, dur: 8 } } },
  timeWarp: { name: '時間扭曲', emoji: '⏳', cat: 'special', tags: [], unlockLv: 1, cost: 35, cd: 20, flavor: '加速自身的時間流。', fx: { buff: { key: 'aspdUp', base: 25, per: 7, dur: 6 } } },
  midasTouch: { name: '點金手', emoji: '🪙', cat: 'special', tags: [], unlockLv: 1, cost: 25, cd: 20, flavor: '揮出將敵人化為財富的一擊。', fx: { dmgType: 'phys', stat: 'atk', base: 200, per: 40, goldPer: 15 } },
  treasureSense: { name: '尋寶直覺', emoji: '🔍', cat: 'special', tags: [], unlockLv: 1, cost: 30, cd: 30, flavor: '嗅出寶物的氣息。', fx: { buff: { key: 'lootUp', base: 15, per: 5, dur: 10 } } },
  weakenCurse: { name: '虛弱詛咒', emoji: '📉', cat: 'special', tags: ['dark'], unlockLv: 1, cost: 22, cd: 15, flavor: '削弱敵人的力量。', fx: { debuff: { key: 'atkDown', base: 18, per: 4, dur: 6 } } },
  deathCurse: { name: '死亡詛咒', emoji: '⚰️', cat: 'special', tags: ['dark'], unlockLv: 20, cost: 40, cd: 20, flavor: '以敵人生命為薪的詛咒。', fx: { maxHpDotPct: { base: 2.4, per: 0.8 }, dotDur: 5 } },
  blinkDodge: { name: '瞬身', emoji: '🌀', cat: 'special', tags: [], unlockLv: 20, cost: 20, cd: 16, flavor: '殘影閃避致命攻擊。', fx: { buff: { key: 'evasionUp', base: 35, per: 7, dur: 3 } } },
  mpSiphon: { name: '法力虹吸', emoji: '🌊', cat: 'special', tags: ['light'], unlockLv: 20, cost: 0, cd: 12, flavor: '從敵人身上抽取法力（不耗魔）。', fx: { dmgType: 'magic', stat: 'matk', base: 160, per: 30, mpRestore: 25 } },
  overload: { name: '超載', emoji: '💥', cat: 'special', tags: [], unlockLv: 20, cost: 30, cd: 22, flavor: '讓每次爆擊更加致命。', fx: { buff: { key: 'critDmgUp', base: 40, per: 12, dur: 6 } } },
  warcry: { name: '戰吼', emoji: '📣', cat: 'special', tags: [], unlockLv: 50, cost: 25, cd: 18, flavor: '震天的吼聲鼓舞自己、震懾敵人。', fx: { buff: { key: 'atkUp', base: 12, per: 4, dur: 6 }, debuff: { key: 'atkDown', base: 8, per: 2, dur: 6 } } },
  gamble: { name: '孤注一擲', emoji: '🎲', cat: 'special', tags: [], unlockLv: 50, cost: 30, cd: 15, flavor: '傷害在 50%~250% 之間隨機。', fx: { dmgType: 'phys', stat: 'atk', base: 375, per: 85, gamble: true } },
  fateRoulette: { name: '命運輪盤', emoji: '🎰', cat: 'special', tags: ['light'], unlockLv: 50, cost: 35, cd: 18, flavor: '命運的輪盤，永遠轉向出乎意料的一格。', fx: { dmgType: 'magic', stat: 'matk', base: 180, per: 35, proc: { on: 'hit', pct: 100, do: 'castRandom', powerPct: { base: 50, per: 2 } } } },
  bestReplay: { name: '昔日重演', emoji: '📽️', cat: 'special', tags: ['light'], unlockLv: 100, cost: 30, cd: 14, flavor: '昔日的輝煌，此刻重演。', fx: { dmgType: 'magic', stat: 'matk', base: 300, per: 60, replayBest: { powerPct: { base: 40, per: 2 }, window: 6, repeat: 1 } } },
  chronoPilfer: { name: '竊時者', emoji: '🕰️', cat: 'special', tags: ['light'], unlockLv: 100, cost: 25, cd: 20, flavor: '竊走的每一秒，都屬於最漫長的等待。', fx: { dmgType: 'magic', stat: 'matk', base: 200, per: 40, cdShift: { sec: { base: 3, per: 0.2 }, focus: 'longest' } } },
  gamblerChips: { name: '賭徒籌碼', emoji: '🃏', cat: 'special', tags: [], unlockLv: 100, cost: 20, cd: 8, flavor: '籌碼疊滿之時，就是梭哈之刻。', fx: { dmgType: 'phys', stat: 'atk', base: 150, per: 30, charge: { name: '籌碼', addRange: [1, 3], max: 5, dur: 15, source: 'cast', burst: { multPct: { base: 150, per: 4 }, scope: 'next' } } } },
  omniBrand: { name: '萬象烙印', emoji: '🔱', cat: 'special', tags: ['light'], unlockLv: 150, cost: 30, cd: 12, flavor: '萬象歸一印，一印破萬象。', fx: { dmgType: 'magic', stat: 'matk', base: 220, per: 45, detonate: { brand: 'any', multPct: { base: 200, per: 5 } }, brand: { name: '萬象印', storePct: 35, dur: 10, maxStacks: 1 } } },
  arcaneAllIn: { name: '奧能梭哈', emoji: '🎇', cat: 'special', tags: ['light'], unlockLv: 150, cost: 0, cd: 25, flavor: '傾盡所有法力，換一擊無悔（不耗魔）。', fx: { dmgType: 'magic', stat: 'matk', base: 250, per: 50, mpDump: { pctPer10Mp: { base: 2, per: 0.15 } } } },
  flowSurge: { name: '心流湧動', emoji: '🧘', cat: 'special', tags: [], unlockLv: 150, cost: 30, cd: 22, flavor: '心流湧動之間，施法再無滯礙。', fx: { freeNext: { count: 2, dur: { base: 5, per: 0.3 } } } },
  comboResonance: { name: '連段共鳴', emoji: '🎶', cat: 'special', tags: [], unlockLv: 200, cost: 25, cd: 15, flavor: '連段共鳴，段段生威。', fx: { skillAmp: { scope: 'multiHit', pct: { base: 35, per: 4 }, dur: 10 } } },
  chronoAnchor: { name: '時之錨', emoji: '⚓', cat: 'special', tags: [], unlockLv: 200, cost: 20, cd: 16, flavor: '拋下時之錨，讓美好的瞬間多留一會。', fx: { buffExtend: { sec: { base: 1.5, per: 0.15 } } } },
  toughness: { name: '堅韌體魄', emoji: '🪨', cat: 'passive', tags: [], unlockLv: 1, flavor: '生命上限提升。', fx: { passive: { hpPct: 5 } } },
  sharpBlade: { name: '利刃專精', emoji: '⚔️', cat: 'passive', tags: [], unlockLv: 1, flavor: '物理攻擊提升。', fx: { passive: { atkPct: 4 } } },
  arcaneMind: { name: '奧術心智', emoji: '🧠', cat: 'passive', tags: ['light'], unlockLv: 1, flavor: '魔法攻擊提升。', fx: { passive: { matkPct: 4 } } },
  swiftness: { name: '迅捷步伐', emoji: '💨', cat: 'passive', tags: [], unlockLv: 1, flavor: '攻擊速度提升。', fx: { passive: { aspdPct: 2 } } },
  keenEye: { name: '銳眼', emoji: '👁️', cat: 'passive', tags: [], unlockLv: 20, flavor: '暴擊率提升。', fx: { passive: { critRate: 2 } } },
  brutality: { name: '殘暴', emoji: '💢', cat: 'passive', tags: [], unlockLv: 20, flavor: '暴擊傷害提升。', fx: { passive: { critDmg: 8 } } },
  vampirism: { name: '嗜血本能', emoji: '🧛', cat: 'passive', tags: [], unlockLv: 20, flavor: '吸血提升。', fx: { passive: { lifesteal: 1.5 } } },
  meditation: { name: '冥想', emoji: '🧘', cat: 'passive', tags: [], unlockLv: 20, flavor: '法力上限與回復提升。', fx: { passive: { mpFlat: 20, mpRegen: 1 } } },
  ironSkin: { name: '鋼鐵之膚', emoji: '🛡️', cat: 'passive', tags: [], unlockLv: 50, flavor: '物理與魔法防禦提升。', fx: { passive: { defPct: 5, mdefPct: 5 } } },
  fortuneFavor: { name: '財運亨通', emoji: '🍀', cat: 'passive', tags: [], unlockLv: 50, flavor: '金幣與經驗獲取提升。', fx: { passive: { goldBonus: 5, xpBonus: 5 } } },
  phantomEcho: { name: '殘響法則', emoji: '🔁', cat: 'passive', tags: [], unlockLv: 50, flavor: '每一次出手，都可能留下殘響。', fx: { passiveEcho: { pct: { base: 15, per: 1 }, powerPct: 30, delay: 2 } } },
  reaperTempo: { name: '死神節拍', emoji: '🪦', cat: 'passive', tags: [], unlockLv: 100, flavor: '死神的節拍，催促下一次收割。', fx: { passiveKillCd: { sec: { base: 1, per: 0.05 }, icdSec: 2 } } },
  battleReflex: { name: '殺陣反射', emoji: '🥷', cat: 'passive', tags: [], unlockLv: 100, flavor: '殺意所至，身隨影動。', fx: { passiveProc: { on: 'crit', pct: { base: 20, per: 1 }, do: 'freeAttack' } } },
  virulentPulse: { name: '蝕骨頻率', emoji: '🧫', cat: 'passive', tags: ['poison'], unlockLv: 100, flavor: '讓毒與傷以更急促的頻率侵蝕。', fx: { passiveDotHaste: { mult: { base: 1.2, per: 0.02 } } } },
  zeroCadence: { name: '零式節律', emoji: '🧿', cat: 'passive', tags: [], unlockLv: 150, flavor: '歸零的節律，醞釀免費的爆發。', fx: { passiveNthFree: { n: 5, ampPct: { base: 40, per: 4 } } } },
  afterimagePursuit: { name: '幻影連鋒', emoji: '👥', cat: 'passive', tags: [], unlockLv: 150, flavor: '連斬之後，幻影仍在追擊。', fx: { passiveExtraHit: { minHits: 2, powerPct: { base: 30, per: 2 }, count: 1 } } },
  bulwarkFeedback: { name: '守勢反哺', emoji: '⚙️', cat: 'passive', tags: [], unlockLv: 150, flavor: '最堅實的防守，孕育最銳利的反擊。', fx: { passiveDefFeedback: { pct: { base: 25, per: 3 }, stacks: 1 } } },
  huntSigil: { name: '獵殺烙印', emoji: '🏹', cat: 'passive', tags: [], unlockLv: 200, flavor: '獵人的烙印，永不輕易褪去。', fx: { passiveBrandAmp: { storeBonus: { base: 20, per: 1 }, keepPct: 25 } } },
  lingeringGlow: { name: '流光永續', emoji: '🕯️', cat: 'passive', tags: [], unlockLv: 200, flavor: '流光不滅，恩澤永續。', fx: { passiveCastExtend: { sec: { base: 0.4, per: 0.05 } } } }
};

/* ================ 里程碑解鎖（豐富技能成長） ================
   前期升級只加基礎數值；達到指定等級解鎖附加效果；更高等級強化該效果。
   欄位為淺層覆蓋（同名欄位以高等級版本為準）。                        */
var UNLOCKS = {
  // 物理
  powerSlash:    { 4: { stunDur: 0.5 }, 8: { stunDur: 1, critBonus: 15 } },
  doubleStrike:  { 4: { hits: 3 }, 8: { hits: 3, healPctOfDmg: 12 } },
  whirlwind:     { 4: { slowDur: 2 }, 8: { slowDur: 3, buff: { key: 'penUp', base: 10, per: 2, dur: 4 } } },
  armorBreak:    { 4: { buff: { key: 'penUp', base: 35, per: 6, dur: 6 } }, 8: { buff: { key: 'penUp', base: 45, per: 7, dur: 8 }, stunDur: 0.5 } },
  executeStrike: { 4: { execBelow: 40 }, 8: { execBelow: 50, execMult: 2.5 } },
  rendWound:     { 4: { dot: { pct: 40, dur: 6, name: '流血' } }, 8: { dot: { pct: 55, dur: 7, name: '流血' }, healPctOfDmg: 15 } },
  stunBlow:      { 4: { stunDur: 2 }, 8: { stunDur: 2.5, debuff: { key: 'atkDown', base: 10, per: 2, dur: 4 } } },
  berserkStrike: { 4: { critBonus: 20 }, 8: { selfDmgPct: 3, critBonus: 35 } },
  preciseThrust: { 4: { critBonus: 50 }, 8: { critBonus: 50, execBelow: 25, execMult: 1.8 } },
  heavySmash:    { 4: { slowDur: 4 }, 8: { slowDur: 4, stunDur: 1 } },
  swiftCuts:     { 4: { hits: 4 }, 8: { hits: 5, dot: { pct: 15, dur: 3, name: '流血' } } },
  counterStance: { 4: { buff2: { key: 'blockUp', base: 10, per: 3, dur: 6 } }, 8: { buff: { key: 'thornsUp', base: 20, per: 6, dur: 8 } } },
  // 魔法
  arcaneBurst:   { 4: { mpOnCrit: 15 }, 8: { mpOnCrit: 15, doubleCastPct: 15 } },
  fireball:      { 4: { dot: { pct: 35, dur: 5, name: '燃燒' } }, 8: { dot: { pct: 45, dur: 6, name: '燃燒' } } },
  iceLance:      { 4: { slowDur: 4 }, 8: { slowDur: 4, stunDur: 0.8 } },
  chainLightning:{ 4: { hits: 3 }, 8: { hits: 3, doubleCastPct: 20 } },
  venomCloud:    { 4: { dot: { pct: 55, dur: 7, name: '中毒' } }, 8: { dot: { pct: 65, dur: 8, name: '中毒' }, debuff: { key: 'atkDown', base: 12, per: 2, dur: 5 } } },
  holySmite:     { 4: { healPctMax: { base: 4, per: 1 } }, 8: { healPctMax: { base: 6, per: 1.5 }, buff: { key: 'atkUp', base: 8, per: 2, dur: 5 } } },
  shadowBolt:    { 4: { healPctOfDmg: 45 }, 8: { healPctOfDmg: 55, dot: { pct: 25, dur: 4, name: '侵蝕' } } },
  arcaneBarrage: { 4: { hits: 5 }, 8: { hits: 6, mpOnCrit: 10 } },
  meteor:        { 4: { dot: { pct: 30, dur: 5, name: '燃燒' } }, 8: { dot: { pct: 40, dur: 6, name: '燃燒' }, stunDur: 1.2 } },
  manaBurn:      { 4: { mpOnCrit: 35 }, 8: { mpOnCrit: 40, buff: { key: 'penUp', base: 15, per: 3, dur: 5 } } },
  frostNova:     { 4: { stunDur: 1.5 }, 8: { stunDur: 1.5, slowDur: 4 } },
  voidRift:      { 4: { execBelow: 30, execMult: 1.5 }, 8: { execBelow: 30, execMult: 1.5, doubleCastPct: 15 } },
  // 防禦與治療
  healWound:     { 4: { selfCleanse: true }, 8: { buff: { key: 'defUp', base: 15, per: 3, dur: 4 } } },
  regenerate:    { 4: { hotDur: 8 }, 8: { hotPct: { base: 4, per: 1 }, hotDur: 8 } },
  manaBarrier:   { 4: { shieldPctMax: { base: 24, per: 5 } }, 8: { shieldPctMax: { base: 28, per: 6 }, buff: { key: 'blockUp', base: 10, per: 2, dur: 6 } } },
  ironWall:      { 4: { buff2: { key: 'thornsUp', base: 8, per: 2, dur: 6 } }, 8: { buff: { key: 'defUp', base: 55, per: 12, dur: 8 } } },
  purify:        { 4: { healPctMax: { base: 8, per: 2 } }, 8: { buff: { key: 'evasionUp', base: 15, per: 3, dur: 3 } } },
  lifeLink:      { 4: { healPctOfDmg: 130 }, 8: { healPctOfDmg: 150, dot: { pct: 30, dur: 4, name: '侵蝕' } } },
  sanctuary:     { 4: { buff2: { key: 'defUp', base: 15, per: 3, dur: 5 } }, 8: { buff: { key: 'evasionUp', base: 35, per: 6, dur: 6 } } },
  secondWind:    { 4: { mpRestore: 40 }, 8: { mpRestore: 50, healPctMax: { base: 16, per: 4 } } },
  reflectShield: { 4: { shieldPctMax: { base: 8, per: 2 } }, 8: { buff: { key: 'thornsUp', base: 25, per: 6, dur: 8 } } },
  lastStand:     { 4: { buff2: { key: 'aspdUp', base: 15, per: 3, dur: 6 } }, 8: { healPctMax: { base: 30, per: 6 } } },
  // 特殊
  timeWarp:      { 4: {}, 8: { buff: { key: 'aspdUp', base: 40, per: 9, dur: 7 } } },
  midasTouch:    { 4: { goldPer: 25 }, 8: { goldPer: 35, buff: { key: 'lootUp', base: 15, per: 3, dur: 5 } } },
  treasureSense: { 4: { buff: { key: 'lootUp', base: 22.5, per: 6, dur: 12 } }, 8: { goldPer: 5 } },
  weakenCurse:   { 4: { slowDur: 2 }, 8: { debuff: { key: 'atkDown', base: 28, per: 5, dur: 8 } } },
  deathCurse:    { 4: { dotDur: 7 }, 8: { maxHpDotPct: { base: 1.8, per: 0.5 }, dotDur: 7 } },
  blinkDodge:    { 4: { buff: { key: 'evasionUp', base: 45, per: 8, dur: 4 } }, 8: {} },
  mpSiphon:      { 4: { mpRestore: 40 }, 8: { mpRestore: 45, debuff: { key: 'atkDown', base: 10, per: 2, dur: 4 } } },
  overload:      { 4: {}, 8: { buff: { key: 'critDmgUp', base: 60, per: 15, dur: 8 } } },
  warcry:        { 4: { debuff: { key: 'atkDown', base: 12, per: 3, dur: 6 } }, 8: { buff: { key: 'atkUp', base: 18, per: 5, dur: 8 } } },
  gamble:        { 4: { critBonus: 20 }, 8: { critBonus: 20, execBelow: 35, execMult: 2 } },
  /* ---- 45 新技能 × 11 機制族：里程碑（M4/M8；2026-07-23 定案表）----
     淺層覆蓋＝整個 fx 鍵替換，故每筆里程碑均「完整重申」該鍵全部欄位；
     雙 scope 第二鍵（skillAmp2/buffExtend2/proc2/cdResetOnKill2）於 M8 同時重申兩鍵避免覆蓋丟失。 */
  // 物理
  soulBrandFlurry:{ 4: { brand: { name: '魂痕', storePct: 30, dur: 8, maxStacks: 5 } },
    8: { brand: { name: '魂痕', storePct: 45, dur: 10, maxStacks: 5 } } },
  sinDetonate:   { 4: { detonate: { brand: 'any', multPct: { base: 120, per: 3 }, stunDur: 1, resetCd: { id: 'soulBrandFlurry', pct: 25 } } },
    8: { detonate: { brand: 'any', multPct: { base: 150, per: 3 }, stunDur: 1, resetCd: { id: 'soulBrandFlurry', pct: 40 } } } },
  echoBlade:     { 4: { dmgWindow: { dur: 2, pct: 50 } },
    8: { dmgWindow: { dur: 3, pct: 50 } } },
  warSpiritEngine:{ 4: { charge: { name: '鬥氣', add: 1, addCrit: 2, max: 3, dur: 15, source: 'attackHit', burst: { multPct: { base: 120, per: 5 }, scope: 'next' } } },
    8: { charge: { name: '鬥氣', add: 1, addCrit: 2, max: 3, dur: 15, source: 'attackHit', burst: { multPct: { base: 150, per: 5 }, scope: 'next', keepStacks: 1 } } } },
  pursuitDecree: { 4: { cdShift: { sec: { base: 1.5, per: 0.1 } } },
    8: { cdShift: { sec: { base: 1.5, per: 0.1 }, extraPct: 10 } } },
  warOverture:   { 4: { skillAmp: { scope: 'next', dur: 8, uses: 2, perCdSec: { base: 4, per: 0.1 }, cap: 120 } },
    8: { skillAmp: { scope: 'next', dur: 8, uses: 2, perCdSec: { base: 4, per: 0.1 }, cap: 120, cdrPct: 20, cdrMinCd: 15 } } },
  woundCollapse: { 4: { dotPulse: { ticks: 3, powerPct: { base: 100, per: 3 } } },
    8: { dotPulse: { ticks: 3, powerPct: { base: 100, per: 3 } }, dotHaste: { mult: 2, dur: 3 } } },
  mindflowChain: { 4: { comboWindow: { dur: 4, pct: { base: 25, per: 1 } } },
    8: { comboWindow: { dur: 4, pct: { base: 25, per: 1 }, noGcd: true } } },
  swordDomain:   { 4: { field: { name: '劍域', dur: 6, tickSec: 1, tickPct: 25, takenAmpPct: 10 } },
    8: { field: { name: '劍域', dur: 6, tickSec: 0.6, tickPct: 25, takenAmpPct: 10 } } },
  // 魔法
  stormSigil:    { 4: { brand: { name: '雷印', storePct: 35, dur: 8, maxStacks: 2 } },
    8: { brand: { name: '雷印', storePct: 45, dur: 12, maxStacks: 3 } } },
  runeShatter:   { 4: { detonate: { brand: 'any', multPct: { base: 200, per: 3 }, chainPct: 60, stunDur: 0.8 } },
    8: { detonate: { brand: 'any', multPct: { base: 200, per: 3 }, chainPct: 60, stunDur: 0.8, healPctMaxPerStack: 4 } } },
  emberEcho:     { 4: { echo: { delay: 2, powerPct: 60, repeat: 1 } },
    8: { echo: { delay: 2, powerPct: 60, repeat: 2 } } },
  infernoDomain: { 4: { field: { name: '焚世領域', dur: 8, tickSec: 1, tickPct: 25, elem: 'fire', takenAmpPct: 15 } },
    8: { field: { name: '焚世領域', dur: 8, tickSec: 0.8, tickPct: 35, elem: 'fire', takenAmpPct: 15 } } },
  plagueBurst:   { 4: { dotDetonate: { pct: { base: 80, per: 1 }, cap: 100, stunDur: 0.8 } },
    8: { dotDetonate: { pct: { base: 80, per: 1 }, cap: 100, stunDur: 0.8, reapplyPct: 40 } } },
  frostResonance:{ 4: { charge: { name: '霜晶', add: 2, max: 4, dur: 20, source: 'cast', burst: { multPct: 180, scope: 'self' } } },
    8: { charge: { name: '霜晶', add: 2, max: 4, dur: 20, source: 'cast', burst: { multPct: 260, scope: 'self', stunDur: 1.2 } } } },
  astralConduit: { 4: { skillAmp: { scope: 'next', pct: { base: 30, per: 3 }, dur: 8, uses: 2, refundPct: 40 } },
    8: { skillAmp: { scope: 'next', pct: { base: 30, per: 3 }, dur: 8, uses: 2, refundPct: 40, cdrPct: 30 } } },
  bloodSurge:    { 4: { hpSacrifice: { hpPct: 15, ampPct: { base: 80, per: 2 }, hotRefundPct: 50, hotDur: 6 } },
    8: { hpSacrifice: { hpPct: 15, ampPct: { base: 80, per: 2 }, hotRefundPct: 50, hotDur: 6, dmgToShieldPct: 15 } } },
  rimeTide:      { 4: { cdResetOnKill: { pct: 30, selfReset: true, icdSec: 3 } },
    8: { cdShift: { sec: { base: 2.5, per: 0.1 } }, cdResetOnKill: { pct: 30, selfReset: true, icdSec: 3 }, cdResetOnKill2: { othersPct: 20, icdSec: 3 } } },
  // 防禦與治療
  aegisBurst:    { 4: { shieldBurst: { convertPct: 85, capAtkMult: 10 } },
    8: { shieldBurst: { convertPct: 85, capAtkMult: 10, stunDur: 1 } } },
  overflowVerdict:{ 4: { overhealDmg: { pct: { base: 40, per: 2 }, cap: 90, windowSec: 6 } },
    8: { overhealDmg: { pct: { base: 70, per: 2 }, cap: 90, windowSec: 6 } } },
  stigmaCycle:   { 4: { stigma: { storePct: 35, dur: 8, capMaxHpPct: 35, multPct: 130 } },
    8: { stigma: { storePct: 35, dur: 8, capMaxHpPct: 35, multPct: 130, shieldPct: 130, stunDur: 1 } } },
  soulEcho:      { 4: { healEcho: { dur: 2, pct: { base: 60, per: 2 } } },
    8: { healEcho: { dur: 4, pct: { base: 60, per: 2 } } } },
  holyLitany:    { 4: { freeNext: { count: 2, dur: 6, scope: 'cat:def', ampPct: { base: 30, per: 2 } } },
    8: { freeNext: { count: 2, dur: 6, scope: 'cat:def', ampPct: { base: 30, per: 2 }, cdHalf: true } } },
  sustainHymn:   { 4: { buffExtend: { sec: 3 } },
    8: { buffExtend: { sec: 3 }, buffExtend2: { sec: 3 } } },
  bastionCycle:  { 4: { cdOnHitTaken: { sec: 0.6, icdSec: 0.5 } },
    8: { cdOnHitTaken: { sec: 0.6, icdSec: 0.5, onBreak: 2 } } },
  martyrCharge:  { 4: { charge: { name: '蓄怒', add: 1, addBlock: 2, max: 4, dur: 15, source: 'hitTaken', burst: { multPct: { base: 200, per: 6 }, scope: 'self' } } },
    8: { charge: { name: '蓄怒', add: 1, addBlock: 2, max: 4, dur: 15, source: 'hitTaken', burst: { multPct: { base: 200, per: 6 }, scope: 'self', anyMultPct: 60 } } } },
  sanctify:      { 4: { skillAmp: { scope: 'cat:def', pct: { base: 20, per: 4 }, dur: 10 } },
    8: { skillAmp: { scope: 'all', pct: { base: 20, per: 4 }, dur: 10 } } },
  // 特殊
  fateRoulette:  { 4: { proc: { on: 'hit', pct: 100, do: 'castRandom', powerPct: { base: 70, per: 2 } } },
    8: { proc: { on: 'hit', pct: 100, do: 'castRandom', powerPct: { base: 70, per: 2 } }, proc2: { on: 'hit', pct: 35, do: 'castRandom', powerPct: { base: 70, per: 2 } } } },
  bestReplay:    { 4: { replayBest: { powerPct: { base: 40, per: 2 }, window: 6, repeat: 2 } },
    8: { replayBest: { powerPct: { base: 65, per: 2 }, window: 10, repeat: 2 } } },
  chronoPilfer:  { 4: { cdShift: { sec: { base: 3, per: 0.2 }, focus: 'longest', onKillRepeat: { icdSec: 2 } } },
    8: { cdShift: { sec: { base: 3, per: 0.2 }, focus: 'longest', onKillRepeat: { icdSec: 2 }, zeroSelfCdrPct: 50 } } },
  gamblerChips:  { 4: { charge: { name: '籌碼', addRange: [2, 4], max: 5, dur: 15, source: 'cast', burst: { multPct: { base: 150, per: 4 }, scope: 'next' } } },
    8: { charge: { name: '籌碼', addRange: [2, 4], max: 5, dur: 20, source: 'cast', burst: { multPct: { base: 180, per: 4 }, scope: 'next' } } } },
  omniBrand:     { 4: { brand: { name: '萬象印', storePct: 35, dur: 10, maxStacks: 2 } },
    8: { brand: { name: '萬象印', storePct: 35, dur: 10, maxStacks: 2 }, detonate: { brand: 'any', multPct: { base: 200, per: 5 }, stunDur: 1, healPctMax: 3 } } },
  arcaneAllIn:   { 4: { mpDump: { pctPer10Mp: { base: 3, per: 0.15 } } },
    8: { mpDump: { pctPer10Mp: { base: 3, per: 0.15 } }, freeNext: { count: 1, dur: 6 } } },
  flowSurge:     { 4: { freeNext: { count: 2, dur: { base: 5, per: 0.3 }, noGcd: true } },
    8: { freeNext: { count: 4, dur: { base: 5, per: 0.3 }, noGcd: true } } },
  comboResonance:{ 4: { skillAmp: { scope: 'multiHit', pct: { base: 35, per: 4 }, dur: 14 } },
    8: { skillAmp: { scope: 'multiHit', pct: { base: 35, per: 4 }, dur: 14 }, skillAmp2: { scope: 'next', pct: 30, uses: 1 } } },
  chronoAnchor:  { 4: { buffExtend2: { sec: 1.5 } },
    8: { buffExtend: { sec: { base: 3, per: 0.15 } }, buffExtend2: { sec: 1.5 } } },
  // 被動
  phantomEcho:   { 4: { passiveEcho: { pct: { base: 15, per: 1 }, powerPct: 45, delay: 2 } },
    8: { passiveEcho: { pct: { base: 15, per: 1 }, powerPct: 45, delay: 2, secondPct: 25, secondPowerPct: 50 } } },
  reaperTempo:   { 4: { passiveKillCd: { sec: { base: 1, per: 0.05 }, icdSec: 2, selfResetPct: 15 } },
    8: { passiveKillCd: { sec: { base: 1, per: 0.05 }, icdSec: 2, selfResetPct: 15, inclBasic: true } } },
  battleReflex:  { 4: { passiveProc: { on: 'crit', pct: { base: 20, per: 1 }, do: 'freeAttack', forceCrit: true } },
    8: { passiveProc: { on: 'crit', pct: { base: 20, per: 1 }, do: 'freeAttack', forceCrit: true, recastPct: 20, recastPowerPct: 40 } } },
  virulentPulse: { 4: { dotAmpPer: 6 },
    8: { dotAmpPer: 6, dotSplashOnKill: 50 } },
  zeroCadence:   { 4: { passiveNthFree: { n: 4, ampPct: { base: 40, per: 4 } } },
    8: { passiveNthFree: { n: 4, ampPct: { base: 40, per: 4 }, noGcd: true } } },
  afterimagePursuit:{ 4: { passiveExtraHit: { minHits: 2, powerPct: { base: 30, per: 2 }, count: 1, neverMiss: true } },
    8: { passiveExtraHit: { minHits: 2, powerPct: { base: 30, per: 2 }, count: 2, neverMiss: true } } },
  bulwarkFeedback:{ 4: { passiveDefFeedback: { pct: { base: 25, per: 3 }, stacks: 2 } },
    8: { passiveDefFeedback: { pct: { base: 25, per: 3 }, stacks: 2, cdRefund: 2 } } },
  huntSigil:     { 4: { passiveBrandAmp: { storeBonus: { base: 20, per: 1 }, keepPct: 40 } },
    8: { passiveBrandAmp: { storeBonus: { base: 20, per: 1 }, keepPct: 40, transferOnKill: true } } },
  lingeringGlow: { 4: { passiveCastExtend: { sec: { base: 0.4, per: 0.05 }, alsoDots: 0.5 } },
    8: { passiveCastExtend: { sec: { base: 0.4, per: 0.05 }, alsoDots: 0.5, lowThreshold2x: true } } }
};

/* ---- 潛力技能（V3；主動＝需裝入裝載欄施放、被動＝學會即常駐；經 3/4/7/10 轉「潛力」天賦節點解鎖）----
   定義存放於此以隨 Skills.xlsx（config 四表）調適；
   欄位：type active/passive/passiveTrigger；cd 冷卻秒；base 起始值；per 每級增量（無數值上限，等級上限比照一般技能＝20＋轉生×10）；
   dmgType 傷害類型；dur 主動增益持續秒；mech 對應戰鬥機制（js/potential.js / formula.js / skills.js 依此分派）。
   數值來源＝天賦V3.xlsx 第 2 頁；戰鬥公式與詮釋見 game_formula.md §潛力技能。 */
var POTENTIAL_TALENTS = [
  { id: 'velocityForce', name: '極速之力', tags: [], unlockLv: 1, en: 'Velocity Force', emoji: '⚡', cat: 'potential', type: 'active', cd: 60, base: 0, per: 5, dur: 6, mech: 'aspd', desc: '在 6 秒內突破速度極限——你的攻速在此刻可以突破 5 次/秒的限制、直抵無限，至於能達到什麼程度，得看你的領悟了。每級 +5% 攻速加成。', flavor: '突破速度極限，攻速掙脫 5 次/秒的枷鎖，能達到什麼程度端看你的領悟。' },
  { id: 'lightningOverdrive', name: '雷霆過載', tags: ['lightning'], unlockLv: 1, en: 'Lightning Overdrive', emoji: '🌩️', cat: 'potential', type: 'active', cd: 45, base: 100, per: 5, atkBase: 70000, atkPer: 4000, bounces: 5, dmgType: 'magic', dur: 8, mech: 'chainLightning', desc: '雷霆過載，萬雷臨世——凝聚過載雷能轟落敵陣，造成大量電屬性魔法傷害並於敵群間彈跳撕裂，持續時間內每一秒皆再度轟落；其間雷能縈繞不散，雷電傷害大幅提升，雷電技能命中更引動連鎖雷鏈，愈戰愈烈、生生不息。', flavor: '過載的雷能在敵群間肆意跳躍，愈是激烈愈難止息。' },
  { id: 'chronoCollapse', name: '時間坍縮', tags: [], unlockLv: 1, en: 'Chronostasis', emoji: '🕳️', cat: 'potential', type: 'active', cd: 75, base: 0, per: 0.2, dur: 3, mech: 'cdrUncap', desc: '打破時空的禁錮——冷卻縮減自此突破 60% 的天塹，所有技能的冷卻如坍縮的星辰般急速消融，持續 3 秒。每級額外 −0.2% 冷卻。（不縮減自身冷卻，但仍受一般冷卻縮減加成）', flavor: '此技能對自身冷卻不生效，但冷卻縮減仍可作用於它。' },
  { id: 'absoluteSanctuary', name: '絕對領域', tags: [], unlockLv: 1, en: 'Absolute Sanctuary', emoji: '🛡️', cat: 'potential', type: 'active', cd: 75, base: 0.5, per: 0.025, mech: 'invuln', desc: '降臨絕對的領域，展開無敵結界——其間免疫一切傷害與負面效果，任何攻擊都無法觸及你分毫。基礎 0.5 秒，每級 +0.025 秒。', flavor: '在絕對的領域中，任何傷害都無法觸及你分毫。' },
  { id: 'lastStandUndying', name: '不屈意志', tags: [], unlockLv: 1, en: 'Last Undying Stand', emoji: '💀', cat: 'potential', type: 'passiveTrigger', cd: 90, base: 0, per: 0.4, mech: 'undyingGuard', desc: '意志不屈者，縱使命懸一線亦絕不倒下——受到致命傷害時免除死亡，並獲得 1 秒無敵。觸發後進入冷卻，每級 −0.4 秒。（不受冷卻縮減影響）', flavor: '意志不屈者，縱使命懸一線也絕不倒下。（此技能不受冷卻縮減影響）' },
  { id: 'timeBarrier', name: '時間結界', tags: [], unlockLv: 1, en: 'Time Barrier', emoji: '⏱️', cat: 'potential', type: 'active', cd: 45, base: 0, per: 1, dur: 8, mech: 'enemySlow', desc: '編織拖曳時光的結界，敵人的動作被無情延緩，攻速大幅降低，持續 8 秒。每級敵人攻速 −1%。（敵降低後攻速 = 原攻速 /(1+降低%)）', flavor: '結界之內，敵人的時間被無情拖曳。' },
  { id: 'dualCoreFusion', name: '混沌雙修', tags: [], unlockLv: 1, en: 'Dual-Core Fusion', emoji: '☯️', cat: 'potential', type: 'passive', base: 0, per: 0.6, mech: 'crossCore', desc: '雙核交融，物理與魔法的界限就此崩解——所有物理技能汲取魔攻之力、所有魔法技能承載物攻之威。每級 +0.6%。', flavor: '雙核交融，物理與魔法在你手中不再涇渭分明。' },
  { id: 'omegaImpact', name: '必殺一擊', tags: [], unlockLv: 1, en: 'Omega Impact', emoji: '🎯', cat: 'potential', type: 'active', cd: 60, base: 100, per: 3, dmgType: 'phys', mech: 'omega', desc: '凝聚全身之力於一擊，依你的爆擊率轟出毀天滅地的必殺——造成「爆擊率% × 必殺傷害加成%」的物理傷害；爆擊率愈高，此擊愈是無可匹敵。必殺傷害加成 = 100% + 每級 +3%。', flavor: '爆擊率愈高，這一擊便愈是毀天滅地。' },
  { id: 'sacredInversion', name: '聖療逆轉', tags: ['light'], unlockLv: 1, en: 'Sacred Inversion', emoji: '✨', cat: 'potential', type: 'active', cd: 45, base: 0, per: 0.5, dur: 6, mech: 'sacredInvert', desc: '聖療之光賜福於身，生命與法力回復大幅提升；滿溢的療癒之力逆轉為裁決，化作同等傷害傾瀉於敵，持續 6 秒。每級 +0.5%。', flavor: '滿溢的聖光既能療癒自身，亦能化為裁決敵人的利刃。' },
  { id: 'chronosStasis', name: '時空凝滯', tags: [], unlockLv: 1, en: 'Chronos Stasis', emoji: '🌀', cat: 'potential', type: 'active', cd: 120, base: 40, per: 0.5, dur: 8, mech: 'timeStop', desc: '封鎖周遭的時空，令萬物靜止——唯有承神之賜福者能自由行動；凝滯之間你的所有傷害大幅提升，敵人動彈不得，持續 8 秒。每級 +0.5% 所有傷害。', flavor: '唯有獲得神之賜福者，方能在凝滯的時空中行動自如。' }
];

/* 取得技能的實際效果（2026-07-30 技能融合改造）：
   移除 4/8 級門檻——UNLOCKS 里程碑補丁自 Lv.1 起全數套用（依門檻由小到大淺覆蓋，
   最高檔為最終值）。lv 參數保留供呼叫端相容，不再影響補丁是否生效。 */
function effectiveFx(id, def, lv) {
  var base = def.fx;
  var patches = UNLOCKS[id];
  if (!patches) return base;
  var fx = {};
  var k;
  for (k in base) fx[k] = base[k];
  var lvs = Object.keys(patches).map(Number).sort(function (a, b) { return a - b; });
  for (var i = 0; i < lvs.length; i++) {
    var p = patches[lvs[i]];
    for (k in p) fx[k] = p[k];
  }
  return fx;
}

/* 取得技能在目前等級套用解鎖效果後的完整效果；融合技由 skillDef 即時重建。 */
function mergedSkillFx(id) {
  var def = skillDef(id);
  if (!def || !def.fx) return null;
  return effectiveFx(id, def, skillLevel(id));
}

/* 護盾舊資料正規化所需上限。狀態修正由 Worker 執行，UI 只讀取結果。 */
function currentShieldSkillCap(stats) {
  if (!stats || !(stats.hp > 0)) return 0;
  var cap = stats.hp * 20;
  if (typeof G === 'undefined' || !G.player || !Array.isArray(G.player.loadout)) return cap;
  if (typeof scaleAt !== 'function') return cap;
  for (var i = 0; i < G.player.loadout.length; i++) {
    var id = G.player.loadout[i];
    var lv = (G.player.skills && G.player.skills[id]) || 0;
    if (!id || lv <= 0) continue;
    var fx = mergedSkillFx(id);
    if (!fx || !fx.shieldPctMax) continue;
    var pct = scaleAt(fx.shieldPctMax, lv) * (1 + (stats.shieldEff || 0) / 100);
    cap = Math.max(cap, stats.hp * (1 + pct / 100));
  }
  return cap;
}

/* ui.js 的舊路徑在 Claude 移除護盾正規化前仍需委派到模擬層實作。 */
var simulationCurrentShieldSkillCap = currentShieldSkillCap;

// 下一個里程碑等級：改制後效果自 Lv.1 全附加，恆回傳 0（保留函式供既有呼叫端相容）
function nextUnlockLv(id, lv) {
  return 0;
}

/* ---- 技能點（2026-07-30 技能熟練度制）----
   技能點不再隨角色升級發放：總預算 = 初始 2 點（開局兩個 1 級技能）
   + 技能熟練度等級（每級 1 點）+ 潛力解鎖天賦加成。
   已使用：所有技能等級總和；可用 = 總預算 - 已使用。 */
var SKILL_POINT_BASE = 2; // 開局兩個 1 級技能計入的基礎點數

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
  if (leveled > 0) {
    blog('📚 技能熟練度提升至 Lv.' + m.level + '（獲得 ' + leveled + ' 技能點）', 'good');
    UI.dirty.skills = true; UI.dirty.header = true;
  }
}

function totalSkillPoints() {
  var m = ensureSkillMastery();
  var talentBonus = typeof talentSkillPointBonus === 'function' ? talentSkillPointBonus() : 0;
  return Math.max(0, SKILL_POINT_BASE + m.level + talentBonus);
}
function spentSkillPoints() {
  var spent = 0;
  if (G.player.skills) {
    for (var id in G.player.skills) spent += G.player.skills[id];
  }
  // 潛力是技能分類，沿用同一份技能點預算，不建立額外點數。
  if (typeof potentialSpentSkillPoints === 'function') spent += potentialSpentSkillPoints();
  return Math.max(0, Math.floor(spent));
}
function availableSkillPoints() {
  var available = Math.max(0, totalSkillPoints() - spentSkillPoints());
  G.player.skillPoints = available;
  return available;
}

/* ---- 查詢（skillValue / skillCdFor / scaleAt → js/formula.js §9） ---- */
function skillLevel(id) { return (G.player.skills && G.player.skills[id]) || 0; }

/* ---- 融合佔用（2026-07-30）----
   一個技能只能投入一個融合技；投入期間不可裝備、不可再融合，
   刪除該融合技後才釋放。佔用狀態由 G.player.fusions[].components 推導，不另存欄位。 */
function skillUsedInFusion(id, fusions) {
  var fs = fusions || (G && G.player && G.player.fusions) || [];
  for (var i = 0; i < fs.length; i++) {
    var comps = fs[i] && fs[i].components;
    if (Array.isArray(comps) && comps.indexOf(id) >= 0) return fs[i].id;
  }
  return null;
}

/* ---- 人物等級解鎖（達標後記錄於存檔，永久保留） ---- */
function ensureSkillUnlockState() {
  if (!G.player.skillUnlocks || typeof G.player.skillUnlocks !== 'object') G.player.skillUnlocks = {};
  return G.player.skillUnlocks;
}
function skillUnlockLevel(id) {
  var sk = skillDef(id);
  if (!sk || sk.unlockLv == null) return 0;
  return Math.max(0, Math.floor(Number(sk.unlockLv) || 0));
}
function skillUnlocked(id) {
  var sk = skillDef(id);
  if (!sk || typeof G === 'undefined' || !G.player) return false;
  var unlocks = ensureSkillUnlockState();
  if (unlocks[id] || skillLevel(id) > 0) {
    unlocks[id] = true;
    return true;
  }
  var requiredLv = skillUnlockLevel(id);
  if (requiredLv <= 0 || (Number(G.player.level) || 0) >= requiredLv) {
    unlocks[id] = true;
    return true;
  }
  return false;
}
function skillUnlockReason(id) {
  if (skillUnlocked(id)) return null;
  var requiredLv = skillUnlockLevel(id);
  return requiredLv > 0 ? '需人物達到 Lv.' + requiredLv + ' 才解鎖' : '尚未解鎖';
}
function recheckSkillUnlocksForGMLevelChange(previousLevel, nextLevel) {
  var before = Number(previousLevel) || 0;
  var after = Number(nextLevel) || 0;
  if (after >= before) return;
  var unlocks = ensureSkillUnlockState();
  for (var id in SKILLS) {
    if (skillLevel(id) > 0) {
      unlocks[id] = true;
      continue;
    }
    if (skillUnlockLevel(id) <= after) unlocks[id] = true;
    else delete unlocks[id];
  }
}

/* ---- 技能樹分類 ----
   技能不再有「前置投入點數」限制；catSpentPoints 僅供介面顯示各系已投入點數。 */
function skillTier(id) {
  var sk = SKILLS[id];
  if (!sk) return 0;
  var idx = 0;
  for (var k in SKILLS) {
    if (SKILLS[k].cat !== sk.cat) continue;
    if (k === id) break;
    idx++;
  }
  return Math.floor(idx / 6);
}
function catSpentPoints(cat) {
  var sum = 0;
  for (var id in G.player.skills) {
    var sk = SKILLS[id];
    if (sk && sk.cat === cat) sum += G.player.skills[id];
  }
  return sum;
}
// 回傳 null=可學，否則鎖定原因
function tierLockReason(id) {
  // 所有技能取消前置點數門檻；保留此查詢函式以相容既有 UI／外部呼叫。
  return null;
}

/* ---- 學習 / 升級 / 裝載 ---- */
function learnOrUpgradeSkill(id) {
  var sk = skillDef(id);
  if (!sk) return '未知技能';
  var lv = skillLevel(id);
  if (lv >= skillMaxLv(sk)) return '已達最高等級';
  var unlockLock = skillUnlockReason(id);
  if (unlockLock) return unlockLock;
  if (availableSkillPoints() <= 0) return '技能點不足';
  
  var cost = skillUpgradeCost(lv);
  if (G.player.gold < cost) return '金幣不足（需要 ' + fmt(cost) + '）';
  var lock = tierLockReason(id);
  if (lock) return lock;
  G.player.gold -= cost;
  G.player.skills[id] = lv + 1;
  if (sk.cat === 'passive') markStatsDirty();
  UI.dirty.skills = true; UI.dirty.header = true;
  blog((lv === 0 ? '📖 學會技能' : '⬆️ 技能升級') + '：' + sk.emoji + sk.name + ' Lv.' + (lv + 1) + '（消耗 ' + fmt(cost) + ' 金幣，1 技能點）', 'good');
  return null;
}

// 一鍵升到目前技能上限：逐級檢查技能點與金幣，資源不足時停在可達等級。
function maxUpgradeSkill(id) {
  var sk = skillDef(id);
  if (!sk) return '未知技能';
  var lv = skillLevel(id);
  var maxLv = skillMaxLv(sk);
  if (lv >= maxLv) return '已達最高等級';
  var unlockLock = skillUnlockReason(id);
  if (unlockLock) return unlockLock;
  var lock = tierLockReason(id);
  if (lock) return lock;
  if (availableSkillPoints() <= 0) return '技能點不足';

  var startLv = lv;
  var spentGold = 0;
  while (lv < maxLv && availableSkillPoints() > 0) {
    var cost = skillUpgradeCost(lv);
    if (G.player.gold < cost) break;
    G.player.gold -= cost;
    spentGold += cost;
    lv++;
    G.player.skills[id] = lv;
  }
  if (lv === startLv) return G.player.gold < skillUpgradeCost(lv) ? '金幣不足（需要 ' + fmt(skillUpgradeCost(lv)) + '）' : '技能點不足';

  if (sk.cat === 'passive') markStatsDirty();
  UI.dirty.skills = true; UI.dirty.header = true;
  blog('⚡ 一鍵滿級：' + sk.emoji + sk.name + ' Lv.' + startLv + ' → Lv.' + lv +
    '（消耗 ' + fmt(spentGold) + ' 金幣、' + (lv - startLv) + ' 技能點）', 'good');
  return null;
}

// 降級：退回 1 級並歸還技能點（降至 0 = 遺忘；融合技降至 0 = 回到未學習狀態，記錄保留）
function downgradeSkill(id) {
  var sk = skillDef(id);
  if (!sk) return '未知技能';
  var lv = skillLevel(id);
  if (!lv) return '尚未學習';
  var nl = lv - 1;
  if (nl <= 0) {
    delete G.player.skills[id];
    unequipSkillFromLoadout(id);
    if (UI.fuseSlots) {
      var fi = UI.fuseSlots.indexOf(id);
      if (fi >= 0) UI.fuseSlots.splice(fi, 1);
    }
    blog('↩️ 已遺忘技能：' + sk.emoji + sk.name + '（歸還 1 技能點）', 'info');
  } else {
    G.player.skills[id] = nl;
    blog('⬇️ 技能降級：' + sk.emoji + sk.name + ' Lv.' + nl + '（歸還 1 技能點）', 'info');
  }
  if (sk.cat === 'passive') markStatsDirty();
  UI.dirty.skills = true; UI.dirty.header = true;
  return null;
}

// 刪除/重置技能：等級直接歸零並退還所有已花費技能點
function deleteSkill(id) {
  var sk = skillDef(id);
  if (!sk) return '未知技能';
  var lv = skillLevel(id);
  if (!lv) return '尚未學習';
  delete G.player.skills[id];
  unequipSkillFromLoadout(id);
  if (UI.fuseSlots) {
    var fi = UI.fuseSlots.indexOf(id);
    if (fi >= 0) UI.fuseSlots.splice(fi, 1);
  }
  blog('↩️ 已一鍵刪除（重置）技能：' + sk.emoji + sk.name + '，已全額退還 ' + lv + ' 技能點。', 'info');
  if (sk.cat === 'passive') markStatsDirty();
  UI.dirty.skills = true; UI.dirty.header = true;
  return null;
}

function equipSkillToLoadout(id) {
  // 潛力技能（'potential:<id>'）：僅主動可施放型可裝載；被動潛力學會即常駐、無需裝備。
  if (typeof id === 'string' && id.indexOf('potential:') === 0) {
    var pid = id.slice(10);
    var pdef = (typeof potentialDef === 'function') ? potentialDef(pid) : null;
    if (!pdef) return '未知技能';
    if (typeof potentialEquippable !== 'function' || !potentialEquippable(pdef)) return '被動潛力技能學會即常駐，無需裝備';
    if (!potentialLevel(pid)) return '尚未學習';
    if (typeof potentialSkillActive === 'function' && !potentialSkillActive(pid)) return '潛力節點尚未解鎖';
    var plo = G.player.loadout;
    if (plo.indexOf(id) >= 0) return '已在裝載欄';
    if (plo.length >= loadoutSize()) return '裝載欄已滿（' + loadoutSize() + ' 格，初始 2 格，每 20 級再 +1 格）';
    plo.push(id);
    UI.dirty.skills = true;
    return null;
  }
  var sk = skillDef(id);
  if (!sk || sk.cat === 'passive') return '被動技能無需裝備';
  if (!skillLevel(id)) return sk.cat === 'fusion' ? '融合技需升級至 Lv.1 才可裝備' : '尚未學習';
  if (skillUsedInFusion(id)) return '技能已投入融合，無法裝備（刪除該融合技後釋放）';
  var lo = G.player.loadout;
  if (lo.indexOf(id) >= 0) return '已在裝載欄';
  if (lo.length >= loadoutSize()) return '裝載欄已滿（' + loadoutSize() + ' 格，初始 2 格，每 20 級再 +1 格）';
  lo.push(id);
  UI.dirty.skills = true;
  return null;
}
function unequipSkillFromLoadout(id) {
  var lo = G.player.loadout;
  var i = lo.indexOf(id);
  if (i >= 0) { lo.splice(i, 1); UI.dirty.skills = true; }
}

/* ---- 施放條件（AI）：fx 需傳入等級解析後的效果 ---- */
function skillConditionOk(sk, fx, pEnt, target, st) {
  var hpPct = pEnt.hp / st.hp * 100;
  switch (sk.ai) {
    case 'hurt25': if (hpPct >= 25) return false; break;
    case 'hurt30': if (hpPct >= 30) return false; break;
    case 'hurt40': if (hpPct >= 40) return false; break;
    case 'hurt50': if (hpPct >= 50) return false; break;
    case 'hurt70': if (hpPct >= 70) return false; break;
    case 'hurt80': if (hpPct >= 80) return false; break;
    case 'debuffed':
      if (!effectActive(pEnt, 'stun') && !effectActive(pEnt, 'slow') && !hasDots(pEnt)) return false;
      break;
    case 'shield':
      if ((pEnt.shield || 0) > st.hp * 0.05) return false;
      break;
  }
  // 傷害/減益類需要目標
  var hasTarget = Array.isArray(target)
    ? target.some(function (ent) { return ent && ent.hp > 0; })
    : !!(target && target.hp > 0);
  if ((fx.dmgType || skillFxDebuffList(fx).length || fx.maxHpDotPct) && !hasTarget) return false;
  // 45 新技能（dotSynergy 族）：requiresTargetDot——所有存活目標身上皆無 DoT 時不施放（萬創崩裂等）
  if (fx.requiresTargetDot) {
    var dotTargetOk = Array.isArray(target)
      ? target.some(function (ent) { return ent && ent.hp > 0 && hasDots(ent); })
      : !!(target && target.hp > 0 && hasDots(target));
    if (!dotTargetOk) return false;
  }
  /* 增益不重複疊放——僅限「純增益技」。
     傷害技的增益是附帶效果（破甲擊等的穿透增益），若因增益還在就不施放，等於白丟一次輸出，
     因此傷害技不受此閘門限制。 */
  var firstBuff = skillFxBuffList(fx)[0];
  if (firstBuff && !fx.dmgType && buffVal(pEnt, firstBuff.key) > 0) return false;
  return true;
}

// 多敵人時，技能總傷害先套用範圍傷害，再平均分配給所有敵人；單敵人維持原始傷害。
function skillDamageShare(baseDamage, aoePct, targetCount) {
  var count = Math.max(1, targetCount || 1);
  return count > 1 ? baseDamage * (1 + aoePct / 100) / count : baseDamage;
}

/* 技能效果天賦倍率（4 轉昇華天賦，talentSkillEffectMultiplier → talents.js）：
   一般類別依 sk.cat 直接對應；融合技 = 素材類別倍率的平均（舊快照無素材記錄時視為 1）。 */
function skillEffectTalentMultiplier(sk) {
  if (typeof talentSkillEffectMultiplier !== 'function' || !sk) return 1;
  if (sk.cat !== 'fusion') return talentSkillEffectMultiplier(sk.cat);
  var ids = Array.isArray(sk.components) ? sk.components : [];
  var sum = 0, n = 0;
  for (var i = 0; i < ids.length; i++) {
    var d = (typeof SKILLS !== 'undefined') ? SKILLS[ids[i]] : null;
    if (!d) continue;
    sum += talentSkillEffectMultiplier(d.cat);
    n++;
  }
  return n ? sum / n : 1;
}

/* ---- 增益/減益清單存取（2026-07-30 融合改造）----
   一般技能沿用 fx.buff/fx.buff2/fx.debuff/fx.debuff2 固定欄位；
   融合技的隨機結果不限數量，改放 fx.buffList/fx.debuffList 陣列。
   消費端（施放/說明/AI 條件）一律經由這兩個存取器，兩種形態皆支援。 */
function skillFxBuffList(fx) {
  var list = [];
  if (!fx) return list;
  if (fx.buff) list.push(fx.buff);
  if (fx.buff2) list.push(fx.buff2);
  if (Array.isArray(fx.buffList)) list = list.concat(fx.buffList);
  return list;
}
function skillFxDebuffList(fx) {
  var list = [];
  if (!fx) return list;
  if (fx.debuff) list.push(fx.debuff);
  if (fx.debuff2) list.push(fx.debuff2);
  if (Array.isArray(fx.debuffList)) list = list.concat(fx.debuffList);
  return list;
}

function applySkillDebuffs(targets, fx, lv, parts, mult) {
  mult = mult || 1;
  var debuffs = skillFxDebuffList(fx);
  debuffs.forEach(function (debuff) {
    var applied = false;
    targets.forEach(function (target) {
      if (target.hp <= 0) return;
      if (applyBuff(target, debuff.key, scaleAt(debuff, lv) * mult, debuff.dur)) applied = true;
    });
    if (applied) parts.push('<span class="log-hl-bad">敵方' + buffLabel(debuff.key) + ' -' + fmt1(scaleAt(debuff, lv) * mult) + '%</span>');
  });
}

function playerBuffFloatClass(key) {
  if (key === 'atkUp' || key === 'aspdUp' || key === 'critDmgUp' || key === 'thornsUp' ||
    key === 'matkUp' || key === 'magicUp' || key === 'penUp') return 'attack';
  if (key === 'defUp' || key === 'evasionUp' || key === 'blockUp' || key === 'hot') return 'defense';
  if (key === 'lootUp') return 'special';
  if (key === 'atkDown' || key === 'defDown') return 'debuff';
  return 'buff';
}

function showPlayerBuffFloat(floatSel, buff, lv, mult) {
  if (!buff) return;
  floatPlayerEvent(floatSel, buffLabel(buff.key) + ' +' + fmt1(skillBuffDisplayValue(buff, lv, mult)) + '%', playerBuffFloatClass(buff.key));
}

function showPlayerShieldGainAfterHeal(floatSel, pEnt, beforeShield) {
  var gainedShield = Math.max(0, ((pEnt && pEnt.shield) || 0) - beforeShield);
  if (gainedShield > 0) floatPlayerEvent(floatSel, '🛡️+' + fmt(gainedShield), 'shield');
}

/* ---- 施放執行 ---- */
/* 技能目標解析（規格「技能均需要指定目標與範圍」）——
   把「候選敵人池」收斂成本次實際命中的目標：
     單體（預設，未填傷害範圍）：最近的一個；挑法與普攻相同（同距離隨機、鎖定後不換）
     2x2 / 3x3                ：以主目標為準的方框，框內敵人全部命中（BOSS 佔多格仍只算 1 次）
     all                      ：全場（規格：以棋盤中心為目標施放，對所有敵人造成傷害）
   額外觸發的傷害（引爆／濺射／連鎖／回響）不經過這裡，因此不影響單體／群體的判定。
   傳入單一實體（高塔 BOSS 等）時原樣使用；opts.exactTargets 供呼叫端自行選定目標時略過收斂。
   範圍展開規則 → js/battlefield.js */
function skillResolvePlacement(pEnt, target, sk, fx, opts) {
  if (!Array.isArray(target)) {
    var one = (target && target.hp > 0) ? [target] : [];
    return { targets: one, cells: null };
  }
  var pool = target.filter(function (ent) { return ent && ent.hp > 0; });
  if (!pool.length) return { targets: [], cells: null };
  if ((opts && opts.exactTargets) || typeof bfAreaPlacement !== 'function') return { targets: pool, cells: null };
  var shape = (fx && fx.shape) || (sk && sk.shape) || 'single';
  var primary = bfPickPrimary(pool, pEnt && pEnt._lockTarget);
  if (!primary) return { targets: [], cells: null };
  return bfAreaPlacement(primary, pool, shape);
}
function skillResolveTargets(pEnt, target, sk, fx, opts) {
  return skillResolvePlacement(pEnt, target, sk, fx, opts).targets;
}

/* 場上目前的敵人（連鎖／濺射／餘波等「往旁邊擴散」的效果用）——
   這類效果的範圍不是技能的傷害範圍，而是整個戰場：技能改成單體之後，
   若沿用技能自己的 targets，場上還有別的敵人也會彈不出去。
   比照 legendary.js 的 legendaryActiveEnemies：高塔戰用 BOSS，野外用存活敵人清單。 */
function skillRtActiveEnemies(fallback) {
  if (typeof G !== 'undefined' && G && G.tower && G.tower.active &&
      typeof TOWER !== 'undefined' && TOWER.boss && TOWER.boss.hp > 0) return [TOWER.boss];
  if (typeof liveFieldEnemies === 'function') {
    var live = liveFieldEnemies();
    if (live && live.length) return live;
  }
  return (fallback || []).filter(function (e) { return e && e.hp > 0; });
}

/* ---- 技能特效（新版戰鬥「每個技能與 buff 都要有簡易特效」）----
   模擬層只負責「發生了什麼」，畫法在 js/vfx.js。特效種類**不逐一手寫**，而是由技能既有的
   資料推導：範圍決定形狀、系統分類與屬性決定顏色、技能自己的 emoji 當投射物圖案。
   這樣新增技能不必補特效表，改了傷害範圍特效也會跟著變。

   個別技能要特規時再於 SKILL_VFX_OVERRIDE 覆寫，不必動這裡的推導規則。 */
var SKILL_VFX_OVERRIDE = {
  // 多刀類：投射物打散成多發，看起來才像「射出一排飛刀」
  shadowStrike: { fxKind: 'projectile', count: 3 },
  swiftCuts: { fxKind: 'slash', count: 3 },
  // 天降類：即使不是全場技，表現上也是從天而降
  meteor: { fxKind: 'rain' },
  holySmite: { fxKind: 'rain' }
};

function skillVfxColor(sk, fx) {
  var elem = (typeof skillElemOf === 'function') ? skillElemOf(sk, fx) : null;
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
   targetIds 由呼叫端以 enemyEventFloatTarget 解析完成；cells 為範圍落點（非區域類傳 null）。 */
function skillVfxSpec(sk, fx, shape, targetIds, cells, extra) {
  var spec = {
    fxKind: skillVfxKind(sk, fx, shape),
    glyph: (sk && sk.emoji) || '✨',
    color: skillVfxColor(sk, fx),
    targets: targetIds || [],
    cells: cells || null,
    dur: 0.5,
    count: Math.max(1, Math.min(5, (fx && fx.hits) || 1))
  };
  var ov = sk && SKILL_VFX_OVERRIDE[sk.id];
  if (ov) for (var k in ov) spec[k] = ov[k];
  if (extra) for (var k2 in extra) spec[k2] = extra[k2];
  if (spec.fxKind === 'rain') spec.dur = 0.75;
  if (spec.fxKind === 'aura') spec.count = 1;
  return spec;
}

/* 送出特效事件；Worker 端由 shim 轉成協議事件，Node 測試環境沒有這支就靜靜略過。 */
function emitSkillVfx(spec) {
  if (spec && typeof playCombatVfx === 'function') playCombatVfx(spec);
}

/* 每個目標的投射物飛行時間（毫秒），與 targets 同順序。
   等速飛行：距離 ÷ 速度 → js/battlefield.js bfTravelSeconds。
   純數字陣列，可以安全地送過協議（不含任何實體參照）。 */
function skillVfxTravelMs(targetEnts) {
  if (typeof bfTravelSeconds !== 'function') return null;
  return (targetEnts || []).map(function (ent) { return Math.round(bfTravelSeconds(ent) * 1000); });
}

/* 傷害數字要等「打到人」才跳出來，不是技能一放就跳。
   模擬層在一瞬間把整段傷害結算完（含多段與連擊），但畫面上：
     ・投射物要飛 → 依「該目標」的距離往後推（站第 4 行的比第 1 行晚）
     ・多段技（例：奧術彈幕 4 段）是一發一發打 → 每段再往後錯開一點
   斬擊／爆發／貫穿是當場發生，不需要飛行時間。
   回傳毫秒；顯示端據此延後浮字，戰鬥結果完全不受影響。 */
function skillVfxImpactDelayMs(spec, hitIndex, targetIndex) {
  var stagger = (typeof VFX_HIT_STAGGER_SEC === 'number') ? VFX_HIT_STAGGER_SEC : 0.09;
  var travelSec = 0;
  if (spec && (spec.fxKind === 'projectile' || spec.fxKind === 'rain')) {
    var list = spec.travelMs;
    var per = (list && list[targetIndex || 0] >= 0) ? list[targetIndex || 0] / 1000 : null;
    travelSec = (per === null) ? (spec.dur || 0) : per;
  }
  return Math.round((travelSec + Math.max(0, hitIndex || 0) * stagger) * 1000);
}

function castSkill(pEnt, target, id, lv, floatSel, statSlot, opts) {
  var sk = skillDef(id);
  var fx = effectiveFx(id, sk, lv);
  var st = getStats();
  var placement = skillResolvePlacement(pEnt, target, sk, fx, opts);
  var targets = placement.targets;
  var targetCount = Math.max(1, targets.length);
  var legendaryPrep = (typeof legendaryPrepareSkillCast === 'function')
    ? legendaryPrepareSkillCast(pEnt, targets, id, sk, fx, lv, st, opts)
    : { fx: fx, effectMult: 1, cdMult: 1, manaCost: null, repeat: 1 };
  fx = legendaryPrep.fx;
  // 45 新技能：施放前置（freeCast 族免費判定／零式節律計數／連段窗判定）——必須在扣魔與寫入冷卻/GCD 前完成
  var rtPre = skillRtPreCast(pEnt, sk, fx, id, lv, st);
  var isFreeCast = rtPre.free || !!(opts && opts.free);
  var manaCost = legendaryPrep.manaCost === null
    ? ((typeof legendarySkillManaCost === 'function') ? legendarySkillManaCost(pEnt, id, sk, lv, st) : skillManaCost(sk, lv))
    : legendaryPrep.manaCost;
  if (!isFreeCast) {
    pEnt.mp -= manaCost;
    if (typeof legendaryOnManaSpent === 'function') legendaryOnManaSpent(pEnt, manaCost, st, floatSel);
  }
  if (!pEnt.skillCds) pEnt.skillCds = {};
  if (!(opts && opts.noCooldown)) {
    pEnt.skillCds[id] = skillCdFor(sk, buffVal(pEnt, 'chronoCdr')) * (legendaryPrep.cdMult || 1); // 潛力【時間坍縮】：施放時額外 CDR
    if (rtPre.cdHalf) pEnt.skillCds[id] *= 0.5; // 45 新技能（freeCast 族）：受惠技冷卻減半（連禱聖言 M8）
  }
  // 技能只佔用技能 GCD；普攻有自己的 atkCd，與技能施放並行，不受技能施放影響。
  pEnt.skillGcd = (rtPre.noGcd || (opts && opts.noGcd)) ? 0 : SKILL_GLOBAL_COOLDOWN; // 45 新技能（freeCast 族）：免 GCD 施放
  // areaCells＝本次施放打在地上的那塊區域（領域類效果據此決定之後每跳打哪些格）
  var out = { killed: false, dmg: 0, areaCells: placement.cells };
  // 特效：施放當下就發（不等結算），因為玩家看到的是「技能放出去了」，
  // 全部被閃避也一樣要有畫面。目標一律轉成浮字圖層 id，不帶實體參照。
  var vfxExtra = { travelMs: skillVfxTravelMs(targets) };
  if (!targets.length) vfxExtra.targets = [playerEventFloatTarget(floatSel)];
  var vfxSpec = skillVfxSpec(sk, fx, (fx && fx.shape) || (sk && sk.shape),
    targets.map(function (t) { return enemyEventFloatTarget(t, floatSel); }),
    placement.cells, vfxExtra);
  emitSkillVfx(vfxSpec);
  var logMsg = sk.emoji + ' 你施放【' + sk.name + ' Lv.' + lv + '】，';
  var parts = [];
  // 5 轉昇華天賦：技能所有效果（傷害/治療/護盾/增益/減益/再生/詛咒/金幣/法力）共用此倍率；融合技=素材平均
  var fxMult = skillEffectTalentMultiplier(sk);
  fxMult *= legendaryPrep.effectMult || 1;
  if (!fx.dmgType && legendaryPrep.repeat > 1) fxMult *= legendaryPrep.repeat;
  // 45 新技能（freeCast 族）：免費施放附帶的效果增幅——併入 fxMult（傷害/治療/護盾/增益全效果同乘，
  // 涵蓋連禱聖言「受惠 def 技效果 +N%」與零式節律「該次 +N%」語意）
  if (rtPre.ampPct) fxMult *= 1 + rtPre.ampPct / 100;
  if (isFreeCast) parts.push('<span class="log-hl-good">免費施放！</span>');

  // === 傷害段 ===
  if (fx.dmgType) {
    // 潛力【混沌雙修】：物理技能額外獲得魔攻加成、魔法技能額外獲得物攻加成（互補加成）。
    var atkStat;
    if (fx.dmgType === 'both') {
      // 融合技「物理+魔法」結果：物攻與魔攻兩段各以 傷害% × FUSION_BOTH_STAT_FACTOR 結算
      //（resolveHit 的 'both' 分支各自過物防/魔防；混沌雙修不再另外互補，雙段已天然兼得）
      atkStat = ((st.atk || 0) + (st.matk || 0)) * FUSION_BOTH_STAT_FACTOR;
    } else {
      atkStat = (st[fx.stat] || st.atk);
      if ((st.crossCore || 0) > 0) {
        var crossStat = (fx.stat === 'atk') ? (st.matk || 0) : (st.atk || 0);
        atkStat += crossStat * st.crossCore / 100;
      }
    }
    var rawBaseVal = ((fx.base || 0) + (fx.per || 0) * (lv - 1)) / 100 * atkStat;
    var baseVal = skillDamageShare(rawBaseVal, st.aoeDmg || 0, targetCount);
    baseVal *= fxMult;
    // 神鑄特效【神怒】：生命低於 30% 時技能傷害同步提高
    if ((st.passives.godWrath || 0) > 0 && pEnt.hp < st.hp * 0.3) baseVal *= 1 + st.passives.godWrath / 100;
    if (fx.gamble) baseVal *= rnd(0.33, 1.67); // 孤注一擲：50%~250% 相對波動
    // 潛力【雷霆過載】：期間雷電系技能「整體傷害」乘算提高（先吃滿所有攻擊/魔法加成，之後照常吃爆擊、全傷、元素等加成）。
    // §3.5 系別判定統一：雷電系＝skillElemOf（帶 lightning 標籤即算，即使無元素成分）
    var loBoost = (skillElemOf(sk, fx) === 'lightning' || (fx.elems && fx.elems.lightning))
      ? buffVal(pEnt, 'lightningOverload') : 0;
    if (loBoost > 0) baseVal *= 1 + loBoost / 100;
    // === 45 新技能：傷害乘算統一區（skillAmp 消耗／連段窗／守勢反哺／stackCharge 引爆／resourceConvert／dotAmpPer；
    //     lightningOverdrive 增幅旁，全部乘算集中於 baseVal 段）；flat（護盾引爆追加傷害）比照技能傷害分攤 ===
    var rtAmp = skillRtApplyDamageAmps(pEnt, sk, fx, id, lv, st, targets, rtPre, parts, floatSel);
    baseVal = baseVal * rtAmp.mult + skillDamageShare(rtAmp.flat * fxMult, st.aoeDmg || 0, targetCount);
    out.baseVal = baseVal; // 45 新技能（periodicField 族）：領域每跳傷害的施放快照基準值
    var hits = (fx.hits || 1) * Math.max(1, legendaryPrep.repeat || 1);
    // 雙重施法（奧術過載等）：追加一段
    if (fx.doubleCastPct && chance(fx.doubleCastPct)) { hits++; parts.push('<span class="log-hl-good">雙重施法！</span>'); }
    var totalDmg = 0, anyCrit = false, allMiss = true;
    // 連擊數（暴擊率破 100% 衍生）：僅對技能「直接傷害段」整段重複；DoT／減益／吸血在此迴圈外一次結算，故持續傷害不受連擊影響
    var comboReps = rollComboHits(st);
    for (var rep = 0; rep <= comboReps; rep++) {
    for (var h = 0; h < hits; h++) {
      for (var ti = 0; ti < targets.length; ti++) {
        var targetEnt = targets[ti];
        if (targetEnt.hp <= 0) continue;
        /* 這一段對「這個目標」的數字要延後多久：飛行時間依該目標的距離算，
           所以同一次群體技，站得遠的敵人數字會比近的晚跳出來。 */
        var hitDelayMs = skillVfxImpactDelayMs(vfxSpec, rep * hits + h, ti);
        var dmgRes;
        if (fx.dmgType === 'true') {
          // 真實傷害：無視防禦/抗性/格擋
          var td = Math.max(1, Math.round(baseVal * rnd(0.95, 1.05)));
          targetEnt.hp -= td;
          dmgRes = { dmg: td, killed: targetEnt.hp <= 0, miss: false, crit: false };
          if (dmgRes.killed) targetEnt.hp = 0;
        } else {
          // 裝備固定值元素攻擊：技能比照普攻附加（2026-07-22 使用者定調技能結算與普攻同規格）。
          // 雷電系技能於雷霆過載期間，附加的固定值雷電攻擊同步乘算（技能本體已隨 baseVal 乘過，不重複）。
          var elemAtk = null;
          if (st.elemAtk) {
            for (var ea in st.elemAtk) {
              if (!st.elemAtk[ea]) continue;
              if (!elemAtk) elemAtk = {};
              var eaVal = st.elemAtk[ea];
              if (ea === 'lightning' && loBoost > 0) eaVal *= 1 + loBoost / 100;
              elemAtk[ea] = eaVal;
            }
          }
          var aCfg = {
            atk: baseVal, dmgType: fx.dmgType, level: st.level,
            critRate: st.critRate + (fx.critBonus || 0), critDmg: st.critDmg,
            hit: fx.neverMiss ? 999 : Math.max(100, st.hit), // 技能命中吃玩家命中率，保留 100 當地板（低命中不受影響、高命中能壓過高閃避敵人）
            pen: fx.dmgType === 'magic' ? effectiveMPen(st, pEnt) : effectivePPen(st, pEnt), // 穿透含技能增益 penUp（破甲擊等）
            sunder: st.passives.sunder || 0,        // 神鑄特效【破甲】：技能同樣適用（與普攻同規格）
            trueDmgPct: st.passives.trueDmg || 0,   // 神鑄特效【真傷】：技能同樣適用（以技能傷害基底計）
            annihilate: st.passives.annihilate || 0, // 神鑄特效【破滅】：技能暴擊同樣適用
            elemAtk: elemAtk, elemDmgPct: st.elemDmgPct,
            elemDmgUp: (typeof legendaryElementDamageUp === 'function') ? legendaryElementDamageUp(st, pEnt) : st.elemDmgUp,
            eliteDmg: st.eliteDmg, bossDmg: st.bossDmg, normalDmg: st.normalDmg,
            totalDmgPct: (st.totalDmgPct || 0) + buffVal(pEnt, 'allDmgUp'), // 潛力【時空凝滯】：所有傷害提高
            dmgVsElem: st.dmgVsElem,
            isPlayer: true
          };
          if (fx.dmgType === 'both') {
            // 融合技雙屬性：baseVal 依 物攻:魔攻 比例拆回兩段（resolveHit 'both' 分支各自結算），雙穿透齊備
            var statSum = (st.atk || 0) + (st.matk || 0);
            var physRatio = statSum > 0 ? (st.atk || 0) / statSum : 0.5;
            aCfg.atk = baseVal * physRatio;
            aCfg.matk = baseVal * (1 - physRatio);
            aCfg.pen = effectivePPen(st, pEnt);
            aCfg.mPen = effectiveMPen(st, pEnt);
          }
          skillElemApplyACfg(aCfg, sk, fx); // 技能屬性化：本體傷害段整段歸屬技能屬性（tags／elemOverride／融合 elems）
          // 處決：低血量加成
          if (fx.execBelow && targetEnt.hp / targetEnt.maxHp * 100 < fx.execBelow) {
            aCfg.atk *= (fx.execMult || 2);
            if (aCfg.matk) aCfg.matk *= (fx.execMult || 2);
          }
          // 45 新技能（periodicField 族）：領域內敵人受指定類型傷害增幅（技能傷害端；只對站在領域裡的目標）
          aCfg = skillRtFieldAmpACfg(aCfg, targetEnt);
          dmgRes = resolveHit(pEnt, targetEnt, aCfg, monsterDefCfg(targetEnt));
        }
        if (!dmgRes.miss) {
          allMiss = false;
          totalDmg += dmgRes.dmg;
          if (dmgRes.crit) anyCrit = true;
          var dmgStr = fmt(dmgRes.dmg);
          if (dmgRes.crit) dmgStr = '爆擊 ' + dmgStr;
          if (dmgRes.blocked) dmgStr = '格擋 ' + dmgStr;
          floatEnemyEvent(targetEnt, floatSel, sk.emoji + dmgStr, (dmgRes.crit ? 'crit ' : 'dmg ') + 'enemy-skill', dmgRes.dmg, hitDelayMs);
          trackDps(dmgRes.dmg);
          if (typeof recordRunDamage === 'function') {
            var statKey = 'skill:' + (typeof statSlot === 'number' ? statSlot : id) + ':' + id + ':' + lv;
            recordRunDamage(sk.name, dmgRes.dmg, statKey, lv);
          }
        } else {
          floatEnemyEvent(targetEnt, floatSel, 'MISS', 'miss enemy-dodge', undefined, hitDelayMs);
        }
        if (dmgRes.killed) out.killed = true;
      }
    }
    }
    // 冰與火之歌：每名目標同時處於減速與燃燒時各自引爆
    for (var ci = 0; ci < targets.length; ci++) {
      var comboTarget = targets[ci];
      if (fx.comboDetonate && comboTarget.hp > 0 && effectActive(comboTarget, 'slow') && targetHasDot(comboTarget, '燃燒')) {
        var boom = Math.max(1, Math.round(baseVal * fx.comboDetonate / 100));
        comboTarget.hp -= boom;
        totalDmg += boom;
        floatEnemyEvent(comboTarget, floatSel, '❄️🔥' + fmt(boom), 'crit enemy-skill', boom);
        trackDps(boom);
        parts.push('<span class="log-hl-good">冰火引爆 ' + fmt(boom) + '！</span>');
        if (comboTarget.hp <= 0) { comboTarget.hp = 0; out.killed = true; }
      }
    }
    out.dmg = totalDmg;
    out.crit = anyCrit; // 45 新技能（procCast 族）：任一段爆擊旗標（proc on:'crit'／殺陣反射判定用）
    // 潛力【雷霆過載】：雷電系技能命中後觸發連鎖閃電（連鎖浮字沿用本擊爆擊與否的顯示樣式）。
    // §3.5 系別判定統一：末參補傳 sk，判定改走 skillElemOf（帶 lightning 標籤即算雷電系）
    if (typeof applyPotentialChainLightning === 'function') {
      var chainRes = applyPotentialChainLightning(pEnt, fx, targets, totalDmg, comboReps, floatSel, anyCrit, sk);
      if (chainRes && chainRes.killed) out.killed = true;
    }
    if (allMiss) parts.push('<span class="log-hl-bad">被閃避了！</span>');
    else parts.push((anyCrit ? '<span class="log-hl-good">爆擊</span>' : '') + '造成 ' + fmt(totalDmg) + (hits > 1 ? '（' + hits + ' 段）' : '') + (comboReps > 0 ? '<span class="log-hl-good">（連擊數 ×' + comboReps + '）</span>' : '') + ' 傷害');
    // 命中後效果
    if (totalDmg > 0) {
      // 45 新技能（dotSynergy 族）：DoT 引爆/額外跳動/跳速標記——於 fx.dot 塗抹「前」結算，
      // 避免引爆本次剛塗上的 DoT（疫爆術：先引爆再重新塗抹）；追加傷害併入 totalDmg（比照冰火引爆吃後續吸血）
      var rtDotExtra = skillRtApplyDotOps(targets, fx, lv, st, floatSel, parts, out);
      if (rtDotExtra > 0) { totalDmg += rtDotExtra; out.dmg = totalDmg; }
      // 45 新技能（brand 族）：印記引爆（先）→ 塗印（後）——萬象烙印「先引爆再烙印」順序；
      // 塗印儲能以本次總傷（含 DoT 引爆追加）計；引爆真傷/餘波/回復/暈眩/冷卻重置一併結算，
      // 追加傷害併入 totalDmg（比照冰火引爆吃後續吸血）
      var rtBrandExtra = skillRtApplyBrandOps(pEnt, sk, fx, lv, st, targets, floatSel, parts, out, totalDmg);
      if (rtBrandExtra > 0) { totalDmg += rtBrandExtra; out.dmg = totalDmg; }
      if (fx.healPctOfDmg) {
        var beforeDrainShield = Math.max(0, pEnt.shield || 0);
        healPlayer(pEnt, totalDmg * fx.healPctOfDmg / 100, st);
        showPlayerShieldGainAfterHeal(floatSel, pEnt, beforeDrainShield);
        parts.push('<span class="log-hl-good">汲取 ' + fmt(totalDmg * fx.healPctOfDmg / 100) + ' 生命</span>');
      }
      if (fx.mpOnCrit && anyCrit) { pEnt.mp = Math.min(st.mp, pEnt.mp + fx.mpOnCrit); parts.push('返還 ' + fx.mpOnCrit + ' 法力'); }
      if (fx.goldPer) { var gg = Math.round(fx.goldPer * lv * st.level * fxMult); G.player.gold += gg; if (window.recordLootGold) window.recordLootGold(gg, 'skill'); parts.push('<span class="log-hl-good">獲得 ' + fmt(gg) + ' 金幣</span>'); UI.dirty.header = true; }
      for (var ei = 0; ei < targets.length; ei++) {
        var effectTarget = targets[ei];
        if (effectTarget.hp <= 0) continue;
        if (fx.dot) {
          var instantDot = applyDot(effectTarget, baseVal * fx.dot.pct / 100, fx.dot.dur, fx.dot.name);
          if (instantDot > 0) {
            totalDmg += instantDot;
            out.dmg = totalDmg;
            if (effectTarget.hp <= 0) out.killed = true;
          }
          parts.push('附加' + fx.dot.name);
        }
        if (fx.dotList) {
          for (var dl = 0; dl < fx.dotList.length; dl++) {
            var dd = fx.dotList[dl];
            var instantListDot = applyDot(effectTarget, baseVal * dd.pct / 100, dd.dur, dd.name);
            if (instantListDot > 0) {
              totalDmg += instantListDot;
              out.dmg = totalDmg;
              if (effectTarget.hp <= 0) out.killed = true;
            }
            parts.push('附加' + dd.name);
          }
        }
        if (fx.stunDur && !isBossControlImmune(effectTarget) && !resistCtrl(monsterDefCfg(effectTarget))) {
          var stunApplied = applyEffect(effectTarget, 'stun', fx.stunDur); // 控場遞減 → 顯示實際秒數
          parts.push(stunApplied ? '<span class="log-hl-good">暈眩 ' + fmt1(stunApplied) + ' 秒</span>' : '暈眩無效（控場遞減）');
        }
        if (fx.slowDur && !isBossControlImmune(effectTarget) && !resistCtrl(monsterDefCfg(effectTarget))) {
          parts.push(applyEffect(effectTarget, 'slow', fx.slowDur) ? '減速' : '減速無效（控場遞減）');
        }
        if (fx.maxHpDotPct) {
          var cdps = Math.min(effectTarget.maxHp * scaleAt(fx.maxHpDotPct, lv) / 100, st.matk * 6) * fxMult;
          applyDot(effectTarget, cdps, fx.dotDur || 5, '詛咒');
          parts.push('<span class="log-hl-bad">附加死亡詛咒</span>');
        }
      }
      applySkillDebuffs(targets, fx, lv, parts, fxMult);
      // 吸血／吸魔：以「每秒生命回復／法力恢復 × %」計（formula.js §3），與技能傷害無關；
      // 屬性吸血非技能本身的效果，溢出不轉護盾。
      if (st.manaSteal > 0) pEnt.mp = Math.min(st.mp, pEnt.mp + manaStealAmount(st, st.manaSteal));
      if (st.lifesteal > 0) healPlayer(pEnt, lifestealHealAmount(st, st.lifesteal), st, { noShield: true });
      // 45 新技能（resourceConvert 族）：傷害段後結算（hpSacrifice M8——本次傷害部分轉護盾）
      skillRtAfterDamage(pEnt, fx, lv, st, totalDmg, floatSel, parts);
    }
  }
  // === 非傷害效果 ===
  if (fx.healPctMax) {
    var hv = st.hp * scaleAt(fx.healPctMax, lv) / 100 * fxMult;
    var beforeHealShield = Math.max(0, pEnt.shield || 0);
    // 45 新技能（resourceConvert 族）：overhealDmg（溢流聖罰）——以「治療前缺口」計算本次溢出並轉真傷（v1 單次結算）；
    // 無自帶 overhealDmg 的治療技於 M4 轉傷窗存續期間，溢出同樣比照轉傷
    if (fx.overhealDmg) skillRtOverhealToDmg(pEnt, fx, lv, st, hv, targets, floatSel, parts, out);
    else skillRtOverhealWinToDmg(pEnt, st, hv, targets, floatSel, parts, out);
    healPlayer(pEnt, hv, st);
    showPlayerShieldGainAfterHeal(floatSel, pEnt, beforeHealShield);
    floatPlayerEvent(floatSel, '回復 +' + fmt(hv), 'heal', hv);
    parts.push('<span class="log-hl-good">回復 ' + fmt(hv) + ' 生命</span>');
  }
  if (fx.hotPct) {
    applyBuff(pEnt, 'hot', scaleAt(fx.hotPct, lv) * fxMult, fx.hotDur);
    floatPlayerEvent(floatSel, '再生 ' + fx.hotDur + '秒', 'heal');
    parts.push('<span class="log-hl-good">持續再生 ' + fx.hotDur + ' 秒</span>');
  }
  if (fx.shieldPctMax) {
    var beforeShield = Math.max(0, pEnt.shield || 0);
    var shieldPct = scaleAt(fx.shieldPctMax, lv) * (1 + st.shieldEff / 100) * fxMult;
    var shieldBase = beforeShield > 0 ? Math.max(0, pEnt.shieldSkillBase || 0) || beforeShield : st.hp;
    // 技能護盾上限 = 最大生命 × SHIELD_SKILL_CAP_PCT%（→ formula.js §3；參數表「3-戰鬥核心/護盾上限(技能給予)」）
    var targetShield = Math.min(shieldBase * (1 + shieldPct / 100), st.hp * (SHIELD_SKILL_CAP_PCT / 100));
    pEnt.shield = Math.max(beforeShield, targetShield);
    pEnt.shieldSkillBase = shieldBase;
    pEnt.shieldSkillPct = Math.max(pEnt.shieldSkillPct || 0, shieldPct);
    refreshShieldMaxAfterGain(pEnt, beforeShield);
    var gainedShield = Math.max(0, pEnt.shield - beforeShield);
    if (gainedShield > 0) floatPlayerEvent(floatSel, '🛡️+' + fmt(gainedShield), 'shield');
    parts.push('<span class="log-hl-good">' + (gainedShield > 0 ? '獲得 ' + fmt(gainedShield) + ' 護盾' : '護盾維持 ' + fmt(beforeShield)) + '</span>');
  }
  if (fx.selfCleanse) { cleanse(pEnt); floatPlayerEvent(floatSel, '✨淨化', 'special'); parts.push('淨化負面狀態'); }
  if (fx.mpRestore) { var mpGain = Math.round(fx.mpRestore * fxMult); pEnt.mp = Math.min(st.mp, pEnt.mp + mpGain); floatPlayerEvent(floatSel, '法力 +' + fmt(mpGain), 'mana', mpGain); parts.push('回復 ' + mpGain + ' 法力'); }
  skillFxBuffList(fx).forEach(function (bf) {
    applyBuff(pEnt, bf.key, scaleAt(bf, lv) * fxMult, bf.dur);
    showPlayerBuffFloat(floatSel, bf, lv, fxMult);
    parts.push('<span class="log-hl-good">' + buffLabel(bf.key) + ' +' + fmt1(skillBuffDisplayValue(bf, lv, fxMult)) + '%（' + bf.dur + '秒）</span>');
  });
  if (!fx.dmgType) applySkillDebuffs(targets, fx, lv, parts, fxMult);
  if (!fx.dmgType && fx.maxHpDotPct) {
    for (var nci = 0; nci < targets.length; nci++) {
      if (targets[nci].hp <= 0) continue;
      var ncdps = Math.min(targets[nci].maxHp * scaleAt(fx.maxHpDotPct, lv) / 100, st.matk * 6) * fxMult;
      applyDot(targets[nci], ncdps, fx.dotDur || 5, '詛咒');
    }
    parts.push('<span class="log-hl-bad">附加死亡詛咒</span>');
  }
  // 45 新技能（dotSynergy 族）：無傷害段技能（萬創崩裂等）比照 maxHpDotPct 雙分支結算 DoT 引爆/額外跳動/跳速
  if (!fx.dmgType) {
    var rtDotExtraNc = skillRtApplyDotOps(targets, fx, lv, st, floatSel, parts, out);
    if (rtDotExtraNc > 0) out.dmg = (out.dmg || 0) + rtDotExtraNc;
  }
  // === 45 新技能：施放後統一結算（機制授予／buffExtend 族／守勢反哺授予／cdShift／擊殺觸發）===
  skillRtOnSkillCast(pEnt, sk, fx, id, lv, st, out, targets, floatSel, parts, rtPre);
  if (typeof legendaryOnSkillCast === 'function') {
    legendaryOnSkillCast(pEnt, targets, id, sk, fx, lv, st, out, floatSel, legendaryPrep, opts);
  }

  // 45 新技能：純機制技能（skillAmp 授予／連段窗／疊層引擎／冷卻操縱等無本體傷害/治療/增益者）
  // 無既有記錄片段時補通用日誌，避免出現空白句
  if (!parts.length) parts.push('發動技能效果');

  var cls = 'log-player-skill';
  if (sk.cat === 'def' || sk.cat === 'special' || (sk.cat === 'fusion' && !fx.dmgType)) {
    cls = 'log-player-buff';
  }
  blog(logMsg + parts.join('，') + '。', cls, 'combat');
  UI.dirty.battle = true;
  return out;
}

// 目標是否帶有指定名稱的持續傷害
function targetHasDot(ent, name) {
  if (!ent.dots) return false;
  for (var i = 0; i < ent.dots.length; i++) {
    if (ent.dots[i].name === name && ent.dots[i].until > GT) return true;
  }
  return false;
}

/* 技能就緒順序（執行期狀態，不入存檔）：
   技能冷卻歸零時加入尾端；施放後等下一次冷卻歸零再重新排隊。
   這樣前排短 CD 技能不會因為固定掃描裝載欄而壟斷施放機會。 */
function ensureSkillReadyOrder(pEnt) {
  if (!pEnt._skillReadyOrder) pEnt._skillReadyOrder = {};
  if (typeof pEnt._skillReadySeq !== 'number' || !isFinite(pEnt._skillReadySeq)) pEnt._skillReadySeq = 0;
  var lo = G.player.loadout || [];
  for (var i = 0; i < lo.length; i++) {
    var id = lo[i];
    if (pEnt._skillReadyOrder[id] === undefined) pEnt._skillReadyOrder[id] = pEnt._skillReadySeq++;
  }
}

function markSkillReady(pEnt, id) {
  ensureSkillReadyOrder(pEnt);
  pEnt._skillReadyOrder[id] = pEnt._skillReadySeq++;
}

// 依冷卻歸零先後挑一個可施放的技能（每 tick 至多一個）；同時就緒時沿用裝載順序
function pickAndCastSkill(pEnt, target, floatSel) {
  var st = getStats();
  if (!pEnt.skillCds) pEnt.skillCds = {};
  if ((pEnt.skillGcd || 0) > 0) return null;
  ensureSkillReadyOrder(pEnt);
  var lo = G.player.loadout || [];
  var candidates = [];
  for (var i = 0; i < lo.length; i++) {
    var id = lo[i];
    // 潛力技能（裝載欄鍵 'potential:<id>'）：無法力消耗，依冷卻與存活目標施放，其餘沿用同一套排序。
    if (typeof id === 'string' && id.indexOf('potential:') === 0) {
      if ((pEnt.skillCds[id] || 0) > 0) continue;
      var pDef = (typeof potentialDef === 'function') ? potentialDef(id.slice(10)) : null;
      if (!pDef || typeof potentialSkillActive !== 'function' || !potentialSkillActive(pDef.id)) continue;
      var hasLiveTarget = Array.isArray(target)
        ? target.some(function (ent) { return ent && ent.hp > 0; })
        : !!(target && target.hp > 0);
      if (!hasLiveTarget) continue;
      candidates.push({ id: id, potentialDef: pDef, slot: i, readyAt: pEnt._skillReadyOrder[id] });
      continue;
    }
    var sk = skillDef(id);
    var lv = skillLevel(id);
    if (!sk || !lv) continue;
    if ((pEnt.skillCds[id] || 0) > 0) continue;
    var cfx = effectiveFx(id, sk, lv); // 45 新技能：一次解析，供免費施放預判與施放條件共用
    // 45 新技能（freeCast 族）：即將免費施放（freeNext／零式節律）時，跳過 MP 門檻檢查
    var skillCost = (typeof legendarySkillManaCost === 'function')
      ? legendarySkillManaCost(pEnt, id, sk, lv, st) : skillManaCost(sk, lv);
    if (pEnt.mp < skillCost && !skillRtWouldBeFree(sk, cfx, st)) continue;
    if (!skillConditionOk(sk, cfx, pEnt, target, st)) continue;
    candidates.push({ id: id, lv: lv, slot: i, readyAt: pEnt._skillReadyOrder[id] });
  }
  if (!candidates.length) return null;
  candidates.sort(function (a, b) { return a.readyAt - b.readyAt || a.slot - b.slot; });
  var choice = candidates[0];
  if (choice.potentialDef && typeof castPotentialSkill === 'function') {
    return castPotentialSkill(pEnt, target, choice.potentialDef, floatSel, choice.id);
  }
  return castSkill(pEnt, target, choice.id, choice.lv, floatSel, choice.slot);
}
function tickSkillCds(pEnt, dt) {
  if (pEnt.skillGcd > 0) {
    pEnt.skillGcd = Math.max(0, pEnt.skillGcd - dt);
    if (pEnt.skillGcd < 1e-6) pEnt.skillGcd = 0;
  }
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

/* ================ 技能融合系統（2026-07-30 種子演算法改造）================
   2~4 個「已解鎖」的主動技能（可未學習）→ 融合技。素材不再被消耗，改為「佔用」：
   投入期間不可裝備、不可再次融合，刪除融合技後釋放（skillUsedInFusion）。
   融合花費金幣＋魔法卷軸（fusionGoldCost / fusionScrollCost → formula.js §9）。
   融合技剛產生為未學習（Lv.0），花 1 技能點升至 Lv.1 才算學會、才可裝備。

   演算法（fusionGenerateFx，全部隨機以 record.seed 驅動的確定性亂數流）：
   1. 物魔判定：混合素材時 物理/魔法/物+魔 = 45/45/10（物魔按素材數比例加權）；
      任一真傷素材 → 真傷。
   2. 攻擊力：素材「滿級」傷害% 平均 → 四檔 75/100/125/150%（20/30/30/20）。
   3. 屬性組合：素材屬性做多重集組合全枚舉（物理算一種屬性、每個物理素材佔 2 份），
      取幾種屬性依常態分佈鐘形權重，再均攤權重；同屬性素材每多 1 個該屬性 ×1.25
      （等價折入 elems 權重與總傷害值，戰鬥端零改動）。
   4. buff/debuff：素材滿級效果彙整為池（同 key 取高），取幾個依鐘形權重；
      每個效果數值於「上限值一半 ~ 上限值」均分 4 檔隨機（各 25%）。
   5. 特效：取一個素材的特效包（段數/範圍/DoT/控場/機制族等），5% 機率再融合
      第二個素材的特效包（最多 2 個）。
   6. 變異：沿用既有變異池（FUSION_MUTATION_CHANCE），於種子流內擲骰。
   所有隨機結果值為融合技滿級（10 級）值，Lv.1 = 滿級 × FUSION_LV1_RATIO 線性成長。
   存檔只存 {components, seed}——素材現行定義＋種子即可完整重算（原生技能調整
   數值後讀檔自動生效，不必重新融合）。 */

// 變異效果池（req 檢查與融合結果的關聯性；apply 直接改寫 fx；由種子流決定、不入存檔）
var FUSION_MUTATIONS = [
  { key: 'iceFireSong', name: '冰與火之歌', desc: '目標同時處於減速（冰）與燃燒狀態時，引發冰爆追加 100% 傷害',
    req: function (fx) { return fx.elems && fx.elems.fire && fx.elems.ice; },
    apply: function (fx) { fx.comboDetonate = 100; } },
  { key: 'lifeResonance', name: '生命共鳴', desc: '此技能傷害的 25% 額外轉化為生命回復',
    req: function (fx) { return fx.dmgType && (fx.healPctMax || fx.hotPct || fx.healPctOfDmg); },
    apply: function (fx) { fx.healPctOfDmg = (fx.healPctOfDmg || 0) + 25; } },
  { key: 'thunderEcho', name: '雷鳴回響', desc: '雷霆之力殘響不散：25% 機率雙重施法',
    req: function (fx) { return fx.elems && fx.elems.lightning; },
    apply: function (fx) { fx.doubleCastPct = (fx.doubleCastPct || 0) + 25; } },
  { key: 'venomBloom', name: '劇毒綻放', desc: '所有持續傷害效果威力 +50%',
    req: function (fx) { return fx.dotList && fx.dotList.length; },
    apply: function (fx) { fx.dotList.forEach(function (d) { d.pct = Math.round(d.pct * 1.5); }); } },
  { key: 'timeRipple', name: '時空漣漪', desc: '附帶的增益效果持續時間變為兩倍',
    req: function (fx) { return skillFxBuffList(fx).length > 0; },
    apply: function (fx) { skillFxBuffList(fx).forEach(function (bf) { bf.dur *= 2; }); } },
  { key: 'reapInstinct', name: '收割本能', desc: '嗜血的融合本能：目標血量低於 25% 時傷害 x2',
    req: function (fx) { return fx.dmgType && fx.dmgType !== 'true'; },
    apply: function (fx) { fx.execBelow = Math.max(fx.execBelow || 0, 25); fx.execMult = Math.max(fx.execMult || 0, 2); } },
  { key: 'guardEmber', name: '守護餘燼', desc: '融合的殘餘能量凝為屏障：施放時額外獲得最大生命 8% 的護盾',
    req: function (fx) { return !!(fx.shieldPctMax || fx.healPctMax || skillFxBuffList(fx).length); },
    apply: function (fx) { if (!fx.shieldPctMax) fx.shieldPctMax = { base: 8, per: 1 }; } },
  { key: 'manaVortex', name: '法力漩渦', desc: '融合亂流回饋法力：施放後回復 30 點法力',
    req: function () { return true; },
    apply: function (fx) { fx.mpRestore = (fx.mpRestore || 0) + 30; } }
];

// 融合技命名：以元素/性質取字
function fusionName(comps, fx) {
  var chars = [];
  if (fx.elems) {
    for (var e in fx.elems) {
      // 'phys'（無屬性物理份額）不入名；其餘取元素名首字
      if (!ELEM_INFO[e]) continue;
      var ch = ELEM_INFO[e].name.charAt(0);
      if (chars.indexOf(ch) < 0) chars.push(ch);
    }
  }
  if (!chars.length) {
    if (fx.stat === 'matk') chars.push('奧');
    else if (fx.dmgType) chars.push('武');
    if (fx.healPctMax || fx.hotPct) chars.push('聖');
    if (skillFxBuffList(fx).length) chars.push('靈');
  }
  chars = chars.slice(0, 3);
  var suffix = fx.dmgType === 'true' ? '虛空奧義'
    : (fx.dmgType === 'both' ? '雙極奧義'
      : (fx.dmgType === 'magic' ? '衝擊彈'
        : (fx.dmgType ? '斬擊' : (fx.healPctMax || fx.hotPct ? '聖歌' : '祕法'))));
  return (chars.join('') || '混沌') + '融合·' + suffix;
}

/* ---- 種子亂數流（mulberry32）----
   融合的所有隨機皆由 record.seed 驅動：同 seed＋同素材現行定義 → 同結果。
   擲骰順序固定：物魔 → 攻擊力檔位 → 屬性數量/組合 → buff 數量/洗牌/檔位 → 特效/效果融合 → 變異。 */
function fusionRng(seed) {
  var a = (Number(seed) >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function fusionRngWeighted(rng, weights) {
  var total = 0, i;
  for (i = 0; i < weights.length; i++) total += Math.max(0, weights[i]);
  if (total <= 0) return 0;
  var roll = rng() * total;
  for (i = 0; i < weights.length; i++) {
    roll -= Math.max(0, weights[i]);
    if (roll < 0) return i;
  }
  return weights.length - 1;
}
// 鐘形（常態分佈）權重：取 1~n 個的機率，中間高兩端低（n=3 → 約 23/55/23；n=5 → 約 9/24/33/24/9）
function fusionCountWeights(n) {
  var mu = (1 + n) / 2, sigma = Math.max(0.6, n / 4), w = [];
  for (var k = 1; k <= n; k++) w.push(Math.exp(-((k - mu) * (k - mu)) / (2 * sigma * sigma)));
  return w;
}
/* 多重集組合枚舉：shares＝['phys','phys','fire',…] → 依「取 k 份」分組的全部相異組合。
   物理佔 2 份 → {phys:2} 也是合法組合；規格例：物理+3 屬性魔法 → 4+7+7+4+1=23 種。 */
function fusionEnumCombos(shares) {
  var counts = {}, keys = [];
  shares.forEach(function (s) {
    if (!counts[s]) { counts[s] = 0; keys.push(s); }
    counts[s]++;
  });
  var bySize = {};
  function walk(idx, cur, size) {
    if (idx === keys.length) {
      if (size > 0) {
        if (!bySize[size]) bySize[size] = [];
        bySize[size].push(cur);
      }
      return;
    }
    var key = keys[idx];
    for (var c = 0; c <= counts[key]; c++) {
      var next = {};
      for (var kk in cur) next[kk] = cur[kk];
      if (c > 0) next[key] = c;
      walk(idx + 1, next, size + c);
    }
  }
  walk(0, {}, 0);
  return bySize;
}
/* 融合成長折算：隨機結果值 V 為滿級（10 級基準）值 → Lv.1 = V × FUSION_LV1_RATIO 線性成長。
   基準固定取未轉生上限（10），轉生上限 15 時滿級可超出 V（與一般技能成長同理）。 */
function fusionScaledDef(maxVal, extra) {
  var refMax = (typeof REINCARNATION_SKILL_MAX_LEVELS !== 'undefined' && REINCARNATION_SKILL_MAX_LEVELS[0]) || 10;
  var out = extra || {};
  out.base = Math.round(maxVal * FUSION_LV1_RATIO * 10) / 10;
  out.per = Math.round(maxVal * (1 - FUSION_LV1_RATIO) / Math.max(1, refMax - 1) * 100) / 100;
  return out;
}
// 深度折算：物件內 {base,per} 節點以素材滿級值解析後重新映射為融合成長曲線；純量原樣複製
function fusionRescaleDeep(v, matLv) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'object') {
    if (v.base !== undefined || v.per !== undefined) {
      var resolved = scaleAt({ base: Number(v.base) || 0, per: Number(v.per) || 0 }, Math.max(1, matLv));
      return fusionScaledDef(resolved);
    }
    var out = Array.isArray(v) ? [] : {};
    for (var k in v) out[k] = fusionRescaleDeep(v[k], matLv);
    return out;
  }
  return v;
}
/* 特效包鍵集：傷害核心（dmgType/stat/base/per）、屬性（elems）、增益減益（另走效果池）
   之外可被融合技繼承的欄位；「效果融合」以素材為單位整包取捨。 */
var FUSION_EFFECT_KEYS = [
  'hits', 'dot', 'dotList', 'stunDur', 'slowDur', 'execBelow', 'execMult',
  'healPctOfDmg', 'mpRestore', 'mpOnCrit', 'goldPer', 'critBonus', 'neverMiss',
  'selfCleanse', 'gamble', 'selfDmgPct', 'doubleCastPct',
  'healPctMax', 'hotPct', 'hotDur', 'shieldPctMax', 'maxHpDotPct', 'dotDur',
  'brand', 'detonate', 'charge', 'echo', 'field', 'skillAmp', 'skillAmp2',
  'cdShift', 'freeNext', 'dotPulse', 'dotHaste', 'dotDetonate', 'comboWindow', 'dmgWindow',
  'healEcho', 'overhealDmg', 'stigma', 'hpSacrifice', 'mpDump', 'replayBest',
  'proc', 'proc2', 'buffExtend', 'buffExtend2', 'cdOnHitTaken', 'cdResetOnKill',
  'cdResetOnKill2', 'shieldBurst', 'requiresTargetDot'
];

/* ---- 融合 fx 產生（純函式、種子確定性）----
   comps＝素材滿級快照 [{id, def, maxLv, fx}]（fusionComps 組裝）。
   回傳 { fx, shape, mutation }；供 fuseSkills（首次）與 buildFusionRuntimeDef（讀檔重算）共用。
   演算法規格 → 本檔「技能融合系統」區塊註解。 */
function fusionGenerateFx(comps, seed) {
  var rng = fusionRng(seed);
  var fx = {};
  var i, k;

  // 1) 物魔判定：混合素材 45/45/10（物魔按素材數比例加權）；真傷素材 → 真傷
  var dmgComps = comps.filter(function (c) { return c.fx.dmgType; });
  var physN = 0, magicN = 0, anyTrue = false;
  dmgComps.forEach(function (c) {
    if (c.fx.dmgType === 'true') anyTrue = true;
    if (c.fx.stat === 'matk') magicN++; else physN++;
  });
  var dmgType = null, stat = null;
  if (dmgComps.length) {
    if (anyTrue) {
      dmgType = 'true';
      stat = magicN * 2 >= dmgComps.length ? 'matk' : 'atk';
    } else if (physN && magicN) {
      var restW = 100 - FUSION_BOTH_BASE_CHANCE;
      var pickIdx = fusionRngWeighted(rng, [
        restW * physN / (physN + magicN),
        restW * magicN / (physN + magicN),
        FUSION_BOTH_BASE_CHANCE
      ]);
      dmgType = pickIdx === 0 ? 'phys' : (pickIdx === 1 ? 'magic' : 'both');
      stat = pickIdx === 1 ? 'matk' : 'atk';
    } else {
      dmgType = magicN ? 'magic' : 'phys';
      stat = magicN ? 'matk' : 'atk';
    }
  }

  // 2) 攻擊力：素材滿級傷害% 平均 → 四檔 75/100/125/150（20/30/30/20）
  var dmgTotalPct = 0;
  if (dmgComps.length) {
    var avg = dmgComps.reduce(function (s, c) {
      return s + (c.fx.base || 0) + (c.fx.per || 0) * (c.maxLv - 1);
    }, 0) / dmgComps.length;
    var tier = FUSION_ATK_TIERS[fusionRngWeighted(rng, FUSION_ATK_TIER_WEIGHTS)];
    dmgTotalPct = avg * tier / 100;
  }

  /* 3) 屬性組合：素材屬性（tags）各佔 1 份、無屬性物理傷害素材佔 2 份 'phys'；
     多重集全枚舉後——取幾份依鐘形權重、同份數組合等機率；
     同屬性素材加成（每多 1 個 ×1.25）等價折入 elems 權重與總傷害值。 */
  var shares = [], matCount = {};
  comps.forEach(function (c) {
    var elem = skillElemOf(c.def, c.fx);
    if (elem) {
      shares.push(elem);
      matCount[elem] = (matCount[elem] || 0) + 1;
    } else if (c.fx.dmgType && c.fx.stat !== 'matk') {
      shares.push('phys'); shares.push('phys');
      matCount.phys = (matCount.phys || 0) + 1;
    }
  });
  if (dmgComps.length && shares.length) {
    var bySize = fusionEnumCombos(shares);
    var kPick = fusionRngWeighted(rng, fusionCountWeights(shares.length)) + 1;
    var combos = bySize[kPick] || [];
    var combo = combos.length ? combos[Math.floor(rng() * combos.length)] : null;
    if (combo) {
      var elems = {}, mult = 0;
      for (k in combo) {
        var w = combo[k] / kPick;
        var amp = 1 + (FUSION_SAME_ELEM_BONUS / 100) * Math.max(0, (matCount[k] || 1) - 1);
        elems[k] = w * amp;
        mult += w * amp;
      }
      if (mult > 0) {
        for (k in elems) elems[k] = Math.round(elems[k] / mult * 100) / 100;
        dmgTotalPct *= mult;
      }
      var onlyPhys = true;
      for (k in elems) if (k !== 'phys') onlyPhys = false;
      if (!onlyPhys && dmgType !== 'true') fx.elems = elems;
    }
  }

  if (dmgComps.length && dmgTotalPct > 0) {
    fx.dmgType = dmgType;
    fx.stat = stat;
    fusionScaledDef(dmgTotalPct, fx); // 寫入 fx.base / fx.per
  }

  /* 4) buff/debuff 池：素材滿級效果同 key 取高（defDown 已棄用不入池）；
     取幾個依鐘形權重 → 種子流洗牌取前 N → 每個數值於「上限一半~上限」均分 4 檔（各 25%）。 */
  var pool = [], seen = {};
  comps.forEach(function (c) {
    [['buff', 'buff'], ['buff2', 'buff'], ['debuff', 'debuff'], ['debuff2', 'debuff']].forEach(function (pair) {
      var e = c.fx[pair[0]];
      if (!e || !e.key || e.key === 'defDown') return;
      var capVal = scaleAt(e, c.maxLv);
      var poolKey = pair[1] + ':' + e.key;
      if (!seen[poolKey]) {
        var entry = { kind: pair[1], key: e.key, dur: e.dur, capVal: capVal };
        seen[poolKey] = entry;
        pool.push(entry);
      } else if (capVal > seen[poolKey].capVal) {
        seen[poolKey].capVal = capVal;
        seen[poolKey].dur = e.dur;
      }
    });
  });
  if (pool.length) {
    var take = fusionRngWeighted(rng, fusionCountWeights(pool.length)) + 1;
    var order = pool.slice();
    for (i = order.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }
    var buffs = [], debuffs = [];
    for (i = 0; i < take; i++) {
      var sel = order[i];
      var tierIdx = Math.min(3, Math.floor(rng() * 4));
      var val = sel.capVal / 2 + (sel.capVal / 2) * (tierIdx / 3);
      var bdef = fusionScaledDef(val, { key: sel.key, dur: sel.dur });
      (sel.kind === 'buff' ? buffs : debuffs).push(bdef);
    }
    if (buffs.length) fx.buffList = buffs;
    if (debuffs.length) fx.debuffList = debuffs;
  }

  /* 5) 特效：每個素材的特效包（FUSION_EFFECT_KEYS＋傷害範圍 shape）整包為單位，
     取 1 個；5% 機率（FUSION_EFFECT_FUSE_CHANCE）再融合第 2 個素材的特效包
     （鍵不重複者併入；hits 取高），最多 2 個。 */
  var bundles = [];
  comps.forEach(function (c) {
    var b = {}, has = false;
    for (i = 0; i < FUSION_EFFECT_KEYS.length; i++) {
      k = FUSION_EFFECT_KEYS[i];
      if (c.fx[k] === undefined) continue;
      b[k] = fusionRescaleDeep(c.fx[k], c.maxLv);
      has = true;
    }
    if (c.def.shape) { b._shape = c.def.shape; has = true; }
    if (has) bundles.push(b);
  });
  var shape = null;
  if (bundles.length) {
    var firstIdx = Math.floor(rng() * bundles.length);
    var merged = bundles[firstIdx];
    if (bundles.length > 1 && rng() * 100 < FUSION_EFFECT_FUSE_CHANCE) {
      var rest = bundles.filter(function (b, bi) { return bi !== firstIdx; });
      var second = rest[Math.floor(rng() * rest.length)];
      var combined = {};
      for (k in merged) combined[k] = merged[k];
      for (k in second) {
        if (combined[k] === undefined) combined[k] = second[k];
        else if (k === 'hits') combined[k] = Math.max(combined[k], second[k]);
      }
      merged = combined;
    }
    for (k in merged) {
      if (k === '_shape') { shape = merged[k]; continue; }
      fx[k] = merged[k];
    }
  }

  // 6) 變異（沿用既有變異池；由種子流擲骰，不入存檔）
  var mutation = null;
  if (rng() * 100 < fusionMutationChance()) {
    var mPool = FUSION_MUTATIONS.filter(function (m) { return m.req(fx); });
    if (mPool.length) {
      var m = mPool[Math.floor(rng() * mPool.length)];
      m.apply(fx);
      mutation = { key: m.key, name: m.name, desc: m.desc };
    }
  }
  return { fx: fx, shape: shape, mutation: mutation };
}

// 依 key 重套融合變異（req(fx) 通過才套，避免缺欄位崩潰）；回傳變異定義或 null。
function applyFusionMutationByKey(fx, key) {
  if (!key) return null;
  for (var i = 0; i < FUSION_MUTATIONS.length; i++) {
    if (FUSION_MUTATIONS[i].key === key) {
      if (FUSION_MUTATIONS[i].req(fx)) FUSION_MUTATIONS[i].apply(fx);
      return FUSION_MUTATIONS[i];
    }
  }
  return null;
}

/* 素材滿級快照組裝（規格：融合數值一律以素材最高等級計算，與素材當前等級無關）。
   基準等級固定取「未轉生上限」（10 級）：讓重算不依賴 G（主執行緒 tooltip 與 Worker
   結果必然一致），融合數值也不因轉生跳動——轉生收益由融合技自身上限 +5 的成長承接。
   任一素材定義不存在 → null（呼叫端退回存檔快照）。 */
function fusionComps(ids) {
  if (!Array.isArray(ids) || !ids.length) return null;
  var refLv = (typeof REINCARNATION_SKILL_MAX_LEVELS !== 'undefined' && REINCARNATION_SKILL_MAX_LEVELS[0]) || 10;
  var comps = [];
  for (var i = 0; i < ids.length; i++) {
    var d = (typeof SKILLS !== 'undefined') ? SKILLS[ids[i]] : null;
    if (!d) return null;
    comps.push({ id: ids[i], def: d, maxLv: refLv, fx: effectiveFx(ids[i], d, refLv) });
  }
  return comps;
}

// 無 seed 舊記錄的後備種子：以 id 字串 FNV-1a 雜湊出確定性種子（遷移正常會補 seed，此為保險）
function fusionFallbackSeed(id) {
  var h = 2166136261;
  var s = String(id || '');
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* 融合技動態重建：素材「現行定義」（滿級效果）＋ 種子 → 確定性重算 fx（需求 8）。
   素材技能已不存在時回傳 null（呼叫端退回存檔快照）。
   cost/cd 由素材現行定義推導；等級上限統一由 skillMaxLv() 判定，不再用記錄凍結 maxLv。 */
function buildFusionRuntimeDef(rec) {
  if (!rec || !Array.isArray(rec.components)) return null;
  var comps = fusionComps(rec.components);
  if (!comps) return null;
  var seed = (rec.seed === undefined || rec.seed === null) ? fusionFallbackSeed(rec.id) : (Number(rec.seed) >>> 0);
  var gen = fusionGenerateFx(comps, seed);
  var cost = Math.round(comps.reduce(function (s, c) { return s + (c.def.cost || 0); }, 0));
  var cd = Math.round(Math.max.apply(null, comps.map(function (c) { return c.def.cd || 8; })) * FUSION_CD_FACTOR);
  var def = {
    id: rec.id, name: rec.name, emoji: rec.emoji || '🧬', cat: 'fusion',
    cost: cost, cd: cd, seed: seed,
    components: rec.components,
    mutation: gen.mutation, flavor: rec.flavor, fx: gen.fx
  };
  if (gen.shape) def.shape = gen.shape;
  return def;
}

// 融合技即時 def 快取（模組層、不入存檔；依記錄物件同一性失效）。
var _fusionRtCache = {};
function resolveFusionRecord(rec) {
  if (Array.isArray(rec.components)) {
    var c = _fusionRtCache[rec.id];
    if (!c || c._srcRef !== rec) {
      var built = buildFusionRuntimeDef(rec);
      if (built) { built._srcRef = rec; _fusionRtCache[rec.id] = built; return built; }
      return rec; // 無法重建（素材技能已移除）→ 退回存檔快照
    }
    return c;
  }
  return rec; // 舊融合技無素材記錄 → 沿用快照 fx
}

/* 執行融合（2026-07-30 改制）；回傳 null=成功，否則錯誤訊息。
   素材條件：已解鎖即可（不需學習）、非被動/潛力/融合技、未投入其他融合技。
   花費：金幣＋魔法卷軸（fusionGoldCost / fusionScrollCost）。
   產物：未學習（Lv.0）的融合技記錄，只存 {components, seed} 供確定性重算。 */
function fuseSkills(ids) {
  if (!ids || ids.length < 2) return '至少需要 2 個素材技能';
  if (ids.length > 4) return '最多 4 個素材技能';
  var i;
  for (i = 0; i < ids.length; i++) {
    if (ids.indexOf(ids[i]) !== i) return '同一技能不能重複加入';
    var d = SKILLS[ids[i]];
    if (!d) return '融合技與潛力技能不能作為素材';
    if (d.cat === 'passive') return '被動技能無法融合';
    if (d.cat === 'potential') return '潛力技能無法融合';
    if (!skillUnlocked(ids[i])) return '素材技能「' + d.name + '」尚未解鎖';
    if (skillUsedInFusion(ids[i])) return '素材技能「' + d.name + '」已投入其他融合技';
  }
  var goldCost = fusionGoldCost(ids.length);
  var scrollCost = fusionScrollCost(ids.length);
  if (G.player.gold < goldCost) return '金幣不足（需要 ' + fmt(goldCost) + '）';
  if ((G.player.magicScroll || 0) < scrollCost) return '魔法卷軸不足（需要 ' + scrollCost + '）';

  var comps = fusionComps(ids);
  if (!comps) return '素材技能定義缺失';
  var seed = Math.floor(Math.random() * 4294967296) >>> 0;
  var gen = fusionGenerateFx(comps, seed);
  var rec = {
    id: 'fusion_' + uid(), name: fusionName(comps, gen.fx), emoji: '🧬', cat: 'fusion',
    components: ids.slice(), seed: seed, algo: 2,
    flavor: '由 ' + comps.map(function (c) { return c.def.name; }).join('、') + ' 融合而成的專屬奧義。'
    // 不存 fx / cost / cd：一律由 buildFusionRuntimeDef() 依素材現行定義＋種子重算。
  };
  G.player.gold -= goldCost;
  G.player.magicScroll = Math.max(0, (G.player.magicScroll || 0) - scrollCost);
  if (!G.player.fusions) G.player.fusions = [];
  G.player.fusions.push(rec);
  ids.forEach(function (cid) { unequipSkillFromLoadout(cid); }); // 素材保留等級，僅卸下（佔用中不可裝備）
  markStatsDirty();
  UI.dirty.skills = true; UI.dirty.header = true;
  blog('⚗️ <span class="log-hl-good">技能融合成功！</span>誕生【🧬' + rec.name + '】（尚未學習，升至 Lv.1 後可裝備）' +
    (gen.mutation ? '，並覺醒變異效果<span class="log-hl-good">【' + gen.mutation.name + '】</span>！' : '') +
    '｜花費 ' + fmt(goldCost) + ' 金幣、' + scrollCost + ' 張魔法卷軸', 'good');
  return null;
}

// 刪除融合技：釋放全部素材技能（解除佔用），已投入融合技的技能點自動歸還（等級推導制）
function deleteFusion(id) {
  var fs = G.player.fusions || [];
  for (var i = 0; i < fs.length; i++) {
    if (fs[i].id === id) {
      var refund = skillLevel(id);
      fs.splice(i, 1);
      delete G.player.skills[id];
      unequipSkillFromLoadout(id);
      delete _fusionRtCache[id];
      UI.dirty.skills = true; UI.dirty.header = true;
      blog('🗑️ 已刪除融合技，釋放全部素材技能' + (refund ? '，歸還 ' + refund + ' 點技能點' : ''), 'info');
      return null;
    }
  }
  return '找不到該融合技';
}

/* ---- 說明文字生成 ---- */
function buffLabel(key) {
  return ({ atkUp: '攻擊', defUp: '防禦', aspdUp: '攻速', evasionUp: '閃避', critDmgUp: '爆傷',
    lootUp: '掉寶', thornsUp: '反震', blockUp: '格擋', hot: '再生',
    penUp: '物理/魔法穿透',
    atkDown: '攻擊', defDown: '防禦',
    // 潛力技能增益
    velocitySurge: '極速之力·攻速', lightningOverload: '雷霆過載·雷電傷害', chronoCdr: '時間坍縮·冷卻縮減',
    sacredInvert: '聖療逆轉·回復/溢傷', allDmgUp: '時空凝滯·所有傷害', enemyAspdDown: '時間結界·攻速',
    invuln: '無敵結界（免疫一切傷害與負面效果）' })[key] || key;
}
function skillBuffDisplayValue(defObj, lvArg, mult) {
  var value = scaleAt(defObj, lvArg) * (mult || 1);
  return defObj && defObj.key === 'lootUp' ? effectiveDropRateEffect(value) : value;
}
/* 技能完整說明（傷害數值、成長、附加效果）。**純函式，不讀 G**——
   融合技的定義由 fusions 傳入（技能面板快照就有），省略才回頭讀 G。
   主執行緒必須能呼叫它，否則 UI 只剩風味文字可用（見 skillDef 的註解）。 */
function describeSkill(id, lv, skipFusionDetail, fusions) {
  // 潛力技能沿用同一份技能描述入口（供技能提示與升級面板共用，不另寫一套）。
  if (typeof potentialDef === 'function' && typeof describePotentialSkill === 'function') {
    var _pd = potentialDef(id);
    if (_pd) return describePotentialSkill(_pd, Math.max(1, lv || 1), skipFusionDetail);
  }
  var sk = skillDef(id, fusions);
  if (!sk) return '';
  lv = Math.max(1, lv || 1);
  var fx = effectiveFx(id, sk, lv);
  
  function growStr(v) { return '<span class="txt-grow">' + v + '</span>'; }
  function statStr(v) { return '<span class="txt-static">' + v + '</span>'; }
  function scaleStr(defObj, lvArg) {
    var val = skillBuffDisplayValue(defObj, lvArg);
    return (defObj && defObj.per) ? growStr(fmt1(val)) : statStr(fmt1(val));
  }
  
  /* ---- 元素敘述（2026-07-26 技能屬性化）----
     技能標籤即傷害屬性：「造成 X% 魔攻的火屬性傷害」，不再有「魔法傷害＋N% 昇華」的混用句型。
     風味語句只點出屬性質地，不再帶比例；融合技的多屬性則列出權重。
     系別歸屬：無傷害段（純增益/控場）但帶標籤的技能，以一句話點出系別。 */
  function elemShortName(type) {
    if (type === 'phys') return '物理'; // 融合技無屬性物理份額（elems 權重表中的 'phys' 鍵）
    return (ELEM_INFO[type] && (ELEM_INFO[type].short || ELEM_INFO[type].name)) || type; // 語境用 short（聖非光）
  }
  function elemFlavorText(type) {
    return ({
      fire: '烈焰隨擊灼燒，將目標吞沒於火中',
      ice: '寒霜徹骨，凍結目標的血脈',
      lightning: '雷光竄流而過，貫穿目標的軀體',
      poison: '劇毒滲入血肉，由內而外地侵蝕',
      light: '聖光降下裁決，灼盡目標的汙穢',
      dark: '暗影蝕魂而入，噬去目標的生機'
    })[type] || null;
  }
  var ELEM_SYS_FLAVOR = {
    fire: '此技歸屬烈焰一系', ice: '此技歸屬寒霜一系', lightning: '此技歸屬雷霆一系',
    poison: '此技歸屬劇毒一系', light: '此技承聖光一系加護', dark: '此技行於暗影一系'
  };
  var sysTag = (Array.isArray(sk.tags) && sk.tags.length) ? sk.tags[0] : null;
  var dmgElem = (typeof skillElemOf === 'function') ? skillElemOf(sk, fx) : sysTag; // 本次傷害的屬性歸屬

  var p = [];
  if (fx.passive) {
    var names = { hpPct: '生命上限', atkPct: '物理攻擊', matkPct: '魔法攻擊', aspdPct: '攻擊速度',
      critRate: '暴擊率', critDmg: '暴擊傷害', lifesteal: '吸血', mpFlat: '法力上限',
      mpRegen: '法力恢復/秒', defPct: '物理防禦', mdefPct: '魔法防禦', goldBonus: '金幣獲取', xpBonus: '經驗獲取' };
    for (var k in fx.passive) p.push((names[k] || k) + ' +' + growStr(fmt1(fx.passive[k] * lv)) + (k === 'mpFlat' || k === 'mpRegen' ? '' : '%'));
    // §3.5 系別歸屬：帶標籤的屬性桶被動也點出系別（如奧術心智＝聖系）
    var passiveSys = (sysTag && ELEM_SYS_FLAVOR[sysTag]) ? '；' + ELEM_SYS_FLAVOR[sysTag] : '';
    return '被動：' + p.join('、') + passiveSys;
  }
  if (fx.dmgType) {
    // 傷害類型：真傷不屬性化；其餘帶屬性歸屬時直接寫成「火屬性傷害」（魔攻/物攻仍是加成基礎）
    var t = fx.dmgType === 'true' ? '真實' : (fx.dmgType === 'both' ? '物理＋魔法' : (fx.dmgType === 'magic' ? '魔法' : '物理'));
    var multiElem = !!(fx.elems && Object.keys(fx.elems).length > 1);
    if (fx.dmgType !== 'true' && fx.dmgType !== 'both' && dmgElem && !multiElem) t = elemShortName(dmgElem) + '屬性';
    var statName = fx.dmgType === 'both' ? '物攻＋魔攻' : (fx.stat === 'matk' ? '魔攻' : '物攻');
    var dVal = (fx.base || 0) + (fx.per || 0) * (lv - 1);
    var dStr = fx.per ? growStr(fmt1(dVal)) : statStr(fmt1(dVal));
    p.push('造成 ' + dStr + '% ' + statName + ' 的' + t + '傷害' + (fx.hits ? ' x' + statStr(fx.hits) + ' 段' : ''));
    // 融合技多屬性：傷害依權重拆成各屬性分別結算
    if (fx.dmgType !== 'true' && multiElem) {
      var eparts = [];
      for (var ek2 in fx.elems) eparts.push(elemShortName(ek2) + '屬性 ' + statStr(Math.round(fx.elems[ek2] * 100)) + '%');
      p.push('傷害依 ' + eparts.join('／') + ' 分屬性結算');
    } else if (fx.dmgType !== 'true' && dmgElem && elemFlavorText(dmgElem)) {
      p.push(elemFlavorText(dmgElem));
    }
    if (fx.doubleCastPct) p.push(statStr(fx.doubleCastPct) + '% 機率雙重施法');
    if (fx.comboDetonate) p.push('目標同時處於減速與燃燒時，引發冰火爆炸追加 ' + statStr(fx.comboDetonate) + '% 傷害');
    if (fx.execBelow) p.push('目標血量 <' + statStr(fx.execBelow) + '% 時傷害 x' + statStr(fx.execMult));
    if (fx.neverMiss) p.push('必定命中');
    if (fx.critBonus) p.push('此擊暴擊率 +' + statStr(fx.critBonus) + '%');
    if (fx.gamble) p.push('傷害隨機浮動 ±' + statStr(67) + '%');
    if (fx.selfDmgPct) p.push('自身損失 ' + statStr(fx.selfDmgPct) + '% 生命');
    if (fx.healPctOfDmg) p.push('汲取傷害的 ' + statStr(fx.healPctOfDmg) + '% 為生命');
    if (fx.mpOnCrit) p.push('爆擊返還 ' + statStr(fx.mpOnCrit) + ' 法力');
    if (fx.goldPer) p.push('掠奪金幣');
    if (fx.dot) p.push('附加' + fx.dot.name + '（每秒 ' + statStr(fx.dot.pct) + '% 技能傷害，' + statStr(fx.dot.dur) + ' 秒）');
    if (fx.dotList) fx.dotList.forEach(function (dd) { p.push('附加' + dd.name + '（每秒 ' + statStr(dd.pct) + '%，' + statStr(dd.dur) + ' 秒）'); });
    if (fx.stunDur) p.push('暈眩 ' + statStr(fx.stunDur) + ' 秒');
    if (fx.slowDur) p.push('減速 ' + statStr(fx.slowDur) + ' 秒');
  }
  if (fx.healPctMax) p.push('回復 ' + scaleStr(fx.healPctMax, lv) + '% 最大生命');
  if (fx.hotPct) p.push('每秒再生 ' + scaleStr(fx.hotPct, lv) + '% 生命，持續 ' + statStr(fx.hotDur) + ' 秒');
  if (fx.shieldPctMax) p.push('目前護盾提高 ' + scaleStr(fx.shieldPctMax, lv) + '%（無護盾時以最大生命計算）');
  if (fx.selfCleanse) p.push('淨化自身負面狀態');
  if (fx.mpRestore) p.push('回復 ' + statStr(fx.mpRestore) + ' 法力');
  skillFxBuffList(fx).forEach(function (bf, bi) {
    p.push((bi === 0 ? '自身' : '') + buffLabel(bf.key) + ' +' + scaleStr(bf, lv) + '%，持續 ' + statStr(bf.dur) + ' 秒');
  });
  skillFxDebuffList(fx).forEach(function (df) {
    p.push('敵方' + buffLabel(df.key) + ' -' + scaleStr(df, lv) + '%，持續 ' + statStr(df.dur) + ' 秒');
  });
  if (fx.maxHpDotPct) p.push('每秒造成敵方最大生命 ' + scaleStr(fx.maxHpDotPct, lv) + '% 的詛咒傷害（' + statStr(fx.dotDur || 5) + '秒，有上限）');

  /* ---- 45 新技能 × 11 機制族：fx 說明分支 ----
     取值統一走 fxVal（純量或 {base,per} 皆可）；有 per 成長＝藍字 growStr、固定值＝橘字 statStr。 */
  function fxNumStr(v, lvArg) {
    if (v !== null && typeof v === 'object' && (v.base !== undefined || v.per !== undefined)) {
      var fval = fxVal(v, lvArg);
      return v.per ? growStr(fmt1(fval)) : statStr(fmt1(fval));
    }
    return statStr(fmt1(v));
  }
  // scope 語意 → 人話（skillAmp／freeCast 共用比對器的顯示對應）
  function scopeLabel(scope) {
    if (!scope || scope === 'all') return '全部技能';
    if (scope === 'next') return '下一個技能';
    if (scope === 'multiHit') return '多段技能';
    if (scope.indexOf('cat:') === 0) {
      var sc = SKILL_CATS[scope.slice(4)];
      return (sc ? sc.name : scope.slice(4)) + '技能';
    }
    if (scope.indexOf('elem:') === 0) {
      var se = ELEM_INFO[scope.slice(5)];
      return ((se && (se.short || se.name)) || scope.slice(5)) + '屬性技能';
    }
    return scope;
  }
  // skillAmp 族（skillAmp／skillAmp2；含 perCdSec 動態增幅、返魔、施放後冷卻削減）
  function pushAmpDesc(a) {
    if (!a) return;
    var s = (a.dur ? fxNumStr(a.dur, lv) + ' 秒內' : '') + scopeLabel(a.scope || 'next');
    if (a.perCdSec !== undefined) {
      s += '增幅＝其冷卻秒數 × ' + fxNumStr(a.perCdSec, lv) + '%';
      if (a.cap !== undefined) s += '（上限 +' + fxNumStr(a.cap, lv) + '%）';
    } else {
      s += '傷害 +' + fxNumStr(a.pct, lv) + '%';
    }
    if (a.uses !== undefined) s += '，受惠 ' + statStr(a.uses) + ' 次';
    if (a.refundPct) s += '；受惠技施放後返還 ' + statStr(a.refundPct) + '% 魔耗';
    if (a.cdrPct) s += '；受惠技施放後冷卻 −' + statStr(a.cdrPct) + '%' + (a.cdrMinCd ? '（原冷卻 ≥' + statStr(a.cdrMinCd) + ' 秒時）' : '');
    p.push(s);
  }
  pushAmpDesc(fx.skillAmp);
  pushAmpDesc(fx.skillAmp2);
  if (fx.comboWindow) p.push('開啟 ' + fxNumStr(fx.comboWindow.dur, lv) + ' 秒連段窗：窗內施放技能傷害 +' +
    fxNumStr(fx.comboWindow.pct, lv) + '% 並重開新窗（斷檔失效）' + (fx.comboWindow.noGcd ? '；連段中免技能共用冷卻' : ''));
  // stackCharge 族：疊層引擎＋疊滿引爆
  if (fx.charge) {
    var chd = fx.charge;
    var srcTxt = chd.source === 'attackHit' ? '普攻命中' : (chd.source === 'hitTaken' ? '被打/格擋' : '每次施放本技');
    var addTxt = Array.isArray(chd.addRange)
      ? '隨機 ' + statStr(chd.addRange[0]) + '~' + statStr(chd.addRange[1]) + ' 層'
      : statStr(chd.add || 0) + ' 層';
    var chs = '疊【' + (chd.name || sk.name) + '】：' + srcTxt + '疊 ' + addTxt +
      '（上限 ' + fxNumStr(chd.max, lv) + ' 層、存續 ' + fxNumStr(chd.dur, lv) + ' 秒）';
    if (chd.addCrit !== undefined) chs += '；暴擊疊 ' + statStr(chd.addCrit) + ' 層';
    if (chd.addBlock !== undefined) chs += '；格擋疊 ' + statStr(chd.addBlock) + ' 層';
    if (chd.burst) {
      chs += '；疊滿引爆：' + (chd.burst.scope === 'next' ? '下一個傷害技' : '本技') + '傷害 ×(1+' + fxNumStr(chd.burst.multPct, lv) + '%)';
      if (chd.burst.anyMultPct !== undefined) chs += '，任意傷害技亦可引爆（×' + fxNumStr(chd.burst.anyMultPct, lv) + '%）';
      if (chd.burst.stunDur) chs += '，並暈眩 ' + statStr(chd.burst.stunDur) + ' 秒';
      if (chd.burst.keepStacks) chs += '，引爆後保留 ' + statStr(chd.burst.keepStacks) + ' 層';
    }
    p.push(chs);
  }
  // resourceConvert 族：mpDump／shieldBurst／hpSacrifice／overhealDmg
  if (fx.mpDump) p.push('耗盡全部剩餘法力，每 10 點被耗法力此擊傷害 +' + fxNumStr(fx.mpDump.pctPer10Mp, lv) + '%');
  if (fx.shieldBurst) p.push('引爆當前護盾的 ' + fxNumStr(fx.shieldBurst.convertPct, lv) + '% 化為追加傷害（上限魔攻 ×' +
    statStr(fx.shieldBurst.capAtkMult || SHIELD_BURST_ATK_MULT_CAP) + '、護盾實際消耗）' +
    (fx.shieldBurst.stunDur ? '；引爆時暈眩 ' + statStr(fx.shieldBurst.stunDur) + ' 秒' : ''));
  if (fx.hpSacrifice) {
    var hsd = fx.hpSacrifice;
    var hss = '獻祭當前生命 ' + statStr(hsd.hpPct) + '%（不致死），此擊傷害 +' + fxNumStr(hsd.ampPct, lv) + '%';
    if (hsd.hotRefundPct) hss += '；獻祭生命以 ' + statStr(hsd.hotDur || 6) + ' 秒持續回復返還 ' + statStr(hsd.hotRefundPct) + '%';
    if (hsd.dmgToShieldPct) hss += '；本次傷害 ' + statStr(hsd.dmgToShieldPct) + '% 轉為護盾';
    p.push(hss);
  }
  if (fx.overhealDmg) p.push('本次治療溢出的 ' + fxNumStr(fx.overhealDmg.pct, lv) + '% 轉為真實傷害（上限 ' +
    statStr(Math.min(fx.overhealDmg.cap !== undefined ? fx.overhealDmg.cap : OVERHEAL_DMG_CAP_PCT, OVERHEAL_DMG_CAP_PCT)) + '%）' +
    (fx.overhealDmg.windowSec ? '；並開啟 ' + statStr(fx.overhealDmg.windowSec) + ' 秒轉傷窗（窗內其他治療技溢出同樣轉傷）' : ''));
  // cdFlow 族：cdShift／cdResetOnKill／cdResetOnKill2／cdOnHitTaken
  if (fx.cdShift) {
    var csd = fx.cdShift, css;
    if (csd.focus === 'longest') {
      css = '竊取 ' + fxNumStr(csd.sec, lv) + ' 秒冷卻，全數灌入剩餘冷卻最長的技能';
      if (csd.onKillRepeat) css += '；擊殺時再竊取一次（內置冷卻 ' + statStr(csd.onKillRepeat.icdSec || 0) + ' 秒）';
      if (csd.zeroSelfCdrPct) css += '；被灌技能歸零時，本技剩餘冷卻 −' + statStr(csd.zeroSelfCdrPct) + '%';
    } else {
      css = (csd.scope ? scopeLabel(csd.scope) : '其他技能') + '剩餘冷卻 −' + fxNumStr(csd.sec, lv) + ' 秒';
      if (csd.extraPct) css += '，扣除後再削減剩餘冷卻 ' + statStr(csd.extraPct) + '%';
    }
    p.push(css);
  }
  if (fx.cdResetOnKill) p.push('擊殺時 ' + statStr(fx.cdResetOnKill.pct !== undefined ? fx.cdResetOnKill.pct : 100) +
    '% 機率重置本技冷卻（內置冷卻 ' + statStr(fx.cdResetOnKill.icdSec || 0) + ' 秒）');
  if (fx.cdResetOnKill2) p.push('擊殺時其他技能剩餘冷卻' +
    (fx.cdResetOnKill2.othersPct ? ' −' + statStr(fx.cdResetOnKill2.othersPct) + '%' : ' −' + fxNumStr(fx.cdResetOnKill2.sec || 0, lv) + ' 秒') +
    '（與擊殺重置共用內置冷卻）');
  if (fx.cdOnHitTaken) p.push('護盾存續期間被打或格擋時，其他技能冷卻 −' + fxNumStr(fx.cdOnHitTaken.sec, lv) +
    ' 秒（內置冷卻 ' + statStr(fx.cdOnHitTaken.icdSec || 0) + ' 秒）' +
    (fx.cdOnHitTaken.onBreak ? '；破盾時一次追加 −' + fxNumStr(fx.cdOnHitTaken.onBreak, lv) + ' 秒' : ''));
  // freeCast 族：freeNext（passiveNthFree 於被動觸發鍵區）
  if (fx.freeNext) {
    var fnd = fx.freeNext;
    var fns = (fnd.dur ? fxNumStr(fnd.dur, lv) + ' 秒內' : '') + '接下來 ' + fxNumStr(fnd.count, lv) + ' 個' +
      (fnd.scope ? scopeLabel(fnd.scope) : '技能') + ' 0 耗魔';
    if (fnd.ampPct) fns += '，效果 +' + fxNumStr(fnd.ampPct, lv) + '%';
    if (fnd.noGcd) fns += '，免技能共用冷卻';
    if (fnd.cdHalf) fns += '，冷卻減半';
    p.push(fns);
  }
  // buffExtend 族：延長自身增益／目標 DoT（累計延長上限＝原始持續 × BUFF_EXTEND_CAP_PCT%）
  if (fx.buffExtend) p.push('自身生效中增益剩餘時間 +' + fxNumStr(fx.buffExtend.sec, lv) + ' 秒（累計延長上限＝原始持續 ' +
    statStr(BUFF_EXTEND_CAP_PCT) + '%）' + (fx.buffExtend.lowThreshold2x ? '；剩餘 <' + statStr(BUFF_EXTEND_LOW_REMAIN_SEC) + ' 秒時延長加倍' : ''));
  if (fx.buffExtend2) p.push('目標身上持續傷害剩餘時間 +' + fxNumStr(fx.buffExtend2.sec, lv) + ' 秒（累計延長上限同增益）');
  // dotSynergy 族：引爆／額外跳動／跳速／每 DoT 增傷／施放條件
  if (fx.dotDetonate) p.push('引爆目標全部持續傷害：以剩餘總值 ×' + fxNumStr(fx.dotDetonate.pct, lv) + '%（上限 ' +
    statStr(Math.min(fx.dotDetonate.cap !== undefined ? fx.dotDetonate.cap : DOT_DETONATE_CAP_PCT, DOT_DETONATE_CAP_PCT)) + '%）造成真實傷害並結清' +
    (fx.dotDetonate.stunDur ? '，並暈眩 ' + statStr(fx.dotDetonate.stunDur) + ' 秒' : '') +
    (fx.dotDetonate.reapplyPct ? '；引爆後以 ' + statStr(fx.dotDetonate.reapplyPct) + '% 強度重新點燃' : ''));
  if (fx.dotPulse) p.push('目標所有持續傷害立即額外跳動 ' + fxNumStr(fx.dotPulse.ticks, lv) + ' 次，每跳 ' +
    fxNumStr(fx.dotPulse.powerPct, lv) + '% 威力（不清空、不消耗持續時間）');
  if (fx.dotHaste) p.push('之後 ' + statStr(fx.dotHaste.dur) + ' 秒目標持續傷害跳動頻率 ×' + statStr(fx.dotHaste.mult));
  if (fx.dotAmpPer) p.push('目標身上每有 1 個持續傷害，對其技能傷害 +' + fxNumStr(fx.dotAmpPer, lv) + '%');
  if (fx.requiresTargetDot) p.push('（目標身上無持續傷害時不施放）');
  // brand 族：塗印／引爆／聖痕
  if (fx.detonate) {
    var dtd = fx.detonate;
    var dts = '引爆目標' + (!dtd.brand || dtd.brand === 'any' ? '全部印記' : '【' + dtd.brand + '】印記') +
      '：儲能 ×' + fxNumStr(dtd.multPct, lv) + '% 真實傷害';
    if (dtd.chainPct) dts += '；每層向隨機另一敵彈射儲能 ' + statStr(dtd.chainPct) + '% 的餘波';
    if (dtd.healPctMaxPerStack) dts += '；每層回復最大生命 ' + statStr(dtd.healPctMaxPerStack) + '%';
    if (dtd.healPctMax) dts += '；引爆自療最大生命 ' + statStr(dtd.healPctMax) + '%';
    if (dtd.stunDur) dts += '；引爆附帶暈眩 ' + statStr(dtd.stunDur) + ' 秒';
    if (dtd.resetCd && dtd.resetCd.id) {
      var rsk = SKILLS[dtd.resetCd.id];
      dts += '；引爆成功 ' + statStr(dtd.resetCd.pct || 0) + '% 機率重置【' + (rsk ? rsk.name : dtd.resetCd.id) + '】冷卻';
    }
    p.push(dts);
  }
  if (fx.brand) p.push('烙上【' + fx.brand.name + '】印記：儲存本次總傷害的 ' + statStr(fx.brand.storePct) + '%（' +
    fxNumStr(fx.brand.dur, lv) + ' 秒、最多疊 ' + fxNumStr(fx.brand.maxStacks, lv) + ' 層）');
  if (fx.stigma) {
    var sgd = fx.stigma;
    p.push('展開 ' + fxNumStr(sgd.dur, lv) + ' 秒聖痕：儲存所受傷害的 ' + statStr(sgd.storePct) + '%（上限最大生命 ' +
      fxNumStr(sgd.capMaxHpPct, lv) + '%）；再施放或期滿時引爆，造成儲傷 ×' + fxNumStr(sgd.multPct, lv) + '% 真實傷害並獲得其 ' +
      statStr(sgd.shieldPct === undefined ? 100 : sgd.shieldPct) + '% 護盾' +
      (sgd.stunDur ? '，引爆附帶暈眩 ' + statStr(sgd.stunDur) + ' 秒' : ''));
  }
  // procCast 族：proc／proc2／replayBest
  function pushProcDesc(cfg, secondRoll) {
    if (!cfg) return;
    var onTxt = cfg.on === 'kill' ? '擊殺' : (cfg.on === 'crit' ? '暴擊' : '命中');
    var doTxt;
    if (cfg.do === 'recast') doTxt = '以 ' + fxNumStr(cfg.powerPct, lv) + '% 威力重放本技';
    else if (cfg.do === 'freeAttack') doTxt = '引動一次免費普攻（不佔攻速條）' + (cfg.forceCrit ? '，必定暴擊' : '');
    else doTxt = '隨機引動一個已學傷害技能，以 ' + fxNumStr(cfg.powerPct, lv) + '% 威力免費結算';
    p.push((secondRoll ? '追加：' : '') + onTxt + '時 ' + fxNumStr(cfg.pct, lv) + '% 機率' + doTxt);
  }
  pushProcDesc(fx.proc);
  pushProcDesc(fx.proc2, true);
  if (fx.replayBest) p.push('重播最近 ' + fxNumStr(fx.replayBest.window, lv) + ' 秒內單次傷害最高的技能（' +
    fxNumStr(fx.replayBest.powerPct, lv) + '% 威力快照）' +
    ((fxVal(fx.replayBest.repeat, lv) || 1) > 1 ? ' ×' + fxNumStr(fx.replayBest.repeat, lv) + ' 次' : ''));
  // echo 族：延遲回響／傷害快照窗／治療回響窗
  if (fx.echo) p.push('施放 ' + statStr(fx.echo.delay) + ' 秒後以 ' + fxNumStr(fx.echo.powerPct, lv) + '% 威力快照回響' +
    ((fxVal(fx.echo.repeat, lv) || 1) > 1 ? '，共 ' + fxNumStr(fx.echo.repeat, lv) + ' 次' : ''));
  if (fx.dmgWindow) p.push('開啟 ' + fxNumStr(fx.dmgWindow.dur, lv) + ' 秒快照窗：期滿以窗內你造成傷害總和的 ' +
    fxNumStr(fx.dmgWindow.pct, lv) + '% 一次轟出（真實傷害）');
  if (fx.healEcho) p.push('記錄 ' + fxNumStr(fx.healEcho.dur, lv) + ' 秒內所受傷害，期滿回復其 ' + fxNumStr(fx.healEcho.pct, lv) + '%');
  // periodicField 族：領域
  if (fx.field) {
    var fdd = fx.field;
    var ampKeyTxt = fdd.elem
      ? ((ELEM_INFO[fdd.elem] && (ELEM_INFO[fdd.elem].short || ELEM_INFO[fdd.elem].name)) || fdd.elem) + '屬性'
      : (fx.dmgType === 'phys' ? '物理' : '魔法');
    p.push('展開【' + (fdd.name || sk.name) + '】' + fxNumStr(fdd.dur, lv) + ' 秒：每 ' + fxNumStr(fdd.tickSec, lv) +
      ' 秒以施放快照的 ' + fxNumStr(fdd.tickPct, lv) + '% 打擊全場敵人' +
      (fdd.takenAmpPct ? '；領域內敵人受' + ampKeyTxt + '傷害 +' + statStr(fdd.takenAmpPct) + '%' : ''));
  }
  // 被動觸發鍵（觸發鍵型被動技能；經 computeStats 聚合至 st.skillTriggers 生效）
  if (fx.passiveEcho) {
    var ped = fx.passiveEcho;
    p.push('傷害技能施放 ' + statStr(ped.delay || 2) + ' 秒後，' + fxNumStr(ped.pct, lv) + '% 機率以 ' +
      fxNumStr(ped.powerPct, lv) + '% 威力回響（不再連鎖）' +
      (ped.secondPct ? '；成功時 ' + statStr(ped.secondPct) + '% 機率追加第二響（×' + statStr(ped.secondPowerPct || 0) + '% 威力）' : ''));
  }
  if (fx.passiveKillCd) {
    var pkd = fx.passiveKillCd;
    p.push('技能擊殺後，其他技能冷卻 −' + fxNumStr(pkd.sec, lv) + ' 秒（內置冷卻 ' + statStr(pkd.icdSec || 0) + ' 秒）' +
      (pkd.selfResetPct ? '；' + statStr(pkd.selfResetPct) + '% 機率重置該技自身冷卻' : '') +
      (pkd.inclBasic ? '；普攻擊殺也觸發（共用內置冷卻）' : ''));
  }
  if (fx.passiveProc) {
    var ppd = fx.passiveProc;
    p.push('技能暴擊時 ' + fxNumStr(ppd.pct, lv) + '% 機率引動免費普攻（不佔攻速條）' +
      (ppd.forceCrit ? '，引動普攻必定暴擊' : '') +
      (ppd.recastPct ? '；引動時 ' + statStr(ppd.recastPct) + '% 機率改為以 ' + statStr(ppd.recastPowerPct || 0) + '% 威力重放本技' : ''));
  }
  if (fx.passiveDotHaste) p.push('你的持續傷害跳動頻率 ×' + fxNumStr(fx.passiveDotHaste.mult, lv) + '（持續時間不變、等效總傷提高）');
  if (fx.dotSplashOnKill) p.push('目標死亡時，其身上持續傷害以 ' + fxNumStr(fx.dotSplashOnKill, lv) + '% 強度濺射至隨機存活敵人（剩餘時間照搬）');
  if (fx.passiveNthFree) p.push('每第 ' + statStr(fx.passiveNthFree.n) + ' 次技能施放免費，且該次效果 +' +
    fxNumStr(fx.passiveNthFree.ampPct, lv) + '%' + (fx.passiveNthFree.noGcd ? '；免費那次免技能共用冷卻' : ''));
  if (fx.passiveExtraHit) {
    var pxd = fx.passiveExtraHit;
    p.push('多段技能（' + statStr(pxd.minHits || 2) + ' 段以上）追加 ' + statStr(pxd.count || 1) + ' 段幻影斬（每段 ' +
      fxNumStr(pxd.powerPct, lv) + '% 威力）' + (pxd.neverMiss ? '，幻影段必定命中' : ''));
  }
  if (fx.passiveDefFeedback) {
    var pfd = fx.passiveDefFeedback;
    p.push('施放防禦與治療技能後獲得 1 層反哺：' + statStr(pfd.dur || DEF_FEEDBACK_DUR_SEC) + ' 秒內下一個傷害技 +' +
      fxNumStr(pfd.pct, lv) + '%（最多儲 ' + statStr(pfd.stacks || 1) + ' 層）' +
      (pfd.cdRefund ? '；消耗時來源技能冷卻 −' + statStr(pfd.cdRefund) + ' 秒' : ''));
  }
  if (fx.passiveBrandAmp) {
    var pbd = fx.passiveBrandAmp;
    p.push('印記儲能比例 +' + fxNumStr(pbd.storeBonus, lv) + '%；引爆時 ' + statStr(pbd.keepPct || 0) + '% 機率不消耗印記層數' +
      (pbd.transferOnKill ? '；目標死亡時印記轉移至隨機存活敵人' : ''));
  }
  if (fx.passiveCastExtend) {
    var pcd = fx.passiveCastExtend;
    p.push('每次施放傷害技能，自身增益剩餘時間 +' + fxNumStr(pcd.sec, lv) + ' 秒（累計延長上限＝原始持續 ' + statStr(BUFF_EXTEND_CAP_PCT) + '%）' +
      (pcd.alsoDots ? '；同時延長目標持續傷害 +' + statStr(pcd.alsoDots) + ' 秒' : '') +
      (pcd.lowThreshold2x ? '；增益剩餘 <' + statStr(BUFF_EXTEND_LOW_REMAIN_SEC) + ' 秒時延長加倍' : ''));
  }

  // 系別歸屬：傷害段已寫明屬性者不重複；無傷害段或真傷技能才補一句系別（如星辰引導＝聖系、虛空裂隙＝暗系）
  var elemStated = !!(fx.dmgType && fx.dmgType !== 'true' && (dmgElem || fx.elems));
  if (sysTag && !elemStated && ELEM_SYS_FLAVOR[sysTag]) p.push(ELEM_SYS_FLAVOR[sysTag]);

  var desc = p.join('；');
  // 45 新技能：觸發鍵型被動（無 fx.passive 屬性桶）補「被動：」前綴，與既有被動顯示一致
  if (sk.cat === 'passive' && desc) desc = '被動：' + desc;
  // 融合技：附上變異與素材資訊
  if (sk.cat === 'fusion') {
    if (!skipFusionDetail) {
      if (sk.mutation) desc += '<div class="skt-mutation">【變異：' + sk.mutation.name + '】' + sk.mutation.desc + '</div>';
      if (sk.components) {
        var cn = sk.components.map(function (cid) { var d = SKILLS[cid]; return d ? d.name : cid; });
        desc += '<div class="skt-components">（融合自：' + cn.join(' ＋ ') + '）</div>';
      }
    }
  } else {
    var nx = nextUnlockLv(id, lv);
    if (nx) desc += '。⭐ Lv.' + nx + ' 解鎖／強化附加效果';
  }
  return desc;
}
