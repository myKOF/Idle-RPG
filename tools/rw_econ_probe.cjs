#!/usr/bin/env node
'use strict';
/* 符文取得難度探針（平衡校準用，不是測試）。

     node tools/rw_econ_probe.cjs [每小時擊殺數=3000] [掉寶加成倍率=2] [模擬次數=60]

   回答「湊齊每組符文真言的配方，大約要打幾小時」：
   - 掉落階數用遊戲真正的 rollRuneTier（js/runeword.js），階數上限用「配方最高階那顆符文剛解鎖」的進度；
   - 合成（composeCount 顆 → 下一階，到 composeMaxTier）與拆解降階頂替（1 顆高階 → 1 顆低一階）都算進去；
   - 每小時掉落數 ＝ 每小時擊殺 × 基礎掉落率 × 該進度所在地圖的獎勵倍率 × 掉寶加成倍率。
   取得難度只由「最高階那顆符文」決定（階越高越稀有）；各級距的目標見 js/runeword_data.js 的 RUNE_SETTINGS 註解。
   這是估算：真實擊殺速度、掉寶加成與菁英倍率會不同，用 RUNE_SETTINGS.drop.basePct 一個旋鈕整體校準。 */
const path = require('node:path');
const { loadRuneEnv } = require(path.join(__dirname, '..', 'tests', 'helpers', 'runeword-env.cjs'));

const KILLS_PER_HOUR = Number(process.argv[2] || 3000);
const LOOT_MULT = Number(process.argv[3] || 2);
const RUNS = Number(process.argv[4] || 60);

const c = loadRuneEnv({ noState: true });
const S = c.RUNE_SETTINGS, N = c.RUNES.length;
let seed = 12345;
c.Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/* 這組需求（各階要幾顆）能不能由持有的符文湊出：由高階往低階掃，
   多的往下一階頂替（拆解 1:1），缺的由下一階合成補（composeCount:1，且該階要能合成）。 */
function canMake(have, need) {
  let carry = 0, spare = 0;
  for (let t = N; t >= 1; t--) {
    const want = (need[t] || 0) + carry;
    const got = (have[t] || 0) + spare;
    if (got >= want) { spare = got - want; carry = 0; continue; }
    spare = 0;
    if (t === 1 || t - 1 >= S.composeMaxTier) return false;
    carry = (want - got) * S.composeCount;
  }
  return true;
}
function dropsNeeded(word, tierMax) {
  const need = {};
  word.runes.forEach((id) => { const t = c.RUNE_BY_ID[id].tier; need[t] = (need[t] || 0) + 1; });
  const res = [];
  for (let r = 0; r < RUNS; r++) {
    const have = []; let n = 0;
    while (n < 5e7) { n++; const t = c.rollRuneTier(tierMax); have[t] = (have[t] || 0) + 1; if (canMake(have, need)) break; }
    res.push(n);
  }
  res.sort((a, b) => a - b);
  return res[Math.floor(res.length / 2)];
}
/* 該階符文剛解鎖時所在的地圖：進度 = (階 - 1) / progressPerTier，取整數部分為地圖序號。 */
function zoneRewardMultAt(tier) {
  const keys = Object.keys(c.ZONES);
  const zi = Math.min(keys.length - 1, Math.floor((tier - 1) / S.drop.progressPerTier));
  return { key: keys[zi], mult: c.ZONES[keys[zi]].rewardMult || 1 };
}

const rows = [];
c.RUNEWORDS.forEach((w) => {
  const top = Math.max(...w.runes.map((id) => c.RUNE_BY_ID[id].tier));
  const z = zoneRewardMultAt(top);
  const drops = dropsNeeded(w, top);
  const perHour = KILLS_PER_HOUR * (S.drop.basePct / 100) * z.mult * LOOT_MULT;
  rows.push({ tier: w.tier, name: w.name, tiers: w.runes.map((id) => c.RUNE_BY_ID[id].tier).join(','), top, zone: z.key, drops, hours: drops / perHour });
});
console.log(`每小時 ${KILLS_PER_HOUR} 次擊殺｜掉寶加成 ×${LOOT_MULT}｜基礎掉落率 ${S.drop.basePct}%｜階數稀有度 ${S.drop.tierSpread}｜合成 ${S.composeCount}→1｜${RUNS} 次模擬取中位數`);
for (const t of [1, 2, 3, 4]) {
  const list = rows.filter((r) => r.tier === t).sort((a, b) => a.hours - b.hours);
  console.log(`\n第 ${t} 級（${c.RUNEWORD_TIER_NAMES[t]}）`);
  list.forEach((r) => console.log(`  ${r.name.padEnd(6, '　')} 符文階 [${r.tiers.padEnd(11)}] 最高階 ${String(r.top).padStart(2)}（${r.zone}）${String(r.drops).padStart(8)} 次掉落 ≈ ${r.hours.toFixed(1).padStart(6)} 小時`));
  const h = list.map((r) => r.hours);
  console.log(`  → 最少 ${h[0].toFixed(1)}／中位 ${h[Math.floor(h.length / 2)].toFixed(1)}／最多 ${h[h.length - 1].toFixed(1)} 小時`);
}
