'use strict';
/**
 * tools/sim_server.cjs
 * 支援 API 呼叫原生模擬器 (POST /run_sim)、即時進度查詢 (GET /sim_progress) 與靜態檔案託管
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 28342;

let currentProgress = {
  isSimulating: false,
  percent: 0,
  currentHour: 0,
  totalHours: 100,
  statusText: '準備中...'
};

/* 執行中的模擬子行程。一定要留著參照，否則沒有任何辦法中止——
   先前不小心送出 500 小時的請求就只能等它跑完或去工作管理員砍行程。 */
let currentChild = null;

/* ---- 瀏覽器心跳看門狗 ----
   儀表板本來就在輪詢 /sim_progress，直接拿它當心跳：頁面關掉就沒人來問，
   超過門檻仍在跑就中止。頁面 unload 時另外會用 sendBeacon 主動送 /cancel_sim，
   那條是正常關閉的即時路徑；看門狗負責瀏覽器當掉、斷電、強制關閉這些收不到通知的情況。

   ⚠️ 門檻刻意放到 90 秒：分頁切到背景時瀏覽器會把計時器降頻到每分鐘一次，
   門檻太短會在使用者只是切去別的分頁時誤砍模擬。 */
const WATCHDOG_MS = 90000;
let lastPollAt = 0;

setInterval(() => {
  if (!currentProgress.isSimulating || !currentChild) return;
  if (lastPollAt && Date.now() - lastPollAt > WATCHDOG_MS) {
    stopCurrentSim('儀表板已關閉（超過 ' + (WATCHDOG_MS / 1000) + ' 秒沒有心跳）');
  }
}, 5000).unref();

function stopCurrentSim(reason) {
  if (!currentChild) return false;
  const child = currentChild;
  currentChild = null;
  /* 先送 SIGTERM，2 秒後仍在就 SIGKILL。
     Windows 的 SIGTERM 其實等同強制終止，但保留這個順序讓 POSIX 上行為一致。 */
  try { child.kill('SIGTERM'); } catch (e) {}
  setTimeout(() => { try { if (!child.killed) child.kill('SIGKILL'); } catch (e) {} }, 2000);
  currentProgress.isSimulating = false;
  currentProgress.statusText = '⏹️ ' + (reason || '模擬已取消');
  console.log('⏹️ 模擬已取消：' + (reason || '使用者要求'));
  return true;
}

/* ---- 批次進度：逐一收集每個 seed 自己的進度 ----
   run_batch.js 本身不寫進度檔，但它生出來的每個子模擬都會在自己的輸出目錄寫一份
   sim_progress.json。把那些檔案收集起來就能同時看到每個 seed 各自跑到哪，
   而不是只有「幾份跑完了」這種粗顆粒——十個 seed 各跑 10 小時的話，
   粗顆粒進度會卡在 0% 好幾分鐘，看起來像當掉。 */
function collectBatchProgress(dir) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return out; }
  for (const name of names) {
    const sub = path.join(dir, name);
    try { if (!fs.statSync(sub).isDirectory()) continue; } catch (e) { continue; }

    const done = fs.existsSync(path.join(sub, 'run_summary.json'));
    let p = null;
    try { p = JSON.parse(fs.readFileSync(path.join(sub, 'sim_progress.json'), 'utf8')); } catch (e) {}

    out.push({
      tag: name,
      /* seed 由子行程自己寫進進度檔；讀不到才退回從目錄名推。
         推命名規則只能當最後手段——規則改了會安靜地推錯。 */
      seed: (p && p.seed != null) ? p.seed : (((/-seed(\d+)$/.exec(name) || [])[1]) || null),
      /* 跑完的一律算 100%：最後一次快照不會剛好落在終點，
         照著進度檔顯示會讓已完成的 seed 停在 99.x%。 */
      percent: done ? 100 : ((p && p.percent) || 0),
      currentHour: (p && p.currentHour) || 0,
      level: (p && p.level) || 0,
      stage: (p && p.stage) || 0,
      done
    });
  }
  return out;
}

