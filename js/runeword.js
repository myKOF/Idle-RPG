'use strict';
/* ============ 符文之語：執行層 ============
   資料表在 js/runeword_data.js（符文、符文之語、效果詞彙）。本檔負責：
     §1 符文庫存與合成／拆解     （G.player.runes = { 符文id: 數量 }，隨存檔）
     §2 符文孔、鑲嵌與符文之語判定（符文孔 it.runes = [符文id|null, …]，最多 4 孔，與寶石鑲孔 it.sockets 分開；
                                    符文之語是當場判定的衍生狀態，不存檔）
     §3 屬性聚合                 （computeStats 呼叫 rwNewAggregate／rwAddItem／rwFinishAggregate）
     §4 戰鬥掛勾                 （傷害乘區、攻速、冷卻、法力、受擊、死亡、事件觸發 rwFire）
     §5 掉落
     §6 說明文字                 （由資料自動產生，說明與實際效果同源，不會漂移）
   戰鬥期短暫狀態存在 RW_RT，不進存檔。 */

var RW_STAT_SCALE = RUNE_SETTINGS.statScale;   // 全域縮放：符文與符文之語的 stats 一律乘此值（平衡用旋鈕；配置表 Runes 的 statScale）
var RW_DEPTH_LIMIT = 3;         // 事件觸發的巢狀上限（擊殺 → 觸發 → 再擊殺…）

/* ---- 戰鬥期狀態（不入存檔） ---- */
var RW_RT = null;
/* 戰鬥重置（resetSkillRT 鏈結：開場、陣亡、進出高塔）清掉觸發冷卻與計數；
   復活冷卻跨戰鬥保留——否則進出高塔就能洗掉 180 秒冷卻。 */
function rwResetRT() {
  RW_RT = { procs: {}, reviveReadyAt: RW_RT ? RW_RT.reviveReadyAt : 0, depth: 0 };
}
rwResetRT();
function rwEnsureRT() {
  if (!RW_RT) rwResetRT();
  return RW_RT;
}

/* ============================================================
   §1 符文庫存
   ============================================================ */
function runeCount(id) {
  var r = (typeof G !== 'undefined' && G && G.player) ? G.player.runes : null;
  return Math.max(0, Math.floor(Number(r && r[id]) || 0));
}
function totalRunes() {
  var n = 0;
  for (var i = 0; i < RUNES.length; i++) n += runeCount(RUNES[i].id);
  return n;
}
function addRune(id, n) {
  if (!RUNE_BY_ID[id]) return 0;
  if (!G.player.runes || typeof G.player.runes !== 'object') G.player.runes = {};
  var delta = (n === undefined) ? 1 : Math.floor(Number(n) || 0);
  G.player.runes[id] = Math.max(0, runeCount(id) + delta);
  if (typeof UI !== 'undefined' && UI.dirty) { UI.dirty.gems = true; UI.dirty.header = true; }
  return delta;
}

/* 合成：同種 RUNE_COMPOSE_COUNT 顆 → 下一階 1 顆。成功回 null，失敗回錯誤字串。 */
function composeRune(id) {
  var r = RUNE_BY_ID[id];
  if (!r) return '未知符文';
  if (r.tier >= RUNE_COMPOSE_MAX_TIER) {
    return '「' + runeLabel(id) + '」已不能再合成（第 ' + RUNE_COMPOSE_MAX_TIER + ' 階以上的符文只能靠掉落取得）';
  }
  if (runeCount(id) < RUNE_COMPOSE_COUNT) return '「' + runeLabel(id) + '」不足 ' + RUNE_COMPOSE_COUNT + ' 顆';
  var next = RUNES[r.tier];            // tier 是 1 起算，RUNES[tier] 即下一階
  addRune(id, -RUNE_COMPOSE_COUNT);
  addRune(next.id, 1);
  return null;
}

/* 拆解：1 顆 → 低一階符文 RUNE_DISMANTLE_YIELD 顆（第 1 階不可拆）。 */
function dismantleRune(id) {
  var r = RUNE_BY_ID[id];
  if (!r) return { err: '未知符文' };
  if (r.tier <= 1) return { err: '第 1 階符文無法再拆解' };
  if (runeCount(id) < 1) return { err: '沒有「' + runeLabel(id) + '」' };
  var lower = RUNES[r.tier - 2];
  addRune(id, -1);
  addRune(lower.id, RUNE_DISMANTLE_YIELD);
  return { n: RUNE_DISMANTLE_YIELD, id: lower.id };
}

/* ============================================================
   §2 符文孔、鑲嵌與符文之語判定
   ============================================================ */
/* 符文孔數：由稀有度決定（RUNE_SETTINGS.slotsByRarity），不超過 maxSlots；沒有雙手加成。 */
function runeSlotCountFor(it) {
  if (!it) return 0;
  var r = clamp(Math.floor(Number(it.rarity) || 0), 0, RARITIES.length - 1);
  return clamp(Math.floor(Number(RUNE_SETTINGS.slotsByRarity[r]) || 0), 0, RUNE_SETTINGS.maxSlots);
}
/* 這件裝備的符文孔內容（純讀取，不改動裝備）：[符文id|null, …]。
   長度＝孔數；但已鑲在更後面孔位的符文不會因設定調降孔數而消失（仍會列出、可取下）。 */
function rwSlots(it) {
  var stored = it && Array.isArray(it.runes) ? it.runes : [];
  var n = Math.max(runeSlotCountFor(it), Math.min(stored.length, RUNE_SETTINGS.maxSlots));
  var out = [];
  for (var i = 0; i < n; i++) out.push(stored[i] && RUNE_BY_ID[stored[i]] ? stored[i] : null);
  return out;
}
/* 補齊 it.runes 到孔數（鑲嵌時才呼叫；渲染函式不得呼叫）。 */
function ensureRuneSlots(it) {
  var n = runeSlotCountFor(it);
  if (!Array.isArray(it.runes)) it.runes = [];
  while (it.runes.length < n) it.runes.push(null);
  for (var i = 0; i < it.runes.length; i++) if (it.runes[i] === undefined) it.runes[i] = null;
  return it.runes;
}
/* 快速路徑：絕大多數裝備沒有任何符文，itemScore／排序會大量呼叫判定，先用這個擋掉。 */
function rwHasRune(it) {
  var s = it && it.runes;
  if (!s) return false;
  for (var i = 0; i < s.length; i++) if (s[i]) return true;
  return false;
}

