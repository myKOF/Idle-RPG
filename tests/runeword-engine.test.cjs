const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuneEnv, makeItem, fillRunes, wordItem } = require('./helpers/runeword-env.cjs');
// vm 內建立的物件原型與測試端不同，deepStrictEqual 會因此誤判；一律先轉成純 JSON 再比
const plain = (x) => JSON.parse(JSON.stringify(x));

/* 符文真言執行層：鑲嵌、判定、屬性聚合、各類機制。
   每個測試都用全新的上下文（完整模擬層＋全新遊戲狀態），互不污染。 */

function enemy(over) {
  return Object.assign({
    name: '木樁', hp: 1e9, maxHp: 1e9, atk: 1, def: 0, mdef: 0, level: 1, dodge: 0,
    resist: {}, buffs: {}, effects: {}, dots: [], ctrlRes: 0, shield: 0, atkCd: 99
  }, over || {});
}
function setup(c, enemies) {
  c.G.tower.active = false;
  c.FIELD.player = c.newPlayerEntity(c.getStats());
  c.FIELD.monsters = enemies || [enemy()];
  c.FIELD.monster = c.FIELD.monsters[0];
  return c.FIELD.player;
}
function equip(c, slot, it) {
  c.G.equipment[slot] = it;
  c.markStatsDirty();
  return c.getStats();
}
const WORD = (c, id) => c.RUNEWORD_BY_ID[id];
/* 測試只依賴「自己釘住的數字」，不依賴資料表目前的調校值（使用者調平衡後測試不該跟著紅）。 */
function pin(c, id, spec) {
  const w = c.RUNEWORD_BY_ID[id];
  Object.assign(w, spec);
  c.markStatsDirty();
  return w;
}

/* 改 vm 內的 var 常數（context 物件上的屬性即全域變數）。 */
function vmSet(c, name, value) { require('node:vm').runInContext(name + ' = ' + JSON.stringify(value) + ';', c); }

/* ---------------- 鑲嵌與庫存 ---------------- */

test('socketRune：扣庫存、鑲進第一個空符文孔；庫存不足／已有符文／孔位不合法／沒有符文孔一律拒絕且不扣', () => {
  const c = loadRuneEnv();
  const it = makeItem(c, { rarity: 5 });
  assert.equal(c.runeSlotCountFor(it), 4);
  assert.equal(c.socketRune(it, 'r01'), '符文不足');
  c.addRune('r01', 2);
  assert.equal(c.socketRune(it, 'r01'), null);
  assert.deepEqual(plain(it.runes), ['r01', null, null, null]);
  assert.equal(c.runeCount('r01'), 1);
  assert.match(c.socketRune(it, 'r01', 0), /已有/);
  assert.equal(c.socketRune(it, 'r01', 99), '沒有可用的符文孔');
  assert.equal(c.socketRune(it, 'zz'), '沒有這種符文');
  assert.equal(c.runeCount('r01'), 1, '失敗的鑲嵌不得扣庫存');
  assert.equal(c.socketRune(it, 'r01', 3), null);
  assert.deepEqual(plain(it.runes), ['r01', null, null, 'r01']);
  assert.deepEqual(it.sockets.filter(Boolean), [], '符文不佔寶石鑲孔');
  const none = makeItem(c, { rarity: 0 });
  c.addRune('r01', 1);
  assert.match(c.socketRune(none, 'r01'), /沒有符文孔/);
  assert.equal(c.runeCount('r01'), 1, '沒有符文孔時不扣庫存');
});

test('抹除費用的幣種與單價來自配置表（RUNE_SETTINGS.erase）：0＝不收這種幣，金幣可選，費用文字只列要收的', () => {
  const c = loadRuneEnv();
  const it = makeItem(c, { rarity: 5 });
  assert.deepEqual(plain(Object.keys(c.RUNE_SETTINGS.erase)), ['scrapPerTier', 'essencePerTier', 'goldPerTier']);
  const tier = c.RUNE_BY_ID.r05.tier, mult = c.RARITIES[5].mult;
  c.RUNE_SETTINGS.erase.goldPerTier = 100;
  const cost = c.runeEraseCost(it, 'r05');
  assert.equal(cost.gold, Math.ceil(100 * tier * mult));
  assert.equal(cost.scrap, Math.ceil(c.RUNE_SETTINGS.erase.scrapPerTier * tier * mult));
  assert.match(c.runeEraseCostText(cost), /金幣 .*裝備碎片 .*附魔精華 /);
  c.addRune('r05', 1); c.socketRune(it, 'r05');
  Object.assign(c.G.player, { gold: cost.gold - 1, scrap: 1e9, essence: 1e9 });
  assert.match(c.eraseRune(it, 0), /資源不足.*金幣/, '金幣不夠就擋下');
  c.G.player.gold = cost.gold + 7;
  assert.equal(c.eraseRune(it, 0), null);
  assert.equal(c.G.player.gold, 7, '金幣被扣');
  c.RUNE_SETTINGS.erase = { scrapPerTier: 0, essencePerTier: 0, goldPerTier: 0 };
  assert.deepEqual(plain(c.runeEraseCost(it, 'r05')), { gold: 0, scrap: 0, essence: 0 });
  assert.equal(c.runeEraseCostText(c.runeEraseCost(it, 'r05')), '免費');
  c.RUNE_SETTINGS.erase = { scrapPerTier: 0, essencePerTier: 3, goldPerTier: 0 };
  assert.equal(c.runeEraseCostText(c.runeEraseCost(it, 'r05')), '附魔精華 ' + c.fmt(Math.ceil(3 * tier * mult)), '只收精華時只列精華');
});

test('抹除費用：符文階數越高、裝備稀有度越高越貴，一律是正整數', () => {
  const c = loadRuneEnv();
  const at = (rarity, rune) => c.runeEraseCost({ rarity }, rune);
  assert.ok(at(5, 'r20').scrap > at(5, 'r05').scrap && at(5, 'r20').essence > at(5, 'r05').essence, '階數越高越貴');
  assert.ok(at(9, 'r05').scrap > at(1, 'r05').scrap && at(9, 'r05').essence > at(1, 'r05').essence, '稀有度越高越貴');
  c.RUNES.forEach((r) => c.RARITIES.forEach((_, i) => { const x = at(i, r.id); assert.ok(Number.isInteger(x.scrap) && x.scrap >= 1 && Number.isInteger(x.essence) && x.essence >= 1); }));
});

test('符文孔放滿：放不下的被拒；孔數隨稀有度（RARITIES.runeSlots，配置表 game_parameters 的參數g）', () => {
  const c = loadRuneEnv();
  c.addRune('r01', 9);
  const it = makeItem(c, { rarity: 3 });                    // 獨特：2 孔
  assert.equal(c.runeSlotCountFor(it), 2);
  assert.equal(c.socketRune(it, 'r01'), null);
  assert.equal(c.socketRune(it, 'r01'), null);
  assert.match(c.socketRune(it, 'r01'), /已滿/);
  assert.equal(c.runeCount('r01'), 7);
  const counts = c.RARITIES.map((r, i) => c.runeSlotCountFor({ rarity: i }));
  assert.deepEqual(plain(counts), plain(c.RARITIES.map((r) => r.runeSlots)), '一般裝備的孔數就是稀有度表的 runeSlots');
  assert.ok(Math.max(...counts) <= c.RUNE_SETTINGS.maxSlots);
  assert.ok(counts.every((n, i) => i === 0 || n >= counts[i - 1]), '稀有度越高孔數不減');
});

