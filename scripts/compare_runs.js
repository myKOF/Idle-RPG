'use strict';
/* ============ 兩場模擬的曲線對照 ============

   把「真人那一場」與「AI 那一場」的 snapshots.csv 疊在一起相減。

   存在的理由：在這支之前，「AI 跑起來跟真人有落差」是一句沒辦法追下去的話——
   不知道差多少、不知道從哪一段開始差、不知道是哪個子系統造成的。這支把它變成
   「Lv.30 之前 AI 快 1.4 倍，之後拉開到 3.2 倍，而死亡數是真人的 1/20」這種
   可以定位的敘述。

   用法：
     node scripts/compare_runs.js <基準目錄> <對照目錄>
     node scripts/compare_runs.js sim_out_human sim_out_ai

   基準通常放真人（用 run_sim.js --trace 產出），對照放 AI 策略。兩邊都是同一支
   run_sim.js 產出的目錄，欄位與格式因此天生一致——這正是軌跡重播不另寫回放腳本的原因。

   ---- 只在重疊區間比 ----

   真人錄製通常只有幾小時，AI 動輒跑一百小時。超出重疊範圍的部分不比、也不外插
   （snapshots.meta.json 寫得很清楚：圖表層不得再計算任何衍生值，這裡同樣遵守）。 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR_A = process.argv[2];
const DIR_B = process.argv[3];

if (!DIR_A || !DIR_B) {
  console.error('用法：node scripts/compare_runs.js <基準目錄> <對照目錄>');
  console.error('例如：node scripts/compare_runs.js sim_out_human sim_out_ai');
  process.exit(1);
}

/* ---- 讀取 ---- */

function readRun(dir) {
  const base = path.resolve(ROOT, dir);
  const csvPath = path.join(base, 'snapshots.csv');
  const sumPath = path.join(base, 'run_summary.json');
  if (!fs.existsSync(csvPath)) {
    console.error(`找不到 ${path.relative(ROOT, csvPath)}——這個目錄不是 run_sim.js 的輸出。`);
    process.exit(1);
  }
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  const cols = lines[0].split(',');
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    for (let i = 0; i < cols.length; i++) {
      const n = Number(cells[i]);
      row[cols[i]] = Number.isFinite(n) ? n : null;
    }
    return row;
  });
  const summary = fs.existsSync(sumPath)
    ? JSON.parse(fs.readFileSync(sumPath, 'utf8')) : null;
  return { dir: path.relative(ROOT, base), cols, rows, summary };
}

const A = readRun(DIR_A);
const B = readRun(DIR_B);

function label(run) {
  const s = run.summary;
  if (!s) return run.dir;
  if (s.trace) return `${run.dir}（真人軌跡，錄於 ${s.trace.recordedAt || '?'}）`;
  return `${run.dir}（策略 ${s.policy ? s.policy.name : '?'}）`;
}

console.log('\n基準 A  ' + label(A));
console.log('對照 B  ' + label(B));

/* 種子不同 = 兩場的運氣不同。曲線差異裡有一部分只是運氣，不是策略。
   這件事必須講在最前面，否則後面每一個數字都會被過度解讀。 */
const seedA = A.summary && A.summary.seed;
const seedB = B.summary && B.summary.seed;
if (seedA !== undefined && seedB !== undefined && seedA !== seedB) {
  console.log(`\n⚠️ 兩場的 seed 不同（A=${seedA}, B=${seedB}）。曲線差異包含運氣成分，`);
  console.log('   單場比對只能看趨勢；要下定論請用同一個 seed，或多跑幾個 seed 取分佈。');
}

/* 起始存檔不同 = 起跑點不同，之後的絕對值一律不可比。 */
const startA = A.summary && A.summary.startSave;
const startB = B.summary && B.summary.startSave;
if (String(startA) !== String(startB)) {
  console.log(`\n⚠️ 起始存檔不同（A=${startA}, B=${startB}）。兩條曲線的起跑點不一樣，`);
  console.log('   絕對值不可直接比，請看「達標時間」那一段的相對倍率。');
}

if (A.summary && A.summary.trace && A.summary.trace.remaining) {
  console.log(`\n⚠️ A 的真人軌跡還有 ${A.summary.trace.remaining} 道指令沒送出，這一場沒重播完，不宜用來下結論。`);
}

/* ---- 對齊 ----
   兩邊的 gameHours 格點來自同一支 run_sim.js 的 --snap-min，正常情況下天生對齊。
   不對齊時取最近的一筆，超過半格就當作沒有對應點——不內插。 */

function stepOf(rows) {
  if (rows.length < 2) return 0;
  return Math.abs(rows[1].gameHours - rows[0].gameHours);
}

const stepA = stepOf(A.rows);
const stepB = stepOf(B.rows);
const tol = Math.max(stepA, stepB) / 2 || 1e-9;