/* 鑲入符文：index 省略＝第一個空孔。成功回 null，失敗回錯誤字串。 */
function socketRune(it, runeId, index) {
  if (!it) return '找不到裝備';
  if (!RUNE_BY_ID[runeId]) return '沒有這種符文';
  if (!runeSlotCountFor(it)) return '這件裝備沒有符文孔（精良以上才有）';
  var slots = ensureRuneSlots(it);
  var idx = index == null ? slots.indexOf(null) : index;
  if (index == null && idx < 0) return '符文孔已滿（點擊已鑲的符文可取下）';
  if (!Number.isInteger(idx) || idx < 0 || idx >= slots.length) return '沒有可用的符文孔';
  if (slots[idx] !== null) return '此符文孔已有符文';
  if (runeCount(runeId) < 1) return '符文不足';
  var before = rwActiveWord(it);
  addRune(runeId, -1);
  slots[idx] = runeId;
  if (typeof G !== 'undefined' && G && G.factory && G.factory.stats) G.factory.stats.runeSocketed = (G.factory.stats.runeSocketed || 0) + 1;   // 任務進度
  if (typeof markStatsDirty === 'function') markStatsDirty();
  if (typeof UI !== 'undefined' && UI.dirty) { UI.dirty.equip = true; UI.dirty.inv = true; UI.dirty.header = true; }
  var after = rwActiveWord(it);
  if (after && (!before || before.word.id !== after.word.id) && typeof blog === 'function') {
    blog('✨ 符文之語【' + after.word.name + '】成形！', 'good');
  }
  return null;
}

/* 取下指定符文孔的符文回庫存。成功回 true。 */
function unsocketRune(it, idx) {
  if (!it || !Array.isArray(it.runes) || !Number.isInteger(idx) || !it.runes[idx]) return false;
  addRune(it.runes[idx], 1);
  it.runes[idx] = null;
  if (typeof markStatsDirty === 'function') markStatsDirty();
  if (typeof UI !== 'undefined' && UI.dirty) { UI.dirty.equip = true; UI.dirty.inv = true; UI.dirty.header = true; }
  return true;
}

/* 取回這件裝備上所有符文（分解、神鑄、熔爐取回素材時共用）。回傳取回的顆數。 */
function rwReclaimAllRunes(it) {
  var n = 0;
  if (!it || !Array.isArray(it.runes)) return 0;
  for (var i = 0; i < it.runes.length; i++) {
    if (it.runes[i]) { addRune(it.runes[i], 1); it.runes[i] = null; n++; }
  }
  return n;
}

/* 舊版（符文與寶石共用鑲孔）的存檔整理：把 it.sockets 裡的 { rune } 移到符文孔，放不下的退回庫存。冪等。 */
function rwMigrateSocketRunes(it) {
  if (!it || !Array.isArray(it.sockets)) return false;
  var moved = false;
  for (var i = 0; i < it.sockets.length; i++) {
    var g = it.sockets[i];
    if (!g || !g.rune) continue;
    moved = true;
    it.sockets[i] = null;
    var slots = ensureRuneSlots(it);
    var free = slots.indexOf(null);
    if (RUNE_BY_ID[g.rune] && free >= 0) slots[free] = g.rune;
    else if (RUNE_BY_ID[g.rune]) addRune(g.rune, 1);
  }
  return moved;
}

/* 裝備類型標記比對。bases 省略或含 any ＝ 不限。 */
function rwItemMatches(it, bases) {
  if (!it) return false;
  if (!bases || !bases.length) return true;
  var wd = (typeof weaponDef === 'function') ? weaponDef(it) : null;
  var slot = it.slot;
  for (var i = 0; i < bases.length; i++) {
    var b = bases[i];
    if (b === 'any') return true;
    if (b === slot) return true;
    if (b === 'armor' && RW_ARMOR_SLOTS.indexOf(slot) >= 0) return true;
    if (b === 'jewelry' && RW_JEWELRY_SLOTS.indexOf(slot) >= 0) return true;
    if (wd) {
      if (b === 'mainHand' && (wd.cat === 'oneHand' || wd.cat === 'twoHand')) return true;
      if (b === 'oneHand' && wd.cat === 'oneHand') return true;
      if (b === 'twoHand' && wd.cat === 'twoHand') return true;
      if (b === 'offHand' && wd.cat === 'offHand') return true;
      if (b === 'melee' && RW_MELEE_TYPES.indexOf(it.weaponType) >= 0) return true;
      if (b === 'caster' && RW_CASTER_TYPES.indexOf(it.weaponType) >= 0) return true;
      if (b === it.weaponType) return true;
    }
  }
  return false;
}

/* 這件裝備目前成形的符文之語：{ word, start }；沒有回 null。
   規則：連續鑲孔依序放滿該組符文，且裝備類型符合；多組同時符合取符文數最多者。 */
function rwActiveWord(it) {
  if (!rwHasRune(it)) return null;
  var best = null;
  var socks = rwSlots(it);
  for (var wi = 0; wi < RUNEWORDS.length; wi++) {
    var w = RUNEWORDS[wi];
    var n = w.runes.length;
    if (n > socks.length) continue;
    if (best && n <= best.word.runes.length) continue;
    if (!rwItemMatches(it, w.bases)) continue;
    for (var s = 0; s + n <= socks.length; s++) {
      var ok = true;
      for (var k = 0; k < n; k++) {
        if (socks[s + k] !== w.runes[k]) { ok = false; break; }
      }
      if (ok) { best = { word: w, start: s }; break; }
    }
  }
  return best;
}

/* 配方提示：目前鑲孔狀態還有哪些符文之語「差幾顆就成形」。
   回傳 [{ word, start, missing: [符文id…] }]，missing 為尚缺的符文（依序、對應空孔）。
   至少要有一顆符文已放在正確位置才算候選（全空不列，不然 56 組全是候選）。 */
function rwCandidates(it) {
  var out = [];
  if (!rwHasRune(it)) return out;
  var socks = rwSlots(it);
  var active = rwActiveWord(it);
  for (var wi = 0; wi < RUNEWORDS.length; wi++) {
    var w = RUNEWORDS[wi];
    var n = w.runes.length;
    if (n > socks.length || !rwItemMatches(it, w.bases)) continue;
    if (active && active.word.id === w.id) continue;
    var pick = null;
    for (var s = 0; s + n <= socks.length && !pick; s++) {
      var hit = 0, ok = true, missing = [];
      for (var k = 0; k < n; k++) {
        var g = socks[s + k];
        if (!g) { missing.push(w.runes[k]); continue; }
        if (g === w.runes[k]) { hit++; continue; }
        ok = false; break;
      }
      if (ok && hit > 0 && missing.length) pick = { word: w, start: s, missing: missing };
    }
    if (pick) out.push(pick);
  }
  return out;
}

/* ============================================================
   §3 屬性聚合
   ============================================================ */
