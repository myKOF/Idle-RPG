'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(__dirname, 'test_all_ult_standardized.cjs');
const RESULTS_FILE = path.join(__dirname, 'all_ult_standardized_results.json');

console.log('🚀 開始 8 組平行多行程全速執行無時限基準測試 (8 Groups in Parallel)...\n');

const procs = [];
const NUM_GROUPS = 8;
const t0 = Date.now();

for (let i = 0; i < NUM_GROUPS; i++) {
  const p = new Promise((resolve, reject) => {
    const cp = spawn('node', [SCRIPT, String(i)], { cwd: ROOT, stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    cp.stdout.on('data', d => {
      process.stdout.write(`[G${i + 1}] ` + d.toString());
      stdout += d;
    });
    cp.stderr.on('data', d => {
      process.stderr.write(`[G${i + 1} ERR] ` + d.toString());
      stderr += d;
    });
    cp.on('close', code => {
      if (code === 0) resolve(i);
      else reject(new Error(`Group ${i} failed with code ${code}`));
    });
  });
  procs.push(p);
}

Promise.all(procs).then(() => {
  console.log(`\n🎉 全部 8 組平行模擬完成！(總耗時: ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  let allResults = [];
  for (let i = 0; i < NUM_GROUPS; i++) {
    const gFile = path.join(__dirname, `results_group_${i}.json`);
    if (fs.existsSync(gFile)) {
      const gData = JSON.parse(fs.readFileSync(gFile, 'utf8'));
      allResults = allResults.concat(gData);
      fs.unlinkSync(gFile);
    }
  }

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(allResults, null, 2), 'utf8');
  console.log(`✅ 已合併 32 個技能目標全量數據至: ${RESULTS_FILE}`);

  // 自動更新 Markdown 表格
  require('./update_dps_tables.cjs');
}).catch(err => {
  console.error('❌ 平行執行錯誤:', err);
});
