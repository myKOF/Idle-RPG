/* 遺物機率型效果大量抽樣探針（2026-11-09 遺物測試用，結果見 docs/RELIC_TEST_REPORT.md）
   用真的遊戲函式＋真的亂數，比較「無遺物」與「該遺物 Lv.10」。改了 Relics 表或接線後可重跑對照。
   用法：node tools/relic_sample.cjs            （神祕商人預設以商店 20 級量；SHOPLV=1 node … 可改） */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = process.argv[2] || path.resolve(__dirname, '..');
function ctx() {
  const c = { console, UI: { dirty: {} }, GT: 0 };
  c.window = c; vm.createContext(c);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/relic_data.js', 'js/relic.js', 'js/status.js', 'js/formula.js',
   'js/battlefield.js', 'js/item.js', 'js/skills.js', 'js/talents.js', 'js/player.js', 'js/factory.js', 'js/save.js',
   'js/runeword_data.js', 'js/runeword.js', 'js/forge.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), c, { filename: f });
  });
  c.blog = () => {}; c.flog = () => {};
  c.FIELD = { player: null, monster: null, monsters: [] };
  c.G = c.newGameState();
  c.G.player.gold = 1e30; c.G.player.scrap = 1e30; c.G.player.essence = 1e30; c.G.player.dust = 1e12;
  return c;
}
function setMax(c, key) { const r = c.RELIC_BY_EFFECT[key]; c.G.player.relics[r.id] = { lv: r.levels.length, n: 0 }; if (c.markStatsDirty) c.markStatsDirty(); }
const out = {};
const N = 20000;
function both(label, fn) {
  const a = fn(false), b = fn(true);
  out[label] = { base: a, relic: b };
}

/* C：熔爐拆解（不裝任何熔爐零件：bonus 一律 0；另測知識核心 20 時的相加） */
function salvageRun(withRelic, partVals) {
  const c = ctx();
  c.G.stage.current = 100; c.G.stage.best = 100;
  if (withRelic) ['salvageScrap', 'salvageEssence', 'salvageXp', 'salvageGold', 'salvageGemChance'].forEach((k) => setMax(c, k));
  let gems = 0, xp = 0;
  const addGem0 = c.addGem; c.addGem = (t, l, n) => { gems += n; return addGem0(t, l, n); };
  c.gainXp = (n) => { xp += n; };
  c.G.player.scrap = 0; c.G.player.gold = 0; c.G.player.essence = 0;
  const s0 = 0, g0 = 0, e0 = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) {
    const it = c.makeEquipment(100, { rarity: 3, level: 100 });
    c.doSalvage(it, true, (key) => (partVals && partVals[key]) || 0);
  }
  return { scrap: +((c.G.player.scrap - s0) / n).toFixed(2), gold: +((c.G.player.gold - g0) / n).toFixed(1), essence: +((c.G.player.essence - e0) / n).toFixed(3),
    gemRate: +(gems / n * 100).toFixed(2) + '%', xp: +(xp / n).toFixed(1) };
}
both('C 拆解（無零件）', (r) => salvageRun(r, null));
both('C 拆解（知識核心20＋寶石採集器5）', (r) => salvageRun(r, { knowledgeCore: 20, gemCollector: 5 }));

/* F：寶石合成、符文合成／拆解／抹除 */
both('F1 寶石合成：每次消耗', (r) => {
  const c = ctx(); if (r) setMax(c, 'gemComposeSave');
  const type = Object.keys(c.GEM_TYPES).find((t) => c.isGemEnabled(t));
  const need = c.gemComposeInputCount(1);
  c.addGem(type, 1, N * need);
  const before = c.gemCount(type, 1); let ok = 0;
  for (let i = 0; i < N; i++) if (c.composeGems(type, 1) === null) ok++;
  return { need, avgUsed: +((before - c.gemCount(type, 1)) / ok).toFixed(3), saveRate: +(((need * ok) - (before - c.gemCount(type, 1))) / ok * 100).toFixed(2) + '%' };
});
both('F2 符文合成：每次消耗', (r) => {
  const c = ctx(); if (r) setMax(c, 'runeComposeSave');
  const id = c.RUNES[0].id; c.addRune(id, N * 3);
  const before = c.runeCount(id); let ok = 0;
  for (let i = 0; i < N; i++) if (c.composeRune(id) === null) ok++;
  const used = before - c.runeCount(id);
  return { count: c.RUNE_COMPOSE_COUNT, avgUsed: +(used / ok).toFixed(3), saveRate: +((c.RUNE_COMPOSE_COUNT * ok - used) / ok * 100).toFixed(2) + '%' };
});
both('F3 符文拆解：每次產量', (r) => {
  const c = ctx(); if (r) setMax(c, 'runeDismantleBonus');
  const id = c.RUNES[5].id, lower = c.RUNES[4].id; c.addRune(id, N);
  const l0 = c.runeCount(lower); let ok = 0;
  for (let i = 0; i < N; i++) if (!c.dismantleRune(id).err) ok++;
  return { baseYield: c.RUNE_DISMANTLE_YIELD, avgYield: +((c.runeCount(lower) - l0) / ok).toFixed(3) };
});
both('F4 符文抹除：退回率', (r) => {
  const c = ctx(); if (r) setMax(c, 'runeEraseKeep');
  const id = c.RUNES[3].id; let kept = 0, ok = 0;
  for (let i = 0; i < 5000; i++) {
    const it = { runes: [id], rarity: 5, level: 100 };
    const r0 = c.runeCount(id);
    const err = c.eraseRune(it, 0);
    if (err === null) { ok++; if (c.runeCount(id) > r0) kept++; }
    else if (i === 0) return { err };
  }
  return { ok, keepRate: +(kept / ok * 100).toFixed(2) + '%' };
});