test('eraseRune 抹除符文：扣碎片與精華、符文不退還、孔恢復為空、資源不足被擋；分解裝備時鑲著的符文自動取回；寶石鑲孔的操作不碰符文', () => {
  const c = loadRuneEnv();
  const it = makeItem(c, { rarity: 5 });
  c.addRune('r05', 1);
  c.socketRune(it, 'r05');
  assert.equal(c.runeCount('r05'), 0);
  const cost = c.runeEraseCost(it, 'r05');
  assert.ok(cost.scrap > 0 && cost.essence > 0);
  c.G.player.scrap = cost.scrap - 1; c.G.player.essence = cost.essence;
  assert.match(c.eraseRune(it, 0), /資源不足/);
  assert.equal(it.runes[0], 'r05', '資源不足不抹除');
  c.G.player.scrap = cost.scrap + 5;
  assert.equal(c.eraseRune(it, 0), null);
  assert.equal(c.G.player.scrap, 5);
  assert.equal(c.G.player.essence, 0);
  assert.equal(c.runeCount('r05'), 0, '符文不退還');
  assert.equal(it.runes[0], null, '孔恢復為空');
  assert.match(c.eraseRune(it, 0), /沒有符文/, '空孔不能抹除');
  c.addRune('r05', 1);
  c.socketRune(it, 'r05');
  assert.equal(c.unsocketGem(it, 0), false, 'unsocketGem 只管寶石鑲孔');
  assert.equal(c.runeCount('r05'), 0);
  c.doSalvage(it, true);
  assert.equal(c.runeCount('r05'), 1, '分解不得吃掉符文');
});

test('神鑄素材取回（forgeReclaimSockets）同樣退回符文', () => {
  const c = loadRuneEnv();
  const it = makeItem(c, { rarity: 5 });
  fillRunes(it, ['r07', 'r07']);
  c.forgeReclaimSockets(it);
  assert.equal(c.runeCount('r07'), 2);
  assert.deepEqual(it.runes.filter(Boolean), []);
});

test('舊版（符文與寶石共用鑲孔）的存檔：rwMigrateSocketRunes 把符文搬進符文孔，放不下的退回庫存，冪等', () => {
  const c = loadRuneEnv();
  const it = makeItem(c, { rarity: 3 });                    // 2 個符文孔
  it.sockets = [{ rune: 'r01' }, { rune: 'r02' }, { rune: 'r03' }, { type: 'ruby', level: 1 }];
  assert.equal(c.rwMigrateSocketRunes(it), true);
  assert.deepEqual(plain(it.runes), ['r01', 'r02']);
  assert.equal(c.runeCount('r03'), 1, '放不下的退回庫存');
  assert.deepEqual(plain(it.sockets), [null, null, null, { type: 'ruby', level: 1 }]);
  assert.equal(c.rwMigrateSocketRunes(it), false);
});

test('合成：3 顆 → 下一階；第 20 階起不能合成；拆解 1 顆 → 低一階 1 顆（降階頂替，不會變多）；第 1 階不可拆', () => {
  const c = loadRuneEnv();
  c.addRune('r01', 7);
  assert.equal(c.composeRune('r01'), null);
  assert.equal(c.composeRune('r01'), null);
  assert.match(c.composeRune('r01'), /不足/);
  assert.equal(c.runeCount('r01'), 1);
  assert.equal(c.runeCount('r02'), 2);
  c.addRune('r20', 9);
  assert.match(c.composeRune('r20'), /只能靠掉落/);
  assert.equal(c.runeCount('r20'), 9);
  const d = c.dismantleRune('r05');
  assert.match(d.err, /沒有/);
  c.addRune('r05', 1);
  assert.deepEqual({ n: c.dismantleRune('r05').n, r04: c.runeCount('r04'), r05: c.runeCount('r05') }, { n: 1, r04: 1, r05: 0 });
  c.addRune('r01', 1);
  assert.match(c.dismantleRune('r01').err, /第 1 階/);
});

/* ---------------- 判定 ---------------- */

test('符文真言：順序必須完全一致；連續鑲孔即可，前後可以有別的鑲嵌物', () => {
  const c = loadRuneEnv();
  const w = WORD(c, 'rw_viperkiss');                       // r06 → r08，單手劍／匕首／魔劍
  const mk = (runes, start) => fillRunes(makeItem(c, { rarity: 5 }), runes, start);
  assert.equal(c.rwActiveWord(mk(['r06', 'r08'])).word.id, w.id);
  assert.equal(c.rwActiveWord(mk(['r08', 'r06'])), null, '順序反了不成立');
  assert.equal(c.rwActiveWord(mk(['r06', 'r08'], 2)).start, 2, '放在後半段也成立');
  const gapped = mk(['r06']); gapped.runes[2] = 'r08';
  assert.equal(c.rwActiveWord(gapped), null, '中間隔著空孔不成立');
  const gem = mk(['r06', 'r08']); gem.sockets[3] = { type: 'ruby', level: 1 };
  assert.equal(c.rwActiveWord(gem).word.id, w.id, '寶石鑲孔與符文孔互不影響');
});

test('符文真言：裝備類型不符不成立（匕首可、法杖不可）', () => {
  const c = loadRuneEnv();
  const ok = fillRunes(makeItem(c, { rarity: 5, weaponType: 'dagger1h' }), ['r06', 'r08']);
  const bad = fillRunes(makeItem(c, { rarity: 5, weaponType: 'staff2h' }), ['r06', 'r08']);
  const armor = fillRunes(makeItem(c, { rarity: 5, slot: 'chest', weaponType: undefined }), ['r06', 'r08']);
  assert.ok(c.rwActiveWord(ok));
  assert.equal(c.rwActiveWord(bad), null);
  assert.equal(c.rwActiveWord(armor), null);
});

test('符文真言：多組同時符合時取符文數最多者；符文孔不足的裝備放不下', () => {
  const c = loadRuneEnv();
  // 創造一組臨時的長配方，包含「初啼」r01→r02 作為前綴
  c.RUNEWORDS.push({ id: 'rw_test_long', name: '測試長配方', tier: 1, runes: ['r01', 'r02', 'r03'], bases: ['mainHand'], stats: [['atkFlat', 1]] });
  const it = fillRunes(makeItem(c, { rarity: 5 }), ['r01', 'r02', 'r03']);
  assert.equal(c.rwActiveWord(it).word.id, 'rw_test_long');
  const small = makeItem(c, { rarity: 3 });                              // 獨特＝2 孔
  c.addRune('r01', 1); c.addRune('r02', 1); c.addRune('r03', 1);
  ['r01', 'r02', 'r03'].forEach((id) => c.socketRune(small, id));
  assert.equal(c.rwActiveWord(small).word.id, 'rw_firstcry', '第 3 顆放不下，只成形 2 顆的配方');
  assert.equal(c.runeCount('r03'), 1);
});