if (stepA && stepB && Math.abs(stepA - stepB) > 1e-9) {
  console.log(`\n註：兩邊的快照間隔不同（A ${(stepA * 60).toFixed(1)} 分、B ${(stepB * 60).toFixed(1)} 分），` +
    `以最近點配對，容差 ${(tol * 60).toFixed(1)} 分。`);
}

function nearest(rows, hours) {
  let best = null, bestD = Infinity;
  for (const r of rows) {
    const d = Math.abs(r.gameHours - hours);
    if (d < bestD) { bestD = d; best = r; }
  }
  return bestD <= tol ? best : null;
}

const endA = A.rows.length ? A.rows[A.rows.length - 1].gameHours : 0;
const endB = B.rows.length ? B.rows[B.rows.length - 1].gameHours : 0;
const overlapEnd = Math.min(endA, endB);

console.log(`\nA 涵蓋 0 ~ ${endA.toFixed(2)}h（${A.rows.length} 筆）　B 涵蓋 0 ~ ${endB.toFixed(2)}h（${B.rows.length} 筆）`);
console.log(`重疊區間 0 ~ ${overlapEnd.toFixed(2)}h　以下只比這一段。`);

if (overlapEnd <= 0) {
  console.error('\n❌ 沒有重疊區間，無從比對。');
  process.exit(1);
}

/* ---- (1) 重疊區終點的並排 ---- */

/* 這幾欄是進度的主軸，排在前面。其餘共同數值欄位照樣列，只是排在後面——
   預先挑欄位等於預先決定哪些落差不值得看。 */
const HEADLINE = ['level', 'stage', 'dps', 'atk', 'matk', 'def', 'gold',
  'totalKills', 'totalDeaths', 'totalDrops', 'cumGold', 'invCount', 'towerFloor', 'reincarnations'];

const shared = A.cols.filter((c) => B.cols.includes(c) && c !== 'gameHours');
const ordered = HEADLINE.filter((c) => shared.includes(c))
  .concat(shared.filter((c) => !HEADLINE.includes(c)));

const rowA = nearest(A.rows, overlapEnd);
const rowB = nearest(B.rows, overlapEnd);