/* 單條 stats 的數值＝ 詞條基準值(詞條, 裝備等級, 稀有度) × mult × 強化倍率。
   與詞條同源（affixBaseValue／affixRoundValue → js/formula.js §6），隨裝備成長。
   不吃雙手倍率（TWO_HAND_AFFIX_VALUE_MULT）：雙手武器已經靠 ×1.75 的鑲孔數拿到補償
   （更多符文屬性＋更容易湊出長配方），再 ×2 會讓雙手符文之語整整領先一個級距。 */
function rwStatValue(it, key, mult) {
  if (!AFFIX_POOL[key] || !it) return 0;
  var um = (typeof upgradeMult === 'function') ? upgradeMult(it) : 1;
  var base = affixBaseValue(key, it.level, it.rarity);
  return affixRoundValue(key, base * (Number(mult) || 0) * um * RW_STAT_SCALE);
}

/* 符文單獨鑲著的加成類別：主手／雙手武器用 w，其餘（防具、飾品、副手）用 a。 */
function rwRuneSide(it) {
  var wd = (typeof weaponDef === 'function') ? weaponDef(it) : null;
  return (wd && (wd.cat === 'oneHand' || wd.cat === 'twoHand')) ? 'w' : 'a';
}

/* 屬性顯示：「物理攻擊 +123」「暴擊率 +4.2%」；名稱去掉詞條名尾端的 %。 */
function rwFormatStat(key, v) {
  var def = AFFIX_POOL[key];
  var name = def ? def.name.replace(/%$/, '') : key;
  var num = (def && def.pct) ? (Math.abs(v)) + '%' : fmt(Math.abs(v));
  return name + ' ' + (v < 0 ? '-' : '+') + num;
}
/* 符文鑲在這件裝備上實際提供的屬性文字（符文庫與鑲孔列表用）。 */
function rwRuneStatLine(it, runeId) {
  var r = RUNE_BY_ID[runeId];
  if (!r) return '';
  var spec = r[rwRuneSide(it)];
  return rwFormatStat(spec[0], rwStatValue(it, spec[0], spec[1]));
}

/* 一件裝備上符文與符文之語提供的所有屬性：[{ key, val, src }]。 */
function rwItemStatEntries(it) {
  var out = [];
  if (!rwHasRune(it)) return out;
  var side = rwRuneSide(it);
  var slots = rwSlots(it);
  for (var i = 0; i < slots.length; i++) {
    if (!slots[i]) continue;
    var spec = RUNE_BY_ID[slots[i]][side];
    var v = rwStatValue(it, spec[0], spec[1]);
    if (v) out.push({ key: spec[0], val: v, src: 'rune' });
  }
  var act = rwActiveWord(it);
  if (act && act.word.stats) {
    for (var j = 0; j < act.word.stats.length; j++) {
      var sp = act.word.stats[j];
      var wv = rwStatValue(it, sp[0], sp[1]);
      if (wv) out.push({ key: sp[0], val: wv, src: 'word' });
    }
  }
  return out;
}

function rwNewAggregate() {
  return { seen: {}, words: [], fx: {}, procs: [], legend: [], passives: {} };
}

/* 把一件裝備併入聚合；回傳該裝備的屬性條目供 computeStats 併入桶。
   同一組符文之語穿在多件裝備上時：各件的 stats 都計，機制（fx／procs／passives／legend）只算一次。 */
function rwAddItem(agg, it) {
  var entries = rwItemStatEntries(it);
  var act = rwActiveWord(it);
  if (act && !agg.seen[act.word.id]) {
    var w = act.word;
    agg.seen[w.id] = true;
    agg.words.push(w.id);
    var fx = w.fx || {};
    for (var k in fx) {
      if (k === 'maxHitPct') {
        agg.fx[k] = agg.fx[k] > 0 ? Math.min(agg.fx[k], fx[k]) : fx[k];   // 單次傷害上限取最嚴格者
      } else {
        agg.fx[k] = (agg.fx[k] || 0) + fx[k];
      }
    }
    var procs = w.procs || [];
    for (var p = 0; p < procs.length; p++) agg.procs.push({ wid: w.id, idx: p, name: w.name, proc: procs[p] });
    var lg = w.legend || [];
    for (var l = 0; l < lg.length; l++) if (agg.legend.indexOf(lg[l]) < 0) agg.legend.push(lg[l]);
    var ps = w.passives || {};
    for (var pk in ps) agg.passives[pk] = (agg.passives[pk] || 0) + ps[pk];
  }
  return entries;
}

/* 聚合收尾：被動並入 passives、借用的傳奇特效並入 legendaryEffects；回傳要掛在 st.rw 的精簡物件。 */
function rwFinishAggregate(agg, passives, legendaryEffects) {
  for (var pk in agg.passives) passives[pk] = (passives[pk] || 0) + agg.passives[pk];
  if (typeof PASSIVE_POOL !== 'undefined') {
    for (var i = 0; i < agg.legend.length; i++) {
      if (PASSIVE_POOL[agg.legend[i]]) legendaryEffects[agg.legend[i]] = true;
    }
  }
  return { words: agg.words, fx: agg.fx, procs: agg.procs };
}

/* ============================================================
   §4 戰鬥掛勾
   ============================================================ */
function rwStats() {
  var st = (typeof getStats === 'function') ? getStats() : null;
  return (st && st.rw && st.rw.words.length) ? st : null;
}
function rwFxValue(key) {
  var st = rwStats();
  return st ? (Number(st.rw.fx[key]) || 0) : 0;
}

function rwEnemyFloat() {
  return (typeof G !== 'undefined' && G && G.tower && G.tower.active) ? 'tb-float' : 'mv-float';
}
function rwPlayerFloat() {
  return (typeof G !== 'undefined' && G && G.tower && G.tower.active) ? 'tp-float' : 'pv-float';
}

/* ---- 傷害乘區（legendaryOutgoingDamageMultiplier 呼叫；僅玩家攻擊端）----
   所有條件式增傷都在這裡收斂，普攻、技能、傳奇特效傷害、持續傷害一體適用。 */
