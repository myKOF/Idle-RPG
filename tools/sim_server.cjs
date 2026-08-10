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

/* 連接埠：28342 起往上找第一個沒被占用的。

   為什麼要能換：28342 不是我們獨占的號碼，實測被別的工具搶走過
   （Codex 的 runtime kernel 就會聽這個埠）。搶走之後最糟的不是啟不起來，
   是**啟動器以為我們已經在跑**——它原本只檢查「這個埠有沒有回應」，
   對方回 200 就直接開瀏覽器，使用者看到的是一頁 404，完全看不出原因。

   所以兩件事一起做：換埠找得到位子，並且提供一個身分標記讓啟動器
   確認接電話的真的是我們。選定的埠寫進 sim_server.port 供啟動器讀取。 */
const PORT_BASE = 28342;
const PORT_TRIES = 10;
const PORT_FILE = path.join(ROOT, 'sim_server.port');
/* 身分標記。啟動器比對這個字串，不是比對「有沒有回應」。

   ⚠️ 標記必須帶上**服務的目錄**，光有專案名不夠。

   `D:\MyGame\Idle-RPG\` 底下有五份平行 worktree（claude／codex／antigravity／
   develop／production），每一份都有自己的「啟動數值模擬器.bat」，而標記若是常數，
   五份的回答完全一樣。於是從 claude 那份點啟動器時，只要 develop 的伺服器還開著，
   啟動器就會判定「已經在跑」並直接開瀏覽器——開進的是 **develop 的儀表板**，
   跑的是 develop 的程式碼。使用者會以為自己在測剛改好的東西。

   這不是假設，同一類的坑在 Live Server 的 5500 埠上實際發生過一次：
   在那裡驗證剛改的 js/worker/sim.worker.js，測出「修改沒生效」，
   查了半天才發現 5500 服務的根本不是那個工作目錄。

   加上路徑之後，不同 worktree 的伺服器互相不會被誤認，啟動器會自己往上找空的埠
   另外開一個。同一份目錄重複點啟動器仍然只會有一個伺服器（標記相同）。 */
const WHOAMI = 'idle-rpg-sim-server ' + ROOT;

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

   ⚠️⚠️ 門檻曾經是 90 秒，理由寫著「背景分頁會降頻到每分鐘一次，90 秒夠了」——
   **不夠**。實測把儀表板切到背景跑長時模擬，經常被誤判成「已關閉」而中止。

   Chrome 對背景分頁的節流有三段，而不是單一的「每分鐘一次」：
     隱藏約 10 秒後   計時器降到每秒一次
     隱藏 5 分鐘後    進入 intensive throttling，計時器**對齊到整分鐘**觸發，
                      實際間隔可能剛好等於或略超過 60 秒
     再往後           分頁可能被**凍結**（freeze），計時器完全停止

   也就是說 90 秒只比節流後的間隔多 30 秒的餘裕，抖動一下就破；
   一旦進入凍結，再長的門檻也擋不住，但那時使用者多半也不在乎了。

   看門狗真正的職責是「瀏覽器當掉／斷電／強制關閉」這種收不到通知的情況，
   而正常關閉走的是 pagehide 的 sendBeacon /cancel_sim（即時，不受節流影響）。
   所以門檻可以放得很寬——孤兒模擬多跑十分鐘沒有任何代價，
   而誤砍一個跑了兩小時的批次代價很大。 */
const WATCHDOG_MS = 600000;   // 10 分鐘
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

  /* 身分標記。啟動器用它確認接電話的是我們，而不是剛好占用同一個埠的別的程式。 */
  if (req.method === 'GET' && pathname === '/__whoami') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(WHOAMI);
    return;
  }

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

  /* 1.4 純心跳。儀表板切到背景的那一刻用 sendBeacon 送一發，
     把看門狗的倒數歸零——那正是計時器即將被節流的時刻。
     只更新 lastPollAt，不回傳任何狀態，所以 sendBeacon 不必讀回應。
     ⚠️ sendBeacon 一律送 POST，這裡不能只收 GET。 */
  if (pathname === '/sim_heartbeat') {
    lastPollAt = Date.now();
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    return res.end();
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

/* 依序試 PORT_BASE .. PORT_BASE+PORT_TRIES-1，用掉第一個空的。

   ⚠️ 每一輪都要重新掛 error handler：listen 失敗是非同步事件，沒有 handler
   就是 unhandled 'error' 直接讓行程掛掉——原本的行為就是這樣，
   使用者只會在 sim_server.log 裡看到一段 EADDRINUSE 堆疊。

   ⚠️ 成功回呼要用 once('listening') 自己掛，不能用 listen(port, host, cb) 的
   第三參數。那個參數是**加一個 'listening' 監聽器**，不是這一次呼叫專屬的回呼：
   重試三次就累積三個，最後成功時三個一起觸發，印出三行「已啟動」並把三個不同的
   埠號依序寫進 sim_server.port。踩過一次，寫在這裡。 */
function listenFrom(port, left) {
  const onError = (err) => {
    server.removeListener('listening', onReady);
    if (err && err.code === 'EADDRINUSE' && left > 0) {
      console.log(`⚠️ 連接埠 ${port} 已被其他程式占用，改試 ${port + 1}`);
      setImmediate(() => listenFrom(port + 1, left - 1));
      return;
    }
    console.error(`❌ 伺服器啟動失敗：${err && err.message ? err.message : err}`);
    process.exit(1);
  };
  const onReady = () => {
    server.removeListener('error', onError);
    server.on('error', (err) => console.error(`伺服器錯誤：${err && err.message}`));
    /* 把選定的埠寫出來給啟動器讀。檔案可能是上一輪留下的舊值，
       所以啟動器仍要用 /__whoami 驗一次，不能只信這個檔。 */
    try { fs.writeFileSync(PORT_FILE, String(port)); } catch (e) { /* 寫不出來不影響服務 */ }
    console.log(`=======================================================`);
    console.log(`🌐 放置型 RPG 模擬儀表板伺服器已啟動: http://127.0.0.1:${port}/`);
    console.log(`=======================================================`);
  };
  server.once('error', onError);
  server.once('listening', onReady);
  server.listen(port, '127.0.0.1');
}
listenFrom(PORT_BASE, PORT_TRIES - 1);