test('rwCandidates：列出差幾顆就成形的配方，並說明缺哪幾顆', () => {
  const c = loadRuneEnv();
  const it = makeItem(c, { rarity: 5, weaponType: 'sword1h' });
  assert.equal(c.rwCandidates(it).length, 0, '全空不列候選');
  it.runes[0] = 'r06';
  const hit = c.rwCandidates(it).find((x) => x.word.id === 'rw_viperkiss');
  assert.ok(hit);
  assert.deepEqual(Array.from(hit.missing), ['r08']);
  it.runes[1] = 'r08';
  assert.equal(c.rwCandidates(it).some((x) => x.word.id === 'rw_viperkiss'), false, '成形後不再列為候選');
});

/* ---------------- 屬性聚合 ---------------- */

test('單顆符文依武器／防具各給一條屬性，數值＝詞條下限（基準值 × 80%）× mult', () => {
  const c = loadRuneEnv();
  const weapon = fillRunes(makeItem(c, { rarity: 5, level: 100 }), ['r10']);
  const chest = fillRunes(makeItem(c, { rarity: 5, level: 100, slot: 'chest', weaponType: undefined }), ['r10']);
  const we = c.rwItemStatEntries(weapon), ce = c.rwItemStatEntries(chest);
  assert.equal(we[0].key, 'atkPct');
  assert.equal(ce[0].key, 'hpPct');
  const mult = c.RUNE_BY_ID.r10.w[1];
  const expectW = c.affixRoundValue('atkPct', c.affixBaseValue('atkPct', 100, 5) * 0.8 * mult);
  assert.equal(we[0].val, expectW);
  // 與裝備詳情「可能出現的詞條 [下限 ~ 上限]」的下限同口徑：倍率 1 ＝ 下限
  assert.equal(c.rwRuneStatValue(weapon, 'atkPct', 1), c.getAffixLimits('atkPct', 100, 5, weapon).min);
  const shield = fillRunes(makeItem(c, { rarity: 5, weaponType: 'shield' }), ['r10']);
  assert.equal(c.rwItemStatEntries(shield)[0].key, 'hpPct', '副手視同防具側');
});

test('強化倍率套用在符文屬性上；雙手武器的符文跟詞條一樣 ×2；符文孔只多 twoHandBonusSlots 個（加法）', () => {
  const c = loadRuneEnv();
  const one = fillRunes(makeItem(c, { rarity: 5, level: 100 }), ['r10']);
  const up = fillRunes(makeItem(c, { rarity: 5, level: 100, upgrade: 10 }), ['r10']);
  const two = fillRunes(makeItem(c, { rarity: 5, level: 100, weaponType: 'axe2h' }), ['r10']);
  const v = (it) => c.rwItemStatEntries(it)[0].val;
  assert.ok(v(up) > v(one) * 1.4, '+10 約 ×1.5');
  assert.equal(v(two), c.affixRoundValue('atkPct', c.affixBaseValue('atkPct', 100, 5) * 0.8 * c.RUNE_BY_ID.r10.w[1] * c.TWO_HAND_AFFIX_VALUE_MULT), '雙手武器的符文屬性 ×TWO_HAND_AFFIX_VALUE_MULT（與詞條同比例）');
  assert.equal(c.rwRuneStatValue(two, 'atkFlat', 1), c.getAffixLimits('atkFlat', 100, 5, two).min, '雙手武器上倍率 1 ＝ 提示裡的下限（2828 那種數字）');
  assert.equal(c.runeSlotCountFor(two), c.runeSlotCountFor(one) + c.RUNE_SETTINGS.twoHandBonusSlots, '雙手武器的符文孔數＝單手 + twoHandBonusSlots');
});

test('computeStats：符文真言屬性併入面板；拆下一顆就失效', () => {
  const c = loadRuneEnv();
  const before = c.getStats();
  const it = wordItem(c, 'rw_viperkiss');
  const st = equip(c, 'weapon', it);
  assert.ok(st.rw.words.includes('rw_viperkiss'));
  assert.ok(st.critRate > before.critRate, '蛇吻的暴擊率');
  assert.equal(st.rw.procs.length, 1);
  it.runes[1] = null;
  const st2 = equip(c, 'weapon', it);
  assert.deepEqual(Array.from(st2.rw.words), []);
  assert.equal(st2.rw.procs.length, 0);
  assert.ok(st2.critRate < st.critRate);
});

test('符文真言的被動並入 st.passives、借用的傳奇特效並入 legendaryEffects', () => {
  const c = loadRuneEnv();
  pin(c, 'rw_stoneskin', { passives: { thorns: 3 } });
  pin(c, 'rw_assassin', { legend: ['knifeShadowblade', 'knifeChain'] });
  const st = equip(c, 'chest', wordItem(c, 'rw_stoneskin', { slot: 'shoulder' }));
  assert.equal(st.passives.thorns, 3);
  const st2 = equip(c, 'weapon', wordItem(c, 'rw_assassin'));
  assert.equal(st2.legendaryEffects.knifeShadowblade, true);
  assert.equal(st2.legendaryEffects.knifeChain, true);
  assert.equal(c.legendaryHas(st2, 'knifeChain'), true);
});

test('同一組符文真言穿在兩件裝備上：屬性各算，機制只算一次', () => {
  const c = loadRuneEnv();
  const a = wordItem(c, 'rw_stoneskin', { slot: 'shoulder' });
  const b = wordItem(c, 'rw_stoneskin', { slot: 'legs' });
  c.G.equipment.shoulder = a; c.G.equipment.legs = b; c.markStatsDirty();
  const st = c.getStats();
  assert.equal(st.passives.thorns, 3, '反震只算一次');
  assert.deepEqual(Array.from(st.rw.words), ['rw_stoneskin']);
  const one = c.rwItemStatEntries(a).filter((e) => e.src === 'word').length;
  assert.ok(one >= 3);
});

test('單次傷害上限取最嚴格者；其他 fx 數字相加', () => {
  const c = loadRuneEnv();
  const agg = c.rwNewAggregate();
  c.RUNEWORDS.push({ id: 'rw_t_a', name: 'A', tier: 1, runes: ['r01', 'r01'], bases: ['any'], fx: { maxHitPct: 40, dmgPct: 10 } });
  c.RUNEWORDS.push({ id: 'rw_t_b', name: 'B', tier: 1, runes: ['r02', 'r02'], bases: ['any'], fx: { maxHitPct: 15, dmgPct: 5 } });
  c.rwAddItem(agg, fillRunes(makeItem(c, { rarity: 5 }), ['r01', 'r01']));
  c.rwAddItem(agg, fillRunes(makeItem(c, { rarity: 5 }), ['r02', 'r02']));
  assert.equal(agg.fx.maxHitPct, 15);
  assert.equal(agg.fx.dmgPct, 15);
});

