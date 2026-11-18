'use strict';
// 看門狗：由 headless-browser.cjs 以獨立行程啟動。
// 啟動它的 node 結束（包括被工具逾時直接砍掉、finally 沒跑到）或超過時限時，關掉該設定檔資料夾的瀏覽器並刪掉資料夾。
// 用法：node headless-watchdog.cjs <ownerPid> <profileDir> <deadlineEpochMs>
const fs = require('node:fs');
const { killByProfileDir } = require('./test-browser-kill.cjs');

const [ownerPid, profileDir, deadlineArg] = process.argv.slice(2);
const deadline = Number(deadlineArg) || Infinity;
const POLL_MS = 2000;

function alive(pid) {
  try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function finish() {
  try { killByProfileDir(profileDir); } catch (_) {}
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(profileDir, { recursive: true, force: true }); break; } catch (_) {}
    const until = Date.now() + 500; while (Date.now() < until) { /* 等瀏覽器放開檔案鎖 */ }
  }
  process.exit(0);
}

const timer = setInterval(() => {
  if (!alive(ownerPid) || Date.now() >= deadline) { clearInterval(timer); finish(); }
}, POLL_MS);
