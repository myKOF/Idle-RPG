'use strict';
// 清掉 AI／工具留下的無畫面測試瀏覽器（規範見 AI_RULES.md 第 18 節）。使用者自己開的瀏覽器（有畫面）一律不碰。
//
//   node tools/kill-test-browsers.cjs           關掉「孤兒」：啟動它的程式已不在、被 Edge 更新重新拉起，或已跑超過 30 分鐘
//   node tools/kill-test-browsers.cjs --all     關掉全部測試瀏覽器（包括其他 AI 正在用的）
//   node tools/kill-test-browsers.cjs --list    只列出，不關
//   --max-age=分鐘                              調整「跑太久」的門檻
const os = require('node:os');
const fs = require('node:fs');
const { listBrowserMains, isTestBrowser, userDataDirOf, killTree } = require('./lib/test-browser-kill.cjs');

const argv = process.argv.slice(2);
const all = argv.includes('--all');
const listOnly = argv.includes('--list');
const maxAgeArg = argv.find(a => a.startsWith('--max-age='));
const maxAgeMin = maxAgeArg ? Number(maxAgeArg.split('=')[1]) : 30;

if (process.platform !== 'win32') { console.log('只支援 Windows'); process.exit(0); }

const LAUNCHERS = new Set(['node.exe', 'python.exe', 'pythonw.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe', 'bash.exe']);

function orphanReason(p) {
  if (!p.parentAlive) return '啟動它的程式已結束';
  if (!LAUNCHERS.has(String(p.parentName).toLowerCase())) return `父行程是 ${p.parentName}（多半是 Edge 更新後重新拉起）`;
  const ageMin = (Date.now() - p.startMs) / 60000;
  if (ageMin > maxAgeMin) return `已執行 ${Math.round(ageMin)} 分鐘`;
  return '';
}

const tests = listBrowserMains().filter(isTestBrowser);
if (!tests.length) { console.log('沒有測試用的無畫面瀏覽器。'); process.exit(0); }

let killed = 0;
for (const p of tests) {
  const reason = orphanReason(p);
  const dir = userDataDirOf(p.commandLine);
  const started = new Date(p.startMs).toLocaleString();
  const doKill = !listOnly && (all || reason);
  console.log(`${doKill ? '關閉' : '保留'}  PID ${p.pid}  ${p.name}  啟動於 ${started}  ${reason || '仍在使用中'}\n      ${dir}`);
  if (!doKill) continue;
  if (killTree(p.pid)) killed++;
  if (dir && dir.toLowerCase().startsWith(os.tmpdir().toLowerCase())) {
    setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }, 1000);
  }
}
console.log(listOnly ? `共 ${tests.length} 個。` : `已關閉 ${killed} 個，共 ${tests.length} 個。`);