test('符文屬性計入裝備評分；符文真言成形再乘一個階級係數', () => {
  const c = loadRuneEnv();
  const plain = makeItem(c, { rarity: 5 });
  const withRune = fillRunes(makeItem(c, { rarity: 5 }), ['r10']);
  assert.ok(c.itemScore(withRune) > c.itemScore(plain));
  const word = wordItem(c, 'rw_viperkiss', { rarity: 5 });
  const broken = wordItem(c, 'rw_viperkiss', { rarity: 5 }); broken.runes[1] = null;
  assert.ok(c.itemScore(word) > c.itemScore(broken) * 1.1);
});

/* ---------------- 戰鬥乘區 ---------------- */

test('rwOutgoingMultiplier：全傷／技能／普攻分流，條件式增傷各自成立', () => {
  const c = loadRuneEnv();
  pin(c, 'rw_apocalypse', { fx: { dmgPct: 18, aspdMult: 10 } });
  equip(c, 'weapon', wordItem(c, 'rw_apocalypse'));           // dmgPct 18
  const p = setup(c);
  const foe = enemy();
  const basic = c.rwOutgoingMultiplier(p, foe, { atk: 1, isPlayer: true });
  assert.ok(Math.abs(basic - 1.18) < 1e-9);
  // 低血敵人／高血敵人
  c.RUNEWORD_BY_ID.rw_apocalypse.fx = { dmgHiHpPct: 40, dmgLoHpPct: 60, dmgSoloPct: 100, skillDmgPct: 10, basicDmgPct: 5, dmgCtrlPct: 25, dmgPerFoePct: 6, dmgSelfFullPct: 20, dmgSelfLowPct: 30 };
  c.markStatsDirty();
  const hi = enemy({ hp: 100, maxHp: 100 }), lo = enemy({ hp: 10, maxHp: 100 }), mid = enemy({ hp: 50, maxHp: 100 });
  c.FIELD.monsters = [hi];
  p.hp = c.getStats().hp;                                          // 滿血 ≥ 90%
  const solo = c.rwOutgoingMultiplier(p, hi, { atk: 1, isPlayer: true, isSkill: true });
  assert.ok(Math.abs(solo - 1.1 * 1.4 * 2 * 1.2) < 1e-9, '技能×高血×獨敵×滿血：' + solo);
  c.FIELD.monsters = [hi, mid, enemy()];
  p.hp = c.getStats().hp * 0.2;                                    // 低血
  const crowd = c.rwOutgoingMultiplier(p, lo, { atk: 1, isPlayer: true });
  assert.ok(Math.abs(crowd - 1.05 * 1.6 * (1 + 0.06 * 2) * 1.3) < 1e-9, '普攻×低血敵×人多×自身低血：' + crowd);
  mid.effects.stun = 99999;
  const ctrl = c.rwOutgoingMultiplier(p, mid, { atk: 1, isPlayer: true });
  assert.ok(Math.abs(ctrl - 1.05 * 1.25 * (1 + 0.06 * 2) * 1.3) < 1e-9, '被控場目標：' + ctrl);
  // 持續傷害（無 atk 欄位）不吃普攻／技能專屬乘區
  const dot = c.rwOutgoingMultiplier(p, mid, { isPlayer: true });
  assert.ok(Math.abs(dot - 1.25 * (1 + 0.06 * 2) * 1.3) < 1e-9);
});

test('傷害乘區確實接進 resolveHit（與傳奇特效同一個入口）', () => {
  const c = loadRuneEnv();
  const p = setup(c);
  c.vm = null;
  const cfg = () => ({ atk: 1000, dmgType: 'phys', level: 1, critRate: 0, critDmg: 150, hit: 100, isPlayer: true });
  const dcfg = { def: 0, isBoss: false };
  c.Math.random = () => 0.5;                                      // 浮動取中間值 → 結果穩定
  const base = c.resolveHit(p, enemy(), cfg(), dcfg).dmg;
  pin(c, 'rw_apocalypse', { fx: { dmgPct: 18 } });
  equip(c, 'weapon', wordItem(c, 'rw_apocalypse'));
  c.Math.random = () => 0.5;
  const boosted = c.resolveHit(p, enemy(), cfg(), dcfg).dmg;
  assert.ok(Math.abs(boosted / base - 1.18) < 0.02, `預期約 ×1.18，實際 ×${(boosted / base).toFixed(3)}`);
});

test('單次受傷上限：玩家為防守方時單次傷害被夾在最大生命的 N%，護盾吸收之前', () => {
  const c = loadRuneEnv();
  pin(c, 'rw_unmoving', { fx: { maxHitPct: 40 } });
  const st = equip(c, 'chest', wordItem(c, 'rw_unmoving'));            // maxHitPct 40
  const p = setup(c);
  const dcfg = c.playerDefCfg(p);
  assert.equal(dcfg.maxHitPct, 40);
  c.Math.random = () => 0.5;
  const res = c.resolveHit(enemy({ atk: 1e12 }), p, { atk: 1e12, dmgType: 'phys', level: 1, critRate: 0, hit: 1000 }, dcfg);
  assert.equal(res.hpDamage, Math.round(st.hp * 0.4));
  assert.equal(p.hp, st.hp - Math.round(st.hp * 0.4));
  // 沒裝備時不受影響
  equip(c, 'chest', null);
  const p2 = setup(c);
  const res2 = c.resolveHit(enemy({ atk: 1e12 }), p2, { atk: 1e12, dmgType: 'phys', level: 1, critRate: 0, hit: 1000 }, c.playerDefCfg(p2));
  assert.ok(res2.hpDamage >= c.getStats().hp);
});

test('攻速／冷卻／法力的乘區：未裝備時為 1；裝備後乘算且有下限', () => {
  const c = loadRuneEnv();
  assert.equal(c.rwAttackSpeedMultiplier(), 1);
  assert.equal(c.rwCooldownFactor(), 1);
  assert.equal(c.rwManaCostFactor(), 1);
  pin(c, 'rw_timeloop', { fx: { cdPct: 45 } });
  pin(c, 'rw_blitz', { fx: { aspdMult: 15 } });
  pin(c, 'rw_manafountain', { fx: { manaCostRedPct: 40 } });
  equip(c, 'amulet', wordItem(c, 'rw_timeloop'));                     // cdPct 45
  assert.ok(Math.abs(c.rwCooldownFactor() - 0.55) < 1e-9);
  equip(c, 'weapon', wordItem(c, 'rw_blitz'));                        // aspdMult 15
  assert.ok(Math.abs(c.rwAttackSpeedMultiplier() - 1.15) < 1e-9);
  assert.ok(Math.abs(c.legendaryAttackSpeedMultiplier(setup(c), c.getStats()) - 1.15) < 1e-9, '接進傳奇攻速入口');
  equip(c, 'helmet', wordItem(c, 'rw_manafountain'));                 // manaCostRedPct 40
  assert.ok(Math.abs(c.rwManaCostFactor() - 0.6) < 1e-9);
  c.RUNEWORD_BY_ID.rw_timeloop.fx.cdPct = 999; c.markStatsDirty();
  assert.equal(c.rwCooldownFactor(), 0.2, '冷卻倍率最低 ×0.2');
});

/* ---------------- 事件觸發 ---------------- */

