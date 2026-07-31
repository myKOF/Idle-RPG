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

const server = http.createServer((req, res) => {
  const urlParts = req.url.split('?');
  const pathname = urlParts[0];

  // 1. 查詢即時模擬進度 API (直接讀取落地進度檔，徹底擺脫 Node stdout buffer 延遲)
  if (req.method === 'GET' && pathname === '/sim_progress') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    
    if (currentProgress.isSimulating) {
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

  // 2. 觸發原生模擬 API
  if (req.method === 'POST' && pathname === '/run_sim') {
    if (currentProgress.isSimulating) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, message: '已有模擬任務在執行中，請稍候...' }));
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let params = { hours: 100, seed: 20260730, policy: 'scripts/sim/policy.default.json', out: 'sim_out' };
      try {
        if (body) {
          const parsed = JSON.parse(body);
          if (parsed.hours) params.hours = Number(parsed.hours);
          if (parsed.seed) params.seed = Number(parsed.seed);
          if (parsed.policy) params.policy = parsed.policy;
          if (parsed.out) params.out = parsed.out;
        }
      } catch (e) {}

      const outDirAbs = path.join(ROOT, params.out);
      const progressFile = path.join(outDirAbs, 'sim_progress.json');
      if (fs.existsSync(progressFile)) {
        try { fs.unlinkSync(progressFile); } catch (e) {}
      }

      currentProgress = {
        isSimulating: true,
        percent: 0,
        currentHour: 0,
        totalHours: params.hours,
        outDir: params.out,
        statusText: `🚀 開始全系統原生內核模擬 (總時長 ${params.hours} 小時)...`
      };

      console.log(`\n🚀 [伺服器收到觸發請求] 開始執行原生內核模擬: 時數 ${params.hours}h, Seed ${params.seed}`);

      const args = [
        '--max-semi-space-size=64',
        path.join(ROOT, 'scripts/run_sim.js'),
        `--hours=${params.hours}`,
        `--seed=${params.seed}`,
        `--policy=${params.policy}`,
        `--out=${params.out}`
      ];

      const child = spawn('node', args, { cwd: ROOT });

      child.stdout.on('data', data => {
        // Log output if needed
      });

      child.stderr.on('data', data => {
        console.error(data.toString());
      });

      child.on('close', code => {
        currentProgress.isSimulating = false;
        if (code === 0) {
          currentProgress.percent = 100;
          currentProgress.currentHour = params.hours;
          currentProgress.statusText = `✅ 模擬 100% 完成！`;
          console.log('✅ 模擬執行成功，已更新數據!');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, message: '模擬執行完成' }));
        } else {
          currentProgress.statusText = `❌ 模擬失敗`;
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: '模擬過程發生錯誤' }));
        }
      });
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
