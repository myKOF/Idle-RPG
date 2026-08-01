'use strict';
/* ============ 批次模擬：多 seed／多策略平行跑 ============

   單一次模擬是嚴格循序的（每一步都依賴前一步），沒有辦法平行化。
   但實際要回答的問題通常不是「這一次跑出什麼」，而是：
     - 這套策略的結果散佈有多大？（一次跑可能只是運氣好或運氣差）
     - A 策略和 B 策略哪個好？
   這兩個問題都是可以平行的，所以平行化放在**跑之間**，不是跑之內。

   每個子行程是完全獨立的 node 行程，各自帶自己的 seed，決定論不受影響——
   同樣的 seed 單獨跑或批次跑都會得到同一份存檔雜湊。

   ⚠️ 這不會縮短單一次模擬的等待時間。6 核最多同時 5 個，
   所以是「同樣時間內拿到 5 份結果」，不是「一份結果快 5 倍」。

   用法：
     node scripts/run_batch.js --hours=10 --seeds=5
     node scripts/run_batch.js --hours=10 --seeds=3 --policy=scripts/sim/policy.light.json,scripts/sim/policy.extreme.json
   選項：
     --hours=N          每次模擬的遊戲小時數（預設 1）
     --seeds=N          用 N 個seed（1..N）；也可寫 --seeds=7,11,13 指定
     --policy=a,b       策略檔，逗號分隔可多個（預設 policy.default.json）
     --concurrency=N    同時執行數（預設 CPU 核心數 - 1）
     --out=dir          輸出目錄（預設 sim_batch）
*/

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
}

const HOURS = Number(arg('hours', 1));
/* 轉送給每一個 run_sim.js。批次自己不解讀它的意思，但一定要轉送——
   不轉送的話旗標會被安靜吃掉，使用者以為跑的是全程在線，實際上跑的是班表。 */
const IGNORE_SCHEDULE = process.argv.includes('--ignore-schedule');
const OUT_DIR = path.resolve(ROOT, String(arg('out', 'sim_batch')));
const CONCURRENCY = Math.max(1, Number(arg('concurrency', Math.max(1, os.cpus().length - 1))));

/* seedBase：批次的起始 seed，往上連號取 N 個。
   ⚠️ 沒有這個參數時本檔是寫死從 1 開始數的，於是同樣張數的批次每次跑出來
   一模一樣——批次的意義本來就是看散佈，結果每次看到的是同一份散佈。 */
const SEED_BASE = Math.max(1, Math.floor(Number(arg('seedBase', 1))) || 1);
const seedSpec = String(arg('seeds', '5'));
const SEEDS = seedSpec.includes(',')
  ? seedSpec.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
  : Array.from({ length: Number(seedSpec) }, (_, i) => SEED_BASE + i);

const POLICIES = String(arg('policy', 'scripts/sim/policy.default.json'))
  .split(',').map((s) => s.trim()).filter(Boolean);

/* 每個 (策略 × seed) 是一個獨立工作。 */
const jobs = [];
for (const policy of POLICIES) {
  for (const seed of SEEDS) {
    const tag = path.basename(policy, '.json').replace(/^policy\./, '') + '-seed' + seed;
    jobs.push({ policy, seed, tag, out: path.join(OUT_DIR, tag) });
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });

console.log(`批次模擬：${POLICIES.length} 個策略 × ${SEEDS.length} 個 seed = ${jobs.length} 次`);
console.log(`每次 ${HOURS} 遊戲小時，同時執行 ${CONCURRENCY} 個（CPU ${os.cpus().length} 核）\n`);

const results = [];
let started = 0;
let finished = 0;
const t0 = Date.now();

/* 執行中的子行程，供中止用。批次自己被 kill 掉時要一併帶走底下的模擬，
   否則會留下一堆沒人管的孤兒行程繼續吃 CPU——伺服器的取消鈕殺的是這支批次，
   不是它生出來的那些。 */
const liveChildren = new Set();
let aborted = false;

function abortAll(signal) {
  aborted = true;
  for (const c of liveChildren) {
    try { c.kill('SIGKILL'); } catch (e) {}
  }
  liveChildren.clear();
  console.log(`\n⏹️ 批次已中止（${signal}），已停止所有子模擬。`);
  process.exit(130);
}
process.on('SIGTERM', () => abortAll('SIGTERM'));
process.on('SIGINT', () => abortAll('SIGINT'));