function fakeRes(over) { return Object.assign({ miss: false, dmg: 1000, crit: false, killed: false }, over || {}); }

test('hit 觸發：機率擲骰、傷害走既有傷害管線、擊殺回報給呼叫端', () => {
  const c = loadRuneEnv();
  pin(c, 'rw_minorthunder', { procs: [{ on: 'hit', chance: 8, acts: [{ act: 'dmg', pct: 90, elem: 'lightning', to: 'target' }] }] });
  equip(c, 'weapon', wordItem(c, 'rw_minorthunder'));             // 8%：90% 雷電傷害
  const p = setup(c);
  const foe = c.FIELD.monsters[0];
  const st = c.getStats();
  c.Math.random = () => 0.99;                                      // 擲不中
  assert.equal(c.rwOnBasicAttack(p, foe, fakeRes(), 'mv-float', st), null);
  assert.equal(foe.hp, 1e9);
  c.Math.random = () => 0;                                         // 必中
  const out = c.rwOnBasicAttack(p, foe, fakeRes(), 'mv-float', st);
  assert.ok(out && out.dmg > 0);
  assert.ok(foe.hp < 1e9);
  assert.equal(c.rwOnBasicAttack(p, foe, fakeRes({ miss: true }), 'mv-float', st), null, 'MISS 不觸發');
  // 一擊必殺的目標：killed 旗標要回報
  foe.hp = 1;
  c.Math.random = () => 0;
  const kill = c.rwOnBasicAttack(p, foe, fakeRes(), 'mv-float', st);
  assert.equal(kill.killed, true);
});

test('every：每 N 次命中才觸發；cd：內建冷卻內不再觸發', () => {
  const c = loadRuneEnv();
  c.RUNEWORDS.push({ id: 'rw_t_every', name: '測試每三下', tier: 1, runes: ['r03', 'r03'], bases: ['mainHand'],
    procs: [{ on: 'hit', every: 3, acts: [{ act: 'dmg', pct: 100, type: 'phys', to: 'target' }] }] });
  equip(c, 'weapon', fillRunes(makeItem(c, { rarity: 5 }), ['r03', 'r03']));
  const p = setup(c), foe = c.FIELD.monsters[0], st = c.getStats();
  c.Math.random = () => 0.5;
  const hits = [];
  for (let i = 0; i < 6; i++) hits.push(!!c.rwOnBasicAttack(p, foe, fakeRes(), 'mv-float', st));
  assert.deepEqual(hits, [false, false, true, false, false, true]);
  // cd
  c.RUNEWORDS.push({ id: 'rw_t_cd', name: '測試冷卻', tier: 1, runes: ['r04', 'r04'], bases: ['mainHand'],
    procs: [{ on: 'hit', cd: 5, acts: [{ act: 'dmg', pct: 100, type: 'phys', to: 'target' }] }] });
  equip(c, 'weapon', fillRunes(makeItem(c, { rarity: 5 }), ['r04', 'r04']));
  c.rwResetRT();
  const st2 = c.getStats();
  c.GT = 100;
  assert.ok(c.rwOnBasicAttack(p, foe, fakeRes(), 'mv-float', st2));
  c.GT = 103;
  assert.equal(c.rwOnBasicAttack(p, foe, fakeRes(), 'mv-float', st2), null);
  c.GT = 105.1;
  assert.ok(c.rwOnBasicAttack(p, foe, fakeRes(), 'mv-float', st2));
});

test('crit 只在暴擊時觸發；擴散傷害打其他敵人但不重複打主目標', () => {
  const c = loadRuneEnv();
  pin(c, 'rw_swarmhunter', { fx: { splashPct: 30 } });
  equip(c, 'weapon', wordItem(c, 'rw_swarmhunter'));              // splashPct 30
  const a = enemy(), b = enemy(), d = enemy();
  const p = setup(c, [a, b, d]);
  const st = c.getStats();
  c.Math.random = () => 0.99;
  const out = c.rwOnBasicAttack(p, a, fakeRes({ dmg: 1000 }), 'mv-float', st);
  assert.equal(a.hp, 1e9, '主目標由普攻本身處理');
  assert.equal(b.hp, 1e9 - 300);
  assert.equal(d.hp, 1e9 - 300);
  assert.equal(out.dmg, 600);
  // crit 專用
  pin(c, 'rw_chainstorm', { procs: [{ on: 'crit', chance: 30, acts: [{ act: 'dmg', pct: 120, elem: 'lightning', to: 'all' }] }] });
  equip(c, 'weapon', wordItem(c, 'rw_chainstorm'));               // crit：對全體 150% 雷電
  const p2 = setup(c, [enemy(), enemy()]);
  const st2 = c.getStats();
  c.Math.random = () => 0;
  assert.equal(c.rwOnBasicAttack(p2, c.FIELD.monsters[0], fakeRes({ crit: false }), 'mv-float', st2) === null
    || c.FIELD.monsters[1].hp === 1e9, true, '非暴擊且 hit 無觸發＝沒有傷害');
  const before = c.FIELD.monsters.map((m) => m.hp);
  c.rwOnBasicAttack(p2, c.FIELD.monsters[0], fakeRes({ crit: true }), 'mv-float', st2);
  assert.ok(c.FIELD.monsters.every((m, i) => m.hp < before[i]), '暴擊：全體都吃到傷害');
});

test('kill：擊殺回復生命與法力；kill 觸發可縮短技能冷卻', () => {
  const c = loadRuneEnv();
  pin(c, 'rw_timewarden', { procs: [{ on: 'kill', acts: [{ act: 'cdr', sec: 1 }] }], fx: {} });
  pin(c, 'rw_bloodring', { fx: { killHealPct: 1 } });
  equip(c, 'weapon', wordItem(c, 'rw_timewarden', { weaponType: 'orb' }));
  equip(c, 'ring', wordItem(c, 'rw_bloodring'));                  // killHealPct 1
  const p = setup(c);
  const st = c.getStats();
  p.hp = st.hp * 0.5;
  p.skillCds = { 'sg:thrust': 10, 'sg:cleave': 0.5 };
  c.rwOnKill(p, enemy({ hp: 0 }));
  assert.ok(p.hp > st.hp * 0.5, '擊殺回血');
  assert.equal(p.skillCds['sg:thrust'], 9);
  assert.equal(p.skillCds['sg:cleave'], 0, '冷卻不會變成負數');
});