function rwOutgoingMultiplier(attacker, defender, aCfg) {
  var st = rwStats();
  if (!st) return 1;
  var fx = st.rw.fx;
  var m = 1;
  if (fx.dmgPct) m *= 1 + fx.dmgPct / 100;
  var isDot = !(aCfg && aCfg.atk !== undefined);
  if (!isDot) {
    if (aCfg.isSkill) { if (fx.skillDmgPct) m *= 1 + fx.skillDmgPct / 100; }
    else if (fx.basicDmgPct) m *= 1 + fx.basicDmgPct / 100;
  }
  if (defender && defender.maxHp > 0) {
    var hpRatio = defender.hp / defender.maxHp;
    if (fx.dmgHiHpPct && hpRatio > 0.7) m *= 1 + fx.dmgHiHpPct / 100;
    if (fx.dmgLoHpPct && hpRatio < 0.3) m *= 1 + fx.dmgLoHpPct / 100;
  }
  if (fx.dmgCtrlPct && defender && typeof effectActive === 'function' &&
      (effectActive(defender, 'stun') || effectActive(defender, 'slow'))) m *= 1 + fx.dmgCtrlPct / 100;
  if ((fx.dmgSoloPct || fx.dmgPerFoePct) && typeof legendaryActiveEnemies === 'function') {
    var alive = legendaryActiveEnemies().length;
    if (fx.dmgSoloPct && alive === 1) m *= 1 + fx.dmgSoloPct / 100;
    if (fx.dmgPerFoePct && alive > 1) m *= 1 + fx.dmgPerFoePct * Math.min(10, alive - 1) / 100;
  }
  if ((fx.dmgSelfFullPct || fx.dmgSelfLowPct) && attacker && st.hp > 0) {
    var selfRatio = attacker.hp / st.hp;
    if (fx.dmgSelfFullPct && selfRatio >= 0.9) m *= 1 + fx.dmgSelfFullPct / 100;
    if (fx.dmgSelfLowPct && selfRatio <= 0.35) m *= 1 + fx.dmgSelfLowPct / 100;
  }
  return Math.max(0.05, m);
}

/* 攻速（乘算、突破攻速上限）；與其他攻速倍率相乘。 */
function rwAttackSpeedMultiplier() {
  var v = rwFxValue('aspdMult');
  return v ? Math.max(0.2, 1 + v / 100) : 1;
}
/* 技能冷卻倍率（乘算、突破冷卻縮減上限；最低 ×0.2）。 */
function rwCooldownFactor() {
  var v = rwFxValue('cdPct');
  return v ? Math.max(0.2, 1 - v / 100) : 1;
}
/* 技能法力消耗倍率（0~1）。 */
function rwManaCostFactor() {
  var v = rwFxValue('manaCostRedPct');
  return v ? clamp(1 - v / 100, 0, 1) : 1;
}
/* 單次受傷上限（% 最大生命）；0＝沒有。 */
function rwMaxHitPct() { return rwFxValue('maxHitPct'); }

/* ---- 事件觸發引擎 ---- */
function rwEnemies() {
  return (typeof legendaryActiveEnemies === 'function') ? legendaryActiveEnemies() : [];
}
function rwAliveOnly(list) {
  var out = [];
  for (var i = 0; i < list.length; i++) if (list[i] && list[i].hp > 0) out.push(list[i]);
  return out;
}
function rwPickTargets(act, ctx) {
  var to = act.to || 'target';
  if (to === 'attacker') return (ctx.attacker && ctx.attacker.hp > 0) ? [ctx.attacker] : [];
  var enemies = rwAliveOnly(ctx.enemies || rwEnemies());
  if (to === 'all') return enemies;
  if (to === 'rand') {
    var pool = enemies.slice(), n = Math.max(1, Math.floor(act.n || 1)), res = [];
    while (res.length < n && pool.length) res.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return res;
  }
  if (ctx.target && ctx.target.hp > 0) return [ctx.target];
  if (!enemies.length) return [];
  return [(typeof legendaryNearestEnemy === 'function')
    ? legendaryNearestEnemy(enemies, ctx.pEnt) : enemies[0]];
}

function rwDotSid(name) {
  return ({ poison: 'poison', burn: 'burn', bleed: 'bleed', corrode: 'corrode' })[name] || 'poison';
}

function rwCastableGroups(pEnt) {
  var lo = (typeof G !== 'undefined' && G && G.player && G.player.loadout) ? G.player.loadout : [];
  var out = [];
  for (var i = 0; i < lo.length; i++) {
    var id = lo[i];
    if (typeof id !== 'string' || id.indexOf('sg:') !== 0) continue;
    var gid = id.slice(3);
    if (typeof SKILLS2 === 'undefined' || !SKILLS2[gid]) continue;
    if (typeof skills2Castable === 'function' && !skills2Castable(gid)) continue;
    if (typeof skills2ActsPassive === 'function' ? skills2ActsPassive(gid)
      : (typeof skills2IsPassive === 'function' && skills2IsPassive(gid))) continue;
    out.push(gid);
  }
  return out;
}

function rwFreeCast(pEnt, gid, ctx, out) {
  if (typeof castSkill2 !== 'function') return;
  var enemies = rwAliveOnly(ctx.enemies || rwEnemies());
  if (!enemies.length) return;
  var r = castSkill2(pEnt, enemies, gid, ctx.floatSel || rwEnemyFloat(), { repeat: true });
  if (r) {
    out.dmg += r.dmg || 0;
    if (r.killed) out.killed = true;
  }
}