function runJob(job) {
  return new Promise((resolve) => {
    const childArgs = [
      '--max-semi-space-size=64',
      path.join(ROOT, 'scripts', 'run_sim.js'),
      `--hours=${HOURS}`, `--seed=${job.seed}`,
      `--policy=${job.policy}`, `--out=${job.out}`
    ];
    if (IGNORE_SCHEDULE) childArgs.push('--ignore-schedule');
    const child = spawn(process.execPath, childArgs, { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
    liveChildren.add(child);

    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      liveChildren.delete(child);
      if (aborted) return resolve({ job, code: 130, stderr: '' });
      finished++;
      const mark = code === 0 ? '✅' : '❌';
      console.log(`  ${mark} [${finished}/${jobs.length}] ${job.tag}${code === 0 ? '' : '  退出碼 ' + code}`);
      if (code !== 0 && stderr) console.log('     ' + stderr.trim().split('\n').slice(0, 3).join('\n     '));
      resolve({ job, code, stderr });
    });
  });
}

/* 固定並行度的工作佇列：一個結束就補下一個，不用等整批。 */
async function main() {
  const running = new Set();
  for (const job of jobs) {
    while (running.size >= CONCURRENCY) await Promise.race(running);
    started++;
    const p = runJob(job).then((r) => { running.delete(p); results.push(r); return r; });
    running.add(p);
  }
  await Promise.all(running);

  const elapsed = (Date.now() - t0) / 1000;
  const failed = results.filter((r) => r.code !== 0);

  /* ---- 彙整 ----
     ⚠️ 這裡算的是**跨次模擬的統計量**（中位數／極值），不是遊戲數值。
     每一個輸入值都直接取自各次的 run_summary.json，這一層不做任何遊戲計算。 */
  const rows = [];
  for (const { job, code } of results) {
    if (code !== 0) continue;
    const f = path.join(job.out, 'run_summary.json');
    if (!fs.existsSync(f)) continue;
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    const ls = s.lootStats || {};
    rows.push({
      policy: path.basename(job.policy, '.json'),
      seed: job.seed,
      /* 這一次的輸出子目錄（相對於批次目錄）。讓讀 batch_summary.json 的人
         不必自己重推命名規則——推錯了只會得到「載不到檔案」這種難查的症狀。 */
      dir: path.basename(job.out),
      level: s.final.level, stage: s.final.stage,
      atk: s.final.atk, matk: s.final.matk,
      kills: ls.kills || 0, deaths: ls.deaths || 0,
      cumGold: ls.gold || 0,
      speedupX: s.performance.speedupX,
      hash: s.determinism.finalStateHash.slice(0, 12)
    });
  }

  function stat(list, key) {
    const v = list.map((r) => Number(r[key]) || 0).sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return { min: v[0], median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, max: v[v.length - 1] };
  }

  const byPolicy = {};
  for (const r of rows) (byPolicy[r.policy] = byPolicy[r.policy] || []).push(r);

  console.log('\n──────── 各次結果 ────────');
  console.log('策略'.padEnd(22) + 'seed'.padStart(6) + '等級'.padStart(7) + '關卡'.padStart(7) +
              '物攻'.padStart(9) + '擊殺'.padStart(9) + '死亡'.padStart(7) + '  存檔雜湊');
  for (const r of rows) {
    console.log(r.policy.padEnd(22) + String(r.seed).padStart(6) + String(r.level).padStart(7) +
      String(r.stage).padStart(7) + String(r.atk).padStart(9) + String(r.kills).padStart(9) +
      String(r.deaths).padStart(7) + '  ' + r.hash);
  }

  console.log('\n──────── 跨 seed 散佈（最小 / 中位數 / 最大）────────');
  for (const [pol, list] of Object.entries(byPolicy)) {
    console.log(`\n${pol}（${list.length} 個 seed）`);
    for (const key of ['level', 'stage', 'atk', 'kills', 'deaths']) {
      const s = stat(list, key);
      if (s) console.log('  ' + key.padEnd(8) + `${s.min} / ${s.median} / ${s.max}`);
    }
  }

  const summaryFile = path.join(OUT_DIR, 'batch_summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify({
    hours: HOURS, policies: POLICIES, seeds: SEEDS, concurrency: CONCURRENCY,
    outDir: path.relative(ROOT, OUT_DIR).replace(/\\/g, '/'),
    elapsedSec: +elapsed.toFixed(1), failed: failed.length,
    說明: 'rows 為各次模擬的原生結果；spread 為跨次統計量（不是遊戲數值）。',
    rows,
    spread: Object.fromEntries(Object.entries(byPolicy).map(([p, list]) => [p,
      Object.fromEntries(['level', 'stage', 'atk', 'kills', 'deaths'].map((k) => [k, stat(list, k)]))]))
  }, null, 2));

  console.log(`\n總耗時 ${elapsed.toFixed(1)}s（${jobs.length} 次模擬，同時 ${CONCURRENCY} 個）`);
  console.log(`彙整 ${path.relative(ROOT, summaryFile)}`);
  if (failed.length) {
    console.log(`\n❌ ${failed.length} 次失敗：${failed.map((r) => r.job.tag).join(', ')}`);
    process.exit(1);
  }
}

main();