test('hurt／block 觸發以攻擊者為目標；受傷為 0 時不觸發 hurt', () => {
  const c = loadRuneEnv();
  pin(c, 'rw_ironoath', { procs: [{ on: 'hurt', chance: 20, cd: 3, acts: [{ act: 'dmg', pct: 100, type: 'phys', to: 'attacker' }] }] });
  equip(c, 'shoulder', wordItem(c, 'rw_ironoath'));                // hurt 20%，冷卻 3 秒，100% 物理打攻擊者
  const p = setup(c);
  const attacker = c.FIELD.monsters[0];
  c.Math.random = () => 0;
  c.GT = 50;
  c.rwOnPlayerDamaged(attacker, p, 0, false, {}, 'pv-float');
  assert.equal(attacker.hp, 1e9, '沒掉血不觸發');
  c.rwOnPlayerDamaged(attacker, p, 500, false, {}, 'pv-float');
  assert.ok(attacker.hp < 1e9);
  const after = attacker.hp;
  c.GT = 51;
  c.rwOnPlayerDamaged(attacker, p, 500, false, {}, 'pv-float');
  assert.equal(attacker.hp, after, '冷卻內不再觸發');
  // block
  pin(c, 'rw_guardian', { procs: [{ on: 'block', chance: 40, acts: [{ act: 'dmg', pct: 200, type: 'phys', to: 'attacker' }] }] });
  equip(c, 'weapon', wordItem(c, 'rw_guardian'));
  const p2 = setup(c); const atk2 = c.FIELD.monsters[0];
  c.rwOnPlayerDamaged(atk2, p2, 100, true, {}, 'pv-float');
  assert.ok(atk2.hp < 1e9, '格擋觸發反擊');
});

test('legendaryOnPlayerDamaged 入口確實會呼叫符文真言（受擊路徑接線）', () => {
  const c = loadRuneEnv();
  pin(c, 'rw_ironoath', { procs: [{ on: 'hurt', chance: 20, cd: 3, acts: [{ act: 'dmg', pct: 100, type: 'phys', to: 'attacker' }] }] });
  equip(c, 'shoulder', wordItem(c, 'rw_ironoath'));
  const p = setup(c);
  const attacker = c.FIELD.monsters[0];
  c.Math.random = () => 0;
  c.GT = 10;
  c.legendaryOnPlayerDamaged(attacker, p, 100, false, { thorns: 0 }, 'pv-float');
  assert.ok(attacker.hp < 1e9);
});

test('lowhp：生命低於門檻觸發，內建冷卻內不重複；提供無敵與回血', () => {
  const c = loadRuneEnv();
  pin(c, 'rw_lastbreath', { procs: [{ on: 'lowhp', below: 30, cd: 90, acts: [{ act: 'invuln', sec: 3 }, { act: 'heal', pctMax: 30 }, { act: 'cleanse' }] }] });
  equip(c, 'chest', wordItem(c, 'rw_lastbreath'));
  const p = setup(c);
  const st = c.getStats();
  c.GT = 1;
  p.hp = st.hp * 0.2;
  c.rwCheckLowHp(p, st, 'mv-float');
  assert.ok(c.effectActive(p, 'invuln'));
  assert.ok(p.hp >= st.hp * 0.45, '回復 30%');
  p.effects.invuln = 0;
  p.hp = st.hp * 0.2;
  c.GT = 30;
  c.rwCheckLowHp(p, st, 'mv-float');
  assert.equal(c.effectActive(p, 'invuln'), false, '90 秒冷卻內不再觸發');
  c.GT = 100;
  c.rwCheckLowHp(p, st, 'mv-float');
  assert.ok(c.effectActive(p, 'invuln'));
});

test('tick：每 N 秒觸發一次；倒地期間暫停；selfDrain 不致死', () => {
  const c = loadRuneEnv();
  pin(c, 'rw_dawncrown', { procs: [{ on: 'tick', every: 10, acts: [{ act: 'heal', pctMax: 8 }, { act: 'mana', pctMax: 8 }] }] });
  equip(c, 'helmet', wordItem(c, 'rw_dawncrown'));                // tick 10 秒：回血回魔 8%
  const p = setup(c);
  const st = c.getStats();
  p.hp = st.hp * 0.5; p.mp = 0;
  const ctx = { pEnt: p, getEnemies: () => c.FIELD.monsters, floatSel: 'mv-float', onDeaths() {} };
  c.GT = 0; c.rwTick(0.1, ctx);                                     // 建立排程（next = 10）
  c.GT = 9.9; c.rwTick(0.1, ctx);
  assert.equal(p.mp, 0);
  c.GT = 10.0; c.rwTick(0.1, ctx);
  assert.ok(p.mp > 0 && p.hp > st.hp * 0.5);
  const mp1 = p.mp;
  c.GT = 15; c.rwTick(0.1, ctx);
  assert.equal(p.mp, mp1, '第二次要等到 20 秒');
  // 生命祭獻
  pin(c, 'rw_bloodmoon', { fx: { selfDrainPct: 2 } });
  equip(c, 'weapon', wordItem(c, 'rw_bloodmoon'));                 // selfDrainPct 2
  const p2 = setup(c);
  const st2 = c.getStats();
  p2.hp = st2.hp;
  c.rwTick(1, { pEnt: p2, getEnemies: () => [], floatSel: 'mv-float' });
  assert.ok(Math.abs(p2.hp - st2.hp * 0.98) < 1e-6);
  p2.hp = 1.5;
  c.rwTick(10, { pEnt: p2, getEnemies: () => [], floatSel: 'mv-float' });
  assert.equal(p2.hp, 1, '最低留 1 點');
});

test('cast：重施放與隨機施放呼叫 castSkill2 的免費模式（repeat），且不連鎖觸發', () => {
  const c = loadRuneEnv();
  pin(c, 'rw_timeloop', { procs: [{ on: 'cast', chance: 25, acts: [{ act: 'recast' }] }] });
  equip(c, 'amulet', wordItem(c, 'rw_timeloop'));                  // cast 25%：recast
  const p = setup(c);
  const calls = [];
  c.castSkill2 = (pe, tg, gid, fs, opts) => { calls.push({ gid, opts }); return { dmg: 500, killed: false }; };
  c.Math.random = () => 0;
  const out = { dmg: 100, killed: false };
  c.rwOnSkillCast(p, 'thrust', out, 'mv-float', c.FIELD.monsters);
  assert.deepEqual(calls.map((x) => x.gid), ['thrust']);
  assert.equal(calls[0].opts.repeat, true);
  assert.equal(out.dmg, 600, '重施放的傷害併入該次施放總傷害');
  // castRandom：只會挑已裝配且可施放的非被動技能
  pin(c, 'rw_blitz', { procs: [{ on: 'hit', every: 6, acts: [{ act: 'castRandom' }] }] });
  equip(c, 'weapon', wordItem(c, 'rw_blitz'));                     // hit 每 6 次：castRandom
  c.G.player.loadout = ['sg:thrust', 'potential:x'];
  c.G.player.skills2 = { levels: { thrust: [1, 0, 0, 0, 0, 0, 0] } };
  calls.length = 0;
  const p2 = setup(c); const st = c.getStats();
  for (let i = 0; i < 6; i++) c.rwOnBasicAttack(p2, c.FIELD.monsters[0], fakeRes(), 'mv-float', st);
  assert.deepEqual(calls.map((x) => x.gid), ['thrust']);
});