const server = http.createServer((req, res) => {
  const urlParts = req.url.split('?');
  const pathname = urlParts[0];

  // 1. 查詢即時模擬進度 API (直接讀取落地進度檔，徹底擺脫 Node stdout buffer 延遲)
  if (req.method === 'GET' && pathname === '/sim_progress') {
    /* 這支輪詢同時當作瀏覽器的心跳：頁面被關掉就不會再有人來問，
       看門狗據此中止模擬（見下方 WATCHDOG_MS）。 */
    lastPollAt = Date.now();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    
    if (currentProgress.isSimulating && currentProgress.batch) {
      /* 批次模式：讀每個 seed 自己的進度檔。用檔案而不是解析子行程 stdout——
         輸出格式改了不會把進度弄壞。 */
      const seeds = collectBatchProgress(path.join(ROOT, currentProgress.outDir));
      const total = currentProgress.batch.total;
      const done = seeds.filter((s) => s.done).length;
      /* 還沒開始的沒有目錄（工作佇列有並行上限，不是一次全部開跑）。 */
      const queued = Math.max(0, total - seeds.length);

      /* 整體進度取所有 seed 的平均，尚未開始的算 0。
         比只數「跑完幾份」細得多，也才對得上畫面上那條總進度條。 */
      const sum = seeds.reduce((a, s) => a + s.percent, 0);
      currentProgress.percent = total ? Math.round(sum / total) : 0;
      currentProgress.batch.done = done;
      currentProgress.batch.running = seeds.length - done;
      currentProgress.batch.queued = queued;
      /* 只回最接近完成的前 10 個：seed 數可以開到 32，全部塞進畫面反而看不出重點。
         被截掉的仍計入上面的統計數字，不會被藏起來。 */
      currentProgress.batch.seeds = seeds.sort((a, b) => b.percent - a.percent).slice(0, 10);
      currentProgress.statusText = `⏳ 批次模擬 ${done} / ${total} 次完成`
        + `（執行中 ${seeds.length - done}、排隊 ${queued}，每次 ${currentProgress.totalHours} 小時）`;
    } else if (currentProgress.isSimulating) {
      const outDir = currentProgress.outDir || 'sim_out';
      const progressFile = path.join(ROOT, outDir, 'sim_progress.json');
      if (fs.existsSync(progressFile)) {
        try {
          const fileData = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
          currentProgress.percent = fileData.percent || 0;
          currentProgress.currentHour = fileData.currentHour || 0;
          currentProgress.statusText = `⏳ 已模擬 ${fileData.currentHour.toFixed(1)} / ${currentProgress.totalHours} 小時 (${fileData.percent}%)... [Lv.${fileData.level || 1}]`;
        } catch (e) {}
      }
    }
    return res.end(JSON.stringify(currentProgress));
  }

  // 1.5 取消執行中的模擬
  if (req.method === 'POST' && pathname === '/cancel_sim') {
    const stopped = stopCurrentSim('使用者取消');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({
      ok: true, stopped,
      message: stopped ? '已中止執行中的模擬' : '目前沒有執行中的模擬'
    }));
  }

  // 2. 觸發原生模擬 API
  if (req.method === 'POST' && pathname === '/run_sim') {
    /* 保險：狀態顯示執行中但子行程已經不在（例如被外部砍掉），直接放行，
       否則使用者會被一個永遠不會結束的假狀態鎖死。 */
    if (currentProgress.isSimulating && !currentChild) {
      currentProgress.isSimulating = false;
      currentProgress.statusText = '⚠️ 前一次模擬已不在執行中，狀態已重置';
    }
    if (currentProgress.isSimulating) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, message: '已有模擬任務在執行中，請稍候...' }));
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let params = { hours: 100, seed: 20260730, policy: 'scripts/sim/policy.default.json', out: 'sim_out',
                     ignoreSchedule: false };
      try {
        if (body) {
          const parsed = JSON.parse(body);
          if (parsed.hours) params.hours = Number(parsed.hours);
          if (parsed.seed) params.seed = Number(parsed.seed);
          if (parsed.policy) params.policy = parsed.policy;
          if (parsed.out) params.out = parsed.out;
          if (parsed.seeds) params.seeds = Math.max(1, Math.floor(Number(parsed.seeds)));
          /* 忽略策略宣告的每日在線時數，全程在線。儀表板的「對照組」用它跑舊口徑那一半。 */
          params.ignoreSchedule = !!parsed.ignoreSchedule;
        }
      } catch (e) {
        /* ⚠️ 不能吞掉。先前是 catch(e){} 什麼都不做，於是請求內容壞掉時
           會靜默改用預設值（100 小時單跑）——使用者以為送出的是 1 小時 4 個 seed，
           實際跑的是完全不同的東西，而且沒有任何徵兆。 */
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ ok: false, message: '請求內容不是合法的 JSON：' + e.message }));
      }

      /* seeds > 1 走批次：同策略跑多個 seed，看結果散佈。
         單次模擬無法平行（每步都依賴前一步），所以平行化放在跑與跑之間。
         批次的輸出目錄與單跑分開，免得覆蓋掉上一份單跑結果。 */
      const isBatch = params.seeds > 1;
      if (isBatch && (!params.out || params.out === 'sim_out')) params.out = 'sim_batch';

      const outDirAbs = path.join(ROOT, params.out);
      const progressFile = path.join(outDirAbs, 'sim_progress.json');
      if (fs.existsSync(progressFile)) {
        try { fs.unlinkSync(progressFile); } catch (e) {}
      }

      /* 批次要先清乾淨舊結果，否則進度是用「已產出幾份 run_summary.json」數的，
         上一批留下來的檔案會讓進度一開始就不是 0。 */
      if (isBatch && fs.existsSync(outDirAbs)) {
        try { fs.rmSync(outDirAbs, { recursive: true, force: true }); } catch (e) {}
      }

      currentProgress = {
        isSimulating: true,
        percent: 0,
        currentHour: 0,
        totalHours: params.hours,
        /* 開始時間讓儀表板分得出「畫面上這份是剛跑的還是舊的」。
           重新整理頁面時也靠這個把時間補回去。 */
        startedAt: new Date().toISOString(),
        outDir: params.out,
        batch: isBatch ? { total: params.seeds } : null,
        statusText: isBatch
          ? `🚀 開始批次模擬（${params.seeds} 個 seed × ${params.hours} 小時）...`
          : `🚀 開始全系統原生內核模擬 (總時長 ${params.hours} 小時)...`
      };

      console.log(`\n🚀 [伺服器收到觸發請求] ${isBatch ? `批次 ${params.seeds} 個 seed` : `Seed ${params.seed}`}, 時數 ${params.hours}h`);

      const args = isBatch ? [
        path.join(ROOT, 'scripts/run_batch.js'),
        `--hours=${params.hours}`,
        `--seeds=${params.seeds}`,
        /* 批次也要吃畫面上那個 seed。先前沒傳，run_batch 就從 1 開始寫死連號，
           於是同樣張數的批次每次跑出來一模一樣——批次的意義是看散佈，
           結果每次看到的都是同一份散佈。 */
        `--seedBase=${params.seed}`,
        `--policy=${params.policy}`,
        `--out=${params.out}`
      ] : [
        '--max-semi-space-size=64',
        path.join(ROOT, 'scripts/run_sim.js'),
        `--hours=${params.hours}`,
        `--seed=${params.seed}`,
        `--policy=${params.policy}`,
        `--out=${params.out}`
      ];
      /* 旗標型參數要在陣列組好之後再加，批次與單跑共用同一個開關。 */
      if (params.ignoreSchedule) args.push('--ignore-schedule');

      /* stdout 直接丟棄（不是 'pipe'）：沒有人讀管線的話，子行程寫滿緩衝區就會卡死，
         而 run_sim.js 全程都在印進度。stderr 保留，錯誤要看得到。 */
      const child = spawn('node', args, { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
      currentChild = child;
      lastPollAt = Date.now();   // 給看門狗一個起點，避免開跑瞬間就被判定沒心跳

      child.stderr.on('data', data => { console.error(data.toString()); });

      child.on('close', code => {
        const wasCancelled = (currentChild !== child);   // stopCurrentSim 會先把參照清掉
        if (currentChild === child) currentChild = null;
        currentProgress.isSimulating = false;
        if (wasCancelled) return;                        // 取消時的狀態文字由 stopCurrentSim 設定
        if (code === 0) {
          currentProgress.percent = 100;
          currentProgress.currentHour = params.hours;
          currentProgress.statusText = isBatch
            ? `✅ 批次模擬完成（${params.seeds} 個 seed）`
            : '✅ 模擬 100% 完成！';
          console.log('✅ 模擬執行成功，已更新數據!');
        } else {
          currentProgress.statusText = `❌ 模擬失敗（退出碼 ${code}）`;
        }
      });

      /* ⚠️ 立刻回應，不等模擬跑完。
         先前是在 child close 時才 res.end()，於是瀏覽器那個 fetch 會一直掛著——
         送出 500 小時的請求就等於把分頁掛住好幾十分鐘，而且沒有取消的辦法。
         進度本來就由儀表板輪詢 /sim_progress 取得，這裡回 202 表示「已受理」即可。 */
      res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, accepted: true, hours: params.hours, seed: params.seed }));
    });
    return;
  }

  // 3. 靜態網頁託管
  let filePath = path.join(ROOT, pathname === '/' ? 'monte_carlo_app.html' : pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'text/html; charset=utf-8';
    if (ext === '.js') contentType = 'application/javascript; charset=utf-8';
    else if (ext === '.css') contentType = 'text/css; charset=utf-8';
    else if (ext === '.json') contentType = 'application/json; charset=utf-8';
    else if (ext === '.csv') contentType = 'text/csv; charset=utf-8';

    res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`=======================================================`);
  console.log(`🌐 放置型 RPG 模擬儀表板伺服器已啟動: http://127.0.0.1:${PORT}/`);
  console.log(`=======================================================`);
});
