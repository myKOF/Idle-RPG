'use strict';
/* ============ 瀏覽器 ↔ headless 交叉驗證 ============

   證明 headless 模擬器沒有偷算的最後一道：同一個 seed，真瀏覽器（真 index.html、
   真 Worker、真 IndexedDB）與 headless 各跑一段，逐檢查點比對 buildView() 輸出。
   任何一點不同，就代表兩邊有一邊不是在跑同一個遊戲。

   ⚠️ 前提：瀏覽器端必須以 `?seed=N` 開啟決定論測試模式（見 js/worker/sim.worker.js
   檔頭 installTestSeed）。沒有它，比對在結構上做不到——正式路徑每輪會走一個不足 0.1 秒的
   殘步，而殘步長度取決於真實計時器抖動，連「同一個瀏覽器跑兩次」都不會一樣。
   測試模式與正式遊玩的差異就是這一項（殘步 + 維護區塊改以步數計時），必須連同結果一起說明。

   用法：
     1. 開伺服器，瀏覽器開 http://127.0.0.1:PORT/index.html?seed=777
     2. 在頁面上收集 tick 的 view，存成 JSON 陣列檔
     3. node scripts/cross_check.js <browser_rows.json> [seed]

   比對鍵是 view.gt（遊戲時間，0.1 的倍數），不是真實時間——兩邊的真實速度本來就不同。 */

const fs = require('fs');
const path = require('path');
const { createEngine } = require('./sim/engine');

const ROWS_PATH = process.argv[2];
const SEED = Number(process.argv[3] || 777);

if (!ROWS_PATH) {
  console.error('用法：node scripts/cross_check.js <browser_rows.json> [seed]');
  process.exit(1);
}

const browserRows = JSON.parse(fs.readFileSync(path.resolve(ROWS_PATH), 'utf8'));
if (!browserRows.length) { console.error('瀏覽器樣本是空的'); process.exit(1); }

/* gt 是浮點累加（GT += 0.1），必然有尾差，四捨五入到 0.1 當鍵。 */
const key = (gt) => (Math.round(gt * 10) / 10).toFixed(1);

const browserByGt = new Map();
for (const r of browserRows) browserByGt.set(key(r.gt), r);

const maxGt = Math.max(...browserRows.map((r) => r.gt));
console.log(`\n瀏覽器樣本 ${browserRows.length} 筆，涵蓋遊戲時間 ${Math.min(...browserRows.map(r => r.gt)).toFixed(1)}s ~ ${maxGt.toFixed(1)}s`);

/* headless 以同樣節奏跑：每 2 步（＝TICK_EMIT_MS/TICK_MS）取一次 view，
   對應瀏覽器 deterministicLoop 的維護＋emit 節奏。 */
const eng = createEngine({ seed: SEED }).boot(null);
const headlessByGt = new Map();
const totalSteps = Math.ceil((maxGt + 1) / eng.dt);
for (let i = 0; i < totalSteps; i += 2) {
  eng.step(2);
  const v = eng.view();
  headlessByGt.set(key(v.gt), v);
}

/* 只比兩邊都有的檢查點。瀏覽器的收集器是在頁面開起來之後才掛上的，
   前面幾筆本來就抓不到，那不是不一致。 */
const shared = [...browserByGt.keys()].filter((k) => headlessByGt.has(k)).sort((a, b) => a - b);
console.log(`headless 檢查點 ${headlessByGt.size} 筆，共同檢查點 ${shared.length} 筆\n`);

const IGNORE = new Set([]);   // 目前沒有需要豁免的欄位；有的話必須在這裡具名並說明理由
let mismatches = 0;
let firstMismatch = null;

for (const k of shared) {
  const b = browserByGt.get(k);
  const h = headlessByGt.get(k);
  const diffs = [];
  const keys = new Set([...Object.keys(b), ...Object.keys(h)]);
  for (const f of keys) {
    if (IGNORE.has(f)) continue;
    if (JSON.stringify(b[f]) !== JSON.stringify(h[f])) {
      diffs.push(`${f}: 瀏覽器 ${JSON.stringify(b[f])} ≠ headless ${JSON.stringify(h[f])}`);
    }
  }
  if (diffs.length) {
    mismatches++;
    if (!firstMismatch) firstMismatch = { gt: k, diffs };
  }
}

console.log('──────── 結論 ────────');
if (mismatches === 0) {
  console.log(`✅ PASS  ${shared.length} 個共同檢查點的 buildView() 完全一致`);
  console.log('   headless 跑的就是瀏覽器裡那個遊戲。');
  process.exit(0);
} else {
  console.log(`❌ FAIL  ${shared.length} 個檢查點中有 ${mismatches} 個不一致`);
  console.log(`   最早不一致於 gt=${firstMismatch.gt}s：`);
  firstMismatch.diffs.slice(0, 12).forEach((d) => console.log('     ' + d));
  console.log('\n   最早的那一點才是線索——之後的不一致都是它的後果。');
  process.exit(1);
}