test('castSkill2 的施放掛勾存在（非免費施放才觸發，免費施放不觸發＝不會無限連鎖）', () => {
  const c = loadRuneEnv();
  const src = require('node:fs').readFileSync(require('node:path').join(require('./helpers/runeword-env.cjs').root, 'js/skills2.js'), 'utf8');
  assert.match(src, /if \(!freeCast && typeof rwOnSkillCast === 'function'\) rwOnSkillCast\(/);
  assert.match(src, /rwManaCostFactor\(\)/);
  assert.match(src, /cd \*= rwCooldownFactor\(\)/);
  assert.equal(typeof c.rwOnSkillCast, 'function');
});

/* ---------------- 復活 ---------------- */

test('輪迴：死亡時復活、無敵、增傷、重置冷卻；冷卻期間不再復活；重置戰鬥不洗掉復活冷卻', () => {
  const c = loadRuneEnv();
  pin(c, 'rw_reincarnation', { fx: { reviveHpPct: 60, reviveCdSec: 180, reviveInvulnSec: 3, reviveDmgPct: 60, reviveDmgSec: 10, reviveRefresh: 1 } });
  equip(c, 'chest', wordItem(c, 'rw_reincarnation'));
  const p = setup(c);
  const st = c.getStats();
  p.hp = 0;
  p.skillCds = { 'sg:thrust': 20 };
  c.GT = 100;
  assert.equal(c.rwTryRevive(p), true);
  assert.ok(Math.abs(p.hp - st.hp * 0.6) < 1);
  assert.ok(c.effectActive(p, 'invuln'));
  assert.equal(c.buffVal(p, 'allDmgUp'), 60);
  assert.equal(p.skillCds['sg:thrust'], 0);
  p.hp = 0; c.GT = 150;
  assert.equal(c.rwTryRevive(p), false, '180 秒冷卻內不能再復活');
  c.resetSkillRT();                                                // 進出高塔／開場都會重置戰鬥狀態
  assert.equal(c.rwTryRevive(p), false, '重置戰鬥不得洗掉復活冷卻');
  c.GT = 281;
  assert.equal(c.rwTryRevive(p), true);
});

test('死亡出口接線：野外 onPlayerFieldDeath 與高塔 endTowerFight 都會先問輪迴', () => {
  const c = loadRuneEnv();
  pin(c, 'rw_reincarnation', { fx: { reviveHpPct: 60, reviveCdSec: 180, reviveInvulnSec: 3, reviveDmgPct: 60, reviveDmgSec: 10, reviveRefresh: 1 } });
  equip(c, 'chest', wordItem(c, 'rw_reincarnation'));
  const p = setup(c);
  p.hp = 0; c.GT = 10;
  c.onPlayerFieldDeath();
  assert.ok(p.hp > 0, '野外：復活而不是退關');
  assert.equal(c.FIELD.reviveCd > 0, false);
  // 高塔
  c.GT = 1000;
  c.G.tower.active = true;
  c.TOWER.player = p; c.TOWER.boss = enemy({ name: 'BOSS' });
  c.TOWER.elapsed = 5; c.TOWER.floor = 1;
  p.hp = 0;
  c.endTowerFight(false, 'death');
  assert.ok(p.hp > 0, '高塔：復活');
  assert.notEqual(c.TOWER.showingResult, true, '復活後戰鬥繼續，不結算');
});

/* ---------------- 掉落 ---------------- */

test('掉落階數：進度越深上限越高、永遠在 1~33；階越高越稀有（與進度無關）', () => {
  const c = loadRuneEnv();
  assert.equal(c.runeDropTierMax('desert', 1) >= 1, true);
  let prev = 0;
  ['desert', 'Icefield', 'swamp', 'undead_mountains', 'god_battlefield', 'god_chaos', 'god_sanctuary'].forEach((z) => {
    const t = c.runeDropTierMax(z, c.zoneMaxStage(z));
    assert.ok(t > prev, `${z} 的最高階應高於前一張圖`);
    prev = t;
  });
  assert.equal(c.runeDropTierMax('god_sanctuary', 800), 33);
  const counts = {};
  let seed = 7;
  c.Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 4000; i++) { const t = c.rollRuneTier(10); counts[t] = (counts[t] || 0) + 1; assert.ok(t >= 1 && t <= 10); }
  assert.ok(counts[1] > counts[2] && counts[2] > counts[3] && counts[3] > counts[5] && counts[5] > (counts[10] || 0), '階越高越稀有：' + JSON.stringify(counts));
  const rho = c.RUNE_SETTINGS.drop.tierSpread;
  assert.ok(Math.abs(counts[2] / counts[1] - rho) < 0.06, '相鄰兩階的機率比 ≈ tierSpread：' + counts[2] / counts[1]);
  // 解鎖更高階不會讓低階變難拿：第 1 階在上限 10 與上限 33 時的機率只差正規化項
  let ones33 = 0;
  for (let i = 0; i < 4000; i++) if (c.rollRuneTier(33) === 1) ones33++;
  assert.ok(Math.abs(ones33 / 4000 - counts[1] / 4000) < 0.03);
});

test('野外掉落：符文入庫並回報字串；符文掉落率加成會放大機率；封魔塔掉落依樓層', () => {
  const c = loadRuneEnv();
  c.rollDropCount = () => 3;
  const drops = [];
  assert.equal(c.rwRollFieldRuneDrops('desert', 1, 0, 1, 1, drops), 3);
  assert.equal(drops.length, 3);
  assert.equal(c.totalRunes(), 3);
  let seen = 0;
  c.rollDropCount = (pct) => { seen = pct; return 0; };
  c.rwRollFieldRuneDrops('desert', 1, 0, 1, 1, []);
  const basePct = seen;
  pin(c, 'rw_scavenger', { fx: { runeFindPct: 8 } });
  equip(c, 'ring', wordItem(c, 'rw_scavenger'));                    // runeFindPct 8
  c.rwRollFieldRuneDrops('desert', 1, 0, 1, 1, []);
  assert.ok(Math.abs(seen / basePct - 1.08) < 1e-9);
  c.rollDropCount = () => 2;
  const got = c.rwRollTowerRuneDrop(150, 0);
  assert.equal(got.length, 2);
  got.forEach((id) => assert.ok(c.RUNE_BY_ID[id].tier <= 22));
});

/* ---------------- 顯示 ---------------- */