/* 執行一串動作；結果累計到 out（{ dmg, killed }）。 */
function rwRunActs(proc, ctx, out) {
  var pEnt = ctx.pEnt;
  var st = getStats();
  var label = '符文之語·' + (ctx.wordName || '');
  var acts = proc.acts || [];
  for (var i = 0; i < acts.length; i++) {
    var a = acts[i], t, k, targets, res, amt;
    switch (a.act) {
      case 'dmg':
        targets = rwPickTargets(a, ctx);
        for (t = 0; t < targets.length; t++) {
          var elem = a.elem === 'random' ? pick(ELEMENTS) : (a.elem || null);
          var dtype = a.type || (elem ? 'magic' : 'phys');
          res = legendaryDealDamage(pEnt, targets[t], a.pct, dtype, elem, ctx.floatSel || rwEnemyFloat(), label,
            ctx.cb);
          if (res) {
            out.dmg += res.dmg || 0;
            if (res.killed) out.killed = true;
          }
        }
        break;
      case 'execute':
        targets = rwPickTargets({ to: 'all' }, ctx);
        for (t = 0; t < targets.length; t++) {
          var e = targets[t];
          if (e.isBoss || e.towerBoss || !(e.maxHp > 0)) continue;
          if (e.hp / e.maxHp * 100 >= a.hpBelow) continue;
          var before = e.hp;
          applyEnemyHpDamage(e, e.hp);
          out.dmg += before - Math.max(0, e.hp);
          if (typeof floatEnemyEvent === 'function') floatEnemyEvent(e, ctx.floatSel || rwEnemyFloat(), '斬殺', 'crit enemy-skill', before);
          if (e.hp <= 0) out.killed = true;
        }
        break;
      case 'heal':
        amt = st.hp * a.pctMax / 100;
        healPlayer(pEnt, amt, st, { noShield: true });
        if (typeof floatPlayerEvent === 'function') floatPlayerEvent(rwPlayerFloat(), '+' + fmt(Math.round(amt)), 'heal');
        break;
      case 'shield':
        applyStatus(pEnt, 'shield', { val: a.pctMax, dur: a.sec, stats: st });
        break;
      case 'mana':
        gainPlayerMana(pEnt, st.mp * a.pctMax / 100, st);
        break;
      case 'buff':
        applyStatus(pEnt, a.sid, { val: a.val, dur: a.sec, maxStacks: a.max });
        break;
      case 'buffRandom':
        var opt = pick(a.from);
        applyStatus(pEnt, opt.sid, { val: opt.val, dur: a.sec });
        break;
      case 'stun':
      case 'slow':
        targets = rwPickTargets(a, ctx);
        for (t = 0; t < targets.length; t++) applyStatus(targets[t], a.act, { dur: a.sec });
        break;
      case 'dot':
        targets = rwPickTargets(a, ctx);
        var base = (a.type === 'phys') ? st.atk : (st.matk || st.atk);
        for (t = 0; t < targets.length; t++) {
          applyStatus(targets[t], rwDotSid(a.name), { dps: base * a.pct / 100, dur: a.sec });
        }
        break;
      case 'cdr':
        if (pEnt.skillCds) {
          for (k in pEnt.skillCds) {
            if (pEnt.skillCds[k] > 0) {
              pEnt.skillCds[k] = Math.max(0, pEnt.skillCds[k] - a.sec);
              if (pEnt.skillCds[k] === 0 && typeof markSkillReady === 'function') markSkillReady(pEnt, k);
            }
          }
        }
        break;
      case 'refresh':
        if (pEnt.skillCds) {
          var cooling = [];
          for (k in pEnt.skillCds) if (pEnt.skillCds[k] > 0) cooling.push(k);
          var cnt = Math.max(1, Math.floor(a.n || 1));
          while (cnt-- > 0 && cooling.length) {
            var rk = cooling.splice(Math.floor(Math.random() * cooling.length), 1)[0];
            pEnt.skillCds[rk] = 0;
            if (typeof markSkillReady === 'function') markSkillReady(pEnt, rk);
          }
        }
        break;
      case 'recast':
        if (ctx.gid) rwFreeCast(pEnt, ctx.gid, ctx, out);
        break;
      case 'castRandom':
        var groups = rwCastableGroups(pEnt);
        if (groups.length) rwFreeCast(pEnt, pick(groups), ctx, out);
        break;
      case 'invuln':
        applyStatus(pEnt, 'invuln', { dur: a.sec });
        break;
      case 'cleanse':
        if (typeof cleanse === 'function') cleanse(pEnt);
        break;
    }
  }
}

/* 觸發某類事件：回傳 { dmg, killed }（沒有任何效果觸發回 null）。
   ctx：{ pEnt, target?, attacker?, enemies?, floatSel?, gid?, cb?（tick 的 onDamage／onDeaths） } */
function rwFire(on, ctx) {
  var st = rwStats();
  if (!st) return null;
  var procs = st.rw.procs;
  var rt = rwEnsureRT();
  if (rt.depth >= RW_DEPTH_LIMIT) return null;
  var out = null;
  for (var i = 0; i < procs.length; i++) {
    var p = procs[i], pr = p.proc;
    if (pr.on !== on) continue;
    var key = p.wid + '#' + p.idx;
    var s = rt.procs[key] || (rt.procs[key] = { next: 0, n: 0 });
    if (pr.every) { s.n++; if (s.n % pr.every !== 0) continue; }
    if (pr.cd && GT < s.next) continue;
    if (pr.chance && !chance(pr.chance)) continue;
    if (pr.cd) s.next = GT + pr.cd;
    if (!out) out = { dmg: 0, killed: false };
    var local = { pEnt: ctx.pEnt, target: ctx.target, attacker: ctx.attacker, enemies: ctx.enemies,
      floatSel: ctx.floatSel, gid: ctx.gid, cb: ctx.cb, wordName: p.name };
    rt.depth++;
    try { rwRunActs(pr, local, out); } finally { rt.depth--; }
  }
  return out;
}

function rwSettle(out) {
  if (out && out.killed && typeof legendarySettleTriggeredDeaths === 'function') {
    legendarySettleTriggeredDeaths({ killed: true });
  }
}

/* 直接傷害（不再走防禦）：擴散傷害用。比照 legendaryDealReflectedBasicAttack 的結算順序。 */
function rwDirectDamage(target, damage, label, floatSel) {
  if (!target || target.hp <= 0 || !(damage > 0)) return null;
  var dmg = Math.max(1, Math.round(damage));
  var absorbed = 0;
  if (target.shield && target.shield > 0) {
    absorbed = Math.min(target.shield, dmg);
    target.shield = Math.max(0, target.shield - absorbed);
    dmg -= absorbed;
  }
  dmg = applyEnemyHpDamage(target, dmg);
  var total = dmg + absorbed;
  if (typeof floatEnemyEvent === 'function') floatEnemyEvent(target, floatSel, fmt(total), 'enemy-skill', total);
  if (typeof trackDps === 'function') trackDps(total);
  if (typeof recordRunDamage === 'function') recordRunDamage(label, total);
  return { dmg: total, killed: target.hp <= 0 };
}

/* 普攻掛勾（doPlayerAttack 於 depth 0 呼叫）：擴散、hit／crit 觸發。 */
function rwOnBasicAttack(pEnt, target, res, floatSel, st) {
  var rs = rwStats();
  if (!rs || !res || res.miss) return null;
  var fx = rs.rw.fx;
  var out = { dmg: 0, killed: false };
  var ctx = { pEnt: pEnt, target: target, floatSel: floatSel };
  if (fx.splashPct > 0 && res.dmg > 0) {
    var others = rwAliveOnly(rwEnemies());
    for (var i = 0; i < others.length; i++) {
      if (others[i] === target) continue;
      var sp = rwDirectDamage(others[i], res.dmg * fx.splashPct / 100, '符文之語·擴散', floatSel);
      if (sp) { out.dmg += sp.dmg; if (sp.killed) out.killed = true; }
    }
  }
  var h = rwFire('hit', ctx);
  if (h) { out.dmg += h.dmg; if (h.killed) out.killed = true; }
  if (res.crit) {
    var c = rwFire('crit', ctx);
    if (c) { out.dmg += c.dmg; if (c.killed) out.killed = true; }
  }
  if (out.killed) rwSettle(out);
  return (out.dmg > 0 || out.killed) ? out : null;
}

/* 技能施放掛勾（castSkill2 於非免費施放後呼叫）：cast 觸發；重施放的結果併入 out。 */
function rwOnSkillCast(pEnt, gid, out, floatSel, enemies) {
  if (!rwStats()) return;
  var r = rwFire('cast', { pEnt: pEnt, gid: gid, floatSel: floatSel, enemies: enemies });
  if (r) {
    out.dmg = (out.dmg || 0) + r.dmg;
    if (r.killed) out.killed = true;
  }
}