/* G：強化／洗煉費用、強化槌、精煉神石、神賜之戒 */
both('G1/G2 費用', (r) => {
  const c = ctx(); if (r) { setMax(c, 'rerollEssenceDiscount'); setMax(c, 'upgradeScrapDiscount'); }
  const it = c.makeEquipment(100, { rarity: 5, level: 100 }); it.upgrade = 30;
  return { upgrade: c.upgradeCost(it), reroll: c.rerollCost(it) };
});
both('G3 強化槌：成功時 +2 的比例', (r) => {
  const c = ctx(); if (r) setMax(c, 'upgradeDouble');
  c.upgradeSuccessChance = () => 100;
  let dbl = 0; const n = N;
  for (let i = 0; i < n; i++) { const it = { upgrade: 0, rarity: 3, level: 50, slot: 'weapon', affixes: [] }; c.upgradeCost = () => ({ gold: 1, scrap: 1 }); c.tryUpgrade(it); if (it.upgrade === 2) dbl++; }
  return { doubleRate: +(dbl / n * 100).toFixed(2) + '%' };
});
both('G4 精煉神石：返還率與量', (r) => {
  const c = ctx(); if (r) setMax(c, 'forgeDustRefund');
  c.forgeValidate = () => null;
  let refunds = 0, back = 0, errs = 0; const n = 5000;
  for (let i = 0; i < n; i++) {
    const f = c.forgeState(); f.operation = 'equip'; f.slots = [null, null, null, null, null, null];
    c.forgeRateInfo = () => ({ cost: 0, materialCost: 100, total: 0, stones: 100 });
    const d0 = c.G.player.dust;
    try { c.doForge(); } catch (e) { errs++; }
    const delta = c.G.player.dust - d0;   // -100（沒返還）或 -75（返還 25）
    if (delta > -100) { refunds++; back += delta + 100; }
  }
  return { material: c.divineForgeMaterialKey('equip'), refundRate: +(refunds / n * 100).toFixed(2) + '%', avgBack: refunds ? +(back / refunds).toFixed(1) : 0, errs };
});
both('G5 神賜之戒：神聖刻印出傳奇的比例', (r) => {
  const c = ctx(); if (r) setMax(c, 'imprintLegendary');
  c.passiveKeysForItem = () => ['k1', 'k2', 'k3'];
  c.rollAffixes = () => [{ key: 'atk', v: 1 }];
  let leg = 0; const n = N;
  for (let i = 0; i < n; i++) { const it = { affixes: [{ ancient: false }], sockets: [0], rarity: 5, slot: 'weapon', level: 100 }; if (c.forgeApplyImprint(it, 10).kind === 'legendary') leg++; }
  const W = c.DIVINE_FORGE, keys = ['sacredAffix', 'ancientAffix', 'sacredSocket', 'extraAffix', 'extraAncient', 'legendary', 'refund'];
  const sum = keys.reduce((s, k) => s + W[k + 'Weight'], 0), m = r ? 2 : 1;
  const expect = W.legendaryWeight * m / (sum + W.legendaryWeight * (m - 1));
  return { legendaryRate: +(leg / n * 100).toFixed(2) + '%', expected: +(expect * 100).toFixed(2) + '%' };
});

/* E：神祕商人刷新（高階寶石／傳說以上裝備／19 階以上符文出現比例、售價） */
both('E 神祕商人', (r) => {
  const c = ctx(); if (r) ['merchantHighGem', 'merchantHighEquip', 'merchantHighRune', 'merchantDiscount'].forEach((k) => setMax(c, k));
  c.G.player.level = 1000; c.G.stage.best = 1000; c.gemShop().level = +process.env.SHOPLV || 20;
  let gem = 0, gemHi = 0, eq = 0, eqHi = 0, rune = 0, runeHi = 0, priceRatio = [];
  for (let i = 0; i < 3000; i++) {
    c.rollGemShop();
    c.gemShop().items.forEach((it) => {
      const k = it.kind || 'gem';
      if (k === 'gem') { gem++; if (it.lv >= c.RELIC_MERCHANT_HIGH_GEM_LEVEL) gemHi++; }
      else if (k === 'equipment') { eq++; const rr = it.equipment ? it.equipment.rarity : it.rarity; if (rr >= c.RELIC_MERCHANT_HIGH_EQUIP_RARITY) eqHi++; }
      else if (k === 'rune') { rune++; const t = c.RUNE_BY_ID[it.runeId || it.id] ? c.RUNE_BY_ID[it.runeId || it.id].tier : 0; if (t >= c.RELIC_MERCHANT_HIGH_RUNE_TIER) runeHi++; }
      if (i < 50 && Number.isFinite(it.price) && it.price > 0) priceRatio.push(c.merchantItemPrice(it) / it.price);
    });
  }
  const pct = (a, b) => b ? +(a / b * 100).toFixed(2) + '%' : 'n/a';
  return { gemHi: pct(gemHi, gem), equipHi: pct(eqHi, eq), runeHi: pct(runeHi, rune), counts: [gem, eq, rune],
    priceRatio: priceRatio.length ? [Math.min(...priceRatio).toFixed(3), Math.max(...priceRatio).toFixed(3)] : 'n/a',
    sample: JSON.stringify(c.gemShop().items.slice(0, 3)).slice(0, 300) };
});

/* E5：邀請券掉落率（只量判定式，不跑整場塔戰） */
both('E5 邀請券掉落機率（%）', (r) => {
  const c = ctx(); if (r) setMax(c, 'merchantTicketDrop');
  return c.MYSTERY_MERCHANT_SETTINGS.ticketDropRate * (1 + c.relicPct('merchantTicketDrop'));
});

console.log(JSON.stringify(out, null, 1));