function fmt(v) {
  if (v === null || v === undefined) return '—';
  if (Math.abs(v) >= 1e6) return v.toExponential(2);
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

function ratio(a, b) {
  if (a === null || b === null) return '—';
  if (a === 0 && b === 0) return '1.00x';
  if (a === 0) return '∞';
  return (b / a).toFixed(2) + 'x';
}

console.log(`\n──────── 重疊區終點 ${overlapEnd.toFixed(2)}h 的並排 ────────`);
console.log('欄位'.padEnd(18) + 'A(基準)'.padStart(14) + 'B(對照)'.padStart(14) + 'B/A'.padStart(10));
if (rowA && rowB) {
  for (const c of ordered) {
    console.log(c.padEnd(18) + fmt(rowA[c]).padStart(14) + fmt(rowB[c]).padStart(14) + ratio(rowA[c], rowB[c]).padStart(10));
  }
} else {
  console.log('（重疊終點沒有可配對的快照，兩邊的格點差太多）');
}

/* ---- (2) 達標時間 ----
   絕對值受起跑點影響，達標時間不受。「真人 3.2 小時到 Lv.30，AI 1.1 小時」
   這種說法可以直接對應到體感。 */

function firstReach(rows, col, target) {
  for (const r of rows) {
    if (r[col] !== null && r[col] >= target) return r.gameHours;
  }
  return null;
}

function milestoneTable(col, title) {
  const maxA = Math.max(...A.rows.map((r) => r[col] || 0));
  const maxB = Math.max(...B.rows.filter((r) => r.gameHours <= overlapEnd + tol).map((r) => r[col] || 0));
  const top = Math.max(maxA, maxB);
  if (!Number.isFinite(top) || top <= 0) return;

  /* 里程碑取整數刻度，數量控制在 10 個上下，避免長到看不完。 */
  const startV = Math.max(1, Math.ceil(Math.min(
    A.rows[0] ? A.rows[0][col] || 1 : 1,
    B.rows[0] ? B.rows[0][col] || 1 : 1
  )));
  const span = top - startV;
  if (span <= 0) return;
  const stepRaw = span / 10;
  const mag = Math.pow(10, Math.floor(Math.log10(stepRaw || 1)));
  const step = Math.max(1, Math.round(stepRaw / mag) * mag);

  console.log(`\n──────── 達標時間：${title} ────────`);
  console.log('目標'.padEnd(12) + 'A 達標(h)'.padStart(12) + 'B 達標(h)'.padStart(12) + 'B/A'.padStart(10));
  for (let v = startV + step; v <= top + 1e-9; v += step) {
    const ta = firstReach(A.rows, col, v);
    const tb = firstReach(B.rows, col, v);
    /* 只列 A 在重疊區內達成的目標。A 沒達成的目標，B 達成得再快也沒有比較基準。 */
    if (ta === null || ta > overlapEnd + tol) continue;
    const r = (ta && tb) ? (tb / ta).toFixed(2) + 'x' : '—';
    console.log(String(v).padEnd(12) +
      (ta === null ? '未達' : ta.toFixed(2)).padStart(12) +
      (tb === null ? '未達' : tb.toFixed(2)).padStart(12) +
      r.padStart(10));
  }
  console.log('  B/A < 1 代表 B 比 A 早達標（B 更快）。');
}

milestoneTable('level', '等級');
milestoneTable('stage', '關卡');

/* ---- (3) 落差最大的轉折點 ----
   落差通常不是均勻的。找出比值變化最劇烈的那一段，那裡才是該去追的子系統。 */

function turningPoint(col) {
  let worst = null;
  for (const ra of A.rows) {
    if (ra.gameHours > overlapEnd + tol) break;
    if (ra.gameHours <= 0) continue;
    const rb = nearest(B.rows, ra.gameHours);
    if (!rb || ra[col] === null || rb[col] === null || ra[col] === 0) continue;
    const r = rb[col] / ra[col];
    if (!worst || Math.abs(Math.log(r || 1e-9)) > Math.abs(Math.log(worst.r || 1e-9))) {
      worst = { hours: ra.gameHours, a: ra[col], b: rb[col], r: r };
    }
  }
  return worst;
}

console.log('\n──────── 落差最大的時點 ────────');
for (const c of ['level', 'stage', 'dps', 'totalDeaths']) {
  if (!shared.includes(c)) continue;
  const t = turningPoint(c);
  if (!t) { console.log(`${c.padEnd(14)}（沒有可配對的點）`); continue; }
  console.log(`${c.padEnd(14)} ${t.hours.toFixed(2)}h　A ${fmt(t.a)} vs B ${fmt(t.b)}　B/A ${t.r.toFixed(2)}x`);
}

/* ---- (4) 累積統計 ----
   snapshots.csv 的資源欄位是「目前持有」，會因消耗而下降；累積量在 run_summary 的
   lootStats（snapshots.meta.json 的提醒欄寫過這件事，兩者混用會得到嚴重偏低的數字）。
   ⚠️ 這一段涵蓋的是**各自的整場**，不是重疊區間——lootStats 只有終值，沒有時間軸。 */

if (A.summary && B.summary && A.summary.lootStats && B.summary.lootStats) {
  const la = A.summary.lootStats, lb = B.summary.lootStats;
  console.log(`\n──────── 累積統計（各自整場：A ${endA.toFixed(2)}h／B ${endB.toFixed(2)}h，非重疊區）────────`);
  console.log('項目'.padEnd(18) + 'A(基準)'.padStart(14) + 'B(對照)'.padStart(14));
  for (const k of ['battles', 'kills', 'deaths', 'dropRolls', 'gold']) {
    if (typeof la[k] !== 'number' && typeof lb[k] !== 'number') continue;
    console.log(k.padEnd(18) + fmt(la[k] ?? null).padStart(14) + fmt(lb[k] ?? null).padStart(14));
  }
  /* 掉落裝備的品質分佈：AI 與真人在「穿到什麼品質」上的差距，往往比等級差距更能解釋落差。 */
  const names = (A.summary.rarityNames || B.summary.rarityNames || []);
  if (names.length && (la.equip || lb.equip)) {
    console.log('\n掉落裝備品質分佈（件數）');
    for (const r of names) {
      const va = la.equip ? (la.equip[r.index] || 0) : 0;
      const vb = lb.equip ? (lb.equip[r.index] || 0) : 0;
      if (!va && !vb) continue;
      console.log(('  ' + r.name).padEnd(18) + fmt(va).padStart(14) + fmt(vb).padStart(14));
    }
  }
}

/* ---- 落地 ----
   文字給人看，JSON 給儀表板讀。兩者的數字來自同一次計算，不會各算各的。 */
const outPath = path.resolve(ROOT, 'compare_runs.json');
fs.writeFileSync(outPath, JSON.stringify({
  a: { dir: A.dir, endHours: endA, seed: seedA, rows: A.rows.length },
  b: { dir: B.dir, endHours: endB, seed: seedB, rows: B.rows.length },
  overlapHours: overlapEnd,
  atOverlapEnd: (rowA && rowB) ? ordered.map((c) => ({
    field: c, a: rowA[c], b: rowB[c], ratio: (rowA[c] ? rowB[c] / rowA[c] : null)
  })) : [],
  turning: ['level', 'stage', 'dps', 'totalDeaths']
    .filter((c) => shared.includes(c))
    .map((c) => ({ field: c, point: turningPoint(c) }))
}, null, 2));

console.log(`\n輸出  ${path.relative(ROOT, outPath)}`);
console.log('提醒  重疊區間以外的部分沒有比對，也沒有外插。');