/* 擊殺掛勾（野外 onFieldKill 呼叫）。 */
function rwOnKill(pEnt, monster) {
  var st = rwStats();
  if (!st || !pEnt) return;
  var fx = st.rw.fx;
  if (fx.killHealPct > 0) healPlayer(pEnt, st.hp * fx.killHealPct / 100, st, { noShield: true });
  if (fx.killManaPct > 0) gainPlayerMana(pEnt, st.mp * fx.killManaPct / 100, st);
  var r = rwFire('kill', { pEnt: pEnt, target: monster });
  if (r && r.killed) rwSettle(r);
}

/* 受擊掛勾（legendaryOnPlayerDamaged 呼叫）。floatSel 是我方側的選擇器。 */
function rwOnPlayerDamaged(attacker, pEnt, hpDamage, blocked, hitResult, floatSel) {
  var st = rwStats();
  if (!st || !pEnt) return;
  var enemyFloat = (typeof legendaryEnemyFloatSel === 'function') ? legendaryEnemyFloatSel(floatSel) : rwEnemyFloat();
  var ctx = { pEnt: pEnt, attacker: attacker, floatSel: enemyFloat };
  var acc = { dmg: 0, killed: false };
  if (blocked) { var b = rwFire('block', ctx); if (b && b.killed) acc.killed = true; }
  if (hpDamage > 0) { var h = rwFire('hurt', ctx); if (h && h.killed) acc.killed = true; }
  rwCheckLowHp(pEnt, st, enemyFloat);
  if (acc.killed) rwSettle(acc);
}

/* 低血量觸發（受擊後與每 tick 檢查）。 */
function rwCheckLowHp(pEnt, st, floatSel) {
  var procs = st.rw.procs;
  if (!procs.length || !(st.hp > 0) || !(pEnt.hp > 0)) return;
  var pct = pEnt.hp / st.hp * 100;
  var rt = rwEnsureRT();
  for (var i = 0; i < procs.length; i++) {
    var pr = procs[i].proc;
    if (pr.on !== 'lowhp' || pct >= pr.below) continue;
    var key = procs[i].wid + '#' + procs[i].idx;
    var s = rt.procs[key] || (rt.procs[key] = { next: 0, n: 0 });
    if (pr.cd && GT < s.next) continue;
    s.next = GT + (pr.cd || 0);
    var out = { dmg: 0, killed: false };
    rt.depth++;
    try {
      rwRunActs(pr, { pEnt: pEnt, floatSel: floatSel || rwEnemyFloat(), wordName: procs[i].name }, out);
    } finally { rt.depth--; }
  }
}

/* 每 tick（tickLegendaryEffects 呼叫；野外與高塔共用）。 */
function rwTick(dt, ctx) {
  var st = rwStats();
  if (!st || !ctx || !ctx.pEnt) return;
  var pEnt = ctx.pEnt;
  var fx = st.rw.fx;
  var blocked = (typeof skills2AutoCastBlocked === 'function') && skills2AutoCastBlocked(pEnt);
  var rt = rwEnsureRT();
  /* 生命祭獻：每秒損失最大生命的 N%（不致死、至少留 1）。倒地／復甦演出期間暫停。 */
  if (fx.selfDrainPct > 0 && !blocked && pEnt.hp > 1) {
    var loss = st.hp * fx.selfDrainPct / 100 * dt;
    if (!(typeof gmHpLockActive === 'function' && gmHpLockActive(pEnt))) {
      pEnt.hp = Math.max(1, pEnt.hp - loss);
    }
  }
  var procs = st.rw.procs;
  for (var i = 0; i < procs.length; i++) {
    var pr = procs[i].proc;
    if (pr.on !== 'tick') continue;
    var key = procs[i].wid + '#' + procs[i].idx;
    var s = rt.procs[key] || (rt.procs[key] = { next: 0, n: 0 });
    if (!s.next) s.next = GT + pr.every;
    if (blocked) { s.next += dt; continue; }
    var guard = 0;
    while (s.next <= GT && guard++ < 3) {
      s.next += pr.every;
      var enemies = ctx.getEnemies ? ctx.getEnemies() : rwEnemies();
      if (!rwAliveOnly(enemies).length && rwProcNeedsEnemies(pr)) continue;
      var out = { dmg: 0, killed: false };
      var local = { pEnt: pEnt, enemies: enemies, floatSel: ctx.floatSel, cb: ctx, wordName: procs[i].name };
      rt.depth++;
      try { rwRunActs(pr, local, out); } finally { rt.depth--; }
      if (out.killed && ctx.onDeaths) ctx.onDeaths();
    }
  }
  rwCheckLowHp(pEnt, st, ctx.floatSel);
}
function rwProcNeedsEnemies(pr) {
  var acts = pr.acts || [];
  for (var i = 0; i < acts.length; i++) {
    if (acts[i].act === 'dmg' || acts[i].act === 'execute' || acts[i].act === 'stun' ||
        acts[i].act === 'slow' || acts[i].act === 'dot') return true;
  }
  return false;
}

/* 死亡攔截：回傳 true＝已復活（呼叫端中止死亡流程）。 */
function rwTryRevive(pEnt) {
  var st = rwStats();
  if (!st || !pEnt) return false;
  var fx = st.rw.fx;
  if (!(fx.reviveHpPct > 0)) return false;
  var rt = rwEnsureRT();
  if (GT < rt.reviveReadyAt) return false;
  rt.reviveReadyAt = GT + (fx.reviveCdSec || 0);
  pEnt.hp = Math.max(1, st.hp * Math.min(100, fx.reviveHpPct) / 100);
  if (typeof cleanse === 'function') cleanse(pEnt);
  if (fx.reviveInvulnSec > 0) applyStatus(pEnt, 'invuln', { dur: fx.reviveInvulnSec });
  if (fx.reviveDmgPct > 0 && fx.reviveDmgSec > 0) {
    applyStatus(pEnt, 'allDmgUp', { val: fx.reviveDmgPct, dur: fx.reviveDmgSec });
  }
  if (fx.reviveRefresh > 0 && pEnt.skillCds) {
    for (var k in pEnt.skillCds) {
      if (pEnt.skillCds[k] > 0) {
        pEnt.skillCds[k] = 0;
        if (typeof markSkillReady === 'function') markSkillReady(pEnt, k);
      }
    }
  }
  if (typeof blog === 'function') blog('♻️ 符文之語【輪迴】——你在死亡邊緣重生了！', 'good');
  if (typeof floatPlayerEvent === 'function') floatPlayerEvent(rwPlayerFloat(), '♻️重生', 'buff');
  return true;
}

