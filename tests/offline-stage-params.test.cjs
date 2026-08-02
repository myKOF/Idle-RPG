/* 離線收益的旋鈕：計算等級（扣減／取整單位／比例）與怪物種類。

   離線收益是「以歷史最高關卡為基準的固定費率」模型。這幾個值原本有兩個是寫死的
   （取整單位 10、一律菁英怪），調整平衡時只能改程式。改成具名常數之後可以進參數表，
   但也多了一類新風險：**參數填錯不會報錯，只會安靜地算出別的數字**。
   下面測的就是「預設值等於改動前的行為」與「填錯時退化成什麼」。 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createEngine } = require('../scripts/sim/engine.js');

/* 每個測試自己開一份，改了全域常數也不會汙染別的測試。 */
function fresh() { return createEngine({ seed: 1 }).ctx; }

test('預設值必須完全重現改動前的公式', () => {
  /* 改動前：⌊(歷史最高 − 10) / 10⌋ × 10，下限 1。
     這條是這次重構唯一不能破的東西——它決定所有既有存檔的離線收益。 */
  const ctx = fresh();
  const old = (best) => Math.max(1, Math.floor((Math.max(1, Math.floor(best)) - 10) / 10) * 10);
  for (const best of [1, 5, 10, 11, 19, 20, 25, 50, 99, 100, 188, 256, 1000]) {
    assert.equal(ctx.offlineStageFor(best), old(best), `best=${best}`);
  }
});

test('參數表的預設值與程式內的預設值一致', () => {
  /* 兩邊不一致的話，跑一次套用參數就會無聲改變離線收益。 */
  const fs = require('node:fs');
  const path = require('node:path');
  const csv = fs.readFileSync(path.resolve(__dirname, '..', 'config', 'CSV', 'game_parameters.csv'), 'utf8');
  const ctx = fresh();
  const cell = (name, i) => {
    const row = csv.split(/\r?\n/).find((l) => l.startsWith('') && l.includes(',10-離線,' + name + ','));
    assert.ok(row, `參數表找不到 10-離線 / ${name}`);
    /* 逗號可能出現在被引號包住的說明欄，用同一套 RFC-4180 規則切。 */
    const out = []; let f = '', q = false;
    for (let k = 0; k < row.length; k++) {
      const c = row[k];
      if (q) { if (c === '"') { if (row[k + 1] === '"') { f += '"'; k++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { out.push(f); f = ''; }
      else f += c;
    }
    out.push(f);
    return Number(out[6 + i]);            // 參數a 是第 7 欄（索引 6）
  };
  assert.equal(cell('有效離線時間', 0), ctx.OFFLINE_MAX_HOURS);
  assert.equal(cell('計算等級', 0), ctx.OFFLINE_LEVEL_REDUCE);
  assert.equal(cell('擊殺速率', 0), ctx.OFFLINE_KILL_INTERVAL);
});

test('取整單位可調，設 1 等於不取整', () => {
  const ctx = fresh();
  ctx.OFFLINE_STAGE_ROUND = 1;
  assert.equal(ctx.offlineStageFor(188), 178, '188 − 10 = 178，不再捨去到 170');
  ctx.OFFLINE_STAGE_ROUND = 50;
  assert.equal(ctx.offlineStageFor(188), 150, '捨去到 50 的倍數');
});

test('關卡比例可調，用來整體壓低或拉高離線關卡', () => {
  const ctx = fresh();
  ctx.OFFLINE_STAGE_RATIO = 0.5;
  assert.equal(ctx.offlineStageFor(188), 80, '188 × 0.5 − 10 = 84 → 捨去到 80');
  ctx.OFFLINE_STAGE_RATIO = 1.5;
  assert.equal(ctx.offlineStageFor(188), 270, '188 × 1.5 − 10 = 272 → 捨去到 270');
});

test('取整單位或比例被填成 0 時退化成合理值，不會算出 NaN', () => {
  /* 這是配置檔最常見的手誤：欄位留白在 CSV 裡就是 0。
     除以 0 會得到 Infinity，Math.floor(Infinity) × 0 是 NaN，
     而 NaN 一路傳到 monsterStatsFor 只會產出一份全是 NaN 的離線收益——不會報錯。 */
  const a = fresh();
  a.OFFLINE_STAGE_ROUND = 0;
  assert.equal(a.offlineStageFor(188), 178, '取整單位 0 應退化成 1（不取整）');

  const b = fresh();
  b.OFFLINE_STAGE_RATIO = 0;
  assert.equal(b.offlineStageFor(188), 170, '比例 0 應退化成 1（不打折）');

  const c = fresh();
  c.OFFLINE_STAGE_ROUND = -5;
  c.OFFLINE_STAGE_RATIO = -2;
  assert.ok(Number.isFinite(c.offlineStageFor(188)), '負值不得產生 NaN');
});

test('下限永遠是關卡 1', () => {
  const ctx = fresh();
  for (const best of [1, 2, 9, 10]) assert.equal(ctx.offlineStageFor(best), 1);
  ctx.OFFLINE_STAGE_RATIO = 0.01;
  assert.equal(ctx.offlineStageFor(50), 1, '比例壓到很低也不會變成 0 或負數');
});

/* ---- 怪物種類 ---- */

test('怪物種類預設為菁英，與改動前相同', () => {
  const ctx = fresh();
  assert.equal(ctx.offlineUsesElite(), true);
  const m = ctx.monsterStatsFor(100, ctx.offlineUsesElite());
  assert.equal(m.elite, true);
  assert.equal(m.xp, ctx.monsterStatsFor(100, false).xp * 2, '菁英經驗是普通怪的 2 倍');
});

test('怪物種類設 0 時改用普通怪', () => {
  const ctx = fresh();
  ctx.OFFLINE_ELITE = 0;
  assert.equal(ctx.offlineUsesElite(), false);
});

test('實際跑一場：切成普通怪之後離線收益確實變少', () => {
  /* 經驗與掉落倍率都要跟著換。只換其中一邊的話會出現
     「普通怪的經驗、菁英怪的掉落倍率」這種說不通的組合。 */
  const run = (elite) => {
    const eng = createEngine({ seed: 4242 }).boot(null);
    eng.ctx.OFFLINE_ELITE = elite;
    eng.stepSeconds(120);
    return eng.offlineFor(8 * 3600);
  };
  const withElite = run(1);
  const withNormal = run(0);
  assert.ok(withElite && withNormal, '兩種設定都應該有離線收益');
  assert.equal(withElite.kills, withNormal.kills, '擊殺數只看時間，不隨怪物種類改變');
  assert.ok(withNormal.xp < withElite.xp,
    `普通怪的離線經驗應少於菁英（實得 普通 ${withNormal.xp} vs 菁英 ${withElite.xp}）`);
});