test('符文孔 HTML：符文顯示字形與實際數值；成形時列出符文真言全部效果；差一顆時提示配方；寶石鑲孔不再混入符文', () => {
  const c = loadRuneEnv();
  const it = makeItem(c, { rarity: 5 });
  it.runes[0] = 'r06';
  let html = c.itemRuneHTML(it, null);
  assert.match(html, /符文孔 1／4/);
  assert.match(html, /毒牙符文/);
  assert.match(html, /符文孔 2（空）/);
  assert.doesNotMatch(html, /再鑲入|即可成形/, '沒成形時不給任何提示（玩家自己探索）');
  assert.doesNotMatch(html, /data-rune-erase|data-socket-pick/, '不在符文鑲嵌頁時唯讀，沒有選孔也不可抹除');
  it.runes[1] = 'r08';
  html = c.itemRuneHTML(it, null);
  assert.match(html, /符文真言【蛇吻】/);
  assert.match(html, /runeword-socket/);
  assert.match(html, /普通攻擊命中時有 15% 機率/);
  assert.doesNotMatch(html, /再鑲入/);
  assert.match(c.itemRuneHTML(it, { selIdx: -1, pending: false }), /data-rune-erase="0"[\s\S]*data-rune-erase="1"/, '符文鑲嵌頁每個已刻印的符文右側有「抹除」');
  assert.match(c.itemRuneHTML(it, { selIdx: -1, pending: false }), /rs-halo[\s\S]*rs-halo/, '構成符文真言的符文圖示有旋轉光暈');
  assert.match(c.itemRuneHTML(it, null), /rs-halo/, '唯讀顯示也有光暈');
  const drafted = c.itemRuneHTML(makeItem(c, { rarity: 5 }), { selIdx: 0, pending: false, draft: { 1: 'r05' } });
  assert.match(drafted, /is-draft[\s\S]*data-rune-undraft="1"/, '暫放的符文列有「取消」');
  assert.doesNotMatch(drafted, /data-rune-erase|rs-halo/, '暫放的符文不能抹除、也不發光');
  assert.match(c.itemRuneHTML(it, { selIdx: 2, pending: false }), /data-socket-pick="2" aria-pressed="true"/, '符文鑲嵌頁每孔都能選取，選中的孔 aria-pressed');
  assert.doesNotMatch(c.itemSocketHTML(it, null), /符文|runeword/, '寶石鑲孔區塊不含符文');
  assert.equal(c.itemRuneHTML(makeItem(c, { rarity: 0 }), null), '', '沒有符文孔的裝備不輸出符文區塊');
  // 完整詳情把符文區塊接在附魔原本的位置（寶石鑲孔之前）
  const detail = c.itemDetailHTML(it, null, {});
  assert.ok(detail.indexOf('符文孔') > 0 && detail.indexOf('符文孔') < detail.indexOf('寶石鑲孔'));
});

test('附魔功能已關閉：ENCHANT_ENABLED=false 時附魔欄為 0、附魔不計入屬性與評分、不能附魔／取下，資料原樣保留', () => {
  const c = loadRuneEnv();
  assert.equal(c.ENCHANT_ENABLED, false);
  const it = makeItem(c, { rarity: 5 });
  it.enchants = [{ key: 'fire', gemLv: 3 }];
  assert.equal(c.enchantCapFor(it), 0);
  assert.deepEqual(plain(c.itemEnchants(it)), []);
  assert.deepEqual(plain(it.enchants), [{ key: 'fire', gemLv: 3 }], '資料沒有被動');
  assert.equal(c.manualEnchant(it, 'fire'), '附魔功能已關閉（由符文取代）');
  assert.equal(c.removeEnchantAt(it, 0), false);
  const bare = makeItem(c, { rarity: 5 });
  assert.equal(c.itemScore(it), c.itemScore(bare), '附魔不計入評分');
  assert.doesNotMatch(c.itemDetailHTML(it, null, {}), /it-enchant/);
  // 打開開關就完整恢復（資料沒丟）
  vmSet(c, 'ENCHANT_ENABLED', true);
  assert.deepEqual(plain(c.itemEnchants(it)), [{ key: 'fire', gemLv: 3 }]);
  assert.ok(c.enchantCapFor(it) >= 1);
  assert.ok(c.itemScore(it) > c.itemScore(bare));
});

test('存檔相容：新遊戲有 runes 表；舊存檔缺欄位由合併預設補空表；髒資料整理成非負整數', () => {
  const c = loadRuneEnv();
  assert.deepEqual(JSON.parse(JSON.stringify(c.newGameState().player.runes)), {});
  const src = require('node:fs').readFileSync(require('node:path').join(require('./helpers/runeword-env.cjs').root, 'js/save.js'), 'utf8');
  assert.match(src, /data\.player\.runes/);
});

test('代價型效果：maxHpPct 乘算降低最大生命（下限 0.1），不隨稀有度放大；生命% 總和再負也不會讓生命小於 0', () => {
  const c = loadRuneEnv();
  const word = c.RUNEWORD_BY_ID.rw_timeloop;
  // 同一組裝備，只改 maxHpPct：其他屬性（符文本身的生命%等）完全相同，才量得出乘區
  const hpWith = (pct, rarity) => {
    word.fx.maxHpPct = pct;
    return equip(c, 'amulet', wordItem(c, 'rw_timeloop', { rarity: rarity })).hp;
  };
  const noCost = hpWith(0, 10);
  assert.ok(Math.abs(hpWith(-20, 10) / noCost - 0.8) < 0.005, '預期 ×0.8');
  const noCostLow = hpWith(0, 5);
  assert.ok(Math.abs(hpWith(-20, 5) / noCostLow - 0.8) < 0.005, '代價不隨稀有度改變（傳說級同樣 ×0.8）');
  assert.ok(Math.abs(hpWith(-500, 10) / noCost - 0.1) < 0.005, '乘區下限 0.1');
  assert.ok(hpWith(-500, 10) > 0);
  // 任何來源把生命% 推到 -100% 以下，也不會得到負生命
  c.RUNEWORD_BY_ID.rw_timeloop.fx.maxHpPct = 0;
  c.RUNEWORD_BY_ID.rw_timeloop.stats.push(['hpPct', -50]);
  const neg = equip(c, 'amulet', wordItem(c, 'rw_timeloop'));
  assert.ok(neg.hp > 0);
});

/* ---------------- 任務 ---------------- */

test('任務：runeSocketCount 計累計鑲入次數，rune 獎勵發符文；任務表第 10 號已改成符文任務', () => {
  const c = loadRuneEnv();
  const it = makeItem(c, { rarity: 5 });
  assert.equal(c.taskProgressFor({ type: 'runeSocketCount' }), 0);
  c.addRune('r01', 2);
  c.socketRune(it, 'r01'); c.socketRune(it, 'r01');
  assert.equal(c.taskProgressFor({ type: 'runeSocketCount' }), 2, '每次成功鑲入各計 1 次');
  it.runes[0] = null; c.addRune('r01', 1); c.socketRune(it, 'r01');
  assert.equal(c.taskProgressFor({ type: 'runeSocketCount' }), 3, '拆下再鑲會再計一次');
  assert.match(c.socketRune(it, 'zz'), /沒有這種符文/);
  assert.equal(c.taskProgressFor({ type: 'runeSocketCount' }), 3, '失敗不計');
  const before = c.runeCount('r02');
  c.taskGrantReward({ rewardType: 'rune', rewardParam: 'r02', rewardQty: 3 });
  assert.equal(c.runeCount('r02'), before + 3);
  c.taskGrantReward({ rewardType: 'rune', rewardParam: 'nope', rewardQty: 3 });
  assert.equal(c.totalRunes(), before + 3 + c.runeCount('r01'), '未知符文 id 不發獎也不報錯');
  const t10 = c.TASKS.find((t) => t.order === 10);
  assert.equal(t10.type, 'runeSocketCount');
  assert.equal(t10.rewardType, 'rune');
  assert.ok(c.RUNE_BY_ID[t10.rewardParam], '獎勵符文 id 存在');
  assert.ok(!c.TASKS.some((t) => t.type === 'enchantCount' || t.rewardType === 'book'), '附魔已關閉，不再有任務要求附魔或發附魔書');
});