/* ============================================================
   §5 掉落
   ============================================================ */
/* 進度＝（地圖序號 0 起算）＋（關卡 ÷ 該圖關卡上限）；最高階 = 1 + 進度 × progressPerTier。 */
function runeProgress(zone, stage) {
  var keys = Object.keys(ZONES);
  var zi = Math.max(0, keys.indexOf(zone));
  var frac = clamp((Number(stage) || 1) / zoneMaxStage(zone), 0, 1);
  return zi + frac;
}
function runeDropTierMax(zone, stage) {
  return clamp(Math.floor(1 + runeProgress(zone, stage) * RUNE_DROP.progressPerTier), 1, RUNES.length);
}
/* 從最高階往下的幾何分佈：機率 (1-q)·q^k 落在「最高階 - k」。 */
function rollRuneTier(tierMax) {
  var q = clamp(RUNE_DROP.tierSpread, 0.05, 0.95);
  var k = Math.floor(Math.log(Math.max(1e-9, Math.random())) / Math.log(q));
  return clamp(tierMax - k, 1, tierMax);
}

/* 野外掉落：由 rollFieldDrops 呼叫，掉到的符文描述字串推進 drops。 */
function rwRollFieldRuneDrops(zone, stage, lootBonus, rewardMult, eliteMult, drops) {
  var pct = RUNE_DROP.basePct * (1 + (lootBonus || 0) / 100) * (rewardMult || 1) * (eliteMult || 1) *
    (1 + rwRuneFindPct() / 100);
  var n = rollDropCount(pct);
  var tierMax = runeDropTierMax(zone, stage);
  for (var i = 0; i < n; i++) {
    var r = RUNES[rollRuneTier(tierMax) - 1];
    addRune(r.id, 1);
    if (drops) drops.push('🔷' + runeLabel(r.id));
  }
  return n;
}
function rwRuneFindPct() {
  var st = (typeof getStats === 'function') ? getStats() : null;
  return (st && st.rw && st.rw.fx.runeFindPct) || 0;
}
/* 封魔塔通關掉落（樓層越高階數越高）。 */
function rwRollTowerRuneDrop(floor, lootBonus) {
  var pct = RUNE_DROP.towerBossPct * (1 + (lootBonus || 0) / 100) * (1 + rwRuneFindPct() / 100);
  var n = rollDropCount(pct);
  var tierMax = clamp(Math.floor(2 + (Number(floor) || 1) / TOWER_MAX_FLOOR * 20), 1, RUNES.length);
  var got = [];
  for (var i = 0; i < n; i++) {
    var r = RUNES[rollRuneTier(tierMax) - 1];
    addRune(r.id, 1);
    got.push(r.id);
  }
  return got;
}

/* ============================================================
   §6 說明文字（由資料產生；主執行緒與 Worker 共用）
   ============================================================ */
var RW_FX_TEXT = {
  dmgPct: function (v) { return '造成的所有傷害 ' + rwSigned(v) + '%'; },
  skillDmgPct: function (v) { return '技能傷害 ' + rwSigned(v) + '%'; },
  basicDmgPct: function (v) { return '普通攻擊傷害 ' + rwSigned(v) + '%'; },
  aspdMult: function (v) { return '攻擊速度額外乘算 ' + rwSigned(v) + '%（突破攻速上限）'; },
  cdPct: function (v) { return '所有技能冷卻時間 -' + v + '%（乘算，突破冷卻縮減上限）'; },
  manaCostRedPct: function (v) { return '技能法力消耗 -' + v + '%'; },
  maxHitPct: function (v) { return '單次受到的傷害最多只會是最大生命的 ' + v + '%'; },
  maxHpPct: function (v) { return '最大生命 ' + rwSigned(v) + '%（乘算' + (v < 0 ? '，代價' : '') + '）'; },
  dmgHiHpPct: function (v) { return '對生命高於 70% 的敵人傷害 +' + v + '%'; },
  dmgLoHpPct: function (v) { return '對生命低於 30% 的敵人傷害 +' + v + '%'; },
  dmgSoloPct: function (v) { return '場上只有一名敵人時，傷害 +' + v + '%'; },
  dmgPerFoePct: function (v) { return '場上每多一名敵人，傷害 +' + v + '%（最多計 10 名）'; },
  dmgSelfFullPct: function (v) { return '生命高於 90% 時，傷害 +' + v + '%'; },
  dmgSelfLowPct: function (v) { return '生命低於 35% 時，傷害 +' + v + '%'; },
  dmgCtrlPct: function (v) { return '對暈眩或緩速中的敵人傷害 +' + v + '%'; },
  killHealPct: function (v) { return '擊殺敵人時回復 ' + v + '% 最大生命'; },
  killManaPct: function (v) { return '擊殺敵人時回復 ' + v + '% 最大法力'; },
  runeFindPct: function (v) { return '符文掉落率 +' + v + '%'; },
  selfDrainPct: function (v) { return '代價：每秒損失 ' + v + '% 最大生命（不會致死）'; },
  splashPct: function (v) { return '普通攻擊同時對其他所有敵人造成 ' + v + '% 的傷害'; }
};
function rwSigned(v) { return (v >= 0 ? '+' : '') + v; }

var RW_TRIGGER_TEXT = {
  hit: '普通攻擊命中時', crit: '普通攻擊暴擊時', kill: '擊殺敵人時', hurt: '受到傷害時',
  block: '格擋成功時', cast: '施放技能時', tick: '', lowhp: ''
};
var RW_TARGET_TEXT = { target: '目標', all: '所有敵人', rand: '隨機敵人', attacker: '攻擊者' };
var RW_ELEM_TEXT = { fire: '火焰', ice: '冰霜', lightning: '雷電', poison: '毒', light: '聖光', dark: '暗影', earth: '大地', wind: '疾風', random: '隨機元素' };
var RW_BUFF_TEXT = { atkUp: '攻擊', aspdUp: '攻速', defUp: '防禦', evasionUp: '閃避', critDmgUp: '爆擊傷害', allDmgUp: '所有傷害', regen: '再生' };
var RW_DOT_TEXT = { poison: '中毒', burn: '燃燒', bleed: '流血', corrode: '侵蝕' };

function rwActText(a) {
  switch (a.act) {
    case 'dmg': {
      var tgt = a.to === 'rand' && a.n > 1 ? '隨機 ' + a.n + ' 名敵人' : (RW_TARGET_TEXT[a.to || 'target']);
      var kind = a.elem ? (RW_ELEM_TEXT[a.elem] || a.elem) + '傷害' : (a.type === 'magic' ? '魔法傷害' : '物理傷害');
      return '對' + tgt + '造成 ' + a.pct + '% ' + kind;
    }
    case 'execute': return '直接斬殺生命低於 ' + a.hpBelow + '% 的非 BOSS 敵人';
    case 'heal': return '回復 ' + a.pctMax + '% 最大生命';
    case 'shield': return '獲得相當於 ' + a.pctMax + '% 最大生命的護盾（' + a.sec + ' 秒）';
    case 'mana': return '回復 ' + a.pctMax + '% 最大法力';
    case 'buff': return '獲得「' + (RW_BUFF_TEXT[a.sid] || a.sid) + '」+' + a.val + '%（' + a.sec + ' 秒' + (a.max > 1 ? '，最多 ' + a.max + ' 層' : '') + '）';
    case 'buffRandom': return '隨機獲得一種增益（攻擊／攻速／爆傷／防禦／閃避／所有傷害，' + a.sec + ' 秒）';
    case 'stun': return (a.to === 'all' ? '所有敵人' : '目標') + '暈眩 ' + a.sec + ' 秒';
    case 'slow': return (a.to === 'all' ? '所有敵人' : '目標') + '緩速 ' + a.sec + ' 秒';
    case 'dot': return '對' + (RW_TARGET_TEXT[a.to || 'target']) + '施加' + (RW_DOT_TEXT[a.name] || a.name) + '（每秒 ' + a.pct + '% 攻擊力，' + a.sec + ' 秒）';
    case 'cdr': return '所有技能冷卻縮短 ' + a.sec + ' 秒';
    case 'refresh': return '重置 ' + (a.n || 1) + ' 個冷卻中的技能';
    case 'recast': return '免費再施放一次剛施放的技能';
    case 'castRandom': return '免費施放一個隨機的已裝配技能';
    case 'invuln': return '無敵 ' + a.sec + ' 秒';
    case 'cleanse': return '淨化負面狀態';
  }
  return a.act;
}
function rwProcText(p) {
  var head;
  if (p.on === 'tick') head = '每 ' + p.every + ' 秒';
  else if (p.on === 'lowhp') head = '生命低於 ' + p.below + '% 時';
  else head = RW_TRIGGER_TEXT[p.on] || '';
  if (p.every && p.on !== 'tick') head = '每 ' + p.every + ' 次' + head.replace('時', '');
  var cond = '';
  if (p.chance) cond += p.chance + '% 機率';
  var body = [];
  for (var i = 0; i < p.acts.length; i++) body.push(rwActText(p.acts[i]));
  var text = head + (cond ? '有 ' + cond : '') + '：' + body.join('，');
  if (p.cd) text += '（內建冷卻 ' + p.cd + ' 秒）';
  return text;
}

/* 符文之語的效果文字（陣列，一行一條）。it 有給時，屬性行會帶該裝備上實際算出的數值。 */
function rwDescribeLines(word, it) {
  var lines = [];
  var st = word.stats || [];
  for (var i = 0; i < st.length; i++) {
    var def = AFFIX_POOL[st[i][0]];
    var name = def ? def.name.replace(/%$/, '') : st[i][0];
    if (it) lines.push(rwFormatStat(st[i][0], rwStatValue(it, st[i][0], st[i][1])));
    else lines.push(name + (st[i][1] < 0 ? '（代價：-' : '（約 ') + Math.abs(st[i][1]) + ' 條詞條的份量）');
  }
  var ps = word.passives || {};
  var psNames = { thorns: '反震', smite: '天罰', undying: '不朽', sunder: '破甲', trueDmg: '真傷', omniDrain: '萬象汲取' };
  for (var pk in ps) lines.push((psNames[pk] || pk) + ' ' + ps[pk] + '%');
  var fx = word.fx || {};
  if (fx.reviveHpPct > 0) {
    lines.push('死亡時以 ' + fx.reviveHpPct + '% 生命復活並淨化，無敵 ' + (fx.reviveInvulnSec || 0) + ' 秒，' +
      (fx.reviveRefresh ? '所有技能冷卻重置，' : '') + (fx.reviveDmgPct ? '之後 ' + fx.reviveDmgSec + ' 秒內傷害 +' + fx.reviveDmgPct + '%，' : '') +
      '冷卻 ' + (fx.reviveCdSec || 0) + ' 秒');
  }
  for (var fk in fx) if (RW_FX_TEXT[fk]) lines.push(RW_FX_TEXT[fk](fx[fk]));
  var pr = word.procs || [];
  for (var j = 0; j < pr.length; j++) lines.push(rwProcText(pr[j]));
  var lg = word.legend || [];
  for (var l = 0; l < lg.length; l++) {
    var pd = (typeof PASSIVE_POOL !== 'undefined') ? PASSIVE_POOL[lg[l]] : null;
    if (pd) lines.push('傳奇特效【' + pd.name + '】：' + pd.desc);
  }
  return lines;
}
/* 這組符文之語最少要什麼稀有度才有足夠的符文孔（RUNE_SETTINGS.slotsByRarity）。-1＝做不出來。 */
function rwMinRarity(word) {
  for (var i = 0; i < RARITIES.length; i++) {
    if (Number(RUNE_SETTINGS.slotsByRarity[i]) >= word.runes.length) return i;
  }
  return -1;
}
function rwSocketNeedText(word) {
  var i = rwMinRarity(word);
  return '需要 ' + word.runes.length + ' 個符文孔（' + (i >= 0 ? RARITIES[i].name + '以上' : '無法達成') + '）';
}
/* 配方文字：「微光 → 餘燼」。 */
function rwRecipeText(word) {
  var names = [];
  for (var i = 0; i < word.runes.length; i++) names.push(runeName(word.runes[i]));
  return names.join(' → ');
}
/* 適用裝備文字。 */
var RW_BASE_TEXT = {
  any: '任何裝備', armor: '防具', jewelry: '戒指／項鍊', mainHand: '主手／雙手武器', twoHand: '雙手武器',
  oneHand: '單手武器', offHand: '副手', melee: '近戰武器', caster: '施法類武器／副手',
  weapon: '武器', helmet: '頭盔', shoulder: '護肩', chest: '胸甲', belt: '腰帶', gloves: '手套',
  wrist: '護腕', legs: '護腿', boots: '靴子', ring: '戒指', amulet: '項鍊'
};
function rwBasesText(word) {
  var out = [];
  for (var i = 0; i < word.bases.length; i++) {
    var b = word.bases[i];
    if (RW_BASE_TEXT[b]) out.push(RW_BASE_TEXT[b]);
    else if (typeof WEAPON_TYPES !== 'undefined' && WEAPON_TYPES[b]) out.push(WEAPON_TYPES[b].name);
    else out.push(b);
  }
  return out.join('、');
}
